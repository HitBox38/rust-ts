// Port of library/proc_macro/src/bridge/panic_message.rs
//
// PORT: a Rust panic is a thrown JS value (src/std/panic.ts). A `Box<dyn Any + Send>` panic payload is the thrown
// value: a `Panic` carries a string payload (TS panics do not distinguish `&'static str` from `String`; both cross
// the bridge as the same `Option<&str>` bytes), anything else is a payload of another type (e.g. rustc's
// `FatalErrorMarker`). `catch_unwind` below is `std::panic::catch_unwind` for the bridge.

import { Panic } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import type { Buffer } from "./buffer.ts";
import { decode_Option, encode_Option } from "./mod.ts";
import { decode_String, encode_str } from "./rpc.ts";

/// Simplified version of panic payloads, ignoring
/// types other than `&'static str` and `String`.
// std-type: library/proc_macro/src/bridge/panic_message.rs:7 PanicMessage
export type PanicMessage =
  | { readonly $: "StaticStr"; _0: string }
  | { readonly $: "String"; _0: string }
  | { readonly $: "Unknown" };

/** `struct UnknownPanicMessage;` (panic_message.rs:31), the payload of a resumed `PanicMessage::Unknown`. */
class UnknownPanicMessage {}

export const PanicMessage = {
  Unknown: Object.freeze({ $: "Unknown" as const }),

  // impl From<Box<dyn Any + Send>> for PanicMessage
  // std: library/proc_macro/src/bridge/panic_message.rs:14 from
  from(payload: unknown): PanicMessage {
    if (payload instanceof Panic) {
      return { $: "String", _0: payload.message };
    }
    return PanicMessage.Unknown;
  },

  // impl From<PanicMessage> for Box<dyn Any + Send>
  // std: library/proc_macro/src/bridge/panic_message.rs:26 from
  into_payload(val: PanicMessage): unknown {
    switch (val.$) {
      case "StaticStr":
        return new Panic(val._0);
      case "String":
        return new Panic(val._0);
      case "Unknown": {
        return new UnknownPanicMessage();
      }
    }
  },

  // std: library/proc_macro/src/bridge/panic_message.rs:39 as_str
  as_str(self: PanicMessage): string | undefined {
    switch (self.$) {
      case "StaticStr":
        return self._0;
      case "String":
        return self._0;
      case "Unknown":
        return undefined;
    }
  },

  // std: library/proc_macro/src/bridge/panic_message.rs:47 into_string
  into_string(self: PanicMessage): string | undefined {
    switch (self.$) {
      case "StaticStr":
        return self._0;
      case "String":
        return self._0;
      case "Unknown":
        return undefined;
    }
  },
};

// impl<S> Encode<S> for PanicMessage
// std: library/proc_macro/src/bridge/panic_message.rs:58 encode
export function encode_PanicMessage<S>(self: PanicMessage, w: Buffer, s: S): void {
  encode_Option(PanicMessage.as_str(self), w, s, encode_str);
}

// impl<S> Decode<'_, '_, S> for PanicMessage
// std: library/proc_macro/src/bridge/panic_message.rs:65 decode
export function decode_PanicMessage<S>(r: MutRef<Uint8Array>, s: S): PanicMessage {
  const m = decode_Option(r, s, decode_String);
  if (m !== undefined) {
    return { $: "String", _0: m };
  } else {
    return PanicMessage.Unknown;
  }
}

/**
 * `std::panic::catch_unwind(AssertUnwindSafe(f))`.
 * PORT: JS `Error`s other than `Panic` are not unwinds: `Unported` (a missing port: exit 70), a JS stack overflow
 * (rustc aborts on the guard page) and JS engine errors (`TypeError`, ..., bugs in the port) propagate at once.
 */
export function catch_unwind<R>(f: () => R): Result<R, unknown> {
  try {
    return Ok(f());
  } catch (e) {
    if (e instanceof Error && !(e instanceof Panic)) throw e;
    return Err(e);
  }
}

/** `std::panic::resume_unwind(payload)` */
export function resume_unwind(payload: unknown): never {
  throw payload;
}
