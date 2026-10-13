// Port of compiler/rustc_attr_parsing/src/attributes/rustc_dump.rs
import { AttributeKind, RustcDumpLayoutKind } from "../../rustc_attr_ir/lib.ts";
import { AssocCtxt, MethodKind, Target } from "../../rustc_attr_ir/target.ts";
import { sym } from "../../rustc_span/symbol.ts";
import { CombineAttributeParser_provided, NoArgsAttributeParser_provided, SingleAttributeParser_provided } from "./mod.ts";
import {
  Allow,
  type CombineAttributeParser,
  MetaItemOrLitParser,
  type NoArgsAttributeParser,
  type SingleAttributeParser,
  template,
  unstable,
} from "./prelude.ts";

export const RustcDumpUserArgsParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_dump_user_args],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Fn)] },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => AttributeKind.RustcDumpUserArgs,
};

export const RustcDumpDefParentsParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_dump_def_parents],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Fn)] },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => AttributeKind.RustcDumpDefParents,
};

export const RustcDumpDefPathParser: SingleAttributeParser = {
  ...SingleAttributeParser_provided,
  PATH: [sym.rustc_dump_def_path],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      Allow(Target.Fn),
      Allow({ $: "Method", _0: MethodKind.TraitImpl }),
      Allow({ $: "Method", _0: MethodKind.Inherent }),
      Allow({ $: "Method", _0: { $: "Trait", body: true } }),
      Allow(Target.ForeignFn),
      Allow(Target.ForeignStatic),
      Allow({ $: "Impl", of_trait: false }),
    ],
  },
  TEMPLATE: template({ Word: true }),
  STABILITY: unstable(sym.rustc_attrs),
  // rustc: compiler/rustc_attr_parsing/src/attributes/rustc_dump.rs:42 convert
  convert(cx, args) {
    if (cx.expect_no_args(args) === undefined) return undefined;
    return { $: "RustcDumpDefPath", _0: cx.attr_span };
  },
};

export const RustcDumpGenericsParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_dump_generics],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      Allow(Target.Struct),
      Allow(Target.Enum),
      Allow(Target.Union),
      Allow(Target.Trait),
      Allow(Target.TraitAlias),
      Allow(Target.Fn),
      Allow(Target.Closure),
      Allow(Target.TyAlias),
      Allow(Target.Const),
      Allow({ $: "AssocConst", _0: { $: "Impl", of_trait: false } }),
      Allow({ $: "AssocConst", _0: AssocCtxt.Trait }),
      Allow({ $: "AssocConst", _0: { $: "Impl", of_trait: true } }),
      Allow({ $: "AssocTy", _0: { $: "Impl", of_trait: false } }),
      Allow({ $: "AssocTy", _0: AssocCtxt.Trait }),
      Allow({ $: "AssocTy", _0: { $: "Impl", of_trait: true } }),
      Allow({ $: "Impl", of_trait: false }),
      Allow({ $: "Impl", of_trait: true }),
      Allow({ $: "Method", _0: MethodKind.Inherent }),
      Allow({ $: "Method", _0: { $: "Trait", body: false } }),
      Allow({ $: "Method", _0: { $: "Trait", body: true } }),
      Allow({ $: "Method", _0: MethodKind.TraitImpl }),
      Allow({ $: "Delegation", mac: false }),
      Allow({ $: "Delegation", mac: true }),
    ],
  },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => AttributeKind.RustcDumpGenerics,
};

export const RustcDumpHiddenTypeOfOpaquesParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_dump_hidden_type_of_opaques],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Crate)] },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => AttributeKind.RustcDumpHiddenTypeOfOpaques,
};

export const RustcDumpInferredOutlivesParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_dump_inferred_outlives],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [Allow(Target.Struct), Allow(Target.Enum), Allow(Target.Union), Allow(Target.TyAlias)],
  },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => AttributeKind.RustcDumpInferredOutlives,
};

export const RustcDumpItemBoundsParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_dump_item_bounds],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      Allow({ $: "AssocTy", _0: { $: "Impl", of_trait: false } }),
      Allow({ $: "AssocTy", _0: AssocCtxt.Trait }),
      Allow({ $: "AssocTy", _0: { $: "Impl", of_trait: true } }),
    ],
  },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => AttributeKind.RustcDumpItemBounds,
};

export const RustcDumpLayoutParser: CombineAttributeParser<RustcDumpLayoutKind> = {
  ...CombineAttributeParser_provided,
  PATH: [sym.rustc_dump_layout],

  CONVERT: (items, _) => ({ $: "RustcDumpLayout", _0: items }),

  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [Allow(Target.Struct), Allow(Target.Enum), Allow(Target.Union), Allow(Target.TyAlias)],
  },

  TEMPLATE: template({ List: ["abi", "align", "size", "homogenous_aggregate", "largest_niche", "debug"] }),
  STABILITY: unstable(sym.rustc_attrs),

  // rustc: compiler/rustc_attr_parsing/src/attributes/rustc_dump.rs:136 extend
  extend(cx, args) {
    const items = cx.expect_list(args, cx.attr_span);
    if (items === undefined) {
      return [];
    }

    const result: RustcDumpLayoutKind[] = [];
    for (const item of items.mixed()) {
      const arg = MetaItemOrLitParser.meta_item_no_args(item);
      if (arg === undefined) {
        cx.adcx().expected_not_literal(MetaItemOrLitParser.span(item));
        continue;
      }
      const ident = arg.ident();
      if (ident === undefined) {
        cx.adcx().expected_identifier(arg.span());
        return [];
      }
      let kind: RustcDumpLayoutKind;
      switch (ident.name) {
        case sym.align:
          kind = RustcDumpLayoutKind.Align;
          break;
        case sym.backend_repr:
          kind = RustcDumpLayoutKind.BackendRepr;
          break;
        case sym.debug:
          kind = RustcDumpLayoutKind.Debug;
          break;
        case sym.homogeneous_aggregate:
          kind = RustcDumpLayoutKind.HomogenousAggregate;
          break;
        case sym.largest_niche:
          kind = RustcDumpLayoutKind.LargestNiche;
          break;
        case sym.size:
          kind = RustcDumpLayoutKind.Size;
          break;
        default: {
          cx.adcx().expected_specific_argument(ident.span, [
            sym.align,
            sym.backend_repr,
            sym.debug,
            sym.homogeneous_aggregate,
            sym.size,
          ]);
          continue;
        }
      }
      result.push(kind);
    }
    return result;
  },
};

