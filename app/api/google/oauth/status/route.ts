import { NextResponse } from "next/server";
import {
  badRequest,
  checkRateLimit,
  clientIp,
  isNonEmptyString,
  readJsonBody
} from "@/lib/api-security";
import { verifyFirebaseIdToken } from "@/lib/firebase-admin";
import { hasGoogleCalendarConnection } from "@/lib/google-calendar-server";
import {
  updateUserCalendarConnection,
  upsertUserProfile
} from "@/lib/user-profile-server";

type StatusRequest = {
  idToken?: string;
};

export async function POST(request: Request) {
  let body: StatusRequest;

  try {
    body = await readJsonBody<StatusRequest>(request, 16_384);
  } catch {
    return badRequest("A valid JSON request body is required.");
  }

  if (!isNonEmptyString(body.idToken, 4_096)) {
    return badRequest("idToken is required.");
  }

  try {
    const decoded = await verifyFirebaseIdToken(body.idToken);
    const limitResponse = checkRateLimit({
      key: `oauth-status:${decoded.uid}:${clientIp(request)}`,
      limit: 60,
      windowMs: 60_000
    });
    if (limitResponse) {
      return limitResponse;
    }

    await upsertUserProfile(decoded);
    const connected = await hasGoogleCalendarConnection(decoded.uid);
    await updateUserCalendarConnection(decoded.uid, connected);

    return NextResponse.json({
      connected
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to read Google Calendar connection status"
      },
      { status: 500 }
    );
  }
}
