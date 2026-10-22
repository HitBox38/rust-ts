// Port of compiler/rustc_borrowck/src/type_check/mod.rs (lane borrowck-contract: declarations; fill lane bck-tc-a, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
//
// PORT: `TypeChecker` is a hand class (codegen `hand`) extending rustc_middle mir/visit.ts's `Visitor`; its fields keep
// their declaration order and the constructor takes all of them. `&'a mut` fields are the shared objects
// (`constraints`, `deferred_closure_requirements`); `polonius_facts: &'a mut Option<PoloniusFacts>` is a `MutRef` (the
// option is replaced). `reported_errors: FxIndexSet<(Ty, Span)>` is a `KeyedSet` at construction. The method `body()`
// is `body_()` (field `body`). The `impl TypeChecker` blocks of mod.rs are in the class body (PORTING §8); those of
// input_output.rs / relate_tys.rs / canonical.rs augment this module.
// PORT: `ctxt: &dyn fmt::Debug` (`assert_iscleanup*`) is a lazy Debug thunk `(f: Fmt) => string`: upstream formats it
// only in the `span_mirbug!` message.
// PORT: `trait NormalizeLocation: fmt::Debug + Copy` is the impl table `NormalizeLocation<T>` (`to_locations` + the
// `Debug` supertrait); its impls are `NormalizeLocation_Locations` / `NormalizeLocation_Location`.
// PORT: `impl TypeOp for InstantiateOpaqueType` is the descriptor `TypeOp_InstantiateOpaqueType` (rustc_trait_selection
// type_op/mod.ts convention: `fully_perform` takes `self` first).
// Init order: `mod canonical; mod constraint_conversion; mod free_region_relations; mod input_output; pub(crate) mod
// liveness; mod relate_tys;` are not re-exported (input_output / relate_tys / canonical assign `TypeChecker.prototype`).
import type { FieldIdx } from "../../rustc_abi/layout.ts";
import type { Mutability } from "../../rustc_ast_ir/lib.ts";
import type { InferCtxt } from "../../rustc_infer/decls.ts";
import type { QueryRegionConstraints } from "../../rustc_middle/infer/canonical.ts";
import type {
  AggregateKind,
  BasicBlock,
  BasicBlockData,
  Body,
  CallSource,
  ConstOperand,
  ConstraintCategory,
  Local,
  LocalDecl,
  Location,
  Operand,
  Place,
  PlaceElem,
  PlaceRef,
  Rvalue,
  Statement,
  Terminator,
  UnwindAction,
  UserTypeProjection,
} from "../../rustc_middle/mir/mod.ts";
import { type PlaceContext, Visitor } from "../../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { GenericArgs, Region, Ty } from "../../rustc_middle/ty/decls.ts";
import type { InstantiatedClauses } from "../../rustc_middle/ty/mod.ts";
import type { PolyTypeOutlivesClause } from "../../rustc_middle/ty/predicate.ts";
import type { CanonicalUserTypeAnnotations, UserTypeAnnotationIndex } from "../../rustc_middle/ty/typeck_results.ts";
import type { MoveData } from "../../rustc_mir_dataflow/move_paths/mod.ts";
import type { DenseLocationMap } from "../../rustc_mir_dataflow/points.ts";
import type { LocalDefId } from "../../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span, Spanned } from "../../rustc_span/lib.ts";
import type { TypeOp, TypeOpOutput } from "../../rustc_trait_selection/traits/query/type_op/mod.ts";
import type { PlaceholderRegion } from "../../rustc_type_ir/binder.ts";
import type { Variance } from "../../rustc_type_ir/lib.ts";
import type { FnSig } from "../../rustc_type_ir/ty_kind.ts";
import type { NoSolution } from "../../rustc_type_ir/solve/mod.ts";
import type { RegionBoundPairs } from "../../rustc_infer/infer/outlives/env.ts";
import { debug_Location, type Location as MirLocation } from "../../rustc_middle/mir/mod.ts";
import type { Debug, Fmt } from "../../std/fmt.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { unported } from "../../std/panic.ts";
import type { Result } from "../../std/result.ts";
import type { BorrowSet } from "../borrow_set.gen.ts";
import type { BorrowckInferCtxt, DeferredClosureRequirements } from "../lib.gen.ts";
import type { PoloniusContext } from "../polonius/mod.gen.ts";
import type { PoloniusFacts } from "../polonius/legacy/facts.gen.ts";
import type { PoloniusLocationTable } from "../polonius/legacy/location.gen.ts";
import type { UniversalRegions } from "../universal_regions.gen.ts";
import * as gen from "./mod.gen.ts";
import { debug_Locations, type FieldAccessError, type InstantiateOpaqueType, MirTypeckRegionConstraints, type MirTypeckResults } from "./mod.gen.ts";

