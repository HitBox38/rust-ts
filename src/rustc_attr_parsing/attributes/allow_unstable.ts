// Port of compiler/rustc_attr_parsing/src/attributes/allow_unstable.rs
import * as diagnostics from "../diagnostics.ts";
import { check_macro_only } from "./macro_attrs.ts";
import { CombineAttributeParser_provided } from "./mod.ts";
import {
  type AcceptContext,
  Allow,
  ArgParser,
  type CombineAttributeParser,
  MetaItemOrLitParser,
  MethodKind,
  type Span,
  Symbol,
  sym,
  Target,
  template,
  unstable,
} from "./prelude.ts";

export const AllowInternalUnstableParser: CombineAttributeParser<[Symbol, Span]> = CombineAttributeParser_provided<[Symbol, Span]>({
  PATH: [sym.allow_internal_unstable],
  CONVERT: (items, span) => ({ $: "AllowInternalUnstable", _0: items, _1: span }),
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.MacroDef), Allow(Target.Fn)] },
  TEMPLATE: template({ Word: true, List: ["feat1, feat2, ..."] }),
  STABILITY: unstable(sym.allow_internal_unstable),

  // rustc: compiler/rustc_attr_parsing/src/attributes/allow_unstable.rs:20 extend
  extend(cx, args) {
    // `.into_iter().zip(iter::repeat(cx.attr_span))`
    return parse_unstable(cx, args, AllowInternalUnstableParser.PATH[0]!).map((s): [Symbol, Span] => [s, cx.attr_span]);
  },

  // rustc: compiler/rustc_attr_parsing/src/attributes/allow_unstable.rs:29 finalize_check
  finalize_check(cx, attr_span) {
    check_macro_only(cx, attr_span);
  },
});

export const UnstableFeatureBoundParser: CombineAttributeParser<[Symbol, Span]> = CombineAttributeParser_provided<[Symbol, Span]>({
  PATH: [sym.unstable_feature_bound],
  CONVERT: (items, _) => ({ $: "UnstableFeatureBound", _0: items }),
  STABILITY: unstable(sym.staged_api),
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [Allow(Target.Fn), Allow({ $: "Impl", of_trait: true }), Allow(Target.Trait)],
  },
  TEMPLATE: template({ Word: true, List: ["feat1, feat2, ..."] }),

  // rustc: compiler/rustc_attr_parsing/src/attributes/allow_unstable.rs:47 extend
  extend(cx, args) {
    // `.into_iter().zip(iter::repeat(cx.attr_span))`
    return parse_unstable(cx, args, UnstableFeatureBoundParser.PATH[0]!).map((s): [Symbol, Span] => [s, cx.attr_span]);
  },
});

export const RustcAllowConstFnUnstableParser: CombineAttributeParser<Symbol> = CombineAttributeParser_provided<Symbol>({
  PATH: [sym.rustc_allow_const_fn_unstable],
  CONVERT: (items, first_span) => ({ $: "RustcAllowConstFnUnstable", _0: items, _1: first_span }),
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      Allow(Target.Fn),
      Allow({ $: "Method", _0: MethodKind.Inherent }),
      Allow({ $: "Method", _0: { $: "Trait", body: true } }),
      Allow({ $: "Method", _0: MethodKind.TraitImpl }),
    ],
  },
  TEMPLATE: template({ Word: true, List: ["feat1, feat2, ..."] }),
  STABILITY: unstable(sym.rustc_attrs, "rustc_allow_const_fn_unstable side-steps feature gating and stability checks"),

  // rustc: compiler/rustc_attr_parsing/src/attributes/allow_unstable.rs:75 extend
  extend(cx, args) {
    return parse_unstable(cx, args, RustcAllowConstFnUnstableParser.PATH[0]!);
  },
});

// rustc: compiler/rustc_attr_parsing/src/attributes/allow_unstable.rs:83 parse_unstable
function parse_unstable(cx: AcceptContext, args: ArgParser, symbol: Symbol): Symbol[] {
  const res: Symbol[] = [];

  const list = ArgParser.as_list(args);
  if (list === undefined) {
    cx.shared.emit_err(
      diagnostics.ExpectsFeatureList_diagnostic({
        span: cx.attr_span,
        name: Symbol.to_ident_string(symbol),
      }),
    );
    return res;
  }

  for (const param of list.mixed()) {
    const param_span = MetaItemOrLitParser.span(param);
    const ident = MetaItemOrLitParser.meta_item_no_args(param)?.path().word();
    if (ident !== undefined) {
      res.push(ident.name);
    } else {
      cx.shared.emit_err(
        diagnostics.ExpectsFeatures_diagnostic({
          span: param_span,
          name: Symbol.to_ident_string(symbol),
        }),
      );
    }
  }

  return res;
}
