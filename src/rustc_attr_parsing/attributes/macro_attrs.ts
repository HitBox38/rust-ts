// Port of compiler/rustc_attr_parsing/src/attributes/macro_attrs.rs.
// Parser types are trait tables (attributes/mod.ts); see docs/handoff/attr-parse-a.md.
import { AttributeKind, find_attr, MacroUseArgs } from "../../rustc_attr_ir/lib.ts";
import { Target } from "../../rustc_attr_ir/target.ts";
import { AttributeStability } from "../../rustc_feature/lib.ts";
import { INVALID_MACRO_EXPORT_ARGUMENTS, UNUSED_ATTRIBUTES } from "../../rustc_lint_defs/builtin.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { sym } from "../../rustc_span/symbol.ts";
import type { CollapseMacroDebuginfo } from "../../rustc_structures/collapse_macro_debug_info.ts";
import { unwrap } from "../../std/panic.ts";
import type { AcceptContext, FinalizeCheckContext, FinalizeContext } from "../context.ts";
import { MacroExport_diagnostic, MacroOnlyAttribute_diagnostic } from "../diagnostics.ts";
import { type ArgParser, MetaItemOrLitParser } from "../parser.ts";
import { unstable } from "../stability.ts";
import { type AllowedTargets, Policy } from "../target_checking.ts";
import { template } from "../template.ts";
import {
  type AttributeParser,
  AttributeParser_provided,
  type NoArgsAttributeParser,
  NoArgsAttributeParser_provided,
  OnDuplicate,
  type SingleAttributeParser,
  SingleAttributeParser_provided,
} from "./mod.ts";

const { Allow, Error: Error_ } = Policy;

// PORT: `MACRO_USE_TEMPLATE` / `MACRO_USE_ALLOWED_TARGETS` (defined after `MacroUseParser` upstream) come
// first: `MacroEscapeParser`'s table reads `MACRO_USE_ALLOWED_TARGETS` at module init.
const MACRO_USE_TEMPLATE = template(
  { Word: true, List: ["name1, name2, ..."] },
  "https://doc.rust-lang.org/reference/macros-by-example.html#the-macro_use-attribute",
);
const MACRO_USE_ALLOWED_TARGETS: AllowedTargets = {
  $: "AllowListWarnRest",
  _0: [Allow(Target.Mod), Allow(Target.ExternCrate), Error_(Target.WherePredicate)],
};

export const MacroEscapeParser: NoArgsAttributeParser = NoArgsAttributeParser_provided({
  PATH: [sym.macro_escape],
  ON_DUPLICATE: OnDuplicate.Warn,
  ALLOWED_TARGETS: MACRO_USE_ALLOWED_TARGETS,
  STABILITY: AttributeStability.Stable,
  CREATE: (_) => AttributeKind.MacroEscape,
});

/// `#[macro_use]` attributes can either:
/// - Use all macros from a crate, if provided without arguments
/// - Use specific macros from a crate, if provided with arguments `#[macro_use(macro1, macro2)]`
/// A warning should be provided if an use all is combined with specific uses, or if multiple use-alls are used.
/** `#[derive(Default)] pub(crate) struct MacroUseParser` */
export interface MacroUseParser {
  state: MacroUseArgs;

  /// Spans of all `#[macro_use]` arguments with arguments, used for linting
  uses_attr_spans: Span[];
  /// If `state` is `UseSpecific`, stores the span of the first `#[macro_use]` argument, used as the span for this attribute
  /// If `state` is `UseAll`, stores the span of the first `#[macro_use]` arguments without arguments
  first_span: Span | undefined;
}

