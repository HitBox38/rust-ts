// Oracle probe for `src/rustc_builtin_macros/builtins.test.ts` (lane bm-a; not part of the build).
//
// Runs `rustc_interface::run_compiler` (default options, `--edition` per case) to get a real
// `Session`, collects the builtin macros through `rustc_builtin_macros::register_builtin_macros`
// with a recording resolver, then runs each case of `cases.txt` through the registered expander:
//   - `bang`: parses `name!(..)` as an expression, sets `current_expansion.id` to a fresh expansion
//     (`ExpnKind::Macro(Bang, name)`, call site = the call's span, the case's edition), calls the
//     `LegacyBang` expander with the call's span and tokens and prints `{:?}` of `make_<fragment>()`;
//   - `attr`: parses an item, takes its first attribute off (as `take_first_attr` does), sets a fresh
//     `ExpnKind::Macro(Attr, name)` expansion, calls the `LegacyAttr` expander with the attribute's span
//     and meta item and prints `Ready`/`Retry` with `{:?}` of every `Annotatable`.
// Every case writes `== <name>` to stdout and stderr first; diagnostics go to stderr through the
// session's emitter. The resolver used during expansion answers `cfg_accessible` from the path's
// last segment (`yes` -> true, `no` -> false, else `Indeterminate`), prints the calls of
// `mark_scope_with_compile_error` / `append_stripped_cfg_item`, and is `unimplemented!()` otherwise.
// builtins.test.ts runs `builtins_oracle/run.ts` (the same steps on the port) and compares stdout and
// stderr case by case (pending cases must stop with `unported`).
//
// Regenerate (from this directory):
//
//   rustc +nightly-2026-10-11 --edition 2024 gen.rs -o $RUST_TS_DATA/tmp/bm-a/builtins_gen
//   DYLD_LIBRARY_PATH=$(rustc +nightly-2026-10-11 --print sysroot)/lib \
//     $RUST_TS_DATA/tmp/bm-a/builtins_gen cases.txt > out.stdout 2> out.stderr
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
use rustc_expand::base::{
    Annotatable, DeriveResolution, ExpandResult, ExtCtxt, Indeterminate, ModuleData,
    ResolverExpand, SyntaxExtension, SyntaxExtensionKind,
};
use rustc_expand::expand::{AstFragment, ExpansionConfig, Invocation};
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
struct Mock;

macro_rules! resolver_impl {
    ($ty:ty, $self:ident, register = $register:expr, cfg_accessible = $cfg:expr, compile_error = $ce:expr, stripped = $st:expr) => {
        impl ResolverExpand for $ty {
            fn next_node_id(&mut self) -> NodeId { unimplemented!() }
            fn invocation_parent(&self, _: LocalExpnId) -> LocalDefId { unimplemented!() }
            fn resolve_dollar_crates(&self) { unimplemented!() }
            fn visit_ast_fragment_with_placeholders(&mut self, _: LocalExpnId, _: &AstFragment) { unimplemented!() }
            fn register_builtin_macro(&mut $self, name: Symbol, ext: SyntaxExtensionKind) { $register(&mut *$self, name, ext) }
            fn expansion_for_ast_pass(&mut self, _: Span, _: AstPass, _: &[Symbol], _: Option<NodeId>) -> LocalExpnId { unimplemented!() }
            fn resolve_imports(&mut self) { unimplemented!() }
            fn resolve_macro_invocation(&mut self, _: &Invocation, _: LocalExpnId, _: bool) -> Result<Arc<SyntaxExtension>, Indeterminate> { unimplemented!() }
            fn record_macro_rule_usage(&mut self, _: NodeId, _: usize) { unimplemented!() }
            fn check_unused_macros(&mut self) { unimplemented!() }
            fn has_derive_copy(&self, _: LocalExpnId) -> bool { unimplemented!() }
            fn has_derive_ord(&self, _: LocalExpnId) -> bool { unimplemented!() }
            fn resolve_derives(&mut self, _: LocalExpnId, _: bool, _: &dyn Fn() -> Vec<DeriveResolution>) -> Result<(), Indeterminate> { unimplemented!() }
            fn take_derive_resolutions(&mut self, _: LocalExpnId) -> Option<Vec<DeriveResolution>> { unimplemented!() }
            fn cfg_accessible(&mut self, _: LocalExpnId, path: &ast::Path) -> Result<bool, Indeterminate> { $cfg(path) }
            fn macro_accessible(&mut self, _: LocalExpnId, _: &ast::Path) -> Result<bool, Indeterminate> { unimplemented!() }
            fn get_proc_macro_quoted_span(&self, _: CrateNum, _: usize) -> Span { unimplemented!() }
            fn declare_proc_macro(&mut self, _: NodeId) { unimplemented!() }
            fn append_stripped_cfg_item(&mut self, node: NodeId, name: Ident, cfg: CfgEntry, span: Span) { $st(node, name, cfg, span) }
            fn registered_attr_tools(&self) -> &RegisteredTools { unimplemented!() }
            fn registered_lint_tools(&self) -> &RegisteredTools { unimplemented!() }
            fn register_glob_delegation(&mut self, _: LocalExpnId) { unimplemented!() }
            fn glob_delegation_suffixes(&self, _: DefId, _: LocalDefId, _: Span) -> Result<Vec<(Ident, Option<Ident>)>, Indeterminate> { unimplemented!() }
            fn insert_impl_trait_name(&mut self, _: NodeId, _: Symbol) { unimplemented!() }
            fn mark_scope_with_compile_error(&mut self, node: NodeId) { $ce(node) }
        }
    };
}

