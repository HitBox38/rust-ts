// Oracle probe for `src/rustc_expand/expand_oracle.test.ts` (lane expand-core; not part of the build).
//
// For each case of `cases.txt` (blocks `### name`, then the source until the next `###`), it runs
// `rustc_interface::run_compiler` (default options, edition 2024, target x86_64-unknown-linux-gnu),
// swaps the emitter for a -Zui-testing `AnnotateSnippetEmitter` writing to a buffer, parses the
// source as crate `t.rs` (`new_parser_from_source_str`, `parse_crate_mod`), and runs the real
// `MacroExpander::expand_crate` (`ExtCtxt::new(sess, ExpansionConfig::default(sym "t",
// Features::default()), &mut MockResolver, None).monotonic_expander()`).
//
// `MockResolver` implements `ResolverExpand` deterministically (the TS test has the same mock):
//   next_node_id            a counter from `CRATE_NODE_ID`, as rustc_resolve
//   resolve_macro_invocation  by the last path segment of the invocation's macro path:
//     echo        Bang, returns its input tokens
//     bad         Bang, `Err(dcx.span_err(span, "mock: bad macro"))`
//     echo_attr   Attr (`Fn(TokenStream, TokenStream) -> TokenStream`), returns the item tokens
//     keep        LegacyAttr, returns `vec![item]`
//     drop_it     LegacyAttr, returns `vec![]`
//     inert       NonMacroAttr
//     later       Indeterminate on its first resolution attempt, then like `echo`
//     anything else: Indeterminate unless `force`; with `force`, `span_err(invoc.span(),
//                 "mock: cannot find macro `NAME`")` and a Bang returning `Err(that guar)`
//   take_derive_resolutions None; registered tools empty; the rest unreachable.
// Every call is logged as an event (the fragment passed to `visit_ast_fragment_with_placeholders`
// is printed with `{:?}` of its payload, which shows the placeholder `NodeId`s = `LocalExpnId`s).
// Output: one JSON array of `{name, src, events, ast, stderr, panic}` (expand_oracle/out.json), `ast`
// being `{:#?}` of the expanded crate.
//
// Regenerate (from this directory):
//
//   rustc +nightly-2026-10-11 --edition 2024 -O probe.rs -o $RUST_TS_DATA/tmp/expand-core/probe
//   DYLD_LIBRARY_PATH=$(rustc +nightly-2026-10-11 --print sysroot)/lib \
//     $RUST_TS_DATA/tmp/expand-core/probe cases.txt > out.json
//
// (`LD_LIBRARY_PATH` / `PATH` instead of `DYLD_LIBRARY_PATH` on Linux / Windows.)
#![feature(rustc_private)]
extern crate rustc_ast;
extern crate rustc_ast_pretty;
extern crate rustc_attr_ir;
extern crate rustc_driver;
extern crate rustc_errors;
extern crate rustc_expand;
extern crate rustc_feature;
extern crate rustc_hir;
extern crate rustc_interface;
extern crate rustc_lint_defs;
extern crate rustc_parse;
extern crate rustc_session;
extern crate rustc_span;
extern crate rustc_target;

use std::collections::HashMap;
use std::io::Write;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use rustc_ast::tokenstream::TokenStream;
use rustc_ast::{self as ast, NodeId};
use rustc_ast_pretty::pprust;
use rustc_attr_ir::CfgEntry;
use rustc_errors::AutoStream;
use rustc_errors::annotate_snippet_emitter_writer::AnnotateSnippetEmitter;
use rustc_expand::base::{
    Annotatable, DeriveResolution, ExtCtxt, Indeterminate, ResolverExpand, SyntaxExtension,
    SyntaxExtensionKind,
};
use rustc_expand::expand::{AstFragment, ExpansionConfig, Invocation, InvocationKind};
use rustc_feature::Features;
use rustc_lint_defs::RegisteredTools;
use rustc_parse::lexer::StripTokens;
use rustc_session::config::{Input, Options};
use rustc_span::def_id::{CrateNum, DefId, LocalDefId};
use rustc_span::edition::Edition;
use rustc_span::hygiene::{AstPass, LocalExpnId};
use rustc_span::{ErrorGuaranteed, FileName, Ident, Span, Symbol};
use rustc_target::spec::TargetTuple;

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

