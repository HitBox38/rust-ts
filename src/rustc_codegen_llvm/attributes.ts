//! Set and unset common attributes on LLVM values.
// Port of compiler/rustc_codegen_llvm/src/attributes.rs (skeleton: lane cg-contract; bodies: lane cg-types-attrs, plan-m7 §8 wave 41).
//
// A `&SimpleCx` parameter given a `CodegenCx` upstream is deref-coerced: callers pass `cx.scx`. `cx.llcx` (an `SCx` field reached
// through `SimpleCx`'s deref) is the accessor `cx.llcx()` (type_.rs:152).
//
// PORT (cg-types-attrs):
// - `SmallVec<[&Attribute; N]>` is an `Attribute[]`; `to_add.extend(opt)` of an `Option` pushes it when `Some`.
// - `sanitizers() - disabled` (bitflags `Sub`) is `enabled & ~disabled`; `intersects` is `(a & b) !== 0` (the `SanitizerSet`
//   stand-in, rustc_target/stand_ins.ts, has neither).
// - Four `Session` methods and two `PointerAuthConfig` methods this file and base.rs call are not ported in rustc_session
//   (which this lane does not own, PORTING §1): `SESSION_STOPS` below stops on them, naming the upstream fn. Root ports them
//   into rustc_session/session.ts (as `Session::fewer_names` was) and these call sites switch to the methods.
// - `rustc_sanitizers` is out of scope (harness/scope.json): a `SanitizerIgnoreList` is never constructed (context.ts), so
//   `filter_instance_sanitizers` is unreachable and stops.
import type { InlineAttr } from "../rustc_attr_ir/data_structures.ts";
import type { InstrumentFnAttr } from "../rustc_attr_ir/data_structures.gen.ts";
import { find_attr } from "../rustc_attr_ir/lib.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import {
  CodegenFnAttrFlags,
  type CodegenFnAttrs,
  PatchableFunctionEntry,
  type SanitizerFnAttrs,
  type TargetFeature,
} from "../rustc_middle/middle/codegen_fn_attrs.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { Instance, InstanceKind } from "../rustc_middle/ty/instance.ts";
import { HasAttrs_DefId } from "../rustc_middle/ty/mod.ts";
import type { PointerAuthConfig, Session } from "../rustc_session/session.ts";
import { type BranchProtection, InstrumentMcountOpts, SwitchWithOptPath } from "../rustc_session/config.ts";
import { sym, Symbol } from "../rustc_span/symbol.ts";
import { mangle_internal_symbol } from "../rustc_symbol_mangling/lib.ts";
import { FramePointer, SanitizerSet, type Target } from "../rustc_target/spec/mod.ts";
import { assert, unported } from "../std/panic.ts";
import type { MutRef } from "../std/mut_ref.ts";
import type { SanitizerIgnoreList, SimpleCx } from "./context.ts";
import { PackedStackBackchainNeedsSoftfloat_diagnostic, SanitizerMemtagRequiresMte_diagnostic } from "./diagnostics.gen.ts";
import * as llvm from "./llvm/mod.ts";
import { AllocKindFlags, type Attribute, AttributeKind, AttributeKind_impl, AttributePlace, MemoryEffects, MemoryEffects_impl, type Value } from "./llvm/mod.ts";
import * as llvm_util from "./llvm_util.ts";

/** PORT (cg-types-attrs): stops for the rustc_session fns this crate calls that rustc_session/session.ts lacks (header). */
export const SESSION_STOPS = {
  /** `Session::needs_plt` (session.rs:863) */
  needs_plt(_sess: Session): boolean {
    return unported("rustc_session: compiler/rustc_session/src/session.rs Session::needs_plt");
  },
  /** `Session::direct_access_external_data` (session.rs:1092) */
  direct_access_external_data(_sess: Session): boolean | undefined {
    return unported("rustc_session: compiler/rustc_session/src/session.rs Session::direct_access_external_data");
  },
  /** `Session::branch_protection` (session.rs:1125) */
  branch_protection(_sess: Session): BranchProtection | undefined {
    return unported("rustc_session: compiler/rustc_session/src/session.rs Session::branch_protection");
  },
  /** `Session::must_emit_unwind_tables` (session.rs:1144) */
  must_emit_unwind_tables(_sess: Session): boolean {
    return unported("rustc_session: compiler/rustc_session/src/session.rs Session::must_emit_unwind_tables");
  },
  /** `PointerAuthConfig::calculate_pauth_abi_version` (session.rs:186). Unreachable today: `pointer_auth_config` is always `None`. */
  calculate_pauth_abi_version(_cfg: PointerAuthConfig, _target: Target): number {
    return unported("rustc_session: compiler/rustc_session/src/session.rs PointerAuthConfig::calculate_pauth_abi_version");
  },
  /** `PointerAuthConfig::fn_attrs` (session.rs:301). Unreachable today: `pointer_auth_config` is always `None`. */
  fn_attrs(_cfg: PointerAuthConfig): string[] {
    return unported("rustc_session: compiler/rustc_session/src/session.rs PointerAuthConfig::fn_attrs");
  },
} as const;

