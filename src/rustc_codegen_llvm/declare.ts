//! Declare various LLVM values.
//!
//! Prefer using functions and methods from this module rather than calling LLVM
//! functions directly. These functions do some additional work to ensure we do
//! the right thing given the preconceptions of codegen.
//!
//! Some useful guidelines:
//!
//! * Use declare_* family of methods if you are declaring, but are not
//!   interested in defining the Value they return.
//! * Use define_* family of methods when you might be defining the Value.
//! * When in doubt, define.
// Port of compiler/rustc_codegen_llvm/src/declare.rs (skeleton: lane cg-contract; bodies: lane cg-types-attrs, plan-m7 §8 wave 41).
//
// A `&SimpleCx` parameter given a `CodegenCx` upstream is deref-coerced: callers pass `cx.scx`. `(**self).borrow().llmod` and
// `cx.llmod` are the accessor `llmod()` (type_.rs:156), which reads the same field.
//
// PORT (cg-types-attrs):
// - `name.as_ptr(), name.len()` is the string and its UTF-8 length (`utf8_len`).
// - `tracing::debug!` lines are comments.
// - `rustc_sanitizers` (`cfi`, `kcfi`) is out of scope (harness/scope.json): the `-Zsanitizer=cfi` / `kcfi` branches of
//   `declare_fn` stop where they first reach it.
import type { AddressSpace } from "../rustc_abi/lib.ts";
import type { Instance } from "../rustc_middle/ty/instance.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import type { FnAbi } from "../rustc_target/callconv/mod.ts";
import { unported } from "../std/panic.ts";
import { utf8_len } from "../std/str.ts";
import * as attributes from "./attributes.ts";
import { CodegenCx, GenericCx, type SCxBorrow, type SimpleCx } from "./context.ts";
import * as llvm from "./llvm/mod.ts";
import { type Attribute, AttributeKind, AttributeKind_impl, AttributePlace, CallConv, FromGeneric_for_Visibility, type Type, type UnnamedAddr, type Value, Visibility } from "./llvm/mod.ts";

/// Declare a function with a SimpleCx.
///
/// If there’s a value with the same name already declared, the function will
/// update the declaration and return existing Value instead.
// rustc: compiler/rustc_codegen_llvm/src/declare.rs:36 declare_simple_fn
export function declare_simple_fn(cx: SimpleCx, name: string, callconv: CallConv, unnamed: UnnamedAddr, visibility: Visibility, ty: Type): Value {
  // debug!("declare_simple_fn(name={:?}, ty={:?})", name, ty);
  const llfn = llvm.LLVMGetOrInsertFunction(cx.llmod(), name, utf8_len(name), ty);

  llvm.SetFunctionCallConv(llfn, callconv);
  llvm.set_unnamed_address(llfn, unnamed);
  llvm.set_visibility(llfn, visibility);

  return llfn;
}

/// Declare a function.
///
/// If there’s a value with the same name already declared, the function will
/// update the declaration and return existing Value instead.
// rustc: compiler/rustc_codegen_llvm/src/declare.rs:58 declare_raw_fn
export function declare_raw_fn(cx: CodegenCx, name: string, callconv: CallConv, unnamed: UnnamedAddr, visibility: Visibility, ty: Type): Value {
  // debug!("declare_raw_fn(name={:?}, ty={:?})", name, ty);
  const llfn = declare_simple_fn(cx.scx, name, callconv, unnamed, visibility, ty);

  const attrs: Attribute[] = [];

  if (cx.sess().target.is_like_gpu) {
    // Conservatively apply convergent to all functions in case they may call
    // a convergent function. Rely on LLVM to optimize away the unnecessary
    // convergent attributes.
    attrs.push(AttributeKind_impl.create_attr(AttributeKind.Convergent, cx.llcx()));
  }

  if (cx.tcx.sess.opts.cg.no_redzone ?? cx.tcx.sess.target.disable_redzone) {
    attrs.push(AttributeKind_impl.create_attr(AttributeKind.NoRedZone, cx.llcx()));
  }

  const non_lazy_bind = attributes.non_lazy_bind_attr(cx.scx, cx.tcx.sess);
  if (non_lazy_bind !== undefined) attrs.push(non_lazy_bind);

  attributes.apply_to_llfn(llfn, AttributePlace.Function, attrs);

  return llfn;
}

