// Port of compiler/rustc_passes/src/layout_test.rs (lane passes-dead): the `#[rustc_dump_layout(..)]` test attribute.
//
// PORT notes:
// - `find_attr!(tcx, id, RustcDumpLayout(kinds) => kinds)` goes through `HasAttrs_LocalDefId` (rustc_middle ty/mod.ts).
// - `UnwrapLayoutCx` is a class implementing `LayoutOfHelpers` (`type LayoutOfResult = TyAndLayout`, the default:
//   `MaybeResult_T`) with its `HasTyCtxt` / `HasTypingEnv` / `HasDataLayout` impls as methods (`tcx_()`,
//   `typing_env_()`, `data_layout()`, rustc_middle ty/layout.ts header).
// - `format!("... {:?}", x)` uses the ported `Debug` impls; `{:#?}` is `PRETTY`.
import "../rustc_trait_selection/lib.ts";
import { debug_Heterogeneous, debug_HomogeneousAggregate } from "../rustc_abi/callconv.ts";
import { debug_Align, debug_BackendRepr, debug_LayoutData, debug_Niche, debug_Size, type TargetDataLayout } from "../rustc_abi/lib.ts";
import { find_attr } from "../rustc_attr_ir/lib.ts";
import type { RustcDumpLayoutKind } from "../rustc_attr_ir/lib.ts";
import { Obligation } from "../rustc_infer/traits/mod.ts";
import type { ModuleItems } from "../rustc_middle/hir/mod.ts";
import { ObligationCause } from "../rustc_middle/traits/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { display_LayoutError, type LayoutError, type LayoutOfHelpers, LayoutOfHelpers_provided, type MaybeResult, MaybeResult_T, type TyAndLayout } from "../rustc_middle/ty/layout.ts";
import { HasAttrs_LocalDefId, Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import { Predicate_upcast_from_ClauseKind } from "../rustc_middle/ty/predicate.ts";
import { display_Ty } from "../rustc_middle/ty/print/pretty.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { ObligationCtxt } from "../rustc_trait_selection/traits/engine.ts";
import { LocalDefId } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";
import { span_bug } from "../rustc_span/macros.ts";
import { EarlyBinder } from "../rustc_type_ir/binder.ts";
import type { Interner } from "../rustc_type_ir/interner.ts";
import type { ClauseKind } from "../rustc_type_ir/predicate_kind.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { debug_option, PLAIN, PRETTY } from "../std/fmt.ts";
import { debug_result, type Result } from "../std/result.ts";

// rustc: compiler/rustc_passes/src/layout_test.rs:12 test_layout
export function test_layout(tcx: TyCtxt): void {
  if (!tcx.features().rustc_attrs()) {
    // if the `rustc_attrs` feature is not enabled, don't bother testing layout
    return;
  }
  for (const id of (tcx.hir_crate_items(null) as ModuleItems).definitions()) {
    const kinds = find_attr(HasAttrs_LocalDefId.get_attrs(id, tcx), (k) => (k.$ === "RustcDumpLayout" ? k._0 : undefined));
    if (kinds !== undefined) {
      // Attribute parsing handles error reporting
      const dk = tcx.def_kind(id).$;
      if (dk === "TyAlias" || dk === "Enum" || dk === "Struct" || dk === "Union") {
        dump_layout_of(tcx, id, kinds);
      }
    }
  }
}

// rustc: compiler/rustc_passes/src/layout_test.rs:29 ensure_wf
export function ensure_wf(tcx: TyCtxt, typing_env: TypingEnv, ty: Ty, def_id: LocalDefId, span: Span): boolean {
  const [infcx, param_env] = tcx.infer_ctxt().build_with_typing_env(typing_env);
  const ocx = ObligationCtxt.new_with_diagnostics(infcx);
  const pred: ClauseKind = { $: "WellFormed", _0: ty } as ClauseKind;
  const obligation = Obligation.new(
    tcx,
    ObligationCause.new(span, def_id, { $: "WellFormed", _0: { $: "Ty", _0: def_id } }),
    param_env,
    pred,
    // PORT: `impl Upcast<TyCtxt, Predicate> for ClauseKind` takes `TyCtxt` where `Obligation::new` names the `Interner`.
    Predicate_upcast_from_ClauseKind as unknown as (from: ClauseKind, tcx: Interner) => ReturnType<typeof Predicate_upcast_from_ClauseKind>,
  );
  ocx.register_obligation(obligation);
  const errors = ocx.evaluate_obligations_error_on_ambiguity();
  if (errors.$ === "HasErrors") {
    infcx.err_ctxt().report_fulfillment_errors(errors._0);
    return false;
  } else {
    // looks WF!
    return true;
  }
}

// rustc: compiler/rustc_passes/src/layout_test.rs:60 dump_layout_of
function dump_layout_of(tcx: TyCtxt, item_def_id: LocalDefId, kinds: readonly RustcDumpLayoutKind[]): void {
  const typing_env = TypingEnv.codegen(tcx, item_def_id);
  const ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(item_def_id) as EarlyBinder<Ty>));
  const span = tcx.def_span(LocalDefId.to_def_id(item_def_id));
  if (!ensure_wf(tcx, typing_env, ty, item_def_id, span)) {
    return;
  }
  const r = tcx.layout_of(typing_env.as_query_input(ty));
  switch (r.$) {
    case "Ok": {
      const ty_layout = r._0;
      for (const kind of kinds) {
        let message: string;
        switch (kind) {
          case "Align":
            message = `align: ${debug_Align(ty_layout.align.abi, PLAIN)}`;
            break;
          case "BackendRepr":
            message = `backend_repr: ${debug_BackendRepr(ty_layout.backend_repr, PLAIN)}`;
            break;
          case "Debug": {
            const normalized_ty = tcx.normalize_erasing_regions(typing_env, Unnormalized.new_wip(ty), fold_Ty);
            // FIXME: using the `Debug` impl here isn't ideal.
            message = `layout_of(${display_Ty(normalized_ty)}) = ${debug_LayoutData(ty_layout.deref(), PRETTY)}`;
            break;
          }
          case "HomogenousAggregate": {
            const data = ty_layout.homogeneous_aggregate(new UnwrapLayoutCx(tcx, typing_env));
            message = `homogeneous_aggregate: ${debug_result(data, PLAIN, debug_HomogeneousAggregate, debug_Heterogeneous)}`;
            break;
          }
          case "LargestNiche":
            message = `largest_niche: ${debug_option(ty_layout.largest_niche, PLAIN, debug_Niche)}`;
            break;
          case "Size":
            message = `size: ${debug_Size(ty_layout.size, PLAIN)}`;
            break;
        }
        tcx.dcx().span_err(span, message);
      }
      break;
    }

    case "Err": {
      const layout_error = r._0;
      tcx.dcx().span_err(span, display_LayoutError(layout_error));
      break;
    }
  }
}

