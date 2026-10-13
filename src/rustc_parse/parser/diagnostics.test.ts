// Scenario tests for lane parser-diag (compiler/rustc_parse/src/parser/diagnostics.rs: the parser's
// error reporting and recovery). Upstream has no `#[cfg(test)]` tests for this file. Three parts, all
// compared byte for byte with the oracle (the pinned nightly):
//
// A. Probe cases (`diagnostics_oracle.json`): a rustc-dev probe (lane parser-core's, extended with
//    per-case editions and the ops `semi`, `snap`, `restore`) drives the real `Parser` through an op
//    script; `run_ops` below is its per-case body ported to the TS API. These reach diagnostics.rs
//    through the public API (`expect`, `expect_one_of`, `unexpected`, `expect_keyword`, `parse_ident`,
//    `maybe_consume_incorrect_semicolon`, snapshots): expected-one-of messages and labels with
//    `TokenType` sets, the "expected `;`" suggestions, raw-string terminators, misspelled keywords,
//    keyword concatenation, `def`/`public`, c-strings, doc comments, `&raw`, the keyword-as-identifier
//    path with its `r#` suggestion, numbers starting identifiers, ...
// B. Direct cases: the TS parser is moved (`skip_to`) to the token where rustc's parser calls a
//    diagnostics.rs fn for a whole program, AST arguments are rebuilt with the same spans, the fn is
//    called, and the full stderr (+ "aborting due to ..." from `print_error_count`) must equal the
//    driver oracle for that program (`diagnostics_driver.json`). Only programs whose whole rustc
//    output is that one call's diagnostic are used. A call that emits and then continues into code of
//    another parser lane (`mk_expr`, `mk_ty`, ...) must stop at exactly the listed `tail` Unported
//    after emitting; that is checked too.
// C. Driver cases (`diagnostics_driver.json`): `src/rust_ts/main.ts -Zui-testing
//    -Zparse-crate-root-only --edition E t.rs` against `rustc +nightly` with the same arguments
//    (stderr and exit code). Nearly all need the rest of the parser (item/stmt/expr/pat/ty/path), so
//    they are PENDING: they must stop with exactly the listed `rust-ts: unported: <what>` (exit 70)
//    after printing a prefix of the oracle's stderr. Root drops an entry once its case matches.
import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { DATA, REPO } from "../../../scripts/lib/common.ts";
import { ast, token, tokenstream } from "../../rustc_ast/lib.ts";
import type { Expr, Ty } from "../../rustc_ast/lib.ts";
import type { AssocOp } from "../../rustc_ast/util/parser.ts";
import * as pprust from "../../rustc_ast_pretty/pprust/mod.ts";
import { AnnotateSnippetEmitter } from "../../rustc_errors/annotate_snippet_emitter_writer.ts";
import { DiagCtxt, DiagCtxtFlags_default, FatalErrorMarker } from "../../rustc_errors/lib.ts";
import { ParseSess } from "../../rustc_session/parse.ts";
import type { Edition } from "../../rustc_span/edition.ts";
import { create_session_globals_then, type FileName, Span, type Spanned } from "../../rustc_span/lib.ts";
import { FilePathMapping, RealFileLoader, get_source_map } from "../../rustc_span/source_map.ts";
import { debug_Ident } from "../../rustc_span/symbol.ts";
import { debug_vec, PLAIN, PRETTY } from "../../std/fmt.ts";
import { Unported } from "../../std/panic.ts";
import { AutoStream, ColorChoice } from "../../vendor/anstream/lib.ts";
import { VecU8, dyn_write } from "../../vendor/anstream/stream.ts";
import { new_parser_from_source_str, unwrap_or_emit_fatal } from "../lib.ts";
import { debug_Attribute, debug_Recovered } from "../../rustc_ast/lib.ts";
import { InnerAttrPolicy } from "./attr.ts";
import type { SnapshotParser } from "./diagnostics.ts";
import type { Parser } from "./mod.ts";
import { exp, type ExpKeywordPair, type ExpTokenPair } from "./token_type.ts";

const { debug_Token } = token;
const { debug_TokenStream, debug_TokenTree } = tokenstream;

const EDITIONS: Record<string, Edition> = {
  "2015": "Edition2015",
  "2018": "Edition2018",
  "2021": "Edition2021",
  "2024": "Edition2024",
};

const INPUTS = () => ({
  file_loader: new RealFileLoader(),
  path_mapping: FilePathMapping.empty(),
  hash_kind: "Md5" as const,
  checksum_hash_kind: undefined,
});

