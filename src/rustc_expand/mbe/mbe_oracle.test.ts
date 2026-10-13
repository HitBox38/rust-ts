// Oracle scenarios for lane mbe-a: `quoted::parse_one_tt` (macro definitions -> mbe token trees, fragment
// specifiers per edition, meta-variable expressions, Kleene operators and their errors),
// `macro_check::check_meta_variables` (+ the `meta_variable_misuse` lints), `macro_parser::{compute_locs,
// count_metavar_decls}`, the NFA matcher `TtParser::parse_tt` (bindings, repetitions, ambiguity, failure,
// non-terminal parse errors) and `MetaVarExpr::parse`.
//
// Expectations: mbe_oracle/out.json, produced by the probe in mbe_oracle/ (main.rs + macro_rules.rs; it
// compiles the pinned upstream mbe sources against the pinned nightly's rustc-dev; how to rebuild it is
// in main.rs) over mbe_oracle/cases.txt. `run_case` below is the probe's driver ported to the TS API;
// every event string, the fatal flag and the full -Zui-testing stderr must match byte for byte.
//
// The `Session` is a stand-in holding the `ParseSess` and default options with the case's edition
// (as in attr_oracle.test.ts): `feature_err` reads only those.
//
// PENDING: cases that reach code owned by another lane must throw exactly the listed `Unported` until
// that lane lands; then they must match the oracle and root drops them from PENDING.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CRATE_NODE_ID, DUMMY_NODE_ID } from "../../rustc_ast/node_id.ts";
import { debug_Token } from "../../rustc_ast/token.ts";
import { type TokenStream, TokenStream as TokenStreamC, type TokenTree as TT } from "../../rustc_ast/tokenstream.ts";
import { debug_MultiSpan } from "../../rustc_error_messages/lib.gen.ts";
import { AnnotateSnippetEmitter } from "../../rustc_errors/annotate_snippet_emitter_writer.ts";
import { DiagCtxt, FatalErrorMarker } from "../../rustc_errors/lib.ts";
import { Features, UnstableFeatures } from "../../rustc_feature/lib.ts";
import { MACRO_ARGUMENTS, parser as rustc_parse_parser, source_str_to_stream } from "../../rustc_parse/lib.ts";
import type { Recovery } from "../../rustc_parse/parser/mod.ts";
import { Options_default } from "../../rustc_session/config.ts";
import { EarlySession, Session } from "../../rustc_session/lib.ts";
import { ParseSess } from "../../rustc_session/parse.ts";
import type { Edition } from "../../rustc_span/edition.ts";
import { create_session_globals_then, DUMMY_SP, debug_ErrorGuaranteed, type FileName } from "../../rustc_span/lib.ts";
import { FilePathMapping, get_source_map, RealFileLoader } from "../../rustc_span/source_map.ts";
import { display_Ident, MacroRulesNormalizedIdent, Symbol } from "../../rustc_span/symbol.ts";
import { debug_option, PLAIN } from "../../std/fmt.ts";
import { Unported, unwrap } from "../../std/panic.ts";
import { debug_result } from "../../std/result.ts";
import { AutoStream, ColorChoice } from "../../vendor/anstream/lib.ts";
import { dyn_write, VecU8 } from "../../vendor/anstream/stream.ts";
import { debug_TokenTree, type TokenTree } from "../mbe.ts";
import { check_meta_variables } from "./macro_check.ts";
import {
  compute_locs,
  count_metavar_decls,
  CowParser,
  debug_MatcherLoc,
  debug_NamedMatch,
  display_MatcherLoc,
  type MatcherLoc,
  type NamedParseResult,
  type Tracker,
  TtParser,
} from "./macro_parser.ts";
import { debug_MetaVarExpr, MetaVarExpr } from "./metavar_expr.ts";
import { parse_one_tt, RulePart } from "./quoted.ts";

interface Case {
  name: string;
  head: string;
  ops: string;
  src: string;
  events: string[];
  fatal: boolean;
  stderr: string;
}
const oracle = JSON.parse(readFileSync(join(import.meta.dir, "mbe_oracle", "out.json"), "utf8")) as Case[];

/** case -> the `Unported` it must reach until the owning lane lands. */
const PENDING: Record<string, string> = {};

/** `parser_from_cx` (macro_rules.rs, lane mbe-b), as copied into the probe. */
function parser_from_cx(psess: ParseSess, tts: TokenStream, recovery: Recovery): rustc_parse_parser.Parser {
  tts.desugar_doc_comments();
  return rustc_parse_parser.Parser.new(psess, tts, MACRO_ARGUMENTS).recovery(recovery);
}

