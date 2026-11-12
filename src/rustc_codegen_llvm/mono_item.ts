// Port of compiler/rustc_codegen_llvm/src/mono_item.rs (skeleton: lane cg-contract; bodies: lane cg-types-attrs, plan-m7 §8 wave 41).
//
// `impl PreDefineCodegenMethods for CodegenCx` and `impl CodegenCx` are attached with PORTING §5's extension pattern (lib.ts imports
// this file after the class's own module).
//
// PORT (cg-types-attrs):
// - `self.llmod` (an `SCx` field reached through the derefs) is the accessor `llmod()` (type_.rs:156); `self.typing_env()` is
//   `HasTypingEnv::typing_env_()` (context.ts header).
// - `&mut self` receivers are `this` (no borrow tracking).
// - `Builder::append_block(..)` / `Builder::build(..)` / `start_bx.ret_void()` / `start_bx.ret(..)` resolve to `GenericBuilder`'s
//   inherent fns on the concrete `Builder` (review F1): `append_block_inherent`, `build_inherent`, `ret_void_inherent`,
//   `ret_inherent`. `start_bx.call(..)` is `BuilderMethods::call` (no inherent `call` on `Builder`).
// - `CString::new(symbol_name.name).unwrap()`: a mangled symbol name has no NUL, so the name is passed as is.
import { AddressSpace } from "../rustc_abi/lib.ts";
import type { Linkage } from "../rustc_attr_ir/data_structures.gen.ts";
import type { PreDefineCodegenMethods } from "../rustc_codegen_ssa/traits/declare.ts";
import type { ReturnSlot } from "../rustc_codegen_ssa/traits/builder.ts";
import type { CodegenFnAttrs } from "../rustc_middle/middle/codegen_fn_attrs.ts";
import { TyCtxt_codegen_instance_attrs } from "../rustc_middle/middle/codegen_fn_attrs.ts";
import type { Visibility } from "../rustc_middle/mono.ts";
import { Instance } from "../rustc_middle/ty/instance.ts";
import { debug_Instance } from "../rustc_middle/ty/instance.gen.ts";
import { RawList } from "../rustc_middle/ty/list.ts";
import { fold_GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import { type DefId, LOCAL_CRATE } from "../rustc_span/def_id.ts";
import { bug } from "../rustc_span/macros.ts";
import type { FnAbi } from "../rustc_target/callconv/mod.ts";
import { format_debug, PLAIN } from "../std/fmt.ts";
import { assert } from "../std/panic.ts";
import * as base from "./base.ts";
import { Builder } from "./builder.ts";
import { CodegenCx } from "./context.ts";
import { SymbolAlreadyDefined_diagnostic } from "./diagnostics.gen.ts";
import * as llvm from "./llvm/mod.ts";
import type { Value } from "./llvm/mod.ts";

// ---- impl<'tcx> PreDefineCodegenMethods<'tcx> for CodegenCx<'_, 'tcx> (mono_item.rs:26) ----
declare module "./context.ts" {
  interface CodegenCx {
    predefine_static(def_id: DefId, linkage: Linkage, visibility: Visibility, symbol_name: string): void;
    predefine_fn(instance: Instance, linkage: Linkage, visibility: Visibility, symbol_name: string): void;
  }
}

// rustc: compiler/rustc_codegen_llvm/src/mono_item.rs:27 predefine_static
CodegenCx.prototype.predefine_static = function (this: CodegenCx, def_id: DefId, linkage: Linkage, visibility: Visibility, symbol_name: string): void {
  const instance = Instance.mono(this.tcx, def_id);
  const def_kind = this.tcx.def_kind(def_id);
  if (def_kind.$ !== "Static") {
    return bug();
  }
  const nested = def_kind.nested;
  // Nested statics do not have a type, so pick a dummy type and let `codegen_static` figure
  // out the llvm type from the actual evaluated initializer.
  const ty = nested ? this.tcx.types.unit : Instance.ty(instance, this.tcx, this.typing_env_());
  const llty = this.layout_of(ty).llvm_type(this);

  const g =
    this.define_global(symbol_name, llty) ??
    this.sess()
      .dcx()
      .emit_fatal(SymbolAlreadyDefined_diagnostic({ span: this.tcx.def_span(def_id), symbol_name }));

  llvm.set_linkage(g, base.linkage_to_llvm(linkage));
  this.set_visibility(g, linkage, visibility);

  this.assume_dso_local(g, false);

  const attrs = TyCtxt_codegen_instance_attrs(this.tcx, instance.def);
  this.add_static_aliases(g, attrs.foreign_item_symbol_aliases);

  this.instances.set(instance, g);
};

// rustc: compiler/rustc_codegen_llvm/src/mono_item.rs:59 predefine_fn
CodegenCx.prototype.predefine_fn = function (this: CodegenCx, instance: Instance, linkage: Linkage, visibility: Visibility, symbol_name: string): void {
  assert(!TypeVisitableExt.has_infer(instance.args, fold_GenericArgs), "assertion failed: !instance.args.has_infer()");

  const attrs = TyCtxt_codegen_instance_attrs(this.tcx, instance.def);

  const lldecl = this.predefine_without_aliases(instance, attrs, linkage, visibility, symbol_name);
  this.add_function_aliases(instance, lldecl, attrs, attrs.foreign_item_symbol_aliases);

  this.instances.set(instance, lldecl);
};

// ---- impl<'ll, 'tcx> CodegenCx<'ll, 'tcx> (mono_item.rs:78) ----
declare module "./context.ts" {
  interface CodegenCx {
    predefine_without_aliases(instance: Instance, attrs: CodegenFnAttrs, linkage: Linkage, visibility: Visibility, symbol_name: string): Value;
    add_static_aliases(aliasee: Value, aliases: readonly [DefId, Linkage, Visibility][]): void;
    add_function_aliases(aliasee_instance: Instance, aliasee: Value, attrs: CodegenFnAttrs, aliases: readonly [DefId, Linkage, Visibility][]): void;
    assume_dso_local(llval: Value, is_declaration: boolean): boolean;
    set_visibility(lldecl: Value, linkage: Linkage, visibility: Visibility): void;
    should_assume_dso_local(llval: Value, is_declaration: boolean): boolean;
  }
}

// rustc: compiler/rustc_codegen_llvm/src/mono_item.rs:79 predefine_without_aliases
CodegenCx.prototype.predefine_without_aliases = function (
  this: CodegenCx,
  instance: Instance,
  attrs: CodegenFnAttrs,
  linkage: Linkage,
  visibility: Visibility,
  symbol_name: string,
): Value {
  const fn_abi: FnAbi<Ty> = this.fn_abi_of_instance(instance, RawList.empty<Ty>());
  const lldecl = this.declare_fn(symbol_name, fn_abi, instance);
  llvm.set_linkage(lldecl, base.linkage_to_llvm(linkage));
  base.set_link_section(lldecl, attrs);
  if ((linkage === "LinkOnceODR" || linkage === "WeakODR") && this.tcx.sess.target.supports_comdat()) {
    llvm.SetUniqueComdat(this.llmod(), lldecl);
  }
  this.set_visibility(lldecl, linkage, visibility);

  // debug!("predefine_fn: instance = {:?}", instance);

  this.assume_dso_local(lldecl, false);

  return lldecl;
};

/// LLVM has the concept of an `alias`.
/// We need this for the "externally implementable items" feature,
/// though it's generally useful.
///
/// On macos, though this might be a more general problem, function symbols
/// have a fixed target architecture. This is necessary, since macos binaries
/// may contain code for both ARM and x86 macs.
///
/// LLVM *can* add attributes for target architecture to function symbols,
/// cannot do so for statics, but importantly, also cannot for aliases
/// *even* when aliases may refer to a function symbol.
///
/// This is not a problem: instead of using LLVM aliases, we can just generate
/// a new function symbol (with target architecture!) which effectively comes down to:
///
/// ```ignore (illustrative example)
/// fn alias_name(...args) {
///     original_name(...args)
/// }
/// ```
///
/// That's also an alias.
///
/// This does mean that the alias symbol has a different address than the original symbol
/// (assuming no optimizations by LLVM occur). This is unacceptable for statics.
/// So for statics we do want to use LLVM aliases, which is fine,
/// since for those we don't care about target architecture anyway.
///
/// So, this function is for static aliases. See [`add_function_aliases`](Self::add_function_aliases) for the alternative.
// rustc: compiler/rustc_codegen_llvm/src/mono_item.rs:134 add_static_aliases
CodegenCx.prototype.add_static_aliases = function (this: CodegenCx, aliasee: Value, aliases: readonly [DefId, Linkage, Visibility][]): void {
  const ty = this.get_type_of_global(aliasee);

  for (const [alias, linkage, visibility] of aliases) {
    const instance = Instance.mono(this.tcx, alias);
    const symbol_name = this.tcx.symbol_name(instance);
    // tracing::debug!("STATIC ALIAS: {alias:?} {linkage:?} {visibility:?}");

    const lldecl = llvm.add_alias(this.llmod(), ty, AddressSpace.ZERO, aliasee, symbol_name.name);
    // Add the alias name to the set of cached items, so there is no duplicate
    // instance added to it during the normal `external static` codegen
    const prev_entry = this.instances.replace(instance, lldecl);

    // If there already was a previous entry, then `add_static_aliases` was called multiple times for the same `alias`
    // which would result in incorrect codegen
    assert(prev_entry === undefined, () => `An instance was already present for ${format_debug(instance, debug_Instance, PLAIN)}`);

    llvm.set_visibility(lldecl, base.visibility_to_llvm(visibility));
    llvm.set_linkage(lldecl, base.linkage_to_llvm(linkage));
  }
};

/// See [`add_static_aliases`](Self::add_static_aliases) for docs.
// rustc: compiler/rustc_codegen_llvm/src/mono_item.rs:163 add_function_aliases
CodegenCx.prototype.add_function_aliases = function (
  this: CodegenCx,
  aliasee_instance: Instance,
  aliasee: Value,
  attrs: CodegenFnAttrs,
  aliases: readonly [DefId, Linkage, Visibility][],
): void {
  for (const [alias, linkage, visibility] of aliases) {
    const symbol_name = this.tcx.symbol_name(Instance.mono(this.tcx, alias));
    // tracing::debug!(
    //     "FUNCTION ALIAS: generating fn {} that calls {aliasee_instance:?} ({alias:?} {linkage:?} {visibility:?})",
    //     symbol_name.name
    // );

    // predefine another copy of the original instance
    // with a new symbol name
    const alias_lldecl = this.predefine_without_aliases(aliasee_instance, attrs, linkage, visibility, symbol_name.name);

    const fn_abi: FnAbi<Ty> = this.fn_abi_of_instance(aliasee_instance, RawList.empty<Ty>());

    // both the alias and the aliasee have the same ty
    const fn_ty = fn_abi.llvm_type(this);
    const start_llbb = Builder.append_block_inherent(this, alias_lldecl, "start");
    const start_bx = Builder.build_inherent(this, start_llbb);

    const num_params = llvm.count_params(alias_lldecl);
    const args_: Value[] = [];
    for (let index = 0; index < num_params; index++) {
      args_.push(llvm.get_param(alias_lldecl, index));
    }

    // For an indirect return, the alias's own first parameter is the
    // caller-provided return slot: forward it to the aliasee as such.
    let return_slot: ReturnSlot<Value>;
    let args: readonly Value[];
    if (fn_abi.ret.is_indirect()) {
      // let (sret_ptr, rest) = args.split_first().unwrap();
      assert(args_.length > 0, "called `Option::unwrap()` on a `None` value");
      const [sret_ptr, ...rest] = args_;
      return_slot = { $: "Indirect", _0: sret_ptr! };
      args = rest;
    } else {
      return_slot = { $: "Direct" };
      args = args_;
    }
    const call = start_bx.call(fn_ty, attrs, fn_abi, aliasee, return_slot, args, undefined, aliasee_instance);

    const mode = fn_abi.ret.mode;
    switch (mode.$) {
      case "Ignore":
      case "Indirect":
        start_bx.ret_void_inherent();
        break;
      case "Direct":
      case "Pair":
      case "Cast":
        start_bx.ret_inherent(call);
        break;
      case "IndirectUnsized":
        bug("unsized returns are not supported");
    }
  }
};

/// A definition or declaration can be assumed to be local to a group of
/// libraries that form a single DSO or executable.
/// Marks the local as DSO if so.
// rustc: compiler/rustc_codegen_llvm/src/mono_item.rs:233 assume_dso_local
CodegenCx.prototype.assume_dso_local = function (this: CodegenCx, llval: Value, is_declaration: boolean): boolean {
  const assume = this.should_assume_dso_local(llval, is_declaration);
  if (assume) {
    llvm.set_dso_local(llval);
  }
  return assume;
};

// rustc: compiler/rustc_codegen_llvm/src/mono_item.rs:241 set_visibility
CodegenCx.prototype.set_visibility = function (this: CodegenCx, lldecl: Value, linkage: Linkage, visibility: Visibility): void {
  // If we're compiling the compiler-builtins crate, i.e., the equivalent of
  // compiler-rt, then we want to implicitly compile everything with hidden
  // visibility as we're going to link this object all over the place but
  // don't want the symbols to get exported.
  if (linkage !== "Internal" && this.tcx.is_compiler_builtins(LOCAL_CRATE)) {
    llvm.set_visibility(lldecl, "Hidden");
  } else {
    llvm.set_visibility(lldecl, base.visibility_to_llvm(visibility));
  }
};

// rustc: compiler/rustc_codegen_llvm/src/mono_item.rs:253 should_assume_dso_local
CodegenCx.prototype.should_assume_dso_local = function (this: CodegenCx, llval: Value, is_declaration: boolean): boolean {
  const linkage = llvm.get_linkage(llval);
  const visibility = llvm.get_visibility(llval);

  if (linkage === "InternalLinkage" || linkage === "PrivateLinkage") {
    return true;
  }

  if (visibility !== "Default" && linkage !== "ExternalWeakLinkage") {
    return true;
  }

  // Symbols from executables can't really be imported any further.
  const all_exe = this.tcx.crate_types().every((ty) => ty === "Executable");
  const is_declaration_for_linker = is_declaration || linkage === "AvailableExternallyLinkage";
  if (all_exe && !is_declaration_for_linker) {
    return true;
  }

  // PowerPC64 prefers TOC indirection to avoid copy relocations.
  if (this.tcx.sess.target.arch.$ === "PowerPC64") {
    return false;
  }

  // Match clang by only supporting COFF and ELF for now.
  if (this.tcx.sess.target.is_like_darwin) {
    return false;
  }

  // With pie relocation model, calls of functions defined in the translation
  // unit can use copy relocations.
  if (this.tcx.sess.relocation_model() === "Pie" && !is_declaration) {
    return true;
  }

  // Thread-local variables generally don't support copy relocations.
  const v = llvm.LLVMIsAGlobalVariable(llval);
  const is_thread_local_var = v !== undefined && llvm.LLVMIsThreadLocal(v).is_true();
  if (is_thread_local_var) {
    return false;
  }

  // Respect the direct-access-external-data to override default behavior if present.
  const direct = this.tcx.sess.direct_access_external_data();
  if (direct !== undefined) {
    return direct;
  }

  // Static relocation model should force copy relocations everywhere.
  return this.tcx.sess.relocation_model() === "Static";
};
