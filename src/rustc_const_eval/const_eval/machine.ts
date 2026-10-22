// Port of compiler/rustc_const_eval/src/const_eval/machine.rs: DECLARED (lane interp-contract, plan-m4 wave 23b). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// ctfe-b; docs/handoff/interp-contract.md has the split table, the conventions and "How to fill a stub"
// (interpret/eval_context.ts's header has the representation notes).
import { CanAccessMutGlobal, CheckAlignment, type MemoryKind } from "./machine.gen.ts";

export * from "./machine.gen.ts";
import { FnArg } from "../interpret/call.ts";
import { InterpCx } from "../interpret/eval_context.ts";
import { AllocMap_provided, compile_time_machine, type MayLeak, RetagMode, type CtfeMemoryKind, type Machine } from "../interpret/machine.ts";
import type { HasStaticRootDefId } from "../interpret/intern.ts";
import type { LocalDefId } from "../../rustc_span/def_id.ts";
import { bug } from "../../rustc_span/macros.ts";
import { type RangeSet } from "../interpret/validity.ts";
import { type HirId } from "../../rustc_hir_id/lib.ts";
import { type AllocId, type AllocRange, type ConstAllocation, type CtfeProvenance, type InterpResult, type Pointer, type Scalar } from "../../rustc_middle/mir/interpret/mod.ts";
import { type AssertMessage, type BasicBlock, type BinOp, type Body, type RuntimeChecks, type UnwindAction } from "../../rustc_middle/mir/mod.ts";
import { type TyCtxtAt } from "../../rustc_middle/query/calls.ts";
import { type TyCtxt } from "../../rustc_middle/ty/context.ts";
import { type FnAbi } from "../../rustc_middle/ty/decls.ts";
import { type Instance, type InstanceKind } from "../../rustc_middle/ty/instance.ts";
import { type TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { type Ty } from "../../rustc_middle/ty/mod.ts";
import { type DefId } from "../../rustc_span/def_id.ts";
import { type Span } from "../../rustc_span/lib.ts";
import { type Symbol } from "../../rustc_span/symbol.ts";
import { type Fmt } from "../../std/fmt.ts";
import { unported } from "../../std/panic.ts";
import { Ok, type Result } from "../../std/result.ts";
import { ImmTy, OpTy } from "../interpret/operand.gen.ts";
import { PlaceTy } from "../interpret/place.gen.ts";
import { Frame } from "../interpret/stack.gen.ts";

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
  // stub: compiler/rustc_const_eval/src/interpret/intern.rs:53 static_def_id (lane interp-validity-intern)
  static_def_id(): LocalDefId | undefined {
    return unported("rustc_const_eval::interpret::intern::CompileTimeMachine::static_def_id");
  }

  // ---- impl<'tcx> interpret::Machine<'tcx> for CompileTimeMachine<'tcx> ----
  // const PANIC_ON_ALLOC_FAIL: bool = false; // will be raised as a proper error
  readonly PANIC_ON_ALLOC_FAIL: boolean = false;

  // stub: compiler/rustc_const_eval/src/const_eval/machine.rs:398 best_lint_scope (lane ctfe-b)
  best_lint_scope(tcx: TyCtxt): HirId {
    return unported("rustc_const_eval::const_eval::machine::CompileTimeMachine::best_lint_scope");
  }

  // stub: compiler/rustc_const_eval/src/const_eval/machine.rs:409 enforce_alignment (lane ctfe-b)
  enforce_alignment(ecx: InterpCx): boolean {
    return unported("rustc_const_eval::const_eval::machine::CompileTimeMachine::enforce_alignment");
  }

  // stub: compiler/rustc_const_eval/src/const_eval/machine.rs:414 enforce_validity (lane ctfe-b)
  enforce_validity(ecx: InterpCx, layout: TyAndLayout): boolean {
    return unported("rustc_const_eval::const_eval::machine::CompileTimeMachine::enforce_validity");
  }

  // stub: compiler/rustc_const_eval/src/const_eval/machine.rs:418 load_mir (lane ctfe-b)
  override load_mir(ecx: InterpCx, instance: InstanceKind): Body {
    return unported("rustc_const_eval::const_eval::machine::CompileTimeMachine::load_mir");
  }

  // stub: compiler/rustc_const_eval/src/const_eval/machine.rs:428 find_mir_or_eval_fn (lane ctfe-b)
  find_mir_or_eval_fn(ecx: InterpCx, orig_instance: Instance, _abi: FnAbi<Ty>, args: readonly FnArg[], dest: PlaceTy, ret: BasicBlock | undefined, _unwind: UnwindAction): InterpResult<[Body, Instance] | undefined> {
    return unported("rustc_const_eval::const_eval::machine::CompileTimeMachine::find_mir_or_eval_fn");
  }

  // stub: compiler/rustc_const_eval/src/const_eval/machine.rs:471 panic_nounwind (lane ctfe-b)
  panic_nounwind(ecx: InterpCx, msg: string): InterpResult {
    return unported("rustc_const_eval::const_eval::machine::CompileTimeMachine::panic_nounwind");
  }

  // stub: compiler/rustc_const_eval/src/const_eval/machine.rs:478 call_intrinsic (lane ctfe-b)
  call_intrinsic(ecx: InterpCx, instance: Instance, args: readonly OpTy[], dest: PlaceTy, target: BasicBlock | undefined, _unwind: UnwindAction): InterpResult<Instance | undefined> {
    return unported("rustc_const_eval::const_eval::machine::CompileTimeMachine::call_intrinsic");
  }

  // stub: compiler/rustc_const_eval/src/const_eval/machine.rs:936 call_llvm_intrinsic (lane ctfe-b)
  call_llvm_intrinsic(ecx: InterpCx, instance: Instance, _args: readonly OpTy[], _dest: PlaceTy, _target: BasicBlock | undefined): InterpResult {
    return unported("rustc_const_eval::const_eval::machine::CompileTimeMachine::call_llvm_intrinsic");
  }

  // stub: compiler/rustc_const_eval/src/const_eval/machine.rs:948 assert_panic (lane ctfe-b)
  assert_panic(ecx: InterpCx, msg: AssertMessage, _unwind: UnwindAction): InterpResult {
    return unported("rustc_const_eval::const_eval::machine::CompileTimeMachine::assert_panic");
  }

  // stub: compiler/rustc_const_eval/src/const_eval/machine.rs:982 runtime_checks (lane ctfe-b)
  runtime_checks(_ecx: InterpCx, _r: RuntimeChecks): InterpResult<boolean> {
    return unported("rustc_const_eval::const_eval::machine::CompileTimeMachine::runtime_checks");
  }

  // stub: compiler/rustc_const_eval/src/const_eval/machine.rs:991 binary_ptr_op (lane ctfe-b)
  binary_ptr_op(_ecx: InterpCx, _bin_op: BinOp, _left: ImmTy, _right: ImmTy): InterpResult<ImmTy> {
    return unported("rustc_const_eval::const_eval::machine::CompileTimeMachine::binary_ptr_op");
  }

  // stub: compiler/rustc_const_eval/src/const_eval/machine.rs:1000 increment_const_eval_counter (lane ctfe-b)
  override increment_const_eval_counter(ecx: InterpCx): InterpResult {
    return unported("rustc_const_eval::const_eval::machine::CompileTimeMachine::increment_const_eval_counter");
  }

  // stub: compiler/rustc_const_eval/src/const_eval/machine.rs:1059 expose_provenance (lane ctfe-b)
  expose_provenance(_ecx: InterpCx, _provenance: CtfeProvenance): InterpResult {
    return unported("rustc_const_eval::const_eval::machine::CompileTimeMachine::expose_provenance");
  }

  // stub: compiler/rustc_const_eval/src/const_eval/machine.rs:1068 init_frame (lane ctfe-b)
  init_frame(ecx: InterpCx, frame: Frame): InterpResult<Frame> {
    return unported("rustc_const_eval::const_eval::machine::CompileTimeMachine::init_frame");
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

  // stub: compiler/rustc_const_eval/src/const_eval/machine.rs:1094 before_access_global (lane ctfe-b)
  override before_access_global(_tcx: TyCtxtAt, machine: CompileTimeMachine, alloc_id: AllocId, alloc: ConstAllocation, _static_def_id: DefId | undefined, is_write: boolean): InterpResult {
    return unported("rustc_const_eval::const_eval::machine::CompileTimeMachine::before_access_global");
  }

  // stub: compiler/rustc_const_eval/src/const_eval/machine.rs:1126 retag_ptr_value (lane ctfe-b)
  override retag_ptr_value(ecx: InterpCx, val: ImmTy, _ty: Ty): InterpResult<ImmTy | undefined> {
    return unported("rustc_const_eval::const_eval::machine::CompileTimeMachine::retag_ptr_value");
  }

  // stub: compiler/rustc_const_eval/src/const_eval/machine.rs:1158 with_retag_mode (lane ctfe-b)
  override with_retag_mode<T>(ecx: InterpCx, mode: RetagMode, f: (a0: InterpCx) => InterpResult<T>): InterpResult<T> {
    return unported("rustc_const_eval::const_eval::machine::CompileTimeMachine::with_retag_mode");
  }

  // stub: compiler/rustc_const_eval/src/const_eval/machine.rs:1169 before_memory_write (lane ctfe-b)
  override before_memory_write(_tcx: TyCtxtAt, _machine: CompileTimeMachine, _alloc_extra: null, _ptr: Pointer<CtfeProvenance | undefined>, _4: [AllocId, boolean], range: AllocRange): InterpResult {
    return unported("rustc_const_eval::const_eval::machine::CompileTimeMachine::before_memory_write");
  }

  // stub: compiler/rustc_const_eval/src/const_eval/machine.rs:1189 before_alloc_access (lane ctfe-b)
  override before_alloc_access(tcx: TyCtxtAt, machine: CompileTimeMachine, alloc_id: AllocId): InterpResult {
    return unported("rustc_const_eval::const_eval::machine::CompileTimeMachine::before_alloc_access");
  }

  // stub: compiler/rustc_const_eval/src/const_eval/machine.rs:1215 cached_union_data_range (lane ctfe-b)
  override cached_union_data_range(ecx: InterpCx, ty: Ty, compute_range: () => RangeSet): RangeSet {
    return unported("rustc_const_eval::const_eval::machine::CompileTimeMachine::cached_union_data_range");
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
// stub: compiler/rustc_const_eval/src/const_eval/machine.rs:188 fmt (lane ctfe-b)
export function display_MemoryKind(self: MemoryKind, f: Fmt): string {
  return unported("rustc_const_eval::const_eval::machine::MemoryKind::fmt");
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

// stub: compiler/rustc_const_eval/src/const_eval/machine.rs:215 location_triple_for_span (lane ctfe-b)
InterpCx.prototype.location_triple_for_span = function (this: CompileTimeInterpCx, span: Span): [Symbol, number, number] {
  return unported("rustc_const_eval::const_eval::machine::InterpCx::location_triple_for_span");
};

// stub: compiler/rustc_const_eval/src/const_eval/machine.rs:234 hook_special_const_fn (lane ctfe-b)
InterpCx.prototype.hook_special_const_fn = function (this: CompileTimeInterpCx, instance: Instance, args: readonly FnArg[], _dest: PlaceTy, _ret: BasicBlock | undefined): InterpResult<Instance | undefined> {
  return unported("rustc_const_eval::const_eval::machine::InterpCx::hook_special_const_fn");
};

// stub: compiler/rustc_const_eval/src/const_eval/machine.rs:282 guaranteed_cmp (lane ctfe-b)
InterpCx.prototype.guaranteed_cmp = function (this: CompileTimeInterpCx, a: Scalar, b: Scalar): InterpResult<number> {
  return unported("rustc_const_eval::const_eval::machine::InterpCx::guaranteed_cmp");
};
