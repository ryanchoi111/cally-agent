import type { DecodedIdToken } from "firebase-admin/auth";
import { getAdminDb } from "@/lib/firebase-admin";
import type { CalendarView, UserProfile } from "@/lib/types";

const usersCollection = "users";

type UpsertUserProfileInput = {
  timezone?: string;
  locale?: string;
  defaultView?: CalendarView;
  touchLogin?: boolean;
};

function nowIso() {
  return new Date().toISOString();
}

function decodedStringClaim(decoded: DecodedIdToken, key: string) {
  const value = decoded[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function userProfileRef(uid: string) {
  return getAdminDb().collection(usersCollection).doc(uid);
}

function withoutUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  ) as T;
}

export async function upsertUserProfile(
  decoded: DecodedIdToken,
  input: UpsertUserProfileInput = {}
) {
  const uid = decoded.uid;
  const timestamp = nowIso();
  const ref = userProfileRef(uid);
  const snapshot = await ref.get();
  const current = snapshot.exists ? (snapshot.data() as Partial<UserProfile>) : undefined;
  const defaultView = input.defaultView ?? current?.preferences?.defaultView ?? "month";

  const profile: UserProfile = {
    uid,
    email: decoded.email,
    displayName: decodedStringClaim(decoded, "name"),
    photoURL: decodedStringClaim(decoded, "picture"),
    timezone: input.timezone ?? current?.timezone,
    locale: input.locale ?? current?.locale,
    calendarConnected: current?.calendarConnected ?? false,
    defaultCalendarId: current?.defaultCalendarId,
    preferences: {
      ...current?.preferences,
      defaultView
    },
    createdAt: current?.createdAt ?? timestamp,
    updatedAt: timestamp,
    lastLoginAt: input.touchLogin === false ? current?.lastLoginAt ?? timestamp : timestamp,
    calendarConnectedAt: current?.calendarConnectedAt
  };

  await ref.set(withoutUndefined(profile), { merge: true });

  return profile;
}

export async function updateUserCalendarConnection(uid: string, connected: boolean) {
  const timestamp = nowIso();
  const ref = userProfileRef(uid);
  const snapshot = await ref.get();
  const current = snapshot.exists ? (snapshot.data() as Partial<UserProfile>) : undefined;

  await ref.set(
    withoutUndefined({
      uid,
      calendarConnected: connected,
      calendarConnectedAt: connected ? timestamp : current?.calendarConnectedAt,
      createdAt: current?.createdAt ?? timestamp,
      updatedAt: timestamp,
      lastLoginAt: current?.lastLoginAt ?? timestamp,
      preferences: {
        defaultView: current?.preferences?.defaultView ?? "month"
      }
    } satisfies Partial<UserProfile>),
    { merge: true }
  );
}
