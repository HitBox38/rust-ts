// Port of compiler/rustc_hir/src/hir.rs
//
// Types, derived Debug / Clone and derive(StableHash) are generated (tools/codegen/types.ts, set `rustc_hir`) into
// hir.gen.ts and stable_hash.gen.ts. This module re-exports them and adds the inherent fns (struct methods on the
// generated classes via `declare module` + prototype, statics through `Object.assign`; enum methods on the companion
// consts, PORTING §8), the manual `Debug` impls (`OwnerNodes`, `DotDotPos`, `FnDeclFlags`) and the `Display` impls
// (`display_<T>`).
//
// PORT: the `Unambig` parameter (`()` or the uninhabited `AmbigArg`) is erased to `null` / `never`; the
// `as_unambig_*` / `try_as_ambig_*` transmutes are casts.
// The fns that need `intravisit` (`ConstItemRhs::span`, hir.rs:430; `Ty::find_self_aliases`, :3261 + its
// `visit_ty`, :3265; `Node::fn_kind`, :5204) are lane hir-visit's, merged in by merge-w13.
import type { ExternAbi } from "../rustc_abi/extern_abi.ts";
import {
  BinOpKind,
  BoundConstness,
  BoundPolarity,
  type LitKind,
  type IsAuto,
  type MacroDef,
  type ParamKindOrd,
  type Recovered,
  type TraitObjectSyntax,
} from "../rustc_ast/lib.ts";
import type { ExprPrecedence } from "../rustc_ast/util/parser.ts";
import { FloatTy, IntTy, type Movability, type Mutability, UintTy } from "../rustc_ast_ir/lib.ts";
import type { Attribute } from "../rustc_attr_ir/lib.ts";
import { debug_Fingerprint, Fingerprint } from "../rustc_data_structures/fingerprint.ts";
import { debug_SortedMap, SortedMap } from "../rustc_data_structures/sorted_map.ts";
import type { DiagArgValue, PathBuf } from "../rustc_error_messages/lib.ts";
import { CRATE_HIR_ID, debug_HirId, debug_ItemLocalId, HirId_eq, HirId_INVALID, HirId_make_owner, type HirId, ItemLocalId, type OwnerId } from "../rustc_hir_id/lib.ts";
import { type DefId, DefId_eq, LocalDefId } from "../rustc_span/def_id.ts";
import { DesugaringKind } from "../rustc_span/hygiene.ts";
import { BytePos, DUMMY_SP, type ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import { Ident, kw, Symbol, sym } from "../rustc_span/symbol.ts";
import { InlineAsmRegOrRegClass as asm_InlineAsmRegOrRegClass, type InlineAsmRegClass as asm_InlineAsmRegClass } from "../rustc_target/asm/mod.ts";
import { type Debug, debug_list, debug_option, debug_int, debug_str, debug_struct, debug_tuple, type Fmt, format_debug, PLAIN } from "../std/fmt.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { assert, panic, unreachable, unwrap } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { CtorKind, debug_Res, type DefKind, type MacroKinds, type PerNS, type Res, Res_eq } from "./def.ts";
import * as gen from "./hir.gen.ts";
import { FnKind, type HirTyCtxt, Visitor, walk_ty } from "./intravisit.ts";
import {
  AttributeMap,
  type Block,
  Body,
  type BodyId,
  clone_FnDeclFlags,
  type ConstArg,
  debug_ForeignItem,
  debug_ImplItem,
  debug_Item,
  debug_Node,
  debug_OwnerNode,
  debug_ParentedNode,
  debug_TraitItem,
  DotDotPos,
  type EnumDef,
  Expr,
  FieldDef,
  FnDecl,
  FnDeclFlags,
  FnHeader,
  type FnSig,
  ForeignItem,
  ForeignItemId,
  type ForeignItemKind,
  GenericArgs,
  type GenericBounds,
  GenericParam,
  Generics,
  type Impl,
  ImplItem,
  ImplItemId,
  type ImplItemKind,
  InferArg,
  InlineAsm,
  Item,
  ItemId,
  Lifetime,
  type Mod,
  type OwnerInfo,
  OwnerNodes,
  type ParentedNode,
  Pat,
  Path,
  PathSegment,
  type TraitFn,
  type TraitImplHeader,
  TraitItem,
  TraitItemId,
  type TraitItemKind,
  TraitRef,
  Ty,
  type TyKind,
  type UseKind,
  UseTree,
  WhereBoundPredicate,
  type WherePredicate,
  WhereRegionPredicate,
  type AmbigArg,
  type AssocItemConstraint,
  type DelegationInfo,
  type SplattedArgIndexError,
  type UsePath,
} from "./hir.gen.ts";

export * from "./hir.gen.ts";

/** `Ord for ItemLocalId` (a `u32` newtype), the comparator of the `SortedMap<ItemLocalId, _>`s of HIR. */
export function ItemLocalId_cmp(a: ItemLocalId, b: ItemLocalId): number {
  return a - b;
}

/** `impl Debug for ()` (the `Unambig` type argument of `Ty` / `ConstArg` / `TyKind` / `ConstArgKind`). */
export const debug_unit: Debug<null> = () => "()";

// ---- LifetimeSyntax ---------------------------------------------------------------------------------------------

export type LifetimeSyntax = gen.LifetimeSyntax;
export const LifetimeSyntax = {
  ...gen.LifetimeSyntax,

  // impl From<Ident> for LifetimeSyntax
  // rustc: compiler/rustc_hir/src/hir.rs:88 from
  from(ident: Ident): LifetimeSyntax {
    const name = ident.name;

    if (name === sym.empty) {
      return unreachable("internal error: entered unreachable code: A lifetime name should never be empty");
    } else if (name === kw.UnderscoreLifetime) {
      return gen.LifetimeSyntax.ExplicitAnonymous;
    } else {
      // debug_assert!(name.as_str().starts_with('\''));
      return gen.LifetimeSyntax.ExplicitBound;
    }
  },
};

// ---- ParamName / LifetimeKind -----------------------------------------------------------------------------------

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

export type LifetimeKind = gen.LifetimeKind;
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

  /** `#[derive(PartialEq)]` (`LocalDefId` is a handle; `ErrorGuaranteed` compares equal). */
  eq(a: LifetimeKind, b: LifetimeKind): boolean {
    if (a.$ !== b.$) return false;
    if (a.$ === "Param") return a._0 === (b as typeof a)._0;
    return true;
  },
};

// ---- Lifetime ---------------------------------------------------------------------------------------------------

// impl fmt::Display for Lifetime
// rustc: compiler/rustc_hir/src/hir.rs:266 fmt
export function display_Lifetime(self: Lifetime): string {
  return Symbol.as_str(self.ident.name);
}

declare module "./hir.gen.ts" {
  interface Lifetime {
    is_elided(): boolean;
    is_anonymous(): boolean;
    is_implicit(): boolean;
    is_static(): boolean;
    suggestion(new_lifetime: string): [Span, string];
  }
  namespace Lifetime {
    function new_(hir_id: HirId, ident: Ident, kind: LifetimeKind, source: gen.LifetimeSource, syntax: LifetimeSyntax): Lifetime;
    export { new_ as new };
  }
}

Object.assign(Lifetime, {
  // rustc: compiler/rustc_hir/src/hir.rs:272 new
  new(hir_id: HirId, ident: Ident, kind: LifetimeKind, source: gen.LifetimeSource, syntax: LifetimeSyntax): Lifetime {
    const lifetime = new Lifetime(hir_id, ident, kind, source, syntax);

    // Sanity check: elided lifetimes form a strict subset of anonymous lifetimes.
    // PORT: `#[cfg(debug_assertions)]` match on `(is_elided, is_anonymous)`; rustc ships without debug assertions.

    return lifetime;
  },
});

// rustc: compiler/rustc_hir/src/hir.rs:293 is_elided
Lifetime.prototype.is_elided = function (this: Lifetime): boolean {
  return LifetimeKind.is_elided(this.kind);
};

// rustc: compiler/rustc_hir/src/hir.rs:297 is_anonymous
Lifetime.prototype.is_anonymous = function (this: Lifetime): boolean {
  return this.ident.name === kw.UnderscoreLifetime;
};

// rustc: compiler/rustc_hir/src/hir.rs:301 is_implicit
Lifetime.prototype.is_implicit = function (this: Lifetime): boolean {
  return this.syntax === "Implicit";
};

// rustc: compiler/rustc_hir/src/hir.rs:305 is_static
Lifetime.prototype.is_static = function (this: Lifetime): boolean {
  return this.kind.$ === "Static";
};

// rustc: compiler/rustc_hir/src/hir.rs:309 suggestion
Lifetime.prototype.suggestion = function (this: Lifetime, new_lifetime: string): [Span, string] {
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

  return unreachable(`internal error: entered unreachable code: can't suggest for a implicit lifetime of ${format_debug(source, gen.debug_LifetimeSource, PLAIN)}`);
};

// ---- Path / PathSegment -----------------------------------------------------------------------------------------

declare module "./hir.gen.ts" {
  interface Path<R> {
    is_global(): boolean;
  }
  interface PathSegment {
    args_(): GenericArgs;
  }
  namespace PathSegment {
    function new_(ident: Ident, hir_id: HirId, res: Res): PathSegment;
    export { new_ as new };
    export function invalid(): PathSegment;
  }
}

// rustc: compiler/rustc_hir/src/hir.rs:360 is_global
Path.prototype.is_global = function (this: Path): boolean {
  const segment = this.segments[0];
  return segment !== undefined && segment.ident.name === kw.PathRoot;
};

Object.assign(PathSegment, {
  /// Converts an identifier to the corresponding segment.
  // rustc: compiler/rustc_hir/src/hir.rs:396 new
  new(ident: Ident, hir_id: HirId, res: Res): PathSegment {
    return new PathSegment(ident, hir_id, res, undefined, true, false);
  },

  // rustc: compiler/rustc_hir/src/hir.rs:407 invalid
  invalid(): PathSegment {
    return PathSegment.new(Ident.dummy(), HirId_INVALID, { $: "Err" });
  },
});

// PORT: `args()` is `args_()`: the class has a field `args` of the same name.
// rustc: compiler/rustc_hir/src/hir.rs:411 args
PathSegment.prototype.args_ = function (this: PathSegment): GenericArgs {
  const args = this.args;
  if (args !== undefined) {
    return args;
  } else {
    return GenericArgs.NONE;
  }
};

// ---- ConstItemRhs -----------------------------------------------------------------------------------------------

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

// ---- ConstArg ---------------------------------------------------------------------------------------------------

declare module "./hir.gen.ts" {
  interface ConstArg<Unambig> {
    as_unambig_ct(this: ConstArg<AmbigArg>): ConstArg;
    try_as_ambig_ct(this: ConstArg): ConstArg<AmbigArg> | undefined;
    anon_const_hir_id(): HirId | undefined;
  }
}

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
gen.ConstArg.prototype.as_unambig_ct = function (this: ConstArg<AmbigArg>): ConstArg {
  // SAFETY: `ConstArg` is `repr(C)` and `ConstArgKind` is marked `repr(u8)` so that the
  // layout is the same across different ZST type arguments.
  // PORT: the transmute is a cast (`AmbigArg` is uninhabited, so there is no `Infer` variant).
  return this as unknown as ConstArg;
};

/// Converts a `ConstArg` in an unambiguous position to one in an ambiguous position. This is
/// fallible as the [`ConstArgKind::Infer`] variant is not present in ambiguous positions.
///
/// Functions accepting ambiguous consts will not handle the [`ConstArgKind::Infer`] variant, if
/// infer consts are relevant to you then care should be taken to handle them separately.
// rustc: compiler/rustc_hir/src/hir.rs:485 try_as_ambig_ct
gen.ConstArg.prototype.try_as_ambig_ct = function (this: ConstArg): ConstArg<AmbigArg> | undefined {
  if (this.kind.$ === "Infer") {
    return undefined;
  }

  // SAFETY: `ConstArg` is `repr(C)` and `ConstArgKind` is marked `repr(u8)` so that the layout is
  // the same across different ZST type arguments. We also asserted that the `self` is
  // not a `ConstArgKind::Infer` so there is no risk of transmuting a `()` to `AmbigArg`.
  return this as unknown as ConstArg<AmbigArg>;
};

// rustc: compiler/rustc_hir/src/hir.rs:499 anon_const_hir_id
gen.ConstArg.prototype.anon_const_hir_id = function <Unambig>(this: ConstArg<Unambig>): HirId | undefined {
  const kind = this.kind;
  switch (kind.$) {
    case "Anon":
      return kind._0.hir_id;
    default:
      return undefined;
  }
};

// ---- InferArg / GenericArg --------------------------------------------------------------------------------------

declare module "./hir.gen.ts" {
  interface InferArg {
    to_ty(): Ty;
  }
}

