// Port of compiler/rustc_const_eval/src/const_eval/machine.rs: DECLARED (lane interp-contract, plan-m4 wave 23b). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// ctfe-b; docs/handoff/interp-contract.md has the split table, the conventions and "How to fill a stub"
// (interpret/eval_context.ts's header has the representation notes).
import { CanAccessMutGlobal, CheckAlignment, type MemoryKind } from "./machine.gen.ts";

export * from "./machine.gen.ts";
import { ConstEvalErrKind } from "./error.gen.ts";
import { ConstEvalErrKind_into_InterpErrorInfo } from "./error.ts";
import { LongRunning_diagnostic, LongRunningWarn_diagnostic } from "../diagnostics.ts";
import { FnArg } from "../interpret/call.ts";
import { InterpCx } from "../interpret/eval_context.ts";
import { AllocMap_provided, compile_time_machine, type MayLeak, RetagMode, type CtfeMemoryKind, type Machine } from "../interpret/machine.ts";
import type { HasStaticRootDefId } from "../interpret/intern.ts";
import { Immediate } from "../interpret/operand.ts";
import { ensure_monomorphic_enough, type_implements_dyn_trait } from "../interpret/util.ts";
import { Align, display_AlignFromBytesError, FieldIdx, FieldsShape, FIRST_VARIANT, Size, VariantIdx } from "../../rustc_abi/lib.ts";
import { find_attr } from "../../rustc_attr_ir/lib.ts";
import { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import { IntoDiagArg } from "../../rustc_error_messages/lib.ts";
import { number_into_diag_arg } from "../../rustc_error_messages/diagnostic_impls.ts";
import type { LocalDefId } from "../../rustc_span/def_id.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { type RangeSet } from "../interpret/validity.ts";
import { CRATE_HIR_ID, type HirId } from "../../rustc_hir_id/lib.ts";
import { Level } from "../../rustc_lint_defs/lib.ts";
import { LONG_RUNNING_CONST_EVAL } from "../../rustc_lint_defs/builtin.gen.ts";
import {
  AllocInit,
  type AllocId,
  type AllocRange,
  type ConstAllocation,
  CtfeProvenance,
  InterpErrorInfo_from_ErrorHandled,
  InterpErrorInfo_from_InterpErrorKind,
  type InterpResult,
  interp_ok,
  InvalidProgramInfo,
  type Pointer,
  ReportedErrorInfo,
  ResourceExhaustionInfo,
  Scalar,
  Scalar_from_ScalarInt,
} from "../../rustc_middle/mir/interpret/mod.ts";
import { type AssertKind, type AssertMessage, type BasicBlock, type BinOp, type Body, type Operand as mir_Operand, type RuntimeChecks, type UnwindAction } from "../../rustc_middle/mir/mod.ts";
import { type TyCtxtAt } from "../../rustc_middle/query/calls.ts";
import { type ConstInt } from "../../rustc_middle/ty/consts/int.ts";
import { ScalarInt, ScalarInt_eq } from "../../rustc_middle/ty/consts/int.ts";
import { type TyCtxt } from "../../rustc_middle/ty/context.ts";
import { type FnAbi } from "../../rustc_middle/ty/decls.ts";
import { display_Instance, Instance, type InstanceKind } from "../../rustc_middle/ty/instance.ts";
import { LayoutCx, type TyAndLayout, ValidityRequirement } from "../../rustc_middle/ty/layout.ts";
import { HasAttrs_DefId, Ty } from "../../rustc_middle/ty/mod.ts";
import type { CodegenFnAttrs } from "../../rustc_middle/middle/codegen_fn_attrs.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { type DefId } from "../../rustc_span/def_id.ts";
import { SyntaxContext } from "../../rustc_span/hygiene.ts";
import { FileName, RemapPathScopeComponents, Span } from "../../rustc_span/lib.ts";
import { display_Symbol, sym, Symbol } from "../../rustc_span/symbol.ts";
import { Binder } from "../../rustc_type_ir/binder.ts";
import { type Fmt } from "../../std/fmt.ts";
import { assert, assert_eq, unported, unreachable, unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { utf8, utf8_len } from "../../std/str.ts";
import { ImmTy, OpTy } from "../interpret/operand.gen.ts";
import { MPlaceTy, PlaceTy } from "../interpret/place.gen.ts";
import { Frame } from "../interpret/stack.gen.ts";

/** `usize::is_power_of_two` (exact for every safe integer). */
function is_power_of_two(n: number): boolean {
  if (n <= 0) return false;
  const b = BigInt(n);
  return (b & (b - 1n)) === 0n;
}

declare module "../interpret/eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // machine.rs:215 (lane ctfe-b)
    location_triple_for_span(span: Span): [Symbol, number, number];
    // machine.rs:234 (lane ctfe-b)
    hook_special_const_fn(instance: Instance, args: readonly FnArg[], _dest: PlaceTy, _ret: BasicBlock | undefined): InterpResult<Instance | undefined>;
    // machine.rs:282 (lane ctfe-b)
    guaranteed_cmp(a: Scalar, b: Scalar): InterpResult<number>;
  }
}

/// When hitting this many interpreted terminators we emit a deny by default lint
/// that notfies the user that their constant takes a long time to evaluate. If that's
/// what they intended, they can just allow the lint.
export const LINT_TERMINATOR_LIMIT = 2_000_000;
/// The limit used by `-Z tiny-const-eval-limit`. This smaller limit is useful for internal
/// tests not needing to run 30s or more to show some behaviour.
export const TINY_LINT_TERMINATOR_LIMIT = 20;
/// After this many interpreted terminators, we start emitting progress indicators at every
/// power of two of interpreted terminators.
export const PROGRESS_INDICATOR_START = 4_000_000;

/// Extra machine state for CTFE, and the Machine instance.
//
// Should be public because out-of-tree rustc consumers need this
// if they want to interact with constant values.
// rustc-type: compiler/rustc_const_eval/src/const_eval/machine.rs:49 CompileTimeMachine
// PORT (D8): `impl Machine for CompileTimeMachine` (with `compile_time_machine!(<'tcx>)`) is the class extending the macro's
// base class `compile_time_machine` (interpret/machine.ts header); the trait's associated fns are methods. The
// `impl HasStaticRootDefId for CompileTimeMachine` of interpret/intern.rs is in the class body (PORTING §8).
export class CompileTimeMachine extends compile_time_machine implements HasStaticRootDefId {
  constructor(
    /// The number of terminators that have been evaluated.
    ///
    /// This is used to produce lints informing the user that the compiler is not stuck.
    /// Set to `usize::MAX` to never report anything.
    public num_evaluated_steps: number,

    /// The virtual call stack.
    public stack: Frame[],

    /// Pattern matching on consts with references would be unsound if those references
    /// could point to anything mutable. Therefore, when evaluating consts and when constructing valtrees,
    /// we ensure that only immutable global memory can be accessed.
    public can_access_mut_global: CanAccessMutGlobal,

    /// Whether to check alignment during evaluation.
    public check_alignment: CheckAlignment,

    /// If `Some`, we are evaluating the initializer of the static with the given `LocalDefId`,
    /// storing the result in the given `AllocId`.
    /// Used to prevent accesses to a static's base allocation, as that may allow for self-initialization loops.
    public static_root_ids: [AllocId, LocalDefId] | undefined,

    /// A cache of "data range" computations for unions (i.e., the offsets of non-padding bytes).
    public union_data_ranges: Map<Ty, RangeSet>,

    /// The current retag mode.
    public retag_mode: RetagMode,
  ) {
    super();
  }

  // rustc: compiler/rustc_const_eval/src/const_eval/machine.rs:101 new
  static new(can_access_mut_global: CanAccessMutGlobal, check_alignment: CheckAlignment): CompileTimeMachine {
    return new CompileTimeMachine(
      /* num_evaluated_steps */ 0,
      /* stack */ [],
      can_access_mut_global,
      check_alignment,
      /* static_root_ids */ undefined,
      /* union_data_ranges */ new Map(),
      /* retag_mode */ RetagMode.Default,
    );
  }

  // ---- impl HasStaticRootDefId for const_eval::CompileTimeMachine<'_> (interpret/intern.rs) ----
  // rustc: compiler/rustc_const_eval/src/interpret/intern.rs:53 static_def_id
  static_def_id(): LocalDefId | undefined {
    // `Some(self.static_root_ids?.1)`
    const static_root_ids = this.static_root_ids;
    if (static_root_ids === undefined) return undefined;
    return static_root_ids[1];
  }

  // ---- impl<'tcx> interpret::Machine<'tcx> for CompileTimeMachine<'tcx> ----
  // const PANIC_ON_ALLOC_FAIL: bool = false; // will be raised as a proper error
  readonly PANIC_ON_ALLOC_FAIL: boolean = false;

