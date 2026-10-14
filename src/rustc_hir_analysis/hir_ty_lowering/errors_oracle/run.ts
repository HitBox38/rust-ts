// Test driver for src/rustc_hir_analysis/hir_ty_lowering/errors.oracle.test.ts (lane hir-ty-lowering-d; not a port).
//   bun run.ts <case> <rustc arguments...>
//
// Runs the ported driver; in `after_expansion` it finds the case's item in the HIR and calls the errors.rs entry point the
// way its upstream caller (cited per case) calls it, through a test `HirTyLowerer`, then stops (`Compilation::Stop`). The
// diagnostic goes through the session's emitter, and the driver prints the error count at exit, so stderr and the exit code
// must equal plain `rustc` on the same file (whose type checking emits exactly this one error).
//
// Scaffolding (none of it is a port; it stands for code of other lanes that is not ported yet):
// - `TestLowerer`: an `impl HirTyLowerer` whose `tcx` / `dcx` / `item_def_id` / `mod_id` answer as `ItemCtxt`'s do (collect.rs,
//   lane collect-a; `dcx()` without the taint tracking, which does not change the output); the other trait methods stop.
// - the callers' argument computation (lanes hir-ty-lowering-a/-b/-c): each case builds the arguments from the HIR as its
//   caller does, using only what the caller would have at hand for these inputs (e.g. `tcx.types.u8` for the HIR type `u8`).
//
// Exit codes as src/rust_ts/main.ts: rustc's own, plus 70 = reached unported code, 101 = ICE.
import type { Compiler, Config } from "../../../rustc_interface/interface.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type * as hir from "../../../rustc_hir/lib.ts";
import type { LocalDefId as LocalDefIdT } from "../../../rustc_span/def_id.ts";
import type { HirTyLowererImpl } from "../../decls.ts";
import { ensure_stack } from "../../../rust_ts/stack.ts";

interface TestCx {
  tcx: TyCtxt;
  item_def_id: LocalDefIdT;
}

