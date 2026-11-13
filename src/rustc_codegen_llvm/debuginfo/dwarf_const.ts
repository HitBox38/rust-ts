// Port of compiler/rustc_codegen_llvm/src/debuginfo/dwarf_const.rs (lane cg-di-a, plan-m7 wave 40p).
//! Definitions of various DWARF-related constants.
//
// PORT (cg-di-a):
// - `declare_constant!(NAME: type)` is `pub(crate) const NAME: type = ::gimli::constants::NAME.0 as type;` plus a const
//   assertion that the cast kept the value. The values are gimli 0.34.0's (`Cargo.lock`'s version for rustc_codegen_llvm;
//   `gimli-0.34.0/src/constants.rs`, the line of each is cited). They all fit their type, so the assertion holds.
// - `c_uint` constants are `number`; `u64` constants are `bigint`, as `LLVMDIBuilderCreateExpression` takes `&[u64]` as
//   `readonly bigint[]` (ffi.ts).

/// Helper macro to let us redeclare gimli's constants as our own constants
/// with a different type, with less risk of copy-paste errors.
// macro_rules! declare_constant { .. } (expanded below)

// gimli constants.rs:252
export const DW_TAG_const_type: number = 0x26;

// DWARF languages.
// gimli constants.rs:896
export const DW_LANG_Rust: number = 0x001c;

// DWARF attribute type encodings.
// gimli constants.rs:767
export const DW_ATE_boolean: number = 0x02;
// gimli constants.rs:769
export const DW_ATE_float: number = 0x04;
// gimli constants.rs:770
export const DW_ATE_signed: number = 0x05;
// gimli constants.rs:772
export const DW_ATE_unsigned: number = 0x07;
// gimli constants.rs:785
export const DW_ATE_UTF: number = 0x10;

// DWARF expression operators.
// gimli constants.rs:1153
export const DW_OP_deref: bigint = 0x06n;
// gimli constants.rs:1181
export const DW_OP_plus_uconst: bigint = 0x23n;
/// Defined by LLVM in `llvm/include/llvm/BinaryFormat/Dwarf.h`.
/// Double-checked by a static assertion in `RustWrapper.cpp`.
export const DW_OP_LLVM_fragment: bigint = 0x1000n;
export const DW_OP_constu: bigint = 0x10n;
export const DW_OP_minus: bigint = 0x1cn;
export const DW_OP_mul: bigint = 0x1en;
export const DW_OP_bregx: bigint = 0x92n;
// It describes the actual value of a source variable which might not exist in registers or in memory.
export const DW_OP_stack_value: bigint = 0x9fn;
