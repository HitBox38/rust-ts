// Oracle-derived tests for attr/mod.ts (lane ast-attr; upstream attr/mod.rs has no `#[cfg(test)]` tests).
//
// Oracle: the pinned nightly (`rustc 1.101.0-nightly (6f5da406b 2026-10-10)`).
// - testdata/attrs.rs is a small crate whose attributes cover the paths under test;
//   testdata/attrs.ast-tree.txt is `rustc +nightly-2026-10-11 -Zunpretty=ast-tree attrs.rs`, verbatim.
//   Each parsed attribute's token stream is read from that dump; the attribute is then rebuilt with
//   the port (`MetaItem::from_tokens` for its path and span, `mk_attr_from_item` / `mk_doc_comment`
//   for the attribute and its `AttrId`) and must print exactly as the oracle's.
// - The `mk_attr_*` excerpts below are attributes that rustc's test harness builds with those fns:
//   `rustc +nightly-2026-10-11 --test -Zunpretty=ast-tree,expanded t.rs` with t.rs =
//   `#![no_std]\n#![feature(prelude_import)]\n#[test]\nfn t() {}\n` (builtin_macros test.rs:270
//   `attr_name_value_str(sym::rustc_test_marker, ..)`, test_harness `#[rustc_main]` (`attr_word`) and
//   `#[coverage(off)]` (`attr_nested_word`)). Expansion contexts (`#4`), `NodeId`s and `AttrId`s
//   are assigned by passes after these fns, so they are normalized on both sides.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import "../lib.ts";
import { DEFAULT_EDITION } from "../../rustc_span/edition.ts";
import {
  BytePos,
  create_session_globals_then,
  debug_Span,
  DUMMY_SP,
  Span,
  with_session_globals,
} from "../../rustc_span/lib.ts";
import { FilePathMapping, RealFileLoader } from "../../rustc_span/source_map.ts";
import { Symbol, sym } from "../../rustc_span/symbol.ts";
import { PLAIN, PRETTY } from "../../std/fmt.ts";
import { Panic } from "../../std/panic.ts";
import { Str } from "../../std/str.ts";
import {
  type AttrArgs,
  AttrItem,
  Attribute,
  type AttrStyle,
  debug_Attribute,
  debug_MetaItemLit,
  DelimArgs,
  debug_Path,
  Expr,
  MetaItemInner,
  MetaItemKind,
  Safety,
} from "../ast.ts";
import { DUMMY_NODE_ID } from "../node_id.ts";
import { type CommentKind, Delimiter, Token, TokenKind, LitKind as TokenLitKind } from "../token.ts";
import {
  AttrTokenStream,
  type AttrTokenTree,
  DelimSpacing,
  DelimSpan,
  LazyAttrTokenStream,
  Spacing,
  TokenStream,
  type TokenTree,
} from "../tokenstream.ts";
import {
  AttributeExt,
  AttrIdGenerator,
  contains_name,
  filter_by_name,
  find_by_name,
  first_attr_value_str_by_name,
  list_contains_name,
  MarkedAttrs,
  MetaItem,
  mk_attr_from_item,
  mk_attr_name_value_str,
  mk_attr_nested_word,
  mk_attr_word,
  mk_doc_comment,
} from "./mod.ts";

const TESTDATA = join(import.meta.dir, "testdata");

/** Runs `f` in fresh session globals whose source map holds `src` as file `name`. */
function with_file<R>(name: string, src: string, f: (sp: (text: string) => Span) => R): R {
  const sm_inputs = {
    file_loader: new RealFileLoader(),
    path_mapping: FilePathMapping.empty(),
    hash_kind: "Md5" as const,
    checksum_hash_kind: undefined,
  };
  return create_session_globals_then(DEFAULT_EDITION, [], sm_inputs, () => {
    const sm = with_session_globals((g) => g.source_map!);
    const file = sm.new_source_file(
      { $: "Real", _0: sm.path_mapping().to_real_filename(sm.working_dir(), name) },
      Str.from(src),
    );
    const start = BytePos.to_u32(file.start_pos);
    const line_starts = [0];
    for (let i = 0; i < src.length; i++) if (src[i] === "\n") line_starts.push(i + 1);
    // `<name>:L1:C1: L2:C2 (#0)` (Span Debug with a source map; ASCII source) or `no-location (#0)`.
    const sp = (text: string): Span => {
      if (text === "no-location (#0)") return DUMMY_SP;
      const m = /^[\w.]+:(\d+):(\d+): (\d+):(\d+) \(#0\)$/.exec(text);
      if (m === null) throw new Error(`bad span: ${text}`);
      const pos = (l: string, c: string): BytePos =>
        BytePos.from_u32(start + line_starts[Number(l) - 1]! + Number(c) - 1);
      return Span.with_root_ctxt(pos(m[1]!, m[2]!), pos(m[3]!, m[4]!));
    };
    return f(sp);
  });
}

/** The oracle's `Attribute { .. }` blocks, in order, dedented (without the trailing `,`). */
function attribute_blocks(dump: string): string[] {
  const lines = dump.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)Attribute \{$/.exec(lines[i]!);
    if (m === null) continue;
    const ind = m[1]!;
    let j = i;
    while (lines[j] !== `${ind}},`) j++;
    out.push(
      lines
        .slice(i, j + 1)
        .map((l) => l.slice(ind.length))
        .join("\n")
        .replace(/,$/, ""),
    );
    i = j;
  }
  return out;
}

