// Port of src/tools/miri/src/borrow_tracker/stacked_borrows/stack.rs (crate `miri`, plan-m6 D2). Fill lane: `miri-sb` (plan-m6
// wave 36). Its types are generated into stack.gen.ts (tools/codegen set `miri`); this module re-exports them.
//
// PORT (cfg): the release Miri (the rustup `miri` component, the oracle) is built with Miri's default cargo features,
// `stack-cache` and `native-lib` (src/tools/miri/Cargo.toml `default`; bootstrap's `tool_rustc_extended!(Miri ..)` adds
// none), so the `#[cfg(feature = "stack-cache")]` paths are ported as compiled and the `#[cfg(not(feature =
// "stack-cache"))]` lines are comments. `expensive-consistency-checks` is off: `verify_cache_consistency` is ported (it is a
// fn of the file) but its call sites are comments, as compiled.
// PORT: `[Item; CACHE_LEN]` / `[usize; CACHE_LEN]` are arrays of exactly CACHE_LEN entries; `Item` is `Copy`, so every
// copy into or out of the cache is `clone_Item` (item.ts header): `set_permission` on a stack item must not reach a cache
// slot (or vice versa) except where upstream updates both.
import { type AccessKind, type BorTag } from "../mod.ts";
import { clone_Item, debug_Item, type Item, Item_eq, Permission } from "./item.ts";
import { Permission_grants } from "./mod.ts";
import { Stack, StackCache } from "./stack.gen.ts";
import { type ProvenanceExtra } from "../../machine.ts";
import { interp_ok, type InterpResult } from "../../../rustc_middle/mir/interpret/mod.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { assert, assert_eq } from "../../../std/panic.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
export * from "./stack.gen.ts";

/// Exactly what cache size we should use is a difficult trade-off. There will always be some
/// workload which has a `BorTag` working set which exceeds the size of the cache, and ends up
/// falling back to linear searches of the borrow stack very often.
/// The cost of making this value too large is that the loop in `Stack::insert` which ensures the
/// entries in the cache stay correct after an insert becomes expensive.
// #[cfg(feature = "stack-cache")]
const CACHE_LEN = 32;

declare module "./stack.gen.ts" {
  interface Stack {
    // borrow_tracker/stacked_borrows/stack.rs:45
    retain(tags: Set<BorTag>): void;
    // borrow_tracker/stacked_borrows/stack.rs:157
    verify_cache_consistency(): void;
    // borrow_tracker/stacked_borrows/stack.rs:194
    find_granting(access: AccessKind, tag: ProvenanceExtra, exposed_tags: Set<BorTag>): Result<number | undefined, null>;
    // borrow_tracker/stacked_borrows/stack.rs:237
    find_granting_tagged(access: AccessKind, tag: BorTag): number | undefined;
    // borrow_tracker/stacked_borrows/stack.rs:256
    find_granting_cache(access: AccessKind, tag: BorTag): number | undefined;
    // borrow_tracker/stacked_borrows/stack.rs:295
    insert(new_idx: number, new_: Item): void;
    // borrow_tracker/stacked_borrows/stack.rs:303
    insert_cache(new_idx: number, new_: Item): void;
    // borrow_tracker/stacked_borrows/stack.rs:353
    get(idx: number): Item | undefined;
    // borrow_tracker/stacked_borrows/stack.rs:358
    len(): number;
    // borrow_tracker/stacked_borrows/stack.rs:362 // PORT: `unknown_bottom_` (a field `unknown_bottom` exists; mir-contract rule)
    unknown_bottom_(): BorTag | undefined;
    // borrow_tracker/stacked_borrows/stack.rs:366
    set_unknown_bottom(tag: BorTag): void;
    // borrow_tracker/stacked_borrows/stack.rs:380
    disable_uniques_starting_at(disable_start: number, visitor: (_0: Item) => InterpResult): InterpResult;
    // borrow_tracker/stacked_borrows/stack.rs:428
    pop_items_after(start: number, visitor: (_0: Item) => InterpResult): InterpResult;
  }
  namespace Stack {
    // borrow_tracker/stacked_borrows/stack.rs:342
    function new_(item: Item): Stack;
    export { new_ as new };
  }
}
declare module "./stack.gen.ts" {
  interface StackCache {
    // borrow_tracker/stacked_borrows/stack.rs:127
    add(idx: number, item: Item): void;
  }
}

