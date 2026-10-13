// Port of compiler/rustc_attr_parsing/src/attributes/debugger.rs
import type { DebugVisualizer, DebuggerVisualizerType } from "../../rustc_attr_ir/lib.ts";
import { AttributeStability } from "../../rustc_feature/lib.ts";
import { ExpectNameValue, ExpectStringLiteral } from "../context.ts";
import { CombineAttributeParser_provided } from "./mod.ts";
import { Allow, type CombineAttributeParser, MetaItemOrLitParser, Span, sym, Target, template } from "./prelude.ts";

export const DebuggerVisualizerParser: CombineAttributeParser<DebugVisualizer> = CombineAttributeParser_provided<DebugVisualizer>({
  PATH: [sym.debugger_visualizer],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Mod), Allow(Target.Crate)] },
  TEMPLATE: template(
    { List: [`natvis_file = "...", gdb_script_file = "..."`] },
    "https://doc.rust-lang.org/reference/attributes/debugger.html#the-debugger_visualizer-attribute",
  ),
  STABILITY: AttributeStability.Stable,

  CONVERT: (v, _) => ({ $: "DebuggerVisualizer", _0: v }),

  // rustc: compiler/rustc_attr_parsing/src/attributes/debugger.rs:21 extend
  extend(cx, args) {
    const single = cx.expect_single_element_list(args, cx.attr_span);
    if (single === undefined) return [];
    const r = cx.expect_name_value(single, MetaItemOrLitParser.span(single), undefined, ExpectNameValue.MetaItemOrLitParser);
    if (r === undefined) return [];
    const [ident, args_] = r;
    let visualizer_type: DebuggerVisualizerType;
    switch (ident.name) {
      case sym.natvis_file:
        visualizer_type = "Natvis";
        break;
      case sym.gdb_script_file:
        visualizer_type = "GdbPrettyPrinter";
        break;
      default: {
        cx.adcx().expected_specific_argument(ident.span, [sym.natvis_file, sym.gdb_script_file]);
        return [];
      }
    }

    const path = cx.expect_string_literal(args_, ExpectStringLiteral.NameValueParser);
    if (path === undefined) return [];

    return [{ span: Span.to(ident.span, args_.value_span), visualizer_type, path }];
  },
});
