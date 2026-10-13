// Port of compiler/rustc_attr_parsing/src/attributes/instruction_set.rs
// (Conventions for `use super::prelude::*` / `unstable!`: see inline.ts.)
import { type InstructionSetAttr, target as target_mod } from "../../rustc_attr_ir/lib.ts";
import { AttributeStability } from "../../rustc_feature/lib.ts";
import { type Symbol, sym } from "../../rustc_span/symbol.ts";
import * as diagnostics from "../diagnostics.ts";
import { MetaItemOrLitParser } from "../parser.ts";
import { template } from "../template.ts";
import { type SingleAttributeParser, SingleAttributeParser_provided } from "./mod.ts";

const { Target, MethodKind } = target_mod;

export const InstructionSetParser: SingleAttributeParser = {
  ...SingleAttributeParser_provided,
  PATH: [sym.instruction_set],
  ALLOWED_TARGETS: {
    $: "AllowListWarnRest",
    _0: [
      { $: "Allow", _0: Target.Fn },
      { $: "Allow", _0: Target.Closure },
      { $: "Allow", _0: { $: "Method", _0: MethodKind.Inherent } },
      { $: "Allow", _0: { $: "Method", _0: MethodKind.TraitImpl } },
      { $: "Allow", _0: { $: "Method", _0: { $: "Trait", body: true } } },
    ],
  },
  TEMPLATE: template(
    { List: ["set"] },
    "https://doc.rust-lang.org/reference/attributes/codegen.html#the-instruction_set-attribute",
  ),
  STABILITY: AttributeStability.Stable,

  // rustc: compiler/rustc_attr_parsing/src/attributes/instruction_set.rs:21 convert
  convert(cx, args) {
    const POSSIBLE_SYMBOLS: readonly Symbol[] = [sym.arm_a32, sym.arm_t32];
    const POSSIBLE_ARM_SYMBOLS: readonly Symbol[] = [sym.a32, sym.t32];
    const maybe_meta_item = cx.expect_single_element_list(args, cx.attr_span);
    if (maybe_meta_item === undefined) return undefined;

    const meta_item = MetaItemOrLitParser.meta_item_no_args(maybe_meta_item);
    if (meta_item === undefined) {
      cx.adcx().expected_specific_argument(MetaItemOrLitParser.span(maybe_meta_item), POSSIBLE_SYMBOLS);
      return undefined;
    }

    const segments = meta_item.path().segments();

    const architecture_ = segments.next();
    if (architecture_.done) {
      cx.adcx().expected_specific_argument(meta_item.span(), POSSIBLE_SYMBOLS);
      return undefined;
    }
    const architecture = architecture_.value;

    const instruction_set_ = segments.next();
    if (instruction_set_.done) {
      cx.adcx().expected_specific_argument(architecture.span, POSSIBLE_SYMBOLS);
      return undefined;
    }
    const instruction_set_ident = instruction_set_.value;

    let instruction_set: InstructionSetAttr;
    switch (architecture.name) {
      case sym.arm: {
        const sess = cx.shared.cx.sess_;
        if (!sess.target.has_thumb_interworking) {
          cx.shared.cx.dcx().emit_err(
            diagnostics.UnsupportedInstructionSet_diagnostic({
              span: cx.attr_span,
              instruction_set: sym.arm,
              current_target: sess.opts.target_triple,
            }),
          );
          return undefined;
        }
        switch (instruction_set_ident.name) {
          case sym.a32:
            instruction_set = "ArmA32";
            break;
          case sym.t32:
            instruction_set = "ArmT32";
            break;
          default: {
            cx.adcx().expected_specific_argument(instruction_set_ident.span, POSSIBLE_ARM_SYMBOLS);
            return undefined;
          }
        }
        break;
      }
      default: {
        cx.adcx().expected_specific_argument(architecture.span, POSSIBLE_SYMBOLS);
        return undefined;
      }
    }

    return { $: "InstructionSet", _0: instruction_set };
  },
};
