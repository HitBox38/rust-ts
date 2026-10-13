// Port of compiler/rustc_attr_parsing/src/attributes/proc_macro_attrs.rs.
// Parser types are trait tables (attributes/mod.ts); see docs/handoff/attr-parse-a.md.
import { AttributeKind } from "../../rustc_attr_ir/lib.ts";
import { Target } from "../../rustc_attr_ir/target.ts";
import { AttributeStability, is_builtin_attr_name } from "../../rustc_feature/lib.ts";
import { AMBIGUOUS_DERIVE_HELPERS } from "../../rustc_lint_defs/builtin.ts";
import { sym, Symbol } from "../../rustc_span/symbol.ts";
import { unwrap } from "../../std/panic.ts";
import type { AcceptContext } from "../context.ts";
import { AmbiguousDeriveHelpers_diagnostic } from "../diagnostics.ts";
import { ArgParser, MetaItemOrLitParser } from "../parser.ts";
import { unstable } from "../stability.ts";
import { type AllowedTargets, Policy } from "../target_checking.ts";
import { template } from "../template.ts";
import { type NoArgsAttributeParser, NoArgsAttributeParser_provided, type SingleAttributeParser, SingleAttributeParser_provided } from "./mod.ts";

const { Allow, Warn } = Policy;

const PROC_MACRO_ALLOWED_TARGETS: AllowedTargets = {
  $: "AllowList",
  _0: [Allow(Target.Fn), Warn(Target.Crate), Warn(Target.MacroCall)],
};

export const ProcMacroParser: NoArgsAttributeParser = NoArgsAttributeParser_provided({
  PATH: [sym.proc_macro],
  ALLOWED_TARGETS: PROC_MACRO_ALLOWED_TARGETS,
  STABILITY: AttributeStability.Stable,
  CREATE: (_) => AttributeKind.ProcMacro,
});

export const ProcMacroAttributeParser: NoArgsAttributeParser = NoArgsAttributeParser_provided({
  PATH: [sym.proc_macro_attribute],
  ALLOWED_TARGETS: PROC_MACRO_ALLOWED_TARGETS,
  STABILITY: AttributeStability.Stable,
  CREATE: (_) => AttributeKind.ProcMacroAttribute,
});

export const ProcMacroDeriveParser: SingleAttributeParser = SingleAttributeParser_provided({
  PATH: [sym.proc_macro_derive],
  ALLOWED_TARGETS: PROC_MACRO_ALLOWED_TARGETS,
  TEMPLATE: template(
    { List: ["TraitName", "TraitName, attributes(name1, name2, ...)"] },
    "https://doc.rust-lang.org/reference/procedural-macros.html#derive-macros",
  ),
  STABILITY: AttributeStability.Stable,

  // rustc: compiler/rustc_attr_parsing/src/attributes/proc_macro_attrs.rs:35 convert
  convert(cx: AcceptContext, args: ArgParser): AttributeKind | undefined {
    const r = parse_derive_like(cx, args, true);
    if (r === undefined) return undefined;
    const [trait_name, helper_attrs] = r;
    return {
      $: "ProcMacroDerive",
      trait_name: unwrap(trait_name, "Trait name is mandatory, so it is present"),
      helper_attrs,
    };
  },
});

export const RustcBuiltinMacroParser: SingleAttributeParser = SingleAttributeParser_provided({
  PATH: [sym.rustc_builtin_macro],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.MacroDef)] },
  TEMPLATE: template({ List: ["TraitName", "TraitName, attributes(name1, name2, ...)"] }),
  STABILITY: unstable(sym.rustc_attrs),

  // rustc: compiler/rustc_attr_parsing/src/attributes/proc_macro_attrs.rs:53 convert
  convert(cx: AcceptContext, args: ArgParser): AttributeKind | undefined {
    const r = parse_derive_like(cx, args, false);
    if (r === undefined) return undefined;
    const [builtin_name, helper_attrs] = r;
    return { $: "RustcBuiltinMacro", builtin_name, helper_attrs };
  },
});

// rustc: compiler/rustc_attr_parsing/src/attributes/proc_macro_attrs.rs:59 parse_derive_like
function parse_derive_like(cx: AcceptContext, args: ArgParser, trait_name_mandatory: boolean): [Symbol | undefined, Symbol[]] | undefined {
  const list = ArgParser.as_list(args);
  if (list === undefined) {
    // For #[rustc_builtin_macro], it is permitted to leave out the trait name
    if (ArgParser.as_no_args(args).$ === "Ok" && !trait_name_mandatory) {
      return [undefined, []];
    }
    const attr_span = cx.attr_span;
    cx.adcx().expected_list(attr_span, args);
    return undefined;
  }
  const items = list.mixed();

  // Parse the name of the trait that is derived.
  const trait_attr_ = items.next();
  if (trait_attr_.done) {
    cx.adcx().expected_at_least_one_argument(list.span);
    return undefined;
  }
  const trait_attr = MetaItemOrLitParser.meta_item(trait_attr_.value);
  if (trait_attr === undefined) {
    cx.adcx().expected_not_literal(MetaItemOrLitParser.span(trait_attr_.value));
    return undefined;
  }
  const trait_ident = trait_attr.path().word();
  if (trait_ident === undefined) {
    cx.adcx().expected_identifier(trait_attr.path().span());
    return undefined;
  }
  if (!Symbol.can_be_raw(trait_ident.name)) {
    cx.adcx().expected_identifier(trait_ident.span);
    return undefined;
  }
  if (cx.expect_no_args(trait_attr.args()) === undefined) return undefined;

  // Parse optional attributes
  const attributes: Symbol[] = [];
  const attrs_ = items.next();
  if (!attrs_.done) {
    const attrs = attrs_.value;
    const attr_list_ = MetaItemOrLitParser.meta_item(attrs);
    if (attr_list_ === undefined) {
      cx.adcx().expected_not_literal(MetaItemOrLitParser.span(attrs));
      return undefined;
    }
    if (!attr_list_.path().word_is(sym.attributes)) {
      cx.adcx().expected_specific_argument(MetaItemOrLitParser.span(attrs), [sym.attributes]);
      return undefined;
    }
    const attr_list = cx.expect_list(attr_list_.args(), MetaItemOrLitParser.span(attrs));
    if (attr_list === undefined) return undefined;

    // Parse item in `attributes(...)` argument
    for (const attr_ of attr_list.mixed()) {
      const attr = MetaItemOrLitParser.meta_item(attr_);
      if (attr === undefined) {
        cx.adcx().expected_identifier(MetaItemOrLitParser.span(attr_));
        return undefined;
      }
      if (cx.expect_no_args(attr.args()) === undefined) return undefined;
      const ident = attr.path().word();
      if (ident === undefined) {
        cx.adcx().expected_identifier(attr.path().span());
        return undefined;
      }
      if (!Symbol.can_be_raw(ident.name)) {
        cx.adcx().expected_identifier(ident.span);
        return undefined;
      }
      if (is_builtin_attr_name(ident.name)) {
        cx.shared.emit_lint(AMBIGUOUS_DERIVE_HELPERS, AmbiguousDeriveHelpers_diagnostic({}), ident.span);
      }
      attributes.push(ident.name);
    }
  }

  // If anything else is specified, we should reject it
  const next = items.next();
  if (!next.done) {
    cx.adcx().expected_no_args(MetaItemOrLitParser.span(next.value));
  }

  return [trait_ident.name, attributes];
}
