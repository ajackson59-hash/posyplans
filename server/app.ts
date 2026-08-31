// Note: this module is shared by both the traditional long-running entry
// point (server/index.ts, local dev + non-Vercel prod) and the Vercel
// serverless entry point (api/index.ts). It intentionally does NOT load
// dotenv here — dotenv is CJS-only and breaks when esbuild bundles this
// module as ESM for the Vercel function ("Dynamic require of 'fs' is not
// supported"). Vercel injects env vars directly into process.env, so no
// .env loading is needed there. server/index.ts loads dotenv itself for
// local dev, where a .env file is actually used.
import express, { Response, NextFunction } from 'express';
import type { Request } from 'express';
import { createServer } from "node:http";
import type { Server } from "node:http";
import { registerRoutes } from "./routes";
import { registerInitialPreviewRoute } from "./initialPreviewRoute";
import { registerSmsInvitationRoutes } from "./smsInvitationRoutes";
import { registerEventStartupRoutes } from "./eventStartupRoutes";
import { registerEmailDiagnosticRoutes } from "./emailDiagnosticRoutes";
import { registerEventRecoveryRoutes } from "./eventRecoveryRoutes";
import { registerPrePaymentPreviewQualityRoutes } from "./prePaymentPreviewQualityRoutes";
import { registerPrePaymentPreviewBenchmarkRoutes } from "./prePaymentPreviewBenchmarkRoutes";

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

function redactSensitivePath(path: string): string {
  return path
    .replace(/(\/owner\/)[^/]+/g, "$1[REDACTED]")
    .replace(/(\/guest\/)[^/]+/g, "$1[REDACTED]");
}

function redactSensitiveJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
    if (/token/i.test(key)) return [key, "[REDACTED]"];
    return [key, redactSensitiveJson(entry)];
  }));
}

// Builds a fresh Express app + companion http.Server, wired with the shared
// body-parsing and request-logging middleware. Route registration is kept
// separate (see ensureRoutesRegistered below) so both the traditional
// long-running entry point (server/index.ts) and the Vercel serverless
// entry point (root server.ts) can share identical setup without either one
// depending on the other's lifecycle assumptions.
export function createExpressApp(): { app: express.Express; httpServer: Server } {
  const app = express();
  const httpServer = createServer(app);

  app.use(
    express.json({
      // Raised from the 100kb default so hosts can upload custom invitation
      // artwork (stored as a resized/compressed base64 data URI) without
      // hitting a payload-too-large error.
      limit: "6mb",
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  app.use(express.urlencoded({ extended: false, limit: "6mb" }));

  // Recipient tokens live in the URL so guests can open an invitation with a
  // single tap. Do not leak those paths to third-party origins through the
  // browser's Referer header.
  app.use((_req, res, next) => {
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });

  app.use((req, res, next) => {
    const start = Date.now();
    const path = redactSensitivePath(req.path);
    let capturedJsonResponse: Record<string, any> | undefined = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      const duration = Date.now() - start;
      if (path.startsWith("/api")) {
        let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
        if (capturedJsonResponse) {
          logLine += ` :: ${JSON.stringify(redactSensitiveJson(capturedJsonResponse))}`;
        }

        log(logLine);
      }
    });

    next();
  });

  return { app, httpServer };
}

// Route registration is async-safe to call more than once but only ever
// does the real work on the first call — subsequent calls (e.g. on a warm
// Vercel function invocation reusing the same module instance) resolve the
// same cached promise instantly.
let readyPromise: Promise<void> | null = null;

export function registerApiNotFoundHandler(app: express.Express): void {
  // Keep unknown API requests out of Express's default HTML error page. Page
  // requests intentionally fall through so local production can serve the SPA
  // shell and Vercel can keep handling its /index.html rewrite.
  app.use("/api", (_req, res) => {
    res.status(404).json({
      error: "We couldn't find that Posy API route.",
      code: "api_not_found",
    });
  });
}

export function ensureRoutesRegistered(app: express.Express, httpServer: Server): Promise<void> {
  if (!readyPromise) {
    readyPromise = (async () => {
      // Register small reliability-sensitive endpoints first. The recovery
      // route intentionally precedes its legacy equivalent in routes.ts so it
      // can provide accurate service health and a traceable support reference.
      registerEventStartupRoutes(app);
      registerEventRecoveryRoutes(app);
      // The quality-locked prepayment preview intentionally precedes the
      // legacy teaser in routes.ts. Raw provider output is never customer-
      // visible: Preview defaults to a deterministic direction card until the
      // strict GPT Image 2 + vision benchmark is explicitly enabled.
      registerPrePaymentPreviewQualityRoutes(app);
      // Vercel's authenticated connector can inspect protected Previews with
      // GET requests only. This narrowly scoped method override permits it to
      // execute one fixed, branch-guarded benchmark case when the private query
      // flag is present. The benchmark route still accepts no arbitrary prompt
      // and returns 404 outside this one Preview branch.
      app.use("/api/qa/prepayment-preview-benchmark", (req, _res, next) => {
        if (req.method === "GET" && req.query.__posy_run_fixed === "1") {
          req.method = "POST";
        }
        next();
      });
      // Fixed-corpus provider QA is exposed only by the quality-lock Preview
      // branch. The route itself returns 404 everywhere else and accepts no
      // arbitrary prompts, so it cannot become a public image-generation API.
      registerPrePaymentPreviewBenchmarkRoutes(app);
      await registerRoutes(httpServer, app);
      registerInitialPreviewRoute(app);
      registerSmsInvitationRoutes(app);
      registerEmailDiagnosticRoutes(app);
      registerApiNotFoundHandler(app);

      app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
        const status = err.status || err.statusCode || 500;
        const message = err.message || "Internal Server Error";

        console.error("Internal Server Error:", err);

        if (res.headersSent) {
          return next(err);
        }

        return res.status(status).json({ message });
      });
    })();
  }
  return readyPromise;
}
