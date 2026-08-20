import { describe, expect, it } from "vitest";
import { identityFromClaims } from "../src/worker/auth/google";
import { canEdit, canManageMembers } from "../src/worker/permissions";
import { createSessionToken, hashSessionToken } from "../src/worker/security";

describe("authorization rules", () => {
  it("lets owners manage access and editors only edit content", () => {
    expect(canEdit("owner")).toBe(true);
    expect(canEdit("editor")).toBe(true);
    expect(canEdit("viewer")).toBe(false);
    expect(canManageMembers("owner")).toBe(true);
    expect(canManageMembers("editor")).toBe(false);
  });
});

describe("Google identity mapping", () => {
  it("uses sub as identity and normalizes a verified email", () => {
    expect(identityFromClaims({
      sub: "google-stable-sub",
      email: " Person@Example.COM ",
      email_verified: true,
      name: "Ada",
    })).toMatchObject({ sub: "google-stable-sub", email: "person@example.com", name: "Ada" });
  });

  it("rejects unverified email claims", () => {
    expect(() => identityFromClaims({ sub: "sub", email: "a@example.com", email_verified: false })).toThrow(
      "not verified",
    );
  });
});

describe("session tokens", () => {
  it("creates random opaque tokens and stable non-plaintext hashes", async () => {
    const first = createSessionToken();
    const second = createSessionToken();
    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThan(40);
    expect(await hashSessionToken(first)).not.toBe(first);
    expect(await hashSessionToken(first)).toBe(await hashSessionToken(first));
  });
});
