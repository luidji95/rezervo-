import "server-only";
import { createHash } from "node:crypto";

// Only this SHA-256 digest (hex) is sent to and stored in the database; the token itself is never stored or logged.
export function hashManageToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
