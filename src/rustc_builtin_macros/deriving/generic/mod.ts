// Port of compiler/rustc_builtin_macros/src/deriving/generic/mod.rs
//! Some code that abstracts away much of the boilerplate of writing
//! `derive` instances for traits. Among other things it manages getting
//! access to the fields of the 4 different sorts of structs and enum
//! variants, as well as creating the method and impl ast instances.
//!
//! Supported features (fairly exhaustive):
//!
//! - Methods taking any number of parameters of any type, and returning
//!   any type, other than vectors, bottom and closures.
//! - Generating `impl`s for types with type parameters and lifetimes
//!   (e.g., `Option<T>`), the parameters are automatically given the
//!   current trait as a bound. (This includes separate type parameters
//!   and lifetimes for methods.)
//! - Additional bounds on the type parameters (`TraitDef.additional_bounds`)
//!
//! The most important thing for implementors is the `Substructure` and
//! `SubstructureFields` objects. The latter groups 5 possibilities of the
//! arguments:
//!
//! - `Struct`, when `Self` is a struct (including tuple structs, e.g
//!   `struct T(i32, char)`).
//! - `EnumMatching`, when `Self` is an enum and all the arguments are the
//!   same variant of the enum (e.g., `Some(1)`, `Some(3)` and `Some(4)`)
//! - `EnumDiscr` when `Self` is an enum, for comparing the enum discriminants.
//! - `StaticEnum` and `StaticStruct` for static methods, where the type
//!   being derived upon is either an enum or struct respectively. (Any
//!   argument with type Self is just grouped among the non-self
//!   arguments.)
//!
//! In the first two cases, the values from the corresponding fields in
//! all the arguments are grouped together.
//!
//! The non-static cases have `Option<ident>` in several places associated
//! with field `expr`s. This represents the name of the field it is
//! associated with. It is only not `None` when the associated field has
//! an identifier in the source code. For example, the `x`s in the
//! following snippet
//!
//! ```rust
//! struct A {
//!     x: i32,
//! }
//!
//! struct B(i32);
//!
//! enum C {
//!     C0(i32),
//!     C1 { x: i32 }
//! }
//! ```
//!
//! The `i32`s in `B` and `C0` don't have an identifier, so the
//! `Option<ident>`s would be `None` for them.
//!
//! In the static cases, the structure is summarized, either into the just
//! spans of the fields or a list of spans and the field idents (for tuple
//! structs and record structs, respectively), or a list of these, for
//! enums (one for each variant). For empty struct and empty enum
//! variants, it is represented as a count of 0.
//!
//! # "`cs`" functions
//!
//! The `cs_...` functions ("combine substructure") are designed to
//! make life easier by providing some pre-made recipes for common
//! threads; mostly calling the function being derived on all the
//! arguments and then combining them back together in some way (or
//! letting the user chose that). They are not meant to be the only
//! way to handle the structures that this code creates.
//!
//! # Examples
//!
//! The following simplified `PartialEq` is used for in-code examples:
//!
//! ```rust
//! trait PartialEq {
//!     fn eq(&self, other: &Self) -> bool;
//! }
//!
//! impl PartialEq for i32 {
//!     fn eq(&self, other: &i32) -> bool {
//!         *self == *other
//!     }
//! }
//! ```
//!
//! Some examples of the values of `SubstructureFields` follow, using the
//! above `PartialEq`, `A`, `B` and `C`.
//!
//! ## Structs
//!
//! When generating the `expr` for the `A` impl, the `SubstructureFields` is
//!
//! ```text
//! Struct(vec![FieldInfo {
//!     span: <span of x>,
//!     name: Some(<ident of x>),
//!     self_: <expr for &self.x>,
//!     other: vec![<expr for &other.x>],
//! }])
//! ```
//!
//! For the `B` impl, called with `B(a)` and `B(b)`,
//!
//! ```text
//! Struct(vec![FieldInfo {
//!     span: <span of i32>,
//!     name: None,
//!     self_: <expr for &a>,
//!     other: vec![<expr for &b>],
//! }])
//! ```
//!
//! ## Enums
//!
//! When generating the `expr` for a call with `self == C0(a)` and `other
//! == C0(b)`, the SubstructureFields is
//!
//! ```text
//! EnumMatching(
//!     0,
//!     <ast::Variant for C0>,
//!     vec![FieldInfo {
//!         span: <span of i32>,
//!         name: None,
//!         self_: <expr for &a>,
//!         other: vec![<expr for &b>],
//!     }],
//! )
//! ```
//!
//! For `C1 {x}` and `C1 {x}`,
//!
//! ```text
//! EnumMatching(
//!     1,
//!     <ast::Variant for C1>,
//!     vec![FieldInfo {
//!         span: <span of x>,
//!         name: Some(<ident of x>),
//!         self_: <expr for &self.x>,
//!         other: vec![<expr for &other.x>],
//!     }],
//! )
//! ```
//!
//! For the discriminants,
//!
//! ```text
//! EnumDiscr(
//!     &[<ident of self discriminant>, <ident of other discriminant>],
//!     <expr to combine with>,
//! )
//! ```
//!
//! Note that this setup doesn't allow for the brute-force "match every variant
//! against every other variant" approach, which is bad because it produces a
//! quadratic amount of code (see #15375).
//!
//! ## Static
//!
//! A static method on the types above would result in,
//!
//! ```text
//! StaticStruct(<ast::VariantData of A>, Named(vec![(<ident of x>, <span of x>)]))
//!
//! StaticStruct(<ast::VariantData of B>, Unnamed(vec![<span of x>]))
//!
//! StaticEnum(
//!     <ast::EnumDef of C>,
//!     vec![
//!         (<ident of C0>, <span of C0>, Unnamed(vec![<span of i32>])),
//!         (<ident of C1>, <span of C1>, Named(vec![(<ident of x>, <span of x>)])),
//!     ],
//! )
//! ```

