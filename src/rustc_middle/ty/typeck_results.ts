// Port of compiler/rustc_middle/src/ty/typeck_results.rs (lane ty-results, sub-lane ty-results-a).
//
// PORT notes (module-wide):
// - `ItemLocalMap<V>` / `ItemLocalSet` are `Map<ItemLocalId, V>` / `Set<ItemLocalId>`, `LocalDefIdMap<V>` and
//   `FxIndexMap<LocalDefId, V>` are `Map<LocalDefId, V>`, `UnordSet<LocalDefId>` is `Set<LocalDefId>` (PORTING §5).
// - Every private field of `TypeckResults` shares its name with an accessor method, so the private fields carry a
//   trailing `_` (`node_types_`); the public fields keep their names.
// - `UnordItems<T, I>` is an `Iterable<T>` (a generator); `into_sorted_stable_ord_by_key` sorts by the
//   `ItemLocalId` number (its `StableOrd`).
// - std's `hash_map::Entry` (`LocalTableInContextMut::entry`) is `HashMapEntry` below (no std port exists).
// - The derived `TyEncodable` / `TyDecodable` / `StableHash` / `TypeFoldable` / `TypeVisitable` impls of this file's
//   types are tools/codegen's (not hand-written; this file has no `.gen.ts` yet). `Lift for UserTypeKind` is skipped
//   (PORTING §3). The derived `Debug` impls written here are those a dump plausibly reaches (`UserTypeAnnotationIndex`,
//   `CanonicalUserTypeAnnotation`, `UserType`, `UserTypeKind`, through MIR / THIR dumps); `TypeckResults`,
//   `SplattedDef`, `LocalSetInContext(Mut)` and `Rust2024IncompatiblePatInfo` derive `Debug` only for `debug!` logs and
//   are not written (the `ItemLocalMap`/`ItemLocalSet` fields would print in FxHash order).
import type { Mutability } from "../../rustc_ast_ir/lib.ts";
import { type DefKind, Res } from "../../rustc_hir/def.ts";
import type { Expr, Pat, QPath } from "../../rustc_hir/hir.ts";
import { debug_HirId, debug_OwnerId, type HirId, type HirIdMap, type ItemLocalId, type OwnerId, OwnerId_eq } from "../../rustc_hir_id/lib.ts";
import type { BindingMode } from "../../rustc_ast/lib.ts";
import type { Session } from "../../rustc_session/session.ts";
import { debug_DefId, type DefId, type LocalDefId } from "../../rustc_span/def_id.ts";
import { debug_Span, type ErrorGuaranteed, type Span } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { debug_BoundVarIndexKind, BoundVarIndexKind } from "../../rustc_type_ir/binder.ts";
import { type Canonical, debug_Canonical } from "../../rustc_type_ir/canonical.ts";
import type { Pending, PendingEnum } from "../../rustc_type_ir/decls.ts";
import { BoundVar } from "../../rustc_type_ir/lib.ts";
import type { FnSig } from "../../rustc_type_ir/ty_kind.ts";
import { KeyedSet } from "../../rust_ts/keyed.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import { newtype_index } from "../../rustc_index/newtype_index.ts";
import { type Debug, debug_struct, debug_tuple, PLAIN } from "../../std/fmt.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { assert_eq, panic } from "../../std/panic.ts";
import type { Result } from "../../std/result.ts";
import { with_ } from "./context/tls.ts";
import type { Adjustment, PatAdjustment } from "./adjustment.gen.ts";
import type { CanonicalPolyFnSig, CapturedPlace, FieldIdx, HirPlace, ObligationCause, VariantIdx } from "./decls.ts";
import { GenericArg, type GenericArgs, type GenericArgsRef, type UserArgs, debug_UserArgs } from "./generic_args.ts";
import { type Clauses, debug_RawList, RawList } from "./list.ts";
import { debug_Ty, type Ty } from "./mod.ts";
import { type Clause, debug_Clause, type Predicate } from "./predicate.ts";

// PORT: pending types of other files (not ported yet), as `decls.ts`-style aliases (ty-contract "Pending types"):
/** `crate::mir::FakeReadCause` (mir/syntax.rs:509) */
export type FakeReadCause = PendingEnum<"mir::FakeReadCause">;
/** `crate::thir::DerefPatBorrowMode` (thir.rs:886): `Borrow(Mutability) | Box`, built per PORTING §5. */
export type DerefPatBorrowMode = PendingEnum<"thir::DerefPatBorrowMode">;
/** `ty::ClosureSizeProfileData` (ty/mod.rs:338) */
export type ClosureSizeProfileData = Pending<"ClosureSizeProfileData">;
/** `ty::DefinitionSiteHiddenType` (ty/mod.rs:949) */
export type DefinitionSiteHiddenType = Pending<"DefinitionSiteHiddenType">;
/** `ty::MinCaptureInformationMap` = `LocalDefIdMap<RootVariableMinCaptureList>`, `RootVariableMinCaptureList` =
 *  `FxIndexMap<HirId, MinCaptureList>`, `MinCaptureList` = `Vec<CapturedPlace>` (ty/closure.rs:80-91, type aliases). */
export type MinCaptureInformationMap = Map<LocalDefId, HirIdMap<CapturedPlace[]>>;

/** `rustc_hir::ItemLocalMap<V>` */
type ItemLocalMap<V> = Map<ItemLocalId, V>;
/** `rustc_hir::ItemLocalSet` */
type ItemLocalSet = Set<ItemLocalId>;

