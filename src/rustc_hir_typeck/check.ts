// Port of compiler/rustc_hir_typeck/src/check.rs (lane typeck-lib-wb).
//
// - `fcx.ret_coercion` (`Option<RefCell<CoerceMany>>`) is `CoerceMany | undefined`; `.take().unwrap().into_inner()` reads
//   the field and clears it.
// - `#[instrument]` / `debug!` are tracing only and stay as comments.
// Init order: top-level code here touches only other crates; rustc_hir_typeck modules are read inside function bodies.
import { ExternAbi } from "../rustc_abi/extern_abi.ts";
import { LangItem } from "../rustc_attr_ir/lang_items.ts";
import * as hir from "../rustc_hir/lib.ts";
import { check_function_signature } from "../rustc_hir_analysis/check/mod.ts";
import { UNSAFE_PANIC_HANDLERS } from "../rustc_lint_defs/builtin.gen.ts";
import { ObligationCause } from "../rustc_middle/traits/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { GenericArg } from "../rustc_middle/ty/generic_args.ts";
import type { Generics } from "../rustc_middle/ty/generics.ts";
import { Ty } from "../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { LocalDefId } from "../rustc_span/def_id.ts";
import { sym } from "../rustc_span/symbol.ts";
import { Binder, BoundRegionKind, EarlyBinder } from "../rustc_type_ir/binder.ts";
import type { FnSig as FnSigT, PolyFnSig } from "../rustc_type_ir/decls.ts";
import { BoundVar, INNERMOST } from "../rustc_type_ir/lib.ts";
import { Region } from "../rustc_type_ir/sty/mod.ts";
import { FnSig, fold_FnSig } from "../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { unwrap } from "../std/panic.ts";
import { CoerceMany } from "./coercion.ts";
import type { FnCtxt } from "./decls.ts";
import { UnsafePanicHandlers_diagnostic } from "./diagnostics.gen.ts";
import { GatherLocalsVisitor } from "./gather_locals.ts";
import type { CoroutineTypes } from "./lib.gen.ts";

