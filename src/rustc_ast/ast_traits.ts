// Port of compiler/rustc_ast/src/ast_traits.rs
//! A set of traits implemented for various AST nodes,
//! typically those used in AST fragments during macro expansion.
//! The traits are not implemented exhaustively, only when actually necessary.
//
// Types and derived Debug impls are generated into ast_traits.gen.ts (tools/codegen/types.ts).
//
// PORT: trait dispatch (PORTING §5, "pass function tables when dispatch depends on the type"). Each
// trait is an interface over the implementing type `T` whose methods take `self: T`, plus a same-named
// const table holding the impls by implementing type: `HasNodeId.Expr.node_id(e)`,
// `HasAttrs.Item.SUPPORTS_CUSTOM_INNER_ATTRS`, `HasTokens.StmtKind.tokens(kind)`. Generic impls
// (`Box<T>`, `Option<T>`, `WithTokens<T>`, `AstNodeWrapper<W, Tag>`) are functions from the impl of
// the type parameter to an impl object (callers should create them once, not per call). Generic code
// bounded by these traits (`R: HasAttrs + HasTokens`) takes the impl objects as arguments.
// The `impl_has_*!` macros are expanded through local functions called once per listed type.
//
// PORT: `&mut T` results: `node_id_mut() -> &mut NodeId` and `tokens_mut() -> Option<&mut Option<..>>`
// return a `MutRef` view onto the field. `visit_attrs(f: FnOnce(&mut AttrVec))` passes the `AttrVec`
// array itself; `f` mutates it in place (upstream callers only `insert`/`flat_map_in_place`).
import type { MutRef } from "../rustc_span/hygiene.ts";
import { type Debug, debug_struct, type Fmt } from "../std/fmt.ts";
import { unported, unreachable } from "../std/panic.ts";
import type {
  Arm,
  AssocItem,
  AttrItem,
  AttrVec,
  Attribute,
  Block,
  Crate,
  Expr,
  ExprField,
  FieldDef,
  ForeignItem,
  GenericParam,
  Item,
  Param,
  Pat,
  PatField,
  Path,
  Stmt,
  StmtKind,
  Ty,
  Variant,
  Visibility,
  WherePredicate,
} from "./ast.ts";
import * as gen from "./ast_traits.gen.ts";
import type { NodeId } from "./node_id.ts";
import type { LazyAttrTokenStream, WithTokens } from "./tokenstream.ts";

export * from "./ast_traits.gen.ts";

// PORT: `&mut self.<field>` -> a `MutRef` view onto the field.
function field_mut<O, K extends keyof O>(o: O, k: K): MutRef<O[K]> {
  return {
    get value(): O[K] {
      return o[k];
    },
    set value(v: O[K]) {
      o[k] = v;
    },
  };
}

/** `&[]` */
const EMPTY_ATTRS: readonly Attribute[] = Object.freeze([]);

// rustc-trait: compiler/rustc_ast/src/ast_traits.rs:16 HasNodeId
/// A trait for AST nodes having an ID.
export interface HasNodeId<T> {
  // rustc: compiler/rustc_ast/src/ast_traits.rs:17 node_id
  node_id(self: T): NodeId;
  // rustc: compiler/rustc_ast/src/ast_traits.rs:18 node_id_mut
  node_id_mut(self: T): MutRef<NodeId>;
}

// PORT: `macro_rules! impl_has_node_id`, one call per listed type.
function impl_has_node_id<T extends { id: NodeId }>(): HasNodeId<T> {
  return {
    // rustc: compiler/rustc_ast/src/ast_traits.rs:25 node_id
    node_id(self: T): NodeId {
      return self.id;
    },
    // rustc: compiler/rustc_ast/src/ast_traits.rs:28 node_id_mut
    node_id_mut(self: T): MutRef<NodeId> {
      return field_mut<{ id: NodeId }, "id">(self, "id");
    },
  };
}

