// Port of compiler/rustc_attr_parsing/src/attributes/deprecation.rs
// (Conventions for `use super::prelude::*` / `unstable!`: see inline.ts.)
import { display_LitKind } from "../../rustc_ast/util/literal.ts";
import { type DeprecatedSince, Deprecation, RustcVersion, target as target_mod, VERSION_PLACEHOLDER } from "../../rustc_attr_ir/lib.ts";
import { AttributeStability } from "../../rustc_feature/lib.ts";
import { UNUSED_ATTRIBUTES } from "../../rustc_lint_defs/builtin.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { type Ident, Symbol, sym } from "../../rustc_span/symbol.ts";
import { type AcceptContext, ExpectNameValue } from "../context.ts";
import {
  DeprecatedAnnotationHasNoEffect_diagnostic,
  DeprecatedItemSuggestion_diagnostic,
  InvalidSince_diagnostic,
  MissingNote_diagnostic,
  MissingSince_diagnostic,
} from "../diagnostics.ts";
import { ArgParser, MetaItemOrLitParser } from "../parser.ts";
import { template } from "../template.ts";
import { type SingleAttributeParser, SingleAttributeParser_provided } from "./mod.ts";
import { parse_version } from "./util.ts";

const { Target, MethodKind, AssocCtxt } = target_mod;

// rustc: compiler/rustc_attr_parsing/src/attributes/deprecation.rs:14 get
function get(
  cx: AcceptContext,
  name: Symbol,
  param_span: Span,
  arg: ArgParser,
  item: Symbol | undefined,
): Ident | undefined {
  if (item !== undefined) {
    cx.adcx().duplicate_key(param_span, name);
    return undefined;
  }
  const v = cx.expect_name_value(arg, param_span, name, ExpectNameValue.ArgParser);
  if (v === undefined) return undefined;
  const value_str = v.value_as_ident();
  if (value_str !== undefined) {
    return value_str;
  } else {
    cx.adcx().expected_string_literal(v.value_span, v.value_as_lit());
    return undefined;
  }
}

