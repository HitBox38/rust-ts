//! Oracle probe for unicode-width (=0.2.2, the version rustc_span uses).
//!   uwidth
//!     JSON: {"unicode_version":"(17, 0, 0)","width":[[lo,hi,w],...],"width_cjk":[...]}
//!     Runs of consecutive scalar values (surrogates excluded) with the same
//!     `UnicodeWidthChar::width` / `width_cjk` result; `w` is -1 for `None`.
//!   uwidth patterns <pattern>...
//!     JSON: {"<pattern>":[[lo,hi,w,w_cjk],...],...}
//!     A pattern is a comma-separated list of hex code points and `c`, e.g. `c,FE0F` or
//!     `17D2,c`. For every scalar value c, the string the pattern spells with that c is
//!     measured with `UnicodeWidthStr::width` / `width_cjk`; runs as above.
//!   uwidth strs
//!     stdin: one string per line, as space-separated hex code points (empty line = "").
//!     stdout: `<width> <width_cjk>` per input line.
use std::fmt::Write as _;
use std::io::{BufRead, Write};

use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};

fn runs<T: PartialEq + Copy>(out: &mut String, name: &str, f: impl Fn(char) -> T, show: impl Fn(&mut String, T)) {
    write!(out, "\"{name}\":[").unwrap();
    let mut first = true;
    let mut cur: Option<(u32, u32, T)> = None;
    let mut flush = |out: &mut String, (lo, hi, w): (u32, u32, T), first: &mut bool| {
        if !*first {
            out.push(',');
        }
        *first = false;
        write!(out, "[{lo},{hi},").unwrap();
        show(out, w);
        out.push(']');
    };
    for c in (0..=0x10FFFFu32).filter_map(char::from_u32) {
        let w = f(c);
        let cp = c as u32;
        match cur {
            Some((lo, hi, cw)) if cw == w && hi + 1 == cp => cur = Some((lo, cp, cw)),
            _ => {
                if let Some(r) = cur {
                    flush(out, r, &mut first);
                }
                cur = Some((cp, cp, w));
            }
        }
    }
    if let Some(r) = cur {
        flush(out, r, &mut first);
    }
    out.push(']');
}

fn hex_char(s: &str) -> char {
    char::from_u32(u32::from_str_radix(s, 16).expect("hex code point")).expect("scalar value")
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut out = String::new();
    match args.first().map(String::as_str) {
        None => {
            write!(out, "{{\"unicode_version\":\"{:?}\",", unicode_width::UNICODE_VERSION).unwrap();
            let show = |out: &mut String, w: Option<usize>| write!(out, "{}", w.map_or(-1, |w| w as i64)).unwrap();
            runs(&mut out, "width", UnicodeWidthChar::width, show);
            out.push(',');
            runs(&mut out, "width_cjk", UnicodeWidthChar::width_cjk, show);
            out.push_str("}\n");
        }
        Some("patterns") => {
            out.push('{');
            for (i, pat) in args[1..].iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                let parts: Vec<Option<char>> = pat.split(',').map(|p| if p == "c" { None } else { Some(hex_char(p)) }).collect();
                let spell = |c: char| -> String { parts.iter().map(|p| p.unwrap_or(c)).collect() };
                runs(
                    &mut out,
                    pat,
                    |c| {
                        let s = spell(c);
                        (s.width(), s.width_cjk())
                    },
                    |out, (w, wc)| write!(out, "{w},{wc}").unwrap(),
                );
            }
            out.push_str("}\n");
        }
        Some("strs") => {
            for line in std::io::stdin().lock().lines() {
                let line = line.unwrap();
                let s: String = line.split(' ').filter(|p| !p.is_empty()).map(hex_char).collect();
                writeln!(out, "{} {}", s.width(), s.width_cjk()).unwrap();
            }
        }
        Some(other) => {
            eprintln!("uwidth: unknown mode {other:?}");
            std::process::exit(2);
        }
    }
    std::io::stdout().lock().write_all(out.as_bytes()).unwrap();
}
