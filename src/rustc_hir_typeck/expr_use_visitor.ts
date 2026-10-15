// Port of compiler/rustc_hir_typeck/src/expr_use_visitor.rs (lane typeck-euv).
//
//! A different sort of visitor for walking fn bodies. Unlike the
//! normal visitor, which just walks the entire body in one shot, the
//! `ExprUseVisitor` determines how expressions are being used.
//!
//! In the compiler, this is only used for upvar inference and diagnostics, but there
//! are many uses within clippy.
//
// Representation (docs/handoff/fnctxt-contract.md "Representation" 3):
// - `trait Delegate` is decls.ts's `Delegate` interface; its provided `copy` / `bind` are `Delegate_provided`;
//   `impl Delegate for &mut D` is the class `DelegateMutRef` (callers pass the `D` itself: a `&mut D` is the object).
// - `trait TypeInformationCtxt` is decls.ts's `TypeInformationCtxtImpl<S>` (one impl block = one object of `this`-typed
//   methods) plus the trait-object class `TypeInformationCtxt` (`ExprUseVisitor`'s `cx`): `TypeInformationCtxt_FnCtxt`
//   (`impl for &FnCtxt`) and `TypeInformationCtxt_LateContext` (`impl for (&LateContext, LocalDefId)`).
// - `ExprUseVisitor<Cx, D>` (expr_use_visitor.gen.ts) is used as `ExprUseVisitor<TypeInformationCtxt, Delegate>`;
//   `delegate: RefCell<D>` is the delegate itself (`self.delegate.borrow_mut().f(..)` is `this.delegate.f(..)`).
// - `Cx::Error` is `ErrorGuaranteed` (decls.ts); `?` is `if (r.$ === "Err") return r;`.
// - `#[instrument]` / `debug!` / `trace!` are tracing only and not ported.
// - PORT: the `Place` moves of `cat_projection` / `cat_deref` (`let mut projections = base_place.place.projections;
//   projections.push(..)`) copy the vector before pushing: the moved-from place is unobservable in Rust, but a TS caller
//   (or a delegate that kept the reference) still holds it.
// - PORT(decls): `HirPlace` (rustc_middle ty/decls.ts, the type of `TypeckResults::closure_fake_reads` and
//   `CapturedPlace::place`) is still `Pending`: `as_place` casts it to rustc_middle hir/place.ts's `Place` (same shape).
// Init order: top-level code here touches only ./decls.ts, this file's .gen.ts and other crates.
export * from "./expr_use_visitor.gen.ts";
// Export these here so that Clippy can use them.
export { Place, PlaceBase, PlaceWithHirId } from "../rustc_middle/hir/place.ts";
export type { Projection } from "../rustc_middle/hir/place.ts";
import { type Mutability, Pinnedness } from "../rustc_ast_ir/lib.ts";
import { debug_Res, type Res } from "../rustc_hir/def.ts";
import * as hir from "../rustc_hir/lib.ts";
import { debug_HirId, type HirId } from "../rustc_hir_id/lib.ts";
import type { LateContext } from "../rustc_lint/context.ts";
import { clone_Place, clone_PlaceWithHirId, debug_PlaceBase, Place, PlaceBase, PlaceWithHirId, type Projection, ProjectionKind } from "../rustc_middle/hir/place.ts";
import { type Adjustment, type AutoBorrow, Mutability_from_AutoBorrowMutability } from "../rustc_middle/ty/adjustment.ts";
import { BorrowKind, UpvarId } from "../rustc_middle/ty/closure.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { FieldIdx, HirPlace, VariantIdx } from "../rustc_middle/ty/decls.ts";
import { Ty } from "../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import type { FakeReadCause, TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import { bug, span_bug } from "../rustc_span/macros.ts";
import type { TypeFoldable } from "../rustc_type_ir/fold.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import { PLAIN } from "../std/fmt.ts";
import { unwrap } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { type Delegate, type FnCtxt, TypeInformationCtxt, type TypeInformationCtxtImpl } from "./decls.ts";
import { ExprUseVisitor } from "./expr_use_visitor.gen.ts";

/** `rustc_abi::FIRST_VARIANT` (`VariantIdx::ZERO`). PORT: local, as in rustc_middle ty/adt.ts. */
const FIRST_VARIANT = 0 as VariantIdx;

/** PORT(decls): `HirPlace` is `Pending` in rustc_middle ty/decls.ts; its values are hir/place.ts `Place`s. */
function as_place(p: HirPlace): Place {
  return p as unknown as Place;
}

/** The `ExprUseVisitor` every method below runs on (`Cx: TypeInformationCtxt`, `D: Delegate`). */
type Euv = ExprUseVisitor<TypeInformationCtxt, Delegate>;

/// This trait defines the callbacks you can expect to receive when
/// employing the ExprUseVisitor.
// rustc-trait: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:37 Delegate
// PORT: the trait is declared in ./decls.ts (root-owned, without markers). Its methods are restated here, in upstream
// order, with their markers (merge-w16a decision for HirTyLowererImpl); the signatures are identical to decls.ts's.
declare module "./decls.ts" {
  interface Delegate {
    /// The value found at `place` is moved, depending
    /// on `mode`. Where `diag_expr_id` is the id used for diagnostics for `place`.
    ///
    /// If the value is `Copy`, [`copy`][Self::copy] is called instead, which
    /// by default falls back to [`borrow`][Self::borrow].
    ///
    /// The parameter `diag_expr_id` indicates the HIR id that ought to be used for
    /// diagnostics. Around pattern matching such as `let pat = expr`, the diagnostic
    /// id will be the id of the expression `expr` but the place itself will have
    /// the id of the binding in the pattern `pat`.
    // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:48 consume
    consume(place_with_id: PlaceWithHirId, diag_expr_id: HirId): void;

    /// The value found at `place` is used, depending
    /// on `mode`. Where `diag_expr_id` is the id used for diagnostics for `place`.
    ///
    /// Use of a `Copy` type in a ByUse context is considered a use
    /// by `ImmBorrow` and `borrow` is called instead. This is because
    /// a shared borrow is the "minimum access" that would be needed
    /// to perform a copy.
    ///
    ///
    /// The parameter `diag_expr_id` indicates the HIR id that ought to be used for
    /// diagnostics. Around pattern matching such as `let pat = expr`, the diagnostic
    /// id will be the id of the expression `expr` but the place itself will have
    /// the id of the binding in the pattern `pat`.
    // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:63 use_cloned
    use_cloned(place_with_id: PlaceWithHirId, diag_expr_id: HirId): void;

    /// The value found at `place` is being borrowed with kind `bk`.
    /// `diag_expr_id` is the id used for diagnostics (see `consume` for more details).
    // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:67 borrow
    borrow(place_with_id: PlaceWithHirId, diag_expr_id: HirId, bk: BorrowKind): void;

    /// The value found at `place` is being copied.
    /// `diag_expr_id` is the id used for diagnostics (see `consume` for more details).
    ///
    /// If an implementation is not provided, use of a `Copy` type in a ByValue context is instead
    /// considered a use by `ImmBorrow` and `borrow` is called instead. This is because a shared
    /// borrow is the "minimum access" that would be needed to perform a copy.
    // (provided: `Delegate_provided.copy`, expr_use_visitor.rs:80)
    copy(place_with_id: PlaceWithHirId, diag_expr_id: HirId): void;

    /// The path at `assignee_place` is being assigned to.
    /// `diag_expr_id` is the id used for diagnostics (see `consume` for more details).
    // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:88 mutate
    mutate(assignee_place: PlaceWithHirId, diag_expr_id: HirId): void;

    /// The path at `binding_place` is a binding that is being initialized.
    ///
    /// This covers cases such as `let x = 42;`
    // (provided: `Delegate_provided.bind`, expr_use_visitor.rs:93)
    bind(binding_place: PlaceWithHirId, diag_expr_id: HirId): void;

    /// The `place` should be a fake read because of specified `cause`.
    // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:100 fake_read
    fake_read(place_with_id: PlaceWithHirId, cause: FakeReadCause, diag_expr_id: HirId): void;
  }
}

/** The provided methods of `trait Delegate` (expr_use_visitor.rs:80 `copy`, :93 `bind`), `self_` first (decls.ts `Delegate`). */
export const Delegate_provided = {
  // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:80 copy
  copy(self_: Delegate, place_with_id: PlaceWithHirId, diag_expr_id: HirId): void {
    // In most cases, copying data from `x` is equivalent to doing `*&x`, so by default
    // we treat a copy of `x` as a borrow of `x`.
    self_.borrow(place_with_id, diag_expr_id, BorrowKind.Immutable);
  },

  // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:93 bind
  bind(self_: Delegate, binding_place: PlaceWithHirId, diag_expr_id: HirId): void {
    // Bindings can normally be treated as a regular assignment, so by default we
    // forward this to the mutate callback.
    self_.mutate(binding_place, diag_expr_id);
  },
};

/**
 * `impl<'tcx, D: Delegate<'tcx>> Delegate<'tcx> for &mut D` (expr_use_visitor.rs:108). PORT: a `&mut D` is the `D`
 * object itself, so callers pass the delegate directly (decls.ts `Delegate`); this forwarding wrapper is the literal
 * impl, for code that wants an explicit `&mut D` value.
 */
export class DelegateMutRef implements Delegate {
  constructor(public _0: Delegate) {}

  // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:109 consume
  consume(place_with_id: PlaceWithHirId, diag_expr_id: HirId): void {
    this._0.consume(place_with_id, diag_expr_id);
  }

  // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:113 use_cloned
  use_cloned(place_with_id: PlaceWithHirId, diag_expr_id: HirId): void {
    this._0.use_cloned(place_with_id, diag_expr_id);
  }

  // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:117 borrow
  borrow(place_with_id: PlaceWithHirId, diag_expr_id: HirId, bk: BorrowKind): void {
    this._0.borrow(place_with_id, diag_expr_id, bk);
  }

  // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:126 copy
  copy(place_with_id: PlaceWithHirId, diag_expr_id: HirId): void {
    this._0.copy(place_with_id, diag_expr_id);
  }

  // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:130 mutate
  mutate(assignee_place: PlaceWithHirId, diag_expr_id: HirId): void {
    this._0.mutate(assignee_place, diag_expr_id);
  }

  // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:134 bind
  bind(binding_place: PlaceWithHirId, diag_expr_id: HirId): void {
    this._0.bind(binding_place, diag_expr_id);
  }

  // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:138 fake_read
  fake_read(place_with_id: PlaceWithHirId, cause: FakeReadCause, diag_expr_id: HirId): void {
    this._0.fake_read(place_with_id, cause, diag_expr_id);
  }
}

