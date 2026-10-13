// Port of compiler/rustc_attr_parsing/src/attributes/diagnostic/on_type_error.rs
import type { diagnostic } from "../../../rustc_attr_ir/lib.ts";
import { AttributeStability } from "../../../rustc_feature/lib.ts";
import { field_mut } from "../../../std/mut_ref.ts";
import { AttributeParser_provided } from "../mod.ts";
import { Allow, type AttributeParser, type Span, sym, Target, template } from "../prelude.ts";
import { gate_diagnostic_attr, merge_directives, Mode, parse_directive_items, parse_list } from "./mod.ts";

type Directive = diagnostic.Directive;

/** `#[derive(Default)] pub(crate) struct OnTypeErrorParser` */
export interface OnTypeErrorParser {
  span: Span | undefined;
  directive: [Span, Directive] | undefined;
}

export const OnTypeErrorParser: AttributeParser<OnTypeErrorParser> = AttributeParser_provided<OnTypeErrorParser>({
  default: () => ({ span: undefined, directive: undefined }),
  ATTRIBUTES: [
    [
      [sym.diagnostic, sym.on_type_error],
      template({ List: [`note = "..."`] }),
      AttributeStability.Stable, // Unstable, stability checked manually below
      (this_, cx, args) => {
        if (gate_diagnostic_attr(cx, args, "diagnostic_on_type_error")) return;

        const span = cx.attr_span;
        this_.span = span;
        const mode = Mode.DiagnosticOnTypeError;
        const items = parse_list(cx, args, mode);
        if (items === undefined) return;

        const directive = parse_directive_items(cx, mode, items.mixed(), true);
        if (directive !== undefined) {
          merge_directives(cx, field_mut(this_, "directive"), [span, directive]);
        }
      },
    ],
  ],

  ALLOWED_TARGETS: {
    $: "AllowListWarnRest",
    _0: [Allow(Target.Enum), Allow(Target.Struct), Allow(Target.Union)],
  },

  // rustc: compiler/rustc_attr_parsing/src/attributes/diagnostic/on_type_error.rs:41 finalize
  finalize(self, _cx) {
    if (self.span !== undefined) {
      const span = self.span;
      return {
        $: "OnTypeError",
        span,
        directive: self.directive === undefined ? undefined : self.directive[1],
      };
    } else {
      return undefined;
    }
  },
});
