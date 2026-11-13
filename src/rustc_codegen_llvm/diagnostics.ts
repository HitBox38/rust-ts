// Port of compiler/rustc_codegen_llvm/src/diagnostics.rs (lane cg-lto-diag, plan-m7 §2b "LTO, diagnostics").
//
// The types and their `#[derive(Diagnostic)]` impls are generated into diagnostics.gen.ts (tools/codegen/types.ts). This
// file adds the two hand-written impls, `impl Diagnostic for ParseTargetMachineConfig` and `impl Diagnostic for
// WithLlvmError`, as `<Type>_into_diag` / `<Type>_diagnostic` in the generator's shape.
import { String_into_diag_arg } from "../rustc_error_messages/diagnostic_impls.ts";
import { Diag, type DiagCtxtHandle, type Diagnostic, format_diag_message, IntoDiagArg, type Level } from "../rustc_errors/lib.ts";
import type { DiagMessage } from "../rustc_error_messages/lib.ts";
import { unwrap } from "../std/panic.ts";
import { LlvmError_into_diag, type ParseTargetMachineConfig, type WithLlvmError } from "./diagnostics.gen.ts";

export * from "./diagnostics.gen.ts";

// impl Diagnostic<'_> for ParseTargetMachineConfig<'_>
// rustc: compiler/rustc_codegen_llvm/src/diagnostics.rs:24 into_diag
export function ParseTargetMachineConfig_into_diag(self: ParseTargetMachineConfig, dcx: DiagCtxtHandle, level: Level): Diag {
  // Reuse the formatted primary message from `LlvmError` without emitting it.
  const diag = LlvmError_into_diag(self._0, dcx, level);
  const [message] = unwrap(diag.deref().messages[0], "`LlvmError` with no message");
  const message_ = format_diag_message(message, diag.deref().args);
  diag.cancel();

  return Diag.new(dcx, level, { $: "Inline", _0: "failed to parse target machine config to target machine: {$error}" }).with_arg("error", IntoDiagArg.of(message_, String_into_diag_arg));
}
/** `ParseTargetMachineConfig` as a `Diagnostic` trait object. */
export function ParseTargetMachineConfig_diagnostic(self: ParseTargetMachineConfig): Diagnostic {
  return { into_diag: (dcx, level) => ParseTargetMachineConfig_into_diag(self, dcx, level) };
}

// impl Diagnostic<'_> for WithLlvmError<'_>
// rustc: compiler/rustc_codegen_llvm/src/diagnostics.rs:141 into_diag
export function WithLlvmError_into_diag(self: WithLlvmError, dcx: DiagCtxtHandle, level: Level): Diag {
  // use LlvmError::*;
  let msg_with_llvm_err: DiagMessage;
  switch (self._0.$) {
    case "WriteOutput":
      msg_with_llvm_err = { $: "Inline", _0: "could not write output to {$path}: {$llvm_err}" };
      break;
    case "CreateTargetMachine": {
      msg_with_llvm_err = { $: "Inline", _0: "could not create LLVM TargetMachine for triple: {$triple}: {$llvm_err}" };
      break;
    }
    case "CreateMCSubtargetInfo": {
      msg_with_llvm_err = { $: "Inline", _0: "could not create LLVM MCSubtargetInfo for triple: {$triple}: {$llvm_err}" };
      break;
    }
    case "RunLlvmPasses":
      msg_with_llvm_err = { $: "Inline", _0: "failed to run LLVM passes: {$llvm_err}" };
      break;
    case "WriteIr":
      msg_with_llvm_err = { $: "Inline", _0: "failed to write LLVM IR to {$path}: {$llvm_err}" };
      break;
    case "PrepareThinLtoContext": {
      msg_with_llvm_err = { $: "Inline", _0: "failed to prepare thin LTO context: {$llvm_err}" };
      break;
    }
    case "LoadBitcode": {
      msg_with_llvm_err = { $: "Inline", _0: 'failed to load bitcode of module "{$name}": {$llvm_err}' };
      break;
    }
    case "WriteThinLtoKey": {
      msg_with_llvm_err = { $: "Inline", _0: "error while writing ThinLTO key data: {$err}: {$llvm_err}" };
      break;
    }
    case "PrepareThinLtoModule": {
      msg_with_llvm_err = { $: "Inline", _0: "failed to prepare thin LTO module: {$llvm_err}" };
      break;
    }
    case "ParseBitcode":
      msg_with_llvm_err = { $: "Inline", _0: "failed to parse bitcode for LTO module: {$llvm_err}" };
      break;
  }
  return LlvmError_into_diag(self._0, dcx, level).with_primary_message(msg_with_llvm_err).with_arg("llvm_err", IntoDiagArg.of(self._1, String_into_diag_arg));
}
/** `WithLlvmError` as a `Diagnostic` trait object. */
export function WithLlvmError_diagnostic(self: WithLlvmError): Diagnostic {
  return { into_diag: (dcx, level) => WithLlvmError_into_diag(self, dcx, level) };
}
