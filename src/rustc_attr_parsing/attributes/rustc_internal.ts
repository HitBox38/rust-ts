// Port of compiler/rustc_attr_parsing/src/attributes/rustc_internal.rs
import { find_attr, LangItem } from "../../rustc_attr_ir/lib.ts";
import {
  BorrowckGraphvizFormatKind,
  type CguFields,
  CguKind,
  type RustcCleanAttribute,
  type RustcCleanQueries,
  RustcMirKind,
} from "../../rustc_attr_ir/lib.ts";
import { AttributeStability } from "../../rustc_feature/lib.ts";
import { is_whitespace } from "../../std/char.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { panic, unwrap } from "../../std/panic.ts";
import { path_components } from "../../std/path.ts";
import { ExpectNameValue, ExpectStringLiteral } from "../context.ts";
import {
  AttributeRequiresOpt_diagnostic,
  CguFieldsMissing_diagnostic,
  FunctionNamesDuplicated_diagnostic,
  MustBeNameOfAssociatedFunction_diagnostic,
  RustcLegacyConstGenericsIndex_diagnostic,
  RustcLegacyConstGenericsIndexExceed_diagnostic,
  RustcLegacyConstGenericsOnly_diagnostic,
  RustcScalableVectorCountOutOfRange_diagnostic,
  UnknownExternLangItem_diagnostic,
  UnknownLangItem_diagnostic,
} from "../diagnostics.ts";
import {
  AttributeParser_provided,
  CombineAttributeParser_provided,
  NoArgsAttributeParser_provided,
  SingleAttributeParser_provided,
} from "./mod.ts";
import {
  type AcceptContext,
  Allow,
  ArgParser,
  AssocCtxt,
  type AttributeParser,
  AttributeKind,
  type CombineAttributeParser,
  type Ident,
  MetaItemOrLitParser,
  type MetaItemParser,
  MethodKind,
  type NoArgsAttributeParser,
  type SingleAttributeParser,
  Span,
  Symbol,
  sym,
  Target,
  template,
  unstable,
} from "./prelude.ts";
import { parse_single_integer } from "./util.ts";

export const RustcMainParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_main],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Fn)] },
  STABILITY: unstable(
    sym.rustc_attrs,
    "the `rustc_main` attribute is used internally to specify test entry point function",
  ),
  CREATE: (_) => AttributeKind.RustcMain,
};

export const RustcMustImplementOneOfParser: SingleAttributeParser = {
  ...SingleAttributeParser_provided,
  PATH: [sym.rustc_must_implement_one_of],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Trait)] },
  STABILITY: unstable(
    sym.rustc_attrs,
    "the `rustc_must_implement_one_of` attribute is used to change minimal complete definition of a trait. Its syntax and semantics are highly experimental and will be subject to change before stabilization",
  ),
  TEMPLATE: template({ List: ["function1, function2, ..."] }),
  // rustc: compiler/rustc_attr_parsing/src/attributes/rustc_internal.rs:43 convert
  convert(cx, args) {
    const list = cx.expect_list(args, cx.attr_span);
    if (list === undefined) return undefined;

    const fn_names: Ident[] = [];

    const inputs = [...list.mixed()];

    if (inputs.length < 2) {
      cx.adcx().expected_list_with_num_args_or_more(2, list.span);
      return undefined;
    }

    let errored = false;
    for (const argument of inputs) {
      const meta = MetaItemOrLitParser.meta_item_no_args(argument);
      if (meta === undefined) {
        cx.adcx().expected_identifier(MetaItemOrLitParser.span(argument));
        return undefined;
      }

      const ident = meta.ident();
      if (ident === undefined) {
        cx.shared.cx.dcx().emit_err(MustBeNameOfAssociatedFunction_diagnostic({ span: meta.span() }));
        errored = true;
        continue;
      }

      fn_names.push(ident);
    }
    if (errored) {
      return undefined;
    }

    if (cx.shared.target.$ === "Trait") {
      // Check for duplicates
      const seen: Map<Symbol, Span> = new Map();
      for (const ident of fn_names) {
        // `seen.insert(ident.name, ident.span)` returns the previous value.
        const dup = seen.get(ident.name);
        seen.set(ident.name, ident.span);
        if (dup !== undefined) {
          cx.shared.emit_err(FunctionNamesDuplicated_diagnostic({ spans: [dup, ident.span] }));
        }
      }
    }

    return { $: "RustcMustImplementOneOf", attr_span: cx.attr_span, fn_names };
  },
};

export const RustcNeverReturnsNullPtrParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_never_returns_null_ptr],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      Allow(Target.Fn),
      Allow({ $: "Method", _0: MethodKind.Inherent }),
      Allow({ $: "Method", _0: { $: "Trait", body: false } }),
      Allow({ $: "Method", _0: { $: "Trait", body: true } }),
      Allow({ $: "Method", _0: MethodKind.TraitImpl }),
    ],
  },
  STABILITY: unstable(sym.rustc_attrs),

  CREATE: (_) => AttributeKind.RustcNeverReturnsNullPtr,
};

export const RustcPanicsWhenZeroParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_panics_when_zero],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.ConstParam)] },
  STABILITY: unstable(sym.rustc_attrs),

  CREATE: (_) => AttributeKind.RustcPanicsWhenZero,
};

export const RustcNoImplicitAutorefsParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_no_implicit_autorefs],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      Allow(Target.Fn),
      Allow({ $: "Method", _0: MethodKind.Inherent }),
      Allow({ $: "Method", _0: { $: "Trait", body: false } }),
      Allow({ $: "Method", _0: { $: "Trait", body: true } }),
      Allow({ $: "Method", _0: MethodKind.TraitImpl }),
    ],
  },
  STABILITY: unstable(sym.rustc_attrs),

  CREATE: (_) => AttributeKind.RustcNoImplicitAutorefs,
};

