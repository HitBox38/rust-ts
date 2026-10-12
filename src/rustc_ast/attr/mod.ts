// Port of compiler/rustc_ast/src/attr/mod.rs
//! Functions dealing with attributes and meta items.
//
// Types and derived Debug impls are generated into mod.gen.ts (tools/codegen/types.ts).
//
// PORT: method placement (PORTING §5 "Methods defined in another file", §8; the ast.ts pattern).
// - This is an extension module for types defined in ast.rs: `impl Attribute`, `impl AttrItem`,
//   `impl MetaItem` and `impl MetaItemLit` go on the generated prototypes (declared via
//   `declare module "../ast.gen.ts"`); `impl MetaItemKind` / `impl MetaItemInner` are attached onto
//   the ast.ts companions and declared in their `MetaItemKindExt` / `MetaItemInnerExt` interfaces.
//   The methods exist once this module is loaded (rustc_ast/lib.ts loads it).
// - `Attribute`'s inherent `id()`, `span()` and `style()` share their names with its fields, so the
//   methods are `id_()`, `span_()` and `style_()` (the `level_()` convention of rustc_errors).
// - Private associated fns (`MetaItem::from_tokens`, `AttrItem::value_str`, ...) are attached like
//   the public ones; nothing outside this file should call them.
// - The trait `AttributeExt` follows the ast_traits.ts dispatch representation: an interface over
//   the implementing type plus a same-named const table of impls (`AttributeExt.Attribute`). Its
//   provided (default) methods are filled in by `AttributeExt_provided`.
// - `SmallVec<[Symbol; 1]>` / `ThinVec<T>` -> arrays; `impl Iterator` -> a generator.
import * as ast from "../ast.ts";
import {
  type AttrArgs,
  AttrItem,
  type AttrKind,
  type AttrStyle,
  type AttrVec,
  Attribute,
  clone_Path,
  DelimArgs,
  debug_Attribute,
  Expr,
  type ExprKind,
  MetaItemInner,
  MetaItemKind,
  NormalAttr,
  Path,
  PathSegment,
  Safety,
  type SyntheticAttr,
} from "../ast.ts";
import { DUMMY_NODE_ID } from "../node_id.ts";
import * as token from "../token.ts";
import { type CommentKind, Delimiter, type DocFragmentKind, Token, TokenKind } from "../token.ts";
import {
  AttrTokenStream,
  type AttrTokenTree,
  debug_TokenTree,
  DelimSpacing,
  DelimSpan,
  LazyAttrTokenStream,
  Spacing,
  TokenStream,
  type TokenStreamIter,
  TokenTree,
} from "../tokenstream.ts";
import * as comments from "../util/comments.ts";
import { escape_string_symbol, MetaItemLit } from "../util/literal.ts";
import { AttrId, Span } from "../../rustc_span/lib.ts";
import { Ident, Symbol, sym } from "../../rustc_span/symbol.ts";
import { debug_option, PLAIN } from "../../std/fmt.ts";
import { assert, panic, unreachable, unwrap } from "../../std/panic.ts";
import * as gen from "./mod.gen.ts";

export * from "./mod.gen.ts";

// pub mod data_structures;
export * as data_structures from "./data_structures.ts";
// pub mod version;
export * as version from "./version.ts";

declare module "./mod.gen.ts" {
  interface MarkedAttrs {
    mark(attr: Attribute): void;
    is_marked(attr: Attribute): boolean;
  }
  interface AttrIdGenerator {
    mk_attr_id(): AttrId;
  }
}

declare module "../ast.gen.ts" {
  interface Attribute {
    get_normal_item(): AttrItem;
    convert_normal_to_synthetic(synthetic_attr: SyntheticAttr): Attribute;
    style_(): AttrStyle;
    may_have_doc_links(): boolean;
    meta(): MetaItem | undefined;
    meta_kind(): MetaItemKind | undefined;
    token_trees(): TokenTree[];
    deprecation_note(): Ident | undefined;
    id_(): AttrId;
    name(): Symbol | undefined;
    meta_item_list(): MetaItemInner[] | undefined;
    value_str(): Symbol | undefined;
    value_span(): Span | undefined;
    path_matches(name: readonly Symbol[]): boolean;
    is_doc_comment(): boolean;
    has_name(name: Symbol): boolean;
    has_any_name(names: readonly Symbol[]): boolean;
    span_(): Span;
    is_word(): boolean;
    path(): Symbol[];
    doc_str(): Symbol | undefined;
    is_proc_macro_attr(): boolean;
    doc_str_and_fragment_kind(): [Symbol, DocFragmentKind] | undefined;
  }
  interface AttrItem {
    name(): Symbol | undefined;
    meta_item_list(): MetaItemInner[] | undefined;
    value_str(): Symbol | undefined;
    value_span(): Span | undefined;
    meta(span: Span): MetaItem | undefined;
    meta_kind(): MetaItemKind | undefined;
  }
  interface MetaItem {
    ident(): Ident | undefined;
    name(): Symbol | undefined;
    has_name(name: Symbol): boolean;
    is_word(): boolean;
    meta_item_list(): readonly MetaItemInner[] | undefined;
    name_value_literal(): MetaItemLit | undefined;
    name_value_literal_span(): Span | undefined;
    value_str(): Symbol | undefined;
  }
  interface MetaItemLit {
    value_as_str(): Symbol | undefined;
  }
}

declare module "../ast.ts" {
  interface MetaItemKindExt {
    list_from_tokens(tokens: TokenStream): MetaItemInner[] | undefined;
    name_value_from_tokens(iter: TokenStreamIter): MetaItemKind | undefined;
    from_tokens(iter: TokenStreamIter): MetaItemKind | undefined;
    from_attr_args(args: AttrArgs): MetaItemKind | undefined;
  }
  interface MetaItemInnerExt {
    span(self: MetaItemInner): Span;
    ident(self: MetaItemInner): Ident | undefined;
    name(self: MetaItemInner): Symbol | undefined;
    has_name(self: MetaItemInner, name: Symbol): boolean;
    is_word(self: MetaItemInner): boolean;
    meta_item_list(self: MetaItemInner): readonly MetaItemInner[] | undefined;
    singleton_lit_list(self: MetaItemInner): [Symbol, MetaItemLit] | undefined;
    name_value_literal_span(self: MetaItemInner): Span | undefined;
    value_str(self: MetaItemInner): Symbol | undefined;
    lit(self: MetaItemInner): MetaItemLit | undefined;
    boolean_literal(self: MetaItemInner): boolean | undefined;
    meta_item_or_bool(self: MetaItemInner): MetaItemInner | undefined;
    meta_item(self: MetaItemInner): MetaItem | undefined;
    is_meta_item(self: MetaItemInner): boolean;
    from_tokens(iter: TokenStreamIter): MetaItemInner | undefined;
  }
}

// The companions of ast.ts, re-exported so callers of this module see the full types.
export { MetaItemInner, MetaItemKind } from "../ast.ts";

export type MetaItem = ast.MetaItem;
// PORT: statics of the generated `MetaItem` class (ast.gen.ts), attached below in upstream order.
export const MetaItem = ast.MetaItem as typeof ast.MetaItem & {
  from_tokens: (iter: TokenStreamIter) => MetaItem | undefined;
};

export type MarkedAttrs = gen.MarkedAttrs;
// PORT: statics of the generated class, attached below in upstream order.
export const MarkedAttrs = gen.MarkedAttrs as typeof gen.MarkedAttrs & {
  "new": () => MarkedAttrs;
};

