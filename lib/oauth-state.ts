import crypto from "node:crypto";

type OAuthState = {
  uid: string;
  exp: number;
};

function stateSecret() {
  const secret =
    process.env.OAUTH_STATE_SECRET ??
    (process.env.NODE_ENV === "production" ? undefined : process.env.TOKEN_ENCRYPTION_KEY);

  if (!secret) {
    throw new Error("OAUTH_STATE_SECRET is required");
  }

  return secret;
}

function base64UrlEncode(value: string) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

export function createOAuthState(uid: string) {
  const payload: OAuthState = {
    uid,
    exp: Date.now() + 10 * 60 * 1000
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto
    .createHmac("sha256", stateSecret())
    .update(encodedPayload)
    .digest("base64url");

  return `${encodedPayload}.${signature}`;
}

export function verifyOAuthState(state: string) {
  const [encodedPayload, signature] = state.split(".");

  if (!encodedPayload || !signature) {
    throw new Error("OAuth state is invalid");
  }

  const expectedSignature = crypto
    .createHmac("sha256", stateSecret())
    .update(encodedPayload)
    .digest("base64url");

  const signatureBuffer = Buffer.from(signature);
  const expectedSignatureBuffer = Buffer.from(expectedSignature);

  if (
    signatureBuffer.length !== expectedSignatureBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedSignatureBuffer)
  ) {
    throw new Error("OAuth state signature is invalid");
  }

  const payload = JSON.parse(base64UrlDecode(encodedPayload)) as OAuthState;

  if (
    typeof payload.uid !== "string" ||
    !payload.uid ||
    typeof payload.exp !== "number"
  ) {
    throw new Error("OAuth state payload is invalid");
  }

  if (payload.exp < Date.now()) {
    throw new Error("OAuth state has expired");
  }

  return payload;
}
