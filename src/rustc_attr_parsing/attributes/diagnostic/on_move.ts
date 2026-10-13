// Port of compiler/rustc_attr_parsing/src/attributes/diagnostic/on_move.rs
import type { diagnostic } from "../../../rustc_attr_ir/lib.ts";
import { AttributeStability } from "../../../rustc_feature/lib.ts";
import { field_mut } from "../../../std/mut_ref.ts";
import { AttributeParser_provided } from "../mod.ts";
import { Allow, type AttributeParser, type Span, sym, Target, template } from "../prelude.ts";
import { gate_diagnostic_attr, merge_directives, Mode, parse_directive_items, parse_list } from "./mod.ts";

type Directive = diagnostic.Directive;

/** `#[derive(Default)] pub(crate) struct OnMoveParser` */
export interface OnMoveParser {
  span: Span | undefined;
  directive: [Span, Directive] | undefined;
}

export const OnMoveParser: AttributeParser<OnMoveParser> = {
  ...AttributeParser_provided,
  default: () => ({ span: undefined, directive: undefined }),
  ATTRIBUTES: [
    [
      [sym.diagnostic, sym.on_move],
      template({ List: [`/*opt*/ message = "...", /*opt*/ label = "...", /*opt*/ note = "..."`] }),
      AttributeStability.Stable, // Unstable, stability checked manually below
      (this_, cx, args) => {
        if (gate_diagnostic_attr(cx, args, "diagnostic_on_move")) return;

        const span = cx.attr_span;
        this_.span = span;
        const mode = Mode.DiagnosticOnMove;

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

  // rustc: compiler/rustc_attr_parsing/src/attributes/diagnostic/on_move.rs:42 finalize
  finalize(self, _cx) {
    if (self.span !== undefined) {
      return { $: "OnMove", directive: self.directive === undefined ? undefined : self.directive[1] };
    } else {
      return undefined;
    }
  },
};
