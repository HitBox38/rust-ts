// Oracle probe for `src/rustc_attr_parsing/attr_oracle.test.ts` (lane attr-parse-a; not part of the
// build). Drives the real `rustc_attr_parsing` of the pinned toolchain (rustc-dev component).
//
// For each case of `cases.txt` (blocks `### name`, `ops: op op ..`, then the source until the next
// `###`), it parses the source as crate `t.rs` (edition 2024, `new_parser_from_source_str`,
// `parse_crate_mod`), then runs every op on every attribute of the crate (the crate's inner
// attributes, then the outer attributes of each top-level item, in order). Events are
// `#<attr index> <op> => <result>`; after the ops, every buffered early lint is listed as
// `buffered <LINT> <span>`; `stderr` is the -Zui-testing human rendering of everything emitted.
// Output: one JSON array of `{name, ops, src, events, fatal, stderr}` (attr_oracle/out.json).
//
// ops:
//   args:M      `ArgParser::from_attr_args(&args, &parts, psess, M, AllowExprMetavar::No)`, `{:?}`
//   walk:M      like `args:M`, then the accessors of the result (see `walk`)
//   single:M    `MetaItemOrLitParser::parse_single` over a parser of the delimited args' tokens
//   meta        `validate_attr::parse_meta`, `{:?}`
//   builtin:T   `parse_meta` + `validate_attr::check_builtin_meta_item(.., T, deny_unsafety: true)`
//   malformed:T `validate_attr::emit_malformed_attribute(psess, style, attr.span, name, T)`
//   suggest:T:D `T.suggestions(D, item.unsafety, AttrPath)` (D = attr | macro)
//   check       `validate_attr::check_attr`
// M = emit (ErrorsAndLints { recovery: Allowed }) | forbid (ErrorsAndLints { recovery: Forbidden })
//   | nothing (Nothing) | fatal (EarlyFatal { also_emit_lints: false }).
// T = one of the templates in `tpl`. `name` = the last path segment.
//
// Regenerate (from this directory):
//
//   rustc +nightly-2026-10-11 --edition 2024 -O gen.rs -o $RUST_TS_DATA/tmp/attr-parse-a/gen
//   DYLD_LIBRARY_PATH=$(rustc +nightly-2026-10-11 --print sysroot)/lib \
//     $RUST_TS_DATA/tmp/attr-parse-a/gen cases.txt > out.json
//
// (`LD_LIBRARY_PATH` / `PATH` instead of `DYLD_LIBRARY_PATH` on Linux / Windows.)
#![feature(rustc_private)]
extern crate rustc_ast;
extern crate rustc_attr_ir;
extern crate rustc_attr_parsing;
extern crate rustc_driver;
extern crate rustc_errors;
extern crate rustc_parse;
extern crate rustc_session;
extern crate rustc_span;

use std::io::Write;
use std::sync::{Arc, Mutex};

use rustc_ast::{AttrArgs, AttrKind, Attribute};
use rustc_attr_ir::AttrPath;
use rustc_attr_parsing::parser::{AllowExprMetavar, ArgParser, MetaItemOrLitParser};
use rustc_attr_parsing::validate_attr;
use rustc_attr_parsing::{AttributeTemplate, ParsedDescription, ShouldEmit};
use rustc_errors::annotate_snippet_emitter_writer::AnnotateSnippetEmitter;
use rustc_errors::{AutoStream, DiagCtxt};
use rustc_parse::lexer::StripTokens;
use rustc_parse::parser::{Parser, Recovery};
use rustc_session::parse::ParseSess;
use rustc_span::edition::Edition;
use rustc_span::source_map::{FilePathMapping, RealFileLoader, SourceMapInputs};
use rustc_span::{FileName, SourceFileHashAlgorithm, Symbol};

