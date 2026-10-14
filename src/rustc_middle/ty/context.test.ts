// Lane ty-ctxt: ty/context.rs (interning, `mk_*`, the `TyCtxt` accessors) and ty/context/impl_interner.rs
// (`impl Interner for TyCtxt`), checked against upstream:
// - the interners and `mk_*` identities (same value -> the same object, `mk_fn_sig` builds over `mk_type_list`, the
//   `CollectAndApply` `Result` path stops at the first `Err`);
// - the `Interner` method table: every fn of `impl Interner for TyCtxt` has its marker in impl_interner.ts and a
//   callable `TyCtxt` method (an inherent method, a query, or the impl's own body), none of them a context.ts
//   placeholder;
// - the three `bidirectional_lang_item_map!` lists equal upstream's and the generated solver lang-item enums.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import "../lib.ts";
import { UPSTREAM } from "../../../scripts/lib/common.ts";
import { unported_stub_path } from "../../rust_ts/stubs.ts";
import { CRATE_DEF_ID, DefId, DefIndex, LOCAL_CRATE } from "../../rustc_span/def_id.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { kw, sym } from "../../rustc_span/symbol.ts";
import type { PolyExistentialPredicate } from "../../rustc_type_ir/decls.ts";
import { CollectAndApply_Result } from "../../rustc_type_ir/interner.ts";
import { SolverAdtLangItem, SolverProjectionLangItem, SolverTraitLangItem } from "../../rustc_type_ir/lang_items.ts";
import { FnSigKind } from "../../rustc_type_ir/ty_kind.ts";
import { PLAIN, PRETTY } from "../../std/fmt.ts";
import { Panic, Unported } from "../../std/panic.ts";
import { RawList } from "./list.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { CommonConsts, CommonLifetimes, CommonTypes, CtxtInterners, debug_FreeRegionInfo, type GlobalCtxt, InternedInSet, inherent_DefId, inherent_Features, inherent_Safety, inherent_Span, TyCtxt } from "./context.ts";
import { SOLVER_LANG_ITEM_MAPS } from "./context/impl_interner.ts";
import { GenericArg } from "./generic_args.ts";
import { Ty } from "./mod.ts";

/** A `TyCtxt` over a fresh `CtxtInterners` (the interning methods read only `interners` / `types` / `lifetimes`). */
function mk_tcx(sess?: unknown): TyCtxt {
  const interners = CtxtInterners.new(undefined);
  let types: CommonTypes | undefined;
  let lifetimes: CommonLifetimes | undefined;
  const gcx = {
    interners,
    sess,
    get types() {
      return (types ??= CommonTypes.new(interners));
    },
    get lifetimes() {
      return (lifetimes ??= CommonLifetimes.new(interners));
    },
  };
  return new TyCtxt(gcx as unknown as GlobalCtxt);
}

