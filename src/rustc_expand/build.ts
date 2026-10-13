// Port of compiler/rustc_expand/src/build.rs (`impl ExtCtxt`: the AST builder methods).
//
// PORT: extension module of base.ts's `ExtCtxt` (PORTING §5): the methods are declared on the class
// interface below and assigned to `ExtCtxt.prototype`; lib.ts loads this module after base.ts.
// `Box<T>` -> `T`; `ThinVec<T>`/`Vec<T>` -> `T[]`; `Option<T>` -> `T | undefined`; `Default::default()`
// of a derive(Default) AST struct is written out.
import {
  type AnonConst,
  type Arm,
  type AssocItem,
  type AttrItem,
  type AttrVec,
  type Attribute,
  AttrStyle,
  type BinOpKind,
  BindingMode,
  type Block,
  BlockCheckMode,
  type Expr,
  Expr as ExprClass,
  type ExprField,
  type ExprKind,
  FnDecl,
  type FnRetTy,
  type GenericArg,
  type GenericBound,
  type GenericBounds,
  GenericParam,
  type Generics,
  Item,
  type ItemKind,
  type Lifetime,
  type Local,
  MacCall,
  DelimArgs,
  type Mutability,
  DUMMY_NODE_ID,
  Param,
  Pat,
  type PatField,
  type PatKind,
  Path,
  PathSegment,
  PolyTraitRef,
  type Safety,
  Stmt,
  type TraitRef,
  Ty,
  type TyKind,
  UintTy,
  WhereClause,
} from "../rustc_ast/lib.ts";
import { mk_attr_from_item, mk_attr_name_value_str, mk_attr_nested_word, mk_attr_word } from "../rustc_ast/attr/mod.ts";
import { Lit, LitKind, type Delimiter } from "../rustc_ast/token.ts";
import { DelimSpan, type TokenStream } from "../rustc_ast/tokenstream.ts";
import { escape_byte_str_symbol, escape_string_symbol } from "../rustc_ast/util/literal.ts";
import { DUMMY_SP, Span } from "../rustc_span/lib.ts";
import { Ident, kw, sym, type Symbol } from "../rustc_span/symbol.ts";
import { assert, unwrap } from "../std/panic.ts";
import { ExtCtxt } from "./base.ts";

