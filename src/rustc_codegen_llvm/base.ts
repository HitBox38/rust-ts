//! Codegen the MIR to the LLVM IR.
//!
//! Hopefully useful general knowledge about codegen:
//!
//! * There's no way to find out the [`Ty`] type of a [`Value`]. Doing so
//!   would be "trying to get the eggs out of an omelette" (credit:
//!   pcwalton). You can, instead, find out its [`llvm::Type`] by calling [`val_ty`],
//!   but one [`llvm::Type`] corresponds to many [`Ty`]s; for instance, `tup(int, int,
//!   int)` and `rec(x=int, y=int, z=int)` will have the same [`llvm::Type`].
//!
//! [`Ty`]: rustc_middle::ty::Ty
//! [`val_ty`]: crate::common::val_ty
// Port of compiler/rustc_codegen_llvm/src/base.rs (skeleton: lane cg-contract; bodies: lane cg-types-attrs, plan-m7 §8 wave 41).
//
// PORT (cg-types-attrs):
// - `ValueIter` is a class with `next()` and `[Symbol.iterator]` (the `Iterator` impl); `step` is the FFI fn it calls.
// - `Instant::elapsed()` is `Instant::now().duration_since(start)` (its definition; src/std/time.ts has no `elapsed`).
// - `tcx.prof.generic_activity_with_arg_recorder(..)`: the profiler stand-in has no such method; the recorder closure only runs
//   under `-Z self-profile`, which stops at construction (rustc_expand/proc_macro.ts precedent), so this is
//   `generic_activity(name)` with the closure as a comment.
// - `tcx.dep_graph.with_task(dep_node, tcx, || .., Some(dep_graph::hash_result))`: the disabled graph (D3) never calls the hash
//   function; `HashStable for ModuleCodegen<ModuleLlvm>` is not ported, so it stops if it ever is.
// - Two callees of other lanes have no stub yet (the contract lists none): `MonoItemExt::{predefine, define}`
//   (rustc_codegen_ssa/src/mono_item.rs, ssa-mir-core) and `maybe_create_entry_wrapper` / `ModuleCodegen::new_regular`
//   (rustc_codegen_ssa/src/base.rs and lib.rs, ssa-base). They stop at the call site, naming the owner (handoff).
// - `c"llvm.used"` is the string `"llvm.used"` (`create_used_variable_impl` takes a `&CStr` as a string, context.ts).
import type { Linkage } from "../rustc_attr_ir/data_structures.gen.ts";
import type { ModuleCodegen } from "../rustc_codegen_ssa/lib.ts";
import { SanitizerFnAttrs, type CodegenFnAttrs } from "../rustc_middle/middle/codegen_fn_attrs.ts";
import type { MonoItem, MonoItemData, Visibility } from "../rustc_middle/mono.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { SanitizerSet } from "../rustc_target/spec/mod.ts";
import { unported } from "../std/panic.ts";
import { Instant } from "../std/time.ts";
import { ModuleLlvm } from "./back/llvm_backend.ts";
import { OffloadGlobals } from "./builder/gpu_offload.ts";
import { CodegenCx } from "./context.ts";
import * as attributes from "./attributes.ts";
import { SESSION_STOPS } from "./attributes.ts";
import * as llvm from "./llvm/mod.ts";
import type { Value } from "./llvm/mod.ts";

// rustc-type: compiler/rustc_codegen_llvm/src/base.rs:36 ValueIter
export class ValueIter implements IterableIterator<Value> {
  constructor(
    /** private */
    public cur: Value | undefined,
    /** private */
    public step: (v: Value) => Value | undefined,
  ) {}

  // impl<'ll> Iterator for ValueIter<'ll>
  // rustc: compiler/rustc_codegen_llvm/src/base.rs:44 next
  next(): IteratorResult<Value> {
    const old = this.cur;
    if (old !== undefined) {
      this.cur = this.step(old);
    }
    return old === undefined ? { done: true, value: undefined } : { done: false, value: old };
  }

