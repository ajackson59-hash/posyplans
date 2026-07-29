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

  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
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
          logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
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

export function ensureRoutesRegistered(app: express.Express, httpServer: Server): Promise<void> {
  if (!readyPromise) {
    readyPromise = (async () => {
      await registerRoutes(httpServer, app);

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