export class TypeckResults {
  constructor(
    /// The `HirId::owner` all `ItemLocalId`s in this table are relative to.
    public hir_owner: OwnerId,

    /// Resolved definitions for `<T>::X` associated paths and
    /// method calls, including those of overloaded operators.
    public type_dependent_defs_: ItemLocalMap<Result<[DefKind, DefId], ErrorGuaranteed>>,

    /// Resolved definitions for splatted function calls.
    public splatted_defs_: ItemLocalMap<Result<SplattedDef, ErrorGuaranteed>>,

    /// Resolved field indices for field accesses in expressions (`S { field }`, `obj.field`)
    /// or patterns (`S { field }`). The index is often useful by itself, but to learn more
    /// about the field you also need definition of the variant to which the field
    /// belongs, but it may not exist if it's a tuple field (`tuple.0`).
    public field_indices_: ItemLocalMap<FieldIdx>,

    /// Stores the types for various nodes in the AST. Note that this table
    /// is not guaranteed to be populated outside inference. See
    /// typeck::check::fn_ctxt for details.
    public node_types_: ItemLocalMap<Ty>,

    /// Stores the type parameters which were instantiated to obtain the type
    /// of this node. This only applies to nodes that refer to entities
    /// parameterized by type parameters, such as generic fns, types, or
    /// other items.
    public node_args_: ItemLocalMap<GenericArgsRef>,

    /// This will either store the canonicalized types provided by the user
    /// or the generic parameters that the user explicitly gave (if any) attached
    /// to `id`. These will not include any inferred values. The canonical form
    /// is used to capture things like `_` or other unspecified values.
    ///
    /// For example, if the user wrote `foo.collect::<Vec<_>>()`, then the
    /// canonical generic parameters would include only `for<X> { Vec<X> }`.
    ///
    /// See also `AscribeUserType` statement in MIR.
    public user_provided_types_: ItemLocalMap<CanonicalUserType>,

    /// Stores the canonicalized types provided by the user. See also
    /// `AscribeUserType` statement in MIR.
    public user_provided_sigs: Map<LocalDefId, CanonicalPolyFnSig>,

    public adjustments_: ItemLocalMap<Adjustment[]>,

    /// Stores the actual binding mode for all instances of [`BindingMode`].
    public pat_binding_modes_: ItemLocalMap<BindingMode>,

    /// Top-level patterns incompatible with Rust 2024's match ergonomics. These will be translated
    /// to a form valid in all Editions, either as a lint diagnostic or hard error.
    public rust_2024_migration_desugared_pats_: ItemLocalMap<Rust2024IncompatiblePatInfo>,

    /// Stores the types which were implicitly dereferenced in pattern binding modes or deref
    /// patterns for later usage in THIR lowering. For example,
    ///
    /// ```
    /// match &&Some(5i32) {
    ///     Some(n) => {},
    ///     _ => {},
    /// }
    /// ```
    /// leads to a `vec![&&Option<i32>, &Option<i32>]` and
    ///
    /// ```
    /// #![feature(deref_patterns)]
    /// match &Box::new(Some(5i32)) {
    ///     Some(n) => {},
    ///     _ => {},
    /// }
    /// ```
    /// leads to a `vec![&Box<Option<i32>>, Box<Option<i32>>]`. Empty vectors are not stored.
    ///
    /// See:
    /// <https://rust-lang.github.io/rfcs/2005-match-ergonomics.html#definitions>
    public pat_adjustments_: ItemLocalMap<PatAdjustment[]>,

    /// Set of reference patterns that match against a match-ergonomics inserted reference
    /// (as opposed to against a reference in the scrutinee type).
    public skipped_ref_pats_: ItemLocalSet,

    /// Records the reasons that we picked the kind of each closure;
    /// not all closures are present in the map.
    public closure_kind_origins_: ItemLocalMap<[Span, HirPlace]>,

    /// For each fn, records the "liberated" types of its arguments
    /// and return type. Liberated means that all bound regions
    /// (including late-bound regions) are replaced with free
    /// equivalents. This table is not used in codegen (since regions
    /// are erased there) and hence is not serialized to metadata.
    ///
    /// This table also contains the "revealed" values for any `impl Trait`
    /// that appear in the signature and whose values are being inferred
    /// by this function.
    ///
    /// # Example
    ///
    /// ```rust
    /// # use std::fmt::Debug;
    /// fn foo(x: &u32) -> impl Debug { *x }
    /// ```
    ///
    /// The function signature here would be:
    ///
    /// ```ignore (illustrative)
    /// for<'a> fn(&'a u32) -> Foo
    /// ```
    ///
    /// where `Foo` is an opaque type created for this function.
    ///
    ///
    /// The *liberated* form of this would be
    ///
    /// ```ignore (illustrative)
    /// fn(&'a u32) -> u32
    /// ```
    ///
    /// Note that `'a` is not bound (it would be an `ReLateParam`) and
    /// that the `Foo` opaque type is replaced by its hidden type.
    public liberated_fn_sigs_: ItemLocalMap<FnSig>,

    /// For each FRU expression, record the normalized types of the fields
    /// of the struct - this is needed because it is non-trivial to
    /// normalize while preserving regions. This table is used only in
    /// MIR construction and hence is not serialized to metadata.
    public fru_field_types_: ItemLocalMap<Ty[]>,

    /// For every coercion cast we add the HIR node ID of the cast
    /// expression to this set.
    public coercion_casts_: ItemLocalSet,

    /// Set of trait imports actually used in the method resolution.
    /// This is used for warning unused imports.
    public used_trait_imports: Set<LocalDefId>,

    /// If any errors occurred while type-checking this body,
    /// this field will be set to `Some(ErrorGuaranteed)`.
    public tainted_by_errors: ErrorGuaranteed | undefined,

    /// All the opaque types that have hidden types set by this function.
    /// We also store the type here, so that the compiler can use it as a hint
    /// for figuring out hidden types, even if they are only set in dead code
    /// (which doesn't show up in MIR).
    public hidden_types: Map<LocalDefId, DefinitionSiteHiddenType>,

    /// Tracks the minimum captures required for a closure;
    /// see `MinCaptureInformationMap` for more details.
    public closure_min_captures: MinCaptureInformationMap,

    /// Tracks the fake reads required for a closure and the reason for the fake read.
    /// When performing pattern matching for closures, there are times we don't end up
    /// reading places that are mentioned in a closure (because of _ patterns). However,
    /// to ensure the places are initialized, we introduce fake reads.
    /// Consider these two examples:
    /// ```ignore (discriminant matching with only wildcard arm)
    /// let x: u8;
    /// let c = || match x { _ => () };
    /// ```
    /// In this example, we don't need to actually read/borrow `x` in `c`, and so we don't
    /// want to capture it. However, we do still want an error here, because `x` should have
    /// to be initialized at the point where c is created. Therefore, we add a "fake read"
    /// instead.
    /// ```ignore (destructured assignments)
    /// let c = || {
    ///     let (t1, t2) = t;
    /// }
    /// ```
    /// In the second example, we capture the disjoint fields of `t` (`t.0` & `t.1`), but
    /// we never capture `t`. This becomes an issue when we build MIR as we require
    /// information on `t` in order to create place `t.0` and `t.1`. We can solve this
    /// issue by fake reading `t`.
    public closure_fake_reads: Map<LocalDefId, [HirPlace, FakeReadCause, HirId][]>,

    /// Stores the predicates that apply on coroutine witness types.
    /// formatting modified file tests/ui/coroutine/retain-resume-ref.rs
    public coroutine_stalled_predicates: KeyedSet<[Predicate, ObligationCause]>,

    /// Goals proven during HIR typeck which may be potentially region dependent.
    ///
    /// Borrowck *uniquifies* regions which may cause these goal to be ambiguous in MIR
    /// type check. We ICE if goals fail in borrowck to detect bugs during MIR building or
    /// missed checks in HIR typeck. To avoid ICE due to region dependence we store all
    /// goals which may be region dependent and reprove them in case borrowck encounters
    /// an error.
    public potentially_region_dependent_goals: KeyedSet<[Predicate, ObligationCause]>,

    /// Contains the data for evaluating the effect of feature `capture_disjoint_fields`
    /// on closure size.
    public closure_size_eval: Map<LocalDefId, ClosureSizeProfileData>,

    /// Stores the types involved in calls to `transmute` intrinsic. These are meant to be checked
    /// outside of typeck and borrowck to avoid cycles with opaque types and coroutine layout
    /// computation.
    public transmutes_to_check: [Ty, Ty, HirId][],

    /// Stores the types involved in calls to `offload` intrinsic.
    public offloads_to_check: [Ty, Ty, Ty, HirId][],

    /// Container types and field indices of `offset_of!` expressions
    public offset_of_data_: ItemLocalMap<[Ty, VariantIdx, FieldIdx][]>,
  ) {}

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:234 new
  static new(hir_owner: OwnerId): TypeckResults {
    return new TypeckResults(
      hir_owner,
      /* type_dependent_defs */ new Map(),
      /* splatted_defs */ new Map(),
      /* field_indices */ new Map(),
      /* node_types */ new Map(),
      /* node_args */ new Map(),
      /* user_provided_types */ new Map(),
      /* user_provided_sigs */ new Map(),
      /* adjustments */ new Map(),
      /* pat_binding_modes */ new Map(),
      /* rust_2024_migration_desugared_pats */ new Map(),
      /* pat_adjustments */ new Map(),
      /* skipped_ref_pats */ new Set(),
      /* closure_kind_origins */ new Map(),
      /* liberated_fn_sigs */ new Map(),
      /* fru_field_types */ new Map(),
      /* coercion_casts */ new Set(),
      /* used_trait_imports */ new Set(),
      /* tainted_by_errors */ undefined,
      /* hidden_types */ new Map(),
      /* closure_min_captures */ new Map(),
      /* closure_fake_reads */ new Map(),
      /* coroutine_stalled_predicates */ new KeyedSet(key_Predicate_ObligationCause),
      /* potentially_region_dependent_goals */ new KeyedSet(key_Predicate_ObligationCause),
      /* closure_size_eval */ new Map(),
      /* transmutes_to_check */ [],
      /* offloads_to_check */ [],
      /* offset_of_data */ new Map(),
    );
  }

