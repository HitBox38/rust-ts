// Port of src/tools/miri/src/shims/tls.rs (crate `miri`, plan-m6 D2).
// Fill lane: `miri-shims-a` (plan-m6 wave 37): ported.
// Its types are generated into tls.gen.ts (tools/codegen set `miri`); this module re-exports them.
//! Implement thread-local storage.
//
// PORT:
// - `TlsKey` is `u128` (`bigint`).
// - `BTreeMap<TlsKey, TlsEntry>` is a `Map`; the ordered walks (`range_mut`, `iter`) sort the keys first
//   (`sorted_keys`), so they visit keys in `BTreeMap` order whatever the insertion order. `BTreeMap<ThreadId, _>` is a
//   `Map` keyed by the canonical `ThreadId` instances (concurrency/thread.ts); nothing walks it in order except
//   `visit_provenance`, whose order is unobservable.
// - `VecDeque<TlsKey>` is an array (`pop_front` is `shift`).
// - `impl Default for TlsData` is the static `TlsData.default()` (machine.ts calls it); `impl VisitProvenance for
//   TlsData` is a prototype method (provenance_gc.ts, `VisitProvenance` interface).
// - `Poll<()>` is `Poll<null>`; `'new_state: { .. }` is a nested function (as global_ctor.ts).
// - `trace!` is compiled out of the release oracle (plan-m6 A6): kept as comments.
// - `try_insert(..).unwrap()` of a fresh key cannot fail (keys only grow); its `OccupiedError` Debug would print a
//   `TlsEntry`, whose `BTreeMap` Debug is not ported (types report), so that branch stops `unported`.
import { type ThreadId } from "../concurrency/thread.ts";
import { type ImmTy, type Scalar } from "../lib.ts";
import { type MiriInterpCx } from "../machine.ts";
import { imm_to_scalar, MiriImmTy } from "../operator.ts";
import { VisitProvenance_Scalar, type VisitWith } from "../provenance_gc.ts";
import { type RunningPthreadDtorState, type RunningWindowsDtorState, TlsData, TlsDtorsState, TlsDtorsStatePriv, type TlsEntry, type TlsKey } from "./tls.gen.ts";
import { ExternAbi } from "../../rustc_abi/extern_abi.ts";
import { type HasDataLayout, type Size } from "../../rustc_abi/lib.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { FnVal } from "../../rustc_const_eval/interpret/memory.ts";
import { debug_InterpErrorInfo } from "../../rustc_middle/mir/interpret/error.gen.ts";
import { InterpErrorInfo_from_InterpErrorKind, type InterpResult, interp_ok, Scalar as interp_Scalar } from "../../rustc_middle/mir/interpret/mod.ts";
import { type Instance } from "../../rustc_middle/ty/instance.ts";
import { type Span } from "../../rustc_span/lib.ts";
import { assert, unported } from "../../std/panic.ts";
import { Err, unwrap_result } from "../../std/result.ts";
import { Poll } from "../../std/task.ts";
export * from "./tls.gen.ts";

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- shims/tls.rs: `trait EvalContextPrivExt` (impl for `MiriInterpCx`) ----
    // shims/tls.rs:329
    lookup_windows_tls_dtors(this: MiriInterpCx): InterpResult<[ImmTy, Span][]>;
    // shims/tls.rs:339
    lookup_windows_fls_keys_with_dtors(this: MiriInterpCx): InterpResult<TlsKey[]>;
    // shims/tls.rs:353
    schedule_windows_tls_dtor(this: MiriInterpCx, dtor: ImmTy, span: Span): InterpResult;
    // shims/tls.rs:379
    schedule_macos_tls_dtor(this: MiriInterpCx): InterpResult<Poll<null>>;
    // shims/tls.rs:405
    schedule_next_pthread_tls_dtor(this: MiriInterpCx, state: RunningPthreadDtorState): InterpResult<Poll<null>>;
    // shims/tls.rs:441
    schedule_next_windows_fls_dtor(this: MiriInterpCx, state: RunningWindowsDtorState): InterpResult<Poll<null>>;
  }
}

