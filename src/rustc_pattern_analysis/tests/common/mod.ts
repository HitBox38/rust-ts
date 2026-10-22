// Port of compiler/rustc_pattern_analysis/tests/common/mod.rs (lane pat-b): the crate tests' own `PatCx` (a simple set
// of types, no rustc) and the `pats!` / `pat!` pattern builders.
//
// PORT:
// - `Ty` is a `$`-tagged union (`&'static [Ty]` is `readonly Ty[]`); the `PatCx` types bundle is `CxTypes`
//   (`type Error = ()` etc. are `null`).
// - The `pats!` / `pat!` macros are `pats(ty, src)` / `pat(ty, src)`: `src` is the macro input after `ty;` as a string,
//   parsed with the macro's grammar (tt-muncher stages `@ctor` / `@pat` / `@fields` are `parse_ctor` / `parse_pat` /
//   `parse_fields`). A `.$idx:ident` field index is written into the string by the caller (`` `Struct { .${i}: true }` ``).
// - `init_tracing` has nothing to set up (tracing is not ported).
// - `USEFULNESS_PORTED` (not upstream): whether `usefulness::compute_match_usefulness` (lane pat-a) is ported yet; the
//   tests that need it are skipped until it is. Lane pat-a: drop it and the `skipIf`s when you port usefulness.rs.
import {
  Constructor,
  type ConstructorSet,
  debug_Constructor,
  IntRange,
  MaybeInfiniteInt,
  RangeEnd,
  VariantVisibility,
} from "../../constructor.ts";
import { type MatchArm, type PatCx, PatCx_provided, PrivateUninhabitedField } from "../../lib.ts";
import { DeconstructedPat, type IndexedPat } from "../../pat.ts";
import { compute_match_usefulness as compute_match_usefulness_, PlaceValidity, type UsefulnessReport } from "../../usefulness.ts";
import { type Debug, debug_int, debug_struct, debug_tuple, debug_vec, type Fmt, PLAIN } from "../../../std/fmt.ts";
import { panic, Unported, unwrap } from "../../../std/panic.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";

/// Sets up `tracing` for easier debugging. Tries to look like the `rustc` setup.
// rustc: compiler/rustc_pattern_analysis/tests/common/mod.rs:10 init_tracing
function init_tracing(): void {
  // PORT: tracing is not ported; nothing to set up.
}

/// A simple set of types.
// #[derive(Debug, Copy, Clone, PartialEq, Eq)]
// rustc-type: compiler/rustc_pattern_analysis/tests/common/mod.rs:31 Ty
export type Ty =
  /// Booleans
  | { readonly $: "Bool" }
  /// 8-bit unsigned integers
  | { readonly $: "U8" }
  /// Tuples.
  | { readonly $: "Tuple"; readonly _0: readonly Ty[] }
  /// Enum with one variant of each given type.
  | { readonly $: "Enum"; readonly _0: readonly Ty[] }
  /// A struct with `arity` fields of type `ty`.
  | { readonly $: "BigStruct"; readonly arity: number; readonly ty: Ty }
  /// A enum with `arity` variants of type `ty`.
  | { readonly $: "BigEnum"; readonly arity: number; readonly ty: Ty }
  /// Like `Enum` but non-exhaustive.
  | { readonly $: "NonExhaustiveEnum"; readonly _0: readonly Ty[] };

/** The derived `Debug` of `Ty`. */
export const debug_Ty: Debug<Ty> = (v, f) => {
  switch (v.$) {
    case "Bool":
    case "U8":
      return v.$;
    case "Tuple":
    case "Enum":
    case "NonExhaustiveEnum":
      return debug_tuple(f, v.$, [debug_vec(v._0, f, debug_Ty)]);
    case "BigStruct":
    case "BigEnum":
      return debug_struct(f, v.$, [
        ["arity", debug_int(v.arity, f)],
        ["ty", debug_Ty(v.ty, f)],
      ]);
  }
};

export const UNIT: Ty = { $: "Tuple", _0: [] };
export const NEVER: Ty = { $: "Enum", _0: [] };

/** PORT: the `PatCx` types bundle of `Cx` (lib.ts header). */
export interface CxTypes {
  Ty: Ty;
  Error: null;
  VariantIdx: number;
  StrLit: null;
  ArmData: null;
  PatData: null;
}

