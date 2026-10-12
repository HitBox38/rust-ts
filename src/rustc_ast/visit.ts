// Port of compiler/rustc_ast/src/visit.rs
//! AST walker. Each overridden visit method has full control over what
//! happens with its node, it can do its own traversal of the node's children,
//! call `visit::walk_*` to apply the default traversal algorithm, or prevent
//! deeper traversal by doing nothing.
//!
//! Note: it is an important invariant that the default visitor walks the body
//! of a function in "execution order" (more concretely, reverse post-order
//! with respect to the CFG implied by the AST), meaning that if AST node A may
//! execute before AST node B, then A is visited first. The borrow checker in
//! particular relies on this property.
//!
//! Note: walking an AST before macro expansion is probably a bad idea. For
//! instance, a walker looking for item names in a module will miss all of
//! those that are created by the expansion of a macro.
//
// Types and derived Debug impls of this file are generated into visit.gen.ts (tools/codegen/types.ts).
//
// PORT: layout of the `macro_rules!` in this file. `common_visitor_and_walkers!` is invoked twice:
// here as `common_visitor_and_walkers!(Visitor<'a>)` and in mut_visit.rs as `(mut) MutVisitor`. Each
// invocation's *expansion* is written out in its own file, in expansion order, using that file's
// helper macros (`impl_visitable!`, `impl_walkable!`, ...: mut_visit.rs defines its own). Markers sit on
// the line of the `fn` keyword inside the macro body (what coverage.ts counts), so both expansions share
// the visit.rs markers of `common_visitor_and_walkers!`. Fns whose name is a macro metavariable
// (`fn $visit` in `fn_visit!`, `fn $walk` in `fn_walk!`) are not upstream fns for coverage; their
// expansions carry a `// rustc-macro:` comment instead.
//
// PORT: trait dispatch. `Visitable`/`Walkable` impls are selected by the static Rust type, which TS
// values do not carry (enum tags overlap between types; structs have none). So each trait is a type
// (the impl signature) plus a same-named const table holding one impl per implementing type, keyed by
// the Rust type as written in the macro lists (`Visitable.Expr`, `Visitable["ThinVec<Box<Ty>>"]`).
// Generic impls (`Option<T>`, `Spanned<T>`, `Vec<T>`, `[T]`, tuples, `Box<T>`) take the impl of `T`
// as a trailing argument (PORTING §5: pass function tables when dispatch depends on the type).
// `Box<T>` is the identity, so call sites use `T`'s impl directly.
//
// PORT: `Visitor::Result`. The associated type is carried by the visitor as its `Result` property, the
// `VisitorResult` impl object (rustc_ast_ir/visit.ts). The default is `VisitorResult.unit` (`()` is
// `undefined`); a visitor with `type Result = ControlFlow<T>` extends `Visitor<ControlFlow<T>>` and sets
// `Result = VisitorResult.ControlFlow<T>()`. `try_visit!(e)` is expanded as
// `if ((r = try_visit(visitor.Result, e)) !== undefined) return r;`.
import { try_visit, VisitorResult } from "../rustc_ast_ir/visit.ts";
// pub use rustc_ast_ir::visit::VisitorResult;
// pub use rustc_ast_ir::{try_visit, visit_opt, walk_list, walk_visitable_list};  (the last three are macros)
export { try_visit, VisitorResult };
import type { Movability, Mutability, Pinnedness } from "../rustc_ast_ir/lib.ts";
import type { AttrId, ErrorGuaranteed, Span, Spanned } from "../rustc_span/lib.ts";
import type { ByteSymbol, Ident, Symbol } from "../rustc_span/symbol.ts";
import { type Debug, debug_option, debug_tuple } from "../std/fmt.ts";
import type { Result } from "../std/result.ts";
import {
  type AngleBracketedArg,
  type AngleBracketedArgs,
  type AnonConst,
  type Arm,
  type AsmMacro,
  type AssignOpKind,
  type AssocItem,
  type AssocItemConstraint,
  type AssocItemConstraintKind,
  type AssocItemKind,
  type AttrArgs,
  type AttrItem,
  type AttrKind,
  type AttrStyle,
  type AttrVec,
  type Attribute,
  type BinOpKind,
  type BindingMode,
  type Block,
  type BlockCheckMode,
  type BorrowKind,
  type BoundAsyncness,
  type BoundConstness,
  type BoundPolarity,
  type ByRef,
  type CaptureBy,
  type Closure,
  type ClosureBinder,
  type Const,
  type ConstBlockItem,
  type ConstItem,
  type CoroutineKind,
  type CoroutineMarker,
  type Crate,
  type Defaultness,
  type Delegation,
  type DelegationMac,
  type DelegationSuffixes,
  type DelimArgs,
  type EiiDecl,
  type EiiImpl,
  type EnumDef,
  type Expr,
  type ExprField,
  type Extern,
  type FieldDef,
  type FieldDefExtras,
  type Fn,
  type FnContract,
  type FnDecl,
  type FnHeader,
  type FnPtrTy,
  type FnRetTy,
  type ForeignItem,
  type ForeignItemKind,
  type ForeignMod,
  type ForLoop,
  type ForLoopKind,
  type GenericArg,
  type GenericArgs,
  type GenericBound,
  type GenericParam,
  type GenericParamKind,
  type Generics,
  type Guard,
  type Impl,
  type ImplPolarity,
  type ImplRestriction,
  type Inline,
  type InlineAsm,
  type InlineAsmOperand,
  type InlineAsmRegOrRegClass,
  type InlineAsmSym,
  type InlineAsmTemplatePiece,
  type IsAuto,
  type Item,
  type ItemKind,
  type Label,
  type Lifetime,
  type Local,
  type LocalKind,
  type MacCall,
  type MacCallStmt,
  type MacroDef,
  type MacStmtStyle,
  type MatchKind,
  type MethodCall,
  type ModKind,
  type ModSpans,
  type MutRestriction,
  type NormalAttr,
  type Param,
  type Parens,
  type ParenthesizedArgs,
  type Pat,
  type PatField,
  type PatFieldsRest,
  type PatKind,
  type Path,
  type PathSegment,
  type PolyTraitRef,
  type PreciseCapturingArg,
  type QSelf,
  type RangeEnd,
  type RangeLimits,
  type RangeSyntax,
  type Recovered,
  type RestrictionKind,
  type Safety,
  type StaticItem,
  type Stmt,
  type StmtKind,
  type StrLit,
  type StrStyle,
  type StructExpr,
  type StructRest,
  type SyntheticAttr,
  type Term,
  type TestBinderBody,
  type TestBinderBoundTypeConstraint,
  type TestBinderConstraint,
  type TestBinderConstraints,
  type TestBinderExists,
  type TestBinderForall,
  type Trait,
  type TraitAlias,
  type TraitBoundModifiers,
  type TraitObjectSyntax,
  type TraitRef,
  type Ty,
  type TyAlias,
  type TyKind,
  type TyPat,
  type TyPatKind,
  type UnOp,
  type UnsafeBinderCastKind,
  type UnsafeBinderTy,
  type UnsafeSource,
  type UseTree,
  type UseTreeAndId,
  type UseTreeKind,
  type Variant,
  type VariantData,
  type Visibility,
  type VisibilityKind,
  type WhereBoundPredicate,
  type WhereClause,
  type WhereEqPredicate,
  type WherePredicate,
  type WherePredicateKind,
  type WhereRegionPredicate,
  type YieldKind,
  debug_ClosureBinder,
  debug_CoroutineMarker,
  debug_Expr,
  debug_Fn,
  debug_FnDecl,
  debug_Visibility,
} from "./ast.ts";
import type { NodeId } from "./node_id.ts";
import type {
  FormatArgPosition,
  FormatArgs,
  FormatArgsPiece,
  FormatArgument,
  FormatArgumentKind,
  FormatArguments,
  FormatPlaceholder,
} from "./format.ts";
import type { CommentKind, Delimiter, Lit, LitKind } from "./token.ts";
import type { DelimSpan, LazyAttrTokenStream, TokenStream } from "./tokenstream.ts";
import { AssocCtxt, BoundKind as gen_BoundKind, debug_FnCtxt, FnCtxt, LifetimeCtxt } from "./visit.gen.ts";
import { walkable_derived } from "./walkable.gen.ts";

export * from "./visit.gen.ts";

/** `BoundKind` companion, with the inherent methods of `impl BoundKind`. */
export const BoundKind = {
  ...gen_BoundKind,
  // rustc: compiler/rustc_ast/src/visit.rs:57 descr
  descr(self: BoundKind): string {
    switch (self) {
      case "Bound":
        return "bounds";
      case "Impl":
        return "`impl Trait`";
      case "TraitObject":
        return "`dyn` trait object bounds";
      case "SuperTraits":
        return "supertrait bounds";
    }
  },
};
export type BoundKind = gen_BoundKind;

// rustc-trait: compiler/rustc_ast/src/visit.rs:77 Visitable
// PORT: `trait Visitable<'a, V: Visitor<'a>> { type Extra: Copy; fn visit(&'a self, visitor: &mut V,
// extra: Self::Extra) -> V::Result; }` -> the signature of one impl; `E` is `Self::Extra`.
// rustc: compiler/rustc_ast/src/visit.rs:81 visit
export type Visitable<T, E = undefined> = <R>(self: T, visitor: Visitor<R>, extra: E) => R;

const visitable_generic = {
  // rustc: compiler/rustc_ast/src/visit.rs:89 visit
  Box: <T, E, R>(self: T, visitor: Visitor<R>, extra: E, T_: Visitable<T, E>): R => T_(self, visitor, extra),
  // rustc: compiler/rustc_ast/src/visit.rs:99 visit
  Option: <T, E, R>(self: T | undefined, visitor: Visitor<R>, extra: E, T_: Visitable<T, E>): R => {
    let r: R | undefined;
    if (self !== undefined) {
      const this_ = self;
      if ((r = try_visit(visitor.Result, T_(this_, visitor, extra))) !== undefined) return r;
    }
    return visitor.Result.output();
  },
  // rustc: compiler/rustc_ast/src/visit.rs:112 visit
  Spanned: <T, E, R>(self: Spanned<T>, visitor: Visitor<R>, extra: E, T_: Visitable<T, E>): R => {
    const { span: _, node } = self;
    return T_(node, visitor, extra);
  },
  // rustc: compiler/rustc_ast/src/visit.rs:123 visit
  "[T]": <T, E, R>(self: readonly T[], visitor: Visitor<R>, extra: E, T_: Visitable<T, E>): R => {
    let r: R | undefined;
    for (const item of self) {
      if ((r = try_visit(visitor.Result, T_(item, visitor, extra))) !== undefined) return r;
    }
    return visitor.Result.output();
  },
  // rustc: compiler/rustc_ast/src/visit.rs:136 visit
  Vec: <T, E, R>(self: T[], visitor: Visitor<R>, extra: E, T_: Visitable<T, E>): R => {
    let r: R | undefined;
    for (const item of self) {
      if ((r = try_visit(visitor.Result, T_(item, visitor, extra))) !== undefined) return r;
    }
    return visitor.Result.output();
  },
  // rustc: compiler/rustc_ast/src/visit.rs:150 visit
  "(T1, T2)": <T1, T2, R>(self: [T1, T2], visitor: Visitor<R>, extra: undefined, T1_: Visitable<T1>, T2_: Visitable<T2>): R => {
    let r: R | undefined;
    if ((r = try_visit(visitor.Result, T1_(self[0], visitor, extra))) !== undefined) return r;
    if ((r = try_visit(visitor.Result, T2_(self[1], visitor, extra))) !== undefined) return r;
    return visitor.Result.output();
  },
  // rustc: compiler/rustc_ast/src/visit.rs:164 visit
  "(T1, T2, T3)": <T1, T2, T3, R>(
    self: [T1, T2, T3],
    visitor: Visitor<R>,
    extra: undefined,
    T1_: Visitable<T1>,
    T2_: Visitable<T2>,
    T3_: Visitable<T3>,
  ): R => {
    let r: R | undefined;
    if ((r = try_visit(visitor.Result, T1_(self[0], visitor, extra))) !== undefined) return r;
    if ((r = try_visit(visitor.Result, T2_(self[1], visitor, extra))) !== undefined) return r;
    if ((r = try_visit(visitor.Result, T3_(self[2], visitor, extra))) !== undefined) return r;
    return visitor.Result.output();
  },
  // rustc: compiler/rustc_ast/src/visit.rs:180 visit
  "(T1, T2, T3, T4)": <T1, T2, T3, T4, R>(
    self: [T1, T2, T3, T4],
    visitor: Visitor<R>,
    extra: undefined,
    T1_: Visitable<T1>,
    T2_: Visitable<T2>,
    T3_: Visitable<T3>,
    T4_: Visitable<T4>,
  ): R => {
    let r: R | undefined;
    if ((r = try_visit(visitor.Result, T1_(self[0], visitor, extra))) !== undefined) return r;
    if ((r = try_visit(visitor.Result, T2_(self[1], visitor, extra))) !== undefined) return r;
    if ((r = try_visit(visitor.Result, T3_(self[2], visitor, extra))) !== undefined) return r;
    if ((r = try_visit(visitor.Result, T4_(self[3], visitor, extra))) !== undefined) return r;
    return visitor.Result.output();
  },
};

