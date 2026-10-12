// rust-ts tests for the annotate-snippets 0.12.16 files ported by lane annotate-a. Upstream has no
// `#[cfg(test)]` code in these files (its only inline tests are in renderer/render.rs; the crate's
// `tests/` directory is not shipped in the crates.io package). Expected values were produced by
// running annotate-snippets 0.12.16 itself (release build, internals made `pub` in a scratch copy;
// see docs/handoff/annotate-a.md, "oracle evidence"). Functions that call into render.rs
// (`char_width`, `num_overlap`, `ElementStyle::color_spec`, ...) are covered there once ported.
import { expect, test } from "bun:test";
import { PLAIN, PRETTY } from "../../std/fmt.ts";
import { Panic } from "../../std/panic.ts";
import { Str } from "../../std/str.ts";
import { debug_Level, Level } from "./level.ts";
import { normalize_untrusted_str } from "./lib.ts";
import {
  debug_Renderer,
  DecorStyle,
  DEFAULT_ERROR_STYLE,
  DEFAULT_NOTE_STYLE,
  DEFAULT_WARNING_STYLE,
  ElementStyle,
  Renderer,
  Style,
} from "./renderer/mod.ts";
import { Margin, debug_Margin } from "./renderer/margin.ts";
import { as_substr, CursorLines, debug_LineInfo, debug_SourceMap, debug_TrimmedPatch, SourceMap } from "./renderer/source_map.ts";
import { StyledBuffer } from "./renderer/styled_buffer.ts";
import { Annotation, AnnotationKind, debug_Group, Element, Group, Origin, Padding, Patch, Snippet, Title } from "./snippet.ts";
import { debug_Str, str_get, str_trim, str_split_byte } from "./std_ext.ts";
import { debug_option, debug_vec } from "../../std/fmt.ts";

const S = (s: string) => Str.from(s);

test("Level: names, Debug", () => {
  expect(Level.ERROR.as_str()).toBe("error");
  expect(Level.HELP.as_str()).toBe("help");
  expect(Level.NOTE.no_name().as_str()).toBe("");
  expect(Level.WARNING.with_name("x").as_str()).toBe("x");
  expect(debug_Level(Level.ERROR, PLAIN)).toBe("Level { name: None, level: Error }");
  expect(debug_Level(Level.NOTE.no_name(), PLAIN)).toBe("Level { name: Some(None), level: Note }");
  expect(debug_Level(Level.ERROR.with_name("error: internal compiler error"), PLAIN)).toBe(
    'Level { name: Some(Some("error: internal compiler error")), level: Error }',
  );
  expect(Level.ERROR.style(Renderer.styled().stylesheet)).toBe(DEFAULT_ERROR_STYLE);
});

test("builders and Debug match annotate-snippets", () => {
  const t = Title.id_url(Title.id(Level.ERROR.primary_title("mismatched types"), "E0308"), "http://x");
  let g = Title.element(
    t,
    Element.from_Snippet_Annotation(
      Snippet.annotation(
        Snippet.line_start(Snippet.path(Snippet.source<Annotation>(S("fn main() {}\n")), "a.rs"), 3),
        Annotation.label(AnnotationKind.span("Primary", { start: 3, end: 7 }), "lbl"),
      ),
    ),
  );
  g = Group.element(g, Element.from_Message(Level.NOTE.message("m")));
  g = Group.element(g, Element.from_Origin(Origin.char_column(Origin.line(Origin.path("p.rs"), 2), 5)));
  g = Group.element(g, Element.from_Padding(new Padding()));
  g = Group.element(g, Element.from_Snippet_Patch(Snippet.patch(Snippet.source<Patch>(S("abc")), Patch.new({ start: 0, end: 1 }, S("x")))));
  expect(debug_Group(g, PLAIN)).toBe(
    'Group { primary_level: Level { name: None, level: Error }, title: Some(Title { level: Level { name: None, level: Error }, id: Some(Id { id: Some("E0308"), url: Some("http://x") }), text: "mismatched types", allows_styling: false }), elements: [Cause(Snippet { path: Some("a.rs"), line_start: 3, source: "fn main() {}\\n", markers: [Annotation { span: 3..7, label: Some("lbl"), kind: Primary, highlight_source: false }], fold: true }), Message(Message { level: Level { name: None, level: Note }, text: "m" }), Origin(Origin { path: "p.rs", line: Some(2), char_column: Some(5) }), Padding(Padding), Suggestion(Snippet { path: None, line_start: 1, source: "abc", markers: [Patch { span: 0..1, replacement: "x" }], fold: true })] }',
  );
  expect(debug_Group(Group.with_level(Level.HELP), PRETTY)).toBe(
    "Group {\n    primary_level: Level {\n        name: None,\n        level: Help,\n    },\n    title: None,\n    elements: [],\n}",
  );
  expect(Group.is_empty(Group.with_level(Level.HELP))).toBe(true);
  expect(Group.is_empty(Group.with_title(Level.HELP.secondary_title("x")))).toBe(false);
});

