// Port of compiler/rustc_codegen_ssa/src/traits/intrinsic.rs (lane ssa-contract). Conventions: backend.ts's header.
import type { Instance } from "../../rustc_middle/ty/instance.ts";
import type { TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import type { Span } from "../../rustc_span/lib.ts";
import type { RetagInfo } from "../lib.ts";
import type { IntrinsicResult } from "../mir/mod.ts";
import type { OperandRef } from "../mir/operand.ts";
import type { PlaceValue } from "../mir/place.ts";
import type { BackendTypes, BackendTypesOf } from "./backend.ts";

// rustc-trait: compiler/rustc_codegen_ssa/src/traits/intrinsic.rs:10 IntrinsicCallBuilderMethods
export interface IntrinsicCallBuilderMethods<B extends BackendTypes> extends BackendTypesOf<B> {
  /// Higher-level interface to emitting calls to intrinsics
  ///
  /// Remember to add all intrinsics here, in `compiler/rustc_hir_analysis/src/check/mod.rs`,
  /// and in `library/core/src/intrinsics.rs`; if you need access to any LLVM intrinsics,
  /// add them to `compiler/rustc_codegen_llvm/src/context.rs`.
  /// Returns `Fallback` if another instance should be called instead. This is used to invoke
  /// intrinsic default bodies in case an intrinsic is not implemented by the backend.
  ///
  /// The `result_place` will be provided for things that weren't `LocalKind::SSA`.
  /// If you need it for more things, see `intrinsic_call_expects_place_always`.
  ///
  /// NOTE: allowed to call [`BuilderMethods::call`]
  ///
  /// [`BuilderMethods::call`]: super::builder::BuilderMethods::call
  // rustc: compiler/rustc_codegen_ssa/src/traits/intrinsic.rs:25 codegen_intrinsic_call
  codegen_intrinsic_call(
    instance: Instance,
    args: readonly OperandRef<B["Value"]>[],
    result_layout: TyAndLayout,
    result_place: PlaceValue<B["Value"]> | undefined,
    span: Span,
  ): IntrinsicResult<B["Value"]>;

  // rustc: compiler/rustc_codegen_ssa/src/traits/intrinsic.rs:34 codegen_llvm_intrinsic_call
  codegen_llvm_intrinsic_call(instance: Instance, args: readonly OperandRef<B["Value"]>[], is_cleanup: boolean): B["Value"];

  /// Ungracefully stop execution in the simplest way possible.
  // rustc: compiler/rustc_codegen_ssa/src/traits/intrinsic.rs:42 abort_immediate
  abort_immediate(): void;
  // rustc: compiler/rustc_codegen_ssa/src/traits/intrinsic.rs:43 assume
  assume(val: B["Value"]): void;
  // rustc: compiler/rustc_codegen_ssa/src/traits/intrinsic.rs:44 expect
  expect(cond: B["Value"], expected: boolean): B["Value"];
  /// Returns the number of bits set. The return type must be `u32`.
  // rustc: compiler/rustc_codegen_ssa/src/traits/intrinsic.rs:46 ctpop
  ctpop(val: B["Value"]): B["Value"];
  /// Trait method used to load a function while testing if it is associated with a type
  /// identifier.
  /** `vtable_byte_offset: u64`: an offset into a vtable, so a `number` (PORTING §5). */
  // rustc: compiler/rustc_codegen_ssa/src/traits/intrinsic.rs:49 type_checked_load
  type_checked_load(llvtable: B["Value"], vtable_byte_offset: number, typeid: Uint8Array): B["Value"];
  /// Trait method used to inject `va_start` on the "spoofed" `VaList` in
  /// Rust defined C-variadic functions.
  // rustc: compiler/rustc_codegen_ssa/src/traits/intrinsic.rs:57 va_start
  va_start(val: B["Value"]): void;
  /// Trait method used to retag a pointer stored within a place.
  // rustc: compiler/rustc_codegen_ssa/src/traits/intrinsic.rs:59 retag_mem
  retag_mem(place: B["Value"], info: RetagInfo<B["Value"]>): void;
  /// Trait method used to retag a pointer that has been loaded into a register.
  // rustc: compiler/rustc_codegen_ssa/src/traits/intrinsic.rs:61 retag_reg
  retag_reg(ptr: B["Value"], info: RetagInfo<B["Value"]>): B["Value"];
}
