// Port of compiler/rustc_resolve/src/diagnostics/mod.rs
//
// The `#[derive(Diagnostic)]` / `#[derive(Subdiagnostic)]` / `#[derive(LintDiagnostic)]` structs of
// this file and their impls are generated into mod.gen.ts (tools/codegen/types.ts, set
// `rustc_resolve`). The two manual impls below are ported by lane res-diag-a.
// Init order: top-level code here may touch only this file's `.gen.ts` and other crates.
import { MultiSpan } from "../../rustc_error_messages/lib.ts";
import { Symbol_into_diag_arg } from "../../rustc_error_messages/diagnostic_impls.ts";
import { Diag, type DiagCtxtHandle, type Diagnostic, E0659, IntoDiagArg, type Level, type Subdiagnostic } from "../../rustc_errors/lib.ts";
import { DiagMessage_arg } from "../../rustc_errors/formatting.ts";
import { display_Ident } from "../../rustc_span/symbol.ts";
import type { Ambiguity, FoundItemConfigureOut } from "./mod.gen.ts";

export * from "./mod.gen.ts";

// impl Subdiagnostic for FoundItemConfigureOut
// rustc: compiler/rustc_resolve/src/diagnostics/mod.rs:1388 add_to_diag
export function FoundItemConfigureOut_add_to_diag(self: FoundItemConfigureOut, diag: Diag): void {
  const multispan: MultiSpan = MultiSpan.from_Span(self.span);
  const item_was = self.item_was;
  switch (item_was.$) {
    case "BehindFeature": {
      const { feature, span } = item_was;
      const value = Symbol_into_diag_arg(feature, { value: undefined });
      const msg = DiagMessage_arg({ $: "Inline", _0: "the item is gated behind the `{$feature}` feature" }, "feature", IntoDiagArg.DiagArgValue(value)).format();
      multispan.push_span_label(span, msg);
      break;
    }
    case "CfgOut": {
      const { span } = item_was;
      multispan.push_span_label(span, { $: "Inline", _0: "the item is gated here" });
      break;
    }
  }
  diag.span_note(multispan, { $: "Inline", _0: "found an item that was configured out" });
}
/** `FoundItemConfigureOut` as a `Subdiagnostic` trait object. */
export function FoundItemConfigureOut_subdiagnostic(self: FoundItemConfigureOut): Subdiagnostic {
  return { add_to_diag: (diag) => FoundItemConfigureOut_add_to_diag(self, diag) };
}

// impl<'a> Diagnostic<'a> for Ambiguity
// rustc: compiler/rustc_resolve/src/diagnostics/mod.rs:1535 into_diag
export function Ambiguity_into_diag(self: Ambiguity, dcx: DiagCtxtHandle, level: Level): Diag {
  const { ident, ambig_vis, kind, help, b1_note, b1_help_msgs, b2_note, b2_help_msgs, is_error } = self;

  const diag = Diag.new(dcx, level, "").with_span(ident.span);
  if (is_error) {
    diag.code(E0659);
  }
  if (ambig_vis !== undefined) {
    diag.primary_message(`ambiguous import visibility: ${ambig_vis}`);
  } else {
    diag.primary_message(`\`${display_Ident(ident)}\` is ambiguous`);
    diag.span_label(ident.span, "ambiguous name");
  }
  diag.note(`ambiguous because of ${kind}`);
  diag.span_note(b1_note.span, b1_note.node);
  if (help !== undefined) {
    for (const help_ of help) {
      diag.help(help_);
    }
  }
  for (const help_msg of b1_help_msgs) {
    diag.help(help_msg);
  }
  diag.span_note(b2_note.span, b2_note.node);
  for (const help_msg of b2_help_msgs) {
    diag.help(help_msg);
  }
  return diag;
}
/** `Ambiguity` as a `Diagnostic` trait object. */
export function Ambiguity_diagnostic(self: Ambiguity): Diagnostic {
  return { into_diag: (dcx, level) => Ambiguity_into_diag(self, dcx, level) };
}