test("Renderer builders, default styles", () => {
  const r = Renderer.anonymized_line_numbers(Renderer.short_message(Renderer.decor_style(Renderer.term_width(Renderer.plain(), 80), "Unicode"), true), true);
  const plain = "Style { fg: None, bg: None, underline: None, effects: Effects() }";
  expect(debug_Renderer(r, PLAIN)).toBe(
    `Renderer { anonymized_line_numbers: true, term_width: 80, decor_style: Unicode, stylesheet: Stylesheet { error: ${plain}, warning: ${plain}, info: ${plain}, note: ${plain}, help: ${plain}, line_num: ${plain}, emphasis: ${plain}, none: ${plain}, context: ${plain}, addition: ${plain}, removal: ${plain} }, short_message: true }`,
  );
  const s = Renderer.error(Renderer.styled(), Style.new());
  expect(debug_Renderer(s, PLAIN)).toBe(
    "Renderer { anonymized_line_numbers: false, term_width: 140, decor_style: Ascii, stylesheet: Stylesheet { error: Style { fg: None, bg: None, underline: None, effects: Effects() }, warning: Style { fg: Some(Ansi(Yellow)), bg: None, underline: None, effects: Effects(BOLD) }, info: Style { fg: Some(Ansi(BrightBlue)), bg: None, underline: None, effects: Effects(BOLD) }, note: Style { fg: Some(Ansi(BrightGreen)), bg: None, underline: None, effects: Effects(BOLD) }, help: Style { fg: Some(Ansi(BrightCyan)), bg: None, underline: None, effects: Effects(BOLD) }, line_num: Style { fg: Some(Ansi(BrightBlue)), bg: None, underline: None, effects: Effects(BOLD) }, emphasis: Style { fg: None, bg: None, underline: None, effects: Effects(BOLD) }, none: Style { fg: None, bg: None, underline: None, effects: Effects() }, context: Style { fg: Some(Ansi(BrightBlue)), bg: None, underline: None, effects: Effects(BOLD) }, addition: Style { fg: Some(Ansi(BrightGreen)), bg: None, underline: None, effects: Effects() }, removal: Style { fg: Some(Ansi(BrightRed)), bg: None, underline: None, effects: Effects() } }, short_message: false }",
  );
  // `Renderer::styled()` is unchanged by overriding a style on another renderer.
  expect(Renderer.styled().stylesheet.error).toBe(DEFAULT_ERROR_STYLE);
  expect(Style.fmt(DEFAULT_ERROR_STYLE, PLAIN)).toBe("\u{1b}[1m\u{1b}[91m");
  expect(Style.fmt(DEFAULT_WARNING_STYLE, PLAIN)).toBe("\u{1b}[1m\u{1b}[33m");
  expect(Style.fmt(DEFAULT_NOTE_STYLE, PRETTY)).toBe("\u{1b}[0m");
});