export const RustcLegacyConstGenericsParser: SingleAttributeParser = {
  ...SingleAttributeParser_provided,
  PATH: [sym.rustc_legacy_const_generics],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Fn)] },
  TEMPLATE: template({ List: ["N"] }),
  STABILITY: unstable(sym.rustc_attrs),

  // rustc: compiler/rustc_attr_parsing/src/attributes/rustc_internal.rs:142 convert
  convert(cx, args) {
    const meta_items = cx.expect_list(args, cx.attr_span);
    if (meta_items === undefined) return undefined;

    const parsed_indexes: [number, Span][] = [];
    let errored = false;

    for (const possible_index of meta_items.mixed()) {
      let index: bigint | undefined;
      if (
        possible_index.$ === "Lit" &&
        possible_index._0.kind.$ === "Int" &&
        possible_index._0.kind._1.$ === "Unsuffixed"
      ) {
        index = possible_index._0.kind._0;
      }
      if (index !== undefined) {
        // PORT: `index.0 as usize` truncates the u128 to the 64-bit usize; the result is a number
        // (an argument index, compared against `arg_count`).
        parsed_indexes.push([Number(BigInt.asUintN(64, index)), MetaItemOrLitParser.span(possible_index)]);
      } else {
        cx.adcx().expected_integer_literal(MetaItemOrLitParser.span(possible_index));
        errored = true;
      }
    }
    if (errored) {
      return undefined;
    } else if (parsed_indexes.length === 0) {
      const span = ArgParser.span(args);
      if (span === undefined) return undefined;
      cx.adcx().expected_at_least_one_argument(span);
      return undefined;
    }

    return {
      $: "RustcLegacyConstGenerics",
      fn_indexes: parsed_indexes,
      attr_span: cx.attr_span,
    };
  },

  // rustc: compiler/rustc_attr_parsing/src/attributes/rustc_internal.rs:173 finalize_check
  finalize_check(cx, attr_span) {
    if (cx.shared.target.$ !== "Fn") {
      // Invalid targets are already diagnosed by target checking.
      return;
    }
    const item = unwrap(cx.target_item, "missing AST target item for Target::Fn");
    if (item.kind.$ !== "Fn") {
      panic("expected fn AST target item for Target::Fn");
    }
    const function_ = item.kind._0;
    const index_list = unwrap(
      find_attr(cx.parsed_attrs, (k) => (k.$ === "RustcLegacyConstGenerics" ? k.fn_indexes : undefined)),
      "missing parsed RustcLegacyConstGenerics attribute in finalize_check",
    );
    const generics = function_.generics;

    for (const param of generics.params) {
      if (!(param.kind.$ === "Const")) {
        cx.shared.emit_err(
          RustcLegacyConstGenericsOnly_diagnostic({
            attr_span,
            param_span: param.span(),
          }),
        );
        return;
      }
    }

    if (index_list.length !== generics.params.length) {
      cx.shared.emit_err(
        RustcLegacyConstGenericsIndex_diagnostic({
          attr_span,
          generics_span: generics.span,
        }),
      );
      return;
    }

    const arg_count = function_.sig.decl.inputs.length + generics.params.length;
    for (const [index, span] of index_list) {
      if (index >= arg_count) {
        cx.shared.emit_err(
          RustcLegacyConstGenericsIndexExceed_diagnostic({
            span: span,
            arg_count,
          }),
        );
      }
    }
  },
};

export const RustcInheritOverflowChecksParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_inherit_overflow_checks],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      Allow(Target.Fn),
      Allow({ $: "Method", _0: MethodKind.Inherent }),
      Allow({ $: "Method", _0: MethodKind.TraitImpl }),
      Allow(Target.Closure),
    ],
  },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => AttributeKind.RustcInheritOverflowChecks,
};

export const RustcLintOptDenyFieldAccessParser: SingleAttributeParser = {
  ...SingleAttributeParser_provided,
  PATH: [sym.rustc_lint_opt_deny_field_access],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Field)] },
  TEMPLATE: template({ Word: true }),
  STABILITY: unstable(sym.rustc_attrs),
  // rustc: compiler/rustc_attr_parsing/src/attributes/rustc_internal.rs:237 convert
  convert(cx, args) {
    const arg = cx.expect_single_element_list(args, cx.attr_span);
    if (arg === undefined) return undefined;
    const lint_message = cx.expect_string_literal(arg, ExpectStringLiteral.MetaItemOrLitParser);
    if (lint_message === undefined) return undefined;

    return { $: "RustcLintOptDenyFieldAccess", lint_message };
  },
};

export const RustcLintOptTyParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_lint_opt_ty],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Struct)] },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => AttributeKind.RustcLintOptTy,
};

// rustc: compiler/rustc_attr_parsing/src/attributes/rustc_internal.rs:254 parse_cgu_fields
function parse_cgu_fields(
  cx: AcceptContext,
  args_: ArgParser,
  accepts_kind: boolean,
): [Symbol, Symbol, CguKind | undefined] | undefined {
  const args = cx.expect_list(args_, cx.attr_span);
  if (args === undefined) return undefined;

  // PORT: the three `Option<(Symbol, Span)>` locals are `MutRef` slots so that `res` can be a
  // `&mut` to one of them.
  const cfg: MutRef<[Symbol, Span] | undefined> = { value: undefined };
  const module: MutRef<[Symbol, Span] | undefined> = { value: undefined };
  const kind: MutRef<[Symbol, Span] | undefined> = { value: undefined };

  for (const arg_ of args.mixed()) {
    const r = cx.expect_name_value(arg_, MetaItemOrLitParser.span(arg_), undefined, ExpectNameValue.MetaItemOrLitParser);
    if (r === undefined) {
      continue;
    }
    const [ident, arg] = r;

    let res: MutRef<[Symbol, Span] | undefined>;
    if (ident.name === sym.cfg) {
      res = cfg;
    } else if (ident.name === sym.module) {
      res = module;
    } else if (ident.name === sym.kind && accepts_kind) {
      res = kind;
    } else {
      cx.adcx().expected_specific_argument(
        ident.span,
        accepts_kind ? [sym.cfg, sym.module, sym.kind] : [sym.cfg, sym.module],
      );
      continue;
    }

    const str = cx.expect_string_literal(arg, ExpectStringLiteral.NameValueParser);
    if (str === undefined) return undefined;

    if (res.value !== undefined) {
      cx.adcx().duplicate_key(Span.to(ident.span, arg.args_span()), ident.name);
      continue;
    }

    res.value = [str, arg.value_span];
  }

  if (cfg.value === undefined) {
    cx.shared.emit_err(CguFieldsMissing_diagnostic({ span: args.span, name: cx.attr_path, field: sym.cfg }));
    return undefined;
  }
  const [cfg_] = cfg.value;
  if (module.value === undefined) {
    cx.shared.emit_err(CguFieldsMissing_diagnostic({ span: args.span, name: cx.attr_path, field: sym.module }));
    return undefined;
  }
  const [module_] = module.value;
  let kind_: CguKind | undefined;
  if (kind.value !== undefined) {
    const [kind__, span] = kind.value;
    if (kind__ === sym.no) {
      kind_ = CguKind.No;
    } else if (kind__ === sym.pre_dash_lto) {
      kind_ = CguKind.PreDashLto;
    } else if (kind__ === sym.post_dash_lto) {
      kind_ = CguKind.PostDashLto;
    } else if (kind__ === sym.any) {
      kind_ = CguKind.Any;
    } else {
      cx.adcx().expected_specific_argument_strings(span, [sym.no, sym.pre_dash_lto, sym.post_dash_lto, sym.any]);
      return undefined;
    }
  } else {
    // return None so that an unwrap for the attributes that need it is ok.
    if (accepts_kind) {
      cx.shared.emit_err(
        CguFieldsMissing_diagnostic({
          span: args.span,
          name: cx.attr_path,
          field: sym.kind,
        }),
      );
      return undefined;
    }

    kind_ = undefined;
  }

  return [cfg_, module_, kind_];
}