/// The important logic.
export const Ty = {
  Bool: { $: "Bool" } as Ty,
  U8: { $: "U8" } as Ty,

  // rustc: compiler/rustc_pattern_analysis/tests/common/mod.rs:50 sub_tys
  sub_tys(self: Ty, ctor: Constructor<CxTypes>): Ty[] {
    // use Constructor::*;
    // `match (ctor, *self)`, arms in upstream order
    if (ctor.$ === "Struct" && self.$ === "Tuple") return [...self._0];
    if (ctor.$ === "Struct" && self.$ === "BigStruct") {
      const v: Ty[] = [];
      for (let i = 0; i < self.arity; i++) v.push(self.ty);
      return v;
    }
    if (ctor.$ === "Variant" && (self.$ === "Enum" || self.$ === "NonExhaustiveEnum")) return [unwrap(self._0[ctor._0])];
    if (ctor.$ === "Variant" && self.$ === "BigEnum") return [self.ty];
    if (ctor.$ === "Bool" || ctor.$ === "IntRange" || ctor.$ === "NonExhaustive" || ctor.$ === "Missing" || ctor.$ === "Wildcard") {
      return [];
    }
    return panic(`Unexpected ctor ${debug_Constructor(CX_STATIC)(ctor, PLAIN)} for type ${debug_Ty(self, PLAIN)}`);
  },

  // rustc: compiler/rustc_pattern_analysis/tests/common/mod.rs:62 is_empty
  is_empty(self: Ty): boolean {
    switch (self.$) {
      case "Bool":
      case "U8":
        return false;
      case "Tuple":
        return self._0.some((ty) => Ty.is_empty(ty));
      case "Enum":
        return self._0.every((ty) => Ty.is_empty(ty));
      case "BigStruct":
        return self.arity !== 0 && Ty.is_empty(self.ty);
      case "BigEnum":
        return self.arity === 0 || Ty.is_empty(self.ty);
      case "NonExhaustiveEnum":
        return false;
    }
  },

  // rustc: compiler/rustc_pattern_analysis/tests/common/mod.rs:73 ctor_set
  ctor_set(self: Ty): ConstructorSet<CxTypes> {
    switch (self.$) {
      case "Bool":
        return { $: "Bool" };
      case "U8":
        return {
          $: "Integers",
          range_1: IntRange.from_range(MaybeInfiniteInt.new_finite_uint(0n), MaybeInfiniteInt.new_finite_uint(255n), RangeEnd.Included),
          range_2: undefined,
        };
      case "Tuple":
      case "BigStruct":
        return { $: "Struct", empty: false };
      case "Enum":
        if (self._0.length === 0) return { $: "NoConstructors" };
        return {
          $: "Variants",
          variants: self._0.map((ty) => (Ty.is_empty(ty) ? VariantVisibility.Empty : VariantVisibility.Visible)),
          non_exhaustive: false,
        };
      case "NonExhaustiveEnum":
        return {
          $: "Variants",
          variants: self._0.map((ty) => (Ty.is_empty(ty) ? VariantVisibility.Empty : VariantVisibility.Visible)),
          non_exhaustive: true,
        };
      case "BigEnum": {
        if (self.arity === 0) return { $: "NoConstructors" };
        const vis = Ty.is_empty(self.ty) ? VariantVisibility.Empty : VariantVisibility.Visible;
        const variants: VariantVisibility[] = [];
        for (let i = 0; i < self.arity; i++) variants.push(vis);
        return { $: "Variants", variants, non_exhaustive: false };
      }
    }
  },

  // rustc: compiler/rustc_pattern_analysis/tests/common/mod.rs:127 write_variant_name
  write_variant_name(self: Ty, _f: Fmt, ctor: Constructor<CxTypes>): string {
    // `match (*self, ctor)`
    if (self.$ === "Tuple") return "";
    if (self.$ === "BigStruct") return "BigStruct";
    if ((self.$ === "Enum" || self.$ === "NonExhaustiveEnum") && ctor.$ === "Variant") return `Enum::Variant${ctor._0}`;
    if (self.$ === "BigEnum" && ctor.$ === "Variant") return `BigEnum::Variant${ctor._0}`;
    return `${debug_Ty(self, PLAIN)}::${debug_Constructor(CX_STATIC)(ctor, PLAIN)}`;
  },
};