  /// Returns the final resolution of a `QPath` in an `Expr` or `Pat` node.
  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:268 qpath_res
  qpath_res(qpath: QPath, id: HirId): Res {
    switch (qpath.$) {
      case "Resolved":
        return qpath._1.res;
      case "TypeRelative": {
        const r = this.type_dependent_def(id);
        return r === undefined ? Res.Err : { $: "Def", _0: r[0], _1: r[1] };
      }
    }
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:277 type_dependent_defs
  type_dependent_defs(): LocalTableInContext<Result<[DefKind, DefId], ErrorGuaranteed>> {
    return new LocalTableInContext(this.hir_owner, this.type_dependent_defs_);
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:283 type_dependent_def
  type_dependent_def(id: HirId): [DefKind, DefId] | undefined {
    validate_hir_id_for_typeck_results(this.hir_owner, id);
    const r = this.type_dependent_defs_.get(id.local_id);
    return r === undefined ? undefined : r.$ === "Ok" ? r._0 : undefined;
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:288 type_dependent_def_id
  type_dependent_def_id(id: HirId): DefId | undefined {
    const r = this.type_dependent_def(id);
    return r === undefined ? undefined : r[1];
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:292 type_dependent_defs_mut
  type_dependent_defs_mut(): LocalTableInContextMut<Result<[DefKind, DefId], ErrorGuaranteed>> {
    return new LocalTableInContextMut(this.hir_owner, this.type_dependent_defs_);
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:298 splatted_defs
  splatted_defs(): LocalTableInContext<Result<SplattedDef, ErrorGuaranteed>> {
    return new LocalTableInContext(this.hir_owner, this.splatted_defs_);
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:304 splatted_def
  splatted_def(id: HirId): SplattedDef | undefined {
    validate_hir_id_for_typeck_results(this.hir_owner, id);
    const r = this.splatted_defs_.get(id.local_id);
    return r === undefined ? undefined : r.$ === "Ok" ? r._0 : undefined;
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:309 splatted_defs_mut
  splatted_defs_mut(): LocalTableInContextMut<Result<SplattedDef, ErrorGuaranteed>> {
    return new LocalTableInContextMut(this.hir_owner, this.splatted_defs_);
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:315 field_indices
  field_indices(): LocalTableInContext<FieldIdx> {
    return new LocalTableInContext(this.hir_owner, this.field_indices_);
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:319 field_indices_mut
  field_indices_mut(): LocalTableInContextMut<FieldIdx> {
    return new LocalTableInContextMut(this.hir_owner, this.field_indices_);
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:323 field_index
  field_index(id: HirId): FieldIdx {
    const r = this.field_indices().get(id);
    if (r === undefined) panic("no index for a field");
    return r;
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:327 opt_field_index
  opt_field_index(id: HirId): FieldIdx | undefined {
    return this.field_indices().get(id);
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:331 user_provided_types
  user_provided_types(): LocalTableInContext<CanonicalUserType> {
    return new LocalTableInContext(this.hir_owner, this.user_provided_types_);
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:335 user_provided_types_mut
  user_provided_types_mut(): LocalTableInContextMut<CanonicalUserType> {
    return new LocalTableInContextMut(this.hir_owner, this.user_provided_types_);
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:341 node_types
  node_types(): LocalTableInContext<Ty> {
    return new LocalTableInContext(this.hir_owner, this.node_types_);
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:345 node_types_mut
  node_types_mut(): LocalTableInContextMut<Ty> {
    return new LocalTableInContextMut(this.hir_owner, this.node_types_);
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:349 node_type
  node_type(id: HirId): Ty {
    const r = this.node_type_opt(id);
    if (r === undefined) {
      bug(`node_type: no type for node ${with_((tcx) => tcx.hir_id_to_string(id))}`);
    }
    return r;
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:355 node_type_opt
  node_type_opt(id: HirId): Ty | undefined {
    validate_hir_id_for_typeck_results(this.hir_owner, id);
    return this.node_types_.get(id.local_id);
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:360 node_args_mut
  node_args_mut(): LocalTableInContextMut<GenericArgsRef> {
    return new LocalTableInContextMut(this.hir_owner, this.node_args_);
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:364 node_args
  node_args(id: HirId): GenericArgsRef {
    validate_hir_id_for_typeck_results(this.hir_owner, id);
    return this.node_args_.get(id.local_id) ?? RawList.empty<GenericArg>();
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:369 node_args_opt
  node_args_opt(id: HirId): GenericArgsRef | undefined {
    validate_hir_id_for_typeck_results(this.hir_owner, id);
    return this.node_args_.get(id.local_id);
  }

  /// Returns the type of a pattern as a monotype. Like [`expr_ty`], this function
  /// doesn't provide type parameter args.
  ///
  /// [`expr_ty`]: TypeckResults::expr_ty
  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:378 pat_ty
  pat_ty(pat: Pat): Ty {
    return this.node_type(pat.hir_id);
  }

  /// Returns the type of an expression as a monotype.
  ///
  /// NB (1): This is the PRE-ADJUSTMENT TYPE for the expression. That is, in
  /// some cases, we insert `Adjustment` annotations such as auto-deref or
  /// auto-ref. The type returned by this function does not consider such
  /// adjustments. See [`Self::expr_ty_adjusted`] instead.
  ///
  /// NB (2): This type doesn't provide type parameter args; e.g., if you
  /// ask for the type of `id` in `id(3)`, it will return `fn(&isize) -> isize`
  /// instead of `fn(ty) -> T with T = isize`.
  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:392 expr_ty
  expr_ty(expr: Expr): Ty {
    return this.node_type(expr.hir_id);
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:396 expr_ty_opt
  expr_ty_opt(expr: Expr): Ty | undefined {
    return this.node_type_opt(expr.hir_id);
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:400 adjustments
  adjustments(): LocalTableInContext<Adjustment[]> {
    return new LocalTableInContext(this.hir_owner, this.adjustments_);
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:404 adjustments_mut
  adjustments_mut(): LocalTableInContextMut<Adjustment[]> {
    return new LocalTableInContextMut(this.hir_owner, this.adjustments_);
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:410 expr_adjustments
  expr_adjustments(expr: Expr): readonly Adjustment[] {
    validate_hir_id_for_typeck_results(this.hir_owner, expr.hir_id);
    return this.adjustments_.get(expr.hir_id.local_id) ?? [];
  }

  /// Returns the type of `expr`, considering any `Adjustment`
  /// entry recorded for that expression.
  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:417 expr_ty_adjusted
  expr_ty_adjusted(expr: Expr): Ty {
    const adjustments = this.expr_adjustments(expr);
    const adj = adjustments[adjustments.length - 1];
    return adj === undefined ? this.expr_ty(expr) : adj.target;
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:421 expr_ty_adjusted_opt
  expr_ty_adjusted_opt(expr: Expr): Ty | undefined {
    const adjustments = this.expr_adjustments(expr);
    const adj = adjustments[adjustments.length - 1];
    return adj !== undefined ? adj.target : this.expr_ty_opt(expr);
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:425 is_method_call
  is_method_call(expr: Expr): boolean {
    // Only paths and method calls/overloaded operators have
    // entries in type_dependent_defs, ignore the former here.
    if (expr.kind.$ === "Path") {
      return false;
    }

    const r = this.type_dependent_defs().get(expr.hir_id);
    return r !== undefined && r.$ === "Ok" && r._0[0].$ === "AssocFn";
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:435 is_splatted_call
  is_splatted_call(expr: Expr): boolean {
    const r = this.splatted_defs().get(expr.hir_id);
    return r !== undefined && r.$ === "Ok";
  }

  /// Returns the computed binding mode for a `PatKind::Binding` pattern
  /// (after match ergonomics adjustments).
  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:441 extract_binding_mode
  extract_binding_mode(s: Session, id: HirId, sp: Span): BindingMode {
    const r = this.pat_binding_modes().get(id);
    if (r === undefined) {
      return s.dcx().span_bug(sp, "missing binding mode");
    }
    return r;
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:447 pat_binding_modes
  pat_binding_modes(): LocalTableInContext<BindingMode> {
    return new LocalTableInContext(this.hir_owner, this.pat_binding_modes_);
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:451 pat_binding_modes_mut
  pat_binding_modes_mut(): LocalTableInContextMut<BindingMode> {
    return new LocalTableInContextMut(this.hir_owner, this.pat_binding_modes_);
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:455 pat_adjustments
  pat_adjustments(): LocalTableInContext<PatAdjustment[]> {
    return new LocalTableInContext(this.hir_owner, this.pat_adjustments_);
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:461 pat_adjustments_mut
  pat_adjustments_mut(): LocalTableInContextMut<PatAdjustment[]> {
    return new LocalTableInContextMut(this.hir_owner, this.pat_adjustments_);
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:467 rust_2024_migration_desugared_pats
  rust_2024_migration_desugared_pats(): LocalTableInContext<Rust2024IncompatiblePatInfo> {
    return new LocalTableInContext(this.hir_owner, this.rust_2024_migration_desugared_pats_);
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:476 rust_2024_migration_desugared_pats_mut
  rust_2024_migration_desugared_pats_mut(): LocalTableInContextMut<Rust2024IncompatiblePatInfo> {
    return new LocalTableInContextMut(this.hir_owner, this.rust_2024_migration_desugared_pats_);
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:485 skipped_ref_pats
  skipped_ref_pats(): LocalSetInContext {
    return new LocalSetInContext(this.hir_owner, this.skipped_ref_pats_);
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:489 skipped_ref_pats_mut
  skipped_ref_pats_mut(): LocalSetInContextMut {
    return new LocalSetInContextMut(this.hir_owner, this.skipped_ref_pats_);
  }

  /// Does the pattern recursively contain a `ref mut` binding in it?
  ///
  /// This is used to determined whether a `deref` pattern should emit a `Deref`
  /// or `DerefMut` call for its pattern scrutinee.
  ///
  /// This is computed from the typeck results since we want to make
  /// sure to apply any match-ergonomics adjustments, which we cannot
  /// determine from the HIR alone.
  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:501 pat_has_ref_mut_binding
  pat_has_ref_mut_binding(pat: Pat): boolean {
    let has_ref_mut = false;
    pat.walk((pat) => {
      let bm: BindingMode | undefined;
      if (
        pat.kind.$ === "Binding" &&
        (bm = this.pat_binding_modes().get(pat.kind._1)) !== undefined &&
        bm._0.$ === "Yes" &&
        bm._0._1 === "Mut"
      ) {
        has_ref_mut = true;
        // No need to continue recursing
        return false;
      } else {
        return true;
      }
    });
    return has_ref_mut;
  }

  /// How should a deref pattern find the place for its inner pattern to match on?
  ///
  /// In most cases, if the pattern recursively contains a `ref mut` binding, we find the inner
  /// pattern's scrutinee by calling `DerefMut::deref_mut`, and otherwise we call `Deref::deref`.
  /// However, for boxes we can use a built-in deref instead, which doesn't borrow the scrutinee;
  /// in this case, we return `DerefPatBorrowMode::Box`.
  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:524 deref_pat_borrow_mode
  deref_pat_borrow_mode(pointer_ty: Ty, inner: Pat): DerefPatBorrowMode {
    if (pointer_ty.is_box()) {
      return { $: "Box" };
    } else {
      const mutability: Mutability = this.pat_has_ref_mut_binding(inner) ? "Mut" : "Not";
      return { $: "Borrow", _0: mutability };
    }
  }

  /// For a given closure, returns the iterator of `ty::CapturedPlace`s that are captured
  /// by the closure.
  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:540 closure_min_captures_flattened
  *closure_min_captures_flattened(closure_def_id: LocalDefId): Generator<CapturedPlace, void, undefined> {
    const closure_min_captures = this.closure_min_captures.get(closure_def_id);
    if (closure_min_captures !== undefined) {
      for (const min_capture_list of closure_min_captures.values()) yield* min_capture_list;
    }
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:551 closure_kind_origins
  closure_kind_origins(): LocalTableInContext<[Span, HirPlace]> {
    return new LocalTableInContext(this.hir_owner, this.closure_kind_origins_);
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:555 closure_kind_origins_mut
  closure_kind_origins_mut(): LocalTableInContextMut<[Span, HirPlace]> {
    return new LocalTableInContextMut(this.hir_owner, this.closure_kind_origins_);
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:561 liberated_fn_sigs
  liberated_fn_sigs(): LocalTableInContext<FnSig> {
    return new LocalTableInContext(this.hir_owner, this.liberated_fn_sigs_);
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:565 liberated_fn_sigs_mut
  liberated_fn_sigs_mut(): LocalTableInContextMut<FnSig> {
    return new LocalTableInContextMut(this.hir_owner, this.liberated_fn_sigs_);
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:569 fru_field_types
  fru_field_types(): LocalTableInContext<Ty[]> {
    return new LocalTableInContext(this.hir_owner, this.fru_field_types_);
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:573 fru_field_types_mut
  fru_field_types_mut(): LocalTableInContextMut<Ty[]> {
    return new LocalTableInContextMut(this.hir_owner, this.fru_field_types_);
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:577 is_coercion_cast
  is_coercion_cast(hir_id: HirId): boolean {
    validate_hir_id_for_typeck_results(this.hir_owner, hir_id);
    return this.coercion_casts_.has(hir_id.local_id);
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:582 set_coercion_cast
  set_coercion_cast(id: ItemLocalId): void {
    this.coercion_casts_.add(id);
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:586 coercion_casts
  coercion_casts(): ReadonlySet<ItemLocalId> {
    return this.coercion_casts_;
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:590 offset_of_data
  offset_of_data(): LocalTableInContext<[Ty, VariantIdx, FieldIdx][]> {
    return new LocalTableInContext(this.hir_owner, this.offset_of_data_);
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:594 offset_of_data_mut
  offset_of_data_mut(): LocalTableInContextMut<[Ty, VariantIdx, FieldIdx][]> {
    return new LocalTableInContextMut(this.hir_owner, this.offset_of_data_);
  }
}

/** PORT: the key fn of `(ty::Predicate, ObligationCause)`'s derived `Hash`+`Eq` for the two `FxIndexSet`s
 *  (`ObligationCause` is pending, so the structural `intern_key`; the predicate keys by its interned id). */
function key_Predicate_ObligationCause(v: [Predicate, ObligationCause]): string {
  return intern_key(v);
}

/// A resolved splatted function call.
export type SplattedDef =
  /// A resolved FnDef call.
  | {
      readonly $: "FnDef";
      /// The DefId of the FnDef (used to look up its type).
      def_id: DefId;

      /// The index of the first argument in the callee's splatted tuple, and the index of the
      /// splatted tuple argument in the caller.
      arg_index: number;

      /// The number of arguments in the splatted tuple.
      arg_count: number;
    }

  /// A resolved FnPtr Call.
  | {
      readonly $: "FnPtr";
      /// The resolved type of the FnPtr.
      fn_ptr_type: Ty;

      /// The index of the first argument in the callee's splatted tuple, and the index of the
      /// splatted tuple argument in the caller.
      arg_index: number;

      /// The number of arguments in the splatted tuple.
      arg_count: number;
    };

export const SplattedDef = {
  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:632 def_id
  def_id(self: SplattedDef): DefId | undefined {
    switch (self.$) {
      case "FnDef":
        return self.def_id;
      case "FnPtr":
        return undefined;
    }
  },

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:639 fn_ptr_type
  fn_ptr_type(self: SplattedDef): Ty | undefined {
    switch (self.$) {
      case "FnDef":
        return undefined;
      case "FnPtr":
        return self.fn_ptr_type;
    }
  },

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:646 arg_index
  arg_index(self: SplattedDef): number {
    switch (self.$) {
      case "FnDef":
        return self.arg_index;
      case "FnPtr":
        return self.arg_index;
    }
  },

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:653 arg_count
  arg_count(self: SplattedDef): number {
    switch (self.$) {
      case "FnDef":
        return self.arg_count;
      case "FnPtr":
        return self.arg_count;
    }
  },
};

/// Validate that the given HirId (respectively its `local_id` part) can be
/// safely used as a key in the maps of a TypeckResults. For that to be
/// the case, the HirId must have the same `owner` as all the other IDs in
/// this table (signified by `hir_owner`). Otherwise the HirId
/// would be in a different frame of reference and using its `local_id`
/// would result in lookup errors, or worse, in silently wrong data being
/// stored/returned.
// rustc: compiler/rustc_middle/src/ty/typeck_results.rs:669 validate_hir_id_for_typeck_results
export function validate_hir_id_for_typeck_results(hir_owner: OwnerId, hir_id: HirId): void {
  if (!OwnerId_eq(hir_id.owner, hir_owner)) {
    invalid_hir_id_for_typeck_results(hir_owner, hir_id);
  }
}

// rustc: compiler/rustc_middle/src/ty/typeck_results.rs:677 invalid_hir_id_for_typeck_results
function invalid_hir_id_for_typeck_results(hir_owner: OwnerId, hir_id: HirId): void {
  with_((tcx) => {
    bug(`node ${tcx.hir_id_to_string(hir_id)} cannot be placed in TypeckResults with hir_owner ${debug_OwnerId(hir_owner, PLAIN)}`);
  });
}

export class LocalTableInContext<V> {
  constructor(
    public hir_owner: OwnerId,
    public data: ReadonlyMap<ItemLocalId, V>,
  ) {}

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:693 contains_key
  contains_key(id: HirId): boolean {
    validate_hir_id_for_typeck_results(this.hir_owner, id);
    return this.data.has(id.local_id);
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:698 get
  get(id: HirId): V | undefined {
    validate_hir_id_for_typeck_results(this.hir_owner, id);
    return this.data.get(id.local_id);
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:703 items
  *items(): Generator<[ItemLocalId, V], void, undefined> {
    for (const [id, value] of this.data) yield [id, value];
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:710 items_in_stable_order
  items_in_stable_order(): [ItemLocalId, V][] {
    const items: [ItemLocalId, V][] = [];
    for (const [k, v] of this.data) items.push([k, v]);
    return items.sort(([a], [b]) => a - b);
  }

  /** `impl Index<HirId> for LocalTableInContext` */
  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:718 index
  index(key: HirId): V {
    const r = this.get(key);
    if (r === undefined) {
      bug(`LocalTableInContext(${debug_OwnerId(this.hir_owner, PLAIN)}): key ${debug_HirId(key, PLAIN)} not found`);
    }
    return r;
  }
}

export class LocalTableInContextMut<V> {
  constructor(
    public hir_owner: OwnerId,
    public data: Map<ItemLocalId, V>,
  ) {}

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:731 get_mut
  get_mut(id: HirId): MutRef<V> | undefined {
    validate_hir_id_for_typeck_results(this.hir_owner, id);
    return map_get_mut(this.data, id.local_id);
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:736 get
  get(id: HirId): V | undefined {
    validate_hir_id_for_typeck_results(this.hir_owner, id);
    return this.data.get(id.local_id);
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:741 entry
  entry(id: HirId): HashMapEntry<ItemLocalId, V> {
    validate_hir_id_for_typeck_results(this.hir_owner, id);
    return HashMapEntry.of(this.data, id.local_id);
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:746 insert
  insert(id: HirId, val: V): V | undefined {
    validate_hir_id_for_typeck_results(this.hir_owner, id);
    const old = this.data.get(id.local_id);
    this.data.set(id.local_id, val);
    return old;
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:751 remove
  remove(id: HirId): V | undefined {
    validate_hir_id_for_typeck_results(this.hir_owner, id);
    const old = this.data.get(id.local_id);
    this.data.delete(id.local_id);
    return old;
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:756 extend
  extend(items: Iterable<[HirId, V]>): void {
    for (const [id, value] of items) {
      validate_hir_id_for_typeck_results(this.hir_owner, id);
      this.data.set(id.local_id, value);
    }
  }
}

/** `HashMap::get_mut`: a `&mut V` view onto the slot (`MutRef`), `undefined` if absent. */
function map_get_mut<K, V>(map: Map<K, V>, key: K): MutRef<V> | undefined {
  if (!map.has(key)) return undefined;
  return {
    get value(): V {
      return map.get(key) as V;
    },
    set value(v: V) {
      map.set(key, v);
    },
  };
}

/**
 * PORT: `std::collections::hash_map::Entry<'_, K, V>` over a JS `Map` (there is no std port of it): the
 * `Occupied` / `Vacant` variants (match on `$`) with the `OccupiedEntry` / `VacantEntry` and `Entry` methods rustc
 * uses on typeck tables (`get`, `get_mut`, `insert`, `remove`, `key`, `or_insert_with`, `or_default`).
 */
export class HashMapEntry<K, V> {
  private constructor(
    readonly $: "Occupied" | "Vacant",
    private readonly map: Map<K, V>,
    private readonly key_: K,
  ) {}

  static of<K, V>(map: Map<K, V>, key: K): HashMapEntry<K, V> {
    return new HashMapEntry(map.has(key) ? "Occupied" : "Vacant", map, key);
  }

  key(): K {
    return this.key_;
  }

  /** `OccupiedEntry::get` */
  get(): V {
    return this.map.get(this.key_) as V;
  }

  /** `OccupiedEntry::get_mut` */
  get_mut(): MutRef<V> {
    return map_get_mut(this.map, this.key_) as MutRef<V>;
  }

  /** `VacantEntry::insert` (returns the slot) / `OccupiedEntry::insert` (returns the old value): both set the value. */
  insert(value: V): V | undefined {
    const old = this.map.get(this.key_);
    this.map.set(this.key_, value);
    return old;
  }

  /** `OccupiedEntry::remove` */
  remove(): V {
    const old = this.map.get(this.key_) as V;
    this.map.delete(this.key_);
    return old;
  }

  /** `Entry::or_insert_with` */
  or_insert_with(default_: () => V): MutRef<V> {
    if (!this.map.has(this.key_)) this.map.set(this.key_, default_());
    return map_get_mut(this.map, this.key_) as MutRef<V>;
  }

  /** `Entry::or_default`; `V: Default` is `V_default`. */
  or_default(V_default: () => V): MutRef<V> {
    return this.or_insert_with(V_default);
  }
}

export class LocalSetInContext {
  constructor(
    public hir_owner: OwnerId,
    public data: ReadonlySet<ItemLocalId>,
  ) {}

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:771 is_empty
  is_empty(): boolean {
    return this.data.size === 0;
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:775 contains
  contains(id: HirId): boolean {
    validate_hir_id_for_typeck_results(this.hir_owner, id);
    return this.data.has(id.local_id);
  }
}

export class LocalSetInContextMut {
  constructor(
    public hir_owner: OwnerId,
    public data: Set<ItemLocalId>,
  ) {}

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:788 is_empty
  is_empty(): boolean {
    return this.data.size === 0;
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:792 contains
  contains(id: HirId): boolean {
    validate_hir_id_for_typeck_results(this.hir_owner, id);
    return this.data.has(id.local_id);
  }
  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:796 insert
  insert(id: HirId): boolean {
    validate_hir_id_for_typeck_results(this.hir_owner, id);
    const had = this.data.has(id.local_id);
    this.data.add(id.local_id);
    return !had;
  }

  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:801 remove
  remove(id: HirId): boolean {
    validate_hir_id_for_typeck_results(this.hir_owner, id);
    return this.data.delete(id.local_id);
  }
}

// rustc_index::newtype_index! {
//     #[stable_hash]
//     #[encodable]
//     #[debug_format = "UserType({})"]
//     pub struct UserTypeAnnotationIndex {
//         const START_INDEX = 0;
//     }
// }
export type UserTypeAnnotationIndex = number & { readonly __brand: "UserTypeAnnotationIndex" };
export const UserTypeAnnotationIndex = {
  ...newtype_index<UserTypeAnnotationIndex>((n) => `UserType(${n})`),
  START_INDEX: 0 as UserTypeAnnotationIndex,
};
export const debug_UserTypeAnnotationIndex: Debug<UserTypeAnnotationIndex> = UserTypeAnnotationIndex.debug;

/// Mapping of type annotation indices to canonical user type annotations.
export type CanonicalUserTypeAnnotations = CanonicalUserTypeAnnotation[];

export interface CanonicalUserTypeAnnotation {
  // #[type_foldable(identity)]
  // #[type_visitable(ignore)]
  user_ty: CanonicalUserType;
  span: Span;
  inferred_ty: Ty;
}
/** `#[derive(Debug)]` */
export const debug_CanonicalUserTypeAnnotation: Debug<CanonicalUserTypeAnnotation> = (v, f) =>
  debug_struct(f, "CanonicalUserTypeAnnotation", [
    ["user_ty", debug_Canonical(v.user_ty, f, debug_UserType)],
    ["span", debug_Span(v.span, f)],
    ["inferred_ty", debug_Ty(v.inferred_ty, f)],
  ]);

/// Canonical user type annotation.
export type CanonicalUserType = Canonical<UserType>;

// PORT: a data struct with derived traits, as codegen shapes such structs: an interface plus a same-named companion
// holding its inherent methods (tyir-binder decision 5).
export interface UserType {
  kind: UserTypeKind;
  bounds: Clauses;
}
/** `#[derive(Debug)]` */
export const debug_UserType: Debug<UserType> = (v, f) =>
  debug_struct(f, "UserType", [
    ["kind", debug_UserTypeKind(v.kind, f)],
    ["bounds", debug_RawList(v.bounds, f, debug_Clause)],
  ]);

export const UserType = {
  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:840 new
  new(kind: UserTypeKind): UserType {
    return { kind, bounds: RawList.empty_with_type_info<Clause>() };
  },

  /// A user type annotation with additional bounds that need to be enforced.
  /// These bounds are lowered from `impl Trait` in bindings.
  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:846 new_with_bounds
  new_with_bounds(kind: UserTypeKind, bounds: Clauses): UserType {
    return { kind, bounds };
  },
};

/// A user-given type annotation attached to a constant. These arise
/// from constants that are named via paths, like `Foo::<A>::new` and
/// so forth.
export type UserTypeKind =
  | { readonly $: "Ty"; _0: Ty }

  /// The canonical type is the result of `type_of(def_id)` with the
  /// given generic parameters applied.
  | { readonly $: "TypeOf"; _0: DefId; _1: UserArgs };
/** `#[derive(Debug)]` */
export const debug_UserTypeKind: Debug<UserTypeKind> = (v, f) => {
  switch (v.$) {
    case "Ty":
      return debug_tuple(f, "Ty", [debug_Ty(v._0, f)]);
    case "TypeOf":
      return debug_tuple(f, "TypeOf", [debug_DefId(v._0, f), debug_UserArgs(v._1, f)]);
  }
};

// `#[derive(Lift)]` of `UserTypeKind`: skipped (PORTING §3).

export interface IsIdentity<T> {
  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:865 is_identity
  is_identity(self: T): boolean;
}

/** `impl IsIdentity for CanonicalUserType` */
export const IsIdentity_CanonicalUserType: IsIdentity<CanonicalUserType> = {
  /// Returns `true` if this represents the generic parameters of the form `[?0, ?1, ?2]`,
  /// i.e., each thing is mapped to a canonical variable with the same index.
  // rustc: compiler/rustc_middle/src/ty/typeck_results.rs:871 is_identity
  is_identity(self: CanonicalUserType): boolean {
    if (!(self.value.bounds.length === 0)) {
      return false;
    }

    const kind = self.value.kind;
    switch (kind.$) {
      case "Ty":
        return false;
      case "TypeOf": {
        const user_args = kind._1;
        if (user_args.user_self_ty !== undefined) {
          return false;
        }

        // PORT: `iter::zip(user_args.args, BoundVar::ZERO..)`: `cvar` is the arg's position as a `BoundVar`.
        const args: GenericArgs = user_args.args;
        for (let i = 0; i < args.length; i++) {
          const arg = args[i]!;
          const cvar = BoundVar.from_usize(i);
          let ok: boolean;
          const arg_kind = GenericArg.kind(arg);
          switch (arg_kind.$) {
            case "Type": {
              const ty = arg_kind._0.kind();
              if (ty.$ === "Bound") {
                const [debruijn, b] = [ty._0, ty._1];
                // We only allow a `ty::BoundVarIndexKind::Canonical` index in generic parameters.
                assert_eq_BoundVarIndexKind(debruijn, BoundVarIndexKind.Canonical);
                ok = cvar === b.var;
              } else {
                ok = false;
              }
              break;
            }

            case "Lifetime": {
              const r = arg_kind._0.kind();
              if (r.$ === "ReBound") {
                const [debruijn, b] = [r._0, r._1];
                // We only allow a `ty::BoundVarIndexKind::Canonical` index in generic parameters.
                assert_eq_BoundVarIndexKind(debruijn, BoundVarIndexKind.Canonical);
                ok = cvar === b.var;
              } else {
                ok = false;
              }
              break;
            }

            case "Const": {
              const ct = arg_kind._0.kind();
              if (ct.$ === "Bound") {
                const [debruijn, b] = [ct._0, ct._1];
                // We only allow a `ty::BoundVarIndexKind::Canonical` index in generic parameters.
                assert_eq_BoundVarIndexKind(debruijn, BoundVarIndexKind.Canonical);
                ok = cvar === b.var;
              } else {
                ok = false;
              }
              break;
            }
          }
          if (!ok) return false;
        }
        return true;
      }
    }
  },
};

/** `assert_eq!(debruijn, ty::BoundVarIndexKind::Canonical)` (derived `PartialEq` / `Debug`). */
function assert_eq_BoundVarIndexKind(left: BoundVarIndexKind, right: BoundVarIndexKind): void {
  assert_eq(
    left,
    right,
    (v) => debug_BoundVarIndexKind(v, PLAIN),
    (a, b) => a.$ === b.$ && (a.$ !== "Bound" || (b.$ === "Bound" && a._0 === b._0)),
  );
}

/** `impl fmt::Display for UserType` */
// rustc: compiler/rustc_middle/src/ty/typeck_results.rs:919 fmt
export function display_UserType(self: UserType): string {
  // PORT (init order): print/pretty.ts (an extension module) holds the `Display` of `UserTypeKind` / `Clause`; it is
  // required lazily, at call time.
  const { display_UserTypeKind, display_Clause } = require("./print/pretty.ts") as typeof import("./print/pretty.ts");
  let out = display_UserTypeKind(self.kind);
  for (const b of self.bounds) {
    out += " + ";
    out += display_Clause(b);
  }
  return out;
}

/// Information on a pattern incompatible with Rust 2024, for use by the error/migration diagnostic
/// emitted during THIR construction.
export interface Rust2024IncompatiblePatInfo {
  /// Labeled spans for `&`s, `&mut`s, and binding modifiers incompatible with Rust 2024.
  primary_labels: [Span, string][];
  /// Whether any `mut` binding modifiers occur under a non-`move` default binding mode.
  bad_mut_modifiers: boolean;
  /// Whether any `ref`/`ref mut` binding modifiers occur under a non-`move` default binding mode.
  bad_ref_modifiers: boolean;
  /// Whether any `&` or `&mut` patterns occur under a non-`move` default binding mode.
  bad_ref_pats: boolean;
  /// If `true`, we can give a simpler suggestion solely by eliding explicit binding modifiers.
  suggest_eliding_modes: boolean;
}
