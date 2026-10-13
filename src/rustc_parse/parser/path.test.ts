// Oracle tests for parser/path.rs (lane parser-ptg): `Parser::parse_path` in every `PathStyle` on
// small inputs (plain, global and keyword segments, generic args with lifetimes/types/consts,
// associated item constraints, parenthesized and `(..)` args, `::<>`, recovery paths).
//
// Expectations: `ptg_oracle.json` (cases `path_*`), produced by a rustc-dev probe against the pinned
// nightly (`_how` / `_probe` / `_cases` in the fixture). `run_case` is the probe's per-case body on
// the TS API: the `{:#?}` Debug of the result, the next token and the full `-Zui-testing` stderr must
// match byte for byte.
//
// PENDING: cases whose path reaches a method of another parser lane that has not landed yet must
// throw exactly the listed `Unported`; once that lane lands they must match the oracle, and root
// drops them from PENDING (the test fails until then, so nothing passes silently).
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { debug_Generics, debug_Path, debug_Ty, type Generics, token } from "../../rustc_ast/lib.ts";
import { AnnotateSnippetEmitter } from "../../rustc_errors/annotate_snippet_emitter_writer.ts";
import { DiagCtxt, FatalErrorMarker } from "../../rustc_errors/lib.ts";
import { ParseSess } from "../../rustc_session/parse.ts";
import type { Edition } from "../../rustc_span/edition.ts";
import { create_session_globals_then, type FileName } from "../../rustc_span/lib.ts";
import { FilePathMapping, get_source_map, RealFileLoader } from "../../rustc_span/source_map.ts";
import { PLAIN, PRETTY } from "../../std/fmt.ts";
import { Unported } from "../../std/panic.ts";
import { AutoStream, ColorChoice } from "../../vendor/anstream/lib.ts";
import { dyn_write, VecU8 } from "../../vendor/anstream/stream.ts";
import { new_parser_from_source_str, unwrap_or_emit_fatal } from "../lib.ts";
import type { Parser } from "./mod.ts";
import type { PathStyle } from "./path.ts";

const PREFIX = "path_";

/** case -> the `Unported` it must reach until the owning lane lands. */
const PENDING: Record<string, string> = {
  path_triple_colon: "rustc_parse::parser::diagnostics::Parser::dcx",
  path_expr_single_colon: "rustc_parse::parser::diagnostics::Parser::check_trailing_angle_brackets",
  path_expr_turbofish: "rustc_parse::parser::diagnostics::Parser::create_snapshot_for_diagnostic",
  path_pat_simple: "rustc_parse::parser::diagnostics::Parser::check_trailing_angle_brackets",
  path_type_args: "rustc_parse::parser::diagnostics::Parser::create_snapshot_for_diagnostic",
  path_type_turbofish: "rustc_parse::parser::diagnostics::Parser::create_snapshot_for_diagnostic",
  path_nested_args: "rustc_parse::parser::diagnostics::Parser::create_snapshot_for_diagnostic",
  path_lifetime_args: "rustc_parse::parser::diagnostics::Parser::create_snapshot_for_diagnostic",
  path_assoc_eq: "rustc_parse::parser::diagnostics::Parser::create_snapshot_for_diagnostic",
  path_assoc_bound: "rustc_parse::parser::diagnostics::Parser::create_snapshot_for_diagnostic",
  path_assoc_gat: "rustc_parse::parser::diagnostics::Parser::create_snapshot_for_diagnostic",
  path_assoc_const_eq: "rustc_parse::parser::diagnostics::Parser::create_snapshot_for_diagnostic",
  path_const_args: "rustc_parse::parser::expr::Parser::parse_expr_res",
  path_paren_args: "rustc_parse::parser::diagnostics::Parser::dcx",
  path_paren_args_empty: "rustc_parse::parser::diagnostics::Parser::dcx",
  path_paren_args_sep: "rustc_parse::parser::diagnostics::Parser::dcx",
  path_rtn_output: "rustc_parse::parser::expr::Parser::is_builtin",
  path_unterminated: "rustc_parse::parser::diagnostics::Parser::create_snapshot_for_diagnostic",
  path_unterminated_constraint: "rustc_parse::parser::diagnostics::Parser::create_snapshot_for_diagnostic",
  path_for_on_assoc: "rustc_parse::parser::diagnostics::Parser::create_snapshot_for_diagnostic",
  path_missing_type_eq: "rustc_parse::parser::diagnostics::Parser::create_snapshot_for_diagnostic",
  path_missing_type_eq_other: "rustc_parse::parser::diagnostics::Parser::create_snapshot_for_diagnostic",
  path_lifetime_eq: "rustc_parse::parser::diagnostics::Parser::create_snapshot_for_diagnostic",
  path_lifetime_eq_gat: "rustc_parse::parser::diagnostics::Parser::create_snapshot_for_diagnostic",
  path_semi_sep: "rustc_parse::parser::diagnostics::Parser::create_snapshot_for_diagnostic",
  path_shl: "rustc_parse::parser::diagnostics::Parser::create_snapshot_for_diagnostic",
  path_expr_call_sep: "rustc_parse::parser::diagnostics::Parser::create_snapshot_for_diagnostic",
  path_lifetime_before_type: "rustc_parse::parser::diagnostics::Parser::handle_lifetime_arg_preceding_type",
  path_invalid_const_expr: "rustc_parse::parser::expr::Parser::parse_expr_res",
};