import { ast, clone_Ty, token, tokenstream, visit } from "../../../rustc_ast/lib.ts";
import {
  clone_Attribute,
  clone_Expr,
  clone_GenericBound,
  clone_GenericParam,
  clone_Generics,
  clone_Path,
  clone_WhereClause,
  clone_WherePredicateKind,
} from "../../../rustc_ast/ast.gen.ts";
import type { Attribute as attrs_Attribute } from "../../../rustc_attr_ir/attr.ts";
import { AttributeParser } from "../../../rustc_attr_parsing/interface.ts";
import type { ExtCtxt } from "../../../rustc_expand/base.ts";
import { DUMMY_SP, respan, Span } from "../../../rustc_span/lib.ts";
import { Ident, kw, sym, type Symbol } from "../../../rustc_span/symbol.ts";
import { assert, panic, unreachable, unwrap } from "../../../std/panic.ts";
import * as diagnostics from "../../diagnostics.ts";
import { call_unreachable, path_std } from "../mod.ts";

// PORT: `pub(crate) use SubstructureFields::*;` -> the variants are object literals tagged by `$`
// (`{ $: "Struct", _0: struct_def, _1: fields }`); `pub(crate) use rustc_ast as ast;` and
// `pub(crate) use smallvec::{SmallVec, smallvec};` -> import `ast` from rustc_ast/lib.ts; `SmallVec` is an array.
export { ast };

// PORT: struct with inherent methods -> class; the methods of `impl<'a> TraitDef<'a>` (line 452) are
// attached to the prototype below, in upstream order.
export interface TraitDef {
  expand(cx: ExtCtxt, item: ast.Item, push: (item: ast.Item) => void): void;
  expand_ext(cx: ExtCtxt, item: ast.Item, push: (item: ast.Item) => void, from_scratch: boolean): void;
  create_derived_impl(
    cx: ExtCtxt,
    type_ident: Ident,
    generics: ast.Generics,
    fields: Iterable<ast.FieldDef>,
    methods: Iterable<ast.AssocItem>,
    is_packed: boolean,
  ): ast.Item;
}
export class TraitDef {
  constructor(
    /// The span for the current #[derive(Foo)] header.
    public span: Span,

    /// Path of the trait, including any type parameters
    public path: ast.Path,

    /// Whether to skip adding the current trait as a bound to the type parameters of the type.
    public skip_path_as_bound: boolean,

    /// Whether `Copy` is needed as an additional bound on type parameters in a packed struct.
    public needs_copy_as_bound_if_packed: boolean,

    /// Additional bounds required of any type parameters of the type,
    /// other than the current trait
    public additional_bounds: ast.Path[],

    /// Can this trait be derived for unions?
    public supports_unions: boolean,

    public methods: MethodDef[],

    public is_const: boolean,

    /// The safety of the `impl`.
    public safety: ast.Safety,

    /// Whether the added `impl` should appear in rustdoc output.
    public document: boolean,
  ) {}
}

// PORT: the methods of `impl<'a> MethodDef<'a>` (line 790) are attached to the prototype below.
export interface MethodDef {
  call_substructure_method(cx: ExtCtxt, span: Span, fields: SubstructureFields, type_ident: Ident): BlockOrExpr;
  is_static(): boolean;
  get_selflike_args(cx: ExtCtxt, span: Span): ast.Expr[];
  create_method(cx: ExtCtxt, span: Span, body: BlockOrExpr): ast.AssocItem | undefined;
  expand_struct_method_body(cx: ExtCtxt, span: Span, struct_def: ast.VariantData, is_packed: boolean, type_ident: Ident): BlockOrExpr;
  expand_enum_method_body(cx: ExtCtxt, span: Span, enum_def: ast.EnumDef, type_ident: Ident): BlockOrExpr;
}
export class MethodDef {
  constructor(
    /// name of the method
    public name: Symbol,
    /// List of generics, e.g., `R: rand::Rng`
    public generics: ast.Generics,

    /// Is there is a `&self` argument? If not, it is a static function.
    public explicit_self: boolean,

    /// Arguments other than the self argument.
    public nonself_args: [ast.Ty, Symbol][],

    /// Whether this method has another arg of type `&self`.
    public has_other_selflike_arg: boolean,

    /// Returns type
    public ret_ty: ast.Ty,

    public attributes: ast.AttrVec,

    public fieldless_variants_strategy: FieldlessVariantsStrategy,

    public combine_substructure: CombineSubstructureFunc,
  ) {}
}

/// How to handle fieldless enum variants.
export type FieldlessVariantsStrategy =
  /// Combine fieldless variants into a single match arm.
  /// This assumes that relevant information has been handled
  /// by looking at the enum's discriminant.
  | "Unify"
  /// Don't do anything special about fieldless variants. They are
  /// handled like any other variant.
  | "Default"
  /// If all variants of the enum are fieldless, expand the special
  /// `AllFieldLessEnum` substructure, so that the entire enum can be handled
  /// at once.
  | "SpecializeIfAllVariantsFieldless";
export const FieldlessVariantsStrategy = {
  Unify: "Unify",
  Default: "Default",
  SpecializeIfAllVariantsFieldless: "SpecializeIfAllVariantsFieldless",
} as const;

/// Summary of the relevant parts of a struct/enum field.
export interface FieldInfo {
  span: Span;
  /// None for tuple structs/normal enum variants, Some for normal
  /// structs/struct enum variants.
  name: Ident | undefined;
  /// The expression corresponding to this field of `self`
  /// (specifically, a reference to it).
  self_expr: ast.Expr;
  /// The expression corresponding to a reference to this field in
  /// the other selflike argument.
  other_selflike_expr: ast.Expr | undefined;
  maybe_scalar: boolean;
}

export interface Substructure {
  fields: SubstructureFields;
  // FIXME: this is currently required to avoid issues with attribute macros after derives,
  // such as https://github.com/rust-lang/rust/issues/163800.
  // Ideally we would just use `Self` instead.
  type_ident: Ident;
}

/// A summary of the possible sets of fields.
export type SubstructureFields =
  /// A non-static method where `Self` is a struct.
  | { readonly $: "Struct"; _0: ast.VariantData; _1: FieldInfo[] }
  /// A non-static method handling the entire enum at once
  /// (after it has been determined that none of the enum
  /// variants has any fields).
  | { readonly $: "AllFieldlessEnum"; _0: ast.EnumDef }
  /// Matching variants of the enum: ast::Variant,
  /// fields: the field name is only non-`None` in the case of a struct
  /// variant.
  | { readonly $: "EnumMatching"; _0: ast.Variant; _1: FieldInfo[] }
  /// The discriminant of an enum. The field is the expression to combine the
  /// discriminant expression with; it will be `None` if no match is necessary.
  | { readonly $: "EnumDiscr"; _0: ast.Expr | undefined }
  /// A static method where `Self` is a struct.
  | { readonly $: "StaticStruct"; _0: ast.VariantData }
  /// A static method where `Self` is an enum.
  | { readonly $: "StaticEnum"; _0: ast.EnumDef };

