// Port of compiler/rustc_errors/src/markdown/tests/parse.rs
import { expect, test } from "bun:test";
import { utf8 } from "../../../std/str.ts";
import { MdStream, MdTree } from "../mod.ts";
import {
  CMT_E,
  CMT_S,
  type ParseOpt,
  entrypoint,
  get_indented_section,
  parse_any_link,
  parse_codeblock,
  parse_codeinline,
  parse_heading,
  parse_ordered_li,
  parse_simple_pat,
  parse_unordered_li,
} from "../parse.ts";

const b = (s: string): Uint8Array => utf8(s);
const s = (x: Uint8Array): string => new TextDecoder().decode(x);
const stream = (v: MdTree[]): MdStream => MdStream.from(v);

/** `.unwrap()` of an `Option` */
function unwrap<T>(x: T | undefined): T {
  if (x === undefined) throw new Error("called `Option::unwrap()` on a `None` value");
  return x;
}

// rustc: compiler/rustc_errors/src/markdown/tests/parse.rs:6 test_parse_simple
test("test_parse_simple", () => {
  let buf = "**abcd** rest";
  const [t, r] = unwrap(parse_simple_pat(b(buf), b("**"), b("**"), "None", MdTree.Strong));
  expect(t).toEqual(MdTree.Strong("abcd"));
  expect(s(r)).toBe(" rest");

  // Escaping should fail
  buf = String.raw`**abcd\** rest`;
  const res = parse_simple_pat(b(buf), b("**"), b("**"), "None", MdTree.Strong);
  expect(res).toBeUndefined();
});

// rustc: compiler/rustc_errors/src/markdown/tests/parse.rs:19 test_parse_comment
test("test_parse_comment", () => {
  const opt: ParseOpt = "TrimNoEsc";
  let buf = "<!-- foobar! -->rest";
  let [t, r] = unwrap(parse_simple_pat(b(buf), CMT_S, CMT_E, opt, MdTree.Comment));
  expect(t).toEqual(MdTree.Comment("foobar!"));
  expect(s(r)).toBe("rest");

  buf = String.raw`<!-- foobar! \-->rest`;
  [t, r] = unwrap(parse_simple_pat(b(buf), CMT_S, CMT_E, opt, MdTree.Comment));
  expect(t).toEqual(MdTree.Comment("foobar! \\"));
  expect(s(r)).toBe("rest");
});

// rustc: compiler/rustc_errors/src/markdown/tests/parse.rs:33 test_parse_heading
test("test_parse_heading", () => {
  let buf1 = "# Top level\nrest";
  let [t, r] = unwrap(parse_heading(b(buf1)));
  expect(t).toEqual({ $: "Heading", _0: 1, _1: stream([MdTree.PlainText("Top level")]) });
  expect(s(r)).toBe("\nrest");

  buf1 = "# Empty";
  [t, r] = unwrap(parse_heading(b(buf1)));
  expect(t).toEqual({ $: "Heading", _0: 1, _1: stream([MdTree.PlainText("Empty")]) });
  expect(s(r)).toBe("");

  // Combo
  const buf2 = "### Top `level` _woo_\nrest";
  [t, r] = unwrap(parse_heading(b(buf2)));
  expect(t).toEqual({
    $: "Heading",
    _0: 3,
    _1: stream([MdTree.PlainText("Top "), MdTree.CodeInline("level"), MdTree.PlainText(" "), MdTree.Emphasis("woo")]),
  });
  expect(s(r)).toBe("\nrest");
});

// rustc: compiler/rustc_errors/src/markdown/tests/parse.rs:64 test_parse_code_inline
test("test_parse_code_inline", () => {
  const buf1 = "`abcd` rest";
  let [t, r] = unwrap(parse_codeinline(b(buf1)));
  expect(t).toEqual(MdTree.CodeInline("abcd"));
  expect(s(r)).toBe(" rest");

  // extra backticks, newline
  const buf2 = "```ab\ncd``` rest";
  [t, r] = unwrap(parse_codeinline(b(buf2)));
  expect(t).toEqual(MdTree.CodeInline("ab\ncd"));
  expect(s(r)).toBe(" rest");

  // test no escaping
  const buf3 = "`abcd\\` rest";
  [t, r] = unwrap(parse_codeinline(b(buf3)));
  expect(t).toEqual(MdTree.CodeInline("abcd\\"));
  expect(s(r)).toBe(" rest");
});