  // #[inline(always)]
  /// Find the first stack frame that is within the current crate, if any.
  /// Otherwise, return the crate's HirId
  // rustc: compiler/rustc_const_eval/src/const_eval/machine.rs:398 best_lint_scope
  best_lint_scope(tcx: TyCtxt): HirId {
    for (const frame of this.stack) {
      const r = frame.lint_root(tcx);
      if (r !== undefined) return r;
    }
    return CRATE_HIR_ID;
  }

  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/const_eval/machine.rs:409 enforce_alignment
  enforce_alignment(ecx: CompileTimeInterpCx): boolean {
    return ecx.machine.check_alignment === CheckAlignment.Error;
  }

  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/const_eval/machine.rs:414 enforce_validity
  enforce_validity(ecx: CompileTimeInterpCx, layout: TyAndLayout): boolean {
    return ecx.tcx.tcx.sess.opts.unstable_opts.extra_const_ub_checks || layout.is_uninhabited();
  }

  // rustc: compiler/rustc_const_eval/src/const_eval/machine.rs:418 load_mir
  override load_mir(ecx: CompileTimeInterpCx, instance: InstanceKind): Body {
    switch (instance.$) {
      case "Item": {
        const def = instance._0;
        return ecx.tcx.mir_for_ctfe(def);
      }
      default:
        return ecx.tcx.tcx.instance_mir(instance);
    }
  }

  // rustc: compiler/rustc_const_eval/src/const_eval/machine.rs:428 find_mir_or_eval_fn
  find_mir_or_eval_fn(
    ecx: CompileTimeInterpCx,
    orig_instance: Instance,
    _abi: FnAbi<Ty>,
    args: readonly FnArg[],
    dest: PlaceTy,
    ret: BasicBlock | undefined,
    _unwind: UnwindAction, // unwinding is not supported in consts
  ): InterpResult<[Body, Instance] | undefined> {
    // debug!("find_mir_or_eval_fn: {:?}", orig_instance);

    // Replace some functions.
    const r = ecx.hook_special_const_fn(orig_instance, args, dest, ret);
    if (r.$ === "Err") return r;
    const instance = r._0;
    if (instance === undefined) {
      // Call has already been handled.
      return interp_ok(undefined);
    }

    // Only check non-glue functions
    if (instance.def.$ === "Item") {
      const def = instance.def._0;
      // Execution might have wandered off into other crates, so we cannot do a stability-
      // sensitive check here. But we can at least rule out functions that are not const at
      // all. That said, we have to allow calling functions inside a `const trait`. These
      // *are* const-checked!
      if (
        !ecx.tcx.tcx.is_const_fn(def) ||
        find_attr(HasAttrs_DefId.get_attrs(def, ecx.tcx.tcx), (k) => (k.$ === "RustcDoNotConstCheck" ? null : undefined)) !== undefined
      ) {
        // We certainly do *not* want to actually call this fn. const-checking should have
        // prevented this, but this can be reached with unleashed-miri, so make testing
        // simpler by avoiding ICEs there. (Technically this can still ICE if miri-unleash
        // was set in a dependency rather than the current crate. That's okay, it's an
        // internal unstable feature.)
        if (ecx.tcx.tcx.sess.opts.unstable_opts.unleash_the_miri_inside_of_you) {
          // throw_unsup_format!("calling non-const function `{}`", instance)
          return Err(
            InterpErrorInfo_from_InterpErrorKind({
              $: "Unsupported",
              _0: { $: "Unsupported", _0: `calling non-const function \`${display_Instance(instance)}\`` },
            }),
          );
        } else {
          return span_bug(ecx.cur_span(), `calling non-const function \`${display_Instance(instance)}\``);
        }
      }
    }

    // This is a const fn. Call it.
    // In case of replacement, we return the *original* instance to make backtraces work out
    // (and we hope this does not confuse the FnAbi checks too much).
    const body = ecx.load_mir(instance.def, undefined);
    if (body.$ === "Err") return body;
    return interp_ok([body._0, orig_instance]);
  }

  // rustc: compiler/rustc_const_eval/src/const_eval/machine.rs:471 panic_nounwind
  panic_nounwind(ecx: CompileTimeInterpCx, msg_: string): InterpResult {
    const msg = Symbol.intern(msg_);
    const span = ecx.find_closest_untracked_caller_location();
    const [file, line, col] = ecx.location_triple_for_span(span);
    return Err(ConstEvalErrKind_into_InterpErrorInfo({ $: "Panic", msg, file, line, col }));
  }

