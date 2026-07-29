// Loads .env for local dev / non-Vercel production. The Vercel serverless
// entry point (api/index.ts) does not import this file — Vercel injects
// env vars directly into process.env.
import "dotenv/config";
import { createExpressApp, ensureRoutesRegistered, log } from "./app";
import { serveStatic } from "./static";

const { app, httpServer } = createExpressApp();

(async () => {
  await ensureRoutesRegistered(app, httpServer);

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: process.env.HOST || "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
