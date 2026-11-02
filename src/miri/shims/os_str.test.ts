// Tests of src/miri/shims/os_str.ts (lane miri-shims-a): the path separator conversions and the OsStr <-> bytes / UTF-16
// helpers.
//
// The `windows_to_unix` / `unix_to_windows` expectations are oracle-derived: upstream's two fns (os_str.rs:274-328,
// copied verbatim) compiled with the pinned rustc (`rustc +nightly-2026-10-11`) and run on these inputs, over both
// `Vec<u8>` (Unix host) and `Vec<u16>` (Windows host), which agree (script: $RUST_TS_DATA/tmp/shims-a/paths.rs).
import { expect, test } from "bun:test";
import "../lib.ts";
import { bytes_to_os_str, os_str_as_encoded_bytes, unix_to_windows, windows_to_unix } from "./os_str.ts";
import { Unported } from "../../std/panic.ts";

// [input, windows_to_unix(input), unix_to_windows(input)]
const ORACLE: readonly [string, string, string][] = [
  ["C:\\foo\\bar", "/C:/foo/bar", "C:\\foo\\bar"],
  ["/C:/foo/bar", "/C:/foo/bar", "C:\\foo\\bar"],
  ["\\\\?\\tmp\\x", "/tmp/x", "\\\\?\\tmp\\x"],
  ["//?/tmp/x", "/tmp/x", "\\\\?\\tmp\\x"],
  ["/tmp/x", "/tmp/x", "\\\\?\\tmp\\x"],
  ["tmp/x", "tmp/x", "tmp\\x"],
  ["relative\\p", "relative/p", "relative\\p"],
  ["\\abs", "/abs", "\\\\?\\abs"],
  ["\\\\server\\share", "//server/share", "\\\\server\\share"],
  ["", "", ""],
  ["/", "/", "\\\\?\\"],
  ["\\", "/", "\\\\?\\"],
  ["C:", "C:", "C:"],
  ["C:\\", "/C:/", "C:\\"],
  ["/C:/", "/C:/", "C:\\"],
  ["ä/ö\\ü", "ä/ö/ü", "ä\\ö\\ü"],
];

const utf8 = new TextDecoder();
function over_bytes(f: (v: number[]) => void, s: string): string {
  const v = Array.from(os_str_as_encoded_bytes(s));
  f(v);
  return utf8.decode(Uint8Array.from(v));
}
function over_utf16(f: (v: number[]) => void, s: string): string {
  const v: number[] = [];
  for (let i = 0; i < s.length; i++) v.push(s.charCodeAt(i));
  f(v);
  return String.fromCharCode(...v);
}

test("windows_to_unix / unix_to_windows match the oracle over bytes and UTF-16 units", () => {
  for (const [input, w2u, u2w] of ORACLE) {
    expect([input, over_bytes(windows_to_unix, input)]).toEqual([input, w2u]);
    expect([input, over_bytes(unix_to_windows, input)]).toEqual([input, u2w]);
    expect([input, over_utf16(windows_to_unix, input)]).toEqual([input, w2u]);
    expect([input, over_utf16(unix_to_windows, input)]).toEqual([input, u2w]);
  }
});

test("conversions round-trip absolute paths", () => {
  for (const p of ["/tmp/x", "/", "/a/b/c"]) {
    expect(over_bytes(windows_to_unix, over_bytes(unix_to_windows, p))).toBe(p);
  }
  for (const p of ["C:\\foo\\bar", "C:\\"]) {
    expect(over_bytes(unix_to_windows, over_bytes(windows_to_unix, p))).toBe(p);
  }
});

test("bytes_to_os_str: UTF-8 bytes are an OsStr; other bytes stop `unported` on a Unix host (D14)", () => {
  const ok = bytes_to_os_str(os_str_as_encoded_bytes("héllo=wörld"));
  expect(ok).toEqual({ $: "Ok", _0: "héllo=wörld" });
  expect(bytes_to_os_str(new Uint8Array([]))).toEqual({ $: "Ok", _0: "" });
  if (process.platform !== "win32") {
    expect(() => bytes_to_os_str(new Uint8Array([0x66, 0xff, 0x6f]))).toThrow(Unported);
  }
});

test("as_encoded_bytes is the UTF-8 encoding (`os_str.len()` counts bytes)", () => {
  expect(Array.from(os_str_as_encoded_bytes("aé€😀"))).toEqual([
    0x61, 0xc3, 0xa9, 0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x98, 0x80,
  ]);
});