// rustc: compiler/rustc_codegen_llvm/src/attributes.rs:29 apply_to_llfn
export function apply_to_llfn(llfn: Value, idx: AttributePlace, attrs: readonly Attribute[]): void {
  if (attrs.length !== 0) {
    llvm.AddFunctionAttributes(llfn, idx, attrs);
  }
}

// rustc: compiler/rustc_codegen_llvm/src/attributes.rs:35 apply_to_callsite
export function apply_to_callsite(callsite: Value, idx: AttributePlace, attrs: readonly Attribute[]): void {
  if (attrs.length !== 0) {
    llvm.AddCallSiteAttributes(callsite, idx, attrs);
  }
}

// rustc: compiler/rustc_codegen_llvm/src/attributes.rs:41 has_string_attr
export function has_string_attr(llfn: Value, name: string): boolean {
  return llvm.HasStringAttribute(llfn, name);
}

// rustc: compiler/rustc_codegen_llvm/src/attributes.rs:45 remove_string_attr_from_llfn
export function remove_string_attr_from_llfn(llfn: Value, name: string): void {
  llvm.RemoveStringAttrFromFn(llfn, name);
}

/// Get LLVM attribute for the provided inline heuristic.
// #[inline]
// rustc: compiler/rustc_codegen_llvm/src/attributes.rs:51 inline_attr
export function inline_attr(cx: SimpleCx, tcx: TyCtxt, instance: Instance, codegen_fn_attrs: CodegenFnAttrs): Attribute | undefined {
  if (!tcx.sess.opts.unstable_opts.inline_llvm) {
    // disable LLVM inlining
    return AttributeKind_impl.create_attr(AttributeKind.NoInline, cx.llcx());
  }

  // `optnone` requires `noinline`
  let inline: InlineAttr;
  if (codegen_fn_attrs.optimize === "DoNotOptimize") {
    inline = { $: "Never" };
  } else if (codegen_fn_attrs.inline.$ === "None" && InstanceKind.requires_inline(instance.def, tcx)) {
    inline = { $: "Hint" };
  } else {
    inline = codegen_fn_attrs.inline;
  }

  switch (inline.$) {
    case "Hint":
      return AttributeKind_impl.create_attr(AttributeKind.InlineHint, cx.llcx());
    case "Always":
    case "Force":
      return AttributeKind_impl.create_attr(AttributeKind.AlwaysInline, cx.llcx());
    case "Never":
      if (tcx.sess.target.arch.$ !== "AmdGpu") {
        return AttributeKind_impl.create_attr(AttributeKind.NoInline, cx.llcx());
      } else {
        return undefined;
      }
    case "None":
      return undefined;
  }
}

// #[inline]
// rustc: compiler/rustc_codegen_llvm/src/attributes.rs:86 patchable_function_entry_attrs
function patchable_function_entry_attrs(cx: SimpleCx, sess: Session, attr: PatchableFunctionEntry | undefined): Attribute[] {
  const attrs: Attribute[] = [];

  let entry = sess.opts.unstable_opts.patchable_function_entry.entry();
  let prefix = sess.opts.unstable_opts.patchable_function_entry.prefix();
  let section = sess.opts.unstable_opts.patchable_function_entry.section();
  let section_sym: Symbol;

  // Apply attribute specified overrides, if any.
  if (attr !== undefined) {
    const patchable_spec = attr;
    const sym_ = PatchableFunctionEntry.section(patchable_spec);
    if (sym_ !== undefined) {
      section_sym = sym_;
      section = Symbol.as_str(section_sym);
    }
    // Override the nop counts if either is present. If only one is present, the
    // other count is implied to be 0.
    if (PatchableFunctionEntry.entry(patchable_spec) !== undefined || PatchableFunctionEntry.prefix(patchable_spec) !== undefined) {
      entry = PatchableFunctionEntry.entry(patchable_spec) ?? 0;
      prefix = PatchableFunctionEntry.prefix(patchable_spec) ?? 0;
    }
  }

  if (entry > 0) {
    attrs.push(llvm.CreateAttrStringValue(cx.llcx(), "patchable-function-entry", `${entry}`));
  }
  if (prefix > 0) {
    attrs.push(llvm.CreateAttrStringValue(cx.llcx(), "patchable-function-prefix", `${prefix}`));
  }
  if (section !== undefined) {
    attrs.push(llvm.CreateAttrStringValue(cx.llcx(), "patchable-function-entry-section", section));
  }
  return attrs;
}

