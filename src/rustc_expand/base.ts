// Port of compiler/rustc_expand/src/base.rs
//
// PORT: trait representations (PORTING §5/§8):
// - `MultiItemModifier`, `BangProcMacro`, `AttrProcMacro`, `TTMacroExpander`, `GlobDelegationExpander`,
//   `ResolverExpand`, `LintStoreExpand` are interfaces (`dyn Trait` objects). The blanket impls for
//   closures (`impl<F: Fn(..)> Trait for F`) are `<Trait>_from_fn(f)`, which wrap a function into an
//   impl object. Provided methods live in `<Trait>_provided` helpers.
// - `MacResult` (`self: Box<Self>` methods, all provided) is an interface plus the abstract base class
//   `MacResult_provided` holding the defaults; implementors `extend` it and override. (Implementors that
//   override every method, like `ParserAnyMacro`, may `implements MacResult` directly.)
// - `ExpandResult<T, U>` is `{ $: "Ready", _0 } | { $: "Retry", _0 }`; `()` payloads are `undefined`.
// - `SmallVec<[T; 1]>`/`ThinVec<T>`/`Vec<T>` -> `T[]`; `Box<T>`/`Arc<T>`/`Rc<T>` -> `T`; `PathBuf` -> string.
// - `ExtCtxt`'s builder methods (build.rs) are attached by build.ts (`declare module "./base.ts"`); lib.ts
//   loads base.ts first, then build.ts.
import {
  type Arm,
  type AssocItem,
  type AttrVec,
  type Attribute,
  CRATE_NODE_ID,
  type Crate,
  clone_Arm,
  clone_AssocItemKind,
  clone_Crate,
  clone_Expr,
  clone_ExprField,
  clone_FieldDef,
  clone_ForeignItemKind,
  clone_GenericParam,
  clone_Item,
  clone_ItemKind,
  clone_Param,
  clone_PatField,
  clone_Stmt,
  clone_Variant,
  clone_WherePredicate,
  DUMMY_NODE_ID,
  debug_Arm,
  debug_AssocItemKind,
  debug_Crate,
  debug_Expr,
  debug_ExprField,
  debug_FieldDef,
  debug_ForeignItemKind,
  debug_GenericParam,
  debug_Item,
  debug_ItemKind,
  debug_Param,
  debug_PatField,
  debug_Stmt,
  debug_Variant,
  debug_WherePredicate,
  Expr,
  type ExprField,
  type FieldDef,
  type ForeignItem,
  type GenericParam,
  HasAttrs,
  HasTokens,
  type Item,
  type MetaItem,
  type NodeId,
  type Param,
  Pat,
  type PatField,
  PatKind,
  type Path,
  type Safety,
  Stmt,
  Ty,
  type Variant,
  type WherePredicate,
} from "../rustc_ast/lib.ts";
import { MarkedAttrs } from "../rustc_ast/attr/mod.ts";
import { TokenStream } from "../rustc_ast/tokenstream.ts";
import { type AssocCtxt, debug_AssocCtxt, type Visitor } from "../rustc_ast/visit.ts";
import {
  type Attribute as attrs_Attribute,
  type CfgEntry,
  type Deprecation,
  find_attr,
  type Stability,
} from "../rustc_attr_ir/lib.ts";
import type { BufferedEarlyLint } from "../rustc_errors/decorate_diag.gen.ts";
import type { DiagCtxtHandle } from "../rustc_errors/lib.ts";
import type { Features } from "../rustc_feature/lib.ts";
import { MacroKinds } from "../rustc_hir/def.ts";
import type { RegisteredTools } from "../rustc_lint_defs/lib.ts";
import { MACRO_ARGUMENTS, parser } from "../rustc_parse/lib.ts";
import type { ParseSess } from "../rustc_session/parse.ts";
import type { Session } from "../rustc_session/session.ts";
import type { CrateNum, DefId, LocalDefId, ModId } from "../rustc_span/def_id.ts";
import type { Edition } from "../rustc_span/edition.ts";
import { type AstPass, ExpnData, ExpnKind, LocalExpnId, type MacroKind } from "../rustc_span/hygiene.ts";
import { DUMMY_SP, type ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import type { SourceMap } from "../rustc_span/source_map.ts";
import { debug_Ident, type Ident, type Symbol } from "../rustc_span/symbol.ts";
import { CollapseMacroDebuginfo, CollapseMacroDebuginfo_discriminant, type Limit } from "../rustc_structures/lib.ts";
import { type Debug, debug_str, debug_struct, debug_tuple, debug_vec } from "../std/fmt.ts";
import { assert, panic, unreachable } from "../std/panic.ts";
import { Ok, type Result } from "../std/result.ts";
import { MacroBodyStability_diagnostic, TraceMacro_diagnostic } from "./diagnostics.ts";
import type { AstFragment, ExpansionConfig, Invocation } from "./expand.ts";
import { MacroExpander } from "./expand.ts";
import { type MacroRulesMacroExpander, ParserAnyMacro } from "./mbe/macro_rules.ts";
import { clone_DirOwnership, type DirOwnership } from "./module.ts";
import type { MacroStat } from "./stats.ts";

type Parser = parser.Parser;

/// This type encapsulates every AST node that can have attributes, i.e. those
/// nodes with a non-trivial implementation of `HasAttrs`.
///
/// When adding new variants, make sure to adjust the `visit_*` / `flat_map_*`
/// calls in `InvocationCollector` to use `assign_id!`
// #[derive(Debug, Clone)]
export type Annotatable =
  | { readonly $: "Item"; _0: Item }
  | { readonly $: "AssocItem"; _0: AssocItem; _1: AssocCtxt }
  | { readonly $: "ForeignItem"; _0: ForeignItem }
  | { readonly $: "Stmt"; _0: Stmt }
  | { readonly $: "Expr"; _0: Expr }
  | { readonly $: "Arm"; _0: Arm }
  | { readonly $: "ExprField"; _0: ExprField }
  | { readonly $: "PatField"; _0: PatField }
  | { readonly $: "GenericParam"; _0: GenericParam }
  | { readonly $: "Param"; _0: Param }
  | { readonly $: "FieldDef"; _0: FieldDef }
  | { readonly $: "Variant"; _0: Variant }
  | { readonly $: "WherePredicate"; _0: WherePredicate }
  | { readonly $: "Crate"; _0: Crate };

export const Annotatable = {
  // rustc: compiler/rustc_expand/src/base.rs:61 span
  span(self: Annotatable): Span {
    switch (self.$) {
      case "Item":
        return self._0.span;
      case "AssocItem":
        return self._0.span;
      case "ForeignItem":
        return self._0.span;
      case "Stmt":
        return self._0.span;
      case "Expr":
        return self._0.span;
      case "Arm":
        return self._0.span;
      case "ExprField":
        return self._0.span;
      case "PatField":
        return self._0.pat.span;
      case "GenericParam":
        return self._0.ident.span;
      case "Param":
        return self._0.span;
      case "FieldDef":
        return self._0.span;
      case "Variant":
        return self._0.span;
      case "WherePredicate":
        return self._0.span;
      case "Crate":
        return self._0.spans.inner_span;
    }
  },

  // rustc: compiler/rustc_expand/src/base.rs:80 visit_attrs
  visit_attrs(self: Annotatable, f: (attrs: AttrVec) => void): void {
    switch (self.$) {
      case "Item":
        return HasAttrs.Item.visit_attrs(self._0, f);
      case "AssocItem":
        return HasAttrs.AssocItem.visit_attrs(self._0, f);
      case "ForeignItem":
        return HasAttrs.ForeignItem.visit_attrs(self._0, f);
      case "Stmt":
        return HasAttrs.Stmt.visit_attrs(self._0, f);
      case "Expr":
        return HasAttrs.Expr.visit_attrs(self._0, f);
      case "Arm":
        return HasAttrs.Arm.visit_attrs(self._0, f);
      case "ExprField":
        return HasAttrs.ExprField.visit_attrs(self._0, f);
      case "PatField":
        return HasAttrs.PatField.visit_attrs(self._0, f);
      case "GenericParam":
        return HasAttrs.GenericParam.visit_attrs(self._0, f);
      case "Param":
        return HasAttrs.Param.visit_attrs(self._0, f);
      case "FieldDef":
        return HasAttrs.FieldDef.visit_attrs(self._0, f);
      case "Variant":
        return HasAttrs.Variant.visit_attrs(self._0, f);
      case "WherePredicate":
        return HasAttrs.WherePredicate.visit_attrs(self._0, f);
      case "Crate":
        return HasAttrs.Crate.visit_attrs(self._0, f);
    }
  },

  // rustc: compiler/rustc_expand/src/base.rs:99 visit_with
  visit_with<R>(self: Annotatable, visitor: Visitor<R>): R {
    switch (self.$) {
      case "Item":
        return visitor.visit_item(self._0);
      case "AssocItem":
        return visitor.visit_assoc_item(self._0, self._1);
      case "ForeignItem":
        return visitor.visit_foreign_item(self._0);
      case "Stmt":
        return visitor.visit_stmt(self._0);
      case "Expr":
        return visitor.visit_expr(self._0);
      case "Arm":
        return visitor.visit_arm(self._0);
      case "ExprField":
        return visitor.visit_expr_field(self._0);
      case "PatField":
        return visitor.visit_pat_field(self._0);
      case "GenericParam":
        return visitor.visit_generic_param(self._0);
      case "Param":
        return visitor.visit_param(self._0);
      case "FieldDef":
        return visitor.visit_field_def(self._0);
      case "Variant":
        return visitor.visit_variant(self._0);
      case "WherePredicate":
        return visitor.visit_where_predicate(self._0);
      case "Crate":
        return visitor.visit_crate(self._0);
    }
  },

  /// Converts the `Annotatable` to a token stream, e.g. to hand to a proc macro.
  // rustc: compiler/rustc_expand/src/base.rs:119 to_tokens
  to_tokens(self: Annotatable): TokenStream {
    switch (self.$) {
      case "Item":
        return TokenStream.from_ast(self._0, { tokens: HasTokens.Item.tokens, attrs: HasAttrs.Item.attrs, debug: debug_Item_ });
      case "AssocItem":
        return TokenStream.from_ast(self._0, {
          tokens: HasTokens.AssocItem.tokens,
          attrs: HasAttrs.AssocItem.attrs,
          debug: debug_AssocItem,
        });
      case "ForeignItem":
        return TokenStream.from_ast(self._0, {
          tokens: HasTokens.ForeignItem.tokens,
          attrs: HasAttrs.ForeignItem.attrs,
          debug: debug_ForeignItem,
        });
      case "Stmt": {
        const node = self._0;
        assert(!(node.kind.$ === "Empty"), "assertion failed: !matches!(node.kind, ast::StmtKind::Empty)");
        return TokenStream.from_ast(node, { tokens: HasTokens.Stmt.tokens, attrs: HasAttrs.Stmt.attrs, debug: debug_Stmt });
      }
      case "Expr":
        return TokenStream.from_ast(self._0, { tokens: HasTokens.Expr.tokens, attrs: HasAttrs.Expr.attrs, debug: debug_Expr });
      case "Arm":
      case "ExprField":
      case "PatField":
      case "GenericParam":
      case "Param":
      case "FieldDef":
      case "Variant":
      case "WherePredicate":
      case "Crate":
        return panic("unexpected annotatable");
    }
  },

  // rustc: compiler/rustc_expand/src/base.rs:141 expect_item
  expect_item(self: Annotatable): Item {
    if (self.$ === "Item") return self._0;
    return panic("expected Item");
  },

  // rustc: compiler/rustc_expand/src/base.rs:148 expect_trait_item
  expect_trait_item(self: Annotatable): AssocItem {
    if (self.$ === "AssocItem" && self._1.$ === "Trait") return self._0;
    return panic("expected trait item");
  },

  // rustc: compiler/rustc_expand/src/base.rs:155 expect_impl_item
  expect_impl_item(self: Annotatable): AssocItem {
    if (self.$ === "AssocItem" && self._1.$ === "Impl") return self._0;
    return panic("expected impl item");
  },

  // rustc: compiler/rustc_expand/src/base.rs:162 expect_foreign_item
  expect_foreign_item(self: Annotatable): ForeignItem {
    if (self.$ === "ForeignItem") return self._0;
    return panic("expected foreign item");
  },

  // rustc: compiler/rustc_expand/src/base.rs:169 expect_stmt
  expect_stmt(self: Annotatable): Stmt {
    if (self.$ === "Stmt") return self._0;
    return panic("expected statement");
  },

  // rustc: compiler/rustc_expand/src/base.rs:176 expect_expr
  expect_expr(self: Annotatable): Expr {
    if (self.$ === "Expr") return self._0;
    return panic("expected expression");
  },

  // rustc: compiler/rustc_expand/src/base.rs:183 expect_arm
  expect_arm(self: Annotatable): Arm {
    if (self.$ === "Arm") return self._0;
    return panic("expected match arm");
  },

  // rustc: compiler/rustc_expand/src/base.rs:190 expect_expr_field
  expect_expr_field(self: Annotatable): ExprField {
    if (self.$ === "ExprField") return self._0;
    return panic("expected field");
  },

  // rustc: compiler/rustc_expand/src/base.rs:197 expect_pat_field
  expect_pat_field(self: Annotatable): PatField {
    if (self.$ === "PatField") return self._0;
    return panic("expected field pattern");
  },

  // rustc: compiler/rustc_expand/src/base.rs:204 expect_generic_param
  expect_generic_param(self: Annotatable): GenericParam {
    if (self.$ === "GenericParam") return self._0;
    return panic("expected generic parameter");
  },

  // rustc: compiler/rustc_expand/src/base.rs:211 expect_param
  expect_param(self: Annotatable): Param {
    if (self.$ === "Param") return self._0;
    return panic("expected parameter");
  },

  // rustc: compiler/rustc_expand/src/base.rs:218 expect_field_def
  expect_field_def(self: Annotatable): FieldDef {
    if (self.$ === "FieldDef") return self._0;
    return panic("expected struct field");
  },

  // rustc: compiler/rustc_expand/src/base.rs:225 expect_variant
  expect_variant(self: Annotatable): Variant {
    if (self.$ === "Variant") return self._0;
    return panic("expected variant");
  },

  // rustc: compiler/rustc_expand/src/base.rs:232 expect_where_predicate
  expect_where_predicate(self: Annotatable): WherePredicate {
    if (self.$ === "WherePredicate") return self._0;
    return panic("expected where predicate");
  },

  // rustc: compiler/rustc_expand/src/base.rs:239 expect_crate
  expect_crate(self: Annotatable): Crate {
    if (self.$ === "Crate") return self._0;
    return panic("expected krate");
  },
};

const debug_Item_: Debug<Item> = (v, f) => debug_Item(v, f, debug_ItemKind);
const debug_AssocItem: Debug<AssocItem> = (v, f) => debug_Item(v, f, debug_AssocItemKind);
const debug_ForeignItem: Debug<ForeignItem> = (v, f) => debug_Item(v, f, debug_ForeignItemKind);

/// `#[derive(Debug)]` (`Box<T>` prints as `T`).
export const debug_Annotatable: Debug<Annotatable> = (v, f) => {
  switch (v.$) {
    case "Item":
      return debug_tuple(f, "Item", [debug_Item_(v._0, f)]);
    case "AssocItem":
      return debug_tuple(f, "AssocItem", [debug_AssocItem(v._0, f), debug_AssocCtxt(v._1, f)]);
    case "ForeignItem":
      return debug_tuple(f, "ForeignItem", [debug_ForeignItem(v._0, f)]);
    case "Stmt":
      return debug_tuple(f, "Stmt", [debug_Stmt(v._0, f)]);
    case "Expr":
      return debug_tuple(f, "Expr", [debug_Expr(v._0, f)]);
    case "Arm":
      return debug_tuple(f, "Arm", [debug_Arm(v._0, f)]);
    case "ExprField":
      return debug_tuple(f, "ExprField", [debug_ExprField(v._0, f)]);
    case "PatField":
      return debug_tuple(f, "PatField", [debug_PatField(v._0, f)]);
    case "GenericParam":
      return debug_tuple(f, "GenericParam", [debug_GenericParam(v._0, f)]);
    case "Param":
      return debug_tuple(f, "Param", [debug_Param(v._0, f)]);
    case "FieldDef":
      return debug_tuple(f, "FieldDef", [debug_FieldDef(v._0, f)]);
    case "Variant":
      return debug_tuple(f, "Variant", [debug_Variant(v._0, f)]);
    case "WherePredicate":
      return debug_tuple(f, "WherePredicate", [debug_WherePredicate(v._0, f)]);
    case "Crate":
      return debug_tuple(f, "Crate", [debug_Crate(v._0, f)]);
  }
};

/// `#[derive(Clone)]` (deep: `Box<T>` clones its contents).
export function clone_Annotatable(v: Annotatable): Annotatable {
  switch (v.$) {
    case "Item":
      return { $: "Item", _0: clone_Item(v._0, clone_ItemKind) };
    case "AssocItem":
      // PORT: `AssocCtxt` is Copy and never edited in place; the object is shared.
      return { $: "AssocItem", _0: clone_Item(v._0, clone_AssocItemKind), _1: v._1 };
    case "ForeignItem":
      return { $: "ForeignItem", _0: clone_Item(v._0, clone_ForeignItemKind) };
    case "Stmt":
      return { $: "Stmt", _0: clone_Stmt(v._0) };
    case "Expr":
      return { $: "Expr", _0: clone_Expr(v._0) };
    case "Arm":
      return { $: "Arm", _0: clone_Arm(v._0) };
    case "ExprField":
      return { $: "ExprField", _0: clone_ExprField(v._0) };
    case "PatField":
      return { $: "PatField", _0: clone_PatField(v._0) };
    case "GenericParam":
      return { $: "GenericParam", _0: clone_GenericParam(v._0) };
    case "Param":
      return { $: "Param", _0: clone_Param(v._0) };
    case "FieldDef":
      return { $: "FieldDef", _0: clone_FieldDef(v._0) };
    case "Variant":
      return { $: "Variant", _0: clone_Variant(v._0) };
    case "WherePredicate":
      return { $: "WherePredicate", _0: clone_WherePredicate(v._0) };
    case "Crate":
      return { $: "Crate", _0: clone_Crate(v._0) };
  }
}

/// Result of an expansion that may need to be retried.
/// Consider using this for non-`MultiItemModifier` expanders as well.
export type ExpandResult<T, U> =
  /// Expansion produced a result (possibly dummy).
  | { readonly $: "Ready"; _0: T }
  /// Expansion could not produce a result and needs to be retried.
  | { readonly $: "Retry"; _0: U };

export const ExpandResult = {
  // rustc: compiler/rustc_expand/src/base.rs:257 map
  map<T, U, E>(self: ExpandResult<T, U>, f: (t: T) => E): ExpandResult<E, U> {
    switch (self.$) {
      case "Ready":
        return { $: "Ready", _0: f(self._0) };
      case "Retry":
        return { $: "Retry", _0: self._0 };
    }
  },
};

export type MacroExpanderResult = ExpandResult<MacResult, undefined>;

export const MacroExpanderResult = {
  /// Creates a [`MacroExpanderResult::Ready`] from a [`TokenStream`].
  ///
  /// The `TokenStream` is forwarded without any expansion.
  // rustc: compiler/rustc_expand/src/base.rs:269 from_tts
  from_tts(cx: ExtCtxt, tts: TokenStream, site_span: Span, arm_span: Span, macro_ident: Ident): MacroExpanderResult {
    // Emit SEMICOLON_IN_EXPRESSIONS_FROM_MACROS here, rather than the NON_LOCAL version.
    const is_local = true;
    const parser = ParserAnyMacro.from_tts(cx, tts, site_span, arm_span, is_local, macro_ident, [], []);
    return { $: "Ready", _0: parser };
  },
};

// rustc-trait: compiler/rustc_expand/src/base.rs:284 MultiItemModifier
export interface MultiItemModifier {
  /// `meta_item` is the attribute, and `item` is the item being modified.
  // rustc: compiler/rustc_expand/src/base.rs:286 expand
  expand(
    ecx: ExtCtxt,
    span: Span,
    meta_item: MetaItem,
    item: Annotatable,
    is_derive_const: boolean,
  ): ExpandResult<Annotatable[], Annotatable>;
}

/** `impl<F> MultiItemModifier for F where F: Fn(&mut ExtCtxt<'_>, Span, &ast::MetaItem, Annotatable) -> Vec<Annotatable>` */
export function MultiItemModifier_from_fn(
  f: (ecx: ExtCtxt, span: Span, meta_item: MetaItem, item: Annotatable) => Annotatable[],
): MultiItemModifier {
  return {
    // rustc: compiler/rustc_expand/src/base.rs:300 expand
    expand(
      ecx: ExtCtxt,
      span: Span,
      meta_item: MetaItem,
      item: Annotatable,
      _is_derive_const: boolean,
    ): ExpandResult<Annotatable[], Annotatable> {
      return { $: "Ready", _0: f(ecx, span, meta_item, item) };
    },
  };
}

// rustc-trait: compiler/rustc_expand/src/base.rs:312 BangProcMacro
export interface BangProcMacro {
  // rustc: compiler/rustc_expand/src/base.rs:313 expand
  expand(ecx: ExtCtxt, span: Span, ts: TokenStream): Result<TokenStream, ErrorGuaranteed>;
}

/** `impl<F> BangProcMacro for F where F: Fn(&mut ExtCtxt<'_>, Span, TokenStream) -> Result<TokenStream, ErrorGuaranteed>` */
export function BangProcMacro_from_fn(
  f: (ecx: ExtCtxt, span: Span, ts: TokenStream) => Result<TokenStream, ErrorGuaranteed>,
): BangProcMacro {
  return {
    // rustc: compiler/rustc_expand/src/base.rs:325 expand
    expand(ecx: ExtCtxt, span: Span, ts: TokenStream): Result<TokenStream, ErrorGuaranteed> {
      // FIXME setup implicit context in TLS before calling self.
      return f(ecx, span, ts);
    },
  };
}

// rustc-trait: compiler/rustc_expand/src/base.rs:336 AttrProcMacro
export interface AttrProcMacro {
  // rustc: compiler/rustc_expand/src/base.rs:337 expand
  expand(ecx: ExtCtxt, span: Span, annotation: TokenStream, annotated: TokenStream): Result<TokenStream, ErrorGuaranteed>;

  /** (provided) */
  expand_with_safety(
    ecx: ExtCtxt,
    safety: Safety,
    span: Span,
    annotation: TokenStream,
    annotated: TokenStream,
  ): Result<TokenStream, ErrorGuaranteed>;
}

/** The provided items of `AttrProcMacro`; an impl lists its required items and any overrides. */
export function AttrProcMacro_provided(
  impl: Omit<AttrProcMacro, "expand_with_safety"> & Partial<Pick<AttrProcMacro, "expand_with_safety">>,
): AttrProcMacro {
  return {
    // Default implementation for safe attributes; override if the attribute can be unsafe.
    // rustc: compiler/rustc_expand/src/base.rs:346 expand_with_safety
    expand_with_safety(
      this: AttrProcMacro,
      ecx: ExtCtxt,
      safety: Safety,
      span: Span,
      annotation: TokenStream,
      annotated: TokenStream,
    ): Result<TokenStream, ErrorGuaranteed> {
      if (safety.$ === "Unsafe") {
        const span = safety._0;
        ecx.dcx().span_err(span, "unnecessary `unsafe` on safe attribute");
      }
      return this.expand(ecx, span, annotation, annotated);
    },

    ...impl,
  };
}

/** `impl<F> AttrProcMacro for F where F: Fn(TokenStream, TokenStream) -> TokenStream` */
export function AttrProcMacro_from_fn(f: (annotation: TokenStream, annotated: TokenStream) => TokenStream): AttrProcMacro {
  return AttrProcMacro_provided({
    // rustc: compiler/rustc_expand/src/base.rs:365 expand
    expand(_ecx: ExtCtxt, _span: Span, annotation: TokenStream, annotated: TokenStream): Result<TokenStream, ErrorGuaranteed> {
      // FIXME setup implicit context in TLS before calling self.
      return Ok(f(annotation, annotated));
    },
  });
}

/// Represents a thing that maps token trees to Macro Results
// rustc-trait: compiler/rustc_expand/src/base.rs:378 TTMacroExpander
export interface TTMacroExpander {
  // rustc: compiler/rustc_expand/src/base.rs:379 expand
  expand(ecx: ExtCtxt, span: Span, input: TokenStream): MacroExpanderResult;
}

export type MacroExpanderFn = (ecx: ExtCtxt, span: Span, input: TokenStream) => MacroExpanderResult;

/** `impl<F: 'static> TTMacroExpander for F where F: for<'cx> Fn(&'cx mut ExtCtxt<'_>, Span, TokenStream) -> MacroExpanderResult<'cx>` */
export function TTMacroExpander_from_fn(f: MacroExpanderFn): TTMacroExpander {
  return {
    // rustc: compiler/rustc_expand/src/base.rs:396 expand
    expand(ecx: ExtCtxt, span: Span, input: TokenStream): MacroExpanderResult {
      return f(ecx, span, input);
    },
  };
}

// rustc-trait: compiler/rustc_expand/src/base.rs:406 GlobDelegationExpander
export interface GlobDelegationExpander {
  // rustc: compiler/rustc_expand/src/base.rs:407 expand
  expand(ecx: ExtCtxt): ExpandResult<[Ident, Ident | undefined][], undefined>;
}

// rustc: compiler/rustc_expand/src/base.rs:410 make_stmts_default
function make_stmts_default(expr: Expr | undefined): Stmt[] | undefined {
  return expr === undefined ? undefined : [new Stmt(DUMMY_NODE_ID, { $: "Expr", _0: expr }, expr.span)];
}

/// The result of a macro expansion. The return values of the various
/// methods are spliced into the AST at the callsite of the macro.
// rustc-trait: compiler/rustc_expand/src/base.rs:418 MacResult
// PORT: every method is provided (see `MacResult_provided`); `self: Box<Self>` consumes the result, so each
// method is called at most once per value.
export interface MacResult {
  /** (provided) Creates an expression. */
  make_expr(): Expr | undefined;
  /** (provided) Creates zero or more items. */
  make_items(): Item[] | undefined;
  /** (provided) Creates zero or more impl items. */
  make_impl_items(): AssocItem[] | undefined;
  /** (provided) Creates zero or more impl items. */
  make_trait_impl_items(): AssocItem[] | undefined;
  /** (provided) Creates zero or more trait items. */
  make_trait_items(): AssocItem[] | undefined;
  /** (provided) Creates zero or more items in an `extern {}` block */
  make_foreign_items(): ForeignItem[] | undefined;
  /** (provided) Creates a pattern. */
  make_pat(): Pat | undefined;
  /** (provided) Creates zero or more statements. */
  make_stmts(): Stmt[] | undefined;
  /** (provided) */
  make_ty(): Ty | undefined;
  /** (provided) */
  make_arms(): Arm[] | undefined;
  /** (provided) */
  make_expr_fields(): ExprField[] | undefined;
  /** (provided) */
  make_pat_fields(): PatField[] | undefined;
  /** (provided) */
  make_generic_params(): GenericParam[] | undefined;
  /** (provided) */
  make_params(): Param[] | undefined;
  /** (provided) */
  make_field_defs(): FieldDef[] | undefined;
  /** (provided) */
  make_variants(): Variant[] | undefined;
  /** (provided) */
  make_where_predicates(): WherePredicate[] | undefined;
  /** (provided) */
  make_crate(): Crate | undefined;
}

/** The provided methods of `MacResult`, as a base class implementors extend. */
export abstract class MacResult_provided implements MacResult {
  /// Creates an expression.
  // rustc: compiler/rustc_expand/src/base.rs:420 make_expr
  make_expr(): Expr | undefined {
    return undefined;
  }

  /// Creates zero or more items.
  // rustc: compiler/rustc_expand/src/base.rs:425 make_items
  make_items(): Item[] | undefined {
    return undefined;
  }

  /// Creates zero or more impl items.
  // rustc: compiler/rustc_expand/src/base.rs:430 make_impl_items
  make_impl_items(): AssocItem[] | undefined {
    return undefined;
  }

  /// Creates zero or more impl items.
  // rustc: compiler/rustc_expand/src/base.rs:435 make_trait_impl_items
  make_trait_impl_items(): AssocItem[] | undefined {
    return undefined;
  }

  /// Creates zero or more trait items.
  // rustc: compiler/rustc_expand/src/base.rs:440 make_trait_items
  make_trait_items(): AssocItem[] | undefined {
    return undefined;
  }

  /// Creates zero or more items in an `extern {}` block
  // rustc: compiler/rustc_expand/src/base.rs:445 make_foreign_items
  make_foreign_items(): ForeignItem[] | undefined {
    return undefined;
  }

  /// Creates a pattern.
  // rustc: compiler/rustc_expand/src/base.rs:450 make_pat
  make_pat(): Pat | undefined {
    return undefined;
  }

  /// Creates zero or more statements.
  ///
  /// By default this attempts to create an expression statement,
  /// returning None if that fails.
  // rustc: compiler/rustc_expand/src/base.rs:458 make_stmts
  make_stmts(): Stmt[] | undefined {
    return make_stmts_default(this.make_expr());
  }

  // rustc: compiler/rustc_expand/src/base.rs:462 make_ty
  make_ty(): Ty | undefined {
    return undefined;
  }

  // rustc: compiler/rustc_expand/src/base.rs:466 make_arms
  make_arms(): Arm[] | undefined {
    return undefined;
  }

  // rustc: compiler/rustc_expand/src/base.rs:470 make_expr_fields
  make_expr_fields(): ExprField[] | undefined {
    return undefined;
  }

  // rustc: compiler/rustc_expand/src/base.rs:474 make_pat_fields
  make_pat_fields(): PatField[] | undefined {
    return undefined;
  }

  // rustc: compiler/rustc_expand/src/base.rs:478 make_generic_params
  make_generic_params(): GenericParam[] | undefined {
    return undefined;
  }

  // rustc: compiler/rustc_expand/src/base.rs:482 make_params
  make_params(): Param[] | undefined {
    return undefined;
  }

  // rustc: compiler/rustc_expand/src/base.rs:486 make_field_defs
  make_field_defs(): FieldDef[] | undefined {
    return undefined;
  }

  // rustc: compiler/rustc_expand/src/base.rs:490 make_variants
  make_variants(): Variant[] | undefined {
    return undefined;
  }

  // rustc: compiler/rustc_expand/src/base.rs:494 make_where_predicates
  make_where_predicates(): WherePredicate[] | undefined {
    return undefined;
  }

  // rustc: compiler/rustc_expand/src/base.rs:498 make_crate
  make_crate(): Crate | undefined {
    // Fn-like macros cannot produce a crate.
    return unreachable();
  }
}

/// `MacResult` implementation for the common case where you've already
/// built each form of AST that you might return.
// #[derive(Default)]
export class MacEager extends MacResult_provided {
  constructor(
    public expr: Expr | undefined = undefined,
    public items: Item[] | undefined = undefined,
    public ty: Ty | undefined = undefined,
  ) {
    super();
  }

  // rustc: compiler/rustc_expand/src/base.rs:514 expr
  static expr(v: Expr): MacResult {
    return new MacEager(v, undefined, undefined);
  }

  // rustc: compiler/rustc_expand/src/base.rs:518 items
  static items(v: Item[]): MacResult {
    return new MacEager(undefined, v, undefined);
  }

  // rustc: compiler/rustc_expand/src/base.rs:522 ty
  static ty(v: Ty): MacResult {
    return new MacEager(undefined, undefined, v);
  }

  // impl MacResult for MacEager
  // rustc: compiler/rustc_expand/src/base.rs:528 make_expr
  override make_expr(): Expr | undefined {
    return this.expr;
  }

  // rustc: compiler/rustc_expand/src/base.rs:532 make_items
  override make_items(): Item[] | undefined {
    return this.items;
  }

  // rustc: compiler/rustc_expand/src/base.rs:536 make_pat
  override make_pat(): Pat | undefined {
    const e = this.expr;
    if (e !== undefined) {
      if (e.kind.$ === "Lit" || e.kind.$ === "IncludedBytes") {
        return new Pat(DUMMY_NODE_ID, { $: "Expr", _0: e }, e.span);
      }
    }
    return undefined;
  }

  // rustc: compiler/rustc_expand/src/base.rs:549 make_ty
  override make_ty(): Ty | undefined {
    return this.ty;
  }
}

/// Fill-in macro expansion result, to allow compilation to continue
/// after hitting errors.
// #[derive(Copy, Clone)]
export class DummyResult extends MacResult_provided {
  constructor(
    private guar: ErrorGuaranteed | undefined,
    private span: Span,
  ) {
    super();
  }

  /// Creates a default MacResult that can be anything.
  ///
  /// Use this as a return value after hitting any errors and
  /// calling `span_err`.
  // rustc: compiler/rustc_expand/src/base.rs:567 any
  static any(span: Span, guar: ErrorGuaranteed): MacResult {
    return new DummyResult(guar, span);
  }

  /// Same as `any`, but must be a valid fragment, not error.
  // rustc: compiler/rustc_expand/src/base.rs:572 any_valid
  static any_valid(span: Span): MacResult {
    return new DummyResult(undefined, span);
  }

  /// A plain dummy expression.
  // rustc: compiler/rustc_expand/src/base.rs:577 raw_expr
  static raw_expr(sp: Span, guar: ErrorGuaranteed | undefined): Expr {
    return new Expr(
      DUMMY_NODE_ID,
      guar !== undefined ? { $: "Err", _0: guar } : { $: "Tup", _0: [] },
      sp,
      [],
      undefined,
    );
  }

  // impl MacResult for DummyResult
  // rustc: compiler/rustc_expand/src/base.rs:593 make_expr
  override make_expr(): Expr | undefined {
    return DummyResult.raw_expr(this.span, this.guar);
  }

  // rustc: compiler/rustc_expand/src/base.rs:597 make_pat
  override make_pat(): Pat | undefined {
    return new Pat(DUMMY_NODE_ID, PatKind.Wild, this.span);
  }

  // rustc: compiler/rustc_expand/src/base.rs:601 make_items
  override make_items(): Item[] | undefined {
    return [];
  }

  // rustc: compiler/rustc_expand/src/base.rs:605 make_impl_items
  override make_impl_items(): AssocItem[] | undefined {
    return [];
  }

  // rustc: compiler/rustc_expand/src/base.rs:609 make_trait_impl_items
  override make_trait_impl_items(): AssocItem[] | undefined {
    return [];
  }

  // rustc: compiler/rustc_expand/src/base.rs:613 make_trait_items
  override make_trait_items(): AssocItem[] | undefined {
    return [];
  }

  // rustc: compiler/rustc_expand/src/base.rs:617 make_foreign_items
  override make_foreign_items(): ForeignItem[] | undefined {
    return [];
  }

  // rustc: compiler/rustc_expand/src/base.rs:621 make_stmts
  override make_stmts(): Stmt[] | undefined {
    return [new Stmt(DUMMY_NODE_ID, { $: "Expr", _0: DummyResult.raw_expr(this.span, this.guar) }, this.span)];
  }

  // rustc: compiler/rustc_expand/src/base.rs:629 make_ty
  override make_ty(): Ty | undefined {
    // FIXME(nnethercote): you might expect `ast::TyKind::Dummy` to be used here, but some
    // values produced here end up being lowered to HIR, which `ast::TyKind::Dummy` does not
    // support, so we use an empty tuple instead.
    return new Ty(DUMMY_NODE_ID, { $: "Tup", _0: [] }, this.span);
  }

  // rustc: compiler/rustc_expand/src/base.rs:640 make_arms
  override make_arms(): Arm[] | undefined {
    return [];
  }

  // rustc: compiler/rustc_expand/src/base.rs:644 make_expr_fields
  override make_expr_fields(): ExprField[] | undefined {
    return [];
  }

  // rustc: compiler/rustc_expand/src/base.rs:648 make_pat_fields
  override make_pat_fields(): PatField[] | undefined {
    return [];
  }

  // rustc: compiler/rustc_expand/src/base.rs:652 make_generic_params
  override make_generic_params(): GenericParam[] | undefined {
    return [];
  }

  // rustc: compiler/rustc_expand/src/base.rs:656 make_params
  override make_params(): Param[] | undefined {
    return [];
  }

  // rustc: compiler/rustc_expand/src/base.rs:660 make_field_defs
  override make_field_defs(): FieldDef[] | undefined {
    return [];
  }

  // rustc: compiler/rustc_expand/src/base.rs:664 make_variants
  override make_variants(): Variant[] | undefined {
    return [];
  }

  // rustc: compiler/rustc_expand/src/base.rs:668 make_crate
  override make_crate(): Crate | undefined {
    return {
      attrs: [],
      items: [],
      spans: { inner_span: DUMMY_SP, inject_use_span: DUMMY_SP },
      id: DUMMY_NODE_ID,
      is_placeholder: false,
    };
  }
}

/// A syntax extension kind.
// #[derive(Clone)] (`Arc` payloads are shared: `clone_SyntaxExtensionKind` copies the variant object)
export type SyntaxExtensionKind =
  /// A `macro_rules!` macro that can work as any `MacroKind`
  | { readonly $: "MacroRules"; _0: MacroRulesMacroExpander }
  /// A token-based function-like macro.
  | {
      readonly $: "Bang";
      /// An expander with signature TokenStream -> TokenStream.
      _0: BangProcMacro;
    }
  /// An AST-based function-like macro.
  | {
      readonly $: "LegacyBang";
      /// An expander with signature TokenStream -> AST.
      _0: TTMacroExpander;
    }
  /// A token-based attribute macro.
  | {
      readonly $: "Attr";
      /// An expander with signature (TokenStream, TokenStream) -> TokenStream.
      /// The first TokenStream is the attribute itself, the second is the annotated item.
      /// The produced TokenStream replaces the input TokenStream.
      _0: AttrProcMacro;
    }
  /// An AST-based attribute macro.
  | {
      readonly $: "LegacyAttr";
      /// An expander with signature (AST, AST) -> AST.
      /// The first AST fragment is the attribute itself, the second is the annotated item.
      /// The produced AST fragment replaces the input AST fragment.
      _0: MultiItemModifier;
    }
  /// A trivial attribute "macro" that does nothing,
  /// only keeps the attribute and marks it as inert,
  /// thus making it ineligible for further expansion.
  /// E.g. `#[default]`, `#[rustfmt::skip]`.
  | { readonly $: "NonMacroAttr" }
  /// A token-based derive macro.
  | {
      readonly $: "Derive";
      /// An expander with signature TokenStream -> TokenStream.
      /// The produced TokenStream is appended to the input TokenStream.
      ///
      /// FIXME: The text above describes how this should work. Currently it
      /// is handled identically to `LegacyDerive`. It should be migrated to
      /// a token-based representation like `Bang` and `Attr`, instead of
      /// using `MultiItemModifier`.
      _0: MultiItemModifier;
    }
  /// An AST-based derive macro.
  | {
      readonly $: "LegacyDerive";
      /// An expander with signature AST -> AST.
      /// The produced AST fragment is appended to the input AST fragment.
      _0: MultiItemModifier;
    }
  /// A glob delegation.
  ///
  /// This is for delegated function implementations, and has nothing to do with glob imports.
  | { readonly $: "GlobDelegation"; _0: GlobDelegationExpander };

export const SyntaxExtensionKind = {
  NonMacroAttr: Object.freeze({ $: "NonMacroAttr" as const }),

  /// Returns `Some(expander)` for a macro usable as a `LegacyBang`; otherwise returns `None`
  ///
  /// This includes a `MacroRules` with function-like rules.
  // rustc: compiler/rustc_expand/src/base.rs:748 as_legacy_bang
  as_legacy_bang(self: SyntaxExtensionKind): TTMacroExpander | undefined {
    if (self.$ === "LegacyBang") return self._0;
    if (self.$ === "MacroRules" && MacroKinds.contains(self._0.kinds(), MacroKinds.BANG)) {
      return self._0.as_TTMacroExpander();
    }
    return undefined;
  },

  /// Returns `Some(expander)` for a macro usable as an `Attr`; otherwise returns `None`
  ///
  /// This includes a `MacroRules` with `attr` rules.
  // rustc: compiler/rustc_expand/src/base.rs:761 as_attr
  as_attr(self: SyntaxExtensionKind): AttrProcMacro | undefined {
    if (self.$ === "Attr") return self._0;
    if (self.$ === "MacroRules" && MacroKinds.contains(self._0.kinds(), MacroKinds.ATTR)) {
      return self._0.as_AttrProcMacro();
    }
    return undefined;
  },
};

/// `#[derive(Clone)]`: the `Arc` payload is shared.
export function clone_SyntaxExtensionKind(v: SyntaxExtensionKind): SyntaxExtensionKind {
  return v.$ === "NonMacroAttr" ? v : { ...v };
}

/// A struct representing a macro definition in "lowered" form ready for expansion.
export class SyntaxExtension {
  constructor(
    /// A syntax extension kind.
    public kind: SyntaxExtensionKind,
    /// Span of the macro definition.
    public span: Span,
    /// List of unstable features that are treated as stable inside this macro.
    public allow_internal_unstable: readonly Symbol[] | undefined,
    /// The macro's stability info.
    public stability: Stability | undefined,
    /// The macro's deprecation info.
    public deprecation: Deprecation | undefined,
    /// Names of helper attributes registered by this macro.
    public helper_attrs: Symbol[],
    /// Edition of the crate in which this macro is defined.
    public edition: Edition,
    /// Built-in macros have a couple of special properties like availability
    /// in `#[no_implicit_prelude]` modules, so we have to keep this flag.
    public builtin_name: Symbol | undefined,
    /// Suppresses the `unsafe_code` lint for code produced by this macro.
    public allow_internal_unsafe: boolean,
    /// Enables the macro helper hack (`ident!(...)` -> `$crate::ident!(...)`) for this macro.
    public local_inner_macros: boolean,
    /// Should debuginfo for the macro be collapsed to the outermost expansion site (in other
    /// words, was the macro definition annotated with `#[collapse_debuginfo]`)?
    public collapse_debuginfo: boolean,
    /// Prevents diagnostics pointing into this macro and suppresses the "this error originates in
    /// the macro" note when a diagnostic points at this macro.
    public diagnostic_opaque: boolean,
  ) {}

  /// Returns which kinds of macro call this syntax extension.
  // rustc: compiler/rustc_expand/src/base.rs:805 macro_kinds
  macro_kinds(): MacroKinds {
    switch (this.kind.$) {
      case "Bang":
      case "LegacyBang":
      case "GlobDelegation":
        return MacroKinds.BANG;
      case "Attr":
      case "LegacyAttr":
      case "NonMacroAttr":
        return MacroKinds.ATTR;
      case "Derive":
      case "LegacyDerive":
        return MacroKinds.DERIVE;
      case "MacroRules":
        return this.kind._0.kinds();
    }
  }

  /// Constructs a syntax extension with default properties.
  // rustc: compiler/rustc_expand/src/base.rs:821 default
  static default(kind: SyntaxExtensionKind, edition: Edition): SyntaxExtension {
    return new SyntaxExtension(
      kind,
      DUMMY_SP,
      undefined,
      undefined,
      undefined,
      [],
      edition,
      undefined,
      false,
      false,
      false,
      false,
    );
  }

  /// if-ext - if macro from different crate (related to callsite code)
  /// | cmd \ attr    | no  | (unspecified) | external | yes |
  /// | no            | no  | no            | no       | no  |
  /// | (unspecified) | no  | if-ext        | if-ext   | yes |
  /// | external      | no  | if-ext        | if-ext   | yes |
  /// | yes           | yes | yes           | yes      | yes |
  // rustc: compiler/rustc_expand/src/base.rs:844 get_collapse_debuginfo
  private static get_collapse_debuginfo(sess: Session, attrs: readonly attrs_Attribute[], ext: boolean): boolean {
    const flag = sess.opts.cg.collapse_macro_debuginfo;
    let attr: CollapseMacroDebuginfo;
    const info = find_attr(attrs, (k) => (k.$ === "CollapseDebugInfo" ? k._0 : undefined));
    if (info !== undefined) {
      attr = info;
    } else if (find_attr(attrs, (k) => (k.$ === "RustcBuiltinMacro" ? null : undefined)) !== undefined) {
      attr = CollapseMacroDebuginfo.Yes;
    } else {
      attr = CollapseMacroDebuginfo.Unspecified;
    }

    // #[rustfmt::skip]
    const collapse_table = [
      [false, false, false, false],
      [false, ext,   ext,   true],
      [false, ext,   ext,   true],
      [true,  true,  true,  true],
    ];
    return collapse_table[CollapseMacroDebuginfo_discriminant[flag]]![CollapseMacroDebuginfo_discriminant[attr]]!;
  }

  /// Constructs a syntax extension with the given properties
  /// and other properties converted from attributes.
  // rustc: compiler/rustc_expand/src/base.rs:866 new
  static new(
    sess: Session,
    kind: SyntaxExtensionKind,
    span: Span,
    helper_attrs: Symbol[],
    edition: Edition,
    name: Symbol,
    attrs: readonly attrs_Attribute[],
    is_local: boolean,
  ): SyntaxExtension {
    const allow_internal_unstable =
      find_attr(attrs, (k) => (k.$ === "AllowInternalUnstable" ? k._0 : undefined)) ?? [];
    const allow_internal_unsafe = find_attr(attrs, (k) => (k.$ === "AllowInternalUnsafe" ? null : undefined)) !== undefined;

    const local_inner_macros =
      find_attr(attrs, (k) => (k.$ === "MacroExport" ? k.local_inner_macros : undefined)) ?? false;
    const collapse_debuginfo = SyntaxExtension.get_collapse_debuginfo(sess, attrs, !is_local);
    // tracing::debug!(?name, ?local_inner_macros, ?collapse_debuginfo, ?allow_internal_unsafe);

    let builtin_name: Symbol | undefined;
    const found = find_attr(attrs, (k) =>
      k.$ === "RustcBuiltinMacro" ? ([k.builtin_name, k.helper_attrs] as const) : undefined,
    );
    if (found !== undefined && found[0] !== undefined) {
      // Override `helper_attrs` passed above if it's a built-in macro,
      // marking `proc_macro_derive` macros as built-in is not a realistic use case.
      builtin_name = found[0];
      helper_attrs = found[1].slice();
    } else if (found !== undefined) {
      builtin_name = name;
      helper_attrs = [];
    } else {
      // Not a built-in macro
      builtin_name = undefined;
    }
    const diagnostic_opaque =
      builtin_name !== undefined ||
      (!sess.opts.unstable_opts.macro_backtrace && find_attr(attrs, (k) => (k.$ === "Opaque" ? null : undefined)) !== undefined);

    const stability = find_attr(attrs, (k) => (k.$ === "Stability" ? k.stability : undefined));

    const sp = find_attr(attrs, (k) => (k.$ === "RustcBodyStability" ? k.span : undefined));
    if (sp !== undefined) {
      sess.dcx().emit_err(
        MacroBodyStability_diagnostic({
          span: sp,
          head_span: sess.source_map().guess_head_span(span),
        }),
      );
    }

    return new SyntaxExtension(
      kind,
      span,
      allow_internal_unstable.length !== 0
        ? // FIXME(jdonszelmann): avoid the into_iter/collect?
          allow_internal_unstable.map((i) => i[0])
        : undefined,
      stability,
      find_attr(attrs, (k) => (k.$ === "Deprecated" ? k.deprecation : undefined)),
      helper_attrs,
      edition,
      builtin_name,
      allow_internal_unsafe,
      local_inner_macros,
      collapse_debuginfo,
      diagnostic_opaque,
    );
  }

  /// A dummy bang macro `foo!()`.
  // rustc: compiler/rustc_expand/src/base.rs:932 dummy_bang
  static dummy_bang(edition: Edition): SyntaxExtension {
    // rustc: compiler/rustc_expand/src/base.rs:933 expand
    function expand(ecx: ExtCtxt, span: Span, _ts: TokenStream): Result<TokenStream, ErrorGuaranteed> {
      return { $: "Err", _0: ecx.dcx().span_delayed_bug(span, "expanded a dummy bang macro") };
    }
    return SyntaxExtension.default({ $: "Bang", _0: BangProcMacro_from_fn(expand) }, edition);
  }

  /// A dummy derive macro `#[derive(Foo)]`.
  // rustc: compiler/rustc_expand/src/base.rs:944 dummy_derive
  static dummy_derive(edition: Edition): SyntaxExtension {
    // rustc: compiler/rustc_expand/src/base.rs:945 expander
    function expander(_: ExtCtxt, _1: Span, _2: MetaItem, _3: Annotatable): Annotatable[] {
      return [];
    }
    return SyntaxExtension.default({ $: "Derive", _0: MultiItemModifier_from_fn(expander) }, edition);
  }

  // rustc: compiler/rustc_expand/src/base.rs:956 non_macro_attr
  static non_macro_attr(edition: Edition): SyntaxExtension {
    return SyntaxExtension.default(SyntaxExtensionKind.NonMacroAttr, edition);
  }

  // rustc: compiler/rustc_expand/src/base.rs:960 glob_delegation
  static glob_delegation(
    trait_def_id: DefId,
    impl_def_id: LocalDefId,
    star_span: Span,
    edition: Edition,
  ): SyntaxExtension {
    // struct GlobDelegationExpanderImpl { trait_def_id, impl_def_id, star_span }
    const expander: GlobDelegationExpander & { trait_def_id: DefId; impl_def_id: LocalDefId; star_span: Span } = {
      trait_def_id,
      impl_def_id,
      star_span,
      // impl GlobDelegationExpander for GlobDelegationExpanderImpl
      // rustc: compiler/rustc_expand/src/base.rs:972 expand
      expand(ecx: ExtCtxt): ExpandResult<[Ident, Ident | undefined][], undefined> {
        const r = ecx.resolver.glob_delegation_suffixes(this.trait_def_id, this.impl_def_id, this.star_span);
        if (r.$ === "Ok") {
          const suffixes = r._0;
          return { $: "Ready", _0: suffixes };
        } else if (ecx.force_mode) {
          return { $: "Ready", _0: [] };
        } else {
          return { $: "Retry", _0: undefined };
        }
      },
    };

    return SyntaxExtension.default({ $: "GlobDelegation", _0: expander }, edition);
  }

  // rustc: compiler/rustc_expand/src/base.rs:992 expn_data
  expn_data(
    parent: LocalExpnId,
    call_site: Span,
    descr: Symbol,
    kind: MacroKind,
    macro_def_id: DefId | undefined,
    parent_module: ModId | undefined,
  ): ExpnData {
    return ExpnData.new(
      { $: "Macro", _0: kind, _1: descr },
      LocalExpnId.to_expn_id(parent),
      call_site,
      this.span,
      this.allow_internal_unstable,
      this.edition,
      macro_def_id,
      parent_module,
      this.allow_internal_unsafe,
      this.local_inner_macros,
      this.collapse_debuginfo,
      this.diagnostic_opaque,
    );
  }
}

/// Error type that denotes indeterminacy.
// PORT: unit struct -> a shared frozen value.
export type Indeterminate = { readonly $: "Indeterminate" };
export const Indeterminate: Indeterminate = Object.freeze({ $: "Indeterminate" as const });

export interface DeriveResolution {
  path: Path;
  item: Annotatable;
  // FIXME: currently this field is only used in `is_none`/`is_some` conditions. However, the
  // `Arc<SyntaxExtension>` will be used if the FIXME in `MacroExpander::fully_expand_fragment`
  // is completed.
  exts: SyntaxExtension | undefined;
  is_const: boolean;
}

// rustc-trait: compiler/rustc_expand/src/base.rs:1031 ResolverExpand
// PORT: implemented by rustc_resolve's `Resolver` (wave 10).
export interface ResolverExpand {
  // rustc: compiler/rustc_expand/src/base.rs:1032 next_node_id
  next_node_id(): NodeId;
  // rustc: compiler/rustc_expand/src/base.rs:1033 invocation_parent
  invocation_parent(id: LocalExpnId): LocalDefId;

  // rustc: compiler/rustc_expand/src/base.rs:1035 resolve_dollar_crates
  resolve_dollar_crates(): void;
  // rustc: compiler/rustc_expand/src/base.rs:1036 visit_ast_fragment_with_placeholders
  visit_ast_fragment_with_placeholders(expn_id: LocalExpnId, fragment: AstFragment): void;
  // rustc: compiler/rustc_expand/src/base.rs:1041 register_builtin_macro
  register_builtin_macro(name: Symbol, ext: SyntaxExtensionKind): void;

  // rustc: compiler/rustc_expand/src/base.rs:1043 expansion_for_ast_pass
  expansion_for_ast_pass(
    call_site: Span,
    pass: AstPass,
    features: readonly Symbol[],
    parent_module_id: NodeId | undefined,
  ): LocalExpnId;

  // rustc: compiler/rustc_expand/src/base.rs:1051 resolve_imports
  resolve_imports(): void;

  // rustc: compiler/rustc_expand/src/base.rs:1053 resolve_macro_invocation
  resolve_macro_invocation(
    invoc: Invocation,
    eager_expansion_root: LocalExpnId,
    force: boolean,
  ): Result<SyntaxExtension, Indeterminate>;

  // rustc: compiler/rustc_expand/src/base.rs:1060 record_macro_rule_usage
  record_macro_rule_usage(mac_id: NodeId, rule_index: number): void;

  // rustc: compiler/rustc_expand/src/base.rs:1062 check_unused_macros
  check_unused_macros(): void;

  // Resolver interfaces for specific built-in macros.
  /// Does `#[derive(...)]` attribute with the given `ExpnId` have built-in `Copy` inside it?
  // rustc: compiler/rustc_expand/src/base.rs:1066 has_derive_copy
  has_derive_copy(expn_id: LocalExpnId): boolean;
  /// Does `#[derive(...)]` attribute with the given `ExpnId` have built-in `Ord` inside it?
  // rustc: compiler/rustc_expand/src/base.rs:1068 has_derive_ord
  has_derive_ord(expn_id: LocalExpnId): boolean;
  /// Resolve paths inside the `#[derive(...)]` attribute with the given `ExpnId`.
  // rustc: compiler/rustc_expand/src/base.rs:1070 resolve_derives
  resolve_derives(
    expn_id: LocalExpnId,
    force: boolean,
    derive_paths: () => DeriveResolution[],
  ): Result<undefined, Indeterminate>;
  /// Take resolutions for paths inside the `#[derive(...)]` attribute with the given `ExpnId`
  /// back from resolver.
  // rustc: compiler/rustc_expand/src/base.rs:1078 take_derive_resolutions
  take_derive_resolutions(expn_id: LocalExpnId): DeriveResolution[] | undefined;
  /// Path resolution logic for `#[cfg_accessible(path)]`.
  // rustc: compiler/rustc_expand/src/base.rs:1080 cfg_accessible
  cfg_accessible(expn_id: LocalExpnId, path: Path): Result<boolean, Indeterminate>;
  // rustc: compiler/rustc_expand/src/base.rs:1085 macro_accessible
  macro_accessible(expn_id: LocalExpnId, path: Path): Result<boolean, Indeterminate>;

  /// Decodes the proc-macro quoted span in the specified crate, with the specified id.
  /// No caching is performed.
  // rustc: compiler/rustc_expand/src/base.rs:1093 get_proc_macro_quoted_span
  get_proc_macro_quoted_span(krate: CrateNum, id: number): Span;

  /// The order of items in the HIR is unrelated to the order of
  /// items in the AST. However, we generate proc macro harnesses
  /// based on the AST order, and later refer to these harnesses
  /// from the HIR. This field keeps track of the order in which
  /// we generated proc macros harnesses, so that we can map
  /// HIR proc macros items back to their harness items.
  // rustc: compiler/rustc_expand/src/base.rs:1101 declare_proc_macro
  declare_proc_macro(id: NodeId): void;

  // rustc: compiler/rustc_expand/src/base.rs:1103 append_stripped_cfg_item
  append_stripped_cfg_item(parent_node: NodeId, ident: Ident, cfg: CfgEntry, cfg_span: Span): void;

  /// Tools registered with `#![register_tool]` or `#![register_attribute_tool]`.
  // rustc: compiler/rustc_expand/src/base.rs:1112 registered_attr_tools
  registered_attr_tools(): RegisteredTools;

  /// Tools registered with `#![register_tool]` or `#![register_lint_tool]`.
  // rustc: compiler/rustc_expand/src/base.rs:1115 registered_lint_tools
  registered_lint_tools(): RegisteredTools;

  /// Mark this invocation id as a glob delegation.
  // rustc: compiler/rustc_expand/src/base.rs:1118 register_glob_delegation
  register_glob_delegation(invoc_id: LocalExpnId): void;

  /// Names of specific methods to which glob delegation expands.
  // rustc: compiler/rustc_expand/src/base.rs:1121 glob_delegation_suffixes
  glob_delegation_suffixes(
    trait_def_id: DefId,
    impl_def_id: LocalDefId,
    star_span: Span,
  ): Result<[Ident, Ident | undefined][], Indeterminate>;

  /// Record the name of an opaque `Ty::ImplTrait` pre-expansion so that it can be used
  /// to generate an item name later that does not reference placeholder macros.
  // rustc: compiler/rustc_expand/src/base.rs:1130 insert_impl_trait_name
  insert_impl_trait_name(id: NodeId, name: Symbol): void;

  /// Mark the scope as having a compile error so that error for lookup in this scope
  /// should be suppressed
  // rustc: compiler/rustc_expand/src/base.rs:1134 mark_scope_with_compile_error
  mark_scope_with_compile_error(parent_node: NodeId): void;
}

// rustc-trait: compiler/rustc_expand/src/base.rs:1137 LintStoreExpand
export interface LintStoreExpand {
  // rustc: compiler/rustc_expand/src/base.rs:1138 pre_expansion_lint
  pre_expansion_lint(
    sess: Session,
    features: Features,
    registered_lint_tools: RegisteredTools,
    node_id: NodeId,
    attrs: readonly Attribute[],
    items: readonly Item[],
    name: Symbol,
  ): void;
}

type LintStoreExpandDyn = LintStoreExpand | undefined;

// #[derive(Debug, Default)]
export class ModuleData {
  constructor(
    /// Path to the module starting from the crate name, like `my_crate::foo::bar`.
    public mod_path: Ident[] = [],
    /// Stack of paths to files loaded by out-of-line module items,
    /// used to detect and report recursive module inclusions.
    public file_path_stack: string[] = [],
    /// Directory to search child module files in,
    /// often (but not necessarily) the parent of the top file path on the `file_path_stack`.
    public dir_path: string = "",
  ) {}

  // rustc: compiler/rustc_expand/src/base.rs:1165 with_dir_path
  with_dir_path(dir_path: string): ModuleData {
    return new ModuleData(this.mod_path.slice(), this.file_path_stack.slice(), dir_path);
  }
}

/// `#[derive(Debug)]` (`PathBuf` prints as its quoted path).
export const debug_ModuleData: Debug<ModuleData> = (v, f) =>
  debug_struct(f, "ModuleData", [
    ["mod_path", debug_vec(v.mod_path, f, debug_Ident)],
    ["file_path_stack", debug_vec(v.file_path_stack, f, (p) => debug_str(p))],
    ["dir_path", debug_str(v.dir_path)],
  ]);

// #[derive(Clone)]
export class ExpansionData {
  constructor(
    public id: LocalExpnId,
    public depth: number,
    /** `Rc<ModuleData>`: shared. */
    public module: ModuleData,
    public dir_ownership: DirOwnership,
    /// Some parent node that is close to this macro call
    public lint_node_id: NodeId,
    public is_trailing_mac: boolean,
  ) {}
}

/** `#[derive(Clone)]`: `Rc<ModuleData>` is shared, `DirOwnership` (Copy) is copied. */
export function clone_ExpansionData(v: ExpansionData): ExpansionData {
  return new ExpansionData(v.id, v.depth, v.module, clone_DirOwnership(v.dir_ownership), v.lint_node_id, v.is_trailing_mac);
}

/// One of these is made during expansion and incrementally updated as we go;
/// when a macro expansion occurs, the resulting nodes have the `backtrace()
/// -> expn_data` of their expansion context stored into their span.
export class ExtCtxt {
  constructor(
    public sess: Session,
    public ecfg: ExpansionConfig,
    public num_standard_library_imports: number,
    public reduced_recursion_limit: [Limit, ErrorGuaranteed] | undefined,
    public root_path: string,
    public resolver: ResolverExpand,
    public current_expansion: ExpansionData,
    /// Error recovery mode entered when expansion is stuck
    /// (or during eager expansion, but that's a hack).
    public force_mode: boolean,
    public expansions: Map<Span, string[]>,
    /// Used for running pre-expansion lints on freshly loaded modules.
    public lint_store: LintStoreExpandDyn,
    /// Used for storing lints generated during expansion, like `NAMED_ARGUMENTS_USED_POSITIONALLY`
    public buffered_early_lint: BufferedEarlyLint[],
    /// When we 'expand' an inert attribute, we leave it
    /// in the AST, but insert it here so that we know
    /// not to expand it again.
    public expanded_inert_attrs: MarkedAttrs,
    /// `-Zmacro-stats` data.
    // PORT: `FxHashMap<(Symbol, MacroKind), MacroStat>`: the tuple key is `macro_stats_key(name, kind)`.
    public macro_stats: Map<string, MacroStat>,
    public nb_macro_errors: number,
  ) {}

  // rustc: compiler/rustc_expand/src/base.rs:1214 new
  static new(sess: Session, ecfg: ExpansionConfig, resolver: ResolverExpand, lint_store: LintStoreExpandDyn): ExtCtxt {
    return new ExtCtxt(
      sess,
      ecfg,
      0,
      undefined,
      "",
      resolver,
      new ExpansionData(
        LocalExpnId.ROOT,
        0,
        new ModuleData(),
        { $: "Owned", relative: undefined },
        CRATE_NODE_ID,
        false,
      ),
      false,
      new Map(),
      lint_store,
      [],
      MarkedAttrs.new(),
      new Map(),
      0,
    );
  }

  // rustc: compiler/rustc_expand/src/base.rs:1245 dcx
  dcx(): DiagCtxtHandle {
    return this.sess.dcx();
  }

  /// Returns a `Folder` for deeply expanding all macros in an AST node.
  // rustc: compiler/rustc_expand/src/base.rs:1250 expander
  expander(): MacroExpander {
    return MacroExpander.new(this, false);
  }

  /// Returns a `Folder` that deeply expands all macros and assigns all `NodeId`s in an AST node.
  /// Once `NodeId`s are assigned, the node may not be expanded, removed, or otherwise modified.
  // rustc: compiler/rustc_expand/src/base.rs:1256 monotonic_expander
  monotonic_expander(): MacroExpander {
    return MacroExpander.new(this, true);
  }
  // rustc: compiler/rustc_expand/src/base.rs:1259 new_parser_from_tts
  new_parser_from_tts(stream: TokenStream): Parser {
    return parser.Parser.new(this.sess.psess, stream, MACRO_ARGUMENTS);
  }
  // rustc: compiler/rustc_expand/src/base.rs:1262 source_map
  source_map(): SourceMap {
    return this.sess.psess.source_map();
  }
  // rustc: compiler/rustc_expand/src/base.rs:1265 psess
  psess(): ParseSess {
    return this.sess.psess;
  }
  // rustc: compiler/rustc_expand/src/base.rs:1268 call_site
  call_site(): Span {
    return LocalExpnId.expn_data(this.current_expansion.id).call_site;
  }

  /// Returns the current expansion kind's description.
  // rustc: compiler/rustc_expand/src/base.rs:1273 expansion_descr
  expansion_descr(): string {
    const expn_data = LocalExpnId.expn_data(this.current_expansion.id);
    return ExpnKind.descr(expn_data.kind);
  }

  /// Equivalent of `Span::def_site` from the proc macro API,
  /// except that the location is taken from the span passed as an argument.
  // rustc: compiler/rustc_expand/src/base.rs:1280 with_def_site_ctxt
  with_def_site_ctxt(span: Span): Span {
    return Span.with_def_site_ctxt(span, LocalExpnId.to_expn_id(this.current_expansion.id));
  }

  /// Equivalent of `Span::call_site` from the proc macro API,
  /// except that the location is taken from the span passed as an argument.
  // rustc: compiler/rustc_expand/src/base.rs:1286 with_call_site_ctxt
  with_call_site_ctxt(span: Span): Span {
    return Span.with_call_site_ctxt(span, LocalExpnId.to_expn_id(this.current_expansion.id));
  }

  /// Equivalent of `Span::mixed_site` from the proc macro API,
  /// except that the location is taken from the span passed as an argument.
  // rustc: compiler/rustc_expand/src/base.rs:1292 with_mixed_site_ctxt
  with_mixed_site_ctxt(span: Span): Span {
    return Span.with_mixed_site_ctxt(span, LocalExpnId.to_expn_id(this.current_expansion.id));
  }

  /// Returns span for the macro which originally caused the current expansion to happen.
  ///
  /// Stops backtracing at include! boundary.
  // rustc: compiler/rustc_expand/src/base.rs:1299 expansion_cause
  expansion_cause(): Span | undefined {
    return LocalExpnId.expansion_cause(this.current_expansion.id);
  }

  /// This method increases the internal macro errors count and then call `trace_macros_diag`.
  // rustc: compiler/rustc_expand/src/base.rs:1304 macro_error_and_trace_macros_diag
  macro_error_and_trace_macros_diag(): void {
    this.nb_macro_errors += 1;
    this.trace_macros_diag();
  }

  // rustc: compiler/rustc_expand/src/base.rs:1309 trace_macros_diag
  trace_macros_diag(): void {
    for (const [span, notes] of this.expansions) {
      const db = this.dcx().create_note(TraceMacro_diagnostic({ span }));
      for (const note of notes) {
        db.note(note);
      }
      db.emit();
    }
    // Fixme: does this result in errors?
    this.expansions.clear();
  }
  // rustc: compiler/rustc_expand/src/base.rs:1320 trace_macros
  trace_macros(): boolean {
    return this.ecfg.trace_mac;
  }
  // rustc: compiler/rustc_expand/src/base.rs:1323 set_trace_macros
  set_trace_macros(x: boolean): void {
    this.ecfg.trace_mac = x;
  }

  // rustc: compiler/rustc_expand/src/base.rs:1327 check_unused_macros
  check_unused_macros(): void {
    this.resolver.check_unused_macros();
  }
}

/** The key of `ExtCtxt::macro_stats` for `(name, kind)` (see the PORT note on the field). */
export function macro_stats_key(name: Symbol, kind: MacroKind): string {
  return `${name}:${kind}`;
}
