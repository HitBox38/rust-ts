//! Oracle probe for inline Fluent diagnostic messages (fluent-syntax 0.12.0, fluent-bundle 0.16.0).
//!   fluentdump parse  <file>...   `{:#?}` of `fluent_syntax::parser::parse("generated_msg = {msg}\n")`
//!   fluentdump format <file>...   `format_fluent_str(msg, args)` (rustc_errors/src/formatting.rs)
//!                                 for a fixed matrix of synthetic argument sets
//!
//! Input: corpus files written by harness/corpus/gen-fluent.ts (format in its header): optional
//! `//` lines, then records of `@ <provenance>` lines, `= <N>`, N bytes of message, `\n`.
//!
//! Output, per file `file: <path>`; per record (index `i` from 0 within the file):
//!   msg <i> <first provenance>
//!   text <message:?>
//! then in `parse` mode the pretty Debug of the parse result (Ok or Err tuple), and in `format` mode
//!   vars [<name:?>, ...]          `$name` references, by a text scan (see `scan_vars`)
//!   keys [<key:?>, ...]           `[key]` variant-key-like text, by a text scan (see `scan_keys`)
//!   args {<name>=<DiagArgValue:?>, ...}
//!   => Ok(<formatted:?>) | => panic <panic message:?>
//! with one `args`/`=>` pair per row of the matrix:
//!   row 0: no arguments at all;
//!   rows 1..=N (only if vars is non-empty): with the value list
//!     V = [Str(<the var's own name>), Number(0), Number(1), Number(2), Number(5), Number(-1),
//!          Str("1.5"), StrListSepByAnd(["a", "b"]), StrListSepByAnd(["a", "b", "c"]),
//!          Str(<key>) for each key]
//!   (N = |V|), var i gets V[(row - 1 + i) % N]. Floats have no `DiagArgValue` variant (rustc passes
//!   them as `Str` via Display), hence `Str("1.5")`.
//! A panic is what rustc would ICE with: `format_fluent_str` unwraps the parse, the bundle and the
//! message lookup, and panics on any formatting error (e.g. an unbound variable in row 0).
//!
//! The functions between `// BEGIN verbatim <path>:<line>` and `// END verbatim` are copied
//! byte-for-byte from the pinned upstream (build.rs checks that each block occurs in that file at
//! that line). They are copied instead of linking `rustc_error_messages`/`rustc_errors` because
//! those need `RUSTC_BOOTSTRAP`/`CFG_RELEASE` in the build env (rustc_macros, rustc_span) and
//! scripts/probes.ts only sets that for symdump. The ICU data is the real thing: a path dependency
//! on the pinned `compiler/rustc_baked_icu_data`.
use std::borrow::Cow;
use std::fmt::Write as _;
use std::io::Write as _;

use fluent_bundle::types::FluentType;
use fluent_bundle::{FluentArgs, FluentResource, FluentValue};
use unic_langid::{LanguageIdentifier, langid};

// The `tracing` macros format_fluent_str uses: they only log and never affect the result.
macro_rules! trace {
    ($($t:tt)*) => {};
}
macro_rules! debug {
    ($($t:tt)*) => {};
}

// BEGIN verbatim compiler/rustc_error_messages/src/lib.rs:13
pub fn register_functions<R, M>(bundle: &mut fluent_bundle::bundle::FluentBundle<R, M>) {
    bundle
        .add_function("STREQ", |positional, _named| match positional {
            [FluentValue::String(a), FluentValue::String(b)] => format!("{}", (a == b)).into(),
            _ => FluentValue::Error,
        })
        .expect("Failed to add a function to the bundle.");
}

// END verbatim

// BEGIN verbatim compiler/rustc_error_messages/src/lib.rs:231
fn icu_locale_from_unic_langid(lang: LanguageIdentifier) -> Option<icu_locale_core::Locale> {
    icu_locale_core::Locale::try_from_str(&lang.to_string()).ok()
}