// rustc: compiler/rustc_ast/src/attr/mod.rs:32 new
MarkedAttrs.new = function (): MarkedAttrs {
  // We have no idea how many attributes there will be, so just
  // initiate the vectors with 0 bits. We'll grow them as necessary.
  return new gen.MarkedAttrs(new Set());
};

// rustc: compiler/rustc_ast/src/attr/mod.rs:38 mark
gen.MarkedAttrs.prototype.mark = function (this: MarkedAttrs, attr: Attribute): void {
  this._0.add(attr.id);
};

// rustc: compiler/rustc_ast/src/attr/mod.rs:42 is_marked
gen.MarkedAttrs.prototype.is_marked = function (this: MarkedAttrs, attr: Attribute): boolean {
  return this._0.has(attr.id);
};

export type AttrIdGenerator = gen.AttrIdGenerator;
// PORT: `AtomicU32` -> the number itself (single-threaded).
export const AttrIdGenerator = gen.AttrIdGenerator as typeof gen.AttrIdGenerator & {
  "new": () => AttrIdGenerator;
};

// rustc: compiler/rustc_ast/src/attr/mod.rs:50 new
AttrIdGenerator.new = function (): AttrIdGenerator {
  return new gen.AttrIdGenerator(0);
};

// rustc: compiler/rustc_ast/src/attr/mod.rs:54 mk_attr_id
gen.AttrIdGenerator.prototype.mk_attr_id = function (this: AttrIdGenerator): AttrId {
  // `fetch_add(1, Ordering::Relaxed)`: returns the previous value (wrapping at `u32::MAX`).
  const id = this._0;
  this._0 = (this._0 + 1) >>> 0;
  assert(id !== 0xffff_ffff, "assertion failed: id != u32::MAX");
  return AttrId.from_u32(id);
};

// rustc: compiler/rustc_ast/src/attr/mod.rs:62 get_normal_item
Attribute.prototype.get_normal_item = function (this: Attribute): AttrItem {
  switch (this.kind.$) {
    case "Normal":
      return this.kind._0.item;
    case "Synthetic":
    case "DocComment":
      return unreachable();
  }
};

// rustc: compiler/rustc_ast/src/attr/mod.rs:69 convert_normal_to_synthetic
Attribute.prototype.convert_normal_to_synthetic = function (
  this: Attribute,
  synthetic_attr: SyntheticAttr,
): Attribute {
  switch (this.kind.$) {
    case "Normal":
      return new Attribute({ $: "Synthetic", _0: synthetic_attr }, this.id, this.style, this.span);
    case "Synthetic":
    case "DocComment":
      return unreachable();
  }
};

// impl AttributeExt for Attribute
const AttributeExt_Attribute: AttributeExt<Attribute> = AttributeExt_provided<Attribute>({
  // rustc: compiler/rustc_ast/src/attr/mod.rs:80 id
  id(self: Attribute): AttrId {
    return self.id;
  },

  // rustc: compiler/rustc_ast/src/attr/mod.rs:84 value_span
  value_span(self: Attribute): Span | undefined {
    const kind = self.kind;
    switch (kind.$) {
      case "Normal": {
        const args = kind._0.item.args;
        switch (args.$) {
          case "Eq":
            return args.expr.span;
          default:
            return undefined;
        }
      }
      case "Synthetic":
      case "DocComment":
        return undefined;
    }
  },

  /// Returns `true` if it is a sugared doc comment (`///` or `//!` for example).
  /// So `#[doc = "doc"]` (which is a doc comment) and `#[doc(...)]` (which is not
  /// a doc comment) will return `false`.
  // rustc: compiler/rustc_ast/src/attr/mod.rs:97 is_doc_comment
  is_doc_comment(self: Attribute): Span | undefined {
    switch (self.kind.$) {
      case "Normal":
      case "Synthetic":
        return undefined;
      case "DocComment":
        return self.span;
    }
  },

  /// For a single-segment attribute, returns its name; otherwise, returns `None`.
  // rustc: compiler/rustc_ast/src/attr/mod.rs:105 name
  name(self: Attribute): Symbol | undefined {
    const kind = self.kind;
    switch (kind.$) {
      case "Normal":
        return kind._0.item.name();
      // AttrKind::Synthetic(CfgTrace(_) | CfgAttrTrace(_))
      case "Synthetic":
        return undefined;
      case "DocComment":
        return undefined;
    }
  },

  // rustc: compiler/rustc_ast/src/attr/mod.rs:114 symbol_path
  symbol_path(self: Attribute): Symbol[] | undefined {
    const kind = self.kind;
    switch (kind.$) {
      case "Normal":
        return kind._0.item.path.segments.map((i) => i.ident.name);
      // AttrKind::Synthetic(CfgTrace(_) | CfgAttrTrace(_))
      case "Synthetic":
        return undefined;
      case "DocComment":
        return undefined;
    }
  },

  // rustc: compiler/rustc_ast/src/attr/mod.rs:125 path_span
  path_span(self: Attribute): Span | undefined {
    const kind = self.kind;
    switch (kind.$) {
      case "Normal":
        return kind._0.item.path.span;
      case "Synthetic":
        return unreachable();
      case "DocComment":
        return undefined;
    }
  },

  // rustc: compiler/rustc_ast/src/attr/mod.rs:133 path_matches
  path_matches(self: Attribute, name: readonly Symbol[]): boolean {
    const kind = self.kind;
    switch (kind.$) {
      case "Normal": {
        const segments = kind._0.item.path.segments;
        if (segments.length !== name.length) return false;
        // `.iter().zip(name).all(|(s, n)| s.args.is_none() && s.ident.name == *n)`
        for (let i = 0; i < segments.length; i++) {
          const s = segments[i]!;
          const n = name[i]!;
          if (!(s.args === undefined && s.ident.name === n)) return false;
        }
        return true;
      }
      case "Synthetic":
      case "DocComment":
        return false;
    }
  },

  // rustc: compiler/rustc_ast/src/attr/mod.rs:149 span
  span(self: Attribute): Span {
    return self.span;
  },

  // rustc: compiler/rustc_ast/src/attr/mod.rs:153 is_word
  is_word(self: Attribute): boolean {
    const kind = self.kind;
    switch (kind.$) {
      case "Normal":
        return kind._0.item.args.$ === "Empty";
      case "Synthetic":
        return unreachable();
      case "DocComment":
        return false;
    }
  },

  /// Returns a list of meta items if the attribute is delimited with parenthesis:
  ///
  /// ```text
  /// #[attr(a, b = "c")] // Returns `Some()`.
  /// #[attr = ""] // Returns `None`.
  /// #[attr] // Returns `None`.
  /// ```
  // rustc: compiler/rustc_ast/src/attr/mod.rs:168 meta_item_list
  meta_item_list(self: Attribute): MetaItemInner[] | undefined {
    const kind = self.kind;
    switch (kind.$) {
      case "Normal":
        return kind._0.item.meta_item_list();
      case "Synthetic":
      case "DocComment":
        return undefined;
    }
  },

  /// Returns the string value in:
  ///
  /// ```text
  /// #[attribute = "value"]
  ///               ^^^^^^^
  /// ```
  ///
  /// It returns `None` in any other cases, including doc comments if they
  /// are not under the form `#[doc = "..."]`.
  ///
  /// It also returns `None` for:
  ///
  /// ```text
  /// #[attr("value")]
  /// ```
  // rustc: compiler/rustc_ast/src/attr/mod.rs:190 value_str
  value_str(self: Attribute): Symbol | undefined {
    const kind = self.kind;
    switch (kind.$) {
      case "Normal":
        return kind._0.item.value_str();
      case "Synthetic":
        return unreachable();
      case "DocComment":
        return undefined;
    }
  },

  /// Returns the documentation and its kind if this is a doc comment or a sugared doc comment.
  /// * `///doc` returns `Some(("doc", DocFragmentKind::Sugared(CommentKind::Line)))`.
  /// * `/** doc */` returns `Some(("doc", DocFragmentKind::Sugared(CommentKind::Block)))`.
  /// * `#[doc = "doc"]` returns `Some(("doc", DocFragmentKind::Raw))`.
  /// * `#[doc(...)]` returns `None`.
  // rustc: compiler/rustc_ast/src/attr/mod.rs:203 doc_str_and_fragment_kind
  doc_str_and_fragment_kind(self: Attribute): [Symbol, DocFragmentKind] | undefined {
    const kind = self.kind;
    if (kind.$ === "DocComment") {
      return [kind._1, { $: "Sugared", _0: kind._0 }];
    }
    if (kind.$ === "Normal") {
      const normal = kind._0;
      let value: Symbol | undefined;
      let value_span: Span | undefined;
      if (
        normal.item.path.eq_Symbol(sym.doc) &&
        (value = normal.item.value_str()) !== undefined &&
        (value_span = normal.item.value_span()) !== undefined
      ) {
        return [value, { $: "Raw", _0: value_span }];
      }
    }
    // AttrKind::Normal(..) | AttrKind::Synthetic(..)
    return undefined;
  },

  /// Returns the documentation if this is a doc comment or a sugared doc comment.
  /// * `///doc` returns `Some("doc")`.
  /// * `#[doc = "doc"]` returns `Some("doc")`.
  /// * `#[doc(...)]` returns `None`.
  // rustc: compiler/rustc_ast/src/attr/mod.rs:221 doc_str
  doc_str(self: Attribute): Symbol | undefined {
    const kind = self.kind;
    if (kind.$ === "DocComment") {
      return kind._1;
    } else if (kind.$ === "Normal" && kind._0.item.path.eq_Symbol(sym.doc)) {
      return kind._0.item.value_str();
    } else {
      return undefined;
    }
  },

  // rustc: compiler/rustc_ast/src/attr/mod.rs:229 doc_resolution_scope
  doc_resolution_scope(self: Attribute): AttrStyle | undefined {
    const kind = self.kind;
    if (kind.$ === "DocComment") {
      return self.style;
    } else if (
      kind.$ === "Normal" &&
      kind._0.item.path.eq_Symbol(sym.doc) &&
      kind._0.item.value_str() !== undefined
    ) {
      return self.style;
    } else {
      return undefined;
    }
  },

  // rustc: compiler/rustc_ast/src/attr/mod.rs:241 is_automatically_derived_attr
  is_automatically_derived_attr(self: Attribute): boolean {
    return self.has_name(sym.automatically_derived);
  },

  // rustc: compiler/rustc_ast/src/attr/mod.rs:245 is_doc_hidden
  is_doc_hidden(self: Attribute): boolean {
    if (!self.has_name(sym.doc)) return false;
    const l = self.meta_item_list();
    return l !== undefined && list_contains_name(l, sym.hidden);
  },

  // rustc: compiler/rustc_ast/src/attr/mod.rs:250 is_doc_keyword_or_attribute
  is_doc_keyword_or_attribute(self: Attribute): boolean {
    let items: MetaItemInner[] | undefined;
    if (self.has_name(sym.doc) && (items = self.meta_item_list()) !== undefined) {
      for (const item of items) {
        if (MetaItemInner.has_name(item, sym.keyword) || MetaItemInner.has_name(item, sym.attribute)) {
          return true;
        }
      }
    }
    return false;
  },

  // rustc: compiler/rustc_ast/src/attr/mod.rs:263 is_rustc_doc_primitive
  is_rustc_doc_primitive(self: Attribute): boolean {
    return self.has_name(sym.rustc_doc_primitive);
  },
});

