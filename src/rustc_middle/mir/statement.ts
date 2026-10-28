// Port of compiler/rustc_middle/src/mir/statement.rs (lane mir-contract, plan-m4 D3). `Statement`, `PlaceTy`,
// `PlaceRef`, `StmtDebugInfos`, `StmtDebugInfo` are generated (statement.gen.ts, set rustc_middle_mir); this module
// declares (and stubs, for lane mir-body-b) the file's fns: methods of its own classes, of syntax.rs's classes `Place` /
// `ConstOperand` (prototype) and of syntax.rs's enums (companions in syntax.ts). docs/handoff/mir-contract.md has the
// conventions ("How to fill a stub").
// PORT: `D: HasLocalDecls` parameters are `HasLocalDecls` (mod.ts: `LocalDecl[] | Body`); `Box<(Place, Rvalue)>` is the
// `[Place, Rvalue]` tuple object of `StatementKind::Assign._0` (`as_assign_mut` hands it out for in-place edits).
//! Functionality for statements, operands, places, and things that appear in them.
import "./mod.ts";
import type { BinOpKind } from "../../rustc_ast/lib.ts";
import { FieldIdx, VariantIdx } from "../../rustc_abi/lib.ts";
import type { Mutability } from "../../rustc_ast_ir/lib.ts";
import type { DenseBitSet } from "../../rustc_index/bit_set.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import { DUMMY_SP, type Span } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { ClosureArgs, CoroutineArgs, CoroutineClosureArgs } from "../../rustc_type_ir/ty_kind/closure.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { type Debug, debug_option, PLAIN } from "../../std/fmt.ts";
import { assert, assert_eq, panic, unreachable, unwrap } from "../../std/panic.ts";
import type { TyCtxt } from "../ty/context.ts";
import { fold_GenericArgs, type GenericArg, type GenericArgsRef } from "../ty/generic_args.ts";
import { RawList } from "../ty/list.ts";
import { debug_Ty, Ty } from "../ty/mod.ts";
import { fold_Ty } from "../ty/structural_impls.ts";
import { Const, ConstValue, fold_Const as fold_mir_Const } from "./consts.ts";
import { CtfeProvenance } from "./interpret/pointer.ts";
import type { Scalar } from "./interpret/value.ts";
import { debug_Local, HasLocalDecls, type Local, RETURN_PLACE, type SourceInfo } from "./mod.ts";
import {
  clone_StmtDebugInfo,
  debug_PlaceTy,
  PlaceRef,
  PlaceTy,
  Statement,
  StmtDebugInfos,
  type ProjectionKind,
  type StmtDebugInfo,
} from "./statement.gen.ts";
import {
  BinOp,
  BorrowKind,
  clone_Operand,
  clone_Place,
  ConstOperand,
  Operand,
  Place,
  type PlaceElem,
  ProjectionElem,
  RawPtrKind,
  Rvalue,
  StatementKind,
  UnOp,
} from "./syntax.ts";
import { u64_to_number } from "../../rust_ts/u64.ts";
export * from "./statement.gen.ts";

/** pretty.ts (the manual `Debug` impls of statement.rs types live in pretty.rs), read lazily (init order). */
function mir_pretty(): typeof import("./pretty.ts") {
  return (mir_pretty__m ??= require("./pretty.ts") as typeof import("./pretty.ts"));
}
var mir_pretty__m: typeof import("./pretty.ts") | undefined;
/** rustc_middle ty/sty.ts (`CoroutineArgsExt`), read lazily (init order: mir/ is in ty/context.ts's import closure). */
function sty(): typeof import("../ty/sty.ts") {
  return (sty__m ??= require("../ty/sty.ts") as typeof import("../ty/sty.ts"));
}
var sty__m: typeof import("../ty/sty.ts") | undefined;
/** rustc_middle ty/print/pretty.ts (`Display for Ty`), read lazily (init order). */
function print_pretty(): typeof import("../ty/print/pretty.ts") {
  return (print_pretty__m ??= require("../ty/print/pretty.ts") as typeof import("../ty/print/pretty.ts"));
}
var print_pretty__m: typeof import("../ty/print/pretty.ts") | undefined;
/** `impl Debug for Statement` (pretty.rs:905). */
export const debug_Statement: Debug<Statement> = (v, f) => mir_pretty().debug_Statement(v, f);
/** `impl Debug for StmtDebugInfo` (pretty.rs:911). */
export const debug_StmtDebugInfo: Debug<StmtDebugInfo> = (v, f) => mir_pretty().debug_StmtDebugInfo(v, f);
/** `impl Debug for PlaceRef` (pretty.rs:1353). */
export const debug_PlaceRef: Debug<PlaceRef> = (v, f) => mir_pretty().debug_PlaceRef(v, f);

declare module "./statement.gen.ts" {
  interface Statement {
    // statement.rs:32 (lane mir-body-b)
    make_nop(drop_debuginfo: boolean): void;
  }
}

declare module "./statement.gen.ts" {
  namespace Statement {
    // statement.rs:45 (lane mir-body-b)
    function new_(source_info: SourceInfo, kind: StatementKind): Statement;
    export { new_ as new };
  }
}

declare module "./syntax.ts" {
  interface StatementKind_methods {
    // statement.rs:53 (lane mir-body-b)
    name(self: StatementKind): string;
    // statement.rs:69 (lane mir-body-b)
    as_assign_mut(self: StatementKind): [Place, Rvalue] | undefined;
    // statement.rs:76 (lane mir-body-b)
    as_assign(self: StatementKind): [Place, Rvalue] | undefined;
    // statement.rs:83 (lane mir-body-b)
    as_debuginfo(self: StatementKind): StmtDebugInfo | undefined;
  }
}

declare module "./statement.gen.ts" {
  namespace PlaceTy {
    // statement.rs:111 (lane mir-body-b)
    export function from_ty(ty: Ty): PlaceTy;
    // statement.rs:123 (lane mir-body-b)
    export function field_ty(tcx: TyCtxt, self_ty: Ty, variant_idx: VariantIdx | undefined, f: FieldIdx): Unnormalized<Ty>;
  }
}

declare module "./statement.gen.ts" {
  interface PlaceTy {
    // statement.rs:181 (lane mir-body-b)
    multi_projection_ty(tcx: TyCtxt, elems: readonly PlaceElem[]): PlaceTy;
    // statement.rs:192 (lane mir-body-b)
    projection_ty<V>(tcx: TyCtxt, elem: ProjectionElem<V, Ty>, debug_V: Debug<V>): PlaceTy;
    // statement.rs:206 (lane mir-body-b)
    projection_ty_core<V, T>(tcx: TyCtxt, elem: ProjectionElem<V, T>, handle_field: (a0: Ty, a1: VariantIdx | undefined, a2: FieldIdx, a3: T) => Ty, handle_opaque_cast_and_subtype: (a0: T) => Ty): PlaceTy;
  }
}

declare module "./syntax.ts" {
  interface ProjectionElem_methods {
    // statement.rs:264 (lane mir-body-b)
    is_indirect<V, T>(self: ProjectionElem<V, T>): boolean;
    // statement.rs:280 (lane mir-body-b)
    is_stable_offset<V, T>(self: ProjectionElem<V, T>): boolean;
    // statement.rs:294 (lane mir-body-b)
    is_downcast_to<V, T>(self: ProjectionElem<V, T>, v: VariantIdx): boolean;
    // statement.rs:299 (lane mir-body-b)
    is_field_to<V, T>(self: ProjectionElem<V, T>, f: FieldIdx): boolean;
    // statement.rs:304 (lane mir-body-b)
    can_use_in_debuginfo<V, T>(self: ProjectionElem<V, T>): boolean;
    // statement.rs:322 (lane mir-body-b)
    kind<V, T>(self: ProjectionElem<V, T>): ProjectionKind;
    // statement.rs:327 (lane mir-body-b)
    try_map<V, T, V2, T2>(self: ProjectionElem<V, T>, v: (a0: V) => V2 | undefined, t: (a0: T) => T2): ProjectionElem<V2, T2> | undefined;
  }
}

declare module "./syntax.gen.ts" {
  namespace Place {
    // statement.rs:370 (lane mir-body-b)
    export function return_place(): Place;
    // statement.rs:456 (lane mir-body-b)
    export function ty_from(local: Local, projection: readonly PlaceElem[], local_decls: HasLocalDecls, tcx: TyCtxt): PlaceTy;
  }
}

