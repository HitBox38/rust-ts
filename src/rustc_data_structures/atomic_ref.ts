// Port of compiler/rustc_data_structures/src/atomic_ref.rs (single-threaded).

/// This is essentially an `AtomicPtr` but is guaranteed to always be valid
export class AtomicRef<T> {
  private constructor(private value: T) {}

  // rustc: compiler/rustc_data_structures/src/atomic_ref.rs:8 new
  static new<T>(initial: T): AtomicRef<T> {
    return new AtomicRef(initial);
  }

  // rustc: compiler/rustc_data_structures/src/atomic_ref.rs:12 swap
  swap(new_: T): T {
    const old = this.value;
    this.value = new_;
    return old;
  }

  // rustc: compiler/rustc_data_structures/src/atomic_ref.rs:21 deref
  deref(): T {
    return this.value;
  }
}