// ---------------------------------------------------------------------------------------------
// A. probe cases
// ---------------------------------------------------------------------------------------------

interface ProbeCase {
  name: string;
  edition: string;
  ops: string;
  src: string;
  events: string[];
  fatal: boolean;
  stderr: string;
}
const probe = JSON.parse(readFileSync(new URL("./diagnostics_oracle.json", import.meta.url), "utf8")) as {
  cases: ProbeCase[];
};

/** probe case -> the `Unported` it must reach until the owning lane lands. */
const PENDING_PROBE: Record<string, string> = {
  // `prev_token` is `?`: expected `;` tries `maybe_recover_from_ternary_operator` (parse_expr).
};

const tok = (s: string): ExpTokenPair => {
  const e = (exp as Record<string, ExpTokenPair | ExpKeywordPair>)[s];
  if (e === undefined || !("tok" in e)) throw new Error(`tok ${s}`);
  return e;
};
const kw = (s: string): ExpKeywordPair => {
  const e = (exp as Record<string, ExpTokenPair | ExpKeywordPair>)[s];
  if (e === undefined || !("kw" in e)) throw new Error(`kw ${s}`);
  return e;
};

/** The probe's `run_ops`, ported. */
function run_ops(p: Parser, ops: string[], ev: string[]): void {
  let snap: SnapshotParser | undefined;
  for (const op of ops) {
    const i = op.indexOf(":");
    const name = i < 0 ? op : op.slice(0, i);
    const arg = i < 0 ? "" : op.slice(i + 1);
    let r: string;
    const err = (e: { emit(): void }): string => {
      e.emit();
      return "Err";
    };
    switch (name) {
      case "tok":
        r = `${debug_Token(p.token, PLAIN)} pos=${p.approx_token_stream_pos()}`;
        break;
      case "prev":
        r = debug_Token(p.prev_token, PLAIN);
        break;
      case "bump":
        p.bump();
        continue;
      case "look":
        r = p.look_ahead(Number(arg), (t) => debug_Token(t, PLAIN));
        break;
      case "check":
        r = String(p.check(tok(arg)));
        break;
      case "eat":
        r = String(p.eat(tok(arg)));
        break;
      case "is_kw":
        r = String(p.token.is_keyword(kw(arg).kw));
        break;
      case "ekw":
        r = String(p.eat_keyword(kw(arg)));
        break;
      case "expect": {
        const res = p.expect(tok(arg));
        r = res.$ === "Ok" ? `Ok(${debug_Recovered(res._0, PLAIN)})` : err(res._0);
        break;
      }
      case "expect_kw": {
        const res = p.expect_keyword(kw(arg));
        r = res.$ === "Ok" ? "Ok" : err(res._0);
        break;
      }
      case "unexpected": {
        const res = p.unexpected();
        r = res.$ === "Ok" ? "Ok" : err(res._0);
        break;
      }
      case "tt":
        r = debug_TokenTree(p.parse_token_tree(), PLAIN);
        break;
      case "tts":
        r = debug_TokenStream(p.parse_tokens(), PLAIN);
        break;
      case "ident": {
        const res = p.parse_ident();
        r = res.$ === "Ok" ? `Ok(${debug_Ident(res._0, PLAIN)})` : err(res._0);
        break;
      }
      case "field_name": {
        const res = p.parse_field_name();
        r = res.$ === "Ok" ? `Ok(${debug_Ident(res._0, PLAIN)})` : err(res._0);
        break;
      }
      case "inner_attrs": {
        const res = p.parse_inner_attributes();
        r = res.$ === "Ok" ? `Ok(${debug_vec(res._0, PRETTY, debug_Attribute)})` : err(res._0);
        break;
      }
      case "attr": {
        const res = p.parse_attribute(InnerAttrPolicy.Permitted);
        r = res.$ === "Ok" ? `Ok(${debug_Attribute(res._0, PRETTY)})` : err(res._0);
        break;
      }
      case "clear":
        p.clear_expected_token_types();
        continue;
      case "semi":
        r = String(p.maybe_consume_incorrect_semicolon(undefined));
        break;
      case "snap":
        snap = p.create_snapshot_for_diagnostic();
        continue;
      case "restore":
        p.restore_snapshot(snap!);
        snap = undefined;
        continue;
      default:
        throw new Error(`op ${op}`);
    }
    ev.push(`${op} => ${r}`);
  }
}
function run_probe_case(c: ProbeCase): { events: string[]; fatal: boolean; stderr: string } {
  const events: string[] = [];
  let fatal = false;
  let stderr = "";
  create_session_globals_then(EDITIONS[c.edition]!, [], INPUTS(), () => {
    const sm = get_source_map()!;
    const buf = new VecU8();
    let em = AnnotateSnippetEmitter.new(AutoStream.new(dyn_write(buf), ColorChoice.Never));
    em = AnnotateSnippetEmitter.sm(em, sm);
    em = AnnotateSnippetEmitter.ui_testing(em, true);
    const psess = ParseSess.with_dcx(DiagCtxt.new(em), sm);
    const fname: FileName = { $: "Real", _0: sm.path_mapping().to_real_filename(sm.working_dir(), "t.rs") };
    try {
      const p = unwrap_or_emit_fatal(new_parser_from_source_str(psess, fname, c.src, "Nothing"));
      run_ops(p, c.ops.split(/\s+/).filter((s) => s !== ""), events);
    } catch (e) {
      if (!(e instanceof FatalErrorMarker)) throw e;
      fatal = true;
    }
    psess.dcx().reset_err_count();
    stderr = new TextDecoder().decode(buf.bytes());
  });
  return { events, fatal, stderr };
}

