// Port of compiler/rustc_hir/src/intravisit.rs
//! HIR walker for walking the contents of nodes.
//!
//! Here are the three available patterns for the visitor strategy,
//! in roughly the order of desirability:
//!
//! 1. **Shallow visit**: Get a simple callback for every item (or item-like thing) in the HIR.
//!    - Example: find all items with a `#[foo]` attribute on them.
//!    - How: Use the `hir_crate_items` or `hir_module_items` query to traverse over item-like ids
//!       (ItemId, TraitItemId, etc.) and use tcx.def_kind and `tcx.hir_item*(id)` to filter and
//!       access actual item-like thing, respectively.
//!    - Pro: Efficient; just walks the lists of item ids and gives users control whether to access
//!       the hir_owners themselves or not.
//!    - Con: Don't get information about nesting
//!    - Con: Don't have methods for specific bits of HIR, like "on
//!      every expr, do this".
//! 2. **Deep visit**: Want to scan for specific kinds of HIR nodes within
//!    an item, but don't care about how item-like things are nested
//!    within one another.
//!    - Example: Examine each expression to look for its type and do some check or other.
//!    - How: Implement `intravisit::Visitor` and override the `NestedFilter` type to
//!      `nested_filter::OnlyBodies` (and implement `maybe_tcx`), and use
//!      `tcx.hir_visit_all_item_likes_in_crate(&mut visitor)`. Within your
//!      `intravisit::Visitor` impl, implement methods like `visit_expr()` (don't forget to invoke
//!      `intravisit::walk_expr()` to keep walking the subparts).
//!    - Pro: Visitor methods for any kind of HIR node, not just item-like things.
//!    - Pro: Integrates well into dependency tracking.
//!    - Con: Don't get information about nesting between items
//! 3. **Nested visit**: Want to visit the whole HIR and you care about the nesting between
//!    item-like things.
//!    - Example: Lifetime resolution, which wants to bring lifetimes declared on the
//!      impl into scope while visiting the impl-items, and then back out again.
//!    - How: Implement `intravisit::Visitor` and override the `NestedFilter` type to
//!      `nested_filter::All` (and implement `maybe_tcx`). Walk your crate with
//!      `tcx.hir_walk_toplevel_module(visitor)`.
//!    - Pro: Visitor methods for any kind of HIR node, not just item-like things.
//!    - Pro: Preserves nesting information
//!    - Con: Does not integrate well into dependency tracking.
//!
//! If you have decided to use this visitor, here are some general
//! notes on how to do so:
//!
//! Each overridden visit method has full control over what
//! happens with its node, it can do its own traversal of the node's children,
//! call `intravisit::walk_*` to apply the default traversal algorithm, or prevent
//! deeper traversal by doing nothing.
//!
//! When visiting the HIR, the contents of nested items are NOT visited
//! by default. This is different from the AST visitor, which does a deep walk.
//! Hence this module is called `intravisit`; see the method `visit_nested_item`
//! for more details.
//!
//! Note: it is an important invariant that the default visitor walks
//! the body of a function in "execution order" - more concretely, if
//! we consider the reverse post-order (RPO) of the CFG implied by the HIR,
//! then a pre-order traversal of the HIR is consistent with the CFG RPO
//! on the *initial CFG point* of each HIR node, while a post-order traversal
//! of the HIR is consistent with the CFG RPO on each *final CFG point* of
//! each CFG node.
//!
//! One thing that follows is that if HIR node A always starts/ends executing
//! before HIR node B, then A appears in traversal pre/postorder before B,
//! respectively. (This follows from RPO respecting CFG domination).
//!
//! This order consistency is required in a few places in rustc, for
//! example coroutine inference, and possibly also HIR borrowck.
//
// PORT: the visitor follows rustc_ast/visit.ts (lane ast-visit):
// - `trait Visitor` with default methods -> the base class `Visitor<R = undefined>`; implementors
//   `extends Visitor<R>` and override. `R` is `Self::Result` (`()` is `undefined`).
// - `type Result: VisitorResult = ()` -> the `Result` property (a `VisitorResult` impl object, default
//   `VisitorResult.unit` on the prototype). `try_visit!(e)` ->
//   `if ((r = try_visit(visitor.Result, e)) !== undefined) return r;`.
// - `type NestedFilter: NestedFilter = IgnoreNested` -> the `NestedFilter` property (an object with the
//   `INTER`/`INTRA` consts, default `IgnoreNested` on the prototype). `type MaybeTyCtxt` is erased:
//   `maybe_tcx()` returns a `HirTyCtxt`.
// - `visit_opt!(v, m, opt)` -> `if (opt !== undefined) { try_visit!(v.m(opt)) }`; `walk_list!(v, m, xs)` ->
//   `for (const x of xs) { try_visit!(v.m(x)) }`, expanded inline.
// - `&'v Ty<'v, AmbigArg>` is `Ty<AmbigArg>` (`AmbigArg` is uninhabited, `never`); `&'v Ty<'v>` is `Ty`.
// - Destructuring `let X { a, b: _ } = x;` binds the used fields only; ignored fields are kept as a
//   comment so the walks still list every field like upstream.
import { visit } from "../rustc_ast/lib.ts";
import type { Label } from "../rustc_ast/lib.ts";
import type { Attribute } from "../rustc_attr_ir/lib.ts";
import type { HirId } from "../rustc_hir_id/lib.ts";
import { LocalModId } from "../rustc_span/def_id.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";
import { debug_Ident, type Ident, type Symbol } from "../rustc_span/symbol.ts";
import { type Debug, debug_tuple } from "../std/fmt.ts";
import { panic, unreachable } from "../std/panic.ts";
import {
  type AmbigArg,
  type AnonConst,
  type Arm,
  type AssocItemConstraint,
  type Block,
  type Body,
  type BodyId,
  Constness,
  type ConstArg,
  type ConstArgExprField,
  type ConstBlock,
  type ConstItemRhs,
  debug_FnHeader,
  debug_FnSig,
  debug_Generics,
  type Defaultness,
  type EnumDef,
  type Expr,
  type ExprField,
  type FieldDef,
  type FnDecl,
  type FnHeader,
  type FnRetTy,
  type FnSig,
  type ForeignItem,
  type ForeignItemId,
  type GenericArg,
  type GenericArgs,
  type GenericBound,
  type GenericParam,
  type Generics,
  type ImplItem,
  type ImplItemId,
  type InferArg,
  type InlineAsm,
  IsAsync,
  type Item,
  type ItemId,
  type LetStmt,
  type Lifetime,
  type Lit,
  type Mod,
  type Node,
  type OpaqueTy,
  type Param,
  type Pat,
  type PatExpr,
  type PatField,
  Path,
  type PathSegment,
  type PolyTraitRef,
  type PreciseCapturingArg,
  QPath,
  type Stmt,
  type TestBinderBody,
  type TestBinderBoundTypeConstraint,
  type TestBinderConstraint,
  type TestBinderExists,
  type TestBinderForall,
  type TraitItem,
  type TraitItemId,
  type TraitRef,
  type Ty,
  type TyPat,
  type UseTree,
  type Variant,
  VariantData,
  type WherePredicate,
} from "./hir.ts";

type VisitorResult<R> = visit.VisitorResult<R, unknown>;
const try_visit = visit.try_visit;
const VisitorResult = visit.VisitorResult;

// rustc-type: compiler/rustc_hir/src/intravisit.rs:77 FnKind
// #[derive(Copy, Clone, Debug)]
export type FnKind =
  /// `#[xxx] pub async/const/extern "Abi" fn foo()`
  | { readonly $: "ItemFn"; _0: Ident; _1: Generics; _2: FnHeader }
  /// `fn foo(&self)`
  | { readonly $: "Method"; _0: Ident; _1: FnSig }
  /// `|x, y| {}`
  | { readonly $: "Closure" };

/** `#[derive(Debug)]` of `FnKind` */
export const debug_FnKind: Debug<FnKind> = (v, f) => {
  switch (v.$) {
    case "ItemFn":
      return debug_tuple(f, "ItemFn", [debug_Ident(v._0, f), debug_Generics(v._1, f), debug_FnHeader(v._2, f)]);
    case "Method":
      return debug_tuple(f, "Method", [debug_Ident(v._0, f), debug_FnSig(v._1, f)]);
    case "Closure":
      return "Closure";
  }
};

export const FnKind = {
  /** Unit variant `FnKind::Closure`, a shared frozen singleton. */
  Closure: Object.freeze({ $: "Closure" as const }),

  // rustc: compiler/rustc_hir/src/intravisit.rs:89 header
  header(self: FnKind): FnHeader | undefined {
    switch (self.$) {
      case "ItemFn":
        return self._2;
      case "Method":
        return self._1.header;
      case "Closure":
        return undefined;
    }
  },

  // rustc: compiler/rustc_hir/src/intravisit.rs:97 constness
  constness(self: FnKind): Constness {
    const header = FnKind.header(self);
    return header === undefined ? Constness.NotConst : header.constness;
  },

  // rustc: compiler/rustc_hir/src/intravisit.rs:101 asyncness
  asyncness(self: FnKind): IsAsync {
    const header = FnKind.header(self);
    return header === undefined ? IsAsync.NotAsync : header.asyncness;
  },
};

// rustc-trait: compiler/rustc_hir/src/intravisit.rs:109 HirTyCtxt
/// HIR things retrievable from `TyCtxt`, avoiding an explicit dependence on
/// `TyCtxt`. The only impls are for `!` (where these functions are never
/// called) and `TyCtxt` (in `rustc_middle`).
export interface HirTyCtxt {
  /// Retrieves the `Node` corresponding to `id`.
  // rustc: compiler/rustc_hir/src/intravisit.rs:111 hir_node
  hir_node(hir_id: HirId): Node;
  // rustc: compiler/rustc_hir/src/intravisit.rs:112 hir_body
  hir_body(id: BodyId): Body;
  // rustc: compiler/rustc_hir/src/intravisit.rs:113 hir_item
  hir_item(id: ItemId): Item;
  // rustc: compiler/rustc_hir/src/intravisit.rs:114 hir_trait_item
  hir_trait_item(id: TraitItemId): TraitItem;
  // rustc: compiler/rustc_hir/src/intravisit.rs:115 hir_impl_item
  hir_impl_item(id: ImplItemId): ImplItem;
  // rustc: compiler/rustc_hir/src/intravisit.rs:116 hir_foreign_item
  hir_foreign_item(id: ForeignItemId): ForeignItem;
}

/// Used when no tcx is actually available, forcing manual implementation of nested visitors.
// PORT: `impl HirTyCtxt for !`: a value of `!` cannot exist, so every method body (`*self`) is
// unreachable; `unreachable()` (an ICE) stands for it.
export const HirTyCtxt_never: HirTyCtxt = {
  // rustc: compiler/rustc_hir/src/intravisit.rs:121 hir_node
  hir_node(_: HirId): Node {
    return unreachable();
  },
  // rustc: compiler/rustc_hir/src/intravisit.rs:124 hir_body
  hir_body(_: BodyId): Body {
    return unreachable();
  },
  // rustc: compiler/rustc_hir/src/intravisit.rs:127 hir_item
  hir_item(_: ItemId): Item {
    return unreachable();
  },
  // rustc: compiler/rustc_hir/src/intravisit.rs:130 hir_trait_item
  hir_trait_item(_: TraitItemId): TraitItem {
    return unreachable();
  },
  // rustc: compiler/rustc_hir/src/intravisit.rs:133 hir_impl_item
  hir_impl_item(_: ImplItemId): ImplItem {
    return unreachable();
  },
  // rustc: compiler/rustc_hir/src/intravisit.rs:136 hir_foreign_item
  hir_foreign_item(_: ForeignItemId): ForeignItem {
    return unreachable();
  },
};

