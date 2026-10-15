// The error-reporting contract of rustc_trait_selection (decls.ts "Error reporting", lane errctxt-contract) against upstream:
// - every fn of error_reporting/** and diagnostics{.rs,/note_and_explain.rs} (377) is declared in decls.ts at its
//   `file:line` (a member of `TypeErrCtxt` / `NiceRegionError` / `ObligationCause`, a `Fns_<module>` member, a static, or a
//   comment-only declaration);
// - `TypeErrCtxt` / `NiceRegionError` declare every method of their upstream impl blocks, and every declared method exists
//   once lib.ts is loaded (ported, or an `unported` placeholder naming its own module);
// - the `Fns_<module>` free fns exist with their declared signatures (tsc) and stop as UNPORTED with their upstream path;
// - `TypeErrCtxt -> InferCtxt` Deref forwarders, own members shadow, and a TypeErrCtxt is not structurally an InferCtxt;
// - `InferCtxt::err_ctxt` builds the upstream `TypeErrCtxt`; the small ports of this lane (`ArgKind`, `CallDesugaringKind`).
//
// The upstream fns come from the repo's fn finder (`upstreamFns`, scripts/coverage.ts) plus an impl-block scan over the same
// rustc_lexer tokens (as rustc_hir_typeck/contract.test.ts).
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { upstreamFns } from "../../scripts/coverage.ts";
import { UPSTREAM } from "../../scripts/lib/common.ts";
import { InferCtxt } from "../rustc_infer/decls.ts";
import { FrontmatterAllowed, tokenize } from "../rustc_lexer/lib.ts";
import { ObligationCause } from "../rustc_middle/traits/mod.ts";
import { registered_derefs } from "../rust_ts/deref.ts";
import { unported_stub_path } from "../rust_ts/stubs.ts";
import { Unported } from "../std/panic.ts";
import { Str } from "../std/str.ts";
import "./lib.ts";
import type * as D from "./decls.ts";
import { TypeErrCtxt } from "./decls.ts";
import * as M_diagnostics from "./diagnostics.ts";
import * as M_infer_mod from "./error_reporting/infer/mod.ts";
import * as M_need_type_info from "./error_reporting/infer/need_type_info.ts";
import * as M_different_lifetimes from "./error_reporting/infer/nice_region_error/different_lifetimes.ts";
import * as M_find_anon_type from "./error_reporting/infer/nice_region_error/find_anon_type.ts";
import { NiceRegionError } from "./error_reporting/infer/nice_region_error/mod.ts";
import * as M_static_impl_trait from "./error_reporting/infer/nice_region_error/static_impl_trait.ts";
import * as M_nre_util from "./error_reporting/infer/nice_region_error/util.ts";
import * as M_region from "./error_reporting/infer/region.ts";
import * as M_ambiguity from "./error_reporting/traits/ambiguity.ts";
import * as M_call_kind from "./error_reporting/traits/call_kind.ts";
import * as M_traits_mod from "./error_reporting/traits/mod.ts";
import * as M_overflow from "./error_reporting/traits/overflow.ts";
import * as M_suggestions from "./error_reporting/traits/suggestions.ts";

const SRC = "compiler/rustc_trait_selection/src/";
const FILES: string[] = [
  "error_reporting/mod.rs", "error_reporting/infer/mod.rs", "error_reporting/infer/need_type_info.rs", "error_reporting/infer/note_and_explain.rs",
  "error_reporting/infer/region.rs", "error_reporting/infer/suggest.rs", "error_reporting/infer/nice_region_error/mod.rs",
  "error_reporting/infer/nice_region_error/different_lifetimes.rs", "error_reporting/infer/nice_region_error/find_anon_type.rs",
  "error_reporting/infer/nice_region_error/mismatched_static_lifetime.rs", "error_reporting/infer/nice_region_error/named_anon_conflict.rs",
  "error_reporting/infer/nice_region_error/placeholder_error.rs", "error_reporting/infer/nice_region_error/placeholder_relation.rs",
  "error_reporting/infer/nice_region_error/static_impl_trait.rs", "error_reporting/infer/nice_region_error/trait_impl_difference.rs",
  "error_reporting/infer/nice_region_error/util.rs", "error_reporting/traits/mod.rs", "error_reporting/traits/ambiguity.rs",
  "error_reporting/traits/call_kind.rs", "error_reporting/traits/fulfillment_errors.rs", "error_reporting/traits/on_unimplemented.rs",
  "error_reporting/traits/overflow.rs", "error_reporting/traits/suggestions.rs", "diagnostics.rs", "diagnostics/note_and_explain.rs",
];

