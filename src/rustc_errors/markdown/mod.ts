//! A simple markdown parser that can write formatted text to the terminal
//!
//! Entrypoint is `MdStream::parse_str(...)`
// Port of compiler/rustc_errors/src/markdown/mod.rs.
// PORT: the `&'a str` leaves of `MdTree` are JS strings (decoded from the parser's byte slices, `str::from_utf8(..)
// .unwrap()` as upstream); term.ts re-encodes the one place that indexes them by byte (`write_wrapping`). The
// `Vec<u8>` output buffer is anstream's `VecU8`.
import type { IoResult } from "../../std/io.ts";
import { AutoStream } from "../../vendor/anstream/lib.ts";
import { type Stdout as StdStdout, type VecU8, stdout } from "../../vendor/anstream/stream.ts";
import * as parse from "./parse.ts";
import * as term from "./term.ts";

/** `&(dyn Fn(&str, &mut Vec<u8>) -> io::Result<()> + 'static)` */
export type Formatter = (txt: string, buf: VecU8) => IoResult<void>;

/// An AST representation of a Markdown document
// #[derive(Clone, Debug, Default, PartialEq)]
// PORT: `Debug` is not ported (never printed outside a failing upstream unit test); `PartialEq` is `MdStream_eq`.
export class MdStream {
  constructor(public _0: MdTree[]) {}

  /// Parse a markdown string to a tokenstream
  // #[must_use]
  // rustc: compiler/rustc_errors/src/markdown/mod.rs:17 parse_str
  static parse_str(s: string): MdStream {
    return parse.entrypoint(s);
  }

  /// Write formatted output to a stdout buffer, optionally with
  /// a formatter for code blocks
  // rustc: compiler/rustc_errors/src/markdown/mod.rs:23 write_anstream_buf
  write_anstream_buf(buf: VecU8, formatter: Formatter | undefined): IoResult<void> {
    return term.entrypoint(this, buf, formatter);
  }

  // impl<'a> From<Vec<MdTree<'a>>> for MdStream<'a>
  // rustc: compiler/rustc_errors/src/markdown/mod.rs:78 from
  static from(value: MdTree[]): MdStream {
    return new MdStream(value);
  }
}

/// Create an anstream buffer with the `Always` color choice
// rustc: compiler/rustc_errors/src/markdown/mod.rs:33 create_stdout_bufwtr
export function create_stdout_bufwtr(): AutoStream<StdStdout> {
  return AutoStream.always(stdout());
}

/// A single tokentree within a Markdown document
// #[derive(Clone, Debug, PartialEq)]
export type MdTree =
  /// Leaf types
  | { readonly $: "Comment"; readonly _0: string }
  | { readonly $: "CodeBlock"; readonly txt: string; readonly lang: string | undefined }
  | { readonly $: "CodeInline"; readonly _0: string }
  | { readonly $: "Strong"; readonly _0: string }
  | { readonly $: "Emphasis"; readonly _0: string }
  | { readonly $: "Strikethrough"; readonly _0: string }
  | { readonly $: "PlainText"; readonly _0: string }
  /// [Foo](www.foo.com) or simple anchor <www.foo.com>
  | { readonly $: "Link"; readonly disp: string; readonly link: string }
  /// `[Foo link][ref]`
  | { readonly $: "RefLink"; readonly disp: string; readonly id: string | undefined }
  /// [ref]: www.foo.com
  | { readonly $: "LinkDef"; readonly id: string; readonly link: string }
  /// Break bewtween two paragraphs (double `\n`), not directly parsed but
  /// added later
  | { readonly $: "ParagraphBreak" }
  /// Break bewtween two lines (single `\n`)
  | { readonly $: "LineBreak" }
  | { readonly $: "HorizontalRule" }
  | { readonly $: "Heading"; readonly _0: number; readonly _1: MdStream }
  | { readonly $: "OrderedListItem"; readonly _0: number; readonly _1: MdStream }
  | { readonly $: "UnorderedListItem"; readonly _0: MdStream };

export const MdTree = {
  ParagraphBreak: Object.freeze({ $: "ParagraphBreak" }) as MdTree,
  LineBreak: Object.freeze({ $: "LineBreak" }) as MdTree,
  HorizontalRule: Object.freeze({ $: "HorizontalRule" }) as MdTree,
  Comment: (_0: string): MdTree => ({ $: "Comment", _0 }),
  CodeInline: (_0: string): MdTree => ({ $: "CodeInline", _0 }),
  Strong: (_0: string): MdTree => ({ $: "Strong", _0 }),
  Emphasis: (_0: string): MdTree => ({ $: "Emphasis", _0 }),
  Strikethrough: (_0: string): MdTree => ({ $: "Strikethrough", _0 }),
  PlainText: (_0: string): MdTree => ({ $: "PlainText", _0 }),
} as const;

/** `#[derive(PartialEq)]` of `MdStream` */
export function MdStream_eq(a: MdStream, b: MdStream): boolean {
  return a._0.length === b._0.length && a._0.every((x, i) => MdTree_eq(x, b._0[i]!));
}

/** `#[derive(PartialEq)]` of `MdTree` */
export function MdTree_eq(a: MdTree, b: MdTree): boolean {
  switch (a.$) {
    case "Comment":
    case "CodeInline":
    case "Strong":
    case "Emphasis":
    case "Strikethrough":
    case "PlainText":
      return b.$ === a.$ && b._0 === a._0;
    case "CodeBlock":
      return b.$ === "CodeBlock" && b.txt === a.txt && b.lang === a.lang;
    case "Link":
      return b.$ === "Link" && b.disp === a.disp && b.link === a.link;
    case "RefLink":
      return b.$ === "RefLink" && b.disp === a.disp && b.id === a.id;
    case "LinkDef":
      return b.$ === "LinkDef" && b.id === a.id && b.link === a.link;
    case "ParagraphBreak":
    case "LineBreak":
    case "HorizontalRule":
      return b.$ === a.$;
    case "Heading":
    case "OrderedListItem":
      return b.$ === a.$ && b._0 === a._0 && MdStream_eq(a._1, b._1);
    case "UnorderedListItem":
      return b.$ === "UnorderedListItem" && MdStream_eq(a._0, b._0);
  }
}
