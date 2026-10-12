// Port of compiler/rustc_ast/src/mut_visit.rs
//! A `MutVisitor` represents an AST modification; it accepts an AST piece and
//! mutates it in place. So, for instance, macro expansion is a `MutVisitor`
//! that walks over an AST and modifies it.
//!
//! Note: using a `MutVisitor` (other than the `MacroExpander` `MutVisitor`) on
//! an AST before macro expansion is probably a bad idea. For instance,
//! a `MutVisitor` renaming item names in a module will miss all of those
//! that are created by the expansion of a macro.
//
// PORT: this file holds the expansion of `crate::visit::common_visitor_and_walkers!((mut) MutVisitor)`
// built from this file's own helper macros; see the layout notes at the top of visit.ts.
//
// PORT: `&mut T` places. Rust's `MutVisitable::visit_mut(&mut self, ..)` receives a place it may
// overwrite. TS values have no addresses, so a `MutVisitable` impl receives the *slot* holding the
// value: the containing object and the key (`o[k]`; a struct field, a tuple-variant `_0`, an array index,
// or `"value"` of a `MutRef`). Generic impls pass the same slot on (`Option<T>`'s `Some` payload lives in
// the slot itself) or a sub-slot (`Vec` elements, tuple fields, `Spanned` fields).
// The `MutVisitor` hooks and `MutWalkable` impls of struct/enum nodes receive the node object itself and
// mutate it in place (`&mut Expr` -> `Expr`); a hook replacing a whole node (`*node = new`) must do so in
// place (`Object.assign`), since only the slot owner can store a different object.
// Copy handles that a visitor may overwrite get a `MutRef` view onto their slot:
// `visit_id(MutRef<NodeId>)`, `visit_span(MutRef<Span>)`, `visit_ident(MutRef<Ident>)`; so does
// `&mut Option<T>` inside `FnKind::Closure`.
//
// PORT: `MutVisitor: MutVisitorResult<Result = ()>` (the sealed trait below), so every `try_visit!` of
// the shared macro body is a no-op here and `V::Result::output()` is `()`; the expansion drops both.
import type { Movability, Mutability, Pinnedness } from "../rustc_ast_ir/lib.ts";
import { type MutRef } from "../rustc_span/hygiene.ts";
import type { AttrId, ErrorGuaranteed, Span, Spanned } from "../rustc_span/lib.ts";
import { type ByteSymbol, Ident, type Symbol } from "../rustc_span/symbol.ts";
import { type Debug, debug_option, debug_tuple } from "../std/fmt.ts";
import { panic, unported } from "../std/panic.ts";
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
  Stmt,
  StmtKind,
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
import { AssocCtxt, BoundKind, debug_FnCtxt, FnCtxt, LifetimeCtxt } from "./visit.ts";
import { mut_walkable_derived } from "./mut_walkable.gen.ts";

// mod sealed {
//     /// This is for compatibility with the regular `Visitor`.
//     pub trait MutVisitorResult { type Result: VisitorResult; }
//     impl<T> MutVisitorResult for T { type Result = (); }
// }
// PORT: no fns; `MutVisitor::Result` is always `()` (see the header).

/** A slot holding a `T`: `o[k]`. */
export type Place<T, K extends PropertyKey> = { [P in K]: T };

// PORT: `&mut <slot>` of a Copy handle -> a `MutRef` view: reads and writes go to `o[k]`.
export function field_ref<O, K extends keyof O>(o: O, k: K): MutRef<O[K]> {
  return {
    get value(): O[K] {
      return o[k];
    },
    set value(v: O[K]) {
      o[k] = v;
    },
  };
}

// rustc-trait: compiler/rustc_ast/src/mut_visit.rs:37 MutVisitable
// PORT: `trait MutVisitable<V: MutVisitor> { type Extra: Copy; fn visit_mut(&mut self, visitor: &mut V,
// extra: Self::Extra); }` -> the signature of one impl, taking the slot of `self`; `E` is `Self::Extra`.
// rustc: compiler/rustc_ast/src/mut_visit.rs:39 visit_mut
export type MutVisitable<T, E = undefined> = <K extends PropertyKey>(o: Place<T, K>, k: K, visitor: MutVisitor, extra: E) => void;