interface ScannedFn {
  file: string;
  line: number;
  name: string;
  self_ty: string | undefined;
  trait_: string | undefined;
  has_self: boolean;
}

/** Every `fn` of `file`, with the self type / trait of the `impl` block it is directly inside (if any). */
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
    } else if (x.t === ";" && pending && toks[i - 1]?.t !== ")") {
      // `impl X for Y;` never occurs; keep `pending` across `where` clauses
    } else if (x.t === "fn" && toks[i + 1]?.k === "Ident") {
      const top = stack[stack.length - 1];
      const direct = top !== undefined && top.depth === depth;
      let has_self = false;
      let j0 = i + 2;
      if (toks[j0]?.t === "<") {
        for (let ang = 0; j0 < toks.length; j0++) {
          if (toks[j0]!.t === "<") ang++;
          else if (toks[j0]!.t === ">" && --ang === 0) break;
        }
      }
      for (let j = j0; j < toks.length; j++) {
        if (toks[j]!.t === "(") {
          for (let k = j + 1; k < j + 5 && k < toks.length; k++) {
            if (toks[k]!.t === "self") has_self = true;
            if (toks[k]!.t === "," || toks[k]!.t === ")" || toks[k]!.k === "Colon") break;
          }
          break;
        }
      }
      out.push({ file, line: x.line, name: toks[i + 1]!.t, self_ty: direct ? top.self_ty : undefined, trait_: direct ? top.trait_ : undefined, has_self });
    }
  }
  return out;
}

const ALL: ScannedFn[] = FILES.flatMap(scan);
const DECLS = readFileSync(join(import.meta.dir, "decls.ts"), "utf8").split("\n");

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
    const m = new RegExp(`^${indent}  (?:export function |function |declare static )?(\\w+)(<[^(]*>)?[(:]`).exec(DECLS[i]!);
    if (m) names.push(m[1] === "new_" ? "new" : m[1]!);
  }
  return names;
}

const stop = (f: () => unknown): string => {
  try {
    f();
  } catch (e) {
    expect(e).toBeInstanceOf(Unported);
    return (e as Error).message;
  }
  throw new Error("expected Unported");
};

test("the impl scan agrees with coverage.ts's fn finder (377 fns)", () => {
  for (const file of FILES) {
    const a = upstreamFns(SRC + file).map((f) => `${f.line} ${f.name}`);
    const b = ALL.filter((f) => f.file === file).map((f) => `${f.line} ${f.name}`);
    expect([file, b]).toEqual([file, a]);
  }
  expect(ALL.length).toBe(377);
});

test("every fn is declared in decls.ts at its file:line", () => {
  const idx = declIndex();
  const missing: string[] = [];
  for (const f of ALL) {
    const ds = idx.get(`${f.file}:${f.line}`) ?? [];
    const name = f.name === "new" ? "(new|new_)" : f.name;
    if (!ds.some((d) => new RegExp(`^\\s*(// )?(static |declare static |export function |function )?${name}\\b`).test(d))) missing.push(`${f.file}:${f.line} ${f.name}`);
  }
  expect(missing).toEqual([]);
});