declare module "./syntax.gen.ts" {
  interface Place {
    // statement.rs:378 (lane mir-body-b)
    is_indirect(): boolean;
    // statement.rs:384 (lane mir-body-b)
    is_stable_offset(): boolean;
    // statement.rs:393 (lane mir-body-b)
    is_indirect_first_projection(): boolean;
    // statement.rs:400 (lane mir-body-b)
    local_or_deref_local(): Local | undefined;
    // statement.rs:407 (lane mir-body-b)
    as_local(): Local | undefined;
    // statement.rs:412 (lane mir-body-b)
    as_ref(): PlaceRef;
    // statement.rs:424 (lane mir-body-b)
    iter_projections(): readonly [PlaceRef, PlaceElem][];
    // statement.rs:432 (lane mir-body-b)
    project_deeper(more_projections: readonly PlaceElem[], tcx: TyCtxt): Place;
    // statement.rs:443 (lane mir-body-b)
    project_to_field(idx: FieldIdx, local_decls: HasLocalDecls, tcx: TyCtxt): Place;
    // statement.rs:470 (lane mir-body-b)
    ty(local_decls: HasLocalDecls, tcx: TyCtxt): PlaceTy;
  }
}

declare module "./statement.gen.ts" {
  interface PlaceRef {
    // statement.rs:486 (lane mir-body-b)
    is_prefix_of(other: PlaceRef): boolean;
    // statement.rs:494 (lane mir-body-b)
    local_or_deref_local(): Local | undefined;
    // statement.rs:509 (lane mir-body-b)
    is_indirect(): boolean;
    // statement.rs:518 (lane mir-body-b)
    is_indirect_first_projection(): boolean;
    // statement.rs:529 (lane mir-body-b)
    as_local(): Local | undefined;
    // statement.rs:537 (lane mir-body-b)
    to_place(tcx: TyCtxt): Place;
    // statement.rs:542 (lane mir-body-b)
    last_projection(): [PlaceRef, PlaceElem] | undefined;
    // statement.rs:558 (lane mir-body-b)
    iter_projections(): readonly [PlaceRef, PlaceElem][];
    // statement.rs:568 (lane mir-body-b)
    accessed_locals(): IterableIterator<Local>;
    // statement.rs:584 (lane mir-body-b)
    project_deeper(more_projections: readonly PlaceElem[], tcx: TyCtxt): Place;
    // statement.rs:603 (lane mir-body-b)
    ty(local_decls: HasLocalDecls, tcx: TyCtxt): PlaceTy;
  }
}

declare module "./syntax.ts" {
  interface Operand_methods {
    // statement.rs:625 (lane mir-body-b)
    function_handle(tcx: TyCtxt, def_id: DefId, args: Iterable<GenericArg>, span: Span): Operand;
    // statement.rs:639 (lane mir-body-b)
    unevaluated_constant(tcx: TyCtxt, def_id: DefId, args: Iterable<GenericArg>, span: Span): Operand;
    // statement.rs:650 (lane mir-body-b)
    zero_sized_constant(ty: Ty, span: Span): Operand;
    // statement.rs:655 (lane mir-body-b)
    is_move(self: Operand): boolean;
    // statement.rs:661 (lane mir-body-b)
    const_from_scalar(tcx: TyCtxt, ty: Ty, val: Scalar, span: Span): Operand;
    // statement.rs:686 (lane mir-body-b)
    to_copy(self: Operand): Operand;
    // statement.rs:695 (lane mir-body-b)
    place(self: Operand): Place | undefined;
    // statement.rs:704 (lane mir-body-b)
    constant(self: Operand): ConstOperand | undefined;
    // statement.rs:715 (lane mir-body-b)
    const_fn_def(self: Operand): [DefId, GenericArgsRef] | undefined;
    // statement.rs:724 (lane mir-body-b)
    ty(self: Operand, local_decls: HasLocalDecls, tcx: TyCtxt): Ty;
    // statement.rs:735 (lane mir-body-b)
    span(self: Operand, local_decls: HasLocalDecls): Span;
  }
}

declare module "./syntax.gen.ts" {
  interface ConstOperand {
    // statement.rs:751 (lane mir-body-b)
    check_static_ptr(tcx: TyCtxt): DefId | undefined;
    // statement.rs:765 (lane mir-body-b)
    ty(): Ty;
  }
}

declare module "./syntax.ts" {
  interface Rvalue_methods {
    // statement.rs:776 (lane mir-body-b)
    is_safe_to_remove(self: Rvalue): boolean;
    // statement.rs:815 (lane mir-body-b)
    is_generic_reborrow(self: Rvalue): boolean;
    // statement.rs:819 (lane mir-body-b)
    ty(self: Rvalue, local_decls: HasLocalDecls, tcx: TyCtxt): Ty;
  }
}

declare module "./syntax.ts" {
  interface BorrowKind_methods {
    // statement.rs:871 (lane mir-body-b)
    mutability(self: BorrowKind): Mutability;
    // statement.rs:880 (lane mir-body-b)
    is_two_phase_borrow(self: BorrowKind): boolean;
    // statement.rs:891 (lane mir-body-b)
    to_mutbl_lossy(self: BorrowKind): Mutability;
  }
}

declare module "./syntax.ts" {
  interface UnOp_methods {
    // statement.rs:904 (lane mir-body-b)
    ty(self: UnOp, tcx: TyCtxt, arg_ty: Ty): Ty;
  }
}

declare module "./syntax.ts" {
  interface BinOp_methods {
    // statement.rs:913 (lane mir-body-b)
    ty(self: BinOp, tcx: TyCtxt, lhs_ty: Ty, rhs_ty: Ty): Ty;
    // statement.rs:953 (lane mir-body-b)
    to_hir_binop(self: BinOp): BinOpKind;
    // statement.rs:987 (lane mir-body-b)
    overflowing_to_wrapping(self: BinOp): BinOp | undefined;
    // statement.rs:997 (lane mir-body-b)
    is_overflowing(self: BinOp): boolean;
    // statement.rs:1002 (lane mir-body-b)
    wrapping_to_overflowing(self: BinOp): BinOp | undefined;
  }
}

declare module "./syntax.ts" {
  interface RawPtrKind_methods {
    // statement.rs:1022 (lane mir-body-b)
    is_fake(self: RawPtrKind): boolean;
    // statement.rs:1029 (lane mir-body-b)
    to_mutbl_lossy(self: RawPtrKind): Mutability;
    // statement.rs:1040 (lane mir-body-b)
    ptr_str(self: RawPtrKind): string;
  }
}

declare module "./statement.gen.ts" {
  interface StmtDebugInfos {
    // statement.rs:1060 (lane mir-body-b)
    push(debuginfo: StmtDebugInfo): void;
    // statement.rs:1064 (lane mir-body-b)
    drop_debuginfo(): void;
    // statement.rs:1072 (lane mir-body-b)
    is_empty(): boolean;
    // statement.rs:1079 (lane mir-body-b)
    prepend(debuginfos: StmtDebugInfos): void;
    // statement.rs:1089 (lane mir-body-b)
    append(debuginfos: StmtDebugInfos): void;
    // statement.rs:1096 (lane mir-body-b)
    extend(debuginfos: StmtDebugInfos): void;
    // statement.rs:1104 (lane mir-body-b)
    as_slice(): readonly StmtDebugInfo[];
    // statement.rs:1112 (lane mir-body-b)
    as_mut_slice(): StmtDebugInfo[];
    // statement.rs:1119 (lane mir-body-b)
    retain_locals(locals: DenseBitSet<Local>): void;
    // statement.rs:1137 (lane mir-body-b) impl ops::Deref
    deref(): readonly StmtDebugInfo[];
    // statement.rs:1144 (lane mir-body-b) impl ops::DerefMut
    deref_mut(): StmtDebugInfo[];
  }
}

