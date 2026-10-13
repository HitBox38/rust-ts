// Port of compiler/rustc_attr_parsing/src/attributes/stability.rs
// (Conventions for `use super::prelude::*` / `unstable!`: see inline.ts.)
//
// PORT:
// - Parser states are interfaces; the inherent `impl StabilityParser { fn check_duplicate }` (and
//   `ConstStabilityParser`'s) is `<Parser>_inherent`, spread into the parser's table (see repr.ts).
// - `&mut Option<Symbol>` out-parameters are `MutRef<Symbol | undefined>`; `Option<()>` is
//   `[] | undefined` (as `AcceptContext::expect_no_args`).
// - `issue_str.parse::<NonZero<u32>>()` is `u32_from_str` (rustc_session/options.ts), then
//   `IntErrorKind::Zero` for 0.
import type { ErrorGuaranteed } from "../../rustc_errors/lib.ts";
import {
  type DefaultBodyStability,
  PartialConstStability,
  Stability,
  type StabilityLevel,
  type StableSince,
  target as target_mod,
  UnstableReason,
  type UnstableRemovedFeature,
  VERSION_PLACEHOLDER,
} from "../../rustc_attr_ir/lib.ts";
import { ACCEPTED_LANG_FEATURES } from "../../rustc_feature/lib.ts";
import { is_ident } from "../../rustc_lexer/lib.ts";
import { u32_from_str } from "../../rustc_session/options.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { type Ident, Symbol, sym } from "../../rustc_span/symbol.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { type AcceptContext, ExpectNameValue, ExpectStringLiteral } from "../context.ts";
import * as diagnostics from "../diagnostics.ts";
import { ArgParser, MetaItemOrLitParser, type MetaItemParser } from "../parser.ts";
import type { AllowedTargets } from "../target_checking.ts";
import { unstable } from "../stability.ts";
import { template } from "../template.ts";
import {
  type AttributeParser,
  AttributeParser_provided,
  type CombineAttributeParser,
  CombineAttributeParser_provided,
  OnDuplicate,
  type NoArgsAttributeParser,
  NoArgsAttributeParser_provided,
} from "./mod.ts";
import { parse_version } from "./util.ts";

const { Target, MethodKind, AssocCtxt } = target_mod;

const ALLOWED_TARGETS: AllowedTargets = {
  $: "AllowList",
  _0: [
    { $: "Allow", _0: Target.Fn },
    { $: "Allow", _0: Target.Struct },
    { $: "Allow", _0: Target.Enum },
    { $: "Allow", _0: Target.Union },
    { $: "Allow", _0: { $: "Method", _0: MethodKind.Inherent } },
    { $: "Allow", _0: { $: "Method", _0: { $: "Trait", body: false } } },
    { $: "Allow", _0: { $: "Method", _0: { $: "Trait", body: true } } },
    { $: "Allow", _0: { $: "Method", _0: MethodKind.TraitImpl } },
    { $: "Allow", _0: { $: "Impl", of_trait: false } },
    { $: "Allow", _0: { $: "Impl", of_trait: true } },
    { $: "Allow", _0: Target.MacroDef },
    { $: "Allow", _0: Target.Crate },
    { $: "Allow", _0: Target.Mod },
    { $: "Allow", _0: Target.Use }, // FIXME I don't think this does anything?
    { $: "Allow", _0: Target.Const },
    { $: "Allow", _0: { $: "AssocConst", _0: { $: "Impl", of_trait: false } } },
    { $: "Allow", _0: { $: "AssocConst", _0: AssocCtxt.Trait } },
    { $: "Allow", _0: { $: "AssocConst", _0: { $: "Impl", of_trait: true } } },
    { $: "Allow", _0: { $: "AssocTy", _0: { $: "Impl", of_trait: false } } },
    { $: "Allow", _0: { $: "AssocTy", _0: AssocCtxt.Trait } },
    { $: "Allow", _0: { $: "AssocTy", _0: { $: "Impl", of_trait: true } } },
    { $: "Allow", _0: Target.Trait },
    { $: "Allow", _0: Target.TraitAlias },
    { $: "Allow", _0: Target.TyAlias },
    { $: "Allow", _0: Target.Variant },
    { $: "Allow", _0: Target.Field },
    { $: "Allow", _0: Target.TypeParam },
    { $: "Allow", _0: Target.Static },
    { $: "Allow", _0: Target.ForeignFn },
    { $: "Allow", _0: Target.ForeignStatic },
    { $: "Allow", _0: Target.ForeignTy },
    { $: "Allow", _0: Target.ExternCrate },
  ],
};

