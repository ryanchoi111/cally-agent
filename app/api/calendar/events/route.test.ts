import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const verifyFirebaseIdToken = vi.hoisted(() => vi.fn());
const getGoogleAccessToken = vi.hoisted(() => vi.fn());

vi.mock("@/lib/firebase-admin", () => ({
  verifyFirebaseIdToken
}));

vi.mock("@/lib/google-calendar-server", () => ({
  getGoogleAccessToken
}));

import { POST } from "./route";

function calendarEventsRequest(body: unknown) {
  return new Request("http://localhost/api/calendar/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function postCalendarEvents(body: unknown) {
  const response = await POST(calendarEventsRequest(body));

  return {
    status: response.status,
    body: await response.json()
  };
}

describe("POST /api/calendar/events", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    verifyFirebaseIdToken.mockReset();
    getGoogleAccessToken.mockReset();
    verifyFirebaseIdToken.mockResolvedValue({ uid: `user-${crypto.randomUUID()}` });
    getGoogleAccessToken.mockResolvedValue("google-access-token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("redacts Google provider details when an event fetch fails", async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          items: [{ id: "primary", summary: "Private Calendar" }]
        })
      )
      .mockResolvedValueOnce(
        new Response("secret google provider details", { status: 403 })
      );

    const response = await postCalendarEvents({
      idToken: "firebase-token",
      timeMin: "2026-05-01T00:00:00.000Z",
      timeMax: "2026-05-31T23:59:59.999Z"
    });

    expect(response.status).toBe(502);
    expect(response.body).toEqual({ error: "Unable to load Google Calendar events" });
    expect(JSON.stringify(response.body)).not.toContain("secret google provider details");
    expect(JSON.stringify(response.body)).not.toContain("Private Calendar");
  });

  it("returns stable client-safe JSON when token lookup fails", async () => {
    getGoogleAccessToken.mockRejectedValue(new Error("refresh token decrypt failed"));

    const response = await postCalendarEvents({
      idToken: "firebase-token",
      timeMin: "2026-05-01T00:00:00.000Z",
      timeMax: "2026-05-31T23:59:59.999Z"
    });

    expect(response.status).toBe(502);
    expect(response.body).toEqual({ error: "Unable to load Google Calendar events" });
  });
});
