// Vercel Serverless Function source. NOT deployed directly — the
// "vercel-build" script in package.json pre-bundles this file with esbuild
// into a single plain CommonJS file at api/index.js *before* Vercel's own
// build/function-detection step ever sees it:
//
//   esbuild server/vercel-entry.ts --bundle --platform=node --format=cjs
//     --outfile=api/index.js --external:pg-native
//
// Why pre-bundle instead of letting Vercel auto-detect+bundle a TS file
// under api/ itself: our root package.json has {"type": "module"} (needed
// for Vite/drizzle-kit/tsx elsewhere in the project). When Vercel's
// esbuild-based Node builder sees that and bundles a TS entry under api/ on
// its own, it outputs ESM — which breaks at runtime the moment any CJS
// dependency in the tree does a dynamic `require()` of a Node core module
// (dotenv, and `debug` deep inside express/body-parser both do this):
// "Dynamic require of 'X' is not supported". Node's native CJS require()
// handles that pattern fine; esbuild's CJS-in-ESM interop shim does not.
// Neither a nested api/package.json with {"type": "commonjs"} nor naming
// the entry file with a .cts extension reliably avoided this in testing
// (.cts additionally wasn't recognized as a routable function at all).
// Shipping an already-bundled plain .js file sidesteps the ambiguity
// entirely — there's no TypeScript/module-type decision left for Vercel's
// builder to make.
//
// vercel.json rewrites every non-static-asset request to this function
// ("/(.*)" -> "/api"), so it must handle every /api/* route our Express app
// defines. Static assets in public/** are still served directly by
// Vercel's CDN and take precedence over this rewrite.
//
// The actual app setup and route registration live in server/app.ts and
// server/routes.ts and are shared with the traditional long-running entry
// point (server/index.ts, used for local dev and the non-Vercel production
// fallback) so there is exactly one place that wires up middleware and
// routes.
import { createExpressApp, ensureRoutesRegistered } from "./app";

const { app, httpServer } = createExpressApp();

// Vercel Functions can be reused across requests while warm, but the first
// request into a fresh instance must wait for route registration to finish
// before it reaches any route handler.
app.use((_req, _res, next) => {
  ensureRoutesRegistered(app, httpServer).then(() => next(), next);
});

export default app;
