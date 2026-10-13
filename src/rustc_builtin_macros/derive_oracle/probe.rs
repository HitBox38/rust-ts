// Oracle probe for `src/rustc_builtin_macros/derive.test.ts` (lane bm-derive-a; not part of the build).
//
// Runs `rustc_interface::run_compiler` (default options) to get a real `Session`, collects the builtin
// macros through `rustc_builtin_macros::register_builtin_macros` with a recording resolver, then runs
// each case of `cases.txt`. Every case parses one item (`FileName::Custom(<case name>)`), takes its
// first attribute off (as `take_first_attr` does) and sets `current_expansion.id` to a fresh expansion:
//   - `attr` / `attr_stmt`: the attribute is `#[derive(..)]` / `#[derive_const(..)]`; the expansion is
//     `ExpnKind::Macro(Attr, name)` with the attribute's span as call site; the registered `LegacyAttr`
//     expander (`derive::Expander`) is called with the attribute's span and meta item on
//     `Annotatable::Item(item)` (`attr_stmt`: on `Annotatable::Stmt` of a `StmtKind::Item`). Prints
//     `Ready`/`Retry` and `{:#?}` of every `Annotatable`.
//   - `builtin` / `builtin_stmt`: the attribute is `#[derive(Name)]` / `#[derive_const(Name)]`; the
//     expansion is `ExpnKind::Macro(Derive, Name)` with `Name`'s path span as call site, and the registered
//     `LegacyDerive` expander of `Name` (`deriving::BuiltinDerive`) is called with that span, `Name`'s meta
//     item and `is_derive_const` (`derive_const`). Prints `Ready`/`Retry` and `{:#?}` of every result.
// Every case writes `== <name>` to stdout and stderr first; diagnostics go to stderr through the
// session's emitter. The resolver's `resolve_derives` calls the `derive_paths` closure once, prints
// every resolution (`{:?}` of the path, `is_const`, whether `exts` is set, `{:#?}` of the item) and
// returns `Err(Indeterminate)` if a path's last segment is `later` and `force` is false, else `Ok(())`;
// `has_derive_copy` / `has_derive_ord` print their call and answer `false`. Every other resolver method
// is `unimplemented!()`.
//
// derive.test.ts runs `derive_oracle/run.ts` (the same steps on the port) and compares stdout and stderr
// case by case. The pending column of cases.txt is ignored here (every case is recorded); the port must
// stop at an `unported` path for a pending case (the individual derives are lane bm-derive-b's).
//
// Regenerate (from this directory):
//
//   rustc +nightly-2026-10-11 --edition 2024 probe.rs -o $RUST_TS_DATA/tmp/bm-derive-a/probe
//   DYLD_LIBRARY_PATH=$(rustc +nightly-2026-10-11 --print sysroot)/lib \
//     $RUST_TS_DATA/tmp/bm-derive-a/probe cases.txt > out.stdout 2> out.stderr
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
    ($ty:ty, $self:ident, register = $register:expr, resolve_derives = $rd:expr) => {
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
            fn has_derive_copy(&self, _: LocalExpnId) -> bool { println!("has_derive_copy -> false"); false }
            fn has_derive_ord(&self, _: LocalExpnId) -> bool { println!("has_derive_ord -> false"); false }
            fn resolve_derives(&mut self, _: LocalExpnId, force: bool, derive_paths: &dyn Fn() -> Vec<DeriveResolution>) -> Result<(), Indeterminate> { $rd(force, derive_paths) }
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
    };
}

resolver_impl!(Recorder, self,
    register = |r: &mut Recorder, name, ext| r.0.push((name, ext)),
    resolve_derives = |_: bool, _: &dyn Fn() -> Vec<DeriveResolution>| unimplemented!());

resolver_impl!(Mock, self,
    register = |_: &mut Mock, _, _| unimplemented!(),
    resolve_derives = |force: bool, derive_paths: &dyn Fn() -> Vec<DeriveResolution>| {
        println!("resolve_derives(force = {force})");
        let resolutions = derive_paths();
        let mut indeterminate = false;
        for r in &resolutions {
            println!("resolution {:?} is_const={} exts={}", r.path, r.is_const, r.exts.is_some());
            println!("{:#?}", r.item);
            if r.path.segments.last().unwrap().ident.as_str() == "later" {
                indeterminate = true;
            }
        }
        if indeterminate && !force { Err(Indeterminate) } else { Ok(()) }
    });