for (const c of probe.cases) {
  test(`parser-diag probe: ${c.name}`, () => {
    let got: ReturnType<typeof run_probe_case> | undefined;
    let unported: string | undefined;
    try {
      got = run_probe_case(c);
    } catch (e) {
      if (!(e instanceof Unported)) throw e;
      unported = e.what;
    }
    if (unported !== undefined) {
      expect(PENDING_PROBE[c.name]).toBe(unported);
      return;
    }
    expect(PENDING_PROBE[c.name]).toBeUndefined();
    expect(got!.events).toEqual(c.events);
    expect(got!.fatal).toBe(c.fatal);
    expect(got!.stderr).toBe(c.stderr);
  });
}

// ---------------------------------------------------------------------------------------------
// B. direct cases (whole-program oracle, one diagnostics.rs call)
// ---------------------------------------------------------------------------------------------

interface DriverCase {
  edition: string;
  src: string;
  stderr: string;
  code: number;
}
const driver = JSON.parse(readFileSync(new URL("./diagnostics_driver.json", import.meta.url), "utf8")) as {
  cases: Record<string, DriverCase>;
};

/** Bumps until the `nth` token whose `pprust::token_to_string` is `text` (1-based); returns its span. */
function skip_to(p: Parser, text: string, nth = 1): Span {
  for (;;) {
    if (p.token.kind.$ === "Eof") throw new Error(`skip_to: no ${text}`);
    if (pprust.token_to_string(p.token) === text && --nth === 0) return p.token.span;
    p.bump();
  }
}

/** `ExprKind::Path` of the single-segment path at the current token; bumps past it. */
function path_expr(p: Parser): Expr {
  const ident = p.token.ident()![0];
  const span = p.token.span;
  p.bump();
  return new ast.Expr(ast.DUMMY_NODE_ID, { $: "Path", _0: undefined, _1: ast.Path.from_ident(ident) }, span, [], undefined);
}

/** Rebuilds `l1 <op> r1` and the outer comparison op as rustc's `parse_expr_assoc_rest_with` has them
 *  when it calls `check_no_chained_comparison` (just after bumping the outer op). */
function chained(p: Parser, first: string): { inner: Expr; outer: Spanned<AssocOp> } {
  skip_to(p, first);
  const l1 = path_expr(p);
  const op = { node: binop(p), span: p.token.span };
  p.bump();
  const r1 = path_expr(p);
  const outer: Spanned<AssocOp> = { node: { $: "Binary", _0: binop(p) }, span: p.token.span };
  p.bump();
  const inner = new ast.Expr(ast.DUMMY_NODE_ID, { $: "Binary", _0: op, _1: l1, _2: r1 }, Span.to(l1.span, r1.span), [], undefined);
  return { inner, outer };
}
function binop(p: Parser): ast.BinOpKind {
  const k: Record<string, ast.BinOpKind> = { Lt: "Lt", Gt: "Gt", Le: "Le", Ge: "Ge", EqEq: "Eq", Ne: "Ne" };
  return k[p.token.kind.$]!;
}

