// Port of compiler/rustc_mir_transform/src/check_null.rs (lane mt-kpl-ubchecks).
import { LangItem } from "../rustc_attr_ir/lang_items.ts";
import { IndexVec } from "../rustc_index/vec.ts";
import {
  type AssertKind,
  type Body,
  CastKind,
  clone_Operand,
  clone_Place,
  clone_SourceInfo,
  Const,
  ConstOperand,
  ConstValue,
  type Local,
  type LocalDecl,
  LocalDecl as LocalDeclC,
  type Operand,
  Operand as OperandC,
  type Place,
  Place_from_Local,
  type Rvalue,
  type SourceInfo,
  Statement,
} from "../rustc_middle/mir/mod.ts";
import type { PlaceContext } from "../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { Ty } from "../rustc_middle/ty/mod.ts";
import { BorrowedFieldProjectionMode, type PointerCheck, check_pointers } from "./check_pointers.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";

// rustc-type: compiler/rustc_mir_transform/src/check_null.rs:10 CheckNull
export class CheckNull extends MirPass {
  readonly type_name = "rustc_mir_transform::check_null::CheckNull";

  // impl<'tcx> crate::MirPass<'tcx> for CheckNull
  // rustc: compiler/rustc_mir_transform/src/check_null.rs:13 policy
  policy(ctx: PassCtx): PassPolicy {
    // When UB checks are enabled this is part of their semantics, not an optimization.
    return PassPolicy.optional(ctx.deref().ub_checks());
  }

  // rustc: compiler/rustc_mir_transform/src/check_null.rs:18 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    check_pointers(tcx, body, [], insert_null_check, BorrowedFieldProjectionMode.NoFollowProjections);
  }
}

// PORT: `local_decls.push(LocalDecl::with_source_info(ty, source_info)).into()` (not an upstream fn). `source_info` is
// `Copy`: the decl gets its own copy (MIR aliasing, see `insert_*_check`).
function push_local_place(local_decls: LocalDecl[], ty: Ty, source_info: SourceInfo): Place {
  return Place_from_Local(IndexVec.push<Local, LocalDecl>(local_decls, LocalDeclC.with_source_info(ty, clone_SourceInfo(source_info))));
}

// PORT: MIR aliasing (decision 2026-10-22 "MIR build aliasing"; lane fix-ubchecks-alias): `Place` and `SourceInfo` are
// `Copy`, so every statement, local decl and operand built here gets its own copy (`clone_Place` at each use of a place
// after the first, `clone_SourceInfo` at each use of `source_info`). Later passes edit them in place (`SimplifyLocals`
// renames locals, the inliner remaps scopes); a shared object would be edited twice.
// rustc: compiler/rustc_mir_transform/src/check_null.rs:29 insert_null_check
function insert_null_check(
  tcx: TyCtxt,
  pointer: Place,
  pointee_ty: Ty,
  context: PlaceContext,
  local_decls: LocalDecl[],
  stmts: Statement[],
  source_info: SourceInfo,
): PointerCheck {
  // Cast the pointer to a *const ().
  const const_raw_ptr = Ty.new_imm_ptr(tcx, tcx.types.unit);
  let rvalue: Rvalue = { $: "Cast", _0: CastKind.PtrToPtr, _1: { $: "Copy", _0: pointer }, _2: const_raw_ptr };
  const thin_ptr = push_local_place(local_decls, const_raw_ptr, source_info);
  stmts.push(Statement.new(clone_SourceInfo(source_info), { $: "Assign", _0: [thin_ptr, rvalue] }));

  // Transmute the pointer to a usize (equivalent to `ptr.addr()`).
  rvalue = { $: "Cast", _0: CastKind.Transmute, _1: { $: "Copy", _0: clone_Place(thin_ptr) }, _2: tcx.types.usize };
  const addr = push_local_place(local_decls, tcx.types.usize, source_info);
  stmts.push(Statement.new(clone_SourceInfo(source_info), { $: "Assign", _0: [addr, rvalue] }));

  const zero: Operand = {
    $: "Constant",
    _0: new ConstOperand(source_info.span, undefined, {
      $: "Val",
      _0: ConstValue.from_target_usize(0, tcx),
      _1: tcx.types.usize,
    }),
  };

  let pointee_should_be_checked: Operand;
  let assert_kind: AssertKind<Operand>;
  if (
    // Borrows pointing to "null" are UB even if the pointee is a ZST.
    (context.$ === "NonMutatingUse" && context._0 === "SharedBorrow") ||
    (context.$ === "MutatingUse" && context._0 === "Borrow")
  ) {
    // Pointer should be checked unconditionally.
    pointee_should_be_checked = {
      $: "Constant",
      _0: new ConstOperand(source_info.span, undefined, Const.from_bool(tcx, true)),
    };
    assert_kind = { $: "NullReferenceConstructed" };
  }
  // Other usages of null pointers only are UB if the pointee is not a ZST.
  else {
    const size_of_ = tcx.require_lang_item(LangItem.SizeOf, source_info.span);
    const size_of = OperandC.unevaluated_constant(tcx, size_of_, [pointee_ty], source_info.span);

    const pointee_should_be_checked_ = push_local_place(local_decls, tcx.types.bool, source_info);
    const rvalue: Rvalue = { $: "BinaryOp", _0: "Ne", _1: [size_of, clone_Operand(zero)] };
    stmts.push(Statement.new(clone_SourceInfo(source_info), { $: "Assign", _0: [pointee_should_be_checked_, rvalue] }));
    pointee_should_be_checked = { $: "Copy", _0: clone_Place(pointee_should_be_checked_) };
    assert_kind = { $: "NullPointerDereference" };
  }

  // Check whether the pointer is null.
  const is_null = push_local_place(local_decls, tcx.types.bool, source_info);
  stmts.push(
    Statement.new(clone_SourceInfo(source_info), {
      $: "Assign",
      _0: [is_null, { $: "BinaryOp", _0: "Eq", _1: [{ $: "Copy", _0: clone_Place(addr) }, zero] }],
    }),
  );

  // We want to throw an exception if the pointer is null and the pointee is not unconditionally
  // allowed (which for all non-borrow place uses, is when the pointee is ZST).
  const should_throw_exception = push_local_place(local_decls, tcx.types.bool, source_info);
  stmts.push(
    Statement.new(clone_SourceInfo(source_info), {
      $: "Assign",
      _0: [
        should_throw_exception,
        { $: "BinaryOp", _0: "BitAnd", _1: [{ $: "Copy", _0: clone_Place(is_null) }, pointee_should_be_checked] },
      ],
    }),
  );

  // The final condition whether this pointer usage is ok or not.
  const is_ok = push_local_place(local_decls, tcx.types.bool, source_info);
  stmts.push(
    Statement.new(clone_SourceInfo(source_info), {
      $: "Assign",
      _0: [is_ok, { $: "UnaryOp", _0: "Not", _1: { $: "Copy", _0: clone_Place(should_throw_exception) } }],
    }),
  );

  // Emit a PointerCheck that asserts on the condition and otherwise triggers
  // the chosen AssertKind.
  return { cond: { $: "Copy", _0: clone_Place(is_ok) }, assert_kind };
}
