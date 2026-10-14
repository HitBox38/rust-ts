// Port of compiler/rustc_hir/src/hir.rs
//
// Types and derived Debug/Clone are generated (tools/codegen/types.ts, set `rustc_hir`; lane
// hir-types). Until that lane merges they come from the stand-in `./hir_standin.ts` (lane hir-visit):
// at merge, root points every `./hir_standin.ts` below (imports and `declare module`) at
// `./hir.gen.ts` and deletes the stand-in. The manual `impl fmt::Debug`s (hir.rs:1357 OwnerNodes,
// :1723 DotDotPos, :3765 FnDeclFlags) are lane hir-types'.
//
// PORT: method placement follows rustc_ast/ast.ts (PORTING §8):
// - Enum methods live on the companion const: `export type X = gen.X; export const X = { ...gen.X, fns }`
//   (the spread keeps the generated unit-variant singletons, when there are any).
// - Structs with inherent fns are generated classes (auto_class). `&self` methods are attached to the
//   prototype (`gen.X.prototype.m = function (this: X, ..) {..}`) and declared via
//   `declare module "./hir_standin.ts"`. Static fns and associated consts are assigned onto the class,
//   re-exported as `export const X = gen.X as typeof gen.X & {..}` plus `export type X = gen.X`.
// - `impl From<A> for B` -> `B.from_A(a)`; `impl Display for X` -> `display_X(v): string`;
//   `impl IntoDiagArg for X` -> `X_into_diag_arg(self, path)` (rustc_errors/diagnostic_impls.ts).
// - `Ty<'hir, AmbigArg>` is `Ty<AmbigArg>` (`AmbigArg` is uninhabited: `never`), `Ty<'hir>` is `Ty`
//   (`Unambig = ()`: `null`). The upstream pointer casts between them are identity casts.
import type { ExternAbi } from "../rustc_abi/extern_abi.ts";
import { BinOpKind, BoundConstness, BoundPolarity, type IsAuto, type MacroDef, type Movability, type Mutability, ParamKindOrd, TraitObjectSyntax } from "../rustc_ast/lib.ts";
import type { ExprPrecedence } from "../rustc_ast/util/parser.ts";
import { FloatTy, IntTy, UintTy } from "../rustc_ast_ir/lib.ts";
import type { Attribute } from "../rustc_attr_ir/lib.ts";
import { Fingerprint } from "../rustc_data_structures/fingerprint.ts";
import type { DiagArgValue, PathBuf } from "../rustc_error_messages/lib.ts";
import { SortedMap } from "../rustc_hir_id/definitions.ts";
import { CRATE_HIR_ID, debug_HirId, type HirId, HirId_eq, HirId_INVALID, HirId_make_owner, ItemLocalId, type OwnerId } from "../rustc_hir_id/lib.ts";
import { type DefId, DefId_eq, LocalDefId } from "../rustc_span/def_id.ts";
import { DesugaringKind, type MutRef } from "../rustc_span/hygiene.ts";
import { BytePos, DUMMY_SP, type ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import { display_Symbol, Ident, kw, sym, type Symbol } from "../rustc_span/symbol.ts";
import { is_ascii_digit } from "../std/char.ts";
import { type Debug, type Fmt, PLAIN, PRETTY } from "../std/fmt.ts";
import { assert, panic, unported, unreachable, unwrap } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { utf8 } from "../std/str.ts";
import { type CtorKind, debug_Res, type MacroKinds, type PerNS, Res, Res_eq } from "./def.ts";
import { type AmbigArg, type AnonConst, type Arm, type AssocItemConstraint, type Block, type Body, type BodyId, type Closure, type ConstArg, type ConstArg as ConstArgT, type ConstBlock, debug_LifetimeSource, type DelegationInfo, type EnumDef, type Expr, type ExprField, type FieldDef, type FnSig, type ForeignItem, type ForeignItemId, type GenericArgs as GenericArgsT, type GenericBounds, type GenericBound as GenericBoundT, type GenericParam, type Generics as GenericsT, type Impl, type ImplItem, type ImplItemId, type ImplRestriction, type InferArg, type InlineAsm, type Item, type ItemId, type LetStmt, type LifetimeKind as LifetimeKindT, type Lifetime as LifetimeT, type Mod, type OpaqueTy, type Param, type ParentedNode, type Pat, type PatField, type PathSegment as PathSegmentT, type SplattedArgIndexError, type Stmt, type TestBinderBody, type TraitFn, type TraitItem, type TraitItemId, type TraitRef, type Ty, type UseTree, type Variant, type VariantData as VariantDataT, type WhereBoundPredicate, type WherePredicateKind as WherePredicateKindT, type WhereRegionPredicate } from "./hir_standin.ts";
import { FnKind, type HirTyCtxt, Visitor, walk_ty } from "./intravisit.ts";
import * as asm from "../rustc_target/asm/mod.ts";
import * as gen from "./hir_standin.ts";

export * from "./hir_standin.ts";

// pub use rustc_ast::{
//     AssignOp, AssignOpKind, AttrId, AttrStyle, BinOp, BinOpKind, BindingMode, BorrowKind,
//     BoundConstness, BoundPolarity, ByRef, CaptureBy, DelimArgs, ImplPolarity, IsAuto,
//     MetaItemInner, MetaItemLit, Movability, Mutability, Pinnedness, UnOp,
// };
export {
  type AssignOp,
  AssignOpKind,
  AttrId,
  AttrStyle,
  type BinOp,
  BinOpKind,
  BindingMode,
  BorrowKind,
  BoundConstness,
  BoundPolarity,
  ByRef,
  CaptureBy,
  DelimArgs,
  ImplPolarity,
  IsAuto,
  MetaItemInner,
  MetaItemLit,
  Movability,
  Mutability,
  Pinnedness,
  UnOp,
} from "../rustc_ast/lib.ts";

// ---- hir.rs lines 1–1537 -------------------------------------------------------------

declare module "./hir_standin.ts" {
  interface Lifetime {
    is_elided(): boolean;
    is_anonymous(): boolean;
    is_implicit(): boolean;
    is_static(): boolean;
    suggestion(new_lifetime: string): [Span, string];
  }
  interface Path<R> {
    is_global(this: Path): boolean;
  }
  interface PathSegment {
    args_(): GenericArgs;
  }
  interface ConstArg<Unambig> {
    try_as_ambig_ct(this: ConstArg): ConstArg<AmbigArg> | undefined;
    anon_const_hir_id(): HirId | undefined;
  }
  interface InferArg {
    to_ty(): Ty;
  }
  interface GenericArgs {
    paren_sugar_inputs_output(): [readonly Ty[], Ty] | undefined;
    paren_sugar_output(): Ty | undefined;
    paren_sugar_output_inner(): Ty;
    has_err(): ErrorGuaranteed | undefined;
    num_lifetime_args(): number;
    has_lifetime_args(): boolean;
    num_generic_params(): number;
    span(): Span | undefined;
    span_ext_(): Span | undefined;
    is_empty(): boolean;
  }
  interface GenericParam {
    is_impl_trait(): boolean;
    is_elided_lifetime(): boolean;
    is_lifetime(): boolean;
  }
  interface Generics {
    get_named(name: Symbol): GenericParam | undefined;
    span_for_lifetime_suggestion(): Span | undefined;
    span_for_param_suggestion(): Span | undefined;
    tail_span_for_predicate_suggestion(): Span;
    add_where_or_trailing_comma(): string;
    bounds_for_param(param_def_id: LocalDefId): WhereBoundPredicate[];
    outlives_for_param(param_def_id: LocalDefId): WhereRegionPredicate[];
    bounds_span_for_suggestions(param_def_id: LocalDefId): [Span, Span | undefined] | undefined;
    span_for_predicate_removal(pos: number): Span;
    span_for_bound_removal(predicate_pos: number, bound_pos: number): Span;
    span_for_param_removal(param_index: number): Span;
    span_for_param_bounds(param: GenericParam): Span | undefined;
  }
  interface WhereBoundPredicate {
    is_param_bound(param_def_id: DefId): boolean;
  }
  interface WhereRegionPredicate {
    is_param_bound(param_def_id: LocalDefId): boolean;
  }
  interface AttributeMap {
    get(id: ItemLocalId): readonly Attribute[];
  }
  interface OwnerNodes {
    node(): OwnerNode;
  }
  interface OwnerInfo {
    node(): OwnerNode;
    fingerprint(): Fingerprint;
  }
  interface Block {
    innermost_block(): Block;
  }
}

export type LifetimeSyntax = gen.LifetimeSyntax;
export const LifetimeSyntax = {
  ...gen.LifetimeSyntax,

  // impl From<Ident> for LifetimeSyntax
  // rustc: compiler/rustc_hir/src/hir.rs:88 from
  from_Ident(ident: Ident): LifetimeSyntax {
    const name = ident.name;

    if (name === sym.empty) {
      return unreachable("internal error: entered unreachable code: A lifetime name should never be empty");
    } else if (name === kw.UnderscoreLifetime) {
      return "ExplicitAnonymous";
    } else {
      // debug_assert!(name.as_str().starts_with('\''));
      return "ExplicitBound";
    }
  },
};

export type ParamName = gen.ParamName;
export const ParamName = {
  ...gen.ParamName,

  // rustc: compiler/rustc_hir/src/hir.rs:212 ident
  ident(self: ParamName): Ident {
    switch (self.$) {
      case "Plain":
      case "Error":
        return self._0;
      case "Fresh":
        return Ident.with_dummy_span(kw.UnderscoreLifetime);
    }
  },
};

export type LifetimeKind = LifetimeKindT;
export const LifetimeKind = {
  ...gen.LifetimeKind,

  // rustc: compiler/rustc_hir/src/hir.rs:252 is_elided
  is_elided(self: LifetimeKind): boolean {
    switch (self.$) {
      case "ImplicitObjectLifetimeDefault":
      case "Infer":
        return true;

      // It might seem surprising that `Fresh` counts as not *elided*
      // -- but this is because, as far as the code in the compiler is
      // concerned -- `Fresh` variants act equivalently to "some fresh name".
      // They correspond to early-bound regions on an impl, in other words.
      case "Error":
      case "Param":
      case "Static":
        return false;
    }
  },
};

// impl fmt::Display for Lifetime
// rustc: compiler/rustc_hir/src/hir.rs:266 fmt
export function display_Lifetime(v: LifetimeT): string {
  return display_Symbol(v.ident.name);
}

export type Lifetime = LifetimeT;
// PORT: statics of the generated class, attached below in upstream order.
export const Lifetime = gen.Lifetime as typeof gen.Lifetime & {
  "new": (hir_id: HirId, ident: Ident, kind: LifetimeKind, source: gen.LifetimeSource, syntax: LifetimeSyntax) => Lifetime;
};

// rustc: compiler/rustc_hir/src/hir.rs:272 new
Lifetime.new = function (
  hir_id: HirId,
  ident: Ident,
  kind: LifetimeKind,
  source: gen.LifetimeSource,
  syntax: LifetimeSyntax,
): Lifetime {
  const lifetime = new gen.Lifetime(hir_id, ident, kind, source, syntax);

  // Sanity check: elided lifetimes form a strict subset of anonymous lifetimes.
  // #[cfg(debug_assertions)]
  // match (lifetime.is_elided(), lifetime.is_anonymous()) {
  //     (false, false) => {} // e.g. `'a`
  //     (false, true) => {}  // e.g. explicit `'_`
  //     (true, true) => {}   // e.g. `&x`
  //     (true, false) => panic!("bad Lifetime"),
  // }

  return lifetime;
};

// rustc: compiler/rustc_hir/src/hir.rs:293 is_elided
gen.Lifetime.prototype.is_elided = function (this: Lifetime): boolean {
  return LifetimeKind.is_elided(this.kind);
};

// rustc: compiler/rustc_hir/src/hir.rs:297 is_anonymous
gen.Lifetime.prototype.is_anonymous = function (this: Lifetime): boolean {
  return this.ident.name === kw.UnderscoreLifetime;
};

// rustc: compiler/rustc_hir/src/hir.rs:301 is_implicit
gen.Lifetime.prototype.is_implicit = function (this: Lifetime): boolean {
  return this.syntax === "Implicit";
};

// rustc: compiler/rustc_hir/src/hir.rs:305 is_static
gen.Lifetime.prototype.is_static = function (this: Lifetime): boolean {
  return this.kind.$ === "Static";
};

// rustc: compiler/rustc_hir/src/hir.rs:309 suggestion
gen.Lifetime.prototype.suggestion = function (this: Lifetime, new_lifetime: string): [Span, string] {
  // debug_assert!(new_lifetime.starts_with('\''));

  const syntax = this.syntax;
  const source = this.source;
  // The user wrote `'a` or `'_`.
  if (syntax === "ExplicitBound" || syntax === "ExplicitAnonymous") {
    return [this.ident.span, `${new_lifetime}`];
  }

  // The user wrote `Path<T>`, and omitted the `'_,`.
  if (syntax === "Implicit" && source.$ === "Path" && source.angle_brackets === "Full") {
    return [this.ident.span, `${new_lifetime}, `];
  }

  // The user wrote `Path<>`, and omitted the `'_`..
  if (syntax === "Implicit" && source.$ === "Path" && source.angle_brackets === "Empty") {
    return [this.ident.span, `${new_lifetime}`];
  }

  // The user wrote `Path` and omitted the `<'_>`.
  if (syntax === "Implicit" && source.$ === "Path" && source.angle_brackets === "Missing") {
    return [Span.shrink_to_hi(this.ident.span), `<${new_lifetime}>`];
  }

  // The user wrote `&type` or `&mut type`.
  if (syntax === "Implicit" && source.$ === "Reference") {
    return [this.ident.span, `${new_lifetime} `];
  }

  // (Implicit, source)
  return unreachable(
    `internal error: entered unreachable code: can't suggest for a implicit lifetime of ${debug_LifetimeSource(source, PLAIN)}`,
  );
};

// rustc: compiler/rustc_hir/src/hir.rs:360 is_global
gen.Path.prototype.is_global = function (this: gen.Path): boolean {
  const segment = this.segments[0];
  return segment !== undefined && segment.ident.name === kw.PathRoot;
};

export type PathSegment = PathSegmentT;
// PORT: statics of the generated class, attached below in upstream order.
export const PathSegment = gen.PathSegment as typeof gen.PathSegment & {
  "new": (ident: Ident, hir_id: HirId, res: Res) => PathSegment;
  invalid: () => PathSegment;
};

/// Converts an identifier to the corresponding segment.
// rustc: compiler/rustc_hir/src/hir.rs:396 new
PathSegment.new = function (ident: Ident, hir_id: HirId, res: Res): PathSegment {
  return new gen.PathSegment(
    ident,
    hir_id,
    res,
    /* args */ undefined,
    /* infer_args */ true,
    /* delegation_child_segment */ false,
  );
};

// rustc: compiler/rustc_hir/src/hir.rs:407 invalid
PathSegment.invalid = function (): PathSegment {
  return PathSegment.new(Ident.dummy(), HirId_INVALID, Res.Err);
};

// PORT: method `args` clashes with the field of the same name, hence `args_()`.
// rustc: compiler/rustc_hir/src/hir.rs:411 args
gen.PathSegment.prototype.args_ = function (this: PathSegment): GenericArgs {
  const args = this.args;
  if (args !== undefined) {
    return args;
  } else {
    return GenericArgs.NONE;
  }
};

export type ConstItemRhs = gen.ConstItemRhs;
export const ConstItemRhs = {
  // rustc: compiler/rustc_hir/src/hir.rs:423 hir_id
  hir_id(self: ConstItemRhs): HirId {
    switch (self.$) {
      case "Body":
        return self._0.hir_id;
      case "Direct":
        return self._0.hir_id;
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:430 span
  span(self: ConstItemRhs, tcx: HirTyCtxt): Span {
    switch (self.$) {
      case "Body":
        return tcx.hir_body(self._0).value.span;
      case "Direct":
        return self._0.span;
    }
  },
};

// PORT: `impl<'hir> ConstArg<'hir, AmbigArg>` -> the `ConstArgAmbig` companion
// (`ConstArgAmbig.as_unambig_ct(c)`): the prototype holds the `ConstArg<'hir>` impls.
export const ConstArgAmbig = {
  /// Converts a `ConstArg` in an ambiguous position to one in an unambiguous position.
  ///
  /// Functions accepting unambiguous consts may expect the [`ConstArgKind::Infer`] variant
  /// to be used. Care should be taken to separately handle infer consts when calling this
  /// function as it cannot be handled by downstream code making use of the returned const.
  ///
  /// In practice this may mean overriding the [`Visitor::visit_infer`][visit_infer] method on hir visitors, or
  /// specifically matching on [`GenericArg::Infer`] when handling generic arguments.
  ///
  /// [visit_infer]: [rustc_hir::intravisit::Visitor::visit_infer]
  // rustc: compiler/rustc_hir/src/hir.rs:471 as_unambig_ct
  as_unambig_ct(self: ConstArgT<AmbigArg>): ConstArgT {
    // SAFETY: `ConstArg` is `repr(C)` and `ConstArgKind` is marked `repr(u8)` so that the
    // layout is the same across different ZST type arguments.
    // PORT: the pointer cast is an identity cast (`AmbigArg` is uninhabited).
    return self as unknown as ConstArgT;
  },
};

/// Converts a `ConstArg` in an unambiguous position to one in an ambiguous position. This is
/// fallible as the [`ConstArgKind::Infer`] variant is not present in ambiguous positions.
///
/// Functions accepting ambiguous consts will not handle the [`ConstArgKind::Infer`] variant, if
/// infer consts are relevant to you then care should be taken to handle them separately.
// rustc: compiler/rustc_hir/src/hir.rs:485 try_as_ambig_ct
gen.ConstArg.prototype.try_as_ambig_ct = function (this: ConstArgT): ConstArgT<AmbigArg> | undefined {
  if (this.kind.$ === "Infer") {
    return undefined;
  }

  // SAFETY: `ConstArg` is `repr(C)` and `ConstArgKind` is marked `repr(u8)` so that the layout is
  // the same across different ZST type arguments. We also asserted that the `self` is
  // not a `ConstArgKind::Infer` so there is no risk of transmuting a `()` to `AmbigArg`.
  // PORT: the pointer cast is an identity cast (`AmbigArg` is uninhabited).
  return this as unknown as ConstArgT<AmbigArg>;
};

// rustc: compiler/rustc_hir/src/hir.rs:499 anon_const_hir_id
gen.ConstArg.prototype.anon_const_hir_id = function <Unambig>(this: ConstArgT<Unambig>): HirId | undefined {
  const kind = this.kind;
  if (kind.$ === "Anon") {
    return kind._0.hir_id;
  }
  return undefined;
};

// rustc: compiler/rustc_hir/src/hir.rs:570 to_ty
gen.InferArg.prototype.to_ty = function (this: gen.InferArg): Ty {
  return new gen.Ty<null>(this.hir_id, this.span, { $: "Infer", _0: null });
};

export type GenericArg = gen.GenericArg;
export const GenericArg = {
  // rustc: compiler/rustc_hir/src/hir.rs:593 span
  span(self: GenericArg): Span {
    switch (self.$) {
      case "Lifetime":
        return self._0.ident.span;
      case "Type":
        return self._0.span;
      case "Const":
        return self._0.span;
      case "Infer":
        return self._0.span;
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:602 hir_id
  hir_id(self: GenericArg): HirId {
    switch (self.$) {
      case "Lifetime":
        return self._0.hir_id;
      case "Type":
        return self._0.hir_id;
      case "Const":
        return self._0.hir_id;
      case "Infer":
        return self._0.hir_id;
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:611 descr
  descr(self: GenericArg): string {
    if (self.$ === "Lifetime") return "lifetime";
    if (self.$ === "Type") return "type";
    if (self.$ === "Const") return "constant";
    if (self.$ === "Infer" && self._0.kind === "TypeOrConst") return "placeholder";
    // GenericArg::Infer(InferArg { kind: InferArgKind::Const, .. })
    return "constant";
  },

  // rustc: compiler/rustc_hir/src/hir.rs:621 to_ord
  to_ord(self: GenericArg): ParamKindOrd {
    switch (self.$) {
      case "Lifetime":
        return ParamKindOrd.Lifetime;
      case "Type":
      case "Const":
      case "Infer":
        return ParamKindOrd.TypeOrConst;
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:630 is_ty_or_const
  is_ty_or_const(self: GenericArg): boolean {
    switch (self.$) {
      case "Lifetime":
        return false;
      case "Type":
      case "Const":
      case "Infer":
        return true;
    }
  },
};

export type GenericArgs = GenericArgsT;
// PORT: associated const of the generated class (a shared frozen value: `&'hir GenericArgs`).
export const GenericArgs = gen.GenericArgs as typeof gen.GenericArgs & {
  NONE: GenericArgs;
};
GenericArgs.NONE = Object.freeze(new gen.GenericArgs([], [], "No", DUMMY_SP));

/// Obtain the list of input types and the output type if the generic arguments are parenthesized.
///
/// Returns the `Ty0, Ty1, ...` and the `RetTy` in `Trait(Ty0, Ty1, ...) -> RetTy`.
/// Panics if the parenthesized arguments have an incorrect form (this shouldn't happen).
// rustc: compiler/rustc_hir/src/hir.rs:677 paren_sugar_inputs_output
gen.GenericArgs.prototype.paren_sugar_inputs_output = function (this: GenericArgs): [readonly Ty[], Ty] | undefined {
  if (this.parenthesized !== "ParenSugar") {
    return undefined;
  }

  let found: readonly Ty[] | undefined;
  for (const arg of this.args) {
    if (arg.$ !== "Type") continue;
    const ty = arg._0;
    if (ty.kind.$ !== "Tup") continue;
    found = ty.kind._0;
    break;
  }
  const inputs = unwrap(found);

  return [inputs, this.paren_sugar_output_inner()];
};

/// Obtain the output type if the generic arguments are parenthesized.
///
/// Returns the `RetTy` in `Trait(Ty0, Ty1, ...) -> RetTy`.
/// Panics if the parenthesized arguments have an incorrect form (this shouldn't happen).
// rustc: compiler/rustc_hir/src/hir.rs:699 paren_sugar_output
gen.GenericArgs.prototype.paren_sugar_output = function (this: GenericArgs): Ty | undefined {
  return this.parenthesized === "ParenSugar" ? this.paren_sugar_output_inner() : undefined;
};

// rustc: compiler/rustc_hir/src/hir.rs:704 paren_sugar_output_inner
gen.GenericArgs.prototype.paren_sugar_output_inner = function (this: GenericArgs): Ty {
  // let [constraint] = self.constraints.try_into().unwrap();
  if (this.constraints.length !== 1) {
    return panic("called `Result::unwrap()` on an `Err` value: TryFromSliceError(())");
  }
  const constraint = this.constraints[0]!;
  // debug_assert_eq!(constraint.ident.name, sym::Output);
  return unwrap(constraint.ty());
};

// rustc: compiler/rustc_hir/src/hir.rs:710 has_err
gen.GenericArgs.prototype.has_err = function (this: GenericArgs): ErrorGuaranteed | undefined {
  for (const arg of this.args) {
    if (arg.$ !== "Type") continue;
    const ty = arg._0;
    if (ty.kind.$ !== "Err") continue;
    return ty.kind._0;
  }
  for (const constraint of this.constraints) {
    const ty = constraint.ty();
    if (ty === undefined) continue;
    if (ty.kind.$ !== "Err") continue;
    return ty.kind._0;
  }
  return undefined;
};

// rustc: compiler/rustc_hir/src/hir.rs:727 num_lifetime_args
gen.GenericArgs.prototype.num_lifetime_args = function (this: GenericArgs): number {
  return this.args.filter((arg) => arg.$ === "Lifetime").length;
};

// rustc: compiler/rustc_hir/src/hir.rs:732 has_lifetime_args
gen.GenericArgs.prototype.has_lifetime_args = function (this: GenericArgs): boolean {
  return this.args.some((arg) => arg.$ === "Lifetime");
};

/// This function returns the number of type and const generic params.
/// It should only be used for diagnostics.
// rustc: compiler/rustc_hir/src/hir.rs:739 num_generic_params
gen.GenericArgs.prototype.num_generic_params = function (this: GenericArgs): number {
  return this.args.filter((arg) => !(arg.$ === "Lifetime")).length;
};

/// The span encompassing the arguments and constraints[^1] inside the surrounding brackets.
///
/// Returns `None` if the span is empty (i.e., no brackets) or dummy.
///
/// [^1]: Unless of the form `-> Ty` (see [`GenericArgsParentheses`]).
// rustc: compiler/rustc_hir/src/hir.rs:748 span
gen.GenericArgs.prototype.span = function (this: GenericArgs): Span | undefined {
  const span_ext = this.span_ext_();
  if (span_ext === undefined) return undefined;
  return Span.with_hi(
    Span.with_lo(span_ext, BytePos(Span.lo(span_ext) + 1)),
    BytePos(Span.hi(span_ext) - 1),
  );
};

/// Returns span encompassing arguments and their surrounding `<>` or `()`
// PORT: method `span_ext` clashes with the field of the same name, hence `span_ext_()`.
// rustc: compiler/rustc_hir/src/hir.rs:754 span_ext
gen.GenericArgs.prototype.span_ext_ = function (this: GenericArgs): Span | undefined {
  const span = this.span_ext;
  return !Span.is_empty(span) ? span : undefined;
};

// rustc: compiler/rustc_hir/src/hir.rs:758 is_empty
gen.GenericArgs.prototype.is_empty = function (this: GenericArgs): boolean {
  return this.args.length === 0;
};

/// The modifiers on a trait bound.
export type TraitBoundModifiers = gen.TraitBoundModifiers;
// PORT: `NONE` is a shared associated const, frozen so no caller can edit it in place.
export const TraitBoundModifiers: { NONE: TraitBoundModifiers } = {
  NONE: Object.freeze({ constness: BoundConstness.Never, polarity: BoundPolarity.Positive }),
};

export type GenericBound = GenericBoundT;
export const GenericBound = {
  // rustc: compiler/rustc_hir/src/hir.rs:793 trait_ref
  trait_ref(self: GenericBound): TraitRef | undefined {
    switch (self.$) {
      case "Trait":
        return self._0.trait_ref;
      default:
        return undefined;
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:800 span
  span(self: GenericBound): Span {
    switch (self.$) {
      case "Trait":
        return self._0.span;
      case "Outlives":
        return self._0.ident.span;
      case "Use":
        return self._1;
    }
  },
};

/// Synthetic type-parameters are inserted after normal ones.
/// In order for normal parameters to be able to refer to synthetic ones,
/// scans them first.
// rustc: compiler/rustc_hir/src/hir.rs:871 is_impl_trait
gen.GenericParam.prototype.is_impl_trait = function (this: GenericParam): boolean {
  return this.kind.$ === "Type" && this.kind.synthetic === true;
};

/// This can happen for `async fn`, e.g. `async fn f<'_>(&'_ self)`.
///
/// See `lifetime_to_generic_param` in `rustc_ast_lowering` for more information.
// rustc: compiler/rustc_hir/src/hir.rs:878 is_elided_lifetime
gen.GenericParam.prototype.is_elided_lifetime = function (this: GenericParam): boolean {
  return this.kind.$ === "Lifetime" && this.kind.kind.$ === "Elided";
};

// rustc: compiler/rustc_hir/src/hir.rs:882 is_lifetime
gen.GenericParam.prototype.is_lifetime = function (this: GenericParam): boolean {
  return this.kind.$ === "Lifetime";
};

export type Generics = GenericsT;
// PORT: statics of the generated class, attached below in upstream order.
export const Generics = gen.Generics as typeof gen.Generics & {
  empty: () => Generics;
};

// PORT: `const NOPE` inside `Generics::empty`, promoted to a static by `&NOPE`: one shared frozen value.
const NOPE: Generics = Object.freeze(new gen.Generics([], [], false, DUMMY_SP, DUMMY_SP));

// rustc: compiler/rustc_hir/src/hir.rs:921 empty
Generics.empty = function (): Generics {
  return NOPE;
};

// rustc: compiler/rustc_hir/src/hir.rs:932 get_named
gen.Generics.prototype.get_named = function (this: Generics, name: Symbol): GenericParam | undefined {
  return this.params.find((param) => name === ParamName.ident(param.name).name);
};

/// If there are generic parameters, return where to introduce a new one.
// rustc: compiler/rustc_hir/src/hir.rs:937 span_for_lifetime_suggestion
gen.Generics.prototype.span_for_lifetime_suggestion = function (this: Generics): Span | undefined {
  const first = this.params[0];
  if (first !== undefined && Span.contains(this.span, first.span)) {
    // `fn foo<A>(t: impl Trait)`
    //         ^ suggest `'a, ` here
    return Span.shrink_to_lo(first.span);
  } else {
    return undefined;
  }
};

/// If there are generic parameters, return where to introduce a new one.
// rustc: compiler/rustc_hir/src/hir.rs:950 span_for_param_suggestion
gen.Generics.prototype.span_for_param_suggestion = function (this: Generics): Span | undefined {
  if (this.params.some((p) => Span.contains(this.span, p.span))) {
    // `fn foo<A>(t: impl Trait)`
    //          ^ suggest `, T: Trait` here
    return Span.shrink_to_lo(Span.with_lo(this.span, BytePos(Span.hi(this.span) - 1)));
  }
  return undefined;
};

/// `Span` where further predicates would be suggested, accounting for trailing commas, like
///  in `fn foo<T>(t: T) where T: Foo,` so we don't suggest two trailing commas.
// rustc: compiler/rustc_hir/src/hir.rs:960 tail_span_for_predicate_suggestion
gen.Generics.prototype.tail_span_for_predicate_suggestion = function (this: Generics): Span {
  const end = Span.shrink_to_hi(this.where_clause_span);
  if (this.has_where_clause_predicates) {
    const p = this.predicates.findLast((p) => WherePredicateKind.in_where_clause(p.kind));
    return Span.to(Span.shrink_to_hi(p === undefined ? end : p.span), end);
  } else {
    return end;
  }
};

// rustc: compiler/rustc_hir/src/hir.rs:974 add_where_or_trailing_comma
gen.Generics.prototype.add_where_or_trailing_comma = function (this: Generics): string {
  if (this.has_where_clause_predicates) {
    return ",";
  } else if (Span.is_empty(this.where_clause_span)) {
    return " where";
  } else {
    // No where clause predicates, but we have `where` token
    return "";
  }
};

// PORT: `impl Iterator` -> an array (the filter has no side effects).
// rustc: compiler/rustc_hir/src/hir.rs:985 bounds_for_param
gen.Generics.prototype.bounds_for_param = function (this: Generics, param_def_id: LocalDefId): WhereBoundPredicate[] {
  const out: WhereBoundPredicate[] = [];
  for (const pred of this.predicates) {
    const kind = pred.kind;
    if (kind.$ === "BoundPredicate" && kind._0.is_param_bound(LocalDefId.to_def_id(param_def_id))) {
      out.push(kind._0);
    }
  }
  return out;
};

// PORT: `impl Iterator` -> an array (the filter has no side effects).
// rustc: compiler/rustc_hir/src/hir.rs:999 outlives_for_param
gen.Generics.prototype.outlives_for_param = function (this: Generics, param_def_id: LocalDefId): WhereRegionPredicate[] {
  const out: WhereRegionPredicate[] = [];
  for (const pred of this.predicates) {
    const kind = pred.kind;
    if (kind.$ === "RegionPredicate" && kind._0.is_param_bound(param_def_id)) {
      out.push(kind._0);
    }
  }
  return out;
};

/// Returns a suggestable empty span right after the "final" bound of the generic parameter.
///
/// If that bound needs to be wrapped in parentheses to avoid ambiguity with
/// subsequent bounds, it also returns an empty span for an open parenthesis
/// as the second component.
///
/// E.g., adding `+ 'static` after `Fn() -> dyn Future<Output = ()>` or
/// `Fn() -> &'static dyn Debug` requires parentheses:
/// `Fn() -> (dyn Future<Output = ()>) + 'static` and
/// `Fn() -> &'static (dyn Debug) + 'static`, respectively.
// rustc: compiler/rustc_hir/src/hir.rs:1019 bounds_span_for_suggestions
gen.Generics.prototype.bounds_span_for_suggestions = function (
  this: Generics,
  param_def_id: LocalDefId,
): [Span, Span | undefined] | undefined {
  // PORT: `flat_map(..rev()).find_map(..)` -> nested loops, lazy like upstream (stops at the first `Some`).
  for (const bp of this.bounds_for_param(param_def_id)) {
    for (let i = bp.bounds.length - 1; i >= 0; i--) {
      const bound = bp.bounds[i]!;
      let span_for_parentheses: Span | undefined = undefined;
      const trait_ref = GenericBound.trait_ref(bound);
      if (trait_ref !== undefined) {
        const segments = trait_ref.path.segments;
        const segment = segments[segments.length - 1];
        if (segment !== undefined) {
          const ret_ty0 = segment.args_().paren_sugar_output();
          if (ret_ty0 !== undefined) {
            const ret_ty: Ty = ret_ty0.peel_refs();
            if (
              ret_ty.kind.$ === "TraitObject" &&
              ret_ty.kind._1.tag() === TraitObjectSyntax.Dyn &&
              Span.can_be_used_for_suggestions(ret_ty.span)
            ) {
              span_for_parentheses = ret_ty.span;
            }
          }
        }
      }

      let r: [Span, Span | undefined] | undefined;
      if (span_for_parentheses === undefined) {
        // We include bounds that come from a `#[derive(_)]` but point at the user's
        // code, as we use this method to get a span appropriate for suggestions.
        const bs = GenericBound.span(bound);
        // We use `from_expansion` instead of `can_be_used_for_suggestions` because
        // the trait bound from imperfect derives do point at the type parameter,
        // but expanded to a where clause, so we want to ignore those. This is only
        // true for derive intrinsics.
        r = !Span.from_expansion(bs) ? [Span.shrink_to_hi(bs), undefined] : undefined;
      } else {
        const span = span_for_parentheses;
        r = [Span.shrink_to_hi(span), Span.shrink_to_lo(span)];
      }
      if (r !== undefined) return r;
    }
  }
  return undefined;
};

// rustc: compiler/rustc_hir/src/hir.rs:1055 span_for_predicate_removal
gen.Generics.prototype.span_for_predicate_removal = function (this: Generics, pos: number): Span {
  const predicate = this.predicates[pos]!;
  const span = predicate.span;

  if (!WherePredicateKind.in_where_clause(predicate.kind)) {
    // <T: ?Sized, U>
    //   ^^^^^^^^
    return span;
  }

  // We need to find out which comma to remove.
  if (pos < this.predicates.length - 1) {
    const next_pred = this.predicates[pos + 1]!;
    if (WherePredicateKind.in_where_clause(next_pred.kind)) {
      // where T: ?Sized, Foo: Bar,
      //       ^^^^^^^^^^^
      return Span.until(span, next_pred.span);
    }
  }

  if (pos > 0) {
    const prev_pred = this.predicates[pos - 1]!;
    if (WherePredicateKind.in_where_clause(prev_pred.kind)) {
      // where Foo: Bar, T: ?Sized,
      //               ^^^^^^^^^^^
      return Span.to(Span.shrink_to_hi(prev_pred.span), span);
    }
  }

  // This is the only predicate in the where clause.
  // where T: ?Sized
  // ^^^^^^^^^^^^^^^
  return this.where_clause_span;
};

// rustc: compiler/rustc_hir/src/hir.rs:1090 span_for_bound_removal
gen.Generics.prototype.span_for_bound_removal = function (this: Generics, predicate_pos: number, bound_pos: number): Span {
  const predicate = this.predicates[predicate_pos]!;
  const bounds = WherePredicateKind.bounds(predicate.kind);

  if (bounds.length === 1) {
    return this.span_for_predicate_removal(predicate_pos);
  }

  const bound_span = GenericBound.span(bounds[bound_pos]!);
  if (bound_pos < bounds.length - 1) {
    // If there's another bound after the current bound
    // include the following '+' e.g.:
    //
    //  `T: Foo + CurrentBound + Bar`
    //            ^^^^^^^^^^^^^^^
    return Span.to(bound_span, Span.shrink_to_lo(GenericBound.span(bounds[bound_pos + 1]!)));
  } else {
    // If the current bound is the last bound
    // include the preceding '+' E.g.:
    //
    //  `T: Foo + Bar + CurrentBound`
    //               ^^^^^^^^^^^^^^^
    return Span.with_lo(bound_span, Span.hi(GenericBound.span(bounds[bound_pos - 1]!)));
  }
};

/// Computes the span representing the removal of a generic parameter at `param_index`.
///
/// This function identifies the correct slice of source code to delete so that the
/// remaining generic list remains syntactically valid (handling commas and brackets).
///
/// ### Examples
///
/// 1. **With a following parameter:** (Includes the trailing comma)
///    - Input: `<T, U>` (index 0)
///    - Produces span for: `T, `
///
/// 2. **With a previous parameter:** (Includes the leading comma and bounds)
///    - Input: `<T: Clone, U>` (index 1)
///    - Produces span for: `, U`
///
/// 3. **The only parameter:** (Includes the angle brackets)
///    - Input: `<T>` (index 0)
///    - Produces span for: `<T>`
///
/// 4. **Parameter with where-clause bounds:**
///    - Input: `fn foo<T, U>() where T: Copy` (index 0)
///    - Produces span for: `T, ` (The where-clause remains for other logic to handle).
// rustc: compiler/rustc_hir/src/hir.rs:1138 span_for_param_removal
gen.Generics.prototype.span_for_param_removal = function (this: Generics, param_index: number): Span {
  if (param_index >= this.params.length) {
    return Span.shrink_to_hi(this.span);
  }

  const is_param_explicit = (par: GenericParam): boolean => {
    const kind = par.kind;
    if (kind.$ === "Type" || kind.$ === "Const" || (kind.$ === "Lifetime" && kind.kind.$ === "Explicit")) {
      return true;
    }
    return false;
  };

  // Find the span of the type parameter.
  const next = this.params.slice(param_index + 1).find(is_param_explicit);
  if (next !== undefined) {
    return Span.until(this.params[param_index]!.span, next.span);
  }
  const prev = this.params.slice(0, param_index).findLast(is_param_explicit);
  if (prev !== undefined) {
    let prev_span = prev.span;
    // Consider the span of the bounds with the previous generic parameter when there is.
    const prev_bounds_span = this.span_for_param_bounds(prev);
    if (prev_bounds_span !== undefined) {
      prev_span = Span.to(prev_span, prev_bounds_span);
    }

    // Consider the span of the bounds with the current generic parameter when there is.
    const cur_bounds_span = this.span_for_param_bounds(this.params[param_index]!);
    return Span.to(
      Span.shrink_to_hi(prev_span),
      cur_bounds_span !== undefined ? cur_bounds_span : this.params[param_index]!.span,
    );
  } else {
    // Remove also angle brackets <> when there is just ONE generic parameter.
    return this.span;
  }
};

/// Returns the span of the `WherePredicate` associated with the given `GenericParam`, if any.
///
/// This looks specifically for predicates in the `where` clause that were generated
/// from the parameter definition (e.g., `T` in `where T: Bound`).
///
/// ### Example
///
/// - Input: `param` representing `T`
/// - Context: `where T: Clone + Default, U: Copy`
/// - Returns: Span of `T: Clone + Default`
// rustc: compiler/rustc_hir/src/hir.rs:1185 span_for_param_bounds
gen.Generics.prototype.span_for_param_bounds = function (this: Generics, param: GenericParam): Span | undefined {
  const pred = this.predicates.find((pred) => {
    const kind = pred.kind;
    if (kind.$ === "BoundPredicate" && kind._0.origin === "GenericParam") {
      const bounded_ty = kind._0.bounded_ty;
      return bounded_ty.span === param.span;
    } else {
      return false;
    }
  });
  return pred === undefined ? undefined : pred.span;
};

export type WherePredicateKind = WherePredicateKindT;
export const WherePredicateKind = {
  // rustc: compiler/rustc_hir/src/hir.rs:1223 in_where_clause
  in_where_clause(self: WherePredicateKind): boolean {
    switch (self.$) {
      case "BoundPredicate":
        return self._0.origin === "WhereClause";
      case "RegionPredicate":
        return self._0.in_where_clause;
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:1230 bounds
  bounds(self: WherePredicateKind): gen.GenericBounds {
    switch (self.$) {
      case "BoundPredicate":
        return self._0.bounds;
      case "RegionPredicate":
        return self._0.bounds;
    }
  },
};

/// Returns `true` if `param_def_id` matches the `bounded_ty` of this predicate.
// rustc: compiler/rustc_hir/src/hir.rs:1260 is_param_bound
gen.WhereBoundPredicate.prototype.is_param_bound = function (this: WhereBoundPredicate, param_def_id: DefId): boolean {
  const r = this.bounded_ty.as_generic_param();
  return r !== undefined && DefId_eq(r[0], param_def_id);
};

/// Returns `true` if `param_def_id` matches the `lifetime` of this predicate.
// rustc: compiler/rustc_hir/src/hir.rs:1275 is_param_bound
gen.WhereRegionPredicate.prototype.is_param_bound = function (this: WhereRegionPredicate, param_def_id: LocalDefId): boolean {
  return this.lifetime.kind.$ === "Param" && this.lifetime.kind._0 === param_def_id;
};

export type AttributeMap = gen.AttributeMap;
// PORT: associated const of the generated class.
export const AttributeMap = gen.AttributeMap as typeof gen.AttributeMap & {
  EMPTY: AttributeMap;
};
// PORT: `SortedMap::new()` -> `SortedMap.default()` (the stand-in SortedMap has no `new`; both are empty).
AttributeMap.EMPTY = Object.freeze(new gen.AttributeMap(SortedMap.default(), undefined, Fingerprint.ZERO));

// rustc: compiler/rustc_hir/src/hir.rs:1314 get
gen.AttributeMap.prototype.get = function (this: AttributeMap, id: ItemLocalId): readonly Attribute[] {
  const v = this.map.get(id);
  return v !== undefined ? v : [];
};

export type OwnerNodes = gen.OwnerNodes;
// PORT: statics of the generated class, attached below in upstream order.
export const OwnerNodes = gen.OwnerNodes as typeof gen.OwnerNodes & {
  synthetic: () => OwnerNodes;
};

// rustc: compiler/rustc_hir/src/hir.rs:1336 node
gen.OwnerNodes.prototype.node = function (this: OwnerNodes): OwnerNode {
  // Indexing must ensure it is an OwnerNode.
  return unwrap(Node.as_owner(this.nodes[ItemLocalId.ZERO]!.node));
};

/// Return an instance of `OwnerNodes` suitable for definitions that have no corresponding AST.
// rustc: compiler/rustc_hir/src/hir.rs:1342 synthetic
OwnerNodes.synthetic = function (): OwnerNodes {
  const elem: ParentedNode = { parent: ItemLocalId.INVALID, node: Node.from_OwnerNode(gen.OwnerNode.Synthetic) };
  return new gen.OwnerNodes(
    // There is no reason to bother computing a hash for a synthetic body.
    // Just use a constant value.
    Fingerprint.ZERO,
    // PORT: `IndexVec::from_elem_n(elem, 1)`.
    [elem],
    SortedMap.default(),
  );
};

// rustc: compiler/rustc_hir/src/hir.rs:1405 node
gen.OwnerInfo.prototype.node = function (this: gen.OwnerInfo): OwnerNode {
  return this.nodes.node();
};

// A fingerprint that identifies the contents of the OwnerInfo.
// It only depends on `nodes` and `attrs` because `parenting` and `trait_map` are
// deterministically calculated from `nodes` and `attrs`.
// rustc: compiler/rustc_hir/src/hir.rs:1413 fingerprint
gen.OwnerInfo.prototype.fingerprint = function (this: gen.OwnerInfo): Fingerprint {
  const body = unwrap(this.nodes.opt_hash, "HIR hash requested without needs_hir_hash");
  const attrs = unwrap(this.attrs.opt_hash, "HIR hash requested without needs_hir_hash");
  return Fingerprint.combine(body, attrs);
};

export type MaybeOwner = gen.MaybeOwner;
export const MaybeOwner = {
  // rustc: compiler/rustc_hir/src/hir.rs:1428 as_owner
  as_owner(self: MaybeOwner): gen.OwnerInfo | undefined {
    switch (self.$) {
      case "Owner":
        return self._0;
      case "NonOwner":
        return undefined;
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:1436 unwrap
  unwrap(self: MaybeOwner): gen.OwnerInfo {
    const v = MaybeOwner.as_owner(self);
    return v !== undefined ? v : panic("Not a HIR owner");
  },
};

// rustc: compiler/rustc_hir/src/hir.rs:1504 innermost_block
gen.Block.prototype.innermost_block = function (this: gen.Block): gen.Block {
  let block: gen.Block = this;
  for (;;) {
    const expr = block.expr;
    if (expr !== undefined && expr.kind.$ === "Block") {
      block = expr.kind._0;
    } else {
      break;
    }
  }
  return block;
};

// ---- hir.rs lines 1538-3328 -------------------------------------------------------------

declare module "./hir_standin.ts" {
  interface Pat {
    walk_short_(it: (p: Pat) => boolean): boolean;
    walk_short(it: (p: Pat) => boolean): boolean;
    walk_(it: (p: Pat) => boolean): void;
    walk(it: (p: Pat) => boolean): void;
    walk_always(it: (p: Pat) => void): void;
    is_never_pattern(): boolean;
    is_guaranteed_to_constitute_read_for_never(): boolean;
  }
  interface DotDotPos {
    as_opt_usize(): number | undefined;
  }
  interface Body {
    id(): BodyId;
  }
  interface Expr {
    precedence(has_attr: (hir_id: HirId) => boolean): ExprPrecedence;
    is_syntactic_place_expr(): boolean;
    is_place_expr(allow_projections_from: (e: Expr) => boolean): boolean;
    range_span(): Span | undefined;
    is_size_lit(): boolean;
    peel_drop_temps(): Expr;
    peel_blocks(): Expr;
    peel_borrows(): Expr;
    can_have_side_effects(): boolean;
    is_approximately_pattern(): boolean;
    equivalent_for_indexing(other: Expr): boolean;
    method_ident(): Ident | undefined;
  }
  interface TraitItemId {
    hir_id(): HirId;
  }
  interface TraitItem {
    hir_id(): HirId;
    trait_item_id(): TraitItemId;
    expect_const(): [Ty, ConstItemRhs | undefined];
    expect_fn(): [FnSig, TraitFn];
    expect_type(): [GenericBounds, Ty | undefined];
  }
  interface ImplItemId {
    hir_id(): HirId;
  }
  interface ImplItem {
    hir_id(): HirId;
    impl_item_id(): ImplItemId;
    vis_span(): Span | undefined;
    expect_const(): [Ty, ConstItemRhs];
    expect_fn(): [FnSig, BodyId];
    expect_type(): Ty;
  }
  interface AssocItemConstraint {
    ty(): Ty | undefined;
    ct(): ConstArg | undefined;
  }
  // `impl<'hir> Ty<'hir>` (Unambig = `()`); the `impl Ty<'hir, AmbigArg>` fns are on `TyAmbig`.
  interface Ty<Unambig> {
    try_as_ambig_ty(this: Ty): Ty<AmbigArg> | undefined;
    peel_refs(this: Ty): Ty;
    as_generic_param(this: Ty): [DefId, Ident] | undefined;
    find_self_aliases(this: Ty): Span[];
    is_suggestable_infer_ty(this: Ty): boolean;
  }
}

// rustc: compiler/rustc_hir/src/hir.rs:1539 walk_short_
gen.Pat.prototype.walk_short_ = function (this: Pat, it: (p: Pat) => boolean): boolean {
  if (!it(this)) {
    return false;
  }

  const kind = this.kind;
  switch (kind.$) {
    case "Missing":
      return unreachable();
    case "Wild":
    case "Never":
    case "Expr":
    case "Range":
    case "Err":
      return true;
    case "Binding":
      if (kind._3 === undefined) {
        return true;
      }
      return kind._3.walk_short_(it);
    case "Deref":
    case "Ref":
    case "Guard":
      return kind._0.walk_short_(it);
    case "Struct":
      return kind._1.every((field) => field.pat.walk_short_(it));
    case "TupleStruct":
      return kind._1.every((p) => p.walk_short_(it));
    case "Tuple":
    case "Or":
      return kind._0.every((p) => p.walk_short_(it));
    case "Slice": {
      const [before, slice, after] = [kind._0, kind._1, kind._2];
      return [...before, ...(slice !== undefined ? [slice] : []), ...after].every((p) => p.walk_short_(it));
    }
  }
};

/// Walk the pattern in left-to-right order,
/// short circuiting (with `.all(..)`) if `false` is returned.
///
/// Note that when visiting e.g. `Tuple(ps)`,
/// if visiting `ps[0]` returns `false`,
/// then `ps[1]` will not be visited.
// rustc: compiler/rustc_hir/src/hir.rs:1563 walk_short
gen.Pat.prototype.walk_short = function (this: Pat, it: (p: Pat) => boolean): boolean {
  return this.walk_short_(it);
};

// rustc: compiler/rustc_hir/src/hir.rs:1567 walk_
gen.Pat.prototype.walk_ = function (this: Pat, it: (p: Pat) => boolean): void {
  if (!it(this)) {
    return;
  }

  const kind = this.kind;
  switch (kind.$) {
    case "Missing":
    case "Wild":
    case "Never":
    case "Expr":
    case "Range":
    case "Err":
      break;
    case "Binding":
      if (kind._3 !== undefined) {
        kind._3.walk_(it);
      }
      break;
    case "Deref":
    case "Ref":
    case "Guard":
      kind._0.walk_(it);
      break;
    case "Struct":
      kind._1.forEach((field) => field.pat.walk_(it));
      break;
    case "TupleStruct":
      kind._1.forEach((p) => p.walk_(it));
      break;
    case "Tuple":
    case "Or":
      kind._0.forEach((p) => p.walk_(it));
      break;
    case "Slice": {
      const [before, slice, after] = [kind._0, kind._1, kind._2];
      [...before, ...(slice !== undefined ? [slice] : []), ...after].forEach((p) => p.walk_(it));
      break;
    }
  }
};

/// Walk the pattern in left-to-right order.
///
/// If `it(pat)` returns `false`, the children are not visited.
// rustc: compiler/rustc_hir/src/hir.rs:1587 walk
gen.Pat.prototype.walk = function (this: Pat, it: (p: Pat) => boolean): void {
  this.walk_(it);
};

/// Walk the pattern in left-to-right order.
///
/// If you always want to recurse, prefer this method over `walk`.
// rustc: compiler/rustc_hir/src/hir.rs:1594 walk_always
gen.Pat.prototype.walk_always = function (this: Pat, it: (p: Pat) => void): void {
  this.walk((p) => {
    it(p);
    return true;
  });
};

/// Whether this a never pattern.
// rustc: compiler/rustc_hir/src/hir.rs:1602 is_never_pattern
gen.Pat.prototype.is_never_pattern = function (this: Pat): boolean {
  let is_never_pattern = false;
  this.walk((pat) => {
    const kind = pat.kind;
    switch (kind.$) {
      case "Never":
        is_never_pattern = true;
        return false;
      case "Or":
        is_never_pattern = kind._0.every((p) => p.is_never_pattern());
        return false;
      default:
        return true;
    }
  });
  return is_never_pattern;
};

/// Whether this pattern constitutes a read of value of the scrutinee that
/// it is matching against. This is used to determine whether we should
/// perform `NeverToAny` coercions.
///
/// See [`expr_guaranteed_to_constitute_read_for_never`][m] for the nuances of
/// what happens when this returns true.
///
/// [m]: ../../rustc_middle/ty/struct.TyCtxt.html#method.expr_guaranteed_to_constitute_read_for_never
// rustc: compiler/rustc_hir/src/hir.rs:1626 is_guaranteed_to_constitute_read_for_never
gen.Pat.prototype.is_guaranteed_to_constitute_read_for_never = function (this: Pat): boolean {
  const kind = this.kind;
  switch (kind.$) {
    // Does not constitute a read.
    case "Wild":
      return false;

    // The guard cannot affect if we make a read or not (it runs after the inner pattern
    // has matched), therefore it's irrelevant.
    case "Guard":
      return kind._0.is_guaranteed_to_constitute_read_for_never();

    // This is unnecessarily restrictive when the pattern that doesn't
    // constitute a read is unreachable.
    //
    // For example `match *never_ptr { value => {}, _ => {} }` or
    // `match *never_ptr { _ if false => {}, value => {} }`.
    //
    // It is however fine to be restrictive here; only returning `true`
    // can lead to unsoundness.
    case "Or":
      return kind._0.every((pat) => pat.is_guaranteed_to_constitute_read_for_never());

    // Does constitute a read, since it is equivalent to a discriminant read.
    case "Never":
      return true;

    // All of these constitute a read, or match on something that isn't `!`,
    // which would require a `NeverToAny` coercion.
    case "Missing":
    case "Binding":
    case "Struct":
    case "TupleStruct":
    case "Tuple":
    case "Ref":
    case "Deref":
    case "Expr":
    case "Range":
    case "Slice":
    case "Err":
      return true;
  }
};

// rustc: compiler/rustc_hir/src/hir.rs:1691 fmt
export function display_RangeEnd(v: gen.RangeEnd): string {
  switch (v) {
    case "Included":
      return "..=";
    case "Excluded":
      return "..";
  }
}

// PORT: `u32::MAX`, the `None` niche of `DotDotPos`.
const U32_MAX = 4294967295;

export type DotDotPos = gen.DotDotPos;
export const DotDotPos = gen.DotDotPos as typeof gen.DotDotPos & {
  "new": (n: number | undefined) => DotDotPos;
};

/// Panics if n >= u32::MAX.
// rustc: compiler/rustc_hir/src/hir.rs:1707 new
DotDotPos.new = function (n: number | undefined): DotDotPos {
  if (n !== undefined) {
    assert(n < U32_MAX, "assertion failed: n < u32::MAX as usize");
    return new gen.DotDotPos(n);
  } else {
    return new gen.DotDotPos(U32_MAX);
  }
};

// rustc: compiler/rustc_hir/src/hir.rs:1717 as_opt_usize
gen.DotDotPos.prototype.as_opt_usize = function (this: DotDotPos): number | undefined {
  if (this._0 === U32_MAX) {
    return undefined;
  } else {
    return this._0;
  }
};

// (hir.rs:1723 `impl fmt::Debug for DotDotPos` is lane hir-types'.)

// rustc: compiler/rustc_hir/src/hir.rs:1964 id
gen.Body.prototype.id = function (this: Body): BodyId {
  return { hir_id: this.value.hir_id };
};

/// The type of source expression that caused this coroutine to be created.
export type CoroutineKind = gen.CoroutineKind;
export const CoroutineKind = {
  // rustc: compiler/rustc_hir/src/hir.rs:1980 movability
  movability(self: CoroutineKind): Movability {
    if (self.$ === "Desugared" && (self._0 === "Async" || self._0 === "AsyncGen")) {
      return "Static";
    } else if (self.$ === "Desugared" && self._0 === "Gen") {
      return "Movable";
    } else if (self.$ === "Coroutine") {
      return self._0;
    }
    return unreachable();
  },

  // rustc: compiler/rustc_hir/src/hir.rs:1989 is_fn_like
  is_fn_like(self: CoroutineKind): boolean {
    return self.$ === "Desugared" && self._1 === "Fn";
  },

  // rustc: compiler/rustc_hir/src/hir.rs:1993 is_async_desugaring
  is_async_desugaring(self: CoroutineKind): boolean {
    return self.$ === "Desugared" && (self._0 === "Async" || self._0 === "AsyncGen");
  },

  // rustc: compiler/rustc_hir/src/hir.rs:2000 to_plural_string
  to_plural_string(self: CoroutineKind): string {
    if (self.$ === "Desugared" && self._1 === "Fn") {
      return `${display_CoroutineDesugaring(self._0, PRETTY)}fn bodies`;
    } else if (self.$ === "Desugared" && self._1 === "Block") {
      return `${display_CoroutineDesugaring(self._0, PRETTY)}blocks`;
    } else if (self.$ === "Desugared" && self._1 === "Closure") {
      return `${display_CoroutineDesugaring(self._0, PRETTY)}closure bodies`;
    } else if (self.$ === "Coroutine") {
      return "coroutines";
    }
    return unreachable();
  },
};

// PORT: `f` carries the formatter's `alternate` flag (`{:#}`), which `CoroutineDesugaring`'s Display reads.
// rustc: compiler/rustc_hir/src/hir.rs:2011 fmt
export function display_CoroutineKind(v: CoroutineKind, f: Fmt = PLAIN): string {
  switch (v.$) {
    case "Desugared": {
      const [d, k] = [v._0, v._1];
      return display_CoroutineDesugaring(d, f) + display_CoroutineSource(k);
    }
    case "Coroutine":
      return "coroutine";
  }
}

// rustc: compiler/rustc_hir/src/hir.rs:2040 fmt
export function display_CoroutineSource(v: gen.CoroutineSource): string {
  switch (v) {
    case "Block":
      return "block";
    case "Closure":
      return "closure body";
    case "Fn":
      return "fn body";
  }
}

// PORT: `f.alternate()` is `f.alternate` (`{:#}` passes PRETTY).
// rustc: compiler/rustc_hir/src/hir.rs:2064 fmt
export function display_CoroutineDesugaring(v: gen.CoroutineDesugaring, f: Fmt = PLAIN): string {
  let out = "";
  switch (v) {
    case "Async":
      if (f.alternate) {
        out += "`async` ";
      } else {
        out += "async ";
      }
      break;
    case "Gen":
      if (f.alternate) {
        out += "`gen` ";
      } else {
        out += "gen ";
      }
      break;
    case "AsyncGen":
      if (f.alternate) {
        out += "`async gen` ";
      } else {
        out += "async gen ";
      }
      break;
  }

  return out;
}

export type BodyOwnerKind = gen.BodyOwnerKind;
export const BodyOwnerKind = {
  ...gen.BodyOwnerKind,

  // rustc: compiler/rustc_hir/src/hir.rs:2112 is_fn_or_closure
  is_fn_or_closure(self: BodyOwnerKind): boolean {
    switch (self.$) {
      case "Fn":
      case "Closure":
        return true;
      case "Const":
      case "Static":
      case "GlobalAsm":
        return false;
    }
  },
};

/// The kind of an item that requires const-checking.
export type ConstContext = gen.ConstContext;
export const ConstContext = {
  ...gen.ConstContext,

  /// A description of this const context that can appear between backticks in an error message.
  ///
  /// E.g. `const` or `static mut`.
  // rustc: compiler/rustc_hir/src/hir.rs:2149 keyword_name
  keyword_name(self: ConstContext): string {
    if (self.$ === "Const") {
      return "const";
    } else if (self.$ === "Static" && self._0 === "Not") {
      return "static";
    } else if (self.$ === "Static" && self._0 === "Mut") {
      return "static mut";
    } else if (self.$ === "ConstFn") {
      return "const fn";
    }
    return unreachable();
  },
};

/// A colloquial, trivially pluralizable description of this const context for use in error
/// messages.
// rustc: compiler/rustc_hir/src/hir.rs:2162 fmt
export function display_ConstContext(v: ConstContext): string {
  switch (v.$) {
    case "Const":
      return "constant";
    case "Static":
      return "static";
    case "ConstFn":
      return "constant function";
  }
}

/** `impl IntoDiagArg for ConstContext` */
// rustc: compiler/rustc_hir/src/hir.rs:2172 into_diag_arg
export function ConstContext_into_diag_arg(self: ConstContext, _path: MutRef<PathBuf | undefined>): DiagArgValue {
  let s: string;
  switch (self.$) {
    case "ConstFn":
      s = "constant function";
      break;
    case "Static":
      s = "static";
      break;
    case "Const":
      s = "constant";
      break;
  }
  return { $: "Str", _0: s };
}

// rustc: compiler/rustc_hir/src/hir.rs:2227 precedence
gen.Expr.prototype.precedence = function (this: Expr, has_attr: (hir_id: HirId) => boolean): ExprPrecedence {
  const prefix_attrs_precedence = (): ExprPrecedence => {
    if (has_attr(this.hir_id)) {
      return "Prefix";
    } else {
      return "Unambiguous";
    }
  };

  const kind = this.kind;
  switch (kind.$) {
    case "Closure":
      switch (kind._0.fn_decl.output.$) {
        case "DefaultReturn":
          return "Jump";
        case "Return":
          return prefix_attrs_precedence();
      }
      break;

    case "Break":
    case "Ret":
    case "Yield":
    case "Become":
      return "Jump";

    // Binop-like expr kinds, handled by `AssocOp`.
    case "Binary":
      return BinOpKind.precedence(kind._0.node);
    case "Cast":
      return "Cast";

    case "Assign":
    case "AssignOp":
      return "Assign";

    // Unary, prefix
    case "AddrOf":
      return "Prefix";

    // Here `let pats = expr` has `let pats =` as a "unary" prefix of `expr`.
    // However, this is not exactly right. When `let _ = a` is the LHS of a binop we
    // need parens sometimes. E.g. we can print `(let _ = a) && b` as `let _ = a && b`
    // but we need to print `(let _ = a) < b` as-is with parens.
    case "Let":
    case "Unary":
      return "Prefix";

    // Need parens if and only if there are prefix attributes.
    case "Array":
    case "Block":
    case "Call":
    case "ConstBlock":
    case "Continue":
    case "Field":
    case "If":
    case "Index":
    case "InlineAsm":
    case "Lit":
    case "Loop":
    case "Match":
    case "MethodCall":
    case "OffsetOf":
    case "Path":
    case "Repeat":
    case "Struct":
    case "Tup":
    case "Type":
    case "UnsafeBinderCast":
    case "Use":
    case "Err":
      return prefix_attrs_precedence();

    case "DropTemps":
      return kind._0.precedence(has_attr);
  }
};

/// Whether this looks like a place expr, without checking for deref
/// adjustments.
/// This will return `true` in some potentially surprising cases such as
/// `CONSTANT.field`.
// rustc: compiler/rustc_hir/src/hir.rs:2290 is_syntactic_place_expr
gen.Expr.prototype.is_syntactic_place_expr = function (this: Expr): boolean {
  return this.is_place_expr((_) => true);
};

/// Whether this is a place expression.
///
/// `allow_projections_from` should return `true` if indexing a field or index expression based
/// on the given expression should be considered a place expression.
// rustc: compiler/rustc_hir/src/hir.rs:2298 is_place_expr
gen.Expr.prototype.is_place_expr = function (this: Expr, allow_projections_from: (e: Expr) => boolean): boolean {
  const kind = this.kind;
  if (kind.$ === "Path" && kind._0.$ === "Resolved") {
    const path = kind._0._1;
    const res = path.res;
    return res.$ === "Local" || (res.$ === "Def" && res._0.$ === "Static") || res.$ === "Err";
  }

  // Type ascription inherits its place expression kind from its
  // operand. See:
  // https://rust-lang.github.io/rfcs/0803-type-ascription.html#type-ascription-and-temporaries
  else if (kind.$ === "Type") {
    return kind._0.is_place_expr(allow_projections_from);
  }

  // Unsafe binder cast preserves place-ness of the sub-expression.
  else if (kind.$ === "UnsafeBinderCast") {
    return kind._1.is_place_expr(allow_projections_from);
  } else if (kind.$ === "Unary" && kind._0 === "Deref") {
    return true;
  } else if (kind.$ === "Field" || kind.$ === "Index") {
    const base = kind._0;
    return allow_projections_from(base) || base.is_place_expr(allow_projections_from);
  }

  // Suppress errors for bad expressions.
  else if (kind.$ === "Err" || (kind.$ === "Let" && kind._0.recovered.$ === "Yes")) {
    return true;
  }

  // Partially qualified paths in expressions can only legally
  // refer to associated items which are always rvalues.
  else if (
    (kind.$ === "Path" && kind._0.$ === "TypeRelative") ||
    kind.$ === "Call" ||
    kind.$ === "MethodCall" ||
    kind.$ === "Use" ||
    kind.$ === "Struct" ||
    kind.$ === "Tup" ||
    kind.$ === "If" ||
    kind.$ === "Match" ||
    kind.$ === "Closure" ||
    kind.$ === "Block" ||
    kind.$ === "Repeat" ||
    kind.$ === "Array" ||
    kind.$ === "Break" ||
    kind.$ === "Continue" ||
    kind.$ === "Ret" ||
    kind.$ === "Become" ||
    kind.$ === "Let" ||
    kind.$ === "Loop" ||
    kind.$ === "Assign" ||
    kind.$ === "InlineAsm" ||
    kind.$ === "OffsetOf" ||
    kind.$ === "AssignOp" ||
    kind.$ === "Lit" ||
    kind.$ === "ConstBlock" ||
    kind.$ === "Unary" ||
    kind.$ === "AddrOf" ||
    kind.$ === "Binary" ||
    kind.$ === "Yield" ||
    kind.$ === "Cast" ||
    kind.$ === "DropTemps"
  ) {
    return false;
  }
  return unreachable();
};

/// If this is a desugared range expression,
/// returns the span of the range without desugaring context.
// rustc: compiler/rustc_hir/src/hir.rs:2359 range_span
gen.Expr.prototype.range_span = function (this: Expr): Span | undefined {
  return is_range_literal(this) ? unwrap(Span.parent_callsite(this.span)) : undefined;
};

/// Check if expression is an integer literal that can be used
/// where `usize` is expected.
// rustc: compiler/rustc_hir/src/hir.rs:2365 is_size_lit
gen.Expr.prototype.is_size_lit = function (this: Expr): boolean {
  const kind = this.kind;
  return (
    kind.$ === "Lit" &&
    kind._0.node.$ === "Int" &&
    (kind._0.node._1.$ === "Unsuffixed" || (kind._0.node._1.$ === "Unsigned" && kind._0.node._1._0 === "Usize"))
  );
};

/// If `Self.kind` is `ExprKind::DropTemps(expr)`, drill down until we get a non-`DropTemps`
/// `Expr`. This is used in suggestions to ignore this `ExprKind` as it is semantically
/// silent, only signaling the ownership system. By doing this, suggestions that check the
/// `ExprKind` of any given `Expr` for presentation don't have to care about `DropTemps`
/// beyond remembering to call this function before doing analysis on it.
// rustc: compiler/rustc_hir/src/hir.rs:2380 peel_drop_temps
gen.Expr.prototype.peel_drop_temps = function (this: Expr): Expr {
  let expr: Expr = this;
  while (expr.kind.$ === "DropTemps") {
    expr = expr.kind._0;
  }
  return expr;
};

// rustc: compiler/rustc_hir/src/hir.rs:2388 peel_blocks
gen.Expr.prototype.peel_blocks = function (this: Expr): Expr {
  let expr: Expr = this;
  while (expr.kind.$ === "Block" && expr.kind._0.expr !== undefined) {
    expr = expr.kind._0.expr;
  }
  return expr;
};

// rustc: compiler/rustc_hir/src/hir.rs:2396 peel_borrows
gen.Expr.prototype.peel_borrows = function (this: Expr): Expr {
  let expr: Expr = this;
  while (expr.kind.$ === "AddrOf") {
    expr = expr.kind._2;
  }
  return expr;
};

// rustc: compiler/rustc_hir/src/hir.rs:2404 can_have_side_effects
gen.Expr.prototype.can_have_side_effects = function (this: Expr): boolean {
  const kind = this.peel_drop_temps().kind;
  switch (kind.$) {
    case "Path":
    case "Lit":
    case "OffsetOf":
    case "Use":
      return false;
    case "Type":
    case "Unary":
    case "Field":
    case "Index":
    case "AddrOf":
    case "Cast":
    case "UnsafeBinderCast": {
      let base: Expr;
      if (kind.$ === "Type" || kind.$ === "Field" || kind.$ === "Index" || kind.$ === "Cast") {
        base = kind._0;
      } else if (kind.$ === "Unary" || kind.$ === "UnsafeBinderCast") {
        base = kind._1;
      } else {
        // ExprKind::AddrOf(.., base)
        base = kind._2;
      }
      // This isn't exactly true for `Index` and all `Unary`, but we are using this
      // method exclusively for diagnostics and there's a *cultural* pressure against
      // them being used only for its side-effects.
      return base.can_have_side_effects();
    }
    case "Binary": {
      const [lhs, rhs] = [kind._1, kind._2];
      // This isn't exactly true for all `Binary`, but we are using this
      // method exclusively for diagnostics and there's a *cultural* pressure against
      // them being used only for its side-effects.
      return lhs.can_have_side_effects() || rhs.can_have_side_effects();
    }
    case "Struct": {
      const [fields, init] = [kind._1, kind._2];
      let init_side_effects: boolean;
      switch (init.$) {
        case "Base":
          init_side_effects = init._0.can_have_side_effects();
          break;
        case "DefaultFields":
        case "None":
        case "NoneWithError":
          init_side_effects = false;
          break;
      }
      return fields.map((field) => field.expr).some((e) => e.can_have_side_effects()) || init_side_effects;
    }

    case "Array":
    case "Tup":
      return kind._0.some((arg) => arg.can_have_side_effects());
    case "Call": {
      // ExprKind::Call(Expr { kind: ExprKind::Path(QPath::Resolved(None, Path { res:
      // Res::Def(DefKind::Ctor(_, CtorKind::Fn), _), .. })), .. }, args)
      const fkind = kind._0.kind;
      if (
        fkind.$ === "Path" &&
        fkind._0.$ === "Resolved" &&
        fkind._0._0 === undefined &&
        fkind._0._1.res.$ === "Def" &&
        fkind._0._1.res._0.$ === "Ctor" &&
        fkind._0._1.res._0._1 === "Fn"
      ) {
        return kind._1.some((arg) => arg.can_have_side_effects());
      }
      return true;
    }
    case "Repeat":
      return kind._0.can_have_side_effects();
    case "If":
    case "Match":
    case "MethodCall":
    case "Closure":
    case "Block":
    case "Break":
    case "Continue":
    case "Ret":
    case "Become":
    case "Let":
    case "Loop":
    case "Assign":
    case "InlineAsm":
    case "AssignOp":
    case "ConstBlock":
    case "Yield":
    case "DropTemps":
    case "Err":
      return true;
  }
};

/// To a first-order approximation, is this a pattern?
// rustc: compiler/rustc_hir/src/hir.rs:2475 is_approximately_pattern
gen.Expr.prototype.is_approximately_pattern = function (this: Expr): boolean {
  const kind = this.kind;
  switch (kind.$) {
    case "Array":
    case "Call":
    case "Tup":
    case "Lit":
    case "Path":
    case "Struct":
      return true;
    default:
      return false;
  }
};

/// Whether this and the `other` expression are the same for purposes of an indexing operation.
///
/// This is only used for diagnostics to see if we have things like `foo[i]` where `foo` is
/// borrowed multiple times with `i`.
// rustc: compiler/rustc_hir/src/hir.rs:2491 equivalent_for_indexing
gen.Expr.prototype.equivalent_for_indexing = function (this: Expr, other: Expr): boolean {
  const [k1, k2] = [this.kind, other.kind];
  if (k1.$ === "Lit" && k2.$ === "Lit") {
    // lit1.node == lit2.node
    return unported("<rustc_ast::ast::LitKind as PartialEq>::eq (hir.rs:2493 equivalent_for_indexing)");
  } else if (
    k1.$ === "Path" &&
    k1._0.$ === "Resolved" &&
    k1._0._0 === undefined &&
    k2.$ === "Path" &&
    k2._0.$ === "Resolved" &&
    k2._0._0 === undefined
  ) {
    const [path1, path2] = [k1._0._1, k2._0._1];
    return Res_eq(path1.res, path2.res, HirId_eq);
  } else if (
    k1.$ === "Struct" &&
    k1._0.$ === "Resolved" &&
    k1._0._0 === undefined &&
    k1._0._1.res.$ === "Def" &&
    k1._2.$ === "None" &&
    k2.$ === "Struct" &&
    k2._0.$ === "Resolved" &&
    k2._0._0 === undefined &&
    k2._0._1.res.$ === "Def" &&
    k2._2.$ === "None"
  ) {
    const [path1_def_id, args1] = [k1._0._1.res._1, k1._1];
    const [path2_def_id, args2] = [k2._0._1.res._1, k2._1];
    if (!(DefId_eq(path2_def_id, path1_def_id) && is_range_literal(this) && is_range_literal(other))) {
      return false;
    }
    // std::iter::zip(args1, args2).all(|(a, b)| a.expr.equivalent_for_indexing(b.expr))
    const n = Math.min(args1.length, args2.length);
    for (let i = 0; i < n; i++) {
      const [a, b] = [args1[i]!, args2[i]!];
      if (!a.expr.equivalent_for_indexing(b.expr)) {
        return false;
      }
    }
    return true;
  } else {
    return false;
  }
};

// rustc: compiler/rustc_hir/src/hir.rs:2520 method_ident
gen.Expr.prototype.method_ident = function (this: Expr): Ident | undefined {
  const kind = this.kind;
  switch (kind.$) {
    case "MethodCall":
      return kind._0.ident;
    case "Unary":
      return kind._1.method_ident();
    case "AddrOf":
      return kind._2.method_ident();
    default:
      return undefined;
  }
};

/// Checks if the specified expression is a built-in range literal.
/// (See: `LoweringContext::lower_expr()`).
// rustc: compiler/rustc_hir/src/hir.rs:2531 is_range_literal
export function is_range_literal(expr: Expr): boolean {
  // PORT: the two `if let` chains are tested in order; each returns `true` when all its
  // conditions hold (no condition has side effects).
  {
    const kind = expr.kind;
    if (kind.$ === "Struct" && kind._0.$ === "Resolved" && kind._0._0 === undefined && kind._2.$ === "None") {
      const path = kind._0._1;
      const segment = path.segments[path.segments.length - 1];
      if (segment !== undefined) {
        const name = segment.ident.name;
        if (
          (name === sym.RangeFrom ||
            name === sym.RangeFull ||
            name === sym.Range ||
            name === sym.RangeToInclusive ||
            name === sym.RangeTo ||
            name === sym.RangeFromCopy ||
            name === sym.RangeCopy ||
            name === sym.RangeInclusiveCopy ||
            name === sym.RangeToInclusiveCopy) &&
          Span.is_desugaring(expr.span, DesugaringKind.RangeExpr)
        ) {
          return true;
        }
      }
    }
  }
  {
    const kind = expr.kind;
    if (kind.$ === "Call") {
      const func = kind._0;
      const fkind = func.kind;
      if (fkind.$ === "Path" && fkind._0.$ === "Resolved" && fkind._0._0 === undefined) {
        const path = fkind._0._1;
        const segment = path.segments[path.segments.length - 1];
        if (
          segment !== undefined &&
          segment.ident.name === sym.range_inclusive_new &&
          Span.is_desugaring(expr.span, DesugaringKind.RangeExpr)
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

/// Checks if the specified expression needs parentheses for prefix
/// or postfix suggestions to be valid.
/// For example, `a + b` requires parentheses to suggest `&(a + b)`,
/// but just `a` does not.
/// Similarly, `(a + b).c()` also requires parentheses.
/// This should not be used for other types of suggestions.
// rustc: compiler/rustc_hir/src/hir.rs:2564 expr_needs_parens
export function expr_needs_parens(expr: Expr): boolean {
  const kind = expr.kind;
  // parenthesize if needed (Issue #46756)
  if (kind.$ === "Cast" || kind.$ === "Binary") {
    return true;
  }
  // parenthesize borrows of range literals (Issue #54505)
  else if (is_range_literal(expr)) {
    return true;
  } else {
    return false;
  }
}

export type QPath = gen.QPath;
export const QPath = {
  /// Returns the span of this `QPath`.
  // rustc: compiler/rustc_hir/src/hir.rs:2758 span
  span(self: QPath): Span {
    switch (self.$) {
      case "Resolved":
        return self._1.span;
      case "TypeRelative": {
        const [qself, ps] = [self._0, self._1];
        return Span.to(qself.span, ps.ident.span);
      }
    }
  },

  /// Returns the span of the qself of this `QPath`. For example, `()` in
  /// `<() as Trait>::method`.
  // rustc: compiler/rustc_hir/src/hir.rs:2767 qself_span
  qself_span(self: QPath): Span {
    switch (self.$) {
      case "Resolved":
        return self._1.span;
      case "TypeRelative":
        return self._0.span;
    }
  },
};

/// Hints at the original code for a `match _ { .. }`.
export type MatchSource = gen.MatchSource;
export const MatchSource = {
  ...gen.MatchSource,

  // rustc: compiler/rustc_hir/src/hir.rs:2818 name
  name(self: MatchSource): string {
    switch (self.$) {
      case "Normal":
        return "match";
      case "Postfix":
        return ".match";
      case "ForLoopDesugar":
        return "for";
      case "TryDesugar":
        return "?";
      case "AwaitDesugar":
        return ".await";
      case "FormatArgs":
        return "format_args!()";
    }
  },
};

/// The loop type that yielded an `ExprKind::Loop`.
export type LoopSource = gen.LoopSource;
export const LoopSource = {
  ...gen.LoopSource,

  // rustc: compiler/rustc_hir/src/hir.rs:2843 name
  name(self: LoopSource): string {
    switch (self) {
      case "Loop":
        return "loop";
      case "While":
        return "while";
      case "ForLoop":
        return "for";
    }
  },
};

// rustc: compiler/rustc_hir/src/hir.rs:2860 fmt
export function display_LoopIdError(v: gen.LoopIdError): string {
  switch (v) {
    case "OutsideLoopScope":
      return "not inside loop scope";
    case "UnlabeledCfInWhileCondition":
      return "unlabeled control flow (break or continue) in while condition";
    case "UnresolvedLabel":
      return "label not found";
  }
}

// rustc: compiler/rustc_hir/src/hir.rs:2891 fmt
export function display_YieldSource(v: gen.YieldSource): string {
  switch (v.$) {
    case "Await":
      return "`await`";
    case "Yield":
      return "`yield`";
  }
}

// rustc: compiler/rustc_hir/src/hir.rs:2918 hir_id
gen.TraitItemId.prototype.hir_id = function (this: TraitItemId): HirId {
  // Items are always HIR owners.
  return HirId_make_owner(this.owner_id.def_id);
};

// PORT: `macro_rules! expect_methods_self_kind` (hir.rs:2938) / `expect_methods_self` (hir.rs:2950)
// are expanded by hand at their call sites (hir.rs:2978, :3071); the generated fns have no `fn <name>`
// upstream, so they carry no `// rustc:` marker. `#[track_caller]` is dropped. HIR is arena-allocated
// and never edited in place, so the `*rhs`/`*ty` copies of Copy HIR values return the same object.

// PORT: `T: fmt::Debug` is passed as `debug_T`.
// rustc: compiler/rustc_hir/src/hir.rs:2963 expect_failed
export function expect_failed<T>(ident: string, found: T, debug_T: Debug<T>): never {
  return panic(`${ident}: found ${debug_T(found, PLAIN)}`);
}

// rustc: compiler/rustc_hir/src/hir.rs:2969 hir_id
gen.TraitItem.prototype.hir_id = function (this: TraitItem): HirId {
  // Items are always HIR owners.
  return HirId_make_owner(this.owner_id.def_id);
};

// rustc: compiler/rustc_hir/src/hir.rs:2974 trait_item_id
gen.TraitItem.prototype.trait_item_id = function (this: TraitItem): TraitItemId {
  return new gen.TraitItemId(this.owner_id);
};

// expect_methods_self_kind! (hir.rs:2978): expect_const
gen.TraitItem.prototype.expect_const = function (this: TraitItem): [Ty, ConstItemRhs | undefined] {
  const kind = this.kind;
  if (kind.$ !== "Const") {
    return expect_failed("expect_const", this, gen.debug_TraitItem);
  }
  const [ty, rhs] = [kind._0, kind._1];
  return [ty, rhs];
};

// expect_methods_self_kind! (hir.rs:2978): expect_fn
gen.TraitItem.prototype.expect_fn = function (this: TraitItem): [FnSig, TraitFn] {
  const kind = this.kind;
  if (kind.$ !== "Fn") {
    return expect_failed("expect_fn", this, gen.debug_TraitItem);
  }
  const [ty, trfn] = [kind._0, kind._1];
  return [ty, trfn];
};

// expect_methods_self_kind! (hir.rs:2978): expect_type
gen.TraitItem.prototype.expect_type = function (this: TraitItem): [GenericBounds, Ty | undefined] {
  const kind = this.kind;
  if (kind.$ !== "Type") {
    return expect_failed("expect_type", this, gen.debug_TraitItem);
  }
  const [bounds, ty] = [kind._0, kind._1];
  return [bounds, ty];
};

// rustc: compiler/rustc_hir/src/hir.rs:3022 hir_id
gen.ImplItemId.prototype.hir_id = function (this: ImplItemId): HirId {
  // Items are always HIR owners.
  return HirId_make_owner(this.owner_id.def_id);
};

// rustc: compiler/rustc_hir/src/hir.rs:3055 hir_id
gen.ImplItem.prototype.hir_id = function (this: ImplItem): HirId {
  // Items are always HIR owners.
  return HirId_make_owner(this.owner_id.def_id);
};

// rustc: compiler/rustc_hir/src/hir.rs:3060 impl_item_id
gen.ImplItem.prototype.impl_item_id = function (this: ImplItem): ImplItemId {
  return new gen.ImplItemId(this.owner_id);
};

// rustc: compiler/rustc_hir/src/hir.rs:3064 vis_span
gen.ImplItem.prototype.vis_span = function (this: ImplItem): Span | undefined {
  const impl_kind = this.impl_kind;
  switch (impl_kind.$) {
    case "Trait":
      return undefined;
    case "Inherent":
      return impl_kind.vis_span;
  }
};

// expect_methods_self_kind! (hir.rs:3071): expect_const
gen.ImplItem.prototype.expect_const = function (this: ImplItem): [Ty, ConstItemRhs] {
  const kind = this.kind;
  if (kind.$ !== "Const") {
    return expect_failed("expect_const", this, gen.debug_ImplItem);
  }
  const [ty, rhs] = [kind._0, kind._1];
  return [ty, rhs];
};

// expect_methods_self_kind! (hir.rs:3071): expect_fn
gen.ImplItem.prototype.expect_fn = function (this: ImplItem): [FnSig, BodyId] {
  const kind = this.kind;
  if (kind.$ !== "Fn") {
    return expect_failed("expect_fn", this, gen.debug_ImplItem);
  }
  const [ty, body] = [kind._0, kind._1];
  return [ty, body];
};

// expect_methods_self_kind! (hir.rs:3071): expect_type
gen.ImplItem.prototype.expect_type = function (this: ImplItem): Ty {
  const kind = this.kind;
  if (kind.$ !== "Type") {
    return expect_failed("expect_type", this, gen.debug_ImplItem);
  }
  const ty = kind._0;
  return ty;
};

/// Obtain the type on the RHS of an assoc ty equality constraint if applicable.
// rustc: compiler/rustc_hir/src/hir.rs:3112 ty
gen.AssocItemConstraint.prototype.ty = function (this: AssocItemConstraint): Ty | undefined {
  const kind = this.kind;
  if (kind.$ === "Equality" && kind.term.$ === "Ty") {
    return kind.term._0;
  }
  return undefined;
};

/// Obtain the const on the RHS of an assoc const equality constraint if applicable.
// rustc: compiler/rustc_hir/src/hir.rs:3120 ct
gen.AssocItemConstraint.prototype.ct = function (this: AssocItemConstraint): ConstArg | undefined {
  const kind = this.kind;
  if (kind.$ === "Equality" && kind.term.$ === "Const") {
    return kind.term._0;
  }
  return undefined;
};

export type Term = gen.Term;
export const Term = {
  /** `impl From<&'hir Ty<'hir>> for Term<'hir>` */
  // rustc: compiler/rustc_hir/src/hir.rs:3135 from
  from_Ty(ty: Ty): Term {
    return { $: "Ty", _0: ty };
  },

  /** `impl From<&'hir ConstArg<'hir>> for Term<'hir>` */
  // rustc: compiler/rustc_hir/src/hir.rs:3141 from
  from_ConstArg(c: ConstArg): Term {
    return { $: "Const", _0: c };
  },
};

/// The kind of [associated item constraint][AssocItemConstraint].
export type AssocItemConstraintKind = gen.AssocItemConstraintKind;
export const AssocItemConstraintKind = {
  // rustc: compiler/rustc_hir/src/hir.rs:3161 descr
  descr(self: AssocItemConstraintKind): string {
    switch (self.$) {
      case "Equality":
        return "binding";
      case "Bound":
        return "constraint";
    }
  },
};

// PORT: `impl Ty<'hir, AmbigArg>` (hir.rs:3188, :3226) -> the `TyAmbig` companion: `peel_refs` is also
// defined by `impl Ty<'hir>` (:3236), which owns the prototype (the ast.ts `AssocItem` precedent).
// The pointer casts between `Ty<'hir, AmbigArg>` and `Ty<'hir>` are identity casts (`AmbigArg` is
// uninhabited: `never`; `()` is `null`), written `as unknown as`.
export const TyAmbig = {
  /// Converts a `Ty` in an ambiguous position to one in an unambiguous position.
  ///
  /// Functions accepting an unambiguous types may expect the [`TyKind::Infer`] variant
  /// to be used. Care should be taken to separately handle infer types when calling this
  /// function as it cannot be handled by downstream code making use of the returned ty.
  ///
  /// In practice this may mean overriding the [`Visitor::visit_infer`][visit_infer] method on hir visitors, or
  /// specifically matching on [`GenericArg::Infer`] when handling generic arguments.
  ///
  /// [visit_infer]: [rustc_hir::intravisit::Visitor::visit_infer]
  // rustc: compiler/rustc_hir/src/hir.rs:3199 as_unambig_ty
  as_unambig_ty(self: Ty<AmbigArg>): Ty {
    // SAFETY: `Ty` is `repr(C)` and `TyKind` is marked `repr(u8)` so that the layout is
    // the same across different ZST type arguments.
    const ptr = self as unknown as Ty;
    return ptr;
  },

  // rustc: compiler/rustc_hir/src/hir.rs:3227 peel_refs
  peel_refs(self: Ty<AmbigArg>): Ty {
    let final_ty = TyAmbig.as_unambig_ty(self);
    while (final_ty.kind.$ === "Ref") {
      final_ty = final_ty.kind._1;
    }
    return final_ty;
  },
};

/// Converts a `Ty` in an unambiguous position to one in an ambiguous position. This is
/// fallible as the [`TyKind::Infer`] variant is not present in ambiguous positions.
///
/// Functions accepting ambiguous types will not handle the [`TyKind::Infer`] variant, if
/// infer types are relevant to you then care should be taken to handle them separately.
// rustc: compiler/rustc_hir/src/hir.rs:3213 try_as_ambig_ty
gen.Ty.prototype.try_as_ambig_ty = function (this: Ty): Ty<AmbigArg> | undefined {
  if (this.kind.$ === "Infer") {
    return undefined;
  }

  // SAFETY: `Ty` is `repr(C)` and `TyKind` is marked `repr(u8)` so that the layout is
  // the same across different ZST type arguments. We also asserted that the `self` is
  // not a `TyKind::Infer` so there is no risk of transmuting a `()` to `AmbigArg`.
  const ptr = this as unknown as Ty<AmbigArg>;
  return ptr;
};

// rustc: compiler/rustc_hir/src/hir.rs:3237 peel_refs
gen.Ty.prototype.peel_refs = function (this: Ty): Ty {
  let final_ty: Ty = this;
  while (final_ty.kind.$ === "Ref") {
    final_ty = final_ty.kind._1;
  }
  return final_ty;
};

/// Returns `true` if `param_def_id` matches the `bounded_ty` of this predicate.
// rustc: compiler/rustc_hir/src/hir.rs:3246 as_generic_param
gen.Ty.prototype.as_generic_param = function (this: Ty): [DefId, Ident] | undefined {
  const kind = this.kind;
  if (!(kind.$ === "Path" && kind._0.$ === "Resolved" && kind._0._0 === undefined)) {
    return undefined;
  }
  const path = kind._0._1;
  if (path.segments.length !== 1) {
    return undefined;
  }
  const segment = path.segments[0]!;
  const res = path.res;
  if (res.$ === "Def" && res._0.$ === "TyParam") {
    return [res._1, segment.ident];
  } else if (res.$ === "SelfTyParam") {
    return [res.trait_, segment.ident];
  } else {
    return undefined;
  }
};

// rustc: compiler/rustc_hir/src/hir.rs:3261 find_self_aliases
gen.Ty.prototype.find_self_aliases = function (this: Ty): Span[] {
  class MyVisitor extends Visitor {
    constructor(public _0: Span[]) {
      super();
    }
    // rustc: compiler/rustc_hir/src/hir.rs:3265 visit_ty
    override visit_ty(t: Ty<AmbigArg>): undefined {
      const kind = t.kind;
      if (kind.$ === "Path" && kind._0.$ === "Resolved" && kind._0._1.res.$ === "SelfTyAlias") {
        this._0.push(t.span);
        return undefined;
      }
      return walk_ty(this, t);
    }
  }

  const my_visitor = new MyVisitor([]);
  my_visitor.visit_ty_unambig(this);
  return my_visitor._0;
};

/// Whether `ty` is a type with `_` placeholders that can be inferred. Used in diagnostics only to
/// use inference to provide suggestions for the appropriate type if possible.
// rustc: compiler/rustc_hir/src/hir.rs:3287 is_suggestable_infer_ty
gen.Ty.prototype.is_suggestable_infer_ty = function (this: Ty): boolean {
  // rustc: compiler/rustc_hir/src/hir.rs:3288 are_suggestable_generic_args
  function are_suggestable_generic_args(generic_args: readonly GenericArg[]): boolean {
    return generic_args.some((arg) => {
      switch (arg.$) {
        case "Type":
          return TyAmbig.as_unambig_ty(arg._0).is_suggestable_infer_ty();
        case "Infer":
          return true;
        default:
          return false;
      }
    });
  }
  // debug!(?self);
  const kind = this.kind;
  switch (kind.$) {
    case "Infer":
      return true;
    case "Slice":
      return kind._0.is_suggestable_infer_ty();
    case "Array": {
      const [ty, length] = [kind._0, kind._1];
      return ty.is_suggestable_infer_ty() || length.kind.$ === "Infer";
    }
    case "Tup":
      return kind._0.some((t) => t.is_suggestable_infer_ty());
    case "Ptr":
      return kind._0.is_suggestable_infer_ty();
    case "Ref":
      return kind._1.is_suggestable_infer_ty();
    case "Path": {
      const qpath = kind._0;
      if (qpath.$ === "TypeRelative") {
        const [ty, segment] = [qpath._0, qpath._1];
        return ty.is_suggestable_infer_ty() || are_suggestable_generic_args(segment.args_().args);
      } else {
        // QPath::Resolved(ty_opt, Path { segments, .. })
        const [ty_opt, segments] = [qpath._0, qpath._1.segments];
        return (
          (ty_opt !== undefined && ty_opt.is_suggestable_infer_ty()) ||
          segments.some((segment) => are_suggestable_generic_args(segment.args_().args))
        );
      }
    }
    default:
      return false;
  }
};

// ---- hir.rs lines 3329-5311 -------------------------------------------------------------
//
// PORT: (part 3 notes, see hir.ts's header for the placement conventions)
// - HIR nodes are arena-allocated and never edited in place (there is no HIR MutVisitor), so Rust
//   copies of `Copy` HIR objects (`*ut`, `sig.header`, tuples of `&'hir` refs) are identity here.
// - `FnDeclFlags` methods taking `mut self` by value work on a copy (`clone_FnDeclFlags(this)`).
// - Methods whose name clashes with a field of the same struct get a trailing `_`:
//   `FnDeclFlags::splatted()` -> `splatted_()`, `FnHeader::safety()` -> `safety_()`.
// - `expect_methods_self_kind!` / `expect_methods_self!` expansions are written out by hand in
//   upstream order, each marked `// rustc-macro:` at its macro-input line.

declare module "./hir_standin.ts" {
  interface InlineAsm {
    contains_label(): boolean;
  }
  interface FnDeclFlags {
    set_implicit_self(implicit_self: ImplicitSelfKind): FnDeclFlags;
    set_c_variadic(c_variadic: boolean): FnDeclFlags;
    set_lifetime_elision_allowed(allowed: boolean): FnDeclFlags;
    set_splatted(splatted: number | undefined, args_len: number): Result<FnDeclFlags, SplattedArgIndexError>;
    set_no_splatted_args(): FnDeclFlags;
    implicit_self(): ImplicitSelfKind;
    c_variadic(): boolean;
    lifetime_elision_allowed(): boolean;
    splatted_(): number | undefined;
  }
  interface FnDecl {
    opt_delegation_sig_id(): DefId | undefined;
    opt_delegation_info(): DelegationInfo | undefined;
    implicit_self(): ImplicitSelfKind;
    c_variadic(): boolean;
    lifetime_elision_allowed(): boolean;
    splatted(): number | undefined;
  }
  interface UseTree {
    resolutions(): Generator<PerNS<Res | undefined>, void, undefined>;
  }
  interface TraitRef {
    trait_def_id(): DefId | undefined;
  }
  interface FieldDef {
    is_positional(): boolean;
  }
  interface ItemId {
    hir_id(): HirId;
  }
  interface Item {
    hir_id(): HirId;
    item_id(): ItemId;
    is_adt(): boolean;
    is_struct_or_union(): boolean;
    expect_extern_crate(): [Symbol | undefined, Ident];
    expect_use(): UseTree;
    expect_static(): [Mutability, Ident, Ty, BodyId];
    expect_const(): [Ident, Generics, Ty, ConstItemRhs];
    expect_fn(): [Ident, FnSig, Generics, BodyId];
    expect_macro(): [Ident, MacroDef, MacroKinds];
    expect_mod(): [Ident, Mod];
    expect_foreign_mod(): [ExternAbi, readonly ForeignItemId[]];
    expect_global_asm(): InlineAsm;
    expect_ty_alias(): [Ident, Generics, Ty];
    expect_enum(): [Ident, Generics, EnumDef];
    expect_struct(): [Ident, Generics, VariantDataT];
    expect_union(): [Ident, Generics, VariantDataT];
    expect_trait(): [
      ImplRestriction,
      Constness,
      IsAuto,
      Safety,
      Ident,
      Generics,
      GenericBounds,
      readonly TraitItemId[],
    ];
    expect_trait_alias(): [Constness, Ident, Generics, GenericBounds];
    expect_impl(): Impl;
    expect_test_binder_constraints(): [Generics, TestBinderBody];
  }
  interface FnHeader {
    is_async(): boolean;
    is_unsafe(): boolean;
    is_safe(): boolean;
    safety_(): Safety;
  }
  interface ForeignItemId {
    hir_id(): HirId;
  }
  interface ForeignItem {
    hir_id(): HirId;
    foreign_item_id(): ForeignItemId;
  }
}

export type PrimTy = gen.PrimTy;
export const PrimTy = {
  ...gen.PrimTy,

  /// All of the primitive types
  ALL: [
    // any changes here should also be reflected in `PrimTy::from_name`
    Object.freeze({ $: "Int" as const, _0: IntTy.I8 }),
    Object.freeze({ $: "Int" as const, _0: IntTy.I16 }),
    Object.freeze({ $: "Int" as const, _0: IntTy.I32 }),
    Object.freeze({ $: "Int" as const, _0: IntTy.I64 }),
    Object.freeze({ $: "Int" as const, _0: IntTy.I128 }),
    Object.freeze({ $: "Int" as const, _0: IntTy.Isize }),
    Object.freeze({ $: "Uint" as const, _0: UintTy.U8 }),
    Object.freeze({ $: "Uint" as const, _0: UintTy.U16 }),
    Object.freeze({ $: "Uint" as const, _0: UintTy.U32 }),
    Object.freeze({ $: "Uint" as const, _0: UintTy.U64 }),
    Object.freeze({ $: "Uint" as const, _0: UintTy.U128 }),
    Object.freeze({ $: "Uint" as const, _0: UintTy.Usize }),
    Object.freeze({ $: "Float" as const, _0: FloatTy.F16 }),
    Object.freeze({ $: "Float" as const, _0: FloatTy.F32 }),
    Object.freeze({ $: "Float" as const, _0: FloatTy.F64 }),
    Object.freeze({ $: "Float" as const, _0: FloatTy.F128 }),
    gen.PrimTy.Bool,
    gen.PrimTy.Char,
    gen.PrimTy.Str,
  ] as readonly PrimTy[],

  /// Like [`PrimTy::name`], but returns a &str instead of a symbol.
  ///
  /// Used by clippy.
  // rustc: compiler/rustc_hir/src/hir.rs:3357 name_str
  name_str(self: PrimTy): string {
    switch (self.$) {
      case "Int":
        return IntTy.name_str(self._0);
      case "Uint":
        return UintTy.name_str(self._0);
      case "Float":
        return FloatTy.name_str(self._0);
      case "Str":
        return "str";
      case "Bool":
        return "bool";
      case "Char":
        return "char";
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:3368 name
  name(self: PrimTy): Symbol {
    switch (self.$) {
      case "Int":
        return IntTy.name(self._0);
      case "Uint":
        return UintTy.name(self._0);
      case "Float":
        return FloatTy.name(self._0);
      case "Str":
        return sym.str;
      case "Bool":
        return sym.bool;
      case "Char":
        return sym.char;
    }
  },

  /// Returns the matching `PrimTy` for a `Symbol` such as "str" or "i32".
  /// Returns `None` if no matching type is found.
  // rustc: compiler/rustc_hir/src/hir.rs:3381 from_name
  from_name(name: Symbol): PrimTy | undefined {
    let ty: PrimTy;
    switch (name) {
      // any changes here should also be reflected in `PrimTy::ALL`
      case sym.i8:
        ty = { $: "Int", _0: IntTy.I8 };
        break;
      case sym.i16:
        ty = { $: "Int", _0: IntTy.I16 };
        break;
      case sym.i32:
        ty = { $: "Int", _0: IntTy.I32 };
        break;
      case sym.i64:
        ty = { $: "Int", _0: IntTy.I64 };
        break;
      case sym.i128:
        ty = { $: "Int", _0: IntTy.I128 };
        break;
      case sym.isize:
        ty = { $: "Int", _0: IntTy.Isize };
        break;
      case sym.u8:
        ty = { $: "Uint", _0: UintTy.U8 };
        break;
      case sym.u16:
        ty = { $: "Uint", _0: UintTy.U16 };
        break;
      case sym.u32:
        ty = { $: "Uint", _0: UintTy.U32 };
        break;
      case sym.u64:
        ty = { $: "Uint", _0: UintTy.U64 };
        break;
      case sym.u128:
        ty = { $: "Uint", _0: UintTy.U128 };
        break;
      case sym.usize:
        ty = { $: "Uint", _0: UintTy.Usize };
        break;
      case sym.f16:
        ty = { $: "Float", _0: FloatTy.F16 };
        break;
      case sym.f32:
        ty = { $: "Float", _0: FloatTy.F32 };
        break;
      case sym.f64:
        ty = { $: "Float", _0: FloatTy.F64 };
        break;
      case sym.f128:
        ty = { $: "Float", _0: FloatTy.F128 };
        break;
      case sym.bool:
        ty = gen.PrimTy.Bool;
        break;
      case sym.char:
        ty = gen.PrimTy.Char;
        break;
      case sym.str:
        ty = gen.PrimTy.Str;
        break;
      default:
        return undefined;
    }
    return ty;
  },
};

export type PreciseCapturingArg = gen.PreciseCapturingArg;
export const PreciseCapturingArg = {
  // rustc: compiler/rustc_hir/src/hir.rs:3447 hir_id
  hir_id(self: PreciseCapturingArg): HirId {
    switch (self.$) {
      case "Lifetime":
        return self._0.hir_id;
      case "Param":
        return self._0.hir_id;
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:3454 name
  name(self: PreciseCapturingArg): Symbol {
    switch (self.$) {
      case "Lifetime":
        return self._0.ident.name;
      case "Param":
        return self._0.ident.name;
    }
  },
};

export type InlineAsmRegOrRegClass = gen.InlineAsmRegOrRegClass;
export const InlineAsmRegOrRegClass = {
  // For `rustc_mir_build` and `clippy_utils`
  // rustc: compiler/rustc_hir/src/hir.rs:3626 as_target
  as_target(self: InlineAsmRegOrRegClass): asm.InlineAsmRegOrRegClass {
    // PORT: rustc_target's `InlineAsmRegOrRegClass` has no variant constructors; its payloads are
    // interned and its derived `PartialEq` is `asm.InlineAsmRegOrRegClass.eq`, so a fresh object
    // literal is the Rust value.
    switch (self.$) {
      case "Reg":
        return { $: "Reg", _0: self.reg };
      case "RegClass":
        return { $: "RegClass", _0: self._0 };
    }
  },

  // For `rustc_ast_lowering`
  // rustc: compiler/rustc_hir/src/hir.rs:3634 reg_class
  reg_class(self: InlineAsmRegOrRegClass): asm.InlineAsmRegClass {
    return asm.InlineAsmRegOrRegClass.reg_class(InlineAsmRegOrRegClass.as_target(self));
  },

  // For `rustc_ast_lowering`
  // rustc: compiler/rustc_hir/src/hir.rs:3639 source_name
  source_name(self: InlineAsmRegOrRegClass): Symbol | undefined {
    switch (self.$) {
      case "Reg":
        return self.source_name;
      case "RegClass":
        return undefined;
    }
  },
};

// For `rustc_hir_pretty`
// rustc: compiler/rustc_hir/src/hir.rs:3649 fmt
export function display_InlineAsmRegOrRegClass(v: InlineAsmRegOrRegClass): string {
  return asm.InlineAsmRegOrRegClass.display(InlineAsmRegOrRegClass.as_target(v));
}

export type InlineAsmOperand = gen.InlineAsmOperand;
export const InlineAsmOperand = {
  // rustc: compiler/rustc_hir/src/hir.rs:3692 reg
  reg(self: InlineAsmOperand): InlineAsmRegOrRegClass | undefined {
    switch (self.$) {
      case "In":
      case "Out":
      case "InOut":
      case "SplitInOut":
        return self.reg;
      case "Const":
      case "SymFn":
      case "SymStatic":
      case "Label":
        return undefined;
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:3705 is_clobber
  is_clobber(self: InlineAsmOperand): boolean {
    return self.$ === "Out" && self.reg.$ === "Reg" && self.expr === undefined;
  },
};

// rustc: compiler/rustc_hir/src/hir.rs:3724 contains_label
gen.InlineAsm.prototype.contains_label = function (this: InlineAsm): boolean {
  return this.operands.some((x) => x[0].$ === "Label");
};

export type FnDeclFlags = gen.FnDeclFlags;
// PORT: associated consts and statics of the generated class, attached below in upstream order.
export const FnDeclFlags = gen.FnDeclFlags as typeof gen.FnDeclFlags & {
  IMPLICIT_SELF_MASK: number;
  C_VARIADIC_FLAG: number;
  LIFETIME_ELISION_ALLOWED_FLAG: number;
  NO_SPLATTED_ARG_INDEX: number;
  default: () => FnDeclFlags;
};

/// Mask for the implicit self kind.
FnDeclFlags.IMPLICIT_SELF_MASK = 0b111;

/// Bitflag for a trailing C-style variadic argument.
FnDeclFlags.C_VARIADIC_FLAG = 1 << 3;

/// Bitflag for lifetime elision.
FnDeclFlags.LIFETIME_ELISION_ALLOWED_FLAG = 1 << 4;

/// Marker index for "no splatted argument".
/// Must have the same value as `FnSigKind::NO_SPLATTED_ARG_INDEX` and `rustc_ast::FnDecl::NO_SPLATTED_ARG_INDEX`.
FnDeclFlags.NO_SPLATTED_ARG_INDEX = 0xff; // u8::MAX

/// Create a new FnDeclKind with no implicit self, no lifetime elision, no C-style variadic
/// argument, and no splatting.
/// To modify these flags, use the `set_*` methods, for readability.
// FIXME: use Default instead when that trait is const stable.
// rustc: compiler/rustc_hir/src/hir.rs:3805 default
FnDeclFlags.default = function (): FnDeclFlags {
  return new gen.FnDeclFlags(0, 0)
    .set_implicit_self(ImplicitSelfKind.None)
    .set_lifetime_elision_allowed(false)
    .set_c_variadic(false)
    .set_no_splatted_args();
};

/// Set the implicit self kind.
// rustc: compiler/rustc_hir/src/hir.rs:3815 set_implicit_self
gen.FnDeclFlags.prototype.set_implicit_self = function (this: FnDeclFlags, implicit_self: ImplicitSelfKind): FnDeclFlags {
  const self = gen.clone_FnDeclFlags(this);
  self.flags &= ~FnDeclFlags.IMPLICIT_SELF_MASK & 0xff;

  switch (implicit_self) {
    case "None":
      self.flags |= 0;
      break;
    case "Imm":
      self.flags |= 1;
      break;
    case "Mut":
      self.flags |= 2;
      break;
    case "RefImm":
      self.flags |= 3;
      break;
    case "RefMut":
      self.flags |= 4;
      break;
  }

  return self;
};

/// Set the C-style variadic argument flag.
// rustc: compiler/rustc_hir/src/hir.rs:3831 set_c_variadic
gen.FnDeclFlags.prototype.set_c_variadic = function (this: FnDeclFlags, c_variadic: boolean): FnDeclFlags {
  const self = gen.clone_FnDeclFlags(this);
  if (c_variadic) {
    self.flags |= FnDeclFlags.C_VARIADIC_FLAG;
  } else {
    self.flags &= ~FnDeclFlags.C_VARIADIC_FLAG & 0xff;
  }

  return self;
};

/// Set the lifetime elision allowed flag.
// rustc: compiler/rustc_hir/src/hir.rs:3843 set_lifetime_elision_allowed
gen.FnDeclFlags.prototype.set_lifetime_elision_allowed = function (this: FnDeclFlags, allowed: boolean): FnDeclFlags {
  const self = gen.clone_FnDeclFlags(this);
  if (allowed) {
    self.flags |= FnDeclFlags.LIFETIME_ELISION_ALLOWED_FLAG;
  } else {
    self.flags &= ~FnDeclFlags.LIFETIME_ELISION_ALLOWED_FLAG & 0xff;
  }

  return self;
};

/// Set the splatted argument index.
/// The number of function arguments is used for error checking.
// rustc: compiler/rustc_hir/src/hir.rs:3856 set_splatted
gen.FnDeclFlags.prototype.set_splatted = function (
  this: FnDeclFlags,
  splatted: number | undefined,
  args_len: number,
): Result<FnDeclFlags, SplattedArgIndexError> {
  const self = gen.clone_FnDeclFlags(this);
  if (splatted !== undefined) {
    const splatted_arg_index = splatted;
    if (splatted_arg_index === FnDeclFlags.NO_SPLATTED_ARG_INDEX) {
      // This index value is used as a marker for "no splatting", so it is unsupported.
      // Higher values are also not supported, for performance reasons.
      return Err({ $: "InvalidIndex", splatted_arg_index });
    } else if (splatted_arg_index >= args_len) {
      return Err({
        $: "OutOfBounds",
        splatted_arg_index,
        args_len: args_len & 0xffff, // `args_len as u16`
      });
    }

    self.splatted = splatted_arg_index;
  } else {
    self.splatted = FnDeclFlags.NO_SPLATTED_ARG_INDEX;
  }

  return Ok(self);
};

/// Set "no splatted arguments" for the function declaration.
// rustc: compiler/rustc_hir/src/hir.rs:3883 set_no_splatted_args
gen.FnDeclFlags.prototype.set_no_splatted_args = function (this: FnDeclFlags): FnDeclFlags {
  const self = gen.clone_FnDeclFlags(this);
  self.splatted = FnDeclFlags.NO_SPLATTED_ARG_INDEX;

  return self;
};

/// Get the implicit self kind.
// rustc: compiler/rustc_hir/src/hir.rs:3890 implicit_self
gen.FnDeclFlags.prototype.implicit_self = function (this: FnDeclFlags): ImplicitSelfKind {
  switch (this.flags & FnDeclFlags.IMPLICIT_SELF_MASK) {
    case 0:
      return ImplicitSelfKind.None;
    case 1:
      return ImplicitSelfKind.Imm;
    case 2:
      return ImplicitSelfKind.Mut;
    case 3:
      return ImplicitSelfKind.RefImm;
    case 4:
      return ImplicitSelfKind.RefMut;
    default:
      return unreachable();
  }
};

/// Do the function arguments end with a C-style variadic argument?
// rustc: compiler/rustc_hir/src/hir.rs:3902 c_variadic
gen.FnDeclFlags.prototype.c_variadic = function (this: FnDeclFlags): boolean {
  return (this.flags & FnDeclFlags.C_VARIADIC_FLAG) !== 0;
};

/// Is lifetime elision allowed?
// rustc: compiler/rustc_hir/src/hir.rs:3907 lifetime_elision_allowed
gen.FnDeclFlags.prototype.lifetime_elision_allowed = function (this: FnDeclFlags): boolean {
  return (this.flags & FnDeclFlags.LIFETIME_ELISION_ALLOWED_FLAG) !== 0;
};

/// Get the splatted argument index, if any.
// PORT: `splatted_` (clashes with the `splatted` field).
// rustc: compiler/rustc_hir/src/hir.rs:3912 splatted
gen.FnDeclFlags.prototype.splatted_ = function (this: FnDeclFlags): number | undefined {
  if (this.splatted === FnDeclFlags.NO_SPLATTED_ARG_INDEX) {
    return undefined;
  } else {
    return this.splatted;
  }
};

export type FnDecl = gen.FnDecl;
// PORT: statics of the generated class, attached below in upstream order.
export const FnDecl = gen.FnDecl as typeof gen.FnDecl & {
  dummy: (span: Span) => FnDecl;
};

// rustc: compiler/rustc_hir/src/hir.rs:3930 opt_delegation_sig_id
gen.FnDecl.prototype.opt_delegation_sig_id = function (this: FnDecl): DefId | undefined {
  const output = this.output;
  if (output.$ === "Return") {
    const ty = output._0;
    const kind = ty.kind;
    if (kind.$ === "InferDelegation" && kind._0.$ === "Sig") {
      const sig_id = kind._0._0;
      return sig_id;
    }
  }
  return undefined;
};

// rustc: compiler/rustc_hir/src/hir.rs:3939 opt_delegation_info
gen.FnDecl.prototype.opt_delegation_info = function (this: FnDecl): DelegationInfo | undefined {
  const output = this.output;
  if (output.$ === "Return") {
    const ty = output._0;
    const ty_kind = ty.kind;
    if (ty_kind.$ === "InferDelegation" && ty_kind._0.$ === "Sig") {
      const kind = ty_kind._0._1;
      if (kind.$ === "Output") {
        const generics = kind._0;
        return generics;
      }
    }
  }

  return undefined;
};

// rustc: compiler/rustc_hir/src/hir.rs:3950 implicit_self
gen.FnDecl.prototype.implicit_self = function (this: FnDecl): ImplicitSelfKind {
  return this.fn_decl_kind.implicit_self();
};

// rustc: compiler/rustc_hir/src/hir.rs:3954 c_variadic
gen.FnDecl.prototype.c_variadic = function (this: FnDecl): boolean {
  return this.fn_decl_kind.c_variadic();
};

// rustc: compiler/rustc_hir/src/hir.rs:3958 lifetime_elision_allowed
gen.FnDecl.prototype.lifetime_elision_allowed = function (this: FnDecl): boolean {
  return this.fn_decl_kind.lifetime_elision_allowed();
};

// rustc: compiler/rustc_hir/src/hir.rs:3962 splatted
gen.FnDecl.prototype.splatted = function (this: FnDecl): number | undefined {
  return this.fn_decl_kind.splatted_();
};

// rustc: compiler/rustc_hir/src/hir.rs:3966 dummy
FnDecl.dummy = function (span: Span): FnDecl {
  return new gen.FnDecl([], { $: "DefaultReturn", _0: span }, FnDeclFlags.default().set_lifetime_elision_allowed(true));
};

export type ImplicitSelfKind = gen.ImplicitSelfKind;
export const ImplicitSelfKind = {
  ...gen.ImplicitSelfKind,

  /// Does this represent an implicit self?
  // rustc: compiler/rustc_hir/src/hir.rs:3993 has_implicit_self
  has_implicit_self(self: ImplicitSelfKind): boolean {
    return !(self === "None");
  },
};

export type IsAsync = gen.IsAsync;
export const IsAsync = {
  ...gen.IsAsync,

  // rustc: compiler/rustc_hir/src/hir.rs:4005 is_async
  is_async(self: IsAsync): boolean {
    return self.$ === "Async";
  },
};

export type Defaultness = gen.Defaultness;
export const Defaultness = {
  ...gen.Defaultness,

  // rustc: compiler/rustc_hir/src/hir.rs:4021 has_value
  has_value(self: Defaultness): boolean {
    switch (self.$) {
      case "Default":
        return self.has_value;
      case "Final":
        return true;
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:4028 is_final
  is_final(self: Defaultness): boolean {
    // PORT: derived `PartialEq` against the fieldless `Final`: a tag check.
    return self.$ === "Final";
  },

  // rustc: compiler/rustc_hir/src/hir.rs:4032 is_default
  is_default(self: Defaultness): boolean {
    return self.$ === "Default";
  },
};

export type FnRetTy = gen.FnRetTy;
export const FnRetTy = {
  // rustc: compiler/rustc_hir/src/hir.rs:4051 span
  span(self: FnRetTy): Span {
    switch (self.$) {
      case "DefaultReturn":
        return self._0;
      case "Return":
        return self._0.span;
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:4058 is_suggestable_infer_ty
  is_suggestable_infer_ty(self: FnRetTy): Ty | undefined {
    if (self.$ === "Return") {
      const ty = self._0;
      if (ty.is_suggestable_infer_ty()) {
        return ty;
      }
    }
    return undefined;
  },
};

// rustc: compiler/rustc_hir/src/hir.rs:4122 resolutions
gen.UseTree.prototype.resolutions = function* (this: UseTree): Generator<PerNS<Res | undefined>, void, undefined> {
  // PORT: the boxed `iter!` coroutine is a generator (same laziness).
  switch (this.kind.$) {
    case "Glob":
      yield this.prefix.res;
      break;
    case "Single":
      yield this.prefix.res;
      break;
    case "Nested": {
      const items = this.kind.items;
      for (const [item, _, __] of items) {
        for (const res of item.resolutions()) {
          yield res;
        }
      }
      break;
    }
  }
};

/// Gets the `DefId` of the referenced trait. It _must_ actually be a trait or trait alias.
// rustc: compiler/rustc_hir/src/hir.rs:4172 trait_def_id
gen.TraitRef.prototype.trait_def_id = function (this: TraitRef): DefId | undefined {
  const res = this.path.res;
  if (res.$ === "Def" && (res._0.$ === "Trait" || res._0.$ === "TraitAlias")) {
    const did = res._1;
    return did;
  } else if (res.$ === "Err") {
    return undefined;
  } else {
    return panic(`${debug_Res(res, PLAIN, debug_HirId)} did not resolve to a trait or trait alias`);
  }
};

// Still necessary in couple of places
// rustc: compiler/rustc_hir/src/hir.rs:4213 is_positional
gen.FieldDef.prototype.is_positional = function (this: FieldDef): boolean {
  return is_ascii_digit(utf8(this.ident.as_str())[0]!);
};

export type VariantData = gen.VariantData;
export const VariantData = {
  /// Return the fields of this variant.
  // rustc: compiler/rustc_hir/src/hir.rs:4237 fields
  fields(self: VariantData): readonly FieldDef[] {
    switch (self.$) {
      case "Struct":
        return self.fields;
      case "Tuple":
        return self._0;
      default:
        return [];
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:4244 ctor
  ctor(self: VariantData): [CtorKind, HirId, LocalDefId] | undefined {
    switch (self.$) {
      case "Tuple":
        return ["Fn", self._1, self._2];
      case "Unit":
        return ["Const", self._0, self._1];
      case "Struct":
        return undefined;
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:4253 ctor_kind
  ctor_kind(self: VariantData): CtorKind | undefined {
    const ctor = VariantData.ctor(self);
    return ctor === undefined ? undefined : ctor[0];
  },

  /// Return the `HirId` of this variant's constructor, if it has one.
  // rustc: compiler/rustc_hir/src/hir.rs:4259 ctor_hir_id
  ctor_hir_id(self: VariantData): HirId | undefined {
    const ctor = VariantData.ctor(self);
    return ctor === undefined ? undefined : ctor[1];
  },

  /// Return the `LocalDefId` of this variant's constructor, if it has one.
  // rustc: compiler/rustc_hir/src/hir.rs:4265 ctor_def_id
  ctor_def_id(self: VariantData): LocalDefId | undefined {
    const ctor = VariantData.ctor(self);
    return ctor === undefined ? undefined : ctor[2];
  },
};

// rustc: compiler/rustc_hir/src/hir.rs:4280 hir_id
gen.ItemId.prototype.hir_id = function (this: ItemId): HirId {
  // Items are always HIR owners.
  return HirId_make_owner(this.owner_id.def_id);
};

// rustc: compiler/rustc_hir/src/hir.rs:4307 hir_id
gen.Item.prototype.hir_id = function (this: Item): HirId {
  // Items are always HIR owners.
  return HirId_make_owner(this.owner_id.def_id);
};

// rustc: compiler/rustc_hir/src/hir.rs:4313 item_id
gen.Item.prototype.item_id = function (this: Item): ItemId {
  return new gen.ItemId(this.owner_id);
};

/// Check if this is an [`ItemKind::Enum`], [`ItemKind::Struct`] or
/// [`ItemKind::Union`].
// rustc: compiler/rustc_hir/src/hir.rs:4319 is_adt
gen.Item.prototype.is_adt = function (this: Item): boolean {
  return this.kind.$ === "Enum" || this.kind.$ === "Struct" || this.kind.$ === "Union";
};

/// Check if this is an [`ItemKind::Struct`] or [`ItemKind::Union`].
// rustc: compiler/rustc_hir/src/hir.rs:4324 is_struct_or_union
gen.Item.prototype.is_struct_or_union = function (this: Item): boolean {
  return this.kind.$ === "Struct" || this.kind.$ === "Union";
};

// expect_methods_self_kind! { .. } (hir.rs:4328)
// rustc-macro: compiler/rustc_hir/src/hir.rs:4329 expect_extern_crate (expect_methods_self_kind!)
gen.Item.prototype.expect_extern_crate = function (this: Item): [Symbol | undefined, Ident] {
  const k = this.kind;
  if (k.$ !== "ExternCrate") return expect_failed("expect_extern_crate", this, gen.debug_Item);
  return [k._0, k._1];
};

// rustc-macro: compiler/rustc_hir/src/hir.rs:4332 expect_use (expect_methods_self_kind!)
gen.Item.prototype.expect_use = function (this: Item): UseTree {
  const k = this.kind;
  if (k.$ !== "Use") return expect_failed("expect_use", this, gen.debug_Item);
  return k._0;
};

// rustc-macro: compiler/rustc_hir/src/hir.rs:4334 expect_static (expect_methods_self_kind!)
gen.Item.prototype.expect_static = function (this: Item): [Mutability, Ident, Ty, BodyId] {
  const k = this.kind;
  if (k.$ !== "Static") return expect_failed("expect_static", this, gen.debug_Item);
  return [k._0, k._1, k._2, k._3];
};

// rustc-macro: compiler/rustc_hir/src/hir.rs:4337 expect_const (expect_methods_self_kind!)
gen.Item.prototype.expect_const = function (this: Item): [Ident, Generics, Ty, ConstItemRhs] {
  const k = this.kind;
  if (k.$ !== "Const") return expect_failed("expect_const", this, gen.debug_Item);
  return [k._0, k._1, k._2, k._3];
};

// rustc-macro: compiler/rustc_hir/src/hir.rs:4340 expect_fn (expect_methods_self_kind!)
gen.Item.prototype.expect_fn = function (this: Item): [Ident, FnSig, Generics, BodyId] {
  const k = this.kind;
  if (k.$ !== "Fn") return expect_failed("expect_fn", this, gen.debug_Item);
  return [k.ident, k.sig, k.generics, k.body];
};

// rustc-macro: compiler/rustc_hir/src/hir.rs:4343 expect_macro (expect_methods_self_kind!)
gen.Item.prototype.expect_macro = function (this: Item): [Ident, MacroDef, MacroKinds] {
  const k = this.kind;
  if (k.$ !== "Macro") return expect_failed("expect_macro", this, gen.debug_Item);
  return [k._0, k._1, k._2];
};

// rustc-macro: compiler/rustc_hir/src/hir.rs:4346 expect_mod (expect_methods_self_kind!)
gen.Item.prototype.expect_mod = function (this: Item): [Ident, Mod] {
  const k = this.kind;
  if (k.$ !== "Mod") return expect_failed("expect_mod", this, gen.debug_Item);
  return [k._0, k._1];
};

// rustc-macro: compiler/rustc_hir/src/hir.rs:4348 expect_foreign_mod (expect_methods_self_kind!)
gen.Item.prototype.expect_foreign_mod = function (this: Item): [ExternAbi, readonly ForeignItemId[]] {
  const k = this.kind;
  if (k.$ !== "ForeignMod") return expect_failed("expect_foreign_mod", this, gen.debug_Item);
  return [k.abi, k.items];
};

// rustc-macro: compiler/rustc_hir/src/hir.rs:4351 expect_global_asm (expect_methods_self_kind!)
gen.Item.prototype.expect_global_asm = function (this: Item): InlineAsm {
  const k = this.kind;
  if (k.$ !== "GlobalAsm") return expect_failed("expect_global_asm", this, gen.debug_Item);
  return k.asm;
};

// rustc-macro: compiler/rustc_hir/src/hir.rs:4353 expect_ty_alias (expect_methods_self_kind!)
gen.Item.prototype.expect_ty_alias = function (this: Item): [Ident, Generics, Ty] {
  const k = this.kind;
  if (k.$ !== "TyAlias") return expect_failed("expect_ty_alias", this, gen.debug_Item);
  return [k._0, k._1, k._2];
};

// rustc-macro: compiler/rustc_hir/src/hir.rs:4356 expect_enum (expect_methods_self_kind!)
gen.Item.prototype.expect_enum = function (this: Item): [Ident, Generics, EnumDef] {
  const k = this.kind;
  if (k.$ !== "Enum") return expect_failed("expect_enum", this, gen.debug_Item);
  return [k._0, k._1, k._2];
};

// rustc-macro: compiler/rustc_hir/src/hir.rs:4359 expect_struct (expect_methods_self_kind!)
gen.Item.prototype.expect_struct = function (this: Item): [Ident, Generics, VariantData] {
  const k = this.kind;
  if (k.$ !== "Struct") return expect_failed("expect_struct", this, gen.debug_Item);
  return [k._0, k._1, k._2];
};

// rustc-macro: compiler/rustc_hir/src/hir.rs:4362 expect_union (expect_methods_self_kind!)
gen.Item.prototype.expect_union = function (this: Item): [Ident, Generics, VariantData] {
  const k = this.kind;
  if (k.$ !== "Union") return expect_failed("expect_union", this, gen.debug_Item);
  return [k._0, k._1, k._2];
};

// rustc-macro: compiler/rustc_hir/src/hir.rs:4365 expect_trait (expect_methods_self_kind!)
gen.Item.prototype.expect_trait = function (
  this: Item,
): [ImplRestriction, Constness, IsAuto, Safety, Ident, Generics, GenericBounds, readonly TraitItemId[]] {
  const k = this.kind;
  if (k.$ !== "Trait") return expect_failed("expect_trait", this, gen.debug_Item);
  return [k.impl_restriction, k.constness, k.is_auto, k.safety, k.ident, k.generics, k.bounds, k.items];
};

// rustc-macro: compiler/rustc_hir/src/hir.rs:4379 expect_trait_alias (expect_methods_self_kind!)
gen.Item.prototype.expect_trait_alias = function (this: Item): [Constness, Ident, Generics, GenericBounds] {
  const k = this.kind;
  if (k.$ !== "TraitAlias") return expect_failed("expect_trait_alias", this, gen.debug_Item);
  return [k._0, k._1, k._2, k._3];
};

// rustc-macro: compiler/rustc_hir/src/hir.rs:4382 expect_impl (expect_methods_self_kind!)
gen.Item.prototype.expect_impl = function (this: Item): Impl {
  const k = this.kind;
  if (k.$ !== "Impl") return expect_failed("expect_impl", this, gen.debug_Item);
  return k._0;
};

// rustc-macro: compiler/rustc_hir/src/hir.rs:4384 expect_test_binder_constraints (expect_methods_self_kind!)
gen.Item.prototype.expect_test_binder_constraints = function (this: Item): [Generics, TestBinderBody] {
  const k = this.kind;
  if (k.$ !== "TestBinderConstraints") return expect_failed("expect_test_binder_constraints", this, gen.debug_Item);
  return [k.generics, k.body];
};

export type Safety = gen.Safety;
export const Safety = {
  ...gen.Safety,

  // rustc: compiler/rustc_hir/src/hir.rs:4402 prefix_str
  prefix_str(self: Safety): string {
    switch (self) {
      case "Unsafe":
        return "unsafe ";
      case "Safe":
        return "";
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:4410 is_unsafe
  is_unsafe(self: Safety): boolean {
    return !Safety.is_safe(self);
  },

  // rustc: compiler/rustc_hir/src/hir.rs:4415 is_safe
  is_safe(self: Safety): boolean {
    switch (self) {
      case "Unsafe":
        return false;
      case "Safe":
        return true;
    }
  },
};

// rustc: compiler/rustc_hir/src/hir.rs:4424 fmt
export function display_Safety(v: Safety): string {
  switch (v) {
    case "Unsafe":
      return "unsafe";
    case "Safe":
      return "safe";
  }
}

export type Constness = gen.Constness;
export const Constness = {
  ...gen.Constness,

  /// This impl exists as an optimization so that metadata deserialization can
  /// store the value directly and not have to encode it wrapped in another `Option`.
  // rustc: compiler/rustc_hir/src/hir.rs:4441 default
  default(): Constness {
    return { $: "Const", always: false };
  },
};

// rustc: compiler/rustc_hir/src/hir.rs:4447 fmt
export function display_Constness(v: Constness): string {
  if (v.$ === "Const" && v.always === true) {
    return "comptime";
  } else if (v.$ === "Const" && v.always === false) {
    return "const";
  } else {
    // Self::NotConst
    return "non-const";
  }
}

export type HeaderSafety = gen.HeaderSafety;
export const HeaderSafety = {
  ...gen.HeaderSafety,

  // rustc: compiler/rustc_hir/src/hir.rs:4494 from
  from_Safety(v: Safety): HeaderSafety {
    return { $: "Normal", _0: v };
  },
};

// rustc: compiler/rustc_hir/src/hir.rs:4508 is_async
gen.FnHeader.prototype.is_async = function (this: gen.FnHeader): boolean {
  return this.asyncness.$ === "Async";
};

// rustc: compiler/rustc_hir/src/hir.rs:4512 is_unsafe
gen.FnHeader.prototype.is_unsafe = function (this: gen.FnHeader): boolean {
  return Safety.is_unsafe(this.safety_());
};

// rustc: compiler/rustc_hir/src/hir.rs:4516 is_safe
gen.FnHeader.prototype.is_safe = function (this: gen.FnHeader): boolean {
  return Safety.is_safe(this.safety_());
};

// PORT: `safety_` (clashes with the `safety` field).
// rustc: compiler/rustc_hir/src/hir.rs:4520 safety
gen.FnHeader.prototype.safety_ = function (this: gen.FnHeader): Safety {
  const safety = this.safety;
  switch (safety.$) {
    case "SafeTargetFeatures":
      return Safety.Unsafe;
    case "Normal":
      return safety._0;
  }
};

export type ItemKind = gen.ItemKind;
export const ItemKind = {
  // rustc: compiler/rustc_hir/src/hir.rs:4678 ident
  ident(self: ItemKind): Ident | undefined {
    switch (self.$) {
      case "ExternCrate":
        return self._1;
      case "Use":
        if (self._0.kind.$ === "Single") {
          return self._0.kind._0;
        }
        // ItemKind::Use(UseTree { kind: UseKind::Glob | UseKind::Nested { .. }, .. })
        return undefined;
      case "Static":
        return self._1;
      case "Const":
        return self._0;
      case "Fn":
        return self.ident;
      case "Macro":
        return self._0;
      case "Mod":
        return self._0;
      case "TyAlias":
        return self._0;
      case "Enum":
        return self._0;
      case "Struct":
        return self._0;
      case "Union":
        return self._0;
      case "Trait":
        return self.ident;
      case "TraitAlias":
        return self._1;

      case "ForeignMod":
      case "GlobalAsm":
      case "Impl":
      case "TestBinderConstraints":
        return undefined;
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:4702 generics
  generics(self: ItemKind): Generics | undefined {
    switch (self.$) {
      case "Fn":
        return self.generics;
      case "TyAlias":
        return self._1;
      case "Const":
        return self._1;
      case "Enum":
        return self._1;
      case "Struct":
        return self._1;
      case "Union":
        return self._1;
      case "Trait":
        return self.generics;
      case "TraitAlias":
        return self._2;
      case "Impl":
        return self._0.generics;
      case "TestBinderConstraints":
        return self.generics;
      default:
        return undefined;
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:4718 recovered
  recovered(self: ItemKind): boolean {
    if (self.$ === "Struct" && self._2.$ === "Struct" && self._2.recovered.$ === "Yes") {
      return true;
    } else if (self.$ === "Union" && self._2.$ === "Struct" && self._2.recovered.$ === "Yes") {
      return true;
    } else if (self.$ === "Enum") {
      const def = self._2;
      return def.variants.some((v: Variant) => {
        const data = v.data;
        if (data.$ === "Struct" && data.recovered.$ === "Yes") {
          return true;
        } else {
          return false;
        }
      });
    } else {
      return false;
    }
  },
};

// rustc: compiler/rustc_hir/src/hir.rs:4749 hir_id
gen.ForeignItemId.prototype.hir_id = function (this: ForeignItemId): HirId {
  // Items are always HIR owners.
  return HirId_make_owner(this.owner_id.def_id);
};

// rustc: compiler/rustc_hir/src/hir.rs:4766 hir_id
gen.ForeignItem.prototype.hir_id = function (this: ForeignItem): HirId {
  // Items are always HIR owners.
  return HirId_make_owner(this.owner_id.def_id);
};

// rustc: compiler/rustc_hir/src/hir.rs:4771 foreign_item_id
gen.ForeignItem.prototype.foreign_item_id = function (this: ForeignItem): ForeignItemId {
  return new gen.ForeignItemId(this.owner_id);
};

export type OwnerNode = gen.OwnerNode;
export const OwnerNode = {
  ...gen.OwnerNode,

  // rustc: compiler/rustc_hir/src/hir.rs:4824 span
  span(self: OwnerNode): Span {
    switch (self.$) {
      case "Item":
      case "ForeignItem":
      case "ImplItem":
      case "TraitItem":
        return self._0.span;
      case "Crate":
        return self._0.spans.inner_span;
      case "Synthetic":
        return unreachable();
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:4835 fn_sig
  fn_sig(self: OwnerNode): FnSig | undefined {
    if (self.$ === "TraitItem" && self._0.kind.$ === "Fn") {
      return self._0.kind._0;
    } else if (self.$ === "ImplItem" && self._0.kind.$ === "Fn") {
      return self._0.kind._0;
    } else if (self.$ === "Item" && self._0.kind.$ === "Fn") {
      return self._0.kind.sig;
    } else if (self.$ === "ForeignItem" && self._0.kind.$ === "Fn") {
      return self._0.kind._0;
    } else {
      return undefined;
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:4847 fn_decl
  fn_decl(self: OwnerNode): gen.FnDecl | undefined {
    let fn_sig: FnSig;
    if (self.$ === "TraitItem" && self._0.kind.$ === "Fn") {
      fn_sig = self._0.kind._0;
    } else if (self.$ === "ImplItem" && self._0.kind.$ === "Fn") {
      fn_sig = self._0.kind._0;
    } else if (self.$ === "Item" && self._0.kind.$ === "Fn") {
      fn_sig = self._0.kind.sig;
    } else if (self.$ === "ForeignItem" && self._0.kind.$ === "Fn") {
      fn_sig = self._0.kind._0;
    } else {
      return undefined;
    }
    return fn_sig.decl;
  },

  // rustc: compiler/rustc_hir/src/hir.rs:4859 body_id
  body_id(self: OwnerNode): BodyId | undefined {
    if (self.$ === "Item") {
      const kind = self._0.kind;
      if (kind.$ === "Static") return kind._3;
      if (kind.$ === "Const" && kind._3.$ === "Body") return kind._3._0;
      if (kind.$ === "Fn") return kind.body;
    } else if (self.$ === "TraitItem") {
      const kind = self._0.kind;
      if (kind.$ === "Fn" && kind._1.$ === "Provided") return kind._1._0;
      if (kind.$ === "Const" && kind._1 !== undefined && kind._1.$ === "Body") return kind._1._0;
    } else if (self.$ === "ImplItem") {
      const kind = self._0.kind;
      if (kind.$ === "Fn") return kind._1;
      if (kind.$ === "Const" && kind._1.$ === "Body") return kind._1._0;
    }
    return undefined;
  },

  // rustc: compiler/rustc_hir/src/hir.rs:4882 generics
  generics(self: OwnerNode): Generics | undefined {
    return Node.generics(Node.from_OwnerNode(self));
  },

  // rustc: compiler/rustc_hir/src/hir.rs:4886 def_id
  def_id(self: OwnerNode): OwnerId {
    switch (self.$) {
      case "Item":
      case "TraitItem":
      case "ImplItem":
      case "ForeignItem":
        return self._0.owner_id;
      case "Crate":
        return CRATE_HIR_ID.owner;
      case "Synthetic":
        return unreachable();
    }
  },

  /// Check if node is an impl block.
  // rustc: compiler/rustc_hir/src/hir.rs:4898 is_impl_block
  is_impl_block(self: OwnerNode): boolean {
    return self.$ === "Item" && self._0.kind.$ === "Impl";
  },

  // expect_methods_self! { .. } (hir.rs:4902)
  // rustc-macro: compiler/rustc_hir/src/hir.rs:4903 expect_item (expect_methods_self!)
  expect_item(self: OwnerNode): Item {
    if (self.$ !== "Item") return expect_failed("expect_item", self, gen.debug_OwnerNode);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:4904 expect_foreign_item (expect_methods_self!)
  expect_foreign_item(self: OwnerNode): ForeignItem {
    if (self.$ !== "ForeignItem") return expect_failed("expect_foreign_item", self, gen.debug_OwnerNode);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:4905 expect_impl_item (expect_methods_self!)
  expect_impl_item(self: OwnerNode): ImplItem {
    if (self.$ !== "ImplItem") return expect_failed("expect_impl_item", self, gen.debug_OwnerNode);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:4906 expect_trait_item (expect_methods_self!)
  expect_trait_item(self: OwnerNode): TraitItem {
    if (self.$ !== "TraitItem") return expect_failed("expect_trait_item", self, gen.debug_OwnerNode);
    return self._0;
  },

  // rustc: compiler/rustc_hir/src/hir.rs:4911 from
  from_Item(val: Item): OwnerNode {
    return { $: "Item", _0: val };
  },

  // rustc: compiler/rustc_hir/src/hir.rs:4917 from
  from_ForeignItem(val: ForeignItem): OwnerNode {
    return { $: "ForeignItem", _0: val };
  },

  // rustc: compiler/rustc_hir/src/hir.rs:4923 from
  from_ImplItem(val: ImplItem): OwnerNode {
    return { $: "ImplItem", _0: val };
  },

  // rustc: compiler/rustc_hir/src/hir.rs:4929 from
  from_TraitItem(val: TraitItem): OwnerNode {
    return { $: "TraitItem", _0: val };
  },
};

export type Node = gen.Node;
export const Node = {
  ...gen.Node,

  // rustc: compiler/rustc_hir/src/hir.rs:4935 from
  from_OwnerNode(val: OwnerNode): Node {
    switch (val.$) {
      case "Item":
        return { $: "Item", _0: val._0 };
      case "ForeignItem":
        return { $: "ForeignItem", _0: val._0 };
      case "ImplItem":
        return { $: "ImplItem", _0: val._0 };
      case "TraitItem":
        return { $: "TraitItem", _0: val._0 };
      case "Crate":
        return { $: "Crate", _0: val._0 };
      case "Synthetic":
        return gen.Node.Synthetic;
    }
  },

  /// Get the identifier of this `Node`, if applicable.
  ///
  /// # Edge cases
  ///
  /// Calling `.ident()` on a [`Node::Ctor`] will return `None`
  /// because `Ctor`s do not have identifiers themselves.
  /// Instead, call `.ident()` on the parent struct/variant, like so:
  ///
  /// ```ignore (illustrative)
  /// ctor
  ///     .ctor_hir_id()
  ///     .map(|ctor_id| tcx.parent_hir_node(ctor_id))
  ///     .and_then(|parent| parent.ident())
  /// ```
  // rustc: compiler/rustc_hir/src/hir.rs:5011 ident
  ident(self: Node): Ident | undefined {
    switch (self.$) {
      case "Item":
        return ItemKind.ident(self._0.kind);
      case "TraitItem":
      case "ImplItem":
      case "ForeignItem":
        return self._0.ident;
      case "NestedUseTree":
        if (self._0.kind.$ === "Single") {
          return self._0.kind._0;
        }
        // Node::NestedUseTree(_) => None
        return undefined;
      case "Field":
      case "Variant":
      case "PathSegment":
        return self._0.ident;
      case "Lifetime":
        return self._0.ident;
      case "GenericParam":
        return ParamName.ident(self._0.name);
      case "AssocItemConstraint":
        return self._0.ident;
      case "PatField":
        return self._0.ident;
      case "ExprField":
        return self._0.ident;
      case "ConstArgExprField":
        return self._0.field;
      case "PreciseCapturingNonLifetimeArg":
        return self._0.ident;
      case "Param":
      case "AnonConst":
      case "ConstBlock":
      case "ConstArg":
      case "Expr":
      case "Stmt":
      case "Block":
      case "Ctor":
      case "Pat":
      case "TyPat":
      case "PatExpr":
      case "Arm":
      case "LetStmt":
      case "Crate":
      case "Ty":
      case "TraitRef":
      case "OpaqueTy":
      case "Infer":
      case "WherePredicate":
      case "TestBinderForall":
      case "TestBinderExists":
      case "TestBinderBoundTypeConstraint":
      case "Synthetic":
      case "Err":
        return undefined;
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:5056 fn_decl
  fn_decl(self: Node): gen.FnDecl | undefined {
    if (self.$ === "TraitItem" && self._0.kind.$ === "Fn") {
      return self._0.kind._0.decl;
    } else if (self.$ === "ImplItem" && self._0.kind.$ === "Fn") {
      return self._0.kind._0.decl;
    } else if (self.$ === "Item" && self._0.kind.$ === "Fn") {
      return self._0.kind.sig.decl;
    } else if (self.$ === "ForeignItem" && self._0.kind.$ === "Fn") {
      return self._0.kind._0.decl;
    } else if (self.$ === "Expr" && self._0.kind.$ === "Closure") {
      return self._0.kind._0.fn_decl;
    } else {
      return undefined;
    }
  },

  /// Get a `hir::Impl` if the node is an impl block for the given `trait_def_id`.
  // rustc: compiler/rustc_hir/src/hir.rs:5072 impl_block_of_trait
  impl_block_of_trait(self: Node, trait_def_id: DefId): Impl | undefined {
    if (self.$ === "Item" && self._0.kind.$ === "Impl") {
      const impl_block = self._0.kind._0;
      const of_trait = impl_block.of_trait;
      if (of_trait !== undefined) {
        const trait_id = of_trait.trait_ref.trait_def_id();
        if (trait_id !== undefined && DefId_eq(trait_id, trait_def_id)) {
          return impl_block;
        }
      }
    }
    return undefined;
  },

  // rustc: compiler/rustc_hir/src/hir.rs:5084 fn_sig
  fn_sig(self: Node): FnSig | undefined {
    if (self.$ === "TraitItem" && self._0.kind.$ === "Fn") {
      return self._0.kind._0;
    } else if (self.$ === "ImplItem" && self._0.kind.$ === "Fn") {
      return self._0.kind._0;
    } else if (self.$ === "Item" && self._0.kind.$ === "Fn") {
      return self._0.kind.sig;
    } else if (self.$ === "ForeignItem" && self._0.kind.$ === "Fn") {
      return self._0.kind._0;
    } else {
      return undefined;
    }
  },

  /// Get the type for constants, assoc types, type aliases and statics.
  // rustc: compiler/rustc_hir/src/hir.rs:5097 ty
  ty(self: Node): Ty | undefined {
    switch (self.$) {
      case "Item": {
        const kind = self._0.kind;
        switch (kind.$) {
          case "TyAlias":
            return kind._2;
          case "Static":
            return kind._2;
          case "Const":
            return kind._2;
          case "Impl":
            return kind._0.self_ty;
          default:
            return undefined;
        }
      }
      case "TraitItem": {
        const kind = self._0.kind;
        switch (kind.$) {
          case "Const":
            return kind._0;
          case "Type":
            return kind._1;
          default:
            return undefined;
        }
      }
      case "ImplItem": {
        const kind = self._0.kind;
        switch (kind.$) {
          case "Const":
            return kind._0;
          case "Type":
            return kind._0;
          default:
            return undefined;
        }
      }
      case "ForeignItem": {
        const kind = self._0.kind;
        switch (kind.$) {
          case "Static":
            return kind._0;
          default:
            return undefined;
        }
      }
      case "GenericParam": {
        const kind = self._0.kind;
        switch (kind.$) {
          case "Lifetime":
            return undefined;
          case "Type":
            return kind.default;
          case "Const":
            return kind.ty;
        }
      }
      case "Field":
        return self._0.ty;
      default:
        return undefined;
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:5130 alias_ty
  alias_ty(self: Node): Ty | undefined {
    if (self.$ === "Item" && self._0.kind.$ === "TyAlias") {
      return self._0.kind._2;
    } else {
      return undefined;
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:5138 associated_body
  associated_body(self: Node): [LocalDefId, BodyId] | undefined {
    if (self.$ === "Item") {
      const owner_id = self._0.owner_id;
      const kind = self._0.kind;
      if (kind.$ === "Const" && kind._3.$ === "Body") return [owner_id.def_id, kind._3._0];
      if (kind.$ === "Static") return [owner_id.def_id, kind._3];
      if (kind.$ === "Fn") return [owner_id.def_id, kind.body];
    } else if (self.$ === "TraitItem") {
      const owner_id = self._0.owner_id;
      const kind = self._0.kind;
      if (kind.$ === "Const" && kind._1 !== undefined && kind._1.$ === "Body") return [owner_id.def_id, kind._1._0];
      if (kind.$ === "Fn" && kind._1.$ === "Provided") return [owner_id.def_id, kind._1._0];
    } else if (self.$ === "ImplItem") {
      const owner_id = self._0.owner_id;
      const kind = self._0.kind;
      if (kind.$ === "Const" && kind._1.$ === "Body") return [owner_id.def_id, kind._1._0];
      if (kind.$ === "Fn") return [owner_id.def_id, kind._1];
    }

    if (self.$ === "Item" && self._0.kind.$ === "GlobalAsm") {
      return [self._0.owner_id.def_id, self._0.kind.fake_body];
    }

    if (self.$ === "Expr" && self._0.kind.$ === "Closure") {
      const closure: Closure = self._0.kind._0;
      return [closure.def_id, closure.body];
    }

    if (self.$ === "AnonConst") {
      const constant: AnonConst = self._0;
      return [constant.def_id, constant.body];
    }
    if (self.$ === "ConstBlock") {
      const constant: ConstBlock = self._0;
      return [constant.def_id, constant.body];
    }

    return undefined;
  },

  // rustc: compiler/rustc_hir/src/hir.rs:5176 body_id
  body_id(self: Node): BodyId | undefined {
    const associated_body = Node.associated_body(self);
    if (associated_body === undefined) return undefined;
    return associated_body[1];
  },

  // rustc: compiler/rustc_hir/src/hir.rs:5180 generics
  generics(self: Node): Generics | undefined {
    if (self.$ === "ForeignItem" && self._0.kind.$ === "Fn") {
      return self._0.kind._2;
    } else if (self.$ === "TraitItem" || self.$ === "ImplItem") {
      return self._0.generics;
    } else if (self.$ === "Item") {
      return ItemKind.generics(self._0.kind);
    } else {
      return undefined;
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:5192 as_owner
  as_owner(self: Node): OwnerNode | undefined {
    switch (self.$) {
      case "Item":
        return { $: "Item", _0: self._0 };
      case "ForeignItem":
        return { $: "ForeignItem", _0: self._0 };
      case "TraitItem":
        return { $: "TraitItem", _0: self._0 };
      case "ImplItem":
        return { $: "ImplItem", _0: self._0 };
      case "Crate":
        return { $: "Crate", _0: self._0 };
      case "Synthetic":
        return gen.OwnerNode.Synthetic;
      default:
        return undefined;
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:5204 fn_kind
  fn_kind(self: Node): FnKind | undefined {
    switch (self.$) {
      case "Item": {
        const i = self._0;
        const kind = i.kind;
        if (kind.$ === "Fn") {
          const { ident, sig, generics } = kind;
          return { $: "ItemFn", _0: ident, _1: generics, _2: sig.header };
        }
        return undefined;
      }
      case "TraitItem": {
        const ti = self._0;
        const kind = ti.kind;
        if (kind.$ === "Fn") {
          const sig = kind._0;
          return { $: "Method", _0: ti.ident, _1: sig };
        }
        return undefined;
      }
      case "ImplItem": {
        const ii = self._0;
        const kind = ii.kind;
        if (kind.$ === "Fn") {
          const sig = kind._0;
          return { $: "Method", _0: ii.ident, _1: sig };
        }
        return undefined;
      }
      case "Expr": {
        const e = self._0;
        if (e.kind.$ === "Closure") {
          return FnKind.Closure;
        }
        return undefined;
      }
      default:
        return undefined;
    }
  },

  /// For expressions, patterns, and types return the path if it's a path expr/pat/ty.
  // rustc: compiler/rustc_hir/src/hir.rs:5229 path
  path(self: Node): QPath | undefined {
    if (self.$ === "Ty" && self._0.kind.$ === "Path") {
      return self._0.kind._0;
    } else if (self.$ === "Expr" && self._0.kind.$ === "Path") {
      return self._0.kind._0;
    } else if (self.$ === "PatExpr" && self._0.kind.$ === "Path") {
      return self._0.kind._0;
    } else {
      return undefined;
    }
  },

  // expect_methods_self! { .. } (hir.rs:5238)
  // rustc-macro: compiler/rustc_hir/src/hir.rs:5239 expect_param (expect_methods_self!)
  expect_param(self: Node): Param {
    if (self.$ !== "Param") return expect_failed("expect_param", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5240 expect_item (expect_methods_self!)
  expect_item(self: Node): Item {
    if (self.$ !== "Item") return expect_failed("expect_item", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5241 expect_foreign_item (expect_methods_self!)
  expect_foreign_item(self: Node): ForeignItem {
    if (self.$ !== "ForeignItem") return expect_failed("expect_foreign_item", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5242 expect_trait_item (expect_methods_self!)
  expect_trait_item(self: Node): TraitItem {
    if (self.$ !== "TraitItem") return expect_failed("expect_trait_item", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5243 expect_impl_item (expect_methods_self!)
  expect_impl_item(self: Node): ImplItem {
    if (self.$ !== "ImplItem") return expect_failed("expect_impl_item", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5244 expect_variant (expect_methods_self!)
  expect_variant(self: Node): Variant {
    if (self.$ !== "Variant") return expect_failed("expect_variant", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5245 expect_field (expect_methods_self!)
  expect_field(self: Node): FieldDef {
    if (self.$ !== "Field") return expect_failed("expect_field", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5246 expect_anon_const (expect_methods_self!)
  expect_anon_const(self: Node): AnonConst {
    if (self.$ !== "AnonConst") return expect_failed("expect_anon_const", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5247 expect_inline_const (expect_methods_self!)
  expect_inline_const(self: Node): ConstBlock {
    if (self.$ !== "ConstBlock") return expect_failed("expect_inline_const", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5248 expect_expr (expect_methods_self!)
  expect_expr(self: Node): Expr {
    if (self.$ !== "Expr") return expect_failed("expect_expr", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5249 expect_expr_field (expect_methods_self!)
  expect_expr_field(self: Node): ExprField {
    if (self.$ !== "ExprField") return expect_failed("expect_expr_field", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5250 expect_stmt (expect_methods_self!)
  expect_stmt(self: Node): Stmt {
    if (self.$ !== "Stmt") return expect_failed("expect_stmt", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5251 expect_path_segment (expect_methods_self!)
  expect_path_segment(self: Node): PathSegment {
    if (self.$ !== "PathSegment") return expect_failed("expect_path_segment", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5252 expect_ty (expect_methods_self!)
  expect_ty(self: Node): Ty {
    if (self.$ !== "Ty") return expect_failed("expect_ty", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5253 expect_assoc_item_constraint (expect_methods_self!)
  expect_assoc_item_constraint(self: Node): AssocItemConstraint {
    if (self.$ !== "AssocItemConstraint") return expect_failed("expect_assoc_item_constraint", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5254 expect_trait_ref (expect_methods_self!)
  expect_trait_ref(self: Node): TraitRef {
    if (self.$ !== "TraitRef") return expect_failed("expect_trait_ref", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5255 expect_opaque_ty (expect_methods_self!)
  expect_opaque_ty(self: Node): OpaqueTy {
    if (self.$ !== "OpaqueTy") return expect_failed("expect_opaque_ty", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5256 expect_pat (expect_methods_self!)
  expect_pat(self: Node): Pat {
    if (self.$ !== "Pat") return expect_failed("expect_pat", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5257 expect_pat_field (expect_methods_self!)
  expect_pat_field(self: Node): PatField {
    if (self.$ !== "PatField") return expect_failed("expect_pat_field", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5258 expect_arm (expect_methods_self!)
  expect_arm(self: Node): Arm {
    if (self.$ !== "Arm") return expect_failed("expect_arm", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5259 expect_block (expect_methods_self!)
  expect_block(self: Node): Block {
    if (self.$ !== "Block") return expect_failed("expect_block", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5260 expect_let_stmt (expect_methods_self!)
  expect_let_stmt(self: Node): LetStmt {
    if (self.$ !== "LetStmt") return expect_failed("expect_let_stmt", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5261 expect_ctor (expect_methods_self!)
  expect_ctor(self: Node): VariantData {
    if (self.$ !== "Ctor") return expect_failed("expect_ctor", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5262 expect_lifetime (expect_methods_self!)
  expect_lifetime(self: Node): Lifetime {
    if (self.$ !== "Lifetime") return expect_failed("expect_lifetime", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5263 expect_generic_param (expect_methods_self!)
  expect_generic_param(self: Node): GenericParam {
    if (self.$ !== "GenericParam") return expect_failed("expect_generic_param", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5264 expect_crate (expect_methods_self!)
  expect_crate(self: Node): Mod {
    if (self.$ !== "Crate") return expect_failed("expect_crate", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5265 expect_infer (expect_methods_self!)
  expect_infer(self: Node): InferArg {
    if (self.$ !== "Infer") return expect_failed("expect_infer", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5266 expect_closure (expect_methods_self!)
  expect_closure(self: Node): Closure {
    if (!(self.$ === "Expr" && self._0.kind.$ === "Closure")) {
      return expect_failed("expect_closure", self, gen.debug_Node);
    }
    return self._0.kind._0;
  },
};

// mod size_asserts: `static_assert_size!`s (64-bit layout checks), nothing to port.
// #[cfg(test)] mod tests: hir/tests.rs.
