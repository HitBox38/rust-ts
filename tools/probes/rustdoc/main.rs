//! Oracle probe for src/rustc_resolve/rustdoc_oracle.test.ts (lane rustdoc): runs the oracle
//! compiler's own `rustc_resolve::rustdoc` (doc fragments, unindenting, doc-link preprocessing) and
//! its re-exported `pulldown_cmark` 0.11.3 parser on doc comments and markdown.
//!
//!   rustdoc < cases
//!
//! Input lines (text fields are hex of the UTF-8 bytes, `_` = empty):
//!   doc <line|block|raw> <outer|inner> <hex>   one attribute of the current case: a `///`/`//!` (line)
//!                                              or `/** */`/`/*! */` (block) doc comment whose
//!                                              `AttrKind::DocComment` data is the text, or a
//!                                              `#[doc = "<text>"]` (raw)
//!   md <options> <hex>                         a markdown case parsed with `Options::from_bits_truncate`
//!   strip <hex>                                a `strip_generics_from_path` case
//!   end                                        end of the case: print its output
//! Every attribute is built with `DUMMY_SP` inside one `create_default_session_globals_then`.
//!
//! Output, per case: `case <n>`, then
//!   doc cases: `frag <doc:?> <kind> <indent> <style:?>` per `attrs_to_doc_fragments(.., false)`
//!     fragment (kind `Sugared(Line|Block)` or `Raw`, indent `MAX` for `usize::MAX - 1..`), then per
//!     `prepare_to_doc_link_resolution` entry `docs <outer:?> <inner:?>`, then the markdown
//!     report of `outer + inner` of the first entry (what `attrs_to_preprocessed_links` parses) with
//!     `main_body_opts()`;
//!   md cases: the markdown report;
//!   strip cases: `strip <result:?>`.
//! Markdown report: `ev <event> <start>..<end>` for each `into_offset_iter` event (strings printed with
//! `str`'s Debug, so `CowStr`'s storage variant is not visible), `def <label:?> <dest:?> <title:?>`
//! per reference definition sorted by label, then `link <link:?>` for each link `parse_links` returns.
//! `parse_links` / `preprocess_link` / `collect_link_data` are private upstream: they are copied below
//! verbatim from compiler/rustc_resolve/src/rustdoc.rs at the pin (only `itertools::sorted_by_key` is
//! a stable `sort_by_key` and `trim_suffix` is `strip_suffix().unwrap_or()`).
#![feature(rustc_private)]
extern crate rustc_ast;
extern crate rustc_data_structures;
extern crate rustc_driver;
extern crate rustc_resolve;
extern crate rustc_span;

use std::io::{BufRead, Write};

use rustc_ast::attr::{AttrIdGenerator, mk_attr_name_value_str, mk_doc_comment};
use rustc_ast::token::{CommentKind, DocFragmentKind};
use rustc_ast::AttrStyle;
use rustc_data_structures::unord::UnordSet;
use rustc_resolve::rustdoc::pulldown_cmark::{
    BrokenLink, BrokenLinkCallback, CodeBlockKind, CowStr, Event, LinkType, Options, Parser, Tag,
};
use rustc_resolve::rustdoc::{
    attrs_to_doc_fragments, main_body_opts, may_be_doc_link, prepare_to_doc_link_resolution,
    strip_generics_from_path,
};
use rustc_span::{DUMMY_SP, Symbol, sym};

