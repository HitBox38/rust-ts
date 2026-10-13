// Oracle probe for the cfg scenarios of `src/rustc_attr_parsing/cfg_oracle.test.ts` (lane attr-parse-b;
// not part of the build): `parse_cfg` / `eval_config_entry` (attributes/cfg.rs), `parse_cfg_attr`,
// `parse_cfg_select` / `CfgSelectBranches::pop_first_match` (attributes/cfg_select.rs) and the
// `unexpected_cfgs` lints of check_cfg.rs, against a real `Session`.
//
// For each case of `cfg_cases.txt` (blocks `### name`, `ops: op ..`, `cfg: spec;spec..` (the `--cfg`
// values), `check: spec;spec..` (the `--check-cfg` values), then the source until the next `###`), it
// runs `rustc_interface::run_compiler` (default options, edition 2024, the given `crate_cfg` /
// `crate_check_cfg`) with a -Zui-testing `AnnotateSnippetEmitter` writing to a buffer, parses the source
// as crate `t.rs` and runs every op on every attribute list of the crate (the crate's inner attributes,
// target `Crate`, then the outer attributes of each top-level item, `Target::from_ast_item`):
//
//   cfg       each `#[cfg(..)]`: `AttributeParser::parse_single(sess, attr, target_span, CRATE_NODE_ID,
//             target, Some(&Features::default()), ErrorsAndLints { recovery: Allowed }, parse_cfg,
//             &CFG_TEMPLATE, AllowExprMetavar::No, AttributeSafety::Normal)`, `{:?}`; then
//             `eval_config_entry(sess, &cfg)` (`True` / `False(<reason {:?}>)`)
//   cfg_attr  each `#[cfg_attr(..)]`: `parse_cfg_attr(attr, sess, Some(&features), CRATE_NODE_ID)`:
//             `None` or the predicate `{:?}`, its evaluation and `(<attr item path {:?}>, <span {:?}>)` of
//             every expanded attribute
//   select    if the list's item is a `cfg_select! { .. }` macro call: `parse_cfg_select` over its
//             tokens (`Parser::new`), every branch (`reachable` / `wildcard` / `unreachable`, predicate
//             and span), then `pop_first_match(|cfg| eval_config_entry(sess, cfg))`
//
// Events are `#<list index> <op>@<attr index> => <result>`. After the ops every buffered early lint is
// listed as `buffered <LINT> <span>` and then emitted: its `DecorateDiagCompat` closure is called with
// `Level::Warning` and the session, the lint span is set as the primary span (`Diag::span`) and the
// diagnostic is emitted (lint levels and their notes are not applied).
// Output: one JSON array of `{name, ops, cfg, check, src, events, fatal, stderr}` (attr_oracle/cfg_out.json).
//
// Regenerate (from this directory):
//
//   rustc +nightly-2026-10-11 --edition 2024 -O cfg_gen.rs -o $RUST_TS_DATA/tmp/attr-parse-b/cfg_gen
//   DYLD_LIBRARY_PATH=$(rustc +nightly-2026-10-11 --print sysroot)/lib \
//     $RUST_TS_DATA/tmp/attr-parse-b/cfg_gen cfg_cases.txt > cfg_out.json
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
extern crate rustc_parse;
extern crate rustc_session;
extern crate rustc_span;

use std::io::Write;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use rustc_ast::{Attribute, CRATE_NODE_ID, ItemKind};
use rustc_attr_ir::target::Target;
use rustc_attr_parsing::parser::AllowExprMetavar;
use rustc_attr_parsing::{
    AttributeParser, AttributeSafety, CFG_TEMPLATE, CfgSelectPredicate, EvalConfigResult, ShouldEmit,
    eval_config_entry, parse_cfg, parse_cfg_attr, parse_cfg_select,
};
use rustc_errors::annotate_snippet_emitter_writer::AnnotateSnippetEmitter;
use rustc_errors::{AutoStream, Level};
use rustc_feature::Features;
use rustc_parse::lexer::StripTokens;
use rustc_parse::parser::{Parser, Recovery};
use rustc_session::config::{Input, Options};
use rustc_span::edition::Edition;
use rustc_span::{FileName, Span, sym};

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

fn eval(r: EvalConfigResult) -> String {
    match r {
        EvalConfigResult::True => "True".to_string(),
        EvalConfigResult::False { reason } => format!("False({reason:?})"),
    }
}

fn specs(line: &str, prefix: &str) -> Vec<String> {
    let v = line.strip_prefix(prefix).unwrap().trim();
    if v.is_empty() { vec![] } else { v.split(';').map(|s| s.trim().to_string()).collect() }
}

