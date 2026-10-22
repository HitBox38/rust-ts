// Port of compiler/rustc_mir_build/src/builder/expr/as_place.rs (declared by lane builder-contract, filled by lane mb-expr-a,
// plan-m4 wave 22; builder/mod.ts's header has the representation notes).
// PORT: the `PlaceBuilder` methods taking `self` by value (`field`, `deref`, `downcast`, `index`, `project`) push onto
// `this.projection` and return `this` (the moved builder); callers that keep the original clone it first
// (`clone_PlaceBuilder`, upstream's `.clone()`). A `Place` used twice in the MIR built here is cloned for its second use
// (`clone_Place`, PORTING §8 / builder-contract decision 7): MIR passes edit places in place.
//! See docs in build/expr/mod.rs
import { FIRST_VARIANT } from "../../../rustc_abi/lib.ts";
import { Mutability } from "../../../rustc_ast_ir/lib.ts";
import {
  type Projection as HirProjection,
  type ProjectionKind as HirProjectionKind,
  ProjectionKind as HirProjectionKindC,
  ProjectionKind_eq as HirProjectionKind_eq,
  debug_Projection as debug_HirProjection,
} from "../../../rustc_middle/hir/place.ts";
import { IndexVec } from "../../../rustc_index/vec.ts";
import {
  type AssertMessage,
  type BasicBlock,
  type Const,
  ConstOperand,
  FakeReadCause,
  type Local,
  LocalDecl,
  type Operand,
  Operand as OperandC,
  Place,
  type PlaceElem,
  Place_from_Local,
  type SourceInfo,
  Statement,
  clone_Place,
  debug_Local,
  debug_ProjectionElem,
} from "../../../rustc_middle/mir/mod.ts";
import { debug_LocalVarId, type ExprId, type LocalVarId } from "../../../rustc_middle/thir.ts";
import { type AdtDef, type FieldIdx, type VariantIdx } from "../../../rustc_middle/ty/decls.ts";
import { type Ty, Ty as TyC } from "../../../rustc_middle/ty/mod.ts";
import { debug_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { type CanonicalUserTypeAnnotation, type UserTypeAnnotationIndex } from "../../../rustc_middle/ty/typeck_results.ts";
import { type LocalDefId } from "../../../rustc_span/def_id.ts";
import { Span } from "../../../rustc_span/lib.ts";
import { bug, span_bug } from "../../../rustc_span/macros.ts";
import { debug_option, debug_vec, type Fmt, format_debug, PLAIN, PRETTY } from "../../../std/fmt.ts";
import { panic } from "../../../std/panic.ts";
import { clone_PlaceBase, PlaceBuilder, type PlaceBase } from "./as_place.gen.ts";
import { and, Builder, type BlockAnd, type Capture, type CaptureMap } from "../mod.ts";
export * from "./as_place.gen.ts";

declare module "./as_place.gen.ts" {
  interface PlaceBuilder {
    to_place(cx: Builder): Place;
    try_to_place(cx: Builder): Place | undefined;
    resolve_upvar(cx: Builder): PlaceBuilder | undefined;
    base_(): PlaceBase; // PORT: the field `base` holds the name
    projection_(): readonly PlaceElem[]; // PORT: the field `projection` holds the name
    field(f: FieldIdx, ty: Ty): PlaceBuilder;
    deref(): PlaceBuilder;
    downcast(adt_def: AdtDef, variant_index: VariantIdx): PlaceBuilder;
    index(index: Local): PlaceBuilder;
    project(elem: PlaceElem): PlaceBuilder;
    clone_project(elem: PlaceElem): PlaceBuilder;
  }
}

declare module "../mod.ts" {
  interface Builder {
    as_place(block: BasicBlock, expr_id: ExprId): BlockAnd<Place>;
    as_place_builder(block: BasicBlock, expr_id: ExprId): BlockAnd<PlaceBuilder>;
    as_read_only_place(block: BasicBlock, expr_id: ExprId): BlockAnd<Place>;
    as_read_only_place_builder(block: BasicBlock, expr_id: ExprId): BlockAnd<PlaceBuilder>;
    expr_as_place(block: BasicBlock, expr_id: ExprId, mutability: Mutability, fake_borrow_temps: Local[] | undefined): BlockAnd<PlaceBuilder>;
    lower_captured_upvar(block: BasicBlock, closure_def_id: LocalDefId, var_hir_id: LocalVarId): BlockAnd<PlaceBuilder>;
    lower_index_expression(block: BasicBlock, base: ExprId, index: ExprId, mutability: Mutability, fake_borrow_temps: Local[] | undefined, expr_span: Span, source_info: SourceInfo): BlockAnd<PlaceBuilder>;
    len_of_slice_or_array(block: BasicBlock, place: Place, span: Span, source_info: SourceInfo): Operand;
    bounds_check(block: BasicBlock, slice: PlaceBuilder, index: Local, expr_span: Span, source_info: SourceInfo): BasicBlock;
    add_fake_borrows_of_base(base_place: Place, block: BasicBlock, fake_borrow_temps: Local[], expr_span: Span, source_info: SourceInfo): void;
    read_fake_borrows(bb: BasicBlock, fake_borrow_temps: Local[], source_info: SourceInfo): void;
  }
}


/** `{:?}` / `{:#?}` of a `[PlaceElem]` / `Vec<PlaceElem>`. */
function debug_projection(projection: readonly PlaceElem[], f: Fmt): string {
  return format_debug(projection, (v, f) => debug_vec(v, f, (x, f) => debug_ProjectionElem(x, f, debug_Local, debug_Ty)), f);
}

/// Given a list of MIR projections, convert them to list of HIR ProjectionKind.
/// The projections are truncated to represent a path that might be captured by a
/// closure/coroutine. This implies the vector returned from this function doesn't contain
/// ProjectionElems `Downcast`, `ConstantIndex`, `Index`, or `Subslice` because those will never be
/// part of a path that is captured by a closure. We stop applying projections once we see the first
/// projection that isn't captured by a closure.
// rustc: compiler/rustc_mir_build/src/builder/expr/as_place.rs:81 convert_to_hir_projections_and_truncate_for_capture
export function convert_to_hir_projections_and_truncate_for_capture(mir_projections: readonly PlaceElem[]): HirProjectionKind[] {
  const hir_projections: HirProjectionKind[] = [];
  let variant: VariantIdx | undefined = undefined;

  for (const mir_projection of mir_projections) {
    let hir_projection: HirProjectionKind;
    switch (mir_projection.$) {
      case "Deref":
        hir_projection = HirProjectionKindC.Deref;
        break;
      case "PhantomDeref":
        continue;
      case "Field": {
        const field = mir_projection._0;
        const variant_ = variant ?? FIRST_VARIANT;
        hir_projection = { $: "Field", _0: field, _1: variant_ };
        break;
      }
      case "Downcast": {
        const idx = mir_projection._1;
        // We don't expect to see multi-variant enums here, as earlier
        // phases will have truncated them already. However, there can
        // still be downcasts, thanks to single-variant enums.
        // We keep track of VariantIdx so we can use this information
        // if the next ProjectionElem is a Field.
        variant = idx;
        continue;
      }
      case "UnwrapUnsafeBinder":
        hir_projection = HirProjectionKindC.UnwrapUnsafeBinder;
        break;
      // These do not affect anything, they just make sure we know the right type.
      case "OpaqueCast":
        continue;
      case "Index":
      case "ConstantIndex":
      case "Subslice":
        // We don't capture array-access projections.
        // We can stop here as arrays are captured completely.
        return hir_projections;
    }
    variant = undefined;
    hir_projections.push(hir_projection);
  }

  return hir_projections;
}

/// Return true if the `proj_possible_ancestor` represents an ancestor path
/// to `proj_capture` or `proj_possible_ancestor` is same as `proj_capture`,
/// assuming they both start off of the same root variable.
///
/// **Note:** It's the caller's responsibility to ensure that both lists of projections
///           start off of the same root variable.
///
/// Eg: 1. `foo.x` which is represented using `projections=[Field(x)]` is an ancestor of
///        `foo.x.y` which is represented using `projections=[Field(x), Field(y)]`.
///        Note both `foo.x` and `foo.x.y` start off of the same root variable `foo`.
///     2. Since we only look at the projections here function will return `bar.x` as a valid
///        ancestor of `foo.x.y`. It's the caller's responsibility to ensure that both projections
///        list are being applied to the same root variable.
// rustc: compiler/rustc_mir_build/src/builder/expr/as_place.rs:135 is_ancestor_or_same_capture
export function is_ancestor_or_same_capture(proj_possible_ancestor: readonly HirProjectionKind[], proj_capture: readonly HirProjectionKind[]): boolean {
  // We want to make sure `is_ancestor_or_same_capture("x.0.0", "x.0")` to return false.
  // Therefore we can't just check if all projections are same in the zipped iterator below.
  if (proj_possible_ancestor.length > proj_capture.length) {
    return false;
  }

  // `iter::zip(proj_possible_ancestor, proj_capture).all(|(a, b)| a == b)`
  const n = Math.min(proj_possible_ancestor.length, proj_capture.length);
  for (let i = 0; i < n; i++) {
    if (!HirProjectionKind_eq(proj_possible_ancestor[i]!, proj_capture[i]!)) return false;
  }
  return true;
}

/// Given a closure, returns the index of a capture within the desugared closure struct and the
/// `ty::CapturedPlace` which is the ancestor of the Place represented using the `var_hir_id`
/// and `projection`.
///
/// Note there will be at most one ancestor for any given Place.
///
/// Returns None, when the ancestor is not found.
// rustc: compiler/rustc_mir_build/src/builder/expr/as_place.rs:155 find_capture_matching_projections
export function find_capture_matching_projections(upvars: CaptureMap, var_hir_id: LocalVarId, projections: readonly PlaceElem[]): [number, Capture] | undefined {
  const hir_projections = convert_to_hir_projections_and_truncate_for_capture(projections);

  for (const [i, capture] of upvars.get_by_key_enumerated(var_hir_id._0.local_id)) {
    const possible_ancestor_proj_kinds: HirProjectionKind[] = capture.captured_place.place.projections.map((proj) => proj.kind);
    if (is_ancestor_or_same_capture(possible_ancestor_proj_kinds, hir_projections)) return [i, capture];
  }
  return undefined;
}

/// Takes an upvar place and tries to resolve it into a `PlaceBuilder`
/// with `PlaceBase::Local`
// #[instrument(level = "trace", skip(cx), ret)]
// rustc: compiler/rustc_mir_build/src/builder/expr/as_place.rs:172 to_upvars_resolved_place_builder
export function to_upvars_resolved_place_builder(cx: Builder, var_hir_id: LocalVarId, closure_def_id: LocalDefId, projection: readonly PlaceElem[]): PlaceBuilder | undefined {
  const found = find_capture_matching_projections(cx.upvars, var_hir_id, projection);
  if (found === undefined) {
    const closure_span = cx.tcx.def_span(closure_def_id);
    if (!enable_precise_capture(closure_span)) {
      return bug(
        `No associated capture found for ${debug_LocalVarId(var_hir_id, PLAIN)}[${debug_projection(projection, PRETTY)}] even though ` +
          `capture_disjoint_fields isn't enabled`,
      );
    } else {
      // debug!("No associated capture found for {:?}[{:#?}]", var_hir_id, projection,);
    }
    return undefined;
  }
  const [capture_index, capture] = found;

  // Access the capture by accessing the field within the Closure struct.
  const capture_info = cx.upvars.index(capture_index);

  const upvar_resolved_place_builder = PlaceBuilder_from_Place(capture_info.use_place);

  // We used some of the projections to build the capture itself,
  // now we apply the remaining to the upvar resolved place.
  // trace!(?capture.captured_place, ?projection);
  const remaining_projections = strip_prefix(capture.captured_place.place.base_ty, projection, capture.captured_place.place.projections);
  upvar_resolved_place_builder.projection.push(...remaining_projections);

  return upvar_resolved_place_builder;
}

/** `assert_matches!(iter.next(), <pattern>)` (`core::panicking::assert_matches_failed`). */
function assert_matches_next(next: PlaceElem | undefined, matches: boolean, right: string): void {
  if (!matches) {
    panic(
      `assertion \`left matches right\` failed\n  left: ${debug_option(next, PLAIN, (x, f) => debug_ProjectionElem(x, f, debug_Local, debug_Ty))}\n right: ${right}`,
    );
  }
}

/// Returns projections remaining after stripping an initial prefix of HIR
/// projections.
///
/// Supports only HIR projection kinds that represent a path that might be
/// captured by a closure or a coroutine, i.e., an `Index` or a `Subslice`
/// projection kinds are unsupported.
// rustc: compiler/rustc_mir_build/src/builder/expr/as_place.rs:219 strip_prefix
export function strip_prefix(base_ty: Ty, projections: readonly PlaceElem[], prefix_projections: readonly HirProjection[]): Iterable<PlaceElem> {
  // PORT: the lazy `projections.iter().copied().filter(..)` iterator is the filtered array with a cursor; the remaining
  // elements are returned as an array.
  const iter = projections
    // Filter out opaque casts, they are unnecessary in the prefix.
    .filter((elem) => !(elem.$ === "OpaqueCast"));
  let pos = 0;
  const next = (): PlaceElem | undefined => (pos < iter.length ? iter[pos++] : undefined);
  for (const projection of prefix_projections) {
    switch (projection.kind.$) {
      case "Deref": {
        const n = next();
        assert_matches_next(n, n?.$ === "Deref", "Some(ProjectionElem::Deref)");
        break;
      }
      case "Field": {
        if (base_ty.is_enum()) {
          const n = next();
          assert_matches_next(n, n?.$ === "Downcast", "Some(ProjectionElem::Downcast(..))");
        }
        const n = next();
        assert_matches_next(n, n?.$ === "Field", "Some(ProjectionElem::Field(..))");
        break;
      }
      case "OpaqueCast": {
        const n = next();
        assert_matches_next(n, n?.$ === "OpaqueCast", "Some(ProjectionElem::OpaqueCast(..))");
        break;
      }
      case "UnwrapUnsafeBinder": {
        const n = next();
        assert_matches_next(n, n?.$ === "UnwrapUnsafeBinder", "Some(ProjectionElem::UnwrapUnsafeBinder(..))");
        break;
      }
      case "Index":
      case "Subslice": {
        return bug(`unexpected projection kind: ${debug_HirProjection(projection, PLAIN)}`);
      }
    }
    base_ty = projection.ty;
  }
  return iter.slice(pos);
}

// rustc: compiler/rustc_mir_build/src/builder/expr/as_place.rs:256 to_place
PlaceBuilder.prototype.to_place = function (this: PlaceBuilder, cx: Builder): Place {
  const p = this.try_to_place(cx);
  if (p !== undefined) return p;
  switch (this.base.$) {
    case "Local": {
      const local = this.base._0;
      return span_bug(cx.local_decls[local]!.source_info.span, `could not resolve local: ${format_debug(local, debug_Local, PRETTY)} + ${debug_projection(this.projection, PLAIN)}`);
    }
    case "Upvar": {
      const { var_hir_id } = this.base;
      return span_bug(cx.tcx.hir_span(var_hir_id._0), `could not resolve upvar: ${debug_LocalVarId(var_hir_id, PLAIN)} + ${debug_projection(this.projection, PLAIN)}`);
    }
  }
};

/// Creates a `Place` or returns `None` if an upvar cannot be resolved
// rustc: compiler/rustc_mir_build/src/builder/expr/as_place.rs:272 try_to_place
PlaceBuilder.prototype.try_to_place = function (this: PlaceBuilder, cx: Builder): Place | undefined {
  const resolved = this.resolve_upvar(cx);
  const builder = resolved ?? this;
  if (builder.base.$ !== "Local") return undefined;
  const local = builder.base._0;
  const projection = cx.tcx.mk_place_elems(builder.projection);
  return new Place(local, projection);
};

/// Attempts to resolve the `PlaceBuilder`.
/// Returns `None` if this is not an upvar.
///
/// Upvars resolve may fail for a `PlaceBuilder` when attempting to
/// resolve a disjoint field whose root variable is not captured
/// (destructured assignments) or when attempting to resolve a root
/// variable (discriminant matching with only wildcard arm) that is
/// not captured. This can happen because the final mir that will be
/// generated doesn't require a read for this place. Failures will only
/// happen inside closures.
// rustc: compiler/rustc_mir_build/src/builder/expr/as_place.rs:290 resolve_upvar
PlaceBuilder.prototype.resolve_upvar = function (this: PlaceBuilder, cx: Builder): PlaceBuilder | undefined {
  if (this.base.$ !== "Upvar") {
    return undefined;
  }
  const { var_hir_id, closure_def_id } = this.base;
  return to_upvars_resolved_place_builder(cx, var_hir_id, closure_def_id, this.projection);
};

// rustc: compiler/rustc_mir_build/src/builder/expr/as_place.rs:300 base
PlaceBuilder.prototype.base_ = function (this: PlaceBuilder): PlaceBase {
  // PORT: `PlaceBase: Copy`: the caller gets its own copy.
  return clone_PlaceBase(this.base);
};

// rustc: compiler/rustc_mir_build/src/builder/expr/as_place.rs:304 projection
PlaceBuilder.prototype.projection_ = function (this: PlaceBuilder): readonly PlaceElem[] {
  return this.projection;
};

// rustc: compiler/rustc_mir_build/src/builder/expr/as_place.rs:308 field
PlaceBuilder.prototype.field = function (this: PlaceBuilder, f: FieldIdx, ty: Ty): PlaceBuilder {
  return this.project({ $: "Field", _0: f, _1: ty });
};

// rustc: compiler/rustc_mir_build/src/builder/expr/as_place.rs:312 deref
PlaceBuilder.prototype.deref = function (this: PlaceBuilder): PlaceBuilder {
  return this.project({ $: "Deref" });
};

// rustc: compiler/rustc_mir_build/src/builder/expr/as_place.rs:316 downcast
PlaceBuilder.prototype.downcast = function (this: PlaceBuilder, adt_def: AdtDef, variant_index: VariantIdx): PlaceBuilder {
  return this.project({ $: "Downcast", _0: adt_def.variant(variant_index).name, _1: variant_index });
};

// rustc: compiler/rustc_mir_build/src/builder/expr/as_place.rs:320 index
PlaceBuilder.prototype.index = function (this: PlaceBuilder, index: Local): PlaceBuilder {
  return this.project({ $: "Index", _0: index });
};

// rustc: compiler/rustc_mir_build/src/builder/expr/as_place.rs:324 project
PlaceBuilder.prototype.project = function (this: PlaceBuilder, elem: PlaceElem): PlaceBuilder {
  this.projection.push(elem);
  return this;
};

/// Same as `.clone().project(..)` but more efficient
// rustc: compiler/rustc_mir_build/src/builder/expr/as_place.rs:330 clone_project
PlaceBuilder.prototype.clone_project = function (this: PlaceBuilder, elem: PlaceElem): PlaceBuilder {
  return new PlaceBuilder(clone_PlaceBase(this.base), [...this.projection, elem]);
};

// impl<'tcx> From<Local> for PlaceBuilder<'tcx>
// rustc: compiler/rustc_mir_build/src/builder/expr/as_place.rs:339 from
export function PlaceBuilder_from_Local(local: Local): PlaceBuilder {
  return new PlaceBuilder({ $: "Local", _0: local }, []);
}

// impl<'tcx> From<PlaceBase> for PlaceBuilder<'tcx>
// rustc: compiler/rustc_mir_build/src/builder/expr/as_place.rs:345 from
export function PlaceBuilder_from_PlaceBase(base: PlaceBase): PlaceBuilder {
  return new PlaceBuilder(base, []);
}

// impl<'tcx> From<Place<'tcx>> for PlaceBuilder<'tcx>
// rustc: compiler/rustc_mir_build/src/builder/expr/as_place.rs:351 from
export function PlaceBuilder_from_Place(p: Place): PlaceBuilder {
  return new PlaceBuilder({ $: "Local", _0: p.local }, [...p.projection]);
}

/// Compile `expr`, yielding a place that we can move from etc.
///
/// WARNING: Any user code might:
/// * Invalidate any slice bounds checks performed.
/// * Change the address that this `Place` refers to.
/// * Modify the memory that this place refers to.
/// * Invalidate the memory that this place refers to, this will be caught
///   by borrow checking.
///
/// Extra care is needed if any user code is allowed to run between calling
/// this method and using it, as is the case for `match` and index
/// expressions.
// rustc: compiler/rustc_mir_build/src/builder/expr/as_place.rs:369 as_place
Builder.prototype.as_place = function (this: Builder, block: BasicBlock, expr_id: ExprId): BlockAnd<Place> {
  let place_builder: PlaceBuilder;
  [block, place_builder] = this.as_place_builder(block, expr_id);
  return and(block, place_builder.to_place(this));
};

/// This is used when constructing a compound `Place`, so that we can avoid creating
/// intermediate `Place` values until we know the full set of projections.
// rustc: compiler/rustc_mir_build/src/builder/expr/as_place.rs:380 as_place_builder
Builder.prototype.as_place_builder = function (this: Builder, block: BasicBlock, expr_id: ExprId): BlockAnd<PlaceBuilder> {
  return this.expr_as_place(block, expr_id, Mutability.Mut, undefined);
};

/// Compile `expr`, yielding a place that we can move from etc.
/// Mutability note: The caller of this method promises only to read from the resulting
/// place. The place itself may or may not be mutable:
/// * If this expr is a place expr like a.b, then we will return that place.
/// * Otherwise, a temporary is created: in that event, it will be an immutable temporary.
// rustc: compiler/rustc_mir_build/src/builder/expr/as_place.rs:393 as_read_only_place
Builder.prototype.as_read_only_place = function (this: Builder, block: BasicBlock, expr_id: ExprId): BlockAnd<Place> {
  let place_builder: PlaceBuilder;
  [block, place_builder] = this.as_read_only_place_builder(block, expr_id);
  return and(block, place_builder.to_place(this));
};

/// This is used when constructing a compound `Place`, so that we can avoid creating
/// intermediate `Place` values until we know the full set of projections.
/// Mutability note: The caller of this method promises only to read from the resulting
/// place. The place itself may or may not be mutable:
/// * If this expr is a place expr like a.b, then we will return that place.
/// * Otherwise, a temporary is created: in that event, it will be an immutable temporary.
// rustc: compiler/rustc_mir_build/src/builder/expr/as_place.rs:408 as_read_only_place_builder
Builder.prototype.as_read_only_place_builder = function (this: Builder, block: BasicBlock, expr_id: ExprId): BlockAnd<PlaceBuilder> {
  return this.expr_as_place(block, expr_id, Mutability.Not, undefined);
};

// rustc: compiler/rustc_mir_build/src/builder/expr/as_place.rs:416 expr_as_place
Builder.prototype.expr_as_place = function (this: Builder, block: BasicBlock, expr_id: ExprId, mutability: Mutability, fake_borrow_temps: Local[] | undefined): BlockAnd<PlaceBuilder> {
  const expr = this.thir.index_ExprId(expr_id);
  // debug!("expr_as_place(block={:?}, expr={:?}, mutability={:?})", block, expr, mutability);

  const expr_span = expr.span;
  const source_info = this.source_info(expr_span);
  const kind = expr.kind;
  switch (kind.$) {
    case "Scope": {
      const { region_scope, hir_id, value } = kind;
      return this.in_scope([region_scope, source_info], { $: "Explicit", _0: hir_id }, (this_) => {
        this_.push_coverage_point_for_expr(block, source_info, hir_id);
        return this_.expr_as_place(block, value, mutability, fake_borrow_temps);
      });
    }
    case "Field": {
      const { lhs, variant_index, name } = kind;
      const lhs_expr = this.thir.index_ExprId(lhs);
      let place_builder: PlaceBuilder;
      [block, place_builder] = this.expr_as_place(block, lhs, mutability, fake_borrow_temps);
      const k = lhs_expr.ty.kind();
      if (k.$ === "Adt") {
        const adt_def = k._0;
        if (adt_def.is_enum()) {
          place_builder = place_builder.downcast(adt_def, variant_index);
        }
      }
      return and(block, place_builder.field(name, expr.ty));
    }
    case "Deref": {
      const { arg } = kind;
      let place_builder: PlaceBuilder;
      [block, place_builder] = this.expr_as_place(block, arg, mutability, fake_borrow_temps);
      return and(block, place_builder.deref());
    }
    case "Index": {
      const { lhs, index } = kind;
      return this.lower_index_expression(block, lhs, index, mutability, fake_borrow_temps, expr_span, source_info);
    }
    case "UpvarRef": {
      const { closure_def_id, var_hir_id } = kind;
      return this.lower_captured_upvar(block, closure_def_id.expect_local(), var_hir_id);
    }

    case "VarRef": {
      const { id } = kind;
      let place_builder: PlaceBuilder;
      if (this.is_bound_var_in_guard(id)) {
        const index = this.var_local_id(id, "RefWithinGuard");
        place_builder = PlaceBuilder_from_Local(index).deref();
      } else {
        const index = this.var_local_id(id, "OutsideGuard");
        place_builder = PlaceBuilder_from_Local(index);
      }
      return and(block, place_builder);
    }

    case "PlaceTypeAscription": {
      const { source, user_ty, user_ty_span } = kind;
      let place_builder: PlaceBuilder;
      [block, place_builder] = this.expr_as_place(block, source, mutability, fake_borrow_temps);
      if (user_ty !== undefined) {
        const ty_source_info = this.source_info(user_ty_span);
        const annotation_index = IndexVec.push<UserTypeAnnotationIndex, CanonicalUserTypeAnnotation>(this.canonical_user_type_annotations, {
          span: user_ty_span,
          // PORT: `user_ty.clone()`: canonical user types are never edited in place, so the value is shared.
          user_ty: user_ty,
          inferred_ty: expr.ty,
        });

        const place = place_builder.to_place(this);
        this.cfg.push(
          block,
          Statement.new(ty_source_info, {
            $: "AscribeUserType",
            _0: [place, { base: annotation_index, projs: [] }],
            _1: "Invariant",
          }),
        );
      }
      return and(block, place_builder);
    }
    case "ValueTypeAscription": {
      const { source, user_ty, user_ty_span } = kind;
      const temp_lifetime = this.region_scope_tree.temporary_scope(this.thir.index_ExprId(source).temp_scope_id);
      let temp: Local;
      [block, temp] = this.as_temp(block, temp_lifetime, source, mutability);
      if (user_ty !== undefined) {
        const ty_source_info = this.source_info(user_ty_span);
        const annotation_index = IndexVec.push<UserTypeAnnotationIndex, CanonicalUserTypeAnnotation>(this.canonical_user_type_annotations, {
          span: user_ty_span,
          // PORT: `user_ty.clone()`: canonical user types are never edited in place, so the value is shared.
          user_ty: user_ty,
          inferred_ty: expr.ty,
        });
        this.cfg.push(
          block,
          Statement.new(ty_source_info, {
            $: "AscribeUserType",
            _0: [Place_from_Local(temp), { base: annotation_index, projs: [] }],
            _1: "Invariant",
          }),
        );
      }
      return and(block, PlaceBuilder_from_Local(temp));
    }

    case "PlaceUnwrapUnsafeBinder": {
      const { source } = kind;
      let place_builder: PlaceBuilder;
      [block, place_builder] = this.expr_as_place(block, source, mutability, fake_borrow_temps);
      return and(block, place_builder.project({ $: "UnwrapUnsafeBinder", _0: expr.ty }));
    }
    case "ValueUnwrapUnsafeBinder": {
      const { source } = kind;
      const temp_lifetime = this.region_scope_tree.temporary_scope(this.thir.index_ExprId(source).temp_scope_id);
      let temp: Local;
      [block, temp] = this.as_temp(block, temp_lifetime, source, mutability);
      return and(block, PlaceBuilder_from_Local(temp).project({ $: "UnwrapUnsafeBinder", _0: expr.ty }));
    }

    case "Array":
    case "Tuple":
    case "Adt":
    case "Closure":
    case "Unary":
    case "Binary":
    case "LogicalOp":
    case "Cast":
    case "ValueExpr":
    case "NeverToAny":
    case "PointerCoercion":
    case "Repeat":
    case "Borrow":
    case "RawBorrow":
    case "Match":
    case "If":
    case "Loop":
    case "LoopMatch":
    case "Block":
    case "Let":
    case "Assign":
    case "AssignOp":
    case "Break":
    case "Continue":
    case "ConstContinue":
    case "Return":
    case "Become":
    case "Literal":
    case "NamedConst":
    case "NonHirLiteral":
    case "ZstLiteral":
    case "ConstParam":
    case "ConstBlock":
    case "StaticRef":
    case "InlineAsm":
    case "Yield":
    case "ThreadLocalRef":
    case "Call":
    case "ByUse":
    // A reborrow is an rvalue. If a place is needed for it, materialize
    // the rvalue in a temporary instead of treating the reborrow
    // expression itself as an assignable place.
    case "Reborrow":
    case "WrapUnsafeBinder": {
      // these are not places, so we need to make a temporary.
      // debug_assert!(!matches!(Category::of(&expr.kind), Some(Category::Place)));
      const temp_lifetime = this.region_scope_tree.temporary_scope(expr.temp_scope_id);
      let temp: Local;
      [block, temp] = this.as_temp(block, temp_lifetime, expr_id, mutability);
      return and(block, PlaceBuilder_from_Local(temp));
    }
  }
};

/// Lower a captured upvar. Note we might not know the actual capture index,
/// so we create a place starting from `PlaceBase::Upvar`, which will be resolved
/// once all projections that allow us to identify a capture have been applied.
// rustc: compiler/rustc_mir_build/src/builder/expr/as_place.rs:604 lower_captured_upvar
Builder.prototype.lower_captured_upvar = function (this: Builder, block: BasicBlock, closure_def_id: LocalDefId, var_hir_id: LocalVarId): BlockAnd<PlaceBuilder> {
  return and(block, PlaceBuilder_from_PlaceBase({ $: "Upvar", var_hir_id, closure_def_id }));
};

/// Lower an index expression
///
/// This has two complications;
///
/// * We need to do a bounds check.
/// * We need to ensure that the bounds check can't be invalidated using an
///   expression like `x[1][{x = y; 2}]`. We use fake borrows here to ensure
///   that this is the case.
// rustc: compiler/rustc_mir_build/src/builder/expr/as_place.rs:621 lower_index_expression
Builder.prototype.lower_index_expression = function (
  this: Builder,
  block: BasicBlock,
  base: ExprId,
  index: ExprId,
  mutability: Mutability,
  fake_borrow_temps0: Local[] | undefined,
  expr_span: Span,
  source_info: SourceInfo,
): BlockAnd<PlaceBuilder> {
  const base_fake_borrow_temps: Local[] = [];
  const is_outermost_index = fake_borrow_temps0 === undefined;
  const fake_borrow_temps = fake_borrow_temps0 ?? base_fake_borrow_temps;

  let base_place: PlaceBuilder;
  [block, base_place] = this.expr_as_place(block, base, mutability, fake_borrow_temps);

  // Making this a *fresh* temporary means we do not have to worry about
  // the index changing later: Nothing will ever change this temporary.
  // The "retagging" transformation (for Stacked Borrows) relies on this.
  // Using the enclosing temporary scope for the index ensures it will live past where this
  // place is used. This lifetime may be larger than strictly necessary but it means we don't
  // need to pass a scope for operands to `as_place`.
  const index_lifetime = this.region_scope_tree.temporary_scope(this.thir.index_ExprId(index).temp_scope_id);
  let idx: Local;
  [block, idx] = this.as_temp(block, index_lifetime, index, Mutability.Not);

  block = this.bounds_check(block, base_place, idx, expr_span, source_info);

  if (is_outermost_index) {
    this.read_fake_borrows(block, fake_borrow_temps, source_info);
  } else {
    this.add_fake_borrows_of_base(base_place.to_place(this), block, fake_borrow_temps, expr_span, source_info);
  }

  return and(block, base_place.index(idx));
};

/// Given a place that's either an array or a slice, returns an operand
/// with the length of the array/slice.
///
/// For arrays it'll be `Operand::Constant` with the actual length;
/// For slices it'll be `Operand::Move` of a local using `PtrMetadata`.
// rustc: compiler/rustc_mir_build/src/builder/expr/as_place.rs:669 len_of_slice_or_array
Builder.prototype.len_of_slice_or_array = function (this: Builder, block: BasicBlock, place: Place, span: Span, source_info: SourceInfo): Operand {
  const place_ty = place.ty(this.local_decls, this.tcx).ty;
  const k = place_ty.kind();
  switch (k.$) {
    case "Array": {
      const len_const = k._1;
      // We know how long an array is, so just use that as a constant
      // directly -- no locals needed. We do need one statement so
      // that borrow- and initialization-checking consider it used,
      // though. FIXME: Do we really *need* to count this as a use?
      // Could partial array tracking work off something else instead?
      this.cfg.push_fake_read(block, source_info, FakeReadCause.ForIndex, place);
      const const_: Const = { $: "Ty", _0: this.tcx.types.usize, _1: len_const };
      return { $: "Constant", _0: new ConstOperand(span, undefined, const_) };
    }
    case "Slice": {
      let ptr_or_ref: Operand;
      let local_ty: Ty;
      if (
        place.projection.length === 1 &&
        place.projection[0]!.$ === "Deref" &&
        ((local_ty = this.local_decls[place.local]!.ty), true) &&
        local_ty.is_trivially_pure_clone_copy()
      ) {
        // It's extremely common that we have something that can be
        // directly passed to `PtrMetadata`, so avoid an unnecessary
        // temporary and statement in those cases. Note that we can
        // only do that for `Copy` types -- not `&mut [_]` -- because
        // the MIR we're building here needs to pass NLL later.
        ptr_or_ref = { $: "Copy", _0: Place_from_Local(place.local) };
      } else {
        const ptr_ty = TyC.new_imm_ptr(this.tcx, place_ty);
        const slice_ptr = this.temp(ptr_ty, span);
        this.cfg.push_assign(block, source_info, slice_ptr, { $: "RawPtr", _0: "FakeForPtrMetadata", _1: place });
        ptr_or_ref = { $: "Move", _0: clone_Place(slice_ptr) };
      }

      const len = this.temp(this.tcx.types.usize, span);
      this.cfg.push_assign(block, source_info, len, { $: "UnaryOp", _0: "PtrMetadata", _1: ptr_or_ref });

      return { $: "Move", _0: clone_Place(len) };
    }
    default: {
      return span_bug(span, `len called on place of type ${debug_Ty(place_ty, PLAIN)}`);
    }
  }
};

// rustc: compiler/rustc_mir_build/src/builder/expr/as_place.rs:727 bounds_check
Builder.prototype.bounds_check = function (this: Builder, block: BasicBlock, slice0: PlaceBuilder, index: Local, expr_span: Span, source_info: SourceInfo): BasicBlock {
  const slice = slice0.to_place(this);

  // len = len(slice)
  const len = this.len_of_slice_or_array(block, slice, expr_span, source_info);

  // lt = idx < len
  const bool_ty = this.tcx.types.bool;
  const lt = this.temp(bool_ty, expr_span);
  this.cfg.push_assign(block, source_info, lt, {
    $: "BinaryOp",
    _0: "Lt",
    _1: [{ $: "Copy", _0: Place_from_Local(index) }, OperandC.to_copy(len)],
  });
  const msg: AssertMessage = { $: "BoundsCheck", len, index: { $: "Copy", _0: Place_from_Local(index) } };

  // assert!(lt, "...")
  return this.assert(block, { $: "Move", _0: clone_Place(lt) }, true, msg, expr_span);
};

// rustc: compiler/rustc_mir_build/src/builder/expr/as_place.rs:758 add_fake_borrows_of_base
Builder.prototype.add_fake_borrows_of_base = function (this: Builder, base_place0: Place, block: BasicBlock, fake_borrow_temps: Local[], expr_span: Span, source_info: SourceInfo): void {
  const tcx = this.tcx;

  const place_ty = base_place0.ty(this.local_decls, tcx);
  if (place_ty.ty.kind().$ === "Slice") {
    // We need to create fake borrows to ensure that the bounds
    // check that we just did stays valid. Since we can't assign to
    // unsized values, we only need to ensure that none of the
    // pointers in the base place are modified.
    const projections = base_place0.iter_projections();
    for (let i = projections.length - 1; i >= 0; i--) {
      const [base_place, elem] = projections[i]!;
      let stop = false;
      switch (elem.$) {
        case "Deref": {
          const fake_borrow_deref_ty = base_place.ty(this.local_decls, tcx).ty;
          const fake_borrow_ty = TyC.new_imm_ref(tcx, tcx.lifetimes.re_erased, fake_borrow_deref_ty);
          const fake_borrow_temp = IndexVec.push<Local, LocalDecl>(this.local_decls, LocalDecl.new(fake_borrow_ty, expr_span));
          const projection = tcx.mk_place_elems(base_place.projection);
          this.cfg.push_assign(block, source_info, Place_from_Local(fake_borrow_temp), {
            $: "Ref",
            _0: tcx.lifetimes.re_erased,
            _1: { $: "Fake", _0: "Shallow" },
            _2: new Place(base_place.local, projection),
          });
          fake_borrow_temps.push(fake_borrow_temp);
          break;
        }
        case "Index": {
          const index_ty = base_place.ty(this.local_decls, tcx);
          switch (index_ty.ty.kind().$) {
            // The previous index expression has already
            // done any index expressions needed here.
            case "Slice":
              stop = true;
              break;
            case "Array":
              break;
            default:
              return bug("unexpected index base");
          }
          break;
        }
        case "Field":
        case "PhantomDeref":
        case "Downcast":
        case "OpaqueCast":
        case "ConstantIndex":
        case "Subslice":
        case "UnwrapUnsafeBinder":
          break;
      }
      if (stop) break;
    }
  }
};

// rustc: compiler/rustc_mir_build/src/builder/expr/as_place.rs:817 read_fake_borrows
Builder.prototype.read_fake_borrows = function (this: Builder, bb: BasicBlock, fake_borrow_temps: Local[], source_info: SourceInfo): void {
  // All indexes have been evaluated now, read all of the
  // fake borrows so that they are live across those index
  // expressions.
  for (const temp of fake_borrow_temps) {
    this.cfg.push_fake_read(bb, source_info, FakeReadCause.ForIndex, Place_from_Local(temp));
  }
};

/// Precise capture is enabled if user is using Rust Edition 2021 or higher.
// rustc: compiler/rustc_mir_build/src/builder/expr/as_place.rs:833 enable_precise_capture
export function enable_precise_capture(closure_span: Span): boolean {
  return Span.at_least_rust_2021(closure_span);
}