/** `#[derive(Default)] pub(crate) struct StabilityParser` */
export interface StabilityParser {
  allowed_through_unstable_modules: [Symbol, Symbol] | undefined;
  stability: [Stability, Span] | undefined;
}

/** `impl StabilityParser` */
const StabilityParser_inherent = {
  /// Checks, and emits an error when a stability (or unstability) was already set, which would be a duplicate.
  // rustc: compiler/rustc_attr_parsing/src/attributes/stability.rs:59 check_duplicate
  check_duplicate(self: StabilityParser, cx: AcceptContext): boolean {
    if (self.stability !== undefined) {
      cx.shared.emit_err(diagnostics.MultipleStabilityLevels_diagnostic({ span: cx.attr_span }));
      return true;
    } else {
      return false;
    }
  },
};

export const StabilityParser: AttributeParser<StabilityParser> & typeof StabilityParser_inherent = {
  ...StabilityParser_inherent,
  ...AttributeParser_provided<StabilityParser>({
    default: () => ({ allowed_through_unstable_modules: undefined, stability: undefined }),
    ATTRIBUTES: [
      [
        [sym.stable],
        template({ List: ['feature = "name", since = "version"'] }),
        unstable(sym.staged_api),
        (this_, cx, args) => {
          let r;
          if (!StabilityParser_inherent.check_duplicate(this_, cx) && (r = parse_stability(cx, args)) !== undefined) {
            const [feature, level] = r;
            this_.stability = [new Stability(level, feature), cx.attr_span];
          }
        },
      ],
      [
        [sym.unstable],
        template({ List: ['feature = "name", reason = "...", issue = "N"'] }),
        unstable(sym.staged_api),
        (this_, cx, args) => {
          let r;
          if (!StabilityParser_inherent.check_duplicate(this_, cx) && (r = parse_unstability(cx, args)) !== undefined) {
            const [feature, level] = r;
            this_.stability = [new Stability(level, feature), cx.attr_span];
          }
        },
      ],
      [
        [sym.rustc_allowed_through_unstable_modules],
        template({ List: ['message = "...", module = "...'] }),
        unstable(sym.staged_api),
        (this_, cx, args) => {
          const list = cx.expect_list(args, cx.attr_span);
          if (list === undefined) return;
          let message: Symbol | undefined = undefined;
          let module: Symbol | undefined = undefined;

          for (const item of list.mixed()) {
            const nv = ExpectNameValue.MetaItemOrLitParser.expect_name_value(item, cx, MetaItemOrLitParser.span(item), undefined);
            if (nv === undefined) {
              return;
            }
            const [name, value_] = nv;
            const value = cx.expect_string_literal(value_, ExpectStringLiteral.NameValueParser);
            if (value === undefined) {
              return;
            }

            switch (name.name) {
              case sym.message: {
                if (message !== undefined) {
                  cx.adcx().duplicate_key(name.span, name.name);
                } else {
                  message = value;
                }
                break;
              }
              case sym.module: {
                if (module !== undefined) {
                  cx.adcx().duplicate_key(name.span, name.name);
                } else {
                  module = value;
                }
                break;
              }
              default: {
                cx.adcx().expected_specific_argument(name.span, [sym.message, sym.module]);
              }
            }
          }

          const allowed_through_unstable_modules: [Symbol, Symbol] | undefined =
            message !== undefined && module !== undefined ? [message, module] : undefined;
          if (allowed_through_unstable_modules === undefined) {
            cx.shared.emit_err(diagnostics.RustcAtumMissingParams_diagnostic({ span: cx.attr_span }));
          }

          this_.allowed_through_unstable_modules = allowed_through_unstable_modules;
        },
      ],
    ],
    ALLOWED_TARGETS: ALLOWED_TARGETS,

    // rustc: compiler/rustc_attr_parsing/src/attributes/stability.rs:147 finalize
    finalize(self, cx) {
      if (self.allowed_through_unstable_modules !== undefined) {
        const atum = self.allowed_through_unstable_modules;
        if (self.stability !== undefined && self.stability[0].level.$ === "Stable") {
          self.stability[0].level.allowed_through_unstable_modules = atum;
        } else {
          cx.shared.cx.dcx().emit_err(diagnostics.RustcAllowedUnstablePairing_diagnostic({ span: cx.shared.target_span }));
        }
      }

      if (self.stability !== undefined && self.stability[0].level.$ === "Stable") {
        for (const other_attr of cx.all_attrs) {
          if (other_attr.word_is(sym.unstable_feature_bound)) {
            cx.shared.emit_err(
              diagnostics.UnstableFeatureBoundIncompatibleStability_diagnostic({
                span: cx.shared.target_span,
              }),
            );
          }
        }
      }

      if (self.stability === undefined) return undefined;
      const [stability, span] = self.stability;

      return { $: "Stability", stability, span };
    }
  }),
};

