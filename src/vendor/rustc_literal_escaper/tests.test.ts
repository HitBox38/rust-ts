// Port of rustc-literal-escaper-0.0.8/tests/test.rs
import { expect, test } from "bun:test";
import { Err, Ok, type Result } from "../../std/result.ts";
import { Str } from "../../std/str.ts";
import { ch } from "../../std/char.ts";
import { check_raw_byte_str, check_raw_str, EscapeError, unescape_byte, unescape_byte_str, unescape_char, unescape_str } from "./lib.ts";

// PORT: Bun mangles non-ASCII inside String.raw, so those cases use ordinary strings.
const R = String.raw;
type Entry<T> = [number, number, Result<T, EscapeError>];

// crate: rustc-literal-escaper-0.0.8/tests/test.rs:8 test_unescape_char_bad
test("test_unescape_char_bad", () => {
  // crate: rustc-literal-escaper-0.0.8/tests/test.rs:9 check
  function check(literal_text: string, expected_error: EscapeError): void {
    expect(unescape_char(Str.from(literal_text))).toEqual(Err(expected_error));
  }

  check("", EscapeError.ZeroChars);
  check("\\", EscapeError.LoneSlash); // r"\"

  check("\n", EscapeError.EscapeOnlyChar);
  check("\t", EscapeError.EscapeOnlyChar);
  check("'", EscapeError.EscapeOnlyChar);
  check("\r", EscapeError.BareCarriageReturn);

  check("spam", EscapeError.MoreThanOneChar);
  check(R`\x0ff`, EscapeError.MoreThanOneChar);
  check(R`\"a`, EscapeError.MoreThanOneChar);
  check(R`\na`, EscapeError.MoreThanOneChar);
  check(R`\ra`, EscapeError.MoreThanOneChar);
  check(R`\ta`, EscapeError.MoreThanOneChar);
  check(R`\\a`, EscapeError.MoreThanOneChar);
  check(R`\'a`, EscapeError.MoreThanOneChar);
  check(R`\0a`, EscapeError.MoreThanOneChar);
  check(R`\u{0}x`, EscapeError.MoreThanOneChar);
  check(R`\u{1F63b}}`, EscapeError.MoreThanOneChar);

  check(R`\v`, EscapeError.InvalidEscape);
  check("\\💩", EscapeError.InvalidEscape);
  check("\\●", EscapeError.InvalidEscape);
  check("\\\r", EscapeError.InvalidEscape);

  check(R`\x`, EscapeError.TooShortHexEscape);
  check(R`\x0`, EscapeError.TooShortHexEscape);
  check(R`\xf`, EscapeError.TooShortHexEscape);
  check(R`\xa`, EscapeError.TooShortHexEscape);
  check(R`\xx`, EscapeError.InvalidCharInHexEscape);
  check("\\xы", EscapeError.InvalidCharInHexEscape);
  check("\\x🦀", EscapeError.InvalidCharInHexEscape);
  check(R`\xtt`, EscapeError.InvalidCharInHexEscape);
  check(R`\xff`, EscapeError.OutOfRangeHexEscape);
  check(R`\xFF`, EscapeError.OutOfRangeHexEscape);
  check(R`\x80`, EscapeError.OutOfRangeHexEscape);

  check(R`\u`, EscapeError.NoBraceInUnicodeEscape);
  check(R`\u[0123]`, EscapeError.NoBraceInUnicodeEscape);
  check(R`\u{0x}`, EscapeError.InvalidCharInUnicodeEscape);
  check(R`\u{`, EscapeError.UnclosedUnicodeEscape);
  check(R`\u{0000`, EscapeError.UnclosedUnicodeEscape);
  check(R`\u{}`, EscapeError.EmptyUnicodeEscape);
  check(R`\u{_0000}`, EscapeError.LeadingUnderscoreUnicodeEscape);
  check(R`\u{0000000}`, EscapeError.OverlongUnicodeEscape);
  check(R`\u{FFFFFF}`, EscapeError.OutOfRangeUnicodeEscape);
  check(R`\u{ffffff}`, EscapeError.OutOfRangeUnicodeEscape);
  check(R`\u{ffffff}`, EscapeError.OutOfRangeUnicodeEscape);

  check(R`\u{DC00}`, EscapeError.LoneSurrogateUnicodeEscape);
  check(R`\u{DDDD}`, EscapeError.LoneSurrogateUnicodeEscape);
  check(R`\u{DFFF}`, EscapeError.LoneSurrogateUnicodeEscape);

  check(R`\u{D800}`, EscapeError.LoneSurrogateUnicodeEscape);
  check(R`\u{DAAA}`, EscapeError.LoneSurrogateUnicodeEscape);
  check(R`\u{DBFF}`, EscapeError.LoneSurrogateUnicodeEscape);
});

