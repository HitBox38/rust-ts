// Oracle probe for `src/rustc_expand/proc_macro_server.test.ts` (lane expand-pm-types; not part of the build).
//
// A proc-macro crate whose macros drive the real `rustc_expand::proc_macro_server::Rustc` through the
// `proc_macro` bridge and print what they observe to stderr, one `@@ `-prefixed line per output line.
// `gen.ts` (next to this file) builds it with the pinned nightly and compiles every `cases/<name>/t.rs`
// against it; proc_macro_server.test.ts makes the same server calls on the TS port and compares the lines.
//
// Masking: spans built from `Span::call_site()` carry the expansion's `SyntaxContext`, whose number depends
// on everything expanded before. Every line has the call-site span's Debug text replaced by `CALL_SITE` and
// any other `#<call-site ctxt> ` by `#CS ` (the TS side masks its own call site the same way).
#![feature(proc_macro_span, proc_macro_expand, proc_macro_diagnostic, proc_macro_value)]

extern crate proc_macro;

use proc_macro::{Delimiter, Group, Ident, Literal, Punct, Spacing, Span, TokenStream, TokenTree};

struct Out {
    lines: Vec<String>,
    cs: String,
    cs_ctxt: String,
}

impl Out {
    fn new() -> Out {
        let cs = format!("{:?}", Span::call_site());
        let cs_ctxt = format!("{} ", cs.split(' ').next().unwrap());
        Out { lines: Vec::new(), cs, cs_ctxt }
    }
    fn push(&mut self, s: String) {
        let s = s.replace(&self.cs, "CALL_SITE").replace(&self.cs_ctxt, "#CS ");
        for l in s.lines() {
            self.lines.push(l.to_string());
        }
    }
    fn flush(self) {
        for l in self.lines {
            eprintln!("@@ {l}");
        }
    }
}

/// Rebuilds a stream tree by tree (every `Group` re-created with `Group::new` + `set_span`), so the
/// result goes through `ts_concat_trees` / `to_internal` instead of reusing the input handle.
fn rebuild(ts: TokenStream) -> TokenStream {
    ts.into_iter()
        .map(|tt| match tt {
            TokenTree::Group(g) => {
                let mut ng = Group::new(g.delimiter(), rebuild(g.stream()));
                ng.set_span(g.span());
                TokenTree::Group(ng)
            }
            other => other,
        })
        .collect()
}

fn span_info(o: &mut Out, what: &str, s: Span) {
    let r = s.byte_range();
    o.push(format!(
        "{what} {:?} line={} col={} range={}..{} start={:?} end={:?} text={:?} file={:?} local={:?} parent={:?} source={:?}",
        s,
        s.line(),
        s.column(),
        r.start,
        r.end,
        s.start(),
        s.end(),
        s.source_text(),
        s.file(),
        s.local_file(),
        s.parent(),
        s.source(),
    ));
}

fn walk_spans(o: &mut Out, ts: TokenStream) {
    for tt in ts {
        match tt {
            TokenTree::Group(g) => {
                span_info(o, &format!("group {:?}", g.delimiter()), g.span());
                span_info(o, "  open", g.span_open());
                span_info(o, "  close", g.span_close());
                o.push(format!("  join(open, close)={:?}", g.span_open().join(g.span_close())));
                walk_spans(o, g.stream());
            }
            TokenTree::Ident(i) => span_info(o, &format!("ident {i}"), i.span()),
            TokenTree::Punct(p) => span_info(o, &format!("punct {}", p.as_char()), p.span()),
            TokenTree::Literal(l) => {
                span_info(o, &format!("literal {l}"), l.span());
                o.push(format!(
                    "  subspan(1..2)={:?} subspan(..)={:?} subspan(1..=1)={:?} subspan(0..0)={:?} subspan(..100)={:?}",
                    l.subspan(1..2),
                    l.subspan(..),
                    l.subspan(1..=1),
                    l.subspan(0..0),
                    l.subspan(..100),
                ));
                o.push(format!("  resolved_at(call_site)={:?}", l.span().resolved_at(Span::call_site())));
            }
        }
    }
}