static USING_INTERNAL_FEATURES: AtomicBool = AtomicBool::new(false);

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let text = std::fs::read_to_string(&args[1]).unwrap();
    let mut first = true;
    println!("[");
    for block in text.split("### ").skip(1) {
        let (name, rest) = block.split_once('\n').unwrap();
        let (ops_line, rest) = rest.split_once('\n').unwrap();
        let (cfg_line, rest) = rest.split_once('\n').unwrap();
        let (check_line, src) = rest.split_once('\n').unwrap();
        let ops: Vec<&str> = ops_line.strip_prefix("ops:").unwrap().split_whitespace().collect();
        let crate_cfg = specs(cfg_line, "cfg:");
        let crate_check_cfg = specs(check_line, "check:");
        let src = src.strip_suffix('\n').unwrap_or(src).to_string();
        let out = Arc::new(Mutex::new(Vec::new()));
        let mut ev = Vec::new();
        let mut fatal = false;
        let mut opts = Options::default();
        opts.edition = Edition::Edition2024;
        let config = rustc_interface::Config {
            opts,
            crate_cfg,
            crate_check_cfg,
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
                let emit = ShouldEmit::ErrorsAndLints { recovery: Recovery::Allowed };
                for (idx, (attrs, target, target_span, item)) in lists.iter().enumerate() {
                    for op in &ops {
                        match *op {
                            "cfg" => {
                                for (j, attr) in attrs.iter().enumerate() {
                                    if !attr.has_name(sym::cfg) {
                                        continue;
                                    }
                                    let r = AttributeParser::parse_single(
                                        sess,
                                        attr,
                                        *target_span,
                                        CRATE_NODE_ID,
                                        *target,
                                        Some(&features),
                                        emit,
                                        parse_cfg,
                                        &CFG_TEMPLATE,
                                        AllowExprMetavar::No,
                                        AttributeSafety::Normal,
                                    );
                                    ev.push(format!("#{idx} cfg@{j} => {r:?}"));
                                    if let Some(c) = r {
                                        ev.push(format!("#{idx} eval@{j} => {}", eval(eval_config_entry(sess, &c))));
                                    }
                                }
                            }
                            "cfg_attr" => {
                                for (j, attr) in attrs.iter().enumerate() {
                                    if !attr.has_name(sym::cfg_attr) {
                                        continue;
                                    }
                                    match parse_cfg_attr(attr, sess, Some(&features), CRATE_NODE_ID) {
                                        None => ev.push(format!("#{idx} cfg_attr@{j} => None")),
                                        Some((c, items)) => {
                                            let items: Vec<String> = items
                                                .iter()
                                                .map(|(i, s)| format!("({:?}, {s:?})", i.node.path))
                                                .collect();
                                            ev.push(format!("#{idx} cfg_attr@{j} => Some({c:?}, [{}])", items.join(", ")));
                                            ev.push(format!("#{idx} eval@{j} => {}", eval(eval_config_entry(sess, &c))));
                                        }
                                    }
                                }
                            }
                            "select" => {
                                let Some(item) = item else { continue };
                                let ItemKind::MacCall(mac) = &item.kind else { continue };
                                if !(mac.path.segments.len() == 1 && mac.path.segments[0].ident.name == sym::cfg_select) {
                                    continue;
                                }
                                let mut p = Parser::new(&sess.psess, mac.args.tokens.clone(), None);
                                match parse_cfg_select(&mut p, sess, Some(&features), CRATE_NODE_ID) {
                                    Err(_) => ev.push(format!("#{idx} select => Err")),
                                    Ok(mut b) => {
                                        for (c, _, s) in &b.reachable {
                                            ev.push(format!("#{idx} select reachable {c:?} {s:?}"));
                                        }
                                        if let Some((t, _, s)) = &b.wildcard {
                                            ev.push(format!("#{idx} select wildcard {:?} {s:?}", t.span));
                                        }
                                        for (pr, _, s) in &b.unreachable {
                                            let pr = match pr {
                                                CfgSelectPredicate::Cfg(c) => format!("Cfg({c:?})"),
                                                CfgSelectPredicate::Wildcard(t) => format!("Wildcard({:?})", t.span),
                                            };
                                            ev.push(format!("#{idx} select unreachable {pr} {s:?}"));
                                        }
                                        let m = b.pop_first_match(|c| eval_config_entry(sess, c));
                                        let m = m.map(|(c, _, s)| format!("{c:?} {s:?}"));
                                        ev.push(format!("#{idx} select match => {m:?}"));
                                    }
                                }
                            }
                            o => panic!("op {o}"),
                        }
                    }
                }
                let lints = std::mem::take(&mut *sess.psess.buffered_lints.lock());
                for l in &lints {
                    ev.push(format!("buffered {} {:?}", l.lint_id.lint.name, l.span));
                }
                for l in lints {
                    let mut d = (l.diagnostic.0)(sess.dcx(), Level::Warning(None), sess as &dyn std::any::Any);
                    if let Some(sp) = l.span {
                        d.span(sp);
                    }
                    d.emit();
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
            "{{\"name\":{},\"ops\":{},\"cfg\":{},\"check\":{},\"src\":{},\"events\":[{}],\"fatal\":{},\"stderr\":{}}}",
            esc(name.trim()),
            esc(ops_line.strip_prefix("ops:").unwrap().trim()),
            esc(cfg_line.strip_prefix("cfg:").unwrap().trim()),
            esc(check_line.strip_prefix("check:").unwrap().trim()),
            esc(&src),
            evs.join(","),
            fatal,
            esc(&stderr)
        );
    }
    println!("\n]");
}