// impl Stack
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/stack.rs:45 retain
Stack.prototype.retain = function (this: Stack, tags: Set<BorTag>): void {
  let first_removed: number | undefined = undefined;

  // We never consider removing the bottom-most tag. For stacks without an unknown
  // bottom this preserves the root tag.
  // Note that the algorithm below is based on considering the tag at read_idx - 1,
  // so precisely considering the tag at index 0 for removal when we have an unknown
  // bottom would complicate the implementation. The simplification of not considering
  // it does not have a significant impact on the degree to which the GC mitigates
  // memory growth.
  let read_idx = 1;
  let write_idx = read_idx;
  while (read_idx < this.borrows.length) {
    const left = this.borrows[read_idx - 1]!;
    const this_ = this.borrows[read_idx]!;
    let should_keep: boolean;
    switch (this_.perm()) {
      // SharedReadWrite is the simplest case, if it's unreachable we can just remove it.
      case "SharedReadWrite":
        should_keep = tags.has(this_.tag());
        break;
      // Only retain a Disabled tag if it is terminating a SharedReadWrite block.
      case "Disabled":
        should_keep = left.perm() === Permission.SharedReadWrite;
        break;
      // Unique and SharedReadOnly can terminate a SharedReadWrite block, so only remove
      // them if they are both unreachable and not directly after a SharedReadWrite.
      case "Unique":
      case "SharedReadOnly":
        should_keep = left.perm() === Permission.SharedReadWrite || tags.has(this_.tag());
        break;
    }

    if (should_keep) {
      if (read_idx !== write_idx) {
        // PORT: a move within the vector (the slot at `read_idx` is overwritten or truncated later), so no clone.
        this.borrows[write_idx] = this.borrows[read_idx]!;
      }
      write_idx += 1;
    } else if (first_removed === undefined) {
      first_removed = read_idx;
    }

    read_idx += 1;
  }
  this.borrows.length = write_idx;

  // #[cfg(not(feature = "stack-cache"))]
  // let _unused = first_removed; // This is only needed for the stack-cache

  // #[cfg(feature = "stack-cache")]
  if (first_removed !== undefined) {
    // Either end of unique_range may have shifted, all we really know is that we can't
    // have introduced a new Unique.
    if (!(this.unique_range.start >= this.unique_range.end)) {
      this.unique_range = { start: 0, end: this.len() };
    }

    // Replace any Items which have been collected with the root item, a known-good value.
    for (let i = 0; i < CACHE_LEN; i++) {
      if (this.cache.idx[i]! >= first_removed) {
        this.cache.items[i] = clone_Item(this.borrows[0]!);
        this.cache.idx[i] = 0;
      }
    }
  }
};

/// A very small cache of searches of a borrow stack, mapping `Item`s to their position in said stack.
///
/// It may seem like maintaining this cache is a waste for small stacks, but
/// (a) iterating over small fixed-size arrays is super fast, and (b) empirically this helps *a lot*,
/// probably because runtime is dominated by large stacks.
// #[cfg(feature = "stack-cache")]
// impl StackCache
/// When a tag is used, we call this function to add or refresh it in the cache.
///
/// We use the position in the cache to represent how recently a tag was used; the first position
/// is the most recently used tag. So an add shifts every element towards the end, and inserts
/// the new element at the start. We lose the last element.
/// This strategy is effective at keeping the most-accessed items in the cache, but it costs a
/// linear shift across the entire cache when we add a new tag.
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/stack.rs:127 add
StackCache.prototype.add = function (this: StackCache, idx: number, item: Item): void {
  // self.items.copy_within(0..CACHE_LEN - 1, 1);
  this.items.copyWithin(1, 0, CACHE_LEN - 1);
  this.items[0] = item;
  // self.idx.copy_within(0..CACHE_LEN - 1, 1);
  this.idx.copyWithin(1, 0, CACHE_LEN - 1);
  this.idx[0] = idx;
};

