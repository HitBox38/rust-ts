// Port of compiler/rustc_lint/src/passes.rs: the `LateLintPass` / `EarlyLintPass` traits and the macros that
// combine passes.
//
// PORT: `late_lint_methods!` / `early_lint_methods!` (callback macros over the method list) become the name
// lists `LATE_LINT_METHODS` / `EARLY_LINT_METHODS`; the macros that consume them become functions over those
// lists:
// - `declare_late_lint_pass!` / `declare_early_lint_pass!` (the traits): interfaces whose `check_*` methods are
//   optional, and `LateLintPass_provided` / `EarlyLintPass_provided` (PORTING §8), whose methods run the pass's
//   own `check_*` when it has one and otherwise the trait default (an empty body).
// - `declare_combined_late_lint_pass!` / `declare_combined_early_lint_pass!`: functions building the combined
//   pass class from `[pass type, constructor]` pairs (field order = pass order). The `check_*` methods of the
//   combined class (`expand_combined_*_lint_pass_methods!`) call every pass in order.
import type { ast } from "../rustc_ast/lib.ts";
import type { FnKind } from "../rustc_ast/visit.ts";
import type { NodeId } from "../rustc_ast/node_id.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import type { Span } from "../rustc_span/lib.ts";
import type { Ident } from "../rustc_span/symbol.ts";
import { panic } from "../std/panic.ts";
import type { EarlyContext, LateContext } from "./context.ts";

/** `macro_rules! late_lint_methods` (exported): the `check_*` methods of `LateLintPass`, in order. */
// `_post` methods are called *after* recursing into the node.
export const LATE_LINT_METHODS = [
  "check_body",
  "check_body_post",
  "check_crate",
  "check_crate_post",
  "check_mod",
  "check_foreign_item",
  "check_item",
  "check_item_post",
  "check_local",
  "check_block",
  "check_block_post",
  "check_stmt",
  "check_arm",
  "check_pat",
  "check_lit",
  "check_expr",
  "check_expr_post",
  "check_ty",
  "check_generic_param",
  "check_generics",
  "check_poly_trait_ref",
  "check_fn",
  "check_trait_item",
  "check_impl_item",
  "check_impl_item_post",
  "check_field_def",
  "check_variant",
  "check_path",
  "check_attribute",
  "check_attributes",
  "check_attributes_post",
] as const;

/// Trait for types providing lint checks.
///
/// Each `check` method checks a single syntax node, and should not
/// invoke methods recursively (unlike `Visitor`). By default they
/// do nothing.
///
// FIXME: eliminate the duplication with `Visitor`. But this also
// contains a few lint-specific methods with no equivalent in `Visitor`.
//
// PORT: the HIR types are not ported (M3); their parameters are `unknown`.
export interface LateLintPass extends LintPass {
  check_body?(cx: LateContext, a: unknown): void;
  check_body_post?(cx: LateContext, a: unknown): void;
  check_crate?(cx: LateContext): void;
  check_crate_post?(cx: LateContext): void;
  check_mod?(cx: LateContext, a: unknown, b: unknown): void;
  check_foreign_item?(cx: LateContext, a: unknown): void;
  check_item?(cx: LateContext, a: unknown): void;
  check_item_post?(cx: LateContext, a: unknown): void;
  check_local?(cx: LateContext, a: unknown): void;
  check_block?(cx: LateContext, a: unknown): void;
  check_block_post?(cx: LateContext, a: unknown): void;
  check_stmt?(cx: LateContext, a: unknown): void;
  check_arm?(cx: LateContext, a: unknown): void;
  check_pat?(cx: LateContext, a: unknown): void;
  check_lit?(cx: LateContext, hir_id: unknown, a: unknown, is_negated_pat: boolean): void;
  check_expr?(cx: LateContext, a: unknown): void;
  check_expr_post?(cx: LateContext, a: unknown): void;
  check_ty?(cx: LateContext, a: unknown): void;
  check_generic_param?(cx: LateContext, a: unknown): void;
  check_generics?(cx: LateContext, a: unknown): void;
  check_poly_trait_ref?(cx: LateContext, a: unknown): void;
  check_fn?(cx: LateContext, a: unknown, b: unknown, c: unknown, d: Span, e: unknown): void;
  check_trait_item?(cx: LateContext, a: unknown): void;
  check_impl_item?(cx: LateContext, a: unknown): void;
  check_impl_item_post?(cx: LateContext, a: unknown): void;
  check_field_def?(cx: LateContext, a: unknown): void;
  check_variant?(cx: LateContext, a: unknown): void;
  check_path?(cx: LateContext, a: unknown, b: unknown): void;
  check_attribute?(cx: LateContext, a: unknown): void;
  check_attributes?(cx: LateContext, a: readonly unknown[]): void;
  check_attributes_post?(cx: LateContext, a: readonly unknown[]): void;
}

