// Port of compiler/rustc_attr_parsing/src/attributes/diagnostic/on_unknown.rs
import type { diagnostic } from "../../../rustc_attr_ir/lib.ts";
import { AttributeStability } from "../../../rustc_feature/lib.ts";
import { field_mut } from "../../../std/mut_ref.ts";
import { AttributeParser_provided } from "../mod.ts";
import { Allow, type AttributeParser, type Span, sym, Target, template } from "../prelude.ts";
import { gate_diagnostic_attr, merge_directives, Mode, parse_directive_items, parse_list } from "./mod.ts";

type Directive = diagnostic.Directive;

/** `#[derive(Default)] pub(crate) struct OnUnknownParser` */
export interface OnUnknownParser {
  span: Span | undefined;
  directive: [Span, Directive] | undefined;
}

export const OnUnknownParser: AttributeParser<OnUnknownParser> = AttributeParser_provided<OnUnknownParser>({
  default: () => ({ span: undefined, directive: undefined }),
  ATTRIBUTES: [
    [
      [sym.diagnostic, sym.on_unknown],
      template({ List: [`/*opt*/ message = "...", /*opt*/ label = "...", /*opt*/ note = "..."`] }),
      AttributeStability.Stable, // Unstable, stability checked manually below
      (this_, cx, args) => {
        if (gate_diagnostic_attr(cx, args, "diagnostic_on_unknown")) return;

        const span = cx.attr_span;
        this_.span = span;
        const mode = Mode.DiagnosticOnUnknown;

        const items = parse_list(cx, args, mode);
        if (items === undefined) return;

        const directive = parse_directive_items(cx, mode, items.mixed(), true);
        if (directive !== undefined) {
          merge_directives(cx, field_mut(this_, "directive"), [span, directive]);
        }
      },
    ],
  ],
  // "Allowed" for all targets, but noop for all but use statements.
  ALLOWED_TARGETS: {
    $: "AllowListWarnRest",
    _0: [Allow(Target.Use), Allow(Target.Mod), Allow(Target.Crate)],
  },

  // rustc: compiler/rustc_attr_parsing/src/attributes/diagnostic/on_unknown.rs:39 finalize
  finalize(self, _cx) {
    if (self.span !== undefined) {
      return { $: "OnUnknown", directive: self.directive === undefined ? undefined : self.directive[1] };
    } else {
      return undefined;
    }
  },
});