/** The probe's recording `Tracker`. */
class Rec implements Tracker {
  ev: string[] = [];
  constructor(private readonly locs: readonly MatcherLoc[]) {}
  before_match_loc(parser: TtParser, matcher: MatcherLoc): void {
    const idx = this.locs.indexOf(matcher);
    if (idx < 0) throw new Error("before_match_loc: loc not in matcher");
    this.ev.push(`b${idx}${parser.has_no_remaining_items_for_step() ? "!" : ""}`);
  }
  matched_one(_parser: rustc_parse_parser.Parser, loc_index: number): void {
    this.ev.push(`m${loc_index}`);
  }
  failure(parser: rustc_parse_parser.Parser): void {
    this.ev.push(`failure ${debug_Token(parser.token, PLAIN)}`);
  }
  ambiguity(parser: rustc_parse_parser.Parser): void {
    this.ev.push(`ambiguity ${debug_Token(parser.token, PLAIN)}`);
  }
}

function inner_stream(t: TT): TokenStream {
  if (t.$ !== "Delimited") throw new Error("tree is not delimited");
  return t._3;
}

/** `TokenStream::clone` (an `Arc` clone: the trees are shared). */
function clone_stream(ts: TokenStream): TokenStream {
  return new TokenStreamC(ts._0);
}

function lhs_tts(lhs: TokenTree | undefined): TokenTree[] {
  if (lhs === undefined || lhs.$ !== "Delimited") throw new Error("no delimited lhs");
  return lhs._2.tts;
}

function result_str(res: NamedParseResult, locs: readonly MatcherLoc[]): string {
  switch (res.$) {
    case "Success": {
      let s = "Success";
      for (const loc of locs) {
        if (loc.$ === "MetaVarDecl") {
          const nm = unwrap(res._0.get(MacroRulesNormalizedIdent.new(loc.bind)));
          s += ` $${display_Ident(loc.bind)}=${debug_NamedMatch(nm, PLAIN)}`;
        }
      }
      return s;
    }
    case "Failure":
      return "Failure";
    case "Ambiguity":
      return "Ambiguity";
    case "ErrorReported":
      return `ErrorReported(${debug_ErrorGuaranteed(res._0, PLAIN)})`;
  }
}

function test_session(psess: ParseSess, edition: Edition): Session {
  const sess = Object.create(Session.prototype) as Session;
  // PORT(test): `feature_err` reads `sess.opts` (`ui_testing`, `unstable_features`) and
  // `sess.unstable_features`: the probe's `Options::default()` with the case's edition, and
  // `UnstableFeatures::from_environment(None)` as in `build_session`.
  const opts = Options_default();
  opts.edition = edition;
  sess.early_sess = new EarlySession(undefined as never, undefined as never, opts, psess);
  sess.unstable_features = UnstableFeatures.from_environment(undefined);
  return sess;
}

