//! Manages a pool of addresses that can be reused.
// Port of src/tools/miri/src/alloc_addresses/reuse_pool.rs (crate `miri`, plan-m6 D2). Fill lane: `miri-alloc` (plan-m6 wave 36).
// Its types are generated into reuse_pool.gen.ts (tools/codegen set `miri`); this module re-exports them.
// PORT: the rng is rand_core's `Rng` (the vendored rand, lane vendor-rand): `random_bool(p)` is `RngExt.random_bool`, the
// `usize` draw `random_range(begin..end)` is `Range(SampleUniform_usize, ..)`. `(Size, ThreadId)` compares
// lexicographically with the derived `Ord`s (`Size_cmp`, then `ThreadId.0`).
import { ReusePool } from "./reuse_pool.gen.ts";
import { type ThreadId } from "../concurrency/thread.ts";
import { type VClock } from "../concurrency/vector_clock.ts";
import { type MiriConfig } from "../eval.ts";
import { type MemoryKind } from "../machine.ts";
import { type Align, type Size, Size_cmp, Size_eq } from "../../rustc_abi/lib.ts";
import { partition_point } from "../../std/slice.ts";
import { type Rng } from "../../vendor/rand_core/lib.ts";
import { RngExt } from "../../vendor/rand/rng.ts";
import { Range } from "../../vendor/rand/distr/uniform.ts";
import { SampleUniform_usize } from "../../vendor/rand/distr/uniform_int.ts";
export * from "./reuse_pool.gen.ts";

const MAX_POOL_SIZE = 64;

/** The derived `Ord` of `(Size, ThreadId)`: `a < b`. */
function size_thread_lt(a_size: Size, a_thread: ThreadId, b_size: Size, b_thread: ThreadId): boolean {
  const c = Size_cmp(a_size, b_size);
  return c < 0 || (c === 0 && a_thread._0 < b_thread._0);
}

declare module "./reuse_pool.gen.ts" {
  interface ReusePool {
    // alloc_addresses/reuse_pool.rs:43
    address_space_shortage(): void;
    // alloc_addresses/reuse_pool.rs:49
    subpool(align: Align): ([bigint, Size, ThreadId, VClock])[];
    // alloc_addresses/reuse_pool.rs:57
    add_addr(rng: Rng, addr: bigint, size: Size, align: Align, kind: MemoryKind, thread: ThreadId, clock: (() => VClock)): void;
    // alloc_addresses/reuse_pool.rs:90
    take_addr(rng: Rng, size: Size, align: Align, kind: MemoryKind, thread: ThreadId): [bigint, VClock | undefined] | undefined;
  }
  namespace ReusePool {
    // alloc_addresses/reuse_pool.rs:32
    function new_(config: MiriConfig): ReusePool;
    export { new_ as new };
  }
}

// rustc: src/tools/miri/src/alloc_addresses/reuse_pool.rs:32 new
(ReusePool as unknown as { new: (config: MiriConfig) => ReusePool }).new = function (config: MiriConfig): ReusePool {
  return new ReusePool(config.address_reuse_rate, config.address_reuse_cross_thread_rate, []);
};

/// Call this when we are using up a lot of the address space: if memory reuse is enabled at all,
/// this will bump the intra-thread reuse rate to 100% so that we can keep running this program as
/// long as possible.
// rustc: src/tools/miri/src/alloc_addresses/reuse_pool.rs:43 address_space_shortage
ReusePool.prototype.address_space_shortage = function (this: ReusePool): void {
  if (this.address_reuse_rate > 0.0) {
    this.address_reuse_rate = 1.0;
  }
};

// rustc: src/tools/miri/src/alloc_addresses/reuse_pool.rs:49 subpool
ReusePool.prototype.subpool = function (this: ReusePool, align: Align): ([bigint, Size, ThreadId, VClock])[] {
  // align.bytes().trailing_zeros()
  const pool_idx: number = align.pow2;
  if (this.pool.length <= pool_idx) {
    // self.pool.resize(pool_idx + 1, Vec::new());
    while (this.pool.length < pool_idx + 1) this.pool.push([]);
  }
  return this.pool[pool_idx]!;
};

