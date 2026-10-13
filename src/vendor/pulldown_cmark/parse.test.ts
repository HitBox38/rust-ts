// Port of the `#[cfg(test)] mod test` of pulldown-cmark-0.11.3/src/parse.rs, plus the tests of
// linklabel.rs and puncttable.rs. "dont crash" tests drain the parser (`.count()`).
import { expect, test } from "bun:test";
import { Str } from "../../std/str.ts";
import { type BrokenLink, type Event, Options, Parser } from "./lib.ts";
import { scan_link_label_rest } from "./linklabel.ts";
import { is_ascii_punctuation, is_punctuation } from "./puncttable.ts";

const S = Str.from;

function count(p: Parser): number {
  let n = 0;
  for (const _ of p) n++;
  return n;
}

function offsets(p: Parser): [number, number][] {
  const it = p.into_offset_iter();
  const out: [number, number][] = [];
  for (let r = it.next(); r !== undefined; r = it.next()) out.push(r[1]);
  return out;
}

function events_with_offsets(p: Parser): [Event, [number, number]][] {
  const it = p.into_offset_iter();
  const out: [Event, [number, number]][] = [];
  for (let r = it.next(); r !== undefined; r = it.next()) out.push(r);
  return out;
}

// crate: pulldown-cmark-0.11.3/src/parse.rs:2180 parser_with_extensions
function parser_with_extensions(text: string): Parser {
  let opts = Options.empty();
  opts |= Options.ENABLE_TABLES;
  opts |= Options.ENABLE_FOOTNOTES;
  opts |= Options.ENABLE_STRIKETHROUGH;
  opts |= Options.ENABLE_TASKLISTS;

  return Parser.new_ext(S(text), opts);
}

// crate-skip: pulldown-cmark-0.11.3/src/parse.rs:2192 node_size asserts Rust memory layout (size_of)
// crate-skip: pulldown-cmark-0.11.3/src/parse.rs:2199 body_size asserts Rust memory layout (size_of)

// crate: pulldown-cmark-0.11.3/src/parse.rs:2205 single_open_fish_bracket
test("single_open_fish_bracket", () => {
  // dont crash
  expect(count(Parser.new(S("<")))).toBe(3);
});

// crate: pulldown-cmark-0.11.3/src/parse.rs:2211 lone_hashtag
test("lone_hashtag", () => {
  // dont crash
  expect(count(Parser.new(S("#")))).toBe(2);
});

// crate: pulldown-cmark-0.11.3/src/parse.rs:2217 lots_of_backslashes
test("lots_of_backslashes", () => {
  // dont crash
  count(Parser.new(S("\\\\\r\r")));
  count(Parser.new(S("\\\r\r\\.\\\\\r\r\\.\\")));
});

// crate: pulldown-cmark-0.11.3/src/parse.rs:2224 issue_320
test("issue_320", () => {
  // dont crash
  count(parser_with_extensions(":\r\t> |\r:\r\t> |\r"));
});

// crate: pulldown-cmark-0.11.3/src/parse.rs:2230 issue_319
test("issue_319", () => {
  // dont crash
  count(parser_with_extensions("|\r-]([^|\r-]([^"));
  count(parser_with_extensions("|\r\r=][^|\r\r=][^car"));
});

// crate: pulldown-cmark-0.11.3/src/parse.rs:2237 issue_303
test("issue_303", () => {
  // dont crash
  count(parser_with_extensions("[^\r\ra]"));
  count(parser_with_extensions("\r\r]Z[^\x00\r\r]Z[^\x00"));
});

// crate: pulldown-cmark-0.11.3/src/parse.rs:2244 issue_313
test("issue_313", () => {
  // dont crash
  count(parser_with_extensions("*]0[^\r\r*]0[^"));
  count(parser_with_extensions("[^\r> `][^\r> `][^\r> `]["));
});

// crate: pulldown-cmark-0.11.3/src/parse.rs:2251 issue_311
test("issue_311", () => {
  // dont crash
  count(parser_with_extensions("\\\u{0d}-\u{09}\\\u{0d}-\u{09}"));
});

