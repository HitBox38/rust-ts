// TEMPORARY (lane ssa-operand-place): a stand-in for the parts of `mir/mod.ts` and `mir/locals.ts` that lane ssa-mir-core
// ports in parallel (wave 40m), so that place.ts and operand.ts typecheck and their unit tests run before the merge.
// Shapes as agreed with ssa-mir-core (2026-11-12): `FunctionCx<B, Cx, Bx>`, `LocalRef<V>`, `Locals<V>`.
//
// AT MERGE (root): delete this file; in place.ts, operand.ts and their tests repoint `./mir_core_shim.ts` to `./mod.ts`
// (`FunctionCx`, `LocalRef`) and `./locals.ts` (`Locals`), and change the two `declare module "./mir_core_shim.ts"` to
// `declare module "./mod.ts"`; in mod.ts, right after `class FunctionCx`, call
// `install_FunctionCx_operand(FunctionCx); install_FunctionCx_place(FunctionCx);` (as the bottom of this file does).
// Not ported code: no markers.
import type { Body, Local } from "../../rustc_middle/mir/mod.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { unported } from "../../std/panic.ts";
import type { BackendTypes } from "../traits/backend.ts";
import type { BuilderMethods } from "../traits/builder.ts";
import type { CodegenMethods } from "../traits/mod.ts";
import { install_FunctionCx_operand, type OperandRef } from "./operand.ts";
import { install_FunctionCx_place, type PlaceRef } from "./place.ts";

/** Stand-in for mir/mod.rs `LocalRef` (ssa-mir-core). */
export type LocalRef<V> =
  | { readonly $: "Place"; _0: PlaceRef<V> }
  | { readonly $: "UnsizedPlace"; _0: PlaceRef<V> }
  | { readonly $: "Operand"; _0: OperandRef<V> }
  | { readonly $: "PendingOperand" };
export const LocalRef = {
  PendingOperand: Object.freeze({ $: "PendingOperand" }) as { readonly $: "PendingOperand" },
} as const;

/** Stand-in for mir/locals.rs `Locals` (ssa-mir-core); `self.locals[local]` is `index(local)`. */
export class Locals<V> {
  constructor(public values: LocalRef<V>[]) {}
  index(local: Local): LocalRef<V> {
    return this.values[local]!;
  }
}

/** Stand-in for mir/mod.rs `FunctionCx` (ssa-mir-core): only the fields place.ts and operand.ts read. */
export class FunctionCx<B extends BackendTypes, Cx extends CodegenMethods<B> = CodegenMethods<B>, Bx extends BuilderMethods<B, Cx> = BuilderMethods<B, Cx>> {
  declare readonly __bx?: Bx;
  constructor(
    public mir: Body,
    public cx: Cx,
    public locals: Locals<B["Value"]>,
  ) {}

  monomorphize<T>(_value: T, _d_T: TypeFoldable<T>): T {
    return unported("ssa-mir-core: compiler/rustc_codegen_ssa/src/mir/mod.rs monomorphize");
  }
}

install_FunctionCx_operand(FunctionCx);
install_FunctionCx_place(FunctionCx);
