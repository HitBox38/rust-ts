// Port of compiler/rustc_resolve/src/rustdoc.rs
//
// Stub (contract-first, lane res-lib): free fns with their final signatures and `unported` bodies,
// without markers. The lane that ports rustdoc.rs (wave 12, with pulldown-cmark 0.11.3) replaces each
// stub in place, adding its `// rustc: ` marker (docs/handoff/res-lib.md, "How to fill a stub").
// PORT: the `pulldown_cmark` types (`Options`, `LinkType`, `Parser`, `BrokenLinkCallback`) are not
// ported yet; they are opaque stand-ins below until the vendor crate exists.
// Init order: top-level code here may touch only this file's `.gen.ts` and other crates.
import type { Attribute } from "../rustc_ast/lib.ts";
import type { AttributeExt } from "../rustc_ast/attr/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";
import type { SourceMap } from "../rustc_span/source_map.ts";
import type { Symbol } from "../rustc_span/symbol.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { unported } from "../std/panic.ts";
import type { Result } from "../std/result.ts";
import type { DocFragment, DocStrings, MalformedGenerics } from "./rustdoc.gen.ts";
import type { Range } from "./lib.ts";

export * from "./rustdoc.gen.ts";

/** PORT: stand-in for `pulldown_cmark::Options` (vendor crate not ported). */
export type Options = { readonly __stub: "pulldown_cmark::Options" };
/** PORT: stand-in for `pulldown_cmark::LinkType`. */
export type LinkType = { readonly __stub: "pulldown_cmark::LinkType" };
/** PORT: stand-in for `pulldown_cmark::Parser<'input, F>`. */
export type Parser<F> = { readonly __stub: "pulldown_cmark::Parser"; readonly __f?: F };

/// Removes excess indentation on comments in order for the Markdown
/// to be parsed correctly. This is necessary because the convention for
/// writing documentation is to provide a space between the /// or //! marker
/// and the doc text, but Markdown is whitespace-sensitive. For example,
/// a block of text with four-space indentation is parsed as a code block,
/// so if we didn't unindent comments, these list items
///
/// /// A list:
/// ///
/// ///    - Foo
/// ///    - Bar
///
/// would be parsed as if they were in a code block, which is likely not what the user intended.
/** Stub (lane res-lib): `rustdoc.rs:108` `unindent_doc_fragments` (unported). */
export function unindent_doc_fragments(docs: DocFragment[]): void {
  unported("rustc_resolve::rustdoc::unindent_doc_fragments");
}

/// The goal of this function is to apply the `DocFragment` transformation that is required when
/// transforming into the final Markdown, which is applying the computed indent to each line in
/// each doc fragment (a `DocFragment` can contain multiple lines in case of `#[doc = ""]`).
///
/// Note: remove the trailing newline where appropriate
/** Stub (lane res-lib): `rustdoc.rs:182` `add_doc_fragment` (unported). */
export function add_doc_fragment(out: MutRef<string>, frag: DocFragment): void {
  unported("rustc_resolve::rustdoc::add_doc_fragment");
}

/** Stub (lane res-lib): `rustdoc.rs:201` `attrs_to_doc_fragments` (unported). `A: AttributeExt` is the trailing impl table. */
export function attrs_to_doc_fragments<A>(attrs: Iterable<[A, DefId | undefined]>, doc_only: boolean, A_AttributeExt: AttributeExt<A>): [DocFragment[], A[]] {
  return unported("rustc_resolve::rustdoc::attrs_to_doc_fragments");
}

/// Return the doc-comments on this item, grouped by the module they came from.
/// The module can be different if this is a re-export with added documentation.
///
/// The last newline is not trimmed so the produced strings are reusable between
/// early and late doc link resolution regardless of their position.
/** Stub (lane res-lib): `rustdoc.rs:255` `prepare_to_doc_link_resolution` (unported). `FxIndexMap<Option<DefId>, ..>` keys: see KeyedMap. */
export function prepare_to_doc_link_resolution(doc_fragments: readonly DocFragment[]): Map<DefId | undefined, DocStrings> {
  return unported("rustc_resolve::rustdoc::prepare_to_doc_link_resolution");
}

