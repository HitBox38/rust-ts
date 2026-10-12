//! Oracle probe for intl_pluralrules (=7.0.2) and unic-langid (=0.9.6, `likelysubtags` on).
//! Prints tab-separated lines; src/vendor/intl_pluralrules/oracle.test.ts rebuilds every line
//! with the TS port (it reads the inputs from the `I`/`T` lines) and compares.
//!
//!   V  <intl_pluralrules CLDR_VERSION> <likelysubtags CLDR_VERSION>
//!   I  <idx> u64|i64 <decimal>        integer operand
//!   I  <idx> f64 <bits hex> <to_string>  float operand (TryFrom<f64> goes through to_string)
//!   I  <idx> str <utf-8 hex>          string operand
//!   P  <idx> <{:?} of Result<PluralOperands, &str>>
//!   R  C|O <Display> <{:?}> <one char per input: Z O T F M X(other) E(Err)>   for get_locales
//!   T  <tag hex> Ok <Display> <{:?}> <canonicalize> <maximize> <minimize> <direction> <createC> <createO>
//!   T  <tag hex> Err <{:?}> <Display>
//!   S  <Display>                      all parsed tags after `sort()`
//!   M  <i> <j> <4 x 0/1>              matches(i, j, a, b) for (a, b) in FF FT TF TT
use std::convert::TryFrom;
use std::fmt::Write as _;
use std::io::Write;

use intl_pluralrules::operands::PluralOperands;
use intl_pluralrules::{PluralCategory, PluralRuleType, PluralRules};
use unic_langid::LanguageIdentifier;

enum Input {
    U64(u64),
    I64(i64),
    F64(f64),
    Str(String),
}

fn hex(b: &[u8]) -> String {
    let mut s = String::new();
    for x in b {
        write!(s, "{x:02x}").unwrap();
    }
    s
}

fn inputs() -> Vec<Input> {
    let mut v = Vec::new();
    for x in [0u64, 1, 2, 3, 5, 11, 21, 100, 101, 111, 1000, 1_000_000, (1 << 53) + 1, u64::MAX] {
        v.push(Input::U64(x));
    }
    for x in -200i64..=200 {
        v.push(Input::I64(x));
    }
    for x in [1000i64, 1_000_000, 10_000_000, 1 << 53, -(1 << 53) - 1, i64::MAX, i64::MIN, i64::MIN + 1] {
        v.push(Input::I64(x));
    }
    for x in 0..=200 {
        v.push(Input::F64(x as f64));
    }
    for x in [
        0.1, 0.5, 1.5, 2.5, 1.25, 1.01, 0.01, 10.5, 100.5, 1e-7, 1e15, 1e16, 1e21, 123456789.0, -1.0, -0.0,
        -2.5, f64::NAN, f64::INFINITY, f64::NEG_INFINITY, f64::MAX, f64::MIN_POSITIVE, 5e-324,
        0.30000000000000004, 1.1, 2.1, 3.4, 11.11, 0.000123, 1e-5,
    ] {
        v.push(Input::F64(x));
    }
    let strs = [
        "0", "1", "1.0", "1.00", "1.50", "1.5", "-1", "-1.0", "0.0", "2.0", "21", "1.1", "0.1", "1.10",
        "1.010", "100.00", "1e3", "1.5e3", "1E3", "abc", "", "-", "+", ".5", "5.", "+1", "+1.5", "-+1",
        "+-1", "inf", "-inf", "NaN", "nan", "infinity", "INFINITY", "Infinity", "infinit", "--5", "-.5",
        "1 ", " 1", "1,5", "12345678901234567890", "18446744073709551615", "18446744073709551616",
        "99999999999999999999", "1.12345678901234567890", "1.99999999999999999999999", "0.00", "3.14",
        "11", "111", "1000000", "1000000.0", "0x10", "1_000", "\u{661}", "1.0e0", "1e", "1e+", "1e-2",
        "00012", "00.5", "1.", "-0", "-0.0", "1.0.0", "\u{ff11}", "1e400", "1e-400", "5.0000",
        "0.000000000000000000001",
    ];
    for s in strs {
        v.push(Input::Str(s.to_string()));
    }
    for n in [0, 1, 2, 3, 5, 11, 21, 101] {
        for f in ["0", "00", "1", "10", "5", "50", "01", "25", "123", "11", "02"] {
            v.push(Input::Str(format!("{n}.{f}")));
        }
    }
    v
}