export const RustcDumpObjectLifetimeDefaultsParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_dump_object_lifetime_defaults],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      Allow({ $: "AssocConst", _0: { $: "Impl", of_trait: false } }),
      Allow({ $: "AssocConst", _0: AssocCtxt.Trait }),
      Allow({ $: "AssocConst", _0: { $: "Impl", of_trait: true } }),
      Allow({ $: "AssocTy", _0: { $: "Impl", of_trait: false } }),
      Allow({ $: "AssocTy", _0: AssocCtxt.Trait }),
      Allow({ $: "AssocTy", _0: { $: "Impl", of_trait: true } }),
      Allow(Target.Const),
      Allow(Target.Enum),
      Allow(Target.Fn),
      Allow(Target.ForeignFn),
      Allow({ $: "Impl", of_trait: false }),
      Allow({ $: "Impl", of_trait: true }),
      Allow({ $: "Method", _0: MethodKind.Inherent }),
      Allow({ $: "Method", _0: { $: "Trait", body: false } }),
      Allow({ $: "Method", _0: { $: "Trait", body: true } }),
      Allow({ $: "Method", _0: MethodKind.TraitImpl }),
      Allow(Target.Struct),
      Allow(Target.Trait),
      Allow(Target.TraitAlias),
      Allow(Target.TyAlias),
      Allow(Target.Union),
    ],
  },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => AttributeKind.RustcDumpObjectLifetimeDefaults,
};

export const RustcDumpClausesParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_dump_clauses],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      Allow({ $: "AssocConst", _0: { $: "Impl", of_trait: false } }),
      Allow({ $: "AssocConst", _0: AssocCtxt.Trait }),
      Allow({ $: "AssocConst", _0: { $: "Impl", of_trait: true } }),
      Allow({ $: "AssocTy", _0: { $: "Impl", of_trait: false } }),
      Allow({ $: "AssocTy", _0: AssocCtxt.Trait }),
      Allow({ $: "AssocTy", _0: { $: "Impl", of_trait: true } }),
      Allow(Target.Const),
      Allow({ $: "Delegation", mac: false }),
      Allow({ $: "Delegation", mac: true }),
      Allow(Target.Enum),
      Allow(Target.Fn),
      Allow({ $: "Impl", of_trait: false }),
      Allow({ $: "Impl", of_trait: true }),
      Allow({ $: "Method", _0: MethodKind.Inherent }),
      Allow({ $: "Method", _0: { $: "Trait", body: false } }),
      Allow({ $: "Method", _0: { $: "Trait", body: true } }),
      Allow({ $: "Method", _0: MethodKind.TraitImpl }),
      Allow(Target.Struct),
      Allow(Target.Trait),
      Allow(Target.TraitAlias),
      Allow(Target.TyAlias),
      Allow(Target.Union),
    ],
  },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => AttributeKind.RustcDumpClauses,
};

export const RustcDumpSymbolNameParser: SingleAttributeParser = {
  ...SingleAttributeParser_provided,
  PATH: [sym.rustc_dump_symbol_name],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      Allow(Target.Fn),
      Allow({ $: "Method", _0: MethodKind.TraitImpl }),
      Allow({ $: "Method", _0: MethodKind.Inherent }),
      Allow({ $: "Method", _0: { $: "Trait", body: true } }),
      Allow(Target.ForeignFn),
      Allow(Target.ForeignStatic),
      Allow({ $: "Impl", of_trait: false }),
    ],
  },
  TEMPLATE: template({ Word: true }),
  STABILITY: unstable(sym.rustc_attrs),
  // rustc: compiler/rustc_attr_parsing/src/attributes/rustc_dump.rs:259 convert
  convert(cx, args) {
    if (cx.expect_no_args(args) === undefined) return undefined;
    return { $: "RustcDumpSymbolName", _0: cx.attr_span };
  },
};

export const RustcDumpVariancesParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_dump_variances],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      Allow(Target.Enum),
      Allow(Target.Fn),
      Allow({ $: "Method", _0: MethodKind.Inherent }),
      Allow({ $: "Method", _0: { $: "Trait", body: false } }),
      Allow({ $: "Method", _0: { $: "Trait", body: true } }),
      Allow({ $: "Method", _0: MethodKind.TraitImpl }),
      Allow(Target.Struct),
      Allow(Target.Union),
    ],
  },
  STABILITY: unstable(sym.rustc_attrs, "the `rustc_dump_variances` attribute is used for rustc unit tests"),
  CREATE: (_) => AttributeKind.RustcDumpVariances,
};

export const RustcDumpVariancesOfOpaquesParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_dump_variances_of_opaques],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Crate)] },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => AttributeKind.RustcDumpVariancesOfOpaques,
};

export const RustcDumpVtableParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_dump_vtable],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow({ $: "Impl", of_trait: true }), Allow(Target.TyAlias)] },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (span) => ({ $: "RustcDumpVtable", _0: span }),
};
