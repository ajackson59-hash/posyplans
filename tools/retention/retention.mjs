import { createHash } from 'node:crypto';

// Deliberately explicit. Adding storage requires a reviewed scope update.
export const CONTENT_TABLES = Object.freeze([
  'guests', 'budget_items', 'menu_items', 'shopping_list_items', 'timeline_items',
  'master_planner_generations', 'ai_first_previews', 'ai_first_artwork_attempts',
  'ai_first_generation_runs', 'human_artwork_reviews', 'customer_artwork_sessions',
  'plan_regenerations', 'plus_link_challenges', 'event_plus_memberships', 'event_retention_activity',
]);
export const SHARED_TABLES = Object.freeze([
  'ai_first_image_ledger', 'image_spend_policies', 'image_spend_requests',
  'image_spend_reconciliations', 'image_spend_continuations', 'plus_memberships',
  'email_entitlements', 'analytics_events', 'theme_suggestion_cache', 'plus_link_rate_buckets',
]);
const ALL_TABLES = ['events', ...CONTENT_TABLES, ...SHARED_TABLES].sort();
const EVENT_TABLES = new Set(['events', ...CONTENT_TABLES, 'ai_first_image_ledger', 'image_spend_requests']);
export const RESIDUAL_SCOPES = Object.freeze([
  'Legacy image accounting, including contact-based caps and idempotency evidence, is retained unchanged; review its justified retention separately.',
  'Shared subscriptions, email entitlements, rate buckets, analytics and theme cache are retained; exact personal matches require separate scoped review.',
  'Image spend requests retain accounting and usage; ordinary event references become null without resetting counters.',
  'Provider records, support evidence, external image objects/CDN, logs, backups, browser storage and recipient downloads are outside this database transaction.',
]);
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = code => { throw Object.assign(new Error(code), { code }); };
const validEvent = id => { if (!Number.isSafeInteger(id) || id < 1) fail('invalid_event_id'); };
const opaque = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(value);

async function schema(db) {
  const rows = await db.query(`select table_name, column_name, data_type, is_nullable
    from information_schema.columns where table_schema='public'
    order by table_name, ordinal_position`);
  const tables = new Set(rows.map(r => r.table_name));
  const missing = ALL_TABLES.filter(t => !tables.has(t));
  if (missing.length) fail('required_retention_schema_missing');
  const unknown = rows.filter(r => r.column_name === 'event_id' && !EVENT_TABLES.has(r.table_name));
  if (unknown.length) fail('unreviewed_event_storage');
  // Any unknown FK chain could cascade outside the approved event scope.
  const fks = await db.query(`select ns.nspname as schema_name, cl.relname as table_name,
      pn.nspname as parent_schema, pc.relname as parent_table, pg_get_constraintdef(c.oid) as definition
    from pg_constraint c join pg_class cl on cl.oid=c.conrelid
    join pg_namespace ns on ns.oid=cl.relnamespace
    join pg_class pc on pc.oid=c.confrelid join pg_namespace pn on pn.oid=pc.relnamespace
    where c.contype='f' order by ns.nspname,cl.relname,c.conname`);
  const deletedTables = new Set(['events', ...CONTENT_TABLES]);
  if (fks.some(f => f.parent_schema === 'public' && deletedTables.has(f.parent_table)
    && (f.schema_name !== 'public' || !ALL_TABLES.includes(f.table_name)))) fail('unreviewed_foreign_key_storage');
  return { columns: rows.filter(r => ALL_TABLES.includes(r.table_name)), fks: fks.filter(f => f.schema_name === 'public' && ALL_TABLES.includes(f.table_name)) };
}

// SQL hashes prevent prompts, pixels, tokens, names or email addresses leaving the database.
async function digest(db, table, predicate = 'true', params = []) {
  const [r] = await db.query(`select count(*)::integer as count,
    encode(sha256(convert_to(coalesce(string_agg(h, '' order by h), ''), 'UTF8')), 'hex') as sha256
    from (select encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')), 'hex') h
      from public.${table} t where ${predicate}) hashed`, params);
  return r;
}