/// This trait makes `ExprUseVisitor` usable with both [`FnCtxt`]
/// and [`LateContext`], depending on where in the compiler it is used.
// rustc-trait: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:150 TypeInformationCtxt
// PORT: declared in ./decls.ts as `TypeInformationCtxtImpl<S>`; restated here with the markers (see `Delegate` above).
// `type TypeckResults<'a>` is `TypeckResults`; `type Error` is `ErrorGuaranteed`.
declare module "./decls.ts" {
  interface TypeInformationCtxtImpl<S> {
    // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:157 typeck_results
    typeck_results(this: S): TypeckResults;

    // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:159 deeply_resolve_ignoring_regions
    deeply_resolve_ignoring_regions<T>(this: S, t: T, d_T: TypeFoldable<T>): T;

    // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:161 structurally_resolve_type
    structurally_resolve_type(this: S, span: Span, ty: Ty): Ty;

    // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:163 report_bug
    report_bug(this: S, span: Span, msg: string): ErrorGuaranteed;

    // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:165 error_reported_in_ty
    error_reported_in_ty(this: S, ty: Ty): Result<undefined, ErrorGuaranteed>;

    // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:167 tainted_by_errors
    tainted_by_errors(this: S): Result<undefined, ErrorGuaranteed>;

    // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:169 type_is_copy_modulo_regions
    type_is_copy_modulo_regions(this: S, ty: Ty): boolean;

    // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:171 type_is_use_cloned_modulo_regions
    type_is_use_cloned_modulo_regions(this: S, ty: Ty): boolean;

    // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:173 body_owner_def_id
    body_owner_def_id(this: S): LocalDefId;

    // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:175 tcx
    tcx(this: S): TyCtxt;
  }
}

/** expr_use_visitor.rs:178 `impl<'tcx> TypeInformationCtxt<'tcx> for &FnCtxt<'_, 'tcx>` (`type Error = ErrorGuaranteed`). */
export const TypeInformationCtxt_FnCtxt: TypeInformationCtxtImpl<FnCtxt> = {
  // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:186 typeck_results
  typeck_results(this: FnCtxt): TypeckResults {
    return this.typeck_results;
  },

  // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:190 deeply_resolve_ignoring_regions
  deeply_resolve_ignoring_regions<T>(this: FnCtxt, t: T, d_T: TypeFoldable<T>): T {
    return this.infcx.deeply_resolve_ignoring_regions(t, d_T);
  },

  // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:194 structurally_resolve_type
  structurally_resolve_type(this: FnCtxt, sp: Span, ty: Ty): Ty {
    return this.structurally_resolve_type(sp, ty);
  },

  // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:198 report_bug
  report_bug(this: FnCtxt, span: Span, msg: string): ErrorGuaranteed {
    return this.dcx().span_delayed_bug(span, msg);
  },

  // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:202 error_reported_in_ty
  error_reported_in_ty(this: FnCtxt, ty: Ty): Result<undefined, ErrorGuaranteed> {
    const r = TypeVisitableExt.error_reported(ty, fold_Ty);
    if (r.$ === "Err") return r;
    return Ok(undefined);
  },

  // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:206 tainted_by_errors
  tainted_by_errors(this: FnCtxt): Result<undefined, ErrorGuaranteed> {
    const guar = this.infcx.tainted_by_errors();
    if (guar !== undefined) {
      return Err(guar);
    } else {
      return Ok(undefined);
    }
  },

  // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:210 type_is_copy_modulo_regions
  type_is_copy_modulo_regions(this: FnCtxt, ty: Ty): boolean {
    return this.infcx.type_is_copy_modulo_regions(this.param_env, ty);
  },

  // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:214 type_is_use_cloned_modulo_regions
  type_is_use_cloned_modulo_regions(this: FnCtxt, ty: Ty): boolean {
    return this.infcx.type_is_use_cloned_modulo_regions(this.param_env, ty);
  },

  // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:218 body_owner_def_id
  body_owner_def_id(this: FnCtxt): LocalDefId {
    return this.body_def_id;
  },

  // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:222 tcx
  tcx(this: FnCtxt): TyCtxt {
    return this.tcx;
  },
};

/**
 * expr_use_visitor.rs:227 `impl<'tcx> TypeInformationCtxt<'tcx> for (&LateContext<'tcx>, LocalDefId)` (`type Error = !`:
 * its methods never return an error).
 */
export const TypeInformationCtxt_LateContext: TypeInformationCtxtImpl<[LateContext, LocalDefId]> = {
  // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:235 typeck_results
  typeck_results(this: [LateContext, LocalDefId]): TypeckResults {
    // PORT: `LateContext::typeck_results` is `typeck_results_` in rustc_lint (the field shares the name).
    return this[0].typeck_results_() as TypeckResults;
  },

  // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:239 structurally_resolve_type
  structurally_resolve_type(this: [LateContext, LocalDefId], _span: Span, ty: Ty): Ty {
    // FIXME: Maybe need to normalize here.
    return ty;
  },

  // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:244 deeply_resolve_ignoring_regions
  deeply_resolve_ignoring_regions<T>(this: [LateContext, LocalDefId], t: T, _d_T: TypeFoldable<T>): T {
    return t;
  },

  // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:248 report_bug
  report_bug(this: [LateContext, LocalDefId], span: Span, msg: string): ErrorGuaranteed {
    return span_bug(span, msg);
  },

  // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:252 error_reported_in_ty
  error_reported_in_ty(this: [LateContext, LocalDefId], _ty: Ty): Result<undefined, ErrorGuaranteed> {
    return Ok(undefined);
  },

  // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:256 tainted_by_errors
  tainted_by_errors(this: [LateContext, LocalDefId]): Result<undefined, ErrorGuaranteed> {
    return Ok(undefined);
  },

  // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:260 type_is_copy_modulo_regions
  type_is_copy_modulo_regions(this: [LateContext, LocalDefId], ty: Ty): boolean {
    return this[0].type_is_copy_modulo_regions(ty);
  },

  // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:264 type_is_use_cloned_modulo_regions
  type_is_use_cloned_modulo_regions(this: [LateContext, LocalDefId], ty: Ty): boolean {
    return this[0].type_is_use_cloned_modulo_regions(ty);
  },

  // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:268 body_owner_def_id
  body_owner_def_id(this: [LateContext, LocalDefId]): LocalDefId {
    return this[1];
  },

  // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:272 tcx
  tcx(this: [LateContext, LocalDefId]): TyCtxt {
    return this[0].tcx;
  },
};

// ---- impl<'a, 'tcx, D: Delegate<'tcx>> ExprUseVisitor<'tcx, (&'a LateContext<'tcx>, LocalDefId), D> (:288) ----

// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:289 for_clippy
(ExprUseVisitor as unknown as { for_clippy: typeof ExprUseVisitor.for_clippy }).for_clippy = function <Cx, D>(cx: LateContext, body_def_id: LocalDefId, delegate: D): ExprUseVisitor<Cx, D> {
  const tcx_cx = TypeInformationCtxt.of<[LateContext, LocalDefId]>([cx, body_def_id], TypeInformationCtxt_LateContext);
  return ExprUseVisitor.new(tcx_cx as unknown as Cx, delegate);
};

// ---- impl<'tcx, Cx: TypeInformationCtxt<'tcx>, D: Delegate<'tcx>> ExprUseVisitor<'tcx, Cx, D> (:294) ----

/// Creates the ExprUseVisitor, configuring it with the various options provided:
///
/// - `delegate` -- who receives the callbacks
/// - `param_env` --- parameter environment for trait lookups (esp. pertaining to `Copy`)
/// - `typeck_results` --- typeck results for the code being analyzed
// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:300 new
(ExprUseVisitor as unknown as { new: typeof ExprUseVisitor.new }).new = function <Cx, D>(cx: Cx, delegate: D): ExprUseVisitor<Cx, D> {
  // PORT: `Cx` is always the trait object `TypeInformationCtxt` (module comment).
  const cx_ = cx as unknown as TypeInformationCtxt;
  // PORT: the query value is `Option<&FxIndexMap<HirId, hir::Upvar>>` (`Map<HirId, unknown>` in queries.gen.ts).
  const upvars = cx_.tcx().upvars_mentioned(cx_.body_owner_def_id()) as Map<HirId, hir.Upvar> | undefined;
  return new ExprUseVisitor(cx, delegate, upvars);
};

// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:308 consume_body
ExprUseVisitor.prototype.consume_body = function (this: Euv, body: hir.Body): Result<undefined, ErrorGuaranteed> {
  for (const param of body.params) {
    const param_ty = this.pat_ty_adjusted(param.pat);
    if (param_ty.$ === "Err") return param_ty;

    const param_place = this.cat_rvalue(param.hir_id, param_ty._0);

    let r = this.fake_read_scrutinee(param_place, false);
    if (r.$ === "Err") return r;
    r = this.walk_pat(param_place, param.pat, false);
    if (r.$ === "Err") return r;
  }

  const r = this.consume_expr(body.value);
  if (r.$ === "Err") return r;

  return Ok(undefined);
};

// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:325 consume_or_copy
ExprUseVisitor.prototype.consume_or_copy = function (this: Euv, place_with_id: PlaceWithHirId, diag_expr_id: HirId): void {
  if (this.cx.type_is_copy_modulo_regions(place_with_id.place.ty())) {
    this.delegate.copy(place_with_id, diag_expr_id);
  } else {
    this.delegate.consume(place_with_id, diag_expr_id);
  }
};

// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:334 consume_clone_or_copy
ExprUseVisitor.prototype.consume_clone_or_copy = function (this: Euv, place_with_id: PlaceWithHirId, diag_expr_id: HirId): void {
  // `x.use` will do one of the following
  // * if it implements `Copy`, it will be a copy
  // * if it implements `UseCloned`, it will be a call to `clone`
  // * otherwise, it is a move
  //
  // we do a conservative approximation of this, treating it as a move unless we know that it implements copy or `UseCloned`
  if (this.cx.type_is_copy_modulo_regions(place_with_id.place.ty())) {
    this.delegate.copy(place_with_id, diag_expr_id);
  } else if (this.cx.type_is_use_cloned_modulo_regions(place_with_id.place.ty())) {
    this.delegate.use_cloned(place_with_id, diag_expr_id);
  } else {
    this.delegate.consume(place_with_id, diag_expr_id);
  }
};

// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:350 consume_exprs
ExprUseVisitor.prototype.consume_exprs = function (this: Euv, exprs: readonly hir.Expr[]): Result<undefined, ErrorGuaranteed> {
  for (const expr of exprs) {
    const r = this.consume_expr(expr);
    if (r.$ === "Err") return r;
  }

  return Ok(undefined);
};

// FIXME: It's suspicious that this is public; clippy should probably use `walk_expr`.
// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:360 consume_expr
ExprUseVisitor.prototype.consume_expr = function (this: Euv, expr: hir.Expr): Result<undefined, ErrorGuaranteed> {
  const place_with_id = this.cat_expr(expr);
  if (place_with_id.$ === "Err") return place_with_id;
  this.consume_or_copy(place_with_id._0, place_with_id._0.hir_id);
  const r = this.walk_expr(expr);
  if (r.$ === "Err") return r;
  return Ok(undefined);
};

// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:368 consume_or_clone_expr
ExprUseVisitor.prototype.consume_or_clone_expr = function (this: Euv, expr: hir.Expr): Result<undefined, ErrorGuaranteed> {
  const place_with_id = this.cat_expr(expr);
  if (place_with_id.$ === "Err") return place_with_id;
  this.consume_clone_or_copy(place_with_id._0, place_with_id._0.hir_id);
  const r = this.walk_expr(expr);
  if (r.$ === "Err") return r;
  return Ok(undefined);
};

// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:375 mutate_expr
ExprUseVisitor.prototype.mutate_expr = function (this: Euv, expr: hir.Expr): Result<undefined, ErrorGuaranteed> {
  const place_with_id = this.cat_expr(expr);
  if (place_with_id.$ === "Err") return place_with_id;
  this.delegate.mutate(place_with_id._0, place_with_id._0.hir_id);
  const r = this.walk_expr(expr);
  if (r.$ === "Err") return r;
  return Ok(undefined);
};

// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:383 borrow_expr
ExprUseVisitor.prototype.borrow_expr = function (this: Euv, expr: hir.Expr, bk: BorrowKind): Result<undefined, ErrorGuaranteed> {
  const place_with_id = this.cat_expr(expr);
  if (place_with_id.$ === "Err") return place_with_id;
  this.delegate.borrow(place_with_id._0, place_with_id._0.hir_id, bk);
  return this.walk_expr(expr);
};

// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:390 walk_expr
ExprUseVisitor.prototype.walk_expr = function (this: Euv, expr: hir.Expr): Result<undefined, ErrorGuaranteed> {
  let r = this.walk_adjustment(expr);
  if (r.$ === "Err") return r;

  const kind = expr.kind;
  switch (kind.$) {
    case "Path":
      break;

    case "Type": {
      const subexpr = kind._0;
      r = this.walk_expr(subexpr);
      if (r.$ === "Err") return r;
      break;
    }

    case "UnsafeBinderCast": {
      const subexpr = kind._1;
      r = this.walk_expr(subexpr);
      if (r.$ === "Err") return r;
      break;
    }

    case "Unary": {
      if (kind._0 === "Deref") {
        // *base
        const base = kind._1;
        r = this.walk_expr(base);
        if (r.$ === "Err") return r;
      } else {
        const lhs = kind._1;
        r = this.consume_expr(lhs);
        if (r.$ === "Err") return r;
      }
      break;
    }

    case "Field": {
      // base.f
      const base = kind._0;
      r = this.walk_expr(base);
      if (r.$ === "Err") return r;
      break;
    }

    case "Index": {
      // lhs[rhs]
      const lhs = kind._0;
      const rhs = kind._1;
      r = this.walk_expr(lhs);
      if (r.$ === "Err") return r;
      r = this.consume_expr(rhs);
      if (r.$ === "Err") return r;
      break;
    }

    case "Call": {
      // callee(args)
      const callee = kind._0;
      const args = kind._1;
      r = this.consume_expr(callee);
      if (r.$ === "Err") return r;
      r = this.consume_exprs(args);
      if (r.$ === "Err") return r;
      break;
    }

    case "Use": {
      const expr_ = kind._0;
      r = this.consume_or_clone_expr(expr_);
      if (r.$ === "Err") return r;
      break;
    }

    case "MethodCall": {
      // callee.m(args)
      const receiver = kind._1;
      const args = kind._2;
      r = this.consume_expr(receiver);
      if (r.$ === "Err") return r;
      r = this.consume_exprs(args);
      if (r.$ === "Err") return r;
      break;
    }

    case "Struct": {
      const fields = kind._1;
      const opt_with = kind._2;
      r = this.walk_struct_expr(fields, opt_with);
      if (r.$ === "Err") return r;
      break;
    }

    case "Tup": {
      const exprs = kind._0;
      r = this.consume_exprs(exprs);
      if (r.$ === "Err") return r;
      break;
    }

    case "If": {
      const cond_expr = kind._0;
      const then_expr = kind._1;
      const opt_else_expr = kind._2;
      r = this.consume_expr(cond_expr);
      if (r.$ === "Err") return r;
      r = this.consume_expr(then_expr);
      if (r.$ === "Err") return r;
      if (opt_else_expr !== undefined) {
        const else_expr = opt_else_expr;
        r = this.consume_expr(else_expr);
        if (r.$ === "Err") return r;
      }
      break;
    }

    case "Let": {
      const { pat, init } = kind._0;
      r = this.walk_local(init, pat, undefined);
      if (r.$ === "Err") return r;
      break;
    }

    case "Match": {
      const discr = kind._0;
      const arms = kind._1;
      const discr_place = this.cat_expr(discr);
      if (discr_place.$ === "Err") return discr_place;
      r = this.fake_read_scrutinee(discr_place._0, true);
      if (r.$ === "Err") return r;
      r = this.walk_expr(discr);
      if (r.$ === "Err") return r;

      for (const arm of arms) {
        r = this.walk_arm(discr_place._0, arm);
        if (r.$ === "Err") return r;
      }
      break;
    }

    case "Array": {
      const exprs = kind._0;
      r = this.consume_exprs(exprs);
      if (r.$ === "Err") return r;
      break;
    }

    case "AddrOf": {
      // &base
      // make sure that the thing we are pointing out stays valid
      // for the lifetime `scope_r` of the resulting ptr:
      const m = kind._1;
      const base = kind._2;
      const bk = BorrowKind.from_mutbl(m);
      r = this.borrow_expr(base, bk);
      if (r.$ === "Err") return r;
      break;
    }

    case "InlineAsm": {
      const asm = kind._0;
      for (const [op, _op_sp] of asm.operands) {
        switch (op.$) {
          case "In": {
            r = this.consume_expr(op.expr);
            if (r.$ === "Err") return r;
            break;
          }
          case "Out":
          case "InOut": {
            if (op.expr !== undefined) {
              r = this.mutate_expr(op.expr);
              if (r.$ === "Err") return r;
            }
            break;
          }
          case "SplitInOut": {
            r = this.consume_expr(op.in_expr);
            if (r.$ === "Err") return r;
            if (op.out_expr !== undefined) {
              const out_expr = op.out_expr;
              r = this.mutate_expr(out_expr);
              if (r.$ === "Err") return r;
            }
            break;
          }
          case "Const":
          case "SymFn":
          case "SymStatic":
            break;
          case "Label": {
            r = this.walk_block(op.block);
            if (r.$ === "Err") return r;
            break;
          }
        }
      }
      break;
    }

    case "Continue":
    case "Lit":
    case "ConstBlock":
    case "OffsetOf":
    case "Err":
      break;

    case "Loop": {
      const blk = kind._0;
      r = this.walk_block(blk);
      if (r.$ === "Err") return r;
      break;
    }

    case "Binary": {
      const lhs = kind._1;
      const rhs = kind._2;
      r = this.consume_expr(lhs);
      if (r.$ === "Err") return r;
      r = this.consume_expr(rhs);
      if (r.$ === "Err") return r;
      break;
    }

    case "Block": {
      const blk = kind._0;
      r = this.walk_block(blk);
      if (r.$ === "Err") return r;
      break;
    }

    case "Break":
    case "Ret": {
      const opt_expr = kind.$ === "Break" ? kind._1 : kind._0;
      if (opt_expr !== undefined) {
        const expr_ = opt_expr;
        r = this.consume_expr(expr_);
        if (r.$ === "Err") return r;
      }
      break;
    }

    case "Become": {
      const call = kind._0;
      r = this.consume_expr(call);
      if (r.$ === "Err") return r;
      break;
    }

    case "Assign": {
      const lhs = kind._0;
      const rhs = kind._1;
      r = this.mutate_expr(lhs);
      if (r.$ === "Err") return r;
      r = this.consume_expr(rhs);
      if (r.$ === "Err") return r;
      break;
    }

    case "Cast": {
      const base = kind._0;
      r = this.consume_expr(base);
      if (r.$ === "Err") return r;
      break;
    }

    case "DropTemps": {
      const expr_ = kind._0;
      r = this.consume_expr(expr_);
      if (r.$ === "Err") return r;
      break;
    }

    case "AssignOp": {
      const lhs = kind._1;
      const rhs = kind._2;
      if (this.cx.typeck_results().is_method_call(expr)) {
        r = this.consume_expr(lhs);
        if (r.$ === "Err") return r;
      } else {
        r = this.mutate_expr(lhs);
        if (r.$ === "Err") return r;
      }
      r = this.consume_expr(rhs);
      if (r.$ === "Err") return r;
      break;
    }

    case "Repeat": {
      const base = kind._0;
      r = this.consume_expr(base);
      if (r.$ === "Err") return r;
      break;
    }

    case "Closure": {
      const closure = kind._0;
      r = this.walk_captures(closure);
      if (r.$ === "Err") return r;
      break;
    }

    case "Yield": {
      const value = kind._0;
      r = this.consume_expr(value);
      if (r.$ === "Err") return r;
      break;
    }
  }

  return Ok(undefined);
};

// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:576 walk_stmt
ExprUseVisitor.prototype.walk_stmt = function (this: Euv, stmt: hir.Stmt): Result<undefined, ErrorGuaranteed> {
  const kind = stmt.kind;
  switch (kind.$) {
    case "Let": {
      const { pat, init, els } = kind._0;
      if (init !== undefined) {
        const expr = init;
        const r = this.walk_local(expr, pat, els);
        if (r.$ === "Err") return r;
      }
      break;
    }

    case "Item":
      // We don't visit nested items in this visitor,
      // only the fn body we were given.
      break;

    case "Expr":
    case "Semi": {
      const expr = kind._0;
      const r = this.consume_expr(expr);
      if (r.$ === "Err") return r;
      break;
    }
  }

  return Ok(undefined);
};

// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:598 fake_read_scrutinee
ExprUseVisitor.prototype.fake_read_scrutinee = function (this: Euv, discr_place: PlaceWithHirId, refutable: boolean): Result<undefined, ErrorGuaranteed> {
  const base = discr_place.place.base;
  const closure_def_id = base.$ === "Upvar" ? base._0.closure_expr_id : undefined;

  // PORT: `mir::FakeReadCause` (mir/syntax.rs) is `PendingEnum` in typeck_results.ts: built per PORTING §5
  // (`ForMatchedPlace(Option<LocalDefId>)`, `ForLet(Option<LocalDefId>)`).
  const cause: FakeReadCause = refutable ? { $: "ForMatchedPlace", _0: closure_def_id } : { $: "ForLet", _0: closure_def_id };

  this.delegate.fake_read(discr_place, cause, discr_place.hir_id);

  return Ok(undefined);
};

// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:619 walk_local
ExprUseVisitor.prototype.walk_local = function (this: Euv, expr: hir.Expr, pat: hir.Pat, els: hir.Block | undefined): Result<undefined, ErrorGuaranteed> {
  let r = this.walk_expr(expr);
  if (r.$ === "Err") return r;
  const expr_place = this.cat_expr(expr);
  if (expr_place.$ === "Err") return expr_place;
  r = this.fake_read_scrutinee(expr_place._0, els !== undefined);
  if (r.$ === "Err") return r;
  r = this.walk_pat(expr_place._0, pat, false);
  if (r.$ === "Err") return r;
  if (els !== undefined) {
    r = this.walk_block(els);
    if (r.$ === "Err") return r;
  }
  return Ok(undefined);
};

/// Indicates that the value of `blk` will be consumed, meaning either copied or moved
/// depending on its type.
// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:638 walk_block
ExprUseVisitor.prototype.walk_block = function (this: Euv, blk: hir.Block): Result<undefined, ErrorGuaranteed> {
  for (const stmt of blk.stmts) {
    const r = this.walk_stmt(stmt);
    if (r.$ === "Err") return r;
  }

  if (blk.expr !== undefined) {
    const tail_expr = blk.expr;
    const r = this.consume_expr(tail_expr);
    if (r.$ === "Err") return r;
  }

  return Ok(undefined);
};

// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:650 walk_struct_expr
ExprUseVisitor.prototype.walk_struct_expr = function (this: Euv, fields: readonly hir.ExprField[], opt_with: hir.StructTailExpr): Result<undefined, ErrorGuaranteed> {
  // Consume the expressions supplying values for each field.
  for (const field of fields) {
    const r = this.consume_expr(field.expr);
    if (r.$ === "Err") return r;

    // The struct path probably didn't resolve
    if (this.cx.typeck_results().opt_field_index(field.hir_id) === undefined) {
      this.cx.tcx().dcx().span_delayed_bug(field.span, "couldn't resolve index for field");
    }
  }

  let with_expr: hir.Expr;
  switch (opt_with.$) {
    case "Base":
      with_expr = opt_with._0;
      break;
    case "DefaultFields":
    case "None":
    case "NoneWithError":
      return Ok(undefined);
  }

  const with_place_r = this.cat_expr(with_expr);
  if (with_place_r.$ === "Err") return with_place_r;
  const with_place = with_place_r._0;

  // Select just those fields of the `with`
  // expression that will actually be used
  const kind = this.cx.structurally_resolve_type(with_expr.span, with_place.place.ty()).kind();
  if (kind.$ === "Adt" && kind._0.is_struct()) {
    const adt = kind._0;
    const args = kind._1;
    // Consume those fields of the with expression that are needed.
    const with_fields = adt.non_enum_variant().fields;
    for (let i = 0; i < with_fields.length; i++) {
      const f_index = i as FieldIdx;
      const with_field = with_fields[i]!;
      const is_mentioned = fields.some((f) => this.cx.typeck_results().opt_field_index(f.hir_id) === f_index);
      if (!is_mentioned) {
        const field_place = this.cat_projection(
          with_expr.hir_id,
          clone_PlaceWithHirId(with_place),
          Unnormalized.skip_norm_wip(with_field.ty(this.cx.tcx(), args)),
          { $: "Field", _0: f_index, _1: FIRST_VARIANT },
        );
        this.consume_or_copy(field_place, field_place.hir_id);
      }
    }
  } else {
    // the base expression should always evaluate to a
    // struct; however, when EUV is run during typeck, it
    // may not. This will generate an error earlier in typeck,
    // so we can just ignore it.
    if (this.cx.tainted_by_errors().$ === "Ok") {
      span_bug(with_expr.span, "with expression doesn't evaluate to a struct");
    }
  }

  // walk the with expression so that complex expressions
  // are properly handled.
  const r = this.walk_expr(with_expr);
  if (r.$ === "Err") return r;

  return Ok(undefined);
};

/// Invoke the appropriate delegate calls for anything that gets
/// consumed or borrowed as part of the automatic adjustment
/// process.
// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:720 walk_adjustment
ExprUseVisitor.prototype.walk_adjustment = function (this: Euv, expr: hir.Expr): Result<undefined, ErrorGuaranteed> {
  const typeck_results = this.cx.typeck_results();
  const adjustments = typeck_results.expr_adjustments(expr);
  const place_with_id_r = this.cat_expr_unadjusted(expr);
  if (place_with_id_r.$ === "Err") return place_with_id_r;
  let place_with_id = place_with_id_r._0;
  for (let adjustment_index = 0; adjustment_index < adjustments.length; adjustment_index++) {
    const adjustment = adjustments[adjustment_index]!;
    const is_last_adjustment = adjustment_index + 1 === adjustments.length;
    const kind = adjustment.kind;
    switch (kind.$) {
      case "NeverToAny":
      case "Pointer":
        // Creating a closure/fn-pointer or unsizing consumes
        // the input and stores it into the resulting rvalue.
        this.consume_or_copy(place_with_id, place_with_id.hir_id);
        break;

      case "Deref": {
        const deref_kind = kind._0;
        if (deref_kind.$ === "Builtin" || deref_kind.$ === "Pin") {
          break;
        }

        // Autoderefs for overloaded Deref calls in fact reference
        // their receiver. That is, if we have `(*x)` where `x`
        // is of type `Rc<T>`, then this in fact is equivalent to
        // `x.deref()`. Since `deref()` is declared with `&self`,
        // this is an autoref of `x`.
        const deref = deref_kind._0;
        const bk = BorrowKind.from_mutbl(deref.mutbl);
        this.delegate.borrow(place_with_id, place_with_id.hir_id, bk);
        break;
      }

      case "Borrow": {
        const autoref = kind._0;
        this.walk_autoref(expr, place_with_id, autoref);
        break;
      }

      case "GenericReborrow": {
        if (is_last_adjustment) {
          const mutability = kind._0;
          const bk = BorrowKind.from_mutbl(mutability);
          this.delegate.borrow(place_with_id, place_with_id.hir_id, bk);
        } else {
          span_bug(expr.span, "generic reborrow adjustment must be terminal");
        }
        break;
      }
    }
    const next = this.cat_expr_adjusted(expr, place_with_id, adjustment);
    if (next.$ === "Err") return next;
    place_with_id = next._0;
  }

  return Ok(undefined);
};

