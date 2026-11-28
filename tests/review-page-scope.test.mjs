// Regression: the public review page's detail modal threw
// "ReferenceError: inkBtn is not defined" because the style object was declared
// inside ReviewPageClient but used by the separate ReviewPostDetailModal.
// The JSX file cannot be rendered by the node test runner, so this checks scope
// statically: every shared style used across components is module-level.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../app/review/[token]/ReviewPageClient.jsx", import.meta.url), "utf8");

function body(name) {
  const start = src.search(new RegExp(`^(export default )?function ${name}\\b`, "m"));
  assert.ok(start >= 0, `${name} exists`);
  const next = src.slice(start + 1).search(/^(export default )?function \w+/m);
  return next < 0 ? src.slice(start) : src.slice(start, start + 1 + next);
}

test("review detail modal only uses module-scope shared styles (inkBtn, lbl)", () => {
  for (const name of ["inkBtn", "lbl"]) {
    const decls = src.match(new RegExp(`^\\s*const ${name} =`, "gm")) || [];
    assert.equal(decls.length, 1, `${name} declared exactly once`);
    assert.match(src, new RegExp(`^const ${name} =`, "m"), `${name} is declared at module scope`);
  }
  const modal = body("ReviewPostDetailModal");
  assert.match(modal, /\.\.\.inkBtn/, "modal uses inkBtn");
  assert.ok(!/const inkBtn =/.test(body("ReviewPageClient")), "not re-declared inside the page component");
});