// rustc: compiler/rustc_ast/src/attr/mod.rs:269 style
Attribute.prototype.style_ = function (this: Attribute): AttrStyle {
  return this.style;
};

// rustc: compiler/rustc_ast/src/attr/mod.rs:273 may_have_doc_links
Attribute.prototype.may_have_doc_links = function (this: Attribute): boolean {
  const s = this.doc_str();
  if (s !== undefined && comments.may_have_doc_links(Symbol.as_str(s))) return true;
  const n = this.deprecation_note();
  return n !== undefined && comments.may_have_doc_links(Symbol.as_str(n.name));
};

/// Extracts the MetaItem from inside this Attribute.
// rustc: compiler/rustc_ast/src/attr/mod.rs:279 meta
Attribute.prototype.meta = function (this: Attribute): MetaItem | undefined {
  const kind = this.kind;
  switch (kind.$) {
    case "Normal":
      return kind._0.item.meta(this.span);
    case "Synthetic":
    case "DocComment":
      return undefined;
  }
};

// rustc: compiler/rustc_ast/src/attr/mod.rs:286 meta_kind
Attribute.prototype.meta_kind = function (this: Attribute): MetaItemKind | undefined {
  const kind = this.kind;
  switch (kind.$) {
    case "Normal":
      return kind._0.item.meta_kind();
    case "Synthetic":
      return unreachable();
    case "DocComment":
      return undefined;
  }
};

// rustc: compiler/rustc_ast/src/attr/mod.rs:294 token_trees
Attribute.prototype.token_trees = function (this: Attribute): TokenTree[] {
  const kind: AttrKind = this.kind;
  switch (kind.$) {
    case "Normal": {
      const normal = kind._0;
      const tokens = normal.tokens;
      if (tokens === undefined) {
        panic(`attribute is missing tokens: ${debug_Attribute(this, PLAIN)}`);
      }
      return tokens.to_attr_token_stream().to_token_trees();
    }
    // Empty tokens here ensures synthetic attributes are invisible to proc macros.
    case "Synthetic":
      return [];
    case "DocComment": {
      const comment_kind: CommentKind = kind._0;
      const data = kind._1;
      return [TokenTree.token_alone({ $: "DocComment", _0: comment_kind, _1: this.style, _2: data }, this.span)];
    }
  }
};

// rustc: compiler/rustc_ast/src/attr/mod.rs:311 deprecation_note
Attribute.prototype.deprecation_note = function (this: Attribute): Ident | undefined {
  const kind = this.kind;
  if (kind.$ === "Normal" && kind._0.item.path.eq_Symbol(sym.deprecated)) {
    const meta = kind._0.item;

    // #[deprecated = "..."]
    const s = meta.value_str();
    if (s !== undefined) {
      return new Ident(s, meta.span);
    }

    // #[deprecated(note = "...")]
    const list = meta.meta_item_list();
    if (list !== undefined) {
      for (const nested of list) {
        const mi = MetaItemInner.meta_item(nested);
        let s: Symbol | undefined;
        if (mi !== undefined && mi.path.eq_Symbol(sym.note) && (s = mi.value_str()) !== undefined) {
          return new Ident(s, mi.span);
        }
      }
    }

    return undefined;
  }
  return undefined;
};

// rustc: compiler/rustc_ast/src/attr/mod.rs:341 name
AttrItem.prototype.name = function (this: AttrItem): Symbol | undefined {
  const segments = this.path.segments;
  if (segments.length === 1) {
    return segments[0]!.ident.name;
  } else {
    return undefined;
  }
};