/// Get LLVM sanitize attributes.
// #[inline]
// rustc: compiler/rustc_codegen_llvm/src/attributes.rs:138 sanitize_attrs
export function sanitize_attrs(
  cx: SimpleCx,
  tcx: TyCtxt,
  sanitizer_fn_attr: SanitizerFnAttrs,
  instance: Instance | undefined,
  sanitizer_ignorelist: SanitizerIgnoreList | undefined,
): Attribute[] {
  const attrs: Attribute[] = [];
  // `tcx.sess.sanitizers() - sanitizer_fn_attr.disabled` (header)
  let enabled: SanitizerSet = tcx.sess.sanitizers() & ~sanitizer_fn_attr.disabled;
  if (sanitizer_ignorelist !== undefined) {
    if (instance !== undefined) {
      // let result = ignorelist.filter_instance_sanitizers(tcx, instance, enabled);
      const result: { enabled: SanitizerSet; ignore_cfi: boolean; ignore_kcfi: boolean } = unported(
        "rustc_sanitizers::ignorelist::SanitizerIgnoreList::filter_instance_sanitizers (rustc_sanitizers out of scope)",
      );
      enabled = result.enabled;
      if (result.ignore_cfi) {
        attrs.push(llvm.CreateAttrString(cx.llcx(), "no-sanitize-cfi"));
      }
      if (result.ignore_kcfi) {
        attrs.push(llvm.CreateAttrString(cx.llcx(), "no-sanitize-kcfi"));
      }
    }
  }

  if (SanitizerSet.contains(enabled, SanitizerSet.ADDRESS) || SanitizerSet.contains(enabled, SanitizerSet.KERNELADDRESS)) {
    attrs.push(AttributeKind_impl.create_attr(AttributeKind.SanitizeAddress, cx.llcx()));
  }
  if (SanitizerSet.contains(enabled, SanitizerSet.MEMORY)) {
    attrs.push(AttributeKind_impl.create_attr(AttributeKind.SanitizeMemory, cx.llcx()));
  }
  if (SanitizerSet.contains(enabled, SanitizerSet.THREAD)) {
    attrs.push(AttributeKind_impl.create_attr(AttributeKind.SanitizeThread, cx.llcx()));
  }
  if (SanitizerSet.contains(enabled, SanitizerSet.HWADDRESS) || SanitizerSet.contains(enabled, SanitizerSet.KERNELHWADDRESS)) {
    attrs.push(AttributeKind_impl.create_attr(AttributeKind.SanitizeHWAddress, cx.llcx()));
  }
  if (SanitizerSet.contains(enabled, SanitizerSet.SHADOWCALLSTACK)) {
    attrs.push(AttributeKind_impl.create_attr(AttributeKind.ShadowCallStack, cx.llcx()));
  }
  if (SanitizerSet.contains(enabled, SanitizerSet.MEMTAG)) {
    // Check to make sure the mte target feature is actually enabled.
    const features = tcx.sess.global_backend_features;
    let mte_feature: string | undefined;
    for (let i = features.length - 1; i >= 0; i--) {
      const n = features[i]!;
      if (["+mte", "-mte"].includes(n)) {
        mte_feature = n;
        break;
      }
    }
    if (mte_feature === undefined || mte_feature === "-mte") {
      tcx.dcx().emit_err(SanitizerMemtagRequiresMte_diagnostic({}));
    }

    attrs.push(AttributeKind_impl.create_attr(AttributeKind.SanitizeMemTag, cx.llcx()));
  }
  if (SanitizerSet.contains(enabled, SanitizerSet.SAFESTACK)) {
    attrs.push(AttributeKind_impl.create_attr(AttributeKind.SanitizeSafeStack, cx.llcx()));
  }
  if (SanitizerSet.contains(tcx.sess.sanitizers(), SanitizerSet.REALTIME)) {
    switch (sanitizer_fn_attr.rtsan_setting) {
      case "Nonblocking":
        attrs.push(AttributeKind_impl.create_attr(AttributeKind.SanitizeRealtimeNonblocking, cx.llcx()));
        break;
      case "Blocking":
        attrs.push(AttributeKind_impl.create_attr(AttributeKind.SanitizeRealtimeBlocking, cx.llcx()));
        break;
      // caller is the default, so no llvm attribute
      case "Caller":
        break;
    }
  }
  return attrs;
}

/// Tell LLVM to emit or not emit the information necessary to unwind the stack for the function.
// #[inline]
// rustc: compiler/rustc_codegen_llvm/src/attributes.rs:207 uwtable_attr
export function uwtable_attr(llcx: llvm.Context, use_sync_unwind: boolean | undefined): Attribute {
  // NOTE: We should determine if we even need async unwind tables, as they
  // take have more overhead and if we can use sync unwind tables we
  // probably should.
  //
  // Similar logic exists for the per-module uwtable annotation in `context.rs`.
  const async_unwind = !(use_sync_unwind ?? false);
  return llvm.CreateUWTableAttr(llcx, async_unwind);
}

// rustc: compiler/rustc_codegen_llvm/src/attributes.rs:217 frame_pointer
export function frame_pointer(sess: Session): FramePointer {
  const fp: MutRef<FramePointer> = { value: sess.target.frame_pointer };
  const opts = sess.opts;
  // "mcount" function relies on stack pointer.
  // See <https://sourceware.org/binutils/docs/gprof/Implementation.html>.
  if (opts.unstable_opts.instrument_mcount.$ === "Mcount") {
    FramePointer.ratchet(fp, FramePointer.Always);
  }
  FramePointer.ratchet(fp, opts.cg.force_frame_pointers);
  return fp.value;
}