async function clockAndActivity(db, eventId) {
  const [r] = await db.query(`select transaction_timestamp() as observed_at,
    a.last_activity_at, a.first_recorded_at, a.last_activity_kind,
    a.last_activity_at + interval '12 months' as due_at,
    coalesce(a.last_activity_at + interval '12 months' <= transaction_timestamp(),false) as due
    from public.events e left join public.event_retention_activity a on a.event_id=e.id where e.id=$1`, [eventId]);
  if (!r) fail('event_not_found');
  return r;
}

async function scope(db, eventId) {
  const structure = await schema(db);
  const activity = await clockAndActivity(db, eventId);
  const content = {};
  content.events = await digest(db, 'events', 't.id=$1', [eventId]);
  for (const table of CONTENT_TABLES) content[table] = await digest(db, table, 't.event_id=$1', [eventId]);
  const accounting = {};
  for (const table of ['ai_first_image_ledger', 'image_spend_requests']) accounting[table] = await digest(db, table, 't.event_id=$1', [eventId]);
  const [holds] = await db.query(`select
    (select count(*)::integer from public.image_spend_reconciliations a where
      a.request_id in(select id from public.image_spend_requests where event_id=$1)
      or a.request_before->>'event_id'=$1::text) as reconciliations,
    (select count(*)::integer from public.image_spend_continuations a where
      a.request_id in(select id from public.image_spend_requests where event_id=$1)
      or a.request_before->>'event_id'=$1::text or $1=any(a.allowed_event_ids)) as continuations,
    (select count(*)::integer from public.image_spend_requests where event_id=$1 and state in('reserved','dispatched','unknown','reconciled')) as unresolved_requests`, [eventId]);
  const blockers = [];
  if ([75, 80].includes(eventId)) blockers.push('frozen_support_case_15869610');
  if (holds.reconciliations || holds.continuations) blockers.push('immutable_image_evidence_requires_separate_review');
  if (holds.unresolved_requests) blockers.push('unresolved_or_reconciled_image_accounting');
  return { eventId, activity, content, accounting, holds, blockers,
    fingerprint: sha({ version: 1, eventId, structure, content, accounting, holds }) };
}

/** db.transaction(mode, callback) owns the transaction; callback receives query(sql,params)->rows. */
export async function reportRetention(db) {
  return db.transaction('read', async tx => {
    await tx.query("set local timezone='UTC'");
    await tx.query("set local statement_timeout='30s'");
    await schema(tx);
    const rows = await tx.query(`select e.id as event_id,a.last_activity_at,
      a.last_activity_at + interval '12 months' as due_at,
      case when a.event_id is null then 'unknown_history'
        when a.last_activity_at + interval '12 months' <= transaction_timestamp() then 'review_due'
        else 'not_due' end as retention_status,
      e.id in(75,80) as frozen_support_case
      from public.events e left join public.event_retention_activity a on a.event_id=e.id order by e.id`);
    return { mode: 'read_only', cutoff: '12 calendar months after verified server activity; UTC',
      events: rows, note: 'Review candidates only. No automatic deletion; unknown history never qualifies by age.' };
  });
}

export async function planDeletion(db, eventId, basis = 'verified_request') {
  validEvent(eventId);
  if (!['verified_request', 'inactivity'].includes(basis)) fail('invalid_basis');
  return db.transaction('read', async tx => {
    await tx.query("set local timezone='UTC'");
    await tx.query("set local statement_timeout='30s'");
    const data = await scope(tx, eventId);
    if (basis === 'inactivity' && !data.activity.due) data.blockers.push('inactivity_cutoff_not_established');
    return { version: 1, mode: 'dry_run', basis, ...data, residualScopes: [...RESIDUAL_SCOPES] };
  });
}

function validateApproval(plan, approval) {
  if (plan?.version !== 1 || plan.mode !== 'dry_run') fail('invalid_plan');
  validEvent(plan.eventId);
  if (!['verified_request', 'inactivity'].includes(plan.basis)) fail('invalid_basis');
  if (approval?.execute !== true || approval.eventId !== plan.eventId || approval.fingerprint !== plan.fingerprint
    || approval.basis !== plan.basis || !opaque(approval.requestId) || !opaque(approval.maintenanceReference)) fail('explicit_exact_approval_required');
  if (approval.maintenanceActive !== true || approval.allWritersDrained !== true
    || approval.legacyWorkersCannotResume !== true) fail('verified_maintenance_and_drain_required');
  if (approval.residualScopesReviewed !== true || approval.backupDeletionLedgerPrepared !== true) fail('residual_and_backup_review_required');
  if (plan.basis === 'verified_request' && approval.requesterVerifiedForWholeEvent !== true) fail('verified_whole_event_request_required');
  if (plan.basis === 'inactivity' && approval.inactivityReviewApproved !== true) fail('inactivity_review_required');
}