// rustc: compiler/rustc_ast/src/attr/mod.rs:345 meta_item_list
AttrItem.prototype.meta_item_list = function (this: AttrItem): MetaItemInner[] | undefined {
  const args = this.args;
  if (args.$ === "Delimited" && args._0.delim.$ === "Parenthesis") {
    // PORT: `TokenStream::clone` (an `Arc` clone) shares the trees (tokenstream.ts convention).
    return MetaItemKind.list_from_tokens(new TokenStream(args._0.tokens._0));
  }
  // AttrArgs::Delimited(_) | AttrArgs::Eq { .. } | AttrArgs::Empty
  return undefined;
};

/// Returns the string value in:
///
/// ```text
/// #[attribute = "value"]
///               ^^^^^^^
/// ```
///
/// It returns `None` in any other cases like:
///
/// ```text
/// #[attr("value")]
/// ```
// rustc: compiler/rustc_ast/src/attr/mod.rs:366 value_str
AttrItem.prototype.value_str = function (this: AttrItem): Symbol | undefined {
  const args = this.args;
  switch (args.$) {
    case "Eq": {
      const kind: ExprKind = args.expr.kind;
      if (kind.$ === "Lit") {
        const token_lit = kind._0;
        const lit = ast.LitKind.from_token_lit(token_lit);
        return lit.$ === "Ok" ? ast.LitKind.str(lit._0) : undefined;
      }
      return undefined;
    }
    case "Delimited":
    case "Empty":
      return undefined;
  }
};

/// Returns the span in:
///
/// ```text
/// #[attribute = "value"]
///               ^^^^^^^
/// ```
///
/// It returns `None` in any other cases like:
///
/// ```text
/// #[attr("value")]
/// ```
// rustc: compiler/rustc_ast/src/attr/mod.rs:390 value_span
AttrItem.prototype.value_span = function (this: AttrItem): Span | undefined {
  const args = this.args;
  switch (args.$) {
    case "Eq":
      return args.expr.span;
    case "Delimited":
    case "Empty":
      return undefined;
  }
};

// rustc: compiler/rustc_ast/src/attr/mod.rs:397 meta
AttrItem.prototype.meta = function (this: AttrItem, span: Span): MetaItem | undefined {
  const path = clone_Path(this.path);
  const kind = this.meta_kind();
  if (kind === undefined) return undefined;
  return new MetaItem(Safety.Default, path, kind, span);
};

// rustc: compiler/rustc_ast/src/attr/mod.rs:406 meta_kind
AttrItem.prototype.meta_kind = function (this: AttrItem): MetaItemKind | undefined {
  return MetaItemKind.from_attr_args(this.args);
};

/// For a single-segment meta item, returns its name; otherwise, returns `None`.
// rustc: compiler/rustc_ast/src/attr/mod.rs:413 ident
MetaItem.prototype.ident = function (this: MetaItem): Ident | undefined {
  const segments = this.path.segments;
  if (segments.length === 1) {
    return segments[0]!.ident;
  } else {
    return undefined;
  }
};

// rustc: compiler/rustc_ast/src/attr/mod.rs:417 name
MetaItem.prototype.name = function (this: MetaItem): Symbol | undefined {
  return this.ident()?.name;
};

// rustc: compiler/rustc_ast/src/attr/mod.rs:421 has_name
MetaItem.prototype.has_name = function (this: MetaItem, name: Symbol): boolean {
  return this.path.eq_Symbol(name);
};

// rustc: compiler/rustc_ast/src/attr/mod.rs:425 is_word
MetaItem.prototype.is_word = function (this: MetaItem): boolean {
  return this.kind.$ === "Word";
};

// rustc: compiler/rustc_ast/src/attr/mod.rs:429 meta_item_list
MetaItem.prototype.meta_item_list = function (this: MetaItem): readonly MetaItemInner[] | undefined {
  const kind = this.kind;
  switch (kind.$) {
    case "List":
      return kind._0;
    default:
      return undefined;
  }
};

/// ```text
/// Example:
///     #[attribute(name = "value")]
///                 ^^^^^^^^^^^^^^
/// ```
// rustc: compiler/rustc_ast/src/attr/mod.rs:441 name_value_literal
MetaItem.prototype.name_value_literal = function (this: MetaItem): MetaItemLit | undefined {
  const kind = this.kind;
  switch (kind.$) {
    case "NameValue":
      return kind._0;
    default:
      return undefined;
  }
};

/// This is used in case you want the value span instead of the whole attribute. Example:
///
/// ```text
/// #[doc(alias = "foo")]
/// ```
///
/// In here, it'll return a span for `"foo"`.
// rustc: compiler/rustc_ast/src/attr/mod.rs:455 name_value_literal_span
MetaItem.prototype.name_value_literal_span = function (this: MetaItem): Span | undefined {
  const lit = this.name_value_literal();
  if (lit === undefined) return undefined;
  return lit.span;
};

/// Returns the string value in:
///
/// ```text
/// #[attribute = "value"]
///               ^^^^^^^
/// ```
///
/// It returns `None` in any other cases like:
///
/// ```text
/// #[attr("value")]
/// ```
// rustc: compiler/rustc_ast/src/attr/mod.rs:471 value_str
MetaItem.prototype.value_str = function (this: MetaItem): Symbol | undefined {
  const kind = this.kind;
  switch (kind.$) {
    case "NameValue":
      return ast.LitKind.str(kind._0.kind);
    default:
      return undefined;
  }
};

/** `Some(TokenTree::Token(Token { kind: token::PathSep, .. }, _))` */
function is_path_sep_tree(tt: TokenTree | undefined): boolean {
  return tt !== undefined && tt.$ === "Token" && tt._0.kind.$ === "PathSep";
}

// rustc: compiler/rustc_ast/src/attr/mod.rs:478 from_tokens
MetaItem.from_tokens = function (iter: TokenStreamIter): MetaItem | undefined {
  // FIXME: Share code with `parse_path`.
  const next = iter.next();
  // PORT: `Cow<'_, TokenTree>` -> `TokenTree` (tokenstream.ts `uninterpolate`).
  const tt = next === undefined ? undefined : TokenTree.uninterpolate(next);
  let path: Path;
  arm: {
    if (tt !== undefined && tt.$ === "Token" && (tt._0.kind.$ === "Ident" || tt._0.kind.$ === "PathSep")) {
      const kind = tt._0.kind;
      const span = tt._0.span;
      let segments: PathSegment[];
      if (kind.$ === "Ident") {
        const name = kind._0;
        if (is_path_sep_tree(iter.peek())) {
          iter.next();
          segments = [PathSegment.from_ident(Ident.new(name, span))];
        } else {
          path = Path.from_ident(Ident.new(name, span));
          break arm;
        }
      } else {
        segments = [PathSegment.path_root(span)];
      }
      for (;;) {
        const next = iter.next();
        const tt = next === undefined ? undefined : TokenTree.uninterpolate(next);
        if (!(tt !== undefined && tt.$ === "Token" && tt._0.kind.$ === "Ident")) {
          return undefined;
        }
        const name = tt._0.kind._0;
        const span = tt._0.span;
        segments.push(PathSegment.from_ident(Ident.new(name, span)));
        if (!is_path_sep_tree(iter.peek())) {
          break;
        }
        iter.next();
      }
      const span_ = Span.with_hi(span, Span.hi(unwrap(segments[segments.length - 1]).ident.span));
      path = new Path(span_, segments);
    } else if (
      tt !== undefined &&
      tt.$ === "Delimited" &&
      tt._2.$ === "Invisible" &&
      tt._2._0.$ === "MetaVar" &&
      (tt._2._0._0.$ === "Meta" || tt._2._0._0.$ === "Path")
    ) {
      // This path is currently unreachable in the test suite.
      return unreachable();
    } else if (tt !== undefined && tt.$ === "Token" && TokenKind.is_delim(tt._0.kind)) {
      panic(`Should be \`AttrTokenTree::Delimited\`, not delim tokens: ${debug_option(tt, PLAIN, debug_TokenTree)}`);
    } else {
      return undefined;
    }
  }
  const peeked = iter.peek();
  const list_closing_paren_pos = peeked === undefined ? undefined : Span.hi(TokenTree.span(peeked));
  const kind = MetaItemKind.from_tokens(iter);
  if (kind === undefined) return undefined;
  let hi;
  switch (kind.$) {
    case "NameValue":
      hi = Span.hi(kind._0.span);
      break;
    case "List":
      hi = list_closing_paren_pos ?? Span.hi(path.span);
      break;
    default:
      hi = Span.hi(path.span);
      break;
  }
  const span = Span.with_hi(path.span, hi);
  // FIXME: This parses `unsafe()` not as unsafe attribute syntax in `MetaItem`,
  // but as a parenthesized list. This (and likely `MetaItem`) should be changed in
  // such a way that builtin macros don't accept extraneous `unsafe()`.
  return new MetaItem(Safety.Default, path, kind, span);
};