// rustc: compiler/rustc_codegen_llvm/src/attributes.rs:229 frame_pointer_type_attr
export function frame_pointer_type_attr(cx: SimpleCx, sess: Session): Attribute | undefined {
  const fp = frame_pointer(sess);
  let attr_value: string;
  switch (fp) {
    case "Always":
      attr_value = "all";
      break;
    case "NonLeaf":
      attr_value = "non-leaf";
      break;
    case "MayOmit":
      return undefined;
  }
  return llvm.CreateAttrStringValue(cx.llcx(), "frame-pointer", attr_value);
}

// rustc: compiler/rustc_codegen_llvm/src/attributes.rs:242 function_return_attr
function function_return_attr(cx: SimpleCx, sess: Session): Attribute | undefined {
  let function_return_attr: AttributeKind;
  switch (sess.opts.unstable_opts.function_return) {
    case "Keep":
      return undefined;
    case "ThunkExtern":
      function_return_attr = AttributeKind.FnRetThunkExtern;
      break;
  }

  return AttributeKind_impl.create_attr(function_return_attr, cx.llcx());
}

/// Tell LLVM what instrument function to insert.
// #[inline]
// rustc: compiler/rustc_codegen_llvm/src/attributes.rs:253 instrument_function_attr
function instrument_function_attr(cx: SimpleCx, sess: Session, instrument_fn: InstrumentFnAttr | undefined): Attribute[] {
  const attrs: Attribute[] = [];
  if (sess.opts.unstable_opts.instrument_mcount.$ !== "Disabled") {
    // Similar to `clang -pg` behavior. Handled by the
    // `post-inline-ee-instrument` LLVM pass.

    let instrument_entry: boolean;
    switch (instrument_fn) {
      case "On":
      case undefined:
        instrument_entry = true;
        break;
      case "Off":
        instrument_entry = false;
        break;
    }

    if (instrument_entry) {
      let opts = InstrumentMcountOpts.default();
      const m = sess.opts.unstable_opts.instrument_mcount;
      switch (m.$) {
        case "Mcount": {
          const mopts = m._0;
          // The function name varies on platforms.
          // See test/CodeGen/mcount.c in clang.
          const mcount_name = sess.target.llvm_mcount_intrinsic !== undefined ? sess.target.llvm_mcount_intrinsic : sess.target.mcount;

          attrs.push(llvm.CreateAttrStringValue(cx.llcx(), "instrument-function-entry-inlined", mcount_name));
          opts = mopts;
          break;
        }
        case "Fentry": {
          const fopts = m._0;
          attrs.push(llvm.CreateAttrStringValue(cx.llcx(), "fentry-call", "true"));
          opts = fopts;
          break;
        }
        // InstrumentMcount::Disabled => {} (excluded by the enclosing `if`)
      }
      if (opts.no_call) {
        attrs.push(llvm.CreateAttrString(cx.llcx(), "mnop-mcount"));
      }
      if (opts.record) {
        attrs.push(llvm.CreateAttrString(cx.llcx(), "mrecord-mcount"));
      }
    }
  }
  const options = sess.opts.unstable_opts.instrument_xray;
  if (options !== undefined) {
    // XRay instrumentation is similar to __cyg_profile_func_{enter,exit}.
    // Function prologue and epilogue are instrumented with NOP sleds,
    // a runtime library later replaces them with detours into tracing code.

    let never = options.never;
    let always = options.always;

    // always and never may be overridden by the #[instrument_fn = ...] attribute.
    switch (instrument_fn) {
      case "On":
        always = true;
        break;
      case "Off":
        never = true;
        break;
      case undefined:
        break;
    }

    if (never) {
      attrs.push(llvm.CreateAttrStringValue(cx.llcx(), "function-instrument", "xray-never"));
    }
    if (always) {
      attrs.push(llvm.CreateAttrStringValue(cx.llcx(), "function-instrument", "xray-always"));
    }

    if (options.ignore_loops) {
      attrs.push(llvm.CreateAttrString(cx.llcx(), "xray-ignore-loops"));
    }
    // LLVM will not choose the default for us, but rather requires specific
    // threshold in absence of "xray-always". Use the same default as Clang.
    const threshold = options.instruction_threshold ?? 200;
    attrs.push(llvm.CreateAttrStringValue(cx.llcx(), "xray-instruction-threshold", `${threshold}`));
    if (options.skip_entry) {
      attrs.push(llvm.CreateAttrString(cx.llcx(), "xray-skip-entry"));
    }
    if (options.skip_exit) {
      attrs.push(llvm.CreateAttrString(cx.llcx(), "xray-skip-exit"));
    }
  }
  return attrs;
}