export * from "./mod.gen.ts";

declare module "./mod.gen.ts" {
  interface MirTypeckRegionConstraints {
    // mod.rs:299 (lane bck-tc-a)
    placeholder_region(infcx: InferCtxt, placeholder: PlaceholderRegion): Region;
  }
}

/// Type checks the given `mir` in the context of the inference
/// context `infcx`. Returns any region constraints that have yet to
/// be proven. This result includes liveness constraints that
/// ensure that regions appearing in the types of all local variables
/// are live at all points where that local variable may later be
/// used.
///
/// This phase of type-check ought to be infallible -- this is because
/// the original, HIR-based type-check succeeded. So if any errors
/// occur here, we will get a `bug!` reported.
///
/// # Parameters
///
/// - `infcx` -- inference context to use
/// - `body` -- MIR body to type-check
/// - `promoted` -- map of promoted constants within `body`
/// - `universal_regions` -- the universal regions from `body`s function signature
/// - `location_table` -- for datalog polonius, the map between `Location`s and `RichLocation`s
/// - `borrow_set` -- information about borrows occurring in `body`
/// - `polonius_facts` -- when using Polonius, this is the generated set of Polonius facts
/// - `move_data` -- move-data constructed when performing the maybe-init dataflow analysis
/// - `location_map` -- map between MIR `Location` and `PointIndex`
// stub: compiler/rustc_borrowck/src/type_check/mod.rs:97 type_check (lane bck-tc-a)
export function type_check(
  infcx: BorrowckInferCtxt,
  body: Body,
  promoted: readonly Body[],
  universal_regions: UniversalRegions,
  location_table: PoloniusLocationTable,
  borrow_set: BorrowSet,
  polonius_facts: MutRef<PoloniusFacts | undefined>,
  move_data: MoveData,
  location_map: DenseLocationMap,
): MirTypeckResults {
  return unported("rustc_borrowck::type_check::type_check");
}

// stub: compiler/rustc_borrowck/src/type_check/mod.rs:213 mirbug (lane bck-tc-a)
export function mirbug(tcx: TyCtxt, span: Span, msg: string): void {
  return unported("rustc_borrowck::type_check::mirbug");
}

/// Creates a `Region` for a given `PlaceholderRegion`, or returns the
/// region that corresponds to a previously created one.
// stub: compiler/rustc_borrowck/src/type_check/mod.rs:299 placeholder_region (lane bck-tc-a)
MirTypeckRegionConstraints.prototype.placeholder_region = function (this: MirTypeckRegionConstraints, infcx: InferCtxt, placeholder: PlaceholderRegion): Region {
  return unported("rustc_borrowck::type_check::MirTypeckRegionConstraints::placeholder_region");
};

export interface Locations_methods {
  // mod.rs:367 (lane bck-tc-a)
  from_location(self: Locations): MirLocation | undefined;
  // mod.rs:375 (lane bck-tc-a)
  span(self: Locations, body: Body): Span;
}
export type Locations = gen.Locations;
// PORT: the generator emits no companion for `Locations` (no unit variant): the companion holds only the methods.
export const Locations = {} as Locations_methods;

// stub: compiler/rustc_borrowck/src/type_check/mod.rs:367 from_location (lane bck-tc-a)
Locations.from_location = function (self: Locations): MirLocation | undefined {
  return unported("rustc_borrowck::type_check::Locations::from_location");
};

/// Gets a span representing the location.
// stub: compiler/rustc_borrowck/src/type_check/mod.rs:375 span (lane bck-tc-a)
Locations.span = function (self: Locations, body: Body): Span {
  return unported("rustc_borrowck::type_check::Locations::span");
};