// rustc: compiler/rustc_middle/src/mir/statement.rs:32 make_nop
Statement.prototype.make_nop = function (this: Statement, drop_debuginfo: boolean): void {
  if (this.kind.$ === "Nop") {
    return;
  }
  // std::mem::replace(&mut self.kind, StatementKind::Nop)
  const replaced_stmt = this.kind;
  this.kind = StatementKind.Nop;
  if (!drop_debuginfo) {
    const debuginfo = StatementKind.as_debuginfo(replaced_stmt);
    if (debuginfo === undefined) {
      bug("debuginfo is not yet supported.");
    }
    this.debuginfos.push(debuginfo);
  }
};

// rustc: compiler/rustc_middle/src/mir/statement.rs:45 new
(Statement as unknown as { new: typeof Statement.new }).new = function (source_info: SourceInfo, kind: StatementKind): Statement {
  return new Statement(source_info, kind, new StmtDebugInfos(undefined));
};

/// Returns a simple string representation of a `StatementKind` variant, independent of any
/// values it might hold (e.g. `StatementKind::Assign` always returns `"Assign"`).
// rustc: compiler/rustc_middle/src/mir/statement.rs:53 name
StatementKind.name = function (self: StatementKind): string {
  switch (self.$) {
    case "Assign":
      return "Assign";
    case "FakeRead":
      return "FakeRead";
    case "SetDiscriminant":
      return "SetDiscriminant";
    case "StorageLive":
      return "StorageLive";
    case "StorageDead":
      return "StorageDead";
    case "PlaceMention":
      return "PlaceMention";
    case "AscribeUserType":
      return "AscribeUserType";
    case "Coverage":
      return "Coverage";
    case "Intrinsic":
      return "Intrinsic";
    case "ConstEvalCounter":
      return "ConstEvalCounter";
    case "Nop":
      return "Nop";
    case "BackwardIncompatibleDropHint":
      return "BackwardIncompatibleDropHint";
  }
};

// rustc: compiler/rustc_middle/src/mir/statement.rs:69 as_assign_mut
StatementKind.as_assign_mut = function (self: StatementKind): [Place, Rvalue] | undefined {
  switch (self.$) {
    case "Assign":
      return self._0;
    default:
      return undefined;
  }
};

// rustc: compiler/rustc_middle/src/mir/statement.rs:76 as_assign
StatementKind.as_assign = function (self: StatementKind): [Place, Rvalue] | undefined {
  switch (self.$) {
    case "Assign":
      return self._0;
    default:
      return undefined;
  }
};

// rustc: compiler/rustc_middle/src/mir/statement.rs:83 as_debuginfo
StatementKind.as_debuginfo = function (self: StatementKind): StmtDebugInfo | undefined {
  if (self.$ === "Assign" && self._0[1].$ === "Ref") {
    const [place, rv] = self._0;
    const local = place.as_local();
    if (local !== undefined) {
      return { $: "AssignRef", _0: local, _1: clone_Place(rv._2) };
    }
  }
  return undefined;
};

///////////////////////////////////////////////////////////////////////////
// Places

// #[inline]
// rustc: compiler/rustc_middle/src/mir/statement.rs:111 from_ty
(PlaceTy as unknown as { from_ty: typeof PlaceTy.from_ty }).from_ty = function (ty: Ty): PlaceTy {
  return new PlaceTy(ty, undefined);
};

/// `place_ty.field_ty(tcx, f)` computes the type of a given field.
///
/// Most clients of `PlaceTy` can instead just extract the relevant type
/// directly from their `PlaceElem`, but some instances of `ProjectionElem<V, T>`
/// do not carry a `Ty` for `T`.
///
/// Note that the resulting type has not been normalized.
// #[instrument(level = "debug", skip(tcx), ret)]
// rustc: compiler/rustc_middle/src/mir/statement.rs:123 field_ty
(PlaceTy as unknown as { field_ty: typeof PlaceTy.field_ty }).field_ty = function (tcx: TyCtxt, self_ty: Ty, variant_idx: VariantIdx | undefined, f: FieldIdx): Unnormalized<Ty> {
  if (variant_idx !== undefined) {
    const variant_index = variant_idx;
    const k = self_ty.kind();
    if (k.$ === "Adt" && k._0.is_enum()) {
      const [adt_def, args] = [k._0, k._1];
      return adt_def.variant(variant_index).fields[f]!.ty(tcx, args);
    } else if (k.$ === "Coroutine") {
      const [def_id, args] = [k._0, k._1];
      const variants = sty().CoroutineArgsExt.state_tys(args.as_coroutine(), def_id, tcx);
      const variant = iter_nth(variants, variant_index);
      if (variant === undefined) {
        bug(`variant ${VariantIdx.debug(variant_index, PLAIN)} of coroutine out of range: ${debug_Ty(self_ty, PLAIN)}`);
      }

      const t = iter_nth(variant, f);
      return Unnormalized.new_wip(
        t !== undefined
          ? t
          : bug(`field ${FieldIdx.debug(f, PLAIN)} out of range of variant: ${debug_Ty(self_ty, PLAIN)} ${debug_option(variant_idx, PLAIN, VariantIdx.debug)}`),
      );
    } else {
      return bug(`can't downcast non-adt non-coroutine type: ${debug_Ty(self_ty, PLAIN)}`);
    }
  } else {
    const k = self_ty.kind();
    if (k.$ === "Adt" && !k._0.is_enum()) {
      const [adt_def, args] = [k._0, k._1];
      return adt_def.non_enum_variant().fields[f]!.ty(tcx, args);
    } else if (k.$ === "Closure") {
      const t = ClosureArgs.upvar_tys(k._1.as_closure())[f];
      return Unnormalized.dummy(t !== undefined ? t : bug(`field ${FieldIdx.debug(f, PLAIN)} out of range: ${debug_Ty(self_ty, PLAIN)}`));
    } else if (k.$ === "CoroutineClosure") {
      const t = CoroutineClosureArgs.upvar_tys(k._1.as_coroutine_closure())[f];
      return Unnormalized.dummy(t !== undefined ? t : bug(`field ${FieldIdx.debug(f, PLAIN)} out of range: ${debug_Ty(self_ty, PLAIN)}`));
    } else if (k.$ === "Coroutine") {
      // Only upvars are accessible without a variant index.
      const t = CoroutineArgs.upvar_tys(k._1.as_coroutine())[f];
      return Unnormalized.dummy(
        t !== undefined ? t : bug(`field ${FieldIdx.debug(f, PLAIN)} out of range of prefixes for ${print_pretty().display_Ty(self_ty)}`),
      );
    } else if (k.$ === "Tuple") {
      const t = k._0[f];
      return Unnormalized.dummy(t !== undefined ? t : bug(`field ${FieldIdx.debug(f, PLAIN)} out of range: ${debug_Ty(self_ty, PLAIN)}`));
    } else {
      return bug(`can't project out of ${debug_Ty(self_ty, PLAIN)}`);
    }
  }
};

// rustc: compiler/rustc_middle/src/mir/statement.rs:181 multi_projection_ty
PlaceTy.prototype.multi_projection_ty = function (this: PlaceTy, tcx: TyCtxt, elems: readonly PlaceElem[]): PlaceTy {
  let place_ty: PlaceTy = this;
  for (const elem of elems) place_ty = place_ty.projection_ty(tcx, elem, debug_Local);
  return place_ty;
};

/// Convenience wrapper around `projection_ty_core` for `PlaceElem`,
/// where we can just use the `Ty` that is already stored inline on
/// field projection elems.
// rustc: compiler/rustc_middle/src/mir/statement.rs:192 projection_ty
PlaceTy.prototype.projection_ty = function <V>(this: PlaceTy, tcx: TyCtxt, elem: ProjectionElem<V, Ty>, debug_V: Debug<V>): PlaceTy {
  void debug_V;
  return this.projection_ty_core(
    tcx,
    elem,
    (_a, _b, _c, ty) => ty,
    (ty) => ty,
  );
};

