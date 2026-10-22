// Port of compiler/rustc_ty_utils/src/layout.rs (lane layout-contract: `provide`, the `layout_of` provider and `error`;
// lane ty-utils-layout: the rest). Conventions: docs/handoff/layout-contract.md and the rustc_abi layout.ts /
// rustc_middle ty/layout.ts headers (`cx.tcx()` is `cx.tcx_()`, `&'tcx LayoutError` is `LayoutError`,
// `tcx.arena.alloc(x)` is `x`).
// PORT (ty-utils-layout):
// - `?` inside the closures / iterator chains (`univariant`, the field-layout `try_collect`s) returns at the first
//   `Err`, in upstream order; `IndexVec`s are arrays.
// - `ty::Adt(def, _) if def.repr().scalable()` / `if def.repr().simd()` / `ty::Adt(def, args)` are one `case "Adt"`
//   with the guards as `if`s in upstream arm order.
// - `-Zprint-type-sizes`: rustc_session code_stats.rs is not ported; its types are local views at the bottom of this
//   file and `Session::code_stats` (a deferred field) stops UNPORTED when a layout is recorded.
import { find_attr } from "../rustc_attr_ir/lib.ts";
import { LangItem } from "../rustc_attr_ir/lang_items.gen.ts";
import {
  AddressSpace,
  type Align,
  debug_FieldsShape,
  debug_LayoutCalculatorError,
  debug_LayoutData,
  debug_Size,
  FieldIdx,
  FieldsShape,
  FIRST_VARIANT,
  Float,
  type Integer,
  type Layout,
  type LayoutCalculatorError,
  LayoutData,
  Niche,
  NicheOptimizations,
  Primitive,
  ReprOptions,
  Scalar,
  Size,
  StructKind,
  TyAndLayout,
  type VariantIdx,
  WrappingRange,
} from "../rustc_abi/lib.ts";
import type { LayoutCalculatorResult, RangeFrom, RangeToInclusive } from "../rustc_abi/layout.ts";
import { Fingerprint } from "../rustc_data_structures/fingerprint.ts";
import { Hash64 } from "../rustc_hashes/lib.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import { ObligationCause } from "../rustc_middle/traits/mod.ts";
import { Value } from "../rustc_middle/ty/consts/valtree.ts";
import type { AdtDef, Const, CoroutineLayout, GenericArgs } from "../rustc_middle/ty/decls.ts";
import {
  debug_LayoutError,
  debug_TyAndLayout_Ty,
  FloatExt,
  IntegerExt,
  type LayoutCx as LayoutCxT,
  LayoutCx,
  type LayoutError,
  PrimitiveExt,
  SimdLayoutError,
  type TyAndLayout as MiddleTyAndLayout,
} from "../rustc_middle/ty/layout.ts";
import { DataTypeKind_from_AdtKind, type DataTypeKind } from "../rustc_middle/ty/adt.ts";
import { HasAttrs_DefId, type ParamEnv, type PseudoCanonicalInput, Ty, type TypingEnv, ParamEnv_eq, TypingEnv as TypingEnvC } from "../rustc_middle/ty/mod.ts";
import { display_Ty, with_no_trimmed_paths } from "../rustc_middle/ty/print/pretty.ts";
import { debug_Ty, fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { CoroutineArgsExt } from "../rustc_middle/ty/sty.ts";
import type { TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import { DefPathHash, type DefId } from "../rustc_span/def_id.ts";
import { bug } from "../rustc_span/macros.ts";
import { sym, Symbol } from "../rustc_span/symbol.ts";
import { Limit } from "../rustc_structures/limit.ts";
import { EarlyBinder } from "../rustc_type_ir/binder.ts";
import { set_aliases_to_non_rigid } from "../rustc_type_ir/fold.ts";
import { TypingMode, TypingModeEqWrapper_eq } from "../rustc_type_ir/infer_ctxt.ts";
import { debug_Const, fold_Const } from "../rustc_type_ir/sty/mod.ts";
import { ClosureArgs, CoroutineArgs, CoroutineClosureArgs } from "../rustc_type_ir/ty_kind/closure.ts";
import { IsRigid, type TyKind, UnsafeBinderInner } from "../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import { PLAIN, PRETTY } from "../std/fmt.ts";
import { assert, assert_eq, panic, unported, unreachable, unwrap } from "../std/panic.ts";
import { Err, Ok, type Result, unwrap_result } from "../std/result.ts";
import { NonPrimitiveSimdType_diagnostic } from "./diagnostics.ts";
import * as invariant from "./layout/invariant.ts";

// mod invariant;

// rustc: compiler/rustc_ty_utils/src/layout.rs:35 provide
export function provide(providers: Providers): void {
  // *providers = Providers { layout_of, ..*providers };
  providers.layout_of = layout_of;
}

/** PORT (layout-contract): the derived `PartialEq` of `ty::TypingEnv` (`typing_mode` by `TypingModeEqWrapper`'s impl). */
function typing_env_eq(a: TypingEnv, b: TypingEnv): boolean {
  return TypingModeEqWrapper_eq(a.typing_mode_, b.typing_mode_) && ParamEnv_eq(a.param_env, b.param_env);
}

// #[instrument(skip(tcx, query), level = "debug")]
// rustc: compiler/rustc_ty_utils/src/layout.rs:40 layout_of
function layout_of(tcx: import("../rustc_middle/ty/context.ts").TyCtxt, query: PseudoCanonicalInput<Ty>): Result<MiddleTyAndLayout, LayoutError> {
  const { typing_env: original_typing_env, value: original_ty } = query;
  // debug!(?original_ty);

  // Optimization: We convert to TypingMode::PostAnalysis and convert opaque types in
  // the where bounds to their hidden types. This reduces overall uncached invocations
  // of `layout_of` and is thus a small performance improvement.
  const typing_env = original_typing_env.with_post_analysis_normalized(tcx);
  // Switching to `PostAnalysis` typing mode will reveal opaque types that's marked
  // as rigid in the original typing env.
  const unnormalized_ty = !typing_env_eq(typing_env, original_typing_env)
    ? set_aliases_to_non_rigid(tcx, original_ty, fold_Ty)
    : Unnormalized.new_wip(original_ty);

  // FIXME: We might want to have two different versions of `layout_of`:
  // One that can be called after typecheck has completed and can use
  // `normalize_erasing_regions` here and another one that can be called
  // before typecheck has completed and uses `try_normalize_erasing_regions`.
  const r = tcx.try_normalize_erasing_regions(typing_env, unnormalized_ty, fold_Ty);
  let normalized_ty: Ty;
  if (r.$ === "Ok") {
    normalized_ty = r._0;
  } else {
    const normalization_error = r._0;
    return Err(
      /* tcx.arena.alloc( */ {
        $: "NormalizationFailure",
        _0: Unnormalized.skip_normalization(unnormalized_ty),
        _1: normalization_error,
      },
    );
  }

  if (normalized_ty !== original_ty) {
    // Ensure this layout is also cached for the normalized type.
    return tcx.layout_of(typing_env.as_query_input(normalized_ty));
  }

  switch (typing_env.typing_mode().$) {
    case "Codegen": {
      const with_postanalysis = TypingEnvC.new(typing_env.param_env, TypingMode.PostAnalysis);
      const res = tcx.layout_of(with_postanalysis.as_query_input(normalized_ty));
      if (res.$ === "Err" && res._0.$ === "TooGeneric") {
        // Err(LayoutError::TooGeneric(_)) => {}
      } else {
        return res;
      }
      break;
    }
    case "Coherence":
    case "Typeck":
    case "PostTypeckUntilBorrowck":
    case "PostBorrowck":
    case "Reflection":
    case "ErasedNotCoherence":
    case "PostAnalysis":
      break;
  }

  const cx = LayoutCx.new(tcx, typing_env);

  const layout_r = layout_of_uncached(cx, normalized_ty);
  if (layout_r.$ === "Err") return layout_r;
  const layout = new TyAndLayout(normalized_ty, layout_r._0);

  // If we are running with `-Zprint-type-sizes`, maybe record layouts
  // for dumping later.
  if (cx.tcx_().sess.opts.unstable_opts.print_type_sizes) {
    record_layout_for_printing(cx, layout);
  }

  invariant.layout_sanity_check(cx, layout);

  return Ok(layout);
}

// rustc: compiler/rustc_ty_utils/src/layout.rs:113 error
export function error(_cx: LayoutCxT, err: LayoutError): LayoutError {
  return /* cx.tcx().arena.alloc( */ err;
}

// rustc: compiler/rustc_ty_utils/src/layout.rs:117 map_error
export function map_error(cx: LayoutCxT, ty: Ty, err: LayoutCalculatorError<MiddleTyAndLayout>): LayoutError {
  let err_: LayoutError;
  switch (err.$) {
    case "SizeOverflow": {
      // This is sometimes not a compile error in `check` builds.
      // See `tests/ui/limits/huge-enum.rs` for an example.
      err_ = { $: "SizeOverflow", _0: ty };
      break;
    }
    case "UnexpectedUnsized": {
      const field = err._0;
      // This is sometimes not a compile error if there are trivially false where clauses.
      // See `tests/ui/layout/trivial-bounds-sized.rs` for an example.
      if (!field.layout.deref_().is_unsized()) {
        panic(`invalid layout error ${debug_LayoutCalculatorError(err, PRETTY, debug_TyAndLayout_Ty)}`);
      }
      if (cx.typing_env.param_env.is_empty()) {
        cx.tcx_()
          .dcx()
          .delayed_bug(`encountered unexpected unsized field in layout of ${debug_Ty(ty, PLAIN)}: ${debug_TyAndLayout_Ty(field, PRETTY)}`);
      }
      err_ = { $: "Unknown", _0: ty };
      break;
    }
    case "EmptyUnion": {
      // This is always a compile error.
      const guar = cx.tcx_().dcx().delayed_bug(`computed layout of empty union: ${debug_Ty(ty, PLAIN)}`);
      err_ = { $: "ReferencesError", _0: guar };
      break;
    }
    case "ReprConflict": {
      // packed enums are the only known trigger of this, but others might arise
      const guar = cx.tcx_().dcx().delayed_bug(`computed impossible repr (packed enum?): ${debug_Ty(ty, PLAIN)}`);
      err_ = { $: "ReferencesError", _0: guar };
      break;
    }
    case "ZeroLengthSimdType": {
      // Can't be caught in typeck if the array length is generic.
      err_ = { $: "InvalidSimd", ty, kind: SimdLayoutError.ZeroLength };
      break;
    }
    case "OversizedSimdType": {
      const max_lanes = err.max_lanes;
      // Can't be caught in typeck if the array length is generic.
      err_ = { $: "InvalidSimd", ty, kind: { $: "TooManyLanes", _0: Limit.new(max_lanes) } };
      break;
    }
    case "NonPrimitiveSimdType": {
      const field = err._0;
      // This error isn't caught in typeck, e.g., if
      // the element type of the vector is generic.
      return cx.tcx_().dcx().emit_fatal(NonPrimitiveSimdType_diagnostic({ ty, e_ty: field.ty }));
    }
  }
  return error(cx, err_);
}

// rustc: compiler/rustc_ty_utils/src/layout.rs:170 extract_const_value
export function extract_const_value(cx: LayoutCxT, ty: Ty, ct: Const): Result<Value, LayoutError> {
  const k = ct.kind();
  switch (k.$) {
    case "Value": {
      const cv = k._0;
      return Ok(cv);
    }
    case "Param":
    case "Expr": {
      if (!TypeVisitableExt.has_param(ct, fold_Const)) {
        return bug(`failed to normalize const, but it is not generic: ${debug_Const(ct, PLAIN)}`);
      }
      return Err(error(cx, { $: "TooGeneric", _0: ty }));
    }
    case "Alias": {
      let err: LayoutError;
      if (TypeVisitableExt.has_param(ct, fold_Const)) {
        err = { $: "TooGeneric", _0: ty };
      } else {
        // This case is reachable with unsatisfiable predicates and GCE (which will
        // cause anon consts to inherit the unsatisfiable predicates). For example
        // if we have an unsatisfiable `u8: Trait` bound, then it's not a compile
        // error to mention `[u8; <u8 as Trait>::CONST]`, but we can't compute its
        // layout.
        err = { $: "Unknown", _0: ty };
      }
      return Err(error(cx, err));
    }
    case "Infer":
    case "Bound":
    case "Placeholder":
    case "Error": {
      // `ty::ConstKind::Error` is handled at the top of `layout_of_uncached`
      // (via `ty.error_reported()`).
      return bug(`layout_of: unexpected const: ${debug_Const(ct, PLAIN)}`);
    }
  }
}

/** PORT: the derived `Clone` of `LayoutData` (`LayoutData::clone(&layout.0)`): a fresh, unfrozen `LayoutData`. Its
 * field values are immutable (or deep-frozen, from the interned source) and shared; whatever the caller mutates in
 * place it first replaces with a fresh object (layout-contract decision 3). */
function clone_LayoutData(l: LayoutData): LayoutData {
  return new LayoutData(
    l.fields,
    l.variants,
    l.backend_repr,
    l.largest_niche,
    l.uninhabited,
    l.align,
    l.size,
    l.max_repr_align,
    l.unadjusted_abi_align,
    l.repr_c,
    l.randomization_seed,
  );
}

/** PORT: `scalar.valid_range_mut().start = v` / `.end = v` (layout-contract decision 3: `WrappingRange` is immutable). */
function set_valid_range_start(scalar: Scalar, start: bigint): void {
  const r = Scalar.valid_range_mut(scalar);
  r.value = r.value.with_start(start);
}
function set_valid_range_end(scalar: Scalar, end: bigint): void {
  const r = Scalar.valid_range_mut(scalar);
  r.value = r.value.with_end(end);
}

/** PORT: `x as usize` of a `u64` that feeds a `usize` API taking a `number`: never silently round (root decision on
 * `Size`; values beyond 2^53 stop UNPORTED). */
function u64_as_usize(x: bigint): number {
  if (x > BigInt(Number.MAX_SAFE_INTEGER)) {
    return unported("Size beyond 2^53 (rustc_ty_utils::layout: u64 as usize)");
  }
  return Number(x);
}

/** PORT: `cfg!(debug_assertions)`: rustc ships without debug assertions (a function, so the guarded code type-checks). */
function cfg_debug_assertions(): boolean {
  return false;
}

// rustc: compiler/rustc_ty_utils/src/layout.rs:207 layout_of_uncached
export function layout_of_uncached(cx: LayoutCxT, ty: Ty): Result<Layout, LayoutError> {
  // Types that reference `ty::Error` pessimistically don't have a meaningful layout.
  // The only side-effect of this is possibly worse diagnostics in case the layout
  // was actually computable (like if the `ty::Error` showed up only in a `PhantomData`).
  const reported = TypeVisitableExt.error_reported(ty, fold_Ty);
  if (reported.$ === "Err") {
    const guar = reported._0;
    return Err(error(cx, { $: "ReferencesError", _0: guar }));
  }

  const tcx = cx.tcx_();

  // layout of `async_drop_in_place<T>::{closure}` in case,
  // when T is a coroutine, contains this internal coroutine's ref

  const dl = cx.data_layout();
  const map_layout = (result: LayoutCalculatorResult<MiddleTyAndLayout>): Result<Layout, LayoutError> => {
    if (result.$ === "Ok") {
      const layout = result._0;
      return Ok(tcx.mk_layout(layout));
    } else {
      const err = result._0;
      return Err(map_error(cx, ty, err));
    }
  };
  const scalar_unit = (value: Primitive): Scalar => {
    const size = Primitive.size(value, dl);
    assert(size.bits() <= 128, "assertion failed: size.bits() <= 128");
    return { $: "Initialized", value, valid_range: WrappingRange.full(size) };
  };
  const scalar = (value: Primitive): Layout => tcx.mk_layout(LayoutData.scalar(cx, scalar_unit(value)));

  const univariant = (tys: readonly Ty[], kind: StructKind): Result<Layout, LayoutError> => {
    const fields: MiddleTyAndLayout[] = [];
    for (const ty of tys) {
      const r = cx.layout_of(ty);
      if (r.$ === "Err") return r;
      fields.push(r._0);
    }
    const repr = ReprOptions.default();
    return map_layout(cx.calc.layout_of_univariant(fields, repr, kind));
  };
  // debug_assert!(!ty.has_non_region_infer());

  const k = ty.kind();
  let result: Layout;
  switch (k.$) {
    case "Pat": {
      const ty = k._0;
      const pat = k._1;
      const r = cx.layout_of(ty);
      if (r.$ === "Err") return r;
      const layout_ = r._0.layout;
      const layout = clone_LayoutData(layout_.internee);
      const pk = pat.kind();
      switch (pk.$) {
        case "Range": {
          const { start, end } = pk;
          if (layout.backend_repr.$ === "Scalar") {
            // PORT: `&mut layout.backend_repr`: the scalar is a fresh copy (`clone_LayoutData`).
            const scalar: Scalar = { ...layout.backend_repr._0 };
            layout.backend_repr = { $: "Scalar", _0: scalar };
            const sv = extract_const_value(cx, ty, start);
            if (sv.$ === "Err") return sv;
            const sb = Value.try_to_bits(sv._0, tcx, cx.typing_env);
            if (sb === undefined) return Err(error(cx, { $: "Unknown", _0: ty }));
            set_valid_range_start(scalar, sb);

            const ev = extract_const_value(cx, ty, end);
            if (ev.$ === "Err") return ev;
            const eb = Value.try_to_bits(ev._0, tcx, cx.typing_env);
            if (eb === undefined) return Err(error(cx, { $: "Unknown", _0: ty }));
            set_valid_range_end(scalar, eb);

            // FIXME(pattern_types): create implied bounds from pattern types in signatures
            // that require that the range end is >= the range start so that we can't hit
            // this error anymore without first having hit a trait solver error.
            // Very fuzzy on the details here, but pattern types are an internal impl detail,
            // so we can just go with this for now
            if (Scalar.is_signed(scalar)) {
              const range = Scalar.valid_range_mut(scalar);
              const start = layout.size.sign_extend(range.value.start);
              const end = layout.size.sign_extend(range.value.end);
              if (end < start) {
                const guar = tcx.dcx().err(`pattern type ranges cannot wrap: ${start}..=${end}`);

                return Err(error(cx, { $: "ReferencesError", _0: guar }));
              }
            } else {
              const range = Scalar.valid_range_mut(scalar);
              if (range.value.end < range.value.start) {
                const guar = tcx.dcx().err(`pattern type ranges cannot wrap: ${range.value.start}..=${range.value.end}`);

                return Err(error(cx, { $: "ReferencesError", _0: guar }));
              }
            }

            const niche = new Niche(Size.ZERO, Scalar.primitive(scalar), Scalar.valid_range(scalar, cx));

            layout.largest_niche = niche;
          } else {
            return bug(`pattern type with range but not scalar layout: ${debug_Ty(ty, PLAIN)}, ${debug_LayoutData(layout, PLAIN)}`);
          }
          break;
        }
        case "NotNull": {
          const br = layout.backend_repr;
          if (br.$ === "Scalar" || br.$ === "ScalarPair") {
            // PORT: `&mut layout.backend_repr`: the scalar is a fresh copy (`clone_LayoutData`).
            let scalar: Scalar;
            if (br.$ === "Scalar") {
              scalar = { ...br._0 };
              layout.backend_repr = { $: "Scalar", _0: scalar };
            } else {
              scalar = { ...br.a };
              layout.backend_repr = { $: "ScalarPair", a: scalar, b: br.b, b_offset: br.b_offset };
            }
            set_valid_range_start(scalar, 1n);
            const niche = new Niche(Size.ZERO, Scalar.primitive(scalar), Scalar.valid_range(scalar, cx));

            layout.largest_niche = niche;
          } else {
            return bug(`pattern type with \`!null\` pattern but not scalar/pair layout: ${debug_Ty(ty, PLAIN)}, ${debug_LayoutData(layout, PLAIN)}`);
          }
          break;
        }

        case "Or": {
          const variants_ = pk._0;
          const k0 = variants_[0]!.kind();
          switch (k0.$) {
            case "Range": {
              if (layout.backend_repr.$ === "Scalar") {
                // PORT: `&mut layout.backend_repr`: the scalar is a fresh copy (`clone_LayoutData`).
                const scalar: Scalar = { ...layout.backend_repr._0 };
                layout.backend_repr = { $: "Scalar", _0: scalar };
                // PORT: the `.map(..).collect::<Result<Vec<_>, _>>()` stops at the first `Err`.
                const variants: [bigint, bigint][] = [];
                for (const pat of variants_) {
                  const p = pat.kind();
                  switch (p.$) {
                    case "Range": {
                      const { start, end } = p;
                      const s = Value.try_to_bits(unwrap_result(extract_const_value(cx, ty, start), debug_LayoutError), tcx, cx.typing_env);
                      if (s === undefined) return Err(error(cx, { $: "Unknown", _0: ty }));
                      const e = Value.try_to_bits(unwrap_result(extract_const_value(cx, ty, end), debug_LayoutError), tcx, cx.typing_env);
                      if (e === undefined) return Err(error(cx, { $: "Unknown", _0: ty }));
                      variants.push([s, e]);
                      break;
                    }
                    case "NotNull":
                    case "Or":
                      return unreachable("internal error: entered unreachable code: mixed or patterns are not allowed");
                  }
                }
                if (!Scalar.is_signed(scalar)) {
                  const guar = tcx.dcx().err(`only signed integer base types are allowed for or-pattern pattern types at present`);

                  return Err(error(cx, { $: "ReferencesError", _0: guar }));
                }
                variants.sort(cmp_u128_pair);
                if (variants.length !== 2) {
                  const guar = tcx
                    .dcx()
                    .err(`the only or-pattern types allowed are two range patterns that are directly connected at their overflow site`);

                  return Err(error(cx, { $: "ReferencesError", _0: guar }));
                }

                // first is the one starting at the signed in range min
                let first = variants[0]!;
                let second = variants[1]!;
                if (second[0] === layout.size.truncate(BigInt.asUintN(128, layout.size.signed_int_min()))) {
                  [second, first] = [first, second];
                }

                if (layout.size.sign_extend(first[1]) >= layout.size.sign_extend(second[0])) {
                  const guar = tcx.dcx().err(`only non-overlapping pattern type ranges are allowed at present`);

                  return Err(error(cx, { $: "ReferencesError", _0: guar }));
                }
                if (BigInt.asUintN(128, layout.size.signed_int_max()) !== second[1]) {
                  const guar = tcx.dcx().err(`one pattern needs to end at \`${display_Ty(ty)}::MAX\`, but was ${second[1]} instead`);

                  return Err(error(cx, { $: "ReferencesError", _0: guar }));
                }

                // Now generate a wrapping range (which aren't allowed in surface syntax).
                set_valid_range_start(scalar, second[0]);
                set_valid_range_end(scalar, first[1]);

                const niche = new Niche(Size.ZERO, Scalar.primitive(scalar), Scalar.valid_range(scalar, cx));

                layout.largest_niche = niche;
              } else {
                return bug(`pattern type with range but not scalar layout: ${debug_Ty(ty, PLAIN)}, ${debug_LayoutData(layout, PLAIN)}`);
              }
              break;
            }
            case "NotNull":
              return bug("or patterns can't contain `!null` patterns");
            case "Or":
              return bug("patterns cannot have nested or patterns");
          }
          break;
        }
      }
      // Pattern types contain their base as their sole field.
      // This allows the rest of the compiler to process pattern types just like
      // single field transparent Adts, and only the parts of the compiler that
      // specifically care about pattern types will have to handle it.
      layout.fields = {
        $: "Arbitrary",
        offsets: [Size.ZERO],
        in_memory_order: [FieldIdx.new(0)],
      };
      result = tcx.mk_layout(layout);
      break;
    }

    // Basic scalars.
    case "Bool":
      result = tcx.mk_layout(
        LayoutData.scalar(cx, {
          $: "Initialized",
          value: { $: "Int", _0: "I8", _1: false },
          valid_range: new WrappingRange(0n, 1n),
        }),
      );
      break;
    case "Char":
      result = tcx.mk_layout(
        LayoutData.scalar(cx, {
          $: "Initialized",
          value: { $: "Int", _0: "I32", _1: false },
          valid_range: new WrappingRange(0n, 0x10ffffn),
        }),
      );
      break;
    case "Int": {
      const ity = k._0;
      result = scalar({ $: "Int", _0: IntegerExt.from_int_ty(dl, ity), _1: true });
      break;
    }
    case "Uint": {
      const ity = k._0;
      result = scalar({ $: "Int", _0: IntegerExt.from_uint_ty(dl, ity), _1: false });
      break;
    }
    case "Float": {
      const fty = k._0;
      result = scalar({ $: "Float", _0: FloatExt.from_float_ty(fty) });
      break;
    }
    case "FnPtr": {
      const ptr = scalar_unit({ $: "Pointer", _0: dl.instruction_address_space });
      set_valid_range_start(ptr, 1n);
      result = tcx.mk_layout(LayoutData.scalar(cx, ptr));
      break;
    }

    // The never type.
    case "Never":
      result = tcx.mk_layout(LayoutData.never_type(cx));
      break;

    // Potentially-wide pointers.
    case "Ref":
    case "RawPtr": {
      const pointee = k.$ === "Ref" ? k._1 : k._0;
      const data_ptr = scalar_unit({ $: "Pointer", _0: AddressSpace.ZERO });
      if (!ty.is_raw_ptr()) {
        set_valid_range_start(data_ptr, 1n);
      }

      if (pointee.is_sized(tcx, cx.typing_env)) {
        return Ok(tcx.mk_layout(LayoutData.scalar(cx, data_ptr)));
      }

      let metadata: Scalar;
      const metadata_def_id = tcx.lang_items().metadata_type();
      if (metadata_def_id !== undefined) {
        const pointee_metadata = Ty.new_projection(tcx, IsRigid.No, metadata_def_id, [pointee]);
        const nr = tcx.try_normalize_erasing_regions(cx.typing_env, Unnormalized.new_wip(pointee_metadata), fold_Ty);
        let metadata_ty: Ty;
        if (nr.$ === "Ok") {
          metadata_ty = nr._0;
        } else {
          let err = nr._0;
          // Usually `<Ty as Pointee>::Metadata` can't be normalized because
          // its struct tail cannot be normalized either, so try to get a
          // more descriptive layout error here, which will lead to less confusing
          // diagnostics.
          //
          // We use the raw struct tail function here to get the first tail
          // that is an alias, which is likely the cause of the normalization
          // error.
          const br = tcx.try_normalize_erasing_regions(
            cx.typing_env,
            Unnormalized.new_wip(
              tcx.struct_tail_raw(
                pointee,
                ObligationCause.dummy(),
                (ty) => Unnormalized.skip_norm_wip(ty),
                () => {},
              ),
            ),
            fold_Ty,
          );
          if (br.$ === "Ok") {
            // Ok(_) => {}
          } else {
            const better_err = br._0;
            err = better_err;
          }
          return Err(error(cx, { $: "NormalizationFailure", _0: pointee, _1: err }));
        }

        const mr = cx.layout_of(metadata_ty);
        if (mr.$ === "Err") return mr;
        const metadata_layout = mr._0;
        // If the metadata is a 1-zst, then the pointer is thin.
        if (metadata_layout.is_1zst()) {
          return Ok(tcx.mk_layout(LayoutData.scalar(cx, data_ptr)));
        }

        const mbr = metadata_layout.backend_repr;
        if (mbr.$ !== "Scalar") {
          return Err(error(cx, { $: "Unknown", _0: pointee }));
        }

        metadata = mbr._0;
      } else {
        const unsized_part = tcx.struct_tail_for_codegen(pointee, cx.typing_env);

        const uk = unsized_part.kind();
        switch (uk.$) {
          case "Foreign": {
            return Ok(tcx.mk_layout(LayoutData.scalar(cx, data_ptr)));
          }
          case "Slice":
          case "Str":
            metadata = scalar_unit({ $: "Int", _0: dl.ptr_sized_integer(), _1: false });
            break;
          case "Dynamic": {
            const vtable = scalar_unit({ $: "Pointer", _0: AddressSpace.ZERO });
            set_valid_range_start(vtable, 1n);
            metadata = vtable;
            break;
          }
          default: {
            return Err(error(cx, { $: "Unknown", _0: pointee }));
          }
        }
      }

      // Effectively a (ptr, meta) tuple.
      result = tcx.mk_layout(LayoutData.scalar_pair(cx, data_ptr, metadata));
      break;
    }

    // Arrays and slices.
    case "Array": {
      const element_ty = k._0;
      const count_ct = k._1;
      const cv = extract_const_value(cx, ty, count_ct);
      if (cv.$ === "Err") return cv;
      const count = Value.try_to_target_usize(cv._0, tcx);
      if (count === undefined) return Err(error(cx, { $: "Unknown", _0: ty }));

      const er = cx.layout_of(element_ty);
      if (er.$ === "Err") return er;
      const element = er._0;
      const r = map_layout(cx.calc.layout_of_array_like(element.deref(), count));
      if (r.$ === "Err") return r;
      result = r._0;
      break;
    }
    case "Slice": {
      const er = cx.layout_of(k._0);
      if (er.$ === "Err") return er;
      const element = er._0;
      const r = map_layout(
        result_map(cx.calc.layout_of_array_like<MiddleTyAndLayout>(element.deref(), undefined), (layout) => {
          // a randomly chosen value to distinguish slices
          layout.randomization_seed = Hash64.new(0x2dcba99c39784102n);
          return layout;
        }),
      );
      if (r.$ === "Err") return r;
      result = r._0;
      break;
    }
    case "Str": {
      const element = scalar({ $: "Int", _0: "I8", _1: false });
      const r = map_layout(
        result_map(cx.calc.layout_of_array_like<MiddleTyAndLayout>(element.deref_(), undefined), (layout) => {
          // another random value
          layout.randomization_seed = Hash64.new(0xc1325f37d127be22n);
          return layout;
        }),
      );
      if (r.$ === "Err") return r;
      result = r._0;
      break;
    }

    // Odd unit types.
    case "FnDef":
    case "Dynamic":
    case "Foreign": {
      const sized = ty.kind().$ === "FnDef";
      result = tcx.mk_layout(LayoutData.unit(cx, sized));
      break;
    }

    case "Coroutine": {
      const def_id = k._0;
      const args = k._1;
      switch (cx.typing_env.typing_mode().$) {
        case "Codegen":
          break;
        case "Coherence":
        case "Typeck":
        case "PostTypeckUntilBorrowck":
        case "PostBorrowck":
        case "Reflection":
        case "ErasedNotCoherence":
        case "PostAnalysis": {
          return Err(error(cx, { $: "TooGeneric", _0: ty }));
        }
      }

      // use rustc_middle::ty::layout::PrimitiveExt as _;

      const ir = tcx.coroutine_layout(def_id, args);
      if (ir.$ === "Err") return ir;
      const info = ir._0;

      const local_layouts: MiddleTyAndLayout[] = [];
      for (const local of info.field_tys) {
        const field_ty = EarlyBinder.bind(tcx, local.ty, fold_Ty);
        const uninit_ty = Ty.new_maybe_uninit(tcx, Unnormalized.skip_norm_wip(EarlyBinder.instantiate(field_ty, tcx, args, fold_Ty)));
        const lr = cx.spanned_layout_of(uninit_ty, local.source_info.span);
        if (lr.$ === "Err") return lr;
        local_layouts.push(lr._0);
      }

      const prefix_layouts: MiddleTyAndLayout[] = [];
      for (const ty of CoroutineArgs.upvar_tys(args.as_coroutine())) {
        const pr = cx.layout_of(ty);
        if (pr.$ === "Err") return pr;
        prefix_layouts.push(pr._0);
      }

      const layout = result_map(
        cx.calc.layout_of_coroutine(
          local_layouts,
          prefix_layouts,
          info.variant_fields,
          info.storage_conflicts,
          (tag) => new TyAndLayout(PrimitiveExt.to_ty(Scalar.primitive(tag), tcx), tcx.mk_layout(LayoutData.scalar(cx, tag))),
        ),
        (layout) => {
          // this is similar to how ReprOptions populates its field_shuffle_seed
          layout.randomization_seed = Fingerprint.to_smaller_hash(DefPathHash._0(tcx.def_path_hash(def_id)));
          // debug!("coroutine layout ({:?}): {:#?}", ty, layout);
          return layout;
        },
      );
      const r = map_layout(layout);
      if (r.$ === "Err") return r;
      result = r._0;
      break;
    }

    case "Closure": {
      const args = k._1;
      const r = univariant(ClosureArgs.upvar_tys(args.as_closure()), StructKind.AlwaysSized);
      if (r.$ === "Err") return r;
      result = r._0;
      break;
    }

    case "CoroutineClosure": {
      const args = k._1;
      const r = univariant(CoroutineClosureArgs.upvar_tys(args.as_coroutine_closure()), StructKind.AlwaysSized);
      if (r.$ === "Err") return r;
      result = r._0;
      break;
    }

    case "Tuple": {
      const tys = k._0;
      const kind = tys.length === 0 ? StructKind.AlwaysSized : StructKind.MaybeUnsized;

      const r = univariant(tys, kind);
      if (r.$ === "Err") return r;
      result = r._0;
      break;
    }

    case "Adt": {
      const def = k._0;
      const args = k._1;
      // Scalable vector types
      //
      // ```rust (ignore, example)
      // #[rustc_scalable_vector(3)]
      // struct svuint32_t(u32);
      //
      // #[rustc_scalable_vector]
      // struct svuint32x2_t(svuint32_t, svuint32_t);
      // ```
      if (def.repr().is_scalable()) {
        const parts = ty.scalable_vector_parts(tcx);
        if (parts === undefined) {
          const guar = tcx.dcx().delayed_bug("`#[rustc_scalable_vector]` was applied to an invalid type");
          return Err(error(cx, { $: "ReferencesError", _0: guar }));
        }
        const [element_count, element_ty, number_of_vectors] = parts;

        const er = cx.layout_of(element_ty);
        if (er.$ === "Err") return er;
        const element_layout = er._0;
        const r = map_layout(cx.calc.layout_of_scalable_vector_type(element_layout, BigInt(element_count), number_of_vectors));
        if (r.$ === "Err") return r;
        result = r._0;
        break;
      }

      // SIMD vector types.
      if (def.repr().simd()) {
        // Supported SIMD vectors are ADTs with a single array field:
        //
        // * #[repr(simd)] struct S([T; 4])
        //
        // where T is a primitive scalar (integer/float/pointer).
        let fk: TyKind | undefined;
        if (def.is_struct()) {
          const fields = def.variant(FIRST_VARIANT).fields;
          if (fields.length === 1) {
            fk = Unnormalized.skip_norm_wip(fields[FieldIdx.ZERO]!.ty(tcx, args)).kind();
          }
        }
        if (fk === undefined || fk.$ !== "Array") {
          // Invalid SIMD types should have been caught by typeck by now.
          const guar = tcx.dcx().delayed_bug("#[repr(simd)] was applied to an invalid ADT");
          return Err(error(cx, { $: "ReferencesError", _0: guar }));
        }
        const e_ty = fk._0;
        const e_len_ct = fk._1;

        const lv = extract_const_value(cx, ty, e_len_ct);
        if (lv.$ === "Err") return lv;
        const e_len = Value.try_to_target_usize(lv._0, tcx);
        if (e_len === undefined) return Err(error(cx, { $: "Unknown", _0: ty }));

        const er = cx.layout_of(e_ty);
        if (er.$ === "Err") return er;
        const e_ly = er._0;

        // Check for the rustc_simd_monomorphize_lane_limit attribute and check the lane limit
        const limit = find_attr(HasAttrs_DefId.get_attrs(def.did(), tcx), (k) => (k.$ === "RustcSimdMonomorphizeLaneLimit" ? k._0 : undefined));
        if (limit !== undefined) {
          if (!limit.value_within_limit(u64_as_usize(e_len))) {
            return Err(map_error(cx, ty, { $: "OversizedSimdType", max_lanes: limit._0 }));
          }
        }

        const r = map_layout(cx.calc.layout_of_simd_type(e_ly, e_len, def.repr().packed()));
        if (r.$ === "Err") return r;
        result = r._0;
        break;
      }

      // ADTs.
      // Cache the field layouts.
      const variants: MiddleTyAndLayout[][] = [];
      for (const v of def.variants()) {
        const fields: MiddleTyAndLayout[] = [];
        for (const field of v.fields) {
          const fr = cx.layout_of(Unnormalized.skip_norm_wip(field.ty(tcx, args)));
          if (fr.$ === "Err") return fr;
          fields.push(fr._0);
        }
        variants.push(fields);
      }

      if (def.is_union()) {
        if (def.repr().pack !== undefined && def.repr().align !== undefined) {
          const guar = tcx.dcx().span_delayed_bug(tcx.def_span(def.did()), "union cannot be packed and aligned");
          return Err(error(cx, { $: "ReferencesError", _0: guar }));
        }

        return map_layout(cx.calc.layout_of_union(def.repr(), variants));
      }

      // UnsafeCell and UnsafePinned both disable niche optimizations
      const niche_optimizations = def.is_unsafe_cell() || def.is_unsafe_pinned() ? NicheOptimizations.Disabled : NicheOptimizations.Enabled;

      const discr_range_of_repr = (min: RangeFrom<bigint>, max: RangeToInclusive<bigint>): [Integer, boolean] => {
        return IntegerExt.discr_range_of_repr(tcx, ty, def.repr(), min.start, max.last);
      };

      // We shouldn't be computing the layout of discrs that fail typeck
      if (def.is_enum()) {
        for (const v of def.variants()) {
          if (v.discr.$ === "Explicit") {
            const def_id = v.discr._0;
            const local_did = def_id.as_local();
            if (local_did !== undefined) {
              const guar = (tcx.typeck(local_did) as TypeckResults).tainted_by_errors;
              if (guar !== undefined) {
                return Err(error(cx, { $: "ReferencesError", _0: guar }));
              }
            }
          }
        }
      }

      const discriminants_iter = function* (): Generator<[VariantIdx, bigint]> {
        if (def.is_enum()) {
          for (const [v, d] of def.discriminants(tcx)) {
            yield [v, d.val];
          }
        }
      };

      const tail = def.is_struct() ? def.non_enum_variant().tail_opt() : undefined;
      const maybe_unsized =
        def.is_struct() &&
        tail !== undefined &&
        ((last_field) => {
          const typing_env = TypingEnvC.new(tcx.param_env_normalized_for_post_analysis(def.did()) as ParamEnv, cx.typing_env.typing_mode());
          return !Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(last_field.did) as EarlyBinder<Ty>)).is_sized(tcx, typing_env);
        })(tail);

      const lr = cx.calc.layout_of_struct_or_enum(
        def.repr(),
        variants,
        def.is_enum(),
        niche_optimizations,
        discr_range_of_repr,
        discriminants_iter(),
        !maybe_unsized,
      );
      if (lr.$ === "Err") return Err(map_error(cx, ty, lr._0));
      const layout = lr._0;

      if (!maybe_unsized && layout.is_unsized()) {
        return bug(`got unsized layout for type that cannot be unsized ${debug_Ty(ty, PLAIN)}: ${debug_LayoutData(layout, PRETTY)}`);
      }

      // If the struct tail is sized and can be unsized, check that unsizing doesn't move the fields around.
      if (cfg_debug_assertions() && maybe_unsized && Unnormalized.skip_norm_wip(def.non_enum_variant().tail().ty(tcx, args)).is_sized(tcx, cx.typing_env)) {
        const variants_ = variants;
        const tail_replacement = unwrap_result(cx.layout_of(Ty.new_slice(tcx, tcx.types.u8)), debug_LayoutError);
        const first = variants_[FIRST_VARIANT]!;
        first[unwrap(first.length === 0 ? undefined : first.length - 1)] = tail_replacement;

        const ur = cx.calc.layout_of_struct_or_enum(
          def.repr(),
          variants_,
          def.is_enum(),
          niche_optimizations,
          discr_range_of_repr,
          discriminants_iter(),
          !maybe_unsized,
        );
        if (ur.$ !== "Ok") {
          return bug(`failed to compute unsized layout of ${debug_Ty(ty, PLAIN)}`);
        }
        const unsized_layout = ur._0;

        if (layout.fields.$ !== "Arbitrary") {
          return bug(`unexpected FieldsShape for sized layout of ${debug_Ty(ty, PLAIN)}: ${debug_FieldsShape(layout.fields, PLAIN)}`);
        }
        const sized_offsets = layout.fields.offsets;
        if (unsized_layout.fields.$ !== "Arbitrary") {
          return bug(`unexpected FieldsShape for unsized layout of ${debug_Ty(ty, PLAIN)}: ${debug_FieldsShape(unsized_layout.fields, PLAIN)}`);
        }
        const unsized_offsets = unsized_layout.fields.offsets;

        const sized_tail = unwrap(sized_offsets[sized_offsets.length - 1]);
        const sized_fields = sized_offsets.slice(0, -1);
        const unsized_tail = unwrap(unsized_offsets[unsized_offsets.length - 1]);
        const unsized_fields = unsized_offsets.slice(0, -1);

        if (!(sized_fields.length === unsized_fields.length && sized_fields.every((s, i) => s.raw === unsized_fields[i]!.raw))) {
          return bug(`unsizing ${debug_Ty(ty, PLAIN)} changed field order!\n${debug_LayoutData(layout, PLAIN)}\n${debug_LayoutData(unsized_layout, PLAIN)}`);
        }

        if (sized_tail.raw < unsized_tail.raw) {
          return bug(`unsizing ${debug_Ty(ty, PLAIN)} moved tail backwards!\n${debug_LayoutData(layout, PLAIN)}\n${debug_LayoutData(unsized_layout, PLAIN)}`);
        }
      }

      if (tcx.is_lang_item(def.did(), LangItem.F16B)) {
        const bfloat = scalar_unit({ $: "Float", _0: "F16B" });
        assert_eq(layout.size, Float.size("F16B"), (v) => debug_Size(v, PLAIN), size_eq);
        layout.align = Float.align("F16B", cx);
        layout.backend_repr = { $: "Scalar", _0: bfloat };
      }

      if (tcx.is_lang_item(def.did(), LangItem.PpcF128)) {
        const ppcf128 = scalar_unit({ $: "Float", _0: "PpcF128" });
        assert_eq(layout.size, Float.size("PpcF128"), (v) => debug_Size(v, PLAIN), size_eq);
        layout.align = Float.align("PpcF128", cx);
        layout.backend_repr = { $: "Scalar", _0: ppcf128 };
      }

      result = tcx.mk_layout(layout);
      break;
    }

    case "UnsafeBinder": {
      const bound_ty = k._0;
      const ty = tcx.instantiate_bound_regions_with_erased(UnsafeBinderInner.into_Binder(bound_ty), fold_Ty);
      const r = cx.layout_of(ty);
      if (r.$ === "Err") return r;
      result = r._0.layout;
      break;
    }

    // Types with no meaningful known layout.
    case "Param":
    case "Placeholder": {
      return Err(error(cx, { $: "TooGeneric", _0: ty }));
    }

    case "Alias": {
      // In case we're still in a generic context, aliases might be rigid. E.g.
      // if we've got a `T: Trait` where-bound, `T::Assoc` cannot be normalized
      // in the current context.
      //
      // For some builtin traits, generic aliases can be rigid even in an empty environment,
      // e.g. `<T as Pointee>::Metadata`.
      //
      // Due to trivial bounds, this can even be the case if the alias does not reference
      // any generic parameters, e.g. a `for<'a> u32: Trait<'a>` where-bound means that
      // `<u32 as Trait<'static>>::Assoc` is rigid.
      let err: LayoutError;
      if (TypeVisitableExt.has_param(ty, fold_Ty) || !cx.typing_env.param_env.is_empty()) {
        err = { $: "TooGeneric", _0: ty };
      } else {
        err = {
          $: "ReferencesError",
          _0: cx.tcx_().dcx().delayed_bug(`unexpected rigid alias in layout_of after normalization: ${debug_Ty(ty, PLAIN)}`),
        };
      }
      return Err(error(cx, err));
    }

    case "Bound":
    case "CoroutineWitness":
    case "Infer":
    case "Error": {
      // `ty::Error` is handled at the top of this function.
      return bug(`layout_of: unexpected type \`${display_Ty(ty)}\``);
    }
  }
  return Ok(result);
}

