// Oracle probe for `src/rustc_builtin_macros/rest.test.ts` (lane bm-rest; not part of the build).
//
// Covers test.rs, test_harness.rs, proc_macro_harness.rs, asm.rs, global_allocator.rs, eii.rs and
// contracts.rs. Same design as bm-a's builtins_oracle / bm-derive-a's derive_oracle, except that every
// case gets its own `rustc_interface::run_compiler` (fresh session globals, so hygiene ids and
// `AttrId`s restart per case and the case's session options apply). Each case writes `== <name>` to
// stdout and stderr first; diagnostics go to stderr through the session's default emitter.
//
// cases.txt: `name | kind | edition | options | pending | source` (`\n` in the source is a newline).
// options is `-` or a comma list of lang feature names plus these `@` options:
//   @test               `opts.test = true` (`sess.is_test_crate()`) and `ecfg.should_test = true`
//   @panic=abort|immediate-abort   `-C panic`
//   @panic_abort_tests  `-Z panic-abort-tests`
//   @target=<tuple>     `--target`
//   @asm_arch=<debug>   asserts `{:?}` of `sess.asm_arch` (`None`, `Some(X86_64)`, ...); the port's runner
//                       stores the same value in its deferred `Session::asm_arch` (rustc_target::asm is
//                       not ported)
//   @root=<path>        `cx.root_path`
//   @mod=a::b           `cx.current_expansion.module.mod_path` = `[main, a, b]` (default `[main]`)
//   @proc_macro_crate / @has_proc_macro_decls   the `proc_macro_harness::inject` arguments
//   @ext=<name>         attr kinds: look the expander up under <name> instead of the attribute's name
//                       (an EII's own attribute `#[foo]` runs `eii_shared_macro`)
// kinds:
//   attr / attr_stmt    parse one item, take its first attribute off; fresh `ExpnKind::Macro(Attr, name)`
//                       expansion; call the registered `LegacyAttr` expander with the attribute's span and
//                       meta item on `Annotatable::Item` (`attr_stmt`: `Annotatable::Stmt(StmtKind::Item)`);
//                       print `Ready`/`Retry` and `{:#?}` of every result
//   attr_expr           parse one expression, take its first attribute off; as `attr` on `Annotatable::Expr`
//   attr_ts             parse one item (tokens collected), take its first attribute off; call the registered
//                       `Attr` expander (`AttrProcMacro`, the contracts) with the attribute's span, its args'
//                       inner tokens and `Annotatable::Item(item).to_tokens()`; print `Ok`/`Err` and `{:#?}`
//   bang                parse `name!(..)` as an expression; fresh `ExpnKind::Macro(Bang, name)` expansion;
//                       call the registered `LegacyBang` expander with the call's span and tokens; print
//                       `{:#?}` of `make_items()` for `global_asm!`, of `make_expr()` otherwise
//   test_harness        parse a crate; `test_harness::inject(&mut krate, sess, &features, &mut mock)`;
//                       print `{:#?}` of the crate
//   proc_macro_harness  parse a crate; `proc_macro_harness::inject(&mut krate, sess, &features, &mut mock,
//                       @proc_macro_crate, @has_proc_macro_decls, sess.is_test_crate(), sess.dcx())`;
//                       print `{:#?}` of the crate
// After each case: every buffered early lint (`sess.psess.buffered_lints`, then `cx.buffered_early_lint`)
// is printed (`lint <name> <span> <node id>`) and its diagnostic emitted as a warning at the lint span;
// then the error count is reset.
//
// The mock resolver (run.ts has the same one) logs `expansion_for_ast_pass` (a real
// `LocalExpnId::fresh(ExpnData::allow_unstable(AstPass(pass), call_site, sess.edition(), features, None,
// None))`), `declare_proc_macro`, `visit_ast_fragment_with_placeholders` and `resolve_imports`; `next_node_id`
// counts up from `NodeId(1)`; `resolve_dollar_crates` is a no-op, `macro_accessible` is `Ok(true)`,
// `take_derive_resolutions` is `None`, `resolve_macro_invocation` resolves to the registered builtin
// (as in format_oracle); everything else is `unimplemented!()`.
//
// Regenerate (from this directory):
//
//   rustc +nightly-2026-10-11 --edition 2024 probe.rs -o $RUST_TS_DATA/tmp/bm-rest/probe
//   DYLD_LIBRARY_PATH=$(rustc +nightly-2026-10-11 --print sysroot)/lib \
//     $RUST_TS_DATA/tmp/bm-rest/probe cases.txt > out.stdout 2> out.stderr
//
// (`LD_LIBRARY_PATH` / `PATH` instead of `DYLD_LIBRARY_PATH` on Linux / Windows.)
#![feature(rustc_private)]
extern crate rustc_ast;
extern crate rustc_attr_ir;
extern crate rustc_builtin_macros;
extern crate rustc_data_structures;
extern crate rustc_driver;
extern crate rustc_errors;
extern crate rustc_expand;
extern crate rustc_feature;
extern crate rustc_hashes;
extern crate rustc_interface;
extern crate rustc_lint_defs;
extern crate rustc_parse;
extern crate rustc_session;
extern crate rustc_span;
extern crate rustc_target;

