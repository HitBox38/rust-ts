// Port of compiler/rustc_builtin_macros/src/diagnostics.rs.
// The types and every `#[derive(Diagnostic)]` / `#[derive(Subdiagnostic)]` impl (`<T>_into_diag` +
// `<T>_diagnostic`, `<T>_add_to_diag` + `<T>_subdiagnostic`) are generated into diagnostics.gen.ts by
// tools/codegen/types.ts (set `rustc_builtin_macros`). This module holds the hand-written impls of the file.
// The inline module `autodiff` (`pub(crate) use autodiff::*;`) is generated into the same module.
//
// PORT: same conventions as src/rustc_parse/diagnostics.ts: `impl Diagnostic for T` ->
// `T_into_diag(self, dcx, level)` + `T_diagnostic(self)`; `impl Subdiagnostic for T` ->
// `T_add_to_diag(self, diag)` + `T_subdiagnostic(self)`.
import { bool_into_diag_arg } from "../rustc_error_messages/diagnostic_impls.ts";
import { Diag, type DiagCtxtHandle, type Diagnostic, IntoDiagArg, type Level, type Subdiagnostic } from "../rustc_errors/lib.ts";
import { DiagMessage_arg } from "../rustc_errors/formatting.ts";
import { display_Symbol } from "../rustc_span/symbol.ts";
import type * as gen from "./diagnostics.gen.ts";
import { autodiff as gen_autodiff } from "./diagnostics.gen.ts";

export * from "./diagnostics.gen.ts";

// `pub(crate) use autodiff::*;` (diagnostics.rs:172): the inline module is a generated namespace.
export type AutoDiffMissingConfig = gen.autodiff.AutoDiffMissingConfig;
export type AutoDiffUnknownActivity = gen.autodiff.AutoDiffUnknownActivity;
export type AutoDiffInvalidTypeForActivity = gen.autodiff.AutoDiffInvalidTypeForActivity;
export type AutoDiffInvalidNumberActivities = gen.autodiff.AutoDiffInvalidNumberActivities;
export type AutoDiffInvalidApplicationModeAct = gen.autodiff.AutoDiffInvalidApplicationModeAct;
export type AutoDiffInvalidRetAct = gen.autodiff.AutoDiffInvalidRetAct;
export type AutoDiffInvalidWidth = gen.autodiff.AutoDiffInvalidWidth;
export type AutoDiffInvalidApplication = gen.autodiff.AutoDiffInvalidApplication;
export const {
  AutoDiffMissingConfig_into_diag,
  AutoDiffMissingConfig_diagnostic,
  AutoDiffUnknownActivity_into_diag,
  AutoDiffUnknownActivity_diagnostic,
  AutoDiffInvalidTypeForActivity_into_diag,
  AutoDiffInvalidTypeForActivity_diagnostic,
  AutoDiffInvalidNumberActivities_into_diag,
  AutoDiffInvalidNumberActivities_diagnostic,
  AutoDiffInvalidApplicationModeAct_into_diag,
  AutoDiffInvalidApplicationModeAct_diagnostic,
  AutoDiffInvalidRetAct_into_diag,
  AutoDiffInvalidRetAct_diagnostic,
  AutoDiffInvalidWidth_into_diag,
  AutoDiffInvalidWidth_diagnostic,
  AutoDiffInvalidApplication_into_diag,
  AutoDiffInvalidApplication_diagnostic,
} = gen_autodiff;

// Hand-written implementation to support custom user messages.
/** `impl<'a> Diagnostic<'a> for EnvNotDefinedWithUserMessage` */
// rustc: compiler/rustc_builtin_macros/src/diagnostics.rs:547 into_diag
export function EnvNotDefinedWithUserMessage_into_diag(self: gen.EnvNotDefinedWithUserMessage, dcx: DiagCtxtHandle, level: Level): Diag {
  const diag = Diag.new(dcx, level, display_Symbol(self.msg_from_user));
  diag.span(self.span);
  return diag;
}
/** `EnvNotDefinedWithUserMessage` as a `Diagnostic` trait object. */
export function EnvNotDefinedWithUserMessage_diagnostic(self: gen.EnvNotDefinedWithUserMessage): Diagnostic {
  return { into_diag: (dcx, level) => EnvNotDefinedWithUserMessage_into_diag(self, dcx, level) };
}

// Allow the singular form to be a subdiagnostic of the multiple-unused
// form of diagnostic.
/** `impl Subdiagnostic for FormatUnusedArg` */
// rustc: compiler/rustc_builtin_macros/src/diagnostics.rs:776 add_to_diag
export function FormatUnusedArg_add_to_diag(self: gen.FormatUnusedArg, diag: Diag): void {
  diag.span_label(
    self.span,
    DiagMessage_arg(
      {
        $: "Inline",
        _0: `{$named ->
                    [true] named argument
                    *[false] argument
                } never used`,
      },
      "named",
      IntoDiagArg.of(self.named, bool_into_diag_arg),
    ).format(),
  );
}
/** `FormatUnusedArg` as a `Subdiagnostic` trait object. */
export function FormatUnusedArg_subdiagnostic(self: gen.FormatUnusedArg): Subdiagnostic {
  return { add_to_diag: (diag) => FormatUnusedArg_add_to_diag(self, diag) };
}

/** `impl<'a> Diagnostic<'a> for AsmClobberNoReg` */
// rustc: compiler/rustc_builtin_macros/src/diagnostics.rs:961 into_diag
export function AsmClobberNoReg_into_diag(self: gen.AsmClobberNoReg, dcx: DiagCtxtHandle, level: Level): Diag {
  return Diag.new(dcx, level, { $: "Inline", _0: "asm with `clobber_abi` must specify explicit registers for outputs" })
    .with_span([...self.spans])
    .with_span_labels(self.clobbers, "clobber_abi")
    .with_span_labels(self.spans, "generic outputs");
}
/** `AsmClobberNoReg` as a `Diagnostic` trait object. */
export function AsmClobberNoReg_diagnostic(self: gen.AsmClobberNoReg): Diagnostic {
  return { into_diag: (dcx, level) => AsmClobberNoReg_into_diag(self, dcx, level) };
}
