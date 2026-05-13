import { afterEach, describe, expect, it, vi } from "vitest";
import { appOrigin, appRedirectUrl } from "./app-origin";

describe("app origin helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses a configured canonical origin instead of the request origin", () => {
    vi.stubEnv("APP_ORIGIN", "https://cally-agent.vercel.app/some-path");

    expect(appOrigin("https://evil.example/api/google/oauth/callback")).toBe(
      "https://cally-agent.vercel.app"
    );
    expect(
      appRedirectUrl("https://evil.example/api/google/oauth/callback", "/?calendar=connected")
    ).toBe("https://cally-agent.vercel.app/?calendar=connected");
  });

  it("requires a configured origin in production", () => {
    vi.stubEnv("APP_ORIGIN", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("NODE_ENV", "production");

    expect(() => appOrigin("https://cally-agent.vercel.app")).toThrow(
      "APP_ORIGIN is required in production"
    );
  });
});
