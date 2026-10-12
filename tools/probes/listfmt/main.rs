//! Oracle probe for the `DiagArgValue::StrListSepByAnd` path of rustc_error_messages:
//! `icu_locale_core::Locale::try_from_str(&lang.to_string()).ok()` (fallback
//! `rustc_baked_icu_data::supported_locales::EN`), then
//! `icu_list::ListFormatter::try_new_and_unstable(&BakedDataProvider, locale.into(), opts)` and
//! `format_to_string`. src/vendor/icu_list/oracle.test.ts rebuilds every line with the TS port.
//!
//! Tab-separated lines (strings are UTF-8 hex):
//!   L  <list idx> <item hex>...                 the input lists (TS reads them from here)
//!   U  <tag hex> Ok <unic Display> | Err        unic_langid::LanguageIdentifier parse of the tag
//!   P  <input hex> Ok <Locale Display> <DataLocale (make_locale)> <metadata.locale or -> | Err <{:?}>
//!        for every icu input (the raw tags plus every unic Display): `Locale::try_from_str`,
//!        the DataLocale requested by the and-list constructor (Wide), and the locale the baked
//!        provider fell back to (None when the request matched exactly)
//!   F  <input hex> <W|S|N> <list idx> <format_to_string hex>
//!        the rustc construct path (parse error -> EN) with the given ListLength
//!   E  <input hex> <W|S|N> <{:?} of the DataError>   the constructor failed (rustc's `expect` ICEs)
use std::fmt::Write as _;
use std::io::Write;

use icu_list::ListFormatter;
use icu_list::options::{ListFormatterOptions, ListLength};
use icu_list::provider::{ListAndV1, ListFormatterPatterns};
use icu_provider::prelude::*;
use rustc_baked_icu_data::{BakedDataProvider, supported_locales};

fn hex(b: &[u8]) -> String {
    let mut s = String::new();
    for x in b {
        write!(s, "{x:02x}").unwrap();
    }
    s
}

const TAGS: &[&str] = &[
    // rustc_baked_icu_data's supported locales (and the trie keys)
    "en", "es", "fr", "it", "ja", "pt", "ru", "tr", "zh", "zh-Hans", "zh-Hant",
    // regional / scripted variants that go through locale fallback
    "en-US", "en-GB", "en-150", "en-AU", "en-IN", "en-001", "en-Latn-US", "en-Latn", "en-Cyrl",
    "en-fonipa", "en-US-posix", "en-US-fonipa-posix", "en-posix-fonipa",
    "es-AR", "es-419", "es-MX", "es-ES", "es-US", "es-Latn", "pt-BR", "pt-PT", "pt-AO", "pt-MO",
    "fr-CA", "fr-FR", "it-CH", "ja-JP", "ja-Latn", "ru-RU", "ru-UA", "tr-TR", "tr-CY",
    "zh-CN", "zh-TW", "zh-HK", "zh-MO", "zh-SG", "zh-Hans-CN", "zh-Hant-TW", "zh-Hant-MO",
    "zh-Hant-CN", "zh-Hans-TW", "zh-Latn", "zh-US", "yue", "yue-Hans",
    "und", "und-US", "und-Hans", "und-Hant", "und-Latn", "und-fonipa",
    "sr-ME", "sr-Latn", "hi-Latn", "nb", "nn", "no", "no-NO", "ht", "de", "de-AT", "ar", "he",
    "az-IR", "az-Arab", "ku", "abc", "qaa",
    // case normalisation
    "EN-us", "eN-gB", "ZH-hANT-tw", "Es-Ar",
    // valid for unic-langid but not for icu_locale_core (5-8 letter language)
    "abcde", "abcdefgh", "abcde-US",
    // duplicate and unsorted variants (unic sorts and dedups)
    "en-fonipa-fonipa", "en-posix-fonipa-posix", "en-1994", "de-1996-1901",
    // malformed
    "", "-", "e", "en-", "-en", "en--US", "en_US", "1234", "en-US-", "en-a1", "en-123456789",
    "en-Latn-Latn", "en-US-GB", "en-USA", "toolongtag", "en-Latn-US-x", "zh-Hant-TW-Hans",
    "\u{e9}n", "en-\u{c9}",
    // extensions (not produced by unic-langid; the TS port leaves extension parsing unported)
    "en-u-ca-gregory", "en-US-u-sd-usca", "en-u-rg-gbzzzz", "en-x-private", "en-t-de", "en-a-bc",
    "en-u", "en-x",
];