// impl PartialEq for Stack
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/stack.rs:136 eq
export function Stack_eq(self: Stack, other: Stack): boolean {
  // let Stack { borrows, unknown_bottom, cache: _, unique_range: _ } = self;
  // The cache is ignored for comparison.
  const borrows = self.borrows;
  const unknown_bottom = self.unknown_bottom;
  return (
    borrows.length === other.borrows.length &&
    borrows.every((b, i) => Item_eq(b, other.borrows[i]!)) &&
    unknown_bottom === other.unknown_bottom
  );
}

// impl Eq for Stack {}

// impl<'tcx> Stack
/// Panics if any of the caching mechanisms have broken,
/// - The StackCache indices don't refer to the parallel items,
/// - There are no Unique items outside of first_unique..last_unique
// #[cfg(feature = "expensive-consistency-checks")]
// PORT (cfg, header): compiled out of the release Miri; ported for completeness, never called.
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/stack.rs:157 verify_cache_consistency
Stack.prototype.verify_cache_consistency = function (this: Stack): void {
  // Only a full cache needs to be valid. Also see the comments in find_granting_cache
  // and set_unknown_bottom.
  if (this.borrows.length >= CACHE_LEN) {
    for (let i = 0; i < CACHE_LEN; i++) {
      const tag = this.cache.items[i]!;
      const stack_idx = this.cache.idx[i]!;
      assert_eq(this.borrows[stack_idx], tag, (v) => (v === undefined ? "None" : debug_Item(v, PLAIN)), (a, b) => a !== undefined && b !== undefined && Item_eq(a, b));
    }
  }

  // Check that all Unique items fall within unique_range.
  for (let idx = 0; idx < this.borrows.length; idx++) {
    const item = this.borrows[idx]!;
    if (item.perm() === Permission.Unique) {
      assert(
        this.unique_range.start <= idx && idx < this.unique_range.end,
        () => `${this.unique_range.start}..${this.unique_range.end} [${this.borrows.map((b) => debug_Item(b, PLAIN)).join(", ")}]`,
      );
    }
  }

  // Check that the unique_range is a valid index into the borrow stack.
  // This asserts that the unique_range's start <= end.
  // let _uniques = &self.borrows[self.unique_range.clone()];
  assert(
    this.unique_range.start <= this.unique_range.end && this.unique_range.end <= this.borrows.length,
    () => `range ${this.unique_range.start}..${this.unique_range.end} out of range for slice of length ${this.borrows.length}`,
  );

  // We cannot assert that the unique range is precise.
  // Both ends may shift around when `Stack::retain` is called. Additionally,
  // when we pop items within the unique range, setting the end of the range precisely
  // requires doing a linear search of the borrow stack, which is exactly the kind of
  // operation that all this caching exists to avoid.
};

/// Find the item granting the given kind of access to the given tag, and return where
/// it is on the stack. For wildcard tags, the given index is approximate, but if *no*
/// index is given it means the match was *not* in the known part of the stack.
/// `Ok(None)` indicates it matched the "unknown" part of the stack.
/// `Err` indicates it was not found.
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/stack.rs:194 find_granting
Stack.prototype.find_granting = function (this: Stack, access: AccessKind, tag: ProvenanceExtra, exposed_tags: Set<BorTag>): Result<number | undefined, null> {
  // #[cfg(feature = "expensive-consistency-checks")]
  // self.verify_cache_consistency();

  if (tag.$ !== "Concrete") {
    // Handle the wildcard case.
    // Go search the stack for an exposed tag.
    // we also need to know *where* in the stack; search top-to-bottom
    for (let idx = this.borrows.length - 1; idx >= 0; idx--) {
      const item = this.borrows[idx]!;
      // If the item fits and *might* be this wildcard, use it.
      if (Permission_grants(item.perm(), access) && exposed_tags.has(item.tag())) {
        return Ok(idx);
      }
    }
    // If we couldn't find it in the stack, check the unknown bottom.
    return this.unknown_bottom !== undefined ? Ok(undefined) : Err(null);
  }
  const tag_ = tag._0;

  const idx = this.find_granting_tagged(access, tag_);
  if (idx !== undefined) {
    return Ok(idx);
  }

  // Couldn't find it in the stack; but if there is an unknown bottom it might be there.
  const unknown_limit = this.unknown_bottom;
  const found =
    unknown_limit !== undefined &&
    tag_ < unknown_limit; // unknown_limit is an upper bound for what can be in the unknown bottom.
  if (found) {
    return Ok(undefined);
  } else {
    return Err(null);
  }
};

// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/stack.rs:237 find_granting_tagged
Stack.prototype.find_granting_tagged = function (this: Stack, access: AccessKind, tag: BorTag): number | undefined {
  // #[cfg(feature = "stack-cache")]
  const cached = this.find_granting_cache(access, tag);
  if (cached !== undefined) {
    return cached;
  }

  // If we didn't find the tag in the cache, fall back to a linear search of the
  // whole stack, and add the tag to the cache.
  for (let stack_idx = this.borrows.length - 1; stack_idx >= 0; stack_idx--) {
    const item = this.borrows[stack_idx]!;
    if (tag === item.tag() && Permission_grants(item.perm(), access)) {
      // #[cfg(feature = "stack-cache")]
      this.cache.add(stack_idx, clone_Item(item));
      return stack_idx;
    }
  }
  return undefined;
};

// #[cfg(feature = "stack-cache")]
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/stack.rs:256 find_granting_cache
Stack.prototype.find_granting_cache = function (this: Stack, access: AccessKind, tag: BorTag): number | undefined {
  // This looks like a common-sense optimization; we're going to do a linear search of the
  // cache or the borrow stack to scan the shorter of the two. This optimization is minuscule
  // and this check actually ensures we do not access an invalid cache.
  // When a stack is created and when items are removed from the top of the borrow stack, we
  // need some valid value to populate the cache. In both cases, we try to use the bottom
  // item. But when the stack is cleared in `set_unknown_bottom` there is nothing we could
  // place in the cache that is correct. But due to the way we populate the cache in
  // `StackCache::add`, we know that when the borrow stack has grown larger than the cache,
  // every slot in the cache is valid.
  if (this.borrows.length <= CACHE_LEN) {
    return undefined;
  }
  // Search the cache for the tag we're looking up
  // let cache_idx = self.cache.items.iter().position(|t| t.tag() == tag)?;
  let cache_idx = -1;
  const items = this.cache.items;
  for (let i = 0; i < CACHE_LEN; i++) {
    if (items[i]!.tag() === tag) {
      cache_idx = i;
      break;
    }
  }
  if (cache_idx === -1) return undefined;
  const stack_idx = this.cache.idx[cache_idx]!;
  // If we found the tag, look up its position in the stack to see if it grants
  // the required permission
  if (Permission_grants(this.cache.items[cache_idx]!.perm(), access)) {
    // If it does, and it's not already in the most-recently-used position, re-insert it at
    // the most-recently-used position. This technically reduces the efficiency of the
    // cache by duplicating elements, but current benchmarks do not seem to benefit from
    // avoiding this duplication.
    // But if the tag is in position 1, avoiding the duplicating add is trivial.
    // If it does, and it's not already in the most-recently-used position, move it there.
    // Except if the tag is in position 1, this is equivalent to just a swap, so do that.
    if (cache_idx === 1) {
      // self.cache.items.swap(0, 1);
      const it = this.cache.items[0]!;
      this.cache.items[0] = this.cache.items[1]!;
      this.cache.items[1] = it;
      // self.cache.idx.swap(0, 1);
      const ix = this.cache.idx[0]!;
      this.cache.idx[0] = this.cache.idx[1]!;
      this.cache.idx[1] = ix;
    } else if (cache_idx > 1) {
      this.cache.add(stack_idx, clone_Item(this.cache.items[cache_idx]!));
    }
    return stack_idx;
  } else {
    // Tag is in the cache, but it doesn't grant the required permission
    return undefined;
  }
};

// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/stack.rs:295 insert
Stack.prototype.insert = function (this: Stack, new_idx: number, new_: Item): void {
  // `Vec::insert` panics past the end.
  assert(new_idx <= this.borrows.length, () => `insertion index (is ${new_idx}) should be <= len (is ${this.borrows.length})`);
  this.borrows.splice(new_idx, 0, new_);

  // #[cfg(feature = "stack-cache")]
  this.insert_cache(new_idx, clone_Item(new_));
};