/// Combine the values of all the fields together. The last argument is
/// all the fields of all the structures.
export type CombineSubstructureFunc = (cx: ExtCtxt, span: Span, substr: Substructure) => BlockOrExpr;

// rustc: compiler/rustc_builtin_macros/src/deriving/generic/mod.rs:323 combine_substructure
export function combine_substructure(f: (cx: ExtCtxt, span: Span, substr: Substructure) => BlockOrExpr): CombineSubstructureFunc {
  return f;
}

interface TypeParameter {
  bound_generic_params: ast.GenericParam[];
  ty: ast.Ty;
}

/// The code snippets built up for derived code are sometimes used as blocks
/// (e.g. in a function body) and sometimes used as expressions (e.g. in a match
/// arm). This structure avoids committing to either form until necessary,
/// avoiding the insertion of any unnecessary blocks.
///
/// The statements come before the expression.
export class BlockOrExpr {
  constructor(
    public _0: ast.Stmt[],
    public _1: ast.Expr | undefined,
  ) {}

  // rustc: compiler/rustc_builtin_macros/src/deriving/generic/mod.rs:343 new_stmts
  static new_stmts(stmts: ast.Stmt[]): BlockOrExpr {
    return new BlockOrExpr(stmts, undefined);
  }

  // rustc: compiler/rustc_builtin_macros/src/deriving/generic/mod.rs:347 new_expr
  static new_expr(expr: ast.Expr): BlockOrExpr {
    return new BlockOrExpr([], expr);
  }

  // rustc: compiler/rustc_builtin_macros/src/deriving/generic/mod.rs:351 new_mixed
  static new_mixed(stmts: ast.Stmt[], expr: ast.Expr | undefined): BlockOrExpr {
    return new BlockOrExpr(stmts, expr);
  }

  // Converts it into a block.
  // rustc: compiler/rustc_builtin_macros/src/deriving/generic/mod.rs:356 into_block
  into_block(cx: ExtCtxt, span: Span): ast.Block {
    const expr = this._1;
    if (expr !== undefined) {
      this._0.push(cx.stmt_expr(expr));
    }
    return cx.block(span, this._0);
  }

  // Converts it into an expression.
  // rustc: compiler/rustc_builtin_macros/src/deriving/generic/mod.rs:364 into_expr
  into_expr(cx: ExtCtxt, span: Span): ast.Expr {
    if (this._0.length === 0) {
      const expr = this._1;
      if (expr === undefined) {
        return cx.expr_block(cx.block(span, []));
      } else {
        return expr;
      }
    } else if (this._0.length === 1 && this._0[0]!.kind.$ === "Expr" && this._1 === undefined) {
      const expr = this._0[0]!.kind._0;
      // There's only a single statement expression. Pull it out.
      return clone_Expr(expr);
    } else {
      // Multiple statements and/or expressions.
      return cx.expr_block(this.into_block(cx, span));
    }
  }
}

/// This method helps to extract all the type parameters referenced from a
/// type. For a type parameter `<T>`, it looks for either a `TyPath` that
/// is not global and starts with `T`, or a `TyQPath`.
/// Also include bound generic params from the input type.
// rustc: compiler/rustc_builtin_macros/src/deriving/generic/mod.rs:387 find_type_parameters
function find_type_parameters(ty: ast.Ty, ty_param_names: readonly Symbol[], cx: ExtCtxt): TypeParameter[] {
  // PORT: the fn-local `struct Visitor` and its `impl visit::Visitor` -> a local subclass of the
  // `Visitor` base class.
  class Visitor extends visit.Visitor {
    constructor(
      public cx: ExtCtxt,
      public ty_param_names: readonly Symbol[],
      public bound_generic_params_stack: ast.GenericParam[],
      public type_params: TypeParameter[],
    ) {
      super();
    }

    // rustc: compiler/rustc_builtin_macros/src/deriving/generic/mod.rs:402 visit_ty
    override visit_ty(ty: ast.Ty): undefined {
      const stack_len = this.bound_generic_params_stack.length;
      if (ty.kind.$ === "FnPtr" && ty.kind._0.generic_params.length !== 0) {
        const fn_ptr = ty.kind._0;
        // Given a field `x: for<'a> fn(T::SomeType<'a>)`, we wan't to account for `'a` so
        // that we generate `where for<'a> T::SomeType<'a>: ::core::clone::Clone`. #122622
        this.bound_generic_params_stack.push(...fn_ptr.generic_params.map(clone_GenericParam));
      }

      if (ty.kind.$ === "Path") {
        const path = ty.kind._1;
        const segment = path.segments[0];
        if (segment !== undefined && this.ty_param_names.includes(segment.ident.name)) {
          this.type_params.push({
            bound_generic_params: this.bound_generic_params_stack.map(clone_GenericParam),
            ty: clone_Ty(ty),
          });
        }
      }

      visit.walk_ty(this, ty);
      this.bound_generic_params_stack.length = stack_len;
      return undefined;
    }

    // Place bound generic params on a stack, to extract them when a type is encountered.
    // rustc: compiler/rustc_builtin_macros/src/deriving/generic/mod.rs:427 visit_poly_trait_ref
    override visit_poly_trait_ref(trait_ref: ast.PolyTraitRef): undefined {
      const stack_len = this.bound_generic_params_stack.length;
      this.bound_generic_params_stack.push(...trait_ref.bound_generic_params.map(clone_GenericParam));

      visit.walk_poly_trait_ref(this, trait_ref);

      this.bound_generic_params_stack.length = stack_len;
      return undefined;
    }

    // rustc: compiler/rustc_builtin_macros/src/deriving/generic/mod.rs:436 visit_mac_call
    override visit_mac_call(mac: ast.MacCall): undefined {
      this.cx.dcx().emit_err(diagnostics.DeriveMacroCall_diagnostic({ span: mac.span() }));
      return undefined;
    }
  }

  const visitor = new Visitor(cx, ty_param_names, [], []);
  visitor.visit_ty(ty);

  return visitor.type_params;
}