test("DecorStyle", () => {
  expect(String.fromCodePoint(DecorStyle.col_separator("Unicode"))).toBe("│");
  expect(DecorStyle.note_separator("Unicode", true)).toBe("├ ");
  expect(DecorStyle.note_separator("Unicode", false)).toBe("╰ ");
  expect(DecorStyle.note_separator("Ascii", true)).toBe("= ");
  expect(DecorStyle.file_start("Unicode", true, true)).toBe(" ─▸ ");
  expect(DecorStyle.file_start("Unicode", true, false)).toBe(" ╭▸ ");
  expect(DecorStyle.file_start("Unicode", false, true)).toBe(" ├▸ ");
  expect(DecorStyle.file_start("Ascii", true, true)).toBe("--> ");
  expect(DecorStyle.secondary_file_start("Unicode")).toBe(" ⸬  ");
  expect(String.fromCodePoint(DecorStyle.diff("Ascii"))).toBe("~");
  expect(DecorStyle.margin("Unicode")).toBe("…");
  const u = DecorStyle.underline("Unicode", false);
  expect(u.style).toBe(ElementStyle.UnderlineSecondary);
  expect(String.fromCodePoint(u.label_start, u.multiline_bottom_right_with_text)).toBe("┬┤");
  const a = DecorStyle.underline("Ascii", true);
  expect(String.fromCodePoint(a.underline, a.top_left, a.multiline_whole_line)).toBe("^ /");
});

test("SourceMap::new, span_to_snippet, span_to_lines", () => {
  expect(debug_SourceMap(SourceMap.new(S(""), 1), PLAIN)).toBe(
    'SourceMap { lines: [LineInfo { line: "", line_index: 1, start_byte: 0, end_byte: 0, end_line_size: 0 }], source: "" }',
  );
  expect(debug_SourceMap(SourceMap.new(S("fn main() {\n    let x = 1;\n}\n"), 1), PLAIN)).toBe(
    'SourceMap { lines: [LineInfo { line: "fn main() {", line_index: 1, start_byte: 0, end_byte: 12, end_line_size: 1 }, LineInfo { line: "    let x = 1;", line_index: 2, start_byte: 12, end_byte: 27, end_line_size: 1 }, LineInfo { line: "}", line_index: 3, start_byte: 27, end_byte: 29, end_line_size: 1 }], source: "fn main() {\\n    let x = 1;\\n}\\n" }',
  );
  expect(debug_SourceMap(SourceMap.new(S("\u200dfn日\u200d  \n😀(fn\u0007\r\n\na"), 7), PLAIN)).toBe(
    'SourceMap { lines: [LineInfo { line: "\\u{200d}fn日\\u{200d}  ", line_index: 7, start_byte: 0, end_byte: 14, end_line_size: 1 }, LineInfo { line: "😀(fn\\u{7}", line_index: 8, start_byte: 14, end_byte: 24, end_line_size: 2 }, LineInfo { line: "", line_index: 9, start_byte: 24, end_byte: 25, end_line_size: 1 }, LineInfo { line: "a", line_index: 10, start_byte: 25, end_byte: 26, end_line_size: 0 }], source: "\\u{200d}fn日\\u{200d}  \\n😀(fn\\u{7}\\r\\n\\na" }',
  );
  const sm = SourceMap.new(S("a\r\nb\r\nc"), 1);
  const lines = (a: number, b: number) => debug_vec(sm.span_to_lines({ start: a, end: b }), PLAIN, debug_LineInfo);
  const snip = (a: number, b: number) => debug_option(sm.span_to_snippet({ start: a, end: b }), PLAIN, debug_Str);
  const A = 'LineInfo { line: "a", line_index: 1, start_byte: 0, end_byte: 3, end_line_size: 2 }';
  const B = 'LineInfo { line: "b", line_index: 2, start_byte: 3, end_byte: 6, end_line_size: 2 }';
  const C = 'LineInfo { line: "c", line_index: 3, start_byte: 6, end_byte: 7, end_line_size: 0 }';
  expect([snip(3, 3), lines(3, 3)]).toEqual(['Some("")', `[${B}]`]);
  expect([snip(2, 3), lines(2, 3)]).toEqual(['Some("\\n")', `[${A}, ${B}]`]);
  expect([snip(2, 7), lines(2, 7)]).toEqual(['Some("\\nb\\r\\nc")', `[${A}, ${B}, ${C}]`]);
  expect([snip(0, 3), lines(0, 3)]).toEqual(['Some("a\\r\\n")', `[${A}, ${B}]`]);
  expect(snip(3, 2)).toBe("None");
  expect(sm.get_line(2)?.toString()).toBe("b");
  expect(sm.get_line(4)).toBeUndefined();
  const c = CursorLines.new(S("x\n\r\ny"));
  expect([c.next(), c.next(), c.next(), c.next()].map((r) => (r ? `${r[0]}|${r[1]}` : "None"))).toEqual(["x|Lf", "|Crlf", "y|Eof", "None"]);
});

