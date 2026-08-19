import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const sql = readFileSync(
  new URL("../../supabase/migrations/20260818180000_notification_system.sql", import.meta.url),
  "utf8",
);
describe("notification migration safety", () => {
  it("deduplicates customer approval and admin paid-order events", () => {
    assert.match(sql, /customer:payment_approved:/);
    assert.match(sql, /admin:new_paid_order:/);
    assert.ok((sql.match(/on conflict\(dedupe_key\) do nothing/g)?.length ?? 0) >= 2);
  });
  it("observes persisted payment transitions without rewriting canonical RPCs", () => {
    assert.match(sql, /after update of payment_status/);
    assert.doesNotMatch(
      sql,
      /create or replace function public.apply_mercado_pago_payment_response/,
    );
  });
  it("does not let enqueue failures abort payment or fulfillment", () =>
    assert.ok((sql.match(/exception when others then/g)?.length ?? 0) >= 5));
  it("never maps rejected to approved", () => {
    assert.match(sql, /new.payment_status='approved'/);
    assert.match(sql, /new.payment_status in \('rejected','cancelled','refunded'\)/);
  });
  it("creates a critical chargeback alert", () =>
    assert.match(sql, /admin_chargeback[\s\S]*?'critical'/));
  it("maps shipped to a customer event", () => assert.match(sql, /when 'shipped' then 'shipped'/));
  it("deduplicates fulfillment once per business event and order", () => {
    assert.match(sql, /'customer:'\|\|v_event\|\|':'\|\|new\.id,v_payload/);
    assert.doesNotMatch(sql, /v_version/);
  });
  it("queues order received only from the complete canonical checkout snapshot", () => {
    assert.match(sql, /after insert on public\.payment_checkout_snapshots/);
    assert.match(sql, /jsonb_array_elements\(coalesce\(new\.canonical_cart->'items'/);
    assert.doesNotMatch(sql, /sum\(quantity\)[\s\S]{0,100}new\.quantity/);
  });
  it("retries one claimed row rather than creating a new event", () => {
    assert.match(sql, /attempt_count=attempt_count\+1/);
    assert.match(sql, /power\(2/);
  });
  it("locks out anon and authenticated users from outbox", () =>
    assert.match(sql, /revoke all on public.notification_outbox from public, anon, authenticated/));
  it("allows only service role to operate the outbox worker", () => {
    assert.match(sql, /grant all on public\.notification_outbox to service_role/);
    assert.match(sql, /claim_notification_outbox_v1\(integer\) to service_role/);
    assert.match(sql, /enqueue_order_notification_v1[\s\S]*from public,anon,authenticated/);
  });
  it("protects internal notifications with admin RLS", () => {
    assert.match(sql, /revoke all on public\.admin_notifications from public, anon, authenticated/);
    assert.match(sql, /grant select on public\.admin_notifications to authenticated/);
    assert.ok((sql.match(/public\.has_role\(auth\.uid\(\), 'admin'\)/g)?.length ?? 0) >= 2);
  });
  it("role-checks both security-definer mark-read functions", () => {
    assert.match(sql, /admin_mark_notification_read[\s\S]*?has_role\(auth\.uid\(\),'admin'\)/);
    assert.match(sql, /admin_mark_all_notifications_read[\s\S]*?has_role\(auth\.uid\(\),'admin'\)/);
  });
  it("derives the customer recipient only from the persisted order", () =>
    assert.match(sql, /case when p_recipient_type='customer' then customer_email else null end/));
  it("implements read and unread operations", () => {
    assert.match(sql, /admin_mark_notification_read/);
    assert.match(sql, /admin_mark_all_notifications_read/);
    assert.match(sql, /admin_unread_notification_count/);
  });
  it("uses snapshot item quantities and canonical totals", () => {
    assert.match(sql, /item->>'quantity'/);
    assert.match(sql, /new.total_amount/);
  });
  it("only copies an explicit sanitized review reason", () => {
    assert.match(sql, /'reason','Revisión manual requerida'/);
    assert.doesNotMatch(sql, /access_token|card_token|webhook_signature|service_role_key/i);
  });
});
