// Port of compiler/rustc_mir_build/src/builder/matches/match_pair.rs (lane mb-matches-c; declared by builder-contract).
// Associated fns of the generated classes `FlatPat` (mod.gen.ts) and `InterPat` (match_pair.gen.ts) are assigned on
// the classes (`namespace` augmentation; builder/mod.ts header).
import { FieldIdx } from "../../../rustc_abi/layout.ts";
import { Place, type PlaceElem } from "../../../rustc_middle/mir/mod.ts";
import { type Pat } from "../../../rustc_middle/thir.ts";
import { Ty } from "../../../rustc_middle/ty/mod.ts";
import { debug_Ty, fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { TypeVisitableExt } from "../../../rustc_type_ir/visit.ts";
import { clone_PlaceBuilder, type PlaceBuilder } from "../expr/as_place.gen.ts";
import { PlaceBuilder_from_Place } from "../expr/as_place.ts";
import { InterPat, type InterPatKind } from "./match_pair.gen.ts";
import { type Ascription, type Binding, FlatPat, type MatchPairTree, PatternExtraData, type TestableCase } from "./mod.gen.ts";
import { Builder } from "../mod.ts";
import { span_bug } from "../../../rustc_span/macros.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { assert_eq, panic } from "../../../std/panic.ts";
import { u64_to_number } from "../../../rust_ts/u64.ts";
export * from "./match_pair.gen.ts";

declare module "./mod.gen.ts" {
  namespace FlatPat {
    // match_pair.rs:73 (lane mb-matches-c)
    function new_(place: PlaceBuilder, pattern: Pat, cx: Builder): FlatPat;
    export { new_ as new };
    // match_pair.rs:88 (lane mb-matches-c)
    export function from_inter_pat(inter_pat: InterPat): FlatPat;
  }
}

declare module "./match_pair.gen.ts" {
  namespace InterPat {
    // match_pair.rs:210 (lane mb-matches-c)
    export function lower_thir_pat(cx: Builder, place_builder: PlaceBuilder, pattern: Pat): InterPat;
  }
}

/// For an array or slice pattern's subpatterns (prefix/slice/suffix), returns a list
/// of those subpatterns, each paired with a suitably-projected [`PlaceBuilder`].
// rustc: compiler/rustc_mir_build/src/builder/matches/match_pair.rs:18 prefix_slice_suffix
export function prefix_slice_suffix(place: PlaceBuilder, array_len: number | undefined, prefix: readonly Pat[], opt_slice: Pat | undefined, suffix: readonly Pat[]): [PlaceBuilder, Pat][] {
  // Some for array patterns; None for slice patterns
  const prefix_len = prefix.length;
  const suffix_len = suffix.length;

  const output_pairs: [PlaceBuilder, Pat][] = [];

  // For slice patterns with a `..` followed by 0 or more suffix subpatterns,
  // the actual slice index of those subpatterns isn't statically known, so
  // we have to index them relative to the end of the slice.
  //
  // For array patterns, all subpatterns are indexed relative to the start.
  const [min_length, is_array]: [number, boolean] = array_len !== undefined ? [array_len, true] : [prefix_len + suffix_len, false];

  for (let offset = 0; offset < prefix.length; offset++) {
    const prefix_subpat = prefix[offset]!;
    const elem: PlaceElem = { $: "ConstantIndex", offset, min_length, from_end: false };
    const subplace = place.clone_project(elem);
    output_pairs.push([subplace, prefix_subpat]);
  }

  if (opt_slice !== undefined) {
    const slice_subpat = opt_slice;
    const elem: PlaceElem = {
      $: "Subslice",
      from: prefix_len,
      to: is_array ? min_length - suffix_len : suffix_len,
      from_end: !is_array,
    };
    const subplace = place.clone_project(elem);
    output_pairs.push([subplace, slice_subpat]);
  }

  for (let offset_from_end = 1; offset_from_end <= suffix.length; offset_from_end++) {
    const suffix_subpat = suffix[suffix.length - offset_from_end]!;
    const elem: PlaceElem = {
      $: "ConstantIndex",
      offset: is_array ? min_length - offset_from_end : offset_from_end,
      min_length,
      from_end: !is_array,
    };
    const subplace = place.clone_project(elem);
    output_pairs.push([subplace, suffix_subpat]);
  }

  return output_pairs;
}

/// Creates a `FlatPat` containing a simplified [`MatchPairTree`] list/forest
/// for the given pattern.
// rustc: compiler/rustc_mir_build/src/builder/matches/match_pair.rs:73 new
(FlatPat as unknown as { new: typeof FlatPat.new }).new = function (place: PlaceBuilder, pattern: Pat, cx: Builder): FlatPat {
  // Recursively lower the THIR pattern into an intermediate form,
  // then flatten into a `FlatPat`.
  const inter_pat = InterPat.lower_thir_pat(cx, place, pattern);
  return FlatPat.from_inter_pat(inter_pat);
};

/// Squashes an [`InterPat`] into a [`FlatPat`].
///
/// This is a separate function because it also needs to be called recursively
/// when squashing any or-patterns.
// rustc: compiler/rustc_mir_build/src/builder/matches/match_pair.rs:88 from_inter_pat
(FlatPat as unknown as { from_inter_pat: typeof FlatPat.from_inter_pat }).from_inter_pat = function (inter_pat: InterPat): FlatPat {
  const match_pairs: MatchPairTree[] = [];
  const extra_data = new PatternExtraData(inter_pat.pattern_span, [], [], inter_pat.is_never);
  squash_inter_pat(inter_pat, match_pairs, extra_data);

  return new FlatPat(match_pairs, extra_data);
};

/// Recursively squashes an [`InterPat`] into a forest of refutable [`MatchPairTree`]
/// nodes, while accumulating ascriptions and bindings.
// rustc: compiler/rustc_mir_build/src/builder/matches/match_pair.rs:104 squash_inter_pat
export function squash_inter_pat(
  inter_pat: InterPat,
  match_pairs: MatchPairTree[], // Newly-created nodes are added to this vector
  extra_data: PatternExtraData, // Bindings/ascriptions are added here
): void {
  // Destructure exhaustively to make sure we don't miss any fields.
  // The `is_never` field is not needed by `MatchPairTree` forests.
  const { kind, ascriptions, pattern_span } = inter_pat;

  // Type ascriptions can appear regardless of whether the node is an or-pattern.
  extra_data.ascriptions.push(...ascriptions);

  // Or patterns, refutable patterns, and irrefutable patterns all have different handling.
  switch (kind.$) {
    case "Or": {
      const or_subpats = kind.or_subpats.map((subpat) => FlatPat.from_inter_pat(subpat));

      if (!(or_subpats[0]!.extra_data.bindings.length === 0)) {
        // Hold a place for any bindings established in (possibly-nested) or-patterns.
        // By only holding a place when bindings are present, we skip over any
        // or-patterns that will be simplified by `merge_trivial_subcandidates`. In
        // other words, we can assume this expands into subcandidates.
        // FIXME(@dianne): this needs updating/removing if we always merge or-patterns
        extra_data.bindings.push({ $: "FromOrPattern" });
      }

      match_pairs.push({ kind: { $: "Or", or_subpats }, pattern_span });
      break;
    }

    case "Refutable": {
      const { place, testable_case, subpats } = kind;
      // Recursively squash any subpatterns into refutable `MatchPairTree` forests,
      // which will become the children of a new node.
      const subpairs: MatchPairTree[] = [];
      for (const subpat of subpats) {
        squash_inter_pat(subpat, subpairs, extra_data);
      }

      // This pattern is refutable, so push a new match-pair node.
      match_pairs.push({
        kind: { $: "Testable", place, testable_case, subpairs },
        pattern_span,
      });
      break;
    }

    case "Irrefutable": {
      const { subpats, binding } = kind;
      // Recursively squash any subpatterns into refutable `MatchPairTree` forests.
      // This must happen _before_ pushing the binding, as described by the binding step.
      for (const subpat of subpats) {
        // For irrefutable nodes, squash directly into the caller's match pairs.
        squash_inter_pat(subpat, match_pairs, extra_data);
      }

      // If present, the binding must be pushed _after_ traversing subpatterns.
      // This is so that when lowering something like `x @ NonCopy { copy_field }`,
      // the binding to `copy_field` will occur before the binding for `x`.
      // See <https://github.com/rust-lang/rust/issues/69971> for more background.
      if (binding !== undefined) {
        extra_data.bindings.push({ $: "One", _0: binding });
      }
      break;
    }
  }
}

// rustc: compiler/rustc_mir_build/src/builder/matches/match_pair.rs:210 lower_thir_pat
(InterPat as unknown as { lower_thir_pat: typeof InterPat.lower_thir_pat }).lower_thir_pat = function (cx: Builder, place_builder: PlaceBuilder, pattern: Pat): InterPat {
  // Force the place type to the pattern's type.
  // FIXME(oli-obk): can we use this to simplify slice/array pattern hacks?
  const resolved = place_builder.resolve_upvar(cx);
  if (resolved !== undefined) {
    place_builder = resolved;
  }

  if (!cx.tcx.next_trait_solver_globally()) {
    // Only add the OpaqueCast projection if the given place is an opaque type and the
    // expected type from the pattern is not.
    let may_need_cast: boolean;
    const base = place_builder.base_();
    switch (base.$) {
      case "Local": {
        const local = base._0;
        const ty = Place.ty_from(local, place_builder.projection_(), cx.local_decls, cx.tcx).ty;
        may_need_cast = ty !== pattern.ty && TypeVisitableExt.has_opaque_types(ty, fold_Ty);
        break;
      }
      default:
        may_need_cast = true;
        break;
    }
    if (may_need_cast) {
      place_builder = place_builder.project({ $: "OpaqueCast", _0: pattern.ty });
    }
  }

  const place = place_builder.try_to_place(cx);

  // Apply any type ascriptions to the value at `match_pair.place`.
  const ascriptions: Ascription[] = [];
  if (place !== undefined && pattern.extra !== undefined) {
    const extra = pattern.extra;
    for (const { annotation, variance } of extra.ascriptions) {
      ascriptions.push({
        source: place,
        // PORT: `annotation.clone()` (the derived `Clone` of `CanonicalUserTypeAnnotation`, as in `clone_Ascription`).
        annotation: { user_ty: annotation.user_ty, span: annotation.span, inferred_ty: annotation.inferred_ty },
        variance,
      });
    }
  }

  // For refutable nodes a place must be available, either because it is not a
  // closure upvar or because it was captured.
  const unwrap_place = (): Place => place ?? panic("refutable patterns must have captured a place");

  let kind: InterPatKind;
  const pattern_kind = pattern.kind;
  switch (pattern_kind.$) {
    case "Missing":
    case "Wild":
    case "Error": {
      kind = { $: "Irrefutable", subpats: [], binding: undefined };
      break;
    }

    case "Or": {
      const pats = pattern_kind.pats;
      const or_subpats = pats.map((subpat) => InterPat.lower_thir_pat(cx, clone_PlaceBuilder(place_builder), subpat));
      kind = { $: "Or", or_subpats };
      break;
    }

    case "Range": {
      const range = pattern_kind._0;
      assert_eq(pattern.ty, range.ty, (t) => debug_Ty(t, PLAIN));
      if (range.is_full_range(cx.tcx) === true) {
        kind = { $: "Irrefutable", subpats: [], binding: undefined };
      } else {
        kind = {
          $: "Refutable",
          place: unwrap_place(),
          // PORT: `Arc::clone(range)` shares the `PatRange`.
          testable_case: { $: "Range", _0: range },
          subpats: [],
        };
      }
      break;
    }

    case "Constant": {
      const value = pattern_kind.value;
      assert_eq(pattern.ty, value.ty, (t) => debug_Ty(t, PLAIN));

      // Classify the constant-pattern into further kinds, to
      // reduce the number of ad-hoc type tests needed later on.
      const pat_ty = pattern.ty;
      const const_kind = pat_ty.is_bool()
        ? "Bool"
        : pat_ty.is_integral() || pat_ty.is_char()
          ? "IntOrChar"
          : pat_ty.is_floating_point()
            ? "Float"
            : pat_ty.is_str()
              ? "String"
              : // FIXME(Zalathar): This still covers several different
                // categories (e.g. raw pointer, pattern-type)
                // which could be split out into their own kinds.
                "Other";

      kind = {
        $: "Refutable",
        place: unwrap_place(),
        testable_case: { $: "Constant", value, kind: const_kind },
        subpats: [],
      };
      break;
    }

    case "Binding": {
      const { mode, var: var_, is_shorthand, subpattern } = pattern_kind;
      // First, recurse into the subpattern, if any.
      // This is the `x @ P` case; have to keep matching against `P` now.
      const subpat: InterPat | undefined = subpattern === undefined ? undefined : InterPat.lower_thir_pat(cx, place_builder, subpattern);

      // Then push this binding, after any bindings in the subpattern.
      const binding: Binding | undefined =
        place === undefined
          ? undefined
          : {
              span: pattern.span,
              source: place,
              var_id: var_,
              binding_mode: mode,
              is_shorthand,
            };
      kind = { $: "Irrefutable", subpats: subpat === undefined ? [] : [subpat], binding };
      break;
    }

    case "Array": {
      const { prefix, slice, suffix } = pattern_kind;
      // Determine the statically-known length of the array type being matched.
      // This should always succeed for legal programs, but could fail for
      // erroneous programs (e.g. the type is `[u8; const { panic!() }]`),
      // so take care not to ICE if this fails.
      const pattern_ty_kind = pattern.ty.kind();
      const array_len = pattern_ty_kind.$ === "Array" ? pattern_ty_kind._1.try_to_target_usize(cx.tcx) : undefined;

      const subpats: InterPat[] = [];
      if (array_len !== undefined) {
        for (const [subplace, subpat] of prefix_slice_suffix(place_builder, u64_to_number(array_len, "prefix_slice_suffix"), prefix, slice, suffix)) {
          subpats.push(InterPat.lower_thir_pat(cx, subplace, subpat));
        }
      } else {
        // If the array length couldn't be determined, ignore the
        // subpatterns and delayed-assert that compilation will fail.
        cx.tcx.dcx().span_delayed_bug(pattern.span, `array length in pattern couldn't be determined for ty=${debug_Ty(pattern.ty, PLAIN)}`);
      }

      kind = { $: "Irrefutable", subpats, binding: undefined };
      break;
    }
    case "Slice": {
      const { prefix, slice, suffix } = pattern_kind;
      const subpats: InterPat[] = [];
      for (const [subplace, subpat] of prefix_slice_suffix(place_builder, undefined, prefix, slice, suffix)) {
        subpats.push(InterPat.lower_thir_pat(cx, subplace, subpat));
      }

      if (prefix.length === 0 && slice !== undefined && suffix.length === 0) {
        // A slice pattern shaped like `[..]` is irrefutable.
        // It can match a slice of any length, so no length test is needed.
        kind = { $: "Irrefutable", subpats, binding: undefined };
      } else {
        // Any other shape of slice pattern requires a length test.
        // Slice patterns with a `..` subpattern require a minimum
        // length; those without `..` require an exact length.
        const testable_case: TestableCase = {
          $: "Slice",
          len: prefix.length + suffix.length,
          op: slice !== undefined ? "GreaterOrEqual" : "Equal",
        };
        kind = { $: "Refutable", place: unwrap_place(), testable_case, subpats };
      }
      break;
    }

    case "Variant": {
      const { adt_def, variant_index, subpatterns } = pattern_kind;
      const downcast_place = place_builder.downcast(adt_def, variant_index); // `(x as Variant)`
      const subpats: InterPat[] = [];
      for (const { field, pattern: subpat } of subpatterns) {
        const subplace = downcast_place.clone_project({ $: "Field", _0: field, _1: subpat.ty });
        subpats.push(InterPat.lower_thir_pat(cx, subplace, subpat));
      }

      // We treat non-exhaustive enums the same independent of the crate they are
      // defined in, to avoid differences in the operational semantics between crates.
      const refutable = adt_def.variants().length > 1 || adt_def.is_variant_list_non_exhaustive();
      if (refutable) {
        const testable_case: TestableCase = { $: "Variant", adt_def, variant_index };
        kind = { $: "Refutable", place: unwrap_place(), testable_case, subpats };
      } else {
        kind = { $: "Irrefutable", subpats, binding: undefined };
      }
      break;
    }

    case "Leaf": {
      const subpatterns = pattern_kind.subpatterns;
      const subpats: InterPat[] = [];
      for (const { field, pattern: subpat } of subpatterns) {
        const subplace = place_builder.clone_project({ $: "Field", _0: field, _1: subpat.ty });
        subpats.push(InterPat.lower_thir_pat(cx, subplace, subpat));
      }
      kind = { $: "Irrefutable", subpats, binding: undefined };
      break;
    }

    case "Deref": {
      const subpattern = pattern_kind.subpattern;
      if (pattern_kind.pin === "Pinned") {
        const p_ty = pattern.ty.pinned_ty();
        const pinned_ref_ty =
          p_ty !== undefined && p_ty.is_ref() ? p_ty : span_bug(pattern.span, `bad type for pinned deref: ${debug_Ty(pattern.ty, PLAIN)}`);
        const subpat = InterPat.lower_thir_pat(
          cx,
          // Project into the `Pin(_)` struct, then deref the inner `&` or `&mut`.
          place_builder.field(FieldIdx.ZERO, pinned_ref_ty).deref(),
          subpattern,
        );

        kind = { $: "Irrefutable", subpats: [subpat], binding: undefined };
      } else {
        // PatKind::Deref { pin: Pinnedness::Not, .. } (shared with `DerefPattern { borrow: Box, .. }` below)
        const subpat = InterPat.lower_thir_pat(cx, place_builder.deref(), subpattern);
        kind = { $: "Irrefutable", subpats: [subpat], binding: undefined };
      }
      break;
    }

    case "DerefPattern": {
      const { subpattern, borrow } = pattern_kind;
      if (borrow.$ === "Box") {
        // PatKind::Deref { pin: Pinnedness::Not, .. } | PatKind::DerefPattern { borrow: DerefPatBorrowMode::Box, .. }
        const subpat = InterPat.lower_thir_pat(cx, place_builder.deref(), subpattern);
        kind = { $: "Irrefutable", subpats: [subpat], binding: undefined };
      } else {
        const mutability = borrow._0;
        // Create a new temporary for each deref pattern.
        // FIXME(deref_patterns): dedup temporaries to avoid multiple `deref()` calls?
        const temp = cx.temp(Ty.new_ref(cx.tcx, cx.tcx.lifetimes.re_erased, subpattern.ty, mutability), pattern.span);
        const subpat = InterPat.lower_thir_pat(cx, PlaceBuilder_from_Place(temp).deref(), subpattern);
        kind = {
          $: "Refutable",
          place: unwrap_place(),
          testable_case: { $: "Deref", temp, mutability },
          subpats: [subpat],
        };
      }
      break;
    }

    case "Guard": {
      // FIXME(guard_patterns)
      kind = { $: "Irrefutable", subpats: [], binding: undefined };
      break;
    }

    case "Never": {
      kind = {
        $: "Refutable",
        place: unwrap_place(),
        testable_case: { $: "Never" },
        subpats: [],
      };
      break;
    }
  }

  // A pattern node is guaranteed to never match if one of these is true:
  // - The node itself is a never pattern (`!`).
  // - It is not an or-pattern, and one of its subpatterns will never match.
  // - It is an or-pattern, and _all_ of its or-subpatterns will never match.
  let is_never: boolean;
  if (kind.$ === "Refutable" && kind.testable_case.$ === "Never") {
    is_never = true;
  } else if (kind.$ === "Refutable" || kind.$ === "Irrefutable") {
    is_never = kind.subpats.some((subpat) => subpat.is_never);
  } else {
    is_never = kind.or_subpats.every((subpat) => subpat.is_never);
  }

  return new InterPat(kind, ascriptions, pattern.span, is_never);
};