/// `ExpnData` hashing for `LocalExpnId::fresh`: spans hash to nothing, the default controls.
struct NoSpanHcx;
impl StableHashCtxt for NoSpanHcx {
    fn stable_hash_span(&mut self, _: RawSpan, _: &mut StableHasher) {}
    fn def_path_hash(&self, _: RawDefId) -> Fingerprint { Fingerprint::ZERO }
    fn stable_hash_controls(&self) -> StableHashControls { StableHashControls { hash_spans: false } }
    fn assert_default_stable_hash_controls(&self, _: &str) {}
}

struct Case {
    name: String,
    kind: String,
    edition: Edition,
    features: Vec<String>,
    #[allow(dead_code)] // see the header: the port side reads it
    pending: bool,
    src: String,
}

fn parse_cases(text: &str) -> Vec<Case> {
    text.lines()
        .filter(|l| !l.starts_with('#') && !l.trim().is_empty())
        .map(|l| {
            let f: Vec<&str> = l.splitn(6, " | ").collect();
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
                features: if f[3] == "-" { vec![] } else { f[3].split(',').map(String::from).collect() },
                pending: f[4] != "-",
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
            let mut item = p
                .parse_item(rustc_parse::parser::ForceCollect::No, rustc_parse::parser::AllowConstBlockItems::Yes)
                .map_err(|e| e.emit())
                .unwrap()
                .unwrap();
            let attr = item.attrs.remove(0);
            let attr_name = attr.name().unwrap();
            let meta = attr.meta().unwrap();
            let (stmt, kind) = match case.kind.as_str() {
                "attr" => (false, "attr"),
                "attr_stmt" => (true, "attr"),
                "builtin" => (false, "builtin"),
                "builtin_stmt" => (true, "builtin"),
                k => panic!("kind {k}"),
            };
            let annotatable = if stmt {
                let span = item.span;
                Annotatable::Stmt(Box::new(ast::Stmt {
                    id: ast::DUMMY_NODE_ID,
                    kind: ast::StmtKind::Item(item),
                    span,
                }))
            } else {
                Annotatable::Item(item)
            };
            match kind {
                "attr" => {
                    let expn_data = ExpnData::default(
                        ExpnKind::Macro(MacroKind::Attr, attr_name),
                        attr.span,
                        case.edition,
                        None,
                        None,
                    );
                    cx.current_expansion.id = LocalExpnId::fresh(expn_data, NoSpanHcx);
                    let ext = &recorder.0.iter().find(|(n, _)| *n == attr_name).unwrap().1;
                    let SyntaxExtensionKind::LegacyAttr(expander) = ext else { panic!("LegacyAttr") };
                    print_result(expander.expand(&mut cx, attr.span, &meta, annotatable, false));
                }
                _ => {
                    let is_const = attr_name == sym::derive_const;
                    let ast::MetaItemKind::List(list) = &meta.kind else { panic!("derive list") };
                    let derive_meta = list[0].meta_item().unwrap().clone();
                    let name = derive_meta.path.segments.last().unwrap().ident.name;
                    let span = derive_meta.path.span;
                    let expn_data = ExpnData::default(
                        ExpnKind::Macro(MacroKind::Derive, name),
                        span,
                        case.edition,
                        None,
                        None,
                    );
                    cx.current_expansion.id = LocalExpnId::fresh(expn_data, NoSpanHcx);
                    let ext = &recorder.0.iter().find(|(n, _)| *n == name).unwrap().1;
                    let SyntaxExtensionKind::LegacyDerive(expander) = ext else { panic!("LegacyDerive") };
                    print_result(expander.expand(&mut cx, span, &derive_meta, annotatable, is_const));
                }
            }
        }
        println!("== end");
        eprintln!("== end");
    });
}
