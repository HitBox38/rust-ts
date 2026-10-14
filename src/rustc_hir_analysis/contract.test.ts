// The rustc_hir_analysis collect / HIR ty lowering contract (decls.ts, lane hirtylowerer-contract) against upstream:
// - every fn of the contract's upstream files is declared in decls.ts at its `file:line` (a method of `HirTyLowererImpl`
//   / `HirTyLowerer` / `GenericArgsLowerer` / `ItemCtxt`, a `declare static`, a `Fns_<module>` member, or a comment-only
//   declaration for the helper types, trait impls and nested fns);
// - at runtime every declared method / static / free fn exists (ported, or an `unported` placeholder of the owning stub
//   module), the placeholders stop as UNPORTED, and `ItemCtxt::lowerer()` dispatches through the `HirTyLowerer_ItemCtxt`
//   vtable;
// - the stub modules' `unported_methods` lists name only their own file's methods, and mod.ts's two lists split mod.rs at
//   line 2186 (lanes hir-ty-lowering-a / hir-ty-lowering-b);
// - `provide` installs the collect providers.
//
// The upstream fns come from the repo's fn finder (`upstreamFns`, scripts/coverage.ts) plus an impl-block scan over the
// same rustc_lexer tokens, so `fn` in comments or strings never counts.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { upstreamFns } from "../../scripts/coverage.ts";
import { UPSTREAM } from "../../scripts/lib/common.ts";
import { FrontmatterAllowed, tokenize } from "../rustc_lexer/lib.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import { unported_stub_path } from "../rust_ts/stubs.ts";
import { Unported } from "../std/panic.ts";
import { Str } from "../std/str.ts";
import * as Collect from "./collect.ts";
import * as Clauses from "./collect/clauses_of.ts";
import * as Dump from "./collect/dump.ts";
import * as GenericsOf from "./collect/generics_of.ts";
import * as ItemBounds from "./collect/item_bounds.ts";
import * as Rbv from "./collect/resolve_bound_vars.ts";
import * as TypeOf from "./collect/type_of.ts";
import * as Opaque from "./collect/type_of/opaque.ts";
import type * as D from "./decls.ts";
import * as Bounds from "./hir_ty_lowering/bounds.ts";
import * as Cmse from "./hir_ty_lowering/cmse.ts";
import * as DynTrait from "./hir_ty_lowering/dyn_trait.ts";
import * as Errors from "./hir_ty_lowering/errors.ts";
import * as Generics from "./hir_ty_lowering/generics.ts";
import * as Lib from "./lib.ts";
import { HirTyLowerer, ItemCtxt } from "./lib.ts";

const SRC = "compiler/rustc_hir_analysis/src/";
/** Upstream file -> the TS module that ports it (relative to this directory). */
const FILES: Record<string, string> = {
  "lib.rs": "lib.ts",
  "collect.rs": "collect.ts",
  "collect/generics_of.rs": "collect/generics_of.ts",
  "collect/type_of.rs": "collect/type_of.ts",
  "collect/type_of/opaque.rs": "collect/type_of/opaque.ts",
  "collect/clauses_of.rs": "collect/clauses_of.ts",
  "collect/item_bounds.rs": "collect/item_bounds.ts",
  "collect/resolve_bound_vars.rs": "collect/resolve_bound_vars.ts",
  "collect/dump.rs": "collect/dump.ts",
  "hir_ty_lowering/mod.rs": "hir_ty_lowering/mod.ts",
  "hir_ty_lowering/bounds.rs": "hir_ty_lowering/bounds.ts",
  "hir_ty_lowering/generics.rs": "hir_ty_lowering/generics.ts",
  "hir_ty_lowering/dyn_trait.rs": "hir_ty_lowering/dyn_trait.ts",
  "hir_ty_lowering/errors.rs": "hir_ty_lowering/errors.ts",
  "hir_ty_lowering/cmse.rs": "hir_ty_lowering/cmse.ts",
  "diagnostics.rs": "diagnostics.ts",
};
/** mod.rs is ported by two lanes: hir-ty-lowering-a (lines < MOD_SPLIT) and hir-ty-lowering-b (lines >= MOD_SPLIT). */
const MOD_SPLIT = 2186;

