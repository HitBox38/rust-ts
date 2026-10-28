// Port of compiler/rustc_mir_transform/src/lower_intrinsics.rs (lane mt-cleanup).
//
// PORT: `crate::take_array` (lib.rs:318) is lib.ts's private `take_array`; pass modules must not import lib.ts (the
// mt-skeleton init-order contract), so `take_array` below is a module-local stand-in with the same body (the const
// generic `N` is the parameter `n`), no marker. `&mut args` is `field_mut(kind, "args")`. The copies of the `Copy` MIR
// objects `*destination` / `terminator.source_info` are `clone_*` (PORTING §8).
//! Lowers intrinsic calls
import {
  type BinOp,
  type Body,
  clone_Place,
  clone_SourceInfo,
  ConstOperand,
  Operand,
  Place_from_Local,
  ProjectionElem,
  type Rvalue,
  type RuntimeChecks,
  Statement,
  TerminatorKind,
} from "../rustc_middle/mir/mod.ts";
import { Const as mir_Const } from "../rustc_middle/mir/consts.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { fold_GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import { debug_IntrinsicDef } from "../rustc_middle/ty/intrinsic.ts";
import { debug_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { bug, span_bug } from "../rustc_span/macros.ts";
import { display_Symbol, sym } from "../rustc_span/symbol.ts";
import { Binder } from "../rustc_type_ir/binder.ts";
import { PLAIN } from "../std/fmt.ts";
import { field_mut, type MutRef } from "../std/mut_ref.ts";
import { assert, unreachable, unwrap } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";

/** PORT: stand-in for `crate::take_array` (lib.rs:318; see the header). */
function take_array<T>(b: MutRef<T[]>, n: number): Result<T[], T[]> {
  const taken = b.value;
  b.value = [];
  if (taken.length !== n) return Err(taken);
  return Ok(taken);
}

// rustc-type: compiler/rustc_mir_transform/src/lower_intrinsics.rs:9 LowerIntrinsics
export class LowerIntrinsics extends MirPass {
  readonly type_name = "rustc_mir_transform::lower_intrinsics::LowerIntrinsics";

  // rustc: compiler/rustc_mir_transform/src/lower_intrinsics.rs:12 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    const local_decls = body.local_decls;
    for (const block of body.basic_blocks.as_mut()) {
      const terminator = unwrap(block.terminator);
      const kind = terminator.kind;
      if (kind.$ !== "Call") continue;
      const func = kind.func;
      const destination = kind.destination;
      const target = kind.target;
      const fty = Operand.ty(func, local_decls, tcx).kind();
      if (fty.$ !== "FnDef") continue;
      const def_id = fty._0;
      const intrinsic = tcx.intrinsic(def_id);
      if (intrinsic === undefined) continue;
      const args = field_mut(kind, "args");
      {
        const generic_args = unwrap(Binder.no_bound_vars(fty._1, fold_GenericArgs));
        switch (intrinsic.name) {
          case sym.unreachable: {
            terminator.kind = TerminatorKind.Unreachable;
            break;
          }
          case sym.ub_checks:
          case sym.overflow_checks:
          case sym.contract_checks: {
            let op: RuntimeChecks;
            switch (intrinsic.name) {
              case sym.ub_checks:
                op = "UbChecks";
                break;
              case sym.contract_checks:
                op = "ContractChecks";
                break;
              case sym.overflow_checks:
                op = "OverflowChecks";
                break;
              default:
                return unreachable();
            }
            const target_ = unwrap(target);
            block.statements.push(
              Statement.new(clone_SourceInfo(terminator.source_info), {
                $: "Assign",
                _0: [clone_Place(destination), { $: "Use", _0: { $: "RuntimeChecks", _0: op }, _1: "Yes" }],
              }),
            );
            terminator.kind = TerminatorKind.goto(target_);
            break;
          }
          case sym.forget: {
            const target_ = unwrap(target);
            block.statements.push(
              Statement.new(clone_SourceInfo(terminator.source_info), {
                $: "Assign",
                _0: [
                  clone_Place(destination),
                  {
                    $: "Use",
                    _0: {
                      $: "Constant",
                      _0: new ConstOperand(terminator.source_info.span, undefined, mir_Const.zero_sized(tcx.types.unit)),
                    },
                    _1: "Yes",
                  },
                ],
              }),
            );
            terminator.kind = TerminatorKind.goto(target_);
            break;
          }
          case sym.copy_nonoverlapping: {
            const target_ = unwrap(target);
            const r = take_array(args, 3);
            if (r.$ !== "Ok") {
              return bug("Wrong arguments for copy_non_overlapping intrinsic");
            }
            const src = r._0[0]!;
            const dst = r._0[1]!;
            const count = r._0[2]!;
            block.statements.push(
              Statement.new(clone_SourceInfo(terminator.source_info), {
                $: "Intrinsic",
                _0: {
                  $: "CopyNonOverlapping",
                  _0: {
                    src: src.node,
                    dst: dst.node,
                    count: count.node,
                  },
                },
              }),
            );
            terminator.kind = TerminatorKind.goto(target_);
            break;
          }
          case sym.assume: {
            const target_ = unwrap(target);
            const r = take_array(args, 1);
            if (r.$ !== "Ok") {
              return bug("Wrong arguments for assume intrinsic");
            }
            const arg = r._0[0]!;
            block.statements.push(
              Statement.new(clone_SourceInfo(terminator.source_info), { $: "Intrinsic", _0: { $: "Assume", _0: arg.node } }),
            );
            terminator.kind = TerminatorKind.goto(target_);
            break;
          }
          case sym.wrapping_add:
          case sym.wrapping_sub:
          case sym.wrapping_mul:
          case sym.three_way_compare:
          case sym.unchecked_add:
          case sym.unchecked_sub:
          case sym.unchecked_mul:
          case sym.unchecked_div:
          case sym.unchecked_rem:
          case sym.unchecked_shl:
          case sym.unchecked_shr: {
            const target_ = unwrap(target);
            const r = take_array(args, 2);
            if (r.$ !== "Ok") {
              return bug(`Wrong arguments for ${display_Symbol(intrinsic.name)} intrinsic`);
            }
            const lhs = r._0[0]!;
            const rhs = r._0[1]!;
            let bin_op: BinOp;
            switch (intrinsic.name) {
              case sym.wrapping_add:
                bin_op = "Add";
                break;
              case sym.wrapping_sub:
                bin_op = "Sub";
                break;
              case sym.wrapping_mul:
                bin_op = "Mul";
                break;
              case sym.three_way_compare:
                bin_op = "Cmp";
                break;
              case sym.unchecked_add:
                bin_op = "AddUnchecked";
                break;
              case sym.unchecked_sub:
                bin_op = "SubUnchecked";
                break;
              case sym.unchecked_mul:
                bin_op = "MulUnchecked";
                break;
              case sym.unchecked_div:
                bin_op = "Div";
                break;
              case sym.unchecked_rem:
                bin_op = "Rem";
                break;
              case sym.unchecked_shl:
                bin_op = "ShlUnchecked";
                break;
              case sym.unchecked_shr:
                bin_op = "ShrUnchecked";
                break;
              default:
                return bug("unexpected intrinsic");
            }
            block.statements.push(
              Statement.new(clone_SourceInfo(terminator.source_info), {
                $: "Assign",
                _0: [clone_Place(destination), { $: "BinaryOp", _0: bin_op, _1: [lhs.node, rhs.node] }],
              }),
            );
            terminator.kind = TerminatorKind.goto(target_);
            break;
          }
          case sym.add_with_overflow:
          case sym.sub_with_overflow:
          case sym.mul_with_overflow: {
            const target_ = unwrap(target);
            const r = take_array(args, 2);
            if (r.$ !== "Ok") {
              return bug(`Wrong arguments for ${display_Symbol(intrinsic.name)} intrinsic`);
            }
            const lhs = r._0[0]!;
            const rhs = r._0[1]!;
            let bin_op: BinOp;
            switch (intrinsic.name) {
              case sym.add_with_overflow:
                bin_op = "AddWithOverflow";
                break;
              case sym.sub_with_overflow:
                bin_op = "SubWithOverflow";
                break;
              case sym.mul_with_overflow:
                bin_op = "MulWithOverflow";
                break;
              default:
                return bug("unexpected intrinsic");
            }
            block.statements.push(
              Statement.new(clone_SourceInfo(terminator.source_info), {
                $: "Assign",
                _0: [clone_Place(destination), { $: "BinaryOp", _0: bin_op, _1: [lhs.node, rhs.node] }],
              }),
            );
            terminator.kind = TerminatorKind.goto(target_);
            break;
          }
          case sym.read_via_copy: {
            const r = take_array(args, 1);
            if (r.$ !== "Ok") {
              return span_bug(terminator.source_info.span, "Wrong number of arguments");
            }
            const arg = r._0[0]!;
            const place = Operand.place(arg.node);
            const local = place !== undefined ? place.as_local() : undefined;
            let derefed_place;
            if (place !== undefined && local !== undefined) {
              derefed_place = tcx.mk_place_deref(Place_from_Local(local));
            } else {
              return span_bug(terminator.source_info.span, "Only passing a local is supported");
            }
            // Add new statement at the end of the block that does the read, and patch
            // up the terminator.
            block.statements.push(
              Statement.new(clone_SourceInfo(terminator.source_info), {
                $: "Assign",
                _0: [clone_Place(destination), { $: "Use", _0: { $: "Copy", _0: derefed_place }, _1: "Yes" }],
              }),
            );
            if (target === undefined) {
              // No target means this read something uninhabited,
              // so it must be unreachable.
              terminator.kind = TerminatorKind.Unreachable;
            } else {
              terminator.kind = TerminatorKind.goto(target);
            }
            break;
          }
          // `write_via_move` is already lowered during MIR building.
          case sym.discriminant_value: {
            const target_ = unwrap(target);
            const r = take_array(args, 1);
            if (r.$ !== "Ok") {
              return span_bug(terminator.source_info.span, "Wrong arguments for discriminant_value intrinsic");
            }
            let arg = unwrap(Operand.place(r._0[0]!.node));
            arg = tcx.mk_place_deref(arg);
            block.statements.push(
              Statement.new(clone_SourceInfo(terminator.source_info), {
                $: "Assign",
                _0: [clone_Place(destination), { $: "Discriminant", _0: arg }],
              }),
            );
            terminator.kind = TerminatorKind.goto(target_);
            break;
          }
          case sym.offset: {
            const target_ = unwrap(target);
            const r = take_array(args, 2);
            if (r.$ !== "Ok") {
              return span_bug(terminator.source_info.span, "Wrong number of arguments for offset intrinsic");
            }
            const ptr = r._0[0]!;
            const delta = r._0[1]!;
            block.statements.push(
              Statement.new(clone_SourceInfo(terminator.source_info), {
                $: "Assign",
                _0: [clone_Place(destination), { $: "BinaryOp", _0: "Offset", _1: [ptr.node, delta.node] }],
              }),
            );
            terminator.kind = TerminatorKind.goto(target_);
            break;
          }
          case sym.slice_get_unchecked: {
            const target_ = unwrap(target);
            const r = take_array(args, 2);
            if (r.$ !== "Ok") {
              return span_bug(terminator.source_info.span, `Wrong number of arguments for ${debug_IntrinsicDef(intrinsic, PLAIN)}`);
            }
            const ptrish = r._0[0]!;
            const index = r._0[1]!;

            const place = unwrap(Operand.place(ptrish.node));
            assert(!place.is_indirect(), "assertion failed: !place.is_indirect()");
            const updated_place = place.project_deeper(
              [ProjectionElem.Deref, { $: "Index", _0: unwrap(unwrap(Operand.place(index.node)).as_local()) }],
              tcx,
            );

            const ret_ty = generic_args.type_at(0);
            let rvalue: Rvalue;
            const rk = ret_ty.kind();
            if (rk.$ === "RawPtr" && rk._1 === "Not") {
              rvalue = { $: "RawPtr", _0: "Const", _1: updated_place };
            } else if (rk.$ === "RawPtr" && rk._1 === "Mut") {
              rvalue = { $: "RawPtr", _0: "Mut", _1: updated_place };
            } else if (rk.$ === "Ref" && rk._2 === "Not") {
              rvalue = { $: "Ref", _0: rk._0, _1: { $: "Shared" }, _2: updated_place };
            } else if (rk.$ === "Ref" && rk._2 === "Mut") {
              rvalue = { $: "Ref", _0: rk._0, _1: { $: "Mut", kind: "Default" }, _2: updated_place };
            } else {
              return bug(`Unknown return type ${debug_Ty(ret_ty, PLAIN)}`);
            }

            block.statements.push(
              Statement.new(clone_SourceInfo(terminator.source_info), { $: "Assign", _0: [clone_Place(destination), rvalue] }),
            );
            terminator.kind = TerminatorKind.goto(target_);
            break;
          }
          case sym.transmute:
          case sym.transmute_unchecked: {
            const dst_ty = destination.ty(local_decls, tcx).ty;
            const r = take_array(args, 1);
            if (r.$ !== "Ok") {
              return span_bug(terminator.source_info.span, "Wrong number of arguments for transmute intrinsic");
            }
            const arg = r._0[0]!;

            // Always emit the cast, even if we transmute to an uninhabited type,
            // because that lets CTFE and codegen generate better error messages
            // when such a transmute actually ends up reachable.
            block.statements.push(
              Statement.new(clone_SourceInfo(terminator.source_info), {
                $: "Assign",
                _0: [clone_Place(destination), { $: "Cast", _0: { $: "Transmute" }, _1: arg.node, _2: dst_ty }],
              }),
            );
            if (target !== undefined) {
              terminator.kind = TerminatorKind.goto(target);
            } else {
              terminator.kind = TerminatorKind.Unreachable;
            }
            break;
          }
          case sym.aggregate_raw_ptr: {
            const r = take_array(args, 2);
            if (r.$ !== "Ok") {
              return span_bug(terminator.source_info.span, "Wrong number of arguments for aggregate_raw_ptr intrinsic");
            }
            const data = r._0[0]!;
            const meta = r._0[1]!;
            const target_ = unwrap(target);
            const pointer_ty = generic_args.type_at(0);
            const pk = pointer_ty.kind();
            let kind_;
            if (pk.$ === "RawPtr") {
              kind_ = { $: "RawPtr" as const, _0: pk._0, _1: pk._1 };
            } else {
              return span_bug(terminator.source_info.span, "Return type of aggregate_raw_ptr intrinsic must be a raw pointer");
            }
            const fields = [data.node, meta.node];
            block.statements.push(
              Statement.new(clone_SourceInfo(terminator.source_info), {
                $: "Assign",
                _0: [clone_Place(destination), { $: "Aggregate", _0: kind_, _1: fields }],
              }),
            );
            terminator.kind = TerminatorKind.goto(target_);
            break;
          }
          case sym.ptr_metadata: {
            const r = take_array(args, 1);
            if (r.$ !== "Ok") {
              return span_bug(terminator.source_info.span, "Wrong number of arguments for ptr_metadata intrinsic");
            }
            const ptr = r._0[0]!;
            const target_ = unwrap(target);
            block.statements.push(
              Statement.new(clone_SourceInfo(terminator.source_info), {
                $: "Assign",
                _0: [clone_Place(destination), { $: "UnaryOp", _0: "PtrMetadata", _1: ptr.node }],
              }),
            );
            terminator.kind = TerminatorKind.goto(target_);
            break;
          }
          default:
            break;
        }
      }
    }
  }

  // rustc: compiler/rustc_mir_transform/src/lower_intrinsics.rs:341 policy
  policy(_ctx: PassCtx): PassPolicy {
    // Implements intrinsic semantics by lowering intrinsic calls to ordinary MIR operations.
    return PassPolicy.Required;
  }
}
