//! Oracle probe for rustc_lexer.
//!   lexdump <file>...      token stream of each file, exactly as rustc_parse drives the lexer
//!   lexdump --unicode      code point ranges for the unicode predicates the lexer uses
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
        writeln!(out, "}}").unwrap();
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