declare module "./tls.gen.ts" {
  interface TlsData {
    // shims/tls.rs:68
    create_tls_key(dtor: [Instance, Span] | undefined, key_size: Size): InterpResult<TlsKey>;
    // shims/tls.rs:84
    delete_tls_key(key: TlsKey): InterpResult<TlsEntry>;
    // shims/tls.rs:94
    load_tls(key: TlsKey, thread_id: ThreadId, cx: HasDataLayout): InterpResult<Scalar>;
    // shims/tls.rs:110
    store_tls(key: TlsKey, thread_id: ThreadId, new_data: Scalar, cx: HasDataLayout): InterpResult;
    // shims/tls.rs:134
    add_macos_thread_dtor(thread: ThreadId, dtor: Instance, data: Scalar, span: Span): InterpResult;
    // shims/tls.rs:164
    fetch_tls_dtor(key: TlsKey | undefined, thread_id: ThreadId): [Instance, Scalar, TlsKey, Span] | undefined;
    // shims/tls.rs:200
    delete_all_thread_tls(thread_id: ThreadId): void;
    // shims/tls.rs:212 (impl VisitProvenance for TlsData)
    visit_provenance(visit: VisitWith): void;
  }
  namespace TlsData {
    // shims/tls.rs:55 (impl Default for TlsData)
    export let default_: () => TlsData;
  }
}
declare module "./tls.gen.ts" {
  interface TlsDtorsState {
    // shims/tls.rs:242
    on_stack_empty(this_: MiriInterpCx): InterpResult<Poll<null>>;
  }
}

/** `throw_unsup_format!(..)` */
function throw_unsup_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "Unsupported", _0: { $: "Unsupported", _0: msg } }));
}
/** `throw_ub_format!(..)` */
function throw_ub_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "UndefinedBehavior", _0: { $: "Ub", _0: msg } }));
}

