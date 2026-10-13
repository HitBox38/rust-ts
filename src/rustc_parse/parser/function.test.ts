// Scenario tests for lane parser-fn-asm: parser/function.rs (fn front matter, params, self params,
// return types, bodies) and parser/cfg_select.rs.
//
// Expectations: `function_oracle.json`, produced by a rustc-dev probe against the pinned nightly
// (`_how` / `_probe` / `_cases` in the fixture say how). Each case parses `src` as `t.rs` in its edition
// and runs an op script; `run_ops` below is the probe's per-op body ported to the TS API. Every event
// string and the full `-Zui-testing` stderr must match byte for byte.
//
// Two checks per case:
// - full: the probe's own script (`item` = `parse_item`, `ty` = `parse_ty`, `cfgsel`, ...). Cases
//   that reach code owned by another parser lane must throw exactly the listed `Unported` (PENDING)
//   until that lane lands; then they must match and root drops them from PENDING.
// - narrow (NARROW): the narrowest entry point this lane owns (`parse_fn_front_matter`,
//   `parse_param_general`) run on the same source. Each narrow event must equal the oracle event with
//   the same key (`header`, `param0`, `fnptr.safety`, `gated:<feature>`), and the stderr must equal
//   the oracle's (the narrow cases are chosen so that every diagnostic comes from the narrow part).
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { debug_Extern, debug_FnHeader, debug_FnRetTy, debug_Item, debug_ItemKind, debug_Param, debug_Safety, debug_Ty, debug_Visibility, type Visibility } from "../../rustc_ast/lib.ts";
import { token, tokenstream } from "../../rustc_ast/lib.ts";
import { Case as AstCase } from "../../rustc_ast/util/case.ts";
import { AnnotateSnippetEmitter } from "../../rustc_errors/annotate_snippet_emitter_writer.ts";
import { DiagCtxt, FatalErrorMarker } from "../../rustc_errors/lib.ts";
import { ParseSess } from "../../rustc_session/parse.ts";
import type { Edition } from "../../rustc_span/edition.ts";
import { create_session_globals_then, debug_Span, DUMMY_SP, type FileName } from "../../rustc_span/lib.ts";
import { FilePathMapping, RealFileLoader, get_source_map } from "../../rustc_span/source_map.ts";
import { debug_Ident, Symbol } from "../../rustc_span/symbol.ts";
import { debug_list, debug_option, PLAIN, PRETTY } from "../../std/fmt.ts";
import { Unported } from "../../std/panic.ts";
import { AutoStream, ColorChoice } from "../../vendor/anstream/lib.ts";
import { VecU8, dyn_write } from "../../vendor/anstream/stream.ts";
import { new_parser_from_source_str, unwrap_or_emit_fatal } from "../lib.ts";
import type { FnParseMode, FrontMatterParsingMode } from "./function.ts";
import { FollowedByType, type Parser } from "./mod.ts";

const { debug_Token } = token;
const { debug_TokenStream } = tokenstream;

interface Case {
  name: string;
  edition: string;
  ops: string;
  src: string;
  events: string[];
  fatal: boolean;
  stderr: string;
}
const oracle = JSON.parse(readFileSync(new URL("./function_oracle.json", import.meta.url), "utf8")) as { cases: Case[] };

