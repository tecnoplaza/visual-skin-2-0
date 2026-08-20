import { createHmac, timingSafeEqual } from "node:crypto";

const VERSION = "em1";

function signature(orderId: string, publicAccessTokenHash: string): string {
  return createHmac("sha256", publicAccessTokenHash)
    .update(`visualskin:order-email-access:${orderId}`, "utf8")
    .digest("base64url");
}

export function issueOrderEmailAccessToken(
  orderId: string,
  publicAccessTokenHash: string,
): string {
  return `${VERSION}.${signature(orderId, publicAccessTokenHash)}`;
}

export function verifyOrderEmailAccessToken(
  token: string,
  orderId: string,
  publicAccessTokenHash: string,
): boolean {
  const expected = issueOrderEmailAccessToken(orderId, publicAccessTokenHash);
  const actualBytes = Buffer.from(token, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}