// rustc-type: compiler/rustc_borrowck/src/type_check/mod.rs:228 TypeChecker
export class TypeChecker extends Visitor {
  constructor(
    public infcx: BorrowckInferCtxt,
    public last_span: Span,
    public body: Body,
    public promoted: readonly Body[],
    public user_type_annotations: CanonicalUserTypeAnnotations,
    public region_bound_pairs: RegionBoundPairs,
    public known_type_outlives_obligations: readonly PolyTypeOutlivesClause[],
    public reported_errors: Set<[Ty, Span]>,
    public universal_regions: UniversalRegions,
    public location_table: PoloniusLocationTable,
    public polonius_facts: MutRef<PoloniusFacts | undefined>,
    public borrow_set: BorrowSet,
    public constraints: MirTypeckRegionConstraints,
    public deferred_closure_requirements: DeferredClosureRequirements,
    public polonius_context: PoloniusContext | undefined,
  ) {
    super();
  }

  // ---- impl<'a, 'tcx> TypeChecker<'a, 'tcx> (mod.rs:383) ----

  // stub: compiler/rustc_borrowck/src/type_check/mod.rs:384 tcx (lane bck-tc-a)
  tcx(): TyCtxt {
    return unported("rustc_borrowck::type_check::TypeChecker::tcx");
  }

  // stub: compiler/rustc_borrowck/src/type_check/mod.rs:388 body (lane bck-tc-a)
  body_(): Body {
    return unported("rustc_borrowck::type_check::TypeChecker::body");
  }

  /// Equate the inferred type and the annotated type for user type annotations
  // stub: compiler/rustc_borrowck/src/type_check/mod.rs:394 check_user_type_annotations (lane bck-tc-a)
  check_user_type_annotations(): void {
    return unported("rustc_borrowck::type_check::TypeChecker::check_user_type_annotations");
  }

  // stub: compiler/rustc_borrowck/src/type_check/mod.rs:404 push_region_constraints (lane bck-tc-a)
  push_region_constraints(locations: Locations, category: ConstraintCategory, data: QueryRegionConstraints): void {
    return unported("rustc_borrowck::type_check::TypeChecker::push_region_constraints");
  }

  /// Try to relate `sub <: sup`
  // stub: compiler/rustc_borrowck/src/type_check/mod.rs:426 sub_types (lane bck-tc-a)
  sub_types(sub: Ty, sup: Ty, locations: Locations, category: ConstraintCategory): Result<null, NoSolution> {
    return unported("rustc_borrowck::type_check::TypeChecker::sub_types");
  }

  // stub: compiler/rustc_borrowck/src/type_check/mod.rs:439 eq_types (lane bck-tc-a)
  eq_types(expected: Ty, found: Ty, locations: Locations, category: ConstraintCategory): Result<null, NoSolution> {
    return unported("rustc_borrowck::type_check::TypeChecker::eq_types");
  }

  // stub: compiler/rustc_borrowck/src/type_check/mod.rs:450 relate_type_and_user_type (lane bck-tc-a)
  relate_type_and_user_type(a: Ty, v: Variance, user_ty: UserTypeProjection, locations: Locations, category: ConstraintCategory): Result<null, NoSolution> {
    return unported("rustc_borrowck::type_check::TypeChecker::relate_type_and_user_type");
  }

  // stub: compiler/rustc_borrowck/src/type_check/mod.rs:508 check_promoted (lane bck-tc-a)
  check_promoted(promoted_body: Body, location: Location): void {
    return unported("rustc_borrowck::type_check::TypeChecker::check_promoted");
  }

  // ---- impl<'a, 'tcx> Visitor<'tcx> for TypeChecker<'a, 'tcx> (mod.rs:578) ----

  // stub: compiler/rustc_borrowck/src/type_check/mod.rs:579 visit_span (lane bck-tc-a)
  override visit_span(span: Span): void {
    return unported("rustc_borrowck::type_check::TypeChecker::visit_span");
  }

  // stub: compiler/rustc_borrowck/src/type_check/mod.rs:587 visit_body (lane bck-tc-a)
  override visit_body(body: Body): void {
    return unported("rustc_borrowck::type_check::TypeChecker::visit_body");
  }

  // stub: compiler/rustc_borrowck/src/type_check/mod.rs:607 visit_statement (lane bck-tc-a)
  override visit_statement(stmt: Statement, location: Location): void {
    return unported("rustc_borrowck::type_check::TypeChecker::visit_statement");
  }

  // stub: compiler/rustc_borrowck/src/type_check/mod.rs:740 visit_terminator (lane bck-tc-a)
  override visit_terminator(term: Terminator, term_location: Location): void {
    return unported("rustc_borrowck::type_check::TypeChecker::visit_terminator");
  }

