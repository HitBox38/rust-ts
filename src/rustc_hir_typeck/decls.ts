// The rustc_hir_typeck contract (lane fnctxt-contract, plan-m3 wave 18): `FnCtxt`, whose `impl` blocks are spread over 25
// upstream files, `TypeckRootCtxt`, the other contract classes, and one declaration of every fn of the crate (1041).
// Grouped by upstream file in upstream order; each declaration carries `// <file>:<line>` (the line of its `fn` keyword
// at the pin, paths relative to compiler/rustc_hir_typeck/src/). Method bodies are assigned onto the prototype by the
// file that ports them (PORTING §5 "Methods defined in another file").
//
// Contents:
// - Pending types (rustc_middle hir/place.rs, ...) and the Deref machinery (`register_deref` / `install_derefs`).
// - `class TypeckRootCtxt` (typeck_root_ctxt.rs:26) + its methods.
// - `class FnCtxt` (fn_ctxt/mod.rs:42) + every `impl FnCtxt` method of the crate, file by file, with the lane that
//   ports it (fn_ctxt/checks.rs, expr.rs and pat.rs are split between two lanes at a line).
// - Module augmentations: the methods / associated fns of the other contract classes (`CoerceMany`, `Coerce`,
//   `CastCheck`, `Pick`, `ProbeContext`, `ConfirmContext`, `LoweredTy`, `DeferredCallResolution`,
//   `EnclosingBreakables`, `ExprUseVisitor`, `GatherLocalsVisitor`, `WritebackCx`).
// - The traits `Delegate` and `TypeInformationCtxt` (expr_use_visitor.rs) with the trait-object class of the latter.
// - `interface Companions`: enum methods (`Expectation`, `Diverges`, `Needs`, `TupleArgumentsFlag`).
// - `interface Fns_<module>`: the free fns of every module (contract.test.ts checks them against the stub modules).
// - Comment-only declarations of the remaining fns (single-file helper types, trait impls, nested fns): informative;
//   the owning lane decides their exact form.
//
// Contract rules (docs/handoff/fnctxt-contract.md "How to fill a stub"):
// - Ownership: lane fnctxt-contract wrote this file; afterwards root owns it. A lane that needs a missing or changed
//   declaration writes it in its handoff (signature + reason); if it cannot type-check without it, it adds a local
//   `declare module "<path>/decls.ts"` augmentation in its own file marked `// PORT(decls): pending root`.
// - Signatures (PORTING §5, as rustc_hir_analysis/decls.ts): `&self`/`&mut self`/`self` -> `this`; `&T`/`&mut T`/`Box`
//   -> `T`; `&[T]` -> `readonly T[]`; `Vec`/`ThinVec`/`SmallVec`/`IndexVec` -> `T[]`; `Option<T>` -> `T | undefined`;
//   `()` -> `void` as a return, `null` as a type argument; `Result<(), E>` -> `Result<undefined, E>`; tuples -> arrays;
//   `impl Iterator<Item = T>` / `impl IntoIterator` -> `Iterable<T>`; closures `impl FnOnce(A) -> R` / `F: FnMut(A)`
//   -> `(_1: A) => R`; `impl Into<X>` -> `X`; `impl ToString` / `impl Display` -> `string`; a destructuring parameter
//   is `_<index>`; `FxHashMap`/`UnordMap`/`FxIndexMap` -> `Map`, `FxHashSet`/`UnordSet`/`FxIndexSet` -> `Set` (primitive
//   or interned keys; `HirIdMap` / `HirIdSet` for `HirId` keys; a lane that needs a composite key uses `KeyedMap`).
// - Generics (D4): `T: TypeFoldable<TyCtxt>` / `TypeVisitable` / `Relate` add a descriptor parameter `d_T` last.
// - `hir::X` is `hir.X` (rustc_hir/lib.ts), `ty::X` rustc_middle's / rustc_type_ir's `X`; `GenericArgsRef` is
//   `GenericArgs`. The crate's own types come from the generated `<file>.gen.ts` (set `rustc_hir_typeck`).
// - Deref (below, "Deref"): inside an `FnCtxt` method `this.tcx`, `this.infcx`, `this.typeck_results`,
//   `this.next_ty_var(..)`, `this.register_predicate(..)`, ... read through the forwarders exactly as upstream's
//   auto-deref. A deref *coercion* to the inner type (`&FnCtxt` passed where `&InferCtxt` is expected, e.g.
//   `ObligationCtxt::new_with_diagnostics(self)`) is written explicitly: `this.infcx` (TS rejects the FnCtxt there:
//   the interfaces omit `drop`, so FnCtxt is not structurally an InferCtxt). `self.tcx()` (the `HirTyLowerer` method)
//   is `this.tcx`; `self.lowerer()` is `this.lowerer()` (fn_ctxt/mod.ts).
// - Associated fns without `self` of the contract classes are `declare static` members (`FnCtxt.new`) or namespace
//   augmentations (`CastCheck.new`), assigned by the owning file.
//
// Init order (a TDZ ReferenceError at load otherwise): this module imports only types (and defines the classes
// `TypeckRootCtxt`, `FnCtxt`, `TypeInformationCtxt` and the Deref registry). It must never import a rustc_hir_typeck
// module at runtime. lib.ts (the crate root) imports this file first, then every module, then calls `install_derefs()`.