/** PORT: the derived `Ord` of `(u128, u128)` (`variants.sort()`). */
function cmp_u128_pair(a: [bigint, bigint], b: [bigint, bigint]): number {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
  if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
  return 0;
}

/** PORT: `Result::map`. */
function result_map<T, U, E>(r: Result<T, E>, f: (v: T) => U): Result<U, E> {
  return r.$ === "Ok" ? Ok(f(r._0)) : r;
}

/** PORT: the derived `PartialEq` of `Size`. */
function size_eq(a: Size, b: Size): boolean {
  return a.raw === b.raw;
}

/** PORT: `Ord::max` of `Size` (`a.max(b)`: `b` when equal). */
function size_max(a: Size, b: Size): Size {
  return a.raw > b.raw ? a : b;
}

// rustc: compiler/rustc_ty_utils/src/layout.rs:877 record_layout_for_printing
export function record_layout_for_printing(cx: LayoutCxT, layout: MiddleTyAndLayout): void {
  // Ignore layouts that are done with non-empty environments or
  // non-monomorphic layouts, as the user only wants to see the stuff
  // resulting from the final codegen session.
  if (TypeVisitableExt.has_non_region_param(layout.ty, fold_Ty) || !cx.typing_env.param_env.is_empty()) {
    return;
  }

  // (delay format until we actually need it)
  const record = (kind: DataTypeKind, packed: boolean, opt_discr_size: Size | undefined, variants: VariantInfo[]): void => {
    const type_desc = with_no_trimmed_paths(() => `${display_Ty(layout.ty)}`);
    (cx.tcx_().sess.code_stats as CodeStats).record_type_size(kind, type_desc, layout.align.abi, layout.size, packed, opt_discr_size, variants);
  };

  const k = layout.ty.kind();
  switch (k.$) {
    case "Adt": {
      const adt_def = k._0;
      // debug!("print-type-size t: `{:?}` process adt", layout.ty);
      const adt_kind = adt_def.adt_kind();
      const adt_packed = adt_def.repr().pack !== undefined;
      const [variant_infos, opt_discr_size] = variant_info_for_adt(cx, layout, adt_def);
      record(DataTypeKind_from_AdtKind(adt_kind), adt_packed, opt_discr_size, variant_infos);
      break;
    }

    case "Coroutine": {
      const def_id = k._0;
      const args = k._1;
      // debug!("print-type-size t: `{:?}` record coroutine", layout.ty);
      // Coroutines always have a begin/poisoned/end state with additional suspend points
      const [variant_infos, opt_discr_size] = variant_info_for_coroutine(cx, layout, def_id, args);
      record("Coroutine", false, opt_discr_size, variant_infos);
      break;
    }

    case "Closure": {
      // debug!("print-type-size t: `{:?}` record closure", layout.ty);
      record("Closure", false, undefined, []);
      break;
    }

    default: {
      // debug!("print-type-size t: `{:?}` skip non-nominal", layout.ty);
    }
  }
}