  // rustc: compiler/rustc_const_eval/src/const_eval/machine.rs:478 call_intrinsic
  call_intrinsic(
    ecx: CompileTimeInterpCx,
    instance: Instance,
    args: readonly OpTy[],
    dest: PlaceTy,
    target: BasicBlock | undefined,
    _unwind: UnwindAction,
  ): InterpResult<Instance | undefined> {
    // Shared intrinsics.
    const shared = ecx.eval_intrinsic(instance, args, dest, target);
    if (shared.$ === "Err") return shared;
    if (shared._0) {
      return interp_ok(undefined);
    }
    const intrinsic_name = ecx.tcx.tcx.item_name(Instance.def_id(instance));

    // CTFE-specific intrinsics.
    switch (intrinsic_name) {
      case sym.abort_immediate: {
        // Note that `abort_immediate` is also hooked separately in Miri.
        // throw_machine_stop!(ConstEvalErrKind::Abort)
        // PORT: `throw_machine_stop!(x)` is `Err(err_machine_stop!(x).into())`, which is `<ConstEvalErrKind as
        // Into<InterpErrorInfo>>::into` (error.rs:91).
        return Err(ConstEvalErrKind_into_InterpErrorInfo(ConstEvalErrKind.Abort));
      }
      case sym.ptr_guaranteed_cmp: {
        const a = ecx.read_scalar(args[0]!);
        if (a.$ === "Err") return a;
        const b = ecx.read_scalar(args[1]!);
        if (b.$ === "Err") return b;
        const cmp = ecx.guaranteed_cmp(a._0, b._0);
        if (cmp.$ === "Err") return cmp;
        const w = ecx.write_scalar(Scalar.from_u8(cmp._0), dest);
        if (w.$ === "Err") return w;
        break;
      }
      case sym.const_allocate: {
        const s = ecx.read_scalar(args[0]!);
        if (s.$ === "Err") return s;
        const size = Scalar.to_target_usize(s._0, ecx);
        if (size.$ === "Err") return size;
        const a = ecx.read_scalar(args[1]!);
        if (a.$ === "Err") return a;
        const align_ = Scalar.to_target_usize(a._0, ecx);
        if (align_.$ === "Err") return align_;

        const ar = Align.from_bytes(align_._0);
        let align: Align;
        if (ar.$ === "Ok") {
          align = ar._0;
        } else {
          const err = ar._0;
          // throw_ub_format!("invalid align passed to `const_allocate`: {err}")
          return Err(
            InterpErrorInfo_from_InterpErrorKind({
              $: "UndefinedBehavior",
              _0: { $: "Ub", _0: `invalid align passed to \`const_allocate\`: ${display_AlignFromBytesError(err)}` },
            }),
          );
        }

        const ptr = ecx.allocate_ptr(Size.from_bytes(size._0), align, { $: "Machine", _0: { $: "Heap", was_made_global: false } }, AllocInit.Uninit);
        if (ptr.$ === "Err") return ptr;
        const w = ecx.write_pointer(ptr._0, dest);
        if (w.$ === "Err") return w;
        break;
      }
      case sym.const_deallocate: {
        const p = ecx.read_pointer(args[0]!);
        if (p.$ === "Err") return p;
        const ptr = p._0;
        const s = ecx.read_scalar(args[1]!);
        if (s.$ === "Err") return s;
        const size_ = Scalar.to_target_usize(s._0, ecx);
        if (size_.$ === "Err") return size_;
        const a = ecx.read_scalar(args[2]!);
        if (a.$ === "Err") return a;
        const align_ = Scalar.to_target_usize(a._0, ecx);
        if (align_.$ === "Err") return align_;

        const size = Size.from_bytes(size_._0);
        const ar = Align.from_bytes(align_._0);
        let align: Align;
        if (ar.$ === "Ok") {
          align = ar._0;
        } else {
          const err = ar._0;
          // throw_ub_format!("invalid align passed to `const_deallocate`: {err}")
          return Err(
            InterpErrorInfo_from_InterpErrorKind({
              $: "UndefinedBehavior",
              _0: { $: "Ub", _0: `invalid align passed to \`const_deallocate\`: ${display_AlignFromBytesError(err)}` },
            }),
          );
        }

        // If an allocation is created in an another const,
        // we don't deallocate it.
        const g = ecx.ptr_get_alloc_id(ptr, 0n);
        if (g.$ === "Err") return g;
        const [alloc_id] = g._0;
        const is_allocated_in_another_const = ecx.tcx.tcx.try_get_global_alloc(alloc_id)?.$ === "Memory";

        if (!is_allocated_in_another_const) {
          const d = ecx.deallocate_ptr(ptr, [size, align], { $: "Machine", _0: { $: "Heap", was_made_global: false } });
          if (d.$ === "Err") return d;
        }
        break;
      }

      case sym.const_make_global: {
        const p = ecx.read_pointer(args[0]!);
        if (p.$ === "Err") return p;
        const ptr = p._0;
        const m = ecx.make_const_heap_ptr_global(ptr);
        if (m.$ === "Err") return m;
        const w = ecx.write_pointer(ptr, dest);
        if (w.$ === "Err") return w;
        break;
      }

      // The intrinsic represents whether the value is known to the optimizer (LLVM).
      // We're not doing any optimizations here, so there is no optimizer that could know the value.
      // (We know the value here in the machine of course, but this is the runtime of that code,
      // not the optimization stage.)
      case sym.is_val_statically_known: {
        const w = ecx.write_scalar(Scalar.from_bool(false), dest);
        if (w.$ === "Err") return w;
        break;
      }

      // We handle these here since Miri does not want to have them.
      case sym.assert_inhabited:
      case sym.assert_zero_valid:
      case sym.assert_mem_uninitialized_valid: {
        const ty = instance.args.type_at(0);
        const requirement = unwrap(ValidityRequirement.from_intrinsic(intrinsic_name));

        const cr = ecx.tcx.check_validity_requirement([requirement, ecx.typing_env_().as_query_input(ty)]);
        if (cr.$ === "Err") {
          // .map_err(|_| err_inval!(TooGeneric))?
          return Err(InterpErrorInfo_from_InterpErrorKind({ $: "InvalidProgram", _0: InvalidProgramInfo.TooGeneric }));
        }
        const should_panic = !cr._0;

        if (should_panic) {
          const lr = ecx.layout_of(ty);
          if (lr.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(lr._0));
          const layout = lr._0;

          let msg: string;
          // For *all* intrinsics we first check `is_uninhabited` to give a more specific
          // error message.
          if (layout.is_uninhabited()) {
            msg = `aborted execution: attempted to instantiate uninhabited type \`${display_Ty(ty)}\``;
          } else {
            switch (requirement) {
              case "Inhabited":
                return bug("handled earlier");
              case "Zero":
                msg = `aborted execution: attempted to zero-initialize type \`${display_Ty(ty)}\`, which is invalid`;
                break;
              case "UninitMitigated0x01Fill":
                msg = `aborted execution: attempted to leave type \`${display_Ty(ty)}\` uninitialized, which is invalid`;
                break;
              case "Uninit":
                return bug("assert_uninit_valid doesn't exist");
            }
          }

          const p = this.panic_nounwind(ecx, msg);
          if (p.$ === "Err") return p;
          // Skip the `return_to_block` at the end (we panicked, we do not return).
          return interp_ok(undefined);
        }
        break;
      }

      case sym.type_id_vtable: {
        const tp = ecx.read_type_id(args[0]!);
        if (tp.$ === "Err") return tp;
        const tp_ty = tp._0;
        const rt = ecx.read_type_id(args[1]!);
        if (rt.$ === "Err") return rt;
        const result_ty = rt._0;

        const ti = type_implements_dyn_trait(ecx, tp_ty, result_ty);
        if (ti.$ === "Err") return ti;
        const [implements_trait, preds] = ti._0;

        if (implements_trait) {
          const vtable_ptr = ecx.get_vtable_ptr(tp_ty, preds);
          if (vtable_ptr.$ === "Err") return vtable_ptr;
          // Writing a non-null pointer into an `Option<NonNull>` will automatically make it `Some`.
          const w = ecx.write_pointer(vtable_ptr._0, dest);
          if (w.$ === "Err") return w;
        } else {
          // Write `None`
          const w = ecx.write_discriminant(FIRST_VARIANT, dest);
          if (w.$ === "Err") return w;
        }
        break;
      }

      case sym.type_id_type_of: {
        const t = ecx.read_type_id(args[0]!);
        if (t.$ === "Err") return t;
        const w = ecx.write_type_info(t._0, dest);
        if (w.$ === "Err") return w;
        break;
      }

      case sym.type_id_is_signed: {
        const t = ecx.read_type_id(args[0]!);
        if (t.$ === "Err") return t;
        const w = ecx.write_scalar(Scalar.from_bool(t._0.is_signed()), dest);
        if (w.$ === "Err") return w;
        break;
      }

      case sym.type_id_points_mutably: {
        const t = ecx.read_type_id(args[0]!);
        if (t.$ === "Err") return t;
        const k = t._0.kind();
        const is_mutable = (k.$ === "RawPtr" && k._1 === "Mut") || (k.$ === "Ref" && k._2 === "Mut");
        const w = ecx.write_scalar(Scalar.from_bool(is_mutable), dest);
        if (w.$ === "Err") return w;
        break;
      }

      case sym.type_id_size_of: {
        const t = ecx.read_type_id(args[0]!);
        if (t.$ === "Err") return t;
        const ty = t._0;
        const lr = ecx.layout_of(ty);
        if (lr.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(lr._0));
        const layout = lr._0;
        let variant_index: VariantIdx;
        if (layout.is_sized()) {
          const d = ecx.project_downcast_named(dest, sym.Some);
          if (d.$ === "Err") return d;
          const [variant, variant_place] = d._0;
          const size_field_place = ecx.project_field(variant_place, FieldIdx.ZERO);
          if (size_field_place.$ === "Err") return size_field_place;
          const w = ecx.write_scalar(
            Scalar_from_ScalarInt(unwrap(ScalarInt.try_from_target_usize(BigInt(layout.size.bytes()), ecx.tcx.tcx))),
            size_field_place._0,
          );
          if (w.$ === "Err") return w;
          variant_index = variant;
        } else {
          const d = ecx.project_downcast_named(dest, sym.None);
          if (d.$ === "Err") return d;
          variant_index = d._0[0];
        }
        const w = ecx.write_discriminant(variant_index, dest);
        if (w.$ === "Err") return w;
        break;
      }

      case sym.type_id_element_ty: {
        const t = ecx.read_type_id(args[0]!);
        if (t.$ === "Err") return t;
        const ty = t._0;
        const k = ty.kind();
        let variant_index: VariantIdx;
        if (k.$ === "Array" || k.$ === "Slice") {
          const elem_ty = k._0;
          const d = ecx.project_downcast_named(dest, sym.Some);
          if (d.$ === "Err") return d;
          const [variant_idx, variant_place] = d._0;
          const type_id_field_place = ecx.project_field(variant_place, FieldIdx.ZERO);
          if (type_id_field_place.$ === "Err") return type_id_field_place;
          const w = ecx.write_type_id(elem_ty, type_id_field_place._0);
          if (w.$ === "Err") return w;
          variant_index = variant_idx;
        } else {
          const d = ecx.project_downcast_named(dest, sym.None);
          if (d.$ === "Err") return d;
          variant_index = d._0[0];
        }
        const w = ecx.write_discriminant(variant_index, dest);
        if (w.$ === "Err") return w;
        break;
      }

      case sym.type_id_array_len: {
        const t = ecx.read_type_id(args[0]!);
        if (t.$ === "Err") return t;
        const k = t._0.kind();
        const len = k.$ === "Array" ? k._1.to_leaf().to_target_usize(ecx.tcx.tcx) : 0n;
        const w = ecx.write_scalar(Scalar.from_target_usize(len, ecx), dest);
        if (w.$ === "Err") return w;
        break;
      }

      case sym.type_id_fields: {
        const t = ecx.read_type_id(args[0]!);
        if (t.$ === "Err") return t;
        const ty = t._0;
        const vi = ecx.read_target_usize(args[1]!);
        if (vi.$ === "Err") return vi;
        // PORT: `as usize` of a `u64`: kept a bigint for the bounds check (exact), a number below it.
        const variant_idx = vi._0;

        const adt_def = ty.ty_adt_def();
        const variants_num = adt_def !== undefined ? adt_def.variants().length : 1;
        if (variant_idx >= BigInt(variants_num)) {
          // throw_ub!(BoundsCheckFailed { len: variants_num as u64, index: variant_idx as u64 })
          return Err(
            InterpErrorInfo_from_InterpErrorKind({
              $: "UndefinedBehavior",
              _0: { $: "BoundsCheckFailed", len: variants_num, index: Number(variant_idx) },
            }),
          );
        }

        let fields_num: number;
        const k = ty.kind();
        switch (k.$) {
          case "Adt": {
            const variant_def = k._0.variants()[VariantIdx.from_usize(Number(variant_idx))]!;
            fields_num = variant_def.fields.length;
            break;
          }
          case "Tuple":
            fields_num = k._0.length;
            break;
          default:
            fields_num = 0; // Other types have no fields
        }

        const w = ecx.write_scalar(Scalar.from_target_usize(BigInt(fields_num), ecx), dest);
        if (w.$ === "Err") return w;
        break;
      }

      case sym.type_id_field_representing_type: {
        const t = ecx.read_type_id(args[0]!);
        if (t.$ === "Err") return t;
        const ty = t._0;
        const vi = ecx.read_target_usize(args[1]!);
        if (vi.$ === "Err") return vi;
        // PORT: `as usize` of a `u64`: kept a bigint for the bounds checks (exact), a number below them.
        const variant_idx = vi._0;
        const fi = ecx.read_target_usize(args[2]!);
        if (fi.$ === "Err") return fi;
        const field_idx = fi._0;

        const adt_def = ty.ty_adt_def();
        const variants_num = adt_def !== undefined ? adt_def.variants().length : 1;
        if (variant_idx >= BigInt(variants_num)) {
          // throw_ub!(BoundsCheckFailed { len: variants_num as u64, index: variant_idx as u64 })
          return Err(
            InterpErrorInfo_from_InterpErrorKind({
              $: "UndefinedBehavior",
              _0: { $: "BoundsCheckFailed", len: variants_num, index: Number(variant_idx) },
            }),
          );
        }

        let fields_num: number;
        const k = ty.kind();
        switch (k.$) {
          case "Adt": {
            const variant_def = k._0.variants()[VariantIdx.from_usize(Number(variant_idx))]!;
            fields_num = variant_def.fields.length;
            break;
          }
          case "Tuple":
            fields_num = k._0.length;
            break;
          default:
            fields_num = 0; // Other types have no fields
        }
        if (field_idx >= BigInt(fields_num)) {
          // throw_ub!(BoundsCheckFailed { len: fields_num as u64, index: field_idx as u64 })
          return Err(
            InterpErrorInfo_from_InterpErrorKind({
              $: "UndefinedBehavior",
              _0: { $: "BoundsCheckFailed", len: fields_num, index: Number(field_idx) },
            }),
          );
        }

        const frt = Ty.new_field_representing_type(
          ecx.tcx.tcx,
          ty,
          VariantIdx.from_usize(Number(variant_idx)),
          FieldIdx.from_usize(Number(field_idx)),
        );
        const w = ecx.write_type_id(frt, dest);
        if (w.$ === "Err") return w;
        break;
      }
      case sym.type_id_function_ptr: {
        const t = ecx.read_type_id(args[0]!);
        if (t.$ === "Err") return t;
        const k = t._0.kind();
        let variant_index: VariantIdx;
        if (k.$ === "FnPtr") {
          const sig_ = k._0;
          const fn_header = k._1;
          const d = ecx.project_downcast_named(dest, sym.Some);
          if (d.$ === "Err") return d;
          const [variant, variant_place] = d._0;
          const field_place = ecx.project_field(variant_place, FieldIdx.ZERO);
          if (field_place.$ === "Err") return field_place;
          const sig = Binder.skip_binder(sig_); // FIXME: handle lifetime bounds
          const w = ecx.write_fn_ptr_type_info(field_place._0, sig, fn_header);
          if (w.$ === "Err") return w;
          variant_index = variant;
        } else {
          const d = ecx.project_downcast_named(dest, sym.None);
          if (d.$ === "Err") return d;
          variant_index = d._0[0];
        }
        const w = ecx.write_discriminant(variant_index, dest);
        if (w.$ === "Err") return w;
        break;
      }
      case sym.type_id_points_to: {
        const t = ecx.read_type_id(args[0]!);
        if (t.$ === "Err") return t;
        const k = t._0.kind();
        let variant_index: VariantIdx;
        if (k.$ === "RawPtr" || k.$ === "Ref") {
          const pointee_ty = k.$ === "RawPtr" ? k._0 : k._1;
          const d = ecx.project_downcast_named(dest, sym.Some);
          if (d.$ === "Err") return d;
          const [variant, variant_place] = d._0;
          const field_place = ecx.project_field(variant_place, FieldIdx.ZERO);
          if (field_place.$ === "Err") return field_place;
          const w = ecx.write_type_id(pointee_ty, field_place._0);
          if (w.$ === "Err") return w;
          variant_index = variant;
        } else {
          const d = ecx.project_downcast_named(dest, sym.None);
          if (d.$ === "Err") return d;
          variant_index = d._0[0];
        }
        const w = ecx.write_discriminant(variant_index, dest);
        if (w.$ === "Err") return w;
        break;
      }

      case sym.type_id_variants: {
        const t = ecx.read_type_id(args[0]!);
        if (t.$ === "Err") return t;
        const def = t._0.ty_adt_def();
        const variants_num = def !== undefined ? def.variants().length : 1;
        const w = ecx.write_scalar(Scalar.from_target_usize(BigInt(variants_num), ecx), dest);
        if (w.$ === "Err") return w;
        break;
      }

      case sym.type_id_variant_name: {
        const t = ecx.read_type_id(args[0]!);
        if (t.$ === "Err") return t;
        const base = t._0;

        let field_name: Symbol;
        const k = base.kind();
        if (k.$ === "Adt") {
          const def = k._0;
          const vi = ecx.read_target_usize(args[1]!);
          if (vi.$ === "Err") return vi;
          const variant_idx_ = vi._0;
          if (variant_idx_ >= BigInt(def.variants().length)) {
            // throw_ub!(BoundsCheckFailed { len: def.variants().len() as u64, index: variant_idx as u64 })
            return Err(
              InterpErrorInfo_from_InterpErrorKind({
                $: "UndefinedBehavior",
                _0: { $: "BoundsCheckFailed", len: def.variants().length, index: Number(variant_idx_) },
              }),
            );
          }
          const variant_idx = VariantIdx.from_usize(Number(variant_idx_));
          field_name = def.variant(variant_idx).name;
        } else {
          return span_bug(ecx.cur_span(), `expected enum type, got ${display_Ty(base)}`);
        }
        const ptr = ecx.allocate_bytes_dedup(utf8(Symbol.as_str(field_name)));
        if (ptr.$ === "Err") return ptr;
        const w = ecx.write_immediate(
          {
            $: "ScalarPair",
            _0: Scalar.from_pointer(ptr._0, ecx),
            _1: Scalar.from_target_usize(BigInt(utf8_len(Symbol.as_str(field_name))), ecx),
          },
          dest,
        );
        if (w.$ === "Err") return w;
        break;
      }

      case sym.type_id_variant_non_exhaustive: {
        const t = ecx.read_type_id(args[0]!);
        if (t.$ === "Err") return t;
        const base = t._0;

        let non_exhaustive: boolean;
        const k = base.kind();
        if (k.$ === "Adt") {
          const def = k._0;
          const vi = ecx.read_target_usize(args[1]!);
          if (vi.$ === "Err") return vi;
          const variant_idx_ = vi._0;
          if (variant_idx_ >= BigInt(def.variants().length)) {
            // throw_ub!(BoundsCheckFailed { len: def.variants().len() as u64, index: variant_idx as u64 })
            return Err(
              InterpErrorInfo_from_InterpErrorKind({
                $: "UndefinedBehavior",
                _0: { $: "BoundsCheckFailed", len: def.variants().length, index: Number(variant_idx_) },
              }),
            );
          }
          const variant_idx = VariantIdx.from_usize(Number(variant_idx_));
          non_exhaustive = def.variant(variant_idx).is_field_list_non_exhaustive();
        } else {
          return span_bug(ecx.cur_span(), `expected enum type, got ${display_Ty(base)}`);
        }
        const w = ecx.write_scalar(Scalar.from_bool(non_exhaustive), dest);
        if (w.$ === "Err") return w;
        break;
      }

      case sym.field_offset: {
        const frt_ty = instance.args.type_at(0);
        const e = ensure_monomorphic_enough(frt_ty, fold_Ty);
        if (e.$ === "Err") return e;

        const k = frt_ty.kind();
        const info = k.$ === "Adt" ? k._0.field_representing_type_info(ecx.tcx.tcx, k._1) : undefined;
        if (info === undefined) {
          return span_bug(ecx.cur_span(), `expected field representing type, got ${display_Ty(frt_ty)}`);
        }
        const { base: ty, variant_idx: variant, field_idx: field } = info;
        const lr = ecx.layout_of(ty);
        if (lr.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(lr._0));
        const cx = LayoutCx.new(ecx.tcx.tcx, ecx.typing_env_());

        const layout = lr._0.for_variant(cx, variant);
        const offset = FieldsShape.offset(layout.fields, field).bytes();

        const w = ecx.write_scalar(Scalar.from_target_usize(BigInt(offset), ecx), dest);
        if (w.$ === "Err") return w;
        break;
      }

      case sym.field_representing_type_name: {
        const t = ecx.read_type_id(args[0]!);
        if (t.$ === "Err") return t;
        const frt_ty = t._0;

        const k = frt_ty.kind();
        const info = k.$ === "Adt" ? k._0.field_representing_type_info(ecx.tcx.tcx, k._1) : undefined;
        if (info === undefined) {
          return span_bug(ecx.cur_span(), `expected field representing type, got ${display_Ty(frt_ty)}`);
        }
        const field_name = info.name;
        const ptr = ecx.allocate_bytes_dedup(utf8(Symbol.as_str(field_name)));
        if (ptr.$ === "Err") return ptr;
        const w = ecx.write_immediate(
          {
            $: "ScalarPair",
            _0: Scalar.from_pointer(ptr._0, ecx),
            _1: Scalar.from_target_usize(BigInt(utf8_len(Symbol.as_str(field_name))), ecx),
          },
          dest,
        );
        if (w.$ === "Err") return w;
        break;
      }

      case sym.field_representing_type_offset: {
        const t = ecx.read_type_id(args[0]!);
        if (t.$ === "Err") return t;
        const frt_ty = t._0;

        const k = frt_ty.kind();
        const info = k.$ === "Adt" ? k._0.field_representing_type_info(ecx.tcx.tcx, k._1) : undefined;
        if (info === undefined) {
          return span_bug(ecx.cur_span(), `expected field representing type, got ${display_Ty(frt_ty)}`);
        }
        const { base: ty, variant_idx: variant, field_idx: field } = info;
        const lr = ecx.layout_of(ty);
        if (lr.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(lr._0));
        const cx = LayoutCx.new(ecx.tcx.tcx, ecx.typing_env_());

        const layout = lr._0.for_variant(cx, variant);
        const offset = FieldsShape.offset(layout.fields, field).bytes();

        const w = ecx.write_scalar(Scalar.from_target_usize(BigInt(offset), ecx), dest);
        if (w.$ === "Err") return w;
        break;
      }

      case sym.field_representing_type_actual_type_id: {
        const t = ecx.read_type_id(args[0]!);
        if (t.$ === "Err") return t;
        const frt_ty = t._0;

        const k = frt_ty.kind();
        const info = k.$ === "Adt" ? k._0.field_representing_type_info(ecx.tcx.tcx, k._1) : undefined;
        if (info === undefined) {
          return span_bug(ecx.cur_span(), `expected field representing type, got ${display_Ty(frt_ty)}`);
        }
        const field_ty = ecx.tcx.tcx.erase_and_anonymize_regions(info.ty, fold_Ty);
        const w = ecx.write_type_id(field_ty, dest);
        if (w.$ === "Err") return w;
        break;
      }

      case sym.type_id_generics: {
        const t = ecx.read_type_id(args[0]!);
        if (t.$ === "Err") return t;
        const w = ecx.write_type_id_generics(dest, t._0);
        if (w.$ === "Err") return w;
        break;
      }

      case sym.type_id_non_exhaustive: {
        const t = ecx.read_type_id(args[0]!);
        if (t.$ === "Err") return t;
        const k = t._0.kind();

        // FIXME(reflection): need a way to obtain non-exhaustiveness of a variant's fields.
        let non_exhaustive: boolean;
        if (k.$ === "Adt") {
          const def = k._0;
          if (def.is_enum()) {
            non_exhaustive = def.is_variant_list_non_exhaustive();
          } else {
            non_exhaustive = def.non_enum_variant().is_field_list_non_exhaustive();
          }
        } else {
          non_exhaustive = false;
        }

        const w = ecx.write_scalar(Scalar.from_bool(non_exhaustive), dest);
        if (w.$ === "Err") return w;
        break;
      }

      default: {
        // We haven't handled the intrinsic, let's see if we can use a fallback body.
        if (unwrap(ecx.tcx.tcx.intrinsic(Instance.def_id(instance))).must_be_overridden) {
          // throw_unsup_format!("intrinsic `{intrinsic_name}` is not supported at compile-time")
          return Err(
            InterpErrorInfo_from_InterpErrorKind({
              $: "Unsupported",
              _0: { $: "Unsupported", _0: `intrinsic \`${display_Symbol(intrinsic_name)}\` is not supported at compile-time` },
            }),
          );
        }
        return interp_ok({ def: { $: "Item", _0: Instance.def_id(instance) }, args: instance.args });
      }
    }

    // Intrinsic is done, jump to next block.
    const rb = ecx.return_to_block(target);
    if (rb.$ === "Err") return rb;
    return interp_ok(undefined);
  }

