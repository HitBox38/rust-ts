// Test helper of src/rustc_hir_analysis/hir_ty_lowering/mod_a.test.ts (lane hir-ty-lowering-a).
//
// Runs the ported driver up to expansion, then calls the `impl dyn HirTyLowerer` methods of hir_ty_lowering/mod.rs:1..2185
// (and the enum methods / `ForbidParamUsesFolder` of that region) on the items of lower.rs, through a `HirTyLowerer` trait
// object. `ItemCtxt`'s vtable (collect.ts, lane collect-a) is still all `unported(..)`, so the trait object is built over
// a test implementor, `TestCx`, whose `tcx` / `dcx` / `item_def_id` / `mod_id` / `infcx` mirror `ItemCtxt`'s and whose
// other methods stop as UNPORTED. Each case prints one line; a case that reaches unported code prints
// `PENDING <case>: <the unported text>`.
//
//   bun run.ts <rustc arguments...>
import type { Compiler } from "../../../rustc_interface/interface.ts";
import * as hir from "../../../rustc_hir/lib.ts";
import { DefKind, type Res } from "../../../rustc_hir/def.ts";
import type { ModuleItems } from "../../../rustc_middle/hir/mod.ts";
import { AssocItem } from "../../../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { DefId, LocalDefId } from "../../../rustc_span/def_id.ts";
import { LocalDefId as LocalDefIdC } from "../../../rustc_span/def_id.ts";
import { DUMMY_SP } from "../../../rustc_span/span_encoding.ts";
import { Ident, Symbol } from "../../../rustc_span/symbol.ts";
import type { Region } from "../../../rustc_type_ir/sty/mod.ts";
import { fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { FatalErrorMarker } from "../../../rustc_errors/lib.ts";
import { Panic, Unported } from "../../../std/panic.ts";
import { unported } from "../../../std/panic.ts";
import { HirTyLowerer, type HirTyLowererImpl, type ResolvedArg } from "../../decls.ts";
import { HirTyLowerer_provided, AssocItemQSelf, ForbidParamUsesFolder, LowerTypeRelativePathMode } from "../mod.ts";
import { GenericsArgsErrExtend } from "../errors.ts";

/** The test implementor of `HirTyLowerer` (see the header). */
class TestCx {
  constructor(
    public tcx: TyCtxt,
    public item_def_id: LocalDefId,
  ) {}
}

const stop = (name: string): never => unported(`test lowerer: <TestCx as HirTyLowerer>::${name}`);

const TestCx_HirTyLowerer: HirTyLowererImpl<TestCx> = {
  tcx(this: TestCx) {
    return this.tcx;
  },
  dcx(this: TestCx) {
    return this.tcx.dcx();
  },
  item_def_id(this: TestCx) {
    return this.item_def_id;
  },
  mod_id(this: TestCx) {
    return this.tcx.parent_module_from_def_id(this.item_def_id);
  },
  re_infer: () => stop("re_infer"),
  ty_infer: () => stop("ty_infer"),
  ct_infer: () => stop("ct_infer"),
  register_trait_ascription_bounds: () => stop("register_trait_ascription_bounds"),
  probe_ty_param_bounds: () => stop("probe_ty_param_bounds"),
  select_inherent_assoc_candidates: () => stop("select_inherent_assoc_candidates"),
  lower_assoc_item_path: () => stop("lower_assoc_item_path"),
  lower_fn_sig: () => stop("lower_fn_sig"),
  // As `ItemCtxt::probe_adt` for the types used here (an ADT, or none for a non-alias type).
  probe_adt(this: TestCx, _span, ty) {
    const k = ty.kind();
    return k.$ === "Adt" ? k._0 : k.$ === "Alias" ? stop("probe_adt (alias)") : undefined;
  },
  record_ty: () => {},
  // `ItemCtxt` has no inference context.
  infcx: () => undefined,
  dyn_compatibility_violations: () => stop("dyn_compatibility_violations"),
};

function report(tcx: TyCtxt): string {
  const lines: string[] = [];
  const out = (s: string): void => {
    lines.push(s);
  };
  const run = (name: string, f: () => string): void => {
    try {
      out(`${name}: ${f()}`);
    } catch (e) {
      if (e instanceof Unported) {
        out(`PENDING ${name}: ${e.message}`);
      } else if (e instanceof Panic) {
        // An ICE of the ported code on a case the test fabricates (e.g. `EarlyBound` for a late-bound lifetime).
        out(`PANIC ${name}: ${e.message}`);
      } else if (e instanceof FatalErrorMarker) {
        // A query that stopped as UNPORTED in an earlier case is poisoned: rustc raises `FatalError` on its next use.
        out(`PENDING ${name}: FatalError (a query poisoned by an earlier UNPORTED case)`);
      } else {
        throw e;
      }
    }
  };

  // ---- the items of lower.rs, by name ----
  const items = new Map<string, hir.Item>();
  for (const id of (tcx.hir_crate_items(null) as ModuleItems).free_items()) {
    const item = tcx.hir_expect_item(id.owner_id.def_id);
    const k = item.kind;
    const ident = "ident" in k ? (k.ident as Ident) : k.$ === "Struct" || k.$ === "Mod" ? k._0 : undefined;
    items.set(ident !== undefined ? Symbol.as_str(ident.name) : k.$, item);
  }
  const item = (name: string): hir.Item => items.get(name)!;
  const did = (name: string): DefId => LocalDefIdC.to_def_id(item(name).owner_id.def_id);
  const name_of = (d: DefId): string => Symbol.as_str(tcx.item_name(d));
  const ident = (s: string): Ident => Ident.with_dummy_span(Symbol.intern(s));

  const with_lt = item("with_lt");
  const lowerer = HirTyLowerer_provided.lowerer(new TestCx(tcx, with_lt.owner_id.def_id), TestCx_HirTyLowerer);
  if (!(lowerer instanceof HirTyLowerer)) throw new Error("lowerer is not a trait object");
  if (with_lt.kind.$ !== "Fn") throw new Error("with_lt is not a fn");
  const sig = with_lt.kind.sig;
  const generics = with_lt.kind.generics;
  const lt_param = generics.params[0]!; // 'a
  const ty_param = generics.params[1]!; // T
  const x_ty = sig.decl.inputs[0]!; // &'a T
  const y_ty = sig.decl.inputs[1]!; // Wrap<S>
  if (x_ty.kind.$ !== "Ref" || y_ty.kind.$ !== "Path" || y_ty.kind._0.$ !== "Resolved") throw new Error("unexpected fixture HIR");
  const lifetime = x_ty.kind._0;
  const wrap_path = y_ty.kind._0._1;
  const wrap_segment = wrap_path.segments[wrap_path.segments.length - 1]!;
  const impl_item = item("Impl");
  if (impl_item.kind.$ !== "Impl" || impl_item.kind._0.of_trait === undefined) throw new Error("unexpected impl");
  const impl_trait_ref = impl_item.kind._0.of_trait.trait_ref;
  const sub = item("Sub");
  if (sub.kind.$ !== "Trait" || sub.kind.bounds[0]?.$ !== "Trait") throw new Error("unexpected Sub");
  const sub_bound = sub.kind.bounds[0]._0;
  const plain_segment = (s: string, res: Res = { $: "Err" }): hir.PathSegment => hir.PathSegment.new(ident(s), hir.HirId_INVALID, res);

  // ---- enum methods (mod.rs:261..:299) ----
  for (const [label, mode] of [
    ["Type(Yes)", { $: "Type", _0: "Yes" }],
    ["Type(No)", { $: "Type", _0: "No" }],
    ["Const", LowerTypeRelativePathMode.Const],
  ] as const) {
    run(`LowerTypeRelativePathMode::${label}`, () =>
      [
        `assoc_tag=${LowerTypeRelativePathMode.assoc_tag(mode)}`,
        `def_kind_for_diagnostics=${LowerTypeRelativePathMode.def_kind_for_diagnostics(mode).$}`,
        `permit_variants=${LowerTypeRelativePathMode.permit_variants(mode)}`,
      ].join(" "),
    );
  }
  run("AssocItemQSelf::Trait(Tr).to_string", () => AssocItemQSelf.to_string({ $: "Trait", _0: did("Tr") }, tcx));
  run("AssocItemQSelf::Trait(m::Inner).to_string", () => AssocItemQSelf.to_string({ $: "Trait", _0: did("Inner") }, tcx));
  run("AssocItemQSelf::TyParam(T).to_string", () => AssocItemQSelf.to_string({ $: "TyParam", _0: ty_param.def_id, _1: DUMMY_SP }, tcx));
  run("AssocItemQSelf::SelfTyAlias.to_string", () => AssocItemQSelf.to_string(AssocItemQSelf.SelfTyAlias, tcx));

  // ---- ForbidParamUsesFolder (mod.rs:401..:485), on values it leaves alone ----
  const folder = new ForbidParamUsesFolder(tcx, with_lt.owner_id.def_id, DUMMY_SP, false, "ConstArgument");
  run("ForbidParamUsesFolder.cx", () => `${folder.cx() === tcx}`);
  run("ForbidParamUsesFolder.fold_ty(u8)", () => `${folder.fold_ty(tcx.types.u8) === tcx.types.u8}`);
  run("ForbidParamUsesFolder.fold_region('static)", () => `${folder.fold_region(tcx.lifetimes.re_static) === tcx.lifetimes.re_static}`);

  // ---- mod.rs:491..:576: `with_lt` is not an anon const ----
  run("anon_const_forbids_generic_params(with_lt)", () => `${lowerer.anon_const_forbids_generic_params()}`);
  run("check_param_res_if_mcg_for_instantiate_value_path(ConstParam)", () =>
    lowerer.check_param_res_if_mcg_for_instantiate_value_path({ $: "Def", _0: DefKind.ConstParam, _1: did("S") }, DUMMY_SP).$,
  );
  run("check_param_uses_if_mcg(u8)", () => `${lowerer.check_param_uses_if_mcg(tcx.types.u8, DUMMY_SP, false, fold_Ty) === tcx.types.u8}`);

  // ---- lifetimes (mod.rs:580..:629) ----
  const show_region = (r: Region): string => {
    const k = r.kind();
    switch (k.$) {
      case "ReStatic":
        return "ReStatic";
      case "ReBound":
        return k._0.$ === "Bound" && k._1.kind.$ === "Named"
          ? `ReBound(Bound(${k._0._0}), var=${k._1.var}, Named(${name_of(k._1.kind._0)}))`
          : "ReBound(..)";
      case "ReLateParam":
        return `ReLateParam(scope=${name_of(k._0.scope)})`;
      default:
        return k.$;
    }
  };
  run("lower_resolved_lifetime(StaticLifetime)", () => {
    const r = lowerer.lower_resolved_lifetime({ $: "StaticLifetime" } as unknown as ResolvedArg);
    return `${show_region(r)} interned=${r === tcx.lifetimes.re_static}`;
  });
  run("lower_resolved_lifetime(LateBound(INNERMOST, 0, 'a))", () =>
    show_region(lowerer.lower_resolved_lifetime({ $: "LateBound", _0: 0, _1: 0, _2: lt_param.def_id } as unknown as ResolvedArg)),
  );
  run("lower_resolved_lifetime(Free(with_lt, 'a))", () =>
    show_region(lowerer.lower_resolved_lifetime({ $: "Free", _0: with_lt.owner_id.def_id, _1: lt_param.def_id } as unknown as ResolvedArg)),
  );
  run("lower_resolved_lifetime(EarlyBound('a))", () =>
    show_region(lowerer.lower_resolved_lifetime({ $: "EarlyBound", _0: lt_param.def_id } as unknown as ResolvedArg)),
  );
  run("lower_lifetime('a)", () => show_region(lowerer.lower_lifetime(lifetime, { $: "Reference" })));

  // ---- generic args, trait refs, path segments (mod.rs:631..:1237) ----
  run("lower_generic_args_of_path_segment(Wrap<S>)", () => `${lowerer.lower_generic_args_of_path_segment(DUMMY_SP, did("Wrap"), wrap_segment).length}`);
  run("lower_path_segment(S)", () => `${lowerer.lower_path_segment(DUMMY_SP, did("S"), plain_segment("S")).kind().$}`);
  run("lower_impl_trait_ref(impl Tr for S)", () => name_of(lowerer.lower_impl_trait_ref(impl_trait_ref, tcx.types.u8).def_id));
  run("lower_poly_trait_ref(Sub: Tr)", () => `${lowerer.lower_poly_trait_ref(sub_bound, tcx.types.u8, [], { $: "All" }, "Allowed").correct.$}`);
  run("lower_mono_trait_ref(Tr)", () => name_of(lowerer.lower_mono_trait_ref(DUMMY_SP, did("Tr"), tcx.types.u8, plain_segment("Tr"), false).def_id));
  for (const [trait_, tag, name] of [
    ["Tr", "Type", "Assoc"],
    ["Tr", "Const", "Assoc"],
    ["Tr", "Const", "C"],
    ["Tr", "Fn", "f"],
    ["Other", "Type", "Assoc"],
    ["Inner", "Type", "Item"],
  ] as const) {
    run(`probe_trait_that_defines_assoc_item(${trait_}, ${tag}, ${name})`, () => `${lowerer.probe_trait_that_defines_assoc_item(did(trait_), tag, ident(name))}`);
  }

  // ---- candidates (mod.rs:1247..:1397) ----
  run("collapse_candidates_to_subtrait_pick (no supertrait_item_shadowing)", () => `${lowerer.collapse_candidates_to_subtrait_pick([])}`);
  run("probe_single_bound_for_assoc_item(no candidates)", () =>
    lowerer.probe_single_bound_for_assoc_item(() => [], AssocItemQSelf.SelfTyAlias, "Type", ident("Assoc"), DUMMY_SP, undefined).$,
  );

  // ---- type-relative paths (mod.rs:1426..:1691) ----
  run("lower_type_relative_ty_path(<u8>::Assoc)", () =>
    lowerer.lower_type_relative_ty_path(tcx.types.u8, x_ty, plain_segment("Assoc"), with_lt.hir_id(), DUMMY_SP, "No").$,
  );
  run("lower_type_relative_const_path(<u8>::C)", () => lowerer.lower_type_relative_const_path(tcx.types.u8, x_ty, plain_segment("C"), with_lt.hir_id(), DUMMY_SP).$);

  // ---- assoc item probing (mod.rs:1694..:1907) ----
  run("probe_inherent_assoc_item(S::Assoc, Type) without inherent_associated_types", () => {
    const r = lowerer.probe_inherent_assoc_item(plain_segment("Assoc"), did("S"), tcx.types.u8, with_lt.hir_id(), DUMMY_SP, "Type");
    return r.$ === "Ok" ? `Ok(${r._0 === undefined ? "None" : "Some"})` : "Err";
  });
  run("probe_assoc_item_unchecked(Assoc, Type, Tr)", () => {
    const r = lowerer.probe_assoc_item_unchecked(ident("Assoc"), "Type", did("Tr"));
    return r === undefined ? "None" : `Some(${name_of(r[0].def_id)}, ${AssocItem.tag(r[0])}, scope is crate root: ${r[1]._0.index === 0})`;
  });
  run("probe_assoc_item_unchecked(Assoc, Const, Tr)", () => `${lowerer.probe_assoc_item_unchecked(ident("Assoc"), "Const", did("Tr"))}`);
  run("probe_assoc_item_unchecked(Item, Type, m::Inner)", () => {
    const r = lowerer.probe_assoc_item_unchecked(ident("Item"), "Type", did("Inner"));
    return r === undefined ? "None" : `Some(${name_of(r[0].def_id)}, scope is crate root: ${r[1]._0.index === 0})`;
  });
  run("probe_assoc_item(C, Const, Tr)", () => {
    const r = lowerer.probe_assoc_item(ident("C"), "Const", with_lt.hir_id(), DUMMY_SP, did("Tr"));
    return r === undefined ? "None" : `Some(${name_of(r.def_id)})`;
  });
  run("probe_traits_that_match_assoc_ty(u8, Assoc)", () => lowerer.probe_traits_that_match_assoc_ty(tcx.types.u8, ident("Assoc")).join(", "));

  // ---- resolved assoc paths (mod.rs:1911..:1993) ----
  const assoc_did = tcx.associated_item_def_ids(did("Tr")).find((d) => name_of(d) === "Assoc")!;
  run("lower_resolved_assoc_ty_path(None, Tr::Assoc)", () =>
    lowerer.lower_resolved_assoc_ty_path(DUMMY_SP, undefined, assoc_did, plain_segment("Tr"), plain_segment("Assoc")).kind().$,
  );
  run("lower_resolved_assoc_ty_path(Some(u8), Tr::Assoc)", () =>
    lowerer.lower_resolved_assoc_ty_path(DUMMY_SP, tcx.types.u8, assoc_did, plain_segment("Tr"), plain_segment("Assoc")).kind().$,
  );

  // ---- prohibit_generic_args / probe_generic_path_segments (mod.rs:1995..:2185) ----
  run("prohibit_generic_args([])", () => lowerer.prohibit_generic_args([], GenericsArgsErrExtend.None).$);
  run("prohibit_generic_args([Tr])", () => lowerer.prohibit_generic_args([plain_segment("Tr")], GenericsArgsErrExtend.None).$);
  run("prohibit_generic_args([Wrap<S>])", () => lowerer.prohibit_generic_args([wrap_segment], GenericsArgsErrExtend.None).$);
  const segs = (n: number): hir.PathSegment[] => Array.from({ length: n }, (_, i) => plain_segment(`s${i}`));
  const show_segments = (v: { _0: DefId; _1: number }[]): string => `[${v.map((s) => `GenericPathSegment(${name_of(s._0)}, ${s._1})`).join(", ")}]`;
  run("probe_generic_path_segments([s0], Fn, with_lt)", () =>
    show_segments(lowerer.probe_generic_path_segments(segs(1), undefined, DefKind.Fn, did("with_lt"), DUMMY_SP)),
  );
  run("probe_generic_path_segments([s0, s1, s2], Const, with_lt)", () =>
    show_segments(lowerer.probe_generic_path_segments(segs(3), undefined, DefKind.Const, did("with_lt"), DUMMY_SP)),
  );
  run("probe_generic_path_segments([s0], AssocConst, Tr::C)", () =>
    show_segments(lowerer.probe_generic_path_segments(segs(1), undefined, DefKind.AssocConst, did("Tr"), DUMMY_SP)),
  );
  run("probe_generic_path_segments([s0, s1], AssocFn, Tr::f)", () =>
    show_segments(
      lowerer.probe_generic_path_segments(
        segs(2),
        undefined,
        DefKind.AssocFn,
        // `Tr::f` (merge-w16a: was `Tr`, whose `generics_of` has no parent, an ICE upstream too)
        (tcx.associated_item_def_ids(did("Tr")) as readonly DefId[]).find((d) => name_of(d) === "f")!,
        DUMMY_SP,
      ),
    ),
  );
  // Any `DefId` not queried by an earlier case (`generics_of(S)` is poisoned by `lower_path_segment(S)`).
  run("probe_generic_path_segments([s0], Ctor(Struct, Const), Other)", () =>
    show_segments(lowerer.probe_generic_path_segments(segs(1), undefined, { $: "Ctor", _0: "Struct", _1: "Const" }, did("Other"), DUMMY_SP)),
  );
  return lines.join("\n") + "\n";
}

async function main(args: string[]): Promise<number> {
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../../rustc_driver_impl/lib.ts");
  const { std_print } = await import("../../../rustc_session/config.ts");
  const callbacks = {
    config(): void {},
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      std_print(report(tcx));
      return "Stop" as const;
    },
  };
  return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...args], callbacks));
}

process.exitCode = await main(process.argv.slice(2));
