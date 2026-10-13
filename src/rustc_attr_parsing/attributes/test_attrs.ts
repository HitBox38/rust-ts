// Port of compiler/rustc_attr_parsing/src/attributes/test_attrs.rs
import { clone_Path } from "../../rustc_ast/lib.ts";
import type { RustcAbiAttrKind } from "../../rustc_attr_ir/lib.ts";
import { AttributeStability } from "../../rustc_feature/lib.ts";
import { ILL_FORMED_ATTRIBUTE_INPUT } from "../../rustc_lint_defs/builtin.ts";
import { is_whitespace } from "../../std/char.ts";
import { ExpectNameValue, ExpectStringLiteral } from "../context.ts";
import { display_PathParser } from "../parser.ts";
import { NoArgsAttributeParser_provided, SingleAttributeParser_provided } from "./mod.ts";
import {
  Allow,
  ArgParser,
  AttributeKind,
  Error,
  MetaItemOrLitParser,
  MethodKind,
  type NoArgsAttributeParser,
  OnDuplicate,
  type SingleAttributeParser,
  type Span,
  Symbol,
  sym,
  Target,
  template,
  unstable,
} from "./prelude.ts";

export const IgnoreParser: SingleAttributeParser = {
  ...SingleAttributeParser_provided,
  PATH: [sym.ignore],
  ON_DUPLICATE: OnDuplicate.Warn,
  ALLOWED_TARGETS: { $: "AllowListWarnRest", _0: [Allow(Target.Fn), Error(Target.WherePredicate)] },
  TEMPLATE: template(
    { Word: true, NameValueStr: ["reason"] },
    "https://doc.rust-lang.org/reference/attributes/testing.html#the-ignore-attribute",
  ),
  STABILITY: AttributeStability.Stable,

  // rustc: compiler/rustc_attr_parsing/src/attributes/test_attrs.rs:20 convert
  convert(cx, args) {
    let reason: Symbol | undefined;
    switch (args.$) {
      case "NoArgs":
        reason = undefined;
        break;
      case "NameValue": {
        const name_value = args._0;
        const str_value = name_value.value_as_str();
        if (str_value === undefined) {
          cx.adcx().warn_ill_formed_attribute_input(ILL_FORMED_ATTRIBUTE_INPUT);
          return undefined;
        }
        reason = str_value;
        break;
      }
      case "List": {
        const list = args._0;
        const single = list.as_single();
        const item = single === undefined ? undefined : MetaItemOrLitParser.meta_item(single);
        const help =
          item === undefined || ArgParser.as_no_args(item.args()).$ === "Err" ? undefined : display_PathParser(item.path());
        cx.adcx().warn_ill_formed_attribute_input_with_help(ILL_FORMED_ATTRIBUTE_INPUT, help);
        return undefined;
      }
    }
    return { $: "Ignore", span: cx.attr_span, reason };
  },
};

export const ShouldPanicParser: SingleAttributeParser = {
  ...SingleAttributeParser_provided,
  PATH: [sym.should_panic],
  ON_DUPLICATE: OnDuplicate.WarnButFutureError,
  ALLOWED_TARGETS: { $: "AllowListWarnRest", _0: [Allow(Target.Fn), Error(Target.WherePredicate)] },
  TEMPLATE: template(
    { Word: true, List: [`expected = "reason"`], NameValueStr: ["reason"] },
    "https://doc.rust-lang.org/reference/attributes/testing.html#the-should_panic-attribute",
  ),
  STABILITY: AttributeStability.Stable,

  // rustc: compiler/rustc_attr_parsing/src/attributes/test_attrs.rs:62 convert
  convert(cx, args) {
    let reason: Symbol | undefined;
    switch (args.$) {
      case "NoArgs":
        reason = undefined;
        break;
      case "NameValue":
        reason = cx.expect_string_literal(args._0, ExpectStringLiteral.NameValueParser);
        break;
      case "List": {
        const list = args._0;
        const single = cx.expect_single(list);
        if (single === undefined) return undefined;
        const r = cx.expect_name_value(single, MetaItemOrLitParser.span(single), sym.expected, ExpectNameValue.MetaItemOrLitParser);
        if (r === undefined) return undefined;
        const [ident, arg] = r;
        if (ident.name !== sym.expected) {
          cx.adcx().expected_specific_argument_strings(list.span, [sym.expected]);
          return undefined;
        }
        reason = cx.expect_string_literal(arg, ExpectStringLiteral.NameValueParser);
        break;
      }
    }
    return { $: "ShouldPanic", reason };
  },
};

export const ReexportTestHarnessMainParser: SingleAttributeParser = {
  ...SingleAttributeParser_provided,
  PATH: [sym.reexport_test_harness_main],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Crate)] },
  TEMPLATE: template({ NameValueStr: ["name"] }),
  STABILITY: unstable(sym.custom_test_frameworks),

  // rustc: compiler/rustc_attr_parsing/src/attributes/test_attrs.rs:90 convert
  convert(cx, args) {
    const nv = cx.expect_name_value(
      args,
      ArgParser.span(args) ?? cx.inner_span,
      sym.reexport_test_harness_main,
      ExpectNameValue.ArgParser,
    );
    if (nv === undefined) return undefined;

    const name = cx.expect_string_literal(nv, ExpectStringLiteral.NameValueParser);
    if (name === undefined) return undefined;

    return { $: "ReexportTestHarnessMain", _0: name };
  },
};