// public because it can be called in the hir
// rustc: compiler/rustc_ast/src/attr/mod.rs:547 list_from_tokens
MetaItemKind.list_from_tokens = function (tokens: TokenStream): MetaItemInner[] | undefined {
  const iter = tokens.iter();
  const result: MetaItemInner[] = [];
  while (iter.peek() !== undefined) {
    const item = MetaItemInner.from_tokens(iter);
    if (item === undefined) return undefined;
    result.push(item);
    const next = iter.next();
    if (next === undefined || (next.$ === "Token" && next._0.kind.$ === "Comma")) {
      // None | Some(TokenTree::Token(Token { kind: token::Comma, .. }, _)) => {}
    } else {
      return undefined;
    }
  }
  return result;
};

// rustc: compiler/rustc_ast/src/attr/mod.rs:561 name_value_from_tokens
MetaItemKind.name_value_from_tokens = function (iter: TokenStreamIter): MetaItemKind | undefined {
  const next = iter.next();
  if (next !== undefined && next.$ === "Delimited" && next._2.$ === "Invisible") {
    const inner_tokens = next._3;
    return MetaItemKind.name_value_from_tokens(inner_tokens.iter());
  } else if (next !== undefined && next.$ === "Token") {
    const token = next._0;
    const lit = MetaItemLit.from_token(token);
    return lit === undefined ? undefined : { $: "NameValue", _0: lit };
  } else {
    return undefined;
  }
};

// rustc: compiler/rustc_ast/src/attr/mod.rs:573 from_tokens
MetaItemKind.from_tokens = function (iter: TokenStreamIter): MetaItemKind | undefined {
  const peeked = iter.peek();
  if (peeked !== undefined && peeked.$ === "Delimited" && peeked._2.$ === "Parenthesis") {
    // PORT: `TokenStream::clone` (an `Arc` clone) shares the trees (tokenstream.ts convention).
    const inner_tokens = new TokenStream(peeked._3._0);
    iter.next();
    const list = MetaItemKind.list_from_tokens(inner_tokens);
    return list === undefined ? undefined : { $: "List", _0: list };
  } else if (peeked !== undefined && peeked.$ === "Delimited") {
    return undefined;
  } else if (peeked !== undefined && peeked.$ === "Token" && peeked._0.kind.$ === "Eq") {
    iter.next();
    return MetaItemKind.name_value_from_tokens(iter);
  } else {
    return MetaItemKind.Word;
  }
};

// rustc: compiler/rustc_ast/src/attr/mod.rs:589 from_attr_args
MetaItemKind.from_attr_args = function (args: AttrArgs): MetaItemKind | undefined {
  switch (args.$) {
    case "Empty":
      return MetaItemKind.Word;
    case "Delimited": {
      if (args._0.delim.$ === "Parenthesis") {
        const tokens = args._0.tokens;
        // PORT: `TokenStream::clone` (an `Arc` clone) shares the trees (tokenstream.ts convention).
        const list = MetaItemKind.list_from_tokens(new TokenStream(tokens._0));
        return list === undefined ? undefined : { $: "List", _0: list };
      }
      return undefined;
    }
    case "Eq": {
      const expr = args.expr;
      const kind: ExprKind = expr.kind;
      if (kind.$ === "Lit") {
        const token_lit = kind._0;
        // Turn failures to `None`, we'll get parse errors elsewhere.
        const lit = MetaItemLit.from_token_lit(token_lit, expr.span);
        return lit.$ === "Ok" ? { $: "NameValue", _0: lit._0 } : undefined;
      }
      return undefined;
    }
  }
};

// rustc: compiler/rustc_ast/src/attr/mod.rs:610 span
MetaItemInner.span = function (self: MetaItemInner): Span {
  switch (self.$) {
    case "MetaItem":
      return self._0.span;
    case "Lit":
      return self._0.span;
  }
};

/// For a single-segment meta item, returns its identifier; otherwise, returns `None`.
// rustc: compiler/rustc_ast/src/attr/mod.rs:618 ident
MetaItemInner.ident = function (self: MetaItemInner): Ident | undefined {
  const meta_item = MetaItemInner.meta_item(self);
  return meta_item === undefined ? undefined : meta_item.ident();
};

/// For a single-segment meta item, returns its name; otherwise, returns `None`.
// rustc: compiler/rustc_ast/src/attr/mod.rs:623 name
MetaItemInner.name = function (self: MetaItemInner): Symbol | undefined {
  return MetaItemInner.ident(self)?.name;
};

/// Returns `true` if this list item is a MetaItem with a name of `name`.
// rustc: compiler/rustc_ast/src/attr/mod.rs:628 has_name
MetaItemInner.has_name = function (self: MetaItemInner, name: Symbol): boolean {
  const meta_item = MetaItemInner.meta_item(self);
  return meta_item !== undefined && meta_item.has_name(name);
};

/// Returns `true` if `self` is a `MetaItem` and the meta item is a word.
// rustc: compiler/rustc_ast/src/attr/mod.rs:633 is_word
MetaItemInner.is_word = function (self: MetaItemInner): boolean {
  const meta_item = MetaItemInner.meta_item(self);
  return meta_item !== undefined && meta_item.is_word();
};

/// Gets a list of inner meta items from a list `MetaItem` type.
// rustc: compiler/rustc_ast/src/attr/mod.rs:638 meta_item_list
MetaItemInner.meta_item_list = function (self: MetaItemInner): readonly MetaItemInner[] | undefined {
  const meta_item = MetaItemInner.meta_item(self);
  return meta_item === undefined ? undefined : meta_item.meta_item_list();
};