/** A type node for fns that only read `ty.span` (the kind is irrelevant to them). */
function ty_spanning(lo: Span, hi: Span): Ty {
  return new ast.Ty(ast.DUMMY_NODE_ID, { $: "Infer" }, Span.to(lo, hi));
}

interface Direct {
  run: (p: Parser) => void;
  /** The `Unported` reached after the diagnostic was emitted (code of another parser lane). */
  tail?: string;
}

const DIRECT: Record<string, Direct> = {
  // item.rs `parse_item_`: the first thing before the first item.
  vcs_marker: { run: (p) => p.recover_vcs_conflict_marker() },
  vcs_marker_diff3: { run: (p) => p.recover_vcs_conflict_marker() },
  // stmt.rs: `let x = 1` then `expect_semi` at the second `let`.
  semi_insert: {
    run: (p) => {
      skip_to(p, "let", 2);
      expect(p.expect_semi().$).toBe("Ok");
    },
  },
  colon_as_semi: {
    run: (p) => {
      skip_to(p, ":");
      expect(p.expect_semi().$).toBe("Ok");
    },
  },
  raw_str_terminators: {
    run: (p) => {
      skip_to(p, "#");
      expect(p.expect_semi().$).toBe("Ok");
    },
  },
  // expr.rs `parse_expr_bottom` at `try` (consume_block skips the nested parens).
  try_macro: {
    run: (p) => {
      skip_to(p, "try");
      p.try_macro_suggestion();
    },
    tail: "rustc_parse::parser::expr::Parser::mk_expr_err",
  },
  try_macro_empty: {
    run: (p) => {
      skip_to(p, "try");
      p.try_macro_suggestion();
    },
    tail: "rustc_parse::parser::expr::Parser::mk_expr_err",
  },
  expected_expression: {
    run: (p) => {
      skip_to(p, ";");
      p.expected_expression_found().emit();
    },
  },
  await_method_call: {
    run: (p) => {
      skip_to(p, "(", 2);
      p.recover_from_await_method_call();
    },
  },
  use_method_call: {
    run: (p) => {
      skip_to(p, "(", 2);
      p.recover_from_use();
    },
  },
  // ty.rs `parse_ty_common` (`AllowPlus::No`, `impl_dyn_multi`).
  ambiguous_plus_impl: {
    run: (p) => {
      const lo = skip_to(p, "impl");
      const hi = skip_to(p, "Send");
      p.bump();
      p.maybe_report_ambiguous_plus(true, ty_spanning(lo, hi));
    },
  },
  ambiguous_plus_dyn: {
    run: (p) => {
      const lo = skip_to(p, "dyn");
      const hi = skip_to(p, "Send");
      p.bump();
      p.maybe_report_ambiguous_plus(true, ty_spanning(lo, hi));
    },
  },
  // `a < b > c`: neither `foo<bar>::` nor `foo<bar>(`: help only, error returned.
  chain_turbofish_help: {
    run: (p) => {
      const { inner, outer } = chained(p, "a");
      const r = p.check_no_chained_comparison(inner, outer);
      expect(r.$).toBe("Err");
      if (r.$ === "Err") r._0.emit();
    },
  },
  // `foo<Bar>()`: consume_fn_args, emit, then the `ExprKind::Err` placeholder (expr lane).
  turbofish_call: {
    run: (p) => {
      const { inner, outer } = chained(p, "foo");
      p.check_no_chained_comparison(inner, outer);
    },
    tail: "rustc_parse::parser::expr::Parser::mk_expr",
  },
  // `a < b < c`: snapshot + consume_tts + restore, then the split suggestion.
  chain_split: {
    run: (p) => {
      const { inner, outer } = chained(p, "a");
      const r = p.check_no_chained_comparison(inner, outer);
      expect(r.$).toBe("Err");
      if (r.$ === "Err") r._0.emit();
    },
  },
  chain_eq_eq: {
    run: (p) => {
      const { inner, outer } = chained(p, "a");
      const r = p.check_no_chained_comparison(inner, outer);
      expect(r.$ === "Ok" && r._0 === undefined).toBe(true);
    },
  },
  // expr.rs `parse_dot_suffix` after `collect::<Vec<u8>>` (the `>>` closed both lists): a stray `>`
  // before `(`; eat_to_tokens skips it.
  unmatched_angle: {
    run: (p) => {
      skip_to(p, "collect");
      const seg = new ast.PathSegment(p.token.ident()![0], ast.DUMMY_NODE_ID, {
        $: "AngleBracketed",
        _0: { span: p.token.span, args: [] },
      });
      skip_to(p, ">");
      expect(p.check_trailing_angle_brackets(seg, [exp.OpenParen])).toBeDefined();
      expect(p.token.kind.$).toBe("OpenParen");
    },
  },
  // ty.rs `RecoverQuestionMark::Yes`: emit, then `mk_ty` (ty lane).
  question_in_type: {
    run: (p) => {
      const sp = skip_to(p, "u8");
      p.bump();
      p.maybe_recover_from_question_mark(ty_spanning(sp, sp));
    },
    tail: "rustc_parse::parser::ty::Parser::mk_ty",
  },
  dyn_question: {
    run: (p) => {
      const lo = skip_to(p, "Option");
      const hi = skip_to(p, ">");
      p.bump();
      p.maybe_recover_from_question_mark(ty_spanning(lo, hi));
    },
    tail: "rustc_parse::parser::ty::Parser::mk_ty",
  },
  // `let fn = 1;`: the binding's `parse_ident` (keyword as identifier, `r#` suggestion, recovered).
  kw_as_ident: {
    run: (p) => {
      skip_to(p, "fn", 2);
      expect(p.parse_ident().$).toBe("Ok");
    },
  },
};