  [globalThis.Symbol.iterator](): IterableIterator<Value> {
    return this;
  }
}

// rustc: compiler/rustc_codegen_llvm/src/base.rs:53 iter_globals
export function iter_globals(llmod: llvm.Module): ValueIter {
  return new ValueIter(llvm.LLVMGetFirstGlobal(llmod), llvm.LLVMGetNextGlobal);
}

// rustc: compiler/rustc_codegen_llvm/src/base.rs:57 iter_global_aliases
export function iter_global_aliases(llmod: llvm.Module): ValueIter {
  return new ValueIter(llvm.LLVMGetFirstGlobalAlias(llmod), llvm.LLVMGetNextGlobalAlias);
}

/** `-> (ModuleCodegen<ModuleLlvm>, u64)`: the `u64` is a cost estimate, a `number` as `ExtraBackendMethods` has it. */
// rustc: compiler/rustc_codegen_llvm/src/base.rs:63 compile_codegen_unit
export function compile_codegen_unit(tcx: TyCtxt, cgu_name: Symbol, bitcode_needed: boolean): [ModuleCodegen<ModuleLlvm>, number] {
  const start_time = Instant.now();

  const dep_node = tcx.codegen_unit(cgu_name).codegen_dep_node(tcx);
  const [module] = tcx.dep_graph.with_task(dep_node, tcx, () => module_codegen(tcx, cgu_name, bitcode_needed), (_hcx, _result) =>
    unported("rustc_codegen_llvm::base: HashStable for ModuleCodegen<ModuleLlvm> (dep_graph::hash_result; D3)"),
  );
  const time_to_codegen = Instant.now().duration_since(start_time);

  // We assume that the cost to run LLVM on a CGU is proportional to
  // the time we needed for codegenning it.
  // PORT: `as_nanos() as u64`, as the `number` the caller takes.
  const cost = Number(BigInt.asUintN(64, time_to_codegen.as_nanos()));

  return [module, cost];
}

