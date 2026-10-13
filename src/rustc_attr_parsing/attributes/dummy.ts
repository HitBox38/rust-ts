// Port of compiler/rustc_attr_parsing/src/attributes/dummy.rs
import { AttributeKind } from "../../rustc_attr_ir/lib.ts";
import { sym } from "../../rustc_span/symbol.ts";
import { ArgParser } from "../parser.ts";
import { unstable } from "../stability.ts";
import { AllowedTargets } from "../target_checking.ts";
import { template } from "../template.ts";
import { OnDuplicate, type SingleAttributeParser, SingleAttributeParser_provided } from "./mod.ts";

export const RustcDummyParser: SingleAttributeParser = {
  ...SingleAttributeParser_provided,
  PATH: [sym.rustc_dummy],
  ON_DUPLICATE: OnDuplicate.Ignore,
  ALLOWED_TARGETS: AllowedTargets.ManuallyChecked,
  TEMPLATE: template({ Word: true }), // Anything, really
  STABILITY: unstable(sym.rustc_attrs, "the `rustc_dummy` attribute is used for rustc unit tests"),

  // rustc: compiler/rustc_attr_parsing/src/attributes/dummy.rs:20 convert
  convert(cx, args) {
    ArgParser.ignore_args(args);
    cx.ignore_target_checks();
    return AttributeKind.RustcDummy;
  },
};
