//! Oracle probe for rustc-literal-escaper.
//!   escapes <file>...   for every quoted literal token (found with rustc_lexer, exactly as
//!                       lexdump tokenizes), the result of the matching unescape function
//!
//! Per file: `file: <path>`. Per terminated literal, its content (without prefix/quotes/hashes/
//! suffix, as rustc_parse's `cook_quoted` slices it):
//!   L <start> <Mode:?> <prefix_noraw:?> <in_double_quotes>
//!   U <result>                                  (Char/Byte: unescape_char/unescape_byte)
//!   U <lo>..<hi> <result> <lo>..<hi> <result>...  (strings: unescape_*/check_raw_* callbacks)
//!   E <lo>..<hi> <EscapeError:?> <is_fatal>     (one per check_for_errors callback)
//! Unterminated literals (a fatal lexer error in rustc) are skipped.
use std::fmt::Write as _;
use std::io::Write;

use rustc_lexer::{FrontmatterAllowed, LiteralKind, TokenKind, strip_shebang, tokenize};
use rustc_literal_escaper::{
    Mode, check_for_errors, check_raw_byte_str, check_raw_c_str, check_raw_str, unescape_byte,
    unescape_byte_str, unescape_c_str, unescape_char, unescape_str,
};

fn dump(out: &mut String, start: usize, mode: Mode, content: &str) {
    writeln!(out, "L {start} {mode:?} {:?} {}", mode.prefix_noraw(), mode.in_double_quotes()).unwrap();
    out.push('U');
    match mode {
        Mode::Char => write!(out, " {:?}", unescape_char(content)).unwrap(),
        Mode::Byte => write!(out, " {:?}", unescape_byte(content)).unwrap(),
        Mode::Str => unescape_str(content, |r, res| write!(out, " {r:?} {res:?}").unwrap()),
        Mode::ByteStr => unescape_byte_str(content, |r, res| write!(out, " {r:?} {res:?}").unwrap()),
        Mode::CStr => unescape_c_str(content, |r, res| write!(out, " {r:?} {res:?}").unwrap()),
        Mode::RawStr => check_raw_str(content, |r, res| write!(out, " {r:?} {res:?}").unwrap()),
        Mode::RawByteStr => check_raw_byte_str(content, |r, res| write!(out, " {r:?} {res:?}").unwrap()),
        Mode::RawCStr => check_raw_c_str(content, |r, res| write!(out, " {r:?} {res:?}").unwrap()),
    }
    out.push('\n');
    check_for_errors(content, mode, |r, err| {
        writeln!(out, "E {r:?} {err:?} {}", err.is_fatal()).unwrap();
    });
}

fn main() {
    let stdout = std::io::stdout();
    let mut out = std::io::BufWriter::new(stdout.lock());
    let mut buf = String::new();
    for path in std::env::args().skip(1) {
        let bytes = std::fs::read(&path).unwrap();
        let Ok(src) = std::str::from_utf8(&bytes) else {
            writeln!(out, "file: {path}\nnot utf-8").unwrap();
            continue;
        };
        writeln!(out, "file: {path}").unwrap();
        let src = &src[strip_shebang(src).unwrap_or(0)..];
        let mut pos = 0usize;
        for tok in tokenize(src, FrontmatterAllowed::Yes) {
            let start = pos;
            pos += tok.len as usize;
            let TokenKind::Literal { kind, suffix_start } = tok.kind else { continue };
            // Same prefix/postfix lengths as rustc_parse::lexer::StringReader::cook_lexer_literal.
            let (mode, prefix_len, postfix_len) = match kind {
                LiteralKind::Char { terminated: true } => (Mode::Char, 1, 1),
                LiteralKind::Byte { terminated: true } => (Mode::Byte, 2, 1),
                LiteralKind::Str { terminated: true } => (Mode::Str, 1, 1),
                LiteralKind::ByteStr { terminated: true } => (Mode::ByteStr, 2, 1),
                LiteralKind::CStr { terminated: true } => (Mode::CStr, 2, 1),
                LiteralKind::RawStr { n_hashes: Some(n) } => (Mode::RawStr, 2 + n as usize, 1 + n as usize),
                LiteralKind::RawByteStr { n_hashes: Some(n) } => (Mode::RawByteStr, 3 + n as usize, 1 + n as usize),
                LiteralKind::RawCStr { n_hashes: Some(n) } => (Mode::RawCStr, 3 + n as usize, 1 + n as usize),
                _ => continue,
            };
            let end = start + suffix_start as usize;
            buf.clear();
            dump(&mut buf, start, mode, &src[start + prefix_len..end - postfix_len]);
            out.write_all(buf.as_bytes()).unwrap();
        }
    }
}