/** case -> the `Unported` its full script must reach until the owning lane lands. */
const PENDING: Record<string, string> = {
  fm_plain: "rustc_parse::parser::item::Parser::parse_item",
  fm_const: "rustc_parse::parser::item::Parser::parse_item",
  fm_async: "rustc_parse::parser::item::Parser::parse_item",
  fm_unsafe: "rustc_parse::parser::item::Parser::parse_item",
  fm_safe: "rustc_parse::parser::item::Parser::parse_item",
  fm_const_async_unsafe: "rustc_parse::parser::item::Parser::parse_item",
  fm_async_unsafe: "rustc_parse::parser::item::Parser::parse_item",
  fm_const_unsafe: "rustc_parse::parser::item::Parser::parse_item",
  fm_pub_const_async_safe: "rustc_parse::parser::item::Parser::parse_item",
  fm_async_2015: "rustc_parse::parser::item::Parser::parse_item",
  fm_async_unsafe_2015: "rustc_parse::parser::item::Parser::parse_item",
  fm_gen: "rustc_parse::parser::item::Parser::parse_item",
  fm_async_gen: "rustc_parse::parser::item::Parser::parse_item",
  fm_const_gen_unsafe: "rustc_parse::parser::item::Parser::parse_item",
  fm_extern: "rustc_parse::parser::item::Parser::parse_item",
  fm_extern_abi: "rustc_parse::parser::item::Parser::parse_item",
  fm_const_unsafe_extern_abi: "rustc_parse::parser::item::Parser::parse_item",
  fm_unsafe_const: "rustc_parse::parser::item::Parser::parse_item",
  fm_unsafe_async: "rustc_parse::parser::item::Parser::parse_item",
  fm_async_const: "rustc_parse::parser::item::Parser::parse_item",
  fm_extern_unsafe: "rustc_parse::parser::item::Parser::parse_item",
  fm_const_const: "rustc_parse::parser::item::Parser::parse_item",
  fm_async_async: "rustc_parse::parser::item::Parser::parse_item",
  fm_unsafe_unsafe: "rustc_parse::parser::item::Parser::parse_item",
  fm_safe_unsafe: "rustc_parse::parser::item::Parser::parse_item",
  fm_unsafe_safe: "rustc_parse::parser::item::Parser::parse_item",
  fm_gen_async: "rustc_parse::parser::item::Parser::parse_item",
  fm_async_pub: "rustc_parse::parser::item::Parser::parse_item",
  fm_pub_async_pub: "rustc_parse::parser::item::Parser::parse_item",
  fm_const_async_pub_unsafe: "rustc_parse::parser::item::Parser::parse_item",
  fm_upper_fn: "rustc_parse::parser::item::Parser::parse_item",
  ty_fnptr: "rustc_parse::parser::ty::Parser::parse_ty",
  ty_fnptr_const: "rustc_parse::parser::ty::Parser::parse_ty",
  ty_fnptr_async: "rustc_parse::parser::ty::Parser::parse_ty",
  ty_fnptr_const_async_unsafe: "rustc_parse::parser::ty::Parser::parse_ty",
  ty_fnptr_unsafe_const: "rustc_parse::parser::ty::Parser::parse_ty",
  ty_fnptr_unsafe_async: "rustc_parse::parser::ty::Parser::parse_ty",
  self_value: "rustc_parse::parser::item::Parser::parse_item",
  self_ref: "rustc_parse::parser::item::Parser::parse_item",
  self_mut_ref: "rustc_parse::parser::item::Parser::parse_item",
  self_lt_ref: "rustc_parse::parser::item::Parser::parse_item",
  self_lt_mut_ref: "rustc_parse::parser::item::Parser::parse_item",
  self_box: "rustc_parse::parser::item::Parser::parse_item",
  self_mut: "rustc_parse::parser::item::Parser::parse_item",
  self_mut_typed: "rustc_parse::parser::item::Parser::parse_item",
  self_pin_mut: "rustc_parse::parser::item::Parser::parse_item",
  self_pin_const: "rustc_parse::parser::item::Parser::parse_item",
  self_ptr: "rustc_parse::parser::item::Parser::parse_item",
  self_ptr_mut: "rustc_parse::parser::item::Parser::parse_item",
  self_ptr_const: "rustc_parse::parser::item::Parser::parse_item",
  self_ref_typed: "rustc_parse::parser::item::Parser::parse_item",
  self_not_first: "rustc_parse::parser::item::Parser::parse_item",
  self_path_not_self: "rustc_parse::parser::item::Parser::parse_item",
  self_attr: "rustc_parse::parser::item::Parser::parse_item",
  params_pats: "rustc_parse::parser::item::Parser::parse_item",
  param_trait_anon_2015: "rustc_parse::parser::item::Parser::parse_item",
  param_trait_anon_2018: "rustc_parse::parser::item::Parser::parse_item",
  param_missing_type_free: "rustc_parse::parser::item::Parser::parse_item",
  param_missing_type_2015_free: "rustc_parse::parser::item::Parser::parse_item",
  param_missing_type_self_like: "rustc_parse::parser::item::Parser::parse_item",
  param_pattern_like_type: "rustc_parse::parser::item::Parser::parse_item",
  variadic_foreign: "rustc_parse::parser::item::Parser::parse_item",
  variadic_named: "rustc_parse::parser::item::Parser::parse_item",
  variadic_unnamed_def: "rustc_parse::parser::item::Parser::parse_item",
  variadic_fn_ptr: "rustc_parse::parser::ty::Parser::parse_ty",
  ret_never: "rustc_parse::parser::item::Parser::parse_item",
  ret_where_misplaced: "rustc_parse::parser::item::Parser::parse_item",
  ret_where_fn_trait: "rustc_parse::parser::item::Parser::parse_item",
  body_eq_expr: "rustc_parse::parser::item::Parser::parse_item",
  body_missing: "rustc_parse::parser::item::Parser::parse_item",
  body_missing_in_trait: "rustc_parse::parser::item::Parser::parse_item",
  body_semi: "rustc_parse::parser::item::Parser::parse_item",
  missing_params: "rustc_parse::parser::item::Parser::parse_item",
  typo_impl: "rustc_parse::parser::item::Parser::parse_item",
  param_recover_bad: "rustc_parse::parser::item::Parser::parse_item",
  param_dup_recovered: "rustc_parse::parser::item::Parser::parse_item",
  cfgsel_expr: "rustc_parse::parser::expr::Parser::parse_expr_res_after_attrs",
  cfgsel_expr_block_like: "rustc_parse::parser::expr::Parser::parse_expr_res_after_attrs",
  cfgsel_expr_missing_comma: "rustc_parse::parser::expr::Parser::parse_expr_res_after_attrs",
  cfgsel_expr_end: "rustc_parse::parser::expr::Parser::parse_expr_res_after_attrs",
};

