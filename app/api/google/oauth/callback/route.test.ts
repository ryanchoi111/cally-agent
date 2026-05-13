import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const exchangeCodeForRefreshToken = vi.hoisted(() => vi.fn());
const storeGoogleRefreshToken = vi.hoisted(() => vi.fn());
const verifyOAuthState = vi.hoisted(() => vi.fn());
const updateUserCalendarConnection = vi.hoisted(() => vi.fn());

vi.mock("@/lib/google-calendar-server", () => ({
  exchangeCodeForRefreshToken,
  storeGoogleRefreshToken
}));

vi.mock("@/lib/oauth-state", () => ({
  verifyOAuthState
}));

vi.mock("@/lib/user-profile-server", () => ({
  updateUserCalendarConnection
}));

import { GET } from "./route";

describe("GET /api/google/oauth/callback", () => {
  beforeEach(() => {
    vi.stubEnv("APP_ORIGIN", "https://cally-agent.vercel.app");
    exchangeCodeForRefreshToken.mockReset();
    storeGoogleRefreshToken.mockReset();
    verifyOAuthState.mockReset();
    updateUserCalendarConnection.mockReset();
    verifyOAuthState.mockReturnValue({ uid: "user-1", exp: Date.now() + 60_000 });
    exchangeCodeForRefreshToken.mockResolvedValue({
      refresh_token: "refresh-token",
      scope: "calendar"
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("redirects to the canonical app origin after a successful callback", async () => {
    const response = await GET(
      new Request("https://evil.example/api/google/oauth/callback?code=abc&state=signed")
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://cally-agent.vercel.app/?calendar=connected"
    );
    expect(storeGoogleRefreshToken).toHaveBeenCalledWith("user-1", {
      refresh_token: "refresh-token",
      scope: "calendar"
    });
    expect(updateUserCalendarConnection).toHaveBeenCalledWith("user-1", true);
  });

  it("redirects callback errors to the canonical app origin", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    verifyOAuthState.mockImplementation(() => {
      throw new Error("provider detail");
    });

    const response = await GET(
      new Request("https://evil.example/api/google/oauth/callback?code=abc&state=bad")
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://cally-agent.vercel.app/?calendar=error"
    );
    expect(console.error).toHaveBeenCalled();
  });
});
