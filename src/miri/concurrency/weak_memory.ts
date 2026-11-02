//! Implementation of C++11-consistent weak memory emulation using store buffers
//! based on Dynamic Race Detection for C++ ("the paper"):
//! <https://www.doc.ic.ac.uk/~afd/homepages/papers/pdfs/2017/POPL.pdf>
//!
//! (The rest of upstream's module documentation, weak_memory.rs:4-91, describes the model; it is not repeated here.)
// Port of src/tools/miri/src/concurrency/weak_memory.rs (crate `miri`, plan-m6 D2). Fill lane: `miri-sb` (plan-m6 wave 36). Its
// types are generated into weak_memory.gen.ts (tools/codegen set `miri`); this module re-exports them.
//
// PORT: `VecDeque<StoreElement>` is an array (`push_back` = `push`, `pop_front` = `shift`, `back` = the last element; the
// buffer holds at most STORE_BUFFER_LIMIT = 128 elements). `RefCell`s are erased (PORTING §5); `Ref<'_, StoreBuffer>` is
// the `StoreBuffer`.
// PORT: `LoadInfo.timestamps: FxHashMap<VectorIdx, VTimestamp>` is keyed by `VectorIdx` *values*, but the generated
// `VectorIdx` is a class: the map is a `KeyedMap` keyed by `VectorIdx.0` (rust_ts/keyed.ts). It is only probed and
// scanned with `any` (order-insensitive), so iteration order cannot leak.
// PORT(contract): impls of other lanes' files that the skeleton did not declare:
// - lane miri-race: `impl Index<VectorIdx> for VClock` (vector_clock.rs:428), `VTimestamp::ZERO` (vector_clock.rs:70),
//   `impl Ord for VTimestamp` (vector_clock.rs:123), `impl From<u32> for VectorIdx` (vector_clock.rs:39) are written
//   below in terms of the declared `as_slice` / `to_u32` / `time` / `VTimestamp::new` and the generated constructor, as
//   their upstream bodies are (`vclock_index`, `VTimestamp_ZERO`, `VTimestamp_le`, `new VectorIdx(0)`);
//   `AllocDataRaceHandler::as_weak_memory_ref` / `GlobalDataRaceHandler::as_vclocks_ref` (data_race_handler.rs:39/:61)
//   are their one-arm `if let`s; `GlobalState::active_thread_state` returns a `Ref<ThreadClockSet>`, read as the
//   `ThreadClockSet`.
// - lane miri-driver: `impl Index<Position> for RangeObjectMap` (range_object_map.rs:133) is `buffers.v[pos].data`, its
//   body; `impl VisitProvenance for Scalar` (provenance_gc.rs:125) is `VisitProvenance_Scalar`, read on provenance_gc's
//   namespace at call time (C10).
// Logging: weak_memory.rs has no `info!` / `trace!` lines.
import { type AtomicReadOrd, type AtomicRwOrd, type AtomicWriteOrd, type GlobalState as DataRaceState, type ThreadClockSet } from "./data_race.ts";
import { type AllocDataRaceHandler } from "./data_race_handler.ts";
import { type ThreadManager } from "./thread.ts";
import { type VClock, VTimestamp, VectorIdx, clone_VTimestamp } from "./vector_clock.ts";
import { VClock as VClock_ } from "./vector_clock.ts";
import { type LoadInfo, LoadRecency, StoreBuffer, StoreBufferAlloc, StoreElement } from "./weak_memory.gen.ts";
import { type AccessType, RangeObjectMap } from "../data_structures/range_object_map.ts";
import { type MPlaceTy, type Scalar } from "../lib.ts";
import { type MiriInterpCx } from "../machine.ts";
import * as provenance_gc from "../provenance_gc.ts";
import { type VisitWith } from "../provenance_gc.ts";
import { KeyedMap } from "../../rust_ts/keyed.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { alloc_range, type AllocRange } from "../../rustc_middle/mir/interpret/allocation.ts";
import { interp_ok, type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { type Rng } from "../../vendor/rand_core/lib.ts";
import { IteratorRandom, type RustIterator } from "../../vendor/rand/seq/iterator.ts";
import { unported, unwrap } from "../../std/panic.ts";
export * from "./weak_memory.gen.ts";

// pub type AllocState = StoreBufferAlloc; (weak_memory.gen.ts)

// Each store buffer must be bounded otherwise it will grow indefinitely.
// However, bounding the store buffer means restricting the amount of weak
// behaviours observable. The author picked 128 as a good tradeoff
// so we follow them here.
const STORE_BUFFER_LIMIT = 128;

// ---- PORT(contract, header): lane miri-race's undeclared impls, as their upstream bodies ----
let VTIMESTAMP_ZERO: VTimestamp | undefined;
/** `VTimestamp::ZERO` = `VTimestamp::new(0, NaReadType::Read, DUMMY_SP)` (vector_clock.rs:70); built on first use (C10). */
function VTimestamp_ZERO(): VTimestamp {
  return (VTIMESTAMP_ZERO ??= VTimestamp.new(0, "Read", DUMMY_SP));
}
/** `clock[index]`: `self.as_slice().get(index.to_u32().to_usize()).unwrap_or(&VTimestamp::ZERO)` (vector_clock.rs:428). */
function vclock_index(clock: VClock, index: VectorIdx): VTimestamp {
  return clock.as_slice()[index.to_u32()] ?? VTimestamp_ZERO();
}
/** `a <= b` of `VTimestamp`: `Ord::cmp` compares `time()` (vector_clock.rs:123). */
function VTimestamp_le(a: VTimestamp, b: VTimestamp): boolean {
  return a.time() <= b.time();
}
/** `GlobalState::active_thread_state` returns `(VectorIdx, Ref<'_, ThreadClockSet>)`; the `Ref` is the value. */
function active_thread_state(global: DataRaceState, thread_mgr: ThreadManager): [VectorIdx, ThreadClockSet] {
  return global.active_thread_state(thread_mgr) as unknown as [VectorIdx, ThreadClockSet];
}

/** `load_info.timestamps.iter().any(|(&idx, &load_ts)| load_ts <= clock[idx])` (fetch_store / store_impl). */
function any_load_happens_before(load_info: LoadInfo, clock: VClock): boolean {
  for (const [idx, load_ts] of load_info.timestamps) {
    if (VTimestamp_le(load_ts, vclock_index(clock, idx))) return true;
  }
  return false;
}

/** `LoadInfo::default()` (`#[derive(Default)]`, weak_memory.rs:169), with the `KeyedMap` of the header. */
function LoadInfo_default(): LoadInfo {
  return { timestamps: new KeyedMap<VectorIdx, VTimestamp>((k) => k._0), sc_loaded: false };
}

/** `&buffers[pos]` (`impl Index<Position> for RangeObjectMap`, range_object_map.rs:133; header). */
function rom_index<T>(m: RangeObjectMap<T>, pos: number): T {
  return unwrap(m.v[pos]).data;
}

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- concurrency/weak_memory.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // concurrency/weak_memory.rs:497
    buffered_atomic_rmw(this: MiriInterpCx, new_val: Scalar, place: MPlaceTy, atomic: AtomicRwOrd, init: Scalar): InterpResult;
    // concurrency/weak_memory.rs:543
    buffered_atomic_read(this: MiriInterpCx, place: MPlaceTy, atomic: AtomicReadOrd, latest_in_mo: Scalar, validate: (_0: VClock | undefined) => InterpResult): InterpResult<Scalar | undefined>;
    // concurrency/weak_memory.rs:601
    buffered_atomic_write(this: MiriInterpCx, val: Scalar, dest: MPlaceTy, atomic: AtomicWriteOrd, init: Scalar | undefined): InterpResult;
    // concurrency/weak_memory.rs:646
    perform_read_on_buffered_latest(this: MiriInterpCx, place: MPlaceTy, atomic: AtomicReadOrd): InterpResult;
  }
}