/// If it's a singleton list of the form `foo(lit)`, returns the `foo` and
/// the `lit`.
// rustc: compiler/rustc_ast/src/attr/mod.rs:644 singleton_lit_list
MetaItemInner.singleton_lit_list = function (self: MetaItemInner): [Symbol, MetaItemLit] | undefined {
  const meta_item = MetaItemInner.meta_item(self);
  if (meta_item === undefined) return undefined;
  const meta_item_list = meta_item.meta_item_list();
  if (meta_item_list === undefined) return undefined;
  let ident: Ident | undefined;
  let lit: MetaItemLit | undefined;
  if (
    meta_item_list.length === 1 &&
    (ident = meta_item.ident()) !== undefined &&
    (lit = MetaItemInner.lit(meta_item_list[0]!)) !== undefined
  ) {
    return [ident.name, lit];
  }
  return undefined;
};

/// See [`MetaItem::name_value_literal_span`].
// rustc: compiler/rustc_ast/src/attr/mod.rs:659 name_value_literal_span
MetaItemInner.name_value_literal_span = function (self: MetaItemInner): Span | undefined {
  const meta_item = MetaItemInner.meta_item(self);
  if (meta_item === undefined) return undefined;
  return meta_item.name_value_literal_span();
};

/// Gets the string value if `self` is a `MetaItem` and the `MetaItem` is a
/// `MetaItemKind::NameValue` variant containing a string, otherwise `None`.
// rustc: compiler/rustc_ast/src/attr/mod.rs:665 value_str
MetaItemInner.value_str = function (self: MetaItemInner): Symbol | undefined {
  const meta_item = MetaItemInner.meta_item(self);
  return meta_item === undefined ? undefined : meta_item.value_str();
};

/// Returns the `MetaItemLit` if `self` is a `MetaItemInner::Literal`s.
// rustc: compiler/rustc_ast/src/attr/mod.rs:670 lit
MetaItemInner.lit = function (self: MetaItemInner): MetaItemLit | undefined {
  switch (self.$) {
    case "Lit":
      return self._0;
    default:
      return undefined;
  }
};

/// Returns the bool if `self` is a boolean `MetaItemInner::Literal`.
// rustc: compiler/rustc_ast/src/attr/mod.rs:678 boolean_literal
MetaItemInner.boolean_literal = function (self: MetaItemInner): boolean | undefined {
  if (self.$ === "Lit" && self._0.kind.$ === "Bool") {
    return self._0.kind._0;
  }
  return undefined;
};

/// Returns the `MetaItem` if `self` is a `MetaItemInner::MetaItem` or if it's
/// `MetaItemInner::Lit(MetaItemLit { kind: LitKind::Bool(_), .. })`.
// rustc: compiler/rustc_ast/src/attr/mod.rs:687 meta_item_or_bool
MetaItemInner.meta_item_or_bool = function (self: MetaItemInner): MetaItemInner | undefined {
  if (self.$ === "MetaItem") {
    return self;
  } else if (self.$ === "Lit" && self._0.kind.$ === "Bool") {
    return self;
  } else {
    return undefined;
  }
};

/// Returns the `MetaItem` if `self` is a `MetaItemInner::MetaItem`.
// rustc: compiler/rustc_ast/src/attr/mod.rs:696 meta_item
MetaItemInner.meta_item = function (self: MetaItemInner): MetaItem | undefined {
  switch (self.$) {
    case "MetaItem":
      return self._0;
    default:
      return undefined;
  }
};

/// Returns `true` if the variant is `MetaItem`.
// rustc: compiler/rustc_ast/src/attr/mod.rs:704 is_meta_item
MetaItemInner.is_meta_item = function (self: MetaItemInner): boolean {
  return MetaItemInner.meta_item(self) !== undefined;
};

// rustc: compiler/rustc_ast/src/attr/mod.rs:708 from_tokens
MetaItemInner.from_tokens = function (iter: TokenStreamIter): MetaItemInner | undefined {
  const peeked = iter.peek();
  let lit: MetaItemLit | undefined;
  if (peeked !== undefined && peeked.$ === "Token" && (lit = MetaItemLit.from_token(peeked._0)) !== undefined) {
    iter.next();
    return { $: "Lit", _0: lit };
  } else if (peeked !== undefined && peeked.$ === "Delimited" && peeked._2.$ === "Invisible") {
    const inner_tokens = peeked._3;
    iter.next();
    return MetaItemInner.from_tokens(inner_tokens.iter());
  }
  const item = MetaItem.from_tokens(iter);
  return item === undefined ? undefined : { $: "MetaItem", _0: item };
};

// rustc: compiler/rustc_ast/src/attr/mod.rs:724 mk_doc_comment
export function mk_doc_comment(
  g: AttrIdGenerator,
  comment_kind: CommentKind,
  style: AttrStyle,
  data: Symbol,
  span: Span,
): Attribute {
  return new Attribute({ $: "DocComment", _0: comment_kind, _1: data }, g.mk_attr_id(), style, span);
}

// rustc: compiler/rustc_ast/src/attr/mod.rs:734 mk_attr_from_item
export function mk_attr_from_item(
  g: AttrIdGenerator,
  item: AttrItem,
  tokens: LazyAttrTokenStream | undefined,
  style: AttrStyle,
  span: Span,
): Attribute {
  return new Attribute({ $: "Normal", _0: new NormalAttr(item, tokens) }, g.mk_attr_id(), style, span);
}

// rustc: compiler/rustc_ast/src/attr/mod.rs:749 mk_attr_tokens
function mk_attr_tokens(style: AttrStyle, item_tokens: AttrTokenStream, span: Span): LazyAttrTokenStream {
  let tokens: AttrTokenTree[];
  switch (style) {
    case "Outer":
      tokens = [{ $: "Token", _0: Token.new(TokenKind.Pound, span), _1: Spacing.JointHidden }];
      break;
    case "Inner":
      tokens = [
        { $: "Token", _0: Token.new(TokenKind.Pound, span), _1: Spacing.Joint },
        { $: "Token", _0: Token.new(TokenKind.Bang, span), _1: Spacing.JointHidden },
      ];
      break;
  }
  tokens.push({
    $: "Delimited",
    _0: DelimSpan.from_single(span),
    _1: DelimSpacing.new(Spacing.JointHidden, Spacing.Alone),
    _2: Delimiter.Bracket,
    _3: item_tokens,
  });

  return LazyAttrTokenStream.new_direct(AttrTokenStream.new(tokens));
}

// `span` is used for the `Attribute` and everything within it (except for any span within
// `unsafety`).
// rustc: compiler/rustc_ast/src/attr/mod.rs:775 mk_attr_word
export function mk_attr_word(g: AttrIdGenerator, style: AttrStyle, name: Symbol, span: Span): Attribute {
  const path = Path.from_ident(Ident.new(name, span));
  const args: AttrArgs = ast.AttrArgs.Empty;

  const tokens = mk_attr_tokens(
    style,
    AttrTokenStream.new([{ $: "Token", _0: Token.from_ast_ident(Ident.new(name, span)), _1: Spacing.Alone }]),
    span,
  );

  return mk_attr_from_item(g, new AttrItem(Safety.Default, path, args, span), tokens, style, span);
}