// FIXME(jdonszelmann) change to Single
/** `#[derive(Default)] pub(crate) struct BodyStabilityParser` */
export interface BodyStabilityParser {
  stability: [DefaultBodyStability, Span] | undefined;
}

export const BodyStabilityParser: AttributeParser<BodyStabilityParser> = AttributeParser_provided<BodyStabilityParser>({
  default: () => ({ stability: undefined }),
  ATTRIBUTES: [
    [
      [sym.rustc_default_body_unstable],
      template({ List: ['feature = "name", reason = "...", issue = "N"'] }),
      unstable(sym.staged_api),
      (this_, cx, args) => {
        let r;
        if (this_.stability !== undefined) {
          cx.shared.cx.dcx().emit_err(diagnostics.MultipleStabilityLevels_diagnostic({ span: cx.attr_span }));
        } else if ((r = parse_unstability(cx, args)) !== undefined) {
          const [feature, level] = r;
          this_.stability = [{ level, feature }, cx.attr_span];
        }
      },
    ],
  ],
  ALLOWED_TARGETS: ALLOWED_TARGETS,

  // rustc: compiler/rustc_attr_parsing/src/attributes/stability.rs:201 finalize
  finalize(self, _cx) {
    if (self.stability === undefined) return undefined;
    const [stability, span] = self.stability;

    return { $: "RustcBodyStability", stability, span };
  },
});

export const RustcConstStableIndirectParser: NoArgsAttributeParser = NoArgsAttributeParser_provided({
  PATH: [sym.rustc_const_stable_indirect],
  ON_DUPLICATE: OnDuplicate.Ignore,
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      { $: "Allow", _0: Target.Fn },
      { $: "Allow", _0: { $: "Method", _0: MethodKind.Inherent } },
    ],
  },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => ({ $: "RustcConstStableIndirect" }),
});

/** `#[derive(Default)] pub(crate) struct ConstStabilityParser` */
export interface ConstStabilityParser {
  promotable: boolean;
  stability: [PartialConstStability, Span] | undefined;
}

/** `impl ConstStabilityParser` */
const ConstStabilityParser_inherent = {
  /// Checks, and emits an error when a stability (or unstability) was already set, which would be a duplicate.
  // rustc: compiler/rustc_attr_parsing/src/attributes/stability.rs:228 check_duplicate
  check_duplicate(self: ConstStabilityParser, cx: AcceptContext): boolean {
    if (self.stability !== undefined) {
      cx.shared.emit_err(diagnostics.MultipleStabilityLevels_diagnostic({ span: cx.attr_span }));
      return true;
    } else {
      return false;
    }
  },
};

