// Partial port of compiler/rustc_data_structures/src/sync/freeze.rs (single-threaded).
// PORT: there is no lock; the read guard is the value itself and the write guard is the
// `FreezeLock` (writers use `.value`). `FreezeWriteGuard::freeze` and the `map`s are not ported yet.
import { unwrap } from "../../std/panic.ts";

/// A type which allows mutation using a lock until
/// the value is frozen and can be accessed lock-free.
///
/// Unlike `RwLock`, it can be used to prevent mutation past a point.
export class FreezeLock<T> {
  private constructor(
    public value: T,
    private frozen_: boolean,
  ) {}

  // rustc: compiler/rustc_data_structures/src/sync/freeze.rs:27 new
  static new<T>(value: T): FreezeLock<T> {
    return FreezeLock.with(value, false);
  }

  // rustc: compiler/rustc_data_structures/src/sync/freeze.rs:32 frozen
  static frozen<T>(value: T): FreezeLock<T> {
    return FreezeLock.with(value, true);
  }

  // rustc: compiler/rustc_data_structures/src/sync/freeze.rs:37 with
  static with<T>(value: T, frozen: boolean): FreezeLock<T> {
    return new FreezeLock(value, frozen);
  }

  /// Clones the inner value along with the frozen state.
  // rustc: compiler/rustc_data_structures/src/sync/freeze.rs:47 clone
  /** PORT: `T: Clone` is passed as `clone_T`. */
  clone(clone_T: (v: T) => T): FreezeLock<T> {
    const lock = this.read();
    return FreezeLock.with(clone_T(lock), this.is_frozen());
  }

  // rustc: compiler/rustc_data_structures/src/sync/freeze.rs:56 is_frozen
  is_frozen(): boolean {
    return this.frozen_;
  }

  /// Get the inner value if frozen.
  // rustc: compiler/rustc_data_structures/src/sync/freeze.rs:62 get
  get(): T | undefined {
    if (this.frozen_) {
      return this.value;
    } else {
      return undefined;
    }
  }

  // rustc: compiler/rustc_data_structures/src/sync/freeze.rs:73 read
  read(): T {
    return this.value;
  }

  // rustc: compiler/rustc_data_structures/src/sync/freeze.rs:85 borrow
  borrow(): T {
    return this.read();
  }

  // rustc: compiler/rustc_data_structures/src/sync/freeze.rs:91 write
  write(): FreezeLock<T> {
    return unwrap(this.try_write(), "data should not be frozen if we're still attempting to mutate it");
  }

  // rustc: compiler/rustc_data_structures/src/sync/freeze.rs:96 try_write
  try_write(): FreezeLock<T> | undefined {
    if (this.frozen_) {
      return undefined;
    } else {
      return this;
    }
  }

  // rustc: compiler/rustc_data_structures/src/sync/freeze.rs:112 freeze
  freeze(): T {
    if (!this.frozen_) {
      this.frozen_ = true;
    }
    return this.value;
  }
}