describe("mk_* identities", () => {
  test("mk_fn_sig interns inputs ++ [output] as one type list", () => {
    const tcx = mk_tcx();
    const t = tcx.types;
    const sig = tcx.mk_fn_sig([t.i32, t.bool], t.unit, FnSigKind.default_());
    expect(sig.inputs_and_output).toBe(tcx.mk_type_list([t.i32, t.bool, t.unit]));
    expect(sig.fn_sig_kind).toEqual(FnSigKind.default_());
    // the output alone
    expect(tcx.mk_fn_sig([], t.never, FnSigKind.default_()).inputs_and_output).toBe(tcx.mk_type_list([t.never]));
  });

  test("mk_fn_sig_{rust_abi,safe_rust_abi,unsafe_rust_abi} set the safety on FnSigKind::default()", () => {
    const tcx = mk_tcx();
    const t = tcx.types;
    expect(tcx.mk_fn_sig_safe_rust_abi([t.u8], t.u8).fn_sig_kind).toEqual(FnSigKind.set_safety(FnSigKind.default_(), "Safe"));
    expect(tcx.mk_fn_sig_unsafe_rust_abi([t.u8], t.u8).fn_sig_kind).toEqual(FnSigKind.set_safety(FnSigKind.default_(), "Unsafe"));
    expect(tcx.mk_fn_sig_rust_abi([t.u8], t.u8, "Unsafe")).toEqual(tcx.mk_fn_sig_unsafe_rust_abi([t.u8], t.u8));
    expect(FnSigKind.safety(tcx.mk_fn_sig_unsafe_rust_abi([], t.unit).fn_sig_kind)).toBe("Unsafe");
  });

  test("mk_fn_sig with Result items stops at the first Err (CollectAndApply for Result)", () => {
    const tcx = mk_tcx();
    const t = tcx.types;
    const ok: Result<Ty, string>[] = [Ok(t.i8), Ok(t.i16)];
    const r = tcx.mk_fn_sig(ok, Ok(t.unit), FnSigKind.default_(), CollectAndApply_Result);
    expect(r.$).toBe("Ok");
    if (r.$ === "Ok") expect(r._0.inputs_and_output).toBe(tcx.mk_type_list([t.i8, t.i16, t.unit]));
    const bad: Result<Ty, string>[] = [Ok(t.i8), Err("first"), Err("second")];
    expect(tcx.mk_fn_sig(bad, Ok(t.unit), FnSigKind.default_(), CollectAndApply_Result)).toEqual(Err("first"));
    expect(tcx.mk_fn_sig([Ok(t.i8)], Err("out"), FnSigKind.default_(), CollectAndApply_Result)).toEqual(Err("out"));
  });

  test("check_and_mk_args is mk_args_from_iter (debug_assert_args_compatible is off in the release oracle)", () => {
    const tcx = mk_tcx();
    const t = tcx.types;
    const did = DefId.local(DefIndex.from_usize(7));
    const args = tcx.check_and_mk_args(did, [GenericArg.from_Ty(t.bool), GenericArg.from_Region(tcx.lifetimes.re_static)]);
    expect(args).toBe(tcx.mk_args([t.bool, tcx.lifetimes.re_static]));
    expect(tcx.mk_args_trait(t.char, [t.bool])).toBe(tcx.mk_args([t.char, t.bool]));
  });

  test("mk_poly_existential_predicates asserts non-empty; one predicate needs no stable_cmp", () => {
    const tcx = mk_tcx();
    expect(() => tcx.mk_poly_existential_predicates([])).toThrow(Panic);
    const ep = { value: { $: "AutoTrait", _0: DefId.local(DefIndex.from_usize(3)) }, bound_vars: tcx.mk_bound_variable_kinds([]) } as unknown as PolyExistentialPredicate;
    const l = tcx.mk_poly_existential_predicates([ep]);
    expect(l.length).toBe(1);
    expect(tcx.mk_poly_existential_predicates([ep])).toBe(l);
    expect(tcx.intern_poly_existential_predicates([ep])).toBe(l);
  });

  test("InternedInSet's Borrow/Eq/Hash agree with interning", () => {
    const tcx = mk_tcx();
    const t = tcx.types;
    expect(InternedInSet.hash_WithCachedTypeInfo(t.bool)).toBe(InternedInSet.hash_WithCachedTypeInfo(tcx.mk_ty_from_kind({ $: "Bool" })));
    expect(InternedInSet.eq_WithCachedTypeInfo(t.bool, t.char)).toBe(false);
    expect(InternedInSet.borrow_WithCachedTypeInfo(t.never)).toEqual({ $: "Never" });
    const l = tcx.mk_type_list([t.u8, t.u16]);
    expect(InternedInSet.eq_List(l, tcx.mk_type_list([t.u8, t.u16]))).toBe(true);
    expect(InternedInSet.eq_List(l, tcx.mk_type_list([t.u16, t.u8]))).toBe(false);
    expect(InternedInSet.borrow_direct(tcx.lifetimes.re_static)).toEqual({ $: "ReStatic" });
  });

  test("lift is the identity on values of this TyCtxt", () => {
    const tcx = mk_tcx();
    expect(tcx.lift(tcx.types.str_)).toBe(tcx.types.str_);
    const l = tcx.mk_type_list([tcx.types.f32]);
    expect(tcx.lift(l)).toBe(l);
  });

  test("CommonConsts::new interns the zst / true / false valtrees (ValTree landed, lane ty-results)", () => {
    const tcx = mk_tcx();
    const cc = CommonConsts.new(tcx.interners, tcx.types);
    expect(tcx.intern_valtree({ $: "Branch", _0: RawList.empty() } as never)).toBe(cc.valtree_zst);
    expect(CommonConsts.new(tcx.interners, tcx.types).true_).toBe(cc.true_);
  });
});

