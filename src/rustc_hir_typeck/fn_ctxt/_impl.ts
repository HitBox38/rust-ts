// Port of compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs (lane typeck-impl).
//
// `impl<'a, 'tcx> FnCtxt<'a, 'tcx>` (fn_ctxt/_impl.rs:49): every method is assigned onto `FnCtxt.prototype` (declared in
// ../decls.ts), in upstream order. The single-fn helper types are local classes inside their fn:
// `UnreachableItem` (a manual `Diagnostic`), `CollectClauses` (an intravisit `Visitor`), `CtorGenericArgsCtxt` (a
// `GenericArgsLowerer`).
// Init order: top-level code here touches only ../decls.ts and other crates; every other rustc_hir_typeck export is read
// inside function bodies only.
import type { Mutability } from "../../rustc_ast_ir/lib.ts";
import { MultiSpan } from "../../rustc_error_messages/lib.ts";
import { Diag, type Diagnostic } from "../../rustc_errors/diagnostic.ts";
import type { Applicability, DiagCtxtHandle, Level } from "../../rustc_errors/lib.ts";
import { GenericsArgsErrExtend } from "../../rustc_hir_analysis/hir_ty_lowering/errors.ts";
import { check_generic_arg_count_for_value_path, lower_generic_args } from "../../rustc_hir_analysis/hir_ty_lowering/generics.ts";
import type { GenericArgsLowerer } from "../../rustc_hir_analysis/decls.ts";
import type { GenericArgCountMismatch, GenericArgCountResult, GenericPathSegment } from "../../rustc_hir_analysis/hir_ty_lowering/mod.gen.ts";
import { ExplicitLateBound } from "../../rustc_hir_analysis/hir_ty_lowering/mod.gen.ts";
import { DefKind_eq, debug_Res, type DefKind, Res, type Res as ResT } from "../../rustc_hir/def.ts";
import * as hir from "../../rustc_hir/lib.ts";
import { Visitor, walk_ty } from "../../rustc_hir/intravisit.ts";
import { debug_HirId, HirId_eq, type HirId } from "../../rustc_hir_id/lib.ts";
import type { InferResult } from "../../rustc_infer/infer/mod.ts";
import { ToTrace_Ty } from "../../rustc_infer/infer/at.ts";
import { Obligation } from "../../rustc_infer/traits/mod.ts";
import { SELF_CONSTRUCTOR_FROM_OUTER_ITEM, UNREACHABLE_CODE } from "../../rustc_lint_defs/builtin.gen.ts";
import type { OriginalQueryValues, QueryResponse } from "../../rustc_middle/infer/canonical.ts";
import type { ObligationCause, ObligationCauseCode } from "../../rustc_middle/traits/mod.ts";
import type { Adjustment } from "../../rustc_middle/ty/adjustment.ts";
import { OverloadedDeref } from "../../rustc_middle/ty/adjustment.ts";
import { AssocItem, type AssocItem as AssocItemT } from "../../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { ClauseKind } from "../../rustc_type_ir/predicate_kind.ts";
import type { Const, FieldIdx } from "../../rustc_middle/ty/decls.ts";
import { Const as ConstC } from "../../rustc_type_ir/sty/consts.ts";
import { fold_Const } from "../../rustc_type_ir/sty/consts.ts";
import { fold_GenericArg, fold_GenericArgs, GenericArg, type GenericArgs, type UserArgs, type UserSelfTy, visit_with_UserSelfTy } from "../../rustc_middle/ty/generic_args.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { GenericClauses, GenericParamDef, type GenericClauses as GenericClausesT, type Generics } from "../../rustc_middle/ty/generics.ts";
import type { Clauses } from "../../rustc_middle/ty/list.ts";
import { Term, Visibility, type FieldDef } from "../../rustc_middle/ty/mod.ts";
import { Ty } from "../../rustc_middle/ty/mod.ts";
import { Predicate_upcast_from_ClauseKind, type Clause } from "../../rustc_middle/ty/predicate.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { debug_Adjustment, debug_Ty, fold_Clause, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { IsIdentity_CanonicalUserType, type CanonicalUserType, type SplattedDef } from "../../rustc_middle/ty/typeck_results.ts";
import { DefId_eq, LocalDefId, debug_LocalDefId, type DefId, type LocalDefId as LocalDefIdT } from "../../rustc_span/def_id.ts";
import { Edition } from "../../rustc_span/edition.ts";
import { display_Ident, Symbol } from "../../rustc_span/symbol.ts";
import { Span, type ErrorGuaranteed, type Span as SpanT } from "../../rustc_span/lib.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { evaluate_const, predicates_for_generics } from "../../rustc_trait_selection/traits/mod.ts";
import type { FulfillmentError } from "../../rustc_trait_selection/traits/mod.gen.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import type { Canonical } from "../../rustc_type_ir/canonical.ts";
import type { TyVid } from "../../rustc_type_ir/decls.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { FnSig, type FnSig as FnSigT } from "../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt, type TypeVisitable, visit_with_Option, visit_with_tuple2 } from "../../rustc_type_ir/visit.ts";
import { debug_vec, PLAIN } from "../../std/fmt.ts";
import { assert, panic, unported, unreachable, unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { FnCtxt } from "../decls.ts";
import type { TypeErrCtxt } from "../../rustc_trait_selection/decls.ts";
import type { DeferredCallResolution, SplatLoweringInfo } from "../callee.gen.ts";
import type { BreakableCtxt } from "../lib.gen.ts";
import type { MethodCallee } from "../method/mod.gen.ts";
import { check_legal_trait_for_method_call } from "../callee.ts";
import {
  CtorIsPrivate_diagnostic,
  SelfCtorFromOuterItem_diagnostic,
  SelfCtorFromOuterItemLint_diagnostic,
  type InnerItem,
  type ReplaceWithName,
} from "../diagnostics.gen.ts";
import { debug_LoweredTy, LoweredTy } from "./mod.gen.ts";

// impl<'a, 'tcx> FnCtxt<'a, 'tcx> {

/// Produces warning on the given node, if the current point in the
/// function is unreachable, and there hasn't been another warning.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:52 warn_if_unreachable
FnCtxt.prototype.warn_if_unreachable = function (this: FnCtxt, id: HirId, span: SpanT, kind: string): void {
  // rustc-type: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:53 UnreachableItem
  class UnreachableItem implements Diagnostic {
    constructor(
      public kind: string,
      public span: SpanT,
      public orig_span: SpanT,
      public custom_note: string | undefined,
    ) {}

    // impl<'a, 'b, 'c> Diagnostic<'a> for UnreachableItem<'b, 'c>
    // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:61 into_diag
    into_diag(dcx: DiagCtxtHandle, level: Level): Diag {
      const { kind, span, orig_span, custom_note } = this;
      const msg = `unreachable ${kind}`;
      return Diag.new(dcx, level, msg)
        .with_span_label(span, msg)
        .with_span_label(orig_span, custom_note !== undefined ? custom_note : "any code following this expression is unreachable");
    }
  }

  const diverges = this.diverges;
  if (diverges.$ !== "Always") {
    return;
  }
  const orig_span = diverges.span;
  const custom_note = diverges.custom_note;

  switch (Span.desugaring_kind(span)?.$) {
    // Don't lint if the result of an async block or async function is `!`.
    // This does not affect the unreachable lints *within* the body.
    case "Async":
      return;

    // Don't lint *within* the `.await` operator, since that's all just desugaring
    // junk. We only want to lint if there is a subsequent expression after the
    // `.await` operator.
    case "Await":
      return;

    default:
      break;
  }

  // Don't emit the lint if we are in an impl marked as `#[automatically_derive]`.
  // This is relevant for deriving `Clone` and `PartialEq` on types containing `!`.
  if (this.tcx.is_automatically_derived(this.tcx.parent(LocalDefId.to_def_id(id.owner.def_id)))) {
    return;
  }

  // Don't warn twice.
  this.diverges = { $: "WarnedAlways" };

  // debug!("warn_if_unreachable: id={:?} span={:?} kind={}", id, span, kind);

  this.tcx.emit_node_span_lint(UNREACHABLE_CODE, id, span, new UnreachableItem(kind, span, orig_span, custom_note));
};

/// Resolves type and const variables in `t` if possible. Unlike the infcx
/// version (deeply_resolve_ignoring_regions), this version will
/// also select obligations if it seems useful, in an effort
/// to get more type information.
// #[instrument(skip(self), level = "debug", ret)]
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:114 deeply_resolve_ignoring_regions_with_obligations
FnCtxt.prototype.deeply_resolve_ignoring_regions_with_obligations = function <T>(this: FnCtxt, t_: T, d_T: TypeFoldable<T>): T {
  let t = t_;
  // No Infer()? Nothing needs doing.
  if (!TypeVisitableExt.has_non_region_infer(t, d_T)) {
    // debug!("no inference var, nothing needs doing");
    return t;
  }

  // If `t` is a type variable, see whether we already know what it is.
  t = this.deeply_resolve_ignoring_regions(t, d_T);
  if (!TypeVisitableExt.has_non_region_infer(t, d_T)) {
    // debug!(?t);
    return t;
  }

  // If not, try resolving pending obligations as much as
  // possible. This can help substantially when there are
  // indirect dependencies that don't seem worth tracking
  // precisely.
  this.select_obligations_where_possible((_) => {});
  return this.deeply_resolve_ignoring_regions(t, d_T);
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:141 record_deferred_call_resolution
FnCtxt.prototype.record_deferred_call_resolution = function (this: FnCtxt, closure_def_id: LocalDefIdT, r: DeferredCallResolution): void {
  const deferred_call_resolutions = this.deferred_call_resolutions;
  let entry = deferred_call_resolutions.get(closure_def_id);
  if (entry === undefined) {
    entry = [];
    deferred_call_resolutions.set(closure_def_id, entry);
  }
  entry.push(r);
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:150 remove_deferred_call_resolutions
FnCtxt.prototype.remove_deferred_call_resolutions = function (this: FnCtxt, closure_def_id: LocalDefIdT): DeferredCallResolution[] {
  const deferred_call_resolutions = this.deferred_call_resolutions;
  const removed = deferred_call_resolutions.get(closure_def_id);
  deferred_call_resolutions.delete(closure_def_id);
  return removed ?? [];
};

/** PORT: `format!("{self:p}")` prints the address of the `FnCtxt`; a JS object has none, so each `FnCtxt` gets a
 * sequential pseudo-address on first use. Only reached by `debug!` and the `bug!` of `node_ty` (an ICE message whose
 * address is not reproducible upstream either). */
const FNCTXT_TAGS = new WeakMap<FnCtxt, number>();
let FNCTXT_TAG_COUNT = 0;

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:158 tag
FnCtxt.prototype.tag = function (this: FnCtxt): string {
  let n = FNCTXT_TAGS.get(this);
  if (n === undefined) {
    n = ++FNCTXT_TAG_COUNT;
    FNCTXT_TAGS.set(this, n);
  }
  return `0x${(n * 0x1000).toString(16)}`;
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:162 local_ty
FnCtxt.prototype.local_ty = function (this: FnCtxt, span: SpanT, nid: HirId): Ty {
  const ty = this.locals.get(nid);
  if (ty === undefined) {
    return span_bug(span, `no type for local variable ${this.tcx.hir_id_to_string(nid)}`);
  }
  return ty;
};

// #[inline]
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:169 write_ty
FnCtxt.prototype.write_ty = function (this: FnCtxt, id: HirId, ty: Ty): void {
  // debug!("write_ty({:?}, {:?}) in fcx {}", id, self.deeply_resolve_ignoring_regions(ty), self.tag());
  const typeck = this.typeck_results;
  const node_ty = typeck.node_types_mut();

  const prev = node_ty.insert(id, ty);
  if (prev !== undefined) {
    if (TypeVisitableExt.references_error(prev, fold_Ty)) {
      node_ty.insert(id, prev);
    } else if (!TypeVisitableExt.references_error(ty, fold_Ty)) {
      // Could change this to a bug, but there's lots of diagnostic code re-lowering
      // or re-typechecking nodes that were already typecked.
      // Lots of that diagnostics code relies on subtle effects of re-lowering, so we'll
      // let it keep doing that and just ensure that compilation won't succeed.
      this.dcx().span_delayed_bug(
        this.tcx.hir_span(id),
        `\`${display_Ty(prev)}\` overridden by \`${display_Ty(ty)}\` for ${debug_HirId(id, PLAIN)} in ${debug_LocalDefId(this.body_def_id, PLAIN)}`,
      );
    }
  }

  const e = TypeVisitableExt.error_reported(ty, fold_Ty);
  if (e.$ === "Err") {
    this.set_tainted_by_errors(e._0);
  }
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:199 write_field_index
FnCtxt.prototype.write_field_index = function (this: FnCtxt, hir_id: HirId, index: FieldIdx): void {
  this.typeck_results.field_indices_mut().insert(hir_id, index);
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:204 write_resolution
FnCtxt.prototype.write_resolution = function (this: FnCtxt, hir_id: HirId, r: Result<[DefKind, DefId], ErrorGuaranteed>): void {
  this.typeck_results.type_dependent_defs_mut().insert(hir_id, r);
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:213 write_splatted_resolution
FnCtxt.prototype.write_splatted_resolution = function (this: FnCtxt, hir_id: HirId, r: Result<SplattedDef, ErrorGuaranteed>): void {
  this.typeck_results.splatted_defs_mut().insert(hir_id, r);
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:222 write_method_call_and_enforce_effects
FnCtxt.prototype.write_method_call_and_enforce_effects = function (this: FnCtxt, hir_id: HirId, span: SpanT, method: MethodCallee): void {
  this.enforce_context_effects(hir_id, span, method.def_id, method.args);
  this.write_resolution(hir_id, Ok([{ $: "AssocFn" }, method.def_id]));
  this.write_args(hir_id, method.args);
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:234 write_splatted_call
FnCtxt.prototype.write_splatted_call = function (
  this: FnCtxt,
  hir_id: HirId,
  fn_id: SplatLoweringInfo,
  callee_generic_args: GenericArgs | undefined,
  first_tupled_arg_index: number,
  tupled_args_count: number,
): void {
  // FIXME(const_trait_impl): enforce constness using enforce_context_effects() and add
  // _and_enforce_effects to this method's name

  switch (fn_id.$) {
    // We're splatting a FnDef based on its DefId
    case "FnDef": {
      const def_id = fn_id._0;
      this.write_splatted_resolution(hir_id, Ok({ $: "FnDef", def_id, arg_index: first_tupled_arg_index, arg_count: tupled_args_count }));
      if (callee_generic_args !== undefined) {
        this.write_args(hir_id, callee_generic_args);
      }
      break;
    }
    // We're splatting a FnPtr based on its type
    case "FnPtr": {
      const fn_ty = fn_id._0;
      // FIXME(splat): do we need to look up both these HirIds?
      // They can be different (and are different in some UI tests)
      this.write_splatted_resolution(hir_id, Ok({ $: "FnPtr", fn_ptr_type: fn_ty, arg_index: first_tupled_arg_index, arg_count: tupled_args_count }));
      // FIXME(splat): is this actually populated and used correctly?
      if (callee_generic_args !== undefined) {
        this.write_args(hir_id, callee_generic_args);
      }
      break;
    }
    case "Error": {
      const guar = fn_id._0;
      this.write_splatted_resolution(hir_id, Err(guar));
      if (callee_generic_args !== undefined) {
        this.write_args(hir_id, callee_generic_args);
      }
      break;
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:286 write_args
FnCtxt.prototype.write_args = function (this: FnCtxt, node_id: HirId, args: GenericArgs): void {
  if (!(args.length === 0)) {
    // debug!("write_args({:?}, {:?}) in fcx {}", node_id, args, self.tag());

    this.typeck_results.node_args_mut().insert(node_id, args);
  }
};

/// Given the args that we just converted from the HIR, try to
/// canonicalize them and store them as user-given parameters
/// (i.e., parameters that must be respected by the NLL check).
///
/// This should be invoked **before any unifications have
/// occurred**, so that annotations like `Vec<_>` are preserved
/// properly.
// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:302 write_user_type_annotation_from_args
FnCtxt.prototype.write_user_type_annotation_from_args = function (
  this: FnCtxt,
  _hir_id: HirId,
  def_id: DefId,
  args: GenericArgs,
  user_self_ty: UserSelfTy | undefined,
): void {
  // debug!("fcx {}", self.tag());

  // Don't write user type annotations for const param types, since we give them
  // identity args just so that we can trivially substitute their `EarlyBinder`.
  // We enforce that they match their type in MIR later on.
  if (DefKind_eq(this.tcx.def_kind(def_id), { $: "ConstParam" })) {
    return;
  }

  if (FnCtxt.can_contain_user_lifetime_bounds([args, user_self_ty], d_UserArgsTuple)) {
    // PORT: `canonicalize_user_type_annotation(ty::UserType::new(ty::UserTypeKind::TypeOf(def_id, UserArgs { args,
    // user_self_ty })))` needs the derived `TypeFoldable` of rustc_middle `UserType` / `UserTypeKind`
    // (ty/typeck_results.rs), which codegen does not generate yet (same stop as `GatherLocalsVisitor::declare`).
    return unported("TypeFoldable for rustc_middle::ty::typeck_results::UserType (FnCtxt::write_user_type_annotation_from_args)");
  }
};

// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:328 write_user_type_annotation
FnCtxt.prototype.write_user_type_annotation = function (this: FnCtxt, hir_id: HirId, canonical_user_type_annotation: CanonicalUserType): void {
  // debug!("fcx {}", self.tag());

  // FIXME: is_identity being on `UserType` and not `Canonical<UserType>` is awkward
  if (!IsIdentity_CanonicalUserType.is_identity(canonical_user_type_annotation)) {
    this.typeck_results.user_provided_types_mut().insert(hir_id, canonical_user_type_annotation);
  } else {
    // debug!("skipping identity args");
  }
};

// #[instrument(skip(self, expr), level = "debug")]
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:347 apply_adjustments
FnCtxt.prototype.apply_adjustments = function (this: FnCtxt, expr: hir.Expr, adj: Adjustment[]): void {
  // debug!("expr = {:#?}", expr);

  if (adj.length === 0) {
    return;
  }

  let expr_ty = this.typeck_results.expr_ty_adjusted(expr);

  for (const a of adj) {
    switch (a.kind.$) {
      case "NeverToAny": {
        const k = a.target.kind();
        if (k.$ === "Infer" && k._0.$ === "TyVar") {
          this.diverging_type_vars.push(k._0._0);
          // debug!("apply_adjustments: adding `{:?}` as diverging type var", a.target);
        }
        break;
      }
      case "Deref": {
        const d = a.kind._0;
        switch (d.$) {
          case "Overloaded": {
            const overloaded_deref = d._0;
            this.enforce_context_effects(undefined, expr.span, OverloadedDeref.method_call(overloaded_deref, this.tcx), this.tcx.mk_args([GenericArg.from_Ty(expr_ty)]));
            break;
          }
          case "Builtin":
            // FIXME(const_trait_impl): We *could* enforce `&T: [const] Deref` here.
            break;
          case "Pin":
            // FIXME(const_trait_impl): We *could* enforce `Pin<&T>: [const] Deref` here.
            break;
        }
        break;
      }
      case "Pointer":
        // FIXME(const_trait_impl): We should probably enforce these.
        break;
      case "GenericReborrow":
        // FIXME(reborrow): figure out if we have effects to enforce here.
        break;
      case "Borrow":
        // No effects to enforce here.
        break;
    }

    expr_ty = a.target;
  }

  const autoborrow_mut = adj.some((adj) => adj.kind.$ === "Borrow" && adj.kind._0.$ === "Ref" && adj.kind._0._0.$ === "Mut");

  const adjustments = this.typeck_results.adjustments_mut();
  const existing = adjustments.get(expr.hir_id);
  if (existing === undefined) {
    // Entry::Vacant(entry)
    adjustments.insert(expr.hir_id, adj);
  } else {
    // Entry::Occupied(mut entry)
    // debug!(" - composing on top of {:?}", entry.get());
    if (existing.length === 1 && existing[0]!.kind.$ === "NeverToAny" && adj.length >= 1) {
      // NeverToAny coercion can target any type, so instead of adding a new
      // adjustment on top we can change the target.
      //
      // This is required for things like `a == a` (where `a: !`) to produce
      // valid MIR -- we need borrow adjustment from things like `==` to change
      // the type to `&!` (or `&()` depending on the fallback). This might be
      // relevant even in unreachable code.
      // PORT: `*target = new_target` writes the stored adjustment; the element is replaced (not mutated) since the
      // `Adjustment` object may be shared with the vector a caller built.
      existing[0] = { kind: existing[0]!.kind, target: adj[adj.length - 1]!.target };
    } else if (
      existing.length === 2 &&
      existing[0]!.kind.$ === "Deref" &&
      existing[1]!.kind.$ === "Borrow" &&
      existing[1]!.kind._0.$ === "Ref" &&
      adj.length >= 1 &&
      adj[0]!.kind.$ === "Deref"
    ) {
      // Any following adjustments are allowed.
      // A reborrow has no effect before a dereference, so we can safely replace adjustments.
      adjustments.insert(expr.hir_id, adj);
    } else {
      // FIXME: currently we never try to compose autoderefs
      // and ReifyFnPointer/UnsafeFnPointer, but we could.
      this.dcx().span_delayed_bug(
        expr.span,
        `while adjusting ${hir.debug_Expr(expr, PLAIN)}, can't compose ${debug_vec(existing, PLAIN, debug_Adjustment)} and ${debug_vec(adj, PLAIN, debug_Adjustment)}`,
      );

      adjustments.insert(expr.hir_id, adj);
    }
  }

  // If there is an mutable auto-borrow, it is equivalent to `&mut <expr>`.
  // In this case implicit use of `Deref` and `Index` within `<expr>` should
  // instead be `DerefMut` and `IndexMut`, so fix those up.
  if (autoborrow_mut) {
    this.convert_place_derefs_to_mutable(expr);
  }
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:464 normalize
FnCtxt.prototype.normalize = function <T>(this: FnCtxt, span: SpanT, value: Unnormalized<T>, d_T: TypeFoldable<T>): T {
  return this.register_infer_ok_obligations(this.at(this.misc(span), this.param_env).normalize(value, d_T));
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:473 require_type_meets
FnCtxt.prototype.require_type_meets = function (this: FnCtxt, ty: Ty, span: SpanT, code: ObligationCauseCode, def_id: DefId): void {
  this.register_bound(ty, def_id, this.cause(span, code));
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:483 require_type_is_sized
FnCtxt.prototype.require_type_is_sized = function (this: FnCtxt, ty: Ty, span: SpanT, code: ObligationCauseCode): void {
  if (!TypeVisitableExt.references_error(ty, fold_Ty)) {
    const lang_item = this.tcx.require_lang_item("Sized", span);
    this.require_type_meets(ty, span, code, lang_item);
  }
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:495 require_type_is_sized_deferred
FnCtxt.prototype.require_type_is_sized_deferred = function (this: FnCtxt, ty: Ty, span: SpanT, code: ObligationCauseCode): void {
  if (!TypeVisitableExt.references_error(ty, fold_Ty)) {
    this.deferred_sized_obligations.push([ty, span, code]);
  }
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:506 require_type_has_static_alignment
FnCtxt.prototype.require_type_has_static_alignment = function (this: FnCtxt, ty: Ty, span: SpanT): void {
  if (!TypeVisitableExt.references_error(ty, fold_Ty)) {
    const tail = this.tcx.struct_tail_raw(
      ty,
      this.misc(span),
      (ty) => this.normalize(span, ty, fold_Ty),
      () => {},
    );
    // Sized types have static alignment, and so do slices.
    if (tail.has_trivial_sizedness(this.tcx, "Sized") || tail.kind().$ === "Slice") {
      // Nothing else is required here.
    } else {
      // We can't be sure, let's required full `Sized`.
      const lang_item = this.tcx.require_lang_item("Sized", span);
      this.require_type_meets(ty, span, { $: "Misc" }, lang_item);
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:527 register_bound
FnCtxt.prototype.register_bound = function (this: FnCtxt, ty: Ty, def_id: DefId, cause: ObligationCause): void {
  if (!TypeVisitableExt.references_error(ty, fold_Ty)) {
    // PORT: `register_bound(self, ..)` takes `&InferCtxt` (the deref coercion of `self`).
    this.fulfillment_cx.register_bound(this.infcx, this.param_env, ty, def_id, cause);
  }
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:544 lower_ty
FnCtxt.prototype.lower_ty = function (this: FnCtxt, hir_ty: hir.Ty): LoweredTy {
  const ty = this.lowerer().lower_ty(hir_ty);
  this.register_wf_obligation(Term.from_Ty(ty), hir_ty.span, { $: "WellFormed", _0: { $: "HirId", _0: hir_ty.hir_id } });
  return LoweredTy.from_raw(this, hir_ty.span, ty);
};

/// Walk a `hir_ty` and collect any clauses that may have come from a type
/// within the `hir_ty`. These clauses will be canonicalized with a user type
/// annotation so that we can enforce these bounds in borrowck, too.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:557 collect_impl_trait_clauses_from_hir_ty
FnCtxt.prototype.collect_impl_trait_clauses_from_hir_ty = function (this: FnCtxt, hir_ty: hir.Ty): Clauses {
  // rustc-type: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:561 CollectClauses
  class CollectClauses extends Visitor {
    constructor(
      public clauses: Clause[],
      public fcx: FnCtxt,
    ) {
      super();
    }

    // impl<'tcx> intravisit::Visitor<'tcx> for CollectClauses<'_, 'tcx>
    // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:567 visit_ty
    override visit_ty(ty: hir.Ty<hir.AmbigArg>): undefined {
      const clauses = this.fcx.trait_ascriptions.get(ty.hir_id.local_id);
      if (clauses !== undefined) {
        this.clauses.push(...clauses);
      }
      return walk_ty(this, ty);
    }
  }

  const collect_clauses = new CollectClauses([], this);
  collect_clauses.visit_ty_unambig(hir_ty);
  return this.tcx.mk_clauses(collect_clauses.clauses);
};

// #[instrument(level = "debug", skip_all)]
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:582 lower_ty_saving_user_provided_ty
FnCtxt.prototype.lower_ty_saving_user_provided_ty = function (this: FnCtxt, hir_ty: hir.Ty): Ty {
  const ty = this.lower_ty(hir_ty);
  // debug!(?ty);

  if (FnCtxt.can_contain_user_lifetime_bounds(ty.raw, fold_Ty)) {
    // PORT: `canonicalize_response(ty::UserType::new(ty::UserTypeKind::Ty(ty.raw)))` needs the derived `TypeFoldable`
    // of rustc_middle `UserType` / `UserTypeKind` (ty/typeck_results.rs), which codegen does not generate yet.
    return unported("TypeFoldable for rustc_middle::ty::typeck_results::UserType (FnCtxt::lower_ty_saving_user_provided_ty)");
  }

  return ty.normalized;
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:595 user_args_for_adt
FnCtxt.user_args_for_adt = function (ty: LoweredTy): UserArgs {
  const raw = ty.raw.kind();
  const normalized = ty.normalized.kind();
  if (raw.$ === "Adt") {
    return { args: raw._1, user_self_ty: undefined };
  } else if (normalized.$ === "Adt") {
    return { args: normalized._1, user_self_ty: { impl_def_id: normalized._0.did(), self_ty: ty.raw } };
  } else {
    return bug(`non-adt type ${debug_LoweredTy(ty, PLAIN)}`);
  }
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:606 lower_const_arg
FnCtxt.prototype.lower_const_arg = function (this: FnCtxt, const_arg: hir.ConstArg, ty: Ty): Const {
  const ct = this.lowerer().lower_const_arg(const_arg, ty);
  this.register_wf_obligation(Term.from_Const(ct), this.tcx.hir_span(const_arg.hir_id), { $: "WellFormed", _0: { $: "HirId", _0: const_arg.hir_id } });
  return ct;
};

// If the type given by the user has free regions, save it for later, since
// NLL would like to enforce those. Also pass in types that involve
// projections, since those can resolve to `'static` bounds (modulo #54940,
// which hopefully will be fixed by the time you see this comment, dear
// reader, although I have my doubts). Also pass in types with inference
// types, because they may be repeated. Other sorts of things are already
// sufficiently enforced with erased regions. =)
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:627 can_contain_user_lifetime_bounds
FnCtxt.can_contain_user_lifetime_bounds = function <T>(t: T, d_T: TypeVisitable<T>): boolean {
  // FIXME(mgca): should this also count stuff with infer consts
  return (
    TypeVisitableExt.has_free_regions(t, d_T) ||
    TypeVisitableExt.has_aliases(t, d_T) ||
    TypeVisitableExt.has_infer_types(t, d_T) ||
    TypeVisitableExt.has_param(t, d_T)
  );
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:635 node_ty
FnCtxt.prototype.node_ty = function (this: FnCtxt, id: HirId): Ty {
  const t = this.typeck_results.node_types().get(id);
  if (t !== undefined) {
    return t;
  }
  const e = this.tainted_by_errors();
  if (e !== undefined) {
    return Ty.new_error(this.tcx, e);
  }
  return bug(`no type for node ${this.tcx.hir_id_to_string(id)} in fcx ${this.tag()}`);
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:645 node_ty_opt
FnCtxt.prototype.node_ty_opt = function (this: FnCtxt, id: HirId): Ty | undefined {
  const t = this.typeck_results.node_types().get(id);
  if (t !== undefined) {
    return t;
  }
  const e = this.tainted_by_errors();
  if (e !== undefined) {
    return Ty.new_error(this.tcx, e);
  }
  return undefined;
};

/// Registers an obligation for checking later, during regionck, that `arg` is well-formed.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:654 register_wf_obligation
FnCtxt.prototype.register_wf_obligation = function (this: FnCtxt, term: Term, span: SpanT, code: ObligationCauseCode): void {
  // WF obligations never themselves fail, so no real need to give a detailed cause:
  const cause = this.cause(span, code);
  this.register_predicate(Obligation.new(this.tcx, cause, this.param_env, { $: "WellFormed", _0: term } as ClauseKind, (from: ClauseKind, interner) => Predicate_upcast_from_ClauseKind(from, interner as unknown as TyCtxt)));
};

/// Registers obligations that all `args` are well-formed.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:671 add_wf_bounds
FnCtxt.prototype.add_wf_bounds = function (this: FnCtxt, args: GenericArgs, span: SpanT, hir_id: HirId): void {
  for (const arg of args) {
    const term = GenericArg.as_term(arg);
    if (term === undefined) continue;
    this.register_wf_obligation(term, span, { $: "WellFormed", _0: { $: "HirId", _0: hir_id } });
  }
};

// FIXME(arielb1): use this instead of field.ty everywhere
// Only for fields! Returns <none> for methods>
// Indifferent to privacy flags
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:684 field_ty
FnCtxt.prototype.field_ty = function (this: FnCtxt, span: SpanT, field: FieldDef, args: GenericArgs): Ty {
  return this.normalize(span, field.ty(this.tcx, args), fold_Ty);
};

/// Drain all obligations that are stalled on coroutines defined in this body.
// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:695 drain_stalled_coroutine_obligations
FnCtxt.prototype.drain_stalled_coroutine_obligations = function (this: FnCtxt): void {
  // Make as much inference progress as possible before
  // draining the stalled coroutine obligations as this may
  // change obligations from being stalled on infer vars to
  // being stalled on a coroutine.
  this.select_obligations_where_possible((_) => {});

  const typing_mode = this.typing_mode();
  let defining_opaque_types_and_generators: readonly LocalDefIdT[];
  switch (typing_mode.$) {
    case "Typeck":
      defining_opaque_types_and_generators = typing_mode.defining_opaque_types_and_generators;
      break;
    default:
      return bug();
  }

  if (defining_opaque_types_and_generators.some((def_id) => this.tcx.is_coroutine(LocalDefId.to_def_id(def_id)))) {
    const coroutine_stalled_predicates = this.typeck_results.coroutine_stalled_predicates;
    for (const o of this.fulfillment_cx.drain_stalled_obligations_for_coroutines(this.infcx)) {
      coroutine_stalled_predicates.add([o.predicate, o.cause]);
    }
  }
};

// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:731 report_ambiguity_errors
FnCtxt.prototype.report_ambiguity_errors = function (this: FnCtxt): void {
  const errors = this.fulfillment_cx.collect_remaining_errors(this.infcx);

  if (errors.$ === "HasErrors") {
    const errs = errors._0;
    this.adjust_fulfillment_errors_for_expr_obligation(errs);
    err_ctxt_view(this).report_fulfillment_errors(errs);
  }
};

/// Select as many obligations as we can at present.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:741 select_obligations_where_possible
FnCtxt.prototype.select_obligations_where_possible = function (this: FnCtxt, mutate_fulfillment_errors: (_1: FulfillmentError[]) => void): void {
  const result = this.fulfillment_cx.try_evaluate_obligations(this.infcx);
  if (result.$ === "HasErrors") {
    const errs = result._0;
    mutate_fulfillment_errors(errs);
    this.adjust_fulfillment_errors_for_expr_obligation(errs);
    err_ctxt_view(this).report_fulfillment_errors(errs);
  }
};

/// For the overloaded place expressions (`*x`, `x[3]`), the trait
/// returns a type of `&T`, but the actual type we assign to the
/// *expression* is `T`. So this function just peels off the return
/// type by one layer to yield `T`.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:757 make_overloaded_place_return_type
FnCtxt.prototype.make_overloaded_place_return_type = function (this: FnCtxt, method: MethodCallee): Ty {
  // extract method return type, which will be &T;
  const ret_ty = FnSig.output(method.sig);

  // method returns &T, but the type as visible to user is T, so deref
  return unwrap(ret_ty.builtin_deref(true));
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:765 type_var_is_sized
FnCtxt.prototype.type_var_is_sized = function (this: FnCtxt, self_ty: TyVid): boolean {
  const sized_did = this.tcx.lang_items().sized_trait();

  // NB: `T: Sized` implies that all subtypes and all supertypes of `T` are also sized,
  //     so it's valid to use subtyping here. (subtyping has to preserve layout and
  //     `T <: U => &T <: &U`, so subtyping can't change sizedness)
  return this.obligations_for_self_ty(self_ty, "Yes").some((obligation) => {
    const kind = Binder.skip_binder(obligation.predicate.kind());
    if (kind.$ === "Clause" && kind._0.$ === "Trait") {
      const def_id = kind._0._0.trait_ref.def_id;
      return sized_did !== undefined && DefId_eq(def_id, sized_did);
    }
    return false;
  });
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:781 err_args
FnCtxt.prototype.err_args = function (this: FnCtxt, len: number, guar: ErrorGuaranteed): Ty[] {
  const ty_error = Ty.new_error(this.tcx, guar);
  return new Array<Ty>(len).fill(ty_error);
};

/// Resolves an associated value path into a base type and associated constant, or method
/// resolution. The newly resolved definition is written into `type_dependent_defs`.
// #[instrument(level = "trace", skip(self), ret)]
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:789 resolve_ty_and_res_fully_qualified_call
FnCtxt.prototype.resolve_ty_and_res_fully_qualified_call = function (
  this: FnCtxt,
  qpath: hir.QPath,
  hir_id: HirId,
  span: SpanT,
): [ResT<HirId>, LoweredTy | undefined, readonly hir.PathSegment[]] {
  let ty: LoweredTy;
  let qself: hir.Ty;
  let item_segment: hir.PathSegment;
  switch (qpath.$) {
    case "Resolved": {
      const opt_qself = qpath._0;
      const path = qpath._1;
      return [path.res, opt_qself !== undefined ? this.lower_ty(opt_qself) : undefined, path.segments];
    }
    case "TypeRelative": {
      qself = qpath._0;
      const segment = qpath._1;
      // Don't use `self.lower_ty`, since this will register a WF obligation.
      // If we're trying to call a nonexistent method on a trait
      // (e.g. `MyTrait::missing_method`), then resolution will
      // give us a `QPath::TypeRelative` with a trait object as
      // `qself`. In that case, we want to avoid registering a WF obligation
      // for `dyn MyTrait`, since we don't actually need the trait
      // to be dyn-compatible.
      // We manually call `register_wf_obligation` in the success path
      // below.
      const ty_ = this.lowerer().lower_ty(qself);
      ty = LoweredTy.from_raw(this, span, ty_);
      item_segment = segment;
      break;
    }
  }

  this.register_wf_obligation(Term.from_Ty(ty.raw), qself.span, { $: "WellFormed", _0: { $: "HirId", _0: hir_id } });
  this.select_obligations_where_possible((_) => {});

  const cached_result = this.typeck_results.type_dependent_defs().get(hir_id);
  if (cached_result !== undefined) {
    // Return directly on cache hit. This is useful to avoid doubly reporting
    // errors with default match binding modes. See #44614.
    const def: ResT<HirId> = cached_result.$ === "Ok" ? { $: "Def", _0: cached_result._0[0], _1: cached_result._0[1] } : Res.Err;
    return [def, ty, [item_segment]];
  }
  const item_name = item_segment.ident;
  const result0 = this.resolve_fully_qualified_call(span, item_name, ty.normalized, qself.span, hir_id);
  let result: Result<[DefKind, DefId], ErrorGuaranteed>;
  if (result0.$ === "Ok") {
    result = result0;
  } else {
    const error = result0._0;
    const guar = this.dcx().span_delayed_bug(span, "method resolution should've emitted an error");
    let result_: Result<[DefKind, DefId], ErrorGuaranteed>;
    if (error.$ === "PrivateMatch") {
      result_ = Ok([error._0, error._1]);
    } else {
      result_ = Err(guar);
    }

    const trait_missing_method = error.$ === "NoMatch" && ty.normalized.is_trait();
    this.report_method_error(
      hir_id,
      ty.normalized,
      error,
      { $: "NoExpectation" },
      trait_missing_method && Edition.at_least_rust_2021(Span.edition(span)), // emits missing method for trait only after edition 2021
    );

    result = result_;
  }
  const result_ok = result;

  // Write back the new resolution.
  this.write_resolution(hir_id, result_ok);
  return [result_ok.$ === "Ok" ? { $: "Def", _0: result_ok._0[0], _1: result_ok._0[1] } : Res.Err, ty, [item_segment]];
};

/// Given a `HirId`, return the `HirId` of the enclosing function and its `FnDecl`.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:867 get_fn_decl
FnCtxt.prototype.get_fn_decl = function (this: FnCtxt, blk_id: HirId): [LocalDefIdT, hir.FnDecl] | undefined {
  // Get enclosing Fn, if it is a function or a trait method, unless there's a `loop` or
  // `while` before reaching it, as block tail returns are not available in them.
  const item_id = this.tcx.hir_get_fn_id_for_return_block(blk_id);
  if (item_id === undefined) return undefined;
  const node = this.tcx.hir_node(item_id);
  switch (node.$) {
    case "Item":
      if (node._0.kind.$ === "Fn") return [node._0.owner_id.def_id, node._0.kind.sig.decl];
      return undefined;
    case "TraitItem":
      if (node._0.kind.$ === "Fn") return [node._0.owner_id.def_id, node._0.kind._0.decl];
      return undefined;
    case "ImplItem":
      if (node._0.kind.$ === "Fn") return [node._0.owner_id.def_id, node._0.kind._0.decl];
      return undefined;
    case "Expr": {
      const expr = node._0;
      if (expr.kind.$ !== "Closure") return undefined;
      const hir_id = expr.hir_id;
      const { def_id, kind, fn_decl } = expr.kind._0;
      switch (kind.$) {
        case "CoroutineClosure":
          // FIXME(async_closures): Implement this.
          return undefined;
        case "Closure":
          return [def_id, fn_decl];
        case "Coroutine": {
          if (!(kind._0.$ === "Desugared" && kind._0._1 === "Fn")) return undefined;
          const parent = this.tcx.parent_hir_node(hir_id);
          let sig: hir.FnSig;
          let owner_id: hir.OwnerId;
          if (parent.$ === "Item" && parent._0.kind.$ === "Fn") {
            sig = parent._0.kind.sig;
            owner_id = parent._0.owner_id;
          } else if (parent.$ === "TraitItem" && parent._0.kind.$ === "Fn") {
            sig = parent._0.kind._0;
            owner_id = parent._0.owner_id;
          } else if (parent.$ === "ImplItem" && parent._0.kind.$ === "Fn") {
            sig = parent._0.kind._0;
            owner_id = parent._0.owner_id;
          } else {
            return undefined;
          }
          return [owner_id.def_id, sig.decl];
        }
      }
      return undefined;
    }
    default:
      return undefined;
  }
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:931 note_internal_mutation_in_method
FnCtxt.prototype.note_internal_mutation_in_method = function (this: FnCtxt, err: Diag, expr: hir.Expr, expected: Ty | undefined, found: Ty): void {
  if (found !== this.tcx.types.unit) {
    return;
  }

  if (expr.kind.$ !== "MethodCall") {
    return;
  }
  const path_segment = expr.kind._0;
  const rcvr = expr.kind._1;

  const rcvr_ty = this.typeck_results.expr_ty_adjusted_opt(rcvr);
  const rcvr_has_the_expected_type = rcvr_ty !== undefined && expected !== undefined && expected.peel_refs() === rcvr_ty.peel_refs();

  const prev_call_mutates_and_returns_unit = (): boolean => {
    const def_id = this.typeck_results.type_dependent_def_id(expr.hir_id);
    if (def_id === undefined) return false;
    const sig = Binder.skip_binder(EarlyBinder.skip_binder(this.tcx.fn_sig(def_id) as EarlyBinder<Binder<FnSigT>>));
    const inputs_and_output = sig.inputs_and_output;
    if (inputs_and_output.length === 0) return false;
    const output = inputs_and_output[inputs_and_output.length - 1]!;
    const inputs = inputs_and_output.slice(0, -1);
    if (!output.is_unit()) return false;
    const self_ty = inputs[0];
    if (self_ty === undefined) return false;
    const m: Mutability | undefined = self_ty.ref_mutability();
    return m !== undefined && m === "Mut";
  };

  if (!(rcvr_has_the_expected_type || prev_call_mutates_and_returns_unit())) {
    return;
  }

  const sp = MultiSpan.from_span(path_segment.ident.span);
  let rcvr_desc: string;
  if (rcvr.kind.$ === "Path" && rcvr.kind._0.$ === "Resolved" && rcvr.kind._0._0 === undefined && rcvr.kind._0._1.segments.length === 1) {
    rcvr_desc = `\`${display_Ident(rcvr.kind._0._1.segments[0]!.ident)}\``;
  } else {
    rcvr_desc = "its receiver";
  }
  sp.push_span_label(path_segment.ident.span, `this call modifies ${rcvr_desc} in-place`);

  const modifies_rcvr_note = `method \`${display_Ident(path_segment.ident)}\` modifies its receiver in-place`;
  if (rcvr_has_the_expected_type) {
    sp.push_span_label(rcvr.span, "you probably want to use this value after calling the method...");
    err.span_note(sp, modifies_rcvr_note);
    err.note(`...instead of the \`()\` output of method \`${display_Ident(path_segment.ident)}\``);
  } else if (rcvr.kind.$ === "MethodCall") {
    err.span_note(sp, modifies_rcvr_note + ", it is not meant to be used in method chains.");
  } else {
    err.span_note(sp, modifies_rcvr_note);
  }
};

// Instantiates the given path, which must refer to an item with the given
// number of type parameters and type.
// #[instrument(skip(self, span), level = "debug")]
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:1009 instantiate_value_path
FnCtxt.prototype.instantiate_value_path = function (
  this: FnCtxt,
  segments: readonly hir.PathSegment[],
  self_ty: LoweredTy | undefined,
  res_: ResT<HirId>,
  span: SpanT,
  path_span: SpanT,
  hir_id: HirId,
  has_args: boolean,
): [Ty, ResT<HirId>] {
  const tcx = this.tcx;
  let res = res_;

  let generic_segments: GenericPathSegment[];
  switch (res.$) {
    case "Local":
    case "SelfCtor":
      generic_segments = [];
      break;
    case "Def":
      generic_segments = this.lowerer().probe_generic_path_segments(segments, self_ty?.raw, res._0, res._1, span);
      break;
    case "Err":
      return [Ty.new_error(tcx, tcx.dcx().span_delayed_bug(span, "could not resolve path {:?}")), res];
    default:
      return bug(`instantiate_value_path on ${debug_Res(res, PLAIN, debug_HirId)}`);
  }

  let user_self_ty: UserSelfTy | undefined = undefined;
  let is_alias_variant_ctor = false;
  let err_extend: GenericsArgsErrExtend = GenericsArgsErrExtend.None;
  if (res.$ === "Def" && res._0.$ === "Ctor" && res._0._0 === "Variant" && self_ty !== undefined) {
    const adt_def = unwrap(self_ty.normalized.ty_adt_def());
    user_self_ty = { impl_def_id: adt_def.did(), self_ty: self_ty.raw };
    is_alias_variant_ctor = true;
    err_extend = { $: "DefVariant", _0: segments };
  } else if (res.$ === "Def" && res._0.$ === "Ctor" && res._0._0 === "Variant") {
    err_extend = { $: "DefVariant", _0: segments };
  } else if (res.$ === "Def" && (res._0.$ === "AssocFn" || res._0.$ === "AssocConst")) {
    const def_id = res._1;
    const assoc_item = tcx.associated_item(def_id) as AssocItemT;
    const container = assoc_item.container;
    const container_id = AssocItem.container_id(assoc_item, tcx);
    // debug!(?def_id, ?container, ?container_id);
    switch (container.$) {
      case "Trait": {
        let arg_span: SpanT | undefined;
        const parent = this.tcx.parent_hir_node(hir_id);
        if (parent.$ === "Expr" && parent._0.kind.$ === "Call" && parent._0.kind._1.length > 0) {
          let arg = parent._0.kind._1[0]!;
          while (arg.kind.$ === "AddrOf") {
            arg = arg.kind._2;
          }
          arg_span = arg.span;
        } else {
          arg_span = undefined;
        }

        const r = check_legal_trait_for_method_call(tcx, path_span, arg_span, span, container_id, LocalDefId.to_def_id(this.body_def_id));
        if (r.$ === "Err") {
          this.set_tainted_by_errors(r._0);
        }
        break;
      }
      case "InherentImpl":
      case "TraitImpl":
        if (segments.length === 1) {
          // `<T>::assoc` will end up here, and so
          // can `T::assoc`. If this came from an
          // inherent impl, we need to record the
          // `T` for posterity (see `UserSelfTy` for
          // details).
          // Generated desugaring code may have a path without a self.
          user_self_ty = self_ty !== undefined ? { impl_def_id: container_id, self_ty: self_ty.raw } : undefined;
        }
        break;
    }
  }

  // Now that we have categorized what space the parameters for each
  // segment belong to, let's sort out the parameters that the user
  // provided (if any) into their appropriate spaces. We'll also report
  // errors if type parameters are provided in an inappropriate place.

  const indices = new Set<number>(generic_segments.map((s) => s._1));
  const generics_err = this.lowerer().prohibit_generic_args(
    segments.filter((_seg, index) => !indices.has(index) || is_alias_variant_ctor),
    err_extend,
  );

  const mcg = this.lowerer().check_param_res_if_mcg_for_instantiate_value_path(res, span);
  if (mcg.$ === "Err") {
    return [Ty.new_error(this.tcx, mcg._0), res];
  }

  if (res.$ === "Local") {
    const hid = res._0;
    const ty_ = this.local_ty(span, hid);
    const ty = this.normalize(span, Unnormalized.new_wip(ty_), fold_Ty);
    return [ty, res];
  }

  if (generics_err.$ === "Err") {
    // Don't try to infer type parameters when prohibited generic arguments were given.
    user_self_ty = undefined;
  }

  // Now we have to compare the types that the user *actually*
  // provided against the types that were *expected*. If the user
  // did not provide any types, then we want to instantiate inference
  // variables. If the user provided some types, we may still need
  // to add defaults. If the user provided *too many* types, that's
  // a problem.

  let infer_args_for_err: [ErrorGuaranteed, Set<number>] | undefined = undefined;

  let explicit_late_bound: ExplicitLateBound = ExplicitLateBound.No;
  for (const { _0: def_id, _1: index } of generic_segments) {
    const seg = segments[index]!;
    const generics = tcx.generics_of(def_id) as Generics;

    // Argument-position `impl Trait` is treated as a normal generic
    // parameter internally, but we don't allow users to specify the
    // parameter's value explicitly, so we have to do some error-
    // checking here.
    const arg_count = check_generic_arg_count_for_value_path(this.lowerer(), def_id, generics, seg, "No");

    if (arg_count.explicit_late_bound === "Yes") {
      explicit_late_bound = ExplicitLateBound.Yes;
    }

    if (arg_count.correct.$ === "Err") {
      const reported = arg_count.correct._0.reported;
      if (infer_args_for_err === undefined) {
        infer_args_for_err = [reported, new Set()];
      }
      infer_args_for_err[1].add(index);
      this.set_tainted_by_errors(reported); // See issue #53251.
    }
  }

  const last_segment = generic_segments[generic_segments.length - 1];
  const has_self = last_segment !== undefined && (tcx.generics_of(last_segment._0) as Generics).has_self;

  let implicit_args: GenericArgs | undefined;
  if (res.$ === "Def" && res._0.$ === "ConstParam") {
    const def = res._1;
    // types of const parameters are somewhat special as they are part of
    // the same environment as the const parameter itself. this means that
    // unlike most paths `type-of(N)` can return a type naming parameters
    // introduced by the containing item, rather than provided through `N`.
    //
    // for example given `<T, const M: usize, const N: [T; M]>` and some
    // `let a = N;` expression. The path to `N` would wind up with no args
    // (as it has no args), but instantiating the early binder on `typeof(N)`
    // requires providing generic arguments for `[T, M, N]`.
    implicit_args = RawList.identity_for_item(tcx, tcx.parent(def));
  } else if (res.$ === "SelfCtor") {
    const impl_def_id = res._0;
    const ty = LoweredTy.from_raw(this, span, Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.at(span).type_of(impl_def_id) as EarlyBinder<Ty>)));

    // Firstly, check that this SelfCtor even comes from the item we're currently
    // typechecking. This can happen because we never validated the resolution of
    // SelfCtors, and when we started doing so, we noticed regressions. After
    // sufficiently long time, we can remove this check and turn it into a hard
    // error in `validate_res_from_ribs` -- it's just difficult to tell whether the
    // self type has any generic types during rustc_resolve, which is what we use
    // to determine if this is a hard error or warning.
    let all_differ = true;
    for (let def_id: DefId | undefined = LocalDefId.to_def_id(this.body_def_id); def_id !== undefined; def_id = (this.tcx.generics_of(def_id) as Generics).parent) {
      if (DefId_eq(def_id, impl_def_id)) {
        all_differ = false;
        break;
      }
    }
    if (all_differ) {
      const adt = ty.normalized.ty_adt_def();
      const sugg: ReplaceWithName | undefined = adt !== undefined ? { span: path_span, name: Symbol.to_ident_string(this.tcx.item_name(adt.did())) } : undefined;
      const parent_node = this.tcx.hir_node_by_def_id(this.tcx.hir_get_parent_item(hir_id).def_id);
      const item: InnerItem | undefined =
        parent_node.$ === "Item" ? { span: hir.ItemKind.ident(parent_node._0.kind)?.span ?? parent_node._0.span } : undefined;
      if (TypeVisitableExt.has_param(ty.raw, fold_Ty)) {
        const guar = this.dcx().emit_err(SelfCtorFromOuterItem_diagnostic({ span: path_span, impl_span: tcx.def_span(impl_def_id), sugg, item }));
        return [Ty.new_error(this.tcx, guar), res];
      } else {
        this.tcx.emit_node_span_lint(
          SELF_CONSTRUCTOR_FROM_OUTER_ITEM,
          hir_id,
          path_span,
          SelfCtorFromOuterItemLint_diagnostic({ impl_span: tcx.def_span(impl_def_id), sugg, item }),
        );
      }
    }

    const adt_def = ty.normalized.ty_adt_def();
    if (adt_def !== undefined && adt_def.has_ctor()) {
      const [ctor_kind, ctor_def_id] = unwrap(adt_def.non_enum_variant().ctor);
      // Check the visibility of the ctor.
      const vis = tcx.visibility(ctor_def_id);
      if (!Visibility.is_accessible_from(vis, this.mod_id, tcx)) {
        this.dcx().emit_err(CtorIsPrivate_diagnostic({ span, def: tcx.def_path_str(adt_def.did()) }));
      }
      const new_res: ResT<HirId> = { $: "Def", _0: { $: "Ctor", _0: "Struct", _1: ctor_kind }, _1: ctor_def_id };
      const user_args = FnCtxt.user_args_for_adt(ty);
      user_self_ty = user_args.user_self_ty;
      res = new_res;
      implicit_args = user_args.args;
    } else {
      const err = this.dcx().struct_span_err(span, "the `Self` constructor can only be used with tuple or unit structs");
      const adt_def = ty.normalized.ty_adt_def();
      if (adt_def !== undefined) {
        const def_id = LocalDefId.to_def_id(this.body_def_id);
        const assoc = !has_args ? tcx.opt_associated_item(def_id) : undefined;
        if (!has_args && assoc !== undefined && AssocItem.is_method(assoc)) {
          const self_ty = FnSig.inputs(Unnormalized.skip_binder(EarlyBinder.instantiate_identity(tcx.fn_sig(def_id) as EarlyBinder<Binder<FnSigT>>)))[0]!;
          let applicability: Applicability;
          if (self_ty.kind().$ === "Adt") {
            // We're within a method that takes ownership of `Self`, likely a
            // builder, so this is most likely a typo.
            applicability = "MachineApplicable";
          } else {
            // We still might have meant `self` instead of `Self`.
            applicability = "MaybeIncorrect";
          }
          err.span_suggestion_verbose(span, `you might have meant to refer to the \`self\` binding of type \`${display_Ty(self_ty)}\``, "self", applicability);
        } else {
          switch (adt_def.adt_kind()) {
            case "Enum":
              err.span_help(
                tcx.def_span(adt_def.did()),
                adt_def.variants().length === 0 ? "the enum is unconstructable because it has no variants" : "you might have meant to use one of the enum's variants",
              );
              break;
            case "Struct":
            case "Union":
              err.span_suggestion_verbose(span, "use curly brackets", "Self { /* fields */ }", "HasPlaceholders");
              break;
          }
        }
      }
      const guar = err.emit_err();
      return [Ty.new_error(tcx, guar), res];
    }
  } else {
    implicit_args = undefined;
  }
  const def_id = Res.def_id(res, debug_HirId);

  let correct: Result<null, GenericArgCountMismatch>;
  let infer_args_for_err_: Set<number>;
  if (infer_args_for_err !== undefined) {
    const [reported, args] = infer_args_for_err;
    correct = Err({ reported, invalid_args: [] });
    infer_args_for_err_ = args;
  } else {
    correct = Ok(null);
    infer_args_for_err_ = new Set();
  }

  const arg_count: GenericArgCountResult = { explicit_late_bound, correct };

  // rustc-type: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:1330 CtorGenericArgsCtxt
  class CtorGenericArgsCtxt implements GenericArgsLowerer {
    constructor(
      public fcx: FnCtxt,
      public span: SpanT,
      public generic_segments: readonly GenericPathSegment[],
      public infer_args_for_err: ReadonlySet<number>,
      public segments: readonly hir.PathSegment[],
    ) {}

    // impl<'a, 'tcx> GenericArgsLowerer<'a, 'tcx> for CtorGenericArgsCtxt<'a, 'tcx>
    // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:1338 args_for_def_id
    args_for_def_id(def_id: DefId): [hir.GenericArgs | undefined, boolean] {
      const found = this.generic_segments.find((s) => DefId_eq(s._0, def_id));
      if (found !== undefined) {
        const index = found._1;
        // If we've encountered an `impl Trait`-related error, we're just
        // going to infer the arguments for better error messages.
        if (!this.infer_args_for_err.has(index)) {
          // Check whether the user has provided generic arguments.
          const data = this.segments[index]!.args;
          if (data !== undefined) {
            return [data, this.segments[index]!.infer_args];
          }
        }
        return [undefined, this.segments[index]!.infer_args];
      }

      return [undefined, true];
    }

    // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:1359 provided_kind
    provided_kind(preceding_args: readonly GenericArg[], param: GenericParamDef, arg: hir.GenericArg): GenericArg {
      const kind = param.kind;
      if (kind.$ === "Lifetime" && arg.$ === "Lifetime") {
        return GenericArg.from_Region(this.fcx.lowerer().lower_lifetime(arg._0, { $: "Param", _0: param }));
      } else if (kind.$ === "Type" && arg.$ === "Type") {
        // We handle the ambig portions of `Ty` in match arm below
        return GenericArg.from_Ty(this.fcx.lower_ty(arg._0.as_unambig_ty()).raw);
      } else if (kind.$ === "Type" && arg.$ === "Infer") {
        return GenericArg.from_Ty(this.fcx.lower_ty(arg._0.to_ty()).raw);
      } else if (kind.$ === "Const" && arg.$ === "Const") {
        return GenericArg.from_Const(
          this.fcx
            // Ambiguous parts of `ConstArg` are handled in the match arms below
            .lower_const_arg(
              arg._0.as_unambig_ct(),
              Unnormalized.skip_norm_wip(EarlyBinder.instantiate(this.fcx.tcx.type_of(param.def_id) as EarlyBinder<Ty>, this.fcx.tcx, preceding_args, fold_Ty)),
            ),
        );
      } else if (kind.$ === "Const" && arg.$ === "Infer") {
        return GenericArg.from_Const(this.fcx.lowerer().ct_infer(param, arg._0.span));
      } else {
        return unreachable();
      }
    }

    // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:1397 inferred_kind
    inferred_kind(preceding_args: readonly GenericArg[], param: GenericParamDef, infer_args: boolean): GenericArg {
      const tcx = this.fcx.tcx;
      if (!infer_args) {
        const default_ = GenericParamDef.default_value(param, tcx);
        if (default_ !== undefined) {
          // If we have a default, then it doesn't matter that we're not inferring
          // the type/const arguments: We provide the default where any is missing.
          return Unnormalized.skip_norm_wip(EarlyBinder.instantiate(default_, tcx, preceding_args, fold_GenericArg));
        }
      }
      // If no type/const arguments were provided, we have to infer them.
      // This case also occurs as a result of some malformed input, e.g.,
      // a lifetime argument being given instead of a type/const parameter.
      // Using inference instead of `Error` gives better error messages.
      return this.fcx.var_for_def(this.span, param);
    }
  }

  const args_for_user_type =
    implicit_args !== undefined
      ? implicit_args
      : lower_generic_args(
          this.lowerer(),
          def_id,
          [],
          has_self,
          self_ty?.raw,
          arg_count,
          new CtorGenericArgsCtxt(this, span, generic_segments, infer_args_for_err_, segments),
        );

  // First, store the "user args" for later.
  this.write_user_type_annotation_from_args(hir_id, def_id, args_for_user_type, user_self_ty);

  // Normalize only after registering type annotations.
  const args = this.normalize(span, Unnormalized.new_wip(args_for_user_type), fold_GenericArgs);

  this.add_required_obligations_for_hir(span, def_id, args, hir_id);

  // Instantiate the values for the type parameters into the type of
  // the referenced item.
  const ty = tcx.type_of(def_id) as EarlyBinder<Ty>;
  assert(!TypeVisitableExt.has_escaping_bound_vars(args, fold_GenericArgs), "assertion failed: !args.has_escaping_bound_vars()");
  assert(!TypeVisitableExt.has_escaping_bound_vars(EarlyBinder.skip_binder(ty), fold_Ty), "assertion failed: !ty.skip_binder().has_escaping_bound_vars()");
  const ty_instantiated = this.normalize(span, EarlyBinder.instantiate(ty, tcx, args, fold_Ty), fold_Ty);

  if (user_self_ty !== undefined) {
    const { impl_def_id, self_ty: self_ty_ } = user_self_ty;
    // In the case of `Foo<T>::method` and `<Foo<T>>::method`, if `method`
    // is inherent, there is no `Self` parameter; instead, the impl needs
    // type parameters, which we can infer by unifying the provided `Self`
    // with the instantiated impl type.
    // This also occurs for an enum variant on a type alias.
    const impl_ty = this.normalize(span, EarlyBinder.instantiate(tcx.type_of(impl_def_id) as EarlyBinder<Ty>, tcx, args, fold_Ty), fold_Ty);
    const self_ty = this.normalize(span, Unnormalized.new_wip(self_ty_), fold_Ty);
    const r = this.at(this.misc(span), this.param_env).eq("Yes", impl_ty, self_ty, ToTrace_Ty);
    if (r.$ === "Ok") {
      this.register_infer_ok_obligations(r._0);
    } else {
      this.dcx().span_bug(span, `instantiate_value_path: (UFCS) ${debug_Ty(self_ty, PLAIN)} was a subtype of ${debug_Ty(impl_ty, PLAIN)} but now is not?`);
    }
  }

  // debug!("instantiate_value_path: type of {:?} is {:?}", hir_id, ty_instantiated);

  this.write_args(hir_id, args);

  return [ty_instantiated, res];
};

/// Add all the obligations that are required, instantiated and normalized appropriately.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:1483 add_required_obligations_for_hir
FnCtxt.prototype.add_required_obligations_for_hir = function (this: FnCtxt, span: SpanT, def_id: DefId, args: GenericArgs, hir_id: HirId): void {
  this.add_required_obligations_with_code(span, def_id, args, (idx, span) => ({ $: "WhereClauseInExpr", _0: def_id, _1: span, _2: hir_id, _3: idx }));
};

// #[instrument(level = "debug", skip(self, code, span, args))]
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:1496 add_required_obligations_with_code
FnCtxt.prototype.add_required_obligations_with_code = function (
  this: FnCtxt,
  span: SpanT,
  def_id: DefId,
  args: GenericArgs,
  code: (_1: number, _2: SpanT) => ObligationCauseCode,
): void {
  const param_env = this.param_env;

  const bounds = GenericClauses.instantiate(this.tcx.clauses_of(def_id) as GenericClausesT, this.tcx, args);

  for (const obligation of predicates_for_generics(
    (idx, clause_span) => this.cause(span, code(idx, clause_span)),
    (clause) => this.normalize(span, clause, fold_Clause),
    param_env,
    bounds,
  )) {
    this.register_predicate(obligation);
  }
};

// #[instrument(level = "debug", skip(self, sp), ret)]
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:1518 try_structurally_resolve_const
FnCtxt.prototype.try_structurally_resolve_const = function (this: FnCtxt, sp: SpanT, ct_: Const): Const {
  const ct = this.deeply_resolve_ignoring_regions_with_obligations(ct_, fold_Const);

  if (this.next_trait_solver() && ct.kind().$ === "Alias") {
    // We need to use a separate variable here as otherwise the temporary for
    // `self.fulfillment_cx.borrow_mut()` is alive in the `Err` branch, resulting
    // in a reentrant borrow, causing an ICE.
    const result = this.at(this.misc(sp), this.param_env).structurally_normalize_const(Unnormalized.new_wip(ct), this.fulfillment_cx);
    switch (result.$) {
      case "Ok":
        return result._0;
      case "Err": {
        const guar = err_ctxt_view(this).report_fulfillment_errors(result._0);
        return ConstC.new_error(this.tcx, guar);
      }
    }
  } else if (this.tcx.features().generic_const_exprs()) {
    return evaluate_const(this.infcx, ct, this.param_env);
  } else {
    return ct;
  }
};

/// Resolves `ty` by a single level if `ty` is a type variable.
///
/// When the new solver is enabled, this will also attempt to normalize
/// the type if it's a projection (note that it will not deeply normalize
/// projections within the type, just the outermost layer of the type).
///
/// If no resolution is possible, then an error is reported.
/// Numeric inference variables may be left unresolved.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:1557 structurally_resolve_type
FnCtxt.prototype.structurally_resolve_type = function (this: FnCtxt, sp: SpanT, ty_: Ty): Ty {
  const ty = this.deeply_resolve_ignoring_regions_with_obligations(ty_, fold_Ty);

  if (!ty.is_ty_var()) {
    return ty;
  } else {
    return this.type_must_be_known_at_this_point(sp, ty);
  }
};

// #[cold]
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:1564 type_must_be_known_at_this_point
FnCtxt.prototype.type_must_be_known_at_this_point = function (this: FnCtxt, sp: SpanT, ty: Ty): Ty {
  let guar = this.tainted_by_errors();
  if (guar === undefined) {
    guar = err_ctxt_view(this).emit_inference_failure_err(this.body_def_id, sp, GenericArg.from_Ty(ty), "E0282", true).emit_err();
  }
  const err = Ty.new_error(this.tcx, guar!);
  this.demand_suptype(sp, err, ty);
  return err;
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:1581 structurally_resolve_const
FnCtxt.prototype.structurally_resolve_const = function (this: FnCtxt, sp: SpanT, ct_: Const): Const {
  const ct = this.try_structurally_resolve_const(sp, ct_);

  if (!ct.is_ct_infer()) {
    return ct;
  } else {
    let e = this.tainted_by_errors();
    if (e === undefined) {
      e = err_ctxt_view(this).emit_inference_failure_err(this.body_def_id, sp, GenericArg.from_Const(ct), "E0282", true).emit_err();
    }
    // FIXME: Infer `?ct = {const error}`?
    return ConstC.new_error(this.tcx, e!);
  }
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:1607 with_breakable_ctxt
FnCtxt.prototype.with_breakable_ctxt = function <R>(this: FnCtxt, id: HirId, ctxt: BreakableCtxt, f: () => R): [BreakableCtxt, R] {
  let index: number;
  {
    const enclosing_breakables = this.enclosing_breakables;
    index = enclosing_breakables.stack.length;
    enclosing_breakables.by_id.set(id, index);
    enclosing_breakables.stack.push(ctxt);
  }
  const result = f();
  let ctxt_: BreakableCtxt;
  {
    const enclosing_breakables = this.enclosing_breakables;
    // debug_assert!(enclosing_breakables.stack.len() == index + 1);
    // FIXME(#120456) - is `swap_remove` correct?
    // PORT: `FxIndexMap::swap_remove` moves the last entry into the removed slot; `by_id` is only looked up, never
    // iterated, so a plain delete is equivalent.
    if (!enclosing_breakables.by_id.has(id)) panic("missing breakable context");
    enclosing_breakables.by_id.delete(id);
    ctxt_ = unwrap(enclosing_breakables.stack.pop(), "missing breakable context");
  }
  return [ctxt_, result];
};

/// Instantiate a QueryResponse in a probe context, without a
/// good ObligationCause.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:1633 probe_instantiate_query_response
FnCtxt.prototype.probe_instantiate_query_response = function (
  this: FnCtxt,
  span: SpanT,
  original_values: OriginalQueryValues,
  query_result: Canonical<QueryResponse<Ty>>,
): InferResult<Ty> {
  return this.instantiate_query_response_and_region_obligations(this.misc(span), this.param_env, original_values, query_result, fold_Ty);
};

/// Returns `true` if an expression is contained inside the LHS of an assignment expression.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs:1648 expr_in_place
FnCtxt.prototype.expr_in_place = function (this: FnCtxt, expr_id_: HirId): boolean {
  let expr_id = expr_id_;
  let contained_in_place = false;

  for (;;) {
    const parent = this.tcx.parent_hir_node(expr_id);
    if (parent.$ !== "Expr") break;
    const parent_expr = parent._0;
    const k = parent_expr.kind;
    if (k.$ === "Assign" || k.$ === "AssignOp") {
      const lhs = k.$ === "Assign" ? k._0 : k._1;
      if (HirId_eq(lhs.hir_id, expr_id)) {
        contained_in_place = true;
        break;
      }
    }
    expr_id = parent_expr.hir_id;
  }

  return contained_in_place;
};

// ---- local helpers (no upstream counterpart) ----

/** PORT (D4): the `TypeVisitable` impl of `(GenericArgsRef, Option<UserSelfTy>)` (tuple + `Option` container impls). */
const d_UserArgsTuple: TypeVisitable<[GenericArgs, UserSelfTy | undefined]> = {
  visit_with: (self, visitor) =>
    visit_with_tuple2(self, visitor, fold_GenericArgs.visit_with, (o, v) => visit_with_Option(o, v, visit_with_UserSelfTy)),
};

/**
 * PORT: `TypeErrCtxt` (rustc_trait_selection error_reporting) is `Pending` until errctxt-contract (wave 19); this is the
 * slice of its API this file calls. `FnCtxt::err_ctxt` itself stops at `unported(..)`, so these are never reached yet.
 */
interface TypeErrCtxtView {
  report_fulfillment_errors(errors: FulfillmentError[]): ErrorGuaranteed;
  emit_inference_failure_err(body_def_id: LocalDefIdT, failure_span: SpanT, arg: GenericArg, error_code: "E0282", should_label_span: boolean): Diag;
}
function err_ctxt_view(fcx: FnCtxt): TypeErrCtxtView {
  return fcx.err_ctxt() satisfies TypeErrCtxt as unknown as TypeErrCtxtView;
}
