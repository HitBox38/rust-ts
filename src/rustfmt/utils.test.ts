// Port of the `#[cfg(test)] mod test` of src/tools/rustfmt/src/utils.rs:778 (lane rustfmt-contract-2), plus checks of
// the helpers that have no upstream test (marked "not upstream").
// The two upstream tests go through comment.rs (`CharClasses`, `LineClasses`): while that module is missing they assert
// that the port stops `Unported` there; once it lands they run upstream's assertion unchanged.
import { expect, test } from "bun:test";
import { Unported } from "../std/panic.ts";
import { install_serde_stubs } from "./config/serde_stubs.test_support.ts";
import { COMMENT, UNICODE_WIDTH_0_1, BYTECOUNT, install_contract_stubs } from "./contract_stubs.test_support.ts";
import { Indent, Shape } from "./shape.ts";

install_serde_stubs();
const stubbed = install_contract_stubs();
const { default_Config } = await import("./config/mod.ts");
const utils = await import("./utils.ts");
const { create_default_session_globals_then } = await import("../rustc_span/lib.ts");
const { BytePos, Span } = await import("../rustc_span/lib.ts");
const { SyntaxContext } = await import("../rustc_span/hygiene.ts");

// rustc: src/tools/rustfmt/src/utils.rs:783 test_remove_trailing_white_spaces
test("test_remove_trailing_white_spaces", () => {
  const s = '    r#"\n        test\n    "#';
  if (stubbed.includes(COMMENT)) {
    expect(() => utils.remove_trailing_white_spaces(s)).toThrow(Unported);
    return;
  }
  expect(utils.remove_trailing_white_spaces(s)).toBe(s);
});

// rustc: src/tools/rustfmt/src/utils.rs:789 test_trim_left_preserve_layout
test("test_trim_left_preserve_layout", () => {
  const s = "aaa\n\tbbb\n    ccc";
  const config = default_Config();
  const indent = Indent.new(4, 0);
  if (stubbed.includes(COMMENT)) {
    expect(() => utils.trim_left_preserve_layout(s, indent, config)).toThrow(Unported);
    return;
  }
  expect(utils.trim_left_preserve_layout(s, indent, config)).toBe("aaa\n    bbb\n    ccc");
});

// not upstream: `extra_offset` counts UTF-8 bytes of the last line (`text.len()` minus the byte index of the `'\n'`)
test("extra_offset (not upstream)", () => {
  const shape = Shape.legacy(100, Indent.new(0, 2));
  expect(shape.used_width()).toBe(2);
  expect(utils.extra_offset("é\nabcdé", shape)).toBe(4); // 6 bytes after the '\n', minus 2
  expect(utils.extra_offset("é\na", shape)).toBe(0); // saturating
  expect(utils.extra_offset("aé", shape)).toBe(3); // no newline: `text.len()`
});

// not upstream
test("count_lf_crlf (not upstream)", () => {
  expect(utils.count_lf_crlf("a\nb\r\nc\r\r\nd\n")).toEqual([2, 2]);
  expect(utils.count_lf_crlf("\ré\n")).toEqual([1, 0]); // a non-ASCII char resets `is_crlf`
  expect(utils.count_lf_crlf("")).toEqual([0, 0]);
});

// not upstream
test("count_newlines and unicode_str_width reach their vendor crates (not upstream)", () => {
  if (stubbed.includes(BYTECOUNT)) expect(() => utils.count_newlines("a\nb\n")).toThrow(Unported);
  else expect(utils.count_newlines("a\nb\né\n")).toBe(3);
  if (stubbed.includes(UNICODE_WIDTH_0_1)) expect(() => utils.unicode_str_width("abc")).toThrow(Unported);
  else expect(utils.unicode_str_width("abc")).toBe(3);
});