// rustc: compiler/rustc_builtin_macros/src/deriving/generic/mod.rs:453 expand
TraitDef.prototype.expand = function (this: TraitDef, cx: ExtCtxt, item: ast.Item, push: (item: ast.Item) => void): void {
  this.expand_ext(cx, item, push, false);
};

// rustc: compiler/rustc_builtin_macros/src/deriving/generic/mod.rs:462 expand_ext
TraitDef.prototype.expand_ext = function (
  this: TraitDef,
  cx: ExtCtxt,
  item: ast.Item,
  push: (item: ast.Item) => void,
  from_scratch: boolean,
): void {
  const span = this.span;
  const parsed: attrs_Attribute | undefined = AttributeParser.parse_limited_sym(cx.sess, item.attrs, [sym.repr]);
  const is_packed =
    parsed !== undefined && parsed.$ === "Parsed" && parsed._0.$ === "Repr" && parsed._0.reprs.some(([x, _]) => x.$ === "ReprPacked");

  // PORT: the lazy `self.methods.iter().filter_map(..)` iterators are generators: the method bodies
  // are built when `create_derived_impl` collects them, after the impl's generics and attributes.
  let newitem: ast.Item;
  const kind = item.kind;
  if (kind.$ === "Union" && !this.supports_unions) {
    cx.dcx().emit_err(diagnostics.DeriveUnion_diagnostic({ span }));
    return;
  } else if (kind.$ === "Struct" || kind.$ === "Union") {
    const [ident, generics, struct_def] = [kind._0, kind._1, kind._2];
    const fields = ast.VariantData.fields(struct_def);
    const self = this;
    const methods = (function* (): Generator<ast.AssocItem> {
      for (const method_def of self.methods) {
        let body: BlockOrExpr;
        if (from_scratch || method_def.is_static()) {
          body = method_def.call_substructure_method(cx, span, { $: "StaticStruct", _0: struct_def }, ident);
        } else {
          body = method_def.expand_struct_method_body(cx, span, struct_def, is_packed, ident);
        }

        const m = method_def.create_method(cx, span, body);
        if (m !== undefined) yield m;
      }
    })();
    newitem = this.create_derived_impl(cx, ident, generics, fields, methods, is_packed);
  } else if (kind.$ === "Enum") {
    const [ident, generics, enum_def] = [kind._0, kind._1, kind._2];
    // We can skip generating the impl here, because `repr(packed)`
    // enums cause an error later on and to prevent ICEs like #133025.
    // This can only cause further compilation errors
    // downstream in blatantly illegal code, so it is fine.
    if (is_packed) {
      return;
    }
    const fields = enum_def.variants.flatMap((variant) => ast.VariantData.fields(variant.data));
    const self = this;
    const methods = (function* (): Generator<ast.AssocItem> {
      for (const method_def of self.methods) {
        let body: BlockOrExpr;
        if (from_scratch || method_def.is_static()) {
          body = method_def.call_substructure_method(cx, span, { $: "StaticEnum", _0: enum_def }, ident);
        } else {
          body = method_def.expand_enum_method_body(cx, span, enum_def, ident);
        }

        const m = method_def.create_method(cx, span, body);
        if (m !== undefined) yield m;
      }
    })();
    newitem = this.create_derived_impl(cx, ident, generics, fields, methods, is_packed);
  } else {
    return unreachable();
  }
  // Keep the lint attributes of the previous item to control how the
  // generated implementations are linted
  newitem.attrs.push(
    ...item.attrs
      .filter((a) => a.has_any_name([sym.allow, sym.warn, sym.deny, sym.forbid, sym.stable, sym.unstable]))
      .map(clone_Attribute),
  );
  push(newitem);
};

