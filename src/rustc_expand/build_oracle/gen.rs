// Oracle probe for `src/rustc_expand/build.test.ts` (lane expand-base; not part of the build).
//
// Runs `rustc_interface::run_compiler` (default options) to get a real `Session`, parses
// `fn main() {}` as `t.rs` (so spans have a file), builds an `ExtCtxt` with a resolver whose
// methods are all `unimplemented!()` (no builder touches it), sets `current_expansion.id` to
// `LocalExpnId::fresh_empty()` (so `with_def_site_ctxt` can apply a mark), then calls the
// `ExtCtxt` builder methods of build.rs and the `MacEager` / `DummyResult` results of base.rs with
// fixed arguments and prints one JSON array of `[op, "{:?} of the result"]`. build.test.ts makes the
// same calls in the same order and compares the TS Debug output.
//
// Regenerate (from this directory):
//
//   rustc +nightly-2026-10-11 --edition 2024 gen.rs -o $RUST_TS_DATA/tmp/expand-base/build_gen
//   DYLD_LIBRARY_PATH=$(rustc +nightly-2026-10-11 --print sysroot)/lib \
//     $RUST_TS_DATA/tmp/expand-base/build_gen > out.json
//
// (`LD_LIBRARY_PATH` / `PATH` instead of `DYLD_LIBRARY_PATH` on Linux / Windows.)
#![feature(rustc_private)]
extern crate rustc_ast;
extern crate rustc_attr_ir;
extern crate rustc_driver;
extern crate rustc_errors;
extern crate rustc_expand;
extern crate rustc_feature;
extern crate rustc_interface;
extern crate rustc_lint_defs;
extern crate rustc_parse;
extern crate rustc_session;
extern crate rustc_span;
extern crate thin_vec;

use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use rustc_ast::token::Delimiter;
use rustc_ast::tokenstream::TokenStream;
use rustc_ast::{self as ast, NodeId};
use rustc_attr_ir::CfgEntry;
use rustc_expand::base::{
    DeriveResolution, DummyResult, ExtCtxt, Indeterminate, MacEager, ResolverExpand,
    SyntaxExtension, SyntaxExtensionKind,
};
use rustc_expand::expand::{AstFragment, ExpansionConfig, Invocation};
use rustc_feature::Features;
use rustc_lint_defs::RegisteredTools;
use rustc_parse::lexer::StripTokens;
use rustc_session::config::{Input, Options};
use rustc_span::def_id::{CrateNum, DefId, LocalDefId};
use rustc_span::hygiene::{AstPass, LocalExpnId};
use rustc_span::{BytePos, FileName, Ident, Span, Symbol, kw, sym};
use thin_vec::thin_vec;

