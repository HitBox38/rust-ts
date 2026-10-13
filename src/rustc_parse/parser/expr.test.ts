// Scenario tests for lane parser-expr (parser/expr.rs, parser/expr/diagnostics.rs): expression
// parsing through `parse_expr` (and the other public entry points) on a parser built from a snippet.
//
// Expectations: `expr_oracle.json`, produced by a rustc-dev probe against the pinned nightly
// (`_how` / `_probe` / `_cases` in the fixture say how). `run_case` below is the probe's per-case body
// ported to the TS API: the `{:#?}` Debug of every parsed node (the same tree `-Zunpretty=ast-tree`
// prints for the expression) and the full `-Zui-testing` stderr must match byte for byte.
//
// Coverage (case names): precedence/associativity of every binary and assignment operator, `as`,
// unary, `?`, `.await` (`prec_*`, `assoc_*`, `assign_*`, `cast_*`, `unary_*`, `try_and_await`,
// `await_2015`); ranges (`range_*`); closures with every modifier (`closure_*`); if/else-if/let
// chains per edition (`if_*`, `let_outside_cond`); match guards and arms with/without commas
// (`match_*`); labeled loops (`while_*`, `loop_*`, `for_*`, `label*`); break/continue/return with
// values (`break_*`, `continue_*`); struct literals and restrictions (`struct_lit_*`,
// `if_struct_*`); method calls with turbofish (`method_*`); indexing (`call_and_index`,
// `index_expr`); tuple fields incl. float splitting (`tuple_field_*`); async/try/gen blocks;
// `yield`, `become`, `do yeet`, `box` errors; literal suffixes (`lit_*`); macro calls; the
// cast-then-`<` ambiguity (`cast_lt`, `cast_shl`); recovery diagnostics (`chained_*`,
// `missing_operand*`, `strict_eq`, `diamond_ne`, `spaceship`, `alpha_*`, `*_inc`, `*_dec`, ...).
//
// PENDING: cases that reach code owned by another parser lane (diagnostics.rs, path.rs, ty.rs,
// pat.rs, stmt.rs, ...) must throw exactly the listed `Unported` until that lane lands; then they
// must match the oracle and root drops them from PENDING (the test fails until it does).
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { debug_AnonConst, debug_Expr, debug_MetaItemLit, debug_StrLit, token } from "../../rustc_ast/lib.ts";
import { debug_MultiSpan } from "../../rustc_error_messages/lib.ts";
import { LintId } from "../../rustc_lint_defs/lib.ts";
import { AnnotateSnippetEmitter } from "../../rustc_errors/annotate_snippet_emitter_writer.ts";
import { DiagCtxt, FatalErrorMarker, type PResult } from "../../rustc_errors/lib.ts";
import type { Edition } from "../../rustc_span/edition.ts";
import { ParseSess } from "../../rustc_session/parse.ts";
import { create_session_globals_then, type FileName } from "../../rustc_span/lib.ts";
import { FilePathMapping, RealFileLoader, get_source_map } from "../../rustc_span/source_map.ts";
import { type Debug, debug_option, PLAIN, PRETTY } from "../../std/fmt.ts";
import { Unported } from "../../std/panic.ts";
import { debug_result } from "../../std/result.ts";
import { AutoStream, ColorChoice } from "../../vendor/anstream/lib.ts";
import { VecU8, dyn_write } from "../../vendor/anstream/stream.ts";
import { new_parser_from_source_str, unwrap_or_emit_fatal } from "../lib.ts";
import type { Parser } from "./mod.ts";

interface Case {
  name: string;
  ops: string;
  src: string;
  events: string[];
  fatal: boolean;
  stderr: string;
}
const oracle = JSON.parse(readFileSync(new URL("./expr_oracle.json", import.meta.url), "utf8")) as { cases: Case[] };

