//! Oracle probe for the `emit` suite: runs JSON "diagnostic scripts" through upstream's
//! `DiagCtxt` + `AnnotateSnippetEmitter` and prints the bytes the emitter writes.
//!
//!   emitdump <case.json>...
//!
//! Per case it prints `file: <path>\n`, then everything the emitter wrote (plus `= ...` lines from
//! query ops, interleaved in order), and `\n= no newline at end of output\n` if that output is
//! non-empty and does not end in `\n` (so the next `file:` header starts a line).
//!
//! The subject (src/rust_ts/emitdump.ts) implements exactly the same script semantics against the
//! TS port. Every case runs in fresh session globals with a fresh `SourceMap` and `DiagCtxt`; the
//! `DiagCtxt` is dropped at the end of the case (which emits still-stashed diagnostics).
//!
//! ## Case format (JSON object; unknown keys are an error)
//! - `files`: `[{ "name": "src/main.rs" | "custom": "x", "src": "..." }]`, loaded in order with
//!   `SourceMap::new_source_file`. `name` → `FileName::Real(path_mapping().to_real_filename(
//!   working_dir(), name))` (what upstream's own emitter tests do); `custom` → `FileName::Custom`.
//! - `emitter` (all optional): `source_map` (default true; false → `.sm(None)`), `short_message`,
//!   `ui_testing`, `diagnostic_width` (number or null), `macro_backtrace`, `terminal_url`
//!   (bool → `TerminalUrl::Yes/No`), `theme` ("ascii" | "unicode"), `color` ("never" →
//!   `AutoStream::never`, "always" → `AutoStream::new(_, ColorChoice::AlwaysAnsi)`),
//!   `ignored_directories` (`ignored_directories_in_source_blocks`). A case must set `ui_testing`
//!   or `diagnostic_width`: otherwise the width comes from `termize` (host-dependent).
//!   `track_diagnostics` is never set (its output names this probe's source locations).
//! - `flags` (all optional; defaults are rustc's normal session: warnings on, dedup on):
//!   `can_emit_warnings` (true), `deduplicate_diagnostics` (true), `macro_backtrace` (false),
//!   `eagerly_emit_delayed_bugs` (false). Passed with `DiagCtxt::with_flags`.
//! - `ops`: array, run in order:
//!   - `{"op":"diag", level, msg, args?, code?, span?, labels?, span_labels?, children?,
//!      suggestions?, primary_message?, then?}`: `Diag::new(dcx, level, msg)`, then in this
//!     order: `arg` (each `[name, value]`), `code`, `span`, `span_label` (each `[span, msg]`),
//!     `span_labels` (`{spans, label}`), each child, each suggestion, `primary_message`, and
//!     finally `then`: "emit" (default) | "cancel" | "delay_as_bug" |
//!     `{"stash": StashKey, "span": Span}` (prints `= stash -> some|none`).
//!   - `{"op":"steal_non_err", span, key, then?: "emit"|"cancel"}`: prints `= steal_non_err ->
//!     some|none`; a stolen diag is then emitted or cancelled (default "emit").
//!   - `{"op":"try_steal_modify_and_emit_err", span, key, note: Msg}`: the modifier adds `note`.
//!     Prints `= try_steal_modify_and_emit_err -> some|none`.
//!   - `{"op":"emit_stashed"}`, `{"op":"print_error_count"}`, `{"op":"reset_err_count"}`.
//!   - `{"op":"abort_if_errors"}`.
//!   Emitting (`diag` with then "emit", a stolen diag, `abort_if_errors`) catches the unwinds
//!   rustc_errors raises itself and prints `= FatalError` (`FatalError.raise()`: a `fatal` diag,
//!   `abort_if_errors` with errors) or `= ExplicitBug` (`panic_any(ExplicitBug)`: a `bug` diag).
//!   - `{"op":"query"}`: prints `= err_count N has_errors B has_errors_excluding_lint_errors B`.
//!   - `{"op":"must_teach", code}`: prints `= must_teach E0nnn B`.
//! - Level: "error" | "fatal" | "bug" | "warning" | "force_warning" (`Warning(Some(Forced {
//!   lint_id: None }))`) | "note" | "help" | "failure_note" | "delayed_bug".
//! - Msg: a JSON string → `DiagMessage::Str`; `{"inline": s}` → `DiagMessage::Inline` (Fluent).
//! - Arg value: string → `DiagArgValue::Str`, integer → `Number`, array of strings →
//!   `StrListSepByAnd`.
//! - Span: `"dummy"` → `DUMMY_SP`; `[file, lo, hi]` byte offsets into that file's normalized
//!   source (`SourceFile::src`: BOM removed, CRLF → LF); or `{"file", "find", "nth"?, "len"?}`:
//!   the `nth` (default 0) occurrence of the bytes `find` in that source, `len` bytes long (default
//!   `find`'s length). All spans are `Span::with_root_ctxt(start_pos + lo, start_pos + hi)`.
//! - MultiSpan (children): an array of spans (`MultiSpan::from_spans`), or
//!   `{"primary": [Span], "labels": [[Span, Msg]]}` (`from_spans` + `push_span_label`).
//! - Child: `{"kind", msg, span?}` with kind "note" | "note_once" | "warn" | "help" | "help_once"
//!   (no `span` → `note`/`note_once`/`warn`/`help`/`help_once`; with a `span` MultiSpan →
//!   `span_note`/`span_note_once`/`span_warn`/`span_help`; `help_once` has no span form upstream);
//!   `{"kind":"sub", "level": Sublevel, msg, span?: MultiSpan}` → `Diag::sub` (no span →
//!   `MultiSpan::new()`); `{"kind":"highlighted_note"|"highlighted_help", "parts": [[text, bool]],
//!   span?}` → `highlighted_(span_)note/help` with `StringPart::normal/highlighted`;
//!   `{"kind":"expected_found", "expected_label", "expected": [[text, bool]], "found_label",
//!   "found": [[text, bool]]}` → `note_expected_found` with `DiagStyledString::push`.
//! - Suggestion: `{"kind", msg, applicability, ...}` with kind and fields:
//!   `span_suggestion` / `span_suggestion_verbose` / `span_suggestion_short` /
//!   `span_suggestion_hidden` / `tool_only_span_suggestion` (span, code);
//!   `span_suggestion_with_style` (span, code, style); `span_suggestions` (span, codes);
//!   `span_suggestions_with_style` (span, codes, style); `multipart_suggestion` /
//!   `tool_only_multipart_suggestion` (parts: [[Span, code]]); `multipart_suggestion_with_style`
//!   (parts, style); `multipart_suggestions` (alternatives: [[[Span, code]]]).
//!   Applicability / SuggestionStyle / StashKey / Sublevel use the upstream variant names.
use std::borrow::Cow;
use std::io::{self, Write};
use std::panic::{AssertUnwindSafe, catch_unwind, resume_unwind};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use rustc_errors::annotate_snippet_emitter_writer::AnnotateSnippetEmitter;
use rustc_errors::emitter::OutputTheme;
use rustc_errors::{
    Applicability, AutoStream, ColorChoice, Diag, DiagArgValue, DiagCtxt, DiagCtxtFlags,
    DiagCtxtHandle, DiagMessage, DiagStyledString, EmissionOverride, ErrCode, ExplicitBug,
    FatalErrorMarker,
    Level, MultiSpan, StashKey, StringPart, Sublevel, SuggestionStyle, TerminalUrl,
};
use rustc_span::source_map::{FilePathMapping, SourceMap};
use rustc_span::{BytePos, DUMMY_SP, FileName, SourceFile, Span, create_default_session_globals_then};
use serde_json::{Map, Value};

