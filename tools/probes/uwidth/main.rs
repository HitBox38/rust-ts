//! Oracle probe for unicode-width (=0.2.2, the version rustc_span uses).
//!   uwidth   JSON: {"unicode_version":"(17, 0, 0)","width":[[lo,hi,w],...],"width_cjk":[...]}
//! Runs of consecutive scalar values (surrogates excluded) with the same
//! `UnicodeWidthChar::width` / `width_cjk` result; `w` is -1 for `None`.
use std::fmt::Write as _;
use std::io::Write;

use unicode_width::UnicodeWidthChar;

fn runs(out: &mut String, name: &str, f: fn(char) -> Option<usize>) {
    write!(out, "\"{name}\":[").unwrap();
    let mut first = true;
    let mut cur: Option<(u32, u32, i64)> = None;
    for c in (0..=0x10FFFFu32).filter_map(char::from_u32) {
        let w = f(c).map_or(-1, |w| w as i64);
        let cp = c as u32;
        match cur {
            Some((lo, hi, cw)) if cw == w && hi + 1 == cp => cur = Some((lo, cp, cw)),
            _ => {
                if let Some((lo, hi, cw)) = cur {
                    if !first {
                        out.push(',');
                    }
                    first = false;
                    write!(out, "[{lo},{hi},{cw}]").unwrap();
                }
                cur = Some((cp, cp, w));
            }
        }
    }
    if let Some((lo, hi, cw)) = cur {
        if !first {
            out.push(',');
        }
        write!(out, "[{lo},{hi},{cw}]").unwrap();
    }
    out.push(']');
}

fn main() {
    let mut out = String::new();
    write!(out, "{{\"unicode_version\":\"{:?}\",", unicode_width::UNICODE_VERSION).unwrap();
    runs(&mut out, "width", UnicodeWidthChar::width);
    out.push(',');
    runs(&mut out, "width_cjk", UnicodeWidthChar::width_cjk);
    out.push_str("}\n");
    std::io::stdout().lock().write_all(out.as_bytes()).unwrap();
}
