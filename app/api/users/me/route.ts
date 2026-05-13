import { NextResponse } from "next/server";
import {
  badRequest,
  checkRateLimit,
  clientIp,
  isNonEmptyString,
  isOptionalString,
  readJsonBody
} from "@/lib/api-security";
import { verifyFirebaseIdToken } from "@/lib/firebase-admin";
import { upsertUserProfile } from "@/lib/user-profile-server";
import type { CalendarView } from "@/lib/types";

type UserProfileRequest = {
  idToken?: string;
  timezone?: string;
  locale?: string;
  defaultView?: CalendarView;
  touchLogin?: boolean;
};

export async function POST(request: Request) {
  let body: UserProfileRequest;

  try {
    body = await readJsonBody<UserProfileRequest>(request, 16_384);
  } catch {
    return badRequest("A valid JSON request body is required.");
  }

  if (
    !isNonEmptyString(body.idToken, 4_096) ||
    !isOptionalString(body.timezone, 128) ||
    !isOptionalString(body.locale, 64) ||
    (body.defaultView !== undefined &&
      !["day", "week", "month", "year"].includes(body.defaultView)) ||
    (body.touchLogin !== undefined && typeof body.touchLogin !== "boolean")
  ) {
    return badRequest("Invalid user profile request.");
  }

  try {
    const decoded = await verifyFirebaseIdToken(body.idToken);
    const limitResponse = checkRateLimit({
      key: `users-me:${decoded.uid}:${clientIp(request)}`,
      limit: 60,
      windowMs: 60_000
    });
    if (limitResponse) {
      return limitResponse;
    }

    const profile = await upsertUserProfile(decoded, {
      timezone: body.timezone,
      locale: body.locale,
      defaultView: body.defaultView,
      touchLogin: body.touchLogin
    });

    return NextResponse.json({ user: profile });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to update user profile"
      },
      { status: 500 }
    );
  }
}
