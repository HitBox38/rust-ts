// Port of compiler/rustc_borrowck/src/diagnostics/opaque_types.rs (lane borrowck-contract: declarations; fill lane bck-diag-f, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `FindOpaqueRegion` / `CheckExplicitRegionMentionAndCollectGenerics` are generated data interfaces (no inherent
// impl), so their `impl TypeVisitor` are impl tables `TypeVisitor_<Type>` whose methods take the visitor state as
// `self` (the fill lane builds the `TypeVisitor<R>` object over them, `Result` = `ControlFlow<..>`).
import { ControlFlow, VisitorResult as VisitorResultC } from "../../rustc_ast_ir/visit.ts";
import type { Diag, ErrorGuaranteed } from "../../rustc_errors/lib.ts";
import type * as hir from "../../rustc_hir/lib.ts";
import type { Location } from "../../rustc_middle/mir/mod.ts";
import type { Clause, Const, Region } from "../../rustc_middle/ty/decls.ts";
import { GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import { GenericParamDefKind, type Generics } from "../../rustc_middle/ty/generics.ts";
import type { Clauses } from "../../rustc_middle/ty/list.ts";
import { Ty } from "../../rustc_middle/ty/mod.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { fold_Clause, fold_Span, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { type DefId, DefId_eq, DefIdSet, LocalDefId } from "../../rustc_span/def_id.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { display_Symbol } from "../../rustc_span/symbol.ts";
import { AddPreciseCapturingForOvercapture_add_to_diag, impl_trait_overcapture_suggestion } from "../../rustc_trait_selection/diagnostics.ts";
import { unexpected_hidden_region_diagnostic } from "../../rustc_trait_selection/error_reporting/infer/region.ts";
import { NonDefiningUseReason } from "../../rustc_trait_selection/opaque_types.ts";
import { type Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { fold_tuple2, fold_Vec, type PredicateProxy, type TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { fold_with_OpaqueTypeKey, type OpaqueTypeKey, try_fold_with_OpaqueTypeKey, visit_with_OpaqueTypeKey } from "../../rustc_type_ir/opaque_ty.gen.ts";
import { fold_Region } from "../../rustc_type_ir/sty/mod.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import type { Variance } from "../../rustc_type_ir/lib.ts";
import { type TypeVisitable, TypeVisitableExt, type TypeVisitor, TypeVisitor_provided } from "../../rustc_type_ir/visit.ts";
import type { BorrowData } from "../borrow_set.gen.ts";
import { MirBorrowckCtxt } from "../lib.gen.ts";
import type { DeferredOpaqueTypeError } from "../region_infer/opaque_types/mod.gen.ts";
import { LifetimeMismatchOpaqueParam_diagnostic } from "../session_diagnostics.gen.ts";
import type { CheckExplicitRegionMentionAndCollectGenerics, FindOpaqueRegion } from "./opaque_types.gen.ts";

export * from "./opaque_types.gen.ts";

/** `(Clause, Span): TypeFoldable` (`Span` is trivially traversable). */
const d_Clause_Span: TypeFoldable<[Clause, Span]> = fold_tuple2(fold_Clause, fold_Span);
/** `OpaqueTypeKey: TypeFoldable` (generated). */
const d_OpaqueTypeKey: TypeFoldable<OpaqueTypeKey> = {
  visit_with: visit_with_OpaqueTypeKey,
  try_fold_with: try_fold_with_OpaqueTypeKey,
  fold_with: fold_with_OpaqueTypeKey,
};

declare module "../lib.gen.ts" {
  interface MirBorrowckCtxt {
    // opaque_types.rs:25
    report_opaque_type_errors(errors: DeferredOpaqueTypeError[]): void;
    // opaque_types.rs:92
    note_due_to_edition_2024_opaque_capture_rules(borrow: BorrowData, diag: Diag): void;
  }
}

// rustc: compiler/rustc_borrowck/src/diagnostics/opaque_types.rs:25 report_opaque_type_errors
MirBorrowckCtxt.prototype.report_opaque_type_errors = function (this: MirBorrowckCtxt, errors: DeferredOpaqueTypeError[]): void {
  if (errors.length === 0) {
    return;
  }

  const infcx = this.infcx;
  let last_unexpected_hidden_region: [Span, Ty, OpaqueTypeKey] | undefined = undefined;
  for (const error of errors) {
    switch (error.$) {
      case "InvalidOpaqueTypeArgs":
        NonDefiningUseReason.report(error._0, infcx.infcx);
        break;
      case "LifetimeMismatchOpaqueParam":
        infcx.dcx().emit_err(LifetimeMismatchOpaqueParam_diagnostic(error._0));
        break;
      case "UnexpectedHiddenRegion": {
        const { opaque_type_key, hidden_type, member_region } = error;
        const named_ty = this.regioncx.name_regions_for_member_constraint(infcx.tcx, hidden_type.ty, fold_Ty);
        const named_key = this.regioncx.name_regions_for_member_constraint(infcx.tcx, opaque_type_key, d_OpaqueTypeKey);
        const named_region = this.regioncx.name_regions_for_member_constraint(infcx.tcx, member_region, fold_Region);
        const diag = unexpected_hidden_region_diagnostic(infcx.infcx, this.mir_def_id(), hidden_type.span, named_ty, named_region, named_key);
        // PORT: `Option<(Span, Ty, OpaqueTypeKey)>`'s derived `PartialEq` (interned `Ty` / `GenericArgs` by identity).
        if (
          !(
            last_unexpected_hidden_region !== undefined &&
            last_unexpected_hidden_region[0] === hidden_type.span &&
            last_unexpected_hidden_region[1] === named_ty &&
            last_unexpected_hidden_region[2].def_id === named_key.def_id &&
            last_unexpected_hidden_region[2].args === named_key.args
          )
        ) {
          last_unexpected_hidden_region = [hidden_type.span, named_ty, named_key];
          diag.emit_err();
        } else {
          diag.delay_as_bug();
        }
        break;
      }
      case "NonDefiningUseInDefiningScope": {
        const { span, opaque_type_key } = error;
        infcx
          .dcx()
          .span_err(
            span,
            `non-defining use of \`${display_Ty(Ty.new_opaque(infcx.tcx, "No", LocalDefId.to_def_id(opaque_type_key.def_id), opaque_type_key.args))}\` in the defining scope`,
          );
        break;
      }
    }
  }
};

/// Try to note when an opaque is involved in a borrowck error and that
/// opaque captures lifetimes due to edition 2024.
// rustc: compiler/rustc_borrowck/src/diagnostics/opaque_types.rs:92 note_due_to_edition_2024_opaque_capture_rules
MirBorrowckCtxt.prototype.note_due_to_edition_2024_opaque_capture_rules = function (this: MirBorrowckCtxt, borrow: BorrowData, diag: Diag): void {
  // We look at all the locals. Why locals? Because it's the best thing
  // I could think of that's correlated with the *instantiated* higher-ranked
  // binder for calls, since we don't really store those anywhere else.
  for (const ty of this.body.local_decls.map((local) => local.ty)) {
    if (!TypeVisitableExt.has_opaque_types(ty, fold_Ty)) {
      continue;
    }

    const tcx = this.infcx.tcx;
    const r = fold_Ty.visit_with(
      ty,
      TypeVisitor_of_FindOpaqueRegion({
        regioncx: this.regioncx,
        tcx,
        borrow_region: borrow.region,
      }),
    );
    if (r.$ !== "Break") {
      continue;
    }
    const [opaque_def_id, offending_region_idx, location] = r._0;

    // If an opaque explicitly captures a lifetime, then no need to point it out.
    // FIXME: We should be using a better heuristic for `use<>`.
    if (tcx.rendered_precise_capturing_args(opaque_def_id) !== undefined) {
      continue;
    }

    // If one of the opaque's bounds mentions the region, then no need to
    // point it out, since it would've been captured on edition 2021 as well.
    //
    // Also, while we're at it, collect all the lifetimes that the opaque
    // *does* mention. We'll use that for the `+ use<'a>` suggestion below.
    const visitor: CheckExplicitRegionMentionAndCollectGenerics = {
      tcx,
      generics: tcx.generics_of(opaque_def_id) as Generics,
      offending_region_idx,
      seen_opaques: new DefIdSet([opaque_def_id]),
      seen_lifetimes: new DefIdSet(),
    };
    // PORT: the query's value is typed `unknown` in queries.gen.ts; it is `EarlyBinder<&[(Clause, Span)]>`.
    const bounds = EarlyBinder.skip_binder(tcx.explicit_item_bounds(opaque_def_id) as EarlyBinder<readonly [Clause, Span][]>);
    if (fold_Vec(d_Clause_Span).visit_with(bounds, TypeVisitor_of_CheckExplicitRegionMentionAndCollectGenerics(visitor)).$ === "Break") {
      continue;
    }

    // If we successfully located a terminator, then point it out
    // and provide a suggestion if it's local.
    const st = this.body.stmt_at(location);
    switch (st.$) {
      case "Right": {
        const { source_info } = st._0;
        diag.span_note(
          source_info.span,
          "this call may capture more lifetimes than intended, because Rust 2024 has adjusted the `impl Trait` lifetime capture rules",
        );
        const captured_args = visitor.seen_lifetimes as DefIdSet;
        // Add in all of the type and const params, too.
        // Ordering here is kinda strange b/c we're walking backwards,
        // but we're trying to provide *a* suggestion, not a nice one.
        let next_generics: Generics | undefined = visitor.generics;
        let any_synthetic = false;
        while (next_generics !== undefined) {
          const generics: Generics = next_generics;
          for (const param of generics.own_params) {
            if (GenericParamDefKind.is_ty_or_const(param.kind)) {
              captured_args.add(param.def_id);
            }
            if (GenericParamDefKind.is_synthetic(param.kind)) {
              any_synthetic = true;
            }
          }
          next_generics = generics.parent !== undefined ? (tcx.generics_of(generics.parent) as Generics) : undefined;
        }

        const opaque_local = opaque_def_id.as_local();
        let origin: hir.OpaqueTyOrigin<LocalDefId> | undefined;
        if (opaque_local !== undefined && (origin = tcx.hir_expect_opaque_ty(opaque_local).origin).$ === "FnReturn") {
          const parent = origin.parent;
          const sugg = impl_trait_overcapture_suggestion(tcx, opaque_local, parent, captured_args);
          if (sugg !== undefined) {
            AddPreciseCapturingForOvercapture_add_to_diag(sugg, diag);
          }
        } else {
          diag.span_help(
            tcx.def_span(opaque_def_id),
            `if you can modify this crate, add a precise capturing bound to avoid overcapturing: \`+ use<${
              any_synthetic ? "/* Args */" : [...captured_args].map((def_id) => display_Symbol(tcx.item_name(def_id))).join(", ")
            }>\``,
          );
        }
        return;
      }
      case "Left":
        break;
    }
  }
};

// impl<'tcx> TypeVisitor<TyCtxt<'tcx>> for FindOpaqueRegion<'_, 'tcx> { type Result = ControlFlow<(DefId, usize, Location), ()>; }
export const TypeVisitor_FindOpaqueRegion = {
  // rustc: compiler/rustc_borrowck/src/diagnostics/opaque_types.rs:217 visit_ty
  visit_ty(self: FindOpaqueRegion, ty: Ty): ControlFlow<[DefId, number, Location], null> {
    // If we find an opaque in a local ty, then for each of its captured regions,
    // try to find a path between that captured regions and our borrow region...
    const k = ty.kind();
    let origin: hir.OpaqueTyOrigin<DefId> | undefined;
    if (
      k.$ === "Alias" &&
      k._1.kind.$ === "Opaque" &&
      (origin = self.tcx.opaque_ty_origin(k._1.kind.def_id) as hir.OpaqueTyOrigin<DefId>).$ === "FnReturn" &&
      origin.in_trait_or_impl === undefined
    ) {
      const def_id = k._1.kind.def_id;
      const args = k._1.args;
      const parent = origin.parent;
      const variances = self.tcx.variances_of(def_id) as readonly Variance[];
      const n = Math.min(args.length, variances.length);
      for (let idx = 0; idx < n; idx++) {
        const arg = args[idx]!;
        const variance = variances[idx]!;
        // Skip uncaptured args.
        if (variance === "Bivariant") {
          continue;
        }
        // We only care about regions.
        const opaque_region = GenericArg.as_region(arg);
        if (opaque_region === undefined) {
          continue;
        }
        // Don't try to convert a late-bound region, which shouldn't exist anyways (yet).
        if (opaque_region.is_bound()) {
          continue;
        }
        const opaque_region_vid = self.regioncx.to_region_vid(opaque_region);

        // Find a path between the borrow region and our opaque capture.
        const path = self.regioncx.constraint_path_between_regions(self.borrow_region, opaque_region_vid);
        if (path !== undefined) {
          for (const constraint of path) {
            // If we find a call in this path, then check if it defines the opaque.
            const c = constraint.category;
            let ck: ReturnType<Ty["kind"]>;
            if (
              c.$ === "CallArgument" &&
              c._0 !== undefined &&
              (ck = c._0.kind()).$ === "FnDef" &&
              // This function defines the opaque :D
              DefId_eq(ck._0, parent) &&
              constraint.locations.$ === "Single"
            ) {
              const location = constraint.locations._0;
              return ControlFlow.Break<[DefId, number, Location]>([def_id, idx, location]);
            }
          }
        }
      }
    }

    return fold_Ty.super_visit_with(ty, TypeVisitor_of_FindOpaqueRegion(self));
  },
};

// impl<'tcx> TypeVisitor<TyCtxt<'tcx>> for CheckExplicitRegionMentionAndCollectGenerics<'tcx> { type Result = ControlFlow<(), ()>; }
export const TypeVisitor_CheckExplicitRegionMentionAndCollectGenerics = {
  // rustc: compiler/rustc_borrowck/src/diagnostics/opaque_types.rs:275 visit_ty
  visit_ty(self: CheckExplicitRegionMentionAndCollectGenerics, ty: Ty): ControlFlow<null, null> {
    const k = ty.kind();
    if (k.$ === "Alias" && k._1.kind.$ === "Opaque") {
      const def_id = k._1.kind.def_id;
      const args = k._1.args;
      if (!self.seen_opaques.has(def_id)) {
        self.seen_opaques.add(def_id);
        // PORT: the query's value is typed `unknown` in queries.gen.ts; it is `EarlyBinder<&[(Clause, Span)]>`.
        const item_bounds = self.tcx.explicit_item_bounds(def_id) as EarlyBinder<readonly [Clause, Span][]>;
        for (const u of EarlyBinder.iter_instantiated_copied(item_bounds, self.tcx, args, d_Clause_Span)) {
          const [bound] = Unnormalized.skip_norm_wip(u);
          const r = fold_Clause.visit_with(bound, TypeVisitor_of_CheckExplicitRegionMentionAndCollectGenerics(self));
          if (r.$ === "Break") return r;
        }
      }
      return ControlFlow.CONTINUE;
    } else {
      return fold_Ty.super_visit_with(ty, TypeVisitor_of_CheckExplicitRegionMentionAndCollectGenerics(self));
    }
  },

  // rustc: compiler/rustc_borrowck/src/diagnostics/opaque_types.rs:294 visit_region
  visit_region(self: CheckExplicitRegionMentionAndCollectGenerics, r: Region): ControlFlow<null, null> {
    const k = r.kind();
    if (k.$ === "ReEarlyParam") {
      const param = k._0;
      if (param.index === self.offending_region_idx) {
        return ControlFlow.Break(null);
      } else {
        self.seen_lifetimes.add(self.generics.region_param(param, self.tcx).def_id);
        return ControlFlow.CONTINUE;
      }
    } else {
      return ControlFlow.CONTINUE;
    }
  },
};

/** PORT: `&mut FindOpaqueRegion { .. }` as a `TypeVisitor` (the impl table plus the provided methods; not an upstream fn). */
function TypeVisitor_of_FindOpaqueRegion(self: FindOpaqueRegion): TypeVisitor<ControlFlow<[DefId, number, Location], null>> {
  type R = ControlFlow<[DefId, number, Location], null>;
  const v: TypeVisitor<R> = {
    Result: VisitorResultC.ControlFlow<[DefId, number, Location]>(),
    visit_binder: <T>(t: Binder<T>, d: TypeVisitable<T>): R => TypeVisitor_provided.visit_binder(v, t, d),
    visit_ty: (t: Ty): R => TypeVisitor_FindOpaqueRegion.visit_ty(self, t),
    visit_region: (r: Region): R => TypeVisitor_provided.visit_region(v, r),
    visit_const: (c: Const): R => TypeVisitor_provided.visit_const(v, c),
    visit_predicate: <P>(p: P, d: PredicateProxy<P>): R => TypeVisitor_provided.visit_predicate(v, p, d),
    visit_clauses: (c: Clauses): R => TypeVisitor_provided.visit_clauses(v, c),
    visit_error: (guar: ErrorGuaranteed): R => TypeVisitor_provided.visit_error(v, guar),
  };
  return v;
}

/** PORT: `&mut CheckExplicitRegionMentionAndCollectGenerics { .. }` as a `TypeVisitor` (not an upstream fn). */
function TypeVisitor_of_CheckExplicitRegionMentionAndCollectGenerics(self: CheckExplicitRegionMentionAndCollectGenerics): TypeVisitor<ControlFlow<null, null>> {
  type R = ControlFlow<null, null>;
  const v: TypeVisitor<R> = {
    Result: VisitorResultC.ControlFlow<null>(),
    visit_binder: <T>(t: Binder<T>, d: TypeVisitable<T>): R => TypeVisitor_provided.visit_binder(v, t, d),
    visit_ty: (t: Ty): R => TypeVisitor_CheckExplicitRegionMentionAndCollectGenerics.visit_ty(self, t),
    visit_region: (r: Region): R => TypeVisitor_CheckExplicitRegionMentionAndCollectGenerics.visit_region(self, r),
    visit_const: (c: Const): R => TypeVisitor_provided.visit_const(v, c),
    visit_predicate: <P>(p: P, d: PredicateProxy<P>): R => TypeVisitor_provided.visit_predicate(v, p, d),
    visit_clauses: (c: Clauses): R => TypeVisitor_provided.visit_clauses(v, c),
    visit_error: (guar: ErrorGuaranteed): R => TypeVisitor_provided.visit_error(v, guar),
  };
  return v;
}