async function main(args: string[]): Promise<number> {
  ensure_stack();
  const [case_name, ...rustc_args] = args;
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../../rustc_driver_impl/lib.ts");
  const { unported } = await import("../../../std/panic.ts");
  const { HirTyLowerer_provided } = await import("../mod.ts");
  const errors = await import("../errors.ts");
  const { Symbol, display_Ident } = await import("../../../rustc_span/symbol.ts");
  const { LocalDefId } = await import("../../../rustc_span/def_id.ts");
  const { display_Ty } = await import("../../../rustc_middle/ty/print/pretty.ts");

  const stop = (what: string) => (): never => unported(`errors_oracle::TestLowerer::${what} (scaffolding)`);
  const IMPL: HirTyLowererImpl<TestCx> = {
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
    re_infer: stop("re_infer"),
    ty_infer: stop("ty_infer"),
    ct_infer: stop("ct_infer"),
    register_trait_ascription_bounds: stop("register_trait_ascription_bounds"),
    probe_ty_param_bounds: stop("probe_ty_param_bounds"),
    select_inherent_assoc_candidates: stop("select_inherent_assoc_candidates"),
    lower_assoc_item_path: stop("lower_assoc_item_path"),
    lower_fn_sig: stop("lower_fn_sig"),
    probe_adt: stop("probe_adt"),
    record_ty: stop("record_ty"),
    infcx: stop("infcx"),
    dyn_compatibility_violations: stop("dyn_compatibility_violations"),
  };

  /** The free item named `name` (and its `LocalDefId`). */
  function item(tcx: TyCtxt, name: string): [hir.Item, LocalDefIdT] {
    for (const id of tcx.hir_free_items()) {
      const it = tcx.hir_item(id);
      const k = it.kind;
      const ident = k.$ === "TyAlias" ? k._0 : k.$ === "Trait" ? k.ident : undefined;
      if (ident !== undefined && display_Ident(ident) === name) return [it, it.owner_id.def_id];
    }
    throw new Error(`ERROR: no item ${name}`);
  }
  /** `type A = <ty>;`: the alias and its HIR type. */
  function alias_ty(tcx: TyCtxt): [hir.Ty, LocalDefIdT] {
    const [it, def_id] = item(tcx, "A");
    if (it.kind.$ !== "TyAlias") throw new Error("ERROR: A is not a type alias");
    return [it.kind._2, def_id];
  }

  const CASES: Record<string, (tcx: TyCtxt) => void> = {
    // `type A = u8::Foo;`: mod.rs:1674 (`lower_type_relative_path`, lane -a) calls `report_unresolved_type_relative_path(self_ty,
    // hir_self_ty, assoc_tag, segment.ident, qpath_hir_id, span, variant_def_id)` with the lowered qself, the qpath type's
    // span and no variant. Scaffolding: `probe_traits_that_match_assoc_ty` (mod.rs, lane -a) answers what upstream computes for
    // a crate without traits: none.
    e0223_prim(tcx) {
      const [ty, def_id] = alias_ty(tcx);
      if (ty.kind.$ !== "Path" || ty.kind._0.$ !== "TypeRelative") throw new Error("ERROR: not a type-relative path");
      const lowerer = HirTyLowerer_provided.lowerer<TestCx>({ tcx, item_def_id: def_id }, IMPL);
      Object.defineProperty(lowerer, "probe_traits_that_match_assoc_ty", { value: () => [] });
      lowerer.report_unresolved_type_relative_path(tcx.types.u8, ty.kind._0._0, "Type", ty.kind._0._1.ident, ty.hir_id, ty.span, undefined);
    },
    // `type A = u8<..>;` (`Res::PrimTy`): mod.rs:2298 (`lower_resolved_ty_path`, lane -b) calls
    // `prohibit_generic_args(path.segments.iter(), GenericsArgsErrExtend::PrimTy(prim_ty))`.
    e0109_prim(tcx) {
      prim_ty_case(tcx);
    },
    e0109_kinds(tcx) {
      prim_ty_case(tcx);
    },
    e0109_lifetime(tcx) {
      prim_ty_case(tcx);
    },
    e0229_prim(tcx) {
      prim_ty_case(tcx);
    },
    e0109_e0229_prim(tcx) {
      prim_ty_case(tcx);
    },
    // `type A<T> = T<u8>;` (`Res::Def(DefKind::TyParam, def_id)`): mod.rs:2249 calls
    // `prohibit_generic_args(path.segments.iter(), GenericsArgsErrExtend::Param(def_id))`.
    e0109_param(tcx) {
      const [ty, def_id] = alias_ty(tcx);
      if (ty.kind.$ !== "Path" || ty.kind._0.$ !== "Resolved") throw new Error("ERROR: not a resolved path");
      const path = ty.kind._0._1;
      if (path.res.$ !== "Def" || path.res._0.$ !== "TyParam") throw new Error("ERROR: not a type parameter");
      const lowerer = HirTyLowerer_provided.lowerer<TestCx>({ tcx, item_def_id: def_id }, IMPL);
      prohibit_generic_args(lowerer, path.segments, { $: "Param", _0: path.res._1 });
    },
    // `type A = dyn Tr..;` with `trait Tr<.., T = Self, ..>`: dyn_trait.rs:381 (`lower_trait_object_ty`, lane -c) calls
    // `report_missing_generic_params(missing_generic_params, trait_ref.def_id, span, empty_generic_args)` with the
    // `(name, kind)` of each own type parameter whose default mentions `Self` (here every type parameter with a `Self`
    // default; `generics_of` is lane collect-a's, so they are read off the HIR) and `empty_generic_args` true (the bound
    // names the trait and contains `span`).
    e0393(tcx) {
      missing_generic_params_case(tcx);
    },
    e0393_args(tcx) {
      missing_generic_params_case(tcx);
    },
  };

  /**
   * mod.rs:1995 `prohibit_generic_args` (lane hir-ty-lowering-a), transcribed as scaffolding: report the args of all segments
   * (if any), then the first constraint of any segment.
   */
  function prohibit_generic_args(
    lowerer: import("../../decls.ts").HirTyLowerer,
    segments: readonly hir.PathSegment[],
    err_extend: import("../errors.ts").GenericsArgsErrExtend,
  ): void {
    const args_visitors = segments.flatMap((segment) => segment.args_().args);
    if (args_visitors.length !== 0) {
      lowerer.report_prohibited_generic_args(segments, args_visitors, err_extend);
    }
    for (const segment of segments) {
      // Only emit the first error to avoid overloading the user with error messages.
      const c = segment.args_().constraints[0];
      if (c !== undefined) {
        errors.prohibit_assoc_item_constraint(lowerer, c, undefined);
        return;
      }
    }
  }

  function prim_ty_case(tcx: TyCtxt): void {
    const [ty, def_id] = alias_ty(tcx);
    if (ty.kind.$ !== "Path" || ty.kind._0.$ !== "Resolved") throw new Error("ERROR: not a resolved path");
    const path = ty.kind._0._1;
    if (path.res.$ !== "PrimTy") throw new Error("ERROR: not a primitive type");
    const lowerer = HirTyLowerer_provided.lowerer<TestCx>({ tcx, item_def_id: def_id }, IMPL);
    prohibit_generic_args(lowerer, path.segments, { $: "PrimTy", _0: path.res._0 });
  }

  function missing_generic_params_case(tcx: TyCtxt): void {
    const [ty, def_id] = alias_ty(tcx);
    const [tr, tr_def_id] = item(tcx, "Tr");
    if (ty.kind.$ !== "TraitObject" || tr.kind.$ !== "Trait") throw new Error("ERROR: not `dyn Tr`");
    const bound = ty.kind._0[0]!;
    const missing: [import("../../../rustc_span/symbol.ts").Symbol, import("../../../rustc_middle/ty/generics.ts").GenericParamDefKind][] = [];
    for (const p of tr.kind.generics.params) {
      if (p.kind.$ === "Type" && p.kind.default !== undefined) {
        const d = p.kind.default;
        if (d.kind.$ === "Path" && d.kind._0.$ === "Resolved" && d.kind._0._1.res.$ === "SelfTyParam") {
          const name = p.name.$ === "Plain" ? p.name._0.name : Symbol.intern("?");
          missing.push([name, { $: "Type", has_default: true, synthetic: false }]);
        }
      }
    }
    const lowerer = HirTyLowerer_provided.lowerer<TestCx>({ tcx, item_def_id: def_id }, IMPL);
    lowerer.report_missing_generic_params(missing, LocalDefId.to_def_id(tr_def_id), bound.span, true);
  }

  const run_case = CASES[case_name ?? ""];
  if (run_case === undefined) {
    console.error(`ERROR: unknown case ${case_name}`);
    return 2;
  }
  // (`display_Ty` is used by the cases' callees; imported here so a load error shows up before the driver runs.)
  void display_Ty;
  const callbacks = {
    config(_config: Config): void {},
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      run_case(tcx);
      return "Stop";
    },
  };
  return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...rustc_args], callbacks));
}

process.exitCode = await main(process.argv.slice(2));
