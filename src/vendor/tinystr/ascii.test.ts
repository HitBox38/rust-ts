// Port of the `#[cfg(test)] mod test` in tinystr 0.8.4 `src/ascii.rs`.
// PORT: `gen_strings` draws random ASCII strings from `rand::rngs::SmallRng::seed_from_u64(2022)`;
// rand is not ported, so the generated strings come from a fixed xorshift generator instead
// (same lengths `[3, 4, 5, 8, 12]`, same byte range 1..0x80, same count 100). The `STRINGS` list is
// upstream's.
import { expect, test } from "bun:test";
import { is_ascii_alphabetic, is_ascii_alphanumeric, is_ascii_digit } from "../../std/char.ts";
import { display_ParseError } from "./error.ts";
import { TinyAsciiStr } from "./ascii.ts";

const STRINGS = [
  "Latn",
  "laTn",
  "windows",
  "AR",
  "Hans",
  "macos",
  "AT",
  "infiniband",
  "FR",
  "en",
  "Cyrl",
  "FromIntegral",
  "NO",
  "419",
  "MacintoshOSX2019",
  "a3z",
  "A3z",
  "A3Z",
  "a3Z",
  "3A",
  "3Z",
  "3a",
  "3z",
  "@@[`{",
  "UK",
  "E12",
];

// crate: tinystr-0.8.4/src/ascii.rs:926 gen_strings
function gen_strings(num_strings: number, allowed_lengths: number[]): string[] {
  let x = 2022;
  const rnd = () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return x >>> 0;
  };
  const string_lengths = Array.from({ length: num_strings }, () => allowed_lengths[rnd() % allowed_lengths.length]!);
  return string_lengths.map((len) => {
    let s = "";
    while (s.length < len) {
      const b = rnd() & 0xff;
      if (b > 0 && b < 0x80) s += String.fromCharCode(b);
    }
    return s;
  });
}

// crate: tinystr-0.8.4/src/ascii.rs:946 check_operation
function check_operation<T>(N: number, reference_f: (s: string) => T, tinystr_f: (t: TinyAsciiStr) => T): void {
  for (const s of [...STRINGS, ...gen_strings(100, [3, 4, 5, 8, 12])]) {
    const r = TinyAsciiStr.from_str(N, s);
    if (r.$ === "Err") {
      if (r._0.$ === "TooLong") continue;
      throw new Error(display_ParseError(r._0));
    }
    const t = r._0;
    const expected = reference_f(s);
    const actual = tinystr_f(t);
    expect(actual, `TinyAsciiStr<${N}>: ${JSON.stringify(s)}`).toEqual(expected);

    const s_utf16 = Array.from(s, (c) => c.charCodeAt(0));
    const r16 = TinyAsciiStr.try_from_utf16(N, s_utf16);
    if (r16.$ === "Err") {
      if (r16._0.$ === "TooLong") continue;
      throw new Error(display_ParseError(r16._0));
    }
    expect(tinystr_f(r16._0), `TinyAsciiStr<${N}>: ${JSON.stringify(s)}`).toEqual(reference_f(s));
  }
}

const SIZES = [2, 3, 4, 5, 8, 16];
const chars = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const lower16 = (s: string) => {
  const r = TinyAsciiStr.try_from_str(16, s);
  if (r.$ === "Err") throw new Error("unwrap");
  return r._0;
};

// crate: tinystr-0.8.4/src/ascii.rs:979 test_is_ascii_alphabetic
test("test_is_ascii_alphabetic", () => {
  for (const N of SIZES) check_operation(N, (s) => chars(s).every(is_ascii_alphabetic), (t) => t.is_ascii_alphabetic());
});

// crate: tinystr-0.8.4/src/ascii.rs:995 test_is_ascii_alphanumeric
test("test_is_ascii_alphanumeric", () => {
  for (const N of SIZES) check_operation(N, (s) => chars(s).every(is_ascii_alphanumeric), (t) => t.is_ascii_alphanumeric());
});

// crate: tinystr-0.8.4/src/ascii.rs:1011 test_is_ascii_numeric
test("test_is_ascii_numeric", () => {
  for (const N of SIZES) check_operation(N, (s) => chars(s).every(is_ascii_digit), (t) => t.is_ascii_numeric());
});

// crate: tinystr-0.8.4/src/ascii.rs:1027 test_is_ascii_lowercase
test("test_is_ascii_lowercase", () => {
  for (const N of SIZES) check_operation(N, (s) => s === lower16(s).to_ascii_lowercase().as_str(), (t) => t.is_ascii_lowercase());
});

// crate: tinystr-0.8.4/src/ascii.rs:1048 test_is_ascii_titlecase
test("test_is_ascii_titlecase", () => {
  for (const N of SIZES) check_operation(N, (s) => s === lower16(s).to_ascii_titlecase().as_str(), (t) => t.is_ascii_titlecase());
});

// crate: tinystr-0.8.4/src/ascii.rs:1069 test_is_ascii_uppercase
test("test_is_ascii_uppercase", () => {
  for (const N of SIZES) check_operation(N, (s) => s === lower16(s).to_ascii_uppercase().as_str(), (t) => t.is_ascii_uppercase());
});