// #[cfg(feature = "stack-cache")]
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/stack.rs:303 insert_cache
Stack.prototype.insert_cache = function (this: Stack, new_idx: number, new_: Item): void {
  // Adjust the possibly-unique range if an insert occurs before or within it
  if (this.unique_range.start >= new_idx) {
    this.unique_range.start += 1;
  }
  if (this.unique_range.end >= new_idx) {
    this.unique_range.end += 1;
  }
  if (new_.perm() === Permission.Unique) {
    // If this is the only Unique, set the range to contain just the new item.
    if (this.unique_range.start >= this.unique_range.end) {
      this.unique_range = { start: new_idx, end: new_idx + 1 };
    } else {
      // We already have other Unique items, expand the range to include the new item
      this.unique_range.start = Math.min(this.unique_range.start, new_idx);
      this.unique_range.end = Math.max(this.unique_range.end, new_idx + 1);
    }
  }

  // The above insert changes the meaning of every index in the cache >= new_idx, so now
  // we need to find every one of those indexes and increment it.
  // But if the insert is at the end (equivalent to a push), we can skip this step because
  // it didn't change the position of any other items.
  if (new_idx !== this.borrows.length - 1) {
    const idx = this.cache.idx;
    for (let i = 0; i < CACHE_LEN; i++) {
      if (idx[i]! >= new_idx) {
        idx[i] = idx[i]! + 1;
      }
    }
  }

  // This primes the cache for the next access, which is almost always the just-added tag.
  this.cache.add(new_idx, new_);

  // #[cfg(feature = "expensive-consistency-checks")]
  // self.verify_cache_consistency();
};

/// Construct a new `Stack` using the passed `Item` as the root tag.
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/stack.rs:342 new
(Stack as unknown as { new: (item: Item) => Stack }).new = function (item: Item): Stack {
  const items: Item[] = new Array<Item>(CACHE_LEN);
  for (let i = 0; i < CACHE_LEN; i++) items[i] = clone_Item(item);
  return new Stack(
    [item],
    undefined,
    // #[cfg(feature = "stack-cache")]
    new StackCache(items, new Array<number>(CACHE_LEN).fill(0)),
    // #[cfg(feature = "stack-cache")]
    item.perm() === Permission.Unique ? { start: 0, end: 1 } : { start: 0, end: 0 },
  );
};

// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/stack.rs:353 get
Stack.prototype.get = function (this: Stack, idx: number): Item | undefined {
  // self.borrows.get(idx).cloned()
  const item = this.borrows[idx];
  return item === undefined ? undefined : clone_Item(item);
};

// #[expect(clippy::len_without_is_empty)] // Stacks are never empty
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/stack.rs:358 len
Stack.prototype.len = function (this: Stack): number {
  return this.borrows.length;
};

// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/stack.rs:362 unknown_bottom
Stack.prototype.unknown_bottom_ = function (this: Stack): BorTag | undefined {
  return this.unknown_bottom;
};

// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/stack.rs:366 set_unknown_bottom
Stack.prototype.set_unknown_bottom = function (this: Stack, tag: BorTag): void {
  // We clear the borrow stack but the lookup cache doesn't support clearing per se. Instead,
  // there is a check explained in `find_granting_cache` which protects against accessing the
  // cache when it has been cleared and not yet refilled.
  this.borrows.length = 0;
  this.unknown_bottom = tag;
  // #[cfg(feature = "stack-cache")]
  {
    this.unique_range = { start: 0, end: 0 };
  }
};