export const MacroUseParser: AttributeParser<MacroUseParser> = AttributeParser_provided<MacroUseParser>({
  default(): MacroUseParser {
    return { state: MacroUseArgs.default(), uses_attr_spans: [], first_span: undefined };
  },

  ATTRIBUTES: [
    [
      [sym.macro_use],
      MACRO_USE_TEMPLATE,
      AttributeStability.Stable,
      (group: MacroUseParser, cx: AcceptContext, args) => {
        const span = cx.attr_span;
        group.first_span ??= span;
        switch (args.$) {
          case "NoArgs": {
            switch (group.state.$) {
              case "UseAll": {
                const first_span = unwrap(group.first_span, "State is UseAll is some so this is not the first attribute");
                // Since there is a `#[macro_use]` import already, give a warning
                cx.shared.warn_unused_duplicate(first_span, span);
                break;
              }
              case "UseSpecific": {
                group.state = MacroUseArgs.UseAll;
                group.first_span = span;
                // If there is a `#[macro_use]` attribute, warn on all `#[macro_use(...)]` attributes since everything is already imported
                for (const specific_use of group.uses_attr_spans.splice(0)) {
                  cx.shared.warn_unused_duplicate(span, specific_use);
                }
                break;
              }
            }
            break;
          }
          case "List": {
            const list = args._0;
            if (list.is_empty()) {
              cx.adcx().warn_empty_attribute(list.span);
              return;
            }

            const state = group.state;
            switch (state.$) {
              case "UseAll": {
                const first_span = unwrap(group.first_span, "State is UseAll is some so this is not the first attribute");
                cx.shared.warn_unused_duplicate(first_span, span);
                break;
              }
              case "UseSpecific": {
                const arguments_ = state._0;
                // Store here so if we encounter a `UseAll` later we can still lint this attribute
                group.uses_attr_spans.push(cx.attr_span);

                for (const item_ of list.mixed()) {
                  const item = MetaItemOrLitParser.meta_item(item_);
                  if (item === undefined) {
                    cx.adcx().expected_identifier(MetaItemOrLitParser.span(item_));
                    continue;
                  }
                  if (cx.expect_no_args(item.args()) === undefined) {
                    continue;
                  }
                  const word = item.path().word();
                  if (word === undefined) {
                    cx.adcx().expected_identifier(item.span());
                    continue;
                  }
                  arguments_.push(word);
                }
                break;
              }
            }
            break;
          }
          case "NameValue": {
            const nv = args._0;
            cx.adcx().expected_list_or_no_args(nv.args_span());
            break;
          }
        }
      },
    ],
  ],
  ALLOWED_TARGETS: MACRO_USE_ALLOWED_TARGETS,

  // rustc: compiler/rustc_attr_parsing/src/attributes/macro_attrs.rs:114 finalize
  finalize(self: MacroUseParser, _cx: FinalizeContext): AttributeKind | undefined {
    if (self.first_span === undefined) return undefined;
    return { $: "MacroUse", span: self.first_span, arguments: self.state };
  },
});

/// `#[allow_internal_unsafe]` and `#[allow_internal_unstable]` may only be applied to macros.
/// Applying them to a function is only allowed if that function is a procedural macro, i.e. it
/// also carries `#[proc_macro]`, `#[proc_macro_attribute]`, or `#[proc_macro_derive]`.
// rustc: compiler/rustc_attr_parsing/src/attributes/macro_attrs.rs:122 check_macro_only
export function check_macro_only(cx: FinalizeCheckContext, attr_span: Span): void {
  if (
    cx.shared.target.$ === "Fn" &&
    !find_attr(cx.parsed_attrs, (k) =>
      k.$ === "ProcMacro" || k.$ === "ProcMacroAttribute" || k.$ === "ProcMacroDerive" ? true : undefined,
    )
  ) {
    cx.shared.emit_err(MacroOnlyAttribute_diagnostic({ attr_span, span: cx.shared.target_span }));
  }
}

export const AllowInternalUnsafeParser: NoArgsAttributeParser = NoArgsAttributeParser_provided({
  PATH: [sym.allow_internal_unsafe],
  ON_DUPLICATE: OnDuplicate.Ignore,
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Fn), Allow(Target.MacroDef)] },
  STABILITY: unstable(sym.allow_internal_unsafe),
  CREATE: (span) => ({ $: "AllowInternalUnsafe", _0: span }),

  // rustc: compiler/rustc_attr_parsing/src/attributes/macro_attrs.rs:140 finalize_check
  finalize_check(cx: FinalizeCheckContext, attr_span: Span): void {
    check_macro_only(cx, attr_span);
  },
});

