// Test stand-in for late.rs's `LateContextAndPass` / `late_lint_crate` (lane lint-late-e1; not a port, see run.ts).
// Mirrors upstream late.rs (the `hir_visit::Visitor` impl for `LateContextAndPass`, lines 85-320) for every visit
// method that sets lint attributes, the param env or the typeck results, or that calls a callback the lane's passes
// implement (`check_expr`, `check_local`, `check_item`, `check_trait_item`, `check_impl_item`,
// `check_foreign_item`, `check_ty`, `check_fn`). The other visit methods keep intravisit's defaults.
import type { Attribute } from "../../rustc_attr_ir/lib.ts";
import type * as hir from "../../rustc_hir/hir.ts";
import * as hir_visit from "../../rustc_hir/intravisit.ts";
import { CRATE_HIR_ID, type HirId, type OwnerId } from "../../rustc_hir_id/lib.ts";
import { TyCtxt_as_HirTyCtxt } from "../../rustc_middle/hir/map.ts";
import { All } from "../../rustc_middle/hir/nested_filter.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { ParamEnv } from "../../rustc_middle/ty/mod.ts";
import type { LocalDefId } from "../../rustc_span/def_id.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { AsyncClosureUsage } from "../async_closures.ts";
import { AsyncFnInTrait } from "../async_fn_in_trait.ts";
import { ImplicitAutorefs } from "../autorefs.ts";
import { CVoidReturns } from "../c_void_returns.ts";
import { LateContext } from "../context.ts";
import { DefaultCouldBeDerived } from "../default_could_be_derived.ts";
import { DerefIntoDynSupertrait } from "../deref_into_dyn_supertrait.ts";
import { DisallowedPassByRef } from "../disallowed_pass_by_ref.ts";
import { EnumIntrinsicsNonEnums } from "../enum_intrinsics_non_enums.ts";
import { ForLoopsOverFallibles } from "../for_loops_over_fallibles.ts";
import { FunctionCastsAsInteger } from "../function_cast_as_integer.ts";
import { ImproperGpuKernelLint } from "../gpukernel_abi.ts";
import { ImplicitProvenanceCasts } from "../implicit_provenance_casts.ts";
import { InteriorMutableConsts } from "../interior_mutable_consts.ts";
import { InvalidFromUtf8 } from "../invalid_from_utf8.ts";
import { LetUnderscore } from "../let_underscore.ts";
import { type LateLintPass, LateLintPass_provided, declare_combined_late_lint_pass } from "../passes.ts";

type L = LateLintPass;
/** `TyCtxt::typeck_body` takes ty/decls.ts's `Pending<"hir::BodyId">` stand-in. */
type PendingBodyId = Parameters<TyCtxt["typeck_body"]>[0];
function p<P>(ty: { lint_vec(): import("../../rustc_lint_defs/lib.ts").LintVec }, constructor_: () => P) {
  return { ty, constructor_ };
}

/** The lane's passes, in `BuiltinCombinedLateLintModPass` order (lib.rs). */
const LANE_E1_PASSES = {
  AsyncClosureUsage: p<L>(AsyncClosureUsage, () => new AsyncClosureUsage()),
  AsyncFnInTrait: p<L>(AsyncFnInTrait, () => new AsyncFnInTrait()),
  CVoidReturns: p<L>(CVoidReturns, () => new CVoidReturns()),
  DefaultCouldBeDerived: p<L>(DefaultCouldBeDerived, () => new DefaultCouldBeDerived()),
  DerefIntoDynSupertrait: p<L>(DerefIntoDynSupertrait, () => new DerefIntoDynSupertrait()),
  EnumIntrinsicsNonEnums: p<L>(EnumIntrinsicsNonEnums, () => new EnumIntrinsicsNonEnums()),
  ForLoopsOverFallibles: p<L>(ForLoopsOverFallibles, () => new ForLoopsOverFallibles()),
  FunctionCastsAsInteger: p<L>(FunctionCastsAsInteger, () => new FunctionCastsAsInteger()),
  ImplicitAutorefs: p<L>(ImplicitAutorefs, () => new ImplicitAutorefs()),
  ImplicitProvenanceCasts: p<L>(ImplicitProvenanceCasts, () => new ImplicitProvenanceCasts()),
  ImproperGpuKernelLint: p<L>(ImproperGpuKernelLint, () => new ImproperGpuKernelLint()),
  InteriorMutableConsts: p<L>(InteriorMutableConsts, () => new InteriorMutableConsts()),
  InvalidFromUtf8: p<L>(InvalidFromUtf8, () => new InvalidFromUtf8()),
  LetUnderscore: p<L>(LetUnderscore, () => new LetUnderscore()),
  // Internal pass (`register_internals`, `-Zunstable-options`).
  DisallowedPassByRef: p<L>(DisallowedPassByRef, () => new DisallowedPassByRef()),
};

