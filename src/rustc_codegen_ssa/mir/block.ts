// Port of compiler/rustc_codegen_ssa/src/mir/block.rs (lane ssa-block, plan-m7 wave 41): `TerminatorCodegenHelper`
// (funclets, `do_call`, `funclet_br`, landing pads), the terminator codegen of `impl FunctionCx` (`codegen_block`,
// `codegen_terminator` and its arms, CMSE padding clearing, argument passing per `PassMode`, landing/terminate pads,
// `make_return_dest`, `store_return`), `ReturnDest`, `load_cast` and `store_cast`.
//
// Conventions (ssa-contract, docs/handoff/ssa-contract.md; ssa-mir-core and ssa-operand-place headers):
// - `Bx::Value` is `B["Value"]`; generic code takes `bx: BuilderMethods<B>`. `Bx::build(cx, llbb)` / `Bx::append_block(..)`
//   go through `fx.Bx_`, the builder class's static side (ssa-mir-core PORT 1).
// - PORT: the `impl FunctionCx` block is in `install_FunctionCx_block`, which root calls from mod.ts right after
//   `class FunctionCx` (installer instead of top-level prototype writes: mod.ts needs this module at run time once
//   `xlane.codegen_block` is repointed, so a top-level `FunctionCx.prototype` write here would hit the class's TDZ
//   whenever mod.ts loads first). This module imports mod.ts at run time only for `xlane` and `CachedLlbb`, read inside
//   function bodies, never at load time.
// - PORT: `OperandRef`/`PlaceRef`/`PlaceValue` are readonly (ssa-operand-place PORT 1). Where upstream writes a field of
//   a copied operand (`op.val = ..` at block.rs:1389 and :1399, review ssa-operand-place N1), the port builds a new
//   `OperandRef` with that field changed.
// - `debug!`, `trace!` and `#[instrument(level = "trace")]` are compiled out of rustc (STATIC_MAX_LEVEL = INFO,
//   rust_ts/tracing.ts) and stay comments; the `info!` in `do_call` is live. `debug_assert*!` are comments.
// - Calls into other lanes go through `block_xlane` at the end of this file (the mod.ts `xlane` pattern): every owner has
//   landed, so its entries are typed forwarders to the owners' ports, kept so tests can replace them.
//   `base::wants_new_eh_instructions` and the retag fns use mod.ts's `xlane` entries.
import { Align, Align_max, debug_Align, debug_Size, FieldsShape, Scalar as abi_Scalar, Size, Size_cmp, Size_eq, VariantIdx } from "../../rustc_abi/lib.ts";
import type { CanonAbi } from "../../rustc_abi/canon_abi.ts";
import { WrappingRange } from "../../rustc_abi/wrapping_range.ts";
import { Reg } from "../../rustc_abi/callconv/reg.ts";
import { ExternAbi } from "../../rustc_abi/extern_abi.ts";
import type { InlineAsmOptions, InlineAsmTemplatePiece } from "../../rustc_ast/lib.ts";
import type { UnrollAttr } from "../../rustc_attr_ir/data_structures.gen.ts";
import type { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import { DefKind } from "../../rustc_hir/def.ts";
import { DiagDecorator } from "../../rustc_errors/diagnostic.ts";
import { TAIL_CALL_TRACK_CALLER } from "../../rustc_lint_defs/builtin.gen.ts";
import { TyCtxt_codegen_instance_attrs, type CodegenFnAttrs } from "../../rustc_middle/middle/codegen_fn_attrs.ts";
import { CTFE_ALLOC_SALT, Pointer_from_AllocId, Scalar } from "../../rustc_middle/mir/interpret/mod.ts";
import { Const as mir_Const, type ConstValue, debug_ConstValue, fold_Const } from "../../rustc_middle/mir/consts.ts";
import {
  type BasicBlock,
  type ConstOperand,
  debug_BasicBlock,
  Operand as mir_Operand,
  Place as mir_Place,
  Local,
  Place_from_Local,
  RETURN_PLACE,
  SourceInfo,
  SourceScope,
  START_BLOCK,
  type Statement,
  type Terminator,
} from "../../rustc_middle/mir/mod.ts";
import { debug_Terminator } from "../../rustc_middle/mir/terminator.ts";
import type { StmtDebugInfo } from "../../rustc_middle/mir/statement.ts";
import {
  AssertKind,
  InlineAsmMacro,
  type AssertMessage,
  type InlineAsmOperand,
  type Operand,
  type SwitchTargets,
  UnwindAction,
  UnwindTerminateReason,
} from "../../rustc_middle/mir/syntax.ts";
import { BinOp } from "../../rustc_middle/mir/syntax.ts";
import type { Spanned } from "../../rustc_span/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { debug_Instance, Instance, InstanceKind } from "../../rustc_middle/ty/instance.ts";
import type { IntrinsicDef } from "../../rustc_middle/ty/intrinsic.ts";
import { debug_LayoutError, type TyAndLayout, ValidityRequirement } from "../../rustc_middle/ty/layout.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { Ty } from "../../rustc_middle/ty/mod.ts";
import { display_Ty, with_no_trimmed_paths, with_no_visible_paths } from "../../rustc_middle/ty/print/pretty.ts";
import { fold_GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { COMMON_VTABLE_ENTRIES_DROPINPLACE } from "../../rustc_middle/ty/vtable.ts";
import { OptLevel } from "../../rustc_session/config.ts";
import { debug_DefId } from "../../rustc_span/def_id.ts";
import { debug_Span, type Span } from "../../rustc_span/lib.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { ArgAbi, ArgAttributes, type CastTarget, debug_ArgAbi, debug_FnAbi, type FnAbi, type PassMode } from "../../rustc_target/callconv/mod.ts";
import type { Target as TargetSpec } from "../../rustc_target/spec/mod.ts";
import { Binder } from "../../rustc_type_ir/binder.ts";
import { PolyFnSig } from "../../rustc_type_ir/ty_kind.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import * as tracing from "../../rust_ts/tracing.ts";
import { type Debug, debug_option, PLAIN, PRETTY } from "../../std/fmt.ts";
import { assert, panic, unreachable, unwrap } from "../../std/panic.ts";
import { wants_wasm_eh } from "../base.ts";
import { build_langcall, asm_const_ptr_clean, IntPredicate } from "../common.ts";
import { bin_op_to_icmp_predicate } from "../base.ts";
import { CompilerBuiltinsCannotCall_diagnostic } from "../diagnostics.gen.ts";
import { MemFlags } from "../lib.ts";
import type { InlineAsmOperandRef } from "../traits/asm.ts";
import type { BackendTypes } from "../traits/backend.ts";
import { type BuilderMethods, ReturnSlot } from "../traits/builder.ts";
import type { CodegenMethods } from "../traits/mod.ts";
import { CleanupKind } from "./analyze.ts";
import { CachedLlbb, type FunctionCx, type IntrinsicResult, xlane } from "./mod.ts";
import { debug_OperandRef, debug_OperandValue, OperandRef, OperandValue } from "./operand.ts";
import { PlaceRef, PlaceValue } from "./place.ts";
import * as base from "../base.ts";
import * as meth from "../meth.ts";

// Indicates if we are in the middle of merging a BB's successor into it. This
// can happen when BB jumps directly to its successor and the successor has no
// other predecessors.
// #[derive(Debug, PartialEq)]
type MergingSucc = "False" | "True";
const MergingSucc = { False: "False", True: "True" } as const;
const debug_MergingSucc = (v: MergingSucc): string => v;

/// Indicates to the call terminator codegen whether a call
/// is a normal call or an explicit tail call.
// #[derive(Debug, PartialEq)]
type CallKind = "Normal" | "Tail";
const CallKind = { Normal: "Normal", Tail: "Tail" } as const;

/// Used by `FunctionCx::codegen_terminator` for emitting common patterns
/// e.g., creating a basic block, calling a function, etc.
class TerminatorCodegenHelper {
  constructor(
    readonly bb: BasicBlock,
    readonly terminator: Terminator,
  ) {}

  /// Returns the appropriate `Funclet` for the current funclet, if on MSVC,
  /// either already previously cached, or newly created, by `landing_pad_for`.
  // rustc: compiler/rustc_codegen_ssa/src/mir/block.rs:62 funclet
  funclet<B extends BackendTypes>(fx: FunctionCx<B>): B["Funclet"] | undefined {
    const cleanup_kinds = fx.cleanup_kinds;
    if (cleanup_kinds === undefined) return undefined;
    const funclet_bb = CleanupKind.funclet_bb(cleanup_kinds[this.bb]!, this.bb);
    if (funclet_bb === undefined) return undefined;
    // If `landing_pad_for` hasn't been called yet to create the `Funclet`,
    // it has to be now. This may not seem necessary, as RPO should lead
    // to all the unwind edges being visited (and so to `landing_pad_for`
    // getting called for them), before building any of the blocks inside
    // the funclet itself - however, if MIR contains edges that end up not
    // being needed in the LLVM IR after monomorphization, the funclet may
    // be unreachable, and we don't have yet a way to skip building it in
    // such an eventuality (which may be a better solution than this).
    if (fx.funclets[funclet_bb] === undefined) {
      fx.landing_pad_for(funclet_bb);
    }
    return unwrap(fx.funclets[funclet_bb], "landing_pad_for didn't also create funclets entry");
  }

  /// Get a basic block (creating it if necessary), possibly with cleanup
  /// stuff in it or next to it.
  // rustc: compiler/rustc_codegen_ssa/src/mir/block.rs:88 llbb_with_cleanup
  llbb_with_cleanup<B extends BackendTypes>(fx: FunctionCx<B>, target: BasicBlock): B["BasicBlock"] {
    const [needs_landing_pad, is_cleanupret] = this.llbb_characteristics(fx, target);
    let lltarget = fx.llbb(target);
    if (needs_landing_pad) {
      lltarget = fx.landing_pad_for(target);
    }
    if (is_cleanupret) {
      // Cross-funclet jump - need a trampoline
      assert(xlane.wants_new_eh_instructions(fx.cx.tcx_().sess.target), "assertion failed: base::wants_new_eh_instructions(&fx.cx.tcx().sess.target)");
      // debug!("llbb_with_cleanup: creating cleanup trampoline for {:?}", target);
      const name = `${debug_BasicBlock(this.bb, PLAIN)}_cleanup_trampoline_${debug_BasicBlock(target, PLAIN)}`;
      const trampoline_llbb = fx.Bx_.append_block(fx.cx, fx.llfn, name);
      const trampoline_bx = fx.Bx_.build(fx.cx, trampoline_llbb);
      trampoline_bx.cleanup_ret(unwrap(this.funclet(fx)), lltarget);
      return trampoline_llbb;
    } else {
      return lltarget;
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/mir/block.rs:112 llbb_characteristics
  llbb_characteristics<B extends BackendTypes>(fx: FunctionCx<B>, target: BasicBlock): [boolean, boolean] {
    const cleanup_kinds = fx.cleanup_kinds;
    if (cleanup_kinds !== undefined) {
      const funclet_bb = CleanupKind.funclet_bb(cleanup_kinds[this.bb]!, this.bb);
      const target_funclet = CleanupKind.funclet_bb(cleanup_kinds[target]!, target);
      let needs_landing_pad: boolean;
      let is_cleanupret: boolean;
      if (funclet_bb === undefined && target_funclet === undefined) {
        [needs_landing_pad, is_cleanupret] = [false, false];
      } else if (funclet_bb === undefined && target_funclet !== undefined) {
        [needs_landing_pad, is_cleanupret] = [true, false];
      } else if (funclet_bb !== undefined && target_funclet !== undefined) {
        const f = funclet_bb;
        const t_f = target_funclet;
        [needs_landing_pad, is_cleanupret] = [f !== t_f, f !== t_f];
      } else {
        const span = this.terminator.source_info.span;
        return span_bug(span, `${debug_Terminator(this.terminator, PLAIN)} - jump out of cleanup?`);
      }
      return [needs_landing_pad, is_cleanupret];
    } else {
      const blocks = fx.mir.basic_blocks.deref();
      const needs_landing_pad = !blocks[this.bb]!.is_cleanup && blocks[target]!.is_cleanup;
      const is_cleanupret = false;
      return [needs_landing_pad, is_cleanupret];
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/mir/block.rs:137 funclet_br
  funclet_br<B extends BackendTypes>(
    fx: FunctionCx<B>,
    bx: BuilderMethods<B>,
    target: BasicBlock,
    mergeable_succ: boolean,
    loop_hint_attrs: readonly UnrollAttr[],
  ): MergingSucc {
    const [needs_landing_pad, is_cleanupret] = this.llbb_characteristics(fx, target);
    if (mergeable_succ && !needs_landing_pad && !is_cleanupret) {
      // We can merge the successor into this bb, so no need for a `br`.
      return MergingSucc.True;
    } else {
      let lltarget = fx.llbb(target);
      if (needs_landing_pad) {
        lltarget = fx.landing_pad_for(target);
      }
      if (is_cleanupret) {
        // micro-optimization: generate a `ret` rather than a jump
        // to a trampoline.
        bx.cleanup_ret(unwrap(this.funclet(fx)), lltarget);
      } else {
        bx.br_with_attrs(lltarget, loop_hint_attrs);
      }
      return MergingSucc.False;
    }
  }

  /// Call `fn_ptr` of `fn_abi` with the arguments `llargs`, the optional
  /// return destination `destination` and the unwind action `unwind`.
  /// The `return_slot` is [`ReturnSlot::Indirect`] for functions returning
  /// via `PassMode::Indirect`, and points to a buffer where the return value
  /// shall be stored.
  // rustc: compiler/rustc_codegen_ssa/src/mir/block.rs:170 do_call
  do_call<B extends BackendTypes>(
    fx: FunctionCx<B>,
    bx: BuilderMethods<B>,
    fn_abi: FnAbi<Ty>,
    fn_ptr: B["Value"],
    return_slot: ReturnSlot<B["Value"]>,
    llargs: readonly B["Value"][],
    destination: readonly [ReturnDest<B["Value"]>, BasicBlock] | undefined,
    unwind: UnwindAction,
    lifetime_ends_after_call: readonly (readonly [B["Value"], Size])[],
    instance: Instance | undefined,
    kind: CallKind,
    mergeable_succ: boolean,
  ): MergingSucc {
    const tcx = bx.tcx_();
    if (instance !== undefined && block_xlane.is_call_from_compiler_builtins_to_upstream_monomorphization(tcx, instance)) {
      if (destination !== undefined) {
        const caller_def = Instance.def_id(fx.instance);
        const e = {
          span: tcx.def_span(caller_def),
          caller: with_no_trimmed_paths(() => tcx.def_path_str(caller_def)),
          callee: with_no_trimmed_paths(() => tcx.def_path_str(Instance.def_id(instance))),
        };
        tcx.dcx().emit_err(CompilerBuiltinsCannotCall_diagnostic(e));
      } else {
        tracing.info(
          "rustc_codegen_ssa::mir::block",
          () => `compiler_builtins call to diverging function ${debug_DefId(Instance.def_id(instance), PLAIN)} replaced with abort`,
        );
        bx.abort_immediate();
        bx.unreachable();
        return MergingSucc.False;
      }
    }

    // If there is a cleanup block and the function we're calling can unwind, then
    // do an invoke, otherwise do a call.
    const fn_ty = bx.fn_decl_backend_type(fn_abi);

    let caller_attrs_: CodegenFnAttrs | undefined;
    if (DefKind.has_codegen_attrs(bx.tcx_().def_kind(Instance.def_id(fx.instance)))) {
      caller_attrs_ = TyCtxt_codegen_instance_attrs(bx.tcx_(), fx.instance.def);
    } else {
      caller_attrs_ = undefined;
    }
    const caller_attrs = caller_attrs_;

    if (!fn_abi.can_unwind) {
      unwind = UnwindAction.Unreachable;
    }

    let unwind_block: B["BasicBlock"] | undefined;
    switch (unwind.$) {
      case "Cleanup": {
        const cleanup = unwind._0;
        if (!fx.nop_landing_pads.contains(cleanup)) {
          unwind_block = this.llbb_with_cleanup(fx, cleanup);
        } else {
          unwind_block = undefined;
        }
        break;
      }
      case "Continue":
        unwind_block = undefined;
        break;
      case "Unreachable":
        unwind_block = undefined;
        break;
      case "Terminate": {
        const reason = unwind._0;
        if (fx.mir.basic_blocks.deref()[this.bb]!.is_cleanup && wants_wasm_eh(fx.cx.tcx_().sess.target)) {
          // For wasm, we need to generate a nested `cleanuppad within %outer_pad`
          // to catch exceptions during cleanup and call `panic_in_cleanup`.
          unwind_block = fx.terminate_block(reason, this.bb);
        } else if (fx.mir.basic_blocks.deref()[this.bb]!.is_cleanup && xlane.wants_new_eh_instructions(fx.cx.tcx_().sess.target)) {
          // MSVC SEH will abort automatically if an exception tries to
          // propagate out from cleanup.
          unwind_block = undefined;
        } else {
          unwind_block = fx.terminate_block(reason, undefined);
        }
        break;
      }
    }

    // debug_assert_eq!(
    //     return_slot.is_indirect(),
    //     fn_abi.ret.is_indirect(),
    //     "a return slot must be provided if and only if the return is `PassMode::Indirect`",
    // );

    if (kind === CallKind.Tail) {
      bx.tail_call(fn_ty, caller_attrs, fn_abi, fn_ptr, return_slot, llargs, this.funclet(fx), instance);
      return MergingSucc.False;
    }

    if (unwind_block !== undefined) {
      let ret_llbb: B["BasicBlock"];
      if (destination !== undefined) {
        const target = destination[1];
        ret_llbb = this.llbb_with_cleanup(fx, target);
      } else {
        ret_llbb = fx.unreachable_block_();
      }
      const invokeret = bx.invoke(fn_ty, caller_attrs, fn_abi, fn_ptr, return_slot, llargs, ret_llbb, unwind_block, this.funclet(fx), instance);
      if (fx.mir.basic_blocks.deref()[this.bb]!.is_cleanup) {
        bx.apply_attrs_to_cleanup_callsite(invokeret);
      }

      if (destination !== undefined) {
        const [ret_dest, target] = destination;
        bx.switch_to_block(fx.llbb(target));
        block_xlane.set_debug_loc(fx, bx, this.terminator.source_info);
        for (const [tmp, size] of lifetime_ends_after_call) {
          bx.lifetime_end(tmp, size);
        }
        fx.store_return(bx, ret_dest, fn_abi.ret, invokeret);

        // If the return value was retagged as it was stored,
        // then we might be in a different basic block now.
        // Update the cached block for `target` to point to this new
        // block, where codegen will continue.
        fx.cached_llbbs[target] = { $: "Some", _0: bx.llbb() };
      }
      return MergingSucc.False;
    } else {
      const llret = bx.call(fn_ty, caller_attrs, fn_abi, fn_ptr, return_slot, llargs, this.funclet(fx), instance);
      if (fx.mir.basic_blocks.deref()[this.bb]!.is_cleanup) {
        bx.apply_attrs_to_cleanup_callsite(llret);
      }

      if (destination !== undefined) {
        const [ret_dest, target] = destination;
        for (const [tmp, size] of lifetime_ends_after_call) {
          bx.lifetime_end(tmp, size);
        }
        fx.store_return(bx, ret_dest, fn_abi.ret, llret);
        return this.funclet_br(fx, bx, target, mergeable_succ, []);
      } else {
        bx.unreachable();
        return MergingSucc.False;
      }
    }
  }

  /// Generates inline assembly with optional `destination` and `unwind`.
  // rustc: compiler/rustc_codegen_ssa/src/mir/block.rs:336 do_inlineasm
  do_inlineasm<B extends BackendTypes>(
    fx: FunctionCx<B>,
    bx: BuilderMethods<B>,
    template: readonly InlineAsmTemplatePiece[],
    operands: readonly InlineAsmOperandRef<B>[],
    options: InlineAsmOptions,
    line_spans: readonly Span[],
    destination: BasicBlock | undefined,
    unwind: UnwindAction,
    instance: Instance,
    mergeable_succ: boolean,
  ): MergingSucc {
    let unwind_target: B["BasicBlock"] | undefined;
    switch (unwind.$) {
      case "Cleanup": {
        const cleanup = unwind._0;
        if (!fx.nop_landing_pads.contains(cleanup)) {
          unwind_target = this.llbb_with_cleanup(fx, cleanup);
        } else {
          unwind_target = undefined;
        }
        break;
      }
      case "Terminate":
        unwind_target = fx.terminate_block(unwind._0, undefined);
        break;
      case "Continue":
        unwind_target = undefined;
        break;
      case "Unreachable":
        unwind_target = undefined;
        break;
    }

    if (operands.some((x) => x.$ === "Label")) {
      assert(unwind_target === undefined, "assertion failed: unwind_target.is_none()");
      let ret_llbb: B["BasicBlock"];
      if (destination !== undefined) {
        ret_llbb = this.llbb_with_cleanup(fx, destination);
      } else {
        ret_llbb = fx.unreachable_block_();
      }

      bx.codegen_inline_asm(template, operands, options, line_spans, instance, ret_llbb, undefined);
      return MergingSucc.False;
    } else if (unwind_target !== undefined) {
      const cleanup = unwind_target;
      let ret_llbb: B["BasicBlock"];
      if (destination !== undefined) {
        ret_llbb = this.llbb_with_cleanup(fx, destination);
      } else {
        ret_llbb = fx.unreachable_block_();
      }

      bx.codegen_inline_asm(template, operands, options, line_spans, instance, ret_llbb, [cleanup, this.funclet(fx)]);
      return MergingSucc.False;
    } else {
      bx.codegen_inline_asm(template, operands, options, line_spans, instance, undefined, undefined);

      if (destination !== undefined) {
        return this.funclet_br(fx, bx, destination, mergeable_succ, []);
      } else {
        bx.unreachable();
        return MergingSucc.False;
      }
    }
  }
}

declare module "./mod.ts" {
  interface FunctionCx<B extends BackendTypes, Cx extends CodegenMethods<B> = CodegenMethods<B>, Bx extends BuilderMethods<B, Cx> = BuilderMethods<B, Cx>> {
    codegen_resume_terminator(helper: TerminatorCodegenHelper, bx: Bx): void;
    codegen_switchint_terminator(helper: TerminatorCodegenHelper, bx: Bx, discr: Operand, targets: SwitchTargets): void;
    codegen_return_terminator(bx: Bx): void;
    codegen_drop_terminator(
      helper: TerminatorCodegenHelper,
      bx: Bx,
      source_info: SourceInfo,
      location: mir_Place,
      target: BasicBlock,
      unwind: UnwindAction,
      mergeable_succ: boolean,
    ): MergingSucc;
    codegen_assert_terminator(
      helper: TerminatorCodegenHelper,
      bx: Bx,
      terminator: Terminator,
      cond: Operand,
      expected: boolean,
      msg: AssertMessage,
      target: BasicBlock,
      unwind: UnwindAction,
      mergeable_succ: boolean,
    ): MergingSucc;
    codegen_terminate_terminator(helper: TerminatorCodegenHelper, bx: Bx, terminator: Terminator, reason: UnwindTerminateReason): void;
    codegen_panic_intrinsic(
      helper: TerminatorCodegenHelper,
      bx: Bx,
      intrinsic: IntrinsicDef,
      instance: Instance,
      source_info: SourceInfo,
      target: BasicBlock | undefined,
      unwind: UnwindAction,
      mergeable_succ: boolean,
    ): MergingSucc | undefined;
    codegen_call_terminator(
      helper: TerminatorCodegenHelper,
      bx: Bx,
      terminator: Terminator,
      func: Operand,
      args: readonly Spanned<Operand>[],
      destination: mir_Place,
      target: BasicBlock | undefined,
      unwind: UnwindAction,
      fn_span: Span,
      kind: CallKind,
      mergeable_succ: boolean,
    ): MergingSucc;
    codegen_asm_terminator(
      helper: TerminatorCodegenHelper,
      bx: Bx,
      asm_macro: InlineAsmMacro,
      terminator: Terminator,
      template: readonly InlineAsmTemplatePiece[],
      operands: readonly InlineAsmOperand[],
      options: InlineAsmOptions,
      line_spans: readonly Span[],
      targets: readonly BasicBlock[],
      unwind: UnwindAction,
      instance: Instance,
      mergeable_succ: boolean,
    ): MergingSucc;
    codegen_block(bb: BasicBlock): void;
    codegen_block_as_unreachable(bb: BasicBlock): void;
    codegen_terminator(bx: Bx, bb: BasicBlock, terminator: Terminator): MergingSucc;
    clear_padding_cmse(bx: Bx, base_ptr: B["Value"], limit: Size, layout: TyAndLayout): void;
    clear_variant_dependent_padding(bx: Bx, base_ptr: B["Value"], base_offset: Size, limit: Size, layout: TyAndLayout): void;
    zero_byte_ranges(bx: Bx, ptr: B["Value"], offset: Size, limit: Size, ranges: readonly { readonly start: Size; readonly end: Size }[]): void;
    codegen_argument(
      bx: Bx,
      conv: CanonAbi,
      op: OperandRef<B["Value"]>,
      by_move: boolean,
      llargs: B["Value"][],
      arg: ArgAbi<Ty>,
      lifetime_ends_after_call: (readonly [B["Value"], Size])[],
    ): void;
    codegen_arguments_untupled(
      bx: Bx,
      conv: CanonAbi,
      operand: Operand,
      llargs: B["Value"][],
      args: readonly ArgAbi<Ty>[],
      lifetime_ends_after_call: (readonly [B["Value"], Size])[],
    ): number;
    get_caller_location(bx: Bx, source_info: SourceInfo): OperandRef<B["Value"]>;
    get_personality_slot(bx: Bx): PlaceRef<B["Value"]>;
    landing_pad_for(bb: BasicBlock): B["BasicBlock"];
    landing_pad_for_uncached(bb: BasicBlock): B["BasicBlock"];
    unreachable_block_(): B["BasicBlock"]; // PORT: the field `unreachable_block` holds the name
    terminate_block(reason: UnwindTerminateReason, outer_catchpad_bb: BasicBlock | undefined): B["BasicBlock"];
    llbb(bb: BasicBlock): B["BasicBlock"];
    try_llbb(bb: BasicBlock): B["BasicBlock"] | undefined;
    make_return_dest(bx: Bx, dest: mir_Place, fn_ret: ArgAbi<Ty>): [ReturnDest<B["Value"]>, ReturnSlot<B["Value"]>];
    store_return(bx: Bx, dest: ReturnDest<B["Value"]>, ret_abi: ArgAbi<Ty>, llval: B["Value"]): void;
  }
}

type Fx = FunctionCx<BackendTypes>;
type BxT = BuilderMethods<BackendTypes>;
type V = unknown;

/** `impl<'a, 'tcx, Bx: BuilderMethods<'a, 'tcx>> FunctionCx<'a, 'tcx, Bx>` of block.rs ("Codegen implementations for some
 *  terminator variants"); mod.ts calls this once, right after its `class FunctionCx` (header). */
// PORT: installer instead of top-level prototype writes (TDZ cycle with mod.ts; header).
export function install_FunctionCx_block(FunctionCx_: { prototype: FunctionCx<BackendTypes> }): void {
  /// Generates code for a `Resume` terminator.
  // rustc: compiler/rustc_codegen_ssa/src/mir/block.rs:413 codegen_resume_terminator
  FunctionCx_.prototype.codegen_resume_terminator = function (this: Fx, helper: TerminatorCodegenHelper, bx: BxT): void {
    const funclet = helper.funclet(this);
    if (funclet !== undefined) {
      bx.cleanup_ret(funclet, undefined);
    } else {
      const slot = this.get_personality_slot(bx);
      const exn0_ = slot.project_field(bx, 0);
      const exn0 = bx.load_operand(exn0_).immediate(bx.debug_Value);
      const exn1_ = slot.project_field(bx, 1);
      const exn1 = bx.load_operand(exn1_).immediate(bx.debug_Value);
      slot.storage_dead(bx);

      bx.resume(exn0, exn1);
    }
  };

  // rustc: compiler/rustc_codegen_ssa/src/mir/block.rs:428 codegen_switchint_terminator
  FunctionCx_.prototype.codegen_switchint_terminator = function (
    this: Fx,
    helper: TerminatorCodegenHelper,
    bx: BxT,
    discr_: Operand,
    targets: SwitchTargets,
  ): void {
    const discr = this.codegen_operand(bx, discr_);
    const discr_value = discr.immediate(bx.debug_Value);
    const switch_ty = discr.layout.ty;
    // If our discriminant is a constant we can branch directly
    const const_discr = bx.const_to_opt_u128(discr_value, false);
    if (const_discr !== undefined) {
      const target = targets.target_for_value(const_discr);
      bx.br(helper.llbb_with_cleanup(this, target));
      return;
    }

    const target_iter = targets.iter();
    if (target_iter.size_hint()[0] === 1) {
      // If there are two targets (one conditional, one fallback), emit `br` instead of
      // `switch`.
      const [test_value, target] = unwrap_next(target_iter);
      const otherwise = targets.otherwise();
      const lltarget = helper.llbb_with_cleanup(this, target);
      const llotherwise = helper.llbb_with_cleanup(this, otherwise);
      const target_cold = this.cold_blocks[target]!;
      const otherwise_cold = this.cold_blocks[otherwise]!;
      // If `target_cold == otherwise_cold`, the branches have the same weight
      // so there is no expectation. If they differ, the `target` branch is expected
      // when the `otherwise` branch is cold.
      const expect = target_cold === otherwise_cold ? undefined : otherwise_cold;
      if (switch_ty === bx.tcx_().types.bool) {
        // Don't generate trivial icmps when switching on bool.
        switch (test_value) {
          case 0n: {
            const expect_ = expect === undefined ? undefined : !expect;
            bx.cond_br_with_expect(discr_value, llotherwise, lltarget, expect_);
            break;
          }
          case 1n:
            bx.cond_br_with_expect(discr_value, lltarget, llotherwise, expect);
            break;
          default:
            bug();
        }
      } else {
        const switch_llty = bx.immediate_backend_type(bx.layout_of(switch_ty));
        const llval = bx.const_uint_big(switch_llty, test_value);
        const cmp = bx.icmp(IntPredicate.IntEQ, discr_value, llval);
        bx.cond_br_with_expect(cmp, lltarget, llotherwise, expect);
      }
    } else if (
      target_iter.size_hint()[0] === 2 &&
      this.mir.basic_blocks.deref()[targets.otherwise()]!.is_empty_unreachable() &&
      targets.all_values().includes(0n) &&
      targets.all_values().includes(1n)
    ) {
      // This is the really common case for `bool`, `Option`, etc.
      // By using `trunc nuw` we communicate that other values are
      // impossible without needing `switch` or `assume`s.
      const true_bb = targets.target_for_value(1n);
      const false_bb = targets.target_for_value(0n);
      const true_ll = helper.llbb_with_cleanup(this, true_bb);
      const false_ll = helper.llbb_with_cleanup(this, false_bb);

      let expected_cond_value: boolean | undefined;
      if (this.cx.sess().opts.optimize === OptLevel.No) {
        expected_cond_value = undefined;
      } else {
        const t = this.cold_blocks[true_bb]!;
        const f = this.cold_blocks[false_bb]!;
        if ((t && f) || (!t && !f)) {
          // Same coldness, no expectation
          expected_cond_value = undefined;
        } else if (t && !f) {
          // Different coldness, expect the non-cold one
          expected_cond_value = false;
        } else {
          expected_cond_value = true;
        }
      }

      const bool_ty = bx.tcx_().types.bool;
      let cond: V;
      if (switch_ty === bool_ty) {
        cond = discr_value;
      } else {
        const bool_llty = bx.immediate_backend_type(bx.layout_of(bool_ty));
        cond = bx.unchecked_utrunc(discr_value, bool_llty);
      }
      bx.cond_br_with_expect(cond, true_ll, false_ll, expected_cond_value);
    } else if (
      this.cx.sess().opts.optimize === OptLevel.No &&
      target_iter.size_hint()[0] === 2 &&
      this.mir.basic_blocks.deref()[targets.otherwise()]!.is_empty_unreachable()
    ) {
      // In unoptimized builds, if there are two normal targets and the `otherwise` target is
      // an unreachable BB, emit `br` instead of `switch`. This leaves behind the unreachable
      // BB, which will usually (but not always) be dead code.
      //
      // Why only in unoptimized builds?
      // - In unoptimized builds LLVM uses FastISel which does not support switches, so it
      //   must fall back to the slower SelectionDAG isel. Therefore, using `br` gives
      //   significant compile time speedups for unoptimized builds.
      // - In optimized builds the above doesn't hold, and using `br` sometimes results in
      //   worse generated code because LLVM can no longer tell that the value being switched
      //   on can only have two values, e.g. 0 and 1.
      //
      const [test_value1, target1] = unwrap_next(target_iter);
      const [_test_value2, target2] = unwrap_next(target_iter);
      const ll1 = helper.llbb_with_cleanup(this, target1);
      const ll2 = helper.llbb_with_cleanup(this, target2);
      const switch_llty = bx.immediate_backend_type(bx.layout_of(switch_ty));
      const llval = bx.const_uint_big(switch_llty, test_value1);
      const cmp = bx.icmp(IntPredicate.IntEQ, discr_value, llval);
      bx.cond_br(cmp, ll1, ll2);
    } else {
      const otherwise = targets.otherwise();
      const otherwise_cold = this.cold_blocks[otherwise]!;
      const otherwise_unreachable = this.mir.basic_blocks.deref()[otherwise]!.is_empty_unreachable();
      let cold_count = 0;
      for (const [, target] of targets.iter()) if (this.cold_blocks[target]!) cold_count++;
      const none_cold = cold_count === 0;
      const all_cold = cold_count === targets.iter().size_hint()[0];
      if ((none_cold && (!otherwise_cold || otherwise_unreachable)) || (all_cold && (otherwise_cold || otherwise_unreachable))) {
        // All targets have the same weight,
        // or `otherwise` is unreachable and it's the only target with a different weight.
        // PORT: the lazy `target_iter.map(..)` is collected after `else_llbb` is evaluated, as the call's
        // arguments are evaluated in order and the backend consumes the iterator inside `switch`.
        const else_llbb = helper.llbb_with_cleanup(this, targets.otherwise());
        const cases: (readonly [bigint, V])[] = [];
        for (const [value, target] of target_iter) cases.push([value, helper.llbb_with_cleanup(this, target)]);
        bx.switch(discr_value, else_llbb, cases);
      } else {
        // Targets have different weights
        const else_llbb = helper.llbb_with_cleanup(this, targets.otherwise());
        const cases: (readonly [bigint, V, boolean])[] = [];
        for (const [value, target] of target_iter) cases.push([value, helper.llbb_with_cleanup(this, target), this.cold_blocks[target]!]);
        bx.switch_with_weights(discr_value, else_llbb, otherwise_cold, cases);
      }
    }
  };

  // rustc: compiler/rustc_codegen_ssa/src/mir/block.rs:566 codegen_return_terminator
  FunctionCx_.prototype.codegen_return_terminator = function (this: Fx, bx: BxT): void {
    // Explicitly end the lifetime of the VaList if this function is c-variadic. We explicitly
    // start the lifetime when desugaring `...`. Ending the lifetime meaningfully improves
    // codegen.
    if (this.fn_abi.c_variadic) {
      // The `VaList` "spoofed" argument is just after all the real arguments.
      const va_list_arg_idx = this.fn_abi.args.length;
      const local_ref = this.locals.index(Local.arg(va_list_arg_idx));
      switch (local_ref.$) {
        case "Place": {
          const va_list = local_ref._0;
          // NOTE: we don't actually call LLVM's va_end here. We know it's a no-op for
          // all current targets and hence don't bother
          // (as permitted by https://llvm.org/docs/LangRef.html#llvm-va-end-intrinsic).

          // Explicitly end the lifetime of the `va_list`, improves LLVM codegen.
          bx.lifetime_end(va_list.val.llval, va_list.layout.size);
          break;
        }
        default:
          bug("C-variadic function must have a `VaList` place");
      }
    }
    if (this.fn_abi.ret.layout.is_uninhabited()) {
      // Functions with uninhabited return values are marked `noreturn`,
      // so we should make sure that we never actually do.
      // We play it safe by using a well-defined `abort`, but we could go for immediate UB
      // if that turns out to be helpful.
      bx.abort_immediate();
      // `abort` does not terminate the block, so we still need to generate
      // an `unreachable` terminator after it.
      bx.unreachable();
      return;
    }
    let llval: V;
    const mode = this.fn_abi.ret.mode;
    switch (mode.$) {
      case "Ignore":
      case "Indirect":
        bx.ret_void();
        return;

      case "Direct":
      case "Pair": {
        const op = this.codegen_consume(bx, mir_Place.return_place().as_ref());
        if (op.val.$ === "Ref") {
          const place_val = op.val._0;
          llval = bx.load_from_place(bx.backend_type(op.layout), place_val);
        } else {
          llval = op.immediate_or_packed_pair(bx);
        }
        break;
      }

      case "Cast": {
        const cast_ty = mode.cast;
        let op: OperandRef<V>;
        const local_ref = this.locals.index(RETURN_PLACE);
        switch (local_ref.$) {
          case "Operand":
            op = local_ref._0;
            break;
          case "PendingOperand":
            return bug("use of return before def");
          case "Place": {
            const cg_place = local_ref._0;
            op = new OperandRef<V>({ $: "Ref", _0: cg_place.val }, cg_place.layout, undefined);
            break;
          }
          case "UnsizedPlace":
            return bug("return type must be sized");
        }
        let llslot: V;
        const val = op.val;
        switch (val.$) {
          case "Immediate":
          case "Pair": {
            const scratch = PlaceRef.alloca(bx, this.fn_abi.ret.layout);
            OperandValue.store(op.val, bx, scratch);
            llslot = scratch.val.llval;
            break;
          }
          case "Ref": {
            const place_val = val._0;
            assert_eq_msg(place_val.align, op.layout.align.abi, (a) => debug_Align(a, PLAIN), (a, b) => a.pow2 === b.pow2, "return place is unaligned!");
            llslot = place_val.llval;
            break;
          }
          case "ZeroSized":
            return bug("ZST return value shouldn't be in PassMode::Cast");
        }

        if (canon_abi_is_arm(this.fn_abi.conv, "CCmseNonSecureEntry")) {
          // The return value of an `extern "cmse-nonsecure-entry"` function crosses the
          // secure boundary. Clear any padding bytes so information does not leak.
          const ret_layout = this.fn_abi.ret.layout;
          this.clear_padding_cmse(bx, llslot, ret_layout.size, ret_layout);
        }

        llval = load_cast(bx, cast_ty, llslot, this.fn_abi.ret.layout.align.abi);
        break;
      }
      case "IndirectUnsized":
        return bug("unsized returns are not supported");
    }
    bx.ret(llval);
  };

  // #[tracing::instrument(level = "trace", skip(self, helper, bx))]
  // rustc: compiler/rustc_codegen_ssa/src/mir/block.rs:653 codegen_drop_terminator
  FunctionCx_.prototype.codegen_drop_terminator = function (
    this: Fx,
    helper: TerminatorCodegenHelper,
    bx: BxT,
    source_info: SourceInfo,
    location: mir_Place,
    target: BasicBlock,
    unwind: UnwindAction,
    mergeable_succ: boolean,
  ): MergingSucc {
    const ty_ = location.ty(this.mir, bx.tcx_()).ty;
    const ty = this.monomorphize(ty_, fold_Ty);
    const drop_fn = Instance.resolve_drop_glue(bx.tcx_(), ty);

    if (drop_fn.def.$ === "Shim" && drop_fn.def._0.$ === "DropGlue" && drop_fn.def._0._1 === undefined) {
      // we don't actually need to drop anything.
      return helper.funclet_br(this, bx, target, mergeable_succ, []);
    }

    const place = this.codegen_place(bx, location.as_ref());
    let args: readonly V[];
    const llextra = place.val.llextra;
    if (llextra !== undefined) {
      args = [place.val.llval, llextra];
    } else {
      args = [place.val.llval];
    }
    let maybe_null: boolean;
    let drop_fn_ptr: V;
    let fn_abi: FnAbi<Ty>;
    let drop_instance: Instance;
    if (ty.kind().$ === "Dynamic") {
      // FIXME(eddyb) perhaps move some of this logic into
      // `Instance::resolve_drop_glue`?

      // IN THIS ARM, WE HAVE:
      // ty = *mut (dyn Trait)
      // which is: exists<T> ( *mut T,    Vtable<T: Trait> )
      //                       args[0]    args[1]
      //
      // args = ( Data, Vtable )
      //                  |
      //                  v
      //                /-------\
      //                | ...   |
      //                \-------/
      //
      const virtual_drop: Instance = {
        def: { $: "Virtual", _0: Instance.def_id(drop_fn), _1: 0 }, // idx 0: the drop function
        args: drop_fn.args,
      };
      // debug!("ty = {:?}", ty);
      // debug!("drop_fn = {:?}", drop_fn);
      // debug!("args = {:?}", args);
      const fn_abi_ = bx.fn_abi_of_instance(virtual_drop, RawList.empty());
      const vtable = args[1];
      // Truncate vtable off of args list
      args = args.slice(0, 1);
      maybe_null = true;
      drop_fn_ptr = block_xlane.VirtualIndex_get_optional_fn(COMMON_VTABLE_ENTRIES_DROPINPLACE, bx, vtable, ty, fn_abi_);
      fn_abi = fn_abi_;
      drop_instance = virtual_drop;
    } else {
      maybe_null = false;
      drop_fn_ptr = bx.get_fn_addr(drop_fn, bx.sess().pointer_authentication_functions());
      fn_abi = bx.fn_abi_of_instance(drop_fn, RawList.empty());
      drop_instance = drop_fn;
    }

    // We generate a null check for the drop_fn. This saves a bunch of relocations being
    // generated for no-op drops.
    if (maybe_null) {
      const is_not_null = bx.append_sibling_block("is_not_null");
      const llty = bx.fn_ptr_backend_type(fn_abi);
      const null_ = bx.const_null(llty);
      const non_null = bx.icmp(bin_op_to_icmp_predicate(BinOp.Ne, false), drop_fn_ptr, null_);
      bx.cond_br(non_null, is_not_null, helper.llbb_with_cleanup(this, target));
      bx.switch_to_block(is_not_null);
      block_xlane.set_debug_loc(this, bx, source_info);
    }

    return helper.do_call(
      this,
      bx,
      fn_abi,
      drop_fn_ptr,
      ReturnSlot.Direct,
      args,
      [ReturnDest.Nothing, target],
      unwind,
      [],
      drop_instance,
      CallKind.Normal,
      !maybe_null && mergeable_succ,
    );
  };

  // rustc: compiler/rustc_codegen_ssa/src/mir/block.rs:753 codegen_assert_terminator
  FunctionCx_.prototype.codegen_assert_terminator = function (
    this: Fx,
    helper: TerminatorCodegenHelper,
    bx: BxT,
    terminator: Terminator,
    cond_: Operand,
    expected: boolean,
    msg: AssertMessage,
    target: BasicBlock,
    unwind: UnwindAction,
    mergeable_succ: boolean,
  ): MergingSucc {
    const span = terminator.source_info.span;
    const cond = this.codegen_operand(bx, cond_).immediate(bx.debug_Value);
    const c = bx.const_to_opt_u128(cond, false);
    let const_cond = c === undefined ? undefined : c === 1n;

    // This case can currently arise only from functions marked
    // with #[rustc_inherit_overflow_checks] and inlined from
    // another crate (mostly core::num generic/#[inline] fns),
    // while the current crate doesn't use overflow checks.
    if (!bx.sess().overflow_checks() && AssertKind.is_optional_overflow_check(msg)) {
      const_cond = expected;
    }

    // Don't codegen the panic block if success if known.
    if (const_cond === expected) {
      return helper.funclet_br(this, bx, target, mergeable_succ, []);
    }

    // Because we're branching to a panic block (either a `#[cold]` one
    // or an inlined abort), there's no need to `expect` it.

    // Create the failure block and the conditional branch to it.
    const lltarget = helper.llbb_with_cleanup(this, target);
    const panic_block = bx.append_sibling_block("panic");
    if (expected) {
      bx.cond_br(cond, lltarget, panic_block);
    } else {
      bx.cond_br(cond, panic_block, lltarget);
    }

    // After this point, bx is the block for the call to panic.
    bx.switch_to_block(panic_block);
    block_xlane.set_debug_loc(this, bx, terminator.source_info);

    // Get the location information.
    const location = this.get_caller_location(bx, terminator.source_info).immediate(bx.debug_Value);

    // Put together the arguments to the panic entry point.
    let lang_item: LangItem;
    let args: V[];
    switch (msg.$) {
      case "BoundsCheck": {
        const len = this.codegen_operand(bx, msg.len).immediate(bx.debug_Value);
        const index = this.codegen_operand(bx, msg.index).immediate(bx.debug_Value);
        // It's `fn panic_bounds_check(index: usize, len: usize)`,
        // and `#[track_caller]` adds an implicit third argument.
        [lang_item, args] = ["PanicBoundsCheck", [index, len, location]];
        break;
      }
      case "MisalignedPointerDereference": {
        const required = this.codegen_operand(bx, msg.required).immediate(bx.debug_Value);
        const found = this.codegen_operand(bx, msg.found).immediate(bx.debug_Value);
        // It's `fn panic_misaligned_pointer_dereference(required: usize, found: usize)`,
        // and `#[track_caller]` adds an implicit third argument.
        [lang_item, args] = ["PanicMisalignedPointerDereference", [required, found, location]];
        break;
      }
      case "NullPointerDereference":
        // It's `fn panic_null_pointer_dereference()`,
        // `#[track_caller]` adds an implicit argument.
        [lang_item, args] = ["PanicNullPointerDereference", [location]];
        break;
      case "NullReferenceConstructed":
        // It's `fn panic_null_reference_constructed()`,
        // `#[track_caller]` adds an implicit argument.
        [lang_item, args] = ["PanicNullReferenceConstructed", [location]];
        break;
      case "InvalidEnumConstruction": {
        const source = this.codegen_operand(bx, msg._0).immediate(bx.debug_Value);
        // It's `fn panic_invalid_enum_construction(source: u128)`,
        // `#[track_caller]` adds an implicit argument.
        [lang_item, args] = ["PanicInvalidEnumConstruction", [source, location]];
        break;
      }
      default:
        // It's `pub fn panic_...()` and `#[track_caller]` adds an implicit argument.
        [lang_item, args] = [AssertKind.panic_function(msg), [location]];
        break;
    }

    const [fn_abi, llfn, instance] = build_langcall(bx, span, lang_item);

    // Codegen the actual panic invoke/call.
    const merging_succ = helper.do_call(this, bx, fn_abi, llfn, ReturnSlot.Direct, args, undefined, unwind, [], instance, CallKind.Normal, false);
    assert_eq_dbg(merging_succ, MergingSucc.False, debug_MergingSucc);
    return MergingSucc.False;
  };

  // rustc: compiler/rustc_codegen_ssa/src/mir/block.rs:860 codegen_terminate_terminator
  FunctionCx_.prototype.codegen_terminate_terminator = function (
    this: Fx,
    helper: TerminatorCodegenHelper,
    bx: BxT,
    terminator: Terminator,
    reason: UnwindTerminateReason,
  ): void {
    const span = terminator.source_info.span;
    block_xlane.set_debug_loc(this, bx, terminator.source_info);

    // Obtain the panic entry point.
    const [fn_abi, llfn, instance] = build_langcall(bx, span, UnwindTerminateReason.lang_item(reason));

    // Codegen the actual panic invoke/call.
    const merging_succ = helper.do_call(this, bx, fn_abi, llfn, ReturnSlot.Direct, [], undefined, UnwindAction.Unreachable, [], instance, CallKind.Normal, false);
    assert_eq_dbg(merging_succ, MergingSucc.False, debug_MergingSucc);
  };

  /// Returns `Some` if this is indeed a panic intrinsic and codegen is done.
  // rustc: compiler/rustc_codegen_ssa/src/mir/block.rs:892 codegen_panic_intrinsic
  FunctionCx_.prototype.codegen_panic_intrinsic = function (
    this: Fx,
    helper: TerminatorCodegenHelper,
    bx: BxT,
    intrinsic: IntrinsicDef,
    instance: Instance,
    source_info: SourceInfo,
    target: BasicBlock | undefined,
    unwind: UnwindAction,
    mergeable_succ: boolean,
  ): MergingSucc | undefined {
    // Emit a panic or a no-op for `assert_*` intrinsics.
    // These are intrinsics that compile to panics so that we can get a message
    // which mentions the offending type, even from a const context.
    const requirement = ValidityRequirement.from_intrinsic(intrinsic.name);
    if (requirement === undefined) {
      return undefined;
    }

    const ty = instance.args.type_at(0);

    const r = bx.tcx_().check_validity_requirement([requirement, bx.typing_env_().as_query_input(ty)]);
    if (r.$ === "Err") return panic(`expect to have layout during codegen: ${debug_LayoutError(r._0, PLAIN)}`);
    const is_valid = r._0;

    if (is_valid) {
      // a NOP
      const target_ = unwrap(target);
      return helper.funclet_br(this, bx, target_, mergeable_succ, []);
    }

    const layout = bx.layout_of(ty);

    const msg_str = with_no_visible_paths(() =>
      with_no_trimmed_paths(() => {
        if (layout.is_uninhabited()) {
          // Use this error even for the other intrinsics as it is more precise.
          return `attempted to instantiate uninhabited type \`${display_Ty(ty)}\``;
        } else if (requirement === ValidityRequirement.Zero) {
          return `attempted to zero-initialize type \`${display_Ty(ty)}\`, which is invalid`;
        } else {
          return `attempted to leave type \`${display_Ty(ty)}\` uninitialized, which is invalid`;
        }
      }),
    );
    const msg = bx.const_str(msg_str);

    // Obtain the panic entry point.
    const [fn_abi, llfn, instance_] = build_langcall(bx, source_info.span, "PanicNounwind");

    // Codegen the actual panic invoke/call.
    return helper.do_call(
      this,
      bx,
      fn_abi,
      llfn,
      ReturnSlot.Direct,
      [msg[0], msg[1]],
      target === undefined ? undefined : [ReturnDest.Nothing, target],
      unwind,
      [],
      instance_,
      CallKind.Normal,
      mergeable_succ,
    );
  };

  // rustc: compiler/rustc_codegen_ssa/src/mir/block.rs:960 codegen_call_terminator
  FunctionCx_.prototype.codegen_call_terminator = function (
    this: Fx,
    helper: TerminatorCodegenHelper,
    bx: BxT,
    terminator: Terminator,
    func: Operand,
    args: readonly Spanned<Operand>[],
    destination_: mir_Place,
    target: BasicBlock | undefined,
    unwind: UnwindAction,
    fn_span: Span,
    kind: CallKind,
    mergeable_succ: boolean,
  ): MergingSucc {
    const source_info = new SourceInfo(fn_span, terminator.source_info.scope);

    // Create the callee. This is a fn ptr or zero-sized and hence a kind of scalar.
    const callee = this.codegen_operand(bx, func);

    let instance: Instance | undefined;
    let llfn: V | undefined;
    const callee_kind = callee.layout.ty.kind();
    switch (callee_kind.$) {
      case "FnDef": {
        const def_id = callee_kind._0;
        const generic_args = callee_kind._1;
        const instance_ = Instance.expect_resolve(bx.tcx_(), bx.typing_env_(), def_id, unwrap(Binder.no_bound_vars(generic_args, fold_GenericArgs)), fn_span);

        const def = instance_.def;
        if (def.$ === "Shim" && def._0.$ === "DropGlue" && def._0._1 === undefined) {
          // We don't need AsyncDropGlueCtorShim here because it is not `noop func`,
          // it is `func returning noop future`
          // Empty drop glue; a no-op.
          const target_ = unwrap(target);
          return helper.funclet_br(this, bx, target_, mergeable_succ, []);
        } else if (def.$ === "Intrinsic") {
          const intrinsic = unwrap(bx.tcx_().intrinsic(def._0));
          const merging_succ = this.codegen_panic_intrinsic(helper, bx, intrinsic, instance_, source_info, target, unwind, mergeable_succ);
          if (merging_succ !== undefined) {
            return merging_succ;
          }

          const result_layout = this.cx.layout_of(this.monomorphized_place_ty(destination_.as_ref()));

          let result_place: PlaceValue<V> | undefined;
          let store_in_local: Local | undefined;
          const local = destination_.as_local();
          if (local !== undefined) {
            const local_ref = this.locals.index(local);
            switch (local_ref.$) {
              case "Place":
                [result_place, store_in_local] = [local_ref._0.val, undefined];
                break;
              case "UnsizedPlace":
                return bug("return type must be sized");
              case "PendingOperand":
                [result_place, store_in_local] = [undefined, local];
                break;
              case "Operand":
                if (result_layout.is_zst()) {
                  const place = PlaceRef.new_sized(bx.const_undef(bx.type_ptr()), result_layout);
                  [result_place, store_in_local] = [place.val, undefined];
                } else {
                  return bug("place local already assigned to");
                }
                break;
            }
          } else {
            [result_place, store_in_local] = [this.codegen_place(bx, destination_.as_ref()).val, undefined];
          }

          if (result_place !== undefined && result_place.align.pow2 < result_layout.align.abi.pow2) {
            // Currently, MIR code generation does not create calls
            // that store directly to fields of packed structs (in
            // fact, the calls it creates write only to temps).
            //
            // If someone changes that, please update this code path
            // to create a temporary.
            return span_bug(this.mir.span, "can't directly store to unaligned value");
          }

          const op_args: OperandRef<V>[] = args.map((arg) => this.codegen_operand(bx, arg.node));

          const intrinsic_result = block_xlane.codegen_intrinsic_call(this, bx, instance_, op_args, result_layout, result_place, source_info);

          if (intrinsic_result.$ === "Operand") {
            const op_val = intrinsic_result._0;
            if (result_place === undefined && store_in_local !== undefined) {
              const op = new OperandRef<V>(op_val, result_layout, undefined);
              this.overwrite_local(store_in_local, { $: "Operand", _0: op });
              block_xlane.debug_introduce_local(this, bx, store_in_local);
            } else if (result_place !== undefined && store_in_local === undefined) {
              const dest = new PlaceRef(result_place, result_layout);
              OperandValue.store(op_val, bx, dest);
            } else {
              bug();
            }
          }

          switch (intrinsic_result.$) {
            case "Operand":
            case "WroteIntoPlace":
              if (target !== undefined) {
                return helper.funclet_br(this, bx, target, mergeable_succ, []);
              } else {
                bx.unreachable();
                return MergingSucc.False;
              }
            case "Err": {
              // Even though we're definitely going to error, we need it initialize
              // the local or `maybe_codegen_consume_direct` might ICE later
              // when it goes to use the result from this intrinsic.
              if (store_in_local !== undefined) {
                const op = new OperandRef<V>(OperandValue.poison(bx, result_layout), result_layout, undefined);
                this.overwrite_local(store_in_local, { $: "Operand", _0: op });
              }
              // Also we need to terminate the block to avoid an LLVM assertion,
              // even though we're not going to actually use the IR.
              bx.abort_immediate();
              return MergingSucc.False;
            }
            case "Fallback": {
              const fallback = intrinsic_result._0;
              if (intrinsic.must_be_overridden) {
                return span_bug(fn_span, `intrinsic ${Symbol.as_str(intrinsic.name)} must be overridden by codegen backend, but isn't`);
              }
              [instance, llfn] = [fallback, undefined];
              break;
            }
          }
        } else if (kind === CallKind.Tail && InstanceKind.requires_caller_location(def, bx.tcx_())) {
          const hir_id = SourceScope.lint_root(terminator.source_info.scope, this.mir.source_scopes);
          if (hir_id !== undefined) {
            bx.tcx_().emit_node_lint(
              TAIL_CALL_TRACK_CALLER,
              hir_id,
              DiagDecorator((d) => {
                void d.primary_message("tail calling a function marked with `#[track_caller]` has no special effect").span(fn_span);
              }),
            );
          }

          const instance__ = unwrap(Instance.resolve_for_fn_ptr(bx.tcx_(), bx.typing_env_(), def_id, unwrap(Binder.no_bound_vars(generic_args, fold_GenericArgs))));

          [instance, llfn] = [undefined, bx.get_fn_addr(instance__, bx.sess().pointer_authentication_functions())];
        } else {
          [instance, llfn] = [instance_, undefined];
        }
        break;
      }
      case "FnPtr":
        [instance, llfn] = [undefined, callee.immediate(bx.debug_Value)];
        break;
      default:
        return bug(`${display_Ty(callee.layout.ty)} is not callable`);
    }

    let name: Symbol | undefined;
    if (
      instance !== undefined &&
      instance.def.$ === "LlvmIntrinsic" &&
      (name = bx.tcx_().codegen_fn_attrs(Instance.def_id(instance)).symbol_name) !== undefined &&
      // This is the only LLVM intrinsic we use that unwinds
      // FIXME either add unwind support to codegen_llvm_intrinsic_call or replace usage of
      // this intrinsic with something else
      Symbol.as_str(name) !== "llvm.wasm.throw"
    ) {
      assert(!TypeVisitableExt.has_infer(instance.args, fold_GenericArgs), "assertion failed: !instance.args.has_infer()");
      assert(!TypeVisitableExt.has_escaping_bound_vars(instance.args, fold_GenericArgs), "assertion failed: !instance.args.has_escaping_bound_vars()");

      const result_layout = this.cx.layout_of(this.monomorphized_place_ty(destination_.as_ref()));

      let return_dest: ReturnDest<V>;
      const index = destination_.as_local();
      if (result_layout.is_zst()) {
        return_dest = ReturnDest.Nothing;
      } else if (index !== undefined) {
        const local_ref = this.locals.index(index);
        switch (local_ref.$) {
          case "Place":
            return_dest = { $: "Store", _0: local_ref._0 };
            break;
          case "UnsizedPlace":
            return bug("return type must be sized");
          case "PendingOperand":
            // Handle temporary places, specifically `Operand` ones, as
            // they don't have `alloca`s.
            return_dest = { $: "DirectOperand", _0: index };
            break;
          case "Operand":
            return bug("place local already assigned to");
        }
      } else {
        return_dest = { $: "Store", _0: this.codegen_place(bx, destination_.as_ref()) };
      }

      const op_args = args.map((arg) => this.codegen_operand(bx, arg.node));

      block_xlane.set_debug_loc(this, bx, source_info);

      const llret = bx.codegen_llvm_intrinsic_call(instance, op_args, this.mir.basic_blocks.deref()[helper.bb]!.is_cleanup);

      if (target !== undefined) {
        this.store_return(bx, return_dest, new ArgAbi<Ty>(result_layout, { $: "Direct", _0: ArgAttributes.new() }), llret);
        return helper.funclet_br(this, bx, target, mergeable_succ, []);
      } else {
        bx.unreachable();
        return MergingSucc.False;
      }
    }

    // FIXME(eddyb) avoid computing this if possible, when `instance` is
    // available - right now `sig` is only needed for getting the `abi`
    // and figuring out how many extra args were passed to a C-variadic `fn`.
    const sig = callee.layout.ty.fn_sig(bx.tcx_());

    const n_inputs = Binder.skip_binder(PolyFnSig.inputs(sig)).length;
    if (n_inputs > args.length) panic(`range start index ${n_inputs} out of range for slice of length ${args.length}`);
    const extra_args_ = args.slice(n_inputs);
    const extra_args = bx.tcx_().mk_type_list_from_iter(
      extra_args_.map((op_arg) => {
        const op_ty = mir_Operand.ty(op_arg.node, this.mir, bx.tcx_());
        return this.monomorphize(op_ty, fold_Ty);
      }),
    );

    let fn_abi: FnAbi<Ty>;
    if (instance !== undefined) {
      fn_abi = bx.fn_abi_of_instance(instance, extra_args);
    } else {
      fn_abi = bx.fn_abi_of_fn_ptr(sig, extra_args);
    }

    // The arguments we'll be passing. Plus one to account for outptr, if used.
    // let arg_count = fn_abi.args.len() + fn_abi.ret.is_indirect() as usize;

    // PORT: `Vec::with_capacity(arg_count)` is an empty array.
    const llargs: V[] = [];

    // We still need to call `make_return_dest` even if there's no `target`, since
    // `fn_abi.ret` could be `PassMode::Indirect`, even if it is uninhabited,
    // and `make_return_dest` adds the return-place indirect pointer to `llargs`.
    let destination: readonly [ReturnDest<V>, BasicBlock] | undefined;
    let return_slot: ReturnSlot<V>;
    switch (kind) {
      case "Normal": {
        const [return_dest, return_slot_] = this.make_return_dest(bx, destination_, fn_abi.ret);
        [destination, return_slot] = [target === undefined ? undefined : [return_dest, target], return_slot_];
        break;
      }
      case "Tail": {
        let return_slot_: ReturnSlot<V>;
        if (fn_abi.ret.is_indirect()) {
          const r = this.make_return_dest(bx, destination_, fn_abi.ret);
          if (r[0].$ === "Nothing") {
            return_slot_ = r[1];
          } else {
            return bug("tail calls to functions with indirect returns cannot store into a destination");
          }
        } else {
          return_slot_ = ReturnSlot.Direct;
        }
        [destination, return_slot] = [undefined, return_slot_];
        break;
      }
    }

    // Split the rust-call tupled arguments off.
    // FIXME(splat): un-tuple splatted arguments in codegen, for performance
    let first_args: readonly Spanned<Operand>[];
    let untuple: Spanned<Operand> | undefined;
    if (ExternAbi.eq(PolyFnSig.abi(sig), ExternAbi.RustCall) && args.length > 0) {
      const tup = args[args.length - 1]!;
      const args_ = args.slice(0, args.length - 1);
      [first_args, untuple] = [args_, tup];
    } else {
      [first_args, untuple] = [args, undefined];
    }

    // Special logic for tail calls with `PassMode::Indirect { mode: IndirectMode::Pointer, .. }` arguments.
    //
    // Normally an indirect argument that is allocated in the caller's stack frame
    // would be passed as a pointer into the callee's stack frame.
    // For tail calls, that would be unsound, because the caller's
    // stack frame is overwritten by the callee's stack frame.
    //
    // Therefore we store the argument for the callee in the corresponding caller's slot.
    // Because guaranteed tail calls demand that the caller's signature matches the callee's,
    // the corresponding slot has the correct type.
    //
    // To handle cases like the one below, the tail call arguments must first be copied to a
    // temporary, and only then copied to the caller's argument slots.
    //
    // ```
    // // A struct big enough that it is not passed via registers.
    // pub struct Big([u64; 4]);
    //
    // fn swapper(a: Big, b: Big) -> (Big, Big) {
    //     become swapper_helper(b, a);
    // }
    // ```
    let tail_call_temporaries: (PlaceRef<V> | undefined)[] = [];
    if (kind === CallKind.Tail) {
      tail_call_temporaries = first_args.map(() => undefined);
      // Copy the arguments that use `PassMode::Indirect { mode: IndirectMode::Pointer , ..}`
      // to temporary stack allocations. See the comment above.
      for (let i = 0; i < first_args.length; i++) {
        const arg = first_args[i]!;
        if (fn_abi.args[i]!.mode.$ === "IndirectUnsized") {
          bug('extern "tail" arguments must not be unsized');
        }

        const mode_i = fn_abi.args[i]!.mode;
        if (!(mode_i.$ === "Indirect" && mode_i.mode === "Pointer")) {
          continue;
        }

        const op = this.codegen_operand(bx, arg.node);
        const tmp = PlaceRef.alloca(bx, op.layout);
        bx.lifetime_start(tmp.val.llval, tmp.layout.size);
        op.store_with_annotation(bx, tmp);

        tail_call_temporaries[i] = tmp;
      }
    }

    // When generating arguments we sometimes introduce temporary allocations with lifetime
    // that extend for the duration of a call. Keep track of those allocations and their sizes
    // to generate `lifetime_end` when the call returns.
    const lifetime_ends_after_call: (readonly [V, Size])[] = [];
    make_args: for (let i = 0; i < first_args.length; i++) {
      const arg = first_args[i]!;
      let op = this.codegen_operand(bx, arg.node);

      const def = instance?.def;
      if (i === 0 && def !== undefined && def.$ === "Virtual") {
        const idx = def._1;
        const val = op.val;
        if (val.$ === "Pair") {
          const data_ptr = val._0;
          const meta = val._1;
          // In the case of Rc<Self>, we need to explicitly pass a
          // *mut RcInner<Self> with a Scalar (not ScalarPair) ABI. This is a hack
          // that is understood elsewhere in the compiler as a method on
          // `dyn Trait`.
          // To get a `*mut RcInner<Self>`, we just keep unwrapping newtypes until
          // we get a value of a built-in pointer type.
          //
          // This is also relevant for `Pin<&mut Self>`, where we need to peel the
          // `Pin`.
          while (!op.layout.ty.is_raw_ptr() && !op.layout.ty.is_ref()) {
            const [idx_] = unwrap(op.layout.non_1zst_field(bx), "not exactly one non-1-ZST field in a `DispatchFromDyn` type");
            op = op.extract_field(this, bx, idx_);
          }

          // Now that we have `*dyn Trait` or `&dyn Trait`, split it up into its
          // data pointer and vtable. Look up the method in the vtable, and pass
          // the data pointer as the first argument.
          llfn = block_xlane.VirtualIndex_get_fn(idx, bx, meta, op.layout.ty, fn_abi);
          llargs.push(data_ptr);
          continue make_args;
        } else if (val.$ === "Ref" && val._0.llextra !== undefined) {
          const data_ptr = val._0.llval;
          const meta = val._0.llextra;
          // by-value dynamic dispatch
          llfn = block_xlane.VirtualIndex_get_fn(idx, bx, meta, op.layout.ty, fn_abi);
          llargs.push(data_ptr);
          continue;
        } else {
          const op_ = op;
          span_bug(fn_span, `can't codegen a virtual call on ${debug_OperandRef(op_, PRETTY, bx.debug_Value)}`);
        }
      }

      let by_move: boolean;
      const mode_i = fn_abi.args[i]!.mode;
      if (mode_i.$ === "Indirect" && mode_i.mode === "Pointer" && kind === CallKind.Tail) {
        // Special logic for tail calls with `PassMode::Indirect { mode: IndirectMode::Pointer, .. }` arguments.
        //
        // Normally an indirect argument that is allocated in the caller's stack frame
        // would be passed as a pointer into the callee's stack frame.
        // For tail calls, that would be unsound, because the caller's
        // stack frame is overwritten by the callee's stack frame.
        //
        // To handle the case, we introduce `tail_call_temporaries` to copy arguments into
        // temporaries, then copy back to the caller's argument slots.
        // Finally, we pass the caller's argument slots as arguments.
        //
        // To do that, the argument must be MUST-by-move value.
        const tmp = tail_call_temporaries[i];
        tail_call_temporaries[i] = undefined;
        if (tmp === undefined) {
          span_bug(fn_span, `missing temporary for indirect tail call argument #${i}`);
        }

        const local = unwrap(this.mir.args_iter()[i]);

        const local_ref = this.locals.index(local);
        switch (local_ref.$) {
          case "Place": {
            const arg_ = local_ref._0;
            bx.typed_place_copy(arg_.val, tmp.val, fn_abi.args[i]!.layout);
            // PORT: `op.val = Ref(arg.val)` on the local copy: a new `OperandRef` (header).
            op = new OperandRef<V>({ $: "Ref", _0: arg_.val }, op.layout, op.move_annotation);
            break;
          }
          case "Operand": {
            const arg_ = local_ref._0;
            if (arg_.val.$ !== "Ref") {
              return bug(`only \`Ref\` should use \`PassMode::Indirect\`, but got ${debug_OperandValue(arg_.val, PLAIN, bx.debug_Value)}`);
            }
            const place_value = arg_.val._0;
            bx.typed_place_copy(place_value, tmp.val, fn_abi.args[i]!.layout);
            // PORT: `op.val = arg.val` on the local copy: a new `OperandRef` (header).
            op = new OperandRef<V>(arg_.val, op.layout, op.move_annotation);
            break;
          }
          case "UnsizedPlace":
            return span_bug(fn_span, "unsized types are not supported");
          case "PendingOperand":
            return span_bug(fn_span, "argument local should not be pending");
        }

        bx.lifetime_end(tmp.val.llval, tmp.layout.size);
        by_move = true;
      } else {
        by_move = arg.node.$ === "Move";
      }

      this.codegen_argument(bx, fn_abi.conv, op, by_move, llargs, fn_abi.args[i]!, lifetime_ends_after_call);
    }
    const num_untupled =
      untuple === undefined
        ? undefined
        : this.codegen_arguments_untupled(bx, fn_abi.conv, untuple.node, llargs, fn_abi.args.slice(first_args.length), lifetime_ends_after_call);

    const needs_location = instance !== undefined && InstanceKind.requires_caller_location(instance.def, this.cx.tcx_());
    if (needs_location) {
      let mir_args: number;
      if (num_untupled !== undefined) {
        mir_args = first_args.length + num_untupled;
      } else {
        mir_args = args.length;
      }
      if (fn_abi.args.length !== mir_args + 1) {
        panic(
          `assertion \`left == right\` failed: #[track_caller] fn's must have 1 more argument in their ABI than in their MIR: ${debug_option(instance, PLAIN, debug_Instance)} ${debug_Span(fn_span, PLAIN)} ${debug_FnAbi(fn_abi, PLAIN, display_Ty)}\n  left: ${fn_abi.args.length}\n right: ${mir_args + 1}`,
        );
      }
      const location = this.get_caller_location(bx, source_info);
      // debug!(
      //     "codegen_call_terminator({:?}): location={:?} (fn_span {:?})",
      //     terminator, location, fn_span
      // );

      const last_arg = unwrap(fn_abi.args[fn_abi.args.length - 1]);
      this.codegen_argument(bx, fn_abi.conv, location, /* by_move */ false, llargs, last_arg, lifetime_ends_after_call);
    }

    let fn_ptr: V;
    if (instance !== undefined && llfn === undefined) {
      fn_ptr = bx.get_fn_addr(instance, bx.sess().pointer_authentication_functions());
    } else if (llfn !== undefined) {
      fn_ptr = llfn;
    } else {
      return span_bug(fn_span, "no instance or llfn for call");
    }
    block_xlane.set_debug_loc(this, bx, source_info);
    return helper.do_call(this, bx, fn_abi, fn_ptr, return_slot, llargs, destination, unwind, lifetime_ends_after_call, instance, kind, mergeable_succ);
  };

  // rustc: compiler/rustc_codegen_ssa/src/mir/block.rs:1491 codegen_asm_terminator
  FunctionCx_.prototype.codegen_asm_terminator = function (
    this: Fx,
    helper: TerminatorCodegenHelper,
    bx: BxT,
    asm_macro: InlineAsmMacro,
    terminator: Terminator,
    template: readonly InlineAsmTemplatePiece[],
    operands_: readonly InlineAsmOperand[],
    options: InlineAsmOptions,
    line_spans: readonly Span[],
    targets: readonly BasicBlock[],
    unwind: UnwindAction,
    instance: Instance,
    mergeable_succ: boolean,
  ): MergingSucc {
    const span = terminator.source_info.span;

    const operands: InlineAsmOperandRef<BackendTypes>[] = operands_.map((op): InlineAsmOperandRef<BackendTypes> => {
      switch (op.$) {
        case "In": {
          const { reg } = op;
          const value = this.codegen_operand(bx, op.value);
          return { $: "In", reg, value };
        }
        case "Out": {
          const { reg, late } = op;
          const place = op.place === undefined ? undefined : this.codegen_place(bx, op.place.as_ref());
          return { $: "Out", reg, late, place };
        }
        case "InOut": {
          const { reg, late } = op;
          const in_value = this.codegen_operand(bx, op.in_value);
          const out_place = op.out_place === undefined ? undefined : this.codegen_place(bx, op.out_place.as_ref());
          return { $: "InOut", reg, late, in_value, out_place };
        }
        case "Const": {
          const value = op.value;
          const const_value = block_xlane.eval_mir_constant(this, value);
          if (const_value.$ !== "Scalar") {
            return span_bug(span, `expected Scalar for promoted asm const, but got ${debug_ConstValue(const_value, PRETTY)}`);
          }
          const scalar = const_value._0;
          return { $: "Const", value: asm_const_ptr_clean(bx.tcx_(), scalar), ty: value.ty() };
        }
        case "SymFn": {
          const value = op.value;
          const const_ = this.monomorphize(value.const_, fold_Const);
          const k = mir_Const.ty(const_).kind();
          if (k.$ === "FnDef") {
            const def_id = k._0;
            const args = k._1;
            const instance_ = unwrap(Instance.resolve_for_fn_ptr(bx.tcx_(), bx.typing_env_(), def_id, unwrap(Binder.no_bound_vars(args, fold_GenericArgs))));

            return {
              $: "Const",
              value: Scalar.from_pointer(Pointer_from_AllocId(bx.tcx_().reserve_and_set_fn_alloc(instance_, CTFE_ALLOC_SALT)), bx),
              ty: Ty.new_fn_ptr(bx.tcx_(), mir_Const.ty(const_).fn_sig(bx.tcx_())),
            };
          } else {
            return span_bug(span, "invalid type for asm sym (fn)");
          }
        }
        case "SymStatic": {
          const { def_id } = op;
          if (bx.tcx_().is_thread_local_static(def_id)) {
            return { $: "SymThreadLocalStatic", def_id };
          } else {
            return {
              $: "Const",
              value: Scalar.from_pointer(Pointer_from_AllocId(bx.tcx_().reserve_and_set_static_alloc(def_id)), bx),
              ty: bx.tcx_().static_ptr_ty(def_id, bx.typing_env_()),
            };
          }
        }
        case "Label": {
          const { target_index } = op;
          return { $: "Label", label: this.llbb(targets[target_index]!) };
        }
      }
    });

    return helper.do_inlineasm(
      this,
      bx,
      template,
      operands,
      options,
      line_spans,
      InlineAsmMacro.diverges(asm_macro, options) ? undefined : targets[0],
      unwind,
      instance,
      mergeable_succ,
    );
  };

  // rustc: compiler/rustc_codegen_ssa/src/mir/block.rs:1594 codegen_block
  FunctionCx_.prototype.codegen_block = function (this: Fx, bb: BasicBlock): void {
    const llbb_ = this.try_llbb(bb);
    let llbb: unknown;
    if (llbb_ !== undefined) {
      llbb = llbb_;
    } else {
      return;
    }
    const bx = this.Bx_.build(this.cx, llbb);
    const mir = this.mir;

    // MIR basic blocks stop at any function call. This may not be the case
    // for the backend's basic blocks, in which case we might be able to
    // combine multiple MIR basic blocks into a single backend basic block.
    for (;;) {
      const data = mir.basic_blocks.deref()[bb]!;

      // debug!("codegen_block({:?}={:?})", bb, data);

      for (const statement of data.statements) {
        block_xlane.codegen_statement(this, bx, statement);
      }
      block_xlane.codegen_stmt_debuginfos(this, bx, data.after_last_stmt_debuginfos.deref());

      const merging_succ = this.codegen_terminator(bx, bb, data.terminator_());
      if (merging_succ === MergingSucc.False) {
        break;
      }

      // We are merging the successor into the produced backend basic
      // block. Record that the successor should be skipped when it is
      // reached.
      //
      // Note: we must not have already generated code for the successor.
      // This is implicitly ensured by the reverse postorder traversal,
      // and the assertion explicitly guarantees that.
      const successors = data.terminator_().successors();
      const succ = unwrap(successors.next().value);
      assert(this.cached_llbbs[succ]!.$ === "None", "assertion failed: matches!(self.cached_llbbs[succ], CachedLlbb::None)");
      this.cached_llbbs[succ] = CachedLlbb.Skip;
      bb = succ;
    }
  };

  // rustc: compiler/rustc_codegen_ssa/src/mir/block.rs:1635 codegen_block_as_unreachable
  FunctionCx_.prototype.codegen_block_as_unreachable = function (this: Fx, bb: BasicBlock): void {
    const llbb_ = this.try_llbb(bb);
    let llbb: unknown;
    if (llbb_ !== undefined) {
      llbb = llbb_;
    } else {
      return;
    }
    const bx = this.Bx_.build(this.cx, llbb);
    // debug!("codegen_block_as_unreachable({:?})", bb);
    bx.unreachable();
  };

  // rustc: compiler/rustc_codegen_ssa/src/mir/block.rs:1645 codegen_terminator
  FunctionCx_.prototype.codegen_terminator = function (this: Fx, bx: BxT, bb: BasicBlock, terminator: Terminator): MergingSucc {
    // debug!("codegen_terminator: {:?}", terminator);

    const helper = new TerminatorCodegenHelper(bb, terminator);

    const mergeable_succ = (): boolean => {
      // Note: any call to `switch_to_block` will invalidate a `true` value
      // of `mergeable_succ`.
      const successors = terminator.successors();
      const first = successors.next();
      let succ_pred: BasicBlock | undefined;
      let preds: readonly BasicBlock[];
      if (
        !first.done &&
        successors.next().done === true &&
        (preds = this.mir.basic_blocks.predecessors()[first.value]!).length === 1 &&
        ((succ_pred = preds[0]!), true)
      ) {
        // bb has a single successor, and bb is its only predecessor. This
        // makes it a candidate for merging.
        assert_eq_dbg(succ_pred, bb, (b) => debug_BasicBlock(b, PLAIN));
        return true;
      } else {
        return false;
      }
    };

    block_xlane.set_debug_loc(this, bx, terminator.source_info);
    const kind = terminator.kind;
    switch (kind.$) {
      case "UnwindResume":
        this.codegen_resume_terminator(helper, bx);
        return MergingSucc.False;

      case "UnwindTerminate":
        this.codegen_terminate_terminator(helper, bx, terminator, kind._0);
        return MergingSucc.False;

      case "Goto":
        return helper.funclet_br(this, bx, kind.target, mergeable_succ(), kind.loop_hint_attrs);

      case "SwitchInt":
        this.codegen_switchint_terminator(helper, bx, kind.discr, kind.targets);
        return MergingSucc.False;

      case "Return":
        this.codegen_return_terminator(bx);
        return MergingSucc.False;

      case "Unreachable":
        bx.unreachable();
        return MergingSucc.False;

      case "Drop": {
        const { place, target, unwind, drop } = kind;
        assert(drop === undefined, "Async Drop must be expanded or reset to sync before codegen");
        return this.codegen_drop_terminator(helper, bx, terminator.source_info, place, target, unwind, mergeable_succ());
      }

      case "Assert": {
        const { cond, expected, msg, target, unwind } = kind;
        return this.codegen_assert_terminator(helper, bx, terminator, cond, expected, msg, target, unwind, mergeable_succ());
      }

      case "Call": {
        const { func, args, destination, target, unwind, fn_span } = kind;
        return this.codegen_call_terminator(helper, bx, terminator, func, args, destination, target, unwind, fn_span, CallKind.Normal, mergeable_succ());
      }
      case "TailCall": {
        const { func, args, fn_span } = kind;
        return this.codegen_call_terminator(
          helper,
          bx,
          terminator,
          func,
          args,
          Place_from_Local(RETURN_PLACE),
          undefined,
          UnwindAction.Unreachable,
          fn_span,
          CallKind.Tail,
          mergeable_succ(),
        );
      }
      case "CoroutineDrop":
      case "Yield":
        return bug("coroutine ops in codegen");
      case "FalseEdge":
      case "FalseUnwind":
        return bug("borrowck false edges in codegen");

      case "InlineAsm": {
        const { asm_macro, template, operands, options, line_spans, targets, unwind } = kind;
        return this.codegen_asm_terminator(
          helper,
          bx,
          asm_macro,
          terminator,
          template,
          operands,
          options,
          line_spans,
          targets,
          unwind,
          this.instance,
          mergeable_succ(),
        );
      }
    }
  };

  /// When using CMSE, values that cross the secure boundary from secure to non-secure mode can
  /// contain stale secure data in their padding bytes. This function clears that data. This is
  /// required when a value is:
  ///
  /// - passed to an `extern "cmse-nonsecure-call"` function
  /// - returned from an `extern "cmse-nonsecure-entry"` function
  ///
  /// This function clears both:
  ///
  /// - variant-independent padding, bytes that are padding for all valid values of the type
  /// - variant-dependent padding, bytes that are padding for some but not all values of the type
  ///
  /// Clearing variant-dependent padding requires looking at the data at runtime to determine what
  /// bytes to clear.
  // rustc: compiler/rustc_codegen_ssa/src/mir/block.rs:1813 clear_padding_cmse
  FunctionCx_.prototype.clear_padding_cmse = function (this: Fx, bx: BxT, base_ptr: V, limit: Size, layout: TyAndLayout): void {
    // First clear variant-independent padding, a series of memsets.
    const variant_independent = layout.variant_independent_padding_ranges(this.cx);
    this.zero_byte_ranges(bx, base_ptr, Size.ZERO, limit, variant_independent);

    // Then clear the extra padding of the active variant of any (nested) enum.
    this.clear_variant_dependent_padding(bx, base_ptr, Size.ZERO, limit, layout);
  };

  // rustc: compiler/rustc_codegen_ssa/src/mir/block.rs:1828 clear_variant_dependent_padding
  FunctionCx_.prototype.clear_variant_dependent_padding = function (
    this: Fx,
    bx: BxT,
    base_ptr: V,
    base_offset: Size,
    limit: Size,
    layout: TyAndLayout,
  ): void {
    const cx = this.cx;

    if (!layout.has_variant_dependent_padding(cx)) {
      return;
    }

    // Recurse into aggregate fields/elements to reach any nested enums.
    const fields = layout.fields;
    switch (fields.$) {
      case "Array": {
        const { stride, count } = fields;
        const elem = layout.field(cx, 0);
        if (elem.has_variant_dependent_padding(cx)) {
          for (let idx = 0n; idx < count; idx++) {
            const off = base_offset.add(Size.u64_mul(idx, stride));
            this.clear_variant_dependent_padding(bx, base_ptr, off, limit, elem);
          }
        }
        break;
      }
      case "Arbitrary":
        for (let i = 0; i < FieldsShape.count(layout.fields); i++) {
          const field = layout.field(cx, i);
          if (field.has_variant_dependent_padding(cx)) {
            const off = base_offset.add(FieldsShape.offset(layout.fields, i));
            this.clear_variant_dependent_padding(bx, base_ptr, off, limit, field);
          }
        }
        break;
      case "Primitive":
      case "Union":
        /* nothing to visit */
        break;
    }

    // If this is not a multi-variant enum, we're done.
    const layout_variants = layout.variants;
    if (layout_variants.$ !== "Multiple") {
      return;
    }
    const variants = layout_variants.variants;

    // Collect variants that will need padding cleared.
    const work: [VariantIdx, TyAndLayout, { start: Size; end: Size }[]][] = [];
    for (let i = 0; i < variants.length; i++) {
      const idx = VariantIdx.from_usize(i);
      const variant = layout.for_variant(cx, idx);

      // Don't consider uninhabited variants.
      if (variant.is_uninhabited()) {
        continue;
      }

      const variant_dependent = layout.variant_dependent_padding_ranges(cx, idx);
      let has_nested_variant_dependent = false;
      for (let i = 0; i < FieldsShape.count(variant.fields); i++) {
        if (variant.field(cx, i).has_variant_dependent_padding(cx)) {
          has_nested_variant_dependent = true;
          break;
        }
      }

      if (!(variant_dependent.length === 0) || has_nested_variant_dependent) {
        work.push([idx, variant, variant_dependent]);
      }
    }

    if (work.length === 0) {
      return;
    }

    // Build the switch and clear the appropriate padding for each variant.
    const root_block = bx.llbb();
    const join_block = bx.append_sibling_block("cmse_pad_join");
    const cases: (readonly [bigint, V])[] = [];

    for (const [idx, variant, variant_dependent] of work) {
      const discr = layout.ty.discriminant_for_variant(bx.tcx_(), idx);
      if (discr === undefined) {
        bug("multi-variant layout on a type without discriminants");
      }

      const variant_block = bx.append_sibling_block("cmse_pad_variant");
      bx.switch_to_block(variant_block);

      // Clear the padding of this variant.
      this.zero_byte_ranges(bx, base_ptr, base_offset, limit, variant_dependent);

      // Recurse into the fields.
      for (let i = 0; i < FieldsShape.count(variant.fields); i++) {
        const field = variant.field(cx, i);
        const off = base_offset.add(FieldsShape.offset(variant.fields, i));
        this.clear_variant_dependent_padding(bx, base_ptr, off, limit, field);
      }

      bx.br(join_block);
      cases.push([discr.val, variant_block]);
    }

    // Construct the dispatch.
    bx.switch_to_block(root_block);

    const discr_ty = layout.ty.discriminant_ty(bx.tcx_());
    const enum_ptr = bx.inbounds_ptradd(base_ptr, bx.const_usize(base_offset.bytes_u64()));
    const operand = new OperandRef<V>({ $: "Ref", _0: PlaceValue.new_sized(enum_ptr, layout.align.abi) }, layout, undefined);
    const discr = operand.codegen_get_discr(this, bx, discr_ty);

    // Default to the join block (for variants without variant-dependent padding).
    bx.switch(discr, join_block, cases);

    bx.switch_to_block(join_block);
  };

  // rustc: compiler/rustc_codegen_ssa/src/mir/block.rs:1939 zero_byte_ranges
  FunctionCx_.prototype.zero_byte_ranges = function (
    this: Fx,
    bx: BxT,
    ptr: V,
    offset: Size,
    limit: Size,
    ranges: readonly { readonly start: Size; readonly end: Size }[],
  ): void {
    const zero = bx.const_u8(0);

    for (const range of ranges) {
      const start = range.start.add(offset);
      const end_ = range.end.add(offset);

      const end = Ord_min_Size(end_, limit);
      if (Size_cmp(range.start, end) >= 0) {
        continue;
      }
      const offset_ = bx.const_usize(start.bytes_u64());
      const len = bx.const_usize(end.sub(start).bytes_u64());
      const ptr_ = bx.inbounds_ptradd(ptr, offset_);
      bx.memset(ptr_, zero, len, Align.ONE, MemFlags.empty());
    }
  };

  // rustc: compiler/rustc_codegen_ssa/src/mir/block.rs:1964 codegen_argument
  FunctionCx_.prototype.codegen_argument = function (
    this: Fx,
    bx: BxT,
    conv: CanonAbi,
    op: OperandRef<V>,
    by_move: boolean,
    llargs: V[],
    arg: ArgAbi<Ty>,
    lifetime_ends_after_call: (readonly [V, Size])[],
  ): void {
    const mode = arg.mode;
    switch (mode.$) {
      case "Ignore":
        return;
      case "Cast": {
        // Fill padding with undef value, where applicable.
        const undef = bx.const_undef(bx.reg_backend_type(Reg.i32()));
        for (let k = 0; k < mode.pad_i32_count; k++) llargs.push(undef);
        break;
      }
      case "Pair": {
        const val = op.val;
        if (val.$ === "Pair") {
          llargs.push(val._0);
          llargs.push(val._1);
          return;
        }
        return bug(`codegen_argument: ${debug_OperandRef(op, PLAIN, bx.debug_Value)} invalid for pair argument`);
      }
      case "IndirectUnsized": {
        const val = op.val;
        if (val.$ === "Ref" && val._0.llextra !== undefined) {
          llargs.push(val._0.llval);
          llargs.push(val._0.llextra);
          return;
        }
        return bug(`codegen_argument: ${debug_OperandRef(op, PLAIN, bx.debug_Value)} invalid for unsized indirect argument`);
      }
      default:
        break;
    }

    // Force by-ref if we have to load through a cast pointer.
    let llval: V;
    let align: Align;
    let by_ref: boolean;
    const val = op.val;
    switch (val.$) {
      case "Immediate":
      case "Pair":
        // PORT: `as` widens `mode` back to every variant, so the `unreachable!` arm stays (the narrowing above already
        // excludes it).
        switch ((mode as PassMode).$) {
          case "Indirect": {
            const attrs = (mode as PassMode & { $: "Indirect" }).attrs;
            // Indirect argument may have higher alignment requirements than the type's
            // alignment. This can happen, e.g. when passing types with <4 byte alignment
            // on the stack on x86.
            const required_align = attrs.pointee_align !== undefined ? Align_max(attrs.pointee_align, arg.layout.align.abi) : arg.layout.align.abi;
            const scratch = PlaceValue.alloca(bx, arg.layout.size, required_align);
            bx.lifetime_start(scratch.llval, arg.layout.size);
            op.store_with_annotation(bx, scratch.with_type(arg.layout, bx.debug_Value));
            lifetime_ends_after_call.push([scratch.llval, arg.layout.size]);
            [llval, align, by_ref] = [scratch.llval, scratch.align, true];
            break;
          }
          case "Cast": {
            const scratch = PlaceRef.alloca(bx, arg.layout);
            op.store_with_annotation(bx, scratch);
            [llval, align, by_ref] = [scratch.val.llval, scratch.val.align, true];
            break;
          }
          case "Direct":
            [llval, align, by_ref] = [op.immediate(bx.debug_Value), arg.layout.align.abi, false];
            break;
          case "Ignore":
          case "Pair":
          case "IndirectUnsized":
            return unreachable("internal error: entered unreachable code: handled above");
        }
        break;
      case "Ref": {
        const op_place_val = val._0;
        switch ((mode as PassMode).$) {
          case "Indirect": {
            const { attrs, mode: imode } = mode as PassMode & { $: "Indirect" };
            if (imode === "AmdgpuKernelArg") {
              return bug(
                `${debug_OperandRef(op, PLAIN, bx.debug_Value)} passed as amdgpu kernel argument with abi ${debug_ArgAbi(arg, PLAIN, display_Ty)}`,
              );
            }
            // For `foo(packed.large_field)`, and types with <4 byte alignment on x86,
            // alignment requirements may be higher than the type's alignment, so copy
            // to a higher-aligned alloca.
            const required_align = attrs.pointee_align !== undefined ? Align_max(attrs.pointee_align, arg.layout.align.abi) : arg.layout.align.abi;
            // Copy to an alloca when the argument is neither by-val nor by-move.
            if (op_place_val.align.pow2 < required_align.pow2 || (imode === "Pointer" && !by_move)) {
              const scratch = PlaceValue.alloca(bx, arg.layout.size, required_align);
              bx.lifetime_start(scratch.llval, arg.layout.size);
              op.store_with_annotation(bx, scratch.with_type(arg.layout, bx.debug_Value));
              lifetime_ends_after_call.push([scratch.llval, arg.layout.size]);
              [llval, align, by_ref] = [scratch.llval, scratch.align, true];
            } else {
              [llval, align, by_ref] = [op_place_val.llval, op_place_val.align, true];
            }
            break;
          }
          case "IndirectUnsized":
            return unreachable("internal error: entered unreachable code: handled above");
          default:
            [llval, align, by_ref] = [op_place_val.llval, op_place_val.align, true];
            break;
        }
        break;
      }
      case "ZeroSized":
        switch (mode.$) {
          case "Indirect": {
            const imode = mode.mode;
            if (imode === "AmdgpuKernelArg") {
              return bug(
                `${debug_OperandRef(op, PLAIN, bx.debug_Value)} passed as amdgpu kernel argument with abi ${debug_ArgAbi(arg, PLAIN, display_Ty)}`,
              );
            }
            if (imode === "OnStack") {
              // It doesn't seem like any target can have `byval` ZSTs, so this assert
              // is here to replace a would-be untested codepath.
              return bug(`ZST ${debug_OperandRef(op, PLAIN, bx.debug_Value)} passed on stack with abi ${debug_ArgAbi(arg, PLAIN, display_Ty)}`);
            }
            // Though `extern "Rust"` doesn't pass ZSTs, some ABIs pass
            // a pointer for `repr(C)` structs even when empty, so get
            // one from an `alloca` (which can be left uninitialized).
            const scratch = PlaceRef.alloca(bx, arg.layout);
            [llval, align, by_ref] = [scratch.val.llval, scratch.val.align, true];
            break;
          }
          default:
            return bug(`ZST ${debug_OperandRef(op, PLAIN, bx.debug_Value)} wasn't ignored, but was passed with abi ${debug_ArgAbi(arg, PLAIN, display_Ty)}`);
        }
        break;
    }

    if (by_ref && !arg.is_indirect()) {
      // Have to load the argument, maybe while casting it.
      if (mode.$ === "Cast") {
        const cast = mode.cast;
        // The ABI mandates that the value is passed as a different struct representation.
        // Spill and reload it from the stack to convert from the Rust representation to
        // the ABI representation.
        const scratch_size = cast.size(bx);
        const scratch_align = cast.align(bx);
        // Note that the ABI type may be either larger or smaller than the Rust type,
        // due to the presence or absence of trailing padding. For example:
        // - On some ABIs, the Rust layout { f64, f32, <f32 padding> } may omit padding
        //   when passed by value, making it smaller.
        // - On some ABIs, the Rust layout { u16, u16, u16 } may be padded up to 8 bytes
        //   when passed by value, making it larger.
        const a_ = cast.unaligned_size(bx).bytes_u64();
        const b_ = arg.layout.size.bytes_u64();
        const copy_bytes = a_ <= b_ ? a_ : b_;
        // Allocate some scratch space...
        const llscratch = bx.alloca(scratch_size, scratch_align);
        bx.lifetime_start(llscratch, scratch_size);
        // ...memcpy the value...
        bx.memcpy(llscratch, scratch_align, llval, align, bx.const_usize(copy_bytes), MemFlags.empty(), undefined);

        // The arguments of an `extern "cmse-nonsecure-call"` function cross the secure
        // boundary. Clear any padding bytes so information does not leak.
        if (canon_abi_is_arm(conv, "CCmseNonSecureCall")) {
          this.clear_padding_cmse(bx, llscratch, Size.from_bytes(copy_bytes), arg.layout);
        }

        // ...and then load it with the ABI type.
        llval = load_cast(bx, cast, llscratch, scratch_align);
        bx.lifetime_end(llscratch, scratch_size);
      } else {
        // We can't use `PlaceRef::load` here because the argument
        // may have a type we don't treat as immediate, but the ABI
        // used for this call is passing it by-value. In that case,
        // the load would just produce `OperandValue::Ref` instead
        // of the `OperandValue::Immediate` we need for the call.
        llval = bx.load(bx.backend_type(arg.layout), llval, align);
        const repr = arg.layout.backend_repr;
        if (repr.$ === "Scalar") {
          const scalar = repr._0;
          if (abi_Scalar.is_bool(scalar)) {
            bx.range_metadata(llval, new WrappingRange(0n, 1n));
          }
          // We store bools as `i8` so we need to truncate to `i1`.
          llval = bx.to_immediate_scalar(llval, scalar);
        }
      }
    }

    llargs.push(llval);
  };

  // rustc: compiler/rustc_codegen_ssa/src/mir/block.rs:2138 codegen_arguments_untupled
  FunctionCx_.prototype.codegen_arguments_untupled = function (
    this: Fx,
    bx: BxT,
    conv: CanonAbi,
    operand: Operand,
    llargs: V[],
    args: readonly ArgAbi<Ty>[],
    lifetime_ends_after_call: (readonly [V, Size])[],
  ): number {
    const tuple = this.codegen_operand(bx, operand);
    const by_move = operand.$ === "Move";

    // Handle both by-ref and immediate tuples.
    if (tuple.val.$ === "Ref") {
      const place_val = tuple.val._0;
      if (place_val.llextra !== undefined) {
        bug("closure arguments must be sized");
      }
      const tuple_ptr = place_val.with_type(tuple.layout, bx.debug_Value);
      for (let i = 0; i < FieldsShape.count(tuple.layout.fields); i++) {
        const field_ptr = tuple_ptr.project_field(bx, i);
        const field = bx.load_operand(field_ptr);
        this.codegen_argument(bx, conv, field, by_move, llargs, args[i]!, lifetime_ends_after_call);
      }
    } else {
      // If the tuple is immediate, the elements are as well.
      for (let i = 0; i < FieldsShape.count(tuple.layout.fields); i++) {
        const op = tuple.extract_field(this, bx, i);
        this.codegen_argument(bx, conv, op, by_move, llargs, args[i]!, lifetime_ends_after_call);
      }
    }
    return FieldsShape.count(tuple.layout.fields);
  };

  // rustc: compiler/rustc_codegen_ssa/src/mir/block.rs:2187 get_caller_location
  FunctionCx_.prototype.get_caller_location = function (this: Fx, bx: BxT, source_info: SourceInfo): OperandRef<V> {
    return this.mir.caller_location_span(source_info, this.caller_location, bx.tcx_(), (span: Span) => {
      const const_loc = bx.tcx_().span_as_caller_location(span);
      return OperandRef.from_const(bx, const_loc, bx.tcx_().caller_location_ty());
    });
  };

  // rustc: compiler/rustc_codegen_ssa/src/mir/block.rs:2198 get_personality_slot
  FunctionCx_.prototype.get_personality_slot = function (this: Fx, bx: BxT): PlaceRef<V> {
    const cx = bx.cx();
    const slot_ = this.personality_slot;
    if (slot_ !== undefined) {
      return slot_;
    } else {
      const layout = cx.layout_of(Ty.new_tup(cx.tcx_(), [Ty.new_mut_ptr(cx.tcx_(), cx.tcx_().types.u8), cx.tcx_().types.i32]));
      const slot = PlaceRef.alloca(bx, layout);
      this.personality_slot = slot;
      return slot;
    }
  };

  /// Returns the landing/cleanup pad wrapper around the given basic block.
  // FIXME(eddyb) rename this to `eh_pad_for`.
  // rustc: compiler/rustc_codegen_ssa/src/mir/block.rs:2215 landing_pad_for
  FunctionCx_.prototype.landing_pad_for = function (this: Fx, bb: BasicBlock): unknown {
    const landing_pad_ = this.landing_pads[bb];
    if (landing_pad_ !== undefined) {
      return landing_pad_;
    }

    const landing_pad = this.landing_pad_for_uncached(bb);
    this.landing_pads[bb] = landing_pad;
    return landing_pad;
  };

  // FIXME(eddyb) rename this to `eh_pad_for_uncached`.
  // rustc: compiler/rustc_codegen_ssa/src/mir/block.rs:2226 landing_pad_for_uncached
  FunctionCx_.prototype.landing_pad_for_uncached = function (this: Fx, bb: BasicBlock): unknown {
    const llbb = this.llbb(bb);
    if (xlane.wants_new_eh_instructions(this.cx.sess().target)) {
      const cleanup_bb = this.Bx_.append_block(this.cx, this.llfn, `funclet_${debug_BasicBlock(bb, PLAIN)}`);
      const cleanup_bx = this.Bx_.build(this.cx, cleanup_bb);
      const funclet = cleanup_bx.cleanup_pad(undefined, []);
      cleanup_bx.br(llbb);
      this.funclets[bb] = funclet;
      return cleanup_bb;
    } else {
      const cleanup_llbb = this.Bx_.append_block(this.cx, this.llfn, "cleanup");
      const cleanup_bx = this.Bx_.build(this.cx, cleanup_llbb);

      const llpersonality = this.cx.eh_personality();
      const [exn0, exn1] = cleanup_bx.cleanup_landing_pad(llpersonality);

      const slot = this.get_personality_slot(cleanup_bx);
      slot.storage_live(cleanup_bx);
      OperandValue.store({ $: "Pair", _0: exn0, _1: exn1 }, cleanup_bx, slot);

      cleanup_bx.br(llbb);
      return cleanup_llbb;
    }
  };

  // rustc: compiler/rustc_codegen_ssa/src/mir/block.rs:2251 unreachable_block
  FunctionCx_.prototype.unreachable_block_ = function (this: Fx): unknown {
    const cached = this.unreachable_block;
    if (cached !== undefined) return cached;
    const llbb = this.Bx_.append_block(this.cx, this.llfn, "unreachable");
    const bx = this.Bx_.build(this.cx, llbb);
    bx.unreachable();
    this.unreachable_block = llbb;
    return llbb;
  };

  // rustc: compiler/rustc_codegen_ssa/src/mir/block.rs:2261 terminate_block
  FunctionCx_.prototype.terminate_block = function (this: Fx, reason: UnwindTerminateReason, outer_catchpad_bb: BasicBlock | undefined): unknown {
    // mb_funclet_bb should be present if and only if the target is wasm and
    // we're terminating because of an unwind in a cleanup block. In that
    // case we have nested funclets and the inner catch_switch needs to know
    // what outer catch_pad it is contained in.
    // debug_assert!(
    //     outer_catchpad_bb.is_some()
    //         == (base::wants_wasm_eh(&self.cx.tcx().sess.target)
    //             && reason == UnwindTerminateReason::InCleanup)
    // );

    // When we aren't in a wasm InCleanup block, there's only one terminate
    // block needed so we cache at START_BLOCK index.
    let cache_bb: BasicBlock = START_BLOCK;
    // In wasm eh InCleanup, use the outer funclet's cleanup BB as the cache
    // key.
    if (outer_catchpad_bb !== undefined) {
      const outer_bb = outer_catchpad_bb;
      const cleanup_kinds = unwrap(this.cleanup_kinds, "cleanup_kinds required for funclets");
      cache_bb = unwrap(CleanupKind.funclet_bb(cleanup_kinds[outer_bb]!, outer_bb), "funclet_bb should be in a funclet");

      // Ensure the outer funclet is created first
      if (this.funclets[cache_bb] === undefined) {
        this.landing_pad_for(cache_bb);
      }
    }
    const cached = this.terminate_blocks[cache_bb];
    if (cached !== undefined && reason === cached[1]) {
      return cached[0];
    }

    let funclet: unknown;
    let llbb: unknown;
    let bx: BxT;
    if (xlane.wants_new_eh_instructions(this.cx.sess().target)) {
      // This is a basic block that we're aborting the program for,
      // notably in an `extern` function. These basic blocks are inserted
      // so that we assert that `extern` functions do indeed not panic,
      // and if they do we abort the process.
      //
      // On MSVC these are tricky though (where we're doing funclets). If
      // we were to do a cleanuppad (like below) the normal functions like
      // `longjmp` would trigger the abort logic, terminating the
      // program. Instead we insert the equivalent of `catch(...)` for C++
      // which magically doesn't trigger when `longjmp` files over this
      // frame.
      //
      // Lots more discussion can be found on #48251 but this codegen is
      // modeled after clang's for:
      //
      //      try {
      //          foo();
      //      } catch (...) {
      //          bar();
      //      }
      //
      // which creates an IR snippet like
      //
      //      cs_terminate:
      //         %cs = catchswitch within none [%cp_terminate] unwind to caller
      //      cp_terminate:
      //         %cp = catchpad within %cs [null, i32 64, null]
      //         ...
      //
      // By contrast, on WebAssembly targets, we specifically _do_ want to
      // catch foreign exceptions. The situation with MSVC is a
      // regrettable hack which we don't want to extend to other targets
      // unless necessary. For WebAssembly, to generate catch(...) and
      // catch only C++ exception instead of generating a catch_all, we
      // need to call the intrinsics @llvm.wasm.get.exception and
      // @llvm.wasm.get.ehselector in the catch pad. Since we don't do
      // this, we generate a catch_all. We originally got this behavior
      // by accident but it luckily matches our intention.

      llbb = this.Bx_.append_block(this.cx, this.llfn, "cs_terminate");

      const cs_bx = this.Bx_.build(this.cx, llbb);

      // For wasm InCleanup blocks, our catch_switch is nested within the
      // outer catchpad, so we need to provide it as the parent value to
      // catch_switch.
      let outer_cleanuppad: unknown;
      if (outer_catchpad_bb !== undefined) {
        // Get the outer funclet's catchpad
        const outer_funclet = unwrap(this.funclets[cache_bb], "landing_pad_for didn't create funclet");
        outer_cleanuppad = cs_bx.get_funclet_cleanuppad(outer_funclet);
      }
      const cp_llbb = this.Bx_.append_block(this.cx, this.llfn, "cp_terminate");
      const cs = cs_bx.catch_switch(outer_cleanuppad, undefined, [cp_llbb]);
      // drop(cs_bx);
      // PORT: the backend's `Drop` of the builder is not part of `BuilderMethods` (ssa-mir-core PORT 5).

      bx = this.Bx_.build(this.cx, cp_llbb);
      const null_ = bx.const_null(bx.type_ptr_ext(bx.cx().data_layout().instruction_address_space));

      // The `null` in first argument here is actually a RTTI type
      // descriptor for the C++ personality function, but `catch (...)`
      // has no type so it's null.
      let args: readonly unknown[];
      if (block_xlane.wants_msvc_seh(this.cx.sess().target)) {
        // This bitmask is a single `HT_IsStdDotDot` flag, which
        // represents that this is a C++-style `catch (...)` block that
        // only captures programmatic exceptions, not all SEH
        // exceptions. The second `null` points to a non-existent
        // `alloca` instruction, which an LLVM pass would inline into
        // the initial SEH frame allocation.
        const adjectives = bx.const_i32(0x40);
        args = [null_, adjectives, null_];
      } else {
        // Specifying more arguments than necessary usually doesn't
        // hurt, but the `WasmEHPrepare` LLVM pass does not recognize
        // anything other than a single `null` as a `catch_all` block,
        // leading to problems down the line during instruction
        // selection.
        args = [null_];
      }

      funclet = bx.catch_pad(cs, args);
      // On wasm, if we wanted to generate a catch(...) and only catch C++
      // exceptions, we'd call @llvm.wasm.get.exception and
      // @llvm.wasm.get.ehselector selectors here. We want a catch_all so
      // we leave them out. This is intentionally diverging from the MSVC
      // behavior.
    } else {
      llbb = this.Bx_.append_block(this.cx, this.llfn, "terminate");
      bx = this.Bx_.build(this.cx, llbb);

      const llpersonality = this.cx.eh_personality();
      bx.filter_landing_pad(llpersonality);

      funclet = undefined;
    }

    block_xlane.set_debug_loc(this, bx, SourceInfo.outermost(this.mir.span));

    const [fn_abi, fn_ptr, instance] = build_langcall(bx, this.mir.span, UnwindTerminateReason.lang_item(reason));
    if (block_xlane.is_call_from_compiler_builtins_to_upstream_monomorphization(bx.tcx_(), instance)) {
      bx.abort_immediate();
    } else {
      const fn_ty = bx.fn_decl_backend_type(fn_abi);

      const llret = bx.call(fn_ty, undefined, fn_abi, fn_ptr, ReturnSlot.Direct, [], funclet, undefined);
      bx.apply_attrs_to_cleanup_callsite(llret);
    }

    bx.unreachable();

    this.terminate_blocks[cache_bb] = [llbb, reason];
    return llbb;
  };

  /// Get the backend `BasicBlock` for a MIR `BasicBlock`, either already
  /// cached in `self.cached_llbbs`, or created on demand (and cached).
  // FIXME(eddyb) rename `llbb` and other `ll`-prefixed things to use a
  // more backend-agnostic prefix such as `cg` (i.e. this would be `cgbb`).
  // rustc: compiler/rustc_codegen_ssa/src/mir/block.rs:2434 llbb
  FunctionCx_.prototype.llbb = function (this: Fx, bb: BasicBlock): unknown {
    return unwrap(this.try_llbb(bb));
  };

  /// Like `llbb`, but may fail if the basic block should be skipped.
  // rustc: compiler/rustc_codegen_ssa/src/mir/block.rs:2439 try_llbb
  FunctionCx_.prototype.try_llbb = function (this: Fx, bb: BasicBlock): unknown {
    const cached = this.cached_llbbs[bb]!;
    switch (cached.$) {
      case "None": {
        const llbb = this.Bx_.append_block(this.cx, this.llfn, debug_BasicBlock(bb, PLAIN));
        this.cached_llbbs[bb] = { $: "Some", _0: llbb };
        return llbb;
      }
      case "Some":
        return cached._0;
      case "Skip":
        return undefined;
    }
  };

  // rustc: compiler/rustc_codegen_ssa/src/mir/block.rs:2451 make_return_dest
  FunctionCx_.prototype.make_return_dest = function (this: Fx, bx: BxT, dest_: mir_Place, fn_ret: ArgAbi<Ty>): [ReturnDest<V>, ReturnSlot<V>] {
    // If the return is ignored, we can just return a do-nothing `ReturnDest`.
    if (fn_ret.is_ignore()) {
      return [ReturnDest.Nothing, ReturnSlot.Direct];
    }
    let dest: PlaceRef<V>;
    const index = dest_.as_local();
    if (index !== undefined) {
      const local_ref = this.locals.index(index);
      switch (local_ref.$) {
        case "Place":
          dest = local_ref._0;
          break;
        case "UnsizedPlace":
          return bug("return type must be sized");
        case "PendingOperand":
          // Handle temporary places, specifically `Operand` ones, as
          // they don't have `alloca`s.
          if (fn_ret.is_indirect()) {
            // Odd, but possible, case, we have an operand temporary,
            // but the calling convention has an indirect return.
            const tmp = PlaceRef.alloca(bx, fn_ret.layout);
            tmp.storage_live(bx);
            return [{ $: "IndirectOperand", _0: tmp, _1: index }, { $: "Indirect", _0: tmp.val.llval }];
          } else {
            return [{ $: "DirectOperand", _0: index }, ReturnSlot.Direct];
          }
        case "Operand":
          return bug("place local already assigned to");
      }
    } else {
      dest = this.codegen_place(bx, dest_.as_ref());
    }
    if (fn_ret.is_indirect()) {
      if (dest.val.align.pow2 < dest.layout.align.abi.pow2) {
        // Currently, MIR code generation does not create calls
        // that store directly to fields of packed structs (in
        // fact, the calls it creates write only to temps).
        //
        // If someone changes that, please update this code path
        // to create a temporary.
        return span_bug(this.mir.span, "can't directly store to unaligned value");
      }
      return [ReturnDest.Nothing, { $: "Indirect", _0: dest.val.llval }];
    } else {
      return [{ $: "Store", _0: dest }, ReturnSlot.Direct];
    }
  };

  // Stores the return value of a function call into it's final location.
  // rustc: compiler/rustc_codegen_ssa/src/mir/block.rs:2505 store_return
  FunctionCx_.prototype.store_return = function (this: Fx, bx: BxT, dest: ReturnDest<V>, ret_abi: ArgAbi<Ty>, llval: V): void {
    // use self::ReturnDest::*;
    const retags_enabled = bx.tcx_().sess.opts.unstable_opts.codegen_emit_retag !== undefined;
    switch (dest.$) {
      case "Nothing":
        break;
      case "Store": {
        const dst = dest._0;
        bx.store_arg(ret_abi, llval, dst);
        if (retags_enabled) {
          xlane.codegen_retag_place(this, bx, dst, false);
        }
        break;
      }
      case "IndirectOperand": {
        const tmp = dest._0;
        const index = dest._1;
        let op = bx.load_operand(tmp);
        tmp.storage_dead(bx);
        if (retags_enabled) {
          op = xlane.codegen_retag_operand(this, bx, op, false);
        }
        this.overwrite_local(index, { $: "Operand", _0: op });
        block_xlane.debug_introduce_local(this, bx, index);
        break;
      }
      case "DirectOperand": {
        const index = dest._0;
        // If there is a cast, we have to store and reload.
        let op: OperandRef<V>;
        if (ret_abi.mode.$ === "Cast") {
          const tmp = PlaceRef.alloca(bx, ret_abi.layout);
          tmp.storage_live(bx);
          bx.store_arg(ret_abi, llval, tmp);
          const op_ = bx.load_operand(tmp);
          tmp.storage_dead(bx);
          op = op_;
        } else {
          op = OperandRef.from_immediate_or_packed_pair(bx, llval, ret_abi.layout);
        }
        if (retags_enabled) {
          op = xlane.codegen_retag_operand(this, bx, op, false);
        }
        this.overwrite_local(index, { $: "Operand", _0: op });
        block_xlane.debug_introduce_local(this, bx, index);
        break;
      }
    }
  };
}

export type ReturnDest<V> =
  /// Do nothing; the return value is indirect or ignored.
  | { readonly $: "Nothing" }
  /// Store the return value to the pointer.
  | { readonly $: "Store"; readonly _0: PlaceRef<V> }
  /// Store an indirect return value to an operand local place.
  | { readonly $: "IndirectOperand"; readonly _0: PlaceRef<V>; readonly _1: Local }
  /// Store a direct return value to an operand local place.
  | { readonly $: "DirectOperand"; readonly _0: Local };
export const ReturnDest = {
  /** Shared frozen singleton of the unit variant. */
  Nothing: Object.freeze({ $: "Nothing" }) as { readonly $: "Nothing" },
} as const;

// rustc: compiler/rustc_codegen_ssa/src/mir/block.rs:2564 load_cast
function load_cast<B extends BackendTypes>(bx: BuilderMethods<B>, cast: CastTarget, ptr: B["Value"], align: Align): B["Value"] {
  const cast_ty = bx.cast_backend_type(cast);
  const offset_from_start = cast.rest_offset;
  if (offset_from_start !== undefined) {
    assert_eq_dbg(cast.prefix.length, 1, String);
    assert_eq_dbg(cast.rest.unit.size, cast.rest.total, (v) => debug_Size(v, PLAIN), Size_eq);
    const first_ty = bx.reg_backend_type(cast.prefix[0]!);
    const second_ty = bx.reg_backend_type(cast.rest.unit);
    const first = bx.load(first_ty, ptr, align);
    const second_ptr = bx.inbounds_ptradd(ptr, bx.const_usize(offset_from_start.bytes_u64()));
    const second = bx.load(second_ty, second_ptr, align.restrict_for_offset(offset_from_start));
    const res_ = bx.cx().const_poison(cast_ty);
    const res = bx.insert_value(res_, first, 0);
    return bx.insert_value(res, second, 1);
  } else {
    return bx.load(cast_ty, ptr, align);
  }
}

// rustc: compiler/rustc_codegen_ssa/src/mir/block.rs:2587 store_cast
export function store_cast<B extends BackendTypes>(bx: BuilderMethods<B>, cast: CastTarget, value: B["Value"], ptr: B["Value"], align: Align): void {
  const offset_from_start = cast.rest_offset;
  if (offset_from_start !== undefined) {
    assert_eq_dbg(cast.prefix.length, 1, String);
    assert_eq_dbg(cast.rest.unit.size, cast.rest.total, (v) => debug_Size(v, PLAIN), Size_eq);
    const first = bx.extract_value(value, 0);
    const second = bx.extract_value(value, 1);
    bx.store(first, ptr, align);
    const second_ptr = bx.inbounds_ptradd(ptr, bx.const_usize(offset_from_start.bytes_u64()));
    bx.store(second, second_ptr, align.restrict_for_offset(offset_from_start));
  } else {
    bx.store(value, ptr, align);
  }
}

// ---- Local helpers (not upstream fns) --------------------------------------------------------------------------------

/** `iter.next().unwrap()` on a `SwitchTargetsIter`. */
function unwrap_next(it: Iterator<[bigint, BasicBlock]>): [bigint, BasicBlock] {
  const r = it.next();
  if (r.done === true) return unwrap<[bigint, BasicBlock]>(undefined);
  return r.value;
}

/** `assert_eq!(left, right)` with core's text. */
function assert_eq_dbg<T>(left: T, right: T, debug: (v: T) => string, eq: (a: T, b: T) => boolean = (a, b) => a === b): void {
  if (!eq(left, right)) panic(`assertion \`left == right\` failed\n  left: ${debug(left)}\n right: ${debug(right)}`);
}

/** `assert_eq!(left, right, "msg")` with core's text (`assert_failed_inner` with args). */
function assert_eq_msg<T>(left: T, right: T, debug: (v: T) => string, eq: (a: T, b: T) => boolean, msg: string): void {
  if (!eq(left, right)) panic(`assertion \`left == right\` failed: ${msg}\n  left: ${debug(left)}\n right: ${debug(right)}`);
}

/** `Ord::min` for `Size` (core: the first argument when equal). */
function Ord_min_Size(a: Size, b: Size): Size {
  return Size_cmp(a, b) === 1 ? b : a;
}

/** `conv == CanonAbi::Arm(call)` (derived `PartialEq`). */
function canon_abi_is_arm(conv: CanonAbi, call: "CCmseNonSecureCall" | "CCmseNonSecureEntry"): boolean {
  return conv.$ === "Arm" && conv._0 === call;
}


// ---- Cross-lane forwarders (header) ----------------------------------------------------------------------------------
// Each entry forwards to one upstream fn of another fill lane, all of which have landed. Methods take the receiver first.
// Tests may replace entries.
export const block_xlane = {
  // ssa-debuginfo (mir/debuginfo.rs): ported; these entries forward to the installed methods (root at integ-w55).
  /** `fx.set_debug_loc(bx, source_info)` (mir/debuginfo.rs:221). */
  set_debug_loc<B extends BackendTypes>(fx: FunctionCx<B>, bx: BuilderMethods<B>, source_info: SourceInfo): void {
    fx.set_debug_loc(bx, source_info);
  },
  /** `fx.debug_introduce_local(bx, local)` (mir/debuginfo.rs:310). */
  debug_introduce_local<B extends BackendTypes>(fx: FunctionCx<B>, bx: BuilderMethods<B>, local: Local): void {
    fx.debug_introduce_local(bx, local);
  },
  /** `fx.codegen_stmt_debuginfos(bx, debuginfos)` (mir/debuginfo.rs:722). */
  codegen_stmt_debuginfos<B extends BackendTypes>(fx: FunctionCx<B>, bx: BuilderMethods<B>, debuginfos: readonly StmtDebugInfo[]): void {
    fx.codegen_stmt_debuginfos(bx, debuginfos);
  },

  // ssa-mir-rest (mir/statement.rs, mir/constant.rs, meth.rs) and ssa-rvalue-intrinsic (mir/intrinsic.rs): ported; these
  // entries forward to them (root at integ-w54), so tests can still replace them.
  /** `fx.codegen_statement(bx, statement)` (mir/statement.rs:12). */
  codegen_statement<B extends BackendTypes>(fx: FunctionCx<B>, bx: BuilderMethods<B>, statement: Statement): void {
    fx.codegen_statement(bx, statement);
  },
  /** `fx.eval_mir_constant(constant)` (mir/constant.rs:25). */
  eval_mir_constant<B extends BackendTypes>(fx: FunctionCx<B>, constant: ConstOperand): ConstValue {
    return fx.eval_mir_constant(constant);
  },
  /** `meth::VirtualIndex::from_index(index).get_fn(bx, llvtable, ty, fn_abi)` (meth.rs:14, :46). */
  VirtualIndex_get_fn<B extends BackendTypes>(index: number, bx: BuilderMethods<B>, llvtable: B["Value"], ty: Ty, fn_abi: FnAbi<Ty>): B["Value"] {
    return meth.VirtualIndex.from_index(index).get_fn(bx, llvtable, ty, fn_abi);
  },
  /** `meth::VirtualIndex::from_index(index).get_optional_fn(bx, llvtable, ty, fn_abi)` (meth.rs:14, :36). */
  VirtualIndex_get_optional_fn<B extends BackendTypes>(index: number, bx: BuilderMethods<B>, llvtable: B["Value"], ty: Ty, fn_abi: FnAbi<Ty>): B["Value"] {
    return meth.VirtualIndex.from_index(index).get_optional_fn(bx, llvtable, ty, fn_abi);
  },

  // ssa-rvalue-intrinsic (mir/intrinsic.rs)
  /** `fx.codegen_intrinsic_call(bx, instance, args, result_layout, result_place, source_info)` (mir/intrinsic.rs:57). */
  codegen_intrinsic_call<B extends BackendTypes>(
    fx: FunctionCx<B>,
    bx: BuilderMethods<B>,
    instance: Instance,
    args: readonly OperandRef<B["Value"]>[],
    result_layout: TyAndLayout,
    result_place: PlaceValue<B["Value"]> | undefined,
    source_info: SourceInfo,
  ): IntrinsicResult<B["Value"]> {
    return fx.codegen_intrinsic_call(bx, instance, args, result_layout, result_place, source_info);
  },

  // ssa-base (base.rs): ported; these entries forward to it (root at integ-w54), so tests can still replace them.
  /** `base::wants_msvc_seh(&TargetSpec)` (base.rs:385). */
  wants_msvc_seh(target: TargetSpec): boolean {
    return base.wants_msvc_seh(target);
  },
  /** `base::is_call_from_compiler_builtins_to_upstream_monomorphization(tcx, instance)` (base.rs:932). */
  is_call_from_compiler_builtins_to_upstream_monomorphization(tcx: TyCtxt, instance: Instance): boolean {
    return base.is_call_from_compiler_builtins_to_upstream_monomorphization(tcx, instance);
  },
};