/** The provided (default) methods of `LateLintPass` (`declare_late_lint_pass!`): `#[inline(always)] fn $name(..) {}`. */
export const LateLintPass_provided = {
  // rustc: compiler/rustc_lint/src/passes.rs:10 check_body
  check_body(self: LateLintPass, cx: LateContext, a: unknown): void {
    if (self.check_body !== undefined) self.check_body(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:11 check_body_post
  check_body_post(self: LateLintPass, cx: LateContext, a: unknown): void {
    if (self.check_body_post !== undefined) self.check_body_post(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:12 check_crate
  check_crate(self: LateLintPass, cx: LateContext): void {
    if (self.check_crate !== undefined) self.check_crate(cx);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:13 check_crate_post
  check_crate_post(self: LateLintPass, cx: LateContext): void {
    if (self.check_crate_post !== undefined) self.check_crate_post(cx);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:14 check_mod
  check_mod(self: LateLintPass, cx: LateContext, a: unknown, b: unknown): void {
    if (self.check_mod !== undefined) self.check_mod(cx, a, b);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:15 check_foreign_item
  check_foreign_item(self: LateLintPass, cx: LateContext, a: unknown): void {
    if (self.check_foreign_item !== undefined) self.check_foreign_item(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:16 check_item
  check_item(self: LateLintPass, cx: LateContext, a: unknown): void {
    if (self.check_item !== undefined) self.check_item(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:17 check_item_post
  check_item_post(self: LateLintPass, cx: LateContext, a: unknown): void {
    if (self.check_item_post !== undefined) self.check_item_post(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:18 check_local
  check_local(self: LateLintPass, cx: LateContext, a: unknown): void {
    if (self.check_local !== undefined) self.check_local(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:19 check_block
  check_block(self: LateLintPass, cx: LateContext, a: unknown): void {
    if (self.check_block !== undefined) self.check_block(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:20 check_block_post
  check_block_post(self: LateLintPass, cx: LateContext, a: unknown): void {
    if (self.check_block_post !== undefined) self.check_block_post(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:21 check_stmt
  check_stmt(self: LateLintPass, cx: LateContext, a: unknown): void {
    if (self.check_stmt !== undefined) self.check_stmt(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:22 check_arm
  check_arm(self: LateLintPass, cx: LateContext, a: unknown): void {
    if (self.check_arm !== undefined) self.check_arm(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:23 check_pat
  check_pat(self: LateLintPass, cx: LateContext, a: unknown): void {
    if (self.check_pat !== undefined) self.check_pat(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:24 check_lit
  check_lit(self: LateLintPass, cx: LateContext, hir_id: unknown, a: unknown, is_negated_pat: boolean): void {
    if (self.check_lit !== undefined) self.check_lit(cx, hir_id, a, is_negated_pat);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:25 check_expr
  check_expr(self: LateLintPass, cx: LateContext, a: unknown): void {
    if (self.check_expr !== undefined) self.check_expr(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:26 check_expr_post
  check_expr_post(self: LateLintPass, cx: LateContext, a: unknown): void {
    if (self.check_expr_post !== undefined) self.check_expr_post(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:27 check_ty
  check_ty(self: LateLintPass, cx: LateContext, a: unknown): void {
    if (self.check_ty !== undefined) self.check_ty(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:28 check_generic_param
  check_generic_param(self: LateLintPass, cx: LateContext, a: unknown): void {
    if (self.check_generic_param !== undefined) self.check_generic_param(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:29 check_generics
  check_generics(self: LateLintPass, cx: LateContext, a: unknown): void {
    if (self.check_generics !== undefined) self.check_generics(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:30 check_poly_trait_ref
  check_poly_trait_ref(self: LateLintPass, cx: LateContext, a: unknown): void {
    if (self.check_poly_trait_ref !== undefined) self.check_poly_trait_ref(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:31 check_fn
  check_fn(self: LateLintPass, cx: LateContext, a: unknown, b: unknown, c: unknown, d: Span, e: unknown): void {
    if (self.check_fn !== undefined) self.check_fn(cx, a, b, c, d, e);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:37 check_trait_item
  check_trait_item(self: LateLintPass, cx: LateContext, a: unknown): void {
    if (self.check_trait_item !== undefined) self.check_trait_item(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:38 check_impl_item
  check_impl_item(self: LateLintPass, cx: LateContext, a: unknown): void {
    if (self.check_impl_item !== undefined) self.check_impl_item(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:39 check_impl_item_post
  check_impl_item_post(self: LateLintPass, cx: LateContext, a: unknown): void {
    if (self.check_impl_item_post !== undefined) self.check_impl_item_post(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:40 check_field_def
  check_field_def(self: LateLintPass, cx: LateContext, a: unknown): void {
    if (self.check_field_def !== undefined) self.check_field_def(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:41 check_variant
  check_variant(self: LateLintPass, cx: LateContext, a: unknown): void {
    if (self.check_variant !== undefined) self.check_variant(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:42 check_path
  check_path(self: LateLintPass, cx: LateContext, a: unknown, b: unknown): void {
    if (self.check_path !== undefined) self.check_path(cx, a, b);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:43 check_attribute
  check_attribute(self: LateLintPass, cx: LateContext, a: unknown): void {
    if (self.check_attribute !== undefined) self.check_attribute(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:44 check_attributes
  check_attributes(self: LateLintPass, cx: LateContext, a: readonly unknown[]): void {
    if (self.check_attributes !== undefined) self.check_attributes(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:45 check_attributes_post
  check_attributes_post(self: LateLintPass, cx: LateContext, a: readonly unknown[]): void {
    if (self.check_attributes_post !== undefined) self.check_attributes_post(cx, a);
  },
};

/** A pass type of a combined pass: the type (for its inherent `lint_vec`) and the expression constructing it. */
export interface PassEntry<P> {
  readonly ty: { lint_vec(): LintVec };
  readonly constructor_: () => P;
}

/// Combines multiple lints passes into a single lint pass, at compile time,
/// for maximum speed. Each `check_foo` method in `$methods` within this pass
/// simply calls `check_foo` once per `$pass`. Compare with
/// `RuntimeCombinedLateLintPass`, which is similar, but combines lint passes at
/// runtime.
// PORT: `macro_rules! declare_combined_late_lint_pass` (exported) → a function returning the class; the fields
// (`$($pass: $pass,)*`) are the entries of `passes`, in order.
export function declare_combined_late_lint_pass(
  name: string,
  passes: Record<string, PassEntry<LateLintPass>>,
): { new: () => LateLintPass; lint_vec(): LintVec } {
  const names = Object.keys(passes);
  class Combined implements LateLintPass {
    readonly fields: Record<string, LateLintPass>;
    constructor(fields: Record<string, LateLintPass>) {
      this.fields = fields;
    }

    // rustc: compiler/rustc_lint/src/passes.rs:101 new
    static new(): Combined {
      const fields: Record<string, LateLintPass> = {};
      for (const pass of names) fields[pass] = passes[pass]!.constructor_();
      return new Combined(fields);
    }

    // rustc: compiler/rustc_lint/src/passes.rs:107 lint_vec
    static lint_vec(): LintVec {
      const lints: LintVec = [];
      for (const pass of names) lints.push(...passes[pass]!.ty.lint_vec());
      return lints;
    }

    // #[allow(rustc::lint_pass_impl_without_macro)]
    // rustc: compiler/rustc_lint/src/passes.rs:120 name
    name(): string {
      return name;
    }
    // rustc: compiler/rustc_lint/src/passes.rs:123 get_lints
    get_lints(): LintVec {
      return Combined.lint_vec();
    }
  }
  // `$crate::expand_combined_late_lint_pass_methods!([$($pass),*], $methods)`
  for (const method of LATE_LINT_METHODS) {
    const provided = LateLintPass_provided[method] as (self: LateLintPass, ...args: unknown[]) => void;
    (Combined.prototype as unknown as Record<string, unknown>)[method] = function (this: Combined, ...args: unknown[]): void {
      // `expand_combined_late_lint_pass_method!`: `$($self.$pass.$name $params;)*`
      for (const pass of names) provided(this.fields[pass]!, ...args);
    };
  }
  return { new: () => Combined.new(), lint_vec: () => Combined.lint_vec() };
}

/** `macro_rules! early_lint_methods` (exported): the `check_*` methods of `EarlyLintPass`, in order. */
// `_post` methods are called *after* recursing into the node.
export const EARLY_LINT_METHODS = [
  "check_param",
  "check_ident",
  "check_crate",
  "check_crate_post",
  "check_item",
  "check_item_post",
  "check_local",
  "check_block",
  "check_stmt",
  "check_arm",
  "check_pat",
  "check_pat_post",
  "check_expr",
  "check_expr_post",
  "check_ty",
  "check_generic_arg",
  "check_generic_param",
  "check_generics",
  "check_poly_trait_ref",
  "check_fn",
  "check_trait_item",
  "check_trait_item_post",
  "check_impl_item",
  "check_impl_item_post",
  "check_variant",
  "check_attribute",
  "check_attributes",
  "check_attributes_post",
  "check_mac_def",
  "check_mac",
  "check_where_predicate",
  "check_where_predicate_post",
] as const;

/// Trait for types providing lint checks on the AST (`declare_early_lint_pass!`); every `check_*` method is
/// optional (the trait default does nothing).
export interface EarlyLintPass extends LintPass {
  check_param?(cx: EarlyContext, a: ast.Param): void;
  check_ident?(cx: EarlyContext, a: Ident): void;
  check_crate?(cx: EarlyContext, a: ast.Crate): void;
  check_crate_post?(cx: EarlyContext, a: ast.Crate): void;
  check_item?(cx: EarlyContext, a: ast.Item): void;
  check_item_post?(cx: EarlyContext, a: ast.Item): void;
  check_local?(cx: EarlyContext, a: ast.Local): void;
  check_block?(cx: EarlyContext, a: ast.Block): void;
  check_stmt?(cx: EarlyContext, a: ast.Stmt): void;
  check_arm?(cx: EarlyContext, a: ast.Arm): void;
  check_pat?(cx: EarlyContext, a: ast.Pat): void;
  check_pat_post?(cx: EarlyContext, a: ast.Pat): void;
  check_expr?(cx: EarlyContext, a: ast.Expr): void;
  check_expr_post?(cx: EarlyContext, a: ast.Expr): void;
  check_ty?(cx: EarlyContext, a: ast.Ty): void;
  check_generic_arg?(cx: EarlyContext, a: ast.GenericArg): void;
  check_generic_param?(cx: EarlyContext, a: ast.GenericParam): void;
  check_generics?(cx: EarlyContext, a: ast.Generics): void;
  check_poly_trait_ref?(cx: EarlyContext, a: ast.PolyTraitRef): void;
  check_fn?(cx: EarlyContext, a: FnKind, c: Span, d_: NodeId): void;
  check_trait_item?(cx: EarlyContext, a: ast.AssocItem): void;
  check_trait_item_post?(cx: EarlyContext, a: ast.AssocItem): void;
  check_impl_item?(cx: EarlyContext, a: ast.AssocItem): void;
  check_impl_item_post?(cx: EarlyContext, a: ast.AssocItem): void;
  check_variant?(cx: EarlyContext, a: ast.Variant): void;
  check_attribute?(cx: EarlyContext, a: ast.Attribute): void;
  check_attributes?(cx: EarlyContext, a: readonly ast.Attribute[]): void;
  check_attributes_post?(cx: EarlyContext, a: readonly ast.Attribute[]): void;
  check_mac_def?(cx: EarlyContext, a: ast.MacroDef): void;
  check_mac?(cx: EarlyContext, a: ast.MacCall): void;
  check_where_predicate?(cx: EarlyContext, a: ast.WherePredicate): void;
  check_where_predicate_post?(cx: EarlyContext, a: ast.WherePredicate): void;
}

/** The provided (default) methods of `EarlyLintPass` (`declare_early_lint_pass!`): `#[inline(always)] fn $name(..) {}`. */
export const EarlyLintPass_provided = {
  // rustc: compiler/rustc_lint/src/passes.rs:135 check_param
  check_param(self: EarlyLintPass, cx: EarlyContext, a: ast.Param): void {
    if (self.check_param !== undefined) self.check_param(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:136 check_ident
  check_ident(self: EarlyLintPass, cx: EarlyContext, a: Ident): void {
    if (self.check_ident !== undefined) self.check_ident(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:137 check_crate
  check_crate(self: EarlyLintPass, cx: EarlyContext, a: ast.Crate): void {
    if (self.check_crate !== undefined) self.check_crate(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:138 check_crate_post
  check_crate_post(self: EarlyLintPass, cx: EarlyContext, a: ast.Crate): void {
    if (self.check_crate_post !== undefined) self.check_crate_post(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:139 check_item
  check_item(self: EarlyLintPass, cx: EarlyContext, a: ast.Item): void {
    if (self.check_item !== undefined) self.check_item(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:140 check_item_post
  check_item_post(self: EarlyLintPass, cx: EarlyContext, a: ast.Item): void {
    if (self.check_item_post !== undefined) self.check_item_post(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:141 check_local
  check_local(self: EarlyLintPass, cx: EarlyContext, a: ast.Local): void {
    if (self.check_local !== undefined) self.check_local(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:142 check_block
  check_block(self: EarlyLintPass, cx: EarlyContext, a: ast.Block): void {
    if (self.check_block !== undefined) self.check_block(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:143 check_stmt
  check_stmt(self: EarlyLintPass, cx: EarlyContext, a: ast.Stmt): void {
    if (self.check_stmt !== undefined) self.check_stmt(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:144 check_arm
  check_arm(self: EarlyLintPass, cx: EarlyContext, a: ast.Arm): void {
    if (self.check_arm !== undefined) self.check_arm(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:145 check_pat
  check_pat(self: EarlyLintPass, cx: EarlyContext, a: ast.Pat): void {
    if (self.check_pat !== undefined) self.check_pat(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:146 check_pat_post
  check_pat_post(self: EarlyLintPass, cx: EarlyContext, a: ast.Pat): void {
    if (self.check_pat_post !== undefined) self.check_pat_post(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:147 check_expr
  check_expr(self: EarlyLintPass, cx: EarlyContext, a: ast.Expr): void {
    if (self.check_expr !== undefined) self.check_expr(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:148 check_expr_post
  check_expr_post(self: EarlyLintPass, cx: EarlyContext, a: ast.Expr): void {
    if (self.check_expr_post !== undefined) self.check_expr_post(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:149 check_ty
  check_ty(self: EarlyLintPass, cx: EarlyContext, a: ast.Ty): void {
    if (self.check_ty !== undefined) self.check_ty(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:150 check_generic_arg
  check_generic_arg(self: EarlyLintPass, cx: EarlyContext, a: ast.GenericArg): void {
    if (self.check_generic_arg !== undefined) self.check_generic_arg(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:151 check_generic_param
  check_generic_param(self: EarlyLintPass, cx: EarlyContext, a: ast.GenericParam): void {
    if (self.check_generic_param !== undefined) self.check_generic_param(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:152 check_generics
  check_generics(self: EarlyLintPass, cx: EarlyContext, a: ast.Generics): void {
    if (self.check_generics !== undefined) self.check_generics(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:153 check_poly_trait_ref
  check_poly_trait_ref(self: EarlyLintPass, cx: EarlyContext, a: ast.PolyTraitRef): void {
    if (self.check_poly_trait_ref !== undefined) self.check_poly_trait_ref(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:154 check_fn
  check_fn(self: EarlyLintPass, cx: EarlyContext, a: FnKind, c: Span, d_: NodeId): void {
    if (self.check_fn !== undefined) self.check_fn(cx, a, c, d_);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:158 check_trait_item
  check_trait_item(self: EarlyLintPass, cx: EarlyContext, a: ast.AssocItem): void {
    if (self.check_trait_item !== undefined) self.check_trait_item(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:159 check_trait_item_post
  check_trait_item_post(self: EarlyLintPass, cx: EarlyContext, a: ast.AssocItem): void {
    if (self.check_trait_item_post !== undefined) self.check_trait_item_post(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:160 check_impl_item
  check_impl_item(self: EarlyLintPass, cx: EarlyContext, a: ast.AssocItem): void {
    if (self.check_impl_item !== undefined) self.check_impl_item(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:161 check_impl_item_post
  check_impl_item_post(self: EarlyLintPass, cx: EarlyContext, a: ast.AssocItem): void {
    if (self.check_impl_item_post !== undefined) self.check_impl_item_post(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:162 check_variant
  check_variant(self: EarlyLintPass, cx: EarlyContext, a: ast.Variant): void {
    if (self.check_variant !== undefined) self.check_variant(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:163 check_attribute
  check_attribute(self: EarlyLintPass, cx: EarlyContext, a: ast.Attribute): void {
    if (self.check_attribute !== undefined) self.check_attribute(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:164 check_attributes
  check_attributes(self: EarlyLintPass, cx: EarlyContext, a: readonly ast.Attribute[]): void {
    if (self.check_attributes !== undefined) self.check_attributes(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:165 check_attributes_post
  check_attributes_post(self: EarlyLintPass, cx: EarlyContext, a: readonly ast.Attribute[]): void {
    if (self.check_attributes_post !== undefined) self.check_attributes_post(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:166 check_mac_def
  check_mac_def(self: EarlyLintPass, cx: EarlyContext, a: ast.MacroDef): void {
    if (self.check_mac_def !== undefined) self.check_mac_def(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:167 check_mac
  check_mac(self: EarlyLintPass, cx: EarlyContext, a: ast.MacCall): void {
    if (self.check_mac !== undefined) self.check_mac(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:168 check_where_predicate
  check_where_predicate(self: EarlyLintPass, cx: EarlyContext, a: ast.WherePredicate): void {
    if (self.check_where_predicate !== undefined) self.check_where_predicate(cx, a);
  },
  // rustc: compiler/rustc_lint/src/passes.rs:169 check_where_predicate_post
  check_where_predicate_post(self: EarlyLintPass, cx: EarlyContext, a: ast.WherePredicate): void {
    if (self.check_where_predicate_post !== undefined) self.check_where_predicate_post(cx, a);
  },
};

/// Combines multiple lints passes into a single lint pass, at compile time,
/// for maximum speed. Each `check_foo` method in `$methods` within this pass
/// simply calls `check_foo` once per `$pass`. Compare with
/// `RuntimeCombinedEarlyLintPass`, which is similar, but combines lint passes at
/// runtime.
// PORT: `macro_rules! declare_combined_early_lint_pass` (exported) → a function returning the class; the fields
// (`$($pass: $pass,)*`) are the entries of `passes`, in order.
export function declare_combined_early_lint_pass(
  _name: string,
  passes: Record<string, PassEntry<EarlyLintPass>>,
): { new: () => EarlyLintPass; lint_vec(): LintVec } {
  const names = Object.keys(passes);
  class Combined implements EarlyLintPass {
    readonly fields: Record<string, EarlyLintPass>;
    constructor(fields: Record<string, EarlyLintPass>) {
      this.fields = fields;
    }

    // rustc: compiler/rustc_lint/src/passes.rs:216 new
    static new(): Combined {
      const fields: Record<string, EarlyLintPass> = {};
      for (const pass of names) fields[pass] = passes[pass]!.constructor_();
      return new Combined(fields);
    }

    // rustc: compiler/rustc_lint/src/passes.rs:222 lint_vec
    static lint_vec(): LintVec {
      const lints: LintVec = [];
      for (const pass of names) lints.push(...passes[pass]!.ty.lint_vec());
      return lints;
    }

    // #[allow(rustc::lint_pass_impl_without_macro)]
    // rustc: compiler/rustc_lint/src/passes.rs:235 name
    name(): string {
      return panic("explicit panic");
    }
    // rustc: compiler/rustc_lint/src/passes.rs:238 get_lints
    get_lints(): LintVec {
      return panic("explicit panic");
    }
  }
  // `$crate::expand_combined_early_lint_pass_methods!([$($pass),*], $methods)`
  for (const method of EARLY_LINT_METHODS) {
    const provided = EarlyLintPass_provided[method] as (self: EarlyLintPass, ...args: unknown[]) => void;
    (Combined.prototype as unknown as Record<string, unknown>)[method] = function (this: Combined, ...args: unknown[]): void {
      // `expand_combined_early_lint_pass_method!`: `$($self.$pass.$name $params;)*`
      for (const pass of names) provided(this.fields[pass]!, ...args);
    };
  }
  return { new: () => Combined.new(), lint_vec: () => Combined.lint_vec() };
}

/// A lint pass boxed up as a trait object.
export type EarlyLintPassObject = EarlyLintPass;
export type LateLintPassObject = LateLintPass;
