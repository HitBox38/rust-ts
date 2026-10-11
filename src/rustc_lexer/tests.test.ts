// Port of compiler/rustc_lexer/src/tests.rs
import { expect, test } from "bun:test";
import { PLAIN } from "../std/fmt.ts";
import { debug_result, Err, Ok, type Result } from "../std/result.ts";
import { Str, utf8_len } from "../std/str.ts";
import { trim_indent } from "../rust_ts/expect.ts";
import { Cursor, debug_RawStrError, debug_Token, FrontmatterAllowed, strip_shebang, tokenize, type RawStrError } from "./lib.ts";
import { debug_int } from "../std/fmt.ts";

const debug_raw = (r: Result<number, RawStrError>) => debug_result(r, PLAIN, debug_int, debug_RawStrError);

// rustc: compiler/rustc_lexer/src/tests.rs:5 check_raw_str
function check_raw_str(s: string, expected: Result<number, RawStrError>): void {
  const src = Str.from(`r${s}`);
  const cursor = Cursor.new(src, FrontmatterAllowed.No);
  cursor.bump();
  const res = cursor.raw_double_quoted_string(0);
  expect(debug_raw(res)).toBe(debug_raw(expected));
}

// rustc: compiler/rustc_lexer/src/tests.rs:14 test_naked_raw_str
test("test_naked_raw_str", () => {
  check_raw_str(String.raw`"abc"`, Ok(0));
});

// rustc: compiler/rustc_lexer/src/tests.rs:19 test_raw_no_start
test("test_raw_no_start", () => {
  check_raw_str(String.raw`"abc"#`, Ok(0));
});

// rustc: compiler/rustc_lexer/src/tests.rs:24 test_too_many_terminators
test("test_too_many_terminators", () => {
  // this error is handled in the parser later
  check_raw_str(String.raw`#"abc"##`, Ok(1));
});

// rustc: compiler/rustc_lexer/src/tests.rs:30 test_unterminated
test("test_unterminated", () => {
  check_raw_str(String.raw`#"abc`, Err({ $: "NoTerminator", expected: 1, found: 0, possible_terminator_offset: undefined }));
  check_raw_str(String.raw`##"abc"#`, Err({ $: "NoTerminator", expected: 2, found: 1, possible_terminator_offset: 7 }));
  // We're looking for "# not just any #
  check_raw_str(String.raw`##"abc#`, Err({ $: "NoTerminator", expected: 2, found: 0, possible_terminator_offset: undefined }));
});

// rustc: compiler/rustc_lexer/src/tests.rs:51 test_invalid_start
test("test_invalid_start", () => {
  check_raw_str(String.raw`#~"abc"#`, Err({ $: "InvalidStarter", bad_char: "~".codePointAt(0)! }));
});

// rustc: compiler/rustc_lexer/src/tests.rs:56 test_unterminated_no_pound
test("test_unterminated_no_pound", () => {
  // https://github.com/rust-lang/rust/issues/70677
  check_raw_str(`"`, Err({ $: "NoTerminator", expected: 0, found: 0, possible_terminator_offset: undefined }));
});

// rustc: compiler/rustc_lexer/src/tests.rs:65 test_too_many_hashes
test("test_too_many_hashes", () => {
  const max_count = 255;
  const hashes1 = "#".repeat(max_count);
  const hashes2 = "#".repeat(max_count + 1);
  const middle = '"abc"';
  const s1 = [hashes1, middle, hashes1].join("");
  const s2 = [hashes2, middle, hashes2].join("");

  // Valid number of hashes (255 = 2^8 - 1 = u8::MAX).
  check_raw_str(s1, Ok(255));

  // One more hash sign (256 = 2^8) becomes too many.
  check_raw_str(s2, Err({ $: "TooManyDelimiters", found: max_count + 1 }));
});

// https://github.com/rust-lang/rust/issues/70528
// rustc: compiler/rustc_lexer/src/tests.rs:82 test_valid_shebang
test("test_valid_shebang", () => {
  const cases: [string, number | undefined][] = [
    ["#!/bin/bash", utf8_len("#!/bin/bash")],
    ["#![attribute]", undefined],
    ["#!    /bin/bash", utf8_len("#!    /bin/bash")],
    ["#!    [attribute]", undefined],
    ["#! /* blah */  /bin/bash", utf8_len("#! /* blah */  /bin/bash")],
    ["#! /* blah */  [attribute]", undefined],
    ["#! // blah\n/bin/bash", 10], // strip up to the newline
    ["#! // blah\n[attribute]", undefined],
    ["#! /* blah\nblah\nblah */  /bin/bash", 10],
    ["#! /* blah\nblah\nblah */  [attribute]", undefined],
    ["#!\n/bin/sh", 2],
    ["#!\n[attribute]", undefined],
    // Because shebangs are interpreted by the kernel, they must be on the first line
    ["\n#!/bin/bash", undefined],
    ["\n#![attribute]", undefined],
  ];
  for (const [input, expected] of cases) expect(strip_shebang(Str.from(input))).toBe(expected);
});

