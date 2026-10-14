// Port of compiler/rustc_hir_analysis/src/diagnostics.rs: the types and their `#[derive(Diagnostic)]` /
// `#[derive(Subdiagnostic)]` impls are generated into diagnostics.gen.ts (tools/codegen/types.ts, set rustc_hir_analysis);
// the manual `impl Diagnostic` blocks are ported here (lane hirtylowerer-contract generated the set; see
// docs/handoff/hirtylowerer-contract.md for the owners of the two manual impls).

import { number_into_diag_arg, str_into_diag_arg, String_into_diag_arg } from "../rustc_error_messages/diagnostic_impls.ts";
import { Diag, type DiagCtxtHandle, type Diagnostic, E0393, IntoDiagArg, type Level, listify, msg } from "../rustc_errors/lib.ts";
import { Span } from "../rustc_span/lib.ts";
import { display_Symbol } from "../rustc_span/symbol.ts";
import { panic } from "../std/panic.ts";
import type { MissingGenericParams } from "./diagnostics.gen.ts";

export * from "./diagnostics.gen.ts";

// mod precise_captures; mod remove_or_use_generic; pub(crate) mod wrong_number_of_generic_args;
// (diagnostics/{precise_captures, remove_or_use_generic, wrong_number_of_generic_args}.rs: not ported; see the handoff's
// lane table)

// FIXME: This doesn't need to be a manual impl!
// impl<'a> Diagnostic<'a> for MissingGenericParams
// #[track_caller]
// rustc: compiler/rustc_hir_analysis/src/diagnostics.rs:477 into_diag
export function MissingGenericParams_into_diag(self: MissingGenericParams, dcx: DiagCtxtHandle, level: Level): Diag {
  const err = Diag.new(
    dcx,
    level,
    msg(
      "the {$descr} {$parameterCount ->\n                    [one] parameter\n                    *[other] parameters\n                } {$parameters} must be explicitly specified",
    ),
  );
  err.span(self.span);
  err.code(E0393);
  err.span_label(
    self.def_span,
    msg(
      "{$descr} {$parameterCount ->\n                    [one] parameter\n                    *[other] parameters\n                } {$parameters} must be specified for this",
    ),
  );

  // enum Descr { Generic, Type, Const }
  type Descr = "Generic" | "Type" | "Const";

  let descr: Descr | undefined = undefined;
  for (const [, kind] of self.missing_generic_params) {
    // PORT: the tuple match is an if-chain in arm order; `_ => continue` leaves `descr` as it is.
    if (descr === undefined && kind.$ === "Type") {
      descr = "Type";
    } else if (descr === undefined && kind.$ === "Const") {
      descr = "Const";
    } else if ((descr === "Type" && kind.$ === "Const") || (descr === "Const" && kind.$ === "Type")) {
      descr = "Generic";
    } else {
      continue;
    }
  }

  if (descr === undefined) panic("called `Option::unwrap()` on a `None` value");
  let descr_str: string;
  switch (descr) {
    case "Generic":
      descr_str = "generic";
      break;
    case "Type":
      descr_str = "type";
      break;
    case "Const":
      descr_str = "const";
      break;
  }
  err.arg("descr", IntoDiagArg.of(descr_str, str_into_diag_arg));
  err.arg("parameterCount", IntoDiagArg.of(self.missing_generic_params.length, number_into_diag_arg));
  const parameters = listify(self.missing_generic_params, ([n]) => `\`${display_Symbol(n)}\``);
  if (parameters === undefined) panic("called `Option::unwrap()` on a `None` value");
  err.arg("parameters", IntoDiagArg.of(parameters, String_into_diag_arg));

  let suggested = false;
  // Don't suggest setting the generic params if there are some already: The order is
  // tricky to get right and the user will already know what the syntax is.
  const snippet = self.span_snippet;
  if (snippet !== undefined && self.empty_generic_args) {
    if (snippet.endsWith(">")) {
      // The user wrote `Trait<'a, T>` or similar. To provide an accurate suggestion
      // we would have to preserve the right order. For now, as clearly the user is
      // aware of the syntax, we do nothing.
    } else {
      // The user wrote `Trait`, so we don't have a type we can suggest, but at
      // least we can clue them to the correct syntax `Trait</* Term */>`.
      err.span_suggestion_verbose(
        Span.shrink_to_hi(self.span),
        msg(
          "explicitly specify the {$descr} {$parameterCount ->\n                            [one] parameter\n                            *[other] parameters\n                        }",
        ),
        `<${self.missing_generic_params.map(([n]) => `/* ${display_Symbol(n)} */`).join(", ")}>`,
        "HasPlaceholders",
      );
      suggested = true;
    }
  }
  if (!suggested) {
    err.span_label(
      self.span,
      msg(
        "missing {$parameterCount ->\n                        [one] reference\n                        *[other] references\n                    } to {$parameters}",
      ),
    );
  }

  err.note(
    msg(
      "because the parameter {$parameterCount ->\n                [one] default references\n                *[other] defaults reference\n            } `Self`, the {$parameterCount ->\n                [one] parameter\n                *[other] parameters\n            } must be specified on the trait object type",
    ),
  );
  return err;
}
/** `MissingGenericParams` as a `Diagnostic` trait object. */
export function MissingGenericParams_diagnostic(self: MissingGenericParams): Diagnostic {
  return { into_diag: (dcx, level) => MissingGenericParams_into_diag(self, dcx, level) };
}

// impl<'tcx> Diagnostic<'tcx> for UncoveredTyParam<'tcx>
// (diagnostics.rs:2078 into_diag: not ported; coherence/orphan.rs is wave 17, lane coherence)