/** `#[derive(Default)] pub(crate) struct RustcCguTestAttributeParser` */
export interface RustcCguTestAttributeParser {
  items: [Span, CguFields][];
}

export const RustcCguTestAttributeParser: AttributeParser<RustcCguTestAttributeParser> = {
  ...AttributeParser_provided,
  default: () => ({ items: [] }),
  ATTRIBUTES: [
    [
      [sym.rustc_partition_reused],
      template({ List: [`cfg = "...", module = "..."`] }),
      unstable(sym.rustc_attrs),
      (this_, cx, args) => {
        const r = parse_cgu_fields(cx, args, false);
        if (r !== undefined) {
          const [cfg, module, _] = r;
          this_.items.push([cx.attr_span, { $: "PartitionReused", cfg, module }]);
        }
      },
    ],
    [
      [sym.rustc_partition_codegened],
      template({ List: [`cfg = "...", module = "..."`] }),
      unstable(sym.rustc_attrs),
      (this_, cx, args) => {
        const r = parse_cgu_fields(cx, args, false);
        if (r !== undefined) {
          const [cfg, module, _] = r;
          this_.items.push([cx.attr_span, { $: "PartitionCodegened", cfg, module }]);
        }
      },
    ],
    [
      [sym.rustc_expected_cgu_reuse],
      template({ List: [`cfg = "...", module = "...", kind = "..."`] }),
      unstable(sym.rustc_attrs),
      (this_, cx, args) => {
        const r = parse_cgu_fields(cx, args, true);
        if (r !== undefined) {
          const [cfg, module, kind] = r;
          // unwrap ok because if not given, we return None in `parse_cgu_fields`.
          this_.items.push([cx.attr_span, { $: "ExpectedCguReuse", cfg, module, kind: unwrap(kind) }]);
        }
      },
    ],
  ],

  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Mod), Allow(Target.Crate)] },

  // rustc: compiler/rustc_attr_parsing/src/attributes/rustc_internal.rs:379 finalize
  finalize(self, _cx) {
    return { $: "RustcCguTestAttr", _0: self.items };
  },
};

export const RustcDeprecatedSafe2024Parser: SingleAttributeParser = {
  ...SingleAttributeParser_provided,
  PATH: [sym.rustc_deprecated_safe_2024],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      Allow(Target.Fn),
      Allow({ $: "Method", _0: MethodKind.Inherent }),
      Allow({ $: "Method", _0: { $: "Trait", body: false } }),
      Allow({ $: "Method", _0: { $: "Trait", body: true } }),
      Allow({ $: "Method", _0: MethodKind.TraitImpl }),
    ],
  },
  TEMPLATE: template({ List: [`audit_that = "..."`] }),
  STABILITY: unstable(sym.rustc_attrs),

  // rustc: compiler/rustc_attr_parsing/src/attributes/rustc_internal.rs:398 convert
  convert(cx, args) {
    const single = cx.expect_single_element_list(args, cx.attr_span);
    if (single === undefined) return undefined;

    const r = cx.expect_name_value(single, cx.attr_span, undefined, ExpectNameValue.MetaItemOrLitParser);
    if (r === undefined) return undefined;
    const [path, arg] = r;

    if (path.name !== sym.audit_that) {
      cx.adcx().expected_specific_argument(path.span, [sym.audit_that]);
      return undefined;
    }

    const suggestion = cx.expect_string_literal(arg, ExpectStringLiteral.NameValueParser);
    if (suggestion === undefined) return undefined;

    return { $: "RustcDeprecatedSafe2024", suggestion };
  },
};

export const RustcConversionSuggestionParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_conversion_suggestion],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      Allow(Target.Fn),
      Allow({ $: "Method", _0: MethodKind.Inherent }),
      Allow({ $: "Method", _0: { $: "Trait", body: false } }),
      Allow({ $: "Method", _0: { $: "Trait", body: true } }),
      Allow({ $: "Method", _0: MethodKind.TraitImpl }),
    ],
  },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => AttributeKind.RustcConversionSuggestion,
};

export const RustcCaptureAnalysisParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_capture_analysis],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Closure)] },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => AttributeKind.RustcCaptureAnalysis,
};

export const RustcTrivialFieldReadsParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_trivial_field_reads],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Trait)] },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => AttributeKind.RustcTrivialFieldReads,
};

