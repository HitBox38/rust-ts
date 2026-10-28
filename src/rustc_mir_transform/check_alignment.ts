// Port of compiler/rustc_mir_transform/src/check_alignment.rs (lane mt-kpl-ubchecks).
import { Align } from "../rustc_abi/lib.ts";
import { LangItem } from "../rustc_attr_ir/lang_items.ts";
import { IndexVec } from "../rustc_index/vec.ts";
import { Scalar } from "../rustc_middle/mir/interpret/mod.ts";
import {
  type Body,
  CastKind,
  clone_Operand,
  clone_Place,
  clone_SourceInfo,
  ConstOperand,
  type Local,
  type LocalDecl,
  type Operand,
  type Place,
  Place_from_Local,
  type Rvalue,
  type SourceInfo,
  Statement,
  LocalDecl as LocalDeclC,
  Operand as OperandC,
} from "../rustc_middle/mir/mod.ts";
import type { PlaceContext } from "../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { Ty } from "../rustc_middle/ty/mod.ts";
import { BorrowedFieldProjectionMode, type PointerCheck, check_pointers } from "./check_pointers.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";

// rustc-type: compiler/rustc_mir_transform/src/check_alignment.rs:12 CheckAlignment
export class CheckAlignment extends MirPass {
  readonly type_name = "rustc_mir_transform::check_alignment::CheckAlignment";

  // impl<'tcx> crate::MirPass<'tcx> for CheckAlignment
  // rustc: compiler/rustc_mir_transform/src/check_alignment.rs:15 policy
  policy(ctx: PassCtx): PassPolicy {
    // When UB checks are enabled this is part of their semantics, not an optimization.
    return PassPolicy.optional(ctx.deref().ub_checks());
  }

  // rustc: compiler/rustc_mir_transform/src/check_alignment.rs:20 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    // Skip trivially aligned place types.
    const excluded_pointees = [tcx.types.bool, tcx.types.i8, tcx.types.u8];

    // When checking the alignment of references to field projections (`&(*ptr).a`),
    // we need to make sure that the reference is aligned according to the field type
    // and not to the pointer type.
    check_pointers(
      tcx,
      body,
      excluded_pointees,
      insert_alignment_check,
      BorrowedFieldProjectionMode.FollowProjections,
    );
  }
}

// PORT: `local_decls.push(LocalDecl::with_source_info(ty, source_info)).into()` (not an upstream fn). `source_info` is
// `Copy`: the decl gets its own copy (MIR aliasing, see `insert_*_check`).
function push_local_place(local_decls: LocalDecl[], ty: Ty, source_info: SourceInfo): Place {
  return Place_from_Local(IndexVec.push<Local, LocalDecl>(local_decls, LocalDeclC.with_source_info(ty, clone_SourceInfo(source_info))));
}

/// Inserts the actual alignment check's logic. Returns a
/// [AssertKind::MisalignedPointerDereference] on failure.
// PORT: MIR aliasing (decision 2026-10-22 "MIR build aliasing"; lane fix-ubchecks-alias): `Place` and `SourceInfo` are
// `Copy`, so every statement, local decl and operand built here gets its own copy (`clone_Place` at each use of a place
// after the first, `clone_SourceInfo` at each use of `source_info`). Later passes edit them in place (`SimplifyLocals`
// renames locals, the inliner remaps scopes); a shared object would be edited twice.
// rustc: compiler/rustc_mir_transform/src/check_alignment.rs:39 insert_alignment_check
function insert_alignment_check(
  tcx: TyCtxt,
  pointer: Place,
  pointee_ty: Ty,
  _context: PlaceContext,
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

  // Get the alignment of the pointee
  const align_def_id = tcx.require_lang_item(LangItem.AlignOf, source_info.span);
  const alignment = OperandC.unevaluated_constant(tcx, align_def_id, [pointee_ty], source_info.span);

  // Subtract 1 from the alignment to get the alignment mask
  const alignment_mask = push_local_place(local_decls, tcx.types.usize, source_info);
  const one: Operand = {
    $: "Constant",
    _0: new ConstOperand(source_info.span, undefined, {
      $: "Val",
      _0: { $: "Scalar", _0: Scalar.from_target_usize(1n, tcx) },
      _1: tcx.types.usize,
    }),
  };
  stmts.push(
    Statement.new(clone_SourceInfo(source_info), {
      $: "Assign",
      _0: [alignment_mask, { $: "BinaryOp", _0: "Sub", _1: [clone_Operand(alignment), one] }],
    }),
  );

  // If this target does not have reliable alignment, further limit the mask by anding it with
  // the mask for the highest reliable alignment.
  const max_align = tcx.sess.target.max_reliable_alignment();
  // PORT: `Align`'s derived `Ord` compares `pow2`.
  if (max_align.pow2 < Align.MAX.pow2) {
    const max_mask_ = max_align.bytes() - 1;
    const max_mask: Operand = {
      $: "Constant",
      _0: new ConstOperand(source_info.span, undefined, {
        $: "Val",
        _0: { $: "Scalar", _0: Scalar.from_target_usize(BigInt(max_mask_), tcx) },
        _1: tcx.types.usize,
      }),
    };
    stmts.push(
      Statement.new(clone_SourceInfo(source_info), {
        $: "Assign",
        _0: [clone_Place(alignment_mask), { $: "BinaryOp", _0: "BitAnd", _1: [{ $: "Copy", _0: clone_Place(alignment_mask) }, max_mask] }],
      }),
    );
  }

  // BitAnd the alignment mask with the pointer
  const alignment_bits = push_local_place(local_decls, tcx.types.usize, source_info);
  stmts.push(
    Statement.new(clone_SourceInfo(source_info), {
      $: "Assign",
      _0: [
        alignment_bits,
        { $: "BinaryOp", _0: "BitAnd", _1: [{ $: "Copy", _0: clone_Place(addr) }, { $: "Copy", _0: clone_Place(alignment_mask) }] },
      ],
    }),
  );

  // Check if the alignment bits are all zero
  const is_ok = push_local_place(local_decls, tcx.types.bool, source_info);
  const zero: Operand = {
    $: "Constant",
    _0: new ConstOperand(source_info.span, undefined, {
      $: "Val",
      _0: { $: "Scalar", _0: Scalar.from_target_usize(0n, tcx) },
      _1: tcx.types.usize,
    }),
  };
  stmts.push(
    Statement.new(clone_SourceInfo(source_info), {
      $: "Assign",
      _0: [is_ok, { $: "BinaryOp", _0: "Eq", _1: [{ $: "Copy", _0: clone_Place(alignment_bits) }, clone_Operand(zero)] }],
    }),
  );

  // Emit a check that asserts on the alignment and otherwise triggers a
  // AssertKind::MisalignedPointerDereference.
  return {
    cond: { $: "Copy", _0: clone_Place(is_ok) },
    assert_kind: { $: "MisalignedPointerDereference", required: alignment, found: { $: "Copy", _0: clone_Place(addr) } },
  };
}
