// Scenario tests for lane parser-core (parser/mod.rs, token_type.rs, attr.rs, attr_wrapper.rs,
// nonterminal.rs, lib.rs): the token cursor (`bump`, `look_ahead`, `parse_token_tree(s)`), the
// expected-token bookkeeping (`check`/`eat`/`eat_keyword` + `TokenTypeSet`), `expect`, idents and
// field names, and attribute parsing.
//
// Expectations: `parser_core_oracle.json`, produced by a rustc-dev probe against the pinned nightly
// (`_how` / `_probe` / `_cases` in the fixture say how). `run_case` below is the probe's per-case body
// ported to the TS API; every event string and the full stderr must match byte for byte.
//
// PENDING: cases that reach code owned by a later parser lane (diagnostics.rs, path.rs, item.rs) must
// throw exactly the listed `Unported` until that lane lands; then they must match the oracle and root
// drops them from PENDING. For the "expected one of" cases the test also checks, while pending, the
// part this lane owns: the expected-token set at the failure point (as `expected_one_of_not_found`
// sorts, dedups and joins it) and `token_descr` must reproduce the oracle's message line.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { debug_Attribute } from "../../rustc_ast/lib.ts";
import { debug_Token } from "../../rustc_ast/token.ts";
import { debug_TokenStream, debug_TokenTree } from "../../rustc_ast/tokenstream.ts";
import { debug_Recovered } from "../../rustc_ast/lib.ts";
import { AnnotateSnippetEmitter } from "../../rustc_errors/annotate_snippet_emitter_writer.ts";
import { DiagCtxt, FatalErrorMarker } from "../../rustc_errors/lib.ts";
import { ParseSess } from "../../rustc_session/parse.ts";
import { create_session_globals_then, debug_Span, type FileName } from "../../rustc_span/lib.ts";
import { FilePathMapping, RealFileLoader, get_source_map } from "../../rustc_span/source_map.ts";
import { debug_Ident } from "../../rustc_span/symbol.ts";
import { debug_vec, PLAIN, PRETTY } from "../../std/fmt.ts";
import { Unported } from "../../std/panic.ts";
import { AutoStream, ColorChoice } from "../../vendor/anstream/lib.ts";
import { VecU8, dyn_write } from "../../vendor/anstream/stream.ts";
import { new_parser_from_source_str, unwrap_or_emit_fatal } from "../lib.ts";
import { InnerAttrPolicy } from "./attr.ts";
import { type Parser, token_descr } from "./mod.ts";
import { exp, type ExpKeywordPair, type ExpTokenPair, TokenType } from "./token_type.ts";

interface Case {
  name: string;
  ops: string;
  src: string;
  events: string[];
  fatal: boolean;
  stderr: string;
}
const oracle = JSON.parse(readFileSync(new URL("./parser_core_oracle.json", import.meta.url), "utf8")) as { cases: Case[] };

/** case -> the `Unported` it must reach until the owning lane lands. */
const PENDING: Record<string, string> = {
  expect_one_of: "rustc_parse::parser::diagnostics::Parser::expected_one_of_not_found",
  expect_one_of_kw: "rustc_parse::parser::diagnostics::Parser::expected_one_of_not_found",
  expect_one_of_many: "rustc_parse::parser::diagnostics::Parser::expected_one_of_not_found",
  expect_two: "rustc_parse::parser::diagnostics::Parser::expected_one_of_not_found",
  expect_after_check: "rustc_parse::parser::diagnostics::Parser::expected_one_of_not_found",
  expect_single: "rustc_parse::parser::diagnostics::Parser::unexpected_err",
  expect_kw_fail: "rustc_parse::parser::diagnostics::Parser::expected_one_of_not_found",
  expect_gt_glued: "rustc_parse::parser::diagnostics::Parser::expected_one_of_not_found",
  attr_outer: "rustc_parse::parser::path::Parser::parse_path",
  attr_inner: "rustc_parse::parser::path::Parser::parse_path",
  attr_unsafe: "rustc_parse::parser::path::Parser::parse_path",
  attr_eq: "rustc_parse::parser::path::Parser::parse_path",
  attr_shebang_like: "rustc_parse::parser::diagnostics::Parser::unexpected_err",
  outer_attrs_doc: "rustc_parse::parser::item::Parser::parse_item",
  outer_attrs_inner_doc_misplaced: "rustc_parse::parser::item::Parser::parse_item",
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

/** Test-side copy of `expected_one_of_not_found`'s message (diagnostics.rs:353..375), for the
 *  pending cases: `expected.sort_by_cached_key(to_string); dedup()` + `tokens_to_string`. */
function expected_message(p: Parser, extra?: TokenType): string {
  const set = p.expected_token_types.clone();
  if (extra !== undefined) set.insert(extra);
  const expected = [...set.iter()];
  expected.sort((a, b) => {
    const x = TokenType.to_string(a);
    const y = TokenType.to_string(b);
    return x < y ? -1 : x > y ? 1 : 0;
  });
  const dedup = expected.filter((t, i) => i === 0 || t !== expected[i - 1]);
  const strs = dedup.map((t) => TokenType.to_string(t));
  let b = strs[0] ?? "";
  for (let i = 0; i < strs.length - 1; i++) {
    if (strs.length > 2 && i === strs.length - 2) b += ", or ";
    else if (strs.length === 2 && i === strs.length - 2) b += " or ";
    else b += ", ";
    b += strs[i + 1];
  }
  const head = strs.length === 1 ? `expected ${b}` : `expected one of ${b}`;
  return `error: ${head}, found ${token_descr(p.token)}`;
}

/** The probe's `run_ops`, ported. `checks` collects the pending-case message checks. */
function run_ops(p: Parser, ops: string[], ev: string[], checks: string[]): void {
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
        if (!p.token.eq(tok(arg).tok)) checks.push(expected_message(p, tok(arg).token_type));
        const res = p.expect(tok(arg));
        r = res.$ === "Ok" ? `Ok(${debug_Recovered(res._0, PLAIN)})` : err(res._0);
        break;
      }
      case "expect_kw": {
        if (!p.token.is_keyword(kw(arg).kw)) checks.push(expected_message(p, kw(arg).token_type));
        const res = p.expect_keyword(kw(arg));
        r = res.$ === "Ok" ? "Ok" : err(res._0);
        break;
      }
      case "unexpected": {
        checks.push(expected_message(p));
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
      case "item_attrs": {
        const res = p.parse_item("No", "Yes");
        r = res.$ === "Err" ? err(res._0) : res._0 === undefined ? "None" : `Ok(${debug_vec(res._0.attrs, PRETTY, debug_Attribute)})`;
        break;
      }
      case "utis":
        r = debug_Span(p.token_uninterpolated_span(), PLAIN);
        break;
      case "clear":
        p.clear_expected_token_types();
        continue;
      default:
        throw new Error(`op ${op}`);
    }
    ev.push(`${op} => ${r}`);
  }
}