use std::path::PathBuf;
use std::rc::Rc;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use rustc_ast::{self as ast, NodeId};
use rustc_attr_ir::CfgEntry;
use rustc_data_structures::fingerprint::Fingerprint;
use rustc_data_structures::stable_hash::{
    RawDefId, RawSpan, StableHashControls, StableHashCtxt, StableHasher,
};
use rustc_errors::Level;
use rustc_expand::base::{
    Annotatable, DeriveResolution, ExpandResult, ExtCtxt, Indeterminate, ModuleData,
    ResolverExpand, SyntaxExtension, SyntaxExtensionKind,
};
use rustc_expand::expand::{AstFragment, ExpansionConfig, Invocation, InvocationKind};
use rustc_feature::{EnabledLangFeature, Features};
use rustc_lint_defs::RegisteredTools;
use rustc_parse::lexer::StripTokens;
use rustc_parse::parser::{AllowConstBlockItems, ForceCollect};
use rustc_session::config::{Input, Options};
use rustc_span::def_id::{CrateNum, DefId, LocalDefId};
use rustc_span::edition::Edition;
use rustc_span::hygiene::{AstPass, ExpnData, ExpnKind, LocalExpnId, MacroKind};
use rustc_span::{DUMMY_SP, FileName, Ident, Span, Symbol, sym};
use rustc_target::spec::{PanicStrategy, TargetTuple};

/// Records `register_builtin_macro`; everything else is unused by `register_builtin_macros`.
struct Recorder(Vec<(Symbol, SyntaxExtensionKind)>);

/// The resolver seen by the expanders and the harnesses.
struct Mock {
    builtins: Rc<Vec<(Symbol, SyntaxExtensionKind)>>,
    edition: Edition,
    next_node_id: NodeId,
}

/// `ExpnData` hashing for `LocalExpnId::fresh`: spans hash to nothing, the default controls.
struct NoSpanHcx;
impl StableHashCtxt for NoSpanHcx {
    fn stable_hash_span(&mut self, _: RawSpan, _: &mut StableHasher) {}
    fn def_path_hash(&self, _: RawDefId) -> Fingerprint { Fingerprint::ZERO }
    fn stable_hash_controls(&self) -> StableHashControls { StableHashControls { hash_spans: false } }
    fn assert_default_stable_hash_controls(&self, _: &str) {}
}