function run_direct(c: DriverCase, d: Direct): { stderr: string; tail: string | undefined } {
  let tail: string | undefined;
  const stderr = create_session_globals_then(EDITIONS[c.edition]!, [], INPUTS(), () => {
    const sm = get_source_map()!;
    const buf = new VecU8();
    let em = AnnotateSnippetEmitter.new(AutoStream.new(dyn_write(buf), ColorChoice.Never));
    em = AnnotateSnippetEmitter.sm(em, sm);
    em = AnnotateSnippetEmitter.ui_testing(em, true);
    const dcx = DiagCtxt.new(em).with_flags({ ...DiagCtxtFlags_default(), can_emit_warnings: true });
    const psess = ParseSess.with_dcx(dcx, sm);
    const fname: FileName = { $: "Real", _0: sm.path_mapping().to_real_filename(sm.working_dir(), "t.rs") };
    try {
      const p = unwrap_or_emit_fatal(new_parser_from_source_str(psess, fname, c.src, "ShebangAndFrontmatter"));
      d.run(p);
    } catch (e) {
      if (e instanceof Unported) tail = e.what;
      else if (!(e instanceof FatalErrorMarker)) throw e;
    }
    psess.dcx().emit_stashed_diagnostics();
    psess.dcx().print_error_count();
    return new TextDecoder().decode(buf.bytes());
  });
  return { stderr, tail };
}

for (const [name, d] of Object.entries(DIRECT)) {
  test(`parser-diag direct: ${name}`, () => {
    const c = driver.cases[name]!;
    const got = run_direct(c, d);
    // `tail` may disappear once the owning lane lands; until then it must be exactly that one.
    if (got.tail !== undefined) expect(got.tail).toBe(d.tail!);
    expect(got.stderr).toBe(c.stderr);
  });
}

// ---------------------------------------------------------------------------------------------
// C. driver cases (`rust_ts/main.ts` vs `rustc`, -Zparse-crate-root-only)
// ---------------------------------------------------------------------------------------------