// ---- impl<'ll, CX: Borrow<SCx<'ll>>> GenericCx<'ll, CX> (declare.rs:89) ----
declare module "./context.ts" {
  interface GenericCx<T extends SCxBorrow> {
    declare_global(name: string, ty: Type): Value;
    declare_global_in_addrspace(name: string, ty: Type, addr_space: AddressSpace): Value;
  }
}

/// Declare a global value.
///
/// If there’s a value with the same name already declared, the function will
/// return its Value instead.
// rustc: compiler/rustc_codegen_llvm/src/declare.rs:94 declare_global
GenericCx.prototype.declare_global = function (this: GenericCx<SCxBorrow>, name: string, ty: Type): Value {
  // debug!("declare_global(name={:?})", name);
  return llvm.LLVMRustGetOrInsertGlobal(this.deref().borrow().llmod, name, utf8_len(name), ty);
};

/// Declare a global value in a specific address space.
///
/// If there’s a value with the same name already declared, the function will
/// return its Value instead.
// rustc: compiler/rustc_codegen_llvm/src/declare.rs:105 declare_global_in_addrspace
GenericCx.prototype.declare_global_in_addrspace = function (this: GenericCx<SCxBorrow>, name: string, ty: Type, addr_space: AddressSpace): Value {
  // debug!("declare_global(name={name:?}, addrspace={addr_space:?})");
  // `addr_space.0`: `AddressSpace` is a branded number.
  return llvm.LLVMRustGetOrInsertGlobalInAddrspace(this.deref().borrow().llmod, name, utf8_len(name), ty, addr_space);
};

// ---- impl<'ll, 'tcx> CodegenCx<'ll, 'tcx> (declare.rs:124) ----
declare module "./context.ts" {
  interface CodegenCx {
    declare_cfn(name: string, unnamed: UnnamedAddr, fn_type: Type): Value;
    declare_entry_fn(name: string, callconv: CallConv, unnamed: UnnamedAddr, fn_type: Type): Value;
    declare_fn(name: string, fn_abi: FnAbi<Ty>, instance: Instance | undefined): Value;
  }
}

/// Declare a C ABI function.
///
/// Only use this for foreign function ABIs and glue. For Rust functions use
/// `declare_fn` instead.
///
/// If there’s a value with the same name already declared, the function will
/// update the declaration and return existing Value instead.
// rustc: compiler/rustc_codegen_llvm/src/declare.rs:132 declare_cfn
CodegenCx.prototype.declare_cfn = function (this: CodegenCx, name: string, unnamed: UnnamedAddr, fn_type: Type): Value {
  // Visibility should always be default for declarations, otherwise the linker may report an
  // error.
  return declare_raw_fn(this, name, CallConv.CCallConv, unnamed, Visibility.Default, fn_type);
};

/// Declare an entry Function
///
/// The ABI of this function can change depending on the target (although for now the same as
/// `declare_cfn`)
///
/// If there’s a value with the same name already declared, the function will
/// update the declaration and return existing Value instead.
// rustc: compiler/rustc_codegen_llvm/src/declare.rs:150 declare_entry_fn
CodegenCx.prototype.declare_entry_fn = function (this: CodegenCx, name: string, callconv: CallConv, unnamed: UnnamedAddr, fn_type: Type): Value {
  const visibility = FromGeneric_for_Visibility.from_generic(this.tcx.sess.default_visibility());
  return declare_raw_fn(this, name, callconv, unnamed, visibility, fn_type);
};