/// Given that we are deriving a trait `DerivedTrait` for a type like:
///
/// ```ignore (only-for-syntax-highlight)
/// struct Struct<'a, ..., 'z, A, B: DeclaredTrait, C, ..., Z>
/// where
///     C: WhereTrait,
/// {
///     a: A,
///     b: B::Item,
///     b1: <B as DeclaredTrait>::Item,
///     c1: <C as WhereTrait>::Item,
///     c2: Option<<C as WhereTrait>::Item>,
///     ...
/// }
/// ```
///
/// create an impl like:
///
/// ```ignore (only-for-syntax-highlight)
/// impl<'a, ..., 'z, A, B: DeclaredTrait, C, ..., Z>
/// where
///     C: WhereTrait,
///     A: DerivedTrait + B1 + ... + BN,
///     B: DerivedTrait + B1 + ... + BN,
///     C: DerivedTrait + B1 + ... + BN,
///     B::Item: DerivedTrait + B1 + ... + BN,
///     <C as WhereTrait>::Item: DerivedTrait + B1 + ... + BN,
///     ...
/// {
///     ...
/// }
/// ```
///
/// where B1, ..., BN are the bounds given by `bounds_paths`.'. Z is a phantom type, and
/// therefore does not get bound by the derived trait.
// rustc: compiler/rustc_builtin_macros/src/deriving/generic/mod.rs:577 create_derived_impl
TraitDef.prototype.create_derived_impl = function (
  this: TraitDef,
  cx: ExtCtxt,
  type_ident: Ident,
  generics: ast.Generics,
  fields: Iterable<ast.FieldDef>,
  methods: Iterable<ast.AssocItem>,
  is_packed: boolean,
): ast.Item {
  // PORT: `ast::WhereClause::default()` (derive(Default)) written out.
  const where_clause = new ast.WhereClause(false, [], DUMMY_SP);
  where_clause.span = generics.where_clause.span;
  const ctxt = Span.ctxt(this.span);

  // Create the generic parameters
  const params: ast.GenericParam[] = generics.params
    .map((param): ast.GenericParam => {
      const kind = param.kind;
      switch (kind.$) {
        case "Lifetime":
          return clone_GenericParam(param);
        case "Type": {
          // Extra restrictions on the generics parameters to the
          // type being derived upon.
          const span = Span.with_ctxt(param.ident.span, ctxt);
          const bounds: ast.GenericBound[] = this.additional_bounds.map((p) => {
            // PORT: `ast::Path { span, ..p.clone() }`.
            const path = clone_Path(p);
            path.span = span;
            return cx.trait_bound(path, this.is_const);
          });
          // Add a bound for the current trait.
          if (!this.skip_path_as_bound) {
            const trait_path = clone_Path(this.path);
            trait_path.span = span;
            bounds.push(cx.trait_bound(trait_path, this.is_const));
          }
          // Add a `Copy` bound if required.
          if (is_packed && this.needs_copy_as_bound_if_packed) {
            const p = path_std(cx, span, [sym.marker, sym.Copy]);
            bounds.push(cx.trait_bound(p, this.is_const));
          }
          // Also add in any bounds from the declaration.
          bounds.push(...param.bounds.map(clone_GenericBound));

          return cx.typaram(param.ident, bounds, undefined);
        }
        case "Const": {
          const { ty, span } = kind;
          const const_nodefault_kind: ast.GenericParamKind = {
            $: "Const",
            ty: clone_Ty(ty),
            span: Span.with_ctxt(span, ctxt),

            // We can't have default values inside impl block
            default: undefined,
          };
          const param_clone = clone_GenericParam(param);
          param_clone.kind = const_nodefault_kind;
          return param_clone;
        }
      }
    })
    .map((param) => {
      // Remove all attributes, because there might be helper attributes
      // from other macros that will not be valid in the expanded implementation.
      param.attrs.length = 0;
      return param;
    });

  // and similarly for where clauses
  where_clause.predicates.push(
    ...generics.where_clause.predicates.map(
      (clause): ast.WherePredicate => ({
        attrs: clause.attrs.map(clone_Attribute),
        kind: clone_WherePredicateKind(clause.kind),
        id: ast.DUMMY_NODE_ID,
        span: Span.with_ctxt(clause.span, ctxt),
        is_placeholder: false,
      }),
    ),
  );

  const ty_param_names: Symbol[] = params.filter((param) => param.kind.$ === "Type").map((ty_param) => ty_param.ident.name);

  if (ty_param_names.length !== 0) {
    for (const field of fields) {
      const field_ty_params = find_type_parameters(field.ty, ty_param_names, cx);

      for (const field_ty_param of field_ty_params) {
        // if we have already handled this type, skip it
        if (field_ty_param.ty.kind.$ === "Path") {
          const p = field_ty_param.ty.kind._1;
          if (p.segments.length === 1 && ty_param_names.includes(p.segments[0]!.ident.name)) {
            continue;
          }
        }
        const bounds: ast.GenericBound[] = this.additional_bounds.map((p) => cx.trait_bound(clone_Path(p), this.is_const));

        // Require the current trait.
        if (!this.skip_path_as_bound) {
          bounds.push(cx.trait_bound(clone_Path(this.path), this.is_const));
        }

        // Add a `Copy` bound if required.
        if (is_packed && this.needs_copy_as_bound_if_packed) {
          const p = path_std(cx, this.span, [sym.marker, sym.Copy]);
          bounds.push(cx.trait_bound(p, this.is_const));
        }

        if (bounds.length !== 0) {
          const predicate_: ast.WhereBoundPredicate = {
            bound_generic_params: field_ty_param.bound_generic_params,
            bounded_ty: field_ty_param.ty,
            bounds,
          };

          const kind: ast.WherePredicateKind = { $: "BoundPredicate", _0: predicate_ };
          const predicate: ast.WherePredicate = {
            attrs: [],
            kind,
            id: ast.DUMMY_NODE_ID,
            span: this.span,
            is_placeholder: false,
          };
          where_clause.predicates.push(predicate);
        }
      }
    }
  }

  const trait_generics: ast.Generics = { params, where_clause, span: Span.with_ctxt(generics.span, ctxt) };

  // Create the reference to the trait.
  const trait_ref = cx.trait_ref(clone_Path(this.path));

  const self_params: ast.GenericArg[] = generics.params.map((param) =>
    generic_param_to_arg(cx, param, Span.with_ctxt(param.ident.span, ctxt)),
  );

  // Create the type of `self`.
  const path = cx.path_all(Span.with_ctxt(type_ident.span, ctxt), false, [type_ident], self_params);
  const self_type = cx.ty_path(path);

  const attrs: ast.AttrVec = [cx.attr_word(sym.automatically_derived, this.span)];

  // Only add `rustc_const_unstable` attributes if `derive_const` is used within libcore/libstd,
  // Other crates don't need stability attributes, so adding them is not useful, but libcore needs them
  // on all const trait impls.
  if (this.is_const && cx.ecfg.features.staged_api()) {
    const rustc_const_unstable = cx.path_ident(this.span, Ident.new(sym.rustc_const_unstable, this.span));

    // #[rustc_const_unstable(feature = "derive_const", issue = "118304")]
    attrs.push(
      cx.attr_nested(
        new ast.AttrItem(
          ast.Safety.Default,
          rustc_const_unstable,
          {
            $: "Delimited",
            _0: new ast.DelimArgs(
              tokenstream.DelimSpan.from_single(this.span),
              token.Delimiter.Parenthesis,
              tokenstream.TokenStream.from_iter(
                (
                  [
                    { $: "Ident", _0: sym.feature, _1: "Normal" },
                    token.TokenKind.Eq,
                    token.TokenKind.lit(token.LitKind.Str, sym.derive_const, undefined),
                    token.TokenKind.Comma,
                    { $: "Ident", _0: sym.issue, _1: "Normal" },
                    token.TokenKind.Eq,
                    token.TokenKind.lit(token.LitKind.Str, sym.derive_const_issue, undefined),
                  ] as token.TokenKind[]
                ).map((kind): tokenstream.TokenTree => ({
                  $: "Token",
                  _0: new token.Token(kind, this.span),
                  _1: tokenstream.Spacing.Alone,
                })),
              ),
            ),
          },
          this.span,
        ),
        this.span,
      ),
    );
  }

  if (!this.document) {
    attrs.push(cx.attr_nested_word(sym.doc, sym.hidden, this.span));
  }

  return cx.item_trait_impl(this.span, attrs, trait_generics, this.safety, this.is_const, trait_ref, self_type, [...methods]);
};