export const RustcNoMirInlineParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_no_mir_inline],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      Allow(Target.Fn),
      Allow({ $: "Method", _0: MethodKind.Inherent }),
      Allow({ $: "Method", _0: { $: "Trait", body: false } }),
      Allow({ $: "Method", _0: { $: "Trait", body: true } }),
      Allow({ $: "Method", _0: MethodKind.TraitImpl }),
    ],
  },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => AttributeKind.RustcNoMirInline,
};

export const RustcNoWritableParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_no_writable],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      Allow(Target.Fn),
      Allow(Target.Closure),
      Allow({ $: "Method", _0: MethodKind.Inherent }),
      Allow({ $: "Method", _0: MethodKind.TraitImpl }),
      Allow({ $: "Method", _0: { $: "Trait", body: true } }),
    ],
  },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => AttributeKind.RustcNoWritable,
};

export const RustcLintQueryInstabilityParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_lint_query_instability],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      Allow(Target.Fn),
      Allow({ $: "Method", _0: MethodKind.Inherent }),
      Allow({ $: "Method", _0: { $: "Trait", body: false } }),
      Allow({ $: "Method", _0: { $: "Trait", body: true } }),
      Allow({ $: "Method", _0: MethodKind.TraitImpl }),
    ],
  },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => AttributeKind.RustcLintQueryInstability,
};

export const RustcRegionsParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_regions],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      Allow(Target.Fn),
      Allow({ $: "Method", _0: MethodKind.Inherent }),
      Allow({ $: "Method", _0: { $: "Trait", body: false } }),
      Allow({ $: "Method", _0: { $: "Trait", body: true } }),
      Allow({ $: "Method", _0: MethodKind.TraitImpl }),
    ],
  },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => AttributeKind.RustcRegions,
};

export const RustcLintUntrackedQueryInformationParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_lint_untracked_query_information],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      Allow(Target.Fn),
      Allow({ $: "Method", _0: MethodKind.Inherent }),
      Allow({ $: "Method", _0: { $: "Trait", body: false } }),
      Allow({ $: "Method", _0: { $: "Trait", body: true } }),
      Allow({ $: "Method", _0: MethodKind.TraitImpl }),
    ],
  },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => AttributeKind.RustcLintUntrackedQueryInformation,
};

export const RustcSimdMonomorphizeLaneLimitParser: SingleAttributeParser = {
  ...SingleAttributeParser_provided,
  PATH: [sym.rustc_simd_monomorphize_lane_limit],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Struct)] },
  TEMPLATE: template({ NameValueStr: ["N"] }),
  STABILITY: unstable(sym.rustc_attrs),

  // rustc: compiler/rustc_attr_parsing/src/attributes/rustc_internal.rs:531 convert
  convert(cx, args) {
    const nv = cx.expect_name_value(args, cx.attr_span, undefined, ExpectNameValue.ArgParser);
    if (nv === undefined) return undefined;
    const limit = cx.parse_limit_int(nv);
    if (limit === undefined) return undefined;
    return { $: "RustcSimdMonomorphizeLaneLimit", _0: limit };
  },
};

export const RustcScalableVectorParser: SingleAttributeParser = {
  ...SingleAttributeParser_provided,
  PATH: [sym.rustc_scalable_vector],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Struct)] },
  TEMPLATE: template({ Word: true, List: ["count"] }),
  STABILITY: unstable(sym.rustc_attrs),

  // rustc: compiler/rustc_attr_parsing/src/attributes/rustc_internal.rs:545 convert
  convert(cx, args) {
    if (ArgParser.as_no_args(args).$ === "Ok") {
      return { $: "RustcScalableVector", element_count: undefined };
    }

    const n: bigint | undefined = parse_single_integer(cx, args);
    if (n === undefined) return undefined;
    // PORT: `n.try_into()` converts the u128 into `element_count`'s `u16`.
    if (!(n >= 0n && n <= 0xffffn)) {
      cx.shared.emit_err(RustcScalableVectorCountOutOfRange_diagnostic({ span: cx.attr_span, n }));
      return undefined;
    }
    const n_ = Number(n);
    return { $: "RustcScalableVector", element_count: n_ };
  },
};

export const LangParser: SingleAttributeParser = {
  ...SingleAttributeParser_provided,
  PATH: [sym.lang],
  ALLOWED_TARGETS: { $: "ManuallyChecked" },
  TEMPLATE: template({ NameValueStr: ["name"] }),
  STABILITY: unstable(sym.lang_items),

  // rustc: compiler/rustc_attr_parsing/src/attributes/rustc_internal.rs:567 convert
  convert(cx, args) {
    const nv = cx.expect_name_value(args, cx.attr_span, undefined, ExpectNameValue.ArgParser);
    if (nv === undefined) return undefined;
    const name = cx.expect_string_literal(nv, ExpectStringLiteral.NameValueParser);
    if (name === undefined) return undefined;
    const lang_item = LangItem.from_name(name);
    if (lang_item === undefined) {
      cx.shared.emit_err(UnknownLangItem_diagnostic({ span: cx.attr_span, name }));
      return undefined;
    }

    // Only weak lang items may be applied to foreign items,
    // except for `ForeignTy` which can be a normal lang item.
    // PORT: `[..].contains(&cx.target)` over unit variants compares the tags.
    const target = cx.shared.target;
    if (
      (target.$ === "ForeignFn" || target.$ === "ForeignStatic" || target.$ === "ForeignMod") &&
      !LangItem.is_weak(lang_item)
    ) {
      cx.shared.emit_err(UnknownExternLangItem_diagnostic({ span: cx.attr_span, lang_item: LangItem.name(lang_item) }));
      return undefined;
    }

    // Check the target
    const allowed_targets = [Allow(LangItem.target(lang_item))];
    cx.check_target(` = "${Symbol.as_str(name)}"`, { $: "AllowList", _0: allowed_targets });

    return { $: "Lang", _0: lang_item };
  },
};

export const RustcHasIncoherentInherentImplsParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_has_incoherent_inherent_impls],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      Allow(Target.Trait),
      Allow(Target.Struct),
      Allow(Target.Enum),
      Allow(Target.Union),
      Allow(Target.ForeignTy),
    ],
  },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => AttributeKind.RustcHasIncoherentInherentImpls,
};