fn unhex(s: &str) -> String {
    if s == "_" {
        return String::new();
    }
    let b: Vec<u8> = (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect();
    String::from_utf8(b).unwrap()
}

fn q(s: &str) -> String {
    format!("{:?}", s)
}

fn fmt_tag(t: &Tag<'_>) -> String {
    match t {
        Tag::Paragraph => "Paragraph".into(),
        Tag::Heading { level, id, classes, attrs } => format!(
            "Heading({:?}, {:?}, {:?}, {:?})",
            level,
            id.as_deref(),
            classes.iter().map(|c| c.as_ref()).collect::<Vec<&str>>(),
            attrs.iter().map(|(a, b)| (a.as_ref(), b.as_deref())).collect::<Vec<_>>()
        ),
        Tag::BlockQuote(k) => format!("BlockQuote({:?})", k),
        Tag::CodeBlock(CodeBlockKind::Indented) => "CodeBlock(Indented)".into(),
        Tag::CodeBlock(CodeBlockKind::Fenced(x)) => format!("CodeBlock(Fenced({}))", q(x)),
        Tag::HtmlBlock => "HtmlBlock".into(),
        Tag::List(n) => format!("List({:?})", n),
        Tag::Item => "Item".into(),
        Tag::FootnoteDefinition(x) => format!("FootnoteDefinition({})", q(x)),
        Tag::Table(a) => format!("Table({:?})", a),
        Tag::TableHead => "TableHead".into(),
        Tag::TableRow => "TableRow".into(),
        Tag::TableCell => "TableCell".into(),
        Tag::Emphasis => "Emphasis".into(),
        Tag::Strong => "Strong".into(),
        Tag::Strikethrough => "Strikethrough".into(),
        Tag::Link { link_type, dest_url, title, id } => {
            format!("Link({:?}, {}, {}, {})", link_type, q(dest_url), q(title), q(id))
        }
        Tag::Image { link_type, dest_url, title, id } => {
            format!("Image({:?}, {}, {}, {})", link_type, q(dest_url), q(title), q(id))
        }
        Tag::MetadataBlock(k) => format!("MetadataBlock({:?})", k),
    }
}

fn fmt_event(e: &Event<'_>) -> String {
    match e {
        Event::Start(t) => format!("Start({})", fmt_tag(t)),
        Event::End(t) => format!("End({:?})", t),
        Event::Text(x) => format!("Text({})", q(x)),
        Event::Code(x) => format!("Code({})", q(x)),
        Event::InlineMath(x) => format!("InlineMath({})", q(x)),
        Event::DisplayMath(x) => format!("DisplayMath({})", q(x)),
        Event::Html(x) => format!("Html({})", q(x)),
        Event::InlineHtml(x) => format!("InlineHtml({})", q(x)),
        Event::FootnoteReference(x) => format!("FootnoteReference({})", q(x)),
        Event::SoftBreak => "SoftBreak".into(),
        Event::HardBreak => "HardBreak".into(),
        Event::Rule => "Rule".into(),
        Event::TaskListMarker(b) => format!("TaskListMarker({})", b),
    }
}

// ---- copied from compiler/rustc_resolve/src/rustdoc.rs (private there) ----

/// Simplified version of the corresponding function in rustdoc.
fn preprocess_link(link: &str) -> Box<str> {
    let link = link.replace('`', "");
    let link = link.split('#').next().unwrap();
    let link = link.trim();
    let link = link.split_once('@').map_or(link, |(_, rhs)| rhs);
    let link = link.strip_suffix("()").unwrap_or(link);
    let link = link.strip_suffix("{}").unwrap_or(link);
    let link = link.strip_suffix("[]").unwrap_or(link);
    let link = if link != "!" { link.strip_suffix('!').unwrap_or(link) } else { link };
    let link = link.trim();
    strip_generics_from_path(link).unwrap_or_else(|_| link.into())
}

/// Similar version of `markdown_links` from rustdoc.
/// This will collect destination links and display text if exists.
fn parse_links<'md>(doc: &'md str) -> Vec<Box<str>> {
    let mut broken_link_callback = |link: BrokenLink<'md>| Some((link.reference, "".into()));
    let mut event_iter = Parser::new_with_broken_link_callback(
        doc,
        main_body_opts(),
        Some(&mut broken_link_callback),
    );
    let mut links = Vec::new();

    let mut refids = UnordSet::default();

    while let Some(event) = event_iter.next() {
        match event {
            Event::Start(Tag::Link { link_type, dest_url, title: _, id })
                if may_be_doc_link(link_type) =>
            {
                if matches!(
                    link_type,
                    LinkType::Inline
                        | LinkType::ReferenceUnknown
                        | LinkType::Reference
                        | LinkType::Shortcut
                        | LinkType::ShortcutUnknown
                ) {
                    if let Some(display_text) = collect_link_data(&mut event_iter) {
                        links.push(display_text);
                    }
                }
                if matches!(
                    link_type,
                    LinkType::Reference | LinkType::Shortcut | LinkType::Collapsed
                ) {
                    refids.insert(id);
                }

                links.push(preprocess_link(&dest_url));
            }
            _ => {}
        }
    }

    let mut defs: Vec<_> = event_iter.reference_definitions().iter().collect();
    defs.sort_by_key(|x| x.0);
    for (label, refdef) in defs {
        if !refids.contains(label) {
            links.push(preprocess_link(&refdef.dest));
        }
    }

    links
}