// crate: rustc-literal-escaper-0.0.8/tests/test.rs:72 test_unescape_char_good
test("test_unescape_char_good", () => {
  // crate: rustc-literal-escaper-0.0.8/tests/test.rs:73 check
  function check(literal_text: string, expected_char: number): void {
    expect(unescape_char(Str.from(literal_text))).toEqual(Ok(expected_char));
  }

  check("a", ch("a"));
  check("ы", ch("ы"));
  check("🦀", ch("🦀"));

  check(R`\"`, ch('"'));
  check(R`\n`, ch("\n"));
  check(R`\r`, ch("\r"));
  check(R`\t`, ch("\t"));
  check(R`\\`, ch("\\"));
  check(R`\'`, ch("'"));
  check(R`\0`, ch("\0"));

  check(R`\x00`, ch("\0"));
  check(R`\x5a`, ch("Z"));
  check(R`\x5A`, ch("Z"));
  check(R`\x7f`, 127);

  check(R`\u{0}`, ch("\0"));
  check(R`\u{000000}`, ch("\0"));
  check(R`\u{41}`, ch("A"));
  check(R`\u{0041}`, ch("A"));
  check(R`\u{00_41}`, ch("A"));
  check(R`\u{4__1__}`, ch("A"));
  check(R`\u{1F63b}`, ch("😻"));
});

// crate: rustc-literal-escaper-0.0.8/tests/test.rs:104 test_unescape_str_warn
test("test_unescape_str_warn", () => {
  // crate: rustc-literal-escaper-0.0.8/tests/test.rs:105 check
  function check(literal: string, expected: Entry<number>[]): void {
    const unescaped: Entry<number>[] = [];
    unescape_str(Str.from(literal), (start, end, res) => unescaped.push([start, end, res]));
    expect(unescaped).toEqual(expected);
  }

  // Check we can handle escaped newlines at the end of a file.
  check("\\\n", []);
  check("\\\n ", []);

  check("\\\n \u{a0} x", [
    [0, 5, Err(EscapeError.UnskippedWhitespaceWarning)],
    [3, 5, Ok(0xa0)],
    [5, 6, Ok(ch(" "))],
    [6, 7, Ok(ch("x"))],
  ]);
  check("\\\n  \n  x", [
    [0, 7, Err(EscapeError.MultipleSkippedLinesWarning)],
    [7, 8, Ok(ch("x"))],
  ]);
});

// crate: rustc-literal-escaper-0.0.8/tests/test.rs:134 test_unescape_str_good
test("test_unescape_str_good", () => {
  // crate: rustc-literal-escaper-0.0.8/tests/test.rs:135 check
  function check(literal_text: string, expected: string): void {
    let buf: Result<string, readonly [number, number, EscapeError]> = Ok("");
    unescape_str(Str.from(literal_text), (start, end, c) => {
      if (buf.$ === "Ok") {
        if (c.$ === "Ok") buf = Ok(buf._0 + String.fromCodePoint(c._0));
        else buf = Err([start, end, c._0]);
      }
    });
    expect(buf).toEqual(Ok(expected));
  }

  check("foo", "foo");
  check("", "");
  check(" \t\n", " \t\n");

  check("hello \\\n     world", "hello world");
  check("thread's", "thread's");
});

