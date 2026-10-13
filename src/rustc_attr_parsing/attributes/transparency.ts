// Port of compiler/rustc_attr_parsing/src/attributes/transparency.rs
import { Transparency } from "../../rustc_span/hygiene.ts";
import { ExpectNameValue } from "../context.ts";
import { SingleAttributeParser_provided } from "./mod.ts";
import { Allow, type SingleAttributeParser, sym, Target, template, unstable } from "./prelude.ts";

export const RustcMacroTransparencyParser: SingleAttributeParser = SingleAttributeParser_provided({
  PATH: [sym.rustc_macro_transparency],
  STABILITY: unstable(sym.rustc_attrs),
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.MacroDef)] },
  TEMPLATE: template({ NameValueStr: ["transparent", "semiopaque", "opaque"] }),

  // rustc: compiler/rustc_attr_parsing/src/attributes/transparency.rs:16 convert
  convert(cx, args) {
    const nv = cx.expect_name_value(args, cx.attr_span, undefined, ExpectNameValue.ArgParser);
    if (nv === undefined) return undefined;
    let t: Transparency | undefined;
    const v = nv.value_as_str();
    if (v === sym.transparent) {
      t = Transparency.Transparent;
    } else if (v === sym.semiopaque) {
      t = Transparency.SemiOpaque;
    } else if (v === sym.opaque) {
      t = Transparency.Opaque;
    } else if (v !== undefined) {
      cx.adcx().expected_specific_argument_strings(nv.value_span, [sym.transparent, sym.semiopaque, sym.opaque]);
      t = undefined;
    } else {
      t = undefined;
    }
    // `.map(AttributeKind::RustcMacroTransparency)`
    return t === undefined ? undefined : { $: "RustcMacroTransparency", _0: t };
  },
});