// rustc: compiler/rustc_codegen_llvm/src/base.rs:83 module_codegen
function module_codegen(tcx: TyCtxt, cgu_name: Symbol, needs_bitcode: boolean): ModuleCodegen<ModuleLlvm> {
  const cgu = tcx.codegen_unit(cgu_name);
  // tcx.prof.generic_activity_with_arg_recorder("codegen_module", |recorder| {
  //     recorder.record_arg(cgu_name.to_string());
  //     recorder.record_arg(cgu.size_estimate().to_string());
  // });
  const _prof_timer = tcx.prof.generic_activity("codegen_module");
  void _prof_timer;
  // Instantiate monomorphizations without filling out definitions yet...
  const llvm_module = ModuleLlvm.new(tcx, Symbol.as_str(cgu_name));
  {
    const cx = CodegenCx.new(tcx, cgu, llvm_module, needs_bitcode);

    // Declare and store globals shared by all offload kernels
    //
    // These globals are left in the LLVM-IR host module so all kernels can access them.
    // They are necessary for correct offload execution. We do this here to simplify the
    // `offload` intrinsic, avoiding the need for tracking whether it's the first
    // intrinsic call or not.
    const has_host_offload = cx.sess().opts.unstable_opts.offload.some((o) => o.$ === "Host" || o.$ === "Test");
    if (has_host_offload && !cx.sess().target.is_like_gpu) {
      cx.offload_globals = OffloadGlobals.declare(cx);
    }

    const mono_items = cx.codegen_unit.items_in_deterministic_order(cx.tcx);
    for (const [mono_item, data] of mono_items) {
      MonoItemExt_predefine(mono_item, cx, Symbol.as_str(cgu_name), data.linkage, data.visibility);
    }

    // ... and now that we have everything pre-defined, fill out those definitions.
    for (const [mono_item, item_data] of mono_items) {
      MonoItemExt_define(mono_item, cx, Symbol.as_str(cgu_name), item_data);
    }

    // If this codegen unit contains the main function, also create the
    // wrapper here
    const entry = maybe_create_entry_wrapper(cx, cx.codegen_unit);
    if (entry !== undefined) {
      const attrs = attributes.sanitize_attrs(cx.scx, tcx, SanitizerFnAttrs.default(), undefined, undefined);
      // When pointer authentication is enabled, ensure that the ptrauth-* attributes are
      // also attached to the entry wrapper.
      //
      // FIXME(jchlanda) If it ever becomes necessary to ensure that all compiler
      // generated functions receive the ptrauth-* attributes, `declare_fn` or
      // `declare_raw_fn` could be used to provide those.
      if (cx.sess().pointer_authentication()) {
        const cfg = cx.sess().pointer_auth_config!;
        for (const ptrauth_attr of SESSION_STOPS.fn_attrs(cfg)) {
          attrs.push(llvm.CreateAttrString(cx.llcx(), ptrauth_attr));
        }
      }
      attributes.apply_to_llfn(entry, llvm.AttributePlace.Function, attrs);
    }

    // Define Objective-C module info and module flags. Note, the module info will
    // also be added to the `llvm.compiler.used` variable, created later.
    //
    // These are only necessary when we need the linker to do its Objective-C-specific
    // magic. We could theoretically do it unconditionally, but at a slight cost to linker
    // performance in the common case where it's unnecessary.
    if (cx.objc_classrefs.size !== 0 || cx.objc_selrefs.size !== 0) {
      if (cx.objc_abi_version() === 1) {
        cx.define_objc_module_info();
      }
      cx.add_objc_module_flags();
    }

    if (cx.sess().pointer_authentication()) {
      const cfg = cx.sess().pointer_auth_config!;

      const aarch64_elf_pauthabi_version = SESSION_STOPS.calculate_pauth_abi_version(cfg, cx.sess().target);
      if (aarch64_elf_pauthabi_version !== 0) {
        cx.add_ptrauth_pauthabi_version_and_platform_flags(aarch64_elf_pauthabi_version);
      }
      if (cfg.elf_got) {
        cx.add_ptrauth_elf_got_flag();
      }
      if (cx.sess().pointer_authentication_functions() !== undefined) {
        cx.add_ptrauth_sign_personality_flag();
      }
    }

    // Finalize code coverage by injecting the coverage map. Note, the coverage map will
    // also be added to the `llvm.compiler.used` variable, created next.
    if (cx.sess().instrument_coverage()) {
      cx.coverageinfo_finalize();
    }

    // Create the llvm.used variable.
    if (cx.used_statics.length !== 0) {
      cx.create_used_variable_impl("llvm.used", cx.used_statics);
    }

    // Create the llvm.compiler.used variable.
    {
      const compiler_used_statics = cx.compiler_used_statics;
      if (compiler_used_statics.length !== 0) {
        cx.create_used_variable_impl("llvm.compiler.used", compiler_used_statics);
      }
    }

    // Run replace-all-uses-with for statics that need it. This must
    // happen after the llvm.used variables are created.
    for (const [old_g, new_g] of cx.statics_to_rauw()) {
      llvm.LLVMReplaceAllUsesWith(old_g, new_g);
      llvm.LLVMDeleteGlobal(old_g);
    }

    // Finalize debuginfo
    if (cx.sess().opts.debuginfo !== "None") {
      cx.debuginfo_finalize();
    }
  }

  return ModuleCodegen_new_regular(Symbol.as_str(cgu_name), llvm_module);
}

/** `mono_item.predefine::<Builder<'_, '_, '_>>(&mut cx, cgu_name, linkage, visibility)`: `MonoItemExt` (rustc_codegen_ssa
 *  mono_item.rs:20), lane ssa-mir-core, has no stub yet (header). */