  // rustc: compiler/rustc_const_eval/src/const_eval/machine.rs:936 call_llvm_intrinsic
  call_llvm_intrinsic(ecx: CompileTimeInterpCx, instance: Instance, _args: readonly OpTy[], _dest: PlaceTy, _target: BasicBlock | undefined): InterpResult {
    const intrinsic_name = unwrap((ecx.tcx.tcx.codegen_fn_attrs(Instance.def_id(instance)) as CodegenFnAttrs).symbol_name);

    // throw_unsup_format!("LLVM intrinsic `{intrinsic_name}` is not supported at compile-time")
    return Err(
      InterpErrorInfo_from_InterpErrorKind({
        $: "Unsupported",
        _0: { $: "Unsupported", _0: `LLVM intrinsic \`${display_Symbol(intrinsic_name)}\` is not supported at compile-time` },
      }),
    );
  }

  // rustc: compiler/rustc_const_eval/src/const_eval/machine.rs:948 assert_panic
  assert_panic(ecx: CompileTimeInterpCx, msg: AssertMessage, _unwind: UnwindAction): InterpResult {
    // use rustc_middle::mir::AssertKind::*;
    // Convert `AssertKind<Operand>` to `AssertKind<Scalar>`.
    const eval_to_int = (op: mir_Operand): InterpResult<ConstInt> => {
      const o = ecx.eval_operand(op, undefined);
      if (o.$ === "Err") return o;
      const r = ecx.read_immediate(o._0);
      if (r.$ === "Err") return r;
      return Ok(r._0.to_const_int());
    };
    let err: AssertKind<ConstInt>;
    switch (msg.$) {
      case "BoundsCheck": {
        const len = eval_to_int(msg.len);
        if (len.$ === "Err") return len;
        const index = eval_to_int(msg.index);
        if (index.$ === "Err") return index;
        err = { $: "BoundsCheck", len: len._0, index: index._0 };
        break;
      }
      case "Overflow": {
        const l = eval_to_int(msg._1);
        if (l.$ === "Err") return l;
        const r = eval_to_int(msg._2);
        if (r.$ === "Err") return r;
        err = { $: "Overflow", _0: msg._0, _1: l._0, _2: r._0 };
        break;
      }
      case "OverflowNeg": {
        const op = eval_to_int(msg._0);
        if (op.$ === "Err") return op;
        err = { $: "OverflowNeg", _0: op._0 };
        break;
      }
      case "DivisionByZero": {
        const op = eval_to_int(msg._0);
        if (op.$ === "Err") return op;
        err = { $: "DivisionByZero", _0: op._0 };
        break;
      }
      case "RemainderByZero": {
        const op = eval_to_int(msg._0);
        if (op.$ === "Err") return op;
        err = { $: "RemainderByZero", _0: op._0 };
        break;
      }
      case "ResumedAfterReturn":
        err = { $: "ResumedAfterReturn", _0: msg._0 };
        break;
      case "ResumedAfterPanic":
        err = { $: "ResumedAfterPanic", _0: msg._0 };
        break;
      case "ResumedAfterDrop":
        err = { $: "ResumedAfterDrop", _0: msg._0 };
        break;
      case "MisalignedPointerDereference": {
        const required = eval_to_int(msg.required);
        if (required.$ === "Err") return required;
        const found = eval_to_int(msg.found);
        if (found.$ === "Err") return found;
        err = { $: "MisalignedPointerDereference", required: required._0, found: found._0 };
        break;
      }
      case "NullPointerDereference":
        err = { $: "NullPointerDereference" };
        break;
      case "NullReferenceConstructed":
        err = { $: "NullReferenceConstructed" };
        break;
      case "InvalidEnumConstruction": {
        const source = eval_to_int(msg._0);
        if (source.$ === "Err") return source;
        err = { $: "InvalidEnumConstruction", _0: source._0 };
        break;
      }
    }
    return Err(ConstEvalErrKind_into_InterpErrorInfo({ $: "AssertFailure", _0: err }));
  }

  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/const_eval/machine.rs:982 runtime_checks
  runtime_checks(_ecx: CompileTimeInterpCx, _r: RuntimeChecks): InterpResult<boolean> {
    // We can't look at `tcx.sess` here as that can differ across crates, which can lead to
    // unsound differences in evaluating the same constant at different instantiation sites.
    return interp_ok(true);
  }

