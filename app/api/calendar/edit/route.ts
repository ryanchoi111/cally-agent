import { addDays, format, parseISO } from "date-fns";
import { NextResponse } from "next/server";
import {
  badRequest,
  checkRateLimit,
  clientIp,
  isIsoLikeDateTime,
  isNonEmptyString,
  isOptionalString,
  isStringArray,
  readJsonBody
} from "@/lib/api-security";
import { verifyFirebaseIdToken } from "@/lib/firebase-admin";
import { getGoogleAccessToken } from "@/lib/google-calendar-server";
import type { CalendarEvent, CalendarEventDraft } from "@/lib/types";

type EditEventRequest = {
  idToken?: string;
  eventId?: string;
  updates?: Partial<CalendarEventDraft>;
};

type GoogleEvent = {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  attendees?: {
    email?: string;
    displayName?: string;
    responseStatus?: string;
    optional?: boolean;
  }[];
  creator?: {
    email?: string;
    displayName?: string;
  };
  organizer?: {
    email?: string;
    displayName?: string;
  };
};

function parseCalendarEventId(id: string) {
  const separatorIndex = id.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === id.length - 1) {
    return null;
  }

  return {
    calendarId: id.slice(0, separatorIndex),
    eventId: id.slice(separatorIndex + 1)
  };
}

function dateOnly(value: string) {
  return value.includes("T") ? value.slice(0, 10) : value;
}

function normalizeAllDayEnd(start: string, end: string) {
  const startDate = parseISO(dateOnly(start));
  const endDate = parseISO(dateOnly(end));

  if (endDate <= startDate) {
    return format(addDays(startDate, 1), "yyyy-MM-dd");
  }

  return format(endDate, "yyyy-MM-dd");
}

function normalizeGoogleEvent(
  calendarId: string,
  calendarName: string,
  googleEvent: GoogleEvent
): CalendarEvent {
  return {
    id: `${calendarId}:${googleEvent.id}`,
    title: googleEvent.summary || "Untitled event",
    start: googleEvent.start?.dateTime ?? `${googleEvent.start?.date}T00:00:00`,
    end: googleEvent.end?.dateTime ?? `${googleEvent.end?.date}T00:00:00`,
    allDay: Boolean(googleEvent.start?.date),
    calendarName,
    color: "#56c2ff",
    description: googleEvent.description || undefined,
    location: googleEvent.location || undefined,
    attendees: googleEvent.attendees
      ?.filter((attendee) => attendee.email)
      .map((attendee) => ({
        email: attendee.email!,
        name: attendee.displayName || undefined,
        responseStatus: attendee.responseStatus || undefined,
        optional: attendee.optional || undefined
      })),
    creator: googleEvent.creator?.displayName ?? googleEvent.creator?.email ?? undefined,
    organizer: googleEvent.organizer?.displayName ?? googleEvent.organizer?.email ?? undefined,
    htmlLink: googleEvent.htmlLink || undefined
  };
}

function isValidEventUpdates(value: unknown): value is Partial<CalendarEventDraft> {
  if (!value || typeof value !== "object") {
    return false;
  }

  const updates = value as Partial<CalendarEventDraft>;
  const hasAllowedUpdate =
    updates.title !== undefined ||
    updates.description !== undefined ||
    updates.location !== undefined ||
    updates.attendees !== undefined ||
    updates.start !== undefined ||
    updates.end !== undefined;

  return (
    hasAllowedUpdate &&
    (updates.title === undefined || isNonEmptyString(updates.title, 500)) &&
    isOptionalString(updates.description) &&
    isOptionalString(updates.location, 1_000) &&
    (updates.attendees === undefined || isStringArray(updates.attendees, 50, 320)) &&
    (updates.start === undefined || isIsoLikeDateTime(updates.start)) &&
    (updates.end === undefined || isIsoLikeDateTime(updates.end)) &&
    (updates.allDay === undefined || typeof updates.allDay === "boolean")
  );
}

export async function POST(request: Request) {
  let body: EditEventRequest;

  try {
    body = await readJsonBody<EditEventRequest>(request, 64_000);
  } catch {
    return badRequest("A valid JSON request body is required.");
  }

  if (
    !isNonEmptyString(body.idToken, 4_096) ||
    !isNonEmptyString(body.eventId, 1_000) ||
    !isValidEventUpdates(body.updates)
  ) {
    return NextResponse.json(
      { error: "idToken, eventId, and updates are required" },
      { status: 400 }
    );
  }

  const parsed = parseCalendarEventId(body.eventId);
  if (!parsed) {
    return NextResponse.json(
      { error: "eventId must include calendar id and Google event id" },
      { status: 400 }
    );
  }

  const decoded = await verifyFirebaseIdToken(body.idToken);
  const limitResponse = checkRateLimit({
    key: `calendar-edit:${decoded.uid}:${clientIp(request)}`,
    limit: 30,
    windowMs: 60_000
  });
  if (limitResponse) {
    return limitResponse;
  }

  const accessToken = await getGoogleAccessToken(decoded.uid);
  const patchBody: Record<string, unknown> = {};

  if (body.updates.title !== undefined) {
    patchBody.summary = body.updates.title;
  }

  if (body.updates.description !== undefined) {
    patchBody.description = body.updates.description || null;
  }

  if (body.updates.location !== undefined) {
    patchBody.location = body.updates.location || null;
  }

  if (body.updates.attendees !== undefined) {
    patchBody.attendees = body.updates.attendees.map((email) => ({ email }));
  }

  if (body.updates.start && body.updates.end) {
    patchBody.start = body.updates.allDay
      ? { date: dateOnly(body.updates.start) }
      : { dateTime: body.updates.start };
    patchBody.end = body.updates.allDay
      ? { date: normalizeAllDayEnd(body.updates.start, body.updates.end) }
      : { dateTime: body.updates.end };
  }

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      parsed.calendarId
    )}/events/${encodeURIComponent(parsed.eventId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(patchBody)
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Google Calendar edit failed:", errorText);
    return NextResponse.json(
      { error: "Unable to edit Google Calendar event" },
      { status: response.status }
    );
  }

  const edited = (await response.json()) as GoogleEvent;
  return NextResponse.json({
    event: normalizeGoogleEvent(parsed.calendarId, parsed.calendarId, edited)
  });
}
