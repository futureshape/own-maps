import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { HttpError } from "../http";

const googleJwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string | null;
  picture: string | null;
}

export function identityFromClaims(payload: JWTPayload): GoogleIdentity {
  if (
    typeof payload.sub !== "string" ||
    typeof payload.email !== "string" ||
    payload.email_verified !== true
  ) {
    throw new HttpError(401, "Google account email is not verified");
  }
  return {
    sub: payload.sub,
    email: payload.email.trim().toLowerCase(),
    name: typeof payload.name === "string" ? payload.name : null,
    picture: typeof payload.picture === "string" ? payload.picture : null,
  };
}

export async function verifyGoogleCredential(
  credential: string,
  clientId: string,
): Promise<GoogleIdentity> {
  try {
    const { payload } = await jwtVerify(credential, googleJwks, {
      audience: clientId,
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      algorithms: ["RS256"],
    });
    return identityFromClaims(payload);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(401, "Invalid Google credential");
  }
}
