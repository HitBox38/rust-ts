// Oracle generator for `src/rustc_parse_format/lib.test.ts` (not part of the build).
//
// Drives the real `rustc_parse_format::Parser` of the pinned toolchain (rustc-dev component)
// over hand-written edge cases plus deterministic pseudo-random format strings, each parsed in
// several configurations (no snippet; snippet = the string literal as written, `"..."` via
// `{:?}`; raw snippet `r#"..."#`; a mismatching snippet; appended newline; all three modes),
// and prints one JSON object per line. Regenerate with:
//
//   rustc +nightly-2026-10-11 --edition 2024 -O gen.rs -o $RUST_TS_DATA/tmp/hir-def/pf_gen
//   DYLD_LIBRARY_PATH=$(rustc +nightly-2026-10-11 --print sysroot)/lib \
//     $RUST_TS_DATA/tmp/hir-def/pf_gen > cases.jsonl
//
// (`LD_LIBRARY_PATH` / `PATH` instead of `DYLD_LIBRARY_PATH` on Linux / Windows.)
//
// Fields: input, style (null | nr_hashes), snippet (null | string), nl (appended_newline),
// mode, pieces (`{:?}` of the collected `Vec<Piece>`), errors (one line per ParseError, fields
// formatted by `err_line` below: ParseError and Suggestion are not Debug), curarg, arg_places,
// line_spans (`{:?}`), src (is_source_literal).
#![feature(rustc_private)]
extern crate rustc_driver;
extern crate rustc_parse_format;

use rustc_parse_format::{ParseError, ParseMode, Parser, Piece, Suggestion};

