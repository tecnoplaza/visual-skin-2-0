import { existsSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20260819010000_notification_worker_cron.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("notification worker Supabase cron migration", () => {
  it("enables pg_cron and pg_net", () => {
    assert.match(migration, /create extension if not exists pg_cron;/i);
    assert.match(migration, /create extension if not exists pg_net;/i);
  });

  it("schedules the production endpoint every two minutes", () => {
    assert.match(migration, /'visualskin-notification-worker'/);
    assert.match(migration, /'\*\/2 \* \* \* \*'/);
    assert.match(
      migration,
      /https:\/\/www\.visualskin\.cl\/api\/public\/hooks\/notifications/,
    );
  });

  it("reads the bearer secret from Vault and sends limit 20", () => {
    assert.match(migration, /from vault\.decrypted_secrets/i);
    assert.match(migration, /where name = 'visualskin_notification_cron_secret'/i);
    assert.match(migration, /'Authorization', 'Bearer ' \|\|/);
    assert.match(migration, /jsonb_build_object\('limit', 20\)/);
  });

  it("unschedules every prior job with the same name by job id", () => {
    assert.match(migration, /select jobid[\s\S]*where jobname = 'visualskin-notification-worker'/i);
    assert.match(migration, /cron\.unschedule\(v_jobid\)/i);
  });

  it("contains no embedded bearer token or service-role credential", () => {
    assert.doesNotMatch(migration, /Bearer\s+[A-Za-z0-9._~-]{16,}/);
    assert.doesNotMatch(migration, /service[_-]?role/i);
    assert.doesNotMatch(migration, /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./);
  });

  it("does not include a Vercel cron configuration", () => {
    assert.equal(existsSync(new URL("../../vercel.json", import.meta.url)), false);
    assert.equal(existsSync(new URL("../../vercel.ts", import.meta.url)), false);
  });
});