// rustc-trait: compiler/rustc_ast/src/visit.rs:189 Walkable
// rustc: compiler/rustc_ast/src/visit.rs:191 walk_ref
export type Walkable<T> = <R>(self: T, visitor: Visitor<R>) => R;

// ---- Expansion of `common_visitor_and_walkers!(Visitor<'a>)` (visit.rs:382..1125) ----

// PORT: `pub enum FnKind<'a>` (defined inside the macro, so not generated). `&'a T` -> `T`.
export type FnKind =
  /// E.g., `fn foo()`, `fn foo(&self)`, or `extern "Abi" fn foo()`.
  | { readonly $: "Fn"; _0: FnCtxt; _1: Visibility; _2: Fn }
  /// E.g., `|x, y| body`.
  | { readonly $: "Closure"; _0: ClosureBinder; _1: CoroutineMarker | undefined; _2: FnDecl; _3: Expr };
export const debug_FnKind: Debug<FnKind> = (v, f) => {
  switch (v.$) {
    case "Fn":
      return debug_tuple(f, "Fn", [debug_FnCtxt(v._0, f), debug_Visibility(v._1, f), debug_Fn(v._2, f)]);
    case "Closure":
      return debug_tuple(f, "Closure", [
        debug_ClosureBinder(v._0, f),
        debug_option(v._1, f, debug_CoroutineMarker),
        debug_FnDecl(v._2, f),
        debug_Expr(v._3, f),
      ]);
  }
};
/** `impl<'a> FnKind<'_>` (methods on the companion, PORTING §8). */
export const FnKind = {
  // rustc: compiler/rustc_ast/src/visit.rs:402 header
  header(self: FnKind): FnHeader | undefined {
    switch (self.$) {
      case "Fn":
        return self._2.sig.header;
      case "Closure":
        return undefined;
    }
  },

  // rustc: compiler/rustc_ast/src/visit.rs:409 ident
  ident(self: FnKind): Ident | undefined {
    switch (self.$) {
      case "Fn":
        return self._2.ident;
      default:
        return undefined;
    }
  },

  // rustc: compiler/rustc_ast/src/visit.rs:416 decl
  decl(self: FnKind): FnDecl {
    switch (self.$) {
      case "Fn":
        return self._2.sig.decl;
      case "Closure":
        return self._2;
    }
  },

  // rustc: compiler/rustc_ast/src/visit.rs:423 ctxt
  ctxt(self: FnKind): FnCtxt | undefined {
    switch (self.$) {
      case "Fn":
        return self._0;
      case "Closure":
        return undefined;
    }
  },
};

// This macro generates `impl Visitable` and `impl MutVisitable` that do nothing.
const visitable_noop = {
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  AttrId: <R>(_self: AttrId, _vis: Visitor<R>, _extra: undefined): R => _vis.Result.output(),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  Movability: <R>(_self: Movability, _vis: Visitor<R>, _extra: undefined): R => _vis.Result.output(),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  Mutability: <R>(_self: Mutability, _vis: Visitor<R>, _extra: undefined): R => _vis.Result.output(),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  Pinnedness: <R>(_self: Pinnedness, _vis: Visitor<R>, _extra: undefined): R => _vis.Result.output(),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  "Result<(), ErrorGuaranteed>": <R>(_self: Result<null, ErrorGuaranteed>, _vis: Visitor<R>, _extra: undefined): R => _vis.Result.output(),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  Symbol: <R>(_self: Symbol, _vis: Visitor<R>, _extra: undefined): R => _vis.Result.output(),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  SyntheticAttr: <R>(_self: SyntheticAttr, _vis: Visitor<R>, _extra: undefined): R => _vis.Result.output(),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  bool: <R>(_self: boolean, _vis: Visitor<R>, _extra: undefined): R => _vis.Result.output(),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  char: <R>(_self: number, _vis: Visitor<R>, _extra: undefined): R => _vis.Result.output(),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  CommentKind: <R>(_self: CommentKind, _vis: Visitor<R>, _extra: undefined): R => _vis.Result.output(),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  Delimiter: <R>(_self: Delimiter, _vis: Visitor<R>, _extra: undefined): R => _vis.Result.output(),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  Lit: <R>(_self: Lit, _vis: Visitor<R>, _extra: undefined): R => _vis.Result.output(),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  LitKind: <R>(_self: LitKind, _vis: Visitor<R>, _extra: undefined): R => _vis.Result.output(),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  LazyAttrTokenStream: <R>(_self: LazyAttrTokenStream, _vis: Visitor<R>, _extra: undefined): R => _vis.Result.output(),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  TokenStream: <R>(_self: TokenStream, _vis: Visitor<R>, _extra: undefined): R => _vis.Result.output(),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  "FxHashMap<Symbol, usize>": <R>(_self: Map<Symbol, number>, _vis: Visitor<R>, _extra: undefined): R => _vis.Result.output(),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  ByteSymbol: <R>(_self: ByteSymbol, _vis: Visitor<R>, _extra: undefined): R => _vis.Result.output(),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  ErrorGuaranteed: <R>(_self: ErrorGuaranteed, _vis: Visitor<R>, _extra: undefined): R => _vis.Result.output(),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  "Cow<str>": <R>(_self: string, _vis: Visitor<R>, _extra: undefined): R => _vis.Result.output(),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  u8: <R>(_self: number, _vis: Visitor<R>, _extra: undefined): R => _vis.Result.output(),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  usize: <R>(_self: number, _vis: Visitor<R>, _extra: undefined): R => _vis.Result.output(),
  // `Span` is a no-op for the immutable visitor.
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  Span: <R>(_self: Span, _vis: Visitor<R>, _extra: undefined): R => _vis.Result.output(),
};

// This macro generates `impl Visitable` and `impl MutVisitable` that simply iterate over
// their contents. We do not use a generic impl for `ThinVec` because we want to allow
// custom visits for the `MutVisitor`.
const visitable_list = {
  // rustc: compiler/rustc_ast/src/visit.rs:262 visit
  "ThinVec<(Ident, Option<Ident>)>": <R>(self: [Ident, Ident | undefined][], visitor: Visitor<R>, extra: undefined): R => {
    let r: R | undefined;
    for (const i of self) {
      if ((r = try_visit(visitor.Result, Visitable["(T1, T2)"](i, visitor, extra, Visitable.Ident, Option_Ident))) !== undefined) return r;
    }
    return visitor.Result.output();
  },
  // rustc: compiler/rustc_ast/src/visit.rs:262 visit
  "ThinVec<(NodeId, Path)>": <R>(self: [NodeId, Path][], visitor: Visitor<R>, extra: undefined): R => {
    let r: R | undefined;
    for (const i of self) {
      if ((r = try_visit(visitor.Result, Visitable["(T1, T2)"](i, visitor, extra, Visitable.NodeId, Visitable.Path))) !== undefined) return r;
    }
    return visitor.Result.output();
  },
  // rustc: compiler/rustc_ast/src/visit.rs:262 visit
  "ThinVec<AngleBracketedArg>": <R>(self: AngleBracketedArg[], visitor: Visitor<R>, extra: undefined): R => {
    let r: R | undefined;
    for (const i of self) {
      if ((r = try_visit(visitor.Result, Visitable.AngleBracketedArg(i, visitor, extra))) !== undefined) return r;
    }
    return visitor.Result.output();
  },
  // rustc: compiler/rustc_ast/src/visit.rs:262 visit
  "ThinVec<Attribute>": <R>(self: Attribute[], visitor: Visitor<R>, extra: undefined): R => {
    let r: R | undefined;
    for (const i of self) {
      if ((r = try_visit(visitor.Result, Visitable.Attribute(i, visitor, extra))) !== undefined) return r;
    }
    return visitor.Result.output();
  },
  // rustc: compiler/rustc_ast/src/visit.rs:262 visit
  "ThinVec<Box<Ty>>": <R>(self: Ty[], visitor: Visitor<R>, extra: undefined): R => {
    let r: R | undefined;
    for (const i of self) {
      if ((r = try_visit(visitor.Result, Visitable.Ty(i, visitor, extra))) !== undefined) return r;
    }
    return visitor.Result.output();
  },
  // rustc: compiler/rustc_ast/src/visit.rs:262 visit
  "ThinVec<EiiImpl>": <R>(self: EiiImpl[], visitor: Visitor<R>, extra: undefined): R => {
    let r: R | undefined;
    for (const i of self) {
      if ((r = try_visit(visitor.Result, Visitable.EiiImpl(i, visitor, extra))) !== undefined) return r;
    }
    return visitor.Result.output();
  },
  // rustc: compiler/rustc_ast/src/visit.rs:262 visit
  "ThinVec<GenericBound>": <R>(self: GenericBound[], visitor: Visitor<R>, extra: BoundKind): R => {
    let r: R | undefined;
    for (const i of self) {
      if ((r = try_visit(visitor.Result, Visitable.GenericBound(i, visitor, extra))) !== undefined) return r;
    }
    return visitor.Result.output();
  },
  // rustc: compiler/rustc_ast/src/visit.rs:262 visit
  "ThinVec<Ident>": <R>(self: Ident[], visitor: Visitor<R>, extra: undefined): R => {
    let r: R | undefined;
    for (const i of self) {
      if ((r = try_visit(visitor.Result, Visitable.Ident(i, visitor, extra))) !== undefined) return r;
    }
    return visitor.Result.output();
  },
  // rustc: compiler/rustc_ast/src/visit.rs:262 visit
  "ThinVec<Pat>": <R>(self: Pat[], visitor: Visitor<R>, extra: undefined): R => {
    let r: R | undefined;
    for (const i of self) {
      if ((r = try_visit(visitor.Result, Visitable.Pat(i, visitor, extra))) !== undefined) return r;
    }
    return visitor.Result.output();
  },
  // rustc: compiler/rustc_ast/src/visit.rs:262 visit
  "ThinVec<PathSegment>": <R>(self: PathSegment[], visitor: Visitor<R>, extra: undefined): R => {
    let r: R | undefined;
    for (const i of self) {
      if ((r = try_visit(visitor.Result, Visitable.PathSegment(i, visitor, extra))) !== undefined) return r;
    }
    return visitor.Result.output();
  },
  // rustc: compiler/rustc_ast/src/visit.rs:262 visit
  "ThinVec<PreciseCapturingArg>": <R>(self: PreciseCapturingArg[], visitor: Visitor<R>, extra: undefined): R => {
    let r: R | undefined;
    for (const i of self) {
      if ((r = try_visit(visitor.Result, Visitable.PreciseCapturingArg(i, visitor, extra))) !== undefined) return r;
    }
    return visitor.Result.output();
  },
  // rustc: compiler/rustc_ast/src/visit.rs:262 visit
  "ThinVec<TestBinderConstraint>": <R>(self: TestBinderConstraint[], visitor: Visitor<R>, extra: undefined): R => {
    let r: R | undefined;
    for (const i of self) {
      if ((r = try_visit(visitor.Result, Visitable.TestBinderConstraint(i, visitor, extra))) !== undefined) return r;
    }
    return visitor.Result.output();
  },
  // rustc: compiler/rustc_ast/src/visit.rs:262 visit
  "ThinVec<TestBinderExists>": <R>(self: TestBinderExists[], visitor: Visitor<R>, extra: undefined): R => {
    let r: R | undefined;
    for (const i of self) {
      if ((r = try_visit(visitor.Result, Visitable.TestBinderExists(i, visitor, extra))) !== undefined) return r;
    }
    return visitor.Result.output();
  },
  // rustc: compiler/rustc_ast/src/visit.rs:262 visit
  "ThinVec<TestBinderForall>": <R>(self: TestBinderForall[], visitor: Visitor<R>, extra: undefined): R => {
    let r: R | undefined;
    for (const i of self) {
      if ((r = try_visit(visitor.Result, Visitable.TestBinderForall(i, visitor, extra))) !== undefined) return r;
    }
    return visitor.Result.output();
  },
  // rustc: compiler/rustc_ast/src/visit.rs:262 visit
  "ThinVec<TyPat>": <R>(self: TyPat[], visitor: Visitor<R>, extra: undefined): R => {
    let r: R | undefined;
    for (const i of self) {
      if ((r = try_visit(visitor.Result, Visitable.TyPat(i, visitor, extra))) !== undefined) return r;
    }
    return visitor.Result.output();
  },
  // rustc: compiler/rustc_ast/src/visit.rs:262 visit
  "ThinVec<UseTreeAndId>": <R>(self: UseTreeAndId[], visitor: Visitor<R>, extra: undefined): R => {
    let r: R | undefined;
    for (const i of self) {
      if ((r = try_visit(visitor.Result, Visitable.UseTreeAndId(i, visitor, extra))) !== undefined) return r;
    }
    return visitor.Result.output();
  },
};