fn operands(i: &Input) -> Result<PluralOperands, &'static str> {
    match i {
        Input::U64(x) => Ok(PluralOperands::from(*x)),
        Input::I64(x) => PluralOperands::try_from(*x),
        Input::F64(x) => PluralOperands::try_from(*x),
        Input::Str(s) => PluralOperands::try_from(s.as_str()),
    }
}

fn select(pr: &PluralRules, i: &Input) -> Result<PluralCategory, &'static str> {
    match i {
        Input::U64(x) => pr.select(*x),
        Input::I64(x) => pr.select(*x),
        Input::F64(x) => pr.select(*x),
        Input::Str(s) => pr.select(s.as_str()),
    }
}

fn cat_char(r: Result<PluralCategory, &'static str>) -> char {
    match r {
        Ok(PluralCategory::ZERO) => 'Z',
        Ok(PluralCategory::ONE) => 'O',
        Ok(PluralCategory::TWO) => 'T',
        Ok(PluralCategory::FEW) => 'F',
        Ok(PluralCategory::MANY) => 'M',
        Ok(PluralCategory::OTHER) => 'X',
        Err(_) => 'E',
    }
}

fn tags() -> Vec<Vec<u8>> {
    let strs: &[&str] = &[
        "en", "en-US", "en_US", "EN-us", "eN-lAtN-uS", "und", "und-US", "und-Latn", "", "-", "en-", "-en",
        "e", "eng", "engl", "abcdefgh", "abcdefghi", "en-Latn", "en-latn-us", "en-Latn-US-valencia",
        "en-Latn-US-1abc", "en-abcd", "en-1234", "en-123", "en-12", "en-US-x-private", "ca-ES-valencia",
        "sr-Cyrl-RS", "zh-Hant-TW", "zh-Hans", "pa-PK", "pa", "pa-Guru", "ar", "ar-AF", "ar-US", "ks",
        "ks-Deva", "mn-Mong", "he", "fa", "ur", "yi", "en-nedis-macos", "en-macos-macos", "en-ÁÁÁÁ", "x",
        "root", "i-klingon", "de-DE-1996", "sl-rozaj-biske-1994", "ja-JP-u-ca-japanese", "en--US",
        "en_US_POSIX", "und-Thai-CN", "und-Cyrl-UK", "und-PL", "und-Arab", "und-Arab-FO", "ug-Cyrl",
        "lif-Limb", "gan", "yue-Hans", "unr", "unr-Deva", "tuq", "ng", "klx", "kk-Arab", "en-Cyrl",
        "zh-TW", "nb-NO", "mk", "uk", "it", "pl", "pl-FR", "de-CH", "sr-ME", "en-GB", "es-AR", "fr-FR",
        "de-AT", "en-Latn-DE", "zh-Hans-CN", "sr-Cyrl-SR", "mn-Mong", "abcdefgh-US", "zzzzzzzz",
        "abcdefgh-Latn-US-abcdefgh", "en-US-12345678", "en-US-123456789", "en-US-abc", "en-US-a1b2c",
        "en-US-1a-b", "en-001", "es-419", "es-41", "es-4190", "en-Latn-001", "en-Zzzz", "en-ZZ",
        "en-Qaaa-QM", "naq", "pt", "pt-PT", "pt-BR", "ast", "fil", "sw", "ga", "cy", "ru", "lv", "lt",
        "en-US\0", "en\0", "\0", "en-u", "en-US-u", "en-1", "en-a", "1234", "12", "de-Latf", "de-latf",
        "qaa", "qtz", "und-Zzzz", "und-ZZ", "und-Hant", "und-Hans", "und-Kore", "und-Jpan", "und-419",
        "zh", "zh-HK", "zh-MO", "zh-SG", "ja", "ko", "hi", "bn", "ta", "th", "vi", "tr", "az", "az-Arab",
        "az-IR", "uz-AF", "uz-Arab", "ms-Arab", "pa-Arab", "sd", "sd-Deva", "ku", "ku-Arab", "ckb", "dv",
        "ps", "ug", "ug-Arab", "ff", "ff-Adlm", "rhg", "syr", "nqo", "yi-Hebr", "he-IL", "ar-Latn",
        "aa", "zz", "zzz", "und-AQ", "und-ZZ-x", "mis", "mul", "zxx",
    ];
    let mut v: Vec<Vec<u8>> = strs.iter().map(|s| s.as_bytes().to_vec()).collect();
    v.push(vec![0x65, 0x6e, 0xff]);
    v.push(vec![0x65, 0x6e, 0x2d, 0x80, 0x53]);
    v.push(vec![0xc3, 0xa9, 0x6e]);
    v
}

