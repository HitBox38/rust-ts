// Shared assertions for the icu_locale_core integration tests (`assert_writeable_eq!`).
import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { utf8 } from "../../../std/str.ts";
import { StringSink, type Writeable } from "../../writeable/lib.ts";

export function assert_writeable_eq(w: Writeable, expected: string, msg = ""): void {
  const s = new StringSink();
  w.write_to(s);
  expect(s.s, msg).toBe(expected);
  expect(w.write_to_string(), msg).toBe(expected);
  const borrowed = w.writeable_borrow();
  if (borrowed !== undefined) expect(borrowed, msg).toBe(expected);
  const hint = w.writeable_length_hint();
  const len = utf8(expected).length;
  expect(hint._0 <= len, msg).toBe(true);
  if (hint._1 !== undefined) expect(len <= hint._1, msg).toBe(true);
}

/** `include_str!("fixtures/<name>")` */
export function fixture(name: string): string {
  return readFileSync(join(import.meta.dir, "fixtures", name), "utf8");
}

export function cmp_bytes(a: Uint8Array, b: Uint8Array): -1 | 0 | 1 {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i]! < b[i]! ? -1 : 1;
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}
