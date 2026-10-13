// Port of compiler/rustc_attr_parsing/src/attributes/confusables.rs
import { EmptyConfusables_diagnostic } from "../diagnostics.ts";
import { ExpectStringLiteral } from "../context.ts";
import { AttributeParser_provided } from "./mod.ts";
import { Allow, type AttributeParser, MethodKind, type Span, type Symbol, sym, template, unstable } from "./prelude.ts";

/** `#[derive(Default)] pub(crate) struct ConfusablesParser` */
export interface ConfusablesParser {
  confusables: Symbol[];
  first_span: Span | undefined;
}

export const ConfusablesParser: AttributeParser<ConfusablesParser> = AttributeParser_provided<ConfusablesParser>({
  default: () => ({ confusables: [], first_span: undefined }),
  ATTRIBUTES: [
    [
      [sym.rustc_confusables],
      template({ List: [`"name1", "name2", ...`] }),
      unstable(sym.rustc_attrs),
      (this_, cx, args) => {
        const list = cx.expect_list(args, cx.attr_span);
        if (list === undefined) return;

        if (list.is_empty()) {
          cx.shared.emit_err(EmptyConfusables_diagnostic({ span: cx.attr_span }));
        }

        for (const param of list.mixed()) {
          const lit = cx.expect_string_literal(param, ExpectStringLiteral.MetaItemOrLitParser);
          if (lit === undefined) {
            continue;
          }

          this_.confusables.push(lit);
        }

        // `this.first_span.get_or_insert(cx.attr_span)`
        if (this_.first_span === undefined) this_.first_span = cx.attr_span;
      },
    ],
  ],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow({ $: "Method", _0: MethodKind.Inherent })] },

  // rustc: compiler/rustc_attr_parsing/src/attributes/confusables.rs:38 finalize
  finalize(self, _cx) {
    if (self.confusables.length === 0) {
      return undefined;
    }

    return { $: "RustcConfusables", confusables: self.confusables };
  },
});
