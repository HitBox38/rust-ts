// Port of compiler/rustc_middle/src/mir/visit.rs (lane mir-contract declared it, plan-m4 D4; lane mir-visit filled it):
// `make_mir_visitor!` (visit.rs:68, instantiated at :1276 / :1277) is hand-expanded twice, into the classes `Visitor`
// (`make_mir_visitor!(Visitor,)`) and `MutVisitor` (`make_mir_visitor!(MutVisitor, mut)`), each method carrying the line
// of its `fn` in the macro (so every macro fn has two declarations), in macro expansion order: `extra_body_methods!(mut)`
// (:81) and `visit_place_fns!(mut)` (:182) go to `MutVisitor` only, `visit_place_fns!()` (:182) to `Visitor` only, at
// their invocation sites. The helper macros `super_body!` (:1048), `basic_blocks!` (:1014), `basic_blocks_iter!` (:1026)
// and `type_annotations!` (:1087) are expanded in place (`super_body!` three times: `Visitor::super_body`,
// `MutVisitor::super_body` with `invalidate = true`, `MutVisitor::super_body_preserves_cfg` with `false`).
// The context enums (`TyContext`, `PlaceContext`, ...) are generated into visit.gen.ts (set rustc_middle_mir).
//
// PORT (D4): a trait with provided methods is a class (precedent rustc_middle thir/visit.ts): implementors `extends
// Visitor` / `MutVisitor` and override; `self.super_x(..)` is `this.super_x(..)`. `MutVisitor::tcx` is abstract.
// PORT (D4): in `MutVisitor`, the callbacks that receive `&mut` of a `Copy` leaf (`$(&$mutability)? T`: `Local`, `Ty`,
// `ty::Const`, `Region`, `Span`, `SourceScope`, `Variance`, and `&mut GenericArgsRef`) take a `MutRef<T>` (PORTING §8):
// a visitor replaces the value with `r.value = ..`, and the `super_*` walkers write it back into the MIR (e.g.
// `super_place` with `field_mut(place, "local")`). `&mut` of non-`Copy` nodes (`Body`, `Statement`, `Place`, `Operand`,
// `SourceInfo`, ...) is the object itself, edited in place. In `Visitor` every argument is passed as is.
// PORT: `&mut` of a temporary (`&mut body.return_ty()`, `&mut RETURN_PLACE` in `Return`) is a fresh `{ value }` that is
// not written back, as upstream; `&mut` of an `Option<Copy>` field's payload (`if let Some(x) = &mut o.f`) is
// `field_mut(o, "f")` narrowed to the payload type once the field is known to be `Some`.
import "./mod.ts";
import { bug } from "../../rustc_span/macros.ts";
import type { Span } from "../../rustc_span/lib.ts";
import type { Const as ty_Const } from "../../rustc_type_ir/sty/consts.ts";
import type { Variance } from "../../rustc_type_ir/lib.ts";
import { PLAIN } from "../../std/fmt.ts";
import { field_mut, type MutRef } from "../../std/mut_ref.ts";
import { panic, unreachable } from "../../std/panic.ts";
import type { TyCtxt } from "../ty/context.ts";
import type { Region, Ty } from "../ty/decls.ts";
import type { GenericArgsRef } from "../ty/generic_args.ts";
import { type CanonicalUserTypeAnnotation, UserTypeAnnotationIndex } from "../ty/typeck_results.ts";
import type { CoverageKind } from "./coverage.ts";
import {
  BasicBlock,
  type BasicBlockData,
  type Body,
  clone_Place,
  clone_SourceInfo,
  debug_Local,
  Local,
  Location,
  RETURN_PLACE,
  SourceInfo,
  type SourceScope,
  type SourceScopeData,
  type UserTypeProjection,
  type VarDebugInfo,
  type LocalDecl,
} from "./mod.ts";
import { Place_from_Local, type PlaceRef, type Statement, type StmtDebugInfo } from "./statement.ts";
import type { AssertMessage, ConstOperand, Operand, Place, PlaceElem, Rvalue } from "./syntax.ts";
import type { Terminator } from "./terminator.ts";
import { NonUseContext, type PlaceContext as gen_PlaceContext, type TyContext } from "./visit.gen.ts";
export * from "./visit.gen.ts";

/// `assert_eq!(local, RETURN_PLACE, "`MutVisitor` tried to mutate return place of `return` terminator")` (visit.rs:543).
function assert_return_place(local: Local): void {
  if (!(local === RETURN_PLACE)) {
    panic(
      `assertion \`left == right\` failed: \`MutVisitor\` tried to mutate return place of \`return\` terminator\n  left: ${debug_Local(local, PLAIN)}\n right: ${debug_Local(RETURN_PLACE, PLAIN)}`,
    );
  }
}

// ---- make_mir_visitor!(Visitor,) ----

export abstract class Visitor {
  // Override these, and call `self.super_xxx` to revert back to the
  // default behavior.

  // rustc: compiler/rustc_middle/src/mir/visit.rs:74 visit_body
  visit_body(body: Body): void {
    this.super_body(body);
  }

  // extra_body_methods!() expands to nothing.