resolver_impl!(Recorder, self,
    register = |r: &mut Recorder, name, ext| r.0.push((name, ext)),
    cfg_accessible = |_: &ast::Path| unimplemented!(),
    compile_error = |_: NodeId| unimplemented!(),
    stripped = |_: NodeId, _: Ident, _: CfgEntry, _: Span| unimplemented!());

resolver_impl!(Mock, self,
    register = |_: &mut Mock, _, _| unimplemented!(),
    cfg_accessible = |path: &ast::Path| match path.segments.last().unwrap().ident.as_str() {
        "yes" => Ok(true),
        "no" => Ok(false),
        _ => Err(Indeterminate),
    },
    compile_error = |node: NodeId| println!("mark_scope_with_compile_error({node:?})"),
    stripped = |node: NodeId, name: Ident, cfg: CfgEntry, span: Span| {
        println!("append_stripped_cfg_item({node:?}, {name:?}, {cfg:?}, {span:?})")
    });

/// `ExpnData` hashing for `LocalExpnId::fresh`: spans hash to nothing, the default controls.
struct NoSpanHcx;
impl StableHashCtxt for NoSpanHcx {
    fn stable_hash_span(&mut self, _: RawSpan, _: &mut StableHasher) {}
    fn def_path_hash(&self, _: RawDefId) -> Fingerprint { Fingerprint::ZERO }
    fn stable_hash_controls(&self) -> StableHashControls { StableHashControls { hash_spans: false } }
    fn assert_default_stable_hash_controls(&self, _: &str) {}
}

fn kind_name(k: &SyntaxExtensionKind) -> &'static str {
    match k {
        SyntaxExtensionKind::MacroRules(..) => "MacroRules",
        SyntaxExtensionKind::Bang(..) => "Bang",
        SyntaxExtensionKind::LegacyBang(..) => "LegacyBang",
        SyntaxExtensionKind::Attr(..) => "Attr",
        SyntaxExtensionKind::LegacyAttr(..) => "LegacyAttr",
        SyntaxExtensionKind::NonMacroAttr => "NonMacroAttr",
        SyntaxExtensionKind::Derive(..) => "Derive",
        SyntaxExtensionKind::LegacyDerive(..) => "LegacyDerive",
        SyntaxExtensionKind::GlobDelegation(..) => "GlobDelegation",
    }
}

