-- Schema preparation is not a release or spending approval. Leave the existing
-- Preview ledger, counters and frozen evidence untouched. Re-running this
-- migration cannot reset an existing Production policy.
insert into public.image_spend_policies(id, paused, stop_reason)
values ('launch-production-image-v1', true, 'production_release_not_approved')
on conflict (id) do nothing;
