// The rustc_hir_typeck contract (decls.ts, lane fnctxt-contract) against upstream:
// - every fn of the crate (1041) is declared in decls.ts at its `file:line` (a member of `FnCtxt` / `TypeckRootCtxt` /
//   an augmented contract class / `Companions` / `Fns_<module>` / the trait interfaces, a `declare static`, or a
//   comment-only declaration);
// - at runtime every declared method / static / free fn exists once lib.ts is loaded (ported, or an `unported`
//   placeholder of the owning stub module), and the placeholders stop as UNPORTED with their upstream path;
// - the `Deref` forwarders (`FnCtxt -> TypeckRootCtxt -> InferCtxt`, `ProbeContext -> FnCtxt`, ...) read fields and
//   call methods of the inner value, and the outer type's own members shadow them;
// - `FnCtxt.lowerer()` is a `HirTyLowerer` trait object over `HirTyLowerer_FnCtxt`;
// - the stub modules' `unported_methods` lists name only their own file's methods, and the split files' lists are
//   split at the lane line;
// - `provide` installs the crate's 5 providers.
//
// The upstream fns come from the repo's fn finder (`upstreamFns`, scripts/coverage.ts) plus an impl-block scan over the
// same rustc_lexer tokens (as rustc_hir_analysis/contract.test.ts).
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { upstreamFns } from "../../scripts/coverage.ts";
import { UPSTREAM } from "../../scripts/lib/common.ts";
import { FrontmatterAllowed, tokenize } from "../rustc_lexer/lib.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import { HirTyLowerer } from "../rustc_hir_analysis/lib.ts";
import type { HirTyLowererImpl } from "../rustc_hir_analysis/lib.ts";
import { InferCtxt } from "../rustc_infer/decls.ts";
import { unported_stub_path } from "../rust_ts/stubs.ts";
import { Unported } from "../std/panic.ts";
import { Str } from "../std/str.ts";
import * as Lib from "./lib.ts";
import type * as D from "./decls.ts";
import { FnCtxt, registered_derefs, TypeckRootCtxt, TypeInformationCtxt } from "./decls.ts";
import { HirTyLowerer_FnCtxt } from "./fn_ctxt/mod.ts";
import { TypeInformationCtxt_FnCtxt, Delegate_provided } from "./expr_use_visitor.ts";
import { CoerceMany } from "./coercion.ts";
import { Coerce } from "./coercion.gen.ts";
import { CastCheck } from "./cast.gen.ts";
import { Pick, ProbeContext } from "./method/probe.gen.ts";
import { ConfirmContext } from "./method/confirm.gen.ts";
import { LoweredTy } from "./fn_ctxt/mod.gen.ts";
import { DeferredCallResolution } from "./callee.gen.ts";
import { EnclosingBreakables } from "./lib.gen.ts";
import { ExprUseVisitor } from "./expr_use_visitor.gen.ts";
import { GatherLocalsVisitor } from "./gather_locals.ts";
import { WritebackCx } from "./writeback.ts";
import { ArgMatchingCtxt, ArgsCtxt, CallCtxt, FnCallDiagCtxt } from "./fn_ctxt/checks.gen.ts";
import { Expectation } from "./expectation.ts";
import { Diverges } from "./diverges.ts";
import * as M__match from "./_match.ts";
import * as M_callee from "./callee.ts";
import * as M_cast from "./cast.ts";
import * as M_check from "./check.ts";
import * as M_coercion from "./coercion.ts";
import * as M_diagnostics from "./diagnostics.ts";
import * as M_expr_use_visitor from "./expr_use_visitor.ts";
import * as M_fallback from "./fallback.ts";
import * as M_fn_ctxt_adjust_fulfillment_errors from "./fn_ctxt/adjust_fulfillment_errors.ts";
import * as M_fn_ctxt_checks from "./fn_ctxt/checks.ts";
import * as M_intrinsicck from "./intrinsicck.ts";
import * as M_lib from "./lib.ts";
import * as M_loops from "./loops.ts";
import * as M_method_probe from "./method/probe.ts";
import * as M_method_suggest from "./method/suggest.ts";
import * as M_naked_functions from "./naked_functions.ts";
import * as M_op from "./op.ts";
import * as M_pat from "./pat.ts";
import * as M_upvar from "./upvar.ts";
// The `Deref` registry is shared (rust_ts/deref.ts): load rustc_borrowck (the driver's providers load it) so the
// registered list below does not depend on which test files ran first.
import "../rustc_borrowck/lib.ts";

