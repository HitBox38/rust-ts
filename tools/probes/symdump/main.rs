//! Oracle probe for the rustc_span symbol table (`symbols!` expansion + `Symbol`/`Ident` helpers).
//!   symdump <section>...   prints the named sections, in argument order. If any of them reads
//!                          the symbol interner (NEEDS_GLOBALS), all run inside one
//!                          `create_default_session_globals_then` (edition 2015, no extra
//!                          symbols); otherwise without session globals, so the subject can be
//!                          checked on the interner-free sections before SessionGlobals is ported.
//!
//! Output format (subject side: src/rust_ts/symdump.ts):
//!   == <section>
//!   count       count <PREDEFINED_SYMBOLS_COUNT>
//!   predefined  <i>\t<Symbol::new(i):?>                         for i in 0..PREDEFINED_SYMBOLS_COUNT
//!   kw          <index>\t<name>   every `kw::` constant, sorted by (index, name)
//!   sym         <index>\t<name>   every `sym::` constant (incl. macro_rules, C, f, d), sorted likewise
//!   integer     <n>\t<index>\t<sym::integer(n):?>               (interns past 9: order matters)
//!   letters     <code>\t<sym::ascii_letter_digit(c) index or ->  for every ASCII char
//!   character   <code>\t<index>\t<sym::character(c):?>
//!   predicates  <i>\t<flags>   flags = is_empty is_weak is_path_segment_keyword is_bool_lit
//!                              can_be_raw is_predefined (0/1), for every predefined symbol
//!   editions    per edition: `used_keywords <ed>\t<indices>` and `reserved <ed>\t<indices of
//!               predefined symbols with is_reserved>`
//!   ident       <i>\t<flags>\t<Display>   Ident::with_dummy_span over keywords + a few strings;
//!               flags = is_special is_used_keyword is_unused_keyword is_reserved
//!               is_path_segment_keyword is_raw_guess is_reserved_lifetime is_raw_lifetime_guess
//!               is_numeric
use std::fmt::Write as _;
use std::io::Write;

use rustc_span::edition::ALL_EDITIONS;
use rustc_span::symbol::{PREDEFINED_SYMBOLS_COUNT, Symbol, kw, sym, used_keywords};
use rustc_span::Ident;

mod names {
    include!(concat!(env!("OUT_DIR"), "/names.rs"));
}

fn b(v: bool) -> char {
    if v { '1' } else { '0' }
}

fn names(out: &mut String, list: &[(&str, Symbol)]) {
    let mut v: Vec<(u32, &str)> = list.iter().map(|&(n, s)| (s.as_u32(), n)).collect();
    v.sort();
    for (i, n) in v {
        writeln!(out, "{i}\t{n}").unwrap();
    }
}

/// Strings for the `ident` section beyond the keyword range.
const IDENT_EXTRA: &[&str] = &["main", "'static", "'_", "'a", "'async", "123", "0x1f", "_x", "r", "union", "macro_rules", "raw", "safe", ""];

fn section(out: &mut String, name: &str) {
    writeln!(out, "== {name}").unwrap();
    match name {
        "count" => writeln!(out, "count {PREDEFINED_SYMBOLS_COUNT}").unwrap(),
        "predefined" => {
            for i in 0..PREDEFINED_SYMBOLS_COUNT {
                writeln!(out, "{i}\t{:?}", Symbol::new(i)).unwrap();
            }
        }
        "kw" => names(out, names::KW),
        "sym" => {
            let mut all = names::SYM.to_vec();
            all.extend([("macro_rules", sym::macro_rules), ("C", sym::C), ("f", sym::f), ("d", sym::d)]);
            names(out, &all);
        }
        "integer" => {
            for n in 0..=20usize {
                let s = sym::integer(n);
                writeln!(out, "{n}\t{}\t{s:?}", s.as_u32()).unwrap();
            }
            macro_rules! int {
                ($($e:expr),*) => {$({
                    let n = $e;
                    let s = sym::integer(n);
                    writeln!(out, "{n}\t{}\t{s:?}", s.as_u32()).unwrap();
                })*};
            }
            int!(100u32, 7u8, 9i64, -1i32, -10i64, u32::MAX, u64::MAX, i64::MIN, u128::MAX, i128::MIN, 15usize);
        }
        "letters" => {
            for c in 0u8..128 {
                match sym::ascii_letter_digit(c as char) {
                    Some(s) => writeln!(out, "{c}\t{}", s.as_u32()).unwrap(),
                    None => writeln!(out, "{c}\t-").unwrap(),
                }
            }
        }
        "character" => {
            for c in ['a', 'Z', '5', '_', '$', 'é', '中', '\u{1F600}', '\0', '\n', '"', '\'', '\u{7f}', '\u{200b}'] {
                let s = sym::character(c);
                writeln!(out, "{}\t{}\t{s:?}", c as u32, s.as_u32()).unwrap();
            }
        }
        "predicates" => {
            for i in 0..PREDEFINED_SYMBOLS_COUNT {
                let s = Symbol::new(i);
                let f = [s.is_empty(), s.is_weak(), s.is_path_segment_keyword(), s.is_bool_lit(), s.can_be_raw(), Symbol::is_predefined(i)];
                writeln!(out, "{i}\t{}", f.iter().map(|&v| b(v)).collect::<String>()).unwrap();
            }
        }
        "editions" => {
            for &ed in ALL_EDITIONS {
                let used: Vec<String> = used_keywords(|| ed).iter().map(|s| s.as_u32().to_string()).collect();
                writeln!(out, "used_keywords {ed}\t{}", used.join(" ")).unwrap();
                let reserved: Vec<String> = (0..PREDEFINED_SYMBOLS_COUNT)
                    .filter(|&i| Symbol::new(i).is_reserved(|| ed))
                    .map(|i| i.to_string())
                    .collect();
                writeln!(out, "reserved {ed}\t{}", reserved.join(" ")).unwrap();
            }
        }
        "ident" => {
            let mut syms: Vec<Symbol> = (0..=kw::Yeet.as_u32()).map(Symbol::new).collect();
            syms.extend(IDENT_EXTRA.iter().map(|s| Symbol::intern(s)));
            for s in syms {
                let id = Ident::with_dummy_span(s);
                let f = [
                    id.is_special(),
                    id.is_used_keyword(),
                    id.is_unused_keyword(),
                    id.is_reserved(),
                    id.is_path_segment_keyword(),
                    id.is_raw_guess(),
                    id.is_reserved_lifetime(),
                    id.is_raw_lifetime_guess(),
                    id.is_numeric(),
                ];
                writeln!(out, "{}\t{}\t{id}", s.as_u32(), f.iter().map(|&v| b(v)).collect::<String>()).unwrap();
            }
        }
        _ => {
            eprintln!("symdump: unknown section {name:?}");
            std::process::exit(2);
        }
    }
}

/// Sections that read the symbol interner (must match NEEDS_GLOBALS in the subject).
const NEEDS_GLOBALS: &[&str] = &["predefined", "integer", "character", "ident"];

fn main() {
    let sections: Vec<String> = std::env::args().skip(1).collect();
    let mut out = String::new();
    let all = |out: &mut String| {
        for name in &sections {
            section(out, name);
        }
    };
    if sections.iter().any(|s| NEEDS_GLOBALS.contains(&s.as_str())) {
        rustc_span::create_default_session_globals_then(|| all(&mut out));
    } else {
        all(&mut out);
    }
    std::io::stdout().lock().write_all(out.as_bytes()).unwrap();
}