/// The emitter's `Destination` target: every write lands in one shared buffer, which query ops
/// also append to, so the case output keeps the order of events.
struct Shared(Arc<Mutex<Vec<u8>>>);

impl Write for Shared {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn main() {
    // `ExplicitBug` (a `Bug` diag's emit) unwinds through `panic_any`, which would run the panic
    // hook; it is caught and printed per case, so keep the hook quiet for it only.
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        if !info.payload().is::<ExplicitBug>() {
            default_hook(info)
        }
    }));
    let paths: Vec<String> = std::env::args().skip(1).collect();
    let stdout = io::stdout();
    let mut out = stdout.lock();
    for path in paths {
        let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
        let case: Value = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{path}: {e}"));
        let bytes = create_default_session_globals_then(|| run_case(&path, &case));
        out.write_all(format!("file: {path}\n").as_bytes()).unwrap();
        out.write_all(&bytes).unwrap();
        if !bytes.is_empty() && bytes.last() != Some(&b'\n') {
            out.write_all(b"\n= no newline at end of output\n").unwrap();
        }
    }
    out.flush().unwrap();
}

struct Ctx<'a> {
    path: &'a str,
    files: Vec<Arc<SourceFile>>,
    buf: Arc<Mutex<Vec<u8>>>,
}

impl Ctx<'_> {
    fn fail(&self, what: impl std::fmt::Display) -> ! {
        panic!("{}: {what}", self.path)
    }
    fn print(&self, line: String) {
        let mut b = self.buf.lock().unwrap();
        b.extend_from_slice(line.as_bytes());
        b.push(b'\n');
    }
}

