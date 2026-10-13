// Scenario tests for lane parser-fn-asm: parser/asm.rs (`parse_asm_args` for `asm!`, `global_asm!` and
// `naked_asm!`: templates, every operand kind, named operands, `options(..)`, `clobber_abi(..)`,
// attributes on arguments, and the error cases).
//
// Expectations: `asm_oracle.json`, produced by the rustc-dev probe of `function_oracle.json` (`_how` /
// `_probe` / `_cases` in the fixture). The probe calls the real `rustc_parse::parser::asm::parse_asm_args`
// on `src` (the tokens inside `asm!(..)`) with `sp` = the first token's span, and prints every
// `AsmArg` (`AsmArg` has no `Debug`: kind / attributes / span, `AsmOption` field by field with the
// option bits as a number). Every event string and the full `-Zui-testing` stderr must match byte for
// byte.
//
// PENDING: `parse_asm_args` starts with `p.dcx()` (diagnostics.rs) and parses templates with
// `parse_expr` (expr.rs), so every full case throws exactly the listed `Unported` until those lanes
// land; then it must match the oracle and root drops it from PENDING.
// NARROW: `parse_options` (exported for this test) run on the `options(..)` parts of the same sources;
// each narrow event must equal the oracle event with the same key, and the stderr must match.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { type AsmMacro, debug_Attribute, debug_Expr, debug_InlineAsmOperand } from "../../rustc_ast/lib.ts";
import { AnnotateSnippetEmitter } from "../../rustc_errors/annotate_snippet_emitter_writer.ts";
import { DiagCtxt, FatalErrorMarker } from "../../rustc_errors/lib.ts";
import { ParseSess } from "../../rustc_session/parse.ts";
import { create_session_globals_then, debug_Span, type FileName } from "../../rustc_span/lib.ts";
import { FilePathMapping, RealFileLoader, get_source_map } from "../../rustc_span/source_map.ts";
import { debug_Symbol } from "../../rustc_span/symbol.ts";
import { debug_option, debug_tuple, debug_vec, type Fmt, PLAIN, PRETTY } from "../../std/fmt.ts";
import { Unported } from "../../std/panic.ts";
import { AutoStream, ColorChoice } from "../../vendor/anstream/lib.ts";
import { VecU8, dyn_write } from "../../vendor/anstream/stream.ts";
import { new_parser_from_source_str, unwrap_or_emit_fatal } from "../lib.ts";
import { type AsmArgKind, type AsmOption, parse_asm_args, parse_options } from "./asm.ts";
import type { Parser } from "./mod.ts";

interface Case {
  name: string;
  edition: string;
  ops: string;
  src: string;
  events: string[];
  fatal: boolean;
  stderr: string;
}
const oracle = JSON.parse(readFileSync(new URL("./asm_oracle.json", import.meta.url), "utf8")) as { cases: Case[] };

/** case -> the `Unported` its full script must reach until the owning lane lands. */
const PENDING: Record<string, string> = {
  asm_template: "rustc_parse::parser::expr::Parser::parse_expr",
  asm_trailing_comma: "rustc_parse::parser::expr::Parser::parse_expr",
  asm_operands: "rustc_parse::parser::expr::Parser::parse_expr",
  asm_const_sym_label: "rustc_parse::parser::expr::Parser::parse_expr",
  asm_named: "rustc_parse::parser::expr::Parser::parse_expr",
  asm_options: "rustc_parse::parser::expr::Parser::parse_expr",
  asm_clobber: "rustc_parse::parser::expr::Parser::parse_expr",
  asm_multi_templates: "rustc_parse::parser::expr::Parser::parse_expr",
  global_asm_options: "rustc_parse::parser::expr::Parser::parse_expr",
  global_asm_in: "rustc_parse::parser::expr::Parser::parse_expr",
  global_asm_out: "rustc_parse::parser::expr::Parser::parse_expr",
  global_asm_const_sym: "rustc_parse::parser::expr::Parser::parse_expr",
  naked_asm_inout: "rustc_parse::parser::expr::Parser::parse_expr",
  naked_asm_label: "rustc_parse::parser::expr::Parser::parse_expr",
  asm_underscore_in: "rustc_parse::parser::expr::Parser::parse_expr",
  asm_underscore_inout: "rustc_parse::parser::expr::Parser::parse_expr",
  asm_sym_no_path: "rustc_parse::parser::expr::Parser::parse_expr",
  asm_expected_comma: "rustc_parse::parser::expr::Parser::parse_expr",
  asm_expect_comma_after_operand: "rustc_parse::parser::expr::Parser::parse_expr",
  asm_template_after_operand: "rustc_parse::parser::expr::Parser::parse_expr",
  asm_expected_other: "rustc_parse::parser::expr::Parser::parse_expr",
  global_asm_expected_other: "rustc_parse::parser::expr::Parser::parse_expr",
  asm_bad_reg: "rustc_parse::parser::expr::Parser::parse_expr",
  asm_bad_reg_raw: "rustc_parse::parser::expr::Parser::parse_expr",
  asm_clobber_empty: "rustc_parse::parser::expr::Parser::parse_expr",
  asm_clobber_nonstr: "rustc_parse::parser::expr::Parser::parse_expr",
  asm_clobber_int: "rustc_parse::parser::expr::Parser::parse_expr",
  asm_option_bad: "rustc_parse::parser::expr::Parser::parse_expr",
  global_asm_option_bad: "rustc_parse::parser::expr::Parser::parse_expr",
  asm_options_missing_comma: "rustc_parse::parser::expr::Parser::parse_expr",
  asm_attrs: "rustc_parse::parser::path::Parser::parse_path",
};

