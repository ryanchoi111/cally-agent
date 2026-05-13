import { addDays, format, parseISO } from "date-fns";
import { NextResponse } from "next/server";
import {
  badRequest,
  checkRateLimit,
  clientIp,
  isIsoLikeDateTime,
  isNonEmptyString,
  logApiError,
  isOptionalString,
  isStringArray,
  readJsonBody
} from "@/lib/api-security";
import { verifyFirebaseIdToken } from "@/lib/firebase-admin";
import { getGoogleAccessToken } from "@/lib/google-calendar-server";
import type { CalendarEvent, CalendarEventDraft } from "@/lib/types";

type CreateEventRequest = {
  idToken?: string;
  event?: CalendarEventDraft;
};

type GoogleCreatedEvent = {
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

function isValidEventDraft(value: unknown): value is CalendarEventDraft {
  if (!value || typeof value !== "object") {
    return false;
  }

  const event = value as Partial<CalendarEventDraft>;
  return (
    isNonEmptyString(event.title, 500) &&
    isIsoLikeDateTime(event.start) &&
    isIsoLikeDateTime(event.end) &&
    typeof event.allDay === "boolean" &&
    isOptionalString(event.description) &&
    isOptionalString(event.location, 1_000) &&
    (event.attendees === undefined || isStringArray(event.attendees, 50, 320))
  );
}

export async function POST(request: Request) {
  let body: CreateEventRequest;

  try {
    body = await readJsonBody<CreateEventRequest>(request, 64_000);
  } catch {
    return badRequest("A valid JSON request body is required.");
  }

  if (!isNonEmptyString(body.idToken, 4_096) || !isValidEventDraft(body.event)) {
    return NextResponse.json(
      { error: "idToken and event are required" },
      { status: 400 }
    );
  }

  const event = body.event;
  try {
    const decoded = await verifyFirebaseIdToken(body.idToken);
    const limitResponse = checkRateLimit({
      key: `calendar-create:${decoded.uid}:${clientIp(request)}`,
      limit: 30,
      windowMs: 60_000
    });
    if (limitResponse) {
      return limitResponse;
    }

    const accessToken = await getGoogleAccessToken(decoded.uid);

    const googleEvent = {
      summary: event.title,
      description: event.description || undefined,
      location: event.location || undefined,
      attendees: event.attendees?.length
        ? event.attendees.map((email) => ({ email }))
        : undefined,
      start: event.allDay
        ? { date: dateOnly(event.start) }
        : { dateTime: event.start },
      end: event.allDay
        ? { date: normalizeAllDayEnd(event.start, event.end) }
        : { dateTime: event.end }
    };

    const response = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(googleEvent)
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Google Calendar create failed:", errorText);
      return NextResponse.json(
        { error: "Unable to create Google Calendar event" },
        { status: response.status }
      );
    }

    const created = (await response.json()) as GoogleCreatedEvent;
    const normalized: CalendarEvent = {
      id: `primary:${created.id}`,
      title: created.summary || event.title,
      start: created.start?.dateTime ?? `${created.start?.date ?? dateOnly(event.start)}T00:00:00`,
      end: created.end?.dateTime ?? `${created.end?.date ?? dateOnly(event.end)}T00:00:00`,
      allDay: Boolean(created.start?.date),
      calendarName: "Primary",
      color: "#56c2ff",
      description: created.description || event.description || undefined,
      location: created.location || event.location || undefined,
      attendees: created.attendees
        ?.filter((attendee) => attendee.email)
        .map((attendee) => ({
          email: attendee.email!,
          name: attendee.displayName || undefined,
          responseStatus: attendee.responseStatus || undefined,
          optional: attendee.optional || undefined
        })),
      creator: created.creator?.displayName ?? created.creator?.email ?? undefined,
      organizer: created.organizer?.displayName ?? created.organizer?.email ?? undefined,
      htmlLink: created.htmlLink || undefined
    };

    return NextResponse.json({ event: normalized });
  } catch (error) {
    logApiError("Calendar event create failed:", error);
    return NextResponse.json(
      { error: "Unable to create Google Calendar event" },
      { status: 502 }
    );
  }
}