describe("TyCtxt accessors", () => {
  test("next_trait_solver_globally / use_typing_mode_post_typeck_until_borrowck read the session options", () => {
    const opts = { unstable_opts: { next_solver: "Globally", higher_ranked_assumptions: false, typing_mode_post_typeck_until_borrowck: false, assumptions_on_binders: true, renormalize_rigid_aliases: false, disable_fast_paths: true, disable_param_env_normalization_hack: false } };
    const tcx = mk_tcx({ opts });
    let gce = false;
    Object.defineProperty(tcx, "features_query", { value: () => ({ generic_const_exprs: () => gce }) });
    expect(tcx.next_trait_solver_globally()).toBe(true);
    expect(tcx.use_typing_mode_post_typeck_until_borrowck()).toBe(true);
    gce = true;
    expect(tcx.next_trait_solver_globally()).toBe(false);
    expect(tcx.use_typing_mode_post_typeck_until_borrowck()).toBe(false);
    opts.unstable_opts.next_solver = "Coherence";
    gce = false;
    expect(tcx.next_trait_solver_globally()).toBe(false);
    expect(tcx.assumptions_on_binders()).toBe(true);
    expect(tcx.renormalize_rigid_aliases()).toBe(false);
    expect(tcx.disable_trait_solver_fast_paths()).toBe(true);
    expect(tcx.disable_param_env_normalization_hack()).toBe(false);
  });

  test("default_traits is empty unless -Zexperimental-default-bounds", () => {
    const opts = { unstable_opts: { experimental_default_bounds: false } };
    const tcx = mk_tcx({ opts });
    expect(tcx.default_traits()).toEqual([]);
    opts.unstable_opts.experimental_default_bounds = true;
    expect(tcx.default_traits()).toEqual(["DefaultTrait1", "DefaultTrait2", "DefaultTrait3", "DefaultTrait4"]);
  });

  test("the inherent::* impls forward", () => {
    const d = DefId.local(DefIndex.from_usize(5));
    expect(inherent_DefId.is_local(d)).toBe(true);
    expect(inherent_DefId.as_local(d)).toBe(d.as_local());
    expect([inherent_Safety.safe(), inherent_Safety.unsafe_mode()]).toEqual(["Safe", "Unsafe"]);
    expect([inherent_Safety.is_safe("Safe"), inherent_Safety.is_safe("Unsafe"), inherent_Safety.prefix_str("Unsafe")]).toEqual([true, false, "unsafe "]);
    expect(inherent_Span.dummy()).toBe(DUMMY_SP);
    const feats = { staged_api: () => false, enabled: (s: unknown) => s === sym.doc_cfg };
    expect(inherent_Features.feature_bound_holds_in_crate(feats as never, sym.doc_cfg)).toBe(true);
    expect(inherent_Features.feature_bound_holds_in_crate({ ...feats, staged_api: () => true } as never, sym.doc_cfg)).toBe(false);
  });

  test("Debug of FreeRegionInfo", () => {
    const v = { scope: CRATE_DEF_ID, region_def_id: DefId.local(DefIndex.from_usize(2)), is_impl_item: false };
    // `DefId` Debug without a TyCtxt in TLS (the default `DEF_ID_DEBUG`): the derived form.
    const d0 = "DefId { krate: crate0, index: DefIndex(0) }";
    const d2 = "DefId { krate: crate0, index: DefIndex(2) }";
    expect(debug_FreeRegionInfo(v, PLAIN)).toBe(`FreeRegionInfo { scope: ${d0}, region_def_id: ${d2}, is_impl_item: false }`);
    expect(debug_FreeRegionInfo(v, PRETTY)).toBe(
      "FreeRegionInfo {\n    scope: DefId {\n        krate: crate0,\n        index: DefIndex(0),\n    },\n    region_def_id: DefId {\n        krate: crate0,\n        index: DefIndex(2),\n    },\n    is_impl_item: false,\n}",
    );
  });

  test("Self param type is the pre-interned self_param", () => {
    const tcx = mk_tcx();
    expect(tcx.mk_ty_from_kind({ $: "Param", _0: { index: 0, name: kw.SelfUpper } })).toBe(tcx.types.self_param);
  });
});

const IMPL_INTERNER_RS = "compiler/rustc_middle/src/ty/context/impl_interner.rs";
const IMPL_INTERNER_TS = readFileSync(join(import.meta.dir, "context/impl_interner.ts"), "utf8");
const INTERNER_TS = readFileSync(join(import.meta.dir, "../../rustc_type_ir/interner.ts"), "utf8");

/** `(line, name)` of every `fn` directly inside `impl<'tcx> Interner for TyCtxt<'tcx> { .. }`. */
function interner_impl_fns(): { line: number; name: string }[] {
  const lines = readFileSync(join(UPSTREAM, IMPL_INTERNER_RS), "utf8").split("\n");
  const start = lines.findIndex((l) => l.startsWith("impl<'tcx> Interner for TyCtxt<'tcx> {"));
  expect(start).toBeGreaterThan(0);
  const out: { line: number; name: string }[] = [];
  for (let i = start + 1; i < lines.length && lines[i] !== "}"; i++) {
    const m = /^ {4}fn (\w+)/.exec(lines[i]!);
    if (m) out.push({ line: i + 1, name: m[1]! });
  }
  return out;
}