// rustc: compiler/rustc_builtin_macros/src/deriving/generic/mod.rs:791 call_substructure_method
MethodDef.prototype.call_substructure_method = function (
  this: MethodDef,
  cx: ExtCtxt,
  span: Span,
  fields: SubstructureFields,
  type_ident: Ident,
): BlockOrExpr {
  return this.combine_substructure(cx, span, { fields, type_ident });
};

// rustc: compiler/rustc_builtin_macros/src/deriving/generic/mod.rs:801 is_static
MethodDef.prototype.is_static = function (this: MethodDef): boolean {
  return !this.explicit_self;
};

/// Expressions for `&self` and also any other
/// args with the same type (e.g. the `other` arg in `PartialEq::eq`).
// rustc: compiler/rustc_builtin_macros/src/deriving/generic/mod.rs:807 get_selflike_args
MethodDef.prototype.get_selflike_args = function (this: MethodDef, cx: ExtCtxt, span: Span): ast.Expr[] {
  assert(this.explicit_self, "assertion failed: self.explicit_self");

  const self_expr = cx.expr_self(span);
  if (this.has_other_selflike_arg) {
    return [self_expr, cx.expr_ident_sym(span, this.nonself_args[0]![1])];
  } else {
    return [self_expr];
  }
};

// rustc: compiler/rustc_builtin_macros/src/deriving/generic/mod.rs:818 create_method
MethodDef.prototype.create_method = function (this: MethodDef, cx: ExtCtxt, span: Span, body: BlockOrExpr): ast.AssocItem | undefined {
  // `assert_fields_are_eq` has an empty default implementation
  if (body._0.length === 0 && body._1 === undefined && this.name === sym.assert_fields_are_eq) {
    return undefined;
  }
  // Create the generics that aren't for `Self`.
  const fn_generics = clone_Generics(this.generics);

  let self_arg: ast.Param | undefined;
  if (this.explicit_self) {
    const ident = Ident.new(kw.SelfLower, span);
    self_arg = ast.Param.from_self([], respan(span, { $: "Region", _0: undefined, _1: "Not" }), ident);
  }
  const args: ast.Param[] = [
    ...(self_arg === undefined ? [] : [self_arg]),
    ...this.nonself_args.map(([ty, name]) => {
      const ast_ty = clone_Ty(ty);
      const ident = Ident.new(name, span);
      return cx.param(span, ident, ast_ty);
    }),
  ];

  let ret_type: ast.FnRetTy;
  if (ast.TyKind.is_unit(this.ret_ty.kind)) {
    ret_type = { $: "Default", _0: span };
  } else {
    ret_type = { $: "Ty", _0: clone_Ty(this.ret_ty) };
  }

  const method_ident = Ident.new(this.name, span);
  const fn_decl = cx.fn_decl(args, ret_type);
  const body_block = body.into_block(cx, span);

  const trait_lo_sp = Span.shrink_to_lo(span);

  const sig = new ast.FnSig(ast.FnHeader.default(), fn_decl, span);
  const defaultness: ast.Defaultness = ast.Defaultness.Implicit;

  // Create the method.
  return new ast.Item<ast.AssocItemKind>(
    this.attributes.map(clone_Attribute),
    ast.DUMMY_NODE_ID,
    span,
    { span: trait_lo_sp, kind: { $: "Inherited" } },
    {
      $: "Fn",
      _0: new ast.Fn(defaultness, method_ident, fn_generics, sig, undefined, undefined, body_block, undefined),
    },
    undefined,
  );
};

/// The normal case uses field access.
///
/// ```
/// #[derive(PartialEq)]
/// # struct Dummy;
/// struct A { x: u8, y: u8 }
///
/// // equivalent to:
/// impl PartialEq for A {
///     fn eq(&self, other: &A) -> bool {
///         self.x == other.x && self.y == other.y
///     }
/// }
/// ```
///
/// But if the struct is `repr(packed)`, we can't use something like
/// `&self.x` because that might cause an unaligned ref. So for any trait
/// method that takes a reference, we use a local block to force a copy.
/// This requires that the field impl `Copy`.
///
/// ```rust,ignore (example)
/// # struct A { x: u8, y: u8 }
/// impl PartialEq for A {
///     fn eq(&self, other: &A) -> bool {
///         // Desugars to `{ self.x }.eq(&{ other.y }) && ...`
///         { self.x } == { other.y } && { self.y } == { other.y }
///     }
/// }
/// impl Hash for A {
///     fn hash<__H: ::core::hash::Hasher>(&self, state: &mut __H) -> () {
///         ::core::hash::Hash::hash(&{ self.x }, state);
///         ::core::hash::Hash::hash(&{ self.y }, state);
///     }
/// }
/// ```
// rustc: compiler/rustc_builtin_macros/src/deriving/generic/mod.rs:918 expand_struct_method_body
MethodDef.prototype.expand_struct_method_body = function (
  this: MethodDef,
  cx: ExtCtxt,
  span: Span,
  struct_def: ast.VariantData,
  is_packed: boolean,
  type_ident: Ident,
): BlockOrExpr {
  const selflike_args = this.get_selflike_args(cx, span);

  const selflike_fields = create_struct_field_access_fields(span, cx, selflike_args, struct_def, is_packed);
  return this.call_substructure_method(cx, span, { $: "Struct", _0: struct_def, _1: selflike_fields }, type_ident);
};