declare module "./base.ts" {
  interface ExtCtxt {
    std_path(components: readonly Symbol[]): Ident[];
    path(span: Span, strs: Ident[]): Path;
    path_ident(span: Span, id: Ident): Path;
    path_global(span: Span, strs: Ident[]): Path;
    path_all(span: Span, global: boolean, idents: Ident[], args: GenericArg[]): Path;
    macro_call(span: Span, path: Path, delim: Delimiter, tokens: TokenStream): MacCall;
    ty(span: Span, kind: TyKind): Ty;
    ty_infer(span: Span): Ty;
    ty_path(path: Path): Ty;
    ty_ident(span: Span, ident: Ident): Ty;
    anon_const(span: Span, kind: ExprKind): AnonConst;
    anon_const_block(b: Block): AnonConst;
    const_ident(span: Span, ident: Ident): AnonConst;
    ty_ref(span: Span, ty: Ty, lifetime: Lifetime | undefined, mutbl: Mutability): Ty;
    ty_ptr(span: Span, ty: Ty, mutbl: Mutability): Ty;
    ty_unit(span: Span): Ty;
    ty_self(span: Span): Ty;
    ty_self_ref(span: Span): Ty;
    typaram(ident: Ident, bounds: GenericBounds, default_: Ty | undefined): GenericParam;
    lifetime_param(ident: Ident, bounds: GenericBounds): GenericParam;
    const_param(ident: Ident, bounds: GenericBounds, ty: Ty, default_: AnonConst | undefined): GenericParam;
    trait_ref(path: Path): TraitRef;
    poly_trait_ref(span: Span, path: Path, is_const: boolean): PolyTraitRef;
    trait_bound(path: Path, is_const: boolean): GenericBound;
    lifetime(span: Span, ident: Ident): Lifetime;
    lifetime_static(span: Span): Lifetime;
    stmt_expr(expr: Expr): Stmt;
    stmt_let(sp: Span, mutbl: boolean, ident: Ident, ex: Expr): Stmt;
    stmt_let_ty(sp: Span, mutbl: boolean, ident: Ident, ty: Ty | undefined, ex: Expr): Stmt;
    stmt_let_type_only(span: Span, ty: Ty): Stmt;
    stmt_local(local: Local, span: Span): Stmt;
    stmt_item(sp: Span, item: Item): Stmt;
    block_expr(expr: Expr): Block;
    block(span: Span, stmts: Stmt[]): Block;
    expr(span: Span, kind: ExprKind): Expr;
    expr_path(path: Path): Expr;
    expr_ident(span: Span, id: Ident): Expr;
    expr_self(span: Span): Expr;
    expr_ident_sym(span: Span, sym: Symbol): Expr;
    expr_macro_call(span: Span, call: MacCall): Expr;
    expr_binary(sp: Span, op: BinOpKind, lhs: Expr, rhs: Expr): Expr;
    expr_deref(sp: Span, e: Expr): Expr;
    expr_addr_of(sp: Span, e: Expr): Expr;
    expr_paren(sp: Span, e: Expr): Expr;
    expr_method_call(span: Span, expr: Expr, ident: Ident, args: Expr[]): Expr;
    expr_call(span: Span, expr: Expr, args: Expr[]): Expr;
    expr_call_ident(span: Span, id: Ident, args: Expr[]): Expr;
    expr_call_global(sp: Span, fn_path: Ident[], args: Expr[]): Expr;
    expr_block(b: Block): Expr;
    field_imm(span: Span, ident: Ident, e: Expr): ExprField;
    expr_struct(span: Span, path: Path, fields: ExprField[]): Expr;
    expr_struct_ident(span: Span, id: Ident, fields: ExprField[]): Expr;
    expr_usize(span: Span, n: number): Expr;
    expr_u32(span: Span, n: number): Expr;
    expr_bool(span: Span, value: boolean): Expr;
    expr_str(span: Span, s: Symbol): Expr;
    expr_byte_str(span: Span, bytes: Uint8Array): Expr;
    expr_array(sp: Span, exprs: Expr[]): Expr;
    expr_array_ref(sp: Span, exprs: Expr[]): Expr;
    expr_some(sp: Span, expr: Expr): Expr;
    expr_none(sp: Span): Expr;
    expr_tuple(sp: Span, exprs: Expr[]): Expr;
    expr_ok(sp: Span, expr: Expr): Expr;
    pat(span: Span, kind: PatKind): Pat;
    pat_wild(span: Span): Pat;
    pat_ident(span: Span, ident: Ident): Pat;
    pat_ident_binding_mode(span: Span, ident: Ident, ann: BindingMode): Pat;
    pat_path(span: Span, path: Path): Pat;
    pat_tuple_struct(span: Span, path: Path, subpats: Pat[]): Pat;
    pat_struct(span: Span, path: Path, field_pats: PatField[]): Pat;
    pat_tuple(span: Span, pats: Pat[]): Pat;
    pat_some(span: Span, pat: Pat): Pat;
    arm(span: Span, pat: Pat, expr: Expr): Arm;
    expr_match(span: Span, arg: Expr, arms: Arm[]): Expr;
    expr_if(span: Span, cond: Expr, then: Expr, els: Expr | undefined): Expr;
    closure(span: Span, ids: Ident[], body: Expr): Expr;
    param(span: Span, ident: Ident, ty: Ty): Param;
    fn_decl(inputs: Param[], output: FnRetTy): FnDecl;
    item(span: Span, attrs: AttrVec, kind: ItemKind): Item;
    item_trait_impl(
      span: Span,
      attrs: AttrVec,
      generics: Generics,
      safety: Safety,
      is_const: boolean,
      trait_ref: TraitRef,
      self_ty: Ty,
      items: AssocItem[],
    ): Item;
    item_static(span: Span, attrs: AttrVec, ident: Ident, ty: Ty, mutability: Mutability, expr: Expr): Item;
    item_const(span: Span, ident: Ident, ty: Ty, body: Expr | undefined): Item;
    attr_word(name: Symbol, span: Span): Attribute;
    attr_name_value_str(name: Symbol, val: Symbol, span: Span): Attribute;
    attr_nested_word(outer: Symbol, inner: Symbol, span: Span): Attribute;
    attr_nested(inner: AttrItem, span: Span): Attribute;
    empty_generics(span: Span): Generics;
  }
}

// rustc: compiler/rustc_expand/src/build.rs:16 std_path
ExtCtxt.prototype.std_path = function (this: ExtCtxt, components: readonly Symbol[]): Ident[] {
  const def_site = this.with_def_site_ctxt(DUMMY_SP);
  return [Ident.new(kw.DollarCrate, def_site), ...components.map((s) => Ident.new(s, def_site))];
};

// rustc: compiler/rustc_expand/src/build.rs:23 path
ExtCtxt.prototype.path = function (this: ExtCtxt, span: Span, strs: Ident[]): Path {
  return this.path_all(span, false, strs, []);
};
// rustc: compiler/rustc_expand/src/build.rs:26 path_ident
ExtCtxt.prototype.path_ident = function (this: ExtCtxt, span: Span, id: Ident): Path {
  return this.path(span, [id]);
};
// rustc: compiler/rustc_expand/src/build.rs:29 path_global
ExtCtxt.prototype.path_global = function (this: ExtCtxt, span: Span, strs: Ident[]): Path {
  return this.path_all(span, true, strs, []);
};
// rustc: compiler/rustc_expand/src/build.rs:32 path_all
ExtCtxt.prototype.path_all = function (
  this: ExtCtxt,
  span: Span,
  global: boolean,
  idents: Ident[],
  args: GenericArg[],
): Path {
  assert(!(idents.length === 0), "assertion failed: !idents.is_empty()");
  const add_root = global && !idents[0]!.is_path_segment_keyword();
  const segments: PathSegment[] = [];
  if (add_root) {
    segments.push(PathSegment.path_root(span));
  }
  // PORT: `idents` is taken by value; `pop` works on a copy so the caller's array is left alone.
  idents = idents.slice();
  const last_ident = unwrap(idents.pop());
  segments.push(...idents.map((ident) => PathSegment.from_ident(ident.with_span_pos(span))));
  let args_: PathSegment["args"];
  if (!(args.length === 0)) {
    const args__ = args.map((a): { readonly $: "Arg"; _0: GenericArg } => ({ $: "Arg", _0: a }));
    args_ = { $: "AngleBracketed", _0: { args: args__, span } };
  } else {
    args_ = undefined;
  }
  segments.push(new PathSegment(last_ident.with_span_pos(span), DUMMY_NODE_ID, args_));
  return new Path(span, segments);
};

