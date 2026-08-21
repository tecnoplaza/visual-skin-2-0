import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const email = readFileSync(new URL("./notification-email.ts", import.meta.url), "utf8");
const worker = readFileSync(new URL("../routes/api/public/hooks/notifications.ts", import.meta.url), "utf8");
const orders = readFileSync(new URL("./orders.functions.ts", import.meta.url), "utf8");
const analytics = readFileSync(new URL("../components/analytics/AnalyticsManager.tsx", import.meta.url), "utf8");

describe("order email access integration contract", () => {
  it("all customer templates use one URL helper and Admin remains separate", () => {
    assert.match(email, /notificationOrderHref\(eventType/);
    assert.match(email, /eventType\.startsWith\("admin_"\)/);
    assert.match(email, /\/admin\/orders\/\$\{encodedOrderId\}/);
  });

  it("worker signs customer links without rotating public access", () => {
    assert.match(worker, /issueOrderEmailAccessToken/);
    assert.doesNotMatch(worker, /update\(\{\s*public_access_token_hash/);
    assert.doesNotMatch(worker, /issueOrderRecovery|issue_recovery_token/);
  });

  it("new browser token exchange accepts signed email token and binds order", () => {
    assert.match(orders, /verifyOrderEmailAccessToken/);
    assert.match(orders, /data\.token, order\.id, order\.public_access_token_hash/);
  });

  it("analytics providers and page view wait until token query is removed", () => {
    assert.match(analytics, /hasPendingSensitiveToken\(location\.searchStr\)\)return/);
    assert.match(analytics, /location\.pathname,location\.searchStr/);
  });
});
