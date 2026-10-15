// Port of compiler/rustc_hir_typeck/src/writeback.rs (lane typeck-lib-wb).
//
//! During type inference, partially inferred terms are
//! represented using inference variables (ty::Infer). These don't appear in
//! the final [`ty::TypeckResults`] since all of the types should have been
//! inferred once typeck is done.
//!
//! When type inference is running however, having to update the typeck results
//! every time a new type is inferred would be unreasonably slow, so instead all
//! of the replacement happens at the end in [`FnCtxt::resolve_type_vars_in_body`],
//! which creates a new `TypeckResults` which doesn't contain any inference variables.
//
// PORT notes:
// - `WritebackCx` (hand class, types.sets.json `hand`) extends rustc_hir intravisit's `Visitor`; its `impl Visitor`
//   overrides are in the class body, its inherent methods are assigned onto the prototype (declared in decls.ts).
// - `Resolver`, `EagerlyNormalizeConsts` (`TypeFolder`s) and `HasRecursiveOpaque` (a `TypeVisitor`) are classes.
// - `trait Locatable` is decls.ts's `Locatable = Span | HirId`; `to_span` is `Locatable_to_span` (a `Span` is a number,
//   a `HirId` an object).
// - `T: TypeFoldable` generics take the D4 descriptor `d_T`. Types whose derived `TypeFoldable` is not generated
//   (`CapturedPlace` / `hir::place::Place`, pending rustc_middle hir/place.rs; `ClosureSizeProfileData`;
//   `ProvisionalHiddenType`) get `unported` descriptors (precedent rustc_hir_analysis check/check.ts).
// - `UnordMap::to_sorted(hcx, _)` over `LocalDefId` keys sorts by the keys' stable hash key, the `DefPathHash`
//   (precedent rustc_resolve late/diagnostics.ts).
// - `FnCtxt::err_ctxt()` returns the `Pending` `TypeErrCtxt` (wave 19); `TypeErrCtxtView` lists the methods called here.
// - `debug!` / `#[instrument]` are tracing only and stay as comments.
// Init order: top-level code here touches only ./decls.ts, this file's .gen.ts and other crates.
export * from "./writeback.gen.ts";
import { ControlFlow, VisitorResult as VisitorResultC, type VisitorResult } from "../rustc_ast_ir/visit.ts";
import { BinOpKind } from "../rustc_ast/lib.ts";
import { find_attr } from "../rustc_attr_ir/lib.ts";
import type { Diag } from "../rustc_errors/diagnostic.ts";
import { E0720 } from "../rustc_errors/error_codes.gen.ts";
import * as hir from "../rustc_hir/lib.ts";
import type { InferKind } from "../rustc_hir/intravisit.ts";
import { type HirId, HirId as HirIdC, HirIdMap } from "../rustc_hir_id/lib.ts";
import { ObligationCause } from "../rustc_middle/traits/mod.ts";
import { fold_with_ObligationCause, try_fold_with_ObligationCause, visit_with_ObligationCause } from "../rustc_middle/traits/mod.gen.ts";
import { type Adjustment, type PatAdjustment } from "../rustc_middle/ty/adjustment.ts";
import { fold_with_Adjustment, fold_with_PatAdjustment, try_fold_with_Adjustment, try_fold_with_PatAdjustment, visit_with_Adjustment, visit_with_PatAdjustment } from "../rustc_middle/ty/adjustment.gen.ts";
import type { CapturedPlace } from "../rustc_middle/ty/closure.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { HirPlace } from "../rustc_middle/ty/decls.ts";
import { fold_GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import { type ClosureSizeProfileData, DefinitionSiteHiddenType, HasAttrs_LocalDefId, type ProvisionalHiddenType, Ty, type TypingEnv } from "../rustc_middle/ty/mod.ts";
import type { Predicate } from "../rustc_middle/ty/predicate.ts";
import { debug_Predicate, fold_Predicate, fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { display_Ty } from "../rustc_middle/ty/print/pretty.ts";
import { TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import { debug_UserArgs } from "../rustc_middle/ty/generic_args.gen.ts";
import type { Clauses } from "../rustc_middle/ty/list.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import { DefId_eq, LocalDefId as LocalDefIdC } from "../rustc_span/def_id.ts";
import { type ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import { FromSolverError_FulfillmentError } from "../rustc_trait_selection/solve/fulfill.ts";
import { fold_Goal_Predicate } from "../rustc_trait_selection/solve/inspect/analyse.ts";
import { deeply_normalize_with_skipped_universes_and_ambiguous_coroutine_goals } from "../rustc_trait_selection/solve/normalize.ts";
import type { FulfillmentError } from "../rustc_trait_selection/traits/mod.gen.ts";
import type { Binder } from "../rustc_type_ir/binder.ts";
import type { DebruijnIndex, UniverseIndex } from "../rustc_type_ir/lib.ts";
import { fold_regions, type PredicateProxy, type TypeFoldable, type TypeFolder, TypeFolder_provided, fold_tuple2, fold_Vec } from "../rustc_type_ir/fold.ts";
import type { Goal } from "../rustc_type_ir/solve/mod.ts";
import { Const, fold_Const } from "../rustc_type_ir/sty/consts.ts";
import type { Region } from "../rustc_type_ir/sty/mod.ts";
import { fold_FnSig } from "../rustc_type_ir/ty_kind.ts";
import type { FnSig as FnSigT } from "../rustc_type_ir/decls.ts";
import type { OpaqueTypeKey } from "../rustc_type_ir/opaque_ty.ts";
import { fold_with_OpaqueTypeKey, try_fold_with_OpaqueTypeKey, visit_with_OpaqueTypeKey } from "../rustc_type_ir/opaque_ty.gen.ts";
import { EarlyBinder } from "../rustc_type_ir/binder.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { type TypeVisitable, TypeVisitableExt, type TypeVisitor, TypeVisitor_provided } from "../rustc_type_ir/visit.ts";
import { PLAIN } from "../std/fmt.ts";
import { assert, unported, unwrap } from "../std/panic.ts";
import { FnCtxt, type Locatable } from "./decls.ts";
import { NonDefiningUseReason_report, opaque_type_has_defining_use_args } from "./opaque_types.ts";

///////////////////////////////////////////////////////////////////////////
// Entry point

// impl<'a, 'tcx> FnCtxt<'a, 'tcx> {
// rustc: compiler/rustc_hir_typeck/src/writeback.rs:41 resolve_type_vars_in_body
FnCtxt.prototype.resolve_type_vars_in_body = function (this: FnCtxt, body: hir.Body): TypeckResults {
  const item_def_id = this.tcx.hir_body_owner_def_id(body.id());

  // This attribute causes us to dump some writeback information
  // in the form of errors, which is used for unit tests.
  const rustc_dump_user_args =
    this.has_rustc_attrs &&
    find_attr(HasAttrs_LocalDefId.get_attrs(item_def_id, this.tcx), (k) => (k.$ === "RustcDumpUserArgs" ? null : undefined)) !== undefined;

  const wbcx = WritebackCx.new(this, body, rustc_dump_user_args);
  for (const param of body.params) {
    wbcx.visit_node_id(param.pat.span, param.hir_id);
  }
  const owner_kind = this.tcx.hir_body_owner_kind(item_def_id);
  switch (owner_kind.$) {
    // Visit the type of a const or static, which is used during THIR building.
    case "Const":
    case "Static":
    case "GlobalAsm": {
      const item_hir_id = this.tcx.local_def_id_to_hir_id(item_def_id);
      wbcx.visit_node_id(body.value.span, item_hir_id);
      break;
    }
    // For closures and consts, we already plan to visit liberated signatures.
    case "Closure":
    case "Fn":
      break;
  }
  wbcx.visit_body(body);
  wbcx.visit_min_capture_map();
  wbcx.eval_closure_size();
  wbcx.visit_fake_reads_map();
  wbcx.visit_closures();
  wbcx.visit_liberated_fn_sigs();
  wbcx.visit_fru_field_types();
  wbcx.visit_opaque_types();
  wbcx.visit_coercion_casts();
  wbcx.visit_user_provided_tys();
  wbcx.visit_user_provided_sigs();
  wbcx.visit_coroutine_interior();
  wbcx.visit_transmutes();
  wbcx.visit_offloads();
  wbcx.visit_offset_of_container_types();
  wbcx.visit_potentially_region_dependent_goals();

  // mem::take(&mut self.typeck_results.borrow_mut().used_trait_imports)
  const used_trait_imports = this.typeck_results.used_trait_imports;
  this.typeck_results.used_trait_imports = new Set();
  // debug!("used_trait_imports({:?}) = {:?}", item_def_id, used_trait_imports);
  wbcx.typeck_results.used_trait_imports = used_trait_imports;

  // debug!("writeback: typeck results for {:?} are {:#?}", item_def_id, wbcx.typeck_results);

  // self.tcx.arena.alloc(wbcx.typeck_results)
  return wbcx.typeck_results;
};

// rustc-type: compiler/rustc_hir_typeck/src/writeback.rs:97 WritebackCx
/// The Writeback context. This visitor walks the HIR, checking the
/// fn-specific typeck results to find inference variables. It resolves
/// those inference variables and writes the final result into the
/// `TypeckResults`. It also applies a few ad-hoc checks that were not
/// convenient to do elsewhere.
// PORT: hand class (types.sets.json `hand`): `impl Visitor for WritebackCx` (writeback.rs:259) overrides methods of
// rustc_hir intravisit's `Visitor` (class body below); its inherent methods are declared in decls.ts
// (`declare module "./writeback.ts"`) and assigned onto the prototype after the class.
export class WritebackCx extends hir.intravisit.Visitor {
  constructor(
    public fcx: FnCtxt,

    public typeck_results: TypeckResults,

    public body: hir.Body,

    public rustc_dump_user_args: boolean,
  ) {
    super();
  }

  ///////////////////////////////////////////////////////////////////////////
  // Impl of Visitor for Resolver
  //
  // This is the master code which walks the AST. It delegates most of
  // the heavy lifting to the generic visit and resolve functions
  // below. In general, a function is made into a `visitor` if it must
  // traffic in node-ids or update typeck results in the type context etc.

  // impl<'cx, 'tcx> Visitor<'tcx> for WritebackCx<'cx, 'tcx> {
  // rustc: compiler/rustc_hir_typeck/src/writeback.rs:261 visit_expr
  override visit_expr(e: hir.Expr): undefined {
    switch (e.kind.$) {
      case "Closure": {
        const body = this.fcx.tcx.hir_body(e.kind._0.body);
        for (const param of body.params) {
          this.visit_node_id(e.span, param.hir_id);
        }

        this.visit_body(body);
        break;
      }
      case "Struct": {
        const fields = e.kind._1;
        for (const field of fields) {
          this.visit_field_id(field.hir_id);
        }
        break;
      }
      case "Field":
      case "OffsetOf":
        this.visit_field_id(e.hir_id);
        break;
      default:
        break;
    }

    this.visit_node_id(e.span, e.hir_id);
    hir.intravisit.walk_expr(this, e);

    this.fix_scalar_builtin_expr(e);
    this.fix_index_builtin_expr(e);
    return undefined;
  }

  // rustc: compiler/rustc_hir_typeck/src/writeback.rs:289 visit_inline_const
  override visit_inline_const(anon_const: hir.ConstBlock): undefined {
    const span = this.tcx().def_span(anon_const.def_id);
    this.visit_node_id(span, anon_const.hir_id);

    const body = this.tcx().hir_body(anon_const.body);
    this.visit_body(body);
    return undefined;
  }

  // rustc: compiler/rustc_hir_typeck/src/writeback.rs:297 visit_generic_param
  override visit_generic_param(p: hir.GenericParam): undefined {
    switch (p.kind.$) {
      case "Lifetime":
        // Nothing to write back here
        break;
      case "Type":
      case "Const":
        this.tcx().dcx().span_delayed_bug(p.span, `unexpected generic param: ${hir.debug_GenericParam(p, PLAIN)}`);
        break;
    }
    return undefined;
  }

  // rustc: compiler/rustc_hir_typeck/src/writeback.rs:310 visit_block
  override visit_block(b: hir.Block): undefined {
    this.visit_node_id(b.span, b.hir_id);
    return hir.intravisit.walk_block(this, b);
  }

  // rustc: compiler/rustc_hir_typeck/src/writeback.rs:315 visit_pat
  override visit_pat(p: hir.Pat): undefined {
    switch (p.kind.$) {
      case "Binding": {
        const typeck_results = this.fcx.typeck_results;
        const bm = typeck_results.extract_binding_mode(this.tcx().sess, p.hir_id, p.span);
        this.typeck_results.pat_binding_modes_mut().insert(p.hir_id, bm);
        break;
      }
      case "Struct": {
        const fields = p.kind._1;
        for (const field of fields) {
          this.visit_field_id(field.hir_id);
        }
        break;
      }
      default:
        break;
    }

    this.visit_rust_2024_migration_desugared_pats(p.hir_id);
    this.visit_skipped_ref_pats(p.hir_id);
    this.visit_pat_adjustments(p.span, p.hir_id);

    this.visit_node_id(p.span, p.hir_id);
    return hir.intravisit.walk_pat(this, p);
  }

  // rustc: compiler/rustc_hir_typeck/src/writeback.rs:338 visit_pat_expr
  override visit_pat_expr(expr: hir.PatExpr): undefined {
    this.visit_node_id(expr.span, expr.hir_id);
    return hir.intravisit.walk_pat_expr(this, expr);
  }

  // rustc: compiler/rustc_hir_typeck/src/writeback.rs:343 visit_local
  override visit_local(l: hir.LetStmt): undefined {
    hir.intravisit.walk_local(this, l);
    const var_ty_ = this.fcx.local_ty(l.span, l.hir_id);
    const var_ty = this.resolve(var_ty_, l.span, fold_Ty);
    this.write_ty_to_typeck_results(l.hir_id, var_ty);
    return undefined;
  }

  // rustc: compiler/rustc_hir_typeck/src/writeback.rs:350 visit_ty
  override visit_ty(hir_ty: hir.Ty<hir.AmbigArg>): undefined {
    hir.intravisit.walk_ty(this, hir_ty);
    // If there are type checking errors, Type privacy pass will stop,
    // so we may not get the type from hir_id, see #104513
    const ty_ = this.fcx.node_ty_opt(hir_ty.hir_id);
    if (ty_ !== undefined) {
      const ty = this.resolve(ty_, hir_ty.span, fold_Ty);
      this.write_ty_to_typeck_results(hir_ty.hir_id, ty);
    }
    return undefined;
  }

  // rustc: compiler/rustc_hir_typeck/src/writeback.rs:360 visit_infer
  override visit_infer(inf_id: HirId, inf_span: Span, _kind: InferKind): undefined {
    this.visit_id(inf_id);

    // We don't currently write inference results of const infer vars to
    // the typeck results as there is not yet any part of the compiler that
    // needs this information.
    const ty_ = this.fcx.node_ty_opt(inf_id);
    if (ty_ !== undefined) {
      const ty = this.resolve(ty_, inf_span, fold_Ty);
      this.write_ty_to_typeck_results(inf_id, ty);
    }
    return undefined;
  }
}

// impl<'cx, 'tcx> WritebackCx<'cx, 'tcx> {
// rustc: compiler/rustc_hir_typeck/src/writeback.rs:111 new
(WritebackCx as unknown as { new: typeof WritebackCx.new }).new = function (fcx: FnCtxt, body: hir.Body, rustc_dump_user_args: boolean): WritebackCx {
  const owner = body.id().hir_id.owner;

  const wbcx = new WritebackCx(fcx, TypeckResults.new(owner), body, rustc_dump_user_args);

  // HACK: We specifically don't want the (opaque) error from tainting our
  // inference context. That'll prevent us from doing opaque type inference
  // later on in borrowck, which affects diagnostic spans pretty negatively.
  const e = fcx.tainted_by_errors();
  if (e !== undefined) {
    wbcx.typeck_results.tainted_by_errors = e;
  }

  return wbcx;
};

// rustc: compiler/rustc_hir_typeck/src/writeback.rs:135 tcx
WritebackCx.prototype.tcx = function (this: WritebackCx): TyCtxt {
  return this.fcx.tcx;
};

// rustc: compiler/rustc_hir_typeck/src/writeback.rs:139 write_ty_to_typeck_results
WritebackCx.prototype.write_ty_to_typeck_results = function (this: WritebackCx, hir_id: HirId, ty: Ty): void {
  // debug!("write_ty_to_typeck_results({:?}, {:?})", hir_id, ty);
  assert(
    !TypeVisitableExt.has_infer(ty, fold_Ty) && !TypeVisitableExt.has_placeholders(ty, fold_Ty) && !TypeVisitableExt.has_free_regions(ty, fold_Ty),
    `${display_Ty(ty)} can't be put into typeck results`,
  );
  this.typeck_results.node_types_mut().insert(hir_id, ty);
};

// Hacky hack: During type-checking, we treat *all* operators
// as potentially overloaded. But then, during writeback, if
// we observe that something like `a+b` is (known to be)
// operating on scalars, we clear the overload.
// rustc: compiler/rustc_hir_typeck/src/writeback.rs:152 fix_scalar_builtin_expr
WritebackCx.prototype.fix_scalar_builtin_expr = function (this: WritebackCx, e: hir.Expr): void {
  const kind = e.kind;
  switch (kind.$) {
    case "Unary": {
      if (kind._0 === "Neg" || kind._0 === "Not") {
        const inner = kind._1;
        const inner_ty = this.typeck_results.node_type(inner.hir_id);

        if (inner_ty.is_scalar()) {
          this.typeck_results.type_dependent_defs_mut().remove(e.hir_id);
          this.typeck_results.node_args_mut().remove(e.hir_id);
        }
      }
      break;
    }
    case "Binary": {
      const op = kind._0;
      const lhs = kind._1;
      const rhs = kind._2;
      const lhs_ty = this.typeck_results.node_type(lhs.hir_id);
      const rhs_ty = this.typeck_results.node_type(rhs.hir_id);

      if (lhs_ty.is_scalar() && rhs_ty.is_scalar()) {
        this.typeck_results.type_dependent_defs_mut().remove(e.hir_id);
        this.typeck_results.node_args_mut().remove(e.hir_id);

        if (!BinOpKind.is_by_value(op.node)) {
          const adjustments = this.typeck_results.adjustments_mut();
          const a = adjustments.get_mut(lhs.hir_id);
          if (a !== undefined) {
            a.value.pop();
          }
          const b = adjustments.get_mut(rhs.hir_id);
          if (b !== undefined) {
            b.value.pop();
          }
        }
      }
      break;
    }
    case "AssignOp": {
      const lhs = kind._1;
      const rhs = kind._2;
      const lhs_ty = this.typeck_results.node_type(lhs.hir_id);
      const rhs_ty = this.typeck_results.node_type(rhs.hir_id);

      if (lhs_ty.is_scalar() && rhs_ty.is_scalar()) {
        this.typeck_results.type_dependent_defs_mut().remove(e.hir_id);
        this.typeck_results.node_args_mut().remove(e.hir_id);

        const a = this.typeck_results.adjustments_mut().get_mut(lhs.hir_id);
        if (a !== undefined) {
          a.value.pop();
        }
      }
      break;
    }
    default:
      break;
  }
};

// (ouz-a 1005988): Normally `[T] : std::ops::Index<usize>` should be normalized
// into [T] but currently `Where` clause stops the normalization process for it,
// here we compare types of expr and base in a code without `Where` clause they would be equal
// if they are not we don't modify the expr, hence we bypass the ICE
// rustc: compiler/rustc_hir_typeck/src/writeback.rs:202 is_builtin_index
WritebackCx.prototype.is_builtin_index = function (this: WritebackCx, e: hir.Expr, base_ty: Ty, index_ty: Ty): boolean {
  const elem_ty = base_ty.builtin_index();
  const exp_ty = elem_ty !== undefined ? this.typeck_results.expr_ty_opt(e) : undefined;
  if (elem_ty !== undefined && exp_ty !== undefined) {
    return elem_ty === exp_ty && index_ty === this.fcx.tcx.types.usize;
  } else {
    return false;
  }
};

// Similar to operators, indexing is always assumed to be overloaded
// Here, correct cases where an indexing expression can be simplified
// to use builtin indexing because the index type is known to be
// usize-ish
// rustc: compiler/rustc_hir_typeck/src/writeback.rs:221 fix_index_builtin_expr
WritebackCx.prototype.fix_index_builtin_expr = function (this: WritebackCx, e: hir.Expr): void {
  if (e.kind.$ === "Index") {
    const base = e.kind._0;
    const index = e.kind._1;
    // All valid indexing looks like this; might encounter non-valid indexes at this point.
    const base_ty = this.typeck_results.expr_ty_adjusted(base);
    const k = base_ty.kind();
    if (k.$ === "Ref") {
      const base_ty_inner = k._1;
      const index_ty = this.typeck_results.expr_ty_adjusted(index);
      if (this.is_builtin_index(e, base_ty_inner, index_ty)) {
        // Remove the method call record
        this.typeck_results.type_dependent_defs_mut().remove(e.hir_id);
        this.typeck_results.node_args_mut().remove(e.hir_id);

        const a = this.typeck_results.adjustments_mut().get_mut(base.hir_id);
        if (a !== undefined) {
          // Discard the need for a mutable borrow
          // Extra adjustment made when indexing causes a drop
          // of size information - we need to get rid of it
          // Since this is "after" the other adjustment to be
          // discarded, we do an extra `pop()`
          const popped = a.value.pop();
          if (popped !== undefined && popped.kind.$ === "Pointer" && popped.kind._0.$ === "Unsize") {
            // So the borrow discard actually happens here
            a.value.pop();
          }
        }
      }
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/writeback.rs:379 eval_closure_size
WritebackCx.prototype.eval_closure_size = function (this: WritebackCx): void {
  this.tcx().with_stable_hashing_context((_hcx) => {
    const fcx_typeck_results = this.fcx.typeck_results;

    const closure_size_eval = new Map(
      to_sorted_by_def_path_hash(this.tcx(), closure_size_eval_of(fcx_typeck_results)).map(([closure_def_id, data_]) => {
        const closure_hir_id = this.tcx().local_def_id_to_hir_id(closure_def_id);
        const data = this.resolve(data_, closure_hir_id, fold_ClosureSizeProfileData);
        return [closure_def_id, data] as const;
      }),
    );
    this.typeck_results.closure_size_eval = closure_size_eval as unknown as TypeckResults["closure_size_eval"];
  });
};

// rustc: compiler/rustc_hir_typeck/src/writeback.rs:396 visit_min_capture_map
WritebackCx.prototype.visit_min_capture_map = function (this: WritebackCx): void {
  this.tcx().with_stable_hashing_context((_hcx) => {
    const fcx_typeck_results = this.fcx.typeck_results;

    this.typeck_results.closure_min_captures = new Map(
      to_sorted_by_def_path_hash(this.tcx(), fcx_typeck_results.closure_min_captures).map(([closure_def_id, root_min_captures]) => {
        const root_var_map_wb = new HirIdMap<CapturedPlace[]>();
        for (const [var_hir_id, min_list] of root_min_captures) {
          const min_list_wb = min_list.map((captured_place) => {
            const locatable = captured_place.info.path_expr_id ?? this.tcx().local_def_id_to_hir_id(closure_def_id);
            return this.resolve(captured_place, locatable, fold_CapturedPlace);
          });
          root_var_map_wb.set(var_hir_id, min_list_wb);
        }
        return [closure_def_id, root_var_map_wb] as const;
      }),
    );
  });
};

// rustc: compiler/rustc_hir_typeck/src/writeback.rs:427 visit_fake_reads_map
WritebackCx.prototype.visit_fake_reads_map = function (this: WritebackCx): void {
  this.tcx().with_stable_hashing_context((_hcx) => {
    const fcx_typeck_results = this.fcx.typeck_results;

    this.typeck_results.closure_fake_reads = new Map(
      to_sorted_by_def_path_hash(this.tcx(), fcx_typeck_results.closure_fake_reads).map(([closure_def_id, fake_reads]) => {
        const resolved_fake_reads = fake_reads.map(([place, cause, hir_id]) => {
          const locatable = this.tcx().local_def_id_to_hir_id(closure_def_id);
          const resolved_fake_read = this.resolve(place, locatable, fold_HirPlace);
          return [resolved_fake_read, cause, hir_id] as [HirPlace, typeof cause, HirId];
        });

        return [closure_def_id, resolved_fake_reads] as const;
      }),
    );
  });
};

// rustc: compiler/rustc_hir_typeck/src/writeback.rs:451 visit_closures
WritebackCx.prototype.visit_closures = function (this: WritebackCx): void {
  const fcx_typeck_results = this.fcx.typeck_results;
  assert_owner_eq(fcx_typeck_results, this.typeck_results);
  const common_hir_owner = fcx_typeck_results.hir_owner;

  const fcx_closure_kind_origins = fcx_typeck_results.closure_kind_origins().items_in_stable_order();

  for (const [local_id, origin] of fcx_closure_kind_origins) {
    const hir_id = new HirIdC(common_hir_owner, local_id);
    const place_span = origin[0];
    const place = this.resolve(origin[1], place_span, fold_HirPlace);
    this.typeck_results.closure_kind_origins_mut().insert(hir_id, [place_span, place]);
  }
};

// rustc: compiler/rustc_hir_typeck/src/writeback.rs:467 visit_coercion_casts
WritebackCx.prototype.visit_coercion_casts = function (this: WritebackCx): void {
  const fcx_typeck_results = this.fcx.typeck_results;

  assert_owner_eq(fcx_typeck_results, this.typeck_results);

  // `to_sorted_stable_ord()`: `ItemLocalId`s in numeric order.
  const fcx_coercion_casts = [...fcx_typeck_results.coercion_casts()].sort((a, b) => a - b);
  for (const local_id of fcx_coercion_casts) {
    this.typeck_results.set_coercion_cast(local_id);
  }
};

// rustc: compiler/rustc_hir_typeck/src/writeback.rs:478 visit_user_provided_tys
WritebackCx.prototype.visit_user_provided_tys = function (this: WritebackCx): void {
  const fcx_typeck_results = this.fcx.typeck_results;
  assert_owner_eq(fcx_typeck_results, this.typeck_results);
  const common_hir_owner = fcx_typeck_results.hir_owner;

  if (this.rustc_dump_user_args) {
    const sorted_user_provided_types = fcx_typeck_results.user_provided_types().items_in_stable_order();

    const errors_buffer: Diag[] = [];
    for (const [local_id, c_ty] of sorted_user_provided_types) {
      const hir_id = new HirIdC(common_hir_owner, local_id);

      const kind = c_ty.value.kind;
      if (kind.$ === "TypeOf") {
        const user_args = kind._1;
        // This is a unit-testing mechanism.
        const span = this.tcx().hir_span(hir_id);
        // We need to buffer the errors in order to guarantee a consistent
        // order when emitting them.
        const err = this.tcx().dcx().struct_span_err(span, `user args: ${debug_UserArgs(user_args, PLAIN)}`);
        errors_buffer.push(err);
      }
    }

    if (!(errors_buffer.length === 0)) {
      // `sort_by_key(|diag| diag.span.primary_span().map(Span::lo_hi))`: a stable sort, `None` first.
      const key = (diag: Diag): [number, number] | undefined => {
        const sp = diag.deref().span.primary_span();
        return sp !== undefined ? Span.lo_hi(sp) : undefined;
      };
      const keyed = errors_buffer.map((d) => [key(d), d] as const);
      keyed.sort(([a], [b]) => {
        if (a === undefined || b === undefined) return a === undefined ? (b === undefined ? 0 : -1) : 1;
        if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
        if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
        return 0;
      });
      for (const [, err] of keyed) {
        err.emit();
      }
    }
  }

  this.typeck_results.user_provided_types_mut().extend(
    (function* () {
      for (const [local_id, c_ty] of fcx_typeck_results.user_provided_types().items()) {
        const hir_id = new HirIdC(common_hir_owner, local_id);
        yield [hir_id, c_ty] as [HirId, typeof c_ty];
      }
    })(),
  );
};

// rustc: compiler/rustc_hir_typeck/src/writeback.rs:518 visit_user_provided_sigs
WritebackCx.prototype.visit_user_provided_sigs = function (this: WritebackCx): void {
  const fcx_typeck_results = this.fcx.typeck_results;
  assert_owner_eq(fcx_typeck_results, this.typeck_results);

  for (const [def_id, c_sig] of fcx_typeck_results.user_provided_sigs) {
    this.typeck_results.user_provided_sigs.set(def_id, c_sig);
  }
};

// rustc: compiler/rustc_hir_typeck/src/writeback.rs:527 visit_coroutine_interior
WritebackCx.prototype.visit_coroutine_interior = function (this: WritebackCx): void {
  const fcx_typeck_results = this.fcx.typeck_results;
  assert_owner_eq(fcx_typeck_results, this.typeck_results);
  for (const [predicate_, cause_] of fcx_typeck_results.coroutine_stalled_predicates) {
    const [predicate, cause] = this.resolve_coroutine_predicate<[Predicate, ObligationCause]>([predicate_, cause_], cause_.span, fold_Predicate_ObligationCause());
    this.typeck_results.coroutine_stalled_predicates.add([predicate, cause]);
  }
};

// rustc: compiler/rustc_hir_typeck/src/writeback.rs:537 visit_transmutes
WritebackCx.prototype.visit_transmutes = function (this: WritebackCx): void {
  const tcx = this.tcx();
  const fcx_typeck_results = this.fcx.typeck_results;
  assert_owner_eq(fcx_typeck_results, this.typeck_results);
  for (const [from_, to_, hir_id] of this.fcx.deferred_transmute_checks) {
    const span = tcx.hir_span(hir_id);
    const from = this.resolve(from_, span, fold_Ty);
    const to = this.resolve(to_, span, fold_Ty);
    this.typeck_results.transmutes_to_check.push([from, to, hir_id]);
  }
};

// rustc: compiler/rustc_hir_typeck/src/writeback.rs:549 visit_offloads
WritebackCx.prototype.visit_offloads = function (this: WritebackCx): void {
  const tcx = this.tcx();
  const fcx_typeck_results = this.fcx.typeck_results;
  assert_owner_eq(fcx_typeck_results, this.typeck_results);
  for (const [kernel_ty_, args_ty_, ret_ty_, hir_id] of this.fcx.deferred_offload_checks) {
    const span = tcx.hir_span(hir_id);
    const kernel_ty = this.resolve(kernel_ty_, span, fold_Ty);
    const args_ty = this.resolve(args_ty_, span, fold_Ty);
    const ret_ty = this.resolve(ret_ty_, span, fold_Ty);
    this.typeck_results.offloads_to_check.push([kernel_ty, args_ty, ret_ty, hir_id]);
  }
};

// rustc: compiler/rustc_hir_typeck/src/writeback.rs:564 visit_opaque_types_next
WritebackCx.prototype.visit_opaque_types_next = function (this: WritebackCx): void {
  const fcx_typeck_results = this.fcx.typeck_results;
  assert_owner_eq(fcx_typeck_results, this.typeck_results);
  assert(this.typeck_results.hidden_types.size === 0, "assertion failed: `(left == right)`: self.typeck_results.hidden_types.len() == 0");
  this.typeck_results.hidden_types = fcx_typeck_results.hidden_types;
  fcx_typeck_results.hidden_types = new Map();
};

// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_hir_typeck/src/writeback.rs:572 visit_opaque_types
WritebackCx.prototype.visit_opaque_types = function (this: WritebackCx): void {
  if (this.fcx.next_trait_solver()) {
    return this.visit_opaque_types_next();
  }

  const tcx = this.tcx();
  // We clone the opaques instead of stealing them here as they are still used for
  // normalization in the next generation trait solver.
  const opaque_types = this.fcx.infcx.clone_opaque_types();
  const num_entries = this.fcx.inner.opaque_types().deref().num_entries();
  const prev = this.fcx.checked_opaque_types_storage_entries;
  this.fcx.checked_opaque_types_storage_entries = num_entries;
  // debug_assert_eq!(prev, None);
  void prev;
  const hidden_types = hidden_types_of(this.typeck_results);
  for (const [opaque_type_key0, hidden_type0] of opaque_types) {
    const hidden_type = this.resolve(hidden_type0, hidden_type0.span, fold_ProvisionalHiddenType);
    const opaque_type_key = this.resolve(opaque_type_key0, hidden_type.span, fold_OpaqueTypeKey);
    const k = hidden_type.ty.kind();
    if (
      k.$ === "Alias" &&
      k._1.kind.$ === "Opaque" &&
      DefId_eq(k._1.kind.def_id, LocalDefIdC.to_def_id(opaque_type_key.def_id)) &&
      k._1.args === opaque_type_key.args
    ) {
      continue;
    }

    const r = opaque_type_has_defining_use_args(this.fcx.infcx, opaque_type_key, hidden_type.span, "HirTypeck");
    if (r.$ === "Err") {
      const err = r._0;
      hidden_types.set(opaque_type_key.def_id, DefinitionSiteHiddenType.new_error(tcx, NonDefiningUseReason_report(err, this.fcx.infcx)));
    }

    const remapped = hidden_type.remap_generic_params_to_declaration_params(opaque_type_key, tcx, "HirTypeck");

    // `IndexMap::insert` keeps the slot of an existing key and returns the previous value.
    const prev = hidden_types.get(opaque_type_key.def_id);
    hidden_types.set(opaque_type_key.def_id, remapped);
    if (prev !== undefined) {
      let entry = unwrap(hidden_types.get(opaque_type_key.def_id));
      if (prev.ty.value !== remapped.ty.value) {
        let guar: ErrorGuaranteed;
        const tainted = this.typeck_results.tainted_by_errors;
        if (tainted !== undefined) {
          guar = tainted;
        } else {
          const r = prev.build_mismatch_error(remapped, tcx);
          guar = r.$ === "Ok" ? r._0.emit_err() : r._0;
        }
        entry = DefinitionSiteHiddenType.new_error(tcx, guar);
      }

      // Pick a better span if there is one.
      // FIXME(oli-obk): collect multiple spans for better diagnostics down the road.
      // PORT: `entry.span = ..` on a `&mut` into the map: the fields are readonly, so the slot gets a new value.
      hidden_types.set(opaque_type_key.def_id, new DefinitionSiteHiddenType(Span.substitute_dummy(prev.span, remapped.span), entry.ty));
    }
  }

  const recursive_opaques: [LocalDefId, Span][] = [];
  for (const [def_id, hidden_ty] of hidden_types) {
    const v = new HasRecursiveOpaque(def_id, new Set(), hidden_types, tcx);
    if (is_break(fold_Ty.visit_with(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(hidden_ty.ty)), v))) {
      recursive_opaques.push([def_id, hidden_ty.span]);
    }
  }
  for (const [def_id, span] of recursive_opaques) {
    const guar = this.fcx.dcx().struct_span_err(span, "cannot resolve opaque type").with_code(E0720).emit_err();
    hidden_types.set(def_id, DefinitionSiteHiddenType.new_error(tcx, guar));
  }
};

// rustc: compiler/rustc_hir_typeck/src/writeback.rs:667 visit_field_id
WritebackCx.prototype.visit_field_id = function (this: WritebackCx, hir_id: HirId): void {
  const index = this.fcx.typeck_results.field_indices_mut().remove(hir_id);
  if (index !== undefined) {
    this.typeck_results.field_indices_mut().insert(hir_id, index);
  }
};

// #[instrument(skip(self, span), level = "debug")]
// rustc: compiler/rustc_hir_typeck/src/writeback.rs:675 visit_node_id
WritebackCx.prototype.visit_node_id = function (this: WritebackCx, span: Span, hir_id: HirId): void {
  // Export associated path extensions and method resolutions.
  const def = this.fcx.typeck_results.type_dependent_defs_mut().remove(hir_id);
  if (def !== undefined) {
    this.typeck_results.type_dependent_defs_mut().insert(hir_id, def);
  }

  // Export splatted function call resolutions.
  const sdef = this.fcx.typeck_results.splatted_defs_mut().remove(hir_id);
  if (sdef !== undefined) {
    this.typeck_results.splatted_defs_mut().insert(hir_id, sdef);
  }

  // Resolve any borrowings for the node with id `node_id`
  this.visit_adjustments(span, hir_id);

  // Resolve the type of the node with id `node_id`
  const n_ty_ = this.fcx.node_ty(hir_id);
  const n_ty = this.resolve(n_ty_, span, fold_Ty);
  this.write_ty_to_typeck_results(hir_id, n_ty);
  // debug!(?n_ty);

  // Resolve any generic parameters
  const args_ = this.fcx.typeck_results.node_args_opt(hir_id);
  if (args_ !== undefined) {
    const args = this.resolve(args_, span, fold_GenericArgs);
    // debug!("write_args_to_tcx({:?}, {:?})", hir_id, args);
    assert(
      !TypeVisitableExt.has_infer(args, fold_GenericArgs) && !TypeVisitableExt.has_placeholders(args, fold_GenericArgs),
      "assertion failed: !args.has_infer() && !args.has_placeholders()",
    );
    this.typeck_results.node_args_mut().insert(hir_id, args);
  }
};

// #[instrument(skip(self, span), level = "debug")]
// rustc: compiler/rustc_hir_typeck/src/writeback.rs:707 visit_adjustments
WritebackCx.prototype.visit_adjustments = function (this: WritebackCx, span: Span, hir_id: HirId): void {
  const adjustment = this.fcx.typeck_results.adjustments_mut().remove(hir_id);
  if (adjustment === undefined) {
    // debug!("no adjustments for node");
  } else {
    const resolved_adjustment = this.resolve(adjustment, span, fold_Adjustments());
    // debug!(?resolved_adjustment);
    this.typeck_results.adjustments_mut().insert(hir_id, resolved_adjustment);
  }
};

// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_hir_typeck/src/writeback.rs:723 visit_rust_2024_migration_desugared_pats
WritebackCx.prototype.visit_rust_2024_migration_desugared_pats = function (this: WritebackCx, hir_id: HirId): void {
  const is_hard_error = this.fcx.typeck_results.rust_2024_migration_desugared_pats_mut().remove(hir_id);
  if (is_hard_error !== undefined) {
    // debug!(
    //     "node is a pat whose match ergonomics are desugared by the Rust 2024 migration lint"
    // );
    this.typeck_results.rust_2024_migration_desugared_pats_mut().insert(hir_id, is_hard_error);
  }
};

// #[instrument(skip(self, span), level = "debug")]
// rustc: compiler/rustc_hir_typeck/src/writeback.rs:741 visit_pat_adjustments
WritebackCx.prototype.visit_pat_adjustments = function (this: WritebackCx, span: Span, hir_id: HirId): void {
  const adjustment = this.fcx.typeck_results.pat_adjustments_mut().remove(hir_id);
  if (adjustment === undefined) {
    // debug!("no pat_adjustments for node");
  } else {
    const resolved_adjustment = this.resolve(adjustment, span, fold_PatAdjustments());
    // debug!(?resolved_adjustment);
    this.typeck_results.pat_adjustments_mut().insert(hir_id, resolved_adjustment);
  }
};

// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_hir_typeck/src/writeback.rs:757 visit_skipped_ref_pats
WritebackCx.prototype.visit_skipped_ref_pats = function (this: WritebackCx, hir_id: HirId): void {
  if (this.fcx.typeck_results.skipped_ref_pats_mut().remove(hir_id)) {
    // debug!("node is a skipped ref pat");
    this.typeck_results.skipped_ref_pats_mut().insert(hir_id);
  }
};

// rustc: compiler/rustc_hir_typeck/src/writeback.rs:764 visit_liberated_fn_sigs
WritebackCx.prototype.visit_liberated_fn_sigs = function (this: WritebackCx): void {
  const fcx_typeck_results = this.fcx.typeck_results;
  assert_owner_eq(fcx_typeck_results, this.typeck_results);
  const common_hir_owner = fcx_typeck_results.hir_owner;

  const fcx_liberated_fn_sigs = fcx_typeck_results.liberated_fn_sigs().items_in_stable_order();

  for (const [local_id, fn_sig_] of fcx_liberated_fn_sigs) {
    const hir_id = new HirIdC(common_hir_owner, local_id);
    const fn_sig: FnSigT = this.resolve(fn_sig_, hir_id, fold_FnSig);
    this.typeck_results.liberated_fn_sigs_mut().insert(hir_id, fn_sig);
  }
};

// rustc: compiler/rustc_hir_typeck/src/writeback.rs:778 visit_fru_field_types
WritebackCx.prototype.visit_fru_field_types = function (this: WritebackCx): void {
  const fcx_typeck_results = this.fcx.typeck_results;
  assert_owner_eq(fcx_typeck_results, this.typeck_results);
  const common_hir_owner = fcx_typeck_results.hir_owner;

  const fcx_fru_field_types = fcx_typeck_results.fru_field_types().items_in_stable_order();

  for (const [local_id, ftys_] of fcx_fru_field_types) {
    const hir_id = new HirIdC(common_hir_owner, local_id);
    const ftys = this.resolve(ftys_.slice(), hir_id, fold_Vec(fold_Ty)) as Ty[];
    this.typeck_results.fru_field_types_mut().insert(hir_id, ftys);
  }
};

// rustc: compiler/rustc_hir_typeck/src/writeback.rs:792 visit_offset_of_container_types
WritebackCx.prototype.visit_offset_of_container_types = function (this: WritebackCx): void {
  const fcx_typeck_results = this.fcx.typeck_results;
  assert_owner_eq(fcx_typeck_results, this.typeck_results);
  const common_hir_owner = fcx_typeck_results.hir_owner;

  for (const [local_id, indices_] of fcx_typeck_results.offset_of_data().items_in_stable_order()) {
    const hir_id = new HirIdC(common_hir_owner, local_id);
    const indices = indices_.map(([ty, variant, field]) => [this.resolve(ty, hir_id, fold_Ty), variant, field] as [Ty, typeof variant, typeof field]);
    this.typeck_results.offset_of_data_mut().insert(hir_id, indices);
  }
};

// rustc: compiler/rustc_hir_typeck/src/writeback.rs:807 visit_potentially_region_dependent_goals
WritebackCx.prototype.visit_potentially_region_dependent_goals = function (this: WritebackCx): void {
  const obligations = this.fcx.take_hir_typeck_potentially_region_dependent_goals();
  if (this.fcx.tainted_by_errors() === undefined) {
    for (const obligation of obligations) {
      const [predicate, cause_] = this.fcx.deeply_resolve_ignoring_regions<[Predicate, ObligationCause]>(
        [obligation.predicate, obligation.cause],
        fold_Predicate_ObligationCause(),
      );
      let cause = cause_;
      if (TypeVisitableExt.has_non_region_infer(predicate, fold_Predicate)) {
        this.fcx.dcx().span_delayed_bug(cause.span, `unexpected inference variable after writeback: ${debug_Predicate(predicate, PLAIN)}`);
      } else {
        const predicate_ = this.tcx().erase_and_anonymize_regions(predicate, fold_Predicate);
        if (TypeVisitableExt.has_infer(cause, fold_ObligationCause()) || TypeVisitableExt.has_placeholders(cause, fold_ObligationCause())) {
          // We can't use the obligation cause as it references
          // information local to this query.
          cause = this.fcx.misc(cause.span);
        }
        this.typeck_results.potentially_region_dependent_goals.add([predicate_, cause]);
      }
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/writeback.rs:834 resolve
WritebackCx.prototype.resolve = function <T>(this: WritebackCx, value_: T, span: Locatable, d_T: TypeFoldable<T>): T {
  const value1 = this.fcx.deeply_resolve_ignoring_regions(value_, d_T);

  const goals: Goal<Predicate>[] = [];
  const value = d_T.fold_with(value1, Resolver.new(this.fcx, span, this.body, true, goals));

  // Ensure that we resolve goals we get from normalizing coroutine interiors,
  // but we shouldn't expect those goals to need normalizing (or else we'd get
  // into a somewhat awkward fixpoint situation, and we don't need it anyways).
  const unexpected_goals: Goal<Predicate>[] = [];
  for (const pred of goals) {
    const goal = fold_Goal_Predicate.fold_with(
      this.fcx.deeply_resolve_ignoring_regions(pred, fold_Goal_Predicate),
      Resolver.new(this.fcx, span, this.body, false, unexpected_goals),
    );
    // FIXME: throwing away the param-env :(
    this.typeck_results.coroutine_stalled_predicates.add([goal.predicate, this.fcx.misc(Locatable_to_span(span, this.fcx.tcx))]);
  }
  assert(unexpected_goals.length === 0, "assertion failed: `(left == right)`: unexpected_goals == vec![]");

  assert(!TypeVisitableExt.has_infer(value, d_T), "assertion failed: !value.has_infer()");

  // We may have introduced e.g. `ty::Error`, if inference failed, make sure
  // to mark the `TypeckResults` as tainted in that case, so that downstream
  // users of the typeck results don't produce extra errors, or worse, ICEs.
  const r = TypeVisitableExt.error_reported(value, d_T);
  if (r.$ === "Err") {
    this.typeck_results.tainted_by_errors = r._0;
  }

  return value;
};

// rustc: compiler/rustc_hir_typeck/src/writeback.rs:877 resolve_coroutine_predicate
WritebackCx.prototype.resolve_coroutine_predicate = function <T>(this: WritebackCx, value_: T, span: Locatable, d_T: TypeFoldable<T>): T {
  const value1 = this.fcx.deeply_resolve_ignoring_regions(value_, d_T);

  const goals: Goal<Predicate>[] = [];
  const value = d_T.fold_with(value1, Resolver.new(this.fcx, span, this.body, false, goals));
  assert(goals.length === 0, "assertion failed: `(left == right)`: goals == vec![]");

  assert(!TypeVisitableExt.has_infer(value, d_T), "assertion failed: !value.has_infer()");

  // We may have introduced e.g. `ty::Error`, if inference failed, make sure
  // to mark the `TypeckResults` as tainted in that case, so that downstream
  // users of the typeck results don't produce extra errors, or worse, ICEs.
  const r = TypeVisitableExt.error_reported(value, d_T);
  if (r.$ === "Err") {
    this.typeck_results.tainted_by_errors = r._0;
  }

  return value;
};

// pub(crate) trait Locatable { fn to_span(&self, tcx: TyCtxt<'_>) -> Span; }
// PORT: `&dyn Locatable` is decls.ts's `Locatable = Span | HirId`; the two impls dispatch on the representation.
// rustc: compiler/rustc_hir_typeck/src/writeback.rs:902 to_span
export function Locatable_to_span(self_: Locatable, tcx: TyCtxt): Span {
  return typeof self_ === "number" ? Span_to_span(self_, tcx) : HirId_to_span(self_, tcx);
}

// impl Locatable for Span
// rustc: compiler/rustc_hir_typeck/src/writeback.rs:906 to_span
function Span_to_span(self_: Span, _: TyCtxt): Span {
  return self_;
}

// impl Locatable for HirId
// rustc: compiler/rustc_hir_typeck/src/writeback.rs:912 to_span
function HirId_to_span(self_: HirId, tcx: TyCtxt): Span {
  return tcx.hir_span(self_);
}

// rustc-type: compiler/rustc_hir_typeck/src/writeback.rs:917 Resolver
export class Resolver implements TypeFolder {
  constructor(
    public fcx: FnCtxt,
    public span: Locatable,
    public body: hir.Body,
    /// Whether we should normalize using the new solver, disabled
    /// both when using the old solver and when resolving predicates.
    public should_normalize: boolean,
    // PORT: `&'cx mut Vec<Goal<..>>`: the caller's array, pushed into.
    public nested_goals: Goal<Predicate>[],
  ) {}

  // rustc: compiler/rustc_hir_typeck/src/writeback.rs:928 new
  static new(fcx: FnCtxt, span: Locatable, body: hir.Body, should_normalize: boolean, nested_goals: Goal<Predicate>[]): Resolver {
    return new Resolver(fcx, span, body, should_normalize, nested_goals);
  }

  // rustc: compiler/rustc_hir_typeck/src/writeback.rs:938 report_error
  report_error(p: Ty | Const): ErrorGuaranteed {
    const guar = this.fcx.tainted_by_errors();
    if (guar !== undefined) {
      return guar;
    } else {
      return err_ctxt(this.fcx)
        .emit_inference_failure_err(this.fcx.tcx.hir_body_owner_def_id(this.body.id()), Locatable_to_span(this.span, this.fcx.tcx), p, "E0282", false)
        .emit_err();
    }
  }

  // #[instrument(level = "debug", skip(self, outer_exclusive_binder, new_err))]
  // rustc: compiler/rustc_hir_typeck/src/writeback.rs:956 handle_term
  handle_term<T extends Ty | Const>(
    value_: T,
    outer_exclusive_binder: (_1: T) => DebruijnIndex,
    new_err: (_1: TyCtxt, _2: ErrorGuaranteed) => T,
    d_T: TypeFoldable<T>,
  ): T {
    const tcx = this.fcx.tcx;
    // We must deeply normalize in the new solver, since later lints expect
    // that types that show up in the typeck are fully normalized.
    let value: T;
    if (this.should_normalize && this.fcx.next_trait_solver()) {
      const body_def_id = tcx.hir_body_owner_def_id(this.body.id());
      const cause = ObligationCause.misc(Locatable_to_span(this.span, tcx), body_def_id);
      const at = this.fcx.at(cause, this.fcx.param_env);
      const universes = new Array<UniverseIndex | undefined>(outer_exclusive_binder(value_)).fill(undefined);
      const r = deeply_normalize_with_skipped_universes_and_ambiguous_coroutine_goals<T, FulfillmentError>(
        at,
        Unnormalized.new_wip(value_),
        universes,
        FromSolverError_FulfillmentError,
        d_T,
      );
      if (r.$ === "Ok") {
        const [v, goals] = r._0;
        this.nested_goals.push(...goals);
        value = v;
      } else {
        const errors = r._0;
        const guar = err_ctxt(this.fcx).report_fulfillment_errors(errors);
        value = new_err(tcx, guar);
      }
    } else {
      value = value_;
    }

    // Bail if there are any non-region infer.
    if (TypeVisitableExt.has_non_region_infer(value, d_T)) {
      const guar = this.report_error(value);
      value = new_err(tcx, guar);
    }

    // Erase the regions from the ty, since it's not really meaningful what
    // these region values are; there's not a trivial correspondence between
    // regions in the HIR and MIR, so when we turn the body into MIR, there's
    // no reason to keep regions around. They will be repopulated during MIR
    // borrowck, and specifically region constraints will be populated during
    // MIR typeck which is run on the new body.
    //
    // We're not using `tcx.erase_and_anonymize_regions` as that also
    // anonymizes bound variables, regressing borrowck diagnostics.
    value = fold_regions(tcx, value, (_r, _d) => tcx.lifetimes.re_erased, d_T);

    // Normalize consts in writeback, because GCE doesn't normalize eagerly.
    if (tcx.features().generic_const_exprs()) {
      value = d_T.fold_with(value, EagerlyNormalizeConsts.new(this.fcx));
    }

    return value;
  }

  // impl<'cx, 'tcx> TypeFolder<TyCtxt<'tcx>> for Resolver<'cx, 'tcx>
  // rustc: compiler/rustc_hir_typeck/src/writeback.rs:1018 cx
  cx(): TyCtxt {
    return this.fcx.tcx;
  }

  // rustc: compiler/rustc_hir_typeck/src/writeback.rs:1022 fold_region
  fold_region(r: Region): Region {
    switch (r.kind().$) {
      case "ReBound":
        return r;
      default:
        return this.fcx.tcx.lifetimes.re_erased;
    }
  }

  // rustc: compiler/rustc_hir_typeck/src/writeback.rs:1029 fold_ty
  fold_ty(ty: Ty): Ty {
    return this.handle_term(ty, (t) => t.outer_exclusive_binder(), Ty.new_error, fold_Ty);
  }

  // rustc: compiler/rustc_hir_typeck/src/writeback.rs:1033 fold_const
  fold_const(ct: Const): Const {
    return this.handle_term(ct, (c) => c.outer_exclusive_binder(), Const.new_error, fold_Const);
  }

  // rustc: compiler/rustc_hir_typeck/src/writeback.rs:1037 fold_predicate
  fold_predicate<P>(predicate: P, d: PredicateProxy<P>): P {
    assert(!this.should_normalize, "normalizing predicates in writeback is not generally sound");
    return d.super_fold_with(predicate, this);
  }

  // (provided) the `TypeFolder` methods `Resolver` does not override.
  fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    return TypeFolder_provided.fold_binder(this, t, d);
  }
  fold_clauses(c: Clauses): Clauses {
    return TypeFolder_provided.fold_clauses(this, c);
  }
}

// rustc-type: compiler/rustc_hir_typeck/src/writeback.rs:1046 EagerlyNormalizeConsts
export class EagerlyNormalizeConsts implements TypeFolder {
  constructor(
    public tcx: TyCtxt,
    public typing_env: TypingEnv,
  ) {}

  // rustc: compiler/rustc_hir_typeck/src/writeback.rs:1051 new
  static new(fcx: FnCtxt): EagerlyNormalizeConsts {
    // FIXME(#132279, generic_const_exprs): Using `try_normalize_erasing_regions` here
    // means we can't handle opaque types in their defining scope.
    return new EagerlyNormalizeConsts(fcx.tcx, fcx.typing_env(fcx.param_env));
  }

  // impl<'tcx> TypeFolder<TyCtxt<'tcx>> for EagerlyNormalizeConsts<'tcx>
  // rustc: compiler/rustc_hir_typeck/src/writeback.rs:1059 cx
  cx(): TyCtxt {
    return this.tcx;
  }

  // rustc: compiler/rustc_hir_typeck/src/writeback.rs:1063 fold_const
  fold_const(ct: Const): Const {
    const r = this.tcx.try_normalize_erasing_regions(this.typing_env, Unnormalized.new_wip(ct), fold_Const);
    return r.$ === "Ok" ? r._0 : ct;
  }

  // (provided) the `TypeFolder` methods `EagerlyNormalizeConsts` does not override.
  fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    return TypeFolder_provided.fold_binder(this, t, d);
  }
  fold_ty(t: Ty): Ty {
    return TypeFolder_provided.fold_ty(this, t);
  }
  fold_region(r: Region): Region {
    return TypeFolder_provided.fold_region(this, r);
  }
  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    return TypeFolder_provided.fold_predicate(this, p, d);
  }
  fold_clauses(c: Clauses): Clauses {
    return TypeFolder_provided.fold_clauses(this, c);
  }
}

// rustc-type: compiler/rustc_hir_typeck/src/writeback.rs:1070 HasRecursiveOpaque
export class HasRecursiveOpaque implements TypeVisitor<ControlFlow<null>> {
  // type Result = ControlFlow<()>;
  readonly Result: VisitorResult<ControlFlow<null>, unknown> = VisitorResultC.ControlFlow<null>();

  constructor(
    public def_id: LocalDefId,
    public seen: Set<LocalDefId>,
    public opaques: Map<LocalDefId, DefinitionSiteHiddenType>,
    public tcx: TyCtxt,
  ) {}

  // impl<'tcx> TypeVisitor<TyCtxt<'tcx>> for HasRecursiveOpaque<'_, 'tcx>
  // rustc: compiler/rustc_hir_typeck/src/writeback.rs:1080 visit_ty
  visit_ty(t: Ty): ControlFlow<null> {
    const k = t.kind();
    if (k.$ === "Alias" && k._1.kind.$ === "Opaque") {
      const args = k._1.args;
      const def_id = k._1.kind.def_id.as_local();
      if (def_id !== undefined) {
        if (this.def_id === def_id) {
          return ControlFlow.Break(null);
        }

        const fresh = !this.seen.has(def_id);
        this.seen.add(def_id);
        const hidden_ty = fresh ? this.opaques.get(def_id) : undefined;
        if (hidden_ty !== undefined) {
          const r = fold_Ty.visit_with(Unnormalized.skip_norm_wip(EarlyBinder.instantiate(hidden_ty.ty, this.tcx, args, fold_Ty)), this);
          if (is_break(r)) return r;
        }
      }
    }

    return fold_Ty.super_visit_with(t, this);
  }

  // (provided) the `TypeVisitor` methods `HasRecursiveOpaque` does not override.
  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): ControlFlow<null> {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }
  visit_region(r: Region): ControlFlow<null> {
    return TypeVisitor_provided.visit_region(this, r);
  }
  visit_const(c: Const): ControlFlow<null> {
    return TypeVisitor_provided.visit_const(this, c);
  }
  visit_predicate<P>(p: P, d: PredicateProxy<P>): ControlFlow<null> {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }
  visit_clauses(c: Clauses): ControlFlow<null> {
    return TypeVisitor_provided.visit_clauses(this, c);
  }
  visit_error(guar: ErrorGuaranteed): ControlFlow<null> {
    return TypeVisitor_provided.visit_error(this, guar);
  }
}

// ---- helpers ---------------------------------------------------------------------------------------------------------

/**
 * PORT(wave 19): `error_reporting::TypeErrCtxt` is a `Pending` type (rustc_trait_selection decls.ts); these are the
 * methods this file calls on `FnCtxt::err_ctxt()`. Root drops the view when the errctxt contract lands.
 */
interface TypeErrCtxtView {
  // error_reporting/infer/need_type_info.rs `emit_inference_failure_err` (`TypeAnnotationNeeded::E0282` is `"E0282"`)
  emit_inference_failure_err(body_def_id: LocalDefId, failure_span: Span, term: Ty | Const, error_code: "E0282" | "E0283" | "E0284", should_label_span: boolean): Diag;
  // error_reporting/traits/fulfillment_errors.rs `report_fulfillment_errors`
  report_fulfillment_errors(errors: FulfillmentError[]): ErrorGuaranteed;
}
function err_ctxt(fcx: FnCtxt): TypeErrCtxtView {
  return fcx.err_ctxt() as unknown as TypeErrCtxtView;
}

/** `ControlFlow::is_break` */
function is_break<B>(r: ControlFlow<B>): boolean {
  return r.$ === "Break";
}

/** PORT: typeck_results.ts types `hidden_types` with a local `Pending` alias of `ty::DefinitionSiteHiddenType`. */
function hidden_types_of(r: TypeckResults): Map<LocalDefId, DefinitionSiteHiddenType> {
  return r.hidden_types as unknown as Map<LocalDefId, DefinitionSiteHiddenType>;
}
/** PORT: typeck_results.ts types `closure_size_eval` with a local `Pending` alias of `ty::ClosureSizeProfileData`. */
function closure_size_eval_of(r: TypeckResults): Map<LocalDefId, ClosureSizeProfileData> {
  return r.closure_size_eval as unknown as Map<LocalDefId, ClosureSizeProfileData>;
}

/** `assert_eq!(fcx_typeck_results.hir_owner, self.typeck_results.hir_owner)` */
function assert_owner_eq(a: TypeckResults, b: TypeckResults): void {
  assert(a.hir_owner.def_id === b.hir_owner.def_id, "assertion failed: `(left == right)`: fcx_typeck_results.hir_owner == self.typeck_results.hir_owner");
}

/** `UnordMap<LocalDefId, V>::to_sorted(hcx, _)`: the entries sorted by the keys' `DefPathHash` (their stable hash key). */
function to_sorted_by_def_path_hash<V>(tcx: TyCtxt, map: ReadonlyMap<LocalDefId, V>): [LocalDefId, V][] {
  const keyed = [...map].map(([def_id, v]) => [tcx.def_path_hash(LocalDefIdC.to_def_id(def_id)), def_id, v] as const);
  keyed.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return keyed.map(([, def_id, v]) => [def_id, v]);
}

/** The derived `TypeFoldable` of `Vec<Adjustment<'tcx>>`. */
function fold_Adjustments(): TypeFoldable<Adjustment[]> {
  return fold_Vec<Adjustment>({ visit_with: visit_with_Adjustment, try_fold_with: try_fold_with_Adjustment, fold_with: fold_with_Adjustment }) as TypeFoldable<Adjustment[]>;
}
/** The derived `TypeFoldable` of `Vec<PatAdjustment<'tcx>>`. */
function fold_PatAdjustments(): TypeFoldable<PatAdjustment[]> {
  return fold_Vec<PatAdjustment>({ visit_with: visit_with_PatAdjustment, try_fold_with: try_fold_with_PatAdjustment, fold_with: fold_with_PatAdjustment }) as TypeFoldable<PatAdjustment[]>;
}
/** The derived `TypeFoldable` of `ObligationCause<'tcx>`. */
function fold_ObligationCause(): TypeFoldable<ObligationCause> {
  return { visit_with: visit_with_ObligationCause, try_fold_with: try_fold_with_ObligationCause, fold_with: fold_with_ObligationCause };
}
/** `(ty::Predicate<'tcx>, ObligationCause<'tcx>)` */
function fold_Predicate_ObligationCause(): TypeFoldable<[Predicate, ObligationCause]> {
  return fold_tuple2(fold_Predicate, fold_ObligationCause());
}
/** The derived `TypeFoldable` of `OpaqueTypeKey<'tcx>`. */
const fold_OpaqueTypeKey: TypeFoldable<OpaqueTypeKey> = {
  visit_with: visit_with_OpaqueTypeKey,
  try_fold_with: try_fold_with_OpaqueTypeKey,
  fold_with: fold_with_OpaqueTypeKey,
};
/** `#[derive(TypeFoldable, TypeVisitable)] for ty::ProvisionalHiddenType` (rustc_middle ty/mod.rs): not generated. */
const fold_ProvisionalHiddenType: TypeFoldable<ProvisionalHiddenType> = {
  visit_with: () => unported("TypeVisitable for ty::ProvisionalHiddenType (tools/codegen)"),
  try_fold_with: () => unported("TypeFoldable for ty::ProvisionalHiddenType (tools/codegen)"),
  fold_with: () => unported("TypeFoldable for ty::ProvisionalHiddenType (tools/codegen)"),
};
/** `#[derive(TypeFoldable, TypeVisitable)] for ty::ClosureSizeProfileData` (rustc_middle ty/mod.rs): not generated. */
const fold_ClosureSizeProfileData: TypeFoldable<ClosureSizeProfileData> = {
  visit_with: () => unported("TypeVisitable for ty::ClosureSizeProfileData (tools/codegen)"),
  try_fold_with: () => unported("TypeFoldable for ty::ClosureSizeProfileData (tools/codegen)"),
  fold_with: () => unported("TypeFoldable for ty::ClosureSizeProfileData (tools/codegen)"),
};
/** `#[derive(TypeFoldable, TypeVisitable)] for ty::CapturedPlace` (rustc_middle ty/closure.rs; `hir::place::Place` pending). */
const fold_CapturedPlace: TypeFoldable<CapturedPlace> = {
  visit_with: () => unported("TypeVisitable for ty::CapturedPlace (rustc_middle hir/place.rs pending)"),
  try_fold_with: () => unported("TypeFoldable for ty::CapturedPlace (rustc_middle hir/place.rs pending)"),
  fold_with: () => unported("TypeFoldable for ty::CapturedPlace (rustc_middle hir/place.rs pending)"),
};
/** `#[derive(TypeFoldable, TypeVisitable)] for hir::place::Place` (rustc_middle hir/place.rs, pending). */
const fold_HirPlace: TypeFoldable<HirPlace> = {
  visit_with: () => unported("TypeVisitable for hir::place::Place (rustc_middle hir/place.rs pending)"),
  try_fold_with: () => unported("TypeFoldable for hir::place::Place (rustc_middle hir/place.rs pending)"),
  fold_with: () => unported("TypeFoldable for hir::place::Place (rustc_middle hir/place.rs pending)"),
};

