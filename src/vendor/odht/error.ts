// Port of odht =0.3.1 `src/error.rs`.
//
// PORT: `Error(pub String)` is a class whose `_0` is the message. Upstream's public API returns it
// boxed as `Box<dyn std::error::Error>`; the box is erased. `toString()` is the `Display` impl, so a
// `{e}` / `${e}` of the error prints the message, as upstream's `panic!("..{e}")` does.

import type { Debug } from "../../std/fmt.ts";
import { debug_str, debug_tuple } from "../../std/fmt.ts";

// #[derive(Eq, PartialEq, Debug)]
export class Error {
  constructor(readonly _0: string) {}

  // impl std::fmt::Display for Error
  // crate: odht-0.3.1/src/error.rs:6 fmt
  fmt(): string {
    return `${this._0}`;
  }

  toString(): string {
    return this.fmt();
  }
}

/** `#[derive(PartialEq)]` */
export function Error_eq(a: Error, b: Error): boolean {
  return a._0 === b._0;
}

/** `#[derive(Debug)]`: `Error("..")` */
export const debug_Error: Debug<Error> = (v, f) => debug_tuple(f, "Error", [debug_str(v._0)]);