const mut_visitable_generic = {
  // rustc: compiler/rustc_ast/src/mut_visit.rs:47 visit_mut
  Box: <T, E, K extends PropertyKey>(o: Place<T, K>, k: K, visitor: MutVisitor, extra: E, T_: MutVisitable<T, E>): void => {
    T_(o, k, visitor, extra);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:57 visit_mut
  Option: <T, E, K extends PropertyKey>(o: Place<T | undefined, K>, k: K, visitor: MutVisitor, extra: E, T_: MutVisitable<T, E>): void => {
    if (o[k] !== undefined) {
      // PORT: `Some(this)`: the payload lives in the same slot.
      T_(o as Place<T, K>, k, visitor, extra);
    }
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:69 visit_mut
  Spanned: <T, E, K extends PropertyKey>(o: Place<Spanned<T>, K>, k: K, visitor: MutVisitor, extra: E, T_: MutVisitable<T, E>): void => {
    // let Spanned { span, node } = self;
    const self = o[k];
    MutVisitable.Span(self, "span", visitor, undefined);
    T_(self, "node", visitor, extra);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:81 visit_mut
  "[T]": <T, E, K extends PropertyKey>(o: Place<T[], K>, k: K, visitor: MutVisitor, extra: E, T_: MutVisitable<T, E>): void => {
    const self = o[k];
    for (let item = 0; item < self.length; item++) {
      T_(self, item, visitor, extra);
    }
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:93 visit_mut
  Vec: <T, E, K extends PropertyKey>(o: Place<T[], K>, k: K, visitor: MutVisitor, extra: E, T_: MutVisitable<T, E>): void => {
    const self = o[k];
    for (let item = 0; item < self.length; item++) {
      T_(self, item, visitor, extra);
    }
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:106 visit_mut
  "(T1, T2)": <T1, T2, K extends PropertyKey>(
    o: Place<[T1, T2], K>,
    k: K,
    visitor: MutVisitor,
    extra: undefined,
    T1_: MutVisitable<T1>,
    T2_: MutVisitable<T2>,
  ): void => {
    const self = o[k];
    T1_(self, 0, visitor, extra);
    T2_(self, 1, visitor, extra);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:119 visit_mut
  "(T1, T2, T3)": <T1, T2, T3, K extends PropertyKey>(
    o: Place<[T1, T2, T3], K>,
    k: K,
    visitor: MutVisitor,
    extra: undefined,
    T1_: MutVisitable<T1>,
    T2_: MutVisitable<T2>,
    T3_: MutVisitable<T3>,
  ): void => {
    const self = o[k];
    T1_(self, 0, visitor, extra);
    T2_(self, 1, visitor, extra);
    T3_(self, 2, visitor, extra);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:134 visit_mut
  "(T1, T2, T3, T4)": <T1, T2, T3, T4, K extends PropertyKey>(
    o: Place<[T1, T2, T3, T4], K>,
    k: K,
    visitor: MutVisitor,
    extra: undefined,
    T1_: MutVisitable<T1>,
    T2_: MutVisitable<T2>,
    T3_: MutVisitable<T3>,
    T4_: MutVisitable<T4>,
  ): void => {
    const self = o[k];
    T1_(self, 0, visitor, extra);
    T2_(self, 1, visitor, extra);
    T3_(self, 2, visitor, extra);
    T4_(self, 3, visitor, extra);
  },
};

// rustc-trait: compiler/rustc_ast/src/mut_visit.rs:142 MutWalkable
// rustc: compiler/rustc_ast/src/mut_visit.rs:143 walk_mut
export type MutWalkable<T> = (self: T, visitor: MutVisitor) => void;

// ---- Expansion of `crate::visit::common_visitor_and_walkers!((mut) MutVisitor)` (mut_visit.rs:256) ----

// PORT: `pub enum FnKind<'a>` of the `(mut)` expansion. `&'a mut T` -> `T` for nodes;
// `&'a mut Option<CoroutineMarker>` -> a `MutRef` onto the `Closure` field.
export type FnKind =
  /// E.g., `fn foo()`, `fn foo(&self)`, or `extern "Abi" fn foo()`.
  | { readonly $: "Fn"; _0: FnCtxt; _1: Visibility; _2: Fn }
  /// E.g., `|x, y| body`.
  | { readonly $: "Closure"; _0: ClosureBinder; _1: MutRef<CoroutineMarker | undefined>; _2: FnDecl; _3: Expr };
export const debug_FnKind: Debug<FnKind> = (v, f) => {
  switch (v.$) {
    case "Fn":
      return debug_tuple(f, "Fn", [debug_FnCtxt(v._0, f), debug_Visibility(v._1, f), debug_Fn(v._2, f)]);
    case "Closure":
      return debug_tuple(f, "Closure", [
        debug_ClosureBinder(v._0, f),
        debug_option(v._1.value, f, debug_CoroutineMarker),
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
  ident(self: FnKind): MutRef<Ident> | undefined {
    switch (self.$) {
      case "Fn":
        return field_ref(self._2, "ident");
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
const mut_visitable_noop = {
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  AttrId: <K extends PropertyKey>(_o: Place<AttrId, K>, _k: K, _vis: MutVisitor, _extra: undefined): void => {},
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  Movability: <K extends PropertyKey>(_o: Place<Movability, K>, _k: K, _vis: MutVisitor, _extra: undefined): void => {},
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  Mutability: <K extends PropertyKey>(_o: Place<Mutability, K>, _k: K, _vis: MutVisitor, _extra: undefined): void => {},
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  Pinnedness: <K extends PropertyKey>(_o: Place<Pinnedness, K>, _k: K, _vis: MutVisitor, _extra: undefined): void => {},
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  "Result<(), ErrorGuaranteed>": <K extends PropertyKey>(_o: Place<Result<null, ErrorGuaranteed>, K>, _k: K, _vis: MutVisitor, _extra: undefined): void => {},
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  Symbol: <K extends PropertyKey>(_o: Place<Symbol, K>, _k: K, _vis: MutVisitor, _extra: undefined): void => {},
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  SyntheticAttr: <K extends PropertyKey>(_o: Place<SyntheticAttr, K>, _k: K, _vis: MutVisitor, _extra: undefined): void => {},
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  bool: <K extends PropertyKey>(_o: Place<boolean, K>, _k: K, _vis: MutVisitor, _extra: undefined): void => {},
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  char: <K extends PropertyKey>(_o: Place<number, K>, _k: K, _vis: MutVisitor, _extra: undefined): void => {},
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  CommentKind: <K extends PropertyKey>(_o: Place<CommentKind, K>, _k: K, _vis: MutVisitor, _extra: undefined): void => {},
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  Delimiter: <K extends PropertyKey>(_o: Place<Delimiter, K>, _k: K, _vis: MutVisitor, _extra: undefined): void => {},
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  Lit: <K extends PropertyKey>(_o: Place<Lit, K>, _k: K, _vis: MutVisitor, _extra: undefined): void => {},
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  LitKind: <K extends PropertyKey>(_o: Place<LitKind, K>, _k: K, _vis: MutVisitor, _extra: undefined): void => {},
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  LazyAttrTokenStream: <K extends PropertyKey>(_o: Place<LazyAttrTokenStream, K>, _k: K, _vis: MutVisitor, _extra: undefined): void => {},
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  TokenStream: <K extends PropertyKey>(_o: Place<TokenStream, K>, _k: K, _vis: MutVisitor, _extra: undefined): void => {},
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  "FxHashMap<Symbol, usize>": <K extends PropertyKey>(_o: Place<Map<Symbol, number>, K>, _k: K, _vis: MutVisitor, _extra: undefined): void => {},
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  ByteSymbol: <K extends PropertyKey>(_o: Place<ByteSymbol, K>, _k: K, _vis: MutVisitor, _extra: undefined): void => {},
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  ErrorGuaranteed: <K extends PropertyKey>(_o: Place<ErrorGuaranteed, K>, _k: K, _vis: MutVisitor, _extra: undefined): void => {},
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  "Cow<str>": <K extends PropertyKey>(_o: Place<string, K>, _k: K, _vis: MutVisitor, _extra: undefined): void => {},
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  u8: <K extends PropertyKey>(_o: Place<number, K>, _k: K, _vis: MutVisitor, _extra: undefined): void => {},
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  usize: <K extends PropertyKey>(_o: Place<number, K>, _k: K, _vis: MutVisitor, _extra: undefined): void => {},
};

// This macro generates `impl Visitable` and `impl MutVisitable` that simply iterate over
// their contents. We do not use a generic impl for `ThinVec` because we want to allow
// custom visits for the `MutVisitor`.
const mut_visitable_list = {
  // rustc: compiler/rustc_ast/src/mut_visit.rs:213 visit_mut
  "ThinVec<(Ident, Option<Ident>)>": <K extends PropertyKey>(o: Place<[Ident, Ident | undefined][], K>, k: K, visitor: MutVisitor, extra: undefined): void => {
    const self = o[k];
    for (let i = 0; i < self.length; i++) {
      MutVisitable["(T1, T2)"](self, i, visitor, extra, MutVisitable.Ident, Option_Ident);
    }
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:213 visit_mut
  "ThinVec<(NodeId, Path)>": <K extends PropertyKey>(o: Place<[NodeId, Path][], K>, k: K, visitor: MutVisitor, extra: undefined): void => {
    const self = o[k];
    for (let i = 0; i < self.length; i++) {
      MutVisitable["(T1, T2)"](self, i, visitor, extra, MutVisitable.NodeId, MutVisitable.Path);
    }
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:213 visit_mut
  "ThinVec<AngleBracketedArg>": <K extends PropertyKey>(o: Place<AngleBracketedArg[], K>, k: K, visitor: MutVisitor, extra: undefined): void => {
    const self = o[k];
    for (let i = 0; i < self.length; i++) {
      MutVisitable.AngleBracketedArg(self, i, visitor, extra);
    }
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:213 visit_mut
  "ThinVec<Attribute>": <K extends PropertyKey>(o: Place<Attribute[], K>, k: K, visitor: MutVisitor, extra: undefined): void => {
    const self = o[k];
    for (let i = 0; i < self.length; i++) {
      MutVisitable.Attribute(self, i, visitor, extra);
    }
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:213 visit_mut
  "ThinVec<Box<Ty>>": <K extends PropertyKey>(o: Place<Ty[], K>, k: K, visitor: MutVisitor, extra: undefined): void => {
    const self = o[k];
    for (let i = 0; i < self.length; i++) {
      MutVisitable.Ty(self, i, visitor, extra);
    }
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:213 visit_mut
  "ThinVec<EiiImpl>": <K extends PropertyKey>(o: Place<EiiImpl[], K>, k: K, visitor: MutVisitor, extra: undefined): void => {
    const self = o[k];
    for (let i = 0; i < self.length; i++) {
      MutVisitable.EiiImpl(self, i, visitor, extra);
    }
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:213 visit_mut
  "ThinVec<GenericBound>": <K extends PropertyKey>(o: Place<GenericBound[], K>, k: K, visitor: MutVisitor, extra: BoundKind): void => {
    const self = o[k];
    for (let i = 0; i < self.length; i++) {
      MutVisitable.GenericBound(self, i, visitor, extra);
    }
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:213 visit_mut
  "ThinVec<Ident>": <K extends PropertyKey>(o: Place<Ident[], K>, k: K, visitor: MutVisitor, extra: undefined): void => {
    const self = o[k];
    for (let i = 0; i < self.length; i++) {
      MutVisitable.Ident(self, i, visitor, extra);
    }
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:213 visit_mut
  "ThinVec<Pat>": <K extends PropertyKey>(o: Place<Pat[], K>, k: K, visitor: MutVisitor, extra: undefined): void => {
    const self = o[k];
    for (let i = 0; i < self.length; i++) {
      MutVisitable.Pat(self, i, visitor, extra);
    }
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:213 visit_mut
  "ThinVec<PathSegment>": <K extends PropertyKey>(o: Place<PathSegment[], K>, k: K, visitor: MutVisitor, extra: undefined): void => {
    const self = o[k];
    for (let i = 0; i < self.length; i++) {
      MutVisitable.PathSegment(self, i, visitor, extra);
    }
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:213 visit_mut
  "ThinVec<PreciseCapturingArg>": <K extends PropertyKey>(o: Place<PreciseCapturingArg[], K>, k: K, visitor: MutVisitor, extra: undefined): void => {
    const self = o[k];
    for (let i = 0; i < self.length; i++) {
      MutVisitable.PreciseCapturingArg(self, i, visitor, extra);
    }
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:213 visit_mut
  "ThinVec<TestBinderConstraint>": <K extends PropertyKey>(o: Place<TestBinderConstraint[], K>, k: K, visitor: MutVisitor, extra: undefined): void => {
    const self = o[k];
    for (let i = 0; i < self.length; i++) {
      MutVisitable.TestBinderConstraint(self, i, visitor, extra);
    }
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:213 visit_mut
  "ThinVec<TestBinderExists>": <K extends PropertyKey>(o: Place<TestBinderExists[], K>, k: K, visitor: MutVisitor, extra: undefined): void => {
    const self = o[k];
    for (let i = 0; i < self.length; i++) {
      MutVisitable.TestBinderExists(self, i, visitor, extra);
    }
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:213 visit_mut
  "ThinVec<TestBinderForall>": <K extends PropertyKey>(o: Place<TestBinderForall[], K>, k: K, visitor: MutVisitor, extra: undefined): void => {
    const self = o[k];
    for (let i = 0; i < self.length; i++) {
      MutVisitable.TestBinderForall(self, i, visitor, extra);
    }
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:213 visit_mut
  "ThinVec<TyPat>": <K extends PropertyKey>(o: Place<TyPat[], K>, k: K, visitor: MutVisitor, extra: undefined): void => {
    const self = o[k];
    for (let i = 0; i < self.length; i++) {
      MutVisitable.TyPat(self, i, visitor, extra);
    }
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:213 visit_mut
  "ThinVec<UseTreeAndId>": <K extends PropertyKey>(o: Place<UseTreeAndId[], K>, k: K, visitor: MutVisitor, extra: undefined): void => {
    const self = o[k];
    for (let i = 0; i < self.length; i++) {
      MutVisitable.UseTreeAndId(self, i, visitor, extra);
    }
  },
};

// This macro generates `impl Visitable` and `impl MutVisitable` that forward to `Walkable`
// or `MutWalkable`. By default, all types that do not have a custom visit method in the
// visitor should appear here.
const mut_visitable_direct = {
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  AngleBracketedArg: <K extends PropertyKey>(o: Place<AngleBracketedArg, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.AngleBracketedArg(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  AngleBracketedArgs: <K extends PropertyKey>(o: Place<AngleBracketedArgs, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.AngleBracketedArgs(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  AsmMacro: <K extends PropertyKey>(o: Place<AsmMacro, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.AsmMacro(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  AssignOpKind: <K extends PropertyKey>(o: Place<AssignOpKind, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.AssignOpKind(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  AssocItemConstraintKind: <K extends PropertyKey>(o: Place<AssocItemConstraintKind, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.AssocItemConstraintKind(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  AttrArgs: <K extends PropertyKey>(o: Place<AttrArgs, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.AttrArgs(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  AttrItem: <K extends PropertyKey>(o: Place<AttrItem, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.AttrItem(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  AttrKind: <K extends PropertyKey>(o: Place<AttrKind, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.AttrKind(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  AttrStyle: <K extends PropertyKey>(o: Place<AttrStyle, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.AttrStyle(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  BinOpKind: <K extends PropertyKey>(o: Place<BinOpKind, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.BinOpKind(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  BindingMode: <K extends PropertyKey>(o: Place<BindingMode, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.BindingMode(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  BlockCheckMode: <K extends PropertyKey>(o: Place<BlockCheckMode, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.BlockCheckMode(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  BorrowKind: <K extends PropertyKey>(o: Place<BorrowKind, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.BorrowKind(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  BoundAsyncness: <K extends PropertyKey>(o: Place<BoundAsyncness, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.BoundAsyncness(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  BoundConstness: <K extends PropertyKey>(o: Place<BoundConstness, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.BoundConstness(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  BoundPolarity: <K extends PropertyKey>(o: Place<BoundPolarity, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.BoundPolarity(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  ByRef: <K extends PropertyKey>(o: Place<ByRef, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.ByRef(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  Closure: <K extends PropertyKey>(o: Place<Closure, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.Closure(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  Const: <K extends PropertyKey>(o: Place<Const, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.Const(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  ConstBlockItem: <K extends PropertyKey>(o: Place<ConstBlockItem, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.ConstBlockItem(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  ConstItem: <K extends PropertyKey>(o: Place<ConstItem, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.ConstItem(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  CoroutineKind: <K extends PropertyKey>(o: Place<CoroutineKind, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.CoroutineKind(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  Defaultness: <K extends PropertyKey>(o: Place<Defaultness, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.Defaultness(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  Delegation: <K extends PropertyKey>(o: Place<Delegation, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.Delegation(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  DelegationMac: <K extends PropertyKey>(o: Place<DelegationMac, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.DelegationMac(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  DelegationSuffixes: <K extends PropertyKey>(o: Place<DelegationSuffixes, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.DelegationSuffixes(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  DelimArgs: <K extends PropertyKey>(o: Place<DelimArgs, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.DelimArgs(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  DelimSpan: <K extends PropertyKey>(o: Place<DelimSpan, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.DelimSpan(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  EiiDecl: <K extends PropertyKey>(o: Place<EiiDecl, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.EiiDecl(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  EiiImpl: <K extends PropertyKey>(o: Place<EiiImpl, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.EiiImpl(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  EnumDef: <K extends PropertyKey>(o: Place<EnumDef, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.EnumDef(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  Extern: <K extends PropertyKey>(o: Place<Extern, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.Extern(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  FnPtrTy: <K extends PropertyKey>(o: Place<FnPtrTy, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.FnPtrTy(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  ForLoopKind: <K extends PropertyKey>(o: Place<ForLoopKind, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.ForLoopKind(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  FormatArgPosition: <K extends PropertyKey>(o: Place<FormatArgPosition, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.FormatArgPosition(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  FormatArgsPiece: <K extends PropertyKey>(o: Place<FormatArgsPiece, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.FormatArgsPiece(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  FormatArgument: <K extends PropertyKey>(o: Place<FormatArgument, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.FormatArgument(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  FormatArgumentKind: <K extends PropertyKey>(o: Place<FormatArgumentKind, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.FormatArgumentKind(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  FormatArguments: <K extends PropertyKey>(o: Place<FormatArguments, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.FormatArguments(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  FormatPlaceholder: <K extends PropertyKey>(o: Place<FormatPlaceholder, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.FormatPlaceholder(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  GenericParamKind: <K extends PropertyKey>(o: Place<GenericParamKind, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.GenericParamKind(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  Guard: <K extends PropertyKey>(o: Place<Guard, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.Guard(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  Impl: <K extends PropertyKey>(o: Place<Impl, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.Impl(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  ImplPolarity: <K extends PropertyKey>(o: Place<ImplPolarity, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.ImplPolarity(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  Inline: <K extends PropertyKey>(o: Place<Inline, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.Inline(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  InlineAsmOperand: <K extends PropertyKey>(o: Place<InlineAsmOperand, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.InlineAsmOperand(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  InlineAsmRegOrRegClass: <K extends PropertyKey>(o: Place<InlineAsmRegOrRegClass, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.InlineAsmRegOrRegClass(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  InlineAsmTemplatePiece: <K extends PropertyKey>(o: Place<InlineAsmTemplatePiece, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.InlineAsmTemplatePiece(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  IsAuto: <K extends PropertyKey>(o: Place<IsAuto, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.IsAuto(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  LocalKind: <K extends PropertyKey>(o: Place<LocalKind, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.LocalKind(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  MacCallStmt: <K extends PropertyKey>(o: Place<MacCallStmt, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.MacCallStmt(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  MacStmtStyle: <K extends PropertyKey>(o: Place<MacStmtStyle, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.MacStmtStyle(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  MatchKind: <K extends PropertyKey>(o: Place<MatchKind, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.MatchKind(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  MethodCall: <K extends PropertyKey>(o: Place<MethodCall, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.MethodCall(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  ModKind: <K extends PropertyKey>(o: Place<ModKind, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.ModKind(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  ModSpans: <K extends PropertyKey>(o: Place<ModSpans, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.ModSpans(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  NormalAttr: <K extends PropertyKey>(o: Place<NormalAttr, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.NormalAttr(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  Parens: <K extends PropertyKey>(o: Place<Parens, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.Parens(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  ParenthesizedArgs: <K extends PropertyKey>(o: Place<ParenthesizedArgs, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.ParenthesizedArgs(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  PatFieldsRest: <K extends PropertyKey>(o: Place<PatFieldsRest, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.PatFieldsRest(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  PatKind: <K extends PropertyKey>(o: Place<PatKind, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.PatKind(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  RangeEnd: <K extends PropertyKey>(o: Place<RangeEnd, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.RangeEnd(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  RangeLimits: <K extends PropertyKey>(o: Place<RangeLimits, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.RangeLimits(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  RangeSyntax: <K extends PropertyKey>(o: Place<RangeSyntax, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.RangeSyntax(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  Recovered: <K extends PropertyKey>(o: Place<Recovered, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.Recovered(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  RestrictionKind: <K extends PropertyKey>(o: Place<RestrictionKind, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.RestrictionKind(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  Safety: <K extends PropertyKey>(o: Place<Safety, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.Safety(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  StaticItem: <K extends PropertyKey>(o: Place<StaticItem, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.StaticItem(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  StrLit: <K extends PropertyKey>(o: Place<StrLit, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.StrLit(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  StrStyle: <K extends PropertyKey>(o: Place<StrStyle, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.StrStyle(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  StructExpr: <K extends PropertyKey>(o: Place<StructExpr, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.StructExpr(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  StructRest: <K extends PropertyKey>(o: Place<StructRest, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.StructRest(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  Term: <K extends PropertyKey>(o: Place<Term, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.Term(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  Trait: <K extends PropertyKey>(o: Place<Trait, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.Trait(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  TraitBoundModifiers: <K extends PropertyKey>(o: Place<TraitBoundModifiers, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.TraitBoundModifiers(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  TraitObjectSyntax: <K extends PropertyKey>(o: Place<TraitObjectSyntax, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.TraitObjectSyntax(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  TyAlias: <K extends PropertyKey>(o: Place<TyAlias, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.TyAlias(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  TyKind: <K extends PropertyKey>(o: Place<TyKind, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.TyKind(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  TyPatKind: <K extends PropertyKey>(o: Place<TyPatKind, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.TyPatKind(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  UnOp: <K extends PropertyKey>(o: Place<UnOp, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.UnOp(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  UnsafeBinderCastKind: <K extends PropertyKey>(o: Place<UnsafeBinderCastKind, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.UnsafeBinderCastKind(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  UnsafeBinderTy: <K extends PropertyKey>(o: Place<UnsafeBinderTy, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.UnsafeBinderTy(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  UnsafeSource: <K extends PropertyKey>(o: Place<UnsafeSource, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.UnsafeSource(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  UseTreeKind: <K extends PropertyKey>(o: Place<UseTreeKind, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.UseTreeKind(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  VisibilityKind: <K extends PropertyKey>(o: Place<VisibilityKind, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.VisibilityKind(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  WhereBoundPredicate: <K extends PropertyKey>(o: Place<WhereBoundPredicate, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.WhereBoundPredicate(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  WhereClause: <K extends PropertyKey>(o: Place<WhereClause, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.WhereClause(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  WhereEqPredicate: <K extends PropertyKey>(o: Place<WhereEqPredicate, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.WhereEqPredicate(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  WhereRegionPredicate: <K extends PropertyKey>(o: Place<WhereRegionPredicate, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.WhereRegionPredicate(o[k], visitor),
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  YieldKind: <K extends PropertyKey>(o: Place<YieldKind, K>, k: K, visitor: MutVisitor, _extra: undefined): void => MutWalkable.YieldKind(o[k], visitor),
};

// rustc-trait: compiler/rustc_ast/src/visit.rs:599 MutVisitor (common_visitor_and_walkers!)
/// Each method of this trait is a hook to be potentially
/// overridden. Each method's default implementation recursively visits
/// the substructure of the input via the corresponding `walk` method;
/// e.g., the `visit_item` method by default calls `visit_mut::walk_item`.
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
// PORT: trait with default methods -> a base class; implementors `extends MutVisitor` and override.
export class MutVisitor {
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
  visit_ident(ident: MutRef<Ident>): void {
    // `Ident { name: _, span }: &mut Ident`
    // PORT: `Ident` is `Copy` and a TS `Ident` object may be shared, so a write to `span` stores a new
    // `Ident` into the visited slot instead of mutating the object.
    const span: MutRef<Span> = {
      get value(): Span {
        return ident.value.span;
      },
      set value(v: Span) {
        ident.value = new Ident(ident.value.name, v);
      },
    };
    MutVisitable.Span(span, "value", this, undefined);
  }

  // rustc-macro: compiler/rustc_ast/src/mut_visit.rs:234 fn_visit! (for_each_ast_visit_hook!)
  visit_anon_const(node: AnonConst): void {
    MutWalkable.AnonConst(node, this);
  }
  visit_arm(node: Arm): void {
    MutWalkable.Arm(node, this);
  }
  visit_assoc_item_constraint(node: AssocItemConstraint): void {
    MutWalkable.AssocItemConstraint(node, this);
  }
  visit_attribute(node: Attribute): void {
    MutWalkable.Attribute(node, this);
  }
  visit_block(node: Block): void {
    MutWalkable.Block(node, this);
  }
  visit_capture_by(node: CaptureBy): void {
    MutWalkable.CaptureBy(node, this);
  }
  visit_closure_binder(node: ClosureBinder): void {
    MutWalkable.ClosureBinder(node, this);
  }
  visit_contract(node: FnContract): void {
    MutWalkable.FnContract(node, this);
  }
  visit_coroutine_marker(node: CoroutineMarker): void {
    MutWalkable.CoroutineMarker(node, this);
  }
  visit_crate(node: Crate): void {
    MutWalkable.Crate(node, this);
  }
  visit_expr(node: Expr): void {
    MutWalkable.Expr(node, this);
  }
  visit_expr_field(node: ExprField): void {
    MutWalkable.ExprField(node, this);
  }
  visit_field_def(node: FieldDef): void {
    MutWalkable.FieldDef(node, this);
  }
  visit_field_def_extras(node: FieldDefExtras): void {
    MutWalkable.FieldDefExtras(node, this);
  }
  visit_fn_decl(node: FnDecl): void {
    MutWalkable.FnDecl(node, this);
  }
  visit_fn_header(node: FnHeader): void {
    MutWalkable.FnHeader(node, this);
  }
  visit_fn_ret_ty(node: FnRetTy): void {
    MutWalkable.FnRetTy(node, this);
  }
  visit_foreign_mod(node: ForeignMod): void {
    MutWalkable.ForeignMod(node, this);
  }
  visit_format_args(node: FormatArgs): void {
    MutWalkable.FormatArgs(node, this);
  }
  visit_generic_arg(node: GenericArg): void {
    MutWalkable.GenericArg(node, this);
  }
  visit_generic_args(node: GenericArgs): void {
    MutWalkable.GenericArgs(node, this);
  }
  visit_generic_param(node: GenericParam): void {
    MutWalkable.GenericParam(node, this);
  }
  visit_generics(node: Generics): void {
    MutWalkable.Generics(node, this);
  }
  visit_impl_restriction(node: ImplRestriction): void {
    MutWalkable.ImplRestriction(node, this);
  }
  visit_inline_asm(node: InlineAsm): void {
    MutWalkable.InlineAsm(node, this);
  }
  visit_inline_asm_sym(node: InlineAsmSym): void {
    MutWalkable.InlineAsmSym(node, this);
  }
  visit_label(node: Label): void {
    MutWalkable.Label(node, this);
  }
  visit_lifetime(node: Lifetime, _ctxt: LifetimeCtxt): void {
    MutWalkable.Lifetime(node, this);
  }
  visit_local(node: Local): void {
    MutWalkable.Local(node, this);
  }
  visit_mac_call(node: MacCall): void {
    MutWalkable.MacCall(node, this);
  }
  visit_macro_def(node: MacroDef): void {
    MutWalkable.MacroDef(node, this);
  }
  visit_mut_restriction(node: MutRestriction): void {
    MutWalkable.MutRestriction(node, this);
  }
  visit_param(node: Param): void {
    MutWalkable.Param(node, this);
  }
  visit_param_bound(node: GenericBound, _ctxt: BoundKind): void {
    MutWalkable.GenericBound(node, this);
  }
  visit_pat(node: Pat): void {
    MutWalkable.Pat(node, this);
  }
  visit_pat_field(node: PatField): void {
    MutWalkable.PatField(node, this);
  }
  visit_path(node: Path): void {
    MutWalkable.Path(node, this);
  }
  visit_path_segment(node: PathSegment): void {
    MutWalkable.PathSegment(node, this);
  }
  visit_poly_trait_ref(node: PolyTraitRef): void {
    MutWalkable.PolyTraitRef(node, this);
  }
  visit_precise_capturing_arg(node: PreciseCapturingArg): void {
    MutWalkable.PreciseCapturingArg(node, this);
  }
  visit_qself(node: QSelf): void {
    MutWalkable.QSelf(node, this);
  }
  visit_test_binder_body(node: TestBinderBody): void {
    MutWalkable.TestBinderBody(node, this);
  }
  visit_test_binder_bound_type_constraint(node: TestBinderBoundTypeConstraint): void {
    MutWalkable.TestBinderBoundTypeConstraint(node, this);
  }
  visit_test_binder_constraint(node: TestBinderConstraint): void {
    MutWalkable.TestBinderConstraint(node, this);
  }
  visit_test_binder_constraints(node: TestBinderConstraints): void {
    MutWalkable.TestBinderConstraints(node, this);
  }
  visit_test_binder_exists(node: TestBinderExists): void {
    MutWalkable.TestBinderExists(node, this);
  }
  visit_test_binder_forall(node: TestBinderForall): void {
    MutWalkable.TestBinderForall(node, this);
  }
  visit_trait_ref(node: TraitRef): void {
    MutWalkable.TraitRef(node, this);
  }
  visit_ty(node: Ty): void {
    MutWalkable.Ty(node, this);
  }
  visit_ty_pat(node: TyPat): void {
    MutWalkable.TyPat(node, this);
  }
  visit_use_tree(node: UseTree): void {
    MutWalkable.UseTree(node, this);
  }
  visit_use_tree_and_id(node: UseTreeAndId): void {
    MutWalkable.UseTreeAndId(node, this);
  }
  visit_variant(node: Variant): void {
    MutWalkable.Variant(node, this);
  }
  visit_variant_data(node: VariantData): void {
    MutWalkable.VariantData(node, this);
  }
  visit_vis(node: Visibility): void {
    MutWalkable.Visibility(node, this);
  }
  visit_where_predicate(node: WherePredicate): void {
    MutWalkable.WherePredicate(node, this);
  }
  visit_where_predicate_kind(node: WherePredicateKind): void {
    MutWalkable.WherePredicateKind(node, this);
  }

  // We want `Visitor` to take the `NodeId` by value.
  // rustc: compiler/rustc_ast/src/visit.rs:644 visit_id
  visit_id(_id: MutRef<NodeId>): void {}

  /// This method is a hack to workaround unstable of `stmt_expr_attributes`.
  /// It can be removed once that feature is stabilized.
  // rustc: compiler/rustc_ast/src/visit.rs:650 visit_method_receiver_expr
  visit_method_receiver_expr(ex: Expr): void {
    this.visit_expr(ex);
  }

  // rustc: compiler/rustc_ast/src/visit.rs:654 visit_item
  visit_item(item: Item): void {
    walk_item(this, item, WalkItemKind.ItemKind);
  }

  // rustc: compiler/rustc_ast/src/visit.rs:658 visit_foreign_item
  visit_foreign_item(item: ForeignItem): void {
    walk_item(this, item, WalkItemKind.ForeignItemKind);
  }

  // rustc: compiler/rustc_ast/src/visit.rs:662 visit_assoc_item
  visit_assoc_item(item: AssocItem, ctxt: AssocCtxt): void {
    walk_assoc_item(this, item, ctxt, WalkItemKind.AssocItemKind);
  }

  // for `MutVisitor`: `Span` and `NodeId` are mutated at the caller site.
  // rustc: compiler/rustc_ast/src/visit.rs:669 visit_fn
  visit_fn(fk: FnKind, _attrs: AttrVec, _span: Span, _id: NodeId): void {
    walk_fn(this, fk);
  }

  // `MutVisitor`-only methods
  // Span visiting is no longer used, but we keep it for now,
  // in case it's needed for something like #127241.
  // rustc: compiler/rustc_ast/src/visit.rs:691 visit_span
  visit_span(_sp: MutRef<Span>): void {
    // Do nothing.
  }

  // rustc: compiler/rustc_ast/src/visit.rs:695 flat_map_foreign_item
  flat_map_foreign_item(ni: ForeignItem): ForeignItem[] {
    return walk_flat_map_foreign_item(this, ni);
  }

  // rustc: compiler/rustc_ast/src/visit.rs:701 flat_map_item
  flat_map_item(i: Item): Item[] {
    return walk_flat_map_item(this, i);
  }

  // rustc: compiler/rustc_ast/src/visit.rs:705 flat_map_field_def
  flat_map_field_def(fd: FieldDef): FieldDef[] {
    return walk_flat_map_field_def(this, fd);
  }

  // rustc: compiler/rustc_ast/src/visit.rs:709 flat_map_assoc_item
  flat_map_assoc_item(i: AssocItem, ctxt: AssocCtxt): AssocItem[] {
    return walk_flat_map_assoc_item(this, i, ctxt);
  }

  // rustc: compiler/rustc_ast/src/visit.rs:717 flat_map_stmt
  flat_map_stmt(s: Stmt): Stmt[] {
    return walk_flat_map_stmt(this, s);
  }

  // rustc: compiler/rustc_ast/src/visit.rs:721 flat_map_arm
  flat_map_arm(arm: Arm): Arm[] {
    return walk_flat_map_arm(this, arm);
  }

  // rustc: compiler/rustc_ast/src/visit.rs:725 filter_map_expr
  filter_map_expr(e: Expr): Expr | undefined {
    return walk_filter_map_expr(this, e);
  }

  // rustc: compiler/rustc_ast/src/visit.rs:729 flat_map_variant
  flat_map_variant(v: Variant): Variant[] {
    return walk_flat_map_variant(this, v);
  }

  // rustc: compiler/rustc_ast/src/visit.rs:733 flat_map_param
  flat_map_param(param: Param): Param[] {
    return walk_flat_map_param(this, param);
  }

  // rustc: compiler/rustc_ast/src/visit.rs:737 flat_map_generic_param
  flat_map_generic_param(param: GenericParam): GenericParam[] {
    return walk_flat_map_generic_param(this, param);
  }

  // rustc: compiler/rustc_ast/src/visit.rs:743 flat_map_expr_field
  flat_map_expr_field(f: ExprField): ExprField[] {
    return walk_flat_map_expr_field(this, f);
  }

  // rustc: compiler/rustc_ast/src/visit.rs:747 flat_map_where_predicate
  flat_map_where_predicate(where_predicate: WherePredicate): WherePredicate[] {
    return walk_flat_map_where_predicate(this, where_predicate);
  }

  // rustc: compiler/rustc_ast/src/visit.rs:754 flat_map_pat_field
  flat_map_pat_field(fp: PatField): PatField[] {
    return walk_flat_map_pat_field(this, fp);
  }
}

const mut_visitable_visit = {
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  AnonConst: <K extends PropertyKey>(o: Place<AnonConst, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_anon_const(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  Arm: <K extends PropertyKey>(o: Place<Arm, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_arm(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  AssocItemConstraint: <K extends PropertyKey>(o: Place<AssocItemConstraint, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_assoc_item_constraint(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  Attribute: <K extends PropertyKey>(o: Place<Attribute, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_attribute(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  Block: <K extends PropertyKey>(o: Place<Block, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_block(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  CaptureBy: <K extends PropertyKey>(o: Place<CaptureBy, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_capture_by(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  ClosureBinder: <K extends PropertyKey>(o: Place<ClosureBinder, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_closure_binder(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  FnContract: <K extends PropertyKey>(o: Place<FnContract, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_contract(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  CoroutineMarker: <K extends PropertyKey>(o: Place<CoroutineMarker, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_coroutine_marker(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  Crate: <K extends PropertyKey>(o: Place<Crate, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_crate(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  Expr: <K extends PropertyKey>(o: Place<Expr, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_expr(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  ExprField: <K extends PropertyKey>(o: Place<ExprField, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_expr_field(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  FieldDef: <K extends PropertyKey>(o: Place<FieldDef, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_field_def(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  FieldDefExtras: <K extends PropertyKey>(o: Place<FieldDefExtras, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_field_def_extras(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  FnDecl: <K extends PropertyKey>(o: Place<FnDecl, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_fn_decl(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  FnHeader: <K extends PropertyKey>(o: Place<FnHeader, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_fn_header(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  FnRetTy: <K extends PropertyKey>(o: Place<FnRetTy, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_fn_ret_ty(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  ForeignMod: <K extends PropertyKey>(o: Place<ForeignMod, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_foreign_mod(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  FormatArgs: <K extends PropertyKey>(o: Place<FormatArgs, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_format_args(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  GenericArg: <K extends PropertyKey>(o: Place<GenericArg, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_generic_arg(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  GenericArgs: <K extends PropertyKey>(o: Place<GenericArgs, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_generic_args(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  GenericParam: <K extends PropertyKey>(o: Place<GenericParam, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_generic_param(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  Generics: <K extends PropertyKey>(o: Place<Generics, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_generics(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  ImplRestriction: <K extends PropertyKey>(o: Place<ImplRestriction, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_impl_restriction(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  InlineAsm: <K extends PropertyKey>(o: Place<InlineAsm, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_inline_asm(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  InlineAsmSym: <K extends PropertyKey>(o: Place<InlineAsmSym, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_inline_asm_sym(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  Label: <K extends PropertyKey>(o: Place<Label, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_label(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:177 visit_mut
  Lifetime: <K extends PropertyKey>(o: Place<Lifetime, K>, k: K, visitor: MutVisitor, _ctxt: LifetimeCtxt): void => {
    visitor.visit_lifetime(o[k], _ctxt);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  Local: <K extends PropertyKey>(o: Place<Local, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_local(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  MacCall: <K extends PropertyKey>(o: Place<MacCall, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_mac_call(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  MacroDef: <K extends PropertyKey>(o: Place<MacroDef, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_macro_def(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  MutRestriction: <K extends PropertyKey>(o: Place<MutRestriction, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_mut_restriction(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  Param: <K extends PropertyKey>(o: Place<Param, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_param(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:177 visit_mut
  GenericBound: <K extends PropertyKey>(o: Place<GenericBound, K>, k: K, visitor: MutVisitor, _ctxt: BoundKind): void => {
    visitor.visit_param_bound(o[k], _ctxt);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  Pat: <K extends PropertyKey>(o: Place<Pat, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_pat(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  PatField: <K extends PropertyKey>(o: Place<PatField, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_pat_field(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  Path: <K extends PropertyKey>(o: Place<Path, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_path(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  PathSegment: <K extends PropertyKey>(o: Place<PathSegment, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_path_segment(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  PolyTraitRef: <K extends PropertyKey>(o: Place<PolyTraitRef, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_poly_trait_ref(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  PreciseCapturingArg: <K extends PropertyKey>(o: Place<PreciseCapturingArg, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_precise_capturing_arg(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  QSelf: <K extends PropertyKey>(o: Place<QSelf, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_qself(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  TestBinderBody: <K extends PropertyKey>(o: Place<TestBinderBody, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_test_binder_body(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  TestBinderBoundTypeConstraint: <K extends PropertyKey>(o: Place<TestBinderBoundTypeConstraint, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_test_binder_bound_type_constraint(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  TestBinderConstraint: <K extends PropertyKey>(o: Place<TestBinderConstraint, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_test_binder_constraint(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  TestBinderConstraints: <K extends PropertyKey>(o: Place<TestBinderConstraints, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_test_binder_constraints(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  TestBinderExists: <K extends PropertyKey>(o: Place<TestBinderExists, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_test_binder_exists(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  TestBinderForall: <K extends PropertyKey>(o: Place<TestBinderForall, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_test_binder_forall(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  TraitRef: <K extends PropertyKey>(o: Place<TraitRef, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_trait_ref(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  Ty: <K extends PropertyKey>(o: Place<Ty, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_ty(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  TyPat: <K extends PropertyKey>(o: Place<TyPat, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_ty_pat(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  UseTree: <K extends PropertyKey>(o: Place<UseTree, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_use_tree(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  UseTreeAndId: <K extends PropertyKey>(o: Place<UseTreeAndId, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_use_tree_and_id(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  Variant: <K extends PropertyKey>(o: Place<Variant, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_variant(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  VariantData: <K extends PropertyKey>(o: Place<VariantData, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_variant_data(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  Visibility: <K extends PropertyKey>(o: Place<Visibility, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_vis(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  WherePredicate: <K extends PropertyKey>(o: Place<WherePredicate, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_where_predicate(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  WherePredicateKind: <K extends PropertyKey>(o: Place<WherePredicateKind, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_where_predicate_kind(o[k]);
  },
};

const mut_visitable_misc = {
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  Ident: <K extends PropertyKey>(o: Place<Ident, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_ident(field_ref(o, k));
  },

  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  NodeId: <K extends PropertyKey>(o: Place<NodeId, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_id(field_ref(o, k));
  },

  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  Span: <K extends PropertyKey>(o: Place<Span, K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    visitor.visit_span(field_ref(o, k));
  },

  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  Item: <K extends PropertyKey>(o: Place<Item, K>, k: K, vis: MutVisitor, _extra: undefined): void => {
    vis.visit_item(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  ForeignItem: <K extends PropertyKey>(o: Place<ForeignItem, K>, k: K, vis: MutVisitor, _extra: undefined): void => {
    vis.visit_foreign_item(o[k]);
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:177 visit_mut
  AssocItem: <K extends PropertyKey>(o: Place<AssocItem, K>, k: K, vis: MutVisitor, ctxt: AssocCtxt): void => {
    vis.visit_assoc_item(o[k], ctxt);
  },
};

// rustc-trait: compiler/rustc_ast/src/visit.rs:795 WalkItemKind (common_visitor_and_walkers!)
// PORT: as in visit.ts, an impl object per item-kind type; `self` is the kind object (slots on it).
export interface WalkItemKind<K, Ctxt> {
  // rustc: compiler/rustc_ast/src/visit.rs:797 walk
  walk(self: K, attrs: AttrVec, span: Span, id: NodeId, visibility: Visibility, ctxt: Ctxt, vis: MutVisitor): void;
}

// rustc: compiler/rustc_ast/src/visit.rs:808 walk_item_inner
function walk_item_inner<K, Ctxt>(visitor: MutVisitor, item: Item<K>, ctxt: Ctxt, K_: WalkItemKind<K, Ctxt>): void {
  // let Item { attrs, id, kind, vis, span, tokens: _ } = item;
  MutVisitable.NodeId(item, "id", visitor, undefined);
  MutVisitable["ThinVec<Attribute>"](item, "attrs", visitor, undefined);
  MutVisitable.Visibility(item, "vis", visitor, undefined);
  K_.walk(item.kind, item.attrs, item.span, item.id, item.vis, ctxt, visitor);
  MutVisitable.Span(item, "span", visitor, undefined);
}

// Do not implement `Walkable`/`MutWalkable` for *Item to avoid confusion.
// rustc: compiler/rustc_ast/src/visit.rs:821 walk_item
export function walk_item<K>(visitor: MutVisitor, item: Item<K>, K_: WalkItemKind<K, undefined>): void {
  walk_item_inner(visitor, item, undefined, K_);
}

// Do not implement `Walkable`/`MutWalkable` for *Item to avoid confusion.
// rustc: compiler/rustc_ast/src/visit.rs:829 walk_assoc_item
export function walk_assoc_item<K>(visitor: MutVisitor, item: Item<K>, ctxt: AssocCtxt, K_: WalkItemKind<K, AssocCtxt>): void {
  walk_item_inner(visitor, item, ctxt, K_);
}

/** The `WalkItemKind` impls, by implementing type. */
export const WalkItemKind = {
  ItemKind: {
    // rustc: compiler/rustc_ast/src/visit.rs:839 walk
    walk(self: ItemKind, attrs: AttrVec, span: Span, id: NodeId, visibility: Visibility, _ctxt: undefined, vis: MutVisitor): void {
      switch (self.$) {
        case "Fn": {
          const func = self._0;
          const kind: FnKind = { $: "Fn", _0: FnCtxt.Free, _1: visibility, _2: func };
          vis.visit_fn(kind, attrs, span, id);
          break;
        }
        case "ExternCrate":
          // (orig_name, ident)
          MutVisitable.Option(self, "_0", vis, undefined, MutVisitable.Symbol);
          MutVisitable.Ident(self, "_1", vis, undefined);
          break;
        case "Use":
          // (use_tree)
          MutVisitable.UseTree(self, "_0", vis, undefined);
          break;
        case "Static":
          // (item)
          MutVisitable.StaticItem(self, "_0", vis, undefined);
          break;
        case "ConstBlock":
          // (item)
          MutVisitable.ConstBlockItem(self, "_0", vis, undefined);
          break;
        case "Const":
          // (item)
          MutVisitable.ConstItem(self, "_0", vis, undefined);
          break;
        case "Mod":
          // (safety, ident, mod_kind)
          MutVisitable.Safety(self, "_0", vis, undefined);
          MutVisitable.Ident(self, "_1", vis, undefined);
          MutVisitable.ModKind(self, "_2", vis, undefined);
          break;
        case "ForeignMod":
          // (nm)
          MutVisitable.ForeignMod(self, "_0", vis, undefined);
          break;
        case "GlobalAsm":
          // (asm)
          MutVisitable.InlineAsm(self, "_0", vis, undefined);
          break;
        case "TyAlias":
          // (ty_alias)
          MutVisitable.TyAlias(self, "_0", vis, undefined);
          break;
        case "Enum":
          // (ident, generics, enum_definition)
          MutVisitable.Ident(self, "_0", vis, undefined);
          MutVisitable.Generics(self, "_1", vis, undefined);
          MutVisitable.EnumDef(self, "_2", vis, undefined);
          break;
        case "Struct":
        case "Union":
          // (ident, generics, variant_data)
          MutVisitable.Ident(self, "_0", vis, undefined);
          MutVisitable.Generics(self, "_1", vis, undefined);
          MutVisitable.VariantData(self, "_2", vis, undefined);
          break;
        case "Impl":
          // (impl_)
          MutVisitable.Impl(self, "_0", vis, undefined);
          break;
        case "Trait":
          // (trait_)
          MutVisitable.Trait(self, "_0", vis, undefined);
          break;
        case "TraitAlias": {
          // TraitAlias { constness, ident, generics, bounds }
          const ta = self._0;
          MutVisitable.Const(ta, "constness", vis, undefined);
          MutVisitable.Ident(ta, "ident", vis, undefined);
          MutVisitable.Generics(ta, "generics", vis, undefined);
          MutVisitable["ThinVec<GenericBound>"](ta, "bounds", vis, BoundKind.Bound);
          break;
        }
        case "MacCall":
          // (m)
          MutVisitable.MacCall(self, "_0", vis, undefined);
          break;
        case "MacroDef":
          // (ident, def)
          MutVisitable.Ident(self, "_0", vis, undefined);
          MutVisitable.MacroDef(self, "_1", vis, undefined);
          break;
        case "Delegation":
          // (delegation)
          MutVisitable.Delegation(self, "_0", vis, undefined);
          break;
        case "DelegationMac":
          // (dm)
          MutVisitable.DelegationMac(self, "_0", vis, undefined);
          break;
        case "TestBinderConstraints":
          // (item)
          MutVisitable.TestBinderConstraints(self, "_0", vis, undefined);
          break;
      }
    },
  } satisfies WalkItemKind<ItemKind, undefined>,

  AssocItemKind: {
    // rustc: compiler/rustc_ast/src/visit.rs:901 walk
    walk(self: AssocItemKind, attrs: AttrVec, span: Span, id: NodeId, visibility: Visibility, ctxt: AssocCtxt, vis: MutVisitor): void {
      switch (self.$) {
        case "Const":
          // (item)
          MutVisitable.ConstItem(self, "_0", vis, undefined);
          break;
        case "Fn": {
          const func = self._0;
          const kind: FnKind = { $: "Fn", _0: { $: "Assoc", _0: ctxt }, _1: visibility, _2: func };
          vis.visit_fn(kind, attrs, span, id);
          break;
        }
        case "Type":
          // (alias)
          MutVisitable.TyAlias(self, "_0", vis, undefined);
          break;
        case "MacCall":
          // (mac)
          MutVisitable.MacCall(self, "_0", vis, undefined);
          break;
        case "Delegation":
          // (delegation)
          MutVisitable.Delegation(self, "_0", vis, undefined);
          break;
        case "DelegationMac":
          // (dm)
          MutVisitable.DelegationMac(self, "_0", vis, undefined);
          break;
      }
    },
  } satisfies WalkItemKind<AssocItemKind, AssocCtxt>,

  ForeignItemKind: {
    // rustc: compiler/rustc_ast/src/visit.rs:932 walk
    walk(self: ForeignItemKind, attrs: AttrVec, span: Span, id: NodeId, visibility: Visibility, _ctxt: undefined, vis: MutVisitor): void {
      switch (self.$) {
        case "Static":
          // (item)
          MutVisitable.StaticItem(self, "_0", vis, undefined);
          break;
        case "Fn": {
          const func = self._0;
          const kind: FnKind = { $: "Fn", _0: FnCtxt.Foreign, _1: visibility, _2: func };
          vis.visit_fn(kind, attrs, span, id);
          break;
        }
        case "TyAlias":
          // (alias)
          MutVisitable.TyAlias(self, "_0", vis, undefined);
          break;
        case "MacCall":
          // (mac)
          MutVisitable.MacCall(self, "_0", vis, undefined);
          break;
      }
    },
  } satisfies WalkItemKind<ForeignItemKind, undefined>,
};

// rustc: compiler/rustc_ast/src/visit.rs:957 walk_fn
export function walk_fn(vis: MutVisitor, kind: FnKind): void {
  switch (kind.$) {
    case "Fn": {
      // Visibility is visited as a part of the item.
      // Fn { defaultness, ident, sig, generics, contract, body, define_opaque, eii_impl }
      const func = kind._2;
      // let FnSig { header, decl, span } = sig;
      const sig = func.sig;
      MutVisitable.Defaultness(func, "defaultness", vis, undefined);
      MutVisitable.Ident(func, "ident", vis, undefined);
      MutVisitable.FnHeader(sig, "header", vis, undefined);
      MutVisitable.Generics(func, "generics", vis, undefined);
      MutVisitable.FnDecl(sig, "decl", vis, undefined);
      MutVisitable.Option(func, "contract", vis, undefined, MutVisitable.FnContract);
      MutVisitable.Option(func, "body", vis, undefined, MutVisitable.Block);
      MutVisitable.Span(sig, "span", vis, undefined);
      MutVisitable.Option(func, "define_opaque", vis, undefined, MutVisitable["ThinVec<(NodeId, Path)>"]);
      MutVisitable.Option(func, "eii_impl", vis, undefined, MutVisitable.EiiImpl);
      break;
    }
    case "Closure":
      // (binder, coroutine_marker, decl, body)
      MutVisitable.ClosureBinder(kind, "_0", vis, undefined);
      MutVisitable.Option(kind._1, "value", vis, undefined, MutVisitable.CoroutineMarker);
      MutVisitable.FnDecl(kind, "_2", vis, undefined);
      MutVisitable.Expr(kind, "_3", vis, undefined);
      break;
  }
}

const mut_walkable_hand = {
  // rustc: compiler/rustc_ast/src/mut_visit.rs:188 walk_mut
  Impl: (self: Impl, vis: MutVisitor): void => {
    // let Impl { generics, of_trait, self_ty, items, constness: _ } = self;
    const of_trait = self.of_trait;
    vis.visit_generics(self.generics);
    if (of_trait !== undefined) {
      // let TraitImplHeader { defaultness, safety, polarity, trait_ref } = of_trait;
      MutVisitable.Defaultness(of_trait, "defaultness", vis, undefined);
      MutVisitable.Safety(of_trait, "safety", vis, undefined);
      MutVisitable.ImplPolarity(of_trait, "polarity", vis, undefined);
      MutVisitable.TraitRef(of_trait, "trait_ref", vis, undefined);
    }
    vis.visit_ty(self.self_ty);
    MutVisitable["ThinVec<Box<AssocItem>>"](self, "items", vis, { $: "Impl", of_trait: of_trait !== undefined });
  },

  // Special case to call `visit_method_receiver_expr`.
  // rustc: compiler/rustc_ast/src/mut_visit.rs:188 walk_mut
  MethodCall: (self: MethodCall, vis: MutVisitor): void => {
    // let MethodCall { seg, receiver, args, span } = self;
    vis.visit_method_receiver_expr(self.receiver);
    MutVisitable.PathSegment(self, "seg", vis, undefined);
    MutVisitable["ThinVec<Box<Expr>>"](self, "args", vis, undefined);
    MutVisitable.Span(self, "span", vis, undefined);
  },

  // rustc: compiler/rustc_ast/src/mut_visit.rs:188 walk_mut
  Expr: (self: Expr, vis: MutVisitor): void => {
    // let Expr { id, kind, span, attrs, tokens: _ } = self;
    const kind = self.kind;
    MutVisitable.NodeId(self, "id", vis, undefined);
    MutVisitable["ThinVec<Attribute>"](self, "attrs", vis, undefined);
    switch (kind.$) {
      case "Array":
        // (exprs)
        MutVisitable["ThinVec<Box<Expr>>"](kind, "_0", vis, undefined);
        break;
      case "ConstBlock":
        // (anon_const)
        MutVisitable.AnonConst(kind, "_0", vis, undefined);
        break;
      case "Repeat":
        // (element, count)
        MutVisitable.Expr(kind, "_0", vis, undefined);
        MutVisitable.AnonConst(kind, "_1", vis, undefined);
        break;
      case "Struct":
        // (se)
        MutVisitable.StructExpr(kind, "_0", vis, undefined);
        break;
      case "Tup":
        // (exprs)
        MutVisitable["ThinVec<Box<Expr>>"](kind, "_0", vis, undefined);
        break;
      case "Call":
        // (callee_expression, arguments)
        MutVisitable.Expr(kind, "_0", vis, undefined);
        MutVisitable["ThinVec<Box<Expr>>"](kind, "_1", vis, undefined);
        break;
      case "MethodCall":
        // (mc)
        MutVisitable.MethodCall(kind, "_0", vis, undefined);
        break;
      case "Binary":
        // (op, lhs, rhs)
        MutVisitable.Spanned(kind, "_0", vis, undefined, MutVisitable.BinOpKind);
        MutVisitable.Expr(kind, "_1", vis, undefined);
        MutVisitable.Expr(kind, "_2", vis, undefined);
        break;
      case "AddrOf":
        // (kind, mutbl, subexpression)
        MutVisitable.BorrowKind(kind, "_0", vis, undefined);
        MutVisitable.Mutability(kind, "_1", vis, undefined);
        MutVisitable.Expr(kind, "_2", vis, undefined);
        break;
      case "Unary":
        // (op, subexpression)
        MutVisitable.UnOp(kind, "_0", vis, undefined);
        MutVisitable.Expr(kind, "_1", vis, undefined);
        break;
      case "Cast":
      case "Type":
        // (subexpression, typ)
        MutVisitable.Expr(kind, "_0", vis, undefined);
        MutVisitable.Ty(kind, "_1", vis, undefined);
        break;
      case "Let":
        // (pat, expr, span, _recovered)
        MutVisitable.Pat(kind, "_0", vis, undefined);
        MutVisitable.Expr(kind, "_1", vis, undefined);
        MutVisitable.Span(kind, "_2", vis, undefined);
        break;
      case "If":
        // (head_expression, if_block, optional_else)
        MutVisitable.Expr(kind, "_0", vis, undefined);
        MutVisitable.Block(kind, "_1", vis, undefined);
        MutVisitable.Option(kind, "_2", vis, undefined, MutVisitable.Expr);
        break;
      case "While":
        // (subexpression, block, opt_label)
        MutVisitable.Expr(kind, "_0", vis, undefined);
        MutVisitable.Block(kind, "_1", vis, undefined);
        MutVisitable.Option(kind, "_2", vis, undefined, MutVisitable.Label);
        break;
      case "ForLoop": {
        // ForLoop { pat, iter, body, label, kind }
        const fl = kind._0;
        MutVisitable.Pat(fl, "pat", vis, undefined);
        MutVisitable.Expr(fl, "iter", vis, undefined);
        MutVisitable.Block(fl, "body", vis, undefined);
        MutVisitable.Option(fl, "label", vis, undefined, MutVisitable.Label);
        MutVisitable.ForLoopKind(fl, "kind", vis, undefined);
        break;
      }
      case "Loop":
        // (block, opt_label, span)
        MutVisitable.Block(kind, "_0", vis, undefined);
        MutVisitable.Option(kind, "_1", vis, undefined, MutVisitable.Label);
        MutVisitable.Span(kind, "_2", vis, undefined);
        break;
      case "Match":
        // (subexpression, arms, kind)
        MutVisitable.Expr(kind, "_0", vis, undefined);
        MutVisitable["ThinVec<Arm>"](kind, "_1", vis, undefined);
        MutVisitable.MatchKind(kind, "_2", vis, undefined);
        break;
      case "Closure": {
        // Closure { binder, capture_clause, coroutine_marker, constness, movability, fn_decl, body,
        //           fn_decl_span, fn_arg_span }
        const c = kind._0;
        MutVisitable.Const(c, "constness", vis, undefined);
        MutVisitable.Movability(c, "movability", vis, undefined);
        MutVisitable.CaptureBy(c, "capture_clause", vis, undefined);
        const kind_: FnKind = { $: "Closure", _0: c.binder, _1: field_ref(c, "coroutine_marker"), _2: c.fn_decl, _3: c.body };
        vis.visit_fn(kind_, self.attrs, self.span, self.id);
        MutVisitable.Span(c, "fn_decl_span", vis, undefined);
        MutVisitable.Span(c, "fn_arg_span", vis, undefined);
        break;
      }
      case "Block":
        // (block, opt_label)
        MutVisitable.Block(kind, "_0", vis, undefined);
        MutVisitable.Option(kind, "_1", vis, undefined, MutVisitable.Label);
        break;
      case "Gen":
        // (capt, body, kind, decl_span)
        MutVisitable.CaptureBy(kind, "_0", vis, undefined);
        MutVisitable.Block(kind, "_1", vis, undefined);
        MutVisitable.CoroutineKind(kind, "_2", vis, undefined);
        MutVisitable.Span(kind, "_3", vis, undefined);
        break;
      case "Await":
      case "Move":
      case "Use":
        // (expr, span)
        MutVisitable.Expr(kind, "_0", vis, undefined);
        MutVisitable.Span(kind, "_1", vis, undefined);
        break;
      case "Assign":
        // (lhs, rhs, span)
        MutVisitable.Expr(kind, "_0", vis, undefined);
        MutVisitable.Expr(kind, "_1", vis, undefined);
        MutVisitable.Span(kind, "_2", vis, undefined);
        break;
      case "AssignOp":
        // (op, lhs, rhs)
        MutVisitable.Spanned(kind, "_0", vis, undefined, MutVisitable.AssignOpKind);
        MutVisitable.Expr(kind, "_1", vis, undefined);
        MutVisitable.Expr(kind, "_2", vis, undefined);
        break;
      case "Field":
        // (subexpression, ident)
        MutVisitable.Expr(kind, "_0", vis, undefined);
        MutVisitable.Ident(kind, "_1", vis, undefined);
        break;
      case "Index":
        // (main_expression, index_expression, span)
        MutVisitable.Expr(kind, "_0", vis, undefined);
        MutVisitable.Expr(kind, "_1", vis, undefined);
        MutVisitable.Span(kind, "_2", vis, undefined);
        break;
      case "Range":
        // (start, end, limit)
        MutVisitable.Option(kind, "_0", vis, undefined, MutVisitable.Expr);
        MutVisitable.Option(kind, "_1", vis, undefined, MutVisitable.Expr);
        MutVisitable.RangeLimits(kind, "_2", vis, undefined);
        break;
      case "Underscore":
        break;
      case "Path":
        // (maybe_qself, path)
        MutVisitable.Option(kind, "_0", vis, undefined, MutVisitable.QSelf);
        MutVisitable.Path(kind, "_1", vis, undefined);
        break;
      case "Break":
        // (opt_label, opt_expr)
        MutVisitable.Option(kind, "_0", vis, undefined, MutVisitable.Label);
        MutVisitable.Option(kind, "_1", vis, undefined, MutVisitable.Expr);
        break;
      case "Continue":
        // (opt_label)
        MutVisitable.Option(kind, "_0", vis, undefined, MutVisitable.Label);
        break;
      case "Ret":
      case "Yeet":
        // (optional_expression)
        MutVisitable.Option(kind, "_0", vis, undefined, MutVisitable.Expr);
        break;
      case "Become":
        // (expr)
        MutVisitable.Expr(kind, "_0", vis, undefined);
        break;
      case "MacCall":
        // (mac)
        MutVisitable.MacCall(kind, "_0", vis, undefined);
        break;
      case "Paren":
        // (subexpression)
        MutVisitable.Expr(kind, "_0", vis, undefined);
        break;
      case "InlineAsm":
        // (asm)
        MutVisitable.InlineAsm(kind, "_0", vis, undefined);
        break;
      case "FormatArgs":
        // (f)
        MutVisitable.FormatArgs(kind, "_0", vis, undefined);
        break;
      case "OffsetOf":
        // (container, fields)
        MutVisitable.Ty(kind, "_0", vis, undefined);
        MutVisitable["ThinVec<Ident>"](kind, "_1", vis, undefined);
        break;
      case "Yield":
        // (kind)
        MutVisitable.YieldKind(kind, "_0", vis, undefined);
        break;
      case "Try":
        // (subexpression)
        MutVisitable.Expr(kind, "_0", vis, undefined);
        break;
      case "TryBlock":
        // (body, optional_type)
        MutVisitable.Block(kind, "_0", vis, undefined);
        MutVisitable.Option(kind, "_1", vis, undefined, MutVisitable.Ty);
        break;
      case "Lit":
        // (token)
        MutVisitable.Lit(kind, "_0", vis, undefined);
        break;
      case "IncludedBytes":
        // (bytes)
        MutVisitable.ByteSymbol(kind, "_0", vis, undefined);
        break;
      case "UnsafeBinderCast":
        // (kind, expr, ty)
        MutVisitable.UnsafeBinderCastKind(kind, "_0", vis, undefined);
        MutVisitable.Expr(kind, "_1", vis, undefined);
        MutVisitable.Option(kind, "_2", vis, undefined, MutVisitable.Ty);
        break;
      case "GcaMacro":
        // (expr)
        MutVisitable.Expr(kind, "_0", vis, undefined);
        break;
      case "Err":
        break;
      case "Dummy":
        break;
    }

    MutVisitable.Span(self, "span", vis, undefined);
  },
};

// rustc-macro: compiler/rustc_ast/src/mut_visit.rs:250 fn_walk! (for_each_ast_visit_hook!)
export function walk_anon_const(visitor: MutVisitor, node: AnonConst): void {
  MutWalkable.AnonConst(node, visitor);
}
export function walk_arm(visitor: MutVisitor, node: Arm): void {
  MutWalkable.Arm(node, visitor);
}
export function walk_assoc_item_constraint(visitor: MutVisitor, node: AssocItemConstraint): void {
  MutWalkable.AssocItemConstraint(node, visitor);
}
export function walk_attribute(visitor: MutVisitor, node: Attribute): void {
  MutWalkable.Attribute(node, visitor);
}
export function walk_block(visitor: MutVisitor, node: Block): void {
  MutWalkable.Block(node, visitor);
}
export function walk_capture_by(visitor: MutVisitor, node: CaptureBy): void {
  MutWalkable.CaptureBy(node, visitor);
}
export function walk_closure_binder(visitor: MutVisitor, node: ClosureBinder): void {
  MutWalkable.ClosureBinder(node, visitor);
}
export function walk_contract(visitor: MutVisitor, node: FnContract): void {
  MutWalkable.FnContract(node, visitor);
}
export function walk_coroutine_marker(visitor: MutVisitor, node: CoroutineMarker): void {
  MutWalkable.CoroutineMarker(node, visitor);
}
export function walk_crate(visitor: MutVisitor, node: Crate): void {
  MutWalkable.Crate(node, visitor);
}
export function walk_expr(visitor: MutVisitor, node: Expr): void {
  MutWalkable.Expr(node, visitor);
}
export function walk_expr_field(visitor: MutVisitor, node: ExprField): void {
  MutWalkable.ExprField(node, visitor);
}
export function walk_field_def(visitor: MutVisitor, node: FieldDef): void {
  MutWalkable.FieldDef(node, visitor);
}
export function walk_field_def_extras(visitor: MutVisitor, node: FieldDefExtras): void {
  MutWalkable.FieldDefExtras(node, visitor);
}
export function walk_fn_decl(visitor: MutVisitor, node: FnDecl): void {
  MutWalkable.FnDecl(node, visitor);
}
export function walk_fn_header(visitor: MutVisitor, node: FnHeader): void {
  MutWalkable.FnHeader(node, visitor);
}
export function walk_fn_ret_ty(visitor: MutVisitor, node: FnRetTy): void {
  MutWalkable.FnRetTy(node, visitor);
}
export function walk_foreign_mod(visitor: MutVisitor, node: ForeignMod): void {
  MutWalkable.ForeignMod(node, visitor);
}
export function walk_format_args(visitor: MutVisitor, node: FormatArgs): void {
  MutWalkable.FormatArgs(node, visitor);
}
export function walk_generic_arg(visitor: MutVisitor, node: GenericArg): void {
  MutWalkable.GenericArg(node, visitor);
}
export function walk_generic_args(visitor: MutVisitor, node: GenericArgs): void {
  MutWalkable.GenericArgs(node, visitor);
}
export function walk_generic_param(visitor: MutVisitor, node: GenericParam): void {
  MutWalkable.GenericParam(node, visitor);
}
export function walk_generics(visitor: MutVisitor, node: Generics): void {
  MutWalkable.Generics(node, visitor);
}
export function walk_impl_restriction(visitor: MutVisitor, node: ImplRestriction): void {
  MutWalkable.ImplRestriction(node, visitor);
}
export function walk_inline_asm(visitor: MutVisitor, node: InlineAsm): void {
  MutWalkable.InlineAsm(node, visitor);
}
export function walk_inline_asm_sym(visitor: MutVisitor, node: InlineAsmSym): void {
  MutWalkable.InlineAsmSym(node, visitor);
}
export function walk_label(visitor: MutVisitor, node: Label): void {
  MutWalkable.Label(node, visitor);
}
export function walk_lifetime(visitor: MutVisitor, node: Lifetime): void {
  MutWalkable.Lifetime(node, visitor);
}
export function walk_local(visitor: MutVisitor, node: Local): void {
  MutWalkable.Local(node, visitor);
}
export function walk_mac(visitor: MutVisitor, node: MacCall): void {
  MutWalkable.MacCall(node, visitor);
}
export function walk_macro_def(visitor: MutVisitor, node: MacroDef): void {
  MutWalkable.MacroDef(node, visitor);
}
export function walk_mut_restriction(visitor: MutVisitor, node: MutRestriction): void {
  MutWalkable.MutRestriction(node, visitor);
}
export function walk_param(visitor: MutVisitor, node: Param): void {
  MutWalkable.Param(node, visitor);
}
export function walk_param_bound(visitor: MutVisitor, node: GenericBound): void {
  MutWalkable.GenericBound(node, visitor);
}
export function walk_pat(visitor: MutVisitor, node: Pat): void {
  MutWalkable.Pat(node, visitor);
}
export function walk_pat_field(visitor: MutVisitor, node: PatField): void {
  MutWalkable.PatField(node, visitor);
}
export function walk_path(visitor: MutVisitor, node: Path): void {
  MutWalkable.Path(node, visitor);
}
export function walk_path_segment(visitor: MutVisitor, node: PathSegment): void {
  MutWalkable.PathSegment(node, visitor);
}
export function walk_poly_trait_ref(visitor: MutVisitor, node: PolyTraitRef): void {
  MutWalkable.PolyTraitRef(node, visitor);
}
export function walk_precise_capturing_arg(visitor: MutVisitor, node: PreciseCapturingArg): void {
  MutWalkable.PreciseCapturingArg(node, visitor);
}
export function walk_qself(visitor: MutVisitor, node: QSelf): void {
  MutWalkable.QSelf(node, visitor);
}
export function walk_test_binder_body(visitor: MutVisitor, node: TestBinderBody): void {
  MutWalkable.TestBinderBody(node, visitor);
}
export function walk_test_binder_bound_type_constraint(visitor: MutVisitor, node: TestBinderBoundTypeConstraint): void {
  MutWalkable.TestBinderBoundTypeConstraint(node, visitor);
}
export function walk_test_binder_constraint(visitor: MutVisitor, node: TestBinderConstraint): void {
  MutWalkable.TestBinderConstraint(node, visitor);
}
export function walk_test_binder_constraints(visitor: MutVisitor, node: TestBinderConstraints): void {
  MutWalkable.TestBinderConstraints(node, visitor);
}
export function walk_test_binder_exists(visitor: MutVisitor, node: TestBinderExists): void {
  MutWalkable.TestBinderExists(node, visitor);
}
export function walk_test_binder_forall(visitor: MutVisitor, node: TestBinderForall): void {
  MutWalkable.TestBinderForall(node, visitor);
}
export function walk_trait_ref(visitor: MutVisitor, node: TraitRef): void {
  MutWalkable.TraitRef(node, visitor);
}
export function walk_ty(visitor: MutVisitor, node: Ty): void {
  MutWalkable.Ty(node, visitor);
}
export function walk_ty_pat(visitor: MutVisitor, node: TyPat): void {
  MutWalkable.TyPat(node, visitor);
}
export function walk_use_tree(visitor: MutVisitor, node: UseTree): void {
  MutWalkable.UseTree(node, visitor);
}
export function walk_use_tree_and_id(visitor: MutVisitor, node: UseTreeAndId): void {
  MutWalkable.UseTreeAndId(node, visitor);
}
export function walk_variant(visitor: MutVisitor, node: Variant): void {
  MutWalkable.Variant(node, visitor);
}
export function walk_variant_data(visitor: MutVisitor, node: VariantData): void {
  MutWalkable.VariantData(node, visitor);
}
export function walk_vis(visitor: MutVisitor, node: Visibility): void {
  MutWalkable.Visibility(node, visitor);
}
export function walk_where_predicate(visitor: MutVisitor, node: WherePredicate): void {
  MutWalkable.WherePredicate(node, visitor);
}
export function walk_where_predicate_kind(visitor: MutVisitor, node: WherePredicateKind): void {
  MutWalkable.WherePredicateKind(node, visitor);
}

// ---- End of the expansion of `common_visitor_and_walkers!((mut) MutVisitor)` ----

const mut_visitable_flat_map = {
  // tidy-alphabetical-start
  // `filter_map_expr` is the odd one out; it works because `Option` impls `IntoIterator`.
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  "ThinVec<Arm>": <K extends PropertyKey>(o: Place<Arm[], K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    flat_map_in_place(o[k], (value) => visitor.flat_map_arm(value));
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:177 visit_mut
  "ThinVec<Box<AssocItem>>": <K extends PropertyKey>(o: Place<AssocItem[], K>, k: K, visitor: MutVisitor, ctxt: AssocCtxt): void => {
    flat_map_in_place(o[k], (value) => visitor.flat_map_assoc_item(value, ctxt));
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  "ThinVec<Box<Expr>>": <K extends PropertyKey>(o: Place<Expr[], K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    flat_map_in_place(o[k], (value) => option_into_iter(visitor.filter_map_expr(value)));
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  "ThinVec<ExprField>": <K extends PropertyKey>(o: Place<ExprField[], K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    flat_map_in_place(o[k], (value) => visitor.flat_map_expr_field(value));
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  "ThinVec<FieldDef>": <K extends PropertyKey>(o: Place<FieldDef[], K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    flat_map_in_place(o[k], (value) => visitor.flat_map_field_def(value));
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  "ThinVec<Box<ForeignItem>>": <K extends PropertyKey>(o: Place<ForeignItem[], K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    flat_map_in_place(o[k], (value) => visitor.flat_map_foreign_item(value));
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  "ThinVec<GenericParam>": <K extends PropertyKey>(o: Place<GenericParam[], K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    flat_map_in_place(o[k], (value) => visitor.flat_map_generic_param(value));
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  "ThinVec<Box<Item>>": <K extends PropertyKey>(o: Place<Item[], K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    flat_map_in_place(o[k], (value) => visitor.flat_map_item(value));
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  "ThinVec<Param>": <K extends PropertyKey>(o: Place<Param[], K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    flat_map_in_place(o[k], (value) => visitor.flat_map_param(value));
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  "ThinVec<PatField>": <K extends PropertyKey>(o: Place<PatField[], K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    flat_map_in_place(o[k], (value) => visitor.flat_map_pat_field(value));
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  "ThinVec<Stmt>": <K extends PropertyKey>(o: Place<Stmt[], K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    flat_map_in_place(o[k], (value) => visitor.flat_map_stmt(value));
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  "ThinVec<Variant>": <K extends PropertyKey>(o: Place<Variant[], K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    flat_map_in_place(o[k], (value) => visitor.flat_map_variant(value));
  },
  // rustc: compiler/rustc_ast/src/mut_visit.rs:165 visit_mut
  "ThinVec<WherePredicate>": <K extends PropertyKey>(o: Place<WherePredicate[], K>, k: K, visitor: MutVisitor, _extra: undefined): void => {
    flat_map_in_place(o[k], (value) => visitor.flat_map_where_predicate(value));
  },
  // tidy-alphabetical-end
};

// rustc: compiler/rustc_ast/src/mut_visit.rs:284 walk_flat_map_pat_field
export function walk_flat_map_pat_field(vis: MutVisitor, fp: PatField): PatField[] {
  vis.visit_pat_field(fp);
  return [fp];
}

// rustc-macro: compiler/rustc_ast/src/mut_visit.rs:294 generate_walk_flat_map_fns!
// tidy-alphabetical-start
export function walk_flat_map_arm(vis: MutVisitor, value: Arm): Arm[] {
  vis.visit_arm(value);
  return [value];
}
export function walk_flat_map_assoc_item(vis: MutVisitor, value: AssocItem, ctxt: AssocCtxt): AssocItem[] {
  vis.visit_assoc_item(value, ctxt);
  return [value];
}
export function walk_flat_map_expr_field(vis: MutVisitor, value: ExprField): ExprField[] {
  vis.visit_expr_field(value);
  return [value];
}
export function walk_flat_map_field_def(vis: MutVisitor, value: FieldDef): FieldDef[] {
  vis.visit_field_def(value);
  return [value];
}
export function walk_flat_map_foreign_item(vis: MutVisitor, value: ForeignItem): ForeignItem[] {
  vis.visit_foreign_item(value);
  return [value];
}
export function walk_flat_map_generic_param(vis: MutVisitor, value: GenericParam): GenericParam[] {
  vis.visit_generic_param(value);
  return [value];
}
export function walk_flat_map_item(vis: MutVisitor, value: Item): Item[] {
  vis.visit_item(value);
  return [value];
}
export function walk_flat_map_param(vis: MutVisitor, value: Param): Param[] {
  vis.visit_param(value);
  return [value];
}
export function walk_flat_map_variant(vis: MutVisitor, value: Variant): Variant[] {
  vis.visit_variant(value);
  return [value];
}
export function walk_flat_map_where_predicate(vis: MutVisitor, value: WherePredicate): WherePredicate[] {
  vis.visit_where_predicate(value);
  return [value];
}
// tidy-alphabetical-end

// rustc: compiler/rustc_ast/src/mut_visit.rs:320 walk_filter_map_expr
export function walk_filter_map_expr(vis: MutVisitor, e: Expr): Expr | undefined {
  vis.visit_expr(e);
  return e;
}

// rustc: compiler/rustc_ast/src/mut_visit.rs:325 walk_flat_map_stmt
export function walk_flat_map_stmt(vis: MutVisitor, stmt: Stmt): Stmt[] {
  // `Stmt { kind, span, mut id }: Stmt`
  const { kind, span } = stmt;
  const id: MutRef<NodeId> = { value: stmt.id };
  vis.visit_id(id);
  const stmts: Stmt[] = walk_flat_map_stmt_kind(vis, kind).map((kind) => new Stmt(id.value, kind, span));
  switch (stmts.length) {
    case 0:
      break;
    case 1:
      vis.visit_span(field_ref(stmts[0]!, "span"));
      break;
    default:
      panic(
        "cloning statement `NodeId`s is prohibited by default, " +
          "the visitor should implement custom statement visiting",
      );
  }
  return stmts;
}

// rustc: compiler/rustc_ast/src/mut_visit.rs:345 walk_flat_map_stmt_kind
export function walk_flat_map_stmt_kind(vis: MutVisitor, kind: StmtKind): StmtKind[] {
  switch (kind.$) {
    case "Let": {
      const local = kind._0;
      vis.visit_local(local);
      return [{ $: "Let", _0: local }];
    }
    case "Item":
      return vis.flat_map_item(kind._0).map((item): StmtKind => ({ $: "Item", _0: item }));
    case "Expr":
      return option_into_iter(vis.filter_map_expr(kind._0)).map((expr): StmtKind => ({ $: "Expr", _0: expr }));
    case "Semi":
      return option_into_iter(vis.filter_map_expr(kind._0)).map((expr): StmtKind => ({ $: "Semi", _0: expr }));
    case "Empty":
      return [StmtKind.Empty];
    case "MacCall": {
      const mac = kind._0;
      const { mac: mac_, style: _, attrs, tokens: _t } = mac;
      for (const attr of attrs) {
        vis.visit_attribute(attr);
      }
      vis.visit_mac_call(mac_);
      return [{ $: "MacCall", _0: mac }];
    }
  }
}

// PORT: `Option<T>: IntoIterator`.
function option_into_iter<T>(o: T | undefined): T[] {
  return o === undefined ? [] : [o];
}

// PORT: pending a port of compiler/rustc_data_structures/src/flat_map_in_place.rs (`FlatMapInPlace` for
// `ThinVec`; not ported yet, root: move to src/rustc_data_structures/flat_map_in_place.ts). The same
// algorithm on a JS array: each element is moved out and replaced, in order, by the elements `f` maps it
// to; `insert` when the output outruns the input; on a panic the vec is left empty (`LeakGuard`).
function flat_map_in_place<T>(self: T[], f: (e: T) => Iterable<T>): void {
  let read_i = 0;
  let write_i = 0;
  try {
    while (read_i < self.length) {
      // Move the read_i'th item out of the vector and map it to an iterator.
      const e = self[read_i]!;
      const iter = f(e);
      read_i += 1;

      for (const e of iter) {
        if (write_i < read_i) {
          self[write_i] = e;
          write_i += 1;
        } else {
          // If this is reached we ran out of space in the middle of the vector.
          // However, the vector is in a valid state here, so we just do a somewhat
          // inefficient insert.
          self.splice(write_i, 0, e);

          read_i += 1;
          write_i += 1;
        }
      }
    }

    // `write_i` tracks the number of actually written new items.
    self.length = write_i;
  } catch (err) {
    // Leak all elements in case of panic.
    self.length = 0;
    throw err;
  }
}

// `#[derive(Walkable)]` also generates the `MutWalkable::walk_mut` impls (rustc_macros/src/
// visitable.rs): for each field in declaration order, unless `#[visitable(ignore)]`,
// `MutVisitable::visit_mut(field, visitor, <extra or ()>)` (here: `MutVisitable[ty](self, "field", ..)`).
// They are generated by tools/codegen into mut_walkable.gen.ts (`mut_walkable_derived`).

/** The `MutVisitable` impls, keyed by implementing type (as written in the upstream macro lists). */
export const MutVisitable = {
  ...mut_visitable_generic,
  ...mut_visitable_noop,
  ...mut_visitable_list,
  ...mut_visitable_direct,
  ...mut_visitable_visit,
  ...mut_visitable_misc,
  ...mut_visitable_flat_map,
};

/** The `MutWalkable` impls, keyed by implementing type: the derived ones, then those of the expansion. */
export const MutWalkable = {
  ...mut_walkable_derived,
  ...mut_walkable_hand,
};

// PORT: instantiation of a generic impl used by an `impl_visitable_list!` element type.
function Option_Ident<K extends PropertyKey>(o: Place<Ident | undefined, K>, k: K, visitor: MutVisitor, extra: undefined): void {
  MutVisitable.Option(o, k, visitor, extra, MutVisitable.Ident);
}
