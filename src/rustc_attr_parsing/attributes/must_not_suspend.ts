// Port of compiler/rustc_attr_parsing/src/attributes/must_not_suspend.rs
import { ExpectStringLiteral } from "../context.ts";
import { SingleAttributeParser_provided } from "./mod.ts";
import { Allow, type SingleAttributeParser, sym, Target, template, unstable } from "./prelude.ts";

export const MustNotSuspendParser: SingleAttributeParser = {
  ...SingleAttributeParser_provided,
  PATH: [sym.must_not_suspend],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [Allow(Target.Struct), Allow(Target.Enum), Allow(Target.Union), Allow(Target.Trait)],
  },
  TEMPLATE: template({ Word: true, List: ["count"] }),
  STABILITY: unstable(sym.must_not_suspend),

  // rustc: compiler/rustc_attr_parsing/src/attributes/must_not_suspend.rs:18 convert
  convert(cx, args) {
    let reason;
    switch (args.$) {
      case "NameValue":
        reason = cx.expect_string_literal(args._0, ExpectStringLiteral.NameValueParser);
        break;
      case "NoArgs":
        reason = undefined;
        break;
      case "List": {
        const list = args._0;
        cx.adcx().expected_nv_or_no_args(list.span);
        return undefined;
      }
    }

    return { $: "MustNotSupend", reason };
  },
};
