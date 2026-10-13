// Port of compiler/rustc_ast_passes/src/feature_gate.rs.
import { ast, attr, visit } from "../rustc_ast/lib.ts";
import type { AnonConst, AssocItem, AttrVec, Crate, Expr, FnRetTy, ForeignItem, GenericArgs, GenericParam, Item, Pat, PolyTraitRef, Ty } from "../rustc_ast/ast.ts";
import type { TestBinderBoundTypeConstraint, TestBinderExists, TestBinderForall, WherePredicateKind } from "../rustc_ast/ast.ts";
import type { NodeId } from "../rustc_ast/node_id.ts";
import { type AssocCtxt, type FnKind, Visitor } from "../rustc_ast/visit.ts";
import type { Attribute as attrs_Attribute } from "../rustc_attr_ir/lib.ts";
import { AttributeParser } from "../rustc_attr_parsing/lib.ts";
import type { IntoDiagMessage } from "../rustc_error_messages/lib.ts";
import { type DependentFeature, type Features, INCOMPATIBLE_FEATURES, DEPENDENT_FEATURES, UnstableFeatures } from "../rustc_feature/lib.ts";
import type { Session } from "../rustc_session/session.ts";
import { feature_err, feature_warn } from "../rustc_session/diagnostics.ts";
import { Span } from "../rustc_span/lib.ts";
import { sym, Symbol } from "../rustc_span/symbol.ts";
import { assert, unwrap } from "../std/panic.ts";
import * as diagnostics from "./diagnostics.ts";

/** PORT: the per-feature query methods of `Features` (`features.$feature()`); `sym[name]` is `sym::$feature`. */
type FeatureName = { [K in keyof Features]: Features[K] extends () => boolean ? K : never }[keyof Features] & keyof typeof sym;

/** PORT: `$visitor` of the gate macros: anything with `sess` and `features`. */
interface GateVisitor {
  sess: Session;
  features: Features;
}

/// The common case.
// macro_rules! gate
// rustc-macro: compiler/rustc_ast_passes/src/feature_gate.rs:15 gate!
function gate(visitor: GateVisitor, feature: FeatureName, span: Span, explain: IntoDiagMessage, help?: IntoDiagMessage): void {
  if (!visitor.features[feature]() && !Span.allows_unstable(span, sym[feature])) {
    const diag = feature_err(visitor.sess, sym[feature], span, explain);
    if (help !== undefined) diag.with_help(help);
    diag.emit();
  }
}

/// The unusual case, where the `has_feature` condition is non-standard.
// macro_rules! gate_alt
// rustc-macro: compiler/rustc_ast_passes/src/feature_gate.rs:26 gate_alt!
function gate_alt(visitor: GateVisitor, has_feature: boolean, name: Symbol, span: Span, explain: IntoDiagMessage, notes?: readonly string[]): void {
  if (!has_feature && !Span.allows_unstable(span, name)) {
    // #[allow(unused_mut)]
    const diag = feature_err(visitor.sess, name, span, explain);
    if (notes !== undefined) {
      for (const note of notes) {
        diag.note(note);
      }
    }
    diag.emit();
  }
}

/// The case involving a multispan.
// macro_rules! gate_multi
// rustc-macro: compiler/rustc_ast_passes/src/feature_gate.rs:38 gate_multi!
function gate_multi(visitor: GateVisitor, feature: FeatureName, spans_: Iterable<Span>, explain: IntoDiagMessage): void {
  if (!visitor.features[feature]()) {
    const spans: Span[] = [];
    for (const span of spans_) {
      if (!Span.allows_unstable(span, sym[feature])) spans.push(span);
    }
    if (spans.length !== 0) {
      feature_err(visitor.sess, sym[feature], spans, explain).emit();
    }
  }
}

// -----------------------------------------------------------------------------
// POST-EXPANSION FEATURE GATES FOR UNSTABLE ATTRIBUTES ETC.
// **LEGACY**  POST-EXPANSION FEATURE GATES FOR UNSTABLE SYNTAX  **LEGACY**
// -----------------------------------------------------------------------------