pub fn fluent_value_from_str_list_sep_by_and(l: Vec<Cow<'_, str>>) -> FluentValue<'_> {
    // Fluent requires 'static value here for its AnyEq usages.
    #[derive(Clone, PartialEq, Debug)]
    struct FluentStrListSepByAnd(Vec<String>);

    impl FluentType for FluentStrListSepByAnd {
        fn duplicate(&self) -> Box<dyn FluentType + Send> {
            Box::new(self.clone())
        }

        fn as_string(&self, intls: &intl_memoizer::IntlLangMemoizer) -> Cow<'static, str> {
            let result = intls
                .with_try_get::<MemoizableListFormatter, _, _>((), |list_formatter| {
                    list_formatter.format_to_string(self.0.iter())
                })
                .unwrap();
            Cow::Owned(result)
        }

        fn as_string_threadsafe(
            &self,
            intls: &intl_memoizer::concurrent::IntlLangMemoizer,
        ) -> Cow<'static, str> {
            let result = intls
                .with_try_get::<MemoizableListFormatter, _, _>((), |list_formatter| {
                    list_formatter.format_to_string(self.0.iter())
                })
                .unwrap();
            Cow::Owned(result)
        }
    }

    struct MemoizableListFormatter(icu_list::ListFormatter);

    impl std::ops::Deref for MemoizableListFormatter {
        type Target = icu_list::ListFormatter;
        fn deref(&self) -> &Self::Target {
            &self.0
        }
    }

    impl intl_memoizer::Memoizable for MemoizableListFormatter {
        type Args = ();
        type Error = ();

        fn construct(lang: LanguageIdentifier, _args: Self::Args) -> Result<Self, Self::Error> {
            let locale = icu_locale_from_unic_langid(lang)
                .unwrap_or_else(|| rustc_baked_icu_data::supported_locales::EN);
            let list_formatter = icu_list::ListFormatter::try_new_and_unstable(
                &rustc_baked_icu_data::BakedDataProvider,
                locale.into(),
                icu_list::options::ListFormatterOptions::default()
                    .with_length(icu_list::options::ListLength::Wide),
            )
            .expect("Failed to create list formatter");

            Ok(MemoizableListFormatter(list_formatter))
        }
    }

    let l = l.into_iter().map(|x| x.into_owned()).collect();

    FluentValue::Custom(Box::new(FluentStrListSepByAnd(l)))
}
// END verbatim

// BEGIN verbatim compiler/rustc_error_messages/src/lib.rs:300
/// Simplified version of `FluentArg` that can implement `Encodable` and `Decodable`. Collection of
/// `DiagArg` are converted to `FluentArgs` (consuming the collection) at the start of diagnostic
/// emission.
pub type DiagArg<'iter> = (&'iter DiagArgName, &'iter DiagArgValue);

/// Name of a diagnostic argument.
pub type DiagArgName = Cow<'static, str>;

/// Simplified version of `FluentValue` that can implement `Encodable` and `Decodable`. Converted
/// to a `FluentValue` by the emitter to be used in diagnostic translation.
// END verbatim
#[derive(Clone, Debug)] // PORT: upstream also derives PartialEq, Eq, Hash, Encodable, Decodable (unused here)
// BEGIN verbatim compiler/rustc_error_messages/src/lib.rs:311
pub enum DiagArgValue {
    Str(Cow<'static, str>),
    // This gets converted to a `FluentNumber`, which is an `f64`. An `i32`
    // safely fits in an `f64`. Any integers bigger than that will be converted
    // to strings in `into_diag_arg` and stored using the `Str` variant.
    Number(i32),
    StrListSepByAnd(Vec<Cow<'static, str>>),
}

/// A mapping from diagnostic argument names to their values.
/// This contains all the arguments necessary to format a diagnostic message.
// END verbatim
pub type DiagArgMap = indexmap::IndexMap<DiagArgName, DiagArgValue>; // PORT: upstream FxIndexMap; iteration (= insertion) order does not depend on the hasher

// BEGIN verbatim compiler/rustc_error_messages/src/lib.rs:344
impl From<DiagArgValue> for FluentValue<'static> {
    fn from(val: DiagArgValue) -> Self {
        match val {
            DiagArgValue::Str(s) => From::from(s),
            DiagArgValue::Number(n) => From::from(n),
            DiagArgValue::StrListSepByAnd(l) => fluent_value_from_str_list_sep_by_and(l),
        }
    }
}
// END verbatim

// BEGIN verbatim compiler/rustc_errors/src/formatting.rs:10
/// Convert diagnostic arguments (a rustc internal type that exists to implement
/// `Encodable`/`Decodable`) into `FluentArgs` which is necessary to perform formatting.
fn to_fluent_args<'iter>(iter: impl Iterator<Item = DiagArg<'iter>>) -> FluentArgs<'static> {
    let mut args = if let Some(size) = iter.size_hint().1 {
        FluentArgs::with_capacity(size)
    } else {
        FluentArgs::new()
    };

    for (k, v) in iter {
        args.set(k.clone(), v.clone());
    }

    args
}
// END verbatim

