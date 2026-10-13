//! Oracle probe for rustc_lexer.
//!   lexdump <file>...      token stream of each file, exactly as rustc_parse drives the lexer
//!   lexdump --unicode      code point ranges for the unicode predicates the lexer uses, plus the
//!                          oracle core library's `char` properties and case mappings (src/std/char.ts)
//!   lexdump --str-case     stdin: one string per line as hex UTF-8 bytes; stdout per line:
//!                          `<str::to_lowercase hex> <str::to_uppercase hex>` (alloc's final-sigma rule)
#![feature(titlecase, case_ignorable)]
use std::io::Write;

use rustc_lexer::{FrontmatterAllowed, strip_shebang, tokenize};
use unicode_properties::UnicodeEmoji;

fn ranges(out: &mut impl Write, name: &str, pred: impl Fn(char) -> bool) {
    write!(out, "\"{name}\":[").unwrap();
    let mut first = true;
    let mut start: Option<u32> = None;
    for cp in 0..=0x110000u32 {
        let hit = char::from_u32(cp).map_or(false, &pred);
        match (hit, start) {
            (true, None) => start = Some(cp),
            (false, Some(s)) => {
                if !first {
                    write!(out, ",").unwrap();
                }
                first = false;
                write!(out, "[{s},{}]", cp - 1).unwrap();
                start = None;
            }
            _ => {}
        }
    }
    write!(out, "]").unwrap();
}

/// `"name":[[cp,a,b,c],...]`: every scalar value whose mapping is not itself, with the mapped
/// chars padded with 0 to three (core::unicode::conversions returns `[char; 3]`).
fn mappings(out: &mut impl Write, name: &str, map: impl Fn(char) -> Vec<char>) {
    write!(out, "\"{name}\":[").unwrap();
    let mut first = true;
    for c in (0..=0x10FFFFu32).filter_map(char::from_u32) {
        let m = map(c);
        if m.len() == 1 && m[0] == c {
            continue;
        }
        assert!(!m.is_empty() && m.len() <= 3);
        if !first {
            write!(out, ",").unwrap();
        }
        first = false;
        write!(out, "[{}", c as u32).unwrap();
        for i in 0..3 {
            write!(out, ",{}", m.get(i).map_or(0, |&x| x as u32)).unwrap();
        }
        write!(out, "]").unwrap();
    }
    write!(out, "]").unwrap();
}

fn main() {
    let stdout = std::io::stdout();
    let mut out = std::io::BufWriter::new(stdout.lock());
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("--unicode") {
        write!(out, "{{\"unicode_version\":\"{:?}\",", unicode_ident::UNICODE_VERSION).unwrap();
        ranges(&mut out, "xid_start", unicode_ident::is_xid_start);
        write!(out, ",").unwrap();
        ranges(&mut out, "xid_continue", unicode_ident::is_xid_continue);
        write!(out, ",").unwrap();
        ranges(&mut out, "emoji_char", |c| c.is_emoji_char());
        write!(out, ",").unwrap();
        // core::fmt Debug escapes these as \u{..} (non-printable or grapheme-extend).
        ranges(&mut out, "debug_escape_unicode", |c| c.escape_debug().to_string().starts_with("\\u{"));
        // core `char` methods (library/core/src/char/methods.rs), evaluated by the oracle's core.
        write!(out, ",\"core_unicode_version\":\"{:?}\"", char::UNICODE_VERSION).unwrap();
        let props: [(&str, fn(char) -> bool); 10] = [
            ("alphabetic", char::is_alphabetic),
            ("numeric", char::is_numeric),
            ("alphanumeric", char::is_alphanumeric),
            ("lowercase", char::is_lowercase),
            ("uppercase", char::is_uppercase),
            ("titlecase", char::is_titlecase),
            ("cased", char::is_cased),
            ("case_ignorable", char::is_case_ignorable),
            ("white_space", char::is_whitespace),
            ("control", char::is_control),
        ];
        for (name, pred) in props {
            write!(out, ",").unwrap();
            ranges(&mut out, name, pred);
        }
        write!(out, ",").unwrap();
        mappings(&mut out, "to_lower", |c| c.to_lowercase().collect());
        write!(out, ",").unwrap();
        mappings(&mut out, "to_upper", |c| c.to_uppercase().collect());
        writeln!(out, "}}").unwrap();
        return;
    }
    if args.first().map(String::as_str) == Some("--str-case") {
        let hex = |s: &str| s.bytes().map(|b| format!("{b:02x}")).collect::<String>();
        for line in std::io::stdin().lines() {
            let line = line.unwrap();
            let bytes: Vec<u8> =
                (0..line.len()).step_by(2).map(|i| u8::from_str_radix(&line[i..i + 2], 16).unwrap()).collect();
            let s = String::from_utf8(bytes).unwrap();
            writeln!(out, "{} {}", hex(&s.to_lowercase()), hex(&s.to_uppercase())).unwrap();
        }
        return;
    }
    for path in args {
        let bytes = std::fs::read(&path).unwrap();
        let Ok(src) = std::str::from_utf8(&bytes) else {
            writeln!(out, "file: {path}\nnot utf-8").unwrap();
            continue;
        };
        let shebang = strip_shebang(src);
        writeln!(out, "file: {path}\nshebang: {shebang:?}").unwrap();
        let src = &src[shebang.unwrap_or(0)..];
        for tok in tokenize(src, FrontmatterAllowed::Yes) {
            writeln!(out, "{tok:?}").unwrap();
        }
    }
}
