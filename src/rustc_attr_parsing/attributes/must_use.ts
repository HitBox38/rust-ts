// Port of compiler/rustc_attr_parsing/src/attributes/must_use.rs
import { AttributeStability } from "../../rustc_feature/lib.ts";
import { ExpectStringLiteral } from "../context.ts";
import { SingleAttributeParser_provided } from "./mod.ts";
import { Allow, Error, MethodKind, OnDuplicate, type SingleAttributeParser, sym, Target, template } from "./prelude.ts";

export const MustUseParser: SingleAttributeParser = SingleAttributeParser_provided({
  PATH: [sym.must_use],
  ON_DUPLICATE: OnDuplicate.WarnButFutureError,
  ALLOWED_TARGETS: {
    $: "AllowListWarnRest",
    _0: [
      Allow(Target.Fn),
      Allow(Target.Enum),
      Allow(Target.Struct),
      Allow(Target.Union),
      Allow({ $: "Method", _0: { $: "Trait", body: false } }),
      Allow({ $: "Method", _0: { $: "Trait", body: true } }),
      Allow({ $: "Method", _0: MethodKind.Inherent }),
      Allow(Target.ForeignFn),
      // `impl Trait` in return position can trip
      // `unused_must_use` if `Trait` is marked as
      // `#[must_use]`
      Allow(Target.Trait),
      Error(Target.WherePredicate),
    ],
  },
  TEMPLATE: template(
    { Word: true, NameValueStr: ["reason"] },
    "https://doc.rust-lang.org/reference/attributes/diagnostics.html#the-must_use-attribute",
  ),
  STABILITY: AttributeStability.Stable,

  // rustc: compiler/rustc_attr_parsing/src/attributes/must_use.rs:31 convert
  convert(cx, args) {
    let reason;
    switch (args.$) {
      case "NoArgs":
        reason = undefined;
        break;
      case "NameValue":
        reason = cx.expect_string_literal(args._0, ExpectStringLiteral.NameValueParser);
        break;
      case "List": {
        const list = args._0;
        cx.adcx().expected_nv_or_no_args(list.span);
        return undefined;
      }
    }
    return { $: "MustUse", span: cx.attr_span, reason };
  },
});