// BEGIN verbatim compiler/rustc_errors/src/formatting.rs:39
fn format_fluent_str(message: &str, args: &DiagArgMap) -> Cow<'static, str> {
    trace!(?message, ?args);
    const GENERATED_MSG_ID: &str = "generated_msg";
    let resource = FluentResource::try_new(format!("{GENERATED_MSG_ID} = {message}\n")).unwrap();
    let mut bundle = fluent_bundle::FluentBundle::new(vec![langid!("en-US")]);
    bundle.set_use_isolating(false);
    bundle.add_resource(resource).unwrap();
    register_functions(&mut bundle);
    let message = bundle.get_message(GENERATED_MSG_ID).unwrap();
    let value = message.value().unwrap();
    let args = to_fluent_args(args.iter());

    let mut errs = vec![];
    let formatted = bundle.format_pattern(value, Some(&args), &mut errs).to_string();
    debug!(?formatted, ?errs);
    if errs.is_empty() {
        Cow::Owned(formatted)
    } else {
        panic!("Fluent errors while formatting message: {errs:?}");
    }
}
// END verbatim

// ---- corpus reading and output (mirrored by src/rust_ts/fluentdump.ts) -------------------------

struct Record {
    provenance: Vec<String>,
    message: String,
}

fn read_records(bytes: &[u8]) -> Vec<Record> {
    let mut out = vec![];
    let mut provenance = vec![];
    let mut pos = 0;
    while pos < bytes.len() {
        let end = bytes[pos..].iter().position(|&b| b == b'\n').map_or(bytes.len(), |i| pos + i);
        let line = std::str::from_utf8(&bytes[pos..end]).expect("corpus line is not UTF-8");
        pos = end + 1;
        if line.is_empty() || line.starts_with("//") {
            continue;
        } else if let Some(p) = line.strip_prefix("@ ") {
            provenance.push(p.to_string());
        } else if let Some(n) = line.strip_prefix("= ") {
            let n: usize = n.parse().expect("bad record length");
            assert!(!provenance.is_empty(), "record without provenance");
            assert!(pos + n < bytes.len() && bytes[pos + n] == b'\n', "bad record terminator");
            let message = String::from_utf8(bytes[pos..pos + n].to_vec()).expect("message is not UTF-8");
            pos += n + 1;
            out.push(Record { provenance: std::mem::take(&mut provenance), message });
        } else {
            panic!("bad corpus line {line:?}");
        }
    }
    assert!(provenance.is_empty(), "provenance without record");
    out
}

/// Names after `$` (an ASCII letter, then ASCII letters, digits, `_`, `-`), in order of first
/// appearance, deduplicated. A text scan, independent of the parser under test.
fn scan_vars(msg: &str) -> Vec<String> {
    let b = msg.as_bytes();
    let mut out: Vec<String> = vec![];
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'$' && i + 1 < b.len() && b[i + 1].is_ascii_alphabetic() {
            let start = i + 1;
            let mut j = start;
            while j < b.len() && (b[j].is_ascii_alphanumeric() || b[j] == b'_' || b[j] == b'-') {
                j += 1;
            }
            let name = &msg[start..j];
            if !out.iter().any(|n| n == name) {
                out.push(name.to_string());
            }
            i = j;
        } else {
            i += 1;
        }
    }
    out
}