const has_node_id_impls = {
  Arm: impl_has_node_id<Arm>(),
  AssocItem: impl_has_node_id<AssocItem>(),
  Crate: impl_has_node_id<Crate>(),
  Expr: impl_has_node_id<Expr>(),
  ExprField: impl_has_node_id<ExprField>(),
  FieldDef: impl_has_node_id<FieldDef>(),
  ForeignItem: impl_has_node_id<ForeignItem>(),
  GenericParam: impl_has_node_id<GenericParam>(),
  Item: impl_has_node_id<Item>(),
  Param: impl_has_node_id<Param>(),
  Pat: impl_has_node_id<Pat>(),
  PatField: impl_has_node_id<PatField>(),
  Stmt: impl_has_node_id<Stmt>(),
  Ty: impl_has_node_id<Ty>(),
  Variant: impl_has_node_id<Variant>(),
  WherePredicate: impl_has_node_id<WherePredicate>(),

  /** `impl<T: HasNodeId> HasNodeId for Box<T>` */
  Box<T>(T_: HasNodeId<T>): HasNodeId<T> {
    return {
      // rustc: compiler/rustc_ast/src/ast_traits.rs:56 node_id
      node_id(self: T): NodeId {
        return T_.node_id(self);
      },
      // rustc: compiler/rustc_ast/src/ast_traits.rs:59 node_id_mut
      node_id_mut(self: T): MutRef<NodeId> {
        return T_.node_id_mut(self);
      },
    };
  },
};

// rustc-trait: compiler/rustc_ast/src/ast_traits.rs:65 HasTokens
/// A trait for AST nodes having (or not having) collected tokens.
// PORT: supertrait `HasAttrs`: an implementing type also has a `HasAttrs` impl; code bounded by both
// takes both impl objects.
export interface HasTokens<T> {
  // rustc: compiler/rustc_ast/src/ast_traits.rs:66 tokens
  tokens(self: T): LazyAttrTokenStream | undefined;
  // rustc: compiler/rustc_ast/src/ast_traits.rs:67 tokens_mut
  tokens_mut(self: T): MutRef<LazyAttrTokenStream | undefined> | undefined;
}

// PORT: `macro_rules! impl_has_tokens`, one call per listed type.
function impl_has_tokens<T extends { tokens: LazyAttrTokenStream | undefined }>(): HasTokens<T> {
  return {
    // rustc: compiler/rustc_ast/src/ast_traits.rs:74 tokens
    tokens(self: T): LazyAttrTokenStream | undefined {
      return self.tokens;
    },
    // rustc: compiler/rustc_ast/src/ast_traits.rs:77 tokens_mut
    tokens_mut(self: T): MutRef<LazyAttrTokenStream | undefined> | undefined {
      return field_mut<{ tokens: LazyAttrTokenStream | undefined }, "tokens">(self, "tokens");
    },
  };
}

// PORT: `macro_rules! impl_has_tokens_none`, one call per listed type.
function impl_has_tokens_none<T>(): HasTokens<T> {
  return {
    // rustc: compiler/rustc_ast/src/ast_traits.rs:89 tokens
    tokens(_self: T): LazyAttrTokenStream | undefined {
      return undefined;
    },
    // rustc: compiler/rustc_ast/src/ast_traits.rs:92 tokens_mut
    tokens_mut(_self: T): MutRef<LazyAttrTokenStream | undefined> | undefined {
      return undefined;
    },
  };
}