/// `place_ty.projection_ty_core(tcx, elem, |...| { ... })`
/// projects `place_ty` onto `elem`, returning the appropriate
/// `Ty` or downcast variant corresponding to that projection.
/// The `handle_field` callback must map a `FieldIdx` to its `Ty`,
/// (which should be trivial when `T` = `Ty`).
// #[instrument(level = "debug", skip(tcx, handle_field, handle_opaque_cast_and_subtype), ret)]
// rustc: compiler/rustc_middle/src/mir/statement.rs:206 projection_ty_core
PlaceTy.prototype.projection_ty_core = function <V, T>(this: PlaceTy, tcx: TyCtxt, elem: ProjectionElem<V, T>, handle_field: (a0: Ty, a1: VariantIdx | undefined, a2: FieldIdx, a3: T) => Ty, handle_opaque_cast_and_subtype: (a0: T) => Ty): PlaceTy {
  if (this.variant_index !== undefined && !(elem.$ === "Field")) {
    bug("cannot use non field projection on downcasted place");
  }
  switch (elem.$) {
    case "Deref": {
      const ty = this.ty.builtin_deref(true);
      if (ty === undefined) {
        bug(`deref projection of non-dereferenceable ty ${debug_PlaceTy(this, PLAIN)}`);
      }
      return PlaceTy.from_ty(ty);
    }
    case "PhantomDeref":
      return PlaceTy.from_ty(this.ty);
    case "Index":
    case "ConstantIndex":
      return PlaceTy.from_ty(unwrap(this.ty.builtin_index()));
    case "Subslice": {
      const { from, to, from_end } = elem;
      const k = this.ty.kind();
      let ty: Ty;
      if (k.$ === "Slice") {
        ty = this.ty;
      } else if (k.$ === "Array" && !from_end) {
        ty = Ty.new_array(tcx, k._0, to - from);
      } else if (k.$ === "Array" && from_end) {
        const size = unwrap(k._1.try_to_target_usize(tcx), "expected subslice projection on fixed-size array");
        const len = size - BigInt(from) - BigInt(to);
        ty = Ty.new_array(tcx, k._0, u64_to_number(len, "Ty::new_array"));
      } else {
        ty = bug(`cannot subslice non-array type: \`${debug_PlaceTy(this, PLAIN)}\``);
      }
      return PlaceTy.from_ty(ty);
    }
    case "Downcast": {
      const index = elem._1;
      return new PlaceTy(this.ty, index);
    }
    case "Field": {
      const [f, fty] = [elem._0, elem._1];
      return PlaceTy.from_ty(handle_field(this.ty, this.variant_index, f, fty));
    }
    case "OpaqueCast":
      return PlaceTy.from_ty(handle_opaque_cast_and_subtype(elem._0));

    // FIXME(unsafe_binders): Rename `handle_opaque_cast_and_subtype` to be more general.
    case "UnwrapUnsafeBinder":
      return PlaceTy.from_ty(handle_opaque_cast_and_subtype(elem._0));
  }
};

/// Returns `true` if the target of this projection may refer to a different region of memory
/// than the base.
// rustc: compiler/rustc_middle/src/mir/statement.rs:264 is_indirect
ProjectionElem.is_indirect = function <V, T>(self: ProjectionElem<V, T>): boolean {
  switch (self.$) {
    case "Deref":
    case "PhantomDeref":
      return true;

    case "Field":
    case "Index":
    case "OpaqueCast":
    case "ConstantIndex":
    case "Subslice":
    case "Downcast":
    case "UnwrapUnsafeBinder":
      return false;
  }
};

/// Returns `true` if the target of this projection always refers to the same memory region
/// whatever the state of the program.
// rustc: compiler/rustc_middle/src/mir/statement.rs:280 is_stable_offset
ProjectionElem.is_stable_offset = function <V, T>(self: ProjectionElem<V, T>): boolean {
  switch (self.$) {
    case "Deref":
    case "Index":
      return false;
    case "Field":
    case "OpaqueCast":
    case "ConstantIndex":
    case "Subslice":
    case "Downcast":
    case "UnwrapUnsafeBinder":
    case "PhantomDeref":
      return true;
  }
};

/// Returns `true` if this is a `Downcast` projection with the given `VariantIdx`.
// rustc: compiler/rustc_middle/src/mir/statement.rs:294 is_downcast_to
ProjectionElem.is_downcast_to = function <V, T>(self: ProjectionElem<V, T>, v: VariantIdx): boolean {
  return self.$ === "Downcast" && self._1 === v;
};

/// Returns `true` if this is a `Field` projection with the given index.
// rustc: compiler/rustc_middle/src/mir/statement.rs:299 is_field_to
ProjectionElem.is_field_to = function <V, T>(self: ProjectionElem<V, T>, f: FieldIdx): boolean {
  return self.$ === "Field" && self._0 === f;
};

/// Returns `true` if this is accepted inside `VarDebugInfoContents::Place`.
// rustc: compiler/rustc_middle/src/mir/statement.rs:304 can_use_in_debuginfo
ProjectionElem.can_use_in_debuginfo = function <V, T>(self: ProjectionElem<V, T>): boolean {
  switch (self.$) {
    case "ConstantIndex":
      return !self.from_end;
    case "Deref":
    case "Downcast":
    case "Field":
      return true;
    case "Index":
    case "OpaqueCast":
    case "Subslice":
    case "PhantomDeref":
      return false;

    // FIXME(unsafe_binders): Figure this out.
    case "UnwrapUnsafeBinder":
      return false;
  }
};

/// Returns the `ProjectionKind` associated to this projection.
// rustc: compiler/rustc_middle/src/mir/statement.rs:322 kind
ProjectionElem.kind = function <V, T>(self: ProjectionElem<V, T>): ProjectionKind {
  return unwrap(
    ProjectionElem.try_map<V, T, null, null>(
      self,
      (_) => null,
      (_) => null,
    ),
  );
};

/// Apply functions to types and values in this projection and return the result.
// PORT: `V2 = ()` maps to `null`, so `v` returning `None` is `undefined` (never a valid `V2`).
// rustc: compiler/rustc_middle/src/mir/statement.rs:327 try_map
ProjectionElem.try_map = function <V, T, V2, T2>(self: ProjectionElem<V, T>, v: (a0: V) => V2 | undefined, t: (a0: T) => T2): ProjectionElem<V2, T2> | undefined {
  switch (self.$) {
    case "Deref":
      return ProjectionElem.Deref;
    case "PhantomDeref":
      return bug("PhantomDeref shouldn't hopefully come here");
    case "Downcast":
      return { $: "Downcast", _0: self._0, _1: self._1 };
    case "Field":
      return { $: "Field", _0: self._0, _1: t(self._1) };
    case "ConstantIndex":
      return { $: "ConstantIndex", offset: self.offset, min_length: self.min_length, from_end: self.from_end };
    case "Subslice":
      return { $: "Subslice", from: self.from, to: self.to, from_end: self.from_end };
    case "OpaqueCast":
      return { $: "OpaqueCast", _0: t(self._0) };
    case "UnwrapUnsafeBinder":
      return { $: "UnwrapUnsafeBinder", _0: t(self._0) };
    case "Index": {
      const val = v(self._0);
      if (val === undefined) return undefined;
      return { $: "Index", _0: val };
    }
  }
};

// FIXME change this to a const fn by also making List::empty a const fn.
// rustc: compiler/rustc_middle/src/mir/statement.rs:370 return_place
(Place as unknown as { return_place: typeof Place.return_place }).return_place = function (): Place {
  return new Place(RETURN_PLACE, RawList.empty<PlaceElem>());
};

/// Returns `true` if this `Place` contains a `Deref` projection.
///
/// If `Place::is_indirect` returns false, the caller knows that the `Place` refers to the
/// same region of memory as its base.
// rustc: compiler/rustc_middle/src/mir/statement.rs:378 is_indirect
Place.prototype.is_indirect = function (this: Place): boolean {
  return this.projection.some((elem) => ProjectionElem.is_indirect(elem));
};

/// Returns `true` if the `Place` always refers to the same memory region
/// whatever the state of the program.
// rustc: compiler/rustc_middle/src/mir/statement.rs:384 is_stable_offset
Place.prototype.is_stable_offset = function (this: Place): boolean {
  return this.projection.every((elem) => ProjectionElem.is_stable_offset(elem));
};

/// Returns `true` if this `Place`'s first projection is `Deref`.
///
/// This is useful because for MIR phases `AnalysisPhase::PostCleanup` and later,
/// `Deref` projections can only occur as the first projection. In that case this method
/// is equivalent to `is_indirect`, but faster.
// rustc: compiler/rustc_middle/src/mir/statement.rs:393 is_indirect_first_projection
Place.prototype.is_indirect_first_projection = function (this: Place): boolean {
  return this.as_ref().is_indirect_first_projection();
};