/// ```
/// #[derive(PartialEq)]
/// # struct Dummy;
/// enum A {
///     A1,
///     A2(i32)
/// }
/// ```
///
/// is equivalent to:
///
/// ```
/// #![feature(core_intrinsics)]
/// enum A {
///     A1,
///     A2(i32)
/// }
/// impl ::core::cmp::PartialEq for A {
///     #[inline]
///     fn eq(&self, other: &A) -> bool {
///         let __self_discr = ::core::intrinsics::discriminant_value(self);
///         let __arg1_discr = ::core::intrinsics::discriminant_value(other);
///         __self_discr == __arg1_discr
///             && match (self, other) {
///                 (A::A2(__self_0), A::A2(__arg1_0)) => *__self_0 == *__arg1_0,
///                 _ => true,
///             }
///     }
/// }
/// ```
///
/// Creates a discriminant check combined with a match for a tuple of all
/// `selflike_args`, with an arm for each variant with fields, possibly an
/// arm for each fieldless variant (if `unify_fieldless_variants` is not
/// `Unify`), and possibly a default arm.
// rustc: compiler/rustc_builtin_macros/src/deriving/generic/mod.rs:968 expand_enum_method_body
MethodDef.prototype.expand_enum_method_body = function (
  this: MethodDef,
  cx: ExtCtxt,
  span: Span,
  enum_def: ast.EnumDef,
  type_ident: Ident,
): BlockOrExpr {
  const variants = enum_def.variants;

  // Traits that unify fieldless variants always use the discriminant(s).
  const unify_fieldless_variants = this.fieldless_variants_strategy === FieldlessVariantsStrategy.Unify;

  // For zero-variant enum, this function body is unreachable. Generate
  // `match *self {}`. This produces machine code identical to `unsafe {
  // core::intrinsics::unreachable() }` while being safe and stable.
  if (variants.length === 0) {
    const match_arg = cx.expr_deref(span, cx.expr_self(span));
    const match_arms: ast.Arm[] = [];
    const expr = cx.expr_match(span, match_arg, match_arms);
    return new BlockOrExpr([], expr);
  }

  const selflike_args = this.get_selflike_args(cx, span);

  let prefixes: readonly string[];
  switch (selflike_args.length) {
    case 1:
      prefixes = ["__self"];
      break;
    case 2:
      prefixes = ["__self", "__arg1"];
      break;
    default:
      return unreachable();
  }

  // There are some special cases involving fieldless enums where no
  // match is necessary.
  const all_fieldless = variants.every((v) => ast.VariantData.fields(v.data).length === 0);
  if (all_fieldless) {
    if (variants.length > 1) {
      switch (this.fieldless_variants_strategy) {
        case "Unify":
          // If the type is fieldless and the trait uses the discriminant and
          // there are multiple variants, we need just an operation on
          // the discriminant(s).
          return this.call_substructure_method(cx, span, { $: "EnumDiscr", _0: undefined }, type_ident);
        case "SpecializeIfAllVariantsFieldless":
          return this.call_substructure_method(cx, span, { $: "AllFieldlessEnum", _0: enum_def }, type_ident);
        case "Default":
          break;
      }
    } else if (variants.length === 1) {
      const variant = variants[0]!;
      // If there is a single variant, we don't need an operation on
      // the discriminant(s). Just use the most degenerate result.
      return this.call_substructure_method(cx, span, { $: "EnumMatching", _0: variant, _1: [] }, type_ident);
    }
  }

  // These arms are of the form:
  // (Variant1, Variant1, ...) => Body1
  // (Variant2, Variant2, ...) => Body2
  // ...
  // where each tuple has length = selflike_args.len()
  const match_arms: ast.Arm[] = variants
    .filter((v) => !(unify_fieldless_variants && ast.VariantData.fields(v.data).length === 0))
    .map((variant) => {
      // A single arm has form (&VariantK, &VariantK, ...) => BodyK
      // (see "Final wrinkle" note below for why.)

      const fields = create_struct_pattern_fields(span, cx, variant.data, prefixes);

      const sp = Span.with_ctxt(variant.span, Span.ctxt(span));
      const variant_path = cx.path(sp, [Ident.new(kw.SelfUpper, span), variant.ident]);
      const subpats = create_struct_patterns(span, cx, variant_path, variant.data, prefixes);

      // `(VariantK, VariantK, ...)` or just `VariantK`.
      let single_pat: ast.Pat;
      if (subpats.length === 1) {
        single_pat = unwrap(subpats.pop());
      } else {
        single_pat = cx.pat_tuple(span, subpats);
      }

      // For the BodyK, we need to delegate to our caller,
      // passing it an EnumMatching to indicate which case
      // we are in.
      //
      // Now, for some given VariantK, we have built up
      // expressions for referencing every field of every
      // Self arg, assuming all are instances of VariantK.
      // Build up code associated with such a case.
      const substructure: SubstructureFields = { $: "EnumMatching", _0: variant, _1: fields };
      const arm_expr = this.call_substructure_method(cx, span, substructure, type_ident).into_expr(cx, span);

      return cx.arm(span, single_pat, arm_expr);
    });

  // Add a default arm to the match, if necessary.
  const first_fieldless = variants.find((v) => ast.VariantData.fields(v.data).length === 0);
  let default_: ast.Expr | undefined;
  if (first_fieldless !== undefined && unify_fieldless_variants) {
    const v = first_fieldless;
    // We need a default case that handles all the fieldless variants.
    default_ = this.call_substructure_method(cx, span, { $: "EnumMatching", _0: v, _1: [] }, type_ident).into_expr(cx, span);
  } else if (variants.length > 1 && selflike_args.length > 1) {
    // Because we know that all the arguments will match if we reach
    // the match expression we add the unreachable intrinsic as the
    // result of the default which should help llvm in optimizing it.
    default_ = call_unreachable(cx, span);
  } else {
    default_ = undefined;
  }
  if (default_ !== undefined) {
    const arm = default_;
    match_arms.push(cx.arm(span, cx.pat_wild(span), arm));
  }

  // Create a match expression with one arm per discriminant plus
  // possibly a default arm, e.g.:
  //      match (self, other) {
  //          (Variant1, Variant1, ...) => Body1
  //          (Variant2, Variant2, ...) => Body2,
  //          ...
  //          _ => ::core::intrinsics::unreachable(),
  //      }
  const get_match_expr = (selflike_args: ast.Expr[]): ast.Expr => {
    let match_arg: ast.Expr;
    if (selflike_args.length === 1) {
      match_arg = unwrap(selflike_args.pop());
    } else {
      match_arg = cx.expr_tuple(span, selflike_args);
    }
    return cx.expr_match(span, match_arg, match_arms);
  };

  // If the trait uses the discriminant and there are multiple variants, we need
  // to add a discriminant check operation before the match. Otherwise, the match
  // is enough.
  if (unify_fieldless_variants && variants.length > 1) {
    // Combine a discriminant check with the match.
    return this.call_substructure_method(cx, span, { $: "EnumDiscr", _0: get_match_expr(selflike_args) }, type_ident);
  } else {
    return new BlockOrExpr([], get_match_expr(selflike_args));
  }
};