// crate: tinystr-0.8.4/src/ascii.rs:1090 test_is_ascii_alphabetic_lowercase
test("test_is_ascii_alphabetic_lowercase", () => {
  for (const N of SIZES)
    check_operation(
      N,
      (s) =>
        // Check alphabetic
        chars(s).every(is_ascii_alphabetic) &&
        // Check lowercase
        s === lower16(s).to_ascii_lowercase().as_str(),
      (t) => t.is_ascii_alphabetic_lowercase(),
    );
});

// crate: tinystr-0.8.4/src/ascii.rs:1114 test_is_ascii_alphabetic_titlecase
test("test_is_ascii_alphabetic_titlecase", () => {
  for (const N of SIZES)
    check_operation(
      N,
      (s) =>
        // Check alphabetic
        chars(s).every(is_ascii_alphabetic) &&
        // Check titlecase
        s === lower16(s).to_ascii_titlecase().as_str(),
      (t) => t.is_ascii_alphabetic_titlecase(),
    );
});

// crate: tinystr-0.8.4/src/ascii.rs:1138 test_is_ascii_alphabetic_uppercase
test("test_is_ascii_alphabetic_uppercase", () => {
  for (const N of SIZES)
    check_operation(
      N,
      (s) =>
        // Check alphabetic
        chars(s).every(is_ascii_alphabetic) &&
        // Check uppercase
        s === lower16(s).to_ascii_uppercase().as_str(),
      (t) => t.is_ascii_alphabetic_uppercase(),
    );
});

const ascii_lower = (c: string) => (c >= "A" && c <= "Z" ? c.toLowerCase() : c);
const ascii_upper = (c: string) => (c >= "a" && c <= "z" ? c.toUpperCase() : c);

// crate: tinystr-0.8.4/src/ascii.rs:1162 test_to_ascii_lowercase
test("test_to_ascii_lowercase", () => {
  for (const N of SIZES) check_operation(N, (s) => Array.from(s, ascii_lower).join(""), (t) => t.to_ascii_lowercase().as_str());
});

// crate: tinystr-0.8.4/src/ascii.rs:1182 test_to_ascii_titlecase
test("test_to_ascii_titlecase", () => {
  for (const N of SIZES)
    check_operation(
      N,
      (s) => {
        const r = Array.from(s, ascii_lower).join("");
        // Safe because the string is nonempty and an ASCII string
        return ascii_upper(r[0]!) + r.slice(1);
      },
      (t) => t.to_ascii_titlecase().as_str(),
    );
});

// crate: tinystr-0.8.4/src/ascii.rs:1206 test_to_ascii_uppercase
test("test_to_ascii_uppercase", () => {
  for (const N of SIZES) check_operation(N, (s) => Array.from(s, ascii_upper).join(""), (t) => t.to_ascii_uppercase().as_str());
});

// The inner `fn check<const N: usize>()` of each test is the loop over SIZES (2, 3, 4, 5, 8, 16).
// crate-skip: tinystr-0.8.4/src/ascii.rs:980 check inlined (loop over SIZES)
// crate-skip: tinystr-0.8.4/src/ascii.rs:996 check inlined (loop over SIZES)
// crate-skip: tinystr-0.8.4/src/ascii.rs:1012 check inlined (loop over SIZES)
// crate-skip: tinystr-0.8.4/src/ascii.rs:1028 check inlined (loop over SIZES)
// crate-skip: tinystr-0.8.4/src/ascii.rs:1049 check inlined (loop over SIZES)
// crate-skip: tinystr-0.8.4/src/ascii.rs:1070 check inlined (loop over SIZES)
// crate-skip: tinystr-0.8.4/src/ascii.rs:1091 check inlined (loop over SIZES)
// crate-skip: tinystr-0.8.4/src/ascii.rs:1115 check inlined (loop over SIZES)
// crate-skip: tinystr-0.8.4/src/ascii.rs:1139 check inlined (loop over SIZES)
// crate-skip: tinystr-0.8.4/src/ascii.rs:1163 check inlined (loop over SIZES)
// crate-skip: tinystr-0.8.4/src/ascii.rs:1183 check inlined (loop over SIZES)
// crate-skip: tinystr-0.8.4/src/ascii.rs:1207 check inlined (loop over SIZES)
// The lossy-constructor tests exercise `from_utf8_lossy`/`from_utf16_lossy`, which are not ported:
// crate-skip: tinystr-0.8.4/src/ascii.rs:1226 lossy_constructor tests an unported fn
// crate-skip: tinystr-0.8.4/src/ascii.rs:1248 from_utf8_lossy_rejects_non_ascii_replacement tests an unported fn
// crate-skip: tinystr-0.8.4/src/ascii.rs:1257 from_utf16_lossy_rejects_non_ascii_replacement tests an unported fn
// crate-skip: tinystr-0.8.4/src/ascii.rs:1263 from_utf8_lossy_rejects_null_replacement tests an unported fn

test("rust-ts: is_ascii_* on the empty string and N > 8 first-byte rules", () => {
  // Exercises the third/second `check_is!` arms on an empty TinyAsciiStr<16> (first byte NUL).
  const e = lower16("");
  expect(e.is_ascii_alphabetic_lowercase()).toBe(false);
  expect(e.is_ascii_lowercase()).toBe(true);
  expect(e.is_empty()).toBe(true);
  expect(e.len()).toBe(0);
});