export const RustcAbiParser: SingleAttributeParser = {
  ...SingleAttributeParser_provided,
  PATH: [sym.rustc_abi],
  TEMPLATE: template({ OneOf: [sym.debug, sym.assert_eq] }),
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      Allow(Target.TyAlias),
      Allow(Target.Fn),
      Allow(Target.ForeignFn),
      Allow({ $: "Method", _0: MethodKind.Inherent }),
      Allow({ $: "Method", _0: { $: "Trait", body: true } }),
      Allow({ $: "Method", _0: { $: "Trait", body: false } }),
      Allow({ $: "Method", _0: MethodKind.TraitImpl }),
    ],
  },
  STABILITY: unstable(sym.rustc_attrs),

  // rustc: compiler/rustc_attr_parsing/src/attributes/test_attrs.rs:119 convert
  convert(cx, args_) {
    const args = ArgParser.as_list(args_);
    if (args === undefined) {
      const attr_span = cx.attr_span;
      cx.adcx().expected_specific_argument_and_list(attr_span, [sym.assert_eq, sym.debug]);
      return undefined;
    }

    const arg0 = cx.expect_single(args);
    if (arg0 === undefined) return undefined;

    const fail_incorrect_argument = (span: Span) =>
      cx.adcx().expected_specific_argument(span, [sym.assert_eq, sym.debug]);

    const arg = MetaItemOrLitParser.meta_item_no_args(arg0);
    if (arg === undefined) {
      fail_incorrect_argument(args.span);
      return undefined;
    }

    let kind: RustcAbiAttrKind;
    const w = arg.path().word_sym();
    if (w === sym.assert_eq) {
      kind = "AssertEq";
    } else if (w === sym.debug) {
      kind = "Debug";
    } else {
      fail_incorrect_argument(arg.span());
      return undefined;
    }

    return { $: "RustcAbi", attr_span: cx.attr_span, kind };
  },
};

export const RustcDelayedBugFromInsideQueryParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_delayed_bug_from_inside_query],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Fn)] },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => AttributeKind.RustcDelayedBugFromInsideQuery,
};

export const RustcEvaluateWhereClausesParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_evaluate_where_clauses],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      Allow(Target.Fn),
      Allow({ $: "Method", _0: MethodKind.Inherent }),
      Allow({ $: "Method", _0: { $: "Trait", body: true } }),
      Allow({ $: "Method", _0: MethodKind.TraitImpl }),
      Allow({ $: "Method", _0: { $: "Trait", body: false } }),
    ],
  },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => AttributeKind.RustcEvaluateWhereClauses,
};

export const TestRunnerParser: SingleAttributeParser = {
  ...SingleAttributeParser_provided,
  PATH: [sym.test_runner],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Crate)] },
  TEMPLATE: template({ List: ["path"] }),
  STABILITY: unstable(sym.custom_test_frameworks),

  // rustc: compiler/rustc_attr_parsing/src/attributes/test_attrs.rs:181 convert
  convert(cx, args) {
    const single = cx.expect_single_element_list(args, cx.attr_span);
    if (single === undefined) return undefined;

    const meta = MetaItemOrLitParser.meta_item_no_args(single);
    if (meta === undefined) {
      cx.adcx().expected_not_literal(MetaItemOrLitParser.span(single));
      return undefined;
    }

    return { $: "TestRunner", _0: clone_Path(meta.path()._0) };
  },
};

export const RustcTestMarkerParser: SingleAttributeParser = {
  ...SingleAttributeParser_provided,
  PATH: [sym.rustc_test_marker],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Const), Allow(Target.Fn), Allow(Target.Static)] },
  STABILITY: unstable(sym.rustc_attrs),
  TEMPLATE: template({ NameValueStr: ["test_path"] }),

  // rustc: compiler/rustc_attr_parsing/src/attributes/test_attrs.rs:205 convert
  convert(cx, args) {
    const name_value = cx.expect_name_value(args, cx.attr_span, sym.rustc_test_marker, ExpectNameValue.ArgParser);
    if (name_value === undefined) return undefined;
    const value_str = cx.expect_string_literal(name_value, ExpectStringLiteral.NameValueParser);
    if (value_str === undefined) return undefined;

    // `value_str.as_str().trim().is_empty()`: every char is `char::is_whitespace`
    if (Array.from(Symbol.as_str(value_str)).every((c) => is_whitespace(c.codePointAt(0)!))) {
      cx.adcx().expected_non_empty_string_literal(name_value.value_span);
      return undefined;
    }

    return { $: "RustcTestMarker", _0: value_str };
  },
};
