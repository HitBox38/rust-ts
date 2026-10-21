// Port of compiler/rustc_hir_typeck/src/fallback.rs (lane typeck-lib-wb).
//
// - `UnsafeUseReason` is generated (fallback.gen.ts); `AnnotateUnitFallbackVisitor` (hand class, types.sets.json `hand`)
//   and the fn-local `UnsafeInferVarsVisitor` / `InferVarCollector` of `compute_unsafe_infer_vars` are classes.
// - `UnordSet<V>` / `FxHashSet<V>` / `UnordMap<K, V>` are `Set` / `Map` (PORTING §5); `VecGraph<TyVid, true>` is
//   `VecGraph<TyVid>` built with back references (`VecGraph.new(.., true)`).
// - `debug!` is tracing only and stays as a comment.
// Init order: top-level code here touches only ./decls.ts, this file's .gen.ts and other crates.
export * from "./fallback.gen.ts";
import { ControlFlow, VisitorResult as VisitorResultC, type VisitorResult } from "../rustc_ast_ir/visit.ts";
import { depth_first_search_as_undirected } from "../rustc_data_structures/graph/mod.ts";
import { VecGraph } from "../rustc_data_structures/graph/vec_graph/mod.ts";
import { Res } from "../rustc_hir/def.ts";
import * as hir from "../rustc_hir/lib.ts";
import type { InferKind } from "../rustc_hir/intravisit.ts";
import { CRATE_HIR_ID, type HirId } from "../rustc_hir_id/lib.ts";
import { FLOAT_LITERAL_F32_FALLBACK, NEVER_TYPE_FALLBACK_FLOWING_INTO_UNSAFE } from "../rustc_lint_defs/builtin.gen.ts";
import { GenericArg } from "../rustc_middle/ty/generic_args.ts";
import type { Generics } from "../rustc_middle/ty/generics.ts";
import type { Clauses } from "../rustc_middle/ty/list.ts";
import { Ty } from "../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import type { DefId, LocalDefId } from "../rustc_span/def_id.ts";
import { DUMMY_SP, type ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import { Binder, EarlyBinder } from "../rustc_type_ir/binder.ts";
import type { FloatVid, IntVid, TyVid } from "../rustc_type_ir/decls.ts";
import type { PredicateProxy } from "../rustc_type_ir/fold.ts";
import type { Const } from "../rustc_type_ir/sty/consts.ts";
import type { Region } from "../rustc_type_ir/sty/mod.ts";
import { PolyFnSig } from "../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { type TypeVisitable, type TypeVisitor, TypeVisitor_provided } from "../rustc_type_ir/visit.ts";
import { Safety } from "../rustc_hir/lib.ts";
import { type PredicateKind, visit_with_PredicateKind } from "../rustc_type_ir/predicate_kind.gen.ts";
import { panic } from "../std/panic.ts";
import { FnCtxt } from "./decls.ts";
import {
  FloatLiteralF32Fallback_diagnostic,
  NeverTypeFallbackFlowingIntoUnsafe_diagnostic,
  type SuggestAnnotation,
  type SuggestAnnotations,
  clone_SuggestAnnotations,
} from "./diagnostics.gen.ts";
import type { UnsafeUseReason } from "./fallback.gen.ts";

// impl<'tcx> FnCtxt<'_, 'tcx> {
/// Performs type inference fallback, setting [`FnCtxt::diverging_fallback_has_occurred`]
/// if the never type fallback has occurred.
// rustc: compiler/rustc_hir_typeck/src/fallback.rs:25 type_inference_fallback
FnCtxt.prototype.type_inference_fallback = function (this: FnCtxt): void {
  // debug!(
  //     "type-inference-fallback start obligations: {:#?}",
  //     self.fulfillment_cx.borrow_mut().pending_obligations()
  // );

  // All type checking constraints were added, try to fallback unsolved variables.
  this.select_obligations_where_possible((_) => {});

  // debug!(
  //     "type-inference-fallback post selection obligations: {:#?}",
  //     self.fulfillment_cx.borrow_mut().pending_obligations()
  // );

  const fallback_occurred = this.fallback_types();

  if (fallback_occurred) {
    // if fallback occurred, previously stalled goals may make progress again
    this.select_obligations_where_possible((_) => {});
  }
};

/// Tries to apply a fallback to all unresolved variables.
///
/// - Unconstrained ints are replaced with `i32`.
///
/// - Unconstrained floats are replaced with `f64`, except when there is a trait predicate
///   `f32: From<{float}>`, in which case `f32` is used as the fallback instead and a
///   [`FLOAT_LITERAL_F32_FALLBACK`] FCW is emitted.
///
/// - Non-numerics may get replaced with `()` or `!`, depending on how they
///   were categorized by [`Self::calculate_diverging_fallback`], crate's
///   edition, and the setting of `#![rustc_never_type_options(fallback = ...)]`.
///
/// Fallback becomes very dubious if we have encountered type-checking errors.
/// In that case, all variables fallback to Error.
///
/// Sets [`FnCtxt::diverging_fallback_has_occurred`] if never type fallback
/// is performed during this call.
///
/// Returns `true` if *any* kind of fallback has occurred during this call.
// rustc: compiler/rustc_hir_typeck/src/fallback.rs:66 fallback_types
FnCtxt.prototype.fallback_types = function (this: FnCtxt): boolean {
  const [unresolved_ty, unresolved_int, unresolved_float] = this.unresolved_root_variables();

  // Check if we have any unresolved variables. If not, no need for fallback.
  if (unresolved_ty.length === 0 && unresolved_int.length === 0 && unresolved_float.length === 0) {
    return false;
  }

  // If tainted by errors, fallback all unresolved variables to error type,
  // in order to prevent unnecessary diagnostics.
  const guar = this.tainted_by_errors();
  if (guar !== undefined) {
    this.fallback_types_to_error(guar, unresolved_ty, unresolved_int, unresolved_float);
    return true;
  }

  const diverging_fallback = this.calculate_diverging_fallback();
  const fallback_to_f32 = this.calculate_fallback_to_f32(unresolved_float);

  // All unresolved int and float variables always use fallback,
  // whereas unresolved type variables might not use fallback.
  let fallback_occurred = !(unresolved_int.length === 0) || !(unresolved_float.length === 0);

  for (const vid of unresolved_ty.filter((vid) => diverging_fallback.has(vid))) {
    const span = this.type_var_origin(vid).span;
    this.demand_eqtype(span, Ty.new_var(this.tcx, vid), this.tcx.types.never);

    this.diverging_fallback_has_occurred = true;
    fallback_occurred = true;
  }

  for (const vid of unresolved_int) {
    this.demand_eqtype(DUMMY_SP, Ty.new_int_var(this.tcx, vid), this.tcx.types.i32);
  }

  for (const vid of unresolved_float) {
    const fallback = fallback_to_f32.has(vid) ? this.tcx.types.f32 : this.tcx.types.f64;
    const span = this.float_var_origin(vid).span;
    this.demand_eqtype(span, Ty.new_float_var(this.tcx, vid), fallback);
  }

  return fallback_occurred;
};

// rustc: compiler/rustc_hir_typeck/src/fallback.rs:113 fallback_types_to_error
FnCtxt.prototype.fallback_types_to_error = function (
  this: FnCtxt,
  guar: ErrorGuaranteed,
  unresolved_ty: TyVid[],
  unresolved_int: IntVid[],
  unresolved_float: FloatVid[],
): void {
  const vars = [
    ...unresolved_ty.map((vid) => Ty.new_var(this.tcx, vid)),
    ...unresolved_int.map((vid) => Ty.new_int_var(this.tcx, vid)),
    ...unresolved_float.map((vid) => Ty.new_float_var(this.tcx, vid)),
  ];

  const error = Ty.new_error(this.tcx, guar);

  for (const var_ of vars) {
    this.demand_eqtype(DUMMY_SP, var_, error);
  }
};

/// Existing code relies on `f32: From<T>` (usually written as `T: Into<f32>`) resolving `T` to
/// `f32` when the type of `T` is inferred from an unsuffixed float literal. Using the default
/// fallback of `f64`, this would break when adding `impl From<f16> for f32`, as there are now
/// two float type which could be `T`, meaning that the fallback of `f64` would be used and
/// compilation error would occur as `f32` does not implement `From<f64>`. To avoid breaking
/// existing code, we instead fallback `T` to `f32` when there is a trait predicate
/// `f32: From<T>`. This means code like the following will continue to compile:
///
/// ```rust
/// fn foo<T: Into<f32>>(_: T) {}
///
/// foo(1.0);
/// ```
// rustc: compiler/rustc_hir_typeck/src/fallback.rs:146 calculate_fallback_to_f32
FnCtxt.prototype.calculate_fallback_to_f32 = function (this: FnCtxt, unresolved_root_variables: readonly FloatVid[]): Set<FloatVid> {
  // Short-circuit: if no unresolved variable is a float, no f32 fallback can apply,
  // so we can skip the (potentially very expensive) work in `from_float_for_f32_root_vids`.
  // Under the new solver, that function walks `visit_proof_tree` for every pending
  // obligation, which is O(N × proof_tree_size) and can dominate type-checking on crates
  // with many large pending obligations and no f32 involvement.
  if (unresolved_root_variables.length === 0) {
    return new Set();
  }

  const roots: Set<FloatVid> = this.from_float_for_f32_root_vids();
  if (roots.size === 0) {
    // Most functions have no `f32: From<{float}>` predicates, so short-circuit and return
    // an empty set when this is the case.
    return new Set();
  }
  // Calculate all the unresolved variables that need to fallback to `f32` here. This ensures
  // we don't need to find root variables in `fallback_if_possible`: see the comment at the
  // top of that function for details.
  const fallback_to_f32 = new Set<FloatVid>();
  for (const vid of unresolved_root_variables) {
    if (!roots.has(vid)) continue;
    const origin = this.float_var_origin(vid);
    // Show the entire literal in the suggestion to make it clearer.
    const snippet = this.tcx.sess.source_map().span_to_snippet(origin.span);
    let literal: string | undefined = snippet.$ === "Ok" ? snippet._0.toString() : undefined;
    // A `.` at the end of the literal is no longer necessary if `f32` is explicitly specified
    if (literal !== undefined && literal.endsWith(".")) {
      literal = literal.slice(0, -1);
    }
    this.tcx.emit_node_span_lint(
      FLOAT_LITERAL_F32_FALLBACK,
      origin.lint_id ?? CRATE_HIR_ID,
      origin.span,
      FloatLiteralF32Fallback_diagnostic({
        span: literal !== undefined ? origin.span : undefined,
        literal: literal ?? "",
      }),
    );
    fallback_to_f32.add(vid);
  }
  // debug!("calculate_fallback_to_f32: fallback_to_f32={:?}", fallback_to_f32);
  return fallback_to_f32;
};

// rustc: compiler/rustc_hir_typeck/src/fallback.rs:197 calculate_diverging_fallback
FnCtxt.prototype.calculate_diverging_fallback = function (this: FnCtxt): Set<TyVid> {
  // Compute the diverging root vids D -- that is, the root vid of
  // those type variables that (a) are the target of a coercion from
  // a `!` type and (b) have not yet been solved.
  //
  // These variables are the ones that are targets for fallback to `!`.
  const diverging_root_vids: TyVid[] = [];
  for (const vid of this.diverging_type_vars) {
    const r = this.infcx.shallow_resolve_ty_var_or_get_root(vid);
    if (r.$ === "Err") diverging_root_vids.push(r._0);
  }

  {
    if (!(diverging_root_vids.length === 0)) {
      // Construct a coercion graph where an edge `A -> B` indicates
      // a type variable is that is coerced
      const coercion_graph = this.create_coercion_graph();

      const unsafe_infer_vars = compute_unsafe_infer_vars(this, this.body_def_id);

      for (const root_vid of diverging_root_vids) {
        this.lint_never_type_fallback_flowing_into_unsafe_code(unsafe_infer_vars, coercion_graph, root_vid);
      }
    }
  }

  return new Set(diverging_root_vids);
};

// rustc: compiler/rustc_hir_typeck/src/fallback.rs:231 lint_never_type_fallback_flowing_into_unsafe_code
FnCtxt.prototype.lint_never_type_fallback_flowing_into_unsafe_code = function (
  this: FnCtxt,
  unsafe_infer_vars: Map<TyVid, [HirId, Span, UnsafeUseReason]>,
  coercion_graph: VecGraph<TyVid>,
  root_vid: TyVid,
): void {
  const affected_unsafe_infer_vars: [HirId, Span, UnsafeUseReason][] = [];
  for (const x of depth_first_search_as_undirected(coercion_graph, root_vid)) {
    const v = unsafe_infer_vars.get(x);
    if (v !== undefined) affected_unsafe_infer_vars.push(v);
  }

  const sugg = this.try_to_suggest_annotations([root_vid], coercion_graph);

  for (const [hir_id, span, reason] of affected_unsafe_infer_vars) {
    this.tcx.emit_node_span_lint(
      NEVER_TYPE_FALLBACK_FLOWING_INTO_UNSAFE,
      hir_id,
      span,
      NeverTypeFallbackFlowingIntoUnsafe_diagnostic({ $: reason, sugg: clone_SuggestAnnotations(sugg) }),
    );
  }
};

/// Returns a graph whose nodes are (unresolved) inference variables and where
/// an edge `?A -> ?B` indicates that the variable `?A` is coerced to `?B`.
// rustc: compiler/rustc_hir_typeck/src/fallback.rs:278 create_coercion_graph
FnCtxt.prototype.create_coercion_graph = function (this: FnCtxt): VecGraph<TyVid> {
  const pending_obligations = this.fulfillment_cx.pending_obligations();
  // debug!("create_coercion_graph: pending_obligations={:?}", pending_obligations);
  const coercion_edges: [TyVid, TyVid][] = [];
  for (const obligation of pending_obligations) {
    // The predicates we are looking for look like `Coerce(?A -> ?B)`.
    // They will have no bound variables.
    const atom = Binder.no_bound_vars(obligation.predicate.kind(), d_PredicateKind);
    if (atom === undefined) continue;
    // We consider both subtyping and coercion to imply 'flow' from
    // some position in the code `a` to a different position `b`.
    // This is then used to determine which variables interact with
    // live code, and as such must fall back to `()` to preserve
    // soundness.
    //
    // In practice currently the two ways that this happens is
    // coercion and subtyping.
    let a: Ty;
    let b: Ty;
    if (atom.$ === "Coerce") {
      ({ a, b } = atom._0);
    } else if (atom.$ === "Subtype") {
      ({ a, b } = atom._0);
    } else {
      continue;
    }

    const a_vid = this.root_vid(a);
    if (a_vid === undefined) continue;
    const b_vid = this.root_vid(b);
    if (b_vid === undefined) continue;
    coercion_edges.push([a_vid, b_vid]);
  }
  // debug!("create_coercion_graph: coercion_edges={:?}", coercion_edges);
  const num_ty_vars = this.num_ty_vars();

  return VecGraph.new(num_ty_vars, coercion_edges, true);
};

/// If `ty` is an unresolved type variable, returns its root vid.
// rustc: compiler/rustc_hir_typeck/src/fallback.rs:317 root_vid
FnCtxt.prototype.root_vid = function (this: FnCtxt, ty: Ty): TyVid | undefined {
  const vid = this.shallow_resolve(ty).ty_vid();
  if (vid === undefined) return undefined;
  return this.root_var(vid);
};

/// If `ty` is an unresolved float type variable, returns its root vid.
// rustc: compiler/rustc_hir_typeck/src/fallback.rs:322 root_float_vid
FnCtxt.prototype.root_float_vid = function (this: FnCtxt, ty: Ty): FloatVid | undefined {
  const vid = this.shallow_resolve(ty).float_vid();
  if (vid === undefined) return undefined;
  return this.root_float_var(vid);
};

/// Given a set of diverging vids and coercions, walk the HIR to gather a
/// set of suggestions which can be applied to preserve fallback to unit.
// rustc: compiler/rustc_hir_typeck/src/fallback.rs:328 try_to_suggest_annotations
FnCtxt.prototype.try_to_suggest_annotations = function (this: FnCtxt, diverging_vids: readonly TyVid[], coercions: VecGraph<TyVid>): SuggestAnnotations {
  const body = this.tcx.hir_body_owned_by(this.body_def_id);
  // For each diverging var, look through the HIR for a place to give it
  // a type annotation. We do this per var because we only really need one
  // suggestion to influence a var to be `()`.
  const suggestions: SuggestAnnotation[] = [];
  for (const vid of diverging_vids) {
    const reachable_vids = new Set<TyVid>(depth_first_search_as_undirected(coercions, vid));
    const r = new AnnotateUnitFallbackVisitor(reachable_vids, this).visit_expr(body.value);
    if (r.$ === "Break") suggestions.push(r._0);
  }
  return { suggestions };
};

// rustc-type: compiler/rustc_hir_typeck/src/fallback.rs:355 AnnotateUnitFallbackVisitor
/// Try to walk the HIR to find a place to insert a useful suggestion
/// to preserve fallback to `()` in 2024.
// PORT: hand class (types.sets.json `hand`).
export class AnnotateUnitFallbackVisitor extends hir.intravisit.Visitor<ControlFlow<SuggestAnnotation>> {
  // impl<'tcx> Visitor<'tcx> for AnnotateUnitFallbackVisitor<'_, 'tcx>
  // type Result = ControlFlow<diagnostics::SuggestAnnotation>;
  override Result: VisitorResult<ControlFlow<SuggestAnnotation>, unknown> = VisitorResultC.ControlFlow<SuggestAnnotation>();

  constructor(
    public reachable_vids: Set<TyVid>,
    public fcx: FnCtxt,
  ) {
    super();
  }

  // impl<'tcx> AnnotateUnitFallbackVisitor<'_, 'tcx> {
  // For a given path segment, if it's missing a turbofish, try to suggest adding
  // one so we can constrain an argument to `()`. To keep the suggestion simple,
  // we want to simply suggest `_` for all the other args. This (for now) only
  // works when there are only type variables (and region variables, since we can
  // elide them)...
  // rustc: compiler/rustc_hir_typeck/src/fallback.rs:364 suggest_for_segment
  suggest_for_segment(arg_segment: hir.PathSegment, def_id: DefId, id: HirId): ControlFlow<SuggestAnnotation> {
    const all_args = arg_segment.args === undefined ? this.fcx.typeck_results.node_args_opt(id) : undefined;
    if (all_args !== undefined) {
      const generics = this.fcx.tcx.generics_of(def_id) as Generics;
      const rest = all_args.slice(generics.parent_count);
      const args: [GenericArg, (typeof generics.own_params)[number]][] = [];
      for (let i = 0; i < Math.min(rest.length, generics.own_params.length); i++) args.push([rest[i]!, generics.own_params[i]!]);
      // We can't turbofish consts :(
      if (args.every(([, param]) => param.kind.$ === "Type" || param.kind.$ === "Lifetime")) {
        // We filter out APITs, which are not turbofished.
        const non_apit_type_args = args.filter(([, param]) => param.kind.$ === "Type" && param.kind.synthetic === false);
        const n_tys = non_apit_type_args.length;
        for (let idx = 0; idx < non_apit_type_args.length; idx++) {
          const [arg] = non_apit_type_args[idx]!;
          const ty = GenericArg.as_type(arg);
          const vid = ty !== undefined ? this.fcx.root_vid(ty) : undefined;
          if (vid !== undefined && this.reachable_vids.has(vid)) {
            return ControlFlow.Break({ $: "Turbo", _0: Span.shrink_to_hi(arg_segment.ident.span), _1: n_tys, _2: idx });
          }
        }
      }
    }
    return ControlFlow.CONTINUE;
  }

  // rustc: compiler/rustc_hir_typeck/src/fallback.rs:401 visit_infer
  override visit_infer(inf_id: HirId, inf_span: Span, _kind: InferKind): ControlFlow<SuggestAnnotation> {
    // Try to replace `_` with `()`.
    const ty = this.fcx.typeck_results.node_type_opt(inf_id);
    const vid = ty !== undefined ? this.fcx.root_vid(ty) : undefined;
    if (vid !== undefined && this.reachable_vids.has(vid) && Span.can_be_used_for_suggestions(inf_span)) {
      return ControlFlow.Break({ $: "Unit", _0: inf_span });
    }

    return ControlFlow.CONTINUE;
  }

  // rustc: compiler/rustc_hir_typeck/src/fallback.rs:419 visit_qpath
  override visit_qpath(qpath: hir.QPath, id: HirId, span: Span): ControlFlow<SuggestAnnotation> {
    let arg_segment: hir.PathSegment;
    switch (qpath.$) {
      case "Resolved": {
        const path = qpath._1;
        arg_segment = path.segments[path.segments.length - 1] ?? panic("paths should have a segment");
        break;
      }
      case "TypeRelative":
        arg_segment = qpath._1;
        break;
    }
    // Alternatively, try to turbofish `::<_, (), _>`.
    const def_id = Res.opt_def_id(this.fcx.typeck_results.qpath_res(qpath, id));
    if (def_id !== undefined && Span.can_be_used_for_suggestions(span)) {
      const r = this.suggest_for_segment(arg_segment, def_id, id);
      if (r.$ === "Break") return r;
    }
    return hir.intravisit.walk_qpath(this, qpath, id);
  }

  // rustc: compiler/rustc_hir_typeck/src/fallback.rs:440 visit_expr
  override visit_expr(expr: hir.Expr): ControlFlow<SuggestAnnotation> {
    if (expr.kind.$ === "Closure" || expr.kind.$ === "ConstBlock") {
      const body = expr.kind._0.body;
      const r = this.visit_body(this.fcx.tcx.hir_body(body));
      if (r.$ === "Break") return r;
    }

    // Try to suggest adding an explicit qself `()` to a trait method path.
    // i.e. changing `Default::default()` to `<() as Default>::default()`.
    if (expr.kind.$ === "Path" && expr.kind._0.$ === "Resolved" && expr.kind._0._0 === undefined) {
      const path = expr.kind._0._1;
      const res = path.res;
      if (res.$ === "Def" && res._0.$ === "AssocFn") {
        const def_id = res._1;
        if (this.fcx.tcx.trait_of_assoc(def_id) !== undefined) {
          const args = this.fcx.typeck_results.node_args_opt(expr.hir_id);
          if (args !== undefined) {
            const self_ty = args.type_at(0);
            const vid = this.fcx.root_vid(self_ty);
            if (vid !== undefined && this.reachable_vids.has(vid) && path.segments.length >= 2 && Span.can_be_used_for_suggestions(expr.span)) {
              const trait_segment = path.segments[path.segments.length - 2]!;
              const span = Span.to(Span.shrink_to_lo(path.span), trait_segment.ident.span);
              return ControlFlow.Break({ $: "Path", _0: span });
            }
          }
        }
      }
    }

    // Or else, try suggesting turbofishing the method args.
    if (expr.kind.$ === "MethodCall") {
      const segment = expr.kind._0;
      const def_id = this.fcx.typeck_results.type_dependent_def_id(expr.hir_id);
      if (def_id !== undefined && Span.can_be_used_for_suggestions(expr.span)) {
        const r = this.suggest_for_segment(segment, def_id, expr.hir_id);
        if (r.$ === "Break") return r;
      }
    }

    return hir.intravisit.walk_expr(this, expr);
  }

  // rustc: compiler/rustc_hir_typeck/src/fallback.rs:475 visit_local
  override visit_local(local: hir.LetStmt): ControlFlow<SuggestAnnotation> {
    // For a local, try suggest annotating the type if it's missing.
    if (local.source === "Normal" && local.ty === undefined) {
      const ty = this.fcx.typeck_results.node_type_opt(local.hir_id);
      const vid = ty !== undefined ? this.fcx.root_vid(ty) : undefined;
      if (vid !== undefined && this.reachable_vids.has(vid) && Span.can_be_used_for_suggestions(local.span)) {
        return ControlFlow.Break({ $: "Local", _0: Span.shrink_to_hi(local.pat.span) });
      }
    }
    return hir.intravisit.walk_local(this, local);
  }
}

/// Finds all type variables which are passed to an `unsafe` operation.
///
/// For example, for this function `f`:
/// ```ignore (demonstrative)
/// fn f() {
///     unsafe {
///         let x /* ?X */ = core::mem::zeroed();
///         //               ^^^^^^^^^^^^^^^^^^^ -- hir_id, span, reason
///
///         let y = core::mem::zeroed::<Option<_ /* ?Y */>>();
///         //      ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ -- hir_id, span, reason
///     }
/// }
/// ```
///
/// `compute_unsafe_infer_vars` will return `{ id(?X) -> (hir_id, span, Call) }`
// rustc: compiler/rustc_hir_typeck/src/fallback.rs:517 compute_unsafe_infer_vars
export function compute_unsafe_infer_vars(fcx: FnCtxt, body_def_id: LocalDefId): Map<TyVid, [HirId, Span, UnsafeUseReason]> {
  const body = fcx.tcx.hir_body_owned_by(body_def_id);
  const res = new Map<TyVid, [HirId, Span, UnsafeUseReason]>();

  new UnsafeInferVarsVisitor(fcx, res).visit_expr(body.value);

  // debug!(?res, "collected the following unsafe vars for {body_def_id:?}");

  return res;
}

// PORT: the fn-local `struct UnsafeInferVarsVisitor` of `compute_unsafe_infer_vars`, with its `Visitor` impl.
class UnsafeInferVarsVisitor extends hir.intravisit.Visitor {
  constructor(
    public fcx: FnCtxt,
    public res: Map<TyVid, [HirId, Span, UnsafeUseReason]>,
  ) {
    super();
  }

  // rustc: compiler/rustc_hir_typeck/src/fallback.rs:530 visit_expr
  override visit_expr(ex: hir.Expr): undefined {
    const typeck_results = this.fcx.typeck_results;

    switch (ex.kind.$) {
      case "MethodCall": {
        const def_id = typeck_results.type_dependent_def_id(ex.hir_id);
        if (def_id !== undefined) {
          const method_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.fcx.tcx.type_of(def_id) as EarlyBinder<Ty>));
          const sig = method_ty.fn_sig(this.fcx.tcx);
          if (Safety.is_unsafe(PolyFnSig.safety(sig))) {
            const collector = new InferVarCollector<[HirId, Span, UnsafeUseReason]>([ex.hir_id, ex.span, "Method"], this.res);

            // Collect generic arguments (incl. `Self`) of the method
            for (const t of typeck_results.node_args(ex.hir_id).types()) fold_Ty.visit_with(t, collector);
          }
        }
        break;
      }

      case "Call": {
        const func = ex.kind._0;
        const func_ty = typeck_results.expr_ty(func);

        if (func_ty.is_fn()) {
          const sig = func_ty.fn_sig(this.fcx.tcx);
          if (Safety.is_unsafe(PolyFnSig.safety(sig))) {
            const collector = new InferVarCollector<[HirId, Span, UnsafeUseReason]>([ex.hir_id, ex.span, "Call"], this.res);

            // Try collecting generic arguments of the function.
            // Note that we do this below for any paths (that don't have to be called),
            // but there we do it with a different span/reason.
            // This takes priority.
            for (const t of typeck_results.node_args(func.hir_id).types()) fold_Ty.visit_with(t, collector);

            // Also check the return type, for cases like `returns_unsafe_fn_ptr()()`
            collector.visit_binder(PolyFnSig.output(sig), fold_Ty);
          }
        }
        break;
      }

      // Check paths which refer to functions.
      // We do this, instead of only checking `Call` to make sure the lint can't be
      // avoided by storing unsafe function in a variable.
      case "Path": {
        const ty = typeck_results.expr_ty(ex);

        // If this path refers to an unsafe function, collect inference variables which may affect it.
        // `is_fn` excludes closures, but those can't be unsafe.
        if (ty.is_fn()) {
          const sig = ty.fn_sig(this.fcx.tcx);
          if (Safety.is_unsafe(PolyFnSig.safety(sig))) {
            const collector = new InferVarCollector<[HirId, Span, UnsafeUseReason]>([ex.hir_id, ex.span, "Path"], this.res);

            // Collect generic arguments of the function
            for (const t of typeck_results.node_args(ex.hir_id).types()) fold_Ty.visit_with(t, collector);
          }
        }
        break;
      }

      case "Unary": {
        if (ex.kind._0 === "Deref") {
          const pointer = ex.kind._1;
          const k = typeck_results.expr_ty(pointer).kind();
          if (k.$ === "RawPtr") {
            const pointee = k._0;
            fold_Ty.visit_with(pointee, new InferVarCollector<[HirId, Span, UnsafeUseReason]>([ex.hir_id, ex.span, "Deref"], this.res));
          }
        }
        break;
      }

      case "Field": {
        const base = ex.kind._0;
        const base_ty = typeck_results.expr_ty(base);

        if (base_ty.is_union()) {
          fold_Ty.visit_with(typeck_results.expr_ty(ex), new InferVarCollector<[HirId, Span, UnsafeUseReason]>([ex.hir_id, ex.span, "UnionField"], this.res));
        }
        break;
      }

      default:
        break;
    }

    hir.intravisit.walk_expr(this, ex);
    return undefined;
  }
}