  // stub: compiler/rustc_borrowck/src/type_check/mod.rs:931 visit_local_decl (lane bck-tc-a)
  override visit_local_decl(local: Local, local_decl: LocalDecl): void {
    return unported("rustc_borrowck::type_check::TypeChecker::visit_local_decl");
  }

  // stub: compiler/rustc_borrowck/src/type_check/mod.rs:993 visit_rvalue (lane bck-tc-a)
  override visit_rvalue(rvalue: Rvalue, location: Location): void {
    return unported("rustc_borrowck::type_check::TypeChecker::visit_rvalue");
  }

  // stub: compiler/rustc_borrowck/src/type_check/mod.rs:1707 visit_operand (lane bck-tc-a)
  override visit_operand(op: Operand, location: Location): void {
    return unported("rustc_borrowck::type_check::TypeChecker::visit_operand");
  }

  // stub: compiler/rustc_borrowck/src/type_check/mod.rs:1736 visit_const_operand (lane bck-tc-a)
  override visit_const_operand(constant: ConstOperand, location: Location): void {
    return unported("rustc_borrowck::type_check::TypeChecker::visit_const_operand");
  }

  // stub: compiler/rustc_borrowck/src/type_check/mod.rs:1859 visit_place (lane bck-tc-a)
  override visit_place(place: Place, context: PlaceContext, location: Location): void {
    return unported("rustc_borrowck::type_check::TypeChecker::visit_place");
  }

  // stub: compiler/rustc_borrowck/src/type_check/mod.rs:1885 visit_projection_elem (lane bck-tc-a)
  override visit_projection_elem(place: PlaceRef, elem: PlaceElem, context: PlaceContext, location: Location): void {
    return unported("rustc_borrowck::type_check::TypeChecker::visit_projection_elem");
  }

  // ---- impl<'a, 'tcx> TypeChecker<'a, 'tcx> (mod.rs:1952) ----

  // stub: compiler/rustc_borrowck/src/type_check/mod.rs:1953 check_call_dest (lane bck-tc-a)
  check_call_dest(term: Terminator, sig: FnSig, destination: Place, is_diverging: boolean, term_location: Location): void {
    return unported("rustc_borrowck::type_check::TypeChecker::check_call_dest");
  }

  // stub: compiler/rustc_borrowck/src/type_check/mod.rs:2018 check_call_inputs (lane bck-tc-a)
  check_call_inputs(
    term: Terminator,
    func: Operand,
    sig: FnSig,
    args: readonly Spanned<Operand>[],
    term_location: Location,
    call_source: CallSource,
  ): void {
    return unported("rustc_borrowck::type_check::TypeChecker::check_call_inputs");
  }

  // stub: compiler/rustc_borrowck/src/type_check/mod.rs:2082 check_iscleanup (lane bck-tc-a)
  check_iscleanup(block_data: BasicBlockData): void {
    return unported("rustc_borrowck::type_check::TypeChecker::check_iscleanup");
  }

  // stub: compiler/rustc_borrowck/src/type_check/mod.rs:2162 assert_iscleanup (lane bck-tc-a)
  assert_iscleanup(ctxt: (f: Fmt) => string, bb: BasicBlock, iscleanuppad: boolean): void {
    return unported("rustc_borrowck::type_check::TypeChecker::assert_iscleanup");
  }

  // stub: compiler/rustc_borrowck/src/type_check/mod.rs:2168 assert_iscleanup_unwind (lane bck-tc-a)
  assert_iscleanup_unwind(ctxt: (f: Fmt) => string, unwind: UnwindAction, is_cleanup: boolean): void {
    return unported("rustc_borrowck::type_check::TypeChecker::assert_iscleanup_unwind");
  }

  // stub: compiler/rustc_borrowck/src/type_check/mod.rs:2190 ensure_place_sized (lane bck-tc-a)
  ensure_place_sized(ty: Ty, span: Span): void {
    return unported("rustc_borrowck::type_check::TypeChecker::ensure_place_sized");
  }

  // stub: compiler/rustc_borrowck/src/type_check/mod.rs:2212 aggregate_field_ty (lane bck-tc-a)
  aggregate_field_ty(ak: AggregateKind, field_index: FieldIdx, location: Location): Result<Ty, FieldAccessError> {
    return unported("rustc_borrowck::type_check::TypeChecker::aggregate_field_ty");
  }

