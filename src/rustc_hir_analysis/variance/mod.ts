//! Module for inferring the variance of type and lifetime parameters. See the [rustc dev guide]
//! chapter for more info.
//!
//! [rustc dev guide]: https://rustc-dev-guide.rust-lang.org/variance.html
//
// Port of compiler/rustc_hir_analysis/src/variance/mod.rs (lane variance-outlives).
//
// PORT notes (file-wide):
// - `DroplessArena` is erased (terms.ts header); `tcx.arena.alloc_from_iter(..)` is the array itself.
// - `OpaqueTypeLifetimeCollector` (a struct with impls local to `variance_of_opaque`) is a module-level class right
//   after `variance_of_opaque`, its markers on its methods. It implements `TypeVisitor<undefined>` (`Self::Result = ()`)
//   and forwards the methods it does not override to `TypeVisitor_provided` (tyir-binder convention).
// - `args.iter().zip_eq(child_variances)` panics on a length mismatch with itertools' message.
// - `ForceCaptureTraitArgs` (derives Debug, Copy, Clone; the Debug is only read by `#[instrument]`) is a string union.
// - `#[instrument]` and `debug!` are tracing only and stay as comments.
// Init order: top-level code here touches only other crates.
import { type VisitorResult, VisitorResult as VisitorResultC } from "../../rustc_ast_ir/visit.ts";
import { DefKind } from "../../rustc_hir/def.ts";
import { Node } from "../../rustc_hir/hir.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { type GenericArgs, visit_with_GenericArg, visit_with_GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import type { Generics } from "../../rustc_middle/ty/generics.ts";
import type { Clauses } from "../../rustc_middle/ty/list.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { type CrateVariancesMap, type Ty, visit_with_Term } from "../../rustc_middle/ty/mod.ts";
import type { Clause } from "../../rustc_middle/ty/predicate.ts";
import { fold_Clause, fold_Span, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { type DefId, DefId_eq, LocalDefId } from "../../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { span_bug } from "../../rustc_span/macros.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { fold_tuple2, type PredicateProxy } from "../../rustc_type_ir/fold.ts";
import { Variance } from "../../rustc_type_ir/lib.ts";
import { type Region, visit_with_Region } from "../../rustc_type_ir/sty/mod.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { type TypeVisitable, type TypeVisitor, TypeVisitor_provided } from "../../rustc_type_ir/visit.ts";
import { visit_with_Clause } from "../../rustc_middle/ty/predicate.ts";
import { panic } from "../../std/panic.ts";
import { add_constraints_from_crate } from "./constraints.ts";
import { solve_constraints } from "./solve.ts";
import { determine_parameters_to_be_inferred } from "./terms.ts";

/// Defines the `TermsContext` basically houses an arena where we can
/// allocate terms.
// mod terms;
export * as terms from "./terms.ts";

/// Code to gather up constraints.
// mod constraints;
export * as constraints from "./constraints.ts";

/// Code to solve constraints and write out the results.
// mod solve;
export * as solve from "./solve.ts";

// pub(crate) mod dump;
export * as dump from "./dump.ts";

// rustc: compiler/rustc_hir_analysis/src/variance/mod.rs:30 crate_variances
export function crate_variances(tcx: TyCtxt, _: null): CrateVariancesMap {
  const terms_cx = determine_parameters_to_be_inferred(tcx);
  const constraints_cx = add_constraints_from_crate(terms_cx);
  return solve_constraints(constraints_cx);
}

// rustc: compiler/rustc_hir_analysis/src/variance/mod.rs:37 variances_of
export function variances_of(tcx: TyCtxt, item_def_id: LocalDefId): readonly Variance[] {
  // Skip items with no generics - there's nothing to infer in them.
  if ((tcx.generics_of(item_def_id) as Generics).is_empty()) {
    return [];
  }

  const kind = tcx.def_kind(item_def_id);
  switch (kind.$) {
    case "Fn":
    case "AssocFn":
    case "Enum":
    case "Struct":
    case "Union":
    case "Ctor": {
      // These are inferred.
      const crate_map = tcx.crate_variances(null) as CrateVariancesMap;
      return crate_map.variances.get(LocalDefId.to_def_id(item_def_id)) ?? [];
    }
    case "AssocTy": {
      const info = tcx.opt_rpitit_info(LocalDefId.to_def_id(item_def_id));
      if (info !== undefined && info.$ === "Trait") {
        const opaque_def_id = info.opaque_def_id;
        return variance_of_opaque(tcx, opaque_def_id.expect_local(), "Yes");
      }
      // None | Some(ty::ImplTraitInTraitData::Impl { .. }) => {}
      break;
    }
    case "OpaqueTy": {
      const origin = Node.expect_opaque_ty(tcx.hir_node_by_def_id(item_def_id)).origin;
      const force_capture_trait_args: ForceCaptureTraitArgs = origin.$ === "FnReturn" && origin.in_trait_or_impl === "Trait" ? "Yes" : "No";

      return variance_of_opaque(tcx, item_def_id, force_capture_trait_args);
    }
    default:
      break;
  }

  // Variance not relevant.
  return span_bug(tcx.def_span(item_def_id), `asked to compute variance for ${DefKind.descr(kind, LocalDefId.to_def_id(item_def_id))}`);
}

// #[derive(Debug, Copy, Clone)]
// rustc-type: compiler/rustc_hir_analysis/src/variance/mod.rs:91 ForceCaptureTraitArgs
type ForceCaptureTraitArgs = "Yes" | "No";

// #[instrument(level = "trace", skip(tcx), ret)]
// rustc: compiler/rustc_hir_analysis/src/variance/mod.rs:97 variance_of_opaque
function variance_of_opaque(tcx: TyCtxt, item_def_id: LocalDefId, force_capture_trait_args: ForceCaptureTraitArgs): readonly Variance[] {
  const generics = tcx.generics_of(item_def_id) as Generics;

  // Opaque types may only use regions that are bound. So for
  // ```rust
  // type Foo<'a, 'b, 'c> = impl Trait<'a> + 'b;
  // ```
  // we may not use `'c` in the hidden type.
  // (struct OpaqueTypeLifetimeCollector: below)

  // By default, RPIT are invariant wrt type and const generics, but they are bivariant wrt
  // lifetime generics.
  const variances: Variance[] = new Array<Variance>(generics.count()).fill(Variance.Invariant);

  // Mark all lifetimes from parent generics as unused (Bivariant).
  // This will be overridden later if required.
  {
    let generics_ = generics;
    let def_id: DefId | undefined;
    while ((def_id = generics_.parent) !== undefined) {
      generics_ = tcx.generics_of(def_id) as Generics;

      // Don't mark trait params generic if we're in an RPITIT.
      if (force_capture_trait_args === "Yes" && generics_.parent === undefined) {
        // debug_assert_eq!(tcx.def_kind(def_id), DefKind::Trait);
        break;
      }

      for (const param of generics_.own_params) {
        switch (param.kind.$) {
          case "Lifetime":
            variances[param.index] = Variance.Bivariant;
            break;
          case "Type":
          case "Const":
            break;
        }
      }
    }
  }

  const collector = new OpaqueTypeLifetimeCollector(tcx, LocalDefId.to_def_id(item_def_id), variances);
  const id_args = RawList.identity_for_item(tcx, LocalDefId.to_def_id(item_def_id));
  const bounds = tcx.explicit_item_bounds(item_def_id) as EarlyBinder<readonly (readonly [Clause, Span])[]>;
  for (const instantiated of EarlyBinder.iter_instantiated_copied(bounds as EarlyBinder<readonly [Clause, Span][]>, tcx, id_args, fold_tuple2(fold_Clause, fold_Span))) {
    const [clause, _] = Unnormalized.skip_norm_wip(instantiated);
    // debug!(?clause);

    // We only ignore opaque type args if the opaque type is the outermost type.
    // The opaque type may be nested within itself via recursion in e.g.
    // type Foo<'a> = impl PartialEq<Foo<'a>>;
    // which thus mentions `'a` and should thus accept hidden types that borrow 'a
    // instead of requiring an additional `+ 'a`.
    const k = Binder.skip_binder(clause.kind());
    switch (k.$) {
      case "Trait":
      case "HostEffect": {
        const args = k._0.trait_ref.args;
        for (const arg of args.slice(1)) {
          visit_with_GenericArg(arg, collector);
        }
        break;
      }
      case "Projection": {
        const args = k._0.projection_term.args;
        const term = k._0.term;
        for (const arg of args.slice(1)) {
          visit_with_GenericArg(arg, collector);
        }
        visit_with_Term(term, collector);
        break;
      }
      case "TypeOutlives": {
        const region = k._0._1;
        visit_with_Region(region, collector);
        break;
      }
      default:
        visit_with_Clause(clause, collector);
        break;
    }
  }
  return collector.variances;
}

// (local to `variance_of_opaque`)
// rustc-type: compiler/rustc_hir_analysis/src/variance/mod.rs:109 OpaqueTypeLifetimeCollector
class OpaqueTypeLifetimeCollector implements TypeVisitor<undefined> {
  readonly Result: VisitorResult<undefined, unknown> = VisitorResultC.unit;

  constructor(
    public tcx: TyCtxt,
    public root_def_id: DefId,
    public variances: Variance[],
  ) {}

  // #[instrument(level = "trace", skip(self), ret)]
  // rustc: compiler/rustc_hir_analysis/src/variance/mod.rs:117 visit_opaque
  visit_opaque(def_id: DefId, args: GenericArgs): void {
    if (!DefId_eq(def_id, this.root_def_id) && this.tcx.is_descendant_of(def_id, this.root_def_id)) {
      const child_variances = this.tcx.variances_of(def_id) as readonly Variance[];
      // args.iter().zip_eq(child_variances)
      if (args.length !== child_variances.length) {
        panic("itertools: .zip_eq() reached end of one iterator before the other");
      }
      for (let i = 0; i < args.length; i++) {
        const [a, v] = [args[i]!, child_variances[i]!];
        if (v !== "Bivariant") {
          visit_with_GenericArg(a, this);
        }
      }
    } else {
      visit_with_GenericArgs(args, this);
    }
  }

  /** (provided) `TypeVisitor::visit_binder` */
  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): undefined {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }

  // #[instrument(level = "trace", skip(self), ret)]
  // rustc: compiler/rustc_hir_analysis/src/variance/mod.rs:133 visit_region
  visit_region(r: Region): undefined {
    const k = r.kind();
    if (k.$ === "ReEarlyParam") {
      const ebr = k._0;
      this.variances[ebr.index] = Variance.Invariant;
    }
    return undefined;
  }

  // #[instrument(level = "trace", skip(self), ret)]
  // rustc: compiler/rustc_hir_analysis/src/variance/mod.rs:140 visit_ty
  visit_ty(t: Ty): undefined {
    const k = t.kind();
    if (k.$ === "Alias" && k._1.kind.$ === "Opaque") {
      const def_id = k._1.kind.def_id;
      const args = k._1.args;
      this.visit_opaque(def_id, args);
      return undefined;
    }
    return fold_Ty.super_visit_with(t, this);
  }

  /** (provided) `TypeVisitor::visit_const` */
  visit_const(c: Parameters<TypeVisitor<undefined>["visit_const"]>[0]): undefined {
    return TypeVisitor_provided.visit_const(this, c);
  }

  /** (provided) `TypeVisitor::visit_predicate` */
  visit_predicate<P>(p: P, d: PredicateProxy<P>): undefined {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }

  /** (provided) `TypeVisitor::visit_clauses` */
  visit_clauses(c: Clauses): undefined {
    return TypeVisitor_provided.visit_clauses(this, c);
  }

  /** (provided) `TypeVisitor::visit_error` */
  visit_error(guar: ErrorGuaranteed): undefined {
    return TypeVisitor_provided.visit_error(this, guar);
  }
}
