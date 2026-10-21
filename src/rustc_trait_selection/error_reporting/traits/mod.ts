// Port of compiler/rustc_trait_selection/src/error_reporting/traits/mod.rs (lane errrep-traits-a).
//
// Every fn of this file is declared in src/rustc_trait_selection/decls.ts under `// error_reporting/traits/mod.rs:<line>`
// and assigned here in upstream order with its marker (`TypeErrCtxt.prototype.<name> = function (this: TypeErrCtxt, ..)`;
// free fns as `export function`).
// Init order: top-level code here may touch only the crate decls.ts (TypeErrCtxt), this file's .gen.ts and other
// crates; other rustc_trait_selection modules are read inside function bodies only.
//
// Ported here by lane errctxt-contract (small foundational items used by other files and crates): `FindExprBySpan`
// (hand class: an intravisit `Visitor`, with `new`) and the `impl ArgKind` companion.
export * from "./mod.gen.ts";
import type { ExternCrate } from "../../../rustc_crate_store/cstore.gen.ts";
import { type Diag, E0038, E0276, MultiSpan, struct_span_code_err } from "../../../rustc_errors/lib.ts";
import * as hir from "../../../rustc_hir/lib.ts";
import type { HirId } from "../../../rustc_hir_id/lib.ts";
import type { HirTyCtxt } from "../../../rustc_hir/intravisit.ts";
import { clone_Obligation } from "../../../rustc_infer/traits/mod.gen.ts";
import { TyCtxt_as_HirTyCtxt } from "../../../rustc_middle/hir/map.ts";
import { OnlyBodies } from "../../../rustc_middle/hir/nested_filter.ts";
import { clone_DynCompatibilityViolation } from "../../../rustc_middle/traits/mod.gen.ts";
import { DynCompatibilityViolation, DynCompatibilityViolationSolution, ObligationCauseCode, SelectionError } from "../../../rustc_middle/traits/mod.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { Predicate, Ty } from "../../../rustc_middle/ty/decls.ts";
import { GenericArg } from "../../../rustc_middle/ty/generic_args.ts";
import type { GenericClauses } from "../../../rustc_middle/ty/generics.ts";
import { RawList } from "../../../rustc_middle/ty/list.ts";
import { display_Clause, display_GenericArg, display_TraitRefPrintOnlyTraitPath, display_Ty, TraitRef_print_only_trait_path, with_no_trimmed_paths } from "../../../rustc_middle/ty/print/pretty.ts";
import { fold_Predicate, fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { TraitImpls } from "../../../rustc_middle/ty/trait_def.ts";
import { str_cmp } from "../../../rustc_session/options.ts";
import { type DefId, DefId_eq, DefIdSet, LOCAL_CRATE, LocalDefId } from "../../../rustc_span/def_id.ts";
import { SyntaxContext } from "../../../rustc_span/hygiene.ts";
import { type ErrorGuaranteed, type OrdSpan, Span } from "../../../rustc_span/lib.ts";
import { display_Symbol, Symbol } from "../../../rustc_span/symbol.ts";
import { Binder, EarlyBinder } from "../../../rustc_type_ir/binder.ts";
import { HostEffectClause, ImplPolarity, PolyTraitClause, TraitClause } from "../../../rustc_type_ir/predicate.ts";
import { TyOrConstInferVar } from "../../../rustc_type_ir/solve/mod.ts";
import type { Goal } from "../../../rustc_type_ir/solve/mod.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { upcast_from_self } from "../../../rustc_type_ir/upcast.ts";
import { type TypeVisitable, TypeVisitableExt } from "../../../rustc_type_ir/visit.ts";
import { intern_key } from "../../../rust_ts/intern_key.ts";
import { KeyedSet } from "../../../rust_ts/keyed.ts";
import { FxHashSet, type KeyType, String_key } from "../../../rust_ts/hash_map.ts";
import { type SortLayout, slice_sort_unstable_by } from "../../../std/slice_sort.ts";
import { unreachable } from "../../../std/panic.ts";
import { TypeErrCtxt } from "../../decls.ts";
import type { FulfillmentError } from "../../traits/mod.gen.ts";
import type { ArgKind as ArgKindT } from "./mod.gen.ts";

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/traits/mod.rs:58 FindExprBySpan
/// Crude way of getting back an `Expr` from a `Span`.
export class FindExprBySpan extends hir.intravisit.Visitor {
  // impl<'v> Visitor<'v> for FindExprBySpan<'v>
  // type NestedFilter = rustc_middle::hir::nested_filter::OnlyBodies;
  override NestedFilter = OnlyBodies;

  constructor(
    public span: Span,
    public result: hir.Expr | undefined,
    public ty_result: hir.Ty | undefined,
    public include_closures: boolean,
    public tcx: TyCtxt,
  ) {
    super();
  }

  // impl<'hir> FindExprBySpan<'hir>

  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/mod.rs:67 new
  static new(span: Span, tcx: TyCtxt): FindExprBySpan {
    return new FindExprBySpan(span, undefined, undefined, false, tcx);
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/mod.rs:75 maybe_tcx
  override maybe_tcx(): HirTyCtxt {
    return TyCtxt_as_HirTyCtxt(this.tcx);
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/mod.rs:79 visit_expr
  override visit_expr(ex: hir.Expr): undefined {
    if (this.span === ex.span) {
      this.result = ex;
    } else {
      let closure_header_sp: Span;
      if (
        ex.kind.$ === "Closure" &&
        this.include_closures &&
        ((closure_header_sp = Span.with_hi(this.span, Span.hi(ex.span))), true) &&
        closure_header_sp === ex.span
      ) {
        this.result = ex;
      }
      hir.intravisit.walk_expr(this, ex);
    }
    return undefined;
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/mod.rs:94 visit_ty
  override visit_ty(ty: hir.Ty<hir.AmbigArg>): undefined {
    if (this.span === ty.span) {
      this.ty_result = ty.as_unambig_ty();
    } else {
      hir.intravisit.walk_ty(this, ty);
    }
    return undefined;
  }
}

export type ArgKind = ArgKindT;
/** `impl ArgKind` (PORTING §8: enum methods on the companion). */
export const ArgKind = {
  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/mod.rs:117 empty
  empty(): ArgKindT {
    return { $: "Arg", _0: "_", _1: "_" };
  },

  /// Creates an `ArgKind` from the expected type of an
  /// argument. It has no name (`_`) and an optional source span.
  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/mod.rs:123 from_expected_ty
  from_expected_ty(t: Ty, span: Span | undefined): ArgKindT {
    const kind = t.kind();
    switch (kind.$) {
      case "Tuple":
        return { $: "Tuple", _0: span, _1: kind._0.map((ty): [string, string] => ["_", display_Ty(ty)]) };
      default:
        return { $: "Arg", _0: "_", _1: display_Ty(t) };
    }
  },
};

// impl<'a, 'tcx> TypeErrCtxt<'a, 'tcx>

/** `#[derive(Debug)] struct ErrorDescriptor` (local to `report_fulfillment_errors`). */
interface ErrorDescriptor {
  goal: Goal<Predicate>;
  index: number | undefined; // None if this is an old error
}

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/mod.rs:141 report_fulfillment_errors
TypeErrCtxt.prototype.report_fulfillment_errors = function (this: TypeErrCtxt, errors_: FulfillmentError[]): ErrorGuaranteed {
  // PORT: `mut errors: ThinVec<..>` is owned (and sorted in place) upstream; the port sorts a copy.
  const errors = [...errors_];

  const error_map = new Map<Span, ErrorDescriptor[]>();
  for (const [span, goals] of this.reported_trait_errors) {
    error_map.set(
      span,
      goals[0].map((goal): ErrorDescriptor => ({ goal, index: undefined })),
    );
  }

  // Ensure `T: Sized`, `T: MetaSized`, `T: PointeeSized` and `T: WF` obligations come last,
  // and `Subtype` obligations from `FormatLiteral` desugarings come first.
  // This lets us display diagnostics with more relevant type information and hide redundant
  // E0282 errors.
  // PORT: `#[derive(PartialEq, Eq, PartialOrd, Ord)] enum ErrorSortKey` as `[variant index, ..fields]` compared
  // lexicographically: SubtypeFormat(usize, usize) = 0, OtherKind = 1, SizedTrait = 2, MetaSizedTrait = 3,
  // PointeeSizedTrait = 4, Coerce = 5, WellFormed = 6. `sort_by_key` is stable, as `Array.prototype.sort`.
  const sort_key = (e: FulfillmentError): number[] => {
    const k0 = Binder.skip_binder(e.obligation.predicate.kind());
    let maybe_sizedness_did: DefId | undefined;
    if (k0.$ === "Clause" && k0._0.$ === "Trait") {
      maybe_sizedness_did = TraitClause.def_id(k0._0._0);
    } else if (k0.$ === "Clause" && k0._0.$ === "HostEffect") {
      maybe_sizedness_did = HostEffectClause.def_id(k0._0._0);
    } else {
      maybe_sizedness_did = undefined;
    }

    const k = Binder.skip_binder(e.obligation.predicate.kind());
    if (k.$ === "Subtype" && Span.desugaring_kind(e.obligation.cause.span)?.$ === "FormatLiteral") {
      const [, row, col] = this.tcx.sess.source_map().span_to_location_info(e.obligation.cause.span);
      return [0, row, col];
    } else if (option_def_id_eq(maybe_sizedness_did, this.tcx.lang_items().sized_trait())) {
      return [2];
    } else if (option_def_id_eq(maybe_sizedness_did, this.tcx.lang_items().meta_sized_trait())) {
      return [3];
    } else if (option_def_id_eq(maybe_sizedness_did, this.tcx.lang_items().pointee_sized_trait())) {
      return [4];
    } else if (k.$ === "Coerce") {
      return [5];
    } else if (k.$ === "Clause" && k._0.$ === "WellFormed") {
      return [6];
    } else {
      return [1];
    }
  };
  const keys = new Map<FulfillmentError, number[]>();
  for (const e of errors) keys.set(e, sort_key(e));
  errors.sort((a, b) => cmp_lex(keys.get(a)!, keys.get(b)!));

  for (let index = 0; index < errors.length; index++) {
    const error = errors[index]!;
    // We want to ignore desugarings here: spans are equivalent even
    // if one is the result of a desugaring and the other is not.
    let span = error.obligation.cause.span;
    const expn_data = SyntaxContext.outer_expn_data(Span.ctxt(span));
    if (expn_data.kind.$ === "Desugaring") {
      span = expn_data.call_site;
    }

    let entry = error_map.get(span);
    if (entry === undefined) {
      entry = [];
      error_map.set(span, entry);
    }
    entry.push({ goal: error.obligation.as_goal(), index });
  }

  // We do this in 2 passes because we want to display errors in order, though
  // maybe it *is* better to sort errors by span or something.
  const is_suppressed: boolean[] = errors.map(() => false);
  // A failing trait goal also fails every projection goal resting on it. Ambiguity
  // errors are exempt: they get merged into a single diagnostic whose notes list all
  // the constraints the annotation has to satisfy, so their projections still say
  // something the trait error doesn't.
  const covered_by_trait_error = (cond: ErrorDescriptor, error: ErrorDescriptor): boolean => {
    const is_definite = (error: ErrorDescriptor): boolean => error.index !== undefined && !(errors[error.index]!.code.$ === "Ambiguity");
    return is_definite(cond) && is_definite(error) && this.trait_error_implies_projection_error(cond.goal, error.goal);
  };
  for (const [, error_set] of error_map) {
    // We want to suppress "duplicate" errors with the same span.
    for (const error of error_set) {
      if (error.index !== undefined) {
        const index = error.index;
        // Suppress errors that are either:
        // 1) strictly implied by another error.
        // 2) implied by an error with a smaller index.
        for (const error2 of error_set) {
          if (error2.index !== undefined && is_suppressed[error2.index]) {
            // Avoid errors being suppressed by already-suppressed
            // errors, to prevent all errors from being suppressed
            // at once.
            continue;
          }

          if (
            (this.error_implies(error2.goal, error.goal) &&
              !(option_usize_ge(error2.index, error.index) && this.error_implies(error.goal, error2.goal))) ||
            covered_by_trait_error(error2, error)
          ) {
            // info!("skipping {:?} (implied by {:?})", error, error2);
            is_suppressed[index] = true;
            break;
          }
        }
      }
    }
  }

  // Ambiguity errors blaming the same inference variable describe a single problem:
  // annotating that one variable has to satisfy all of them at once. Reporting them
  // separately loses all but the first, as the rest get canceled as duplicates once
  // the `infcx` is tainted (see `maybe_report_ambiguity`), hiding their requirements
  // from the user. Instead, report the first one (the sort above placed the most
  // informative obligation first) and mention the requirements of the others in it.
  //
  // Type variables that are only related through a pending `Coerce` or `Subtype`
  // obligation still concern the same annotation, so compare their sub-unification
  // roots, like `need_type_info` does when looking for the annotation source.
  const ambiguity_infer_var = (error: FulfillmentError): TyOrConstInferVar | undefined => {
    if (error.code.$ === "Ambiguity" && error.code.overflow === undefined) {
      const term = this.ambiguity_term(this.deeply_resolve_ignoring_regions(error.obligation.predicate, fold_Predicate));
      if (term === undefined) return undefined;
      let var_: TyOrConstInferVar | undefined;
      for (const arg of GenericArg.walk(GenericArg.from_Term(term))) {
        var_ = TyOrConstInferVar.maybe_from_generic_arg(arg);
        if (var_ !== undefined) break;
      }
      if (var_ === undefined) return undefined;
      if (var_.$ === "Ty") {
        return { $: "Ty", _0: this.sub_unification_table_root_var(var_._0) };
      } else {
        return var_;
      }
    } else {
      return undefined;
    }
  };
  const infer_vars: (TyOrConstInferVar | undefined)[] = errors.map(ambiguity_infer_var);

  let reported: ErrorGuaranteed | undefined = undefined;
  const merged: (ErrorGuaranteed | undefined)[] = errors.map(() => undefined);
  const reported_as_primary: boolean[] = errors.map(() => false);
  for (const from_expansion of [false, true]) {
    for (let index = 0; index < errors.length; index++) {
      const error = errors[index]!;
      const suppressed = is_suppressed[index]!;
      if (!suppressed && Span.from_expansion(error.obligation.cause.span) === from_expansion) {
        if (!TypeVisitableExt.references_error(error, d_FulfillmentError)) {
          let guar: ErrorGuaranteed;
          const merged_guar = merged[index];
          if (merged_guar !== undefined) {
            guar = merged_guar;
          } else {
            const var_ = infer_vars[index];
            const group: number[] = [];
            if (var_ !== undefined) {
              for (let other = 0; other < errors.length; other++) {
                if (other !== index && ty_or_const_infer_var_eq(infer_vars[other], var_)) group.push(other);
              }
            }
            // Only merge errors that a note on this diagnostic can fully
            // represent. An error blaming a different expression labels that
            // expression and suggests how to annotate it, and one whose
            // predicate we can't phrase as a note (e.g. const evaluatability)
            // says nothing here, so both keep their own error.
            const merges = (other: number): boolean => {
              if (errors[other]!.obligation.cause.span !== error.obligation.cause.span) return false;
              const k = Binder.skip_binder(errors[other]!.obligation.predicate.kind());
              if (k.$ === "Clause" && k._0.$ === "Trait") {
                const data = k._0._0;
                const li = this.tcx.as_lang_item(TraitClause.def_id(data));
                return !(li === "Sized" || li === "MetaSized" || li === "PointeeSized");
              } else if (k.$ === "Clause" && k._0.$ === "Projection") {
                return true;
              } else {
                return false;
              }
            };
            const related: FulfillmentError[] = group
              .filter((other) => {
                // Exclude already-reported primaries: they were their own
                // canonical error and adding them as notes here would
                // produce duplicate information.
                return (
                  merges(other) &&
                  !is_suppressed[other] &&
                  !TypeVisitableExt.references_error(errors[other]!, d_FulfillmentError) &&
                  !reported_as_primary[other]
                );
              })
              .map((other) => errors[other]!);
            const guar_ = this.report_fulfillment_error(error, related);
            for (const other of group) {
              if (merges(other)) {
                merged[other] = guar_;
              }
            }
            reported_as_primary[index] = true;
            guar = guar_;
          }
          this.infcx.set_tainted_by_errors(guar);
          reported = guar;
          // We want to ignore desugarings here: spans are equivalent even
          // if one is the result of a desugaring and the other is not.
          let span = error.obligation.cause.span;
          const expn_data = SyntaxContext.outer_expn_data(Span.ctxt(span));
          if (expn_data.kind.$ === "Desugaring") {
            span = expn_data.call_site;
          }
          let entry = this.reported_trait_errors.get(span);
          if (entry === undefined) {
            entry = [[], guar];
            this.reported_trait_errors.set(span, entry);
          }
          entry[0].push(error.obligation.as_goal());
        }
        const guar = this.dcx().has_errors();
        if (guar !== undefined) {
          this.infcx.set_tainted_by_errors(guar);
        }
      }
    }
  }

  // It could be that we don't report an error because we have seen an `ErrorReported` from
  // another source. We should probably be able to fix most of these, but some are delayed
  // bugs that get a proper error after this function.
  return reported ?? this.dcx().delayed_bug("failed to report fulfillment errors");
};

// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/mod.rs:394 report_fulfillment_error
TypeErrCtxt.prototype.report_fulfillment_error = function (
  this: TypeErrCtxt,
  error_: FulfillmentError,
  related: readonly FulfillmentError[],
): ErrorGuaranteed {
  const m = traits_mod_gen();
  const error = new m.FulfillmentError(
    clone_Obligation(error_.obligation, (p) => p),
    m.clone_FulfillmentErrorCode(error_.code),
    clone_Obligation(error_.root_obligation, (p) => p),
  );
  if (
    ((error.code.$ === "Select" && error.code._0.$ === "Unimplemented") || error.code.$ === "Project") &&
    this.apply_do_not_recommend(error.obligation, error.root_obligation)
  ) {
    error.code = { $: "Select", _0: SelectionError.Unimplemented };
  }

  const code = error.code;
  switch (code.$) {
    case "Select": {
      const selection_error = code._0;
      return this.report_selection_error(clone_Obligation(error.obligation, (p) => p), error.root_obligation, selection_error);
    }
    case "Project": {
      const e = code._0;
      return this.report_projection_error(error.obligation, e);
    }
    case "Outlives":
      return this.dcx().struct_span_err(error.obligation.cause.span, "higher-ranked lifetime bound could not be satisfied").emit_err();
    case "Ambiguity": {
      if (code.overflow === undefined) {
        return this.maybe_report_ambiguity(error.obligation, related);
      } else {
        const suggest_increasing_limit = code.overflow;
        return this.report_overflow_no_abort(clone_Obligation(error.obligation, (p) => p), suggest_increasing_limit);
      }
    }
    case "Subtype": {
      const expected_found = code._0;
      const err = code._1;
      return this.report_mismatched_types(error.obligation.cause, error.obligation.param_env, expected_found.expected, expected_found.found, err).emit_err();
    }
    case "ConstEquate": {
      const expected_found = code._0;
      const err = code._1;
      const diag = this.report_mismatched_consts(error.obligation.cause, error.obligation.param_env, expected_found.expected, expected_found.found, err);
      const code_ = ObligationCauseCode.peel_match_impls(ObligationCauseCode.peel_derives(error.obligation.cause.code_()));
      if (code_.$ === "WhereClause" || code_.$ === "WhereClauseInExpr") {
        this.note_obligation_cause_code(
          error.obligation.cause.body_def_id,
          diag,
          error.obligation.predicate,
          error.obligation.param_env,
          code_,
          [],
          new DefIdSet(),
          upcast_from_self,
        );
      }
      return diag.emit_err();
    }
    case "Cycle": {
      const cycle = code._0;
      return this.report_overflow_obligation_cycle(cycle);
    }
  }
};

/// If the crates of `expected_def_id` and `trait_def_id` are imported as extern crate
/// under the same name (`extern crate foo as a` and `extern crate bar as a`) returns true,
/// otherwise returns false.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/mod.rs:475 extern_crates_with_the_same_name
TypeErrCtxt.prototype.extern_crates_with_the_same_name = function (this: TypeErrCtxt, expected_def_id_: DefId, trait_def_id_: DefId): boolean {
  if (expected_def_id_.is_local() || trait_def_id_.is_local()) {
    return false;
  }
  // We only compare direct dependencies of the current crate, so it avoids unnecessary
  // processing and excludes indirect dependencies, like `std` or `core`. In such a case
  // both would be imported under the same name `std`.
  const a = this.tcx.extern_crate(expected_def_id_.krate) as ExternCrate | undefined;
  const b = this.tcx.extern_crate(trait_def_id_.krate) as ExternCrate | undefined;
  if (
    a !== undefined &&
    a.src.$ === "Extern" &&
    a.dependency_of === LOCAL_CRATE &&
    b !== undefined &&
    b.src.$ === "Extern" &&
    b.dependency_of === LOCAL_CRATE
  ) {
    const expected_def_id = a.src._0;
    const trait_def_id = b.src._0;
    return this.tcx.item_name(expected_def_id) === this.tcx.item_name(trait_def_id);
  } else {
    return false;
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/mod.rs:506 check_same_definition_different_crate
TypeErrCtxt.prototype.check_same_definition_different_crate = function (
  this: TypeErrCtxt,
  err: Diag,
  expected_did: DefId,
  found_dids: Iterable<DefId>,
  get_impls: (_0: DefId) => Span[],
  ty: string,
): boolean {
  const krate = this.tcx.crate_name(expected_did.krate);
  const name = this.tcx.item_name(expected_did);
  // PORT: `UnordSet<(String, DefId)>` is an `FxHashSet` (hashbrown order; `===` on canonical tuples, one per value), and
  // `into_sorted_stable_ord_by_key(|(p, _)| p)` is `sort_unstable_by` (`String: StableCompare` has
  // `CAN_USE_UNSTABLE_SORT`): ties (same path, different `DefId`) keep hashbrown's iteration order, as rustc's.
  const tuples = new Map<string, [string, DefId]>();
  const definitions_with_same_path_set = new FxHashSet<[string, DefId]>(String_DefId_key);
  for (const def_id of found_dids) {
    if (
      def_id.krate !== expected_did.krate &&
      (this.extern_crates_with_the_same_name(expected_did, def_id) || this.tcx.crate_name(def_id.krate) === krate) &&
      this.tcx.item_name(def_id) === name
    ) {
      const t: [string, DefId] = [this.tcx.def_path_str(def_id), def_id];
      const k = intern_key(t);
      definitions_with_same_path_set.add(tuples.get(k) ?? (tuples.set(k, t), t));
    }
  }

  const definitions_with_same_path = [...definitions_with_same_path_set];
  slice_sort_unstable_by(definitions_with_same_path, (x, y) => str_cmp(x[0], y[0]), LAYOUT_String_DefId);
  let suggested = false;
  let trait_is_impl = false;

  if (definitions_with_same_path.length !== 0) {
    const span: MultiSpan = MultiSpan.from_span(this.tcx.def_span(expected_did));
    span.push_span_label(this.tcx.def_span(expected_did), `this is the expected ${ty}`);
    suggested = true;
    for (const [, definition_with_same_path] of definitions_with_same_path) {
      const definitions_impls = get_impls(definition_with_same_path);
      if (definitions_impls.length === 0) {
        continue;
      }

      for (const candidate_span of definitions_impls) {
        span.push_span_label(candidate_span, `this is the found ${ty}`);
        trait_is_impl = true;
      }
    }
    if (!trait_is_impl) {
      for (const [, def_id] of definitions_with_same_path) {
        span.push_span_label(this.tcx.def_span(def_id), `this is the ${ty} that was imported`);
      }
    }
    this.note_two_crate_versions(expected_did.krate, span, err);
    err.help("you can use `cargo tree` to explore your dependency tree");
  }
  return suggested;
};

/** `#[derive(Debug, Default)] struct SizednessFound` (local to `to_pretty_impl_header`). */
interface SizednessFound {
  sized: boolean;
  meta_sized: boolean;
}

/// Recovers the "impl X for Y" signature from `impl_def_id` and returns it as a
/// string.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/mod.rs:569 to_pretty_impl_header
export function to_pretty_impl_header(tcx: TyCtxt, impl_def_id: DefId): string | undefined {
  const opt = tcx.impl_opt_trait_ref(impl_def_id);
  if (opt === undefined) return undefined;
  const trait_ref = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(opt));
  let w = "impl";

  const types_with_sizedness_bounds = new Map<Ty, SizednessFound>();

  const args = RawList.identity_for_item(tcx, impl_def_id);

  const arg_names = args.map((k) => display_GenericArg(k)).filter((k) => k !== "'_");
  if (arg_names.length !== 0) {
    w += "<";
    w += arg_names.join(", ");
    w += ">";

    for (const ty of args.types()) {
      // `PointeeSized` params might have no predicates.
      types_with_sizedness_bounds.set(ty, { sized: false, meta_sized: false });
    }
  }

  w += ` ${ImplPolarity.as_str(tcx.impl_polarity(impl_def_id))}${display_TraitRefPrintOnlyTraitPath(TraitRef_print_only_trait_path(trait_ref))} for ${display_Ty(
    Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(impl_def_id) as EarlyBinder<Ty>)),
  )}`;

  const clauses = (tcx.clauses_of(impl_def_id) as GenericClauses).clauses;
  const pretty_clauses: string[] = [];

  const sized_trait = tcx.lang_items().sized_trait();
  const meta_sized_trait = tcx.lang_items().meta_sized_trait();

  for (const [c] of clauses) {
    // Accumulate the sizedness bounds for each self ty.
    const trait_clause = c.as_trait_clause();
    if (trait_clause !== undefined) {
      const self_ty = Binder.skip_binder(PolyTraitClause.self_ty(trait_clause));
      let sizedness_of = types_with_sizedness_bounds.get(self_ty);
      if (sizedness_of === undefined) {
        sizedness_of = { sized: false, meta_sized: false };
        types_with_sizedness_bounds.set(self_ty, sizedness_of);
      }
      if (option_def_id_eq(PolyTraitClause.def_id(trait_clause), sized_trait)) {
        sizedness_of.sized = true;
        continue;
      } else if (option_def_id_eq(PolyTraitClause.def_id(trait_clause), meta_sized_trait)) {
        sizedness_of.meta_sized = true;
        continue;
      }
    }

    pretty_clauses.push(display_Clause(c));
  }

  for (const [ty, sizedness] of types_with_sizedness_bounds) {
    if (!tcx.features().sized_hierarchy()) {
      if (sizedness.sized) {
        // Maybe a default bound, don't write anything.
      } else {
        pretty_clauses.push(`${display_Ty(ty)}: ?Sized`);
      }
    } else {
      if (sizedness.sized) {
        // Maybe a default bound, don't write anything.
        pretty_clauses.push(`${display_Ty(ty)}: Sized`);
      } else if (sizedness.meta_sized) {
        pretty_clauses.push(`${display_Ty(ty)}: MetaSized`);
      } else {
        pretty_clauses.push(`${display_Ty(ty)}: PointeeSized`);
      }
    }
  }

  if (pretty_clauses.length !== 0) {
    w += `\n  where ${pretty_clauses.join(", ")}`;
  }

  w += ";";
  return w;
}

// impl<'a, 'tcx> TypeErrCtxt<'a, 'tcx>

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/mod.rs:657 report_extra_impl_obligation
TypeErrCtxt.prototype.report_extra_impl_obligation = function (
  this: TypeErrCtxt,
  error_span: Span,
  impl_item_def_id: LocalDefId,
  trait_item_def_id: DefId,
  requirement: string,
): Diag {
  const err = struct_span_code_err(this.dcx(), error_span, E0276, "impl has stricter requirements than trait");

  if (!this.tcx.is_impl_trait_in_trait(trait_item_def_id)) {
    const span = this.tcx.hir_span_if_local(trait_item_def_id);
    if (span !== undefined) {
      const item_name = this.tcx.item_name(LocalDefId.to_def_id(impl_item_def_id));
      err.span_label(span, `definition of \`${display_Symbol(item_name)}\` from trait`);
    }
  }

  err.span_label(error_span, `impl has extra requirement ${requirement}`);

  return err;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/mod.rs:684 report_dyn_incompatibility
export function report_dyn_incompatibility(
  tcx: TyCtxt,
  span: Span,
  hir_id: HirId | undefined,
  trait_def_id: DefId,
  violations: readonly DynCompatibilityViolation[],
): Diag {
  const trait_str = tcx.def_path_str(trait_def_id);
  const node = tcx.hir_get_if_local(trait_def_id);
  let trait_span: Span | undefined;
  if (node === undefined) {
    trait_span = undefined;
  } else if (node.$ === "Item") {
    const kind = node._0.kind;
    if (kind.$ === "Trait") {
      trait_span = kind.ident.span;
    } else if (kind.$ === "TraitAlias") {
      trait_span = kind._1.span;
    } else {
      return unreachable();
    }
  } else {
    trait_span = undefined;
  }

  const err = struct_span_code_err(tcx.dcx(), span, E0038, `the ${tcx.def_descr(trait_def_id)} \`${trait_str}\` is not dyn compatible`);
  err.span_label(span, `\`${trait_str}\` is not dyn compatible`);

  attempt_dyn_to_impl_suggestion(tcx, hir_id, err);

  // PORT: `FxIndexSet<DynCompatibilityViolation>` keyed by the derived `Hash + Eq` (`intern_key`).
  const reported_violations = new KeyedSet<DynCompatibilityViolation>((v) => intern_key(v));
  const multi_span: Span[] = [];
  const messages: string[] = [];
  for (const violation of violations) {
    if (violation.$ === "SizedSelf" && violation._0.length !== 0) {
      // Do not report `SizedSelf` without spans pointing at `SizedSelf` obligations
      // with a `Span`.
      reported_violations.add({ $: "SizedSelf", _0: [] });
    }
    if (set_insert(reported_violations, clone_DynCompatibilityViolation(violation))) {
      const spans = DynCompatibilityViolation.spans(violation);
      const msg =
        trait_span === undefined || spans.length === 0
          ? `the trait is not dyn compatible because ${DynCompatibilityViolation.error_msg(violation)}`
          : `...because ${DynCompatibilityViolation.error_msg(violation)}`;
      if (spans.length === 0) {
        err.note(msg);
      } else {
        for (const span of spans) {
          multi_span.push(span);
          messages.push(msg);
        }
      }
    }
  }
  const has_multi_span = multi_span.length !== 0;
  const note_span = MultiSpan.from_spans([...multi_span]);
  if (trait_span !== undefined && has_multi_span) {
    note_span.push_span_label(trait_span, "this trait is not dyn compatible...");
  }
  for (let i = 0; i < multi_span.length && i < messages.length; i++) {
    note_span.push_span_label(multi_span[i]!, messages[i]!);
  }
  err.span_note(
    note_span,
    "for a trait to be dyn compatible it needs to allow building a vtable\n" +
      "for more information, visit <https://doc.rust-lang.org/reference/items/traits.html#dyn-compatibility>",
  );

  // Only provide the help if its a local trait, otherwise it's not actionable.
  if (trait_span !== undefined) {
    const potential_solutions: DynCompatibilityViolationSolution[] = [...reported_violations].map((violation) =>
      DynCompatibilityViolation.solution(violation),
    );
    potential_solutions.sort(cmp_DynCompatibilityViolationSolution);
    // Allows us to skip suggesting that the same item should be moved to another trait multiple times.
    const deduped: DynCompatibilityViolationSolution[] = [];
    for (const s of potential_solutions) {
      if (deduped.length === 0 || cmp_DynCompatibilityViolationSolution(deduped[deduped.length - 1]!, s) !== 0) deduped.push(s);
    }
    for (const solution of deduped) {
      DynCompatibilityViolationSolution.add_to(solution, err);
    }
  }

  attempt_dyn_to_enum_suggestion(tcx, trait_def_id, trait_str, err);

  return err;
}

/// Attempt to suggest converting the `dyn Trait` argument to an enumeration
/// over the types that implement `Trait`.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/mod.rs:775 attempt_dyn_to_enum_suggestion
export function attempt_dyn_to_enum_suggestion(tcx: TyCtxt, trait_def_id: DefId, trait_str: string, err: Diag): void {
  const impls_of = tcx.trait_impls_of(trait_def_id) as TraitImpls;

  if (TraitImpls.blanket_impls(impls_of).length !== 0) {
    return;
  }

  // PORT: `.collect::<Option<Vec<_>>>()` stops at the first `None`.
  let concrete_impls: Ty[] | undefined = [];
  outer: for (const impl_ids of TraitImpls.non_blanket_impls(impls_of).values()) {
    for (const impl_id of impl_ids) {
      // Don't suggest conversion to enum if the impl types have type parameters.
      // It's unlikely the user wants to define a generic enum.
      const impl_type = EarlyBinder.no_bound_vars(tcx.type_of(impl_id) as EarlyBinder<Ty>, fold_Ty);
      if (impl_type === undefined) {
        concrete_impls = undefined;
        break outer;
      }

      // Obviously unsized impl types won't be usable in an enum.
      // Note: this doesn't use `Ty::has_trivial_sizedness` because that function
      // defaults to assuming that things are *not* sized, whereas we want to
      // fall back to assuming that things may be sized.
      const k = impl_type.kind();
      if (k.$ === "Str" || k.$ === "Slice" || k.$ === "Dynamic") {
        concrete_impls = undefined;
        break outer;
      }
      concrete_impls.push(impl_type);
    }
  }
  if (concrete_impls === undefined) return;

  const MAX_IMPLS_TO_SUGGEST_CONVERTING_TO_ENUM = 9;
  if (concrete_impls.length === 0 || concrete_impls.length > MAX_IMPLS_TO_SUGGEST_CONVERTING_TO_ENUM) {
    return;
  }

  const def_id = trait_def_id.as_local();
  // We may be executing this during typeck, which would result in cycle
  // if we used effective_visibilities query, which looks into opaque types
  // (and therefore calls typeck).
  const externally_visible = def_id !== undefined ? tcx.resolutions(null).effective_visibilities.is_exported(def_id) : false;

  if (concrete_impls.length === 1) {
    const only_impl = concrete_impls[0]!;
    const within = externally_visible ? " within this crate" : "";
    err.help(
      with_no_trimmed_paths(
        () => `only type \`${display_Ty(only_impl)}\` implements \`${trait_str}\`${within}; consider using it directly instead.`,
      ),
    );
  } else {
    const types = concrete_impls.map((t) => with_no_trimmed_paths(() => `  ${display_Ty(t)}`)).join("\n");

    err.help(
      `the following types implement \`${trait_str}\`:\n` +
        `${types}\n` +
        `consider defining an enum where each variant holds one of these types,\n` +
        `implementing \`${trait_str}\` for this new enum and using it instead`,
    );
  }

  if (externally_visible) {
    err.note(
      `\`${trait_str}\` may be implemented in other crates; if you want to support your users ` +
        `passing their own types here, you can't refer to a specific type`,
    );
  }
}

/// Attempt to suggest that a `dyn Trait` argument or return type be converted
/// to use `impl Trait`.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/mod.rs:856 attempt_dyn_to_impl_suggestion
export function attempt_dyn_to_impl_suggestion(tcx: TyCtxt, hir_id: HirId | undefined, err: Diag): void {
  if (hir_id === undefined) return;
  const node = tcx.hir_node(hir_id);
  if (node.$ !== "Ty") return;
  const ty = node._0;
  if (ty.kind.$ !== "TraitObject" || ty.kind._0.length < 1) return;
  const trait_ref = ty.kind._0[0]!;

  // Only suggest converting `dyn` to `impl` if we're in a function signature.
  // This ensures that we don't suggest converting e.g.
  //   `type Alias = Box<dyn DynIncompatibleTrait>;` to
  //   `type Alias = Box<impl DynIncompatibleTrait>;`
  let first_non_type_parent_node: hir.Node | undefined;
  for (const [, node] of tcx.hir_parent_iter(hir_id)) {
    if (node.$ !== "Ty") {
      first_non_type_parent_node = node;
      break;
    }
  }
  if (first_non_type_parent_node === undefined) {
    return;
  }
  if (hir.Node.fn_sig(first_non_type_parent_node) === undefined) {
    return;
  }

  err.span_suggestion_verbose(Span.until(ty.span, trait_ref.span), "consider using an opaque type instead", "impl ", "MaybeIncorrect");
}

// ---- helpers ---------------------------------------------------------------------------------------------------------

/** `Option<DefId> == Option<DefId>` (`None == None`). */
function option_def_id_eq(a: DefId | undefined, b: DefId | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return DefId_eq(a, b);
}

/** `Option<usize> >= Option<usize>` (derived `PartialOrd`: `None < Some(_)`). */
function option_usize_ge(a: number | undefined, b: number | undefined): boolean {
  if (b === undefined) return true;
  if (a === undefined) return false;
  return a >= b;
}

/** Lexicographic order of the `ErrorSortKey` encodings (derived `Ord`). */
function cmp_lex(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length && i < b.length; i++) {
    if (a[i]! !== b[i]!) return a[i]! < b[i]! ? -1 : 1;
  }
  return a.length - b.length;
}

/** `Option<TyOrConstInferVar> == Some(var)` (derived `PartialEq`; the vids are numbers). */
function ty_or_const_infer_var_eq(a: TyOrConstInferVar | undefined, b: TyOrConstInferVar): boolean {
  return a !== undefined && a.$ === b.$ && a._0 === b._0;
}

/** `IndexSet::insert`: `true` when the value was not present. */
function set_insert<T>(set: KeyedSet<T>, v: T): boolean {
  if (set.has(v)) return false;
  set.add(v);
  return true;
}

/** `#[derive(PartialOrd, Ord)]` on `DynCompatibilityViolationSolution` (rustc_middle traits/mod.rs:906): variant order,
 *  then the fields (`Symbol` by index, `String` by bytes, `OrdSpan` by `lo_hi`). */
function cmp_DynCompatibilityViolationSolution(a: DynCompatibilityViolationSolution, b: DynCompatibilityViolationSolution): number {
  const order = ["None", "AddSelfOrMakeSized", "ChangeToRefSelf", "MoveToAnotherTrait"];
  const va = order.indexOf(a.$);
  const vb = order.indexOf(b.$);
  if (va !== vb) return va < vb ? -1 : 1;
  const sym_cmp = (x: Symbol, y: Symbol): number => Symbol.as_u32(x) - Symbol.as_u32(y);
  const pair_cmp = (x: [string, OrdSpan], y: [string, OrdSpan]): number => str_cmp(x[0], y[0]) || x[1].cmp(y[1]);
  if (a.$ === "AddSelfOrMakeSized" && b.$ === "AddSelfOrMakeSized") {
    return sym_cmp(a.name, b.name) || pair_cmp(a.add_self_sugg, b.add_self_sugg) || pair_cmp(a.make_sized_sugg, b.make_sized_sugg);
  }
  if (a.$ === "ChangeToRefSelf" && b.$ === "ChangeToRefSelf") {
    return sym_cmp(a._0, b._0) || a._1.cmp(b._1) || sym_cmp(a._2, b._2);
  }
  if (a.$ === "MoveToAnotherTrait" && b.$ === "MoveToAnotherTrait") {
    return sym_cmp(a._0, b._0);
  }
  return 0;
}

/** `FulfillmentError`'s derived `TypeVisitable` (../../traits/mod.gen.ts) as a descriptor, read lazily (init order). */
const d_FulfillmentError: TypeVisitable<FulfillmentError> = {
  visit_with: (v, visitor) => traits_mod_gen().visit_with_FulfillmentError(v, visitor),
};

/** The crate's traits/mod.gen.ts (a static value import would close a load-time cycle). */
function traits_mod_gen(): typeof import("../../traits/mod.gen.ts") {
  return require("../../traits/mod.gen.ts") as typeof import("../../traits/mod.gen.ts");
}

/** `#[derive(Hash)]` of `(String, DefId)`: `write_str` of the path, then `DefId`'s `Hash` (def_id.rs:268: the `u64`
 * `krate << 32 | index`); element size 32, align 8 (rustc_span `DefId` is two `u32`s). */
const String_DefId_key: KeyType<[string, DefId]> = {
  hash: ([p, d], state) => {
    String_key.hash(p, state);
    state.write_u64((BigInt(d.krate) << 32n) | BigInt(d.index));
  },
  size: 32,
  align: 8,
};

/** `size_of::<(String, DefId)>()` = 32; no `UnsafeCell`. */
const LAYOUT_String_DefId: SortLayout = { size_of: 32, freeze: true };

