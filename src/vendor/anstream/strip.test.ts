// Port of the `#[cfg(test)] mod test` of anstream =0.6.21 `src/strip.rs`, plus rust-ts checks of
// `write` with a short-writing inner stream and of `write_fmt`.
// PORT: `proptest!` properties run as seeded loops (see ./proptest.ts).
import { expect, test } from "bun:test";
import { Ok } from "../../std/result.ts";
import type { IoResult } from "../../std/io.ts";
import { any_bytes, CASES, pc_string, rng } from "./proptest.ts";
import { StripStream } from "./strip.ts";
import { VecU8, Write_default, type AsLockedWrite, type FmtArguments, type RawStream } from "./stream.ts";

const fatal = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

/** `std::str::from_utf8(..)` → `undefined` on invalid UTF-8. */
function from_utf8(v: Uint8Array): string | undefined {
  try {
    return fatal.decode(v);
  } catch {
    return undefined;
  }
}

/** `!char.is_ascii() || !char.is_control() || char.is_ascii_whitespace()` */
function allowed(c: number): boolean {
  const is_control = c < 0x20 || (c >= 0x7f && c <= 0x9f);
  return !(c < 0x80) || !is_control || c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d || c === 0x20;
}

// crate: anstream-0.6.21/src/strip.rs:181 write_all_no_escapes
test("write_all_no_escapes", () => {
  const r = rng(0xa11);
  for (let i = 0; i < CASES; i++) {
    const s = pc_string(r);
    const buffer = new VecU8();
    const stream = StripStream.new(buffer);
    expect(stream.write_all(utf8(s)).$).toBe("Ok");
    const actual = from_utf8(stream.into_inner().bytes());
    expect(actual).toBe(s);
  }
});

// crate: anstream-0.6.21/src/strip.rs:192 write_byte_no_escapes
test("write_byte_no_escapes", () => {
  const r = rng(0xa12);
  for (let i = 0; i < CASES; i++) {
    const s = pc_string(r);
    const buffer = new VecU8();
    const stream = StripStream.new(buffer);
    for (const byte of utf8(s)) {
      expect(stream.write_all(Uint8Array.of(byte)).$).toBe("Ok");
    }
    const actual = from_utf8(stream.into_inner().bytes());
    expect(actual).toBe(s);
  }
});

// crate: anstream-0.6.21/src/strip.rs:205 write_all_random
test("write_all_random", () => {
  const r = rng(0xa13);
  for (let i = 0; i < CASES; i++) {
    const s = any_bytes(r);
    const buffer = new VecU8();
    const stream = StripStream.new(buffer);
    expect(stream.write_all(s).$).toBe("Ok");
    const actual = from_utf8(stream.into_inner().bytes());
    if (actual !== undefined) {
      for (const ch of actual) {
        expect(allowed(ch.codePointAt(0)!)).toBe(true);
      }
    }
  }
});

// crate: anstream-0.6.21/src/strip.rs:219 write_byte_random
test("write_byte_random", () => {
  const r = rng(0xa14);
  for (let i = 0; i < CASES; i++) {
    const s = any_bytes(r);
    const buffer = new VecU8();
    const stream = StripStream.new(buffer);
    for (const byte of s) {
      expect(stream.write_all(Uint8Array.of(byte)).$).toBe("Ok");
    }
    const actual = from_utf8(stream.into_inner().bytes());
    if (actual !== undefined) {
      for (const ch of actual) {
        expect(allowed(ch.codePointAt(0)!)).toBe(true);
      }
    }
  }
});

/** A writer accepting at most `cap` bytes per `write` call. */
class Short implements RawStream, AsLockedWrite {
  readonly inner = new VecU8();
  constructor(readonly cap: number) {}
  write(buf: Uint8Array): IoResult<number> {
    const n = Math.min(this.cap, buf.length);
    this.inner.write_all(buf.subarray(0, n));
    return Ok(n);
  }
  write_all(buf: Uint8Array): IoResult<void> {
    return Write_default.write_all(this, buf);
  }
  write_fmt(args: FmtArguments): IoResult<void> {
    return Write_default.write_fmt(this, args);
  }
  flush(): IoResult<void> {
    return Ok(undefined);
  }
  is_terminal(): boolean {
    return false;
  }
  as_locked_write(): Short {
    return this;
  }
}

test("rust-ts: write() with short writes resumes at the divergence", () => {
  const input = utf8("ab\x1b[31mcdef\x1b[0mgh");
  const stream = StripStream.new(new Short(3));
  let buf = input;
  const offsets: number[] = [];
  while (buf.length !== 0) {
    const r = stream.write(buf);
    expect(r.$).toBe("Ok");
    if (r.$ === "Ok") {
      offsets.push(r._0);
      buf = buf.subarray(r._0);
    }
  }
  expect(fatal.decode(stream.into_inner().inner.bytes())).toBe("abcdefgh");
  // "ab" is written whole, "cdef" diverges after "cde" (offset 10); upstream then re-runs the
  // state over `buf[offset..]`, and the next call writes "f" and "gh".
  expect(offsets).toEqual([10, 7]);
});

test("rust-ts: write_fmt strips each piece", () => {
  const stream = StripStream.new(new VecU8());
  expect(stream.write_fmt(["\x1b[1m", "error", "\x1b[0m", ": x\n"]).$).toBe("Ok");
  expect(fatal.decode(stream.into_inner().bytes())).toBe("error: x\n");
});
