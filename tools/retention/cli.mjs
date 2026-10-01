#!/usr/bin/env node
import { readFile, open, unlink } from 'node:fs/promises';
import postgres from 'postgres';
import { reportRetention, planDeletion, executeDeletion } from './retention.mjs';

const args = process.argv.slice(2);
const command = args[0] ?? 'report';
const option = name => args.find(x => x.startsWith(`--${name}=`))?.slice(name.length + 3);
let sql;
let receipt;
let committed = false;
try {
  if (!['report', 'plan', 'execute'].includes(command)) throw Error('Use report, plan, or execute.');
  const url = new URL(process.env.POSY_RETENTION_DATABASE_URL ?? '');
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !process.env.POSY_RETENTION_EXPECTED_HOST || url.hostname !== process.env.POSY_RETENTION_EXPECTED_HOST) {
    throw Error('Explicit retention database URL and matching expected host are required.');
  }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  sql = postgres(url.href, { prepare: false, max: 1, connect_timeout: 5, idle_timeout: 2,
    ssl: local ? false : { rejectUnauthorized: true } });
  const db = { transaction: (mode, callback) => sql.begin(mode === 'read' ? 'isolation level repeatable read read only' : '',
    tx => callback({ query: (query, params = []) => tx.unsafe(query, params) })) };
  let result;
  if (command === 'report') result = await reportRetention(db);
  if (command === 'plan') result = await planDeletion(db, Number(option('event')), option('basis') ?? 'verified_request');
  if (command === 'execute') {
    if (!option('plan') || !option('approval') || !option('receipt')) throw Error('Execute requires plan, approval and a new receipt path.');
    const plan = JSON.parse(await readFile(option('plan'), 'utf8'));
    const approval = JSON.parse(await readFile(option('approval'), 'utf8'));
    if (approval.databaseHost !== url.hostname) throw Error('Approval must identify the exact database host.');
    // Fail before mutation if the receipt destination is unavailable or already exists.
    receipt = await open(option('receipt'), 'wx', 0o600);
    result = await executeDeletion(db, plan, approval);
    committed = true;
    await receipt.writeFile(JSON.stringify(result, null, 2) + '\n');
    await receipt.sync();
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} catch (error) {
  // DB errors can contain row values. Never log raw driver messages or connection strings.
  const safe = typeof error.code === 'string' && /^[a-z_]+$/.test(error.code) ? error.code : 'operation_failed_review_locally';
  process.stderr.write(`${committed ? 'DATABASE_COMMITTED_RECEIPT_WRITE_FAILED' : 'NO_SUCCESS_REPORTED'}: ${safe}\n`);
  process.exitCode = 1;
} finally {
  if (receipt) {
    await receipt.close();
    if (!committed) await unlink(option('receipt')).catch(() => {});
  }
  if (sql) await sql.end({ timeout: 3 });
}