  // rustc: compiler/rustc_middle/src/mir/visit.rs:83 visit_basic_block_data
  visit_basic_block_data(block: BasicBlock, data: BasicBlockData): void {
    this.super_basic_block_data(block, data);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:91 visit_source_scope_data
  visit_source_scope_data(scope_data: SourceScopeData): void {
    this.super_source_scope_data(scope_data);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:98 visit_statement_debuginfo
  visit_statement_debuginfo(stmt_debuginfo: StmtDebugInfo, location: Location): void {
    this.super_statement_debuginfo(stmt_debuginfo, location);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:106 visit_statement
  visit_statement(statement: Statement, location: Location): void {
    this.super_statement(statement, location);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:114 visit_assign
  visit_assign(place: Place, rvalue: Rvalue, location: Location): void {
    this.super_assign(place, rvalue, location);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:123 visit_terminator
  visit_terminator(terminator: Terminator, location: Location): void {
    this.super_terminator(terminator, location);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:131 visit_assert_message
  visit_assert_message(msg: AssertMessage, location: Location): void {
    this.super_assert_message(msg, location);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:139 visit_rvalue
  visit_rvalue(rvalue: Rvalue, location: Location): void {
    this.super_rvalue(rvalue, location);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:147 visit_operand
  visit_operand(operand: Operand, location: Location): void {
    this.super_operand(operand, location);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:155 visit_ascribe_user_ty
  visit_ascribe_user_ty(place: Place, variance: Variance, user_ty: UserTypeProjection, location: Location): void {
    this.super_ascribe_user_ty(place, variance, user_ty, location);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:165 visit_coverage
  visit_coverage(kind: CoverageKind, location: Location): void {
    this.super_coverage(kind, location);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:173 visit_place
  visit_place(place: Place, context: PlaceContext, location: Location): void {
    this.super_place(place, context, location);
  }

  // ---- visit_place_fns!() ----

  // rustc: compiler/rustc_middle/src/mir/visit.rs:1191 visit_projection
  visit_projection(place_ref: PlaceRef, context: PlaceContext, location: Location): void {
    this.super_projection(place_ref, context, location);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:1200 visit_projection_elem
  visit_projection_elem(place_ref: PlaceRef, elem: PlaceElem, context: PlaceContext, location: Location): void {
    this.super_projection_elem(place_ref, elem, context, location);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:1210 super_place
  super_place(place: Place, context: PlaceContext, location: Location): void {
    if (!(place.projection.length === 0) && PlaceContext.is_use(context)) {
      // ^ Only change the context if it is a real use, not a "use" in debuginfo.
      context = PlaceContext.is_mutating_use(context)
        ? { $: "MutatingUse", _0: "Projection" }
        : { $: "NonMutatingUse", _0: "Projection" };
    }

    this.visit_local(place.local, context, location);

    this.visit_projection(place.as_ref(), context, location);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:1230 super_projection
  super_projection(place_ref: PlaceRef, context: PlaceContext, location: Location): void {
    const projections = place_ref.iter_projections();
    // `.rev()`
    for (let i = projections.length - 1; i >= 0; i--) {
      const [base, elem] = projections[i]!;
      this.visit_projection_elem(base, elem, context, location);
    }
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:1241 super_projection_elem
  super_projection_elem(_place_ref: PlaceRef, elem: PlaceElem, context: PlaceContext, location: Location): void {
    switch (elem.$) {
      case "OpaqueCast":
      case "UnwrapUnsafeBinder":
        this.visit_ty(elem._0, { $: "Location", _0: location });
        break;
      case "Field":
        this.visit_ty(elem._1, { $: "Location", _0: location });
        break;
      case "Index": {
        const local = elem._0;
        this.visit_local(
          local,
          PlaceContext.is_use(context)
            ? // ^ Only change the context if it is a real use, not a "use" in debuginfo.
              { $: "NonMutatingUse", _0: "Copy" }
            : context,
          location,
        );
        break;
      }
      case "Deref":
      case "PhantomDeref":
      case "Subslice":
      case "ConstantIndex":
      case "Downcast":
        break;
    }
  }

  // ---- end visit_place_fns!() ----

  /// This is called for every constant in the MIR body and every `required_consts`
  /// (i.e., including consts that have been dead-code-eliminated).
  // rustc: compiler/rustc_middle/src/mir/visit.rs:186 visit_const_operand
  visit_const_operand(constant: ConstOperand, location: Location): void {
    this.super_const_operand(constant, location);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:194 visit_ty_const
  visit_ty_const(ct: ty_Const, location: Location): void {
    this.super_ty_const(ct, location);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:202 visit_span
  visit_span(span: Span): void {
    this.super_span(span);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:209 visit_source_info
  visit_source_info(source_info: SourceInfo): void {
    this.super_source_info(source_info);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:216 visit_ty
  visit_ty(ty: Ty, _1: TyContext): void {
    this.super_ty(ty);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:224 visit_user_type_projection
  visit_user_type_projection(ty: UserTypeProjection): void {
    this.super_user_type_projection(ty);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:231 visit_user_type_annotation
  visit_user_type_annotation(index: UserTypeAnnotationIndex, ty: CanonicalUserTypeAnnotation): void {
    this.super_user_type_annotation(index, ty);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:239 visit_region
  visit_region(region: Region, _1: Location): void {
    this.super_region(region);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:247 visit_args
  visit_args(args: GenericArgsRef, _1: Location): void {
    this.super_args(args);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:255 visit_local_decl
  visit_local_decl(local: Local, local_decl: LocalDecl): void {
    this.super_local_decl(local, local_decl);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:263 visit_var_debug_info
  visit_var_debug_info(var_debug_info: VarDebugInfo): void {
    this.super_var_debug_info(var_debug_info);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:270 visit_local
  visit_local(local: Local, context: PlaceContext, location: Location): void {
    this.super_local(local, context, location);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:279 visit_source_scope
  visit_source_scope(scope: SourceScope): void {
    this.super_source_scope(scope);
  }

  // The `super_xxx` methods comprise the default behavior and are
  // not meant to be overridden.

  // rustc: compiler/rustc_middle/src/mir/visit.rs:289 super_body
  super_body(body: Body): void {
    // super_body!(self, body,) (visit.rs:1048)
    const span = body.span;
    const coroutine = body.coroutine;
    if (coroutine !== undefined) {
      const yield_ty = coroutine.yield_ty;
      if (yield_ty !== undefined) {
        this.visit_ty(yield_ty, { $: "YieldTy", _0: SourceInfo.outermost(span) });
      }
      const resume_ty = coroutine.resume_ty;
      if (resume_ty !== undefined) {
        this.visit_ty(resume_ty, { $: "ResumeTy", _0: SourceInfo.outermost(span) });
      }
    }

    for (const var_debug_info of body.var_debug_info) {
      this.visit_var_debug_info(var_debug_info);
    }

    // basic_blocks_iter!(body,) = body.basic_blocks.iter_enumerated()
    const basic_blocks = body.basic_blocks.deref();
    for (let i = 0; i < basic_blocks.length; i++) {
      this.visit_basic_block_data(BasicBlock.new(i), basic_blocks[i]!);
    }

    for (const scope of body.source_scopes) {
      this.visit_source_scope_data(scope);
    }

    this.visit_ty(body.return_ty(), { $: "ReturnTy", _0: SourceInfo.outermost(body.span) });

    for (let i = 0; i < body.local_decls.length; i++) {
      const local = Local.new(i);
      this.visit_local_decl(local, body.local_decls[local]!);
    }

    // type_annotations!() = body.user_type_annotations.iter_enumerated()
    const user_type_annotations = body.user_type_annotations;
    for (let i = 0; i < user_type_annotations.length; i++) {
      this.visit_user_type_annotation(UserTypeAnnotationIndex.new(i), user_type_annotations[i]!);
    }

    this.visit_span(body.span);

    const required_consts = body.required_consts;
    if (required_consts !== undefined) {
      for (const const_ of required_consts) {
        const location = Location.START;
        this.visit_const_operand(const_, location);
      }
    }
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:296 super_basic_block_data
  super_basic_block_data(block: BasicBlock, data: BasicBlockData): void {
    const { statements, after_last_stmt_debuginfos, terminator } = data;

    let index = 0;
    for (const statement of statements) {
      const location = new Location(block, index);
      this.visit_statement(statement, location);
      index += 1;
    }

    const location = new Location(block, index);
    for (const debuginfo of after_last_stmt_debuginfos.deref()) {
      this.visit_statement_debuginfo(debuginfo, location);
    }
    if (terminator !== undefined) {
      this.visit_terminator(terminator, location);
    }
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:324 super_source_scope_data
  super_source_scope_data(scope_data: SourceScopeData): void {
    const { span, parent_scope, inlined, inlined_parent_scope } = scope_data;

    this.visit_span(span);
    if (parent_scope !== undefined) {
      this.visit_source_scope(parent_scope);
    }
    if (inlined !== undefined) {
      const [callee, callsite_span] = inlined;
      const location = Location.START;

      this.visit_span(callsite_span);

      const { def: callee_def, args: callee_args } = callee;
      if (callee_def.$ === "Item") {
        // ty::InstanceKind::Item(_def_id) => {}
      } else if (
        callee_def.$ === "Intrinsic" ||
        callee_def.$ === "LlvmIntrinsic" ||
        (callee_def.$ === "Shim" && callee_def._0.$ === "VTable") ||
        (callee_def.$ === "Shim" && callee_def._0.$ === "Reify") ||
        callee_def.$ === "Virtual" ||
        (callee_def.$ === "Shim" && callee_def._0.$ === "ThreadLocal") ||
        (callee_def.$ === "Shim" && callee_def._0.$ === "ClosureOnce") ||
        (callee_def.$ === "Shim" && callee_def._0.$ === "ConstructCoroutineInClosure") ||
        (callee_def.$ === "Shim" && callee_def._0.$ === "DropGlue" && callee_def._0._1 === undefined)
      ) {
        // {}
      } else if (callee_def.$ === "Shim") {
        const shim = callee_def._0;
        switch (shim.$) {
          case "FnPtr":
          case "DropGlue":
          case "Clone":
          case "FnPtrAsPtr":
          case "FnPtrFromPtr":
          case "AsyncDropGlue":
          case "AsyncDropGlueCtor":
            // FIXME(eddyb) use a better `TyContext` here.
            this.visit_ty(shim._1!, { $: "Location", _0: location });
            break;
          case "FutureDropPoll":
            this.visit_ty(shim._1, { $: "Location", _0: location });
            this.visit_ty(shim._2, { $: "Location", _0: location });
            break;
          default:
            bug(); // PORT: the arms above are exhaustive upstream
        }
      }
      this.visit_args(callee_args, location);
    }
    if (inlined_parent_scope !== undefined) {
      this.visit_source_scope(inlined_parent_scope);
    }
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:384 super_statement_debuginfo
  super_statement_debuginfo(stmt_debuginfo: StmtDebugInfo, location: Location): void {
    switch (stmt_debuginfo.$) {
      case "AssignRef": {
        const local = stmt_debuginfo._0;
        const place = stmt_debuginfo._1;
        this.visit_local(local, { $: "NonUse", _0: NonUseContext.VarDebugInfo }, location);
        this.visit_place(place, { $: "NonUse", _0: NonUseContext.VarDebugInfo }, location);
        break;
      }
      case "InvalidAssign": {
        const local = stmt_debuginfo._0;
        this.visit_local(local, { $: "NonUse", _0: NonUseContext.VarDebugInfo }, location);
        break;
      }
    }
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:412 super_statement
  super_statement(statement: Statement, location: Location): void {
    const { source_info, kind, debuginfos } = statement;

    this.visit_source_info(source_info);
    for (const debuginfo of debuginfos.deref()) {
      this.visit_statement_debuginfo(debuginfo, location);
    }
    switch (kind.$) {
      case "Assign": {
        const [place, rvalue] = kind._0;
        this.visit_assign(place, rvalue, location);
        break;
      }
      case "FakeRead": {
        const place = kind._0[1];
        this.visit_place(place, { $: "NonMutatingUse", _0: "Inspect" }, location);
        break;
      }
      case "SetDiscriminant":
        this.visit_place(kind.place, { $: "MutatingUse", _0: "SetDiscriminant" }, location);
        break;
      case "StorageLive":
        this.visit_local(kind._0, { $: "NonUse", _0: NonUseContext.StorageLive }, location);
        break;
      case "StorageDead":
        this.visit_local(kind._0, { $: "NonUse", _0: NonUseContext.StorageDead }, location);
        break;
      case "PlaceMention":
        this.visit_place(kind._0, { $: "NonMutatingUse", _0: "PlaceMention" }, location);
        break;
      case "AscribeUserType": {
        const [place, user_ty] = kind._0;
        this.visit_ascribe_user_ty(place, kind._1, user_ty, location);
        break;
      }
      case "Coverage":
        this.visit_coverage(kind._0, location);
        break;
      case "Intrinsic": {
        const intrinsic = kind._0;
        switch (intrinsic.$) {
          case "Assume":
            this.visit_operand(intrinsic._0, location);
            break;
          case "CopyNonOverlapping": {
            const { src, dst, count } = intrinsic._0;
            this.visit_operand(src, location);
            this.visit_operand(dst, location);
            this.visit_operand(count, location);
            break;
          }
        }
        break;
      }
      case "BackwardIncompatibleDropHint":
        this.visit_place(kind.place, { $: "NonUse", _0: NonUseContext.BackwardIncompatibleDropHint }, location);
        break;
      case "ConstEvalCounter":
        break;
      case "Nop":
        break;
    }
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:502 super_assign
  super_assign(place: Place, rvalue: Rvalue, location: Location): void {
    this.visit_place(place, { $: "MutatingUse", _0: "Store" }, location);
    this.visit_rvalue(rvalue, location);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:516 super_terminator
  super_terminator(terminator: Terminator, location: Location): void {
    const { source_info, kind } = terminator;

    this.visit_source_info(source_info);
    switch (kind.$) {
      case "Goto":
      case "UnwindResume":
      case "UnwindTerminate":
      case "CoroutineDrop":
      case "Unreachable":
      case "FalseEdge":
      case "FalseUnwind":
        break;

      case "Return": {
        // `return` logically moves from the return place `_0`. Note that the place
        // cannot be changed by any visitor, though.
        const local = RETURN_PLACE;
        this.visit_local(local, { $: "NonMutatingUse", _0: "Move" }, location);

        assert_return_place(local);
        break;
      }

      case "SwitchInt":
        this.visit_operand(kind.discr, location);
        break;

      case "Drop":
        this.visit_place(kind.place, { $: "MutatingUse", _0: "Drop" }, location);
        break;

      case "Call": {
        const { func, args, destination } = kind;
        this.visit_span(kind.fn_span);
        this.visit_operand(func, location);
        for (const arg of args) {
          this.visit_operand(arg.node, location);
        }
        this.visit_place(destination, { $: "MutatingUse", _0: "Call" }, location);
        break;
      }

      case "TailCall": {
        const { func, args } = kind;
        this.visit_span(kind.fn_span);
        this.visit_operand(func, location);
        for (const arg of args) {
          this.visit_operand(arg.node, location);
        }
        break;
      }

      case "Assert":
        this.visit_operand(kind.cond, location);
        this.visit_assert_message(kind.msg, location);
        break;

      case "Yield":
        this.visit_operand(kind.value, location);
        this.visit_place(kind.resume_arg, { $: "MutatingUse", _0: "Yield" }, location);
        break;

      case "InlineAsm":
        for (const op of kind.operands) {
          if (op.$ === "In") {
            this.visit_operand(op.value, location);
          } else if (op.$ === "Out" && op.place !== undefined) {
            this.visit_place(op.place, { $: "MutatingUse", _0: "AsmOutput" }, location);
          } else if (op.$ === "InOut") {
            this.visit_operand(op.in_value, location);
            const out_place = op.out_place;
            if (out_place !== undefined) {
              this.visit_place(out_place, { $: "MutatingUse", _0: "AsmOutput" }, location);
            }
          } else if (op.$ === "Const" || op.$ === "SymFn") {
            this.visit_const_operand(op.value, location);
          } else {
            // InlineAsmOperand::Out { place: None, .. } | SymStatic { def_id: _ } | Label { target_index: _ } => {}
          }
        }
        break;
    }
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:655 super_assert_message
  super_assert_message(msg: AssertMessage, location: Location): void {
    switch (msg.$) {
      case "BoundsCheck":
        this.visit_operand(msg.len, location);
        this.visit_operand(msg.index, location);
        break;
      case "Overflow":
        this.visit_operand(msg._1, location);
        this.visit_operand(msg._2, location);
        break;
      case "OverflowNeg":
      case "DivisionByZero":
      case "RemainderByZero":
      case "InvalidEnumConstruction":
        this.visit_operand(msg._0, location);
        break;
      case "ResumedAfterReturn":
      case "ResumedAfterPanic":
      case "NullPointerDereference":
      case "NullReferenceConstructed":
      case "ResumedAfterDrop":
        // Nothing to visit
        break;
      case "MisalignedPointerDereference":
        this.visit_operand(msg.required, location);
        this.visit_operand(msg.found, location);
        break;
    }
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:683 super_rvalue
  super_rvalue(rvalue: Rvalue, location: Location): void {
    switch (rvalue.$) {
      case "Use":
        this.visit_operand(rvalue._0, location);
        break;

      case "Repeat":
        this.visit_operand(rvalue._0, location);
        this.visit_ty_const(rvalue._1, location);
        break;

      case "ThreadLocalRef":
        break;

      case "Ref": {
        const bk = rvalue._1;
        this.visit_region(rvalue._0, location);
        let ctx: PlaceContext;
        switch (bk.$) {
          case "Shared":
            ctx = { $: "NonMutatingUse", _0: "SharedBorrow" };
            break;
          case "Fake":
            ctx = { $: "NonMutatingUse", _0: "FakeBorrow" };
            break;
          case "Mut":
            ctx = { $: "MutatingUse", _0: "Borrow" };
            break;
        }
        this.visit_place(rvalue._2, ctx, location);
        break;
      }

      case "Reborrow": {
        const mutability = rvalue._1;
        this.visit_ty(rvalue._0, { $: "Location", _0: location });
        let ctx: PlaceContext;
        switch (mutability) {
          case "Not":
            ctx = { $: "NonMutatingUse", _0: "SharedBorrow" };
            break;
          case "Mut":
            ctx = { $: "MutatingUse", _0: "Borrow" };
            break;
        }
        this.visit_place(rvalue._2, ctx, location);
        break;
      }

      case "CopyForDeref":
        this.visit_place(rvalue._0, { $: "NonMutatingUse", _0: "Inspect" }, location);
        break;

      case "RawPtr": {
        let ctx: PlaceContext;
        switch (rvalue._0) {
          case "Mut":
            ctx = { $: "MutatingUse", _0: "RawBorrow" };
            break;
          case "Const":
            ctx = { $: "NonMutatingUse", _0: "RawBorrow" };
            break;
          case "FakeForPtrMetadata":
            ctx = { $: "NonMutatingUse", _0: "Inspect" };
            break;
        }
        this.visit_place(rvalue._1, ctx, location);
        break;
      }

      case "Cast":
        this.visit_operand(rvalue._1, location);
        this.visit_ty(rvalue._2, { $: "Location", _0: location });
        break;

      case "BinaryOp": {
        const [lhs, rhs] = rvalue._1;
        this.visit_operand(lhs, location);
        this.visit_operand(rhs, location);
        break;
      }

      case "UnaryOp":
        this.visit_operand(rvalue._1, location);
        break;

      case "Discriminant":
        this.visit_place(rvalue._0, { $: "NonMutatingUse", _0: "Inspect" }, location);
        break;

      case "Aggregate": {
        const kind = rvalue._0;
        switch (kind.$) {
          case "Array":
            this.visit_ty(kind._0, { $: "Location", _0: location });
            break;
          case "Tuple":
            break;
          case "Adt":
            this.visit_args(kind._2, location);
            break;
          case "Closure":
            this.visit_args(kind._1, location);
            break;
          case "Coroutine":
            this.visit_args(kind._1, location);
            break;
          case "CoroutineClosure":
            this.visit_args(kind._1, location);
            break;
          case "RawPtr":
            this.visit_ty(kind._0, { $: "Location", _0: location });
            break;
        }

        for (const operand of rvalue._1) {
          this.visit_operand(operand, location);
        }
        break;
      }

      case "WrapUnsafeBinder":
        this.visit_operand(rvalue._0, location);
        this.visit_ty(rvalue._1, { $: "Location", _0: location });
        break;
    }
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:816 super_operand
  super_operand(operand: Operand, location: Location): void {
    switch (operand.$) {
      case "Copy":
        this.visit_place(operand._0, { $: "NonMutatingUse", _0: "Copy" }, location);
        break;
      case "Move":
        this.visit_place(operand._0, { $: "NonMutatingUse", _0: "Move" }, location);
        break;
      case "Constant":
        this.visit_const_operand(operand._0, location);
        break;
      case "RuntimeChecks":
        break;
    }
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:843 super_ascribe_user_ty
  super_ascribe_user_ty(place: Place, variance: Variance, user_ty: UserTypeProjection, location: Location): void {
    this.visit_place(place, { $: "NonUse", _0: { $: "AscribeUserTy", _0: variance } }, location);
    this.visit_user_type_projection(user_ty);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:860 super_coverage
  super_coverage(_kind: CoverageKind, _location: Location): void {}

  // rustc: compiler/rustc_middle/src/mir/visit.rs:867 super_local_decl
  super_local_decl(local: Local, local_decl: LocalDecl): void {
    const { ty, user_ty, source_info } = local_decl;

    this.visit_source_info(source_info);

    this.visit_ty(ty, { $: "LocalDecl", local, source_info: clone_SourceInfo(source_info) });
    if (user_ty !== undefined) {
      for (const user_ty_ of user_ty.contents) {
        this.visit_user_type_projection(user_ty_);
      }
    }
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:893 super_local
  super_local(_local: Local, _context: PlaceContext, _location: Location): void {}

  // rustc: compiler/rustc_middle/src/mir/visit.rs:901 super_var_debug_info
  super_var_debug_info(var_debug_info: VarDebugInfo): void {
    const { source_info, composite, value } = var_debug_info;

    this.visit_source_info(source_info);
    const location = Location.START;
    if (composite !== undefined) {
      const { ty, projection } = composite;
      this.visit_ty(ty, { $: "Location", _0: location });
      for (const elem of projection) {
        if (elem.$ !== "Field") bug();
        const ty = elem._1;
        this.visit_ty(ty, { $: "Location", _0: location });
      }
    }
    switch (value.$) {
      case "Const":
        this.visit_const_operand(value._0, location);
        break;
      case "Place":
        this.visit_place(value._0, { $: "NonUse", _0: NonUseContext.VarDebugInfo }, location);
        break;
    }
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:936 super_source_scope
  super_source_scope(_scope: SourceScope): void {}

  // rustc: compiler/rustc_middle/src/mir/visit.rs:938 super_const_operand
  super_const_operand(constant: ConstOperand, location: Location): void {
    const { span, const_ } = constant;

    this.visit_span(span);
    switch (const_.$) {
      case "Ty":
        this.visit_ty_const(const_._1, location);
        break;
      case "Val":
      case "Unevaluated":
        this.visit_ty(const_._1, { $: "Location", _0: location });
        break;
    }
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:958 super_ty_const
  super_ty_const(_ct: ty_Const, _location: Location): void {}

  // rustc: compiler/rustc_middle/src/mir/visit.rs:965 super_span
  super_span(_span: Span): void {}

  // rustc: compiler/rustc_middle/src/mir/visit.rs:967 super_source_info
  super_source_info(source_info: SourceInfo): void {
    const { span, scope } = source_info;

    this.visit_span(span);
    this.visit_source_scope(scope);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:974 super_user_type_projection
  super_user_type_projection(_ty: UserTypeProjection): void {}

  // rustc: compiler/rustc_middle/src/mir/visit.rs:976 super_user_type_annotation
  super_user_type_annotation(_index: UserTypeAnnotationIndex, ty: CanonicalUserTypeAnnotation): void {
    this.visit_span(ty.span);
    this.visit_ty(ty.inferred_ty, { $: "UserTy", _0: ty.span });
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:985 super_ty
  super_ty(_ty: Ty): void {}

  // rustc: compiler/rustc_middle/src/mir/visit.rs:987 super_region
  super_region(_region: Region): void {}

  // rustc: compiler/rustc_middle/src/mir/visit.rs:989 super_args
  super_args(_args: GenericArgsRef): void {}

  // Convenience methods

  // rustc: compiler/rustc_middle/src/mir/visit.rs:993 visit_location
  visit_location(body: Body, location: Location): void {
    // basic_blocks!(body,) = body.basic_blocks
    const basic_block = body.basic_blocks.deref()[location.block]!;
    if (basic_block.statements.length === location.statement_index) {
      const terminator = basic_block.terminator;
      if (terminator !== undefined) {
        this.visit_terminator(terminator, location);
      }
    } else {
      const statement = basic_block.statements[location.statement_index]!;
      this.visit_statement(statement, location);
    }
  }
}

// ---- make_mir_visitor!(MutVisitor, mut) ----

export abstract class MutVisitor {
  // Override these, and call `self.super_xxx` to revert back to the
  // default behavior.

  // rustc: compiler/rustc_middle/src/mir/visit.rs:74 visit_body
  visit_body(body: Body): void {
    this.super_body(body);
  }

  // ---- extra_body_methods!(mut) ----

  // rustc: compiler/rustc_middle/src/mir/visit.rs:1037 visit_body_preserves_cfg
  visit_body_preserves_cfg(body: Body): void {
    this.super_body_preserves_cfg(body);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:1041 super_body_preserves_cfg
  super_body_preserves_cfg(body: Body): void {
    // super_body!(self, body, mut, false) (visit.rs:1048)
    const span = body.span;
    const coroutine = body.coroutine;
    if (coroutine !== undefined) {
      if (coroutine.yield_ty !== undefined) {
        const yield_ty = field_mut(coroutine, "yield_ty") as MutRef<Ty>;
        this.visit_ty(yield_ty, { $: "YieldTy", _0: SourceInfo.outermost(span) });
      }
      if (coroutine.resume_ty !== undefined) {
        const resume_ty = field_mut(coroutine, "resume_ty") as MutRef<Ty>;
        this.visit_ty(resume_ty, { $: "ResumeTy", _0: SourceInfo.outermost(span) });
      }
    }

    for (const var_debug_info of body.var_debug_info) {
      this.visit_var_debug_info(var_debug_info);
    }

    // basic_blocks_iter!(body, mut, false) = body.basic_blocks.as_mut_preserves_cfg().iter_enumerated_mut()
    const basic_blocks = body.basic_blocks.as_mut_preserves_cfg();
    for (let i = 0; i < basic_blocks.length; i++) {
      this.visit_basic_block_data(BasicBlock.new(i), basic_blocks[i]!);
    }

    for (const scope of body.source_scopes) {
      this.visit_source_scope_data(scope);
    }

    this.visit_ty({ value: body.return_ty() }, { $: "ReturnTy", _0: SourceInfo.outermost(body.span) });

    for (let i = 0; i < body.local_decls.length; i++) {
      const local = Local.new(i);
      this.visit_local_decl(local, body.local_decls[local]!);
    }

    // type_annotations!(mut) = body.user_type_annotations.iter_enumerated_mut()
    const user_type_annotations = body.user_type_annotations;
    for (let i = 0; i < user_type_annotations.length; i++) {
      this.visit_user_type_annotation(UserTypeAnnotationIndex.new(i), user_type_annotations[i]!);
    }

    this.visit_span(field_mut(body, "span"));

    const required_consts = body.required_consts;
    if (required_consts !== undefined) {
      for (const const_ of required_consts) {
        const location = Location.START;
        this.visit_const_operand(const_, location);
      }
    }
  }

  // ---- end extra_body_methods!(mut) ----

  // rustc: compiler/rustc_middle/src/mir/visit.rs:83 visit_basic_block_data
  visit_basic_block_data(block: BasicBlock, data: BasicBlockData): void {
    this.super_basic_block_data(block, data);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:91 visit_source_scope_data
  visit_source_scope_data(scope_data: SourceScopeData): void {
    this.super_source_scope_data(scope_data);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:98 visit_statement_debuginfo
  visit_statement_debuginfo(stmt_debuginfo: StmtDebugInfo, location: Location): void {
    this.super_statement_debuginfo(stmt_debuginfo, location);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:106 visit_statement
  visit_statement(statement: Statement, location: Location): void {
    this.super_statement(statement, location);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:114 visit_assign
  visit_assign(place: Place, rvalue: Rvalue, location: Location): void {
    this.super_assign(place, rvalue, location);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:123 visit_terminator
  visit_terminator(terminator: Terminator, location: Location): void {
    this.super_terminator(terminator, location);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:131 visit_assert_message
  visit_assert_message(msg: AssertMessage, location: Location): void {
    this.super_assert_message(msg, location);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:139 visit_rvalue
  visit_rvalue(rvalue: Rvalue, location: Location): void {
    this.super_rvalue(rvalue, location);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:147 visit_operand
  visit_operand(operand: Operand, location: Location): void {
    this.super_operand(operand, location);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:155 visit_ascribe_user_ty
  visit_ascribe_user_ty(place: Place, variance: MutRef<Variance>, user_ty: UserTypeProjection, location: Location): void {
    this.super_ascribe_user_ty(place, variance, user_ty, location);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:165 visit_coverage
  visit_coverage(kind: CoverageKind, location: Location): void {
    this.super_coverage(kind, location);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:173 visit_place
  visit_place(place: Place, context: PlaceContext, location: Location): void {
    this.super_place(place, context, location);
  }

  // ---- visit_place_fns!(mut) ----

  // rustc: compiler/rustc_middle/src/mir/visit.rs:1111 tcx
  abstract tcx(): TyCtxt;

  // rustc: compiler/rustc_middle/src/mir/visit.rs:1113 super_place
  super_place(place: Place, context: PlaceContext, location: Location): void {
    this.visit_local(field_mut(place, "local"), context, location);

    const new_projection = this.process_projection(place.projection, location);
    if (new_projection !== undefined) {
      place.projection = this.tcx().mk_place_elems(new_projection);
    }
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:1126 process_projection
  process_projection(projection: readonly PlaceElem[], location: Location): PlaceElem[] | undefined {
    // PORT: `Cow<'a, [PlaceElem]>`: `owned` is `Cow::Owned` once set, else the projection is `Cow::Borrowed`.
    let owned: PlaceElem[] | undefined = undefined;

    for (let i = 0; i < projection.length; i++) {
      const elem_ = (owned ?? projection)[i];
      if (elem_ !== undefined) {
        const elem = this.process_projection_elem(elem_, location);
        if (elem !== undefined) {
          // This converts the borrowed projection into `Cow::Owned(_)` and returns a
          // clone of the projection so we can mutate and reintern later.
          const vec = (owned ??= [...projection]);
          vec[i] = elem;
        }
      }
    }

    // Cow::Borrowed(_) => None, Cow::Owned(vec) => Some(vec)
    return owned;
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:1150 process_projection_elem
  process_projection_elem(elem: PlaceElem, location: Location): PlaceElem | undefined {
    switch (elem.$) {
      case "Index": {
        const local = elem._0;
        const new_local: MutRef<Local> = { value: local };
        this.visit_local(new_local, { $: "NonMutatingUse", _0: "Copy" }, location);

        return new_local.value === local ? undefined : { $: "Index", _0: new_local.value };
      }
      case "Field": {
        const field = elem._0;
        const ty = elem._1;
        const new_ty: MutRef<Ty> = { value: ty };
        this.visit_ty(new_ty, { $: "Location", _0: location });
        return ty !== new_ty.value ? { $: "Field", _0: field, _1: new_ty.value } : undefined;
      }
      case "OpaqueCast": {
        const ty = elem._0;
        const new_ty: MutRef<Ty> = { value: ty };
        this.visit_ty(new_ty, { $: "Location", _0: location });
        return ty !== new_ty.value ? { $: "OpaqueCast", _0: new_ty.value } : undefined;
      }
      case "UnwrapUnsafeBinder": {
        const ty = elem._0;
        const new_ty: MutRef<Ty> = { value: ty };
        this.visit_ty(new_ty, { $: "Location", _0: location });
        return ty !== new_ty.value ? { $: "UnwrapUnsafeBinder", _0: new_ty.value } : undefined;
      }
      case "Deref":
      case "PhantomDeref":
      case "ConstantIndex":
      case "Subslice":
      case "Downcast":
        return undefined;
    }
  }

  // ---- end visit_place_fns!(mut) ----

  /// This is called for every constant in the MIR body and every `required_consts`
  /// (i.e., including consts that have been dead-code-eliminated).
  // rustc: compiler/rustc_middle/src/mir/visit.rs:186 visit_const_operand
  visit_const_operand(constant: ConstOperand, location: Location): void {
    this.super_const_operand(constant, location);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:194 visit_ty_const
  visit_ty_const(ct: MutRef<ty_Const>, location: Location): void {
    this.super_ty_const(ct, location);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:202 visit_span
  visit_span(span: MutRef<Span>): void {
    this.super_span(span);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:209 visit_source_info
  visit_source_info(source_info: SourceInfo): void {
    this.super_source_info(source_info);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:216 visit_ty
  visit_ty(ty: MutRef<Ty>, _1: TyContext): void {
    this.super_ty(ty);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:224 visit_user_type_projection
  visit_user_type_projection(ty: UserTypeProjection): void {
    this.super_user_type_projection(ty);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:231 visit_user_type_annotation
  visit_user_type_annotation(index: UserTypeAnnotationIndex, ty: CanonicalUserTypeAnnotation): void {
    this.super_user_type_annotation(index, ty);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:239 visit_region
  visit_region(region: MutRef<Region>, _1: Location): void {
    this.super_region(region);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:247 visit_args
  visit_args(args: MutRef<GenericArgsRef>, _1: Location): void {
    this.super_args(args);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:255 visit_local_decl
  visit_local_decl(local: Local, local_decl: LocalDecl): void {
    this.super_local_decl(local, local_decl);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:263 visit_var_debug_info
  visit_var_debug_info(var_debug_info: VarDebugInfo): void {
    this.super_var_debug_info(var_debug_info);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:270 visit_local
  visit_local(local: MutRef<Local>, context: PlaceContext, location: Location): void {
    this.super_local(local, context, location);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:279 visit_source_scope
  visit_source_scope(scope: MutRef<SourceScope>): void {
    this.super_source_scope(scope);
  }

  // The `super_xxx` methods comprise the default behavior and are
  // not meant to be overridden.

  // rustc: compiler/rustc_middle/src/mir/visit.rs:289 super_body
  super_body(body: Body): void {
    // super_body!(self, body, mut, true) (visit.rs:1048)
    const span = body.span;
    const coroutine = body.coroutine;
    if (coroutine !== undefined) {
      if (coroutine.yield_ty !== undefined) {
        const yield_ty = field_mut(coroutine, "yield_ty") as MutRef<Ty>;
        this.visit_ty(yield_ty, { $: "YieldTy", _0: SourceInfo.outermost(span) });
      }
      if (coroutine.resume_ty !== undefined) {
        const resume_ty = field_mut(coroutine, "resume_ty") as MutRef<Ty>;
        this.visit_ty(resume_ty, { $: "ResumeTy", _0: SourceInfo.outermost(span) });
      }
    }

    for (const var_debug_info of body.var_debug_info) {
      this.visit_var_debug_info(var_debug_info);
    }

    // basic_blocks_iter!(body, mut, true) = body.basic_blocks.as_mut().iter_enumerated_mut()
    const basic_blocks = body.basic_blocks.as_mut();
    for (let i = 0; i < basic_blocks.length; i++) {
      this.visit_basic_block_data(BasicBlock.new(i), basic_blocks[i]!);
    }

    for (const scope of body.source_scopes) {
      this.visit_source_scope_data(scope);
    }

    this.visit_ty({ value: body.return_ty() }, { $: "ReturnTy", _0: SourceInfo.outermost(body.span) });

    for (let i = 0; i < body.local_decls.length; i++) {
      const local = Local.new(i);
      this.visit_local_decl(local, body.local_decls[local]!);
    }

    // type_annotations!(mut) = body.user_type_annotations.iter_enumerated_mut()
    const user_type_annotations = body.user_type_annotations;
    for (let i = 0; i < user_type_annotations.length; i++) {
      this.visit_user_type_annotation(UserTypeAnnotationIndex.new(i), user_type_annotations[i]!);
    }

    this.visit_span(field_mut(body, "span"));

    const required_consts = body.required_consts;
    if (required_consts !== undefined) {
      for (const const_ of required_consts) {
        const location = Location.START;
        this.visit_const_operand(const_, location);
      }
    }
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:296 super_basic_block_data
  super_basic_block_data(block: BasicBlock, data: BasicBlockData): void {
    const { statements, after_last_stmt_debuginfos, terminator } = data;

    let index = 0;
    for (const statement of statements) {
      const location = new Location(block, index);
      this.visit_statement(statement, location);
      index += 1;
    }

    const location = new Location(block, index);
    for (const debuginfo of after_last_stmt_debuginfos.deref_mut()) {
      this.visit_statement_debuginfo(debuginfo, location);
    }
    if (terminator !== undefined) {
      this.visit_terminator(terminator, location);
    }
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:324 super_source_scope_data
  super_source_scope_data(scope_data: SourceScopeData): void {
    const { parent_scope, inlined, inlined_parent_scope } = scope_data;

    this.visit_span(field_mut(scope_data, "span"));
    if (parent_scope !== undefined) {
      this.visit_source_scope(field_mut(scope_data, "parent_scope") as MutRef<SourceScope>);
    }
    if (inlined !== undefined) {
      const callee = inlined[0];
      const location = Location.START;

      this.visit_span(field_mut(inlined, 1));

      const callee_def = callee.def;
      if (callee_def.$ === "Item") {
        // ty::InstanceKind::Item(_def_id) => {}
      } else if (
        callee_def.$ === "Intrinsic" ||
        callee_def.$ === "LlvmIntrinsic" ||
        (callee_def.$ === "Shim" && callee_def._0.$ === "VTable") ||
        (callee_def.$ === "Shim" && callee_def._0.$ === "Reify") ||
        callee_def.$ === "Virtual" ||
        (callee_def.$ === "Shim" && callee_def._0.$ === "ThreadLocal") ||
        (callee_def.$ === "Shim" && callee_def._0.$ === "ClosureOnce") ||
        (callee_def.$ === "Shim" && callee_def._0.$ === "ConstructCoroutineInClosure") ||
        (callee_def.$ === "Shim" && callee_def._0.$ === "DropGlue" && callee_def._0._1 === undefined)
      ) {
        // {}
      } else if (callee_def.$ === "Shim") {
        const shim = callee_def._0;
        switch (shim.$) {
          case "FnPtr":
          case "DropGlue":
          case "Clone":
          case "FnPtrAsPtr":
          case "FnPtrFromPtr":
          case "AsyncDropGlue":
          case "AsyncDropGlueCtor":
            // FIXME(eddyb) use a better `TyContext` here.
            this.visit_ty(field_mut(shim, "_1") as MutRef<Ty>, { $: "Location", _0: location });
            break;
          case "FutureDropPoll":
            this.visit_ty(field_mut(shim, "_1"), { $: "Location", _0: location });
            this.visit_ty(field_mut(shim, "_2"), { $: "Location", _0: location });
            break;
          default:
            bug(); // PORT: the arms above are exhaustive upstream
        }
      }
      this.visit_args(field_mut(callee, "args"), location);
    }
    if (inlined_parent_scope !== undefined) {
      this.visit_source_scope(field_mut(scope_data, "inlined_parent_scope") as MutRef<SourceScope>);
    }
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:384 super_statement_debuginfo
  super_statement_debuginfo(stmt_debuginfo: StmtDebugInfo, location: Location): void {
    switch (stmt_debuginfo.$) {
      case "AssignRef": {
        const place = stmt_debuginfo._1;
        this.visit_local(field_mut(stmt_debuginfo, "_0"), { $: "NonUse", _0: NonUseContext.VarDebugInfo }, location);
        this.visit_place(place, { $: "NonUse", _0: NonUseContext.VarDebugInfo }, location);
        break;
      }
      case "InvalidAssign": {
        this.visit_local(field_mut(stmt_debuginfo, "_0"), { $: "NonUse", _0: NonUseContext.VarDebugInfo }, location);
        break;
      }
    }
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:412 super_statement
  super_statement(statement: Statement, location: Location): void {
    const { source_info, kind, debuginfos } = statement;

    this.visit_source_info(source_info);
    for (const debuginfo of debuginfos.deref_mut()) {
      this.visit_statement_debuginfo(debuginfo, location);
    }
    switch (kind.$) {
      case "Assign": {
        const [place, rvalue] = kind._0;
        this.visit_assign(place, rvalue, location);
        break;
      }
      case "FakeRead": {
        const place = kind._0[1];
        this.visit_place(place, { $: "NonMutatingUse", _0: "Inspect" }, location);
        break;
      }
      case "SetDiscriminant":
        this.visit_place(kind.place, { $: "MutatingUse", _0: "SetDiscriminant" }, location);
        break;
      case "StorageLive":
        this.visit_local(field_mut(kind, "_0"), { $: "NonUse", _0: NonUseContext.StorageLive }, location);
        break;
      case "StorageDead":
        this.visit_local(field_mut(kind, "_0"), { $: "NonUse", _0: NonUseContext.StorageDead }, location);
        break;
      case "PlaceMention":
        this.visit_place(kind._0, { $: "NonMutatingUse", _0: "PlaceMention" }, location);
        break;
      case "AscribeUserType": {
        const [place, user_ty] = kind._0;
        this.visit_ascribe_user_ty(place, field_mut(kind, "_1"), user_ty, location);
        break;
      }
      case "Coverage":
        this.visit_coverage(kind._0, location);
        break;
      case "Intrinsic": {
        const intrinsic = kind._0;
        switch (intrinsic.$) {
          case "Assume":
            this.visit_operand(intrinsic._0, location);
            break;
          case "CopyNonOverlapping": {
            const { src, dst, count } = intrinsic._0;
            this.visit_operand(src, location);
            this.visit_operand(dst, location);
            this.visit_operand(count, location);
            break;
          }
        }
        break;
      }
      case "BackwardIncompatibleDropHint":
        this.visit_place(kind.place, { $: "NonUse", _0: NonUseContext.BackwardIncompatibleDropHint }, location);
        break;
      case "ConstEvalCounter":
        break;
      case "Nop":
        break;
    }
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:502 super_assign
  super_assign(place: Place, rvalue: Rvalue, location: Location): void {
    this.visit_place(place, { $: "MutatingUse", _0: "Store" }, location);
    this.visit_rvalue(rvalue, location);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:516 super_terminator
  super_terminator(terminator: Terminator, location: Location): void {
    const { source_info, kind } = terminator;

    this.visit_source_info(source_info);
    switch (kind.$) {
      case "Goto":
      case "UnwindResume":
      case "UnwindTerminate":
      case "CoroutineDrop":
      case "Unreachable":
      case "FalseEdge":
      case "FalseUnwind":
        break;

      case "Return": {
        // `return` logically moves from the return place `_0`. Note that the place
        // cannot be changed by any visitor, though.
        const local: MutRef<Local> = { value: RETURN_PLACE };
        this.visit_local(local, { $: "NonMutatingUse", _0: "Move" }, location);

        assert_return_place(local.value);
        break;
      }

      case "SwitchInt":
        this.visit_operand(kind.discr, location);
        break;

      case "Drop":
        this.visit_place(kind.place, { $: "MutatingUse", _0: "Drop" }, location);
        break;

      case "Call": {
        const { func, args, destination } = kind;
        this.visit_span(field_mut(kind, "fn_span"));
        this.visit_operand(func, location);
        for (const arg of args) {
          this.visit_operand(arg.node, location);
        }
        this.visit_place(destination, { $: "MutatingUse", _0: "Call" }, location);
        break;
      }

      case "TailCall": {
        const { func, args } = kind;
        this.visit_span(field_mut(kind, "fn_span"));
        this.visit_operand(func, location);
        for (const arg of args) {
          this.visit_operand(arg.node, location);
        }
        break;
      }

      case "Assert":
        this.visit_operand(kind.cond, location);
        this.visit_assert_message(kind.msg, location);
        break;

      case "Yield":
        this.visit_operand(kind.value, location);
        this.visit_place(kind.resume_arg, { $: "MutatingUse", _0: "Yield" }, location);
        break;

      case "InlineAsm":
        for (const op of kind.operands) {
          if (op.$ === "In") {
            this.visit_operand(op.value, location);
          } else if (op.$ === "Out" && op.place !== undefined) {
            this.visit_place(op.place, { $: "MutatingUse", _0: "AsmOutput" }, location);
          } else if (op.$ === "InOut") {
            this.visit_operand(op.in_value, location);
            const out_place = op.out_place;
            if (out_place !== undefined) {
              this.visit_place(out_place, { $: "MutatingUse", _0: "AsmOutput" }, location);
            }
          } else if (op.$ === "Const" || op.$ === "SymFn") {
            this.visit_const_operand(op.value, location);
          } else {
            // InlineAsmOperand::Out { place: None, .. } | SymStatic { def_id: _ } | Label { target_index: _ } => {}
          }
        }
        break;
    }
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:655 super_assert_message
  super_assert_message(msg: AssertMessage, location: Location): void {
    switch (msg.$) {
      case "BoundsCheck":
        this.visit_operand(msg.len, location);
        this.visit_operand(msg.index, location);
        break;
      case "Overflow":
        this.visit_operand(msg._1, location);
        this.visit_operand(msg._2, location);
        break;
      case "OverflowNeg":
      case "DivisionByZero":
      case "RemainderByZero":
      case "InvalidEnumConstruction":
        this.visit_operand(msg._0, location);
        break;
      case "ResumedAfterReturn":
      case "ResumedAfterPanic":
      case "NullPointerDereference":
      case "NullReferenceConstructed":
      case "ResumedAfterDrop":
        // Nothing to visit
        break;
      case "MisalignedPointerDereference":
        this.visit_operand(msg.required, location);
        this.visit_operand(msg.found, location);
        break;
    }
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:683 super_rvalue
  super_rvalue(rvalue: Rvalue, location: Location): void {
    switch (rvalue.$) {
      case "Use":
        this.visit_operand(rvalue._0, location);
        break;

      case "Repeat":
        this.visit_operand(rvalue._0, location);
        this.visit_ty_const(field_mut(rvalue, "_1"), location);
        break;

      case "ThreadLocalRef":
        break;

      case "Ref": {
        const bk = rvalue._1;
        this.visit_region(field_mut(rvalue, "_0"), location);
        let ctx: PlaceContext;
        switch (bk.$) {
          case "Shared":
            ctx = { $: "NonMutatingUse", _0: "SharedBorrow" };
            break;
          case "Fake":
            ctx = { $: "NonMutatingUse", _0: "FakeBorrow" };
            break;
          case "Mut":
            ctx = { $: "MutatingUse", _0: "Borrow" };
            break;
        }
        this.visit_place(rvalue._2, ctx, location);
        break;
      }

      case "Reborrow": {
        const mutability = rvalue._1;
        this.visit_ty(field_mut(rvalue, "_0"), { $: "Location", _0: location });
        let ctx: PlaceContext;
        switch (mutability) {
          case "Not":
            ctx = { $: "NonMutatingUse", _0: "SharedBorrow" };
            break;
          case "Mut":
            ctx = { $: "MutatingUse", _0: "Borrow" };
            break;
        }
        this.visit_place(rvalue._2, ctx, location);
        break;
      }

      case "CopyForDeref":
        this.visit_place(rvalue._0, { $: "NonMutatingUse", _0: "Inspect" }, location);
        break;

      case "RawPtr": {
        let ctx: PlaceContext;
        switch (rvalue._0) {
          case "Mut":
            ctx = { $: "MutatingUse", _0: "RawBorrow" };
            break;
          case "Const":
            ctx = { $: "NonMutatingUse", _0: "RawBorrow" };
            break;
          case "FakeForPtrMetadata":
            ctx = { $: "NonMutatingUse", _0: "Inspect" };
            break;
        }
        this.visit_place(rvalue._1, ctx, location);
        break;
      }

      case "Cast":
        this.visit_operand(rvalue._1, location);
        this.visit_ty(field_mut(rvalue, "_2"), { $: "Location", _0: location });
        break;

      case "BinaryOp": {
        const [lhs, rhs] = rvalue._1;
        this.visit_operand(lhs, location);
        this.visit_operand(rhs, location);
        break;
      }

      case "UnaryOp":
        this.visit_operand(rvalue._1, location);
        break;

      case "Discriminant":
        this.visit_place(rvalue._0, { $: "NonMutatingUse", _0: "Inspect" }, location);
        break;

      case "Aggregate": {
        const kind = rvalue._0;
        switch (kind.$) {
          case "Array":
            this.visit_ty(field_mut(kind, "_0"), { $: "Location", _0: location });
            break;
          case "Tuple":
            break;
          case "Adt":
            this.visit_args(field_mut(kind, "_2"), location);
            break;
          case "Closure":
            this.visit_args(field_mut(kind, "_1"), location);
            break;
          case "Coroutine":
            this.visit_args(field_mut(kind, "_1"), location);
            break;
          case "CoroutineClosure":
            this.visit_args(field_mut(kind, "_1"), location);
            break;
          case "RawPtr":
            this.visit_ty(field_mut(kind, "_0"), { $: "Location", _0: location });
            break;
        }

        for (const operand of rvalue._1) {
          this.visit_operand(operand, location);
        }
        break;
      }

      case "WrapUnsafeBinder":
        this.visit_operand(rvalue._0, location);
        this.visit_ty(field_mut(rvalue, "_1"), { $: "Location", _0: location });
        break;
    }
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:816 super_operand
  super_operand(operand: Operand, location: Location): void {
    switch (operand.$) {
      case "Copy":
        this.visit_place(operand._0, { $: "NonMutatingUse", _0: "Copy" }, location);
        break;
      case "Move":
        this.visit_place(operand._0, { $: "NonMutatingUse", _0: "Move" }, location);
        break;
      case "Constant":
        this.visit_const_operand(operand._0, location);
        break;
      case "RuntimeChecks":
        break;
    }
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:843 super_ascribe_user_ty
  super_ascribe_user_ty(place: Place, variance: MutRef<Variance>, user_ty: UserTypeProjection, location: Location): void {
    this.visit_place(place, { $: "NonUse", _0: { $: "AscribeUserTy", _0: variance.value } }, location);
    this.visit_user_type_projection(user_ty);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:860 super_coverage
  super_coverage(_kind: CoverageKind, _location: Location): void {}

  // rustc: compiler/rustc_middle/src/mir/visit.rs:867 super_local_decl
  super_local_decl(local: Local, local_decl: LocalDecl): void {
    const { user_ty, source_info } = local_decl;

    this.visit_source_info(source_info);

    this.visit_ty(field_mut(local_decl, "ty"), { $: "LocalDecl", local, source_info: clone_SourceInfo(source_info) });
    if (user_ty !== undefined) {
      for (const user_ty_ of user_ty.contents) {
        this.visit_user_type_projection(user_ty_);
      }
    }
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:893 super_local
  super_local(_local: MutRef<Local>, _context: PlaceContext, _location: Location): void {}

  // rustc: compiler/rustc_middle/src/mir/visit.rs:901 super_var_debug_info
  super_var_debug_info(var_debug_info: VarDebugInfo): void {
    const { source_info, composite, value } = var_debug_info;

    this.visit_source_info(source_info);
    const location = Location.START;
    if (composite !== undefined) {
      const { projection } = composite;
      this.visit_ty(field_mut(composite, "ty"), { $: "Location", _0: location });
      for (const elem of projection) {
        if (elem.$ !== "Field") bug();
        this.visit_ty(field_mut(elem, "_1"), { $: "Location", _0: location });
      }
    }
    switch (value.$) {
      case "Const":
        this.visit_const_operand(value._0, location);
        break;
      case "Place":
        this.visit_place(value._0, { $: "NonUse", _0: NonUseContext.VarDebugInfo }, location);
        break;
    }
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:936 super_source_scope
  super_source_scope(_scope: MutRef<SourceScope>): void {}

  // rustc: compiler/rustc_middle/src/mir/visit.rs:938 super_const_operand
  super_const_operand(constant: ConstOperand, location: Location): void {
    const { const_ } = constant;

    this.visit_span(field_mut(constant, "span"));
    switch (const_.$) {
      case "Ty":
        this.visit_ty_const(field_mut(const_, "_1"), location);
        break;
      case "Val":
      case "Unevaluated":
        this.visit_ty(field_mut(const_, "_1"), { $: "Location", _0: location });
        break;
    }
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:958 super_ty_const
  super_ty_const(_ct: MutRef<ty_Const>, _location: Location): void {}

  // rustc: compiler/rustc_middle/src/mir/visit.rs:965 super_span
  super_span(_span: MutRef<Span>): void {}

  // rustc: compiler/rustc_middle/src/mir/visit.rs:967 super_source_info
  super_source_info(source_info: SourceInfo): void {
    // PORT: (perf) the default `visit_span` / `visit_source_scope` (-> empty `super_*`) do nothing: the `&mut` views
    // are made only for a visitor that overrides one of them.
    const proto = MutVisitor.prototype;
    if (this.visit_span !== proto.visit_span || this.super_span !== proto.super_span) {
      this.visit_span(field_mut(source_info, "span"));
    }
    if (this.visit_source_scope !== proto.visit_source_scope || this.super_source_scope !== proto.super_source_scope) {
      this.visit_source_scope(field_mut(source_info, "scope"));
    }
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:974 super_user_type_projection
  super_user_type_projection(_ty: UserTypeProjection): void {}

  // rustc: compiler/rustc_middle/src/mir/visit.rs:976 super_user_type_annotation
  super_user_type_annotation(_index: UserTypeAnnotationIndex, ty: CanonicalUserTypeAnnotation): void {
    this.visit_span(field_mut(ty, "span"));
    this.visit_ty(field_mut(ty, "inferred_ty"), { $: "UserTy", _0: ty.span });
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:985 super_ty
  super_ty(_ty: MutRef<Ty>): void {}

  // rustc: compiler/rustc_middle/src/mir/visit.rs:987 super_region
  super_region(_region: MutRef<Region>): void {}

  // rustc: compiler/rustc_middle/src/mir/visit.rs:989 super_args
  super_args(_args: MutRef<GenericArgsRef>): void {}

  // Convenience methods

  // rustc: compiler/rustc_middle/src/mir/visit.rs:993 visit_location
  visit_location(body: Body, location: Location): void {
    // basic_blocks!(body, mut, true) = body.basic_blocks.as_mut()
    const basic_block = body.basic_blocks.as_mut()[location.block]!;
    if (basic_block.statements.length === location.statement_index) {
      const terminator = basic_block.terminator;
      if (terminator !== undefined) {
        this.visit_terminator(terminator, location);
      }
    } else {
      const statement = basic_block.statements[location.statement_index]!;
      this.visit_statement(statement, location);
    }
  }
}

export interface PlaceContext_methods {
  // visit.rs:1386
  is_drop(self: PlaceContext): boolean;
  // visit.rs:1392
  is_borrow(self: PlaceContext): boolean;
  // visit.rs:1401
  is_address_of(self: PlaceContext): boolean;
  // visit.rs:1411
  may_observe_address(self: PlaceContext): boolean;
  // visit.rs:1429
  is_storage_marker(self: PlaceContext): boolean;
  // visit.rs:1438
  is_mutating_use(self: PlaceContext): boolean;
  // visit.rs:1444
  is_use(self: PlaceContext): boolean;
  // visit.rs:1449
  is_place_assignment(self: PlaceContext): boolean;
  // visit.rs:1461
  ambient_variance(self: PlaceContext): Variance;
}
export type PlaceContext = gen_PlaceContext;
export const PlaceContext = {} as PlaceContext_methods;

/// Returns `true` if this place context represents a drop.
// rustc: compiler/rustc_middle/src/mir/visit.rs:1386 is_drop
PlaceContext.is_drop = function (self: PlaceContext): boolean {
  return self.$ === "MutatingUse" && self._0 === "Drop";
};

/// Returns `true` if this place context represents a borrow, excluding fake borrows
/// (which are an artifact of borrowck and not actually borrows in runtime MIR).
// rustc: compiler/rustc_middle/src/mir/visit.rs:1392 is_borrow
PlaceContext.is_borrow = function (self: PlaceContext): boolean {
  return (self.$ === "NonMutatingUse" && self._0 === "SharedBorrow") || (self.$ === "MutatingUse" && self._0 === "Borrow");
};

/// Returns `true` if this place context represents an address-of.
// rustc: compiler/rustc_middle/src/mir/visit.rs:1401 is_address_of
PlaceContext.is_address_of = function (self: PlaceContext): boolean {
  return (self.$ === "NonMutatingUse" && self._0 === "RawBorrow") || (self.$ === "MutatingUse" && self._0 === "RawBorrow");
};

/// Returns `true` if this place context may be used to know the address of the given place.
// rustc: compiler/rustc_middle/src/mir/visit.rs:1411 may_observe_address
PlaceContext.may_observe_address = function (self: PlaceContext): boolean {
  return (
    (self.$ === "NonMutatingUse" && (self._0 === "SharedBorrow" || self._0 === "RawBorrow" || self._0 === "FakeBorrow")) ||
    (self.$ === "MutatingUse" && (self._0 === "Drop" || self._0 === "Borrow" || self._0 === "RawBorrow" || self._0 === "AsmOutput"))
  );
};

/// Returns `true` if this place context represents a storage live or storage dead marker.
// rustc: compiler/rustc_middle/src/mir/visit.rs:1429 is_storage_marker
PlaceContext.is_storage_marker = function (self: PlaceContext): boolean {
  return self.$ === "NonUse" && (self._0.$ === "StorageLive" || self._0.$ === "StorageDead");
};

/// Returns `true` if this place context represents a use that potentially changes the value.
// rustc: compiler/rustc_middle/src/mir/visit.rs:1438 is_mutating_use
PlaceContext.is_mutating_use = function (self: PlaceContext): boolean {
  return self.$ === "MutatingUse";
};

/// Returns `true` if this place context represents a use.
// rustc: compiler/rustc_middle/src/mir/visit.rs:1444 is_use
PlaceContext.is_use = function (self: PlaceContext): boolean {
  return !(self.$ === "NonUse");
};

/// Returns `true` if this place context represents an assignment statement.
// rustc: compiler/rustc_middle/src/mir/visit.rs:1449 is_place_assignment
PlaceContext.is_place_assignment = function (self: PlaceContext): boolean {
  return self.$ === "MutatingUse" && (self._0 === "Store" || self._0 === "Call" || self._0 === "AsmOutput");
};

/// The variance of a place in the given context.
// rustc: compiler/rustc_middle/src/mir/visit.rs:1461 ambient_variance
PlaceContext.ambient_variance = function (self: PlaceContext): Variance {
  // use NonMutatingUseContext::*; use NonUseContext::*;
  if (self.$ === "MutatingUse") {
    return "Invariant";
  } else if (
    self.$ === "NonUse" &&
    (self._0.$ === "StorageDead" || self._0.$ === "StorageLive" || self._0.$ === "VarDebugInfo" || self._0.$ === "BackwardIncompatibleDropHint")
  ) {
    return "Invariant";
  } else if (
    self.$ === "NonMutatingUse" &&
    (self._0 === "Inspect" ||
      self._0 === "Copy" ||
      self._0 === "Move" ||
      self._0 === "PlaceMention" ||
      self._0 === "SharedBorrow" ||
      self._0 === "FakeBorrow" ||
      self._0 === "RawBorrow" ||
      self._0 === "Projection")
  ) {
    return "Covariant";
  } else if (self.$ === "NonUse" && self._0.$ === "AscribeUserTy") {
    return self._0._0;
  }
  return unreachable(); // PORT: the match is exhaustive upstream
};

/// Small utility to visit places and locals without manually implementing a full visitor.
// rustc-type: compiler/rustc_middle/src/mir/visit.rs:1479 VisitPlacesWith
export class VisitPlacesWith extends Visitor {
  constructor(public _0: (place: Place, ctxt: PlaceContext) => void) {
    super();
  }

  // impl<'tcx, F> Visitor<'tcx> for VisitPlacesWith<F> where F: FnMut(Place<'tcx>, PlaceContext)
  // rustc: compiler/rustc_middle/src/mir/visit.rs:1485 visit_local
  override visit_local(local: Local, ctxt: PlaceContext, _2: Location): void {
    this._0(Place_from_Local(local), ctxt);
  }

  // rustc: compiler/rustc_middle/src/mir/visit.rs:1489 visit_place
  override visit_place(place: Place, ctxt: PlaceContext, location: Location): void {
    this._0(clone_Place(place), ctxt);
    this.visit_projection(place.as_ref(), ctxt, location);
  }
}