// not upstream
test("line predicates (not upstream)", () => {
  expect(utils.is_single_line("abc")).toBe(true);
  expect(utils.is_single_line("a\nb")).toBe(false);
  expect(utils.first_line_contains_single_line_comment("a // x\nb")).toBe(true);
  expect(utils.first_line_contains_single_line_comment("a\nb // x")).toBe(false);
  expect(utils.first_line_contains_single_line_comment("")).toBe(false);
  expect(utils.last_line_contains_single_line_comment("a\nb // x")).toBe(true);
  expect(utils.last_line_contains_single_line_comment("a // x\nb")).toBe(false);
  expect(utils.last_line_contains_single_line_comment("a // x\n")).toBe(true); // `lines()` has no final empty line
  expect(utils.is_attributes_extendable("#[a]")).toBe(true);
  expect(utils.is_attributes_extendable("#[a] // c")).toBe(false);
  expect(utils.is_attributes_extendable("#[a]\n#[b]")).toBe(false);
  expect(utils.last_line_extendable('r#"x"#')).toBe(true);
  expect(utils.last_line_extendable("foo\n  )]}?> ")).toBe(true);
  expect(utils.last_line_extendable("foo(x)")).toBe(false);
  expect(utils.last_line_extendable("")).toBe(true);
  expect(utils.last_line_extendable("😀)")).toBe(false);
  expect(utils.starts_with_newline("\nx")).toBe(true);
  expect(utils.starts_with_newline("\r\nx")).toBe(true);
  expect(utils.starts_with_newline("\rx")).toBe(false);
  expect(utils.first_line_ends_with("ab{\ncd", "{".codePointAt(0)!)).toBe(true);
  expect(utils.first_line_ends_with("ab{\r\ncd", "{".codePointAt(0)!)).toBe(true);
  expect(utils.first_line_ends_with("", "{".codePointAt(0)!)).toBe(false);
  expect(utils.is_empty_line("")).toBe(true);
  expect(utils.is_empty_line(" \t　")).toBe(true);
  expect(utils.is_empty_line(" x ")).toBe(false);
});

// not upstream
test("keyword formatters (not upstream)", () => {
  expect(utils.format_auto("Yes")).toBe("auto ");
  expect(utils.format_auto("No")).toBe("");
  expect(utils.format_mutability("Mut")).toBe("mut ");
  expect(utils.format_mutability("Not")).toBe("");
  expect(utils.format_pinnedness_and_mutability("Pinned", "Mut")).toEqual(["pin ", "mut "]);
  expect(utils.format_pinnedness_and_mutability("Pinned", "Not")).toEqual(["pin ", "const "]);
  expect(utils.format_pinnedness_and_mutability("Not", "Mut")).toEqual(["", "mut "]);
  expect(utils.format_pinnedness_and_mutability("Not", "Not")).toEqual(["", ""]);
  expect(utils.format_range_end({ $: "Included", _0: "DotDotDot" })).toBe("...");
  expect(utils.format_range_end({ $: "Included", _0: "DotDotEq" })).toBe("..=");
  expect(utils.format_range_end({ $: "Excluded" })).toBe("..");
  expect(utils.format_constness({ $: "No" })).toBe("");
  expect(utils.format_defaultness({ $: "Implicit" })).toBe("");
  expect(utils.format_safety({ $: "Default" })).toBe("");
  expect(utils.format_extern({ $: "None" }, true)).toBe("");
});

// not upstream
test("colon_spaces (not upstream)", () => {
  const config = default_Config();
  // defaults: space_before_colon = false, space_after_colon = true
  expect(utils.colon_spaces(config)).toBe(": ");
  config.set().space_before_colon(true);
  expect(utils.colon_spaces(config)).toBe(" : ");
  config.set().space_after_colon(false);
  expect(utils.colon_spaces(config)).toBe(" :");
  config.set().space_before_colon(false);
  expect(utils.colon_spaces(config)).toBe(":");
});

// not upstream
test("mk_sp, mk_sp_lo_plus_one (not upstream)", () => {
  create_default_session_globals_then(() => {
    const sp = utils.mk_sp(BytePos(3), BytePos(9));
    expect(Span.lo(sp)).toBe(BytePos(3));
    expect(Span.hi(sp)).toBe(BytePos(9));
    expect(Span.ctxt(sp)).toBe(SyntaxContext.root());
    const one = utils.mk_sp_lo_plus_one(BytePos(7));
    expect([Span.lo(one), Span.hi(one)]).toEqual([BytePos(7), BytePos(8)]);
  });
});