/// Helper used for fns and closures. Does the grungy work of checking a function
/// body and returns the function context used for that purpose, since in the case of a fn item
/// there is still a bit more to do.
///
/// * ...
/// * inherited: other fields inherited from the enclosing fn (if any)
// #[instrument(skip(fcx, body), level = "debug")]
// rustc: compiler/rustc_hir_typeck/src/check.rs:28 check_fn
export function check_fn(
  fcx: FnCtxt,
  fn_sig: FnSigT,
  coroutine_types: CoroutineTypes | undefined,
  decl: hir.FnDecl,
  fn_def_id: LocalDefId,
  body: hir.Body,
  params_can_be_unsized: boolean,
): CoroutineTypes | undefined {
  const fn_id = fcx.tcx.local_def_id_to_hir_id(fn_def_id);
  const tcx = fcx.tcx;
  const declared_ret_ty = FnSig.output(fn_sig);
  const ret_ty = fcx.register_infer_ok_obligations(
    fcx.infcx.replace_opaque_types_with_inference_vars(declared_ret_ty, fn_def_id, hir.FnRetTy.span(decl.output), fcx.param_env, fold_Ty),
  );

  fcx.coroutine_types = coroutine_types;
  fcx.ret_coercion = CoerceMany.new(ret_ty);

  const span = body.value.span;

  for (const param of body.params) {
    GatherLocalsVisitor.gather_from_param(fcx, param);
  }

  // C-variadic fns also have a `VaList` input that's not listed in `fn_sig`
  // (as it's created inside the body itself, not passed in from outside).
  let maybe_va_list: Ty | undefined;
  if (FnSig.c_variadic(fn_sig)) {
    const span = unwrap(body.params[body.params.length - 1]).span;
    const va_list_did = tcx.require_lang_item(LangItem.VaList, span);
    const region = fcx.next_region_var({ $: "Misc", _0: span });

    maybe_va_list = Unnormalized.skip_norm_wip(
      EarlyBinder.instantiate(tcx.type_of(va_list_did) as EarlyBinder<Ty>, tcx, [GenericArg.from_Region(region)], fold_Ty),
    );
  }

  // Add formal parameters.
  const inputs_fn: Ty[] = [...FnSig.inputs(fn_sig)];
  if (maybe_va_list !== undefined) inputs_fn.push(maybe_va_list);
  const n = Math.min(inputs_fn.length, body.params.length);
  for (let idx = 0; idx < n; idx++) {
    const param_ty = inputs_fn[idx]!;
    const param = body.params[idx]!;
    // We checked the root's signature during wfcheck, but not the child.
    if (fcx.tcx.is_typeck_child(LocalDefId.to_def_id(fn_def_id))) {
      fcx.register_wf_obligation(param_ty, param.span, {
        $: "WellFormed",
        _0: { $: "Param", function: fn_def_id, param_idx: idx },
      });
    }

    // Check the pattern.
    const ty: hir.Ty | undefined = decl.inputs[idx];
    const ty_span = ty !== undefined ? ty.span : undefined;
    fcx.check_pat_top(param.pat, param_ty, ty_span, undefined, undefined);
    if (param.pat.is_never_pattern()) {
      fcx.function_diverges_because_of_empty_arguments = {
        $: "Always",
        span: param.pat.span,
        custom_note: "any code following a never pattern is unreachable",
      };
    }

    // Check that argument is Sized.
    if (!params_can_be_unsized || ExternAbi.eq(FnSig.abi(fn_sig), ExternAbi.RustTail)) {
      fcx.require_type_is_sized(
        param_ty,
        param.ty_span,
        // ty.span == binding_span iff this is a closure parameter with no type ascription,
        // or if it's an implicit `self` parameter
        {
          $: "SizedArgumentType",
          _0: ty_span === param.span && tcx.is_closure_like(LocalDefId.to_def_id(fn_def_id)) ? undefined : ty !== undefined ? ty.hir_id : undefined,
        },
      );
    }

    fcx.write_ty(param.hir_id, param_ty);
  }

  fcx.typeck_results.liberated_fn_sigs_mut().insert(fn_id, fn_sig);

  // We checked the root's ret ty during wfcheck, but not the child.
  if (fcx.tcx.is_typeck_child(LocalDefId.to_def_id(fn_def_id))) {
    let return_or_body_span;
    switch (decl.output.$) {
      case "DefaultReturn":
        return_or_body_span = body.value.span;
        break;
      case "Return":
        return_or_body_span = decl.output._0.span;
        break;
    }

    fcx.require_type_is_sized(declared_ret_ty, return_or_body_span, { $: "SizedReturnType" });
  }

  fcx.is_whole_body = true;
  fcx.check_return_or_body_tail(body.value, false);

  // Finalize the return check by taking the LUB of the return types
  // we saw and assigning it to the expected return type. This isn't
  // really expected to fail, since the coercions would have failed
  // earlier when trying to find a LUB.
  const coercion = unwrap(fcx.ret_coercion);
  fcx.ret_coercion = undefined;
  let actual_return_ty = coercion.complete(fcx);
  // debug!("actual_return_ty = {:?}", actual_return_ty);
  if (declared_ret_ty.kind().$ === "Dynamic") {
    // We have special-cased the case where the function is declared
    // `-> dyn Foo` and we don't actually relate it to the
    // `fcx.ret_coercion`, so just instantiate a type variable.
    actual_return_ty = fcx.next_ty_var(span);
    // debug!("actual_return_ty replaced with {:?}", actual_return_ty);
  }

  // HACK(oli-obk, compiler-errors): We should be comparing this against
  // `declared_ret_ty`, but then anything uninferred would be inferred to
  // the opaque type itself. That again would cause writeback to assume
  // we have a recursive call site and do the sadly stabilized fallback to `()`.
  fcx.demand_suptype(span, ret_ty, actual_return_ty);

  // Check that a function marked as `#[panic_handler]` has signature `fn(&PanicInfo) -> !`
  if (tcx.is_lang_item(LocalDefId.to_def_id(fn_def_id), LangItem.PanicImpl)) {
    check_panic_info_fn(tcx, fn_def_id, fn_sig);
  }

  if (tcx.is_lang_item(LocalDefId.to_def_id(fn_def_id), LangItem.Start)) {
    check_lang_start_fn(tcx, fn_sig, fn_def_id);
  }

  return fcx.coroutine_types;
}

