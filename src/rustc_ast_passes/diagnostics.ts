//! Errors emitted by ast_passes.
// Port of compiler/rustc_ast_passes/src/diagnostics.rs.
// The types and every `#[derive(Diagnostic)]` / `#[derive(Subdiagnostic)]` impl (`<T>_into_diag` + `<T>_diagnostic`,
// `<T>_add_to_diag` + `<T>_subdiagnostic`) are generated into diagnostics.gen.ts by tools/codegen/types.ts (set
// `rustc_ast_passes`). This module holds the hand-written impls of the file.
import type { Diag, Subdiagnostic } from "../rustc_errors/lib.ts";
import type { EmptyLabelManySpans } from "./diagnostics.gen.ts";

export * from "./diagnostics.gen.ts";

// The derive for `Vec<Span>` does multiple calls to `span_label`, adding commas between each
/** `impl Subdiagnostic for EmptyLabelManySpans` */
// rustc: compiler/rustc_ast_passes/src/diagnostics.rs:675 add_to_diag
export function EmptyLabelManySpans_add_to_diag(self: EmptyLabelManySpans, diag: Diag): void {
  diag.span_labels(self._0, "");
}

/** `EmptyLabelManySpans` as a `Subdiagnostic` trait object. */
export function EmptyLabelManySpans_subdiagnostic(self: EmptyLabelManySpans): Subdiagnostic {
  return { add_to_diag: (diag) => EmptyLabelManySpans_add_to_diag(self, diag) };
}
