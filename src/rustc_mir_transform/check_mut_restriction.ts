// Port of compiler/rustc_mir_transform/src/check_mut_restriction.rs (lane mt-built-lints).
//
// PORT: `MutRestrictionChecker` is a class extending rustc_middle mir/visit.ts's `Visitor` (D4).
import {
  type Body,
  Const,
  type ConstOperand,
  type Location,
  type Place,
  type Rvalue,
  type Statement,
  type Terminator,
} from "../rustc_middle/mir/mod.ts";
import { PlaceContext, Visitor } from "../rustc_middle/mir/visit.ts";
import type { AdtDef } from "../rustc_middle/ty/adt.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { type FieldDef, RestrictionKind } from "../rustc_middle/ty/mod.ts";
import { InstanceKind } from "../rustc_middle/ty/instance.ts";
import type { Span } from "../rustc_span/lib.ts";
import { assert } from "../std/panic.ts";
import * as diagnostics from "./diagnostics.ts";
import { MirLint } from "./pass_manager.ts";

// rustc-type: compiler/rustc_mir_transform/src/check_mut_restriction.rs:9 CheckMutRestriction
export class CheckMutRestriction extends MirLint {
  readonly type_name = "rustc_mir_transform::check_mut_restriction::CheckMutRestriction";

  // impl<'tcx> crate::MirLint<'tcx> for CheckMutRestriction
  // rustc: compiler/rustc_mir_transform/src/check_mut_restriction.rs:12 run_lint
  run_lint(tcx: TyCtxt, body: Body): void {
    if (body.tainted_by_errors !== undefined) {
      return;
    }
    const checker = new MutRestrictionChecker(body, tcx, body.span);
    checker.visit_body(body);
  }
}

// rustc-type: compiler/rustc_mir_transform/src/check_mut_restriction.rs:21 MutRestrictionChecker
class MutRestrictionChecker extends Visitor {
  constructor(
    public body: Body,
    public tcx: TyCtxt,
    public mutating_span: Span,
  ) {
    super();
  }

  // impl<'tcx> Visitor<'tcx> for MutRestrictionChecker<'_, 'tcx>
  // rustc: compiler/rustc_mir_transform/src/check_mut_restriction.rs:28 visit_terminator
  override visit_terminator(terminator: Terminator, location: Location): void {
    this.mutating_span = terminator.source_info.span;
    this.super_terminator(terminator, location);
  }

  // rustc: compiler/rustc_mir_transform/src/check_mut_restriction.rs:33 visit_statement
  override visit_statement(statement: Statement, location: Location): void {
    this.mutating_span = statement.source_info.span;
    this.super_statement(statement, location);
  }

  // Tuple constructors used as values can bypass field mut restrictions if not checked here.
  // rustc: compiler/rustc_mir_transform/src/check_mut_restriction.rs:39 visit_const_operand
  override visit_const_operand(constant: ConstOperand, location: Location): void {
    const kind = Const.ty(constant.const_).kind();
    if (kind.$ === "FnDef") {
      const def_id = kind._0;
      const def_kind = this.tcx.def_kind(def_id);
      if (def_kind.$ === "Ctor") {
        const ctor_of = def_kind._0;
        const body_did = InstanceKind.def_id(this.body.source.instance);
        let adt_did;
        switch (ctor_of) {
          case "Struct":
            adt_did = this.tcx.parent(def_id);
            break;
          case "Variant":
            adt_did = this.tcx.parent(this.tcx.parent(def_id));
            break;
        }
        // PORT: the `adt_def` query value is `unknown` in queries.gen.ts.
        const adt = this.tcx.adt_def(adt_did) as AdtDef;
        let variant;
        switch (ctor_of) {
          case "Struct":
            variant = adt.non_enum_variant();
            break;
          case "Variant":
            variant = adt.variant_with_ctor_id(def_id);
            break;
        }

        const mut_restriction = variant.fields.reduce(
          (acc, field) => RestrictionKind.stricter_of(acc, field.mut_restriction, this.tcx),
          RestrictionKind.Unrestricted as RestrictionKind,
        );
        if (!RestrictionKind.is_allowed_in(mut_restriction, body_did, this.tcx)) {
          this.tcx.dcx().emit_err(
            diagnostics.ConstructionOfTyWithMutRestrictedField_diagnostic({
              construction_span: constant.span,
              restriction_span: RestrictionKind.expect_span(mut_restriction),
              name: variant.name,
              descr: adt.variant_descr(),
              restriction_path: RestrictionKind.restriction_path(mut_restriction, this.tcx),
            }),
          );
        }
      }
    }

    this.super_const_operand(constant, location);
  }

