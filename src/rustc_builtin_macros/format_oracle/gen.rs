// Oracle probe for `src/rustc_builtin_macros/format.test.ts` (lane bm-format; not part of the build).
// Same design as lane bm-a's `builtins_oracle/gen.rs`:
//
// Runs `rustc_interface::run_compiler` (default options) to get a real `Session`, collects the builtin
// macros through `rustc_builtin_macros::register_builtin_macros`, then for each case of `cases.txt`
// parses `name!(..)` as an expression, sets `current_expansion.id` to a fresh expansion
// (`ExpnKind::Macro(Bang, name)`, call site = the call's span, the case's edition) and calls the
// registered `LegacyBang` expander (`format_args!` / `format_args_nl!` / ...) with the call's span and
// tokens. It prints `{:#?}` of `make_expr()` (the `ExprKind::FormatArgs` AST, or the error expression),
// then every buffered early lint (`{:?}` of its span and node id, the lint name) and emits each lint's
// diagnostic as a warning at the lint span, as `rustc_lint` would. Diagnostics go to stderr through the
// session's emitter; every case writes `== <name>` to stdout and stderr first.
//
// The resolver seen by the expanders is a mock (format.test.ts's run.ts has the same one):
//   resolve_dollar_crates      no-op
//   macro_accessible           Ok(true)
//   resolve_macro_invocation   the registered builtin of the invocation's last path segment
//                              (`SyntaxExtension::default(kind, case edition)`), after
//                              `set_expn_data(ext.expn_data(root, invoc.span(), name, Bang, None, None))`;
//                              prints `resolve_macro_invocation(<name>, force=<force>)`
//   take_derive_resolutions    None
//   everything else            unimplemented!()
// so that eager expansion (`format_args!(concat!(..))`) runs the real `fully_expand_fragment`.
//
// Regenerate (from this directory):
//
//   rustc +nightly-2026-10-11 --edition 2024 gen.rs -o $RUST_TS_DATA/tmp/bm-format/format_gen
//   DYLD_LIBRARY_PATH=$(rustc +nightly-2026-10-11 --print sysroot)/lib \
//     $RUST_TS_DATA/tmp/bm-format/format_gen cases.txt > out.stdout 2> out.stderr
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
    DeriveResolution, ExpandResult, ExtCtxt, Indeterminate, ModuleData, ResolverExpand,
    SyntaxExtension, SyntaxExtensionKind,
};
use rustc_expand::expand::{AstFragment, ExpansionConfig, Invocation, InvocationKind};
use rustc_feature::{EnabledLangFeature, Features};
use rustc_lint_defs::RegisteredTools;
use rustc_parse::lexer::StripTokens;
use rustc_session::config::{Input, Options};
use rustc_span::def_id::{CrateNum, DefId, LocalDefId};
use rustc_span::edition::Edition;
use rustc_span::hygiene::{AstPass, ExpnData, ExpnKind, LocalExpnId, MacroKind};
use rustc_span::{DUMMY_SP, FileName, Ident, Span, Symbol, sym};

/// Records `register_builtin_macro`; everything else is unused by `register_builtin_macros`.
struct Recorder(Vec<(Symbol, SyntaxExtensionKind)>);

/// The resolver seen by the expanders.
struct Mock {
    builtins: Rc<Vec<(Symbol, SyntaxExtensionKind)>>,
    edition: Edition,
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
    fn next_node_id(&mut self) -> NodeId { unimplemented!() }
    fn invocation_parent(&self, _: LocalExpnId) -> LocalDefId { unimplemented!() }
    fn resolve_dollar_crates(&self) {}
    fn visit_ast_fragment_with_placeholders(&mut self, _: LocalExpnId, _: &AstFragment) { unimplemented!() }
    fn register_builtin_macro(&mut self, _: Symbol, _: SyntaxExtensionKind) { unimplemented!() }
    fn expansion_for_ast_pass(&mut self, _: Span, _: AstPass, _: &[Symbol], _: Option<NodeId>) -> LocalExpnId { unimplemented!() }
    fn resolve_imports(&mut self) { unimplemented!() }
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
    fn declare_proc_macro(&mut self, _: NodeId) { unimplemented!() }
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
    edition: Edition,
    features: Vec<String>,
    pending: bool,
    src: String,
}