// crate: rustc-literal-escaper-0.0.8/tests/test.rs:157 test_unescape_byte_bad
test("test_unescape_byte_bad", () => {
  // crate: rustc-literal-escaper-0.0.8/tests/test.rs:158 check
  function check(literal_text: string, expected_error: EscapeError): void {
    expect(unescape_byte(Str.from(literal_text))).toEqual(Err(expected_error));
  }

  check("", EscapeError.ZeroChars);
  check("\\", EscapeError.LoneSlash); // r"\"

  check("\n", EscapeError.EscapeOnlyChar);
  check("\t", EscapeError.EscapeOnlyChar);
  check("'", EscapeError.EscapeOnlyChar);
  check("\r", EscapeError.BareCarriageReturn);

  check("spam", EscapeError.MoreThanOneChar);
  check(R`\x0ff`, EscapeError.MoreThanOneChar);
  check(R`\"a`, EscapeError.MoreThanOneChar);
  check(R`\na`, EscapeError.MoreThanOneChar);
  check(R`\ra`, EscapeError.MoreThanOneChar);
  check(R`\ta`, EscapeError.MoreThanOneChar);
  check(R`\\a`, EscapeError.MoreThanOneChar);
  check(R`\'a`, EscapeError.MoreThanOneChar);
  check(R`\0a`, EscapeError.MoreThanOneChar);

  check(R`\v`, EscapeError.InvalidEscape);
  check("\\💩", EscapeError.InvalidEscape);
  check("\\●", EscapeError.InvalidEscape);

  check(R`\x`, EscapeError.TooShortHexEscape);
  check(R`\x0`, EscapeError.TooShortHexEscape);
  check(R`\xa`, EscapeError.TooShortHexEscape);
  check(R`\xf`, EscapeError.TooShortHexEscape);
  check(R`\xx`, EscapeError.InvalidCharInHexEscape);
  check("\\xы", EscapeError.InvalidCharInHexEscape);
  check("\\x🦀", EscapeError.InvalidCharInHexEscape);
  check(R`\xtt`, EscapeError.InvalidCharInHexEscape);

  check(R`\u`, EscapeError.NoBraceInUnicodeEscape);
  check(R`\u[0123]`, EscapeError.NoBraceInUnicodeEscape);
  check(R`\u{0x}`, EscapeError.InvalidCharInUnicodeEscape);
  check(R`\u{`, EscapeError.UnclosedUnicodeEscape);
  check(R`\u{0000`, EscapeError.UnclosedUnicodeEscape);
  check(R`\u{}`, EscapeError.EmptyUnicodeEscape);
  check(R`\u{_0000}`, EscapeError.LeadingUnderscoreUnicodeEscape);
  check(R`\u{0000000}`, EscapeError.OverlongUnicodeEscape);

  check("ы", EscapeError.NonAsciiCharInByte);
  check("🦀", EscapeError.NonAsciiCharInByte);

  check(R`\u{0}`, EscapeError.UnicodeEscapeInByte);
  check(R`\u{000000}`, EscapeError.UnicodeEscapeInByte);
  check(R`\u{41}`, EscapeError.UnicodeEscapeInByte);
  check(R`\u{0041}`, EscapeError.UnicodeEscapeInByte);
  check(R`\u{00_41}`, EscapeError.UnicodeEscapeInByte);
  check(R`\u{4__1__}`, EscapeError.UnicodeEscapeInByte);
  check(R`\u{1F63b}`, EscapeError.UnicodeEscapeInByte);
  check(R`\u{0}x`, EscapeError.UnicodeEscapeInByte);
  check(R`\u{1F63b}}`, EscapeError.UnicodeEscapeInByte);
  check(R`\u{FFFFFF}`, EscapeError.UnicodeEscapeInByte);
  check(R`\u{ffffff}`, EscapeError.UnicodeEscapeInByte);
  check(R`\u{ffffff}`, EscapeError.UnicodeEscapeInByte);
  check(R`\u{DC00}`, EscapeError.UnicodeEscapeInByte);
  check(R`\u{DDDD}`, EscapeError.UnicodeEscapeInByte);
  check(R`\u{DFFF}`, EscapeError.UnicodeEscapeInByte);
  check(R`\u{D800}`, EscapeError.UnicodeEscapeInByte);
  check(R`\u{DAAA}`, EscapeError.UnicodeEscapeInByte);
  check(R`\u{DBFF}`, EscapeError.UnicodeEscapeInByte);
});