declare module "./weak_memory.gen.ts" {
  interface StoreBufferAlloc {
    // concurrency/weak_memory.rs:121 (impl VisitProvenance for StoreBufferAlloc)
    visit_provenance(visit: VisitWith): void;
    // concurrency/weak_memory.rs:189
    non_atomic_write(range: AllocRange, global: DataRaceState): void;
    // concurrency/weak_memory.rs:211
    get_store_buffer(range: AllocRange): InterpResult<StoreBuffer | undefined>;
    // concurrency/weak_memory.rs:227
    get_or_create_store_buffer_mut(range: AllocRange, init: Scalar | undefined): InterpResult<StoreBuffer>;
  }
  namespace StoreBufferAlloc {
    // concurrency/weak_memory.rs:181
    export let new_allocation: () => StoreBufferAlloc;
  }
}
declare module "./weak_memory.gen.ts" {
  interface StoreBuffer {
    // concurrency/weak_memory.rs:281
    read_from_last_store(global: DataRaceState, thread_mgr: ThreadManager, is_seqcst: boolean): void;
    // concurrency/weak_memory.rs:294
    buffered_read(global: DataRaceState, thread_mgr: ThreadManager, is_seqcst: boolean, rng: Rng, validate: (_0: VClock | undefined) => InterpResult): InterpResult<[Scalar | undefined, LoadRecency]>;
    // concurrency/weak_memory.rs:324
    buffered_write(val: Scalar, global: DataRaceState, thread_mgr: ThreadManager, is_seqcst: boolean, sync_clock: VClock): InterpResult;
    // concurrency/weak_memory.rs:339
    fetch_store(is_seqcst: boolean, clocks: ThreadClockSet, rng: Rng): [StoreElement, LoadRecency];
    // concurrency/weak_memory.rs:422
    store_impl(val: Scalar, index: VectorIdx, thread_clock: VClock, is_seqcst: boolean, sync_clock: VClock): void;
  }
  namespace StoreBuffer {
    // concurrency/weak_memory.rs:263
    function new_(init: Scalar | undefined): StoreBuffer;
    export { new_ as new };
  }
}
declare module "./weak_memory.gen.ts" {
  interface StoreElement {
    // concurrency/weak_memory.rs:480
    load_impl(index: VectorIdx, clocks: ThreadClockSet, is_seqcst: boolean): Scalar | undefined;
  }
}