const WORDS: &[&str] = &[
    "a", "b", "", "Ibiza", "Hidalgo", "Hierva", "hielo", "hiato", "hi", "Hi", "HI", "hI", "h",
    "i", "I", "isla", "\u{cd}taca", "\u{ed}ntimo", "yo", "y", "Okinawa", "oso", "ho", "o", "8",
    "8 m\u{e1}s", "11", "110", "11.000", "\u{f6}", "\u{65e5}\u{672c}", "a, b", "a,b", "and",
    "\u{202e}x", "\u{1f980}", "e", " ibiza", "\n",
];

fn lists() -> Vec<Vec<String>> {
    let s = |x: &str| x.to_string();
    let mut v: Vec<Vec<String>> = vec![vec![]];
    for w in WORDS {
        v.push(vec![s(w)]);
    }
    for w in WORDS {
        v.push(vec![s("x"), s(w)]);
    }
    for w in WORDS {
        v.push(vec![s("x"), s("y"), s(w)]);
    }
    for w in WORDS {
        v.push(vec![s(w), s(w), s(w), s(w)]);
    }
    v.push(vec![s("a"), s("b"), s("c"), s("d"), s("e")]);
    v.push(vec![s(""), s(""), s(""), s(""), s("")]);
    v.push(vec![s("Ibiza"), s("Hidalgo"), s("isla"), s("Hierva"), s("ibiza")]);
    v.push(vec![s("a, b"), s("c, and d"), s("e")]);
    v
}

fn main() {
    let out = std::io::stdout();
    let mut out = std::io::BufWriter::new(out.lock());

    let lists = lists();
    for (i, l) in lists.iter().enumerate() {
        let mut line = format!("L\t{i}");
        for item in l {
            write!(line, "\t{}", hex(item.as_bytes())).unwrap();
        }
        writeln!(out, "{line}").unwrap();
    }

    let mut inputs: Vec<String> = Vec::new();
    for tag in TAGS {
        if !inputs.iter().any(|x| x == tag) {
            inputs.push(tag.to_string());
        }
    }
    for tag in TAGS {
        match tag.parse::<unic_langid::LanguageIdentifier>() {
            Ok(l) => {
                let s = l.to_string();
                writeln!(out, "U\t{}\tOk\t{}", hex(tag.as_bytes()), s).unwrap();
                if !inputs.iter().any(|x| *x == s) {
                    inputs.push(s);
                }
            }
            Err(_) => writeln!(out, "U\t{}\tErr", hex(tag.as_bytes())).unwrap(),
        }
    }

    for input in &inputs {
        let h = hex(input.as_bytes());
        match icu_locale_core::Locale::try_from_str(input) {
            Ok(locale) => {
                let prefs: icu_list::ListFormatterPreferences = (&locale).into();
                let dl = <ListAndV1 as DataMarker>::INFO.make_locale(prefs.locale_preferences);
                let resp = DataProvider::<ListAndV1>::load(
                    &BakedDataProvider,
                    DataRequest {
                        id: DataIdentifierBorrowed::for_marker_attributes_and_locale(
                            ListFormatterPatterns::WIDE,
                            &dl,
                        ),
                        ..Default::default()
                    },
                );
                let md = match resp {
                    Ok(r) => match r.metadata.locale {
                        Some(l) => l.to_string(),
                        None => "-".to_string(),
                    },
                    Err(e) => format!("{e:?}"),
                };
                writeln!(out, "P\t{h}\tOk\t{locale}\t{dl}\t{md}").unwrap();
            }
            Err(e) => writeln!(out, "P\t{h}\tErr\t{e:?}").unwrap(),
        }
        for (lc, len) in [("W", ListLength::Wide), ("S", ListLength::Short), ("N", ListLength::Narrow)] {
            // rustc_error_messages::fluent_value_from_str_list_sep_by_and::MemoizableListFormatter::construct
            let locale = icu_locale_core::Locale::try_from_str(input)
                .ok()
                .unwrap_or_else(|| supported_locales::EN);
            let lf = match ListFormatter::try_new_and_unstable(
                &BakedDataProvider,
                locale.into(),
                ListFormatterOptions::default().with_length(len),
            ) {
                Ok(lf) => lf,
                Err(e) => {
                    // rustc: `.expect("Failed to create list formatter")` (an ICE)
                    writeln!(out, "E\t{h}\t{lc}\t{e:?}").unwrap();
                    continue;
                }
            };
            for (i, l) in lists.iter().enumerate() {
                let s = lf.format_to_string(l.iter());
                writeln!(out, "F\t{h}\t{lc}\t{i}\t{}", hex(s.as_bytes())).unwrap();
            }
        }
    }
}
