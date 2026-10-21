// Port of compiler/rustc_middle/src/mir/visit.rs (lane mir-contract, plan-m4 D4): `make_mir_visitor!` (visit.rs:68,
// instantiated at :1276 / :1277) is hand-expanded twice, into the classes `Visitor` (`make_mir_visitor!(Visitor,)`) and
// `MutVisitor` (`make_mir_visitor!(MutVisitor, mut)`), each method carrying the line of its `fn` in the macro (so every
// macro fn has two declarations); `extra_body_methods!(mut)` and `visit_place_fns!(mut)` go to `MutVisitor` only,
// `visit_place_fns!()` to `Visitor` only. Every method is a stub for lane mir-visit (docs/handoff/mir-contract.md).
// The context enums (`TyContext`, `PlaceContext`, ...) are generated into visit.gen.ts (set rustc_middle_mir).
//
// PORT (D4): a trait with provided methods is a class (precedent rustc_middle thir/visit.ts): implementors `extends
// Visitor` / `MutVisitor` and override; `self.super_x(..)` is `this.super_x(..)`. `MutVisitor::tcx` is abstract.
// PORT (D4): in `MutVisitor`, the callbacks that receive `&mut` of a `Copy` leaf (`$(&$mutability)? T`: `Local`, `Ty`,
// `ty::Const`, `Region`, `Span`, `SourceScope`, `Variance`, and `&mut GenericArgsRef`) take a `MutRef<T>` (PORTING §8):
// a visitor replaces the value with `r.value = ..`, and the `super_*` walkers write it back into the MIR (e.g.
// `super_place` with `field_mut(place, "local")`). `&mut` of non-`Copy` nodes (`Body`, `Statement`, `Place`, `Operand`,
// `SourceInfo`, ...) is the object itself, edited in place. In `Visitor` every argument is passed as is.
import "./mod.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { unported } from "../../std/panic.ts";
import type { Variance } from "../../rustc_type_ir/lib.ts";
import type { Span } from "../../rustc_span/lib.ts";
import type { Const as ty_Const } from "../../rustc_type_ir/sty/consts.ts";
import type { TyCtxt } from "../ty/context.ts";
import type { Region, Ty } from "../ty/decls.ts";
import type { GenericArgsRef } from "../ty/generic_args.ts";
import type { CanonicalUserTypeAnnotation, UserTypeAnnotationIndex } from "../ty/typeck_results.ts";
import type { CoverageKind } from "./coverage.ts";
import type {
  BasicBlock,
  BasicBlockData,
  Body,
  Local,
  LocalDecl,
  Location,
  SourceInfo,
  SourceScope,
  SourceScopeData,
  UserTypeProjection,
  VarDebugInfo,
} from "./mod.ts";
import type { PlaceRef, Statement, StmtDebugInfo } from "./statement.ts";
import type { AssertMessage, ConstOperand, Operand, Place, PlaceElem, Rvalue } from "./syntax.ts";
import type { Terminator } from "./terminator.ts";
import type { PlaceContext as gen_PlaceContext, TyContext } from "./visit.gen.ts";
export * from "./visit.gen.ts";