// rustc: compiler/rustc_errors/src/markdown/tests/parse.rs:84 test_parse_code_block
test("test_parse_code_block", () => {
  const buf1 = "```rust\ncode\ncode\n```\nleftovers";
  let [t, r] = parse_codeblock(b(buf1));
  expect(t).toEqual({ $: "CodeBlock", txt: "code\ncode", lang: "rust" });
  expect(s(r)).toBe("\nleftovers");

  const buf2 = "`````\ncode\ncode````\n`````\nleftovers";
  [t, r] = parse_codeblock(b(buf2));
  expect(t).toEqual({ $: "CodeBlock", txt: "code\ncode````", lang: undefined });
  expect(s(r)).toBe("\nleftovers");
});

// rustc: compiler/rustc_errors/src/markdown/tests/parse.rs:97 test_parse_link
test("test_parse_link", () => {
  const simple = "[see here](docs.rs) other";
  let [t, r] = unwrap(parse_any_link(b(simple), false));
  expect(t).toEqual({ $: "Link", disp: "see here", link: "docs.rs" });
  expect(s(r)).toBe(" other");

  const simple_toplevel = "[see here](docs.rs) other";
  [t, r] = unwrap(parse_any_link(b(simple_toplevel), true));
  expect(t).toEqual({ $: "Link", disp: "see here", link: "docs.rs" });
  expect(s(r)).toBe(" other");

  const reference = "[see here] other";
  [t, r] = unwrap(parse_any_link(b(reference), true));
  expect(t).toEqual({ $: "RefLink", disp: "see here", id: undefined });
  expect(s(r)).toBe(" other");

  const reference_full = "[see here][docs-rs] other";
  [t, r] = unwrap(parse_any_link(b(reference_full), false));
  expect(t).toEqual({ $: "RefLink", disp: "see here", id: "docs-rs" });
  expect(s(r)).toBe(" other");

  const reference_def = "[see here]: docs.rs\nother";
  [t, r] = unwrap(parse_any_link(b(reference_def), true));
  expect(t).toEqual({ $: "LinkDef", id: "see here", link: "docs.rs" });
  expect(s(r)).toBe("\nother");
});

const IND1 = "test standard\n    ind\n    ind2\nnot ind";
const IND2 = "test end of stream\n  1\n  2\n";
const IND3 = "test empty lines\n  1\n  2\n\nnot ind";

// rustc: compiler/rustc_errors/src/markdown/tests/parse.rs:139 test_indented_section
test("test_indented_section", () => {
  const [t, r] = get_indented_section(b(IND1));
  expect(s(t)).toBe("test standard\n    ind\n    ind2");
  expect(s(r)).toBe("\nnot ind");

  let [txt, rest] = get_indented_section(b(IND2));
  expect(s(txt)).toBe("test end of stream\n  1\n  2\n");
  expect(s(rest)).toBe("");

  [txt, rest] = get_indented_section(b(IND3));
  expect(s(txt)).toBe("test empty lines\n  1\n  2\n");
  expect(s(rest)).toBe("\nnot ind");
});

const HBT = "# Heading\n\ncontent";

// rustc: compiler/rustc_errors/src/markdown/tests/parse.rs:158 test_heading_breaks
test("test_heading_breaks", () => {
  const expected = stream([{ $: "Heading", _0: 1, _1: stream([MdTree.PlainText("Heading")]) }, MdTree.PlainText("content")]);
  const res = entrypoint(HBT);
  expect(res).toEqual(expected);
});

