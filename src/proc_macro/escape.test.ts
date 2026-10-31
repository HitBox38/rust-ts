// Unit tests for escape.rs. Expectations: upstream's library/proc_macro/src/escape.rs compiled verbatim by the
// oracle rustc (nightly-2026-10-11) into a probe that prints `escape_bytes(bytes, opts)` for each row
// (scratch probe `$RUST_TS_DATA/tmp/pm-lib/escprobe.rs`, `#[path]`-including escape.rs). Options are
// `<escape_single_quote><escape_double_quote><escape_nonascii>`; the four combinations are those of
// `Literal::{string, character, byte_character, byte_string}` (`c_string` = `string`'s).
import { expect, test } from "bun:test";

import { escape_bytes } from "./escape.ts";

const CASES: [number[], string, string][] = [
  [[112, 108, 97, 105, 110], "010", "plain"],
  [[112, 108, 97, 105, 110], "100", "plain"],
  [[112, 108, 97, 105, 110], "101", "plain"],
  [[112, 108, 97, 105, 110], "011", "plain"],
  [[97, 34, 98, 39, 99, 10, 9, 13, 92, 48], "010", "a\\\"b'c\\n\\t\\r\\\\0"],
  [[97, 34, 98, 39, 99, 10, 9, 13, 92, 48], "100", "a\"b\\'c\\n\\t\\r\\\\0"],
  [[97, 34, 98, 39, 99, 10, 9, 13, 92, 48], "101", "a\"b\\'c\\n\\t\\r\\\\0"],
  [[97, 34, 98, 39, 99, 10, 9, 13, 92, 48], "011", "a\\\"b'c\\n\\t\\r\\\\0"],
  [[195, 169, 204, 128, 127, 1, 226, 128, 139, 239, 187, 191, 195, 188, 240, 159, 152, 128, 194, 160], "010", "é\\u{300}\\u{7f}\\u{1}\\u{200b}\\u{feff}ü😀\\u{a0}"],
  [[195, 169, 204, 128, 127, 1, 226, 128, 139, 239, 187, 191, 195, 188, 240, 159, 152, 128, 194, 160], "100", "é\\u{300}\\u{7f}\\u{1}\\u{200b}\\u{feff}ü😀\\u{a0}"],
  [[195, 169, 204, 128, 127, 1, 226, 128, 139, 239, 187, 191, 195, 188, 240, 159, 152, 128, 194, 160], "101", "\\xc3\\xa9\\xcc\\x80\\x7f\\x01\\xe2\\x80\\x8b\\xef\\xbb\\xbf\\xc3\\xbc\\xf0\\x9f\\x98\\x80\\xc2\\xa0"],
  [[195, 169, 204, 128, 127, 1, 226, 128, 139, 239, 187, 191, 195, 188, 240, 159, 152, 128, 194, 160], "011", "\\xc3\\xa9\\xcc\\x80\\x7f\\x01\\xe2\\x80\\x8b\\xef\\xbb\\xbf\\xc3\\xbc\\xf0\\x9f\\x98\\x80\\xc2\\xa0"],
  [[0, 39, 34, 128, 255, 127, 65, 9, 27], "010", "\\0'\\\"\\x80\\xff\\u{7f}A\\t\\u{1b}"],
  [[0, 39, 34, 128, 255, 127, 65, 9, 27], "100", "\\0\\'\"\\x80\\xff\\u{7f}A\\t\\u{1b}"],
  [[0, 39, 34, 128, 255, 127, 65, 9, 27], "101", "\\0\\'\"\\x80\\xff\\x7fA\\t\\x1b"],
  [[0, 39, 34, 128, 255, 127, 65, 9, 27], "011", "\\0'\\\"\\x80\\xff\\x7fA\\t\\x1b"],
  [[97, 255, 98, 226, 130], "010", "a\\xffb\\xe2\\x82"],
  [[97, 255, 98, 226, 130], "100", "a\\xffb\\xe2\\x82"],
  [[97, 255, 98, 226, 130], "101", "a\\xffb\\xe2\\x82"],
  [[97, 255, 98, 226, 130], "011", "a\\xffb\\xe2\\x82"],
  [[226, 130, 97, 240, 159, 152, 128, 192, 175], "010", "\\xe2\\x82a😀\\xc0\\xaf"],
  [[226, 130, 97, 240, 159, 152, 128, 192, 175], "100", "\\xe2\\x82a😀\\xc0\\xaf"],
  [[226, 130, 97, 240, 159, 152, 128, 192, 175], "101", "\\xe2\\x82a\\xf0\\x9f\\x98\\x80\\xc0\\xaf"],
  [[226, 130, 97, 240, 159, 152, 128, 192, 175], "011", "\\xe2\\x82a\\xf0\\x9f\\x98\\x80\\xc0\\xaf"],
];

test("escape_bytes matches upstream escape.rs", () => {
  for (const [bytes, opts, want] of CASES) {
    const got = escape_bytes(Uint8Array.from(bytes), {
      escape_single_quote: opts[0] === "1",
      escape_double_quote: opts[1] === "1",
      escape_nonascii: opts[2] === "1",
    });
    expect([bytes, opts, got]).toEqual([bytes, opts, want]);
  }
});
