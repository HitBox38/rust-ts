// `std::sync::mpsc::sync_channel` (library/std/src/sync/mpsc.rs), the subset the proc-macro bridge's
// `MessagePipe` uses (library/proc_macro/src/bridge/server.rs:226): `sync_channel`, `SyncSender::send`,
// `Receiver::recv`, and dropping either end.
//
// PORT: one end of the channel may be moved to a second OS thread that runs native code (src/std/thread.ts), so
// the channel lives in native memory (thread.c, a bounded queue under a pthread mutex and condition variable) and
// a message is a `#[repr(C)]` value of a fixed number of machine words, moved by copy. A `NativeCodec<T>` turns
// a TS `T` into those words and back; it stands for `T`'s move into and out of the channel's slot. An end moved
// to native code is taken with `into_raw` (then the native side owns its drop: `rts_chan_drop_sender` /
// `rts_chan_drop_receiver`, through `chan_fns`). `SyncSender::clone` (more than one sender) is not ported, nor
// a bound of 0 (a rendezvous channel), which nothing in the port asks for.

import { ptr, read } from "bun:ffi";
import { native_sync } from "../thread.ts";
import { assert, unported } from "../panic.ts";
import { Err, Ok, type Result } from "../result.ts";
import { type Debug, debug_struct_non_exhaustive } from "../fmt.ts";

/** PORT: how a `T` is moved into and out of a channel slot of `words` machine words (see the header). */
export interface NativeCodec<T> {
  readonly words: number;
  /** Moves `value` into the `words` words at `out`. */
  write(value: T, out: number): void;
  /** Moves the value out of the `words` words at `p`. */
  read(p: number): T;
}

/// An error returned from the [`Sender::send`] or [`SyncSender::send`]
/// function on **channel**s.
// std-type: library/std/src/sync/mpsc.rs:414 SendError
export interface SendError<T> {
  readonly _0: T;
}

// impl<T> fmt::Debug for SendError<T>
// std: library/std/src/sync/mpsc.rs:1162 fmt
export const debug_SendError: Debug<SendError<unknown>> = (_v, f) => debug_struct_non_exhaustive(f, "SendError", []);

/// An error returned from the [`recv`] function on a [`Receiver`].
// std-type: library/std/src/sync/mpsc.rs:425 RecvError
export type RecvError = "RecvError";

/** A slot-sized scratch block in TS memory, 8-byte aligned. */
function scratch(words: number): Float64Array {
  return new Float64Array(Math.max(words, 1));
}

/// The sending-half of Rust's synchronous [`sync_channel`] type.
// std-type: library/std/src/sync/mpsc.rs:399 SyncSender
export class SyncSender<T> {
  constructor(
    private chan: number,
    private codec: NativeCodec<T>,
  ) {}

  /// Sends a value on this synchronous channel.
  ///
  /// This function will *block* until space in the internal buffer becomes
  /// available or a receiver is available to hand off the message to.
  // std: library/std/src/sync/mpsc.rs:709 send
  send(t: T): Result<void, SendError<T>> {
    assert(this.chan !== 0, "rust-ts: use of a moved or dropped SyncSender");
    const s = scratch(this.codec.words);
    this.codec.write(t, ptr(s));
    if (native_sync().rts_chan_send(this.chan, ptr(s)) !== 0) {
      // The value was not consumed: move it back out.
      return Err({ _0: this.codec.read(ptr(s)) });
    }
    return Ok(undefined);
  }

  /** `drop(sender)`. */
  drop(): void {
    if (this.chan === 0) return;
    native_sync().rts_chan_drop_sender(this.chan);
    this.chan = 0;
  }

  /** PORT: moves this end to native code (see the header); the native side drops it. */
  into_raw(): number {
    const c = this.chan;
    assert(c !== 0, "rust-ts: use of a moved or dropped SyncSender");
    this.chan = 0;
    return c;
  }
}

/// The receiving half of Rust's [`channel`] (or [`sync_channel`]) type.
// std-type: library/std/src/sync/mpsc.rs:181 Receiver
export class Receiver<T> {
  constructor(
    private chan: number,
    private codec: NativeCodec<T>,
  ) {}

  /// Attempts to wait for a value on this receiver, returning an error if the
  /// corresponding channel has hung up.
  // std: library/std/src/sync/mpsc.rs:889 recv
  recv(): Result<T, RecvError> {
    assert(this.chan !== 0, "rust-ts: use of a moved or dropped Receiver");
    const s = scratch(this.codec.words);
    if (native_sync().rts_chan_recv(this.chan, ptr(s)) !== 0) return Err("RecvError");
    return Ok(this.codec.read(ptr(s)));
  }

  /** `drop(receiver)`. */
  drop(): void {
    if (this.chan === 0) return;
    const n = native_sync();
    // PORT: std drops the messages still in the channel when the last receiver goes; the native channel cannot run
    // `T`'s drop, so it must be empty here.
    if (n.rts_chan_len(this.chan) !== 0) {
      return unported("std::sync::mpsc::Receiver::drop (messages left in a native channel)");
    }
    n.rts_chan_drop_receiver(this.chan);
    this.chan = 0;
  }

  /** PORT: moves this end to native code (see the header); the native side drops it. */
  into_raw(): number {
    const c = this.chan;
    assert(c !== 0, "rust-ts: use of a moved or dropped Receiver");
    this.chan = 0;
    return c;
  }
}

/// Creates a new synchronous, bounded channel.
// std: library/std/src/sync/mpsc.rs:576 sync_channel
export function sync_channel<T>(bound: number, codec: NativeCodec<T>): [SyncSender<T>, Receiver<T>] {
  // `mpmc::sync_channel(bound)`: the array flavor for a bound above 0, the zero (rendezvous) flavor for 0.
  if (bound === 0) return unported("std::sync::mpsc::sync_channel (bound 0: a rendezvous channel)");
  const c = native_sync().rts_chan_new(bound, codec.words);
  // Both ends share the native channel; it is freed when both are dropped.
  return [new SyncSender(c, codec), new Receiver(c, codec)];
}

/**
 * The native channel functions (`send`, `recv`, `drop_sender`, `drop_receiver`, in that order), for native code
 * in another TinyCC unit that receives an end through `into_raw` (see the header).
 */
export function chan_fns(): [number, number, number, number] {
  const out = new Float64Array(4);
  native_sync().rts_chan_fns(ptr(out));
  const p = ptr(out);
  return [read.ptr(p, 0), read.ptr(p, 8), read.ptr(p, 16), read.ptr(p, 24)];
}