/** Parses the one-line Debug of an `AttrTokenStream` (`AttrTokenStream([..])`) back into trees. */
function parse_attr_token_stream(text: string, sp: (text: string) => Span): AttrTokenTree[] {
  let i = 0;
  const eat = (lit: string): void => {
    if (!text.startsWith(lit, i)) throw new Error(`expected ${lit} at ${text.slice(i, i + 40)}`);
    i += lit.length;
  };
  const word = (): string => {
    const m = /^\w+/.exec(text.slice(i));
    if (m === null) throw new Error(`expected a word at ${text.slice(i, i + 40)}`);
    i += m[0].length;
    return m[0];
  };
  const string = (): string => {
    eat('"');
    let s = "";
    while (text[i] !== '"') {
      if (text[i] === "\\") i++;
      s += text[i++];
    }
    eat('"');
    return s;
  };
  const span = (): Span => {
    const m = /^(no-location|[\w.]+:\d+:\d+: \d+:\d+) \(#0\)/.exec(text.slice(i));
    if (m === null) throw new Error(`expected a span at ${text.slice(i, i + 40)}`);
    i += m[0].length;
    return sp(m[0]);
  };
  const spacing = (): Spacing => word() as Spacing;
  const kind = (): TokenKind => {
    const name = word();
    if (name === "Ident") {
      eat("(");
      const s = string();
      eat(", Normal)");
      return { $: "Ident", _0: Symbol.intern(s), _1: "Normal" };
    }
    if (name === "Literal") {
      eat("(Lit { kind: ");
      const k = word() as "Str" | "Integer";
      eat(", symbol: ");
      const symbol = Symbol.intern(string());
      eat(", suffix: ");
      let suffix: Symbol | undefined;
      if (text.startsWith("None", i)) {
        eat("None");
      } else {
        eat("Some(");
        suffix = Symbol.intern(string());
        eat(")");
      }
      eat(" })");
      return TokenKind.lit(TokenLitKind[k], symbol, suffix);
    }
    return (TokenKind as unknown as Record<string, TokenKind>)[name]!;
  };
  const tree = (): AttrTokenTree => {
    if (text.startsWith("Token(", i)) {
      eat("Token(Token { kind: ");
      const k = kind();
      eat(", span: ");
      const s = span();
      eat(" }, ");
      const t: AttrTokenTree = { $: "Token", _0: Token.new(k, s), _1: spacing() };
      eat(")");
      return t;
    }
    eat("Delimited(DelimSpan { open: ");
    const open = span();
    eat(", close: ");
    const close = span();
    eat(" }, DelimSpacing { open: ");
    const so = spacing();
    eat(", close: ");
    const sc = spacing();
    eat(" }, ");
    const delim = (Delimiter as unknown as Record<string, Delimiter>)[word()]!;
    eat(", ");
    const inner = stream();
    eat(")");
    return { $: "Delimited", _0: DelimSpan.from_pair(open, close), _1: DelimSpacing.new(so, sc), _2: delim, _3: inner };
  };
  const stream = (): AttrTokenStream => {
    eat("AttrTokenStream([");
    const tts: AttrTokenTree[] = [];
    while (!text.startsWith("])", i)) {
      tts.push(tree());
      if (text.startsWith(", ", i)) eat(", ");
    }
    eat("])");
    return AttrTokenStream.new(tts);
  };
  const s = stream();
  if (i !== text.length) throw new Error(`trailing text: ${text.slice(i)}`);
  return s._0;
}

const ATTRS_RS = readFileSync(join(TESTDATA, "attrs.rs"), "utf8");
const ATTRS_TREE = readFileSync(join(TESTDATA, "attrs.ast-tree.txt"), "utf8");

/**
 * Rebuilds the oracle's attributes of testdata/attrs.rs with the port. Normal attributes: the
 * token stream is the oracle's; the `AttrItem`'s path and span come from `MetaItem::from_tokens`
 * over the bracket's contents; its args are the trees after the path (`DelimArgs` of the list, or
 * `Eq` with the literal's `Expr`).
 */
function rebuild(sp: (text: string) => Span, blocks: string[]): Attribute[] {
  const g = AttrIdGenerator.new();
  return blocks.map((block) => {
    const doc = /kind: DocComment\(\n\s*(\w+),\n\s*"(.*)",\n\s*\),\n\s*id: AttrId\(\d+\),\n\s*style: (\w+),\n\s*span: (.*),/.exec(block);
    if (doc !== null) {
      return mk_doc_comment(g, doc[1] as CommentKind, doc[3] as AttrStyle, Symbol.intern(doc[2]!), sp(doc[4]!));
    }
    const line = block.split("\n").find((l) => l.trim().startsWith("LazyAttrTokenStream(AttrTokenStream([Token(Token { kind: Pound"))!;
    const trees = parse_attr_token_stream(line.trim().replace(/^LazyAttrTokenStream\(/, "").replace(/\),$/, ""), sp);
    const style: AttrStyle = trees.length === 3 ? "Inner" : "Outer";
    const bracket = trees[trees.length - 1]!;
    if (bracket.$ !== "Delimited") throw new Error("expected the bracket");
    const contents = bracket._3._0;
    const meta = MetaItem.from_tokens(TokenStream.new(bracket._3.to_token_trees()).iter())!;
    const last = contents[contents.length - 1]!;
    const eq = contents.findIndex((t) => t.$ === "Token" && t._0.kind.$ === "Eq");
    let args: AttrArgs;
    if (eq >= 0) {
      const eq_tok = contents[eq]!;
      if (eq_tok.$ !== "Token" || last.$ !== "Token" || last._0.kind.$ !== "Literal") throw new Error("expected `= lit`");
      const lit_tokens = LazyAttrTokenStream.new_direct(AttrTokenStream.new([last]));
      const expr = new Expr(DUMMY_NODE_ID, { $: "Lit", _0: last._0.kind._0 }, last._0.span, [], lit_tokens);
      args = { $: "Eq", eq_span: eq_tok._0.span, expr };
    } else {
      if (last.$ !== "Delimited") throw new Error("expected a list");
      args = { $: "Delimited", _0: new DelimArgs(last._0, last._2, TokenStream.new(last._3.to_token_trees())) };
    }
    const item = new AttrItem(Safety.Default, meta.path, args, meta.span);
    const tokens = LazyAttrTokenStream.new_direct(AttrTokenStream.new(trees));
    const first = trees[0]!;
    if (first.$ !== "Token") throw new Error("expected `#`");
    return mk_attr_from_item(g, item, tokens, style, Span.to(first._0.span, bracket._0.close));
  });
}

const run_attrs = <R>(f: (attrs: Attribute[], sp: (text: string) => Span) => R): R =>
  with_file("attrs.rs", ATTRS_RS, (sp) => f(rebuild(sp, attribute_blocks(ATTRS_TREE)), sp));

const ds = (s: Span | undefined): string => (s === undefined ? "None" : debug_Span(s, PLAIN));
const name = (s: Symbol | undefined): string | undefined => (s === undefined ? undefined : Symbol.as_str(s));

test("rebuilt attributes print exactly as the oracle's parsed ones (MetaItem::from_tokens path/span, mk_attr_from_item, mk_doc_comment, AttrIdGenerator)", () =>
  run_attrs((attrs) => {
    const blocks = attribute_blocks(ATTRS_TREE);
    expect(attrs.length).toBe(9);
    for (let k = 0; k < attrs.length; k++) {
      expect(debug_Attribute(attrs[k]!, PRETTY)).toBe(blocks[k]!);
    }
  }));

test("MetaItem::from_tokens: nested meta items (spans from the oracle's tokens, attrs.rs:2,5,9)", () =>
  run_attrs((attrs) => {
    // `#[doc(alias = "foo", hidden)]`: tokens `alias` 2:7-2:12, `"foo"` 2:15-2:20, `hidden` 2:22-2:28.
    const doc = attrs[1]!.meta()!;
    expect(ds(doc.span)).toBe("attrs.rs:2:1: 2:30 (#0)"); // `Attribute::meta` takes the attribute's span
    const list = doc.meta_item_list()!;
    expect(list.length).toBe(2);
    const alias = MetaItemInner.meta_item(list[0]!)!;
    // NameValue: `path.span.with_hi(lit.span.hi())` (mod.rs:533).
    expect(ds(alias.span)).toBe("attrs.rs:2:7: 2:20 (#0)");
    expect(ds(alias.path.span)).toBe("attrs.rs:2:7: 2:12 (#0)");
    expect(name(alias.name())).toBe("alias");
    expect(alias.is_word()).toBe(false);
    expect(debug_MetaItemLit(alias.name_value_literal()!, PLAIN)).toBe(
      'MetaItemLit { symbol: "foo", suffix: None, kind: Str("foo", Cooked), span: attrs.rs:2:15: 2:20 (#0) }',
    );
    expect(ds(alias.name_value_literal_span())).toBe("attrs.rs:2:15: 2:20 (#0)");
    expect(ds(MetaItemInner.name_value_literal_span(list[0]!))).toBe("attrs.rs:2:15: 2:20 (#0)");
    expect(name(alias.value_str())).toBe("foo");
    expect(name(MetaItemInner.value_str(list[0]!))).toBe("foo");
    expect(name(alias.name_value_literal()!.value_as_str())).toBe("foo");
    // Word: `path.span.hi()` (mod.rs:535).
    const hidden = list[1]!;
    expect(ds(MetaItemInner.span(hidden))).toBe("attrs.rs:2:22: 2:28 (#0)");
    expect(MetaItemInner.is_word(hidden)).toBe(true);
    expect(MetaItemInner.has_name(hidden, sym.hidden)).toBe(true);
    expect(MetaItemInner.value_str(hidden)).toBeUndefined();
    expect(list_contains_name(list, sym.hidden)).toBe(true);
    expect(list_contains_name(list, sym.doc)).toBe(false);

    // `#[x(1, true, ::p::q(r), s = 2u8)]`: `1` 5:5-5:6, `true` 5:8-5:12, `::` 5:14-5:16, `q` 5:19-5:20,
    // `(` .. `)` 5:20-5:21 .. 5:22-5:23, `s` 5:25-5:26, `2u8` 5:29-5:32.
    const x = attrs[4]!.meta_item_list()!;
    expect(x.map((i) => i.$)).toEqual(["Lit", "Lit", "MetaItem", "MetaItem"]);
    expect(debug_MetaItemLit(MetaItemInner.lit(x[0]!)!, PLAIN)).toBe(
      'MetaItemLit { symbol: "1", suffix: None, kind: Int(Pu128(1), Unsuffixed), span: attrs.rs:5:5: 5:6 (#0) }',
    );
    expect(MetaItemInner.boolean_literal(x[0]!)).toBeUndefined();
    expect(MetaItemInner.boolean_literal(x[1]!)).toBe(true);
    expect(MetaItemInner.meta_item_or_bool(x[0]!)).toBeUndefined();
    expect(MetaItemInner.meta_item_or_bool(x[1]!)).toBe(x[1]);
    expect(MetaItemInner.meta_item_or_bool(x[2]!)).toBe(x[2]);
    expect(MetaItemInner.is_meta_item(x[1]!)).toBe(false);
    expect(MetaItemInner.name(x[1]!)).toBeUndefined();
    // A global path: `{{root}}` segment at the `::` span, path span to `q`'s hi; List: span to `)`'s hi.
    const pq = MetaItemInner.meta_item(x[2]!)!;
    expect(debug_Path(pq.path, PLAIN)).toBe(
      "Path { span: attrs.rs:5:14: 5:20 (#0), segments: [PathSegment { ident: {{root}}#0, id: NodeId(4294967040), args: None }, PathSegment { ident: p#0, id: NodeId(4294967040), args: None }, PathSegment { ident: q#0, id: NodeId(4294967040), args: None }] }",
    );
    expect(ds(pq.span)).toBe("attrs.rs:5:14: 5:23 (#0)");
    expect(pq.ident()).toBeUndefined();
    expect(MetaItemInner.ident(x[2]!)).toBeUndefined();
    expect(MetaItemInner.meta_item_list(x[2]!)!.map((i) => name(MetaItemInner.name(i)))).toEqual(["r"]);
    expect(MetaItemInner.singleton_lit_list(x[2]!)).toBeUndefined(); // `r` is not a literal
    const s = MetaItemInner.meta_item(x[3]!)!;
    expect(debug_MetaItemLit(s.name_value_literal()!, PLAIN)).toBe(
      'MetaItemLit { symbol: "2", suffix: Some("u8"), kind: Int(Pu128(2), Unsigned(u8)), span: attrs.rs:5:29: 5:32 (#0) }',
    );
    expect(s.value_str()).toBeUndefined(); // not a string literal
    expect(ds(s.span)).toBe("attrs.rs:5:25: 5:32 (#0)");

    // `#[w(y("z"))]`: a singleton literal list (`"z"` token: 9:7-9:10).
    const w = attrs[8]!.meta_item_list()!;
    const [yname, ylit] = MetaItemInner.singleton_lit_list(w[0]!)!;
    expect(name(yname)).toBe("y");
    expect(debug_MetaItemLit(ylit, PLAIN)).toBe(
      'MetaItemLit { symbol: "z", suffix: None, kind: Str("z", Cooked), span: attrs.rs:9:7: 9:10 (#0) }',
    );
  }));

test("MetaItem::from_tokens: rejected inputs", () =>
  run_attrs((_attrs, sp) => {
    const t = (kind: TokenKind): TokenTree => ({ $: "Token", _0: Token.new(kind, sp("attrs.rs:1:1: 1:2 (#0)")), _1: "Alone" });
    const ident = (s: string): TokenKind => ({ $: "Ident", _0: Symbol.intern(s), _1: "Normal" });
    const from = (tts: TokenTree[]) => MetaItem.from_tokens(TokenStream.new(tts).iter());
    expect(from([])).toBeUndefined();
    expect(from([t(TokenKind.Eq)])).toBeUndefined(); // not a path start
    expect(from([t(ident("a")), t(TokenKind.PathSep)])).toBeUndefined(); // `a::` then nothing
    expect(from([t(ident("a")), t(TokenKind.PathSep), t(TokenKind.Comma)])).toBeUndefined();
    expect(from([t(ident("a")), t(TokenKind.Eq)])).toBeUndefined(); // `a =` without a literal
    expect(from([t(ident("a")), t(TokenKind.Eq), t(ident("b"))])).toBeUndefined(); // not a literal
    // `MetaItemKind::list_from_tokens`: items must be comma separated.
    expect(MetaItemKind.list_from_tokens(TokenStream.new([t(ident("a")), t(ident("b"))]))).toBeUndefined();
    expect(MetaItemKind.list_from_tokens(TokenStream.new([t(ident("a")), t(TokenKind.Comma)]))!.length).toBe(1);
    expect(MetaItemKind.list_from_tokens(TokenStream.new([]))).toEqual([]);
    // A delimiter token where a path should start is a bug (mod.rs:525).
    expect(() => from([t({ $: "OpenParen" } as unknown as TokenKind)])).toThrow(
      "Should be `AttrTokenTree::Delimited`, not delim tokens: Some(Token(Token { kind: OpenParen, span: attrs.rs:1:1: 1:2 (#0) }, Alone))",
    );
  }));

test("Attribute / AttributeExt queries on the oracle's attributes", () =>
  run_attrs((attrs) => {
    const [allow, doc_alias, ab, deprecated, x, line_doc, block_doc, raw_doc, w] = attrs as [
      Attribute, Attribute, Attribute, Attribute, Attribute, Attribute, Attribute, Attribute, Attribute,
    ];
    expect(allow.style_()).toBe("Inner");
    expect(doc_alias.style_()).toBe("Outer");
    expect(attrs.map((a) => a.id_() as number)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(attrs.map((a) => name(a.name()))).toEqual(["allow", "doc", undefined, "deprecated", "x", undefined, undefined, "doc", "w"]);
    expect(attrs.map((a) => a.path().map((s) => Symbol.as_str(s)).join("::"))).toEqual(
      ["allow", "doc", "a::b", "deprecated", "x", "doc", "doc", "doc", "w"],
    );
    expect(AttributeExt.Attribute.symbol_path(line_doc)).toBeUndefined();
    expect(ds(AttributeExt.Attribute.path_span(ab))).toBe("attrs.rs:3:3: 3:7 (#0)");
    expect(AttributeExt.Attribute.path_span(line_doc)).toBeUndefined();
    expect(ab.path_matches([Symbol.intern("a"), Symbol.intern("b")])).toBe(true);
    expect(ab.path_matches([Symbol.intern("a")])).toBe(false);
    expect(line_doc.path_matches([sym.doc])).toBe(false);
    expect(ab.has_name(Symbol.intern("b"))).toBe(false); // two segments: no single name
    expect(x.has_any_name([sym.doc, Symbol.intern("x")])).toBe(true);
    expect(attrs.map((a) => a.is_word())).toEqual([false, false, false, false, false, false, false, false, false]);
    expect(ds(ab.span_())).toBe("attrs.rs:3:1: 3:14 (#0)");
    expect(ab.get_normal_item()).toBe((ab.kind as { _0: { item: AttrItem } })._0.item);

    // `#[a::b = "v"]`: value_str / value_span come from the `Eq` args' literal expr.
    expect(name(ab.value_str())).toBe("v");
    expect(ds(ab.value_span())).toBe("attrs.rs:3:10: 3:13 (#0)");
    const ab_meta = ab.meta()!;
    expect(ab_meta.kind.$).toBe("NameValue");
    expect(ab_meta.name()).toBeUndefined();
    expect(ab.meta_kind()!.$).toBe("NameValue");
    expect(ab.meta_item_list()).toBeUndefined();
    expect(doc_alias.value_str()).toBeUndefined();
    expect(doc_alias.meta_kind()!.$).toBe("List");

    // Doc comments: `is_doc_comment` / `doc_str_and_fragment_kind` (oracle: `DocComment(Line, " line doc")`,
    // `DocComment(Block, " block doc ")`, and `#[doc = "raw doc"]` whose expr span is 8:9-8:18).
    expect(attrs.map((a) => a.is_doc_comment())).toEqual([false, false, false, false, false, true, true, false, false]);
    expect(ds(AttributeExt.Attribute.is_doc_comment(line_doc))).toBe("attrs.rs:6:1: 6:13 (#0)");
    const kinds = attrs.map((a) => {
      const r = a.doc_str_and_fragment_kind();
      if (r === undefined) return undefined;
      const k = r[1].$ === "Sugared" ? `Sugared(${r[1]._0})` : `Raw(${ds(r[1]._0)})`;
      return [Symbol.as_str(r[0]), k];
    });
    expect(kinds).toEqual([
      undefined,
      undefined, // `#[doc(...)]`
      undefined,
      undefined,
      undefined,
      [" line doc", "Sugared(Line)"],
      [" block doc ", "Sugared(Block)"],
      ["raw doc", "Raw(attrs.rs:8:9: 8:18 (#0))"],
      undefined,
    ]);
    expect(attrs.map((a) => name(a.doc_str()))).toEqual(
      [undefined, undefined, undefined, undefined, undefined, " line doc", " block doc ", "raw doc", undefined],
    );
    expect(attrs.map((a) => AttributeExt.Attribute.doc_resolution_scope(a))).toEqual(
      [undefined, undefined, undefined, undefined, undefined, "Outer", "Outer", "Outer", undefined],
    );
    expect(attrs.map((a) => AttributeExt.Attribute.is_doc_hidden(a))).toEqual(
      [false, true, false, false, false, false, false, false, false],
    );
    expect(AttributeExt.Attribute.is_doc_keyword_or_attribute(doc_alias)).toBe(false);
    expect(attrs.some((a) => a.is_proc_macro_attr() || AttributeExt.Attribute.is_automatically_derived_attr(a))).toBe(false);
    expect(attrs.some((a) => AttributeExt.Attribute.is_rustc_doc_primitive(a))).toBe(false);

    // `#[deprecated(note = "n", since = "1.0")]`: the note and the span of its meta item (4:14-4:24).
    const note = deprecated.deprecation_note()!;
    expect(name(note.name)).toBe("n");
    expect(ds(note.span)).toBe("attrs.rs:4:14: 4:24 (#0)");
    expect(raw_doc.deprecation_note()).toBeUndefined();
    expect(attrs.map((a) => a.may_have_doc_links())).toEqual([false, false, false, false, false, false, false, false, false]);

    // Token trees: the stored tokens for normal attributes, a `DocComment` token for doc comments.
    expect(TokenStream.new(w.token_trees())._0.length).toBe(2); // `#`, `[..]`
    const dc = block_doc.token_trees();
    expect(dc.length).toBe(1);
    expect(dc[0]!.$ === "Token" && dc[0]!._0.kind.$ === "DocComment" && dc[0]!._0.kind._0).toBe("Block");

    // filter_by_name / find_by_name / first_attr_value_str_by_name / contains_name.
    expect([...filter_by_name(attrs, sym.doc)]).toEqual([doc_alias, raw_doc]); // doc comments have no name
    expect(find_by_name(attrs, sym.deprecated)).toBe(deprecated);
    expect(find_by_name(attrs, sym.test)).toBeUndefined();
    // The first `doc` attribute is `#[doc(alias ..)]`, which has no value: `None`, not `"raw doc"`.
    expect(first_attr_value_str_by_name(attrs, sym.doc)).toBeUndefined();
    expect(name(first_attr_value_str_by_name([raw_doc, doc_alias], sym.doc))).toBe("raw doc");
    expect(contains_name(attrs, Symbol.intern("w"))).toBe(true);
    expect(contains_name(attrs, sym.test)).toBe(false);

    // MarkedAttrs.
    const marked = MarkedAttrs.new();
    marked.mark(x);
    expect(attrs.map((a) => marked.is_marked(a))).toEqual([false, false, false, false, true, false, false, false, false]);
  }));

/** Normalizes what later passes assign: expansion contexts, `NodeId`s, `AttrId`s. */
const norm = (s: string): string =>
  s.replace(/#\d+/g, "#N").replace(/NodeId\(\d+\)/g, "NodeId(N)").replace(/AttrId\(\d+\)/g, "AttrId(N)");

/** Strip the common indentation of an oracle excerpt. */
function dedent(s: string): string {
  const lines = s.replace(/^\n/, "").replace(/\n\s*$/, "").split("\n");
  const ind = Math.min(...lines.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length));
  return lines.map((l) => l.slice(ind)).join("\n").replace(/,$/, "");
}

const T_RS = "#![no_std]\n#![feature(prelude_import)]\n#[test]\nfn t() {}\n";

test("mk_attr_name_value_str (oracle: `#[rustc_test_marker = \"t\"]` from `#[test]`)", () =>
  with_file("t.rs", T_RS, (sp) => {
    const g = AttrIdGenerator.new();
    const attr = mk_attr_name_value_str(g, "Outer", sym.rustc_test_marker, Symbol.intern("t"), sp("t.rs:3:1: 3:8 (#0)"));
    expect(norm(debug_Attribute(attr, PRETTY))).toBe(norm(dedent(`
                Attribute {
                    kind: Normal(
                        NormalAttr {
                            item: AttrItem {
                                unsafety: Default,
                                path: Path {
                                    span: t.rs:3:1: 3:8 (#3),
                                    segments: [
                                        PathSegment {
                                            ident: rustc_test_marker#3,
                                            id: NodeId(12),
                                            args: None,
                                        },
                                    ],
                                },
                                args: Eq {
                                    eq_span: t.rs:3:1: 3:8 (#3),
                                    expr: Expr {
                                        id: NodeId(13),
                                        kind: Lit(
                                            Lit {
                                                kind: Str,
                                                symbol: "t",
                                                suffix: None,
                                            },
                                        ),
                                        span: t.rs:3:1: 3:8 (#3),
                                        attrs: [],
                                        tokens: None,
                                    },
                                },
                                span: t.rs:3:1: 3:8 (#3),
                            },
                            tokens: Some(
                                LazyAttrTokenStream(AttrTokenStream([Token(Token { kind: Pound, span: t.rs:3:1: 3:8 (#3) }, JointHidden), Delimited(DelimSpan { open: t.rs:3:1: 3:8 (#3), close: t.rs:3:1: 3:8 (#3) }, DelimSpacing { open: JointHidden, close: Alone }, Bracket, AttrTokenStream([Token(Token { kind: Ident("rustc_test_marker", Normal), span: t.rs:3:1: 3:8 (#3) }, Alone), Token(Token { kind: Eq, span: t.rs:3:1: 3:8 (#3) }, Alone), Token(Token { kind: Literal(Lit { kind: Str, symbol: "t", suffix: None }), span: t.rs:3:1: 3:8 (#3) }, Alone)]))])),
                            ),
                        },
                    ),
                    id: AttrId(6),
                    style: Outer,
                    span: t.rs:3:1: 3:8 (#3),
                },
`)));
    expect(name(attr.value_str())).toBe("t");
  }));

test("mk_attr_word (oracle: the test harness's `#[rustc_main]`)", () =>
  with_file("t.rs", T_RS, () => {
    const g = AttrIdGenerator.new();
    const attr = mk_attr_word(g, "Outer", sym.rustc_main, DUMMY_SP);
    expect(norm(debug_Attribute(attr, PRETTY))).toBe(norm(dedent(`
                Attribute {
                    kind: Normal(
                        NormalAttr {
                            item: AttrItem {
                                unsafety: Default,
                                path: Path {
                                    span: no-location (#4),
                                    segments: [
                                        PathSegment {
                                            ident: rustc_main#4,
                                            id: NodeId(81),
                                            args: None,
                                        },
                                    ],
                                },
                                args: Empty,
                                span: no-location (#4),
                            },
                            tokens: Some(
                                LazyAttrTokenStream(AttrTokenStream([Token(Token { kind: Pound, span: no-location (#4) }, JointHidden), Delimited(DelimSpan { open: no-location (#4), close: no-location (#4) }, DelimSpacing { open: JointHidden, close: Alone }, Bracket, AttrTokenStream([Token(Token { kind: Ident("rustc_main", Normal), span: no-location (#4) }, Alone)]))])),
                            ),
                        },
                    ),
                    id: AttrId(8),
                    style: Outer,
                    span: no-location (#4),
                },
`)));
    expect(attr.is_word()).toBe(true);
    expect(attr.meta()!.is_word()).toBe(true);
  }));

test("mk_attr_nested_word (oracle: the test harness's `#[coverage(off)]`)", () =>
  with_file("t.rs", T_RS, () => {
    const g = AttrIdGenerator.new();
    const attr = mk_attr_nested_word(g, "Outer", sym.coverage, sym.off, DUMMY_SP);
    expect(norm(debug_Attribute(attr, PRETTY))).toBe(norm(dedent(`
                Attribute {
                    kind: Normal(
                        NormalAttr {
                            item: AttrItem {
                                unsafety: Default,
                                path: Path {
                                    span: no-location (#4),
                                    segments: [
                                        PathSegment {
                                            ident: coverage#4,
                                            id: NodeId(82),
                                            args: None,
                                        },
                                    ],
                                },
                                args: Delimited(
                                    DelimArgs {
                                        dspan: DelimSpan {
                                            open: no-location (#4),
                                            close: no-location (#4),
                                        },
                                        delim: Parenthesis,
                                        tokens: TokenStream(
                                            [
                                                Token(
                                                    Token {
                                                        kind: Ident(
                                                            "off",
                                                            Normal,
                                                        ),
                                                        span: no-location (#4),
                                                    },
                                                    Alone,
                                                ),
                                            ],
                                        ),
                                    },
                                ),
                                span: no-location (#4),
                            },
                            tokens: Some(
                                LazyAttrTokenStream(AttrTokenStream([Token(Token { kind: Pound, span: no-location (#4) }, JointHidden), Delimited(DelimSpan { open: no-location (#4), close: no-location (#4) }, DelimSpacing { open: JointHidden, close: Alone }, Bracket, AttrTokenStream([Token(Token { kind: Ident("coverage", Normal), span: no-location (#4) }, Alone), Delimited(DelimSpan { open: no-location (#4), close: no-location (#4) }, DelimSpacing { open: JointHidden, close: Alone }, Parenthesis, AttrTokenStream([Token(Token { kind: Ident("off", Normal), span: no-location (#4) }, Alone)]))]))])),
                            ),
                        },
                    ),
                    id: AttrId(9),
                    style: Outer,
                    span: no-location (#4),
                },
`)));
    expect(attr.meta_item_list()!.map((i) => name(MetaItemInner.name(i)))).toEqual(["off"]);
  }));

test("mk_attr_tokens, inner style: `#` (Joint) `!` (JointHidden) `[..]` as the oracle lexes `#![no_std]`", () =>
  with_file("t.rs", T_RS, () => {
    const g = AttrIdGenerator.new();
    const attr = mk_attr_word(g, "Inner", sym.no_std, DUMMY_SP);
    const tokens = (attr.kind as { _0: { tokens: LazyAttrTokenStream } })._0.tokens.to_attr_token_stream();
    // Oracle (t.rs line 1, spans dropped): Token(Pound, Joint), Token(Bang, JointHidden),
    // Delimited(DelimSpacing { open: JointHidden, close: Alone }, Bracket, [Token(Ident("no_std"), JointHidden)]).
    // The lexer marks `no_std` JointHidden (followed by `]`); `mk_attr_word` builds it `Alone` (mod.rs:783).
    const shape = tokens._0.map((t) =>
      t.$ === "Token" ? `${t._0.kind.$}/${t._1}` : t.$ === "Delimited" ? `${t._2.$}/${t._1.open}/${t._1.close}` : t.$,
    );
    expect(shape).toEqual(["Pound/Joint", "Bang/JointHidden", "Bracket/JointHidden/Alone"]);
    expect(attr.style).toBe("Inner");
    expect(attr.id_() as number).toBe(0);
    expect(g.mk_attr_id() as number).toBe(1);
  }));

test("Attribute::convert_normal_to_synthetic keeps id, style and span", () =>
  with_file("t.rs", T_RS, () => {
    const g = AttrIdGenerator.new();
    const attr = mk_attr_word(g, "Outer", sym.rustc_main, DUMMY_SP);
    const syn = attr.convert_normal_to_synthetic({ $: "CfgTrace", _0: { $: "Bool", _0: true, _1: DUMMY_SP } });
    expect(syn.kind.$).toBe("Synthetic");
    expect([syn.id, syn.style, syn.span]).toEqual([attr.id, attr.style, attr.span]);
    expect(syn.name()).toBeUndefined();
    expect(syn.meta()).toBeUndefined();
    expect(syn.token_trees()).toEqual([]);
    expect(() => syn.get_normal_item()).toThrow(new Panic("internal error: entered unreachable code")); // attr/mod.rs:65
  }));
