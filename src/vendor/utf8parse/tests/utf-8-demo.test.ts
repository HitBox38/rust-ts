// Port of utf8parse =0.2.2 `tests/utf-8-demo.rs`. `UTF-8-demo.txt` is copied unchanged from the
// crate's `tests/` directory.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Parser, type Receiver } from "../lib.ts";

const UTF8_DEMO: Uint8Array = new Uint8Array(readFileSync(join(import.meta.dir, "UTF-8-demo.txt")));

class StringWrapper implements Receiver {
  constructor(public _0: string) {}

  // crate: utf8parse-0.2.2/tests/utf-8-demo.rs:9 codepoint
  codepoint(c: number): void {
    this._0 += String.fromCodePoint(c);
  }

  // crate: utf8parse-0.2.2/tests/utf-8-demo.rs:13 invalid_sequence
  invalid_sequence(): void {}
}

// crate: utf8parse-0.2.2/tests/utf-8-demo.rs:17 utf8parse_test
test("utf8parse_test", () => {
  const parser = Parser.new();

  // utf8parse implementation
  const actual = new StringWrapper("");

  for (const byte of UTF8_DEMO) {
    parser.advance(actual, byte);
  }

  // standard library implementation
  const expected = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(UTF8_DEMO);

  expect(actual._0).toBe(expected);
});

// rust-ts: invalid sequences reach `invalid_sequence` (not part of upstream's tests).
test("invalid_sequence", () => {
  const events: string[] = [];
  const r: Receiver = {
    codepoint: (c) => events.push(`c${c.toString(16)}`),
    invalid_sequence: () => events.push("x"),
  };
  const parser = Parser.new();
  for (const b of [0x61, 0xc3, 0x28, 0xe2, 0x82, 0xac, 0xff, 0xf0, 0x9f, 0x98, 0x80]) parser.advance(r, b);
  expect(events).toEqual(["c61", "x", "c20ac", "x", "c1f600"]);
});