/// Declare a Rust function.
///
/// If there’s a value with the same name already declared, the function will
/// update the declaration and return existing Value instead.
// rustc: compiler/rustc_codegen_llvm/src/declare.rs:165 declare_fn
CodegenCx.prototype.declare_fn = function (this: CodegenCx, name: string, fn_abi: FnAbi<Ty>, instance: Instance | undefined): Value {
  // debug!("declare_rust_fn(name={:?}, fn_abi={:?})", name, fn_abi);

  // Function addresses in Rust are never significant, allowing functions to
  // be merged.
  const llfn = declare_raw_fn(this, name, fn_abi.llvm_cconv(this), "Global", Visibility.Default, fn_abi.llvm_type(this));
  fn_abi.apply_attrs_llfn(this, llfn, instance);

  if (this.tcx.sess.is_sanitizer_cfi_enabled()) {
    if (instance !== undefined) {
      // let mut typeids = FxIndexSet::default();
      // for options in [GENERALIZE_POINTERS, NORMALIZE_INTEGERS, USE_CONCRETE_SELF].into_iter().powerset()
      //     .map(cfi::TypeIdOptions::from_iter)
      // {
      //     let typeid = cfi::typeid_for_instance(self.tcx, instance, options);
      //     if typeids.insert(typeid.clone()) {
      //         self.add_type_metadata(llfn, typeid.as_bytes());
      //     }
      // }
      return unported("rustc_sanitizers::cfi::typeid_for_instance (rustc_sanitizers out of scope)");
    } else {
      // for options in [GENERALIZE_POINTERS, NORMALIZE_INTEGERS].into_iter().powerset()
      //     .map(cfi::TypeIdOptions::from_iter)
      // {
      //     let typeid = cfi::typeid_for_fnabi(self.tcx, fn_abi, options);
      //     self.add_type_metadata(llfn, typeid.as_bytes());
      // }
      return unported("rustc_sanitizers::cfi::typeid_for_fnabi (rustc_sanitizers out of scope)");
    }
  }

  if (this.tcx.sess.is_sanitizer_kcfi_enabled()) {
    // LLVM KCFI does not support multiple !kcfi_type attachments
    // let mut options = kcfi::TypeIdOptions::empty();
    // if self.tcx.sess.is_sanitizer_cfi_generalize_pointers_enabled() {
    //     options.insert(kcfi::TypeIdOptions::GENERALIZE_POINTERS);
    // }
    // if self.tcx.sess.is_sanitizer_cfi_normalize_integers_enabled() {
    //     options.insert(kcfi::TypeIdOptions::NORMALIZE_INTEGERS);
    // }
    //
    // let kcfi_typeid = if let Some(instance) = instance {
    //     kcfi::typeid_for_instance(self.tcx, instance, options)
    // } else {
    //     kcfi::typeid_for_fnabi(self.tcx, fn_abi, options)
    // };
    // self.set_kcfi_type_metadata(llfn, kcfi_typeid);
    return unported("rustc_sanitizers::kcfi::TypeIdOptions (rustc_sanitizers out of scope)");
  }

  return llfn;
};

// ---- impl<'ll, CX: Borrow<SCx<'ll>>> GenericCx<'ll, CX> (declare.rs:239) ----
declare module "./context.ts" {
  interface GenericCx<T extends SCxBorrow> {
    define_global(name: string, ty: Type): Value | undefined;
    get_declared_value(name: string): Value | undefined;
    get_defined_value(name: string): Value | undefined;
  }
}

/// Declare a global with an intention to define it.
///
/// Use this function when you intend to define a global. This function will
/// return `None` if the name already has a definition associated with it. In that
/// case an error should be reported to the user, because it usually happens due
/// to user’s fault (e.g., misuse of `#[no_mangle]` or `#[export_name]` attributes).
// rustc: compiler/rustc_codegen_llvm/src/declare.rs:246 define_global
GenericCx.prototype.define_global = function (this: GenericCx<SCxBorrow>, name: string, ty: Type): Value | undefined {
  if (this.get_defined_value(name) !== undefined) {
    return undefined;
  } else {
    return this.declare_global(name, ty);
  }
};

/// Gets declared value by name.
// rustc: compiler/rustc_codegen_llvm/src/declare.rs:255 get_declared_value
GenericCx.prototype.get_declared_value = function (this: GenericCx<SCxBorrow>, name: string): Value | undefined {
  // debug!("get_declared_value(name={:?})", name);
  return llvm.LLVMRustGetNamedValue(this.llmod(), name, utf8_len(name));
};

/// Gets defined or externally defined (AvailableExternally linkage) value by
/// name.
// rustc: compiler/rustc_codegen_llvm/src/declare.rs:262 get_defined_value
GenericCx.prototype.get_defined_value = function (this: GenericCx<SCxBorrow>, name: string): Value | undefined {
  const val = this.get_declared_value(name);
  if (val === undefined) return undefined;
  const declaration = llvm.is_declaration(val);
  return !declaration ? val : undefined;
};