impl ResolverExpand for Recorder {
    fn next_node_id(&mut self) -> NodeId { unimplemented!() }
    fn invocation_parent(&self, _: LocalExpnId) -> LocalDefId { unimplemented!() }
    fn resolve_dollar_crates(&self) { unimplemented!() }
    fn visit_ast_fragment_with_placeholders(&mut self, _: LocalExpnId, _: &AstFragment) { unimplemented!() }
    fn register_builtin_macro(&mut self, name: Symbol, ext: SyntaxExtensionKind) { self.0.push((name, ext)) }
    fn expansion_for_ast_pass(&mut self, _: Span, _: AstPass, _: &[Symbol], _: Option<NodeId>) -> LocalExpnId { unimplemented!() }
    fn resolve_imports(&mut self) { unimplemented!() }
    fn resolve_macro_invocation(&mut self, _: &Invocation, _: LocalExpnId, _: bool) -> Result<Arc<SyntaxExtension>, Indeterminate> { unimplemented!() }
    fn record_macro_rule_usage(&mut self, _: NodeId, _: usize) { unimplemented!() }
    fn check_unused_macros(&mut self) { unimplemented!() }
    fn has_derive_copy(&self, _: LocalExpnId) -> bool { unimplemented!() }
    fn has_derive_ord(&self, _: LocalExpnId) -> bool { unimplemented!() }
    fn resolve_derives(&mut self, _: LocalExpnId, _: bool, _: &dyn Fn() -> Vec<DeriveResolution>) -> Result<(), Indeterminate> { unimplemented!() }
    fn take_derive_resolutions(&mut self, _: LocalExpnId) -> Option<Vec<DeriveResolution>> { unimplemented!() }
    fn cfg_accessible(&mut self, _: LocalExpnId, _: &ast::Path) -> Result<bool, Indeterminate> { unimplemented!() }
    fn macro_accessible(&mut self, _: LocalExpnId, _: &ast::Path) -> Result<bool, Indeterminate> { unimplemented!() }
    fn get_proc_macro_quoted_span(&self, _: CrateNum, _: usize) -> Span { unimplemented!() }
    fn declare_proc_macro(&mut self, _: NodeId) { unimplemented!() }
    fn append_stripped_cfg_item(&mut self, _: NodeId, _: Ident, _: CfgEntry, _: Span) { unimplemented!() }
    fn registered_attr_tools(&self) -> &RegisteredTools { unimplemented!() }
    fn registered_lint_tools(&self) -> &RegisteredTools { unimplemented!() }
    fn register_glob_delegation(&mut self, _: LocalExpnId) { unimplemented!() }
    fn glob_delegation_suffixes(&self, _: DefId, _: LocalDefId, _: Span) -> Result<Vec<(Ident, Option<Ident>)>, Indeterminate> { unimplemented!() }
    fn insert_impl_trait_name(&mut self, _: NodeId, _: Symbol) { unimplemented!() }
    fn mark_scope_with_compile_error(&mut self, _: NodeId) { unimplemented!() }
}

