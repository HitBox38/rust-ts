// Port of compiler/rustc_mir_build/src/builder/expr/as_place.rs: DECLARED (lane builder-contract, plan-m4 wave 22). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// mb-expr-a; docs/handoff/builder-contract.md has the split table, the conventions and "How to fill a stub"
// (builder/mod.ts's header has the representation notes).
import { type Mutability } from "../../../rustc_ast_ir/lib.ts";
import { type Projection as HirProjection, type ProjectionKind as HirProjectionKind } from "../../../rustc_middle/hir/place.ts";
import { type BasicBlock, type Local, type Operand, type Place, type PlaceElem, type SourceInfo } from "../../../rustc_middle/mir/mod.ts";
import { type ExprId, type LocalVarId } from "../../../rustc_middle/thir.ts";
import { type AdtDef, type FieldIdx, type VariantIdx } from "../../../rustc_middle/ty/decls.ts";
import { type Ty } from "../../../rustc_middle/ty/mod.ts";
import { PlaceBuilder, type PlaceBase } from "./as_place.gen.ts";
import { Builder, type BlockAnd, type Capture, type CaptureMap } from "../mod.ts";
import { type LocalDefId } from "../../../rustc_span/def_id.ts";
import { type Span } from "../../../rustc_span/lib.ts";
import { unported } from "../../../std/panic.ts";
export * from "./as_place.gen.ts";

declare module "./as_place.gen.ts" {
  interface PlaceBuilder {
    // as_place.rs:256 (lane mb-expr-a)
    to_place(cx: Builder): Place;
    // as_place.rs:272 (lane mb-expr-a)
    try_to_place(cx: Builder): Place | undefined;
    // as_place.rs:290 (lane mb-expr-a)
    resolve_upvar(cx: Builder): PlaceBuilder | undefined;
    // as_place.rs:300 (lane mb-expr-a)
    base_(): PlaceBase; // PORT: the field `base` holds the name
    // as_place.rs:304 (lane mb-expr-a)
    projection_(): readonly PlaceElem[]; // PORT: the field `projection` holds the name
    // as_place.rs:308 (lane mb-expr-a)
    field(f: FieldIdx, ty: Ty): PlaceBuilder;
    // as_place.rs:312 (lane mb-expr-a)
    deref(): PlaceBuilder;
    // as_place.rs:316 (lane mb-expr-a)
    downcast(adt_def: AdtDef, variant_index: VariantIdx): PlaceBuilder;
    // as_place.rs:320 (lane mb-expr-a)
    index(index: Local): PlaceBuilder;
    // as_place.rs:324 (lane mb-expr-a)
    project(elem: PlaceElem): PlaceBuilder;
    // as_place.rs:330 (lane mb-expr-a)
    clone_project(elem: PlaceElem): PlaceBuilder;
  }
}

declare module "../mod.ts" {
  interface Builder {
    // as_place.rs:369 (lane mb-expr-a)
    as_place(block: BasicBlock, expr_id: ExprId): BlockAnd<Place>;
    // as_place.rs:380 (lane mb-expr-a)
    as_place_builder(block: BasicBlock, expr_id: ExprId): BlockAnd<PlaceBuilder>;
    // as_place.rs:393 (lane mb-expr-a)
    as_read_only_place(block: BasicBlock, expr_id: ExprId): BlockAnd<Place>;
    // as_place.rs:408 (lane mb-expr-a)
    as_read_only_place_builder(block: BasicBlock, expr_id: ExprId): BlockAnd<PlaceBuilder>;
    // as_place.rs:416 (lane mb-expr-a)
    expr_as_place(block: BasicBlock, expr_id: ExprId, mutability: Mutability, fake_borrow_temps: Local[] | undefined): BlockAnd<PlaceBuilder>;
    // as_place.rs:604 (lane mb-expr-a)
    lower_captured_upvar(block: BasicBlock, closure_def_id: LocalDefId, var_hir_id: LocalVarId): BlockAnd<PlaceBuilder>;
    // as_place.rs:621 (lane mb-expr-a)
    lower_index_expression(block: BasicBlock, base: ExprId, index: ExprId, mutability: Mutability, fake_borrow_temps: Local[] | undefined, expr_span: Span, source_info: SourceInfo): BlockAnd<PlaceBuilder>;
    // as_place.rs:669 (lane mb-expr-a)
    len_of_slice_or_array(block: BasicBlock, place: Place, span: Span, source_info: SourceInfo): Operand;
    // as_place.rs:727 (lane mb-expr-a)
    bounds_check(block: BasicBlock, slice: PlaceBuilder, index: Local, expr_span: Span, source_info: SourceInfo): BasicBlock;
    // as_place.rs:758 (lane mb-expr-a)
    add_fake_borrows_of_base(base_place: Place, block: BasicBlock, fake_borrow_temps: Local[], expr_span: Span, source_info: SourceInfo): void;
    // as_place.rs:817 (lane mb-expr-a)
    read_fake_borrows(bb: BasicBlock, fake_borrow_temps: Local[], source_info: SourceInfo): void;
  }
}

