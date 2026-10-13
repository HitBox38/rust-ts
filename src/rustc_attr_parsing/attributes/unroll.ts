// Port of compiler/rustc_attr_parsing/src/attributes/unroll.rs
import { UnrollAttr } from "../../rustc_attr_ir/lib.ts";
import { SingleAttributeParser_provided } from "./mod.ts";
import { Allow, MetaItemOrLitParser, type SingleAttributeParser, sym, Target, template, unstable } from "./prelude.ts";

export const UnrollParser: SingleAttributeParser = SingleAttributeParser_provided({
  // FIXME(#159429): temporarily renamed to mitigate `#[unroll]` nameres ambiguity.
  PATH: [sym.rustc_unroll],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Loop), Allow(Target.ForLoop), Allow(Target.While)] },
  STABILITY: unstable(sym.loop_hints),
  TEMPLATE: template({ Word: true, List: ["full", "never", "<integer>"] }),

  // rustc: compiler/rustc_attr_parsing/src/attributes/unroll.rs:22 convert
  convert(cx, args) {
    switch (args.$) {
      case "NoArgs":
        return { $: "Unroll", _0: UnrollAttr.Hint };
      case "List": {
        const list = args._0;
        const l = cx.expect_single(list);
        if (l === undefined) return undefined;

        const lit = MetaItemOrLitParser.as_lit(l);
        if (lit !== undefined && lit.kind.$ === "Int" && lit.kind._1.$ === "Unsuffixed") {
          const val = lit.kind._0;
          // `u32::try_from(val.get())`
          if (val <= 0xffffffffn) {
            return { $: "Unroll", _0: { $: "Count", _0: Number(val) } };
          } else {
            // `u32::MAX as isize`
            cx.adcx().expected_integer_literal_in_range(MetaItemOrLitParser.span(l), 0, 0xffffffff);
            return undefined;
          }
        }

        const w = MetaItemOrLitParser.meta_item_no_args(l)?.path().word_sym();
        if (w === sym.full) {
          return { $: "Unroll", _0: UnrollAttr.Full };
        } else if (w === sym.never) {
          return { $: "Unroll", _0: UnrollAttr.Never };
        } else {
          cx.adcx().expected_specific_argument(MetaItemOrLitParser.span(l), [sym.full, sym.never]);
          return undefined;
        }
      }
      case "NameValue": {
        const inner_span = cx.inner_span;
        cx.adcx().expected_list_or_no_args(inner_span);
        return undefined;
      }
    }
  },
});