fn frag(f: &AstFragment) -> String {
    match f {
        AstFragment::OptExpr(x) => format!("OptExpr({x:?})"),
        AstFragment::MethodReceiverExpr(x) => format!("MethodReceiverExpr({x:?})"),
        AstFragment::Expr(x) => format!("Expr({x:?})"),
        AstFragment::Pat(x) => format!("Pat({x:?})"),
        AstFragment::Ty(x) => format!("Ty({x:?})"),
        AstFragment::Stmts(x) => format!("Stmts({x:?})"),
        AstFragment::Items(x) => format!("Items({x:?})"),
        AstFragment::TraitItems(x) => format!("TraitItems({x:?})"),
        AstFragment::ImplItems(x) => format!("ImplItems({x:?})"),
        AstFragment::TraitImplItems(x) => format!("TraitImplItems({x:?})"),
        AstFragment::ForeignItems(x) => format!("ForeignItems({x:?})"),
        AstFragment::Arms(x) => format!("Arms({x:?})"),
        AstFragment::ExprFields(x) => format!("ExprFields({x:?})"),
        AstFragment::PatFields(x) => format!("PatFields({x:?})"),
        AstFragment::GenericParams(x) => format!("GenericParams({x:?})"),
        AstFragment::Params(x) => format!("Params({x:?})"),
        AstFragment::FieldDefs(x) => format!("FieldDefs({x:?})"),
        AstFragment::Variants(x) => format!("Variants({x:?})"),
        AstFragment::WherePredicates(x) => format!("WherePredicates({x:?})"),
        AstFragment::Crate(x) => format!("Crate({x:?})"),
    }
}

fn invoc_path(invoc: &Invocation) -> (&'static str, String) {
    match &invoc.kind {
        InvocationKind::Bang { mac, .. } => ("Bang", pprust::path_to_string(&mac.path)),
        InvocationKind::Attr { attr, .. } => ("Attr", pprust::path_to_string(&attr.get_normal_item().path)),
        InvocationKind::Derive { path, .. } => ("Derive", pprust::path_to_string(path)),
        InvocationKind::GlobDelegation { item, .. } => ("GlobDelegation", format!("{:?}", item.span)),
    }
}

struct MockResolver {
    next_node_id: NodeId,
    events: Vec<String>,
    attempts: HashMap<LocalExpnId, u32>,
    tools: RegisteredTools,
}

fn ext(kind: SyntaxExtensionKind) -> Arc<SyntaxExtension> {
    Arc::new(SyntaxExtension::default(kind, Edition::Edition2024))
}

fn echo(_cx: &mut ExtCtxt<'_>, _sp: Span, ts: TokenStream) -> Result<TokenStream, ErrorGuaranteed> {
    Ok(ts)
}
fn bad(cx: &mut ExtCtxt<'_>, sp: Span, _ts: TokenStream) -> Result<TokenStream, ErrorGuaranteed> {
    Err(cx.dcx().span_err(sp, "mock: bad macro"))
}
fn echo_attr(_annotation: TokenStream, annotated: TokenStream) -> TokenStream {
    annotated
}
fn keep(_cx: &mut ExtCtxt<'_>, _sp: Span, _meta: &ast::MetaItem, item: Annotatable) -> Vec<Annotatable> {
    vec![item]
}
fn drop_it(_cx: &mut ExtCtxt<'_>, _sp: Span, _meta: &ast::MetaItem, _item: Annotatable) -> Vec<Annotatable> {
    vec![]
}