export const ConstStabilityParser: AttributeParser<ConstStabilityParser> & typeof ConstStabilityParser_inherent = {
  ...ConstStabilityParser_inherent,
  ...AttributeParser_provided<ConstStabilityParser>({
    default: () => ({ promotable: false, stability: undefined }),
    ATTRIBUTES: [
      [
        [sym.rustc_const_stable],
        template({ List: ['feature = "name"'] }),
        unstable(sym.staged_api),
        (this_, cx, args) => {
          let r;
          if (!ConstStabilityParser_inherent.check_duplicate(this_, cx) && (r = parse_stability(cx, args)) !== undefined) {
            const [feature, level] = r;
            this_.stability = [new PartialConstStability(level, feature, false), cx.attr_path.span];
          }
        },
      ],
      [
        [sym.rustc_const_unstable],
        template({ List: ['feature = "name"'] }),
        unstable(sym.staged_api),
        (this_, cx, args) => {
          let r;
          if (!ConstStabilityParser_inherent.check_duplicate(this_, cx) && (r = parse_unstability(cx, args)) !== undefined) {
            const [feature, level] = r;
            this_.stability = [new PartialConstStability(level, feature, false), cx.attr_path.span];
          }
        },
      ],
      [
        [sym.rustc_promotable],
        template({ Word: true }),
        unstable(sym.staged_api),
        (this_, _cx, _) => {
          this_.promotable = true;
        },
      ],
    ],
    ALLOWED_TARGETS: {
      $: "AllowList",
      _0: [
        { $: "Allow", _0: Target.Fn },
        { $: "Allow", _0: { $: "Method", _0: MethodKind.Inherent } },
        { $: "Allow", _0: { $: "Method", _0: MethodKind.TraitImpl } },
        { $: "Allow", _0: { $: "Method", _0: { $: "Trait", body: true } } },
        { $: "Allow", _0: { $: "Impl", of_trait: false } },
        { $: "Allow", _0: { $: "Impl", of_trait: true } },
        { $: "Allow", _0: Target.Use }, // FIXME I don't think this does anything?
        { $: "Allow", _0: Target.Const },
        { $: "Allow", _0: { $: "AssocConst", _0: { $: "Impl", of_trait: false } } },
        { $: "Allow", _0: { $: "AssocConst", _0: AssocCtxt.Trait } },
        { $: "Allow", _0: { $: "AssocConst", _0: { $: "Impl", of_trait: true } } },
        { $: "Allow", _0: Target.Trait },
        { $: "Allow", _0: Target.Static },
        { $: "Allow", _0: Target.Crate },
      ],
    },

    // rustc: compiler/rustc_attr_parsing/src/attributes/stability.rs:291 finalize
    finalize(self, cx) {
      if (self.promotable) {
        if (self.stability !== undefined) {
          const stab = self.stability[0];
          stab.promotable = true;
        } else {
          cx.shared.cx.dcx().emit_err(diagnostics.RustcPromotablePairing_diagnostic({ span: cx.shared.target_span }));
        }
      }

      if (self.stability === undefined) return undefined;
      const [stability, span] = self.stability;

      return { $: "RustcConstStability", stability, span };
    }
  }),
};

/// Tries to insert the value of a `key = value` meta item into an option.
///
/// Emits an error when either the option was already Some, or the arguments weren't of form
/// `name = value`
// rustc: compiler/rustc_attr_parsing/src/attributes/stability.rs:310 insert_value_into_option_or_error
function insert_value_into_option_or_error(
  cx: AcceptContext,
  param: MetaItemParser,
  item: MutRef<Symbol | undefined>,
  name: Ident,
): [] | undefined {
  if (item.value !== undefined) {
    cx.adcx().duplicate_key(name.span, name.name);
    return undefined;
  }

  const nv = cx.expect_name_value(param, param.span(), name.name, ExpectNameValue.MetaItemParser);
  if (nv === undefined) return undefined;
  const [_ident, arg] = nv;
  const s = cx.expect_string_literal(arg, ExpectStringLiteral.NameValueParser);
  if (s === undefined) return undefined;

  item.value = s;

  return [];
}

/// Read the content of a `stable`/`rustc_const_stable` attribute, and return the feature name and
/// its stability information.
// rustc: compiler/rustc_attr_parsing/src/attributes/stability.rs:331 parse_stability
export function parse_stability(cx: AcceptContext, args: ArgParser): [Symbol, StabilityLevel] | undefined {
  const feature: MutRef<Symbol | undefined> = { value: undefined };
  const since: MutRef<Symbol | undefined> = { value: undefined };

  const list = cx.expect_list(args, cx.attr_span);
  if (list === undefined) return undefined;

  for (const param_ of list.mixed()) {
    const param_span = MetaItemOrLitParser.span(param_);
    const param = MetaItemOrLitParser.meta_item(param_);
    if (param === undefined) {
      cx.adcx().expected_not_literal(MetaItemOrLitParser.span(param_));
      return undefined;
    }

    const word = param.path().word();
    switch (word === undefined ? undefined : word.name) {
      case sym.feature: {
        if (insert_value_into_option_or_error(cx, param, feature, word!) === undefined) return undefined;
        break;
      }
      case sym.since: {
        if (insert_value_into_option_or_error(cx, param, since, word!) === undefined) return undefined;
        break;
      }
      default: {
        cx.adcx().expected_specific_argument(param_span, [sym.feature, sym.since]);
        return undefined;
      }
    }
  }

  let feature_: Result<Symbol, ErrorGuaranteed>;
  if (feature.value !== undefined && is_ident(Symbol.as_str(feature.value))) {
    feature_ = Ok(feature.value);
  } else if (feature.value !== undefined) {
    feature_ = Err(cx.shared.emit_err(diagnostics.NonIdentFeature_diagnostic({ span: cx.attr_span })));
  } else {
    feature_ = Err(cx.shared.emit_err(diagnostics.MissingFeature_diagnostic({ span: cx.attr_span })));
  }

  let since_: StableSince;
  if (since.value !== undefined) {
    const since__ = since.value;
    if (Symbol.as_str(since__) === VERSION_PLACEHOLDER) {
      since_ = { $: "Current" };
    } else {
      const version = parse_version(since__);
      if (version !== undefined) {
        since_ = { $: "Version", _0: version };
      } else {
        const err = cx.shared.emit_err(diagnostics.InvalidSince_diagnostic({ span: cx.attr_span }));
        since_ = { $: "Err", _0: err };
      }
    }
  } else {
    const err = cx.shared.emit_err(diagnostics.MissingSince_diagnostic({ span: cx.attr_span }));
    since_ = { $: "Err", _0: err };
  }

  if (feature_.$ === "Ok") {
    const feature__ = feature_._0;
    const level: StabilityLevel = { $: "Stable", since: since_, allowed_through_unstable_modules: undefined };
    return [feature__, level];
  } else {
    return undefined;
  }
}