// impl VisitProvenance for StoreBufferAlloc
// rustc: src/tools/miri/src/concurrency/weak_memory.rs:121 visit_provenance
StoreBufferAlloc.prototype.visit_provenance = function (this: StoreBufferAlloc, visit: VisitWith): void {
  const store_buffers = this.store_buffers;
  for (const buf of store_buffers.iter()) {
    for (const element of buf.buffer) {
      const val = element.val;
      // `impl VisitProvenance for Option<T>`: `if let Some(x) = self { x.visit_provenance(visit) }`
      if (val !== undefined) {
        provenance_gc.VisitProvenance_Scalar.visit_provenance(val, visit);
      }
    }
  }
};

// #[derive(PartialEq, Eq)] enum LoadRecency { Latest, Outdated } (weak_memory.gen.ts)

// impl StoreBufferAlloc
// rustc: src/tools/miri/src/concurrency/weak_memory.rs:181 new_allocation
StoreBufferAlloc.new_allocation = function (): StoreBufferAlloc {
  return new StoreBufferAlloc(RangeObjectMap.new());
};

/// When a non-atomic write happens on a location that has been atomically accessed
/// before without data race, we can determine that the non-atomic write fully happens
/// after all the prior atomic writes so the location no longer needs to exhibit
/// any weak memory behaviours until further atomic writes.
// rustc: src/tools/miri/src/concurrency/weak_memory.rs:189 non_atomic_write
StoreBufferAlloc.prototype.non_atomic_write = function (this: StoreBufferAlloc, range: AllocRange, global: DataRaceState): void {
  if (!global.ongoing_action_data_race_free_()) {
    const buffers = this.store_buffers;
    const access_type: AccessType = buffers.access_type(range);
    switch (access_type.$) {
      case "PerfectlyOverlapping": {
        const pos = access_type._0;
        buffers.remove_from_pos(pos);
        break;
      }
      case "ImperfectlyOverlapping": {
        const pos_range = access_type._0;
        // We rely on the data-race check making sure this is synchronized.
        // Therefore we can forget about the old data here.
        // PORT: the declared parameter is `Pending<"Range<Position>">` (range_object_map.ts, lane miri-driver); the value is
        // the `{ start, end }` range of `AccessType::ImperfectlyOverlapping`.
        buffers.remove_pos_range(pos_range as never);
        break;
      }
      case "Empty": {
        // The range had no weak behaviours attached, do nothing
        break;
      }
    }
  }
};

/// Gets a store buffer associated with an atomic object in this allocation.
/// Returns `None` if there is no store buffer.
// rustc: src/tools/miri/src/concurrency/weak_memory.rs:211 get_store_buffer
StoreBufferAlloc.prototype.get_store_buffer = function (this: StoreBufferAlloc, range: AllocRange): InterpResult<StoreBuffer | undefined> {
  const access_type = this.store_buffers.access_type(range);
  if (access_type.$ !== "PerfectlyOverlapping") {
    // If there is nothing here yet, that means there wasn't an atomic write yet so
    // we can't return anything outdated.
    return interp_ok(undefined);
  }
  const pos = access_type._0;
  const store_buffer = rom_index(this.store_buffers, pos);
  return interp_ok(store_buffer);
};

