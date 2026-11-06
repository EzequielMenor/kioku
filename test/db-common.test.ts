import { test } from "node:test";
import assert from "node:assert/strict";
import { RESERVED_NAMES } from "../src/core/database-schema.ts";
import { isSystemKey } from "../web/src/db-common.ts";

test("isSystemKey: el cliente y el servidor coinciden en qué claves son de sistema, sin distinguir mayúsculas", () => {
  for (const name of RESERVED_NAMES) {
    assert.equal(isSystemKey(name), true, name);
    assert.equal(isSystemKey(name.toUpperCase()), true, name.toUpperCase());
    assert.equal(isSystemKey(name[0].toUpperCase() + name.slice(1)), true, name);
  }
  for (const col of ["title", "path", "type", "mtime", "tags"]) assert.equal(isSystemKey(col), true, col);
  assert.equal(isSystemKey("Autor"), false);
  assert.equal(isSystemKey("Estado"), false);
});