// rustc: compiler/rustc_ty_utils/src/layout.rs:927 variant_info_for_adt
export function variant_info_for_adt(cx: LayoutCxT, layout: MiddleTyAndLayout, adt_def: AdtDef): [VariantInfo[], Size | undefined] {
  const build_variant_info = (n: Symbol | undefined, flds: readonly Symbol[], layout: MiddleTyAndLayout): VariantInfo => {
    let min_size = Size.ZERO;
    const field_info: FieldInfo[] = flds.map((name, i) => {
      const field_layout = layout.field(cx, i);
      const offset = FieldsShape.offset(layout.fields, i);
      min_size = size_max(min_size, offset.add(field_layout.size));
      return {
        kind: "AdtField",
        name,
        offset: offset.bytes(),
        size: field_layout.size.bytes(),
        align: field_layout.align.abi.bytes(),
        type_name: undefined,
      };
    });

    return {
      name: n,
      kind: layout.is_unsized() ? "Min" : "Exact",
      align: layout.align.abi.bytes(),
      size: min_size.bytes() === 0 ? layout.size.bytes() : min_size.bytes(),
      fields: field_info,
    };
  };

  const v = layout.variants;
  switch (v.$) {
    case "Empty":
      return [[], undefined];

    case "Single": {
      const index = v.index;
      // debug!("print-type-size `{:#?}` variant {}", layout, adt_def.variant(index).name);
      const variant_def = adt_def.variant(index);
      const fields = variant_def.fields.map((f) => f.name);
      return [[build_variant_info(variant_def.name, fields, layout)], undefined];
    }

    case "Multiple": {
      const { tag, tag_encoding } = v;
      // debug!("print-type-size `{:#?}` adt general variants def {}", layout.ty, adt_def.variants().len());
      const variant_infos = adt_def.variants().map((variant_def, i) => {
        const fields = variant_def.fields.map((f) => f.name);
        return build_variant_info(variant_def.name, fields, layout.for_variant(cx, i as VariantIdx));
      });

      return [variant_infos, tag_encoding.$ === "Direct" ? Scalar.size(tag, cx) : undefined];
    }
  }
}

