// compiler/rustc_codegen_llvm/src/abi.rs: the SKELETON (lane cg-contract). The fill lane cg-abi-consts (plan-m7 §8 wave 41) owns this file and ports
// abi.rs here, replacing each `Stub (cg-contract)` with its port.
//
// What is here: `impl ArgAbiBuilderMethods for Builder` and `impl AbiBuilderMethods for Builder`, as typed stubs attached with PORTING §5's extension pattern (lib.ts imports this file after the
// class's own module).
import type { PlaceRef } from "../rustc_codegen_ssa/mir/place.ts";
import type { AbiBuilderMethods } from "../rustc_codegen_ssa/traits/abi.ts";
import type { ArgAbiBuilderMethods } from "../rustc_codegen_ssa/traits/type_.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import type { ArgAbi } from "../rustc_target/callconv/mod.ts";
import type { MutRef } from "../std/mut_ref.ts";
import type { Value } from "./llvm/mod.ts";
import { unported } from "../std/panic.ts";
import { Builder } from "./builder.ts";

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
