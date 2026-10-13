//! Oracle probe for lane mbe-b (rust-ts): drives the pinned nightly's own `rustc_expand`
//! (`compile_declarative_macro`, `MacroRulesMacroExpander` as `TTMacroExpander` /
//! `AttrProcMacro::expand_with_safety` / `expand_derive`) over the `macro_rules!` definitions and
//! invocations of one small source file, and prints what happened.
//!
//!   mbeprobe <case.rs> <rustc arguments...>
//!
//! The rustc arguments compile an empty `#![no_core]` crate (`config` replaces the input), so the
//! session (edition, `--error-format`, ...) is a real one and, in `after_expansion`, `tcx` provides
//! the stable hashing context for `LocalExpnId::set_expn_data`. The real crate's own expansion
//! creates no expansions (no_core: no std injection), so the hygiene tables start empty.
//!
//! Then the probe:
//! 1. parses <case.rs> as `FileName::Custom("case.rs")` (`new_parser_from_source_str`,
//!    `StripTokens::Nothing`, `parse_crate_mod`);
//! 2. computes `rustc_expand::config::features(sess, &krate.attrs, "case")`;
//! 3. builds `ExtCtxt::new(sess, ExpansionConfig { trace_mac: true, ..default("case") },
//!    &mut ProbeResolver, None)`;
//! 4. walks the crate's items in order (item `i` gets `NodeId(i + 1)`):
//!    - `macro_rules! name` / `macro name`: `compile_declarative_macro(sess, &features, def, ident,
//!      &[], item.span, id, edition)`, where `id` is `DUMMY_NODE_ID` (a macro "from another crate")
//!      when the name starts with `ext_`;
//!    - a bang invocation `name!(..)` of a compiled macro: `fresh_empty` expansion,
//!      `ext.expn_data(ROOT, mac.span(), name, Bang, None, None)` + `set_expn_data`,
//!      `cx.current_expansion.id = id`, `TTMacroExpander::expand(cx, mac.span(), tokens)`, then
//!      `make_<kind>()` on the result. Positions: item (`Items`), `const _: T = m!();` (`Expr`),
//!      `type T = m!();` (`Ty`) and, in a fn body, `m!();` (`Stmts`), `let m!() = ..;` (`Pat`),
//!      `let x = m!();` and expression statements (`Expr`);
//!    - an item whose first attribute is `#[name ..]` naming a compiled macro: the attribute is
//!      removed and `expand_with_safety(cx, unsafety, attr.span, args, from_ast(item))` runs
//!      (`Attr`); `#[mbe_derive(name)]` likewise runs `expand_derive(cx, path.span, from_ast(item))`
//!      (`Derive`; a stand-in attribute, because the parser keeps no tokens for `#[derive]` items).
//! 5. prints the hygiene data (`debug_hygiene_data(false)`), the buffered lints, the gated spans
//!    and the symbol-gallery entries with a non-root context.
//!
//! Output (stdout): a JSON array of event strings. Diagnostics go to stderr as usual.
#![feature(rustc_private)]
extern crate rustc_ast;
extern crate rustc_ast_pretty;
extern crate rustc_driver;
extern crate rustc_errors;
extern crate rustc_expand;
extern crate rustc_hir;
extern crate rustc_interface;
extern crate rustc_lint_defs;
extern crate rustc_middle;
extern crate rustc_parse;
extern crate rustc_session;
extern crate rustc_span;

use std::cell::RefCell;
use std::collections::HashMap;
use std::fmt::Write as _;
use std::io::Write as _;
use std::process::ExitCode;
use std::sync::Arc;

use rustc_ast::tokenstream::TokenStream;
use rustc_ast::{self as ast, AttrArgs, DUMMY_NODE_ID, NodeId};
use rustc_ast_pretty::pprust;
use rustc_driver::{Callbacks, Compilation};
use rustc_expand::base::{
    AttrProcMacro, ExpandResult, ExtCtxt, Indeterminate, MacResult, ResolverExpand, SyntaxExtension,
    SyntaxExtensionKind, TTMacroExpander,
};
use rustc_expand::expand::{AstFragment, ExpansionConfig};
use rustc_hir::def_id::{CrateNum, DefId, LocalDefId};
use rustc_interface::interface;
use rustc_middle::ty::TyCtxt;
use rustc_session::EarlyDiagCtxt;
use rustc_session::config::{ErrorOutputType, Input};
use rustc_span::hygiene::{AstPass, LocalExpnId, MacroKind, debug_hygiene_data};
use rustc_span::{FileName, Ident, Span, Symbol};