fn obj<'v>(cx: &Ctx<'_>, v: &'v Value, what: &str, allowed: &[&str]) -> &'v Map<String, Value> {
    let Some(o) = v.as_object() else { cx.fail(format!("{what}: expected an object")) };
    for k in o.keys() {
        if !allowed.contains(&k.as_str()) {
            cx.fail(format!("{what}: unknown key {k:?}"));
        }
    }
    o
}

fn get_bool(cx: &Ctx<'_>, o: &Map<String, Value>, k: &str, default: bool) -> bool {
    match o.get(k) {
        None => default,
        Some(Value::Bool(b)) => *b,
        Some(_) => cx.fail(format!("{k}: expected a bool")),
    }
}

fn get_str<'v>(cx: &Ctx<'_>, o: &'v Map<String, Value>, k: &str) -> &'v str {
    match o.get(k) {
        Some(Value::String(s)) => s,
        _ => cx.fail(format!("{k}: expected a string")),
    }
}

fn get_arr<'v>(cx: &Ctx<'_>, v: &'v Value, what: &str) -> &'v Vec<Value> {
    match v {
        Value::Array(a) => a,
        _ => cx.fail(format!("{what}: expected an array")),
    }
}

fn get_usize(cx: &Ctx<'_>, v: &Value, what: &str) -> usize {
    match v.as_u64() {
        Some(n) if n <= u32::MAX as u64 => n as usize,
        _ => cx.fail(format!("{what}: expected a non-negative integer")),
    }
}

fn run_case(path: &str, case: &Value) -> Vec<u8> {
    let buf = Arc::new(Mutex::new(Vec::new()));
    let mut cx = Ctx { path, files: vec![], buf: buf.clone() };
    let case = obj(&cx, case, "case", &["files", "emitter", "flags", "ops"]);

    // Source map and files.
    let sm = Arc::new(SourceMap::new(FilePathMapping::empty()));
    for f in case.get("files").map(|v| get_arr(&cx, v, "files").as_slice()).unwrap_or(&[]) {
        let f = obj(&cx, f, "file", &["name", "custom", "src"]);
        let name = match (f.get("name"), f.get("custom")) {
            (Some(Value::String(n)), None) => FileName::Real(
                sm.path_mapping().to_real_filename(sm.working_dir(), PathBuf::from(n)),
            ),
            (None, Some(Value::String(c))) => FileName::Custom(c.clone()),
            _ => cx.fail("file: exactly one of name/custom"),
        };
        let src = get_str(&cx, f, "src").to_string();
        cx.files.push(sm.new_source_file(name, src));
    }

    // Emitter.
    let empty = Map::new();
    let e = match case.get("emitter") {
        Some(v) => obj(
            &cx,
            v,
            "emitter",
            &[
                "source_map",
                "short_message",
                "ui_testing",
                "diagnostic_width",
                "macro_backtrace",
                "terminal_url",
                "theme",
                "color",
                "ignored_directories",
            ],
        ),
        None => &empty,
    };
    let diagnostic_width = match e.get("diagnostic_width") {
        None | Some(Value::Null) => None,
        Some(v) => Some(get_usize(&cx, v, "diagnostic_width")),
    };
    let ui_testing = get_bool(&cx, e, "ui_testing", false);
    if diagnostic_width.is_none() && !ui_testing {
        cx.fail("emitter: set ui_testing or diagnostic_width (termize width is host-dependent)");
    }
    let shared: Box<dyn Write + Send> = Box::new(Shared(buf.clone()));
    let dst = match e.get("color").map(|v| v.as_str()) {
        None | Some(Some("never")) => AutoStream::never(shared),
        Some(Some("always")) => AutoStream::new(shared, ColorChoice::AlwaysAnsi),
        _ => cx.fail("color: never | always"),
    };
    let theme = match e.get("theme").map(|v| v.as_str()) {
        None | Some(Some("ascii")) => OutputTheme::Ascii,
        Some(Some("unicode")) => OutputTheme::Unicode,
        _ => cx.fail("theme: ascii | unicode"),
    };
    let ignored = match e.get("ignored_directories") {
        None => vec![],
        Some(v) => get_arr(&cx, v, "ignored_directories")
            .iter()
            .map(|d| d.as_str().unwrap_or_else(|| cx.fail("ignored_directories: strings")).to_string())
            .collect(),
    };
    let emitter = AnnotateSnippetEmitter::new(dst)
        .sm(if get_bool(&cx, e, "source_map", true) { Some(sm.clone()) } else { None })
        .short_message(get_bool(&cx, e, "short_message", false))
        .ui_testing(ui_testing)
        .ignored_directories_in_source_blocks(ignored)
        .diagnostic_width(diagnostic_width)
        .macro_backtrace(get_bool(&cx, e, "macro_backtrace", false))
        .terminal_url(if get_bool(&cx, e, "terminal_url", false) { TerminalUrl::Yes } else { TerminalUrl::No })
        .theme(theme);

    // DiagCtxt.
    let fl = match case.get("flags") {
        Some(v) => obj(
            &cx,
            v,
            "flags",
            &["can_emit_warnings", "deduplicate_diagnostics", "macro_backtrace", "eagerly_emit_delayed_bugs"],
        ),
        None => &empty,
    };
    let flags = DiagCtxtFlags {
        can_emit_warnings: get_bool(&cx, fl, "can_emit_warnings", true),
        treat_err_as_bug: None,
        eagerly_emit_delayed_bugs: get_bool(&cx, fl, "eagerly_emit_delayed_bugs", false),
        macro_backtrace: get_bool(&cx, fl, "macro_backtrace", false),
        deduplicate_diagnostics: get_bool(&cx, fl, "deduplicate_diagnostics", true),
        track_diagnostics: false,
    };
    let dcx_owner = DiagCtxt::new(Box::new(emitter)).with_flags(flags);
    let dcx = dcx_owner.handle();

    for op in case.get("ops").map(|v| get_arr(&cx, v, "ops").as_slice()).unwrap_or(&[]) {
        run_op(&cx, dcx, op);
    }
    drop(dcx_owner);
    let b = buf.lock().unwrap().clone();
    b
}

