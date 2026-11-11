// compiler/rustc_codegen_llvm/src/abi.rs: the SKELETON (lane cg-contract). The fill lane cg-abi-consts (plan-m7 §8 wave 41) owns this file and ports
// abi.rs here, replacing each `Stub (cg-contract)` with its port.
//
// What is here: the fns other fill lanes call (review F2), `impl ArgAbiBuilderMethods for Builder` and `impl AbiBuilderMethods for Builder`, as typed stubs attached with PORTING §5's extension pattern (lib.ts imports this file after the
// class's own module).
// Load order: rustc_target through its crate root first (as src/rust_ts/codegen_backend.ts does): entered from callconv/mod.ts,
// spec/json.ts reads spec/mod.ts's bindings before they exist.
import "../rustc_target/lib.ts";
import { Reg } from "../rustc_abi/lib.ts";
import type { PlaceRef } from "../rustc_codegen_ssa/mir/place.ts";
import type { AbiBuilderMethods } from "../rustc_codegen_ssa/traits/abi.ts";
import type { ArgAbiBuilderMethods } from "../rustc_codegen_ssa/traits/type_.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import type { ArgAbi } from "../rustc_target/callconv/mod.ts";
import type { MutRef } from "../std/mut_ref.ts";
import type { CallConv, Type, Value } from "./llvm/mod.ts";
import type { CanonAbi } from "../rustc_abi/canon_abi.ts";
import type { Instance } from "../rustc_middle/ty/instance.ts";
import type { Session } from "../rustc_session/session.ts";
import { CastTarget, FnAbi } from "../rustc_target/callconv/mod.ts";
import type { CodegenCx } from "./context.ts";
import { unported } from "../std/panic.ts";
import { Builder } from "./builder.ts";

// PORT (cg-contract): the crate-internal extension traits on foreign classes (`trait LlvmType` for `Reg` / `CastTarget`,
// `trait FnAbiLlvmExt` for `FnAbi`) are `declare module` augmentations of those classes plus prototype assignments (the miri
// decision C2 form): `fn_abi.llvm_type(cx)` reads as upstream. The traits' other methods are added the same way.

// ---- impl LlvmType for Reg (abi.rs:139): Cross-lane surface (cg-contract, review F2) ----
declare module "../rustc_abi/callconv/reg.ts" {
  interface Reg {
    llvm_type(cx: CodegenCx): Type;
  }
}

// Stub (cg-contract): llvm_type (abi.rs:140)
Reg.prototype.llvm_type = function (this: Reg, _cx: CodegenCx): Type {
  return unported("cg-abi-consts: compiler/rustc_codegen_llvm/src/abi.rs llvm_type");
};

// ---- impl LlvmType for CastTarget (abi.rs:182): Cross-lane surface (cg-contract, review F2) ----
declare module "../rustc_target/callconv/mod.ts" {
  interface CastTarget {
    llvm_type(cx: CodegenCx): Type;
  }
}

// Stub (cg-contract): llvm_type (abi.rs:183)
CastTarget.prototype.llvm_type = function (this: CastTarget, _cx: CodegenCx): Type {
  return unported("cg-abi-consts: compiler/rustc_codegen_llvm/src/abi.rs llvm_type");
};

// ---- impl ArgAbiBuilderMethods for Builder (abi.rs:327) ----
declare module "./builder.ts" {
  interface Builder {
    store_fn_arg(arg_abi: ArgAbi<Ty>, idx: MutRef<number>, dst: PlaceRef<Value>): void;
    store_arg(arg_abi: ArgAbi<Ty>, val: Value, dst: PlaceRef<Value>): void;
  }
}

// Stub (cg-contract): ArgAbiBuilderMethods::store_fn_arg
Builder.prototype.store_fn_arg = function (this: Builder, _arg_abi: ArgAbi<Ty>, _idx: MutRef<number>, _dst: PlaceRef<Value>): void {
  return unported("cg-abi-consts: compiler/rustc_codegen_llvm/src/abi.rs store_fn_arg");
};

// Stub (cg-contract): ArgAbiBuilderMethods::store_arg
Builder.prototype.store_arg = function (this: Builder, _arg_abi: ArgAbi<Ty>, _val: Value, _dst: PlaceRef<Value>): void {
  return unported("cg-abi-consts: compiler/rustc_codegen_llvm/src/abi.rs store_arg");
};

// ---- impl FnAbiLlvmExt for FnAbi (abi.rs:363): Cross-lane surface (cg-contract, review F2) ----
declare module "../rustc_target/callconv/mod.ts" {
  interface FnAbi<Ty> {
    llvm_type(cx: CodegenCx): Type;
    ptr_to_llvm_type(cx: CodegenCx): Type;
    llvm_cconv(cx: CodegenCx): CallConv;
    apply_attrs_llfn(cx: CodegenCx, llfn: Value, instance: Instance | undefined): void;
    apply_attrs_callsite(bx: Builder, callsite: Value): void;
  }
}

// Stub (cg-contract): llvm_type (abi.rs:364)
FnAbi.prototype.llvm_type = function (this: FnAbi<Ty>, _cx: CodegenCx): Type {
  return unported("cg-abi-consts: compiler/rustc_codegen_llvm/src/abi.rs llvm_type");
};

// Stub (cg-contract): ptr_to_llvm_type (abi.rs:451)
FnAbi.prototype.ptr_to_llvm_type = function (this: FnAbi<Ty>, _cx: CodegenCx): Type {
  return unported("cg-abi-consts: compiler/rustc_codegen_llvm/src/abi.rs ptr_to_llvm_type");
};

// Stub (cg-contract): llvm_cconv (abi.rs:455)
FnAbi.prototype.llvm_cconv = function (this: FnAbi<Ty>, _cx: CodegenCx): CallConv {
  return unported("cg-abi-consts: compiler/rustc_codegen_llvm/src/abi.rs llvm_cconv");
};

// Stub (cg-contract): apply_attrs_llfn (abi.rs:459)
FnAbi.prototype.apply_attrs_llfn = function (this: FnAbi<Ty>, _cx: CodegenCx, _llfn: Value, _instance: Instance | undefined): void {
  return unported("cg-abi-consts: compiler/rustc_codegen_llvm/src/abi.rs apply_attrs_llfn");
};

// Stub (cg-contract): apply_attrs_callsite (abi.rs:640)
FnAbi.prototype.apply_attrs_callsite = function (this: FnAbi<Ty>, _bx: Builder, _callsite: Value): void {
  return unported("cg-abi-consts: compiler/rustc_codegen_llvm/src/abi.rs apply_attrs_callsite");
};

// ---- impl AbiBuilderMethods for Builder (abi.rs:765) ----
declare module "./builder.ts" {
  interface Builder {
    get_param(index: number): Value;
  }
}

// Stub (cg-contract): AbiBuilderMethods::get_param
Builder.prototype.get_param = function (this: Builder, _index: number): Value {
  return unported("cg-abi-consts: compiler/rustc_codegen_llvm/src/abi.rs get_param");
};

// Cross-lane surface (cg-contract, review F2)
// Stub (cg-contract): to_llvm_calling_convention (abi.rs:773)
export function to_llvm_calling_convention(_sess: Session, _abi: CanonAbi): CallConv {
  return unported("cg-abi-consts: compiler/rustc_codegen_llvm/src/abi.rs to_llvm_calling_convention");
}