// `span` is used for the `Attribute` and everything within it (except for any span within
// `unsafety`).
// rustc: compiler/rustc_ast/src/attr/mod.rs:799 mk_attr_nested_word
export function mk_attr_nested_word(
  g: AttrIdGenerator,
  style: AttrStyle,
  outer: Symbol,
  inner: Symbol,
  span: Span,
): Attribute {
  const inner_tokens = TokenStream.new([
    { $: "Token", _0: Token.from_ast_ident(Ident.new(inner, span)), _1: Spacing.Alone },
  ]);
  const outer_ident = Ident.new(outer, span);
  const path = Path.from_ident(outer_ident);
  const attr_args: AttrArgs = {
    $: "Delimited",
    _0: new DelimArgs(DelimSpan.from_single(span), Delimiter.Parenthesis, inner_tokens),
  };

  const tokens = mk_attr_tokens(
    style,
    AttrTokenStream.new([
      { $: "Token", _0: Token.from_ast_ident(Ident.new(outer, span)), _1: Spacing.Alone },
      {
        $: "Delimited",
        _0: DelimSpan.from_single(span),
        _1: DelimSpacing.new(Spacing.JointHidden, Spacing.Alone),
        _2: Delimiter.Parenthesis,
        _3: AttrTokenStream.new([
          { $: "Token", _0: Token.from_ast_ident(Ident.new(inner, span)), _1: Spacing.Alone },
        ]),
      },
    ]),
    span,
  );

  return mk_attr_from_item(g, new AttrItem(Safety.Default, path, attr_args, span), tokens, style, span);
}

// `span` is used for the `Attribute` and everything within it (except for any span within
// `unsafety`).
// rustc: compiler/rustc_ast/src/attr/mod.rs:846 mk_attr_name_value_str
export function mk_attr_name_value_str(
  g: AttrIdGenerator,
  style: AttrStyle,
  name: Symbol,
  val: Symbol,
  span: Span,
): Attribute {
  const lit = token.Lit.new(token.LitKind.Str, escape_string_symbol(val), undefined);
  const attrs: AttrVec = [];
  const expr = new Expr(DUMMY_NODE_ID, { $: "Lit", _0: lit }, span, attrs, undefined);
  const path = Path.from_ident(Ident.new(name, span));
  const args: AttrArgs = { $: "Eq", eq_span: span, expr };

  const tokens = mk_attr_tokens(
    style,
    AttrTokenStream.new([
      { $: "Token", _0: Token.from_ast_ident(Ident.new(name, span)), _1: Spacing.Alone },
      { $: "Token", _0: Token.new(TokenKind.Eq, span), _1: Spacing.Alone },
      {
        $: "Token",
        _0: Token.new(TokenKind.lit(lit.kind, lit.symbol, lit.suffix), span),
        _1: Spacing.Alone,
      },
    ]),
    span,
  );

  return mk_attr_from_item(g, new AttrItem(Safety.Default, path, args, span), tokens, style, span);
}

// rustc: compiler/rustc_ast/src/attr/mod.rs:886 filter_by_name
export function* filter_by_name(attrs: readonly Attribute[], name: Symbol): Generator<Attribute, void, undefined> {
  for (const attr of attrs) {
    if (attr.has_name(name)) yield attr;
  }
}

// rustc: compiler/rustc_ast/src/attr/mod.rs:890 find_by_name
export function find_by_name(attrs: readonly Attribute[], name: Symbol): Attribute | undefined {
  const r = filter_by_name(attrs, name).next();
  return r.done === true ? undefined : r.value;
}

// rustc: compiler/rustc_ast/src/attr/mod.rs:894 first_attr_value_str_by_name
export function first_attr_value_str_by_name(attrs: readonly Attribute[], name: Symbol): Symbol | undefined {
  const attr = find_by_name(attrs, name);
  return attr === undefined ? undefined : attr.value_str();
}

// rustc: compiler/rustc_ast/src/attr/mod.rs:898 contains_name
export function contains_name(attrs: readonly Attribute[], name: Symbol): boolean {
  return find_by_name(attrs, name) !== undefined;
}

// rustc: compiler/rustc_ast/src/attr/mod.rs:902 list_contains_name
export function list_contains_name(items: readonly MetaItemInner[], name: Symbol): boolean {
  return items.some((item) => MetaItemInner.has_name(item, name));
}

// rustc: compiler/rustc_ast/src/attr/mod.rs:907 value_as_str
ast.MetaItemLit.prototype.value_as_str = function (this: MetaItemLit): Symbol | undefined {
  const lit = ast.LitKind.from_token_lit(this.as_token_lit());
  return lit.$ === "Ok" ? ast.LitKind.str(lit._0) : undefined;
};

// rustc-trait: compiler/rustc_ast/src/attr/mod.rs:912 AttributeExt
// PORT: supertrait `Debug`: an implementing type has a `debug_<T>` fn. The provided methods
// (`has_name`, `has_any_name`, `path`, `is_proc_macro_attr`) are written in `AttributeExt_provided`.
export interface AttributeExt<T> {
  // rustc: compiler/rustc_ast/src/attr/mod.rs:913 id
  id(self: T): AttrId;

  /// For a single-segment attribute (i.e., `#[attr]` and not `#[path::atrr]`),
  /// return the name of the attribute; otherwise, returns `None`.
  // rustc: compiler/rustc_ast/src/attr/mod.rs:917 name
  name(self: T): Symbol | undefined;

  /// Get the meta item list, `#[attr(meta item list)]`
  // rustc: compiler/rustc_ast/src/attr/mod.rs:920 meta_item_list
  meta_item_list(self: T): MetaItemInner[] | undefined;

  /// Gets the value literal, as string, when using `#[attr = value]`
  // rustc: compiler/rustc_ast/src/attr/mod.rs:923 value_str
  value_str(self: T): Symbol | undefined;

  /// Gets the span of the value literal, as string, when using `#[attr = value]`
  // rustc: compiler/rustc_ast/src/attr/mod.rs:926 value_span
  value_span(self: T): Span | undefined;

  /// Checks whether the path of this attribute matches the name.
  ///
  /// Matches one segment of the path to each element in `name`
  // rustc: compiler/rustc_ast/src/attr/mod.rs:931 path_matches
  path_matches(self: T, name: readonly Symbol[]): boolean;

  /// Returns `true` if it is a sugared doc comment (`///` or `//!` for example).
  /// So `#[doc = "doc"]` (which is a doc comment) and `#[doc(...)]` (which is not
  /// a doc comment) will return `false`.
  // rustc: compiler/rustc_ast/src/attr/mod.rs:936 is_doc_comment
  is_doc_comment(self: T): Span | undefined;

  /// Returns true if the attribute's first *and only* path segment is equal to the passed-in
  /// symbol.
  // (provided)
  has_name(self: T, name: Symbol): boolean;

  /// Returns true if the attribute's first *and only* path segment is any of the passed-in
  /// symbols.
  // (provided)
  has_any_name(self: T, names: readonly Symbol[]): boolean;

  /// get the span of the entire attribute
  // rustc: compiler/rustc_ast/src/attr/mod.rs:953 span
  span(self: T): Span;

  /// Returns whether the attribute is a path, without any arguments.
  // rustc: compiler/rustc_ast/src/attr/mod.rs:956 is_word
  is_word(self: T): boolean;

  // (provided)
  path(self: T): Symbol[];

  // rustc: compiler/rustc_ast/src/attr/mod.rs:962 path_span
  path_span(self: T): Span | undefined;

  /// Returns None for doc comments
  // rustc: compiler/rustc_ast/src/attr/mod.rs:965 symbol_path
  symbol_path(self: T): Symbol[] | undefined;

  /// Returns the documentation if this is a doc comment or a sugared doc comment.
  /// * `///doc` returns `Some("doc")`.
  /// * `#[doc = "doc"]` returns `Some("doc")`.
  /// * `#[doc(...)]` returns `None`.
  // rustc: compiler/rustc_ast/src/attr/mod.rs:971 doc_str
  doc_str(self: T): Symbol | undefined;

