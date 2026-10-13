// Port of compiler/rustc_attr_parsing/src/attributes/diagnostic/do_not_recommend.rs
import { AttributeStability } from "../../../rustc_feature/lib.ts";
import { MALFORMED_DIAGNOSTIC_ATTRIBUTES } from "../../../rustc_lint_defs/builtin.ts";
import { sym } from "../../../rustc_span/symbol.ts";
import { DoNotRecommendDoesNotExpectArgs_diagnostic } from "../../diagnostics.ts";
import { template } from "../../template.ts";
import { OnDuplicate, type SingleAttributeParser, SingleAttributeParser_provided } from "../mod.ts";
import { Allow, AttributeKind } from "../prelude.ts";

export const DoNotRecommendParser: SingleAttributeParser = {
  ...SingleAttributeParser_provided,
  PATH: [sym.diagnostic, sym.do_not_recommend],
  ON_DUPLICATE: OnDuplicate.Warn,
  // "Allowed" on any target, noop on all but trait impls
  ALLOWED_TARGETS: { $: "AllowListWarnRest", _0: [Allow({ $: "Impl", of_trait: true })] },
  TEMPLATE: template({ Word: true } /*doesn't matter */),
  STABILITY: AttributeStability.Stable,

  // rustc: compiler/rustc_attr_parsing/src/attributes/diagnostic/do_not_recommend.rs:24 convert
  convert(cx, args) {
    const attr_span = cx.attr_span;
    if (!(args.$ === "NoArgs")) {
      cx.shared.emit_lint(
        MALFORMED_DIAGNOSTIC_ATTRIBUTES,
        DoNotRecommendDoesNotExpectArgs_diagnostic({}),
        attr_span,
      );
    }

    return AttributeKind.DoNotRecommend;
  },
};