// rustc: compiler/rustc_codegen_llvm/src/attributes.rs:347 nojumptables_attr
function nojumptables_attr(cx: SimpleCx, sess: Session): Attribute | undefined {
  if (sess.opts.cg.jump_tables) {
    return undefined;
  }

  return llvm.CreateAttrStringValue(cx.llcx(), "no-jump-tables", "true");
}

// rustc: compiler/rustc_codegen_llvm/src/attributes.rs:355 probestack_attr
function probestack_attr(cx: SimpleCx, tcx: TyCtxt): Attribute | undefined {
  // Currently stack probes seem somewhat incompatible with the address
  // sanitizer and thread sanitizer. With asan we're already protected from
  // stack overflow anyway so we don't really need stack probes regardless.
  // `intersects` (header)
  if ((tcx.sess.sanitizers() & (SanitizerSet.ADDRESS | SanitizerSet.THREAD)) !== 0) {
    return undefined;
  }

  // probestack doesn't play nice either with `-C profile-generate`.
  if (SwitchWithOptPath.enabled(tcx.sess.opts.cg.profile_generate)) {
    return undefined;
  }

  let attr_value: string;
  const stack_probes = tcx.sess.target.stack_probes;
  switch (stack_probes.$) {
    case "None":
      return undefined;
    // Request LLVM to generate the probes inline. If the given LLVM version does not support
    // this, no probe is generated at all (even if the attribute is specified).
    case "Inline":
      attr_value = "inline-asm";
      break;
    // Flag our internal `__rust_probestack` function as the stack probe symbol.
    // This is defined in the `compiler-builtins` crate for each architecture.
    case "Call":
      attr_value = mangle_internal_symbol(tcx, "__rust_probestack");
      break;
    // Pick from the two above based on the LLVM version.
    case "InlineOrCall": {
      const min_llvm_version_for_inline = stack_probes.min_llvm_version_for_inline;
      if (version_lt(llvm_util.get_version(), min_llvm_version_for_inline)) {
        attr_value = mangle_internal_symbol(tcx, "__rust_probestack");
      } else {
        attr_value = "inline-asm";
      }
      break;
    }
  }
  return llvm.CreateAttrStringValue(cx.llcx(), "probe-stack", attr_value);
}

/** `(u32, u32, u32) < (u32, u32, u32)`: the derived lexicographic `PartialOrd` of tuples. */
function version_lt(a: readonly [number, number, number], b: readonly [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! < b[i]!;
  }
  return false;
}

// rustc: compiler/rustc_codegen_llvm/src/attributes.rs:388 stackprotector_attr
function stackprotector_attr(cx: SimpleCx, sess: Session): Attribute | undefined {
  let sspattr: AttributeKind;
  switch (sess.stack_protector()) {
    case "None":
      return undefined;
    case "All":
      sspattr = AttributeKind.StackProtectReq;
      break;
    case "Strong":
      sspattr = AttributeKind.StackProtectStrong;
      break;
    case "Basic":
      sspattr = AttributeKind.StackProtect;
      break;
  }

  return AttributeKind_impl.create_attr(sspattr, cx.llcx());
}

// rustc: compiler/rustc_codegen_llvm/src/attributes.rs:399 packed_stack_attr
function packed_stack_attr(cx: SimpleCx, sess: Session, function_attributes: readonly TargetFeature[]): Attribute | undefined {
  if (sess.target.arch.$ !== "S390x") {
    return undefined;
  }
  if (!sess.opts.unstable_opts.packed_stack) {
    return undefined;
  }

  // The backchain and softfloat flags can be set via -Ctarget-features=...
  // or via #[target_features(enable = ...)] so we have to check both possibilities
  const have_backchain = sess.internal_target_features.has(sym.backchain) || function_attributes.some((feature) => feature.name === sym.backchain);
  const have_softfloat = sess.internal_target_features.has(sym.soft_float) || function_attributes.some((feature) => feature.name === sym.soft_float);

  // If both, backchain and packedstack, are enabled LLVM cannot generate valid function entry points
  // with the default ABI. However if the softfloat flag is set LLVM will switch to the softfloat
  // ABI, where this works.
  if (have_backchain && !have_softfloat) {
    sess.dcx().emit_err(PackedStackBackchainNeedsSoftfloat_diagnostic({}));
    return undefined;
  }

  return llvm.CreateAttrString(cx.llcx(), "packed-stack");
}

// rustc: compiler/rustc_codegen_llvm/src/attributes.rs:429 target_cpu_attr
export function target_cpu_attr(cx: SimpleCx, sess: Session): Attribute {
  // `&Session` deref-coerced to `&EarlySession`
  const target_cpu = llvm_util.target_cpu(sess.early_sess);
  return llvm.CreateAttrStringValue(cx.llcx(), "target-cpu", target_cpu);
}