  // rustc: compiler/rustc_const_eval/src/const_eval/machine.rs:991 binary_ptr_op
  binary_ptr_op(_ecx: CompileTimeInterpCx, _bin_op: BinOp, _left: ImmTy, _right: ImmTy): InterpResult<ImmTy> {
    // throw_unsup_format!("pointer arithmetic or comparison is not supported at compile-time")
    return Err(
      InterpErrorInfo_from_InterpErrorKind({
        $: "Unsupported",
        _0: { $: "Unsupported", _0: "pointer arithmetic or comparison is not supported at compile-time" },
      }),
    );
  }

  // rustc: compiler/rustc_const_eval/src/const_eval/machine.rs:1000 increment_const_eval_counter
  override increment_const_eval_counter(ecx: CompileTimeInterpCx): InterpResult {
    // The step limit has already been hit in a previous call to `increment_const_eval_counter`.

    // PORT: `usize::checked_add(1)`; `usize::MAX` is `Number.MAX_SAFE_INTEGER` (precedent mt-promote).
    const new_steps = ecx.machine.num_evaluated_steps < Number.MAX_SAFE_INTEGER ? ecx.machine.num_evaluated_steps + 1 : undefined;
    if (new_steps !== undefined) {
      let limit: number;
      let start: number;
      if (ecx.tcx.tcx.sess.opts.unstable_opts.tiny_const_eval_limit) {
        [limit, start] = [TINY_LINT_TERMINATOR_LIMIT, TINY_LINT_TERMINATOR_LIMIT];
      } else {
        [limit, start] = [LINT_TERMINATOR_LIMIT, PROGRESS_INDICATOR_START];
      }

      ecx.machine.num_evaluated_steps = new_steps;
      // By default, we have a *deny* lint kicking in after some time
      // to ensure `loop {}` doesn't just go forever.
      // In case that lint got reduced, in particular for `--cap-lint` situations, we also
      // have a hard warning shown every now and then for really long executions.
      if (new_steps === limit) {
        // By default, we stop after a million steps, but the user can disable this lint
        // to be able to run until the heat death of the universe or power loss, whichever
        // comes first.
        const hir_id = ecx.machine.best_lint_scope(ecx.tcx.tcx);
        const is_error = Level.is_error(ecx.tcx.tcx.lint_level_spec_at_node(LONG_RUNNING_CONST_EVAL, hir_id).level_());
        const span = ecx.cur_span();
        ecx.tcx.tcx.emit_node_span_lint(LONG_RUNNING_CONST_EVAL, hir_id, span, LongRunning_diagnostic({ item_span: ecx.tcx.span }));
        // If this was a hard error, don't bother continuing evaluation.
        if (is_error) {
          const guard = ecx.tcx.tcx.dcx().span_delayed_bug(span, "The deny lint should have already errored");
          // throw_inval!(AlreadyReported(ReportedErrorInfo::allowed_in_infallible(guard)))
          return Err(
            InterpErrorInfo_from_InterpErrorKind({
              $: "InvalidProgram",
              _0: { $: "AlreadyReported", _0: ReportedErrorInfo.allowed_in_infallible(guard) },
            }),
          );
        }
      } else if (new_steps > start && is_power_of_two(new_steps)) {
        // Only report after a certain number of terminators have been evaluated and the
        // current number of evaluated terminators is a power of 2. The latter gives us a cheap
        // way to implement exponential backoff.
        const span = ecx.cur_span();
        const warn = ecx.tcx.tcx.dcx().create_warn(LongRunningWarn_diagnostic({ span, item_span: ecx.tcx.span }));
        // We store a unique number in `force_duplicate` to evade `-Z deduplicate-diagnostics`.
        // `new_steps` is guaranteed to be unique because `ecx.machine.num_evaluated_steps` is
        // always increasing.
        warn.arg("force_duplicate", IntoDiagArg.of(new_steps, number_into_diag_arg));
        warn.emit();
      }
    }

    return interp_ok(undefined);
  }

  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/const_eval/machine.rs:1059 expose_provenance
  expose_provenance(_ecx: CompileTimeInterpCx, _provenance: CtfeProvenance): InterpResult {
    // This is only reachable with -Zunleash-the-miri-inside-of-you.
    // throw_unsup_format!("exposing pointers is not possible at compile-time")
    return Err(
      InterpErrorInfo_from_InterpErrorKind({
        $: "Unsupported",
        _0: { $: "Unsupported", _0: "exposing pointers is not possible at compile-time" },
      }),
    );
  }

  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/const_eval/machine.rs:1068 init_frame
  init_frame(ecx: CompileTimeInterpCx, frame: Frame): InterpResult<Frame> {
    // Enforce stack size limit. Add 1 because this is run before the new frame is pushed.
    if (!ecx.recursion_limit.value_within_limit(ecx.stack().length + 1)) {
      // throw_exhaust!(StackFrameLimitReached)
      return Err(InterpErrorInfo_from_InterpErrorKind({ $: "ResourceExhaustion", _0: ResourceExhaustionInfo.StackFrameLimitReached }));
    } else {
      return interp_ok(frame);
    }
  }

  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/const_eval/machine.rs:1081 stack
  stack_(ecx: CompileTimeInterpCx): readonly Frame[] {
    return ecx.machine.stack;
  }

  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/const_eval/machine.rs:1088 stack_mut
  stack_mut(ecx: CompileTimeInterpCx): Frame[] {
    return ecx.machine.stack;
  }