/// Read the content of a `unstable`/`rustc_const_unstable`/`rustc_default_body_unstable`
/// attribute, and return the feature name and its stability information.
// rustc: compiler/rustc_attr_parsing/src/attributes/stability.rs:393 parse_unstability
export function parse_unstability(cx: AcceptContext, args: ArgParser): [Symbol, StabilityLevel] | undefined {
  const feature: MutRef<Symbol | undefined> = { value: undefined };
  const reason: MutRef<Symbol | undefined> = { value: undefined };
  const issue: MutRef<Symbol | undefined> = { value: undefined };
  let issue_num: number | undefined = undefined;
  const implied_by: MutRef<Symbol | undefined> = { value: undefined };
  const old_name: MutRef<Symbol | undefined> = { value: undefined };

  const list = cx.expect_list(args, cx.attr_span);
  if (list === undefined) return undefined;

  for (const param_ of list.mixed()) {
    const param = MetaItemOrLitParser.meta_item(param_);
    if (param === undefined) {
      cx.adcx().expected_not_literal(MetaItemOrLitParser.span(param_));
      return undefined;
    }

    const word = param.path().word();
    switch (word === undefined ? undefined : word.name) {
      case sym.feature: {
        if (insert_value_into_option_or_error(cx, param, feature, word!) === undefined) return undefined;
        break;
      }
      case sym.reason: {
        if (insert_value_into_option_or_error(cx, param, reason, word!) === undefined) return undefined;
        break;
      }
      case sym.issue: {
        if (insert_value_into_option_or_error(cx, param, issue, word!) === undefined) return undefined;

        // These unwraps are safe because `insert_value_into_option_or_error` ensures the meta item
        // is a name/value pair string literal.
        const issue_str = Symbol.as_str(issue.value!);
        if (issue_str === "none") {
          issue_num = undefined;
        } else {
          const parsed = u32_from_str(issue_str);
          const r = parsed.$ === "Ok" && parsed._0 === 0 ? Err("Zero" as const) : parsed;
          if (r.$ === "Ok") {
            issue_num = r._0;
          } else {
            const err = r._0;
            cx.shared.emit_err(
              diagnostics.InvalidIssueString_diagnostic({
                span: param.span(),
                cause: diagnostics.InvalidIssueStringCause.from_int_error_kind(ArgParser.as_name_value(param.args())!.value_span, err),
              }),
            );
            return undefined;
          }
        }
        break;
      }
      case sym.implied_by: {
        if (insert_value_into_option_or_error(cx, param, implied_by, word!) === undefined) return undefined;
        break;
      }
      case sym.old_name: {
        if (insert_value_into_option_or_error(cx, param, old_name, word!) === undefined) return undefined;
        break;
      }
      default: {
        cx.adcx().expected_specific_argument(param.span(), [sym.feature, sym.reason, sym.issue, sym.implied_by, sym.old_name]);
        return undefined;
      }
    }
  }

  let feature_: Result<Symbol, ErrorGuaranteed>;
  if (feature.value !== undefined && is_ident(Symbol.as_str(feature.value))) {
    feature_ = Ok(feature.value);
  } else if (feature.value !== undefined) {
    feature_ = Err(cx.shared.emit_err(diagnostics.NonIdentFeature_diagnostic({ span: cx.attr_span })));
  } else {
    feature_ = Err(cx.shared.emit_err(diagnostics.MissingFeature_diagnostic({ span: cx.attr_span })));
  }

  const issue_: Result<Symbol, ErrorGuaranteed> =
    issue.value !== undefined ? Ok(issue.value) : Err(cx.shared.emit_err(diagnostics.MissingIssue_diagnostic({ span: cx.attr_span })));

  if (feature_.$ === "Ok" && issue_.$ === "Ok") {
    const feature__ = feature_._0;
    // Stable *language* features shouldn't be used as unstable library features.
    // (Not doing this for stable library features is checked by tidy.)
    if (ACCEPTED_LANG_FEATURES.some((f) => f.name === feature__)) {
      cx.shared.emit_err(
        diagnostics.UnstableAttrForAlreadyStableFeature_diagnostic({
          attr_span: cx.attr_span,
          item_span: cx.shared.target_span,
        }),
      );
      return undefined;
    }

    const level: StabilityLevel = {
      $: "Unstable",
      reason: UnstableReason.from_opt_reason(reason.value),
      issue: issue_num,
      implied_by: implied_by.value,
      old_name: old_name.value,
    };
    return [feature__, level];
  } else {
    return undefined;
  }
}