export const PanicHandlerParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.panic_handler],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Fn)] },
  STABILITY: AttributeStability.Stable,
  CREATE: (_) => ({ $: "Lang", _0: LangItem.PanicImpl }),
};

export const RustcNounwindParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_nounwind],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      Allow(Target.Fn),
      Allow(Target.ForeignFn),
      Allow({ $: "Method", _0: MethodKind.Inherent }),
      Allow({ $: "Method", _0: MethodKind.TraitImpl }),
      Allow({ $: "Method", _0: { $: "Trait", body: true } }),
    ],
  },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => AttributeKind.RustcNounwind,
};

export const RustcOffloadKernelParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_offload_kernel],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Fn)] },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => AttributeKind.RustcOffloadKernel,
};

// PORT: `Path::file_name` is `self.components().next_back()` if it is a `Component::Normal`.
// std/path.ts `Components` has no `next_back`; the last item of the forward iteration is the same
// component (`Components` is a `DoubleEndedIterator` over one sequence).
function path_file_name(path: string): string | undefined {
  const components = path_components(path);
  let last;
  for (let c = components.next(); c !== undefined; c = components.next()) {
    last = c;
  }
  return last !== undefined && last.$ === "Normal" ? last._0 : undefined;
}

export const RustcMirParser: CombineAttributeParser<RustcMirKind> = {
  ...CombineAttributeParser_provided,
  PATH: [sym.rustc_mir],

  CONVERT: (items, _) => ({ $: "RustcMir", _0: items }),
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      Allow(Target.Fn),
      Allow({ $: "Method", _0: MethodKind.Inherent }),
      Allow({ $: "Method", _0: MethodKind.TraitImpl }),
      Allow({ $: "Method", _0: { $: "Trait", body: false } }),
      Allow({ $: "Method", _0: { $: "Trait", body: true } }),
    ],
  },
  TEMPLATE: template({ List: ["arg1, arg2, ..."] }),
  STABILITY: unstable(sym.rustc_attrs),

  // rustc: compiler/rustc_attr_parsing/src/attributes/rustc_internal.rs:658 extend
  extend(cx, args): Iterable<RustcMirKind> {
    const list = cx.expect_list(args, cx.attr_span);
    if (list === undefined) {
      return [];
    }

    // `.filter_map(|arg| arg.meta_item()).filter_map(|mi| ..).collect()`
    const f = (mi: MetaItemParser): RustcMirKind | undefined => {
      const ident = mi.ident();
      if (ident !== undefined) {
        switch (ident.name) {
          case sym.rustc_pretty_live_locals: {
            if (cx.expect_no_args(mi.args()) === undefined) return undefined;
            return RustcMirKind.PrettyLiveLocals;
          }
          case sym.rustc_pretty_precise_liveness: {
            if (cx.expect_no_args(mi.args()) === undefined) return undefined;
            return RustcMirKind.PrettyPreciseLiveness;
          }
          case sym.rustc_pretty_transitive_live_locals: {
            if (cx.expect_no_args(mi.args()) === undefined) return undefined;
            return RustcMirKind.PrettyTransitiveLiveLocals;
          }
          case sym.rustc_peek_maybe_init:
            return RustcMirKind.PeekMaybeInit;
          case sym.rustc_peek_maybe_uninit:
            return RustcMirKind.PeekMaybeUninit;
          case sym.rustc_peek_liveness:
            return RustcMirKind.PeekLiveness;
          case sym.stop_after_dataflow:
            return RustcMirKind.StopAfterDataflow;
          case sym.borrowck_graphviz_postflow: {
            const nv = cx.expect_name_value(
              mi.args(),
              mi.span(),
              sym.borrowck_graphviz_postflow,
              ExpectNameValue.ArgParser,
            );
            if (nv === undefined) return undefined;
            const path_sym = cx.expect_string_literal(nv, ExpectStringLiteral.NameValueParser);
            if (path_sym === undefined) return undefined;
            const path = Symbol.as_str(path_sym);
            if (path_file_name(path) !== undefined) {
              return { $: "BorrowckGraphvizPostflow", path };
            } else {
              cx.adcx().expected_filename_literal(nv.value_span);
              return undefined;
            }
          }
          case sym.borrowck_graphviz_format: {
            const nv = cx.expect_name_value(
              mi.args(),
              mi.span(),
              sym.borrowck_graphviz_format,
              ExpectNameValue.ArgParser,
            );
            if (nv === undefined) return undefined;
            const format = nv.value_as_ident();
            if (format === undefined) {
              cx.adcx().expected_identifier(nv.value_span);
              return undefined;
            }
            switch (format.name) {
              case sym.two_phase:
                return {
                  $: "BorrowckGraphvizFormat",
                  format: BorrowckGraphvizFormatKind.TwoPhase,
                };
              default: {
                cx.adcx().expected_specific_argument(format.span, [sym.two_phase]);
                return undefined;
              }
            }
          }
          default:
            return undefined;
        }
      } else {
        return undefined;
      }
    };
    const out: RustcMirKind[] = [];
    for (const arg of list.mixed()) {
      const mi = MetaItemOrLitParser.meta_item(arg);
      if (mi === undefined) continue;
      const k = f(mi);
      if (k !== undefined) out.push(k);
    }
    return out;
  },
};
export const RustcNonConstTraitMethodParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_non_const_trait_method],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      Allow({ $: "Method", _0: { $: "Trait", body: true } }),
      Allow({ $: "Method", _0: { $: "Trait", body: false } }),
    ],
  },
  STABILITY: unstable(
    sym.rustc_attrs,
    "the `rustc_non_const_trait_method` attribute should only be used by the standard library to mark trait methods as non-const to allow large traits an easier transition to const",
  ),
  CREATE: (_) => AttributeKind.RustcNonConstTraitMethod,
};