// stub: compiler/rustc_mir_build/src/builder/expr/as_place.rs:81 convert_to_hir_projections_and_truncate_for_capture (lane mb-expr-a)
export function convert_to_hir_projections_and_truncate_for_capture(mir_projections: readonly PlaceElem[]): HirProjectionKind[] {
  return unported("rustc_mir_build::builder::expr::as_place::convert_to_hir_projections_and_truncate_for_capture");
}

// stub: compiler/rustc_mir_build/src/builder/expr/as_place.rs:135 is_ancestor_or_same_capture (lane mb-expr-a)
export function is_ancestor_or_same_capture(proj_possible_ancestor: readonly HirProjectionKind[], proj_capture: readonly HirProjectionKind[]): boolean {
  return unported("rustc_mir_build::builder::expr::as_place::is_ancestor_or_same_capture");
}

// stub: compiler/rustc_mir_build/src/builder/expr/as_place.rs:155 find_capture_matching_projections (lane mb-expr-a)
export function find_capture_matching_projections(upvars: CaptureMap, var_hir_id: LocalVarId, projections: readonly PlaceElem[]): [number, Capture] | undefined {
  return unported("rustc_mir_build::builder::expr::as_place::find_capture_matching_projections");
}

// stub: compiler/rustc_mir_build/src/builder/expr/as_place.rs:172 to_upvars_resolved_place_builder (lane mb-expr-a)
export function to_upvars_resolved_place_builder(cx: Builder, var_hir_id: LocalVarId, closure_def_id: LocalDefId, projection: readonly PlaceElem[]): PlaceBuilder | undefined {
  return unported("rustc_mir_build::builder::expr::as_place::to_upvars_resolved_place_builder");
}

// stub: compiler/rustc_mir_build/src/builder/expr/as_place.rs:219 strip_prefix (lane mb-expr-a)
export function strip_prefix(base_ty: Ty, projections: readonly PlaceElem[], prefix_projections: readonly HirProjection[]): Iterable<PlaceElem> {
  return unported("rustc_mir_build::builder::expr::as_place::strip_prefix");
}

// stub: compiler/rustc_mir_build/src/builder/expr/as_place.rs:256 to_place (lane mb-expr-a)
PlaceBuilder.prototype.to_place = function (this: PlaceBuilder, cx: Builder): Place {
  return unported("rustc_mir_build::builder::expr::as_place::PlaceBuilder::to_place");
};

// stub: compiler/rustc_mir_build/src/builder/expr/as_place.rs:272 try_to_place (lane mb-expr-a)
PlaceBuilder.prototype.try_to_place = function (this: PlaceBuilder, cx: Builder): Place | undefined {
  return unported("rustc_mir_build::builder::expr::as_place::PlaceBuilder::try_to_place");
};

// stub: compiler/rustc_mir_build/src/builder/expr/as_place.rs:290 resolve_upvar (lane mb-expr-a)
PlaceBuilder.prototype.resolve_upvar = function (this: PlaceBuilder, cx: Builder): PlaceBuilder | undefined {
  return unported("rustc_mir_build::builder::expr::as_place::PlaceBuilder::resolve_upvar");
};

// stub: compiler/rustc_mir_build/src/builder/expr/as_place.rs:300 base (lane mb-expr-a)
PlaceBuilder.prototype.base_ = function (this: PlaceBuilder): PlaceBase {
  return unported("rustc_mir_build::builder::expr::as_place::PlaceBuilder::base");
};

