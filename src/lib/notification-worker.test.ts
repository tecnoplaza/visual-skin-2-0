import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ServerConfig } from "./server-config.ts";
import {
  handleAuthenticatedNotificationRequest,
  notificationAuthorizationStatus,
} from "./notification-worker-http.ts";

const manualSecret = "manual-notification-secret-1234567890";
const vercelSecret = "vercel-cron-secret-123456789012345";

function config(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    notificationCronSecret: manualSecret,
    cronSecret: vercelSecret,
    ...overrides,
  } as ServerConfig;
}

function request(method: "GET" | "POST", secret?: string): Request {
  return new Request("https://visualskin.cl/api/public/hooks/notifications", {
    method,
    headers: secret ? { authorization: `Bearer ${secret}` } : undefined,
  });
}

describe("notification worker HTTP authorization", () => {
  it("authorizes POST with NOTIFICATION_CRON_SECRET", async () => {
    const result = await handleAuthenticatedNotificationRequest(
      request("POST", manualSecret), "POST", config(), async () => okResponse(),
    );
    assert.equal(result.status, 200);
  });

  it("rejects POST with an incorrect secret", async () => {
    const result = await handleAuthenticatedNotificationRequest(
      request("POST", "incorrect-secret-value-123456789"), "POST", config(), async () => okResponse(),
    );
    assert.equal(result.status, 401);
  });

  it("authorizes GET with Vercel CRON_SECRET", async () => {
    const result = await handleAuthenticatedNotificationRequest(
      request("GET", vercelSecret), "GET", config(), async () => okResponse(),
    );
    assert.equal(result.status, 200);
  });

  it("rejects GET with an incorrect secret", async () => {
    const result = await handleAuthenticatedNotificationRequest(
      request("GET", manualSecret), "GET", config(), async () => okResponse(),
    );
    assert.equal(result.status, 401);
  });

  it("disables GET when CRON_SECRET is not configured", async () => {
    const result = await handleAuthenticatedNotificationRequest(
      request("GET", vercelSecret), "GET", config({ cronSecret: null }), async () => okResponse(),
    );
    assert.equal(result.status, 503);
  });

  it("does not accept either secret through query parameters", async () => {
    const queryRequest = new Request(
      `https://visualskin.cl/api/public/hooks/notifications?secret=${encodeURIComponent(vercelSecret)}`,
      { method: "GET" },
    );
    const result = await handleAuthenticatedNotificationRequest(
      queryRequest, "GET", config(), async () => okResponse(),
    );
    assert.equal(result.status, 401);
  });

  it("keeps manual POST enabled independently of CRON_SECRET", async () => {
    const result = await handleAuthenticatedNotificationRequest(
      request("POST", manualSecret), "POST", config({ cronSecret: null }), async () => okResponse(),
    );
    assert.equal(result.status, 200);
  });

  it("runs GET and POST through the same injected worker", async () => {
    const methods: string[] = [];
    const worker = async () => {
      methods.push("processed");
      return okResponse();
    };
    await handleAuthenticatedNotificationRequest(request("GET", vercelSecret), "GET", config(), worker);
    await handleAuthenticatedNotificationRequest(request("POST", manualSecret), "POST", config(), worker);
    assert.deepEqual(methods, ["processed", "processed"]);
  });

  it("never includes configured secrets in error responses", async () => {
    const result = await handleAuthenticatedNotificationRequest(
      request("GET", manualSecret), "GET", config(), async () => okResponse(),
    );
    const body = await result.text();
    assert.equal(notificationAuthorizationStatus(request("GET"), vercelSecret), 401);
    assert.doesNotMatch(body, new RegExp(`${manualSecret}|${vercelSecret}`));
    assert.deepEqual(JSON.parse(body), { ok: false, error: "unauthorized" });
  });
});

function okResponse(): Response {
  return new Response(JSON.stringify({ ok: true, claimed: 0, sent: 0, failed: 0 }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
