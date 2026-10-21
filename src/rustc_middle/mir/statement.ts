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
import type { FieldIdx, VariantIdx } from "../../rustc_abi/lib.ts";
import type { Mutability } from "../../rustc_ast_ir/lib.ts";
import type { DenseBitSet } from "../../rustc_index/bit_set.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import type { Span } from "../../rustc_span/lib.ts";
import type { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import type { Debug } from "../../std/fmt.ts";
import { unported } from "../../std/panic.ts";
import type { TyCtxt } from "../ty/context.ts";
import type { Ty } from "../ty/decls.ts";
import type { GenericArg, GenericArgsRef } from "../ty/generic_args.ts";
import type { Scalar } from "./interpret/value.ts";
import type { HasLocalDecls, Local, SourceInfo } from "./mod.ts";
import { PlaceRef, PlaceTy, Statement, StmtDebugInfos, type ProjectionKind, type StmtDebugInfo } from "./statement.gen.ts";
import {
  BinOp,
  BorrowKind,
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
export * from "./statement.gen.ts";

/** pretty.ts (the manual `Debug` impls of statement.rs types live in pretty.rs), read lazily (init order). */
function mir_pretty(): typeof import("./pretty.ts") {
  return (mir_pretty__m ??= require("./pretty.ts") as typeof import("./pretty.ts"));
}
var mir_pretty__m: typeof import("./pretty.ts") | undefined;
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

// stub: compiler/rustc_middle/src/mir/statement.rs:32 make_nop (lane mir-body-b)
Statement.prototype.make_nop = function (this: Statement, drop_debuginfo: boolean): void {
  return unported("rustc_middle::mir::statement::Statement::make_nop");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:45 new (lane mir-body-b)
(Statement as unknown as { new: typeof Statement.new }).new = function (source_info: SourceInfo, kind: StatementKind): Statement {
  return unported("rustc_middle::mir::statement::Statement::new");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:53 name (lane mir-body-b)
StatementKind.name = function (self: StatementKind): string {
  return unported("rustc_middle::mir::statement::StatementKind::name");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:69 as_assign_mut (lane mir-body-b)
StatementKind.as_assign_mut = function (self: StatementKind): [Place, Rvalue] | undefined {
  return unported("rustc_middle::mir::statement::StatementKind::as_assign_mut");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:76 as_assign (lane mir-body-b)
StatementKind.as_assign = function (self: StatementKind): [Place, Rvalue] | undefined {
  return unported("rustc_middle::mir::statement::StatementKind::as_assign");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:83 as_debuginfo (lane mir-body-b)
StatementKind.as_debuginfo = function (self: StatementKind): StmtDebugInfo | undefined {
  return unported("rustc_middle::mir::statement::StatementKind::as_debuginfo");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:111 from_ty (lane mir-body-b)
(PlaceTy as unknown as { from_ty: typeof PlaceTy.from_ty }).from_ty = function (ty: Ty): PlaceTy {
  return unported("rustc_middle::mir::statement::PlaceTy::from_ty");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:123 field_ty (lane mir-body-b)
(PlaceTy as unknown as { field_ty: typeof PlaceTy.field_ty }).field_ty = function (tcx: TyCtxt, self_ty: Ty, variant_idx: VariantIdx | undefined, f: FieldIdx): Unnormalized<Ty> {
  return unported("rustc_middle::mir::statement::PlaceTy::field_ty");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:181 multi_projection_ty (lane mir-body-b)
PlaceTy.prototype.multi_projection_ty = function (this: PlaceTy, tcx: TyCtxt, elems: readonly PlaceElem[]): PlaceTy {
  return unported("rustc_middle::mir::statement::PlaceTy::multi_projection_ty");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:192 projection_ty (lane mir-body-b)
PlaceTy.prototype.projection_ty = function <V>(this: PlaceTy, tcx: TyCtxt, elem: ProjectionElem<V, Ty>, debug_V: Debug<V>): PlaceTy {
  return unported("rustc_middle::mir::statement::PlaceTy::projection_ty");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:206 projection_ty_core (lane mir-body-b)
PlaceTy.prototype.projection_ty_core = function <V, T>(this: PlaceTy, tcx: TyCtxt, elem: ProjectionElem<V, T>, handle_field: (a0: Ty, a1: VariantIdx | undefined, a2: FieldIdx, a3: T) => Ty, handle_opaque_cast_and_subtype: (a0: T) => Ty): PlaceTy {
  return unported("rustc_middle::mir::statement::PlaceTy::projection_ty_core");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:264 is_indirect (lane mir-body-b)
ProjectionElem.is_indirect = function <V, T>(self: ProjectionElem<V, T>): boolean {
  return unported("rustc_middle::mir::statement::ProjectionElem::is_indirect");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:280 is_stable_offset (lane mir-body-b)
ProjectionElem.is_stable_offset = function <V, T>(self: ProjectionElem<V, T>): boolean {
  return unported("rustc_middle::mir::statement::ProjectionElem::is_stable_offset");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:294 is_downcast_to (lane mir-body-b)
ProjectionElem.is_downcast_to = function <V, T>(self: ProjectionElem<V, T>, v: VariantIdx): boolean {
  return unported("rustc_middle::mir::statement::ProjectionElem::is_downcast_to");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:299 is_field_to (lane mir-body-b)
ProjectionElem.is_field_to = function <V, T>(self: ProjectionElem<V, T>, f: FieldIdx): boolean {
  return unported("rustc_middle::mir::statement::ProjectionElem::is_field_to");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:304 can_use_in_debuginfo (lane mir-body-b)
ProjectionElem.can_use_in_debuginfo = function <V, T>(self: ProjectionElem<V, T>): boolean {
  return unported("rustc_middle::mir::statement::ProjectionElem::can_use_in_debuginfo");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:322 kind (lane mir-body-b)
ProjectionElem.kind = function <V, T>(self: ProjectionElem<V, T>): ProjectionKind {
  return unported("rustc_middle::mir::statement::ProjectionElem::kind");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:327 try_map (lane mir-body-b)
ProjectionElem.try_map = function <V, T, V2, T2>(self: ProjectionElem<V, T>, v: (a0: V) => V2 | undefined, t: (a0: T) => T2): ProjectionElem<V2, T2> | undefined {
  return unported("rustc_middle::mir::statement::ProjectionElem::try_map");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:370 return_place (lane mir-body-b)
(Place as unknown as { return_place: typeof Place.return_place }).return_place = function (): Place {
  return unported("rustc_middle::mir::statement::Place::return_place");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:378 is_indirect (lane mir-body-b)
Place.prototype.is_indirect = function (this: Place): boolean {
  return unported("rustc_middle::mir::statement::Place::is_indirect");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:384 is_stable_offset (lane mir-body-b)
Place.prototype.is_stable_offset = function (this: Place): boolean {
  return unported("rustc_middle::mir::statement::Place::is_stable_offset");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:393 is_indirect_first_projection (lane mir-body-b)
Place.prototype.is_indirect_first_projection = function (this: Place): boolean {
  return unported("rustc_middle::mir::statement::Place::is_indirect_first_projection");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:400 local_or_deref_local (lane mir-body-b)
Place.prototype.local_or_deref_local = function (this: Place): Local | undefined {
  return unported("rustc_middle::mir::statement::Place::local_or_deref_local");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:407 as_local (lane mir-body-b)
Place.prototype.as_local = function (this: Place): Local | undefined {
  return unported("rustc_middle::mir::statement::Place::as_local");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:412 as_ref (lane mir-body-b)
Place.prototype.as_ref = function (this: Place): PlaceRef {
  return unported("rustc_middle::mir::statement::Place::as_ref");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:424 iter_projections (lane mir-body-b)
Place.prototype.iter_projections = function (this: Place): readonly [PlaceRef, PlaceElem][] {
  return unported("rustc_middle::mir::statement::Place::iter_projections");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:432 project_deeper (lane mir-body-b)
Place.prototype.project_deeper = function (this: Place, more_projections: readonly PlaceElem[], tcx: TyCtxt): Place {
  return unported("rustc_middle::mir::statement::Place::project_deeper");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:443 project_to_field (lane mir-body-b)
Place.prototype.project_to_field = function (this: Place, idx: FieldIdx, local_decls: HasLocalDecls, tcx: TyCtxt): Place {
  return unported("rustc_middle::mir::statement::Place::project_to_field");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:456 ty_from (lane mir-body-b)
(Place as unknown as { ty_from: typeof Place.ty_from }).ty_from = function (local: Local, projection: readonly PlaceElem[], local_decls: HasLocalDecls, tcx: TyCtxt): PlaceTy {
  return unported("rustc_middle::mir::statement::Place::ty_from");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:470 ty (lane mir-body-b)
Place.prototype.ty = function (this: Place, local_decls: HasLocalDecls, tcx: TyCtxt): PlaceTy {
  return unported("rustc_middle::mir::statement::Place::ty");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:480 from (lane mir-body-b)
export function Place_from_Local(local: Local): Place {
  return unported("rustc_middle::mir::statement::<Place as From<Local>>::from");
}


// stub: compiler/rustc_middle/src/mir/statement.rs:486 is_prefix_of (lane mir-body-b)
PlaceRef.prototype.is_prefix_of = function (this: PlaceRef, other: PlaceRef): boolean {
  return unported("rustc_middle::mir::statement::PlaceRef::is_prefix_of");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:494 local_or_deref_local (lane mir-body-b)
PlaceRef.prototype.local_or_deref_local = function (this: PlaceRef): Local | undefined {
  return unported("rustc_middle::mir::statement::PlaceRef::local_or_deref_local");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:509 is_indirect (lane mir-body-b)
PlaceRef.prototype.is_indirect = function (this: PlaceRef): boolean {
  return unported("rustc_middle::mir::statement::PlaceRef::is_indirect");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:518 is_indirect_first_projection (lane mir-body-b)
PlaceRef.prototype.is_indirect_first_projection = function (this: PlaceRef): boolean {
  return unported("rustc_middle::mir::statement::PlaceRef::is_indirect_first_projection");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:529 as_local (lane mir-body-b)
PlaceRef.prototype.as_local = function (this: PlaceRef): Local | undefined {
  return unported("rustc_middle::mir::statement::PlaceRef::as_local");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:537 to_place (lane mir-body-b)
PlaceRef.prototype.to_place = function (this: PlaceRef, tcx: TyCtxt): Place {
  return unported("rustc_middle::mir::statement::PlaceRef::to_place");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:542 last_projection (lane mir-body-b)
PlaceRef.prototype.last_projection = function (this: PlaceRef): [PlaceRef, PlaceElem] | undefined {
  return unported("rustc_middle::mir::statement::PlaceRef::last_projection");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:558 iter_projections (lane mir-body-b)
PlaceRef.prototype.iter_projections = function (this: PlaceRef): readonly [PlaceRef, PlaceElem][] {
  return unported("rustc_middle::mir::statement::PlaceRef::iter_projections");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:568 accessed_locals (lane mir-body-b)
PlaceRef.prototype.accessed_locals = function (this: PlaceRef): IterableIterator<Local> {
  return unported("rustc_middle::mir::statement::PlaceRef::accessed_locals");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:584 project_deeper (lane mir-body-b)
PlaceRef.prototype.project_deeper = function (this: PlaceRef, more_projections: readonly PlaceElem[], tcx: TyCtxt): Place {
  return unported("rustc_middle::mir::statement::PlaceRef::project_deeper");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:603 ty (lane mir-body-b)
PlaceRef.prototype.ty = function (this: PlaceRef, local_decls: HasLocalDecls, tcx: TyCtxt): PlaceTy {
  return unported("rustc_middle::mir::statement::PlaceRef::ty");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:613 from (lane mir-body-b)
export function PlaceRef_from_Local(local: Local): PlaceRef {
  return unported("rustc_middle::mir::statement::<PlaceRef as From<Local>>::from");
}


// stub: compiler/rustc_middle/src/mir/statement.rs:625 function_handle (lane mir-body-b)
Operand.function_handle = function (tcx: TyCtxt, def_id: DefId, args: Iterable<GenericArg>, span: Span): Operand {
  return unported("rustc_middle::mir::statement::Operand::function_handle");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:639 unevaluated_constant (lane mir-body-b)
Operand.unevaluated_constant = function (tcx: TyCtxt, def_id: DefId, args: Iterable<GenericArg>, span: Span): Operand {
  return unported("rustc_middle::mir::statement::Operand::unevaluated_constant");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:650 zero_sized_constant (lane mir-body-b)
Operand.zero_sized_constant = function (ty: Ty, span: Span): Operand {
  return unported("rustc_middle::mir::statement::Operand::zero_sized_constant");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:655 is_move (lane mir-body-b)
Operand.is_move = function (self: Operand): boolean {
  return unported("rustc_middle::mir::statement::Operand::is_move");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:661 const_from_scalar (lane mir-body-b)
Operand.const_from_scalar = function (tcx: TyCtxt, ty: Ty, val: Scalar, span: Span): Operand {
  return unported("rustc_middle::mir::statement::Operand::const_from_scalar");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:686 to_copy (lane mir-body-b)
Operand.to_copy = function (self: Operand): Operand {
  return unported("rustc_middle::mir::statement::Operand::to_copy");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:695 place (lane mir-body-b)
Operand.place = function (self: Operand): Place | undefined {
  return unported("rustc_middle::mir::statement::Operand::place");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:704 constant (lane mir-body-b)
Operand.constant = function (self: Operand): ConstOperand | undefined {
  return unported("rustc_middle::mir::statement::Operand::constant");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:715 const_fn_def (lane mir-body-b)
Operand.const_fn_def = function (self: Operand): [DefId, GenericArgsRef] | undefined {
  return unported("rustc_middle::mir::statement::Operand::const_fn_def");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:724 ty (lane mir-body-b)
Operand.ty = function (self: Operand, local_decls: HasLocalDecls, tcx: TyCtxt): Ty {
  return unported("rustc_middle::mir::statement::Operand::ty");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:735 span (lane mir-body-b)
Operand.span = function (self: Operand, local_decls: HasLocalDecls): Span {
  return unported("rustc_middle::mir::statement::Operand::span");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:751 check_static_ptr (lane mir-body-b)
ConstOperand.prototype.check_static_ptr = function (this: ConstOperand, tcx: TyCtxt): DefId | undefined {
  return unported("rustc_middle::mir::statement::ConstOperand::check_static_ptr");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:765 ty (lane mir-body-b)
ConstOperand.prototype.ty = function (this: ConstOperand): Ty {
  return unported("rustc_middle::mir::statement::ConstOperand::ty");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:776 is_safe_to_remove (lane mir-body-b)
Rvalue.is_safe_to_remove = function (self: Rvalue): boolean {
  return unported("rustc_middle::mir::statement::Rvalue::is_safe_to_remove");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:815 is_generic_reborrow (lane mir-body-b)
Rvalue.is_generic_reborrow = function (self: Rvalue): boolean {
  return unported("rustc_middle::mir::statement::Rvalue::is_generic_reborrow");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:819 ty (lane mir-body-b)
Rvalue.ty = function (self: Rvalue, local_decls: HasLocalDecls, tcx: TyCtxt): Ty {
  return unported("rustc_middle::mir::statement::Rvalue::ty");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:871 mutability (lane mir-body-b)
BorrowKind.mutability = function (self: BorrowKind): Mutability {
  return unported("rustc_middle::mir::statement::BorrowKind::mutability");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:880 is_two_phase_borrow (lane mir-body-b)
BorrowKind.is_two_phase_borrow = function (self: BorrowKind): boolean {
  return unported("rustc_middle::mir::statement::BorrowKind::is_two_phase_borrow");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:891 to_mutbl_lossy (lane mir-body-b)
BorrowKind.to_mutbl_lossy = function (self: BorrowKind): Mutability {
  return unported("rustc_middle::mir::statement::BorrowKind::to_mutbl_lossy");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:904 ty (lane mir-body-b)
UnOp.ty = function (self: UnOp, tcx: TyCtxt, arg_ty: Ty): Ty {
  return unported("rustc_middle::mir::statement::UnOp::ty");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:913 ty (lane mir-body-b)
BinOp.ty = function (self: BinOp, tcx: TyCtxt, lhs_ty: Ty, rhs_ty: Ty): Ty {
  return unported("rustc_middle::mir::statement::BinOp::ty");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:953 to_hir_binop (lane mir-body-b)
BinOp.to_hir_binop = function (self: BinOp): BinOpKind {
  return unported("rustc_middle::mir::statement::BinOp::to_hir_binop");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:987 overflowing_to_wrapping (lane mir-body-b)
BinOp.overflowing_to_wrapping = function (self: BinOp): BinOp | undefined {
  return unported("rustc_middle::mir::statement::BinOp::overflowing_to_wrapping");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:997 is_overflowing (lane mir-body-b)
BinOp.is_overflowing = function (self: BinOp): boolean {
  return unported("rustc_middle::mir::statement::BinOp::is_overflowing");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:1002 wrapping_to_overflowing (lane mir-body-b)
BinOp.wrapping_to_overflowing = function (self: BinOp): BinOp | undefined {
  return unported("rustc_middle::mir::statement::BinOp::wrapping_to_overflowing");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:1013 from (lane mir-body-b)
export function RawPtrKind_from_Mutability(other: Mutability): RawPtrKind {
  return unported("rustc_middle::mir::statement::<RawPtrKind as From<Mutability>>::from");
}


// stub: compiler/rustc_middle/src/mir/statement.rs:1022 is_fake (lane mir-body-b)
RawPtrKind.is_fake = function (self: RawPtrKind): boolean {
  return unported("rustc_middle::mir::statement::RawPtrKind::is_fake");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:1029 to_mutbl_lossy (lane mir-body-b)
RawPtrKind.to_mutbl_lossy = function (self: RawPtrKind): Mutability {
  return unported("rustc_middle::mir::statement::RawPtrKind::to_mutbl_lossy");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:1040 ptr_str (lane mir-body-b)
RawPtrKind.ptr_str = function (self: RawPtrKind): string {
  return unported("rustc_middle::mir::statement::RawPtrKind::ptr_str");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:1060 push (lane mir-body-b)
StmtDebugInfos.prototype.push = function (this: StmtDebugInfos, debuginfo: StmtDebugInfo): void {
  return unported("rustc_middle::mir::statement::StmtDebugInfos::push");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:1064 drop_debuginfo (lane mir-body-b)
StmtDebugInfos.prototype.drop_debuginfo = function (this: StmtDebugInfos): void {
  return unported("rustc_middle::mir::statement::StmtDebugInfos::drop_debuginfo");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:1072 is_empty (lane mir-body-b)
StmtDebugInfos.prototype.is_empty = function (this: StmtDebugInfos): boolean {
  return unported("rustc_middle::mir::statement::StmtDebugInfos::is_empty");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:1079 prepend (lane mir-body-b)
StmtDebugInfos.prototype.prepend = function (this: StmtDebugInfos, debuginfos: StmtDebugInfos): void {
  return unported("rustc_middle::mir::statement::StmtDebugInfos::prepend");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:1089 append (lane mir-body-b)
StmtDebugInfos.prototype.append = function (this: StmtDebugInfos, debuginfos: StmtDebugInfos): void {
  return unported("rustc_middle::mir::statement::StmtDebugInfos::append");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:1096 extend (lane mir-body-b)
StmtDebugInfos.prototype.extend = function (this: StmtDebugInfos, debuginfos: StmtDebugInfos): void {
  return unported("rustc_middle::mir::statement::StmtDebugInfos::extend");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:1104 as_slice (lane mir-body-b)
StmtDebugInfos.prototype.as_slice = function (this: StmtDebugInfos): readonly StmtDebugInfo[] {
  return unported("rustc_middle::mir::statement::StmtDebugInfos::as_slice");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:1112 as_mut_slice (lane mir-body-b)
StmtDebugInfos.prototype.as_mut_slice = function (this: StmtDebugInfos): StmtDebugInfo[] {
  return unported("rustc_middle::mir::statement::StmtDebugInfos::as_mut_slice");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:1119 retain_locals (lane mir-body-b)
StmtDebugInfos.prototype.retain_locals = function (this: StmtDebugInfos, locals: DenseBitSet<Local>): void {
  return unported("rustc_middle::mir::statement::StmtDebugInfos::retain_locals");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:1137 deref (lane mir-body-b)
StmtDebugInfos.prototype.deref = function (this: StmtDebugInfos): readonly StmtDebugInfo[] {
  return unported("rustc_middle::mir::statement::<StmtDebugInfos as Deref>::deref");
};


// stub: compiler/rustc_middle/src/mir/statement.rs:1144 deref_mut (lane mir-body-b)
StmtDebugInfos.prototype.deref_mut = function (this: StmtDebugInfos): StmtDebugInfo[] {
  return unported("rustc_middle::mir::statement::<StmtDebugInfos as DerefMut>::deref_mut");
};