// IMPORTANT: Don't add any new post-expansion feature gates for new unstable syntax!
//            It's a legacy mechanism for them.
//            Instead, register a pre-expansion feature gate using `gate_all` in fn `check_crate`.

class PostExpansionVisitor extends Visitor implements GateVisitor {
  constructor(
    public sess: Session,

    // `sess` contains a `Features`, but this might not be that one.
    public features: Features,
  ) {
    super();
  }

  /// Feature gate `impl Trait` inside `type Alias = $type_expr;`.
  // rustc: compiler/rustc_ast_passes/src/feature_gate.rs:68 check_impl_trait
  check_impl_trait(ty: Ty, in_associated_ty: boolean): void {
    class ImplTraitVisitor extends Visitor {
      constructor(
        public vis: PostExpansionVisitor,
        public in_associated_ty: boolean,
      ) {
        super();
      }

      // rustc: compiler/rustc_ast_passes/src/feature_gate.rs:74 visit_ty
      override visit_ty(ty: Ty): undefined {
        if (ty.kind.$ === "ImplTrait") {
          if (this.in_associated_ty) {
            gate(this.vis, "impl_trait_in_assoc_type", ty.span, "`impl Trait` in associated types is unstable");
          } else {
            gate(this.vis, "type_alias_impl_trait", ty.span, "`impl Trait` in type aliases is unstable");
          }
        }
        visit.walk_ty(this, ty);
      }

      // rustc: compiler/rustc_ast_passes/src/feature_gate.rs:95 visit_anon_const
      override visit_anon_const(_: AnonConst): undefined {
        // We don't walk the anon const because it crosses a conceptual boundary: We're no
        // longer "inside" the original type.
        // Brittle: We assume that the callers of `check_impl_trait` will later recurse into
        // the items found in the AnonConst to look for nested TyAliases.
      }
    }
    new ImplTraitVisitor(this, in_associated_ty).visit_ty(ty);
  }

  // rustc: compiler/rustc_ast_passes/src/feature_gate.rs:105 check_late_bound_lifetime_defs
  check_late_bound_lifetime_defs(params: readonly GenericParam[]): void {
    // Check only lifetime parameters are present and that the
    // generic parameters that are present have no bounds.
    const non_lt_param_spans = params.filter((param) => param.kind.$ !== "Lifetime").map((param) => param.ident.span);
    gate_multi(this, "non_lifetime_binders", non_lt_param_spans, { $: "Inline", _0: "only lifetime parameters can be used in this context" });

    // FIXME(non_lifetime_binders): Const bound params are pretty broken.
    // Let's keep users from using this feature accidentally.
    if (this.features.non_lifetime_binders()) {
      const const_param_spans: Span[] = params.filter((param) => param.kind.$ === "Const").map((param) => param.ident.span);

      if (const_param_spans.length !== 0) {
        this.sess.dcx().emit_err(diagnostics.ForbiddenConstParam_diagnostic({ const_param_spans }));
      }
    }

    for (const param of params) {
      if (param.bounds.length !== 0) {
        const spans: Span[] = param.bounds.map((b) => ast.GenericBound.span(b));
        if (param.bounds.some((bound) => bound.$ === "Trait")) {
          // Issue #149695
          // Abort immediately otherwise items defined in complex bounds will be lowered into HIR,
          // which will cause ICEs when errors of the items visit unlowered parents.
          this.sess.dcx().emit_fatal(diagnostics.ForbiddenBound_diagnostic({ spans }));
        } else {
          this.sess.dcx().emit_err(diagnostics.ForbiddenBound_diagnostic({ spans }));
        }
      }
    }
  }

  // ---- impl<'a> Visitor<'a> for PostExpansionVisitor<'a> ----

  // rustc: compiler/rustc_ast_passes/src/feature_gate.rs:152 visit_attribute
  override visit_attribute(a: ast.Attribute): undefined {
    // Checked in attribute parsers, do NOT add checks here
    visit.walk_attribute(this, a);
  }