/// Gets a mutable store buffer associated with an atomic object in this allocation,
/// or creates one with the specified initial value if no atomic object exists yet.
// rustc: src/tools/miri/src/concurrency/weak_memory.rs:227 get_or_create_store_buffer_mut
StoreBufferAlloc.prototype.get_or_create_store_buffer_mut = function (this: StoreBufferAlloc, range: AllocRange, init: Scalar | undefined): InterpResult<StoreBuffer> {
  const buffers = this.store_buffers;
  const access_type = buffers.access_type(range);
  let pos: number;
  switch (access_type.$) {
    case "PerfectlyOverlapping":
      pos = access_type._0;
      break;
    case "Empty": {
      const pos_ = access_type._0;
      // We can use `init` for a new store buffer (with a default `sync_clock` that
      // acquires nothing) because there was no data race and no previous atomic write
      // either.
      buffers.insert_at_pos(pos_, range, StoreBuffer.new(init));
      pos = pos_;
      break;
    }
    case "ImperfectlyOverlapping": {
      const pos_range = access_type._0;
      // We can use `init` for a new store buffer (with a default `sync_clock` that
      // acquires nothing) because there was no data race and all previous atomic writes
      // are fully synchronized (as otherwise the imperfect overlap would be UB).
      // It is tempting to try to sanity-check this against the data race clock view of
      // whether there was any overlap, but that is very tricky: because we are skipping
      // clock tracking until the first thread is spawned, we don't actually have a good
      // view of whether a given atomic access "creates a new atomic object" or not.
      // A sanity check would require is to always track clocks for atomic accesses, which
      // does show up in benchmarks so we don't do it.
      buffers.remove_pos_range({ start: pos_range.start, end: pos_range.end } as never);
      buffers.insert_at_pos(pos_range.start, range, StoreBuffer.new(init));
      pos = pos_range.start;
      break;
    }
  }
  return interp_ok(rom_index(buffers, pos));
};

// impl<'tcx> StoreBuffer
// rustc: src/tools/miri/src/concurrency/weak_memory.rs:263 new
(StoreBuffer as unknown as { new: (init: Scalar | undefined) => StoreBuffer }).new = function (init: Scalar | undefined): StoreBuffer {
  const buffer: StoreElement[] = [];
  const store_elem = new StoreElement(
    // The thread index and timestamp of the initialisation write
    // are never meaningfully used, so it's fine to leave them as 0
    new VectorIdx(0), // VectorIdx::from(0) (header)
    VTimestamp_ZERO(),
    // The initialization write is non-atomic so nothing can be acquired.
    new VClock_([]), // VClock::default()
    false,
    init,
    LoadInfo_default(),
  );
  buffer.push(store_elem);
  return new StoreBuffer(buffer);
};

/// Reads from the last store in modification order, if any.
// rustc: src/tools/miri/src/concurrency/weak_memory.rs:281 read_from_last_store
StoreBuffer.prototype.read_from_last_store = function (this: StoreBuffer, global: DataRaceState, thread_mgr: ThreadManager, is_seqcst: boolean): void {
  const store_elem = this.buffer[this.buffer.length - 1];
  if (store_elem !== undefined) {
    const [index, clocks] = active_thread_state(global, thread_mgr);
    store_elem.load_impl(index, clocks, is_seqcst);
  }
};

// rustc: src/tools/miri/src/concurrency/weak_memory.rs:294 buffered_read
StoreBuffer.prototype.buffered_read = function (
  this: StoreBuffer,
  global: DataRaceState,
  thread_mgr: ThreadManager,
  is_seqcst: boolean,
  rng: Rng,
  validate: (_0: VClock | undefined) => InterpResult,
): InterpResult<[Scalar | undefined, LoadRecency]> {
  // Having a live borrow to store_buffer while calling validate_atomic_load is fine
  // because the race detector doesn't touch store_buffer

  let store_elem: StoreElement;
  let recency: LoadRecency;
  {
    // The `clocks` we got here must be dropped before calling validate_atomic_load
    // as the race detector will update it
    const [, clocks] = active_thread_state(global, thread_mgr);
    // Load from a valid entry in the store buffer
    [store_elem, recency] = this.fetch_store(is_seqcst, clocks, rng);
  }

  // Unlike in buffered_atomic_write, thread clock updates have to be done
  // after we've picked a store element from the store buffer, as presented
  // in ATOMIC LOAD rule of the paper. This is because fetch_store
  // requires access to ThreadClockSet.clock, which is updated by the race detector
  const v = validate(store_elem.sync_clock);
  if (v.$ === "Err") return v;

  const [index, clocks] = active_thread_state(global, thread_mgr);
  const loaded = store_elem.load_impl(index, clocks, is_seqcst);
  return interp_ok([loaded, recency]);
};