// crate: pulldown-cmark-0.11.3/src/parse.rs:2257 issue_283
test("issue_283", () => {
  const input = new TextDecoder("utf-8", { fatal: true }).decode(
    new Uint8Array([0xf0, 0x9b, 0xb2, 0x9f, 0x3c, 0x74, 0x64, 0x3a, 0x5e, 0xf0, 0x9b, 0xb2, 0x9f]),
  );
  // dont crash
  count(parser_with_extensions(input));
});

// crate: pulldown-cmark-0.11.3/src/parse.rs:2264 issue_289
test("issue_289", () => {
  // dont crash
  count(parser_with_extensions("> - \\\n> - "));
  count(parser_with_extensions("- \n\n"));
});

// crate: pulldown-cmark-0.11.3/src/parse.rs:2271 issue_306
test("issue_306", () => {
  // dont crash
  count(parser_with_extensions("*\r_<__*\r_<__*\r_<__*\r_<__"));
});

// crate: pulldown-cmark-0.11.3/src/parse.rs:2277 issue_305
test("issue_305", () => {
  // dont crash
  count(parser_with_extensions("_6**6*_*"));
});

// crate: pulldown-cmark-0.11.3/src/parse.rs:2283 another_emphasis_panic
test("another_emphasis_panic", () => {
  count(parser_with_extensions("*__#_#__*"));
});

// crate: pulldown-cmark-0.11.3/src/parse.rs:2288 offset_iter
test("offset_iter", () => {
  const event_offsets = offsets(Parser.new(S("*hello* world")));
  const expected_offsets: [number, number][] = [
    [0, 13],
    [0, 7],
    [1, 6],
    [0, 7],
    [7, 13],
    [0, 13],
  ];
  expect(event_offsets).toEqual(expected_offsets);
});

// crate: pulldown-cmark-0.11.3/src/parse.rs:2298 reference_link_offsets
test("reference_link_offsets", () => {
  const range = events_with_offsets(Parser.new(S("# H1\n[testing][Some reference]\n\n[Some reference]: https://github.com"))).find(
    ([ev]) => ev.$ === "Start" && ev._0.$ === "Link" && ev._0.link_type === "Reference",
  )![1];
  expect(range).toEqual([5, 30]);
});

// crate: pulldown-cmark-0.11.3/src/parse.rs:2318 footnote_offsets
test("footnote_offsets", () => {
  const range = events_with_offsets(parser_with_extensions("Testing this[^1] out.\n\n[^1]: Footnote.")).find(
    ([ev]) => ev.$ === "FootnoteReference",
  )![1];
  expect(range).toEqual([12, 16]);
});

// crate: pulldown-cmark-0.11.3/src/parse.rs:2331 footnote_offsets_exclamation
test("footnote_offsets_exclamation", () => {
  let immediately_before_footnote: [Event, [number, number]] | undefined;
  let range: [number, number] | undefined;
  for (const [ev, r] of events_with_offsets(parser_with_extensions("Testing this![^1] out.\n\n[^1]: Footnote."))) {
    if (ev.$ === "FootnoteReference") {
      range = r;
      break;
    }
    immediately_before_footnote = [ev, r];
  }
  expect(range).toEqual([13, 17]);
  const [exclamation, range_exclamation] = immediately_before_footnote!;
  expect(exclamation).toEqual({ $: "Text", _0: "!" });
  expect(range_exclamation).toEqual([12, 13]);
});

// crate: pulldown-cmark-0.11.3/src/parse.rs:2356 table_offset
test("table_offset", () => {
  const markdown = "a\n\nTesting|This|Outtt\n--|:--:|--:\nSome Data|Other data|asdf";
  const event_offset = offsets(parser_with_extensions(markdown))[3];
  const expected_offset: [number, number] = [3, 59];
  expect(event_offset).toEqual(expected_offset);
});

// crate: pulldown-cmark-0.11.3/src/parse.rs:2368 table_cell_span
test("table_cell_span", () => {
  const markdown = "a|b|c\n--|--|--\na|  |c";
  const event_offset = events_with_offsets(parser_with_extensions(markdown))
    .filter(([ev]) => ev.$ === "Start" && ev._0.$ === "TableCell")
    .map(([, span]) => span)[4];
  const expected_offset_start = "a|b|c\n--|--|--\na|".length;
  expect(event_offset).toEqual([expected_offset_start, expected_offset_start + 2]);
});