  // rustc: compiler/rustc_ast_passes/src/feature_gate.rs:157 visit_item
  override visit_item(i: Item): undefined {
    const kind = i.kind;
    switch (kind.$) {
      case "ForeignMod":
        // handled during lowering
        break;
      case "Impl": {
        const of_trait = kind._0.of_trait;
        if (of_trait === undefined) break;
        if (of_trait.polarity.$ === "Negative") {
          const span = of_trait.polarity._0;
          gate(this, "negative_impls", Span.to(span, of_trait.trait_ref.path.span), "negative impls are experimental", "use marker types for now");
        }

        if (of_trait.defaultness.$ === "Default") {
          gate(this, "specialization", i.span, "specialization is experimental");
        }
        break;
      }

      case "Trait":
        if (kind._0.is_auto === "Yes") {
          gate(this, "auto_traits", i.span, "auto traits are experimental and possibly buggy");
        }
        break;

      case "TraitAlias":
        gate(this, "trait_alias", i.span, "trait aliases are experimental");
        break;

      case "MacroDef":
        if (!kind._1.macro_rules) {
          const msg = "`macro` is experimental";
          gate(this, "decl_macro", i.span, msg);
        }
        break;

      case "TyAlias":
        if (kind._0.ty !== undefined) {
          this.check_impl_trait(kind._0.ty, false);
        }
        break;

      default:
        break;
    }

    visit.walk_item(this, i, visit.WalkItemKind.ItemKind);
  }

  // rustc: compiler/rustc_ast_passes/src/feature_gate.rs:201 visit_foreign_item
  override visit_foreign_item(i: ForeignItem): undefined {
    switch (i.kind.$) {
      case "Fn":
      case "Static": {
        let symbol_name: Symbol;
        const link_name = attr.first_attr_value_str_by_name(i.attrs, sym.link_name);
        if (link_name !== undefined) {
          symbol_name = link_name;
        } else {
          symbol_name = unwrap(ast.ForeignItemKind.ident(i.kind)).name;
        }

        const name = Symbol.as_str(symbol_name);
        if (name.startsWith("llvm.")) {
          gate(this, "link_llvm_intrinsics", i.span, "linking to LLVM intrinsics is experimental");
        } else if (name.startsWith("__enzyme_")) {
          gate(this, "link_enzyme_intrinsics", i.span, "linking to Enzyme intrinsics is experimental");
        }
        break;
      }
      case "TyAlias":
        gate(this, "extern_types", i.span, "extern types are experimental");
        break;
      case "MacCall":
        break;
    }

    visit.walk_item(this, i, visit.WalkItemKind.ForeignItemKind);
  }

  // rustc: compiler/rustc_ast_passes/src/feature_gate.rs:238 visit_ty
  override visit_ty(ty: Ty): undefined {
    switch (ty.kind.$) {
      case "FnPtr": {
        const fn_ptr_ty = ty.kind._0;
        // Function pointers cannot be `const`
        this.check_late_bound_lifetime_defs(fn_ptr_ty.generic_params);
        break;
      }
      case "Pat":
        gate(this, "pattern_types", ty.span, "pattern types are unstable");
        break;
      case "View":
        gate(this, "view_types", ty.span, "view types are unstable");
        break;
      default:
        break;
    }
    visit.walk_ty(this, ty);
  }

  // rustc: compiler/rustc_ast_passes/src/feature_gate.rs:255 visit_where_predicate_kind
  override visit_where_predicate_kind(kind: WherePredicateKind): undefined {
    if (kind.$ === "BoundPredicate") {
      const bound = kind._0;
      // A type bound (e.g., `for<'c> Foo: Send + Clone + 'c`).
      this.check_late_bound_lifetime_defs(bound.bound_generic_params);
    }
    visit.walk_where_predicate_kind(this, kind);
  }

  // rustc: compiler/rustc_ast_passes/src/feature_gate.rs:263 visit_fn_ret_ty
  override visit_fn_ret_ty(ret_ty: FnRetTy): undefined {
    if (ret_ty.$ === "Ty") {
      const output_ty = ret_ty._0;
      if (output_ty.kind.$ === "Never") {
        // Do nothing.
      } else {
        this.visit_ty(output_ty);
      }
    }
  }

  // rustc: compiler/rustc_ast_passes/src/feature_gate.rs:273 visit_generic_args
  override visit_generic_args(args: GenericArgs): undefined {
    visit.walk_generic_args(this, args);
  }

