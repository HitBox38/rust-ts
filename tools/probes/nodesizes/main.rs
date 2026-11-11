//! Oracle probe for src/rustc_passes/input_stats.ts (lane stats): the sizes `-Zinput-stats` prints.
//!
//!   nodesizes
//!
//! rustc_passes input_stats.rs records `size_of_val(val)` for every AST and HIR node it visits; each `val` is a
//! reference to a statically known, sized type, so its size is `size_of::<T>()` of that type as the oracle compiler
//! lays it out. This probe links the oracle's own rustc_ast / rustc_hir / rustc_attr_ir (rustc-dev) and prints, one
//! per line, `<key> <size>`, where `<key>` names the type as input_stats.rs writes it (`hir::Ty<AmbigArg>` for the
//! `&hir::Ty<'v, AmbigArg>` of `visit_ty`). The list is every type input_stats.rs passes as `val`, in the order
//! the file first records it. Deterministic: no input, no hashing.
//!
//! The layouts are those of the host the toolchain was built for (the tests that print them are
//! `needs-deterministic-layouts` and `only-64bit`); tools/gen-input-stats-sizes.ts records the host.
#![feature(rustc_private)]
extern crate rustc_ast;
extern crate rustc_attr_ir;
extern crate rustc_driver;
extern crate rustc_hir;

use std::mem::size_of;

use rustc_ast as ast;
use rustc_hir::{self as hir, AmbigArg};

macro_rules! sizes {
    ($($key:literal => $ty:ty),* $(,)?) => {
        $( println!("{} {}", $key, size_of::<$ty>()); )*
    };
}

fn main() {
    sizes! {
        // `impl hir_visit::Visitor for StatCollector`, in file order.
        "hir::Param" => hir::Param<'static>,
        "hir::Item" => hir::Item<'static>,
        "hir::Body" => hir::Body<'static>,
        "hir::Mod" => hir::Mod<'static>,
        "hir::ForeignItem" => hir::ForeignItem<'static>,
        "hir::LetStmt" => hir::LetStmt<'static>,
        "hir::Block" => hir::Block<'static>,
        "hir::Stmt" => hir::Stmt<'static>,
        "hir::Arm" => hir::Arm<'static>,
        "hir::Pat" => hir::Pat<'static>,
        "hir::PatField" => hir::PatField<'static>,
        "hir::Expr" => hir::Expr<'static>,
        "hir::ExprField" => hir::ExprField<'static>,
        "hir::Ty<AmbigArg>" => hir::Ty<'static, AmbigArg>,
        "hir::GenericParam" => hir::GenericParam<'static>,
        "hir::Generics" => hir::Generics<'static>,
        "hir::WherePredicate" => hir::WherePredicate<'static>,
        "hir::FnDecl" => hir::FnDecl<'static>,
        "hir::UseTree" => hir::UseTree<'static>,
        "hir::TraitItem" => hir::TraitItem<'static>,
        "hir::TraitItemId" => hir::TraitItemId,
        "hir::ImplItem" => hir::ImplItem<'static>,
        "hir::ForeignItemId" => hir::ForeignItemId,
        "hir::ImplItemId" => hir::ImplItemId,
        "hir::GenericBound" => hir::GenericBound<'static>,
        "hir::FieldDef" => hir::FieldDef<'static>,
        "hir::Variant" => hir::Variant<'static>,
        "hir::GenericArg" => hir::GenericArg<'static>,
        "hir::Lifetime" => hir::Lifetime,
        "hir::Path" => hir::Path<'static>,
        "hir::PathSegment" => hir::PathSegment<'static>,
        "hir::GenericArgs" => hir::GenericArgs<'static>,
        "hir::AssocItemConstraint" => hir::AssocItemConstraint<'static>,
        "rustc_attr_ir::Attribute" => rustc_attr_ir::Attribute,
        "hir::InlineAsm" => hir::InlineAsm<'static>,
        // `impl ast_visit::Visitor for StatCollector`, in file order.
        "ast::ForeignItem" => ast::ForeignItem,
        "ast::Item" => ast::Item,
        "ast::Local" => ast::Local,
        "ast::Block" => ast::Block,
        "ast::Stmt" => ast::Stmt,
        "ast::Param" => ast::Param,
        "ast::Arm" => ast::Arm,
        "ast::Pat" => ast::Pat,
        "ast::Expr" => ast::Expr,
        "ast::Ty" => ast::Ty,
        "ast::GenericParam" => ast::GenericParam,
        "ast::WherePredicate" => ast::WherePredicate,
        "ast::FnDecl" => ast::FnDecl,
        "ast::AssocItem" => ast::AssocItem,
        "ast::GenericBound" => ast::GenericBound,
        "ast::FieldDef" => ast::FieldDef,
        "ast::Variant" => ast::Variant,
        "ast::PathSegment" => ast::PathSegment,
        "ast::GenericArgs" => ast::GenericArgs,
        "ast::Attribute" => ast::Attribute,
        "ast::ExprField" => ast::ExprField,
        "ast::Crate" => ast::Crate,
        "ast::InlineAsm" => ast::InlineAsm,
    }
}