fn run_op(cx: &Ctx<'_>, dcx: DiagCtxtHandle<'_>, op: &Value) {
    let kind = op.get("op").and_then(|v| v.as_str()).unwrap_or_else(|| cx.fail("op: missing \"op\""));
    match kind {
        "diag" => {
            let o = obj(
                cx,
                op,
                "diag",
                &[
                    "op",
                    "level",
                    "msg",
                    "args",
                    "code",
                    "span",
                    "labels",
                    "span_labels",
                    "children",
                    "suggestions",
                    "primary_message",
                    "then",
                ],
            );
            let level = level(cx, get_str(cx, o, "level"));
            let msg = message(cx, o.get("msg").unwrap_or_else(|| cx.fail("diag: missing msg")));
            let mut diag: Diag<'_> = Diag::new(dcx, level, msg);
            build_diag(cx, &mut diag, o);
            match o.get("then") {
                None => catching(cx, || diag.emit()),
                Some(Value::String(s)) if s == "emit" => catching(cx, || diag.emit()),
                Some(Value::String(s)) if s == "cancel" => diag.cancel(),
                Some(Value::String(s)) if s == "delay_as_bug" => {
                    diag.delay_as_bug();
                }
                Some(v @ Value::Object(_)) => {
                    let t = obj(cx, v, "then", &["stash", "span"]);
                    let key = stash_key(cx, get_str(cx, t, "stash"));
                    let span = span(cx, t.get("span").unwrap_or_else(|| cx.fail("stash: span")));
                    let r = diag.stash(span, key);
                    cx.print(format!("= stash -> {}", if r.is_some() { "some" } else { "none" }));
                }
                Some(_) => cx.fail("then: emit | cancel | delay_as_bug | {stash, span}"),
            }
        }
        "steal_non_err" => {
            let o = obj(cx, op, "steal_non_err", &["op", "span", "key", "then"]);
            let span = span(cx, o.get("span").unwrap_or_else(|| cx.fail("steal: span")));
            let key = stash_key(cx, get_str(cx, o, "key"));
            let r = dcx.steal_non_err(span, key);
            cx.print(format!("= steal_non_err -> {}", if r.is_some() { "some" } else { "none" }));
            if let Some(d) = r {
                match o.get("then").map(|v| v.as_str()) {
                    None | Some(Some("emit")) => catching(cx, || d.emit()),
                    Some(Some("cancel")) => d.cancel(),
                    _ => cx.fail("then: emit | cancel"),
                }
            }
        }
        "try_steal_modify_and_emit_err" => {
            let o = obj(cx, op, "try_steal_modify_and_emit_err", &["op", "span", "key", "note"]);
            let span = span(cx, o.get("span").unwrap_or_else(|| cx.fail("steal: span")));
            let key = stash_key(cx, get_str(cx, o, "key"));
            let note = message(cx, o.get("note").unwrap_or_else(|| cx.fail("steal: note")));
            let r = dcx.try_steal_modify_and_emit_err(span, key, |err| {
                err.note(note.clone());
            });
            cx.print(format!(
                "= try_steal_modify_and_emit_err -> {}",
                if r.is_some() { "some" } else { "none" }
            ));
        }
        "emit_stashed" => {
            obj(cx, op, "emit_stashed", &["op"]);
            dcx.emit_stashed_diagnostics();
        }
        "print_error_count" => {
            obj(cx, op, "print_error_count", &["op"]);
            dcx.print_error_count();
        }
        "reset_err_count" => {
            obj(cx, op, "reset_err_count", &["op"]);
            dcx.reset_err_count();
        }
        "abort_if_errors" => {
            obj(cx, op, "abort_if_errors", &["op"]);
            catching(cx, || dcx.abort_if_errors());
        }
        "query" => {
            obj(cx, op, "query", &["op"]);
            cx.print(format!(
                "= err_count {} has_errors {} has_errors_excluding_lint_errors {}",
                dcx.err_count(),
                dcx.has_errors().is_some(),
                dcx.has_errors_excluding_lint_errors().is_some()
            ));
        }
        "must_teach" => {
            let o = obj(cx, op, "must_teach", &["op", "code"]);
            let code = err_code(cx, get_str(cx, o, "code"));
            cx.print(format!("= must_teach {code} {}", dcx.must_teach(code)));
        }
        _ => cx.fail(format!("unknown op {kind:?}")),
    }
}

