import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOAuthState, verifyOAuthState } from "./oauth-state";

describe("OAuth state", () => {
  beforeEach(() => {
    vi.stubEnv("OAUTH_STATE_SECRET", "test-oauth-state-secret");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-13T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("round-trips a signed state payload", () => {
    const state = createOAuthState("user-1");

    expect(verifyOAuthState(state)).toEqual({
      uid: "user-1",
      exp: new Date("2026-05-13T12:10:00Z").getTime()
    });
  });

  it("rejects tampered signatures without throwing a length mismatch error", () => {
    const [payload] = createOAuthState("user-1").split(".");

    expect(() => verifyOAuthState(`${payload}.short`)).toThrow(
      "OAuth state signature is invalid"
    );
  });

  it("rejects expired state values", () => {
    const state = createOAuthState("user-1");

    vi.setSystemTime(new Date("2026-05-13T12:11:00Z"));

    expect(() => verifyOAuthState(state)).toThrow("OAuth state has expired");
  });
});