// stub: compiler/rustc_mir_build/src/builder/expr/as_place.rs:304 projection (lane mb-expr-a)
PlaceBuilder.prototype.projection_ = function (this: PlaceBuilder): readonly PlaceElem[] {
  return unported("rustc_mir_build::builder::expr::as_place::PlaceBuilder::projection");
};

// stub: compiler/rustc_mir_build/src/builder/expr/as_place.rs:308 field (lane mb-expr-a)
PlaceBuilder.prototype.field = function (this: PlaceBuilder, f: FieldIdx, ty: Ty): PlaceBuilder {
  return unported("rustc_mir_build::builder::expr::as_place::PlaceBuilder::field");
};

// stub: compiler/rustc_mir_build/src/builder/expr/as_place.rs:312 deref (lane mb-expr-a)
PlaceBuilder.prototype.deref = function (this: PlaceBuilder): PlaceBuilder {
  return unported("rustc_mir_build::builder::expr::as_place::PlaceBuilder::deref");
};

// stub: compiler/rustc_mir_build/src/builder/expr/as_place.rs:316 downcast (lane mb-expr-a)
PlaceBuilder.prototype.downcast = function (this: PlaceBuilder, adt_def: AdtDef, variant_index: VariantIdx): PlaceBuilder {
  return unported("rustc_mir_build::builder::expr::as_place::PlaceBuilder::downcast");
};

// stub: compiler/rustc_mir_build/src/builder/expr/as_place.rs:320 index (lane mb-expr-a)
PlaceBuilder.prototype.index = function (this: PlaceBuilder, index: Local): PlaceBuilder {
  return unported("rustc_mir_build::builder::expr::as_place::PlaceBuilder::index");
};

// stub: compiler/rustc_mir_build/src/builder/expr/as_place.rs:324 project (lane mb-expr-a)
PlaceBuilder.prototype.project = function (this: PlaceBuilder, elem: PlaceElem): PlaceBuilder {
  return unported("rustc_mir_build::builder::expr::as_place::PlaceBuilder::project");
};

// stub: compiler/rustc_mir_build/src/builder/expr/as_place.rs:330 clone_project (lane mb-expr-a)
PlaceBuilder.prototype.clone_project = function (this: PlaceBuilder, elem: PlaceElem): PlaceBuilder {
  return unported("rustc_mir_build::builder::expr::as_place::PlaceBuilder::clone_project");
};

// impl<'tcx> From<Local> for PlaceBuilder<'tcx>
// stub: compiler/rustc_mir_build/src/builder/expr/as_place.rs:339 from (lane mb-expr-a)
export function PlaceBuilder_from_Local(local: Local): PlaceBuilder {
  return unported("rustc_mir_build::builder::expr::as_place::PlaceBuilder::from (From<Local>)");
}

// impl<'tcx> From<PlaceBase> for PlaceBuilder<'tcx>
// stub: compiler/rustc_mir_build/src/builder/expr/as_place.rs:345 from (lane mb-expr-a)
export function PlaceBuilder_from_PlaceBase(base: PlaceBase): PlaceBuilder {
  return unported("rustc_mir_build::builder::expr::as_place::PlaceBuilder::from (From<PlaceBase>)");
}

// impl<'tcx> From<Place<'tcx>> for PlaceBuilder<'tcx>
// stub: compiler/rustc_mir_build/src/builder/expr/as_place.rs:351 from (lane mb-expr-a)
export function PlaceBuilder_from_Place(p: Place): PlaceBuilder {
  return unported("rustc_mir_build::builder::expr::as_place::PlaceBuilder::from (From<Place>)");
}

// stub: compiler/rustc_mir_build/src/builder/expr/as_place.rs:369 as_place (lane mb-expr-a)
Builder.prototype.as_place = function (this: Builder, block: BasicBlock, expr_id: ExprId): BlockAnd<Place> {
  return unported("rustc_mir_build::builder::expr::as_place::Builder::as_place");
};

// stub: compiler/rustc_mir_build/src/builder/expr/as_place.rs:380 as_place_builder (lane mb-expr-a)
Builder.prototype.as_place_builder = function (this: Builder, block: BasicBlock, expr_id: ExprId): BlockAnd<PlaceBuilder> {
  return unported("rustc_mir_build::builder::expr::as_place::Builder::as_place_builder");
};