/// Runs `f`, turning the two unwinds rustc_errors itself raises into a printed line:
/// `FatalError.raise()` (`= FatalError`, e.g. emitting a `Fatal` diag, `abort_if_errors`) and
/// `panic_any(ExplicitBug)` (`= ExplicitBug`, emitting a `Bug` diag). Any other panic propagates.
fn catching(cx: &Ctx<'_>, f: impl FnOnce()) {
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(()) => {}
        Err(payload) if payload.is::<FatalErrorMarker>() => cx.print("= FatalError".to_string()),
        Err(payload) if payload.is::<ExplicitBug>() => cx.print("= ExplicitBug".to_string()),
        Err(payload) => resume_unwind(payload),
    }
}

fn build_diag(cx: &Ctx<'_>, diag: &mut Diag<'_>, o: &Map<String, Value>) {
    if let Some(args) = o.get("args") {
        for a in get_arr(cx, args, "args") {
            let pair = get_arr(cx, a, "arg");
            if pair.len() != 2 {
                cx.fail("arg: [name, value]");
            }
            let name = pair[0].as_str().unwrap_or_else(|| cx.fail("arg name: string")).to_string();
            diag.arg(name, arg_value(cx, &pair[1]));
        }
    }
    if let Some(c) = o.get("code") {
        diag.code(err_code(cx, c.as_str().unwrap_or_else(|| cx.fail("code: string"))));
    }
    if let Some(s) = o.get("span") {
        let spans = get_arr(cx, s, "span").iter().map(|s| span(cx, s)).collect();
        diag.span(MultiSpan::from_spans(spans));
    }
    if let Some(ls) = o.get("labels") {
        for l in get_arr(cx, ls, "labels") {
            let (sp, m) = span_msg(cx, l);
            diag.span_label(sp, m);
        }
    }
    if let Some(sl) = o.get("span_labels") {
        let sl = obj(cx, sl, "span_labels", &["spans", "label"]);
        let spans: Vec<Span> = get_arr(cx, sl.get("spans").unwrap_or_else(|| cx.fail("span_labels: spans")), "spans")
            .iter()
            .map(|s| span(cx, s))
            .collect();
        diag.span_labels(spans, get_str(cx, sl, "label"));
    }
    if let Some(cs) = o.get("children") {
        for c in get_arr(cx, cs, "children") {
            child(cx, diag, c);
        }
    }
    if let Some(ss) = o.get("suggestions") {
        for s in get_arr(cx, ss, "suggestions") {
            suggestion(cx, diag, s);
        }
    }
    if let Some(m) = o.get("primary_message") {
        diag.primary_message(message(cx, m));
    }
}