  // rustc: compiler/rustc_const_eval/src/const_eval/machine.rs:1094 before_access_global
  override before_access_global(
    _tcx: TyCtxtAt,
    machine: CompileTimeMachine,
    alloc_id: AllocId,
    alloc_: ConstAllocation,
    _static_def_id: DefId | undefined,
    is_write: boolean,
  ): InterpResult {
    const alloc = alloc_.inner();
    if (is_write) {
      // Write access. These are never allowed, but we give a targeted error message.
      switch (alloc.mutability) {
        case "Not":
          // throw_ub!(WriteToReadOnly(alloc_id))
          return Err(InterpErrorInfo_from_InterpErrorKind({ $: "UndefinedBehavior", _0: { $: "WriteToReadOnly", _0: alloc_id } }));
        case "Mut":
          return Err(ConstEvalErrKind_into_InterpErrorInfo(ConstEvalErrKind.ModifiedGlobal));
      }
    } else {
      // Read access. These are usually allowed, with some exceptions.
      if (machine.can_access_mut_global === CanAccessMutGlobal.Yes) {
        // Machine configuration allows us read from anything (e.g., `static` initializer).
        return interp_ok(undefined);
      } else if (alloc.mutability === "Mut") {
        // Machine configuration does not allow us to read statics (e.g., `const`
        // initializer).
        return Err(ConstEvalErrKind_into_InterpErrorInfo(ConstEvalErrKind.ConstAccessesMutGlobal));
      } else {
        // Immutable global, this read is fine.
        assert_eq(alloc.mutability, "Not", (m) => m);
        return interp_ok(undefined);
      }
    }
  }

  // rustc: compiler/rustc_const_eval/src/const_eval/machine.rs:1126 retag_ptr_value
  override retag_ptr_value(ecx: CompileTimeInterpCx, val: ImmTy, _ty: Ty): InterpResult<ImmTy | undefined> {
    if (ecx.machine.retag_mode === RetagMode.None || ecx.machine.retag_mode === RetagMode.Raw) {
      return interp_ok(undefined);
    }
    // If it's a frozen shared reference that's not already immutable, potentially make it immutable.
    // (Do nothing on `None` provenance, that cannot store immutability anyway.)
    const k = val.layout.ty.kind();
    let provenance: CtfeProvenance | undefined;
    if (
      k.$ === "Ref" &&
      k._2 === "Not" &&
      (provenance = Scalar.to_pointer(Immediate.to_scalar_and_meta(val.imm)[0], ecx).provenance) !== undefined &&
      !CtfeProvenance.immutable(provenance)
    ) {
      const ty = k._1;
      // That next check is expensive, that's why we have all the guards above.
      const is_immutable = ty.is_freeze(ecx.tcx.tcx, ecx.typing_env_());
      const p = ecx.imm_ptr_to_mplace(val);
      if (p.$ === "Err") return p;
      const place = p._0;
      let new_place: MPlaceTy;
      if (is_immutable) {
        new_place = place.map_provenance(CtfeProvenance.as_immutable);
      } else {
        // Even if it is not immutable, remember that it is a shared reference.
        // This allows it to become part of the final value of the constant.
        // (See <https://github.com/rust-lang/rust/pull/128543> for why we allow this
        // even when there is interior mutability.)
        new_place = place.map_provenance(CtfeProvenance.as_shared_ref);
      }
      return interp_ok(ImmTy.from_immediate(new_place.to_ref(ecx), val.layout));
    } else {
      return interp_ok(undefined);
    }
  }