struct NoResolver;
impl ResolverExpand for NoResolver {
    fn next_node_id(&mut self) -> NodeId { unimplemented!() }
    fn invocation_parent(&self, _: LocalExpnId) -> LocalDefId { unimplemented!() }
    fn resolve_dollar_crates(&self) { unimplemented!() }
    fn visit_ast_fragment_with_placeholders(&mut self, _: LocalExpnId, _: &AstFragment) { unimplemented!() }
    fn register_builtin_macro(&mut self, _: Symbol, _: SyntaxExtensionKind) { unimplemented!() }
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

static USING_INTERNAL_FEATURES: AtomicBool = AtomicBool::new(false);

fn main() {
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
        let sm = sess.psess.clone_source_map();
        let fname = FileName::Real(
            sm.path_mapping().to_real_filename(sm.working_dir(), std::path::Path::new("t.rs")),
        );
        let mut p = rustc_parse::unwrap_or_emit_fatal(rustc_parse::new_parser_from_source_str(
            &sess.psess,
            fname,
            "fn main() { #[attr(x)] 1 }\n".to_string(),
            StripTokens::Nothing,
        ));
        let krate = p.parse_crate_mod().map_err(|e| e.emit()).unwrap();
        let features = Features::default();
        let ecfg = ExpansionConfig::default(sym::main, &features);
        let mut resolver = NoResolver;
        let mut cx = ExtCtxt::new(sess, ecfg, &mut resolver, None);
        cx.current_expansion.id = LocalExpnId::fresh_empty();

        let sp = Span::with_root_ctxt(BytePos(0), BytePos(2));
        let sp2 = Span::with_root_ctxt(BytePos(3), BytePos(7));
        let a = Ident::from_str_and_span("a", sp2);
        let b = Ident::from_str("b");
        // The attribute `#[attr(x)]` of the parsed body expression.
        let parsed_attr = {
            let ast::ItemKind::Fn(f) = &krate.items[0].kind else { panic!() };
            let ast::StmtKind::Expr(e) = &f.body.as_ref().unwrap().stmts[0].kind else { panic!() };
            e.attrs[0].clone()
        };

        let mut ev: Vec<(String, String)> = Vec::new();
        macro_rules! op {
            ($name:expr, $e:expr) => {
                ev.push(($name.to_string(), format!("{:?}", $e)));
            };
        }
        op!("std_path", cx.std_path(&[sym::option, sym::Option]));
        op!("path", cx.path(sp, vec![a, b]));
        op!("path_ident", cx.path_ident(sp, a));
        op!("path_global", cx.path_global(sp, vec![a, b]));
        op!("path_global_kw", cx.path_global(sp, vec![Ident::new(kw::Crate, sp2), b]));
        op!("path_all", cx.path_all(sp, true, vec![a], vec![ast::GenericArg::Type(cx.ty_infer(sp2))]));
        op!("macro_call", cx.macro_call(sp, cx.path_ident(sp, a), Delimiter::Brace, TokenStream::default()));
        op!("ty_infer", cx.ty_infer(sp));
        op!("ty_ident", cx.ty_ident(sp, a));
        op!("anon_const_block", cx.anon_const_block(cx.block_expr(cx.expr_usize(sp, 3))));
        op!("const_ident", cx.const_ident(sp, a));
        op!("ty_ref", cx.ty_ref(sp, cx.ty_unit(sp2), Some(cx.lifetime_static(sp)), ast::Mutability::Mut));
        op!("ty_ptr", cx.ty_ptr(sp, cx.ty_unit(sp2), ast::Mutability::Not));
        op!("ty_self_ref", cx.ty_self_ref(sp));
        op!("typaram", cx.typaram(a, thin_vec![cx.trait_bound(cx.path_ident(sp, b), false)], Some(cx.ty_unit(sp))));
        op!("lifetime_param", cx.lifetime_param(a, thin_vec![]));
        op!("const_param", cx.const_param(a, thin_vec![], cx.ty_unit(sp), Some(cx.const_ident(sp, b))));
        op!("poly_trait_ref", cx.poly_trait_ref(sp, cx.path_ident(sp, a), true));
        op!("trait_bound", cx.trait_bound(cx.path_ident(sp, a), false));
        op!("lifetime", cx.lifetime(sp, a));
        op!("stmt_expr", cx.stmt_expr(cx.expr_self(sp)));
        op!("stmt_let", cx.stmt_let(sp, true, a, cx.expr_bool(sp, true)));
        op!("stmt_let_ty", cx.stmt_let_ty(sp, false, a, Some(cx.ty_infer(sp)), cx.expr_bool(sp, false)));
        op!("stmt_let_type_only", cx.stmt_let_type_only(sp, cx.ty_unit(sp)));
        op!("stmt_item", cx.stmt_item(sp, cx.item_const(sp, a, cx.ty_unit(sp), None)));
        op!("block", cx.block(sp, thin_vec![cx.stmt_expr(cx.expr_u32(sp, 9))]));
        op!("expr_ident_sym", cx.expr_ident_sym(sp, sym::main));
        op!("expr_macro_call", cx.expr_macro_call(sp, cx.macro_call(sp, cx.path_ident(sp, a), Delimiter::Parenthesis, TokenStream::default())));
        op!("expr_binary", cx.expr_binary(sp, ast::BinOpKind::Add, cx.expr_usize(sp, 1), cx.expr_usize(sp2, 2)));
        op!("expr_deref", cx.expr_deref(sp, cx.expr_self(sp)));
        op!("expr_addr_of", cx.expr_addr_of(sp, cx.expr_self(sp)));
        op!("expr_paren", cx.expr_paren(sp, cx.expr_self(sp)));
        op!("expr_method_call", cx.expr_method_call(sp, cx.expr_self(sp), a, thin_vec![cx.expr_usize(sp, 1)]));
        op!("expr_call_ident", cx.expr_call_ident(sp, a, thin_vec![]));
        op!("expr_call_global", cx.expr_call_global(sp, vec![a, b], thin_vec![cx.expr_self(sp)]));
        op!("field_imm", cx.field_imm(sp, a, cx.expr_self(sp2)));
        op!("expr_struct_ident", cx.expr_struct_ident(sp, a, thin_vec![cx.field_imm(sp, b, cx.expr_self(sp))]));
        op!("expr_str", cx.expr_str(sp, Symbol::intern("a\"b\n\u{e9}")));
        op!("expr_byte_str", cx.expr_byte_str(sp, vec![0, 65, 0x22, 0x5c, 255]));
        op!("expr_array_ref", cx.expr_array_ref(sp, thin_vec![cx.expr_usize(sp, 1), cx.expr_usize(sp, 2)]));
        op!("expr_some", cx.expr_some(sp, cx.expr_self(sp)));
        op!("expr_none", cx.expr_none(sp));
        op!("expr_tuple", cx.expr_tuple(sp, thin_vec![]));
        op!("expr_ok", cx.expr_ok(sp, cx.expr_self(sp)));
        op!("pat_wild", cx.pat_wild(sp));
        op!("pat_ident", cx.pat_ident(sp, a));
        op!("pat_ident_binding_mode", cx.pat_ident_binding_mode(sp, a, ast::BindingMode::REF_MUT));
        op!("pat_path", cx.pat_path(sp, cx.path_ident(sp, a)));
        op!("pat_struct", cx.pat_struct(sp, cx.path_ident(sp, a), thin_vec![]));
        op!("pat_tuple", cx.pat_tuple(sp, thin_vec![cx.pat_wild(sp)]));
        op!("pat_some", cx.pat_some(sp, cx.pat_wild(sp)));
        op!("arm", cx.arm(sp, cx.pat_wild(sp), cx.expr_self(sp)));
        op!("expr_match", cx.expr_match(sp, cx.expr_self(sp), thin_vec![cx.arm(sp2, cx.pat_wild(sp), cx.expr_self(sp))]));
        op!("expr_if", cx.expr_if(sp, cx.expr_bool(sp, true), cx.expr_usize(sp, 1), Some(cx.expr_usize(sp2, 2))));
        op!("expr_if_none", cx.expr_if(sp, cx.expr_bool(sp, true), cx.expr_usize(sp, 1), None));
        op!("closure", cx.closure(sp, vec![a, b], cx.expr_self(sp)));
        op!("param", cx.param(sp, a, cx.ty_infer(sp)));
        op!("fn_decl", cx.fn_decl(thin_vec![], ast::FnRetTy::Ty(cx.ty_unit(sp))));
        op!("item_trait_impl", cx.item_trait_impl(sp, ast::AttrVec::new(), cx.empty_generics(sp2), ast::Safety::Default, true, cx.trait_ref(cx.path_ident(sp, a)), cx.ty_self(sp), thin_vec![]));
        op!("item_static", cx.item_static(sp, ast::AttrVec::new(), a, cx.ty_unit(sp), ast::Mutability::Mut, cx.expr_tuple(sp, thin_vec![])));
        op!("item_const", cx.item_const(sp, a, cx.ty_unit(sp), Some(cx.expr_usize(sp, 0))));
        op!("attr_word", cx.attr_word(sym::inline, sp));
        op!("attr_name_value_str", cx.attr_name_value_str(sym::doc, Symbol::intern("x\"y"), sp));
        op!("attr_nested_word", cx.attr_nested_word(sym::derive, sym::Debug, sp));
        op!("attr_nested", cx.attr_nested(parsed_attr.get_normal_item().clone(), sp));
        op!("empty_generics", cx.empty_generics(sp));
        // base.rs: MacEager / DummyResult
        op!("mac_eager_expr", MacEager::expr(cx.expr_usize(sp, 5)).make_expr());
        op!("mac_eager_pat_lit", MacEager::expr(cx.expr_usize(sp, 5)).make_pat());
        op!("mac_eager_pat_none", MacEager::expr(cx.expr_self(sp)).make_pat());
        op!("mac_eager_stmts", MacEager::expr(cx.expr_usize(sp, 5)).make_stmts());
        op!("mac_eager_items_none", MacEager::expr(cx.expr_usize(sp, 5)).make_items());
        op!("mac_eager_ty", MacEager::ty(cx.ty_unit(sp)).make_ty());
        op!("dummy_valid_expr", DummyResult::any_valid(sp).make_expr());
        op!("dummy_stmts", DummyResult::any_valid(sp).make_stmts());
        op!("dummy_pat", DummyResult::any_valid(sp).make_pat());
        op!("dummy_ty", DummyResult::any_valid(sp).make_ty());
        op!("dummy_items", DummyResult::any_valid(sp).make_items());
        op!("dummy_where_predicates", DummyResult::any_valid(sp).make_where_predicates());
        op!("dummy_crate", DummyResult::any_valid(sp).make_crate());
        op!("raw_expr", DummyResult::raw_expr(sp2, None));

        println!("[");
        let n = ev.len();
        for (i, (name, v)) in ev.into_iter().enumerate() {
            println!("  [{}, {}]{}", esc(&name), esc(&v), if i + 1 < n { "," } else { "" });
        }
        println!("]");
    });
}