  // rustc: compiler/rustc_mir_transform/src/check_mut_restriction.rs:72 visit_place
  override visit_place(place: Place, context: PlaceContext, location: Location): void {
    if (PlaceContext.is_mutating_use(context)) {
      const body_did = InstanceKind.def_id(this.body.source.instance);

      for (const [place_base, elem] of place.iter_projections()) {
        // Even when the field is an array or slice and is accessed by index,
        // as in `foo.array[0]`, the projection chain still contains a field
        // projection. Therefore, it is sufficient to check for field projections.
        if (elem.$ !== "Field") {
          continue;
        }
        const field_idx = elem._0;

        const base_ty = place_base.ty(this.body, this.tcx);

        // Field projections are also used for tuples, closures, and coroutines,
        // but mutability restrictions only apply to ADT fields.
        // Mutating an ADT field through a captured value still produces a
        // separate field projection whose base type is that ADT.
        // Therefore, it is sufficient to check for ADT base types.
        // Generic arguments do not affect the field's restriction, so we ignore them.
        const base_kind = base_ty.ty.kind();
        if (base_kind.$ !== "Adt") {
          continue;
        }
        const adt_def = base_kind._0;

        let variant_def;
        if (base_ty.variant_index !== undefined) {
          const idx = base_ty.variant_index;
          assert(adt_def.is_enum(), "assertion failed: adt_def.is_enum()");
          variant_def = adt_def.variant(idx);
        } else {
          variant_def = adt_def.non_enum_variant();
        }

        const field_def: FieldDef = variant_def.fields[field_idx]!;
        const mut_restriction = field_def.mut_restriction;

        if (!RestrictionKind.is_allowed_in(mut_restriction, body_did, this.tcx)) {
          this.tcx.dcx().emit_err(
            diagnostics.MutOfRestrictedField_diagnostic({
              mut_span: this.mutating_span,
              restriction_span: RestrictionKind.expect_span(mut_restriction),
              name: field_def.name,
              restriction_path: RestrictionKind.restriction_path(mut_restriction, this.tcx),
            }),
          );
        }
      }
    }

    this.super_place(place, context, location);
  }

  // rustc: compiler/rustc_mir_transform/src/check_mut_restriction.rs:120 visit_rvalue
  override visit_rvalue(rvalue: Rvalue, location: Location): void {
    if (rvalue.$ === "Aggregate" && rvalue._0.$ === "Adt") {
      const aggr = rvalue._0;
      const [adt_did, variant_idx, active_field] = [aggr._0, aggr._1, aggr._4];
      const body_did = InstanceKind.def_id(this.body.source.instance);
      // PORT: the `adt_def` query value is `unknown` in queries.gen.ts.
      const adt = this.tcx.adt_def(adt_did) as AdtDef;
      const variant = adt.variants()[variant_idx]!;

      if (active_field !== undefined) {
        const field_idx = active_field;
        // union
        const field_def = variant.fields[field_idx]!;
        const mut_restriction = field_def.mut_restriction;
        if (!RestrictionKind.is_allowed_in(mut_restriction, body_did, this.tcx)) {
          this.tcx.dcx().emit_err(
            diagnostics.ConstructionOfTyWithMutRestrictedField_diagnostic({
              construction_span: this.mutating_span,
              restriction_span: RestrictionKind.expect_span(mut_restriction),
              name: variant.name,
              descr: adt.variant_descr(),
              restriction_path: RestrictionKind.restriction_path(mut_restriction, this.tcx),
            }),
          );
        }
      } else {
        // struct / enum variant
        const mut_restriction = variant.fields.reduce(
          (acc, field) => RestrictionKind.stricter_of(acc, field.mut_restriction, this.tcx),
          RestrictionKind.Unrestricted as RestrictionKind,
        );
        if (!RestrictionKind.is_allowed_in(mut_restriction, body_did, this.tcx)) {
          this.tcx.dcx().emit_err(
            diagnostics.ConstructionOfTyWithMutRestrictedField_diagnostic({
              construction_span: this.mutating_span,
              restriction_span: RestrictionKind.expect_span(mut_restriction),
              name: variant.name,
              descr: adt.variant_descr(),
              restriction_path: RestrictionKind.restriction_path(mut_restriction, this.tcx),
            }),
          );
        }
      }
    }

    this.super_rvalue(rvalue, location);
  }
}