// rustc: compiler/rustc_expand/src/build.rs:63 macro_call
ExtCtxt.prototype.macro_call = function (
  this: ExtCtxt,
  span: Span,
  path: Path,
  delim: Delimiter,
  tokens: TokenStream,
): MacCall {
  return new MacCall(path, new DelimArgs(new DelimSpan(span, span), delim, tokens));
};

// rustc: compiler/rustc_expand/src/build.rs:80 ty
ExtCtxt.prototype.ty = function (this: ExtCtxt, span: Span, kind: TyKind): Ty {
  return new Ty(DUMMY_NODE_ID, kind, span);
};

// rustc: compiler/rustc_expand/src/build.rs:84 ty_infer
ExtCtxt.prototype.ty_infer = function (this: ExtCtxt, span: Span): Ty {
  return this.ty(span, { $: "Infer" });
};

// rustc: compiler/rustc_expand/src/build.rs:88 ty_path
ExtCtxt.prototype.ty_path = function (this: ExtCtxt, path: Path): Ty {
  return this.ty(path.span, { $: "Path", _0: undefined, _1: path });
};

// Might need to take bounds as an argument in the future, if you ever want
// to generate a bounded existential trait type.
// rustc: compiler/rustc_expand/src/build.rs:94 ty_ident
ExtCtxt.prototype.ty_ident = function (this: ExtCtxt, span: Span, ident: Ident): Ty {
  return this.ty_path(this.path_ident(span, ident));
};

// rustc: compiler/rustc_expand/src/build.rs:98 anon_const
ExtCtxt.prototype.anon_const = function (this: ExtCtxt, span: Span, kind: ExprKind): AnonConst {
  return {
    id: DUMMY_NODE_ID,
    value: new ExprClass(DUMMY_NODE_ID, kind, span, [], undefined),
  };
};

// rustc: compiler/rustc_expand/src/build.rs:111 anon_const_block
ExtCtxt.prototype.anon_const_block = function (this: ExtCtxt, b: Block): AnonConst {
  return this.anon_const(b.span, { $: "Block", _0: b, _1: undefined });
};

// rustc: compiler/rustc_expand/src/build.rs:115 const_ident
ExtCtxt.prototype.const_ident = function (this: ExtCtxt, span: Span, ident: Ident): AnonConst {
  return this.anon_const(span, { $: "Path", _0: undefined, _1: this.path_ident(span, ident) });
};

// rustc: compiler/rustc_expand/src/build.rs:119 ty_ref
ExtCtxt.prototype.ty_ref = function (
  this: ExtCtxt,
  span: Span,
  ty: Ty,
  lifetime: Lifetime | undefined,
  mutbl: Mutability,
): Ty {
  return this.ty(span, { $: "Ref", _0: lifetime, _1: ty, _2: mutbl });
};

// rustc: compiler/rustc_expand/src/build.rs:129 ty_ptr
ExtCtxt.prototype.ty_ptr = function (this: ExtCtxt, span: Span, ty: Ty, mutbl: Mutability): Ty {
  return this.ty(span, { $: "Ptr", _0: ty, _1: mutbl });
};

// rustc: compiler/rustc_expand/src/build.rs:133 ty_unit
ExtCtxt.prototype.ty_unit = function (this: ExtCtxt, span: Span): Ty {
  return this.ty(span, { $: "Tup", _0: [] });
};

// rustc: compiler/rustc_expand/src/build.rs:137 ty_self
ExtCtxt.prototype.ty_self = function (this: ExtCtxt, span: Span): Ty {
  return this.ty_path(this.path_ident(span, Ident.new(kw.SelfUpper, span)));
};
// rustc: compiler/rustc_expand/src/build.rs:140 ty_self_ref
ExtCtxt.prototype.ty_self_ref = function (this: ExtCtxt, span: Span): Ty {
  return this.ty_ref(span, this.ty_self(span), undefined, "Not");
};

// rustc: compiler/rustc_expand/src/build.rs:144 typaram
ExtCtxt.prototype.typaram = function (
  this: ExtCtxt,
  ident: Ident,
  bounds: GenericBounds,
  default_: Ty | undefined,
): GenericParam {
  return new GenericParam(DUMMY_NODE_ID, ident, [], bounds, false, { $: "Type", default: default_ }, undefined);
};