// rustc: compiler/rustc_codegen_llvm/src/attributes.rs:434 tune_cpu_attr
export function tune_cpu_attr(cx: SimpleCx, sess: Session): Attribute | undefined {
  const tune_cpu = llvm_util.tune_cpu(sess);
  return tune_cpu === undefined ? undefined : llvm.CreateAttrStringValue(cx.llcx(), "tune-cpu", tune_cpu);
}

/// Get the `target-features` LLVM attribute.
// rustc: compiler/rustc_codegen_llvm/src/attributes.rs:440 target_features_attr
export function target_features_attr(cx: SimpleCx, tcx: TyCtxt, function_features: string[]): Attribute | undefined {
  const global_features = tcx.sess.global_backend_features;
  // `global_features.chain(function_features).intersperse(",").collect::<String>()`
  const target_features = [...global_features, ...function_features].join(",");
  return target_features.length !== 0 ? llvm.CreateAttrStringValue(cx.llcx(), "target-features", target_features) : undefined;
}

/// Get the `NonLazyBind` LLVM attribute,
/// if the codegen options allow skipping the PLT.
// rustc: compiler/rustc_codegen_llvm/src/attributes.rs:455 non_lazy_bind_attr
export function non_lazy_bind_attr(cx: SimpleCx, sess: Session): Attribute | undefined {
  // Don't generate calls through PLT if it's not necessary
  if (!SESSION_STOPS.needs_plt(sess)) {
    return AttributeKind_impl.create_attr(AttributeKind.NonLazyBind, cx.llcx());
  } else {
    return undefined;
  }
}

/// Get the default optimizations attrs for a function.
// #[inline]
// rustc: compiler/rustc_codegen_llvm/src/attributes.rs:465 default_optimisation_attrs
export function default_optimisation_attrs(cx: SimpleCx, sess: Session): Attribute[] {
  const attrs: Attribute[] = [];
  switch (sess.opts.optimize) {
    case "Size":
      attrs.push(AttributeKind_impl.create_attr(AttributeKind.OptimizeForSize, cx.llcx()));
      break;
    case "SizeMin":
      attrs.push(AttributeKind_impl.create_attr(AttributeKind.MinSize, cx.llcx()));
      attrs.push(AttributeKind_impl.create_attr(AttributeKind.OptimizeForSize, cx.llcx()));
      break;
    default:
      break;
  }
  return attrs;
}

// rustc: compiler/rustc_codegen_llvm/src/attributes.rs:483 create_alloc_family_attr
function create_alloc_family_attr(llcx: llvm.Context): Attribute {
  return llvm.CreateAttrStringValue(llcx, "alloc-family", "__rust_alloc");
}