fn parse_cases(text: &str) -> Vec<Case> {
    text.lines()
        .filter(|l| !l.starts_with('#') && !l.trim().is_empty())
        .map(|l| {
            let f: Vec<&str> = l.splitn(5, " | ").collect();
            Case {
                name: f[0].to_string(),
                edition: match f[1] {
                    "2015" => Edition::Edition2015,
                    "2018" => Edition::Edition2018,
                    "2021" => Edition::Edition2021,
                    "2024" => Edition::Edition2024,
                    e => panic!("edition {e}"),
                },
                features: if f[2] == "-" { vec![] } else { f[2].split(',').map(String::from).collect() },
                pending: f[3] != "-",
                src: f[4].replace("\\n", "\n"),
            }
        })
        .collect()
}

static USING_INTERNAL_FEATURES: AtomicBool = AtomicBool::new(false);

fn main() {
    let path = std::env::args().nth(1).expect("cases.txt");
    let cases = parse_cases(&std::fs::read_to_string(path).unwrap());
    let config = rustc_interface::Config {
        opts: Options::default(),
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

        let mut recorder = Recorder(vec![]);
        rustc_builtin_macros::register_builtin_macros(&mut recorder);
        let builtins = Rc::new(recorder.0);

        for case in &cases {
            println!("== {}", case.name);
            eprintln!("== {}", case.name);
            let mut features = Features::default();
            for f in &case.features {
                features.set_enabled_lang_feature(EnabledLangFeature {
                    gate_name: Symbol::intern(f),
                    attr_sp: DUMMY_SP,
                    stable_since: None,
                });
            }
            let ecfg = ExpansionConfig::default(sym::main, &features);
            let mut mock = Mock { builtins: builtins.clone(), edition: case.edition };
            let mut cx = ExtCtxt::new(sess, ecfg, &mut mock, None);
            cx.current_expansion.module = Rc::new(ModuleData {
                mod_path: vec![Ident::with_dummy_span(sym::main)],
                file_path_stack: vec![],
                dir_path: Default::default(),
            });
            let fname = FileName::Custom(case.name.clone());
            let mut p = rustc_parse::unwrap_or_emit_fatal(rustc_parse::new_parser_from_source_str(
                &sess.psess,
                fname,
                case.src.clone(),
                StripTokens::Nothing,
            ));
            let e = p.parse_expr().map_err(|e| e.emit()).unwrap();
            let ast::ExprKind::MacCall(mac) = &e.kind else { panic!("not a macro call") };
            let name = mac.path.segments[0].ident.name;
            let span = e.span;
            let expn_data =
                ExpnData::default(ExpnKind::Macro(MacroKind::Bang, name), span, case.edition, None, None);
            cx.current_expansion.id = LocalExpnId::fresh(expn_data, NoSpanHcx);
            let ext = &builtins.iter().find(|(n, _)| *n == name).unwrap().1;
            let expander = ext.as_legacy_bang().expect("LegacyBang");
            if case.pending {
                println!("PENDING");
                continue;
            }
            match expander.expand(&mut cx, span, mac.args.tokens.clone()) {
                ExpandResult::Retry(()) => println!("Retry"),
                ExpandResult::Ready(mac) => println!("{:#?}", mac.make_expr()),
            }
            for lint in std::mem::take(&mut cx.buffered_early_lint) {
                println!("lint {} {:?} {:?}", lint.lint_id.lint.name, lint.span, lint.node_id);
                let mut diag = (lint.diagnostic.0)(sess.dcx(), Level::Warning(None), sess as &dyn std::any::Any);
                diag.span(lint.span.unwrap());
                diag.emit();
            }
        }
        println!("== end");
        eprintln!("== end");
    });
}