impl ResolverExpand for MockResolver {
    fn next_node_id(&mut self) -> NodeId {
        let start = self.next_node_id;
        self.next_node_id = NodeId::from_u32(start.as_u32() + 1);
        start
    }
    fn invocation_parent(&self, _id: LocalExpnId) -> LocalDefId {
        unreachable!("invocation_parent")
    }
    fn resolve_dollar_crates(&self) {
        // `&self`: logged through a raw pointer would be unsound; this call is not logged.
    }
    fn visit_ast_fragment_with_placeholders(&mut self, expn_id: LocalExpnId, fragment: &AstFragment) {
        self.events.push(format!("visit_ast_fragment_with_placeholders {expn_id:?} {}", frag(fragment)));
    }
    fn register_builtin_macro(&mut self, _name: Symbol, _ext: SyntaxExtensionKind) {
        unreachable!()
    }
    fn expansion_for_ast_pass(&mut self, _: Span, _: AstPass, _: &[Symbol], _: Option<NodeId>) -> LocalExpnId {
        unreachable!()
    }
    fn resolve_imports(&mut self) {
        self.events.push("resolve_imports".to_string());
    }
    fn resolve_macro_invocation(
        &mut self,
        invoc: &Invocation,
        eager_expansion_root: LocalExpnId,
        force: bool,
    ) -> Result<Arc<SyntaxExtension>, Indeterminate> {
        let (kind, path) = invoc_path(invoc);
        let id = invoc.expansion_data.id;
        let attempt = {
            let a = self.attempts.entry(id).or_insert(0);
            *a += 1;
            *a
        };
        self.events.push(format!(
            "resolve_macro_invocation {id:?} {kind} {path} fragment={:?} depth={} root={eager_expansion_root:?} force={force} lint_node_id={:?} trailing={}",
            invoc.fragment_kind,
            invoc.expansion_data.depth,
            invoc.expansion_data.lint_node_id,
            invoc.expansion_data.is_trailing_mac,
        ));
        let name = path.rsplit("::").next().unwrap().to_string();
        let r = match &name[..] {
            "echo" => Ok(ext(SyntaxExtensionKind::Bang(Arc::new(echo)))),
            "bad" => Ok(ext(SyntaxExtensionKind::Bang(Arc::new(bad)))),
            "echo_attr" => Ok(ext(SyntaxExtensionKind::Attr(Arc::new(echo_attr)))),
            "keep" => Ok(ext(SyntaxExtensionKind::LegacyAttr(Arc::new(keep)))),
            "drop_it" => Ok(ext(SyntaxExtensionKind::LegacyAttr(Arc::new(drop_it)))),
            "inert" => Ok(ext(SyntaxExtensionKind::NonMacroAttr)),
            "later" if attempt == 1 => Err(Indeterminate),
            "later" => Ok(ext(SyntaxExtensionKind::Bang(Arc::new(echo)))),
            _ if !force => Err(Indeterminate),
            _ => {
                // Shared with the TS mock: the error is emitted at resolution time.
                let msg = format!("mock: cannot find macro `{name}`");
                let guar = invoc_dcx_err(invoc, msg);
                Ok(ext(SyntaxExtensionKind::Bang(Arc::new(
                    move |_cx: &mut ExtCtxt<'_>, _sp: Span, _ts: TokenStream| -> Result<TokenStream, ErrorGuaranteed> {
                        Err(guar)
                    },
                ))))
            }
        };
        self.events.push(format!("  => {}", if r.is_ok() { "Ok" } else { "Indeterminate" }));
        r
    }
    fn record_macro_rule_usage(&mut self, _mac_id: NodeId, _rule_index: usize) {
        unreachable!()
    }
    fn check_unused_macros(&mut self) {
        unreachable!()
    }
    fn has_derive_copy(&self, _expn_id: LocalExpnId) -> bool {
        unreachable!()
    }
    fn has_derive_ord(&self, _expn_id: LocalExpnId) -> bool {
        unreachable!()
    }
    fn resolve_derives(
        &mut self,
        _expn_id: LocalExpnId,
        _force: bool,
        _derive_paths: &dyn Fn() -> Vec<DeriveResolution>,
    ) -> Result<(), Indeterminate> {
        unreachable!()
    }
    fn take_derive_resolutions(&mut self, expn_id: LocalExpnId) -> Option<Vec<DeriveResolution>> {
        self.events.push(format!("take_derive_resolutions {expn_id:?}"));
        None
    }
    fn cfg_accessible(&mut self, _expn_id: LocalExpnId, _path: &ast::Path) -> Result<bool, Indeterminate> {
        unreachable!()
    }
    fn macro_accessible(&mut self, _expn_id: LocalExpnId, _path: &ast::Path) -> Result<bool, Indeterminate> {
        unreachable!()
    }
    fn get_proc_macro_quoted_span(&self, _krate: CrateNum, _id: usize) -> Span {
        unreachable!()
    }
    fn declare_proc_macro(&mut self, _id: NodeId) {
        unreachable!()
    }
    fn append_stripped_cfg_item(&mut self, parent_node: NodeId, ident: Ident, cfg: CfgEntry, cfg_span: Span) {
        self.events.push(format!("append_stripped_cfg_item {parent_node:?} {ident:?} {cfg:?} {cfg_span:?}"));
    }
    fn registered_attr_tools(&self) -> &RegisteredTools {
        &self.tools
    }
    fn registered_lint_tools(&self) -> &RegisteredTools {
        &self.tools
    }
    fn register_glob_delegation(&mut self, invoc_id: LocalExpnId) {
        self.events.push(format!("register_glob_delegation {invoc_id:?}"));
    }
    fn glob_delegation_suffixes(
        &self,
        _trait_def_id: DefId,
        _impl_def_id: LocalDefId,
        _star_span: Span,
    ) -> Result<Vec<(Ident, Option<Ident>)>, Indeterminate> {
        unreachable!()
    }
    fn insert_impl_trait_name(&mut self, id: NodeId, name: Symbol) {
        self.events.push(format!("insert_impl_trait_name {id:?} {name:?}"));
    }
    fn mark_scope_with_compile_error(&mut self, _parent_node: NodeId) {
        unreachable!()
    }
}