// rustc: compiler/rustc_expand/src/build.rs:161 lifetime_param
ExtCtxt.prototype.lifetime_param = function (this: ExtCtxt, ident: Ident, bounds: GenericBounds): GenericParam {
  return new GenericParam(DUMMY_NODE_ID, ident, [], bounds, false, { $: "Lifetime" }, undefined);
};

// rustc: compiler/rustc_expand/src/build.rs:173 const_param
ExtCtxt.prototype.const_param = function (
  this: ExtCtxt,
  ident: Ident,
  bounds: GenericBounds,
  ty: Ty,
  default_: AnonConst | undefined,
): GenericParam {
  return new GenericParam(
    DUMMY_NODE_ID,
    ident,
    [],
    bounds,
    false,
    { $: "Const", ty, span: DUMMY_SP, default: default_ },
    undefined,
  );
};

// rustc: compiler/rustc_expand/src/build.rs:191 trait_ref
ExtCtxt.prototype.trait_ref = function (this: ExtCtxt, path: Path): TraitRef {
  return { path, ref_id: DUMMY_NODE_ID };
};

// rustc: compiler/rustc_expand/src/build.rs:195 poly_trait_ref
ExtCtxt.prototype.poly_trait_ref = function (this: ExtCtxt, span: Span, path: Path, is_const: boolean): PolyTraitRef {
  return new PolyTraitRef(
    [],
    {
      polarity: { $: "Positive" },
      constness: is_const ? { $: "Maybe", _0: DUMMY_SP } : { $: "Never" },
      asyncness: { $: "Normal" },
    },
    this.trait_ref(path),
    span,
    "No",
  );
};

// rustc: compiler/rustc_expand/src/build.rs:213 trait_bound
ExtCtxt.prototype.trait_bound = function (this: ExtCtxt, path: Path, is_const: boolean): GenericBound {
  return { $: "Trait", _0: this.poly_trait_ref(path.span, path, is_const) };
};

// rustc: compiler/rustc_expand/src/build.rs:217 lifetime
ExtCtxt.prototype.lifetime = function (this: ExtCtxt, span: Span, ident: Ident): Lifetime {
  return { id: DUMMY_NODE_ID, ident: ident.with_span_pos(span) };
};

// rustc: compiler/rustc_expand/src/build.rs:221 lifetime_static
ExtCtxt.prototype.lifetime_static = function (this: ExtCtxt, span: Span): Lifetime {
  return this.lifetime(span, Ident.new(kw.StaticLifetime, span));
};

// rustc: compiler/rustc_expand/src/build.rs:225 stmt_expr
ExtCtxt.prototype.stmt_expr = function (this: ExtCtxt, expr: Expr): Stmt {
  return new Stmt(DUMMY_NODE_ID, { $: "Expr", _0: expr }, expr.span);
};

// rustc: compiler/rustc_expand/src/build.rs:229 stmt_let
ExtCtxt.prototype.stmt_let = function (this: ExtCtxt, sp: Span, mutbl: boolean, ident: Ident, ex: Expr): Stmt {
  return this.stmt_let_ty(sp, mutbl, ident, undefined, ex);
};

// rustc: compiler/rustc_expand/src/build.rs:233 stmt_let_ty
ExtCtxt.prototype.stmt_let_ty = function (
  this: ExtCtxt,
  sp: Span,
  mutbl: boolean,
  ident: Ident,
  ty: Ty | undefined,
  ex: Expr,
): Stmt {
  const pat = mutbl ? this.pat_ident_binding_mode(sp, ident, BindingMode.MUT) : this.pat_ident(sp, ident);
  const local: Local = {
    super_: undefined,
    pat: pat,
    ty,
    id: DUMMY_NODE_ID,
    kind: { $: "Init", _0: ex },
    span: sp,
    colon_sp: undefined,
    attrs: [],
    tokens: undefined,
  };
  return this.stmt_local(local, sp);
};

/// Generates `let _: Type;`, which is usually used for type assertions.
// rustc: compiler/rustc_expand/src/build.rs:261 stmt_let_type_only
ExtCtxt.prototype.stmt_let_type_only = function (this: ExtCtxt, span: Span, ty: Ty): Stmt {
  const local: Local = {
    super_: undefined,
    pat: this.pat_wild(span),
    ty: ty,
    id: DUMMY_NODE_ID,
    kind: { $: "Decl" },
    span,
    colon_sp: undefined,
    attrs: [],
    tokens: undefined,
  };
  return this.stmt_local(local, span);
};

// rustc: compiler/rustc_expand/src/build.rs:276 stmt_local
ExtCtxt.prototype.stmt_local = function (this: ExtCtxt, local: Local, span: Span): Stmt {
  return new Stmt(DUMMY_NODE_ID, { $: "Let", _0: local }, span);
};