/// Walks the autoref `autoref` applied to the autoderef'd
/// `expr`. `base_place` is `expr` represented as a place,
/// after all relevant autoderefs have occurred.
// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:768 walk_autoref
ExprUseVisitor.prototype.walk_autoref = function (this: Euv, _expr: hir.Expr, base_place: PlaceWithHirId, autoref: AutoBorrow): void {
  switch (autoref.$) {
    case "Ref": {
      const m = autoref._0;
      this.delegate.borrow(base_place, base_place.hir_id, BorrowKind.from_mutbl(Mutability_from_AutoBorrowMutability(m)));
      break;
    }

    case "RawPtr":
    case "Pin": {
      const m = autoref._0;
      this.delegate.borrow(base_place, base_place.hir_id, BorrowKind.from_mutbl(m));
      break;
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:800 walk_arm
ExprUseVisitor.prototype.walk_arm = function (this: Euv, discr_place: PlaceWithHirId, arm: hir.Arm): Result<undefined, ErrorGuaranteed> {
  let r = this.walk_pat(discr_place, arm.pat, arm.guard !== undefined);
  if (r.$ === "Err") return r;

  if (arm.guard !== undefined) {
    const e = arm.guard;
    r = this.consume_expr(e);
    if (r.$ === "Err") return r;
  }

  r = this.consume_expr(arm.body);
  if (r.$ === "Err") return r;
  return Ok(undefined);
};

/// The core driver for walking a pattern
///
/// This should mirror how pattern-matching gets lowered to MIR, as
/// otherwise said lowering will ICE when trying to resolve the upvars.
///
/// However, it is okay to approximate it here by doing *more* accesses than
/// the actual MIR builder will, which is useful when some checks are too
/// cumbersome to perform here, because e.g. they require more typeck results
/// than available.
///
/// Do note that discrepancies like these do still create obscure corners
/// in the semantics of the language, and should be avoided if possible.
// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:828 walk_pat
ExprUseVisitor.prototype.walk_pat = function (this: Euv, discr_place: PlaceWithHirId, pat: hir.Pat, has_guard: boolean): Result<undefined, ErrorGuaranteed> {
  const tcx = this.cx.tcx();
  return this.cat_pattern(clone_PlaceWithHirId(discr_place), pat, (place, pat) => {
    const read_discriminant = (): void => {
      this.delegate.borrow(place, discr_place.hir_id, BorrowKind.Immutable);
    };

    const kind = pat.kind;
    switch (kind.$) {
      case "Binding": {
        const canonical_id = kind._1;
        const bm = this.cx.typeck_results().extract_binding_mode(tcx.sess, pat.hir_id, pat.span);

        // pat_ty: the type of the binding being produced.
        const pat_ty = this.node_ty(pat.hir_id);
        if (pat_ty.$ === "Err") return pat_ty;

        const def: Res = { $: "Local", _0: canonical_id };
        const binding_place = this.cat_res(pat.hir_id, pat.span, pat_ty._0, def);
        if (binding_place.$ === "Ok") {
          this.delegate.bind(binding_place._0, binding_place._0.hir_id);
        }

        // Subtle: MIR desugaring introduces immutable borrows for each pattern
        // binding when lowering pattern guards to ensure that the guard does not
        // modify the scrutinee.
        if (has_guard) {
          read_discriminant();
        }

        // It is also a borrow or copy/move of the value being matched.
        // In a cases of pattern like `let pat = upvar`, don't use the span
        // of the pattern, as this just looks confusing, instead use the span
        // of the discriminant.
        const by_ref = bm._0;
        switch (by_ref.$) {
          case "Yes": {
            const m = by_ref._1;
            const bk = BorrowKind.from_mutbl(m);
            this.delegate.borrow(place, discr_place.hir_id, bk);
            break;
          }
          case "No":
            this.consume_or_copy(place, discr_place.hir_id);
            break;
        }
        break;
      }
      case "Deref": {
        const subpattern = kind._0;
        // A deref pattern is a bit special: the binding mode of its inner bindings
        // determines whether to borrow *at the level of the deref pattern* rather than
        // borrowing the bound place (since that inner place is inside the temporary that
        // stores the result of calling `deref()`/`deref_mut()` so can't be captured).
        // Deref patterns on boxes don't borrow, so we ignore them here.
        // HACK: this could be a fake pattern corresponding to a deref inserted by match
        // ergonomics, in which case `pat.hir_id` will be the id of the subpattern.
        const mode = this.cx.typeck_results().deref_pat_borrow_mode(place.place.ty(), subpattern);
        if (mode.$ === "Borrow") {
          const mutability = mode._0 as Mutability;
          const bk = BorrowKind.from_mutbl(mutability);
          this.delegate.borrow(place, discr_place.hir_id, bk);
        }
        break;
      }
      case "Never":
        // A `!` pattern always counts as an immutable read of the discriminant,
        // even in an irrefutable pattern.
        read_discriminant();
        break;
      case "Expr":
      case "Range": {
        if (kind.$ === "Expr" && kind._0.kind.$ === "Path") {
          const { hir_id, span } = kind._0;
          const qpath = kind._0.kind._0;
          // A `Path` pattern is just a name like `Foo`. This is either a
          // named constant or else it refers to an ADT variant

          const res = this.cx.typeck_results().qpath_res(qpath, hir_id);
          if (res.$ === "Def" && (res._0.$ === "Const" || res._0.$ === "AssocConst")) {
            // Named constants have to be equated with the value
            // being matched, so that's a read of the value being matched.
            //
            // FIXME: Does the MIR code skip this read when matching on a ZST?
            // If so, we can also skip it here.
            read_discriminant();
          } else {
            // Otherwise, this is a struct/enum variant, and so it's
            // only a read if we need to read the discriminant.
            if (this.is_multivariant_adt(place.place.ty(), span)) {
              read_discriminant();
            }
          }
          break;
        }
        // When matching against a literal or range, we need to
        // borrow the place to compare it against the pattern.
        //
        // Note that we do this read even if the range matches all
        // possible values, such as 0..=u8::MAX. This is because
        // we don't want to depend on consteval here.
        //
        // FIXME: What if the type being matched only has one
        // possible value?
        read_discriminant();
        break;
      }
      case "Struct":
      case "TupleStruct":
        if (this.is_multivariant_adt(place.place.ty(), pat.span)) {
          read_discriminant();
        }
        break;
      case "Slice": {
        const lhs = kind._0;
        const wild = kind._1;
        const rhs = kind._2;
        // We don't need to test the length if the pattern is `[..]`
        if (
          (lhs.length === 0 && wild !== undefined && rhs.length === 0) ||
          // Arrays have a statically known size, so
          // there is no need to read their length
          place.place.ty().peel_refs().is_array()
        ) {
          // No read necessary
        } else {
          read_discriminant();
        }
        break;
      }
      case "Or":
      case "Ref":
      case "Guard":
      case "Tuple":
      case "Wild":
      case "Missing":
      case "Err":
        // If the PatKind is Or, Box, Ref, Guard, or Tuple, the relevant accesses
        // are made later as these patterns contains subpatterns.
        // If the PatKind is Missing, Wild or Err, any relevant accesses are made when processing
        // the other patterns that are part of the match
        break;
    }

    return Ok(undefined);
  });
};

/// Handle the case where the current body contains a closure.
///
/// When the current body being handled is a closure, then we must make sure that
/// - The parent closure only captures Places from the nested closure that are not local to it.
///
/// In the following example the closures `c` only captures `p.x` even though `incr`
/// is a capture of the nested closure
///
/// ```
/// struct P { x: i32 }
/// let mut p = P { x: 4 };
/// let c = || {
///    let incr = 10;
///    let nested = || p.x += incr;
/// };
/// ```
///
/// - When reporting the Place back to the Delegate, ensure that the UpvarId uses the enclosing
/// closure as the DefId.
// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:991 walk_captures
ExprUseVisitor.prototype.walk_captures = function (this: Euv, closure_expr: hir.Closure): Result<undefined, ErrorGuaranteed> {
  // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:992 upvar_is_local_variable
  function upvar_is_local_variable(upvars: Map<HirId, hir.Upvar> | undefined, upvar_id: HirId, body_owner_is_closure: boolean): boolean {
    return upvars !== undefined ? !upvars.has(upvar_id) : body_owner_is_closure;
  }

  const tcx = this.cx.tcx();
  const closure_def_id = closure_expr.def_id;
  // For purposes of this function, coroutine and closures are equivalent.
  const body_owner_is_closure = tcx.hir_body_owner_kind(this.cx.body_owner_def_id()).$ === "Closure";

  // If we have a nested closure, we want to include the fake reads present in the nested
  // closure.
  const fake_reads = this.cx.typeck_results().closure_fake_reads.get(closure_def_id);
  if (fake_reads !== undefined) {
    for (const [fake_read_, cause, hir_id] of fake_reads) {
      const fake_read = as_place(fake_read_);
      const base = fake_read.base;
      if (base.$ === "Upvar") {
        const upvar_id = base._0;
        if (upvar_is_local_variable(this.upvars, upvar_id.var_path.hir_id, body_owner_is_closure)) {
          // The nested closure might be fake reading the current (enclosing) closure's local variables.
          // The only places we want to fake read before creating the parent closure are the ones that
          // are not local to it/ defined by it.
          //
          // ```rust,ignore(cannot-test-this-because-pseudo-code)
          // let v1 = (0, 1);
          // let c = || { // fake reads: v1
          //    let v2 = (0, 1);
          //    let e = || { // fake reads: v1, v2
          //       let (_, t1) = v1;
          //       let (_, t2) = v2;
          //    }
          // }
          // ```
          // This check is performed when visiting the body of the outermost closure (`c`) and ensures
          // that we don't add a fake read of v2 in c.
          continue;
        }
      } else {
        bug(`Do not know how to get HirId out of Rvalue and StaticItem ${debug_PlaceBase(fake_read.base, PLAIN)}`);
      }
      this.delegate.fake_read(new PlaceWithHirId(hir_id, clone_Place(fake_read)), cause, hir_id);
    }
  }

  const min_captures = this.cx.typeck_results().closure_min_captures.get(closure_def_id);
  if (min_captures !== undefined) {
    for (const [var_hir_id, min_list] of min_captures) {
      if (this.upvars !== undefined ? !this.upvars.has(var_hir_id) : body_owner_is_closure) {
        // The nested closure might be capturing the current (enclosing) closure's local variables.
        // We check if the root variable is ever mentioned within the enclosing closure, if not
        // then for the current body (if it's a closure) these aren't captures, we will ignore them.
        continue;
      }
      for (const captured_place of min_list) {
        const place = as_place(captured_place.place);
        const capture_info = captured_place.info;

        const place_base: PlaceBase = body_owner_is_closure
          ? // Mark the place to be captured by the enclosing closure
            { $: "Upvar", _0: UpvarId.new(var_hir_id, this.cx.body_owner_def_id()) }
          : // If the body owner isn't a closure then the variable must
            // be a local variable
            { $: "Local", _0: var_hir_id };
        const closure_hir_id = tcx.local_def_id_to_hir_id(closure_def_id);
        const place_with_id = PlaceWithHirId.new(
          capture_info.path_expr_id ?? capture_info.capture_kind_expr_id ?? closure_hir_id,
          place.base_ty,
          place_base,
          [...place.projections],
        );

        const capture_kind = capture_info.capture_kind;
        switch (capture_kind.$) {
          case "ByValue":
            this.consume_or_copy(place_with_id, place_with_id.hir_id);
            break;
          case "ByUse":
            this.consume_clone_or_copy(place_with_id, place_with_id.hir_id);
            break;
          case "ByRef": {
            const upvar_borrow = capture_kind._0;
            this.delegate.borrow(place_with_id, place_with_id.hir_id, upvar_borrow);
            break;
          }
        }
      }
    }
  }

  return Ok(undefined);
};

/// The job of the methods whose name starts with `cat_` is to analyze
/// expressions and construct the corresponding [`Place`]s. The `cat`
/// stands for "categorize", this is a leftover from long ago when
/// places were called "categorizations".
///
/// Note that a [`Place`] differs somewhat from the expression itself. For
/// example, auto-derefs are explicit. Also, an index `a[b]` is decomposed into
/// two operations: a dereference to reach the array data and then an index to
/// jump forward to the relevant item.
// ---- impl<'tcx, Cx: TypeInformationCtxt<'tcx>, D: Delegate<'tcx>> ExprUseVisitor<'tcx, Cx, D> (:1120) ----

// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:1121 expect_and_resolve_type
ExprUseVisitor.prototype.expect_and_resolve_type = function (this: Euv, id: HirId, ty: Ty | undefined): Result<Ty, ErrorGuaranteed> {
  if (ty !== undefined) {
    const ty_ = this.cx.deeply_resolve_ignoring_regions(ty, fold_Ty);
    const r = this.cx.error_reported_in_ty(ty_);
    if (r.$ === "Err") return r;
    return Ok(ty_);
  } else {
    // FIXME: We shouldn't be relying on the infcx being tainted.
    const r = this.cx.tainted_by_errors();
    if (r.$ === "Err") return r;
    return bug(`no type for node ${this.cx.tcx().hir_id_to_string(id)} in ExprUseVisitor`);
  }
};

// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:1140 node_ty
ExprUseVisitor.prototype.node_ty = function (this: Euv, hir_id: HirId): Result<Ty, ErrorGuaranteed> {
  return this.expect_and_resolve_type(hir_id, this.cx.typeck_results().node_type_opt(hir_id));
};

// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:1144 expr_ty
ExprUseVisitor.prototype.expr_ty = function (this: Euv, expr: hir.Expr): Result<Ty, ErrorGuaranteed> {
  return this.expect_and_resolve_type(expr.hir_id, this.cx.typeck_results().expr_ty_opt(expr));
};

// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:1148 expr_ty_adjusted
ExprUseVisitor.prototype.expr_ty_adjusted = function (this: Euv, expr: hir.Expr): Result<Ty, ErrorGuaranteed> {
  return this.expect_and_resolve_type(expr.hir_id, this.cx.typeck_results().expr_ty_adjusted_opt(expr));
};

/// Returns the type of value that this pattern matches against.
/// Some non-obvious cases:
///
/// - a `ref x` binding matches against a value of type `T` and gives
///   `x` the type `&T`; we return `T`.
/// - a pattern with implicit derefs (thanks to default binding
///   modes #42640) may look like `Some(x)` but in fact have
///   implicit deref patterns attached (e.g., it is really
///   `&Some(x)`). In that case, we return the "outermost" type
///   (e.g., `&Option<T>`).
// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:1165 pat_ty_adjusted
ExprUseVisitor.prototype.pat_ty_adjusted = function (this: Euv, pat: hir.Pat): Result<Ty, ErrorGuaranteed> {
  // Check for implicit `&` types wrapping the pattern; note
  // that these are never attached to binding patterns, so
  // actually this is somewhat "disjoint" from the code below
  // that aims to account for `ref x`.
  const vec = this.cx.typeck_results().pat_adjustments().get(pat.hir_id);
  if (vec !== undefined) {
    const first_adjust = vec[0];
    if (first_adjust !== undefined) {
      return Ok(first_adjust.source);
    }
  } else if (pat.kind.$ === "Ref" && this.cx.typeck_results().skipped_ref_pats().contains(pat.hir_id)) {
    const subpat = pat.kind._0;
    return this.pat_ty_adjusted(subpat);
  }

  return this.pat_ty_unadjusted(pat);
};

/// Like [`Self::pat_ty_adjusted`], but ignores implicit `&` patterns.
// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:1185 pat_ty_unadjusted
ExprUseVisitor.prototype.pat_ty_unadjusted = function (this: Euv, pat: hir.Pat): Result<Ty, ErrorGuaranteed> {
  const base_ty_r = this.node_ty(pat.hir_id);
  if (base_ty_r.$ === "Err") return base_ty_r;
  const base_ty = base_ty_r._0;

  // This code detects whether we are looking at a `ref x`,
  // and if so, figures out what the type *being borrowed* is.
  switch (pat.kind.$) {
    case "Binding": {
      const bm = unwrap(this.cx.typeck_results().pat_binding_modes().get(pat.hir_id), "missing binding mode");

      if (bm._0.$ === "Yes") {
        const pinnedness = bm._0._0;
        let base_ty_: Ty;
        if (Pinnedness.is_pinned(pinnedness)) {
          const pinned = base_ty.pinned_ty();
          if (pinned === undefined) {
            return Err(this.cx.report_bug(pat.span, "by-pin-ref binding of non-`Pin` type"));
          }
          base_ty_ = pinned;
        } else {
          base_ty_ = base_ty;
        }
        // a bind-by-ref means that the base_ty will be the type of the ident itself,
        // but what we want here is the type of the underlying value being borrowed.
        // So peel off one-level, turning the &T into T.
        const ty = this.cx.structurally_resolve_type(pat.span, base_ty_).builtin_deref(false);
        if (ty !== undefined) {
          return Ok(ty);
        } else {
          return Err(this.cx.report_bug(pat.span, "by-ref binding of non-derefable type"));
        }
      } else {
        return Ok(base_ty);
      }
    }
    default:
      return Ok(base_ty);
  }
};

// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:1230 cat_expr
ExprUseVisitor.prototype.cat_expr = function (this: Euv, expr: hir.Expr): Result<PlaceWithHirId, ErrorGuaranteed> {
  return this.cat_expr_(expr, this.cx.typeck_results().expr_adjustments(expr));
};

/// This recursion helper avoids going through *too many*
/// adjustments, since *only* non-overloaded deref recurses.
// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:1236 cat_expr_
ExprUseVisitor.prototype.cat_expr_ = function (this: Euv, expr: hir.Expr, adjustments: readonly Adjustment[]): Result<PlaceWithHirId, ErrorGuaranteed> {
  if (adjustments.length === 0) {
    return this.cat_expr_unadjusted(expr);
  } else {
    const adjustment = adjustments[adjustments.length - 1]!;
    const previous = adjustments.slice(0, adjustments.length - 1);
    return this.cat_expr_adjusted_with(expr, () => this.cat_expr_(expr, previous), adjustment);
  }
};

// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:1249 cat_expr_adjusted
ExprUseVisitor.prototype.cat_expr_adjusted = function (this: Euv, expr: hir.Expr, previous: PlaceWithHirId, adjustment: Adjustment): Result<PlaceWithHirId, ErrorGuaranteed> {
  return this.cat_expr_adjusted_with(expr, () => Ok(previous), adjustment);
};

// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:1258 cat_expr_adjusted_with
ExprUseVisitor.prototype.cat_expr_adjusted_with = function (this: Euv, expr: hir.Expr, previous: () => Result<PlaceWithHirId, ErrorGuaranteed>, adjustment: Adjustment): Result<PlaceWithHirId, ErrorGuaranteed> {
  const target = this.cx.deeply_resolve_ignoring_regions(adjustment.target, fold_Ty);
  const kind = adjustment.kind;
  switch (kind.$) {
    case "Deref": {
      const deref_kind = kind._0;
      // Equivalent to *expr or something similar.
      let base: PlaceWithHirId;
      if (deref_kind.$ === "Overloaded") {
        const deref = deref_kind._0;
        const ref_ty = Ty.new_ref(this.cx.tcx(), this.cx.tcx().lifetimes.re_erased, target, deref.mutbl);
        base = this.cat_rvalue(expr.hir_id, ref_ty);
      } else {
        const p = previous();
        if (p.$ === "Err") return p;
        base = p._0;
      }
      return this.cat_deref(expr.hir_id, base);
    }

    case "NeverToAny":
    case "Pointer":
    case "Borrow":
    case "GenericReborrow":
      // Result is an rvalue.
      return Ok(this.cat_rvalue(expr.hir_id, target));
  }
};

// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:1295 cat_expr_unadjusted
ExprUseVisitor.prototype.cat_expr_unadjusted = function (this: Euv, expr: hir.Expr): Result<PlaceWithHirId, ErrorGuaranteed> {
  const expr_ty_r = this.expr_ty(expr);
  if (expr_ty_r.$ === "Err") return expr_ty_r;
  const expr_ty = expr_ty_r._0;
  const kind = expr.kind;
  switch (kind.$) {
    case "Unary": {
      if (kind._0 !== "Deref") break;
      const e_base = kind._1;
      if (this.cx.typeck_results().is_method_call(expr)) {
        return this.cat_overloaded_place(expr, e_base);
      } else {
        const base = this.cat_expr(e_base);
        if (base.$ === "Err") return base;
        return this.cat_deref(expr.hir_id, base._0);
      }
    }

    case "Field": {
      const base_r = this.cat_expr(kind._0);
      if (base_r.$ === "Err") return base_r;
      const base = base_r._0;

      const field_idx = unwrap(this.cx.typeck_results().field_indices().get(expr.hir_id), "Field index not found");

      return Ok(this.cat_projection(expr.hir_id, base, expr_ty, { $: "Field", _0: field_idx, _1: FIRST_VARIANT }));
    }

    case "Index": {
      const base_e = kind._0;
      if (this.cx.typeck_results().is_method_call(expr)) {
        // If this is an index implemented by a method call, then it
        // will include an implicit deref of the result.
        // The call to index() returns a `&T` value, which
        // is an rvalue. That is what we will be
        // dereferencing.
        return this.cat_overloaded_place(expr, base_e);
      } else {
        const base = this.cat_expr(base_e);
        if (base.$ === "Err") return base;
        return Ok(this.cat_projection(expr.hir_id, base._0, expr_ty, ProjectionKind.Index));
      }
    }

    case "Path": {
      const qpath = kind._0;
      const res = this.cx.typeck_results().qpath_res(qpath, expr.hir_id);
      return this.cat_res(expr.hir_id, expr.span, expr_ty, res);
    }

    // type ascription doesn't affect the place-ness of the subexpression.
    case "Type":
      return this.cat_expr(kind._0);

    case "UnsafeBinderCast": {
      if (kind._0 !== "Unwrap") break;
      const base = this.cat_expr(kind._1);
      if (base.$ === "Err") return base;
      return Ok(this.cat_projection(expr.hir_id, base._0, expr_ty, ProjectionKind.UnwrapUnsafeBinder));
    }

    default:
      break;
  }
  // hir::ExprKind::AddrOf(..)
  // | hir::ExprKind::Call(..)
  // | hir::ExprKind::Use(..)
  // | hir::ExprKind::Assign(..)
  // | hir::ExprKind::AssignOp(..)
  // | hir::ExprKind::Closure { .. }
  // | hir::ExprKind::Ret(..)
  // | hir::ExprKind::Become(..)
  // | hir::ExprKind::Unary(..)
  // | hir::ExprKind::Yield(..)
  // | hir::ExprKind::MethodCall(..)
  // | hir::ExprKind::Cast(..)
  // | hir::ExprKind::DropTemps(..)
  // | hir::ExprKind::Array(..)
  // | hir::ExprKind::If(..)
  // | hir::ExprKind::Tup(..)
  // | hir::ExprKind::Binary(..)
  // | hir::ExprKind::Block(..)
  // | hir::ExprKind::Let(..)
  // | hir::ExprKind::Loop(..)
  // | hir::ExprKind::Match(..)
  // | hir::ExprKind::Lit(..)
  // | hir::ExprKind::ConstBlock(..)
  // | hir::ExprKind::Break(..)
  // | hir::ExprKind::Continue(..)
  // | hir::ExprKind::Struct(..)
  // | hir::ExprKind::Repeat(..)
  // | hir::ExprKind::InlineAsm(..)
  // | hir::ExprKind::OffsetOf(..)
  // | hir::ExprKind::UnsafeBinderCast(UnsafeBinderCastKind::Wrap, ..)
  // | hir::ExprKind::Err(_) =>
  return Ok(this.cat_rvalue(expr.hir_id, expr_ty));
};

// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:1393 cat_res
ExprUseVisitor.prototype.cat_res = function (this: Euv, hir_id: HirId, span: Span, expr_ty: Ty, res: Res): Result<PlaceWithHirId, ErrorGuaranteed> {
  if (
    (res.$ === "Def" &&
      (res._0.$ === "Ctor" || res._0.$ === "Const" || res._0.$ === "ConstParam" || res._0.$ === "AssocConst" || res._0.$ === "Fn" || res._0.$ === "AssocFn")) ||
    res.$ === "SelfCtor"
  ) {
    return Ok(this.cat_rvalue(hir_id, expr_ty));
  } else if (res.$ === "Def" && res._0.$ === "Static") {
    return Ok(PlaceWithHirId.new(hir_id, expr_ty, PlaceBase.StaticItem, []));
  } else if (res.$ === "Local") {
    const var_id = res._0;
    if (this.upvars !== undefined && this.upvars.has(var_id)) {
      return this.cat_upvar(hir_id, var_id);
    } else {
      return Ok(PlaceWithHirId.new(hir_id, expr_ty, { $: "Local", _0: var_id }, []));
    }
  } else {
    const def = res;
    return span_bug(span, `unexpected definition in ExprUseVisitor: ${debug_Res(def, PLAIN, debug_HirId)}`);
  }
};

/// Categorize an upvar.
///
/// Note: the actual upvar access contains invisible derefs of closure
/// environment and upvar reference as appropriate. Only regionck cares
/// about these dereferences, so we let it compute them as needed.
// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:1433 cat_upvar
ExprUseVisitor.prototype.cat_upvar = function (this: Euv, hir_id: HirId, var_id: HirId): Result<PlaceWithHirId, ErrorGuaranteed> {
  const closure_expr_def_id = this.cx.body_owner_def_id();

  const upvar_id: UpvarId = {
    var_path: { hir_id: var_id },
    closure_expr_id: closure_expr_def_id,
  };
  const var_ty = this.node_ty(var_id);
  if (var_ty.$ === "Err") return var_ty;

  return Ok(PlaceWithHirId.new(hir_id, var_ty._0, { $: "Upvar", _0: upvar_id }, []));
};

// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:1445 cat_rvalue
ExprUseVisitor.prototype.cat_rvalue = function (this: Euv, hir_id: HirId, expr_ty: Ty): PlaceWithHirId {
  return PlaceWithHirId.new(hir_id, expr_ty, PlaceBase.Rvalue, []);
};

// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:1449 cat_projection
ExprUseVisitor.prototype.cat_projection = function (this: Euv, node: HirId, base_place: PlaceWithHirId, ty: Ty, kind: ProjectionKind): PlaceWithHirId {
  const place_ty = base_place.place.ty();
  // PORT: the moved vector is copied (module comment).
  const projections: Projection[] = [...base_place.place.projections];

  const node_ty = this.cx.typeck_results().node_type(node);
  if (!this.cx.tcx().next_trait_solver_globally()) {
    // Opaque types can't have field projections, but we can instead convert
    // the current place in-place (heh) to the hidden type, and then apply all
    // follow up projections on that.
    if (node_ty !== place_ty && this.cx.structurally_resolve_type(this.cx.tcx().hir_span(base_place.hir_id), place_ty).is_opaque()) {
      projections.push({ kind: ProjectionKind.OpaqueCast, ty: node_ty });
    }
  }
  projections.push({ kind, ty });
  return PlaceWithHirId.new(node, base_place.place.base_ty, base_place.place.base, projections);
};

// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:1477 cat_overloaded_place
ExprUseVisitor.prototype.cat_overloaded_place = function (this: Euv, expr: hir.Expr, base: hir.Expr): Result<PlaceWithHirId, ErrorGuaranteed> {
  // Reconstruct the output assuming it's a reference with the
  // same region and mutability as the receiver. This holds for
  // `Deref(Mut)::Deref(_mut)` and `Index(Mut)::index(_mut)`.
  const place_ty = this.expr_ty(expr);
  if (place_ty.$ === "Err") return place_ty;
  const base_ty = this.expr_ty_adjusted(base);
  if (base_ty.$ === "Err") return base_ty;

  const kind = this.cx.structurally_resolve_type(base.span, base_ty._0).kind();
  if (kind.$ !== "Ref") {
    return span_bug(expr.span, "cat_overloaded_place: base is not a reference");
  }
  const region = kind._0;
  const mutbl = kind._2;
  const ref_ty = Ty.new_ref(this.cx.tcx(), region, place_ty._0, mutbl);

  const base_place = this.cat_rvalue(expr.hir_id, ref_ty);
  return this.cat_deref(expr.hir_id, base_place);
};

// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:1499 cat_deref
ExprUseVisitor.prototype.cat_deref = function (this: Euv, node: HirId, base_place: PlaceWithHirId): Result<PlaceWithHirId, ErrorGuaranteed> {
  const base_curr_ty = base_place.place.ty();
  const deref_ty = this.cx.structurally_resolve_type(this.cx.tcx().hir_span(base_place.hir_id), base_curr_ty).builtin_deref(true);
  if (deref_ty === undefined) {
    return Err(this.cx.report_bug(this.cx.tcx().hir_span(node), "explicit deref of non-derefable type"));
  }
  // PORT: the moved vector is copied (module comment).
  const projections: Projection[] = [...base_place.place.projections];
  projections.push({ kind: ProjectionKind.Deref, ty: deref_ty });

  return Ok(PlaceWithHirId.new(node, base_place.place.base_ty, base_place.place.base, projections));
};

/// Returns the variant index for an ADT used within a Struct or TupleStruct pattern
/// Here `pat_hir_id` is the HirId of the pattern itself.
// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:1523 variant_index_for_adt
ExprUseVisitor.prototype.variant_index_for_adt = function (this: Euv, qpath: hir.QPath, pat_hir_id: HirId, span: Span): Result<VariantIdx, ErrorGuaranteed> {
  const res = this.cx.typeck_results().qpath_res(qpath, pat_hir_id);
  const ty = this.cx.typeck_results().node_type(pat_hir_id);
  const kind = this.cx.structurally_resolve_type(span, ty).kind();
  if (kind.$ !== "Adt") {
    return Err(this.cx.report_bug(span, "struct or tuple struct pattern not applied to an ADT"));
  }
  const adt_def = kind._0;

  if (res.$ === "Def" && res._0.$ === "Variant") {
    const variant_id = res._1;
    return Ok(adt_def.variant_index_with_id(variant_id));
  } else if (res.$ === "Def" && res._0.$ === "Ctor" && res._0._0 === "Variant") {
    const variant_ctor_id = res._1;
    return Ok(adt_def.variant_index_with_ctor_id(variant_ctor_id));
  } else if (
    (res.$ === "Def" && res._0.$ === "Ctor" && res._0._0 === "Struct") ||
    (res.$ === "Def" && (res._0.$ === "Struct" || res._0.$ === "Union" || res._0.$ === "TyAlias" || res._0.$ === "AssocTy")) ||
    res.$ === "SelfCtor" ||
    res.$ === "SelfTyParam" ||
    res.$ === "SelfTyAlias"
  ) {
    // Structs and Unions have only have one variant.
    return Ok(FIRST_VARIANT);
  } else {
    return bug(`expected ADT path, found=${debug_Res(res, PLAIN, debug_HirId)}`);
  }
};

/// Returns the total number of fields in an ADT variant used within a pattern.
/// Here `pat_hir_id` is the HirId of the pattern itself.
// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:1556 total_fields_in_adt_variant
ExprUseVisitor.prototype.total_fields_in_adt_variant = function (this: Euv, pat_hir_id: HirId, variant_index: VariantIdx, span: Span): Result<number, ErrorGuaranteed> {
  const ty = this.cx.typeck_results().node_type(pat_hir_id);
  const kind = this.cx.structurally_resolve_type(span, ty).kind();
  if (kind.$ === "Adt") {
    const adt_def = kind._0;
    return Ok(adt_def.variant(variant_index).fields.length);
  } else {
    return this.cx.tcx().dcx().span_bug(span, "struct or tuple struct pattern not applied to an ADT");
  }
};

/// Returns the total number of fields in a tuple used within a Tuple pattern.
/// Here `pat_hir_id` is the HirId of the pattern itself.
// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:1576 total_fields_in_tuple
ExprUseVisitor.prototype.total_fields_in_tuple = function (this: Euv, pat_hir_id: HirId, span: Span): Result<number, ErrorGuaranteed> {
  const ty = this.cx.typeck_results().node_type(pat_hir_id);
  const kind = this.cx.structurally_resolve_type(span, ty).kind();
  if (kind.$ === "Tuple") {
    const args = kind._0;
    return Ok(args.length);
  } else {
    return Err(this.cx.report_bug(span, "tuple pattern not applied to a tuple"));
  }
};

/// Here, `place` is the `PlaceWithHirId` being matched and pat is the pattern it
/// is being matched against.
///
/// In general, the way that this works is that we walk down the pattern,
/// constructing a `PlaceWithHirId` that represents the path that will be taken
/// to reach the value being matched.
// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:1590 cat_pattern
ExprUseVisitor.prototype.cat_pattern = function (
  this: Euv,
  place_with_id_: PlaceWithHirId,
  pat: hir.Pat,
  op: (_1: PlaceWithHirId, _2: hir.Pat) => Result<undefined, ErrorGuaranteed>,
): Result<undefined, ErrorGuaranteed> {
  let place_with_id = place_with_id_;
  // If (pattern) adjustments are active for this pattern, adjust the `PlaceWithHirId` correspondingly.
  // `PlaceWithHirId`s are constructed differently from patterns. For example, in
  //
  // ```
  // match foo {
  //     &&Some(x, ) => { ... },
  //     _ => { ... },
  // }
  // ```
  //
  // the pattern `&&Some(x,)` is represented as `Ref { Ref { TupleStruct }}`. To build the
  // corresponding `PlaceWithHirId` we start with the `PlaceWithHirId` for `foo`, and then, by traversing the
  // pattern, try to answer the question: given the address of `foo`, how is `x` reached?
  //
  // `&&Some(x,)` `place_foo`
  //  `&Some(x,)` `deref { place_foo}`
  //   `Some(x,)` `deref { deref { place_foo }}`
  //       `(x,)` `field0 { deref { deref { place_foo }}}` <- resulting place
  //
  // The above example has no adjustments. If the code were instead the (after adjustments,
  // equivalent) version
  //
  // ```
  // match foo {
  //     Some(x, ) => { ... },
  //     _ => { ... },
  // }
  // ```
  //
  // Then we see that to get the same result, we must start with
  // `deref { deref { place_foo }}` instead of `place_foo` since the pattern is now `Some(x,)`
  // and not `&&Some(x,)`, even though its assigned type is that of `&&Some(x,)`.
  const typeck_results = this.cx.typeck_results();
  const adjustments = typeck_results.pat_adjustments().get(pat.hir_id) ?? [];
  // PORT: `adjustments.iter().peekable()` is an index into the slice (`peek` reads the next element).
  for (let i = 0; i < adjustments.length; i++) {
    const adjust = adjustments[i]!;
    switch (adjust.kind) {
      case "BuiltinDeref": {
        const r = this.cat_deref(pat.hir_id, place_with_id);
        if (r.$ === "Err") return r;
        place_with_id = r._0;
        break;
      }
      case "OverloadedDeref": {
        // This adjustment corresponds to an overloaded deref; unless it's on a box, it
        // borrows the scrutinee to call `Deref::deref` or `DerefMut::deref_mut`. Invoke
        // the callback before setting `place_with_id` to the temporary storing the
        // result of the deref.
        // HACK(dianne): giving the callback a fake deref pattern makes sure it behaves the
        // same as it would if this were an explicit deref pattern (including for boxes).
        const r = op(place_with_id, new hir.Pat(pat.hir_id, { $: "Deref", _0: pat }, pat.span, pat.default_binding_modes));
        if (r.$ === "Err") return r;
        let target_ty: Ty;
        const next_adjust = adjustments[i + 1];
        if (next_adjust !== undefined) {
          target_ty = next_adjust.source;
        } else {
          // At the end of the deref chain, we get `pat`'s scrutinee.
          const t = this.pat_ty_unadjusted(pat);
          if (t.$ === "Err") return t;
          target_ty = t._0;
        }
        const p = this.pat_deref_place(pat.hir_id, place_with_id, pat, target_ty);
        if (p.$ === "Err") return p;
        place_with_id = p._0;
        break;
      }
      case "PinDeref": {
        const target_ty = adjust.source.pinned_ty();
        if (target_ty === undefined) {
          return Err(this.cx.report_bug(this.cx.tcx().hir_span(pat.hir_id), "`PinDeref` of non-pinned-reference type"));
        }
        const kind: ProjectionKind = { $: "Field", _0: 0 as FieldIdx, _1: FIRST_VARIANT };
        place_with_id = this.cat_projection(pat.hir_id, place_with_id, target_ty, kind);
        const r = this.cat_deref(pat.hir_id, place_with_id);
        if (r.$ === "Err") return r;
        place_with_id = r._0;
        break;
      }
    }
  }
  // drop(typeck_results); // explicitly release borrow of typeck results, just in case.
  // let place_with_id = place_with_id; // lose mutability
  const place_with_id_final = place_with_id;

  // Invoke the callback, but only now, after the `place_with_id` has adjusted.
  //
  // To see that this makes sense, consider `match &Some(3) { Some(x) => { ... }}`. In that
  // case, the initial `place_with_id` will be that for `&Some(3)` and the pattern is `Some(x)`. We
  // don't want to call `op` with these incompatible values. As written, what happens instead
  // is that `op` is called with the adjusted place (that for `*&Some(3)`) and the pattern
  // `Some(x)` (which matches). Recursing once more, `*&Some(3)` and the pattern `Some(x)`
  // result in the place `Downcast<Some>(*&Some(3)).0` associated to `x` and invoke `op` with
  // that (where the `ref` on `x` is implied).
  let r = op(place_with_id_final, pat);
  if (r.$ === "Err") return r;

  const kind = pat.kind;
  switch (kind.$) {
    case "Tuple": {
      // (p1, ..., pN)
      const subpats = kind._0;
      const dots_pos = kind._1;
      const total_fields = this.total_fields_in_tuple(pat.hir_id, pat.span);
      if (total_fields.$ === "Err") return total_fields;

      for (const [i, subpat] of hir.pat_util.enumerate_and_adjust(subpats, total_fields._0, dots_pos)) {
        const subpat_ty = this.pat_ty_adjusted(subpat);
        if (subpat_ty.$ === "Err") return subpat_ty;
        const projection_kind: ProjectionKind = { $: "Field", _0: i as FieldIdx, _1: FIRST_VARIANT };
        const sub_place = this.cat_projection(pat.hir_id, clone_PlaceWithHirId(place_with_id_final), subpat_ty._0, projection_kind);
        r = this.cat_pattern(sub_place, subpat, op);
        if (r.$ === "Err") return r;
      }
      break;
    }

    case "TupleStruct": {
      // S(p1, ..., pN)
      const qpath = kind._0;
      const subpats = kind._1;
      const dots_pos = kind._2;
      const variant_index = this.variant_index_for_adt(qpath, pat.hir_id, pat.span);
      if (variant_index.$ === "Err") return variant_index;
      const total_fields = this.total_fields_in_adt_variant(pat.hir_id, variant_index._0, pat.span);
      if (total_fields.$ === "Err") return total_fields;

      for (const [i, subpat] of hir.pat_util.enumerate_and_adjust(subpats, total_fields._0, dots_pos)) {
        const subpat_ty = this.pat_ty_adjusted(subpat);
        if (subpat_ty.$ === "Err") return subpat_ty;
        const projection_kind: ProjectionKind = { $: "Field", _0: i as FieldIdx, _1: variant_index._0 };
        const sub_place = this.cat_projection(pat.hir_id, clone_PlaceWithHirId(place_with_id_final), subpat_ty._0, projection_kind);
        r = this.cat_pattern(sub_place, subpat, op);
        if (r.$ === "Err") return r;
      }
      break;
    }

    case "Struct": {
      // S { f1: p1, ..., fN: pN }
      const qpath = kind._0;
      const field_pats = kind._1;

      const variant_index = this.variant_index_for_adt(qpath, pat.hir_id, pat.span);
      if (variant_index.$ === "Err") return variant_index;

      for (const fp of field_pats) {
        const field_ty = this.pat_ty_adjusted(fp.pat);
        if (field_ty.$ === "Err") return field_ty;
        const field_index = unwrap(this.cx.typeck_results().field_indices().get(fp.hir_id), "no index for a field");

        const field_place = this.cat_projection(pat.hir_id, clone_PlaceWithHirId(place_with_id_final), field_ty._0, {
          $: "Field",
          _0: field_index,
          _1: variant_index._0,
        });
        r = this.cat_pattern(field_place, fp.pat, op);
        if (r.$ === "Err") return r;
      }
      break;
    }

    case "Or": {
      const pats = kind._0;
      for (const pat of pats) {
        r = this.cat_pattern(clone_PlaceWithHirId(place_with_id_final), pat, op);
        if (r.$ === "Err") return r;
      }
      break;
    }

    case "Binding":
    case "Guard": {
      const subpat = kind.$ === "Binding" ? kind._3 : kind._0;
      if (subpat === undefined) {
        // PatKind::Binding(.., None): always ok
        break;
      }
      r = this.cat_pattern(place_with_id_final, subpat, op);
      if (r.$ === "Err") return r;
      break;
    }

    case "Ref": {
      const subpat = kind._0;
      if (this.cx.typeck_results().skipped_ref_pats().contains(pat.hir_id)) {
        r = this.cat_pattern(place_with_id_final, subpat, op);
        if (r.$ === "Err") return r;
        break;
      }

      // &p1, &mut p1. we can ignore the mutability of
      // PatKind::Ref since that information is already contained
      // in the type.
      const subplace = this.cat_deref(pat.hir_id, place_with_id_final);
      if (subplace.$ === "Err") return subplace;
      r = this.cat_pattern(subplace._0, subpat, op);
      if (r.$ === "Err") return r;
      break;
    }
    case "Deref": {
      const subpat = kind._0;
      const ty = this.pat_ty_adjusted(subpat);
      if (ty.$ === "Err") return ty;
      const place = this.pat_deref_place(pat.hir_id, place_with_id_final, subpat, ty._0);
      if (place.$ === "Err") return place;
      r = this.cat_pattern(place._0, subpat, op);
      if (r.$ === "Err") return r;
      break;
    }

    case "Slice": {
      const before = kind._0;
      const slice = kind._1;
      const after = kind._2;
      const element_ty = this.cx.structurally_resolve_type(pat.span, place_with_id_final.place.ty()).builtin_index();
      if (element_ty === undefined) {
        return Err(this.cx.report_bug(pat.span, "explicit index of non-indexable type"));
      }
      const elt_place = this.cat_projection(pat.hir_id, clone_PlaceWithHirId(place_with_id_final), element_ty, ProjectionKind.Index);
      for (const before_pat of before) {
        r = this.cat_pattern(clone_PlaceWithHirId(elt_place), before_pat, op);
        if (r.$ === "Err") return r;
      }
      if (slice !== undefined) {
        const slice_pat = slice;
        const slice_pat_ty = this.pat_ty_adjusted(slice_pat);
        if (slice_pat_ty.$ === "Err") return slice_pat_ty;
        const slice_place = this.cat_projection(pat.hir_id, place_with_id_final, slice_pat_ty._0, ProjectionKind.Subslice);
        r = this.cat_pattern(slice_place, slice_pat, op);
        if (r.$ === "Err") return r;
      }
      for (const after_pat of after) {
        r = this.cat_pattern(clone_PlaceWithHirId(elt_place), after_pat, op);
        if (r.$ === "Err") return r;
      }
      break;
    }

    case "Expr":
    case "Range":
    case "Never":
    case "Missing":
    case "Wild":
    case "Err":
      // always ok
      break;
  }

  return Ok(undefined);
};

/// Represents the place matched on by a deref pattern's interior.
// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:1826 pat_deref_place
ExprUseVisitor.prototype.pat_deref_place = function (this: Euv, hir_id: HirId, base_place: PlaceWithHirId, inner: hir.Pat, target_ty: Ty): Result<PlaceWithHirId, ErrorGuaranteed> {
  const mode = this.cx.typeck_results().deref_pat_borrow_mode(base_place.place.ty(), inner);
  switch (mode.$) {
    // Deref patterns on boxes are lowered using a built-in deref.
    case "Box":
      return this.cat_deref(hir_id, base_place);
    // For other types, we create a temporary to match on.
    case "Borrow": {
      const mutability = mode._0 as Mutability;
      const re_erased = this.cx.tcx().lifetimes.re_erased;
      const ty = Ty.new_ref(this.cx.tcx(), re_erased, target_ty, mutability);
      // A deref pattern stores the result of `Deref::deref` or `DerefMut::deref_mut` ...
      const base = this.cat_rvalue(hir_id, ty);
      // ... and the inner pattern matches on the place behind that reference.
      return this.cat_deref(hir_id, base);
    }
    default:
      return unreachable_mode(mode.$);
  }
};

/// Checks whether a type has multiple variants, and therefore, whether a
/// read of the discriminant might be necessary.
// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:1851 is_multivariant_adt
ExprUseVisitor.prototype.is_multivariant_adt = function (this: Euv, ty: Ty, span: Span): boolean {
  const kind = this.cx.structurally_resolve_type(span, ty).kind();
  if (kind.$ === "Adt") {
    const def = kind._0;
    // We treat non-exhaustive enums the same independent of the crate they are
    // defined in, to avoid differences in the operational semantics between crates.
    return def.variants().length > 1 || def.is_variant_list_non_exhaustive();
  } else {
    return false;
  }
};

/** PORT: `thir::DerefPatBorrowMode` is `PendingEnum` in typeck_results.ts (its tag is a `string`): the match is exhaustive upstream. */
function unreachable_mode(tag: string): never {
  return bug(`unexpected DerefPatBorrowMode ${tag}`);
}

// rustc-type: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:1862 ExprPlaceDelegate
// PORT: hand class (types.sets.json `hand`), a unit struct implementing `Delegate`.
export class ExprPlaceDelegate implements Delegate {
  // ---- impl<'tcx> Delegate<'tcx> for ExprPlaceDelegate (:1864) ----

  // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:1865 consume
  consume(_0: PlaceWithHirId, _1: HirId): void {}

  // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:1867 use_cloned
  use_cloned(_0: PlaceWithHirId, _1: HirId): void {}

  // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:1869 borrow
  borrow(_0: PlaceWithHirId, _1: HirId, _2: BorrowKind): void {}

  // (provided: `Delegate_provided.copy`)
  copy(place_with_id: PlaceWithHirId, diag_expr_id: HirId): void {
    Delegate_provided.copy(this, place_with_id, diag_expr_id);
  }

  // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:1871 mutate
  mutate(_0: PlaceWithHirId, _1: HirId): void {}

  // (provided: `Delegate_provided.bind`)
  bind(binding_place: PlaceWithHirId, diag_expr_id: HirId): void {
    Delegate_provided.bind(this, binding_place, diag_expr_id);
  }

  // rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:1873 fake_read
  fake_read(_0: PlaceWithHirId, _1: FakeReadCause, _2: HirId): void {}
}

/// Categorizes `expr` as a place for diagnostic suggestions.
///
/// This should be used for diagnostics purpose only.
// rustc: compiler/rustc_hir_typeck/src/expr_use_visitor.rs:1879 expr_place
export function expr_place(fcx: FnCtxt, expr: hir.Expr): Result<PlaceWithHirId, ErrorGuaranteed> {
  return ExprUseVisitor.new(TypeInformationCtxt.of(fcx, TypeInformationCtxt_FnCtxt), new ExprPlaceDelegate()).cat_expr(expr);
}