struct Shared(Arc<Mutex<Vec<u8>>>);
impl Write for Shared {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().write(buf)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn esc(s: &str) -> String {
    let mut o = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            '\n' => o.push_str("\\n"),
            '\r' => o.push_str("\\r"),
            '\t' => o.push_str("\\t"),
            c if (c as u32) < 0x20 => o.push_str(&format!("\\u{:04x}", c as u32)),
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

fn mode(m: &str) -> ShouldEmit {
    match m {
        "emit" => ShouldEmit::ErrorsAndLints { recovery: Recovery::Allowed },
        "forbid" => ShouldEmit::ErrorsAndLints { recovery: Recovery::Forbidden },
        "nothing" => ShouldEmit::Nothing,
        "fatal" => ShouldEmit::EarlyFatal { also_emit_lints: false },
        o => panic!("mode {o}"),
    }
}

fn leak_syms(s: &[&str]) -> &'static [Symbol] {
    Box::leak(s.iter().map(|s| Symbol::intern(s)).collect::<Vec<_>>().into_boxed_slice())
}

fn template(name: &str) -> AttributeTemplate {
    let mk = |word, list: Option<&'static [&'static str]>, one_of: &'static [Symbol], nv: Option<&'static [&'static str]>, docs| {
        AttributeTemplate { word, list, one_of, name_value_str: nv, docs }
    };
    match name {
        // validate_attr::check_attr's hardcoded lint-attribute template
        "lint" => mk(
            false,
            Some(&["lint1", "lint1, lint2, ...", r#"lint1, lint2, lint3, reason = "...""#]),
            &[],
            None,
            Some("https://doc.rust-lang.org/reference/attributes/diagnostics.html#lint-check-attributes"),
        ),
        "word" => mk(true, None, &[], None, None),
        "word_list" => mk(true, Some(&["a", "b = \"c\""]), &[], None, None),
        "nv" => mk(false, None, &[], Some(&["reason"]), None),
        "word_nv_docs" => mk(true, None, &[], Some(&["x"]), Some("https://example.com/doc")),
        "oneof" => mk(false, None, leak_syms(&["on", "off"]), None, None),
        "many" => mk(true, Some(&["a", "b"]), &[], Some(&["c"]), None),
        "list_nv" => mk(false, Some(&["x"]), &[], Some(&["y", "z"]), Some("https://example.com/l")),
        "empty" => mk(false, None, &[], None, None),
        o => panic!("template {o}"),
    }
}

fn walk(a: &ArgParser, ev: &mut Vec<String>, pre: &str) {
    ev.push(format!("{pre}span={:?} as_no_args={:?}", a.span(), a.as_no_args()));
    match a {
        ArgParser::NoArgs => {}
        ArgParser::List(l) => {
            ev.push(format!(
                "{pre}list len={} is_empty={} single={} span={:?}",
                l.len(),
                l.is_empty(),
                l.as_single().is_some(),
                l.span
            ));
            for (i, item) in l.mixed().enumerate() {
                ev.push(format!("{pre}[{i}] span={:?} lit={:?}", item.span(), item.as_lit()));
                if let Some(m) = item.meta_item() {
                    let p = m.path();
                    ev.push(format!(
                        "{pre}[{i}] path={} len={} word={:?} word_sym={:?} ident={:?} span={:?} no_args={} attr_path={:?}",
                        p,
                        p.len(),
                        p.word(),
                        p.word_sym(),
                        m.ident(),
                        m.span(),
                        item.meta_item_no_args().is_some(),
                        p.get_attribute_path(),
                    ));
                    walk(m.args(), ev, &format!("{pre}[{i}]."));
                }
            }
        }
        ArgParser::NameValue(nv) => {
            ev.push(format!(
                "{pre}nv str={:?} ident={:?} args_span={:?} eq_span={:?} value_span={:?} lit={:?}",
                nv.value_as_str(),
                nv.value_as_ident(),
                nv.args_span(),
                nv.eq_span,
                nv.value_span,
                nv.value_as_lit()
            ));
        }
    }
}

fn attr_name(attr: &Attribute) -> Symbol {
    attr.get_normal_item().path.segments.last().unwrap().ident.name
}

fn run_op(psess: &ParseSess, attr: &Attribute, op: &str, ev: &mut Vec<String>, idx: usize) {
    let (name, arg) = op.split_once(':').unwrap_or((op, ""));
    let AttrKind::Normal(n) = &attr.kind else {
        ev.push(format!("#{idx} {op} => doc/synthetic"));
        return;
    };
    let item = &n.item;
    let parts = item.path.segments.iter().map(|s| s.ident.name).collect::<Vec<_>>();
    let r: String = match name {
        "args" => format!(
            "{:?}",
            ArgParser::from_attr_args(&item.args, &parts, psess, mode(arg), AllowExprMetavar::No)
        ),
        "walk" => {
            let a = ArgParser::from_attr_args(&item.args, &parts, psess, mode(arg), AllowExprMetavar::No);
            let mut sub = Vec::new();
            if let Some(a) = &a {
                walk(a, &mut sub, "  ");
            }
            ev.push(format!("#{idx} {op} => {}", if a.is_some() { "Some" } else { "None" }));
            ev.extend(sub);
            return;
        }
        "single" => match &item.args {
            AttrArgs::Delimited(d) => {
                let mut p = Parser::new(psess, d.tokens.clone(), None);
                match MetaItemOrLitParser::parse_single(&mut p, mode(arg), AllowExprMetavar::No) {
                    Ok(x) => format!("Ok({x:?}) next={:?}", p.token),
                    Err(e) => {
                        e.emit();
                        "Err".to_string()
                    }
                }
            }
            _ => "not delimited".to_string(),
        },
        "meta" => match validate_attr::parse_meta(psess, attr) {
            Ok(m) => format!("Ok({m:?})"),
            Err(e) => {
                e.emit();
                "Err".to_string()
            }
        },
        "builtin" => match validate_attr::parse_meta(psess, attr) {
            Ok(m) => {
                validate_attr::check_builtin_meta_item(psess, &m, attr.style, attr_name(attr), template(arg), true);
                "checked".to_string()
            }
            Err(e) => {
                e.emit();
                "Err".to_string()
            }
        },
        "malformed" => {
            validate_attr::emit_malformed_attribute(psess, attr.style, attr.span, attr_name(attr), template(arg));
            "emitted".to_string()
        }
        "suggest" => {
            let (t, d) = arg.split_once(':').unwrap();
            let d = match d {
                "attr" => ParsedDescription::Attribute,
                "macro" => ParsedDescription::Macro,
                o => panic!("descr {o}"),
            };
            let path = AttrPath::from_ast(&item.path, std::convert::identity);
            format!("{:?}", template(t).suggestions(d, item.unsafety, &path))
        }
        "check" => {
            validate_attr::check_attr(psess, attr);
            "checked".to_string()
        }
        o => panic!("op {o}"),
    };
    ev.push(format!("#{idx} {op} => {r}"));
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let text = std::fs::read_to_string(&args[1]).unwrap();
    let mut first = true;
    println!("[");
    for block in text.split("### ").skip(1) {
        let (name, rest) = block.split_once('\n').unwrap();
        let (ops_line, src) = rest.split_once('\n').unwrap();
        let ops: Vec<&str> = ops_line.strip_prefix("ops:").unwrap().split_whitespace().collect();
        let src = src.strip_suffix('\n').unwrap_or(src).to_string();
        let inputs = SourceMapInputs {
            file_loader: Box::new(RealFileLoader),
            path_mapping: FilePathMapping::empty(),
            hash_kind: SourceFileHashAlgorithm::Md5,
            checksum_hash_kind: None,
        };
        let out = Arc::new(Mutex::new(Vec::new()));
        let mut ev = Vec::new();
        let mut fatal = false;
        rustc_span::create_session_globals_then(Edition::Edition2024, &[], Some(inputs), || {
            let sm: Arc<_> = rustc_span::source_map::get_source_map().unwrap();
            let shared: Box<dyn Write + Send> = Box::new(Shared(out.clone()));
            let emitter = AnnotateSnippetEmitter::new(AutoStream::never(shared))
                .sm(Some(Arc::clone(&sm)))
                .ui_testing(true);
            let dcx = DiagCtxt::new(Box::new(emitter));
            let psess = ParseSess::with_dcx(dcx, Arc::clone(&sm));
            let fname = FileName::Real(
                sm.path_mapping().to_real_filename(sm.working_dir(), std::path::Path::new("t.rs")),
            );
            let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let mut p = rustc_parse::unwrap_or_emit_fatal(rustc_parse::new_parser_from_source_str(
                    &psess,
                    fname,
                    src.clone(),
                    StripTokens::Nothing,
                ));
                let krate = match p.parse_crate_mod() {
                    Ok(k) => k,
                    Err(e) => {
                        e.emit();
                        ev.push("parse_crate_mod => Err".to_string());
                        return;
                    }
                };
                let mut attrs: Vec<&Attribute> = krate.attrs.iter().collect();
                for item in &krate.items {
                    attrs.extend(item.attrs.iter());
                }
                for (idx, attr) in attrs.iter().enumerate() {
                    for op in &ops {
                        run_op(&psess, attr, op, &mut ev, idx);
                    }
                }
                for l in psess.buffered_lints.lock().iter() {
                    ev.push(format!("buffered {} {:?}", l.lint_id.lint.name, l.span));
                }
            }));
            fatal = res.is_err();
            psess.dcx().reset_err_count();
        });
        let stderr = String::from_utf8(out.lock().unwrap().clone()).unwrap();
        if !first {
            println!(",");
        }
        first = false;
        let evs: Vec<String> = ev.iter().map(|e| esc(e)).collect();
        print!(
            "{{\"name\":{},\"ops\":{},\"src\":{},\"events\":[{}],\"fatal\":{},\"stderr\":{}}}",
            esc(name.trim()),
            esc(ops_line.strip_prefix("ops:").unwrap().trim()),
            esc(&src),
            evs.join(","),
            fatal,
            esc(&stderr)
        );
    }
    println!("\n]");
}