// rustc: compiler/rustc_expand/src/build.rs:280 stmt_item
ExtCtxt.prototype.stmt_item = function (this: ExtCtxt, sp: Span, item: Item): Stmt {
  return new Stmt(DUMMY_NODE_ID, { $: "Item", _0: item }, sp);
};

// rustc: compiler/rustc_expand/src/build.rs:284 block_expr
ExtCtxt.prototype.block_expr = function (this: ExtCtxt, expr: Expr): Block {
  return this.block(expr.span, [new Stmt(DUMMY_NODE_ID, { $: "Expr", _0: expr }, expr.span)]);
};
// rustc: compiler/rustc_expand/src/build.rs:294 block
ExtCtxt.prototype.block = function (this: ExtCtxt, span: Span, stmts: Stmt[]): Block {
  return { stmts, id: DUMMY_NODE_ID, rules: { $: "Default" }, span };
};

// rustc: compiler/rustc_expand/src/build.rs:298 expr
ExtCtxt.prototype.expr = function (this: ExtCtxt, span: Span, kind: ExprKind): Expr {
  return new ExprClass(DUMMY_NODE_ID, kind, span, [], undefined);
};

// rustc: compiler/rustc_expand/src/build.rs:308 expr_path
ExtCtxt.prototype.expr_path = function (this: ExtCtxt, path: Path): Expr {
  return this.expr(path.span, { $: "Path", _0: undefined, _1: path });
};

// rustc: compiler/rustc_expand/src/build.rs:312 expr_ident
ExtCtxt.prototype.expr_ident = function (this: ExtCtxt, span: Span, id: Ident): Expr {
  return this.expr_path(this.path_ident(span, id));
};
// rustc: compiler/rustc_expand/src/build.rs:315 expr_self
ExtCtxt.prototype.expr_self = function (this: ExtCtxt, span: Span): Expr {
  return this.expr_ident(span, Ident.new(kw.SelfLower, span));
};
// rustc: compiler/rustc_expand/src/build.rs:318 expr_ident_sym
ExtCtxt.prototype.expr_ident_sym = function (this: ExtCtxt, span: Span, sym_: Symbol): Expr {
  return this.expr_ident(span, Ident.new(sym_, span));
};

// rustc: compiler/rustc_expand/src/build.rs:322 expr_macro_call
ExtCtxt.prototype.expr_macro_call = function (this: ExtCtxt, span: Span, call: MacCall): Expr {
  return this.expr(span, { $: "MacCall", _0: call });
};

// rustc: compiler/rustc_expand/src/build.rs:326 expr_binary
ExtCtxt.prototype.expr_binary = function (this: ExtCtxt, sp: Span, op: BinOpKind, lhs: Expr, rhs: Expr): Expr {
  return this.expr(sp, { $: "Binary", _0: { node: op, span: sp }, _1: lhs, _2: rhs });
};

// rustc: compiler/rustc_expand/src/build.rs:336 expr_deref
ExtCtxt.prototype.expr_deref = function (this: ExtCtxt, sp: Span, e: Expr): Expr {
  return this.expr(sp, { $: "Unary", _0: "Deref", _1: e });
};

// rustc: compiler/rustc_expand/src/build.rs:340 expr_addr_of
ExtCtxt.prototype.expr_addr_of = function (this: ExtCtxt, sp: Span, e: Expr): Expr {
  return this.expr(sp, { $: "AddrOf", _0: "Ref", _1: "Not", _2: e });
};

// rustc: compiler/rustc_expand/src/build.rs:344 expr_paren
ExtCtxt.prototype.expr_paren = function (this: ExtCtxt, sp: Span, e: Expr): Expr {
  return this.expr(sp, { $: "Paren", _0: e });
};

// rustc: compiler/rustc_expand/src/build.rs:348 expr_method_call
ExtCtxt.prototype.expr_method_call = function (this: ExtCtxt, span: Span, expr: Expr, ident: Ident, args: Expr[]): Expr {
  const seg = PathSegment.from_ident(ident);
  return this.expr(span, {
    $: "MethodCall",
    _0: {
      seg,
      receiver: expr,
      args,
      span,
    },
  });
};