// PORT: the fn-local `struct InferVarCollector<'r, V>` of `compute_unsafe_infer_vars`, with its `TypeVisitor` impl
// (`type Result = ()`).
class InferVarCollector<V> implements TypeVisitor<undefined> {
  readonly Result: VisitorResult<undefined, unknown> = VisitorResultC.unit;

  constructor(
    public value: V,
    public res: Map<TyVid, V>,
  ) {}

  // rustc: compiler/rustc_hir_typeck/src/fallback.rs:638 visit_ty
  visit_ty(t: Ty): undefined {
    const vid = t.ty_vid();
    if (vid !== undefined) {
      // `_ = self.res.try_insert(vid, self.value)`
      if (!this.res.has(vid)) this.res.set(vid, this.value);
    } else {
      fold_Ty.super_visit_with(t, this);
    }
    return undefined;
  }

  // (provided) the `TypeVisitor` methods `InferVarCollector` does not override.
  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): undefined {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }
  visit_region(r: Region): undefined {
    return TypeVisitor_provided.visit_region(this, r);
  }
  visit_const(c: Const): undefined {
    return TypeVisitor_provided.visit_const(this, c);
  }
  visit_predicate<P>(p: P, d: PredicateProxy<P>): undefined {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }
  visit_clauses(c: Clauses): undefined {
    return TypeVisitor_provided.visit_clauses(this, c);
  }
  visit_error(guar: ErrorGuaranteed): undefined {
    return TypeVisitor_provided.visit_error(this, guar);
  }
}

/** `TypeVisitable for PredicateKind` (derived). */
const d_PredicateKind: TypeVisitable<PredicateKind> = { visit_with: visit_with_PredicateKind };