test("TypeErrCtxt and NiceRegionError declare every method of their impl blocks", () => {
  const te = new Set(declaredMethods(/^export interface TypeErrCtxt extends/));
  const ups = ALL.filter((f) => f.self_ty === "TypeErrCtxt" && f.has_self);
  expect(ups.filter((f) => !te.has(f.name)).map((f) => `${f.file}:${f.line} ${f.name}`)).toEqual([]);
  // the inherent methods with `self` (the deprecated `err_ctxt` included) + `deref`
  expect(te.size).toBe(new Set(ups.map((f) => f.name)).size);
  expect(ALL.filter((f) => f.self_ty === "TypeErrCtxt" && !f.has_self).map((f) => f.name)).toEqual(["as_host_effect_clause"]);
  expect(declaredMethods(/^export class TypeErrCtxt \{/)).toContain("as_host_effect_clause");

  const nre = new Set(declaredMethods(/^ {2}interface NiceRegionError \{/));
  const ns = new Set(declaredMethods(/^ {2}namespace NiceRegionError \{/));
  const nups = ALL.filter((f) => f.self_ty === "NiceRegionError");
  expect(nups.filter((f) => !(f.has_self ? nre : ns).has(f.name)).map((f) => f.name)).toEqual([]);
  expect(nre.size + ns.size).toBe(nups.length);

  const oce = declaredMethods(/^ {2}interface ObligationCause \{/);
  expect(oce).toEqual(ALL.filter((f) => f.self_ty === "ObligationCause").map((f) => f.name));
});

test("every declared method exists once lib.ts is loaded; placeholders name their own module", () => {
  const absent: string[] = [];
  for (const [header, obj] of [
    [/^export interface TypeErrCtxt extends/, TypeErrCtxt.prototype],
    [/^ {2}interface NiceRegionError \{/, NiceRegionError.prototype],
    [/^ {2}namespace NiceRegionError \{/, NiceRegionError],
    [/^ {2}interface ObligationCause \{/, ObligationCause.prototype],
  ] as const) {
    for (const name of declaredMethods(header)) if (typeof (obj as unknown as Record<string, unknown>)[name] !== "function") absent.push(`${header.source} ${name}`);
  }
  expect(absent).toEqual([]);
  expect(typeof TypeErrCtxt.as_host_effect_clause).toBe("function");

  // A placeholder names the module of the file that declares the method (`// <file>:<line>` above its declaration).
  const where = new Map<string, string>();
  for (const f of ALL) if (f.self_ty === "TypeErrCtxt" && f.has_self) where.set(f.name, f.file);
  const wrong: string[] = [];
  for (const [name, file] of where) {
    const fn = (TypeErrCtxt.prototype as unknown as Record<string, unknown>)[name];
    const path = unported_stub_path(fn);
    if (path === undefined) continue;
    const module = `rustc_trait_selection::${file.replace(/\.rs$/, "").replace(/\/mod$/, "").replace(/\//g, "::")}::TypeErrCtxt`;
    if (path !== module) wrong.push(`${name}: ${path}`);
    else expect(stop(() => (fn as (this: unknown) => unknown).call(undefined))).toBe(`unported: ${module}::${name}`);
  }
  expect(wrong).toEqual([]);
});

test("the free fns exist with their Fns_<module> signatures and stop with their upstream path", () => {
  // Type-level: tsc checks every stub against the declared signature.
  const fns: Record<string, Record<string, unknown>> = {
    "error_reporting::infer": { escape_literal: M_infer_mod.escape_literal } satisfies D.Fns_error_reporting_infer_mod,
    "error_reporting::infer::need_type_info": {
      fmt_printer: M_need_type_info.fmt_printer,
      ty_to_string: M_need_type_info.ty_to_string,
      closure_as_fn_str: M_need_type_info.closure_as_fn_str,
    } satisfies D.Fns_error_reporting_infer_need_type_info,
    "error_reporting::infer::region": {
      note_and_explain_region: M_region.note_and_explain_region,
      explain_free_region: M_region.explain_free_region,
      msg_span_from_named_region: M_region.msg_span_from_named_region,
      emit_msg_span: M_region.emit_msg_span,
      label_msg_span: M_region.label_msg_span,
      unexpected_hidden_region_diagnostic: M_region.unexpected_hidden_region_diagnostic,
      suggest_precise_capturing: M_region.suggest_precise_capturing,
    } satisfies D.Fns_error_reporting_infer_region,
    "error_reporting::infer::nice_region_error::different_lifetimes": {
      suggest_adding_lifetime_params: M_different_lifetimes.suggest_adding_lifetime_params,
    } satisfies D.Fns_error_reporting_infer_nice_region_error_different_lifetimes,
    "error_reporting::infer::nice_region_error::find_anon_type": {
      find_anon_type: M_find_anon_type.find_anon_type,
      find_component_for_bound_region: M_find_anon_type.find_component_for_bound_region,
    } satisfies D.Fns_error_reporting_infer_nice_region_error_find_anon_type,
    "error_reporting::infer::nice_region_error::static_impl_trait": {
      suggest_new_region_bound: M_static_impl_trait.suggest_new_region_bound,
      make_elided_region_spans_suggs: M_static_impl_trait.make_elided_region_spans_suggs,
    } satisfies D.Fns_error_reporting_infer_nice_region_error_static_impl_trait,
    "error_reporting::infer::nice_region_error::util": {
      find_param_with_region: M_nre_util.find_param_with_region,
    } satisfies D.Fns_error_reporting_infer_nice_region_error_util,
    "error_reporting::traits": {
      to_pretty_impl_header: M_traits_mod.to_pretty_impl_header,
      report_dyn_incompatibility: M_traits_mod.report_dyn_incompatibility,
      attempt_dyn_to_enum_suggestion: M_traits_mod.attempt_dyn_to_enum_suggestion,
      attempt_dyn_to_impl_suggestion: M_traits_mod.attempt_dyn_to_impl_suggestion,
    } satisfies D.Fns_error_reporting_traits_mod,
    "error_reporting::traits::ambiguity": {
      compute_applicable_impls_for_diagnostics: M_ambiguity.compute_applicable_impls_for_diagnostics,
    } satisfies D.Fns_error_reporting_traits_ambiguity,
    "error_reporting::traits::call_kind": { call_kind: M_call_kind.call_kind } satisfies D.Fns_error_reporting_traits_call_kind,
    "error_reporting::traits::overflow": {
      suggest_new_overflow_limit: M_overflow.suggest_new_overflow_limit,
    } satisfies D.Fns_error_reporting_traits_overflow,
    "error_reporting::traits::suggestions": {
      predicate_constraint: M_suggestions.predicate_constraint,
      suggest_restriction: M_suggestions.suggest_restriction,
      hint_missing_borrow: M_suggestions.hint_missing_borrow,
      get_explanation_based_on_obligation: M_suggestions.get_explanation_based_on_obligation,
      suggest_desugaring_async_fn_to_impl_future_in_trait: M_suggestions.suggest_desugaring_async_fn_to_impl_future_in_trait,
      point_at_assoc_type_restriction: M_suggestions.point_at_assoc_type_restriction,
      get_deref_type_and_refs: M_suggestions.get_deref_type_and_refs,
    } satisfies D.Fns_error_reporting_traits_suggestions,
    diagnostics: { impl_trait_overcapture_suggestion: M_diagnostics.impl_trait_overcapture_suggestion } satisfies D.Fns_diagnostics,
  };
  const free = ALL.filter((f) => f.self_ty === undefined && !DECLS.some((l) => l.startsWith(`// ${f.file}:${f.line} nested fn`)));
  expect(Object.values(fns).flatMap((m) => Object.keys(m)).sort()).toEqual(free.map((f) => f.name).sort());
  for (const [module, m] of Object.entries(fns)) {
    for (const [name, f] of Object.entries(m)) {
      expect([name, typeof f]).toEqual([name, "function"]);
      const path = `rustc_trait_selection::${module}::${name}`;
      if (String(f).includes(`unported("${path}")`)) expect(stop(() => (f as () => unknown)())).toBe(`unported: ${path}`);
    }
  }
});

test("Deref: TypeErrCtxt -> InferCtxt forwarders, own members shadow", () => {
  expect(registered_derefs().some((e) => e.outer === TypeErrCtxt && e.field === "infcx" && e.inner === InferCtxt)).toBe(true);
  // Every InferCtxt member (fields and prototype methods) is reachable on a TypeErrCtxt.
  const inferNames = new Set<string>(Object.keys(Reflect.construct(InferCtxt, []) as object));
  for (let p = InferCtxt.prototype; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) for (const n of Object.getOwnPropertyNames(p)) if (n !== "constructor") inferNames.add(n);
  expect([...inferNames].filter((n) => !(n in TypeErrCtxt.prototype))).toEqual([]);

  const seen: unknown[] = [];
  const infcx = Object.create(InferCtxt.prototype) as InferCtxt & Record<string, unknown>;
  infcx.tcx = "the-tcx" as never;
  (infcx as unknown as { next_ty_var: (s: unknown) => unknown }).next_ty_var = function (this: unknown, s: unknown) {
    seen.push(this, s);
    return "ty";
  };
  (infcx as unknown as { dcx: () => unknown }).dcx = () => "the-dcx";
  // `InferCtxt::err_ctxt` (error_reporting/mod.rs:42)
  const ecx = infcx.err_ctxt();
  expect(ecx).toBeInstanceOf(TypeErrCtxt);
  expect(ecx.infcx).toBe(infcx);
  expect(ecx.param_env).toBeUndefined();
  expect(ecx.typeck_results).toBeUndefined();
  expect(ecx.diverging_fallback_has_occurred).toBe(false);
  expect(ecx.autoderef_steps("T" as never)).toEqual([["T", []]] as never);
  expect(ecx.infer_closure_kind(3 as never)).toBeUndefined();
  // fields and methods of the InferCtxt read through the forwarders, with the InferCtxt as `this`
  expect(ecx.tcx as unknown).toBe("the-tcx");
  expect(ecx.next_ty_var(7 as never) as unknown).toBe("ty");
  expect(seen).toEqual([infcx, 7]);
  (ecx as unknown as { universe_: number }).universe_ = 3;
  expect((infcx as unknown as { universe_: number }).universe_).toBe(3);
  // own members shadow: `dcx` forwards to `self.infcx.dcx()`, the deprecated `err_ctxt` is a bug!, `deref` is the infcx
  for (const n of ["dcx", "err_ctxt", "deref"]) expect(Object.prototype.hasOwnProperty.call(TypeErrCtxt.prototype, n)).toBe(true);
  expect(ecx.dcx() as unknown).toBe("the-dcx");
  expect(ecx.deref()).toBe(infcx);
  // A TypeErrCtxt is not structurally an InferCtxt (deref coercions are written `.infcx`).
  // @ts-expect-error `drop` is omitted from the Deref view
  const _no: InferCtxt = ecx;
  void _no;
});

test("ported here: ArgKind, CallDesugaringKind, ReturnsVisitor default", () => {
  expect(M_traits_mod.ArgKind.empty()).toEqual({ $: "Arg", _0: "_", _1: "_" });
  expect(M_call_kind.CallDesugaringKind.name("ForLoopIntoAsyncIter")).toBe("`for await` loop");
  expect(M_call_kind.CallDesugaringKind.name("QuestionFromResidual")).toBe("question mark operator");
  const v = M_suggestions.ReturnsVisitor.default();
  expect(v.returns).toEqual([]);
  expect(v.in_block_tail).toBe(false);
});