const SRC = "compiler/rustc_hir_typeck/src/";
const FILES: string[] = [
  "_match.rs", "autoderef.rs", "callee.rs", "cast.rs", "check.rs", "closure.rs", "coercion.rs", "demand.rs", "diagnostics.rs", "diverges.rs",
  "expectation.rs", "expr.rs", "expr_use_visitor.rs", "fallback.rs", "fn_ctxt/_impl.rs", "fn_ctxt/adjust_fulfillment_errors.rs",
  "fn_ctxt/arg_matrix.rs", "fn_ctxt/checks.rs", "fn_ctxt/inspect_obligations.rs", "fn_ctxt/mod.rs", "fn_ctxt/suggestions.rs",
  "gather_locals.rs", "inline_asm.rs", "intrinsicck.rs", "lib.rs", "loops.rs", "method/confirm.rs", "method/mod.rs",
  "method/prelude_edition_lints.rs", "method/probe.rs", "method/suggest.rs", "naked_functions.rs", "op.rs", "opaque_types.rs",
  "pat.rs", "place_op.rs", "typeck_root_ctxt.rs", "upvar.rs", "writeback.rs",
];
/** Files split between two lanes: [first line of the second region, lane a, lane b]. */
const SPLIT: Record<string, [number, string, string]> = {
  "fn_ctxt/checks.rs": [1669, "typeck-checks-a", "typeck-checks-b"],
  "expr.rs": [1855, "typeck-expr-a", "typeck-expr-b"],
  "pat.rs": [1780, "typeck-pat-a", "typeck-pat-b"],
};
/** Nested fns (comment-only declarations; not free fns of their module). */
const NESTED = new Set(["expr_use_visitor.rs:992", "fn_ctxt/checks.rs:500", "fn_ctxt/checks.rs:2615", "fn_ctxt/suggestions.rs:1419", "inline_asm.rs:223", "method/suggest.rs:111", "method/suggest.rs:4908", "pat.rs:2586", "upvar.rs:1017"]);

interface ScannedFn {
  file: string;
  line: number;
  name: string;
  self_ty: string | undefined;
  trait_: string | undefined;
  has_self: boolean;
}

/** Every `fn` of `file`, with the self type of the `impl` / `trait` block it is directly inside (if any). */
function scan(file: string): ScannedFn[] {
  const bytes = readFileSync(join(UPSTREAM, SRC + file));
  const src = Str.of_bytes(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  const toks: { k: string; t: string; line: number }[] = [];
  let pos = 0;
  let line = 1;
  for (const tok of tokenize(src, FrontmatterAllowed.No)) {
    const k = tok.kind.$;
    if (k !== "Whitespace" && k !== "LineComment" && k !== "BlockComment") {
      const keep = k === "Ident" || k === "OpenBrace" || k === "CloseBrace" || k === "Semi" || k === "Lt" || k === "Gt" || k === "OpenParen" || k === "CloseParen";
      toks.push({ k, t: keep ? src.slice(pos, pos + tok.len).toString() : k, line });
    }
    for (let i = pos; i < pos + tok.len; i++) if (src.byte(i) === 0x0a) line++;
    pos += tok.len;
  }
  const out: ScannedFn[] = [];
  const stack: { self_ty: string; trait_: string | undefined; depth: number }[] = [];
  let depth = 0;
  let pending: { self_ty: string; trait_: string | undefined } | undefined;
  for (let i = 0; i < toks.length; i++) {
    const x = toks[i]!;
    const prev = i === 0 ? "{" : toks[i - 1]!.t;
    if (x.t === "impl" && ["{", "}", ";", "CloseBracket"].includes(prev)) {
      let ang = 0;
      const head: string[] = [];
      for (let j = i + 1; j < toks.length; j++) {
        const t = toks[j]!.t;
        if (t === "<") ang++;
        else if (t === ">") ang--;
        else if (ang === 0 && (t === "{" || t === ";")) break;
        if (ang === 0 && t !== ">") head.push(t);
      }
      const words = head.filter((w) => /^[A-Za-z_]\w*$/.test(w) && w !== "where" && w !== "mut" && w !== "Lifetime" && w !== "And");
      const forAt = words.indexOf("for");
      pending = { self_ty: forAt >= 0 ? words[forAt + 1]! : words[words.length - 1]!, trait_: forAt >= 0 ? words[forAt - 1] : undefined };
    }
    if (x.t === "trait" && toks[i + 1]?.k === "Ident" && ["{", "}", ";", "CloseBracket", "pub", ")"].includes(prev)) {
      pending = { self_ty: `trait ${toks[i + 1]!.t}`, trait_: undefined };
    }
    if (x.t === "{") {
      depth++;
      if (pending) {
        stack.push({ ...pending, depth });
        pending = undefined;
      }
    } else if (x.t === "}") {
      if (stack.length && stack[stack.length - 1]!.depth === depth) stack.pop();
      depth--;
    } else if (x.t === "fn" && toks[i + 1]?.k === "Ident") {
      const top = stack[stack.length - 1];
      const direct = top !== undefined && top.depth === depth;
      let has_self = false;
      let j0 = i + 2;
      // skip the fn's generic parameters (`<F: FnOnce() -> R, R>`: their parens are not the parameter list)
      if (toks[j0]?.t === "<") {
        for (let ang = 0; j0 < toks.length; j0++) {
          if (toks[j0]!.t === "<") ang++;
          else if (toks[j0]!.t === ">" && --ang === 0) break;
        }
      }
      for (let j = j0, d = 0; j < toks.length; j++) {
        const t = toks[j]!.t;
        if (t === "(") {
          d++;
          if (d === 1) {
            for (let k = j + 1; k < j + 5 && k < toks.length; k++) {
              if (toks[k]!.t === "self") has_self = true;
              if (toks[k]!.t === "," || toks[k]!.t === ")" || toks[k]!.k === "Colon") break;
            }
            break;
          }
        }
      }
      out.push({ file, line: x.line, name: toks[i + 1]!.t, self_ty: direct ? top.self_ty : undefined, trait_: direct ? top.trait_ : undefined, has_self });
    }
  }
  return out;
}

const ALL: ScannedFn[] = FILES.flatMap(scan);
const here = (f: string) => readFileSync(join(import.meta.dir, f), "utf8");
const DECLS = here("decls.ts").split("\n");
const of = (self_ty: string, trait_?: string) => ALL.filter((f) => f.self_ty === self_ty && f.trait_ === trait_);
const tsOf = (file: string) => file.replace(/\.rs$/, ".ts");

/** `// <file>:<line>` comment -> the declarations (or commented declarations) on the next line. */
function declIndex(): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (let i = 0; i < DECLS.length; i++) {
    const r = /^\s*\/\/ ((?:\w+\/)*\w+\.rs):(\d+)\b/.exec(DECLS[i]!);
    if (r) m.set(`${r[1]}:${r[2]}`, [...(m.get(`${r[1]}:${r[2]}`) ?? []), DECLS[i + 1] ?? ""]);
  }
  return m;
}