const NL1 = "start\n\nend";
const NL2 = "start\n\n\nend";
const NL3 = "start\n\n\n\nend";

// rustc: compiler/rustc_errors/src/markdown/tests/parse.rs:182 test_newline_breaks
test("test_newline_breaks", () => {
  const expected = stream([MdTree.PlainText("start"), MdTree.ParagraphBreak, MdTree.PlainText("end")]);
  for (const [idx, check] of [NL1, NL2, NL3].entries()) {
    const res = entrypoint(check);
    expect(res, `failed ${idx}`).toEqual(expected);
  }
});

const WRAP = "plain _italics\nitalics_";

// rustc: compiler/rustc_errors/src/markdown/tests/parse.rs:195 test_wrap_pattern
test("test_wrap_pattern", () => {
  const expected = stream([MdTree.PlainText("plain "), MdTree.Emphasis("italics"), MdTree.Emphasis(" "), MdTree.Emphasis("italics")]);
  const res = entrypoint(WRAP);
  expect(res).toEqual(expected);
});

const WRAP_NOTXT = "_italics_\n**bold**";

// rustc: compiler/rustc_errors/src/markdown/tests/parse.rs:211 test_wrap_notxt
test("test_wrap_notxt", () => {
  const expected = stream([MdTree.Emphasis("italics"), MdTree.PlainText(" "), MdTree.Strong("bold")]);
  const res = entrypoint(WRAP_NOTXT);
  expect(res).toEqual(expected);
});

const MIXED_LIST = `start
- _italics item_
<!-- comment -->
- **bold item**
  second line [link1](foobar1)
  third line [link2][link-foo]
-   :crab:
    extra indent
end
[link-foo]: foobar2
`;

// rustc: compiler/rustc_errors/src/markdown/tests/parse.rs:231 test_list
test("test_list", () => {
  const expected = stream([
    MdTree.PlainText("start"),
    MdTree.ParagraphBreak,
    { $: "UnorderedListItem", _0: stream([MdTree.Emphasis("italics item")]) },
    MdTree.LineBreak,
    {
      $: "UnorderedListItem",
      _0: stream([
        MdTree.Strong("bold item"),
        MdTree.PlainText(" second line "),
        { $: "Link", disp: "link1", link: "foobar1" },
        MdTree.PlainText(" third line "),
        { $: "Link", disp: "link2", link: "foobar2" },
      ]),
    },
    MdTree.LineBreak,
    { $: "UnorderedListItem", _0: stream([MdTree.PlainText("🦀"), MdTree.PlainText(" extra indent")]) },
    MdTree.ParagraphBreak,
    MdTree.PlainText("end"),
  ]);
  const res = entrypoint(MIXED_LIST);
  expect(res).toEqual(expected);
});

const SMOOSHED = `
start
### heading
1. ordered item
\`\`\`rust
println!("Hello, world!");
\`\`\`
\`inline\`
\`\`end\`\`
`;

// rustc: compiler/rustc_errors/src/markdown/tests/parse.rs:271 test_without_breaks
test("test_without_breaks", () => {
  const expected = stream([
    MdTree.PlainText("start"),
    MdTree.ParagraphBreak,
    { $: "Heading", _0: 3, _1: stream([MdTree.PlainText("heading")]) },
    { $: "OrderedListItem", _0: 1, _1: stream([MdTree.PlainText("ordered item")]) },
    MdTree.ParagraphBreak,
    { $: "CodeBlock", txt: `println!("Hello, world!");`, lang: "rust" },
    MdTree.ParagraphBreak,
    MdTree.CodeInline("inline"),
    MdTree.PlainText(" "),
    MdTree.CodeInline("end"),
  ]);
  const res = entrypoint(SMOOSHED);
  expect(res).toEqual(expected);
});

const CODE_STARTLINE = `
start
\`code\`
middle
\`more code\`
end
`;