fn child(cx: &Ctx<'_>, diag: &mut Diag<'_>, c: &Value) {
    let kind = c.get("kind").and_then(|v| v.as_str()).unwrap_or_else(|| cx.fail("child: kind"));
    match kind {
        "note" | "note_once" | "warn" | "help" | "help_once" => {
            let o = obj(cx, c, "child", &["kind", "msg", "span"]);
            let m = message(cx, o.get("msg").unwrap_or_else(|| cx.fail("child: msg")));
            match (kind, o.get("span")) {
                ("note", None) => diag.note(m),
                ("note", Some(s)) => diag.span_note(multispan(cx, s), m),
                ("note_once", None) => diag.note_once(m),
                ("note_once", Some(s)) => diag.span_note_once(multispan(cx, s), m),
                ("warn", None) => diag.warn(m),
                ("warn", Some(s)) => diag.span_warn(multispan(cx, s), m),
                ("help", None) => diag.help(m),
                ("help", Some(s)) => diag.span_help(multispan(cx, s), m),
                ("help_once", None) => diag.help_once(m),
                _ => cx.fail(format!("child {kind}: no span form")),
            };
        }
        "sub" => {
            let o = obj(cx, c, "child", &["kind", "level", "msg", "span"]);
            let level = match get_str(cx, o, "level") {
                "Error" => Sublevel::Error,
                "Warning" => Sublevel::Warning,
                "Note" => Sublevel::Note,
                "OnceNote" => Sublevel::OnceNote,
                "Help" => Sublevel::Help,
                "OnceHelp" => Sublevel::OnceHelp,
                l => cx.fail(format!("bad Sublevel {l:?}")),
            };
            let m = message(cx, o.get("msg").unwrap_or_else(|| cx.fail("sub: msg")));
            let ms = match o.get("span") {
                Some(s) => multispan(cx, s),
                None => MultiSpan::new(),
            };
            diag.sub(level, m, ms);
        }
        "highlighted_note" | "highlighted_help" => {
            let o = obj(cx, c, "child", &["kind", "parts", "span"]);
            let parts = string_parts(cx, o.get("parts").unwrap_or_else(|| cx.fail("parts")));
            match (kind, o.get("span")) {
                ("highlighted_note", None) => diag.highlighted_note(parts),
                ("highlighted_note", Some(s)) => diag.highlighted_span_note(multispan(cx, s), parts),
                ("highlighted_help", None) => diag.highlighted_help(parts),
                (_, Some(s)) => diag.highlighted_span_help(multispan(cx, s), parts),
                _ => unreachable!(),
            };
        }
        "expected_found" => {
            let o = obj(cx, c, "child", &["kind", "expected_label", "expected", "found_label", "found"]);
            let styled = |k: &str| {
                let mut s = DiagStyledString::new();
                for p in string_parts_raw(cx, o.get(k).unwrap_or_else(|| cx.fail(k))) {
                    s.push(p.0, p.1);
                }
                s
            };
            diag.note_expected_found(
                get_str(cx, o, "expected_label"),
                styled("expected"),
                get_str(cx, o, "found_label"),
                styled("found"),
            );
        }
        _ => cx.fail(format!("unknown child kind {kind:?}")),
    }
}

fn suggestion(cx: &Ctx<'_>, diag: &mut Diag<'_>, s: &Value) {
    let kind = s.get("kind").and_then(|v| v.as_str()).unwrap_or_else(|| cx.fail("suggestion: kind"));
    let o = obj(
        cx,
        s,
        "suggestion",
        &["kind", "msg", "applicability", "span", "code", "codes", "style", "parts", "alternatives"],
    );
    let m = message(cx, o.get("msg").unwrap_or_else(|| cx.fail("suggestion: msg")));
    let app = match get_str(cx, o, "applicability") {
        "MachineApplicable" => Applicability::MachineApplicable,
        "MaybeIncorrect" => Applicability::MaybeIncorrect,
        "HasPlaceholders" => Applicability::HasPlaceholders,
        "Unspecified" => Applicability::Unspecified,
        a => cx.fail(format!("bad Applicability {a:?}")),
    };
    let sp = || span(cx, o.get("span").unwrap_or_else(|| cx.fail("suggestion: span")));
    let code = || get_str(cx, o, "code").to_string();
    let codes = || -> Vec<String> {
        get_arr(cx, o.get("codes").unwrap_or_else(|| cx.fail("codes")), "codes")
            .iter()
            .map(|c| c.as_str().unwrap_or_else(|| cx.fail("codes: strings")).to_string())
            .collect()
    };
    let style = || match get_str(cx, o, "style") {
        "HideCodeInline" => SuggestionStyle::HideCodeInline,
        "HideCodeAlways" => SuggestionStyle::HideCodeAlways,
        "CompletelyHidden" => SuggestionStyle::CompletelyHidden,
        "ShowCode" => SuggestionStyle::ShowCode,
        "ShowAlways" => SuggestionStyle::ShowAlways,
        st => cx.fail(format!("bad SuggestionStyle {st:?}")),
    };
    let parts = |v: &Value| -> Vec<(Span, String)> {
        get_arr(cx, v, "parts")
            .iter()
            .map(|p| {
                let pair = get_arr(cx, p, "part");
                if pair.len() != 2 {
                    cx.fail("part: [span, code]");
                }
                (span(cx, &pair[0]), pair[1].as_str().unwrap_or_else(|| cx.fail("part code")).to_string())
            })
            .collect()
    };
    match kind {
        "span_suggestion" => diag.span_suggestion(sp(), m, code(), app),
        "span_suggestion_verbose" => diag.span_suggestion_verbose(sp(), m, code(), app),
        "span_suggestion_short" => diag.span_suggestion_short(sp(), m, code(), app),
        "span_suggestion_hidden" => diag.span_suggestion_hidden(sp(), m, code(), app),
        "tool_only_span_suggestion" => diag.tool_only_span_suggestion(sp(), m, code(), app),
        "span_suggestion_with_style" => diag.span_suggestion_with_style(sp(), m, code(), app, style()),
        "span_suggestions" => diag.span_suggestions(sp(), m, codes(), app),
        "span_suggestions_with_style" => diag.span_suggestions_with_style(sp(), m, codes(), app, style()),
        "multipart_suggestion" => {
            diag.multipart_suggestion(m, parts(o.get("parts").unwrap_or_else(|| cx.fail("parts"))), app)
        }
        "tool_only_multipart_suggestion" => diag.tool_only_multipart_suggestion(
            m,
            parts(o.get("parts").unwrap_or_else(|| cx.fail("parts"))),
            app,
        ),
        "multipart_suggestion_with_style" => diag.multipart_suggestion_with_style(
            m,
            parts(o.get("parts").unwrap_or_else(|| cx.fail("parts"))),
            app,
            style(),
        ),
        "multipart_suggestions" => {
            let alts: Vec<Vec<(Span, String)>> =
                get_arr(cx, o.get("alternatives").unwrap_or_else(|| cx.fail("alternatives")), "alternatives")
                    .iter()
                    .map(|a| parts(a))
                    .collect();
            diag.multipart_suggestions(m, alts, app)
        }
        _ => cx.fail(format!("unknown suggestion kind {kind:?}")),
    };
}

