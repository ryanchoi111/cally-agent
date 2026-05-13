export function appOrigin(requestUrl?: string) {
  const configuredOrigin = process.env.APP_ORIGIN ?? process.env.NEXT_PUBLIC_APP_URL;

  if (configuredOrigin) {
    return new URL(configuredOrigin).origin;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_ORIGIN is required in production");
  }

  if (!requestUrl) {
    return "http://localhost:3000";
  }

  return new URL(requestUrl).origin;
}

export function appRedirectUrl(requestUrl: string, pathAndQuery: string) {
  return `${appOrigin(requestUrl)}${pathAndQuery}`;
}