/** Member names declared (not commented out) in the block `<header>` .. its closing brace (same indentation). */
function declaredMethods(header: RegExp): string[] {
  const start = DECLS.findIndex((l) => header.test(l));
  expect([header.source, start >= 0]).toEqual([header.source, true]);
  const indent = /^(\s*)/.exec(DECLS[start]!)![1]!;
  const names: string[] = [];
  for (let i = start + 1; i < DECLS.length && DECLS[i] !== `${indent}}` && DECLS[i] !== `${indent}};`; i++) {
    const m = new RegExp(`^${indent}  (?:export function |function )?(\\w+)(<[^(]*>)?\\(`).exec(DECLS[i]!);
    if (m) names.push(m[1] === "new_" ? "new" : m[1]!);
  }
  return names;
}

test("the impl scan agrees with coverage.ts's fn finder (1041 fns)", () => {
  for (const file of FILES) {
    const a = upstreamFns(SRC + file).map((f) => `${f.line} ${f.name}`);
    const b = ALL.filter((f) => f.file === file).map((f) => `${f.line} ${f.name}`);
    expect([file, b]).toEqual([file, a]);
  }
  expect(ALL.length).toBe(1041);
});

test("every fn is declared in decls.ts at its file:line", () => {
  const idx = declIndex();
  const missing: string[] = [];
  for (const f of ALL) {
    const ds = idx.get(`${f.file}:${f.line}`) ?? [];
    // `name(`, `// name(`, `declare static name:`, `export function name(`, `function new_(`
    const name = f.name === "new" ? "(new|new_)" : f.name;
    if (!ds.some((d) => new RegExp(`^\\s*(// )?(declare static |export function |function )?${name}\\b`).test(d))) missing.push(`${f.file}:${f.line} ${f.name}`);
  }
  expect(missing).toEqual([]);
});

test("FnCtxt and TypeckRootCtxt declare every upstream method; statics are declared static", () => {
  const fc = new Set(declaredMethods(/^export interface FnCtxt extends/));
  const fnctxt = of("FnCtxt");
  expect(fnctxt.filter((f) => f.has_self && !fc.has(f.name)).map((f) => `${f.file}:${f.line} ${f.name}`)).toEqual([]);
  expect(fnctxt.filter((f) => !f.has_self).map((f) => f.name)).toEqual(["user_args_for_adt", "can_contain_user_lifetime_bounds", "new"]);
  for (const f of fnctxt.filter((f) => !f.has_self)) expect([f.name, typeof (FnCtxt as unknown as Record<string, unknown>)[f.name]]).toEqual([f.name, "function"]);
  // 474 inherent methods with `self` + `deref` + the provided `lowerer`
  expect(fc.size).toBe(fnctxt.filter((f) => f.has_self).length + 2);
  expect(of("FnCtxt", "Deref").map((f) => f.name)).toEqual(["deref"]);
  const rc = new Set(declaredMethods(/^export interface TypeckRootCtxt extends/));
  expect([...rc].sort()).toEqual([...of("TypeckRootCtxt").filter((f) => f.has_self), ...of("TypeckRootCtxt", "Deref")].map((f) => f.name).sort());
  expect(typeof TypeckRootCtxt.new).toBe("function");
});