// This macro generates `impl Visitable` and `impl MutVisitable` that forward to `Walkable`
// or `MutWalkable`. By default, all types that do not have a custom visit method in the
// visitor should appear here.
const visitable_direct = {
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  AngleBracketedArg: <R>(self: AngleBracketedArg, visitor: Visitor<R>, _extra: undefined): R => Walkable.AngleBracketedArg(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  AngleBracketedArgs: <R>(self: AngleBracketedArgs, visitor: Visitor<R>, _extra: undefined): R => Walkable.AngleBracketedArgs(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  AsmMacro: <R>(self: AsmMacro, visitor: Visitor<R>, _extra: undefined): R => Walkable.AsmMacro(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  AssignOpKind: <R>(self: AssignOpKind, visitor: Visitor<R>, _extra: undefined): R => Walkable.AssignOpKind(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  AssocItemConstraintKind: <R>(self: AssocItemConstraintKind, visitor: Visitor<R>, _extra: undefined): R => Walkable.AssocItemConstraintKind(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  AttrArgs: <R>(self: AttrArgs, visitor: Visitor<R>, _extra: undefined): R => Walkable.AttrArgs(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  AttrItem: <R>(self: AttrItem, visitor: Visitor<R>, _extra: undefined): R => Walkable.AttrItem(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  AttrKind: <R>(self: AttrKind, visitor: Visitor<R>, _extra: undefined): R => Walkable.AttrKind(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  AttrStyle: <R>(self: AttrStyle, visitor: Visitor<R>, _extra: undefined): R => Walkable.AttrStyle(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  BinOpKind: <R>(self: BinOpKind, visitor: Visitor<R>, _extra: undefined): R => Walkable.BinOpKind(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  BindingMode: <R>(self: BindingMode, visitor: Visitor<R>, _extra: undefined): R => Walkable.BindingMode(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  BlockCheckMode: <R>(self: BlockCheckMode, visitor: Visitor<R>, _extra: undefined): R => Walkable.BlockCheckMode(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  BorrowKind: <R>(self: BorrowKind, visitor: Visitor<R>, _extra: undefined): R => Walkable.BorrowKind(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  BoundAsyncness: <R>(self: BoundAsyncness, visitor: Visitor<R>, _extra: undefined): R => Walkable.BoundAsyncness(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  BoundConstness: <R>(self: BoundConstness, visitor: Visitor<R>, _extra: undefined): R => Walkable.BoundConstness(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  BoundPolarity: <R>(self: BoundPolarity, visitor: Visitor<R>, _extra: undefined): R => Walkable.BoundPolarity(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  ByRef: <R>(self: ByRef, visitor: Visitor<R>, _extra: undefined): R => Walkable.ByRef(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  Closure: <R>(self: Closure, visitor: Visitor<R>, _extra: undefined): R => Walkable.Closure(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  Const: <R>(self: Const, visitor: Visitor<R>, _extra: undefined): R => Walkable.Const(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  ConstBlockItem: <R>(self: ConstBlockItem, visitor: Visitor<R>, _extra: undefined): R => Walkable.ConstBlockItem(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  ConstItem: <R>(self: ConstItem, visitor: Visitor<R>, _extra: undefined): R => Walkable.ConstItem(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  CoroutineKind: <R>(self: CoroutineKind, visitor: Visitor<R>, _extra: undefined): R => Walkable.CoroutineKind(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  Defaultness: <R>(self: Defaultness, visitor: Visitor<R>, _extra: undefined): R => Walkable.Defaultness(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  Delegation: <R>(self: Delegation, visitor: Visitor<R>, _extra: undefined): R => Walkable.Delegation(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  DelegationMac: <R>(self: DelegationMac, visitor: Visitor<R>, _extra: undefined): R => Walkable.DelegationMac(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  DelegationSuffixes: <R>(self: DelegationSuffixes, visitor: Visitor<R>, _extra: undefined): R => Walkable.DelegationSuffixes(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  DelimArgs: <R>(self: DelimArgs, visitor: Visitor<R>, _extra: undefined): R => Walkable.DelimArgs(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  DelimSpan: <R>(self: DelimSpan, visitor: Visitor<R>, _extra: undefined): R => Walkable.DelimSpan(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  EiiDecl: <R>(self: EiiDecl, visitor: Visitor<R>, _extra: undefined): R => Walkable.EiiDecl(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  EiiImpl: <R>(self: EiiImpl, visitor: Visitor<R>, _extra: undefined): R => Walkable.EiiImpl(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  EnumDef: <R>(self: EnumDef, visitor: Visitor<R>, _extra: undefined): R => Walkable.EnumDef(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  Extern: <R>(self: Extern, visitor: Visitor<R>, _extra: undefined): R => Walkable.Extern(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  FnPtrTy: <R>(self: FnPtrTy, visitor: Visitor<R>, _extra: undefined): R => Walkable.FnPtrTy(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  ForLoopKind: <R>(self: ForLoopKind, visitor: Visitor<R>, _extra: undefined): R => Walkable.ForLoopKind(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  FormatArgPosition: <R>(self: FormatArgPosition, visitor: Visitor<R>, _extra: undefined): R => Walkable.FormatArgPosition(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  FormatArgsPiece: <R>(self: FormatArgsPiece, visitor: Visitor<R>, _extra: undefined): R => Walkable.FormatArgsPiece(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  FormatArgument: <R>(self: FormatArgument, visitor: Visitor<R>, _extra: undefined): R => Walkable.FormatArgument(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  FormatArgumentKind: <R>(self: FormatArgumentKind, visitor: Visitor<R>, _extra: undefined): R => Walkable.FormatArgumentKind(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  FormatArguments: <R>(self: FormatArguments, visitor: Visitor<R>, _extra: undefined): R => Walkable.FormatArguments(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  FormatPlaceholder: <R>(self: FormatPlaceholder, visitor: Visitor<R>, _extra: undefined): R => Walkable.FormatPlaceholder(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  GenericParamKind: <R>(self: GenericParamKind, visitor: Visitor<R>, _extra: undefined): R => Walkable.GenericParamKind(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  Guard: <R>(self: Guard, visitor: Visitor<R>, _extra: undefined): R => Walkable.Guard(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  Impl: <R>(self: Impl, visitor: Visitor<R>, _extra: undefined): R => Walkable.Impl(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  ImplPolarity: <R>(self: ImplPolarity, visitor: Visitor<R>, _extra: undefined): R => Walkable.ImplPolarity(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  Inline: <R>(self: Inline, visitor: Visitor<R>, _extra: undefined): R => Walkable.Inline(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  InlineAsmOperand: <R>(self: InlineAsmOperand, visitor: Visitor<R>, _extra: undefined): R => Walkable.InlineAsmOperand(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  InlineAsmRegOrRegClass: <R>(self: InlineAsmRegOrRegClass, visitor: Visitor<R>, _extra: undefined): R => Walkable.InlineAsmRegOrRegClass(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  InlineAsmTemplatePiece: <R>(self: InlineAsmTemplatePiece, visitor: Visitor<R>, _extra: undefined): R => Walkable.InlineAsmTemplatePiece(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  IsAuto: <R>(self: IsAuto, visitor: Visitor<R>, _extra: undefined): R => Walkable.IsAuto(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  LocalKind: <R>(self: LocalKind, visitor: Visitor<R>, _extra: undefined): R => Walkable.LocalKind(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  MacCallStmt: <R>(self: MacCallStmt, visitor: Visitor<R>, _extra: undefined): R => Walkable.MacCallStmt(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  MacStmtStyle: <R>(self: MacStmtStyle, visitor: Visitor<R>, _extra: undefined): R => Walkable.MacStmtStyle(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  MatchKind: <R>(self: MatchKind, visitor: Visitor<R>, _extra: undefined): R => Walkable.MatchKind(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  MethodCall: <R>(self: MethodCall, visitor: Visitor<R>, _extra: undefined): R => Walkable.MethodCall(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  ModKind: <R>(self: ModKind, visitor: Visitor<R>, _extra: undefined): R => Walkable.ModKind(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  ModSpans: <R>(self: ModSpans, visitor: Visitor<R>, _extra: undefined): R => Walkable.ModSpans(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  NormalAttr: <R>(self: NormalAttr, visitor: Visitor<R>, _extra: undefined): R => Walkable.NormalAttr(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  Parens: <R>(self: Parens, visitor: Visitor<R>, _extra: undefined): R => Walkable.Parens(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  ParenthesizedArgs: <R>(self: ParenthesizedArgs, visitor: Visitor<R>, _extra: undefined): R => Walkable.ParenthesizedArgs(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  PatFieldsRest: <R>(self: PatFieldsRest, visitor: Visitor<R>, _extra: undefined): R => Walkable.PatFieldsRest(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  PatKind: <R>(self: PatKind, visitor: Visitor<R>, _extra: undefined): R => Walkable.PatKind(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  RangeEnd: <R>(self: RangeEnd, visitor: Visitor<R>, _extra: undefined): R => Walkable.RangeEnd(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  RangeLimits: <R>(self: RangeLimits, visitor: Visitor<R>, _extra: undefined): R => Walkable.RangeLimits(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  RangeSyntax: <R>(self: RangeSyntax, visitor: Visitor<R>, _extra: undefined): R => Walkable.RangeSyntax(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  Recovered: <R>(self: Recovered, visitor: Visitor<R>, _extra: undefined): R => Walkable.Recovered(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  RestrictionKind: <R>(self: RestrictionKind, visitor: Visitor<R>, _extra: undefined): R => Walkable.RestrictionKind(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  Safety: <R>(self: Safety, visitor: Visitor<R>, _extra: undefined): R => Walkable.Safety(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  StaticItem: <R>(self: StaticItem, visitor: Visitor<R>, _extra: undefined): R => Walkable.StaticItem(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  StrLit: <R>(self: StrLit, visitor: Visitor<R>, _extra: undefined): R => Walkable.StrLit(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  StrStyle: <R>(self: StrStyle, visitor: Visitor<R>, _extra: undefined): R => Walkable.StrStyle(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  StructExpr: <R>(self: StructExpr, visitor: Visitor<R>, _extra: undefined): R => Walkable.StructExpr(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  StructRest: <R>(self: StructRest, visitor: Visitor<R>, _extra: undefined): R => Walkable.StructRest(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  Term: <R>(self: Term, visitor: Visitor<R>, _extra: undefined): R => Walkable.Term(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  Trait: <R>(self: Trait, visitor: Visitor<R>, _extra: undefined): R => Walkable.Trait(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  TraitBoundModifiers: <R>(self: TraitBoundModifiers, visitor: Visitor<R>, _extra: undefined): R => Walkable.TraitBoundModifiers(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  TraitObjectSyntax: <R>(self: TraitObjectSyntax, visitor: Visitor<R>, _extra: undefined): R => Walkable.TraitObjectSyntax(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  TyAlias: <R>(self: TyAlias, visitor: Visitor<R>, _extra: undefined): R => Walkable.TyAlias(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  TyKind: <R>(self: TyKind, visitor: Visitor<R>, _extra: undefined): R => Walkable.TyKind(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  TyPatKind: <R>(self: TyPatKind, visitor: Visitor<R>, _extra: undefined): R => Walkable.TyPatKind(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  UnOp: <R>(self: UnOp, visitor: Visitor<R>, _extra: undefined): R => Walkable.UnOp(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  UnsafeBinderCastKind: <R>(self: UnsafeBinderCastKind, visitor: Visitor<R>, _extra: undefined): R => Walkable.UnsafeBinderCastKind(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  UnsafeBinderTy: <R>(self: UnsafeBinderTy, visitor: Visitor<R>, _extra: undefined): R => Walkable.UnsafeBinderTy(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  UnsafeSource: <R>(self: UnsafeSource, visitor: Visitor<R>, _extra: undefined): R => Walkable.UnsafeSource(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  UseTreeKind: <R>(self: UseTreeKind, visitor: Visitor<R>, _extra: undefined): R => Walkable.UseTreeKind(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  VisibilityKind: <R>(self: VisibilityKind, visitor: Visitor<R>, _extra: undefined): R => Walkable.VisibilityKind(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  WhereBoundPredicate: <R>(self: WhereBoundPredicate, visitor: Visitor<R>, _extra: undefined): R => Walkable.WhereBoundPredicate(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  WhereClause: <R>(self: WhereClause, visitor: Visitor<R>, _extra: undefined): R => Walkable.WhereClause(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  WhereEqPredicate: <R>(self: WhereEqPredicate, visitor: Visitor<R>, _extra: undefined): R => Walkable.WhereEqPredicate(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  WhereRegionPredicate: <R>(self: WhereRegionPredicate, visitor: Visitor<R>, _extra: undefined): R => Walkable.WhereRegionPredicate(self, visitor),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  YieldKind: <R>(self: YieldKind, visitor: Visitor<R>, _extra: undefined): R => Walkable.YieldKind(self, visitor),
};

// rustc-trait: compiler/rustc_ast/src/visit.rs:599 Visitor
/// Each method of this trait is a hook to be potentially
/// overridden. Each method's default implementation recursively visits
/// the substructure of the input via the corresponding `walk` method;
/// e.g., the `visit_item` method by default calls `visit::walk_item`.
///
/// If you want to ensure that your code handles every variant
/// explicitly, you need to override each method. (And you also need
/// to monitor future changes to this trait in case a new method with a
/// new default implementation gets introduced.)
///
/// Every `walk_*` method uses deconstruction to access fields of structs and
/// enums. This will result in a compile error if a field is added, which makes
/// it more likely the appropriate visit call will be added for it.
//
// PORT: trait with default methods -> a base class; implementors `extends Visitor<R>` and override.
// `R` is `Self::Result`; `()` is `undefined`.
export class Visitor<R = undefined> {
  /// The result type of the `visit_*` methods. Can be either `()`,
  /// or `ControlFlow<T>`.
  // PORT: `type Result: VisitorResult = ();` -> the impl object; the `()` default lives on the prototype.
  declare Result: VisitorResult<R, unknown>;

  // Methods in this trait have one of three forms, with the last two forms
  // only occurring on `MutVisitor`:
  //
  //   fn visit_t(&mut self, t: &mut T);                      // common
  //   fn flat_map_t(&mut self, t: T) -> SmallVec<[T; 1]>;    // rare
  //   fn filter_map_t(&mut self, t: T) -> Option<T>;         // rarest
  //
  // When writing these methods, it is better to use destructuring like this:
  //
  //   fn visit_abc(&mut self, ABC { a, b, c: _ }: &mut ABC) {
  //       visit_a(a);
  //       visit_b(b);
  //   }
  //
  // than to use field access like this:
  //
  //   fn visit_abc(&mut self, abc: &mut ABC) {
  //       visit_a(&mut abc.a);
  //       visit_b(&mut abc.b);
  //       // ignore abc.c
  //   }
  //
  // As well as being more concise, the former is explicit about which fields
  // are skipped. Furthermore, if a new field is added, the destructuring
  // version will cause a compile error, which is good. In comparison, the
  // field access version will continue working and it would be easy to
  // forget to add handling for it.
  // rustc: compiler/rustc_ast/src/visit.rs:634 visit_ident
  visit_ident(ident: Ident): R {
    const { name: _, span } = ident;
    let r: R | undefined;
    if ((r = try_visit(this.Result, Visitable.Span(span, this, undefined))) !== undefined) return r;
    return this.Result.output();
  }

  // rustc-macro: compiler/rustc_ast/src/visit.rs:284 fn_visit! (for_each_ast_visit_hook!)
  visit_anon_const(node: AnonConst): R {
    return Walkable.AnonConst(node, this);
  }
  visit_arm(node: Arm): R {
    return Walkable.Arm(node, this);
  }
  visit_assoc_item_constraint(node: AssocItemConstraint): R {
    return Walkable.AssocItemConstraint(node, this);
  }
  visit_attribute(node: Attribute): R {
    return Walkable.Attribute(node, this);
  }
  visit_block(node: Block): R {
    return Walkable.Block(node, this);
  }
  visit_capture_by(node: CaptureBy): R {
    return Walkable.CaptureBy(node, this);
  }
  visit_closure_binder(node: ClosureBinder): R {
    return Walkable.ClosureBinder(node, this);
  }
  visit_contract(node: FnContract): R {
    return Walkable.FnContract(node, this);
  }
  visit_coroutine_marker(node: CoroutineMarker): R {
    return Walkable.CoroutineMarker(node, this);
  }
  visit_crate(node: Crate): R {
    return Walkable.Crate(node, this);
  }
  visit_expr(node: Expr): R {
    return Walkable.Expr(node, this);
  }
  visit_expr_field(node: ExprField): R {
    return Walkable.ExprField(node, this);
  }
  visit_field_def(node: FieldDef): R {
    return Walkable.FieldDef(node, this);
  }
  visit_field_def_extras(node: FieldDefExtras): R {
    return Walkable.FieldDefExtras(node, this);
  }
  visit_fn_decl(node: FnDecl): R {
    return Walkable.FnDecl(node, this);
  }
  visit_fn_header(node: FnHeader): R {
    return Walkable.FnHeader(node, this);
  }
  visit_fn_ret_ty(node: FnRetTy): R {
    return Walkable.FnRetTy(node, this);
  }
  visit_foreign_mod(node: ForeignMod): R {
    return Walkable.ForeignMod(node, this);
  }
  visit_format_args(node: FormatArgs): R {
    return Walkable.FormatArgs(node, this);
  }
  visit_generic_arg(node: GenericArg): R {
    return Walkable.GenericArg(node, this);
  }
  visit_generic_args(node: GenericArgs): R {
    return Walkable.GenericArgs(node, this);
  }
  visit_generic_param(node: GenericParam): R {
    return Walkable.GenericParam(node, this);
  }
  visit_generics(node: Generics): R {
    return Walkable.Generics(node, this);
  }
  visit_impl_restriction(node: ImplRestriction): R {
    return Walkable.ImplRestriction(node, this);
  }
  visit_inline_asm(node: InlineAsm): R {
    return Walkable.InlineAsm(node, this);
  }
  visit_inline_asm_sym(node: InlineAsmSym): R {
    return Walkable.InlineAsmSym(node, this);
  }
  visit_label(node: Label): R {
    return Walkable.Label(node, this);
  }
  visit_lifetime(node: Lifetime, _ctxt: LifetimeCtxt): R {
    return Walkable.Lifetime(node, this);
  }
  visit_local(node: Local): R {
    return Walkable.Local(node, this);
  }
  visit_mac_call(node: MacCall): R {
    return Walkable.MacCall(node, this);
  }
  visit_macro_def(node: MacroDef): R {
    return Walkable.MacroDef(node, this);
  }
  visit_mut_restriction(node: MutRestriction): R {
    return Walkable.MutRestriction(node, this);
  }
  visit_param(node: Param): R {
    return Walkable.Param(node, this);
  }
  visit_param_bound(node: GenericBound, _ctxt: BoundKind): R {
    return Walkable.GenericBound(node, this);
  }
  visit_pat(node: Pat): R {
    return Walkable.Pat(node, this);
  }
  visit_pat_field(node: PatField): R {
    return Walkable.PatField(node, this);
  }
  visit_path(node: Path): R {
    return Walkable.Path(node, this);
  }
  visit_path_segment(node: PathSegment): R {
    return Walkable.PathSegment(node, this);
  }
  visit_poly_trait_ref(node: PolyTraitRef): R {
    return Walkable.PolyTraitRef(node, this);
  }
  visit_precise_capturing_arg(node: PreciseCapturingArg): R {
    return Walkable.PreciseCapturingArg(node, this);
  }
  visit_qself(node: QSelf): R {
    return Walkable.QSelf(node, this);
  }
  visit_test_binder_body(node: TestBinderBody): R {
    return Walkable.TestBinderBody(node, this);
  }
  visit_test_binder_bound_type_constraint(node: TestBinderBoundTypeConstraint): R {
    return Walkable.TestBinderBoundTypeConstraint(node, this);
  }
  visit_test_binder_constraint(node: TestBinderConstraint): R {
    return Walkable.TestBinderConstraint(node, this);
  }
  visit_test_binder_constraints(node: TestBinderConstraints): R {
    return Walkable.TestBinderConstraints(node, this);
  }
  visit_test_binder_exists(node: TestBinderExists): R {
    return Walkable.TestBinderExists(node, this);
  }
  visit_test_binder_forall(node: TestBinderForall): R {
    return Walkable.TestBinderForall(node, this);
  }
  visit_trait_ref(node: TraitRef): R {
    return Walkable.TraitRef(node, this);
  }
  visit_ty(node: Ty): R {
    return Walkable.Ty(node, this);
  }
  visit_ty_pat(node: TyPat): R {
    return Walkable.TyPat(node, this);
  }
  visit_use_tree(node: UseTree): R {
    return Walkable.UseTree(node, this);
  }
  visit_use_tree_and_id(node: UseTreeAndId): R {
    return Walkable.UseTreeAndId(node, this);
  }
  visit_variant(node: Variant): R {
    return Walkable.Variant(node, this);
  }
  visit_variant_data(node: VariantData): R {
    return Walkable.VariantData(node, this);
  }
  visit_vis(node: Visibility): R {
    return Walkable.Visibility(node, this);
  }
  visit_where_predicate(node: WherePredicate): R {
    return Walkable.WherePredicate(node, this);
  }
  visit_where_predicate_kind(node: WherePredicateKind): R {
    return Walkable.WherePredicateKind(node, this);
  }

  // We want `Visitor` to take the `NodeId` by value.
  // rustc: compiler/rustc_ast/src/visit.rs:644 visit_id
  visit_id(_id: NodeId): R {
    return this.Result.output();
  }

  /// This method is a hack to workaround unstable of `stmt_expr_attributes`.
  /// It can be removed once that feature is stabilized.
  // rustc: compiler/rustc_ast/src/visit.rs:650 visit_method_receiver_expr
  visit_method_receiver_expr(ex: Expr): R {
    return this.visit_expr(ex);
  }

  // rustc: compiler/rustc_ast/src/visit.rs:654 visit_item
  visit_item(item: Item): R {
    return walk_item(this, item, WalkItemKind.ItemKind);
  }

  // rustc: compiler/rustc_ast/src/visit.rs:658 visit_foreign_item
  visit_foreign_item(item: ForeignItem): R {
    return walk_item(this, item, WalkItemKind.ForeignItemKind);
  }

  // rustc: compiler/rustc_ast/src/visit.rs:662 visit_assoc_item
  visit_assoc_item(item: AssocItem, ctxt: AssocCtxt): R {
    return walk_assoc_item(this, item, ctxt, WalkItemKind.AssocItemKind);
  }

  // for `MutVisitor`: `Span` and `NodeId` are mutated at the caller site.
  // rustc: compiler/rustc_ast/src/visit.rs:669 visit_fn
  visit_fn(fk: FnKind, _attrs: AttrVec, _span: Span, _id: NodeId): R {
    return walk_fn(this, fk);
  }

  // (non-mut) `Visitor`-only methods
  // rustc: compiler/rustc_ast/src/visit.rs:681 visit_stmt
  visit_stmt(s: Stmt): R {
    return walk_stmt(this, s);
  }
}
// PORT: `type Result: VisitorResult = ()` default.
(Visitor.prototype as Visitor<undefined>).Result = VisitorResult.unit;

const visitable_visit = {
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  AnonConst: <R>(self: AnonConst, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_anon_const(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  Arm: <R>(self: Arm, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_arm(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  AssocItemConstraint: <R>(self: AssocItemConstraint, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_assoc_item_constraint(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  Attribute: <R>(self: Attribute, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_attribute(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  Block: <R>(self: Block, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_block(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  CaptureBy: <R>(self: CaptureBy, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_capture_by(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  ClosureBinder: <R>(self: ClosureBinder, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_closure_binder(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  FnContract: <R>(self: FnContract, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_contract(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  CoroutineMarker: <R>(self: CoroutineMarker, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_coroutine_marker(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  Crate: <R>(self: Crate, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_crate(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  Expr: <R>(self: Expr, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_expr(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  ExprField: <R>(self: ExprField, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_expr_field(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  FieldDef: <R>(self: FieldDef, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_field_def(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  FieldDefExtras: <R>(self: FieldDefExtras, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_field_def_extras(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  FnDecl: <R>(self: FnDecl, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_fn_decl(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  FnHeader: <R>(self: FnHeader, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_fn_header(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  FnRetTy: <R>(self: FnRetTy, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_fn_ret_ty(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  ForeignMod: <R>(self: ForeignMod, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_foreign_mod(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  FormatArgs: <R>(self: FormatArgs, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_format_args(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  GenericArg: <R>(self: GenericArg, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_generic_arg(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  GenericArgs: <R>(self: GenericArgs, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_generic_args(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  GenericParam: <R>(self: GenericParam, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_generic_param(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  Generics: <R>(self: Generics, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_generics(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  ImplRestriction: <R>(self: ImplRestriction, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_impl_restriction(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  InlineAsm: <R>(self: InlineAsm, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_inline_asm(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  InlineAsmSym: <R>(self: InlineAsmSym, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_inline_asm_sym(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  Label: <R>(self: Label, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_label(self),
  // rustc: compiler/rustc_ast/src/visit.rs:225 visit
  Lifetime: <R>(self: Lifetime, visitor: Visitor<R>, _ctxt: LifetimeCtxt): R => visitor.visit_lifetime(self, _ctxt),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  Local: <R>(self: Local, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_local(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  MacCall: <R>(self: MacCall, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_mac_call(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  MacroDef: <R>(self: MacroDef, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_macro_def(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  MutRestriction: <R>(self: MutRestriction, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_mut_restriction(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  Param: <R>(self: Param, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_param(self),
  // rustc: compiler/rustc_ast/src/visit.rs:225 visit
  GenericBound: <R>(self: GenericBound, visitor: Visitor<R>, _ctxt: BoundKind): R => visitor.visit_param_bound(self, _ctxt),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  Pat: <R>(self: Pat, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_pat(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  PatField: <R>(self: PatField, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_pat_field(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  Path: <R>(self: Path, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_path(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  PathSegment: <R>(self: PathSegment, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_path_segment(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  PolyTraitRef: <R>(self: PolyTraitRef, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_poly_trait_ref(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  PreciseCapturingArg: <R>(self: PreciseCapturingArg, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_precise_capturing_arg(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  QSelf: <R>(self: QSelf, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_qself(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  TestBinderBody: <R>(self: TestBinderBody, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_test_binder_body(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  TestBinderBoundTypeConstraint: <R>(self: TestBinderBoundTypeConstraint, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_test_binder_bound_type_constraint(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  TestBinderConstraint: <R>(self: TestBinderConstraint, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_test_binder_constraint(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  TestBinderConstraints: <R>(self: TestBinderConstraints, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_test_binder_constraints(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  TestBinderExists: <R>(self: TestBinderExists, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_test_binder_exists(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  TestBinderForall: <R>(self: TestBinderForall, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_test_binder_forall(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  TraitRef: <R>(self: TraitRef, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_trait_ref(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  Ty: <R>(self: Ty, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_ty(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  TyPat: <R>(self: TyPat, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_ty_pat(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  UseTree: <R>(self: UseTree, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_use_tree(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  UseTreeAndId: <R>(self: UseTreeAndId, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_use_tree_and_id(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  Variant: <R>(self: Variant, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_variant(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  VariantData: <R>(self: VariantData, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_variant_data(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  Visibility: <R>(self: Visibility, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_vis(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  WherePredicate: <R>(self: WherePredicate, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_where_predicate(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  WherePredicateKind: <R>(self: WherePredicateKind, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_where_predicate_kind(self),
};

const visitable_misc = {
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  Ident: <R>(self: Ident, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_ident(self),

  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  NodeId: <R>(self: NodeId, visitor: Visitor<R>, _extra: undefined): R => visitor.visit_id(self),

  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  Item: <R>(self: Item, vis: Visitor<R>, _extra: undefined): R => vis.visit_item(self),
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  ForeignItem: <R>(self: ForeignItem, vis: Visitor<R>, _extra: undefined): R => vis.visit_foreign_item(self),
  // rustc: compiler/rustc_ast/src/visit.rs:225 visit
  AssocItem: <R>(self: AssocItem, vis: Visitor<R>, ctxt: AssocCtxt): R => vis.visit_assoc_item(self, ctxt),
};

// rustc-trait: compiler/rustc_ast/src/visit.rs:795 WalkItemKind
// PORT: `trait WalkItemKind { type Ctxt; fn walk(..) }` -> an impl object per item-kind type (`Ctxt` is
// the second type parameter); generic fns over `K: WalkItemKind` take the impl as their last argument.
export interface WalkItemKind<K, Ctxt> {
  // rustc: compiler/rustc_ast/src/visit.rs:797 walk
  walk<R>(self: K, attrs: AttrVec, span: Span, id: NodeId, visibility: Visibility, ctxt: Ctxt, vis: Visitor<R>): R;
}

// rustc: compiler/rustc_ast/src/visit.rs:808 walk_item_inner
function walk_item_inner<K, Ctxt, R>(visitor: Visitor<R>, item: Item<K>, ctxt: Ctxt, K_: WalkItemKind<K, Ctxt>): R {
  const { attrs, id, kind, vis, span, tokens: _ } = item;
  let r: R | undefined;
  if ((r = try_visit(visitor.Result, Visitable.NodeId(id, visitor, undefined))) !== undefined) return r;
  if ((r = try_visit(visitor.Result, Visitable["ThinVec<Attribute>"](attrs, visitor, undefined))) !== undefined) return r;
  if ((r = try_visit(visitor.Result, Visitable.Visibility(vis, visitor, undefined))) !== undefined) return r;
  if ((r = try_visit(visitor.Result, K_.walk(kind, attrs, span, id, vis, ctxt, visitor))) !== undefined) return r;
  if ((r = try_visit(visitor.Result, Visitable.Span(span, visitor, undefined))) !== undefined) return r;
  return visitor.Result.output();
}

// Do not implement `Walkable`/`MutWalkable` for *Item to avoid confusion.
// rustc: compiler/rustc_ast/src/visit.rs:821 walk_item
export function walk_item<K, R>(visitor: Visitor<R>, item: Item<K>, K_: WalkItemKind<K, undefined>): R {
  return walk_item_inner(visitor, item, undefined, K_);
}

// Do not implement `Walkable`/`MutWalkable` for *Item to avoid confusion.
// rustc: compiler/rustc_ast/src/visit.rs:829 walk_assoc_item
export function walk_assoc_item<K, R>(visitor: Visitor<R>, item: Item<K>, ctxt: AssocCtxt, K_: WalkItemKind<K, AssocCtxt>): R {
  return walk_item_inner(visitor, item, ctxt, K_);
}

/** The `WalkItemKind` impls, by implementing type. */
export const WalkItemKind = {
  ItemKind: {
    // rustc: compiler/rustc_ast/src/visit.rs:839 walk
    walk<R>(self: ItemKind, attrs: AttrVec, span: Span, id: NodeId, visibility: Visibility, _ctxt: undefined, vis: Visitor<R>): R {
      let r: R | undefined;
      switch (self.$) {
        case "Fn": {
          const func = self._0;
          const kind: FnKind = { $: "Fn", _0: FnCtxt.Free, _1: visibility, _2: func };
          if ((r = try_visit(vis.Result, vis.visit_fn(kind, attrs, span, id))) !== undefined) return r;
          break;
        }
        case "ExternCrate": {
          const orig_name = self._0, ident = self._1;
          if ((r = try_visit(vis.Result, Visitable.Option(orig_name, vis, undefined, Visitable.Symbol))) !== undefined) return r;
          if ((r = try_visit(vis.Result, Visitable.Ident(ident, vis, undefined))) !== undefined) return r;
          break;
        }
        case "Use": {
          const use_tree = self._0;
          if ((r = try_visit(vis.Result, Visitable.UseTree(use_tree, vis, undefined))) !== undefined) return r;
          break;
        }
        case "Static": {
          const item = self._0;
          if ((r = try_visit(vis.Result, Visitable.StaticItem(item, vis, undefined))) !== undefined) return r;
          break;
        }
        case "ConstBlock": {
          const item = self._0;
          if ((r = try_visit(vis.Result, Visitable.ConstBlockItem(item, vis, undefined))) !== undefined) return r;
          break;
        }
        case "Const": {
          const item = self._0;
          if ((r = try_visit(vis.Result, Visitable.ConstItem(item, vis, undefined))) !== undefined) return r;
          break;
        }
        case "Mod": {
          const safety = self._0, ident = self._1, mod_kind = self._2;
          if ((r = try_visit(vis.Result, Visitable.Safety(safety, vis, undefined))) !== undefined) return r;
          if ((r = try_visit(vis.Result, Visitable.Ident(ident, vis, undefined))) !== undefined) return r;
          if ((r = try_visit(vis.Result, Visitable.ModKind(mod_kind, vis, undefined))) !== undefined) return r;
          break;
        }
        case "ForeignMod": {
          const nm = self._0;
          if ((r = try_visit(vis.Result, Visitable.ForeignMod(nm, vis, undefined))) !== undefined) return r;
          break;
        }
        case "GlobalAsm": {
          const asm = self._0;
          if ((r = try_visit(vis.Result, Visitable.InlineAsm(asm, vis, undefined))) !== undefined) return r;
          break;
        }
        case "TyAlias": {
          const ty_alias = self._0;
          if ((r = try_visit(vis.Result, Visitable.TyAlias(ty_alias, vis, undefined))) !== undefined) return r;
          break;
        }
        case "Enum": {
          const ident = self._0, generics = self._1, enum_definition = self._2;
          if ((r = try_visit(vis.Result, Visitable.Ident(ident, vis, undefined))) !== undefined) return r;
          if ((r = try_visit(vis.Result, Visitable.Generics(generics, vis, undefined))) !== undefined) return r;
          if ((r = try_visit(vis.Result, Visitable.EnumDef(enum_definition, vis, undefined))) !== undefined) return r;
          break;
        }
        case "Struct":
        case "Union": {
          const ident = self._0, generics = self._1, variant_data = self._2;
          if ((r = try_visit(vis.Result, Visitable.Ident(ident, vis, undefined))) !== undefined) return r;
          if ((r = try_visit(vis.Result, Visitable.Generics(generics, vis, undefined))) !== undefined) return r;
          if ((r = try_visit(vis.Result, Visitable.VariantData(variant_data, vis, undefined))) !== undefined) return r;
          break;
        }
        case "Impl": {
          const impl_ = self._0;
          if ((r = try_visit(vis.Result, Visitable.Impl(impl_, vis, undefined))) !== undefined) return r;
          break;
        }
        case "Trait": {
          const trait_ = self._0;
          if ((r = try_visit(vis.Result, Visitable.Trait(trait_, vis, undefined))) !== undefined) return r;
          break;
        }
        case "TraitAlias": {
          const { constness, ident, generics, bounds } = self._0;
          if ((r = try_visit(vis.Result, Visitable.Const(constness, vis, undefined))) !== undefined) return r;
          if ((r = try_visit(vis.Result, Visitable.Ident(ident, vis, undefined))) !== undefined) return r;
          if ((r = try_visit(vis.Result, Visitable.Generics(generics, vis, undefined))) !== undefined) return r;
          if ((r = try_visit(vis.Result, Visitable["ThinVec<GenericBound>"](bounds, vis, BoundKind.Bound))) !== undefined) return r;
          break;
        }
        case "MacCall": {
          const m = self._0;
          if ((r = try_visit(vis.Result, Visitable.MacCall(m, vis, undefined))) !== undefined) return r;
          break;
        }
        case "MacroDef": {
          const ident = self._0, def = self._1;
          if ((r = try_visit(vis.Result, Visitable.Ident(ident, vis, undefined))) !== undefined) return r;
          if ((r = try_visit(vis.Result, Visitable.MacroDef(def, vis, undefined))) !== undefined) return r;
          break;
        }
        case "Delegation": {
          const delegation = self._0;
          if ((r = try_visit(vis.Result, Visitable.Delegation(delegation, vis, undefined))) !== undefined) return r;
          break;
        }
        case "DelegationMac": {
          const dm = self._0;
          if ((r = try_visit(vis.Result, Visitable.DelegationMac(dm, vis, undefined))) !== undefined) return r;
          break;
        }
        case "TestBinderConstraints": {
          const item = self._0;
          if ((r = try_visit(vis.Result, Visitable.TestBinderConstraints(item, vis, undefined))) !== undefined) return r;
          break;
        }
      }
      return vis.Result.output();
    },
  } satisfies WalkItemKind<ItemKind, undefined>,

  AssocItemKind: {
    // rustc: compiler/rustc_ast/src/visit.rs:901 walk
    walk<R>(self: AssocItemKind, attrs: AttrVec, span: Span, id: NodeId, visibility: Visibility, ctxt: AssocCtxt, vis: Visitor<R>): R {
      let r: R | undefined;
      switch (self.$) {
        case "Const": {
          const item = self._0;
          if ((r = try_visit(vis.Result, Visitable.ConstItem(item, vis, undefined))) !== undefined) return r;
          break;
        }
        case "Fn": {
          const func = self._0;
          const kind: FnKind = { $: "Fn", _0: { $: "Assoc", _0: ctxt }, _1: visibility, _2: func };
          if ((r = try_visit(vis.Result, vis.visit_fn(kind, attrs, span, id))) !== undefined) return r;
          break;
        }
        case "Type": {
          const alias = self._0;
          if ((r = try_visit(vis.Result, Visitable.TyAlias(alias, vis, undefined))) !== undefined) return r;
          break;
        }
        case "MacCall": {
          const mac = self._0;
          if ((r = try_visit(vis.Result, Visitable.MacCall(mac, vis, undefined))) !== undefined) return r;
          break;
        }
        case "Delegation": {
          const delegation = self._0;
          if ((r = try_visit(vis.Result, Visitable.Delegation(delegation, vis, undefined))) !== undefined) return r;
          break;
        }
        case "DelegationMac": {
          const dm = self._0;
          if ((r = try_visit(vis.Result, Visitable.DelegationMac(dm, vis, undefined))) !== undefined) return r;
          break;
        }
      }
      return vis.Result.output();
    },
  } satisfies WalkItemKind<AssocItemKind, AssocCtxt>,

  ForeignItemKind: {
    // rustc: compiler/rustc_ast/src/visit.rs:932 walk
    walk<R>(self: ForeignItemKind, attrs: AttrVec, span: Span, id: NodeId, visibility: Visibility, _ctxt: undefined, vis: Visitor<R>): R {
      let r: R | undefined;
      switch (self.$) {
        case "Static": {
          const item = self._0;
          if ((r = try_visit(vis.Result, Visitable.StaticItem(item, vis, undefined))) !== undefined) return r;
          break;
        }
        case "Fn": {
          const func = self._0;
          const kind: FnKind = { $: "Fn", _0: FnCtxt.Foreign, _1: visibility, _2: func };
          if ((r = try_visit(vis.Result, vis.visit_fn(kind, attrs, span, id))) !== undefined) return r;
          break;
        }
        case "TyAlias": {
          const alias = self._0;
          if ((r = try_visit(vis.Result, Visitable.TyAlias(alias, vis, undefined))) !== undefined) return r;
          break;
        }
        case "MacCall": {
          const mac = self._0;
          if ((r = try_visit(vis.Result, Visitable.MacCall(mac, vis, undefined))) !== undefined) return r;
          break;
        }
      }
      return vis.Result.output();
    },
  } satisfies WalkItemKind<ForeignItemKind, undefined>,
};

// rustc: compiler/rustc_ast/src/visit.rs:957 walk_fn
export function walk_fn<R>(vis: Visitor<R>, kind: FnKind): R {
  let r: R | undefined;
  switch (kind.$) {
    case "Fn": {
      // Visibility is visited as a part of the item.
      const { defaultness, ident, sig, generics, contract, body, define_opaque, eii_impl } = kind._2;
      const { header, decl, span } = sig;
      if ((r = try_visit(vis.Result, Visitable.Defaultness(defaultness, vis, undefined))) !== undefined) return r;
      if ((r = try_visit(vis.Result, Visitable.Ident(ident, vis, undefined))) !== undefined) return r;
      if ((r = try_visit(vis.Result, Visitable.FnHeader(header, vis, undefined))) !== undefined) return r;
      if ((r = try_visit(vis.Result, Visitable.Generics(generics, vis, undefined))) !== undefined) return r;
      if ((r = try_visit(vis.Result, Visitable.FnDecl(decl, vis, undefined))) !== undefined) return r;
      if ((r = try_visit(vis.Result, Visitable.Option(contract, vis, undefined, Visitable.FnContract))) !== undefined) return r;
      if ((r = try_visit(vis.Result, Visitable.Option(body, vis, undefined, Visitable.Block))) !== undefined) return r;
      if ((r = try_visit(vis.Result, Visitable.Span(span, vis, undefined))) !== undefined) return r;
      if ((r = try_visit(vis.Result, Visitable.Option(define_opaque, vis, undefined, Visitable["ThinVec<(NodeId, Path)>"]))) !== undefined) return r;
      if ((r = try_visit(vis.Result, Visitable.Option(eii_impl, vis, undefined, Visitable.EiiImpl))) !== undefined) return r;
      break;
    }
    case "Closure": {
      const binder = kind._0, coroutine_marker = kind._1, decl = kind._2, body = kind._3;
      if ((r = try_visit(vis.Result, Visitable.ClosureBinder(binder, vis, undefined))) !== undefined) return r;
      if ((r = try_visit(vis.Result, Visitable.Option(coroutine_marker, vis, undefined, Visitable.CoroutineMarker))) !== undefined) return r;
      if ((r = try_visit(vis.Result, Visitable.FnDecl(decl, vis, undefined))) !== undefined) return r;
      if ((r = try_visit(vis.Result, Visitable.Expr(body, vis, undefined))) !== undefined) return r;
      break;
    }
  }
  return vis.Result.output();
}

const walkable_hand = {
  // rustc: compiler/rustc_ast/src/visit.rs:236 walk_ref
  Impl: <R>(self: Impl, vis: Visitor<R>): R => {
    const { generics, of_trait, self_ty, items, constness: _ } = self;
    let r: R | undefined;
    if ((r = try_visit(vis.Result, vis.visit_generics(generics))) !== undefined) return r;
    if (of_trait !== undefined) {
      const { defaultness, safety, polarity, trait_ref } = of_trait;
      if ((r = try_visit(vis.Result, Visitable.Defaultness(defaultness, vis, undefined))) !== undefined) return r;
      if ((r = try_visit(vis.Result, Visitable.Safety(safety, vis, undefined))) !== undefined) return r;
      if ((r = try_visit(vis.Result, Visitable.ImplPolarity(polarity, vis, undefined))) !== undefined) return r;
      if ((r = try_visit(vis.Result, Visitable.TraitRef(trait_ref, vis, undefined))) !== undefined) return r;
    }
    if ((r = try_visit(vis.Result, vis.visit_ty(self_ty))) !== undefined) return r;
    const ctxt: AssocCtxt = { $: "Impl", of_trait: of_trait !== undefined };
    if ((r = try_visit(vis.Result, Visitable["ThinVec<Box<AssocItem>>"](items, vis, ctxt))) !== undefined) return r;
    return vis.Result.output();
  },

  // Special case to call `visit_method_receiver_expr`.
  // rustc: compiler/rustc_ast/src/visit.rs:236 walk_ref
  MethodCall: <R>(self: MethodCall, vis: Visitor<R>): R => {
    const { seg, receiver, args, span } = self;
    let r: R | undefined;
    if ((r = try_visit(vis.Result, vis.visit_method_receiver_expr(receiver))) !== undefined) return r;
    if ((r = try_visit(vis.Result, Visitable.PathSegment(seg, vis, undefined))) !== undefined) return r;
    if ((r = try_visit(vis.Result, Visitable["ThinVec<Box<Expr>>"](args, vis, undefined))) !== undefined) return r;
    if ((r = try_visit(vis.Result, Visitable.Span(span, vis, undefined))) !== undefined) return r;
    return vis.Result.output();
  },

  // rustc: compiler/rustc_ast/src/visit.rs:236 walk_ref
  Expr: <R>(self: Expr, vis: Visitor<R>): R => {
    const { id, kind, span, attrs, tokens: _ } = self;
    let r: R | undefined;
    if ((r = try_visit(vis.Result, Visitable.NodeId(id, vis, undefined))) !== undefined) return r;
    if ((r = try_visit(vis.Result, Visitable["ThinVec<Attribute>"](attrs, vis, undefined))) !== undefined) return r;
    switch (kind.$) {
      case "Array": {
        const exprs = kind._0;
        if ((r = try_visit(vis.Result, Visitable["ThinVec<Box<Expr>>"](exprs, vis, undefined))) !== undefined) return r;
        break;
      }
      case "ConstBlock": {
        const anon_const = kind._0;
        if ((r = try_visit(vis.Result, Visitable.AnonConst(anon_const, vis, undefined))) !== undefined) return r;
        break;
      }
      case "Repeat": {
        const element = kind._0, count = kind._1;
        if ((r = try_visit(vis.Result, Visitable.Expr(element, vis, undefined))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.AnonConst(count, vis, undefined))) !== undefined) return r;
        break;
      }
      case "Struct": {
        const se = kind._0;
        if ((r = try_visit(vis.Result, Visitable.StructExpr(se, vis, undefined))) !== undefined) return r;
        break;
      }
      case "Tup": {
        const exprs = kind._0;
        if ((r = try_visit(vis.Result, Visitable["ThinVec<Box<Expr>>"](exprs, vis, undefined))) !== undefined) return r;
        break;
      }
      case "Call": {
        const callee_expression = kind._0, arguments_ = kind._1;
        if ((r = try_visit(vis.Result, Visitable.Expr(callee_expression, vis, undefined))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable["ThinVec<Box<Expr>>"](arguments_, vis, undefined))) !== undefined) return r;
        break;
      }
      case "MethodCall": {
        const mc = kind._0;
        if ((r = try_visit(vis.Result, Visitable.MethodCall(mc, vis, undefined))) !== undefined) return r;
        break;
      }
      case "Binary": {
        const op = kind._0, lhs = kind._1, rhs = kind._2;
        if ((r = try_visit(vis.Result, Visitable.Spanned(op, vis, undefined, Visitable.BinOpKind))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.Expr(lhs, vis, undefined))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.Expr(rhs, vis, undefined))) !== undefined) return r;
        break;
      }
      case "AddrOf": {
        const kind_ = kind._0, mutbl = kind._1, subexpression = kind._2;
        if ((r = try_visit(vis.Result, Visitable.BorrowKind(kind_, vis, undefined))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.Mutability(mutbl, vis, undefined))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.Expr(subexpression, vis, undefined))) !== undefined) return r;
        break;
      }
      case "Unary": {
        const op = kind._0, subexpression = kind._1;
        if ((r = try_visit(vis.Result, Visitable.UnOp(op, vis, undefined))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.Expr(subexpression, vis, undefined))) !== undefined) return r;
        break;
      }
      case "Cast":
      case "Type": {
        const subexpression = kind._0, typ = kind._1;
        if ((r = try_visit(vis.Result, Visitable.Expr(subexpression, vis, undefined))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.Ty(typ, vis, undefined))) !== undefined) return r;
        break;
      }
      case "Let": {
        const pat = kind._0, expr = kind._1, span = kind._2;
        if ((r = try_visit(vis.Result, Visitable.Pat(pat, vis, undefined))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.Expr(expr, vis, undefined))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.Span(span, vis, undefined))) !== undefined) return r;
        break;
      }
      case "If": {
        const head_expression = kind._0, if_block = kind._1, optional_else = kind._2;
        if ((r = try_visit(vis.Result, Visitable.Expr(head_expression, vis, undefined))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.Block(if_block, vis, undefined))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.Option(optional_else, vis, undefined, Visitable.Expr))) !== undefined) return r;
        break;
      }
      case "While": {
        const subexpression = kind._0, block = kind._1, opt_label = kind._2;
        if ((r = try_visit(vis.Result, Visitable.Expr(subexpression, vis, undefined))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.Block(block, vis, undefined))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.Option(opt_label, vis, undefined, Visitable.Label))) !== undefined) return r;
        break;
      }
      case "ForLoop": {
        const { pat, iter, body, label, kind: kind_ } = kind._0;
        if ((r = try_visit(vis.Result, Visitable.Pat(pat, vis, undefined))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.Expr(iter, vis, undefined))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.Block(body, vis, undefined))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.Option(label, vis, undefined, Visitable.Label))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.ForLoopKind(kind_, vis, undefined))) !== undefined) return r;
        break;
      }
      case "Loop": {
        const block = kind._0, opt_label = kind._1, span = kind._2;
        if ((r = try_visit(vis.Result, Visitable.Block(block, vis, undefined))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.Option(opt_label, vis, undefined, Visitable.Label))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.Span(span, vis, undefined))) !== undefined) return r;
        break;
      }
      case "Match": {
        const subexpression = kind._0, arms = kind._1, kind_ = kind._2;
        if ((r = try_visit(vis.Result, Visitable.Expr(subexpression, vis, undefined))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable["ThinVec<Arm>"](arms, vis, undefined))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.MatchKind(kind_, vis, undefined))) !== undefined) return r;
        break;
      }
      case "Closure": {
        const { binder, capture_clause, coroutine_marker, constness, movability, fn_decl, body, fn_decl_span, fn_arg_span } = kind._0;
        if ((r = try_visit(vis.Result, Visitable.Const(constness, vis, undefined))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.Movability(movability, vis, undefined))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.CaptureBy(capture_clause, vis, undefined))) !== undefined) return r;
        const kind_: FnKind = { $: "Closure", _0: binder, _1: coroutine_marker, _2: fn_decl, _3: body };
        if ((r = try_visit(vis.Result, vis.visit_fn(kind_, attrs, span, id))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.Span(fn_decl_span, vis, undefined))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.Span(fn_arg_span, vis, undefined))) !== undefined) return r;
        break;
      }
      case "Block": {
        const block = kind._0, opt_label = kind._1;
        if ((r = try_visit(vis.Result, Visitable.Block(block, vis, undefined))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.Option(opt_label, vis, undefined, Visitable.Label))) !== undefined) return r;
        break;
      }
      case "Gen": {
        const capt = kind._0, body = kind._1, kind_ = kind._2, decl_span = kind._3;
        if ((r = try_visit(vis.Result, Visitable.CaptureBy(capt, vis, undefined))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.Block(body, vis, undefined))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.CoroutineKind(kind_, vis, undefined))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.Span(decl_span, vis, undefined))) !== undefined) return r;
        break;
      }
      case "Await":
      case "Move":
      case "Use": {
        const expr = kind._0, span = kind._1;
        if ((r = try_visit(vis.Result, Visitable.Expr(expr, vis, undefined))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.Span(span, vis, undefined))) !== undefined) return r;
        break;
      }
      case "Assign": {
        const lhs = kind._0, rhs = kind._1, span = kind._2;
        if ((r = try_visit(vis.Result, Visitable.Expr(lhs, vis, undefined))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.Expr(rhs, vis, undefined))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.Span(span, vis, undefined))) !== undefined) return r;
        break;
      }
      case "AssignOp": {
        const op = kind._0, lhs = kind._1, rhs = kind._2;
        if ((r = try_visit(vis.Result, Visitable.Spanned(op, vis, undefined, Visitable.AssignOpKind))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.Expr(lhs, vis, undefined))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.Expr(rhs, vis, undefined))) !== undefined) return r;
        break;
      }
      case "Field": {
        const subexpression = kind._0, ident = kind._1;
        if ((r = try_visit(vis.Result, Visitable.Expr(subexpression, vis, undefined))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.Ident(ident, vis, undefined))) !== undefined) return r;
        break;
      }
      case "Index": {
        const main_expression = kind._0, index_expression = kind._1, span = kind._2;
        if ((r = try_visit(vis.Result, Visitable.Expr(main_expression, vis, undefined))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.Expr(index_expression, vis, undefined))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.Span(span, vis, undefined))) !== undefined) return r;
        break;
      }
      case "Range": {
        const start = kind._0, end = kind._1, limit = kind._2;
        if ((r = try_visit(vis.Result, Visitable.Option(start, vis, undefined, Visitable.Expr))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.Option(end, vis, undefined, Visitable.Expr))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.RangeLimits(limit, vis, undefined))) !== undefined) return r;
        break;
      }
      case "Underscore":
        break;
      case "Path": {
        const maybe_qself = kind._0, path = kind._1;
        if ((r = try_visit(vis.Result, Visitable.Option(maybe_qself, vis, undefined, Visitable.QSelf))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.Path(path, vis, undefined))) !== undefined) return r;
        break;
      }
      case "Break": {
        const opt_label = kind._0, opt_expr = kind._1;
        if ((r = try_visit(vis.Result, Visitable.Option(opt_label, vis, undefined, Visitable.Label))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.Option(opt_expr, vis, undefined, Visitable.Expr))) !== undefined) return r;
        break;
      }
      case "Continue": {
        const opt_label = kind._0;
        if ((r = try_visit(vis.Result, Visitable.Option(opt_label, vis, undefined, Visitable.Label))) !== undefined) return r;
        break;
      }
      case "Ret":
      case "Yeet": {
        const optional_expression = kind._0;
        if ((r = try_visit(vis.Result, Visitable.Option(optional_expression, vis, undefined, Visitable.Expr))) !== undefined) return r;
        break;
      }
      case "Become": {
        const expr = kind._0;
        if ((r = try_visit(vis.Result, Visitable.Expr(expr, vis, undefined))) !== undefined) return r;
        break;
      }
      case "MacCall": {
        const mac = kind._0;
        if ((r = try_visit(vis.Result, Visitable.MacCall(mac, vis, undefined))) !== undefined) return r;
        break;
      }
      case "Paren": {
        const subexpression = kind._0;
        if ((r = try_visit(vis.Result, Visitable.Expr(subexpression, vis, undefined))) !== undefined) return r;
        break;
      }
      case "InlineAsm": {
        const asm = kind._0;
        if ((r = try_visit(vis.Result, Visitable.InlineAsm(asm, vis, undefined))) !== undefined) return r;
        break;
      }
      case "FormatArgs": {
        const f = kind._0;
        if ((r = try_visit(vis.Result, Visitable.FormatArgs(f, vis, undefined))) !== undefined) return r;
        break;
      }
      case "OffsetOf": {
        const container = kind._0, fields = kind._1;
        if ((r = try_visit(vis.Result, Visitable.Ty(container, vis, undefined))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable["ThinVec<Ident>"](fields, vis, undefined))) !== undefined) return r;
        break;
      }
      case "Yield": {
        const kind_ = kind._0;
        if ((r = try_visit(vis.Result, Visitable.YieldKind(kind_, vis, undefined))) !== undefined) return r;
        break;
      }
      case "Try": {
        const subexpression = kind._0;
        if ((r = try_visit(vis.Result, Visitable.Expr(subexpression, vis, undefined))) !== undefined) return r;
        break;
      }
      case "TryBlock": {
        const body = kind._0, optional_type = kind._1;
        if ((r = try_visit(vis.Result, Visitable.Block(body, vis, undefined))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.Option(optional_type, vis, undefined, Visitable.Ty))) !== undefined) return r;
        break;
      }
      case "Lit": {
        const token = kind._0;
        if ((r = try_visit(vis.Result, Visitable.Lit(token, vis, undefined))) !== undefined) return r;
        break;
      }
      case "IncludedBytes": {
        const bytes = kind._0;
        if ((r = try_visit(vis.Result, Visitable.ByteSymbol(bytes, vis, undefined))) !== undefined) return r;
        break;
      }
      case "UnsafeBinderCast": {
        const kind_ = kind._0, expr = kind._1, ty = kind._2;
        if ((r = try_visit(vis.Result, Visitable.UnsafeBinderCastKind(kind_, vis, undefined))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.Expr(expr, vis, undefined))) !== undefined) return r;
        if ((r = try_visit(vis.Result, Visitable.Option(ty, vis, undefined, Visitable.Ty))) !== undefined) return r;
        break;
      }
      case "GcaMacro": {
        const expr = kind._0;
        if ((r = try_visit(vis.Result, Visitable.Expr(expr, vis, undefined))) !== undefined) return r;
        break;
      }
      case "Err":
        break;
      case "Dummy":
        break;
    }

    if ((r = try_visit(vis.Result, Visitable.Span(span, vis, undefined))) !== undefined) return r;
    return vis.Result.output();
  },
};

// rustc-macro: compiler/rustc_ast/src/visit.rs:300 fn_walk! (for_each_ast_visit_hook!)
export function walk_anon_const<R>(visitor: Visitor<R>, node: AnonConst): R {
  return Walkable.AnonConst(node, visitor);
}
export function walk_arm<R>(visitor: Visitor<R>, node: Arm): R {
  return Walkable.Arm(node, visitor);
}
export function walk_assoc_item_constraint<R>(visitor: Visitor<R>, node: AssocItemConstraint): R {
  return Walkable.AssocItemConstraint(node, visitor);
}
export function walk_attribute<R>(visitor: Visitor<R>, node: Attribute): R {
  return Walkable.Attribute(node, visitor);
}
export function walk_block<R>(visitor: Visitor<R>, node: Block): R {
  return Walkable.Block(node, visitor);
}
export function walk_capture_by<R>(visitor: Visitor<R>, node: CaptureBy): R {
  return Walkable.CaptureBy(node, visitor);
}
export function walk_closure_binder<R>(visitor: Visitor<R>, node: ClosureBinder): R {
  return Walkable.ClosureBinder(node, visitor);
}
export function walk_contract<R>(visitor: Visitor<R>, node: FnContract): R {
  return Walkable.FnContract(node, visitor);
}
export function walk_coroutine_marker<R>(visitor: Visitor<R>, node: CoroutineMarker): R {
  return Walkable.CoroutineMarker(node, visitor);
}
export function walk_crate<R>(visitor: Visitor<R>, node: Crate): R {
  return Walkable.Crate(node, visitor);
}
export function walk_expr<R>(visitor: Visitor<R>, node: Expr): R {
  return Walkable.Expr(node, visitor);
}
export function walk_expr_field<R>(visitor: Visitor<R>, node: ExprField): R {
  return Walkable.ExprField(node, visitor);
}
export function walk_field_def<R>(visitor: Visitor<R>, node: FieldDef): R {
  return Walkable.FieldDef(node, visitor);
}
export function walk_field_def_extras<R>(visitor: Visitor<R>, node: FieldDefExtras): R {
  return Walkable.FieldDefExtras(node, visitor);
}
export function walk_fn_decl<R>(visitor: Visitor<R>, node: FnDecl): R {
  return Walkable.FnDecl(node, visitor);
}
export function walk_fn_header<R>(visitor: Visitor<R>, node: FnHeader): R {
  return Walkable.FnHeader(node, visitor);
}
export function walk_fn_ret_ty<R>(visitor: Visitor<R>, node: FnRetTy): R {
  return Walkable.FnRetTy(node, visitor);
}
export function walk_foreign_mod<R>(visitor: Visitor<R>, node: ForeignMod): R {
  return Walkable.ForeignMod(node, visitor);
}
export function walk_format_args<R>(visitor: Visitor<R>, node: FormatArgs): R {
  return Walkable.FormatArgs(node, visitor);
}
export function walk_generic_arg<R>(visitor: Visitor<R>, node: GenericArg): R {
  return Walkable.GenericArg(node, visitor);
}
export function walk_generic_args<R>(visitor: Visitor<R>, node: GenericArgs): R {
  return Walkable.GenericArgs(node, visitor);
}
export function walk_generic_param<R>(visitor: Visitor<R>, node: GenericParam): R {
  return Walkable.GenericParam(node, visitor);
}
export function walk_generics<R>(visitor: Visitor<R>, node: Generics): R {
  return Walkable.Generics(node, visitor);
}
export function walk_impl_restriction<R>(visitor: Visitor<R>, node: ImplRestriction): R {
  return Walkable.ImplRestriction(node, visitor);
}
export function walk_inline_asm<R>(visitor: Visitor<R>, node: InlineAsm): R {
  return Walkable.InlineAsm(node, visitor);
}
export function walk_inline_asm_sym<R>(visitor: Visitor<R>, node: InlineAsmSym): R {
  return Walkable.InlineAsmSym(node, visitor);
}
export function walk_label<R>(visitor: Visitor<R>, node: Label): R {
  return Walkable.Label(node, visitor);
}
export function walk_lifetime<R>(visitor: Visitor<R>, node: Lifetime): R {
  return Walkable.Lifetime(node, visitor);
}
export function walk_local<R>(visitor: Visitor<R>, node: Local): R {
  return Walkable.Local(node, visitor);
}
export function walk_mac<R>(visitor: Visitor<R>, node: MacCall): R {
  return Walkable.MacCall(node, visitor);
}
export function walk_macro_def<R>(visitor: Visitor<R>, node: MacroDef): R {
  return Walkable.MacroDef(node, visitor);
}
export function walk_mut_restriction<R>(visitor: Visitor<R>, node: MutRestriction): R {
  return Walkable.MutRestriction(node, visitor);
}
export function walk_param<R>(visitor: Visitor<R>, node: Param): R {
  return Walkable.Param(node, visitor);
}
export function walk_param_bound<R>(visitor: Visitor<R>, node: GenericBound): R {
  return Walkable.GenericBound(node, visitor);
}
export function walk_pat<R>(visitor: Visitor<R>, node: Pat): R {
  return Walkable.Pat(node, visitor);
}
export function walk_pat_field<R>(visitor: Visitor<R>, node: PatField): R {
  return Walkable.PatField(node, visitor);
}
export function walk_path<R>(visitor: Visitor<R>, node: Path): R {
  return Walkable.Path(node, visitor);
}
export function walk_path_segment<R>(visitor: Visitor<R>, node: PathSegment): R {
  return Walkable.PathSegment(node, visitor);
}
export function walk_poly_trait_ref<R>(visitor: Visitor<R>, node: PolyTraitRef): R {
  return Walkable.PolyTraitRef(node, visitor);
}
export function walk_precise_capturing_arg<R>(visitor: Visitor<R>, node: PreciseCapturingArg): R {
  return Walkable.PreciseCapturingArg(node, visitor);
}
export function walk_qself<R>(visitor: Visitor<R>, node: QSelf): R {
  return Walkable.QSelf(node, visitor);
}
export function walk_test_binder_body<R>(visitor: Visitor<R>, node: TestBinderBody): R {
  return Walkable.TestBinderBody(node, visitor);
}
export function walk_test_binder_bound_type_constraint<R>(visitor: Visitor<R>, node: TestBinderBoundTypeConstraint): R {
  return Walkable.TestBinderBoundTypeConstraint(node, visitor);
}
export function walk_test_binder_constraint<R>(visitor: Visitor<R>, node: TestBinderConstraint): R {
  return Walkable.TestBinderConstraint(node, visitor);
}
export function walk_test_binder_constraints<R>(visitor: Visitor<R>, node: TestBinderConstraints): R {
  return Walkable.TestBinderConstraints(node, visitor);
}
export function walk_test_binder_exists<R>(visitor: Visitor<R>, node: TestBinderExists): R {
  return Walkable.TestBinderExists(node, visitor);
}
export function walk_test_binder_forall<R>(visitor: Visitor<R>, node: TestBinderForall): R {
  return Walkable.TestBinderForall(node, visitor);
}
export function walk_trait_ref<R>(visitor: Visitor<R>, node: TraitRef): R {
  return Walkable.TraitRef(node, visitor);
}
export function walk_ty<R>(visitor: Visitor<R>, node: Ty): R {
  return Walkable.Ty(node, visitor);
}
export function walk_ty_pat<R>(visitor: Visitor<R>, node: TyPat): R {
  return Walkable.TyPat(node, visitor);
}
export function walk_use_tree<R>(visitor: Visitor<R>, node: UseTree): R {
  return Walkable.UseTree(node, visitor);
}
export function walk_use_tree_and_id<R>(visitor: Visitor<R>, node: UseTreeAndId): R {
  return Walkable.UseTreeAndId(node, visitor);
}
export function walk_variant<R>(visitor: Visitor<R>, node: Variant): R {
  return Walkable.Variant(node, visitor);
}
export function walk_variant_data<R>(visitor: Visitor<R>, node: VariantData): R {
  return Walkable.VariantData(node, visitor);
}
export function walk_vis<R>(visitor: Visitor<R>, node: Visibility): R {
  return Walkable.Visibility(node, visitor);
}
export function walk_where_predicate<R>(visitor: Visitor<R>, node: WherePredicate): R {
  return Walkable.WherePredicate(node, visitor);
}
export function walk_where_predicate_kind<R>(visitor: Visitor<R>, node: WherePredicateKind): R {
  return Walkable.WherePredicateKind(node, visitor);
}

// ---- End of the expansion of `common_visitor_and_walkers!(Visitor<'a>)` ----

const visitable_list_visit = {
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  "ThinVec<Arm>": <R>(self: Arm[], visitor: Visitor<R>, _extra: undefined): R => {
    let r: R | undefined;
    for (const elem of self) {
      if ((r = try_visit(visitor.Result, visitor.visit_arm(elem))) !== undefined) return r;
    }
    return visitor.Result.output();
  },
  // rustc: compiler/rustc_ast/src/visit.rs:225 visit
  "ThinVec<Box<AssocItem>>": <R>(self: AssocItem[], visitor: Visitor<R>, ctxt: AssocCtxt): R => {
    let r: R | undefined;
    for (const elem of self) {
      if ((r = try_visit(visitor.Result, visitor.visit_assoc_item(elem, ctxt))) !== undefined) return r;
    }
    return visitor.Result.output();
  },
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  "ThinVec<Box<Expr>>": <R>(self: Expr[], visitor: Visitor<R>, _extra: undefined): R => {
    let r: R | undefined;
    for (const elem of self) {
      if ((r = try_visit(visitor.Result, visitor.visit_expr(elem))) !== undefined) return r;
    }
    return visitor.Result.output();
  },
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  "ThinVec<ExprField>": <R>(self: ExprField[], visitor: Visitor<R>, _extra: undefined): R => {
    let r: R | undefined;
    for (const elem of self) {
      if ((r = try_visit(visitor.Result, visitor.visit_expr_field(elem))) !== undefined) return r;
    }
    return visitor.Result.output();
  },
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  "ThinVec<FieldDef>": <R>(self: FieldDef[], visitor: Visitor<R>, _extra: undefined): R => {
    let r: R | undefined;
    for (const elem of self) {
      if ((r = try_visit(visitor.Result, visitor.visit_field_def(elem))) !== undefined) return r;
    }
    return visitor.Result.output();
  },
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  "ThinVec<Box<ForeignItem>>": <R>(self: ForeignItem[], visitor: Visitor<R>, _extra: undefined): R => {
    let r: R | undefined;
    for (const elem of self) {
      if ((r = try_visit(visitor.Result, visitor.visit_foreign_item(elem))) !== undefined) return r;
    }
    return visitor.Result.output();
  },
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  "ThinVec<GenericParam>": <R>(self: GenericParam[], visitor: Visitor<R>, _extra: undefined): R => {
    let r: R | undefined;
    for (const elem of self) {
      if ((r = try_visit(visitor.Result, visitor.visit_generic_param(elem))) !== undefined) return r;
    }
    return visitor.Result.output();
  },
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  "ThinVec<Box<Item>>": <R>(self: Item[], visitor: Visitor<R>, _extra: undefined): R => {
    let r: R | undefined;
    for (const elem of self) {
      if ((r = try_visit(visitor.Result, visitor.visit_item(elem))) !== undefined) return r;
    }
    return visitor.Result.output();
  },
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  "ThinVec<Param>": <R>(self: Param[], visitor: Visitor<R>, _extra: undefined): R => {
    let r: R | undefined;
    for (const elem of self) {
      if ((r = try_visit(visitor.Result, visitor.visit_param(elem))) !== undefined) return r;
    }
    return visitor.Result.output();
  },
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  "ThinVec<PatField>": <R>(self: PatField[], visitor: Visitor<R>, _extra: undefined): R => {
    let r: R | undefined;
    for (const elem of self) {
      if ((r = try_visit(visitor.Result, visitor.visit_pat_field(elem))) !== undefined) return r;
    }
    return visitor.Result.output();
  },
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  "ThinVec<Stmt>": <R>(self: Stmt[], visitor: Visitor<R>, _extra: undefined): R => {
    let r: R | undefined;
    for (const elem of self) {
      if ((r = try_visit(visitor.Result, visitor.visit_stmt(elem))) !== undefined) return r;
    }
    return visitor.Result.output();
  },
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  "ThinVec<Variant>": <R>(self: Variant[], visitor: Visitor<R>, _extra: undefined): R => {
    let r: R | undefined;
    for (const elem of self) {
      if ((r = try_visit(visitor.Result, visitor.visit_variant(elem))) !== undefined) return r;
    }
    return visitor.Result.output();
  },
  // rustc: compiler/rustc_ast/src/visit.rs:213 visit
  "ThinVec<WherePredicate>": <R>(self: WherePredicate[], visitor: Visitor<R>, _extra: undefined): R => {
    let r: R | undefined;
    for (const elem of self) {
      if ((r = try_visit(visitor.Result, visitor.visit_where_predicate(elem))) !== undefined) return r;
    }
    return visitor.Result.output();
  },
};

// rustc: compiler/rustc_ast/src/visit.rs:1158 walk_stmt
export function walk_stmt<R>(visitor: Visitor<R>, statement: Stmt): R {
  const { id, kind, span: _ } = statement;
  let r: R | undefined;
  if ((r = try_visit(visitor.Result, visitor.visit_id(id))) !== undefined) return r;
  switch (kind.$) {
    case "Let": {
      const local = kind._0;
      if ((r = try_visit(visitor.Result, visitor.visit_local(local))) !== undefined) return r;
      break;
    }
    case "Item": {
      const item = kind._0;
      if ((r = try_visit(visitor.Result, visitor.visit_item(item))) !== undefined) return r;
      break;
    }
    case "Expr":
    case "Semi": {
      const expr = kind._0;
      if ((r = try_visit(visitor.Result, visitor.visit_expr(expr))) !== undefined) return r;
      break;
    }
    case "Empty":
      break;
    case "MacCall": {
      const { mac, attrs, style: _, tokens: _t } = kind._0;
      for (const elem of attrs) {
        if ((r = try_visit(visitor.Result, visitor.visit_attribute(elem))) !== undefined) return r;
      }
      if ((r = try_visit(visitor.Result, visitor.visit_mac_call(mac))) !== undefined) return r;
      break;
    }
  }
  return visitor.Result.output();
}

// `#[derive(Walkable)]` (compiler/rustc_macros/src/visitable.rs) on the ast.rs, format.rs and
// tokenstream.rs types generates their `Walkable::walk_ref` impls: for each field in declaration order
// (each variant's fields for enums), unless `#[visitable(ignore)]`,
// `try_visit!(Visitable::visit(field, visitor, <#[visitable(extra = ..)] or ()>))`, then
// `V::Result::output()`. They are generated by tools/codegen into walkable.gen.ts (`walkable_derived`).

/** The `Visitable` impls, keyed by implementing type (as written in the upstream macro lists). */
export const Visitable = {
  ...visitable_generic,
  ...visitable_noop,
  ...visitable_list,
  ...visitable_direct,
  ...visitable_visit,
  ...visitable_misc,
  ...visitable_list_visit,
};

/** The `Walkable` impls, keyed by implementing type: the derived ones, then those of visit.rs. */
export const Walkable = {
  ...walkable_derived,
  ...walkable_hand,
};

// PORT: instantiations of generic impls used by the `impl_visitable_list!` element types.
function Option_Ident<R>(self: Ident | undefined, visitor: Visitor<R>, extra: undefined): R {
  return Visitable.Option(self, visitor, extra, Visitable.Ident);
}
