// Port of library/proc_macro/src/bridge/handle.rs
//
//! Server-side handles and storage for per-handle data.
//
// PORT: `&'static AtomicU32` counters are `MutRef<number>` cells (single-threaded); `fetch_add` wraps at 2^32.
// `BTreeMap<Handle, T>` is a `Map` (only looked up, never iterated). `InternedStore`'s `FxHashMap<T, Handle>` is a
// `Map` keyed on `T` itself, so `T` must be a primitive or an interned handle (the server's `Span`s are branded
// numbers).

import type { MutRef } from "../../std/mut_ref.ts";
import { assert, panic } from "../../std/panic.ts";
import type { FxHashMap } from "./fxhash.ts";

/** `NonZero<u32>` */
export type Handle = number;

/// A store that associates values of type `T` with numeric handles. A value can
/// be looked up using its handle.
// std-type: library/proc_macro/src/bridge/handle.rs:15 OwnedStore
export class OwnedStore<T> {
  constructor(
    public counter: MutRef<number>,
    public data: Map<Handle, T>,
  ) {}

  // std: library/proc_macro/src/bridge/handle.rs:21 new
  static new<T>(counter: MutRef<number>): OwnedStore<T> {
    // Ensure the handle counter isn't 0, which would panic later,
    // when `NonZero::new` (aka `Handle::new`) is called in `alloc`.
    // assert_ne!(counter.load(Ordering::Relaxed), 0);
    const left = counter.value;
    if (left === 0) panic(`assertion \`left != right\` failed\n  left: ${left}\n right: 0`);

    return new OwnedStore<T>(counter, new Map());
  }

  // std: library/proc_macro/src/bridge/handle.rs:31 alloc
  alloc(x: T): Handle {
    // `self.counter.fetch_add(1, Ordering::Relaxed)`
    const counter = this.counter.value;
    this.counter.value = (counter + 1) >>> 0;
    // `Handle::new(counter).expect(..)`
    if (counter === 0) panic("`proc_macro` handle counter overflowed");
    const handle = counter;
    const had = this.data.has(handle);
    this.data.set(handle, x);
    assert(!had, "assertion failed: self.data.insert(handle, x).is_none()");
    return handle;
  }

  // std: library/proc_macro/src/bridge/handle.rs:38 take
  take(h: Handle): T {
    if (!this.data.has(h)) panic("use-after-free in `proc_macro` handle");
    const x = this.data.get(h) as T;
    this.data.delete(h);
    return x;
  }

  // impl<T> Index<Handle> for OwnedStore<T>
  // std: library/proc_macro/src/bridge/handle.rs:45 index
  index(h: Handle): T {
    if (!this.data.has(h)) panic("use-after-free in `proc_macro` handle");
    return this.data.get(h) as T;
  }
}

/// Like `OwnedStore`, but avoids storing any value more than once.
// std-type: library/proc_macro/src/bridge/handle.rs:51 InternedStore
export class InternedStore<T> {
  constructor(
    public owned: OwnedStore<T>,
    public interner: FxHashMap<T, Handle>,
  ) {}

  // std: library/proc_macro/src/bridge/handle.rs:57 new
  static new<T>(counter: MutRef<number>): InternedStore<T> {
    return new InternedStore<T>(OwnedStore.new(counter), new Map());
  }

  // std: library/proc_macro/src/bridge/handle.rs:61 alloc
  alloc(x: T): Handle {
    const owned = this.owned;
    // `*self.interner.entry(x).or_insert_with(|| owned.alloc(x))`
    let h = this.interner.get(x);
    if (h === undefined) {
      h = owned.alloc(x);
      this.interner.set(x, h);
    }
    return h;
  }

  // std: library/proc_macro/src/bridge/handle.rs:66 copy
  copy(h: Handle): T {
    return this.owned.index(h);
  }
}