function MonoItemExt_predefine(_self: MonoItem, _cx: CodegenCx, _cgu_name: string, _linkage: Linkage, _visibility: Visibility): void {
  return unported("ssa-mir-core: compiler/rustc_codegen_ssa/src/mono_item.rs predefine");
}

/** `mono_item.define::<Builder<'_, '_, '_>>(&mut cx, cgu_name, item_data)`: `MonoItemExt` (rustc_codegen_ssa mono_item.rs:20),
 *  lane ssa-mir-core, has no stub yet (header). */
function MonoItemExt_define(_self: MonoItem, _cx: CodegenCx, _cgu_name: string, _item_data: MonoItemData): void {
  return unported("ssa-mir-core: compiler/rustc_codegen_ssa/src/mono_item.rs define");
}

/** `rustc_codegen_ssa::base::maybe_create_entry_wrapper::<Builder<'_, '_, '_>>(&cx, cx.codegen_unit)`, lane ssa-base, has no
 *  stub yet (header). */
function maybe_create_entry_wrapper(_cx: CodegenCx, _cgu: unknown): Value | undefined {
  return unported("ssa-base: compiler/rustc_codegen_ssa/src/base.rs maybe_create_entry_wrapper");
}

/** `ModuleCodegen::new_regular(name, module)` (rustc_codegen_ssa lib.rs:73), lane ssa-base: "left" by ssa-contract (header). */
function ModuleCodegen_new_regular(_name: string, _module: ModuleLlvm): ModuleCodegen<ModuleLlvm> {
  return unported("ssa-base: compiler/rustc_codegen_ssa/src/lib.rs ModuleCodegen::new_regular");
}

// rustc: compiler/rustc_codegen_llvm/src/base.rs:224 set_link_section
export function set_link_section(llval: Value, attrs: CodegenFnAttrs): void {
  const sect = attrs.link_section;
  if (sect === undefined) return;
  // let buf = SmallCStr::new(sect.as_str());
  const buf = Symbol.as_str(sect);
  llvm.set_section(llval, buf);
}

// rustc: compiler/rustc_codegen_llvm/src/base.rs:230 linkage_to_llvm
export function linkage_to_llvm(linkage: Linkage): llvm.Linkage {
  switch (linkage) {
    case "External":
      return "ExternalLinkage";
    case "AvailableExternally":
      return "AvailableExternallyLinkage";
    case "LinkOnceAny":
      return "LinkOnceAnyLinkage";
    case "LinkOnceODR":
      return "LinkOnceODRLinkage";
    case "WeakAny":
      return "WeakAnyLinkage";
    case "WeakODR":
      return "WeakODRLinkage";
    case "Internal":
      return "InternalLinkage";
    case "ExternalWeak":
      return "ExternalWeakLinkage";
  }
}

// rustc: compiler/rustc_codegen_llvm/src/base.rs:243 visibility_to_llvm
export function visibility_to_llvm(linkage: Visibility): llvm.Visibility {
  switch (linkage) {
    case "Default":
      return "Default";
    case "Hidden":
      return "Hidden";
    case "Protected":
      return "Protected";
  }
}

// rustc: compiler/rustc_codegen_llvm/src/base.rs:251 set_variable_sanitizer_attrs
export function set_variable_sanitizer_attrs(llval: Value, attrs: CodegenFnAttrs): void {
  if (SanitizerSet.contains(attrs.sanitizers.disabled, SanitizerSet.ADDRESS) || SanitizerSet.contains(attrs.sanitizers.disabled, SanitizerSet.KERNELADDRESS)) {
    llvm.LLVMRustSetNoSanitizeAddress(llval);
  }
  if (SanitizerSet.contains(attrs.sanitizers.disabled, SanitizerSet.HWADDRESS) || SanitizerSet.contains(attrs.sanitizers.disabled, SanitizerSet.KERNELHWADDRESS)) {
    llvm.LLVMRustSetNoSanitizeHWAddress(llval);
  }
}