  // rustc: compiler/rustc_ast_passes/src/feature_gate.rs:277 visit_expr
  override visit_expr(e: Expr): undefined {
    const kind = e.kind;
    if (kind.$ === "TryBlock" && kind._1 === undefined) {
      // `try { ... }` is old and is only gated post-expansion here.
      gate(this, "try_blocks", e.span, "`try` expression is experimental");
    } else if (kind.$ === "TryBlock") {
      // `try_blocks_heterogeneous` is new, and gated pre-expansion instead.
    } else if (kind.$ === "Lit" && (kind._0.kind.$ === "Float" || kind._0.kind.$ === "Integer")) {
      const suffix = kind._0.suffix;
      if (suffix === sym.f16) {
        gate(this, "f16", e.span, "the type `f16` is unstable");
      } else if (suffix === sym.f128) {
        gate(this, "f128", e.span, "the type `f128` is unstable");
      }
    }
    visit.walk_expr(this, e);
  }

  // rustc: compiler/rustc_ast_passes/src/feature_gate.rs:304 visit_pat
  override visit_pat(pattern: Pat): undefined {
    if (pattern.kind.$ === "Slice") {
      const pats = pattern.kind._0;
      for (const pat of pats) {
        const inner_pat = pat.kind.$ === "Ident" && pat.kind._2 !== undefined ? pat.kind._2 : pat;
        if (inner_pat.kind.$ === "Range" && inner_pat.kind._0 !== undefined && inner_pat.kind._1 === undefined) {
          gate(this, "half_open_range_patterns_in_slices", pat.span, "`X..` patterns in slices are experimental");
        }
      }
    }
    visit.walk_pat(this, pattern);
  }

  // rustc: compiler/rustc_ast_passes/src/feature_gate.rs:327 visit_poly_trait_ref
  override visit_poly_trait_ref(t: PolyTraitRef): undefined {
    this.check_late_bound_lifetime_defs(t.bound_generic_params);
    visit.walk_poly_trait_ref(this, t);
  }

  // rustc: compiler/rustc_ast_passes/src/feature_gate.rs:332 visit_fn
  override visit_fn(fn_kind: FnKind, _1: AttrVec, _2: Span, _3: NodeId): undefined {
    if (visit.FnKind.header(fn_kind) !== undefined) {
      // Stability of const fn methods are covered in `visit_assoc_item` below.
    }

    if (fn_kind.$ === "Closure" && fn_kind._0.$ === "For") {
      this.check_late_bound_lifetime_defs(fn_kind._0.generic_params);
    }

    visit.walk_fn(this, fn_kind);
  }

  // rustc: compiler/rustc_ast_passes/src/feature_gate.rs:344 visit_assoc_item
  override visit_assoc_item(i: AssocItem, ctxt: AssocCtxt): undefined {
    let is_fn: boolean;
    const kind = i.kind;
    if (kind.$ === "Fn") {
      is_fn = true;
    } else if (kind.$ === "Type") {
      const ty = kind._0.ty;
      if (ty !== undefined && ctxt.$ === "Trait") {
        gate(this, "associated_type_defaults", i.span, "associated type defaults are unstable");
      }
      if (ty !== undefined) {
        this.check_impl_trait(ty, true);
      }
      is_fn = false;
    } else if (kind.$ === "Const" && kind._0.body !== undefined) {
      if (ctxt.$ === "Trait" && attr.contains_name(i.attrs, sym.rustc_always_gca)) {
        gate(this, "associated_type_defaults", i.span, "associated type defaults are unstable");
      }
      is_fn = false;
    } else {
      is_fn = false;
    }
    if (ast.AssocItemKind.defaultness(i.kind).$ === "Default") {
      // Limit `min_specialization` to only specializing functions.
      gate_alt(
        this,
        this.features.specialization() || (is_fn && this.features.min_specialization()),
        sym.specialization,
        i.span,
        "specialization is experimental",
      );
    }
    visit.walk_assoc_item(this, i, ctxt, visit.WalkItemKind.AssocItemKind);
  }