/** Explicit executor. No scheduling, API route, provider calls or automatic retry. */
export async function executeDeletion(db, plan, approval) {
  validateApproval(plan, approval);
  return db.transaction('write', async tx => {
    await tx.query("set local timezone='UTC'");
    await tx.query("set local lock_timeout='5s'");
    await tx.query("set local statement_timeout='30s'");
    // Lock before any SELECT. This stabilizes unrelated rows/counters too; keep maintenance active.
    await tx.query(`lock table ${ALL_TABLES.map(t => `public.${t}`).join(',')} in share row exclusive mode`);
    const current = await scope(tx, plan.eventId);
    const age = new Date(current.activity.observed_at).getTime() - new Date(plan.activity?.observed_at).getTime();
    if (!Number.isFinite(age) || age < 0 || age > 15 * 60_000) fail('plan_expired');
    if (current.fingerprint !== plan.fingerprint) fail('stale_plan');
    if (current.blockers.length) fail(current.blockers[0]);
    if (plan.basis === 'inactivity' && !current.activity.due) fail('inactivity_cutoff_not_established');
    const preservedBefore = {};
    for (const table of ALL_TABLES) {
      const predicate = table === 'events' ? 't.id<>$1' : CONTENT_TABLES.includes(table) ? 't.event_id<>$1' :
        table === 'image_spend_requests' ? 't.event_id is distinct from $1' : 'true';
      preservedBefore[table] = await digest(tx, table, predicate, predicate === 'true' ? [] : [plan.eventId]);
    }
    // Spend requests survive. The FK clears event_id only; every other accounting field must match.
    const [spendBefore] = await tx.query(`select coalesce(jsonb_agg(to_jsonb(r)-'event_id' order by id),'[]') as rows
      from public.image_spend_requests r where event_id=$1`, [plan.eventId]);
    for (const table of CONTENT_TABLES) await tx.query(`delete from public.${table} where event_id=$1`, [plan.eventId]);
    const removed = await tx.query('delete from public.events where id=$1 returning id', [plan.eventId]);
    if (removed.length !== 1) fail('event_delete_count_changed');
    for (const table of CONTENT_TABLES) {
      if ((await digest(tx, table, 't.event_id=$1', [plan.eventId])).count !== 0) fail('event_content_remains');
    }
    const expectedSpend = spendBefore.rows;
    const ids = expectedSpend.map(r => r.id);
    const [spendAfter] = await tx.query(`select coalesce(jsonb_agg(to_jsonb(r)-'event_id' order by id),'[]') as rows,
      count(*) filter(where event_id is not null)::integer as still_linked
      from public.image_spend_requests r where id=any($1::uuid[])`, [ids]);
    if (spendAfter.still_linked || sha(spendAfter.rows) !== sha(expectedSpend)) fail('spend_accounting_changed');
    for (const table of ALL_TABLES) {
      const predicate = table === 'events' ? 't.id<>$1' : CONTENT_TABLES.includes(table) ? 't.event_id<>$1' :
        table === 'image_spend_requests' ? 'not(t.id=any($1::uuid[]))' : 'true';
      const after = await digest(tx, table, predicate, predicate === 'true' ? [] : table === 'image_spend_requests' ? [ids] : [plan.eventId]);
      if (sha(after) !== sha(preservedBefore[table])) fail('unrelated_or_shared_data_changed');
    }
    await tx.query('set constraints all immediate');
    // Returned only after transaction commits. Contains no names, addresses, tokens, prompts or pixels.
    return { version: 1, status: 'event_database_content_deleted_with_residual_scopes', eventId: plan.eventId,
      requestId: approval.requestId, basis: plan.basis, fingerprint: plan.fingerprint,
      deletedAt: current.activity.observed_at, deletedCounts: Object.fromEntries(Object.entries(current.content).map(([k,v]) => [k,v.count])),
      retainedLegacyAccountingRows: current.accounting.ai_first_image_ledger.count,
      detachedSpendRows: ids.length, residualScopes: [...RESIDUAL_SCOPES] };
  });
}