// rustc-trait: compiler/rustc_hir/src/intravisit.rs:153 NestedFilter
/// Specifies what nested things a visitor wants to visit. By "nested
/// things", we are referring to bits of HIR that are not directly embedded
/// within one another but rather indirectly, through a table in the crate.
/// This is done to control dependencies during incremental compilation: the
/// non-inline bits of HIR can be tracked and hashed separately.
///
/// The most common choice is `OnlyBodies`, which will cause the visitor to
/// visit fn bodies for fns that it encounters, and closure bodies, but
/// skip over nested item-like things.
///
/// See the [module level documentation](self) for more details on the overall
/// visit strategy.
// PORT: `type MaybeTyCtxt: HirTyCtxt<'hir>` is erased (`maybe_tcx()` returns a `HirTyCtxt`).
export interface NestedFilter {
  /// Whether the visitor visits nested "item-like" things.
  /// E.g., item, impl-item.
  readonly INTER: boolean;
  /// Whether the visitor visits "intra item-like" things.
  /// E.g., function body, closure, `AnonConst`
  readonly INTRA: boolean;
}

// rustc-type: compiler/rustc_hir/src/intravisit.rs:171 IgnoreNested
/// Do not visit any nested things. When you add a new
/// "non-nested" thing, you will want to audit such uses to see if
/// they remain valid.
///
/// Use this if you are only walking some particular kind of tree
/// (i.e., a type, or fn signature) and you don't want to thread a
/// `tcx` around.
// PORT: `pub struct IgnoreNested(())` + `impl NestedFilter for IgnoreNested` -> the impl's consts
// (`type MaybeTyCtxt = !` is `HirTyCtxt_never`).
export const IgnoreNested: NestedFilter = Object.freeze({
  INTER: false,
  INTRA: false,
});

/// Each method of the Visitor trait is a hook to be potentially
/// overridden. Each method's default implementation recursively visits
/// the substructure of the input via the corresponding `walk` method;
/// e.g., the `visit_mod` method by default calls `intravisit::walk_mod`.
///
/// Note that this visitor does NOT visit nested items by default
/// (this is why the module is called `intravisit`, to distinguish it
/// from the AST's `visit` module, which acts differently). If you
/// simply want to visit all items in the crate in some order, you
/// should call `tcx.hir_visit_all_item_likes_in_crate`. Otherwise, see the comment
/// on `visit_nested_item` for details on how to visit nested items.
///
/// If you want to ensure that your code handles every variant
/// explicitly, you need to override each method. (And you also need
/// to monitor future changes to `Visitor` in case a new method with a
/// new default implementation gets introduced.)
///
/// Every `walk_*` method uses deconstruction to access fields of structs and
/// enums. This will result in a compile error if a field is added, which makes
/// it more likely the appropriate visit call will be added for it.
// rustc-trait: compiler/rustc_hir/src/intravisit.rs:198 Visitor
export class Visitor<R = undefined> {
  // This type should not be overridden, it exists for convenient usage as `Self::MaybeTyCtxt`.
  // PORT: `type MaybeTyCtxt` is erased.

  ///////////////////////////////////////////////////////////////////////////
  // Nested items.

  /// Override this type to control which nested HIR are visited; see
  /// [`NestedFilter`] for details. If you override this type, you
  /// must also override [`maybe_tcx`](Self::maybe_tcx).
  ///
  /// **If for some reason you want the nested behavior, but don't
  /// have a `tcx` at your disposal:** then override the
  /// `visit_nested_XXX` methods. If a new `visit_nested_XXX` variant is
  /// added in the future, it will cause a panic which can be detected
  /// and fixed appropriately.
  // PORT: `type NestedFilter: NestedFilter<'v> = IgnoreNested;` -> the impl object; the default lives on
  // the prototype.
  declare NestedFilter: NestedFilter;

  /// The result type of the `visit_*` methods. Can be either `()`,
  /// or `ControlFlow<T>`.
  // PORT: `type Result: VisitorResult = ();` -> the impl object; the `()` default lives on the prototype.
  declare Result: VisitorResult<R>;

  /// If `type NestedFilter` is set to visit nested items, this method
  /// must also be overridden to provide a map to retrieve nested items.
  // rustc: compiler/rustc_hir/src/intravisit.rs:222 maybe_tcx
  maybe_tcx(): HirTyCtxt {
    return panic("maybe_tcx must be implemented or consider using `type NestedFilter = Skip` (the default)");
  }

  /// Invoked when a nested item is encountered. By default, when
  /// `Self::NestedFilter` is `Skip`, this method does
  /// nothing. **You probably don't want to override this method** --
  /// instead, override [`Self::NestedFilter`] or use the "shallow" or
  /// "deep" visit patterns described at
  /// [`intravisit`](self). The only reason to override
  /// this method is if you want a nested pattern but cannot supply a
  /// `TyCtxt`; see `maybe_tcx` for advice.
  // rustc: compiler/rustc_hir/src/intravisit.rs:237 visit_nested_item
  visit_nested_item(id: ItemId): R {
    let r: R | undefined;
    if (this.NestedFilter.INTER) {
      const item = this.maybe_tcx().hir_item(id);
      if ((r = try_visit(this.Result, this.visit_item(item))) !== undefined) return r;
    }
    return this.Result.output();
  }

  /// Like `visit_nested_item()`, but for trait items. See
  /// `visit_nested_item()` for advice on when to override this
  /// method.
  // rustc: compiler/rustc_hir/src/intravisit.rs:248 visit_nested_trait_item
  visit_nested_trait_item(id: TraitItemId): R {
    let r: R | undefined;
    if (this.NestedFilter.INTER) {
      const item = this.maybe_tcx().hir_trait_item(id);
      if ((r = try_visit(this.Result, this.visit_trait_item(item))) !== undefined) return r;
    }
    return this.Result.output();
  }

  /// Like `visit_nested_item()`, but for impl items. See
  /// `visit_nested_item()` for advice on when to override this
  /// method.
  // rustc: compiler/rustc_hir/src/intravisit.rs:259 visit_nested_impl_item
  visit_nested_impl_item(id: ImplItemId): R {
    let r: R | undefined;
    if (this.NestedFilter.INTER) {
      const item = this.maybe_tcx().hir_impl_item(id);
      if ((r = try_visit(this.Result, this.visit_impl_item(item))) !== undefined) return r;
    }
    return this.Result.output();
  }

  /// Like `visit_nested_item()`, but for foreign items. See
  /// `visit_nested_item()` for advice on when to override this
  /// method.
  // rustc: compiler/rustc_hir/src/intravisit.rs:270 visit_nested_foreign_item
  visit_nested_foreign_item(id: ForeignItemId): R {
    let r: R | undefined;
    if (this.NestedFilter.INTER) {
      const item = this.maybe_tcx().hir_foreign_item(id);
      if ((r = try_visit(this.Result, this.visit_foreign_item(item))) !== undefined) return r;
    }
    return this.Result.output();
  }

  /// Invoked to visit the body of a function, method or closure. Like
  /// `visit_nested_item`, does nothing by default unless you override
  /// `Self::NestedFilter`.
  // rustc: compiler/rustc_hir/src/intravisit.rs:281 visit_nested_body
  visit_nested_body(id: BodyId): R {
    let r: R | undefined;
    if (this.NestedFilter.INTRA) {
      const body = this.maybe_tcx().hir_body(id);
      if ((r = try_visit(this.Result, this.visit_body(body))) !== undefined) return r;
    }
    return this.Result.output();
  }

  // rustc: compiler/rustc_hir/src/intravisit.rs:289 visit_param
  visit_param(param: Param): R {
    return walk_param(this, param);
  }

  /// Visits the top-level item and (optionally) nested items / impl items. See
  /// `visit_nested_item` for details.
  // rustc: compiler/rustc_hir/src/intravisit.rs:295 visit_item
  visit_item(i: Item): R {
    return walk_item(this, i);
  }

  // rustc: compiler/rustc_hir/src/intravisit.rs:299 visit_body
  visit_body(b: Body): R {
    return walk_body(this, b);
  }

  ///////////////////////////////////////////////////////////////////////////