const PARSE_CRATE_MOD = "rustc_parse::parser::item::Parser::parse_crate_mod";
/** driver case -> the `Unported` it must stop at until the rest of the parser lands. */
const PENDING_DRIVER: Record<string, string> = {
  vcs_marker: PARSE_CRATE_MOD,
  vcs_marker_diff3: PARSE_CRATE_MOD,
  semi_insert: PARSE_CRATE_MOD,
  colon_as_semi: PARSE_CRATE_MOD,
  try_macro: PARSE_CRATE_MOD,
  try_macro_empty: PARSE_CRATE_MOD,
  expected_expression: PARSE_CRATE_MOD,
  await_method_call: PARSE_CRATE_MOD,
  use_method_call: PARSE_CRATE_MOD,
  ambiguous_plus_impl: PARSE_CRATE_MOD,
  ambiguous_plus_dyn: PARSE_CRATE_MOD,
  chain_turbofish_help: PARSE_CRATE_MOD,
  turbofish_call: PARSE_CRATE_MOD,
  turbofish_path: PARSE_CRATE_MOD,
  chain_split: PARSE_CRATE_MOD,
  chain_eq_eq: PARSE_CRATE_MOD,
  chain_eq_lt: PARSE_CRATE_MOD,
  chain_lt_eq: PARSE_CRATE_MOD,
  raw_str_terminators: PARSE_CRATE_MOD,
  question_in_type: PARSE_CRATE_MOD,
  kw_as_ident: PARSE_CRATE_MOD,
  expected_one_of_item: PARSE_CRATE_MOD,
  unexpected_after_path: PARSE_CRATE_MOD,
  post_increment: PARSE_CRATE_MOD,
  pre_increment: PARSE_CRATE_MOD,
  unmatched_angle: PARSE_CRATE_MOD,
  turbofish_missing_angle: PARSE_CRATE_MOD,
  turbofish_multi: PARSE_CRATE_MOD,
  struct_literal_no_path: PARSE_CRATE_MOD,
  struct_literal_consume_block: PARSE_CRATE_MOD,
  seq_parse_error: PARSE_CRATE_MOD,
  ternary: PARSE_CRATE_MOD,
  closing_generics: PARSE_CRATE_MOD,
  await_prefix: PARSE_CRATE_MOD,
  multi_ref_self: PARSE_CRATE_MOD,
  c_style_param: PARSE_CRATE_MOD,
  anon_param_2018: PARSE_CRATE_MOD,
  param_no_type: PARSE_CRATE_MOD,
  const_arg_braces: PARSE_CRATE_MOD,
  const_arg_eqeq: PARSE_CRATE_MOD,
  colon_colon_pat: PARSE_CRATE_MOD,
  block_label: PARSE_CRATE_MOD,
  unexpected_comma_pat: PARSE_CRATE_MOD,
  bad_qpath: PARSE_CRATE_MOD,
  public_fn: PARSE_CRATE_MOD,
  def_fn: PARSE_CRATE_MOD,
  async_move_2015: PARSE_CRATE_MOD,
  doc_comment_nothing: PARSE_CRATE_MOD,
  incorrect_semicolon: PARSE_CRATE_MOD,
  misspelled_struct: PARSE_CRATE_MOD,
  bad_type_plus: PARSE_CRATE_MOD,
  lifetime_before_type: PARSE_CRATE_MOD,
  raw_ref: PARSE_CRATE_MOD,
  dotdotlt: PARSE_CRATE_MOD,
  type_in_generic_param: PARSE_CRATE_MOD,
  self_not_first: PARSE_CRATE_MOD,
  const_param_decl: PARSE_CRATE_MOD,
  const_generic_old_syntax: PARSE_CRATE_MOD,
  c_string_2018: PARSE_CRATE_MOD,
  attr_on_non_tail: PARSE_CRATE_MOD,
  attr_cfg_chain: PARSE_CRATE_MOD,
  dyn_question: PARSE_CRATE_MOD,
  for_in_in: PARSE_CRATE_MOD,
  fat_arrow_ge: PARSE_CRATE_MOD,
  missing_let: PARSE_CRATE_MOD,
};

const WORK = join(DATA, "tmp", "parser-diag-driver", process.env.RUST_TS_AGENT ?? "default");

for (const [name, c] of Object.entries(driver.cases)) {
  test(`parser-diag driver: ${name}`, () => {
    const dir = join(WORK, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "t.rs"), c.src);
    const r = Bun.spawnSync(
      [process.execPath, join(REPO, "src/rust_ts/main.ts"), "-Zui-testing", "-Zparse-crate-root-only", "--edition", c.edition, "t.rs"],
      { cwd: dir, stdout: "pipe", stderr: "pipe" },
    );
    const stderr = r.stderr.toString();
    const pending = PENDING_DRIVER[name];
    const m = /rust-ts: unported: (.*)\n$/.exec(stderr);
    if (m !== null) {
      expect(r.exitCode).toBe(70);
      expect(m[1]).toBe(pending!);
      expect(c.stderr.startsWith(stderr.slice(0, m.index))).toBe(true);
      return;
    }
    expect(pending).toBeUndefined();
    expect(stderr).toBe(c.stderr);
    expect(r.exitCode).toBe(c.code);
  });
}

test("parser-diag: every PENDING/DIRECT entry names a case", () => {
  const names = new Set(probe.cases.map((c) => c.name));
  for (const n of Object.keys(PENDING_PROBE)) expect(names.has(n)).toBe(true);
  for (const n of [...Object.keys(DIRECT), ...Object.keys(PENDING_DRIVER)]) expect(driver.cases[n]).toBeDefined();
});