fn json_str(s: &str) -> String {
    let mut out = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn sugg(s: &Suggestion) -> String {
    match s {
        Suggestion::None => "None".into(),
        Suggestion::UsePositional => "UsePositional".into(),
        Suggestion::RemoveRawIdent(r) => format!("RemoveRawIdent({r:?})"),
        Suggestion::ReorderFormatParameter(r, s) => format!("ReorderFormatParameter({r:?}, {s:?})"),
        Suggestion::AddMissingColon(r) => format!("AddMissingColon({r:?})"),
        Suggestion::UseRustDebugPrintingMacro => "UseRustDebugPrintingMacro".into(),
    }
}

fn err_line(e: &ParseError) -> String {
    format!(
        "description={:?} note={:?} label={:?} span={:?} secondary_label={:?} suggestion={}",
        e.description,
        e.note,
        e.label,
        e.span,
        e.secondary_label,
        sugg(&e.suggestion)
    )
}

fn run(input: &str, style: Option<usize>, snippet: Option<String>, nl: bool, mode: ParseMode) {
    let mut parser = Parser::new(input, style, snippet.clone(), nl, mode);
    let pieces: Vec<Piece<'_>> = parser.by_ref().collect();
    let errors: Vec<String> = parser.errors.iter().map(err_line).collect();
    let mode_s = match mode {
        ParseMode::Format => "Format",
        ParseMode::InlineAsm => "InlineAsm",
        ParseMode::Diagnostic => "Diagnostic",
    };
    println!(
        "{{\"input\":{},\"style\":{},\"snippet\":{},\"nl\":{},\"mode\":\"{}\",\"pieces\":{},\"errors\":[{}],\"curarg\":{},\"arg_places\":{},\"line_spans\":{},\"src\":{}}}",
        json_str(input),
        style.map_or("null".to_string(), |n| n.to_string()),
        snippet.as_deref().map_or("null".to_string(), json_str),
        nl,
        mode_s,
        json_str(&format!("{pieces:?}")),
        errors.iter().map(|e| json_str(e)).collect::<Vec<_>>().join(","),
        parser.curarg,
        json_str(&format!("{:?}", parser.arg_places)),
        json_str(&format!("{:?}", parser.line_spans)),
        parser.is_source_literal,
    );
}

/// Every configuration of one format string.
fn all(s: &str) {
    run(s, None, None, false, ParseMode::Format);
    // snippet = the literal as written (Debug of a str is a valid string literal)
    run(s, None, Some(format!("{s:?}")), false, ParseMode::Format);
    // raw string snippet, when it can be one
    if !s.contains("\"#") {
        run(s, Some(1), Some(format!("r#\"{s}\"#")), false, ParseMode::Format);
    }
    if !s.contains('"') && !s.contains('\\') {
        run(s, Some(0), Some(format!("r\"{s}\"")), false, ParseMode::Format);
        // a snippet that is the literal without escapes (equal when nothing is escaped)
        run(s, None, Some(format!("\"{s}\"")), false, ParseMode::Format);
    }
    // a respanned (mismatching) snippet
    run(s, None, Some("foo!()".into()), false, ParseMode::Format);
    run(s, Some(2), Some("r##\"nope\"##".into()), false, ParseMode::Format);
    // println!-style appended newline
    let with_nl = format!("{s}\n");
    run(&with_nl, None, None, true, ParseMode::Format);
    run(&with_nl, None, Some(format!("{s:?}")), true, ParseMode::Format);
    if !s.contains("\"#") {
        run(&with_nl, Some(1), Some(format!("r#\"{s}\"#")), true, ParseMode::Format);
    }
    run(s, None, Some(format!("{s:?}")), false, ParseMode::InlineAsm);
    run(s, None, Some(format!("{s:?}")), false, ParseMode::Diagnostic);
}

const CASES: &[&str] = &[
    "", "asdf", "a{{b", "a}}b", "a}}", "}}", "\\}}", "{{", "{{}}", "{{{}}}", "{{{{", "}}}}",
    "{", "}", "{3a}", "{:|}", "{:>>>}", "{18446744073709551616}", "{:18446744073709551616}",
    "{:.18446744073709551616}", "{65535}", "{65536}", "{:65535}", "{:65536}", "{:.65536}", "{99999$}",
    "{}", "\t{}", "{\t", "{3}", "{3:}", "{i}", "{i:}", "{  }", "{ 0 }", "{ a }", "{a }", "{ a}",
    "{3:x}", "{3:>}", "{3:^}", "{3:<}", "{3:0<}", "{3:#?x}", "{3:-}", "{3:+}", "{3:#}", "{:#?}",
    "{:x?}", "{:X?}", "{:#x?}", "{:#X?}", "{:?#}", "{:?x}", "{:?X}", "{:?}", "{:x}", "{:X}",
    "{:o}", "{:b}", "{:e}", "{:E}", "{:p}", "{:10x}", "{:1$}", "{:.2$}", "{:a$.b$s}",
    "{:.*}", "{:.*s}", "{:.*?}", "{:.*}{:.*}{}", "{0:.*}", "{a:.*}", "{:1$.*}",
    "{:width$}", "{:width$.prec$}", "{:.prec$}", "{:_$}", "{:0$}", "{:00$}", "{:0}", "{:05}",
    "{:+05}", "{:-05}", "{:#05x}", "{:#010b}", "{:>8.3}", "{:*^9}", "{:}<}", "{:{<}",
    "{:}>5}", "{:\u{e9}<5}", "{:\u{1f600}^5}", "{:\t<5}", "{:\n<5}", "{:0>5}", "{:<<5}",
    "{3:10.10x}", "{3:.10x}", "{3:.10$x}", "{3:a$.b$x}", "{3:#10.10$}", "{:10.10x?}",
    "{:+#010.5x?}", "{:x?y}", "{:xy}", "{:abc}", "{:_}", "{:_x}", "{_}", "{_x}", "{__}",
    "{r#foo}", "{r#}", "{r#1}", "{r#for}", "{r}", "{r:?}", "{r#foo:?}", "{r #foo}",
    "{foo?}", "{foo:?}", "{foo=}", "{foo =}", "{=}", "{foo,}", "{:,}", "{,}", "{+}", "{+5}",
    "{<}", "{^}", "{>}", "{foo<}", "{foo^5}", "{?}", "{??}", "{?x}", "{?:}", "{?:foo}",
    "{foo.bar}", "{foo.0}", "{foo.bar.baz}", "{foo.bar()}", "{0.bar}", "{foo.}", "{foo.bar",
    "{foo:?.bar}", "{foo.bar:?}", "{self.x}", "{x.y}}", "{x:y}", "{:x:y}",
    "{x", "{x:", "{x:?", "{x:#", "{:", "{:.", "{:.*", "{0", "{0:", "{ ", "{\n}", "{\n",
    "x {} y {} z", "{} {}", "{0} {0}", "{} {1} {}", "{a} {b} {a}", "{} {:?} {:x}",
    "a\nb", "a\n  b", "a\n\tb{}", "  \n  {}\n  ", "\n", "\n\n", "line1\n  line2 {x}\n line3",
    "\u{e9}{}\u{e9}", "\u{1f600}{}", "{\u{e9}}", "{\u{1f600}}", "{:\u{e9}}", "\u{0}{}", "\u{7f}",
    "\\n{}", "\\{}", "\"{}\"", "'{}'", "{'}", "{\"}", "{\\}", "a\\\\{}", "\u{200b}{}",
    "{0:1$.2$x}", "{name:>width$.prec$e}", "{:>1$}", "{:.1$}", "{:1$.1$}", "{:#?}{:#?}",
    "{} }", "{ {", "}{", "}{}", "{}{", "{}}", "{{}", "{}}}", "{{{}", "{0}}", "{a}}}",
    "{:x}}", "{:}}", "{:}}}", "{:{}}", "{:{{}}", "{0:0}", "{0:00}", "{0:0$}",
    "{9}", "{10}", "{0001}", "{1x}", "{1_}", "{_1}", "{a1}", "{a_b}", "{\u{3b1}\u{3b2}}",
    "{\u{0661}}", "{1\u{0661}}", "{:\u{0661}}", "{:1\u{0661}}", "{ \u{a0} }", "{\u{3000}}",
    "{x:?}{y:#?}{z:x?}", "{x=}{y}", "{0:?}{}", "{:.0}", "{:.}", "{:.x}", "{:.$}", "{:$}",
    "{:x$}", "{:1$x}", "{:.a$x}", "{:.a}", "{:a}", "{:a.b}", "{:#}", "{:##}", "{:++}",
    "{:+-}", "{:-+}", "{:0+}", "{:+0}", "{:#0}", "{:0#}", "{:<^}", "{:<<}", "{:^^}",
];

/// A small deterministic LCG (no external crates).
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        self.0 >> 33
    }
    fn pick<'a>(&mut self, xs: &[&'a str]) -> &'a str {
        xs[(self.next() as usize) % xs.len()]
    }
}

const ATOMS: &[&str] = &[
    "{", "}", "{{", "}}", ":", "?", "x", "X", "#", "0", "1", "9", "$", ".", "*", "<", ">", "^",
    "+", "-", "a", "b", "_", "r", " ", "\t", "\n", "=", ",", "\u{e9}", "\u{1f600}", "foo", "12",
    "65536", "\\", "\"", "'", "y$", ".*", "{}", "{:?}", "{0}", "{a}",
];

fn main() {
    for s in CASES {
        all(s);
    }
    let mut rng = Rng(0x5eed_f0f0);
    for _ in 0..150 {
        let n = 1 + (rng.next() % 8) as usize;
        let mut s = String::new();
        for _ in 0..n {
            s.push_str(rng.pick(ATOMS));
        }
        all(&s);
    }
}