  /// If this rvalue supports a user-given type annotation, then
  /// extract and return it. This represents the final type of the
  /// rvalue and will be unified with the inferred type.
  // stub: compiler/rustc_borrowck/src/type_check/mod.rs:2269 rvalue_user_ty (lane bck-tc-a)
  rvalue_user_ty(rvalue: Rvalue): UserTypeAnnotationIndex | undefined {
    return unported("rustc_borrowck::type_check::TypeChecker::rvalue_user_ty");
  }

  // stub: compiler/rustc_borrowck/src/type_check/mod.rs:2296 check_aggregate_rvalue (lane bck-tc-a)
  check_aggregate_rvalue(rvalue: Rvalue, aggregate_kind: AggregateKind, operands: readonly Operand[], location: Location): void {
    return unported("rustc_borrowck::type_check::TypeChecker::check_aggregate_rvalue");
  }

  /// Adds the constraints that arise from a borrow expression `&'a P` at the location `L`.
  ///
  /// # Parameters
  ///
  /// - `location`: the location `L` where the borrow expression occurs
  /// - `borrow_region`: the region `'a` associated with the borrow
  /// - `borrowed_place`: the place `P` being borrowed
  // stub: compiler/rustc_borrowck/src/type_check/mod.rs:2358 add_reborrow_constraint (lane bck-tc-a)
  add_reborrow_constraint(location: Location, borrow_region: Region, borrowed_place: Place): void {
    return unported("rustc_borrowck::type_check::TypeChecker::add_reborrow_constraint");
  }

  // stub: compiler/rustc_borrowck/src/type_check/mod.rs:2485 add_generic_reborrow_constraint (lane bck-tc-a)
  add_generic_reborrow_constraint(mutability: Mutability, location: Location, src_place: Place, dst_ty: Ty): void {
    return unported("rustc_borrowck::type_check::TypeChecker::add_generic_reborrow_constraint");
  }

  // stub: compiler/rustc_borrowck/src/type_check/mod.rs:2655 prove_aggregate_predicates (lane bck-tc-a)
  prove_aggregate_predicates(aggregate_kind: AggregateKind, location: Location): void {
    return unported("rustc_borrowck::type_check::TypeChecker::prove_aggregate_predicates");
  }

  // stub: compiler/rustc_borrowck/src/type_check/mod.rs:2709 prove_closure_bounds (lane bck-tc-a)
  prove_closure_bounds(tcx: TyCtxt, def_id: LocalDefId, args: GenericArgs, location: Location): InstantiatedClauses {
    return unported("rustc_borrowck::type_check::TypeChecker::prove_closure_bounds");
  }
}

// rustc-trait: compiler/rustc_borrowck/src/type_check/mod.rs:2763 NormalizeLocation
export interface NormalizeLocation<T> {
  /** The `fmt::Debug` supertrait. */
  readonly debug: Debug<T>;
  // rustc: compiler/rustc_borrowck/src/type_check/mod.rs:2764 to_locations
  to_locations(self: T): Locations;
}

// impl NormalizeLocation for Locations
export const NormalizeLocation_Locations: NormalizeLocation<Locations> = {
  debug: debug_Locations,
  // stub: compiler/rustc_borrowck/src/type_check/mod.rs:2768 to_locations (lane bck-tc-a)
  to_locations(self: Locations): Locations {
    return unported("rustc_borrowck::type_check::Locations::to_locations");
  },
};

// impl NormalizeLocation for Location
export const NormalizeLocation_Location: NormalizeLocation<MirLocation> = {
  debug: debug_Location,
  // stub: compiler/rustc_borrowck/src/type_check/mod.rs:2774 to_locations (lane bck-tc-a)
  to_locations(self: MirLocation): Locations {
    return unported("rustc_borrowck::type_check::Location::to_locations");
  },
};

// impl<'tcx> TypeOp<'tcx> for InstantiateOpaqueType<'tcx> { type Output = (); type ErrorInfo = InstantiateOpaqueType<'tcx>; }
export const TypeOp_InstantiateOpaqueType: TypeOp<InstantiateOpaqueType, null, InstantiateOpaqueType> = {
  // stub: compiler/rustc_borrowck/src/type_check/mod.rs:2798 fully_perform (lane bck-tc-a)
  fully_perform(self: InstantiateOpaqueType, infcx: InferCtxt, root_def_id: LocalDefId, span: Span): Result<TypeOpOutput<null, InstantiateOpaqueType>, ErrorGuaranteed> {
    return unported("rustc_borrowck::type_check::InstantiateOpaqueType::fully_perform");
  },
};
