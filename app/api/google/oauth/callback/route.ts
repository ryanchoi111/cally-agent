import { NextResponse } from "next/server";
import {
  exchangeCodeForRefreshToken,
  storeGoogleRefreshToken
} from "@/lib/google-calendar-server";
import { appRedirectUrl } from "@/lib/app-origin";
import { verifyOAuthState } from "@/lib/oauth-state";
import { updateUserCalendarConnection } from "@/lib/user-profile-server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) {
    return NextResponse.redirect(appRedirectUrl(request.url, "/?calendar=error"));
  }

  try {
    const payload = verifyOAuthState(state);
    const token = await exchangeCodeForRefreshToken(code);
    await storeGoogleRefreshToken(payload.uid, token);
    await updateUserCalendarConnection(payload.uid, true);

    return NextResponse.redirect(appRedirectUrl(request.url, "/?calendar=connected"));
  } catch (error) {
    console.error("Google OAuth callback failed:", error);
    return NextResponse.redirect(appRedirectUrl(request.url, "/?calendar=error"));
  }
}