/// Compute usefulness in our simple context (and set up tracing for easier debugging).
// rustc: compiler/rustc_pattern_analysis/tests/common/mod.rs:145 compute_match_usefulness
export function compute_match_usefulness(
  arms: readonly MatchArm<CxTypes>[],
  ty: Ty,
  scrut_validity: PlaceValidity,
  complexity_limit: number,
  exhaustive_witnesses: boolean,
): Result<UsefulnessReport<CxTypes>, null> {
  init_tracing();
  return compute_match_usefulness_(new Cx(exhaustive_witnesses), arms, ty, scrut_validity, complexity_limit);
}

// #[derive(Debug)]
// rustc-type: compiler/rustc_pattern_analysis/tests/common/mod.rs:163 Cx
/// The context for pattern analysis. Forwards anything interesting to `Ty` methods.
export class Cx implements PatCx<CxTypes> {
  constructor(readonly exhaustive_witnesses_: boolean) {}

  // type Ty = Ty; type Error = (); type VariantIdx = usize; type StrLit = (); type ArmData = (); type PatData = ();

  // rustc: compiler/rustc_pattern_analysis/tests/common/mod.rs:176 is_exhaustive_patterns_feature_on
  is_exhaustive_patterns_feature_on(): boolean {
    return false;
  }

  // PORT: the field `exhaustive_witnesses` is `exhaustive_witnesses_` (this method has the same name).
  // rustc: compiler/rustc_pattern_analysis/tests/common/mod.rs:180 exhaustive_witnesses
  exhaustive_witnesses(): boolean {
    return this.exhaustive_witnesses_;
  }

  // rustc: compiler/rustc_pattern_analysis/tests/common/mod.rs:184 ctor_arity
  ctor_arity(ctor: Constructor<CxTypes>, ty: Ty): number {
    return Ty.sub_tys(ty, ctor).length;
  }

  // rustc: compiler/rustc_pattern_analysis/tests/common/mod.rs:188 ctor_sub_tys
  ctor_sub_tys(ctor: Constructor<CxTypes>, ty: Ty): (readonly [Ty, PrivateUninhabitedField])[] {
    return Ty.sub_tys(ty, ctor).map((ty) => [ty, PrivateUninhabitedField(false)] as const);
  }

  // rustc: compiler/rustc_pattern_analysis/tests/common/mod.rs:196 ctors_for_ty
  ctors_for_ty(ty: Ty): Result<ConstructorSet<CxTypes>, null> {
    return Ok(Ty.ctor_set(ty));
  }

  // rustc: compiler/rustc_pattern_analysis/tests/common/mod.rs:200 write_variant_name
  write_variant_name(f: Fmt, ctor: Constructor<CxTypes>, ty: Ty): string {
    return Ty.write_variant_name(ty, f, ctor);
  }

  // rustc: compiler/rustc_pattern_analysis/tests/common/mod.rs:208 bug
  bug(fmt: string): null {
    return panic(`${fmt}`);
  }

  // (provided) lib.rs:86 delayed_bug -> PatCx_provided.delayed_bug
  delayed_bug(fmt: string): null {
    return PatCx_provided.delayed_bug(this, fmt);
  }
  // (provided) lib.rs:93 lint_overlapping_range_endpoints -> PatCx_provided.lint_overlapping_range_endpoints
  lint_overlapping_range_endpoints(
    pat: DeconstructedPat<CxTypes>,
    overlaps_on: IntRange,
    overlaps_with: readonly DeconstructedPat<CxTypes>[],
  ): void {
    PatCx_provided.lint_overlapping_range_endpoints(this, pat, overlaps_on, overlaps_with);
  }

  /// Abort when reaching the complexity limit. This is what we'll check in tests.
  // rustc: compiler/rustc_pattern_analysis/tests/common/mod.rs:213 complexity_exceeded
  complexity_exceeded(): Result<null, null> {
    return Err(null);
  }

