import crypto from "crypto";

export function generateWorkspaceReviewToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashWorkspaceReviewToken(token) {
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("Token must be a non-empty string");
  }
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export function getWorkspaceReviewTokenLast4(token) {
  if (typeof token !== "string" || token.length < 4) {
    throw new Error("Token must be a string with at least 4 characters");
  }
  return token.slice(-4);
}
