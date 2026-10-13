// Oracle tests for parser/pat.rs (lane parser-pat-stmt).
//
// Each case parses a pattern at the position where rustc parses it, through the narrowest entry point:
//   kind `let`     -> `parse_pat_before_ty(None, RecoverComma::Yes, LetBinding)` (what `parse_local` calls)
//   kind `for`     -> `parse_pat_allow_top_guard(None, Yes, Yes, LikelyTuple)` (the `for` loop pattern)
//   kind `closure` -> `parse_pat_no_top_alt(Some(ParameterName), None)` (a closure parameter)
// and compares `{:#?}` of the `Pat` and the `-Zui-testing` stderr with real rustc
// (`-Zunpretty=ast-tree` of the wrapped snippet, subtree `Local.pat` / `ForLoop.pat` / `Param.pat`;
// see testdata/pat_stmt_oracle.json `_how`, and testdata/pat_stmt_harness.ts).
//
// Every case must match the oracle byte for byte (tree and stderr).
import { expect, test } from "bun:test";

import "../lib.ts";
import { oracle, run_case } from "./testdata/pat_stmt_harness.ts";

const cases = oracle.cases.filter((c) => /^(p|f|c)_/.test(c.name));

test("pat oracle: cases exist", () => {
  expect(cases.length).toBeGreaterThan(0);
});

for (const c of cases) {
  test(`pat oracle: ${c.name}`, () => {
    const got = run_case(c);
    expect(got.tree ?? null).toBe(c.tree);
    expect(got.stderr).toBe(c.stderr);
  });
}