/**
 * The combined pass of the passes named in `$RUST_TS_E1_PASSES` (comma-separated; all if unset). A test case
 * selects the pass under test so that the others' stops at context.ts's `unported` methods (`qpath_res`, ...)
 * do not end the run first.
 */
function selected_passes(): { new: () => LateLintPass } {
  const want = process.env.RUST_TS_E1_PASSES;
  const names = want === undefined || want === "" ? Object.keys(LANE_E1_PASSES) : want.split(",");
  const passes: Record<string, (typeof LANE_E1_PASSES)[keyof typeof LANE_E1_PASSES]> = {};
  for (const n of names) {
    const e = LANE_E1_PASSES[n as keyof typeof LANE_E1_PASSES];
    if (e === undefined) throw new Error(`unknown pass ${n}`);
    passes[n] = e;
  }
  return declare_combined_late_lint_pass("LaneE1Passes", passes);
}

class LateWalker extends hir_visit.Visitor {
  override NestedFilter = All;

  constructor(
    public context: LateContext,
    public pass: LateLintPass,
  ) {
    super();
  }

  with_lint_attrs(id: HirId, f: () => void): void {
    const attrs: readonly Attribute[] = this.context.tcx.hir_attrs(id);
    const prev = this.context.last_node_with_lint_attrs;
    this.context.last_node_with_lint_attrs = id;
    LateLintPass_provided.check_attributes(this.pass, this.context, attrs);
    for (const attr of attrs) LateLintPass_provided.check_attribute(this.pass, this.context, attr);
    f();
    LateLintPass_provided.check_attributes_post(this.pass, this.context, attrs);
    this.context.last_node_with_lint_attrs = prev;
  }

  with_param_env(id: OwnerId, f: () => void): void {
    const old_param_env = this.context.param_env;
    this.context.param_env = this.context.tcx.param_env(id.to_def_id()) as ParamEnv;
    f();
    this.context.param_env = old_param_env;
  }

  override maybe_tcx(): hir_visit.HirTyCtxt {
    return TyCtxt_as_HirTyCtxt(this.context.tcx);
  }

  override visit_nested_body(body_id: hir.BodyId): undefined {
    const old_enclosing_body = this.context.enclosing_body as hir.BodyId | undefined;
    this.context.enclosing_body = body_id;
    const old_typeck_results = this.context.typeck_results;
    if (old_enclosing_body === undefined || old_enclosing_body.hir_id !== body_id.hir_id) {
      const typeck_results = this.context.tcx.typeck_body(body_id as unknown as PendingBodyId);
      if (typeck_results.tainted_by_errors !== undefined) {
        this.context.enclosing_body = old_enclosing_body;
        this.context.typeck_results = old_typeck_results;
        return undefined;
      }
      this.context.typeck_results = typeck_results;
    }
    const body = this.context.tcx.hir_body(body_id);
    this.visit_body(body);
    this.context.enclosing_body = old_enclosing_body;
    this.context.typeck_results = old_typeck_results;
    return undefined;
  }

  override visit_param(param: hir.Param): undefined {
    this.with_lint_attrs(param.hir_id, () => hir_visit.walk_param(this, param));
    return undefined;
  }

  override visit_item(it: hir.Item): undefined {
    const generics = this.context.generics;
    this.context.generics = undefined;
    const old_typeck_results = this.context.typeck_results;
    this.context.typeck_results = undefined;
    const old_enclosing_body = this.context.enclosing_body;
    this.context.enclosing_body = undefined;
    this.with_lint_attrs(it.hir_id(), () => {
      this.with_param_env(it.owner_id, () => {
        LateLintPass_provided.check_item(this.pass, this.context, it);
        hir_visit.walk_item(this, it);
        LateLintPass_provided.check_item_post(this.pass, this.context, it);
      });
    });
    this.context.enclosing_body = old_enclosing_body;
    this.context.typeck_results = old_typeck_results;
    this.context.generics = generics;
    return undefined;
  }

  override visit_foreign_item(it: hir.ForeignItem): undefined {
    this.with_lint_attrs(it.hir_id(), () => {
      this.with_param_env(it.owner_id, () => {
        LateLintPass_provided.check_foreign_item(this.pass, this.context, it);
        hir_visit.walk_foreign_item(this, it);
      });
    });
    return undefined;
  }

  override visit_expr_field(field: hir.ExprField): undefined {
    this.with_lint_attrs(field.hir_id, () => hir_visit.walk_expr_field(this, field));
    return undefined;
  }

