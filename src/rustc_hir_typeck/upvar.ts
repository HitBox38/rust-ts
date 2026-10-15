// Port of compiler/rustc_hir_typeck/src/upvar.rs (lane typeck-upvar).
//
//! ### Inferring borrow kinds for upvars
//!
//! Whenever there is a closure expression, we need to determine how each
//! upvar is used. We do this by initially assigning each upvar an
//! immutable "borrow kind" (see `ty::BorrowKind` for details) and then
//! "escalating" the kind as needed. The borrow kind proceeds according to
//! the following lattice:
//! ```ignore (not-rust)
//! ty::ImmBorrow -> ty::UniqueImmBorrow -> ty::MutBorrow
//! ```
//! So, for example, if we see an assignment `x = 5` to an upvar `x`, we
//! will promote its borrow kind to mutable borrow. If we see an `&mut x`
//! we'll do the same. Naturally, this applies not just to the upvar, but
//! to everything owned by `x`, so the result is the same for something
//! like `x.f = 5` and so on (presuming `x` is not a borrowed pointer to a
//! struct). These adjustments are performed in
//! `adjust_for_non_move_closure` (you can trace backwards through the code
//! from there).
//!
//! The fact that we are inferring borrow kinds as we go results in a
//! semi-hacky interaction with the way `ExprUseVisitor` is computing
//! `Place`s. In particular, it will query the current borrow kind as it
//! goes, and we'll return the *current* value, but this may get
//! adjusted later. Therefore, in this module, we generally ignore the
//! borrow kind (and derived mutabilities) that `ExprUseVisitor` returns
//! within `Place`s, since they may be inaccurate. (Another option
//! would be to use a unification scheme, where instead of returning a
//! concrete borrow kind like `ty::ImmBorrow`, we return a
//! `ty::InferBorrow(upvar_id)` or something like that, but this would
//! then mean that all later passes would have to check for these figments
//! and report an error, and it just seems like more mess in the end.)
//
// Representation (PORT):
// - `InferBorrowKindVisitor` (`impl Visitor`) and `InferBorrowKind` (`impl euv::Delegate`) are hand classes (decls.ts
//   "Representation" 7); the nested `HasNestedClosure` (`impl Visitor`, upvar.rs:107) and `MigrationLint`
//   (`impl Diagnostic`, upvar.rs:1081) are classes local to their fns. `MigrationWarningReason::migration_message` is
//   the free fn `MigrationWarningReason_migration_message` (the generated class has no methods).
// - `debug!` / `#[instrument]` are tracing only and stay as comments.
// - `FnCtxt::new(self, ..)` (deref coercion `&FnCtxt -> &TypeckRootCtxt`) is `FnCtxt.new(this.root_ctxt, ..)`;
//   `euv::ExprUseVisitor::new(&fcx, ..)` is `ExprUseVisitor.new(TypeInformationCtxt.of(fcx, TypeInformationCtxt_FnCtxt), ..)`.
// - `UnordSet<&'static str>` is `Set<string>`; `FxIndexMap<UpvarMigrationInfo, _>` / `FxIndexSet<UpvarMigrationInfo>`
//   are `KeyedMap` / `KeyedSet` keyed by `intern_key` (the derived `Hash`/`Eq` of a data enum).
// - `ty::CaptureInfo` is `Copy`: every Rust copy that is later mutated is `copy_CaptureInfo(..)`.
// - `hir::place` items are rustc_middle hir/place.ts's (merge-w18). Their `TypeFoldable` / `TypeVisitable` derives are
//   not generated yet (tools/codegen): `fold_Place` at the end of this file is an `unported` stand-in.
// Init order: top-level code here touches only ./decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
export * from "./upvar.gen.ts";
import * as hir from "../rustc_hir/lib.ts";
import { LangItem } from "../rustc_attr_ir/lang_items.ts";
import { find_attr } from "../rustc_attr_ir/lib.ts";
import { HasAttrs_LocalDefId } from "../rustc_middle/ty/mod.ts";
import type * as ast from "../rustc_ast/lib.ts";
import type { Mutability } from "../rustc_ast_ir/lib.ts";
import { Applicability, Diag, type DiagCtxtHandle, type Diagnostic, type Level } from "../rustc_errors/lib.ts";
import { MultiSpan } from "../rustc_error_messages/lib.ts";
import { type HirId, HirId_eq, HirIdMap } from "../rustc_hir_id/lib.ts";
import { RUST_2021_INCOMPATIBLE_CLOSURE_CAPTURES } from "../rustc_lint_defs/builtin.gen.ts";
import { EvaluationResult } from "../rustc_middle/traits/select.ts";
import {
  analyze_coroutine_closure_captures,
  BorrowKind,
  type CaptureInfo,
  CapturedPlace,
  type RootVariableMinCaptureList,
  UpvarCapture,
  UpvarId,
} from "../rustc_middle/ty/closure.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { HirPlace, ParamEnv, Region } from "../rustc_middle/ty/decls.ts";
import { fold_GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import { type ClosureSizeProfileData, Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import { Region as RegionC } from "../rustc_type_ir/sty/mod.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { fold_with_UpvarArgs, try_fold_with_UpvarArgs, type UpvarArgs, visit_with_UpvarArgs } from "../rustc_middle/ty/sty.gen.ts";
import { UpvarArgs as UpvarArgsC } from "../rustc_middle/ty/sty.ts";
import type { FakeReadCause, TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import { KeyedMap, KeyedSet } from "../rust_ts/keyed.ts";
import { intern_key } from "../rust_ts/intern_key.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import { LocalDefId as LocalDefIdC } from "../rustc_span/def_id.ts";
import { BytePos, Span } from "../rustc_span/lib.ts";
import { bug, span_bug } from "../rustc_span/macros.ts";
import { display_Symbol, sym, type Symbol } from "../rustc_span/symbol.ts";
import { Binder } from "../rustc_type_ir/binder.ts";
import type { TypeFoldable } from "../rustc_type_ir/fold.ts";
import { BoundVar, ClosureKind, INNERMOST } from "../rustc_type_ir/lib.ts";
import { CoroutineArgs, CoroutineClosureArgs, ClosureArgs } from "../rustc_type_ir/ty_kind/closure.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import { is_whitespace } from "../std/char.ts";
import { field_mut, type MutRef } from "../std/mut_ref.ts";
import { assert, assert_eq, panic, unported, unreachable, unwrap } from "../std/panic.ts";
import { str_lines, utf8_len } from "../std/str.ts";
import { Delegate_provided, ExprUseVisitor, TypeInformationCtxt_FnCtxt } from "./expr_use_visitor.ts";
import { type Delegate, FnCtxt, TypeInformationCtxt } from "./decls.ts";
import { clone_Place, debug_PlaceBase, debug_Projection, debug_ProjectionKind, Place, type PlaceBase, PlaceBase_eq, PlaceWithHirId, type Projection, type ProjectionKind, ProjectionKind_eq } from "../rustc_middle/hir/place.ts";
import { MigrationWarningReason, type NeededMigration, PlaceAncestryRelation, type UpvarMigrationInfo } from "./upvar.gen.ts";
import type { InferredCaptureInformation, MigrationLintNote } from "./upvar.gen.ts";
import { debug_HirId } from "../rustc_hir_id/lib.ts";
import { debug_LocalDefId } from "../rustc_span/def_id.ts";
import { debug_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { debug_TyKind, type TyKind } from "../rustc_type_ir/ty_kind.ts";
import { debug_vec, format_debug, PLAIN } from "../std/fmt.ts";

// impl<'a, 'tcx> FnCtxt<'a, 'tcx> {

// rustc: compiler/rustc_hir_typeck/src/upvar.rs:78 closure_analyze
FnCtxt.prototype.closure_analyze = function (this: FnCtxt, body: hir.Body): void {
  new InferBorrowKindVisitor(this).visit_body(body);

  // it's our job to process these.
  assert(this.deferred_call_resolutions.size === 0, "assertion failed: self.deferred_call_resolutions.borrow().is_empty()");
};

// rustc: compiler/rustc_hir_typeck/src/upvar.rs:85 infer_closure_kind_for_diagnostic
FnCtxt.prototype.infer_closure_kind_for_diagnostic = function (this: FnCtxt, closure_def_id: LocalDefId): [ClosureKind, [Span, Place] | undefined] | undefined {
  const hir_id = this.tcx.local_def_id_to_hir_id(closure_def_id);
  const node = this.tcx.hir_node_by_def_id(closure_def_id);
  if (node.$ !== "Expr") {
    return undefined;
  }
  const expr = node._0;
  if (expr.kind.$ !== "Closure") {
    return undefined;
  }
  const { capture_clause, body: body_id, explicit_captures } = expr.kind._0;
  const body = this.tcx.hir_body(body_id);

  // We cannot reliably infer the closure kind if there are nested closures whose
  // captures have not yet been analyzed.
  class HasNestedClosure extends hir.intravisit.Visitor {
    constructor(public _0: boolean) {
      super();
    }
    // impl<'v> Visitor<'v> for HasNestedClosure {
    // rustc: compiler/rustc_hir_typeck/src/upvar.rs:108 visit_expr
    override visit_expr(expr: hir.Expr): undefined {
      if (expr.kind.$ === "Closure") {
        this._0 = true;
        return undefined;
      }
      return hir.intravisit.walk_expr(this, expr);
    }
  }
  const has_nested = new HasNestedClosure(false);
  has_nested.visit_body(body);
  if (has_nested._0) {
    return undefined;
  }

  const closure_fcx = FnCtxt.new(this.root_ctxt, this.tcx.param_env(LocalDefIdC.to_def_id(closure_def_id)) as ParamEnv, closure_def_id);

  const delegate = new InferBorrowKind(closure_fcx, closure_def_id, [], []);

  void ExprUseVisitor.new(TypeInformationCtxt.of(closure_fcx, TypeInformationCtxt_FnCtxt), delegate).consume_body(body);

  for (const capture of explicit_captures) {
    const place = closure_fcx.place_for_root_variable(closure_def_id, capture.var_hir_id);
    delegate.consume(new PlaceWithHirId(capture.var_hir_id, place), hir_id);
  }

  const [, closure_kind, origin] = this.process_collected_capture_information(capture_clause, delegate.capture_information);

  // Bail out if a by-value capture has unresolved inference variables, since
  // fallback might later resolve the type to `Copy` (making the closure `Fn`).
  if (closure_kind === ClosureKind.FnOnce) {
    for (const [place, capture_info] of delegate.capture_information) {
      if (capture_info.capture_kind.$ === "ByValue" && TypeVisitableExt.has_infer(place.ty(), fold_Ty)) {
        return undefined;
      }
    }
  }

  if (!enable_precise_capture(expr.span)) {
    if (origin !== undefined) {
      const place = origin[1];
      place.projections.length = 0;
    }
  }

  return [closure_kind, origin];
};
// }

/** upvar.rs:189 `impl MigrationWarningReason { fn migration_message(&self) -> String }` */
// rustc: compiler/rustc_hir_typeck/src/upvar.rs:189 migration_message
export function MigrationWarningReason_migration_message(self_: MigrationWarningReason): string {
  const base = "changes to closure capture in Rust 2021 will affect";
  if (self_.auto_traits.length !== 0 && self_.drop_order) {
    return `${base} drop order and which traits the closure implements`;
  } else if (self_.drop_order) {
    return `${base} drop order`;
  } else {
    return `${base} which traits the closure implements`;
  }
}

// rustc-type: compiler/rustc_hir_typeck/src/upvar.rs:216 InferBorrowKindVisitor
// PORT: hand class (decls.ts "Representation" 7) extending rustc_hir intravisit's `Visitor`.
export class InferBorrowKindVisitor extends hir.intravisit.Visitor {
  constructor(public fcx: FnCtxt) {
    super();
  }

  // impl<'a, 'tcx> Visitor<'tcx> for InferBorrowKindVisitor<'a, 'tcx> {
  // rustc: compiler/rustc_hir_typeck/src/upvar.rs:221 visit_expr
  override visit_expr(expr: hir.Expr): undefined {
    switch (expr.kind.$) {
      case "Closure": {
        const { capture_clause, body: body_id } = expr.kind._0;
        const body = this.fcx.tcx.hir_body(body_id);
        this.visit_body(body);
        this.fcx.analyze_closure(expr.hir_id, expr.span, body_id, body, capture_clause);
        break;
      }
      default:
        break;
    }

    return hir.intravisit.walk_expr(this, expr);
  }

  // rustc: compiler/rustc_hir_typeck/src/upvar.rs:234 visit_inline_const
  override visit_inline_const(c: hir.ConstBlock): undefined {
    const body = this.fcx.tcx.hir_body(c.body);
    this.visit_body(body);
    return undefined;
  }
}

/** D4 descriptor of `ty::UpvarArgs` (derived `TypeFoldable`, rustc_middle sty.gen.ts). */
const fold_UpvarArgs: TypeFoldable<UpvarArgs> = {
  visit_with: visit_with_UpvarArgs,
  try_fold_with: try_fold_with_UpvarArgs,
  fold_with: fold_with_UpvarArgs,
};

// impl<'a, 'tcx> FnCtxt<'a, 'tcx> {

/// Analysis starting point.
// #[instrument(skip(self, body), level = "debug")]
// rustc: compiler/rustc_hir_typeck/src/upvar.rs:243 analyze_closure
FnCtxt.prototype.analyze_closure = function (
  this: FnCtxt,
  closure_hir_id: HirId,
  span: Span,
  body_id: hir.BodyId,
  body: hir.Body,
  capture_clause: ast.CaptureBy,
): void {
  // Extract the type of the closure.
  const ty = this.node_ty(closure_hir_id);
  let closure_def_id_;
  let args_: UpvarArgs;
  let infer_kind: boolean;
  const k = ty.kind();
  switch (k.$) {
    case "Closure":
      [closure_def_id_, args_, infer_kind] = [k._0, { $: "Closure", _0: k._1 }, this.closure_kind(ty) === undefined];
      break;
    case "CoroutineClosure":
      [closure_def_id_, args_, infer_kind] = [k._0, { $: "CoroutineClosure", _0: k._1 }, this.closure_kind(ty) === undefined];
      break;
    case "Coroutine":
      [closure_def_id_, args_, infer_kind] = [k._0, { $: "Coroutine", _0: k._1 }, false];
      break;
    case "Error":
      // #51714: skip analysis when we have already encountered type errors
      return;
    default:
      return span_bug(span, `type of closure expr ${debug_HirId_str(closure_hir_id)} is not a closure ${debug_Ty_str(ty)}`);
  }
  const args = this.deeply_resolve_ignoring_regions(args_, fold_UpvarArgs);
  const closure_def_id = closure_def_id_.expect_local();

  assert_eq(this.tcx.hir_body_owner_def_id(body.id()), closure_def_id, (v) => debug_LocalDefId_str(v));

  const closure_fcx = FnCtxt.new(this.root_ctxt, this.tcx.param_env(LocalDefIdC.to_def_id(closure_def_id)) as ParamEnv, closure_def_id);

  const delegate = new InferBorrowKind(closure_fcx, closure_def_id, [], []);

  // First collect the captures implied by the operations in the closure
  // body. This records how each place is actually used: borrowed, modified,
  // moved, and so on.
  void ExprUseVisitor.new(TypeInformationCtxt.of(closure_fcx, TypeInformationCtxt_FnCtxt), delegate).consume_body(body);

  // Save the captures that must be upgraded to by-value after inferring
  // the closure kind from the operations in the body.
  const closure_expr_kind = hir.Node.expect_expr(this.tcx.hir_node(closure_hir_id)).kind;
  let explicit_captures: readonly hir.ExplicitCapture[];
  switch (closure_expr_kind.$) {
    case "Closure":
      explicit_captures = closure_expr_kind._0.explicit_captures;
      break;
    default:
      return bug(`expected closure expr for ${debug_HirId_str(closure_hir_id)}`);
  }

  // There are several curious situations with coroutine-closures where
  // analysis is too aggressive with borrows when the coroutine-closure is
  // marked `move`. Specifically:
  //
  // 1. If the coroutine-closure was inferred to be `FnOnce` during signature
  // inference, then it's still possible that we try to borrow upvars from
  // the coroutine-closure because they are not used by the coroutine body
  // in a way that forces a move. See the test:
  // `async-await/async-closures/force-move-due-to-inferred-kind.rs`.
  //
  // 2. If the coroutine-closure is forced to be `FnOnce` due to the way it
  // uses its upvars (e.g. it consumes a non-copy value), but not *all* upvars
  // would force the closure to `FnOnce`.
  // See the test: `async-await/async-closures/force-move-due-to-actually-fnonce.rs`.
  //
  // This would lead to an impossible to satisfy situation, since `AsyncFnOnce`
  // coroutine bodies can't borrow from their parent closure. To fix this,
  // we force the inner coroutine to also be `move`. This only matters for
  // coroutine-closures that are `move` since otherwise they themselves will
  // be borrowing from the outer environment, so there's no self-borrows occurring.
  if (args.$ === "Coroutine") {
    const coroutine_kind = this.tcx.coroutine_kind(LocalDefIdC.to_def_id(closure_def_id)) as hir.CoroutineKind | undefined;
    if (coroutine_kind === undefined) panic("coroutine should have kind");
    if (coroutine_kind.$ === "Desugared" && coroutine_kind._1 === "Closure") {
      const parent_hir_id = this.tcx.local_def_id_to_hir_id(this.tcx.local_parent(closure_def_id));
      const parent_ty = this.node_ty(parent_hir_id);
      const parent_capture_clause = hir.Node.expect_closure(this.tcx.hir_node(parent_hir_id)).capture_clause;
      if (parent_capture_clause.$ === "Value") {
        const move_kw = parent_capture_clause.move_kw;
        // (1.) Closure signature inference forced this closure to `FnOnce`.
        if (this.closure_kind(parent_ty) === ClosureKind.FnOnce) {
          capture_clause = { $: "Value", move_kw };
        }
        // (2.) The way that the closure uses its upvars means it's `FnOnce`.
        else if (this.coroutine_body_consumes_upvars(closure_def_id, body)) {
          capture_clause = { $: "Value", move_kw };
        }
      }
    }
  }

  // As noted in `lower_coroutine_body_with_moved_arguments`, we default the capture mode
  // to `ByRef` for the `async {}` block internal to async fns/closure. This means
  // that we would *not* be moving all of the parameters into the async block in all cases.
  // For example, when one of the arguments is `Copy`, we turn a consuming use into a copy of
  // a reference, so for `async fn x(t: i32) {}`, we'd only take a reference to `t`.
  //
  // We force all of these arguments to be captured by move before we do expr use analysis.
  //
  // FIXME(async_closures): This could be cleaned up. It's a bit janky that we're just
  // moving all of the `LocalSource::AsyncFn` locals here.
  const coroutine_kind = this.tcx.coroutine_kind(LocalDefIdC.to_def_id(closure_def_id)) as hir.CoroutineKind | undefined;
  if (coroutine_kind !== undefined && coroutine_kind.$ === "Desugared" && (coroutine_kind._1 === "Fn" || coroutine_kind._1 === "Closure")) {
    if (body.value.kind.$ !== "Block") {
      return bug();
    }
    const block = body.value.kind._0;
    for (const stmt of block.stmts) {
      if (!(stmt.kind.$ === "Let" && stmt.kind._0.init !== undefined && stmt.kind._0.source === "AsyncFn")) {
        return bug();
      }
      const init = stmt.kind._0.init;
      const pat = stmt.kind._0.pat;
      if (!(pat.kind.$ === "Binding" && pat.kind._0._0.$ === "No")) {
        // Complex pattern, skip the non-upvar local.
        continue;
      }
      if (!(init.kind.$ === "Path" && init.kind._0.$ === "Resolved")) {
        return bug();
      }
      const path = init.kind._0._1;
      if (path.res.$ !== "Local") {
        return bug();
      }
      const local_id = path.res._0;
      const place = closure_fcx.place_for_root_variable(closure_def_id, local_id);
      delegate.capture_information.push([
        place,
        {
          capture_kind_expr_id: init.hir_id,
          path_expr_id: init.hir_id,
          capture_kind: UpvarCapture.ByValue,
        },
      ]);
    }
  }

  // debug!(
  //     "For closure={:?}, capture_information={:#?}",
  //     closure_def_id, delegate.capture_information
  // );

  this.log_capture_analysis_first_pass(closure_def_id, delegate.capture_information, span);

  const [capture_information, closure_kind, origin] = this.process_collected_capture_information(capture_clause, delegate.capture_information);

  // `move(expr)` requires its synthetic local to be captured by value,
  // regardless of how the closure body uses it. Apply that requirement
  // after closure-kind inference so capturing a value does not by itself
  // make the closure `FnOnce`.
  for (const capture of explicit_captures) {
    const place = closure_fcx.place_for_root_variable(closure_def_id, capture.var_hir_id);
    capture_information.push([
      place,
      {
        capture_kind_expr_id: closure_hir_id,
        path_expr_id: closure_hir_id,
        capture_kind: UpvarCapture.ByValue,
      },
    ]);
  }

  this.compute_min_captures(closure_def_id, capture_information, span);

  // PORT: `let closure_hir_id = ..` shadows the parameter (a reassignment here).
  closure_hir_id = this.tcx.local_def_id_to_hir_id(closure_def_id);

  if (should_do_rust_2021_incompatible_closure_captures_analysis(this.tcx, closure_hir_id)) {
    this.perform_2229_migration_analysis(closure_def_id, body_id, capture_clause, span);
  }

  const after_feature_tys = this.final_upvar_tys(closure_def_id);

  // We now fake capture information for all variables that are mentioned within the closure
  // We do this after handling migrations so that min_captures computes before
  if (!enable_precise_capture(span)) {
    const capture_information: InferredCaptureInformation = [];

    const upvars = this.tcx.upvars_mentioned(LocalDefIdC.to_def_id(closure_def_id));
    if (upvars !== undefined) {
      for (const var_hir_id_ of upvars.keys()) {
        // PORT: the `upvars_mentioned` query value's key type (queries.gen.ts) is rustc_lint_defs' `HirId` alias.
        const var_hir_id = var_hir_id_ as unknown as HirId;
        const place = closure_fcx.place_for_root_variable(closure_def_id, var_hir_id);

        // debug!("seed place {:?}", place);

        const capture_kind = this.init_capture_kind_for_place(place, capture_clause);
        const fake_info: CaptureInfo = {
          capture_kind_expr_id: undefined,
          path_expr_id: undefined,
          capture_kind,
        };

        capture_information.push([place, fake_info]);
      }
    }

    // This will update the min captures based on this new fake information.
    this.compute_min_captures(closure_def_id, capture_information, span);
  }

  const before_feature_tys = this.final_upvar_tys(closure_def_id);

  if (infer_kind) {
    // Unify the (as yet unbound) type variable in the closure
    // args with the kind we inferred.
    let closure_kind_ty: Ty;
    switch (args.$) {
      case "Closure":
        closure_kind_ty = ClosureArgs.kind_ty(args._0.as_closure());
        break;
      case "CoroutineClosure":
        closure_kind_ty = CoroutineClosureArgs.kind_ty(args._0.as_coroutine_closure());
        break;
      case "Coroutine":
        return unreachable("coroutines don't have an inferred kind");
    }
    this.demand_eqtype(span, Ty.from_closure_kind(this.tcx, closure_kind), closure_kind_ty);

    // If we have an origin, store it.
    if (origin !== undefined) {
      if (!enable_precise_capture(span)) {
        // Without precise captures, we just capture the base and ignore
        // the projections.
        origin[1].projections.length = 0;
      }

      this.typeck_results.closure_kind_origins_mut().insert(closure_hir_id, [origin[0], origin[1]]);
    }
  }

  // For coroutine-closures, we additionally must compute the
  // `coroutine_captures_by_ref_ty` type, which is used to generate the by-ref
  // version of the coroutine-closure's output coroutine.
  //
  // If the args already reference an error, computing the by-ref upvar
  // tuple may itself reach malformed types. We still equate the
  // `coroutine_captures_by_ref_ty` inference variable to an error type
  // so downstream consumers (e.g. `has_self_borrows`) can rely on it
  // being resolved to either an `FnPtr` or `Error` rather than remaining
  // an unconstrained inference variable.
  if (args.$ === "CoroutineClosure") {
    const cc_args = args._0;
    const err = TypeVisitableExt.error_reported(cc_args, fold_GenericArgs);
    if (err.$ === "Err") {
      const guar = err._0;
      this.demand_eqtype(span, CoroutineClosureArgs.coroutine_captures_by_ref_ty(cc_args.as_coroutine_closure()), Ty.new_error(this.tcx, guar));
    } else {
      const closure_env_region: Region = RegionC.new_bound(this.tcx, INNERMOST, {
        var: BoundVar.ZERO,
        kind: { $: "ClosureEnv" },
      });

      const num_args = Binder.skip_binder(CoroutineClosureArgs.coroutine_closure_sig(cc_args.as_coroutine_closure())).tupled_inputs_ty.tuple_fields().length;
      const typeck_results = this.typeck_results;

      const tupled_upvars_ty_for_borrow = Ty.new_tup_from_iter(
        this.tcx,
        analyze_coroutine_closure_captures(
          typeck_results.closure_min_captures_flattened(closure_def_id),
          // Skip the captures that are just moving the closure's args
          // into the coroutine. These are always by move, and we append
          // those later in the `CoroutineClosureSignature` helper functions.
          iter_skip(typeck_results.closure_min_captures_flattened(this.tcx.coroutine_for_closure(LocalDefIdC.to_def_id(closure_def_id)).expect_local()), num_args),
          ([, parent_capture], [, child_capture]) => {
            // This is subtle. See documentation on function.
            const needs_ref = should_reborrow_from_env_of_parent_coroutine_closure(parent_capture, child_capture);

            const upvar_ty = child_capture.place.ty();
            const capture = child_capture.info.capture_kind;
            // Not all upvars are captured by ref, so use
            // `apply_capture_kind_on_capture_ty` to ensure that we
            // compute the right captured type.
            return apply_capture_kind_on_capture_ty(this.tcx, upvar_ty, capture, needs_ref ? closure_env_region : this.tcx.lifetimes.re_erased);
          },
        ),
      );
      const coroutine_captures_by_ref_ty = Ty.new_fn_ptr(
        this.tcx,
        Binder.bind_with_vars(
          this.tcx.mk_fn_sig_safe_rust_abi([], tupled_upvars_ty_for_borrow),
          this.tcx.mk_bound_variable_kinds([{ $: "Region", _0: { $: "ClosureEnv" } }]),
        ),
      );
      this.demand_eqtype(span, CoroutineClosureArgs.coroutine_captures_by_ref_ty(cc_args.as_coroutine_closure()), coroutine_captures_by_ref_ty);

      // Additionally, we can now constrain the coroutine's kind type.
      //
      // We only do this if `infer_kind`, because if we have constrained
      // the kind from closure signature inference, the kind inferred
      // for the inner coroutine may actually be more restrictive.
      if (infer_kind) {
        const body_ty_kind = this.typeck_results.expr_ty(body.value).kind();
        if (body_ty_kind.$ !== "Coroutine") {
          return bug();
        }
        const coroutine_args = body_ty_kind._1;
        this.demand_eqtype(span, CoroutineArgs.kind_ty(coroutine_args.as_coroutine()), Ty.from_coroutine_closure_kind(this.tcx, closure_kind));
      }
    }
  }

  this.log_closure_min_capture_info(closure_def_id, span);

  // Now that we've analyzed the closure, we know how each
  // variable is borrowed, and we know what traits the closure
  // implements (Fn vs FnMut etc). We now have some updates to do
  // with that information.
  //
  // Note that no closure type C may have an upvar of type C
  // (though it may reference itself via a trait object). This
  // results from the desugaring of closures to a struct like
  // `Foo<..., UV0...UVn>`. If one of those upvars referenced
  // C, then the type would have infinite size (and the
  // inference algorithm will reject it).

  // Equate the type variables for the upvars with the actual types.
  const final_upvar_tys = this.final_upvar_tys(closure_def_id);
  // debug!(?closure_hir_id, ?args, ?final_upvar_tys);

  if (this.tcx.features().unsized_fn_params()) {
    for (const capture of this.typeck_results.closure_min_captures_flattened(closure_def_id)) {
      if (capture.info.capture_kind.$ === "ByValue") {
        this.require_type_is_sized(capture.place.ty(), capture.get_path_span(this.tcx), { $: "SizedClosureCapture", _0: closure_def_id });
      }
    }
  }

  // Build a tuple (U0..Un) of the final upvar types U0..Un
  // and unify the upvar tuple type in the closure with it:
  const final_tupled_upvars_type = Ty.new_tup(this.tcx, final_upvar_tys);
  this.demand_suptype(span, UpvarArgsC.tupled_upvars_ty(args), final_tupled_upvars_type);

  const fake_reads = delegate.fake_reads;

  this.typeck_results.closure_fake_reads.set(closure_def_id, fake_reads.map(([p, c, h]) => [p, c, h]));

  if (this.tcx.sess.opts.unstable_opts.profile_closures) {
    const data: ClosureSizeProfileData = {
      before_feature_tys: Ty.new_tup(this.tcx, before_feature_tys),
      after_feature_tys: Ty.new_tup(this.tcx, after_feature_tys),
    };
    // PORT: `closure_size_eval`'s value type is still `Pending` in typeck_results.ts.
    this.typeck_results.closure_size_eval.set(closure_def_id, data as never);
  }

  // If we are also inferred the closure kind here,
  // process any deferred resolutions.
  const deferred_call_resolutions = this.remove_deferred_call_resolutions(closure_def_id);
  for (const deferred_call_resolution of deferred_call_resolutions) {
    deferred_call_resolution.resolve(FnCtxt.new(this.root_ctxt, this.param_env, closure_def_id));
  }
};

/// Determines whether the body of the coroutine uses its upvars in a way that
/// consumes (i.e. moves) the value, which would force the coroutine to `FnOnce`.
/// In a more detailed comment above, we care whether this happens, since if
/// this happens, we want to force the coroutine to move all of the upvars it
/// would've borrowed from the parent coroutine-closure.
///
/// This only really makes sense to be called on the child coroutine of a
/// coroutine-closure.
// rustc: compiler/rustc_hir_typeck/src/upvar.rs:658 coroutine_body_consumes_upvars
FnCtxt.prototype.coroutine_body_consumes_upvars = function (this: FnCtxt, coroutine_def_id: LocalDefId, body_: hir.Body): boolean {
  // This block contains argument capturing details. Since arguments
  // aren't upvars, we do not care about them for determining if the
  // coroutine body actually consumes its upvars.
  const bk = body_.value.kind;
  if (!(bk.$ === "Block" && bk._0.expr !== undefined && bk._1 === undefined)) {
    return bug();
  }
  let body = bk._0.expr;
  // Specifically, we only care about the *real* body of the coroutine.
  // We skip out into the drop-temps within the block of the body in order
  // to skip over the args of the desugaring.
  if (body.kind.$ !== "DropTemps") {
    return bug();
  }
  body = body.kind._0;

  const coroutine_fcx = FnCtxt.new(this.root_ctxt, this.tcx.param_env(LocalDefIdC.to_def_id(coroutine_def_id)) as ParamEnv, coroutine_def_id);

  const delegate = new InferBorrowKind(coroutine_fcx, coroutine_def_id, [], []);

  void ExprUseVisitor.new(TypeInformationCtxt.of(coroutine_fcx, TypeInformationCtxt_FnCtxt), delegate).consume_expr(body);

  const [, kind] = this.process_collected_capture_information({ $: "Ref" }, delegate.capture_information);

  return kind === ClosureKind.FnOnce;
};

// Returns a list of `Ty`s for each upvar.
// rustc: compiler/rustc_hir_typeck/src/upvar.rs:698 final_upvar_tys
FnCtxt.prototype.final_upvar_tys = function (this: FnCtxt, closure_id: LocalDefId): Ty[] {
  const out: Ty[] = [];
  for (const captured_place of this.typeck_results.closure_min_captures_flattened(closure_id)) {
    const upvar_ty = captured_place.place.ty();
    const capture = captured_place.info.capture_kind;

    // debug!(?captured_place.place, ?upvar_ty, ?capture, ?captured_place.mutability);

    out.push(apply_capture_kind_on_capture_ty(this.tcx, upvar_ty, capture, this.tcx.lifetimes.re_erased));
  }
  return out;
};

/// Adjusts the closure capture information to ensure that the operations aren't unsafe,
/// and that the path can be captured with required capture kind (depending on use in closure,
/// move closure etc.)
///
/// Returns the set of adjusted information along with the inferred closure kind and span
/// associated with the closure kind inference.
///
/// Note that we *always* infer a minimal kind, even if
/// we don't always *use* that in the final result (i.e., sometimes
/// we've taken the closure kind from the expectations instead, and
/// for coroutines we don't even implement the closure traits
/// really).
///
/// If we inferred that the closure needs to be FnMut/FnOnce, last element of the returned tuple
/// contains a `Some()` with the `Place` that caused us to do so.
// rustc: compiler/rustc_hir_typeck/src/upvar.rs:733 process_collected_capture_information
FnCtxt.prototype.process_collected_capture_information = function (
  this: FnCtxt,
  capture_clause: ast.CaptureBy,
  capture_information: InferredCaptureInformation,
): [InferredCaptureInformation, ClosureKind, [Span, Place] | undefined] {
  let closure_kind: ClosureKind = ClosureKind.LATTICE_BOTTOM;
  let origin: [Span, Place] | undefined = undefined;
  // `Option::take`
  const take_origin = (): [Span, Place] | undefined => {
    const o = origin;
    origin = undefined;
    return o;
  };

  const processed: InferredCaptureInformation = capture_information
    // .iter().cloned()
    .map(([place__, capture_info_]): [Place, CaptureInfo] => {
      const place_ = clone_Place(place__ as Place);
      const capture_info = copy_CaptureInfo(capture_info_);
      // Apply rules for safety before inferring closure kind
      let [place, capture_kind] = restrict_capture_precision(place_, capture_info.capture_kind);

      [place, capture_kind] = truncate_capture_for_optimization(place, capture_kind);

      let usage_span: Span;
      if (capture_info.path_expr_id !== undefined) {
        const usage_expr = capture_info.path_expr_id;
        usage_span = this.tcx.hir_span(usage_expr);
      } else {
        return unreachable();
      }

      let updated: [ClosureKind, [Span, Place] | undefined];
      switch (capture_kind.$) {
        case "ByValue":
          switch (closure_kind) {
            case "Fn":
            case "FnMut":
              updated = [ClosureKind.FnOnce, [usage_span, clone_Place(place)]];
              break;
            // If closure is already FnOnce, don't update
            case "FnOnce":
              updated = [closure_kind, take_origin()];
              break;
          }
          break;

        case "ByRef":
          if (capture_kind._0 === "Mutable" || capture_kind._0 === "UniqueImmutable") {
            switch (closure_kind) {
              case "Fn":
                updated = [ClosureKind.FnMut, [usage_span, clone_Place(place)]];
                break;
              // Don't update the origin
              case "FnMut":
              case "FnOnce":
                updated = [closure_kind, take_origin()];
                break;
            }
            break;
          }
          updated = [closure_kind, take_origin()];
          break;

        default:
          updated = [closure_kind, take_origin()];
          break;
      }

      closure_kind = updated[0];
      origin = updated[1];

      switch (capture_clause.$) {
        case "Value":
          [place, capture_kind] = adjust_for_move_closure(place, capture_kind);
          break;
        case "Use":
          [place, capture_kind] = adjust_for_use_closure(place, capture_kind);
          break;
        case "Ref":
          [place, capture_kind] = adjust_for_non_move_closure(place, capture_kind);
          break;
      }

      // This restriction needs to be applied after we have handled adjustments for `move`
      // closures. We want to make sure any adjustment that might make us move the place into
      // the closure gets handled.
      [place, capture_kind] = restrict_precision_for_drop_types(this, place, capture_kind);

      capture_info.capture_kind = capture_kind;
      return [place, capture_info];
    });

  return [processed, closure_kind, origin];
};

/// Analyzes the information collected by `InferBorrowKind` to compute the min number of
/// Places (and corresponding capture kind) that we need to keep track of to support all
/// the required captured paths.
///
///
/// Note: If this function is called multiple times for the same closure, it will update
///       the existing min_capture map that is stored in TypeckResults.
///
/// Eg:
/// ```
/// #[derive(Debug)]
/// struct Point { x: i32, y: i32 }
///
/// let s = String::from("s");  // hir_id_s
/// let mut p = Point { x: 2, y: -2 }; // his_id_p
/// let c = || {
///        println!("{s:?}");  // L1
///        p.x += 10;  // L2
///        println!("{}" , p.y); // L3
///        println!("{p:?}"); // L4
///        drop(s);   // L5
/// };
/// ```
/// and let hir_id_L1..5 be the expressions pointing to use of a captured variable on
/// the lines L1..5 respectively.
///
/// InferBorrowKind results in a structure like this:
///
/// ```ignore (illustrative)
/// {
///       Place(base: hir_id_s, projections: [], ....) -> {
///                                                            capture_kind_expr: hir_id_L5,
///                                                            path_expr_id: hir_id_L5,
///                                                            capture_kind: ByValue
///                                                       },
///       Place(base: hir_id_p, projections: [Field(0, 0)], ...) -> {
///                                                                     capture_kind_expr: hir_id_L2,
///                                                                     path_expr_id: hir_id_L2,
///                                                                     capture_kind: ByValue
///                                                                 },
///       Place(base: hir_id_p, projections: [Field(1, 0)], ...) -> {
///                                                                     capture_kind_expr: hir_id_L3,
///                                                                     path_expr_id: hir_id_L3,
///                                                                     capture_kind: ByValue
///                                                                 },
///       Place(base: hir_id_p, projections: [], ...) -> {
///                                                          capture_kind_expr: hir_id_L4,
///                                                          path_expr_id: hir_id_L4,
///                                                          capture_kind: ByValue
///                                                      },
/// }
/// ```
///
/// After the min capture analysis, we get:
/// ```ignore (illustrative)
/// {
///       hir_id_s -> [
///            Place(base: hir_id_s, projections: [], ....) -> {
///                                                                capture_kind_expr: hir_id_L5,
///                                                                path_expr_id: hir_id_L5,
///                                                                capture_kind: ByValue
///                                                            },
///       ],
///       hir_id_p -> [
///            Place(base: hir_id_p, projections: [], ...) -> {
///                                                               capture_kind_expr: hir_id_L2,
///                                                               path_expr_id: hir_id_L4,
///                                                               capture_kind: ByValue
///                                                           },
///       ],
/// }
/// ```
// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_hir_typeck/src/upvar.rs:879 compute_min_captures
FnCtxt.prototype.compute_min_captures = function (this: FnCtxt, closure_def_id: LocalDefId, capture_information: InferredCaptureInformation, closure_span: Span): void {
  if (capture_information.length === 0) {
    return;
  }

  const typeck_results = this.typeck_results;

  // `remove(..).unwrap_or_default()`
  const removed = typeck_results.closure_min_captures.get(closure_def_id);
  typeck_results.closure_min_captures.delete(closure_def_id);
  const root_var_min_capture_list: RootVariableMinCaptureList = removed ?? new HirIdMap();

  for (const [place_, capture_info] of capture_information) {
    const place = place_ as Place;
    let var_hir_id: HirId;
    const base = place.base;
    switch (base.$) {
      case "Upvar":
        var_hir_id = base._0.var_path.hir_id;
        break;
      default:
        return bug(`Expected upvar, found=${debug_PlaceBase(base, PLAIN)}`);
    }
    const var_ident = this.tcx.hir_ident(var_hir_id);

    const min_cap_list = root_var_min_capture_list.get(var_hir_id);
    if (min_cap_list === undefined) {
      const mutability = this.determine_capture_mutability(typeck_results, place);
      const min_cap_list = [new CapturedPlace(var_ident, place, capture_info, mutability)];
      root_var_min_capture_list.set(var_hir_id, min_cap_list);
      continue;
    }

    // Go through each entry in the current list of min_captures
    // - if ancestor is found, update its capture kind to account for current place's
    // capture information.
    //
    // - if descendant is found, remove it from the list, and update the current place's
    // capture information to account for the descendant's capture kind.
    //
    // We can never be in a case where the list contains both an ancestor and a descendant
    // Also there can only be ancestor but in case of descendants there might be
    // multiple.

    let descendant_found = false;
    let updated_capture_info = copy_CaptureInfo(capture_info);
    vec_retain(min_cap_list, (possible_descendant_) => {
      switch (determine_place_ancestry_relation(place, possible_descendant_.place)) {
        // current place is ancestor of possible_descendant
        case "Ancestor": {
          descendant_found = true;

          const possible_descendant = clone_CapturedPlace(possible_descendant_);
          const backup_path_expr_id = updated_capture_info.path_expr_id;

          // Truncate the descendant (already in min_captures) to be same as the ancestor to handle any
          // possible change in capture mode.
          truncate_place_to_len_and_update_capture_kind(
            possible_descendant.place,
            field_mut(possible_descendant.info, "capture_kind"),
            place.projections.length,
          );

          updated_capture_info = determine_capture_info(updated_capture_info, possible_descendant.info);

          // we need to keep the ancestor's `path_expr_id`
          updated_capture_info.path_expr_id = backup_path_expr_id;
          return false;
        }

        default:
          return true;
      }
    });

    let ancestor_found = false;
    if (!descendant_found) {
      for (const possible_ancestor of min_cap_list) {
        const relation = determine_place_ancestry_relation(place, possible_ancestor.place);
        if (relation === "SamePlace") {
          ancestor_found = true;
          possible_ancestor.info = determine_capture_info(possible_ancestor.info, updated_capture_info);

          // Only one related place will be in the list.
          break;
        }
        // current place is descendant of possible_ancestor
        else if (relation === "Descendant") {
          ancestor_found = true;
          const backup_path_expr_id = possible_ancestor.info.path_expr_id;

          // Truncate the descendant (current place) to be same as the ancestor to handle any
          // possible change in capture mode.
          truncate_place_to_len_and_update_capture_kind(
            place,
            field_mut(updated_capture_info, "capture_kind"),
            possible_ancestor.place.projections.length,
          );

          possible_ancestor.info = determine_capture_info(possible_ancestor.info, updated_capture_info);

          // we need to keep the ancestor's `path_expr_id`
          possible_ancestor.info.path_expr_id = backup_path_expr_id;

          // Only one related place will be in the list.
          break;
        }
      }
    }

    // Only need to insert when we don't have an ancestor in the existing min capture list
    if (!ancestor_found) {
      const mutability = this.determine_capture_mutability(typeck_results, place);
      const captured_place = new CapturedPlace(var_ident, place, updated_capture_info, mutability);
      min_cap_list.push(captured_place);
    }
  }

  // debug!(
  //     "For closure={:?}, min_captures before sorting={:?}",
  //     closure_def_id, root_var_min_capture_list
  // );

  // Now that we have the minimized list of captures, sort the captures by field id.
  // This causes the closure to capture the upvars in the same order as the fields are
  // declared which is also the drop order. Thus, in situations where we capture all the
  // fields of some type, the observable drop order will remain the same as it previously
  // was even though we're dropping each capture individually.
  // See https://github.com/rust-lang/project-rfc-2229/issues/42 and
  // `tests/ui/closures/2229_closure_analysis/preserve_field_drop_order.rs`.
  for (const [, captures] of root_var_min_capture_list) {
    // PORT: `sort_by` is stable, as `Array.prototype.sort`.
    captures.sort((capture1, capture2) => {
      // rustc: compiler/rustc_hir_typeck/src/upvar.rs:1017 is_field
      function is_field(p: Projection): boolean {
        const kind = p.kind;
        switch (kind.$) {
          case "Field":
            return true;
          case "Deref":
          case "OpaqueCast":
          case "UnwrapUnsafeBinder":
            return false;
          case "Subslice":
          case "Index":
            return bug(`ProjectionKind ${debug_ProjectionKind(kind, PLAIN)} was unexpected`);
        }
      }

      // Need to sort only by Field projections, so filter away others.
      // A previous implementation considered other projection types too
      // but that caused ICE #118144
      const capture1_field_projections = capture1.place.projections.filter((p) => is_field(p));
      const capture2_field_projections = capture2.place.projections.filter((p) => is_field(p));

      const n = Math.min(capture1_field_projections.length, capture2_field_projections.length);
      for (let i = 0; i < n; i++) {
        const p1 = capture1_field_projections[i]!;
        const p2 = capture2_field_projections[i]!;
        // We do not need to look at the `Projection.ty` fields here because at each
        // step of the iteration, the projections will either be the same and therefore
        // the types must be as well or the current projection will be different and
        // we will return the result of comparing the field indexes.
        const l = p1.kind;
        const r = p2.kind;
        if (l.$ === "Field" && r.$ === "Field") {
          const i1 = l._0;
          const i2 = r._0;
          // Compare only if paths are different.
          // Otherwise continue to the next iteration
          if (i1 !== i2) {
            return i1 < i2 ? -1 : 1;
          }
        }
        // Given the filter above, this arm should never be hit
        else {
          return bug(`ProjectionKinds ${debug_ProjectionKind(l, PLAIN)} or ${debug_ProjectionKind(r, PLAIN)} were unexpected`);
        }
      }

      this.dcx().span_delayed_bug(
        closure_span,
        `two identical projections: (${debug_vec(capture1.place.projections, PLAIN, debug_Projection)}, ${debug_vec(capture2.place.projections, PLAIN, debug_Projection)})`,
      );
      return 0;
    });
  }

  // debug!(
  //     "For closure={:?}, min_captures after sorting={:#?}",
  //     closure_def_id, root_var_min_capture_list
  // );
  typeck_results.closure_min_captures.set(closure_def_id, root_var_min_capture_list);
};

/// Perform the migration analysis for RFC 2229, and emit lint
/// `disjoint_capture_drop_reorder` if needed.
// rustc: compiler/rustc_hir_typeck/src/upvar.rs:1073 perform_2229_migration_analysis
FnCtxt.prototype.perform_2229_migration_analysis = function (this: FnCtxt, closure_def_id: LocalDefId, body_id: hir.BodyId, capture_clause: ast.CaptureBy, span: Span): void {
  class MigrationLint implements Diagnostic {
    constructor(
      public closure_def_id: LocalDefId,
      public closure_drop_location_span: Span,
      public this_: FnCtxt,
      public body_id: hir.BodyId,
      public need_migrations: NeededMigration[],
      public migration_message: string,
    ) {}

    // impl<'a, 'b, 'tcx> Diagnostic<'a> for MigrationLint<'b, 'tcx> {
    // rustc: compiler/rustc_hir_typeck/src/upvar.rs:1090 into_diag
    into_diag(dcx: DiagCtxtHandle, level: Level): Diag {
      const { closure_def_id, closure_drop_location_span, this_: this_, body_id, need_migrations, migration_message } = this;
      const lint = Diag.new(dcx, level, migration_message);

      const [migration_string, migrated_variables_concat] = migration_suggestion_for_2229(this_.tcx, need_migrations);

      const closure_hir_id = this_.tcx.local_def_id_to_hir_id(closure_def_id);
      const closure_head_span = this_.tcx.def_span(LocalDefIdC.to_def_id(closure_def_id));

      for (const { var_hir_id, diagnostics_info } of need_migrations) {
        // Labels all the usage of the captured variable and why they are responsible
        // for migration being needed
        for (const lint_note of diagnostics_info) {
          const ci = lint_note.captures_info;
          if (ci.$ === "CapturingPrecise" && ci.source_expr !== undefined) {
            const capture_expr_id = ci.source_expr;
            const captured_name = ci.var_name;
            const cause_span = this_.tcx.hir_span(capture_expr_id);
            lint.span_label(
              cause_span,
              `in Rust 2018, this closure captures all of \`${display_Symbol(this_.tcx.hir_name(var_hir_id))}\`, but in Rust 2021, it will only capture \`${captured_name}\``,
            );
          } else if (ci.$ === "CapturingNothing") {
            const use_span = ci.use_span;
            lint.span_label(use_span, `in Rust 2018, this causes the closure to capture \`${display_Symbol(this_.tcx.hir_name(var_hir_id))}\`, but in Rust 2021, it has no effect`);
          } else {
            // _ => {}
          }

          // Add a label pointing to where a captured variable affected by drop
          // order is dropped.
          if (lint_note.reason.drop_order) {
            const var_name = display_Symbol(this_.tcx.hir_name(var_hir_id));
            switch (ci.$) {
              case "CapturingPrecise": {
                const captured_name = ci.var_name;
                lint.span_label(
                  closure_drop_location_span,
                  `in Rust 2018, \`${var_name}\` is dropped here, but in Rust 2021, only \`${captured_name}\` will be dropped here as part of the closure`,
                );
                break;
              }
              case "CapturingNothing": {
                lint.span_label(
                  closure_drop_location_span,
                  `in Rust 2018, \`${var_name}\` is dropped here along with the closure, but in Rust 2021 \`${var_name}\` is not part of the closure`,
                );
                break;
              }
            }
          }

          // Add a label explaining why a closure no longer implements a trait
          for (const missing_trait of lint_note.reason.auto_traits) {
            // not capturing something anymore cannot cause a trait to fail to be implemented:
            switch (ci.$) {
              case "CapturingPrecise": {
                const captured_name = ci.var_name;
                const var_name = display_Symbol(this_.tcx.hir_name(var_hir_id));
                lint.span_label(
                  closure_head_span,
                  `in Rust 2018, this closure implements ${missing_trait} as \`${var_name}\` implements ${missing_trait}, but in Rust 2021, this closure will no longer implement ${missing_trait} because \`${var_name}\` is not fully captured and \`${captured_name}\` does not implement ${missing_trait}`,
                );
                break;
              }

              // Cannot happen: if we don't capture a variable, we impl strictly more traits
              case "CapturingNothing":
                return span_bug(ci.use_span, "missing trait from not capturing something");
            }
          }
        }
      }

      const diagnostic_msg = `add a dummy let to cause ${migrated_variables_concat} to be fully captured`;

      const closure_span = this_.tcx.hir_span_with_body(closure_hir_id);
      let closure_body_span = (() => {
        // If the body was entirely expanded from a macro
        // invocation, i.e. the body is not contained inside the
        // closure span, then we walk up the expansion until we
        // find the span before the expansion.
        const s = this_.tcx.hir_span_with_body(body_id.hir_id);
        return Span.find_ancestor_inside(s, closure_span) ?? s;
      })();

      const snippet_r = this_.tcx.sess.source_map().span_to_snippet(closure_body_span);
      if (snippet_r.$ === "Ok") {
        let s = String(snippet_r._0);
        if (s.startsWith("$")) {
          // Looks like a macro fragment. Try to find the real block.
          const node = this_.tcx.hir_node(body_id.hir_id);
          if (node.$ === "Expr" && node._0.kind.$ === "Block") {
            const block = node._0.kind._0;
            // If the body is a block (with `{..}`), we use the span of that block.
            // E.g. with a `|| $body` expanded from a `m!({ .. })`, we use `{ .. }`, and not `$body`.
            // Since we know it's a block, we know we can insert the `let _ = ..` without
            // breaking the macro syntax.
            const snippet = this_.tcx.sess.source_map().span_to_snippet(block.span);
            if (snippet.$ === "Ok") {
              closure_body_span = block.span;
              s = String(snippet._0);
            }
          }
        }

        const lines = str_lines(s);
        let line_i = 0;
        const line1 = lines[line_i++] ?? "";

        if (str_trim_end(line1) === "{") {
          // This is a multi-line closure with just a `{` on the first line,
          // so we put the `let` on its own line.
          // We take the indentation from the next non-empty line.
          let line2 = "";
          for (; line_i < lines.length; line_i++) {
            if (lines[line_i]!.length !== 0) {
              line2 = lines[line_i]!;
              break;
            }
          }
          const indent = split_once_non_whitespace(line2)?.[0] ?? "";
          lint.span_suggestion(
            Span.shrink_to_lo(Span.with_lo(closure_body_span, (Span.lo(closure_body_span) + BytePos.from_usize(utf8_len(line1))) as BytePos)),
            diagnostic_msg,
            `\n${indent}${migration_string};`,
            Applicability.MachineApplicable,
          );
        } else if (line1.startsWith("{")) {
          // This is a closure with its body wrapped in
          // braces, but with more than just the opening
          // brace on the first line. We put the `let`
          // directly after the `{`.
          lint.span_suggestion(
            Span.shrink_to_lo(Span.with_lo(closure_body_span, (Span.lo(closure_body_span) + 1) as BytePos)),
            diagnostic_msg,
            ` ${migration_string};`,
            Applicability.MachineApplicable,
          );
        } else {
          // This is a closure without braces around the body.
          // We add braces to add the `let` before the body.
          lint.multipart_suggestion(
            diagnostic_msg,
            [
              [Span.shrink_to_lo(closure_body_span), `{ ${migration_string}; `],
              [Span.shrink_to_hi(closure_body_span), " }"],
            ],
            Applicability.MachineApplicable,
          );
        }
      } else {
        lint.span_suggestion(closure_span, diagnostic_msg, migration_string, Applicability.HasPlaceholders);
      }
      return lint;
    }
  }

  const [need_migrations, reasons] = this.compute_2229_migrations(closure_def_id, span, capture_clause, this.typeck_results.closure_min_captures.get(closure_def_id));

  // Without a valid drop location, the closure syntax is invalid, and
  // emitted lints become nonsensical.
  if (need_migrations.length !== 0) {
    const drop_location_span_ = drop_location_span(this.tcx, this.tcx.local_def_id_to_hir_id(closure_def_id));
    if (drop_location_span_ !== undefined) {
      this.tcx.emit_node_span_lint(
        RUST_2021_INCOMPATIBLE_CLOSURE_CAPTURES,
        this.tcx.local_def_id_to_hir_id(closure_def_id),
        this.tcx.def_span(LocalDefIdC.to_def_id(closure_def_id)),
        new MigrationLint(closure_def_id, drop_location_span_, this, body_id, need_migrations, MigrationWarningReason_migration_message(reasons)),
      );
    }
  }
};

/// Combines all the reasons for 2229 migrations
// rustc: compiler/rustc_hir_typeck/src/upvar.rs:1316 compute_2229_migrations_reasons
FnCtxt.prototype.compute_2229_migrations_reasons = function (this: FnCtxt, auto_trait_reasons: Set<string>, drop_order: boolean): MigrationWarningReason {
  // PORT: `UnordSet::into_sorted_stable_ord` of `&'static str` (byte order; the reasons are ASCII).
  return new MigrationWarningReason([...auto_trait_reasons].sort(str_cmp), drop_order);
};

/// Figures out the list of root variables (and their types) that aren't completely
/// captured by the closure when `capture_disjoint_fields` is enabled and auto-traits
/// differ between the root variable and the captured paths.
///
/// Returns a tuple containing a HashMap of CapturesInfo that maps to a HashSet of trait names
/// if migration is needed for traits for the provided var_hir_id, otherwise returns None
// rustc: compiler/rustc_hir_typeck/src/upvar.rs:1333 compute_2229_migrations_for_trait
FnCtxt.prototype.compute_2229_migrations_for_trait = function (
  this: FnCtxt,
  min_captures: RootVariableMinCaptureList | undefined,
  var_hir_id: HirId,
  closure_clause: ast.CaptureBy,
): Map<UpvarMigrationInfo, Set<string>> | undefined {
  const auto_traits_def_id = [
    this.tcx.lang_items().clone_trait(),
    this.tcx.lang_items().sync_trait(),
    this.tcx.get_diagnostic_item(sym.Send),
    this.tcx.lang_items().unpin_trait(),
    this.tcx.get_diagnostic_item(sym.unwind_safe_trait),
    this.tcx.get_diagnostic_item(sym.ref_unwind_safe_trait),
  ];
  const AUTO_TRAITS: readonly string[] = ["`Clone`", "`Sync`", "`Send`", "`Unpin`", "`UnwindSafe`", "`RefUnwindSafe`"];

  const root_var_min_capture_list = min_captures?.get(var_hir_id);
  if (root_var_min_capture_list === undefined) return undefined;

  let ty = this.deeply_resolve_ignoring_regions(this.node_ty(var_hir_id), fold_Ty);

  switch (closure_clause.$) {
    case "Value":
      // For move closure the capture kind should be by value
      break;
    case "Ref":
    case "Use": {
      // For non move closure the capture kind is the max capture kind of all captures
      // according to the ordering ImmBorrow < UniqueImmBorrow < MutBorrow < ByValue
      let max_capture_info = unwrap(root_var_min_capture_list[0]).info;
      for (const capture of root_var_min_capture_list) {
        max_capture_info = determine_capture_info(max_capture_info, capture.info);
      }

      ty = apply_capture_kind_on_capture_ty(this.tcx, ty, max_capture_info.capture_kind, this.tcx.lifetimes.re_erased);
      break;
    }
  }

  const obligations_should_hold: boolean[] = [];
  // Checks if a root variable implements any of the auto traits
  for (const check_trait of auto_traits_def_id) {
    obligations_should_hold.push(
      check_trait !== undefined && EvaluationResult.must_apply_modulo_regions(this.infcx.type_implements_trait(check_trait, [ty], this.param_env)),
    );
  }

  const problematic_captures = new KeyedMap<UpvarMigrationInfo, Set<string>>(intern_key);
  // Check whether captured fields also implement the trait
  for (const capture of root_var_min_capture_list) {
    const ty = apply_capture_kind_on_capture_ty(this.tcx, capture.place.ty(), capture.info.capture_kind, this.tcx.lifetimes.re_erased);

    // Checks if a capture implements any of the auto traits
    const obligations_holds_for_capture: boolean[] = [];
    for (const check_trait of auto_traits_def_id) {
      obligations_holds_for_capture.push(
        check_trait !== undefined && EvaluationResult.must_apply_modulo_regions(this.infcx.type_implements_trait(check_trait, [ty], this.param_env)),
      );
    }

    const capture_problems = new Set<string>();

    // Checks if for any of the auto traits, one or more trait is implemented
    // by the root variable but not by the capture
    for (let idx = 0; idx < obligations_should_hold.length; idx++) {
      if (!obligations_holds_for_capture[idx]! && obligations_should_hold[idx]!) {
        capture_problems.add(AUTO_TRAITS[idx]!);
      }
    }

    if (capture_problems.size !== 0) {
      problematic_captures.set(
        {
          $: "CapturingPrecise",
          source_expr: capture.info.path_expr_id,
          var_name: capture.to_string(this.tcx),
        },
        capture_problems,
      );
    }
  }
  if (problematic_captures.size !== 0) {
    return problematic_captures;
  }
  return undefined;
};

/// Figures out the list of root variables (and their types) that aren't completely
/// captured by the closure when `capture_disjoint_fields` is enabled and drop order of
/// some path starting at that root variable **might** be affected.
///
/// The output list would include a root variable if:
/// - It would have been moved into the closure when `capture_disjoint_fields` wasn't
///   enabled, **and**
/// - It wasn't completely captured by the closure, **and**
/// - One of the paths starting at this root variable, that is not captured needs Drop.
///
/// This function only returns a HashSet of CapturesInfo for significant drops. If there
/// are no significant drops than None is returned
// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_hir_typeck/src/upvar.rs:1442 compute_2229_migrations_for_drop
FnCtxt.prototype.compute_2229_migrations_for_drop = function (
  this: FnCtxt,
  closure_def_id: LocalDefId,
  closure_span: Span,
  min_captures: RootVariableMinCaptureList | undefined,
  closure_clause: ast.CaptureBy,
  var_hir_id: HirId,
): Set<UpvarMigrationInfo> | undefined {
  const ty = this.deeply_resolve_ignoring_regions(this.node_ty(var_hir_id), fold_Ty);

  // FIXME(#132279): Using `non_body_analysis` here feels wrong.
  if (!ty.has_significant_drop(this.tcx, TypingEnv.non_body_analysis(this.tcx, closure_def_id))) {
    // debug!("does not have significant drop");
    return undefined;
  }

  const root_var_min_capture_list = min_captures?.get(var_hir_id);
  if (root_var_min_capture_list === undefined) {
    // The upvar is mentioned within the closure but no path starting from it is
    // used. This occurs when you have (e.g.)
    //
    // ```
    // let x = move || {
    //     let _ = y;
    // });
    // ```
    // debug!("no path starting from it is used");

    switch (closure_clause.$) {
      // Only migrate if closure is a move closure
      case "Value": {
        const diagnostics_info = new KeyedSet<UpvarMigrationInfo>(intern_key);
        const upvars = this.tcx.upvars_mentioned(LocalDefIdC.to_def_id(closure_def_id));
        if (upvars === undefined) panic("must be an upvar");
        const upvar = upvars.get(var_hir_id) as hir.Upvar | undefined;
        // PORT: `upvars[&var_hir_id]` (`impl Index for IndexMap`) panics on a missing key.
        if (upvar === undefined) panic("IndexMap: key not found");
        diagnostics_info.add({ $: "CapturingNothing", use_span: upvar.span });
        return diagnostics_info;
      }
      case "Ref":
      case "Use":
        break;
    }

    return undefined;
  }
  // debug!(?root_var_min_capture_list);

  const projections_list: Projection[][] = [];
  const diagnostics_info = new KeyedSet<UpvarMigrationInfo>(intern_key);

  for (const captured_place of root_var_min_capture_list) {
    switch (captured_place.info.capture_kind.$) {
      // Only care about captures that are moved into the closure
      case "ByValue":
      case "ByUse":
        projections_list.push(captured_place.place.projections);
        diagnostics_info.add({
          $: "CapturingPrecise",
          source_expr: captured_place.info.path_expr_id,
          var_name: captured_place.to_string(this.tcx),
        });
        break;
      case "ByRef":
        break;
    }
  }

  // debug!(?projections_list);
  // debug!(?diagnostics_info);

  const is_moved = projections_list.length !== 0;
  // debug!(?is_moved);

  const is_not_completely_captured = root_var_min_capture_list.some((capture) => capture.place.projections.length !== 0);
  // debug!(?is_not_completely_captured);

  if (is_moved && is_not_completely_captured && this.has_significant_drop_outside_of_captures(closure_def_id, closure_span, ty, projections_list)) {
    return diagnostics_info;
  }

  return undefined;
};

/// Figures out the list of root variables (and their types) that aren't completely
/// captured by the closure when `capture_disjoint_fields` is enabled and either drop
/// order of some path starting at that root variable **might** be affected or auto-traits
/// differ between the root variable and the captured paths.
///
/// The output list would include a root variable if:
/// - It would have been moved into the closure when `capture_disjoint_fields` wasn't
///   enabled, **and**
/// - It wasn't completely captured by the closure, **and**
/// - One of the paths starting at this root variable, that is not captured needs Drop **or**
/// - One of the paths captured does not implement all the auto-traits its root variable
///   implements.
///
/// Returns a tuple containing a vector of MigrationDiagnosticInfo, as well as a String
/// containing the reason why root variables whose HirId is contained in the vector should
/// be captured
// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_hir_typeck/src/upvar.rs:1549 compute_2229_migrations
FnCtxt.prototype.compute_2229_migrations = function (
  this: FnCtxt,
  closure_def_id: LocalDefId,
  closure_span: Span,
  closure_clause: ast.CaptureBy,
  min_captures: RootVariableMinCaptureList | undefined,
): [NeededMigration[], MigrationWarningReason] {
  const upvars = this.tcx.upvars_mentioned(LocalDefIdC.to_def_id(closure_def_id));
  if (upvars === undefined) {
    return [[], new MigrationWarningReason([], false)];
  }

  const need_migrations: NeededMigration[] = [];
  const auto_trait_migration_reasons = new Set<string>();
  let drop_migration_needed = false;

  // Perform auto-trait analysis
  for (const [var_hir_id_] of upvars) {
    // PORT: the `upvars_mentioned` query value's key type (queries.gen.ts) is rustc_lint_defs' `HirId` alias.
    const var_hir_id = var_hir_id_ as unknown as HirId;
    const diagnostics_info: MigrationLintNote[] = [];

    const auto_trait_diagnostic = this.compute_2229_migrations_for_trait(min_captures, var_hir_id, closure_clause) ?? new KeyedMap<UpvarMigrationInfo, Set<string>>(intern_key);

    let drop_reorder_diagnostic: Set<UpvarMigrationInfo>;
    const d = this.compute_2229_migrations_for_drop(closure_def_id, closure_span, min_captures, closure_clause, var_hir_id);
    if (d !== undefined) {
      drop_migration_needed = true;
      drop_reorder_diagnostic = d;
    } else {
      drop_reorder_diagnostic = new KeyedSet<UpvarMigrationInfo>(intern_key);
    }

    // Combine all the captures responsible for needing migrations into one IndexSet
    const capture_diagnostic_set = new KeyedSet<UpvarMigrationInfo>(intern_key, drop_reorder_diagnostic);
    for (const key of auto_trait_diagnostic.keys()) {
      capture_diagnostic_set.add(clone_UpvarMigrationInfo_(key));
    }

    const capture_diagnostic = [...capture_diagnostic_set];
    // PORT: `sort_by_cached_key` is stable; the key `(0, Some(var_name))` / `(1, None)` compares the tag, then the
    // `String` (byte order).
    const sort_key = (info: UpvarMigrationInfo): [number, string | undefined] => {
      switch (info.$) {
        case "CapturingPrecise":
          return [0, info.var_name];
        case "CapturingNothing":
          return [1, undefined];
      }
    };
    const keyed = capture_diagnostic.map((info) => [sort_key(info), info] as const);
    keyed.sort(([ka], [kb]) => {
      if (ka[0] !== kb[0]) return ka[0] < kb[0] ? -1 : 1;
      if (ka[1] === undefined) return kb[1] === undefined ? 0 : -1;
      if (kb[1] === undefined) return 1;
      return str_cmp(ka[1], kb[1]);
    });
    for (const [, captures_info] of keyed) {
      // Get the auto trait reasons of why migration is needed because of that capture, if there are any
      const reasons = auto_trait_diagnostic.get(captures_info);
      const capture_trait_reasons = reasons !== undefined ? new Set(reasons) : new Set<string>();

      // Check if migration is needed because of drop reorder as a result of that capture
      const capture_drop_reorder_reason = drop_reorder_diagnostic.has(captures_info);

      // Combine all the reasons of why the root variable should be captured as a result of
      // auto trait implementation issues
      for (const r of capture_trait_reasons) auto_trait_migration_reasons.add(r);

      diagnostics_info.push({
        captures_info,
        reason: this.compute_2229_migrations_reasons(capture_trait_reasons, capture_drop_reorder_reason),
      });
    }

    if (diagnostics_info.length !== 0) {
      need_migrations.push({ var_hir_id, diagnostics_info });
    }
  }
  return [need_migrations, this.compute_2229_migrations_reasons(auto_trait_migration_reasons, drop_migration_needed)];
};

/// This is a helper function to `compute_2229_migrations_precise_pass`. Provided the type
/// of a root variable and a list of captured paths starting at this root variable (expressed
/// using list of `Projection` slices), it returns true if there is a path that is not
/// captured starting at this root variable that implements Drop.
///
/// The way this function works is at a given call it looks at type `base_path_ty` of some base
/// path say P and then list of projection slices which represent the different captures moved
/// into the closure starting off of P.
///
/// This will make more sense with an example:
///
/// ```rust,edition2021
///
/// struct FancyInteger(i32); // This implements Drop
///
/// struct Point { x: FancyInteger, y: FancyInteger }
/// struct Color;
///
/// struct Wrapper { p: Point, c: Color }
///
/// fn f(w: Wrapper) {
///   let c = || {
///       // Closure captures w.p.x and w.c by move.
///   };
///
///   c();
/// }
/// ```
///
/// If `capture_disjoint_fields` wasn't enabled the closure would've moved `w` instead of the
/// precise paths. If we look closely `w.p.y` isn't captured which implements Drop and
/// therefore Drop ordering would change and we want this function to return true.
///
/// Call stack to figure out if we need to migrate for `w` would look as follows:
///
/// Our initial base path is just `w`, and the paths captured from it are `w[p, x]` and
/// `w[c]`.
/// Notation:
/// - Ty(place): Type of place
/// - `(a, b)`: Represents the function parameters `base_path_ty` and `captured_by_move_projs`
///   respectively.
/// ```ignore (illustrative)
///                  (Ty(w), [ &[p, x], &[c] ])
/// //                              |
/// //                 ----------------------------
/// //                 |                          |
/// //                 v                          v
///        (Ty(w.p), [ &[x] ])          (Ty(w.c), [ &[] ]) // I(1)
/// //                 |                          |
/// //                 v                          v
///        (Ty(w.p), [ &[x] ])                 false
/// //                 |
/// //                 |
/// //       -------------------------------
/// //       |                             |
/// //       v                             v
///     (Ty((w.p).x), [ &[] ])     (Ty((w.p).y), []) // IMP 2
/// //       |                             |
/// //       v                             v
///        false              NeedsSignificantDrop(Ty(w.p.y))
/// //                                     |
/// //                                     v
///                                      true
/// ```
///
/// IMP 1 `(Ty(w.c), [ &[] ])`: Notice the single empty slice inside `captured_projs`.
///                             This implies that the `w.c` is completely captured by the closure.
///                             Since drop for this path will be called when the closure is
///                             dropped we don't need to migrate for it.
///
/// IMP 2 `(Ty((w.p).y), [])`: Notice that `captured_projs` is empty. This implies that this
///                             path wasn't captured by the closure. Also note that even
///                             though we didn't capture this path, the function visits it,
///                             which is kind of the point of this function. We then return
///                             if the type of `w.p.y` implements Drop, which in this case is
///                             true.
///
/// Consider another example:
///
/// ```ignore (pseudo-rust)
/// struct X;
/// impl Drop for X {}
///
/// struct Y(X);
/// impl Drop for Y {}
///
/// fn foo() {
///     let y = Y(X);
///     let c = || move(y.0);
/// }
/// ```
///
/// Note that `y.0` is captured by the closure. When this function is called for `y`, it will
/// return true, because even though all paths starting at `y` are captured, `y` itself
/// implements Drop which will be affected since `y` isn't completely captured.
// rustc: compiler/rustc_hir_typeck/src/upvar.rs:1732 has_significant_drop_outside_of_captures
FnCtxt.prototype.has_significant_drop_outside_of_captures = function (
  this: FnCtxt,
  closure_def_id: LocalDefId,
  closure_span: Span,
  base_path_ty: Ty,
  captured_by_move_projs: readonly Projection[][],
): boolean {
  // FIXME(#132279): Using `non_body_analysis` here feels wrong.
  const needs_drop = (ty: Ty): boolean => ty.has_significant_drop(this.tcx, TypingEnv.non_body_analysis(this.tcx, closure_def_id));

  const is_drop_defined_for_ty_ = (ty: Ty): boolean => {
    const drop_trait = this.tcx.require_lang_item(LangItem.Drop, closure_span);
    return EvaluationResult.must_apply_modulo_regions(
      this.infcx.type_implements_trait(drop_trait, [ty], this.tcx.param_env(LocalDefIdC.to_def_id(closure_def_id)) as ParamEnv),
    );
  };

  const is_drop_defined_for_ty = is_drop_defined_for_ty_(base_path_ty);

  // If there is a case where no projection is applied on top of current place
  // then there must be exactly one capture corresponding to such a case. Note that this
  // represents the case of the path being completely captured by the variable.
  //
  // eg. If `a.b` is captured and we are processing `a.b`, then we can't have the closure also
  //     capture `a.b.c`, because that violates min capture.
  const is_completely_captured = captured_by_move_projs.some((projs) => projs.length === 0);

  assert(!is_completely_captured || captured_by_move_projs.length === 1, "assertion failed: !is_completely_captured || (captured_by_move_projs.len() == 1)");

  if (is_completely_captured) {
    // The place is captured entirely, so doesn't matter if needs dtor, it will be drop
    // when the closure is dropped.
    return false;
  }

  if (captured_by_move_projs.length === 0) {
    return needs_drop(base_path_ty);
  }

  if (is_drop_defined_for_ty) {
    // If drop is implemented for this type then we need it to be fully captured,
    // and we know it is not completely captured because of the previous checks.

    // Note that this is a bug in the user code that will be reported by the
    // borrow checker, since we can't move out of drop types.

    // The bug exists in the user's code pre-migration, and we don't migrate here.
    return false;
  }

  const k = base_path_ty.kind();
  // Observations:
  // - `captured_by_move_projs` is not empty. Therefore we can call
  //   `captured_by_move_projs.first().unwrap()` safely.
  // - All entries in `captured_by_move_projs` have at least one projection.
  //   Therefore we can call `captured_by_move_projs.first().unwrap().first().unwrap()` safely.

  // We don't capture derefs in case of move captures, which would have be applied to
  // access any further paths.
  if (k.$ === "Adt" && k._0.is_box()) {
    return unreachable();
  } else if (k.$ === "Ref") {
    return unreachable();
  } else if (k.$ === "RawPtr") {
    return unreachable();
  } else if (k.$ === "Adt") {
    const def = k._0;
    const args = k._1;
    // Multi-variant enums are captured in entirety,
    // which would've been handled in the case of single empty slice in `captured_by_move_projs`.
    assert_eq(def.variants().length, 1, String);

    // Only Field projections can be applied to a non-box Adt.
    assert(
      captured_by_move_projs.every((projs) => unwrap(projs[0]).kind.$ === "Field"),
      "assertion failed: captured_by_move_projs.iter().all(|projs|\n        matches!(projs.first().unwrap().kind, ProjectionKind::Field(..)))",
    );
    const fields = unwrap(def.variants()[FIRST_VARIANT]).fields;
    return fields.some((field, i) => {
      const paths_using_field: Projection[][] = [];
      for (const projs of captured_by_move_projs) {
        const kind = unwrap(projs[0]).kind;
        if (kind.$ === "Field") {
          const field_idx = kind._0;
          if (field_idx === i) paths_using_field.push(projs.slice(1));
        } else {
          return unreachable();
        }
      }

      const after_field_ty = Unnormalized.skip_norm_wip(field.ty(this.tcx, args));
      return this.has_significant_drop_outside_of_captures(closure_def_id, closure_span, after_field_ty, paths_using_field);
    });
  } else if (k.$ === "Tuple") {
    const fields = k._0;
    // Only Field projections can be applied to a tuple.
    assert(
      captured_by_move_projs.every((projs) => unwrap(projs[0]).kind.$ === "Field"),
      "assertion failed: captured_by_move_projs.iter().all(|projs|\n        matches!(projs.first().unwrap().kind, ProjectionKind::Field(..)))",
    );

    return fields.some((element_ty, i) => {
      const paths_using_field: Projection[][] = [];
      for (const projs of captured_by_move_projs) {
        const kind = unwrap(projs[0]).kind;
        if (kind.$ === "Field") {
          const field_idx = kind._0;
          if (field_idx === i) paths_using_field.push(projs.slice(1));
        } else {
          return unreachable();
        }
      }

      return this.has_significant_drop_outside_of_captures(closure_def_id, closure_span, element_ty, paths_using_field);
    });
  }
  // Anything else would be completely captured and therefore handled already.
  else {
    return unreachable(`unexpected base_path_ty: ${debug_Ty_str(base_path_ty)}`);
  }
};

// rustc: compiler/rustc_hir_typeck/src/upvar.rs:1874 init_capture_kind_for_place
FnCtxt.prototype.init_capture_kind_for_place = function (this: FnCtxt, place: Place, capture_clause: ast.CaptureBy): UpvarCapture {
  // In case of a move closure if the data is accessed through a reference we
  // want to capture by ref to allow precise capture using reborrows.
  //
  // If the data will be moved out of this place, then the place will be truncated
  // at the first Deref in `adjust_for_move_closure` and then moved into the closure.
  //
  // For example:
  //
  // struct Buffer<'a> {
  //     x: &'a String,
  //     y: Vec<u8>,
  // }
  //
  // fn get<'a>(b: Buffer<'a>) -> impl Sized + 'a {
  //     let c = move || b.x;
  //     drop(b);
  //     c
  // }
  //
  // Even though the closure is declared as move, when we are capturing borrowed data (in
  // this case, *b.x) we prefer to capture by reference.
  // Otherwise you'd get an error in 2021 immediately because you'd be trying to take
  // ownership of the (borrowed) String or else you'd take ownership of b, as in 2018 and
  // before, which is also an error.
  if (capture_clause.$ === "Value" && !iter_any(place.deref_tys(), (t) => t.is_ref())) {
    return UpvarCapture.ByValue;
  } else if (capture_clause.$ === "Use" && !iter_any(place.deref_tys(), (t) => t.is_ref())) {
    return UpvarCapture.ByUse;
  } else {
    return { $: "ByRef", _0: BorrowKind.Immutable };
  }
};

// rustc: compiler/rustc_hir_typeck/src/upvar.rs:1916 place_for_root_variable
FnCtxt.prototype.place_for_root_variable = function (this: FnCtxt, closure_def_id: LocalDefId, var_hir_id: HirId): Place {
  const upvar_id = UpvarId.new(var_hir_id, closure_def_id);

  const place = new Place(this.node_ty(var_hir_id), { $: "Upvar", _0: upvar_id }, []);

  // Normalize eagerly when inserting into `capture_information`, so all downstream
  // capture analysis can assume a normalized `Place`.
  return this.normalize(this.tcx.hir_span(var_hir_id), Unnormalized.new_wip(place), fold_Place);
};

// rustc: compiler/rustc_hir_typeck/src/upvar.rs:1934 should_log_capture_analysis
FnCtxt.prototype.should_log_capture_analysis = function (this: FnCtxt, closure_def_id: LocalDefId): boolean {
  return this.has_rustc_attrs && find_attr(HasAttrs_LocalDefId.get_attrs(closure_def_id, this.tcx), (k) => (k.$ === "RustcCaptureAnalysis" ? null : undefined)) !== undefined;
};

// rustc: compiler/rustc_hir_typeck/src/upvar.rs:1938 log_capture_analysis_first_pass
FnCtxt.prototype.log_capture_analysis_first_pass = function (this: FnCtxt, closure_def_id: LocalDefId, capture_information: InferredCaptureInformation, closure_span: Span): void {
  if (this.should_log_capture_analysis(closure_def_id)) {
    const diag = this.dcx().struct_span_err(closure_span, "First Pass analysis includes:");
    for (const [place, capture_info] of capture_information) {
      const capture_str = construct_capture_info_string(this.tcx, place as Place, capture_info);
      const output_str = `Capturing ${capture_str}`;

      const span = capture_info.path_expr_id === undefined ? closure_span : this.tcx.hir_span(capture_info.path_expr_id);
      diag.span_note(span, output_str);
    }
    diag.emit();
  }
};

// rustc: compiler/rustc_hir_typeck/src/upvar.rs:1958 log_closure_min_capture_info
FnCtxt.prototype.log_closure_min_capture_info = function (this: FnCtxt, closure_def_id: LocalDefId, closure_span: Span): void {
  if (this.should_log_capture_analysis(closure_def_id)) {
    const min_captures = this.typeck_results.closure_min_captures.get(closure_def_id);
    if (min_captures !== undefined) {
      const diag = this.dcx().struct_span_err(closure_span, "Min Capture analysis includes:");

      for (const [, min_captures_for_var] of min_captures) {
        for (const capture of min_captures_for_var) {
          const place = capture.place;
          const capture_info = capture.info;

          const capture_str = construct_capture_info_string(this.tcx, place, capture_info);
          const output_str = `Min Capture ${capture_str}`;

          if (!HirId_opt_eq(capture.info.path_expr_id, capture.info.capture_kind_expr_id)) {
            const path_span = capture_info.path_expr_id === undefined ? closure_span : this.tcx.hir_span(capture_info.path_expr_id);
            const capture_kind_span = capture_info.capture_kind_expr_id === undefined ? closure_span : this.tcx.hir_span(capture_info.capture_kind_expr_id);

            const multi_span: MultiSpan = MultiSpan.from_spans([path_span, capture_kind_span]);

            const capture_kind_label = construct_capture_kind_reason_string(this.tcx, place, capture_info);
            const path_label = construct_path_string(this.tcx, place);

            multi_span.push_span_label(path_span, path_label);
            multi_span.push_span_label(capture_kind_span, capture_kind_label);

            diag.span_note(multi_span, output_str);
          } else {
            const span = capture_info.path_expr_id === undefined ? closure_span : this.tcx.hir_span(capture_info.path_expr_id);

            diag.span_note(span, output_str);
          }
        }
      }
      diag.emit();
    }
  }
};

/// A captured place is mutable if
/// 1. Projections don't include a Deref of an immut-borrow, **and**
/// 2. PlaceBase is mut or projections include a Deref of a mut-borrow.
// rustc: compiler/rustc_hir_typeck/src/upvar.rs:2011 determine_capture_mutability
FnCtxt.prototype.determine_capture_mutability = function (this: FnCtxt, typeck_results: TypeckResults, place: Place): Mutability {
  let var_hir_id: HirId;
  const base = place.base;
  switch (base.$) {
    case "Upvar":
      var_hir_id = base._0.var_path.hir_id;
      break;
    default:
      return unreachable();
  }

  const bm = typeck_results.pat_binding_modes().get(var_hir_id);
  if (bm === undefined) panic("missing binding mode");

  let is_mutbl = bm._1;

  for (const pointer_ty of place.deref_tys()) {
    const k = this.structurally_resolve_type(this.tcx.hir_span(var_hir_id), pointer_ty).kind();
    // We don't capture derefs of raw ptrs
    if (k.$ === "RawPtr") {
      return unreachable();
    }
    // Dereferencing a mut-ref allows us to mut the Place if we don't deref
    // an immut-ref after on top of this.
    else if (k.$ === "Ref" && k._2 === "Mut") {
      is_mutbl = "Mut";
    }
    // The place isn't mutable once we dereference an immutable reference.
    else if (k.$ === "Ref" && k._2 === "Not") {
      return "Not";
    }
    // Dereferencing a box doesn't change mutability
    else if (k.$ === "Adt" && k._0.is_box()) {
      // {}
    } else {
      const unexpected_ty = k;
      return span_bug(this.tcx.hir_span(var_hir_id), `deref of unexpected pointer type ${debug_TyKind_str(unexpected_ty)}`);
    }
  }

  return is_mutbl;
};
// }

/// Determines whether a child capture that is derived from a parent capture
/// should be borrowed with the lifetime of the parent coroutine-closure's env.
///
/// There are two cases when this needs to happen:
///
/// (1.) Are we borrowing data owned by the parent closure? We can determine if
/// that is the case by checking if the parent capture is by move, EXCEPT if we
/// apply a deref projection of an immutable reference, reborrows of immutable
/// references which aren't restricted to the LUB of the lifetimes of the deref
/// chain. This is why `&'short mut &'long T` can be reborrowed as `&'long T`.
///
/// ```rust
/// let x = &1i32; // Let's call this lifetime `'1`.
/// let c = async move || {
///     println!("{:?}", *x);
///     // Even though the inner coroutine borrows by ref, we're only capturing `*x`,
///     // not `x`, so the inner closure is allowed to reborrow the data for `'1`.
/// };
/// ```
///
/// (2.) If a coroutine is mutably borrowing from a parent capture, then that
/// mutable borrow cannot live for longer than either the parent *or* the borrow
/// that we have on the original upvar. Therefore we always need to borrow the
/// child capture with the lifetime of the parent coroutine-closure's env.
///
/// ```rust
/// let mut x = 1i32;
/// let c = async || {
///     x = 1;
///     // The parent borrows `x` for some `&'1 mut i32`.
///     // However, when we call `c()`, we implicitly autoref for the signature of
///     // `AsyncFnMut::async_call_mut`. Let's call that lifetime `'call`. Since
///     // the maximum that `&'call mut &'1 mut i32` can be reborrowed is `&'call mut i32`,
///     // the inner coroutine should capture w/ the lifetime of the coroutine-closure.
/// };
/// ```
///
/// If either of these cases apply, then we should capture the borrow with the
/// lifetime of the parent coroutine-closure's env. Luckily, if this function is
/// not correct, then the program is not unsound, since we still borrowck and validate
/// the choices made from this function -- the only side-effect is that the user
/// may receive unnecessary borrowck errors.
// rustc: compiler/rustc_hir_typeck/src/upvar.rs:2094 should_reborrow_from_env_of_parent_coroutine_closure
export function should_reborrow_from_env_of_parent_coroutine_closure(parent_capture: CapturedPlace, child_capture: CapturedPlace): boolean {
  const child_place = child_capture.place;
  const parent_len = parent_capture.place.projections.length;
  // (1.)
  return (
    (!parent_capture.is_by_ref() &&
      // This is just inlined `place.deref_tys()` but truncated to just
      // the child projections. Namely, look for a `&T` deref, since we
      // can always extend `&'short mut &'long T` to `&'long T`.
      !child_place.projections.some((proj, idx) => {
        if (idx < parent_len) return false;
        if (proj.kind.$ !== "Deref") return false;
        const k = child_place.ty_before_projection(idx).kind();
        return k.$ === "Ref" && k._2 === "Not";
      })) ||
    // (2.)
    (child_capture.info.capture_kind.$ === "ByRef" && child_capture.info.capture_kind._0 === "Mutable")
  );
}

/// Truncate the capture so that the place being borrowed is in accordance with RFC 1240,
/// which states that it's unsafe to take a reference into a struct marked `repr(packed)`.
// rustc: compiler/rustc_hir_typeck/src/upvar.rs:2122 restrict_repr_packed_field_ref_capture
export function restrict_repr_packed_field_ref_capture(place: Place, curr_borrow_kind_: UpvarCapture): [Place, UpvarCapture] {
  const curr_borrow_kind: MutRef<UpvarCapture> = { value: curr_borrow_kind_ };
  const p_ = place;
  const pos_ = p_.projections.findIndex((p, i) => {
    const ty = p_.ty_before_projection(i);

    // Return true for fields of packed structs.
    switch (p.kind.$) {
      case "Field": {
        const k = ty.kind();
        if (k.$ === "Adt" && k._0.repr().packed()) {
          // We stop here regardless of field alignment. Field alignment can change as
          // types change, including the types of private fields in other crates, and that
          // shouldn't affect how we compute our captures.
          return true;
        }
        return false;
      }
      default:
        return false;
    }
  });
  const pos = pos_ < 0 ? undefined : pos_;

  if (pos !== undefined) {
    truncate_place_to_len_and_update_capture_kind(place, curr_borrow_kind, pos);
  }

  return [place, curr_borrow_kind.value];
}

/// Returns a Ty that applies the specified capture kind on the provided capture Ty
// rustc: compiler/rustc_hir_typeck/src/upvar.rs:2153 apply_capture_kind_on_capture_ty
export function apply_capture_kind_on_capture_ty(tcx: TyCtxt, ty: Ty, capture_kind: UpvarCapture, region: Region): Ty {
  switch (capture_kind.$) {
    case "ByValue":
    case "ByUse":
      return ty;
    case "ByRef": {
      const kind = capture_kind._0;
      return Ty.new_ref(tcx, region, ty, BorrowKind.to_mutbl_lossy(kind));
    }
  }
}

/// Returns the Span of where the value with the provided HirId would be dropped
// rustc: compiler/rustc_hir_typeck/src/upvar.rs:2166 drop_location_span
export function drop_location_span(tcx: TyCtxt, hir_id_: HirId): Span | undefined {
  const owner_id = tcx.hir_get_enclosing_scope(hir_id_);
  if (owner_id === undefined) return undefined;

  let hir_id: HirId;
  const node = tcx.hir_node(owner_id);
  if (node.$ === "Item" && node._0.kind.$ === "Fn") {
    hir_id = node._0.kind.body.hir_id;
  } else if (node.$ === "Block") {
    hir_id = node._0.hir_id;
  } else if (node.$ === "TraitItem") {
    hir_id = node._0.hir_id();
  } else if (node.$ === "ImplItem") {
    hir_id = node._0.hir_id();
  } else {
    return undefined;
  }
  return tcx.sess.source_map().end_point(tcx.hir_span(hir_id));
}

// rustc-type: compiler/rustc_hir_typeck/src/upvar.rs:2179 InferBorrowKind
// PORT: hand class (decls.ts "Representation" 7) implementing decls.ts `Delegate` (`impl euv::Delegate`).
export class InferBorrowKind implements Delegate {
  constructor(
    public fcx: FnCtxt,
    // The def-id of the closure whose kind and upvar accesses are being inferred.
    public closure_def_id: LocalDefId,

    /// For each Place that is captured by the closure, we track the minimal kind of
    /// access we need (ref, ref mut, move, etc) and the expression that resulted in such access.
    ///
    /// Consider closure where s.str1 is captured via an ImmutableBorrow and
    /// s.str2 via a MutableBorrow
    ///
    /// ```rust,no_run
    /// struct SomeStruct { str1: String, str2: String };
    ///
    /// // Assume that the HirId for the variable definition is `V1`
    /// let mut s = SomeStruct { str1: format!("s1"), str2: format!("s2") };
    ///
    /// let fix_s = |new_s2| {
    ///     // Assume that the HirId for the expression `s.str1` is `E1`
    ///     println!("Updating SomeStruct with str1={0}", s.str1);
    ///     // Assume that the HirId for the expression `*s.str2` is `E2`
    ///     s.str2 = new_s2;
    /// };
    /// ```
    ///
    /// For closure `fix_s`, (at a high level) the map contains
    ///
    /// ```ignore (illustrative)
    /// Place { V1, [ProjectionKind::Field(Index=0, Variant=0)] } : CaptureKind { E1, ImmutableBorrow }
    /// Place { V1, [ProjectionKind::Field(Index=1, Variant=0)] } : CaptureKind { E2, MutableBorrow }
    /// ```
    public capture_information: InferredCaptureInformation,
    public fake_reads: [Place, FakeReadCause, HirId][],
  ) {}

  // impl<'a, 'tcx> euv::Delegate<'tcx> for InferBorrowKind<'a, 'tcx> {

  // #[instrument(skip(self), level = "debug")]
  // rustc: compiler/rustc_hir_typeck/src/upvar.rs:2216 fake_read
  fake_read(place_with_id: PlaceWithHirId, cause: FakeReadCause, diag_expr_id: HirId): void {
    if (place_with_id.place.base.$ !== "Upvar") return;

    // We need to restrict Fake Read precision to avoid fake reading unsafe code,
    // such as deref of a raw pointer.
    const dummy_capture_kind: UpvarCapture = { $: "ByRef", _0: BorrowKind.Immutable };

    const span = this.fcx.tcx.hir_span(diag_expr_id);
    let place = this.fcx.normalize(span, Unnormalized.new_wip(clone_Place(place_with_id.place)), fold_Place);

    [place] = restrict_capture_precision(place, dummy_capture_kind);

    [place] = restrict_repr_packed_field_ref_capture(place, dummy_capture_kind);
    this.fake_reads.push([place, cause, diag_expr_id]);
  }

  // #[instrument(skip(self), level = "debug")]
  // rustc: compiler/rustc_hir_typeck/src/upvar.rs:2238 consume
  consume(place_with_id: PlaceWithHirId, diag_expr_id: HirId): void {
    const base = place_with_id.place.base;
    if (base.$ !== "Upvar") return;
    const upvar_id = base._0;
    assert_eq(this.closure_def_id, upvar_id.closure_expr_id, (v) => debug_LocalDefId_str(v));

    const span = this.fcx.tcx.hir_span(diag_expr_id);
    const place = this.fcx.normalize(span, Unnormalized.new_wip(clone_Place(place_with_id.place)), fold_Place);

    this.capture_information.push([
      place,
      {
        capture_kind_expr_id: diag_expr_id,
        path_expr_id: diag_expr_id,
        capture_kind: UpvarCapture.ByValue,
      },
    ]);
  }

  // #[instrument(skip(self), level = "debug")]
  // rustc: compiler/rustc_hir_typeck/src/upvar.rs:2256 use_cloned
  use_cloned(place_with_id: PlaceWithHirId, diag_expr_id: HirId): void {
    const base = place_with_id.place.base;
    if (base.$ !== "Upvar") return;
    const upvar_id = base._0;
    assert_eq(this.closure_def_id, upvar_id.closure_expr_id, (v) => debug_LocalDefId_str(v));

    const span = this.fcx.tcx.hir_span(diag_expr_id);
    const place = this.fcx.normalize(span, Unnormalized.new_wip(clone_Place(place_with_id.place)), fold_Place);

    this.capture_information.push([
      place,
      {
        capture_kind_expr_id: diag_expr_id,
        path_expr_id: diag_expr_id,
        capture_kind: UpvarCapture.ByUse,
      },
    ]);
  }

  // #[instrument(skip(self), level = "debug")]
  // rustc: compiler/rustc_hir_typeck/src/upvar.rs:2274 borrow
  borrow(place_with_id: PlaceWithHirId, diag_expr_id: HirId, bk: BorrowKind): void {
    const base = place_with_id.place.base;
    if (base.$ !== "Upvar") return;
    const upvar_id = base._0;
    assert_eq(this.closure_def_id, upvar_id.closure_expr_id, (v) => debug_LocalDefId_str(v));

    // The region here will get discarded/ignored
    let capture_kind: UpvarCapture = { $: "ByRef", _0: bk };

    const span = this.fcx.tcx.hir_span(diag_expr_id);
    let place = this.fcx.normalize(span, Unnormalized.new_wip(clone_Place(place_with_id.place)), fold_Place);

    // We only want repr packed restriction to be applied to reading references into a packed
    // struct, and not when the data is being moved. Therefore we call this method here instead
    // of in `restrict_capture_precision`.
    [place, capture_kind] = restrict_repr_packed_field_ref_capture(place, capture_kind);

    // Raw pointers don't inherit mutability
    if (iter_any(place.deref_tys(), (t) => t.is_raw_ptr())) {
      capture_kind = { $: "ByRef", _0: BorrowKind.Immutable };
    }

    this.capture_information.push([
      place,
      {
        capture_kind_expr_id: diag_expr_id,
        path_expr_id: diag_expr_id,
        capture_kind,
      },
    ]);
  }

  // (provided: expr_use_visitor.rs:80)
  copy(place_with_id: PlaceWithHirId, diag_expr_id: HirId): void {
    Delegate_provided.copy(this, place_with_id, diag_expr_id);
  }

  // #[instrument(skip(self), level = "debug")]
  // rustc: compiler/rustc_hir_typeck/src/upvar.rs:2310 mutate
  mutate(assignee_place: PlaceWithHirId, diag_expr_id: HirId): void {
    this.borrow(assignee_place, diag_expr_id, BorrowKind.Mutable);
  }

  // (provided: expr_use_visitor.rs:93)
  bind(binding_place: PlaceWithHirId, diag_expr_id: HirId): void {
    Delegate_provided.bind(this, binding_place, diag_expr_id);
  }
}

/// Rust doesn't permit moving fields out of a type that implements drop
// #[instrument(skip(fcx), ret, level = "debug")]
// rustc: compiler/rustc_hir_typeck/src/upvar.rs:2317 restrict_precision_for_drop_types
export function restrict_precision_for_drop_types(fcx: FnCtxt, place: Place, curr_mode_: UpvarCapture): [Place, UpvarCapture] {
  const curr_mode: MutRef<UpvarCapture> = { value: curr_mode_ };
  if (curr_mode.value.$ === "ByValue" && !fcx.infcx.type_is_copy_modulo_regions(fcx.param_env, place.ty())) {
    for (let i = 0; i < place.projections.length; i++) {
      const k = place.ty_before_projection(i).kind();
      if (k.$ === "Adt" && k._0.destructor(fcx.tcx) !== undefined) {
        truncate_place_to_len_and_update_capture_kind(place, curr_mode, i);
        break;
      }
    }
  }

  return [place, curr_mode.value];
}

/// Truncate `place` so that an `unsafe` block isn't required to capture it.
/// - No projections are applied to raw pointers, since these require unsafe blocks. We capture
///   them completely.
/// - No projections are applied on top of Union ADTs, since these require unsafe blocks.
// rustc: compiler/rustc_hir_typeck/src/upvar.rs:2343 restrict_precision_for_unsafe
export function restrict_precision_for_unsafe(place: Place, curr_mode_: UpvarCapture): [Place, UpvarCapture] {
  const curr_mode: MutRef<UpvarCapture> = { value: curr_mode_ };
  if (place.base_ty.is_raw_ptr()) {
    truncate_place_to_len_and_update_capture_kind(place, curr_mode, 0);
  }

  if (place.base_ty.is_union()) {
    truncate_place_to_len_and_update_capture_kind(place, curr_mode, 0);
  }

  const projections = place.projections;
  for (let i = 0; i < projections.length; i++) {
    const proj = projections[i]!;
    if (proj.ty.is_raw_ptr()) {
      // Don't apply any projections on top of a raw ptr.
      truncate_place_to_len_and_update_capture_kind(place, curr_mode, i + 1);
      break;
    }

    if (proj.ty.is_union()) {
      // Don't capture precise fields of a union.
      truncate_place_to_len_and_update_capture_kind(place, curr_mode, i + 1);
      break;
    }
  }

  return [place, curr_mode.value];
}

/// Truncate projections so that the following rules are obeyed by the captured `place`:
/// - No Index projections are captured, since arrays are captured completely.
/// - No unsafe block is required to capture `place`.
///
/// Returns the truncated place and updated capture mode.
// #[instrument(ret, level = "debug")]
// rustc: compiler/rustc_hir_typeck/src/upvar.rs:2378 restrict_capture_precision
export function restrict_capture_precision(place_: Place, curr_mode_: UpvarCapture): [Place, UpvarCapture] {
  const [place, curr_mode_1] = restrict_precision_for_unsafe(place_, curr_mode_);
  const curr_mode: MutRef<UpvarCapture> = { value: curr_mode_1 };

  if (place.projections.length === 0) {
    // Nothing to do here
    return [place, curr_mode.value];
  }

  const projections = place.projections;
  for (let i = 0; i < projections.length; i++) {
    const proj = projections[i]!;
    switch (proj.kind.$) {
      case "Index":
      case "Subslice":
        // Arrays are completely captured, so we drop Index and Subslice projections
        truncate_place_to_len_and_update_capture_kind(place, curr_mode, i);
        return [place, curr_mode.value];
      case "Deref":
        break;
      case "OpaqueCast":
        break;
      case "Field":
        break;
      case "UnwrapUnsafeBinder":
        break;
    }
  }

  return [place, curr_mode.value];
}

/// Truncate deref of any reference.
// #[instrument(ret, level = "debug")]
// rustc: compiler/rustc_hir_typeck/src/upvar.rs:2408 adjust_for_move_closure
export function adjust_for_move_closure(place: Place, kind_: UpvarCapture): [Place, UpvarCapture] {
  const kind: MutRef<UpvarCapture> = { value: kind_ };
  const first_deref_ = place.projections.findIndex((proj) => proj.kind.$ === "Deref");
  const first_deref = first_deref_ < 0 ? undefined : first_deref_;

  if (first_deref !== undefined) {
    const idx = first_deref;
    truncate_place_to_len_and_update_capture_kind(place, kind, idx);
  }

  return [place, UpvarCapture.ByValue];
}

/// Truncate deref of any reference.
// #[instrument(ret, level = "debug")]
// rustc: compiler/rustc_hir_typeck/src/upvar.rs:2423 adjust_for_use_closure
export function adjust_for_use_closure(place: Place, kind_: UpvarCapture): [Place, UpvarCapture] {
  const kind: MutRef<UpvarCapture> = { value: kind_ };
  const first_deref_ = place.projections.findIndex((proj) => proj.kind.$ === "Deref");
  const first_deref = first_deref_ < 0 ? undefined : first_deref_;

  if (first_deref !== undefined) {
    const idx = first_deref;
    truncate_place_to_len_and_update_capture_kind(place, kind, idx);
  }

  return [place, UpvarCapture.ByUse];
}

/// Adjust closure capture just that if taking ownership of data, only move data
/// from enclosing stack frame.
// #[instrument(ret, level = "debug")]
// rustc: compiler/rustc_hir_typeck/src/upvar.rs:2439 adjust_for_non_move_closure
export function adjust_for_non_move_closure(place: Place, kind_: UpvarCapture): [Place, UpvarCapture] {
  const kind: MutRef<UpvarCapture> = { value: kind_ };
  const contains_deref_ = place.projections.findIndex((proj) => proj.kind.$ === "Deref");
  const contains_deref = contains_deref_ < 0 ? undefined : contains_deref_;

  switch (kind.value.$) {
    case "ByValue":
      if (contains_deref !== undefined) {
        const idx = contains_deref;
        truncate_place_to_len_and_update_capture_kind(place, kind, idx);
      }
      break;

    // A non-`move`/`use` closure that only `.use`s an upvar does not need to
    // own (and thus clone-on-capture) the value. The `ByUse` kind here can only
    // come from a `x.use` in the body (a `use ||` capture clause goes through
    // `adjust_for_use_closure` instead). Capturing such a place by immutable
    // borrow lets the `.use` expression clone per evaluation, rather than also
    // cloning the value into the closure at construction time. See #157141.
    case "ByUse":
      kind.value = { $: "ByRef", _0: BorrowKind.Immutable };
      break;

    case "ByRef":
      break;
  }

  return [place, kind.value];
}

// rustc: compiler/rustc_hir_typeck/src/upvar.rs:2469 construct_place_string
export function construct_place_string(tcx: TyCtxt, place: Place): string {
  let variable_name: string;
  const base = place.base;
  switch (base.$) {
    case "Upvar":
      variable_name = display_Symbol(var_name(tcx, base._0.var_path.hir_id));
      break;
    default:
      return bug("Capture_information should only contain upvars");
  }

  let projections_str = "";
  const projections = place.projections;
  for (let i = 0; i < projections.length; i++) {
    const item = projections[i]!;
    let proj: string;
    switch (item.kind.$) {
      case "Field":
        // `{a:?}` / `{b:?}` of `FieldIdx` / `VariantIdx` (newtype_index! Debug: the number)
        proj = `(${item.kind._0}, ${item.kind._1})`;
        break;
      case "Deref":
        proj = "Deref";
        break;
      case "Index":
        proj = "Index";
        break;
      case "Subslice":
        proj = "Subslice";
        break;
      case "OpaqueCast":
        proj = "OpaqueCast";
        break;
      case "UnwrapUnsafeBinder":
        proj = "UnwrapUnsafeBinder";
        break;
    }
    if (i !== 0) {
      projections_str += ",";
    }
    projections_str += proj;
  }

  return `${variable_name}[${projections_str}]`;
}

// rustc: compiler/rustc_hir_typeck/src/upvar.rs:2494 construct_capture_kind_reason_string
export function construct_capture_kind_reason_string(tcx: TyCtxt, place: Place, capture_info: CaptureInfo): string {
  const place_str = construct_place_string(tcx, place);

  let capture_kind_str: string;
  switch (capture_info.capture_kind.$) {
    case "ByValue":
      capture_kind_str = "ByValue";
      break;
    case "ByUse":
      capture_kind_str = "ByUse";
      break;
    case "ByRef":
      // `{kind:?}` of `ty::BorrowKind` (a fieldless enum: the variant name)
      capture_kind_str = capture_info.capture_kind._0;
      break;
  }

  return `${place_str} captured as ${capture_kind_str} here`;
}

// rustc: compiler/rustc_hir_typeck/src/upvar.rs:2510 construct_path_string
export function construct_path_string(tcx: TyCtxt, place: Place): string {
  const place_str = construct_place_string(tcx, place);

  return `${place_str} used here`;
}

// rustc: compiler/rustc_hir_typeck/src/upvar.rs:2516 construct_capture_info_string
export function construct_capture_info_string(tcx: TyCtxt, place: Place, capture_info: CaptureInfo): string {
  const place_str = construct_place_string(tcx, place);

  let capture_kind_str: string;
  switch (capture_info.capture_kind.$) {
    case "ByValue":
      capture_kind_str = "ByValue";
      break;
    case "ByUse":
      capture_kind_str = "ByUse";
      break;
    case "ByRef":
      // `{kind:?}` of `ty::BorrowKind` (a fieldless enum: the variant name)
      capture_kind_str = capture_info.capture_kind._0;
      break;
  }
  return `${place_str} -> ${capture_kind_str}`;
}

// rustc: compiler/rustc_hir_typeck/src/upvar.rs:2531 var_name
export function var_name(tcx: TyCtxt, var_hir_id: HirId): Symbol {
  return tcx.hir_name(var_hir_id);
}

// #[instrument(level = "debug", skip(tcx))]
// rustc: compiler/rustc_hir_typeck/src/upvar.rs:2536 should_do_rust_2021_incompatible_closure_captures_analysis
export function should_do_rust_2021_incompatible_closure_captures_analysis(tcx: TyCtxt, closure_id: HirId): boolean {
  if (tcx.sess.at_least_rust_2021()) {
    return false;
  }

  return !tcx.lint_level_spec_at_node(RUST_2021_INCOMPATIBLE_CLOSURE_CAPTURES, closure_id).is_allow();
}

/// Return a two string tuple (s1, s2)
/// - s1: Line of code that is needed for the migration: eg: `let _ = (&x, ...)`.
/// - s2: Comma separated names of the variables being migrated.
// rustc: compiler/rustc_hir_typeck/src/upvar.rs:2550 migration_suggestion_for_2229
export function migration_suggestion_for_2229(tcx: TyCtxt, need_migrations: readonly NeededMigration[]): [string, string] {
  const need_migrations_variables = need_migrations.map(({ var_hir_id: v }) => var_name(tcx, v));

  const migration_ref_concat = need_migrations_variables.map((v) => `&${display_Symbol(v)}`).join(", ");

  let migration_string: string;
  if (1 === need_migrations.length) {
    migration_string = `let _ = ${migration_ref_concat}`;
  } else {
    migration_string = `let _ = (${migration_ref_concat})`;
  }

  const migrated_variables_concat = need_migrations_variables.map((v) => `\`${display_Symbol(v)}\``).join(", ");

  return [migration_string, migrated_variables_concat];
}

/// Helper function to determine if we need to escalate CaptureKind from
/// CaptureInfo A to B and returns the escalated CaptureInfo.
/// (Note: CaptureInfo contains CaptureKind and an expression that led to capture it in that way)
///
/// If both `CaptureKind`s are considered equivalent, then the CaptureInfo is selected based
/// on the `CaptureInfo` containing an associated `capture_kind_expr_id`.
///
/// It is the caller's duty to figure out which path_expr_id to use.
///
/// If both the CaptureKind and Expression are considered to be equivalent,
/// then `CaptureInfo` A is preferred. This can be useful in cases where we want to prioritize
/// expressions reported back to the user as part of diagnostics based on which appears earlier
/// in the closure. This can be achieved simply by calling
/// `determine_capture_info(existing_info, current_info)`. This works out because the
/// expressions that occur earlier in the closure body than the current expression are processed before.
/// Consider the following example
/// ```rust,no_run
/// struct Point { x: i32, y: i32 }
/// let mut p = Point { x: 10, y: 10 };
///
/// let c = || {
///     p.x += 10; // E1
///     // ...
///     // More code
///     // ...
///     p.x += 10; // E2
/// };
/// ```
/// `CaptureKind` associated with both `E1` and `E2` will be ByRef(MutBorrow),
/// and both have an expression associated, however for diagnostics we prefer reporting
/// `E1` since it appears earlier in the closure body. When `E2` is being processed we
/// would've already handled `E1`, and have an existing capture_information for it.
/// Calling `determine_capture_info(existing_info_e1, current_info_e2)` will return
/// `existing_info_e1` in this case, allowing us to point to `E1` in case of diagnostics.
// PORT: `ty::CaptureInfo` is `Copy` and passed by value: the result is a copy of the selected argument.
// rustc: compiler/rustc_hir_typeck/src/upvar.rs:2608 determine_capture_info
export function determine_capture_info(capture_info_a: CaptureInfo, capture_info_b: CaptureInfo): CaptureInfo {
  // We select the CaptureKind which ranks higher based the following priority order:
  // (ByUse | ByValue) > MutBorrow > UniqueImmBorrow > ImmBorrow
  switch (UpvarCapture.partial_cmp(capture_info_a.capture_kind, capture_info_b.capture_kind)) {
    case "Equal":
      if (capture_info_a.capture_kind_expr_id !== undefined || (capture_info_a.capture_kind_expr_id === undefined && capture_info_b.capture_kind_expr_id === undefined)) {
        return copy_CaptureInfo(capture_info_a);
      } else {
        return copy_CaptureInfo(capture_info_b);
      }
    case "Greater":
      return copy_CaptureInfo(capture_info_a);
    case "Less":
      return copy_CaptureInfo(capture_info_b);
    case undefined:
      return bug("Same capture can't be ByUse and ByValue at the same time");
  }
}

/// Truncates `place` to have up to `len` projections.
/// `curr_mode` is the current required capture kind for the place.
/// Returns the truncated `place` and the updated required capture kind.
///
/// Note: Capture kind changes from `MutBorrow` to `UniqueImmBorrow` if the truncated part of the `place`
/// contained `Deref` of `&mut`.
// PORT: `curr_mode: &mut ty::UpvarCapture` is overwritten as a whole, so it is a `MutRef<UpvarCapture>` (PORTING §8).
// rustc: compiler/rustc_hir_typeck/src/upvar.rs:2633 truncate_place_to_len_and_update_capture_kind
export function truncate_place_to_len_and_update_capture_kind(place: Place, curr_mode: MutRef<UpvarCapture>, len: number): void {
  const is_mut_ref = (ty: Ty): boolean => {
    const k = ty.kind();
    return k.$ === "Ref" && k._2 === "Mut";
  };

  // If the truncated part of the place contains `Deref` of a `&mut` then convert MutBorrow ->
  // UniqueImmBorrow
  // Note that if the place contained Deref of a raw pointer it would've not been MutBorrow, so
  // we don't need to worry about that case here.
  const p = place;
  const mode = curr_mode.value;
  switch (mode.$) {
    case "ByRef":
      if (mode._0 === "Mutable") {
        for (let i = len; i < p.projections.length; i++) {
          if (p.projections[i]!.kind.$ === "Deref" && is_mut_ref(p.ty_before_projection(i))) {
            curr_mode.value = { $: "ByRef", _0: BorrowKind.UniqueImmutable };
            break;
          }
        }
      }
      break;
    case "ByValue":
    case "ByUse":
      break;
  }

  // `Vec::truncate` (no-op when `len` is not smaller)
  if (len < p.projections.length) p.projections.length = len;
}

/// Determines the Ancestry relationship of Place A relative to Place B
///
/// `PlaceAncestryRelation::Ancestor` implies Place A is ancestor of Place B
/// `PlaceAncestryRelation::Descendant` implies Place A is descendant of Place B
/// `PlaceAncestryRelation::Divergent` implies neither of them is the ancestor of the other.
// rustc: compiler/rustc_hir_typeck/src/upvar.rs:2668 determine_place_ancestry_relation
export function determine_place_ancestry_relation(place_a: Place, place_b: Place): PlaceAncestryRelation {
  // If Place A and Place B don't start off from the same root variable, they are divergent.
  if (!PlaceBase_eq(place_a.base, place_b.base)) {
    return PlaceAncestryRelation.Divergent;
  }

  // Assume of length of projections_a = n
  const projections_a = place_a.projections;

  // Assume of length of projections_b = m
  const projections_b = place_b.projections;

  let same_initial_projections = true;
  const n = Math.min(projections_a.length, projections_b.length);
  for (let i = 0; i < n; i++) {
    if (!ProjectionKind_eq(projections_a[i]!.kind, projections_b[i]!.kind)) {
      same_initial_projections = false;
      break;
    }
  }

  if (same_initial_projections) {
    // First min(n, m) projections are the same
    // Select Ancestor/Descendant
    if (projections_b.length > projections_a.length) {
      return PlaceAncestryRelation.Ancestor;
    } else if (projections_b.length === projections_a.length) {
      return PlaceAncestryRelation.SamePlace;
    } else {
      return PlaceAncestryRelation.Descendant;
    }
  } else {
    return PlaceAncestryRelation.Divergent;
  }
}

/// Reduces the precision of the captured place when the precision doesn't yield any benefit from
/// borrow checking perspective, allowing us to save us on the size of the capture.
///
///
/// Fields that are read through a shared reference will always be read via a shared ref or a copy,
/// and therefore capturing precise paths yields no benefit. This optimization truncates the
/// rightmost deref of the capture if the deref is applied to a shared ref.
///
/// Reason we only drop the last deref is because of the following edge case:
///
/// ```
/// # struct A { field_of_a: Box<i32> }
/// # struct B {}
/// # struct C<'a>(&'a i32);
/// struct MyStruct<'a> {
///    a: &'static A,
///    b: B,
///    c: C<'a>,
/// }
///
/// fn foo<'a, 'b>(m: &'a MyStruct<'b>) -> impl FnMut() + 'static {
///     || drop(&*m.a.field_of_a)
///     // Here we really do want to capture `*m.a` because that outlives `'static`
///
///     // If we capture `m`, then the closure no longer outlives `'static`
///     // it is constrained to `'a`
/// }
/// ```
// #[instrument(ret, level = "debug")]
// rustc: compiler/rustc_hir_typeck/src/upvar.rs:2730 truncate_capture_for_optimization
export function truncate_capture_for_optimization(place: Place, curr_mode_: UpvarCapture): [Place, UpvarCapture] {
  const curr_mode: MutRef<UpvarCapture> = { value: curr_mode_ };
  const is_shared_ref = (ty: Ty): boolean => {
    const k = ty.kind();
    return k.$ === "Ref" && k._2 === "Not";
  };

  // Find the rightmost deref (if any). All the projections that come after this
  // are fields or other "in-place pointer adjustments"; these refer therefore to
  // data owned by whatever pointer is being dereferenced here.
  const idx_ = place.projections.findLastIndex((proj) => proj.kind.$ === "Deref");
  const idx = idx_ < 0 ? undefined : idx_;

  // If that pointer is a shared reference, then we don't need those fields.
  if (idx !== undefined && is_shared_ref(place.ty_before_projection(idx))) {
    truncate_place_to_len_and_update_capture_kind(place, curr_mode, idx + 1);
  } else {
    // None | Some(_) => {}
  }

  return [place, curr_mode.value];
}

/// Precise capture is enabled if user is using Rust Edition 2021 or higher.
/// `span` is the span of the closure.
// rustc: compiler/rustc_hir_typeck/src/upvar.rs:2754 enable_precise_capture
export function enable_precise_capture(span: Span): boolean {
  // We use span here to ensure that if the closure was generated by a macro with a different
  // edition.
  return Span.at_least_rust_2021(span);
}

// ---- helpers (module comment; not markers) -------------------------------------------------------------------------

/// rustc_abi `FIRST_VARIANT` (`VariantIdx::ZERO`).
const FIRST_VARIANT = 0;

/** `ty::CaptureInfo` is `Copy`: a Rust copy that is mutated afterwards. */
function copy_CaptureInfo(v: CaptureInfo): CaptureInfo {
  return { capture_kind_expr_id: v.capture_kind_expr_id, path_expr_id: v.path_expr_id, capture_kind: v.capture_kind };
}

/** `#[derive(Clone)]` of `ty::CapturedPlace` (rustc_middle ty/closure.rs). */
function clone_CapturedPlace(v: CapturedPlace): CapturedPlace {
  return new CapturedPlace(v.var_ident, clone_Place(v.place), copy_CaptureInfo(v.info), v.mutability);
}

/** `UpvarMigrationInfo::clone` (`#[derive(Clone)]`, upvar.gen.ts). */
function clone_UpvarMigrationInfo_(v: UpvarMigrationInfo): UpvarMigrationInfo {
  switch (v.$) {
    case "CapturingPrecise":
      return { $: "CapturingPrecise", source_expr: v.source_expr, var_name: v.var_name };
    case "CapturingNothing":
      return { $: "CapturingNothing", use_span: v.use_span };
  }
}

/** `Vec::retain` (in place, in order). */
function vec_retain<T>(v: T[], f: (x: T) => boolean): void {
  let j = 0;
  for (let i = 0; i < v.length; i++) {
    const x = v[i]!;
    if (f(x)) v[j++] = x;
  }
  v.length = j;
}

/** `Iterator::skip` */
function* iter_skip<T>(it: Iterable<T>, n: number): Generator<T> {
  let i = 0;
  for (const x of it) {
    if (i++ >= n) yield x;
  }
}

/** `Iterator::any` */
function iter_any<T>(it: Iterable<T>, f: (x: T) => boolean): boolean {
  for (const x of it) if (f(x)) return true;
  return false;
}

/** `Option<HirId> == Option<HirId>` */
function HirId_opt_eq(a: HirId | undefined, b: HirId | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return HirId_eq(a, b);
}

/** `Ord for str` (byte-wise on UTF-8 = code point order). */
function str_cmp(a: string, b: string): number {
  const ia = a[Symbol_iterator]();
  const ib = b[Symbol_iterator]();
  for (;;) {
    const x = ia.next();
    const y = ib.next();
    if (x.done) return y.done ? 0 : -1;
    if (y.done) return 1;
    const cx = x.value.codePointAt(0)!;
    const cy = y.value.codePointAt(0)!;
    if (cx !== cy) return cx < cy ? -1 : 1;
  }
}
const Symbol_iterator: typeof globalThis.Symbol.iterator = globalThis.Symbol.iterator;

/** `str::trim_end` (Unicode `White_Space`, as `char::is_whitespace`). */
function str_trim_end(s: string): string {
  const cps = [...s];
  let end = cps.length;
  while (end > 0 && is_whitespace(cps[end - 1]!.codePointAt(0)!)) end--;
  return cps.slice(0, end).join("");
}

/** `s.split_once(|c: char| !c.is_whitespace())` */
function split_once_non_whitespace(s: string): [string, string] | undefined {
  let i = 0;
  for (const ch of s) {
    if (!is_whitespace(ch.codePointAt(0)!)) {
      return [s.slice(0, i), s.slice(i + ch.length)];
    }
    i += ch.length;
  }
  return undefined;
}

// `{:?}` stand-ins used only in `bug!` / `span_bug!` messages.
function debug_HirId_str(v: HirId): string {
  return format_debug(v, debug_HirId, PLAIN);
}
function debug_Ty_str(v: Ty): string {
  return format_debug(v, debug_Ty, PLAIN);
}
function debug_TyKind_str(v: TyKind): string {
  return format_debug(v, debug_TyKind, PLAIN);
}
function debug_LocalDefId_str(v: LocalDefId): string {
  return format_debug(v, debug_LocalDefId, PLAIN);
}

// ---- PORT stand-ins (not markers) ----------------------------------------------------------------------------------

/** `#[derive(TypeFoldable, TypeVisitable)]` of `hir::place::Place` (D4 descriptor; not generated yet). */
const fold_Place: TypeFoldable<Place> = {
  visit_with: () => unported("rustc_middle::hir::place::Place TypeVisitable (hir/place.rs derive; tools/codegen)"),
  try_fold_with: () => unported("rustc_middle::hir::place::Place TypeFoldable (hir/place.rs derive; tools/codegen)"),
  fold_with: () => unported("rustc_middle::hir::place::Place TypeFoldable (hir/place.rs derive; tools/codegen)"),
};
