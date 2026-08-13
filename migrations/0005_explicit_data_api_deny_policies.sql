-- Make the server-only Data API boundary explicit. These permissive-false
-- policies document today's default-deny state and keep it deny-by-default if
-- table grants are ever restored. A future direct-client feature can add a
-- narrowly scoped permissive policy without removing this audit marker.

begin;

create policy data_api_default_deny on public.events
  for all to anon, authenticated using (false) with check (false);
create policy data_api_default_deny on public.guests
  for all to anon, authenticated using (false) with check (false);
create policy data_api_default_deny on public.budget_items
  for all to anon, authenticated using (false) with check (false);
create policy data_api_default_deny on public.menu_items
  for all to anon, authenticated using (false) with check (false);
create policy data_api_default_deny on public.shopping_list_items
  for all to anon, authenticated using (false) with check (false);
create policy data_api_default_deny on public.timeline_items
  for all to anon, authenticated using (false) with check (false);
create policy data_api_default_deny on public.theme_suggestion_cache
  for all to anon, authenticated using (false) with check (false);
create policy data_api_default_deny on public.master_planner_generations
  for all to anon, authenticated using (false) with check (false);
create policy data_api_default_deny on public.email_entitlements
  for all to anon, authenticated using (false) with check (false);
create policy data_api_default_deny on public.analytics_events
  for all to anon, authenticated using (false) with check (false);
create policy data_api_default_deny on public.ai_first_previews
  for all to anon, authenticated using (false) with check (false);
create policy data_api_default_deny on public.ai_first_image_ledger
  for all to anon, authenticated using (false) with check (false);
create policy data_api_default_deny on public.ai_first_generation_runs
  for all to anon, authenticated using (false) with check (false);
create policy data_api_default_deny on public.ai_first_artwork_attempts
  for all to anon, authenticated using (false) with check (false);

commit;