export const MacroExportParser: SingleAttributeParser = SingleAttributeParser_provided({
  PATH: [sym.macro_export],
  ON_DUPLICATE: OnDuplicate.Warn,
  TEMPLATE: template({ Word: true, List: ["local_inner_macros"] }),
  ALLOWED_TARGETS: {
    $: "AllowListWarnRest",
    _0: [Allow(Target.MacroDef), Error_(Target.WherePredicate), Error_(Target.Crate)],
  },
  STABILITY: AttributeStability.Stable,

  // rustc: compiler/rustc_attr_parsing/src/attributes/macro_attrs.rs:158 convert
  convert(cx: AcceptContext, args: ArgParser): AttributeKind | undefined {
    let local_inner_macros: boolean;
    switch (args.$) {
      case "NoArgs":
        local_inner_macros = false;
        break;
      case "List": {
        const list = args._0;
        const l = list.as_single();
        if (l === undefined) {
          cx.adcx().warn_ill_formed_attribute_input(INVALID_MACRO_EXPORT_ARGUMENTS);
          return undefined;
        }
        const m = MetaItemOrLitParser.meta_item_no_args(l);
        if (m !== undefined && m.path().word_is(sym.local_inner_macros)) {
          local_inner_macros = true;
        } else {
          cx.adcx().warn_ill_formed_attribute_input(INVALID_MACRO_EXPORT_ARGUMENTS);
          return undefined;
        }
        break;
      }
      case "NameValue": {
        const nv = args._0;
        cx.adcx().expected_list_or_no_args(nv.args_span());
        return undefined;
      }
    }

    return { $: "MacroExport", span: cx.attr_span, local_inner_macros };
  },

  // rustc: compiler/rustc_attr_parsing/src/attributes/macro_attrs.rs:183 finalize_check
  finalize_check(cx: FinalizeCheckContext, attr_span: Span): void {
    if (cx.shared.target.$ !== "MacroDef") {
      return;
    }

    const item = unwrap(cx.target_item);
    if (item.kind.$ === "MacroDef" && !item.kind._1.macro_rules) {
      cx.shared.emit_lint(UNUSED_ATTRIBUTES, MacroExport_diagnostic("OnDeclMacro"), attr_span);
    }
  },
});

export const CollapseDebugInfoParser: SingleAttributeParser = SingleAttributeParser_provided({
  PATH: [sym.collapse_debuginfo],
  TEMPLATE: template(
    { List: ["no", "external", "yes"] },
    "https://doc.rust-lang.org/reference/attributes/debugger.html#the-collapse_debuginfo-attribute",
  ),
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.MacroDef)] },
  STABILITY: AttributeStability.Stable,

  // rustc: compiler/rustc_attr_parsing/src/attributes/macro_attrs.rs:209 convert
  convert(cx: AcceptContext, args: ArgParser): AttributeKind | undefined {
    const single = cx.expect_single_element_list(args, cx.attr_span);
    if (single === undefined) return undefined;
    const mi = MetaItemOrLitParser.meta_item(single);
    if (mi === undefined) {
      cx.adcx().expected_not_literal(MetaItemOrLitParser.span(single));
      return undefined;
    }
    void cx.expect_no_args(mi.args());
    const path = mi.path().word_sym();
    let info: CollapseMacroDebuginfo;
    if (path === sym.yes) {
      info = "Yes";
    } else if (path === sym.no) {
      info = "No";
    } else if (path === sym.external) {
      info = "External";
    } else {
      cx.adcx().expected_specific_argument(mi.span(), [sym.yes, sym.no, sym.external]);
      return undefined;
    }

    return { $: "CollapseDebugInfo", _0: info };
  },
});

export const RustcProcMacroDeclsParser: NoArgsAttributeParser = NoArgsAttributeParser_provided({
  PATH: [sym.rustc_proc_macro_decls],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Static)] },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => AttributeKind.RustcProcMacroDecls,
});
