import assert from "node:assert/strict";
import { test } from "node:test";
import { buildManageLink, createManageToken, isManageToken, readManageTokenFromHash } from "./manageToken.ts";

test("tokens are 43-char base64url strings and unique", () => {
  const tokens = new Set(Array.from({ length: 200 }, () => createManageToken()));
  assert.equal(tokens.size, 200);
  for (const token of tokens) assert.ok(isManageToken(token), token);
});

test("link keeps the token in the fragment only", () => {
  const token = createManageToken();
  const link = new URL(buildManageLink("https://example.test", token));
  assert.equal(link.pathname, "/manage-booking");
  assert.equal(link.search, "");
  assert.equal(link.hash, `#${token}`);
  assert.equal(readManageTokenFromHash(link.hash), token);
});

test("malformed fragments are rejected", () => {
  for (const hash of ["", "#", "#abc", `#${"a".repeat(42)}`, `#${"a".repeat(44)}`, `#${"a".repeat(42)}=`, `#${"a".repeat(42)}+`]) {
    assert.equal(readManageTokenFromHash(hash), null, hash);
  }
});
