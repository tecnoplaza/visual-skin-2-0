import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  issueOrderEmailAccessToken,
  verifyOrderEmailAccessToken,
} from "./order-email-access.ts";

const firstOrder = "00000000-0000-4000-8000-000000000001";
const secondOrder = "00000000-0000-4000-8000-000000000002";
const tokenHash = "a".repeat(64);

describe("stable order email access", () => {
  it("is stable across repeated notifications and has no payment data", () => {
    const first = issueOrderEmailAccessToken(firstOrder, tokenHash);
    const second = issueOrderEmailAccessToken(firstOrder, tokenHash);
    assert.equal(first, second);
    assert.doesNotMatch(first, /payment|mercadopago|session/i);
  });

  it("accepts the matching order regardless of business state", () => {
    const token = issueOrderEmailAccessToken(firstOrder, tokenHash);
    for (const _state of ["pending", "approved", "rejected", "cancelled", "refunded", "charged_back", "completed"]) {
      assert.equal(verifyOrderEmailAccessToken(token, firstOrder, tokenHash), true);
    }
  });

  it("rejects another order, another order secret and invalid tokens", () => {
    const token = issueOrderEmailAccessToken(firstOrder, tokenHash);
    assert.equal(verifyOrderEmailAccessToken(token, secondOrder, tokenHash), false);
    assert.equal(verifyOrderEmailAccessToken(token, firstOrder, "b".repeat(64)), false);
    assert.equal(verifyOrderEmailAccessToken("em1.invalid", firstOrder, tokenHash), false);
  });
});
