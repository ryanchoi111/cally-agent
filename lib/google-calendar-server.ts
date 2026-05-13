import { getAdminDb } from "@/lib/firebase-admin";
import { decryptSecret, encryptSecret } from "@/lib/server-crypto";

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type StoredGoogleToken = {
  refreshToken: string;
  scope?: string;
  updatedAt: string;
};

const tokenCollection = "googleCalendarTokens";
const firestoreNotFoundMessage =
  "Firestore database was not found. Create a Cloud Firestore database in this Firebase project and make sure FIREBASE_SERVICE_ACCOUNT_JSON points to the same project.";

function isFirestoreNotFound(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 5
  );
}

function normalizeFirestoreError(error: unknown): never {
  if (isFirestoreNotFound(error)) {
    throw new Error(firestoreNotFoundMessage);
  }

  throw error;
}

function googleClientConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Google OAuth environment variables are not configured");
  }

  return { clientId, clientSecret, redirectUri };
}

export function calendarScopes() {
  return [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly"
  ];
}

export function buildGoogleAuthUrl(state: string) {
  const { clientId, redirectUri } = googleClientConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: calendarScopes().join(" "),
    state
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForRefreshToken(code: string) {
  const { clientId, clientSecret, redirectUri } = googleClientConfig();

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    })
  });

  const body = (await response.json()) as TokenResponse;

  if (!response.ok || !body.refresh_token) {
    throw new Error(body.error_description ?? body.error ?? "Google did not return a refresh token");
  }

  return body;
}

export async function storeGoogleRefreshToken(uid: string, token: TokenResponse) {
  if (!token.refresh_token) {
    throw new Error("Refresh token is required");
  }

  try {
    await getAdminDb()
      .collection(tokenCollection)
      .doc(uid)
      .set(
        {
          refreshToken: encryptSecret(token.refresh_token),
          scope: token.scope,
          updatedAt: new Date().toISOString()
        } satisfies StoredGoogleToken,
        { merge: true }
      );
  } catch (error) {
    normalizeFirestoreError(error);
  }
}

export async function getGoogleAccessToken(uid: string) {
  let snapshot;

  try {
    snapshot = await getAdminDb().collection(tokenCollection).doc(uid).get();
  } catch (error) {
    normalizeFirestoreError(error);
  }

  if (!snapshot.exists) {
    throw new Error("Google Calendar is not connected for this user");
  }

  const stored = snapshot.data() as StoredGoogleToken;
  const refreshToken = decryptSecret(stored.refreshToken);
  const { clientId, clientSecret } = googleClientConfig();

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });

  const body = (await response.json()) as TokenResponse;

  if (!response.ok || !body.access_token) {
    throw new Error(body.error_description ?? body.error ?? "Unable to refresh Google access token");
  }

  return body.access_token;
}

export async function hasGoogleCalendarConnection(uid: string) {
  try {
    const snapshot = await getAdminDb().collection(tokenCollection).doc(uid).get();
    return snapshot.exists;
  } catch (error) {
    normalizeFirestoreError(error);
  }
}