  // rustc: compiler/rustc_ast_passes/src/feature_gate.rs:388 visit_test_binder_forall
  override visit_test_binder_forall(forall: TestBinderForall): undefined {
    this.check_late_bound_lifetime_defs(forall.generics.params);
    visit.walk_test_binder_forall(this, forall);
  }

  // rustc: compiler/rustc_ast_passes/src/feature_gate.rs:393 visit_test_binder_exists
  override visit_test_binder_exists(exists: TestBinderExists): undefined {
    this.check_late_bound_lifetime_defs(exists.params);
    visit.walk_test_binder_exists(this, exists);
  }

  // rustc: compiler/rustc_ast_passes/src/feature_gate.rs:398 visit_test_binder_bound_type_constraint
  override visit_test_binder_bound_type_constraint(bound_type: TestBinderBoundTypeConstraint): undefined {
    this.check_late_bound_lifetime_defs(bound_type.params);
    visit.walk_test_binder_bound_type_constraint(this, bound_type);
  }
}

// -----------------------------------------------------------------------------

// rustc: compiler/rustc_ast_passes/src/feature_gate.rs:409 check_crate
export function check_crate(krate: Crate, sess: Session, features: Features): void {
  maybe_stage_features(sess, features, krate);
  check_incompatible_features(sess, features);
  check_dependent_features(sess, features);
  warn_next_solver_and_gce(sess, features);
  warn_next_solver_and_higher_ranked_assumptions(sess);
  check_features_requiring_new_solver(sess, features);

  const visitor = new PostExpansionVisitor(sess, features);

  // -----------------------------------------------------------------------------
  // PRE-EXPANSION FEATURE GATES FOR UNSTABLE SYNTAX
  // -----------------------------------------------------------------------------

  const spans = sess.psess.gated_spans.spans;
  /** `spans.get(&sym::$feature).into_flat_iter()` */
  const spans_of = (name: Symbol): readonly Span[] => spans.get(name) ?? [];
  // macro_rules! gate_all
  const gate_all = (feature: FeatureName, explain: string, help?: string): void => {
    for (const span of spans_of(sym[feature])) {
      gate(visitor, feature, span, explain, help);
    }
  };

  // tidy-alphabetical-start
  gate_all("async_for_loop", "`for await` loops are experimental");
  gate_all("builtin_syntax", "`builtin #` syntax is unstable");
  gate_all("const_block_items", "const block items are experimental");
  gate_all("const_closures", "const closures are experimental");
  gate_all("const_trait_impl", "const trait impls are experimental");
  gate_all("contracts", "contracts are incomplete");
  gate_all("contracts_internals", "contract internal machinery is for internal use only");
  gate_all("coroutines", "coroutine syntax is experimental");
  gate_all("default_field_values", "default values on fields are experimental");
  gate_all("ergonomic_clones", "ergonomic clones are experimental");
  gate_all("explicit_tail_calls", "`become` expression is experimental");
  gate_all("final_associated_functions", "`final` on trait functions is experimental");
  gate_all("fn_delegation", "functions delegation is not yet fully implemented");
  gate_all("forced_keywords", "forced keywords are experimental");
  gate_all("frontmatter", "frontmatters are experimental");
  gate_all("gca_min_const_items", "unbraced const blocks as const args are experimental");
  gate_all("gen_blocks", "gen blocks are experimental");
  gate_all("generic_const_items", "generic const items are experimental");
  gate_all("global_registration", "global registration is experimental");
  gate_all("guard_patterns", "guard patterns are experimental", "consider using match arm guards");
  gate_all("impl_restriction", "`impl` restrictions are experimental");
  gate_all("more_qualified_paths", "usage of qualified paths in this context is experimental");
  gate_all("move_expr", "`move(expr)` syntax is experimental");
  gate_all("mut_ref", "mutable by-reference bindings are experimental");
  gate_all("mut_restriction", "`mut` restrictions are experimental");
  gate_all("pin_ergonomics", "pinned reference syntax is experimental");
  gate_all("postfix_match", "postfix match is experimental");
  gate_all("return_type_notation", "return type notation is experimental");
  gate_all("splat", "`fn(#[rustc_splat] (a, ...))` is incomplete", "call as func((a, ...)) instead");
  gate_all("super_let", "`super let` is experimental");
  gate_all("try_blocks_heterogeneous", "`try bikeshed` expression is experimental");
  gate_all("unnamed_enum_variants", "unnamed enum variants are experimental");
  gate_all("unsafe_binders", "unsafe binder types are experimental");
  gate_all("unsafe_fields", "`unsafe` fields are experimental");
  gate_all("view_types", "view types are experimental");
  gate_all("where_clause_attrs", "attributes in `where` clause are unstable");
  gate_all("yeet_expr", "`do yeet` expression is experimental");
  // tidy-alphabetical-end

  gate_all("async_trait_bounds", "`async` trait bounds are unstable", "use the desugared name of the async trait, such as `AsyncFn`");
  gate_all(
    "closure_lifetime_binder",
    "`for<...>` binders for closures are experimental",
    "consider using a type annotation instead: `let closure: for<...> fn(...) -> ... = /* closure */;`",
  );
  gate_all("half_open_range_patterns_in_slices", "half-open range patterns in slices are unstable");
  gate_all("named_fn_trait_parameters", "named parameters in parenthesized generic argument lists are experimental");

  // `associated_const_equality` will be stabilized as part of `gca_min_const_items`.
  for (const span of spans_of(sym.associated_const_equality)) {
    gate(visitor, "gca_min_const_items", span, "associated const equality is incomplete");
  }

  // Negative bounds are *super* internal. We require `-Zinternal-testing-features` *and*
  // `#![feature(negative_bounds)]` to prevent proliferation. Under no circumstances do we
  // want to advertise the flag and the feature name to users!
  //
  // IMPORTANT: If you intend on turning negative bounds into a public-facing feature, please
  //            consult T-types and T-lang first! Do **not** just remove the `-Z` check!
  //
  // NOTE: `T: !Bound` means "`T` implements `Bound` negatively",
  //       it does **not** mean "`T` doesn't implement `Bound` (positively or negatively)"!
  //       The latter would be a SemVer hazard!
  if (!sess.opts.unstable_opts.internal_testing_features || !visitor.features.negative_bounds()) {
    for (const span of spans_of(sym.negative_bounds)) {
      sess.dcx().emit_err(diagnostics.NegativeBoundUnsupported_diagnostic({ span }));
    }
  }

  if (!visitor.features.never_patterns()) {
    for (const span of spans_of(sym.never_patterns)) {
      if (Span.allows_unstable(span, sym.never_patterns)) {
        continue;
      }
      // We gate two types of spans: the span of a `!` pattern, and the span of a
      // match arm without a body. For the latter we want to give the user a normal
      // error.
      const snippet = sess.source_map().span_to_snippet(span);
      if (snippet.$ === "Ok" && snippet._0.toString() === "!") {
        feature_err(sess, sym.never_patterns, span, "`!` patterns are experimental").emit();
      } else {
        const suggestion = Span.shrink_to_hi(span);
        sess.dcx().emit_err(diagnostics.MatchArmWithNoBody_diagnostic({ span, suggestion }));
      }
    }
  }

  // Yield exprs can be enabled either by `yield_expr`, by `coroutines` or by `gen_blocks`.
  for (const span of spans_of(sym.yield_expr)) {
    if (
      !visitor.features.coroutines() &&
      !Span.allows_unstable(span, sym.coroutines) &&
      !visitor.features.gen_blocks() &&
      !Span.allows_unstable(span, sym.gen_blocks) &&
      !visitor.features.yield_expr() &&
      !Span.allows_unstable(span, sym.yield_expr)
    ) {
      // Only mentioned `yield_expr` in the diagnostic since that'll be sufficient.
      // You can think of it as `coroutines` and `gen_blocks` implying `yield_expr`.
      feature_err(visitor.sess, sym.yield_expr, span, "yield syntax is experimental").emit();
    }
  }

  // -----------------------------------------------------------------------------
  // **LEGACY**  SOFT PRE-EXPANSION FEATURE GATES FOR UNSTABLE SYNTAX  **LEGACY**
  // -----------------------------------------------------------------------------

  // IMPORTANT: Do not extend the list below! New syntax should go above and use `gate_all`.

  // FIXME(#154045): Migrate all of these to erroring feature gates and
  //                 remove the corresponding post-expansion feature gates.

  // macro_rules! soft_gate_all_legacy_dont_use
  const soft_gate_all_legacy_dont_use = (feature: FeatureName, explain: string): void => {
    for (const span of spans_of(sym[feature])) {
      if (!visitor.features[feature]() && !Span.allows_unstable(span, sym[feature])) {
        feature_warn(visitor.sess, sym[feature], span, explain);
      }
    }
  };

  // tidy-alphabetical-start
  soft_gate_all_legacy_dont_use("auto_traits", "`auto` traits are unstable");
  soft_gate_all_legacy_dont_use("decl_macro", "`macro` is experimental");
  soft_gate_all_legacy_dont_use("negative_impls", "negative impls are experimental");
  soft_gate_all_legacy_dont_use("specialization", "specialization is experimental");
  soft_gate_all_legacy_dont_use("trait_alias", "trait aliases are experimental");
  soft_gate_all_legacy_dont_use("try_blocks", "`try` blocks are unstable");
  // tidy-alphabetical-end

  for (const span of spans_of(sym.min_specialization)) {
    if (
      !visitor.features.specialization() &&
      !visitor.features.min_specialization() &&
      !Span.allows_unstable(span, sym.specialization) &&
      !Span.allows_unstable(span, sym.min_specialization)
    ) {
      feature_warn(visitor.sess, sym.specialization, span, "specialization is experimental");
    }
  }

  // -----------------------------------------------------------------------------

  visit.walk_crate(visitor, krate);
}