  /// Returns whether this attribute is any of the proc macro attributes.
  /// i.e. `proc_macro`, `proc_macro_attribute` or `proc_macro_derive`.
  // (provided)
  is_proc_macro_attr(self: T): boolean;

  /// Returns true if this attribute is `#[automatically_deived]`.
  // rustc: compiler/rustc_ast/src/attr/mod.rs:981 is_automatically_derived_attr
  is_automatically_derived_attr(self: T): boolean;

  /// Returns the documentation and its kind if this is a doc comment or a sugared doc comment.
  /// * `///doc` returns `Some(("doc", CommentKind::Line))`.
  /// * `/** doc */` returns `Some(("doc", CommentKind::Block))`.
  /// * `#[doc = "doc"]` returns `Some(("doc", CommentKind::Line))`.
  /// * `#[doc(...)]` returns `None`.
  // rustc: compiler/rustc_ast/src/attr/mod.rs:988 doc_str_and_fragment_kind
  doc_str_and_fragment_kind(self: T): [Symbol, DocFragmentKind] | undefined;

  /// Returns outer or inner if this is a doc attribute or a sugared doc
  /// comment, otherwise None.
  ///
  /// This is used in the case of doc comments on modules, to decide whether
  /// to resolve intra-doc links against the symbols in scope within the
  /// commented module (for inner doc) vs within its parent module (for outer
  /// doc).
  // rustc: compiler/rustc_ast/src/attr/mod.rs:997 doc_resolution_scope
  doc_resolution_scope(self: T): AttrStyle | undefined;

  /// Returns `true` if this attribute contains `doc(hidden)`.
  // rustc: compiler/rustc_ast/src/attr/mod.rs:1000 is_doc_hidden
  is_doc_hidden(self: T): boolean;

  /// Returns `true` is this attribute contains `doc(keyword)` or `doc(attribute)`.
  // rustc: compiler/rustc_ast/src/attr/mod.rs:1003 is_doc_keyword_or_attribute
  is_doc_keyword_or_attribute(self: T): boolean;

  /// Returns `true` if this is a `#[rustc_doc_primitive]` attribute.
  // rustc: compiler/rustc_ast/src/attr/mod.rs:1006 is_rustc_doc_primitive
  is_rustc_doc_primitive(self: T): boolean;
}

type AttributeExtProvided = "has_name" | "has_any_name" | "path" | "is_proc_macro_attr";

// PORT: the provided methods of `AttributeExt`. An impl lists its required methods (and any
// overrides); `self.m()` inside a provided method dispatches through the finished impl object.
function AttributeExt_provided<T>(
  impl: Omit<AttributeExt<T>, AttributeExtProvided> & Partial<Pick<AttributeExt<T>, AttributeExtProvided>>,
): AttributeExt<T> {
  const this_: AttributeExt<T> = {
    // rustc: compiler/rustc_ast/src/attr/mod.rs:941 has_name
    has_name(self: T, name: Symbol): boolean {
      const x = this_.name(self);
      return x !== undefined ? x === name : false;
    },

    // rustc: compiler/rustc_ast/src/attr/mod.rs:948 has_any_name
    has_any_name(self: T, names: readonly Symbol[]): boolean {
      return names.some((name) => this_.has_name(self, name));
    },

    // rustc: compiler/rustc_ast/src/attr/mod.rs:958 path
    path(self: T): Symbol[] {
      return this_.symbol_path(self) ?? [sym.doc];
    },

    // rustc: compiler/rustc_ast/src/attr/mod.rs:975 is_proc_macro_attr
    is_proc_macro_attr(self: T): boolean {
      return [sym.proc_macro, sym.proc_macro_attribute, sym.proc_macro_derive].some((kind) =>
        this_.has_name(self, kind),
      );
    },

    ...impl,
  };
  return this_;
}

/** The `AttributeExt` impls, by implementing type. */
export const AttributeExt = {
  Attribute: AttributeExt_Attribute,
};

// FIXME(fn_delegation): use function delegation instead of manually forwarding

// rustc: compiler/rustc_ast/src/attr/mod.rs:1012 id
Attribute.prototype.id_ = function (this: Attribute): AttrId {
  return AttributeExt.Attribute.id(this);
};

// rustc: compiler/rustc_ast/src/attr/mod.rs:1016 name
Attribute.prototype.name = function (this: Attribute): Symbol | undefined {
  return AttributeExt.Attribute.name(this);
};

// rustc: compiler/rustc_ast/src/attr/mod.rs:1020 meta_item_list
Attribute.prototype.meta_item_list = function (this: Attribute): MetaItemInner[] | undefined {
  return AttributeExt.Attribute.meta_item_list(this);
};

// rustc: compiler/rustc_ast/src/attr/mod.rs:1024 value_str
Attribute.prototype.value_str = function (this: Attribute): Symbol | undefined {
  return AttributeExt.Attribute.value_str(this);
};

// rustc: compiler/rustc_ast/src/attr/mod.rs:1028 value_span
Attribute.prototype.value_span = function (this: Attribute): Span | undefined {
  return AttributeExt.Attribute.value_span(this);
};

// rustc: compiler/rustc_ast/src/attr/mod.rs:1032 path_matches
Attribute.prototype.path_matches = function (this: Attribute, name: readonly Symbol[]): boolean {
  return AttributeExt.Attribute.path_matches(this, name);
};

// on ast attributes we return a bool since that's what most code already expects
// rustc: compiler/rustc_ast/src/attr/mod.rs:1037 is_doc_comment
Attribute.prototype.is_doc_comment = function (this: Attribute): boolean {
  return AttributeExt.Attribute.is_doc_comment(this) !== undefined;
};

// rustc: compiler/rustc_ast/src/attr/mod.rs:1042 has_name
Attribute.prototype.has_name = function (this: Attribute, name: Symbol): boolean {
  return AttributeExt.Attribute.has_name(this, name);
};

// rustc: compiler/rustc_ast/src/attr/mod.rs:1047 has_any_name
Attribute.prototype.has_any_name = function (this: Attribute, names: readonly Symbol[]): boolean {
  return AttributeExt.Attribute.has_any_name(this, names);
};

// rustc: compiler/rustc_ast/src/attr/mod.rs:1051 span
Attribute.prototype.span_ = function (this: Attribute): Span {
  return AttributeExt.Attribute.span(this);
};

// rustc: compiler/rustc_ast/src/attr/mod.rs:1055 is_word
Attribute.prototype.is_word = function (this: Attribute): boolean {
  return AttributeExt.Attribute.is_word(this);
};

// rustc: compiler/rustc_ast/src/attr/mod.rs:1059 path
Attribute.prototype.path = function (this: Attribute): Symbol[] {
  return AttributeExt.Attribute.path(this);
};

// rustc: compiler/rustc_ast/src/attr/mod.rs:1063 doc_str
Attribute.prototype.doc_str = function (this: Attribute): Symbol | undefined {
  return AttributeExt.Attribute.doc_str(this);
};

// rustc: compiler/rustc_ast/src/attr/mod.rs:1067 is_proc_macro_attr
Attribute.prototype.is_proc_macro_attr = function (this: Attribute): boolean {
  return AttributeExt.Attribute.is_proc_macro_attr(this);
};

// rustc: compiler/rustc_ast/src/attr/mod.rs:1071 doc_str_and_fragment_kind
Attribute.prototype.doc_str_and_fragment_kind = function (this: Attribute): [Symbol, DocFragmentKind] | undefined {
  return AttributeExt.Attribute.doc_str_and_fragment_kind(this);
};