// rustc: src/tools/miri/src/alloc_addresses/reuse_pool.rs:57 add_addr
ReusePool.prototype.add_addr = function (
  this: ReusePool,
  rng: Rng,
  addr: bigint,
  size: Size,
  align: Align,
  kind: MemoryKind,
  thread: ThreadId,
  clock_: () => VClock,
): void {
  // Let's see if we even want to remember this address.
  // We don't remember stack addresses since there's so many of them (so the perf impact is big).
  if (kind.$ === "Stack" || !RngExt.random_bool(rng, this.address_reuse_rate)) {
    return;
  }
  const clock = clock_();
  // Determine the pool to add this to, and where in the pool to put it.
  const subpool = this.subpool(align);
  const pos = partition_point(subpool, ([_addr, other_size, other_thread, _]) =>
    size_thread_lt(other_size, other_thread, size, thread),
  );
  // Make sure the pool does not grow too big.
  if (subpool.length >= MAX_POOL_SIZE) {
    // Pool full. Replace existing element, or last one if this would be even bigger.
    const clamped_pos = Math.min(pos, subpool.length - 1);
    subpool[clamped_pos] = [addr, size, thread, clock];
    return;
  }
  // Add address to pool, at the right position.
  subpool.splice(pos, 0, [addr, size, thread, clock]);
};

/// Returns the address to use and optionally a clock we have to synchronize with.
// rustc: src/tools/miri/src/alloc_addresses/reuse_pool.rs:90 take_addr
ReusePool.prototype.take_addr = function (
  this: ReusePool,
  rng: Rng,
  size: Size,
  align: Align,
  kind: MemoryKind,
  thread: ThreadId,
): [bigint, VClock | undefined] | undefined {
  // Determine whether we'll even attempt a reuse. As above, we don't do reuse for stack addresses.
  if (kind.$ === "Stack" || !RngExt.random_bool(rng, this.address_reuse_rate)) {
    return undefined;
  }
  const cross_thread_reuse = RngExt.random_bool(rng, this.address_reuse_cross_thread_rate);
  // Determine the pool to take this from.
  const subpool = this.subpool(align);
  // Let's see if we can find something of the right size. We want to find the full range of
  // such items, beginning with the first, so we can't use `binary_search_by_key`. If we do
  // *not* want to consider other thread's allocations, we effectively use the lexicographic
  // order on `(size, thread)`.
  const begin = partition_point(subpool, ([_addr, other_size, other_thread, _]) => {
    const c = Size_cmp(other_size, size);
    return c < 0 || (c === 0 && !cross_thread_reuse && other_thread._0 < thread._0);
  });
  let end = begin;
  for (;;) {
    const e = subpool[end];
    if (e === undefined) break;
    const [_addr, other_size, other_thread, _] = e;
    if (!Size_eq(other_size, size)) {
      break;
    }
    if (!cross_thread_reuse && other_thread._0 !== thread._0) {
      // We entered the allocations of another thread.
      break;
    }
    end += 1;
  }
  if (end === begin) {
    // Could not find any item of the right size.
    return undefined;
  }
  // Pick a random element with the desired size.
  const idx = RngExt.random_range(rng, new Range(SampleUniform_usize, begin, end));
  // Remove it from the pool and return.
  const [chosen_addr, chosen_size, chosen_thread, clock] = subpool.splice(idx, 1)[0]!;
  // debug_assert!(chosen_size >= size && chosen_addr.is_multiple_of(align.bytes()));
  // debug_assert!(cross_thread_reuse || chosen_thread == thread);
  void chosen_size;
  // No synchronization needed if we reused from the current thread.
  return [chosen_addr, chosen_thread._0 === thread._0 ? undefined : clock];
};
