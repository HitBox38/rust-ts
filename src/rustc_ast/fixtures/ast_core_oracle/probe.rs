// Oracle probe for src/rustc_ast/ast.test.ts ("ast-core oracle" tests); its stdout is probe.out.
// Build + run against the pinned nightly (commit in UPSTREAM.json), from this directory:
//   rustc +nightly-2026-10-11 --edition 2024 probe.rs -o /tmp/probe \
//     && DYLD_LIBRARY_PATH=$(rustc +nightly-2026-10-11 --print sysroot)/lib /tmp/probe > probe.out
// Every output line is `<case>: <value>`; the TS test builds the same nodes and compares by case.
#![feature(rustc_private)]
extern crate rustc_ast;
extern crate rustc_driver;
extern crate rustc_span;
extern crate thin_vec;

use std::cell::RefCell;

use rustc_ast::ast::*;
use rustc_ast::attr::data_structures::CfgEntry;
use rustc_ast::node_id::NodeId;
use rustc_ast::token::Delimiter;
use rustc_ast::tokenstream::{DelimSpan, TokenStream};
use rustc_span::{Spanned, respan};
use rustc_span::{BytePos, Ident, Span, Symbol, kw, sym};
use thin_vec::{ThinVec, thin_vec};

fn sp(lo: u32, hi: u32) -> Span {
    Span::with_root_ctxt(BytePos(lo), BytePos(hi))
}
fn id(n: u32) -> NodeId {
    NodeId::from_u32(n)
}
fn ident(s: &str, lo: u32, hi: u32) -> Ident {
    Ident::new(Symbol::intern(s), sp(lo, hi))
}
fn ty(n: u32, kind: TyKind, lo: u32, hi: u32) -> Box<Ty> {
    Box::new(Ty { id: id(n), kind, span: sp(lo, hi) })
}
fn path_ty(n: u32, s: &str, lo: u32, hi: u32) -> Box<Ty> {
    ty(n, TyKind::Path(None, Path::from_ident(ident(s, lo, hi))), lo, hi)
}
fn pat(n: u32, kind: PatKind, lo: u32, hi: u32) -> Box<Pat> {
    Box::new(Pat { id: id(n), kind, span: sp(lo, hi) })
}
fn expr(n: u32, kind: ExprKind, lo: u32, hi: u32) -> Box<Expr> {
    Box::new(Expr { id: id(n), kind, span: sp(lo, hi), attrs: ThinVec::new(), tokens: None })
}
fn path_expr(n: u32, s: &str, lo: u32, hi: u32) -> Box<Expr> {
    expr(n, ExprKind::Path(None, Path::from_ident(ident(s, lo, hi))), lo, hi)
}
fn mac(s: &str, lo: u32, hi: u32) -> Box<MacCall> {
    Box::new(MacCall {
        path: Path::from_ident(ident(s, lo, hi)),
        args: Box::new(DelimArgs {
            dspan: DelimSpan::from_single(sp(hi, hi + 2)),
            delim: Delimiter::Parenthesis,
            tokens: TokenStream::default(),
        }),
    })
}
fn block_expr(n: u32, stmts: ThinVec<Stmt>, label: Option<Label>) -> Box<Expr> {
    let block = Box::new(Block { stmts, id: id(n + 1), rules: BlockCheckMode::Default, span: sp(500, 520) });
    expr(n, ExprKind::Block(block, label), 500, 520)
}
fn param(pat_: Box<Pat>, ty_: Box<Ty>) -> Param {
    Param { attrs: ThinVec::new(), ty: ty_, pat: pat_, id: id(99), span: sp(1, 90), is_placeholder: false }
}
fn self_pat(by_ref: ByRef, m: Mutability) -> Box<Pat> {
    pat(1, PatKind::Ident(BindingMode(by_ref, m), Ident::new(kw::SelfLower, sp(10, 14)), None), 6, 14)
}
fn fn_sig(header: FnHeader) -> FnSig {
    let decl = Box::new(FnDecl { inputs: ThinVec::new(), output: FnRetTy::Default(sp(300, 300)) });
    FnSig { header, decl, span: sp(200, 300) }
}