struct Case {
    name: String,
    kind: String,
    frag: String,
    edition: Edition,
    features: Vec<String>,
    pending: bool,
    src: String,
}

fn parse_cases(text: &str) -> Vec<Case> {
    text.lines()
        .filter(|l| !l.starts_with('#') && !l.trim().is_empty())
        .map(|l| {
            let f: Vec<&str> = l.splitn(7, " | ").collect();
            Case {
                name: f[0].to_string(),
                kind: f[1].to_string(),
                frag: f[2].to_string(),
                edition: match f[3] {
                    "2015" => Edition::Edition2015,
                    "2018" => Edition::Edition2018,
                    "2021" => Edition::Edition2021,
                    "2024" => Edition::Edition2024,
                    e => panic!("edition {e}"),
                },
                features: if f[4] == "-" { vec![] } else { f[4].split(',').map(String::from).collect() },
                pending: f[5] != "-",
                src: f[6].replace("\\n", "\n"),
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
        println!("== register_builtin_macros");
        eprintln!("== register_builtin_macros");
        for (name, kind) in &recorder.0 {
            println!("{name} {}", kind_name(kind));
        }

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
            let mut mock = Mock;
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
            match case.kind.as_str() {
                "bang" => {
                    let e = p.parse_expr().map_err(|e| e.emit()).unwrap();
                    let ast::ExprKind::MacCall(mac) = &e.kind else { panic!("not a macro call") };
                    let name = mac.path.segments[0].ident.name;
                    let span = e.span;
                    let expn_data = ExpnData::default(
                        ExpnKind::Macro(MacroKind::Bang, name),
                        span,
                        case.edition,
                        None,
                        None,
                    );
                    cx.current_expansion.id = LocalExpnId::fresh(expn_data, NoSpanHcx);
                    let ext = &recorder.0.iter().find(|(n, _)| *n == name).unwrap().1;
                    let expander = ext.as_legacy_bang().expect("LegacyBang");
                    if case.pending {
                        println!("PENDING");
                        continue;
                    }
                    let res = expander.expand(&mut cx, span, mac.args.tokens.clone());
                    match res {
                        ExpandResult::Retry(()) => println!("Retry"),
                        ExpandResult::Ready(mac) => match case.frag.as_str() {
                            "expr" => println!("{:#?}", mac.make_expr()),
                            "ty" => println!("{:#?}", mac.make_ty()),
                            "items" => println!("{:#?}", mac.make_items()),
                            "stmts" => println!("{:#?}", mac.make_stmts()),
                            "pat" => println!("{:#?}", mac.make_pat()),
                            f => panic!("fragment {f}"),
                        },
                    }
                }
                "attr" => {
                    let mut item = p
                        .parse_item(rustc_parse::parser::ForceCollect::No, rustc_parse::parser::AllowConstBlockItems::Yes)
                        .map_err(|e| e.emit())
                        .unwrap()
                        .unwrap();
                    let attr = item.attrs.remove(0);
                    let name = attr.name().unwrap();
                    let meta = attr.meta().unwrap();
                    let expn_data = ExpnData::default(
                        ExpnKind::Macro(MacroKind::Attr, name),
                        attr.span,
                        case.edition,
                        None,
                        None,
                    );
                    cx.current_expansion.id = LocalExpnId::fresh(expn_data, NoSpanHcx);
                    let ext = &recorder.0.iter().find(|(n, _)| *n == name).unwrap().1;
                    let SyntaxExtensionKind::LegacyAttr(expander) = ext else { panic!("LegacyAttr") };
                    if case.pending {
                        println!("PENDING");
                        continue;
                    }
                    match expander.expand(&mut cx, attr.span, &meta, Annotatable::Item(item), false) {
                        ExpandResult::Retry(a) => println!("Retry {a:#?}"),
                        ExpandResult::Ready(v) => {
                            println!("Ready {}", v.len());
                            for a in v {
                                println!("{a:#?}");
                            }
                        }
                    }
                }
                k => panic!("kind {k}"),
            }
        }
        println!("== end");
        eprintln!("== end");
    });
}