// PORT: `str::trim` trims `char::is_whitespace` (Unicode `White_Space`) from both ends; JS
// `String.prototype.trim` uses a different set (it trims U+FEFF and keeps U+0085).
function str_trim(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end) {
    const c = s.codePointAt(start)!;
    if (!is_whitespace(c)) break;
    start += c > 0xffff ? 2 : 1;
  }
  while (end > start) {
    let i = end - 1;
    const lo = s.charCodeAt(i);
    if (lo >= 0xdc00 && lo <= 0xdfff && i > start) {
      const hi = s.charCodeAt(i - 1);
      if (hi >= 0xd800 && hi <= 0xdbff) i -= 1;
    }
    if (!is_whitespace(s.codePointAt(i)!)) break;
    end = i;
  }
  return s.slice(start, end);
}

export const RustcCleanParser: CombineAttributeParser<RustcCleanAttribute> = {
  ...CombineAttributeParser_provided,
  PATH: [sym.rustc_clean],

  CONVERT: (items, _) => ({ $: "RustcClean", _0: items }),
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      // tidy-alphabetical-start
      Allow({ $: "AssocConst", _0: { $: "Impl", of_trait: false } }),
      Allow({ $: "AssocConst", _0: { $: "Impl", of_trait: true } }),
      Allow({ $: "AssocConst", _0: AssocCtxt.Trait }),
      Allow({ $: "AssocTy", _0: { $: "Impl", of_trait: false } }),
      Allow({ $: "AssocTy", _0: { $: "Impl", of_trait: true } }),
      Allow({ $: "AssocTy", _0: AssocCtxt.Trait }),
      Allow(Target.Const),
      Allow(Target.Enum),
      Allow(Target.Expression),
      Allow(Target.Field),
      Allow(Target.Fn),
      Allow(Target.ForeignMod),
      Allow({ $: "Impl", of_trait: false }),
      Allow({ $: "Impl", of_trait: true }),
      Allow({ $: "Method", _0: MethodKind.Inherent }),
      Allow({ $: "Method", _0: { $: "Trait", body: false } }),
      Allow({ $: "Method", _0: { $: "Trait", body: true } }),
      Allow({ $: "Method", _0: MethodKind.TraitImpl }),
      Allow(Target.Mod),
      Allow(Target.Static),
      Allow(Target.Struct),
      Allow(Target.Trait),
      Allow(Target.TyAlias),
      Allow(Target.Union),
      // tidy-alphabetical-end
    ],
  },
  STABILITY: unstable(sym.rustc_attrs),
  TEMPLATE: template({ List: [`cfg = "...", /*opt*/ label = "...", /*opt*/ except = "..."`] }),

  // rustc: compiler/rustc_attr_parsing/src/attributes/rustc_internal.rs:787 extend
  extend(cx, args): Iterable<RustcCleanAttribute> {
    if (!cx.shared.cx.sess().opts.unstable_opts.query_dep_graph) {
      cx.shared.emit_err(AttributeRequiresOpt_diagnostic({ span: cx.attr_span, opt: "-Z query-dep-graph" }));
    }
    const list = cx.expect_list(args, cx.attr_span);
    if (list === undefined) return [];

    let except: RustcCleanQueries | undefined = undefined;
    let loaded_from_disk: RustcCleanQueries | undefined = undefined;
    let cfg: Symbol | undefined = undefined;

    for (const item of list.mixed()) {
      const r = cx.expect_name_value(item, MetaItemOrLitParser.span(item), undefined, ExpectNameValue.MetaItemOrLitParser);
      if (r === undefined) {
        continue;
      }
      const [ident, value_] = r;
      const value_span = value_.value_span;
      const value = cx.expect_string_literal(value_, ExpectStringLiteral.NameValueParser);
      if (value === undefined) {
        continue;
      }
      if (ident.name === sym.cfg && cfg !== undefined) {
        cx.adcx().duplicate_key(MetaItemOrLitParser.span(item), sym.cfg);
      } else if (ident.name === sym.cfg) {
        cfg = value;
      } else if (ident.name === sym.except && except !== undefined) {
        cx.adcx().duplicate_key(MetaItemOrLitParser.span(item), sym.except);
      } else if (ident.name === sym.except) {
        const entries = Symbol.as_str(value)
          .split(",")
          .map((s) => Symbol.intern(str_trim(s)));
        except = { entries, span: value_span };
      } else if (ident.name === sym.loaded_from_disk && loaded_from_disk !== undefined) {
        cx.adcx().duplicate_key(MetaItemOrLitParser.span(item), sym.loaded_from_disk);
      } else if (ident.name === sym.loaded_from_disk) {
        const entries = Symbol.as_str(value)
          .split(",")
          .map((s) => Symbol.intern(str_trim(s)));
        loaded_from_disk = { entries, span: value_span };
      } else {
        cx.adcx().expected_specific_argument(ident.span, [sym.cfg, sym.except, sym.loaded_from_disk]);
      }
    }
    if (cfg === undefined) {
      cx.adcx().expected_specific_argument(list.span, [sym.cfg]);
      return [];
    }

    return [{ span: cx.attr_span, cfg, except, loaded_from_disk }];
  },
};

