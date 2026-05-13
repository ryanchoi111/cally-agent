import { NextResponse } from "next/server";
import {
  badRequest,
  checkRateLimit,
  clientIp,
  isIsoLikeDateTime,
  isNonEmptyString,
  readJsonBody
} from "@/lib/api-security";
import { verifyFirebaseIdToken } from "@/lib/firebase-admin";
import { getGoogleAccessToken } from "@/lib/google-calendar-server";
import type { CalendarEvent } from "@/lib/types";

type CalendarRequest = {
  idToken?: string;
  timeMin?: string;
  timeMax?: string;
};

type GoogleCalendarListEntry = {
  id: string;
  summary?: string;
  backgroundColor?: string;
  foregroundColor?: string;
  primary?: boolean;
  selected?: boolean;
};

type GoogleEvent = {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  colorId?: string;
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
type GoogleEventsResponse = {
  items?: GoogleEvent[];
  nextPageToken?: string;
};

const FALLBACK_COLORS = [
  "#7dd3fc",
  "#f9a8d4",
  "#86efac",
  "#fde68a",
  "#c4b5fd",
  "#fdba74"
];

export async function POST(request: Request) {
  let body: CalendarRequest;

  try {
    body = await readJsonBody<CalendarRequest>(request, 16_384);
  } catch {
    return badRequest("A valid JSON request body is required.");
  }

  if (
    !isNonEmptyString(body.idToken, 4_096) ||
    !isIsoLikeDateTime(body.timeMin) ||
    !isIsoLikeDateTime(body.timeMax)
  ) {
    return NextResponse.json(
      { error: "idToken, timeMin, and timeMax are required" },
      { status: 400 }
    );
  }

  try {
    const decoded = await verifyFirebaseIdToken(body.idToken);
    const limitResponse = checkRateLimit({
      key: `calendar-events:${decoded.uid}:${clientIp(request)}`,
      limit: 12,
      windowMs: 60_000
    });
    if (limitResponse) {
      return limitResponse;
    }

    const accessToken = await getGoogleAccessToken(decoded.uid);

    const authHeaders = {
      Authorization: `Bearer ${accessToken}`
    };

    const calendarListResponse = await fetch(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList",
      { headers: authHeaders }
    );

    if (!calendarListResponse.ok) {
      return NextResponse.json(
        { error: "Unable to read Google Calendar list" },
        { status: calendarListResponse.status }
      );
    }

    const calendarList = (await calendarListResponse.json()) as {
      items?: GoogleCalendarListEntry[];
    };

    const calendars = (calendarList.items ?? []).filter(
      (calendar) => calendar.selected !== false
    );

    const results = await Promise.all(
      calendars.map(async (calendar, index) => {
        const color =
          calendar.backgroundColor ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
        const googleEvents: GoogleEvent[] = [];
        let pageToken: string | undefined;

        do {
          const params = new URLSearchParams({
            singleEvents: "true",
            orderBy: "startTime",
            timeMin: body.timeMin!,
            timeMax: body.timeMax!,
            maxResults: "2500"
          });

          if (pageToken) {
            params.set("pageToken", pageToken);
          }

          const eventsResponse = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
              calendar.id
            )}/events?${params.toString()}`,
            { headers: authHeaders }
          );

          if (!eventsResponse.ok) {
            const errorText = await eventsResponse.text();
            throw new Error(
              `Unable to read events for ${calendar.summary ?? calendar.id}: ${errorText}`
            );
          }

          const eventsBody = (await eventsResponse.json()) as GoogleEventsResponse;
          googleEvents.push(...(eventsBody.items ?? []));
          pageToken = eventsBody.nextPageToken;
        } while (pageToken);

        return googleEvents
          .filter((event) => event.start && event.end)
          .map<CalendarEvent>((event) => {
            const allDay = Boolean(event.start?.date);
            return {
              id: `${calendar.id}:${event.id}`,
              title: event.summary || "Untitled event",
              start: event.start?.dateTime ?? `${event.start?.date}T00:00:00`,
              end: event.end?.dateTime ?? `${event.end?.date}T00:00:00`,
              allDay,
              calendarName: calendar.summary ?? "Calendar",
              color,
              description: event.description || undefined,
              location: event.location || undefined,
              attendees: event.attendees
                ?.filter((attendee) => attendee.email)
                .map((attendee) => ({
                  email: attendee.email!,
                  name: attendee.displayName || undefined,
                  responseStatus: attendee.responseStatus || undefined,
                  optional: attendee.optional || undefined
                })),
              creator:
                event.creator?.displayName ?? event.creator?.email ?? undefined,
              organizer:
                event.organizer?.displayName ?? event.organizer?.email ?? undefined,
              htmlLink: event.htmlLink || undefined
            };
          });
      })
    );

    const events = results.flat().sort((a, b) => {
      return new Date(a.start).getTime() - new Date(b.start).getTime();
    });

    return NextResponse.json({ events });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load Google Calendar events"
      },
      { status: 502 }
    );
  }
}
