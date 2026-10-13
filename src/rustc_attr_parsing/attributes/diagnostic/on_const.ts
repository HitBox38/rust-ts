// Port of compiler/rustc_attr_parsing/src/attributes/diagnostic/on_const.rs
import type { diagnostic } from "../../../rustc_attr_ir/lib.ts";
import { AttributeStability } from "../../../rustc_feature/lib.ts";
import { field_mut } from "../../../std/mut_ref.ts";
import { AttributeParser_provided } from "../mod.ts";
import { Allow, type AttributeParser, type Span, sym, template } from "../prelude.ts";
import { gate_diagnostic_attr, merge_directives, Mode, parse_directive_items, parse_list } from "./mod.ts";

type Directive = diagnostic.Directive;

/** `#[derive(Default)] pub(crate) struct OnConstParser` */
export interface OnConstParser {
  path_span: Span | undefined;
  directive: [Span, Directive] | undefined;
}

export const OnConstParser: AttributeParser<OnConstParser> = {
  ...AttributeParser_provided,
  default: () => ({ path_span: undefined, directive: undefined }),
  ATTRIBUTES: [
    [
      [sym.diagnostic, sym.on_const],
      template({ List: [`/*opt*/ message = "...", /*opt*/ label = "...", /*opt*/ note = "..."`] }),
      AttributeStability.Stable, // Unstable, stability checked manually below
      (this_, cx, args) => {
        if (gate_diagnostic_attr(cx, args, "diagnostic_on_const")) return;

        const path_span = cx.attr_path.span;
        this_.path_span = path_span;

        const mode = Mode.DiagnosticOnConst;

        const items = parse_list(cx, args, mode);
        if (items === undefined) return;

        const directive = parse_directive_items(cx, mode, items.mixed(), true);
        if (directive === undefined) {
          return;
        }
        merge_directives(cx, field_mut(this_, "directive"), [path_span, directive]);
      },
    ],
  ],

  // "Allowed" on all targets; noop on anything but non-const trait impls;
  // this linted on in parser.
  ALLOWED_TARGETS: {
    $: "AllowListWarnRest",
    _0: [
      // FIXME(mejrs) no constness field on `Target`,
      // so non-constness is still checked in check_attr.rs
      Allow({ $: "Impl", of_trait: true }),
    ],
  },

  // rustc: compiler/rustc_attr_parsing/src/attributes/diagnostic/on_const.rs:42 finalize
  finalize(self, _cx) {
    if (self.path_span !== undefined) {
      const path_span = self.path_span;
      return {
        $: "OnConst",
        span: path_span,
        directive: self.directive === undefined ? undefined : self.directive[1],
      };
    } else {
      return undefined;
    }
  },
};
