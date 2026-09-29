// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DbRetentionActivityStore } from '../server/retentionActivityStore';
import { postgresIntegrationUrl } from '../script/postgres-test-config.mjs';

const control = postgres(postgresIntegrationUrl(), { prepare: false, max: 2, connect_timeout: 3, idle_timeout: 2 });
const store = new DbRetentionActivityStore(drizzle(control));
let initialized = false;
beforeAll(async () => {
  const [identity] = await control`select current_database() as name`;
  if (identity.name !== 'posy_integration') throw Error('Unexpected integration database.');
  if ((await control`select tablename from pg_tables where schemaname='public'`).length)
    throw Error('Use a fresh, empty disposable PostgreSQL database.');
  await control.begin(async tx => {
    for (const role of ['anon','authenticated','service_role'])
      if (!(await tx`select 1 from pg_roles where rolname=${role}`).length)
        await tx.unsafe(`create role ${role} nologin${role === 'service_role' ? ' bypassrls' : ''}`);
    await tx.unsafe(`create table public.events(id integer primary key,owner_token text unique,share_slug text unique,invite_status text);
      create table public.guests(id integer primary key,event_id integer,access_token text unique);
      insert into public.events values(1,'synthetic-legacy-owner','synthetic-legacy-share','published');`);
    await tx.unsafe('grant select,insert,update,delete on public.events,public.guests to service_role');
    await tx.unsafe(await readFile(new URL('../supabase/migrations/20260929151638_event_retention_activity.sql', import.meta.url), 'utf8'));
  });
  initialized = true;
});
afterAll(async () => {
  if (initialized) await control.unsafe('drop table public.event_retention_activity,public.guests,public.events cascade; drop function public.record_event_creation_activity();');
  await control.end({ timeout: 3 });
});

describe('private retention activity on disposable PostgreSQL', () => {
  it('keeps preexisting history unknown and atomically tracks new creation', async () => {
    expect(await control`select event_id from public.event_retention_activity where event_id=1`).toHaveLength(0);
    await control`insert into public.events values(2,'synthetic-new-owner','synthetic-new-share','draft')`;
    const [row] = await control`select * from public.event_retention_activity where event_id=2`;
    expect(row.last_activity_kind).toBe('created'); expect(row.last_activity_at).toEqual(row.first_recorded_at);
    await expect(control.begin(async tx => {
      await tx`insert into public.events values(9,'synthetic-rollback-owner','synthetic-rollback-share','draft')`;
      throw Error('rollback synthetic creation');
    })).rejects.toThrow('rollback synthetic creation');
    expect(await control`select event_id from public.event_retention_activity where event_id=9`).toHaveLength(0);
  });
  it('requires real owner credentials and never moves activity backward', async () => {
    expect(await store.recordOwner('wrong', 'host_action')).toBe(false);
    expect(await store.recordOwner('synthetic-legacy-owner', 'host_visit')).toBe(true);
    const [first] = await control`select first_recorded_at from public.event_retention_activity where event_id=1`;
    await control`update public.event_retention_activity set last_activity_at=clock_timestamp()+interval '1 hour',last_activity_kind='host_action' where event_id=1`;
    const [before] = await control`select * from public.event_retention_activity where event_id=1`;
    expect(await store.recordOwner('synthetic-legacy-owner', 'host_visit')).toBe(true);
    const [after] = await control`select * from public.event_retention_activity where event_id=1`;
    expect(after.last_activity_at).toEqual(before.last_activity_at);
    expect(after.last_activity_kind).toBe('host_action'); expect(after.first_recorded_at).toEqual(first.first_recorded_at);
  });
  it('only records the exact published event and verified guest, then cascades deletion', async () => {
    await control`insert into public.guests values(1,2,'synthetic-guest')`;
    expect(await store.recordGuest('synthetic-new-share','synthetic-guest')).toBe(false);
    await control`update public.events set invite_status='published' where id=2`;
    expect(await store.recordGuest('synthetic-legacy-share','synthetic-guest')).toBe(false);
    expect(await store.recordGuest('synthetic-new-share','wrong')).toBe(false);
    expect(await store.recordGuest('synthetic-new-share','synthetic-guest')).toBe(true);
    const [row] = await control`select last_activity_kind from public.event_retention_activity where event_id=2`;
    expect(row.last_activity_kind).toBe('guest_rsvp');
    await control`delete from public.events where id=2`;
    expect(await control`select event_id from public.event_retention_activity where event_id=2`).toHaveLength(0);
  });
  it('denies all client CRUD and preserves private RLS', async () => {
    const [row] = await control`select relrowsecurity as rls from pg_class where oid='public.event_retention_activity'::regclass`;
    expect(row.rls).toBe(true);
    for (const role of ['anon','authenticated']) {
      const [access] = await control`select has_table_privilege(${role},'public.event_retention_activity','SELECT,INSERT,UPDATE,DELETE') as access`;
      expect(access.access).toBe(false);
    }
  });
  it('lets the server role create atomically despite revoked direct trigger-function execution', async () => {
    const [access] = await control`select has_function_privilege('service_role','public.record_event_creation_activity()','EXECUTE') as access`;
    expect(access.access).toBe(false);
    await control.begin(async tx => {
      await tx.unsafe('set local role service_role');
      await tx`insert into public.events values(3,'synthetic-server-owner','synthetic-server-share','draft')`;
      const [row] = await tx`select last_activity_kind from public.event_retention_activity where event_id=3`;
      expect(row.last_activity_kind).toBe('created');
    });
  });
});