  // rustc: compiler/rustc_const_eval/src/const_eval/machine.rs:1158 with_retag_mode
  override with_retag_mode<T>(ecx: CompileTimeInterpCx, mode: RetagMode, f: (a0: CompileTimeInterpCx) => InterpResult<T>): InterpResult<T> {
    // `mem::replace(&mut ecx.machine.retag_mode, mode)`
    const old_mode = ecx.machine.retag_mode;
    ecx.machine.retag_mode = mode;
    const ret = f(ecx);
    ecx.machine.retag_mode = old_mode;
    return ret;
  }

  // rustc: compiler/rustc_const_eval/src/const_eval/machine.rs:1169 before_memory_write
  override before_memory_write(
    _tcx: TyCtxtAt,
    _machine: CompileTimeMachine,
    _alloc_extra: null,
    _ptr: Pointer<CtfeProvenance | undefined>,
    [_alloc_id, immutable]: [AllocId, boolean],
    range: AllocRange,
  ): InterpResult {
    if (range.size.bytes() === Size.ZERO.bytes()) {
      // Nothing to check.
      return interp_ok(undefined);
    }
    // Reject writes through immutable pointers.
    if (immutable) {
      return Err(ConstEvalErrKind_into_InterpErrorInfo(ConstEvalErrKind.WriteThroughImmutablePointer));
    }
    // Everything else is fine.
    return interp_ok(undefined);
  }

  // rustc: compiler/rustc_const_eval/src/const_eval/machine.rs:1189 before_alloc_access
  override before_alloc_access(tcx: TyCtxtAt, machine: CompileTimeMachine, alloc_id: AllocId): InterpResult {
    if (machine.stack.length === 0) {
      // Get out of the way for the final copy.
      return interp_ok(undefined);
    }
    // Check if this is the currently evaluated static.
    if (machine.static_root_ids !== undefined && alloc_id === machine.static_root_ids[0]) {
      return Err(ConstEvalErrKind_into_InterpErrorInfo(ConstEvalErrKind.RecursiveStatic));
    }
    // If this is another static, make sure we fire off the query to detect cycles.
    // But only do that when checks for static recursion are enabled.
    if (machine.static_root_ids !== undefined) {
      const g = tcx.tcx.try_get_global_alloc(alloc_id);
      if (g !== undefined && g.$ === "Static") {
        const def_id = g._0;
        if (tcx.tcx.is_foreign_item(def_id)) {
          // throw_unsup!(ExternStatic(def_id))
          return Err(InterpErrorInfo_from_InterpErrorKind({ $: "Unsupported", _0: { $: "ExternStatic", _0: def_id } }));
        }
        const r = tcx.eval_static_initializer(def_id);
        if (r.$ === "Err") return Err(InterpErrorInfo_from_ErrorHandled(r._0));
      }
    }
    return interp_ok(undefined);
  }

  // rustc: compiler/rustc_const_eval/src/const_eval/machine.rs:1215 cached_union_data_range
  override cached_union_data_range(ecx: CompileTimeInterpCx, ty: Ty, compute_range: () => RangeSet): RangeSet {
    if (ecx.tcx.tcx.sess.opts.unstable_opts.extra_const_ub_checks) {
      // `Cow::Borrowed(ecx.machine.union_data_ranges.entry(ty).or_insert_with(compute_range))`
      let r = ecx.machine.union_data_ranges.get(ty);
      if (r === undefined) {
        r = compute_range();
        ecx.machine.union_data_ranges.set(ty, r);
      }
      return r;
    } else {
      // Don't bother caching, we're only doing one validation at the end anyway.
      return compute_range();
    }
  }

  // rustc: compiler/rustc_const_eval/src/const_eval/machine.rs:1228 get_default_alloc_params
  get_default_alloc_params(): null {
    return null;
  }

}

// impl From<bool> for CanAccessMutGlobal
// rustc: compiler/rustc_const_eval/src/const_eval/machine.rs:95 from
export function CanAccessMutGlobal_from_bool(value: boolean): CanAccessMutGlobal {
  return value ? CanAccessMutGlobal.Yes : CanAccessMutGlobal.No;
}

// impl<K: Hash + Eq, V> interpret::AllocMap<K, V> for FxIndexMap<K, V>
// PORT (D8): the CTFE machines' `MemoryMap` is an `FxIndexMap` (a JS `Map`, insertion-ordered); the impl is the class
// `FxIndexMap_AllocMap` holding it (`map`), with `AllocMap_provided` as its base (interpret/machine.ts header).
// `FxIndexMap::swap_remove` moves the last entry into the removed slot: the map is rebuilt in that order.
export class FxIndexMap_AllocMap<K, V> extends AllocMap_provided<K, V> {
  constructor(public map: Map<K, V>) {
    super();
  }

  /** `FxIndexMap::default()` */
  static default_<K, V>(): FxIndexMap_AllocMap<K, V> {
    return new FxIndexMap_AllocMap<K, V>(new Map());
  }

  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/const_eval/machine.rs:119 contains_key
  contains_key(k: K): boolean {
    return this.map.has(k);
  }

  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/const_eval/machine.rs:127 contains_key_ref
  contains_key_ref(k: K): boolean {
    return this.map.has(k);
  }

  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/const_eval/machine.rs:135 insert
  insert(k: K, v: V): V | undefined {
    const old = this.map.get(k);
    this.map.set(k, v);
    return old;
  }

  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/const_eval/machine.rs:140 remove
  remove(k: K): V | undefined {
    // FIXME(#120456) - is `swap_remove` correct?
    return swap_remove(this.map, k);
  }

  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/const_eval/machine.rs:149 filter_map_collect
  filter_map_collect<T>(f: (k: K, v: V) => T | undefined): T[] {
    const out: T[] = [];
    for (const [k, v] of this.map) {
      const t = f(k, v);
      if (t !== undefined) out.push(t);
    }
    return out;
  }

  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/const_eval/machine.rs:154 get_or
  get_or<E>(k: K, vacant: () => Result<V, E>): Result<V, E> {
    const v = this.map.get(k);
    if (v !== undefined) {
      return Ok(v);
    } else {
      const r = vacant();
      if (r.$ === "Err") return r;
      return bug("The CTFE machine shouldn't ever need to extend the alloc_map when reading");
    }
  }

  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/const_eval/machine.rs:165 get_mut_or
  get_mut_or<E>(k: K, vacant: () => Result<V, E>): Result<V, E> {
    const e = this.map.get(k);
    if (e !== undefined) {
      return Ok(e);
    } else {
      const r = vacant();
      if (r.$ === "Err") return r;
      const v = r._0;
      this.map.set(k, v);
      return Ok(v);
    }
  }
}

/** `IndexMap::swap_remove`: removes `k`, moving the last entry into its position. */
export function swap_remove<K, V>(map: Map<K, V>, k: K): V | undefined {
  if (!map.has(k)) return undefined;
  const v = map.get(k);
  const entries = [...map];
  const i = entries.findIndex(([key]) => key === k);
  const last = entries.pop()!;
  if (i < entries.length) entries[i] = last;
  map.clear();
  for (const [key, val] of entries) map.set(key, val);
  return v;
}

// rustc-type: compiler/rustc_const_eval/src/const_eval/machine.rs:176 CompileTimeInterpCx
export type CompileTimeInterpCx = InterpCx<CompileTimeMachine>;

// impl fmt::Display for MemoryKind
// PORT: `write!(f, ..)` returns the text (the `Display` convention of interpret/eval_context.ts's header).
// rustc: compiler/rustc_const_eval/src/const_eval/machine.rs:188 fmt
export function display_MemoryKind(self: MemoryKind, f: Fmt): string {
  void f;
  switch (self.$) {
    case "Heap": {
      const was_made_global = self.was_made_global;
      return `heap allocation${was_made_global ? " (made global)" : ""}`;
    }
  }
}

// impl interpret::MayLeak for MemoryKind
export const MayLeak_MemoryKind: MayLeak<MemoryKind> = {
  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/const_eval/machine.rs:199 may_leak
  may_leak(self: MemoryKind): boolean {
    switch (self.$) {
      case "Heap":
        return self.was_made_global;
    }
  },
};

// impl interpret::MayLeak for !
export const MayLeak_never: MayLeak<never> = {
  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/const_eval/machine.rs:208 may_leak
  may_leak(self: never): boolean {
    // `self` is uninhabited
    return self;
  },
};

// rustc: compiler/rustc_const_eval/src/const_eval/machine.rs:215 location_triple_for_span
InterpCx.prototype.location_triple_for_span = function (this: CompileTimeInterpCx, span: Span): [Symbol, number, number] {
  const topmost = SyntaxContext.outer_expn(Span.ctxt(span)).expansion_cause() ?? span;
  const caller = this.tcx.tcx.sess.source_map().lookup_char_pos(Span.lo(topmost));

  // use rustc_span::RemapPathScopeComponents;
  // PORT: `u32::try_from(..).unwrap()` of `usize` line / column numbers (always below 2^32 here).
  return [Symbol.intern(FileName.display(caller.file.name, RemapPathScopeComponents.DIAGNOSTICS).to_string_lossy()), caller.line, caller.col_display + 1];
};

