//! Oracle probe for the `tokens` suite: lexes each file into token trees with the pinned
//! nightly's own `rustc_parse` (rustc-dev component, `#![feature(rustc_private)]`).
//!
//!   tokdump [--edition=<2015|2018|2021|2024|future>] [--strip=<crate|str>] <file> [--edition=..] <file> ...
//!
//! An `--edition=` argument sets the edition of the files after it (default 2015), a `--strip=`
//! argument the entry point (default `crate`, see below).
//!
//! Per file, inside its own `create_session_globals_then(edition, ..)` (a fresh source map,
//! `RealFileLoader`, empty path mapping, MD5 source hashes: what rustc uses on non-MSVC targets):
//! - a `ParseSess` whose `DiagCtxt` has the flags rustc's driver gives it by default
//!   (`Options::dcx_flags`: warnings on, deduplication on) and an `AnnotateSnippetEmitter` set up
//!   like `rustc_session::session::default_emitter` with `-Zui-testing` (and every other option
//!   at its default), writing into an in-memory buffer instead of stderr;
//! - the token trees of a new source file (`<Real file name of the path>`, `<source>`), lexed by
//!   `lexer::lex_token_trees` through `source_file_to_stream` (both crate-private) via one of two
//!   public entry points:
//!   - `--strip=crate`: the way rustc lexes every file it reads as a crate root, out-of-line module
//!     or `include!` (`StripTokens::ShebangAndFrontmatter`: frontmatter is lexed, validated and
//!     feature-gated): `rustc_parse::new_parser_from_source_str(.., ShebangAndFrontmatter)`,
//!     then `Parser::parse_tokens()`, which rebuilds the same `TokenStream` from the parser's
//!     token cursor;
//!   - `--strip=str`: `rustc_parse::source_str_to_stream(.., None)` (`StripTokens::Shebang`: what
//!     proc-macro `TokenStream::from_str` and friends use; frontmatter is ordinary tokens).
//!
//! Output per file (the subject, src/rust_ts/tokdump.ts, prints the same):
//!   file: <path>
//!   edition: <edition:?>
//!   then either `not utf-8` (and nothing else), or:
//!   OK <TokenStream:?>   | ERR <n> (the n returned diagnostics are emitted in order) | FATAL
//!   lint <name> <node_id:?> <primary spans:?>       one line per buffered lint, in buffer order
//!   gated <feature> <spans:?>                       one line per gated feature, sorted by name
//!   raw <raw identifier spans:?>
//!   diagnostics: <n> bytes
//!   <the n bytes the emitter wrote: diagnostics emitted while lexing, the returned ones, then the
//!    stashed ones (`emit_stashed_diagnostics`), then whatever dropping the `DiagCtxt` emits>
//!   `= no newline at end of output` (on its own line) if those bytes are non-empty and do not
//!    end in `\n`
//! `FATAL` is a `FatalError` raised while lexing (`catch_unwind` of a `FatalErrorMarker`); any
//! other panic is an oracle failure and is not caught.
#![feature(rustc_private)]
extern crate rustc_driver;
extern crate rustc_errors;
extern crate rustc_parse;
extern crate rustc_session;
extern crate rustc_span;

use std::io::Write;
use std::str::FromStr;
use std::sync::{Arc, Mutex};

use rustc_errors::annotate_snippet_emitter_writer::AnnotateSnippetEmitter;
use rustc_errors::emitter::OutputTheme;
use rustc_errors::{AutoStream, ColorChoice, DiagCtxt, DiagCtxtFlags, FatalErrorMarker, TerminalUrl};
use rustc_parse::lexer::StripTokens;
use rustc_session::parse::ParseSess;
use rustc_span::edition::Edition;
use rustc_span::source_map::{FilePathMapping, RealFileLoader, SourceMapInputs};
use rustc_span::{FileName, SourceFileHashAlgorithm};

/// The emitter's destination: an in-memory buffer shared with `main`.
#[derive(Clone, Default)]
struct Shared(Arc<Mutex<Vec<u8>>>);