// rustc: compiler/rustc_lexer/src/tests.rs:127 check_lexing
function check_lexing(src: string, frontmatter_allowed: FrontmatterAllowed, expected: string): void {
  let actual = "";
  for (const token of tokenize(Str.from(src), frontmatter_allowed)) actual += debug_Token(token, PLAIN) + "\n";
  expect(actual).toBe(trim_indent(expected));
}

// rustc: compiler/rustc_lexer/src/tests.rs:134 smoke_test
test("smoke_test", () => {
  check_lexing(
    '/* my source file */ fn main() { println!("zebra"); }\n',
    FrontmatterAllowed.No,
    `
            Token { kind: BlockComment { doc_style: None, terminated: true }, len: 20 }
            Token { kind: Whitespace, len: 1 }
            Token { kind: Ident, len: 2 }
            Token { kind: Whitespace, len: 1 }
            Token { kind: Ident, len: 4 }
            Token { kind: OpenParen, len: 1 }
            Token { kind: CloseParen, len: 1 }
            Token { kind: Whitespace, len: 1 }
            Token { kind: OpenBrace, len: 1 }
            Token { kind: Whitespace, len: 1 }
            Token { kind: Ident, len: 7 }
            Token { kind: Bang, len: 1 }
            Token { kind: OpenParen, len: 1 }
            Token { kind: Literal { kind: Str { terminated: true }, suffix_start: 7 }, len: 7 }
            Token { kind: CloseParen, len: 1 }
            Token { kind: Semi, len: 1 }
            Token { kind: Whitespace, len: 1 }
            Token { kind: CloseBrace, len: 1 }
            Token { kind: Whitespace, len: 1 }
        `,
  );
});

// rustc: compiler/rustc_lexer/src/tests.rs:163 comment_flavors
test("comment_flavors", () => {
  check_lexing(
    `
// line
//// line as well
/// outer doc line
//! inner doc line
/* block */
/**/
/*** also block */
/** outer doc block */
/*! inner doc block */
`,
    FrontmatterAllowed.No,
    `
            Token { kind: Whitespace, len: 1 }
            Token { kind: LineComment { doc_style: None }, len: 7 }
            Token { kind: Whitespace, len: 1 }
            Token { kind: LineComment { doc_style: None }, len: 17 }
            Token { kind: Whitespace, len: 1 }
            Token { kind: LineComment { doc_style: Some(Outer) }, len: 18 }
            Token { kind: Whitespace, len: 1 }
            Token { kind: LineComment { doc_style: Some(Inner) }, len: 18 }
            Token { kind: Whitespace, len: 1 }
            Token { kind: BlockComment { doc_style: None, terminated: true }, len: 11 }
            Token { kind: Whitespace, len: 1 }
            Token { kind: BlockComment { doc_style: None, terminated: true }, len: 4 }
            Token { kind: Whitespace, len: 1 }
            Token { kind: BlockComment { doc_style: None, terminated: true }, len: 18 }
            Token { kind: Whitespace, len: 1 }
            Token { kind: BlockComment { doc_style: Some(Outer), terminated: true }, len: 22 }
            Token { kind: Whitespace, len: 1 }
            Token { kind: BlockComment { doc_style: Some(Inner), terminated: true }, len: 22 }
            Token { kind: Whitespace, len: 1 }
        `,
  );
});

// rustc: compiler/rustc_lexer/src/tests.rs:202 nested_block_comments
test("nested_block_comments", () => {
  check_lexing(
    "/* /* */ */'a'",
    FrontmatterAllowed.No,
    `
            Token { kind: BlockComment { doc_style: None, terminated: true }, len: 11 }
            Token { kind: Literal { kind: Char { terminated: true }, suffix_start: 3 }, len: 3 }
        `,
  );
});

// rustc: compiler/rustc_lexer/src/tests.rs:214 characters
test("characters", () => {
  check_lexing(
    "'a' ' ' '\\n'",
    FrontmatterAllowed.No,
    `
            Token { kind: Literal { kind: Char { terminated: true }, suffix_start: 3 }, len: 3 }
            Token { kind: Whitespace, len: 1 }
            Token { kind: Literal { kind: Char { terminated: true }, suffix_start: 3 }, len: 3 }
            Token { kind: Whitespace, len: 1 }
            Token { kind: Literal { kind: Char { terminated: true }, suffix_start: 4 }, len: 4 }
        `,
  );
});

// rustc: compiler/rustc_lexer/src/tests.rs:229 lifetime
test("lifetime", () => {
  check_lexing(
    "'abc",
    FrontmatterAllowed.No,
    `
            Token { kind: Lifetime { starts_with_number: false }, len: 4 }
        `,
  );
});

// rustc: compiler/rustc_lexer/src/tests.rs:240 raw_string
test("raw_string", () => {
  check_lexing(
    'r###""#a\\b\x00c""###',
    FrontmatterAllowed.No,
    `
            Token { kind: Literal { kind: RawStr { n_hashes: Some(3) }, suffix_start: 17 }, len: 17 }
        `,
  );
});