/** case -> narrow script (TS-only ops on the same source; see the header). */
const NARROW: Record<string, string> = {
  fm_plain: "front:Function",
  fm_const: "front:Function",
  fm_async: "front:Function",
  fm_unsafe: "front:Function",
  fm_safe: "front:Function",
  fm_const_async_unsafe: "front:Function",
  fm_async_unsafe: "front:Function",
  fm_const_unsafe: "front:Function",
  fm_pub_const_async_safe: "nvis front:Function",
  fm_async_2015: "front:Function",
  fm_async_unsafe_2015: "nvis front:Function",
  fm_gen: "front:Function gated:gen_blocks",
  fm_async_gen: "front:Function gated:gen_blocks",
  fm_const_gen_unsafe: "front:Function gated:gen_blocks",
  ty_fnptr_const: "front:FunctionPtrType",
  ty_fnptr_async: "front:FunctionPtrType",
  ty_fnptr_const_async_unsafe: "front:FunctionPtrType",
  self_value: "skip:3 param",
  self_ref: "skip:3 param",
  self_mut_ref: "skip:3 param",
  self_mut: "skip:3 param",
  self_pin_mut: "skip:3 param gated:pin_ergonomics",
  self_ptr: "skip:3 param",
  self_ptr_mut: "skip:3 param",
  self_ptr_const: "skip:3 param",
};

/** narrow case -> the `Unported` its narrow script must reach until the owning lane lands. */
const NARROW_PENDING: Record<string, string> = {
};

const EDITIONS: Record<string, Edition> = {
  "2015": "Edition2015",
  "2018": "Edition2018",
  "2021": "Edition2021",
  "2024": "Edition2024",
};

/** `FnParseMode` of free fns (item.rs `parse_item_kind`: `|_, _| true`, `FnContext::Free`, `req_body: true`). */
const FREE_FN_MODE: FnParseMode = { req_name: (_e, _d) => true, context: "Free", req_body: true };

const emit_err = (e: { emit(): void }): string => {
  e.emit();
  return "Err";
};