/// Finds the innermost `Local` from this `Place`, *if* it is either a local itself or
/// a single deref of a local.
// #[inline(always)]
// rustc: compiler/rustc_middle/src/mir/statement.rs:400 local_or_deref_local
Place.prototype.local_or_deref_local = function (this: Place): Local | undefined {
  return this.as_ref().local_or_deref_local();
};

/// If this place represents a local variable like `_X` with no
/// projections, return `Some(_X)`.
// #[inline(always)]
// rustc: compiler/rustc_middle/src/mir/statement.rs:407 as_local
Place.prototype.as_local = function (this: Place): Local | undefined {
  return this.as_ref().as_local();
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/statement.rs:412 as_ref
Place.prototype.as_ref = function (this: Place): PlaceRef {
  return new PlaceRef(this.local, this.projection);
};

/// Iterate over the projections in evaluation order, i.e., the first element is the base with
/// its projection and then subsequently more projections are added.
/// As a concrete example, given the place a.b.c, this would yield:
/// - (a, .b)
/// - (a.b, .c)
///
/// Given a place without projections, the iterator is empty.
// #[inline]
// rustc: compiler/rustc_middle/src/mir/statement.rs:424 iter_projections
Place.prototype.iter_projections = function (this: Place): readonly [PlaceRef, PlaceElem][] {
  return this.as_ref().iter_projections();
};

/// Generates a new place by appending `more_projections` to the existing ones
/// and interning the result.
// rustc: compiler/rustc_middle/src/mir/statement.rs:432 project_deeper
Place.prototype.project_deeper = function (this: Place, more_projections: readonly PlaceElem[], tcx: TyCtxt): Place {
  if (more_projections.length === 0) {
    // PORT: `self` is a copy of the caller's place (PORTING §8 clone rule).
    return clone_Place(this);
  }

  return this.as_ref().project_deeper(more_projections, tcx);
};

/// Return a place that projects to a field of the current place.
///
/// The type of the current place must be an ADT.
// rustc: compiler/rustc_middle/src/mir/statement.rs:443 project_to_field
Place.prototype.project_to_field = function (this: Place, idx: FieldIdx, local_decls: HasLocalDecls, tcx: TyCtxt): Place {
  const ty = this.ty(local_decls, tcx).ty;
  const k = ty.kind();
  if (k.$ !== "Adt") return panic(`projecting to field of non-ADT ${print_pretty().display_Ty(ty)}`);
  const [adt, args] = [k._0, k._1];
  const field = adt.non_enum_variant().fields[idx]!;
  const field_ty = Unnormalized.skip_norm_wip(field.ty(tcx, args));
  return this.project_deeper([{ $: "Field", _0: idx, _1: field_ty }], tcx);
};

// rustc: compiler/rustc_middle/src/mir/statement.rs:456 ty_from
(Place as unknown as { ty_from: typeof Place.ty_from }).ty_from = function (local: Local, projection: readonly PlaceElem[], local_decls: HasLocalDecls, tcx: TyCtxt): PlaceTy {
  // If there's a field projection element in `projection`, we *could* skip everything
  // before that, but on 2026-01-31 a perf experiment showed no benefit from doing so.
  return PlaceTy.from_ty(HasLocalDecls.local_decls(local_decls)[local]!.ty).multi_projection_ty(tcx, projection);
};

// rustc: compiler/rustc_middle/src/mir/statement.rs:470 ty
Place.prototype.ty = function (this: Place, local_decls: HasLocalDecls, tcx: TyCtxt): PlaceTy {
  return Place.ty_from(this.local, this.projection, local_decls, tcx);
};

// impl From<Local> for Place<'_>
// #[inline]
// rustc: compiler/rustc_middle/src/mir/statement.rs:480 from
export function Place_from_Local(local: Local): Place {
  return new Place(local, RawList.empty<PlaceElem>());
}

// rustc: compiler/rustc_middle/src/mir/statement.rs:486 is_prefix_of
PlaceRef.prototype.is_prefix_of = function (this: PlaceRef, other: PlaceRef): boolean {
  return (
    this.local === other.local &&
    this.projection.length <= other.projection.length &&
    slice_eq_PlaceElem(this.projection, other.projection.slice(0, this.projection.length))
  );
};

/// Finds the innermost `Local` from this `Place`, *if* it is either a local itself or
/// a single deref of a local.
// rustc: compiler/rustc_middle/src/mir/statement.rs:494 local_or_deref_local
PlaceRef.prototype.local_or_deref_local = function (this: PlaceRef): Local | undefined {
  const projection = this.projection;
  if (projection.length === 0 || (projection.length === 1 && (projection[0]!.$ === "Deref" || projection[0]!.$ === "PhantomDeref"))) {
    return this.local;
  }
  return undefined;
};

/// Returns `true` if this `Place` contains a `Deref` projection.
///
/// If `Place::is_indirect` returns false, the caller knows that the `Place` refers to the
/// same region of memory as its base.
// rustc: compiler/rustc_middle/src/mir/statement.rs:509 is_indirect
PlaceRef.prototype.is_indirect = function (this: PlaceRef): boolean {
  return this.projection.some((elem) => ProjectionElem.is_indirect(elem));
};

/// Returns `true` if this `Place`'s first projection is `Deref`.
///
/// This is useful because for MIR phases `AnalysisPhase::PostCleanup` and later,
/// `Deref` projections can only occur as the first projection. In that case this method
/// is equivalent to `is_indirect`, but faster.
// rustc: compiler/rustc_middle/src/mir/statement.rs:518 is_indirect_first_projection
PlaceRef.prototype.is_indirect_first_projection = function (this: PlaceRef): boolean {
  // To make sure this is not accidentally used in wrong mir phase
  // debug_assert!(
  //     self.projection.is_empty() || !self.projection[1..].contains(&PlaceElem::Deref)
  // );
  return this.projection[0]?.$ === "Deref";
};

/// If this place represents a local variable like `_X` with no
/// projections, return `Some(_X)`.
// #[inline]
// rustc: compiler/rustc_middle/src/mir/statement.rs:529 as_local
PlaceRef.prototype.as_local = function (this: PlaceRef): Local | undefined {
  if (this.projection.length === 0) return this.local;
  return undefined;
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/statement.rs:537 to_place
PlaceRef.prototype.to_place = function (this: PlaceRef, tcx: TyCtxt): Place {
  return new Place(this.local, tcx.mk_place_elems(this.projection));
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/statement.rs:542 last_projection
PlaceRef.prototype.last_projection = function (this: PlaceRef): [PlaceRef, PlaceElem] | undefined {
  const n = this.projection.length;
  if (n > 0) {
    const proj_base = this.projection.slice(0, n - 1);
    const elem = this.projection[n - 1]!;
    return [new PlaceRef(this.local, proj_base), elem];
  } else {
    return undefined;
  }
};

/// Iterate over the projections in evaluation order, i.e., the first element is the base with
/// its projection and then subsequently more projections are added.
/// As a concrete example, given the place a.b.c, this would yield:
/// - (a, .b)
/// - (a.b, .c)
///
/// Given a place without projections, the iterator is empty.
// #[inline]
// rustc: compiler/rustc_middle/src/mir/statement.rs:558 iter_projections
PlaceRef.prototype.iter_projections = function (this: PlaceRef): readonly [PlaceRef, PlaceElem][] {
  return this.projection.map((proj, i): [PlaceRef, PlaceElem] => {
    const base = new PlaceRef(this.local, this.projection.slice(0, i));
    return [base, proj];
  });
};

/// Return the place accessed locals that include the base local.
// rustc: compiler/rustc_middle/src/mir/statement.rs:568 accessed_locals
PlaceRef.prototype.accessed_locals = function* (this: PlaceRef): IterableIterator<Local> {
  yield this.local;
  for (const proj of this.projection) {
    switch (proj.$) {
      case "Index":
        yield proj._0;
        break;
      case "Deref":
      case "PhantomDeref":
      case "Field":
      case "ConstantIndex":
      case "Subslice":
      case "Downcast":
      case "OpaqueCast":
      case "UnwrapUnsafeBinder":
        break;
    }
  }
};

/// Generates a new place by appending `more_projections` to the existing ones
/// and interning the result.
// rustc: compiler/rustc_middle/src/mir/statement.rs:584 project_deeper
PlaceRef.prototype.project_deeper = function (this: PlaceRef, more_projections: readonly PlaceElem[], tcx: TyCtxt): Place {
  let new_projections: readonly PlaceElem[];
  if (this.projection.length === 0) {
    new_projections = more_projections;
  } else {
    const v: PlaceElem[] = [];
    v.push(...this.projection);
    v.push(...more_projections);
    new_projections = v;
  }

  return new Place(this.local, tcx.mk_place_elems(new_projections));
};

// rustc: compiler/rustc_middle/src/mir/statement.rs:603 ty
PlaceRef.prototype.ty = function (this: PlaceRef, local_decls: HasLocalDecls, tcx: TyCtxt): PlaceTy {
  return Place.ty_from(this.local, this.projection, local_decls, tcx);
};

// impl From<Local> for PlaceRef<'_>
// #[inline]
// rustc: compiler/rustc_middle/src/mir/statement.rs:613 from
export function PlaceRef_from_Local(local: Local): PlaceRef {
  return new PlaceRef(local, []);
}

///////////////////////////////////////////////////////////////////////////
// Operands

/// Convenience helper to make a constant that refers to the fn
/// with given `DefId` and args. Since this is used to synthesize
/// MIR, assumes `user_ty` is None.
// rustc: compiler/rustc_middle/src/mir/statement.rs:625 function_handle
Operand.function_handle = function (tcx: TyCtxt, def_id: DefId, args: Iterable<GenericArg>, span: Span): Operand {
  return Operand.zero_sized_constant(
    Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.type_of(def_id) as EarlyBinder<Ty>, tcx, [...args], fold_Ty)),
    span,
  );
};

/// Convenience helper to make a constant that refers to the given `DefId` and args. Since this
/// is used to synthesize MIR, assumes `user_ty` is None.
// rustc: compiler/rustc_middle/src/mir/statement.rs:639 unevaluated_constant
Operand.unevaluated_constant = function (tcx: TyCtxt, def_id: DefId, args: Iterable<GenericArg>, span: Span): Operand {
  const const_ = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(Const.from_unevaluated(tcx, def_id), tcx, [...args], fold_mir_Const));
  return { $: "Constant", _0: new ConstOperand(span, undefined, const_) };
};

