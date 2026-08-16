# Posy database migration lineage

`supabase/migrations` is the single source of truth for deployable database
changes. Drizzle continues to define the TypeScript schema, but
`drizzle-kit push` must not be used against a hosted database because it
bypasses Supabase migration history.

## Reconstructed baseline

Production already contained the ten core Posy tables before Supabase
migration tracking began. `20260719000000_production_baseline.sql` recreates
that earlier state for clean branch replays. It was generated from the main
branch Drizzle schema, checked against the live Production catalog, and then
rolled back only for the five later changes already present in Production's
migration history.

The next five files are the exact versions and statements recorded in
Production. The AI-first foundation file comes before the reliability repair,
so a clean database has `ai_first_image_ledger` before the repair creates its
partial unique index.

## One-time Production history adoption

The baseline objects already exist in Production. Never execute the baseline
SQL against that existing schema. After an explicit Production change review,
link the CLI to project `jvioxjetpqafkbwqihto` and mark only the baseline
version as applied:

```sh
npx --yes supabase@2.114.0 migration repair 20260719000000 --status applied --linked
npx --yes supabase@2.114.0 migration list --linked
npm run db:push:dry-run
```

Review the dry run before `npm run db:push`. New databases and Preview
branches run every migration normally; only the already-existing Production
schema receives the one-time history repair.