impl Write for Shared {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[derive(Clone, Copy)]
enum Strip {
    Crate,
    Str,
}

fn lex_file(out: &mut impl Write, path: &str, edition: Edition, strip: Strip, src: String) {
    let inputs = SourceMapInputs {
        file_loader: Box::new(RealFileLoader),
        path_mapping: FilePathMapping::empty(),
        hash_kind: SourceFileHashAlgorithm::Md5,
        checksum_hash_kind: None,
    };
    let buf = Shared::default();
    rustc_span::create_session_globals_then(edition, &[], Some(inputs), || {
        let sm = rustc_span::source_map::get_source_map().unwrap();
        // `default_emitter` for `ErrorOutputType::HumanReadable { kind: default, color_config:
        // ColorConfig::Never }` with every option at its default, then `.ui_testing(true)`.
        let dst: Box<dyn Write + Send> = Box::new(buf.clone());
        let emitter = AnnotateSnippetEmitter::new(AutoStream::new(dst, ColorChoice::Never))
            .sm(Some(Arc::clone(&sm)))
            .short_message(false)
            .diagnostic_width(None)
            .macro_backtrace(false)
            .track_diagnostics(false)
            .terminal_url(TerminalUrl::No)
            .theme(OutputTheme::Ascii)
            .ignored_directories_in_source_blocks(Vec::new())
            .ui_testing(true);
        // `Options::dcx_flags(can_emit_warnings: true)` with default options.
        let flags = DiagCtxtFlags {
            can_emit_warnings: true,
            treat_err_as_bug: None,
            eagerly_emit_delayed_bugs: false,
            macro_backtrace: false,
            deduplicate_diagnostics: true,
            track_diagnostics: false,
        };
        let dcx = DiagCtxt::new(Box::new(emitter)).with_flags(flags);
        let psess = ParseSess::with_dcx(dcx, Arc::clone(&sm));
        let fname = FileName::Real(sm.path_mapping().to_real_filename(sm.working_dir(), std::path::Path::new(path)));
        let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let res = match strip {
                Strip::Crate => rustc_parse::new_parser_from_source_str(&psess, fname, src, StripTokens::ShebangAndFrontmatter)
                    .map(|mut parser| parser.parse_tokens()),
                Strip::Str => rustc_parse::source_str_to_stream(&psess, fname, src, None),
            };
            match res {
                Ok(stream) => writeln!(out, "OK {stream:?}").unwrap(),
                Err(errs) => {
                    writeln!(out, "ERR {}", errs.len()).unwrap();
                    for e in errs {
                        e.emit();
                    }
                }
            }
        }));
        if let Err(payload) = res {
            if !payload.is::<FatalErrorMarker>() {
                std::panic::resume_unwind(payload);
            }
            writeln!(out, "FATAL").unwrap();
        }
        for lint in psess.buffered_lints.lock().iter() {
            let spans = lint.span.as_ref().map_or(&[][..], |s| s.primary_spans());
            writeln!(out, "lint {} {:?} {:?}", lint.lint_id.lint.name, lint.node_id, spans).unwrap();
        }
        let mut gated: Vec<(String, Vec<rustc_span::Span>)> =
            psess.gated_spans.spans.borrow().iter().map(|(k, v)| (k.to_string(), v.clone())).collect();
        gated.sort_by(|a, b| a.0.cmp(&b.0));
        for (feature, spans) in &gated {
            writeln!(out, "gated {feature} {spans:?}").unwrap();
        }
        let raw: Vec<rustc_span::Span> = psess.raw_identifier_spans.iter().collect();
        writeln!(out, "raw {raw:?}").unwrap();
        psess.dcx().emit_stashed_diagnostics();
        // `psess` (and with it the `DiagCtxt`) is dropped here, as at the end of a rustc session.
        drop(psess);
    });
    let bytes = std::mem::take(&mut *buf.0.lock().unwrap());
    writeln!(out, "diagnostics: {} bytes", bytes.len()).unwrap();
    out.write_all(&bytes).unwrap();
    if bytes.last().is_some_and(|&b| b != b'\n') {
        writeln!(out, "\n= no newline at end of output").unwrap();
    }
}

fn main() {
    let stdout = std::io::stdout();
    let mut out = std::io::BufWriter::new(stdout.lock());
    let mut edition = Edition::Edition2015;
    let mut strip = Strip::Crate;
    for arg in std::env::args().skip(1) {
        if let Some(s) = arg.strip_prefix("--strip=") {
            strip = match s {
                "crate" => Strip::Crate,
                "str" => Strip::Str,
                _ => panic!("tokdump: bad --strip {s:?}"),
            };
            continue;
        }
        if let Some(e) = arg.strip_prefix("--edition=") {
            edition = Edition::from_str(e).unwrap_or_else(|()| panic!("tokdump: bad edition {e:?}"));
            continue;
        }
        writeln!(out, "file: {arg}\nedition: {edition:?}").unwrap();
        let bytes = std::fs::read(&arg).unwrap();
        match String::from_utf8(bytes) {
            Ok(src) => lex_file(&mut out, &arg, edition, strip, src),
            Err(_) => writeln!(out, "not utf-8").unwrap(),
        }
    }
    out.flush().unwrap();
}
