// Port of compiler/rustc_borrowck/src/type_check/mod.rs (lane borrowck-contract: declarations; filled by lane bck-tc-a, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
//
//! This pass type-checks the MIR to ensure it is not broken.
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
// `Debug` supertrait); its impls are `NormalizeLocation_Locations` / `NormalizeLocation_Location`. A method call
// `location.to_locations()` is `NormalizeLocation_Location.to_locations(location)` (`Location`) or the value itself
// (`Locations`, the identity impl).
// PORT: `impl TypeOp for InstantiateOpaqueType` is the descriptor `TypeOp_InstantiateOpaqueType` (rustc_trait_selection
// type_op/mod.ts convention: `fully_perform` takes `self` first).
// PORT: the `span_mirbug!` macro is the module-level helper `span_mirbug(cx, elem, msg)`: `elem` is the `{:?}` of the
// macro's `$elem` and `msg` the formatted message (formatted eagerly, as `format!` does).
// PORT: `debug!` / `trace!` / `#[instrument]` stay comments (the default WARN filter drops them).
// Init order: `mod canonical; mod constraint_conversion; mod free_region_relations; mod input_output; pub(crate) mod
// liveness; mod relate_tys;` are not re-exported (input_output / relate_tys / canonical assign `TypeChecker.prototype`).
// The fns that `type_check` calls in free_region_relations.ts / constraint_conversion.ts / liveness/mod.ts are read
// lazily (`require`, like root_cx.ts reads lib.ts) so that this module keeps loading as a fresh entry point.
import type { FieldIdx } from "../../rustc_abi/layout.ts";
import { Mutability } from "../../rustc_ast_ir/lib.ts";
import { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import type { InferCtxt } from "../../rustc_infer/decls.ts";
import { BoundRegionConversionTime, type NllRegionVariableOrigin, type RegionVariableOrigin } from "../../rustc_infer/infer/mod.ts";
import type { QueryRegionConstraints } from "../../rustc_middle/infer/canonical.ts";
import {
  type AggregateKind,
  type BasicBlock,
  BasicBlock as BasicBlockC,
  type BasicBlockData,
  type Body,
  type CallSource,
  type ConstOperand,
  ConstraintCategory,
  debug_BasicBlock,
  debug_BasicBlockData,
  debug_ConstOperand,
  debug_Local,
  debug_Operand,
  debug_PlaceRef,
  debug_Promoted,
  debug_Rvalue,
  debug_Statement,
  debug_Terminator,
  debug_UserTypeProjections,
  clone_Location,
  type Local,
  Local as LocalC,
  type LocalDecl,
  type Location,
  Operand,
  type Place,
  type PlaceElem,
  type PlaceRef,
  PlaceTy,
  RETURN_PLACE,
  ReturnConstraint,
  Rvalue,
  type Statement,
  type Terminator,
  type UnwindAction,
  type UserTypeProjection,
} from "../../rustc_middle/mir/mod.ts";
import { debug_CanonicalUserTypeAnnotation } from "../../rustc_middle/ty/typeck_results.gen.ts";
import { CastTy } from "../../rustc_middle/ty/cast.ts";
import { CallSource as CallSourceC, debug_CastKind, debug_ProjectionElem, type ProjectionKind } from "../../rustc_middle/mir/mod.ts";
import { debug_PlaceTy, Place_from_Local } from "../../rustc_middle/mir/statement.ts";
import { UnevaluatedConst } from "../../rustc_middle/mir/consts.gen.ts";
import type { CodegenFnAttrs } from "../../rustc_middle/middle/codegen_fn_attrs.ts";
import { debug_DefKind } from "../../rustc_hir/def.gen.ts";
import { Safety } from "../../rustc_hir/lib.ts";
import type { AdtDef } from "../../rustc_middle/ty/adt.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { InlineConstArgs } from "../../rustc_middle/ty/sty.ts";
import type { ParamConst } from "../../rustc_middle/ty/sty.ts";
import type { ConstKind } from "../../rustc_middle/ty/consts.gen.ts";
import type { ClauseKind } from "../../rustc_middle/ty/predicate.gen.ts";
import { debug_GenericArgs, fold_GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { type Generics } from "../../rustc_middle/ty/generics.ts";
import { debug_TypeOutlivesConstraint } from "../../rustc_infer/infer/mod.gen.ts";
import { debug_OutlivesClause } from "../../rustc_type_ir/predicate.gen.ts";
import type { AnonConstKind } from "../../rustc_type_ir/const_kind.gen.ts";
import type { Interner } from "../../rustc_type_ir/interner.ts";
import type { PolyTraitRef } from "../../rustc_type_ir/decls.ts";
import type { CastKind } from "../../rustc_middle/mir/syntax.gen.ts";
import { type PlaceContext, PlaceContext as PlaceContextC, Visitor } from "../../rustc_middle/mir/visit.ts";
import { ObligationCause } from "../../rustc_middle/traits/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { GenericArgs, Region } from "../../rustc_middle/ty/decls.ts";
import { debug_GenericArg, GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import { GenericClauses } from "../../rustc_middle/ty/generics.ts";
import { InstantiatedClauses, Term, Ty } from "../../rustc_middle/ty/mod.ts";
import { Clause_upcast_from_ClauseKind, Predicate_upcast_from_PolyTraitRef, type PolyTypeOutlivesClause } from "../../rustc_middle/ty/predicate.ts";
import { display_PolyFnSig, display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { debug_Ty, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { type CanonicalUserTypeAnnotations, fold_UserType, UserType, type UserTypeAnnotationIndex } from "../../rustc_middle/ty/typeck_results.ts";
import type { MoveData } from "../../rustc_mir_dataflow/move_paths/mod.ts";
import { DenseLocationMap } from "../../rustc_mir_dataflow/points.ts";
import { CRATE_DEF_ID, debug_DefId, debug_LocalDefId, type DefId, LocalDefId } from "../../rustc_span/def_id.ts";
import { DUMMY_SP, type ErrorGuaranteed, Span, type Spanned } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { sym, Symbol } from "../../rustc_span/symbol.ts";
import { Obligation } from "../../rustc_infer/traits/mod.ts";
import { clone_Obligation } from "../../rustc_infer/traits/mod.gen.ts";
import { fold_unit } from "../../rustc_trait_selection/solve/inspect/analyse.ts";
import { CustomTypeOp, scrape_region_constraints, TypeOp_CustomTypeOp } from "../../rustc_trait_selection/traits/query/type_op/custom.ts";
import type { TypeOp, TypeOpOutput } from "../../rustc_trait_selection/traits/query/type_op/mod.ts";
import { Normalizable_FnSig, Normalizable_PolyFnSig, Normalizable_Ty } from "../../rustc_trait_selection/traits/query/type_op/normalize.ts";
import { Binder, EarlyBinder, fold_Binder, type PlaceholderRegion } from "../../rustc_type_ir/binder.ts";
import { fold_regions } from "../../rustc_type_ir/fold.ts";
import { display_FnSig } from "../../rustc_type_ir/ir_print.ts";
import { Variance } from "../../rustc_type_ir/lib.ts";
import { as_interner, TraitRef, visit_with_TraitRef } from "../../rustc_type_ir/predicate.ts";
import { debug_FnSig, FnHeader, FnSig, fold_FnSig, PolyFnSig, PolyFnSigTys, UnsafeBinderInner_deref } from "../../rustc_type_ir/ty_kind.ts";
import { ClosureArgs, CoroutineArgs, CoroutineClosureArgs } from "../../rustc_type_ir/ty_kind/closure.ts";
import { debug_NoSolution, type NoSolution } from "../../rustc_type_ir/solve/mod.ts";
import { VarianceDiagInfo } from "../../rustc_type_ir/relate.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { type TypeVisitable, TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import type { RegionBoundPairs } from "../../rustc_infer/infer/outlives/env.ts";
import { debug_Location, type Location as MirLocation } from "../../rustc_middle/mir/mod.ts";
import { type Debug, debug_option, debug_vec, type Fmt, format_debug, PLAIN, PRETTY } from "../../std/fmt.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { assert, assert_eq, unreachable, unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import { KeyedSet } from "../../rust_ts/keyed.ts";
import type { BorrowSet } from "../borrow_set.gen.ts";
import { clone_OutlivesConstraint, OutlivesConstraintSet } from "../constraints/mod.ts";
import { ToUniverseInfo_never } from "../diagnostics/bound_region_errors.ts";
import type { BorrowckInferCtxt, DeferredClosureRequirements } from "../lib.gen.ts";
import { PoloniusContext } from "../polonius/mod.gen.ts";
import { DeferredRegionLiveness } from "../polonius/liveness.gen.ts";
import type { PoloniusFacts, PoloniusRegionVid } from "../polonius/legacy/facts.gen.ts";
import type { BorrowIndex } from "../dataflow.gen.ts";
import type { LocationIndex } from "../polonius/legacy/location.gen.ts";
import type { PoloniusLocationTable } from "../polonius/legacy/location.gen.ts";
import { LivenessValues } from "../region_infer/values.gen.ts";
import { default_PlaceholderIndices } from "../region_infer/values.ts";
import type { RegionCtxt } from "../renumber.gen.ts";
import { MoveUnsized_diagnostic, SimdIntrinsicArgConst_diagnostic } from "../session_diagnostics.gen.ts";
import type { UniversalRegions } from "../universal_regions.gen.ts";
import * as gen from "./mod.gen.ts";
import { debug_Locations, type FieldAccessError, type InstantiateOpaqueType, MirTypeckRegionConstraints, type MirTypeckResults } from "./mod.gen.ts";

export * from "./mod.gen.ts";

/** Lazily read sibling modules (init order, see the header). */
let free_region_relations__m: typeof import("./free_region_relations.ts") | undefined;
function free_region_relations(): typeof import("./free_region_relations.ts") {
  return (free_region_relations__m ??= require("./free_region_relations.ts") as typeof import("./free_region_relations.ts"));
}
let constraint_conversion__m: typeof import("./constraint_conversion.ts") | undefined;
function constraint_conversion(): typeof import("./constraint_conversion.ts") {
  return (constraint_conversion__m ??= require("./constraint_conversion.ts") as typeof import("./constraint_conversion.ts"));
}
let liveness__m: typeof import("./liveness/mod.ts") | undefined;
function liveness(): typeof import("./liveness/mod.ts") {
  return (liveness__m ??= require("./liveness/mod.ts") as typeof import("./liveness/mod.ts"));
}
let path_utils__m: typeof import("../path_utils.ts") | undefined;
function path_utils(): typeof import("../path_utils.ts") {
  return (path_utils__m ??= require("../path_utils.ts") as typeof import("../path_utils.ts"));
}
let universal_regions__m: typeof import("../universal_regions.ts") | undefined;
function universal_regions(): typeof import("../universal_regions.ts") {
  return (universal_regions__m ??= require("../universal_regions.ts") as typeof import("../universal_regions.ts"));
}

declare module "./mod.gen.ts" {
  interface MirTypeckRegionConstraints {
    // mod.rs:299
    placeholder_region(infcx: InferCtxt, placeholder: PlaceholderRegion): Region;
  }
}

/// `macro_rules! span_mirbug` (mod.rs:53).
// PORT: a macro: `$context` is `cx`, `$elem` its `{:?}` (`elem`), `format_args!($($message)*)` the formatted `msg`.
function span_mirbug(cx: TypeChecker, elem: string, msg: string): void {
  mirbug(cx.tcx(), cx.last_span, `broken MIR in ${debug_DefId(cx.body_().source.def_id(), PLAIN)} (${elem}): ${msg}`);
}

/** `{:?}` of a value. */
function dbg<T>(v: T, d: Debug<T>): string {
  return format_debug(v, d, PLAIN);
}

/** `{:?}` of a `Ty`. */
function dbg_ty(ty: Ty): string {
  return debug_Ty(ty, PLAIN);
}

/** The derived `PartialEq` of `FnSig` (`inputs_and_output` is an interned list, `fn_sig_kind` plain data). */
// PORT: `sig != unnormalized_sig` (mod.rs:842).
function FnSig_eq(a: FnSig, b: FnSig): boolean {
  return a.inputs_and_output === b.inputs_and_output && a.fn_sig_kind.flags === b.fn_sig_kind.flags && a.fn_sig_kind.splatted === b.fn_sig_kind.splatted;
}

/** `{:?}` of `Vec<ProjectionKind>` (`ProjectionKind = ProjectionElem<(), ()>`). */
function debug_ProjectionKinds(v: readonly ProjectionKind[], f: Fmt): string {
  const debug_unit: Debug<null> = () => "()";
  return debug_vec(v, f, (e, f) => debug_ProjectionElem(e, f, debug_unit, debug_unit));
}

/** `{:?}` of `Option<Box<UserTypeProjections>>`. */
function debug_Option_UserTypeProjections(v: LocalDecl["user_ty"]): string {
  return debug_option(v, PLAIN, debug_UserTypeProjections);
}

/** `if let ty::ConstKind::Param(p) = ct.kind()`. */
function ConstKind_param(k: ConstKind): ParamConst | undefined {
  return k.$ === "Param" ? k._0 : undefined;
}

/** `Iterator::map`. */
function* map_iter<T, U>(it: Iterable<T>, f: (t: T) => U): Iterable<U> {
  for (const t of it) yield f(t);
}

/** `TraitRef: TypeVisitable` (for `ty::Binder::dummy`). */
const d_TraitRef: TypeVisitable<TraitRef> = { visit_with: visit_with_TraitRef };

/** The `loan_issued_at` relation of polonius-engine's `AllFacts` (`PoloniusFacts` is opaque until wave 26, D7). */
// PORT: only reached with `polonius_facts = Some(..)` (`-Znll-facts` / `-Zpolonius=legacy`), whose construction
// (`PoloniusFacts::default()`) stops `unported` in lib.ts.
interface PoloniusFactsLoanIssuedAt {
  loan_issued_at: [PoloniusRegionVid, BorrowIndex, LocationIndex][];
}
let facts_mod__m: typeof import("../polonius/legacy/facts.ts") | undefined;
function facts_mod(): typeof import("../polonius/legacy/facts.ts") {
  return (facts_mod__m ??= require("../polonius/legacy/facts.ts") as typeof import("../polonius/legacy/facts.ts"));
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
// rustc: compiler/rustc_borrowck/src/type_check/mod.rs:97 type_check
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
  // PORT: the derived `Default`s: `PlaceholderIndices` (values.ts's `default_PlaceholderIndices`: an `FxIndexSet` of
  // struct keys, a `KeyedSet` whose methods give the insertion index), `IndexVec`,
  // `OutlivesConstraintSet`, `Vec`, `FxIndexMap`.
  const constraints = new MirTypeckRegionConstraints(
    default_PlaceholderIndices(),
    [],
    LivenessValues.with_specific_points(location_map),
    new OutlivesConstraintSet([]),
    new Map(),
    [],
  );

  const { universal_region_relations, region_bound_pairs, normalized_inputs_and_output, known_type_outlives_obligations } = free_region_relations().create(
    infcx,
    universal_regions,
    constraints,
  );

  {
    // Scope these variables so it's clear they're not used later
    const pre_obligations = infcx.take_registered_region_obligations();
    assert(pre_obligations.length === 0, `there should be no incoming region obligations = ${format_debug(pre_obligations, (v, f) => debug_vec(v, f, debug_TypeOutlivesConstraint), PRETTY)}`);
    const pre_assumptions = infcx.take_registered_region_assumptions();
    assert(pre_assumptions.length === 0, `there should be no incoming region assumptions = ${format_debug(pre_assumptions, (v, f) => debug_vec(v, f, (x, f) => debug_OutlivesClause(x, f, debug_GenericArg)), PRETTY)}`);
  }

  // debug!(?normalized_inputs_and_output);

  // PORT: `PoloniusContext::default()` (derived): every field's `Default`.
  const polonius_context_0 = Polonius_is_next_enabled(infcx.tcx)
    ? new PoloniusContext(undefined, [], new Set(), new DeferredRegionLiveness([], []), undefined)
    : undefined;

  const deferred_closure_requirements: DeferredClosureRequirements = [];
  const typeck = new TypeChecker(
    infcx,
    body.span,
    body,
    promoted,
    body.user_type_annotations,
    region_bound_pairs,
    known_type_outlives_obligations,
    new KeyedSet<[Ty, Span]>(intern_key),
    universal_region_relations.universal_regions,
    location_table,
    polonius_facts,
    borrow_set,
    constraints,
    deferred_closure_requirements,
    polonius_context_0,
  );

  typeck.check_user_type_annotations();
  typeck.visit_body(body);
  typeck.equate_inputs_and_outputs(normalized_inputs_and_output);
  typeck.check_signature_annotation();

  liveness().generate(typeck, location_map, move_data);

  const polonius_context = typeck.polonius_context;

  if (infcx.tcx.assumptions_on_binders()) {
    const converter = constraint_conversion().ConstraintConversion.new(
      typeck.infcx,
      typeck.universal_regions,
      typeck.region_bound_pairs,
      typeck.known_type_outlives_obligations,
      { $: "All", _0: DUMMY_SP },
      DUMMY_SP,
      ConstraintCategory.Boring,
      typeck.constraints,
    );
    typeck.infcx.destructure_solver_region_constraints_for_borrowck(
      converter,
      typeck.known_type_outlives_obligations,
      typeck.region_bound_pairs,
      // PORT: `.clone()` of the frozen `TransitiveRelation`: the callee only reads it.
      universal_region_relations.outlives,
    );
  }

  // In case type check encountered an error region, we suppress unhelpful extra
  // errors in by clearing out all outlives bounds that we may end up checking.
  const guar = universal_region_relations.universal_regions.encountered_re_error();
  if (guar !== undefined) {
    // debug!("encountered an error region; removing constraints!");
    constraints.outlives_constraints = new OutlivesConstraintSet([]);
    constraints.type_tests = [];
    infcx.set_tainted_by_errors(guar);
  }

  return {
    constraints,
    universal_region_relations,
    region_bound_pairs,
    known_type_outlives_obligations,
    deferred_closure_requirements,
    polonius_context,
  };
}

/** `infcx.tcx.sess.opts.unstable_opts.polonius.is_next_enabled()` (mod.rs:140). */
function Polonius_is_next_enabled(tcx: TyCtxt): boolean {
  const config = require("../../rustc_session/config.ts") as typeof import("../../rustc_session/config.ts");
  return config.Polonius.is_next_enabled(tcx.sess.opts.unstable_opts.polonius);
}

// rustc: compiler/rustc_borrowck/src/type_check/mod.rs:213 mirbug
export function mirbug(tcx: TyCtxt, span: Span, msg: string): void {
  // We sometimes see MIR failures (notably predicate failures) due to
  // the fact that we check rvalue sized predicates here. So use `span_delayed_bug`
  // to avoid reporting bugs in those cases.
  tcx.dcx().span_delayed_bug(span, msg);
}

/// Creates a `Region` for a given `PlaceholderRegion`, or returns the
/// region that corresponds to a previously created one.
// rustc: compiler/rustc_borrowck/src/type_check/mod.rs:299 placeholder_region
MirTypeckRegionConstraints.prototype.placeholder_region = function (this: MirTypeckRegionConstraints, infcx: InferCtxt, placeholder: PlaceholderRegion): Region {
  const placeholder_index = this.placeholder_indices.insert(placeholder);
  const v = this.placeholder_index_to_region[placeholder_index];
  if (v !== undefined) {
    return v;
  } else {
    const origin: NllRegionVariableOrigin = { $: "Placeholder", _0: placeholder };
    const region = infcx.next_nll_region_var_in_universe(origin, placeholder.universe);
    this.placeholder_index_to_region.push(region);
    return region;
  }
};

export interface Locations_methods {
  // mod.rs:367
  from_location(self: Locations): MirLocation | undefined;
  // mod.rs:375
  span(self: Locations, body: Body): Span;
}
export type Locations = gen.Locations;
// PORT: the generator emits no companion for `Locations` (no unit variant): the companion holds only the methods.
export const Locations = {} as Locations_methods;

// rustc: compiler/rustc_borrowck/src/type_check/mod.rs:367 from_location
Locations.from_location = function (self: Locations): MirLocation | undefined {
  switch (self.$) {
    case "All":
      return undefined;
    case "Single":
      return self._0;
  }
};

/// Gets a span representing the location.
// rustc: compiler/rustc_borrowck/src/type_check/mod.rs:375 span
Locations.span = function (self: Locations, body: Body): Span {
  switch (self.$) {
    case "All":
      return self._0;
    case "Single":
      return body.source_info(self._0).span;
  }
};

/** `location.to_locations()` for a `Location` (`impl NormalizeLocation for Location`). */
function to_locations(location: Location): Locations {
  return NormalizeLocation_Location.to_locations(location);
}

// rustc-type: compiler/rustc_borrowck/src/type_check/mod.rs:228 TypeChecker
/// The MIR type checker. Visits the MIR and enforces all the
/// constraints needed for it to be valid and well-typed. Along the
/// way, it accrues region constraints -- these can later be used by
/// NLL region checking.
export class TypeChecker extends Visitor {
  constructor(
    public infcx: BorrowckInferCtxt,
    public last_span: Span,
    public body: Body,
    /// The bodies of all promoteds. As promoteds have a completely separate CFG
    /// recursing into them may corrupt your data structures if you're not careful.
    public promoted: readonly Body[],
    /// User type annotations are shared between the main MIR and the MIR of
    /// all of the promoted items.
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
    /// When using `-Zpolonius=next`, the liveness helper data used to create polonius constraints.
    public polonius_context: PoloniusContext | undefined,
  ) {
    super();
  }

  // ---- impl<'a, 'tcx> TypeChecker<'a, 'tcx> (mod.rs:383) ----

  // rustc: compiler/rustc_borrowck/src/type_check/mod.rs:384 tcx
  tcx(): TyCtxt {
    return this.infcx.tcx;
  }

  // rustc: compiler/rustc_borrowck/src/type_check/mod.rs:388 body
  body_(): Body {
    return this.body;
  }

  /// Equate the inferred type and the annotated type for user type annotations
  // rustc: compiler/rustc_borrowck/src/type_check/mod.rs:394 check_user_type_annotations
  check_user_type_annotations(): void {
    // debug!(?self.user_type_annotations);
    for (const user_annotation of this.user_type_annotations) {
      const { span, user_ty, inferred_ty } = user_annotation;
      const annotation = this.instantiate_canonical(span, user_ty, fold_UserType);
      this.ascribe_user_type(inferred_ty, annotation, span);
    }
  }

  // rustc: compiler/rustc_borrowck/src/type_check/mod.rs:404 push_region_constraints
  push_region_constraints(locations: Locations, category: ConstraintCategory, data: QueryRegionConstraints): void {
    // debug!("constraints generated: {:#?}", data);

    constraint_conversion()
      .ConstraintConversion.new(
        this.infcx,
        this.universal_regions,
        this.region_bound_pairs,
        this.known_type_outlives_obligations,
        locations,
        Locations.span(locations, this.body),
        category,
        this.constraints,
      )
      .convert_all(data);
  }

  /// Try to relate `sub <: sup`
  // rustc: compiler/rustc_borrowck/src/type_check/mod.rs:426 sub_types
  sub_types(sub: Ty, sup: Ty, locations: Locations, category: ConstraintCategory): Result<null, NoSolution> {
    // Use this order of parameters because the sup type is usually the
    // "expected" type in diagnostics.
    return this.relate_types(sup, Variance.Contravariant, sub, locations, category);
  }

  // rustc: compiler/rustc_borrowck/src/type_check/mod.rs:439 eq_types
  eq_types(expected: Ty, found: Ty, locations: Locations, category: ConstraintCategory): Result<null, NoSolution> {
    return this.relate_types(expected, Variance.Invariant, found, locations, category);
  }

  // rustc: compiler/rustc_borrowck/src/type_check/mod.rs:450 relate_type_and_user_type
  relate_type_and_user_type(a: Ty, v: Variance, user_ty: UserTypeProjection, locations: Locations, category: ConstraintCategory): Result<null, NoSolution> {
    const annotated_type = this.user_type_annotations[user_ty.base]!.inferred_ty;
    // trace!(?annotated_type);
    let curr_projected_ty = PlaceTy.from_ty(annotated_type);

    const tcx = this.infcx.tcx;

    for (const proj of user_ty.projs) {
      // Necessary for non-trivial patterns whose user-type annotation is an opaque type,
      // e.g. `let (_a,): Tait = whatever`, see #105897
      if (!this.infcx.next_trait_solver()) {
        const k = curr_projected_ty.ty.kind();
        if (k.$ === "Alias" && k._1.kind.$ === "Opaque") {
          // There is nothing that we can compare here if we go through an opaque type.
          // We're always in its defining scope as we can otherwise not project through
          // it, so we're constraining it anyways.
          return Ok(null);
        }
      }
      const projected_ty = curr_projected_ty.projection_ty_core<null, null>(
        tcx,
        proj,
        (ty, variant_index, field_index, _) =>
          this.normalize(PlaceTy.field_ty(tcx, ty, variant_index, field_index), locations, Normalizable_Ty, display_Ty, NormalizeLocation_Locations),
        (_) => unreachable(),
      );
      curr_projected_ty = projected_ty;
    }
    // trace!(?curr_projected_ty);

    // Need to renormalize `a` in the old solver as typecheck may have failed
    // to normalize higher-ranked aliases if normalization was ambiguous due
    // to inference.
    //
    // We properly normalize higher-ranked aliases during writeback with the
    // new solver, so this is no longer necessary.
    let a_ = a;
    let ty = curr_projected_ty.ty;
    if (!this.infcx.next_trait_solver()) {
      a_ = this.normalize(Unnormalized.new_wip(a_), locations, Normalizable_Ty, display_Ty, NormalizeLocation_Locations);
      ty = this.normalize(Unnormalized.new_wip(ty), locations, Normalizable_Ty, display_Ty, NormalizeLocation_Locations);
    }
    const r = this.relate_types(ty, Variance.xform(v, Variance.Contravariant), a_, locations, category);
    if (r.$ === "Err") return r;

    return Ok(null);
  }

  // rustc: compiler/rustc_borrowck/src/type_check/mod.rs:508 check_promoted
  check_promoted(promoted_body: Body, location: Location): void {
    // Determine the constraints from the promoted MIR by running the type
    // checker on the promoted MIR, then transfer the constraints back to
    // the main MIR, changing the locations to the provided location.

    const parent_body = this.body;
    this.body = promoted_body;

    // Use new sets of constraints and closure bounds so that we can
    // modify their locations.
    const polonius_facts: MutRef<PoloniusFacts | undefined> = { value: undefined };
    let constraints = new OutlivesConstraintSet([]);
    let liveness_constraints = LivenessValues.without_specific_points(DenseLocationMap.new(promoted_body));
    let deferred_closure_requirements: DeferredClosureRequirements = [];

    // Don't try to add borrow_region facts for the promoted MIR as they refer
    // to the wrong locations.
    // PORT: `mem::swap` of the `&mut` targets: the option inside the `MutRef`, the two constraint fields of the shared
    // `MirTypeckRegionConstraints`, and the `deferred_closure_requirements` vector (its contents, so the caller's
    // vector object keeps its identity).
    const swap_constraints = (this_: TypeChecker): void => {
      const facts = this_.polonius_facts.value;
      this_.polonius_facts.value = polonius_facts.value;
      polonius_facts.value = facts;
      const outlives = this_.constraints.outlives_constraints;
      this_.constraints.outlives_constraints = constraints;
      constraints = outlives;
      const live = this_.constraints.liveness_constraints;
      this_.constraints.liveness_constraints = liveness_constraints;
      liveness_constraints = live;
      const deferred = this_.deferred_closure_requirements.splice(0, this_.deferred_closure_requirements.length, ...deferred_closure_requirements);
      deferred_closure_requirements = deferred;
    };

    swap_constraints(this);

    this.visit_body(promoted_body);

    this.body = parent_body;

    // Merge the outlives constraints back in, at the given location.
    swap_constraints(this);
    const locations = to_locations(location);
    for (const constraint_ of constraints.outlives_()) {
      const constraint = clone_OutlivesConstraint(constraint_);
      constraint.locations = locations;
      if (constraint.category.$ === "Return" || constraint.category.$ === "UseAsConst" || constraint.category.$ === "UseAsStatic") {
        // "Returning" from a promoted is an assignment to a
        // temporary from the user's point of view.
        constraint.category = ConstraintCategory.Boring;
      }
      this.constraints.outlives_constraints.push(constraint);
    }

    // If there are nested bodies in promoteds, we also need to update their
    // location to something in the actual body, not the promoted.
    //
    // We don't update the constraint categories of the resulting constraints
    // as returns in nested bodies are a proper return, even if that nested body
    // is in a promoted.
    for (const [closure_def_id, args, _locations] of deferred_closure_requirements) {
      this.deferred_closure_requirements.push([closure_def_id, args, locations]);
    }

    // If the region is live at least one location in the promoted MIR,
    // then add a liveness constraint to the main MIR for this region
    // at the location provided as an argument to this method
    //
    // add_location doesn't care about ordering so not a problem for the live regions to be
    // unordered.
    // #[allow(rustc::potential_query_instability)]
    for (const region of liveness_constraints.live_regions_unordered()) {
      this.constraints.liveness_constraints.add_location(region, location);
    }
  }

  // ---- impl<'a, 'tcx> Visitor<'tcx> for TypeChecker<'a, 'tcx> (mod.rs:578) ----

  // rustc: compiler/rustc_borrowck/src/type_check/mod.rs:579 visit_span
  override visit_span(span: Span): void {
    if (!Span.is_dummy(span)) {
      // debug!(?span);
      this.last_span = span;
    }
  }

  // rustc: compiler/rustc_borrowck/src/type_check/mod.rs:587 visit_body
  override visit_body(body: Body): void {
    // debug_assert!(std::ptr::eq(self.body, body));

    for (let i = 0; i < body.local_decls.length; i++) {
      const local = LocalC.new(i);
      this.visit_local_decl(local, body.local_decls[local]!);
    }

    const blocks = body.basic_blocks.deref();
    for (let i = 0; i < blocks.length; i++) {
      const block = BasicBlockC.new(i);
      const block_data = blocks[block]!;
      // PORT: `location` is a `Copy` value mutated in place: each visit gets its own copy.
      const location = BasicBlockC.start_location(block);
      for (const stmt of block_data.statements) {
        this.visit_statement(stmt, clone_Location(location));
        location.statement_index += 1;
      }

      this.visit_terminator(block_data.terminator_(), location);
      this.check_iscleanup(block_data);
    }
  }

  // rustc: compiler/rustc_borrowck/src/type_check/mod.rs:607 visit_statement
  override visit_statement(stmt: Statement, location: Location): void {
    this.super_statement(stmt, location);
    const tcx = this.tcx();
    const kind = stmt.kind;
    switch (kind.$) {
      case "Assign": {
        const [place, rv] = kind._0;
        // Assignments to temporaries are not "interesting";
        // they are not caused by the user, but rather artifacts
        // of lowering. Assignments to other sorts of places *are* interesting
        // though.
        let category: ConstraintCategory;
        const l = place.as_local();
        if (l === RETURN_PLACE) {
          const defining_ty = this.universal_regions.defining_ty;
          const DefiningTy = universal_regions().DefiningTy;
          if (DefiningTy.is_const(defining_ty)) {
            if (tcx.is_static(DefiningTy.def_id(defining_ty))) {
              category = ConstraintCategory.UseAsStatic;
            } else {
              category = ConstraintCategory.UseAsConst;
            }
          } else {
            category = { $: "Return", _0: ReturnConstraint.Normal };
          }
        } else if (l !== undefined && this.body.local_decls[l]!.local_info_().$ === "AggregateTemp") {
          category = ConstraintCategory.Usage;
        } else if (l !== undefined && !this.body.local_decls[l]!.is_user_variable()) {
          category = ConstraintCategory.Boring;
        } else {
          category = ConstraintCategory.Assignment;
        }
        // debug!("assignment category: {:?} {:?}", category, place.as_local().map(|l| &self.body.local_decls[l]));

        const place_ty_0 = place.ty(this.body, tcx).ty;
        // debug!(?place_ty);
        const place_ty = this.normalize(Unnormalized.new_wip(place_ty_0), location, Normalizable_Ty, display_Ty, NormalizeLocation_Location);
        // debug!("place_ty normalized: {:?}", place_ty);
        const rv_ty_0 = Rvalue.ty(rv, this.body, tcx);
        // debug!(?rv_ty);
        const rv_ty = this.normalize(Unnormalized.new_wip(rv_ty_0), location, Normalizable_Ty, display_Ty, NormalizeLocation_Location);
        // debug!("normalized rv_ty: {:?}", rv_ty);
        const r = this.sub_types(rv_ty, place_ty, to_locations(location), category);
        if (r.$ === "Err") {
          const terr = r._0;
          span_mirbug(this, dbg(stmt, debug_Statement), `bad assignment (${dbg_ty(place_ty)} = ${dbg_ty(rv_ty)}): ${dbg(terr, debug_NoSolution)}`);
        }

        const annotation_index = this.rvalue_user_ty(rv);
        if (annotation_index !== undefined) {
          const r = this.relate_type_and_user_type(
            rv_ty,
            Variance.Invariant,
            { base: annotation_index, projs: [] },
            to_locations(location),
            { $: "TypeAnnotation", _0: "GenericArg" },
          );
          if (r.$ === "Err") {
            const terr = r._0;
            const annotation = this.user_type_annotations[annotation_index]!;
            span_mirbug(
              this,
              dbg(stmt, debug_Statement),
              `bad user type on rvalue (${dbg(annotation, debug_CanonicalUserTypeAnnotation)} = ${dbg_ty(rv_ty)}): ${dbg(terr, debug_NoSolution)}`,
            );
          }
        }

        if (!this.tcx().features().unsized_fn_params()) {
          const trait_ref = TraitRef.new(as_interner(tcx), tcx.require_lang_item(LangItem.Sized, this.last_span), [GenericArg.from_Ty(place_ty)]);
          this.prove_trait_ref(trait_ref, to_locations(location), ConstraintCategory.SizedBound);
        }
        break;
      }
      case "AscribeUserType": {
        const [place, projection] = kind._0;
        const variance = kind._1;
        const place_ty = place.ty(this.body, tcx).ty;
        const r = this.relate_type_and_user_type(
          place_ty,
          variance,
          projection,
          { $: "All", _0: stmt.source_info.span },
          { $: "TypeAnnotation", _0: "Ascription" },
        );
        if (r.$ === "Err") {
          const terr = r._0;
          const annotation = this.user_type_annotations[projection.base]!;
          span_mirbug(
            this,
            dbg(stmt, debug_Statement),
            `bad type assert (${dbg_ty(place_ty)} <: ${dbg(annotation, debug_CanonicalUserTypeAnnotation)} with projections ${dbg(projection.projs, debug_ProjectionKinds)}): ${dbg(terr, debug_NoSolution)}`,
          );
        }
        break;
      }
      case "Intrinsic":
        if (kind._0.$ === "Assume") break;
        // CopyNonOverlapping
        return bug("Statement not allowed in this MIR phase");
      case "FakeRead":
      case "StorageLive":
      case "StorageDead":
      case "Coverage":
      case "ConstEvalCounter":
      case "PlaceMention":
      case "BackwardIncompatibleDropHint":
      case "Nop":
        break;
      case "SetDiscriminant":
        return bug("Statement not allowed in this MIR phase");
    }
  }

  // rustc: compiler/rustc_borrowck/src/type_check/mod.rs:740 visit_terminator
  override visit_terminator(term: Terminator, term_location: Location): void {
    this.super_terminator(term, term_location);
    const tcx = this.tcx();
    // debug!("terminator kind: {:?}", term.kind);
    const kind = term.kind;
    switch (kind.$) {
      case "Goto":
      case "UnwindResume":
      case "UnwindTerminate":
      case "Return":
      case "CoroutineDrop":
      case "Unreachable":
      case "Drop":
      case "FalseEdge":
      case "FalseUnwind":
      case "InlineAsm":
        // no checks needed for these
        break;

      case "SwitchInt": {
        const switch_ty = Operand.ty(kind.discr, this.body, tcx);
        if (!switch_ty.is_integral() && !switch_ty.is_char() && !switch_ty.is_bool()) {
          span_mirbug(this, dbg(term, debug_Terminator), `bad SwitchInt discr ty ${dbg_ty(switch_ty)}`);
        }
        // FIXME: check the values
        break;
      }
      case "Call":
      case "TailCall": {
        const { func, args } = kind;
        let call_source: CallSource;
        let destination: Place;
        let is_diverging: boolean;
        if (kind.$ === "Call") {
          [call_source, destination, is_diverging] = [kind.call_source, kind.destination, kind.target === undefined];
        } else {
          [call_source, destination, is_diverging] = ["Normal", Place_from_Local(RETURN_PLACE), false];
        }

        const func_ty = Operand.ty(func, this.body, tcx);
        // debug!("func_ty.kind: {:?}", func_ty.kind());

        let sig_0: Binder<FnSig>;
        const fk = func_ty.kind();
        if (fk.$ === "FnDef" || fk.$ === "FnPtr") {
          sig_0 = func_ty.fn_sig(tcx);
        } else {
          span_mirbug(this, dbg(term, debug_Terminator), `call to non-function ${dbg_ty(func_ty)}`);
          return;
        }
        const [unnormalized_sig, map] = tcx.instantiate_bound_regions(
          sig_0,
          (br) => {
            const region_ctxt_fn = (): RegionCtxt => {
              let reg_info: Symbol;
              switch (br.kind.$) {
                case "Anon":
                  reg_info = sym.anon;
                  break;
                case "Named":
                  reg_info = tcx.item_name(br.kind._0);
                  break;
                case "ClosureEnv":
                  reg_info = sym.env;
                  break;
                case "NamedForPrinting":
                  return bug("only used for pretty printing");
              }

              return { $: "LateBound", _0: reg_info };
            };

            const origin: RegionVariableOrigin = { $: "BoundRegion", _0: term.source_info.span, _1: br.kind, _2: BoundRegionConversionTime.FnCall };
            return this.infcx.next_region_var(origin, region_ctxt_fn);
          },
          fold_FnSig,
        );
        // debug!(?unnormalized_sig);
        // IMPORTANT: We have to prove well formed for the function signature before
        // we normalize it, as otherwise types like `<&'a &'b () as Trait>::Assoc`
        // get normalized away, causing us to ignore the `'b: 'a` bound used by the function.
        //
        // Normalization results in a well formed type if the input is well formed, so we
        // don't have to check it twice.
        //
        // See #91068 for an example.
        this.prove_clauses(
          unnormalized_sig.inputs_and_output.map((ty): ClauseKind => ({ $: "WellFormed", _0: Term.from_Ty(ty) })),
          to_locations(term_location),
          ConstraintCategory.Boring,
          Clause_upcast_from_ClauseKind,
        );

        const sig_r = this.deeply_normalize(Unnormalized.new_wip(unnormalized_sig), term_location, Normalizable_FnSig, display_FnSig, NormalizeLocation_Location);
        let sig: FnSig;
        if (sig_r.$ === "Ok") {
          sig = sig_r._0;
        } else {
          const _: ErrorGuaranteed = sig_r._0;
          return;
        }
        // HACK(#114936): `WF(sig)` does not imply `WF(normalized(sig))`
        // with built-in `Fn` implementations, since the impl may not be
        // well-formed itself.
        if (!FnSig_eq(sig, unnormalized_sig)) {
          this.prove_clauses(
            sig.inputs_and_output.map((ty): ClauseKind => ({ $: "WellFormed", _0: Term.from_Ty(ty) })),
            to_locations(term_location),
            ConstraintCategory.Boring,
            Clause_upcast_from_ClauseKind,
          );
        }

        this.check_call_dest(term, sig, destination, is_diverging, term_location);

        // The ordinary liveness rules will ensure that all
        // regions in the type of the callee are live here. We
        // then further constrain the late-bound regions that
        // were instantiated at the call site to be live as
        // well. The resulting is that all the input (and
        // output) types in the signature must be live, since
        // all the inputs that fed into it were live.
        for (const late_bound_region of map.values()) {
          const region_vid = this.universal_regions.to_region_vid(late_bound_region);
          this.constraints.liveness_constraints.add_location(region_vid, term_location);
        }

        this.check_call_inputs(term, func, sig, args, term_location, call_source);
        break;
      }
      case "Assert": {
        const { cond, msg } = kind;
        const cond_ty = Operand.ty(cond, this.body, tcx);
        if (cond_ty !== tcx.types.bool) {
          span_mirbug(this, dbg(term, debug_Terminator), `bad Assert (${dbg_ty(cond_ty)}, not bool`);
        }

        if (msg.$ === "BoundsCheck") {
          const { len, index } = msg;
          if (Operand.ty(len, this.body, tcx) !== tcx.types.usize) {
            span_mirbug(this, dbg(len, debug_Operand), `bounds-check length non-usize ${dbg(len, debug_Operand)}`);
          }
          if (Operand.ty(index, this.body, tcx) !== tcx.types.usize) {
            span_mirbug(this, dbg(index, debug_Operand), `bounds-check index non-usize ${dbg(index, debug_Operand)}`);
          }
        }
        break;
      }
      case "Yield": {
        const { value, resume_arg } = kind;
        const yield_ty = this.body.yield_ty();
        if (yield_ty === undefined) {
          span_mirbug(this, dbg(term, debug_Terminator), "yield in non-coroutine");
        } else {
          const ty = yield_ty;
          const value_ty = Operand.ty(value, this.body, tcx);
          const r = this.sub_types(value_ty, ty, to_locations(term_location), ConstraintCategory.Yield);
          if (r.$ === "Err") {
            const terr = r._0;
            span_mirbug(
              this,
              dbg(term, debug_Terminator),
              `type of yield value is ${dbg_ty(value_ty)}, but the yield type is ${dbg_ty(ty)}: ${dbg(terr, debug_NoSolution)}`,
            );
          }
        }

        const resume_ty_ = this.body.resume_ty();
        if (resume_ty_ === undefined) {
          span_mirbug(this, dbg(term, debug_Terminator), "yield in non-coroutine");
        } else {
          const ty = resume_ty_;
          const resume_ty = resume_arg.ty(this.body, tcx);
          const r = this.sub_types(ty, resume_ty.ty, to_locations(term_location), ConstraintCategory.Yield);
          if (r.$ === "Err") {
            const terr = r._0;
            span_mirbug(
              this,
              dbg(term, debug_Terminator),
              `type of resume place is ${dbg(resume_ty, debug_PlaceTy)}, but the resume type is ${dbg_ty(ty)}: ${dbg(terr, debug_NoSolution)}`,
            );
          }
        }
        break;
      }
    }
  }

  // rustc: compiler/rustc_borrowck/src/type_check/mod.rs:931 visit_local_decl
  override visit_local_decl(local: Local, local_decl: LocalDecl): void {
    this.super_local_decl(local, local_decl);

    for (const user_ty of local_decl.user_ty === undefined ? [] : local_decl.user_ty.projections()) {
      const span = this.user_type_annotations[user_ty.base]!.span;

      let ty: Ty;
      if (local_decl.is_nonref_binding()) {
        ty = local_decl.ty;
      } else {
        const k = local_decl.ty.kind();
        if (k.$ === "Ref") {
          // If we have a binding of the form `let ref x: T = ..`
          // then remove the outermost reference so we can check the
          // type annotation for the remaining type.
          ty = k._1;
        } else {
          return bug(`${dbg(local, debug_Local)} with ref binding has wrong type ${display_Ty(local_decl.ty)}`);
        }
      }

      const r = this.relate_type_and_user_type(ty, Variance.Invariant, user_ty, { $: "All", _0: span }, { $: "TypeAnnotation", _0: "Declaration" });
      if (r.$ === "Err") {
        const terr = r._0;
        span_mirbug(
          this,
          dbg(local, debug_Local),
          `bad user type on variable ${dbg(local, debug_Local)}: ${dbg_ty(local_decl.ty)} != ${debug_Option_UserTypeProjections(local_decl.user_ty)} (${dbg(terr, debug_NoSolution)})`,
        );
      }
    }

    // When `unsized_fn_params` is enabled, this is checked in `check_call_dest`,
    // and `hir_typeck` still forces all non-argument locals to be sized (i.e., we don't
    // fully re-check what was already checked on HIR).
    if (!this.tcx().features().unsized_fn_params()) {
      switch (this.body.local_kind(local)) {
        case "ReturnPointer":
        case "Arg":
          // return values of normal functions are required to be
          // sized by typeck, but return values of ADT constructors are
          // not because we don't include a `Self: Sized` bounds on them.
          //
          // Unbound parts of arguments were never required to be Sized
          // - maybe we should make that a warning.
          return;
        case "Temp": {
          const span = local_decl.source_info.span;
          const ty = local_decl.ty;
          this.ensure_place_sized(ty, span);
          break;
        }
      }
    }
  }

  // rustc: compiler/rustc_borrowck/src/type_check/mod.rs:993 visit_rvalue
  override visit_rvalue(rvalue: Rvalue, location: Location): void {
    this.super_rvalue(rvalue, location);
    const tcx = this.tcx();
    const span = this.body.source_info(location).span;
    switch (rvalue.$) {
      case "Aggregate":
        this.check_aggregate_rvalue(rvalue, rvalue._0, rvalue._1, location);
        break;

      case "Repeat": {
        const [operand, len] = [rvalue._0, rvalue._1];
        const array_ty = Rvalue.ty(rvalue, this.body.local_decls, tcx);
        this.prove_clause<ClauseKind>({ $: "WellFormed", _0: Term.from_Ty(array_ty) }, { $: "Single", _0: location }, ConstraintCategory.Boring, Clause_upcast_from_ClauseKind);

        // If the length cannot be evaluated we must assume that the length can be larger
        // than 1.
        // If the length is larger than 1, the repeat expression will need to copy the
        // element, so we require the `Copy` trait.
        const len_ = len.try_to_target_usize(tcx);
        if (len_ === undefined || len_ > 1) {
          switch (operand.$) {
            case "Copy":
            case "Constant":
            case "RuntimeChecks":
              // These are always okay: direct use of a const, or a value that can
              // evidently be copied.
              break;
            case "Move": {
              const place = operand._0;
              // Make sure that repeated elements implement `Copy`.
              const ty = place.ty(this.body, tcx).ty;
              const trait_ref = TraitRef.new(as_interner(tcx), tcx.require_lang_item(LangItem.Copy, span), [GenericArg.from_Ty(ty)]);

              this.prove_trait_ref(trait_ref, { $: "Single", _0: location }, ConstraintCategory.CopyBound);
              break;
            }
          }
        }
        break;
      }

      case "Cast":
        this.visit_rvalue_cast(rvalue, rvalue._0, rvalue._1, rvalue._2, location, span);
        break;

      case "Ref": {
        const [region, _borrow_kind, borrowed_place] = [rvalue._0, rvalue._1, rvalue._2];
        this.add_reborrow_constraint(location, region, borrowed_place);
        break;
      }

      case "Reborrow": {
        const [target, mutability, borrowed_place] = [rvalue._0, rvalue._1, rvalue._2];
        this.add_generic_reborrow_constraint(mutability, location, borrowed_place, target);
        break;
      }

      case "BinaryOp": {
        const op = rvalue._0;
        if (op === "Eq" || op === "Ne" || op === "Lt" || op === "Le" || op === "Gt" || op === "Ge") {
          const [left, right] = rvalue._1;
          const ty_left = Operand.ty(left, this.body, tcx);
          const kl = ty_left.kind();
          if (kl.$ === "RawPtr" || kl.$ === "FnPtr") {
            // Types with regions are comparable if they have a common super-type.
            const ty_right = Operand.ty(right, this.body, tcx);
            const common_ty = this.infcx.next_ty_var(this.body.source_info(location).span);
            const r0 = this.sub_types(ty_left, common_ty, to_locations(location), { $: "CallArgument", _0: undefined });
            if (r0.$ === "Err") {
              const err = r0._0;
              bug(`Could not equate type variable with ${dbg_ty(ty_left)}: ${dbg(err, debug_NoSolution)}`);
            }
            const r = this.sub_types(ty_right, common_ty, to_locations(location), { $: "CallArgument", _0: undefined });
            if (r.$ === "Err") {
              const terr = r._0;
              span_mirbug(
                this,
                dbg(rvalue, debug_Rvalue),
                `unexpected comparison types ${dbg_ty(ty_left)} and ${dbg_ty(ty_right)} yields ${dbg(terr, debug_NoSolution)}`,
              );
            }
          } else if (
            // For types with no regions we can just check that the
            // both operands have the same type.
            (kl.$ === "Int" || kl.$ === "Uint" || kl.$ === "Bool" || kl.$ === "Char" || kl.$ === "Float") &&
            ty_left === Operand.ty(right, this.body, tcx)
          ) {
            // ok
          } else {
            // Other types are compared by trait methods, not by
            // `Rvalue::BinaryOp`.
            span_mirbug(this, dbg(rvalue, debug_Rvalue), `unexpected comparison types ${dbg_ty(ty_left)} and ${dbg_ty(Operand.ty(right, this.body, tcx))}`);
          }
        }
        // The other `BinaryOp`s: no checks (the last arm).
        break;
      }

      case "WrapUnsafeBinder": {
        const [op, ty] = [rvalue._0, rvalue._1];
        const operand_ty = Operand.ty(op, this.body, this.tcx());
        const k = ty.kind();
        if (k.$ !== "UnsafeBinder") {
          return unreachable();
        }
        const binder_ty = k._0;
        const expected_ty = this.infcx.instantiate_binder_with_fresh_vars(
          this.body_().source_info(location).span,
          BoundRegionConversionTime.HigherRankedType,
          UnsafeBinderInner_deref(binder_ty),
          fold_Ty,
        );
        unwrap(this.sub_types(operand_ty, expected_ty, to_locations(location), ConstraintCategory.Boring));
        break;
      }

      case "Use":
      case "UnaryOp":
      case "CopyForDeref":
      case "RawPtr":
      case "ThreadLocalRef":
      case "Discriminant":
        break;
    }
  }

  /** The `Rvalue::Cast(cast_kind, op, ty)` arm of `visit_rvalue` (mod.rs:1037). */
  // PORT: split out of `visit_rvalue` for size only (no marker: not an upstream fn); `return` here is the arm's `return`
  // out of `visit_rvalue`, which has nothing after the `match`.
  private visit_rvalue_cast(rvalue: Rvalue, cast_kind: CastKind, op: Operand, ty: Ty, location: Location, span: Span): void {
    const tcx = this.tcx();
    const cast_category = (is_implicit_coercion: boolean): ConstraintCategory => ({
      $: "Cast",
      is_raw_ptr_dyn_type_cast: false,
      is_implicit_coercion,
      unsize_to: undefined,
    });
    switch (cast_kind.$) {
      case "PointerCoercion": {
        const [coercion, coercion_source] = [cast_kind._0, cast_kind._1];
        switch (coercion.$) {
          case "ReifyFnPointer": {
            const target_safety = coercion._0;
            const is_implicit_coercion = coercion_source === "Implicit";
            const src_ty = Operand.ty(op, this.body, tcx);
            let src_sig = src_ty.fn_sig(tcx);
            const sk = src_ty.kind();
            const tk = ty.kind();
            if (sk.$ === "FnDef" && tk.$ === "FnPtr") {
              const def_id = sk._0;
              const target_hdr = tk._1;
              if ((tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs).safe_target_features && Safety.is_safe(FnHeader.safety(target_hdr))) {
                const safe_sig = tcx.adjust_target_feature_sig(def_id, src_sig, this.body.source.def_id());
                if (safe_sig !== undefined) {
                  src_sig = safe_sig;
                }
              }
            }

            if (Safety.is_safe(PolyFnSig.safety(src_sig)) && Safety.is_unsafe(target_safety)) {
              src_sig = tcx.safe_to_unsafe_sig(src_sig);
            }

            // HACK: This shouldn't be necessary... We can remove this when we actually
            // get binders with where clauses, then elaborate implied bounds into that
            // binder, and implement a higher-ranked subtyping algorithm that actually
            // respects these implied bounds.
            //
            // This protects against the case where we are casting from a higher-ranked
            // fn item to a non-higher-ranked fn pointer, where the cast throws away
            // implied bounds that would've needed to be checked at the call site. This
            // only works when we're casting to a non-higher-ranked fn ptr, since
            // placeholders in the target signature could have untracked implied
            // bounds, resulting in incorrect errors.
            //
            // We check that this signature is WF before subtyping the signature with
            // the target fn sig.
            if (TypeVisitableExt.has_bound_regions(src_sig, fold_Binder(fold_FnSig))) {
              const tk2 = ty.kind();
              if (tk2.$ === "FnPtr") {
                const [target_fn_tys, target_hdr] = [tk2._0, tk2._1];
                const target_sig_0 = PolyFnSigTys.with(target_fn_tys, target_hdr);
                const target_sig = Binder.no_bound_vars(target_sig_0, fold_FnSig);
                if (target_sig !== undefined) {
                  const src_sig_ = this.infcx.instantiate_binder_with_fresh_vars(span, BoundRegionConversionTime.HigherRankedType, src_sig, fold_FnSig);
                  const src_ty_0 = Ty.new_fn_ptr(this.tcx(), Binder.dummy(src_sig_, fold_FnSig));
                  this.prove_clause<ClauseKind>(
                    { $: "WellFormed", _0: Term.from_Ty(src_ty_0) },
                    to_locations(location),
                    cast_category(is_implicit_coercion),
                    Clause_upcast_from_ClauseKind,
                  );

                  const src_ty_1 = this.normalize(Unnormalized.new_wip(src_ty_0), location, Normalizable_Ty, display_Ty, NormalizeLocation_Location);
                  const r = this.sub_types(src_ty_1, ty, to_locations(location), cast_category(is_implicit_coercion));
                  if (r.$ === "Err") {
                    const terr = r._0;
                    span_mirbug(
                      this,
                      dbg(rvalue, debug_Rvalue),
                      `equating ${dbg(target_sig, debug_FnSig)} with ${dbg(src_sig_, debug_FnSig)} yields ${dbg(terr, debug_NoSolution)}`,
                    );
                  }
                }
              }
            }

            const src_ty_2 = Ty.new_fn_ptr(tcx, src_sig);
            // HACK: We want to assert that the signature of the source fn is
            // well-formed, because we don't enforce that via the WF of FnDef
            // types normally. This should be removed when we improve the tracking
            // of implied bounds of fn signatures.
            this.prove_clause<ClauseKind>(
              { $: "WellFormed", _0: Term.from_Ty(src_ty_2) },
              to_locations(location),
              cast_category(is_implicit_coercion),
              Clause_upcast_from_ClauseKind,
            );

            // The type that we see in the fcx is like
            // `foo::<'a, 'b>`, where `foo` is the path to a
            // function definition. When we extract the
            // signature, it comes from the `fn_sig` query,
            // and hence may contain unnormalized results.
            const src_ty_3 = this.normalize(Unnormalized.new_wip(src_ty_2), location, Normalizable_Ty, display_Ty, NormalizeLocation_Location);
            const r = this.sub_types(src_ty_3, ty, to_locations(location), cast_category(is_implicit_coercion));
            if (r.$ === "Err") {
              const terr = r._0;
              span_mirbug(this, dbg(rvalue, debug_Rvalue), `equating ${dbg_ty(src_ty_3)} with ${dbg_ty(ty)} yields ${dbg(terr, debug_NoSolution)}`);
            }
            break;
          }

          case "ClosureFnPointer": {
            const safety = coercion._0;
            const ok = Operand.ty(op, this.body, tcx).kind();
            let sig: Binder<FnSig>;
            if (ok.$ === "Closure") {
              sig = ClosureArgs.sig(ok._1.as_closure());
            } else {
              return bug();
            }
            const ty_fn_ptr_from = Ty.new_fn_ptr(tcx, tcx.signature_unclosure(sig, safety));

            const is_implicit_coercion = coercion_source === "Implicit";
            const r = this.sub_types(ty_fn_ptr_from, ty, to_locations(location), cast_category(is_implicit_coercion));
            if (r.$ === "Err") {
              const terr = r._0;
              span_mirbug(this, dbg(rvalue, debug_Rvalue), `equating ${dbg_ty(ty_fn_ptr_from)} with ${dbg_ty(ty)} yields ${dbg(terr, debug_NoSolution)}`);
            }
            break;
          }

          case "UnsafeFnPointer": {
            const fn_sig_0 = Operand.ty(op, this.body, tcx).fn_sig(tcx);

            // The type that we see in the fcx is like
            // `foo::<'a, 'b>`, where `foo` is the path to a
            // function definition. When we extract the
            // signature, it comes from the `fn_sig` query,
            // and hence may contain unnormalized results.
            const fn_sig = this.normalize(Unnormalized.new_wip(fn_sig_0), location, Normalizable_PolyFnSig, display_PolyFnSig, NormalizeLocation_Location);

            const ty_fn_ptr_from = tcx.safe_to_unsafe_fn_ty(fn_sig);

            const is_implicit_coercion = coercion_source === "Implicit";
            const r = this.sub_types(ty_fn_ptr_from, ty, to_locations(location), cast_category(is_implicit_coercion));
            if (r.$ === "Err") {
              const terr = r._0;
              span_mirbug(this, dbg(rvalue, debug_Rvalue), `equating ${dbg_ty(ty_fn_ptr_from)} with ${dbg_ty(ty)} yields ${dbg(terr, debug_NoSolution)}`);
            }
            break;
          }

          case "Unsize": {
            const trait_ref = TraitRef.new(as_interner(tcx), tcx.require_lang_item(LangItem.CoerceUnsized, span), [
              GenericArg.from_Ty(Operand.ty(op, this.body, tcx)),
              GenericArg.from_Ty(ty),
            ]);

            const is_implicit_coercion = coercion_source === "Implicit";
            const unsize_to = fold_regions(tcx, ty, (r, _) => (r.kind().$ === "ReVar" ? tcx.lifetimes.re_erased : r), fold_Ty);
            this.prove_trait_ref(trait_ref, to_locations(location), {
              $: "Cast",
              is_raw_ptr_dyn_type_cast: false,
              is_implicit_coercion,
              unsize_to,
            });
            break;
          }

          case "MutToConstPointer": {
            const fk = Operand.ty(op, this.body, tcx).kind();
            if (!(fk.$ === "RawPtr" && fk._1 === Mutability.Mut)) {
              span_mirbug(this, dbg(rvalue, debug_Rvalue), `unexpected base type for cast ${dbg_ty(ty)}`);
              return;
            }
            const ty_from = fk._0;
            const tk = ty.kind();
            if (!(tk.$ === "RawPtr" && tk._1 === Mutability.Not)) {
              span_mirbug(this, dbg(rvalue, debug_Rvalue), `unexpected target type for cast ${dbg_ty(ty)}`);
              return;
            }
            const ty_to = tk._0;
            const is_implicit_coercion = coercion_source === "Implicit";
            const r = this.sub_types(ty_from, ty_to, to_locations(location), cast_category(is_implicit_coercion));
            if (r.$ === "Err") {
              const terr = r._0;
              span_mirbug(this, dbg(rvalue, debug_Rvalue), `relating ${dbg_ty(ty_from)} with ${dbg_ty(ty_to)} yields ${dbg(terr, debug_NoSolution)}`);
            }
            break;
          }

          case "ArrayToPointer": {
            const ty_from = Operand.ty(op, this.body, tcx);

            let opt_ty_elem_mut: [Ty, Mutability] | undefined;
            const fk = ty_from.kind();
            if (fk.$ === "RawPtr") {
              const [array_ty, array_mut] = [fk._0, fk._1];
              const ak = array_ty.kind();
              opt_ty_elem_mut = ak.$ === "Array" ? [ak._0, array_mut] : undefined;
            } else {
              opt_ty_elem_mut = undefined;
            }

            if (opt_ty_elem_mut === undefined) {
              span_mirbug(this, dbg(rvalue, debug_Rvalue), `ArrayToPointer cast from unexpected type ${dbg_ty(ty_from)}`);
              return;
            }
            const [ty_elem, ty_mut] = opt_ty_elem_mut;

            let ty_to: Ty;
            let ty_to_mut: Mutability;
            const tk = ty.kind();
            if (tk.$ === "RawPtr") {
              [ty_to, ty_to_mut] = [tk._0, tk._1];
            } else {
              span_mirbug(this, dbg(rvalue, debug_Rvalue), `ArrayToPointer cast to unexpected type ${dbg_ty(ty)}`);
              return;
            }

            if (Mutability.is_mut(ty_to_mut) && Mutability.is_not(ty_mut)) {
              span_mirbug(this, dbg(rvalue, debug_Rvalue), `ArrayToPointer cast from const ${dbg_ty(ty)} to mut ${dbg_ty(ty_to)}`);
              return;
            }

            const is_implicit_coercion = coercion_source === "Implicit";
            const r = this.sub_types(ty_elem, ty_to, to_locations(location), cast_category(is_implicit_coercion));
            if (r.$ === "Err") {
              const terr = r._0;
              span_mirbug(this, dbg(rvalue, debug_Rvalue), `relating ${dbg_ty(ty_elem)} with ${dbg_ty(ty_to)} yields ${dbg(terr, debug_NoSolution)}`);
            }
            break;
          }
        }
        break;
      }

      case "PointerExposeProvenance": {
        const ty_from = Operand.ty(op, this.body, tcx);
        const cast_ty_from = CastTy.from_ty(ty_from);
        const cast_ty_to = CastTy.from_ty(ty);
        if ((cast_ty_from?.$ === "Ptr" || cast_ty_from?.$ === "FnPtr") && cast_ty_to?.$ === "Int") {
          // ok
        } else {
          span_mirbug(this, dbg(rvalue, debug_Rvalue), `Invalid PointerExposeProvenance cast ${dbg_ty(ty_from)} -> ${dbg_ty(ty)}`);
        }
        break;
      }

      case "PointerWithExposedProvenance": {
        const ty_from = Operand.ty(op, this.body, tcx);
        const cast_ty_from = CastTy.from_ty(ty_from);
        const cast_ty_to = CastTy.from_ty(ty);
        if (cast_ty_from?.$ === "Int" && cast_ty_to?.$ === "Ptr") {
          // ok
        } else {
          span_mirbug(this, dbg(rvalue, debug_Rvalue), `Invalid PointerWithExposedProvenance cast ${dbg_ty(ty_from)} -> ${dbg_ty(ty)}`);
        }
        break;
      }
      case "IntToInt": {
        const ty_from = Operand.ty(op, this.body, tcx);
        const cast_ty_from = CastTy.from_ty(ty_from);
        const cast_ty_to = CastTy.from_ty(ty);
        if (cast_ty_from !== undefined && cast_ty_to !== undefined && CastTy.is_int_like(cast_ty_from) && CastTy.is_int_like(cast_ty_to)) {
          // ok
        } else {
          span_mirbug(this, dbg(rvalue, debug_Rvalue), `Invalid IntToInt cast ${dbg_ty(ty_from)} -> ${dbg_ty(ty)}`);
        }
        break;
      }
      case "IntToFloat": {
        const ty_from = Operand.ty(op, this.body, tcx);
        const cast_ty_from = CastTy.from_ty(ty_from);
        const cast_ty_to = CastTy.from_ty(ty);
        if (cast_ty_from?.$ === "Int" && cast_ty_to?.$ === "Float") {
          // ok
        } else {
          span_mirbug(this, dbg(rvalue, debug_Rvalue), `Invalid IntToFloat cast ${dbg_ty(ty_from)} -> ${dbg_ty(ty)}`);
        }
        break;
      }
      case "FloatToInt": {
        const ty_from = Operand.ty(op, this.body, tcx);
        const cast_ty_from = CastTy.from_ty(ty_from);
        const cast_ty_to = CastTy.from_ty(ty);
        if (cast_ty_from?.$ === "Float" && cast_ty_to?.$ === "Int") {
          // ok
        } else {
          span_mirbug(this, dbg(rvalue, debug_Rvalue), `Invalid FloatToInt cast ${dbg_ty(ty_from)} -> ${dbg_ty(ty)}`);
        }
        break;
      }
      case "FloatToFloat": {
        const ty_from = Operand.ty(op, this.body, tcx);
        const cast_ty_from = CastTy.from_ty(ty_from);
        const cast_ty_to = CastTy.from_ty(ty);
        if (cast_ty_from?.$ === "Float" && cast_ty_to?.$ === "Float") {
          // ok
        } else {
          span_mirbug(this, dbg(rvalue, debug_Rvalue), `Invalid FloatToFloat cast ${dbg_ty(ty_from)} -> ${dbg_ty(ty)}`);
        }
        break;
      }
      case "FnPtrToPtr": {
        const ty_from = Operand.ty(op, this.body, tcx);
        const cast_ty_from = CastTy.from_ty(ty_from);
        const cast_ty_to = CastTy.from_ty(ty);
        if (cast_ty_from?.$ === "FnPtr" && cast_ty_to?.$ === "Ptr") {
          // ok
        } else {
          span_mirbug(this, dbg(rvalue, debug_Rvalue), `Invalid FnPtrToPtr cast ${dbg_ty(ty_from)} -> ${dbg_ty(ty)}`);
        }
        break;
      }
      case "PtrToPtr": {
        const ty_from = Operand.ty(op, this.body, tcx);
        const src_c = CastTy.from_ty(ty_from);
        if (src_c?.$ !== "Ptr") {
          return unreachable();
        }
        const src = src_c._0;
        const dst_c = CastTy.from_ty(ty);
        if (dst_c?.$ !== "Ptr") {
          return unreachable();
        }
        const dst = dst_c._0;

        if (this.infcx.type_is_sized_modulo_regions(this.infcx.param_env, dst.ty)) {
          // Wide to thin ptr cast. This may even occur in an env with
          // impossible clauses, such as `where dyn Trait: Sized`.
          // In this case, we don't want to fall into the case below,
          // since the types may not actually be equatable, but it's
          // fine to perform this operation in an impossible env.
          const trait_ref = TraitRef.new(as_interner(tcx), tcx.require_lang_item(LangItem.Sized, this.last_span), [GenericArg.from_Ty(dst.ty)]);
          this.prove_trait_ref(trait_ref, to_locations(location), {
            $: "Cast",
            is_raw_ptr_dyn_type_cast: false,
            is_implicit_coercion: true,
            unsize_to: undefined,
          });
        } else {
          const sk = this.struct_tail(src.ty, location, NormalizeLocation_Location).kind();
          if (sk.$ !== "Dynamic") break;
          const [src_tty, src_lt] = [sk._0, sk._1];
          const dk = this.struct_tail(dst.ty, location, NormalizeLocation_Location).kind();
          if (dk.$ !== "Dynamic") break;
          const [dst_tty, dst_lt] = [dk._0, dk._1];
          const src_p = src_tty.principal();
          const dst_p = dst_tty.principal();
          if (src_p !== undefined && dst_p !== undefined) {
            // This checks (lifetime part of) vtable validity for pointer casts,
            // which is irrelevant when there are aren't principal traits on
            // both sides (aka only auto traits).
            //
            // Note that other checks (such as denying `dyn Send` -> `dyn
            // Debug`) are in `rustc_hir_typeck`.

            // Remove auto traits.
            // Auto trait checks are handled in `rustc_hir_typeck`.
            const src_obj = Ty.new_dynamic(tcx, tcx.mk_poly_existential_predicates([...src_tty.without_auto_traits()]), src_lt);
            const dst_obj = Ty.new_dynamic(tcx, tcx.mk_poly_existential_predicates([...dst_tty.without_auto_traits()]), dst_lt);

            // debug!(?src_tty, ?dst_tty, ?src_obj, ?dst_obj);

            // Trait parameters are invariant, the only part that actually has
            // subtyping here is the lifetime bound of the dyn-type.
            //
            // For example in `dyn Trait<'a> + 'b <: dyn Trait<'c> + 'd`  we would
            // require that `'a == 'c` but only that `'b: 'd`.
            //
            // We must not allow freely casting lifetime bounds of dyn-types as it
            // may allow for inaccessible VTable methods being callable: #136702
            unwrap(
              this.sub_types(src_obj, dst_obj, to_locations(location), {
                $: "Cast",
                is_raw_ptr_dyn_type_cast: true,
                is_implicit_coercion: false,
                unsize_to: undefined,
              }),
            );
          } else if (src_p === undefined && dst_p === undefined) {
            // `struct_tail` returns regions which haven't been mapped
            // to nll vars yet so we do it here as `outlives_constraints`
            // expects nll vars.
            const src_lt_ = this.universal_regions.to_region_vid(src_lt);
            const dst_lt_ = this.universal_regions.to_region_vid(dst_lt);

            // The principalless (no non-auto traits) case:
            // You can only cast `dyn Send + 'long` to `dyn Send + 'short`.
            this.constraints.outlives_constraints.push({
              sup: src_lt_,
              sub: dst_lt_,
              locations: to_locations(location),
              span: Locations.span(to_locations(location), this.body),
              category: {
                $: "Cast",
                is_raw_ptr_dyn_type_cast: true,
                is_implicit_coercion: false,
                unsize_to: undefined,
              },
              variance_info: VarianceDiagInfo.None,
              from_closure: false,
            });
          } else if (src_p === undefined) {
            return bug("introducing a principal should have errored in HIR typeck");
          } else {
            return bug("dropping the principal should have been an unsizing cast");
          }
        }
        break;
      }
      case "Transmute": {
        const ty_from = Operand.ty(op, this.body, tcx);
        const fk = ty_from.kind();
        if (fk.$ === "Pat" && fk._0 === ty) {
          // ok
        } else {
          span_mirbug(
            this,
            dbg(rvalue, debug_Rvalue),
            `Unexpected CastKind::Transmute ${dbg_ty(ty_from)} -> ${dbg_ty(ty)}, which is not permitted in Analysis MIR`,
          );
        }
        break;
      }
      case "Subtype":
      case "BoxDerefTransmute":
        return bug(`CastKind::${dbg(cast_kind, debug_CastKind)} shouldn't exist in borrowck`);
    }
  }

  // rustc: compiler/rustc_borrowck/src/type_check/mod.rs:1707 visit_operand
  override visit_operand(op: Operand, location: Location): void {
    this.super_operand(op, location);
    if (op.$ === "Constant") {
      const constant = op._0;
      let maybe_uneval: UnevaluatedConst | undefined;
      switch (constant.const_.$) {
        case "Val":
        case "Ty":
          maybe_uneval = undefined;
          break;
        case "Unevaluated":
          maybe_uneval = constant.const_._0;
          break;
      }

      if (maybe_uneval !== undefined) {
        const uv = maybe_uneval;
        if (uv.promoted === undefined) {
          const tcx = this.tcx();
          const def_id = uv.def;
          if (tcx.def_kind(def_id).$ === "AnonConst" && (tcx.anon_const_kind(def_id) as AnonConstKind) === "NonTypeSystemInline") {
            const def_id_ = def_id.expect_local();
            const clauses = this.prove_closure_bounds(tcx, def_id_, uv.args, location);
            this.normalize_and_prove_instantiated_clauses(LocalDefId.to_def_id(def_id_), clauses, to_locations(location));
          }
        }
      }
    }
  }

  // rustc: compiler/rustc_borrowck/src/type_check/mod.rs:1736 visit_const_operand
  override visit_const_operand(constant: ConstOperand, location: Location): void {
    this.super_const_operand(constant, location);
    const ty = constant.ty();

    this.infcx.tcx.for_each_free_region(
      ty,
      (live_region) => {
        const live_region_vid = this.universal_regions.to_region_vid(live_region);
        this.constraints.liveness_constraints.add_location(live_region_vid, location);
      },
      fold_Ty,
    );

    const locations = to_locations(location);
    const annotation_index = constant.user_ty;
    if (annotation_index !== undefined) {
      const r = this.relate_type_and_user_type(
        constant.ty(),
        Variance.Invariant,
        { base: annotation_index, projs: [] },
        locations,
        { $: "TypeAnnotation", _0: "GenericArg" },
      );
      if (r.$ === "Err") {
        const terr = r._0;
        const annotation = this.user_type_annotations[annotation_index]!;
        span_mirbug(
          this,
          dbg(constant, debug_ConstOperand),
          `bad constant user type ${dbg(annotation, debug_CanonicalUserTypeAnnotation)} vs ${dbg_ty(constant.ty())}: ${dbg(terr, debug_NoSolution)}`,
        );
      }
    } else {
      const tcx = this.tcx();
      let maybe_uneval: UnevaluatedConst | undefined;
      const c = constant.const_;
      if (c.$ === "Ty") {
        const ck = c._1.kind();
        if (ck.$ === "Alias") {
          const alias_const = ck._1;
          // Projection | InherentSelf | InherentImpl | Free | Anon: every kind carries its `def_id`.
          maybe_uneval = new UnevaluatedConst(alias_const.kind.def_id, alias_const.args, undefined);
        } else {
          maybe_uneval = undefined;
        }
      } else if (c.$ === "Unevaluated") {
        maybe_uneval = c._0;
      } else {
        maybe_uneval = undefined;
      }

      let static_def_id: DefId | undefined;
      let const_param: ParamConst | undefined;
      if (maybe_uneval !== undefined) {
        const uv = maybe_uneval;
        const promoted = uv.promoted;
        if (promoted !== undefined) {
          const promoted_body = this.promoted[promoted]!;
          this.check_promoted(promoted_body, location);
          const promoted_ty = promoted_body.return_ty();
          const r = this.eq_types(ty, promoted_ty, locations, ConstraintCategory.Boring);
          if (r.$ === "Err") {
            const terr = r._0;
            span_mirbug(this, dbg(promoted, debug_Promoted), `bad promoted type (${dbg_ty(ty)}: ${dbg_ty(promoted_ty)}): ${dbg(terr, debug_NoSolution)}`);
          }
        } else {
          this.ascribe_user_type(
            constant.ty(),
            UserType.new({ $: "TypeOf", _0: uv.def, _1: { args: uv.args, user_self_ty: undefined } }),
            Locations.span(locations, this.body),
          );
        }
      } else if ((static_def_id = constant.check_static_ptr(tcx)) !== undefined) {
        const unnormalized_ty = EarlyBinder.instantiate_identity(tcx.type_of(static_def_id) as EarlyBinder<Ty>);
        const normalized_ty = this.normalize(unnormalized_ty, locations, Normalizable_Ty, display_Ty, NormalizeLocation_Locations);
        const literal_ty = unwrap(constant.ty().builtin_deref(true));

        const r = this.eq_types(literal_ty, normalized_ty, locations, ConstraintCategory.Boring);
        if (r.$ === "Err") {
          const terr = r._0;
          span_mirbug(this, dbg(constant, debug_ConstOperand), `bad static type ${dbg(constant, debug_ConstOperand)} (${dbg(terr, debug_NoSolution)})`);
        }
      } else if (c.$ === "Ty" && (const_param = ConstKind_param(c._1.kind())) !== undefined) {
        const p = const_param;
        const DefiningTy = universal_regions().DefiningTy;
        const body_def_id = DefiningTy.def_id(this.universal_regions.defining_ty);
        const const_param_ = (tcx.generics_of(body_def_id) as Generics).const_param(p, tcx);
        this.ascribe_user_type(
          constant.ty(),
          UserType.new({
            $: "TypeOf",
            _0: const_param_.def_id,
            _1: {
              args: DefiningTy.args(this.universal_regions.defining_ty),
              user_self_ty: undefined,
            },
          }),
          Locations.span(locations, this.body),
        );
      }

      const ck = constant.ty().kind();
      if (ck.$ === "FnDef") {
        const [def_id, args_0] = [ck._0, ck._1];
        const args = unwrap(Binder.no_bound_vars(args_0, fold_GenericArgs));
        const instantiated_clauses = GenericClauses.instantiate(tcx.clauses_of(def_id) as GenericClauses, tcx, args);
        this.normalize_and_prove_instantiated_clauses(def_id, instantiated_clauses, locations);

        assert_eq<DefId | undefined>(tcx.trait_impl_of_assoc(def_id), undefined, (v) => debug_option(v, PLAIN, debug_DefId));
        this.prove_clauses(
          map_iter(args.terms(), (t): ClauseKind => ({ $: "WellFormed", _0: t })),
          locations,
          ConstraintCategory.Boring,
          Clause_upcast_from_ClauseKind,
        );
      }
    }
  }

  // rustc: compiler/rustc_borrowck/src/type_check/mod.rs:1859 visit_place
  override visit_place(place: Place, context: PlaceContext, location: Location): void {
    this.super_place(place, context, location);
    const tcx = this.tcx();
    const place_ty = place.ty(this.body, tcx);
    if (context.$ === "NonMutatingUse" && context._0 === "Copy") {
      const trait_ref = TraitRef.new(as_interner(tcx), tcx.require_lang_item(LangItem.Copy, this.last_span), [GenericArg.from_Ty(place_ty.ty)]);

      // To have a `Copy` operand, the type `T` of the
      // value must be `Copy`. Note that we prove that `T: Copy`,
      // rather than using the `is_copy_modulo_regions`
      // test. This is important because
      // `is_copy_modulo_regions` ignores the resulting region
      // obligations and assumes they pass. This can result in
      // bounds from `Copy` impls being unsoundly ignored (e.g.,
      // #29149). Note that we decide to use `Copy` before knowing
      // whether the bounds fully apply: in effect, the rule is
      // that if a value of some type could implement `Copy`, then
      // it must.
      this.prove_trait_ref(trait_ref, to_locations(location), ConstraintCategory.CopyBound);
    }
  }

  // rustc: compiler/rustc_borrowck/src/type_check/mod.rs:1885 visit_projection_elem
  override visit_projection_elem(place: PlaceRef, elem: PlaceElem, context: PlaceContext, location: Location): void {
    const tcx = this.tcx();
    const base_ty = place.ty(this.body_(), tcx);
    switch (elem.$) {
      // All these projections don't add any constraints, so there's nothing to
      // do here. We check their invariants in the MIR validator after all.
      case "Deref":
      case "PhantomDeref":
      case "Index":
      case "ConstantIndex":
      case "Subslice":
      case "Downcast":
        break;
      case "Field": {
        const [field, fty_0] = [elem._0, elem._1];
        const fty = this.normalize(Unnormalized.new_wip(fty_0), location, Normalizable_Ty, display_Ty, NormalizeLocation_Location);
        const ty_0 = PlaceTy.field_ty(tcx, base_ty.ty, base_ty.variant_index, field);
        const ty = this.normalize(ty_0, location, Normalizable_Ty, display_Ty, NormalizeLocation_Location);
        // debug!(?fty, ?ty);

        const r = this.relate_types(ty, PlaceContextC.ambient_variance(context), fty, to_locations(location), ConstraintCategory.Boring);
        if (r.$ === "Err") {
          const terr = r._0;
          span_mirbug(this, dbg(place, debug_PlaceRef), `bad field access (${dbg_ty(ty)}: ${dbg_ty(fty)}): ${dbg(terr, debug_NoSolution)}`);
        }
        break;
      }
      case "OpaqueCast": {
        const ty = this.normalize(Unnormalized.new_wip(elem._0), location, Normalizable_Ty, display_Ty, NormalizeLocation_Location);
        unwrap(
          this.relate_types(ty, PlaceContextC.ambient_variance(context), base_ty.ty, to_locations(location), {
            $: "TypeAnnotation",
            _0: "OpaqueCast",
          }),
        );
        break;
      }
      case "UnwrapUnsafeBinder": {
        const ty = elem._0;
        const k = base_ty.ty.kind();
        if (k.$ !== "UnsafeBinder") {
          return unreachable();
        }
        const binder_ty = k._0;
        const found_ty = this.infcx.instantiate_binder_with_fresh_vars(
          this.body.source_info(location).span,
          BoundRegionConversionTime.HigherRankedType,
          UnsafeBinderInner_deref(binder_ty),
          fold_Ty,
        );
        unwrap(this.relate_types(ty, PlaceContextC.ambient_variance(context), found_ty, to_locations(location), ConstraintCategory.Boring));
        break;
      }
    }
  }

  // ---- impl<'a, 'tcx> TypeChecker<'a, 'tcx> (mod.rs:1952) ----

  // rustc: compiler/rustc_borrowck/src/type_check/mod.rs:1953 check_call_dest
  check_call_dest(term: Terminator, sig: FnSig, destination: Place, is_diverging: boolean, term_location: Location): void {
    const tcx = this.tcx();
    if (is_diverging) {
      // The signature in this call can reference region variables,
      // so erase them before calling a query.
      const output_ty = this.tcx().erase_and_anonymize_regions(FnSig.output(sig), fold_Ty);
      if (!output_ty.is_privately_uninhabited(this.tcx(), this.infcx.typing_env(this.infcx.param_env))) {
        span_mirbug(this, dbg(term, debug_Terminator), `call to non-diverging function ${dbg(sig, debug_FnSig)} w/o dest`);
      }
    } else {
      const dest_ty_0 = destination.ty(this.body, tcx).ty;
      const dest_ty = this.normalize(Unnormalized.new_wip(dest_ty_0), term_location, Normalizable_Ty, display_Ty, NormalizeLocation_Location);
      let category: ConstraintCategory;
      const l = destination.as_local();
      if (l === RETURN_PLACE) {
        const defining_ty = this.universal_regions.defining_ty;
        if (defining_ty.$ === "Const" || defining_ty.$ === "InlineConst") {
          const def_id = defining_ty._0;
          if (tcx.is_static(def_id)) {
            category = ConstraintCategory.UseAsStatic;
          } else {
            category = ConstraintCategory.UseAsConst;
          }
        } else {
          category = { $: "Return", _0: ReturnConstraint.Normal };
        }
      } else if (l !== undefined && !this.body.local_decls[l]!.is_user_variable()) {
        category = ConstraintCategory.Boring;
      } else {
        // The return type of a call is interesting for diagnostics.
        category = ConstraintCategory.Assignment;
      }

      const locations = to_locations(term_location);

      const r = this.sub_types(FnSig.output(sig), dest_ty, locations, category);
      if (r.$ === "Err") {
        const terr = r._0;
        span_mirbug(this, dbg(term, debug_Terminator), `call dest mismatch (${dbg_ty(dest_ty)} <- ${dbg_ty(FnSig.output(sig))}): ${dbg(terr, debug_NoSolution)}`);
      }

      // When `unsized_fn_params` is not enabled,
      // this check is done at `visit_local_decl`.
      if (this.tcx().features().unsized_fn_params()) {
        const span = term.source_info.span;
        this.ensure_place_sized(dest_ty, span);
      }
    }
  }

  // rustc: compiler/rustc_borrowck/src/type_check/mod.rs:2018 check_call_inputs
  check_call_inputs(
    term: Terminator,
    func: Operand,
    sig: FnSig,
    args: readonly Spanned<Operand>[],
    term_location: Location,
    call_source: CallSource,
  ): void {
    const inputs = FnSig.inputs(sig);
    if (args.length < inputs.length || (args.length > inputs.length && !FnSig.c_variadic(sig))) {
      span_mirbug(this, dbg(term, debug_Terminator), `call to ${dbg(sig, debug_FnSig)} with wrong # of args`);
    }

    const func_ty = Operand.ty(func, this.body, this.infcx.tcx);
    const fk = func_ty.kind();
    if (fk.$ === "FnDef") {
      const def_id = fk._0;
      // Some of the SIMD intrinsics are special: they need a particular argument to be a
      // constant. (Eventually this should use const-generics, but those are not up for the
      // task yet: https://github.com/rust-lang/rust/issues/85229.)
      const name = this.tcx().intrinsic(def_id)?.name;
      if (name !== undefined && (name === sym.simd_shuffle || name === sym.simd_insert || name === sym.simd_extract)) {
        let idx: number;
        switch (name) {
          case sym.simd_shuffle:
            idx = 2;
            break;
          default:
            idx = 1;
        }
        if (!(args[idx]!.node.$ === "Constant")) {
          this.tcx()
            .dcx()
            .emit_err(
              SimdIntrinsicArgConst_diagnostic({
                span: term.source_info.span,
                arg: idx + 1,
                intrinsic: Symbol.as_str(name),
              }),
            );
        }
      }
    }
    // debug!(?func_ty);

    const n_args = Math.min(inputs.length, args.length);
    for (let n = 0; n < n_args; n++) {
      const [fn_arg, op_arg] = [inputs[n]!, args[n]!];
      const op_arg_ty_0 = Operand.ty(op_arg.node, this.body, this.tcx());

      const op_arg_ty = this.normalize(Unnormalized.new_wip(op_arg_ty_0), term_location, Normalizable_Ty, display_Ty, NormalizeLocation_Location);
      const category: ConstraintCategory = CallSourceC.from_hir_call(call_source)
        ? { $: "CallArgument", _0: this.infcx.tcx.erase_and_anonymize_regions(func_ty, fold_Ty) }
        : ConstraintCategory.Boring;
      const r = this.sub_types(op_arg_ty, fn_arg, to_locations(term_location), category);
      if (r.$ === "Err") {
        const terr = r._0;
        span_mirbug(this, dbg(term, debug_Terminator), `bad arg #${n} (${dbg_ty(fn_arg)} <- ${dbg_ty(op_arg_ty)}): ${dbg(terr, debug_NoSolution)}`);
      }
    }
  }

  // rustc: compiler/rustc_borrowck/src/type_check/mod.rs:2082 check_iscleanup
  check_iscleanup(block_data: BasicBlockData): void {
    const is_cleanup = block_data.is_cleanup;
    const ctxt = (f: Fmt): string => debug_BasicBlockData(block_data, f);
    const kind = block_data.terminator_().kind;
    switch (kind.$) {
      case "Goto":
        this.assert_iscleanup(ctxt, kind.target, is_cleanup);
        break;
      case "SwitchInt":
        for (const target of kind.targets.all_targets()) {
          this.assert_iscleanup(ctxt, target, is_cleanup);
        }
        break;
      case "UnwindResume":
        if (!is_cleanup) {
          span_mirbug(this, ctxt(PLAIN), "resume on non-cleanup block!");
        }
        break;
      case "UnwindTerminate":
        if (!is_cleanup) {
          span_mirbug(this, ctxt(PLAIN), "terminate on non-cleanup block!");
        }
        break;
      case "Return":
        if (is_cleanup) {
          span_mirbug(this, ctxt(PLAIN), "return on cleanup block");
        }
        break;
      case "TailCall":
        if (is_cleanup) {
          span_mirbug(this, ctxt(PLAIN), "tailcall on cleanup block");
        }
        break;
      case "CoroutineDrop":
        if (is_cleanup) {
          span_mirbug(this, ctxt(PLAIN), "coroutine_drop in cleanup block");
        }
        break;
      case "Yield": {
        const { resume, drop } = kind;
        if (is_cleanup) {
          span_mirbug(this, ctxt(PLAIN), "yield in cleanup block");
        }
        this.assert_iscleanup(ctxt, resume, is_cleanup);
        if (drop !== undefined) {
          this.assert_iscleanup(ctxt, drop, is_cleanup);
        }
        break;
      }
      case "Unreachable":
        break;
      case "Drop": {
        const { target, unwind, drop } = kind;
        this.assert_iscleanup(ctxt, target, is_cleanup);
        this.assert_iscleanup_unwind(ctxt, unwind, is_cleanup);
        if (drop !== undefined) {
          this.assert_iscleanup(ctxt, drop, is_cleanup);
        }
        break;
      }
      case "Assert": {
        const { target, unwind } = kind;
        this.assert_iscleanup(ctxt, target, is_cleanup);
        this.assert_iscleanup_unwind(ctxt, unwind, is_cleanup);
        break;
      }
      case "Call": {
        const { target, unwind } = kind;
        if (target !== undefined) {
          this.assert_iscleanup(ctxt, target, is_cleanup);
        }
        this.assert_iscleanup_unwind(ctxt, unwind, is_cleanup);
        break;
      }
      case "FalseEdge": {
        const { real_target, imaginary_target } = kind;
        this.assert_iscleanup(ctxt, real_target, is_cleanup);
        this.assert_iscleanup(ctxt, imaginary_target, is_cleanup);
        break;
      }
      case "FalseUnwind": {
        const { real_target, unwind } = kind;
        this.assert_iscleanup(ctxt, real_target, is_cleanup);
        this.assert_iscleanup_unwind(ctxt, unwind, is_cleanup);
        break;
      }
      case "InlineAsm": {
        const { targets, unwind } = kind;
        for (const target of targets) {
          this.assert_iscleanup(ctxt, target, is_cleanup);
        }
        this.assert_iscleanup_unwind(ctxt, unwind, is_cleanup);
        break;
      }
    }
  }

  // rustc: compiler/rustc_borrowck/src/type_check/mod.rs:2162 assert_iscleanup
  assert_iscleanup(ctxt: (f: Fmt) => string, bb: BasicBlock, iscleanuppad: boolean): void {
    if (this.body.index(bb).is_cleanup !== iscleanuppad) {
      span_mirbug(this, ctxt(PLAIN), `cleanuppad mismatch: ${dbg(bb, debug_BasicBlock)} should be ${iscleanuppad}`);
    }
  }

  // rustc: compiler/rustc_borrowck/src/type_check/mod.rs:2168 assert_iscleanup_unwind
  assert_iscleanup_unwind(ctxt: (f: Fmt) => string, unwind: UnwindAction, is_cleanup: boolean): void {
    switch (unwind.$) {
      case "Cleanup": {
        const unwind_ = unwind._0;
        if (is_cleanup) {
          span_mirbug(this, ctxt(PLAIN), "unwind on cleanup block");
        }
        this.assert_iscleanup(ctxt, unwind_, true);
        break;
      }
      case "Continue":
        if (is_cleanup) {
          span_mirbug(this, ctxt(PLAIN), "unwind on cleanup block");
        }
        break;
      case "Unreachable":
      case "Terminate":
        break;
    }
  }

  // rustc: compiler/rustc_borrowck/src/type_check/mod.rs:2190 ensure_place_sized
  ensure_place_sized(ty: Ty, span: Span): void {
    const tcx = this.tcx();

    // Erase the regions from `ty` to get a global type. The
    // `Sized` bound in no way depends on precise regions, so this
    // shouldn't affect `is_sized`.
    const erased_ty = tcx.erase_and_anonymize_regions(ty, fold_Ty);
    // FIXME(#132279): Using `Ty::is_sized` causes us to incorrectly handle opaques here.
    if (!erased_ty.is_sized(tcx, this.infcx.typing_env(this.infcx.param_env))) {
      // in current MIR construction, all non-control-flow rvalue
      // expressions evaluate through `as_temp` or `into` a return
      // slot or local, so to find all unsized rvalues it is enough
      // to check all temps, return slots and locals.
      // PORT: `IndexSet::replace` returns the replaced value: `None` when the key was absent (the order of an existing
      // key is kept, so the absent case is an insertion).
      const key: [Ty, Span] = [ty, span];
      const was_present = this.reported_errors.has(key);
      this.reported_errors.add(key);
      if (!was_present) {
        // While this is located in `nll::typeck` this error is not
        // an NLL error, it's a required check to prevent creation
        // of unsized rvalues in a call expression.
        this.tcx().dcx().emit_err(MoveUnsized_diagnostic({ ty, span }));
      }
    }
  }

  // rustc: compiler/rustc_borrowck/src/type_check/mod.rs:2212 aggregate_field_ty
  aggregate_field_ty(ak: AggregateKind, field_index: FieldIdx, location: Location): Result<Ty, FieldAccessError> {
    const tcx = this.tcx();

    switch (ak.$) {
      case "Adt": {
        const [adt_did, variant_index, args, _, active_field_index] = [ak._0, ak._1, ak._2, ak._3, ak._4];
        const def = tcx.adt_def(adt_did) as AdtDef;
        const variant = def.variant(variant_index);
        const adj_field_index = active_field_index ?? field_index;
        const field = variant.fields[adj_field_index];
        if (field !== undefined) {
          return Ok(this.normalize(field.ty(tcx, args), location, Normalizable_Ty, display_Ty, NormalizeLocation_Location));
        } else {
          return Err({ $: "OutOfRange", field_count: variant.fields.length });
        }
      }
      case "Closure": {
        const args = ak._1;
        const upvar_tys = [...ClosureArgs.upvar_tys(args.as_closure())];
        const ty = upvar_tys[field_index];
        if (ty !== undefined) {
          return Ok(ty);
        } else {
          return Err({ $: "OutOfRange", field_count: upvar_tys.length });
        }
      }
      case "Coroutine": {
        const args = ak._1;
        // It doesn't make sense to look at a field beyond the captured
        // upvars.
        // Otherwise it require a variant index, and are not initialized
        // in aggregate rvalues.
        const upvar_tys = [...CoroutineArgs.upvar_tys(args.as_coroutine())];
        const ty = upvar_tys[field_index];
        if (ty !== undefined) {
          return Ok(ty);
        } else {
          return Err({ $: "OutOfRange", field_count: upvar_tys.length });
        }
      }
      case "CoroutineClosure": {
        const args = ak._1;
        const upvar_tys = [...CoroutineClosureArgs.upvar_tys(args.as_coroutine_closure())];
        const ty = upvar_tys[field_index];
        if (ty !== undefined) {
          return Ok(ty);
        } else {
          return Err({ $: "OutOfRange", field_count: upvar_tys.length });
        }
      }
      case "Array":
        return Ok(ak._0);
      case "Tuple":
      case "RawPtr":
        return unreachable("This should have been covered in check_rvalues");
    }
  }

  /// If this rvalue supports a user-given type annotation, then
  /// extract and return it. This represents the final type of the
  /// rvalue and will be unified with the inferred type.
  // rustc: compiler/rustc_borrowck/src/type_check/mod.rs:2269 rvalue_user_ty
  rvalue_user_ty(rvalue: Rvalue): UserTypeAnnotationIndex | undefined {
    switch (rvalue.$) {
      case "Use":
      case "ThreadLocalRef":
      case "Repeat":
      case "Ref":
      case "Reborrow":
      case "RawPtr":
      case "Cast":
      case "BinaryOp":
      case "CopyForDeref":
      case "UnaryOp":
      case "Discriminant":
      case "WrapUnsafeBinder":
        return undefined;

      case "Aggregate": {
        const aggregate = rvalue._0;
        switch (aggregate.$) {
          case "Adt":
            return aggregate._3;
          case "Array":
            return undefined;
          case "Tuple":
            return undefined;
          case "Closure":
            return undefined;
          case "Coroutine":
            return undefined;
          case "CoroutineClosure":
            return undefined;
          case "RawPtr":
            return undefined;
        }
      }
    }
  }

  // rustc: compiler/rustc_borrowck/src/type_check/mod.rs:2296 check_aggregate_rvalue
  check_aggregate_rvalue(rvalue: Rvalue, aggregate_kind: AggregateKind, operands: readonly Operand[], location: Location): void {
    const tcx = this.tcx();

    this.prove_aggregate_predicates(aggregate_kind, location);

    if (aggregate_kind.$ === "Tuple") {
      // tuple rvalue field type is always the type of the op. Nothing to check here.
      return;
    }

    if (aggregate_kind.$ === "RawPtr") {
      return bug("RawPtr should only be in runtime MIR");
    }

    for (let i = 0; i < operands.length; i++) {
      const operand = operands[i]!;
      const r_field = this.aggregate_field_ty(aggregate_kind, i as FieldIdx, location);
      let field_ty: Ty;
      if (r_field.$ === "Ok") {
        field_ty = r_field._0;
      } else {
        const { field_count } = r_field._0;
        span_mirbug(this, dbg(rvalue, debug_Rvalue), `accessed field #${i} but variant only has ${field_count}`);
        continue;
      }
      const operand_ty_0 = Operand.ty(operand, this.body, tcx);
      const operand_ty = this.normalize(Unnormalized.new_wip(operand_ty_0), location, Normalizable_Ty, display_Ty, NormalizeLocation_Location);

      const r = this.sub_types(operand_ty, field_ty, to_locations(location), ConstraintCategory.Boring);
      if (r.$ === "Err") {
        const terr = r._0;
        span_mirbug(this, dbg(rvalue, debug_Rvalue), `${dbg_ty(operand_ty)} is not a subtype of ${dbg_ty(field_ty)}: ${dbg(terr, debug_NoSolution)}`);
      }
    }
  }

  /// Adds the constraints that arise from a borrow expression `&'a P` at the location `L`.
  ///
  /// # Parameters
  ///
  /// - `location`: the location `L` where the borrow expression occurs
  /// - `borrow_region`: the region `'a` associated with the borrow
  /// - `borrowed_place`: the place `P` being borrowed
  // rustc: compiler/rustc_borrowck/src/type_check/mod.rs:2358 add_reborrow_constraint
  add_reborrow_constraint(location: Location, borrow_region: Region, borrowed_place: Place): void {
    // These constraints are only meaningful during borrowck:
    const { borrow_set, location_table, polonius_facts, constraints } = this;

    // In Polonius mode, we also push a `loan_issued_at` fact
    // linking the loan to the region (in some cases, though,
    // there is no loan associated with this borrow expression --
    // that occurs when we are borrowing an unsafe place, for
    // example).
    if (polonius_facts.value !== undefined) {
      const facts = polonius_facts.value as PoloniusFactsLoanIssuedAt;
      // let _prof_timer = self.infcx.tcx.prof.generic_activity("polonius_fact_generation");
      const idxs = borrow_set.borrows_at_location(location);
      if (idxs !== undefined) {
        const region_vid = borrow_region.as_var();
        for (const borrow_index of idxs) {
          facts.loan_issued_at.push([facts_mod().PoloniusRegionVid_from_RegionVid(region_vid), borrow_index, location_table.mid_index(location)]);
        }
      }
    }

    // If we are reborrowing the referent of another reference, we
    // need to add outlives relationships. In a case like `&mut
    // *p`, where the `p` has type `&'b mut Foo`, for example, we
    // need to ensure that `'b: 'a`.

    // debug!("add_reborrow_constraint({:?}, {:?}, {:?})", location, borrow_region, borrowed_place);

    const tcx = this.infcx.tcx;
    const def = this.body.source.def_id().expect_local();
    const upvars = tcx.closure_captures(def);
    const field = path_utils().is_upvar_field_projection(tcx, upvars, borrowed_place.as_ref(), this.body);
    const category: ConstraintCategory = field !== undefined ? { $: "ClosureUpvar", _0: field } : ConstraintCategory.Boring;

    for (const [base, elem] of [...borrowed_place.as_ref().iter_projections()].reverse()) {
      // debug!("add_reborrow_constraint - iteration {:?}", elem);

      let brk = false;
      switch (elem.$) {
        case "Deref": {
          const base_ty = base.ty(this.body, tcx).ty;

          // debug!("add_reborrow_constraint - base_ty = {:?}", base_ty);
          const k = base_ty.kind();
          if (k.$ === "Ref") {
            const [ref_region, _, mutbl] = [k._0, k._1, k._2];
            constraints.outlives_constraints.push({
              sup: ref_region.as_var(),
              sub: borrow_region.as_var(),
              locations: to_locations(location),
              span: Locations.span(to_locations(location), this.body),
              category,
              variance_info: VarianceDiagInfo.None,
              from_closure: false,
            });

            switch (mutbl) {
              case Mutability.Not:
                // Immutable reference. We don't need the base
                // to be valid for the entire lifetime of
                // the borrow.
                brk = true;
                break;
              case Mutability.Mut:
                // Mutable reference. We *do* need the base
                // to be valid, because after the base becomes
                // invalid, someone else can use our mutable deref.

                // This is in order to make the following function
                // illegal:
                // ```
                // fn unsafe_deref<'a, 'b>(x: &'a &'b mut T) -> &'b mut T {
                //     &mut *x
                // }
                // ```
                //
                // As otherwise you could clone `&mut T` using the
                // following function:
                // ```
                // fn bad(x: &mut T) -> (&mut T, &mut T) {
                //     let my_clone = unsafe_deref(&'a x);
                //     ENDREGION 'a;
                //     (my_clone, x)
                // }
                // ```
                break;
            }
          } else if (k.$ === "RawPtr") {
            // deref of raw pointer, guaranteed to be valid
            brk = true;
          } else if (k.$ === "Adt" && k._0.is_box()) {
            // deref of `Box`, need the base to be valid - propagate
          } else {
            return bug(`unexpected deref ty ${dbg_ty(base_ty)} in ${dbg(borrowed_place.as_ref(), debug_PlaceRef)}`);
          }
          break;
        }
        case "PhantomDeref":
          return bug("unexpected PhantomDeref in add_reborrow_constraint");
        case "Field":
        case "Downcast":
        case "OpaqueCast":
        case "Index":
        case "ConstantIndex":
        case "Subslice":
        case "UnwrapUnsafeBinder":
          // other field access
          break;
      }
      if (brk) break;
    }
  }

  // rustc: compiler/rustc_borrowck/src/type_check/mod.rs:2485 add_generic_reborrow_constraint
  add_generic_reborrow_constraint(mutability: Mutability, location: Location, src_place: Place, dst_ty: Ty): void {
    const { borrow_set, location_table, polonius_facts, constraints, infcx, body } = this;

    // debug!("add_generic_reborrow_constraint({:?}, {:?}, {:?}, {:?})", mutability, location, src_place, dst_ty);

    const tcx_0 = infcx.tcx;
    const def = body.source.def_id().expect_local();
    const upvars = tcx_0.closure_captures(def);
    const field = path_utils().is_upvar_field_projection(tcx_0, upvars, src_place.as_ref(), body);
    const category: ConstraintCategory = field !== undefined ? { $: "ClosureUpvar", _0: field } : ConstraintCategory.Boring;

    const src_ty = src_place.ty(this.body, tcx_0).ty;

    const dk = dst_ty.kind();
    if (dk.$ !== "Adt") return bug();
    const [dst_adt, dst_args] = [dk._0, dk._1];
    if (dst_args.length < 1) return bug();
    const dst_arg = dst_args[0]!;
    const dst_ak = GenericArg.kind(dst_arg);
    if (dst_ak.$ !== "Lifetime") return bug();
    const dst_region = dst_ak._0;
    constraints.liveness_constraints.add_location(dst_region.as_var(), location);

    // In Polonius mode, we also push a `loan_issued_at` fact
    // linking the loan to the region.
    if (polonius_facts.value !== undefined) {
      const facts = polonius_facts.value as PoloniusFactsLoanIssuedAt;
      // let _prof_timer = infcx.tcx.prof.generic_activity("polonius_fact_generation");
      const borrows = borrow_set.borrows_at_location(location);
      if (borrows !== undefined) {
        const region_vid = dst_region.as_var();
        for (const borrow_index of borrows) {
          facts.loan_issued_at.push([facts_mod().PoloniusRegionVid_from_RegionVid(region_vid), borrow_index, location_table.mid_index(location)]);
        }
      }
    }

    if (Mutability.is_not(mutability)) {
      // When performing a CoerceShared reborrow, we have to take into account lifetimes on
      // the trait definition. The trait impl should therefore be:
      //
      // ```rust
      // impl<'a: 'b, 'b> CoerceShared<Target<'b>> for Source<'a> {}
      // ```
      //
      // If the lifetimes are misconfigured, then the below we'll likely end up generating an
      // invariance relation between the source and target. This is in conflict with the
      // original design intent of the trait, where the same lifetime was meant to be used on
      // both the Source and Target types, but works better with the type system and was
      // therefore changed.
      //
      // The reason why we want to take the lifetimes into account is to catch impls like
      // `CoerceShared<Target<'static>> for Source<'a>` and, in those cases, correctly
      // generate a `'a: 'static` bound.
      const coerce_shared_trait_did = this.tcx().lang_items().coerce_shared();
      if (coerce_shared_trait_did === undefined) {
        return bug("HIR type check passed CoerceShared but MIR found no such lang item");
      }
      const tcx = this.tcx();
      const r = this.fully_perform_op(
        to_locations(location),
        ConstraintCategory.Assignment,
        CustomTypeOp.new<null>((ocx) => {
          const coerce_shared_trait_ref = TraitRef.new(as_interner(tcx), coerce_shared_trait_did, [GenericArg.from_Ty(src_ty), GenericArg.from_Ty(dst_ty)]);
          const obligation = Obligation.new(
            tcx,
            ObligationCause.dummy(),
            this.infcx.param_env,
            Binder.dummy(coerce_shared_trait_ref, d_TraitRef),
            (from: PolyTraitRef, tcx_: Interner) => Predicate_upcast_from_PolyTraitRef(from, tcx_ as unknown as TyCtxt),
          );
          ocx.register_obligation(obligation);
          return Ok(null);
        }, "user_type_evaluate_coerce_shared"),
        TypeOp_CustomTypeOp<null>(fold_unit),
        ToUniverseInfo_never,
      );
      if (r.$ === "Err") {
        return bug("HIR type check passed CoerceShared but MIR found an issue");
      }

      // FIXME(reborrow): for CoerceShared we need to relate the types manually, field by
      // field. We cannot just attempt to relate `T` and `<T as CoerceShared>::Target` by
      // calling relate_types as they are (generally) two unrelated user-defined ADTs, such as
      // `CustomMut<'a>` and `CustomRef<'a>`, or `CustomMut<'a, T>` and `CustomRef<'a, T>`.
      // Field-by-field relate_types is expected to work because the trait has wf-checks
      // built-in.
      //
      // Eventually we'd prefer to do this based on some query result which tells us what
      // field pairs of src and dst to touch, and what to do to them (&mut coercion, just
      // copy, or CoerceShared). This might also need to be a recursive operation when fields
      // themselves implement CoerceShared.
      //
      // Or it might be that we don't need this loop at all and can just trust the trait
      // lifetime definitions to carry the day...? At least all reborrow tests pass without
      // this loop at the time of writing this comment.
      const sk = src_ty.kind();
      if (sk.$ !== "Adt") return unreachable();
      const [src_adt, src_args] = [sk._0, sk._1];
      const src_fields = [...src_adt.all_fields()];
      for (const dst_field of dst_adt.all_fields()) {
        const src_field = src_fields.find((f) => f.name === dst_field.name);
        if (src_field === undefined) {
          continue;
        }
        // These field types can still contain projections from the source or target type
        // and normalize them before handing them to `NllTypeRelating`
        const dst_ty_ = this.normalize(dst_field.ty(tcx, dst_args), to_locations(location), Normalizable_Ty, display_Ty, NormalizeLocation_Locations);
        const src_ty_ = this.normalize(src_field.ty(tcx, src_args), to_locations(location), Normalizable_Ty, display_Ty, NormalizeLocation_Locations);

        const sfk = src_ty_.kind();
        const dfk = dst_ty_.kind();
        if (sfk.$ === "Ref" && sfk._2 === Mutability.Mut && dfk.$ === "Ref" && dfk._2 === Mutability.Not) {
          const src_region = sfk._0;
          const dst_region_ = dfk._0;
          // FIXME(reborrow): the covariance relations here seem confused even after we
          // flipped them around. relate_types does dst <: src while outlives does
          // src <: dst. That seems incomprehensible.
          unwrap(
            this.relate_types(
              // dst <: src
              src_ty_.peel_refs(),
              Variance.Covariant,
              dst_ty_.peel_refs(),
              to_locations(location),
              category,
            ),
          );
          this.constraints.outlives_constraints.push({
            // 'src: 'dst
            sup: src_region.as_var(),
            sub: dst_region_.as_var(),
            locations: to_locations(location),
            span: Locations.span(to_locations(location), this.body),
            category,
            variance_info: VarianceDiagInfo.None,
            from_closure: false,
          });
        } else {
          unwrap(
            this.relate_types(
              // dst <: src
              src_ty_,
              Variance.Covariant,
              dst_ty_,
              to_locations(location),
              category,
            ),
          );
        }
      }
    } else {
      // Exclusive reborrow
      unwrap(this.relate_types(src_ty, Variance.Covariant, dst_ty, to_locations(location), category));
    }
  }

  // rustc: compiler/rustc_borrowck/src/type_check/mod.rs:2655 prove_aggregate_predicates
  prove_aggregate_predicates(aggregate_kind: AggregateKind, location: Location): void {
    const tcx = this.tcx();

    // debug!("prove_aggregate_predicates(aggregate_kind={:?}, location={:?})", aggregate_kind, location);

    let def_id: DefId;
    let instantiated_clauses: InstantiatedClauses;
    switch (aggregate_kind.$) {
      case "Adt": {
        const [adt_did, _v, args] = [aggregate_kind._0, aggregate_kind._1, aggregate_kind._2];
        [def_id, instantiated_clauses] = [adt_did, GenericClauses.instantiate(tcx.clauses_of(adt_did) as GenericClauses, tcx, args)];
        break;
      }

      // For closures, we have some **extra requirements** we
      // have to check. In particular, in their upvars and
      // signatures, closures often reference various regions
      // from the surrounding function -- we call those the
      // closure's free regions. When we borrow-check (and hence
      // region-check) closures, we may find that the closure
      // requires certain relationships between those free
      // regions. However, because those free regions refer to
      // portions of the CFG of their caller, the closure is not
      // in a position to verify those relationships. In that
      // case, the requirements get "propagated" to us, and so
      // we have to solve them here where we instantiate the
      // closure.
      //
      // Despite the opacity of the previous paragraph, this is
      // actually relatively easy to understand in terms of the
      // desugaring. A closure gets desugared to a struct, and
      // these extra requirements are basically like where
      // clauses on the struct.
      case "Closure":
      case "CoroutineClosure":
      case "Coroutine": {
        const [did, args] = [aggregate_kind._0, aggregate_kind._1];
        [def_id, instantiated_clauses] = [did, this.prove_closure_bounds(tcx, did.expect_local(), args, location)];
        break;
      }

      case "Array":
      case "Tuple":
      case "RawPtr":
        [def_id, instantiated_clauses] = [LocalDefId.to_def_id(CRATE_DEF_ID), InstantiatedClauses.empty()];
        break;
    }

    this.normalize_and_prove_instantiated_clauses(def_id, instantiated_clauses, to_locations(location));
  }

  // rustc: compiler/rustc_borrowck/src/type_check/mod.rs:2709 prove_closure_bounds
  prove_closure_bounds(tcx: TyCtxt, def_id: LocalDefId, args: GenericArgs, location: Location): InstantiatedClauses {
    const root_def_id = this.infcx.root_def_id;
    // We will have to handle propagated closure requirements for this closure,
    // but need to defer this until the nested body has been fully borrow checked.
    this.deferred_closure_requirements.push([def_id, args, to_locations(location)]);

    // Equate closure args to regions inherited from `root_def_id`. Fixes #98589.
    const typeck_root_args = RawList.identity_for_item(tcx, LocalDefId.to_def_id(root_def_id));

    let parent_args_0: readonly GenericArg[];
    const dk = tcx.def_kind(LocalDefId.to_def_id(def_id));
    if (dk.$ === "Closure") {
      // We don't want to dispatch on 3 different kind of closures here, so take
      // advantage of the fact that the `parent_args` is the same length as the
      // `typeck_root_args`.
      // FIXME(async_closures): It may be useful to add a debug assert here
      // to actually call `type_of` and check the `parent_args` are the same
      // length as the `typeck_root_args`.
      parent_args_0 = args.slice(0, typeck_root_args.length);
    } else if (dk.$ === "AnonConst" && (tcx.anon_const_kind(LocalDefId.to_def_id(def_id)) as AnonConstKind) === "NonTypeSystemInline") {
      parent_args_0 = InlineConstArgs.parent_args(args.as_inline_const());
    } else {
      return bug(`unexpected item ${dbg(dk, debug_DefKind)}`);
    }
    const parent_args = tcx.mk_args(parent_args_0);

    assert_eq(typeck_root_args.length, parent_args.length, String);
    if (this.eq_args(typeck_root_args, parent_args, to_locations(location), ConstraintCategory.BoringNoLocation).$ === "Err") {
      span_mirbug(
        this,
        dbg(def_id, debug_LocalDefId),
        `could not relate closure to parent ${dbg(typeck_root_args, debug_GenericArgs)} != ${dbg(parent_args, debug_GenericArgs)}`,
      );
    }

    return GenericClauses.instantiate(tcx.clauses_of(LocalDefId.to_def_id(def_id)) as GenericClauses, tcx, args);
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
  // rustc: compiler/rustc_borrowck/src/type_check/mod.rs:2768 to_locations
  to_locations(self: Locations): Locations {
    return self;
  },
};

// impl NormalizeLocation for Location
export const NormalizeLocation_Location: NormalizeLocation<MirLocation> = {
  debug: debug_Location,
  // rustc: compiler/rustc_borrowck/src/type_check/mod.rs:2774 to_locations
  to_locations(self: MirLocation): Locations {
    return { $: "Single", _0: self };
  },
};

// impl<'tcx> TypeOp<'tcx> for InstantiateOpaqueType<'tcx> { type Output = (); type ErrorInfo = InstantiateOpaqueType<'tcx>; }
export const TypeOp_InstantiateOpaqueType: TypeOp<InstantiateOpaqueType, null, InstantiateOpaqueType> = {
  // rustc: compiler/rustc_borrowck/src/type_check/mod.rs:2798 fully_perform
  fully_perform(self: InstantiateOpaqueType, infcx: InferCtxt, root_def_id: LocalDefId, span: Span): Result<TypeOpOutput<null, InstantiateOpaqueType>, ErrorGuaranteed> {
    const r = scrape_region_constraints<null, InstantiateOpaqueType>(
      infcx,
      root_def_id,
      "InstantiateOpaqueType",
      span,
      (ocx) => {
        ocx.register_obligations(self.obligations.map((o) => clone_Obligation(o, (p) => p)));
        return Ok(null);
      },
      fold_unit,
    );
    if (r.$ === "Err") return r;
    const [output, region_constraints] = r._0;
    self.region_constraints = region_constraints;
    output.error_info = self;
    return Ok(output);
  },
};