// rustc: compiler/rustc_hir/src/hir.rs:570 to_ty
InferArg.prototype.to_ty = function (this: InferArg): Ty {
  return new Ty(this.hir_id, this.span, { $: "Infer", _0: null });
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
    switch (self.$) {
      case "Lifetime":
        return "lifetime";
      case "Type":
        return "type";
      case "Const":
        return "constant";
      case "Infer":
        switch (self._0.kind) {
          case "TypeOrConst":
            return "placeholder";
          case "Const":
            return "constant";
        }
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:621 to_ord
  to_ord(self: GenericArg): ParamKindOrd {
    switch (self.$) {
      case "Lifetime":
        return "Lifetime";
      case "Type":
      case "Const":
      case "Infer":
        return "TypeOrConst";
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

// ---- GenericArgs ------------------------------------------------------------------------------------------------

declare module "./hir.gen.ts" {
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
  namespace GenericArgs {
    export const NONE: GenericArgs;
  }
}

Object.assign(GenericArgs, {
  /// An empty `GenericArgs` (no generic arguments).
  NONE: Object.freeze(new GenericArgs(Object.freeze([]), Object.freeze([]), "No", DUMMY_SP)),
});

/// Obtain the list of input types and the output type if the generic arguments are parenthesized.
///
/// Returns the `Ty0` and `Ty1` in `Trait(Ty0) -> Ty1`.
/// Panics if the parenthesized arguments have an incorrect form (this shouldn't happen).
// rustc: compiler/rustc_hir/src/hir.rs:677 paren_sugar_inputs_output
GenericArgs.prototype.paren_sugar_inputs_output = function (this: GenericArgs): [readonly Ty[], Ty] | undefined {
  if (this.parenthesized !== "ParenSugar") {
    return undefined;
  }

  let inputs: readonly Ty[] | undefined;
  for (const arg of this.args) {
    if (arg.$ !== "Type") continue;
    const ty = arg._0;
    if (ty.kind.$ !== "Tup") continue;
    inputs = ty.kind._0;
    break;
  }

  return [unwrap(inputs), this.paren_sugar_output_inner()];
};

/// Obtain the output type if the generic arguments are parenthesized.
///
/// Returns the `RetTy` in `Trait(Ty0, Ty1, ...) -> RetTy`.
/// Panics if the parenthesized arguments have an incorrect form (this shouldn't happen).
// rustc: compiler/rustc_hir/src/hir.rs:699 paren_sugar_output
GenericArgs.prototype.paren_sugar_output = function (this: GenericArgs): Ty | undefined {
  return this.parenthesized === "ParenSugar" ? this.paren_sugar_output_inner() : undefined;
};

// rustc: compiler/rustc_hir/src/hir.rs:704 paren_sugar_output_inner
GenericArgs.prototype.paren_sugar_output_inner = function (this: GenericArgs): Ty {
  // `let [constraint] = self.constraints.try_into().unwrap();`
  if (this.constraints.length !== 1) return panic("called `Result::unwrap()` on an `Err` value: TryFromSliceError(())");
  const constraint = this.constraints[0]!;
  // debug_assert_eq!(constraint.ident.name, sym::Output);
  return unwrap(constraint.ty());
};

// rustc: compiler/rustc_hir/src/hir.rs:710 has_err
GenericArgs.prototype.has_err = function (this: GenericArgs): ErrorGuaranteed | undefined {
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
GenericArgs.prototype.num_lifetime_args = function (this: GenericArgs): number {
  return this.args.filter((arg) => arg.$ === "Lifetime").length;
};

// rustc: compiler/rustc_hir/src/hir.rs:732 has_lifetime_args
GenericArgs.prototype.has_lifetime_args = function (this: GenericArgs): boolean {
  return this.args.some((arg) => arg.$ === "Lifetime");
};

/// This function returns the number of type and const generic params.
/// It should only be used for diagnostics.
// rustc: compiler/rustc_hir/src/hir.rs:739 num_generic_params
GenericArgs.prototype.num_generic_params = function (this: GenericArgs): number {
  return this.args.filter((arg) => !(arg.$ === "Lifetime")).length;
};

/// The span encompassing the arguments and constraints[^1] inside the surrounding brackets.
///
/// Returns `None` if the span is empty (i.e., no brackets) or dummy.
///
/// [^1]: Unless of the form `-> Ty` (see [`GenericArgsParentheses`]).
// rustc: compiler/rustc_hir/src/hir.rs:748 span
GenericArgs.prototype.span = function (this: GenericArgs): Span | undefined {
  const span_ext = this.span_ext_();
  if (span_ext === undefined) return undefined;
  return Span.with_hi(
    Span.with_lo(span_ext, BytePos.add(Span.lo(span_ext), BytePos(1))),
    BytePos.sub(Span.hi(span_ext), BytePos(1)),
  );
};

/// Returns span encompassing arguments and their surrounding `<>` or `()`
// PORT: `span_ext()` is `span_ext_()`: the class has a field `span_ext` of the same name.
// rustc: compiler/rustc_hir/src/hir.rs:754 span_ext
GenericArgs.prototype.span_ext_ = function (this: GenericArgs): Span | undefined {
  const span = this.span_ext;
  return !Span.is_empty(span) ? span : undefined;
};

// rustc: compiler/rustc_hir/src/hir.rs:758 is_empty
GenericArgs.prototype.is_empty = function (this: GenericArgs): boolean {
  return this.args.length === 0;
};

// ---- TraitBoundModifiers / GenericBound -------------------------------------------------------------------------

export type TraitBoundModifiers = gen.TraitBoundModifiers;
export const TraitBoundModifiers = {
  NONE: Object.freeze({ constness: BoundConstness.Never, polarity: BoundPolarity.Positive }) as TraitBoundModifiers,
};

export type GenericBound = gen.GenericBound;
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

// ---- GenericParam -----------------------------------------------------------------------------------------------

declare module "./hir.gen.ts" {
  interface GenericParam {
    is_impl_trait(): boolean;
    is_elided_lifetime(): boolean;
    is_lifetime(): boolean;
  }
}

/// Synthetic type-parameters are inserted after normal ones.
/// In order for normal parameters to be able to refer to synthetic ones,
/// scans them first.
// rustc: compiler/rustc_hir/src/hir.rs:871 is_impl_trait
GenericParam.prototype.is_impl_trait = function (this: GenericParam): boolean {
  return this.kind.$ === "Type" && this.kind.synthetic;
};

/// This can happen for `async fn`, e.g. `async fn f<'_>(&'_ self)`.
///
/// See `lifetime_to_generic_param` in `rustc_ast_lowering` for more information.
// rustc: compiler/rustc_hir/src/hir.rs:878 is_elided_lifetime
GenericParam.prototype.is_elided_lifetime = function (this: GenericParam): boolean {
  return this.kind.$ === "Lifetime" && this.kind.kind.$ === "Elided";
};

// rustc: compiler/rustc_hir/src/hir.rs:882 is_lifetime
GenericParam.prototype.is_lifetime = function (this: GenericParam): boolean {
  return this.kind.$ === "Lifetime";
};

/// Represents lifetimes and type parameters attached to a declaration
/// of a function, enum, trait, etc.
// PORT: `#[derive(Default)] struct GenericParamCount`: the derived `Default`.
export function default_GenericParamCount(): gen.GenericParamCount {
  return { lifetimes: 0, types: 0, consts: 0, infer: 0 };
}

// ---- Generics ---------------------------------------------------------------------------------------------------

declare module "./hir.gen.ts" {
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
  namespace Generics {
    export function empty(): Generics;
  }
}

/** `const NOPE: Generics<'_>` of `Generics::empty` (one shared value, like the upstream `&NOPE`). */
const Generics_NOPE: Generics = Object.freeze(new Generics(Object.freeze([]), Object.freeze([]), false, DUMMY_SP, DUMMY_SP));

Object.assign(Generics, {
  // rustc: compiler/rustc_hir/src/hir.rs:921 empty
  empty(): Generics {
    return Generics_NOPE;
  },
});

// rustc: compiler/rustc_hir/src/hir.rs:932 get_named
Generics.prototype.get_named = function (this: Generics, name: Symbol): GenericParam | undefined {
  return this.params.find((param) => name === ParamName.ident(param.name).name);
};

/// If there are generic parameters, return where to introduce a new one.
// rustc: compiler/rustc_hir/src/hir.rs:937 span_for_lifetime_suggestion
Generics.prototype.span_for_lifetime_suggestion = function (this: Generics): Span | undefined {
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
Generics.prototype.span_for_param_suggestion = function (this: Generics): Span | undefined {
  if (!this.params.some((p) => Span.contains(this.span, p.span))) return undefined;
  // `fn foo<A>(t: impl Trait)`
  //          ^ suggest `, T: Trait` here
  return Span.shrink_to_lo(Span.with_lo(this.span, BytePos.sub(Span.hi(this.span), BytePos(1))));
};

/// `Span` where further predicates would be suggested, accounting for trailing commas, like
///  in `fn foo<T>(t: T) where T: Foo,` so we don't suggest two trailing commas.
// rustc: compiler/rustc_hir/src/hir.rs:960 tail_span_for_predicate_suggestion
Generics.prototype.tail_span_for_predicate_suggestion = function (this: Generics): Span {
  const end = Span.shrink_to_hi(this.where_clause_span);
  if (this.has_where_clause_predicates) {
    let found: WherePredicate | undefined;
    for (let i = this.predicates.length - 1; i >= 0; i--) {
      const p = this.predicates[i]!;
      if (WherePredicateKind.in_where_clause(p.kind)) {
        found = p;
        break;
      }
    }
    return Span.to(Span.shrink_to_hi(found === undefined ? end : found.span), end);
  } else {
    return end;
  }
};

// rustc: compiler/rustc_hir/src/hir.rs:974 add_where_or_trailing_comma
Generics.prototype.add_where_or_trailing_comma = function (this: Generics): string {
  if (this.has_where_clause_predicates) {
    return ",";
  } else if (Span.is_empty(this.where_clause_span)) {
    return " where";
  } else {
    // No where clause predicates, but we have `where` token
    return "";
  }
};

// PORT: the `impl Iterator` results of `bounds_for_param` / `outlives_for_param` are arrays (computed eagerly; the
// predicates are immutable HIR).
// rustc: compiler/rustc_hir/src/hir.rs:985 bounds_for_param
Generics.prototype.bounds_for_param = function (this: Generics, param_def_id: LocalDefId): WhereBoundPredicate[] {
  const out: WhereBoundPredicate[] = [];
  for (const pred of this.predicates) {
    const kind = pred.kind;
    if (kind.$ === "BoundPredicate" && kind._0.is_param_bound(LocalDefId.to_def_id(param_def_id))) {
      out.push(kind._0);
    }
  }
  return out;
};

// rustc: compiler/rustc_hir/src/hir.rs:999 outlives_for_param
Generics.prototype.outlives_for_param = function (this: Generics, param_def_id: LocalDefId): WhereRegionPredicate[] {
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
Generics.prototype.bounds_span_for_suggestions = function (this: Generics, param_def_id: LocalDefId): [Span, Span | undefined] | undefined {
  for (const bp of this.bounds_for_param(param_def_id)) {
    for (let i = bp.bounds.length - 1; i >= 0; i--) {
      const bound = bp.bounds[i]!;
      let span_for_parentheses: Span | undefined;
      const trait_ref = GenericBound.trait_ref(bound);
      const segment = trait_ref === undefined ? undefined : trait_ref.path.segments[trait_ref.path.segments.length - 1];
      const ret_ty0 = segment === undefined ? undefined : segment.args_().paren_sugar_output();
      const ret_ty = ret_ty0 === undefined ? undefined : ret_ty0.peel_refs();
      if (
        ret_ty !== undefined &&
        ret_ty.kind.$ === "TraitObject" &&
        ret_ty.kind._1.tag() === "Dyn" &&
        Span.can_be_used_for_suggestions(ret_ty.span)
      ) {
        span_for_parentheses = ret_ty.span;
      } else {
        span_for_parentheses = undefined;
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
Generics.prototype.span_for_predicate_removal = function (this: Generics, pos: number): Span {
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
Generics.prototype.span_for_bound_removal = function (this: Generics, predicate_pos: number, bound_pos: number): Span {
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

// rustc: compiler/rustc_hir/src/hir.rs:1138 span_for_param_removal
Generics.prototype.span_for_param_removal = function (this: Generics, param_index: number): Span {
  if (param_index >= this.params.length) {
    return Span.shrink_to_hi(this.span);
  }

  const is_param_explicit = (par: GenericParam): boolean => {
    switch (par.kind.$) {
      case "Type":
      case "Const":
        return true;
      case "Lifetime":
        return par.kind.kind.$ === "Explicit";
    }
  };

  // Find the span of the type parameter.
  const next = this.params.slice(param_index + 1).find(is_param_explicit);
  let prev: GenericParam | undefined;
  if (next === undefined) {
    for (let i = param_index - 1; i >= 0; i--) {
      if (is_param_explicit(this.params[i]!)) {
        prev = this.params[i]!;
        break;
      }
    }
  }
  if (next !== undefined) {
    return Span.until(this.params[param_index]!.span, next.span);
  } else if (prev !== undefined) {
    let prev_span = prev.span;
    // Consider the span of the bounds with the previous generic parameter when there is.
    const prev_bounds_span = this.span_for_param_bounds(prev);
    if (prev_bounds_span !== undefined) {
      prev_span = Span.to(prev_span, prev_bounds_span);
    }

    // Consider the span of the bounds with the current generic parameter when there is.
    const cur_bounds_span = this.span_for_param_bounds(this.params[param_index]!);
    return Span.to(Span.shrink_to_hi(prev_span), cur_bounds_span !== undefined ? cur_bounds_span : this.params[param_index]!.span);
  } else {
    // Remove also angle brackets <> when there is just ONE generic parameter.
    return this.span;
  }
};

// rustc: compiler/rustc_hir/src/hir.rs:1185 span_for_param_bounds
Generics.prototype.span_for_param_bounds = function (this: Generics, param: GenericParam): Span | undefined {
  const pred = this.predicates.find((pred) => {
    const kind = pred.kind;
    if (kind.$ === "BoundPredicate" && kind._0.origin === "GenericParam") {
      return kind._0.bounded_ty.span === param.span;
    } else {
      return false;
    }
  });
  return pred === undefined ? undefined : pred.span;
};

// ---- where predicates -------------------------------------------------------------------------------------------

export type WherePredicateKind = gen.WherePredicateKind;
export const WherePredicateKind = {
  /// Returns `true` if `predicate` is from a `where` clause (as opposed to inline bounds).
  // rustc: compiler/rustc_hir/src/hir.rs:1223 in_where_clause
  in_where_clause(self: gen.WherePredicateKind): boolean {
    switch (self.$) {
      case "BoundPredicate":
        return self._0.origin === "WhereClause";
      case "RegionPredicate":
        return self._0.in_where_clause;
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:1230 bounds
  bounds(self: gen.WherePredicateKind): GenericBounds {
    switch (self.$) {
      case "BoundPredicate":
        return self._0.bounds;
      case "RegionPredicate":
        return self._0.bounds;
    }
  },
};

declare module "./hir.gen.ts" {
  interface WhereBoundPredicate {
    is_param_bound(param_def_id: DefId): boolean;
  }
  interface WhereRegionPredicate {
    is_param_bound(param_def_id: LocalDefId): boolean;
  }
}

/// Returns `true` if `param_def_id` matches the `bounded_ty` of this predicate.
// rustc: compiler/rustc_hir/src/hir.rs:1260 is_param_bound
WhereBoundPredicate.prototype.is_param_bound = function (this: WhereBoundPredicate, param_def_id: DefId): boolean {
  const p = this.bounded_ty.as_generic_param();
  return p !== undefined && DefId_eq(p[0], param_def_id);
};

/// Returns `true` if `param_def_id` matches the `lifetime` of this predicate.
// rustc: compiler/rustc_hir/src/hir.rs:1275 is_param_bound
WhereRegionPredicate.prototype.is_param_bound = function (this: WhereRegionPredicate, param_def_id: LocalDefId): boolean {
  return LifetimeKind.eq(this.lifetime.kind, { $: "Param", _0: param_def_id });
};

// ---- AttributeMap / OwnerNodes / OwnerInfo / MaybeOwner ---------------------------------------------------------

declare module "./hir.gen.ts" {
  interface AttributeMap {
    get(id: ItemLocalId): readonly Attribute[];
  }
  namespace AttributeMap {
    export const EMPTY: AttributeMap;
  }
}

Object.assign(AttributeMap, {
  EMPTY: new AttributeMap(SortedMap.new(ItemLocalId_cmp), undefined, Fingerprint.ZERO),
});

// rustc: compiler/rustc_hir/src/hir.rs:1314 get
AttributeMap.prototype.get = function (this: AttributeMap, id: ItemLocalId): readonly Attribute[] {
  const attrs = this.map.get(id);
  return attrs !== undefined ? attrs : [];
};

declare module "./hir.gen.ts" {
  interface OwnerNodes {
    node(): OwnerNode;
  }
  namespace OwnerNodes {
    export function synthetic(): OwnerNodes;
  }
}

// rustc: compiler/rustc_hir/src/hir.rs:1336 node
OwnerNodes.prototype.node = function (this: OwnerNodes): OwnerNode {
  // Indexing must ensure it is an OwnerNode.
  return unwrap(Node.as_owner(this.nodes[ItemLocalId.ZERO]!.node));
};

Object.assign(OwnerNodes, {
  /// Return an instance of `OwnerNodes` suitable for definitions that have no corresponding AST.
  // rustc: compiler/rustc_hir/src/hir.rs:1342 synthetic
  synthetic(): OwnerNodes {
    return new OwnerNodes(
      // There is no reason to bother computing a hash for a synthetic body.
      // Just use a constant value.
      Fingerprint.ZERO,
      // `IndexVec::from_elem_n(.., 1)`
      [{ parent: ItemLocalId.INVALID, node: Node.from_OwnerNode(gen.OwnerNode.Synthetic) }],
      SortedMap.new(ItemLocalId_cmp),
    );
  },
});

// impl fmt::Debug for OwnerNodes<'_>
// rustc: compiler/rustc_hir/src/hir.rs:1357 fmt
export function debug_OwnerNodes(self: OwnerNodes, f: Fmt): string {
  return debug_struct(f, "OwnerNodes", [
    // Do not print all the pointers to all the nodes, as it would be unreadable.
    ["node", debug_ParentedNode(self.nodes[ItemLocalId.ZERO]!, f)],
    [
      "parents",
      // `fmt::from_fn(|f| f.debug_list().entries(..).finish())`: each entry is `write!(f, "({id:?}, {:?})", ..)`,
      // whose `{:?}` specs do not inherit `{:#?}`.
      debug_list(
        f,
        self.nodes.map((parented_node, id) => `(${debug_ItemLocalId(id as ItemLocalId, PLAIN)}, ${debug_ItemLocalId(parented_node.parent, PLAIN)})`),
      ),
    ],
    ["bodies", debug_SortedMap(self.bodies, f, debug_ItemLocalId, gen.debug_Body)],
    ["opt_hash", debug_option(self.opt_hash, f, debug_Fingerprint)],
  ]);
}

declare module "./hir.gen.ts" {
  interface OwnerInfo {
    node(): OwnerNode;
    fingerprint(): Fingerprint;
  }
}

// rustc: compiler/rustc_hir/src/hir.rs:1405 node
gen.OwnerInfo.prototype.node = function (this: OwnerInfo): OwnerNode {
  return this.nodes.node();
};

// A fingerprint that identifies the contents of the OwnerInfo.
// It only depends on `nodes` and `attrs` because `parenting` and `trait_map` are
// deterministically calculated from `nodes` and `attrs`.
// rustc: compiler/rustc_hir/src/hir.rs:1413 fingerprint
gen.OwnerInfo.prototype.fingerprint = function (this: OwnerInfo): Fingerprint {
  const body = this.nodes.opt_hash;
  if (body === undefined) return panic("HIR hash requested without needs_hir_hash");
  const attrs = this.attrs.opt_hash;
  if (attrs === undefined) return panic("HIR hash requested without needs_hir_hash");
  return Fingerprint.combine(body, attrs);
};

export type MaybeOwner = gen.MaybeOwner;
export const MaybeOwner = {
  // rustc: compiler/rustc_hir/src/hir.rs:1428 as_owner
  as_owner(self: gen.MaybeOwner): OwnerInfo | undefined {
    switch (self.$) {
      case "Owner":
        return self._0;
      case "NonOwner":
        return undefined;
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:1436 unwrap
  unwrap(self: gen.MaybeOwner): OwnerInfo {
    const owner = MaybeOwner.as_owner(self);
    return owner !== undefined ? owner : panic("Not a HIR owner");
  },
};

// ---- Block / Pat ------------------------------------------------------------------------------------------------

declare module "./hir.gen.ts" {
  interface Block {
    innermost_block(): Block;
  }
}

// rustc: compiler/rustc_hir/src/hir.rs:1504 innermost_block
gen.Block.prototype.innermost_block = function (this: Block): Block {
  let block: Block = this;
  while (block.expr !== undefined && block.expr.kind.$ === "Block") {
    block = block.expr.kind._0;
  }
  return block;
};

declare module "./hir.gen.ts" {
  interface Pat {
    walk_short_(it: (p: Pat) => boolean): boolean;
    walk_short(it: (p: Pat) => boolean): boolean;
    walk_(it: (p: Pat) => boolean): void;
    walk(it: (p: Pat) => boolean): void;
    walk_always(it: (p: Pat) => void): void;
    is_never_pattern(): boolean;
    is_guaranteed_to_constitute_read_for_never(): boolean;
  }
}

// rustc: compiler/rustc_hir/src/hir.rs:1539 walk_short_
Pat.prototype.walk_short_ = function (this: Pat, it: (p: Pat) => boolean): boolean {
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
      if (kind._3 === undefined) return true;
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
      return [...before, ...(slice === undefined ? [] : [slice]), ...after].every((p) => p.walk_short_(it));
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
Pat.prototype.walk_short = function (this: Pat, it: (p: Pat) => boolean): boolean {
  return this.walk_short_(it);
};

// rustc: compiler/rustc_hir/src/hir.rs:1567 walk_
Pat.prototype.walk_ = function (this: Pat, it: (p: Pat) => boolean): void {
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
      if (kind._3 !== undefined) kind._3.walk_(it);
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
      [...before, ...(slice === undefined ? [] : [slice]), ...after].forEach((p) => p.walk_(it));
      break;
    }
  }
};

/// Walk the pattern in left-to-right order.
///
/// If `it(pat)` returns `false`, the children are not visited.
// rustc: compiler/rustc_hir/src/hir.rs:1587 walk
Pat.prototype.walk = function (this: Pat, it: (p: Pat) => boolean): void {
  this.walk_(it);
};

/// Walk the pattern in left-to-right order.
///
/// If you always want to recurse, prefer this method over `walk`.
// rustc: compiler/rustc_hir/src/hir.rs:1594 walk_always
Pat.prototype.walk_always = function (this: Pat, it: (p: Pat) => void): void {
  this.walk((p) => {
    it(p);
    return true;
  });
};

/// Whether this a never pattern.
// rustc: compiler/rustc_hir/src/hir.rs:1602 is_never_pattern
Pat.prototype.is_never_pattern = function (this: Pat): boolean {
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
Pat.prototype.is_guaranteed_to_constitute_read_for_never = function (this: Pat): boolean {
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

// ---- RangeEnd / DotDotPos ---------------------------------------------------------------------------------------

// impl fmt::Display for RangeEnd
// rustc: compiler/rustc_hir/src/hir.rs:1691 fmt
export function display_RangeEnd(self: gen.RangeEnd): string {
  switch (self) {
    case "Included":
      return "..=";
    case "Excluded":
      return "..";
  }
}

declare module "./hir.gen.ts" {
  interface DotDotPos {
    as_opt_usize(): number | undefined;
  }
  namespace DotDotPos {
    function new_(n: number | undefined): DotDotPos;
    export { new_ as new };
  }
}

/** `u32::MAX` */
const U32_MAX = 0xffff_ffff;

Object.assign(DotDotPos, {
  /// Panics if n >= u32::MAX.
  // rustc: compiler/rustc_hir/src/hir.rs:1707 new
  new(n: number | undefined): DotDotPos {
    if (n !== undefined) {
      assert(n < U32_MAX, "assertion failed: n < u32::MAX as usize");
      return new DotDotPos(n);
    } else {
      return new DotDotPos(U32_MAX);
    }
  },
});

// rustc: compiler/rustc_hir/src/hir.rs:1717 as_opt_usize
DotDotPos.prototype.as_opt_usize = function (this: DotDotPos): number | undefined {
  if (this._0 === U32_MAX) {
    return undefined;
  } else {
    return this._0;
  }
};

// impl fmt::Debug for DotDotPos
// rustc: compiler/rustc_hir/src/hir.rs:1723 fmt
export function debug_DotDotPos(self: DotDotPos, f: Fmt): string {
  return debug_option(self.as_opt_usize(), f, debug_int);
}

// ---- Body / coroutines ------------------------------------------------------------------------------------------

declare module "./hir.gen.ts" {
  interface Body {
    id(): BodyId;
  }
}

// rustc: compiler/rustc_hir/src/hir.rs:1964 id
Body.prototype.id = function (this: Body): BodyId {
  return { hir_id: this.value.hir_id };
};

export type CoroutineKind = gen.CoroutineKind;
export const CoroutineKind = {
  // rustc: compiler/rustc_hir/src/hir.rs:1980 movability
  movability(self: CoroutineKind): Movability {
    if (self.$ === "Desugared") {
      switch (self._0) {
        case "Async":
        case "AsyncGen":
          return "Static";
        case "Gen":
          return "Movable";
      }
    }
    const mov = self._0;
    return mov;
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
    if (self.$ === "Desugared") {
      const d = self._0;
      switch (self._1) {
        case "Fn":
          return `${display_CoroutineDesugaring(d, true)}fn bodies`;
        case "Block":
          return `${display_CoroutineDesugaring(d, true)}blocks`;
        case "Closure":
          return `${display_CoroutineDesugaring(d, true)}closure bodies`;
      }
    }
    return "coroutines";
  },
};

// impl fmt::Display for CoroutineKind
// rustc: compiler/rustc_hir/src/hir.rs:2011 fmt
export function display_CoroutineKind(self: CoroutineKind, alternate = false): string {
  switch (self.$) {
    case "Desugared": {
      const d = self._0;
      const k = self._1;
      return display_CoroutineDesugaring(d, alternate) + display_CoroutineSource(k);
    }
    case "Coroutine":
      return "coroutine";
  }
}

// impl fmt::Display for CoroutineSource
// rustc: compiler/rustc_hir/src/hir.rs:2040 fmt
export function display_CoroutineSource(self: gen.CoroutineSource): string {
  // PORT: `"..".fmt(f)` (`str` Display) with the caller's flags; no width/precision is used with it.
  switch (self) {
    case "Block":
      return "block";
    case "Closure":
      return "closure body";
    case "Fn":
      return "fn body";
  }
}

// impl fmt::Display for CoroutineDesugaring
// PORT: `f.alternate()` (`{:#}`) is the `alternate` argument.
// rustc: compiler/rustc_hir/src/hir.rs:2064 fmt
export function display_CoroutineDesugaring(self: gen.CoroutineDesugaring, alternate = false): string {
  switch (self) {
    case "Async":
      if (alternate) {
        return "`async` ";
      } else {
        return "async ";
      }
    case "Gen":
      if (alternate) {
        return "`gen` ";
      } else {
        return "gen ";
      }
    case "AsyncGen":
      if (alternate) {
        return "`async gen` ";
      } else {
        return "async gen ";
      }
  }
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

export type ConstContext = gen.ConstContext;
export const ConstContext = {
  ...gen.ConstContext,

  /// A description of this const context that can appear between backticks in an error message.
  ///
  /// E.g. `const` or `static mut`.
  // rustc: compiler/rustc_hir/src/hir.rs:2149 keyword_name
  keyword_name(self: ConstContext): string {
    switch (self.$) {
      case "Const":
        return "const";
      case "Static":
        return self._0 === "Not" ? "static" : "static mut";
      case "ConstFn":
        return "const fn";
    }
  },

  /** `#[derive(PartialEq)]` */
  eq(a: ConstContext, b: ConstContext): boolean {
    if (a.$ !== b.$) return false;
    switch (a.$) {
      case "Static":
        return a._0 === (b as typeof a)._0;
      case "Const":
        return a.allow_const_fn_promotion === (b as typeof a).allow_const_fn_promotion;
      case "ConstFn":
        return true;
    }
  },
};

/// A colloquial, trivially pluralizable description of this const context for use in error
/// messages.
// impl fmt::Display for ConstContext
// rustc: compiler/rustc_hir/src/hir.rs:2162 fmt
export function display_ConstContext(self: ConstContext): string {
  switch (self.$) {
    case "Const":
      return "constant";
    case "Static":
      return "static";
    case "ConstFn":
      return "constant function";
  }
}

// impl IntoDiagArg for ConstContext
// rustc: compiler/rustc_hir/src/hir.rs:2172 into_diag_arg
export function ConstContext_into_diag_arg(self: ConstContext, _: MutRef<PathBuf | undefined>): DiagArgValue {
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

// ---- Expr -------------------------------------------------------------------------------------------------------

/**
 * PORT: `#[derive(PartialEq)]` of `rustc_ast::LitKind` (ast.rs), written out for `Expr::equivalent_for_indexing`
 * (symbols are handles, `ErrorGuaranteed` compares equal, `Pu128` is a `bigint`).
 */
function ast_LitKind_eq(a: LitKind, b: LitKind): boolean {
  switch (a.$) {
    case "Str":
    case "ByteStr":
    case "CStr": {
      const o = b as typeof a;
      return a.$ === b.$ && a._0 === o._0 && a._1.$ === o._1.$ && (a._1.$ !== "Raw" || a._1._0 === (o._1 as typeof a._1)._0);
    }
    case "Byte":
    case "Char":
    case "Bool":
      return a.$ === b.$ && a._0 === (b as typeof a)._0;
    case "Int": {
      if (b.$ !== "Int" || a._0 !== b._0 || a._1.$ !== b._1.$) return false;
      return a._1.$ === "Unsuffixed" || a._1._0 === (b._1 as typeof a._1)._0;
    }
    case "Float": {
      if (b.$ !== "Float" || a._0 !== b._0 || a._1.$ !== b._1.$) return false;
      return a._1.$ === "Unsuffixed" || a._1._0 === (b._1 as typeof a._1)._0;
    }
    case "Err":
      return b.$ === "Err";
  }
}

declare module "./hir.gen.ts" {
  interface Expr {
    precedence(has_attr: (id: HirId) => boolean): ExprPrecedence;
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
}

// rustc: compiler/rustc_hir/src/hir.rs:2227 precedence
Expr.prototype.precedence = function (this: Expr, has_attr: (id: HirId) => boolean): ExprPrecedence {
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
    // falls through (unreachable: the inner match is exhaustive)

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
Expr.prototype.is_syntactic_place_expr = function (this: Expr): boolean {
  return this.is_place_expr((_) => true);
};

/// Whether this is a place expression.
///
/// `allow_projections_from` should return `true` if indexing a field or index expression based
/// on the given expression should be considered a place expression.
// rustc: compiler/rustc_hir/src/hir.rs:2298 is_place_expr
Expr.prototype.is_place_expr = function (this: Expr, allow_projections_from: (e: Expr) => boolean): boolean {
  const kind = this.kind;
  switch (kind.$) {
    case "Path":
      if (kind._0.$ === "Resolved") {
        const path = kind._0._1;
        return path.res.$ === "Local" || (path.res.$ === "Def" && path.res._0.$ === "Static") || path.res.$ === "Err";
      }
      // Partially qualified paths in expressions can only legally
      // refer to associated items which are always rvalues.
      return false;

    // Type ascription inherits its place expression kind from its
    // operand. See:
    // https://rust-lang.github.io/rfcs/0803-type-ascription.html#type-ascription-and-temporaries
    case "Type":
      return kind._0.is_place_expr(allow_projections_from);

    // Unsafe binder cast preserves place-ness of the sub-expression.
    case "UnsafeBinderCast":
      return kind._1.is_place_expr(allow_projections_from);

    case "Unary":
      if (kind._0 === "Deref") return true;
      return false;

    case "Field":
    case "Index": {
      const base = kind._0;
      return allow_projections_from(base) || base.is_place_expr(allow_projections_from);
    }

    // Suppress errors for bad expressions.
    case "Err":
      return true;
    case "Let":
      if (kind._0.recovered.$ === "Yes") return true;
      return false;

    case "Call":
    case "MethodCall":
    case "Use":
    case "Struct":
    case "Tup":
    case "If":
    case "Match":
    case "Closure":
    case "Block":
    case "Repeat":
    case "Array":
    case "Break":
    case "Continue":
    case "Ret":
    case "Become":
    case "Loop":
    case "Assign":
    case "InlineAsm":
    case "OffsetOf":
    case "AssignOp":
    case "Lit":
    case "ConstBlock":
    case "AddrOf":
    case "Binary":
    case "Yield":
    case "Cast":
    case "DropTemps":
      return false;
  }
};

/// If this is a desugared range expression,
/// returns the span of the range without desugaring context.
// rustc: compiler/rustc_hir/src/hir.rs:2359 range_span
Expr.prototype.range_span = function (this: Expr): Span | undefined {
  return is_range_literal(this) ? unwrap(Span.parent_callsite(this.span)) : undefined;
};

/// Check if expression is an integer literal that can be used
/// where `usize` is expected.
// rustc: compiler/rustc_hir/src/hir.rs:2365 is_size_lit
Expr.prototype.is_size_lit = function (this: Expr): boolean {
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
Expr.prototype.peel_drop_temps = function (this: Expr): Expr {
  let expr: Expr = this;
  while (expr.kind.$ === "DropTemps") {
    expr = expr.kind._0;
  }
  return expr;
};

// rustc: compiler/rustc_hir/src/hir.rs:2388 peel_blocks
Expr.prototype.peel_blocks = function (this: Expr): Expr {
  let expr: Expr = this;
  while (expr.kind.$ === "Block" && expr.kind._0.expr !== undefined) {
    expr = expr.kind._0.expr;
  }
  return expr;
};

// rustc: compiler/rustc_hir/src/hir.rs:2396 peel_borrows
Expr.prototype.peel_borrows = function (this: Expr): Expr {
  let expr: Expr = this;
  while (expr.kind.$ === "AddrOf") {
    expr = expr.kind._2;
  }
  return expr;
};

// rustc: compiler/rustc_hir/src/hir.rs:2404 can_have_side_effects
Expr.prototype.can_have_side_effects = function (this: Expr): boolean {
  const kind = this.peel_drop_temps().kind;
  switch (kind.$) {
    case "Path":
    case "Lit":
    case "OffsetOf":
    case "Use":
      return false;
    case "Type":
    case "Field":
    case "Index":
    case "Cast":
      // This isn't exactly true for `Index` and all `Unary`, but we are using this
      // method exclusively for diagnostics and there's a *cultural* pressure against
      // them being used only for its side-effects.
      return kind._0.can_have_side_effects();
    case "Unary":
      return kind._1.can_have_side_effects();
    case "AddrOf":
      return kind._2.can_have_side_effects();
    case "UnsafeBinderCast":
      return kind._1.can_have_side_effects();
    case "Binary": {
      const lhs = kind._1;
      const rhs = kind._2;
      // This isn't exactly true for all `Binary`, but we are using this
      // method exclusively for diagnostics and there's a *cultural* pressure against
      // them being used only for its side-effects.
      return lhs.can_have_side_effects() || rhs.can_have_side_effects();
    }
    case "Struct": {
      const fields = kind._1;
      const init = kind._2;
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
      const callee = kind._0;
      if (
        callee.kind.$ === "Path" &&
        callee.kind._0.$ === "Resolved" &&
        callee.kind._0._0 === undefined &&
        callee.kind._0._1.res.$ === "Def" &&
        callee.kind._0._1.res._0.$ === "Ctor" &&
        callee.kind._0._1.res._0._1 === CtorKind.Fn
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
Expr.prototype.is_approximately_pattern = function (this: Expr): boolean {
  switch (this.kind.$) {
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
Expr.prototype.equivalent_for_indexing = function (this: Expr, other: Expr): boolean {
  const a = this.kind;
  const b = other.kind;
  if (a.$ === "Lit" && b.$ === "Lit") {
    return ast_LitKind_eq(a._0.node, b._0.node);
  }
  if (a.$ === "Path" && a._0.$ === "Resolved" && a._0._0 === undefined && b.$ === "Path" && b._0.$ === "Resolved" && b._0._0 === undefined) {
    return Res_eq(a._0._1.res, b._0._1.res, HirId_eq);
  }
  if (
    a.$ === "Struct" &&
    a._0.$ === "Resolved" &&
    a._0._0 === undefined &&
    a._0._1.res.$ === "Def" &&
    a._2.$ === "None" &&
    b.$ === "Struct" &&
    b._0.$ === "Resolved" &&
    b._0._0 === undefined &&
    b._0._1.res.$ === "Def" &&
    b._2.$ === "None"
  ) {
    const path1_def_id = a._0._1.res._1;
    const path2_def_id = b._0._1.res._1;
    const args1 = a._1;
    const args2 = b._1;
    if (!(DefId_eq(path2_def_id, path1_def_id) && is_range_literal(this) && is_range_literal(other))) return false;
    // `std::iter::zip(args1, args2).all(..)`
    const n = Math.min(args1.length, args2.length);
    for (let i = 0; i < n; i++) {
      if (!args1[i]!.expr.equivalent_for_indexing(args2[i]!.expr)) return false;
    }
    return true;
  }
  return false;
};

// rustc: compiler/rustc_hir/src/hir.rs:2520 method_ident
Expr.prototype.method_ident = function (this: Expr): Ident | undefined {
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
  if (kind.$ === "Call") {
    const func = kind._0;
    if (func.kind.$ === "Path" && func.kind._0.$ === "Resolved" && func.kind._0._0 === undefined) {
      const path = func.kind._0._1;
      const segment = path.segments[path.segments.length - 1];
      if (segment !== undefined && segment.ident.name === sym.range_inclusive_new && Span.is_desugaring(expr.span, DesugaringKind.RangeExpr)) {
        return true;
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
  switch (expr.kind.$) {
    // parenthesize if needed (Issue #46756)
    case "Cast":
    case "Binary":
      return true;
    default:
      // parenthesize borrows of range literals (Issue #54505)
      if (is_range_literal(expr)) return true;
      return false;
  }
}

// ---- QPath / sources --------------------------------------------------------------------------------------------

export type QPath = gen.QPath;
export const QPath = {
  /// Returns the span of this `QPath`.
  // rustc: compiler/rustc_hir/src/hir.rs:2758 span
  span(self: QPath): Span {
    switch (self.$) {
      case "Resolved":
        return self._1.span;
      case "TypeRelative":
        return Span.to(self._0.span, self._1.ident.span);
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

// impl fmt::Display for LoopIdError
// rustc: compiler/rustc_hir/src/hir.rs:2860 fmt
export function display_LoopIdError(self: gen.LoopIdError): string {
  switch (self) {
    case "OutsideLoopScope":
      return "not inside loop scope";
    case "UnlabeledCfInWhileCondition":
      return "unlabeled control flow (break or continue) in while condition";
    case "UnresolvedLabel":
      return "label not found";
  }
}

// impl fmt::Display for YieldSource
// rustc: compiler/rustc_hir/src/hir.rs:2891 fmt
export function display_YieldSource(self: gen.YieldSource): string {
  switch (self.$) {
    case "Await":
      return "`await`";
    case "Yield":
      return "`yield`";
  }
}

// ---- trait / impl items -----------------------------------------------------------------------------------------

declare module "./hir.gen.ts" {
  interface TraitItemId {
    hir_id(): HirId;
  }
  interface ImplItemId {
    hir_id(): HirId;
  }
  interface ItemId {
    hir_id(): HirId;
  }
  interface ForeignItemId {
    hir_id(): HirId;
  }
}

// rustc: compiler/rustc_hir/src/hir.rs:2918 hir_id
TraitItemId.prototype.hir_id = function (this: TraitItemId): HirId {
  // Items are always HIR owners.
  return HirId_make_owner(this.owner_id.def_id);
};

// rustc: compiler/rustc_hir/src/hir.rs:2963 expect_failed
function expect_failed(ident: string, found: string): never {
  return panic(`${ident}: found ${found}`);
}

// PORT: `expect_methods_self_kind!` / `expect_methods_self!` (hir.rs:2938 / :2950) generate one `#[track_caller]`
// fn per entry; they are written out below (no markers: the macro has no `fn` line of its own per entry). Tuples
// become arrays; `found` is the `{:?}` of `self`.

declare module "./hir.gen.ts" {
  interface TraitItem {
    hir_id(): HirId;
    trait_item_id(): TraitItemId;
    expect_const(): [Ty, ConstItemRhs | undefined];
    expect_fn(): [FnSig, TraitFn];
    expect_type(): [GenericBounds, Ty | undefined];
  }
}

// rustc: compiler/rustc_hir/src/hir.rs:2969 hir_id
TraitItem.prototype.hir_id = function (this: TraitItem): HirId {
  // Items are always HIR owners.
  return HirId_make_owner(this.owner_id.def_id);
};

// rustc: compiler/rustc_hir/src/hir.rs:2974 trait_item_id
TraitItem.prototype.trait_item_id = function (this: TraitItem): TraitItemId {
  return new TraitItemId(this.owner_id);
};

TraitItem.prototype.expect_const = function (this: TraitItem): [Ty, ConstItemRhs | undefined] {
  const k = this.kind;
  if (k.$ !== "Const") return expect_failed("expect_const", format_debug(this, debug_TraitItem, PLAIN));
  return [k._0, k._1];
};
TraitItem.prototype.expect_fn = function (this: TraitItem): [FnSig, TraitFn] {
  const k = this.kind;
  if (k.$ !== "Fn") return expect_failed("expect_fn", format_debug(this, debug_TraitItem, PLAIN));
  return [k._0, k._1];
};
TraitItem.prototype.expect_type = function (this: TraitItem): [GenericBounds, Ty | undefined] {
  const k = this.kind;
  if (k.$ !== "Type") return expect_failed("expect_type", format_debug(this, debug_TraitItem, PLAIN));
  return [k._0, k._1];
};

// rustc: compiler/rustc_hir/src/hir.rs:3022 hir_id
ImplItemId.prototype.hir_id = function (this: ImplItemId): HirId {
  // Items are always HIR owners.
  return HirId_make_owner(this.owner_id.def_id);
};

declare module "./hir.gen.ts" {
  interface ImplItem {
    hir_id(): HirId;
    impl_item_id(): ImplItemId;
    vis_span(): Span | undefined;
    expect_const(): [Ty, ConstItemRhs];
    expect_fn(): [FnSig, BodyId];
    expect_type(): Ty;
  }
}

// rustc: compiler/rustc_hir/src/hir.rs:3055 hir_id
ImplItem.prototype.hir_id = function (this: ImplItem): HirId {
  // Items are always HIR owners.
  return HirId_make_owner(this.owner_id.def_id);
};

// rustc: compiler/rustc_hir/src/hir.rs:3060 impl_item_id
ImplItem.prototype.impl_item_id = function (this: ImplItem): ImplItemId {
  return new ImplItemId(this.owner_id);
};

// rustc: compiler/rustc_hir/src/hir.rs:3064 vis_span
ImplItem.prototype.vis_span = function (this: ImplItem): Span | undefined {
  const k = this.impl_kind;
  switch (k.$) {
    case "Trait":
      return undefined;
    case "Inherent":
      return k.vis_span;
  }
};

ImplItem.prototype.expect_const = function (this: ImplItem): [Ty, ConstItemRhs] {
  const k = this.kind;
  if (k.$ !== "Const") return expect_failed("expect_const", format_debug(this, debug_ImplItem, PLAIN));
  return [k._0, k._1];
};
ImplItem.prototype.expect_fn = function (this: ImplItem): [FnSig, BodyId] {
  const k = this.kind;
  if (k.$ !== "Fn") return expect_failed("expect_fn", format_debug(this, debug_ImplItem, PLAIN));
  return [k._0, k._1];
};
ImplItem.prototype.expect_type = function (this: ImplItem): Ty {
  const k = this.kind;
  if (k.$ !== "Type") return expect_failed("expect_type", format_debug(this, debug_ImplItem, PLAIN));
  return k._0;
};

declare module "./hir.gen.ts" {
  interface AssocItemConstraint {
    ty(): Ty | undefined;
    ct(): ConstArg | undefined;
  }
}

/// Obtain the type on the RHS of an assoc ty equality constraint if applicable.
// rustc: compiler/rustc_hir/src/hir.rs:3112 ty
gen.AssocItemConstraint.prototype.ty = function (this: AssocItemConstraint): Ty | undefined {
  const k = this.kind;
  if (k.$ === "Equality" && k.term.$ === "Ty") return k.term._0;
  return undefined;
};

/// Obtain the const on the RHS of an assoc const equality constraint if applicable.
// rustc: compiler/rustc_hir/src/hir.rs:3120 ct
gen.AssocItemConstraint.prototype.ct = function (this: AssocItemConstraint): ConstArg | undefined {
  const k = this.kind;
  if (k.$ === "Equality" && k.term.$ === "Const") return k.term._0;
  return undefined;
};

export type Term = gen.Term;
export const Term = {
  // impl<'hir> From<&'hir Ty<'hir>> for Term<'hir>
  // rustc: compiler/rustc_hir/src/hir.rs:3135 from
  from_Ty(ty: Ty): Term {
    return { $: "Ty", _0: ty };
  },

  // impl<'hir> From<&'hir ConstArg<'hir>> for Term<'hir>
  // rustc: compiler/rustc_hir/src/hir.rs:3141 from
  from_ConstArg(c: ConstArg): Term {
    return { $: "Const", _0: c };
  },
};

export type AssocItemConstraintKind = gen.AssocItemConstraintKind;
export const AssocItemConstraintKind = {
  // rustc: compiler/rustc_hir/src/hir.rs:3161 descr
  descr(self: gen.AssocItemConstraintKind): string {
    switch (self.$) {
      case "Equality":
        return "binding";
      case "Bound":
        return "constraint";
    }
  },
};

// ---- Ty ---------------------------------------------------------------------------------------------------------

declare module "./hir.gen.ts" {
  interface Ty<Unambig> {
    as_unambig_ty(this: Ty<AmbigArg>): Ty;
    try_as_ambig_ty(this: Ty): Ty<AmbigArg> | undefined;
    peel_refs(): Ty;
    as_generic_param(this: Ty): [DefId, Ident] | undefined;
    find_self_aliases(this: Ty): Span[];
    is_suggestable_infer_ty(this: Ty): boolean;
  }
}

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
Ty.prototype.as_unambig_ty = function (this: Ty<AmbigArg>): Ty {
  // SAFETY: `Ty` is `repr(C)` and `TyKind` is marked `repr(u8)` so that the layout is
  // the same across different ZST type arguments.
  return this as unknown as Ty;
};

/// Converts a `Ty` in an unambiguous position to one in an ambiguous position. This is
/// fallible as the [`TyKind::Infer`] variant is not present in ambiguous positions.
///
/// Functions accepting ambiguous types will not handle the [`TyKind::Infer`] variant, if
/// infer types are relevant to you then care should be taken to handle them separately.
// rustc: compiler/rustc_hir/src/hir.rs:3213 try_as_ambig_ty
Ty.prototype.try_as_ambig_ty = function (this: Ty): Ty<AmbigArg> | undefined {
  if (this.kind.$ === "Infer") {
    return undefined;
  }

  // SAFETY: `Ty` is `repr(C)` and `TyKind` is marked `repr(u8)` so that the layout is
  // the same across different ZST type arguments. We also asserted that the `self` is
  // not a `TyKind::Infer` so there is no risk of transmuting a `()` to `AmbigArg`.
  return this as unknown as Ty<AmbigArg>;
};

// PORT: `Ty<AmbigArg>::peel_refs` (hir.rs:3227) and `Ty<()>::peel_refs` (hir.rs:3237) are one method: the ambiguous
// one starts from `self.as_unambig_ty()`, which is the same object.
// rustc: compiler/rustc_hir/src/hir.rs:3227 peel_refs
// rustc: compiler/rustc_hir/src/hir.rs:3237 peel_refs
Ty.prototype.peel_refs = function <Unambig>(this: Ty<Unambig>): Ty {
  let final_ty = this as unknown as Ty;
  while (final_ty.kind.$ === "Ref") {
    final_ty = final_ty.kind._1;
  }
  return final_ty;
};

// rustc: compiler/rustc_hir/src/hir.rs:3246 as_generic_param
Ty.prototype.as_generic_param = function (this: Ty): [DefId, Ident] | undefined {
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
Ty.prototype.find_self_aliases = function (this: Ty): Span[] {
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

// rustc: compiler/rustc_hir/src/hir.rs:3287 is_suggestable_infer_ty
Ty.prototype.is_suggestable_infer_ty = function (this: Ty): boolean {
  // rustc: compiler/rustc_hir/src/hir.rs:3288 are_suggestable_generic_args
  function are_suggestable_generic_args(generic_args: readonly GenericArg[]): boolean {
    return generic_args.some((arg) => {
      switch (arg.$) {
        case "Type":
          return arg._0.as_unambig_ty().is_suggestable_infer_ty();
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
    case "Array":
      return kind._0.is_suggestable_infer_ty() || kind._1.kind.$ === "Infer";
    case "Tup":
      return kind._0.some((t) => t.is_suggestable_infer_ty());
    case "Ptr":
      return kind._0.is_suggestable_infer_ty();
    case "Ref":
      return kind._1.is_suggestable_infer_ty();
    case "Path": {
      const qpath = kind._0;
      if (qpath.$ === "TypeRelative") {
        return qpath._0.is_suggestable_infer_ty() || are_suggestable_generic_args(qpath._1.args_().args);
      } else {
        const ty_opt = qpath._0;
        const segments = qpath._1.segments;
        return (ty_opt !== undefined && ty_opt.is_suggestable_infer_ty()) || segments.some((segment) => are_suggestable_generic_args(segment.args_().args));
      }
    }
    default:
      return false;
  }
};

// ---- PrimTy -----------------------------------------------------------------------------------------------------

export type PrimTy = gen.PrimTy;
export const PrimTy = {
  ...gen.PrimTy,

  // any changes here should also be reflected in `PrimTy::from_name`
  ALL: [
    { $: "Int", _0: "I8" },
    { $: "Int", _0: "I16" },
    { $: "Int", _0: "I32" },
    { $: "Int", _0: "I64" },
    { $: "Int", _0: "I128" },
    { $: "Int", _0: "Isize" },
    { $: "Uint", _0: "U8" },
    { $: "Uint", _0: "U16" },
    { $: "Uint", _0: "U32" },
    { $: "Uint", _0: "U64" },
    { $: "Uint", _0: "U128" },
    { $: "Uint", _0: "Usize" },
    { $: "Float", _0: "F16" },
    { $: "Float", _0: "F32" },
    { $: "Float", _0: "F64" },
    { $: "Float", _0: "F128" },
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
        ty = { $: "Int", _0: "I8" };
        break;
      case sym.i16:
        ty = { $: "Int", _0: "I16" };
        break;
      case sym.i32:
        ty = { $: "Int", _0: "I32" };
        break;
      case sym.i64:
        ty = { $: "Int", _0: "I64" };
        break;
      case sym.i128:
        ty = { $: "Int", _0: "I128" };
        break;
      case sym.isize:
        ty = { $: "Int", _0: "Isize" };
        break;
      case sym.u8:
        ty = { $: "Uint", _0: "U8" };
        break;
      case sym.u16:
        ty = { $: "Uint", _0: "U16" };
        break;
      case sym.u32:
        ty = { $: "Uint", _0: "U32" };
        break;
      case sym.u64:
        ty = { $: "Uint", _0: "U64" };
        break;
      case sym.u128:
        ty = { $: "Uint", _0: "U128" };
        break;
      case sym.usize:
        ty = { $: "Uint", _0: "Usize" };
        break;
      case sym.f16:
        ty = { $: "Float", _0: "F16" };
        break;
      case sym.f32:
        ty = { $: "Float", _0: "F32" };
        break;
      case sym.f64:
        ty = { $: "Float", _0: "F64" };
        break;
      case sym.f128:
        ty = { $: "Float", _0: "F128" };
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

// ---- precise capturing / inline asm -----------------------------------------------------------------------------

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
  as_target(self: InlineAsmRegOrRegClass): asm_InlineAsmRegOrRegClass {
    switch (self.$) {
      case "Reg":
        return { $: "Reg", _0: self.reg };
      case "RegClass":
        return { $: "RegClass", _0: self._0 };
    }
  },

  // For `rustc_ast_lowering`
  // rustc: compiler/rustc_hir/src/hir.rs:3634 reg_class
  reg_class(self: InlineAsmRegOrRegClass): asm_InlineAsmRegClass {
    return asm_InlineAsmRegOrRegClass.reg_class(InlineAsmRegOrRegClass.as_target(self));
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
// impl fmt::Display for InlineAsmRegOrRegClass
// rustc: compiler/rustc_hir/src/hir.rs:3649 fmt
export function display_InlineAsmRegOrRegClass(self: InlineAsmRegOrRegClass): string {
  return asm_InlineAsmRegOrRegClass.display(InlineAsmRegOrRegClass.as_target(self));
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

declare module "./hir.gen.ts" {
  interface InlineAsm {
    contains_label(): boolean;
  }
}

// rustc: compiler/rustc_hir/src/hir.rs:3724 contains_label
InlineAsm.prototype.contains_label = function (this: InlineAsm): boolean {
  return this.operands.some((x) => x[0].$ === "Label");
};

// ---- FnDeclFlags / FnDecl ---------------------------------------------------------------------------------------

// impl fmt::Debug for FnDeclFlags
// rustc: compiler/rustc_hir/src/hir.rs:3765 fmt
export function debug_FnDeclFlags(self: FnDeclFlags, f: Fmt): string {
  const fields: string[] = [];
  // `f.field(&format!(..))` / `f.field(&"..")`: `String` / `&str` Debug (quoted)
  fields.push(debug_str(`ImplicitSelfKind(${gen.debug_ImplicitSelfKind(self.implicit_self(), PLAIN)})`));

  if (self.lifetime_elision_allowed()) {
    fields.push(debug_str("LifetimeElisionAllowed"));
  } else {
    fields.push(debug_str("NoLifetimeElision"));
  }

  if (self.c_variadic()) {
    fields.push(debug_str("CVariadic"));
  }

  const index = self.splatted_();
  if (index !== undefined) {
    fields.push(debug_str(`Splatted(${index})`));
  }

  return debug_tuple(f, "FnDeclFlags", fields);
}

declare module "./hir.gen.ts" {
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
  namespace FnDeclFlags {
    /// Mask for the implicit self kind.
    export const IMPLICIT_SELF_MASK: number;
    /// Bitflag for a trailing C-style variadic argument.
    export const C_VARIADIC_FLAG: number;
    /// Bitflag for lifetime elision.
    export const LIFETIME_ELISION_ALLOWED_FLAG: number;
    /// Marker index for "no splatted argument".
    export const NO_SPLATTED_ARG_INDEX: number;
    /// PORT: `default()` is `default_()` (a reserved word cannot be declared as a namespace member).
    export function default_(): FnDeclFlags;
  }
}

Object.assign(FnDeclFlags, {
  /// Mask for the implicit self kind.
  IMPLICIT_SELF_MASK: 0b111,

  /// Bitflag for a trailing C-style variadic argument.
  C_VARIADIC_FLAG: 1 << 3,

  /// Bitflag for lifetime elision.
  LIFETIME_ELISION_ALLOWED_FLAG: 1 << 4,

  /// Marker index for "no splatted argument".
  /// Must have the same value as `FnSigKind::NO_SPLATTED_ARG_INDEX` and `rustc_ast::FnDecl::NO_SPLATTED_ARG_INDEX`.
  NO_SPLATTED_ARG_INDEX: 0xff,

  /// Create a new FnDeclKind with no implicit self, no lifetime elision, no C-style variadic
  /// argument, and no splatting.
  /// To modify these flags, use the `set_*` methods, for readability.
  // FIXME: use Default instead when that trait is const stable.
  // rustc: compiler/rustc_hir/src/hir.rs:3805 default
  default_(): FnDeclFlags {
    return new FnDeclFlags(0, 0).set_implicit_self("None").set_lifetime_elision_allowed(false).set_c_variadic(false).set_no_splatted_args();
  },
});

// PORT: the `set_*(mut self, ..) -> Self` fns take `self` by value (`FnDeclFlags` is `Copy`): each works on a copy
// (`clone_FnDeclFlags`) and returns it, so the receiver is never modified.

/// Set the implicit self kind.
// rustc: compiler/rustc_hir/src/hir.rs:3815 set_implicit_self
FnDeclFlags.prototype.set_implicit_self = function (this: FnDeclFlags, implicit_self: ImplicitSelfKind): FnDeclFlags {
  const self = clone_FnDeclFlags(this);
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
FnDeclFlags.prototype.set_c_variadic = function (this: FnDeclFlags, c_variadic: boolean): FnDeclFlags {
  const self = clone_FnDeclFlags(this);
  if (c_variadic) {
    self.flags |= FnDeclFlags.C_VARIADIC_FLAG;
  } else {
    self.flags &= ~FnDeclFlags.C_VARIADIC_FLAG & 0xff;
  }

  return self;
};

/// Set the lifetime elision allowed flag.
// rustc: compiler/rustc_hir/src/hir.rs:3843 set_lifetime_elision_allowed
FnDeclFlags.prototype.set_lifetime_elision_allowed = function (this: FnDeclFlags, allowed: boolean): FnDeclFlags {
  const self = clone_FnDeclFlags(this);
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
FnDeclFlags.prototype.set_splatted = function (
  this: FnDeclFlags,
  splatted: number | undefined,
  args_len: number,
): Result<FnDeclFlags, SplattedArgIndexError> {
  const self = clone_FnDeclFlags(this);
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
        // `args_len as u16`
        args_len: args_len & 0xffff,
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
FnDeclFlags.prototype.set_no_splatted_args = function (this: FnDeclFlags): FnDeclFlags {
  const self = clone_FnDeclFlags(this);
  self.splatted = FnDeclFlags.NO_SPLATTED_ARG_INDEX;

  return self;
};

/// Get the implicit self kind.
// rustc: compiler/rustc_hir/src/hir.rs:3890 implicit_self
FnDeclFlags.prototype.implicit_self = function (this: FnDeclFlags): ImplicitSelfKind {
  switch (this.flags & FnDeclFlags.IMPLICIT_SELF_MASK) {
    case 0:
      return "None";
    case 1:
      return "Imm";
    case 2:
      return "Mut";
    case 3:
      return "RefImm";
    case 4:
      return "RefMut";
    default:
      return unreachable();
  }
};

/// Do the function arguments end with a C-style variadic argument?
// rustc: compiler/rustc_hir/src/hir.rs:3902 c_variadic
FnDeclFlags.prototype.c_variadic = function (this: FnDeclFlags): boolean {
  return (this.flags & FnDeclFlags.C_VARIADIC_FLAG) !== 0;
};

/// Is lifetime elision allowed?
// rustc: compiler/rustc_hir/src/hir.rs:3907 lifetime_elision_allowed
FnDeclFlags.prototype.lifetime_elision_allowed = function (this: FnDeclFlags): boolean {
  return (this.flags & FnDeclFlags.LIFETIME_ELISION_ALLOWED_FLAG) !== 0;
};

/// Get the splatted argument index, if any.
// PORT: `splatted()` is `splatted_()`: the class has a field `splatted` of the same name.
// rustc: compiler/rustc_hir/src/hir.rs:3912 splatted
FnDeclFlags.prototype.splatted_ = function (this: FnDeclFlags): number | undefined {
  if (this.splatted === FnDeclFlags.NO_SPLATTED_ARG_INDEX) {
    return undefined;
  } else {
    return this.splatted;
  }
};

declare module "./hir.gen.ts" {
  interface FnDecl {
    opt_delegation_sig_id(): DefId | undefined;
    opt_delegation_info(): DelegationInfo | undefined;
    implicit_self(): ImplicitSelfKind;
    c_variadic(): boolean;
    lifetime_elision_allowed(): boolean;
    splatted(): number | undefined;
  }
  namespace FnDecl {
    export function dummy(span: Span): FnDecl;
  }
}

// rustc: compiler/rustc_hir/src/hir.rs:3930 opt_delegation_sig_id
FnDecl.prototype.opt_delegation_sig_id = function (this: FnDecl): DefId | undefined {
  if (this.output.$ === "Return") {
    const ty = this.output._0;
    if (ty.kind.$ === "InferDelegation" && ty.kind._0.$ === "Sig") {
      return ty.kind._0._0;
    }
  }
  return undefined;
};

// rustc: compiler/rustc_hir/src/hir.rs:3939 opt_delegation_info
FnDecl.prototype.opt_delegation_info = function (this: FnDecl): DelegationInfo | undefined {
  if (this.output.$ === "Return") {
    const ty = this.output._0;
    if (ty.kind.$ === "InferDelegation" && ty.kind._0.$ === "Sig") {
      const kind = ty.kind._0._1;
      if (kind.$ === "Output") {
        return kind._0;
      }
    }
  }

  return undefined;
};

// rustc: compiler/rustc_hir/src/hir.rs:3950 implicit_self
FnDecl.prototype.implicit_self = function (this: FnDecl): ImplicitSelfKind {
  return this.fn_decl_kind.implicit_self();
};

// rustc: compiler/rustc_hir/src/hir.rs:3954 c_variadic
FnDecl.prototype.c_variadic = function (this: FnDecl): boolean {
  return this.fn_decl_kind.c_variadic();
};

// rustc: compiler/rustc_hir/src/hir.rs:3958 lifetime_elision_allowed
FnDecl.prototype.lifetime_elision_allowed = function (this: FnDecl): boolean {
  return this.fn_decl_kind.lifetime_elision_allowed();
};

// rustc: compiler/rustc_hir/src/hir.rs:3962 splatted
FnDecl.prototype.splatted = function (this: FnDecl): number | undefined {
  return this.fn_decl_kind.splatted_();
};

Object.assign(FnDecl, {
  // rustc: compiler/rustc_hir/src/hir.rs:3966 dummy
  dummy(span: Span): FnDecl {
    return new FnDecl([], { $: "DefaultReturn", _0: span }, FnDeclFlags.default_().set_lifetime_elision_allowed(true));
  },
});

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

  /** `#[derive(Default)]` (`#[default] Final`) */
  default(): Defaultness {
    return gen.Defaultness.Final;
  },

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
    if (self.$ === "Return" && self._0.is_suggestable_infer_ty()) {
      return self._0;
    }
    return undefined;
  },
};

// ---- UseTree / TraitRef / FieldDef / VariantData ----------------------------------------------------------------

declare module "./hir.gen.ts" {
  interface UseTree {
    resolutions(): PerNS<Res | undefined>[];
  }
}

// PORT: the `iter!` generator is collected eagerly into an array (same items, same order).
// rustc: compiler/rustc_hir/src/hir.rs:4122 resolutions
UseTree.prototype.resolutions = function (this: UseTree): PerNS<Res | undefined>[] {
  const out: PerNS<Res | undefined>[] = [];
  const kind = this.kind;
  switch (kind.$) {
    case "Glob":
      out.push(this.prefix.res);
      break;
    case "Single":
      out.push(this.prefix.res);
      break;
    case "Nested":
      for (const [item, ,] of kind.items) {
        for (const res of item.resolutions()) {
          out.push(res);
        }
      }
      break;
  }
  return out;
};

declare module "./hir.gen.ts" {
  interface TraitRef {
    trait_def_id(): DefId | undefined;
  }
}

/// Gets the `DefId` of the referenced trait. It _must_ actually be a trait or trait alias.
// rustc: compiler/rustc_hir/src/hir.rs:4172 trait_def_id
TraitRef.prototype.trait_def_id = function (this: TraitRef): DefId | undefined {
  const res = this.path.res;
  if (res.$ === "Def" && (res._0.$ === "Trait" || res._0.$ === "TraitAlias")) {
    return res._1;
  } else if (res.$ === "Err") {
    return undefined;
  } else {
    return panic(`${format_debug(res, (v, f) => debug_Res(v, f, debug_HirId), PLAIN)} did not resolve to a trait or trait alias`);
  }
};

declare module "./hir.gen.ts" {
  interface FieldDef {
    is_positional(): boolean;
  }
}

// Still necessary in couple of places
// rustc: compiler/rustc_hir/src/hir.rs:4213 is_positional
FieldDef.prototype.is_positional = function (this: FieldDef): boolean {
  const c = this.ident.as_str().charCodeAt(0);
  return c >= 0x30 && c <= 0x39;
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
        return [CtorKind.Fn, self._1, self._2];
      case "Unit":
        return [CtorKind.Const, self._0, self._1];
      case "Struct":
        return undefined;
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:4253 ctor_kind
  ctor_kind(self: VariantData): CtorKind | undefined {
    const c = VariantData.ctor(self);
    return c === undefined ? undefined : c[0];
  },

  /// Return the `HirId` of this variant's constructor, if it has one.
  // rustc: compiler/rustc_hir/src/hir.rs:4259 ctor_hir_id
  ctor_hir_id(self: VariantData): HirId | undefined {
    const c = VariantData.ctor(self);
    return c === undefined ? undefined : c[1];
  },

  /// Return the `LocalDefId` of this variant's constructor, if it has one.
  // rustc: compiler/rustc_hir/src/hir.rs:4265 ctor_def_id
  ctor_def_id(self: VariantData): LocalDefId | undefined {
    const c = VariantData.ctor(self);
    return c === undefined ? undefined : c[2];
  },
};

// ---- items ------------------------------------------------------------------------------------------------------

// rustc: compiler/rustc_hir/src/hir.rs:4280 hir_id
ItemId.prototype.hir_id = function (this: ItemId): HirId {
  // Items are always HIR owners.
  return HirId_make_owner(this.owner_id.def_id);
};

declare module "./hir.gen.ts" {
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
    expect_struct(): [Ident, Generics, VariantData];
    expect_union(): [Ident, Generics, VariantData];
    expect_trait(): [gen.ImplRestriction, Constness, IsAuto, Safety, Ident, Generics, GenericBounds, readonly TraitItemId[]];
    expect_trait_alias(): [Constness, Ident, Generics, GenericBounds];
    expect_impl(): Impl;
    expect_test_binder_constraints(): [Generics, gen.TestBinderBody];
  }
}

// rustc: compiler/rustc_hir/src/hir.rs:4307 hir_id
Item.prototype.hir_id = function (this: Item): HirId {
  // Items are always HIR owners.
  return HirId_make_owner(this.owner_id.def_id);
};

// rustc: compiler/rustc_hir/src/hir.rs:4313 item_id
Item.prototype.item_id = function (this: Item): ItemId {
  return new ItemId(this.owner_id);
};

/// Check if this is an [`ItemKind::Enum`], [`ItemKind::Struct`] or
/// [`ItemKind::Union`].
// rustc: compiler/rustc_hir/src/hir.rs:4319 is_adt
Item.prototype.is_adt = function (this: Item): boolean {
  return this.kind.$ === "Enum" || this.kind.$ === "Struct" || this.kind.$ === "Union";
};

/// Check if this is an [`ItemKind::Struct`] or [`ItemKind::Union`].
// rustc: compiler/rustc_hir/src/hir.rs:4324 is_struct_or_union
Item.prototype.is_struct_or_union = function (this: Item): boolean {
  return this.kind.$ === "Struct" || this.kind.$ === "Union";
};

/** `expect_methods_self_kind!` failure of an `Item` */
function item_expect_failed(self: Item, name: string): never {
  return expect_failed(name, format_debug(self, debug_Item, PLAIN));
}

Item.prototype.expect_extern_crate = function (this: Item) {
  const k = this.kind;
  if (k.$ !== "ExternCrate") return item_expect_failed(this, "expect_extern_crate");
  return [k._0, k._1];
};
Item.prototype.expect_use = function (this: Item) {
  const k = this.kind;
  if (k.$ !== "Use") return item_expect_failed(this, "expect_use");
  return k._0;
};
Item.prototype.expect_static = function (this: Item) {
  const k = this.kind;
  if (k.$ !== "Static") return item_expect_failed(this, "expect_static");
  return [k._0, k._1, k._2, k._3];
};
Item.prototype.expect_const = function (this: Item) {
  const k = this.kind;
  if (k.$ !== "Const") return item_expect_failed(this, "expect_const");
  return [k._0, k._1, k._2, k._3];
};
Item.prototype.expect_fn = function (this: Item) {
  const k = this.kind;
  if (k.$ !== "Fn") return item_expect_failed(this, "expect_fn");
  return [k.ident, k.sig, k.generics, k.body];
};
Item.prototype.expect_macro = function (this: Item) {
  const k = this.kind;
  if (k.$ !== "Macro") return item_expect_failed(this, "expect_macro");
  return [k._0, k._1, k._2];
};
Item.prototype.expect_mod = function (this: Item) {
  const k = this.kind;
  if (k.$ !== "Mod") return item_expect_failed(this, "expect_mod");
  return [k._0, k._1];
};
Item.prototype.expect_foreign_mod = function (this: Item) {
  const k = this.kind;
  if (k.$ !== "ForeignMod") return item_expect_failed(this, "expect_foreign_mod");
  return [k.abi, k.items];
};
Item.prototype.expect_global_asm = function (this: Item) {
  const k = this.kind;
  if (k.$ !== "GlobalAsm") return item_expect_failed(this, "expect_global_asm");
  return k.asm;
};
Item.prototype.expect_ty_alias = function (this: Item) {
  const k = this.kind;
  if (k.$ !== "TyAlias") return item_expect_failed(this, "expect_ty_alias");
  return [k._0, k._1, k._2];
};
Item.prototype.expect_enum = function (this: Item) {
  const k = this.kind;
  if (k.$ !== "Enum") return item_expect_failed(this, "expect_enum");
  return [k._0, k._1, k._2];
};
Item.prototype.expect_struct = function (this: Item) {
  const k = this.kind;
  if (k.$ !== "Struct") return item_expect_failed(this, "expect_struct");
  return [k._0, k._1, k._2];
};
Item.prototype.expect_union = function (this: Item) {
  const k = this.kind;
  if (k.$ !== "Union") return item_expect_failed(this, "expect_union");
  return [k._0, k._1, k._2];
};
Item.prototype.expect_trait = function (this: Item) {
  const k = this.kind;
  if (k.$ !== "Trait") return item_expect_failed(this, "expect_trait");
  return [k.impl_restriction, k.constness, k.is_auto, k.safety, k.ident, k.generics, k.bounds, k.items];
};
Item.prototype.expect_trait_alias = function (this: Item) {
  const k = this.kind;
  if (k.$ !== "TraitAlias") return item_expect_failed(this, "expect_trait_alias");
  return [k._0, k._1, k._2, k._3];
};
Item.prototype.expect_impl = function (this: Item) {
  const k = this.kind;
  if (k.$ !== "Impl") return item_expect_failed(this, "expect_impl");
  return k._0;
};
Item.prototype.expect_test_binder_constraints = function (this: Item) {
  const k = this.kind;
  if (k.$ !== "TestBinderConstraints") return item_expect_failed(this, "expect_test_binder_constraints");
  return [k.generics, k.body];
};

export type Safety = gen.Safety;
export const Safety = {
  ...gen.Safety,

  /** `#[derive(Default)]` (`#[default] Unsafe`) */
  default(): Safety {
    return "Unsafe";
  },

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

// impl fmt::Display for Safety
// rustc: compiler/rustc_hir/src/hir.rs:4424 fmt
export function display_Safety(self: Safety): string {
  switch (self) {
    case "Unsafe":
      return "unsafe";
    case "Safe":
      return "safe";
  }
}

export type Constness = gen.Constness;
export const Constness = {
  ...gen.Constness,

  /** `#[derive(PartialEq)]` */
  eq(a: Constness, b: Constness): boolean {
    return a.$ === b.$ && (a.$ !== "Const" || a.always === (b as typeof a).always);
  },

  /// This impl exists as an optimization so that metadata deserialization can
  /// store the value directly and not have to encode it wrapped in another `Option`.
  // impl Default for Constness
  // rustc: compiler/rustc_hir/src/hir.rs:4441 default
  default(): Constness {
    return { $: "Const", always: false };
  },
};

// impl fmt::Display for Constness
// rustc: compiler/rustc_hir/src/hir.rs:4447 fmt
export function display_Constness(self: Constness): string {
  switch (self.$) {
    case "Const":
      return self.always ? "comptime" : "const";
    case "NotConst":
      return "non-const";
  }
}

export type HeaderSafety = gen.HeaderSafety;
export const HeaderSafety = {
  ...gen.HeaderSafety,

  // impl From<Safety> for HeaderSafety
  // rustc: compiler/rustc_hir/src/hir.rs:4494 from
  from(v: Safety): HeaderSafety {
    return { $: "Normal", _0: v };
  },
};

declare module "./hir.gen.ts" {
  interface FnHeader {
    is_async(): boolean;
    is_unsafe(): boolean;
    is_safe(): boolean;
    safety_(): Safety;
  }
}

// rustc: compiler/rustc_hir/src/hir.rs:4508 is_async
FnHeader.prototype.is_async = function (this: FnHeader): boolean {
  return this.asyncness.$ === "Async";
};

// rustc: compiler/rustc_hir/src/hir.rs:4512 is_unsafe
FnHeader.prototype.is_unsafe = function (this: FnHeader): boolean {
  return Safety.is_unsafe(this.safety_());
};

// rustc: compiler/rustc_hir/src/hir.rs:4516 is_safe
FnHeader.prototype.is_safe = function (this: FnHeader): boolean {
  return Safety.is_safe(this.safety_());
};

// PORT: `safety()` is `safety_()`: the class has a field `safety` of the same name.
// rustc: compiler/rustc_hir/src/hir.rs:4520 safety
FnHeader.prototype.safety_ = function (this: FnHeader): Safety {
  switch (this.safety.$) {
    case "SafeTargetFeatures":
      return "Unsafe";
    case "Normal":
      return this.safety._0;
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
        return self._0.kind.$ === "Single" ? self._0.kind._0 : undefined;
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
    switch (self.$) {
      case "Struct":
        return self._2.$ === "Struct" && self._2.recovered.$ === "Yes";
      case "Union":
        return self._2.$ === "Struct" && self._2.recovered.$ === "Yes";
      case "Enum":
        return self._2.variants.some((v) => v.data.$ === "Struct" && v.data.recovered.$ === "Yes");
      default:
        return false;
    }
  },
};

// rustc: compiler/rustc_hir/src/hir.rs:4749 hir_id
ForeignItemId.prototype.hir_id = function (this: ForeignItemId): HirId {
  // Items are always HIR owners.
  return HirId_make_owner(this.owner_id.def_id);
};

declare module "./hir.gen.ts" {
  interface ForeignItem {
    hir_id(): HirId;
    foreign_item_id(): ForeignItemId;
  }
}

// rustc: compiler/rustc_hir/src/hir.rs:4766 hir_id
ForeignItem.prototype.hir_id = function (this: ForeignItem): HirId {
  // Items are always HIR owners.
  return HirId_make_owner(this.owner_id.def_id);
};

// rustc: compiler/rustc_hir/src/hir.rs:4771 foreign_item_id
ForeignItem.prototype.foreign_item_id = function (this: ForeignItem): ForeignItemId {
  return new ForeignItemId(this.owner_id);
};

// ---- OwnerNode / Node -------------------------------------------------------------------------------------------

/** `expect_methods_self!` failure of an `OwnerNode` / `Node` */
function owner_node_expect_failed(self: OwnerNode, name: string): never {
  return expect_failed(name, format_debug(self, debug_OwnerNode, PLAIN));
}
function node_expect_failed(self: Node, name: string): never {
  return expect_failed(name, format_debug(self, debug_Node, PLAIN));
}

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
    switch (self.$) {
      case "TraitItem":
        return self._0.kind.$ === "Fn" ? self._0.kind._0 : undefined;
      case "ImplItem":
        return self._0.kind.$ === "Fn" ? self._0.kind._0 : undefined;
      case "Item":
        return self._0.kind.$ === "Fn" ? self._0.kind.sig : undefined;
      case "ForeignItem":
        return self._0.kind.$ === "Fn" ? self._0.kind._0 : undefined;
      default:
        return undefined;
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:4847 fn_decl
  fn_decl(self: OwnerNode): FnDecl | undefined {
    switch (self.$) {
      case "TraitItem":
        return self._0.kind.$ === "Fn" ? self._0.kind._0.decl : undefined;
      case "ImplItem":
        return self._0.kind.$ === "Fn" ? self._0.kind._0.decl : undefined;
      case "Item":
        return self._0.kind.$ === "Fn" ? self._0.kind.sig.decl : undefined;
      case "ForeignItem":
        return self._0.kind.$ === "Fn" ? self._0.kind._0.decl : undefined;
      default:
        return undefined;
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:4859 body_id
  body_id(self: OwnerNode): BodyId | undefined {
    switch (self.$) {
      case "Item": {
        const k = self._0.kind;
        if (k.$ === "Static") return k._3;
        if (k.$ === "Const" && k._3.$ === "Body") return k._3._0;
        if (k.$ === "Fn") return k.body;
        return undefined;
      }
      case "TraitItem": {
        const k = self._0.kind;
        if (k.$ === "Fn" && k._1.$ === "Provided") return k._1._0;
        if (k.$ === "Const" && k._1 !== undefined && k._1.$ === "Body") return k._1._0;
        return undefined;
      }
      case "ImplItem": {
        const k = self._0.kind;
        if (k.$ === "Fn") return k._1;
        if (k.$ === "Const" && k._1.$ === "Body") return k._1._0;
        return undefined;
      }
      default:
        return undefined;
    }
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

  expect_item(self: OwnerNode): Item {
    if (self.$ !== "Item") return owner_node_expect_failed(self, "expect_item");
    return self._0;
  },
  expect_foreign_item(self: OwnerNode): ForeignItem {
    if (self.$ !== "ForeignItem") return owner_node_expect_failed(self, "expect_foreign_item");
    return self._0;
  },
  expect_impl_item(self: OwnerNode): ImplItem {
    if (self.$ !== "ImplItem") return owner_node_expect_failed(self, "expect_impl_item");
    return self._0;
  },
  expect_trait_item(self: OwnerNode): TraitItem {
    if (self.$ !== "TraitItem") return owner_node_expect_failed(self, "expect_trait_item");
    return self._0;
  },

  // impl<'hir> From<&'hir Item<'hir>> for OwnerNode<'hir>
  // rustc: compiler/rustc_hir/src/hir.rs:4911 from
  from_Item(val: Item): OwnerNode {
    return { $: "Item", _0: val };
  },

  // impl<'hir> From<&'hir ForeignItem<'hir>> for OwnerNode<'hir>
  // rustc: compiler/rustc_hir/src/hir.rs:4917 from
  from_ForeignItem(val: ForeignItem): OwnerNode {
    return { $: "ForeignItem", _0: val };
  },

  // impl<'hir> From<&'hir ImplItem<'hir>> for OwnerNode<'hir>
  // rustc: compiler/rustc_hir/src/hir.rs:4923 from
  from_ImplItem(val: ImplItem): OwnerNode {
    return { $: "ImplItem", _0: val };
  },

  // impl<'hir> From<&'hir TraitItem<'hir>> for OwnerNode<'hir>
  // rustc: compiler/rustc_hir/src/hir.rs:4929 from
  from_TraitItem(val: TraitItem): OwnerNode {
    return { $: "TraitItem", _0: val };
  },
};

export type Node = gen.Node;
export const Node = {
  ...gen.Node,

  // impl<'hir> From<OwnerNode<'hir>> for Node<'hir>
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
      case "Field":
      case "Variant":
      case "PathSegment":
        return self._0.ident;
      case "NestedUseTree":
        return self._0.kind.$ === "Single" ? self._0.kind._0 : undefined;
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
  fn_decl(self: Node): FnDecl | undefined {
    switch (self.$) {
      case "TraitItem":
        if (self._0.kind.$ === "Fn") return self._0.kind._0.decl;
        return undefined;
      case "ImplItem":
        if (self._0.kind.$ === "Fn") return self._0.kind._0.decl;
        return undefined;
      case "Item":
        if (self._0.kind.$ === "Fn") return self._0.kind.sig.decl;
        return undefined;
      case "ForeignItem":
        if (self._0.kind.$ === "Fn") return self._0.kind._0.decl;
        return undefined;
      case "Expr":
        if (self._0.kind.$ === "Closure") return self._0.kind._0.fn_decl;
        return undefined;
      default:
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
    switch (self.$) {
      case "TraitItem":
        return self._0.kind.$ === "Fn" ? self._0.kind._0 : undefined;
      case "ImplItem":
        return self._0.kind.$ === "Fn" ? self._0.kind._0 : undefined;
      case "Item":
        return self._0.kind.$ === "Fn" ? self._0.kind.sig : undefined;
      case "ForeignItem":
        return self._0.kind.$ === "Fn" ? self._0.kind._0 : undefined;
      default:
        return undefined;
    }
  },

  /// Get the type for constants, assoc types, type aliases and statics.
  // rustc: compiler/rustc_hir/src/hir.rs:5097 ty
  ty(self: Node): Ty | undefined {
    switch (self.$) {
      case "Item": {
        const k = self._0.kind;
        switch (k.$) {
          case "TyAlias":
            return k._2;
          case "Static":
            return k._2;
          case "Const":
            return k._2;
          case "Impl":
            return k._0.self_ty;
          default:
            return undefined;
        }
      }
      case "TraitItem": {
        const k = self._0.kind;
        switch (k.$) {
          case "Const":
            return k._0;
          case "Type":
            return k._1;
          default:
            return undefined;
        }
      }
      case "ImplItem": {
        const k = self._0.kind;
        switch (k.$) {
          case "Const":
            return k._0;
          case "Type":
            return k._0;
          default:
            return undefined;
        }
      }
      case "ForeignItem": {
        const k = self._0.kind;
        switch (k.$) {
          case "Static":
            return k._0;
          default:
            return undefined;
        }
      }
      case "GenericParam": {
        const k = self._0.kind;
        switch (k.$) {
          case "Lifetime":
            return undefined;
          case "Type":
            return k.default;
          case "Const":
            return k.ty;
        }
      }
      // falls through (unreachable: the inner match is exhaustive)
      case "Field":
        return (self as { _0: FieldDef })._0.ty;
      default:
        return undefined;
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:5130 alias_ty
  alias_ty(self: Node): Ty | undefined {
    if (self.$ === "Item" && self._0.kind.$ === "TyAlias") return self._0.kind._2;
    return undefined;
  },

  // rustc: compiler/rustc_hir/src/hir.rs:5138 associated_body
  associated_body(self: Node): [LocalDefId, BodyId] | undefined {
    switch (self.$) {
      case "Item": {
        const owner_id = self._0.owner_id;
        const k = self._0.kind;
        if (k.$ === "Const" && k._3.$ === "Body") return [owner_id.def_id, k._3._0];
        if (k.$ === "Static") return [owner_id.def_id, k._3];
        if (k.$ === "Fn") return [owner_id.def_id, k.body];
        if (k.$ === "GlobalAsm") return [owner_id.def_id, k.fake_body];
        return undefined;
      }
      case "TraitItem": {
        const owner_id = self._0.owner_id;
        const k = self._0.kind;
        if (k.$ === "Const" && k._1 !== undefined && k._1.$ === "Body") return [owner_id.def_id, k._1._0];
        if (k.$ === "Fn" && k._1.$ === "Provided") return [owner_id.def_id, k._1._0];
        return undefined;
      }
      case "ImplItem": {
        const owner_id = self._0.owner_id;
        const k = self._0.kind;
        if (k.$ === "Const" && k._1.$ === "Body") return [owner_id.def_id, k._1._0];
        if (k.$ === "Fn") return [owner_id.def_id, k._1];
        return undefined;
      }

      case "Expr":
        if (self._0.kind.$ === "Closure") {
          const { def_id, body } = self._0.kind._0;
          return [def_id, body];
        }
        return undefined;

      case "AnonConst":
        return [self._0.def_id, self._0.body];
      case "ConstBlock":
        return [self._0.def_id, self._0.body];

      default:
        return undefined;
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:5176 body_id
  body_id(self: Node): BodyId | undefined {
    const b = Node.associated_body(self);
    if (b === undefined) return undefined;
    return b[1];
  },

  // rustc: compiler/rustc_hir/src/hir.rs:5180 generics
  generics(self: Node): Generics | undefined {
    switch (self.$) {
      case "ForeignItem":
        if (self._0.kind.$ === "Fn") return self._0.kind._2;
        return undefined;
      case "TraitItem":
        return self._0.generics;
      case "ImplItem":
        return self._0.generics;
      case "Item":
        return ItemKind.generics(self._0.kind);
      default:
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
    switch (self.$) {
      case "Ty":
        return self._0.kind.$ === "Path" ? self._0.kind._0 : undefined;
      case "Expr":
        return self._0.kind.$ === "Path" ? self._0.kind._0 : undefined;
      case "PatExpr":
        return self._0.kind.$ === "Path" ? self._0.kind._0 : undefined;
      default:
        return undefined;
    }
  },

  expect_param(self: Node): gen.Param {
    if (self.$ !== "Param") return node_expect_failed(self, "expect_param");
    return self._0;
  },
  expect_item(self: Node): Item {
    if (self.$ !== "Item") return node_expect_failed(self, "expect_item");
    return self._0;
  },
  expect_foreign_item(self: Node): ForeignItem {
    if (self.$ !== "ForeignItem") return node_expect_failed(self, "expect_foreign_item");
    return self._0;
  },
  expect_trait_item(self: Node): TraitItem {
    if (self.$ !== "TraitItem") return node_expect_failed(self, "expect_trait_item");
    return self._0;
  },
  expect_impl_item(self: Node): ImplItem {
    if (self.$ !== "ImplItem") return node_expect_failed(self, "expect_impl_item");
    return self._0;
  },
  expect_variant(self: Node): gen.Variant {
    if (self.$ !== "Variant") return node_expect_failed(self, "expect_variant");
    return self._0;
  },
  expect_field(self: Node): FieldDef {
    if (self.$ !== "Field") return node_expect_failed(self, "expect_field");
    return self._0;
  },
  expect_anon_const(self: Node): gen.AnonConst {
    if (self.$ !== "AnonConst") return node_expect_failed(self, "expect_anon_const");
    return self._0;
  },
  expect_inline_const(self: Node): gen.ConstBlock {
    if (self.$ !== "ConstBlock") return node_expect_failed(self, "expect_inline_const");
    return self._0;
  },
  expect_expr(self: Node): Expr {
    if (self.$ !== "Expr") return node_expect_failed(self, "expect_expr");
    return self._0;
  },
  expect_expr_field(self: Node): gen.ExprField {
    if (self.$ !== "ExprField") return node_expect_failed(self, "expect_expr_field");
    return self._0;
  },
  expect_stmt(self: Node): gen.Stmt {
    if (self.$ !== "Stmt") return node_expect_failed(self, "expect_stmt");
    return self._0;
  },
  expect_path_segment(self: Node): PathSegment {
    if (self.$ !== "PathSegment") return node_expect_failed(self, "expect_path_segment");
    return self._0;
  },
  expect_ty(self: Node): Ty {
    if (self.$ !== "Ty") return node_expect_failed(self, "expect_ty");
    return self._0;
  },
  expect_assoc_item_constraint(self: Node): AssocItemConstraint {
    if (self.$ !== "AssocItemConstraint") return node_expect_failed(self, "expect_assoc_item_constraint");
    return self._0;
  },
  expect_trait_ref(self: Node): TraitRef {
    if (self.$ !== "TraitRef") return node_expect_failed(self, "expect_trait_ref");
    return self._0;
  },
  expect_opaque_ty(self: Node): gen.OpaqueTy {
    if (self.$ !== "OpaqueTy") return node_expect_failed(self, "expect_opaque_ty");
    return self._0;
  },
  expect_pat(self: Node): Pat {
    if (self.$ !== "Pat") return node_expect_failed(self, "expect_pat");
    return self._0;
  },
  expect_pat_field(self: Node): gen.PatField {
    if (self.$ !== "PatField") return node_expect_failed(self, "expect_pat_field");
    return self._0;
  },
  expect_arm(self: Node): gen.Arm {
    if (self.$ !== "Arm") return node_expect_failed(self, "expect_arm");
    return self._0;
  },
  expect_block(self: Node): Block {
    if (self.$ !== "Block") return node_expect_failed(self, "expect_block");
    return self._0;
  },
  expect_let_stmt(self: Node): gen.LetStmt {
    if (self.$ !== "LetStmt") return node_expect_failed(self, "expect_let_stmt");
    return self._0;
  },
  expect_ctor(self: Node): VariantData {
    if (self.$ !== "Ctor") return node_expect_failed(self, "expect_ctor");
    return self._0;
  },
  expect_lifetime(self: Node): Lifetime {
    if (self.$ !== "Lifetime") return node_expect_failed(self, "expect_lifetime");
    return self._0;
  },
  expect_generic_param(self: Node): GenericParam {
    if (self.$ !== "GenericParam") return node_expect_failed(self, "expect_generic_param");
    return self._0;
  },
  expect_crate(self: Node): Mod {
    if (self.$ !== "Crate") return node_expect_failed(self, "expect_crate");
    return self._0;
  },
  expect_infer(self: Node): InferArg {
    if (self.$ !== "Infer") return node_expect_failed(self, "expect_infer");
    return self._0;
  },
  expect_closure(self: Node): gen.Closure {
    if (!(self.$ === "Expr" && self._0.kind.$ === "Closure")) return node_expect_failed(self, "expect_closure");
    return self._0.kind._0;
  },
};
