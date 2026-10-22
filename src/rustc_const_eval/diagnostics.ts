// Port of compiler/rustc_const_eval/src/diagnostics.rs (lane const-check): the types and their `#[derive(Diagnostic)]` /
// `#[derive(Subdiagnostic)]` impls are generated into diagnostics.gen.ts (tools/codegen/types.ts, set rustc_const_eval);
// the manual `impl Subdiagnostic for FrameNote` and `impl IntoDiagArg for InternKind` are ported here.
// `crate::interpret::InternKind` (interpret/intern.rs:181) is generated into interpret/intern.gen.ts (lane interp-contract
// took over the stand-in declaration of lane const-check); it is re-exported here for the existing importers.
import type { MutRef } from "../std/mut_ref.ts";
import { MultiSpan, type DiagArgValue, type PathBuf } from "../rustc_error_messages/lib.ts";
import { Span } from "../rustc_span/lib.ts";
import { type Diag, IntoDiagArg, msg } from "../rustc_errors/lib.ts";
import { DiagMessage_arg } from "../rustc_errors/formatting.ts";
import { number_into_diag_arg, String_into_diag_arg, str_into_diag_arg } from "../rustc_error_messages/diagnostic_impls.ts";
import type { FrameNote } from "./diagnostics.gen.ts";

export * from "./diagnostics.gen.ts";

export type { InternKind } from "./interpret/intern.gen.ts";
import type { InternKind } from "./interpret/intern.gen.ts";

// impl Subdiagnostic for FrameNote
// rustc: compiler/rustc_const_eval/src/diagnostics.rs:321 add_to_diag
export function FrameNote_add_to_diag(self: FrameNote, diag: Diag): void {
  const span: MultiSpan = MultiSpan.from_Span(self.span);
  if (self.has_label && !Span.is_dummy(self.span)) {
    span.push_span_label(self.span, msg("the failure occurred here"));
  }
  for (const sp of self.span_context) {
    span.push_span_context(sp);
  }
  const msg_ = DiagMessage_arg(
    msg(
      `{$times ->
                [0] inside {$where_ ->
                    [closure] closure
                    [instance] \`{$instance}\`
                    *[other] {""}
                }
                *[other] [... {$times} additional calls inside {$where_ ->
                    [closure] closure
                    [instance] \`{$instance}\`
                    *[other] {""}
                } ...]
            }`,
    ),
    "times",
    IntoDiagArg.of(self.times, number_into_diag_arg),
  )
    .arg("where_", IntoDiagArg.of(self.where_, str_into_diag_arg))
    .arg("instance", IntoDiagArg.of(self.instance, String_into_diag_arg))
    .format();
  diag.span_note(span, msg_);
}

// impl rustc_errors::IntoDiagArg for InternKind
// rustc: compiler/rustc_const_eval/src/diagnostics.rs:500 into_diag_arg
export function InternKind_into_diag_arg(self: InternKind, _: MutRef<PathBuf | undefined>): DiagArgValue {
  let s: string;
  switch (self.$) {
    case "Static":
      s = self._0 === "Not" ? "static" : "static_mut";
      break;
    case "Constant":
      s = "const";
      break;
    case "Promoted":
      s = "promoted";
      break;
  }
  return { $: "Str", _0: s };
}