test("the augmented contract classes declare every method of their impl blocks", () => {
  for (const cls of ["CoerceMany", "Coerce", "CastCheck", "Pick", "ProbeContext", "ConfirmContext", "LoweredTy", "DeferredCallResolution", "EnclosingBreakables", "ExprUseVisitor", "GatherLocalsVisitor", "WritebackCx", "CallCtxt", "ArgsCtxt", "ArgMatchingCtxt", "FnCallDiagCtxt"]) {
    const declared = new Set(declaredMethods(new RegExp(`^  interface ${cls}\\b`)));
    const ns = DECLS.some((l) => l === `  namespace ${cls} {`) ? new Set(declaredMethods(new RegExp(`^  namespace ${cls} \\{`))) : new Set<string>();
    const ups = [...of(cls), ...of(cls, "Deref")];
    expect([cls, ups.filter((f) => !(f.has_self ? declared : ns).has(f.name)).map((f) => f.name)]).toEqual([cls, []]);
  }
});

test("the trait interfaces: HirTyLowerer impl, TypeInformationCtxt, Delegate, Companions", () => {
  expect(of("FnCtxt", "HirTyLowerer").map((f) => f.name).sort()).toEqual(Object.keys(HirTyLowerer_FnCtxt).sort());
  const tic = declaredMethods(/^export interface TypeInformationCtxtImpl<S> \{/);
  expect(tic.sort()).toEqual(of("trait TypeInformationCtxt").map((f) => f.name).sort());
  expect(of("FnCtxt", "TypeInformationCtxt").map((f) => f.name).sort()).toEqual([...tic].sort());
  expect(declaredMethods(/^export class TypeInformationCtxt \{/).filter((n) => n !== "constructor" && n !== "of").sort()).toEqual([...tic].sort());
  expect(declaredMethods(/^export interface Delegate \{/).sort()).toEqual(of("trait Delegate").map((f) => f.name).sort());
  for (const [name, obj] of [["Expectation", Expectation], ["Diverges", Diverges], ["Needs", Lib.Needs], ["TupleArgumentsFlag", Lib.TupleArgumentsFlag]] as const) {
    const ms = declaredMethods(new RegExp(`^  ${name}: \\{`));
    expect([name, ms.sort()]).toEqual([name, ALL.filter((f) => f.self_ty === name).map((f) => f.name).sort()]);
    for (const m of ms) expect([name, m, typeof (obj as Record<string, unknown>)[m]]).toEqual([name, m, "function"]);
  }
});

test("every declared method exists once lib.ts is loaded", () => {
  const absent: string[] = [];
  const checks: [RegExp, object][] = [
    [/^export interface FnCtxt extends/, FnCtxt.prototype],
    [/^export interface TypeckRootCtxt extends/, TypeckRootCtxt.prototype],
    [/^  interface CoerceMany\b/, CoerceMany.prototype],
    [/^  interface Coerce\b/, Coerce.prototype],
    [/^  interface CastCheck\b/, CastCheck.prototype],
    [/^  interface Pick\b/, Pick.prototype],
    [/^  interface ProbeContext\b/, ProbeContext.prototype],
    [/^  interface ConfirmContext\b/, ConfirmContext.prototype],
    [/^  interface DeferredCallResolution\b/, DeferredCallResolution.prototype],
    [/^  interface EnclosingBreakables\b/, EnclosingBreakables.prototype],
    [/^  interface ExprUseVisitor\b/, ExprUseVisitor.prototype],
    [/^  interface GatherLocalsVisitor\b/, GatherLocalsVisitor.prototype],
    [/^  interface WritebackCx\b/, WritebackCx.prototype],
    [/^  interface CallCtxt\b/, CallCtxt.prototype],
    [/^  interface ArgsCtxt\b/, ArgsCtxt.prototype],
    [/^  interface ArgMatchingCtxt\b/, ArgMatchingCtxt.prototype],
    [/^  interface FnCallDiagCtxt\b/, FnCallDiagCtxt.prototype],
    [/^  namespace CoerceMany \{/, CoerceMany],
    [/^  namespace Coerce \{/, Coerce],
    [/^  namespace CastCheck \{/, CastCheck],
    [/^  namespace ProbeContext \{/, ProbeContext],
    [/^  namespace ConfirmContext \{/, ConfirmContext],
    [/^  namespace LoweredTy \{/, LoweredTy],
    [/^  namespace ExprUseVisitor \{/, ExprUseVisitor],
    [/^  namespace GatherLocalsVisitor \{/, GatherLocalsVisitor],
    [/^  namespace WritebackCx \{/, WritebackCx],
    [/^  namespace CallCtxt \{/, CallCtxt],
    [/^  namespace ArgsCtxt \{/, ArgsCtxt],
    [/^  namespace ArgMatchingCtxt \{/, ArgMatchingCtxt],
    [/^  namespace FnCallDiagCtxt \{/, FnCallDiagCtxt],
    [/^export interface TypeInformationCtxtImpl<S> \{/, TypeInformationCtxt_FnCtxt],
  ];
  for (const [header, obj] of checks) {
    for (const name of declaredMethods(header)) {
      if (typeof (obj as Record<string, unknown>)[name] !== "function") absent.push(`${header.source} ${name}`);
    }
  }
  expect(absent).toEqual([]);
  expect(typeof Delegate_provided.copy).toBe("function");
  expect(typeof Delegate_provided.bind).toBe("function");
});

test("the free fns exist with their Fns_<module> signatures", () => {
  // Type-level: tsc checks every stub against the declared signature.
  const _match: D.Fns__match = {
    arms_contain_ref_bindings: M__match.arms_contain_ref_bindings,
  };
  const callee: D.Fns_callee = {
    check_legal_trait_for_method_call: M_callee.check_legal_trait_for_method_call,
  };
  const cast: D.Fns_cast = {
    make_invalid_casting_error: M_cast.make_invalid_casting_error,
    check_cast: M_cast.check_cast,
    index_operand_ambiguity_span: M_cast.index_operand_ambiguity_span,
  };
  const check: D.Fns_check = {
    check_fn: M_check.check_fn,
    check_panic_info_fn: M_check.check_panic_info_fn,
    check_lang_start_fn: M_check.check_lang_start_fn,
  };
  const coercion: D.Fns_coercion = {
    coerce_mutbls: M_coercion.coerce_mutbls,
    success: M_coercion.success,
    can_coerce: M_coercion.can_coerce,
    irrefutable_if_let_expr: M_coercion.irrefutable_if_let_expr,
    simple_irrefutable_pattern: M_coercion.simple_irrefutable_pattern,
  };
  const diagnostics: D.Fns_diagnostics = {
    maybe_emit_plus_equals_diagnostic: M_diagnostics.maybe_emit_plus_equals_diagnostic,
  };
  const expr_use_visitor: D.Fns_expr_use_visitor = {
    expr_place: M_expr_use_visitor.expr_place,
  };
  const fallback: D.Fns_fallback = {
    compute_unsafe_infer_vars: M_fallback.compute_unsafe_infer_vars,
  };
  const fn_ctxt_adjust_fulfillment_errors: D.Fns_fn_ctxt_adjust_fulfillment_errors = {
    find_param_in_ty: M_fn_ctxt_adjust_fulfillment_errors.find_param_in_ty,
    is_iterator_singleton: M_fn_ctxt_adjust_fulfillment_errors.is_iterator_singleton,
  };
  const fn_ctxt_checks: D.Fns_fn_ctxt_checks = {
    same_type_modulo_vars: M_fn_ctxt_checks.same_type_modulo_vars,
  };
  const intrinsicck: D.Fns_intrinsicck = {
    unpack_option_like: M_intrinsicck.unpack_option_like,
    skeleton_string: M_intrinsicck.skeleton_string,
    check_transmute: M_intrinsicck.check_transmute,
    check_offload: M_intrinsicck.check_offload,
    check_transmutes: M_intrinsicck.check_transmutes,
    check_offloads: M_intrinsicck.check_offloads,
  };
  const lib: D.Fns_lib = {
    used_trait_imports: M_lib.used_trait_imports,
    typeck_root: M_lib.typeck_root,
    inspect_typeck: M_lib.inspect_typeck,
    typeck_with_inspect: M_lib.typeck_with_inspect,
    extend_err_with_const_context: M_lib.extend_err_with_const_context,
    infer_type_if_missing: M_lib.infer_type_if_missing,
    fatally_break_rust: M_lib.fatally_break_rust,
    provide: M_lib.provide,
  };
  const loops: D.Fns_loops = {
    check: M_loops.check,
  };
  const method_probe: D.Fns_method_probe = {
    method_autoderef_steps: M_method_probe.method_autoderef_steps,
  };
  const method_suggest: D.Fns_method_suggest = {
    all_traits: M_method_suggest.all_traits,
    print_disambiguation_help: M_method_suggest.print_disambiguation_help,
  };
  const naked_functions: D.Fns_naked_functions = {
    typeck_naked_fn: M_naked_functions.typeck_naked_fn,
    check_no_patterns: M_naked_functions.check_no_patterns,
    check_no_parameters_use: M_naked_functions.check_no_parameters_use,
    check_asm: M_naked_functions.check_asm,
  };
  const op: D.Fns_op = {
    lang_item_for_binop: M_op.lang_item_for_binop,
    lang_item_for_unop: M_op.lang_item_for_unop,
    contains_let_in_chain: M_op.contains_let_in_chain,
    deref_ty_if_possible: M_op.deref_ty_if_possible,
    is_builtin_binop: M_op.is_builtin_binop,
  };
  const pat: D.Fns_pat = {
    is_number: M_pat.is_number,
  };
  const upvar: D.Fns_upvar = {
    should_reborrow_from_env_of_parent_coroutine_closure: M_upvar.should_reborrow_from_env_of_parent_coroutine_closure,
    restrict_repr_packed_field_ref_capture: M_upvar.restrict_repr_packed_field_ref_capture,
    apply_capture_kind_on_capture_ty: M_upvar.apply_capture_kind_on_capture_ty,
    drop_location_span: M_upvar.drop_location_span,
    restrict_precision_for_drop_types: M_upvar.restrict_precision_for_drop_types,
    restrict_precision_for_unsafe: M_upvar.restrict_precision_for_unsafe,
    restrict_capture_precision: M_upvar.restrict_capture_precision,
    adjust_for_move_closure: M_upvar.adjust_for_move_closure,
    adjust_for_use_closure: M_upvar.adjust_for_use_closure,
    adjust_for_non_move_closure: M_upvar.adjust_for_non_move_closure,
    construct_place_string: M_upvar.construct_place_string,
    construct_capture_kind_reason_string: M_upvar.construct_capture_kind_reason_string,
    construct_path_string: M_upvar.construct_path_string,
    construct_capture_info_string: M_upvar.construct_capture_info_string,
    var_name: M_upvar.var_name,
    should_do_rust_2021_incompatible_closure_captures_analysis: M_upvar.should_do_rust_2021_incompatible_closure_captures_analysis,
    migration_suggestion_for_2229: M_upvar.migration_suggestion_for_2229,
    determine_capture_info: M_upvar.determine_capture_info,
    truncate_place_to_len_and_update_capture_kind: M_upvar.truncate_place_to_len_and_update_capture_kind,
    determine_place_ancestry_relation: M_upvar.determine_place_ancestry_relation,
    truncate_capture_for_optimization: M_upvar.truncate_capture_for_optimization,
    enable_precise_capture: M_upvar.enable_precise_capture,
  };
  const byFile: Record<string, [string, object]> = {
    "_match.rs": ["Fns__match", _match],
    "callee.rs": ["Fns_callee", callee],
    "cast.rs": ["Fns_cast", cast],
    "check.rs": ["Fns_check", check],
    "coercion.rs": ["Fns_coercion", coercion],
    "diagnostics.rs": ["Fns_diagnostics", diagnostics],
    "expr_use_visitor.rs": ["Fns_expr_use_visitor", expr_use_visitor],
    "fallback.rs": ["Fns_fallback", fallback],
    "fn_ctxt/adjust_fulfillment_errors.rs": ["Fns_fn_ctxt_adjust_fulfillment_errors", fn_ctxt_adjust_fulfillment_errors],
    "fn_ctxt/checks.rs": ["Fns_fn_ctxt_checks", fn_ctxt_checks],
    "intrinsicck.rs": ["Fns_intrinsicck", intrinsicck],
    "lib.rs": ["Fns_lib", lib],
    "loops.rs": ["Fns_loops", loops],
    "method/probe.rs": ["Fns_method_probe", method_probe],
    "method/suggest.rs": ["Fns_method_suggest", method_suggest],
    "naked_functions.rs": ["Fns_naked_functions", naked_functions],
    "op.rs": ["Fns_op", op],
    "pat.rs": ["Fns_pat", pat],
    "upvar.rs": ["Fns_upvar", upvar],
  };
  // Every upstream free fn (outside an impl / trait, not nested) of a file is a member of its interface, and the object
  // above names exactly the interface's members, all functions.
  for (const file of FILES) {
    const free = ALL.filter((f) => f.file === file && f.self_ty === undefined && !NESTED.has(`${f.file}:${f.line}`));
    const entry = byFile[file];
    if (!entry) {
      expect([file, free.map((f) => f.name)]).toEqual([file, []]);
      continue;
    }
    const [iface, obj] = entry;
    const declared = declaredMethods(new RegExp(`^export interface ${iface} \\{`));
    expect([file, free.map((f) => f.name)]).toEqual([file, declared]);
    expect([file, Object.keys(obj)]).toEqual([file, declared]);
    for (const [name, f] of Object.entries(obj)) expect([name, typeof f]).toEqual([name, "function"]);
  }
});

const stop = (f: () => unknown): string => {
  try {
    f();
  } catch (e) {
    expect(e).toBeInstanceOf(Unported);
    return (e as Error).message;
  }
  throw new Error("expected Unported");
};

test("placeholders stop as UNPORTED with the upstream path", () => {
  const fcx = Object.create(FnCtxt.prototype) as FnCtxt;
  const probes: [object, string, string][] = [
    [fcx, "check_expr", "rustc_hir_typeck::expr::FnCtxt::check_expr"],
    [fcx, "check_pat_top", "rustc_hir_typeck::pat::FnCtxt::check_pat_top"],
    [fcx, "lookup_method", "rustc_hir_typeck::method::FnCtxt::lookup_method"],
    [fcx, "normalize", "rustc_hir_typeck::fn_ctxt::_impl::FnCtxt::normalize"],
    [fcx, "report_method_error", "rustc_hir_typeck::method::suggest::FnCtxt::report_method_error"],
    [fcx, "report_unexpected_variant_res", "rustc_hir_typeck::FnCtxt::report_unexpected_variant_res"],
    [Object.create(CoerceMany.prototype) as object, "coerce", "rustc_hir_typeck::coercion::CoerceMany::coerce"],
    [Object.create(WritebackCx.prototype) as object, "visit_expr", "rustc_hir_typeck::writeback::<WritebackCx as Visitor>::visit_expr"],
    [TypeInformationCtxt_FnCtxt, "tcx", "rustc_hir_typeck::expr_use_visitor::<&FnCtxt as TypeInformationCtxt>::tcx"],
  ];
  for (const [obj, name, path] of probes) {
    const fn = (obj as Record<string, () => unknown>)[name]!;
    if (unported_stub_path(fn) !== undefined) expect(stop(() => fn.call(obj))).toContain(path);
  }
  // Each free fn / associated fn is probed only while it is still a stub (its own body is `unported("<path>")` or it is a
  // registered placeholder); a ported one is skipped.
  for (const [target, path] of [
    [(CastCheck as unknown as Record<string, unknown>).new, "rustc_hir_typeck::cast::CastCheck::new"],
    [M_check.check_fn, "rustc_hir_typeck::check::check_fn"],
    [M_loops.check, "rustc_hir_typeck::loops::check"],
  ] as const) {
    const f = () => (target as (...a: unknown[]) => unknown)();
    if (String(target).includes(`unported("${path}")`) || unported_stub_path(target) !== undefined) expect(stop(f)).toContain(path);
  }
});

test("Deref: FnCtxt -> TypeckRootCtxt -> InferCtxt forwarders, own members shadow", () => {
  const derefs = registered_derefs().map((e) => `${e.outer.name}.${e.field} -> ${e.inner.name}`);
  expect(derefs.sort()).toEqual(
    [
      "TypeckRootCtxt.infcx -> InferCtxt",
      // rustc_trait_selection error_reporting/mod.ts (errctxt-contract): the registry is shared (rust_ts/deref.ts)
      "TypeErrCtxt.infcx -> InferCtxt",
      "FnCtxt.root_ctxt -> TypeckRootCtxt",
      "Coerce.fcx -> FnCtxt",
      "ProbeContext.fcx -> FnCtxt",
      "ConfirmContext.fcx -> FnCtxt",
      "CallCtxt.fn_ctxt -> FnCtxt",
      "ArgsCtxt.call_ctxt -> CallCtxt",
      "ArgMatchingCtxt.args_ctxt -> ArgsCtxt",
      "FnCallDiagCtxt.arg_matching_ctxt -> ArgMatchingCtxt",
      // rustc_borrowck (borrowck-contract; loaded with the driver's providers): lib.ts, region_infer/region_context.ts
      "BorrowckInferCtxt.infcx -> InferCtxt",
      "RegionInferenceContext.inner -> RegionInferenceContextInner",
      "UnsolvedRegionInferenceContext.inner -> RegionInferenceContextInner",
    ].sort(),
  );
  // Every InferCtxt member (fields and prototype methods) is reachable on a FnCtxt.
  const inferNames = new Set<string>(Object.keys(Reflect.construct(InferCtxt, []) as object));
  for (let p = InferCtxt.prototype; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) for (const n of Object.getOwnPropertyNames(p)) if (n !== "constructor") inferNames.add(n);
  const missing = [...inferNames].filter((n) => !(n in FnCtxt.prototype) || !(n in TypeckRootCtxt.prototype));
  expect(missing).toEqual([]);

  // Fields read (and write) through two levels, methods run with the inner value as `this`.
  const seen: unknown[] = [];
  const infcx = Object.create(InferCtxt.prototype) as InferCtxt & Record<string, unknown>;
  infcx.tcx = "the-tcx" as never;
  (infcx as unknown as { next_ty_var: (s: unknown) => unknown }).next_ty_var = function (this: unknown, s: unknown) {
    seen.push(this, s);
    return "ty";
  };
  const root = Object.create(TypeckRootCtxt.prototype) as TypeckRootCtxt;
  root.infcx = infcx;
  const fcx = Object.create(FnCtxt.prototype) as FnCtxt;
  fcx.root_ctxt = root;
  expect(fcx.tcx as unknown).toBe("the-tcx");
  expect(fcx.infcx).toBe(infcx);
  expect(fcx.next_ty_var(7 as never) as unknown).toBe("ty");
  expect(seen).toEqual([infcx, 7]);
  (fcx as unknown as { universe_: number }).universe_ = 3;
  expect((infcx as unknown as { universe_: number }).universe_).toBe(3);
  // FnCtxt's own methods shadow the inner ones (`typing_mode`, `dcx`, `err_ctxt`, `root_vid`, `deref`).
  for (const n of ["typing_mode", "dcx", "err_ctxt", "root_vid", "deref"]) expect(Object.prototype.hasOwnProperty.call(FnCtxt.prototype, n)).toBe(true);
  expect(fcx.deref()).toBe(root);
  // A FnCtxt is not structurally an InferCtxt (deref coercions are written `.infcx`).
  // @ts-expect-error `drop` is omitted from the Deref view
  const _no: InferCtxt = fcx;
  void _no;
});

test("FnCtxt.lowerer() is a trait object dispatching through HirTyLowerer_FnCtxt", () => {
  const fcx = Object.create(FnCtxt.prototype) as FnCtxt;
  fcx.body_def_id = 5 as never;
  const l = fcx.lowerer();
  expect(l).toBeInstanceOf(HirTyLowerer);
  expect(l.data).toBe(fcx);
  expect(l.vtable).toBe(HirTyLowerer_FnCtxt as HirTyLowererImpl<unknown>);
  expect(l.item_def_id() as unknown).toBe(5);
  // the TypeInformationCtxt trait object over the FnCtxt impl
  const cx = TypeInformationCtxt.of(fcx, TypeInformationCtxt_FnCtxt);
  expect(cx.data).toBe(fcx);
});

/** The names in every `unported_methods(<target>, ..., [..])` list of a TS module, per list. */
function stubLists(text: string, target: string): { at: number; names: string[] }[] {
  const out: { at: number; names: string[] }[] = [];
  const re = new RegExp(`unported_methods\\(${target.replace(/\./g, "\\.")}, "[^"]*", \\[([^\\]]*)\\]\\)`, "g");
  for (const m of text.matchAll(re)) out.push({ at: m.index!, names: [...m[1]!.matchAll(/"(\w+)"/g)].map((x) => x[1]!) });
  return out;
}

test("each stub module's FnCtxt placeholder lists name only that file's methods; split files split at the lane line", () => {
  const wrong: string[] = [];
  for (const file of FILES) {
    const text = here(tsOf(file));
    const own = new Map(ALL.filter((f) => f.file === file && f.self_ty === "FnCtxt" && f.trait_ === undefined && f.has_self).map((f) => [f.name, f.line]));
    const s = SPLIT[file];
    const b_at = s ? text.indexOf(`// ==== lane ${s[2]}: `) : -1;
    if (s) {
      expect([file, text.indexOf(`// ==== lane ${s[1]}: `) > 0, b_at > 0]).toEqual([file, true, true]);
    }
    for (const list of stubLists(text, "FnCtxt.prototype")) {
      for (const n of list.names) {
        const line = own.get(n);
        if (line === undefined) wrong.push(`${file}: ${n}`);
        else if (s && (line >= s[0]) !== (list.at > b_at)) wrong.push(`${file}: ${n} (line ${line}) in the wrong lane list`);
      }
    }
  }
  expect(wrong).toEqual([]);
  // the split points are method boundaries (a blank line after the previous fn's closing brace)
  for (const [file, [line]] of Object.entries(SPLIT)) {
    const rs = readFileSync(join(UPSTREAM, SRC + file), "utf8").split("\n");
    expect([file, rs[line - 2]!, rs[line - 1]!.trim()]).toEqual([file, "    }", ""]);
  }
});

test("provide installs the crate's providers (and leaves the others)", () => {
  const providers = {} as Record<string, unknown>;
  Lib.provide(providers as unknown as Providers);
  expect(Object.keys(providers).sort()).toEqual(["check_offloads", "check_transmutes", "method_autoderef_steps", "typeck_root", "used_trait_imports"]);
  expect(providers.typeck_root).toBe(Lib.typeck_root);
  expect(providers.used_trait_imports).toBe(Lib.used_trait_imports);
});