export abstract class Visitor {
  // stub: compiler/rustc_middle/src/mir/visit.rs:74 visit_body (lane mir-visit)
  visit_body(body: Body): void {
    return unported("rustc_middle::mir::visit::Visitor::visit_body");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:83 visit_basic_block_data (lane mir-visit)
  visit_basic_block_data(block: BasicBlock, data: BasicBlockData): void {
    return unported("rustc_middle::mir::visit::Visitor::visit_basic_block_data");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:91 visit_source_scope_data (lane mir-visit)
  visit_source_scope_data(scope_data: SourceScopeData): void {
    return unported("rustc_middle::mir::visit::Visitor::visit_source_scope_data");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:98 visit_statement_debuginfo (lane mir-visit)
  visit_statement_debuginfo(stmt_debuginfo: StmtDebugInfo, location: Location): void {
    return unported("rustc_middle::mir::visit::Visitor::visit_statement_debuginfo");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:106 visit_statement (lane mir-visit)
  visit_statement(statement: Statement, location: Location): void {
    return unported("rustc_middle::mir::visit::Visitor::visit_statement");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:114 visit_assign (lane mir-visit)
  visit_assign(place: Place, rvalue: Rvalue, location: Location): void {
    return unported("rustc_middle::mir::visit::Visitor::visit_assign");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:123 visit_terminator (lane mir-visit)
  visit_terminator(terminator: Terminator, location: Location): void {
    return unported("rustc_middle::mir::visit::Visitor::visit_terminator");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:131 visit_assert_message (lane mir-visit)
  visit_assert_message(msg: AssertMessage, location: Location): void {
    return unported("rustc_middle::mir::visit::Visitor::visit_assert_message");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:139 visit_rvalue (lane mir-visit)
  visit_rvalue(rvalue: Rvalue, location: Location): void {
    return unported("rustc_middle::mir::visit::Visitor::visit_rvalue");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:147 visit_operand (lane mir-visit)
  visit_operand(operand: Operand, location: Location): void {
    return unported("rustc_middle::mir::visit::Visitor::visit_operand");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:155 visit_ascribe_user_ty (lane mir-visit)
  visit_ascribe_user_ty(place: Place, variance: Variance, user_ty: UserTypeProjection, location: Location): void {
    return unported("rustc_middle::mir::visit::Visitor::visit_ascribe_user_ty");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:165 visit_coverage (lane mir-visit)
  visit_coverage(kind: CoverageKind, location: Location): void {
    return unported("rustc_middle::mir::visit::Visitor::visit_coverage");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:173 visit_place (lane mir-visit)
  visit_place(place: Place, context: PlaceContext, location: Location): void {
    return unported("rustc_middle::mir::visit::Visitor::visit_place");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:186 visit_const_operand (lane mir-visit)
  visit_const_operand(constant: ConstOperand, location: Location): void {
    return unported("rustc_middle::mir::visit::Visitor::visit_const_operand");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:194 visit_ty_const (lane mir-visit)
  visit_ty_const(ct: ty_Const, location: Location): void {
    return unported("rustc_middle::mir::visit::Visitor::visit_ty_const");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:202 visit_span (lane mir-visit)
  visit_span(span: Span): void {
    return unported("rustc_middle::mir::visit::Visitor::visit_span");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:209 visit_source_info (lane mir-visit)
  visit_source_info(source_info: SourceInfo): void {
    return unported("rustc_middle::mir::visit::Visitor::visit_source_info");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:216 visit_ty (lane mir-visit)
  visit_ty(ty: Ty, _1: TyContext): void {
    return unported("rustc_middle::mir::visit::Visitor::visit_ty");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:224 visit_user_type_projection (lane mir-visit)
  visit_user_type_projection(ty: UserTypeProjection): void {
    return unported("rustc_middle::mir::visit::Visitor::visit_user_type_projection");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:231 visit_user_type_annotation (lane mir-visit)
  visit_user_type_annotation(index: UserTypeAnnotationIndex, ty: CanonicalUserTypeAnnotation): void {
    return unported("rustc_middle::mir::visit::Visitor::visit_user_type_annotation");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:239 visit_region (lane mir-visit)
  visit_region(region: Region, _1: Location): void {
    return unported("rustc_middle::mir::visit::Visitor::visit_region");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:247 visit_args (lane mir-visit)
  visit_args(args: GenericArgsRef, _1: Location): void {
    return unported("rustc_middle::mir::visit::Visitor::visit_args");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:255 visit_local_decl (lane mir-visit)
  visit_local_decl(local: Local, local_decl: LocalDecl): void {
    return unported("rustc_middle::mir::visit::Visitor::visit_local_decl");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:263 visit_var_debug_info (lane mir-visit)
  visit_var_debug_info(var_debug_info: VarDebugInfo): void {
    return unported("rustc_middle::mir::visit::Visitor::visit_var_debug_info");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:270 visit_local (lane mir-visit)
  visit_local(local: Local, context: PlaceContext, location: Location): void {
    return unported("rustc_middle::mir::visit::Visitor::visit_local");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:279 visit_source_scope (lane mir-visit)
  visit_source_scope(scope: SourceScope): void {
    return unported("rustc_middle::mir::visit::Visitor::visit_source_scope");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:289 super_body (lane mir-visit)
  super_body(body: Body): void {
    return unported("rustc_middle::mir::visit::Visitor::super_body");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:296 super_basic_block_data (lane mir-visit)
  super_basic_block_data(block: BasicBlock, data: BasicBlockData): void {
    return unported("rustc_middle::mir::visit::Visitor::super_basic_block_data");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:324 super_source_scope_data (lane mir-visit)
  super_source_scope_data(scope_data: SourceScopeData): void {
    return unported("rustc_middle::mir::visit::Visitor::super_source_scope_data");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:384 super_statement_debuginfo (lane mir-visit)
  super_statement_debuginfo(stmt_debuginfo: StmtDebugInfo, location: Location): void {
    return unported("rustc_middle::mir::visit::Visitor::super_statement_debuginfo");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:412 super_statement (lane mir-visit)
  super_statement(statement: Statement, location: Location): void {
    return unported("rustc_middle::mir::visit::Visitor::super_statement");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:502 super_assign (lane mir-visit)
  super_assign(place: Place, rvalue: Rvalue, location: Location): void {
    return unported("rustc_middle::mir::visit::Visitor::super_assign");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:516 super_terminator (lane mir-visit)
  super_terminator(terminator: Terminator, location: Location): void {
    return unported("rustc_middle::mir::visit::Visitor::super_terminator");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:655 super_assert_message (lane mir-visit)
  super_assert_message(msg: AssertMessage, location: Location): void {
    return unported("rustc_middle::mir::visit::Visitor::super_assert_message");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:683 super_rvalue (lane mir-visit)
  super_rvalue(rvalue: Rvalue, location: Location): void {
    return unported("rustc_middle::mir::visit::Visitor::super_rvalue");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:816 super_operand (lane mir-visit)
  super_operand(operand: Operand, location: Location): void {
    return unported("rustc_middle::mir::visit::Visitor::super_operand");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:843 super_ascribe_user_ty (lane mir-visit)
  super_ascribe_user_ty(place: Place, variance: Variance, user_ty: UserTypeProjection, location: Location): void {
    return unported("rustc_middle::mir::visit::Visitor::super_ascribe_user_ty");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:860 super_coverage (lane mir-visit)
  super_coverage(_kind: CoverageKind, _location: Location): void {
    return unported("rustc_middle::mir::visit::Visitor::super_coverage");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:867 super_local_decl (lane mir-visit)
  super_local_decl(local: Local, local_decl: LocalDecl): void {
    return unported("rustc_middle::mir::visit::Visitor::super_local_decl");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:893 super_local (lane mir-visit)
  super_local(_local: Local, _context: PlaceContext, _location: Location): void {
    return unported("rustc_middle::mir::visit::Visitor::super_local");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:901 super_var_debug_info (lane mir-visit)
  super_var_debug_info(var_debug_info: VarDebugInfo): void {
    return unported("rustc_middle::mir::visit::Visitor::super_var_debug_info");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:936 super_source_scope (lane mir-visit)
  super_source_scope(_scope: SourceScope): void {
    return unported("rustc_middle::mir::visit::Visitor::super_source_scope");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:938 super_const_operand (lane mir-visit)
  super_const_operand(constant: ConstOperand, location: Location): void {
    return unported("rustc_middle::mir::visit::Visitor::super_const_operand");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:958 super_ty_const (lane mir-visit)
  super_ty_const(_ct: ty_Const, _location: Location): void {
    return unported("rustc_middle::mir::visit::Visitor::super_ty_const");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:965 super_span (lane mir-visit)
  super_span(_span: Span): void {
    return unported("rustc_middle::mir::visit::Visitor::super_span");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:967 super_source_info (lane mir-visit)
  super_source_info(source_info: SourceInfo): void {
    return unported("rustc_middle::mir::visit::Visitor::super_source_info");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:974 super_user_type_projection (lane mir-visit)
  super_user_type_projection(_ty: UserTypeProjection): void {
    return unported("rustc_middle::mir::visit::Visitor::super_user_type_projection");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:976 super_user_type_annotation (lane mir-visit)
  super_user_type_annotation(_index: UserTypeAnnotationIndex, ty: CanonicalUserTypeAnnotation): void {
    return unported("rustc_middle::mir::visit::Visitor::super_user_type_annotation");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:985 super_ty (lane mir-visit)
  super_ty(_ty: Ty): void {
    return unported("rustc_middle::mir::visit::Visitor::super_ty");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:987 super_region (lane mir-visit)
  super_region(_region: Region): void {
    return unported("rustc_middle::mir::visit::Visitor::super_region");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:989 super_args (lane mir-visit)
  super_args(_args: GenericArgsRef): void {
    return unported("rustc_middle::mir::visit::Visitor::super_args");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:993 visit_location (lane mir-visit)
  visit_location(body: Body, location: Location): void {
    return unported("rustc_middle::mir::visit::Visitor::visit_location");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:1191 visit_projection (lane mir-visit)
  visit_projection(place_ref: PlaceRef, context: PlaceContext, location: Location): void {
    return unported("rustc_middle::mir::visit::Visitor::visit_projection");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:1200 visit_projection_elem (lane mir-visit)
  visit_projection_elem(place_ref: PlaceRef, elem: PlaceElem, context: PlaceContext, location: Location): void {
    return unported("rustc_middle::mir::visit::Visitor::visit_projection_elem");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:1210 super_place (lane mir-visit)
  super_place(place: Place, context: PlaceContext, location: Location): void {
    return unported("rustc_middle::mir::visit::Visitor::super_place");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:1230 super_projection (lane mir-visit)
  super_projection(place_ref: PlaceRef, context: PlaceContext, location: Location): void {
    return unported("rustc_middle::mir::visit::Visitor::super_projection");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:1241 super_projection_elem (lane mir-visit)
  super_projection_elem(_place_ref: PlaceRef, elem: PlaceElem, context: PlaceContext, location: Location): void {
    return unported("rustc_middle::mir::visit::Visitor::super_projection_elem");
  }
}

export abstract class MutVisitor {
  // stub: compiler/rustc_middle/src/mir/visit.rs:74 visit_body (lane mir-visit)
  visit_body(body: Body): void {
    return unported("rustc_middle::mir::visit::MutVisitor::visit_body");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:83 visit_basic_block_data (lane mir-visit)
  visit_basic_block_data(block: BasicBlock, data: BasicBlockData): void {
    return unported("rustc_middle::mir::visit::MutVisitor::visit_basic_block_data");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:91 visit_source_scope_data (lane mir-visit)
  visit_source_scope_data(scope_data: SourceScopeData): void {
    return unported("rustc_middle::mir::visit::MutVisitor::visit_source_scope_data");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:98 visit_statement_debuginfo (lane mir-visit)
  visit_statement_debuginfo(stmt_debuginfo: StmtDebugInfo, location: Location): void {
    return unported("rustc_middle::mir::visit::MutVisitor::visit_statement_debuginfo");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:106 visit_statement (lane mir-visit)
  visit_statement(statement: Statement, location: Location): void {
    return unported("rustc_middle::mir::visit::MutVisitor::visit_statement");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:114 visit_assign (lane mir-visit)
  visit_assign(place: Place, rvalue: Rvalue, location: Location): void {
    return unported("rustc_middle::mir::visit::MutVisitor::visit_assign");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:123 visit_terminator (lane mir-visit)
  visit_terminator(terminator: Terminator, location: Location): void {
    return unported("rustc_middle::mir::visit::MutVisitor::visit_terminator");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:131 visit_assert_message (lane mir-visit)
  visit_assert_message(msg: AssertMessage, location: Location): void {
    return unported("rustc_middle::mir::visit::MutVisitor::visit_assert_message");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:139 visit_rvalue (lane mir-visit)
  visit_rvalue(rvalue: Rvalue, location: Location): void {
    return unported("rustc_middle::mir::visit::MutVisitor::visit_rvalue");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:147 visit_operand (lane mir-visit)
  visit_operand(operand: Operand, location: Location): void {
    return unported("rustc_middle::mir::visit::MutVisitor::visit_operand");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:155 visit_ascribe_user_ty (lane mir-visit)
  visit_ascribe_user_ty(place: Place, variance: MutRef<Variance>, user_ty: UserTypeProjection, location: Location): void {
    return unported("rustc_middle::mir::visit::MutVisitor::visit_ascribe_user_ty");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:165 visit_coverage (lane mir-visit)
  visit_coverage(kind: CoverageKind, location: Location): void {
    return unported("rustc_middle::mir::visit::MutVisitor::visit_coverage");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:173 visit_place (lane mir-visit)
  visit_place(place: Place, context: PlaceContext, location: Location): void {
    return unported("rustc_middle::mir::visit::MutVisitor::visit_place");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:186 visit_const_operand (lane mir-visit)
  visit_const_operand(constant: ConstOperand, location: Location): void {
    return unported("rustc_middle::mir::visit::MutVisitor::visit_const_operand");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:194 visit_ty_const (lane mir-visit)
  visit_ty_const(ct: MutRef<ty_Const>, location: Location): void {
    return unported("rustc_middle::mir::visit::MutVisitor::visit_ty_const");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:202 visit_span (lane mir-visit)
  visit_span(span: MutRef<Span>): void {
    return unported("rustc_middle::mir::visit::MutVisitor::visit_span");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:209 visit_source_info (lane mir-visit)
  visit_source_info(source_info: SourceInfo): void {
    return unported("rustc_middle::mir::visit::MutVisitor::visit_source_info");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:216 visit_ty (lane mir-visit)
  visit_ty(ty: MutRef<Ty>, _1: TyContext): void {
    return unported("rustc_middle::mir::visit::MutVisitor::visit_ty");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:224 visit_user_type_projection (lane mir-visit)
  visit_user_type_projection(ty: UserTypeProjection): void {
    return unported("rustc_middle::mir::visit::MutVisitor::visit_user_type_projection");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:231 visit_user_type_annotation (lane mir-visit)
  visit_user_type_annotation(index: UserTypeAnnotationIndex, ty: CanonicalUserTypeAnnotation): void {
    return unported("rustc_middle::mir::visit::MutVisitor::visit_user_type_annotation");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:239 visit_region (lane mir-visit)
  visit_region(region: MutRef<Region>, _1: Location): void {
    return unported("rustc_middle::mir::visit::MutVisitor::visit_region");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:247 visit_args (lane mir-visit)
  visit_args(args: MutRef<GenericArgsRef>, _1: Location): void {
    return unported("rustc_middle::mir::visit::MutVisitor::visit_args");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:255 visit_local_decl (lane mir-visit)
  visit_local_decl(local: Local, local_decl: LocalDecl): void {
    return unported("rustc_middle::mir::visit::MutVisitor::visit_local_decl");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:263 visit_var_debug_info (lane mir-visit)
  visit_var_debug_info(var_debug_info: VarDebugInfo): void {
    return unported("rustc_middle::mir::visit::MutVisitor::visit_var_debug_info");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:270 visit_local (lane mir-visit)
  visit_local(local: MutRef<Local>, context: PlaceContext, location: Location): void {
    return unported("rustc_middle::mir::visit::MutVisitor::visit_local");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:279 visit_source_scope (lane mir-visit)
  visit_source_scope(scope: MutRef<SourceScope>): void {
    return unported("rustc_middle::mir::visit::MutVisitor::visit_source_scope");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:289 super_body (lane mir-visit)
  super_body(body: Body): void {
    return unported("rustc_middle::mir::visit::MutVisitor::super_body");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:296 super_basic_block_data (lane mir-visit)
  super_basic_block_data(block: BasicBlock, data: BasicBlockData): void {
    return unported("rustc_middle::mir::visit::MutVisitor::super_basic_block_data");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:324 super_source_scope_data (lane mir-visit)
  super_source_scope_data(scope_data: SourceScopeData): void {
    return unported("rustc_middle::mir::visit::MutVisitor::super_source_scope_data");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:384 super_statement_debuginfo (lane mir-visit)
  super_statement_debuginfo(stmt_debuginfo: StmtDebugInfo, location: Location): void {
    return unported("rustc_middle::mir::visit::MutVisitor::super_statement_debuginfo");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:412 super_statement (lane mir-visit)
  super_statement(statement: Statement, location: Location): void {
    return unported("rustc_middle::mir::visit::MutVisitor::super_statement");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:502 super_assign (lane mir-visit)
  super_assign(place: Place, rvalue: Rvalue, location: Location): void {
    return unported("rustc_middle::mir::visit::MutVisitor::super_assign");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:516 super_terminator (lane mir-visit)
  super_terminator(terminator: Terminator, location: Location): void {
    return unported("rustc_middle::mir::visit::MutVisitor::super_terminator");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:655 super_assert_message (lane mir-visit)
  super_assert_message(msg: AssertMessage, location: Location): void {
    return unported("rustc_middle::mir::visit::MutVisitor::super_assert_message");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:683 super_rvalue (lane mir-visit)
  super_rvalue(rvalue: Rvalue, location: Location): void {
    return unported("rustc_middle::mir::visit::MutVisitor::super_rvalue");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:816 super_operand (lane mir-visit)
  super_operand(operand: Operand, location: Location): void {
    return unported("rustc_middle::mir::visit::MutVisitor::super_operand");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:843 super_ascribe_user_ty (lane mir-visit)
  super_ascribe_user_ty(place: Place, variance: MutRef<Variance>, user_ty: UserTypeProjection, location: Location): void {
    return unported("rustc_middle::mir::visit::MutVisitor::super_ascribe_user_ty");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:860 super_coverage (lane mir-visit)
  super_coverage(_kind: CoverageKind, _location: Location): void {
    return unported("rustc_middle::mir::visit::MutVisitor::super_coverage");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:867 super_local_decl (lane mir-visit)
  super_local_decl(local: Local, local_decl: LocalDecl): void {
    return unported("rustc_middle::mir::visit::MutVisitor::super_local_decl");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:893 super_local (lane mir-visit)
  super_local(_local: MutRef<Local>, _context: PlaceContext, _location: Location): void {
    return unported("rustc_middle::mir::visit::MutVisitor::super_local");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:901 super_var_debug_info (lane mir-visit)
  super_var_debug_info(var_debug_info: VarDebugInfo): void {
    return unported("rustc_middle::mir::visit::MutVisitor::super_var_debug_info");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:936 super_source_scope (lane mir-visit)
  super_source_scope(_scope: MutRef<SourceScope>): void {
    return unported("rustc_middle::mir::visit::MutVisitor::super_source_scope");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:938 super_const_operand (lane mir-visit)
  super_const_operand(constant: ConstOperand, location: Location): void {
    return unported("rustc_middle::mir::visit::MutVisitor::super_const_operand");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:958 super_ty_const (lane mir-visit)
  super_ty_const(_ct: MutRef<ty_Const>, _location: Location): void {
    return unported("rustc_middle::mir::visit::MutVisitor::super_ty_const");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:965 super_span (lane mir-visit)
  super_span(_span: MutRef<Span>): void {
    return unported("rustc_middle::mir::visit::MutVisitor::super_span");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:967 super_source_info (lane mir-visit)
  super_source_info(source_info: SourceInfo): void {
    return unported("rustc_middle::mir::visit::MutVisitor::super_source_info");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:974 super_user_type_projection (lane mir-visit)
  super_user_type_projection(_ty: UserTypeProjection): void {
    return unported("rustc_middle::mir::visit::MutVisitor::super_user_type_projection");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:976 super_user_type_annotation (lane mir-visit)
  super_user_type_annotation(_index: UserTypeAnnotationIndex, ty: CanonicalUserTypeAnnotation): void {
    return unported("rustc_middle::mir::visit::MutVisitor::super_user_type_annotation");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:985 super_ty (lane mir-visit)
  super_ty(_ty: MutRef<Ty>): void {
    return unported("rustc_middle::mir::visit::MutVisitor::super_ty");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:987 super_region (lane mir-visit)
  super_region(_region: MutRef<Region>): void {
    return unported("rustc_middle::mir::visit::MutVisitor::super_region");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:989 super_args (lane mir-visit)
  super_args(_args: MutRef<GenericArgsRef>): void {
    return unported("rustc_middle::mir::visit::MutVisitor::super_args");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:993 visit_location (lane mir-visit)
  visit_location(body: Body, location: Location): void {
    return unported("rustc_middle::mir::visit::MutVisitor::visit_location");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:1037 visit_body_preserves_cfg (lane mir-visit)
  visit_body_preserves_cfg(body: Body): void {
    return unported("rustc_middle::mir::visit::MutVisitor::visit_body_preserves_cfg");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:1041 super_body_preserves_cfg (lane mir-visit)
  super_body_preserves_cfg(body: Body): void {
    return unported("rustc_middle::mir::visit::MutVisitor::super_body_preserves_cfg");
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:1111 tcx
  abstract tcx(): TyCtxt;

  // stub: compiler/rustc_middle/src/mir/visit.rs:1113 super_place (lane mir-visit)
  super_place(place: Place, context: PlaceContext, location: Location): void {
    return unported("rustc_middle::mir::visit::MutVisitor::super_place");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:1126 process_projection (lane mir-visit)
  process_projection(projection: readonly PlaceElem[], location: Location): PlaceElem[] | undefined {
    return unported("rustc_middle::mir::visit::MutVisitor::process_projection");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:1150 process_projection_elem (lane mir-visit)
  process_projection_elem(elem: PlaceElem, location: Location): PlaceElem | undefined {
    return unported("rustc_middle::mir::visit::MutVisitor::process_projection_elem");
  }
}

export interface PlaceContext_methods {
  // visit.rs:1386 (lane mir-visit)
  is_drop(self: PlaceContext): boolean;
  // visit.rs:1392 (lane mir-visit)
  is_borrow(self: PlaceContext): boolean;
  // visit.rs:1401 (lane mir-visit)
  is_address_of(self: PlaceContext): boolean;
  // visit.rs:1411 (lane mir-visit)
  may_observe_address(self: PlaceContext): boolean;
  // visit.rs:1429 (lane mir-visit)
  is_storage_marker(self: PlaceContext): boolean;
  // visit.rs:1438 (lane mir-visit)
  is_mutating_use(self: PlaceContext): boolean;
  // visit.rs:1444 (lane mir-visit)
  is_use(self: PlaceContext): boolean;
  // visit.rs:1449 (lane mir-visit)
  is_place_assignment(self: PlaceContext): boolean;
  // visit.rs:1461 (lane mir-visit)
  ambient_variance(self: PlaceContext): Variance;
}
export type PlaceContext = gen_PlaceContext;
export const PlaceContext = {} as PlaceContext_methods;

/// Returns `true` if this place context represents a drop.
// stub: compiler/rustc_middle/src/mir/visit.rs:1386 is_drop (lane mir-visit)
PlaceContext.is_drop = function (self: PlaceContext): boolean {
  return unported("rustc_middle::mir::visit::PlaceContext::is_drop");
};

/// Returns `true` if this place context represents a borrow, excluding fake borrows
/// (which are an artifact of borrowck and not actually borrows in runtime MIR).
// stub: compiler/rustc_middle/src/mir/visit.rs:1392 is_borrow (lane mir-visit)
PlaceContext.is_borrow = function (self: PlaceContext): boolean {
  return unported("rustc_middle::mir::visit::PlaceContext::is_borrow");
};

/// Returns `true` if this place context represents a raw borrow.
// stub: compiler/rustc_middle/src/mir/visit.rs:1401 is_address_of (lane mir-visit)
PlaceContext.is_address_of = function (self: PlaceContext): boolean {
  return unported("rustc_middle::mir::visit::PlaceContext::is_address_of");
};

/// Returns `true` if this place context may be used to know the address of the given place.
// stub: compiler/rustc_middle/src/mir/visit.rs:1411 may_observe_address (lane mir-visit)
PlaceContext.may_observe_address = function (self: PlaceContext): boolean {
  return unported("rustc_middle::mir::visit::PlaceContext::may_observe_address");
};

/// Returns `true` if this place context represents a storage live or storage dead marker.
// stub: compiler/rustc_middle/src/mir/visit.rs:1429 is_storage_marker (lane mir-visit)
PlaceContext.is_storage_marker = function (self: PlaceContext): boolean {
  return unported("rustc_middle::mir::visit::PlaceContext::is_storage_marker");
};

/// Returns `true` if this place context represents a use that potentially changes the value.
// stub: compiler/rustc_middle/src/mir/visit.rs:1438 is_mutating_use (lane mir-visit)
PlaceContext.is_mutating_use = function (self: PlaceContext): boolean {
  return unported("rustc_middle::mir::visit::PlaceContext::is_mutating_use");
};

/// Returns `true` if this place context represents a use.
// stub: compiler/rustc_middle/src/mir/visit.rs:1444 is_use (lane mir-visit)
PlaceContext.is_use = function (self: PlaceContext): boolean {
  return unported("rustc_middle::mir::visit::PlaceContext::is_use");
};

/// Returns `true` if this place context represents an assignment statement.
// stub: compiler/rustc_middle/src/mir/visit.rs:1449 is_place_assignment (lane mir-visit)
PlaceContext.is_place_assignment = function (self: PlaceContext): boolean {
  return unported("rustc_middle::mir::visit::PlaceContext::is_place_assignment");
};

// stub: compiler/rustc_middle/src/mir/visit.rs:1461 ambient_variance (lane mir-visit)
PlaceContext.ambient_variance = function (self: PlaceContext): Variance {
  return unported("rustc_middle::mir::visit::PlaceContext::ambient_variance");
};

/// Small utility to visit places and locals without manually implementing a full visitor.
// rustc-type: compiler/rustc_middle/src/mir/visit.rs:1479 VisitPlacesWith
export class VisitPlacesWith extends Visitor {
  constructor(public _0: (place: Place, ctxt: PlaceContext) => void) {
    super();
  }

  // impl<'tcx, F> Visitor<'tcx> for VisitPlacesWith<F> where F: FnMut(Place<'tcx>, PlaceContext)
  // stub: compiler/rustc_middle/src/mir/visit.rs:1485 visit_local (lane mir-visit)
  override visit_local(local: Local, ctxt: PlaceContext, _2: Location): void {
    return unported("rustc_middle::mir::visit::<VisitPlacesWith as Visitor>::visit_local");
  }

  // stub: compiler/rustc_middle/src/mir/visit.rs:1489 visit_place (lane mir-visit)
  override visit_place(place: Place, ctxt: PlaceContext, location: Location): void {
    return unported("rustc_middle::mir::visit::<VisitPlacesWith as Visitor>::visit_place");
  }
}