const has_tokens_impls = {
  AssocItem: impl_has_tokens<AssocItem>(),
  Expr: impl_has_tokens<Expr>(),
  ForeignItem: impl_has_tokens<ForeignItem>(),
  Item: impl_has_tokens<Item>(),
  Arm: impl_has_tokens_none<Arm>(),
  ExprField: impl_has_tokens_none<ExprField>(),
  FieldDef: impl_has_tokens_none<FieldDef>(),
  GenericParam: impl_has_tokens_none<GenericParam>(),
  Param: impl_has_tokens_none<Param>(),
  PatField: impl_has_tokens_none<PatField>(),
  Variant: impl_has_tokens_none<Variant>(),
  WherePredicate: impl_has_tokens_none<WherePredicate>(),

  /** `impl<T: HasAttrs> HasTokens for WithTokens<T>` */
  WithTokens<T>(): HasTokens<WithTokens<T>> {
    return {
      // rustc: compiler/rustc_ast/src/ast_traits.rs:113 tokens
      tokens(self: WithTokens<T>): LazyAttrTokenStream | undefined {
        return self.tokens;
      },
      // rustc: compiler/rustc_ast/src/ast_traits.rs:116 tokens_mut
      tokens_mut(self: WithTokens<T>): MutRef<LazyAttrTokenStream | undefined> | undefined {
        return field_mut(self, "tokens");
      },
    };
  },

  /** `impl<T: HasTokens> HasTokens for Option<T>` */
  Option<T>(T_: HasTokens<T>): HasTokens<T | undefined> {
    return {
      // rustc: compiler/rustc_ast/src/ast_traits.rs:122 tokens
      tokens(self: T | undefined): LazyAttrTokenStream | undefined {
        return self === undefined ? undefined : T_.tokens(self);
      },
      // rustc: compiler/rustc_ast/src/ast_traits.rs:125 tokens_mut
      tokens_mut(self: T | undefined): MutRef<LazyAttrTokenStream | undefined> | undefined {
        return self === undefined ? undefined : T_.tokens_mut(self);
      },
    };
  },

  /** `impl<T: HasTokens> HasTokens for Box<T>` */
  Box<T>(T_: HasTokens<T>): HasTokens<T> {
    return {
      // rustc: compiler/rustc_ast/src/ast_traits.rs:131 tokens
      tokens(self: T): LazyAttrTokenStream | undefined {
        return T_.tokens(self);
      },
      // rustc: compiler/rustc_ast/src/ast_traits.rs:134 tokens_mut
      tokens_mut(self: T): MutRef<LazyAttrTokenStream | undefined> | undefined {
        return T_.tokens_mut(self);
      },
    };
  },

  StmtKind: {
    // rustc: compiler/rustc_ast/src/ast_traits.rs:140 tokens
    tokens(self: StmtKind): LazyAttrTokenStream | undefined {
      switch (self.$) {
        case "Let":
          return self._0.tokens;
        case "Item":
          return HasTokens.Item.tokens(self._0);
        case "Expr":
        case "Semi":
          return HasTokens.Expr.tokens(self._0);
        case "Empty":
          return undefined;
        case "MacCall":
          return self._0.tokens;
      }
    },
    // rustc: compiler/rustc_ast/src/ast_traits.rs:149 tokens_mut
    tokens_mut(self: StmtKind): MutRef<LazyAttrTokenStream | undefined> | undefined {
      switch (self.$) {
        case "Let":
          return field_mut(self._0, "tokens");
        case "Item":
          return HasTokens.Item.tokens_mut(self._0);
        case "Expr":
        case "Semi":
          return HasTokens.Expr.tokens_mut(self._0);
        case "Empty":
          return undefined;
        case "MacCall":
          return field_mut(self._0, "tokens");
      }
    },
  } satisfies HasTokens<StmtKind>,

  Stmt: {
    // rustc: compiler/rustc_ast/src/ast_traits.rs:161 tokens
    tokens(self: Stmt): LazyAttrTokenStream | undefined {
      return HasTokens.StmtKind.tokens(self.kind);
    },
    // rustc: compiler/rustc_ast/src/ast_traits.rs:164 tokens_mut
    tokens_mut(self: Stmt): MutRef<LazyAttrTokenStream | undefined> | undefined {
      return HasTokens.StmtKind.tokens_mut(self.kind);
    },
  } satisfies HasTokens<Stmt>,

  Attribute: {
    // rustc: compiler/rustc_ast/src/ast_traits.rs:170 tokens
    tokens(self: Attribute): LazyAttrTokenStream | undefined {
      const kind = self.kind;
      switch (kind.$) {
        case "Normal":
          return kind._0.tokens;
        case "Synthetic":
        case "DocComment":
          return unreachable();
      }
    },
    // rustc: compiler/rustc_ast/src/ast_traits.rs:176 tokens_mut
    tokens_mut(self: Attribute): MutRef<LazyAttrTokenStream | undefined> | undefined {
      const kind = self.kind;
      switch (kind.$) {
        case "Normal":
          return field_mut(kind._0, "tokens");
        case "Synthetic":
        case "DocComment":
          return unreachable();
      }
    },
  } satisfies HasTokens<Attribute>,
};

