// hir.rs fns part 1 (lines 1–1537), merged into hir.ts by the lane owner.
import * as gen from "./hir_standin.ts";
import type {
  AmbigArg,
  ConstArg as ConstArgT,
  GenericArgs as GenericArgsT,
  GenericBound as GenericBoundT,
  GenericParam,
  Generics as GenericsT,
  Lifetime as LifetimeT,
  LifetimeKind as LifetimeKindT,
  OwnerNode,
  ParentedNode,
  PathSegment as PathSegmentT,
  TraitRef,
  Ty,
  WhereBoundPredicate,
  WherePredicateKind as WherePredicateKindT,
  WhereRegionPredicate,
} from "./hir_standin.ts";
import type { HirTyCtxt } from "./intravisit.ts";
import { Node } from "./hir_part3.ts";
import { type Attribute } from "../rustc_attr_ir/lib.ts";
import { Fingerprint } from "../rustc_data_structures/fingerprint.ts";
import { SortedMap } from "../rustc_hir_id/definitions.ts";
import { type HirId, HirId_INVALID, ItemLocalId } from "../rustc_hir_id/lib.ts";
import { type DefId, DefId_eq, LocalDefId } from "../rustc_span/def_id.ts";
import { BoundConstness, BoundPolarity, ParamKindOrd, TraitObjectSyntax } from "../rustc_ast/lib.ts";
import { BytePos, DUMMY_SP, type ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import { display_Symbol, Ident, kw, type Symbol, sym } from "../rustc_span/symbol.ts";
import { debug_LifetimeSource } from "./hir_standin.ts";
import { PLAIN } from "../std/fmt.ts";
import { panic, unreachable, unwrap } from "../std/panic.ts";
import { Res } from "./def.ts";

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