/** PORT: `option_env!("CFG_RELEASE_CHANNEL")` of the oracle toolchain (as in rustc_driver_impl/lib.ts). */
const CFG_RELEASE_CHANNEL: string | undefined = "nightly";

// rustc: compiler/rustc_ast_passes/src/feature_gate.rs:590 maybe_stage_features
function maybe_stage_features(sess: Session, features: Features, krate: Crate): void {
  // checks if `#![feature]` has been used to enable any feature.
  if (UnstableFeatures.is_nightly_build(sess.opts.unstable_features)) {
    return;
  }
  if (features.enabled_features().size === 0) {
    return;
  }
  let errored = false;

  const parsed: attrs_Attribute | undefined = AttributeParser.parse_limited_sym(sess, krate.attrs, [sym.feature]);
  if (parsed !== undefined && parsed.$ === "Parsed" && parsed._0.$ === "Feature") {
    const feature_idents = parsed._0._0;
    const first_span = parsed._0._1;
    // `feature(...)` used on non-nightly. This is definitely an error.
    const err: diagnostics.FeatureOnNonNightly = {
      span: first_span,
      channel: CFG_RELEASE_CHANNEL ?? "(unknown)",
      stable_features: [],
      sugg: undefined,
    };

    let all_stable = true;
    for (const ident of feature_idents) {
      const name = ident.name;
      const stable_since = features.enabled_lang_features().find((feat) => feat.gate_name === name)?.stable_since;
      if (stable_since !== undefined) {
        const since = stable_since;
        err.stable_features.push({ name, since });
      } else {
        all_stable = false;
      }
    }
    if (all_stable) {
      err.sugg = first_span;
    }
    sess.dcx().emit_err(diagnostics.FeatureOnNonNightly_diagnostic(err));
    errored = true;
  }
  // Just make sure we actually error if anything is listed in `enabled_features`.
  assert(errored, "assertion failed: errored");
}