/// "Intercept" a function call, because we have something special to do for it.
/// All `#[rustc_do_not_const_check]` functions MUST be hooked here.
/// If this returns `Some` function, which may be `instance` or a different function with
/// compatible arguments, then evaluation should continue with that function.
/// If this returns `None`, the function call has been handled and the function has returned.
// rustc: compiler/rustc_const_eval/src/const_eval/machine.rs:234 hook_special_const_fn
InterpCx.prototype.hook_special_const_fn = function (
  this: CompileTimeInterpCx,
  instance: Instance,
  args_: readonly FnArg[],
  _dest: PlaceTy,
  _ret: BasicBlock | undefined,
): InterpResult<Instance | undefined> {
  const def_id = Instance.def_id(instance);

  if (this.tcx.tcx.is_lang_item(def_id, LangItem.PanicDisplay) || this.tcx.tcx.is_lang_item(def_id, LangItem.BeginPanic)) {
    const args = this.copy_fn_args(args_);
    // &str or &&str
    assert(args.length === 1, "assertion failed: args.len() == 1");

    const mp = this.deref_pointer(args[0]!);
    if (mp.$ === "Err") return mp;
    let msg_place = mp._0;
    while (msg_place.layout.ty.is_ref()) {
      const r = this.deref_pointer(msg_place);
      if (r.$ === "Err") return r;
      msg_place = r._0;
    }

    const s = this.read_str(msg_place);
    if (s.$ === "Err") return s;
    const msg = Symbol.intern(s._0);
    const span = this.find_closest_untracked_caller_location();
    const [file, line, col] = this.location_triple_for_span(span);
    return Err(ConstEvalErrKind_into_InterpErrorInfo({ $: "Panic", msg, file, line, col }));
  } else if (this.tcx.tcx.is_lang_item(def_id, LangItem.PanicFmt)) {
    // For panic_fmt, call const_panic_fmt instead.
    const const_def_id = this.tcx.tcx.require_lang_item(LangItem.ConstPanicFmt, this.tcx.span);
    const new_instance = Instance.expect_resolve(this.tcx.tcx, this.typing_env_(), const_def_id, instance.args, this.cur_span());

    return interp_ok(new_instance);
  }
  return interp_ok(instance);
};

/// See documentation on the `ptr_guaranteed_cmp` intrinsic.
/// Returns `2` if the result is unknown.
/// Returns `1` if the pointers are guaranteed equal.
/// Returns `0` if the pointers are guaranteed inequal.
///
/// Note that this intrinsic is exposed on stable for comparison with null. In other words, any
/// change to this function that affects comparison with null is insta-stable!
// rustc: compiler/rustc_const_eval/src/const_eval/machine.rs:282 guaranteed_cmp
InterpCx.prototype.guaranteed_cmp = function (this: CompileTimeInterpCx, a: Scalar, b: Scalar): InterpResult<number> {
  // Comparisons between integers are always known.
  if (a.$ === "Int" && b.$ === "Int") {
    return interp_ok(ScalarInt_eq(a._0, b._0) ? 1 : 0);
  }
  // Comparing a pointer `ptr` with an integer `int` is equivalent to comparing
  // `ptr-int` with null, so we can reduce this case to a `scalar_may_be_null` test.
  if ((a.$ === "Int" && b.$ === "Ptr") || (a.$ === "Ptr" && b.$ === "Int")) {
    const [int_, ptr] = a.$ === "Int" && b.$ === "Ptr" ? [a._0, b._0] : a.$ === "Ptr" && b.$ === "Int" ? [b._0, a._0] : unreachable();
    const int = int_.to_target_usize(this.tcx.tcx);
    // The `wrapping_neg` here may produce a value that is not
    // a valid target usize any more... but `wrapping_offset` handles that correctly.
    // PORT: `u64::wrapping_neg`.
    const offset_ptr = ptr.wrapping_offset(Size.from_bytes(BigInt.asUintN(64, -int)), this);
    const m = this.scalar_may_be_null(Scalar.from_pointer(offset_ptr, this));
    if (m.$ === "Err") return m;
    if (!m._0) {
      // `ptr.wrapping_sub(int)` is definitely not equal to `0`, so `ptr != int`
      return interp_ok(0);
    } else {
      // `ptr.wrapping_sub(int)` could be equal to `0`, but might not be,
      // so we cannot know for sure if `ptr == int` or not
      return interp_ok(2);
    }
  }
  if (a.$ !== "Ptr" || b.$ !== "Ptr") return unreachable();
  // (Scalar::Ptr(a, _), Scalar::Ptr(b, _))
  const a_ptr = a._0;
  const b_ptr = b._0;
  const [a_prov, a_offset] = a_ptr.prov_and_relative_offset();
  const [b_prov, b_offset] = b_ptr.prov_and_relative_offset();
  const a_allocid = CtfeProvenance.alloc_id(a_prov);
  const b_allocid = CtfeProvenance.alloc_id(b_prov);
  const a_info = this.get_alloc_info(a_allocid);
  const b_info = this.get_alloc_info(b_allocid);

  // Check if the pointers cannot be equal due to alignment
  if (a_info.align.bytes() > Align.ONE.bytes() && b_info.align.bytes() > Align.ONE.bytes()) {
    const min_align = Math.min(a_info.align.bytes(), b_info.align.bytes());
    const a_residue = a_offset.bytes() % min_align;
    const b_residue = b_offset.bytes() % min_align;
    if (a_residue !== b_residue) {
      // If the two pointers have a different residue modulo their
      // common alignment, they cannot be equal.
      return interp_ok(0);
    }
    // The pointers have the same residue modulo their common alignment,
    // so they could be equal. Try the other checks.
  }

  const a_global = this.tcx.tcx.try_get_global_alloc(a_allocid);
  const b_global = this.tcx.tcx.try_get_global_alloc(b_allocid);
  if (a_global?.$ === "Static" && b_global?.$ === "Static") {
    if (a_allocid === b_allocid) {
      // debug_assert_eq!(a_did, b_did, "different static item DefIds had same AllocId? {a_allocid:?} == {b_allocid:?}, {a_did:?} != {b_did:?}");
      // Comparing two pointers into the same static. As per
      // https://doc.rust-lang.org/nightly/reference/items/static-items.html#r-items.static.intro
      // a static cannot be duplicated, so if two pointers are into the same
      // static, they are equal if and only if their offsets are equal.
      return interp_ok(a_offset.bytes() === b_offset.bytes() ? 1 : 0);
    } else {
      // debug_assert_ne!(a_did, b_did, "same static item DefId had two different AllocIds? {a_allocid:?} != {b_allocid:?}, {a_did:?} == {b_did:?}");
      // Comparing two pointers into the different statics.
      // We can never determine for sure that two pointers into different statics
      // are *equal*, but we can know that they are *inequal* if they are both
      // strictly in-bounds (i.e. in-bounds and not one-past-the-end) of
      // their respective static, as different non-zero-sized statics cannot
      // overlap or be deduplicated as per
      // https://doc.rust-lang.org/nightly/reference/items/static-items.html#r-items.static.intro
      // (non-deduplication), and
      // https://doc.rust-lang.org/nightly/reference/items/static-items.html#r-items.static.storage-disjointness
      // (non-overlapping).
      if (a_offset.bytes() < a_info.size.bytes() && b_offset.bytes() < b_info.size.bytes()) {
        return interp_ok(0);
      } else {
        // Otherwise, conservatively say we don't know.
        // There are some cases we could still return `0` for, e.g.
        // if the pointers being equal would require their statics to overlap
        // one or more bytes, but for simplicity we currently only check
        // strictly in-bounds pointers.
        return interp_ok(2);
      }
    }
  } else {
    // All other cases we conservatively say we don't know.
    //
    // For comparing statics to non-statics, as per https://doc.rust-lang.org/nightly/reference/items/static-items.html#r-items.static.storage-disjointness
    // immutable statics can overlap with other kinds of allocations sometimes.
    //
    // FIXME: We could be more decisive for (non-zero-sized) mutable statics,
    // which cannot overlap with other kinds of allocations.
    //
    // Functions and vtables can be duplicated and deduplicated, so we
    // cannot be sure of runtime equality of pointers to the same one, or the
    // runtime inequality of pointers to different ones (see e.g. #73722),
    // so comparing those should return 2, whether they are the same allocation
    // or not.
    //
    // `GlobalAlloc::TypeId` exists mostly to prevent consteval from comparing
    // `TypeId`s, so comparing those should always return 2, whether they are the
    // same allocation or not.
    //
    // FIXME: We could revisit comparing pointers into the same
    // `GlobalAlloc::Memory` once https://github.com/rust-lang/rust/issues/128775
    // is fixed (but they can be deduplicated, so comparing pointers into different
    // ones should return 2).
    return interp_ok(2);
  }
};