export const UnstableRemovedParser: CombineAttributeParser<UnstableRemovedFeature> = CombineAttributeParser_provided({
  PATH: [sym.unstable_removed],
  ALLOWED_TARGETS: { $: "AllowList", _0: [{ $: "Allow", _0: Target.Crate }] },
  TEMPLATE: template({ List: ['feature = "name", reason = "...", link = "...", since = "version"'] }),
  STABILITY: unstable(sym.staged_api),

  CONVERT: (items, _) => ({ $: "UnstableRemoved", _0: items }),

  // rustc: compiler/rustc_attr_parsing/src/attributes/stability.rs:502 extend
  extend(cx, args) {
    const feature: MutRef<Symbol | undefined> = { value: undefined };
    const reason: MutRef<Symbol | undefined> = { value: undefined };
    const link: MutRef<Symbol | undefined> = { value: undefined };
    const since: MutRef<Symbol | undefined> = { value: undefined };

    const list = cx.expect_list(args, cx.attr_span);
    if (list === undefined) return [];

    for (const param_ of list.mixed()) {
      const param = MetaItemOrLitParser.meta_item(param_);
      if (param === undefined) {
        cx.adcx().expected_not_literal(MetaItemOrLitParser.span(param_));
        return [];
      }

      const word = param.path().word();
      if (word === undefined) {
        cx.adcx().expected_specific_argument(param.span(), [sym.feature, sym.reason, sym.link, sym.since]);
        return [];
      }
      switch (word.name) {
        case sym.feature:
          if (insert_value_into_option_or_error(cx, param, feature, word) === undefined) return [];
          break;
        case sym.since:
          if (insert_value_into_option_or_error(cx, param, since, word) === undefined) return [];
          break;
        case sym.reason:
          if (insert_value_into_option_or_error(cx, param, reason, word) === undefined) return [];
          break;
        case sym.link:
          if (insert_value_into_option_or_error(cx, param, link, word) === undefined) return [];
          break;
        default: {
          cx.adcx().expected_specific_argument(param.span(), [sym.feature, sym.reason, sym.link, sym.since]);
          return [];
        }
      }
    }

    // Check all the arguments are present
    if (feature.value === undefined) {
      cx.adcx().missing_name_value(list.span, sym.feature);
      return [];
    }
    if (reason.value === undefined) {
      cx.adcx().missing_name_value(list.span, sym.reason);
      return [];
    }
    if (link.value === undefined) {
      cx.adcx().missing_name_value(list.span, sym.link);
      return [];
    }
    if (since.value === undefined) {
      cx.adcx().missing_name_value(list.span, sym.since);
      return [];
    }

    const version = parse_version(since.value);
    if (version === undefined) {
      cx.shared.emit_err(diagnostics.InvalidSince_diagnostic({ span: cx.attr_span }));
      return [];
    }

    return [{ feature: feature.value, reason: reason.value, link: link.value, since: version }];
  },
});