/** case -> the `Unported` it must reach until the owning lane lands. */
const PENDING: Record<string, string> = {
  prec_add_mul: "rustc_parse::parser::diagnostics::Parser::maybe_recover_from_bad_qpath",
  prec_mul_add: "rustc_parse::parser::path::Parser::parse_path",
  assoc_sub_left: "rustc_parse::parser::path::Parser::parse_path",
  prec_div_rem_mul: "rustc_parse::parser::path::Parser::parse_path",
  prec_shift_sum: "rustc_parse::parser::path::Parser::parse_path",
  prec_bit_ops: "rustc_parse::parser::path::Parser::parse_path",
  prec_cmp_bitor: "rustc_parse::parser::path::Parser::parse_path",
  prec_logic: "rustc_parse::parser::path::Parser::parse_path",
  prec_cmp_logic: "rustc_parse::parser::path::Parser::parse_path",
  cmp_le_gt: "rustc_parse::parser::path::Parser::parse_path",
  assign_right_assoc: "rustc_parse::parser::path::Parser::parse_path",
  assign_ops_all: "rustc_parse::parser::path::Parser::parse_path",
  assign_vs_range: "rustc_parse::parser::path::Parser::parse_path",
  cast_prec: "rustc_parse::parser::path::Parser::parse_path",
  cast_chain: "rustc_parse::parser::path::Parser::parse_path",
  unary_prec: "rustc_parse::parser::path::Parser::parse_path",
  unary_ref_kinds: "rustc_parse::parser::ty::Parser::parse_pin_and_mut",
  unary_neg_lit_method: "rustc_parse::parser::diagnostics::Parser::maybe_recover_from_bad_qpath",
  try_and_await: "rustc_parse::parser::path::Parser::parse_path",
  await_2015: "rustc_parse::parser::path::Parser::parse_path",
  deref_try: "rustc_parse::parser::path::Parser::parse_path",
  range_forms: "rustc_parse::parser::path::Parser::parse_path",
  range_prec: "rustc_parse::parser::path::Parser::parse_path",
  range_eq_incomplete: "rustc_parse::parser::path::Parser::parse_path",
  range_dotdotdot: "rustc_parse::parser::path::Parser::parse_path",
  range_in_assign: "rustc_parse::parser::path::Parser::parse_path",
  closure_basic: "rustc_parse::parser::ty::Parser::parse_ret_ty",
  closure_args: "rustc_parse::parser::pat::Parser::parse_pat_no_top_alt",
  closure_move: "rustc_parse::parser::pat::Parser::parse_pat_no_top_alt",
  closure_ret_ty: "rustc_parse::parser::pat::Parser::parse_pat_no_top_alt",
  closure_ret_ty_no_block: "rustc_parse::parser::pat::Parser::parse_pat_no_top_alt",
  closure_async: "rustc_parse::parser::ty::Parser::parse_ret_ty",
  closure_async_2015: "rustc_parse::parser::path::Parser::parse_path",
  closure_static: "rustc_parse::parser::ty::Parser::parse_ret_ty",
  closure_for: "rustc_parse::parser::generics::Parser::choose_generics_over_qpath",
  closure_use: "rustc_parse::parser::ty::Parser::parse_ret_ty",
  closure_const: "rustc_parse::parser::ty::Parser::parse_ret_ty",
  closure_move_async_order: "rustc_parse::parser::diagnostics::Parser::dcx",
  if_else: "rustc_parse::parser::path::Parser::parse_path",
  if_let: "rustc_parse::parser::pat::Parser::parse_pat_no_top_guard",
  if_let_chain_2024: "rustc_parse::parser::pat::Parser::parse_pat_no_top_guard",
  if_let_chain_2021: "rustc_parse::parser::pat::Parser::parse_pat_no_top_guard",
  if_let_or: "rustc_parse::parser::pat::Parser::parse_pat_no_top_guard",
  if_let_paren: "rustc_parse::parser::pat::Parser::parse_pat_no_top_guard",
  if_assign_cond: "rustc_parse::parser::path::Parser::parse_path",
  if_missing_block: "rustc_parse::parser::path::Parser::parse_path",
  if_missing_cond: "rustc_parse::parser::stmt::Parser::parse_block_common",
  if_struct_restriction: "rustc_parse::parser::path::Parser::parse_path",
  if_struct_lit_parens: "rustc_parse::parser::path::Parser::parse_path",
  else_without_if: "rustc_parse::parser::path::Parser::parse_path",
  let_outside_cond: "rustc_parse::parser::diagnostics::Parser::dcx",
  while_let: "rustc_parse::parser::pat::Parser::parse_pat_no_top_guard",
  while_label: "rustc_parse::parser::diagnostics::Parser::maybe_recover_from_bad_qpath",
  loop_label: "rustc_parse::parser::stmt::Parser::parse_inner_attrs_and_block",
  for_loop: "rustc_parse::parser::generics::Parser::choose_generics_over_qpath",
  for_await: "rustc_parse::parser::generics::Parser::choose_generics_over_qpath",
  for_paren_head: "rustc_parse::parser::generics::Parser::choose_generics_over_qpath",
  for_missing_in: "rustc_parse::parser::generics::Parser::choose_generics_over_qpath",
  for_label: "rustc_parse::parser::pat::Parser::parse_pat_allow_top_guard",
  labeled_block: "rustc_parse::parser::stmt::Parser::parse_block_common",
  label_non_block: "rustc_parse::parser::diagnostics::Parser::maybe_recover_from_bad_qpath",
  loop_else: "rustc_parse::parser::stmt::Parser::parse_inner_attrs_and_block",
  match_arms: "rustc_parse::parser::path::Parser::parse_path",
  match_guard_let: "rustc_parse::parser::path::Parser::parse_path",
  match_missing_comma: "rustc_parse::parser::path::Parser::parse_path",
  match_arrow_typo: "rustc_parse::parser::path::Parser::parse_path",
  match_paren_guard: "rustc_parse::parser::path::Parser::parse_path",
  postfix_match: "rustc_parse::parser::path::Parser::parse_path",
  break_forms: "rustc_parse::parser::diagnostics::Parser::maybe_recover_from_bad_qpath",
  break_labeled_loop_value: "rustc_parse::parser::stmt::Parser::parse_inner_attrs_and_block",
  break_label_unlabeled_loop: "rustc_parse::parser::stmt::Parser::parse_inner_attrs_and_block",
  break_ident_label: "rustc_parse::parser::path::Parser::parse_path",
  continue_ident_label: "rustc_parse::parser::diagnostics::Parser::dcx",
  struct_lit: "rustc_parse::parser::path::Parser::parse_path",
  struct_lit_path: "rustc_parse::parser::path::Parser::parse_path",
  struct_lit_rest: "rustc_parse::parser::path::Parser::parse_path",
  struct_lit_eq_init: "rustc_parse::parser::path::Parser::parse_path",
  struct_lit_dotdotdot: "rustc_parse::parser::path::Parser::parse_path",
  struct_lit_paren: "rustc_parse::parser::path::Parser::parse_path",
  struct_lit_no_path: "rustc_parse::parser::diagnostics::Parser::recover_vcs_conflict_marker",
  struct_lit_underscore: "rustc_parse::parser::diagnostics::Parser::recover_vcs_conflict_marker",
  struct_lit_missing_comma: "rustc_parse::parser::path::Parser::parse_path",
  method_turbofish: "rustc_parse::parser::path::Parser::parse_path",
  method_generic_field: "rustc_parse::parser::path::Parser::parse_path",
  method_no_turbofish: "rustc_parse::parser::path::Parser::parse_path",
  call_and_index: "rustc_parse::parser::path::Parser::parse_path",
  index_expr: "rustc_parse::parser::path::Parser::parse_path",
  tuple_field: "rustc_parse::parser::path::Parser::parse_path",
  tuple_field_float: "rustc_parse::parser::path::Parser::parse_path",
  tuple_field_float_3: "rustc_parse::parser::path::Parser::parse_path",
  tuple_field_float_e: "rustc_parse::parser::path::Parser::parse_path",
  tuple_field_suffix: "rustc_parse::parser::path::Parser::parse_path",
  tuple_field_float_suffix: "rustc_parse::parser::path::Parser::parse_path",
  after_dot_bad: "rustc_parse::parser::path::Parser::parse_path",
  async_block: "rustc_parse::parser::stmt::Parser::parse_inner_attrs_and_block",
  async_move_block: "rustc_parse::parser::stmt::Parser::parse_inner_attrs_and_block",
  async_block_2015: "rustc_parse::parser::path::Parser::parse_path",
  gen_block: "rustc_parse::parser::stmt::Parser::parse_inner_attrs_and_block",
  async_gen_block: "rustc_parse::parser::stmt::Parser::parse_inner_attrs_and_block",
  gen_block_2021: "rustc_parse::parser::path::Parser::parse_path",
  try_block: "rustc_parse::parser::stmt::Parser::parse_inner_attrs_and_block",
  try_block_2015: "rustc_parse::parser::path::Parser::parse_path",
  try_catch: "rustc_parse::parser::stmt::Parser::parse_inner_attrs_and_block",
  do_catch: "rustc_parse::parser::diagnostics::Parser::dcx",
  unsafe_block: "rustc_parse::parser::stmt::Parser::parse_block_common",
  const_block: "rustc_parse::parser::stmt::Parser::parse_inner_attrs_and_block",
  yield_forms: "rustc_parse::parser::diagnostics::Parser::maybe_recover_from_bad_qpath",
  become_expr: "rustc_parse::parser::path::Parser::parse_path",
  do_yeet: "rustc_parse::parser::diagnostics::Parser::maybe_recover_from_bad_qpath",
  box_expr: "rustc_parse::parser::diagnostics::Parser::try_macro_suggestion",
  lit_suffixes: "rustc_parse::parser::diagnostics::Parser::maybe_recover_from_bad_qpath",
  lit_bad_suffix: "rustc_parse::parser::diagnostics::Parser::maybe_recover_from_bad_qpath",
  lit_dot_float: "rustc_parse::parser::diagnostics::Parser::dcx",
  lit_str_suffix: "rustc_parse::parser::diagnostics::Parser::maybe_recover_from_bad_qpath",
  macro_calls: "rustc_parse::parser::path::Parser::parse_path",
  macro_qpath: "rustc_parse::parser::path::Parser::parse_qpath",
  array_forms: "rustc_parse::parser::diagnostics::Parser::maybe_recover_from_bad_qpath",
  paren_tuple: "rustc_parse::parser::path::Parser::parse_path",
  qpath_expr: "rustc_parse::parser::path::Parser::parse_qpath",
  cast_lt: "rustc_parse::parser::path::Parser::parse_path",
  cast_shl: "rustc_parse::parser::path::Parser::parse_path",
  cast_postfix: "rustc_parse::parser::path::Parser::parse_path",
  cast_index: "rustc_parse::parser::ty::Parser::parse_pin_and_mut",
  chained_cmp: "rustc_parse::parser::path::Parser::parse_path",
  chained_cmp_gt: "rustc_parse::parser::path::Parser::parse_path",
  chained_eq: "rustc_parse::parser::path::Parser::parse_path",
  missing_operand: "rustc_parse::parser::path::Parser::parse_path",
  missing_operand_mid: "rustc_parse::parser::path::Parser::parse_path",
  strict_eq: "rustc_parse::parser::path::Parser::parse_path",
  diamond_ne: "rustc_parse::parser::path::Parser::parse_path",
  spaceship: "rustc_parse::parser::path::Parser::parse_path",
  alpha_and: "rustc_parse::parser::path::Parser::parse_path",
  alpha_or: "rustc_parse::parser::path::Parser::parse_path",
  postfix_inc: "rustc_parse::parser::path::Parser::parse_path",
  prefix_inc: "rustc_parse::parser::path::Parser::parse_path",
  postfix_dec: "rustc_parse::parser::path::Parser::parse_path",
  tilde_not: "rustc_parse::parser::diagnostics::Parser::dcx",
  not_word: "rustc_parse::parser::diagnostics::Parser::dcx",
  leading_plus: "rustc_parse::parser::diagnostics::Parser::dcx",
  rarrow_call: "rustc_parse::parser::path::Parser::parse_path",
  larrow: "rustc_parse::parser::path::Parser::parse_path",
  lifetime_borrow: "rustc_parse::parser::ty::Parser::expect_lifetime",
  offset_of: "rustc_parse::parser::ty::Parser::parse_ty",
  type_ascribe: "rustc_parse::parser::path::Parser::parse_path",
  builtin_unknown: "rustc_parse::parser::diagnostics::Parser::dcx",
  move_expr: "rustc_parse::parser::path::Parser::parse_path",
  outer_attr: "rustc_parse::parser::path::Parser::parse_path",
  outer_attr_range: "rustc_parse::parser::path::Parser::parse_path",
  expr_in_let: "rustc_parse::parser::path::Parser::parse_path",
  force_collect: "rustc_parse::parser::path::Parser::parse_path",
  anon_const: "rustc_parse::parser::path::Parser::parse_path",
  lit_maybe_minus_bad: "rustc_parse::parser::diagnostics::Parser::dcx",
  unclosed_char_label: "rustc_parse::parser::diagnostics::Parser::try_macro_suggestion",
  c_array: "rustc_parse::parser::diagnostics::Parser::create_snapshot_for_diagnostic",
  do_while_bad: "rustc_parse::parser::diagnostics::Parser::recover_incorrect_await_syntax",
  field_generic_args: "rustc_parse::parser::path::Parser::parse_path",
  break_label_lint: "rustc_parse::parser::path::Parser::parse_path",
  match_arm_missing_braces: "rustc_parse::parser::path::Parser::parse_path",
  match_arm_semi_comma: "rustc_parse::parser::path::Parser::parse_path",
  match_no_body_never: "rustc_parse::parser::path::Parser::parse_path",
  if_block_attrs: "rustc_parse::parser::path::Parser::parse_path",
  missing_semi_before_array: "rustc_parse::parser::path::Parser::parse_path",
  unsafe_binder: "rustc_parse::parser::path::Parser::parse_path",
  raw_without_mut: "rustc_parse::parser::ty::Parser::parse_pin_and_mut",
  while_else: "rustc_parse::parser::path::Parser::parse_path",
  tuple_lit_field_chain: "rustc_parse::parser::diagnostics::Parser::maybe_recover_from_bad_qpath",
  neg_neg_not: "rustc_parse::parser::diagnostics::Parser::maybe_recover_from_bad_qpath",
  raw_ident_expr: "rustc_parse::parser::path::Parser::parse_path",
  closure_in_call_semi: "rustc_parse::parser::path::Parser::parse_path",
  call_struct_paren_shorthand: "rustc_parse::parser::path::Parser::parse_path",
  labeled_loop_value_break: "rustc_parse::parser::stmt::Parser::parse_inner_attrs_and_block",
  index_missing_close: "rustc_parse::parser::path::Parser::parse_path",
  let_chain_mixed_assign: "rustc_parse::parser::path::Parser::parse_path",
  guard_struct_braces: "rustc_parse::parser::path::Parser::parse_path",
  if_else_cond_like: "rustc_parse::parser::path::Parser::parse_path",
  paren_seq_recovery: "rustc_parse::parser::path::Parser::parse_path",
  bad_qpath_array: "rustc_parse::parser::path::Parser::parse_path",
  attr_on_rhs: "rustc_parse::parser::path::Parser::parse_path",
};

