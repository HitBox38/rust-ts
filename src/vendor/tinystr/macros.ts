// Port of tinystr 0.8.4 `src/macros.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
import { panic } from "../../std/panic.ts";
import { TinyAsciiStr } from "./ascii.ts";

// PORT: `macro_rules! tinystr { ($n:literal, $s:literal) => ... }` evaluates in a const context
// (a failure is a compile error); here it is a function that panics with the same message.
export function tinystr(n: number, s: string): TinyAsciiStr {
  const r = TinyAsciiStr.try_from_str(n, s);
  if (r.$ === "Ok") return r._0;
  // Cannot format the error since formatting isn't const yet
  return panic("Failed to construct tinystr from " + s);
}