test("as_substr and Patch::trim_trivial_replacements", () => {
  const sub = (a: string, b: string) => {
    const r = as_substr(S(a), S(b));
    return r === undefined ? "None" : `Some((${r[0]}, ${debug_Str(r[1], PLAIN)}, ${r[2]}))`;
  };
  expect(sub("abc", "abcde")).toBe('Some((3, "de", 0))');
  expect(sub("abc", "xabc")).toBe('Some((0, "x", 3))');
  expect(sub("AACC", "AABBCC")).toBe('Some((2, "BB", 2))');
  expect(sub("abc", "abx")).toBe("None");
  expect(sub("", "x")).toBe('Some((0, "x", 0))');
  expect(sub("日本", "日x本")).toBe('Some((3, "x", 3))');
  expect(sub("é", "e")).toBe("None");
  expect(sub("aa", "a")).toBe("None");
  const trim = (src: string, a: number, b: number, rep: string) =>
    debug_TrimmedPatch(Patch.trim_trivial_replacements(Patch.new({ start: a, end: b }, S(rep)), S(src)), PLAIN);
  const src3 = "foo(\n  bar,\n  baz\n);\n// c\n{\n}\nend";
  expect(trim(src3, 11, 27, "\nQ  baz\n);\n// c\n{")).toBe('TrimmedPatch { original_span: 11..27, span: 12..12, replacement: "Q" }');
  expect(trim(src3, 8, 29, " ")).toBe('TrimmedPatch { original_span: 8..29, span: 8..29, replacement: " " }');
  expect(trim("a\r\nb\r\nc", 0, 7, "a\r\nb\r\ncy")).toBe('TrimmedPatch { original_span: 0..7, span: 7..7, replacement: "y" }');
  expect(trim("a\r\nb\r\nc", 0, 2, "\tz\n")).toBe('TrimmedPatch { original_span: 0..2, span: 0..2, replacement: "\\tz\\n" }');
  expect(trim("日", 1, 3, "x")).toBe('TrimmedPatch { original_span: 1..3, span: 1..3, replacement: "x" }'); // not a char boundary
  expect(trim("ab", 0, 0, "")).toBe('TrimmedPatch { original_span: 0..0, span: 0..0, replacement: "" }');
});