/// `ts_into_trees` on the input, the rebuilt stream's `ts_to_string` and `ts_into_trees`.
#[proc_macro]
pub fn probe(input: TokenStream) -> TokenStream {
    let mut o = Out::new();
    o.push(format!("input {:#?}", input));
    o.push(format!("input.to_string() {:?}", input.to_string()));
    o.push(format!("is_empty {}", input.is_empty()));
    let rebuilt = rebuild(input.clone());
    o.push(format!("rebuilt.to_string() {:?}", rebuilt.to_string()));
    o.push(format!("rebuilt {:#?}", rebuilt));
    o.flush();
    TokenStream::new()
}

/// Span queries on every token tree of the input.
#[proc_macro]
pub fn spans(input: TokenStream) -> TokenStream {
    let mut o = Out::new();
    walk_spans(&mut o, input.clone());
    let mut it = input.into_iter();
    if let (Some(a), Some(b)) = (it.next(), it.last()) {
        o.push(format!("join(first, last)={:?}", a.span().join(b.span())));
        o.push(format!("join(last, first)={:?}", b.span().join(a.span())));
        o.push(format!("join(first, call_site)={:?}", a.span().join(Span::call_site())));
    }
    o.flush();
    TokenStream::new()
}

/// The string value of the single string-literal argument of `lit!` / `stream!`.
fn str_arg(input: TokenStream) -> String {
    match input.into_iter().next() {
        Some(TokenTree::Literal(l)) => l.str_value().unwrap(),
        _ => panic!("expected a string literal"),
    }
}

/// `literal_from_str` (+ the parsed literal back through `ts_from_token_tree`).
#[proc_macro]
pub fn lit(input: TokenStream) -> TokenStream {
    let mut o = Out::new();
    let s = str_arg(input);
    match s.parse::<Literal>() {
        Ok(l) => {
            o.push(format!("lit {s:?} -> {l:?}"));
            let ts = TokenStream::from(TokenTree::Literal(l));
            o.push(format!("  stream {:?} {:?}", ts.to_string(), ts));
        }
        Err(e) => o.push(format!("lit {s:?} -> Err({e:?})")),
    }
    o.flush();
    TokenStream::new()
}

/// `ts_from_str`.
#[proc_macro]
pub fn stream(input: TokenStream) -> TokenStream {
    let mut o = Out::new();
    let s = str_arg(input);
    match s.parse::<TokenStream>() {
        Ok(ts) => o.push(format!("stream {s:?} -> {:?} {ts:#?}", ts.to_string())),
        Err(e) => o.push(format!("stream {s:?} -> Err({e:?})")),
    }
    o.flush();
    TokenStream::new()
}

