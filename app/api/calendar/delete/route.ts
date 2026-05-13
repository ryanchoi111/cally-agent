import { NextResponse } from "next/server";
import {
  badRequest,
  checkRateLimit,
  clientIp,
  isNonEmptyString,
  logApiError,
  readJsonBody
} from "@/lib/api-security";
import { verifyFirebaseIdToken } from "@/lib/firebase-admin";
import { getGoogleAccessToken } from "@/lib/google-calendar-server";

type DeleteEventRequest = {
  idToken?: string;
  eventId?: string;
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

export async function POST(request: Request) {
  let body: DeleteEventRequest;

  try {
    body = await readJsonBody<DeleteEventRequest>(request, 16_384);
  } catch {
    return badRequest("A valid JSON request body is required.");
  }

  if (!isNonEmptyString(body.idToken, 4_096) || !isNonEmptyString(body.eventId, 1_000)) {
    return NextResponse.json(
      { error: "idToken and eventId are required" },
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

  try {
    const decoded = await verifyFirebaseIdToken(body.idToken);
    const limitResponse = checkRateLimit({
      key: `calendar-delete:${decoded.uid}:${clientIp(request)}`,
      limit: 30,
      windowMs: 60_000
    });
    if (limitResponse) {
      return limitResponse;
    }

    const accessToken = await getGoogleAccessToken(decoded.uid);
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
        parsed.calendarId
      )}/events/${encodeURIComponent(parsed.eventId)}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    if (!response.ok && response.status !== 410) {
      const errorText = await response.text();
      console.error("Google Calendar delete failed:", errorText);
      return NextResponse.json(
        { error: "Unable to delete Google Calendar event" },
        { status: response.status }
      );
    }

    return NextResponse.json({ deletedEventId: body.eventId });
  } catch (error) {
    logApiError("Calendar event delete failed:", error);
    return NextResponse.json(
      { error: "Unable to delete Google Calendar event" },
      { status: 502 }
    );
  }
}