// The session's dcx, reached through the session globals' source map is not possible from the
// resolver; the probe keeps a pointer to the current `Session`'s dcx instead.
thread_local! {
    static DCX: std::cell::Cell<Option<*const rustc_session::Session>> = const { std::cell::Cell::new(None) };
}
fn invoc_dcx_err(invoc: &Invocation, msg: String) -> ErrorGuaranteed {
    let sess = DCX.with(|c| c.get()).unwrap();
    // SAFETY: set for the duration of the `run_compiler` callback below.
    let sess = unsafe { &*sess };
    sess.dcx().span_err(invoc.span(), msg)
}

static USING_INTERNAL_FEATURES: AtomicBool = AtomicBool::new(false);

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let text = std::fs::read_to_string(&args[1]).unwrap();
    let only = args.get(2).cloned();
    let mut first = true;
    println!("[");
    for block in text.split("### ").skip(1) {
        let (name, src) = block.split_once('\n').unwrap();
        if let Some(o) = &only {
            if o != name {
                continue;
            }
        }
        let src = src.strip_suffix('\n').unwrap_or(src).to_string();
        let out = Arc::new(Mutex::new(Vec::new()));
        let mut events: Vec<String> = Vec::new();
        let mut ast_dump = String::new();
        let mut panic_msg: Option<String> = None;
        let mut opts = Options::default();
        opts.edition = Edition::Edition2024;
        opts.target_triple = TargetTuple::from_tuple("x86_64-unknown-linux-gnu");
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
            DCX.with(|c| c.set(Some(sess as *const _)));
            let sm = sess.psess.clone_source_map();
            let shared: Box<dyn Write + Send> = Box::new(Shared(out.clone()));
            sess.dcx().set_emitter(Box::new(
                AnnotateSnippetEmitter::new(AutoStream::never(shared)).sm(Some(Arc::clone(&sm))).ui_testing(true),
            ));
            let fname = FileName::Real(
                sm.path_mapping().to_real_filename(sm.working_dir(), std::path::Path::new("t.rs")),
            );
            let mut resolver = MockResolver {
                next_node_id: ast::CRATE_NODE_ID,
                events: Vec::new(),
                attempts: HashMap::new(),
                tools: Default::default(),
            };
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
                        return;
                    }
                };
                let features = Features::default();
                let ecfg = ExpansionConfig::default(Symbol::intern("t"), &features);
                let mut cx = ExtCtxt::new(sess, ecfg, &mut resolver, None);
                let krate = cx.monotonic_expander().expand_crate(krate);
                ast_dump = format!("{krate:#?}");
            }));
            if let Err(e) = res {
                panic_msg = Some(if let Some(s) = e.downcast_ref::<String>() {
                    s.clone()
                } else if let Some(s) = e.downcast_ref::<&str>() {
                    s.to_string()
                } else {
                    "<non-string panic>".to_string()
                });
            }
            events.append(&mut resolver.events);
            for l in sess.psess.buffered_lints.lock().iter() {
                events.push(format!("buffered {} {:?}", l.lint_id.lint.name, l.span));
            }
            sess.dcx().reset_err_count();
            DCX.with(|c| c.set(None));
        });
        let stderr = String::from_utf8(out.lock().unwrap().clone()).unwrap();
        if !first {
            println!(",");
        }
        first = false;
        let evs: Vec<String> = events.iter().map(|e| esc(e)).collect();
        print!(
            "{{\"name\":{},\"src\":{},\"events\":[{}],\"ast\":{},\"stderr\":{},\"panic\":{}}}",
            esc(name),
            esc(&src),
            evs.join(","),
            esc(&ast_dump),
            esc(&stderr),
            match &panic_msg {
                Some(p) => esc(p),
                None => "null".to_string(),
            }
        );
    }
    println!("\n]");
}