interface Case {
  name: string;
  ops: string;
  ts: string;
  edition: string;
  src: string;
  events: string[];
  fatal: boolean;
  stderr: string;
}
const oracle = JSON.parse(readFileSync(new URL("./ptg_oracle.json", import.meta.url), "utf8")) as { cases: Case[] };

/** The probe's `run_ops`, ported; `gen`/`where` are the TS side of `item_generics`. */
function run_ops(p: Parser, ops: string[], ev: string[]): void {
  let generics: Generics | undefined;
  for (const op of ops) {
    const i = op.indexOf(":");
    const name = i < 0 ? op : op.slice(0, i);
    const arg = i < 0 ? "" : op.slice(i + 1);
    let r: string;
    switch (name) {
      case "tok":
        r = token.debug_Token(p.token, PLAIN);
        break;
      case "bump":
        p.bump();
        continue;
      case "ty": {
        const res = p.parse_ty();
        if (res.$ === "Err") {
          res._0.emit();
          r = "Err";
        } else r = `Ok(${debug_Ty(res._0, PRETTY)})`;
        break;
      }
      case "path": {
        const res = p.parse_path(arg as PathStyle);
        if (res.$ === "Err") {
          res._0.emit();
          r = "Err";
        } else r = `Ok(${debug_Path(res._0, PRETTY)})`;
        break;
      }
      case "gen": {
        const res = p.parse_generics();
        if (res.$ === "Err") {
          res._0.emit();
          ev.push("item_generics => Err");
          return;
        }
        generics = res._0;
        continue;
      }
      case "where": {
        const res = p.parse_where_clause();
        if (res.$ === "Err") {
          res._0.emit();
          ev.push("item_generics => Err");
          return;
        }
        generics!.where_clause = res._0;
        ev.push(`item_generics => Ok(${debug_Generics(generics!, PRETTY)})`);
        continue;
      }
      default:
        throw new Error(`op ${op}`);
    }
    ev.push(`${op} => ${r}`);
  }
}

function run_case(c: Case): { events: string[]; fatal: boolean; stderr: string } {
  const inputs = {
    file_loader: new RealFileLoader(),
    path_mapping: FilePathMapping.empty(),
    hash_kind: "Md5" as const,
    checksum_hash_kind: undefined,
  };
  const events: string[] = [];
  let fatal = false;
  let stderr = "";
  create_session_globals_then(`Edition${c.edition}` as Edition, [], inputs, () => {
    const sm = get_source_map()!;
    const buf = new VecU8();
    let em = AnnotateSnippetEmitter.new(AutoStream.new(dyn_write(buf), ColorChoice.Never));
    em = AnnotateSnippetEmitter.sm(em, sm);
    em = AnnotateSnippetEmitter.ui_testing(em, true);
    const psess = ParseSess.with_dcx(DiagCtxt.new(em), sm);
    const fname: FileName = { $: "Real", _0: sm.path_mapping().to_real_filename(sm.working_dir(), "t.rs") };
    try {
      const p = unwrap_or_emit_fatal(new_parser_from_source_str(psess, fname, c.src, "Nothing"));
      const ops = (c.ts !== "" ? c.ts : c.ops).split(/\s+/).filter((s) => s !== "");
      run_ops(p, ops, events);
    } catch (e) {
      if (!(e instanceof FatalErrorMarker)) throw e;
      fatal = true;
    }
    psess.dcx().reset_err_count();
    stderr = new TextDecoder().decode(buf.bytes());
  });
  return { events, fatal, stderr };
}

const cases = oracle.cases.filter((c) => c.name.startsWith(PREFIX));

test(`${PREFIX} oracle cases exist and PENDING names are cases`, () => {
  expect(cases.length).toBeGreaterThan(0);
  for (const name of Object.keys(PENDING)) expect(cases.some((c) => c.name === name)).toBe(true);
});

for (const c of cases) {
  test(`parser-ptg oracle: ${c.name}`, () => {
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