export const DeprecatedParser: SingleAttributeParser = {
  ...SingleAttributeParser_provided,
  PATH: [sym.deprecated],
  ALLOWED_TARGETS: {
    $: "AllowListWarnRest",
    _0: [
      { $: "Allow", _0: Target.Fn },
      { $: "Allow", _0: Target.Mod },
      { $: "Allow", _0: Target.Struct },
      { $: "Allow", _0: Target.Enum },
      { $: "Allow", _0: Target.Union },
      { $: "Allow", _0: Target.Const },
      { $: "Allow", _0: Target.Static },
      { $: "Allow", _0: Target.MacroDef },
      { $: "Allow", _0: { $: "Method", _0: MethodKind.Inherent } },
      { $: "Allow", _0: { $: "Method", _0: { $: "Trait", body: false } } },
      { $: "Allow", _0: { $: "Method", _0: { $: "Trait", body: true } } },
      { $: "Allow", _0: Target.TyAlias },
      { $: "Allow", _0: Target.Use },
      { $: "Allow", _0: Target.ForeignFn },
      { $: "Allow", _0: Target.ForeignStatic },
      { $: "Allow", _0: Target.ForeignTy },
      { $: "Allow", _0: Target.Field },
      { $: "Allow", _0: Target.Trait },
      { $: "Allow", _0: { $: "AssocConst", _0: { $: "Impl", of_trait: false } } },
      { $: "Allow", _0: { $: "AssocConst", _0: AssocCtxt.Trait } },
      { $: "AllowSilent", _0: { $: "AssocConst", _0: { $: "Impl", of_trait: true } } },
      { $: "Allow", _0: { $: "AssocTy", _0: { $: "Impl", of_trait: false } } },
      { $: "Allow", _0: { $: "AssocTy", _0: AssocCtxt.Trait } },
      { $: "AllowSilent", _0: { $: "AssocTy", _0: { $: "Impl", of_trait: true } } },
      { $: "Allow", _0: Target.Variant },
      { $: "Allow", _0: { $: "Impl", of_trait: false } },
      { $: "Allow", _0: Target.Crate },
      { $: "Error", _0: Target.WherePredicate },
    ],
  },
  TEMPLATE: template({
    Word: true,
    List: ['since = "version"', 'note = "reason"', 'since = "version", note = "reason"'],
    NameValueStr: ["reason"],
  }),
  STABILITY: AttributeStability.Stable,

  // rustc: compiler/rustc_attr_parsing/src/attributes/deprecation.rs:74 convert
  convert(cx, args) {
    const features = cx.shared.cx.features();

    let since: Symbol | undefined = undefined;
    let note: Ident | undefined = undefined;
    let suggestion: Symbol | undefined = undefined;

    const is_rustc = features.staged_api();

    switch (args.$) {
      case "NoArgs": {
        // ok
        break;
      }
      case "List": {
        const list = args._0;
        // If the argument list contains a single string literal:
        // check whether it may be a version and suggest since field
        // otherwise, suggest using NameValue syntax
        const elem = list.as_single();
        const lit = elem === undefined ? undefined : MetaItemOrLitParser.as_lit(elem);
        if (elem !== undefined && lit !== undefined && lit.kind.$ === "Str") {
          const text = lit.kind._0;
          const adcx = cx.adcx();

          const parsed = parse_since(text, true);
          switch (parsed.$) {
            case "Future":
            case "RustcVersion": {
              adcx.push_suggestion(
                "try specifying a deprecated since version",
                MetaItemOrLitParser.span(elem),
                `since = ${display_LitKind(lit.kind)}`,
              );
              break;
            }
            default: {
              const span = ArgParser.span(args);
              if (span !== undefined) {
                adcx.push_suggestion("try using `=` instead", span, ` = ${display_LitKind(lit.kind)}`);
              }
            }
          }

          adcx.expected_not_literal(MetaItemOrLitParser.span(elem));
          return undefined;
        }

        for (const param_ of list.mixed()) {
          const param = MetaItemOrLitParser.meta_item(param_);
          if (param === undefined) {
            cx.adcx().expected_not_literal(MetaItemOrLitParser.span(param_));
            return undefined;
          }

          const ident_name = param.path().word_sym();

          switch (ident_name) {
            case sym.since: {
              const name = ident_name;
              const r = get(cx, name, param.span(), param.args(), since);
              if (r === undefined) return undefined;
              since = r.name;
              break;
            }
            case sym.note: {
              const name = ident_name;
              const r = get(cx, name, param.span(), param.args(), note === undefined ? undefined : note.name);
              if (r === undefined) return undefined;
              note = r;
              break;
            }
            case sym.suggestion: {
              const name = ident_name;
              if (!features.deprecated_suggestion()) {
                cx.shared.emit_err(
                  DeprecatedItemSuggestion_diagnostic({
                    span: param.span(),
                    is_nightly: cx.shared.cx.sess().is_nightly_build(),
                    details: undefined,
                  }),
                );
              }

              const r = get(cx, name, param.span(), param.args(), suggestion);
              if (r === undefined) return undefined;
              suggestion = r.name;
              break;
            }
            default: {
              cx.adcx().expected_specific_argument(
                param.span(),
                features.deprecated_suggestion() ? [sym.since, sym.note, sym.suggestion] : [sym.since, sym.note],
              );
              return undefined;
            }
          }
        }
        break;
      }
      case "NameValue": {
        const v = args._0;
        const value = v.value_as_ident();
        if (value === undefined) {
          cx.adcx().expected_string_literal(v.value_span, v.value_as_lit());
          return undefined;
        }
        note = value;
        break;
      }
    }

    let since_: DeprecatedSince;
    if (since !== undefined) {
      const since__ = parse_since(since, is_rustc);
      if (since__.$ === "Err") {
        cx.shared.emit_err(InvalidSince_diagnostic({ span: cx.attr_span }));
      }
      since_ = since__;
    } else if (is_rustc) {
      cx.shared.emit_err(MissingSince_diagnostic({ span: cx.attr_span }));
      since_ = { $: "Err" };
    } else {
      since_ = { $: "Unspecified" };
    }

    if (is_rustc && note === undefined) {
      cx.shared.emit_err(MissingNote_diagnostic({ span: cx.attr_span }));
      return undefined;
    }

    // `#[deprecated]` on trait-impl associated items has no effect (deprecation comes from the
    // trait definition). Methods also get `useless_deprecated` from target checking.
    const target = cx.shared.target;
    if (
      (target.$ === "Method" && target._0.$ === "TraitImpl") ||
      (target.$ === "AssocConst" && target._0.$ === "Impl" && target._0.of_trait === true) ||
      (target.$ === "AssocTy" && target._0.$ === "Impl" && target._0.of_trait === true)
    ) {
      const attr_span = cx.attr_span;
      cx.shared.emit_lint(UNUSED_ATTRIBUTES, DeprecatedAnnotationHasNoEffect_diagnostic({ span: attr_span }), attr_span);
    }

    return {
      $: "Deprecated",
      deprecation: new Deprecation(since_, note, suggestion),
      span: cx.attr_span,
    };
  },
};

// rustc: compiler/rustc_attr_parsing/src/attributes/deprecation.rs:217 parse_since
function parse_since(since: Symbol, is_rustc: boolean): DeprecatedSince {
  if (Symbol.as_str(since) === "TBD") {
    return { $: "Future" };
  } else if (!is_rustc) {
    return { $: "NonStandard", _0: since };
  } else if (Symbol.as_str(since) === VERSION_PLACEHOLDER) {
    return { $: "RustcVersion", _0: RustcVersion.CURRENT };
  } else {
    const version = parse_version(since);
    if (version !== undefined) {
      return { $: "RustcVersion", _0: version };
    } else {
      return { $: "Err" };
    }
  }
}