describe("impl Interner for TyCtxt", () => {
  test("every fn of the impl has its marker in impl_interner.ts and a callable TyCtxt method", () => {
    const fns = interner_impl_fns();
    expect(fns.length).toBe(108);
    const unmarked: string[] = [];
    const missing: string[] = [];
    for (const { line, name } of fns) {
      if (!IMPL_INTERNER_TS.includes(`// rustc: ${IMPL_INTERNER_RS}:${line} ${name}\n`)) unmarked.push(`${line} ${name}`);
      // the Interner interface member name: `ir_<name>` for the renamed ones
      const member = new RegExp(`\\n {2}(ir_${name}|${name})[<(]`).exec(INTERNER_TS)?.[1];
      if (member === undefined) {
        missing.push(`interface ${name}`);
        continue;
      }
      const f = (TyCtxt.prototype as unknown as Record<string, unknown>)[member];
      if (typeof f !== "function") missing.push(member);
      else if (unported_stub_path(f) === "rustc_middle::ty::context::TyCtxt" || unported_stub_path(f) === "rustc_middle::ty::context::impl_interner::TyCtxt") missing.push(`${member} (placeholder)`);
    }
    expect(unmarked).toEqual([]);
    expect(missing).toEqual([]);
  });

  test("the served-by markers name a TyCtxt method or query of the same name", () => {
    const served = [...IMPL_INTERNER_TS.matchAll(/\/\/ rustc: \S+:\d+ (\w+)\n\/\/ served by the (?:inherent|query) `(\w+)`/g)];
    expect(served.length).toBeGreaterThan(50);
    for (const [, name, by] of served) {
      expect(by).toBe(name!);
      expect(typeof (TyCtxt.prototype as unknown as Record<string, unknown>)[by!]).toBe("function");
    }
  });

  test("bidirectional_lang_item_map! lists are upstream's and cover the solver enums exactly", () => {
    const src = readFileSync(join(UPSTREAM, IMPL_INTERNER_RS), "utf8");
    const lists = [...src.matchAll(/bidirectional_lang_item_map! \{\n\s*(\w+), fn \w+, fn \w+;\n([\s\S]*?)\n\}/g)].map((m) => [m[1]!, m[2]!.split("\n").map((l) => l.trim().replace(/,$/, "")).filter((l) => l !== "" && !l.startsWith("//"))] as const);
    expect(lists.map(([n]) => n)).toEqual(["SolverProjectionLangItem", "SolverAdtLangItem", "SolverTraitLangItem"]);
    const ours: ReadonlySet<string>[] = [SOLVER_LANG_ITEM_MAPS.projection, SOLVER_LANG_ITEM_MAPS.adt, SOLVER_LANG_ITEM_MAPS.trait_];
    const enums = [SolverProjectionLangItem, SolverAdtLangItem, SolverTraitLangItem];
    for (let i = 0; i < 3; i++) {
      expect([...ours[i]!]).toEqual(lists[i]![1]);
      expect([...ours[i]!].sort()).toEqual(Object.keys(enums[i]!).sort());
    }
    const m = SOLVER_LANG_ITEM_MAPS;
    expect(m.lang_item_to_solver_trait_lang_item("Sized")).toBe("Sized");
    expect(m.lang_item_to_solver_trait_lang_item("Option")).toBeUndefined();
    expect(m.lang_item_to_solver_adt_lang_item("Option")).toBe("Option");
    expect(m.lang_item_to_solver_lang_item("FutureOutput")).toBe("FutureOutput");
    expect(m.lang_item_to_solver_lang_item("Future")).toBeUndefined();
    expect(m.solver_trait_lang_item_to_lang_item("FnPtrTrait")).toBe("FnPtrTrait");
    expect(m.solver_adt_lang_item_to_lang_item("Poll")).toBe("Poll");
    expect(m.solver_lang_item_to_lang_item("Metadata")).toBe("Metadata");
  });

  test("impl bodies: parents, recursion limit, const-ness of aliases", () => {
    const tcx = mk_tcx();
    const parent = DefId.local(DefIndex.from_usize(1));
    Object.defineProperty(tcx, "parent", { value: () => parent });
    const d = DefId.local(DefIndex.from_usize(9));
    expect(tcx.projection_parent(d)).toBe(parent);
    expect(tcx.impl_or_trait_assoc_term_parent(d)).toBe(parent);
    expect(tcx.inherent_alias_term_parent(d)).toBe(parent);
    Object.defineProperty(tcx, "recursion_limit", { value: () => ({ _0: 128 }) });
    expect(tcx.ir_recursion_limit()).toBe(128);
    expect(tcx.ir_is_direct_const({ $: "Anon", def_id: d })).toBe(false);
    expect(tcx.ir_const_of_item({ $: "Anon", def_id: d })).toBeUndefined();
    Object.defineProperty(tcx, "is_direct_const", { value: (x: DefId) => x === d });
    expect(tcx.ir_is_direct_const({ $: "Free", def_id: d })).toBe(true);
    Object.defineProperty(tcx, "constness", { value: () => ({ $: "Const", always: false }) });
    expect(tcx.closure_is_const(d)).toBe(true);
    tcx.assert_evaluation_is_concurrent();
  });
});