/// Token trees built on the client side (whose bridge values are known), concatenated with
/// `ts_concat_trees` / `ts_concat_streams` (gluing) and converted back with `ts_into_trees`.
#[proc_macro]
pub fn construct(input: TokenStream) -> TokenStream {
    let mut o = Out::new();
    let sp = input.into_iter().next().map(|t| t.span()).unwrap_or(Span::call_site());
    let p = |c, s| TokenTree::Punct(Punct::new(c, s));
    let i = |s: &str| TokenTree::Ident(Ident::new(s, sp));
    let show = |o: &mut Out, name: &str, ts: TokenStream| {
        o.push(format!("{name} {:?} {:#?}", ts.to_string(), ts));
    };
    let ts: TokenStream = [p('+', Spacing::Joint), p('=', Spacing::Alone), i("a")].into_iter().collect();
    show(&mut o, "glue +=", ts);
    let ts: TokenStream = [p('<', Spacing::Joint), p('<', Spacing::Joint), p('=', Spacing::Joint), p('>', Spacing::Alone)]
        .into_iter()
        .collect();
    show(&mut o, "glue <<=>", ts);
    let ts: TokenStream = [p('.', Spacing::Joint), p('.', Spacing::Joint), p('.', Spacing::Joint), p('.', Spacing::Alone)]
        .into_iter()
        .collect();
    show(&mut o, "glue ....", ts);
    let ts: TokenStream =
        [p('\'', Spacing::Joint), i("a"), p(':', Spacing::Joint), p(':', Spacing::Alone), p('#', Spacing::Joint), p('!', Spacing::Alone)]
            .into_iter()
            .collect();
    show(&mut o, "quote ident, ::, #!", ts);
    let ts: TokenStream = [
        TokenTree::Ident(Ident::new_raw("fn", sp)),
        TokenTree::Ident(Ident::new("cafe\u{301}", sp)),
        TokenTree::Ident(Ident::new("\u{212b}ngstr\u{f6}m", sp)),
        TokenTree::Ident(Ident::new("_x9", sp)),
        TokenTree::Ident(Ident::new("$crate", sp)),
    ]
    .into_iter()
    .collect();
    show(&mut o, "idents", ts);
    let mut lits = vec![
        Literal::i32_suffixed(-5),
        Literal::i64_unsuffixed(-7),
        Literal::u8_suffixed(7),
        Literal::f64_unsuffixed(-1.5),
        Literal::f32_suffixed(-2.0),
        Literal::f64_unsuffixed(3.0),
        Literal::usize_unsuffixed(0),
    ];
    for l in &mut lits {
        l.set_span(sp);
    }
    let ts: TokenStream = lits.into_iter().map(TokenTree::Literal).collect();
    show(&mut o, "literals", ts);
    let inner: TokenStream = [i("x"), p('*', Spacing::Alone), i("y")].into_iter().collect();
    let mut groups = vec![
        Group::new(Delimiter::None, inner.clone()),
        Group::new(Delimiter::Parenthesis, inner.clone()),
        Group::new(Delimiter::Bracket, TokenStream::new()),
        Group::new(Delimiter::Brace, inner),
    ];
    for g in &mut groups {
        g.set_span(sp);
    }
    let ts: TokenStream = groups.into_iter().map(TokenTree::Group).collect();
    show(&mut o, "groups", ts);
    // `ts_concat_streams`: the last tree of each stream glues to the first of the next.
    let a: TokenStream = [i("a"), p('-', Spacing::Joint)].into_iter().collect();
    let b: TokenStream = [p('>', Spacing::Alone), i("b"), p('&', Spacing::Joint)].into_iter().collect();
    let c: TokenStream = [p('&', Spacing::Alone)].into_iter().collect();
    let ts: TokenStream = [a.clone(), TokenStream::new(), b.clone(), c.clone()].into_iter().collect();
    show(&mut o, "concat_streams", ts);
    let mut ext = a;
    ext.extend([b, c]);
    show(&mut o, "extend", ext);
    let one: TokenStream = [TokenStream::from(p('?', Spacing::Alone))].into_iter().collect();
    show(&mut o, "concat one", one);
    o.flush();
    TokenStream::new()
}

/// `ts_expand_expr` on the input.
#[proc_macro]
pub fn expand(input: TokenStream) -> TokenStream {
    let mut o = Out::new();
    match input.expand_expr() {
        Ok(ts) => o.push(format!("expand_expr {:?} -> {:?} {:#?}", input.to_string(), ts.to_string(), ts)),
        Err(e) => o.push(format!("expand_expr {:?} -> Err({e:?})", input.to_string())),
    }
    o.flush();
    TokenStream::new()
}

/// `emit_diagnostic`: one diagnostic per level, on the first input token, with children.
#[proc_macro]
pub fn diag(input: TokenStream) -> TokenStream {
    let toks: Vec<TokenTree> = input.into_iter().collect();
    let a = toks[0].span();
    let b = toks[toks.len() - 1].span();
    a.warning("a warning").span_note(b, "a note on the last token").emit();
    a.note("a note").help("some help").emit();
    a.help("top-level help").emit();
    b.error("an error with children")
        .span_error(a, "child error")
        .span_warning(vec![a, b], "child warning on two spans")
        .note("child note without span")
        .span_help(b, "child help")
        .emit();
    proc_macro::Diagnostic::spanned(vec![a, b], proc_macro::Level::Error, "multi-span error").emit();
    TokenStream::new()
}
