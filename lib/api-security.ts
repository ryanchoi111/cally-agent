import { NextResponse } from "next/server";

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const rateLimitStore = new Map<string, RateLimitEntry>();
const cleanupIntervalMs = 60_000;
let lastCleanupAt = 0;

export function clientIp(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export function checkRateLimit({
  key,
  limit,
  windowMs
}: {
  key: string;
  limit: number;
  windowMs: number;
}) {
  const now = Date.now();

  if (now - lastCleanupAt > cleanupIntervalMs) {
    lastCleanupAt = now;
    for (const [entryKey, entry] of rateLimitStore) {
      if (entry.resetAt <= now) {
        rateLimitStore.delete(entryKey);
      }
    }
  }

  const current = rateLimitStore.get(key);
  if (!current || current.resetAt <= now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }

  current.count += 1;
  if (current.count <= limit) {
    return null;
  }

  return NextResponse.json(
    { error: "Too many requests. Please try again shortly." },
    {
      status: 429,
      headers: {
        "Retry-After": String(Math.ceil((current.resetAt - now) / 1000))
      }
    }
  );
}

export async function readJsonBody<T>(request: Request, maxBytes: number) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new Error("Request body is too large");
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) {
    throw new Error("Request body is too large");
  }

  if (!text.trim()) {
    throw new Error("Request body is required");
  }

  return JSON.parse(text) as T;
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function logApiError(context: string, error: unknown) {
  console.error(context, error);
}

export function serverError(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

export function isNonEmptyString(value: unknown, maxLength = 2_000): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

export function isOptionalString(value: unknown, maxLength = 10_000) {
  return value === undefined || (typeof value === "string" && value.length <= maxLength);
}

export function isStringArray(value: unknown, maxItems = 50, maxLength = 320): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maxItems &&
    value.every((item) => typeof item === "string" && item.length <= maxLength)
  );
}

export function isIsoLikeDateTime(value: unknown) {
  return (
    typeof value === "string" &&
    value.length <= 40 &&
    /^\d{4}-\d{2}-\d{2}(?:T.+)?$/.test(value)
  );
}
