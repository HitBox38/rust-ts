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