/// Options for rendering Markdown in the main body of documentation.
/** Stub (lane res-lib): `rustdoc.rs:272` `main_body_opts` (unported). */
export function main_body_opts(): Options {
  return unported("rustc_resolve::rustdoc::main_body_opts");
}

/** Stub (lane res-lib): `rustdoc.rs:280` `strip_generics_from_path_segment` (unported). `Vec<char>` -> code points. */
export function strip_generics_from_path_segment(segment: number[]): Result<Symbol, MalformedGenerics> {
  return unported("rustc_resolve::rustdoc::strip_generics_from_path_segment");
}

/** Stub (lane res-lib): `rustdoc.rs:312` `strip_generics_from_path` (unported). */
export function strip_generics_from_path(path_str: string): Result<string, MalformedGenerics> {
  return unported("rustc_resolve::rustdoc::strip_generics_from_path");
}

/// Returns whether the first doc-comment is an inner attribute.
///
/// If there are no doc-comments, return true.
/// FIXME(#78591): Support both inner and outer attributes on the same item.
/** Stub (lane res-lib): `rustdoc.rs:376` `has_primitive_or_keyword_or_attribute_docs` (unported). `impl AttributeExt` is the trailing impl table. */
export function has_primitive_or_keyword_or_attribute_docs<A>(attrs: readonly A[], A_AttributeExt: AttributeExt<A>): boolean {
  return unported("rustc_resolve::rustdoc::has_primitive_or_keyword_or_attribute_docs");
}

/// Simplified version of the corresponding function in rustdoc.
/// If the rustdoc version returns a successful result, this function must return the same result.
/// Otherwise this function may return anything.
/** Stub (lane res-lib): `rustdoc.rs:386` `preprocess_link` (unported). */
export function preprocess_link(link: string): string {
  return unported("rustc_resolve::rustdoc::preprocess_link");
}

/** Stub (lane res-lib): `rustdoc.rs:405` `may_be_doc_link` (unported). */
export function may_be_doc_link(link_type: LinkType): boolean {
  return unported("rustc_resolve::rustdoc::may_be_doc_link");
}

/// Simplified version of `preprocessed_markdown_links` from rustdoc.
/// Must return at least the same links as it, but may add some more links on top of that.
/** Stub (lane res-lib): `rustdoc.rs:420` `attrs_to_preprocessed_links` (unported). */
export function attrs_to_preprocessed_links(attrs: readonly Attribute[]): string[] {
  return unported("rustc_resolve::rustdoc::attrs_to_preprocessed_links");
}

/// Similar version of `markdown_links` from rustdoc.
/// This will collect destination links and display text if exists.
/** Stub (lane res-lib): `rustdoc.rs:440` `parse_links` (unported). */
export function parse_links(doc: string): string[] {
  return unported("rustc_resolve::rustdoc::parse_links");
}

/// Collects additional data of link.
/** Stub (lane res-lib): `rustdoc.rs:491` `collect_link_data` (unported). */
export function collect_link_data<F>(event_iter: Parser<F>): string | undefined {
  return unported("rustc_resolve::rustdoc::collect_link_data");
}

/// Returns a span encompassing all the document fragments.
/** Stub (lane res-lib): `rustdoc.rs:522` `span_of_fragments` (unported). */
export function span_of_fragments(fragments: readonly DocFragment[]): Span | undefined {
  return unported("rustc_resolve::rustdoc::span_of_fragments");
}

/// Attempts to match a range of bytes from parsed markdown to a `Span` in the source code.
/** Stub (lane res-lib): `rustdoc.rs:555` `source_span_for_markdown_range` (unported). */
export function source_span_for_markdown_range(tcx: TyCtxt, markdown: string, md_range: Range<number>, fragments: readonly DocFragment[]): [Span, boolean] | undefined {
  return unported("rustc_resolve::rustdoc::source_span_for_markdown_range");
}

/// Same as `source_span_for_markdown_range` but takes a `SourceMap` instead of a `TyCtxt`.
/** Stub (lane res-lib): `rustdoc.rs:566` `source_span_for_markdown_range_inner` (unported). */
export function source_span_for_markdown_range_inner(map: SourceMap, markdown: string, md_range: Range<number>, fragments: readonly DocFragment[]): [Span, boolean] | undefined {
  return unported("rustc_resolve::rustdoc::source_span_for_markdown_range_inner");
}