// rustc: compiler/rustc_ast_passes/src/feature_gate.rs:636 check_incompatible_features
function check_incompatible_features(sess: Session, features: Features): void {
  const enabled_features = features.enabled_features_iter_stable_order();

  for (const [f1, f2] of INCOMPATIBLE_FEATURES.filter(([f1, f2]) => features.enabled(f1) && features.enabled(f2))) {
    const e1 = enabled_features.find(([name]) => name === f1);
    const e2 = e1 !== undefined ? enabled_features.find(([name]) => name === f2) : undefined;
    if (e1 !== undefined && e2 !== undefined) {
      const [f1_name, f1_span] = e1;
      const [f2_name, f2_span] = e2;
      const spans = [f1_span, f2_span];
      sess.dcx().emit_err(
        diagnostics.IncompatibleFeatures_diagnostic({
          spans,
          f1: f1_name,
          f2: f2_name,
        }),
      );
    }
  }
}

// rustc: compiler/rustc_ast_passes/src/feature_gate.rs:656 check_dependent_features
function check_dependent_features(sess: Session, features: Features): void {
  for (const [parent, children] of DEPENDENT_FEATURES.filter(([parent, children]) => features.enabled(parent) && !check_enabled(features, children))) {
    const parent_span = unwrap(features.enabled_features_iter_stable_order().find(([name]) => name === parent))[1];
    // FIXME: should probably format this in fluent instead of here
    const missing = format(features, children);
    sess.dcx().emit_err(diagnostics.MissingDependentFeatures_diagnostic({ parent_span, parent, missing }));
  }

  // rustc: compiler/rustc_ast_passes/src/feature_gate.rs:671 check_enabled
  function check_enabled(features: Features, feature: DependentFeature): boolean {
    switch (feature.$) {
      case "And": {
        const children = feature._0;
        return children.every((child) => check_enabled(features, child));
      }
      case "Or": {
        const children = feature._0;
        return children.some((child) => check_enabled(features, child));
      }
      case "Leaf":
        return features.enabled(feature._0);
    }
  }

  // rustc: compiler/rustc_ast_passes/src/feature_gate.rs:683 format
  function format(features: Features, feature: DependentFeature): string {
    // FIXME: parentheses/precedence
    switch (feature.$) {
      case "And": {
        const children = feature._0;
        return children
          .filter((child) => !check_enabled(features, child))
          .map((child) => format(features, child))
          .join(" and ");
      }
      case "Or": {
        const children = feature._0;
        return children.map((child) => format(features, child)).join(" or ");
      }
      case "Leaf":
        return `\`${Symbol.as_str(feature._0)}\``;
    }
  }
}