fn level(cx: &Ctx<'_>, s: &str) -> Level {
    match s {
        "bug" => Level::Bug,
        "fatal" => Level::Fatal,
        "error" => Level::Error,
        "delayed_bug" => Level::DelayedBug,
        "warning" => Level::Warning(None),
        "force_warning" => Level::Warning(Some(EmissionOverride::Forced { lint_id: None })),
        "note" => Level::Note,
        "help" => Level::Help,
        "failure_note" => Level::FailureNote,
        _ => cx.fail(format!("bad level {s:?}")),
    }
}

fn stash_key(cx: &Ctx<'_>, s: &str) -> StashKey {
    match s {
        "ItemNoType" => StashKey::ItemNoType,
        "EarlySyntaxWarning" => StashKey::EarlySyntaxWarning,
        "CallIntoMethod" => StashKey::CallIntoMethod,
        "LifetimeIsChar" => StashKey::LifetimeIsChar,
        "MaybeFruTypo" => StashKey::MaybeFruTypo,
        "CallAssocMethod" => StashKey::CallAssocMethod,
        "UndeterminedMacroResolution" => StashKey::UndeterminedMacroResolution,
        "ExprInPat" => StashKey::ExprInPat,
        "GenericInFieldExpr" => StashKey::GenericInFieldExpr,
        "ReturnTypeNotation" => StashKey::ReturnTypeNotation,
        _ => cx.fail(format!("bad StashKey {s:?}")),
    }
}

fn err_code(cx: &Ctx<'_>, s: &str) -> ErrCode {
    match s.strip_prefix('E').filter(|d| d.len() == 4 && d.bytes().all(|b| b.is_ascii_digit())) {
        Some(d) => ErrCode::from_u32(d.parse().unwrap()),
        None => cx.fail(format!("bad error code {s:?}")),
    }
}

fn message(cx: &Ctx<'_>, v: &Value) -> DiagMessage {
    match v {
        Value::String(s) => DiagMessage::Str(Cow::Owned(s.clone())),
        Value::Object(o) if o.len() == 1 && o.contains_key("inline") => match &o["inline"] {
            Value::String(s) => DiagMessage::Inline(Cow::Owned(s.clone())),
            _ => cx.fail("inline: string"),
        },
        _ => cx.fail("msg: string | {inline: string}"),
    }
}

fn arg_value(cx: &Ctx<'_>, v: &Value) -> DiagArgValue {
    match v {
        Value::String(s) => DiagArgValue::Str(Cow::Owned(s.clone())),
        Value::Number(n) => match n.as_i64().and_then(|n| i32::try_from(n).ok()) {
            Some(n) => DiagArgValue::Number(n),
            None => cx.fail("arg number: i32"),
        },
        Value::Array(a) => DiagArgValue::StrListSepByAnd(
            a.iter()
                .map(|s| Cow::Owned(s.as_str().unwrap_or_else(|| cx.fail("arg list: strings")).to_string()))
                .collect(),
        ),
        _ => cx.fail("arg value: string | i32 | [string]"),
    }
}