fn main() {
    let mut out = String::new();
    writeln!(out, "V\t{}\t{}", intl_pluralrules::CLDR_VERSION, unic_langid::likelysubtags::CLDR_VERSION).unwrap();

    let ins = inputs();
    for (idx, i) in ins.iter().enumerate() {
        match i {
            Input::U64(x) => writeln!(out, "I\t{idx}\tu64\t{x}").unwrap(),
            Input::I64(x) => writeln!(out, "I\t{idx}\ti64\t{x}").unwrap(),
            Input::F64(x) => writeln!(out, "I\t{idx}\tf64\t{:016x}\t{}", x.to_bits(), x.to_string()).unwrap(),
            Input::Str(s) => writeln!(out, "I\t{idx}\tstr\t{}", hex(s.as_bytes())).unwrap(),
        }
    }
    for (idx, i) in ins.iter().enumerate() {
        writeln!(out, "P\t{idx}\t{:?}", operands(i)).unwrap();
    }

    for (tag, prt) in [("C", PluralRuleType::CARDINAL), ("O", PluralRuleType::ORDINAL)] {
        for l in PluralRules::get_locales(prt) {
            let pr = PluralRules::create(l.clone(), prt).unwrap();
            let chars: String = ins.iter().map(|i| cat_char(select(&pr, i))).collect();
            writeln!(out, "R\t{tag}\t{l}\t{l:?}\t{chars}").unwrap();
        }
    }

    let mut parsed: Vec<LanguageIdentifier> = Vec::new();
    for t in tags() {
        match LanguageIdentifier::from_bytes(&t) {
            Ok(l) => {
                let canon = match unic_langid::canonicalize(&t) {
                    Ok(s) => format!("Ok({s})"),
                    Err(e) => format!("Err({e:?})"),
                };
                let mut mx = l.clone();
                let mxb = mx.maximize();
                let mut mn = l.clone();
                let mnb = mn.minimize();
                let cc = match PluralRules::create(l.clone(), PluralRuleType::CARDINAL) {
                    Ok(pr) => format!("Ok({})", pr.get_locale()),
                    Err(e) => format!("Err({e})"),
                };
                let co = match PluralRules::create(l.clone(), PluralRuleType::ORDINAL) {
                    Ok(pr) => format!("Ok({})", pr.get_locale()),
                    Err(e) => format!("Err({e})"),
                };
                writeln!(
                    out,
                    "T\t{}\tOk\t{l}\t{l:?}\t{canon}\t{mxb}:{mx}\t{mnb}:{mn}\t{:?}\t{cc}\t{co}",
                    hex(&t),
                    l.character_direction()
                )
                .unwrap();
                parsed.push(l);
            }
            Err(e) => writeln!(out, "T\t{}\tErr\t{e:?}\t{e}", hex(&t)).unwrap(),
        }
    }

    let first: Vec<LanguageIdentifier> = parsed.iter().take(16).cloned().collect();
    for (i, a) in first.iter().enumerate() {
        for (j, b) in first.iter().enumerate() {
            let bits: String = [(false, false), (false, true), (true, false), (true, true)]
                .iter()
                .map(|&(x, y)| if a.matches(b, x, y) { '1' } else { '0' })
                .collect();
            writeln!(out, "M\t{i}\t{j}\t{bits}").unwrap();
        }
    }

    parsed.sort();
    for l in &parsed {
        writeln!(out, "S\t{l}").unwrap();
    }

    std::io::stdout().lock().write_all(out.as_bytes()).unwrap();
}
