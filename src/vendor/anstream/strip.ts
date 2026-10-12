// Port of anstream =0.6.21 `src/strip.rs`.
//
// PORT: the bounds of `impl Write for StripStream<S>` (`S: Write + AsLockedWrite`) are hoisted to
// the class; `is_terminal` (`S: IsTerminal`) types `this` instead. `lock()` serves both the
// `StripStream<Stdout>` and `StripStream<Stderr>` impls (locking is the identity in the shim).

import { Ok } from "../../std/result.ts";
import type { IoResult } from "../../std/io.ts";
import { StripBytes } from "./adapter/strip.ts";
import { Adapter } from "./fmt.ts";
import type { AsLockedWrite, FmtArguments, IsTerminal, Stderr, Stdout, Write } from "./stream.ts";

/** `&mut T` to a place. */
interface MutRef<T> {
  value: T;
}

/// Only pass printable data to the inner `Write`
export class StripStream<S extends Write & AsLockedWrite> implements Write {
  constructor(
    public raw: S,
    public state: StripBytes,
  ) {}

  /// Only pass printable data to the inner `Write`
  // crate: anstream-0.6.21/src/strip.rs:21 new
  static new<S extends Write & AsLockedWrite>(raw: S): StripStream<S> {
    return new StripStream(raw, StripBytes.default_());
  }

  /// Get the wrapped [`std::io::Write`]
  // crate: anstream-0.6.21/src/strip.rs:30 into_inner
  into_inner(): S {
    return this.raw;
  }

  /// Get the wrapped [`std::io::Write`]
  // crate: anstream-0.6.21/src/strip.rs:36 as_inner
  as_inner(): S {
    return this.raw;
  }

  /// Returns `true` if the descriptor/handle refers to a terminal/tty.
  // crate: anstream-0.6.21/src/strip.rs:48 is_terminal
  is_terminal(this: StripStream<S & IsTerminal>): boolean {
    return this.raw.is_terminal();
  }

  /// Get exclusive access to the `StripStream`
  ///
  /// Why?
  /// - Faster performance when writing in a loop
  /// - Avoid other threads interleaving output with the current thread
  // crate: anstream-0.6.21/src/strip.rs:60 lock
  // crate: anstream-0.6.21/src/strip.rs:75 lock
  lock<T extends Stdout | Stderr>(this: StripStream<T>): StripStream<T> {
    return new StripStream(this.raw.lock() as T, this.state);
  }

  // impl<S> std::io::Write for StripStream<S>
  // Must forward all calls to ensure locking happens appropriately
  // crate: anstream-0.6.21/src/strip.rs:90 write
  write(buf: Uint8Array): IoResult<number> {
    return write(this.raw.as_locked_write(), this.state_ref(), buf);
  }

  // crate: anstream-0.6.21/src/strip.rs:94 write_vectored
  write_vectored(bufs: readonly Uint8Array[]): IoResult<number> {
    const buf = bufs.find((b) => b.length !== 0) ?? new Uint8Array(0);
    return this.write(buf);
  }

  // is_write_vectored: nightly only
  // crate: anstream-0.6.21/src/strip.rs:104 flush
  flush(): IoResult<void> {
    return this.raw.as_locked_write().flush();
  }

  // crate: anstream-0.6.21/src/strip.rs:108 write_all
  write_all(buf: Uint8Array): IoResult<void> {
    return write_all(this.raw.as_locked_write(), this.state, buf);
  }

  // write_all_vectored: nightly only
  // crate: anstream-0.6.21/src/strip.rs:113 write_fmt
  write_fmt(args: FmtArguments): IoResult<void> {
    return write_fmt(this.raw.as_locked_write(), this.state, args);
  }

  /** `&mut self.state` */
  private state_ref(): MutRef<StripBytes> {
    const self = this;
    return {
      get value() {
        return self.state;
      },
      set value(v) {
        self.state = v;
      },
    };
  }
}

// crate: anstream-0.6.21/src/strip.rs:118 write
function write(raw: Write, state: MutRef<StripBytes>, buf: Uint8Array): IoResult<number> {
  const initial_state = state.value.clone();

  for (const printable of state.value.strip_next(buf)) {
    const possible = printable.length;
    const r = raw.write(printable);
    if (r.$ === "Err") return r;
    const written = r._0;
    if (possible !== written) {
      const divergence = printable.subarray(written);
      const offset = offset_to(buf, divergence);
      const consumed = buf.subarray(offset);
      state.value = initial_state;
      state.value.strip_next(consumed).last();
      return Ok(offset);
    }
  }
  return Ok(buf.length);
}

// crate: anstream-0.6.21/src/strip.rs:140 write_all
function write_all(raw: Write, state: StripBytes, buf: Uint8Array): IoResult<void> {
  for (const printable of state.strip_next(buf)) {
    const r = raw.write_all(printable);
    if (r.$ === "Err") return r;
  }
  return Ok(undefined);
}

// crate: anstream-0.6.21/src/strip.rs:151 write_fmt
function write_fmt(raw: Write, state: StripBytes, args: FmtArguments): IoResult<void> {
  const write_all_ = (buf: Uint8Array): IoResult<void> => write_all(raw, state, buf);
  return Adapter.new(write_all_).write_fmt(args);
}

// PORT: pointer difference → `byteOffset` difference (`subslice` is a `subarray` view of `total`).
// crate: anstream-0.6.21/src/strip.rs:161 offset_to
function offset_to(total: Uint8Array, subslice: Uint8Array): number {
  // debug_assert!(total <= subslice, "`Offset::offset_to` only accepts slices of `self`");
  return subslice.byteOffset - total.byteOffset;
}