// rustc-trait: compiler/rustc_ast/src/ast_traits.rs:185 HasAttrs
/// A trait for AST nodes having (or not having) attributes.
export interface HasAttrs<T> {
  /// This is `true` if this `HasAttrs` might support 'custom' (proc-macro) inner
  /// attributes. Attributes like `#![cfg]` and `#![cfg_attr]` are not
  /// considered 'custom' attributes.
  ///
  /// If this is `false`, then this `HasAttrs` definitely does
  /// not support 'custom' inner attributes, which enables some optimizations
  /// during token collection.
  readonly SUPPORTS_CUSTOM_INNER_ATTRS: boolean;
  // rustc: compiler/rustc_ast/src/ast_traits.rs:194 attrs
  attrs(self: T): readonly Attribute[];
  // rustc: compiler/rustc_ast/src/ast_traits.rs:195 visit_attrs
  visit_attrs(self: T, f: (attrs: AttrVec) => void): void;
}

// PORT: `macro_rules! impl_has_attrs`, one call per listed type; `$inner` is the const's value.
function impl_has_attrs<T extends { attrs: AttrVec }>(inner: boolean): HasAttrs<T> {
  return {
    SUPPORTS_CUSTOM_INNER_ATTRS: inner,

    // rustc: compiler/rustc_ast/src/ast_traits.rs:205 attrs
    attrs(self: T): readonly Attribute[] {
      return self.attrs;
    },

    // rustc: compiler/rustc_ast/src/ast_traits.rs:209 visit_attrs
    visit_attrs(self: T, f: (attrs: AttrVec) => void): void {
      f(self.attrs);
    },
  };
}

// PORT: `macro_rules! impl_has_attrs_none`, one call per listed type.
function impl_has_attrs_none<T>(): HasAttrs<T> {
  return {
    SUPPORTS_CUSTOM_INNER_ATTRS: false,
    // rustc: compiler/rustc_ast/src/ast_traits.rs:222 attrs
    attrs(_self: T): readonly Attribute[] {
      return EMPTY_ATTRS;
    },
    // rustc: compiler/rustc_ast/src/ast_traits.rs:225 visit_attrs
    visit_attrs(_self: T, _f: (attrs: AttrVec) => void): void {},
  };
}