// rustc-type: compiler/rustc_passes/src/layout_test.rs:101 UnwrapLayoutCx
class UnwrapLayoutCx implements LayoutOfHelpers<TyAndLayout, never> {
  // type LayoutOfResult = TyAndLayout<'tcx>; (the default)
  readonly LayoutOfResult: MaybeResult<TyAndLayout, TyAndLayout, never> = MaybeResult_T;

  constructor(
    readonly tcx: TyCtxt,
    readonly typing_env: TypingEnv,
  ) {}

  // (provided) layout_tcx_at_span
  layout_tcx_at_span(): Span {
    return LayoutOfHelpers_provided.layout_tcx_at_span(this);
  }

  // impl<'tcx> LayoutOfHelpers<'tcx> for UnwrapLayoutCx<'tcx>
  // rustc: compiler/rustc_passes/src/layout_test.rs:107 handle_layout_err
  handle_layout_err(err: LayoutError, span: Span, ty: Ty): never {
    return span_bug(span, `\`#[rustc_dump_layout(..)]\` test resulted in \`layout_of(${display_Ty(ty)}) = Err(${display_LayoutError(err)})\``);
  }

  // impl<'tcx> HasTyCtxt<'tcx> for UnwrapLayoutCx<'tcx>
  // rustc: compiler/rustc_passes/src/layout_test.rs:116 tcx
  tcx_(): TyCtxt {
    return this.tcx;
  }

  // impl<'tcx> HasTypingEnv<'tcx> for UnwrapLayoutCx<'tcx>
  // rustc: compiler/rustc_passes/src/layout_test.rs:122 typing_env
  typing_env_(): TypingEnv {
    return this.typing_env;
  }

  // impl<'tcx> HasDataLayout for UnwrapLayoutCx<'tcx>
  // rustc: compiler/rustc_passes/src/layout_test.rs:128 data_layout
  data_layout(): TargetDataLayout {
    return this.tcx.data_layout();
  }
}
