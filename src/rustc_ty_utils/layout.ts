// Port of compiler/rustc_ty_utils/src/layout.rs (lane layout-contract: `provide`, the `layout_of` provider and `error`;
// every other fn is a `// stub:` declaration for lane ty-utils-layout, docs/handoff/layout-contract.md "How to fill a
// stub"). Conventions: rustc_abi layout.ts / rustc_middle ty/layout.ts headers (`cx.tcx()` is `cx.tcx_()`,
// `&'tcx LayoutError` is `LayoutError`, `tcx.arena.alloc(x)` is `x`).
import type { LayoutCalculatorError, Layout, Size } from "../rustc_abi/lib.ts";
import { TyAndLayout } from "../rustc_abi/lib.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import type { AdtDef, Const, GenericArgs, Value } from "../rustc_middle/ty/decls.ts";
import { type LayoutCx as LayoutCxT, LayoutCx, type LayoutError, type TyAndLayout as MiddleTyAndLayout } from "../rustc_middle/ty/layout.ts";
import { type PseudoCanonicalInput, type Ty, type TypingEnv, ParamEnv_eq, TypingEnv as TypingEnvC } from "../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import { set_aliases_to_non_rigid } from "../rustc_type_ir/fold.ts";
import { TypingMode, TypingModeEqWrapper_eq } from "../rustc_type_ir/infer_ctxt.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { unported } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import * as invariant from "./layout/invariant.ts";

// mod invariant;

/** rustc_session code_stats.rs `VariantInfo` (`-Zprint-type-sizes`): not ported yet (lane ty-utils-layout). */
export type VariantInfo = unknown;

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

// stub: compiler/rustc_ty_utils/src/layout.rs:117 map_error (lane ty-utils-layout)
export function map_error(_cx: LayoutCxT, _ty: Ty, _err: LayoutCalculatorError<MiddleTyAndLayout>): LayoutError {
  return unported("rustc_ty_utils::layout::map_error");
}

// stub: compiler/rustc_ty_utils/src/layout.rs:170 extract_const_value (lane ty-utils-layout)
export function extract_const_value(_cx: LayoutCxT, _ty: Ty, _ct: Const): Result<Value, LayoutError> {
  return unported("rustc_ty_utils::layout::extract_const_value");
}

// stub: compiler/rustc_ty_utils/src/layout.rs:207 layout_of_uncached (lane ty-utils-layout)
export function layout_of_uncached(_cx: LayoutCxT, _ty: Ty): Result<Layout, LayoutError> {
  return unported("rustc_ty_utils::layout::layout_of_uncached");
}

// stub: compiler/rustc_ty_utils/src/layout.rs:877 record_layout_for_printing (lane ty-utils-layout)
export function record_layout_for_printing(_cx: LayoutCxT, _layout: MiddleTyAndLayout): void {
  return unported("rustc_ty_utils::layout::record_layout_for_printing");
}

// stub: compiler/rustc_ty_utils/src/layout.rs:927 variant_info_for_adt (lane ty-utils-layout)
export function variant_info_for_adt(_cx: LayoutCxT, _layout: MiddleTyAndLayout, _adt_def: AdtDef): [VariantInfo[], Size | undefined] {
  return unported("rustc_ty_utils::layout::variant_info_for_adt");
}

// stub: compiler/rustc_ty_utils/src/layout.rs:997 variant_info_for_coroutine (lane ty-utils-layout)
export function variant_info_for_coroutine(_cx: LayoutCxT, _layout: MiddleTyAndLayout, _def_id: DefId, _args: GenericArgs): [VariantInfo[], Size | undefined] {
  return unported("rustc_ty_utils::layout::variant_info_for_coroutine");
}
