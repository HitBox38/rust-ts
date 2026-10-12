// Port of the `#[cfg(test)] mod test` of anstream =0.6.21 `src/adapter/strip.rs`.
// PORT: `proptest!` properties run as seeded loops (see ../proptest.ts).
import { expect, test } from "bun:test";
import { Parser, type Perform } from "../../anstyle_parse/lib.ts";
import { CASES, pc_string, rng } from "../proptest.ts";
import { StripBytes, StripStr, strip_bytes, strip_str } from "./strip.ts";

const fatal = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
/** `String::from_utf8(v).unwrap()` */
function from_utf8_unwrap(v: Uint8Array): string {
  return fatal.decode(v);
}

/// Model based off full parser
// crate: anstream-0.6.21/src/adapter/strip.rs:375 parser_strip
function parser_strip(bytes: Uint8Array): string {
  class Strip implements Perform {
    constructor(public _0: string) {}

    // crate: anstream-0.6.21/src/adapter/strip.rs:379 with_capacity
    static with_capacity(_capacity: number): Strip {
      return new Strip("");
    }

    // crate: anstream-0.6.21/src/adapter/strip.rs:384 print
    print(c: number): void {
      this._0 += String.fromCodePoint(c);
    }

    // crate: anstream-0.6.21/src/adapter/strip.rs:388 execute
    execute(byte: number): void {
      if (byte === 0x09 || byte === 0x0a || byte === 0x0c || byte === 0x0d || byte === 0x20) {
        this._0 += String.fromCharCode(byte);
      }
    }
  }

  const stripped = Strip.with_capacity(bytes.length);
  const parser = Parser.new();
  for (const byte of bytes) {
    parser.advance(stripped, byte);
  }
  return stripped._0;
}

/// Model verifying incremental parsing
// crate: anstream-0.6.21/src/adapter/strip.rs:404 strip_char
function strip_char(s: string): string {
  let result = "";
  const state = StripStr.new();
  for (const current of s) {
    for (const printable of state.strip_next(current)) {
      result += printable;
    }
  }
  return result;
}

/// Model verifying incremental parsing
// crate: anstream-0.6.21/src/adapter/strip.rs:421 strip_byte
function strip_byte(s: Uint8Array): Uint8Array {
  const result: number[] = [];
  const state = StripBytes.default_();
  for (let start = 0; start < s.length; start++) {
    const current = s.subarray(start, start + 1);
    for (const printable of state.strip_next(current)) {
      result.push(...printable);
    }
  }
  return Uint8Array.from(result);
}

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

// crate: anstream-0.6.21/src/adapter/strip.rs:434 test_strip_bytes_multibyte
test("test_strip_bytes_multibyte", () => {
  const bytes = Uint8Array.from([240, 145, 141, 139]);
  const expected = parser_strip(bytes);
  const actual = from_utf8_unwrap(strip_bytes(bytes).into_vec());
  expect(actual).toBe(expected);
});

// crate: anstream-0.6.21/src/adapter/strip.rs:442 test_strip_byte_multibyte
test("test_strip_byte_multibyte", () => {
  const bytes = Uint8Array.from([240, 145, 141, 139]);
  const expected = parser_strip(bytes);
  const actual = from_utf8_unwrap(strip_byte(bytes));
  expect(actual).toBe(expected);
});

// crate: anstream-0.6.21/src/adapter/strip.rs:450 test_strip_str_del
test("test_strip_str_del", () => {
  const input = "\x7f";
  const expected = "";
  const actual = strip_str(input).to_string();
  expect(actual).toBe(expected);
});

// crate: anstream-0.6.21/src/adapter/strip.rs:458 test_strip_byte_del
test("test_strip_byte_del", () => {
  const bytes = Uint8Array.from([0x7f]);
  const expected = "";
  const actual = from_utf8_unwrap(strip_byte(bytes));
  expect(actual).toBe(expected);
});

// crate: anstream-0.6.21/src/adapter/strip.rs:466 test_strip_str_handles_broken_sequence
test("test_strip_str_handles_broken_sequence", () => {
  // valid utf8: \xc3\xb6 then \x1b then \xf0\x9f\x98\x80
  const s = "ö\x1b😀hello😀goodbye";
  const it = strip_str(s);
  expect(it.next()).toBe("ö");
  expect(it.next()).toBe("ello😀goodbye");
});

// crate: anstream-0.6.21/src/adapter/strip.rs:477 strip_str_no_escapes
test("strip_str_no_escapes", () => {
  const r = rng(0x5717);
  for (let i = 0; i < CASES; i++) {
    const s = pc_string(r);
    const expected = parser_strip(utf8(s));
    const actual = strip_str(s).to_string();
    expect(actual).toBe(expected);
  }
});

// crate: anstream-0.6.21/src/adapter/strip.rs:485 strip_char_no_escapes
test("strip_char_no_escapes", () => {
  const r = rng(0x5718);
  for (let i = 0; i < CASES; i++) {
    const s = pc_string(r);
    const expected = parser_strip(utf8(s));
    const actual = strip_char(s);
    expect(actual).toBe(expected);
  }
});

// crate: anstream-0.6.21/src/adapter/strip.rs:493 strip_bytes_no_escapes
test("strip_bytes_no_escapes", () => {
  const r = rng(0x5719);
  for (let i = 0; i < CASES; i++) {
    const s = pc_string(r);
    const expected = parser_strip(utf8(s));
    const actual = from_utf8_unwrap(strip_bytes(utf8(s)).into_vec());
    expect(actual).toBe(expected);
  }
});

// crate: anstream-0.6.21/src/adapter/strip.rs:503 strip_byte_no_escapes
test("strip_byte_no_escapes", () => {
  const r = rng(0x571a);
  for (let i = 0; i < CASES; i++) {
    const s = pc_string(r);
    const expected = parser_strip(utf8(s));
    const actual = from_utf8_unwrap(strip_byte(utf8(s)));
    expect(actual).toBe(expected);
  }
});

// rust-ts: the doc examples of `strip_str` / `strip_bytes`.
test("doc examples", () => {
  const styled_text = "\x1b[32mfoo\x1b[m bar";
  expect(strip_str(styled_text).to_string()).toBe("foo bar");
  expect(Array.from(strip_bytes(utf8(styled_text)).into_vec())).toEqual(Array.from(utf8("foo bar")));
});
