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
// Real mode: a case matches the oracle, or throws exactly its PENDING `Unported` (a path into another
// parser lane's unported code). When that lane lands the case must match, and root deletes it from
// PENDING (the test fails until then, so nothing passes silently).
// Shimmed mode (see the harness): with test-side copies of a few other-lane fns, no case may differ
// from the oracle; the SHIMMED cases must match (the rest may still reach unported code).
import { expect, test } from "bun:test";

import "../lib.ts";
import { Unported } from "../../std/panic.ts";
import { type Got, ShimMiss, oracle, run_case } from "./testdata/pat_stmt_harness.ts";

const PENDING: Record<string, string> = {
  s_let_decl: "rustc_parse::parser::ty::Parser::check_lifetime",
  s_let_decls: "rustc_parse::parser::ty::Parser::check_lifetime",
  s_let_init: "rustc_parse::parser::ty::Parser::check_lifetime",
  s_let_ty: "rustc_parse::parser::ty::Parser::check_lifetime",
  s_let_ty_init: "rustc_parse::parser::ty::Parser::check_lifetime",
  s_let_else: "rustc_parse::parser::ty::Parser::check_lifetime",
  s_let_else_irrefutable: "rustc_parse::parser::ty::Parser::check_lifetime",
  s_let_else_lazy: "rustc_parse::parser::ty::Parser::check_lifetime",
  s_let_else_brace: "rustc_parse::parser::ty::Parser::check_lifetime",
  s_let_else_if: "rustc_parse::parser::ty::Parser::check_lifetime",
  s_missing_semi: "rustc_parse::parser::ty::Parser::check_lifetime",
  s_missing_semi_decl: "rustc_parse::parser::ty::Parser::check_lifetime",
  s_mut_mut: "rustc_parse::parser::ty::Parser::check_lifetime",
  s_mut_mut_init: "rustc_parse::parser::ty::Parser::check_lifetime",
  s_mut_let: "rustc_parse::parser::ty::Parser::check_lifetime",
  s_auto: "rustc_parse::parser::ty::Parser::check_lifetime",
  s_var: "rustc_parse::parser::ty::Parser::check_lifetime",
  s_missing_let: "rustc_parse::parser::ty::Parser::check_lifetime",
  s_const_let: "rustc_parse::parser::ty::Parser::check_lifetime",
  s_super_let: "rustc_parse::parser::ty::Parser::check_lifetime",
  s_compound: "rustc_parse::parser::ty::Parser::check_lifetime",
  s_type_colon_typo: "rustc_parse::parser::ty::Parser::check_lifetime",
  s_attr: "rustc_parse::parser::ty::Parser::check_lifetime",
  s_doc: "rustc_parse::parser::ty::Parser::check_lifetime",
  s_doc_trailing: "rustc_parse::parser::ty::Parser::check_lifetime",
  s_attr_trailing: "rustc_parse::parser::ty::Parser::check_lifetime",
  s_item: "rustc_parse::parser::ty::Parser::check_lifetime",
  s_item_struct: "rustc_parse::parser::ty::Parser::check_lifetime",
  s_mac_semi: "rustc_parse::parser::ty::Parser::check_lifetime",
  s_mac_brace: "rustc_parse::parser::ty::Parser::check_lifetime",
  s_mac_nosemi_tail: "rustc_parse::parser::ty::Parser::check_lifetime",
  s_mac_expr: "rustc_parse::parser::ty::Parser::check_lifetime",
  s_mac_brace_dot: "rustc_parse::parser::ty::Parser::check_lifetime",
  s_empty: "rustc_parse::parser::ty::Parser::check_lifetime",
  s_empty2: "rustc_parse::parser::ty::Parser::check_lifetime",
  s_empty_block: "rustc_parse::parser::ty::Parser::check_lifetime",
  s_expr: "rustc_parse::parser::ty::Parser::check_lifetime",
  s_tail: "rustc_parse::parser::ty::Parser::check_lifetime",
  s_if_else: "rustc_parse::parser::ty::Parser::check_lifetime",
  s_assign_else: "rustc_parse::parser::ty::Parser::check_lifetime",
  s_expr_missing_semi: "rustc_parse::parser::ty::Parser::check_lifetime",
  s_label_typo: "rustc_parse::parser::ty::Parser::check_lifetime",
  st_let_decl: "rustc_parse::parser::expr::Parser::is_builtin",
  st_let_mut_mut: "rustc_parse::parser::expr::Parser::is_builtin",
  st_let_init: "rustc_parse::parser::expr::Parser::is_builtin",
  st_mac: "rustc_parse::parser::item::Parser::is_path_start_item",
  st_empty: "rustc_parse::parser::item::Parser::parse_item_common",
};

const SHIMMED: ReadonlySet<string> = new Set([
  "s_let_decl", "s_let_decls", "s_mut_mut", "s_mut_let", "s_auto", "s_var", "s_missing_let", "s_const_let",
  "s_super_let", "s_doc", "s_empty_block", "st_let_decl", "st_let_mut_mut",
]);

const cases = oracle.cases.filter((c) => /^(s|st)_/.test(c.name));

test("stmt oracle: case lists are consistent", () => {
  const names = new Set(cases.map((c) => c.name));
  for (const n of Object.keys(PENDING)) expect(names.has(n)).toBe(true);
  for (const n of SHIMMED) expect(names.has(n)).toBe(true);
  expect(cases.length).toBeGreaterThan(0);
});

for (const c of cases) {
  test(`stmt oracle: ${c.name}`, () => {
    let got: Got | undefined;
    let unported: string | undefined;
    try {
      got = run_case(c, false);
    } catch (e) {
      if (!(e instanceof Unported)) throw e;
      unported = e.what;
    }
    if (unported !== undefined) {
      expect(PENDING[c.name]).toBe(unported);
      return;
    }
    expect(PENDING[c.name]).toBeUndefined();
    expect(got!.tree ?? null).toBe(c.tree);
    expect(got!.stderr).toBe(c.stderr);
  });

  test(`stmt oracle (shimmed): ${c.name}`, () => {
    let got: Got | undefined;
    try {
      got = run_case(c, true);
    } catch (e) {
      if (!(e instanceof Unported || e instanceof ShimMiss)) throw e;
      expect(SHIMMED.has(c.name)).toBe(false);
      return;
    }
    expect(got.tree ?? null).toBe(c.tree);
    expect(got.stderr).toBe(c.stderr);
  });
}