// rustc: compiler/rustc_ast_passes/src/feature_gate.rs:702 warn_next_solver_and_gce
function warn_next_solver_and_gce(sess: Session, features: Features): void {
  if (sess.opts.unstable_opts.next_solver !== "Globally") {
    return;
  }

  // Warn people who use GCE and -Znext-solver=globally
  // that their trait solver was downgraded to -Znext-solver=coherence
  const gce_span = features.enabled_lang_features().find((feat) => feat.gate_name === sym.generic_const_exprs)?.attr_sp;
  if (gce_span !== undefined) {
    sess.dcx().emit_warn(diagnostics.NextSolverDisabledForGenericConstExprs_diagnostic({ span: gce_span }));
  }
}

// rustc: compiler/rustc_ast_passes/src/feature_gate.rs:720 warn_next_solver_and_higher_ranked_assumptions
function warn_next_solver_and_higher_ranked_assumptions(sess: Session): void {
  // Warn people who use -Zhigher-ranked-assumptions and -Znext-solver=globally
  // that their trait solver was downgraded to -Znext-solver=coherence
  if (sess.opts.unstable_opts.next_solver === "Globally" && sess.opts.unstable_opts.higher_ranked_assumptions) {
    sess.dcx().emit_warn(diagnostics.NextSolverDisabledForHigherRankedAssumptions_diagnostic({}));
  }
}

// rustc: compiler/rustc_ast_passes/src/feature_gate.rs:730 check_features_requiring_new_solver
function check_features_requiring_new_solver(sess: Session, features: Features): void {
  if (sess.opts.unstable_opts.next_solver === "Globally") {
    return;
  }

  // Require the new solver with GCA, because the old solver can't implement GCA correctly as it
  // does not support normalization obligations for free and inherent consts.
  const gca_span = features.enabled_lang_features().find((feat) => feat.gate_name === sym.gca_const_items)?.attr_sp;
  if (gca_span !== undefined) {
    // #[allow(rustc::symbol_intern_string_literal)]
    sess.dcx().emit_err(
      diagnostics.MissingDependentFeatures_diagnostic({
        parent_span: gca_span,
        parent: sym.gca_const_items,
        missing: "-Znext-solver=globally",
      }),
    );
  }
}
