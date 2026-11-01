// Port of library/proc_macro/src/bridge/closure.rs
//
//! Closure type (equivalent to `&mut dyn FnMut(Buffer) -> Buffer`) that's `repr(C)`.
//
// PORT: `call` is the `extern "C" fn(*mut Env, Buffer) -> Buffer` and `env` the type-erased `*mut Env`. For a
// closure made by the TS server, `env` is the TS function itself; a proc-macro dylib (D7, lane pm-host) only ever
// calls a `Closure` it was given, through the FFI edge, which wraps `call(env, ..)`. The inherent method `call` is
// `call_()` (the field `call` keeps its `repr(C)` name).

import type { Buffer } from "./buffer.ts";

/** `struct Env;`: opaque. */
export type Env = unknown;

// std-type: library/proc_macro/src/bridge/closure.rs:8 Closure
export class Closure {
  constructor(
    public call: (env: Env, arg: Buffer) => Buffer,
    public env: Env,
  ) {}

  // impl<'a, F: FnMut(Buffer) -> Buffer> From<&'a mut F> for Closure<'a>
  // std: library/proc_macro/src/bridge/closure.rs:20 from
  static from(f: (arg: Buffer) => Buffer): Closure {
    // std: library/proc_macro/src/bridge/closure.rs:21 call
    function call(env: Env, arg: Buffer): Buffer {
      return (env as (arg: Buffer) => Buffer)(arg);
    }
    return new Closure(call, f);
  }

  // std: library/proc_macro/src/bridge/closure.rs:29 call
  call_(arg: Buffer): Buffer {
    return this.call(this.env, arg);
  }
}