// rustc: src/tools/miri/src/concurrency/weak_memory.rs:324 buffered_write
StoreBuffer.prototype.buffered_write = function (
  this: StoreBuffer,
  val: Scalar,
  global: DataRaceState,
  thread_mgr: ThreadManager,
  is_seqcst: boolean,
  sync_clock: VClock,
): InterpResult {
  const [index, clocks] = active_thread_state(global, thread_mgr);

  this.store_impl(val, index, clocks.clock, is_seqcst, sync_clock);
  return interp_ok(undefined);
};

/**
 * PORT: `self.buffer.iter().rev().take_while(..).filter(..)` of `fetch_store` as one `RustIterator`, with core's size
 * hints (`IteratorRandom::choose` draws by them): `Filter` is `(0, upper)` of `TakeWhile`, which is `(0, Some(0))` once its
 * predicate returned `false` and `(0, upper)` of the exact `Rev<vec_deque::Iter>` before. `Filter` and `TakeWhile` keep
 * the default `nth`.
 */
class FetchCandidates implements RustIterator<StoreElement> {
  /** `Rev<Iter>`: the elements `buffer[front..back]` remain, yielded from the back. */
  private front = 0;
  private back: number;
  /** `TakeWhile::flag` */
  private flag = false;

  constructor(
    private readonly buffer: readonly StoreElement[],
    private readonly take_while: (store_elem: StoreElement) => boolean,
    private readonly filter: (store_elem: StoreElement) => boolean,
  ) {
    this.back = buffer.length;
  }

  /** `TakeWhile::next` over `Rev::next`. */
  private next_take_while(): StoreElement | undefined {
    if (this.flag) return undefined;
    if (this.back <= this.front) return undefined;
    this.back -= 1;
    const x = this.buffer[this.back]!;
    if (this.take_while(x)) {
      return x;
    } else {
      this.flag = true;
      return undefined;
    }
  }

  /** `Filter::next` = `self.iter.find(&mut self.predicate)`. */
  next(): StoreElement | undefined {
    for (;;) {
      const x = this.next_take_while();
      if (x === undefined) return undefined;
      if (this.filter(x)) return x;
    }
  }

  size_hint(): [number, number | undefined] {
    const upper = this.flag ? 0 : this.back - this.front;
    return [0, upper];
  }
}

/// Selects a valid store element in the buffer.
// rustc: src/tools/miri/src/concurrency/weak_memory.rs:339 fetch_store
StoreBuffer.prototype.fetch_store = function (this: StoreBuffer, is_seqcst: boolean, clocks: ThreadClockSet, rng: Rng): [StoreElement, LoadRecency] {
  // use rand::seq::IteratorRandom;
  let found_sc = false;
  // FIXME: we want an inclusive take_while (stops after a false predicate, but
  // includes the element that gave the false), but such function doesn't yet
  // exist in the standard library https://github.com/rust-lang/rust/issues/62208
  // so we have to hack around it with keep_searching
  let keep_searching = true;
  const candidates = new FetchCandidates(
    this.buffer,
    (store_elem) => {
      if (!keep_searching) {
        return false;
      }

      if (VTimestamp_le(store_elem.store_timestamp, vclock_index(clocks.clock, store_elem.store_thread))) {
        // CoWR: if a store happens-before the current load,
        // then we can't read-from anything earlier in modification order.
        // C++20 §6.9.2.2 [intro.races] paragraph 18
        keep_searching = false;
      } else if (
        any_load_happens_before(store_elem.load_info, clocks.clock)
      ) {
        // CoRR: if there was a load from this store which happened-before the current load,
        // then we cannot read-from anything earlier in modification order.
        // C++20 §6.9.2.2 [intro.races] paragraph 16
        keep_searching = false;
      } else if (VTimestamp_le(store_elem.store_timestamp, vclock_index(clocks.write_seqcst, store_elem.store_thread)) && store_elem.is_seqcst) {
        // The current non-SC load, which may be sequenced-after an SC fence,
        // cannot read-before the last SC store executed before the fence.
        // C++17 §32.4 [atomics.order] paragraph 4
        keep_searching = false;
      } else if (is_seqcst && VTimestamp_le(store_elem.store_timestamp, vclock_index(clocks.read_seqcst, store_elem.store_thread))) {
        // The current SC load cannot read-from any but the last store sequenced-before
        // the last SC fence.
        // C++17 §32.4 [atomics.order] paragraph 5
        keep_searching = false;
      } else if (is_seqcst && store_elem.load_info.sc_loaded) {
        // The current SC load cannot read-before a store that an earlier SC load has observed.
        // See https://github.com/rust-lang/miri/issues/2301#issuecomment-1222720427.
        // Consequences of C++20 §31.4 [atomics.order] paragraph 3.1, 3.3 (coherence-ordered before)
        // and 4.1 (coherence-ordered before between SC makes global total order S).
        keep_searching = false;
      } else {
        keep_searching = true;
      }

      return true;
    },
    (store_elem) => {
      if (is_seqcst && store_elem.is_seqcst) {
        // An SC load needs to ignore all but last store marked SC (stores not marked SC are not
        // affected)
        const include = !found_sc;
        found_sc = true;
        return include;
      } else {
        return true;
      }
    },
  );

  const chosen = unwrap(IteratorRandom.choose(candidates, rng), "store buffer cannot be empty");
  if (chosen === unwrap(this.buffer[this.buffer.length - 1], "store buffer cannot be empty")) {
    return [chosen, LoadRecency.Latest];
  } else {
    return [chosen, LoadRecency.Outdated];
  }
};

