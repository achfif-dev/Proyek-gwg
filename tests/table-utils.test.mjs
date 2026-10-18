import test from "node:test";
import assert from "node:assert/strict";
import { proporsiBarisSama } from "../src/lib/tableUtils.js";
const baris = (...ids) => ids.map(id => ({ id }));
test("proporsiBarisSama", () => {
  assert.equal(proporsiBarisSama(new Set(), baris("a", "b")), 0);
  assert.equal(proporsiBarisSama(new Set(["a", "b", "c"]), baris("a", "b")), 1);
  assert.equal(proporsiBarisSama(new Set(["a"]), baris("a", "b", "c", "d")), 0.25);
  assert.equal(proporsiBarisSama(new Set(["a"]), []), 1);
});
