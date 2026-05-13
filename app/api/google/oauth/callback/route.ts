import { NextResponse } from "next/server";
import {
  exchangeCodeForRefreshToken,
  storeGoogleRefreshToken
} from "@/lib/google-calendar-server";
import { verifyOAuthState } from "@/lib/oauth-state";
import { updateUserCalendarConnection } from "@/lib/user-profile-server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const origin = url.origin;

  if (!code || !state) {
    return NextResponse.redirect(`${origin}/?calendar=error`);
  }

  try {
    const payload = verifyOAuthState(state);
    const token = await exchangeCodeForRefreshToken(code);
    await storeGoogleRefreshToken(payload.uid, token);
    await updateUserCalendarConnection(payload.uid, true);

    return NextResponse.redirect(`${origin}/?calendar=connected`);
  } catch (error) {
    console.error("Google OAuth callback failed:", error);
    return NextResponse.redirect(`${origin}/?calendar=error`);
  }
}