/// ATOMIC STORE IMPL in the paper
// rustc: src/tools/miri/src/concurrency/weak_memory.rs:422 store_impl
StoreBuffer.prototype.store_impl = function (this: StoreBuffer, val: Scalar, index: VectorIdx, thread_clock: VClock, is_seqcst: boolean, sync_clock: VClock): void {
  const store_elem = new StoreElement(
    index,
    // PORT: `VTimestamp` is `Copy` (vector_clock.ts header): the element owns a copy, not the thread's live slot, which
    // `increment_clock` mutates in place.
    clone_VTimestamp(vclock_index(thread_clock, index)),
    sync_clock,
    is_seqcst,
    // In the language provided in the paper, an atomic store takes the value from a
    // non-atomic memory location.
    // But we already have the immediate value here so we don't need to do the memory
    // access.
    val,
    LoadInfo_default(),
  );
  if (this.buffer.length >= STORE_BUFFER_LIMIT) {
    this.buffer.shift();
  }
  this.buffer.push(store_elem);
  if (is_seqcst) {
    // Every store that happens-before or is coherence-ordered before the ongoing SC store
    // needs to be marked as SC, so that in a later SC load, only the latest SC-marked store
    // or unmarked stores can be picked.
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      const elem = this.buffer[i]!;
      if (VTimestamp_le(elem.store_timestamp, vclock_index(thread_clock, elem.store_thread))) {
        // This store happens-before the ongoing SC store.
        elem.is_seqcst = true;
      } else if (any_load_happens_before(elem.load_info, thread_clock)) {
        // This store has a load which happens before the ongoing store.
        // This store must precede the onging store in modification order,
        // and is therefore coherence-ordered before the ongoing SC store.
        elem.is_seqcst = true;
      }
    }
  }
};

// impl StoreElement
/// ATOMIC LOAD IMPL in the paper
/// Unlike the operational semantics in the paper, we don't need to keep track
/// of the thread timestamp for every single load. Keeping track of the first (smallest)
/// timestamp of each thread that has loaded from a store is sufficient: if the earliest
/// load of another thread happens before the current one, then we must stop searching the store
/// buffer regardless of subsequent loads by the same thread; if the earliest load of another
/// thread doesn't happen before the current one, then no subsequent load by the other thread
/// can happen before the current one.
// rustc: src/tools/miri/src/concurrency/weak_memory.rs:480 load_impl
StoreElement.prototype.load_impl = function (this: StoreElement, index: VectorIdx, clocks: ThreadClockSet, is_seqcst: boolean): Scalar | undefined {
  const load_info = this.load_info;
  load_info.sc_loaded ||= is_seqcst;
  // let _ = load_info.timestamps.try_insert(index, clocks.clock[index]);
  if (!load_info.timestamps.has(index)) {
    // PORT: a copy of the `Copy` `VTimestamp`, not the thread's live clock slot (see store_impl).
    load_info.timestamps.set(index, clone_VTimestamp(vclock_index(clocks.clock, index)));
  }
  return this.val;
};