thread_local! {
    static EV: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
}

fn ev(s: String) {
    EV.with(|e| e.borrow_mut().push(s));
}

fn js(s: &str) -> String {
    let mut o = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            '\n' => o.push_str("\\n"),
            c if (c as u32) < 0x20 => write!(o, "\\u{:04x}", c as u32).unwrap(),
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

/// Only `next_node_id` and `record_macro_rule_usage` are reachable from the mbe code.
struct ProbeResolver {
    next: u32,
}

impl ResolverExpand for ProbeResolver {
    fn next_node_id(&mut self) -> NodeId {
        self.next += 1;
        NodeId::from_u32(self.next)
    }
    fn invocation_parent(&self, _: LocalExpnId) -> LocalDefId {
        unimplemented!("invocation_parent")
    }
    fn resolve_dollar_crates(&self) {
        unimplemented!("resolve_dollar_crates")
    }
    fn visit_ast_fragment_with_placeholders(&mut self, _: LocalExpnId, _: &AstFragment) {
        unimplemented!("visit_ast_fragment_with_placeholders")
    }
    fn register_builtin_macro(&mut self, _: Symbol, _: SyntaxExtensionKind) {
        unimplemented!("register_builtin_macro")
    }
    fn expansion_for_ast_pass(&mut self, _: Span, _: AstPass, _: &[Symbol], _: Option<NodeId>) -> LocalExpnId {
        unimplemented!("expansion_for_ast_pass")
    }
    fn resolve_imports(&mut self) {
        unimplemented!("resolve_imports")
    }
    fn resolve_macro_invocation(
        &mut self,
        _: &rustc_expand::expand::Invocation,
        _: LocalExpnId,
        _: bool,
    ) -> Result<Arc<SyntaxExtension>, Indeterminate> {
        unimplemented!("resolve_macro_invocation")
    }
    fn record_macro_rule_usage(&mut self, mac_id: NodeId, rule_index: usize) {
        ev(format!("record_macro_rule_usage {mac_id:?} {rule_index}"));
    }
    fn check_unused_macros(&mut self) {
        unimplemented!("check_unused_macros")
    }
    fn has_derive_copy(&self, _: LocalExpnId) -> bool {
        unimplemented!("has_derive_copy")
    }
    fn has_derive_ord(&self, _: LocalExpnId) -> bool {
        unimplemented!("has_derive_ord")
    }
    fn resolve_derives(
        &mut self,
        _: LocalExpnId,
        _: bool,
        _: &dyn Fn() -> Vec<rustc_expand::base::DeriveResolution>,
    ) -> Result<(), Indeterminate> {
        unimplemented!("resolve_derives")
    }
    fn take_derive_resolutions(&mut self, _: LocalExpnId) -> Option<Vec<rustc_expand::base::DeriveResolution>> {
        unimplemented!("take_derive_resolutions")
    }
    fn cfg_accessible(&mut self, _: LocalExpnId, _: &ast::Path) -> Result<bool, Indeterminate> {
        unimplemented!("cfg_accessible")
    }
    fn macro_accessible(&mut self, _: LocalExpnId, _: &ast::Path) -> Result<bool, Indeterminate> {
        unimplemented!("macro_accessible")
    }
    fn get_proc_macro_quoted_span(&self, _: CrateNum, _: usize) -> Span {
        unimplemented!("get_proc_macro_quoted_span")
    }
    fn declare_proc_macro(&mut self, _: NodeId) {
        unimplemented!("declare_proc_macro")
    }
    fn append_stripped_cfg_item(
        &mut self,
        _: NodeId,
        _: Ident,
        _: rustc_ast::attr::data_structures::CfgEntry,
        _: Span,
    ) {
        unimplemented!("append_stripped_cfg_item")
    }
    fn registered_attr_tools(&self) -> &rustc_lint_defs::RegisteredTools {
        unimplemented!("registered_attr_tools")
    }
    fn registered_lint_tools(&self) -> &rustc_lint_defs::RegisteredTools {
        unimplemented!("registered_lint_tools")
    }
    fn register_glob_delegation(&mut self, _: LocalExpnId) {
        unimplemented!("register_glob_delegation")
    }
    fn glob_delegation_suffixes(
        &self,
        _: DefId,
        _: LocalDefId,
        _: Span,
    ) -> Result<Vec<(Ident, Option<Ident>)>, Indeterminate> {
        unimplemented!("glob_delegation_suffixes")
    }
    fn insert_impl_trait_name(&mut self, _: NodeId, _: Symbol) {
        unimplemented!("insert_impl_trait_name")
    }
    fn mark_scope_with_compile_error(&mut self, _: NodeId) {
        unimplemented!("mark_scope_with_compile_error")
    }
}

#[derive(Clone, Copy, Debug)]
enum Kind {
    Items,
    Expr,
    Ty,
    Stmts,
    Pat,
}

struct Probe<'a, 'tcx> {
    tcx: TyCtxt<'tcx>,
    macros: HashMap<Symbol, Arc<SyntaxExtension>>,
    cx: ExtCtxt<'a>,
}

impl<'a, 'tcx> Probe<'a, 'tcx> {
    /// `fresh_empty` + `set_expn_data` (what collection + `resolve_macro_invocation` do).
    fn fresh_expn(&mut self, ext: &SyntaxExtension, call_site: Span, name: Symbol, kind: MacroKind) -> LocalExpnId {
        let id = LocalExpnId::fresh_empty();
        let data = ext.expn_data(LocalExpnId::ROOT, call_site, name, kind, None, None);
        self.tcx.with_stable_hashing_context(|hcx| id.set_expn_data(data, hcx));
        self.cx.current_expansion.id = id;
        ev(format!("expn {:?} hash {:?}", id.to_expn_id(), id.to_expn_id().expn_hash()));
        id
    }

    fn traces(&mut self) {
        for (sp, msgs) in self.cx.expansions.drain(..) {
            for m in msgs {
                ev(format!("trace {sp:?} {m}"));
            }
        }
    }

    fn bang(&mut self, mac: &ast::MacCall, kind: Kind) {
        let name = mac.path.segments[0].ident.name;
        let span = mac.span();
        let Some(ext) = self.macros.get(&name).cloned() else {
            ev(format!("invoke {name} (no such macro)"));
            return;
        };
        ev(format!("invoke {name}! as {kind:?} at {span:?}"));
        self.fresh_expn(&ext, span, name, MacroKind::Bang);
        match &ext.kind {
            SyntaxExtensionKind::MacroRules(exp) => {
                let ExpandResult::Ready(res) = TTMacroExpander::expand(&**exp, &mut self.cx, span, mac.args.tokens.clone())
                else {
                    panic!("Retry")
                };
                make(res, kind);
                self.traces();
            }
            SyntaxExtensionKind::Bang(b) => {
                let r = b.expand(&mut self.cx, span, mac.args.tokens.clone());
                ev(format!("bang (dummy) -> is_err {}", r.is_err()));
            }
            _ => panic!("unexpected extension kind"),
        }
    }

}

/// `make_<kind>()` on an expansion result (borrows the `ExtCtxt`, so not a `Probe` method).
fn make(res: Box<dyn MacResult + '_>, kind: Kind) {
    {
        match kind {
            Kind::Items => match res.make_items() {
                Some(items) => {
                    for item in items {
                        ev(format!("item {}", pprust::item_to_string(&item)));
                        ev(format!("ast {item:#?}"));
                    }
                }
                None => ev("make_items None".into()),
            },
            Kind::Expr => match res.make_expr() {
                Some(e) => {
                    ev(format!("expr {}", pprust::expr_to_string(&e)));
                    ev(format!("ast {e:#?}"));
                }
                None => ev("make_expr None".into()),
            },
            Kind::Ty => match res.make_ty() {
                Some(t) => {
                    ev(format!("ty {}", pprust::ty_to_string(&t)));
                    ev(format!("ast {t:#?}"));
                }
                None => ev("make_ty None".into()),
            },
            Kind::Pat => match res.make_pat() {
                Some(p) => {
                    ev(format!("pat {}", pprust::pat_to_string(&p)));
                    ev(format!("ast {p:#?}"));
                }
                None => ev("make_pat None".into()),
            },
            Kind::Stmts => match res.make_stmts() {
                Some(stmts) => {
                    for s in stmts {
                        ev(format!("stmt {}", pprust::stmt_to_string(&s)));
                        ev(format!("ast {s:#?}"));
                    }
                }
                None => ev("make_stmts None".into()),
            },
        }
    }
}

impl<'a, 'tcx> Probe<'a, 'tcx> {
    fn tokens_result(&mut self, r: Result<TokenStream, rustc_errors::ErrorGuaranteed>) {
        self.traces();
        match r {
            Ok(ts) => {
                ev(format!("tokens {}", pprust::tts_to_string(&ts)));
                ev(format!("tokens_debug {ts:#?}"));
            }
            Err(_) => ev("Err(ErrorGuaranteed)".into()),
        }
    }

    /// `#[name ..] item` / `#[mbe_derive(name)] item`; returns whether it was handled.
    fn attr_invocation(&mut self, item: &ast::Item) -> bool {
        let Some(attr) = item.attrs.first() else { return false };
        let ast::AttrKind::Normal(normal) = &attr.kind else { return false };
        let ai = &normal.item;
        if ai.path.segments.len() != 1 {
            return false;
        }
        let aname = ai.path.segments[0].ident.name;
        let mut stripped = item.clone();
        stripped.attrs.remove(0);
        if aname.as_str() == "mbe_derive" {
            let AttrArgs::Delimited(d) = &ai.args else { return false };
            let Some(rustc_ast::tokenstream::TokenTree::Token(tok, _)) = d.tokens.iter().next() else { return false };
            let Some((ident, _)) = tok.ident() else { return false };
            let Some(ext) = self.macros.get(&ident.name).cloned() else { return false };
            let span = ident.span;
            ev(format!("invoke #[derive({})] at {span:?}", ident.name));
            self.fresh_expn(&ext, span, ident.name, MacroKind::Derive);
            let body = TokenStream::from_ast(&stripped);
            let SyntaxExtensionKind::MacroRules(exp) = &ext.kind else {
                ev("not MacroRules".into());
                return true;
            };
            let r = exp.expand_derive(&mut self.cx, span, &body);
            self.tokens_result(r);
            return true;
        }
        let Some(ext) = self.macros.get(&aname).cloned() else { return false };
        let span = attr.span;
        ev(format!("invoke #[{aname}] at {span:?}"));
        self.fresh_expn(&ext, span, aname, MacroKind::Attr);
        let args = match &ai.args {
            AttrArgs::Empty => TokenStream::default(),
            AttrArgs::Delimited(d) => d.tokens.clone(),
            AttrArgs::Eq { .. } => panic!("unexpected #[m = ..]"),
        };
        let body = TokenStream::from_ast(&stripped);
        let SyntaxExtensionKind::MacroRules(exp) = &ext.kind else {
            ev("not MacroRules".into());
            return true;
        };
        let r = AttrProcMacro::expand_with_safety(&**exp, &mut self.cx, ai.unsafety, span, args, body);
        self.tokens_result(r);
        true
    }

    fn expr_mac(&mut self, e: &ast::Expr) {
        if let ast::ExprKind::MacCall(mac) = &e.kind {
            self.bang(mac, Kind::Expr);
        }
    }

    fn item(&mut self, idx: usize, item: &ast::Item) {
        let sess = self.tcx.sess;
        if self.attr_invocation(item) {
            return;
        }
        match &item.kind {
            ast::ItemKind::MacroDef(ident, def) => {
                let node_id =
                    if ident.name.as_str().starts_with("ext_") { DUMMY_NODE_ID } else { NodeId::from_usize(idx + 1) };
                let ext = rustc_expand::compile_declarative_macro(
                    sess,
                    self.cx.ecfg.features,
                    def,
                    *ident,
                    &[],
                    item.span,
                    node_id,
                    sess.edition(),
                );
                match &ext.kind {
                    SyntaxExtensionKind::MacroRules(exp) => {
                        ev(format!(
                            "def {} {node_id:?}: MacroRules kinds={:?} nrules={} is_macro_rules={}",
                            ident.name,
                            exp.kinds(),
                            exp.nrules(),
                            exp.is_macro_rules()
                        ));
                        for i in 0..exp.nrules() {
                            ev(format!("  get_unused_rule({i}) = {:?}", exp.get_unused_rule(i)));
                        }
                    }
                    SyntaxExtensionKind::Bang(_) => ev(format!("def {} {node_id:?}: Bang (dummy)", ident.name)),
                    _ => panic!("unexpected extension kind"),
                }
                self.macros.insert(ident.name, Arc::new(ext));
            }
            ast::ItemKind::MacCall(mac) => self.bang(mac, Kind::Items),
            ast::ItemKind::Const(c) => {
                if let Some(e) = &c.body {
                    self.expr_mac(e);
                }
            }
            ast::ItemKind::TyAlias(t) => {
                if let Some(ty) = &t.ty
                    && let ast::TyKind::MacCall(mac) = &ty.kind
                {
                    self.bang(mac, Kind::Ty);
                }
            }
            ast::ItemKind::Fn(f) => {
                if let Some(body) = &f.body {
                    for s in &body.stmts {
                        match &s.kind {
                            ast::StmtKind::MacCall(m) => self.bang(&m.mac, Kind::Stmts),
                            ast::StmtKind::Let(l) => {
                                if let ast::PatKind::MacCall(mac) = &l.pat.kind {
                                    self.bang(mac, Kind::Pat);
                                }
                                if let ast::LocalKind::Init(e) = &l.kind {
                                    self.expr_mac(e);
                                }
                            }
                            ast::StmtKind::Expr(e) | ast::StmtKind::Semi(e) => self.expr_mac(e),
                            _ => {}
                        }
                    }
                }
            }
            _ => {}
        }
    }
}

struct MbeProbe {
    case: String,
}

impl Callbacks for MbeProbe {
    fn config(&mut self, config: &mut interface::Config) {
        config.input = Input::Str {
            name: FileName::Custom("probe-root".into()),
            input: "#![feature(no_core)]\n#![no_core]\n".into(),
        };
    }

    fn after_expansion<'tcx>(&mut self, _compiler: &interface::Compiler, tcx: TyCtxt<'tcx>) -> Compilation {
        let sess = tcx.sess;
        let before = debug_hygiene_data(false);
        assert_eq!(
            before,
            "Expansions:\ncrate0::{{expn0}}: parent: crate0::{{expn0}}, call_site_ctxt: #0, def_site_ctxt: #0, kind: Root\n\nSyntaxContexts:\n#0: parent: #0, outer_mark: (crate0::{{expn0}}, Opaque)"
        );
        let src = std::fs::read_to_string(&self.case).unwrap();
        let krate = match rustc_parse::new_parser_from_source_str(
            &sess.psess,
            FileName::Custom("case.rs".into()),
            src,
            rustc_parse::lexer::StripTokens::Nothing,
        ) {
            Ok(mut p) => match p.parse_crate_mod() {
                Ok(k) => k,
                Err(e) => {
                    e.emit();
                    ev("parse error".into());
                    return finish();
                }
            },
            Err(errs) => {
                for e in errs {
                    e.emit();
                }
                ev("parse error".into());
                return finish();
            }
        };
        let crate_name = Symbol::intern("case");
        let features = rustc_expand::config::features(sess, &krate.attrs, crate_name);
        ev(format!(
            "features {:?}",
            features.enabled_lang_features().iter().map(|f| f.gate_name).collect::<Vec<_>>()
        ));
        let mut ecfg = ExpansionConfig::default(crate_name, &features);
        ecfg.trace_mac = true;
        let mut resolver = ProbeResolver { next: 0x10000 };
        let cx = ExtCtxt::new(sess, ecfg, &mut resolver, None);
        let mut probe = Probe { tcx, macros: HashMap::new(), cx };
        for (idx, item) in krate.items.iter().enumerate() {
            probe.item(idx, item);
        }
        drop(probe);
        ev(format!("hygiene {}", debug_hygiene_data(false)));
        for l in sess.psess.buffered_lints.borrow().iter() {
            ev(format!("lint {} {:?} {:?}", l.lint_id.lint.name, l.span, l.node_id));
        }
        let gated = sess.psess.gated_spans.spans.borrow();
        let mut g: Vec<_> = gated.iter().map(|(k, v)| (k.as_str().to_string(), v.clone())).collect();
        g.sort_by(|a, b| a.0.cmp(&b.0));
        for (k, v) in g {
            ev(format!("gated {k} {v:?}"));
        }
        for (sym, sp) in sess.psess.symbol_gallery.symbols.borrow().iter() {
            if !sp.ctxt().is_root() {
                ev(format!("gallery {sym:?} {sp:?}"));
            }
        }
        finish()
    }
}

fn finish() -> Compilation {
    let out = EV.with(|e| {
        let e = e.borrow();
        let mut s = String::from("[");
        for (i, x) in e.iter().enumerate() {
            if i > 0 {
                s.push_str(",\n");
            }
            s.push_str(&js(x));
        }
        s.push_str("]\n");
        s
    });
    let mut stdout = std::io::stdout().lock();
    stdout.write_all(out.as_bytes()).unwrap();
    stdout.flush().unwrap();
    Compilation::Stop
}

fn main() -> ExitCode {
    let early_dcx = EarlyDiagCtxt::new(ErrorOutputType::default());
    rustc_driver::install_ice_hook(rustc_driver::DEFAULT_BUG_REPORT_URL, |_| ());
    let mut args = rustc_driver::args::raw_args(&early_dcx);
    let case = args.remove(1);
    let mut callbacks = MbeProbe { case };
    rustc_driver::catch_with_exit_code(|| rustc_driver::compiler_entrypoint(&args, &mut callbacks))
}