  override visit_expr(e: hir.Expr): undefined {
    this.with_lint_attrs(e.hir_id, () => {
      LateLintPass_provided.check_expr(this.pass, this.context, e);
      hir_visit.walk_expr(this, e);
      LateLintPass_provided.check_expr_post(this.pass, this.context, e);
    });
    return undefined;
  }

  override visit_stmt(s: hir.Stmt): undefined {
    this.with_lint_attrs(s.hir_id, () => LateLintPass_provided.check_stmt(this.pass, this.context, s));
    hir_visit.walk_stmt(this, s);
    return undefined;
  }

  override visit_fn(fk: hir_visit.FnKind, decl: hir.FnDecl, body_id: hir.BodyId, span: Span, id: LocalDefId): undefined {
    const old_enclosing_body = this.context.enclosing_body;
    this.context.enclosing_body = body_id;
    const old_typeck_results = this.context.typeck_results;
    const typeck_results = this.context.tcx.typeck_body(body_id as unknown as PendingBodyId);
    if (typeck_results.tainted_by_errors !== undefined) {
      this.context.enclosing_body = old_enclosing_body;
      this.context.typeck_results = old_typeck_results;
      return undefined;
    }
    this.context.typeck_results = typeck_results;
    const body = this.context.tcx.hir_body(body_id);
    LateLintPass_provided.check_fn(this.pass, this.context, fk, decl, body, span, id);
    hir_visit.walk_fn(this, fk, decl, body_id, id);
    this.context.enclosing_body = old_enclosing_body;
    this.context.typeck_results = old_typeck_results;
    return undefined;
  }

  override visit_field_def(s: hir.FieldDef): undefined {
    this.with_lint_attrs(s.hir_id, () => {
      LateLintPass_provided.check_field_def(this.pass, this.context, s);
      hir_visit.walk_field_def(this, s);
    });
    return undefined;
  }

  override visit_variant(v: hir.Variant): undefined {
    this.with_lint_attrs(v.hir_id, () => {
      LateLintPass_provided.check_variant(this.pass, this.context, v);
      hir_visit.walk_variant(this, v);
    });
    return undefined;
  }

  override visit_ty(t: hir.Ty<hir.AmbigArg>): undefined {
    LateLintPass_provided.check_ty(this.pass, this.context, t);
    hir_visit.walk_ty(this, t);
    return undefined;
  }

  override visit_mod(m: hir.Mod, _: Span, id: import("../../rustc_span/def_id.ts").LocalModId): undefined {
    LateLintPass_provided.check_mod(this.pass, this.context, m, id);
    hir_visit.walk_mod(this, m);
    return undefined;
  }

  override visit_local(l: hir.LetStmt): undefined {
    this.with_lint_attrs(l.hir_id, () => {
      LateLintPass_provided.check_local(this.pass, this.context, l);
      hir_visit.walk_local(this, l);
    });
    return undefined;
  }

  override visit_arm(a: hir.Arm): undefined {
    this.with_lint_attrs(a.hir_id, () => {
      LateLintPass_provided.check_arm(this.pass, this.context, a);
      hir_visit.walk_arm(this, a);
    });
    return undefined;
  }

  override visit_trait_item(trait_item: hir.TraitItem): undefined {
    const generics = this.context.generics;
    this.context.generics = trait_item.generics;
    this.with_lint_attrs(trait_item.hir_id(), () => {
      this.with_param_env(trait_item.owner_id, () => {
        LateLintPass_provided.check_trait_item(this.pass, this.context, trait_item);
        hir_visit.walk_trait_item(this, trait_item);
      });
    });
    this.context.generics = generics;
    return undefined;
  }

  override visit_impl_item(impl_item: hir.ImplItem): undefined {
    const generics = this.context.generics;
    this.context.generics = impl_item.generics;
    this.with_lint_attrs(impl_item.hir_id(), () => {
      this.with_param_env(impl_item.owner_id, () => {
        LateLintPass_provided.check_impl_item(this.pass, this.context, impl_item);
        hir_visit.walk_impl_item(this, impl_item);
        LateLintPass_provided.check_impl_item_post(this.pass, this.context, impl_item);
      });
    });
    this.context.generics = generics;
    return undefined;
  }
}

/** late.rs `late_lint_crate_inner` shape: `check_crate`, the top-level module walk, `check_crate_post`. */
export function run_passes(tcx: TyCtxt): void {
  const context = new LateContext(tcx, undefined, undefined, ParamEnv.empty(), tcx.effective_visibilities(null), CRATE_HIR_ID, undefined, false);
  const cx = new LateWalker(context, selected_passes().new());
  cx.with_lint_attrs(CRATE_HIR_ID, () => {
    LateLintPass_provided.check_crate(cx.pass, cx.context);
    tcx.hir_walk_toplevel_module(cx);
    LateLintPass_provided.check_crate_post(cx.pass, cx.context);
  });
}