export const RustcIfThisChangedParser: SingleAttributeParser = {
  ...SingleAttributeParser_provided,
  PATH: [sym.rustc_if_this_changed],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      // tidy-alphabetical-start
      Allow({ $: "AssocConst", _0: { $: "Impl", of_trait: false } }),
      Allow({ $: "AssocConst", _0: { $: "Impl", of_trait: true } }),
      Allow({ $: "AssocConst", _0: AssocCtxt.Trait }),
      Allow({ $: "AssocTy", _0: { $: "Impl", of_trait: false } }),
      Allow({ $: "AssocTy", _0: { $: "Impl", of_trait: true } }),
      Allow({ $: "AssocTy", _0: AssocCtxt.Trait }),
      Allow(Target.Const),
      Allow(Target.Enum),
      Allow(Target.Expression),
      Allow(Target.Field),
      Allow(Target.Fn),
      Allow(Target.ForeignMod),
      Allow({ $: "Impl", of_trait: false }),
      Allow({ $: "Impl", of_trait: true }),
      Allow({ $: "Method", _0: MethodKind.Inherent }),
      Allow({ $: "Method", _0: { $: "Trait", body: false } }),
      Allow({ $: "Method", _0: { $: "Trait", body: true } }),
      Allow({ $: "Method", _0: MethodKind.TraitImpl }),
      Allow(Target.Mod),
      Allow(Target.Static),
      Allow(Target.Struct),
      Allow(Target.Trait),
      Allow(Target.TyAlias),
      Allow(Target.Union),
      // tidy-alphabetical-end
    ],
  },
  TEMPLATE: template({ Word: true, List: ["DepNode"] }),
  STABILITY: unstable(sym.rustc_attrs),

  // rustc: compiler/rustc_attr_parsing/src/attributes/rustc_internal.rs:883 convert
  convert(cx, args) {
    if (!cx.shared.cx.sess().opts.unstable_opts.query_dep_graph) {
      cx.shared.emit_err(AttributeRequiresOpt_diagnostic({ span: cx.attr_span, opt: "-Z query-dep-graph" }));
    }
    switch (args.$) {
      case "NoArgs":
        return { $: "RustcIfThisChanged", _0: cx.attr_span, _1: undefined };
      case "List": {
        const list = args._0;
        const item = cx.expect_single(list);
        if (item === undefined) return undefined;
        const ident = MetaItemOrLitParser.meta_item_no_args(item)?.ident();
        if (ident === undefined) {
          cx.adcx().expected_identifier(MetaItemOrLitParser.span(item));
          return undefined;
        }
        return { $: "RustcIfThisChanged", _0: cx.attr_span, _1: ident.name };
      }
      case "NameValue": {
        const inner_span = cx.inner_span;
        cx.adcx().expected_list_or_no_args(inner_span);
        return undefined;
      }
    }
  },
};

export const RustcThenThisWouldNeedParser: CombineAttributeParser<Ident> = {
  ...CombineAttributeParser_provided,
  PATH: [sym.rustc_then_this_would_need],

  CONVERT: (items, _span) => ({ $: "RustcThenThisWouldNeed", _0: items }),
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      // tidy-alphabetical-start
      Allow({ $: "AssocConst", _0: { $: "Impl", of_trait: false } }),
      Allow({ $: "AssocConst", _0: { $: "Impl", of_trait: true } }),
      Allow({ $: "AssocConst", _0: AssocCtxt.Trait }),
      Allow({ $: "AssocTy", _0: { $: "Impl", of_trait: false } }),
      Allow({ $: "AssocTy", _0: { $: "Impl", of_trait: true } }),
      Allow({ $: "AssocTy", _0: AssocCtxt.Trait }),
      Allow(Target.Const),
      Allow(Target.Enum),
      Allow(Target.Expression),
      Allow(Target.Field),
      Allow(Target.Fn),
      Allow(Target.ForeignMod),
      Allow({ $: "Impl", of_trait: false }),
      Allow({ $: "Impl", of_trait: true }),
      Allow({ $: "Method", _0: MethodKind.Inherent }),
      Allow({ $: "Method", _0: { $: "Trait", body: false } }),
      Allow({ $: "Method", _0: { $: "Trait", body: true } }),
      Allow({ $: "Method", _0: MethodKind.TraitImpl }),
      Allow(Target.Mod),
      Allow(Target.Static),
      Allow(Target.Struct),
      Allow(Target.Trait),
      Allow(Target.TyAlias),
      Allow(Target.Union),
      // tidy-alphabetical-end
    ],
  },
  TEMPLATE: template({ List: ["DepNode"] }),
  STABILITY: unstable(sym.rustc_attrs),

  // rustc: compiler/rustc_attr_parsing/src/attributes/rustc_internal.rs:945 extend
  extend(cx, args): Iterable<Ident> {
    if (!cx.shared.cx.sess().opts.unstable_opts.query_dep_graph) {
      cx.shared.emit_err(AttributeRequiresOpt_diagnostic({ span: cx.attr_span, opt: "-Z query-dep-graph" }));
    }
    const item = cx.expect_single_element_list(args, cx.attr_span);
    if (item === undefined) return [];
    const ident = MetaItemOrLitParser.meta_item_no_args(item)?.ident();
    if (ident === undefined) {
      cx.adcx().expected_identifier(MetaItemOrLitParser.span(item));
      return [];
    }
    return [ident];
  },
};

export const RustcInsignificantDtorParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_insignificant_dtor],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [Allow(Target.Enum), Allow(Target.Struct), Allow(Target.ForeignTy)],
  },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => AttributeKind.RustcInsignificantDtor,
};

export const RustcEffectiveVisibilityParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_effective_visibility],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      Allow(Target.Use),
      Allow(Target.Static),
      Allow(Target.Const),
      Allow(Target.Fn),
      Allow(Target.Closure),
      Allow(Target.Mod),
      Allow(Target.ForeignMod),
      Allow(Target.TyAlias),
      Allow(Target.Enum),
      Allow(Target.Variant),
      Allow(Target.Struct),
      Allow(Target.Field),
      Allow(Target.Union),
      Allow(Target.Trait),
      Allow(Target.TraitAlias),
      Allow({ $: "Impl", of_trait: false }),
      Allow({ $: "Impl", of_trait: true }),
      Allow({ $: "AssocConst", _0: { $: "Impl", of_trait: false } }),
      Allow({ $: "AssocConst", _0: AssocCtxt.Trait }),
      Allow({ $: "AssocConst", _0: { $: "Impl", of_trait: true } }),
      Allow({ $: "Method", _0: MethodKind.Inherent }),
      Allow({ $: "Method", _0: { $: "Trait", body: false } }),
      Allow({ $: "Method", _0: { $: "Trait", body: true } }),
      Allow({ $: "Method", _0: MethodKind.TraitImpl }),
      Allow({ $: "AssocTy", _0: { $: "Impl", of_trait: false } }),
      Allow({ $: "AssocTy", _0: AssocCtxt.Trait }),
      Allow({ $: "AssocTy", _0: { $: "Impl", of_trait: true } }),
      Allow(Target.ForeignFn),
      Allow(Target.ForeignStatic),
      Allow(Target.ForeignTy),
      Allow(Target.MacroDef),
      Allow(Target.PatField),
      Allow(Target.Crate),
    ],
  },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => AttributeKind.RustcEffectiveVisibility,
};