// rustc: compiler/rustc_errors/src/markdown/tests/parse.rs:298 test_code_at_start
test("test_code_at_start", () => {
  const expected = stream([
    MdTree.PlainText("start"),
    MdTree.PlainText(" "),
    MdTree.CodeInline("code"),
    MdTree.PlainText(" "),
    MdTree.PlainText("middle"),
    MdTree.PlainText(" "),
    MdTree.CodeInline("more code"),
    MdTree.PlainText(" "),
    MdTree.PlainText("end"),
  ]);
  const res = entrypoint(CODE_STARTLINE);
  expect(res).toEqual(expected);
});

// rustc: compiler/rustc_errors/src/markdown/tests/parse.rs:316 test_code_in_parens
test("test_code_in_parens", () => {
  const expected = stream([MdTree.PlainText("("), MdTree.CodeInline("Foo"), MdTree.PlainText(")")]);
  const res = entrypoint("(`Foo`)");
  expect(res).toEqual(expected);
});

const LIST_WITH_SPACE = "\npara\n * l1\n * l2\n";

// rustc: compiler/rustc_errors/src/markdown/tests/parse.rs:330 test_list_with_space
test("test_list_with_space", () => {
  const expected = stream([
    MdTree.PlainText("para"),
    MdTree.ParagraphBreak,
    { $: "UnorderedListItem", _0: stream([MdTree.PlainText("l1")]) },
    MdTree.LineBreak,
    { $: "UnorderedListItem", _0: stream([MdTree.PlainText("l2")]) },
  ]);
  const res = entrypoint(LIST_WITH_SPACE);
  expect(res).toEqual(expected);
});

const SNAKE_CASE = "\nfoo*bar*\nfoo**bar**\nfoo_bar_\nfoo__bar__\n";

// rustc: compiler/rustc_errors/src/markdown/tests/parse.rs:351 test_snake_case
test("test_snake_case", () => {
  const expected = stream([
    MdTree.PlainText("foo"),
    MdTree.Emphasis("bar"),
    MdTree.PlainText(" "),
    MdTree.PlainText("foo"),
    MdTree.Strong("bar"),
    MdTree.PlainText(" "),
    MdTree.PlainText("foo_bar_"),
    MdTree.PlainText(" "),
    MdTree.PlainText("foo__bar__"),
  ]);
  const res = entrypoint(SNAKE_CASE);
  expect(res).toEqual(expected);
});

// rustc: compiler/rustc_errors/src/markdown/tests/parse.rs:369 test_codeblock_trailing_whitespace
test("test_codeblock_trailing_whitespace", () => {
  let buf = "```rust\ncode\n```    \nrest";
  let [t, r] = parse_codeblock(b(buf));
  expect(t).toEqual({ $: "CodeBlock", txt: "code", lang: "rust" });
  expect(s(r)).toBe("\nrest");

  buf = "```rust\ncode\n```abc\nrest";
  [t, r] = parse_codeblock(b(buf));
  expect(t).toEqual({ $: "CodeBlock", txt: "code\n```abc\nrest", lang: "rust" });
  expect(s(r)).toBe("");
});

// rustc: compiler/rustc_errors/src/markdown/tests/parse.rs:382 test_list_item_leading_whitespace
test("test_list_item_leading_whitespace", () => {
  // extra spaces after marker
  let buf = "-   hello";
  let [t, r] = parse_unordered_li(b(buf));
  expect(t).toEqual({ $: "UnorderedListItem", _0: stream([MdTree.PlainText("hello")]) });
  expect(s(r)).toBe("");

  // tab after the marker space
  buf = "- \thello";
  [t, r] = parse_unordered_li(b(buf));
  expect(t).toEqual({ $: "UnorderedListItem", _0: stream([MdTree.PlainText("hello")]) });
  expect(s(r)).toBe("");

  // ordered list
  buf = "1.   hello";
  [t, r] = parse_ordered_li(b(buf));
  expect(t).toEqual({ $: "OrderedListItem", _0: 1, _1: stream([MdTree.PlainText("hello")]) });
  expect(s(r)).toBe("");
});