/// Convenience helper to make a constant that refers to a zero-sized type.
// rustc: compiler/rustc_middle/src/mir/statement.rs:650 zero_sized_constant
Operand.zero_sized_constant = function (ty: Ty, span: Span): Operand {
  const const_: Const = { $: "Val", _0: ConstValue.ZeroSized, _1: ty };
  return { $: "Constant", _0: new ConstOperand(span, undefined, const_) };
};

// rustc: compiler/rustc_middle/src/mir/statement.rs:655 is_move
Operand.is_move = function (self: Operand): boolean {
  return self.$ === "Move";
};

/// Convenience helper to make a literal-like constant from a given scalar value.
/// Since this is used to synthesize MIR, assumes `user_ty` is None.
// rustc: compiler/rustc_middle/src/mir/statement.rs:661 const_from_scalar
Operand.const_from_scalar = function (tcx: TyCtxt, ty: Ty, val: Scalar, span: Span): Operand {
  void tcx;
  // debug_assert!({
  //     let typing_env = ty::TypingEnv::fully_monomorphized();
  //     let type_size = tcx
  //         .layout_of(typing_env.as_query_input(ty))
  //         .unwrap_or_else(|e| panic!("could not compute layout for {ty:?}: {e:?}"))
  //         .size;
  //     let scalar_size = match val {
  //         Scalar::Int(int) => int.size(),
  //         _ => panic!("Invalid scalar type {val:?}"),
  //     };
  //     scalar_size == type_size
  // });
  return {
    $: "Constant",
    _0: new ConstOperand(span, undefined, { $: "Val", _0: { $: "Scalar", _0: val }, _1: ty }),
  };
};

// rustc: compiler/rustc_middle/src/mir/statement.rs:686 to_copy
Operand.to_copy = function (self: Operand): Operand {
  switch (self.$) {
    case "Copy":
    case "Constant":
    case "RuntimeChecks":
      return clone_Operand(self);
    case "Move":
      return { $: "Copy", _0: clone_Place(self._0) };
  }
};

/// Returns the `Place` that is the target of this `Operand`, or `None` if this `Operand` is a
/// constant.
// rustc: compiler/rustc_middle/src/mir/statement.rs:695 place
Operand.place = function (self: Operand): Place | undefined {
  switch (self.$) {
    case "Copy":
    case "Move":
      return clone_Place(self._0);
    case "Constant":
    case "RuntimeChecks":
      return undefined;
  }
};

/// Returns the `ConstOperand` that is the target of this `Operand`, or `None` if this `Operand` is a
/// place.
// rustc: compiler/rustc_middle/src/mir/statement.rs:704 constant
Operand.constant = function (self: Operand): ConstOperand | undefined {
  switch (self.$) {
    case "Constant":
      return self._0;
    case "Copy":
    case "Move":
    case "RuntimeChecks":
      return undefined;
  }
};

/// Gets the `ty::FnDef` from an operand if it's a constant function item.
///
/// While this is unlikely in general, it's the normal case of what you'll
/// find as the `func` in a [`TerminatorKind::Call`].
// rustc: compiler/rustc_middle/src/mir/statement.rs:715 const_fn_def
Operand.const_fn_def = function (self: Operand): [DefId, GenericArgsRef] | undefined {
  const c = Operand.constant(self);
  if (c === undefined) return undefined;
  const const_ty = Const.ty(c.const_);
  const k = const_ty.kind();
  if (k.$ === "FnDef") {
    return [k._0, unwrap(Binder.no_bound_vars(k._1, fold_GenericArgs))];
  } else {
    return undefined;
  }
};

// rustc: compiler/rustc_middle/src/mir/statement.rs:724 ty
Operand.ty = function (self: Operand, local_decls: HasLocalDecls, tcx: TyCtxt): Ty {
  switch (self.$) {
    case "Copy":
    case "Move":
      return self._0.ty(local_decls, tcx).ty;
    case "Constant":
      return Const.ty(self._0.const_);
    case "RuntimeChecks":
      return tcx.types.bool;
  }
};

// rustc: compiler/rustc_middle/src/mir/statement.rs:735 span
Operand.span = function (self: Operand, local_decls: HasLocalDecls): Span {
  switch (self.$) {
    case "Copy":
    case "Move":
      return HasLocalDecls.local_decls(local_decls)[self._0.local]!.source_info.span;
    case "Constant":
      return self._0.span;
    // User code should not contain this operand, so we should not need this span.
    case "RuntimeChecks":
      return DUMMY_SP;
  }
};

