// Oracle tests for parser/stmt.rs (lane parser-pat-stmt).
//
// Each case parses statements inside `fn f() { .. }` through the narrowest entry point:
//   kind `block` -> `parse_block()` on the fn body (no inner attributes, so the same as the fn-body
//                   `parse_block_common(.., Default, None)`); compared with the fn's `body` Block
//   kind `stmt`  -> `parse_full_stmt(AttemptLocalParseRecovery::Yes)` on the first statement;
//                   compared with the first `Stmt` of the body
// plus the `-Zui-testing` stderr, against real rustc (`-Zunpretty=ast-tree` of the wrapped snippet;
// see testdata/pat_stmt_oracle.json `_how`, and testdata/pat_stmt_harness.ts).
//
// Every case must match the oracle byte for byte (tree and stderr).
import { expect, test } from "bun:test";

import "../lib.ts";
import { oracle, run_case } from "./testdata/pat_stmt_harness.ts";

const cases = oracle.cases.filter((c) => /^(s|st)_/.test(c.name));

test("stmt oracle: cases exist", () => {
  expect(cases.length).toBeGreaterThan(0);
});

for (const c of cases) {
  test(`stmt oracle: ${c.name}`, () => {
    const got = run_case(c);
    expect(got.tree ?? null).toBe(c.tree);
    expect(got.stderr).toBe(c.stderr);
  });
}
