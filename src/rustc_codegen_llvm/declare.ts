// compiler/rustc_codegen_llvm/src/declare.rs: the SKELETON (lane cg-contract). The fill lane cg-types-attrs (plan-m7 §8 wave
// 41) owns this file and ports declare.rs here, replacing each `Stub (cg-contract)` with its port.
//
// What is here: the fns of declare.rs that other fill lanes call (review F2), as typed stubs. A `&SimpleCx` parameter given a
// `CodegenCx` upstream is deref-coerced: callers pass `cx.scx`.
import type { AddressSpace } from "../rustc_abi/lib.ts";
import type { Instance } from "../rustc_middle/ty/instance.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import type { FnAbi } from "../rustc_target/callconv/mod.ts";
import { unported } from "../std/panic.ts";
import { CodegenCx, GenericCx, type SCxBorrow, type SimpleCx } from "./context.ts";
import type { CallConv, Type, UnnamedAddr, Value, Visibility } from "./llvm/mod.ts";

// Stub (cg-contract): declare_simple_fn (declare.rs:36)
export function declare_simple_fn(_cx: SimpleCx, _name: string, _callconv: CallConv, _unnamed: UnnamedAddr, _visibility: Visibility, _ty: Type): Value {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/declare.rs declare_simple_fn");
}

// Stub (cg-contract): declare_raw_fn (declare.rs:58)
export function declare_raw_fn(_cx: CodegenCx, _name: string, _callconv: CallConv, _unnamed: UnnamedAddr, _visibility: Visibility, _ty: Type): Value {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/declare.rs declare_raw_fn");
}

// ---- impl GenericCx (declare.rs:89): Cross-lane surface (cg-contract, review F2) ----
declare module "./context.ts" {
  interface GenericCx<T extends SCxBorrow> {
    declare_global(name: string, ty: Type): Value;
    declare_global_in_addrspace(name: string, ty: Type, addr_space: AddressSpace): Value;
  }
}

// Stub (cg-contract): declare_global (declare.rs:94)
GenericCx.prototype.declare_global = function (this: GenericCx<SCxBorrow>, _name: string, _ty: Type): Value {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/declare.rs declare_global");
};

// Stub (cg-contract): declare_global_in_addrspace (declare.rs:105)
GenericCx.prototype.declare_global_in_addrspace = function (this: GenericCx<SCxBorrow>, _name: string, _ty: Type, _addr_space: AddressSpace): Value {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/declare.rs declare_global_in_addrspace");
};

// ---- impl CodegenCx (declare.rs:124): Cross-lane surface (cg-contract, review F2) ----
declare module "./context.ts" {
  interface CodegenCx {
    declare_cfn(name: string, unnamed: UnnamedAddr, fn_type: Type): Value;
    declare_entry_fn(name: string, callconv: CallConv, unnamed: UnnamedAddr, fn_type: Type): Value;
    declare_fn(name: string, fn_abi: FnAbi<Ty>, instance: Instance | undefined): Value;
  }
}

// Stub (cg-contract): declare_cfn (declare.rs:132)
CodegenCx.prototype.declare_cfn = function (this: CodegenCx, _name: string, _unnamed: UnnamedAddr, _fn_type: Type): Value {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/declare.rs declare_cfn");
};

// Stub (cg-contract): declare_entry_fn (declare.rs:150)
CodegenCx.prototype.declare_entry_fn = function (this: CodegenCx, _name: string, _callconv: CallConv, _unnamed: UnnamedAddr, _fn_type: Type): Value {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/declare.rs declare_entry_fn");
};

// Stub (cg-contract): declare_fn (declare.rs:165)
CodegenCx.prototype.declare_fn = function (this: CodegenCx, _name: string, _fn_abi: FnAbi<Ty>, _instance: Instance | undefined): Value {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/declare.rs declare_fn");
};

// ---- impl GenericCx (declare.rs:239): Cross-lane surface (cg-contract, review F2) ----
declare module "./context.ts" {
  interface GenericCx<T extends SCxBorrow> {
    define_global(name: string, ty: Type): Value | undefined;
    get_declared_value(name: string): Value | undefined;
  }
}

// Stub (cg-contract): define_global (declare.rs:246)
GenericCx.prototype.define_global = function (this: GenericCx<SCxBorrow>, _name: string, _ty: Type): Value | undefined {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/declare.rs define_global");
};

// Stub (cg-contract): get_declared_value (declare.rs:255)
GenericCx.prototype.get_declared_value = function (this: GenericCx<SCxBorrow>, _name: string): Value | undefined {
  return unported("cg-types-attrs: compiler/rustc_codegen_llvm/src/declare.rs get_declared_value");
};