const has_attrs_impls = {
  AssocItem: impl_has_attrs<AssocItem>(true),
  ForeignItem: impl_has_attrs<ForeignItem>(true),
  Item: impl_has_attrs<Item>(true),
  Arm: impl_has_attrs<Arm>(false),
  Crate: impl_has_attrs<Crate>(false),
  Expr: impl_has_attrs<Expr>(false),
  ExprField: impl_has_attrs<ExprField>(false),
  FieldDef: impl_has_attrs<FieldDef>(false),
  GenericParam: impl_has_attrs<GenericParam>(false),
  Param: impl_has_attrs<Param>(false),
  PatField: impl_has_attrs<PatField>(false),
  Variant: impl_has_attrs<Variant>(false),
  WherePredicate: impl_has_attrs<WherePredicate>(false),
  Attribute: impl_has_attrs_none<Attribute>(),
  AttrItem: impl_has_attrs_none<AttrItem>(),
  Block: impl_has_attrs_none<Block>(),
  Pat: impl_has_attrs_none<Pat>(),
  Path: impl_has_attrs_none<Path>(),
  Ty: impl_has_attrs_none<Ty>(),
  Visibility: impl_has_attrs_none<Visibility>(),

  /** `impl<T: HasAttrs> HasAttrs for WithTokens<T>` */
  WithTokens<T>(T_: HasAttrs<T>): HasAttrs<WithTokens<T>> {
    return {
      SUPPORTS_CUSTOM_INNER_ATTRS: T_.SUPPORTS_CUSTOM_INNER_ATTRS,
      // rustc: compiler/rustc_ast/src/ast_traits.rs:254 attrs
      attrs(self: WithTokens<T>): readonly Attribute[] {
        return T_.attrs(self.node);
      },
      // rustc: compiler/rustc_ast/src/ast_traits.rs:257 visit_attrs
      visit_attrs(self: WithTokens<T>, f: (attrs: AttrVec) => void): void {
        T_.visit_attrs(self.node, f);
      },
    };
  },

  /** `impl<T: HasAttrs> HasAttrs for Box<T>` */
  Box<T>(T_: HasAttrs<T>): HasAttrs<T> {
    return {
      SUPPORTS_CUSTOM_INNER_ATTRS: T_.SUPPORTS_CUSTOM_INNER_ATTRS,
      // rustc: compiler/rustc_ast/src/ast_traits.rs:264 attrs
      attrs(self: T): readonly Attribute[] {
        return T_.attrs(self);
      },
      // rustc: compiler/rustc_ast/src/ast_traits.rs:267 visit_attrs
      visit_attrs(self: T, f: (attrs: AttrVec) => void): void {
        T_.visit_attrs(self, f);
      },
    };
  },

  /** `impl<T: HasAttrs> HasAttrs for Option<T>` */
  Option<T>(T_: HasAttrs<T>): HasAttrs<T | undefined> {
    return {
      SUPPORTS_CUSTOM_INNER_ATTRS: T_.SUPPORTS_CUSTOM_INNER_ATTRS,
      // rustc: compiler/rustc_ast/src/ast_traits.rs:274 attrs
      attrs(self: T | undefined): readonly Attribute[] {
        return self === undefined ? EMPTY_ATTRS : T_.attrs(self);
      },
      // rustc: compiler/rustc_ast/src/ast_traits.rs:277 visit_attrs
      visit_attrs(self: T | undefined, f: (attrs: AttrVec) => void): void {
        if (self !== undefined) {
          const inner = self;
          T_.visit_attrs(inner, f);
        }
      },
    };
  },

  StmtKind: {
    // This might be a `StmtKind::Item`, which contains
    // an item that supports inner attrs.
    SUPPORTS_CUSTOM_INNER_ATTRS: true,

    // rustc: compiler/rustc_ast/src/ast_traits.rs:289 attrs
    attrs(self: StmtKind): readonly Attribute[] {
      switch (self.$) {
        case "Let":
          return self._0.attrs;
        case "Expr":
        case "Semi":
          return HasAttrs.Expr.attrs(self._0);
        case "Item":
          return HasAttrs.Item.attrs(self._0);
        case "Empty":
          return EMPTY_ATTRS;
        case "MacCall":
          return self._0.attrs;
      }
    },

    // rustc: compiler/rustc_ast/src/ast_traits.rs:299 visit_attrs
    visit_attrs(self: StmtKind, f: (attrs: AttrVec) => void): void {
      switch (self.$) {
        case "Let":
          f(self._0.attrs);
          break;
        case "Expr":
        case "Semi":
          HasAttrs.Expr.visit_attrs(self._0, f);
          break;
        case "Item":
          HasAttrs.Item.visit_attrs(self._0, f);
          break;
        case "Empty":
          break;
        case "MacCall":
          f(self._0.attrs);
          break;
      }
    },
  } satisfies HasAttrs<StmtKind>,

  Stmt: {
    // PORT: a getter, because the `HasAttrs` table does not exist yet while this object is built.
    get SUPPORTS_CUSTOM_INNER_ATTRS(): boolean {
      return HasAttrs.StmtKind.SUPPORTS_CUSTOM_INNER_ATTRS;
    },
    // rustc: compiler/rustc_ast/src/ast_traits.rs:312 attrs
    attrs(self: Stmt): readonly Attribute[] {
      return HasAttrs.StmtKind.attrs(self.kind);
    },
    // rustc: compiler/rustc_ast/src/ast_traits.rs:315 visit_attrs
    visit_attrs(self: Stmt, f: (attrs: AttrVec) => void): void {
      HasAttrs.StmtKind.visit_attrs(self.kind, f);
    },
  } satisfies HasAttrs<Stmt>,
};

