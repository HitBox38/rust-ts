// Port of compiler/rustc_attr_parsing/src/attributes/cfi_encoding.rs
import { is_whitespace } from "../../std/char.ts";
import { ExpectNameValue, ExpectStringLiteral } from "../context.ts";
import { SingleAttributeParser_provided } from "./mod.ts";
import { Allow, type SingleAttributeParser, Symbol, sym, Target, template, unstable } from "./prelude.ts";

export const CfiEncodingParser: SingleAttributeParser = SingleAttributeParser_provided({
  PATH: [sym.cfi_encoding],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [Allow(Target.Struct), Allow(Target.ForeignTy), Allow(Target.Enum), Allow(Target.Union)],
  },
  TEMPLATE: template({ NameValueStr: ["encoding"] }),
  STABILITY: unstable(sym.cfi_encoding),

  // rustc: compiler/rustc_attr_parsing/src/attributes/cfi_encoding.rs:16 convert
  convert(cx, args) {
    const name_value = cx.expect_name_value(args, cx.attr_span, sym.cfi_encoding, ExpectNameValue.ArgParser);
    if (name_value === undefined) return undefined;

    const value_str = cx.expect_string_literal(name_value, ExpectStringLiteral.NameValueParser);
    if (value_str === undefined) return undefined;

    // `value_str.as_str().trim().is_empty()`: every char is `char::is_whitespace`
    if (Array.from(Symbol.as_str(value_str)).every((c) => is_whitespace(c.codePointAt(0)!))) {
      cx.adcx().expected_non_empty_string_literal(name_value.value_span);
      return undefined;
    }

    return { $: "CfiEncoding", encoding: value_str };
  },
});