/// Helper for `FnAbiLlvmExt::apply_attrs_llfn`:
/// Composite function which sets LLVM attributes for function depending on its AST (`#[attribute]`)
/// attributes.
// rustc: compiler/rustc_codegen_llvm/src/attributes.rs:490 llfn_attrs_from_instance
export function llfn_attrs_from_instance(
  cx: SimpleCx,
  tcx: TyCtxt,
  llfn: Value,
  codegen_fn_attrs: CodegenFnAttrs,
  instance: Instance | undefined,
  sanitizer_ignorelist: SanitizerIgnoreList | undefined,
): void {
  const sess = tcx.sess;
  const to_add: Attribute[] = [];
  const extend = (a: Attribute | undefined): void => {
    if (a !== undefined) to_add.push(a);
  };

  switch (codegen_fn_attrs.optimize) {
    case "Default":
      to_add.push(...default_optimisation_attrs(cx, sess));
      break;
    case "DoNotOptimize":
      to_add.push(AttributeKind_impl.create_attr(AttributeKind.OptimizeNone, cx.llcx()));
      break;
    case "Size":
      to_add.push(AttributeKind_impl.create_attr(AttributeKind.MinSize, cx.llcx()));
      to_add.push(AttributeKind_impl.create_attr(AttributeKind.OptimizeForSize, cx.llcx()));
      break;
    case "Speed":
      break;
  }

  if (instance !== undefined) {
    extend(inline_attr(cx, tcx, instance, codegen_fn_attrs));
  }

  if (SESSION_STOPS.must_emit_unwind_tables(sess)) {
    to_add.push(uwtable_attr(cx.llcx(), sess.opts.unstable_opts.use_sync_unwind));
  }

  if (sess.opts.cg.profile_sample_use !== undefined) {
    to_add.push(llvm.CreateAttrString(cx.llcx(), "use-sample-profile"));
  }

  // FIXME: none of these functions interact with source level attributes.
  extend(frame_pointer_type_attr(cx, sess));
  extend(function_return_attr(cx, sess));
  to_add.push(...instrument_function_attr(cx, sess, codegen_fn_attrs.instrument_fn));
  extend(nojumptables_attr(cx, sess));
  extend(probestack_attr(cx, tcx));
  extend(stackprotector_attr(cx, sess));

  if (CodegenFnAttrFlags.contains(codegen_fn_attrs.flags, CodegenFnAttrFlags.NO_BUILTINS)) {
    to_add.push(llvm.CreateAttrString(cx.llcx(), "no-builtins"));
  }

  if (CodegenFnAttrFlags.contains(codegen_fn_attrs.flags, CodegenFnAttrFlags.OFFLOAD_KERNEL)) {
    to_add.push(llvm.CreateAttrString(cx.llcx(), "offload-kernel"));
  }

  if (CodegenFnAttrFlags.contains(codegen_fn_attrs.flags, CodegenFnAttrFlags.COLD)) {
    to_add.push(AttributeKind_impl.create_attr(AttributeKind.Cold, cx.llcx()));
  }
  if (CodegenFnAttrFlags.contains(codegen_fn_attrs.flags, CodegenFnAttrFlags.FFI_PURE)) {
    to_add.push(MemoryEffects_impl.create_attr(MemoryEffects.ReadOnly, cx.llcx()));
  }
  if (CodegenFnAttrFlags.contains(codegen_fn_attrs.flags, CodegenFnAttrFlags.FFI_CONST)) {
    to_add.push(MemoryEffects_impl.create_attr(MemoryEffects.None, cx.llcx()));
  }
  if (CodegenFnAttrFlags.contains(codegen_fn_attrs.flags, CodegenFnAttrFlags.NAKED)) {
    // do nothing; a naked function is converted into an extern function
    // and a global assembly block. LLVM's support for naked functions is
    // not used.
  } else {
    // Do not set sanitizer attributes for naked functions.
    to_add.push(...sanitize_attrs(cx, tcx, codegen_fn_attrs.sanitizers, instance, sanitizer_ignorelist));

    // For non-naked functions, set branch protection attributes on aarch64.
    const bp = SESSION_STOPS.branch_protection(sess);
    if (bp !== undefined) {
      const { bti, pac_ret, gcs } = bp;
      assert(sess.target.arch.$ === "AArch64", "assertion failed: sess.target.arch == Arch::AArch64");
      if (bti) {
        to_add.push(llvm.CreateAttrString(cx.llcx(), "branch-target-enforcement"));
      }
      if (gcs) {
        to_add.push(llvm.CreateAttrString(cx.llcx(), "guarded-control-stack"));
      }
      if (pac_ret !== undefined) {
        const { leaf, pc, key } = pac_ret;
        if (pc) {
          to_add.push(llvm.CreateAttrString(cx.llcx(), "branch-protection-pauth-lr"));
        }
        to_add.push(llvm.CreateAttrStringValue(cx.llcx(), "sign-return-address", leaf ? "all" : "non-leaf"));
        to_add.push(llvm.CreateAttrStringValue(cx.llcx(), "sign-return-address-key", key === "A" ? "a_key" : "b_key"));
      }
    }
  }
  if (
    CodegenFnAttrFlags.contains(codegen_fn_attrs.flags, CodegenFnAttrFlags.ALLOCATOR) ||
    CodegenFnAttrFlags.contains(codegen_fn_attrs.flags, CodegenFnAttrFlags.ALLOCATOR_ZEROED)
  ) {
    to_add.push(create_alloc_family_attr(cx.llcx()));
    if (instance !== undefined) {
      // find_attr!(tcx, Instance.def_id(instance), RustcAllocatorZeroedVariant {name} => name)
      const name = find_attr(HasAttrs_DefId.get_attrs(Instance.def_id(instance), tcx), (k) => (k.$ === "RustcAllocatorZeroedVariant" ? k.name : undefined));
      if (name !== undefined) {
        to_add.push(llvm.CreateAttrStringValue(cx.llcx(), "alloc-variant-zeroed", mangle_internal_symbol(tcx, Symbol.as_str(name))));
      }
    }
    // apply to argument place instead of function
    const alloc_align = AttributeKind_impl.create_attr(AttributeKind.AllocAlign, cx.llcx());
    apply_to_llfn(llfn, { $: "Argument", _0: 1 }, [alloc_align]);
    to_add.push(llvm.CreateAllocSizeAttr(cx.llcx(), 0));
    let flags = (AllocKindFlags.Alloc | AllocKindFlags.Aligned) as AllocKindFlags;
    if (CodegenFnAttrFlags.contains(codegen_fn_attrs.flags, CodegenFnAttrFlags.ALLOCATOR)) {
      flags = (flags | AllocKindFlags.Uninitialized) as AllocKindFlags;
    } else {
      flags = (flags | AllocKindFlags.Zeroed) as AllocKindFlags;
    }
    to_add.push(llvm.CreateAllocKindAttr(cx.llcx(), flags));
    // apply to return place instead of function (unlike all other attributes applied in this
    // function)
    const no_alias = AttributeKind_impl.create_attr(AttributeKind.NoAlias, cx.llcx());
    apply_to_llfn(llfn, AttributePlace.ReturnValue, [no_alias]);
  }
  if (CodegenFnAttrFlags.contains(codegen_fn_attrs.flags, CodegenFnAttrFlags.REALLOCATOR)) {
    to_add.push(create_alloc_family_attr(cx.llcx()));
    to_add.push(llvm.CreateAllocKindAttr(cx.llcx(), (AllocKindFlags.Realloc | AllocKindFlags.Aligned) as AllocKindFlags));
    // applies to argument place instead of function place
    const allocated_pointer = AttributeKind_impl.create_attr(AttributeKind.AllocatedPointer, cx.llcx());
    apply_to_llfn(llfn, { $: "Argument", _0: 0 }, [allocated_pointer]);
    // apply to argument place instead of function
    const alloc_align = AttributeKind_impl.create_attr(AttributeKind.AllocAlign, cx.llcx());
    apply_to_llfn(llfn, { $: "Argument", _0: 2 }, [alloc_align]);
    to_add.push(llvm.CreateAllocSizeAttr(cx.llcx(), 3));
    const no_alias = AttributeKind_impl.create_attr(AttributeKind.NoAlias, cx.llcx());
    apply_to_llfn(llfn, AttributePlace.ReturnValue, [no_alias]);
  }
  if (CodegenFnAttrFlags.contains(codegen_fn_attrs.flags, CodegenFnAttrFlags.DEALLOCATOR)) {
    to_add.push(create_alloc_family_attr(cx.llcx()));
    to_add.push(llvm.CreateAllocKindAttr(cx.llcx(), AllocKindFlags.Free));
    // applies to argument place instead of function place
    const allocated_pointer = AttributeKind_impl.create_attr(AttributeKind.AllocatedPointer, cx.llcx());
    // "Does not capture provenance" means "if the function call stashes the pointer somewhere,
    // accessing that pointer after the function returns is UB". That is definitely the case here since
    // freeing will destroy the provenance.
    const captures_addr = AttributeKind_impl.create_attr(AttributeKind.CapturesAddress, cx.llcx());
    const attrs = [allocated_pointer, captures_addr];
    apply_to_llfn(llfn, { $: "Argument", _0: 0 }, attrs);
  }
  if (codegen_fn_attrs.alignment !== undefined) {
    const align = codegen_fn_attrs.alignment;
    llvm.set_alignment(llfn, align);
  }
  const packed_stack = packed_stack_attr(cx, sess, codegen_fn_attrs.target_features);
  if (packed_stack !== undefined) {
    to_add.push(packed_stack);
  }
  to_add.push(...patchable_function_entry_attrs(cx, sess, codegen_fn_attrs.patchable_function_entry));

  // Always annotate functions with the target-cpu they are compiled for.
  // Without this, ThinLTO won't inline Rust functions into Clang generated
  // functions (because Clang annotates functions this way too).
  to_add.push(target_cpu_attr(cx, sess));
  // tune-cpu is only conveyed through the attribute for our purpose.
  // The target doesn't care; the subtarget reads our attribute.
  extend(tune_cpu_attr(cx, sess));

  const function_features_ = codegen_fn_attrs.target_features.map((f) => Symbol.as_str(f.name));

  const function_features: string[] = [];
  for (const feat of function_features_) {
    // Convert to LLVMFeatures and filter out unavailable ones
    const llvm_feat = llvm_util.to_llvm_features(sess.target, feat);
    if (llvm_feat === undefined) continue;
    // Convert LLVMFeatures & dependencies to +<feats>s
    for (const f of llvm_feat.into_iter()) function_features.push(`+${f}`);
  }
  if (codegen_fn_attrs.instruction_set !== undefined) {
    switch (codegen_fn_attrs.instruction_set) {
      case "ArmA32":
        function_features.push("-thumb-mode");
        break;
      case "ArmT32":
        function_features.push("+thumb-mode");
        break;
    }
  }

  if (sess.target.is_like_wasm) {
    // If this function is an import from the environment but the wasm
    // import has a specific module/name, apply them here.
    if (instance !== undefined) {
      const module = wasm_import_module(tcx, Instance.def_id(instance));
      if (module !== undefined) {
        to_add.push(llvm.CreateAttrStringValue(cx.llcx(), "wasm-import-module", module));

        const name_ = codegen_fn_attrs.symbol_name ?? tcx.item_name(Instance.def_id(instance));
        const name = Symbol.as_str(name_);
        to_add.push(llvm.CreateAttrStringValue(cx.llcx(), "wasm-import-name", name));
      }
    }
  }

  if (sess.pointer_authentication()) {
    const cfg = sess.pointer_auth_config!;
    for (const ptrauth_attr of SESSION_STOPS.fn_attrs(cfg)) {
      to_add.push(llvm.CreateAttrString(cx.llcx(), ptrauth_attr));
    }
  }

  extend(target_features_attr(cx, tcx, function_features));

  apply_to_llfn(llfn, AttributePlace.Function, to_add);
}

// rustc: compiler/rustc_codegen_llvm/src/attributes.rs:712 wasm_import_module
function wasm_import_module(tcx: TyCtxt, id: DefId): string | undefined {
  return tcx.wasm_import_module_map(id.krate).get(id);
}
