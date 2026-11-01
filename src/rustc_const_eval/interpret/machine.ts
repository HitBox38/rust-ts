//! This module contains everything needed to instantiate an interpreter.
//! This separation exists to ensure that no fancy miri features like
//! interpreting common C functions leak into CTFE.
// Port of compiler/rustc_const_eval/src/interpret/machine.rs (lane interp-contract, plan-m4 D8). Its types are generated
// into machine.gen.ts (set rustc_const_eval_interpret).
// PORT (D8):
// - `trait Machine<'tcx>` is the TS interface `Machine`, implemented by the classes `CompileTimeMachine`
//   (const_eval/machine.ts) and `DummyMachine` (const_eval/dummy_machine.ts). Its fns are associated fns of the machine
//   *type* (`M::enforce_alignment(ecx)`); a TS machine is an instance, so they are methods of the machine object, called
//   through the interpreter's own machine: `M::f(ecx, ..)` is `ecx.machine.f(ecx, ..)` and `M::CONST` is
//   `ecx.machine.CONST` (associated consts are readonly members). Upstream parameters are kept (`ecx`, `machine: &Self`).
// - The provided fns live in the base class `Machine_provided` (PORTING §8); the `compile_time_machine!` macro is the
//   abstract class `compile_time_machine` (extending `Machine_provided<CtfeMachineTypes>`) that both CTFE machines
//   extend. The macro's associated types are `CtfeMachineTypes` below.
// - Associated types (plan-m6 D3, lane interp-generic): `Machine<T>` takes the record `T extends MachineTypes` of its
//   associated types (`T["Provenance"]` is `Self::Provenance`, ...), defaulting to the CTFE machines'
//   (`compile_time_machine!`, `CtfeMachineTypes`): `Provenance = CtfeProvenance`, `ProvenanceExtra = bool`, `ExtraFnVal
//   = !` (`never`), `MemoryKind = const_eval::MemoryKind` (`CtfeMemoryKind`), `MemoryMap = FxIndexMap<AllocId,
//   (MemoryKind<..>, Allocation)>` (`CtfeMemoryMap`, the `AllocMap` impl of const_eval/machine.ts), `AllocExtra = ()` /
//   `FrameExtra = ()` (`null`), `Bytes = Box<[u8]>` (`Uint8Array`, `AllocParams = ()`: `null`). The interpreter's types
//   take the provenance as a type parameter with upstream's default (`MPlaceTy<Prov = CtfeProvenance>`, `Frame<Prov,
//   Extra>`, `Allocation<Prov, Extra, Bytes>`; `MachineFrame<T>` / `MachineAllocation<T>` name a machine's), and
//   `InterpCx<M>` / `Memory<M>` read a machine's record with `MachineTypesOf<M>`. Where upstream dispatches statically on
//   an associated type, the machine carries the impl as a member (`M::Provenance::OFFSET_IS_ADDR` is
//   `ecx.machine.Provenance.OFFSET_IS_ADDR`, `M::Bytes: AllocBytes` is `ecx.machine.Bytes`, `kind.may_leak()` / `{kind}` /
//   `==` of a `MemoryKind<M::MemoryKind>` use `ecx.machine.MayLeak_MemoryKind` / `display_MemoryKind` / `MemoryKind_eq`), set by
//   `compile_time_machine` for CTFE. A second machine (Miri) implements `Machine<ItsTypes>`; the interpreter's method
//   bodies stay typed with the CTFE defaults (their values are dispatched through the machine at run time), so a
//   generic caller passes its values through the `InterpCx<M>` signatures.
// - Generic float fns (`F: Float`) take the `FloatType` dictionary of the type they construct (precedent
//   `ScalarInt::to_float`): `generate_nan::<F1, F2>(ecx, inputs)` is `generate_nan(ecx, inputs, F2_)`.
// - `enter_trace_span` (tracing, not ported) returns `()` (`undefined`), the `EnteredTraceSpan` impl of tracing being
//   disabled; the `enter_trace_span!(M, ..)` macro calls in the interpreter are comments.
// - `trait MayLeak` is a table over the value (`MayLeak<T>.may_leak(self)`), implemented for the memory kinds;
//   `trait AllocMap` is an interface (its provided `get` / `get_mut` in `AllocMap_provided`).
import { type Align, Size } from "../../rustc_abi/lib.ts";
import type { Float, FloatType } from "../../vendor/rustc_apfloat/lib.ts";
import type { TyCtxtAt } from "../../rustc_middle/query/calls.ts";
import type { TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import type { AtomicOrdering } from "../../rustc_middle/ty/consts/int.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import type { Instance, InstanceKind } from "../../rustc_middle/ty/instance.ts";
import type { AssertMessage, BasicBlock, BinOp, Body, Local, RuntimeChecks, UnwindAction, UnwindTerminateReason } from "../../rustc_middle/mir/mod.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import type { FnAbi } from "../../rustc_middle/ty/decls.ts";
import {
  type AllocId,
  type AllocRange,
  type Allocation,
  type ConstAllocation,
  type CtfeProvenance,
  type Provenance,
  Provenance_CtfeProvenance,
  type AllocBytes,
  AllocBytes_Box,
  CTFE_ALLOC_SALT,
  CtfeProvenance as CtfeProvenanceC,
  InterpErrorInfo_from_InterpErrorKind,
  type InterpResult,
  interp_ok,
  type Misalignment,
  Pointer,
  Scalar,
  CtfeProvenance_from_AllocId,
} from "../../rustc_middle/mir/interpret/mod.ts";
import type { Fmt } from "../../std/fmt.ts";
import { assert, unreachable } from "../../std/panic.ts";
import { Err, type Result } from "../../std/result.ts";
import type { InterpCx } from "./eval_context.ts";
import type { FnArg } from "./call.gen.ts";
import type { AllocKind, MemoryKind } from "./memory.gen.ts";
import type { ImmTy, OpTy } from "./operand.gen.ts";
import type { MPlaceTy, PlaceTy } from "./place.gen.ts";
import type { Frame } from "./stack.gen.ts";
import type { AtomicRmwOp } from "./operator.gen.ts";
import type { RangeSet } from "./validity.gen.ts";
import type { EnteredTraceSpan } from "./util.ts";
import { type RetagMode, ReturnAction } from "./machine.gen.ts";
import type { MemoryKind as const_eval_MemoryKind } from "../const_eval/machine.gen.ts";

export * from "./machine.gen.ts";

/** PORT (D8): `M::MemoryKind` of the CTFE machines (`compile_time_machine!`: `$crate::const_eval::MemoryKind`). */
export type CtfeMemoryKind = const_eval_MemoryKind;
/** PORT (D8): `M::MemoryMap` of the CTFE machines (`FxIndexMap<AllocId, (MemoryKind<Self::MemoryKind>, Allocation)>`). */
export type CtfeMemoryMap = AllocMap<AllocId, [MemoryKind<CtfeMemoryKind>, Allocation]>;

/**
 * PORT (plan-m6 D3): the associated types of a `Machine` impl, as a type-level record (header). Each member is the
 * associated type of the same name (`AllocParams` is `<Self::Bytes as AllocBytes>::AllocParams`).
 */
export interface MachineTypes {
  /// Additional memory kinds a machine wishes to distinguish from the builtin ones
  MemoryKind: unknown;
  /// Pointers are "tagged" with provenance information; typically the `AllocId` they belong to.
  Provenance: unknown;
  /// When getting the AllocId of a pointer, some extra data is also obtained from the provenance
  /// that is passed to memory access hooks so they can do things with it.
  ProvenanceExtra: unknown;
  /// Machines can define extra (non-instance) things that represent values of function pointers.
  /// For example, Miri uses this to return a function pointer from `dlsym`
  /// that can later be called to execute the right thing.
  ExtraFnVal: unknown;
  /// Extra data stored in every call frame.
  FrameExtra: unknown;
  /// Extra data stored in every allocation.
  AllocExtra: unknown;
  /// Type for the bytes of the allocation.
  Bytes: unknown;
  /** `<Self::Bytes as AllocBytes>::AllocParams` */
  AllocParams: unknown;
  /// Memory's allocation map
  MemoryMap: AllocMap<AllocId, [MemoryKind<any>, Allocation<any, any, any>]>;
}

/** PORT (plan-m6 D3): the associated types of the CTFE machines (`compile_time_machine!`, header). */
export interface CtfeMachineTypes extends MachineTypes {
  MemoryKind: CtfeMemoryKind;
  Provenance: CtfeProvenance;
  /// We use the immutable flag as the provenance extra.
  ProvenanceExtra: boolean;
  ExtraFnVal: never;
  FrameExtra: null;
  AllocExtra: null;
  Bytes: Uint8Array;
  AllocParams: null;
  MemoryMap: CtfeMemoryMap;
}

/** PORT (plan-m6 D3): the bound `M: Machine<'tcx>` of a machine type parameter (any machine's associated types). */
// biome-ignore lint: `any` is the existential over the associated types (`M: Machine<'tcx>`).
export type AnyMachine = Machine<any>;
/** PORT (plan-m6 D3): the associated-type record of a machine type `M` (`M::X` is `MachineTypesOf<M>["X"]`). */
/// (`InterpCx.prototype` is an `InterpCx<any>`: its methods' types are `any`-typed, so the hand impls, typed with the CTFE
/// defaults, can be assigned to it.)
export type MachineTypesOf<M> = 0 extends 1 & M ? AnyMachineTypes : M extends Machine<infer T> ? T : never;
/** The associated types of `AnyMachine` (each `any`). */
// biome-ignore lint: see `AnyMachine`.
type AnyMachineTypes = { [K in keyof MachineTypes]: any };
/** PORT (plan-m6 D3): `M::Provenance` of a machine type `M`. */
export type ProvOf<M> = MachineTypesOf<M>["Provenance"];
/** PORT (plan-m6 D3): `Frame<'tcx, M::Provenance, M::FrameExtra>` of a machine's associated types. */
export type MachineFrame<T extends MachineTypes> = Frame<T["Provenance"], T["FrameExtra"]>;
/** PORT (plan-m6 D3): `Allocation<M::Provenance, M::AllocExtra, M::Bytes>` of a machine's associated types. */
export type MachineAllocation<T extends MachineTypes> = Allocation<T["Provenance"], T["AllocExtra"], T["Bytes"]>;

/**
 * PORT (plan-m6 D3/A1): `std::borrow::Cow<'a, T>` (the result of `adjust_global_allocation` / `get_global_alloc`): a
 * `Borrowed` reference or an `Owned` value, tagged by `$`.
 */
export type Cow<T> = { readonly $: "Borrowed"; _0: T } | { readonly $: "Owned"; _0: T };
export const Cow = {
  Borrowed<T>(v: T): Cow<T> {
    return { $: "Borrowed", _0: v };
  },
  Owned<T>(v: T): Cow<T> {
    return { $: "Owned", _0: v };
  },
};

/// Whether this kind of memory is allowed to leak
// pub trait MayLeak: Copy
// PORT: an impl table over the value (header).
export interface MayLeak<T> {
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:61 may_leak
  may_leak(self: T): boolean;
}

/// The functionality needed by memory to manage its allocations
// pub trait AllocMap<K: Hash + Eq, V>
// PORT: `Q: ?Sized + Hash + Eq where K: Borrow<Q>` is `K` (every caller looks up by `AllocId`); `&V` / `&mut V` are the
// stored value (a mutable tuple).
export interface AllocMap<K, V> {
  /// Tests if the map contains the given key.
  /// Deliberately takes `&mut` because that is sufficient, and some implementations
  /// can be more efficient then (using `RefCell::get_mut`).
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:69 contains_key
  contains_key(k: K): boolean;

  /// Callers should prefer [`AllocMap::contains_key`] when it is possible to call because it may
  /// be more efficient. This function exists for callers that only have a shared reference
  /// (which might make it slightly less efficient than `contains_key`, e.g. if
  /// the data is stored inside a `RefCell`).
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:77 contains_key_ref
  contains_key_ref(k: K): boolean;

  /// Inserts a new entry into the map.
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:82 insert
  insert(k: K, v: V): V | undefined;

  /// Removes an entry from the map.
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:85 remove
  remove(k: K): V | undefined;

  /// Returns data based on the keys and values in the map.
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:90 filter_map_collect
  filter_map_collect<T>(f: (k: K, v: V) => T | undefined): T[];

  /// Returns a reference to entry `k`. If no such entry exists, call
  /// `vacant` and either forward its error, or add its result to the map
  /// and return a reference to *that*.
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:95 get_or
  get_or<E>(k: K, vacant: () => Result<V, E>): Result<V, E>;

  /// Returns a mutable reference to entry `k`. If no such entry exists, call
  /// `vacant` and either forward its error, or add its result to the map
  /// and return a reference to *that*.
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:100 get_mut_or
  get_mut_or<E>(k: K, vacant: () => Result<V, E>): Result<V, E>;

  /// Read-only lookup.
  get(k: K): V | undefined; // (provided)

  /// Mutable lookup.
  get_mut(k: K): V | undefined; // (provided)
}

/** PORT: the provided methods of `AllocMap` (PORTING §8): a base class of the implementors. */
export abstract class AllocMap_provided<K, V> implements AllocMap<K, V> {
  abstract contains_key(k: K): boolean;
  abstract contains_key_ref(k: K): boolean;
  abstract insert(k: K, v: V): V | undefined;
  abstract remove(k: K): V | undefined;
  abstract filter_map_collect<T>(f: (k: K, v: V) => T | undefined): T[];
  abstract get_or<E>(k: K, vacant: () => Result<V, E>): Result<V, E>;
  abstract get_mut_or<E>(k: K, vacant: () => Result<V, E>): Result<V, E>;

  /// Read-only lookup.
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:103 get
  get(k: K): V | undefined {
    const r = this.get_or<null>(k, () => Err(null));
    return r.$ === "Ok" ? r._0 : undefined;
  }

  /// Mutable lookup.
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:108 get_mut
  get_mut(k: K): V | undefined {
    const r = this.get_mut_or<null>(k, () => Err(null));
    return r.$ === "Ok" ? r._0 : undefined;
  }
}

/// Methods of this trait signifies a point where CTFE evaluation would fail
/// and some use case dependent behaviour can instead be applied.
// pub trait Machine<'tcx>: Sized
// PORT (D8, plan-m6 D3): the associated types are the record `T` (header); `(provided)` members are implemented by
// `Machine_provided`.
export interface Machine<T extends MachineTypes = CtfeMachineTypes> {
  /** PORT (plan-m6 D3): type-level only (never set): the machine's associated types, read by `MachineTypesOf<M>`. */
  readonly __types?: T;

  /// Additional memory kinds a machine wishes to distinguish from the builtin ones
  // type MemoryKind: Debug + std::fmt::Display + MayLeak + Eq + 'static;
  /** PORT (plan-m6 D3): the `MayLeak` impl of `Self::MemoryKind` (`kind.may_leak()` of a `MemoryKind<M::MemoryKind>`). */
  readonly MayLeak_MemoryKind: MayLeak<T["MemoryKind"]>;
  /** PORT (plan-m6 D3): the `Display` impl of `Self::MemoryKind` (`{kind}` of a `MemoryKind<M::MemoryKind>`). */
  readonly display_MemoryKind: (self: T["MemoryKind"], f: Fmt) => string;
  /** PORT (plan-m6 D3): the `Eq` impl of `Self::MemoryKind` (`==` on a `MemoryKind<M::MemoryKind>`). Its `Debug` impl is
   *  not a member: the interpreter prints it only in `trace!` (not ported). */
  readonly MemoryKind_eq: (a: T["MemoryKind"], b: T["MemoryKind"]) => boolean;

  /// Pointers are "tagged" with provenance information; typically the `AllocId` they belong to.
  // type Provenance: Provenance + Eq + Hash + 'static;
  /** PORT (plan-m6 D3): the `Provenance` impl of `Self::Provenance` (`M::Provenance::OFFSET_IS_ADDR` is
   *  `ecx.machine.Provenance.OFFSET_IS_ADDR`). */
  readonly Provenance: Provenance<T["Provenance"]>;

  /// Type for the bytes of the allocation.
  // type Bytes: AllocBytes + 'static;
  /** PORT (plan-m6 D3): the `AllocBytes` impl of `Self::Bytes` (the `Allocation` constructors' `Bytes_`). */
  readonly Bytes: AllocBytes<T["Bytes"], T["AllocParams"]>;

  /// Memory's allocation map
  // type MemoryMap: AllocMap<..> + Default + Clone;
  /** PORT (plan-m6 D3): `Self::MemoryMap::default()` (`Memory::new`). */
  MemoryMap_default(): T["MemoryMap"];

  /// The memory kind to use for copied global memory (held in `tcx`) --
  /// or None if such memory should not be mutated and thus any such attempt will cause
  /// a `ModifiedStatic` error to be raised.
  /// Statics are copied under two circumstances: When they are mutated, and when
  /// `adjust_allocation` (see below) returns an owned allocation
  /// that is added to the memory so that the work is not done twice.
  readonly GLOBAL_KIND: T["MemoryKind"] | undefined;

  /// Should the machine panic on allocation failures?
  readonly PANIC_ON_ALLOC_FAIL: boolean;

  /// Determines whether `eval_mir_constant` can never fail because all required consts have
  /// already been checked before.
  readonly ALL_CONSTS_ARE_PRECHECKED: boolean; // (provided: `true`)

  /// Whether memory accesses should be alignment-checked.
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:166 enforce_alignment
  enforce_alignment(ecx: InterpCx<Machine<T>>): boolean;

  /// Gives the machine a chance to detect more misalignment than the built-in checks would catch.
  alignment_check(
    _ecx: InterpCx<Machine<T>>,
    _alloc_id: AllocId,
    _alloc_align: Align,
    _alloc_kind: AllocKind,
    _offset: Size,
    _align: Align,
  ): Misalignment | undefined; // (provided)

  /// Whether to enforce the validity invariant for a specific layout.
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:182 enforce_validity
  enforce_validity(ecx: InterpCx<Machine<T>>, layout: TyAndLayout): boolean;
  /// Whether to enforce the validity invariant *recursively*.
  enforce_validity_recursively(_ecx: InterpCx<Machine<T>>, _layout: TyAndLayout): boolean; // (provided)

  /// Whether Assert(OverflowNeg) and Assert(Overflow) MIR terminators should actually
  /// check for overflow.
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:193 ignore_optional_overflow_checks
  ignore_optional_overflow_checks(_ecx: InterpCx<Machine<T>>): boolean;

  /// Entry point for obtaining the MIR of anything that should get evaluated.
  /// So not just functions and shims, but also const/static initializers, anonymous
  /// constants, ...
  load_mir(ecx: InterpCx<Machine<T>>, instance: InstanceKind): Body; // (provided)

  /// Entry point to all function calls.
  ///
  /// Returns either the mir to use for the call, or `None` if execution should
  /// just proceed (which usually means this hook did all the work that the
  /// called function should usually have done). In the latter case, it is
  /// this hook's responsibility to advance the instruction pointer!
  /// (This is to support functions like `__rust_maybe_catch_panic` that neither find a MIR
  /// nor just jump to `ret`, but instead push their own stack frame.)
  /// Passing `dest`and `ret` in the same `Option` proved very annoying when only one of them
  /// was used.
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:215 find_mir_or_eval_fn
  find_mir_or_eval_fn(
    ecx: InterpCx<Machine<T>>,
    instance: Instance,
    abi: FnAbi<Ty>,
    args: readonly FnArg<T["Provenance"]>[],
    destination: PlaceTy<T["Provenance"]>,
    target: BasicBlock | undefined,
    unwind: UnwindAction,
  ): InterpResult<[Body, Instance] | undefined>;

  /// Execute `fn_val`. It is the hook's responsibility to advance the instruction
  /// pointer as appropriate.
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:227 call_extra_fn
  call_extra_fn(
    ecx: InterpCx<Machine<T>>,
    fn_val: T["ExtraFnVal"],
    abi: FnAbi<Ty>,
    args: readonly FnArg<T["Provenance"]>[],
    destination: PlaceTy<T["Provenance"]>,
    target: BasicBlock | undefined,
    unwind: UnwindAction,
  ): InterpResult;

  /// Directly process an intrinsic without pushing a stack frame. It is the hook's
  /// responsibility to advance the instruction pointer as appropriate.
  ///
  /// Returns `None` if the intrinsic was fully handled.
  /// Otherwise, returns an `Instance` of the function that implements the intrinsic.
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:242 call_intrinsic
  call_intrinsic(
    ecx: InterpCx<Machine<T>>,
    instance: Instance,
    args: readonly OpTy<T["Provenance"]>[],
    destination: PlaceTy<T["Provenance"]>,
    target: BasicBlock | undefined,
    unwind: UnwindAction,
  ): InterpResult<Instance | undefined>;

  /// Directly process an LLVM intrinsic without pushing a stack frame. It is the hook's
  /// responsibility to advance the instruction pointer as appropriate.
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:253 call_llvm_intrinsic
  call_llvm_intrinsic(ecx: InterpCx<Machine<T>>, instance: Instance, args: readonly OpTy<T["Provenance"]>[], destination: PlaceTy<T["Provenance"]>, target: BasicBlock | undefined): InterpResult;

  /// Check whether the given function may be executed on the current machine, in terms of the
  /// target features is requires.
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:263 check_fn_target_features
  check_fn_target_features(_ecx: InterpCx<Machine<T>>, _instance: Instance): InterpResult;

  /// Called to evaluate `Assert` MIR terminators that trigger a panic.
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:269 assert_panic
  assert_panic(ecx: InterpCx<Machine<T>>, msg: AssertMessage, unwind: UnwindAction): InterpResult;

  /// Called to trigger a non-unwinding panic.
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:276 panic_nounwind
  panic_nounwind(_ecx: InterpCx<Machine<T>>, msg: string): InterpResult;

  /// Called when unwinding reached a state where execution should be terminated.
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:279 unwind_terminate
  unwind_terminate(ecx: InterpCx<Machine<T>>, reason: UnwindTerminateReason): InterpResult;

  /// Called for all binary operations where the LHS has pointer type.
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:285 binary_ptr_op
  binary_ptr_op(ecx: InterpCx<Machine<T>>, bin_op: BinOp, left: ImmTy<T["Provenance"]>, right: ImmTy<T["Provenance"]>): InterpResult<ImmTy<T["Provenance"]>>;

  /// Generate the NaN returned by a float operation, given the list of inputs.
  /// (This is all inputs, not just NaN inputs!)
  generate_nan<F1, F2 extends Float<F2>>(_ecx: InterpCx<Machine<T>>, _inputs: readonly F1[], F2_: FloatType<F2>): F2; // (provided)

  /// Apply non-determinism to float operations that do not return a precise result.
  apply_float_nondet(_ecx: InterpCx<Machine<T>>, val: ImmTy<T["Provenance"]>): InterpResult<ImmTy<T["Provenance"]>>; // (provided)

  /// Determines the result of `min`/`max` on floats when the arguments are equal.
  equal_float_min_max<F>(_ecx: InterpCx<Machine<T>>, a: F, _b: F): F; // (provided)

  /// Determines whether the `fmuladd` intrinsics fuse the multiply-add or use separate operations.
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:317 float_fuse_mul_add
  float_fuse_mul_add(ecx: InterpCx<Machine<T>>): boolean;

  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:319 atomic_load
  atomic_load(ecx: InterpCx<Machine<T>>, place: MPlaceTy<T["Provenance"]>, ordering: AtomicOrdering): InterpResult<Scalar<T["Provenance"]>>;

  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:325 atomic_store
  atomic_store(ecx: InterpCx<Machine<T>>, place: MPlaceTy<T["Provenance"]>, val: ImmTy<T["Provenance"]>, ordering: AtomicOrdering): InterpResult;

  /// Returns the old value.
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:333 atomic_rmw
  atomic_rmw(ecx: InterpCx<Machine<T>>, place: MPlaceTy<T["Provenance"]>, op: AtomicRmwOp, operand: ImmTy<T["Provenance"]>, ordering: AtomicOrdering): InterpResult<Scalar<T["Provenance"]>>;

  /// Returns a pair of the old value and a boolean indicating whether the update happened.
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:342 atomic_compare_exchange
  atomic_compare_exchange(
    ecx: InterpCx<Machine<T>>,
    place: MPlaceTy<T["Provenance"]>,
    expected_old: ImmTy<T["Provenance"]>,
    new_: ImmTy<T["Provenance"]>,
    can_fail_spuriously: boolean,
    success_ordering: AtomicOrdering,
    failure_ordering: AtomicOrdering,
  ): InterpResult<[Scalar<T["Provenance"]>, boolean]>;

  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:352 atomic_fence
  atomic_fence(ecx: InterpCx<Machine<T>>, ordering: AtomicOrdering, singlethread: boolean): InterpResult;

  /// Called before a basic block terminator is executed.
  before_terminator(_ecx: InterpCx<Machine<T>>): InterpResult; // (provided)

  /// Determines the result of a `Operand::RuntimeChecks` invocation.
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:365 runtime_checks
  runtime_checks(_ecx: InterpCx<Machine<T>>, r: RuntimeChecks): InterpResult<boolean>;

  /// Called when the interpreter encounters a `StatementKind::ConstEvalCounter` instruction.
  /// You can use this to detect long or endlessly running programs.
  increment_const_eval_counter(_ecx: InterpCx<Machine<T>>): InterpResult; // (provided)

  /// Called before a global allocation is accessed.
  /// `def_id` is `Some` if this is the "lazy" allocation of a static.
  before_access_global(
    _tcx: TyCtxtAt,
    _machine: Machine<T>,
    _alloc_id: AllocId,
    _allocation: ConstAllocation,
    _static_def_id: DefId | undefined,
    _is_write: boolean,
  ): InterpResult; // (provided)

  /// Return the `AllocId` for the given thread-local static in the current thread.
  thread_local_static_pointer(_ecx: InterpCx<Machine<T>>, def_id: DefId): InterpResult<Pointer<T["Provenance"]>>; // (provided)

  /// Return the `AllocId` for the given `extern static`.
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:400 extern_static_pointer
  extern_static_pointer(ecx: InterpCx<Machine<T>>, def_id: DefId): InterpResult<Pointer<T["Provenance"]>>;

  /// "Int-to-pointer cast"
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:406 ptr_from_addr_cast
  ptr_from_addr_cast(ecx: InterpCx<Machine<T>>, addr: bigint): InterpResult<Pointer<T["Provenance"] | undefined>>;

  /// Marks a pointer as exposed, allowing its provenance
  /// to be recovered. "Pointer<T["Provenance"]>-to-int cast"
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:413 expose_provenance
  expose_provenance(ecx: InterpCx<Machine<T>>, provenance: T["Provenance"]): InterpResult;

  /// Convert a pointer with provenance into an allocation-offset pair and extra provenance info.
  /// `size` says how many bytes of memory are expected at that pointer. The *sign* of `size` can
  /// be used to disambiguate situations where a wildcard pointer sits right in between two
  /// allocations.
  ///
  /// If `ptr.provenance.get_alloc_id()` is `Some(p)`, the returned `AllocId` must be `p`.
  /// The resulting `AllocId` will just be used for that one step and the forgotten again
  /// (i.e., we'll never turn the data returned here back into a `Pointer<T["Provenance"]>` that might be
  /// stored in machine state).
  ///
  /// When this fails, that means the pointer does not point to a live allocation.
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:429 ptr_get_alloc
  ptr_get_alloc(ecx: InterpCx<Machine<T>>, ptr: Pointer<T["Provenance"]>, size: bigint): [AllocId, Size, T["ProvenanceExtra"]] | undefined;

  /// Return a "root" pointer for the given allocation: the one that is used for direct
  /// accesses to this static/const/fn allocation, or the one returned from the heap allocator.
  ///
  /// Not called on `extern` or thread-local statics (those use the methods above).
  ///
  /// `kind` is the kind of the allocation the pointer points to; it can be `None` when
  /// it's a global and `GLOBAL_KIND` is `None`.
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:442 adjust_alloc_root_pointer
  adjust_alloc_root_pointer(ecx: InterpCx<Machine<T>>, ptr: Pointer<CtfeProvenance>, kind: MemoryKind<T["MemoryKind"]> | undefined): InterpResult<Pointer<T["Provenance"]>>;

  /// Called to adjust global allocations to the Provenance and AllocExtra of this machine.
  ///
  /// If `alloc` contains pointers, then they are all pointing to globals.
  ///
  /// This should avoid copying if no work has to be done! If this returns an owned
  /// allocation (because a copy had to be done to adjust things), machine memory will
  /// cache the result. (This relies on `AllocMap::get_or` being able to add the
  /// owned allocation to the map even when the map is shared.)
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:456 adjust_global_allocation
  adjust_global_allocation(ecx: InterpCx<Machine<T>>, id: AllocId, alloc: Allocation): InterpResult<Cow<MachineAllocation<T>>>;

  /// Initialize the extra state of an allocation local to this machine.
  ///
  /// This is guaranteed to be called exactly once on all allocations local to this machine.
  /// It will not be called automatically for global allocations; `adjust_global_allocation`
  /// has to do that itself if that is desired.
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:467 init_local_allocation
  init_local_allocation(ecx: InterpCx<Machine<T>>, id: AllocId, kind: MemoryKind<T["MemoryKind"]>, size: Size, align: Align): InterpResult<T["AllocExtra"]>;

  /// Hook for performing extra checks on a memory read access.
  /// `ptr` will always be a pointer with the provenance in `prov` pointing to the beginning of
  /// `range`.
  ///
  /// This will *not* be called during validation!
  ///
  /// Takes read-only access to the allocation so we can keep all the memory read
  /// operations take `&self`. Use a `RefCell` in `AllocExtra` if you
  /// need to mutate.
  ///
  /// This is not invoked for ZST accesses, as no read actually happens.
  before_memory_read(
    _tcx: TyCtxtAt,
    _machine: Machine<T>,
    _alloc_extra: T["AllocExtra"],
    _ptr: Pointer<T["Provenance"] | undefined>,
    _prov: [AllocId, T["ProvenanceExtra"]],
    _range: AllocRange,
  ): InterpResult; // (provided)

  /// Hook for performing extra checks on any memory read access,
  /// that involves an allocation, even ZST reads.
  ///
  /// This will *not* be called during validation!
  ///
  /// Used to prevent statics from self-initializing by reading from their own memory
  /// as it is being initialized.
  before_alloc_access(_tcx: TyCtxtAt, _machine: Machine<T>, _alloc_id: AllocId): InterpResult; // (provided)

  /// Hook for performing extra checks on a memory write access.
  /// This is not invoked for ZST accesses, as no write actually happens.
  /// `ptr` will always be a pointer with the provenance in `prov` pointing to the beginning of
  /// `range`.
  before_memory_write(
    _tcx: TyCtxtAt,
    _machine: Machine<T>,
    _alloc_extra: T["AllocExtra"],
    _ptr: Pointer<T["Provenance"] | undefined>,
    _prov: [AllocId, T["ProvenanceExtra"]],
    _range: AllocRange,
  ): InterpResult; // (provided)

  /// Hook for performing extra operations on a memory deallocation.
  /// `ptr` will always be a pointer with the provenance in `prov` pointing to the beginning of
  /// the allocation.
  before_memory_deallocation(
    _tcx: TyCtxtAt,
    _machine: Machine<T>,
    _alloc_extra: T["AllocExtra"],
    _ptr: Pointer<T["Provenance"] | undefined>,
    _prov: [AllocId, T["ProvenanceExtra"]],
    _size: Size,
    _align: Align,
    _kind: MemoryKind<T["MemoryKind"]>,
  ): InterpResult; // (provided)

  /// Executes a retagging operation for a single pointer.
  /// Returns the possibly adjusted pointer. Return `None` if the pointer
  /// was left unchanged.
  ///
  /// `ty` is the full type of the pointer. This is not the same as `val.layout.ty` for boxes
  /// where `val` is just the inner raw pointer, but `ty` is the entire `Box` type.
  retag_ptr_value(_ecx: InterpCx<Machine<T>>, _val: ImmTy<T["Provenance"]>, _ty: Ty): InterpResult<ImmTy<T["Provenance"]> | undefined>; // (provided)

  /// Invoke `f` in a state where calls to `retag_ptr_value` will use the given retag mode.
  with_retag_mode<R>(ecx: InterpCx<Machine<T>>, _mode: RetagMode, f: (ecx: InterpCx<Machine<T>>) => InterpResult<R>): InterpResult<R>; // (provided)

  /// Called on places used for in-place function argument and return value handling.
  ///
  /// These places need to be protected to make sure the program cannot tell whether the
  /// argument/return value was actually copied or passed in-place..
  protect_in_place_function_argument(ecx: InterpCx<Machine<T>>, mplace: MPlaceTy<T["Provenance"]>): InterpResult; // (provided)

  /// Called immediately before a new stack frame gets pushed.
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:585 init_frame
  init_frame(ecx: InterpCx<Machine<T>>, frame: Frame<T["Provenance"], null>): InterpResult<MachineFrame<T>>;

  /// Borrow the current thread's stack.
  // PORT: `stack()` is `stack_()` (clash with `CompileTimeMachine`'s field `stack`; precedent `tcx_()`).
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:591 stack
  stack_(ecx: InterpCx<Machine<T>>): readonly MachineFrame<T>[];

  /// Mutably borrow the current thread's stack.
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:596 stack_mut
  stack_mut(ecx: InterpCx<Machine<T>>): MachineFrame<T>[];

  /// Called immediately after a stack frame got pushed and its locals got initialized.
  after_stack_push(_ecx: InterpCx<Machine<T>>): InterpResult; // (provided)

  /// Called just before the frame is removed from the stack (followed by return value copy and
  /// local cleanup).
  before_stack_pop(_ecx: InterpCx<Machine<T>>): InterpResult; // (provided)

  /// Called immediately after a stack frame got popped, but before jumping back to the caller.
  /// The `locals` have already been destroyed!
  after_stack_pop(_ecx: InterpCx<Machine<T>>, _frame: MachineFrame<T>, unwinding: boolean): InterpResult<ReturnAction>; // (provided)

  /// Called immediately after an "immediate" local variable is read
  /// (i.e., this is called for reads that do not end up accessing addressable memory).
  after_local_read(_ecx: InterpCx<Machine<T>>, _local: Local): InterpResult; // (provided)

  /// Called immediately after an "immediate" local variable is assigned a new value
  /// (i.e., this is called for writes that do not end up in memory).
  /// `storage_live` indicates whether this is the initial write upon `StorageLive`.
  after_local_write(_ecx: InterpCx<Machine<T>>, _local: Local, _storage_live: boolean): InterpResult; // (provided)

  /// Called immediately after actual memory was allocated for a local
  /// but before the local's stack frame is updated to point to that memory.
  after_local_moved_to_memory(_ecx: InterpCx<Machine<T>>, _local: Local, _mplace: MPlaceTy<T["Provenance"]>): InterpResult; // (provided)

  /// Returns the salt to be used for a deduplicated global alloation.
  /// If the allocation is for a function, the instance is provided as well
  /// (this lets Miri ensure unique addresses for some functions).
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:657 get_global_alloc_salt
  get_global_alloc_salt(ecx: InterpCx<Machine<T>>, instance: Instance | undefined): number;

  cached_union_data_range(_ecx: InterpCx<Machine<T>>, _ty: Ty, compute_range: () => RangeSet): RangeSet; // (provided)

  /// Compute the value passed to the constructors of the `AllocBytes` type for
  /// abstract machine allocations.
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:673 get_default_alloc_params
  get_default_alloc_params(): T["AllocParams"];

  /// Allows enabling/disabling tracing calls from within `rustc_const_eval` at compile time, by
  /// delegating the entering of [tracing::Span]s to implementors of the [Machine] trait. The
  /// default implementation corresponds to tracing being disabled, meaning the tracing calls will
  /// supposedly be optimized out completely. To enable tracing, override this trait method and
  /// return `span.entered()`. Also see [crate::enter_trace_span].
  enter_trace_span(_span: () => unknown): EnteredTraceSpan; // (provided)
}


/** PORT: the provided methods (and the defaulted associated const) of `trait Machine` (PORTING §8). */
export abstract class Machine_provided<T extends MachineTypes = CtfeMachineTypes> implements Machine<T> {
  abstract readonly MayLeak_MemoryKind: MayLeak<T["MemoryKind"]>;
  abstract readonly display_MemoryKind: (self: T["MemoryKind"], f: Fmt) => string;
  abstract readonly MemoryKind_eq: (a: T["MemoryKind"], b: T["MemoryKind"]) => boolean;
  abstract readonly Provenance: Provenance<T["Provenance"]>;
  abstract readonly Bytes: AllocBytes<T["Bytes"], T["AllocParams"]>;
  abstract MemoryMap_default(): T["MemoryMap"];
  abstract readonly GLOBAL_KIND: T["MemoryKind"] | undefined;
  abstract readonly PANIC_ON_ALLOC_FAIL: boolean;

  /// Determines whether `eval_mir_constant` can never fail because all required consts have
  /// already been checked before.
  readonly ALL_CONSTS_ARE_PRECHECKED: boolean = true;

  abstract enforce_alignment(ecx: InterpCx<Machine<T>>): boolean;

  /// Gives the machine a chance to detect more misalignment than the built-in checks would catch.
  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:170 alignment_check
  alignment_check(
    _ecx: InterpCx<Machine<T>>,
    _alloc_id: AllocId,
    _alloc_align: Align,
    _alloc_kind: AllocKind,
    _offset: Size,
    _align: Align,
  ): Misalignment | undefined {
    return undefined;
  }

  abstract enforce_validity(ecx: InterpCx<Machine<T>>, layout: TyAndLayout): boolean;

  /// Whether to enforce the validity invariant *recursively*.
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:184 enforce_validity_recursively
  enforce_validity_recursively(_ecx: InterpCx<Machine<T>>, _layout: TyAndLayout): boolean {
    return false;
  }

  abstract ignore_optional_overflow_checks(_ecx: InterpCx<Machine<T>>): boolean;

  /// Entry point for obtaining the MIR of anything that should get evaluated.
  /// So not just functions and shims, but also const/static initializers, anonymous
  /// constants, ...
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:198 load_mir
  load_mir(ecx: InterpCx<Machine<T>>, instance: InstanceKind): Body {
    return ecx.tcx.deref().instance_mir(instance);
  }

  abstract find_mir_or_eval_fn(
    ecx: InterpCx<Machine<T>>,
    instance: Instance,
    abi: FnAbi<Ty>,
    args: readonly FnArg<T["Provenance"]>[],
    destination: PlaceTy<T["Provenance"]>,
    target: BasicBlock | undefined,
    unwind: UnwindAction,
  ): InterpResult<[Body, Instance] | undefined>;
  abstract call_extra_fn(
    ecx: InterpCx<Machine<T>>,
    fn_val: T["ExtraFnVal"],
    abi: FnAbi<Ty>,
    args: readonly FnArg<T["Provenance"]>[],
    destination: PlaceTy<T["Provenance"]>,
    target: BasicBlock | undefined,
    unwind: UnwindAction,
  ): InterpResult;
  abstract call_intrinsic(
    ecx: InterpCx<Machine<T>>,
    instance: Instance,
    args: readonly OpTy<T["Provenance"]>[],
    destination: PlaceTy<T["Provenance"]>,
    target: BasicBlock | undefined,
    unwind: UnwindAction,
  ): InterpResult<Instance | undefined>;
  abstract call_llvm_intrinsic(ecx: InterpCx<Machine<T>>, instance: Instance, args: readonly OpTy<T["Provenance"]>[], destination: PlaceTy<T["Provenance"]>, target: BasicBlock | undefined): InterpResult;
  abstract check_fn_target_features(_ecx: InterpCx<Machine<T>>, _instance: Instance): InterpResult;
  abstract assert_panic(ecx: InterpCx<Machine<T>>, msg: AssertMessage, unwind: UnwindAction): InterpResult;
  abstract panic_nounwind(_ecx: InterpCx<Machine<T>>, msg: string): InterpResult;
  abstract unwind_terminate(ecx: InterpCx<Machine<T>>, reason: UnwindTerminateReason): InterpResult;
  abstract binary_ptr_op(ecx: InterpCx<Machine<T>>, bin_op: BinOp, left: ImmTy<T["Provenance"]>, right: ImmTy<T["Provenance"]>): InterpResult<ImmTy<T["Provenance"]>>;

  /// Generate the NaN returned by a float operation, given the list of inputs.
  /// (This is all inputs, not just NaN inputs!)
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:294 generate_nan
  generate_nan<F1, F2 extends Float<F2>>(_ecx: InterpCx<Machine<T>>, _inputs: readonly F1[], F2_: FloatType<F2>): F2 {
    // By default we always return the preferred NaN.
    return F2_.NAN;
  }

  /// Apply non-determinism to float operations that do not return a precise result.
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:303 apply_float_nondet
  apply_float_nondet(_ecx: InterpCx<Machine<T>>, val: ImmTy<T["Provenance"]>): InterpResult<ImmTy<T["Provenance"]>> {
    return interp_ok(val);
  }

  /// Determines the result of `min`/`max` on floats when the arguments are equal.
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:311 equal_float_min_max
  equal_float_min_max<F>(_ecx: InterpCx<Machine<T>>, a: F, _b: F): F {
    // By default, we pick the left argument.
    return a;
  }

  abstract float_fuse_mul_add(ecx: InterpCx<Machine<T>>): boolean;
  abstract atomic_load(ecx: InterpCx<Machine<T>>, place: MPlaceTy<T["Provenance"]>, ordering: AtomicOrdering): InterpResult<Scalar<T["Provenance"]>>;
  abstract atomic_store(ecx: InterpCx<Machine<T>>, place: MPlaceTy<T["Provenance"]>, val: ImmTy<T["Provenance"]>, ordering: AtomicOrdering): InterpResult;
  abstract atomic_rmw(ecx: InterpCx<Machine<T>>, place: MPlaceTy<T["Provenance"]>, op: AtomicRmwOp, operand: ImmTy<T["Provenance"]>, ordering: AtomicOrdering): InterpResult<Scalar<T["Provenance"]>>;
  abstract atomic_compare_exchange(
    ecx: InterpCx<Machine<T>>,
    place: MPlaceTy<T["Provenance"]>,
    expected_old: ImmTy<T["Provenance"]>,
    new_: ImmTy<T["Provenance"]>,
    can_fail_spuriously: boolean,
    success_ordering: AtomicOrdering,
    failure_ordering: AtomicOrdering,
  ): InterpResult<[Scalar<T["Provenance"]>, boolean]>;
  abstract atomic_fence(ecx: InterpCx<Machine<T>>, ordering: AtomicOrdering, singlethread: boolean): InterpResult;

  /// Called before a basic block terminator is executed.
  // #[inline]
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:360 before_terminator
  before_terminator(_ecx: InterpCx<Machine<T>>): InterpResult {
    return interp_ok(undefined);
  }

  abstract runtime_checks(_ecx: InterpCx<Machine<T>>, r: RuntimeChecks): InterpResult<boolean>;

  /// Called when the interpreter encounters a `StatementKind::ConstEvalCounter` instruction.
  /// You can use this to detect long or endlessly running programs.
  // #[inline]
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:373 increment_const_eval_counter
  increment_const_eval_counter(_ecx: InterpCx<Machine<T>>): InterpResult {
    return interp_ok(undefined);
  }

  /// Called before a global allocation is accessed.
  /// `def_id` is `Some` if this is the "lazy" allocation of a static.
  // #[inline]
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:380 before_access_global
  before_access_global(
    _tcx: TyCtxtAt,
    _machine: Machine<T>,
    _alloc_id: AllocId,
    _allocation: ConstAllocation,
    _static_def_id: DefId | undefined,
    _is_write: boolean,
  ): InterpResult {
    return interp_ok(undefined);
  }

  /// Return the `AllocId` for the given thread-local static in the current thread.
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:392 thread_local_static_pointer
  thread_local_static_pointer(_ecx: InterpCx<Machine<T>>, def_id: DefId): InterpResult<Pointer<T["Provenance"]>> {
    // throw_unsup!(ThreadLocalStatic(def_id))
    return Err(InterpErrorInfo_from_InterpErrorKind({ $: "Unsupported", _0: { $: "ThreadLocalStatic", _0: def_id } }));
  }

  abstract extern_static_pointer(ecx: InterpCx<Machine<T>>, def_id: DefId): InterpResult<Pointer<T["Provenance"]>>;
  abstract ptr_from_addr_cast(ecx: InterpCx<Machine<T>>, addr: bigint): InterpResult<Pointer<T["Provenance"] | undefined>>;
  abstract expose_provenance(ecx: InterpCx<Machine<T>>, provenance: T["Provenance"]): InterpResult;
  abstract ptr_get_alloc(ecx: InterpCx<Machine<T>>, ptr: Pointer<T["Provenance"]>, size: bigint): [AllocId, Size, T["ProvenanceExtra"]] | undefined;
  abstract adjust_alloc_root_pointer(ecx: InterpCx<Machine<T>>, ptr: Pointer<CtfeProvenance>, kind: MemoryKind<T["MemoryKind"]> | undefined): InterpResult<Pointer<T["Provenance"]>>;
  abstract adjust_global_allocation(ecx: InterpCx<Machine<T>>, id: AllocId, alloc: Allocation): InterpResult<Cow<MachineAllocation<T>>>;
  abstract init_local_allocation(ecx: InterpCx<Machine<T>>, id: AllocId, kind: MemoryKind<T["MemoryKind"]>, size: Size, align: Align): InterpResult<T["AllocExtra"]>;

  /// Hook for performing extra checks on a memory read access.
  /// `ptr` will always be a pointer with the provenance in `prov` pointing to the beginning of
  /// `range`.
  ///
  /// This will *not* be called during validation!
  ///
  /// Takes read-only access to the allocation so we can keep all the memory read
  /// operations take `&self`. Use a `RefCell` in `AllocExtra` if you
  /// need to mutate.
  ///
  /// This is not invoked for ZST accesses, as no read actually happens.
  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:487 before_memory_read
  before_memory_read(
    _tcx: TyCtxtAt,
    _machine: Machine<T>,
    _alloc_extra: T["AllocExtra"],
    _ptr: Pointer<T["Provenance"] | undefined>,
    _prov: [AllocId, T["ProvenanceExtra"]],
    _range: AllocRange,
  ): InterpResult {
    return interp_ok(undefined);
  }

  /// Hook for performing extra checks on any memory read access,
  /// that involves an allocation, even ZST reads.
  ///
  /// This will *not* be called during validation!
  ///
  /// Used to prevent statics from self-initializing by reading from their own memory
  /// as it is being initialized.
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:505 before_alloc_access
  before_alloc_access(_tcx: TyCtxtAt, _machine: Machine<T>, _alloc_id: AllocId): InterpResult {
    return interp_ok(undefined);
  }

  /// Hook for performing extra checks on a memory write access.
  /// This is not invoked for ZST accesses, as no write actually happens.
  /// `ptr` will always be a pointer with the provenance in `prov` pointing to the beginning of
  /// `range`.
  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:518 before_memory_write
  before_memory_write(
    _tcx: TyCtxtAt,
    _machine: Machine<T>,
    _alloc_extra: T["AllocExtra"],
    _ptr: Pointer<T["Provenance"] | undefined>,
    _prov: [AllocId, T["ProvenanceExtra"]],
    _range: AllocRange,
  ): InterpResult {
    return interp_ok(undefined);
  }

  /// Hook for performing extra operations on a memory deallocation.
  /// `ptr` will always be a pointer with the provenance in `prov` pointing to the beginning of
  /// the allocation.
  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:533 before_memory_deallocation
  before_memory_deallocation(
    _tcx: TyCtxtAt,
    _machine: Machine<T>,
    _alloc_extra: T["AllocExtra"],
    _ptr: Pointer<T["Provenance"] | undefined>,
    _prov: [AllocId, T["ProvenanceExtra"]],
    _size: Size,
    _align: Align,
    _kind: MemoryKind<T["MemoryKind"]>,
  ): InterpResult {
    return interp_ok(undefined);
  }

  /// Executes a retagging operation for a single pointer.
  /// Returns the possibly adjusted pointer. Return `None` if the pointer
  /// was left unchanged.
  ///
  /// `ty` is the full type of the pointer. This is not the same as `val.layout.ty` for boxes
  /// where `val` is just the inner raw pointer, but `ty` is the entire `Box` type.
  // #[inline]
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:553 retag_ptr_value
  retag_ptr_value(_ecx: InterpCx<Machine<T>>, _val: ImmTy<T["Provenance"]>, _ty: Ty): InterpResult<ImmTy<T["Provenance"]> | undefined> {
    return interp_ok(undefined);
  }

  /// Invoke `f` in a state where calls to `retag_ptr_value` will use the given retag mode.
  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:563 with_retag_mode
  with_retag_mode<R>(ecx: InterpCx<Machine<T>>, _mode: RetagMode, f: (ecx: InterpCx<Machine<T>>) => InterpResult<R>): InterpResult<R> {
    return f(ecx);
  }

  /// Called on places used for in-place function argument and return value handling.
  ///
  /// These places need to be protected to make sure the program cannot tell whether the
  /// argument/return value was actually copied or passed in-place..
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:575 protect_in_place_function_argument
  protect_in_place_function_argument(ecx: InterpCx<Machine<T>>, mplace: MPlaceTy<T["Provenance"]>): InterpResult {
    // Without an aliasing model, all we can do is put `Uninit` into the place.
    // Conveniently this also ensures that the place actually points to suitable memory.
    return ecx.write_uninit(mplace);
  }

  abstract init_frame(ecx: InterpCx<Machine<T>>, frame: Frame<T["Provenance"], null>): InterpResult<MachineFrame<T>>;
  abstract stack_(ecx: InterpCx<Machine<T>>): readonly MachineFrame<T>[];
  abstract stack_mut(ecx: InterpCx<Machine<T>>): MachineFrame<T>[];

  /// Called immediately after a stack frame got pushed and its locals got initialized.
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:601 after_stack_push
  after_stack_push(_ecx: InterpCx<Machine<T>>): InterpResult {
    return interp_ok(undefined);
  }

  /// Called just before the frame is removed from the stack (followed by return value copy and
  /// local cleanup).
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:607 before_stack_pop
  before_stack_pop(_ecx: InterpCx<Machine<T>>): InterpResult {
    return interp_ok(undefined);
  }

  /// Called immediately after a stack frame got popped, but before jumping back to the caller.
  /// The `locals` have already been destroyed!
  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:614 after_stack_pop
  after_stack_pop(_ecx: InterpCx<Machine<T>>, _frame: MachineFrame<T>, unwinding: boolean): InterpResult<ReturnAction> {
    // By default, we do not support unwinding from panics
    assert(!unwinding, "assertion failed: !unwinding");
    _frame.tracing_span.drop(); // PORT: `_frame` is dropped at the end of the fn (its `tracing_span` exits).
    return interp_ok(ReturnAction.Normal);
  }

  /// Called immediately after an "immediate" local variable is read
  /// (i.e., this is called for reads that do not end up accessing addressable memory).
  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:627 after_local_read
  after_local_read(_ecx: InterpCx<Machine<T>>, _local: Local): InterpResult {
    return interp_ok(undefined);
  }

  /// Called immediately after an "immediate" local variable is assigned a new value
  /// (i.e., this is called for writes that do not end up in memory).
  /// `storage_live` indicates whether this is the initial write upon `StorageLive`.
  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:635 after_local_write
  after_local_write(_ecx: InterpCx<Machine<T>>, _local: Local, _storage_live: boolean): InterpResult {
    return interp_ok(undefined);
  }

  /// Called immediately after actual memory was allocated for a local
  /// but before the local's stack frame is updated to point to that memory.
  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:646 after_local_moved_to_memory
  after_local_moved_to_memory(_ecx: InterpCx<Machine<T>>, _local: Local, _mplace: MPlaceTy<T["Provenance"]>): InterpResult {
    return interp_ok(undefined);
  }

  abstract get_global_alloc_salt(ecx: InterpCx<Machine<T>>, instance: Instance | undefined): number;

  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:662 cached_union_data_range
  cached_union_data_range(_ecx: InterpCx<Machine<T>>, _ty: Ty, compute_range: () => RangeSet): RangeSet {
    // Default to no caching.
    return /* Cow::Owned( */ compute_range();
  }

  abstract get_default_alloc_params(): T["AllocParams"];

  /// Allows enabling/disabling tracing calls from within `rustc_const_eval` at compile time, by
  /// delegating the entering of [tracing::Span]s to implementors of the [Machine] trait. The
  /// default implementation corresponds to tracing being disabled, meaning the tracing calls will
  /// supposedly be optimized out completely. To enable tracing, override this trait method and
  /// return `span.entered()`. Also see [crate::enter_trace_span].
  // #[must_use]
  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:682 enter_trace_span
  enter_trace_span(_span: () => unknown): EnteredTraceSpan {
    return undefined;
  }
}

/// A lot of the flexibility above is just needed for `Miri`, but all "compile-time" machines
/// (CTFE and ConstProp) use the same instance. Here, we share that code.
// pub macro compile_time_machine(<$tcx: lifetime>)
// PORT: the macro's items are a base class of `CompileTimeMachine` and `DummyMachine` (header); its associated types
// (`Provenance = CtfeProvenance`, `ProvenanceExtra = bool` (the "immutable" flag), `ExtraFnVal = !`, `MemoryKind =
// $crate::const_eval::MemoryKind`, `MemoryMap = FxIndexMap<..>`, `AllocExtra = ()`, `FrameExtra = ()`,
// `Bytes = Box<[u8]>`) are `CtfeMachineTypes` (module header); the impls of the statically dispatched ones
// (`MemoryKind: MayLeak + Display + Eq`, `Provenance`, `Bytes`, `MemoryMap: Default`) are members below.
export abstract class compile_time_machine extends Machine_provided<CtfeMachineTypes> {
  // type MemoryKind = $crate::const_eval::MemoryKind;
  readonly MayLeak_MemoryKind: MayLeak<CtfeMemoryKind> = const_eval_machine().MayLeak_MemoryKind;
  readonly display_MemoryKind: (self: CtfeMemoryKind, f: Fmt) => string = const_eval_machine().display_MemoryKind;
  readonly MemoryKind_eq: (a: CtfeMemoryKind, b: CtfeMemoryKind) => boolean = const_eval_machine().MemoryKind_eq;
  // type Provenance = CtfeProvenance;
  readonly Provenance: Provenance<CtfeProvenance> = Provenance_CtfeProvenance;
  // type Bytes = Box<[u8]>;
  readonly Bytes: AllocBytes<Uint8Array, null> = AllocBytes_Box;
  // type MemoryMap = rustc_data_structures::fx::FxIndexMap<AllocId, (MemoryKind<Self::MemoryKind>, Allocation)>;
  MemoryMap_default(): CtfeMemoryMap {
    return const_eval_machine().FxIndexMap_AllocMap.default_<AllocId, [MemoryKind<CtfeMemoryKind>, Allocation]>();
  }

  // no copying of globals from `tcx` to machine memory
  readonly GLOBAL_KIND: CtfeMemoryKind | undefined = undefined;

  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:705 ignore_optional_overflow_checks
  ignore_optional_overflow_checks(_ecx: InterpCx): boolean {
    return false;
  }

  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:710 unwind_terminate
  unwind_terminate(_ecx: InterpCx, _reason: UnwindTerminateReason): InterpResult {
    return unreachable("unwinding cannot happen during compile-time evaluation");
  }

  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:718 check_fn_target_features
  check_fn_target_features(_ecx: InterpCx, _instance: Instance): InterpResult {
    // For now we don't do any checking here. We can't use `tcx.sess` because that can differ
    // between crates, and we need to ensure that const-eval always behaves the same.
    return interp_ok(undefined);
  }

  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:728 call_extra_fn
  call_extra_fn(
    _ecx: InterpCx,
    fn_val: never,
    _abi: FnAbi<Ty>,
    _args: readonly FnArg[],
    _destination: PlaceTy,
    _target: BasicBlock | undefined,
    _unwind: UnwindAction,
  ): InterpResult {
    // match fn_val {}
    return fn_val;
  }

  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:741 float_fuse_mul_add
  float_fuse_mul_add(_ecx: InterpCx): boolean {
    return true;
  }

  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:746 atomic_load
  atomic_load(ecx: InterpCx, place: MPlaceTy, _ordering: AtomicOrdering): InterpResult<Scalar> {
    // Compile-time machines are single-threaded so this is like a regular load.
    return ecx.read_scalar(place);
  }

  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:756 atomic_store
  atomic_store(ecx: InterpCx, place: MPlaceTy, val: ImmTy, _ordering: AtomicOrdering): InterpResult {
    // Compile-time machines are single-threaded so this is like a regular store.
    return ecx.write_scalar(operand_mod().Immediate.to_scalar(val.imm), place);
  }

  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:766 atomic_rmw
  atomic_rmw(ecx: InterpCx, place: MPlaceTy, op: AtomicRmwOp, operand: ImmTy, _ordering: AtomicOrdering): InterpResult<Scalar> {
    // Compile-time machines are single-threaded so we ignore the ordering.
    const old_val_r = ecx.read_immediate(place);
    if (old_val_r.$ === "Err") return old_val_r;
    const old_val = old_val_r._0;
    const new_val_r = ecx.atomic_rmw_op(op, old_val, operand);
    if (new_val_r.$ === "Err") return new_val_r;
    const new_val = new_val_r._0;
    const w = ecx.write_immediate(new_val.imm, place);
    if (w.$ === "Err") return w;
    return interp_ok(operand_mod().Immediate.to_scalar(old_val.imm));
  }

  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:780 atomic_compare_exchange
  atomic_compare_exchange(
    ecx: InterpCx,
    place: MPlaceTy,
    expected_old: ImmTy,
    new_: ImmTy,
    _can_fail_spuriously: boolean,
    _success_ordering: AtomicOrdering,
    _failure_ordering: AtomicOrdering,
  ): InterpResult<[Scalar, boolean]> {
    // Compile-time machines are single-threaded so we ignore the ordering.
    // They are also deterministic so we do not fail spuriously.
    const actual_old_r = ecx.read_immediate(place);
    if (actual_old_r.$ === "Err") return actual_old_r;
    const actual_old = actual_old_r._0;
    const bin_r = ecx.binary_op("Eq", actual_old, expected_old);
    if (bin_r.$ === "Err") return bin_r;
    const eq_r = Scalar.to_bool(operand_mod().Immediate.to_scalar(bin_r._0.imm));
    if (eq_r.$ === "Err") return eq_r;
    const eq = eq_r._0;
    if (eq) {
      const w = ecx.write_immediate(new_.imm, place);
      if (w.$ === "Err") return w;
    }
    return interp_ok<[Scalar, boolean]>([operand_mod().Immediate.to_scalar(actual_old.imm), eq]);
  }

  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:800 atomic_fence
  atomic_fence(_ecx: InterpCx, _ordering: AtomicOrdering, _singlethread: boolean): InterpResult {
    // Compile-time machines are single-threaded so this is a NOP.
    return interp_ok(undefined);
  }

  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:810 adjust_global_allocation
  adjust_global_allocation(_ecx: InterpCx, _id: AllocId, alloc: Allocation): InterpResult<Cow<Allocation>> {
    // Overwrite default implementation: no need to adjust anything.
    return interp_ok(Cow.Borrowed(alloc));
  }

  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:819 init_local_allocation
  init_local_allocation(_ecx: InterpCx, _id: AllocId, _kind: MemoryKind<CtfeMemoryKind>, _size: Size, _align: Align): InterpResult<null> {
    return interp_ok(null);
  }

  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:829 extern_static_pointer
  extern_static_pointer(ecx: InterpCx, def_id: DefId): InterpResult<Pointer> {
    // Use the `AllocId` associated with the `DefId`. Any actual *access* will fail.
    return interp_ok(Pointer.new(CtfeProvenance_from_AllocId(ecx.tcx.deref().reserve_and_set_static_alloc(def_id)), Size.ZERO));
  }

  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:838 adjust_alloc_root_pointer
  adjust_alloc_root_pointer(_ecx: InterpCx, ptr: Pointer, _kind: MemoryKind<CtfeMemoryKind> | undefined): InterpResult<Pointer> {
    return interp_ok(ptr);
  }

  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:847 ptr_from_addr_cast
  ptr_from_addr_cast(_ecx: InterpCx, addr: bigint): InterpResult<Pointer<CtfeProvenance | undefined>> {
    // Allow these casts, but make the pointer not dereferenceable.
    // (I.e., they behave like transmutation.)
    // This is correct because no pointers can ever be exposed in compile-time evaluation.
    return interp_ok(Pointer.without_provenance<CtfeProvenance>(addr));
  }

  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:858 ptr_get_alloc
  ptr_get_alloc(_ecx: InterpCx, ptr: Pointer, _size: bigint): [AllocId, Size, boolean] | undefined {
    const [prov, offset] = ptr.prov_and_relative_offset();
    return [CtfeProvenanceC.alloc_id(prov), offset, CtfeProvenanceC.immutable(prov)];
  }

  // #[inline(always)]
  // rustc: compiler/rustc_const_eval/src/interpret/machine.rs:868 get_global_alloc_salt
  get_global_alloc_salt(_ecx: InterpCx, _instance: Instance | undefined): number {
    return CTFE_ALLOC_SALT;
  }
}

/** Lazy const_eval/machine.ts (`FxIndexMap_AllocMap`, the CTFE `MemoryMap`; init order as `operand_mod`). */
function const_eval_machine(): typeof import("../const_eval/machine.ts") {
  return (const_eval_machine_cache ??= require("../const_eval/machine.ts") as typeof import("../const_eval/machine.ts"));
}
var const_eval_machine_cache: typeof import("../const_eval/machine.ts") | undefined;

/** Lazy operand.ts (the `Immediate` companion): this module value-imports no interpret hand module, because the CTFE
 * machine classes extend `compile_time_machine` at load (eval_context.ts header: init order). */
function operand_mod(): typeof import("./operand.ts") {
  return (operand_mod_cache ??= require("./operand.ts") as typeof import("./operand.ts"));
}
// PORT: cached (`require` per call was ~30% of CTFE time); `var` is hoisted, as cycles may call this early.
var operand_mod_cache: typeof import("./operand.ts") | undefined;