fn main() {
    rustc_span::create_default_session_globals_then(|| {
        let lt = Lifetime { id: id(7), ident: ident("'a", 3, 5) };
        let implicit = |n| ty(n, TyKind::ImplicitSelf, 20, 24);

        // ---- Param::to_self (ast.rs:2973)
        let to_self_cases: Vec<(&str, Param)> = vec![
            ("to_self/value_mut", param(self_pat(ByRef::No, Mutability::Mut), implicit(2))),
            (
                "to_self/region_lt_mut",
                param(self_pat(ByRef::No, Mutability::Not), ty(3, TyKind::Ref(Some(lt), implicit(2), Mutability::Mut), 15, 30)),
            ),
            (
                "to_self/region_none_not",
                param(self_pat(ByRef::No, Mutability::Not), ty(3, TyKind::Ref(None, implicit(2), Mutability::Not), 15, 30)),
            ),
            (
                "to_self/pinned_lt_not",
                param(self_pat(ByRef::No, Mutability::Not), ty(3, TyKind::PinnedRef(Some(lt), implicit(2), Mutability::Not), 15, 30)),
            ),
            ("to_self/explicit_path", param(self_pat(ByRef::No, Mutability::Mut), path_ty(4, "Box", 40, 43))),
            (
                "to_self/explicit_ref_non_self",
                param(self_pat(ByRef::No, Mutability::Not), ty(3, TyKind::Ref(None, path_ty(4, "Foo", 40, 43), Mutability::Not), 38, 43)),
            ),
            (
                "to_self/not_self_ident",
                param(pat(1, PatKind::Ident(BindingMode::NONE, ident("x", 10, 11), None), 10, 11), implicit(2)),
            ),
            ("to_self/by_ref", param(self_pat(ByRef::Yes(Pinnedness::Not, Mutability::Not), Mutability::Not), implicit(2))),
            ("to_self/wild", param(pat(1, PatKind::Wild, 10, 11), implicit(2))),
        ];
        for (name, p) in &to_self_cases {
            println!("{name}: {:?}", p.to_self());
        }

        // ---- Param::from_self (ast.rs:3004)
        let eself_ident = Ident::new(kw::SelfLower, sp(60, 64));
        let from_self_cases: Vec<(&str, Spanned<SelfKind>)> = vec![
            ("from_self/value_mut", respan(sp(50, 54), SelfKind::Value(Mutability::Mut))),
            ("from_self/region_lt_mut", respan(sp(50, 54), SelfKind::Region(Some(lt), Mutability::Mut))),
            ("from_self/region_none_not", respan(sp(50, 54), SelfKind::Region(None, Mutability::Not))),
            ("from_self/pinned_none_mut", respan(sp(50, 54), SelfKind::Pinned(None, Mutability::Mut))),
            ("from_self/explicit_not", respan(sp(50, 70), SelfKind::Explicit(path_ty(4, "Rc", 66, 70), Mutability::Not))),
        ];
        for (name, eself) in from_self_cases {
            let p = Param::from_self(ThinVec::new(), eself, eself_ident);
            println!("{name}: {:?}", p);
            println!("{name}/to_self: {:?}", p.to_self());
        }

        // ---- UseTree (ast.rs:3341)
        let prefix = Path {
            span: sp(100, 108),
            segments: thin_vec![PathSegment::from_ident(ident("foo", 100, 103)), PathSegment::from_ident(ident("bar", 105, 108))],
        };
        let trees: Vec<(&str, UseTree)> = vec![
            ("use_tree/simple", UseTree { prefix: prefix.clone(), kind: UseTreeKind::Simple(None) }),
            ("use_tree/rename", UseTree { prefix: prefix.clone(), kind: UseTreeKind::Simple(Some(ident("baz", 112, 115))) }),
            ("use_tree/glob", UseTree { prefix: prefix.clone(), kind: UseTreeKind::Glob(sp(110, 111)) }),
            (
                "use_tree/nested",
                UseTree { prefix: prefix.clone(), kind: UseTreeKind::Nested { items: ThinVec::new(), span: sp(110, 120) } },
            ),
            (
                "use_tree/empty_prefix",
                UseTree { prefix: Path { span: sp(130, 130), segments: ThinVec::new() }, kind: UseTreeKind::Simple(None) },
            ),
        ];
        std::panic::set_hook(Box::new(|_| {}));
        for (name, t) in &trees {
            let ident = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| t.ident()));
            match ident {
                Ok(i) => println!("{name}/ident: {:?}", i),
                Err(e) => println!(
                    "{name}/ident: panic {:?}",
                    e.downcast_ref::<String>().cloned().or(e.downcast_ref::<&str>().map(|s| s.to_string()))
                ),
            }
            println!("{name}/span: {:?}", t.span());
            println!("{name}/hi_span: {:?}", t.hi_span());
        }
        let _ = std::panic::take_hook();

        // ---- Pat::to_ty for Ref / Slice (ast.rs:645)
        let x = || pat(11, PatKind::Ident(BindingMode::NONE, ident("u8", 151, 153), None), 151, 153);
        let pats: Vec<(&str, Box<Pat>)> = vec![
            ("pat_to_ty/ref_mut", pat(10, PatKind::Ref(x(), Pinnedness::Not, Mutability::Mut), 150, 153)),
            ("pat_to_ty/ref_pinned_not", pat(10, PatKind::Ref(x(), Pinnedness::Pinned, Mutability::Not), 150, 153)),
            ("pat_to_ty/ref_of_rest", pat(10, PatKind::Ref(pat(11, PatKind::Rest, 151, 153), Pinnedness::Not, Mutability::Not), 150, 153)),
            ("pat_to_ty/slice_one", pat(10, PatKind::Slice(thin_vec![*x()]), 150, 154)),
            ("pat_to_ty/slice_two", pat(10, PatKind::Slice(thin_vec![*x(), *x()]), 150, 154)),
            ("pat_to_ty/slice_empty", pat(10, PatKind::Slice(ThinVec::new()), 150, 154)),
        ];
        for (name, p) in &pats {
            println!("{name}: {:?}", p.to_ty());
        }

        // ---- Expr::to_ty for Binary / Repeat (ast.rs:1506)
        let bin = |op: BinOpKind, l: Box<Expr>, r: Box<Expr>| {
            expr(20, ExprKind::Binary(Spanned { node: op, span: sp(205, 206) }, l, r), 200, 212)
        };
        let len = || AnonConst { id: id(25), value: path_expr(26, "N", 260, 261) };
        let exprs: Vec<(&str, Box<Expr>)> = vec![
            ("expr_to_ty/binary_add_paths", bin(BinOpKind::Add, path_expr(21, "Send", 200, 204), path_expr(22, "Sync", 207, 211))),
            ("expr_to_ty/binary_sub_paths", bin(BinOpKind::Sub, path_expr(21, "Send", 200, 204), path_expr(22, "Sync", 207, 211))),
            (
                "expr_to_ty/binary_add_non_path",
                bin(BinOpKind::Add, path_expr(21, "Send", 200, 204), expr(22, ExprKind::Underscore, 207, 208)),
            ),
            ("expr_to_ty/repeat_path", expr(23, ExprKind::Repeat(path_expr(24, "u8", 251, 253), len()), 250, 262)),
            ("expr_to_ty/repeat_underscore", expr(23, ExprKind::Repeat(expr(24, ExprKind::Underscore, 251, 252), len()), 250, 262)),
            ("expr_to_ty/repeat_non_ty", expr(23, ExprKind::Repeat(expr(24, ExprKind::Ret(None), 251, 257), len()), 250, 262)),
        ];
        for (name, e) in &exprs {
            println!("{name}: {:?}", e.to_ty());
        }

        // ---- FnSig::header_span / safety_span / extern_span (ast.rs:2355-2378)
        let abi = StrLit {
            symbol: sym::C,
            suffix: None,
            symbol_unescaped: sym::C,
            style: StrStyle::Cooked,
            span: sp(237, 240),
        };
        let sigs: Vec<(&str, FnHeader)> = vec![
            ("fn_sig/empty", FnHeader::default()),
            ("fn_sig/unsafe", FnHeader { safety: Safety::Unsafe(sp(210, 216)), ..FnHeader::default() }),
            ("fn_sig/safe", FnHeader { safety: Safety::Safe(sp(210, 214)), ..FnHeader::default() }),
            ("fn_sig/extern_implicit", FnHeader { ext: Extern::Implicit(sp(220, 226)), ..FnHeader::default() }),
            ("fn_sig/const", FnHeader { constness: Const::Yes(sp(200, 205)), ..FnHeader::default() }),
            (
                "fn_sig/async",
                FnHeader { coroutine_marker: Some(CoroutineMarker::new(CoroutineKind::Async, sp(206, 211))), ..FnHeader::default() },
            ),
            (
                "fn_sig/const_extern_explicit",
                FnHeader { constness: Const::Yes(sp(200, 205)), ext: Extern::Explicit(abi, sp(230, 240)), ..FnHeader::default() },
            ),
            (
                "fn_sig/all",
                FnHeader {
                    constness: Const::Yes(sp(200, 205)),
                    coroutine_marker: Some(CoroutineMarker::new(CoroutineKind::Gen, sp(206, 209))),
                    safety: Safety::Unsafe(sp(210, 216)),
                    ext: Extern::Explicit(abi, sp(230, 240)),
                },
            ),
        ];
        for (name, h) in sigs {
            let s = fn_sig(h);
            println!("{name}/header_span: {:?}", s.header_span());
            println!("{name}/safety_span: {:?}", s.safety_span());
            println!("{name}/extern_span: {:?}", s.extern_span());
        }

        // ---- CfgEntry::lower_spans (attr/data_structures.rs:20)
        let mut cfg = CfgEntry::All(
            thin_vec![
                CfgEntry::Any(
                    thin_vec![
                        CfgEntry::Bool(true, sp(402, 406)),
                        CfgEntry::NameValue { name: sym::unix, value: None, span: sp(408, 412) },
                    ],
                    sp(401, 413),
                ),
                CfgEntry::Not(Box::new(CfgEntry::Version(None, sp(418, 425))), sp(414, 426)),
                CfgEntry::NameValue { name: sym::target_os, value: Some(Symbol::intern("linux")), span: sp(427, 445) },
            ],
            sp(400, 446),
        );
        let visited = RefCell::new(Vec::new());
        let visited_ref = &visited;
        cfg.lower_spans(move |s: Span| {
            visited_ref.borrow_mut().push(s);
            Span::with_root_ctxt(s.lo() + BytePos(1000), s.hi() + BytePos(2000))
        });
        println!("cfg_lower_spans/visited: {:?}", visited.borrow());
        println!("cfg_lower_spans/result: {:?}", cfg);

        // ---- Expr::optionally_braced_mac_call (ast.rs:1453)
        let mac_expr = || expr(31, ExprKind::MacCall(mac("m", 510, 511)), 510, 515);
        let mac_stmt = Stmt {
            id: id(32),
            kind: StmtKind::MacCall(Box::new(MacCallStmt {
                mac: mac("m", 510, 511),
                style: MacStmtStyle::Semicolon,
                attrs: ThinVec::new(),
                tokens: None,
            })),
            span: sp(510, 516),
        };
        let expr_stmt = Stmt { id: id(33), kind: StmtKind::Expr(mac_expr()), span: sp(510, 515) };
        let semi_stmt = Stmt { id: id(34), kind: StmtKind::Semi(mac_expr()), span: sp(510, 516) };
        let label = Label { ident: ident("'l", 495, 497) };
        let cases: Vec<(&str, Box<Expr>)> = vec![
            ("braced_mac/mac_call", mac_expr()),
            ("braced_mac/block_mac_stmt", block_expr(40, thin_vec![mac_stmt.clone()], None)),
            ("braced_mac/block_expr_stmt", block_expr(40, thin_vec![expr_stmt.clone()], None)),
            ("braced_mac/block_semi_stmt", block_expr(40, thin_vec![semi_stmt], None)),
            ("braced_mac/block_two_stmts", block_expr(40, thin_vec![mac_stmt.clone(), expr_stmt.clone()], None)),
            ("braced_mac/labeled_block", block_expr(40, thin_vec![mac_stmt.clone()], Some(label))),
            ("braced_mac/nested_block", block_expr(42, thin_vec![Stmt { id: id(45), kind: StmtKind::Expr(block_expr(40, thin_vec![mac_stmt], None)), span: sp(500, 520) }], None)),
        ];
        for (name, e) in &cases {
            println!("{name}/false: {:?}", e.optionally_braced_mac_call(false));
            println!("{name}/true: {:?}", e.optionally_braced_mac_call(true));
        }
    });
}
