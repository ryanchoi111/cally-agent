import { NextResponse } from "next/server";
import {
  badRequest,
  checkRateLimit,
  clientIp,
  isNonEmptyString,
  readJsonBody
} from "@/lib/api-security";
import { verifyFirebaseIdToken } from "@/lib/firebase-admin";
import { buildGoogleAuthUrl } from "@/lib/google-calendar-server";
import { createOAuthState } from "@/lib/oauth-state";

type StartRequest = {
  idToken?: string;
};

export async function POST(request: Request) {
  let body: StartRequest;

  try {
    body = await readJsonBody<StartRequest>(request, 16_384);
  } catch {
    return badRequest("A valid JSON request body is required.");
  }

  if (!isNonEmptyString(body.idToken, 4_096)) {
    return badRequest("idToken is required.");
  }

  const decoded = await verifyFirebaseIdToken(body.idToken);
  const limitResponse = checkRateLimit({
    key: `oauth-start:${decoded.uid}:${clientIp(request)}`,
    limit: 10,
    windowMs: 60_000
  });
  if (limitResponse) {
    return limitResponse;
  }

  const state = createOAuthState(decoded.uid);

  return NextResponse.json({
    authUrl: buildGoogleAuthUrl(state)
  });
}
