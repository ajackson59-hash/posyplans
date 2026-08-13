-- Posy's browser never connects to Supabase directly. All customer access is
-- owner-token scoped by the Express API, which uses a trusted direct Postgres
-- connection. Keep the Data API roles default-deny so a publishable key can
-- never bypass that application boundary.

begin;

alter table public.events enable row level security;
alter table public.guests enable row level security;
alter table public.budget_items enable row level security;
alter table public.menu_items enable row level security;
alter table public.shopping_list_items enable row level security;
alter table public.timeline_items enable row level security;
alter table public.theme_suggestion_cache enable row level security;
alter table public.master_planner_generations enable row level security;
alter table public.email_entitlements enable row level security;
alter table public.analytics_events enable row level security;
alter table public.ai_first_previews enable row level security;
alter table public.ai_first_image_ledger enable row level security;
alter table public.ai_first_generation_runs enable row level security;
alter table public.ai_first_artwork_attempts enable row level security;

revoke all privileges on table public.events from anon, authenticated;
revoke all privileges on table public.guests from anon, authenticated;
revoke all privileges on table public.budget_items from anon, authenticated;
revoke all privileges on table public.menu_items from anon, authenticated;
revoke all privileges on table public.shopping_list_items from anon, authenticated;
revoke all privileges on table public.timeline_items from anon, authenticated;
revoke all privileges on table public.theme_suggestion_cache from anon, authenticated;
revoke all privileges on table public.master_planner_generations from anon, authenticated;
revoke all privileges on table public.email_entitlements from anon, authenticated;
revoke all privileges on table public.analytics_events from anon, authenticated;
revoke all privileges on table public.ai_first_previews from anon, authenticated;
revoke all privileges on table public.ai_first_image_ledger from anon, authenticated;
revoke all privileges on table public.ai_first_generation_runs from anon, authenticated;
revoke all privileges on table public.ai_first_artwork_attempts from anon, authenticated;

revoke all privileges on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all privileges on tables from anon, authenticated;
alter default privileges in schema public revoke all privileges on sequences from anon, authenticated;

commit;