function run_case(c: Case): { events: string[]; fatal: boolean; stderr: string; checks: string[] } {
  const inputs = {
    file_loader: new RealFileLoader(),
    path_mapping: FilePathMapping.empty(),
    hash_kind: "Md5" as const,
    checksum_hash_kind: undefined,
  };
  const events: string[] = [];
  const checks: string[] = [];
  let fatal = false;
  let stderr = "";
  create_session_globals_then("Edition2024", [], inputs, () => {
    const sm = get_source_map()!;
    const buf = new VecU8();
    let em = AnnotateSnippetEmitter.new(AutoStream.new(dyn_write(buf), ColorChoice.Never));
    em = AnnotateSnippetEmitter.sm(em, sm);
    em = AnnotateSnippetEmitter.ui_testing(em, true);
    const psess = ParseSess.with_dcx(DiagCtxt.new(em), sm);
    const fname: FileName = { $: "Real", _0: sm.path_mapping().to_real_filename(sm.working_dir(), "t.rs") };
    try {
      const p = unwrap_or_emit_fatal(new_parser_from_source_str(psess, fname, c.src, "Nothing"));
      run_ops(p, c.ops.split(/\s+/).filter((s) => s !== ""), events, checks);
    } catch (e) {
      if (!(e instanceof FatalErrorMarker)) throw e;
      fatal = true;
    }
    psess.dcx().reset_err_count();
    stderr = new TextDecoder().decode(buf.bytes());
  });
  return { events, fatal, stderr, checks };
}

for (const c of oracle.cases) {
  test(`parser-core oracle: ${c.name}`, () => {
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

// The part of the pending "expected one of" cases this lane owns: the expected-token set built by
// `check`/`eat`/`eat_keyword`/`expect` (TokenTypeSet + TokenType::to_string) and `token_descr`.
for (const c of oracle.cases.filter((c) => /^expect_/.test(c.name) && c.stderr !== "")) {
  test(`parser-core expected-token set: ${c.name}`, () => {
    // Re-run up to the failing op, catching the Unported of the message builder.
    const ops = c.ops.split(/\s+/).filter((s) => s !== "");
    const checks: string[] = [];
    const inputs = {
      file_loader: new RealFileLoader(),
      path_mapping: FilePathMapping.empty(),
      hash_kind: "Md5" as const,
      checksum_hash_kind: undefined,
    };
    create_session_globals_then("Edition2024", [], inputs, () => {
      const sm = get_source_map()!;
      const buf = new VecU8();
      const em = AnnotateSnippetEmitter.sm(AnnotateSnippetEmitter.new(AutoStream.new(dyn_write(buf), ColorChoice.Never)), sm);
      const psess = ParseSess.with_dcx(DiagCtxt.new(em), sm);
      const fname: FileName = { $: "Real", _0: sm.path_mapping().to_real_filename(sm.working_dir(), "t.rs") };
      const p = unwrap_or_emit_fatal(new_parser_from_source_str(psess, fname, c.src, "Nothing"));
      try {
        run_ops(p, ops, [], checks);
      } catch (e) {
        if (!(e instanceof Unported)) throw e;
      }
      psess.dcx().reset_err_count();
    });
    expect(checks.length).toBeGreaterThan(0);
    expect(checks[checks.length - 1]).toBe(c.stderr.split("\n")[0]!);
  });
}