// rustc: compiler/rustc_expand/src/build.rs:367 expr_call
ExtCtxt.prototype.expr_call = function (this: ExtCtxt, span: Span, expr: Expr, args: Expr[]): Expr {
  return this.expr(span, { $: "Call", _0: expr, _1: args });
};
// rustc: compiler/rustc_expand/src/build.rs:375 expr_call_ident
ExtCtxt.prototype.expr_call_ident = function (this: ExtCtxt, span: Span, id: Ident, args: Expr[]): Expr {
  return this.expr(span, { $: "Call", _0: this.expr_ident(span, id), _1: args });
};
// rustc: compiler/rustc_expand/src/build.rs:383 expr_call_global
ExtCtxt.prototype.expr_call_global = function (this: ExtCtxt, sp: Span, fn_path: Ident[], args: Expr[]): Expr {
  const pathexpr = this.expr_path(this.path_global(sp, fn_path));
  return this.expr_call(sp, pathexpr, args);
};
// rustc: compiler/rustc_expand/src/build.rs:392 expr_block
ExtCtxt.prototype.expr_block = function (this: ExtCtxt, b: Block): Expr {
  return this.expr(b.span, { $: "Block", _0: b, _1: undefined });
};
// rustc: compiler/rustc_expand/src/build.rs:395 field_imm
ExtCtxt.prototype.field_imm = function (this: ExtCtxt, span: Span, ident: Ident, e: Expr): ExprField {
  return {
    ident: ident.with_span_pos(span),
    expr: e,
    span,
    is_shorthand: false,
    attrs: [],
    id: DUMMY_NODE_ID,
    is_placeholder: false,
  };
};
// rustc: compiler/rustc_expand/src/build.rs:406 expr_struct
ExtCtxt.prototype.expr_struct = function (this: ExtCtxt, span: Span, path: Path, fields: ExprField[]): Expr {
  return this.expr(span, {
    $: "Struct",
    _0: {
      qself: undefined,
      path,
      fields,
      rest: { $: "None" },
    },
  });
};
// rustc: compiler/rustc_expand/src/build.rs:422 expr_struct_ident
ExtCtxt.prototype.expr_struct_ident = function (this: ExtCtxt, span: Span, id: Ident, fields: ExprField[]): Expr {
  return this.expr_struct(span, this.path_ident(span, id), fields);
};

// rustc: compiler/rustc_expand/src/build.rs:431 expr_usize
ExtCtxt.prototype.expr_usize = function (this: ExtCtxt, span: Span, n: number): Expr {
  const suffix = UintTy.name("Usize");
  const lit = Lit.new(LitKind.Integer, sym.integer(n), suffix);
  return this.expr(span, { $: "Lit", _0: lit });
};

// rustc: compiler/rustc_expand/src/build.rs:437 expr_u32
ExtCtxt.prototype.expr_u32 = function (this: ExtCtxt, span: Span, n: number): Expr {
  const suffix = UintTy.name("U32");
  const lit = Lit.new(LitKind.Integer, sym.integer(n), suffix);
  return this.expr(span, { $: "Lit", _0: lit });
};

// rustc: compiler/rustc_expand/src/build.rs:443 expr_bool
ExtCtxt.prototype.expr_bool = function (this: ExtCtxt, span: Span, value: boolean): Expr {
  const lit = Lit.new(LitKind.Bool, value ? kw.True : kw.False, undefined);
  return this.expr(span, { $: "Lit", _0: lit });
};

// rustc: compiler/rustc_expand/src/build.rs:448 expr_str
ExtCtxt.prototype.expr_str = function (this: ExtCtxt, span: Span, s: Symbol): Expr {
  const lit = Lit.new(LitKind.Str, escape_string_symbol(s), undefined);
  return this.expr(span, { $: "Lit", _0: lit });
};

// rustc: compiler/rustc_expand/src/build.rs:453 expr_byte_str
ExtCtxt.prototype.expr_byte_str = function (this: ExtCtxt, span: Span, bytes: Uint8Array): Expr {
  const lit = Lit.new(LitKind.ByteStr, escape_byte_str_symbol(bytes), undefined);
  return this.expr(span, { $: "Lit", _0: lit });
};

/// `[expr1, expr2, ...]`
// rustc: compiler/rustc_expand/src/build.rs:459 expr_array
ExtCtxt.prototype.expr_array = function (this: ExtCtxt, sp: Span, exprs: Expr[]): Expr {
  return this.expr(sp, { $: "Array", _0: exprs });
};

/// `&[expr1, expr2, ...]`
// rustc: compiler/rustc_expand/src/build.rs:464 expr_array_ref
ExtCtxt.prototype.expr_array_ref = function (this: ExtCtxt, sp: Span, exprs: Expr[]): Expr {
  return this.expr_addr_of(sp, this.expr_array(sp, exprs));
};

// rustc: compiler/rustc_expand/src/build.rs:468 expr_some
ExtCtxt.prototype.expr_some = function (this: ExtCtxt, sp: Span, expr: Expr): Expr {
  const some = this.std_path([sym.option, sym.Option, sym.Some]);
  return this.expr_call_global(sp, some, [expr]);
};

// rustc: compiler/rustc_expand/src/build.rs:473 expr_none
ExtCtxt.prototype.expr_none = function (this: ExtCtxt, sp: Span): Expr {
  const none = this.std_path([sym.option, sym.Option, sym.None]);
  return this.expr_path(this.path_global(sp, none));
};
// rustc: compiler/rustc_expand/src/build.rs:477 expr_tuple
ExtCtxt.prototype.expr_tuple = function (this: ExtCtxt, sp: Span, exprs: Expr[]): Expr {
  return this.expr(sp, { $: "Tup", _0: exprs });
};

// rustc: compiler/rustc_expand/src/build.rs:481 expr_ok
ExtCtxt.prototype.expr_ok = function (this: ExtCtxt, sp: Span, expr: Expr): Expr {
  const ok = this.std_path([sym.result, sym.Result, sym.Ok]);
  return this.expr_call_global(sp, ok, [expr]);
};