/// Collects additional data of link.
fn collect_link_data<'input, F: BrokenLinkCallback<'input>>(
    event_iter: &mut Parser<'input, F>,
) -> Option<Box<str>> {
    let mut display_text: Option<String> = None;
    let mut append_text = |text: CowStr<'_>| {
        if let Some(display_text) = &mut display_text {
            display_text.push_str(&text);
        } else {
            display_text = Some(text.to_string());
        }
    };

    while let Some(event) = event_iter.next() {
        match event {
            Event::Text(text) => {
                append_text(text);
            }
            Event::Code(code) => {
                append_text(code);
            }
            Event::End(_) => {
                break;
            }
            _ => {}
        }
    }

    display_text.map(String::into_boxed_str)
}

// ---- end of the copy ----

fn markdown_report(out: &mut String, md: &str, opts: Options) {
    let parser = Parser::new_ext(md, opts);
    let mut it = parser.into_offset_iter();
    while let Some((e, r)) = it.next() {
        out.push_str(&format!("ev {} {}..{}\n", fmt_event(&e), r.start, r.end));
    }
    let mut defs: Vec<_> = it.reference_definitions().iter().collect();
    defs.sort_by_key(|x| x.0);
    for (label, def) in defs {
        out.push_str(&format!("def {} {} {:?}\n", q(label), q(&def.dest), def.title.as_deref()));
    }
    for l in parse_links(md) {
        out.push_str(&format!("link {}\n", q(&l)));
    }
}

fn main() {
    rustc_span::create_default_session_globals_then(|| {
        let stdin = std::io::stdin();
        let stdout = std::io::stdout();
        let mut w = std::io::BufWriter::new(stdout.lock());
        let g = AttrIdGenerator::new();
        let mut attrs = Vec::new();
        let mut md: Option<(u32, String)> = None;
        let mut strip: Option<String> = None;
        let mut n = 0usize;
        for line in stdin.lock().lines() {
            let line = line.unwrap();
            let parts: Vec<&str> = line.split(' ').collect();
            match parts[0] {
                "doc" => {
                    let style = if parts[2] == "inner" { AttrStyle::Inner } else { AttrStyle::Outer };
                    let text = Symbol::intern(&unhex(parts[3]));
                    let attr = match parts[1] {
                        "line" => mk_doc_comment(&g, CommentKind::Line, style, text, DUMMY_SP),
                        "block" => mk_doc_comment(&g, CommentKind::Block, style, text, DUMMY_SP),
                        "raw" => mk_attr_name_value_str(&g, style, sym::doc, text, DUMMY_SP),
                        k => panic!("bad doc kind {k}"),
                    };
                    attrs.push(attr);
                }
                "md" => md = Some((parts[1].parse().unwrap(), unhex(parts[2]))),
                "strip" => strip = Some(unhex(parts[1])),
                "end" => {
                    let mut out = format!("case {n}\n");
                    n += 1;
                    if let Some((opts, text)) = md.take() {
                        markdown_report(&mut out, &text, Options::from_bits_truncate(opts));
                    } else if let Some(path) = strip.take() {
                        out.push_str(&format!("strip {:?}\n", strip_generics_from_path(&path)));
                    } else {
                        let (frags, others) =
                            attrs_to_doc_fragments(attrs.iter().map(|a| (a, None)), false);
                        assert!(others.is_empty());
                        for f in &frags {
                            let kind = match f.kind {
                                DocFragmentKind::Sugared(CommentKind::Line) => "Sugared(Line)",
                                DocFragmentKind::Sugared(CommentKind::Block) => "Sugared(Block)",
                                DocFragmentKind::Raw(_) => "Raw",
                            };
                            let indent = if f.indent >= usize::MAX - 1 {
                                "MAX".to_string()
                            } else {
                                f.indent.to_string()
                            };
                            out.push_str(&format!(
                                "frag {} {} {} {:?}\n",
                                q(f.doc.as_str()),
                                kind,
                                indent,
                                f.style
                            ));
                        }
                        let docs = prepare_to_doc_link_resolution(&frags);
                        for (_, d) in &docs {
                            out.push_str(&format!("docs {} {}\n", q(&d.outer), q(&d.inner)));
                        }
                        if let Some(d) = docs.into_values().next() {
                            markdown_report(&mut out, &format!("{}{}", d.outer, d.inner), main_body_opts());
                        }
                        attrs.clear();
                    }
                    w.write_all(out.as_bytes()).unwrap();
                }
                "" => {}
                k => panic!("bad line {k}"),
            }
        }
    });
}