function run_case(c: Case): { events: string[]; fatal: boolean; stderr: string } {
  const words = c.head.split(/\s+/).filter((w) => w !== "");
  let edition: Edition = "Edition2024";
  let feats: string[] = [];
  for (const w of words.slice(1)) {
    if (w.startsWith("edition=")) edition = `Edition${w.slice("edition=".length)}` as Edition;
    else if (w.startsWith("features=")) feats = w.slice("features=".length).split(",");
    else throw new Error(`head word ${w}`);
  }
  const inputs = {
    file_loader: new RealFileLoader(),
    path_mapping: FilePathMapping.empty(),
    hash_kind: "Md5" as const,
    checksum_hash_kind: undefined,
  };
  const ev: string[] = [];
  let fatal = false;
  let stderr = "";
  const ops = c.ops.split(/\s+/).filter((s) => s !== "");
  create_session_globals_then(edition, [], inputs, () => {
    const sm = get_source_map()!;
    const buf = new VecU8();
    let em = AnnotateSnippetEmitter.new(AutoStream.new(dyn_write(buf), ColorChoice.Never));
    em = AnnotateSnippetEmitter.sm(em, sm);
    em = AnnotateSnippetEmitter.ui_testing(em, true);
    const psess = ParseSess.with_dcx(DiagCtxt.new(em), sm);
    const sess = test_session(psess, edition);
    const fname: FileName = { $: "Real", _0: sm.path_mapping().to_real_filename(sm.working_dir(), "t.rs") };
    const features = Features.default();
    for (const f of feats) {
      features.set_enabled_lang_feature({ gate_name: Symbol.intern(f), attr_sp: DUMMY_SP, stable_since: undefined });
    }
    try {
      const sr = source_str_to_stream(psess, fname, c.src, undefined);
      if (sr.$ === "Err") {
        for (const e of sr._0) e.emit();
        ev.push("lex => Err");
        return;
      }
      const trees: TT[] = [...sr._0._0];
      let lhs: TokenTree | undefined;
      let rhs: TokenTree | undefined;
      for (const op of ops) {
        const i = op.indexOf(":");
        const name = i < 0 ? op : op.slice(0, i);
        const arg = i < 0 ? "" : op.slice(i + 1);
        const idx = (): number => Number(arg);
        switch (name) {
          case "lhs":
          case "rhs": {
            const part = name === "lhs" ? RulePart.Pattern : RulePart.Body;
            const tt = parse_one_tt(trees[idx()]!, part, sess, CRATE_NODE_ID, features, edition);
            ev.push(`${op} => ${debug_TokenTree(tt, PLAIN)}`);
            if (name === "lhs") lhs = tt;
            else rhs = tt;
            break;
          }
          case "check":
          case "checkd": {
            const node_id = name === "check" ? CRATE_NODE_ID : DUMMY_NODE_ID;
            const r = check_meta_variables(psess, node_id, undefined, lhs!, rhs!);
            ev.push(`${op} => ${debug_result(r, PLAIN, () => "()", debug_ErrorGuaranteed)}`);
            break;
          }
          case "locs": {
            const locs = compute_locs(lhs_tts(lhs));
            locs.forEach((l, i) => ev.push(`loc ${i} => ${debug_MatcherLoc(l, PLAIN)} | ${display_MatcherLoc(l)}`));
            break;
          }
          case "count":
            ev.push(`${op} => ${count_metavar_decls(lhs_tts(lhs))}`);
            break;
          case "match":
          case "matchr": {
            const recovery = name === "match" ? "Forbidden" : "Allowed";
            const locs = compute_locs(lhs_tts(lhs));
            const parser = parser_from_cx(psess, clone_stream(inner_stream(trees[idx()]!)), recovery);
            const rec = new Rec(locs);
            const tt_parser = TtParser.new();
            const cow = CowParser.Borrowed(parser);
            const res = tt_parser.parse_tt(cow, locs, rec);
            ev.push(`${op} trace => ${rec.ev.join(" ")}`);
            ev.push(`${op} => ${result_str(res, locs)}`);
            ev.push(`${op} tok => ${debug_Token(cow.get().token, PLAIN)} owned=${cow.is_owned()}`);
            break;
          }
          case "mve": {
            const t = trees[idx()]!;
            if (t.$ !== "Delimited") throw new Error("mve tree");
            const r = MetaVarExpr.parse(t._3, t._0.entire(), psess);
            if (r.$ === "Ok") {
              ev.push(`${op} => Ok(${debug_MetaVarExpr(r._0, PLAIN)})`);
            } else {
              r._0.emit();
              ev.push(`${op} => Err`);
            }
            break;
          }
          case "lints": {
            for (const l of psess.buffered_lints) {
              ev.push(`buffered ${l.lint_id.lint.name} ${debug_option(l.span, PLAIN, debug_MultiSpan)}`);
            }
            const lints = psess.buffered_lints.splice(0);
            for (const l of lints) {
              const diag = l.diagnostic._0(psess.dcx(), { $: "Warning", _0: undefined }, sess);
              if (l.span !== undefined) {
                diag.span(l.span);
              }
              diag.emit();
            }
            break;
          }
          default:
            throw new Error(`op ${op}`);
        }
      }
    } catch (e) {
      if (!(e instanceof FatalErrorMarker)) throw e;
      fatal = true;
    } finally {
      psess.dcx().reset_err_count();
      stderr = new TextDecoder().decode(buf.bytes());
    }
  });
  return { events: ev, fatal, stderr };
}

for (const c of oracle) {
  test(`mbe-a oracle: ${c.name}`, () => {
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

test("mbe-a oracle: every PENDING entry names a case", () => {
  const names = new Set(oracle.map((c) => c.name));
  for (const k of Object.keys(PENDING)) expect(names.has(k)).toBe(true);
});