/** `if let Self::Vclocks(_data_race, weak_memory) = self { weak_memory.as_ref() } else { None }` (header). */
function as_weak_memory_ref(h: AllocDataRaceHandler): StoreBufferAlloc | undefined {
  return h.$ === "Vclocks" ? h._1 : undefined;
}

// impl<'tcx> EvalContextExt<'tcx> for crate::MiriInterpCx<'tcx> {}
// pub(super) trait EvalContextExt<'tcx>: crate::MiriInterpCxExt<'tcx>
/// Update the store buffer after an RMW.
/// Does nothing if we are currently not detecting races (e.g. single-threaded mode).
// rustc: src/tools/miri/src/concurrency/weak_memory.rs:497 buffered_atomic_rmw
InterpCx.prototype.buffered_atomic_rmw = function (this: MiriInterpCx, new_val: Scalar, place: MPlaceTy, atomic: AtomicRwOrd, init: Scalar): InterpResult {
  const this_ = this.eval_context_mut();
  const got = this_.ptr_get_alloc_id(place.ptr(), 0n);
  if (got.$ === "Err") return got;
  const [alloc_id, base_offset] = got._0;
  const em = this_.get_alloc_extra_mut(alloc_id);
  if (em.$ === "Err") return em;
  const [alloc_extra, machine] = em._0;
  if (
    alloc_extra.data_race.$ === "Vclocks" &&
    alloc_extra.data_race._1 !== undefined &&
    machine.data_race.$ === "Vclocks" &&
    machine.data_race._0.race_detecting()
  ) {
    const data_race_clocks = alloc_extra.data_race._0;
    const alloc_buffers = alloc_extra.data_race._1;
    const global = machine.data_race._0;
    const threads = machine.threads;
    if (atomic === "SeqCst") {
      global.sc_read(threads);
      global.sc_write(threads);
    }
    const range = alloc_range(base_offset, place.layout.size);
    const sync_clock = data_race_clocks.sync_clock(range);
    const br = alloc_buffers.get_or_create_store_buffer_mut(range, init);
    if (br.$ === "Err") return br;
    const buffer = br._0;
    // The RMW always reads from the most recent store.
    buffer.read_from_last_store(global, threads, atomic === "SeqCst");
    const w = buffer.buffered_write(new_val, global, threads, atomic === "SeqCst", sync_clock);
    if (w.$ === "Err") return w;
  }
  return interp_ok(undefined);
};

/// Perform a store buffer load. Returning `None` indicates a read of uninitialized memory.
/// Does nothing if we are currently not detecting races (e.g. single-threaded mode).
///
/// `latest_in_mo` must be the most recent value according to the mo relation.
/// The argument to `validate` is the synchronization clock of the memory that is being read,
/// if we are reading from a store buffer element.
// rustc: src/tools/miri/src/concurrency/weak_memory.rs:543 buffered_atomic_read
InterpCx.prototype.buffered_atomic_read = function (
  this: MiriInterpCx,
  place: MPlaceTy,
  atomic: AtomicReadOrd,
  latest_in_mo: Scalar,
  validate: (_0: VClock | undefined) => InterpResult,
): InterpResult<Scalar | undefined> {
  const this_ = this.eval_context_ref();
  fallback: {
    const dr = this_.machine.data_race;
    const global = dr.$ === "Vclocks" ? dr._0 : undefined; // as_vclocks_ref() (header)
    if (global !== undefined && global.race_detecting()) {
      const got = this_.ptr_get_alloc_id(place.ptr(), 0n);
      if (got.$ === "Err") return got;
      const [alloc_id, base_offset] = got._0;
      const er = this_.get_alloc_extra(alloc_id);
      if (er.$ === "Err") return er;
      const alloc_buffers = as_weak_memory_ref(er._0.data_race);
      if (alloc_buffers !== undefined) {
        if (atomic === "SeqCst") {
          global.sc_read(this_.machine.threads);
        }
        const rng = this_.machine.rng as unknown as Rng; // `this.machine.rng.borrow_mut()`
        const bf = alloc_buffers.get_store_buffer(alloc_range(base_offset, place.layout.size));
        if (bf.$ === "Err") return bf;
        const buffer = bf._0;
        if (buffer === undefined) {
          // No old writes available, fall back to base case.
          break fallback;
        }
        const rr = buffer.buffered_read(global, this_.machine.threads, atomic === "SeqCst", rng, validate);
        if (rr.$ === "Err") return rr;
        const [loaded, recency] = rr._0;
        if (global.track_outdated_loads && recency === LoadRecency.Outdated) {
          this_.emit_diagnostic({ $: "WeakMemoryOutdatedLoad", ptr: place.ptr() });
        }

        return interp_ok(loaded);
      }
    }
  }

  // Race detector or weak memory disabled, simply read the latest value
  const v = validate(undefined);
  if (v.$ === "Err") return v;
  return interp_ok(latest_in_mo);
};