  // rustc: compiler/rustc_hir/src/intravisit.rs:305 visit_id
  visit_id(_hir_id: HirId): R {
    return this.Result.output();
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:308 visit_name
  visit_name(_name: Symbol): R {
    return this.Result.output();
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:311 visit_ident
  visit_ident(ident: Ident): R {
    return walk_ident(this, ident);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:314 visit_mod
  visit_mod(m: Mod, _s: Span, _id: LocalModId): R {
    return walk_mod(this, m);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:317 visit_foreign_item
  visit_foreign_item(i: ForeignItem): R {
    return walk_foreign_item(this, i);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:320 visit_local
  visit_local(l: LetStmt): R {
    return walk_local(this, l);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:323 visit_block
  visit_block(b: Block): R {
    return walk_block(this, b);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:326 visit_stmt
  visit_stmt(s: Stmt): R {
    return walk_stmt(this, s);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:329 visit_arm
  visit_arm(a: Arm): R {
    return walk_arm(this, a);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:332 visit_pat
  visit_pat(p: Pat): R {
    return walk_pat(this, p);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:335 visit_pat_field
  visit_pat_field(f: PatField): R {
    return walk_pat_field(this, f);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:338 visit_pat_expr
  visit_pat_expr(expr: PatExpr): R {
    return walk_pat_expr(this, expr);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:341 visit_lit
  visit_lit(_hir_id: HirId, _lit: Lit, _is_negated_pat: boolean): R {
    return this.Result.output();
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:344 visit_anon_const
  visit_anon_const(c: AnonConst): R {
    return walk_anon_const(this, c);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:347 visit_inline_const
  visit_inline_const(c: ConstBlock): R {
    return walk_inline_const(this, c);
  }

  // rustc: compiler/rustc_hir/src/intravisit.rs:351 visit_generic_arg
  visit_generic_arg(generic_arg: GenericArg): R {
    return walk_generic_arg(this, generic_arg);
  }

  /// All types are treated as ambiguous types for the purposes of hir visiting in
  /// order to ensure that visitors can handle infer vars without it being too error-prone.
  ///
  /// The [`Visitor::visit_infer`] method should be overridden in order to handle infer vars.
  // rustc: compiler/rustc_hir/src/intravisit.rs:359 visit_ty
  visit_ty(t: Ty<AmbigArg>): R {
    return walk_ty(this, t);
  }

  // rustc: compiler/rustc_hir/src/intravisit.rs:363 visit_const_item_rhs
  visit_const_item_rhs(c: ConstItemRhs): R {
    return walk_const_item_rhs(this, c);
  }

  /// All consts are treated as ambiguous consts for the purposes of hir visiting in
  /// order to ensure that visitors can handle infer vars without it being too error-prone.
  ///
  /// The [`Visitor::visit_infer`] method should be overridden in order to handle infer vars.
  // rustc: compiler/rustc_hir/src/intravisit.rs:371 visit_const_arg
  visit_const_arg(c: ConstArg<AmbigArg>): R {
    return walk_const_arg(this, c);
  }

  // #[allow(unused_variables)]
  // rustc: compiler/rustc_hir/src/intravisit.rs:376 visit_infer
  visit_infer(inf_id: HirId, _inf_span: Span, _kind: InferKind): R {
    return this.visit_id(inf_id);
  }

  // rustc: compiler/rustc_hir/src/intravisit.rs:380 visit_lifetime
  visit_lifetime(lifetime: Lifetime): R {
    return walk_lifetime(this, lifetime);
  }

  // rustc: compiler/rustc_hir/src/intravisit.rs:384 visit_expr
  visit_expr(ex: Expr): R {
    return walk_expr(this, ex);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:387 visit_expr_field
  visit_expr_field(field: ExprField): R {
    return walk_expr_field(this, field);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:390 visit_const_arg_expr_field
  visit_const_arg_expr_field(field: ConstArgExprField): R {
    return walk_const_arg_expr_field(this, field);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:393 visit_pattern_type_pattern
  visit_pattern_type_pattern(p: TyPat): R {
    return walk_ty_pat(this, p);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:396 visit_generic_param
  visit_generic_param(p: GenericParam): R {
    return walk_generic_param(this, p);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:399 visit_const_param_default
  visit_const_param_default(_param: HirId, ct: ConstArg): R {
    return walk_const_param_default(this, ct);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:402 visit_generics
  visit_generics(g: Generics): R {
    return walk_generics(this, g);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:405 visit_where_predicate
  visit_where_predicate(predicate: WherePredicate): R {
    return walk_where_predicate(this, predicate);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:408 visit_fn_ret_ty
  visit_fn_ret_ty(ret_ty: FnRetTy): R {
    return walk_fn_ret_ty(this, ret_ty);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:411 visit_fn_decl
  visit_fn_decl(fd: FnDecl): R {
    return walk_fn_decl(this, fd);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:414 visit_fn
  visit_fn(fk: FnKind, fd: FnDecl, b: BodyId, _: Span, id: LocalDefId): R {
    return walk_fn(this, fk, fd, b, id);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:424 visit_use
  visit_use(tree: UseTree, hir_id: HirId, _def_id: LocalDefId): R {
    return walk_use(this, tree, hir_id);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:432 visit_trait_item
  visit_trait_item(ti: TraitItem): R {
    return walk_trait_item(this, ti);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:435 visit_trait_item_ref
  visit_trait_item_ref(ii: TraitItemId): R {
    return walk_trait_item_ref(this, ii);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:438 visit_impl_item
  visit_impl_item(ii: ImplItem): R {
    return walk_impl_item(this, ii);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:441 visit_foreign_item_ref
  visit_foreign_item_ref(ii: ForeignItemId): R {
    return walk_foreign_item_ref(this, ii);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:444 visit_impl_item_ref
  visit_impl_item_ref(ii: ImplItemId): R {
    return walk_impl_item_ref(this, ii);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:447 visit_trait_ref
  visit_trait_ref(t: TraitRef): R {
    return walk_trait_ref(this, t);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:450 visit_param_bound
  visit_param_bound(bounds: GenericBound): R {
    return walk_param_bound(this, bounds);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:453 visit_precise_capturing_arg
  visit_precise_capturing_arg(arg: PreciseCapturingArg): R {
    return walk_precise_capturing_arg(this, arg);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:456 visit_poly_trait_ref
  visit_poly_trait_ref(t: PolyTraitRef): R {
    return walk_poly_trait_ref(this, t);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:459 visit_opaque_ty
  visit_opaque_ty(opaque: OpaqueTy): R {
    return walk_opaque_ty(this, opaque);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:462 visit_variant_data
  visit_variant_data(s: VariantData): R {
    return walk_struct_def(this, s);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:465 visit_field_def
  visit_field_def(s: FieldDef): R {
    return walk_field_def(this, s);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:468 visit_enum_def
  visit_enum_def(enum_definition: EnumDef): R {
    return walk_enum_def(this, enum_definition);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:471 visit_variant
  visit_variant(v: Variant): R {
    return walk_variant(this, v);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:474 visit_label
  visit_label(label: Label): R {
    return walk_label(this, label);
  }
  // The span is that of the surrounding type/pattern/expr/whatever.
  // rustc: compiler/rustc_hir/src/intravisit.rs:478 visit_qpath
  visit_qpath(qpath: QPath, id: HirId, _span: Span): R {
    return walk_qpath(this, qpath, id);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:481 visit_path
  visit_path(path: Path, _id: HirId): R {
    return walk_path(this, path);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:484 visit_path_segment
  visit_path_segment(path_segment: PathSegment): R {
    return walk_path_segment(this, path_segment);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:487 visit_generic_args
  visit_generic_args(generic_args: GenericArgs): R {
    return walk_generic_args(this, generic_args);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:490 visit_assoc_item_constraint
  visit_assoc_item_constraint(constraint: AssocItemConstraint): R {
    return walk_assoc_item_constraint(this, constraint);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:496 visit_attribute
  visit_attribute(_attr: Attribute): R {
    return this.Result.output();
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:499 visit_defaultness
  visit_defaultness(defaultness: Defaultness): R {
    return walk_defaultness(this, defaultness);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:502 visit_inline_asm
  visit_inline_asm(asm: InlineAsm, id: HirId): R {
    return walk_inline_asm(this, asm, id);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:505 visit_test_binder_body
  visit_test_binder_body(body: TestBinderBody): R {
    return walk_test_binder_body(this, body);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:508 visit_test_binder_forall
  visit_test_binder_forall(forall: TestBinderForall): R {
    return walk_test_binder_forall(this, forall);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:511 visit_test_binder_exists
  visit_test_binder_exists(exists: TestBinderExists): R {
    return walk_test_binder_exists(this, exists);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:514 visit_test_binder_constraint
  visit_test_binder_constraint(constraint: TestBinderConstraint): R {
    return walk_test_binder_constraint(this, constraint);
  }
  // rustc: compiler/rustc_hir/src/intravisit.rs:520 visit_test_binder_bound_type_constraint
  visit_test_binder_bound_type_constraint(bound_type: TestBinderBoundTypeConstraint): R {
    return walk_test_binder_bound_type_constraint(this, bound_type);
  }

  /// Named `visit_ty_unambig` instead of `visit_unambig_ty` to aid in discovery
  /// by IDes when `v.visit_ty` is written.
  ///
  /// This method cannot be overridden.
  // PORT: `final fn`: TS has no final methods; implementors must not override it (nor the next).
  // rustc: compiler/rustc_hir/src/intravisit.rs:531 visit_ty_unambig
  visit_ty_unambig(t: Ty): R {
    return walk_unambig_ty(this, t);
  }

  /// Named `visit_const_arg_unambig` instead of `visit_unambig_const_arg` to aid in
  /// discovery by IDes when `v.visit_const_arg` is written.
  ///
  /// This method cannot be overridden.
  // rustc: compiler/rustc_hir/src/intravisit.rs:539 visit_const_arg_unambig
  visit_const_arg_unambig(c: ConstArg): R {
    return walk_unambig_const_arg(this, c);
  }
}
// PORT: `type Result: VisitorResult = ()` and `type NestedFilter = IgnoreNested` defaults.
(Visitor.prototype as Visitor<undefined>).Result = VisitorResult.unit;
Visitor.prototype.NestedFilter = IgnoreNested;

// rustc: compiler/rustc_hir/src/intravisit.rs:544 walk_param
export function walk_param<R>(visitor: Visitor<R>, param: Param): R {
  const { hir_id, pat /* ty_span: _, span: _ */ } = param;
  let r: R | undefined;
  if ((r = try_visit(visitor.Result, visitor.visit_id(hir_id))) !== undefined) return r;
  return visitor.visit_pat(pat);
}

// rustc: compiler/rustc_hir/src/intravisit.rs:550 walk_item
export function walk_item<R>(visitor: Visitor<R>, item: Item): R {
  const { kind /* owner_id: _, span: _, vis_span: _, eii: _ */ } = item;
  let r: R | undefined;
  if ((r = try_visit(visitor.Result, visitor.visit_id(item.hir_id()))) !== undefined) return r;
  switch (kind.$) {
    case "ExternCrate": {
      const orig_name = kind._0;
      const ident = kind._1;
      if (orig_name !== undefined) {
        if ((r = try_visit(visitor.Result, visitor.visit_name(orig_name))) !== undefined) return r;
      }
      if ((r = try_visit(visitor.Result, visitor.visit_ident(ident))) !== undefined) return r;
      break;
    }
    case "Use": {
      const tree = kind._0;
      if ((r = try_visit(visitor.Result, visitor.visit_use(tree, item.hir_id(), item.owner_id.def_id))) !== undefined) return r;
      break;
    }
    case "Static": {
      const ident = kind._1;
      const typ = kind._2;
      const body = kind._3;
      if ((r = try_visit(visitor.Result, visitor.visit_ident(ident))) !== undefined) return r;
      if ((r = try_visit(visitor.Result, visitor.visit_ty_unambig(typ))) !== undefined) return r;
      if ((r = try_visit(visitor.Result, visitor.visit_nested_body(body))) !== undefined) return r;
      break;
    }
    case "Const": {
      const ident = kind._0;
      const generics = kind._1;
      const typ = kind._2;
      const rhs = kind._3;
      if ((r = try_visit(visitor.Result, visitor.visit_ident(ident))) !== undefined) return r;
      if ((r = try_visit(visitor.Result, visitor.visit_generics(generics))) !== undefined) return r;
      if ((r = try_visit(visitor.Result, visitor.visit_ty_unambig(typ))) !== undefined) return r;
      if ((r = try_visit(visitor.Result, visitor.visit_const_item_rhs(rhs))) !== undefined) return r;
      break;
    }
    case "Fn": {
      const { ident, sig, generics, body: body_id } = kind;
      if ((r = try_visit(visitor.Result, visitor.visit_ident(ident))) !== undefined) return r;
      if (
        (r = try_visit(
          visitor.Result,
          visitor.visit_fn({ $: "ItemFn", _0: ident, _1: generics, _2: sig.header }, sig.decl, body_id, item.span, item.owner_id.def_id),
        )) !== undefined
      )
        return r;
      break;
    }
    case "Macro": {
      const ident = kind._0;
      if ((r = try_visit(visitor.Result, visitor.visit_ident(ident))) !== undefined) return r;
      break;
    }
    case "Mod": {
      const ident = kind._0;
      const module = kind._1;
      if ((r = try_visit(visitor.Result, visitor.visit_ident(ident))) !== undefined) return r;
      if ((r = try_visit(visitor.Result, visitor.visit_mod(module, item.span, LocalModId.new_unchecked(item.owner_id.def_id)))) !== undefined)
        return r;
      break;
    }
    case "ForeignMod": {
      const { items } = kind; // abi: _
      for (const i of items) {
        if ((r = try_visit(visitor.Result, visitor.visit_foreign_item_ref(i))) !== undefined) return r;
      }
      break;
    }
    case "GlobalAsm": {
      const { fake_body } = kind; // asm: _
      // Visit the fake body, which contains the asm statement.
      // Therefore we should not visit the asm statement again
      // outside of the body, or some visitors won't have their
      // typeck results set correctly.
      if ((r = try_visit(visitor.Result, visitor.visit_nested_body(fake_body))) !== undefined) return r;
      break;
    }
    case "TyAlias": {
      const ident = kind._0;
      const generics = kind._1;
      const ty = kind._2;
      if ((r = try_visit(visitor.Result, visitor.visit_ident(ident))) !== undefined) return r;
      if ((r = try_visit(visitor.Result, visitor.visit_generics(generics))) !== undefined) return r;
      if ((r = try_visit(visitor.Result, visitor.visit_ty_unambig(ty))) !== undefined) return r;
      break;
    }
    case "Enum": {
      const ident = kind._0;
      const generics = kind._1;
      const enum_definition = kind._2;
      if ((r = try_visit(visitor.Result, visitor.visit_ident(ident))) !== undefined) return r;
      if ((r = try_visit(visitor.Result, visitor.visit_generics(generics))) !== undefined) return r;
      if ((r = try_visit(visitor.Result, visitor.visit_enum_def(enum_definition))) !== undefined) return r;
      break;
    }
    case "Impl": {
      const { generics, of_trait, self_ty, items /* constness: _ */ } = kind._0;
      if ((r = try_visit(visitor.Result, visitor.visit_generics(generics))) !== undefined) return r;
      if (of_trait !== undefined) {
        const { trait_ref /* safety: _, polarity: _, defaultness: _, defaultness_span: _ */ } = of_trait;
        if ((r = try_visit(visitor.Result, visitor.visit_trait_ref(trait_ref))) !== undefined) return r;
      }
      if ((r = try_visit(visitor.Result, visitor.visit_ty_unambig(self_ty))) !== undefined) return r;
      for (const i of items) {
        if ((r = try_visit(visitor.Result, visitor.visit_impl_item_ref(i))) !== undefined) return r;
      }
      break;
    }
    case "Struct":
    case "Union": {
      const ident = kind._0;
      const generics = kind._1;
      const struct_definition = kind._2;
      if ((r = try_visit(visitor.Result, visitor.visit_ident(ident))) !== undefined) return r;
      if ((r = try_visit(visitor.Result, visitor.visit_generics(generics))) !== undefined) return r;
      if ((r = try_visit(visitor.Result, visitor.visit_variant_data(struct_definition))) !== undefined) return r;
      break;
    }
    case "Trait": {
      // constness: _, is_auto: _, safety: _
      const { impl_restriction, ident, generics, bounds, items: trait_item_refs } = kind;
      if (impl_restriction.kind.$ === "Restricted") {
        const path = impl_restriction.kind._0;
        for (const s of path.segments) {
          if ((r = try_visit(visitor.Result, visitor.visit_path_segment(s))) !== undefined) return r;
        }
      }
      if ((r = try_visit(visitor.Result, visitor.visit_ident(ident))) !== undefined) return r;
      if ((r = try_visit(visitor.Result, visitor.visit_generics(generics))) !== undefined) return r;
      for (const b of bounds) {
        if ((r = try_visit(visitor.Result, visitor.visit_param_bound(b))) !== undefined) return r;
      }
      for (const t of trait_item_refs) {
        if ((r = try_visit(visitor.Result, visitor.visit_trait_item_ref(t))) !== undefined) return r;
      }
      break;
    }
    case "TraitAlias": {
      const ident = kind._1;
      const generics = kind._2;
      const bounds = kind._3;
      if ((r = try_visit(visitor.Result, visitor.visit_ident(ident))) !== undefined) return r;
      if ((r = try_visit(visitor.Result, visitor.visit_generics(generics))) !== undefined) return r;
      for (const b of bounds) {
        if ((r = try_visit(visitor.Result, visitor.visit_param_bound(b))) !== undefined) return r;
      }
      break;
    }
    case "TestBinderConstraints": {
      const { generics, body } = kind;
      if ((r = try_visit(visitor.Result, visitor.visit_generics(generics))) !== undefined) return r;
      if ((r = try_visit(visitor.Result, visitor.visit_test_binder_body(body))) !== undefined) return r;
      break;
    }
  }
  return visitor.Result.output();
}

// rustc: compiler/rustc_hir/src/intravisit.rs:665 walk_body
export function walk_body<R>(visitor: Visitor<R>, body: Body): R {
  const { params, value } = body;
  let r: R | undefined;
  for (const p of params) {
    if ((r = try_visit(visitor.Result, visitor.visit_param(p))) !== undefined) return r;
  }
  return visitor.visit_expr(value);
}

// rustc: compiler/rustc_hir/src/intravisit.rs:671 walk_ident
export function walk_ident<R>(visitor: Visitor<R>, ident: Ident): R {
  return visitor.visit_name(ident.name);
}

// rustc: compiler/rustc_hir/src/intravisit.rs:675 walk_mod
export function walk_mod<R>(visitor: Visitor<R>, module: Mod): R {
  const { item_ids } = module; // spans: _
  let r: R | undefined;
  for (const id of item_ids) {
    if ((r = try_visit(visitor.Result, visitor.visit_nested_item(id))) !== undefined) return r;
  }
  return visitor.Result.output();
}

// rustc: compiler/rustc_hir/src/intravisit.rs:681 walk_foreign_item
export function walk_foreign_item<R>(visitor: Visitor<R>, foreign_item: ForeignItem): R {
  const { ident, kind /* owner_id: _, span: _, vis_span: _ */ } = foreign_item;
  let r: R | undefined;
  if ((r = try_visit(visitor.Result, visitor.visit_id(foreign_item.hir_id()))) !== undefined) return r;
  if ((r = try_visit(visitor.Result, visitor.visit_ident(ident))) !== undefined) return r;

  switch (kind.$) {
    case "Fn": {
      const sig = kind._0;
      const param_idents = kind._1;
      const generics = kind._2;
      if ((r = try_visit(visitor.Result, visitor.visit_generics(generics))) !== undefined) return r;
      if ((r = try_visit(visitor.Result, visitor.visit_fn_decl(sig.decl))) !== undefined) return r;
      for (const ident of param_idents) {
        if (ident !== undefined) {
          if ((r = try_visit(visitor.Result, visitor.visit_ident(ident))) !== undefined) return r;
        }
      }
      break;
    }
    case "Static": {
      const typ = kind._0;
      if ((r = try_visit(visitor.Result, visitor.visit_ty_unambig(typ))) !== undefined) return r;
      break;
    }
    case "Type":
      break;
  }
  return visitor.Result.output();
}

// rustc: compiler/rustc_hir/src/intravisit.rs:705 walk_local
export function walk_local<R>(visitor: Visitor<R>, local: LetStmt): R {
  // Intentionally visiting the expr first - the initialization expr
  // dominates the local's definition.
  const { pat, ty, init, els, hir_id /* super_: _, span: _, source: _ */ } = local;
  let r: R | undefined;
  if (init !== undefined) {
    if ((r = try_visit(visitor.Result, visitor.visit_expr(init))) !== undefined) return r;
  }
  if ((r = try_visit(visitor.Result, visitor.visit_id(hir_id))) !== undefined) return r;
  if ((r = try_visit(visitor.Result, visitor.visit_pat(pat))) !== undefined) return r;
  if (els !== undefined) {
    if ((r = try_visit(visitor.Result, visitor.visit_block(els))) !== undefined) return r;
  }
  if (ty !== undefined) {
    if ((r = try_visit(visitor.Result, visitor.visit_ty_unambig(ty))) !== undefined) return r;
  }
  return visitor.Result.output();
}

// rustc: compiler/rustc_hir/src/intravisit.rs:717 walk_block
export function walk_block<R>(visitor: Visitor<R>, block: Block): R {
  const { stmts, expr, hir_id /* rules: _, span: _, targeted_by_break: _ */ } = block;
  let r: R | undefined;
  if ((r = try_visit(visitor.Result, visitor.visit_id(hir_id))) !== undefined) return r;
  for (const s of stmts) {
    if ((r = try_visit(visitor.Result, visitor.visit_stmt(s))) !== undefined) return r;
  }
  if (expr !== undefined) {
    if ((r = try_visit(visitor.Result, visitor.visit_expr(expr))) !== undefined) return r;
  }
  return visitor.Result.output();
}

// rustc: compiler/rustc_hir/src/intravisit.rs:725 walk_stmt
export function walk_stmt<R>(visitor: Visitor<R>, statement: Stmt): R {
  const { kind, hir_id } = statement; // span: _
  let r: R | undefined;
  if ((r = try_visit(visitor.Result, visitor.visit_id(hir_id))) !== undefined) return r;
  switch (kind.$) {
    case "Let":
      return visitor.visit_local(kind._0);
    case "Item":
      return visitor.visit_nested_item(kind._0);
    case "Expr":
    case "Semi":
      return visitor.visit_expr(kind._0);
  }
}

// rustc: compiler/rustc_hir/src/intravisit.rs:737 walk_arm
export function walk_arm<R>(visitor: Visitor<R>, arm: Arm): R {
  const { hir_id, pat, guard, body } = arm; // span: _
  let r: R | undefined;
  if ((r = try_visit(visitor.Result, visitor.visit_id(hir_id))) !== undefined) return r;
  if ((r = try_visit(visitor.Result, visitor.visit_pat(pat))) !== undefined) return r;
  if (guard !== undefined) {
    if ((r = try_visit(visitor.Result, visitor.visit_expr(guard))) !== undefined) return r;
  }
  return visitor.visit_expr(body);
}

// rustc: compiler/rustc_hir/src/intravisit.rs:745 walk_ty_pat
export function walk_ty_pat<R>(visitor: Visitor<R>, pattern: TyPat): R {
  const { kind, hir_id } = pattern; // span: _
  let r: R | undefined;
  if ((r = try_visit(visitor.Result, visitor.visit_id(hir_id))) !== undefined) return r;
  switch (kind.$) {
    case "Range": {
      const lower_bound = kind._0;
      const upper_bound = kind._1;
      if ((r = try_visit(visitor.Result, visitor.visit_const_arg_unambig(lower_bound))) !== undefined) return r;
      if ((r = try_visit(visitor.Result, visitor.visit_const_arg_unambig(upper_bound))) !== undefined) return r;
      break;
    }
    case "Or": {
      for (const p of kind._0) {
        if ((r = try_visit(visitor.Result, visitor.visit_pattern_type_pattern(p))) !== undefined) return r;
      }
      break;
    }
    case "NotNull":
    case "Err":
      break;
  }
  return visitor.Result.output();
}

// rustc: compiler/rustc_hir/src/intravisit.rs:759 walk_pat
export function walk_pat<R>(visitor: Visitor<R>, pattern: Pat): R {
  const { hir_id, kind, span } = pattern; // default_binding_modes: _
  let r: R | undefined;
  if ((r = try_visit(visitor.Result, visitor.visit_id(hir_id))) !== undefined) return r;
  switch (kind.$) {
    case "TupleStruct": {
      const qpath = kind._0;
      const children = kind._1;
      if ((r = try_visit(visitor.Result, visitor.visit_qpath(qpath, hir_id, span))) !== undefined) return r;
      for (const p of children) {
        if ((r = try_visit(visitor.Result, visitor.visit_pat(p))) !== undefined) return r;
      }
      break;
    }
    case "Struct": {
      const qpath = kind._0;
      const fields = kind._1;
      if ((r = try_visit(visitor.Result, visitor.visit_qpath(qpath, hir_id, span))) !== undefined) return r;
      for (const f of fields) {
        if ((r = try_visit(visitor.Result, visitor.visit_pat_field(f))) !== undefined) return r;
      }
      break;
    }
    case "Or": {
      for (const p of kind._0) {
        if ((r = try_visit(visitor.Result, visitor.visit_pat(p))) !== undefined) return r;
      }
      break;
    }
    case "Tuple": {
      const tuple_elements = kind._0;
      for (const p of tuple_elements) {
        if ((r = try_visit(visitor.Result, visitor.visit_pat(p))) !== undefined) return r;
      }
      break;
    }
    case "Deref":
    case "Ref": {
      const subpattern = kind._0;
      if ((r = try_visit(visitor.Result, visitor.visit_pat(subpattern))) !== undefined) return r;
      break;
    }
    case "Binding": {
      const ident = kind._2;
      const optional_subpattern = kind._3;
      if ((r = try_visit(visitor.Result, visitor.visit_ident(ident))) !== undefined) return r;
      if (optional_subpattern !== undefined) {
        if ((r = try_visit(visitor.Result, visitor.visit_pat(optional_subpattern))) !== undefined) return r;
      }
      break;
    }
    case "Expr": {
      const expression = kind._0;
      if ((r = try_visit(visitor.Result, visitor.visit_pat_expr(expression))) !== undefined) return r;
      break;
    }
    case "Range": {
      const lower_bound = kind._0;
      const upper_bound = kind._1;
      if (lower_bound !== undefined) {
        if ((r = try_visit(visitor.Result, visitor.visit_pat_expr(lower_bound))) !== undefined) return r;
      }
      if (upper_bound !== undefined) {
        if ((r = try_visit(visitor.Result, visitor.visit_pat_expr(upper_bound))) !== undefined) return r;
      }
      break;
    }
    case "Missing":
    case "Never":
    case "Wild":
    case "Err":
      break;
    case "Slice": {
      const prepatterns = kind._0;
      const slice_pattern = kind._1;
      const postpatterns = kind._2;
      for (const p of prepatterns) {
        if ((r = try_visit(visitor.Result, visitor.visit_pat(p))) !== undefined) return r;
      }
      if (slice_pattern !== undefined) {
        if ((r = try_visit(visitor.Result, visitor.visit_pat(slice_pattern))) !== undefined) return r;
      }
      for (const p of postpatterns) {
        if ((r = try_visit(visitor.Result, visitor.visit_pat(p))) !== undefined) return r;
      }
      break;
    }
    case "Guard": {
      const subpat = kind._0;
      const condition = kind._1;
      if ((r = try_visit(visitor.Result, visitor.visit_pat(subpat))) !== undefined) return r;
      if ((r = try_visit(visitor.Result, visitor.visit_expr(condition))) !== undefined) return r;
      break;
    }
  }
  return visitor.Result.output();
}

// rustc: compiler/rustc_hir/src/intravisit.rs:801 walk_pat_field
export function walk_pat_field<R>(visitor: Visitor<R>, field: PatField): R {
  const { hir_id, ident, pat } = field; // is_shorthand: _, span: _
  let r: R | undefined;
  if ((r = try_visit(visitor.Result, visitor.visit_id(hir_id))) !== undefined) return r;
  if ((r = try_visit(visitor.Result, visitor.visit_ident(ident))) !== undefined) return r;
  return visitor.visit_pat(pat);
}

// rustc: compiler/rustc_hir/src/intravisit.rs:808 walk_pat_expr
export function walk_pat_expr<R>(visitor: Visitor<R>, expr: PatExpr): R {
  const { hir_id, span, kind } = expr;
  let r: R | undefined;
  if ((r = try_visit(visitor.Result, visitor.visit_id(hir_id))) !== undefined) return r;
  switch (kind.$) {
    case "Lit":
      return visitor.visit_lit(hir_id, kind.lit, kind.negated);
    case "Path":
      return visitor.visit_qpath(kind._0, hir_id, span);
  }
}

// rustc: compiler/rustc_hir/src/intravisit.rs:817 walk_anon_const
export function walk_anon_const<R>(visitor: Visitor<R>, constant: AnonConst): R {
  const { hir_id, body } = constant; // def_id: _, span: _
  let r: R | undefined;
  if ((r = try_visit(visitor.Result, visitor.visit_id(hir_id))) !== undefined) return r;
  return visitor.visit_nested_body(body);
}

// rustc: compiler/rustc_hir/src/intravisit.rs:823 walk_inline_const
export function walk_inline_const<R>(visitor: Visitor<R>, constant: ConstBlock): R {
  const { hir_id, body } = constant; // def_id: _
  let r: R | undefined;
  if ((r = try_visit(visitor.Result, visitor.visit_id(hir_id))) !== undefined) return r;
  return visitor.visit_nested_body(body);
}

// rustc: compiler/rustc_hir/src/intravisit.rs:832 walk_expr
export function walk_expr<R>(visitor: Visitor<R>, expression: Expr): R {
  const { hir_id, kind, span } = expression;
  let r: R | undefined;
  if ((r = try_visit(visitor.Result, visitor.visit_id(hir_id))) !== undefined) return r;
  switch (kind.$) {
    case "Array": {
      for (const e of kind._0) {
        if ((r = try_visit(visitor.Result, visitor.visit_expr(e))) !== undefined) return r;
      }
      break;
    }
    case "ConstBlock": {
      if ((r = try_visit(visitor.Result, visitor.visit_inline_const(kind._0))) !== undefined) return r;
      break;
    }
    case "Repeat": {
      const element = kind._0;
      const count = kind._1;
      if ((r = try_visit(visitor.Result, visitor.visit_expr(element))) !== undefined) return r;
      if ((r = try_visit(visitor.Result, visitor.visit_const_arg_unambig(count))) !== undefined) return r;
      break;
    }
    case "Struct": {
      const qpath = kind._0;
      const fields = kind._1;
      const optional_base = kind._2;
      if ((r = try_visit(visitor.Result, visitor.visit_qpath(qpath, hir_id, span))) !== undefined) return r;
      for (const f of fields) {
        if ((r = try_visit(visitor.Result, visitor.visit_expr_field(f))) !== undefined) return r;
      }
      switch (optional_base.$) {
        case "Base":
          if ((r = try_visit(visitor.Result, visitor.visit_expr(optional_base._0))) !== undefined) return r;
          break;
        case "None":
        case "NoneWithError":
        case "DefaultFields":
          break;
      }
      break;
    }
    case "Tup": {
      for (const e of kind._0) {
        if ((r = try_visit(visitor.Result, visitor.visit_expr(e))) !== undefined) return r;
      }
      break;
    }
    case "Call": {
      const callee_expression = kind._0;
      const args = kind._1;
      if ((r = try_visit(visitor.Result, visitor.visit_expr(callee_expression))) !== undefined) return r;
      for (const e of args) {
        if ((r = try_visit(visitor.Result, visitor.visit_expr(e))) !== undefined) return r;
      }
      break;
    }
    case "MethodCall": {
      const segment = kind._0;
      const receiver = kind._1;
      const args = kind._2;
      if ((r = try_visit(visitor.Result, visitor.visit_path_segment(segment))) !== undefined) return r;
      if ((r = try_visit(visitor.Result, visitor.visit_expr(receiver))) !== undefined) return r;
      for (const e of args) {
        if ((r = try_visit(visitor.Result, visitor.visit_expr(e))) !== undefined) return r;
      }
      break;
    }
    case "Use": {
      if ((r = try_visit(visitor.Result, visitor.visit_expr(kind._0))) !== undefined) return r;
      break;
    }
    case "Binary": {
      const left_expression = kind._1;
      const right_expression = kind._2;
      if ((r = try_visit(visitor.Result, visitor.visit_expr(left_expression))) !== undefined) return r;
      if ((r = try_visit(visitor.Result, visitor.visit_expr(right_expression))) !== undefined) return r;
      break;
    }
    case "AddrOf":
    case "Unary": {
      const subexpression = kind.$ === "AddrOf" ? kind._2 : kind._1;
      if ((r = try_visit(visitor.Result, visitor.visit_expr(subexpression))) !== undefined) return r;
      break;
    }
    case "Cast":
    case "Type": {
      const subexpression = kind._0;
      const typ = kind._1;
      if ((r = try_visit(visitor.Result, visitor.visit_expr(subexpression))) !== undefined) return r;
      if ((r = try_visit(visitor.Result, visitor.visit_ty_unambig(typ))) !== undefined) return r;
      break;
    }
    case "DropTemps": {
      if ((r = try_visit(visitor.Result, visitor.visit_expr(kind._0))) !== undefined) return r;
      break;
    }
    case "Let": {
      const { pat, ty, init } = kind._0; // span: _, recovered: _
      // match the visit order in walk_local
      if ((r = try_visit(visitor.Result, visitor.visit_expr(init))) !== undefined) return r;
      if ((r = try_visit(visitor.Result, visitor.visit_pat(pat))) !== undefined) return r;
      if (ty !== undefined) {
        if ((r = try_visit(visitor.Result, visitor.visit_ty_unambig(ty))) !== undefined) return r;
      }
      break;
    }
    case "If": {
      const cond = kind._0;
      const then = kind._1;
      const else_opt = kind._2;
      if ((r = try_visit(visitor.Result, visitor.visit_expr(cond))) !== undefined) return r;
      if ((r = try_visit(visitor.Result, visitor.visit_expr(then))) !== undefined) return r;
      if (else_opt !== undefined) {
        if ((r = try_visit(visitor.Result, visitor.visit_expr(else_opt))) !== undefined) return r;
      }
      break;
    }
    case "Loop": {
      const block = kind._0;
      const opt_label = kind._1;
      if (opt_label !== undefined) {
        if ((r = try_visit(visitor.Result, visitor.visit_label(opt_label))) !== undefined) return r;
      }
      if ((r = try_visit(visitor.Result, visitor.visit_block(block))) !== undefined) return r;
      break;
    }
    case "Match": {
      const subexpression = kind._0;
      const arms = kind._1;
      if ((r = try_visit(visitor.Result, visitor.visit_expr(subexpression))) !== undefined) return r;
      for (const a of arms) {
        if ((r = try_visit(visitor.Result, visitor.visit_arm(a))) !== undefined) return r;
      }
      break;
    }
    case "Closure": {
      // binder: _, capture_clause: _, fn_decl_span: _, fn_arg_span: _, kind: _, constness: _,
      // explicit_captures: _
      const { def_id, bound_generic_params, fn_decl, body } = kind._0;
      for (const p of bound_generic_params) {
        if ((r = try_visit(visitor.Result, visitor.visit_generic_param(p))) !== undefined) return r;
      }
      if ((r = try_visit(visitor.Result, visitor.visit_fn(FnKind.Closure, fn_decl, body, span, def_id))) !== undefined) return r;
      break;
    }
    case "Block": {
      const block = kind._0;
      const opt_label = kind._1;
      if (opt_label !== undefined) {
        if ((r = try_visit(visitor.Result, visitor.visit_label(opt_label))) !== undefined) return r;
      }
      if ((r = try_visit(visitor.Result, visitor.visit_block(block))) !== undefined) return r;
      break;
    }
    case "Assign": {
      const lhs = kind._0;
      const rhs = kind._1;
      if ((r = try_visit(visitor.Result, visitor.visit_expr(rhs))) !== undefined) return r;
      if ((r = try_visit(visitor.Result, visitor.visit_expr(lhs))) !== undefined) return r;
      break;
    }
    case "AssignOp": {
      const left_expression = kind._1;
      const right_expression = kind._2;
      if ((r = try_visit(visitor.Result, visitor.visit_expr(right_expression))) !== undefined) return r;
      if ((r = try_visit(visitor.Result, visitor.visit_expr(left_expression))) !== undefined) return r;
      break;
    }
    case "Field": {
      const subexpression = kind._0;
      const ident = kind._1;
      if ((r = try_visit(visitor.Result, visitor.visit_expr(subexpression))) !== undefined) return r;
      if ((r = try_visit(visitor.Result, visitor.visit_ident(ident))) !== undefined) return r;
      break;
    }
    case "Index": {
      const main_expression = kind._0;
      const index_expression = kind._1;
      if ((r = try_visit(visitor.Result, visitor.visit_expr(main_expression))) !== undefined) return r;
      if ((r = try_visit(visitor.Result, visitor.visit_expr(index_expression))) !== undefined) return r;
      break;
    }
    case "Path": {
      if ((r = try_visit(visitor.Result, visitor.visit_qpath(kind._0, hir_id, span))) !== undefined) return r;
      break;
    }
    case "Break": {
      const destination = kind._0;
      const opt_expr = kind._1;
      if (destination.label !== undefined) {
        if ((r = try_visit(visitor.Result, visitor.visit_label(destination.label))) !== undefined) return r;
      }
      if (opt_expr !== undefined) {
        if ((r = try_visit(visitor.Result, visitor.visit_expr(opt_expr))) !== undefined) return r;
      }
      break;
    }
    case "Continue": {
      const destination = kind._0;
      if (destination.label !== undefined) {
        if ((r = try_visit(visitor.Result, visitor.visit_label(destination.label))) !== undefined) return r;
      }
      break;
    }
    case "Ret": {
      const optional_expression = kind._0;
      if (optional_expression !== undefined) {
        if ((r = try_visit(visitor.Result, visitor.visit_expr(optional_expression))) !== undefined) return r;
      }
      break;
    }
    case "Become": {
      if ((r = try_visit(visitor.Result, visitor.visit_expr(kind._0))) !== undefined) return r;
      break;
    }
    case "InlineAsm": {
      if ((r = try_visit(visitor.Result, visitor.visit_inline_asm(kind._0, hir_id))) !== undefined) return r;
      break;
    }
    case "OffsetOf": {
      const container = kind._0;
      const fields = kind._1;
      if ((r = try_visit(visitor.Result, visitor.visit_ty_unambig(container))) !== undefined) return r;
      for (const f of fields) {
        if ((r = try_visit(visitor.Result, visitor.visit_ident(f))) !== undefined) return r;
      }
      break;
    }
    case "Yield": {
      if ((r = try_visit(visitor.Result, visitor.visit_expr(kind._0))) !== undefined) return r;
      break;
    }
    case "UnsafeBinderCast": {
      const expr = kind._1;
      const ty = kind._2;
      if ((r = try_visit(visitor.Result, visitor.visit_expr(expr))) !== undefined) return r;
      if (ty !== undefined) {
        if ((r = try_visit(visitor.Result, visitor.visit_ty_unambig(ty))) !== undefined) return r;
      }
      break;
    }
    case "Lit": {
      if ((r = try_visit(visitor.Result, visitor.visit_lit(hir_id, kind._0, false))) !== undefined) return r;
      break;
    }
    case "Err":
      break;
  }
  return visitor.Result.output();
}

// rustc: compiler/rustc_hir/src/intravisit.rs:974 walk_expr_field
export function walk_expr_field<R>(visitor: Visitor<R>, field: ExprField): R {
  const { hir_id, ident, expr } = field; // span: _, is_shorthand: _
  let r: R | undefined;
  if ((r = try_visit(visitor.Result, visitor.visit_id(hir_id))) !== undefined) return r;
  if ((r = try_visit(visitor.Result, visitor.visit_ident(ident))) !== undefined) return r;
  return visitor.visit_expr(expr);
}

// rustc: compiler/rustc_hir/src/intravisit.rs:981 walk_const_arg_expr_field
export function walk_const_arg_expr_field<R>(visitor: Visitor<R>, field: ConstArgExprField): R {
  const { hir_id, field: field_, expr } = field; // span: _
  let r: R | undefined;
  if ((r = try_visit(visitor.Result, visitor.visit_id(hir_id))) !== undefined) return r;
  if ((r = try_visit(visitor.Result, visitor.visit_ident(field_))) !== undefined) return r;
  return visitor.visit_const_arg_unambig(expr);
}

// rustc-type: compiler/rustc_hir/src/intravisit.rs:993 InferKind
/// We track whether an infer var is from a [`Ty`], [`ConstArg`], or [`GenericArg`] so that
/// HIR visitors overriding [`Visitor::visit_infer`] can determine what kind of infer is being visited
export type InferKind =
  | { readonly $: "Ty"; _0: Ty }
  | { readonly $: "Const"; _0: ConstArg }
  | { readonly $: "Ambig"; _0: InferArg };

// rustc: compiler/rustc_hir/src/intravisit.rs:999 walk_generic_arg
export function walk_generic_arg<R>(visitor: Visitor<R>, generic_arg: GenericArg): R {
  switch (generic_arg.$) {
    case "Lifetime":
      return visitor.visit_lifetime(generic_arg._0);
    case "Type":
      return visitor.visit_ty(generic_arg._0);
    case "Const":
      return visitor.visit_const_arg(generic_arg._0);
    case "Infer": {
      const inf = generic_arg._0;
      const { hir_id, span } = inf; // kind: _
      return visitor.visit_infer(hir_id, span, { $: "Ambig", _0: inf });
    }
  }
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1014 walk_unambig_ty
export function walk_unambig_ty<R>(visitor: Visitor<R>, typ: Ty): R {
  const ambig_ty = typ.try_as_ambig_ty();
  if (ambig_ty !== undefined) {
    return visitor.visit_ty(ambig_ty);
  } else {
    const { hir_id, span } = typ; // kind: _
    return visitor.visit_infer(hir_id, span, { $: "Ty", _0: typ });
  }
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1024 walk_ty
export function walk_ty<R>(visitor: Visitor<R>, typ: Ty<AmbigArg>): R {
  const { hir_id, kind } = typ; // span: _
  let r: R | undefined;
  if ((r = try_visit(visitor.Result, visitor.visit_id(hir_id))) !== undefined) return r;

  switch (kind.$) {
    case "Slice":
      if ((r = try_visit(visitor.Result, visitor.visit_ty_unambig(kind._0))) !== undefined) return r;
      break;
    case "Ptr":
      if ((r = try_visit(visitor.Result, visitor.visit_ty_unambig(kind._0))) !== undefined) return r;
      break;
    case "Ref": {
      const lifetime = kind._0;
      const ty = kind._1;
      if ((r = try_visit(visitor.Result, visitor.visit_lifetime(lifetime))) !== undefined) return r;
      if ((r = try_visit(visitor.Result, visitor.visit_ty_unambig(ty))) !== undefined) return r;
      break;
    }
    case "Never":
      break;
    case "Tup": {
      for (const t of kind._0) {
        if ((r = try_visit(visitor.Result, visitor.visit_ty_unambig(t))) !== undefined) return r;
      }
      break;
    }
    case "FnPtr": {
      const function_declaration = kind._0;
      for (const p of function_declaration.generic_params) {
        if ((r = try_visit(visitor.Result, visitor.visit_generic_param(p))) !== undefined) return r;
      }
      if ((r = try_visit(visitor.Result, visitor.visit_fn_decl(function_declaration.decl))) !== undefined) return r;
      break;
    }
    case "UnsafeBinder": {
      const unsafe_binder = kind._0;
      for (const p of unsafe_binder.generic_params) {
        if ((r = try_visit(visitor.Result, visitor.visit_generic_param(p))) !== undefined) return r;
      }
      if ((r = try_visit(visitor.Result, visitor.visit_ty_unambig(unsafe_binder.inner_ty))) !== undefined) return r;
      break;
    }
    case "Path": {
      if ((r = try_visit(visitor.Result, visitor.visit_qpath(kind._0, typ.hir_id, typ.span))) !== undefined) return r;
      break;
    }
    case "OpaqueDef": {
      if ((r = try_visit(visitor.Result, visitor.visit_opaque_ty(kind._0))) !== undefined) return r;
      break;
    }
    case "TraitAscription": {
      for (const b of kind._0) {
        if ((r = try_visit(visitor.Result, visitor.visit_param_bound(b))) !== undefined) return r;
      }
      break;
    }
    case "Array": {
      const ty = kind._0;
      const length = kind._1;
      if ((r = try_visit(visitor.Result, visitor.visit_ty_unambig(ty))) !== undefined) return r;
      if ((r = try_visit(visitor.Result, visitor.visit_const_arg_unambig(length))) !== undefined) return r;
      break;
    }
    case "TraitObject": {
      const bounds = kind._0;
      const lifetime = kind._1;
      for (const bound of bounds) {
        if ((r = try_visit(visitor.Result, visitor.visit_poly_trait_ref(bound))) !== undefined) return r;
      }
      // PORT: `&TaggedRef<Lifetime, _>` derefs to `&Lifetime`: `.pointer()`.
      if ((r = try_visit(visitor.Result, visitor.visit_lifetime(lifetime.pointer()))) !== undefined) return r;
      break;
    }
    case "InferDelegation":
    case "Err":
      break;
    case "Pat": {
      const ty = kind._0;
      const pat = kind._1;
      if ((r = try_visit(visitor.Result, visitor.visit_ty_unambig(ty))) !== undefined) return r;
      if ((r = try_visit(visitor.Result, visitor.visit_pattern_type_pattern(pat))) !== undefined) return r;
      break;
    }
    case "FieldOf": {
      const ty = kind._0;
      const { variant, field } = kind._1;
      if ((r = try_visit(visitor.Result, visitor.visit_ty_unambig(ty))) !== undefined) return r;
      if (variant !== undefined) {
        if ((r = try_visit(visitor.Result, visitor.visit_ident(variant))) !== undefined) return r;
      }
      if ((r = try_visit(visitor.Result, visitor.visit_ident(field))) !== undefined) return r;
      break;
    }
    case "View": {
      const ty = kind._0;
      const fields = kind._1;
      if ((r = try_visit(visitor.Result, visitor.visit_ty_unambig(ty))) !== undefined) return r;
      for (const field of fields) {
        if ((r = try_visit(visitor.Result, visitor.visit_ident(field))) !== undefined) return r;
      }
      break;
    }
    case "Infer":
      // PORT: `TyKind<AmbigArg>::Infer(!)` is uninhabited (no arm upstream); `kind._0` is `never`.
      return unreachable();
  }
  return visitor.Result.output();
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1086 walk_const_item_rhs
export function walk_const_item_rhs<R>(visitor: Visitor<R>, ct_rhs: ConstItemRhs): R {
  switch (ct_rhs.$) {
    case "Body":
      return visitor.visit_nested_body(ct_rhs._0);
    case "Direct":
      return visitor.visit_const_arg_unambig(ct_rhs._0);
  }
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1096 walk_unambig_const_arg
export function walk_unambig_const_arg<R>(visitor: Visitor<R>, const_arg: ConstArg): R {
  const ambig_ct = const_arg.try_as_ambig_ct();
  if (ambig_ct !== undefined) {
    return visitor.visit_const_arg(ambig_ct);
  } else {
    const { hir_id, span } = const_arg; // kind: _
    return visitor.visit_infer(hir_id, span, { $: "Const", _0: const_arg });
  }
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1109 walk_const_arg
export function walk_const_arg<R>(visitor: Visitor<R>, const_arg: ConstArg<AmbigArg>): R {
  const { hir_id, kind } = const_arg; // span: _
  let r: R | undefined;
  if ((r = try_visit(visitor.Result, visitor.visit_id(hir_id))) !== undefined) return r;
  switch (kind.$) {
    case "Tup": {
      for (const e of kind._0) {
        if ((r = try_visit(visitor.Result, visitor.visit_const_arg_unambig(e))) !== undefined) return r;
      }
      return visitor.Result.output();
    }
    case "Struct": {
      const qpath = kind._0;
      const field_exprs = kind._1;
      if ((r = try_visit(visitor.Result, visitor.visit_qpath(qpath, hir_id, QPath.span(qpath)))) !== undefined) return r;

      for (const field_expr of field_exprs) {
        if ((r = try_visit(visitor.Result, visitor.visit_const_arg_expr_field(field_expr))) !== undefined) return r;
      }

      return visitor.Result.output();
    }
    case "TupleCall": {
      const qpath = kind._0;
      const args = kind._1;
      if ((r = try_visit(visitor.Result, visitor.visit_qpath(qpath, hir_id, QPath.span(qpath)))) !== undefined) return r;
      for (const arg of args) {
        if ((r = try_visit(visitor.Result, visitor.visit_const_arg_unambig(arg))) !== undefined) return r;
      }
      return visitor.Result.output();
    }
    case "Array": {
      const array_expr = kind._0;
      for (const arg of array_expr.elems) {
        if ((r = try_visit(visitor.Result, visitor.visit_const_arg_unambig(arg))) !== undefined) return r;
      }
      return visitor.Result.output();
    }
    case "Path": {
      const qpath = kind._0;
      return visitor.visit_qpath(qpath, hir_id, QPath.span(qpath));
    }
    case "Anon":
      return visitor.visit_anon_const(kind._0);
    case "Error":
      return visitor.Result.output(); // errors and spans are not important
    case "Literal":
      return visitor.Result.output(); // FIXME(mcga)
    case "Infer":
      // PORT: `ConstArgKind<AmbigArg>::Infer(!)` is uninhabited (no arm upstream).
      return unreachable();
  }
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1149 walk_generic_param
export function walk_generic_param<R>(visitor: Visitor<R>, param: GenericParam): R {
  // def_id: _, span: _, pure_wrt_drop: _, colon_span: _, source: _
  const { hir_id, name, kind } = param;
  let r: R | undefined;
  if ((r = try_visit(visitor.Result, visitor.visit_id(hir_id))) !== undefined) return r;
  switch (name.$) {
    case "Plain":
    case "Error":
      if ((r = try_visit(visitor.Result, visitor.visit_ident(name._0))) !== undefined) return r;
      break;
    case "Fresh":
      break;
  }
  switch (kind.$) {
    case "Lifetime":
      break;
    case "Type": {
      const default_ = kind.default;
      if (default_ !== undefined) {
        if ((r = try_visit(visitor.Result, visitor.visit_ty_unambig(default_))) !== undefined) return r;
      }
      break;
    }
    case "Const": {
      const ty = kind.ty;
      const default_ = kind.default;
      if ((r = try_visit(visitor.Result, visitor.visit_ty_unambig(ty))) !== undefined) return r;
      if (default_ !== undefined) {
        if ((r = try_visit(visitor.Result, visitor.visit_const_param_default(hir_id, default_))) !== undefined) return r;
      }
      break;
    }
  }
  return visitor.Result.output();
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1183 walk_const_param_default
export function walk_const_param_default<R>(visitor: Visitor<R>, ct: ConstArg): R {
  return visitor.visit_const_arg_unambig(ct);
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1190 walk_generics
export function walk_generics<R>(visitor: Visitor<R>, generics: Generics): R {
  // has_where_clause_predicates: _, where_clause_span: _, span: _
  const { params, predicates } = generics;
  let r: R | undefined;
  for (const p of params) {
    if ((r = try_visit(visitor.Result, visitor.visit_generic_param(p))) !== undefined) return r;
  }
  for (const p of predicates) {
    if ((r = try_visit(visitor.Result, visitor.visit_where_predicate(p))) !== undefined) return r;
  }
  return visitor.Result.output();
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1203 walk_where_predicate
export function walk_where_predicate<R>(visitor: Visitor<R>, predicate: WherePredicate): R {
  const { hir_id, kind } = predicate; // span: _
  let r: R | undefined;
  if ((r = try_visit(visitor.Result, visitor.visit_id(hir_id))) !== undefined) return r;
  switch (kind.$) {
    case "BoundPredicate": {
      const { bounded_ty, bounds, bound_generic_params } = kind._0; // origin: _
      if ((r = try_visit(visitor.Result, visitor.visit_ty_unambig(bounded_ty))) !== undefined) return r;
      for (const b of bounds) {
        if ((r = try_visit(visitor.Result, visitor.visit_param_bound(b))) !== undefined) return r;
      }
      for (const p of bound_generic_params) {
        if ((r = try_visit(visitor.Result, visitor.visit_generic_param(p))) !== undefined) return r;
      }
      break;
    }
    case "RegionPredicate": {
      const { lifetime, bounds } = kind._0; // in_where_clause: _
      if ((r = try_visit(visitor.Result, visitor.visit_lifetime(lifetime))) !== undefined) return r;
      for (const b of bounds) {
        if ((r = try_visit(visitor.Result, visitor.visit_param_bound(b))) !== undefined) return r;
      }
      break;
    }
  }
  return visitor.Result.output();
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1232 walk_fn_decl
export function walk_fn_decl<R>(visitor: Visitor<R>, function_declaration: FnDecl): R {
  const { inputs, output } = function_declaration; // fn_decl_kind: _
  let r: R | undefined;
  for (const t of inputs) {
    if ((r = try_visit(visitor.Result, visitor.visit_ty_unambig(t))) !== undefined) return r;
  }
  return visitor.visit_fn_ret_ty(output);
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1241 walk_fn_ret_ty
export function walk_fn_ret_ty<R>(visitor: Visitor<R>, ret_ty: FnRetTy): R {
  let r: R | undefined;
  if (ret_ty.$ === "Return") {
    const output_ty = ret_ty._0;
    if ((r = try_visit(visitor.Result, visitor.visit_ty_unambig(output_ty))) !== undefined) return r;
  }
  return visitor.Result.output();
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1248 walk_fn
export function walk_fn<R>(visitor: Visitor<R>, function_kind: FnKind, function_declaration: FnDecl, body_id: BodyId, _: LocalDefId): R {
  let r: R | undefined;
  if ((r = try_visit(visitor.Result, visitor.visit_fn_decl(function_declaration))) !== undefined) return r;
  if ((r = try_visit(visitor.Result, walk_fn_kind(visitor, function_kind))) !== undefined) return r;
  return visitor.visit_nested_body(body_id);
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1260 walk_fn_kind
export function walk_fn_kind<R>(visitor: Visitor<R>, function_kind: FnKind): R {
  let r: R | undefined;
  switch (function_kind.$) {
    case "ItemFn": {
      const generics = function_kind._1;
      if ((r = try_visit(visitor.Result, visitor.visit_generics(generics))) !== undefined) return r;
      break;
    }
    case "Closure":
    case "Method":
      break;
  }
  return visitor.Result.output();
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1270 walk_use
export function walk_use<R>(visitor: Visitor<R>, tree: UseTree, hir_id: HirId): R {
  // PORT: upstream ignores this result (no `try_visit!`).
  visitor.visit_id(hir_id);
  const { prefix, kind } = tree;
  const { segments, res, span } = prefix;
  let r: R | undefined;
  for (const res_ of res.present_items()) {
    if ((r = try_visit(visitor.Result, visitor.visit_path(new Path(span, res_, segments), hir_id))) !== undefined) return r;
  }

  switch (kind.$) {
    case "Single":
      if ((r = try_visit(visitor.Result, visitor.visit_ident(kind._0))) !== undefined) return r;
      break;
    case "Glob":
      break;
    case "Nested": {
      for (const [tree_, id, def_id] of kind.items) {
        if ((r = try_visit(visitor.Result, visitor.visit_use(tree_, id, def_id))) !== undefined) return r;
      }
      break;
    }
  }
  return visitor.Result.output();
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1294 walk_trait_item
export function walk_trait_item<R>(visitor: Visitor<R>, trait_item: TraitItem): R {
  const { ident, generics, defaultness, kind, span } = trait_item; // owner_id: _
  const hir_id = trait_item.hir_id();
  let r: R | undefined;
  if ((r = try_visit(visitor.Result, visitor.visit_ident(ident))) !== undefined) return r;
  if ((r = try_visit(visitor.Result, visitor.visit_generics(generics))) !== undefined) return r;
  if ((r = try_visit(visitor.Result, visitor.visit_defaultness(defaultness))) !== undefined) return r;
  if ((r = try_visit(visitor.Result, visitor.visit_id(hir_id))) !== undefined) return r;
  switch (kind.$) {
    case "Const": {
      const ty = kind._0;
      const default_ = kind._1;
      if ((r = try_visit(visitor.Result, visitor.visit_ty_unambig(ty))) !== undefined) return r;
      if (default_ !== undefined) {
        if ((r = try_visit(visitor.Result, visitor.visit_const_item_rhs(default_))) !== undefined) return r;
      }
      break;
    }
    case "Fn": {
      const sig = kind._0;
      const trait_fn = kind._1;
      if (trait_fn.$ === "Required") {
        const param_idents = trait_fn._0;
        if ((r = try_visit(visitor.Result, visitor.visit_fn_decl(sig.decl))) !== undefined) return r;
        for (const ident of param_idents) {
          if (ident !== undefined) {
            if ((r = try_visit(visitor.Result, visitor.visit_ident(ident))) !== undefined) return r;
          }
        }
      } else {
        const body_id = trait_fn._0;
        if (
          (r = try_visit(
            visitor.Result,
            visitor.visit_fn({ $: "Method", _0: ident, _1: sig }, sig.decl, body_id, span, trait_item.owner_id.def_id),
          )) !== undefined
        )
          return r;
      }
      break;
    }
    case "Type": {
      const bounds = kind._0;
      const default_ = kind._1;
      for (const b of bounds) {
        if ((r = try_visit(visitor.Result, visitor.visit_param_bound(b))) !== undefined) return r;
      }
      if (default_ !== undefined) {
        if ((r = try_visit(visitor.Result, visitor.visit_ty_unambig(default_))) !== undefined) return r;
      }
      break;
    }
  }
  return visitor.Result.output();
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1332 walk_trait_item_ref
export function walk_trait_item_ref<R>(visitor: Visitor<R>, id: TraitItemId): R {
  return visitor.visit_nested_trait_item(id);
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1336 walk_impl_item
export function walk_impl_item<R>(visitor: Visitor<R>, impl_item: ImplItem): R {
  const { ident, generics, impl_kind, kind } = impl_item; // owner_id: _, span: _

  let r: R | undefined;
  if ((r = try_visit(visitor.Result, visitor.visit_ident(ident))) !== undefined) return r;
  if ((r = try_visit(visitor.Result, visitor.visit_generics(generics))) !== undefined) return r;
  if ((r = try_visit(visitor.Result, visitor.visit_id(impl_item.hir_id()))) !== undefined) return r;
  switch (impl_kind.$) {
    case "Inherent": // vis_span: _
      break;
    case "Trait": {
      const { defaultness } = impl_kind; // trait_item_def_id: _
      if ((r = try_visit(visitor.Result, visitor.visit_defaultness(defaultness))) !== undefined) return r;
      break;
    }
  }
  switch (kind.$) {
    case "Const": {
      const ty = kind._0;
      const rhs = kind._1;
      if ((r = try_visit(visitor.Result, visitor.visit_ty_unambig(ty))) !== undefined) return r;
      return visitor.visit_const_item_rhs(rhs);
    }
    case "Fn": {
      const sig = kind._0;
      const body_id = kind._1;
      return visitor.visit_fn(
        { $: "Method", _0: impl_item.ident, _1: sig },
        sig.decl,
        body_id,
        impl_item.span,
        impl_item.owner_id.def_id,
      );
    }
    case "Type":
      return visitor.visit_ty_unambig(kind._0);
  }
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1368 walk_foreign_item_ref
export function walk_foreign_item_ref<R>(visitor: Visitor<R>, id: ForeignItemId): R {
  return visitor.visit_nested_foreign_item(id);
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1372 walk_impl_item_ref
export function walk_impl_item_ref<R>(visitor: Visitor<R>, id: ImplItemId): R {
  return visitor.visit_nested_impl_item(id);
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1376 walk_trait_ref
export function walk_trait_ref<R>(visitor: Visitor<R>, trait_ref: TraitRef): R {
  const { hir_ref_id, path } = trait_ref;
  let r: R | undefined;
  if ((r = try_visit(visitor.Result, visitor.visit_id(hir_ref_id))) !== undefined) return r;
  return visitor.visit_path(path, hir_ref_id);
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1385 walk_param_bound
export function walk_param_bound<R>(visitor: Visitor<R>, bound: GenericBound): R {
  switch (bound.$) {
    case "Trait":
      return visitor.visit_poly_trait_ref(bound._0);
    case "Outlives":
      return visitor.visit_lifetime(bound._0);
    case "Use": {
      let r: R | undefined;
      for (const a of bound._0) {
        if ((r = try_visit(visitor.Result, visitor.visit_precise_capturing_arg(a))) !== undefined) return r;
      }
      return visitor.Result.output();
    }
  }
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1399 walk_precise_capturing_arg
export function walk_precise_capturing_arg<R>(visitor: Visitor<R>, arg: PreciseCapturingArg): R {
  switch (arg.$) {
    case "Lifetime":
      return visitor.visit_lifetime(arg._0);
    case "Param": {
      const { hir_id, ident } = arg._0; // res: _
      let r: R | undefined;
      if ((r = try_visit(visitor.Result, visitor.visit_id(hir_id))) !== undefined) return r;
      return visitor.visit_ident(ident);
    }
  }
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1413 walk_poly_trait_ref
export function walk_poly_trait_ref<R>(visitor: Visitor<R>, trait_ref: PolyTraitRef): R {
  const { bound_generic_params, trait_ref: trait_ref_ } = trait_ref; // modifiers: _, span: _
  let r: R | undefined;
  for (const p of bound_generic_params) {
    if ((r = try_visit(visitor.Result, visitor.visit_generic_param(p))) !== undefined) return r;
  }
  return visitor.visit_trait_ref(trait_ref_);
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1422 walk_opaque_ty
export function walk_opaque_ty<R>(visitor: Visitor<R>, opaque: OpaqueTy): R {
  const { hir_id, bounds } = opaque; // def_id: _, origin: _, span: _
  let r: R | undefined;
  if ((r = try_visit(visitor.Result, visitor.visit_id(hir_id))) !== undefined) return r;
  for (const b of bounds) {
    if ((r = try_visit(visitor.Result, visitor.visit_param_bound(b))) !== undefined) return r;
  }
  return visitor.Result.output();
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1429 walk_struct_def
export function walk_struct_def<R>(visitor: Visitor<R>, struct_definition: VariantData): R {
  let r: R | undefined;
  const ctor_hir_id = VariantData.ctor_hir_id(struct_definition);
  if (ctor_hir_id !== undefined) {
    if ((r = try_visit(visitor.Result, visitor.visit_id(ctor_hir_id))) !== undefined) return r;
  }
  for (const f of VariantData.fields(struct_definition)) {
    if ((r = try_visit(visitor.Result, visitor.visit_field_def(f))) !== undefined) return r;
  }
  return visitor.Result.output();
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1438 walk_field_def
export function walk_field_def<R>(visitor: Visitor<R>, field_def: FieldDef): R {
  // span: _, vis_span: _, def_id: _, safety: _
  const { hir_id, ident, ty, default: default_, mut_restriction } = field_def;
  let r: R | undefined;
  if (mut_restriction.kind.$ === "Restricted") {
    const path = mut_restriction.kind._0;
    for (const s of path.segments) {
      if ((r = try_visit(visitor.Result, visitor.visit_path_segment(s))) !== undefined) return r;
    }
  }
  if ((r = try_visit(visitor.Result, visitor.visit_id(hir_id))) !== undefined) return r;
  if ((r = try_visit(visitor.Result, visitor.visit_ident(ident))) !== undefined) return r;
  if (default_ !== undefined) {
    if ((r = try_visit(visitor.Result, visitor.visit_anon_const(default_))) !== undefined) return r;
  }
  return visitor.visit_ty_unambig(ty);
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1461 walk_enum_def
export function walk_enum_def<R>(visitor: Visitor<R>, enum_definition: EnumDef): R {
  const { variants } = enum_definition;
  let r: R | undefined;
  for (const v of variants) {
    if ((r = try_visit(visitor.Result, visitor.visit_variant(v))) !== undefined) return r;
  }
  return visitor.Result.output();
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1470 walk_variant
export function walk_variant<R>(visitor: Visitor<R>, variant: Variant): R {
  const { ident, hir_id, data, disr_expr } = variant; // def_id: _, span: _
  let r: R | undefined;
  if ((r = try_visit(visitor.Result, visitor.visit_ident(ident))) !== undefined) return r;
  if ((r = try_visit(visitor.Result, visitor.visit_id(hir_id))) !== undefined) return r;
  if ((r = try_visit(visitor.Result, visitor.visit_variant_data(data))) !== undefined) return r;
  if (disr_expr !== undefined) {
    if ((r = try_visit(visitor.Result, visitor.visit_anon_const(disr_expr))) !== undefined) return r;
  }
  return visitor.Result.output();
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1479 walk_label
export function walk_label<R>(visitor: Visitor<R>, label: Label): R {
  const { ident } = label;
  return visitor.visit_ident(ident);
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1484 walk_inf
export function walk_inf<R>(visitor: Visitor<R>, inf: InferArg): R {
  const { hir_id } = inf; // span: _, kind: _
  return visitor.visit_id(hir_id);
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1489 walk_lifetime
export function walk_lifetime<R>(visitor: Visitor<R>, lifetime: Lifetime): R {
  const { hir_id, ident } = lifetime; // kind: _, source: _, syntax: _
  let r: R | undefined;
  if ((r = try_visit(visitor.Result, visitor.visit_id(hir_id))) !== undefined) return r;
  return visitor.visit_ident(ident);
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1495 walk_qpath
export function walk_qpath<R>(visitor: Visitor<R>, qpath: QPath, id: HirId): R {
  let r: R | undefined;
  switch (qpath.$) {
    case "Resolved": {
      const maybe_qself = qpath._0;
      const path = qpath._1;
      if (maybe_qself !== undefined) {
        if ((r = try_visit(visitor.Result, visitor.visit_ty_unambig(maybe_qself))) !== undefined) return r;
      }
      return visitor.visit_path(path, id);
    }
    case "TypeRelative": {
      const qself = qpath._0;
      const segment = qpath._1;
      if ((r = try_visit(visitor.Result, visitor.visit_ty_unambig(qself))) !== undefined) return r;
      return visitor.visit_path_segment(segment);
    }
  }
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1512 walk_path
export function walk_path<R>(visitor: Visitor<R>, path: Path): R {
  const { segments } = path; // span: _, res: _
  let r: R | undefined;
  for (const s of segments) {
    if ((r = try_visit(visitor.Result, visitor.visit_path_segment(s))) !== undefined) return r;
  }
  return visitor.Result.output();
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1518 walk_path_segment
export function walk_path_segment<R>(visitor: Visitor<R>, segment: PathSegment): R {
  // res: _, infer_args: _, delegation_child_segment: _
  const { ident, hir_id, args } = segment;
  let r: R | undefined;
  if ((r = try_visit(visitor.Result, visitor.visit_ident(ident))) !== undefined) return r;
  if ((r = try_visit(visitor.Result, visitor.visit_id(hir_id))) !== undefined) return r;
  if (args !== undefined) {
    if ((r = try_visit(visitor.Result, visitor.visit_generic_args(args))) !== undefined) return r;
  }
  return visitor.Result.output();
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1530 walk_generic_args
export function walk_generic_args<R>(visitor: Visitor<R>, generic_args: GenericArgs): R {
  const { args, constraints } = generic_args; // parenthesized: _, span_ext: _
  let r: R | undefined;
  for (const a of args) {
    if ((r = try_visit(visitor.Result, visitor.visit_generic_arg(a))) !== undefined) return r;
  }
  for (const c of constraints) {
    if ((r = try_visit(visitor.Result, visitor.visit_assoc_item_constraint(c))) !== undefined) return r;
  }
  return visitor.Result.output();
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1540 walk_assoc_item_constraint
export function walk_assoc_item_constraint<R>(visitor: Visitor<R>, constraint: AssocItemConstraint): R {
  const { hir_id, ident, gen_args } = constraint; // kind: _, span: _
  let r: R | undefined;
  if ((r = try_visit(visitor.Result, visitor.visit_id(hir_id))) !== undefined) return r;
  if ((r = try_visit(visitor.Result, visitor.visit_ident(ident))) !== undefined) return r;
  if ((r = try_visit(visitor.Result, visitor.visit_generic_args(gen_args))) !== undefined) return r;
  const kind = constraint.kind;
  switch (kind.$) {
    case "Equality": {
      const term = kind.term;
      switch (term.$) {
        case "Ty":
          if ((r = try_visit(visitor.Result, visitor.visit_ty_unambig(term._0))) !== undefined) return r;
          break;
        case "Const":
          if ((r = try_visit(visitor.Result, visitor.visit_const_arg_unambig(term._0))) !== undefined) return r;
          break;
      }
      break;
    }
    case "Bound": {
      for (const b of kind.bounds) {
        if ((r = try_visit(visitor.Result, visitor.visit_param_bound(b))) !== undefined) return r;
      }
      break;
    }
  }
  return visitor.Result.output();
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1560 walk_defaultness
export function walk_defaultness<R>(visitor: Visitor<R>, _: Defaultness): R {
  // No visitable content here: this fn exists so you can call it if
  // the right thing to do, should content be added in the future,
  // would be to walk it.
  return visitor.Result.output();
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1567 walk_inline_asm
export function walk_inline_asm<R>(visitor: Visitor<R>, asm: InlineAsm, id: HirId): R {
  let r: R | undefined;
  for (const [op, op_sp] of asm.operands) {
    switch (op.$) {
      case "In":
      case "InOut":
        if ((r = try_visit(visitor.Result, visitor.visit_expr(op.expr))) !== undefined) return r;
        break;
      case "Out":
        if (op.expr !== undefined) {
          if ((r = try_visit(visitor.Result, visitor.visit_expr(op.expr))) !== undefined) return r;
        }
        break;
      case "SplitInOut":
        if ((r = try_visit(visitor.Result, visitor.visit_expr(op.in_expr))) !== undefined) return r;
        if (op.out_expr !== undefined) {
          if ((r = try_visit(visitor.Result, visitor.visit_expr(op.out_expr))) !== undefined) return r;
        }
        break;
      case "Const":
        if ((r = try_visit(visitor.Result, visitor.visit_inline_const(op.anon_const))) !== undefined) return r;
        break;
      case "SymFn":
        if ((r = try_visit(visitor.Result, visitor.visit_expr(op.expr))) !== undefined) return r;
        break;
      case "SymStatic":
        if ((r = try_visit(visitor.Result, visitor.visit_qpath(op.path, id, op_sp))) !== undefined) return r;
        break;
      case "Label":
        if ((r = try_visit(visitor.Result, visitor.visit_block(op.block))) !== undefined) return r;
        break;
    }
  }
  return visitor.Result.output();
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1599 walk_test_binder_body
export function walk_test_binder_body<R>(visitor: Visitor<R>, body: TestBinderBody): R {
  const { foralls, exists, constraints, predicates } = body;
  let r: R | undefined;
  for (const f of foralls) {
    if ((r = try_visit(visitor.Result, visitor.visit_test_binder_forall(f))) !== undefined) return r;
  }
  for (const e of exists) {
    if ((r = try_visit(visitor.Result, visitor.visit_test_binder_exists(e))) !== undefined) return r;
  }
  if ((r = try_visit(visitor.Result, visitor.visit_test_binder_constraint(constraints))) !== undefined) return r;
  for (const p of predicates) {
    if ((r = try_visit(visitor.Result, visitor.visit_where_predicate(p))) !== undefined) return r;
  }
  return visitor.Result.output();
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1611 walk_test_binder_forall
export function walk_test_binder_forall<R>(visitor: Visitor<R>, forall: TestBinderForall): R {
  const { hir_id, generics, body, assert_on_exit } = forall; // span: _
  let r: R | undefined;
  if ((r = try_visit(visitor.Result, visitor.visit_id(hir_id))) !== undefined) return r;
  if ((r = try_visit(visitor.Result, visitor.visit_generics(generics))) !== undefined) return r;
  if ((r = try_visit(visitor.Result, visitor.visit_test_binder_body(body))) !== undefined) return r;
  if (assert_on_exit !== undefined) {
    if ((r = try_visit(visitor.Result, visitor.visit_test_binder_constraint(assert_on_exit))) !== undefined) return r;
  }
  return visitor.Result.output();
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1625 walk_test_binder_exists
export function walk_test_binder_exists<R>(visitor: Visitor<R>, exists: TestBinderExists): R {
  const { hir_id, params, body } = exists; // span: _
  let r: R | undefined;
  if ((r = try_visit(visitor.Result, visitor.visit_id(hir_id))) !== undefined) return r;
  for (const p of params) {
    if ((r = try_visit(visitor.Result, visitor.visit_generic_param(p))) !== undefined) return r;
  }
  if ((r = try_visit(visitor.Result, visitor.visit_test_binder_body(body))) !== undefined) return r;
  return visitor.Result.output();
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1636 walk_test_binder_constraint
export function walk_test_binder_constraint<R>(visitor: Visitor<R>, constraint: TestBinderConstraint): R {
  let r: R | undefined;
  switch (constraint.$) {
    case "And": {
      for (const i of constraint.items) {
        if ((r = try_visit(visitor.Result, visitor.visit_test_binder_constraint(i))) !== undefined) return r;
      }
      break;
    }
    case "Or": {
      for (const i of constraint.items) {
        if ((r = try_visit(visitor.Result, visitor.visit_test_binder_constraint(i))) !== undefined) return r;
      }
      break;
    }
    case "Ambiguity": // span: _
      break;
    case "Lifetime": {
      const { lhs, rhs } = constraint;
      if ((r = try_visit(visitor.Result, visitor.visit_lifetime(lhs))) !== undefined) return r;
      if ((r = try_visit(visitor.Result, visitor.visit_lifetime(rhs))) !== undefined) return r;
      break;
    }
    case "PlaceholderOutlives": {
      const { lhs, rhs } = constraint;
      if ((r = try_visit(visitor.Result, visitor.visit_ty_unambig(lhs))) !== undefined) return r;
      if ((r = try_visit(visitor.Result, visitor.visit_lifetime(rhs))) !== undefined) return r;
      break;
    }
    case "AliasOutlives": {
      const { bound_type_constraint } = constraint;
      if ((r = try_visit(visitor.Result, visitor.visit_test_binder_bound_type_constraint(bound_type_constraint))) !== undefined) return r;
      break;
    }
  }
  return visitor.Result.output();
}

// rustc: compiler/rustc_hir/src/intravisit.rs:1663 walk_test_binder_bound_type_constraint
export function walk_test_binder_bound_type_constraint<R>(visitor: Visitor<R>, constraint: TestBinderBoundTypeConstraint): R {
  const { hir_id, params, lhs, rhs } = constraint; // span: _
  let r: R | undefined;
  if ((r = try_visit(visitor.Result, visitor.visit_id(hir_id))) !== undefined) return r;
  for (const p of params) {
    if ((r = try_visit(visitor.Result, visitor.visit_generic_param(p))) !== undefined) return r;
  }
  if ((r = try_visit(visitor.Result, visitor.visit_ty_unambig(lhs))) !== undefined) return r;
  if ((r = try_visit(visitor.Result, visitor.visit_lifetime(rhs))) !== undefined) return r;
  return visitor.Result.output();
}