// rustc: compiler/rustc_expand/src/build.rs:486 pat
ExtCtxt.prototype.pat = function (this: ExtCtxt, span: Span, kind: PatKind): Pat {
  return new Pat(DUMMY_NODE_ID, kind, span);
};
// rustc: compiler/rustc_expand/src/build.rs:489 pat_wild
ExtCtxt.prototype.pat_wild = function (this: ExtCtxt, span: Span): Pat {
  return this.pat(span, { $: "Wild" });
};
// rustc: compiler/rustc_expand/src/build.rs:492 pat_ident
ExtCtxt.prototype.pat_ident = function (this: ExtCtxt, span: Span, ident: Ident): Pat {
  return this.pat_ident_binding_mode(span, ident, BindingMode.NONE);
};

// rustc: compiler/rustc_expand/src/build.rs:496 pat_ident_binding_mode
ExtCtxt.prototype.pat_ident_binding_mode = function (this: ExtCtxt, span: Span, ident: Ident, ann: BindingMode): Pat {
  // PORT: `BindingMode` is Copy; the shared associated consts are copied into the new node.
  const pat: PatKind = { $: "Ident", _0: new BindingMode(ann._0, ann._1), _1: ident.with_span_pos(span), _2: undefined };
  return this.pat(span, pat);
};
// rustc: compiler/rustc_expand/src/build.rs:505 pat_path
ExtCtxt.prototype.pat_path = function (this: ExtCtxt, span: Span, path: Path): Pat {
  return this.pat(span, { $: "Path", _0: undefined, _1: path });
};
// rustc: compiler/rustc_expand/src/build.rs:508 pat_tuple_struct
ExtCtxt.prototype.pat_tuple_struct = function (this: ExtCtxt, span: Span, path: Path, subpats: Pat[]): Pat {
  return this.pat(span, { $: "TupleStruct", _0: undefined, _1: path, _2: subpats });
};
// rustc: compiler/rustc_expand/src/build.rs:516 pat_struct
ExtCtxt.prototype.pat_struct = function (this: ExtCtxt, span: Span, path: Path, field_pats: PatField[]): Pat {
  return this.pat(span, { $: "Struct", _0: undefined, _1: path, _2: field_pats, _3: { $: "None" } });
};
// rustc: compiler/rustc_expand/src/build.rs:524 pat_tuple
ExtCtxt.prototype.pat_tuple = function (this: ExtCtxt, span: Span, pats: Pat[]): Pat {
  return this.pat(span, { $: "Tuple", _0: pats });
};

// rustc: compiler/rustc_expand/src/build.rs:528 pat_some
ExtCtxt.prototype.pat_some = function (this: ExtCtxt, span: Span, pat: Pat): Pat {
  const some = this.std_path([sym.option, sym.Option, sym.Some]);
  const path = this.path_global(span, some);
  return this.pat_tuple_struct(span, path, [pat]);
};

// rustc: compiler/rustc_expand/src/build.rs:534 arm
ExtCtxt.prototype.arm = function (this: ExtCtxt, span: Span, pat: Pat, expr: Expr): Arm {
  return {
    attrs: [],
    pat: pat,
    guard: undefined,
    body: expr,
    span,
    id: DUMMY_NODE_ID,
    is_placeholder: false,
  };
};

// rustc: compiler/rustc_expand/src/build.rs:546 expr_match
ExtCtxt.prototype.expr_match = function (this: ExtCtxt, span: Span, arg: Expr, arms: Arm[]): Expr {
  return this.expr(span, { $: "Match", _0: arg, _1: arms, _2: "Prefix" });
};

// rustc: compiler/rustc_expand/src/build.rs:555 expr_if
ExtCtxt.prototype.expr_if = function (this: ExtCtxt, span: Span, cond: Expr, then: Expr, els: Expr | undefined): Expr {
  const els_ = els === undefined ? undefined : this.expr_block(this.block_expr(els));
  return this.expr(span, { $: "If", _0: cond, _1: this.block_expr(then), _2: els_ });
};

// rustc: compiler/rustc_expand/src/build.rs:566 closure
ExtCtxt.prototype.closure = function (this: ExtCtxt, span: Span, ids: Ident[], body: Expr): Expr {
  const fn_decl = this.fn_decl(
    ids.map((id) => this.param(span, id, this.ty(span, { $: "Infer" }))),
    { $: "Default", _0: span },
  );

  // FIXME -- We are using `span` as the span of the `|...|`
  // part of the closure, but it probably (maybe?) corresponds to
  // the entire closure body. Probably we should extend the API
  // here, but that's not entirely clear.
  return this.expr(span, {
    $: "Closure",
    _0: {
      binder: { $: "NotPresent" },
      capture_clause: { $: "Ref" },
      constness: { $: "No" },
      coroutine_marker: undefined,
      movability: "Movable",
      fn_decl,
      body,
      fn_decl_span: span,
      // FIXME(SarthakSingh31): This points to the start of the declaration block and
      // not the span of the argument block.
      fn_arg_span: span,
    },
  });
};

