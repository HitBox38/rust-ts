// Oracle probe for the `AttributeParser::parse_limited_all` scenarios of
// `src/rustc_attr_parsing/attr_oracle.test.ts` (lane attr-parse-a; not part of the build).
//
// For each case of `list_cases.txt` (blocks `### name`, `ops: op ..`, then the source until the next
// `###`), it runs `rustc_interface::run_compiler` (default options, edition 2024) to get a real
// `Session`, swaps its emitter for a -Zui-testing `AnnotateSnippetEmitter` writing to a buffer, parses
// the source as crate `t.rs` (`new_parser_from_source_str`, `parse_crate_mod`) and runs every op on
// every attribute list of the crate: the crate's inner attributes (target `Crate`, target span
// `krate.spans.inner_span`), then the outer attributes of each top-level item (target
// `Target::from_ast_item(item)`, target span `item.span`). Events are `#<list index> <op> => <result>`;
// after the ops, every buffered early lint is listed as `buffered <LINT> <span>`.
// Output: one JSON array of `{name, ops, src, events, fatal, stderr}` (attr_oracle/list_out.json).
//
// ops:
//   limited:M   `AttributeParser::parse_limited_all(sess, attrs, None, target, target_span,
//               CRATE_NODE_ID, Some(&Features::default()), M, None)`, `{:?}` of the result
//   full:M      (lane attr-parse-b) `AttributeParser::new(sess, &Features::default(), &RegisteredTools::default(),
//               M).parse_attribute_list(attrs, target_span, target, <the item, None for the crate>,
//               identity, <buffer the lint like parse_limited_all>)`, `{:?}` of the result: unlike
//               `limited`, the parsers' `finalize_check`s see the target item
// M = emit | forbid | nothing | fatal (as in gen.rs).
//
// Regenerate (from this directory):
//
//   rustc +nightly-2026-10-11 --edition 2024 -O list_gen.rs -o $RUST_TS_DATA/tmp/attr-parse-a/list_gen
//   DYLD_LIBRARY_PATH=$(rustc +nightly-2026-10-11 --print sysroot)/lib \
//     $RUST_TS_DATA/tmp/attr-parse-a/list_gen list_cases.txt > list_out.json
//
// (`LD_LIBRARY_PATH` / `PATH` instead of `DYLD_LIBRARY_PATH` on Linux / Windows.)
#![feature(rustc_private)]
extern crate rustc_ast;
extern crate rustc_attr_ir;
extern crate rustc_attr_parsing;
extern crate rustc_driver;
extern crate rustc_errors;
extern crate rustc_feature;
extern crate rustc_interface;
extern crate rustc_lint_defs;
extern crate rustc_parse;
extern crate rustc_session;
extern crate rustc_span;

use std::io::Write;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use rustc_ast::{Attribute, CRATE_NODE_ID};
use rustc_attr_ir::target::Target;
use rustc_attr_parsing::{AttributeParser, ShouldEmit};
use rustc_errors::annotate_snippet_emitter_writer::AnnotateSnippetEmitter;
use rustc_errors::AutoStream;
use rustc_feature::Features;
use rustc_parse::lexer::StripTokens;
use rustc_parse::parser::Recovery;
use rustc_session::config::{Input, Options};
use rustc_span::edition::Edition;
use rustc_span::{FileName, Span};

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

static USING_INTERNAL_FEATURES: AtomicBool = AtomicBool::new(false);

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
        let out = Arc::new(Mutex::new(Vec::new()));
        let mut ev = Vec::new();
        let mut fatal = false;
        let mut opts = Options::default();
        opts.edition = Edition::Edition2024;
        let config = rustc_interface::Config {
            opts,
            crate_cfg: vec![],
            crate_check_cfg: vec![],
            input: Input::Str { name: FileName::Custom("unused".into()), input: String::new() },
            output_dir: None,
            output_file: None,
            ice_file: None,
            file_loader: None,
            lint_caps: Default::default(),
            psess_created: None,
            track_state: None,
            register_lints: None,
            override_queries: None,
            extra_symbols: vec![],
            make_codegen_backend: None,
            using_internal_features: &USING_INTERNAL_FEATURES,
        };
        rustc_interface::run_compiler(config, |compiler| {
            let sess = &compiler.sess;
            let sm = sess.psess.clone_source_map();
            let shared: Box<dyn Write + Send> = Box::new(Shared(out.clone()));
            sess.dcx().set_emitter(Box::new(
                AnnotateSnippetEmitter::new(AutoStream::never(shared)).sm(Some(Arc::clone(&sm))).ui_testing(true),
            ));
            let fname = FileName::Real(
                sm.path_mapping().to_real_filename(sm.working_dir(), std::path::Path::new("t.rs")),
            );
            let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let mut p = rustc_parse::unwrap_or_emit_fatal(rustc_parse::new_parser_from_source_str(
                    &sess.psess,
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
                let mut lists: Vec<(&[Attribute], Target, Span, Option<&rustc_ast::Item>)> =
                    vec![(&krate.attrs[..], Target::Crate, krate.spans.inner_span, None)];
                for item in &krate.items {
                    lists.push((&item.attrs[..], Target::from_ast_item(item), item.span, Some(&**item)));
                }
                let features = Features::default();
                let tools = rustc_lint_defs::RegisteredTools::default();
                for (idx, (attrs, target, target_span, item)) in lists.iter().enumerate() {
                    for op in &ops {
                        let (name, arg) = op.split_once(':').unwrap_or((op, ""));
                        let r = match name {
                            "limited" => format!(
                                "{:?}",
                                AttributeParser::parse_limited_all(
                                    sess,
                                    attrs,
                                    None,
                                    *target,
                                    *target_span,
                                    CRATE_NODE_ID,
                                    Some(&features),
                                    mode(arg),
                                    None,
                                )
                            ),
                            "full" => format!(
                                "{:?}",
                                AttributeParser::new(sess, &features, &tools, mode(arg)).parse_attribute_list(
                                    attrs,
                                    *target_span,
                                    *target,
                                    *item,
                                    std::convert::identity,
                                    |lint_id, span, kind| {
                                        sess.psess.dyn_buffer_lint_sess(lint_id.lint, span, CRATE_NODE_ID, kind.0)
                                    },
                                )
                            ),
                            o => panic!("op {o}"),
                        };
                        ev.push(format!("#{idx} {op} => {r}"));
                    }
                }
                for l in sess.psess.buffered_lints.lock().iter() {
                    ev.push(format!("buffered {} {:?}", l.lint_id.lint.name, l.span));
                }
            }));
            fatal = res.is_err();
            sess.dcx().reset_err_count();
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