/// A newtype around an AST node that implements the traits above if the node implements them.
export type AstNodeWrapper<Wrapped, Tag> = gen.AstNodeWrapper<Wrapped, Tag>;
/** `impl<Wrapped, Tag> AstNodeWrapper<Wrapped, Tag>` and `From` (statics on the generated class). */
export const AstNodeWrapper = Object.assign(gen.AstNodeWrapper, {
  // rustc: compiler/rustc_ast/src/ast_traits.rs:328 new
  new<Wrapped, Tag>(wrapped: Wrapped, _tag: Tag): AstNodeWrapper<Wrapped, Tag> {
    // PORT: `tag: Default::default()` (`PhantomData`) -> `undefined`.
    return new gen.AstNodeWrapper<Wrapped, Tag>(wrapped, undefined);
  },

  // rustc: compiler/rustc_ast/src/ast_traits.rs:332 from_mut
  from_mut<Wrapped, Tag>(wrapped: Wrapped, _tag: Tag): AstNodeWrapper<Wrapped, Tag> {
    // SAFETY: `AstNodeWrapper` is `repr(transparent)` w.r.t `Wrapped`
    // PORT: the `repr(transparent)` cast -> a wrapper sharing the same node object. Mutations of the
    // node are seen by the caller; storing a different object into `.wrapped` is not (replace the node
    // in place instead).
    return new gen.AstNodeWrapper<Wrapped, Tag>(wrapped, undefined);
  },

  // FIXME: remove after `stmt_expr_attributes` is stabilized.
  // rustc: compiler/rustc_ast/src/ast_traits.rs:340 from
  from<T, Tag>(value: AstNodeWrapper<T, Tag>): AstNodeWrapper<T, Tag> {
    // PORT: `impl From<AstNodeWrapper<Box<T>, Tag>> for AstNodeWrapper<T, Tag>`: `Box<T>` is `T`.
    return new gen.AstNodeWrapper<T, Tag>(value.wrapped, value.tag);
  },
});

/** `impl<Wrapped: HasNodeId, Tag> HasNodeId for AstNodeWrapper<Wrapped, Tag>` */
function HasNodeId_AstNodeWrapper<Wrapped, Tag>(Wrapped_: HasNodeId<Wrapped>): HasNodeId<AstNodeWrapper<Wrapped, Tag>> {
  return {
    // rustc: compiler/rustc_ast/src/ast_traits.rs:346 node_id
    node_id(self: AstNodeWrapper<Wrapped, Tag>): NodeId {
      return Wrapped_.node_id(self.wrapped);
    },
    // rustc: compiler/rustc_ast/src/ast_traits.rs:349 node_id_mut
    node_id_mut(self: AstNodeWrapper<Wrapped, Tag>): MutRef<NodeId> {
      return Wrapped_.node_id_mut(self.wrapped);
    },
  };
}

/** `impl<Wrapped: HasAttrs, Tag> HasAttrs for AstNodeWrapper<Wrapped, Tag>` */
function HasAttrs_AstNodeWrapper<Wrapped, Tag>(Wrapped_: HasAttrs<Wrapped>): HasAttrs<AstNodeWrapper<Wrapped, Tag>> {
  return {
    SUPPORTS_CUSTOM_INNER_ATTRS: Wrapped_.SUPPORTS_CUSTOM_INNER_ATTRS,
    // rustc: compiler/rustc_ast/src/ast_traits.rs:356 attrs
    attrs(self: AstNodeWrapper<Wrapped, Tag>): readonly Attribute[] {
      return Wrapped_.attrs(self.wrapped);
    },
    // rustc: compiler/rustc_ast/src/ast_traits.rs:359 visit_attrs
    visit_attrs(self: AstNodeWrapper<Wrapped, Tag>, f: (attrs: AttrVec) => void): void {
      Wrapped_.visit_attrs(self.wrapped, f);
    },
  };
}

// rustc: compiler/rustc_ast/src/ast_traits.rs:365 fmt
// PORT: generic type: the Debug fns of the type parameters follow `(v, f)` (generator convention).
export function debug_AstNodeWrapper<Wrapped, Tag>(
  v: AstNodeWrapper<Wrapped, Tag>,
  f: Fmt,
  debug_Wrapped: Debug<Wrapped>,
  _debug_Tag: Debug<Tag>,
): string {
  return debug_struct(f, "AstNodeWrapper", [
    ["wrapped", debug_Wrapped(v.wrapped, f)],
    // PORT: `tag: PhantomData<Tag>`; its Debug prints `PhantomData<{core::any::type_name::<Tag>()}>`.
    ["tag", unported("Debug of PhantomData<Tag> (core::any::type_name)")],
  ]);
}

/** The `HasNodeId` impls, by implementing type. */
export const HasNodeId = { ...has_node_id_impls, AstNodeWrapper: HasNodeId_AstNodeWrapper };
/** The `HasTokens` impls, by implementing type. */
export const HasTokens = has_tokens_impls;
/** The `HasAttrs` impls, by implementing type. */
export const HasAttrs = { ...has_attrs_impls, AstNodeWrapper: HasAttrs_AstNodeWrapper };