/** The probe's `run_ops`, ported, plus the narrow ops (`skip:N`, `nvis`, `front:<mode>`, `param`). */
function run_ops(p: Parser, psess: ParseSess, ops: string[], ev: string[]): void {
  let vis: Visibility | undefined;
  for (const op of ops) {
    const i = op.indexOf(":");
    const name = i < 0 ? op : op.slice(0, i);
    const arg = i < 0 ? "" : op.slice(i + 1);
    let r: string;
    switch (name) {
      case "tok":
        r = debug_Token(p.token, PLAIN);
        break;
      case "bump":
        p.bump();
        continue;
      case "vis": {
        const res = p.parse_visibility(FollowedByType.No);
        r = res.$ === "Ok" ? `Ok(${debug_Visibility(res._0, PRETTY)})` : emit_err(res._0);
        break;
      }
      case "item": {
        const res = p.parse_item("No", "Yes");
        if (res.$ === "Err") {
          r = emit_err(res._0);
        } else if (res._0 === undefined) {
          r = "None";
        } else {
          const it = res._0;
          if (it.kind.$ === "Fn") {
            const f = it.kind._0;
            ev.push(`header => ${debug_FnHeader(f.sig.header, PRETTY)}`);
            ev.push(`ident => ${debug_Ident(f.ident, PLAIN)}`);
            f.sig.decl.inputs.forEach((param, n) => ev.push(`param${n} => ${debug_Param(param, PRETTY)}`));
            ev.push(`output => ${debug_FnRetTy(f.sig.decl.output, PRETTY)}`);
            ev.push(`sig_span => ${debug_Span(f.sig.span, PLAIN)}`);
            ev.push(`body => ${f.body !== undefined ? "Some" : "None"}`);
          }
          r = `Ok(${debug_Item(it, PRETTY, debug_ItemKind)})`;
        }
        break;
      }
      case "ty": {
        const res = p.parse_ty();
        if (res.$ === "Err") {
          r = emit_err(res._0);
        } else {
          const t = res._0;
          if (t.kind.$ === "FnPtr") {
            ev.push(`fnptr.safety => ${debug_Safety(t.kind._0.safety, PRETTY)}`);
            ev.push(`fnptr.ext => ${debug_Extern(t.kind._0.ext, PRETTY)}`);
          }
          r = `Ok(${debug_Ty(t, PRETTY)})`;
        }
        break;
      }
      case "cfgsel": {
        const res = p.parse_cfg_select_branch_rhs();
        r = res.$ === "Ok" ? `Ok(${debug_TokenStream(res._0, PLAIN)})` : emit_err(res._0);
        break;
      }
      case "gated": {
        const spans = psess.gated_spans.spans.get(Symbol.intern(arg)) ?? [];
        r = debug_list(PLAIN, spans.map((s) => debug_Span(s, PLAIN)));
        break;
      }
      case "lints": {
        const v = psess.buffered_lints.map(
          (l) => `${l.lint_id.lint.name} ${debug_option(l.span?.primary_span(), PLAIN, debug_Span)}`,
        );
        r = `[${v.join(", ")}]`;
        break;
      }
      // ---- narrow ops (TS only) ----
      case "skip":
        for (let n = 0; n < Number(arg); n++) p.bump();
        continue;
      case "nvis": {
        const res = p.parse_visibility(FollowedByType.No);
        if (res.$ === "Err") throw new Error("nvis failed");
        vis = res._0;
        continue;
      }
      case "front": {
        const mode = arg as FrontMatterParsingMode;
        const v: Visibility = vis ?? { kind: { $: "Inherited" }, span: DUMMY_SP };
        const res = p.parse_fn_front_matter(v, AstCase.Sensitive, mode);
        if (res.$ === "Err") {
          ev.push(`front => ${emit_err(res._0)}`);
        } else if (mode === "Function") {
          ev.push(`header => ${debug_FnHeader(res._0, PRETTY)}`);
        } else {
          ev.push(`fnptr.safety => ${debug_Safety(res._0.safety, PRETTY)}`);
          ev.push(`fnptr.ext => ${debug_Extern(res._0.ext, PRETTY)}`);
        }
        continue;
      }
      case "param": {
        const res = p.parse_param_general(FREE_FN_MODE, true);
        ev.push(res.$ === "Ok" ? `param0 => ${debug_Param(res._0, PRETTY)}` : `param => ${emit_err(res._0)}`);
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
  create_session_globals_then(EDITIONS[c.edition]!, [], inputs, () => {
    const sm = get_source_map()!;
    const buf = new VecU8();
    let em = AnnotateSnippetEmitter.new(AutoStream.new(dyn_write(buf), ColorChoice.Never));
    em = AnnotateSnippetEmitter.sm(em, sm);
    em = AnnotateSnippetEmitter.ui_testing(em, true);
    const psess = ParseSess.with_dcx(DiagCtxt.new(em), sm);
    const fname: FileName = { $: "Real", _0: sm.path_mapping().to_real_filename(sm.working_dir(), "t.rs") };
    try {
      const p = unwrap_or_emit_fatal(new_parser_from_source_str(psess, fname, c.src, "Nothing"));
      run_ops(p, psess, ops.split(/\s+/).filter((s) => s !== ""), events);
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
  test(`parser-fn oracle: ${c.name}`, () => {
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
  test(`parser-fn narrow: ${c.name}`, () => {
    let got: ReturnType<typeof run_case>;
    try {
      got = run_case(c, NARROW[c.name]!);
    } catch (e) {
      if (!(e instanceof Unported)) throw e;
      expect(NARROW_PENDING[c.name]).toBe(e.what);
      return;
    }
    expect(NARROW_PENDING[c.name]).toBeUndefined();
    expect(got.events.length).toBeGreaterThan(0);
    for (const e of got.events) {
      expect(c.events.find((o) => key(o) === key(e))).toBe(e);
    }
    expect(got.fatal).toBe(false);
    expect(got.stderr).toBe(c.stderr);
  });
}

test("parser-fn: every NARROW/PENDING entry names a case", () => {
  const names = new Set(oracle.cases.map((c) => c.name));
  for (const n of [...Object.keys(NARROW), ...Object.keys(PENDING)]) expect(names.has(n)).toBe(true);
  for (const n of Object.keys(NARROW_PENDING)) expect(NARROW[n]).toBeDefined();
});