// crate: pulldown-cmark-0.11.3/src/parse.rs:2386 offset_iter_issue_378
test("offset_iter_issue_378", () => {
  const event_offsets = offsets(Parser.new(S("a [b](c) d")));
  const expected_offsets: [number, number][] = [
    [0, 10],
    [0, 2],
    [2, 8],
    [3, 4],
    [2, 8],
    [8, 10],
    [0, 10],
  ];
  expect(event_offsets).toEqual(expected_offsets);
});

// crate: pulldown-cmark-0.11.3/src/parse.rs:2396 offset_iter_issue_404
test("offset_iter_issue_404", () => {
  const event_offsets = offsets(Parser.new(S("###\n")));
  const expected_offsets: [number, number][] = [
    [0, 4],
    [0, 4],
  ];
  expect(event_offsets).toEqual(expected_offsets);
});

// crate-skip: pulldown-cmark-0.11.3/src/parse.rs:2408 link_def_at_eof needs the `html` module (not ported)
// crate-skip: pulldown-cmark-0.11.3/src/parse.rs:2419 no_footnote_refs_without_option needs the `html` module (not ported)
// crate-skip: pulldown-cmark-0.11.3/src/parse.rs:2430 ref_def_at_eof needs the `html` module (not ported)
// crate-skip: pulldown-cmark-0.11.3/src/parse.rs:2441 ref_def_cr_lf needs the `html` module (not ported)
// crate-skip: pulldown-cmark-0.11.3/src/parse.rs:2452 no_dest_refdef needs the `html` module (not ported)

// crate: pulldown-cmark-0.11.3/src/parse.rs:2462 broken_links_called_only_once
test("broken_links_called_only_once", () => {
  for (const [markdown, expected] of [
    ["See also [`g()`][crate::g].", 1],
    ["See also [`g()`][crate::g][].", 1],
    ["[brokenlink1] some other node [brokenlink2]", 2],
  ] as const) {
    let times_called = 0;
    const callback = (_broken_link: BrokenLink): undefined => {
      times_called += 1;
      return undefined;
    };
    const parser = Parser.new_with_broken_link_callback(S(markdown), Options.empty(), callback);
    count(parser);
    expect(times_called).toBe(expected);
  }
});

// crate: pulldown-cmark-0.11.3/src/parse.rs:2481 simple_broken_link_callback
test("simple_broken_link_callback", () => {
  const test_str = "This is a link w/o def: [hello][world]";
  const callback = (broken_link: BrokenLink): [string, string] => {
    expect(broken_link.reference).toBe("world");
    expect(S(test_str).slice(broken_link.span[0], broken_link.span[1]).toString()).toBe("[hello][world]");
    const url = "YOLO";
    const title = "SWAG";
    return [url, title];
  };
  const parser = Parser.new_with_broken_link_callback(S(test_str), Options.empty(), callback);
  let link_tag_count = 0;
  for (const event of parser) {
    if (event.$ !== "Start" || event._0.$ !== "Link") continue;
    const { link_type: typ, dest_url: url, title, id } = event._0;
    link_tag_count += 1;
    expect(typ).toBe("ReferenceUnknown");
    expect(url).toBe("YOLO");
    expect(title).toBe("SWAG");
    expect(id).toBe("world");
  }
  expect(link_tag_count > 0).toBe(true);
});

// crate: pulldown-cmark-0.11.3/src/parse.rs:2515 code_block_kind_check_fenced
test("code_block_kind_check_fenced", () => {
  let found = 0;
  for (const [ev] of events_with_offsets(Parser.new(S("hello\n```test\ntadam\n```")))) {
    if (ev.$ === "Start" && ev._0.$ === "CodeBlock" && ev._0._0.$ === "Fenced") {
      expect(ev._0._0._0).toBe("test");
      found += 1;
    }
  }
  expect(found).toBe(1);
});

