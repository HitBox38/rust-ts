// compiler/rustc_codegen_llvm/src/asm.rs: the SKELETON (lane cg-contract). The fill lane cg-asm (plan-m7 §8 wave 43) owns this file and ports
// asm.rs here, replacing each `Stub (cg-contract)` with its port.
//
// What is here: `impl AsmBuilderMethods for Builder` and `impl AsmCodegenMethods for CodegenCx`, as typed stubs attached with PORTING §5's extension pattern (lib.ts imports this file after the
// class's own module).
import type { InlineAsmOptions, InlineAsmTemplatePiece } from "../rustc_ast/lib.ts";
import type { AsmBuilderMethods, AsmCodegenMethods, GlobalAsmOperandRef, InlineAsmOperandRef } from "../rustc_codegen_ssa/traits/asm.ts";
import type { Instance } from "../rustc_middle/ty/instance.ts";
import type { Span } from "../rustc_span/lib.ts";
import type { Funclet, LlvmTypes } from "./common.ts";
import type { BasicBlock } from "./llvm/mod.ts";
import { unported } from "../std/panic.ts";
import { Builder } from "./builder.ts";
import { CodegenCx } from "./context.ts";

// ---- impl AsmCodegenMethods for CodegenCx (asm.rs:411) ----
declare module "./context.ts" {
  interface CodegenCx {
    codegen_global_asm(template: readonly InlineAsmTemplatePiece[], operands: readonly GlobalAsmOperandRef[], options: InlineAsmOptions, line_spans: readonly Span[], extra_rust_target_features: readonly string[]): void;
    mangled_name(instance: Instance): string;
  }
}

// Stub (cg-contract): AsmCodegenMethods::codegen_global_asm
CodegenCx.prototype.codegen_global_asm = function (this: CodegenCx, _template: readonly InlineAsmTemplatePiece[], _operands: readonly GlobalAsmOperandRef[], _options: InlineAsmOptions, _line_spans: readonly Span[], _extra_rust_target_features: readonly string[]): void {
  return unported("cg-asm: compiler/rustc_codegen_llvm/src/asm.rs codegen_global_asm");
};

// Stub (cg-contract): AsmCodegenMethods::mangled_name
CodegenCx.prototype.mangled_name = function (this: CodegenCx, _instance: Instance): string {
  return unported("cg-asm: compiler/rustc_codegen_llvm/src/asm.rs mangled_name");
};

// ---- impl AsmBuilderMethods for Builder (asm.rs:27) ----
declare module "./builder.ts" {
  interface Builder {
    codegen_inline_asm(template: readonly InlineAsmTemplatePiece[], operands: readonly InlineAsmOperandRef<LlvmTypes>[], options: InlineAsmOptions, line_spans: readonly Span[], instance: Instance, dest: BasicBlock | undefined, catch_funclet: readonly [BasicBlock, Funclet | undefined] | undefined): void;
  }
}

// Stub (cg-contract): AsmBuilderMethods::codegen_inline_asm
Builder.prototype.codegen_inline_asm = function (this: Builder, _template: readonly InlineAsmTemplatePiece[], _operands: readonly InlineAsmOperandRef<LlvmTypes>[], _options: InlineAsmOptions, _line_spans: readonly Span[], _instance: Instance, _dest: BasicBlock | undefined, _catch_funclet: readonly [BasicBlock, Funclet | undefined] | undefined): void {
  return unported("cg-asm: compiler/rustc_codegen_llvm/src/asm.rs codegen_inline_asm");
};