// rustc: compiler/rustc_expand/src/build.rs:594 param
ExtCtxt.prototype.param = function (this: ExtCtxt, span: Span, ident: Ident, ty: Ty): Param {
  const pat = this.pat_ident(span, ident);
  return new Param([], ty, pat, DUMMY_NODE_ID, span, false);
};

// `self` is unused but keep it as method for the convenience use.
// rustc: compiler/rustc_expand/src/build.rs:607 fn_decl
ExtCtxt.prototype.fn_decl = function (this: ExtCtxt, inputs: Param[], output: FnRetTy): FnDecl {
  return new FnDecl(inputs, output);
};

// rustc: compiler/rustc_expand/src/build.rs:611 item
ExtCtxt.prototype.item = function (this: ExtCtxt, span: Span, attrs: AttrVec, kind: ItemKind): Item {
  return new Item(
    attrs,
    DUMMY_NODE_ID,
    span,
    {
      span: Span.shrink_to_lo(span),
      kind: { $: "Inherited" },
    },
    kind,
    undefined,
  );
};

// rustc: compiler/rustc_expand/src/build.rs:625 item_trait_impl
ExtCtxt.prototype.item_trait_impl = function (
  this: ExtCtxt,
  span: Span,
  attrs: AttrVec,
  generics: Generics,
  safety: Safety,
  is_const: boolean,
  trait_ref: TraitRef,
  self_ty: Ty,
  items: AssocItem[],
): Item {
  return this.item(span, attrs, {
    $: "Impl",
    _0: {
      generics,
      of_trait: {
        safety,
        polarity: { $: "Positive" },
        defaultness: { $: "Implicit" },
        trait_ref,
      },
      constness: is_const ? { $: "Yes", _0: DUMMY_SP } : { $: "No" },
      self_ty,
      items,
    },
  });
};

// rustc: compiler/rustc_expand/src/build.rs:654 item_static
ExtCtxt.prototype.item_static = function (
  this: ExtCtxt,
  span: Span,
  attrs: AttrVec,
  ident: Ident,
  ty: Ty,
  mutability: Mutability,
  expr: Expr,
): Item {
  return this.item(span, attrs, {
    $: "Static",
    _0: {
      ident,
      ty,
      safety: { $: "Default" },
      mutability,
      expr: expr,
      define_opaque: undefined,
      eii_impl: undefined,
    },
  });
};

// rustc: compiler/rustc_expand/src/build.rs:681 item_const
ExtCtxt.prototype.item_const = function (this: ExtCtxt, span: Span, ident: Ident, ty: Ty, body: Expr | undefined): Item {
  const defaultness = { $: "Implicit" } as const;
  return this.item(span, [], {
    $: "Const",
    _0: {
      defaultness,
      ident,
      // FIXME(generic_const_items): Pass the generics as a parameter.
      // PORT: `ast::Generics::default()` (derive(Default)) written out.
      generics: { params: [], where_clause: new WhereClause(false, [], DUMMY_SP), span: DUMMY_SP },
      ty,
      body,
      define_opaque: undefined,
    },
  });
};

// Builds `#[name]`.
// rustc: compiler/rustc_expand/src/build.rs:708 attr_word
ExtCtxt.prototype.attr_word = function (this: ExtCtxt, name: Symbol, span: Span): Attribute {
  const g = this.sess.psess.attr_id_generator;
  return mk_attr_word(g, AttrStyle.Outer, name, span);
};

// Builds `#[name = val]`.
//
// Note: `span` is used for both the identifier and the value.
// rustc: compiler/rustc_expand/src/build.rs:716 attr_name_value_str
ExtCtxt.prototype.attr_name_value_str = function (this: ExtCtxt, name: Symbol, val: Symbol, span: Span): Attribute {
  const g = this.sess.psess.attr_id_generator;
  return mk_attr_name_value_str(g, AttrStyle.Outer, name, val, span);
};

// Builds `#[outer(inner)]`.
// rustc: compiler/rustc_expand/src/build.rs:722 attr_nested_word
ExtCtxt.prototype.attr_nested_word = function (this: ExtCtxt, outer: Symbol, inner: Symbol, span: Span): Attribute {
  const g = this.sess.psess.attr_id_generator;
  return mk_attr_nested_word(g, AttrStyle.Outer, outer, inner, span);
};

// Builds an attribute fully manually.
// rustc: compiler/rustc_expand/src/build.rs:728 attr_nested
ExtCtxt.prototype.attr_nested = function (this: ExtCtxt, inner: AttrItem, span: Span): Attribute {
  const g = this.sess.psess.attr_id_generator;
  return mk_attr_from_item(g, inner, undefined, AttrStyle.Outer, span);
};

// rustc: compiler/rustc_expand/src/build.rs:733 empty_generics
ExtCtxt.prototype.empty_generics = function (this: ExtCtxt, span: Span): Generics {
  return {
    params: [],
    where_clause: new WhereClause(false, [], span),
    span,
  };
};