impl ResolverExpand for Mock {
    fn next_node_id(&mut self) -> NodeId {
        let id = self.next_node_id;
        self.next_node_id = NodeId::from_u32(id.as_u32() + 1);
        id
    }
    fn invocation_parent(&self, _: LocalExpnId) -> LocalDefId { unimplemented!() }
    fn resolve_dollar_crates(&self) {}
    fn visit_ast_fragment_with_placeholders(&mut self, expn_id: LocalExpnId, _: &AstFragment) {
        println!("visit_ast_fragment_with_placeholders({expn_id:?})");
    }
    fn register_builtin_macro(&mut self, _: Symbol, _: SyntaxExtensionKind) { unimplemented!() }
    fn expansion_for_ast_pass(&mut self, call_site: Span, pass: AstPass, features: &[Symbol], parent_module_id: Option<NodeId>) -> LocalExpnId {
        let expn_id = LocalExpnId::fresh(
            ExpnData::allow_unstable(ExpnKind::AstPass(pass), call_site, self.edition, features.into(), None, None),
            NoSpanHcx,
        );
        println!("expansion_for_ast_pass({call_site:?}, {pass:?}, {features:?}, {parent_module_id:?}) -> {expn_id:?}");
        expn_id
    }
    fn resolve_imports(&mut self) { println!("resolve_imports"); }
    fn resolve_macro_invocation(&mut self, invoc: &Invocation, root: LocalExpnId, force: bool) -> Result<Arc<SyntaxExtension>, Indeterminate> {
        let InvocationKind::Bang { mac, .. } = &invoc.kind else { unimplemented!() };
        let name = mac.path.segments.last().unwrap().ident.name;
        println!("resolve_macro_invocation({name}, force={force})");
        let kind = self.builtins.iter().find(|(n, _)| *n == name).unwrap().1.clone();
        let ext = Arc::new(SyntaxExtension::default(kind, self.edition));
        invoc.expansion_data.id.set_expn_data(
            ext.expn_data(root, invoc.span(), name, MacroKind::Bang, None, None),
            NoSpanHcx,
        );
        Ok(ext)
    }
    fn record_macro_rule_usage(&mut self, _: NodeId, _: usize) { unimplemented!() }
    fn check_unused_macros(&mut self) { unimplemented!() }
    fn has_derive_copy(&self, _: LocalExpnId) -> bool { unimplemented!() }
    fn has_derive_ord(&self, _: LocalExpnId) -> bool { unimplemented!() }
    fn resolve_derives(&mut self, _: LocalExpnId, _: bool, _: &dyn Fn() -> Vec<DeriveResolution>) -> Result<(), Indeterminate> { unimplemented!() }
    fn take_derive_resolutions(&mut self, _: LocalExpnId) -> Option<Vec<DeriveResolution>> { None }
    fn cfg_accessible(&mut self, _: LocalExpnId, _: &ast::Path) -> Result<bool, Indeterminate> { unimplemented!() }
    fn macro_accessible(&mut self, _: LocalExpnId, _: &ast::Path) -> Result<bool, Indeterminate> { Ok(true) }
    fn get_proc_macro_quoted_span(&self, _: CrateNum, _: usize) -> Span { unimplemented!() }
    fn declare_proc_macro(&mut self, id: NodeId) { println!("declare_proc_macro({id:?})"); }
    fn append_stripped_cfg_item(&mut self, _: NodeId, _: Ident, _: CfgEntry, _: Span) { unimplemented!() }
    fn registered_attr_tools(&self) -> &RegisteredTools { unimplemented!() }
    fn registered_lint_tools(&self) -> &RegisteredTools { unimplemented!() }
    fn register_glob_delegation(&mut self, _: LocalExpnId) { unimplemented!() }
    fn glob_delegation_suffixes(&self, _: DefId, _: LocalDefId, _: Span) -> Result<Vec<(Ident, Option<Ident>)>, Indeterminate> { unimplemented!() }
    fn insert_impl_trait_name(&mut self, _: NodeId, _: Symbol) { unimplemented!() }
    fn mark_scope_with_compile_error(&mut self, _: NodeId) { unimplemented!() }
}

struct Case {
    name: String,
    kind: String,
    edition: Edition,
    features: Vec<String>,
    opts: Vec<(String, String)>,
    src: String,
}

impl Case {
    fn has(&self, k: &str) -> bool { self.opts.iter().any(|(o, _)| o == k) }
    fn get(&self, k: &str) -> Option<&str> { self.opts.iter().find(|(o, _)| o == k).map(|(_, v)| v.as_str()) }
}

fn parse_cases(text: &str) -> Vec<Case> {
    text.lines()
        .filter(|l| !l.starts_with('#') && !l.trim().is_empty())
        .map(|l| {
            let f: Vec<&str> = l.splitn(6, " | ").collect();
            let list: Vec<String> = if f[3] == "-" { vec![] } else { f[3].split(',').map(String::from).collect() };
            Case {
                name: f[0].to_string(),
                kind: f[1].to_string(),
                edition: match f[2] {
                    "2015" => Edition::Edition2015,
                    "2018" => Edition::Edition2018,
                    "2021" => Edition::Edition2021,
                    "2024" => Edition::Edition2024,
                    e => panic!("edition {e}"),
                },
                features: list.iter().filter(|f| !f.starts_with('@')).cloned().collect(),
                opts: list
                    .iter()
                    .filter_map(|f| f.strip_prefix('@'))
                    .map(|f| match f.split_once('=') {
                        Some((k, v)) => (k.to_string(), v.to_string()),
                        None => (f.to_string(), String::new()),
                    })
                    .collect(),
                src: f[5].replace("\\n", "\n"),
            }
        })
        .collect()
}

fn print_result(res: ExpandResult<Vec<Annotatable>, Annotatable>) {
    match res {
        ExpandResult::Retry(a) => println!("Retry {a:#?}"),
        ExpandResult::Ready(v) => {
            println!("Ready {}", v.len());
            for a in v {
                println!("{a:#?}");
            }
        }
    }
}