export const RustcDiagnosticItemParser: SingleAttributeParser = {
  ...SingleAttributeParser_provided,
  PATH: [sym.rustc_diagnostic_item],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      Allow(Target.Trait),
      Allow(Target.Struct),
      Allow(Target.Enum),
      Allow(Target.MacroDef),
      Allow(Target.TyAlias),
      Allow({ $: "AssocConst", _0: { $: "Impl", of_trait: false } }),
      Allow({ $: "AssocConst", _0: AssocCtxt.Trait }),
      Allow({ $: "AssocConst", _0: { $: "Impl", of_trait: true } }),
      Allow({ $: "AssocTy", _0: { $: "Impl", of_trait: false } }),
      Allow({ $: "AssocTy", _0: AssocCtxt.Trait }),
      Allow({ $: "AssocTy", _0: { $: "Impl", of_trait: true } }),
      Allow(Target.Fn),
      Allow(Target.Const),
      Allow(Target.Mod),
      Allow({ $: "Impl", of_trait: false }),
      Allow({ $: "Method", _0: MethodKind.Inherent }),
      Allow({ $: "Method", _0: { $: "Trait", body: false } }),
      Allow({ $: "Method", _0: { $: "Trait", body: true } }),
      Allow({ $: "Method", _0: MethodKind.TraitImpl }),
      Allow(Target.Crate),
    ],
  },
  TEMPLATE: template({ NameValueStr: ["name"] }),
  STABILITY: unstable(
    sym.rustc_attrs,
    "the `rustc_diagnostic_item` attribute allows the compiler to reference types from the standard library for diagnostic purposes",
  ),

  // rustc: compiler/rustc_attr_parsing/src/attributes/rustc_internal.rs:1049 convert
  convert(cx, args) {
    const nv = cx.expect_name_value(args, cx.attr_span, undefined, ExpectNameValue.ArgParser);
    if (nv === undefined) return undefined;
    const value = cx.expect_string_literal(nv, ExpectStringLiteral.NameValueParser);
    if (value === undefined) return undefined;
    return { $: "RustcDiagnosticItem", _0: value };
  },
};

export const RustcDoNotConstCheckParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_do_not_const_check],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      Allow(Target.Fn),
      Allow({ $: "Method", _0: MethodKind.Inherent }),
      Allow({ $: "Method", _0: MethodKind.TraitImpl }),
      Allow({ $: "Method", _0: { $: "Trait", body: false } }),
      Allow({ $: "Method", _0: { $: "Trait", body: true } }),
    ],
  },
  STABILITY: unstable(
    sym.rustc_attrs,
    "the `rustc_do_not_const_check` attribute skips const-check for this function's body",
  ),
  CREATE: (_) => AttributeKind.RustcDoNotConstCheck,
};

export const RustcNonnullOptimizationGuaranteedParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_nonnull_optimization_guaranteed],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Struct)] },
  STABILITY: unstable(
    sym.rustc_attrs,
    "the `rustc_nonnull_optimization_guaranteed` attribute is just used to document guaranteed niche optimizations in the standard library",
    "the compiler does not even check whether the type indeed is being non-null-optimized; it is your responsibility to ensure that the attribute is only used on types that are optimized",
  ),
  CREATE: (_) => AttributeKind.RustcNonnullOptimizationGuaranteed,
};

export const RustcStrictCoherenceParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_strict_coherence],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      Allow(Target.Trait),
      Allow(Target.Struct),
      Allow(Target.Enum),
      Allow(Target.Union),
      Allow(Target.ForeignTy),
    ],
  },
  STABILITY: unstable(sym.rustc_attrs),
  // `AttributeKind::RustcStrictCoherence` (the tuple variant's constructor fn)
  CREATE: (span) => ({ $: "RustcStrictCoherence", _0: span }),
};

export const PreludeImportParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.prelude_import],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Use)] },
  STABILITY: unstable(sym.prelude_import),
  CREATE: (_) => AttributeKind.PreludeImport,
};

export const RustcDocPrimitiveParser: SingleAttributeParser = {
  ...SingleAttributeParser_provided,
  PATH: [sym.rustc_doc_primitive],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Const)] },
  TEMPLATE: template({ NameValueStr: ["primitive name"] }),
  STABILITY: unstable(
    sym.rustc_attrs,
    "the `rustc_doc_primitive` attribute is used by the standard library to provide a way to generate documentation for primitive types",
  ),

  // rustc: compiler/rustc_attr_parsing/src/attributes/rustc_internal.rs:1122 convert
  convert(cx, args) {
    const nv = cx.expect_name_value(args, cx.attr_span, undefined, ExpectNameValue.ArgParser);
    if (nv === undefined) return undefined;
    const value_str = cx.expect_string_literal(nv, ExpectStringLiteral.NameValueParser);
    if (value_str === undefined) return undefined;

    return { $: "RustcDocPrimitive", _0: cx.attr_span, _1: value_str };
  },
};

export const RustcIntrinsicParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_intrinsic],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Fn)] },
  STABILITY: unstable(sym.intrinsics),
  CREATE: (_) => AttributeKind.RustcIntrinsic,
};

export const RustcIntrinsicConstStableIndirectParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_intrinsic_const_stable_indirect],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Fn)] },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => AttributeKind.RustcIntrinsicConstStableIndirect,
};

export const RustcExhaustiveParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_must_match_exhaustively],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Enum)] },
  STABILITY: unstable(sym.rustc_attrs),
  // `AttributeKind::RustcMustMatchExhaustively` (the tuple variant's constructor fn)
  CREATE: (span) => ({ $: "RustcMustMatchExhaustively", _0: span }),
};

export const RustcCanonicalSymbolParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_canonical_symbol],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.ForeignFn)] },
  STABILITY: unstable(
    sym.rustc_attrs,
    "the `rustc_canonical_symbol` attribute registers a function's symbol to be linted against " +
      "by the `invalid_runtime_symbol_definitions` and `suspicious_runtime_symbol_definitions` " +
      "lints",
  ),
  CREATE: (_) => AttributeKind.RustcCanonicalSymbol,
};