/** The keys of a `BTreeMap<TlsKey, _>` in order. */
function sorted_keys(keys: Map<TlsKey, TlsEntry>): TlsKey[] {
  return [...keys.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** `scalar.to_target_usize(cx).unwrap()` (`InterpResult::unwrap`). */
function to_target_usize_unwrap(s: Scalar, cx: HasDataLayout): bigint {
  return unwrap_result(interp_Scalar.to_target_usize(s, cx), debug_InterpErrorInfo);
}

// impl Default for TlsData<'tcx>
// rustc: src/tools/miri/src/shims/tls.rs:55 default
function TlsData_default(): TlsData {
  return new TlsData(
    1n, // start with 1 as we must not use 0 on Windows
    new Map(),
    new Map(),
  );
}
// PORT: `TlsData::default()`; machine.ts reads the static `default` (`default_` in the declaration: reserved word).
(TlsData as unknown as { default: () => TlsData }).default = TlsData_default;
TlsData.default_ = TlsData_default;

/// Generate a new TLS key with the given destructor.
/// `key_size` determines the integer size the key has to fit in.
// #[expect(clippy::arithmetic_side_effects)]
// rustc: src/tools/miri/src/shims/tls.rs:68 create_tls_key
TlsData.prototype.create_tls_key = function (this: TlsData, dtor: [Instance, Span] | undefined, key_size: Size): InterpResult<TlsKey> {
  const new_key = this.next_key;
  this.next_key += 1n;
  if (this.keys.has(new_key)) {
    return unported("miri::shims::tls::TlsData::create_tls_key: `try_insert(..).unwrap()` OccupiedError Debug (TlsEntry's BTreeMap Debug)");
  }
  this.keys.set(new_key, { data: new Map(), dtor });
  // trace!("New TLS key allocated: {} with dtor {:?}", new_key, dtor);

  if (new_key > key_size.unsigned_int_max()) {
    return throw_unsup_format("we ran out of TLS key space");
  }
  return interp_ok(new_key);
};

// rustc: src/tools/miri/src/shims/tls.rs:84 delete_tls_key
TlsData.prototype.delete_tls_key = function (this: TlsData, key: TlsKey): InterpResult<TlsEntry> {
  const entry = this.keys.get(key);
  if (entry !== undefined) {
    this.keys.delete(key);
    // trace!("TLS key {} removed", key);
    return interp_ok(entry);
  } else {
    return throw_ub_format(`removing a nonexistent TLS key: ${key}`);
  }
};

// rustc: src/tools/miri/src/shims/tls.rs:94 load_tls
TlsData.prototype.load_tls = function (this: TlsData, key: TlsKey, thread_id: ThreadId, cx: HasDataLayout): InterpResult<Scalar> {
  const entry = this.keys.get(key);
  if (entry !== undefined) {
    const value = entry.data.get(thread_id);
    // trace!("TLS key {} for thread {:?} loaded: {:?}", key, thread_id, value);
    return interp_ok(value ?? interp_Scalar.null_ptr(cx));
  } else {
    return throw_ub_format(`loading from a non-existing TLS key: ${key}`);
  }
};

// rustc: src/tools/miri/src/shims/tls.rs:110 store_tls
TlsData.prototype.store_tls = function (this: TlsData, key: TlsKey, thread_id: ThreadId, new_data: Scalar, cx: HasDataLayout): InterpResult {
  const entry = this.keys.get(key);
  if (entry !== undefined) {
    const data = entry.data;
    const v = interp_Scalar.to_target_usize(new_data, cx);
    if (v.$ === "Err") return v;
    if (v._0 !== 0n) {
      // trace!("TLS key {} for thread {:?} stored: {:?}", key, thread_id, new_data);
      data.set(thread_id, new_data);
    } else {
      // trace!("TLS key {} for thread {:?} removed", key, thread_id);
      data.delete(thread_id);
    }
    return interp_ok(undefined);
  } else {
    return throw_ub_format(`storing to a non-existing TLS key: ${key}`);
  }
};

/// Add a thread local storage destructor for the given thread. This function
/// is used to implement the `_tlv_atexit` shim on MacOS.
// rustc: src/tools/miri/src/shims/tls.rs:134 add_macos_thread_dtor
TlsData.prototype.add_macos_thread_dtor = function (this: TlsData, thread: ThreadId, dtor: Instance, data: Scalar, span: Span): InterpResult {
  let dtors = this.macos_thread_dtors.get(thread);
  if (dtors === undefined) {
    dtors = [];
    this.macos_thread_dtors.set(thread, dtors);
  }
  dtors.push([dtor, data, span]);
  return interp_ok(undefined);
};

/// Returns a dtor, its argument and its index, if one is supposed to run.
/// `key` is the last dtors that was run; we return the *next* one after that.
///
/// An optional destructor function may be associated with each key value.
/// At thread exit, if a key value has a non-NULL destructor pointer,
/// and the thread has a non-NULL value associated with that key,
/// the value of the key is set to NULL, and then the function pointed
/// to is called with the previously associated value as its sole argument.
/// **The order of destructor calls is unspecified if more than one destructor
/// exists for a thread when it exits.**
///
/// If, after all the destructors have been called for all non-NULL values
/// with associated destructors, there are still some non-NULL values with
/// associated destructors, then the process is repeated.
/// If, after at least {PTHREAD_DESTRUCTOR_ITERATIONS} iterations of destructor
/// calls for outstanding non-NULL values, there are still some non-NULL values
/// with associated destructors, implementations may stop calling destructors,
/// or they may continue calling destructors until no non-NULL values with
/// associated destructors exist, even though this might result in an infinite loop.
// rustc: src/tools/miri/src/shims/tls.rs:164 fetch_tls_dtor
TlsData.prototype.fetch_tls_dtor = function (
  this: TlsData,
  key: TlsKey | undefined,
  thread_id: ThreadId,
): [Instance, Scalar, TlsKey, Span] | undefined {
  // use std::ops::Bound::*;

  const thread_local = this.keys;
  // `let start = match key { Some(key) => Excluded(key), None => Unbounded };`
  // We interpret the documentation above (taken from POSIX) as saying that we need to iterate
  // over all keys and run each destructor at least once before running any destructor a 2nd
  // time. That's why we have `key` to indicate how far we got in the current iteration. If we
  // return `None`, `schedule_next_pthread_tls_dtor` will re-try with `ket` set to `None` to
  // start the next round.
  // TODO: In the future, we might consider randomizing destructor order, but we still have to
  // uphold this requirement.
  for (const k of sorted_keys(thread_local)) {
    if (key !== undefined && k <= key) continue;
    const { data, dtor } = thread_local.get(k)!;
    const data_scalar = data.get(thread_id);
    if (data_scalar !== undefined) {
      // BTreeEntry::Occupied(entry)
      if (dtor !== undefined) {
        const [dtor_, span] = dtor;
        // Set TLS data to NULL, and call dtor with old value.
        data.delete(thread_id);
        return [dtor_, data_scalar, k, span];
      }
    }
    // BTreeEntry::Vacant(_) => {}
  }
  return undefined;
};

/// Delete all TLS entries for the given thread. This function should be
/// called after all TLS destructors have already finished.
// rustc: src/tools/miri/src/shims/tls.rs:200 delete_all_thread_tls
TlsData.prototype.delete_all_thread_tls = function (this: TlsData, thread_id: ThreadId): void {
  for (const { data } of this.keys.values()) {
    data.delete(thread_id);
  }

  const dtors = this.macos_thread_dtors.get(thread_id);
  if (dtors !== undefined) {
    this.macos_thread_dtors.delete(thread_id);
    assert(dtors.length === 0, "the destructors should have already been run");
  }
};

// impl VisitProvenance for TlsData<'_>
// rustc: src/tools/miri/src/shims/tls.rs:212 visit_provenance
TlsData.prototype.visit_provenance = function (this: TlsData, visit: VisitWith): void {
  const { keys, macos_thread_dtors, next_key: _next_key } = this;

  for (const k of sorted_keys(keys)) {
    for (const scalar of keys.get(k)!.data.values()) {
      VisitProvenance_Scalar.visit_provenance(scalar, visit);
    }
  }
  for (const dtors of macos_thread_dtors.values()) {
    for (const [, scalar] of dtors) {
      VisitProvenance_Scalar.visit_provenance(scalar, visit);
    }
  }
};

// rustc: src/tools/miri/src/shims/tls.rs:242 on_stack_empty
TlsDtorsState.prototype.on_stack_empty = function (this: TlsDtorsState, this_: MiriInterpCx): InterpResult<Poll<null>> {
  // use TlsDtorsStatePriv::*;
  const new_state_r = ((): InterpResult<TlsDtorsStatePriv | Poll<null>> => {
    const state = this._0;
    switch (state.$) {
      case "Init": {
        const os = this_.tcx.deref().sess.target.os;
        if (os.$ === "MacOs") {
          // macOS has a _tlv_atexit function that allows
          // registering destructors without associated keys.
          // These are run first.
          return interp_ok(TlsDtorsStatePriv.MacOsDtors);
        } else if (this_.target_os_is_unix()) {
          // All other Unixes directly jump to running the pthread dtors.
          return interp_ok({ $: "PthreadDtors", _0: { last_key: undefined } });
        } else if (os.$ === "Windows") {
          // Determine which destructors to run.
          const dtors = this_.lookup_windows_tls_dtors();
          if (dtors.$ === "Err") return dtors;

          // Fetch fls keys that have destructors. Keys registered during thread exit will not have their destructor called.
          // See also: `schedule_next_windows_fls_dtor`.
          const fls_keys_with_dtors = this_.lookup_windows_fls_keys_with_dtors();
          if (fls_keys_with_dtors.$ === "Err") return fls_keys_with_dtors;

          // And move to the next state, that runs them.
          return interp_ok({
            $: "WindowsDtors",
            _0: { last_key: undefined, remaining_keys: fls_keys_with_dtors._0 },
            _1: dtors._0,
          });
        } else {
          // No TLS dtor support.
          return interp_ok(TlsDtorsStatePriv.Done);
        }
      }
      case "MacOsDtors": {
        const p = this_.schedule_macos_tls_dtor();
        if (p.$ === "Err") return p;
        if (p._0.$ === "Pending") return interp_ok(Poll.Pending);
        // Poll::Ready(()):
        // After all macOS destructors are run, the system switches
        // to destroying the pthread destructors.
        return interp_ok({ $: "PthreadDtors", _0: { last_key: undefined } });
      }
      case "PthreadDtors": {
        const p = this_.schedule_next_pthread_tls_dtor(state._0);
        if (p.$ === "Err") return p;
        if (p._0.$ === "Pending") return interp_ok(Poll.Pending); // just keep going
        // Poll::Ready(()):
        return interp_ok(TlsDtorsStatePriv.Done);
      }
      case "WindowsDtors": {
        const { _0: wstate, _1: dtors } = state;
        // Fls destructors are scheduled before the tls callback.
        const p = this_.schedule_next_windows_fls_dtor(wstate);
        if (p.$ === "Err") return p;
        if (p._0.$ === "Pending") return interp_ok(Poll.Pending); // just keep going
        // Poll::Ready(()) => {}

        const popped = dtors.pop();
        if (popped !== undefined) {
          const [dtor, span] = popped;
          const r = this_.schedule_windows_tls_dtor(dtor, span);
          if (r.$ === "Err") return r;
          return interp_ok(Poll.Pending); // we stay in this state (but `dtors` got shorter)
        } else {
          // No more destructors to run.
          return interp_ok(TlsDtorsStatePriv.Done);
        }
      }
      case "Done": {
        this_.machine.tls.delete_all_thread_tls(this_.active_thread());
        return interp_ok(Poll.Ready_unit);
      }
    }
  })();
  if (new_state_r.$ === "Err") return new_state_r;
  const new_state = new_state_r._0;
  // A `Poll` is a direct `return` from inside the `match`; a `TlsDtorsStatePriv` is the `'new_state` value.
  if (new_state.$ === "Pending" || new_state.$ === "Ready") return interp_ok(new_state);

  this._0 = new_state;
  return interp_ok(Poll.Pending);
};

/// Schedule TLS destructors for Windows.
/// On windows, TLS destructors are managed by std.
// rustc: src/tools/miri/src/shims/tls.rs:329 lookup_windows_tls_dtors
InterpCx.prototype.lookup_windows_tls_dtors = function (this: MiriInterpCx): InterpResult<[ImmTy, Span][]> {
  const this_ = this.eval_context_mut();

  // Windows has a special magic linker section that is run on certain events.
  // We don't support most of that, but just enough to make thread-local dtors in `std` work.
  const r = this_.lookup_link_section((section) => section === ".CRT$XLB");
  if (r.$ === "Err") return r;
  return interp_ok(r._0);
};

/// Lookup all the FLS keys (which are stored as TLS keys) that have a destructor.
/// See also: `schedule_next_windows_fls_dtor`.
// rustc: src/tools/miri/src/shims/tls.rs:339 lookup_windows_fls_keys_with_dtors
InterpCx.prototype.lookup_windows_fls_keys_with_dtors = function (this: MiriInterpCx): InterpResult<TlsKey[]> {
  const this_ = this.eval_context_mut();

  const keys = this_.machine.tls.keys;
  return interp_ok(sorted_keys(keys).filter((key) => keys.get(key)!.dtor !== undefined));
};

// rustc: src/tools/miri/src/shims/tls.rs:353 schedule_windows_tls_dtor
InterpCx.prototype.schedule_windows_tls_dtor = function (this: MiriInterpCx, dtor: ImmTy, span: Span): InterpResult {
  const this_ = this.eval_context_mut();

  const dtor_ = interp_Scalar.to_pointer(imm_to_scalar(dtor), this_);
  const fn_r = this_.get_ptr_fn(dtor_);
  if (fn_r.$ === "Err") return fn_r;
  const inst_r = FnVal.as_instance(fn_r._0);
  if (inst_r.$ === "Err") return inst_r;
  const thread_callback = inst_r._0;

  // FIXME: Technically, the reason should be `DLL_PROCESS_DETACH` when the main thread exits
  // but std treats both the same.
  const reason = this_.eval_windows("c", "DLL_THREAD_DETACH");
  const null_ptr = MiriImmTy.from_scalar(interp_Scalar.null_ptr(this_), this_.machine.layouts.unit_ptr_const);

  // The signature of this function is `unsafe extern "system" fn(h: c::LPVOID, dwReason: c::DWORD, pv: c::LPVOID)`.
  // FIXME: `h` should be a handle to the current module and what `pv` should be is unknown
  // but both are ignored by std.
  const r = this_.call_thread_root_function(
    thread_callback,
    ExternAbi.System(false),
    [null_ptr, MiriImmTy.from_scalar(reason, this_.machine.layouts.u32), null_ptr],
    undefined,
    span,
  );
  if (r.$ === "Err") return r;
  return interp_ok(undefined);
};

/// Schedule the macOS thread local storage destructors to be executed.
// rustc: src/tools/miri/src/shims/tls.rs:379 schedule_macos_tls_dtor
InterpCx.prototype.schedule_macos_tls_dtor = function (this: MiriInterpCx): InterpResult<Poll<null>> {
  const this_ = this.eval_context_mut();
  const thread_id = this_.active_thread();
  // macOS keeps track of TLS destructors in a stack. If a destructor
  // registers another destructor, it will be run next.
  // See https://github.com/apple-oss-distributions/dyld/blob/d552c40cd1de105f0ec95008e0e0c0972de43456/dyld/DyldRuntimeState.cpp#L2277
  const dtor = this_.machine.tls.macos_thread_dtors.get(thread_id)?.pop();
  if (dtor !== undefined) {
    const [instance, data, span] = dtor;
    // trace!("Running macos dtor {:?} on {:?} at {:?}", instance, data, thread_id);

    const r = this_.call_thread_root_function(
      instance,
      ExternAbi.C(false),
      [MiriImmTy.from_scalar(data, this_.machine.layouts.unit_ptr_mut)],
      undefined,
      span,
    );
    if (r.$ === "Err") return r;

    return interp_ok(Poll.Pending);
  }

  return interp_ok(Poll.Ready_unit);
};

/// Schedule a pthread TLS destructor. Returns `true` if found
/// a destructor to schedule, and `false` otherwise.
// rustc: src/tools/miri/src/shims/tls.rs:405 schedule_next_pthread_tls_dtor
InterpCx.prototype.schedule_next_pthread_tls_dtor = function (this: MiriInterpCx, state: RunningPthreadDtorState): InterpResult<Poll<null>> {
  const this_ = this.eval_context_mut();
  const active_thread = this_.active_thread();

  // Fetch next dtor after `key`.
  const dtor =
    this_.machine.tls.fetch_tls_dtor(state.last_key, active_thread) ??
    // We ran each dtor once, start over from the beginning.
    this_.machine.tls.fetch_tls_dtor(undefined, active_thread);
  if (dtor !== undefined) {
    const [instance, ptr, key, span] = dtor;
    state.last_key = key;
    // trace!("Running TLS dtor {:?} on {:?} at {:?}", instance, ptr, active_thread);
    assert(to_target_usize_unwrap(ptr, this_) !== 0n, "data can't be NULL when dtor is called!");

    const r = this_.call_thread_root_function(
      instance,
      ExternAbi.C(false),
      [MiriImmTy.from_scalar(ptr, this_.machine.layouts.unit_ptr_mut)],
      undefined,
      span,
    );
    if (r.$ === "Err") return r;

    return interp_ok(Poll.Pending);
  }

  return interp_ok(Poll.Ready_unit);
};

/// Schedule a Windows FLS destructor, if one is found.
// rustc: src/tools/miri/src/shims/tls.rs:441 schedule_next_windows_fls_dtor
InterpCx.prototype.schedule_next_windows_fls_dtor = function (this: MiriInterpCx, state: RunningWindowsDtorState): InterpResult<Poll<null>> {
  const this_ = this.eval_context_mut();
  const active_thread = this_.active_thread();

  // According to [PflsCallbackFunction's docs],
  // > If the FLS slot is in use, `FlsCallback`` is called on .. thread exit ..
  // However, the exact order and semantics are not defined.
  // We use the following implementation, which matches both observed behavior and
  // Wine's implementation of the same logic in the [`RtlProcessFlsData`] function.
  // 1. Fetch all the keys once (in `lookup_windows_fls_keys_with_dtors`).
  // 2. Go over them one by one, in order, skipping keys without dtors.
  // 3. Fetch the value associated with the key.
  // 4. If it is non-zero, call the registered dtor.
  // 5. After the dtor is called, clear the key's value, setting it to zero.
  // New keys registered during thread exit are ignored, but values set before the dtor is scheduled are visible.
  // Keys without dtors will not be set to zero.
  // [PflsCallbackFunction's docs]: https://learn.microsoft.com/en-us/windows/win32/api/winnt/nc-winnt-pfls_callback_function
  // [`RtlProcessFlsData`]: https://github.com/wine-mirror/wine/blob/wine-11.0/dlls/ntdll/thread.c#L679

  // We are done running the previous key's destructor, so set it's value to zero.
  const last_key = state.last_key;
  state.last_key = undefined;
  if (last_key !== undefined) {
    const entry = this_.machine.tls.keys.get(last_key);
    if (entry !== undefined) {
      entry.data.delete(active_thread);
    }
  }

  let key: TlsKey | undefined;
  while ((key = state.remaining_keys.shift()) !== undefined) {
    // Fetch dtor for this `key`.
    // If the key doesn't have a dtor or does not exist any more, move on to the next key.
    const entry = this_.machine.tls.keys.get(key);
    if (entry === undefined || entry.dtor === undefined) {
      continue;
    }
    const { data, dtor } = entry;

    const [instance, span] = dtor;

    // If the key has no value in this thread, move on to the next key.
    const ptr = data.get(active_thread);
    if (ptr === undefined) continue;

    assert(to_target_usize_unwrap(ptr, this_) !== 0n, "TLS key's value can't be null (should be absent instead)");

    // trace!("Running TLS dtor {:?} on {:?} at {:?}", instance, ptr, active_thread);

    // We'll clear this key's value next time we are called.
    state.last_key = key;

    const r = this_.call_thread_root_function(
      instance,
      ExternAbi.System(false),
      [MiriImmTy.from_scalar(ptr, this_.machine.layouts.unit_ptr_mut)],
      undefined,
      span,
    );
    if (r.$ === "Err") return r;

    return interp_ok(Poll.Pending);
  }

  // We are done scheduling all the keys.
  return interp_ok(Poll.Ready_unit);
};