static USING_INTERNAL_FEATURES: AtomicBool = AtomicBool::new(false);

fn run_case(case: &Case) {
    let mut opts = Options::default();
    opts.edition = case.edition;
    if case.has("test") {
        opts.test = true;
    }
    match case.get("panic") {
        Some("abort") => opts.cg.panic = Some(PanicStrategy::Abort),
        Some("immediate-abort") => opts.cg.panic = Some(PanicStrategy::ImmediateAbort),
        Some(p) => panic!("panic={p}"),
        None => {}
    }
    if case.has("panic_abort_tests") {
        opts.unstable_opts.panic_abort_tests = true;
    }
    if let Some(t) = case.get("target") {
        opts.target_triple = TargetTuple::from_tuple(t);
    }
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
        if let Some(a) = case.get("asm_arch") {
            assert_eq!(format!("{:?}", sess.asm_arch), a, "@asm_arch");
        }

        let mut recorder = Recorder(vec![]);
        rustc_builtin_macros::register_builtin_macros(&mut recorder);
        let builtins = Rc::new(recorder.0);

        let mut features = Features::default();
        for f in &case.features {
            features.set_enabled_lang_feature(EnabledLangFeature {
                gate_name: Symbol::intern(f),
                attr_sp: DUMMY_SP,
                stable_since: None,
            });
        }
        let mut mock = Mock { builtins: builtins.clone(), edition: case.edition, next_node_id: NodeId::from_u32(1) };
        let fname = FileName::Custom(case.name.clone());
        let mut p = rustc_parse::unwrap_or_emit_fatal(rustc_parse::new_parser_from_source_str(
            &sess.psess,
            fname,
            case.src.clone(),
            StripTokens::Nothing,
        ));
        let mut early_lints = vec![];
        match case.kind.as_str() {
            "test_harness" | "proc_macro_harness" => {
                let mut krate = p.parse_crate_mod().map_err(|e| e.emit()).unwrap();
                if case.kind == "test_harness" {
                    rustc_builtin_macros::test_harness::inject(&mut krate, sess, &features, &mut mock);
                } else {
                    rustc_builtin_macros::proc_macro_harness::inject(
                        &mut krate,
                        sess,
                        &features,
                        &mut mock,
                        case.has("proc_macro_crate"),
                        case.has("has_proc_macro_decls"),
                        sess.is_test_crate(),
                        sess.dcx(),
                    );
                }
                println!("{krate:#?}");
            }
            kind => {
                let mut ecfg = ExpansionConfig::default(sym::main, &features);
                ecfg.should_test = case.has("test");
                let mut cx = ExtCtxt::new(sess, ecfg, &mut mock, None);
                let mut mod_path = vec![Ident::with_dummy_span(sym::main)];
                if let Some(m) = case.get("mod") {
                    mod_path.extend(m.split("::").map(|s| Ident::from_str(s)));
                }
                cx.current_expansion.module = Rc::new(ModuleData {
                    mod_path,
                    file_path_stack: vec![],
                    dir_path: Default::default(),
                });
                if let Some(r) = case.get("root") {
                    cx.root_path = PathBuf::from(r);
                }
                let find = |name: Symbol| &builtins.iter().find(|(n, _)| *n == name).unwrap().1;
                match kind {
                    "bang" => {
                        let e = p.parse_expr().map_err(|e| e.emit()).unwrap();
                        let ast::ExprKind::MacCall(mac) = &e.kind else { panic!("not a macro call") };
                        let name = mac.path.segments[0].ident.name;
                        let span = e.span;
                        let expn_data = ExpnData::default(ExpnKind::Macro(MacroKind::Bang, name), span, case.edition, None, None);
                        cx.current_expansion.id = LocalExpnId::fresh(expn_data, NoSpanHcx);
                        let expander = find(name).as_legacy_bang().expect("LegacyBang");
                        match expander.expand(&mut cx, span, mac.args.tokens.clone()) {
                            ExpandResult::Retry(()) => println!("Retry"),
                            ExpandResult::Ready(mac) => {
                                if name == sym::global_asm {
                                    println!("{:#?}", mac.make_items());
                                } else {
                                    println!("{:#?}", mac.make_expr());
                                }
                            }
                        }
                    }
                    "attr_ts" => {
                        let mut item = p.parse_item(ForceCollect::Yes, AllowConstBlockItems::Yes).map_err(|e| e.emit()).unwrap().unwrap();
                        let attr = item.attrs.remove(0);
                        let name = attr.name().unwrap();
                        let expn_data = ExpnData::default(ExpnKind::Macro(MacroKind::Attr, name), attr.span, case.edition, None, None);
                        cx.current_expansion.id = LocalExpnId::fresh(expn_data, NoSpanHcx);
                        let SyntaxExtensionKind::Attr(expander) = find(name) else { panic!("Attr") };
                        let annotation = attr.get_normal_item().args.inner_tokens();
                        let annotated = Annotatable::Item(item).to_tokens();
                        match expander.expand(&mut cx, attr.span, annotation, annotated) {
                            Ok(ts) => println!("Ok {ts:#?}"),
                            Err(_) => println!("Err"),
                        }
                    }
                    "attr_expr" => {
                        let mut e = p.parse_expr().map_err(|e| e.emit()).unwrap();
                        let attr = e.attrs.remove(0);
                        let name = attr.name().unwrap();
                        let meta = attr.meta().unwrap();
                        let expn_data = ExpnData::default(ExpnKind::Macro(MacroKind::Attr, name), attr.span, case.edition, None, None);
                        cx.current_expansion.id = LocalExpnId::fresh(expn_data, NoSpanHcx);
                        let ext_name = case.get("ext").map(Symbol::intern).unwrap_or(name);
                        let SyntaxExtensionKind::LegacyAttr(expander) = find(ext_name) else { panic!("LegacyAttr") };
                        print_result(expander.expand(&mut cx, attr.span, &meta, Annotatable::Expr(e), false));
                    }
                    "attr" | "attr_stmt" => {
                        let mut item = p.parse_item(ForceCollect::No, AllowConstBlockItems::Yes).map_err(|e| e.emit()).unwrap().unwrap();
                        let attr = item.attrs.remove(0);
                        let name = attr.name().unwrap();
                        let meta = attr.meta().unwrap();
                        let annotatable = if kind == "attr_stmt" {
                            let span = item.span;
                            Annotatable::Stmt(Box::new(ast::Stmt { id: ast::DUMMY_NODE_ID, kind: ast::StmtKind::Item(item), span }))
                        } else {
                            Annotatable::Item(item)
                        };
                        let expn_data = ExpnData::default(ExpnKind::Macro(MacroKind::Attr, name), attr.span, case.edition, None, None);
                        cx.current_expansion.id = LocalExpnId::fresh(expn_data, NoSpanHcx);
                        let ext_name = case.get("ext").map(Symbol::intern).unwrap_or(name);
                        let SyntaxExtensionKind::LegacyAttr(expander) = find(ext_name) else { panic!("LegacyAttr") };
                        print_result(expander.expand(&mut cx, attr.span, &meta, annotatable, false));
                    }
                    k => panic!("kind {k}"),
                }
                early_lints = std::mem::take(&mut cx.buffered_early_lint);
            }
        }
        let lints = std::mem::take(&mut *sess.psess.buffered_lints.lock());
        for lint in lints.into_iter().chain(early_lints) {
            println!("lint {} {:?} {:?}", lint.lint_id.lint.name, lint.span, lint.node_id);
            let mut diag = (lint.diagnostic.0)(sess.dcx(), Level::Warning(None), sess as &dyn std::any::Any);
            diag.span(lint.span.unwrap());
            diag.emit();
        }
        sess.dcx().reset_err_count();
    });
}

fn main() {
    let path = std::env::args().nth(1).expect("cases.txt");
    let cases = parse_cases(&std::fs::read_to_string(path).unwrap());
    for case in &cases {
        println!("== {}", case.name);
        eprintln!("== {}", case.name);
        run_case(case);
    }
    println!("== end");
    eprintln!("== end");
}
