import type {
  AgentChatResponse,
  CalendarEvent,
  CalendarEventDraft
} from "@/lib/types";
import { readErrorMessage, readJsonResponse } from "@/app/home/utils/http";

async function parseOkBody<T>(response: Response, fallbackError: string) {
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, fallbackError));
  }

  const body = await readJsonResponse<T>(response);
  if (!body) {
    throw new Error("Response was empty or invalid.");
  }

  return body;
}

export async function fetchCalendarEvents(input: {
  idToken: string;
  timeMin: string;
  timeMax: string;
}) {
  const response = await fetch("/api/calendar/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  const body = await parseOkBody<{ events?: CalendarEvent[] }>(
    response,
    "Unable to load calendar events."
  );
  if (!Array.isArray(body.events)) {
    throw new Error("Calendar events response was empty or invalid.");
  }

  return body.events;
}

export async function syncUserProfile(input: {
  idToken: string;
  timezone: string;
  locale: string;
}) {
  const response = await fetch("/api/users/me", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  await parseOkBody<{ user: unknown }>(response, "Unable to sync user profile.");
}

export async function startGoogleCalendarConnection(idToken: string) {
  const response = await fetch("/api/google/oauth/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken })
  });

  const body = await parseOkBody<{ authUrl?: string }>(
    response,
    "Unable to start Google Calendar connection."
  );
  if (!body.authUrl) {
    throw new Error("Google Calendar connection response was empty or invalid.");
  }

  return body.authUrl;
}

export async function checkGoogleCalendarConnection(idToken: string) {
  const response = await fetch("/api/google/oauth/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken })
  });

  if (!response.ok) {
    return false;
  }

  const body = await readJsonResponse<{ connected?: boolean }>(response);
  return body?.connected === true;
}

export async function askCalendarAgent(payload: {
  idToken: string;
  messages: unknown;
  calendarContext: unknown;
  clientContext: unknown;
  conversationState: unknown;
}) {
  const response = await fetch("/api/agent/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  return parseOkBody<AgentChatResponse>(response, "Unable to contact the calendar agent.");
}

export async function createCalendarEvent(input: {
  idToken: string;
  event: CalendarEventDraft;
}) {
  const response = await fetch("/api/calendar/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  const body = await parseOkBody<{ event?: CalendarEvent }>(
    response,
    "Unable to create calendar event."
  );
  if (!body.event) {
    throw new Error("Create event response was empty or invalid.");
  }

  return body.event;
}

export async function deleteCalendarEvent(input: { idToken: string; eventId: string }) {
  const response = await fetch("/api/calendar/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Unable to delete calendar event."));
  }
}

export async function editCalendarEvent(input: {
  idToken: string;
  eventId: string;
  updates: Partial<CalendarEventDraft>;
}) {
  const response = await fetch("/api/calendar/edit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  const body = await parseOkBody<{ event?: CalendarEvent }>(
    response,
    "Unable to edit calendar event."
  );
  if (!body.event) {
    throw new Error("Edit event response was empty or invalid.");
  }

  return body.event;
}
