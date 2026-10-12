// Port of unicode-normalization =0.1.25 `src/__test_api.rs`.
// This crate comprises hacks and glue required to test private functions from tests/
//
// Keep this as slim as possible.
//
// If you're caught using this outside this crates tests/, you get to clean up the mess.
import type { Str } from "../../std/str.ts";
import { StreamSafe } from "./stream_safe.ts";

// crate: unicode-normalization-0.1.25/src/__test_api.rs:12 stream_safe
export function stream_safe(s: Str): string {
  // `.collect::<String>()`
  let out = "";
  const it = StreamSafe.new(s.chars());
  for (let c = it.next(); c !== undefined; c = it.next()) out += String.fromCodePoint(c);
  return out;
}

export * as quick_check from "./quick_check.ts";