// rustc: compiler/rustc_ty_utils/src/layout.rs:997 variant_info_for_coroutine
export function variant_info_for_coroutine(cx: LayoutCxT, layout: MiddleTyAndLayout, def_id: DefId, args: GenericArgs): [VariantInfo[], Size | undefined] {
  // use itertools::Itertools;

  const lv = layout.variants;
  if (lv.$ !== "Multiple") {
    return [[], undefined];
  }
  const { tag, tag_encoding, tag_field } = lv;

  const coroutine = unwrap_result(cx.tcx_().coroutine_layout(def_id, args), debug_LayoutError);
  const upvar_names = cx.tcx_().closure_saved_names_of_captured_variables(def_id);

  let upvars_size = Size.ZERO;
  const upvar_tys = [...CoroutineArgs.upvar_tys(args.as_coroutine())];
  // PORT: `zip_eq` panics when the lengths differ (itertools: "itertools: .zip_eq() reached the end of one iterator
  // before the other").
  if (upvar_tys.length !== upvar_names.length) {
    panic("itertools: .zip_eq() reached the end of one iterator before the other");
  }
  const upvar_fields: FieldInfo[] = upvar_tys.map((_, field_idx) => {
    const name = upvar_names[field_idx]!;
    const field_layout = layout.field(cx, field_idx);
    const offset = FieldsShape.offset(layout.fields, field_idx);
    upvars_size = size_max(upvars_size, offset.add(field_layout.size));
    return {
      kind: "Upvar",
      name: name,
      offset: offset.bytes(),
      size: field_layout.size.bytes(),
      align: field_layout.align.abi.bytes(),
      type_name: undefined,
    };
  });

  const variant_infos: VariantInfo[] = coroutine.variant_fields.map((variant_def, variant_idx_) => {
    const variant_idx = variant_idx_ as VariantIdx;
    const variant_layout = layout.for_variant(cx, variant_idx);
    let variant_size = Size.ZERO;
    const fields: FieldInfo[] = variant_def
      .map((local, field_idx): FieldInfo => {
        const field_name = coroutine.field_tys[local]!.debuginfo_name;
        const field_layout = variant_layout.field(cx, field_idx);
        const offset = FieldsShape.offset(variant_layout.fields, field_idx);
        // The struct is as large as the last field's end
        variant_size = size_max(variant_size, offset.add(field_layout.size));
        return {
          kind: "CoroutineLocal",
          name: field_name ?? Symbol.intern(`.coroutine_field${local}`),
          offset: offset.bytes(),
          size: field_layout.size.bytes(),
          align: field_layout.align.abi.bytes(),
          // Include the type name if there is no field name, or if the name is the
          // __awaitee placeholder symbol which means a child future being `.await`ed.
          type_name: field_name === undefined || field_name === sym.__awaitee ? Symbol.intern(display_Ty(field_layout.ty)) : undefined,
        };
      })
      .concat(upvar_fields.map((f) => ({ ...f })));

    // If the variant has no state-specific fields, then it's the size of the upvars.
    if (variant_size.raw === Size.ZERO.raw) {
      variant_size = upvars_size;
    }

    // This `if` deserves some explanation.
    //
    // The layout code has a choice of where to place the discriminant of this coroutine.
    // If the discriminant of the coroutine is placed early in the layout (before the
    // variant's own fields), then it'll implicitly be counted towards the size of the
    // variant, since we use the maximum offset to calculate size.
    //    (side-note: I know this is a bit problematic given upvars placement, etc).
    //
    // This is important, since the layout printing code always subtracts this discriminant
    // size from the variant size if the struct is "enum"-like, so failing to account for it
    // will either lead to numerical underflow, or an underreported variant size...
    //
    // However, if the discriminant is placed past the end of the variant, then we need
    // to factor in the size of the discriminant manually. This really should be refactored
    // better, but this "works" for now.
    if (FieldsShape.offset(layout.fields, tag_field).raw >= variant_size.raw) {
      variant_size = variant_size.add_assign(tag_encoding.$ === "Direct" ? Scalar.size(tag, cx) : Size.ZERO);
    }

    return {
      name: Symbol.intern(CoroutineArgs_variant_name(variant_idx)),
      kind: "Exact",
      size: variant_size.bytes(),
      align: variant_layout.align.abi.bytes(),
      fields,
    };
  });

  // The first three variants are hardcoded to be `UNRESUMED`, `RETURNED` and `POISONED`.
  // We will move the `RETURNED` and `POISONED` elements to the end so we
  // are left with a sorting order according to the coroutines yield points:
  // First `Unresumed`, then the `SuspendN` followed by `Returned` and `Panicked` (POISONED).
  if (variant_infos.length < 3) {
    panic(`range end index 3 out of range for slice of length ${variant_infos.length}`);
  }
  const end_states = variant_infos.splice(1, 2);
  variant_infos.push(...end_states);

  return [variant_infos, tag_encoding.$ === "Direct" ? Scalar.size(tag, cx) : undefined];
}