// crate: rustc-literal-escaper-0.0.8/tests/test.rs:226 test_unescape_byte_good
test("test_unescape_byte_good", () => {
  // crate: rustc-literal-escaper-0.0.8/tests/test.rs:227 check
  function check(literal_text: string, expected_byte: number): void {
    expect(unescape_byte(Str.from(literal_text))).toEqual(Ok(expected_byte));
  }

  check("a", ch("a"));

  check(R`\"`, ch('"'));
  check(R`\n`, ch("\n"));
  check(R`\r`, ch("\r"));
  check(R`\t`, ch("\t"));
  check(R`\\`, ch("\\"));
  check(R`\'`, ch("'"));
  check(R`\0`, ch("\0"));

  check(R`\x00`, ch("\0"));
  check(R`\x5a`, ch("Z"));
  check(R`\x5A`, ch("Z"));
  check(R`\x7f`, 127);
  check(R`\x80`, 128);
  check(R`\xff`, 255);
  check(R`\xFF`, 255);
});

// crate: rustc-literal-escaper-0.0.8/tests/test.rs:251 test_unescape_byte_str_good
test("test_unescape_byte_str_good", () => {
  // crate: rustc-literal-escaper-0.0.8/tests/test.rs:252 check
  function check(literal_text: string, expected: string): void {
    let result: Result<number[], readonly [number, number, EscapeError]> = Ok([]);
    unescape_byte_str(Str.from(literal_text), (start, end, res) => {
      if (result.$ === "Ok") {
        if (res.$ === "Ok") result._0.push(res._0);
        else result = Err([start, end, res._0]);
      }
    });
    expect(result).toEqual(Ok([...Buffer.from(expected, "latin1")]));
  }

  check("foo", "foo");
  check("", "");
  check(" \t\n", " \t\n");

  check("hello \\\n     world", "hello world");
  check("thread's", "thread's");
});

// crate: rustc-literal-escaper-0.0.8/tests/test.rs:274 test_unescape_raw_str
test("test_unescape_raw_str", () => {
  // crate: rustc-literal-escaper-0.0.8/tests/test.rs:275 check
  function check(literal: string, expected: Entry<number>[]): void {
    const unescaped: Entry<number>[] = [];
    check_raw_str(Str.from(literal), (start, end, res) => unescaped.push([start, end, res]));
    expect(unescaped).toEqual(expected);
  }

  check("\r", [[0, 1, Err(EscapeError.BareCarriageReturnInRawString)]]);
  check("\rx", [
    [0, 1, Err(EscapeError.BareCarriageReturnInRawString)],
    [1, 2, Ok(ch("x"))],
  ]);
});

// crate: rustc-literal-escaper-0.0.8/tests/test.rs:295 test_unescape_raw_byte_str
test("test_unescape_raw_byte_str", () => {
  // crate: rustc-literal-escaper-0.0.8/tests/test.rs:296 check
  function check(literal: string, expected: Entry<number>[]): void {
    const unescaped: Entry<number>[] = [];
    check_raw_byte_str(Str.from(literal), (start, end, res) => unescaped.push([start, end, res]));
    expect(unescaped).toEqual(expected);
  }

  check("\r", [[0, 1, Err(EscapeError.BareCarriageReturnInRawString)]]);
  check("🦀", [[0, 4, Err(EscapeError.NonAsciiCharInByte)]]);
  check("🦀a", [
    [0, 4, Err(EscapeError.NonAsciiCharInByte)],
    [4, 5, Ok(ch("a"))],
  ]);
});