fn span_msg(cx: &Ctx<'_>, v: &Value) -> (Span, DiagMessage) {
    let pair = get_arr(cx, v, "label");
    if pair.len() != 2 {
        cx.fail("label: [span, msg]");
    }
    (span(cx, &pair[0]), message(cx, &pair[1]))
}

fn multispan(cx: &Ctx<'_>, v: &Value) -> MultiSpan {
    match v {
        Value::Array(a) => MultiSpan::from_spans(a.iter().map(|s| span(cx, s)).collect()),
        Value::Object(_) => {
            let o = obj(cx, v, "multispan", &["primary", "labels"]);
            let primary = match o.get("primary") {
                Some(p) => get_arr(cx, p, "primary").iter().map(|s| span(cx, s)).collect(),
                None => vec![],
            };
            let mut ms = MultiSpan::from_spans(primary);
            if let Some(ls) = o.get("labels") {
                for l in get_arr(cx, ls, "labels") {
                    let (sp, m) = span_msg(cx, l);
                    ms.push_span_label(sp, m);
                }
            }
            ms
        }
        _ => cx.fail("multispan: [span] | {primary, labels}"),
    }
}

fn string_parts_raw(cx: &Ctx<'_>, v: &Value) -> Vec<(String, bool)> {
    get_arr(cx, v, "parts")
        .iter()
        .map(|p| {
            let pair = get_arr(cx, p, "part");
            match (pair.first(), pair.get(1), pair.len()) {
                (Some(Value::String(t)), Some(Value::Bool(h)), 2) => (t.clone(), *h),
                _ => cx.fail("part: [text, highlighted]"),
            }
        })
        .collect()
}

fn string_parts(cx: &Ctx<'_>, v: &Value) -> Vec<StringPart> {
    string_parts_raw(cx, v)
        .into_iter()
        .map(|(t, h)| if h { StringPart::highlighted(t) } else { StringPart::normal(t) })
        .collect()
}

fn span(cx: &Ctx<'_>, v: &Value) -> Span {
    let (fi, lo, hi) = match v {
        Value::String(s) if s == "dummy" => return DUMMY_SP,
        Value::Array(a) if a.len() == 3 => {
            (get_usize(cx, &a[0], "span file"), get_usize(cx, &a[1], "span lo"), get_usize(cx, &a[2], "span hi"))
        }
        Value::Object(_) => {
            let o = obj(cx, v, "span", &["file", "find", "nth", "len"]);
            let fi = get_usize(cx, o.get("file").unwrap_or_else(|| cx.fail("span: file")), "span file");
            let needle = get_str(cx, o, "find").as_bytes();
            let nth = o.get("nth").map(|n| get_usize(cx, n, "nth")).unwrap_or(0);
            let src = file_src(cx, fi);
            let hay = src.as_bytes();
            let mut found = None;
            let mut seen = 0;
            if !needle.is_empty() && needle.len() <= hay.len() {
                for i in 0..=hay.len() - needle.len() {
                    if &hay[i..i + needle.len()] == needle {
                        if seen == nth {
                            found = Some(i);
                            break;
                        }
                        seen += 1;
                    }
                }
            }
            let Some(lo) = found else { cx.fail(format!("span: {:?} #{nth} not found", get_str(cx, o, "find"))) };
            let len = o.get("len").map(|n| get_usize(cx, n, "len")).unwrap_or(needle.len());
            (fi, lo, lo + len)
        }
        _ => cx.fail("span: \"dummy\" | [file, lo, hi] | {file, find, nth?, len?}"),
    };
    let src = file_src(cx, fi);
    if !(lo <= hi && hi <= src.len() && src.is_char_boundary(lo) && src.is_char_boundary(hi)) {
        cx.fail(format!("span [{fi}, {lo}, {hi}] out of range or not on a char boundary"));
    }
    let start = cx.files[fi].start_pos;
    Span::with_root_ctxt(start + BytePos(lo as u32), start + BytePos(hi as u32))
}

fn file_src<'a>(cx: &'a Ctx<'_>, fi: usize) -> &'a str {
    let Some(f) = cx.files.get(fi) else { cx.fail(format!("span: no file {fi}")) };
    f.src.as_deref().map(|s| s.as_str()).unwrap_or_else(|| cx.fail("span: file has no src"))
}