// stub: compiler/rustc_mir_build/src/builder/expr/as_place.rs:393 as_read_only_place (lane mb-expr-a)
Builder.prototype.as_read_only_place = function (this: Builder, block: BasicBlock, expr_id: ExprId): BlockAnd<Place> {
  return unported("rustc_mir_build::builder::expr::as_place::Builder::as_read_only_place");
};

// stub: compiler/rustc_mir_build/src/builder/expr/as_place.rs:408 as_read_only_place_builder (lane mb-expr-a)
Builder.prototype.as_read_only_place_builder = function (this: Builder, block: BasicBlock, expr_id: ExprId): BlockAnd<PlaceBuilder> {
  return unported("rustc_mir_build::builder::expr::as_place::Builder::as_read_only_place_builder");
};

// stub: compiler/rustc_mir_build/src/builder/expr/as_place.rs:416 expr_as_place (lane mb-expr-a)
Builder.prototype.expr_as_place = function (this: Builder, block: BasicBlock, expr_id: ExprId, mutability: Mutability, fake_borrow_temps: Local[] | undefined): BlockAnd<PlaceBuilder> {
  return unported("rustc_mir_build::builder::expr::as_place::Builder::expr_as_place");
};

// stub: compiler/rustc_mir_build/src/builder/expr/as_place.rs:604 lower_captured_upvar (lane mb-expr-a)
Builder.prototype.lower_captured_upvar = function (this: Builder, block: BasicBlock, closure_def_id: LocalDefId, var_hir_id: LocalVarId): BlockAnd<PlaceBuilder> {
  return unported("rustc_mir_build::builder::expr::as_place::Builder::lower_captured_upvar");
};

// stub: compiler/rustc_mir_build/src/builder/expr/as_place.rs:621 lower_index_expression (lane mb-expr-a)
Builder.prototype.lower_index_expression = function (this: Builder, block: BasicBlock, base: ExprId, index: ExprId, mutability: Mutability, fake_borrow_temps: Local[] | undefined, expr_span: Span, source_info: SourceInfo): BlockAnd<PlaceBuilder> {
  return unported("rustc_mir_build::builder::expr::as_place::Builder::lower_index_expression");
};

// stub: compiler/rustc_mir_build/src/builder/expr/as_place.rs:669 len_of_slice_or_array (lane mb-expr-a)
Builder.prototype.len_of_slice_or_array = function (this: Builder, block: BasicBlock, place: Place, span: Span, source_info: SourceInfo): Operand {
  return unported("rustc_mir_build::builder::expr::as_place::Builder::len_of_slice_or_array");
};

// stub: compiler/rustc_mir_build/src/builder/expr/as_place.rs:727 bounds_check (lane mb-expr-a)
Builder.prototype.bounds_check = function (this: Builder, block: BasicBlock, slice: PlaceBuilder, index: Local, expr_span: Span, source_info: SourceInfo): BasicBlock {
  return unported("rustc_mir_build::builder::expr::as_place::Builder::bounds_check");
};

// stub: compiler/rustc_mir_build/src/builder/expr/as_place.rs:758 add_fake_borrows_of_base (lane mb-expr-a)
Builder.prototype.add_fake_borrows_of_base = function (this: Builder, base_place: Place, block: BasicBlock, fake_borrow_temps: Local[], expr_span: Span, source_info: SourceInfo): void {
  return unported("rustc_mir_build::builder::expr::as_place::Builder::add_fake_borrows_of_base");
};

// stub: compiler/rustc_mir_build/src/builder/expr/as_place.rs:817 read_fake_borrows (lane mb-expr-a)
Builder.prototype.read_fake_borrows = function (this: Builder, bb: BasicBlock, fake_borrow_temps: Local[], source_info: SourceInfo): void {
  return unported("rustc_mir_build::builder::expr::as_place::Builder::read_fake_borrows");
};

// stub: compiler/rustc_mir_build/src/builder/expr/as_place.rs:833 enable_precise_capture (lane mb-expr-a)
export function enable_precise_capture(closure_span: Span): boolean {
  return unported("rustc_mir_build::builder::expr::as_place::enable_precise_capture");
}