  // (provided) lib.rs:108 lint_non_contiguous_range_endpoints -> PatCx_provided.lint_non_contiguous_range_endpoints
  lint_non_contiguous_range_endpoints(pat: DeconstructedPat<CxTypes>, gap: IntRange, gapped_with: readonly DeconstructedPat<CxTypes>[]): void {
    PatCx_provided.lint_non_contiguous_range_endpoints(this, pat, gap, gapped_with);
  }
  // (provided) lib.rs:117 match_may_contain_deref_pats -> PatCx_provided.match_may_contain_deref_pats
  match_may_contain_deref_pats(): boolean {
    return PatCx_provided.match_may_contain_deref_pats(this);
  }

  // rustc: compiler/rustc_pattern_analysis/tests/common/mod.rs:217 report_mixed_deref_pat_ctors
  report_mixed_deref_pat_ctors(_deref_pat: DeconstructedPat<CxTypes>, _normal_pat: DeconstructedPat<CxTypes>): null {
    return panic("`rustc_pattern_analysis::tests` currently doesn't test deref pattern errors");
  }

  // ---- the static side (lib.ts `PatCxStatic`) ----
  /** `<Ty as fmt::Debug>::fmt` */
  debug_Ty(v: Ty, f: Fmt): string {
    return debug_Ty(v, f);
  }
  /** `<usize as fmt::Debug>::fmt` */
  debug_VariantIdx(v: number, f: Fmt): string {
    return debug_int(v, f);
  }
  /** `<() as fmt::Debug>::fmt` */
  debug_StrLit(_v: null, _f: Fmt): string {
    return "()";
  }
  /** `<() as fmt::Debug>::fmt` */
  debug_ArmData(_v: null, _f: Fmt): string {
    return "()";
  }
  /** `<() as PartialEq>::eq` */
  StrLit_eq(_a: null, _b: null): boolean {
    return true;
  }
}

/** The static side of `Cx` (lib.ts header). */
export const CX_STATIC: Cx = Cx.prototype;

/// Construct a single pattern; see `pats!()`.
// macro_rules! pat
export function pat(ty: Ty, src: string): DeconstructedPat<CxTypes> {
  const vec = pats(ty, src);
  return unwrap(vec.pop());
}

/// A macro to construct patterns. Called like `pats!(type_expr; pattern, pattern, ..)` and returns
/// a `Vec<DeconstructedPat>`. A pattern can be nested and looks like `Constructor(pat, pat)` or
/// `Constructor { .i: pat, .j: pat }`, where `Constructor` is `Struct`, `Variant.i` (with index
/// `i`), as well as booleans and integer ranges.
///
/// The general structure of the macro is a tt-muncher with several stages identified with
/// `@something(args)`. The args are a key-value list (the keys ensure we don't mix the arguments
/// around) which is passed down and modified as needed. We then parse token-trees from
/// left-to-right. Non-trivial recursion happens when we parse the arguments to a pattern: we
/// recurse to parse the tokens inside `{..}`/`(..)`, and then we continue parsing anything that
/// follows.
// macro_rules! pats
export function pats(ty: Ty, src: string): DeconstructedPat<CxTypes>[] {
  const p = new PatsParser(src);
  // The heart of the macro is designed to push `IndexedPat`s into a `Vec`, so we work around
  // that.
  const vec: IndexedPat<CxTypes>[] = [];
  // `let sub_tys = ::std::iter::repeat(&ty);`
  p.parse_fields(vec, () => ty, undefined);
  return vec.map((ipat) => ipat.pat);
}

/** PORT: the token-tree stages of `pats!` over the macro input (header). */
class PatsParser {
  private readonly toks: string[];
  private pos = 0;

  constructor(src: string) {
    this.toks = src.match(/\.\.=|\.\.|[A-Za-z_][A-Za-z0-9_]*|[0-9]+|\S/g) ?? [];
  }

  private peek(k = 0): string | undefined {
    return this.toks[this.pos + k];
  }
  private next(): string {
    return unwrap(this.toks[this.pos++], `pats!: unexpected end of input`);
  }
  private expect(t: string): void {
    const n = this.next();
    if (n !== t) panic(`pats!: expected \`${t}\`, found \`${n}\``);
  }
  private static is_literal(t: string | undefined): boolean {
    return t !== undefined && /^[0-9]+$/.test(t);
  }