/** case -> narrow script: `skip:N` bumps N tokens, `opts:<macro>:<k>` runs `parse_options` as argument `k`. */
const NARROW: Record<string, string> = {
  asm_options: "skip:3 opts:Asm:1 skip:2 opts:Asm:2",
  global_asm_options: "skip:3 opts:GlobalAsm:1",
};

const emit_err = (e: { emit(): void }): string => {
  e.emit();
  return "Err";
};

function debug_options(opts: readonly AsmOption[]): string {
  const v = opts.map(
    (o) =>
      `AsmOption { symbol: ${debug_Symbol(o.symbol, PLAIN)}, span: ${debug_Span(o.span, PLAIN)}, options: ${o.options}, span_with_comma: ${debug_Span(o.span_with_comma, PLAIN)} }`,
  );
  return `Options([${v.join(", ")}])`;
}

function debug_kind(k: AsmArgKind): string {
  switch (k.$) {
    case "Template":
      return `Template(${debug_Expr(k._0, PRETTY)})`;
    case "Operand":
      return `Operand(${debug_option(k._0, PLAIN, debug_Symbol)}, ${debug_InlineAsmOperand(k._1, PRETTY)})`;
    case "Options":
      return debug_options(k._0);
    case "ClobberAbi":
      return `ClobberAbi(${debug_vec(k._0, PLAIN, (t, f: Fmt) => debug_tuple(f, "", [debug_Symbol(t[0], f), debug_Span(t[1], f)]))})`;
  }
}

/** The probe's `run_ops` (the `asm` op), ported, plus the narrow ops. */
function run_ops(p: Parser, ops: string[], ev: string[]): void {
  for (const op of ops) {
    const parts = op.split(":");
    const name = parts[0]!;
    let r: string;
    switch (name) {
      case "asm": {
        const mac = parts[1] as AsmMacro;
        const sp = p.token.span;
        const res = parse_asm_args(p, sp, mac);
        if (res.$ === "Err") {
          r = emit_err(res._0);
        } else {
          res._0.forEach((a, n) => {
            ev.push(`arg${n}.kind => ${debug_kind(a.kind)}`);
            ev.push(`arg${n}.attributes => ${debug_vec(a.attributes._0, PRETTY, debug_Attribute)}`);
            ev.push(`arg${n}.span => ${debug_Span(a.span, PLAIN)}`);
          });
          r = `Ok(${res._0.length})`;
        }
        break;
      }
      // ---- narrow ops (TS only) ----
      case "skip":
        for (let n = 0; n < Number(parts[1]); n++) p.bump();
        continue;
      case "opts": {
        const res = parse_options(p, parts[1] as AsmMacro);
        ev.push(res.$ === "Ok" ? `arg${parts[2]}.kind => ${debug_options(res._0)}` : `opts => ${emit_err(res._0)}`);
        continue;
      }
      default:
        throw new Error(`op ${op}`);
    }
    ev.push(`${op} => ${r}`);
  }
}

function run_case(c: Case, ops: string): { events: string[]; fatal: boolean; stderr: string } {
  const inputs = {
    file_loader: new RealFileLoader(),
    path_mapping: FilePathMapping.empty(),
    hash_kind: "Md5" as const,
    checksum_hash_kind: undefined,
  };
  const events: string[] = [];
  let fatal = false;
  let stderr = "";
  expect(c.edition).toBe("2024");
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
      run_ops(p, ops.split(/\s+/).filter((s) => s !== ""), events);
    } catch (e) {
      if (!(e instanceof FatalErrorMarker)) throw e;
      fatal = true;
    }
    psess.dcx().reset_err_count();
    stderr = new TextDecoder().decode(buf.bytes());
  });
  return { events, fatal, stderr };
}

const key = (e: string): string => e.slice(0, e.indexOf(" => "));

for (const c of oracle.cases) {
  test(`parser-asm oracle: ${c.name}`, () => {
    let got: ReturnType<typeof run_case> | undefined;
    let unported: string | undefined;
    try {
      got = run_case(c, c.ops);
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

for (const c of oracle.cases.filter((c) => NARROW[c.name] !== undefined)) {
  test(`parser-asm narrow: ${c.name}`, () => {
    const got = run_case(c, NARROW[c.name]!);
    expect(got.events.length).toBeGreaterThan(0);
    for (const e of got.events) {
      expect(c.events.find((o) => key(o) === key(e))).toBe(e);
    }
    expect(got.fatal).toBe(false);
    expect(got.stderr).toBe(c.stderr);
  });
}

test("parser-asm: every NARROW/PENDING entry names a case", () => {
  const names = new Set(oracle.cases.map((c) => c.name));
  for (const n of [...Object.keys(NARROW), ...Object.keys(PENDING)]) expect(names.has(n)).toBe(true);
});