// ---- PORT views of types other files own that are not ported yet -------------------------------------------------
// Not markers. Root repoints them at the real ports.

/** rustc_session code_stats.rs `SizeKind` (code_stats.rs is not ported; PORTING §5 shape). */
export type SizeKind = "Exact" | "Min";
/** rustc_session code_stats.rs `FieldKind`. */
export type FieldKind = "AdtField" | "Upvar" | "CoroutineLocal";
/** rustc_session code_stats.rs `FieldInfo` (`u64`s are byte counts, `number`). */
export interface FieldInfo {
  kind: FieldKind;
  name: Symbol;
  offset: number;
  size: number;
  align: number;
  /// Name of the type of this field.
  /// Present only if the creator thought that this would be important for identifying the field,
  /// typically because the field name is uninformative.
  type_name: Symbol | undefined;
}
/** rustc_session code_stats.rs `VariantInfo`. */
export interface VariantInfo {
  name: Symbol | undefined;
  kind: SizeKind;
  size: number;
  align: number;
  fields: FieldInfo[];
}
/** rustc_session code_stats.rs `CodeStats` (`Session::code_stats` is a deferred field: reading it stops UNPORTED). */
interface CodeStats {
  record_type_size(
    kind: DataTypeKind,
    type_desc: string,
    align: Align,
    overall_size: Size,
    packed: boolean,
    opt_discr_size: Size | undefined,
    variants: VariantInfo[],
  ): void;
}

/** `ty::CoroutineArgs::variant_name` (rustc_middle ty/sty.rs:137, ported on `CoroutineArgsExt`). */
function CoroutineArgs_variant_name(v: VariantIdx): string {
  return CoroutineArgsExt.variant_name(v);
}