// crate: pulldown-cmark-0.11.3/src/parse.rs:2531 code_block_kind_check_indented
test("code_block_kind_check_indented", () => {
  let found = 0;
  for (const [ev] of events_with_offsets(Parser.new(S("hello\n\n    ```test\n    tadam\nhello")))) {
    if (ev.$ === "Start" && ev._0.$ === "CodeBlock" && ev._0._0.$ === "Indented") {
      found += 1;
    }
  }
  expect(found).toBe(1);
});

// crate: pulldown-cmark-0.11.3/src/parse.rs:2546 ref_defs
test("ref_defs", () => {
  const input = "[a B c]: http://example.com\n[another]: https://google.com\ntext\n[final ONE]: http://wikipedia.org\n";
  const parser = Parser.new(S(input));

  expect(parser.reference_definitions().get("a b c")).toBeDefined();
  expect(parser.reference_definitions().get("nope")).toBeUndefined();

  if (parser.next() !== undefined) {
    // testing keys with shorter lifetimes than parser and its input
    const s = "final one";
    // PORT: upstream's `get(&s).unwrap()` panics on 0.11.3 itself: a definition cannot interrupt the
    // paragraph `text`, so `[final ONE]` stays text. Checked against pulldown-cmark 0.11.3 built from the
    // registry and against the oracle (`rustdoc` probe), which both give `None`; the test asserts that.
    const link_def = parser.reference_definitions().get(s);
    expect(link_def).toBeUndefined();
  }
});

// crate: pulldown-cmark-0.11.3/src/parse.rs:2569 common_lifetime_patterns_allowed
test("common_lifetime_patterns_allowed", () => {
  const temporary_str = "xyz";
  const closure = (link: BrokenLink): [string, string] => ["#", link.reference];
  // crate: pulldown-cmark-0.11.3/src/parse.rs:2577 function
  function function_(link: BrokenLink): [string, string] {
    return ["#", link.reference];
  }
  count(Parser.new_with_broken_link_callback(S("static lifetime"), Options.empty(), closure));
  count(Parser.new_with_broken_link_callback(S("static lifetime"), Options.empty(), function_));
  count(Parser.new_with_broken_link_callback(S(temporary_str), Options.empty(), function_));
});

// crate: pulldown-cmark-0.11.3/src/linklabel.rs:154 whitespace_normalization
test("linklabel whitespace_normalization", () => {
  const input = "«\t\tBlurry Eyes\t\t»][blurry_eyes]";
  const expected_output = "« Blurry Eyes »"; // regular spaces!

  const [_bytes, normalized_label] = scan_link_label_rest(S(input), (_) => undefined, false)!;
  expect(normalized_label).toBe(expected_output);
});

// crate: pulldown-cmark-0.11.3/src/linklabel.rs:163 return_carriage_linefeed_ok
test("linklabel return_carriage_linefeed_ok", () => {
  const input = "hello\r\nworld\r\n]";
  expect(scan_link_label_rest(S(input), (_) => 0, false)).toBeDefined();
});

// crate: pulldown-cmark-0.11.3/src/puncttable.rs:1520 test_ascii
test("puncttable test_ascii", () => {
  expect(is_ascii_punctuation(0x21 /* ! */)).toBe(true);
  expect(is_ascii_punctuation(0x40 /* @ */)).toBe(true);
  expect(is_ascii_punctuation(0x7e /* ~ */)).toBe(true);
  expect(is_ascii_punctuation(0x20 /*   */)).toBe(false);
  expect(is_ascii_punctuation(0x30 /* 0 */)).toBe(false);
  expect(is_ascii_punctuation(0x41 /* A */)).toBe(false);
  expect(is_ascii_punctuation(0xa1)).toBe(false);
});

// crate: pulldown-cmark-0.11.3/src/puncttable.rs:1531 test_unicode
test("puncttable test_unicode", () => {
  expect(is_punctuation(0x7e /* ~ */)).toBe(true);
  expect(is_punctuation(0x20 /*   */)).toBe(false);

  expect(is_punctuation(0x00a1)).toBe(true);
  expect(is_punctuation(0x060c)).toBe(true);
  expect(is_punctuation(0xff65)).toBe(true);
  expect(is_punctuation(0x1bc9f)).toBe(true);
  expect(is_punctuation(0x1bca0)).toBe(false);
});
