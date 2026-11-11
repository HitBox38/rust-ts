// Port of compiler/rustc_codegen_ssa/src/traits/consts.rs (lane ssa-contract). Conventions: backend.ts's header.
//
// PORT (ssa-contract): integer widths (PORTING §5). `i8`..`i32`, `u8`, `u32` and `f64` are `number`; `i64`, `u64`
// and `u128` are `bigint`, since these constructors take any value of their type (`const_u64(u64::MAX)`). The
// `Option<u64>`/`Option<u128>` read-backs are `bigint | undefined`.
import type { Scalar as abi_Scalar, Size } from "../../rustc_abi/lib.ts";
import type { Scalar } from "../../rustc_middle/mir/interpret/value.ts";
import type { BackendTypes, BackendTypesOf } from "./backend.ts";
import type { PointerAuthSchema } from "./misc.ts";

// rustc-trait: compiler/rustc_codegen_ssa/src/traits/consts.rs:7 ConstCodegenMethods
export interface ConstCodegenMethods<B extends BackendTypes> extends BackendTypesOf<B> {
  // Constant constructors
  // rustc: compiler/rustc_codegen_ssa/src/traits/consts.rs:9 const_null
  const_null(t: B["Type"]): B["Value"];
  /// Generate an uninitialized value (matching uninitialized memory in MIR).
  /// Whether memory is initialized or not is tracked byte-for-byte.
  // rustc: compiler/rustc_codegen_ssa/src/traits/consts.rs:12 const_undef
  const_undef(t: B["Type"]): B["Value"];
  /// Generate a fake value. Poison always affects the entire value, even if just a single byte is
  /// poison. This can only be used in codepaths that are already UB, i.e., UB-free Rust code
  /// (including code that e.g. copies uninit memory with `MaybeUninit`) can never encounter a
  /// poison value.
  // rustc: compiler/rustc_codegen_ssa/src/traits/consts.rs:17 const_poison
  const_poison(t: B["Type"]): B["Value"];

  // rustc: compiler/rustc_codegen_ssa/src/traits/consts.rs:19 const_bool
  const_bool(val: boolean): B["Value"];

  // rustc: compiler/rustc_codegen_ssa/src/traits/consts.rs:21 const_i8
  const_i8(i: number): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/consts.rs:22 const_i16
  const_i16(i: number): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/consts.rs:23 const_i32
  const_i32(i: number): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/consts.rs:24 const_i64
  const_i64(i: bigint): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/consts.rs:25 const_int
  const_int(t: B["Type"], i: bigint): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/consts.rs:26 const_u8
  const_u8(i: number): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/consts.rs:27 const_u32
  const_u32(i: number): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/consts.rs:28 const_u64
  const_u64(i: bigint): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/consts.rs:29 const_u128
  const_u128(i: bigint): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/consts.rs:30 const_usize
  const_usize(i: bigint): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/consts.rs:31 const_uint
  const_uint(t: B["Type"], i: bigint): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/consts.rs:32 const_uint_big
  const_uint_big(t: B["Type"], u: bigint): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/consts.rs:33 const_real
  const_real(t: B["Type"], val: number): B["Value"];

  // rustc: compiler/rustc_codegen_ssa/src/traits/consts.rs:35 const_str
  const_str(s: string): [B["Value"], B["Value"]];
  // rustc: compiler/rustc_codegen_ssa/src/traits/consts.rs:36 const_struct
  const_struct(elts: readonly B["Value"][], packed: boolean): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/consts.rs:37 const_vector
  const_vector(elts: readonly B["Value"][]): B["Value"];

  // rustc: compiler/rustc_codegen_ssa/src/traits/consts.rs:39 const_to_opt_uint
  const_to_opt_uint(v: B["Value"]): bigint | undefined;
  // rustc: compiler/rustc_codegen_ssa/src/traits/consts.rs:40 const_to_opt_u128
  const_to_opt_u128(v: B["Value"], sign_ext: boolean): bigint | undefined;

  // (provided) traits/consts.rs:42 scalar_to_backend -> ConstCodegenMethods_provided.scalar_to_backend
  scalar_to_backend(cv: Scalar, layout: abi_Scalar, llty: B["Type"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/consts.rs:45 scalar_to_backend_with_pac
  scalar_to_backend_with_pac(cv: Scalar, layout: abi_Scalar, llty: B["Type"], schema: PointerAuthSchema | undefined): B["Value"];

  // rustc: compiler/rustc_codegen_ssa/src/traits/consts.rs:53 const_ptr_byte_offset
  const_ptr_byte_offset(val: B["Value"], offset: Size): B["Value"];
}

/** The provided methods of `ConstCodegenMethods` (PORTING §8; `self` first). */
export const ConstCodegenMethods_provided = {
  // rustc: compiler/rustc_codegen_ssa/src/traits/consts.rs:42 scalar_to_backend
  scalar_to_backend<B extends BackendTypes>(self: ConstCodegenMethods<B>, cv: Scalar, layout: abi_Scalar, llty: B["Type"]): B["Value"] {
    return self.scalar_to_backend_with_pac(cv, layout, llty, undefined);
  },
};
