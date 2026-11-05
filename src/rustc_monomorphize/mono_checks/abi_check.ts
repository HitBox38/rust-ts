// Port of compiler/rustc_monomorphize/src/mono_checks/abi_check.rs (lane mono-collector).
//! This module ensures that if a function's ABI requires a particular target feature,
//! that target feature is enabled both on the callee and all callers.
//
// PORT: `impl Fn() -> (Span, HirId)` is a closure returning the pair, as upstream; only its span is ever read.
import { CanonAbi, display_CanonAbi } from "../../rustc_abi/canon_abi.ts";
import { ExternAbi } from "../../rustc_abi/extern_abi.ts";
import type { BackendRepr } from "../../rustc_abi/lib.ts";
import { CRATE_HIR_ID, type HirId } from "../../rustc_hir_id/lib.ts";
import type { CodegenFnAttrs } from "../../rustc_middle/middle/codegen_fn_attrs.ts";
import { type Body, Location, Operand, SourceScope } from "../../rustc_middle/mir/mod.ts";
import { mono_reachable } from "../../rustc_middle/mir/traversal.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { Instance, InstanceKind } from "../../rustc_middle/ty/instance.ts";
import { codegen_handle_fn_abi_err, type FnAbiRequest } from "../../rustc_middle/ty/layout.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { type Ty, TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import { DUMMY_SP, type Span } from "../../rustc_span/lib.ts";
import { Symbol, sym } from "../../rustc_span/symbol.ts";
import type { FnAbi, PassMode } from "../../rustc_target/callconv/mod.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { PolyFnSig } from "../../rustc_type_ir/ty_kind.ts";
import { panic, unwrap } from "../../std/panic.ts";
import { fold_GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import {
  AbiErrorDisabledVectorType_diagnostic,
  AbiErrorUnsupportedUnsizedParameter_diagnostic,
  AbiErrorUnsupportedVectorType_diagnostic,
  AbiRequiredTargetFeature_diagnostic,
} from "../diagnostics.ts";

/// Are vector registers used?
// rustc-type: compiler/rustc_monomorphize/src/mono_checks/abi_check.rs:15 UsesVectorRegisters
type UsesVectorRegisters =
  /// e.g. `neon`
  | "FixedVector"
  /// e.g. `sve`
  | "ScalableVector"
  | "No";

/// Determines whether the combination of `mode` and `repr` will use fixed vector registers,
/// scalable vector registers or no vector registers.
// rustc: compiler/rustc_monomorphize/src/mono_checks/abi_check.rs:25 passes_vectors_by_value
function passes_vectors_by_value(mode: PassMode, repr: BackendRepr): UsesVectorRegisters {
  if (mode.$ === "Ignore" || mode.$ === "Indirect" || mode.$ === "IndirectUnsized") {
    return "No";
  }
  if (mode.$ === "Cast") {
    const cast = mode.cast;
    if (cast.prefix.some((x) => x.kind.$ === "Vector") || cast.rest.unit.kind.$ === "Vector") {
      return "FixedVector";
    }
  }
  if ((mode.$ === "Direct" || mode.$ === "Pair") && repr.$ === "SimdVector") {
    return "FixedVector";
  }
  if ((mode.$ === "Direct" || mode.$ === "Pair") && repr.$ === "SimdScalableVector") {
    return "ScalableVector";
  }
  return "No";
}

/// Checks whether a certain function ABI is compatible with the target features currently enabled
/// for a certain function.
/// `is_call` indicates whether this is a call-site check or a definition-site check;
/// this is only relevant for the wording in the emitted error.
// rustc: compiler/rustc_monomorphize/src/mono_checks/abi_check.rs:54 do_check_simd_vector_abi
function do_check_simd_vector_abi(tcx: TyCtxt, abi: FnAbi<Ty>, def_id: DefId, is_call: boolean, loc: () => [Span, HirId]): void {
  const codegen_attrs = tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs;
  const have_feature = (feat: Symbol): boolean => {
    const target_feats = tcx.sess.internal_target_features.has(feat);
    const fn_feats = codegen_attrs.target_features.some((x) => x.name === feat);
    return target_feats || fn_feats;
  };
  for (const arg_abi of [...abi.args, abi.ret]) {
    const size = arg_abi.layout.size;
    switch (passes_vectors_by_value(arg_abi.mode, arg_abi.layout.backend_repr)) {
      case "FixedVector": {
        // Some targets use homogeneous aggregates, where the unit size counts.
        const mode = arg_abi.mode;
        let unit_size = size;
        if (mode.$ === "Cast" && mode.cast.prefix.length === 0) {
          unit_size = mode.cast.rest.unit.size;
        }

        const feature_def = tcx.sess.target.features_for_correct_fixed_length_vector_abi();
        // Find the first feature that provides at least this vector size.
        const found = feature_def.find(([bits, _]) => unit_size.bits() <= bits);
        if (found === undefined) {
          const [span, _hir_id] = loc();
          tcx.dcx().emit_err(AbiErrorUnsupportedVectorType_diagnostic({ span, ty: arg_abi.layout.ty, is_call }));
          continue;
        }
        const feature = found[1];
        if (feature !== "" && !have_feature(Symbol.intern(feature))) {
          const [span, _hir_id] = loc();
          tcx.dcx().emit_err(
            AbiErrorDisabledVectorType_diagnostic({
              span,
              required_feature: feature,
              abi: display_CanonAbi(abi.conv),
              ty: arg_abi.layout.ty,
              is_call,
              is_scalable: false,
            }),
          );
        }
        break;
      }
      case "ScalableVector": {
        const required_feature = tcx.sess.target.features_for_correct_scalable_vector_abi();
        if (required_feature === undefined) {
          continue;
        }
        if (required_feature !== "" && !have_feature(Symbol.intern(required_feature))) {
          const [span, _] = loc();
          tcx.dcx().emit_err(
            AbiErrorDisabledVectorType_diagnostic({
              span,
              required_feature,
              abi: display_CanonAbi(abi.conv),
              ty: arg_abi.layout.ty,
              is_call,
              is_scalable: true,
            }),
          );
        }
        break;
      }
      case "No": {
        continue;
      }
    }
  }
  // The `vectorcall` ABI is special in that it requires SSE2 no matter which types are being passed.
  if (abi.conv.$ === "X86" && abi.conv._0 === "Vectorcall" && !have_feature(sym.sse2)) {
    const [span, _hir_id] = loc();
    tcx.dcx().emit_err(
      AbiRequiredTargetFeature_diagnostic({
        span,
        required_feature: "sse2",
        abi: "vectorcall",
        is_call,
      }),
    );
  }
}

/// Emit an error when a non-rustic ABI has unsized parameters.
/// Unsized types do not have a stable layout, so should not be used with stable ABIs.
/// `is_call` indicates whether this is a call-site check or a definition-site check;
/// this is only relevant for the wording in the emitted error.
// rustc: compiler/rustc_monomorphize/src/mono_checks/abi_check.rs:144 do_check_unsized_params
function do_check_unsized_params(tcx: TyCtxt, fn_abi: FnAbi<Ty>, is_call: boolean, loc: () => [Span, HirId]): void {
  // Unsized parameters are allowed with the (unstable) "Rust" (and similar) ABIs.
  if (CanonAbi.is_rustic_abi(fn_abi.conv)) {
    return;
  }

  for (const arg_abi of fn_abi.args) {
    if (!arg_abi.layout.is_sized()) {
      const [span, _hir_id] = loc();
      tcx.dcx().emit_err(AbiErrorUnsupportedUnsizedParameter_diagnostic({ span, ty: arg_abi.layout.ty, is_call }));
    }
  }
}

/// Checks the ABI of an Instance, emitting an error when:
///
/// - a non-rustic ABI uses unsized parameters
/// - the signature requires target features that are not enabled
// rustc: compiler/rustc_monomorphize/src/mono_checks/abi_check.rs:171 check_instance_abi
function check_instance_abi(tcx: TyCtxt, instance: Instance): void {
  const typing_env = TypingEnv.fully_monomorphized();
  const ty = Instance.ty(instance, tcx, typing_env);
  if (ty.is_fn() && ExternAbi.eq(PolyFnSig.abi(ty.fn_sig(tcx)), ExternAbi.LlvmIntrinsic)) {
    // We disable all checks for the llvm-intrinsic ABI to allow linking to arbitrary
    // LLVM intrinsics
    return;
  }
  const abi_r = tcx.fn_abi_of_instance(typing_env.as_query_input([instance, RawList.empty()]));
  if (abi_r.$ === "Err") {
    const request: FnAbiRequest = { $: "OfInstance", instance, extra_args: RawList.empty() };
    codegen_handle_fn_abi_err(tcx, abi_r._0, tcx.def_span(Instance.def_id(instance)), request);
    // ABI failed to compute; this will not get through codegen.
    return;
  }
  const abi = abi_r._0;
  // Unlike the call-site check, we do also check "Rust" ABI functions here. This can actually
  // trigger due to scalable vectors being required for the "Rust" ABI for some types.
  const loc = (): [Span, HirId] => {
    const def_id = Instance.def_id(instance);
    const did = def_id.as_local();
    return [tcx.def_span(def_id), did !== undefined ? tcx.local_def_id_to_hir_id(did) : CRATE_HIR_ID];
  };
  do_check_unsized_params(tcx, abi, /*is_call*/ false, loc);
  do_check_simd_vector_abi(tcx, abi, Instance.def_id(instance), /*is_call*/ false, loc);
}

/// Check the ABI at a call site, emitting an error when:
///
/// - a non-rustic ABI uses unsized parameters
/// - the signature requires target features that are not enabled
// rustc: compiler/rustc_monomorphize/src/mono_checks/abi_check.rs:210 check_call_site_abi
function check_call_site_abi(tcx: TyCtxt, callee: Ty, caller: InstanceKind, loc: () => [Span, HirId]): void {
  const extern_abi = PolyFnSig.abi(callee.fn_sig(tcx));
  if (ExternAbi.is_rustic_abi(extern_abi) || ExternAbi.eq(extern_abi, ExternAbi.LlvmIntrinsic)) {
    // We directly handle the soundness of Rust ABIs -- so let's skip the majority of
    // call sites to avoid a perf regression.
    // FIXME(#161753, rustc_scalable_vector/stdarch_aarch64_sve): this is unsound! Above we
    // argue we need the callee-site check for the Rust ABI; we need the call-site check here as
    // well then.
    // We disable all checks for the llvm-intrinsic ABI to allow linking to arbitrary
    // LLVM intrinsics. The caller is responsible for ensuring the ABI makes sense.
    return;
  }
  const typing_env = TypingEnv.fully_monomorphized();
  const kind = callee.kind();
  let callee_abi: FnAbi<Ty>;
  switch (kind.$) {
    case "FnPtr": {
      const sig = callee.fn_sig(tcx);
      const r = tcx.fn_abi_of_fn_ptr(typing_env.as_query_input([sig, RawList.empty()]));
      if (r.$ === "Err") {
        codegen_handle_fn_abi_err(tcx, r._0, loc()[0], { $: "OfFnPtr", sig, extra_args: RawList.empty() });
        // ABI failed to compute; this will not get through codegen.
        return;
      }
      callee_abi = r._0;
      break;
    }
    case "FnDef": {
      const def_id = kind._0;
      const args = unwrap(Binder.no_bound_vars(kind._1, fold_GenericArgs));
      // Intrinsics are handled separately by the compiler.
      if (tcx.intrinsic(def_id) !== undefined) {
        return;
      }
      const instance = Instance.expect_resolve(tcx, typing_env, def_id, args, DUMMY_SP);
      if (instance.def.$ === "LlvmIntrinsic") {
        // LLVM intrinsics don't have an ABI, so there is nothing to check.
        return;
      }
      const r = tcx.fn_abi_of_instance(typing_env.as_query_input([instance, RawList.empty()]));
      if (r.$ === "Err") {
        codegen_handle_fn_abi_err(tcx, r._0, loc()[0], { $: "OfInstance", instance, extra_args: RawList.empty() });
        // ABI failed to compute; this will not get through codegen.
        return;
      }
      callee_abi = r._0;
      break;
    }
    default:
      panic("Invalid function call");
  }

  do_check_unsized_params(tcx, callee_abi, /*is_call*/ true, loc);
  do_check_simd_vector_abi(tcx, callee_abi, InstanceKind.def_id(caller), /*is_call*/ true, loc);
}

// rustc: compiler/rustc_monomorphize/src/mono_checks/abi_check.rs:284 check_callees_abi
function check_callees_abi(tcx: TyCtxt, instance: Instance, body: Body): void {
  // Check all function call terminators.
  for (const [bb, _data] of mono_reachable(body, tcx, instance)) {
    const terminator = body.index(bb).terminator_();
    const kind = terminator.kind;
    switch (kind.$) {
      case "Call":
      case "TailCall": {
        const fn_span = kind.fn_span;
        const callee_ty = Operand.ty(kind.func, body, tcx);
        const callee_ty_ = Instance.instantiate_mir_and_normalize_erasing_regions(
          instance,
          tcx,
          TypingEnv.fully_monomorphized(),
          EarlyBinder.bind(tcx, callee_ty, fold_Ty),
          fold_Ty,
        );
        check_call_site_abi(tcx, callee_ty_, body.source.instance, () => {
          const loc = new Location(bb, body.index(bb).statements.length);
          return [fn_span, SourceScope.lint_root(body.source_info(loc).scope, body.source_scopes) ?? CRATE_HIR_ID];
        });
        break;
      }
      default:
        break;
    }
  }
}

// rustc: compiler/rustc_monomorphize/src/mono_checks/abi_check.rs:316 check_feature_dependent_abi
export function check_feature_dependent_abi(tcx: TyCtxt, instance: Instance, body: Body): void {
  check_instance_abi(tcx, instance);
  check_callees_abi(tcx, instance, body);
}