/// Find all `Unique` elements in this borrow stack above `granting_idx`, pass a copy of them
/// to the `visitor`, then set their `Permission` to `Disabled`.
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/stack.rs:380 disable_uniques_starting_at
Stack.prototype.disable_uniques_starting_at = function (this: Stack, disable_start: number, visitor: (_0: Item) => InterpResult): InterpResult {
  // #[cfg(feature = "stack-cache")]
  const unique_range = { start: this.unique_range.start, end: this.unique_range.end };
  // #[cfg(not(feature = "stack-cache"))]
  // let unique_range = 0..self.len();

  if (disable_start <= unique_range.end) {
    const lower = Math.max(unique_range.start, disable_start);
    const upper = unique_range.end;
    // `&mut self.borrows[lower..upper]` panics on an out-of-range slice.
    assert(lower <= upper && upper <= this.borrows.length, () => `range ${lower}..${upper} out of range for slice of length ${this.borrows.length}`);
    for (let i = lower; i < upper; i++) {
      const item = this.borrows[i]!;
      if (item.perm() === Permission.Unique) {
        // trace!("access: disabling item {:?}", item);
        const r = visitor(clone_Item(item));
        if (r.$ === "Err") return r;
        item.set_permission(Permission.Disabled);
        // Also update all copies of this item in the cache.
        // #[cfg(feature = "stack-cache")]
        const items = this.cache.items;
        for (let c = 0; c < CACHE_LEN; c++) {
          const it = items[c]!;
          if (it.tag() === item.tag()) {
            it.set_permission(Permission.Disabled);
          }
        }
      }
    }
  }

  // #[cfg(feature = "stack-cache")]
  if (disable_start <= this.unique_range.start) {
    // We disabled all Unique items
    this.unique_range.start = 0;
    this.unique_range.end = 0;
  } else {
    // Truncate the range to only include items up to the index that we started disabling
    // at.
    this.unique_range.end = Math.min(this.unique_range.end, disable_start);
  }

  // #[cfg(feature = "expensive-consistency-checks")]
  // self.verify_cache_consistency();

  return interp_ok(undefined);
};

/// Produces an iterator which iterates over `range` in reverse, and when dropped removes that
/// range of `Item`s from this `Stack`.
// rustc: src/tools/miri/src/borrow_tracker/stacked_borrows/stack.rs:428 pop_items_after
Stack.prototype.pop_items_after = function (this: Stack, start: number, visitor: (_0: Item) => InterpResult): InterpResult {
  while (this.borrows.length > start) {
    const item = this.borrows.pop()!;
    const r = visitor(item);
    if (r.$ === "Err") return r;
  }

  // #[cfg(feature = "stack-cache")]
  if (!(this.borrows.length === 0)) {
    // After we remove from the borrow stack, every aspect of our caching may be invalid, but it is
    // also possible that the whole cache is still valid. So we call this method to repair what
    // aspects of the cache are now invalid, instead of resetting the whole thing to a trivially
    // valid default state.
    const base_tag = this.borrows[0]!;
    let removed = 0;
    let cursor = 0;
    // Remove invalid entries from the cache by rotating them to the end of the cache, then
    // keep track of how many invalid elements there are and overwrite them with the root tag.
    // The root tag here serves as a harmless default value.
    const idx = this.cache.idx;
    const items = this.cache.items;
    for (let n = 0; n < CACHE_LEN - 1; n++) {
      if (idx[cursor]! >= start) {
        // self.cache.idx[cursor..CACHE_LEN - removed].rotate_left(1);
        // self.cache.items[cursor..CACHE_LEN - removed].rotate_left(1);
        const end = CACHE_LEN - removed;
        const first_idx = idx[cursor]!;
        const first_item = items[cursor]!;
        for (let k = cursor; k < end - 1; k++) {
          idx[k] = idx[k + 1]!;
          items[k] = items[k + 1]!;
        }
        idx[end - 1] = first_idx;
        items[end - 1] = first_item;
        removed += 1;
      } else {
        cursor += 1;
      }
    }
    for (let i = CACHE_LEN - removed - 1; i < CACHE_LEN; i++) {
      idx[i] = 0;
      items[i] = clone_Item(base_tag);
    }

    if (start <= this.unique_range.start) {
      // We removed all the Unique items
      this.unique_range = { start: 0, end: 0 };
    } else {
      // Ensure the range doesn't extend past the new top of the stack
      this.unique_range.end = Math.min(this.unique_range.end, start);
    }
  } else {
    this.unique_range = { start: 0, end: 0 };
  }

  // #[cfg(feature = "expensive-consistency-checks")]
  // self.verify_cache_consistency();
  return interp_ok(undefined);
};