import type { ExternAbi } from "../rustc_abi/extern_abi.ts";
import type { Mutability, Pinnedness } from "../rustc_ast_ir/lib.ts";
import type { AssignOpKind, BinOpKind, BindingMode, LitKind, UnsafeBinderCastKind } from "../rustc_ast/lib.ts";
import type * as ast from "../rustc_ast/lib.ts";
import type { ExprPrecedence } from "../rustc_ast/util/parser.ts";
import type { VecGraph } from "../rustc_data_structures/graph/vec_graph/mod.ts";
import type { DiagMessage } from "../rustc_error_messages/lib.ts";
import type { Applicability, Diag, DiagCtxtHandle, ErrCode } from "../rustc_errors/lib.ts";
import type { Autoderef } from "../rustc_hir_analysis/autoderef.ts";
import type { HirTyLowerer, HirTyLowererImpl } from "../rustc_hir_analysis/decls.ts";
import type { HirId, HirIdMap, ItemLocalId } from "../rustc_hir_id/lib.ts";
import type { DefKind, Res } from "../rustc_hir/def.ts";
import type * as hir from "../rustc_hir/lib.ts";
import type { InferCtxt } from "../rustc_infer/decls.ts";
import type { InferOk, InferResult, TypeTrace } from "../rustc_infer/infer/mod.ts";
import type { OpaqueTypeStorageEntries } from "../rustc_infer/infer/opaque_types/table.ts";
import type { Obligation, ObligationInspector, PredicateObligation, PredicateObligations, Selection } from "../rustc_infer/traits/mod.ts";
import type { LateContext } from "../rustc_lint/context.ts";
import type { OriginalQueryValues, QueryResponse } from "../rustc_middle/infer/canonical.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import type { ImplDerivedCause, ObligationCause, ObligationCauseCode, SelectionResult } from "../rustc_middle/traits/mod.ts";
import type { CandidateStep, CanonicalMethodAutoderefStepsGoal, MethodAutoderefStepsResult } from "../rustc_middle/traits/query.ts";
import type { Adjust, Adjustment, AllowTwoPhase, AutoBorrow, PatAdjust } from "../rustc_middle/ty/adjustment.ts";
import type { AdtDef } from "../rustc_middle/ty/adt.ts";
import type { AssocItem, AssocKind } from "../rustc_middle/ty/assoc.ts";
import type { BorrowKind, CaptureInfo, CapturedPlace, RootVariableMinCaptureList, UpvarCapture } from "../rustc_middle/ty/closure.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Const, FieldIdx, LayoutError, ParamTy, Region, VariantIdx } from "../rustc_middle/ty/decls.ts";
import type { Place, PlaceBase, PlaceWithHirId, Projection, ProjectionKind } from "../rustc_middle/hir/place.ts";
import type { GenericArg, GenericArgs, UserArgs, UserSelfTy } from "../rustc_middle/ty/generic_args.ts";
import type { Clauses } from "../rustc_middle/ty/list.ts";
import type { FieldDef, InstantiatedClauses, ParamEnv, ProvisionalHiddenType, Term, Ty, TypingEnv, VariantDef } from "../rustc_middle/ty/mod.ts";
import type { Clause, Predicate } from "../rustc_middle/ty/predicate.ts";
import type { CanonicalUserType, FakeReadCause, SplattedDef, TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import type { Session } from "../rustc_session/session.ts";
import type { DefId, LocalDefId, LocalModId } from "../rustc_span/def_id.ts";
import type { Edition } from "../rustc_span/edition.ts";
import type { ErrorGuaranteed, PathBuf, Span, Spanned } from "../rustc_span/lib.ts";
import type { OrdSpan } from "../rustc_span/span_encoding.ts";
import type { SortedMap } from "../rustc_data_structures/sorted_map.ts";
import type { Ident, Symbol } from "../rustc_span/symbol.ts";
import type { TypeErrCtxt } from "../rustc_trait_selection/decls.ts";
import type { FulfillmentEngine } from "../rustc_trait_selection/traits/engine.ts";
import type { FulfillmentError } from "../rustc_trait_selection/traits/mod.gen.ts";
import type { Canonical } from "../rustc_type_ir/canonical.ts";
import type { Binder, ClosureKind, FloatVid, FnSig, FnSigKind, IntVid, OpaqueTypeKey, Pending, PolyExistentialTraitRef, PolyFnSig, PolyProjectionClause, PolyTraitRef, RelateResult, TraitClause, TraitRef, TyVid, Unnormalized, Variance } from "../rustc_type_ir/decls.ts";
import type { TypeError } from "../rustc_type_ir/error.ts";
import type { TypeFoldable } from "../rustc_type_ir/fold.ts";
import type { CantBeErased, TypingMode } from "../rustc_type_ir/infer_ctxt.ts";
import type { TypeAndMut } from "../rustc_type_ir/ty_kind.gen.ts";
import type { TypeVisitable } from "../rustc_type_ir/visit.ts";
import type { MutRef } from "../std/mut_ref.ts";
import type { Result } from "../std/result.ts";
import type { CallStep, DeferredCallResolution, SplatLoweringInfo } from "./callee.gen.ts";
import type { CastCheck, CastError, CastKind, PointerKind } from "./cast.gen.ts";
import type { ClosureSignatures, ExpectedSig } from "./closure.gen.ts";
import type { CoerceMaybePinnedRef, CoerceResult, ForceLeakCheck } from "./coercion.gen.ts";
import type { CoerceMany } from "./coercion.ts";
import type { TypeMismatchSource } from "./demand.gen.ts";
import type { ReturnLikeStatementKind, SuggestAnnotations } from "./diagnostics.gen.ts";
import type { Diverges } from "./diverges.gen.ts";
import type { Expectation } from "./expectation.gen.ts";
import type { UnsafeUseReason } from "./fallback.gen.ts";
import type { Compatibility, ExpectedIdx, ProvidedIdx } from "./fn_ctxt/arg_matrix.gen.ts";
import type { ArgMatchingCtxt, ArgsCtxt, ArgumentsFormatting, CallCtxt, CallMetadata, FnParam, GenericIdx, SuggestionText, TupledArgCheckOutcome } from "./fn_ctxt/checks.gen.ts";
import type { UseSubtyping } from "./fn_ctxt/inspect_obligations.gen.ts";
import type { LoweredTy } from "./fn_ctxt/mod.gen.ts";
import type { DeclOrigin, Declaration } from "./gather_locals.gen.ts";
import type { BreakableCtxt, CoroutineTypes, EnclosingBreakables, Needs, PlaceOp, TupleArgumentsFlag } from "./lib.gen.ts";
import type { ConfirmContext, ConfirmResult } from "./method/confirm.gen.ts";
import type { CandidateSource, MethodCallee, MethodError, NoMatchData, TreatNotYetDefinedOpaques } from "./method/mod.gen.ts";
import type { Candidate, IsSuggestion, Mode, Pick, PickConstraintsForShadowed, PickDiagHints, PickResult, ProbeContext, ProbeResult, ProbeScope, UnsatisfiedPredicates } from "./method/probe.gen.ts";
import type { TraitInfo } from "./method/suggest.gen.ts";
import type { SelfSource } from "./method/suggest.ts";
import type { BinOpCategory, Op } from "./op.gen.ts";
import type { UsageKind } from "./opaque_types.gen.ts";
import type { AdjustMode, InheritedRefMatchRule, PatInfo, PeelKind, ResolvedPat, TopInfo } from "./pat.gen.ts";
import type { InferredCaptureInformation, MigrationWarningReason, NeededMigration, PlaceAncestryRelation, UpvarMigrationInfo } from "./upvar.gen.ts";
import type { WritebackCx } from "./writeback.gen.ts";

// ---- pending types (crates / files not ported yet); root replaces each with a re-export when it lands ----
// rustc_middle hir/place.rs (lane typeck-euv): `PlaceWithHirId<'tcx>`, `Place<'tcx>` (`ty::closure`'s `HirPlace`),
// `PlaceBase`, `Projection<'tcx>` (re-exported by expr_use_visitor.rs as `pub use`).
export type { Place, PlaceBase, PlaceWithHirId, Projection };
/** rustc_middle ty/layout.rs `SizeSkeleton<'tcx>` (intrinsicck.rs; layout-contract / middle-layout). */
export type { SizeSkeleton } from "../rustc_middle/ty/layout.ts";
import type { SizeSkeleton } from "../rustc_middle/ty/layout.ts";
/** rustc_trait_selection error_reporting/traits/mod.rs `DefIdOrName` (generated; errctxt-contract). */
export type { DefIdOrName } from "../rustc_trait_selection/error_reporting/traits/mod.gen.ts";
import type { DefIdOrName } from "../rustc_trait_selection/error_reporting/traits/mod.gen.ts";
/** writeback.rs:900 `trait Locatable` (`impl Locatable for Span / HirId`): `Span | HirId` is enough for `to_span`. */
export type Locatable = Span | HirId;

// ======================================================================================================================
// Deref (PORTING §8 "A Deref/DerefMut impl realised as a field"): `TypeckRootCtxt -> InferCtxt` (field `infcx`),
// `FnCtxt -> TypeckRootCtxt` (field `root_ctxt`), `Coerce` / `ProbeContext` / `ConfirmContext -> FnCtxt` (field `fcx`),
// and fn_ctxt/checks.rs's `FnCallDiagCtxt -> ArgMatchingCtxt -> ArgsCtxt -> CallCtxt -> FnCtxt`.
// ======================================================================================================================

// PORT(errctxt-contract): the registry moved to rust_ts/deref.ts, shared with rustc_trait_selection's
// `TypeErrCtxt -> InferCtxt` (error_reporting/mod.ts); this module re-exports it under the same names.
export { install_derefs, register_deref, registered_derefs } from "../rust_ts/deref.ts";

// ======================================================================================================================
// TypeckRootCtxt (typeck_root_ctxt.rs:26)
// ======================================================================================================================

// rustc-type: compiler/rustc_hir_typeck/src/typeck_root_ctxt.rs:26 TypeckRootCtxt
/// Data shared between a "typeck root" and its nested bodies,
/// e.g. closures defined within the function. For example:
/// ```ignore (illustrative)
/// fn foo() {
///     bar(move || { ... })
/// }
/// ```
/// Here, the function `foo()` and the closure passed to
/// `bar()` will each have their own `FnCtxt`, but they will
/// share the inference context, will process obligations together,
/// can access each other's local types (scoping permitted), etc.
// PORT: built only by `TypeckRootCtxt::new` (typeck_root_ctxt.rs:83). `RefCell` / `Cell` fields are the values
// (PORTING §5). `Deref<Target = InferCtxt>` is the field `infcx` plus the forwarders of `register_deref` (header).
export class TypeckRootCtxt {
  constructor(
    public infcx: InferCtxt,

    public typeck_results: TypeckResults,

    public locals: HirIdMap<Ty>,

    public fulfillment_cx: FulfillmentEngine<FulfillmentError>,

    // Used to detect opaque types uses added after we've already checked them.
    //
    // See [FnCtxt::detect_opaque_types_added_during_writeback] for more details.
    public checked_opaque_types_storage_entries: OpaqueTypeStorageEntries | undefined,

    /// Some additional `Sized` obligations badly affect type inference.
    /// These obligations are added in a later stage of typeck.
    /// Removing these may also cause additional complications, see #101066.
    public deferred_sized_obligations: [Ty, Span, ObligationCauseCode][],

    /// When we process a call like `c()` where `c` is a closure type,
    /// we may not have decided yet whether `c` is a `Fn`, `FnMut`, or
    /// `FnOnce` closure. In that case, we defer full resolution of the
    /// call until upvar inference can kick in and make the
    /// decision. We keep these deferred resolutions grouped by the
    /// def-id of the closure, so that once we decide, we can easily go
    /// back and process them.
    // PORT: `LocalDefIdMap` (an `FxHashMap`, never iterated): a `Map` keyed by the `LocalDefId` handle.
    public deferred_call_resolutions: Map<LocalDefId, DeferredCallResolution[]>,

    public deferred_cast_checks: CastCheck[],

    public deferred_transmute_checks: [Ty, Ty, HirId][],

    public deferred_offload_checks: [Ty, Ty, Ty, HirId][],

    public deferred_asm_checks: [hir.InlineAsm, HirId][],

    public deferred_repeat_expr_checks: [hir.Expr, Ty, Const][],

    /// Whenever we introduce an adjustment from `!` into a type variable,
    /// we record that type variable here. This is later used to inform
    /// fallback. See the `fallback` module for details.
    public diverging_type_vars: TyVid[],

    /// Parent module
    public mod_id: LocalModId,
  ) {}

  // typeck_root_ctxt.rs:83 (assigned in typeck_root_ctxt.ts)
  declare static new: (tcx: TyCtxt, def_id: LocalDefId) => TypeckRootCtxt;
}

/** TypeckRootCtxt's own members that shadow `InferCtxt`'s (plus `drop`, so that a TypeckRootCtxt is not structurally an InferCtxt). */
export type TypeckRootCtxt_shadowed = "drop";

export interface TypeckRootCtxt extends Omit<InferCtxt, TypeckRootCtxt_shadowed> {
  // ---- compiler/rustc_hir_typeck/src/typeck_root_ctxt.rs (lane fnctxt-contract) ----
  // typeck_root_ctxt.rs:77
  deref(): InferCtxt;
  // typeck_root_ctxt.rs:114
  register_predicate(obligation: PredicateObligation): void;
  // typeck_root_ctxt.rs:122
  register_predicates(obligations: Iterable<PredicateObligation>): void;
  // typeck_root_ctxt.rs:131
  register_infer_ok_obligations<T>(infer_ok: InferOk<T>): T;
}

// ======================================================================================================================
// FnCtxt (fn_ctxt/mod.rs:46)
// ======================================================================================================================

// rustc-type: compiler/rustc_hir_typeck/src/fn_ctxt/mod.rs:46 FnCtxt
/// The `FnCtxt` stores type-checking context needed to type-check bodies of
/// functions, closures, and `const`s, including performing type inference
/// with [`InferCtxt`].
///
/// This is in contrast to `rustc_hir_analysis::collect::ItemCtxt`, which is
/// used to type-check item *signatures* and thus does not perform type
/// inference.
///
/// See `ItemCtxt`'s docs for more.
///
/// [`InferCtxt`]: infer::InferCtxt
// PORT: built only by `FnCtxt::new` (fn_ctxt/mod.rs:136). `RefCell` / `Cell` fields are the values (PORTING §5);
// `Option<RefCell<CoerceMany>>` is `CoerceMany | undefined`. `Deref<Target = TypeckRootCtxt>` is the field `root_ctxt`
// plus the forwarders of `register_deref` (header). `impl HirTyLowerer for FnCtxt` is the vtable object
// `HirTyLowerer_FnCtxt` (fn_ctxt/mod.ts), reached with `lowerer()`.
export class FnCtxt {
  constructor(
    public body_def_id: LocalDefId,

    /// The parameter environment used for proving trait obligations
    /// in this function. This can change when we descend into
    /// closures (as they bring new things into scope), hence it is
    /// not part of `Inherited` (as of the time of this writing,
    /// closures do not yet change the environment, but they will
    /// eventually).
    public param_env: ParamEnv,

    /// If `Some`, this stores coercion information for returned
    /// expressions. If `None`, this is in a context where return is
    /// inappropriate, such as a const expression.
    ///
    /// This is a `RefCell<CoerceMany>`, which means that we
    /// can track all the return expressions and then use them to
    /// compute a useful coercion from the set, similar to a match
    /// expression or other branching context. You can use methods
    /// like `expected_ty` to access the declared return type (if
    /// any).
    public ret_coercion: CoerceMany | undefined,

    /// First span of a return site that we find. Used in error messages.
    public ret_coercion_span: Span | undefined,

    public coroutine_types: CoroutineTypes | undefined,

    /// Whether the last checked node generates a divergence (e.g.,
    /// `return` will set this to `Always`). In general, when entering
    /// an expression or other node in the tree, the initial value
    /// indicates whether prior parts of the containing expression may
    /// have diverged. It is then typically set to `Maybe` (and the
    /// old value remembered) for processing the subparts of the
    /// current expression. As each subpart is processed, they may set
    /// the flag to `Always`, etc. Finally, at the end, we take the
    /// result and "union" it with the original value, so that when we
    /// return the flag indicates if any subpart of the parent
    /// expression (up to and including this part) has diverged. So,
    /// if you read it after evaluating a subexpression `X`, the value
    /// you get indicates whether any subexpression that was
    /// evaluating up to and including `X` diverged.
    ///
    /// We currently use this flag for the following purposes:
    ///
    /// - To warn about unreachable code: if, after processing a
    ///   sub-expression but before we have applied the effects of the
    ///   current node, we see that the flag is set to `Always`, we
    ///   can issue a warning. This corresponds to something like
    ///   `foo(return)`; we warn on the `foo()` expression. (We then
    ///   update the flag to `WarnedAlways` to suppress duplicate
    ///   reports.) Similarly, if we traverse to a fresh statement (or
    ///   tail expression) from an `Always` setting, we will issue a
    ///   warning. This corresponds to something like `{return;
    ///   foo();}` or `{return; 22}`, where we would warn on the
    ///   `foo()` or `22`.
    /// - To assign the `!` type to block expressions with diverging
    ///   statements.
    ///
    /// An expression represents dead code if, after checking it,
    /// the diverges flag is set to something other than `Maybe`.
    public diverges: Diverges,

    /// If one of the function arguments is a never pattern, this counts as diverging code.
    /// This affect typechecking of the function body.
    public function_diverges_because_of_empty_arguments: Diverges,

    /// Whether the currently checked node is the whole body of the function.
    public is_whole_body: boolean,

    public enclosing_breakables: EnclosingBreakables,

    public root_ctxt: TypeckRootCtxt,

    /// True if a divirging inference variable has been set to `()`/`!` because
    /// of never type fallback. This is only used for diagnostics.
    public diverging_fallback_has_occurred: boolean,

    /// Clauses that we lowered as part of the `impl_trait_in_bindings` feature.
    ///
    /// These are stored here so we may collect them when canonicalizing user
    /// type ascriptions later.
    // PORT: `ItemLocalMap` (an `FxHashMap`): a `Map` keyed by the `ItemLocalId` number.
    public trait_ascriptions: Map<ItemLocalId, Clause[]>,

    /// Whether the current crate enables the `rustc_attrs` feature.
    /// This allows to skip processing attributes in many places.
    public has_rustc_attrs: boolean,
  ) {}

  // fn_ctxt/mod.rs:136 (assigned in fn_ctxt/mod.ts)
  declare static new: (root_ctxt: TypeckRootCtxt, param_env: ParamEnv, body_def_id: LocalDefId) => FnCtxt;
  // fn_ctxt/_impl.rs:595 (assigned in fn_ctxt/_impl.ts)
  declare static user_args_for_adt: (ty: LoweredTy) => UserArgs;
  // fn_ctxt/_impl.rs:627 (assigned in fn_ctxt/_impl.ts)
  declare static can_contain_user_lifetime_bounds: <T>(t: T, d_T: TypeVisitable<T>) => boolean;
}

/** FnCtxt's own members that shadow `TypeckRootCtxt`'s / `InferCtxt`'s (plus `drop`). */
export type FnCtxt_shadowed = "dcx" | "deref" | "drop" | "err_ctxt" | "root_vid" | "typing_mode";

export interface FnCtxt extends Omit<TypeckRootCtxt, FnCtxt_shadowed> {
  // ---- compiler/rustc_hir_typeck/src/_match.rs (lane typeck-impl) ----
  // _match.rs:19
  check_expr_match(expr: hir.Expr, scrut: hir.Expr, arms: readonly hir.Arm[], orig_expected: Expectation, match_src: hir.MatchSource): Ty;
  // _match.rs:179
  explain_never_type_coerced_to_unit(err: Diag, arm: hir.Arm, arm_ty: Ty, prior_arm: [HirId | undefined, Ty, Span] | undefined, expr: hir.Expr): void;
  // _match.rs:211
  suggest_removing_semicolon_for_coerce(diag: Diag, expr: hir.Expr, arm_ty: Ty, prior_arm: [HirId | undefined, Ty, Span] | undefined): void;
  // _match.rs:263
  warn_arms_when_scrutinee_diverges(arms: readonly hir.Arm[]): void;
  // _match.rs:272
  if_fallback_coercion(if_span: Span, cond_expr: hir.Expr, then_expr: hir.Expr, coercion: CoerceMany): boolean;
  // _match.rs:295
  is_from_assert_macro(span: Span): boolean;
  // _match.rs:313
  explain_if_expr(err: Diag, ret_reason: [Span, string] | undefined, if_span: Span, cond_expr: hir.Expr, then_expr: hir.Expr, error: MutRef<boolean>): void;
  // _match.rs:407
  maybe_get_coercion_reason(hir_id: HirId, sp: Span): [Span, string] | undefined;
  // _match.rs:437
  if_cause(expr_id: HirId, else_expr: hir.Expr, tail_defines_return_position_impl_trait: LocalDefId | undefined): ObligationCause;
  // _match.rs:452
  demand_scrutinee_type(scrut: hir.Expr, contains_ref_bindings: Mutability | undefined, no_arms: boolean): Ty;
  // _match.rs:528
  return_position_impl_trait_from_match_expectation(expectation: Expectation): LocalDefId | undefined;

  // ---- compiler/rustc_hir_typeck/src/autoderef.rs (lane fnctxt-contract) ----
  // autoderef.rs:17
  autoderef(span: Span, base_ty: Ty): Autoderef;
  // autoderef.rs:21
  try_overloaded_deref(span: Span, base_ty: Ty): InferOk<MethodCallee> | undefined;
  // autoderef.rs:30
  adjust_steps(autoderef: Autoderef): Adjustment[];
  // autoderef.rs:34
  adjust_steps_as_infer_ok(autoderef: Autoderef): InferOk<Adjustment[]>;

  // ---- compiler/rustc_hir_typeck/src/callee.rs (lane typeck-callee-cast) ----
  // callee.rs:89
  check_expr_call(call_expr: hir.Expr, callee_expr: hir.Expr, arg_exprs: readonly hir.Expr[], expected: Expectation): Ty;
  // callee.rs:190
  check_call_abi(abi: ExternAbi, span: Span): void;
  // callee.rs:233
  try_overloaded_call_step(call_expr: hir.Expr, callee_expr: hir.Expr, arg_exprs: readonly hir.Expr[], autoderef: Autoderef): CallStep | undefined;
  // callee.rs:369
  try_overloaded_call_traits(call_expr: hir.Expr, adjusted_ty: Ty, opt_arg_exprs: readonly hir.Expr[] | undefined): [Adjustment | undefined, MethodCallee] | undefined;
  // callee.rs:456
  is_scalable_vector_ctor(callee_ty: Ty): boolean;
  // callee.rs:471
  identify_bad_closure_def_and_call(err: Diag, hir_id: HirId, callee_node: hir.ExprKind, callee_span: Span): void;
  // callee.rs:532
  maybe_suggest_bad_array_definition(err: Diag, call_expr: hir.Expr, callee_expr: hir.Expr): boolean;
  // callee.rs:558
  confirm_builtin_call(call_expr: hir.Expr, callee_expr: hir.Expr, callee_ty: Ty, arg_exprs: readonly hir.Expr[], expected: Expectation): Ty;
  // callee.rs:659
  check_argument_types_maybe_method_like(fn_sig: FnSig, call_expr: hir.Expr, arg_exprs: readonly hir.Expr[], expected: Expectation, tuple_arguments_flag: TupleArgumentsFlag, fn_id: SplatLoweringInfo, callee_generic_args: GenericArgs | undefined): void;
  // callee.rs:781
  get_info_for_method_call_adjustments(call_expr: hir.Expr, arg_exprs: readonly hir.Expr[]): [DefId, Set<number>] | undefined;
  // callee.rs:812
  suggest_call_as_method(diag: Diag, segment: hir.PathSegment, arg_exprs: readonly hir.Expr[], call_expr: hir.Expr, expected: Expectation): void;
  // callee.rs:900
  report_invalid_callee(call_expr: hir.Expr, callee_expr: hir.Expr, callee_ty: Ty, arg_exprs: readonly hir.Expr[]): ErrorGuaranteed;
  // callee.rs:1079
  confirm_deferred_closure_call(call_expr: hir.Expr, arg_exprs: readonly hir.Expr[], expected: Expectation, closure_def_id: LocalDefId, fn_sig: FnSig): Ty;
  // callee.rs:1108
  enforce_context_effects(call_hir_id: HirId | undefined, span: Span, callee_did: DefId, callee_args: GenericArgs): void;
  // callee.rs:1181
  confirm_overloaded_call(call_expr: hir.Expr, arg_exprs: readonly hir.Expr[], expected: Expectation, method: MethodCallee): Ty;

  // ---- compiler/rustc_hir_typeck/src/cast.rs (lane typeck-callee-cast) ----
  // cast.rs:107
  pointer_kind(t: Ty, span: Span): Result<PointerKind | undefined, ErrorGuaranteed>;

  // ---- compiler/rustc_hir_typeck/src/closure.rs (lane typeck-method) ----
  // closure.rs:48
  check_expr_closure(closure: hir.Closure, expr_span: Span, expected: Expectation): Ty;
  // closure.rs:290
  deduce_closure_signature(expected_ty: Ty, closure_kind: hir.ClosureKind): [ExpectedSig | undefined, ClosureKind | undefined];
  // closure.rs:335
  deduce_closure_signature_from_predicates(expected_ty: Ty, closure_kind: hir.ClosureKind, clauses: Iterable<[Clause, Span]>): [ExpectedSig | undefined, ClosureKind | undefined];
  // closure.rs:446
  deduce_sig_from_projection(cause_span: Span | undefined, closure_kind: hir.ClosureKind, projection: PolyProjectionClause): ExpectedSig | undefined;
  // closure.rs:479
  extract_sig_from_projection(cause_span: Span | undefined, projection: PolyProjectionClause): ExpectedSig | undefined;
  // closure.rs:524
  extract_sig_from_projection_and_future_bound(cause_span: Span | undefined, projection: PolyProjectionClause): ExpectedSig | undefined;
  // closure.rs:582
  sig_of_closure(expr_def_id: LocalDefId, decl: hir.FnDecl, closure_kind: hir.ClosureKind, expected_sig: ExpectedSig | undefined): ClosureSignatures;
  // closure.rs:599
  sig_of_closure_no_expectation(expr_def_id: LocalDefId, decl: hir.FnDecl, closure_kind: hir.ClosureKind): ClosureSignatures;
  // closure.rs:658
  sig_of_closure_with_expectation(expr_def_id: LocalDefId, decl: hir.FnDecl, closure_kind: hir.ClosureKind, expected_sig: ExpectedSig): ClosureSignatures;
  // closure.rs:714
  sig_of_closure_with_mismatched_number_of_arguments(expr_def_id: LocalDefId, decl: hir.FnDecl, expected_sig: ExpectedSig): ClosureSignatures;
  // closure.rs:756
  merge_supplied_sig_with_expectation(expr_def_id: LocalDefId, decl: hir.FnDecl, closure_kind: hir.ClosureKind, expected_sigs: ClosureSignatures): InferResult<ClosureSignatures>;
  // closure.rs:839
  supplied_sig_of_closure(expr_def_id: LocalDefId, decl: hir.FnDecl, closure_kind: hir.ClosureKind): PolyFnSig;
  // closure.rs:921
  deduce_future_output_from_obligations(body_def_id: LocalDefId): Ty | undefined;
  // closure.rs:997
  deduce_future_output_from_projection(cause_span: Span, predicate: PolyProjectionClause): Ty | undefined;
  // closure.rs:1042
  error_sig_of_closure(decl: hir.FnDecl, guar: ErrorGuaranteed): PolyFnSig;
  // closure.rs:1072
  closure_sigs(expr_def_id: LocalDefId, bound_sig: PolyFnSig): ClosureSignatures;

  // ---- compiler/rustc_hir_typeck/src/coercion.rs (lane typeck-coerce) ----
  // coercion.rs:1134
  coerce(expr: hir.Expr, expr_ty: Ty, target: Ty, allow_two_phase: AllowTwoPhase, cause: ObligationCause | undefined): RelateResult<Ty>;
  // coercion.rs:1171
  may_coerce(expr_ty: Ty, target_ty: Ty): boolean;
  // coercion.rs:1193
  may_coerce_except_never(expr_ty: Ty, target_ty: Ty): boolean;
  // coercion.rs:1203
  deref_steps_for_suggestion(expr_ty: Ty, target: Ty): number | undefined;
  // coercion.rs:1222
  deref_once_mutably_for_diagnostic(expr_ty: Ty): Ty | undefined;
  // coercion.rs:1236
  sig_for_coerce_lub(ty: Ty, closure_upvars_terr: TypeError): Result<PolyFnSig, TypeError>;
  // coercion.rs:1248
  sig_for_fn_def_coercion(fndef: Ty, expected_safety: hir.Safety | undefined): Result<PolyFnSig, TypeError>;
  // coercion.rs:1291
  sig_for_closure_coercion(closure: Ty, expected_safety: hir.Safety | undefined, closure_upvars_terr: TypeError): Result<PolyFnSig, TypeError>;
  // coercion.rs:1329
  try_find_coercion_lub(cause: ObligationCause, exprs: readonly hir.Expr[], prev_ty: Ty, new_: hir.Expr, new_ty: Ty): RelateResult<Ty>;

  // ---- compiler/rustc_hir_typeck/src/demand.rs (lane typeck-coerce (demand_* :171..289) / wave 19 (rest)) ----
  // demand.rs:20
  emit_type_mismatch_suggestions(err: Diag, expr: hir.Expr, expr_ty: Ty, expected: Ty, expected_ty_expr: hir.Expr | undefined, error: TypeError | undefined): void;
  // demand.rs:73
  emit_coerce_suggestions(err: Diag, expr: hir.Expr, expr_ty: Ty, expected: Ty, expected_ty_expr: hir.Expr | undefined, error: TypeError | undefined): void;
  // demand.rs:112
  adjust_expr_for_assert_eq_macro(found_expr: MutRef<hir.Expr>, expected_expr: MutRef<hir.Expr | undefined>): void;
  // demand.rs:171
  demand_suptype(sp: Span, expected: Ty, actual: Ty): void;
  // demand.rs:177
  demand_suptype_diag(sp: Span, expected: Ty, actual: Ty): Result<undefined, Diag>;
  // demand.rs:187
  demand_suptype_with_origin(cause: ObligationCause, expected: Ty, actual: Ty): Result<undefined, Diag>;
  // demand.rs:201
  demand_eqtype(sp: Span, expected: Ty, actual: Ty): void;
  // demand.rs:207
  demand_eqtype_diag(sp: Span, expected: Ty, actual: Ty): Result<undefined, Diag>;
  // demand.rs:216
  demand_eqtype_with_origin(cause: ObligationCause, expected: Ty, actual: Ty): Result<undefined, Diag>;
  // demand.rs:230
  demand_coerce(expr: hir.Expr, checked_ty: Ty, expected: Ty, expected_ty_expr: hir.Expr | undefined, allow_two_phase: AllowTwoPhase): Ty;
  // demand.rs:256
  demand_coerce_diag(expr: hir.Expr, checked_ty: Ty, expected: Ty, expected_ty_expr: hir.Expr | undefined, allow_two_phase: AllowTwoPhase): Result<Ty, Diag>;
  // demand.rs:290
  note_source_of_type_mismatch_constraint(err: Diag, expr: hir.Expr, source: TypeMismatchSource): boolean;
  // demand.rs:577
  annotate_loop_expected_due_to_inference(err: Diag, expr: hir.Expr, error: TypeError | undefined): void;
  // demand.rs:708
  annotate_expected_due_to_let_ty(err: Diag, expr: hir.Expr, error: TypeError | undefined): void;
  // demand.rs:856
  annotate_mut_binding_to_immutable_binding(err: Diag, expr: hir.Expr, expr_ty: Ty, expected: Ty, error: TypeError | undefined): boolean;
  // demand.rs:929
  annotate_alternative_method_deref_for_unop(err: Diag, expr: hir.Expr, error: TypeError | undefined): void;
  // demand.rs:953
  annotate_alternative_method_deref(err: Diag, expr: hir.Expr, expected: Ty | undefined): void;
  // demand.rs:1126
  get_conversion_methods_for_diagnostic(span: Span, expected: Ty, checked_ty: Ty, hir_id: HirId): AssocItem[];
  // demand.rs:1159
  has_only_self_parameter(method: AssocItem): boolean;
  // demand.rs:1165
  maybe_get_block_expr(expr: hir.Expr): hir.Expr | undefined;
  // demand.rs:1179
  is_destruct_assignment_desugaring(expr: hir.Expr): boolean;
  // demand.rs:1197
  explain_self_literal(err: Diag, expr: hir.Expr, expected: Ty, found: Ty): void;
  // demand.rs:1250
  note_wrong_return_ty_due_to_generic_arg(err: Diag, expr: hir.Expr, checked_ty: Ty): void;

  // ---- compiler/rustc_hir_typeck/src/expr.rs, lines 1..1854 (lane typeck-expr-a) ----
  // expr.rs:59
  precedence(expr: hir.Expr): ExprPrecedence;
  // expr.rs:80
  check_expr_has_type_or_error(expr: hir.Expr, expected_ty: Ty, extend_err: (_1: Diag) => void): Ty;
  // expr.rs:132
  check_expr_coercible_to_type(expr: hir.Expr, expected: Ty, expected_ty_expr: hir.Expr | undefined): Ty;
  // expr.rs:141
  check_expr_coercible_to_type_or_error(expr: hir.Expr, expected: Ty, expected_ty_expr: hir.Expr | undefined, extend_err: (_1: Diag, _2: Ty) => void): Ty;
  // expr.rs:167
  check_expr_with_hint(expr: hir.Expr, expected: Ty): Ty;
  // expr.rs:177
  check_expr_with_expectation_and_needs(expr: hir.Expr, expected: Expectation, needs: Needs): Ty;
  // expr.rs:195
  check_expr(expr: hir.Expr): Ty;
  // expr.rs:201
  check_expr_with_needs(expr: hir.Expr, needs: Needs): Ty;
  // expr.rs:212
  check_expr_with_expectation(expr: hir.Expr, expected: Expectation): Ty;
  // expr.rs:224
  check_expr_with_expectation_and_args(expr: hir.Expr, expected: Expectation, call_expr_and_args: [hir.Expr, readonly hir.Expr[]] | undefined): Ty;
  // expr.rs:329
  check_expr_kind(expr: hir.Expr, expected: Expectation): Ty;
  // expr.rs:411
  check_expr_unop(unop: ast.UnOp, oprnd: hir.Expr, expected: Expectation, expr: hir.Expr): Ty;
  // expr.rs:465
  check_expr_addr_of(kind: ast.BorrowKind, mutbl: Mutability, oprnd: hir.Expr, expected: Expectation, expr: hir.Expr): Ty;
  // expr.rs:529
  check_named_place_expr(oprnd: hir.Expr): void;
  // expr.rs:553
  check_expr_path(qpath: hir.QPath, expr: hir.Expr, call_expr_and_args: [hir.Expr, readonly hir.Expr[]] | undefined): Ty;
  // expr.rs:715
  check_expr_break(destination: hir.Destination, expr_opt: hir.Expr | undefined, expr: hir.Expr): Ty;
  // expr.rs:862
  check_expr_continue(destination: hir.Destination, expr: hir.Expr): Ty;
  // expr.rs:887
  check_expr_return(expr_opt: hir.Expr | undefined, expr: hir.Expr): Ty;
  // expr.rs:933
  check_expr_become(call: hir.Expr, expr: hir.Expr): Ty;
  // expr.rs:967
  check_return_or_body_tail(return_expr: hir.Expr, explicit_return: boolean): void;
  // expr.rs:1017
  emit_return_outside_of_fn_body(expr: hir.Expr, kind: ReturnLikeStatementKind): void;
  // expr.rs:1061
  point_at_return_for_opaque_ty_error(errors: FulfillmentError[], hir_id: HirId, span: Span, return_expr_ty: Ty, return_span: Span): void;
  // expr.rs:1085
  check_lhs_assignable(lhs: hir.Expr, code: ErrCode, op_span: Span, adjust_err: (_1: Diag) => void): void;
  // expr.rs:1122
  check_for_missing_semi(expr: hir.Expr, err: Diag): boolean;
  // expr.rs:1150
  comes_from_while_condition(original_expr_id: HirId, then: (_1: hir.Expr) => void): void;
  // expr.rs:1198
  check_expr_if(expr_id: HirId, cond_expr: hir.Expr, then_expr: hir.Expr, opt_else_expr: hir.Expr | undefined, sp: Span, orig_expected: Expectation): Ty;
  // expr.rs:1264
  check_expr_assign(expr: hir.Expr, expected: Expectation, lhs: hir.Expr, rhs: hir.Expr, span: Span): Ty;
  // expr.rs:1331
  expr_assign_expected_bool_error(expr: hir.Expr, lhs: hir.Expr, rhs: hir.Expr, span: Span): ErrorGuaranteed;
  // expr.rs:1413
  check_expr_let(let_expr: hir.LetExpr, hir_id: HirId): Ty;
  // expr.rs:1436
  check_expr_loop(body: hir.Block, source: hir.LoopSource, expected: Expectation, expr: hir.Expr): Ty;
  // expr.rs:1482
  check_expr_method_call(expr: hir.Expr, segment: hir.PathSegment, rcvr: hir.Expr, args: readonly hir.Expr[], expected: Expectation): Ty;
  // expr.rs:1545
  check_expr_use(used_expr: hir.Expr, expected: Expectation): Ty;
  // expr.rs:1553
  check_expr_cast(e: hir.Expr, t: hir.Ty, expr: hir.Expr): Ty;
  // expr.rs:1586
  check_expr_unsafe_binder_cast(span: Span, kind: UnsafeBinderCastKind, inner_expr: hir.Expr, hir_ty: hir.Ty | undefined, expected: Expectation): Ty;
  // expr.rs:1676
  check_expr_array(args: readonly hir.Expr[], expected: Expectation, expr: hir.Expr): Ty;
  // expr.rs:1715
  check_expr_const_block(block: hir.ConstBlock, expected: Expectation): Ty;
  // expr.rs:1732
  check_expr_repeat(element: hir.Expr, count: hir.ConstArg, expected: Expectation, expr: hir.Expr): Ty;
  // expr.rs:1784
  check_expr_tuple(elements: readonly hir.Expr[], expected: Expectation, expr: hir.Expr): Ty;
  // expr.rs:1818
  check_expr_struct(expr: hir.Expr, expected: Expectation, qpath: hir.QPath, fields: readonly hir.ExprField[], base_expr: hir.StructTailExpr): Ty;

  // ---- compiler/rustc_hir_typeck/src/expr.rs, lines 1855..3957 (lane typeck-expr-b) ----
  // expr.rs:1856
  check_expr_struct_fields(adt_ty: Ty, expected: Expectation, expr: hir.Expr, path_span: Span, variant: VariantDef, hir_fields: readonly hir.ExprField[], base_expr: hir.StructTailExpr): void;
  // expr.rs:2254
  check_struct_fields_on_error(fields: readonly hir.ExprField[], base_expr: hir.StructTailExpr): void;
  // expr.rs:2278
  report_missing_fields(adt_ty: Ty, span: Span, full_span: Span, remaining_fields: Map<Ident, [FieldIdx, FieldDef]>, variant: VariantDef, hir_fields: readonly hir.ExprField[], args: GenericArgs): void;
  // expr.rs:2359
  suggest_fru_from_range_and_emit(last_expr_field: hir.ExprField, variant: VariantDef, args: GenericArgs, err: Diag): void;
  // expr.rs:2424
  report_private_fields(adt_ty: Ty, span: Span, expr_span: Span, private_fields: FieldDef[], used_fields: readonly hir.ExprField[]): void;
  // expr.rs:2548
  report_unknown_field(ty: Ty, variant: VariantDef, expr: hir.Expr, field: hir.ExprField, skip_fields: readonly hir.ExprField[], kind_name: string): ErrorGuaranteed;
  // expr.rs:2688
  available_field_names(variant: VariantDef, expr: hir.Expr, skip_fields: readonly hir.ExprField[]): Symbol[];
  // expr.rs:2705
  name_series_display(names: Symbol[]): string;
  // expr.rs:2719
  find_adt_field(base_def: AdtDef, ident: Ident): [FieldIdx, FieldDef] | undefined;
  // expr.rs:2748
  check_expr_field(expr: hir.Expr, base: hir.Expr, field: Ident, expected: Expectation): Ty;
  // expr.rs:2921
  suggest_await_on_field_access(err: Diag, field_ident: Ident, base: hir.Expr, ty: Ty): void;
  // expr.rs:2970
  ban_nonexisting_field(ident: Ident, base: hir.Expr, expr: hir.Expr, base_ty: Ty): ErrorGuaranteed;
  // expr.rs:3029
  ban_private_field_access(expr: hir.Expr, expr_t: Ty, field: Ident, base_did: DefId, return_ty: Ty | undefined): ErrorGuaranteed;
  // expr.rs:3055
  ban_take_value_of_method(expr: hir.Expr, expr_t: Ty, field: Ident): ErrorGuaranteed;
  // expr.rs:3129
  point_at_param_definition(err: Diag, param: ParamTy): void;
  // expr.rs:3146
  maybe_suggest_array_indexing(err: Diag, base: hir.Expr, field: Ident, len: Const): void;
  // expr.rs:3175
  suggest_first_deref_field(err: Diag, base: hir.Expr, field: Ident): void;
  // expr.rs:3197
  no_such_field_err(field: Ident, base_ty: Ty, expr: hir.Expr): Diag;
  // expr.rs:3315
  private_field_err(field: Ident, base_did: DefId): Diag;
  // expr.rs:3327
  get_field_candidates_considering_privacy_for_diag(span: Span, base_ty: Ty): [Ident, Ty][][];
  // expr.rs:3398
  check_for_nested_field_satisfying_condition_for_diag(span: Span, matches: (_1: Ident, _2: Ty) => boolean, _2: [Ident, Ty], field_path: Ident[]): Ident[] | undefined;
  // expr.rs:3432
  check_expr_index(base: hir.Expr, idx: hir.Expr, expr: hir.Expr, brackets_span: Span): Ty;
  // expr.rs:3523
  find_and_report_unsatisfied_index_impl(base_expr: hir.Expr, base_ty: Ty): [ErrorGuaranteed, Ty, Ty] | undefined;
  // expr.rs:3618
  point_at_index(errors: FulfillmentError[], span: Span): void;
  // expr.rs:3646
  check_expr_yield(value: hir.Expr, expr: hir.Expr): Ty;
  // expr.rs:3666
  check_expr_asm_operand(expr: hir.Expr, is_input: boolean): void;
  // expr.rs:3701
  check_expr_asm(asm: hir.InlineAsm, span: Span): Ty;
  // expr.rs:3785
  check_expr_offset_of(container: hir.Ty, fields: readonly Ident[], expr: hir.Expr): Ty;

  // ---- compiler/rustc_hir_typeck/src/fallback.rs (lane typeck-lib-wb) ----
  // fallback.rs:25
  type_inference_fallback(): void;
  // fallback.rs:66
  fallback_types(): boolean;
  // fallback.rs:113
  fallback_types_to_error(guar: ErrorGuaranteed, unresolved_ty: TyVid[], unresolved_int: IntVid[], unresolved_float: FloatVid[]): void;
  // fallback.rs:146
  calculate_fallback_to_f32(unresolved_root_variables: readonly FloatVid[]): Set<FloatVid>;
  // fallback.rs:197
  calculate_diverging_fallback(): Set<TyVid>;
  // fallback.rs:231
  lint_never_type_fallback_flowing_into_unsafe_code(unsafe_infer_vars: Map<TyVid, [HirId, Span, UnsafeUseReason]>, coercion_graph: VecGraph<TyVid>, root_vid: TyVid): void;
  // fallback.rs:278
  create_coercion_graph(): VecGraph<TyVid>;
  // fallback.rs:317
  root_vid(ty: Ty): TyVid | undefined;
  // fallback.rs:322
  root_float_vid(ty: Ty): FloatVid | undefined;
  // fallback.rs:328
  try_to_suggest_annotations(diverging_vids: readonly TyVid[], coercions: VecGraph<TyVid>): SuggestAnnotations;

  // ---- compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs (lane typeck-impl) ----
  // fn_ctxt/_impl.rs:52
  warn_if_unreachable(id: HirId, span: Span, kind: string): void;
  // fn_ctxt/_impl.rs:114
  deeply_resolve_ignoring_regions_with_obligations<T>(t: T, d_T: TypeFoldable<T>): T;
  // fn_ctxt/_impl.rs:141
  record_deferred_call_resolution(closure_def_id: LocalDefId, r: DeferredCallResolution): void;
  // fn_ctxt/_impl.rs:150
  remove_deferred_call_resolutions(closure_def_id: LocalDefId): DeferredCallResolution[];
  // fn_ctxt/_impl.rs:158
  tag(): string;
  // fn_ctxt/_impl.rs:162
  local_ty(span: Span, nid: HirId): Ty;
  // fn_ctxt/_impl.rs:169
  write_ty(id: HirId, ty: Ty): void;
  // fn_ctxt/_impl.rs:199
  write_field_index(hir_id: HirId, index: FieldIdx): void;
  // fn_ctxt/_impl.rs:204
  write_resolution(hir_id: HirId, r: Result<[DefKind, DefId], ErrorGuaranteed>): void;
  // fn_ctxt/_impl.rs:213
  write_splatted_resolution(hir_id: HirId, r: Result<SplattedDef, ErrorGuaranteed>): void;
  // fn_ctxt/_impl.rs:222
  write_method_call_and_enforce_effects(hir_id: HirId, span: Span, method: MethodCallee): void;
  // fn_ctxt/_impl.rs:234
  write_splatted_call(hir_id: HirId, fn_id: SplatLoweringInfo, callee_generic_args: GenericArgs | undefined, first_tupled_arg_index: number, tupled_args_count: number): void;
  // fn_ctxt/_impl.rs:286
  write_args(node_id: HirId, args: GenericArgs): void;
  // fn_ctxt/_impl.rs:302
  write_user_type_annotation_from_args(hir_id: HirId, def_id: DefId, args: GenericArgs, user_self_ty: UserSelfTy | undefined): void;
  // fn_ctxt/_impl.rs:328
  write_user_type_annotation(hir_id: HirId, canonical_user_type_annotation: CanonicalUserType): void;
  // fn_ctxt/_impl.rs:347
  apply_adjustments(expr: hir.Expr, adj: Adjustment[]): void;
  // fn_ctxt/_impl.rs:464
  normalize<T>(span: Span, value: Unnormalized<T>, d_T: TypeFoldable<T>): T;
  // fn_ctxt/_impl.rs:473
  require_type_meets(ty: Ty, span: Span, code: ObligationCauseCode, def_id: DefId): void;
  // fn_ctxt/_impl.rs:483
  require_type_is_sized(ty: Ty, span: Span, code: ObligationCauseCode): void;
  // fn_ctxt/_impl.rs:495
  require_type_is_sized_deferred(ty: Ty, span: Span, code: ObligationCauseCode): void;
  // fn_ctxt/_impl.rs:506
  require_type_has_static_alignment(ty: Ty, span: Span): void;
  // fn_ctxt/_impl.rs:527
  register_bound(ty: Ty, def_id: DefId, cause: ObligationCause): void;
  // fn_ctxt/_impl.rs:544
  lower_ty(hir_ty: hir.Ty): LoweredTy;
  // fn_ctxt/_impl.rs:557
  collect_impl_trait_clauses_from_hir_ty(hir_ty: hir.Ty): Clauses;
  // fn_ctxt/_impl.rs:582
  lower_ty_saving_user_provided_ty(hir_ty: hir.Ty): Ty;
  // fn_ctxt/_impl.rs:606
  lower_const_arg(const_arg: hir.ConstArg, ty: Ty): Const;
  // fn_ctxt/_impl.rs:635
  node_ty(id: HirId): Ty;
  // fn_ctxt/_impl.rs:645
  node_ty_opt(id: HirId): Ty | undefined;
  // fn_ctxt/_impl.rs:654
  register_wf_obligation(term: Term, span: Span, code: ObligationCauseCode): void;
  // fn_ctxt/_impl.rs:671
  add_wf_bounds(args: GenericArgs, span: Span, hir_id: HirId): void;
  // fn_ctxt/_impl.rs:684
  field_ty(span: Span, field: FieldDef, args: GenericArgs): Ty;
  // fn_ctxt/_impl.rs:695
  drain_stalled_coroutine_obligations(): void;
  // fn_ctxt/_impl.rs:731
  report_ambiguity_errors(): void;
  // fn_ctxt/_impl.rs:741
  select_obligations_where_possible(mutate_fulfillment_errors: (_1: FulfillmentError[]) => void): void;
  // fn_ctxt/_impl.rs:757
  make_overloaded_place_return_type(method: MethodCallee): Ty;
  // fn_ctxt/_impl.rs:765
  type_var_is_sized(self_ty: TyVid): boolean;
  // fn_ctxt/_impl.rs:781
  err_args(len: number, guar: ErrorGuaranteed): Ty[];
  // fn_ctxt/_impl.rs:789
  resolve_ty_and_res_fully_qualified_call(qpath: hir.QPath, hir_id: HirId, span: Span): [Res, LoweredTy | undefined, readonly hir.PathSegment[]];
  // fn_ctxt/_impl.rs:867
  get_fn_decl(blk_id: HirId): [LocalDefId, hir.FnDecl] | undefined;
  // fn_ctxt/_impl.rs:931
  note_internal_mutation_in_method(err: Diag, expr: hir.Expr, expected: Ty | undefined, found: Ty): void;
  // fn_ctxt/_impl.rs:1009
  instantiate_value_path(segments: readonly hir.PathSegment[], self_ty: LoweredTy | undefined, res: Res, span: Span, path_span: Span, hir_id: HirId, has_args: boolean): [Ty, Res];
  // fn_ctxt/_impl.rs:1483
  add_required_obligations_for_hir(span: Span, def_id: DefId, args: GenericArgs, hir_id: HirId): void;
  // fn_ctxt/_impl.rs:1496
  add_required_obligations_with_code(span: Span, def_id: DefId, args: GenericArgs, code: (_1: number, _2: Span) => ObligationCauseCode): void;
  // fn_ctxt/_impl.rs:1518
  try_structurally_resolve_const(sp: Span, ct: Const): Const;
  // fn_ctxt/_impl.rs:1557
  structurally_resolve_type(sp: Span, ty: Ty): Ty;
  // fn_ctxt/_impl.rs:1564
  type_must_be_known_at_this_point(sp: Span, ty: Ty): Ty;
  // fn_ctxt/_impl.rs:1581
  structurally_resolve_const(sp: Span, ct: Const): Const;
  // fn_ctxt/_impl.rs:1607
  with_breakable_ctxt<R>(id: HirId, ctxt: BreakableCtxt, f: () => R): [BreakableCtxt, R];
  // fn_ctxt/_impl.rs:1633
  probe_instantiate_query_response(span: Span, original_values: OriginalQueryValues, query_result: Canonical<QueryResponse<Ty>>): InferResult<Ty>;
  // fn_ctxt/_impl.rs:1648
  expr_in_place(expr_id: HirId): boolean;

  // ---- compiler/rustc_hir_typeck/src/fn_ctxt/adjust_fulfillment_errors.rs (lane wave 19) ----
  // fn_ctxt/adjust_fulfillment_errors.rs:39
  adjust_fulfillment_error_for_expr_obligation(error: FulfillmentError): boolean;
  // fn_ctxt/adjust_fulfillment_errors.rs:175
  adjust_binop_index_operand(error: FulfillmentError): boolean;
  // fn_ctxt/adjust_fulfillment_errors.rs:223
  binop_for_operands(lhs_hir_id: HirId, rhs_hir_id: HirId): ast.BinOp | undefined;
  // fn_ctxt/adjust_fulfillment_errors.rs:237
  binop_accepts_types(binop: BinOpKind, lhs_ty: Ty, rhs_ty: Ty): boolean;
  // fn_ctxt/adjust_fulfillment_errors.rs:281
  deref_ty_if_possible(ty: Ty): Ty;
  // fn_ctxt/adjust_fulfillment_errors.rs:288
  point_at_expr_if_possible(error: FulfillmentError, callee_def_id: DefId, expr: hir.Expr, predicate_self_type_to_point_at: GenericArg | undefined, param_to_point_at: GenericArg | undefined, fallback_param_to_point_at: GenericArg | undefined, self_param_to_point_at: GenericArg | undefined): boolean;
  // fn_ctxt/adjust_fulfillment_errors.rs:487
  point_at_path_if_possible(error: FulfillmentError, def_id: DefId, arg: GenericArg, qpath: hir.QPath): boolean;
  // fn_ctxt/adjust_fulfillment_errors.rs:538
  point_at_generic_if_possible(error: FulfillmentError, def_id: DefId, param_to_point_at: GenericArg, segment: hir.PathSegment): boolean;
  // fn_ctxt/adjust_fulfillment_errors.rs:576
  find_ambiguous_parameter_in<T>(item_def_id: DefId, t: T, d_T: TypeVisitable<T>): GenericArg | undefined;
  // fn_ctxt/adjust_fulfillment_errors.rs:601
  closure_span_overlaps_error(error: FulfillmentError, span: Span): boolean;
  // fn_ctxt/adjust_fulfillment_errors.rs:619
  point_at_field_if_possible(def_id: DefId, param_to_point_at: GenericArg, variant_def_id: DefId, expr_fields: readonly hir.ExprField[]): [hir.Expr, Ty] | undefined;
  // fn_ctxt/adjust_fulfillment_errors.rs:665
  blame_specific_arg_if_possible(error: FulfillmentError, def_id: DefId, param_to_point_at: GenericArg, call_hir_id: HirId, callee_span: Span, receiver: hir.Expr | undefined, args: readonly hir.Expr[]): boolean;
  // fn_ctxt/adjust_fulfillment_errors.rs:729
  blame_specific_expr_if_possible(error: FulfillmentError, expr: hir.Expr): void;
  // fn_ctxt/adjust_fulfillment_errors.rs:753
  blame_specific_expr_if_possible_for_obligation_cause_code(obligation_cause_code: ObligationCauseCode, expr: hir.Expr): Result<hir.Expr, hir.Expr>;
  // fn_ctxt/adjust_fulfillment_errors.rs:801
  blame_specific_expr_if_possible_for_derived_predicate_obligation(obligation: ImplDerivedCause, expr: hir.Expr): Result<hir.Expr, hir.Expr>;
  // fn_ctxt/adjust_fulfillment_errors.rs:875
  blame_specific_part_of_expr_corresponding_to_generic_param(param: GenericArg, expr: hir.Expr, in_ty: GenericArg): Result<hir.Expr, hir.Expr>;

  // ---- compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs, lines 1..1668 (lane typeck-checks-a) ----
  // fn_ctxt/checks.rs:72
  check_casts(): void;
  // fn_ctxt/checks.rs:82
  check_asms(): void;
  // fn_ctxt/checks.rs:91
  check_repeat_exprs(): void;
  // fn_ctxt/checks.rs:192
  check_argument_types(call_span: Span, call_expr: hir.Expr, formal_input_tys: readonly Ty[], formal_output: Ty, expectation: Expectation, provided_args: readonly hir.Expr[], c_variadic: boolean, tuple_arguments: TupleArgumentsFlag, fn_id: SplatLoweringInfo, callee_generic_args: GenericArgs | undefined): void;
  // fn_ctxt/checks.rs:593
  check_tupled_arguments(call_span: Span, call_expr: hir.Expr, formal_input_tys: Ty[], provided_args: readonly hir.Expr[], expected_input_tys: Ty[] | undefined, tuple_arguments: TupleArgumentsFlag, fn_id: SplatLoweringInfo, callee_generic_args: GenericArgs | undefined): TupledArgCheckOutcome;
  // fn_ctxt/checks.rs:849
  check_place_expr_if_unsized(ty: Ty, expr: hir.Expr): void;
  // fn_ctxt/checks.rs:859
  report_arg_errors(compatibility_diagonal: Compatibility[], formal_and_expected_inputs: [Ty, Ty][], provided_args: hir.Expr[], c_variadic: boolean, err_code: ErrCode, fn_id: SplatLoweringInfo, call_span: Span, call_expr: hir.Expr, tuple_arguments: TupleArgumentsFlag): ErrorGuaranteed;
  // fn_ctxt/checks.rs:985
  suggest_mut_addr(expected_ty: Ty, provided_ty: Ty, arg: hir.Expr, err: Diag): void;
  // fn_ctxt/checks.rs:1045
  check_expr_lit(lit: hir.Lit, lint_id: HirId, expected: Expectation): Ty;
  // fn_ctxt/checks.rs:1108
  check_struct_path(qpath: hir.QPath, hir_id: HirId): Result<[VariantDef, Ty], ErrorGuaranteed>;
  // fn_ctxt/checks.rs:1171
  check_decl_initializer(hir_id: HirId, pat: hir.Pat, init: hir.Expr): Ty;
  // fn_ctxt/checks.rs:1211
  check_decl(decl: Declaration): Ty;
  // fn_ctxt/checks.rs:1259
  check_decl_local(local: hir.LetStmt): void;
  // fn_ctxt/checks.rs:1272
  check_stmt(stmt: hir.Stmt): void;
  // fn_ctxt/checks.rs:1316
  check_block_no_value(blk: hir.Block): void;
  // fn_ctxt/checks.rs:1327
  check_expr_block(blk: hir.Block, expected: Expectation): Ty;
  // fn_ctxt/checks.rs:1513
  parent_item_span(id: HirId): Span | undefined;
  // fn_ctxt/checks.rs:1535
  get_expr_coercion_span(expr: hir.Expr): Span;
  // fn_ctxt/checks.rs:1564
  overwrite_local_ty_if_err(hir_id: HirId, pat: hir.Pat, ty: Ty): void;
  // fn_ctxt/checks.rs:1593
  finish_resolving_struct_path(qpath: hir.QPath, path_span: Span, hir_id: HirId): [Res, LoweredTy];
  // fn_ctxt/checks.rs:1622
  adjust_fulfillment_errors_for_expr_obligation(errors: FulfillmentError[]): void;

  // ---- compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs, lines 1669..3710 (lane typeck-checks-b) ----
  // fn_ctxt/checks.rs:1670
  label_fn_like(err: Diag, callable_id: SplatLoweringInfo, callee_ty: Ty | undefined, call_expr: hir.Expr, expected_ty: Ty | undefined, expected_idx: number | undefined, matched_inputs: (ProvidedIdx | undefined)[], formal_and_expected_inputs: [Ty, Ty][], is_method: boolean, tuple_arguments: TupleArgumentsFlag): void;
  // fn_ctxt/checks.rs:2022
  label_generic_mismatches(err: Diag, callable_id: SplatLoweringInfo, matched_inputs: (ProvidedIdx | undefined)[], provided_arg_tys: [Ty, Span][], formal_and_expected_inputs: [Ty, Ty][], is_method: boolean, is_splat: boolean): void;
  // fn_ctxt/checks.rs:2102
  get_hir_param_info(def_id: DefId, is_method: boolean): [([GenericIdx | undefined, FnParam])[], hir.Generics] | undefined;

  // ---- compiler/rustc_hir_typeck/src/fn_ctxt/inspect_obligations.rs (lane typeck-checks-a) ----
  // fn_ctxt/inspect_obligations.rs:35
  obligations_for_self_ty(self_ty: TyVid, subtyping: UseSubtyping): PredicateObligations;
  // fn_ctxt/inspect_obligations.rs:53
  predicate_has_self_ty(predicate: Predicate, expected_vid: TyVid, subtyping: UseSubtyping): boolean;
  // fn_ctxt/inspect_obligations.rs:87
  type_matches_expected_vid(ty: Ty, expected_vid: TyVid, subtyping: UseSubtyping): boolean;
  // fn_ctxt/inspect_obligations.rs:108
  obligations_for_self_ty_next(self_ty: TyVid, subtyping: UseSubtyping): PredicateObligations;
  // fn_ctxt/inspect_obligations.rs:150
  from_float_for_f32_root_vids(): Set<FloatVid>;
  // fn_ctxt/inspect_obligations.rs:168
  predicate_from_float_for_f32_root_vid(from_trait: DefId, predicate: Predicate): FloatVid | undefined;
  // fn_ctxt/inspect_obligations.rs:190
  from_float_for_f32_root_vids_next(): Set<FloatVid>;

  // ---- compiler/rustc_hir_typeck/src/fn_ctxt/mod.rs (lane fnctxt-contract) ----
  // fn_ctxt/mod.rs:161
  typing_mode(): TypingMode<CantBeErased>;
  // fn_ctxt/mod.rs:167
  dcx(): DiagCtxtHandle;
  // fn_ctxt/mod.rs:171
  cause(span: Span, code: ObligationCauseCode): ObligationCause;
  // fn_ctxt/mod.rs:179
  misc(span: Span): ObligationCause;
  // fn_ctxt/mod.rs:183
  sess(): Session;
  // fn_ctxt/mod.rs:192
  err_ctxt(): TypeErrCtxt;
  // fn_ctxt/mod.rs:215
  deref(): TypeckRootCtxt;

  // ---- compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs (lane wave 19) ----
  // fn_ctxt/suggestions.rs:43
  fn_sig(): FnSig | undefined;
  // fn_ctxt/suggestions.rs:51
  suggest_semicolon_at_end(span: Span, err: Diag): void;
  // fn_ctxt/suggestions.rs:67
  suggest_mismatched_types_on_tail(err: Diag, expr: hir.Expr, expected: Ty, found: Ty, blk_id: HirId): boolean;
  // fn_ctxt/suggestions.rs:98
  suggest_fn_call(err: Diag, expr: hir.Expr, found: Ty, can_satisfy: (_1: Ty) => boolean): boolean;
  // fn_ctxt/suggestions.rs:169
  extract_callable_info(ty: Ty): [DefIdOrName, Ty, Ty[]] | undefined;
  // fn_ctxt/suggestions.rs:176
  suggest_two_fn_call(err: Diag, lhs_expr: hir.Expr, lhs_ty: Ty, rhs_expr: hir.Expr, rhs_ty: Ty, can_satisfy: (_1: Ty, _2: Ty) => boolean): boolean;
  // fn_ctxt/suggestions.rs:257
  suggest_collect(err: Diag, expr: hir.Expr, expected_type: Ty, found_type: Ty): boolean;
  // fn_ctxt/suggestions.rs:321
  suggest_remove_last_method_call(err: Diag, expr: hir.Expr, expected: Ty): boolean;
  // fn_ctxt/suggestions.rs:350
  suggest_deref_ref_or_into(err: Diag, expr: hir.Expr, expected: Ty, found: Ty, expected_ty_expr: hir.Expr | undefined): boolean;
  // fn_ctxt/suggestions.rs:592
  deconstruct_option_or_result(found_ty: Ty, expected_ty: Ty): [Ty, Ty, [Ty, Ty] | undefined] | undefined;
  // fn_ctxt/suggestions.rs:622
  suggest_boxing_when_appropriate(err: Diag, span: Span, hir_id: HirId, expected: Ty, found: Ty): boolean;
  // fn_ctxt/suggestions.rs:674
  suggest_closure_to_fn_ptr_coercion(err: Diag, expr: hir.Expr, expected: Ty, found: Ty): boolean;
  // fn_ctxt/suggestions.rs:717
  suggest_impl_fn_for_fn_ptr_ret(err: Diag, expr: hir.Expr): void;
  // fn_ctxt/suggestions.rs:745
  suggest_calling_boxed_future_when_appropriate(err: Diag, expr: hir.Expr, expected: Ty, found: Ty): boolean;
  // fn_ctxt/suggestions.rs:857
  suggest_missing_semicolon(err: Diag, expression: hir.Expr, expected: Ty, needs_block: boolean, parent_is_closure: boolean): void;
  // fn_ctxt/suggestions.rs:943
  is_next_stmt_expr_continuation(hir_id: HirId): boolean;
  // fn_ctxt/suggestions.rs:979
  suggest_missing_return_type(err: Diag, fn_decl: hir.FnDecl, expected: Ty, found: Ty, fn_id: LocalDefId): boolean;
  // fn_ctxt/suggestions.rs:1147
  can_add_return_type(fn_id: LocalDefId): boolean;
  // fn_ctxt/suggestions.rs:1172
  try_note_caller_chooses_ty_for_ty_param(diag: Diag, expected: Ty, found: Ty): void;
  // fn_ctxt/suggestions.rs:1206
  try_suggest_return_impl_trait(err: Diag, expected: Ty, found: Ty, fn_id: LocalDefId): void;
  // fn_ctxt/suggestions.rs:1312
  suggest_missing_break_or_return_expr(err: Diag, expr: hir.Expr, fn_decl: hir.FnDecl, expected: Ty, found: Ty, id: HirId, fn_id: LocalDefId): void;
  // fn_ctxt/suggestions.rs:1464
  suggest_missing_parentheses(err: Diag, expr: hir.Expr): boolean;
  // fn_ctxt/suggestions.rs:1484
  suggest_block_to_brackets_peeling_refs(diag: Diag, expr: hir.Expr, expr_ty: Ty, expected_ty: Ty): boolean;
  // fn_ctxt/suggestions.rs:1511
  suggest_clone_for_ref(diag: Diag, expr: hir.Expr, expr_ty: Ty, expected_ty: Ty): boolean;
  // fn_ctxt/suggestions.rs:1548
  suggest_copied_cloned_or_as_ref(diag: Diag, expr: hir.Expr, expr_ty: Ty, expected_ty: Ty): boolean;
  // fn_ctxt/suggestions.rs:1591
  suggest_into(diag: Diag, expr: hir.Expr, expr_ty: Ty, expected_ty: Ty): boolean;
  // fn_ctxt/suggestions.rs:1656
  suggest_option_to_bool(diag: Diag, expr: hir.Expr, expr_ty: Ty, expected_ty: Ty): boolean;
  // fn_ctxt/suggestions.rs:1718
  suggest_deref_unwrap_or(err: Diag, callee_ty: Ty | undefined, call_ident: Ident | undefined, expected_ty: Ty, provided_ty: Ty, provided_expr: hir.Expr, is_method: boolean): void;
  // fn_ctxt/suggestions.rs:1788
  suggest_block_to_brackets(diag: Diag, blk: hir.Block, blk_ty: Ty, expected_ty: Ty): void;
  // fn_ctxt/suggestions.rs:1827
  suggest_floating_point_literal(err: Diag, expr: hir.Expr, expected_ty: Ty): boolean;
  // fn_ctxt/suggestions.rs:1909
  suggest_null_ptr_for_literal_zero_given_to_ptr_arg(err: Diag, expr: hir.Expr, expected_ty: Ty): boolean;
  // fn_ctxt/suggestions.rs:1947
  suggest_associated_const(err: Diag, expr: hir.Expr, expected_ty: Ty): boolean;
  // fn_ctxt/suggestions.rs:2027
  is_loop(id: HirId): boolean;
  // fn_ctxt/suggestions.rs:2032
  is_local_statement(id: HirId): boolean;
  // fn_ctxt/suggestions.rs:2039
  note_type_is_not_clone(diag: Diag, expected_ty: Ty, found_ty: Ty, expr: hir.Expr): void;
  // fn_ctxt/suggestions.rs:2222
  note_type_is_not_clone_inner_expr(expr: hir.Expr): hir.Expr;
  // fn_ctxt/suggestions.rs:2297
  is_field_suggestable(field: FieldDef, span: Span): boolean;
  // fn_ctxt/suggestions.rs:2311
  suggest_missing_unwrap_expect(err: Diag, expr: hir.Expr, expected: Ty, found: Ty): boolean;
  // fn_ctxt/suggestions.rs:2413
  suggest_coercing_result_via_try_operator(err: Diag, expr: hir.Expr, expected: Ty, found: Ty): boolean;
  // fn_ctxt/suggestions.rs:2459
  suggest_returning_value_after_loop(err: Diag, expr: hir.Expr, expected: Ty): boolean;
  // fn_ctxt/suggestions.rs:2543
  suggest_semicolon_in_repeat_expr(err: Diag, expr: hir.Expr, expr_ty: Ty): boolean;
  // fn_ctxt/suggestions.rs:2624
  suggest_compatible_variants(err: Diag, expr: hir.Expr, expected: Ty, expr_ty: Ty): boolean;
  // fn_ctxt/suggestions.rs:2824
  suggest_non_zero_new_unwrap(err: Diag, expr: hir.Expr, expected: Ty, expr_ty: Ty): boolean;
  // fn_ctxt/suggestions.rs:2883
  can_use_as_ref_or_mut(expr: hir.Expr, mutability: Mutability): [[Span, string][], string] | undefined;
  // fn_ctxt/suggestions.rs:2969
  suggest_deref_or_ref(expr: hir.Expr, checked_ty: Ty, expected: Ty): [[Span, string][], string, Applicability, boolean] | undefined;
  // fn_ctxt/suggestions.rs:3413
  is_else_if_block(expr: hir.Expr): boolean;
  // fn_ctxt/suggestions.rs:3423
  suggest_cast(err: Diag, expr: hir.Expr, checked_ty: Ty, expected_ty: Ty, expected_ty_expr: hir.Expr | undefined): boolean;
  // fn_ctxt/suggestions.rs:3788
  suggest_method_call_on_range_literal(err: Diag, expr: hir.Expr, checked_ty: Ty, expected_ty: Ty): void;
  // fn_ctxt/suggestions.rs:3867
  suggest_return_binding_for_missing_tail_expr(err: Diag, expr: hir.Expr, checked_ty: Ty, expected_ty: Ty): void;
  // fn_ctxt/suggestions.rs:3925
  suggest_swapping_lhs_and_rhs(err: Diag, rhs_ty: Ty, lhs_ty: Ty, rhs_expr: hir.Expr, lhs_expr: hir.Expr): void;

  // ---- compiler/rustc_hir_typeck/src/lib.rs (lane fnctxt-contract) ----
  // lib.rs:479
  report_unexpected_variant_res(res: Res, expr: hir.Expr | undefined, sub_pats: readonly hir.Pat[], qpath: hir.QPath, span: Span, err_code: ErrCode, expected: string): ErrorGuaranteed;

  // ---- compiler/rustc_hir_typeck/src/method/confirm.rs (lane typeck-method) ----
  // method/confirm.rs:59
  confirm_method(span: Span, self_expr: hir.Expr, call_expr: hir.Expr, unadjusted_self_ty: Ty, pick: Pick, segment: hir.PathSegment): ConfirmResult;
  // method/confirm.rs:77
  confirm_method_for_diagnostic(span: Span, self_expr: hir.Expr, call_expr: hir.Expr, unadjusted_self_ty: Ty, pick: Pick, segment: hir.PathSegment): ConfirmResult;

  // ---- compiler/rustc_hir_typeck/src/method/mod.rs (lane typeck-method) ----
  // method/mod.rs:91
  method_exists_for_diagnostic(method_name: Ident, self_ty: Ty, call_expr_id: HirId, return_type: Ty | undefined): boolean;
  // method/mod.rs:126
  suggest_method_call(err: Diag, msg: DiagMessage, method_name: Ident, self_ty: Ty, call_expr: hir.Expr, span: Span | undefined): void;
  // method/mod.rs:175
  lookup_method(self_ty: Ty, segment: hir.PathSegment, span: Span, call_expr: hir.Expr, self_expr: hir.Expr, args: readonly hir.Expr[]): Result<MethodCallee, MethodError>;
  // method/mod.rs:258
  lookup_method_for_diagnostic(self_ty: Ty, segment: hir.PathSegment, span: Span, call_expr: hir.Expr, self_expr: hir.Expr): Result<MethodCallee, MethodError>;
  // method/mod.rs:280
  lookup_probe(method_name: Ident, self_ty: Ty, call_expr: hir.Expr, scope: ProbeScope): PickResult;
  // method/mod.rs:300
  lookup_probe_for_diagnostic(method_name: Ident, self_ty: Ty, call_expr: hir.Expr, scope: ProbeScope, return_type: Ty | undefined): PickResult;
  // method/mod.rs:345
  lookup_method_for_operator(cause: ObligationCause, method_name: Symbol, trait_def_id: DefId, self_ty: Ty, opt_rhs_ty: Ty | undefined, treat_opaques: TreatNotYetDefinedOpaques): InferOk<MethodCallee> | undefined;
  // method/mod.rs:497
  resolve_fully_qualified_call(span: Span, method_name: Ident, self_ty: Ty, self_ty_span: Span, expr_id: HirId): Result<[DefKind, DefId], MethodError>;
  // method/mod.rs:573
  associated_value(def_id: DefId, item_ident: Ident): AssocItem | undefined;

  // ---- compiler/rustc_hir_typeck/src/method/prelude_edition_lints.rs (lane typeck-method (lint fns :156, :273) / wave 19 (rest)) ----
  // method/prelude_edition_lints.rs:156
  lint_edition_dependent_dot_call(self_ty: Ty, segment: hir.PathSegment, span: Span, call_expr: hir.Expr, self_expr: hir.Expr, pick: Pick, args: readonly hir.Expr[]): void;
  // method/prelude_edition_lints.rs:273
  lint_fully_qualified_call_from_2018(span: Span, method_name: Ident, self_ty: Ty, self_ty_span: Span, expr_id: HirId, pick: Pick): void;
  // method/prelude_edition_lints.rs:416
  trait_path_or_bare_name(span: Span, expr_hir_id: HirId, trait_def_id: DefId): string;
  // method/prelude_edition_lints.rs:428
  trait_path(span: Span, expr_hir_id: HirId, trait_def_id: DefId): string | undefined;
  // method/prelude_edition_lints.rs:470
  adjust_expr(pick: Pick, expr: hir.Expr, outer: Span): [string, boolean];

  // ---- compiler/rustc_hir_typeck/src/method/probe.rs (lane typeck-probe) ----
  // method/probe.rs:293
  probe_for_return_type_for_diagnostic(span: Span, mode: Mode, return_type: Ty, self_ty: Ty, scope_expr_id: HirId, candidate_filter: (_1: AssocItem) => boolean): AssocItem[];
  // method/probe.rs:336
  probe_for_name(mode: Mode, item_name: Ident, return_type: Ty | undefined, is_suggestion: IsSuggestion, self_ty: Ty, scope_expr_id: HirId, scope: ProbeScope): PickResult;
  // method/probe.rs:360
  probe_for_name_many(mode: Mode, item_name: Ident, return_type: Ty | undefined, is_suggestion: IsSuggestion, self_ty: Ty, scope_expr_id: HirId, scope: ProbeScope): Result<Candidate[], MethodError>;
  // method/probe.rs:389
  probe_op<R>(span: Span, mode: Mode, method_name: Ident | undefined, return_type: Ty | undefined, is_suggestion: IsSuggestion, self_ty: Ty, scope_expr_id: HirId, scope: ProbeScope, op: (_1: ProbeContext) => Result<R, MethodError>): Result<R, MethodError>;

  // ---- compiler/rustc_hir_typeck/src/method/suggest.rs (lane wave 19) ----
  // method/suggest.rs:99
  is_slice_ty(ty: Ty, span: Span): boolean;
  // method/suggest.rs:105
  impl_into_iterator_should_be_iterator(ty: Ty, span: Span, unsatisfied_predicates: UnsatisfiedPredicates): boolean;
  // method/suggest.rs:193
  preferred_iterator_method(source: SelfSource, rcvr_ty: Ty): Symbol | undefined;
  // method/suggest.rs:256
  report_method_error(call_id: HirId, rcvr_ty: Ty, error: MethodError, expected: Expectation, trait_missing_method: boolean): ErrorGuaranteed;
  // method/suggest.rs:481
  create_missing_writer_err(rcvr_ty: Ty, rcvr_expr: hir.Expr, long_ty_path: PathBuf | undefined): Diag;
  // method/suggest.rs:508
  create_no_assoc_err(rcvr_ty: Ty, item_ident: Ident, item_kind: string, trait_missing_method: boolean, source: SelfSource, is_method: boolean, sugg_span: Span, unsatisfied_predicates: UnsatisfiedPredicates): Diag;
  // method/suggest.rs:590
  suggest_use_shadowed_binding_with_method(self_source: SelfSource, method_name: Ident, ty: Ty, err: Diag): void;
  // method/suggest.rs:775
  suggest_method_call_annotation(err: Diag, span: Span, rcvr_ty: Ty, item_ident: Ident, mode: Mode, source: SelfSource, expected: Expectation): void;
  // method/suggest.rs:821
  suggest_static_method_candidates(err: Diag, span: Span, rcvr_ty: Ty, item_ident: Ident, source: SelfSource, args: readonly hir.Expr[] | undefined, sugg_span: Span, no_match_data: NoMatchData): CandidateSource[];
  // method/suggest.rs:881
  suggest_unsatisfied_ty_or_trait(err: Diag, span: Span, rcvr_ty: Ty, item_ident: Ident, item_kind: string, source: SelfSource, unsatisfied_predicates: UnsatisfiedPredicates, static_candidates: readonly CandidateSource[]): Result<[boolean, boolean, boolean, boolean, SortedMap<OrdSpan, string[]>], null>;
  // method/suggest.rs:1021
  suggest_surround_method_call(err: Diag, span: Span, rcvr_ty: Ty, item_ident: Ident, source: SelfSource, similar_candidate: AssocItem | undefined): boolean;
  // method/suggest.rs:1041
  find_possible_candidates_for_method(err: Diag, span: Span, rcvr_ty: Ty, item_ident: Ident, item_kind: string, mode: Mode, source: SelfSource, no_match_data: NoMatchData, expected: Expectation, should_label_not_found: boolean, custom_span_label: boolean): void;
  // method/suggest.rs:1095
  suggest_confusable_or_similarly_named_method(err: Diag, span: Span, rcvr_ty: Ty, item_ident: Ident, mode: Mode, args: readonly hir.Expr[] | undefined, unsatisfied_predicates: UnsatisfiedPredicates, similar_candidate: AssocItem | undefined): void;
  // method/suggest.rs:1132
  suggest_method_not_found_because_of_unsatisfied_bounds(err: Diag, rcvr_ty: Ty, item_ident: Ident, item_kind: string, bound_spans: SortedMap<OrdSpan, string[]>, unsatisfied_predicates: UnsatisfiedPredicates): void;
  // method/suggest.rs:1233
  report_no_match_method_error(span: Span, rcvr_ty: Ty, item_ident: Ident, expr_id: HirId, source: SelfSource, args: readonly hir.Expr[] | undefined, sugg_span: Span, no_match_data: NoMatchData, expected: Expectation, trait_missing_method: boolean, within_macro_span: Span | undefined): ErrorGuaranteed;
  // method/suggest.rs:1443
  set_not_found_span_label(err: Diag, rcvr_ty: Ty, item_ident: Ident, item_kind: string, mode: Mode, source: SelfSource, span: Span, unsatisfied_predicates: UnsatisfiedPredicates, find_candidate_for_method: MutRef<boolean>): void;
  // method/suggest.rs:1568
  suggest_enum_variant_for_method_call(err: Diag, rcvr_ty: Ty, item_ident: Ident, span: Span, source: SelfSource, unsatisfied_predicates: UnsatisfiedPredicates): void;
  // method/suggest.rs:1705
  handle_unsatisfied_predicates(err: Diag, rcvr_ty: Ty, item_ident: Ident, item_kind: string, span: Span, unsatisfied_predicates: UnsatisfiedPredicates, restrict_type_params: MutRef<boolean>, suggested_derive: MutRef<boolean>, unsatisfied_bounds: MutRef<boolean>, custom_span_label: MutRef<boolean>, bound_spans: SortedMap<OrdSpan, string[]>): void;
  // method/suggest.rs:2227
  lookup_segments_chain_for_no_match_method(err: Diag, item_name: Ident, item_kind: string, source: SelfSource, no_match_data: NoMatchData): void;
  // method/suggest.rs:2288
  find_likely_intended_associated_item(err: Diag, similar_candidate: AssocItem, span: Span, args: readonly hir.Expr[] | undefined, mode: Mode): void;
  // method/suggest.rs:2372
  confusable_method_name(err: Diag, rcvr_ty: Ty, item_name: Ident, call_args: Ty[] | undefined): Symbol | undefined;
  // method/suggest.rs:2434
  note_candidates_on_method_error(rcvr_ty: Ty, item_name: Ident, self_source: SelfSource, args: readonly hir.Expr[] | undefined, span: Span, err: Diag, sources: CandidateSource[], sugg_span: Span | undefined): void;
  // method/suggest.rs:2592
  find_builder_fn(err: Diag, rcvr_ty: Ty, expr_id: HirId): void;
  // method/suggest.rs:2690
  suggest_associated_call_syntax(err: Diag, static_candidates: readonly CandidateSource[], rcvr_ty: Ty, source: SelfSource, item_name: Ident, args: readonly hir.Expr[] | undefined, sugg_span: Span): void;
  // method/suggest.rs:2816
  suggest_calling_field_as_fn(span: Span, rcvr_ty: Ty, expr: hir.Expr, item_name: Ident, err: Diag): boolean;
  // method/suggest.rs:2881
  report_failed_method_call_on_range_end(tcx: TyCtxt, actual: Ty, source: SelfSource, span: Span, item_name: Ident): Result<undefined, ErrorGuaranteed>;
  // method/suggest.rs:2974
  report_failed_method_call_on_numerical_infer_var(tcx: TyCtxt, actual: Ty, source: SelfSource, span: Span, item_kind: string, item_name: Ident, long_ty_path: MutRef<PathBuf | undefined>): Result<undefined, ErrorGuaranteed>;
  // method/suggest.rs:3133
  suggest_assoc_method_call(segs: readonly hir.PathSegment[]): void;
  // method/suggest.rs:3190
  suggest_calling_method_on_field(err: Diag, source: SelfSource, span: Span, actual: Ty, item_name: Ident, return_type: Ty | undefined): void;
  // method/suggest.rs:3264
  suggest_unwrapping_inner_self(err: Diag, source: SelfSource, actual: Ty, item_name: Ident): void;
  // method/suggest.rs:3455
  note_unmet_impls_on_type(err: Diag, errors: readonly FulfillmentError[], suggest_derive: boolean): void;
  // method/suggest.rs:3570
  consider_suggesting_derives_for_ty(trait_pred: TraitClause, adt: AdtDef): [string, OrdSpan, Symbol][] | undefined;
  // method/suggest.rs:3626
  note_predicate_source_and_get_derives(err: Diag, unsatisfied_predicates: UnsatisfiedPredicates): [string, OrdSpan, Symbol][];
  // method/suggest.rs:3677
  suggest_derive(err: Diag, unsatisfied_predicates: UnsatisfiedPredicates): boolean;
  // method/suggest.rs:3708
  note_derefed_ty_has_method(err: Diag, self_source: SelfSource, rcvr_ty: Ty, item_name: Ident, expected: Expectation): void;
  // method/suggest.rs:3785
  suggest_bounds_for_range_to_method(err: Diag, source: SelfSource, item_ident: Ident): void;
  // method/suggest.rs:3851
  ty_to_value_string(ty: Ty): string;
  // method/suggest.rs:3858
  suggest_await_before_method(err: Diag, item_name: Ident, ty: Ty, call: hir.Expr, span: Span, return_type: Ty | undefined): void;
  // method/suggest.rs:3882
  set_label_for_method_error(err: Diag, source: SelfSource, rcvr_ty: Ty, item_ident: Ident, expr_id: HirId, span: Span, sugg_span: Span, within_macro_span: Span | undefined, args: readonly hir.Expr[] | undefined): void;
  // method/suggest.rs:3930
  suggest_on_pointer_type(err: Diag, source: SelfSource, rcvr_ty: Ty, item_ident: Ident): void;
  // method/suggest.rs:3978
  suggest_use_candidates(candidates: DefId[], handle_candidates: (_1: string[], _2: string[], _3: Span) => void): void;
  // method/suggest.rs:4050
  suggest_valid_traits(err: Diag, item_name: Ident, valid_out_of_scope_traits: DefId[], explain: boolean): boolean;
  // method/suggest.rs:4132
  suggest_traits_to_import(err: Diag, span: Span, rcvr_ty: Ty, item_name: Ident, inputs_len: number | undefined, source: SelfSource, valid_out_of_scope_traits: DefId[], static_candidates: readonly CandidateSource[], unsatisfied_bounds: boolean, return_type: Ty | undefined, trait_missing_method: boolean): void;
  // method/suggest.rs:4799
  detect_and_explain_multiple_crate_versions_of_trait_item(err: Diag, item_def_id: DefId, hir_id: HirId, rcvr_ty: Ty | undefined): boolean;
  // method/suggest.rs:4846
  suggest_else_fn_with_closure(err: Diag, expr: hir.Expr, found: Ty, expected: Ty): boolean;
  // method/suggest.rs:4902
  type_derefs_to_local(span: Span, rcvr_ty: Ty, source: SelfSource): boolean;
  // method/suggest.rs:4932
  suggest_hashmap_on_unsatisfied_hashset_buildhasher(err: Diag, pred: TraitClause, adt: AdtDef): boolean;

  // ---- compiler/rustc_hir_typeck/src/op.rs (lane typeck-expr-a) ----
  // op.rs:29
  check_expr_assign_op(expr: hir.Expr, op: ast.AssignOp, lhs: hir.Expr, rhs: hir.Expr, expected: Expectation): Ty;
  // op.rs:88
  check_expr_binop(expr: hir.Expr, op: ast.BinOp, lhs_expr: hir.Expr, rhs_expr: hir.Expr, expected: Expectation): Ty;
  // op.rs:155
  enforce_builtin_binop_types(lhs_span: Span, lhs_ty: Ty, rhs_span: Span, rhs_ty: Ty, category: BinOpCategory): Ty;
  // op.rs:194
  check_overloaded_binop(expr: hir.Expr, lhs_expr: hir.Expr, rhs_expr: hir.Expr, op: Op, expected: Expectation): [Ty, Ty, Ty];
  // op.rs:267
  overloaded_binop_ret_ty(expr: hir.Expr, lhs_expr: hir.Expr, rhs_expr: hir.Expr, op: Op, expected: Expectation, lhs_ty: Ty, result: Result<MethodCallee, FulfillmentError[]>, rhs_ty: Ty): Ty;
  // op.rs:329
  report_binop_fulfillment_errors(expr: hir.Expr, lhs_expr: hir.Expr, rhs_expr: hir.Expr, op: Op, expected: Expectation, lhs_ty: Ty, rhs_ty: Ty, errors: FulfillmentError[]): Ty;
  // op.rs:563
  suggest_deref_or_call_for_binop_error(lhs_expr: hir.Expr, rhs_expr: hir.Expr, op: Op, expected: Expectation, lhs_ty: Ty, rhs_ty: Ty, err: Diag, is_compatible_after_call: (_1: Ty, _2: Ty) => boolean): void;
  // op.rs:661
  suggest_raw_ptr_binop_arithmetic(lhs_expr: hir.Expr, rhs_expr: hir.Expr, op: Op, lhs_ty: Ty, rhs_ty: Ty, err: Diag): void;
  // op.rs:715
  suggest_raw_ptr_assign_arithmetic(lhs_expr: hir.Expr, rhs_expr: hir.Expr, op: Op, lhs_ty: Ty, rhs_ty: Ty, lhs_name_str: string, err: Diag): void;
  // op.rs:754
  suggest_different_borrow(lhs_expr: hir.Expr, rhs_expr: hir.Expr, op: Op, expected: Expectation, err: Diag, lhs_adjusted_ty: Ty, lhs_new_mutbl: Mutability | undefined, rhs_adjusted_ty: Ty, rhs_new_mutbl: Mutability | undefined): void;
  // op.rs:818
  is_lhs_of_assign_stmt(expr: hir.Expr): boolean;
  // op.rs:826
  suggest_deref_binop(lhs_expr: hir.Expr, rhs_expr: hir.Expr, op: Op, expected: Expectation, rhs_ty: Ty, err: Diag, lhs_deref_ty: Ty): void;
  // op.rs:865
  check_str_addition(lhs_expr: hir.Expr, rhs_expr: hir.Expr, lhs_ty: Ty, rhs_ty: Ty, err: Diag, op: Op): boolean;
  // op.rs:961
  check_user_unop(ex: hir.Expr, operand_ty: Ty, op: ast.UnOp, expected: Expectation): Ty;
  // op.rs:1075
  lookup_op_method(_0: [hir.Expr, Ty], opt_rhs: [hir.Expr, Ty] | undefined, _2: [Symbol, DefId | undefined], span: Span, expected: Expectation): Result<MethodCallee, FulfillmentError[]>;

  // ---- compiler/rustc_hir_typeck/src/opaque_types.rs (lane typeck-lib-wb) ----
  // opaque_types.rs:29
  try_handle_opaque_type_uses_next(): void;
  // opaque_types.rs:46
  handle_opaque_type_uses_next(): void;
  // opaque_types.rs:90
  compute_definition_site_hidden_types(opaque_types: [OpaqueTypeKey, ProvisionalHiddenType][], error_on_missing_defining_use: boolean): void;
  // opaque_types.rs:219
  consider_opaque_type_use(opaque_type_key: OpaqueTypeKey, hidden_type: ProvisionalHiddenType): UsageKind;
  // opaque_types.rs:277
  detect_opaque_types_added_during_writeback(): void;

  // ---- compiler/rustc_hir_typeck/src/pat.rs, lines 1..1779 (lane typeck-pat-a) ----
  // pat.rs:104
  pattern_cause(ti: TopInfo, cause_span: Span): ObligationCause;
  // pat.rs:135
  demand_eqtype_pat_diag(cause_span: Span, expected: Ty, actual: Ty, ti: TopInfo): Result<undefined, Diag>;
  // pat.rs:153
  demand_eqtype_pat(cause_span: Span, expected: Ty, actual: Ty, ti: TopInfo): Result<undefined, ErrorGuaranteed>;
  // pat.rs:334
  downgrade_mut_inside_shared(): boolean;
  // pat.rs:342
  ref_pat_matches_inherited_ref(edition: Edition): InheritedRefMatchRule;
  // pat.rs:365
  ref_pat_matches_mut_ref(): boolean;
  // pat.rs:380
  check_pat_top(pat: hir.Pat, expected: Ty, span: Span | undefined, origin_expr: hir.Expr | undefined, decl_origin: DeclOrigin | undefined): void;
  // pat.rs:406
  check_pat(pat: hir.Pat, expected: Ty, pat_info: PatInfo): void;
  // pat.rs:480
  check_pat_inner(pat: hir.Pat, opt_path_res: Result<ResolvedPat, ErrorGuaranteed> | undefined, adjust_mode: AdjustMode, expected: Ty, pat_info: PatInfo): Ty;
  // pat.rs:666
  adjust_pat_info(inner_pinnedness: Pinnedness, inner_mutability: Mutability, pat_info: PatInfo): PatInfo;
  // pat.rs:713
  check_deref_pattern(pat: hir.Pat, opt_path_res: Result<ResolvedPat, ErrorGuaranteed> | undefined, adjust_mode: AdjustMode, expected: Ty, inner_ty: Ty, pat_adjust_kind: PatAdjust, pat_info: PatInfo): Ty;
  // pat.rs:754
  calc_adjust_mode(pat: hir.Pat, opt_path_res: Result<ResolvedPat, ErrorGuaranteed> | undefined): AdjustMode;
  // pat.rs:839
  should_peel_ref(peel_kind: PeelKind, expected: Ty): boolean;
  // pat.rs:875
  should_peel_smart_pointer(peel_kind: PeelKind, expected: Ty): boolean;
  // pat.rs:899
  check_pat_expr_unadjusted(lt: hir.PatExpr): Ty;
  // pat.rs:925
  check_pat_lit(span: Span, expr: hir.PatExpr, lit_kind: LitKind, expected: Ty, ti: TopInfo): Ty;
  // pat.rs:1019
  check_pat_range(span: Span, lhs: hir.PatExpr | undefined, rhs: hir.PatExpr | undefined, expected: Ty, ti: TopInfo): Ty;
  // pat.rs:1092
  endpoint_has_type(err: Diag, span: Span, ty: Ty): void;
  // pat.rs:1098
  emit_err_pat_range(span: Span, lhs: [boolean, Ty, Span] | undefined, rhs: [boolean, Ty, Span] | undefined, endpoints: (hir.PatExpr | undefined)[]): ErrorGuaranteed;
  // pat.rs:1168
  check_pat_ident(pat: hir.Pat, user_bind_annot: BindingMode, var_id: HirId, ident: Ident, sub: hir.Pat | undefined, expected: Ty, pat_info: PatInfo): Ty;
  // pat.rs:1306
  check_binding_alt_eq_ty(ba: BindingMode, span: Span, var_id: HirId, ty: Ty, ti: TopInfo): void;
  // pat.rs:1341
  suggest_adding_missing_ref_or_removing_ref(err: Diag, span: Span, expected: Ty, actual: Ty, ba: BindingMode): void;
  // pat.rs:1375
  borrow_pat_suggestion(err: Diag, pat: hir.Pat): void;
  // pat.rs:1491
  check_dereferenceable(span: Span, expected: Ty, inner: hir.Pat): Result<undefined, ErrorGuaranteed>;
  // pat.rs:1520
  resolve_pat_struct(pat: hir.Pat, qpath: hir.QPath): Result<ResolvedPat, ErrorGuaranteed>;
  // pat.rs:1540
  check_pin_projection(pat: hir.Pat, pat_ty: Ty, pat_info: PatInfo): void;
  // pat.rs:1563
  check_pat_struct(pat: hir.Pat, fields: readonly hir.PatField[], has_rest_pat: boolean, pat_ty: Ty, variant: VariantDef, expected: Ty, pat_info: PatInfo): Ty;
  // pat.rs:1588
  resolve_pat_path(path_id: HirId, span: Span, qpath: hir.QPath): Result<ResolvedPat, ErrorGuaranteed>;
  // pat.rs:1653
  check_pat_path(pat_id_for_diag: HirId, span: Span, resolved: ResolvedPat, expected: Ty, ti: TopInfo): Ty;
  // pat.rs:1669
  maybe_suggest_range_literal(e: Diag, opt_def_id: DefId | undefined, ident: Ident): boolean;
  // pat.rs:1697
  emit_bad_pat_path(e: Diag, hir_id: HirId, pat_span: Span, resolved_pat: ResolvedPat): void;

  // ---- compiler/rustc_hir_typeck/src/pat.rs, lines 1780..3388 (lane typeck-pat-b) ----
  // pat.rs:1781
  resolve_pat_tuple_struct(pat: hir.Pat, qpath: hir.QPath): Result<ResolvedPat, ErrorGuaranteed>;
  // pat.rs:1833
  check_pat_tuple_struct(pat: hir.Pat, qpath: hir.QPath, subpats: readonly hir.Pat[], ddpos: hir.DotDotPos, res: Res, pat_ty: Ty, variant: VariantDef, expected: Ty, pat_info: PatInfo): Ty;
  // pat.rs:1896
  emit_err_pat_wrong_number_of_fields(pat_span: Span, res: Res, qpath: hir.QPath, subpats: readonly hir.Pat[], fields: readonly FieldDef[], expected: Ty, had_err: Result<undefined, ErrorGuaranteed>): ErrorGuaranteed;
  // pat.rs:2053
  check_pat_tuple(span: Span, elements: readonly hir.Pat[], ddpos: hir.DotDotPos, expected: Ty, pat_info: PatInfo): Ty;
  // pat.rs:2089
  check_struct_pat_fields(adt_ty: Ty, pat: hir.Pat, variant: VariantDef, fields: readonly hir.PatField[], has_rest_pat: boolean, pat_info: PatInfo): Result<undefined, ErrorGuaranteed>;
  // pat.rs:2239
  error_tuple_variant_index_shorthand(variant: VariantDef, pat: hir.Pat, fields: readonly hir.PatField[]): Result<undefined, ErrorGuaranteed>;
  // pat.rs:2272
  error_foreign_non_exhaustive_spat(pat: hir.Pat, descr: string, no_fields: boolean): void;
  // pat.rs:2294
  error_field_already_bound(span: Span, ident: Ident, other_field: Span): ErrorGuaranteed;
  // pat.rs:2312
  error_inexistent_fields(kind_name: string, inexistent_fields: readonly hir.PatField[], unmentioned_fields: [FieldDef, Ident][], pat: hir.Pat, variant: VariantDef, args: GenericArgs): Diag;
  // pat.rs:2420
  error_tuple_variant_as_struct_pat(pat: hir.Pat, fields: readonly hir.PatField[], variant: VariantDef): Result<undefined, ErrorGuaranteed>;
  // pat.rs:2468
  get_suggested_tuple_struct_pattern(fields: readonly hir.PatField[], variant: VariantDef): string;
  // pat.rs:2510
  error_no_accessible_fields(pat: hir.Pat, fields: readonly hir.PatField[]): Diag;
  // pat.rs:2559
  lint_non_exhaustive_omitted_patterns(pat: hir.Pat, unmentioned_fields: readonly [FieldDef, Ident][], ty: Ty): void;
  // pat.rs:2627
  error_unmentioned_fields(pat: hir.Pat, unmentioned_fields: readonly [FieldDef, Ident][], have_inaccessible_fields: boolean, fields: readonly hir.PatField[]): Diag;
  // pat.rs:2727
  check_pat_deref(span: Span, inner: hir.Pat, expected: Ty, pat_info: PatInfo): Ty;
  // pat.rs:2740
  deref_pat_target(span: Span, source_ty: Ty): Ty;
  // pat.rs:2763
  register_deref_mut_bounds_if_needed(span: Span, inner: hir.Pat, derefed_tys: Iterable<Ty>): void;
  // pat.rs:2781
  check_pat_ref(pat: hir.Pat, inner: hir.Pat, pat_pinned: Pinnedness, pat_mutbl: Mutability, expected: Ty, pat_info: PatInfo): Ty;
  // pat.rs:2975
  new_ref_ty(span: Span, pinnedness: Pinnedness, mutbl: Mutability, ty: Ty): Ty;
  // pat.rs:2991
  new_pinned_ty(span: Span, ty: Ty): Ty;
  // pat.rs:2999
  error_inherited_ref_mutability_mismatch(pat: hir.Pat, pat_prefix_span: Span | undefined): ErrorGuaranteed;
  // pat.rs:3022
  try_resolve_slice_ty_to_array_ty(before: readonly hir.Pat[], slice: hir.Pat | undefined, span: Span): Ty | undefined;
  // pat.rs:3069
  pat_is_irrefutable(decl_origin: DeclOrigin | undefined): boolean;
  // pat.rs:3086
  check_pat_slice(span: Span, before: readonly hir.Pat[], slice: hir.Pat | undefined, after: readonly hir.Pat[], expected: Ty, pat_info: PatInfo): Ty;
  // pat.rs:3152
  check_array_pat_len(span: Span, element_ty: Ty, arr_ty: Ty, slice: hir.Pat | undefined, len: Const, min_len: number): [Ty | undefined, Ty];
  // pat.rs:3200
  error_scrutinee_inconsistent_length(span: Span, min_len: number, size: number): ErrorGuaranteed;
  // pat.rs:3219
  error_scrutinee_with_rest_inconsistent_length(span: Span, min_len: number, size: number): ErrorGuaranteed;
  // pat.rs:3241
  error_scrutinee_unfixed_length(span: Span): ErrorGuaranteed;
  // pat.rs:3251
  error_expected_array_or_slice(span: Span, expected_ty: Ty, pat_info: PatInfo): ErrorGuaranteed;
  // pat.rs:3301
  is_slice_or_array_or_vector(ty: Ty): [boolean, Ty];
  // pat.rs:3314
  add_rust_2024_migration_desugared_pat(pat_id: HirId, subpat: hir.Pat, final_char: number, def_br_mutbl: Mutability): void;

  // ---- compiler/rustc_hir_typeck/src/place_op.rs (lane typeck-impl) ----
  // place_op.rs:20
  lookup_derefing(expr: hir.Expr, oprnd_expr: hir.Expr, oprnd_ty: Ty): Ty | undefined;
  // place_op.rs:49
  lookup_indexing(expr: hir.Expr, base_expr: hir.Expr, base_ty: Ty, index_expr: hir.Expr, idx_ty: Ty): [Ty, Ty] | undefined;
  // place_op.rs:70
  negative_index(ty: Ty, span: Span, base_expr: hir.Expr): [Ty, Ty] | undefined;
  // place_op.rs:104
  try_index_step(expr: hir.Expr, base_expr: hir.Expr, autoderef: Autoderef, index_ty: Ty, index_expr: hir.Expr): [Ty, Ty] | undefined;
  // place_op.rs:196
  try_overloaded_place_op(span: Span, base_ty: Ty, opt_rhs_ty: Ty | undefined, op: PlaceOp): InferOk<MethodCallee> | undefined;
  // place_op.rs:226
  try_mutable_overloaded_place_op(span: Span, base_ty: Ty, opt_rhs_ty: Ty | undefined, op: PlaceOp): InferOk<MethodCallee> | undefined;
  // place_op.rs:265
  convert_place_derefs_to_mutable(expr: hir.Expr): void;
  // place_op.rs:352
  convert_place_op_to_mutable(op: PlaceOp, expr: hir.Expr, base_expr: hir.Expr): void;

  // ---- compiler/rustc_hir_typeck/src/upvar.rs (lane typeck-upvar) ----
  // upvar.rs:78
  closure_analyze(body: hir.Body): void;
  // upvar.rs:85
  infer_closure_kind_for_diagnostic(closure_def_id: LocalDefId): [ClosureKind, [Span, Place] | undefined] | undefined;
  // upvar.rs:243
  analyze_closure(closure_hir_id: HirId, span: Span, body_id: hir.BodyId, body: hir.Body, capture_clause: ast.CaptureBy): void;
  // upvar.rs:658
  coroutine_body_consumes_upvars(coroutine_def_id: LocalDefId, body: hir.Body): boolean;
  // upvar.rs:698
  final_upvar_tys(closure_id: LocalDefId): Ty[];
  // upvar.rs:733
  process_collected_capture_information(capture_clause: ast.CaptureBy, capture_information: InferredCaptureInformation): [InferredCaptureInformation, ClosureKind, [Span, Place] | undefined];
  // upvar.rs:879
  compute_min_captures(closure_def_id: LocalDefId, capture_information: InferredCaptureInformation, closure_span: Span): void;
  // upvar.rs:1073
  perform_2229_migration_analysis(closure_def_id: LocalDefId, body_id: hir.BodyId, capture_clause: ast.CaptureBy, span: Span): void;
  // upvar.rs:1316
  compute_2229_migrations_reasons(auto_trait_reasons: Set<string>, drop_order: boolean): MigrationWarningReason;
  // upvar.rs:1333
  compute_2229_migrations_for_trait(min_captures: RootVariableMinCaptureList | undefined, var_hir_id: HirId, closure_clause: ast.CaptureBy): Map<UpvarMigrationInfo, Set<string>> | undefined;
  // upvar.rs:1442
  compute_2229_migrations_for_drop(closure_def_id: LocalDefId, closure_span: Span, min_captures: RootVariableMinCaptureList | undefined, closure_clause: ast.CaptureBy, var_hir_id: HirId): Set<UpvarMigrationInfo> | undefined;
  // upvar.rs:1549
  compute_2229_migrations(closure_def_id: LocalDefId, closure_span: Span, closure_clause: ast.CaptureBy, min_captures: RootVariableMinCaptureList | undefined): [NeededMigration[], MigrationWarningReason];
  // upvar.rs:1732
  has_significant_drop_outside_of_captures(closure_def_id: LocalDefId, closure_span: Span, base_path_ty: Ty, captured_by_move_projs: readonly Projection[][]): boolean;
  // upvar.rs:1874
  init_capture_kind_for_place(place: Place, capture_clause: ast.CaptureBy): UpvarCapture;
  // upvar.rs:1916
  place_for_root_variable(closure_def_id: LocalDefId, var_hir_id: HirId): Place;
  // upvar.rs:1934
  should_log_capture_analysis(closure_def_id: LocalDefId): boolean;
  // upvar.rs:1938
  log_capture_analysis_first_pass(closure_def_id: LocalDefId, capture_information: InferredCaptureInformation, closure_span: Span): void;
  // upvar.rs:1958
  log_closure_min_capture_info(closure_def_id: LocalDefId, closure_span: Span): void;
  // upvar.rs:2011
  determine_capture_mutability(typeck_results: TypeckResults, place: Place): Mutability;

  // ---- compiler/rustc_hir_typeck/src/writeback.rs (lane typeck-lib-wb) ----
  // writeback.rs:41
  resolve_type_vars_in_body(body: hir.Body): TypeckResults;

  // ---- the provided `HirTyLowerer::lowerer` (rustc_hir_analysis hir_ty_lowering/mod.rs:239; fn_ctxt/mod.ts assigns it) ----
  lowerer(): HirTyLowerer;
}

// ======================================================================================================================
// The other contract classes: methods (interface augmentation) and associated fns (namespace augmentation) of the
// generated / hand classes that more than one lane uses or that the brief names. `Deref<Target = FnCtxt>` classes
// extend `Omit<FnCtxt, ..>` (see "Deref" in the header).
// ======================================================================================================================

declare module "./coercion.ts" {
  interface CoerceMany {
    // ---- compiler/rustc_hir_typeck/src/coercion.rs (lane typeck-coerce) ----
    // coercion.rs:1592
    expected_ty(): Ty;
    // coercion.rs:1600
    merged_ty(): Ty;
    // coercion.rs:1609
    coerce(fcx: FnCtxt, cause: ObligationCause, expression: hir.Expr, expression_ty: Ty): void;
    // coercion.rs:1631
    coerce_forced_unit(fcx: FnCtxt, cause: ObligationCause, augment_error: (_1: Diag) => void, label_unit_as_expected: boolean): void;
    // coercion.rs:1652
    coerce_inner(fcx: FnCtxt, cause: ObligationCause, expression: hir.Expr | undefined, expression_ty: Ty, augment_error: (_1: Diag) => void, label_expression_as_expected: boolean): void;
    // coercion.rs:1923
    suggest_boxing_tail_for_return_position_impl_trait(fcx: FnCtxt, err: Diag, rpit_def_id: LocalDefId, a_ty: Ty, b_ty: Ty, arm_spans: Iterable<Span>): void;
    // coercion.rs:1984
    report_return_mismatched_types(cause: ObligationCause, expected: Ty, found: Ty, ty_err: TypeError, fcx: FnCtxt, block_or_return_id: HirId, expression: hir.Expr | undefined): Diag;
    // coercion.rs:2110
    is_return_ty_definitely_unsized(fcx: FnCtxt): boolean;
    // coercion.rs:2127
    complete(fcx: FnCtxt): Ty;
  }
  namespace CoerceMany {
    // coercion.rs:1575
    function new_(expected_ty: Ty): CoerceMany;
    export { new_ as new };
    // coercion.rs:1580
    export function with_capacity(expected_ty: Ty, capacity: number): CoerceMany;
  }
}

/** Coerce's own members that shadow its `Deref` target's (plus `drop`). */
export type Coerce_shadowed = "cause" | "coerce" | "deref" | "drop";
declare module "./coercion.gen.ts" {
  interface Coerce extends Omit<FnCtxt, Coerce_shadowed> {
    // ---- compiler/rustc_hir_typeck/src/coercion.rs (lane typeck-coerce) ----
    // coercion.rs:92
    deref(): FnCtxt;
    // coercion.rs:158
    unify_raw(a: Ty, b: Ty, leak_check: ForceLeakCheck): InferResult<Ty>;
    // coercion.rs:215
    unify(a: Ty, b: Ty, leak_check: ForceLeakCheck): CoerceResult;
    // coercion.rs:221
    unify_and(a: Ty, b: Ty, adjustments: Iterable<Adjustment>, final_adjustment: Adjust, leak_check: ForceLeakCheck): CoerceResult;
    // coercion.rs:242
    coerce(a: Ty, b: Ty): CoerceResult;
    // coercion.rs:362
    coerce_from_inference_variable(a: Ty, b: Ty): CoerceResult;
    // coercion.rs:411
    coerce_to_ref(a: Ty, b: Ty, r_b: Region, mutbl_b: Mutability): CoerceResult;
    // coercion.rs:555
    coerce_unsized(source: Ty, target: Ty): CoerceResult;
    // coercion.rs:711
    coerce_unsized_old_solver(obligation: Obligation<Predicate>, coercion: InferOk<[Adjustment[], Ty]>, coerce_unsized_did: DefId, unsize_did: DefId): Result<undefined, TypeError>;
    // coercion.rs:827
    unpin_obligation(source: Ty, target: Ty, ty: Ty): PredicateObligation;
    // coercion.rs:843
    maybe_pin_ref_to_ref(a: Ty, b: Ty): CoerceMaybePinnedRef | undefined;
    // coercion.rs:858
    coerce_pin_ref_to_ref(_0: CoerceMaybePinnedRef): CoerceResult;
    // coercion.rs:887
    maybe_to_pin_ref(a: Ty, b: Ty): CoerceMaybePinnedRef | undefined;
    // coercion.rs:913
    coerce_to_pin_ref(_0: CoerceMaybePinnedRef): CoerceResult;
    // coercion.rs:955
    coerce_reborrow(a: Ty, b: Ty): CoerceResult;
    // coercion.rs:980
    coerce_shared_reborrow(a: Ty, b: Ty): CoerceResult;
    // coercion.rs:1021
    coerce_from_fn_pointer(a: Ty, a_sig: PolyFnSig, b: Ty): CoerceResult;
    // coercion.rs:1040
    coerce_from_fn_item(a: Ty, b: Ty): CoerceResult;
    // coercion.rs:1066
    coerce_closure_to_fn(a: Ty, b: Ty): CoerceResult;
    // coercion.rs:1085
    coerce_to_raw_ptr(a: Ty, b: Ty, mutbl_b: Mutability): CoerceResult;
  }
  namespace Coerce {
    // coercion.rs:149
    function new_(fcx: FnCtxt, cause: ObligationCause, allow_two_phase: AllowTwoPhase, coerce_never: boolean): Coerce;
    export { new_ as new };
  }
}

declare module "./cast.gen.ts" {
  interface CastCheck {
    // ---- compiler/rustc_hir_typeck/src/cast.rs (lane typeck-callee-cast) ----
    // cast.rs:286
    report_cast_error(fcx: FnCtxt, e: CastError): void;
    // cast.rs:710
    report_cast_to_unsized_type(fcx: FnCtxt): ErrorGuaranteed;
    // cast.rs:755
    trivial_cast_lint(fcx: FnCtxt): void;
    // cast.rs:779
    is_non_trivial_ref_trait_object_upcast(fcx: FnCtxt): boolean;
    // cast.rs:804
    expr_span_for_type_resolution(fcx: FnCtxt): Span;
    // cast.rs:816
    check(fcx: FnCtxt): void;
    // cast.rs:871
    try_report_ambiguous_binop_for_infer_cast(fcx: FnCtxt): ErrorGuaranteed | undefined;
    // cast.rs:929
    do_check(fcx: FnCtxt): Result<CastKind, CastError>;
    // cast.rs:1040
    check_ptr_ptr_cast(fcx: FnCtxt, m_src: TypeAndMut, m_dst: TypeAndMut): Result<CastKind, CastError>;
    // cast.rs:1187
    check_fptr_ptr_cast(fcx: FnCtxt, m_cast: TypeAndMut): Result<CastKind, CastError>;
    // cast.rs:1201
    check_ptr_addr_cast(fcx: FnCtxt, m_expr: TypeAndMut): Result<CastKind, CastError>;
    // cast.rs:1215
    check_ref_cast(fcx: FnCtxt, m_expr: TypeAndMut, m_cast: TypeAndMut): Result<CastKind, CastError>;
    // cast.rs:1251
    check_addr_ptr_cast(fcx: FnCtxt, m_cast: TypeAndMut): Result<CastKind, CastError>;
    // cast.rs:1268
    check_enum_cast(fcx: FnCtxt): Result<CastKind, CastError>;
    // cast.rs:1278
    try_coercion_cast(fcx: FnCtxt): Result<undefined, TypeError>;
    // cast.rs:1287
    try_suggest_collection_to_bool(fcx: FnCtxt, err: Diag): void;
  }
  namespace CastCheck {
    // cast.rs:258
    function new_(fcx: FnCtxt, expr: hir.Expr, expr_ty: Ty, cast_ty: Ty, cast_span: Span, span: Span): Result<CastCheck, ErrorGuaranteed>;
    export { new_ as new };
  }
}

/** ProbeContext's own members that shadow its `Deref` target's (plus `drop`). */
export type ProbeContext_shadowed = "deref" | "drop";
declare module "./method/probe.gen.ts" {
  interface Pick {
    // ---- compiler/rustc_hir_typeck/src/method/probe.rs (lane typeck-probe) ----
    // method/probe.rs:1851
    differs_from(other: Pick): boolean;
    // method/probe.rs:1867
    maybe_emit_unstable_name_collision_hint(tcx: TyCtxt, span: Span, scope_expr_id: HirId): void;
  }
  interface ProbeContext extends Omit<FnCtxt, ProbeContext_shadowed> {
    // ---- compiler/rustc_hir_typeck/src/method/probe.rs (lane typeck-probe) ----
    // method/probe.rs:105
    deref(): FnCtxt;
    // method/probe.rs:836
    reset(): void;
    // method/probe.rs:848
    variance(): Variance;
    // method/probe.rs:858
    push_candidate(candidate: Candidate, is_inherent: boolean): void;
    // method/probe.rs:878
    assemble_inherent_candidates(): void;
    // method/probe.rs:885
    assemble_probe(self_ty: Canonical<QueryResponse<Ty>>, receiver_steps: number): void;
    // method/probe.rs:960
    assemble_inherent_candidates_for_incoherent_ty(self_ty: Ty, receiver_steps: number): void;
    // method/probe.rs:973
    assemble_inherent_impl_candidates_for_type(def_id: DefId, receiver_steps: number): void;
    // method/probe.rs:981
    assemble_inherent_impl_probe(impl_def_id: DefId, receiver_steps: number): void;
    // method/probe.rs:1004
    assemble_inherent_candidates_from_object(self_ty: Ty): void;
    // method/probe.rs:1037
    assemble_inherent_candidates_from_param(param_ty: Ty): void;
    // method/probe.rs:1072
    assemble_candidates_for_bounds(bounds: Iterable<PolyTraitRef>, mk_cand: (_1: ProbeContext, _2: PolyTraitRef, _3: AssocItem) => void): void;
    // method/probe.rs:1092
    assemble_extension_candidates_for_traits_in_scope(): void;
    // method/probe.rs:1112
    assemble_extension_candidates_for_all_traits(): void;
    // method/probe.rs:1121
    matches_return_type(method: AssocItem, expected: Ty): boolean;
    // method/probe.rs:1139
    assemble_extension_candidates_for_trait(import_ids: readonly LocalDefId[], trait_def_id: DefId, is_ambiguously_imported: boolean): void;
    // method/probe.rs:1202
    candidate_method_names(candidate_filter: (_1: AssocItem) => boolean): Ident[];
    // method/probe.rs:1241
    pick(): PickResult;
    // method/probe.rs:1304
    pick_core(unsatisfied_predicates: UnsatisfiedPredicates): PickResult | undefined;
    // method/probe.rs:1331
    pick_all_method(pick_diag_hints: PickDiagHints): PickResult | undefined;
    // method/probe.rs:1481
    check_for_shadowed_autorefd_method(possible_shadower: Pick, step: CandidateStep, self_ty: Ty, instantiate_self_ty_obligations: readonly PredicateObligation[], mutbl: Mutability, track_unstable_candidates: boolean): Result<undefined, MethodError>;
    // method/probe.rs:1574
    pick_by_value_method(step: CandidateStep, self_ty: Ty, instantiate_self_ty_obligations: readonly PredicateObligation[], pick_diag_hints: PickDiagHints): PickResult | undefined;
    // method/probe.rs:1618
    pick_autorefd_method(step: CandidateStep, self_ty: Ty, instantiate_self_ty_obligations: readonly PredicateObligation[], mutbl: Mutability, pick_diag_hints: PickDiagHints, pick_constraints: PickConstraintsForShadowed | undefined): PickResult | undefined;
    // method/probe.rs:1657
    pick_reborrow_pin_method(step: CandidateStep, self_ty: Ty, instantiate_self_ty_obligations: readonly PredicateObligation[], pick_diag_hints: PickDiagHints): PickResult | undefined;
    // method/probe.rs:1698
    pick_const_ptr_method(step: CandidateStep, self_ty: Ty, instantiate_self_ty_obligations: readonly PredicateObligation[], pick_diag_hints: PickDiagHints): PickResult | undefined;
    // method/probe.rs:1726
    pick_method(self_ty: Ty, instantiate_self_ty_obligations: readonly PredicateObligation[], pick_diag_hints: PickDiagHints, pick_constraints: PickConstraintsForShadowed | undefined): PickResult | undefined;
    // method/probe.rs:1768
    consider_candidates(self_ty: Ty, instantiate_self_ty_obligations: readonly PredicateObligation[], candidates: readonly Candidate[], pick_diag_hints: PickDiagHints, pick_constraints: PickConstraintsForShadowed | undefined): PickResult | undefined;
    // method/probe.rs:1939
    select_trait_candidate_for_diagnostics(trait_ref: TraitRef): SelectionResult<Selection>;
    // method/probe.rs:1956
    candidate_source(candidate: Candidate, self_ty: Ty): CandidateSource;
    // method/probe.rs:1991
    candidate_source_from_pick(pick: Pick): CandidateSource;
    // method/probe.rs:2000
    consider_probe(self_ty: Ty, instantiate_self_ty_obligations: readonly PredicateObligation[], probe: Candidate, possibly_unsatisfied_predicates: UnsatisfiedPredicates): ProbeResult;
    // method/probe.rs:2295
    should_reject_candidate_due_to_opaque_treated_as_rigid(trait_predicate: Predicate | undefined): boolean;
    // method/probe.rs:2371
    collapse_candidates_to_trait_pick(self_ty: Ty, probes: readonly [Candidate, ProbeResult][]): Pick | undefined;
    // method/probe.rs:2419
    collapse_candidates_to_subtrait_pick(self_ty: Ty, probes: readonly [Candidate, ProbeResult][]): Pick | undefined;
    // method/probe.rs:2500
    probe_for_similar_candidate(): Result<AssocItem | undefined, MethodError>;
    // method/probe.rs:2563
    has_applicable_self(item: AssocItem): boolean;
    // method/probe.rs:2584
    record_static_candidate(source: CandidateSource): void;
    // method/probe.rs:2589
    xform_self_ty(item: AssocItem, impl_ty: Ty, args: GenericArgs): [Ty, Ty | undefined];
    // method/probe.rs:2604
    xform_method_sig(method: DefId, args: GenericArgs): FnSig;
    // method/probe.rs:2644
    is_relevant_kind_for_mode(kind: AssocKind): boolean;
    // method/probe.rs:2654
    matches_by_doc_alias(def_id: DefId): boolean;
    // method/probe.rs:2679
    impl_or_trait_item(def_id: DefId): AssocItem[];
  }
  namespace ProbeContext {
    // method/probe.rs:804
    function new_(fcx: FnCtxt, span: Span, mode: Mode, method_name: Ident | undefined, return_type: Ty | undefined, orig_steps_var_values: OriginalQueryValues, steps: readonly CandidateStep[], scope_expr_id: HirId, is_suggestion: IsSuggestion): ProbeContext;
    export { new_ as new };
  }
}

/** ConfirmContext's own members that shadow its `Deref` target's (plus `drop`). */
export type ConfirmContext_shadowed = "deref" | "drop" | "instantiate_binder_with_fresh_vars";
declare module "./method/confirm.gen.ts" {
  interface ConfirmContext extends Omit<FnCtxt, ConfirmContext_shadowed> {
    // ---- compiler/rustc_hir_typeck/src/method/confirm.rs (lane typeck-method) ----
    // method/confirm.rs:47
    deref(): FnCtxt;
    // method/confirm.rs:102
    confirm(unadjusted_self_ty: Ty, pick: Pick, segment: hir.PathSegment): ConfirmResult;
    // method/confirm.rs:174
    adjust_self_ty(unadjusted_self_ty: Ty, pick: Pick): Ty;
    // method/confirm.rs:191
    create_ty_adjustments_from_pick(unadjusted_self_ty: Ty, pick: Pick): [Ty, Adjustment[]];
    // method/confirm.rs:290
    fresh_receiver_args(self_ty: Ty, pick: Pick): GenericArgs;
    // method/confirm.rs:368
    extract_existential_trait_ref<R>(self_ty: Ty, closure: (_1: ConfirmContext, _2: Ty, _3: PolyExistentialTraitRef) => R): R;
    // method/confirm.rs:408
    instantiate_method_args(pick: Pick, seg: hir.PathSegment, parent_args: GenericArgs): GenericArgs;
    // method/confirm.rs:553
    unify_receivers(self_ty: Ty, method_self_ty: Ty, pick: Pick): void;
    // method/confirm.rs:594
    instantiate_method_sig(pick: Pick, all_args: GenericArgs): [FnSig, InstantiatedClauses];
    // method/confirm.rs:618
    add_obligations(sig: FnSig, all_args: GenericArgs, method_clauses: InstantiatedClauses, def_id: DefId): void;
    // method/confirm.rs:669
    clauses_require_illegal_sized_bound(inst_clauses: InstantiatedClauses): Span | undefined;
    // method/confirm.rs:698
    check_for_illegal_method_calls(pick: Pick): void;
    // method/confirm.rs:714
    lint_shadowed_supertrait_items(pick: Pick, segment: hir.PathSegment): void;
    // method/confirm.rs:753
    lint_ambiguously_glob_imported_traits(pick: Pick, segment: hir.PathSegment): void;
    // method/confirm.rs:778
    upcast(source_trait_ref: PolyTraitRef, target_trait_def_id: DefId): PolyTraitRef;
    // method/confirm.rs:806
    instantiate_binder_with_fresh_vars<T>(value: Binder<T>, d_T: TypeFoldable<T>): T;
  }
  namespace ConfirmContext {
    // method/confirm.rs:93
    function new_(fcx: FnCtxt, span: Span, self_expr: hir.Expr, call_expr: hir.Expr): ConfirmContext;
    export { new_ as new };
  }
}

declare module "./fn_ctxt/mod.gen.ts" {
  interface LoweredTy {
  }
  namespace LoweredTy {
    // fn_ctxt/mod.rs:487
    export function from_raw(fcx: FnCtxt, span: Span, raw: Ty): LoweredTy;
  }
}

declare module "./callee.gen.ts" {
  interface DeferredCallResolution {
    // ---- compiler/rustc_hir_typeck/src/callee.rs (lane typeck-callee-cast) ----
    // callee.rs:1224
    resolve(fcx: FnCtxt): void;
  }
}

declare module "./lib.gen.ts" {
  interface EnclosingBreakables {
    // ---- compiler/rustc_hir_typeck/src/lib.rs (lane fnctxt-contract) ----
    // lib.rs:465
    find_breakable(target_id: HirId): BreakableCtxt;
    // lib.rs:471
    opt_find_breakable(target_id: HirId): BreakableCtxt | undefined;
  }
}

declare module "./expr_use_visitor.gen.ts" {
  interface ExprUseVisitor<Cx, D> {
    // ---- compiler/rustc_hir_typeck/src/expr_use_visitor.rs (lane typeck-euv) ----
    // expr_use_visitor.rs:308
    consume_body(body: hir.Body): Result<undefined, ErrorGuaranteed>;
    // expr_use_visitor.rs:325
    consume_or_copy(place_with_id: PlaceWithHirId, diag_expr_id: HirId): void;
    // expr_use_visitor.rs:334
    consume_clone_or_copy(place_with_id: PlaceWithHirId, diag_expr_id: HirId): void;
    // expr_use_visitor.rs:350
    consume_exprs(exprs: readonly hir.Expr[]): Result<undefined, ErrorGuaranteed>;
    // expr_use_visitor.rs:360
    consume_expr(expr: hir.Expr): Result<undefined, ErrorGuaranteed>;
    // expr_use_visitor.rs:368
    consume_or_clone_expr(expr: hir.Expr): Result<undefined, ErrorGuaranteed>;
    // expr_use_visitor.rs:375
    mutate_expr(expr: hir.Expr): Result<undefined, ErrorGuaranteed>;
    // expr_use_visitor.rs:383
    borrow_expr(expr: hir.Expr, bk: BorrowKind): Result<undefined, ErrorGuaranteed>;
    // expr_use_visitor.rs:390
    walk_expr(expr: hir.Expr): Result<undefined, ErrorGuaranteed>;
    // expr_use_visitor.rs:576
    walk_stmt(stmt: hir.Stmt): Result<undefined, ErrorGuaranteed>;
    // expr_use_visitor.rs:598
    fake_read_scrutinee(discr_place: PlaceWithHirId, refutable: boolean): Result<undefined, ErrorGuaranteed>;
    // expr_use_visitor.rs:619
    walk_local(expr: hir.Expr, pat: hir.Pat, els: hir.Block | undefined): Result<undefined, ErrorGuaranteed>;
    // expr_use_visitor.rs:638
    walk_block(blk: hir.Block): Result<undefined, ErrorGuaranteed>;
    // expr_use_visitor.rs:650
    walk_struct_expr(fields: readonly hir.ExprField[], opt_with: hir.StructTailExpr): Result<undefined, ErrorGuaranteed>;
    // expr_use_visitor.rs:720
    walk_adjustment(expr: hir.Expr): Result<undefined, ErrorGuaranteed>;
    // expr_use_visitor.rs:768
    walk_autoref(expr: hir.Expr, base_place: PlaceWithHirId, autoref: AutoBorrow): void;
    // expr_use_visitor.rs:800
    walk_arm(discr_place: PlaceWithHirId, arm: hir.Arm): Result<undefined, ErrorGuaranteed>;
    // expr_use_visitor.rs:828
    walk_pat(discr_place: PlaceWithHirId, pat: hir.Pat, has_guard: boolean): Result<undefined, ErrorGuaranteed>;
    // expr_use_visitor.rs:991
    walk_captures(closure_expr: hir.Closure): Result<undefined, ErrorGuaranteed>;
    // expr_use_visitor.rs:1121
    expect_and_resolve_type(id: HirId, ty: Ty | undefined): Result<Ty, ErrorGuaranteed>;
    // expr_use_visitor.rs:1140
    node_ty(hir_id: HirId): Result<Ty, ErrorGuaranteed>;
    // expr_use_visitor.rs:1144
    expr_ty(expr: hir.Expr): Result<Ty, ErrorGuaranteed>;
    // expr_use_visitor.rs:1148
    expr_ty_adjusted(expr: hir.Expr): Result<Ty, ErrorGuaranteed>;
    // expr_use_visitor.rs:1165
    pat_ty_adjusted(pat: hir.Pat): Result<Ty, ErrorGuaranteed>;
    // expr_use_visitor.rs:1185
    pat_ty_unadjusted(pat: hir.Pat): Result<Ty, ErrorGuaranteed>;
    // expr_use_visitor.rs:1230
    cat_expr(expr: hir.Expr): Result<PlaceWithHirId, ErrorGuaranteed>;
    // expr_use_visitor.rs:1236
    cat_expr_(expr: hir.Expr, adjustments: readonly Adjustment[]): Result<PlaceWithHirId, ErrorGuaranteed>;
    // expr_use_visitor.rs:1249
    cat_expr_adjusted(expr: hir.Expr, previous: PlaceWithHirId, adjustment: Adjustment): Result<PlaceWithHirId, ErrorGuaranteed>;
    // expr_use_visitor.rs:1258
    cat_expr_adjusted_with(expr: hir.Expr, previous: () => Result<PlaceWithHirId, ErrorGuaranteed>, adjustment: Adjustment): Result<PlaceWithHirId, ErrorGuaranteed>;
    // expr_use_visitor.rs:1295
    cat_expr_unadjusted(expr: hir.Expr): Result<PlaceWithHirId, ErrorGuaranteed>;
    // expr_use_visitor.rs:1393
    cat_res(hir_id: HirId, span: Span, expr_ty: Ty, res: Res): Result<PlaceWithHirId, ErrorGuaranteed>;
    // expr_use_visitor.rs:1433
    cat_upvar(hir_id: HirId, var_id: HirId): Result<PlaceWithHirId, ErrorGuaranteed>;
    // expr_use_visitor.rs:1445
    cat_rvalue(hir_id: HirId, expr_ty: Ty): PlaceWithHirId;
    // expr_use_visitor.rs:1449
    cat_projection(node: HirId, base_place: PlaceWithHirId, ty: Ty, kind: ProjectionKind): PlaceWithHirId;
    // expr_use_visitor.rs:1477
    cat_overloaded_place(expr: hir.Expr, base: hir.Expr): Result<PlaceWithHirId, ErrorGuaranteed>;
    // expr_use_visitor.rs:1499
    cat_deref(node: HirId, base_place: PlaceWithHirId): Result<PlaceWithHirId, ErrorGuaranteed>;
    // expr_use_visitor.rs:1523
    variant_index_for_adt(qpath: hir.QPath, pat_hir_id: HirId, span: Span): Result<VariantIdx, ErrorGuaranteed>;
    // expr_use_visitor.rs:1556
    total_fields_in_adt_variant(pat_hir_id: HirId, variant_index: VariantIdx, span: Span): Result<number, ErrorGuaranteed>;
    // expr_use_visitor.rs:1576
    total_fields_in_tuple(pat_hir_id: HirId, span: Span): Result<number, ErrorGuaranteed>;
    // expr_use_visitor.rs:1590
    cat_pattern(place_with_id: PlaceWithHirId, pat: hir.Pat, op: (_1: PlaceWithHirId, _2: hir.Pat) => Result<undefined, ErrorGuaranteed>): Result<undefined, ErrorGuaranteed>;
    // expr_use_visitor.rs:1826
    pat_deref_place(hir_id: HirId, base_place: PlaceWithHirId, inner: hir.Pat, target_ty: Ty): Result<PlaceWithHirId, ErrorGuaranteed>;
    // expr_use_visitor.rs:1851
    is_multivariant_adt(ty: Ty, span: Span): boolean;
  }
  namespace ExprUseVisitor {
    // expr_use_visitor.rs:289
    export function for_clippy<Cx, D>(cx: LateContext, body_def_id: LocalDefId, delegate: D): ExprUseVisitor<Cx, D>;
    // expr_use_visitor.rs:300
    function new_<Cx, D>(cx: Cx, delegate: D): ExprUseVisitor<Cx, D>;
    export { new_ as new };
  }
}

/** CallCtxt's own members that shadow its `Deref` target's (plus `drop`). */
export type CallCtxt_shadowed = "deref" | "drop";
/** ArgsCtxt's own members that shadow its `Deref` target's (plus `drop`). */
export type ArgsCtxt_shadowed = "call_metadata" | "deref" | "drop";
/** ArgMatchingCtxt's own members that shadow its `Deref` target's (plus `drop`). */
export type ArgMatchingCtxt_shadowed = "deref" | "drop" | "provided_arg_tys";
/** FnCallDiagCtxt's own members that shadow its `Deref` target's (plus `drop`). */
export type FnCallDiagCtxt_shadowed = "deref" | "drop" | "label_generic_mismatches";
declare module "./fn_ctxt/checks.gen.ts" {
  interface CallCtxt extends Omit<FnCtxt, CallCtxt_shadowed> {
    // ---- compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs, lines 1669..3710 (lane typeck-checks-b) ----
    // fn_ctxt/checks.rs:3449
    deref(): FnCtxt;
    // fn_ctxt/checks.rs:3504
    call_metadata(): CallMetadata;
    // fn_ctxt/checks.rs:3560
    mk_trace(span: Span, _1: [Ty, Ty], provided_ty: Ty): TypeTrace;
    // fn_ctxt/checks.rs:3577
    ty_to_snippet(ty: Ty, expected_idx: ExpectedIdx): string;
    // fn_ctxt/checks.rs:3599
    first_incompatible_error(): [ProvidedIdx, TypeError] | undefined;
  }
  namespace CallCtxt {
    // fn_ctxt/checks.rs:3455
    function new_(fn_ctxt: FnCtxt, compatibility_diagonal: Compatibility[], formal_and_expected_inputs: [Ty, Ty][], provided_args: hir.Expr[], c_variadic: boolean, err_code: ErrCode, fn_id: SplatLoweringInfo, call_span: Span, call_expr: hir.Expr, tuple_arguments: TupleArgumentsFlag): CallCtxt;
    export { new_ as new };
  }
  interface ArgsCtxt extends Omit<CallCtxt, ArgsCtxt_shadowed> {
    // ---- compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs, lines 1669..3710 (lane typeck-checks-b) ----
    // fn_ctxt/checks.rs:3304
    deref(): CallCtxt;
    // fn_ctxt/checks.rs:3348
    normalize_span(span: Span): Span;
    // fn_ctxt/checks.rs:3362
    provided_arg_tys(): [Ty, Span][];
    // fn_ctxt/checks.rs:3383
    similar_assoc(call_name: Ident): [AssocItem, FnSig] | undefined;
    // fn_ctxt/checks.rs:3417
    call_is_in_macro(): boolean;
  }
  namespace ArgsCtxt {
    // fn_ctxt/checks.rs:3310
    function new_(arg: FnCtxt, compatibility_diagonal: Compatibility[], formal_and_expected_inputs: [Ty, Ty][], provided_args: hir.Expr[], c_variadic: boolean, err_code: ErrCode, fn_id: SplatLoweringInfo, call_span: Span, call_expr: hir.Expr, tuple_arguments: TupleArgumentsFlag): ArgsCtxt;
    export { new_ as new };
  }
  interface ArgMatchingCtxt extends Omit<ArgsCtxt, ArgMatchingCtxt_shadowed> {
    // ---- compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs, lines 1669..3710 (lane typeck-checks-b) ----
    // fn_ctxt/checks.rs:3154
    deref(): ArgsCtxt;
    // fn_ctxt/checks.rs:3190
    suggest_confusable(err: Diag): void;
    // fn_ctxt/checks.rs:3236
    check_compatible(provided_idx: ProvidedIdx, expected_idx: ExpectedIdx): Compatibility;
    // fn_ctxt/checks.rs:3280
    remove_idx_is_perfect(idx: number): boolean;
  }
  namespace ArgMatchingCtxt {
    // fn_ctxt/checks.rs:3160
    function new_(arg: FnCtxt, compatibility_diagonal: Compatibility[], formal_and_expected_inputs: [Ty, Ty][], provided_args: hir.Expr[], c_variadic: boolean, err_code: ErrCode, fn_id: SplatLoweringInfo, call_span: Span, call_expr: hir.Expr, tuple_arguments: TupleArgumentsFlag): ArgMatchingCtxt;
    export { new_ as new };
  }
  interface FnCallDiagCtxt extends Omit<ArgMatchingCtxt, FnCallDiagCtxt_shadowed> {
    // ---- compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs, lines 1669..3710 (lane typeck-checks-b) ----
    // fn_ctxt/checks.rs:2252
    deref(): ArgMatchingCtxt;
    // fn_ctxt/checks.rs:2306
    check_wrap_args_in_tuple(): ErrorGuaranteed | undefined;
    // fn_ctxt/checks.rs:2418
    ensure_has_errors(): ErrorGuaranteed | undefined;
    // fn_ctxt/checks.rs:2434
    detect_dotdot(err: Diag, ty: Ty, expr: hir.Expr): void;
    // fn_ctxt/checks.rs:2460
    filter_out_invalid_arguments(): ErrorGuaranteed | undefined;
    // fn_ctxt/checks.rs:2492
    check_single_incompatible(): ErrorGuaranteed | undefined;
    // fn_ctxt/checks.rs:2571
    maybe_optimize_extra_arg_suggestion(): void;
    // fn_ctxt/checks.rs:2583
    initial_final_diagnostic(): Diag;
    // fn_ctxt/checks.rs:2610
    labels_and_suggestion_text(err: Diag): [[Span, string][], [Span, string][], SuggestionText];
    // fn_ctxt/checks.rs:2969
    label_generic_mismatches(err: Diag): void;
    // fn_ctxt/checks.rs:2989
    append_arguments_changes(suggestions: [Span, string][]): void;
    // fn_ctxt/checks.rs:3057
    arguments_formatting(suggestion_span: Span): ArgumentsFormatting;
    // fn_ctxt/checks.rs:3074
    suggestion_code(): [Span, string];
    // fn_ctxt/checks.rs:3129
    maybe_suggest_expect_for_unwrap(provided_ty: Ty): Span | undefined;
  }
  namespace FnCallDiagCtxt {
    // fn_ctxt/checks.rs:2264
    function new_(arg: FnCtxt, compatibility_diagonal: Compatibility[], formal_and_expected_inputs: [Ty, Ty][], provided_args: hir.Expr[], c_variadic: boolean, err_code: ErrCode, fn_id: SplatLoweringInfo, call_span: Span, call_expr: hir.Expr, tuple_arguments: TupleArgumentsFlag): FnCallDiagCtxt;
    export { new_ as new };
    // fn_ctxt/checks.rs:3033
    export function format_suggestion_text(err: Diag, suggestions: [Span, string][], suggestion_text: SuggestionText): string | undefined;
  }
}

declare module "./gather_locals.ts" {
  interface GatherLocalsVisitor {
    // ---- compiler/rustc_hir_typeck/src/gather_locals.rs (lane fnctxt-contract) ----
    // gather_locals.rs:107
    assign(span: Span, nid: HirId, ty_opt: Ty | undefined): Ty;
    // gather_locals.rs:136
    declare(decl: Declaration): void;
  }
  namespace GatherLocalsVisitor {
    // gather_locals.rs:78
    export function gather_from_local(fcx: FnCtxt, local: hir.LetStmt): void;
    // gather_locals.rs:84
    export function gather_from_let_expr(fcx: FnCtxt, let_expr: hir.LetExpr, expr_hir_id: HirId): void;
    // gather_locals.rs:94
    export function gather_from_param(fcx: FnCtxt, param: hir.Param): void;
    // gather_locals.rs:102
    export function gather_from_arm(fcx: FnCtxt, local: hir.Arm): void;
  }
}

declare module "./writeback.ts" {
  interface WritebackCx {
    // ---- compiler/rustc_hir_typeck/src/writeback.rs (lane typeck-lib-wb) ----
    // writeback.rs:135
    tcx(): TyCtxt;
    // writeback.rs:139
    write_ty_to_typeck_results(hir_id: HirId, ty: Ty): void;
    // writeback.rs:152
    fix_scalar_builtin_expr(e: hir.Expr): void;
    // writeback.rs:202
    is_builtin_index(e: hir.Expr, base_ty: Ty, index_ty: Ty): boolean;
    // writeback.rs:221
    fix_index_builtin_expr(e: hir.Expr): void;
    // writeback.rs:379
    eval_closure_size(): void;
    // writeback.rs:396
    visit_min_capture_map(): void;
    // writeback.rs:427
    visit_fake_reads_map(): void;
    // writeback.rs:451
    visit_closures(): void;
    // writeback.rs:467
    visit_coercion_casts(): void;
    // writeback.rs:478
    visit_user_provided_tys(): void;
    // writeback.rs:518
    visit_user_provided_sigs(): void;
    // writeback.rs:527
    visit_coroutine_interior(): void;
    // writeback.rs:537
    visit_transmutes(): void;
    // writeback.rs:549
    visit_offloads(): void;
    // writeback.rs:564
    visit_opaque_types_next(): void;
    // writeback.rs:572
    visit_opaque_types(): void;
    // writeback.rs:667
    visit_field_id(hir_id: HirId): void;
    // writeback.rs:675
    visit_node_id(span: Span, hir_id: HirId): void;
    // writeback.rs:707
    visit_adjustments(span: Span, hir_id: HirId): void;
    // writeback.rs:723
    visit_rust_2024_migration_desugared_pats(hir_id: HirId): void;
    // writeback.rs:741
    visit_pat_adjustments(span: Span, hir_id: HirId): void;
    // writeback.rs:757
    visit_skipped_ref_pats(hir_id: HirId): void;
    // writeback.rs:764
    visit_liberated_fn_sigs(): void;
    // writeback.rs:778
    visit_fru_field_types(): void;
    // writeback.rs:792
    visit_offset_of_container_types(): void;
    // writeback.rs:807
    visit_potentially_region_dependent_goals(): void;
    // writeback.rs:834
    resolve<T>(value: T, span: Locatable, d_T: TypeFoldable<T>): T;
    // writeback.rs:877
    resolve_coroutine_predicate<T>(value: T, span: Locatable, d_T: TypeFoldable<T>): T;
  }
  namespace WritebackCx {
    // writeback.rs:111
    function new_(fcx: FnCtxt, body: hir.Body, rustc_dump_user_args: boolean): WritebackCx;
    export { new_ as new };
  }
}

// ======================================================================================================================
// expr_use_visitor.rs: the traits `Delegate` (:34) and `TypeInformationCtxt` (:149)
// ======================================================================================================================

/**
 * expr_use_visitor.rs:34 `pub trait Delegate<'tcx>`: the callbacks of `ExprUseVisitor`. Implementors (upvar.rs
 * `InferBorrowKind`, expr_use_visitor.rs `ExprPlaceDelegate`, later clippy's) are classes or objects implementing
 * this interface; the two provided methods (`copy`, `bind`) are `Delegate_provided.copy(self_, ..)` /
 * `.bind(self_, ..)` in expr_use_visitor.ts, and an implementor that does not override them forwards to those.
 * `impl Delegate for &mut D` (:108) is the identity (a `&mut D` is the `D` object itself).
 */
export interface Delegate {
  // expr_use_visitor.rs:48
  consume(place_with_id: PlaceWithHirId, diag_expr_id: HirId): void;
  // expr_use_visitor.rs:63
  use_cloned(place_with_id: PlaceWithHirId, diag_expr_id: HirId): void;
  // expr_use_visitor.rs:67
  borrow(place_with_id: PlaceWithHirId, diag_expr_id: HirId, bk: BorrowKind): void;
  // expr_use_visitor.rs:80 (provided: `Delegate_provided.copy`)
  copy(place_with_id: PlaceWithHirId, diag_expr_id: HirId): void;
  // expr_use_visitor.rs:88
  mutate(assignee_place: PlaceWithHirId, diag_expr_id: HirId): void;
  // expr_use_visitor.rs:93 (provided: `Delegate_provided.bind`)
  bind(binding_place: PlaceWithHirId, diag_expr_id: HirId): void;
  // expr_use_visitor.rs:100
  fake_read(place_with_id: PlaceWithHirId, cause: FakeReadCause, diag_expr_id: HirId): void;
}

/**
 * expr_use_visitor.rs:149 `pub trait TypeInformationCtxt<'tcx>`: one `impl TypeInformationCtxt for X` block, as an
 * object of `this`-typed methods (the representation of rustc_hir_analysis's `HirTyLowererImpl`): FnCtxt's fields
 * `typeck_results` / `tcx` and its methods `tainted_by_errors` / `deeply_resolve_ignoring_regions` share their names
 * with this trait's methods. `TypeInformationCtxt_FnCtxt: TypeInformationCtxtImpl<FnCtxt>` (`impl .. for &FnCtxt`,
 * :180) and the `(&LateContext, LocalDefId)` impl (:230) live in expr_use_visitor.ts.
 * - `type TypeckResults<'a>: Deref<Target = ty::TypeckResults>` is `TypeckResults` (the `Ref` guard is the value).
 * - `type Error` is `ErrorGuaranteed` for FnCtxt and `!` for the LateContext impl (whose methods never return an
 *   error), so `Cx::Error` is `ErrorGuaranteed` throughout `ExprUseVisitor`.
 */
export interface TypeInformationCtxtImpl<S> {
  // expr_use_visitor.rs:157
  typeck_results(this: S): TypeckResults;
  // expr_use_visitor.rs:159
  deeply_resolve_ignoring_regions<T>(this: S, t: T, d_T: TypeFoldable<T>): T;
  // expr_use_visitor.rs:161
  structurally_resolve_type(this: S, span: Span, ty: Ty): Ty;
  // expr_use_visitor.rs:163
  report_bug(this: S, span: Span, msg: string): ErrorGuaranteed;
  // expr_use_visitor.rs:165
  error_reported_in_ty(this: S, ty: Ty): Result<undefined, ErrorGuaranteed>;
  // expr_use_visitor.rs:167
  tainted_by_errors(this: S): Result<undefined, ErrorGuaranteed>;
  // expr_use_visitor.rs:169
  type_is_copy_modulo_regions(this: S, ty: Ty): boolean;
  // expr_use_visitor.rs:171
  type_is_use_cloned_modulo_regions(this: S, ty: Ty): boolean;
  // expr_use_visitor.rs:173
  body_owner_def_id(this: S): LocalDefId;
  // expr_use_visitor.rs:175
  tcx(this: S): TyCtxt;
}

/**
 * A `Cx: TypeInformationCtxt<'tcx>` value of `ExprUseVisitor<Cx, D>`: the implementor plus its impl object (the trait
 * methods dispatch through the vtable, as rustc_hir_analysis's `HirTyLowerer`). Built by
 * `TypeInformationCtxt.of(fcx, TypeInformationCtxt_FnCtxt)`; `ExprUseVisitor.new(cx, delegate)` takes one.
 */
export class TypeInformationCtxt {
  constructor(
    readonly data: unknown,
    readonly vtable: TypeInformationCtxtImpl<unknown>,
  ) {}

  static of<S>(data: S, vtable: TypeInformationCtxtImpl<S>): TypeInformationCtxt {
    return new TypeInformationCtxt(data, vtable as TypeInformationCtxtImpl<unknown>);
  }

  // ---- the trait's methods (dispatch; not ports: the `// rustc:` markers sit on each impl's methods) ----
  typeck_results(): TypeckResults {
    return this.vtable.typeck_results.call(this.data);
  }
  deeply_resolve_ignoring_regions<T>(t: T, d_T: TypeFoldable<T>): T {
    return this.vtable.deeply_resolve_ignoring_regions.call(this.data, t, d_T) as T;
  }
  structurally_resolve_type(span: Span, ty: Ty): Ty {
    return this.vtable.structurally_resolve_type.call(this.data, span, ty);
  }
  report_bug(span: Span, msg: string): ErrorGuaranteed {
    return this.vtable.report_bug.call(this.data, span, msg);
  }
  error_reported_in_ty(ty: Ty): Result<undefined, ErrorGuaranteed> {
    return this.vtable.error_reported_in_ty.call(this.data, ty);
  }
  tainted_by_errors(): Result<undefined, ErrorGuaranteed> {
    return this.vtable.tainted_by_errors.call(this.data);
  }
  type_is_copy_modulo_regions(ty: Ty): boolean {
    return this.vtable.type_is_copy_modulo_regions.call(this.data, ty);
  }
  type_is_use_cloned_modulo_regions(ty: Ty): boolean {
    return this.vtable.type_is_use_cloned_modulo_regions.call(this.data, ty);
  }
  body_owner_def_id(): LocalDefId {
    return this.vtable.body_owner_def_id.call(this.data);
  }
  tcx(): TyCtxt {
    return this.vtable.tcx.call(this.data);
  }
}

// ======================================================================================================================
// Companions: the methods of generated enums (PORTING §8: `X.method(self, ..)` on the companion const, `self` first)
// that more than one file uses. The hand module of each enum exports `X` as `{ ...gen.X, <methods> }`.
// ======================================================================================================================

export interface Companions {
  Expectation: {
    // expectation.rs:43
    try_structurally_resolve_and_adjust_for_branches(self_: Expectation, fcx: FnCtxt): Expectation;
    // expectation.rs:76
    rvalue_hint(fcx: FnCtxt, ty: Ty): Expectation;
    // expectation.rs:93
    resolve(self_: Expectation, fcx: FnCtxt): Expectation;
    // expectation.rs:104
    to_option(self_: Expectation, fcx: FnCtxt): Ty | undefined;
    // expectation.rs:115
    only_has_type(self_: Expectation, fcx: FnCtxt): Ty | undefined;
    // expectation.rs:124
    coercion_target_type(self_: Expectation, fcx: FnCtxt, span: Span): Ty;
  };
  Diverges: {
    // diverges.rs:42 (`impl ops :: BitAnd`)
    bitand(self_: Diverges, other: Diverges): Diverges;
    // diverges.rs:56 (`impl ops :: BitOr`)
    bitor(self_: Diverges, other: Diverges): Diverges;
    // diverges.rs:69 (`impl ops :: BitAndAssign`)
    bitand_assign(self_: MutRef<Diverges>, other: Diverges): void;
    // diverges.rs:75 (`impl ops :: BitOrAssign`)
    bitor_assign(self_: MutRef<Diverges>, other: Diverges): void;
    // diverges.rs:82
    always(span: Span): Diverges;
    // diverges.rs:86
    is_always(self_: Diverges): boolean;
  };
  Needs: {
    // lib.rs:437
    maybe_mut_place(m: Mutability): Needs;
  };
  TupleArgumentsFlag: {
    // lib.rs:646
    rust_fn_trait_call(): TupleArgumentsFlag;
    // lib.rs:651
    with_fn_sig_kind(fn_sig_kind: FnSigKind, is_method: boolean): TupleArgumentsFlag;
    // lib.rs:669
    is_tupled(self_: TupleArgumentsFlag): boolean;
    // lib.rs:678
    is_splatted(self_: TupleArgumentsFlag): boolean;
    // lib.rs:687
    tupled_arg_index(self_: TupleArgumentsFlag): [number | undefined, boolean];
  };
}

// ======================================================================================================================
// The free fns, per module (`Fns_<module>`; contract.test.ts checks each against the stub module's exports).
// Nested fns are comment-only declarations (below).
// ======================================================================================================================

/** The free fns of compiler/rustc_hir_typeck/src/_match.rs (lane typeck-impl). */
export interface Fns__match {
  // _match.rs:562
  arms_contain_ref_bindings(arms: readonly hir.Arm[]): Mutability | undefined;
}

/** The free fns of compiler/rustc_hir_typeck/src/callee.rs (lane typeck-callee-cast). */
export interface Fns_callee {
  // callee.rs:50
  check_legal_trait_for_method_call(tcx: TyCtxt, span: Span, receiver: Span | undefined, expr_span: Span, trait_id: DefId, body_def_id: DefId): Result<undefined, ErrorGuaranteed>;
}

/** The free fns of compiler/rustc_hir_typeck/src/cast.rs (lane typeck-callee-cast). */
export interface Fns_cast {
  // cast.rs:212
  make_invalid_casting_error(span: Span, expr_ty: Ty, cast_ty: Ty, fcx: FnCtxt): Diag;
  // cast.rs:233
  check_cast(tcx: TyCtxt, param_env: ParamEnv, e: hir.Expr, from_ty: Ty, to_ty: Ty): CastKind | undefined;
  // cast.rs:1315
  index_operand_ambiguity_span(expr: hir.Expr): Span;
}

/** The free fns of compiler/rustc_hir_typeck/src/check.rs (lane typeck-lib-wb). */
export interface Fns_check {
  // check.rs:28
  check_fn(fcx: FnCtxt, fn_sig: FnSig, coroutine_types: CoroutineTypes | undefined, decl: hir.FnDecl, fn_def_id: LocalDefId, body: hir.Body, params_can_be_unsized: boolean): CoroutineTypes | undefined;
  // check.rs:165
  check_panic_info_fn(tcx: TyCtxt, fn_id: LocalDefId, fn_sig: FnSig): void;
  // check.rs:237
  check_lang_start_fn(tcx: TyCtxt, fn_sig: FnSig, def_id: LocalDefId): void;
}

/** The free fns of compiler/rustc_hir_typeck/src/coercion.rs (lane typeck-coerce). */
export interface Fns_coercion {
  // coercion.rs:101
  coerce_mutbls(from_mutbl: Mutability, to_mutbl: Mutability): RelateResult<null>;
  // coercion.rs:109
  success(adj: Adjustment[], target: Ty, obligations: PredicateObligations): CoerceResult;
  // coercion.rs:1489
  can_coerce(tcx: TyCtxt, param_env: ParamEnv, body_def_id: LocalDefId, ty: Ty, output_ty: Ty): boolean;
  // coercion.rs:2139
  irrefutable_if_let_expr(block: hir.Block): hir.Pat | undefined;
  // coercion.rs:2149
  simple_irrefutable_pattern(pat: hir.Pat): boolean;
}

/** The free fns of compiler/rustc_hir_typeck/src/diagnostics.rs (lane wave 19). */
export interface Fns_diagnostics {
  // diagnostics.rs:1260
  maybe_emit_plus_equals_diagnostic(fnctxt: FnCtxt, assign_op: Spanned<AssignOpKind>, lhs_expr: hir.Expr): Result<undefined, Diag>;
}

/** The free fns of compiler/rustc_hir_typeck/src/expr_use_visitor.rs (lane typeck-euv). */
export interface Fns_expr_use_visitor {
  // expr_use_visitor.rs:1879
  expr_place(fcx: FnCtxt, expr: hir.Expr): Result<PlaceWithHirId, ErrorGuaranteed>;
}

/** The free fns of compiler/rustc_hir_typeck/src/fallback.rs (lane typeck-lib-wb). */
export interface Fns_fallback {
  // fallback.rs:517
  compute_unsafe_infer_vars(fcx: FnCtxt, body_def_id: LocalDefId): Map<TyVid, [HirId, Span, UnsafeUseReason]>;
}

/** The free fns of compiler/rustc_hir_typeck/src/fn_ctxt/adjust_fulfillment_errors.rs (lane wave 19). */
export interface Fns_fn_ctxt_adjust_fulfillment_errors {
  // fn_ctxt/adjust_fulfillment_errors.rs:1172
  find_param_in_ty(ty: GenericArg, param_to_point_at: GenericArg): boolean;
  // fn_ctxt/adjust_fulfillment_errors.rs:1200
  is_iterator_singleton<T>(iterator: Iterable<T>): T | undefined;
}

/** The free fns of compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs (lane typeck-checks-a|typeck-checks-b). */
export interface Fns_fn_ctxt_checks {
  // fn_ctxt/checks.rs:3615
  same_type_modulo_vars(tcx: TyCtxt, a: Ty, b: Ty): boolean;
}

/** The free fns of compiler/rustc_hir_typeck/src/intrinsicck.rs (lane typeck-euv). */
export interface Fns_intrinsicck {
  // intrinsicck.rs:16
  unpack_option_like(tcx: TyCtxt, ty: Ty): Ty;
  // intrinsicck.rs:42
  skeleton_string(ty: Ty, sk: Result<SizeSkeleton, LayoutError>): string;
  // intrinsicck.rs:69
  check_transmute(tcx: TyCtxt, typing_env: TypingEnv, from: Unnormalized<Ty>, to: Unnormalized<Ty>, hir_id: HirId): Result<undefined, ErrorGuaranteed>;
  // intrinsicck.rs:137
  check_offload(tcx: TyCtxt, typing_env: TypingEnv, kernel_ty: Ty, args_ty: Ty, ret_ty: Ty, hir_id: HirId): Result<undefined, ErrorGuaranteed>;
  // intrinsicck.rs:240
  check_transmutes(tcx: TyCtxt, owner: LocalDefId): Result<null, ErrorGuaranteed>;
  // intrinsicck.rs:256
  check_offloads(tcx: TyCtxt, owner: LocalDefId): Result<null, ErrorGuaranteed>;
}

/** The free fns of compiler/rustc_hir_typeck/src/lib.rs (lane fnctxt-contract). */
export interface Fns_lib {
  // lib.rs:80
  used_trait_imports(tcx: TyCtxt, def_id: LocalDefId): Set<LocalDefId>;
  // lib.rs:84
  typeck_root(tcx: TyCtxt, def_id: LocalDefId): TypeckResults;
  // lib.rs:92
  inspect_typeck(tcx: TyCtxt, def_id: LocalDefId, inspect: ObligationInspector): TypeckResults;
  // lib.rs:108
  typeck_with_inspect(tcx: TyCtxt, def_id: LocalDefId, inspector: ObligationInspector | undefined): TypeckResults;
  // lib.rs:279
  extend_err_with_const_context(err: Diag, tcx: TyCtxt, node: hir.Node, expected_ty: Ty): void;
  // lib.rs:375
  infer_type_if_missing(fcx: FnCtxt, node: hir.Node): Ty | undefined;
  // lib.rs:697
  fatally_break_rust(tcx: TyCtxt, span: Span): never;
  // lib.rs:719
  provide(providers: Providers): void;
}

/** The free fns of compiler/rustc_hir_typeck/src/loops.rs (lane typeck-lib-wb). */
export interface Fns_loops {
  // loops.rs:86
  check(tcx: TyCtxt, def_id: LocalDefId, body: hir.Body): void;
}

/** The free fns of compiler/rustc_hir_typeck/src/method/probe.rs (lane typeck-probe). */
export interface Fns_method_probe {
  // method/probe.rs:635
  method_autoderef_steps(tcx: TyCtxt, goal: CanonicalMethodAutoderefStepsGoal): MethodAutoderefStepsResult;
}

/** The free fns of compiler/rustc_hir_typeck/src/method/suggest.rs (lane wave 19). */
export interface Fns_method_suggest {
  // method/suggest.rs:4962
  all_traits(tcx: TyCtxt): TraitInfo[];
  // method/suggest.rs:4966
  print_disambiguation_help(tcx: TyCtxt, err: Diag, source: SelfSource, args: readonly hir.Expr[] | undefined, trait_ref: TraitRef, candidate_idx: number | undefined, span: Span, item: AssocItem): string | undefined;
}

/** The free fns of compiler/rustc_hir_typeck/src/naked_functions.rs (lane typeck-euv). */
export interface Fns_naked_functions {
  // naked_functions.rs:18
  typeck_naked_fn(tcx: TyCtxt, def_id: LocalDefId, body: hir.Body): void;
  // naked_functions.rs:30
  check_no_patterns(tcx: TyCtxt, params: readonly hir.Param[]): void;
  // naked_functions.rs:42
  check_no_parameters_use(tcx: TyCtxt, body: hir.Body): void;
  // naked_functions.rs:74
  check_asm(tcx: TyCtxt, def_id: LocalDefId, body: hir.Body): void;
}

/** The free fns of compiler/rustc_hir_typeck/src/op.rs (lane typeck-expr-a). */
export interface Fns_op {
  // op.rs:1169
  lang_item_for_binop(tcx: TyCtxt, op: Op): [Symbol, DefId | undefined];
  // op.rs:1208
  lang_item_for_unop(tcx: TyCtxt, op: ast.UnOp): [Symbol, DefId | undefined];
  // op.rs:1218
  contains_let_in_chain(expr: hir.Expr): boolean;
  // op.rs:1307
  deref_ty_if_possible(ty: Ty): Ty;
  // op.rs:1325
  is_builtin_binop(lhs: Ty, rhs: Ty, category: BinOpCategory): boolean;
}

/** The free fns of compiler/rustc_hir_typeck/src/pat.rs (lane typeck-pat-a|typeck-pat-b). */
export interface Fns_pat {
  // pat.rs:49
  is_number(text: string): boolean;
}

/** The free fns of compiler/rustc_hir_typeck/src/upvar.rs (lane typeck-upvar). */
export interface Fns_upvar {
  // upvar.rs:2094
  should_reborrow_from_env_of_parent_coroutine_closure(parent_capture: CapturedPlace, child_capture: CapturedPlace): boolean;
  // upvar.rs:2122
  restrict_repr_packed_field_ref_capture(place: Place, curr_borrow_kind: UpvarCapture): [Place, UpvarCapture];
  // upvar.rs:2153
  apply_capture_kind_on_capture_ty(tcx: TyCtxt, ty: Ty, capture_kind: UpvarCapture, region: Region): Ty;
  // upvar.rs:2166
  drop_location_span(tcx: TyCtxt, hir_id: HirId): Span | undefined;
  // upvar.rs:2317
  restrict_precision_for_drop_types(fcx: FnCtxt, place: Place, curr_mode: UpvarCapture): [Place, UpvarCapture];
  // upvar.rs:2343
  restrict_precision_for_unsafe(place: Place, curr_mode: UpvarCapture): [Place, UpvarCapture];
  // upvar.rs:2378
  restrict_capture_precision(place: Place, curr_mode: UpvarCapture): [Place, UpvarCapture];
  // upvar.rs:2408
  adjust_for_move_closure(place: Place, kind: UpvarCapture): [Place, UpvarCapture];
  // upvar.rs:2423
  adjust_for_use_closure(place: Place, kind: UpvarCapture): [Place, UpvarCapture];
  // upvar.rs:2439
  adjust_for_non_move_closure(place: Place, kind: UpvarCapture): [Place, UpvarCapture];
  // upvar.rs:2469
  construct_place_string(tcx: TyCtxt, place: Place): string;
  // upvar.rs:2494
  construct_capture_kind_reason_string(tcx: TyCtxt, place: Place, capture_info: CaptureInfo): string;
  // upvar.rs:2510
  construct_path_string(tcx: TyCtxt, place: Place): string;
  // upvar.rs:2516
  construct_capture_info_string(tcx: TyCtxt, place: Place, capture_info: CaptureInfo): string;
  // upvar.rs:2531
  var_name(tcx: TyCtxt, var_hir_id: HirId): Symbol;
  // upvar.rs:2536
  should_do_rust_2021_incompatible_closure_captures_analysis(tcx: TyCtxt, closure_id: HirId): boolean;
  // upvar.rs:2550
  migration_suggestion_for_2229(tcx: TyCtxt, need_migrations: readonly NeededMigration[]): [string, string];
  // upvar.rs:2608
  determine_capture_info(capture_info_a: CaptureInfo, capture_info_b: CaptureInfo): CaptureInfo;
  // upvar.rs:2633
  truncate_place_to_len_and_update_capture_kind(place: Place, curr_mode: MutRef<UpvarCapture>, len: number): void;
  // upvar.rs:2668
  determine_place_ancestry_relation(place_a: Place, place_b: Place): PlaceAncestryRelation;
  // upvar.rs:2730
  truncate_capture_for_optimization(place: Place, curr_mode: UpvarCapture): [Place, UpvarCapture];
  // upvar.rs:2754
  enable_precise_capture(span: Span): boolean;
}

// ======================================================================================================================
// Comment-only declarations: the methods of single-file helper types (visitors, folders, diagnostics structs, enums
// whose methods one file uses), trait impls (`impl Visitor`, `impl TypeFolder`, `impl Diagnostic`, the
// `HirTyLowerer` / `TypeInformationCtxt` vtables of FnCtxt, ...) and nested fns. The owning lane picks the TS form
// (prototype methods with a `declare module` in its own file, a class implementing the trait interface, a module-local
// fn); the signature here is the recommended one.
// ======================================================================================================================
// ---- compiler/rustc_hir_typeck/src/cast.rs ----
// cast.rs:207 (CastError(From), static)
// from(err: ErrorGuaranteed): CastError;
// ---- compiler/rustc_hir_typeck/src/closure.rs ----
// closure.rs:379 (MentionsTy(TypeVisitor))
// visit_ty(t: Ty): unknown /* Self::Result */;
// ---- compiler/rustc_hir_typeck/src/coercion.rs ----
// coercion.rs:2172 (CoerceVisitor(ProofTreeVisitor))
// span(): Span;
// coercion.rs:2176 (CoerceVisitor(ProofTreeVisitor))
// visit_goal(goal: InspectGoal): unknown /* Self::Result */;
// coercion.rs:2227 (CoerceVisitor(ProofTreeVisitor))
// on_recursion_limit(): unknown /* Self::Result */;
// ---- compiler/rustc_hir_typeck/src/demand.rs ----
// demand.rs:323 (FindExprs(Visitor))
// visit_expr(ex: hir.Expr): void;
// demand.rs:658 (FindBreaks(Visitor))
// visit_expr(ex: hir.Expr): void;
// ---- compiler/rustc_hir_typeck/src/diagnostics.rs ----
// diagnostics.rs:99 (ReturnLikeStatementKind(IntoDiagArg))
// into_diag_arg(_0: PathBuf | undefined): DiagArgValue;
// diagnostics.rs:278 (SuggestAnnotations(Subdiagnostic))
// add_to_diag(diag: Diag): void;
// diagnostics.rs:341 (TypeMismatchFruTypo(Subdiagnostic))
// add_to_diag(diag: Diag): void;
// diagnostics.rs:403 (HelpUseLatestEdition, static)
// new(): HelpUseLatestEdition;
// diagnostics.rs:564 (RemoveSemiForCoerce(Subdiagnostic))
// add_to_diag(diag: Diag): void;
// diagnostics.rs:741 (BreakNonLoop(Diagnostic))
// into_diag(dcx: DiagCtxtHandle, level: Level): Diag;
// diagnostics.rs:941 (CastUnknownPointerSub(Subdiagnostic))
// add_to_diag(diag: Diag): void;
// diagnostics.rs:1239 (NakedFunctionsAsmBlock(Diagnostic))
// into_diag(dcx: DiagCtxtHandle, level: Level): Diag;
// diagnostics.rs:1368 (ExprParenthesesNeeded, static)
// surrounding(s: Span): ExprParenthesesNeeded;
// ---- compiler/rustc_hir_typeck/src/expr_use_visitor.rs ----
// expr_use_visitor.rs:48 (trait)
// consume(place_with_id: PlaceWithHirId, diag_expr_id: HirId): void;
// expr_use_visitor.rs:63 (trait)
// use_cloned(place_with_id: PlaceWithHirId, diag_expr_id: HirId): void;
// expr_use_visitor.rs:67 (trait)
// borrow(place_with_id: PlaceWithHirId, diag_expr_id: HirId, bk: BorrowKind): void;
// expr_use_visitor.rs:80 (trait)
// copy(place_with_id: PlaceWithHirId, diag_expr_id: HirId): void;
// expr_use_visitor.rs:88 (trait)
// mutate(assignee_place: PlaceWithHirId, diag_expr_id: HirId): void;
// expr_use_visitor.rs:93 (trait)
// bind(binding_place: PlaceWithHirId, diag_expr_id: HirId): void;
// expr_use_visitor.rs:100 (trait)
// fake_read(place_with_id: PlaceWithHirId, cause: FakeReadCause, diag_expr_id: HirId): void;
// expr_use_visitor.rs:109 (D(Delegate))
// consume(place_with_id: PlaceWithHirId, diag_expr_id: HirId): void;
// expr_use_visitor.rs:113 (D(Delegate))
// use_cloned(place_with_id: PlaceWithHirId, diag_expr_id: HirId): void;
// expr_use_visitor.rs:117 (D(Delegate))
// borrow(place_with_id: PlaceWithHirId, diag_expr_id: HirId, bk: BorrowKind): void;
// expr_use_visitor.rs:126 (D(Delegate))
// copy(place_with_id: PlaceWithHirId, diag_expr_id: HirId): void;
// expr_use_visitor.rs:130 (D(Delegate))
// mutate(assignee_place: PlaceWithHirId, diag_expr_id: HirId): void;
// expr_use_visitor.rs:134 (D(Delegate))
// bind(binding_place: PlaceWithHirId, diag_expr_id: HirId): void;
// expr_use_visitor.rs:138 (D(Delegate))
// fake_read(place_with_id: PlaceWithHirId, cause: FakeReadCause, diag_expr_id: HirId): void;
// expr_use_visitor.rs:157 (trait)
// typeck_results(): unknown /* Self::TypeckResults */;
// expr_use_visitor.rs:159 (trait)
// deeply_resolve_ignoring_regions<T>(t: T, d_T: TypeFoldable<T>): T;
// expr_use_visitor.rs:161 (trait)
// structurally_resolve_type(span: Span, ty: Ty): Ty;
// expr_use_visitor.rs:163 (trait)
// report_bug(span: Span, msg: string): unknown /* Self::Error */;
// expr_use_visitor.rs:165 (trait)
// error_reported_in_ty(ty: Ty): Result<undefined, unknown /* Self::Error */>;
// expr_use_visitor.rs:167 (trait)
// tainted_by_errors(): Result<undefined, unknown /* Self::Error */>;
// expr_use_visitor.rs:169 (trait)
// type_is_copy_modulo_regions(ty: Ty): boolean;
// expr_use_visitor.rs:171 (trait)
// type_is_use_cloned_modulo_regions(ty: Ty): boolean;
// expr_use_visitor.rs:173 (trait)
// body_owner_def_id(): LocalDefId;
// expr_use_visitor.rs:175 (trait)
// tcx(): TyCtxt;
// expr_use_visitor.rs:186 (FnCtxt(TypeInformationCtxt))
// typeck_results(): unknown /* Self::TypeckResults */;
// expr_use_visitor.rs:190 (FnCtxt(TypeInformationCtxt))
// deeply_resolve_ignoring_regions<T>(t: T, d_T: TypeFoldable<T>): T;
// expr_use_visitor.rs:194 (FnCtxt(TypeInformationCtxt))
// structurally_resolve_type(sp: Span, ty: Ty): Ty;
// expr_use_visitor.rs:198 (FnCtxt(TypeInformationCtxt))
// report_bug(span: Span, msg: string): unknown /* Self::Error */;
// expr_use_visitor.rs:202 (FnCtxt(TypeInformationCtxt))
// error_reported_in_ty(ty: Ty): Result<undefined, unknown /* Self::Error */>;
// expr_use_visitor.rs:206 (FnCtxt(TypeInformationCtxt))
// tainted_by_errors(): Result<undefined, ErrorGuaranteed>;
// expr_use_visitor.rs:210 (FnCtxt(TypeInformationCtxt))
// type_is_copy_modulo_regions(ty: Ty): boolean;
// expr_use_visitor.rs:214 (FnCtxt(TypeInformationCtxt))
// type_is_use_cloned_modulo_regions(ty: Ty): boolean;
// expr_use_visitor.rs:218 (FnCtxt(TypeInformationCtxt))
// body_owner_def_id(): LocalDefId;
// expr_use_visitor.rs:222 (FnCtxt(TypeInformationCtxt))
// tcx(): TyCtxt;
// expr_use_visitor.rs:235 ((& LateContext < 'tcx > , LocalDefId)(TypeInformationCtxt))
// typeck_results(): unknown /* Self::TypeckResults */;
// expr_use_visitor.rs:239 ((& LateContext < 'tcx > , LocalDefId)(TypeInformationCtxt))
// structurally_resolve_type(_span: Span, ty: Ty): Ty;
// expr_use_visitor.rs:244 ((& LateContext < 'tcx > , LocalDefId)(TypeInformationCtxt))
// deeply_resolve_ignoring_regions<T>(t: T, d_T: TypeFoldable<T>): T;
// expr_use_visitor.rs:248 ((& LateContext < 'tcx > , LocalDefId)(TypeInformationCtxt))
// report_bug(span: Span, msg: string): never;
// expr_use_visitor.rs:252 ((& LateContext < 'tcx > , LocalDefId)(TypeInformationCtxt))
// error_reported_in_ty(_ty: Ty): Result<undefined, never>;
// expr_use_visitor.rs:256 ((& LateContext < 'tcx > , LocalDefId)(TypeInformationCtxt))
// tainted_by_errors(): Result<undefined, never>;
// expr_use_visitor.rs:260 ((& LateContext < 'tcx > , LocalDefId)(TypeInformationCtxt))
// type_is_copy_modulo_regions(ty: Ty): boolean;
// expr_use_visitor.rs:264 ((& LateContext < 'tcx > , LocalDefId)(TypeInformationCtxt))
// type_is_use_cloned_modulo_regions(ty: Ty): boolean;
// expr_use_visitor.rs:268 ((& LateContext < 'tcx > , LocalDefId)(TypeInformationCtxt))
// body_owner_def_id(): LocalDefId;
// expr_use_visitor.rs:272 ((& LateContext < 'tcx > , LocalDefId)(TypeInformationCtxt))
// tcx(): TyCtxt;
// expr_use_visitor.rs:992 (nested fn)
// upvar_is_local_variable(upvars: Map<HirId, hir.Upvar> | undefined, upvar_id: HirId, body_owner_is_closure: boolean): boolean;
// expr_use_visitor.rs:1865 (ExprPlaceDelegate(Delegate))
// consume(_0: PlaceWithHirId, _1: HirId): void;
// expr_use_visitor.rs:1867 (ExprPlaceDelegate(Delegate))
// use_cloned(_0: PlaceWithHirId, _1: HirId): void;
// expr_use_visitor.rs:1869 (ExprPlaceDelegate(Delegate))
// borrow(_0: PlaceWithHirId, _1: HirId, _2: BorrowKind): void;
// expr_use_visitor.rs:1871 (ExprPlaceDelegate(Delegate))
// mutate(_0: PlaceWithHirId, _1: HirId): void;
// expr_use_visitor.rs:1873 (ExprPlaceDelegate(Delegate))
// fake_read(_0: PlaceWithHirId, _1: FakeReadCause, _2: HirId): void;
// ---- compiler/rustc_hir_typeck/src/fallback.rs ----
// fallback.rs:364 (AnnotateUnitFallbackVisitor)
// suggest_for_segment(arg_segment: hir.PathSegment, def_id: DefId, id: HirId): ControlFlow<SuggestAnnotation>;
// fallback.rs:401 (AnnotateUnitFallbackVisitor(Visitor))
// visit_infer(inf_id: HirId, inf_span: Span, _kind: InferKind): unknown /* Self::Result */;
// fallback.rs:419 (AnnotateUnitFallbackVisitor(Visitor))
// visit_qpath(qpath: hir.QPath, id: HirId, span: Span): unknown /* Self::Result */;
// fallback.rs:440 (AnnotateUnitFallbackVisitor(Visitor))
// visit_expr(expr: hir.Expr): unknown /* Self::Result */;
// fallback.rs:475 (AnnotateUnitFallbackVisitor(Visitor))
// visit_local(local: hir.LetStmt): unknown /* Self::Result */;
// fallback.rs:530 (UnsafeInferVarsVisitor(Visitor))
// visit_expr(ex: hir.Expr): void;
// fallback.rs:638 (InferVarCollector(TypeVisitor))
// visit_ty(t: Ty): void;
// ---- compiler/rustc_hir_typeck/src/fn_ctxt/_impl.rs ----
// fn_ctxt/_impl.rs:61 (UnreachableItem(Diagnostic))
// into_diag(dcx: DiagCtxtHandle, level: Level): Diag;
// fn_ctxt/_impl.rs:567 (CollectClauses(Visitor))
// visit_ty(ty: hir.Ty<hir.AmbigArg>): void;
// fn_ctxt/_impl.rs:1338 (CtorGenericArgsCtxt(GenericArgsLowerer))
// args_for_def_id(def_id: DefId): [hir.GenericArgs | undefined, boolean];
// fn_ctxt/_impl.rs:1359 (CtorGenericArgsCtxt(GenericArgsLowerer))
// provided_kind(preceding_args: readonly GenericArg[], param: GenericParamDef, arg: GenericArg): GenericArg;
// fn_ctxt/_impl.rs:1397 (CtorGenericArgsCtxt(GenericArgsLowerer))
// inferred_kind(preceding_args: readonly GenericArg[], param: GenericParamDef, infer_args: boolean): GenericArg;
// ---- compiler/rustc_hir_typeck/src/fn_ctxt/adjust_fulfillment_errors.rs ----
// fn_ctxt/adjust_fulfillment_errors.rs:30 (ParamTerm)
// index(): number;
// fn_ctxt/adjust_fulfillment_errors.rs:584 (FindAmbiguousParameter(TypeVisitor))
// visit_ty(ty: Ty): unknown /* Self::Result */;
// ---- compiler/rustc_hir_typeck/src/fn_ctxt/arg_matrix.rs ----
// fn_ctxt/arg_matrix.rs:20 (ExpectedIdx)
// to_provided_idx(): ProvidedIdx;
// fn_ctxt/arg_matrix.rs:26 (ProvidedIdx)
// to_expected_idx(): ExpectedIdx;
// fn_ctxt/arg_matrix.rs:68 (Error(Ord))
// cmp(other: ArgMatrixError): Ordering;
// fn_ctxt/arg_matrix.rs:90 (Error(PartialOrd))
// partial_cmp(other: ArgMatrixError): Ordering | undefined;
// fn_ctxt/arg_matrix.rs:109 (ArgMatrix, static)
// new(provided_count: number, expected_input_count: number, is_compatible: (_1: ProvidedIdx, _2: ExpectedIdx) => Compatibility): ArgMatrix;
// fn_ctxt/arg_matrix.rs:129 (ArgMatrix)
// eliminate_provided(idx: number): void;
// fn_ctxt/arg_matrix.rs:135 (ArgMatrix)
// eliminate_expected(idx: number): void;
// fn_ctxt/arg_matrix.rs:143 (ArgMatrix)
// satisfy_input(provided_idx: number, expected_idx: number): void;
// fn_ctxt/arg_matrix.rs:150 (ArgMatrix)
// eliminate_satisfied(): [ProvidedIdx, ExpectedIdx][];
// fn_ctxt/arg_matrix.rs:163 (ArgMatrix)
// find_issue(): Issue | undefined;
// fn_ctxt/arg_matrix.rs:317 (ArgMatrix)
// find_errors(): [ArgMatrixError[], (ProvidedIdx | undefined)[]];
// ---- compiler/rustc_hir_typeck/src/fn_ctxt/checks.rs ----
// fn_ctxt/checks.rs:500 (nested fn)
// variadic_error(sess: Session, span: Span, ty: Ty, cast_ty: string): void;
// fn_ctxt/checks.rs:1570 (OverwritePatternsWithError(Visitor))
// visit_pat(p: hir.Pat): void;
// fn_ctxt/checks.rs:2180 (FindClosureArg(Visitor))
// maybe_tcx(): unknown /* Self::MaybeTyCtxt */;
// fn_ctxt/checks.rs:2184 (FindClosureArg(Visitor))
// visit_expr(ex: hir.Expr): void;
// fn_ctxt/checks.rs:2199 (FnParam)
// span(): Span;
// fn_ctxt/checks.rs:2212 (FnParam)
// display(idx: number): string;
// fn_ctxt/checks.rs:2215 (D(Display))
// fmt(f: Fmt): Result<undefined, ErrorGuaranteed>;
// fn_ctxt/checks.rs:2615 (nested fn)
// has_error_or_infer(tys: Iterable<Ty>): boolean;
// fn_ctxt/checks.rs:3620 (SameModuloVars(TypeRelation))
// cx(): TyCtxt;
// fn_ctxt/checks.rs:3624 (SameModuloVars(TypeRelation))
// relate_ty_args(a_ty: Ty, _b_ty: Ty, _ty_def_id: DefId, a_args: GenericArgs, b_args: GenericArgs, _mk: (_1: GenericArgs) => Ty): RelateResult<Ty>;
// fn_ctxt/checks.rs:3637 (SameModuloVars(TypeRelation))
// relate_with_variance<T>(_variance: Variance, _info: VarianceDiagInfo<TyCtxt>, a: T, b: T, d_T: Relate<T>): RelateResult<T>;
// fn_ctxt/checks.rs:3647 (SameModuloVars(TypeRelation))
// tys(a: Ty, b: Ty): RelateResult<Ty>;
// fn_ctxt/checks.rs:3662 (SameModuloVars(TypeRelation))
// regions(a: Region, _b: Region): RelateResult<Region>;
// fn_ctxt/checks.rs:3670 (SameModuloVars(TypeRelation))
// consts(a: Const, b: Const): RelateResult<Const>;
// fn_ctxt/checks.rs:3697 (SameModuloVars(TypeRelation))
// binders<T>(a: Binder<T>, b: Binder<T>, d_T: Relate<T>): RelateResult<Binder<T>>;
// ---- compiler/rustc_hir_typeck/src/fn_ctxt/inspect_obligations.rs ----
// fn_ctxt/inspect_obligations.rs:229 (NestedObligationsForSelfTy(ProofTreeVisitor))
// span(): Span;
// fn_ctxt/inspect_obligations.rs:233 (NestedObligationsForSelfTy(ProofTreeVisitor))
// config(): InspectConfig;
// fn_ctxt/inspect_obligations.rs:237 (NestedObligationsForSelfTy(ProofTreeVisitor))
// visit_goal(inspect_goal: InspectGoal): void;
// fn_ctxt/inspect_obligations.rs:285 (FindFromFloatForF32RootVids(ProofTreeVisitor))
// span(): Span;
// fn_ctxt/inspect_obligations.rs:289 (FindFromFloatForF32RootVids(ProofTreeVisitor))
// config(): InspectConfig;
// fn_ctxt/inspect_obligations.rs:293 (FindFromFloatForF32RootVids(ProofTreeVisitor))
// visit_goal(inspect_goal: InspectGoal): void;
// ---- compiler/rustc_hir_typeck/src/fn_ctxt/mod.rs ----
// fn_ctxt/mod.rs:221 (FnCtxt(PpAnn))
// nested(state: State, nested: Nested): void;
// fn_ctxt/mod.rs:231 (FnCtxt(HirTyLowerer))
// tcx(): TyCtxt;
// fn_ctxt/mod.rs:235 (FnCtxt(HirTyLowerer))
// dcx(): DiagCtxtHandle;
// fn_ctxt/mod.rs:239 (FnCtxt(HirTyLowerer))
// item_def_id(): LocalDefId;
// fn_ctxt/mod.rs:243 (FnCtxt(HirTyLowerer))
// mod_id(): LocalModId;
// fn_ctxt/mod.rs:247 (FnCtxt(HirTyLowerer))
// re_infer(span: Span, reason: RegionInferReason): Region;
// fn_ctxt/mod.rs:257 (FnCtxt(HirTyLowerer))
// ty_infer(param: GenericParamDef | undefined, span: Span): Ty;
// fn_ctxt/mod.rs:264 (FnCtxt(HirTyLowerer))
// ct_infer(param: GenericParamDef | undefined, span: Span): Const;
// fn_ctxt/mod.rs:272 (FnCtxt(HirTyLowerer))
// register_trait_ascription_bounds(bounds: [Clause, Span][], hir_id: HirId, _span: Span): void;
// fn_ctxt/mod.rs:296 (FnCtxt(HirTyLowerer))
// probe_ty_param_bounds(_0: Span, def_id: LocalDefId, _2: Ident): EarlyBinder<readonly [Clause, Span][]>;
// fn_ctxt/mod.rs:319 (FnCtxt(HirTyLowerer))
// select_inherent_assoc_candidates(span: Span, self_ty: Ty, candidates: InherentAssocCandidate[]): [InherentAssocCandidate[], FulfillmentError[]];
// fn_ctxt/mod.rs:384 (FnCtxt(HirTyLowerer))
// lower_assoc_item_path(span: Span, item_def_id: DefId, item_segment: hir.PathSegment, poly_trait_ref: PolyTraitRef): Result<[DefId, GenericArgs], ErrorGuaranteed>;
// fn_ctxt/mod.rs:408 (FnCtxt(HirTyLowerer))
// probe_adt(span: Span, ty: Ty): AdtDef | undefined;
// fn_ctxt/mod.rs:425 (FnCtxt(HirTyLowerer))
// record_ty(hir_id: HirId, ty: Ty, span: Span): void;
// fn_ctxt/mod.rs:447 (FnCtxt(HirTyLowerer))
// infcx(): InferCtxt | undefined;
// fn_ctxt/mod.rs:451 (FnCtxt(HirTyLowerer))
// lower_fn_sig(decl: hir.FnDecl, _generics: hir.Generics | undefined, _hir_id: HirId, _hir_ty: hir.Ty | undefined): [Ty[], Ty];
// fn_ctxt/mod.rs:467 (FnCtxt(HirTyLowerer))
// dyn_compatibility_violations(trait_def_id: DefId): DynCompatibilityViolation[];
// ---- compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs ----
// fn_ctxt/suggestions.rs:1419 (nested fn)
// is_in_arm(expr: hir.Expr, tcx: TyCtxt): boolean;
// ---- compiler/rustc_hir_typeck/src/gather_locals.rs ----
// gather_locals.rs:24 (DeclOrigin)
// try_get_else(): hir.Block | undefined;
// gather_locals.rs:45 (Declaration(From), static)
// from(local: hir.LetStmt): Declaration;
// gather_locals.rs:52 (Declaration(From), static)
// from(_0: [hir.LetExpr, HirId]): Declaration;
// gather_locals.rs:170 (GatherLocalsVisitor(Visitor))
// visit_local(local: hir.LetStmt): void;
// gather_locals.rs:175 (GatherLocalsVisitor(Visitor))
// visit_expr(expr: hir.Expr): void;
// gather_locals.rs:183 (GatherLocalsVisitor(Visitor))
// visit_pat(p: hir.Pat): void;
// gather_locals.rs:231 (GatherLocalsVisitor(Visitor))
// visit_fn(_0: FnKind, _1: hir.FnDecl, _2: hir.BodyId, _3: Span, _4: LocalDefId): void;
// ---- compiler/rustc_hir_typeck/src/inline_asm.rs ----
// inline_asm.rs:38 (InlineAsmCtxt, static)
// new(fcx: FnCtxt, def_id: LocalDefId): InlineAsmCtxt;
// inline_asm.rs:42 (InlineAsmCtxt)
// tcx(): TyCtxt;
// inline_asm.rs:46 (InlineAsmCtxt)
// expr_ty(expr: hir.Expr): Ty;
// inline_asm.rs:57 (InlineAsmCtxt)
// is_thin_ptr_ty(ty: Ty): boolean;
// inline_asm.rs:71 (InlineAsmCtxt)
// get_asm_ty(span: Span, ty: Ty): Result<InlineAsmType, NonAsmTypeReason>;
// inline_asm.rs:190 (InlineAsmCtxt)
// check_asm_operand_type(idx: number, reg: hir.InlineAsmRegOrRegClass, expr: hir.Expr, template: readonly InlineAsmTemplatePiece[], is_input: boolean, tied_input: [hir.Expr, InlineAsmType | undefined] | undefined): InlineAsmType | undefined;
// inline_asm.rs:211 (FormattingSubRegisterArg(Diagnostic))
// into_diag(dcx: DiagCtxtHandle, level: Level): Diag;
// inline_asm.rs:223 (nested fn)
// format_size(size: InlineAsmSize): string;
// inline_asm.rs:459 (InlineAsmCtxt)
// check_asm(asm: hir.InlineAsm): void;
// ---- compiler/rustc_hir_typeck/src/loops.rs ----
// loops.rs:66 (BreakContextKind(Display))
// fmt(f: Fmt): Result<undefined, ErrorGuaranteed>;
// loops.rs:100 (CheckLoopVisitor(Visitor))
// maybe_tcx(): unknown /* Self::MaybeTyCtxt */;
// loops.rs:104 (CheckLoopVisitor(Visitor))
// visit_anon_const(_0: hir.AnonConst): void;
// loops.rs:108 (CheckLoopVisitor(Visitor))
// visit_inline_const(c: hir.ConstBlock): void;
// loops.rs:112 (CheckLoopVisitor(Visitor))
// visit_expr(e: hir.Expr): void;
// loops.rs:334 (CheckLoopVisitor)
// with_context(cx: LoopsContext, f: (_1: CheckLoopVisitor) => void): void;
// loops.rs:343 (CheckLoopVisitor)
// require_break_cx(br_cx_kind: BreakContextKind, span: Span, break_span: Span, cx_pos: number): void;
// loops.rs:405 (CheckLoopVisitor)
// require_label_in_labeled_block(span: Span, label: hir.Destination, cf_type: string): boolean;
// loops.rs:421 (CheckLoopVisitor)
// report_outside_loop_error(): void;
// loops.rs:438 (CheckLoopVisitor)
// is_loop_match(e: hir.Expr, body: hir.Block): hir.Destination | undefined;
// ---- compiler/rustc_hir_typeck/src/method/confirm.rs ----
// method/confirm.rs:437 (GenericArgsCtxt(GenericArgsLowerer))
// args_for_def_id(def_id: DefId): [hir.GenericArgs | undefined, boolean];
// method/confirm.rs:449 (GenericArgsCtxt(GenericArgsLowerer))
// provided_kind(preceding_args: readonly GenericArg[], param: GenericParamDef, arg: hir.GenericArg): GenericArg;
// method/confirm.rs:490 (GenericArgsCtxt(GenericArgsLowerer))
// inferred_kind(_preceding_args: readonly GenericArg[], param: GenericParamDef, _infer_args: boolean): GenericArg;
// ---- compiler/rustc_hir_typeck/src/method/prelude_edition_lints.rs ----
// method/prelude_edition_lints.rs:28 (AmbiguousTraitMethodCall(Diagnostic))
// into_diag(dcx: DiagCtxtHandle, level: Level): Diag;
// method/prelude_edition_lints.rs:95 (AmbiguousTraitMethod(Diagnostic))
// into_diag(dcx: DiagCtxtHandle, level: Level): Diag;
// method/prelude_edition_lints.rs:293 (AmbiguousTraitAssocFunc(Diagnostic))
// into_diag(dcx: DiagCtxtHandle, level: Level): Diag;
// ---- compiler/rustc_hir_typeck/src/method/probe.rs ----
// method/probe.rs:163 (AutorefOrPtrAdjustment)
// get_unsize(): boolean;
// method/probe.rs:197 (PickConstraintsForShadowed)
// may_shadow_based_on_autoderefs(autoderefs: number): boolean;
// method/probe.rs:201 (PickConstraintsForShadowed)
// candidate_may_shadow(candidate: Candidate): boolean;
// method/probe.rs:1880 (ItemMaybeBeAddedToStd(Diagnostic))
// into_diag(dcx: DiagCtxtHandle, level: Level): Diag;
// method/probe.rs:2719 (Candidate)
// to_unadjusted_pick(self_ty: Ty, unstable_candidates: [Candidate, Symbol][]): Pick;
// ---- compiler/rustc_hir_typeck/src/method/suggest.rs ----
// method/suggest.rs:64 (TraitBoundDuplicateTracker, static)
// new(): TraitBoundDuplicateTracker;
// method/suggest.rs:74 (TraitBoundDuplicateTracker)
// track(def_id: DefId, is_ref: boolean): void;
// method/suggest.rs:89 (TraitBoundDuplicateTracker)
// has_ref_dupes(): boolean;
// method/suggest.rs:93 (TraitBoundDuplicateTracker)
// into_trait_def_ids(): Set<DefId>;
// method/suggest.rs:111 (nested fn)
// predicate_bounds_generic_param(predicate: Predicate, generics: Generics, generic_param: GenericParamDef, tcx: TyCtxt): boolean;
// method/suggest.rs:628 (LetVisitor)
// is_sub_scope(sub_id: ItemLocalId, super_id: ItemLocalId): boolean;
// method/suggest.rs:641 (LetVisitor)
// check_and_add_sugg_binding(binding: hir.LetStmt): boolean;
// method/suggest.rs:693 (LetVisitor(Visitor))
// visit_stmt(ex: hir.Stmt): unknown /* Self::Result */;
// method/suggest.rs:717 (LetVisitor(Visitor))
// visit_pat(p: hir.Pat): unknown /* Self::Result */;
// method/suggest.rs:3150 (LetVisitor(Visitor))
// visit_stmt(ex: hir.Stmt): unknown /* Self::Result */;
// method/suggest.rs:4908 (nested fn)
// is_local(ty: Ty): boolean;
// ---- compiler/rustc_hir_typeck/src/naked_functions.rs ----
// naked_functions.rs:58 (CheckParameters(Visitor))
// visit_expr(expr: hir.Expr): void;
// naked_functions.rs:131 (CheckInlineAssembly)
// check_expr(expr: hir.Expr, span: Span): void;
// naked_functions.rs:191 (CheckInlineAssembly(Visitor))
// visit_stmt(stmt: hir.Stmt): void;
// naked_functions.rs:203 (CheckInlineAssembly(Visitor))
// visit_expr(expr: hir.Expr): void;
// ---- compiler/rustc_hir_typeck/src/op.rs ----
// op.rs:1253 (BinOpCategory(From), static)
// from(op: BinOpKind): BinOpCategory;
// op.rs:1266 (BinOpCategory(From), static)
// from(op: AssignOpKind): BinOpCategory;
// op.rs:1284 (Op)
// span(): Span;
// op.rs:1291 (Op)
// as_str(): string;
// op.rs:1298 (Op)
// is_by_value(): boolean;
// ---- compiler/rustc_hir_typeck/src/opaque_types.rs ----
// opaque_types.rs:67 (UsageKind)
// merge(other: UsageKind): void;
// ---- compiler/rustc_hir_typeck/src/pat.rs ----
// pat.rs:192 (AdjustMode, static)
// peel_until_adt(opt_adt_def: DefId | undefined): AdjustMode;
// pat.rs:195 (AdjustMode, static)
// peel_all(): AdjustMode;
// pat.rs:229 (MutblCap)
// cap_to_weakly_not(span: Span | undefined): MutblCap;
// pat.rs:237 (MutblCap)
// as_mutbl(): Mutability;
// pat.rs:313 (ResolvedPat)
// adjust_mode(): AdjustMode;
// pat.rs:2573 (FieldsNotListed(Diagnostic))
// into_diag(dcx: DiagCtxtHandle, level: Level): Diag;
// pat.rs:2586 (nested fn)
// joined_uncovered_patterns(witnesses: readonly Ident[]): string;
// ---- compiler/rustc_hir_typeck/src/upvar.rs ----
// upvar.rs:108 (HasNestedClosure(Visitor))
// visit_expr(expr: hir.Expr): void;
// upvar.rs:189 (MigrationWarningReason)
// migration_message(): string;
// upvar.rs:221 (InferBorrowKindVisitor(Visitor))
// visit_expr(expr: hir.Expr): void;
// upvar.rs:234 (InferBorrowKindVisitor(Visitor))
// visit_inline_const(c: hir.ConstBlock): void;
// upvar.rs:1017 (nested fn)
// is_field(p: Projection): boolean;
// upvar.rs:1090 (MigrationLint(Diagnostic))
// into_diag(dcx: DiagCtxtHandle, level: Level): Diag;
// upvar.rs:2216 (InferBorrowKind(Delegate))
// fake_read(place_with_id: PlaceWithHirId, cause: FakeReadCause, diag_expr_id: HirId): void;
// upvar.rs:2238 (InferBorrowKind(Delegate))
// consume(place_with_id: PlaceWithHirId, diag_expr_id: HirId): void;
// upvar.rs:2256 (InferBorrowKind(Delegate))
// use_cloned(place_with_id: PlaceWithHirId, diag_expr_id: HirId): void;
// upvar.rs:2274 (InferBorrowKind(Delegate))
// borrow(place_with_id: PlaceWithHirId, diag_expr_id: HirId, bk: BorrowKind): void;
// upvar.rs:2310 (InferBorrowKind(Delegate))
// mutate(assignee_place: PlaceWithHirId, diag_expr_id: HirId): void;
// ---- compiler/rustc_hir_typeck/src/writeback.rs ----
// writeback.rs:261 (WritebackCx(Visitor))
// visit_expr(e: hir.Expr): void;
// writeback.rs:289 (WritebackCx(Visitor))
// visit_inline_const(anon_const: hir.ConstBlock): void;
// writeback.rs:297 (WritebackCx(Visitor))
// visit_generic_param(p: hir.GenericParam): void;
// writeback.rs:310 (WritebackCx(Visitor))
// visit_block(b: hir.Block): void;
// writeback.rs:315 (WritebackCx(Visitor))
// visit_pat(p: hir.Pat): void;
// writeback.rs:338 (WritebackCx(Visitor))
// visit_pat_expr(expr: hir.PatExpr): void;
// writeback.rs:343 (WritebackCx(Visitor))
// visit_local(l: hir.LetStmt): void;
// writeback.rs:350 (WritebackCx(Visitor))
// visit_ty(hir_ty: hir.Ty<hir.AmbigArg>): void;
// writeback.rs:360 (WritebackCx(Visitor))
// visit_infer(inf_id: HirId, inf_span: Span, _kind: InferKind): unknown /* Self::Result */;
// writeback.rs:902 (trait)
// to_span(tcx: TyCtxt): Span;
// writeback.rs:906 (Span(Locatable))
// to_span(_0: TyCtxt): Span;
// writeback.rs:912 (HirId(Locatable))
// to_span(tcx: TyCtxt): Span;
// writeback.rs:928 (Resolver, static)
// new(fcx: FnCtxt, span: Locatable, body: hir.Body, should_normalize: boolean, nested_goals: Goal<Predicate>[]): Resolver;
// writeback.rs:938 (Resolver)
// report_error(p: Term): ErrorGuaranteed;
// writeback.rs:956 (Resolver)
// handle_term<T>(value: T, outer_exclusive_binder: (_1: T) => DebruijnIndex, new_err: (_1: TyCtxt, _2: ErrorGuaranteed) => T, d_T: TypeFoldable<T>): T;
// writeback.rs:1018 (Resolver(TypeFolder))
// cx(): TyCtxt;
// writeback.rs:1022 (Resolver(TypeFolder))
// fold_region(r: Region): Region;
// writeback.rs:1029 (Resolver(TypeFolder))
// fold_ty(ty: Ty): Ty;
// writeback.rs:1033 (Resolver(TypeFolder))
// fold_const(ct: Const): Const;
// writeback.rs:1037 (Resolver(TypeFolder))
// fold_predicate<P>(predicate: P): P;
// writeback.rs:1051 (EagerlyNormalizeConsts, static)
// new(fcx: FnCtxt): EagerlyNormalizeConsts;
// writeback.rs:1059 (EagerlyNormalizeConsts(TypeFolder))
// cx(): TyCtxt;
// writeback.rs:1063 (EagerlyNormalizeConsts(TypeFolder))
// fold_const(ct: Const): Const;
// writeback.rs:1080 (HasRecursiveOpaque(TypeVisitor))
// visit_ty(t: Ty): unknown /* Self::Result */;