  /** `@fields(idx, vec, sub_tys)`: patterns separated by `,`, each optionally prefixed by `.i:`. */
  parse_fields(vec: IndexedPat<CxTypes>[], sub_ty: (idx: number) => Ty, closer: string | undefined): void {
    let idx = 0;
    while (this.peek() !== closer) {
      // `.i: pat` sets the current index to `i`.
      if (this.peek() === "." && this.peek(2) === ":") {
        this.next();
        idx = Number(this.next());
        this.next();
      }
      // Field without an explicit index; we use the current index which gets incremented above.
      vec.push(this.parse_pat(sub_ty, idx));
      idx = idx + 1;
      if (this.peek() === ",") this.next();
      else break;
    }
  }

  /** `@ctor` then `@pat`: a constructor and its optional `(..)` / `{..}` subpatterns. */
  private parse_pat(sub_tys: (idx: number) => Ty, index: number): IndexedPat<CxTypes> {
    const ctor = this.parse_ctor();
    // Silly dance to work with both a vec and `iter::repeat()`.
    const ty = sub_tys(index);
    const ctor_sub_tys = Ty.sub_tys(ty, ctor);
    const fields: IndexedPat<CxTypes>[] = [];
    // `(..)` and `{..}` are treated the same.
    const open = this.peek();
    if (open === "(" || open === "{") {
      this.next();
      const closer = open === "(" ? ")" : "}";
      // Parse subpatterns (note the leading comma).
      this.parse_fields(fields, (i) => unwrap(ctor_sub_tys[i]), closer);
      this.expect(closer);
    }
    const arity = ctor_sub_tys.length;
    return DeconstructedPat.new<CxTypes>(ctor, fields, arity, ty, null).at_index(index);
  }

  /** `@ctor`: the constructor (a tuple `( .. )` is `Struct`, its group is left for `@pat`). */
  private parse_ctor(): Constructor<CxTypes> {
    const t = this.peek();
    switch (t) {
      case "true":
        this.next();
        return { $: "Bool", _0: true };
      case "false":
        this.next();
        return { $: "Bool", _0: false };
      case "Struct":
        this.next();
        return Constructor.Struct;
      case "(":
        return Constructor.Struct; // tuples
      case "Variant": {
        this.next();
        this.expect(".");
        return { $: "Variant", _0: Number(this.next()) };
      }
      case "_":
        this.next();
        return Constructor.Wildcard;
    }
    // Integers and int ranges
    const start = PatsParser.is_literal(t) ? BigInt(this.next()) : undefined;
    // Utility to manage range boundaries.
    const lo = start !== undefined ? MaybeInfiniteInt.new_finite_uint(start) : MaybeInfiniteInt.NegInfinity;
    const op = this.peek();
    if (op === "..") {
      this.next();
      if (PatsParser.is_literal(this.peek())) {
        const end = BigInt(this.next());
        return { $: "IntRange", _0: IntRange.from_range(lo, MaybeInfiniteInt.new_finite_uint(end), RangeEnd.Excluded) };
      }
      return { $: "IntRange", _0: IntRange.from_range(lo, MaybeInfiniteInt.PosInfinity, RangeEnd.Excluded) };
    }
    if (op === "..=") {
      this.next();
      const end = BigInt(this.next());
      return { $: "IntRange", _0: IntRange.from_range(lo, MaybeInfiniteInt.new_finite_uint(end), RangeEnd.Included) };
    }
    if (start !== undefined) {
      return { $: "IntRange", _0: IntRange.from_range(lo, MaybeInfiniteInt.new_finite_uint(start), RangeEnd.Included) };
    }
    return panic(`pats!: no rule expected the token \`${t}\``);
  }
}

/** Not upstream (header): whether lane pat-a's `compute_match_usefulness` is ported. */
export const USEFULNESS_PORTED: boolean = (() => {
  try {
    compute_match_usefulness([], Ty.Bool, PlaceValidity.ValidOnly, Number.MAX_SAFE_INTEGER, false);
    return true;
  } catch (e) {
    if (e instanceof Unported && e.what.startsWith("rustc_pattern_analysis::")) return false;
    throw e;
  }
})();