// general helper methods.
// rustc: compiler/rustc_builtin_macros/src/deriving/generic/mod.rs:1144 create_struct_patterns
function create_struct_patterns(
  span: Span,
  cx: ExtCtxt,
  struct_path_: ast.Path,
  struct_def: ast.VariantData,
  prefixes: readonly string[],
): ast.Pat[] {
  return prefixes.map((prefix) => {
    // PORT: the lazy `pieces_iter` is consumed inside the `Struct`/`Tuple` arms, one field at a time.
    const pieces_iter = function* (): Generator<[Ident | undefined, ast.Pat]> {
      const fields = ast.VariantData.fields(struct_def);
      for (let i = 0; i < fields.length; i++) {
        const struct_field = fields[i]!;
        const ident = mk_pattern_ident(span, prefix, i);
        const path = ident.with_span_pos(struct_field.span);
        yield [struct_field.ident, cx.pat_ident(path.span, path)];
      }
    };

    const struct_path = clone_Path(struct_path_);
    switch (struct_def.$) {
      case "Struct": {
        const field_pats: ast.PatField[] = [];
        for (const [ident, pat] of pieces_iter()) {
          field_pats.push({
            ident: unwrap(ident, "a braced struct with unnamed fields in `derive`"),
            is_shorthand: false,
            attrs: [],
            id: ast.DUMMY_NODE_ID,
            span: Span.with_ctxt(pat.span, Span.ctxt(span)),
            pat: pat,
            is_placeholder: false,
          });
        }
        return cx.pat_struct(span, struct_path, field_pats);
      }
      case "Tuple": {
        const subpats: ast.Pat[] = [];
        for (const [_, subpat] of pieces_iter()) subpats.push(subpat);
        return cx.pat_tuple_struct(span, struct_path, subpats);
      }
      case "Unit":
        return cx.pat_path(span, struct_path);
    }
  });
}

// rustc: compiler/rustc_builtin_macros/src/deriving/generic/mod.rs:1186 create_fields
function create_fields(
  span_: Span,
  struct_def: ast.VariantData,
  mk_exprs: (i: number, struct_field: ast.FieldDef, span: Span) => ast.Expr[],
): FieldInfo[] {
  return ast.VariantData.fields(struct_def).map((struct_field, i) => {
    // For this field, get an expr for each selflike_arg. E.g. for
    // `PartialEq::eq`, one for each of `&self` and `other`.
    const span = Span.with_ctxt(struct_field.span, Span.ctxt(span_));
    const exprs: ast.Expr[] = mk_exprs(i, struct_field, span);
    if (exprs.length === 0) panic("removal index (is 0) should be < len (is 0)");
    const self_expr = exprs.splice(0, 1)[0]!;
    // debug_assert!(exprs.len() <= 1);
    return {
      span,
      name: struct_field.ident,
      self_expr,
      other_selflike_expr: exprs.pop(),
      maybe_scalar: ast.TyKind.maybe_scalar(struct_field.ty.peel_refs().kind),
    };
  });
}

// rustc: compiler/rustc_builtin_macros/src/deriving/generic/mod.rs:1212 mk_pattern_ident
function mk_pattern_ident(span: Span, prefix: string, i: number): Ident {
  return Ident.from_str_and_span(`${prefix}_${i}`, span);
}

// rustc: compiler/rustc_builtin_macros/src/deriving/generic/mod.rs:1216 create_struct_pattern_fields
function create_struct_pattern_fields(span: Span, cx: ExtCtxt, struct_def: ast.VariantData, prefixes: readonly string[]): FieldInfo[] {
  return create_fields(span, struct_def, (i, _struct_field, sp) =>
    prefixes.map((prefix) => {
      const ident = mk_pattern_ident(span, prefix, i);
      return cx.expr_path(cx.path_ident(sp, ident));
    }),
  );
}

// rustc: compiler/rustc_builtin_macros/src/deriving/generic/mod.rs:1233 create_struct_field_access_fields
function create_struct_field_access_fields(
  span: Span,
  cx: ExtCtxt,
  selflike_args: readonly ast.Expr[],
  struct_def: ast.VariantData,
  is_packed: boolean,
): FieldInfo[] {
  return create_fields(span, struct_def, (i, struct_field, sp) =>
    selflike_args.map((selflike_arg) => {
      // Note: we must use `struct_field.span` rather than `sp` in the
      // `unwrap_or_else` case otherwise the hygiene is wrong and we get
      // "field `0` of struct `Point` is private" errors on tuple
      // structs.
      let field_expr = cx.expr(sp, {
        $: "Field",
        _0: clone_Expr(selflike_arg),
        _1: struct_field.ident ?? Ident.from_str_and_span(i.toString(), struct_field.span),
      });
      if (is_packed) {
        // Fields in packed structs are wrapped in a block, e.g. `&{self.0}`,
        // causing a copy instead of a (potentially misaligned) reference.
        field_expr = cx.expr_block(cx.block(struct_field.span, [cx.stmt_expr(field_expr)]));
      }
      return cx.expr_addr_of(sp, field_expr);
    }),
  );
}

// rustc: compiler/rustc_builtin_macros/src/deriving/generic/mod.rs:1270 generic_param_to_arg
export function generic_param_to_arg(cx: ExtCtxt, p: ast.GenericParam, span: Span): ast.GenericArg {
  switch (p.kind.$) {
    case "Lifetime":
      return { $: "Lifetime", _0: cx.lifetime(span, p.ident) };
    case "Type":
      return { $: "Type", _0: cx.ty_ident(span, p.ident) };
    case "Const":
      return { $: "Const", _0: cx.const_ident(span, p.ident) };
  }
}

// rustc: compiler/rustc_builtin_macros/src/deriving/generic/mod.rs:1278 generics_without_defaults
export function generics_without_defaults(g: ast.Generics): ast.Generics {
  return {
    params: g.params.map((p_) => {
      const p = clone_GenericParam(p_);
      const kind = p.kind;
      switch (kind.$) {
        case "Const":
          kind.default = undefined;
          break;
        case "Type":
          kind.default = undefined;
          break;
        case "Lifetime":
          break;
      }
      p.attrs.length = 0;
      return p;
    }),
    where_clause: clone_WhereClause(g.where_clause),
    span: g.span,
  };
}