/** `format!("Ok({v:#?})")` / emit + `"Err"` (the probe's `res!`). */
function res<T>(r: PResult<T>, dbg: Debug<T>): string {
  if (r.$ === "Ok") return `Ok(${dbg(r._0, PRETTY)})`;
  r._0.emit();
  return "Err";
}

/** The probe's `run_ops`, ported. */
function run_ops(p: Parser, ops: string[], ev: string[]): void {
  for (const op of ops) {
    let r: string;
    switch (op) {
      case "expr":
        r = res(p.parse_expr(), debug_Expr);
        break;
      case "in_let":
        r = res(p.parse_expr_in_let(), debug_Expr);
        break;
      case "force":
        r = res(p.parse_expr_force_collect(), debug_Expr);
        break;
      case "anon":
        r = res(p.parse_expr_anon_const(), debug_AnonConst);
        break;
      case "lit":
        r = res(p.parse_literal_maybe_minus(), debug_Expr);
        break;
      case "str_lit":
        r = debug_result(p.parse_str_lit(), PRETTY, debug_StrLit, (v, f) => debug_option(v, f, debug_MetaItemLit));
        break;
      case "tok":
        r = token.debug_Token(p.token, PLAIN);
        break;
      case "lints":
        r = p.psess.buffered_lints
          .map((l) => `${LintId.lint_name_raw(l.lint_id)} ${debug_option(l.span, PLAIN, debug_MultiSpan)}`)
          .join("; ");
        break;
      default:
        throw new Error(`op ${op}`);
    }
    ev.push(`${op} => ${r}`);
  }
}