test("Margin", () => {
  const m = (v: number[]) => {
    const x = Margin.new(v[0]!, v[1]!, v[2]!, v[3]!, v[4]!, v[5]!);
    return `${debug_Margin(x, PLAIN)} ${x.was_cut_left()} ${x.left(v[6]!)} ${x.right(v[6]!)} ${x.left(0)} ${x.right(1000)}`;
  };
  expect(m([71, 186, 313, 289, 80, 449, 652])).toBe(
    "Margin { whitespace_left: 65, span_left: 180, span_right: 319, computed_left: 180, computed_right: 319, term_width: 80, label_right: 295 } true 180 319 0 319",
  );
  expect(m([0, 274, 392, 445, 80, 599, 127])).toBe(
    "Margin { whitespace_left: 0, span_left: 268, span_right: 398, computed_left: 268, computed_right: 398, term_width: 80, label_right: 451 } true 127 127 0 398",
  );
  expect(m([124, 5, 123, 485, 140, 327, 111])).toBe(
    "Margin { whitespace_left: 118, span_left: 0, span_right: 129, computed_left: 0, computed_right: 140, term_width: 140, label_right: 491 } false 0 111 0 140",
  );
  // `label_right - span_left` / `span_right - span_left` underflow and wrap (overflow checks off).
  expect(m([30, 200, 210, 5, 40, 500, 300])).toBe(
    "Margin { whitespace_left: 24, span_left: 194, span_right: 216, computed_left: 188, computed_right: 228, term_width: 40, label_right: 11 } true 188 228 0 228",
  );
  expect(m([30, 300, 100, 400, 40, 500, 300])).toBe(
    "Margin { whitespace_left: 24, span_left: 294, span_right: 106, computed_left: 294, computed_right: 106, term_width: 40, label_right: 406 } true 294 300 0 106",
  );
  expect(m([100, 120, 130, 150, 40, 400, 450])).toBe(
    "Margin { whitespace_left: 94, span_left: 114, span_right: 136, computed_left: 108, computed_right: 148, term_width: 40, label_right: 156 } true 108 148 0 148",
  );
});

test("StyledBuffer editing", () => {
  const dump = (b: StyledBuffer) => b.lines.map((l) => l.map((c) => String.fromCodePoint(c.ch) + (c.style.$ === "NoStyle" ? "" : `<${c.style.$}>`)).join(""));
  const b = StyledBuffer.new();
  b.puts(1, 2, "日x", ElementStyle.LineNumber);
  expect(dump(b)).toEqual(["", "  日<LineNumber>x<LineNumber>"]);
  b.prepend(1, "ab", ElementStyle.Quotation);
  expect(dump(b)).toEqual(["", "a<Quotation>b<Quotation>  日<LineNumber>x<LineNumber>"]);
  b.append(0, "😀", ElementStyle.Addition);
  b.set_style_range(1, 0, 4, ElementStyle.UnderlinePrimary, false);
  expect(dump(b)).toEqual(["😀<Addition>", "a<UnderlinePrimary>b<UnderlinePrimary> <UnderlinePrimary> <UnderlinePrimary>日<LineNumber>x<LineNumber>"]);
  b.set_style(1, 4, ElementStyle.Removal, true);
  b.replace(1, 0, 2, "Z");
  expect(dump(b)).toEqual(["😀<Addition>", "Z<LineNumber> <UnderlinePrimary> <UnderlinePrimary>日<Removal>x<LineNumber>"]);
  b.putc(3, 1, 0x5e, ElementStyle.NoStyle);
  expect(b.num_lines()).toBe(4);
  expect(dump(b).slice(2)).toEqual(["", " ^"]);
  b.replace(1, 9, 9, "q"); // start == end: no-op
  b.replace(1, 2, 9, "q"); // out of range: no-op
  expect(() => b.replace(9, 0, 1, "q")).toThrow(Panic);
  // the shared `StyledChar::SPACE` padding is never mutated in place
  b.set_style(3, 0, ElementStyle.LabelPrimary, true);
  expect(dump(b)[3]).toBe(" <LabelPrimary>^");
  expect(dump(b)[1]![1]).toBe("<");
});

test("std_ext helpers", () => {
  expect(str_trim(S("\u3000\u0085 x y\t\u2029")).toString()).toBe("x y");
  // U+FEFF is not White_Space. (Compared by length: `Str.toString` drops a leading U+FEFF,
  // see the std note in docs/handoff/annotate-a.md.)
  expect(str_trim(S("\ufeffx")).len()).toBe(4);
  expect(str_get(S("日"), 0, 1)).toBeUndefined();
  expect(str_get(S("ab"), 1, 3)).toBeUndefined();
  expect(str_split_byte(S("a\n"), 0x0a).map(String)).toEqual(["a", ""]);
  expect(normalize_untrusted_str).toBeFunction();
});