interface ScannedFn {
  file: string;
  line: number;
  name: string;
  /** the innermost `impl` / `trait` block's self type at the fn's own brace depth (`dyn HirTyLowerer` for
   * `impl dyn HirTyLowerer`, `trait X` for a trait's own fns); `undefined` for free / nested fns */
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
      const words = head.filter((w) => /^[A-Za-z_]\w*$/.test(w) && w !== "where" && w !== "mut" && w !== "Lifetime");
      const forAt = words.indexOf("for");
      const dynAt = words.indexOf("dyn");
      if (dynAt >= 0 && forAt < 0) pending = { self_ty: `dyn ${words[dynAt + 1]}`, trait_: undefined };
      else pending = { self_ty: forAt >= 0 ? words[forAt + 1]! : words[words.length - 1]!, trait_: forAt >= 0 ? words[forAt - 1] : undefined };
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
      // `self` among the parameters: `(self`, `(&self`, `(&mut self`, `(&'a self`, `(mut self`
      let has_self = false;
      for (let j = i + 2, d = 0; j < toks.length; j++) {
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

const ALL: ScannedFn[] = Object.keys(FILES).flatMap(scan);
const here = (f: string) => readFileSync(join(import.meta.dir, f), "utf8");
const DECLS = here("decls.ts").split("\n");
const of = (self_ty: string, trait_?: string) => ALL.filter((f) => f.self_ty === self_ty && f.trait_ === trait_);

/** `// <file>:<line>` comment -> the declaration (or commented declaration) on the next line. */
function declIndex(): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (let i = 0; i < DECLS.length; i++) {
    const r = /^\s*\/\/ ((?:\w+\/)*\w+\.rs):(\d+)\b/.exec(DECLS[i]!);
    if (r) m.set(`${r[1]}:${r[2]}`, [...(m.get(`${r[1]}:${r[2]}`) ?? []), DECLS[i + 1] ?? ""]);
  }
  return m;
}

/** Member names declared (not commented out) in the block `<header> {` .. `}` of decls.ts. */
function declaredMethods(header: RegExp): string[] {
  const start = DECLS.findIndex((l) => header.test(l));
  expect(start).toBeGreaterThanOrEqual(0);
  const names: string[] = [];
  for (let i = start + 1; i < DECLS.length && DECLS[i] !== "}"; i++) {
    const m = /^ {2}(\w+)(<[^(]*>)?\(/.exec(DECLS[i]!);
    if (m) names.push(m[1]!);
  }
  return names;
}

test("the impl scan agrees with coverage.ts's fn finder", () => {
  for (const file of Object.keys(FILES)) {
    const a = upstreamFns(SRC + file).map((f) => `${f.line} ${f.name}`);
    const b = ALL.filter((f) => f.file === file).map((f) => `${f.line} ${f.name}`);
    expect(b).toEqual(a);
  }
  expect(ALL.length).toBe(368);
});

test("every fn is declared in decls.ts at its file:line", () => {
  const idx = declIndex();
  const missing: string[] = [];
  for (const f of ALL) {
    const ds = idx.get(`${f.file}:${f.line}`) ?? [];
    // `name(`, `// name(`, `declare static name:`
    if (!ds.some((d) => new RegExp(`^\\s*(// )?(declare static )?${f.name}\\b`).test(d))) missing.push(`${f.file}:${f.line} ${f.name}`);
  }
  expect(missing).toEqual([]);
});

test("the trait, the trait object, GenericArgsLowerer and ItemCtxt declare every upstream method", () => {
  const trait = of("trait HirTyLowerer");
  const impl_ = new Set(declaredMethods(/^export interface HirTyLowererImpl<S> \{/));
  // the required methods are the vtable's slots; the provided `lowerer` (`where Self: Sized`) is not
  expect([...impl_].sort()).toEqual(trait.filter((f) => f.name !== "lowerer").map((f) => f.name).sort());
  // the trait object dispatches every slot
  const forwarders = new Set(declaredMethods(/^export class HirTyLowerer \{/).filter((n) => n !== "constructor"));
  expect([...forwarders].sort()).toEqual([...impl_].sort());
  // `impl dyn HirTyLowerer` (mod.rs a 30 + b 25, bounds 9, dyn_trait 12, errors 16)
  const dyn = of("dyn HirTyLowerer");
  const dynDecl = new Set(declaredMethods(/^export interface HirTyLowerer \{/));
  expect(dyn.filter((f) => !dynDecl.has(f.name)).map((f) => f.name)).toEqual([]);
  expect(dyn.length).toBe(92);
  expect(dynDecl.size).toBe(92);
  expect([...dynDecl].filter((n) => impl_.has(n))).toEqual([]);
  const gal = new Set(declaredMethods(/^export interface GenericArgsLowerer \{/));
  expect([...gal].sort()).toEqual(of("trait GenericArgsLowerer").map((f) => f.name).sort());
  // ItemCtxt: inherent methods with `self` are interface members, the three statics are `declare static`s
  const ic = of("ItemCtxt");
  const icDecl = new Set(declaredMethods(/^export interface ItemCtxt \{/));
  expect(ic.filter((f) => f.has_self && !icDecl.has(f.name)).map((f) => f.name)).toEqual([]);
  expect(ic.filter((f) => !f.has_self).map((f) => f.name)).toEqual(["new", "new_internal", "new_for_delegation"]);
  for (const f of ic.filter((f) => !f.has_self)) expect(typeof (ItemCtxt as unknown as Record<string, unknown>)[f.name]).toBe("function");
  expect(ic.length).toBe(14);
  // `impl HirTyLowerer for ItemCtxt` implements exactly the required methods
  expect(of("ItemCtxt", "HirTyLowerer").map((f) => f.name).sort()).toEqual([...impl_].sort());
});

test("every declared method exists once lib.ts is loaded", () => {
  const absent: string[] = [];
  for (const [header, obj] of [
    [/^export interface HirTyLowerer \{/, HirTyLowerer.prototype],
    [/^export class HirTyLowerer \{/, HirTyLowerer.prototype],
    [/^export interface ItemCtxt \{/, ItemCtxt.prototype],
    [/^export interface HirTyLowererImpl<S> \{/, Collect.HirTyLowerer_ItemCtxt],
  ] as const) {
    for (const name of declaredMethods(header)) {
      if (typeof (obj as unknown as Record<string, unknown>)[name] !== "function") absent.push(`${header.source} ${name}`);
    }
  }
  expect(absent).toEqual([]);
});

test("the free fns exist with their Fns_<module> signatures", () => {
  // Type-level: tsc checks every stub against the declared signature.
  const lib: D.Fns_lib = {
    check_c_variadic_abi: Lib.check_c_variadic_abi,
    provide: Lib.provide,
    check_crate: Lib.check_crate,
    lower_ty: Lib.lower_ty,
    lower_const_arg_for_rustdoc: Lib.lower_const_arg_for_rustdoc,
  };
  const collect: D.Fns_collect = {
    provide: Collect.provide,
    placeholder_type_error_diag: Collect.placeholder_type_error_diag,
    bad_placeholder: Collect.bad_placeholder,
    get_new_lifetime_name: Collect.get_new_lifetime_name,
    check_ctor: Collect.check_ctor,
    check_enum_variant_types: Collect.check_enum_variant_types,
    lower_variant: Collect.lower_variant,
    adt_def: Collect.adt_def,
    trait_def: Collect.trait_def,
    fn_sig: Collect.fn_sig,
    lower_fn_sig_recovering_infer_ret_ty: Collect.lower_fn_sig_recovering_infer_ret_ty,
    late_param_regions_to_bound: Collect.late_param_regions_to_bound,
    recover_infer_ret_ty: Collect.recover_infer_ret_ty,
    suggest_impl_trait: Collect.suggest_impl_trait,
    impl_is_fully_generic_for_reflection: Collect.impl_is_fully_generic_for_reflection,
    impl_trait_header: Collect.impl_trait_header,
    check_impl_constness: Collect.check_impl_constness,
    polarity_of_impl: Collect.polarity_of_impl,
    early_bound_lifetimes_from_generics: Collect.early_bound_lifetimes_from_generics,
    compute_sig_of_foreign_fn_decl: Collect.compute_sig_of_foreign_fn_decl,
    coroutine_kind: Collect.coroutine_kind,
    coroutine_for_closure: Collect.coroutine_for_closure,
    opaque_ty_origin: Collect.opaque_ty_origin,
    rendered_precise_capturing_args: Collect.rendered_precise_capturing_args,
    const_param_default: Collect.const_param_default,
    anon_const_kind: Collect.anon_const_kind,
    const_of_item: Collect.const_of_item,
  };
  const generics_of: D.Fns_collect_generics_of = {
    generics_of: GenericsOf.generics_of,
    param_default_policy: GenericsOf.param_default_policy,
    has_late_bound_regions: GenericsOf.has_late_bound_regions,
  };
  const type_of: D.Fns_collect_type_of = {
    type_of: TypeOf.type_of,
    type_of_opaque: TypeOf.type_of_opaque,
    type_of_opaque_hir_typeck: TypeOf.type_of_opaque_hir_typeck,
    anon_const_type_of: TypeOf.anon_const_type_of,
    const_arg_anon_type_of: TypeOf.const_arg_anon_type_of,
    infer_placeholder_type: TypeOf.infer_placeholder_type,
    check_feature_inherent_assoc_ty: TypeOf.check_feature_inherent_assoc_ty,
    type_alias_is_checked: TypeOf.type_alias_is_checked,
  };
  const opaque: D.Fns_collect_type_of_opaque = {
    find_opaque_ty_constraints_for_impl_trait_in_assoc_type: Opaque.find_opaque_ty_constraints_for_impl_trait_in_assoc_type,
    find_opaque_ty_constraints_for_tait: Opaque.find_opaque_ty_constraints_for_tait,
    find_opaque_ty_constraints_for_rpit: Opaque.find_opaque_ty_constraints_for_rpit,
  };
  const clauses_of: D.Fns_collect_clauses_of = {
    clauses_of: Clauses.clauses_of,
    gather_explicit_clauses_of: Clauses.gather_explicit_clauses_of,
    where_predicate_clauses: Clauses.where_predicate_clauses,
    compute_bidirectional_outlives_clauses: Clauses.compute_bidirectional_outlives_clauses,
    const_evaluatable_clauses_of: Clauses.const_evaluatable_clauses_of,
    trait_explicit_clauses_and_bounds: Clauses.trait_explicit_clauses_and_bounds,
    explicit_clauses_of: Clauses.explicit_clauses_of,
    explicit_super_clauses_of: Clauses.explicit_super_clauses_of,
    explicit_supertraits_containing_assoc_item: Clauses.explicit_supertraits_containing_assoc_item,
    explicit_implied_clauses_of: Clauses.explicit_implied_clauses_of,
    implied_clauses_with_filter: Clauses.implied_clauses_with_filter,
    assert_only_contains_clauses_from: Clauses.assert_only_contains_clauses_from,
    type_param_clauses: Clauses.type_param_clauses,
    const_conditions: Clauses.const_conditions,
    explicit_implied_const_bounds: Clauses.explicit_implied_const_bounds,
  };
  const item_bounds: D.Fns_collect_item_bounds = {
    associated_type_bounds: ItemBounds.associated_type_bounds,
    remap_gat_vars_and_recurse_into_nested_projections: ItemBounds.remap_gat_vars_and_recurse_into_nested_projections,
    opaque_type_bounds: ItemBounds.opaque_type_bounds,
    explicit_item_bounds: ItemBounds.explicit_item_bounds,
    explicit_item_self_bounds: ItemBounds.explicit_item_self_bounds,
    explicit_item_bounds_with_filter: ItemBounds.explicit_item_bounds_with_filter,
    item_bounds: ItemBounds.item_bounds,
    item_self_bounds: ItemBounds.item_self_bounds,
    item_non_self_bounds: ItemBounds.item_non_self_bounds,
    impl_super_outlives: ItemBounds.impl_super_outlives,
  };
  const rbv: D.Fns_collect_resolve_bound_vars = {
    provide: Rbv.provide,
    resolve_bound_vars: Rbv.resolve_bound_vars,
    late_arg_as_bound_arg: Rbv.late_arg_as_bound_arg,
    generic_param_def_as_bound_arg: Rbv.generic_param_def_as_bound_arg,
    opaque_captures_all_in_scope_lifetimes: Rbv.opaque_captures_all_in_scope_lifetimes,
    object_lifetime_default: Rbv.object_lifetime_default,
    is_late_bound_map: Rbv.is_late_bound_map,
    deny_non_region_late_bound: Rbv.deny_non_region_late_bound,
  };
  const dump: D.Fns_collect_dump = {
    generics: Dump.generics,
    object_lifetime_defaults: Dump.object_lifetime_defaults,
    opaque_hidden_types: Dump.opaque_hidden_types,
    clauses_and_item_bounds: Dump.clauses_and_item_bounds,
    def_parents: Dump.def_parents,
    vtables: Dump.vtables,
  };
  const bounds: D.Fns_hir_ty_lowering_bounds = {
    search_bounds_for: Bounds.search_bounds_for,
    collect_bounds: Bounds.collect_bounds,
    collect_sizedness_bounds: Bounds.collect_sizedness_bounds,
    add_trait_bound: Bounds.add_trait_bound,
    check_assoc_const_binding_type: Bounds.check_assoc_const_binding_type,
  };
  const generics: D.Fns_hir_ty_lowering_generics = {
    generic_arg_mismatch_err: Generics.generic_arg_mismatch_err,
    lower_generic_args: Generics.lower_generic_args,
    check_generic_arg_count_for_value_path: Generics.check_generic_arg_count_for_value_path,
    check_generic_arg_count: Generics.check_generic_arg_count,
    prohibit_explicit_late_bound_lifetimes: Generics.prohibit_explicit_late_bound_lifetimes,
  };
  const dyn_trait: D.Fns_hir_ty_lowering_dyn_trait = {
    replace_dummy_self_with_error: DynTrait.replace_dummy_self_with_error,
  };
  const errors: D.Fns_hir_ty_lowering_errors = {
    prohibit_assoc_item_constraint: Errors.prohibit_assoc_item_constraint,
    fn_trait_to_string: Errors.fn_trait_to_string,
    generics_args_err_extend: Errors.generics_args_err_extend,
    assoc_tag_str: Errors.assoc_tag_str,
    eq_ctxt_suggestion_span: Errors.eq_ctxt_suggestion_span,
  };
  const cmse: D.Fns_hir_ty_lowering_cmse = {
    validate_cmse_abi: Cmse.validate_cmse_abi,
    is_valid_cmse_inputs: Cmse.is_valid_cmse_inputs,
    is_valid_cmse_output: Cmse.is_valid_cmse_output,
    is_valid_cmse_output_layout: Cmse.is_valid_cmse_output_layout,
    should_emit_layout_error: Cmse.should_emit_layout_error,
  };
  const byFile: Record<string, [string, object]> = {
    "lib.rs": ["Fns_lib", lib],
    "collect.rs": ["Fns_collect", collect],
    "collect/generics_of.rs": ["Fns_collect_generics_of", generics_of],
    "collect/type_of.rs": ["Fns_collect_type_of", type_of],
    "collect/type_of/opaque.rs": ["Fns_collect_type_of_opaque", opaque],
    "collect/clauses_of.rs": ["Fns_collect_clauses_of", clauses_of],
    "collect/item_bounds.rs": ["Fns_collect_item_bounds", item_bounds],
    "collect/resolve_bound_vars.rs": ["Fns_collect_resolve_bound_vars", rbv],
    "collect/dump.rs": ["Fns_collect_dump", dump],
    "hir_ty_lowering/bounds.rs": ["Fns_hir_ty_lowering_bounds", bounds],
    "hir_ty_lowering/generics.rs": ["Fns_hir_ty_lowering_generics", generics],
    "hir_ty_lowering/dyn_trait.rs": ["Fns_hir_ty_lowering_dyn_trait", dyn_trait],
    "hir_ty_lowering/errors.rs": ["Fns_hir_ty_lowering_errors", errors],
    "hir_ty_lowering/cmse.rs": ["Fns_hir_ty_lowering_cmse", cmse],
  };
  // Every upstream free fn (outside an impl / trait, not nested) of a file is a member of its interface, and the object
  // above names exactly the interface's members, all functions.
  const nested = new Set(["outlives_bounds", "is_const_param_default", "span_of_infer", "resolve_param"]);
  for (const file of Object.keys(FILES)) {
    const free = ALL.filter((f) => f.file === file && f.self_ty === undefined && !(nested.has(f.name) || (file === "collect/generics_of.rs" && f.line === 499)));
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
  const lowerer = Object.create(HirTyLowerer.prototype) as HirTyLowerer;
  const icx = Object.create(ItemCtxt.prototype) as ItemCtxt;
  // A method that is still a placeholder reports its module path; once ported it no longer stops here, so only
  // placeholders are probed.
  const probes: [object, string, string][] = [
    [lowerer, "lower_ty", "rustc_hir_analysis::hir_ty_lowering::HirTyLowerer::lower_ty"],
    [lowerer, "lower_generic_args_of_path", "rustc_hir_analysis::hir_ty_lowering::HirTyLowerer::lower_generic_args_of_path"],
    [lowerer, "lower_bounds", "rustc_hir_analysis::hir_ty_lowering::bounds::HirTyLowerer::lower_bounds"],
    [lowerer, "lower_trait_object_ty", "rustc_hir_analysis::hir_ty_lowering::dyn_trait::HirTyLowerer::lower_trait_object_ty"],
    [lowerer, "report_ambiguous_assoc_item", "rustc_hir_analysis::hir_ty_lowering::errors::HirTyLowerer::report_ambiguous_assoc_item"],
    [icx, "lower_ty", "rustc_hir_analysis::collect::ItemCtxt::lower_ty"],
    [icx, "probe_ty_param_bounds_in_generics", "rustc_hir_analysis::collect::clauses_of::ItemCtxt::probe_ty_param_bounds_in_generics"],
    [Collect.HirTyLowerer_ItemCtxt, "re_infer", "rustc_hir_analysis::collect::<ItemCtxt as HirTyLowerer>::re_infer"],
  ];
  for (const [obj, name, path] of probes) {
    const fn = (obj as Record<string, () => unknown>)[name]!;
    if (unported_stub_path(fn) !== undefined) expect(stop(() => fn.call(obj))).toContain(path);
  }
  for (const [f, path] of [
    [() => (ItemCtxt.new as (...a: unknown[]) => unknown)(), "rustc_hir_analysis::collect::ItemCtxt::new"],
    [() => (Collect.fn_sig as (...a: unknown[]) => unknown)(), "rustc_hir_analysis::collect::fn_sig"],
    [() => (Generics.lower_generic_args as (...a: unknown[]) => unknown)(), "rustc_hir_analysis::hir_ty_lowering::generics::lower_generic_args"],
  ] as const) {
    const text = f.toString();
    if (text.includes("unported")) expect(stop(f)).toContain(path);
  }
});

test("ItemCtxt::lowerer() is a trait object dispatching through HirTyLowerer_ItemCtxt", () => {
  const icx = Object.create(ItemCtxt.prototype) as ItemCtxt;
  const l = icx.lowerer();
  expect(l).toBeInstanceOf(HirTyLowerer);
  expect(l.data).toBe(icx);
  expect(l.vtable).toBe(Collect.HirTyLowerer_ItemCtxt as D.HirTyLowererImpl<unknown>);
  // the trait methods reach the impl with the implementor as `this`
  const seen: unknown[] = [];
  const vtable = { ...Collect.HirTyLowerer_ItemCtxt, tcx(this: ItemCtxt) { seen.push(this); return undefined as never; } };
  new HirTyLowerer(icx, vtable as D.HirTyLowererImpl<unknown>).tcx();
  expect(seen).toEqual([icx]);
  if (unported_stub_path(Collect.HirTyLowerer_ItemCtxt.item_def_id) !== undefined) {
    expect(stop(() => l.item_def_id())).toContain("rustc_hir_analysis::collect::<ItemCtxt as HirTyLowerer>::item_def_id");
  }
});

/** The names in every `unported_methods(<target>, ..., [..])` list of a TS module, per list. */
function stubLists(text: string, target: string): { at: number; names: string[] }[] {
  const out: { at: number; names: string[] }[] = [];
  const re = new RegExp(`unported_methods\\(${target.replace(/\./g, "\\.")}, "[^"]*", \\[([^\\]]*)\\]\\)`, "g");
  for (const m of text.matchAll(re)) out.push({ at: m.index!, names: [...m[1]!.matchAll(/"(\w+)"/g)].map((x) => x[1]!) });
  return out;
}

test("each stub module's placeholder lists name only that file's methods", () => {
  const wrong: string[] = [];
  for (const [file, ts] of Object.entries(FILES)) {
    const text = here(ts);
    for (const [target, self_ty, trait_] of [
      ["HirTyLowerer.prototype", "dyn HirTyLowerer", undefined],
      ["ItemCtxt.prototype", "ItemCtxt", undefined],
      ["HirTyLowerer_ItemCtxt", "ItemCtxt", "HirTyLowerer"],
    ] as const) {
      const own = new Set(ALL.filter((f) => f.file === file && f.self_ty === self_ty && f.trait_ === trait_ && f.has_self).map((f) => f.name));
      for (const list of stubLists(text, target)) for (const n of list.names) if (!own.has(n)) wrong.push(`${ts}: ${target} ${n}`);
    }
  }
  expect(wrong).toEqual([]);
});

test("mod.ts's two placeholder lists split mod.rs at line 2186 (lanes hir-ty-lowering-a / hir-ty-lowering-b)", () => {
  const text = here("hir_ty_lowering/mod.ts");
  const a_at = text.indexOf("// ==== lane hir-ty-lowering-a: mod.rs:1..2185 ====");
  const b_at = text.indexOf("// ==== lane hir-ty-lowering-b: mod.rs:2186..3915 ====");
  expect(a_at).toBeGreaterThan(0);
  expect(b_at).toBeGreaterThan(a_at);
  const dyn = ALL.filter((f) => f.file === "hir_ty_lowering/mod.rs" && f.self_ty === "dyn HirTyLowerer");
  const line = new Map(dyn.map((f) => [f.name, f.line]));
  const wrong: string[] = [];
  for (const list of stubLists(text, "HirTyLowerer.prototype")) {
    const in_b = list.at > b_at;
    for (const n of list.names) if ((line.get(n)! >= MOD_SPLIT) !== in_b) wrong.push(`${n} (mod.rs:${line.get(n)}) in the ${in_b ? "-b" : "-a"} list`);
  }
  expect(wrong).toEqual([]);
  // the split point is a method boundary: `probe_generic_path_segments` (mod.rs:2037) ends at line 2185; line 2186 is
  // blank and the doc comment of `lower_resolved_ty_path` (mod.rs:2189) starts at 2187
  const rs = readFileSync(join(UPSTREAM, SRC + "hir_ty_lowering/mod.rs"), "utf8").split("\n");
  expect(rs[MOD_SPLIT - 2]!).toBe("    }");
  expect(rs[MOD_SPLIT - 1]!.trim()).toBe("");
  expect(rs[MOD_SPLIT]!.trim()).toBe("/// Lower a [resolved][hir::QPath::Resolved] path to a type.");
  expect(dyn.find((f) => f.line > MOD_SPLIT)?.name).toBe("lower_resolved_ty_path");
  expect([...dyn].reverse().find((f) => f.line < MOD_SPLIT)?.name).toBe("probe_generic_path_segments");
});

test("provide installs the collect providers (and leaves the others)", () => {
  const providers = {} as Record<string, unknown>;
  Lib.provide(providers as unknown as Providers);
  expect(providers.type_of).toBe(TypeOf.type_of);
  expect(providers.generics_of).toBe(GenericsOf.generics_of);
  expect(providers.clauses_of).toBe(Clauses.clauses_of);
  expect(providers.item_bounds).toBe(ItemBounds.item_bounds);
  expect(providers.fn_sig).toBe(Collect.fn_sig);
  expect(providers.const_of_item).toBe(Collect.const_of_item);
  // collect.rs:65 assigns 32 queries, resolve_bound_vars::provide (resolve_bound_vars.rs:234, lane collect-rbv) 6,
  // lib.rs the 2 delegation queries (lane hira-misc) and check::provide (check/mod.rs:112, lane check-check) the 4 of its 9
  // whose fns are in check/mod.rs and check/check.rs; the other wave-17 modules none yet
  expect(Object.keys(providers).length).toBe(44);
  expect(providers.adt_destructor).toBeTypeOf("function");
  expect(providers.adt_async_destructor).toBeTypeOf("function");
  expect(providers.check_coroutine_obligations).toBeTypeOf("function");
  expect(providers.check_potentially_region_dependent_goals).toBeTypeOf("function");
  expect(providers.inherit_sig_for_delegation_item).toBe(Lib.delegation.inherit_sig_for_delegation_item);
  expect(providers.delegation_user_specified_args).toBe(Lib.delegation.delegation_user_specified_args);
  expect(providers.resolve_bound_vars).toBe(Rbv.resolve_bound_vars);
  expect(providers.is_late_bound_map).toBe(Rbv.is_late_bound_map);
  expect(providers.object_lifetime_default).toBe(Rbv.object_lifetime_default);
  for (const q of ["named_variable_map", "late_bound_vars_map", "opaque_captured_lifetimes"]) expect([q, typeof providers[q]]).toEqual([q, "function"]);
  expect(providers.variances_of).toBeUndefined();
});
