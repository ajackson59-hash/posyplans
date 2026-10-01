-- A duplicate Preview request must never create two provider image spends.
-- Preserve all historical attempt evidence, but clear the duplicate key from
-- later copies before enforcing one durable reservation per idempotency key.
with ranked as (
  select id,
         row_number() over (partition by idempotency_key order by id) as duplicate_rank
  from public.ai_first_artwork_attempts
  where idempotency_key is not null
)
update public.ai_first_artwork_attempts as attempts
set idempotency_key = null
from ranked
where attempts.id = ranked.id
  and ranked.duplicate_rank > 1;

create unique index if not exists ai_first_artwork_attempts_idempotency_key_uq
  on public.ai_first_artwork_attempts (idempotency_key)
  where idempotency_key is not null;