// rustc: compiler/rustc_middle/src/mir/statement.rs:751 check_static_ptr
ConstOperand.prototype.check_static_ptr = function (this: ConstOperand, tcx: TyCtxt): DefId | undefined {
  const s = Const.try_to_scalar(this.const_);
  if (s !== undefined && s.$ === "Ptr") {
    const ptr = s._0;
    const ga = tcx.global_alloc(CtfeProvenance.alloc_id(ptr.provenance));
    if (ga.$ === "Static") {
      const def_id = ga._0;
      assert(!tcx.is_thread_local_static(def_id), "assertion failed: !tcx.is_thread_local_static(def_id)");
      return def_id;
    }
    return undefined;
  }
  return undefined;
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/statement.rs:765 ty
ConstOperand.prototype.ty = function (this: ConstOperand): Ty {
  return Const.ty(this.const_);
};

///////////////////////////////////////////////////////////////////////////
// Rvalues

/// Returns true if rvalue can be safely removed when the result is unused.
// #[inline]
// rustc: compiler/rustc_middle/src/mir/statement.rs:776 is_safe_to_remove
Rvalue.is_safe_to_remove = function (self: Rvalue): boolean {
  switch (self.$) {
    // Pointer to int casts may be side-effects due to exposing the provenance.
    // While the model is undecided, we should be conservative. See
    // <https://www.ralfj.de/blog/2022/04/11/provenance-exposed.html>
    case "Cast":
      switch (self._0.$) {
        case "PointerExposeProvenance":
          return false;
        case "IntToInt":
        case "FloatToInt":
        case "FloatToFloat":
        case "IntToFloat":
        case "FnPtrToPtr":
        case "PtrToPtr":
        case "PointerCoercion":
        case "PointerWithExposedProvenance":
        case "Transmute":
        case "BoxDerefTransmute":
        case "Subtype":
          return true;
      }
      break;

    case "Use":
    case "CopyForDeref":
    case "Repeat":
    case "Ref":
    case "Reborrow":
    case "ThreadLocalRef":
    case "RawPtr":
    case "BinaryOp":
    case "UnaryOp":
    case "Discriminant":
    case "Aggregate":
    case "WrapUnsafeBinder":
      return true;
  }
};

/// Returns true if rvalue is a generic Reborrow coercion (usage of Reborrow or CoerceShared
/// trait).
// rustc: compiler/rustc_middle/src/mir/statement.rs:815 is_generic_reborrow
Rvalue.is_generic_reborrow = function (self: Rvalue): boolean {
  return self.$ === "Reborrow";
};

// rustc: compiler/rustc_middle/src/mir/statement.rs:819 ty
Rvalue.ty = function (self: Rvalue, local_decls: HasLocalDecls, tcx: TyCtxt): Ty {
  switch (self.$) {
    case "Use":
      return Operand.ty(self._0, local_decls, tcx);
    case "Repeat": {
      const [operand, count] = [self._0, self._1];
      return Ty.new_array_with_const_len(tcx, Operand.ty(operand, local_decls, tcx), count);
    }
    case "ThreadLocalRef":
      return tcx.thread_local_ptr_ty(self._0);
    case "Ref": {
      const [reg, bk, place] = [self._0, self._1, self._2];
      const place_ty = place.ty(local_decls, tcx).ty;
      return Ty.new_ref(tcx, reg, place_ty, BorrowKind.to_mutbl_lossy(bk));
    }
    case "Reborrow":
      return self._0;
    case "RawPtr": {
      const [kind, place] = [self._0, self._1];
      const place_ty = place.ty(local_decls, tcx).ty;
      return Ty.new_ptr(tcx, place_ty, RawPtrKind.to_mutbl_lossy(kind));
    }
    case "Cast":
      return self._2;
    case "BinaryOp": {
      const [op, [lhs, rhs]] = [self._0, self._1];
      const lhs_ty = Operand.ty(lhs, local_decls, tcx);
      const rhs_ty = Operand.ty(rhs, local_decls, tcx);
      return BinOp.ty(op, tcx, lhs_ty, rhs_ty);
    }
    case "UnaryOp": {
      const [op, operand] = [self._0, self._1];
      const arg_ty = Operand.ty(operand, local_decls, tcx);
      return UnOp.ty(op, tcx, arg_ty);
    }
    case "Discriminant":
      return self._0.ty(local_decls, tcx).ty.discriminant_ty(tcx);
    case "Aggregate": {
      const [ak, ops] = [self._0, self._1];
      switch (ak.$) {
        case "Array":
          return Ty.new_array(tcx, ak._0, ops.length);
        case "Tuple":
          return Ty.new_tup_from_iter(
            tcx,
            ops.map((op) => Operand.ty(op, local_decls, tcx)),
          );
        case "Adt": {
          const [did, args] = [ak._0, ak._2];
          return Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.type_of(did) as EarlyBinder<Ty>, tcx, args, fold_Ty));
        }
        case "Closure":
          return Ty.new_closure(tcx, ak._0, ak._1);
        case "Coroutine":
          return Ty.new_coroutine(tcx, ak._0, ak._1);
        case "CoroutineClosure":
          return Ty.new_coroutine_closure(tcx, ak._0, ak._1);
        case "RawPtr":
          return Ty.new_ptr(tcx, ak._0, ak._1);
      }
      break;
    }
    case "CopyForDeref":
      return self._0.ty(local_decls, tcx).ty;
    case "WrapUnsafeBinder":
      return self._1;
  }
};

// rustc: compiler/rustc_middle/src/mir/statement.rs:871 mutability
BorrowKind.mutability = function (self: BorrowKind): Mutability {
  switch (self.$) {
    case "Shared":
    case "Fake":
      return "Not";
    case "Mut":
      return "Mut";
  }
};

/// Returns whether borrows represented by this kind are allowed to be split into separate
/// Reservation and Activation phases.
// rustc: compiler/rustc_middle/src/mir/statement.rs:880 is_two_phase_borrow
BorrowKind.is_two_phase_borrow = function (self: BorrowKind): boolean {
  switch (self.$) {
    case "Shared":
    case "Fake":
      return false;
    case "Mut":
      switch (self.kind) {
        case "Default":
        case "ClosureCapture":
          return false;
        case "TwoPhaseBorrow":
          return true;
      }
  }
};

// rustc: compiler/rustc_middle/src/mir/statement.rs:891 to_mutbl_lossy
BorrowKind.to_mutbl_lossy = function (self: BorrowKind): Mutability {
  switch (self.$) {
    case "Mut":
      return "Mut";
    case "Shared":
      return "Not";

    // We have no type corresponding to a shallow borrow, so use
    // `&` as an approximation.
    case "Fake":
      return "Not";
  }
};

// rustc: compiler/rustc_middle/src/mir/statement.rs:904 ty
UnOp.ty = function (self: UnOp, tcx: TyCtxt, arg_ty: Ty): Ty {
  switch (self) {
    case "Not":
    case "Neg":
      return arg_ty;
    case "PtrMetadata":
      return arg_ty.pointee_metadata_ty_or_projection(tcx);
  }
};

// rustc: compiler/rustc_middle/src/mir/statement.rs:913 ty
BinOp.ty = function (self: BinOp, tcx: TyCtxt, lhs_ty: Ty, rhs_ty: Ty): Ty {
  // FIXME: handle SIMD correctly
  switch (self) {
    case "Add":
    case "AddUnchecked":
    case "Sub":
    case "SubUnchecked":
    case "Mul":
    case "MulUnchecked":
    case "Div":
    case "Rem":
    case "BitXor":
    case "BitAnd":
    case "BitOr":
      // these should be integers or floats of the same size.
      assert_eq(lhs_ty, rhs_ty, (t) => debug_Ty(t, PLAIN));
      return lhs_ty;
    case "AddWithOverflow":
    case "SubWithOverflow":
    case "MulWithOverflow":
      // these should be integers of the same size.
      assert_eq(lhs_ty, rhs_ty, (t) => debug_Ty(t, PLAIN));
      return Ty.new_tup(tcx, [lhs_ty, tcx.types.bool]);
    case "Shl":
    case "ShlUnchecked":
    case "Shr":
    case "ShrUnchecked":
    case "Offset":
      return lhs_ty; // lhs_ty can be != rhs_ty
    case "Eq":
    case "Lt":
    case "Le":
    case "Ne":
    case "Ge":
    case "Gt":
      return tcx.types.bool;
    case "Cmp":
      // these should be integer-like types of the same size.
      assert_eq(lhs_ty, rhs_ty, (t) => debug_Ty(t, PLAIN));
      return tcx.ty_ordering_enum(DUMMY_SP);
  }
};

// rustc: compiler/rustc_middle/src/mir/statement.rs:953 to_hir_binop
BinOp.to_hir_binop = function (self: BinOp): BinOpKind {
  switch (self) {
    // HIR `+`/`-`/`*` can map to either of these MIR BinOp, depending
    // on whether overflow checks are enabled or not.
    case "Add":
    case "AddWithOverflow":
      return "Add";
    case "Sub":
    case "SubWithOverflow":
      return "Sub";
    case "Mul":
    case "MulWithOverflow":
      return "Mul";
    case "Div":
      return "Div";
    case "Rem":
      return "Rem";
    case "BitXor":
      return "BitXor";
    case "BitAnd":
      return "BitAnd";
    case "BitOr":
      return "BitOr";
    case "Shl":
      return "Shl";
    case "Shr":
      return "Shr";
    case "Eq":
      return "Eq";
    case "Ne":
      return "Ne";
    case "Lt":
      return "Lt";
    case "Gt":
      return "Gt";
    case "Le":
      return "Le";
    case "Ge":
      return "Ge";
    // We don't have HIR syntax for these.
    case "Cmp":
    case "AddUnchecked":
    case "SubUnchecked":
    case "MulUnchecked":
    case "ShlUnchecked":
    case "ShrUnchecked":
    case "Offset":
      return unreachable();
  }
};

