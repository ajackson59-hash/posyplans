import { defineConfig } from "drizzle-kit";

export default defineConfig({
  // Drizzle snapshots are development-only inputs. Deployable SQL lives in
  // supabase/migrations and is applied by the Supabase CLI.
  out: "./drizzle",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