/// Add the given write to the store buffer. (Does not change machine memory.)
/// Must only be called after we determined that there is no data race or mixed-size race.
/// Does nothing if we are currently not detecting races (e.g. single-threaded mode).
///
/// `init` says with which value to initialize the store buffer in case there wasn't a store
/// buffer for this memory range before. `None` means the memory does not contain a valid
/// scalar.
///
/// Must be called *after* `validate_atomic_store` to ensure that `sync_clock` is up-to-date.
// rustc: src/tools/miri/src/concurrency/weak_memory.rs:601 buffered_atomic_write
InterpCx.prototype.buffered_atomic_write = function (this: MiriInterpCx, val: Scalar, dest: MPlaceTy, atomic: AtomicWriteOrd, init: Scalar | undefined): InterpResult {
  const this_ = this.eval_context_mut();
  const got = this_.ptr_get_alloc_id(dest.ptr(), 0n);
  if (got.$ === "Err") return got;
  const [alloc_id, base_offset] = got._0;
  const em = this_.get_alloc_extra_mut(alloc_id);
  if (em.$ === "Err") return em;
  const [alloc_extra, machine] = em._0;
  if (
    alloc_extra.data_race.$ === "Vclocks" &&
    alloc_extra.data_race._1 !== undefined &&
    machine.data_race.$ === "Vclocks" &&
    machine.data_race._0.race_detecting()
  ) {
    const data_race_clocks = alloc_extra.data_race._0;
    const alloc_buffers = alloc_extra.data_race._1;
    const global = machine.data_race._0;
    const threads = machine.threads;
    if (atomic === "SeqCst") {
      global.sc_write(threads);
    }

    const range = alloc_range(base_offset, dest.layout.size);
    // It's a bit annoying that we have to go back to the data race part to get the clock...
    // but it does make things a lot simpler.
    const sync_clock = data_race_clocks.sync_clock(range);
    const br = alloc_buffers.get_or_create_store_buffer_mut(range, init);
    if (br.$ === "Err") return br;
    const buffer = br._0;
    const w = buffer.buffered_write(val, global, threads, atomic === "SeqCst", sync_clock);
    if (w.$ === "Err") return w;
  }

  // Caller should've written to dest with the vanilla scalar write, we do nothing here
  return interp_ok(undefined);
};

/// Caller should never need to consult the store buffer for the latest value.
/// This function is used exclusively for failed atomic_compare_exchange_scalar
/// to perform load_impl on the latest store element
// rustc: src/tools/miri/src/concurrency/weak_memory.rs:646 perform_read_on_buffered_latest
InterpCx.prototype.perform_read_on_buffered_latest = function (this: MiriInterpCx, place: MPlaceTy, atomic: AtomicReadOrd): InterpResult {
  const this_ = this.eval_context_ref();

  const dr = this_.machine.data_race;
  const global = dr.$ === "Vclocks" ? dr._0 : undefined; // as_vclocks_ref() (header)
  if (global !== undefined) {
    if (atomic === "SeqCst") {
      global.sc_read(this_.machine.threads);
    }
    const size = place.layout.size;
    const got = this_.ptr_get_alloc_id(place.ptr(), 0n);
    if (got.$ === "Err") return got;
    const [alloc_id, base_offset] = got._0;
    const er = this_.get_alloc_extra(alloc_id);
    if (er.$ === "Err") return er;
    const alloc_buffers = as_weak_memory_ref(er._0.data_race);
    if (alloc_buffers !== undefined) {
      const bf = alloc_buffers.get_store_buffer(alloc_range(base_offset, size));
      if (bf.$ === "Err") return bf;
      const buffer = bf._0;
      if (buffer === undefined) {
        // No store buffer, nothing to do.
        return interp_ok(undefined);
      }
      buffer.read_from_last_store(global, this_.machine.threads, atomic === "SeqCst");
    }
  }
  return interp_ok(undefined);
};