const EDITIONS: Record<string, Edition> = {
  "ed:2015": "Edition2015",
  "ed:2018": "Edition2018",
  "ed:2021": "Edition2021",
  "ed:2024": "Edition2024",
};

function run_case(c: Case): { events: string[]; fatal: boolean; stderr: string } {
  let edition: Edition = "Edition2024";
  const ops: string[] = [];
  for (const w of c.ops.split(/\s+/).filter((s) => s !== "")) {
    const ed = EDITIONS[w];
    if (ed !== undefined) edition = ed;
    else ops.push(w);
  }
  const inputs = {
    file_loader: new RealFileLoader(),
    path_mapping: FilePathMapping.empty(),
    hash_kind: "Md5" as const,
    checksum_hash_kind: undefined,
  };
  const events: string[] = [];
  let fatal = false;
  let stderr = "";
  create_session_globals_then(edition, [], inputs, () => {
    const sm = get_source_map()!;
    const buf = new VecU8();
    let em = AnnotateSnippetEmitter.new(AutoStream.new(dyn_write(buf), ColorChoice.Never));
    em = AnnotateSnippetEmitter.sm(em, sm);
    em = AnnotateSnippetEmitter.ui_testing(em, true);
    const psess = ParseSess.with_dcx(DiagCtxt.new(em), sm);
    const fname: FileName = { $: "Real", _0: sm.path_mapping().to_real_filename(sm.working_dir(), "t.rs") };
    try {
      const p = unwrap_or_emit_fatal(new_parser_from_source_str(psess, fname, c.src, "Nothing"));
      run_ops(p, ops, events);
      // Diagnostics stashed by the parser (e.g. `LifetimeIsChar`, `GenericInFieldExpr`).
      psess.dcx().emit_stashed_diagnostics();
    } catch (e) {
      if (!(e instanceof FatalErrorMarker)) throw e;
      fatal = true;
    }
    psess.dcx().reset_err_count();
    stderr = new TextDecoder().decode(buf.bytes());
  });
  return { events, fatal, stderr };
}

for (const c of oracle.cases) {
  test(`parser-expr oracle: ${c.name}`, () => {
    let got: ReturnType<typeof run_case> | undefined;
    let unported: string | undefined;
    try {
      got = run_case(c);
    } catch (e) {
      if (!(e instanceof Unported)) throw e;
      unported = e.what;
    }
    if (unported !== undefined) {
      expect(PENDING[c.name]).toBe(unported);
      return;
    }
    expect(PENDING[c.name]).toBeUndefined();
    expect(got!.events).toEqual(c.events);
    expect(got!.fatal).toBe(c.fatal);
    expect(got!.stderr).toBe(c.stderr);
  });
}

// Every case of the fixture is run (no silent drops).
test("parser-expr oracle: fixture size", () => {
  expect(oracle.cases.length).toBe(181);
  for (const name of Object.keys(PENDING)) expect(oracle.cases.some((c) => c.name === name)).toBe(true);
});
