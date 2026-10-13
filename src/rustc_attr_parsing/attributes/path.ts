// Port of compiler/rustc_attr_parsing/src/attributes/path.rs
import { AttributeStability } from "../../rustc_feature/lib.ts";
import { ExpectNameValue, ExpectStringLiteral } from "../context.ts";
import { SingleAttributeParser_provided } from "./mod.ts";
import { Allow, Error, OnDuplicate, type SingleAttributeParser, sym, Target, template } from "./prelude.ts";

export const PathParser: SingleAttributeParser = {
  ...SingleAttributeParser_provided,
  PATH: [sym.path],
  ON_DUPLICATE: OnDuplicate.WarnButFutureError,
  ALLOWED_TARGETS: { $: "AllowListWarnRest", _0: [Allow(Target.Mod), Error(Target.Crate)] },
  TEMPLATE: template(
    { NameValueStr: ["file"] },
    "https://doc.rust-lang.org/reference/items/modules.html#the-path-attribute",
  ),
  STABILITY: AttributeStability.Stable,

  // rustc: compiler/rustc_attr_parsing/src/attributes/path.rs:18 convert
  convert(cx, args) {
    const nv = cx.expect_name_value(args, cx.attr_span, undefined, ExpectNameValue.ArgParser);
    if (nv === undefined) return undefined;
    const path = cx.expect_string_literal(nv, ExpectStringLiteral.NameValueParser);
    if (path === undefined) return undefined;

    return { $: "Path", _0: path, _1: cx.attr_span };
  },
};