// rustc: compiler/rustc_hir_typeck/src/check.rs:165 check_panic_info_fn
export function check_panic_info_fn(tcx: TyCtxt, fn_id: LocalDefId, fn_sig: FnSigT): void {
  const span = tcx.def_span(fn_id);

  if (tcx.def_kind(fn_id).$ !== "Fn") {
    tcx.dcx().span_err(span, "should be a function");
    return;
  }

  const generic_counts = (tcx.generics_of(fn_id) as Generics).own_counts();
  if (generic_counts.types !== 0) {
    tcx.dcx().span_err(span, "should have no type parameters");
  }
  if (generic_counts.consts !== 0) {
    tcx.dcx().span_err(span, "should have no const parameters");
  }

  if (hir.Safety.is_unsafe(FnSig.safety(fn_sig))) {
    const hir_id = tcx.local_def_id_to_hir_id(fn_id);
    const span = tcx.def_span(fn_id);
    // If the function is implicitly "unsafe" because it has a `#[target_feature]` attribute,
    // then we should already have emitted an error. Don't also emit a warning.
    // See `tests/ui/panic-handler/panic-handler-with-target-feature.rs`
    const hir_fn_sig = tcx.hir_fn_sig_by_hir_id(hir_id);
    if (hir_fn_sig !== undefined && hir_fn_sig.header.safety.$ === "SafeTargetFeatures") {
      tcx.dcx().span_delayed_bug(
        span,
        "`unsafe_panic_handlers` lint suppressed because there should already be an error for `#[target_feature]`",
      );
    } else {
      tcx.emit_node_span_lint(UNSAFE_PANIC_HANDLERS, hir_id, span, UnsafePanicHandlers_diagnostic({}));
    }
  }

  const panic_info_did = tcx.require_lang_item(LangItem.PanicInfo, span);

  // build type `for<'a, 'b> fn(&'a PanicInfo<'b>) -> !`
  const panic_info_ty = Unnormalized.skip_norm_wip(
    EarlyBinder.instantiate(
      tcx.type_of(panic_info_did) as EarlyBinder<Ty>,
      tcx,
      [GenericArg.from_Region(Region.new_bound(tcx, INNERMOST, { var: BoundVar.from_u32(1), kind: BoundRegionKind.Anon }))],
      fold_Ty,
    ),
  );
  const panic_info_ref_ty = Ty.new_imm_ref(
    tcx,
    Region.new_bound(tcx, INNERMOST, { var: BoundVar.ZERO, kind: BoundRegionKind.Anon }),
    panic_info_ty,
  );

  const bounds = tcx.mk_bound_variable_kinds([
    { $: "Region", _0: BoundRegionKind.Anon },
    { $: "Region", _0: BoundRegionKind.Anon },
  ]);
  const expected_sig: PolyFnSig = Binder.bind_with_vars(
    tcx.mk_fn_sig_rust_abi([panic_info_ref_ty], tcx.types.never, FnSig.safety(fn_sig)),
    bounds,
  );

  void check_function_signature(
    tcx,
    ObligationCause.new(span, fn_id, { $: "LangFunctionType", _0: sym.panic_impl }),
    LocalDefId.to_def_id(fn_id),
    expected_sig,
  );
}

// rustc: compiler/rustc_hir_typeck/src/check.rs:237 check_lang_start_fn
export function check_lang_start_fn(tcx: TyCtxt, fn_sig: FnSigT, def_id: LocalDefId): void {
  // build type `fn(main: fn() -> T, argc: isize, argv: *const *const u8, sigpipe: u8)`

  // make a Ty for the generic on the fn for diagnostics
  // FIXME: make the lang item generic checks check for the right generic *kind*
  // for example `start`'s generic should be a type parameter
  const generics = tcx.generics_of(def_id) as Generics;
  const fn_generic = generics.param_at(0, tcx);
  const generic_ty = Ty.new_param(tcx, fn_generic.index, fn_generic.name);
  const main_fn_ty = Ty.new_fn_ptr(tcx, Binder.dummy(tcx.mk_fn_sig_safe_rust_abi([], generic_ty), fold_FnSig));

  const expected_sig: PolyFnSig = Binder.dummy(
    tcx.mk_fn_sig_rust_abi(
      [main_fn_ty, tcx.types.isize, Ty.new_imm_ptr(tcx, Ty.new_imm_ptr(tcx, tcx.types.u8)), tcx.types.u8],
      tcx.types.isize,
      FnSig.safety(fn_sig),
    ),
    fold_FnSig,
  );

  void check_function_signature(
    tcx,
    ObligationCause.new(tcx.def_span(def_id), def_id, { $: "LangFunctionType", _0: sym.start }),
    LocalDefId.to_def_id(def_id),
    expected_sig,
  );
}