// rustc: compiler/rustc_lexer/src/tests.rs:251 literal_suffixes
test("literal_suffixes", () => {
  check_lexing(
    `
'a'
b'a'
"a"
b"a"
1234
0b101
0xABC
1.0
1.0e10
2us
r###"raw"###suffix
br###"raw"###suffix
`,
    FrontmatterAllowed.No,
    `
            Token { kind: Whitespace, len: 1 }
            Token { kind: Literal { kind: Char { terminated: true }, suffix_start: 3 }, len: 3 }
            Token { kind: Whitespace, len: 1 }
            Token { kind: Literal { kind: Byte { terminated: true }, suffix_start: 4 }, len: 4 }
            Token { kind: Whitespace, len: 1 }
            Token { kind: Literal { kind: Str { terminated: true }, suffix_start: 3 }, len: 3 }
            Token { kind: Whitespace, len: 1 }
            Token { kind: Literal { kind: ByteStr { terminated: true }, suffix_start: 4 }, len: 4 }
            Token { kind: Whitespace, len: 1 }
            Token { kind: Literal { kind: Int { base: Decimal, empty_int: false }, suffix_start: 4 }, len: 4 }
            Token { kind: Whitespace, len: 1 }
            Token { kind: Literal { kind: Int { base: Binary, empty_int: false }, suffix_start: 5 }, len: 5 }
            Token { kind: Whitespace, len: 1 }
            Token { kind: Literal { kind: Int { base: Hexadecimal, empty_int: false }, suffix_start: 5 }, len: 5 }
            Token { kind: Whitespace, len: 1 }
            Token { kind: Literal { kind: Float { base: Decimal, empty_exponent: false }, suffix_start: 3 }, len: 3 }
            Token { kind: Whitespace, len: 1 }
            Token { kind: Literal { kind: Float { base: Decimal, empty_exponent: false }, suffix_start: 6 }, len: 6 }
            Token { kind: Whitespace, len: 1 }
            Token { kind: Literal { kind: Int { base: Decimal, empty_int: false }, suffix_start: 1 }, len: 3 }
            Token { kind: Whitespace, len: 1 }
            Token { kind: Literal { kind: RawStr { n_hashes: Some(3) }, suffix_start: 12 }, len: 18 }
            Token { kind: Whitespace, len: 1 }
            Token { kind: Literal { kind: RawByteStr { n_hashes: Some(3) }, suffix_start: 13 }, len: 19 }
            Token { kind: Whitespace, len: 1 }
        `,
  );
});

const FRONTMATTER_SRC = `
---cargo
[dependencies]
clap = "4"
---

fn main() {}
`;

// rustc: compiler/rustc_lexer/src/tests.rs:299 frontmatter_allowed
test("frontmatter_allowed", () => {
  check_lexing(
    FRONTMATTER_SRC,
    FrontmatterAllowed.Yes,
    `
            Token { kind: Whitespace, len: 1 }
            Token { kind: Frontmatter { has_invalid_preceding_whitespace: false, invalid_infostring: false }, len: 38 }
            Token { kind: Whitespace, len: 2 }
            Token { kind: Ident, len: 2 }
            Token { kind: Whitespace, len: 1 }
            Token { kind: Ident, len: 4 }
            Token { kind: OpenParen, len: 1 }
            Token { kind: CloseParen, len: 1 }
            Token { kind: Whitespace, len: 1 }
            Token { kind: OpenBrace, len: 1 }
            Token { kind: CloseBrace, len: 1 }
            Token { kind: Whitespace, len: 1 }
        `,
  );
});

// rustc: compiler/rustc_lexer/src/tests.rs:328 frontmatter_disallowed
test("frontmatter_disallowed", () => {
  check_lexing(
    FRONTMATTER_SRC,
    FrontmatterAllowed.No,
    `
            Token { kind: Whitespace, len: 1 }
            Token { kind: Minus, len: 1 }
            Token { kind: Minus, len: 1 }
            Token { kind: Minus, len: 1 }
            Token { kind: Ident, len: 5 }
            Token { kind: Whitespace, len: 1 }
            Token { kind: OpenBracket, len: 1 }
            Token { kind: Ident, len: 12 }
            Token { kind: CloseBracket, len: 1 }
            Token { kind: Whitespace, len: 1 }
            Token { kind: Ident, len: 4 }
            Token { kind: Whitespace, len: 1 }
            Token { kind: Eq, len: 1 }
            Token { kind: Whitespace, len: 1 }
            Token { kind: Literal { kind: Str { terminated: true }, suffix_start: 3 }, len: 3 }
            Token { kind: Whitespace, len: 1 }
            Token { kind: Minus, len: 1 }
            Token { kind: Minus, len: 1 }
            Token { kind: Minus, len: 1 }
            Token { kind: Whitespace, len: 2 }
            Token { kind: Ident, len: 2 }
            Token { kind: Whitespace, len: 1 }
            Token { kind: Ident, len: 4 }
            Token { kind: OpenParen, len: 1 }
            Token { kind: CloseParen, len: 1 }
            Token { kind: Whitespace, len: 1 }
            Token { kind: OpenBrace, len: 1 }
            Token { kind: CloseBrace, len: 1 }
            Token { kind: Whitespace, len: 1 }
        `,
  );
});
