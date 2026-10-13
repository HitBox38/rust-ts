// Port of compiler/rustc_attr_parsing/src/attributes/autodiff.rs
import { expand } from "../../rustc_ast/lib.ts";
import { RustcAutodiff } from "../../rustc_attr_ir/lib.ts";
import { MethodKind, Target } from "../../rustc_attr_ir/target.ts";
import { Span } from "../../rustc_span/lib.ts";
import { sym } from "../../rustc_span/symbol.ts";
import { MetaItemOrLitParser } from "../parser.ts";
import { template } from "../template.ts";
import { unstable } from "../stability.ts";
import { type SingleAttributeParser, SingleAttributeParser_provided } from "./mod.ts";
import { Allow } from "./prelude.ts";

const { DiffActivity, DiffMode } = expand.autodiff_attrs;
type DiffActivity = expand.autodiff_attrs.DiffActivity;

export const RustcAutodiffParser: SingleAttributeParser = SingleAttributeParser_provided({
  PATH: [sym.rustc_autodiff],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      Allow(Target.Fn),
      Allow({ $: "Method", _0: MethodKind.Inherent }),
      Allow({ $: "Method", _0: { $: "Trait", body: true } }),
      Allow({ $: "Method", _0: { $: "Trait", body: false } }),
      Allow({ $: "Method", _0: MethodKind.TraitImpl }),
    ],
  },
  TEMPLATE: template(
    { List: ["MODE", "WIDTH", "INPUT_ACTIVITIES", "OUTPUT_ACTIVITY"] },
    "https://doc.rust-lang.org/std/autodiff/index.html",
  ),
  STABILITY: unstable(sym.rustc_attrs),

  // rustc: compiler/rustc_attr_parsing/src/attributes/autodiff.rs:35 convert
  convert(cx, args) {
    let list;
    switch (args.$) {
      case "NoArgs":
        return { $: "RustcAutodiff", _0: undefined };
      case "List":
        list = args._0;
        break;
      case "NameValue": {
        const attr_span = cx.attr_span;
        cx.adcx().expected_list_or_no_args(attr_span);
        return undefined;
      }
    }

    // PORT: `list.mixed().peekable()` -> the collected items and a cursor.
    const items_ = [...list.mixed()];
    let next = 0;

    // Parse name
    if (next >= items_.length) {
      cx.adcx().expected_at_least_one_argument(list.span);
      return undefined;
    }
    const mode0 = items_[next++]!;
    const mode1 = MetaItemOrLitParser.meta_item(mode0);
    if (mode1 === undefined) {
      cx.adcx().expected_identifier(MetaItemOrLitParser.span(mode0));
      return undefined;
    }
    if (cx.expect_no_args(mode1.args()) === undefined) return undefined;
    const mode2 = mode1.path().word();
    if (mode2 === undefined) {
      cx.adcx().expected_identifier(mode1.span());
      return undefined;
    }
    const mode3 = DiffMode.from_str(mode2.as_str());
    if (mode3.$ !== "Ok") {
      cx.adcx().expected_specific_argument(mode2.span, DiffMode.all_modes());
      return undefined;
    }
    const mode = mode3._0;

    // Parse width
    let width: number;
    const width0 = items_[next];
    if (
      width0 !== undefined &&
      width0.$ === "Lit" &&
      width0._0.kind.$ === "Int" &&
      // `width.0.try_into()` (into `u32`)
      width0._0.kind._0 <= 0xffffffffn
    ) {
      next++;
      width = Number(width0._0.kind._0);
    } else {
      width = 1;
    }

    // Parse activities
    const activities: DiffActivity[] = [];
    for (; next < items_.length; next++) {
      const activity0 = items_[next]!;
      if (activity0.$ !== "MetaItemParser") {
        cx.adcx().expected_specific_argument(MetaItemOrLitParser.span(activity0), DiffActivity.all_activities());
        return undefined;
      }
      const activity1 = activity0._0;
      if (cx.expect_no_args(activity1.args()) === undefined) return undefined;
      const activity2 = activity1.path().word();
      if (activity2 === undefined) {
        cx.adcx().expected_specific_argument(activity1.span(), DiffActivity.all_activities());
        return undefined;
      }
      const activity3 = DiffActivity.from_str(activity2.as_str());
      if (activity3.$ !== "Ok") {
        cx.adcx().expected_specific_argument(activity2.span, DiffActivity.all_activities());
        return undefined;
      }

      activities.push(activity3._0);
    }
    const ret_activity = activities.pop();
    if (ret_activity === undefined) {
      cx.adcx().expected_specific_argument(Span.with_lo(list.span, Span.hi(list.span)), DiffActivity.all_activities());
      return undefined;
    }

    return {
      $: "RustcAutodiff",
      _0: new RustcAutodiff(mode, width, activities, ret_activity),
    };
  },
});