/// Texts `k` of `[ k ]` (spaces/tabs allowed around `k`; `k` a non-empty run of ASCII letters,
/// digits, `_`, `-`, `.`), in order of first appearance, deduplicated: candidate variant keys, so
/// string selectors (`[true]`, `[struct]`, ...) get a matching value.
fn scan_keys(msg: &str) -> Vec<String> {
    let b = msg.as_bytes();
    let mut out: Vec<String> = vec![];
    for i in 0..b.len() {
        if b[i] != b'[' {
            continue;
        }
        let mut j = i + 1;
        while j < b.len() && (b[j] == b' ' || b[j] == b'\t') {
            j += 1;
        }
        let start = j;
        while j < b.len() && (b[j].is_ascii_alphanumeric() || b[j] == b'_' || b[j] == b'-' || b[j] == b'.') {
            j += 1;
        }
        let end = j;
        while j < b.len() && (b[j] == b' ' || b[j] == b'\t') {
            j += 1;
        }
        if end > start && j < b.len() && b[j] == b']' {
            let key = &msg[start..end];
            if !out.iter().any(|k| k == key) {
                out.push(key.to_string());
            }
        }
    }
    out
}

fn value_list(var: &str, keys: &[String]) -> Vec<DiagArgValue> {
    let list = |l: &[&'static str]| DiagArgValue::StrListSepByAnd(l.iter().map(|s| Cow::Borrowed(*s)).collect());
    let mut v = vec![
        DiagArgValue::Str(Cow::Owned(var.to_string())),
        DiagArgValue::Number(0),
        DiagArgValue::Number(1),
        DiagArgValue::Number(2),
        DiagArgValue::Number(5),
        DiagArgValue::Number(-1),
        DiagArgValue::Str(Cow::Borrowed("1.5")),
        list(&["a", "b"]),
        list(&["a", "b", "c"]),
    ];
    v.extend(keys.iter().map(|k| DiagArgValue::Str(Cow::Owned(k.clone()))));
    v
}

fn arg_rows(vars: &[String], keys: &[String]) -> Vec<DiagArgMap> {
    let mut rows = vec![DiagArgMap::default()];
    if vars.is_empty() {
        return rows;
    }
    let lists: Vec<Vec<DiagArgValue>> = vars.iter().map(|v| value_list(v, keys)).collect();
    let n = lists[0].len();
    for row in 0..n {
        let mut args = DiagArgMap::default();
        for (i, var) in vars.iter().enumerate() {
            args.insert(Cow::Owned(var.clone()), lists[i][(row + i) % n].clone());
        }
        rows.push(args);
    }
    rows
}

fn panic_message(p: &(dyn std::any::Any + Send)) -> String {
    if let Some(s) = p.downcast_ref::<String>() {
        s.clone()
    } else if let Some(s) = p.downcast_ref::<&str>() {
        s.to_string()
    } else {
        "<non-string panic payload>".to_string()
    }
}

fn format_record(out: &mut String, msg: &str) {
    let vars = scan_vars(msg);
    let keys = scan_keys(msg);
    writeln!(out, "vars {vars:?}").unwrap();
    writeln!(out, "keys {keys:?}").unwrap();
    for args in arg_rows(&vars, &keys) {
        let shown: Vec<String> = args.iter().map(|(k, v)| format!("{k}={v:?}")).collect();
        writeln!(out, "args {{{}}}", shown.join(", ")).unwrap();
        match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| format_fluent_str(msg, &args))) {
            Ok(s) => writeln!(out, "=> Ok({s:?})").unwrap(),
            Err(p) => writeln!(out, "=> panic {:?}", panic_message(&*p)).unwrap(),
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (mode, files) = args.split_first().expect("usage: fluentdump parse|format <file>...");
    let format = match mode.as_str() {
        "parse" => false,
        "format" => true,
        _ => panic!("unknown mode {mode:?}"),
    };
    // Panics inside format_fluent_str are caught and printed; keep stderr quiet.
    std::panic::set_hook(Box::new(|_| {}));
    let stdout = std::io::stdout();
    let mut lock = stdout.lock();
    for path in files {
        let bytes = std::fs::read(path).unwrap();
        let mut out = format!("file: {path}\n");
        for (i, rec) in read_records(&bytes).iter().enumerate() {
            writeln!(out, "msg {i} {}", rec.provenance[0]).unwrap();
            writeln!(out, "text {:?}", rec.message).unwrap();
            if format {
                format_record(&mut out, &rec.message);
            } else {
                let source = format!("generated_msg = {}\n", rec.message);
                writeln!(out, "{:#?}", fluent_syntax::parser::parse(source.as_str())).unwrap();
            }
        }
        lock.write_all(out.as_bytes()).unwrap();
    }
}
