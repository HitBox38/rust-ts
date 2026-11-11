//! The Rust compiler.
//!
//! # Note
//!
//! This API is completely unstable and subject to change.
//
// Port of compiler/rustc_codegen_llvm/src/lib.rs (lane cg-contract).
//
// PORT (cg-contract):
// - The `mod` items are private, so the crate's only exports are `pub use`'s. Importers outside the crate import this file.
// - PORTING §5's extension pattern: context.ts (`GenericCx`, `SimpleCx`, `CodegenCx`) and builder.ts (`Builder`) never
//   import the files that attach trait methods to them; this file imports those files for their side effects, then runs
//   the auto-deref installers (context.ts `install_deref_methods`), which must see every method attached.
// - Files of modules out of M7 (`typetree`, `builder::autodiff`, `builder::gpu_offload`, `llvm::enzyme_ffi`,
//   `llvm::offload_ffi`; harness/scope.json) do not exist; `coverageinfo` holds only what the skeleton needs.
// - Not yet imported by any other crate: rustc_interface still constructs src/rust_ts/codegen_backend.ts's stand-in
//   (plan-m7 wave 40: the backend is not registered until codegen reaches the oracle).

// tidy-alphabetical-start
// #![feature(extern_types)]
// #![feature(file_buffered)]
// #![feature(impl_trait_in_assoc_type)]
// #![feature(iter_intersperse)]
// #![feature(macro_derive)]
// #![feature(once_cell_try)]
// #![feature(try_blocks)]
// tidy-alphabetical-end

import { Builder } from "./builder.ts";
import { CodegenCx, SimpleCx, install_deref_methods } from "./context.ts";

export { LlvmCodegenBackend, ModuleLlvm } from "./back/llvm_backend.ts";

// mod abi;
import "./abi.ts";
// mod allocator;
// mod asm;
import "./asm.ts";
// mod attributes;
// mod back;
// mod base;
// mod builder;
// mod callee;
// mod common;
import "./common.ts";
// mod consts;
import "./consts.ts";
// mod context;
// mod coverageinfo;
import "./coverageinfo/mod.ts";
// mod debuginfo;
import "./debuginfo/mod.ts";
// mod declare;
// mod diagnostics;
// mod intrinsic;
import "./intrinsic.ts";
// mod llvm;
// mod llvm_util;
// mod macros;
// mod mono_item;
import "./mono_item.ts";
// mod type_;
import "./type_.ts";
// mod type_of;
// mod typetree;
// mod va_arg;
// mod value;

// Auto-deref (context.ts, builder.ts headers): `CodegenCx` -> `FullCx` -> `SimpleCx` for `impl SimpleCx`'s methods, then
// `Builder` -> `CodegenCx` for everything `Builder` lacks (after the first, so it also forwards what that one added).
install_deref_methods(CodegenCx, SimpleCx, (cx: CodegenCx) => cx._0.scx);
install_deref_methods(Builder, CodegenCx, (bx: Builder) => bx.cx_);
