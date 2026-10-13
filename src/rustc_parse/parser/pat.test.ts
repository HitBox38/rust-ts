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
  p_ident: "rustc_parse::parser::expr::Parser::is_builtin",
  p_mut: "rustc_parse::parser::expr::Parser::is_builtin",
  p_mut_ref: "rustc_parse::parser::expr::Parser::is_builtin",
  p_tuple: "rustc_parse::parser::expr::Parser::is_builtin",
  p_tuple1: "rustc_parse::parser::expr::Parser::is_builtin",
  p_paren: "rustc_parse::parser::expr::Parser::is_builtin",
  p_tuple_rest_mid: "rustc_parse::parser::expr::Parser::is_builtin",
  p_slice: "rustc_parse::parser::expr::Parser::is_builtin",
  p_slice_bind: "rustc_parse::parser::expr::Parser::is_builtin",
  p_slice_trailing: "rustc_parse::parser::expr::Parser::is_builtin",
  p_or_paren: "rustc_parse::parser::expr::Parser::is_builtin",
  p_or_nested_lead: "rustc_parse::parser::expr::Parser::is_builtin",
  p_or_top: "rustc_parse::parser::expr::Parser::is_builtin",
  p_or_leading: "rustc_parse::parser::expr::Parser::is_builtin",
  p_deref: "rustc_parse::parser::expr::Parser::is_builtin",
  p_deref_mut: "rustc_parse::parser::expr::Parser::is_builtin",
  p_andand: "rustc_parse::parser::expr::Parser::is_builtin",
  p_deref_lifetime: "rustc_parse::parser::expr::Parser::is_builtin",
  p_box: "rustc_parse::parser::expr::Parser::is_builtin",
  p_at: "rustc_parse::parser::expr::Parser::is_builtin",
  p_at_wrong_side: "rustc_parse::parser::expr::Parser::is_builtin",
  p_at_both: "rustc_parse::parser::expr::Parser::is_builtin",
  p_mut_mut: "rustc_parse::parser::expr::Parser::is_builtin",
  p_mut_tuple: "rustc_parse::parser::expr::Parser::is_builtin",
  p_let_let: "rustc_parse::parser::expr::Parser::is_builtin",
  p_trailing_vert: "rustc_parse::parser::expr::Parser::is_builtin",
  p_oror: "rustc_parse::parser::expr::Parser::is_builtin",
  p_tuple_ascription: "rustc_parse::parser::expr::Parser::is_builtin",
  p_lit: "rustc_parse::parser::expr::Parser::is_builtin",
  p_neg_lit: "rustc_parse::parser::expr::Parser::is_builtin",
  p_str_lit: "rustc_parse::parser::expr::Parser::is_builtin",
  p_char_lit: "rustc_parse::parser::expr::Parser::is_builtin",
  p_bool_lit: "rustc_parse::parser::expr::Parser::is_builtin",
  p_unclosed_char: "rustc_parse::parser::expr::Parser::is_builtin",
  p_range_incl: "rustc_parse::parser::expr::Parser::is_builtin",
  p_range_excl: "rustc_parse::parser::expr::Parser::is_builtin",
  p_range_from: "rustc_parse::parser::expr::Parser::is_builtin",
  p_range_to: "rustc_parse::parser::expr::Parser::parse_literal_maybe_minus",
  p_range_to_excl: "rustc_parse::parser::expr::Parser::parse_literal_maybe_minus",
  p_range_dotdotdot: "rustc_parse::parser::expr::Parser::is_builtin",
  p_rangeto_dotdotdot: "rustc_parse::parser::expr::Parser::parse_literal_maybe_minus",
  p_range_neg: "rustc_parse::parser::expr::Parser::is_builtin",
  p_range_path: "rustc_parse::parser::expr::Parser::is_builtin",
  p_range_incl_noend: "rustc_parse::parser::expr::Parser::is_builtin",
  p_range_paren_begin: "rustc_parse::parser::expr::Parser::is_builtin",
  p_range_extra_eq: "rustc_parse::parser::expr::Parser::is_builtin",
  p_range_to_paren: "rustc_parse::parser::expr::Parser::parse_literal_maybe_minus",
  p_struct: "rustc_parse::parser::expr::Parser::is_builtin",
  p_struct_rest_comma: "rustc_parse::parser::expr::Parser::is_builtin",
  p_struct_rest_mid: "rustc_parse::parser::expr::Parser::is_builtin",
  p_struct_box_field: "rustc_parse::parser::expr::Parser::is_builtin",
  p_tuple_struct: "rustc_parse::parser::expr::Parser::is_builtin",
  p_path: "rustc_parse::parser::expr::Parser::is_builtin",
  p_qpath: "rustc_parse::parser::expr::Parser::is_builtin",
  p_mac: "rustc_parse::parser::expr::Parser::is_builtin",
  p_expr_in_pat: "rustc_parse::parser::expr::Parser::is_builtin",
  p_reserved: "rustc_parse::parser::expr::Parser::is_builtin",
  f_or: "rustc_parse::parser::expr::Parser::is_builtin",
  f_tuple: "rustc_parse::parser::expr::Parser::is_builtin",
  c_ident: "rustc_parse::parser::expr::Parser::is_builtin",
  c_tuple: "rustc_parse::parser::expr::Parser::is_builtin",
};

const SHIMMED: ReadonlySet<string> = new Set([
  "p_wild", "p_ident", "p_mut", "p_ref", "p_ref_mut", "p_mut_ref", "p_tuple", "p_tuple1", "p_paren",
  "p_tuple_rest", "p_tuple_rest_mid", "p_slice", "p_slice_bind", "p_slice_empty", "p_slice_trailing",
  "p_or_paren", "p_or_nested_lead", "p_or_top", "p_or_leading", "p_deref", "p_deref_mut", "p_andand",
  "p_deref_lifetime", "p_box", "p_box_nopat", "p_ref_box", "p_never", "p_at", "p_at_wrong_side", "p_at_both",
  "p_mut_mut", "p_mut_tuple", "p_mut_wild", "p_let_let", "p_dotdotdot", "p_trailing_vert", "p_oror", "p_lit",
  "p_neg_lit", "p_str_lit", "p_char_lit", "p_bool_lit", "p_range_incl", "p_range_excl", "p_range_from",
  "p_range_to", "p_range_to_excl", "p_range_dotdotdot", "p_rangeto_dotdotdot", "p_range_neg",
  "p_range_incl_noend", "p_range_paren_begin", "p_range_extra_eq", "p_range_to_paren", "f_or", "f_tuple",
  "c_ident", "c_tuple", "c_dotdotdot",
]);

const cases = oracle.cases.filter((c) => /^(p|f|c)_/.test(c.name));

test("pat oracle: case lists are consistent", () => {
  const names = new Set(cases.map((c) => c.name));
  for (const n of Object.keys(PENDING)) expect(names.has(n)).toBe(true);
  for (const n of SHIMMED) expect(names.has(n)).toBe(true);
  expect(cases.length).toBeGreaterThan(0);
});

for (const c of cases) {
  test(`pat oracle: ${c.name}`, () => {
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

  test(`pat oracle (shimmed): ${c.name}`, () => {
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