/// If this is a `FooWithOverflow`, return `Some(Foo)`.
// rustc: compiler/rustc_middle/src/mir/statement.rs:987 overflowing_to_wrapping
BinOp.overflowing_to_wrapping = function (self: BinOp): BinOp | undefined {
  switch (self) {
    case "AddWithOverflow":
      return "Add";
    case "SubWithOverflow":
      return "Sub";
    case "MulWithOverflow":
      return "Mul";
    default:
      return undefined;
  }
};

/// Returns whether this is a `FooWithOverflow`
// rustc: compiler/rustc_middle/src/mir/statement.rs:997 is_overflowing
BinOp.is_overflowing = function (self: BinOp): boolean {
  return BinOp.overflowing_to_wrapping(self) !== undefined;
};

/// If this is a `Foo`, return `Some(FooWithOverflow)`.
// rustc: compiler/rustc_middle/src/mir/statement.rs:1002 wrapping_to_overflowing
BinOp.wrapping_to_overflowing = function (self: BinOp): BinOp | undefined {
  switch (self) {
    case "Add":
      return "AddWithOverflow";
    case "Sub":
      return "SubWithOverflow";
    case "Mul":
      return "MulWithOverflow";
    default:
      return undefined;
  }
};

// impl From<Mutability> for RawPtrKind
// rustc: compiler/rustc_middle/src/mir/statement.rs:1013 from
export function RawPtrKind_from_Mutability(other: Mutability): RawPtrKind {
  switch (other) {
    case "Mut":
      return "Mut";
    case "Not":
      return "Const";
  }
}

// rustc: compiler/rustc_middle/src/mir/statement.rs:1022 is_fake
RawPtrKind.is_fake = function (self: RawPtrKind): boolean {
  switch (self) {
    case "Mut":
    case "Const":
      return false;
    case "FakeForPtrMetadata":
      return true;
  }
};

// rustc: compiler/rustc_middle/src/mir/statement.rs:1029 to_mutbl_lossy
RawPtrKind.to_mutbl_lossy = function (self: RawPtrKind): Mutability {
  switch (self) {
    case "Mut":
      return "Mut";
    case "Const":
      return "Not";

    // We have no type corresponding to a fake borrow, so use
    // `*const` as an approximation.
    case "FakeForPtrMetadata":
      return "Not";
  }
};

// rustc: compiler/rustc_middle/src/mir/statement.rs:1040 ptr_str
RawPtrKind.ptr_str = function (self: RawPtrKind): string {
  switch (self) {
    case "Mut":
      return "mut";
    case "Const":
      return "const";
    case "FakeForPtrMetadata":
      return "const (fake)";
  }
};

// This collection is almost always empty, so we
// use thin representation and optimize all methods
// for that by inlining the empty check
// and outlining the rest. Note that Option is
// technically not needed, because empty ThinVec
// points to a static singleton, this version performed
// better in our benchmarks
// PORT: `outline(f)` is `f()` (a codegen hint).

// rustc: compiler/rustc_middle/src/mir/statement.rs:1060 push
StmtDebugInfos.prototype.push = function (this: StmtDebugInfos, debuginfo: StmtDebugInfo): void {
  (this._0 ??= []).push(debuginfo);
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/statement.rs:1064 drop_debuginfo
StmtDebugInfos.prototype.drop_debuginfo = function (this: StmtDebugInfos): void {
  const v = this._0;
  if (v === undefined) {
  } else {
    v.length = 0;
  }
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/statement.rs:1072 is_empty
StmtDebugInfos.prototype.is_empty = function (this: StmtDebugInfos): boolean {
  const v = this._0;
  if (v === undefined) return true;
  return v.length === 0;
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/statement.rs:1079 prepend
StmtDebugInfos.prototype.prepend = function (this: StmtDebugInfos, debuginfos: StmtDebugInfos): void {
  if (debuginfos.is_empty()) {
    return;
  }
  debuginfos.append(this);
  // std::mem::swap(debuginfos, self)
  const tmp = debuginfos._0;
  debuginfos._0 = this._0;
  this._0 = tmp;
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/statement.rs:1089 append
StmtDebugInfos.prototype.append = function (this: StmtDebugInfos, debuginfos: StmtDebugInfos): void {
  if (debuginfos.is_empty()) {
    return;
  }
  // `ThinVec::append` moves every element out of `other`, leaving it empty.
  const other = unwrap(debuginfos._0);
  (this._0 ??= []).push(...other);
  other.length = 0;
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/statement.rs:1096 extend
StmtDebugInfos.prototype.extend = function (this: StmtDebugInfos, debuginfos: StmtDebugInfos): void {
  if (debuginfos.is_empty()) {
    return;
  }
  (this._0 ??= []).push(...debuginfos.as_slice().map(clone_StmtDebugInfo));
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/statement.rs:1104 as_slice
StmtDebugInfos.prototype.as_slice = function (this: StmtDebugInfos): readonly StmtDebugInfo[] {
  const items = this._0;
  if (items === undefined) return [];
  return items;
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/statement.rs:1112 as_mut_slice
StmtDebugInfos.prototype.as_mut_slice = function (this: StmtDebugInfos): StmtDebugInfo[] {
  const items = this._0;
  if (items === undefined) return [];
  return items;
};

// #[inline]
// rustc: compiler/rustc_middle/src/mir/statement.rs:1119 retain_locals
StmtDebugInfos.prototype.retain_locals = function (this: StmtDebugInfos, locals: DenseBitSet<Local>): void {
  const items = this._0;
  if (items === undefined) return;
  let w = 0;
  for (const debuginfo of items) {
    let keep: boolean;
    switch (debuginfo.$) {
      case "AssignRef":
      case "InvalidAssign":
        keep = locals.contains(debuginfo._0);
        break;
    }
    if (keep) items[w++] = debuginfo;
  }
  items.length = w;
};

// impl<'tcx> ops::Deref for StmtDebugInfos<'tcx>
// #[inline]
// rustc: compiler/rustc_middle/src/mir/statement.rs:1137 deref
StmtDebugInfos.prototype.deref = function (this: StmtDebugInfos): readonly StmtDebugInfo[] {
  return this.as_slice();
};

// impl<'tcx> ops::DerefMut for StmtDebugInfos<'tcx>
// #[inline]
// rustc: compiler/rustc_middle/src/mir/statement.rs:1144 deref_mut
StmtDebugInfos.prototype.deref_mut = function (this: StmtDebugInfos): StmtDebugInfo[] {
  return this.as_mut_slice();
};

// ---- helpers (not upstream fns) ----

/** `Iterator::nth` over a JS iterable. */
function iter_nth<T>(it: Iterable<T>, n: number): T | undefined {
  let i = 0;
  for (const x of it) {
    if (i++ === n) return x;
  }
  return undefined;
}

/** `PartialEq for PlaceElem` (derived: `ProjectionElem<Local, Ty>`), field by field. */
function eq_PlaceElem(a: PlaceElem, b: PlaceElem): boolean {
  if (a === b) return true;
  switch (a.$) {
    case "Deref":
    case "PhantomDeref":
      return b.$ === a.$;
    case "Field":
      return b.$ === "Field" && a._0 === b._0 && a._1 === b._1;
    case "Index":
      return b.$ === "Index" && a._0 === b._0;
    case "ConstantIndex":
      return b.$ === "ConstantIndex" && a.offset === b.offset && a.min_length === b.min_length && a.from_end === b.from_end;
    case "Subslice":
      return b.$ === "Subslice" && a.from === b.from && a.to === b.to && a.from_end === b.from_end;
    case "Downcast":
      return b.$ === "Downcast" && a._0 === b._0 && a._1 === b._1;
    case "OpaqueCast":
      return b.$ === "OpaqueCast" && a._0 === b._0;
    case "UnwrapUnsafeBinder":
      return b.$ === "UnwrapUnsafeBinder" && a._0 === b._0;
  }
}

/** `&[PlaceElem] == &[PlaceElem]` */
function slice_eq_PlaceElem(a: readonly PlaceElem[], b: readonly PlaceElem[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!eq_PlaceElem(a[i]!, b[i]!)) return false;
  return true;
}
