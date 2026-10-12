// Port of compiler/rustc_errors/src/diagnostic_impls.rs.
import type { DiagArgValue, PathBuf } from "../rustc_error_messages/lib.ts";
import type { MutRef } from "../rustc_span/hygiene.ts";
import { type DiagLocation, type Subdiagnostic, type Diag, display_DiagLocation } from "./diagnostic.ts";
import type {
  DiagSymbolList,
  SingleLabelManySpans,
} from "./diagnostic_impls.gen.ts";

export * from "./diagnostic_impls.gen.ts";

/** `impl IntoDiagArg for DiagLocation` */
// rustc: compiler/rustc_errors/src/diagnostic_impls.rs:11 into_diag_arg
export function DiagLocation_into_diag_arg(self: DiagLocation, _: MutRef<PathBuf | undefined>): DiagArgValue {
  return { $: "Str", _0: display_DiagLocation(self) };
}

/** `impl<S> From<Vec<S>> for DiagSymbolList<S>` */
// rustc: compiler/rustc_errors/src/diagnostic_impls.rs:20 from
export function DiagSymbolList_from<S>(v: S[]): DiagSymbolList<S> {
  return { _0: v };
}

/** `impl<S> FromIterator<S> for DiagSymbolList<S>` */
// rustc: compiler/rustc_errors/src/diagnostic_impls.rs:26 from_iter
export function DiagSymbolList_from_iter<S>(iter: Iterable<S>): DiagSymbolList<S> {
  return DiagSymbolList_from([...iter]);
}

/** `impl<S: std::fmt::Display> IntoDiagArg for DiagSymbolList<S>` (PORT: `display` is `S`'s `Display`). */
// rustc: compiler/rustc_errors/src/diagnostic_impls.rs:32 into_diag_arg
export function DiagSymbolList_into_diag_arg<S>(
  self: DiagSymbolList<S>,
  _: MutRef<PathBuf | undefined>,
  display: (s: S) => string,
): DiagArgValue {
  return { $: "StrListSepByAnd", _0: self._0.map((sym) => `\`${display(sym)}\``) };
}

/** `impl Subdiagnostic for SingleLabelManySpans` */
// rustc: compiler/rustc_errors/src/diagnostic_impls.rs:45 add_to_diag
export function SingleLabelManySpans_add_to_diag(self: SingleLabelManySpans, diag: Diag): void {
  diag.span_labels(self.spans, self.label);
}

/** `SingleLabelManySpans` as a `Subdiagnostic` trait object. */
export function SingleLabelManySpans_subdiagnostic(self: SingleLabelManySpans): Subdiagnostic {
  return { add_to_diag: (diag) => SingleLabelManySpans_add_to_diag(self, diag) };
}

// The `#[derive(Subdiagnostic)]` impls of `ExpectedLifetimeParameter`, `IndicateAnonymousLifetime` and
// `ElidedLifetimeInPathSubdiag` are generated into diagnostic_impls.gen.ts.
