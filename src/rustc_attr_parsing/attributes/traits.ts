// Port of compiler/rustc_attr_parsing/src/attributes/traits.rs
import type { MutRef } from "../../std/mut_ref.ts";
import type { AttributeSafety } from "./mod.ts";
import { NoArgsAttributeParser_provided, SingleAttributeParser_provided } from "./mod.ts";
import {
  Allow,
  AttributeKind,
  MetaItemOrLitParser,
  MethodKind,
  type NoArgsAttributeParser,
  type SingleAttributeParser,
  type Symbol,
  sym,
  Target,
  template,
  unstable,
} from "./prelude.ts";

export const RustcSkipDuringMethodDispatchParser: SingleAttributeParser = SingleAttributeParser_provided({
  PATH: [sym.rustc_skip_during_method_dispatch],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Trait)] },

  TEMPLATE: template({ List: ["array, boxed_slice"] }),
  STABILITY: unstable(sym.rustc_attrs),

  // rustc: compiler/rustc_attr_parsing/src/attributes/traits.rs:21 convert
  convert(cx, args_) {
    const array: MutRef<boolean> = { value: false };
    const boxed_slice: MutRef<boolean> = { value: false };
    const args = cx.expect_list(args_, cx.attr_span);
    if (args === undefined) return undefined;
    if (args.is_empty()) {
      cx.adcx().expected_at_least_one_argument(args.span);
      return undefined;
    }
    for (const arg0 of args.mixed()) {
      const arg = MetaItemOrLitParser.meta_item(arg0);
      if (arg === undefined) {
        cx.adcx().expected_not_literal(MetaItemOrLitParser.span(arg0));
        continue;
      }
      void cx.expect_no_args(arg.args());
      const path = arg.path();
      let key: Symbol;
      let skip: MutRef<boolean>;
      const w = path.word_sym();
      if (w === sym.array) {
        [key, skip] = [w, array];
      } else if (w === sym.boxed_slice) {
        [key, skip] = [w, boxed_slice];
      } else {
        cx.adcx().expected_specific_argument(path.span(), [sym.array, sym.boxed_slice]);
        continue;
      }
      // `mem::replace(skip, true)`
      const old = skip.value;
      skip.value = true;
      if (old) {
        cx.adcx().duplicate_key(arg.span(), key);
      }
    }
    return { $: "RustcSkipDuringMethodDispatch", array: array.value, boxed_slice: boxed_slice.value };
  },
});

export const RustcParenSugarParser: NoArgsAttributeParser = NoArgsAttributeParser_provided({
  PATH: [sym.rustc_paren_sugar],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Trait)] },
  STABILITY: unstable(sym.unboxed_closures),
  CREATE: (_) => AttributeKind.RustcParenSugar,
});

// Markers

export const MarkerParser: NoArgsAttributeParser = NoArgsAttributeParser_provided({
  PATH: [sym.marker],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Trait)] },
  STABILITY: unstable(sym.marker_trait_attr),
  CREATE: (_) => AttributeKind.Marker,
});

export const RustcDenyExplicitImplParser: NoArgsAttributeParser = NoArgsAttributeParser_provided({
  PATH: [sym.rustc_deny_explicit_impl],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Trait)] },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => AttributeKind.RustcDenyExplicitImpl,
});

export const RustcDynIncompatibleTraitParser: NoArgsAttributeParser = NoArgsAttributeParser_provided({
  PATH: [sym.rustc_dyn_incompatible_trait],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Trait)] },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (span) => ({ $: "RustcDynIncompatibleTrait", _0: span }),
});

// Specialization

export const RustcSpecializationTraitParser: NoArgsAttributeParser = NoArgsAttributeParser_provided({
  PATH: [sym.rustc_specialization_trait],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Trait)] },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => AttributeKind.RustcSpecializationTrait,
});

export const RustcAllowLifetimeDependentSpecializationParser: NoArgsAttributeParser = NoArgsAttributeParser_provided({
  PATH: [sym.rustc_allow_lifetime_dependent_specialization],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Trait)] },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => AttributeKind.RustcAllowLifetimeDependentSpecialization,
  SAFETY: {
    $: "Unsafe",
    note:
      "this attribute requires `unsafe` because lifetime constraints from " +
      "the implementations of the trait are not considered when specializing",
    unsafe_since: undefined,
  } satisfies AttributeSafety,
});

// Coherence

export const RustcCoinductiveParser: NoArgsAttributeParser = NoArgsAttributeParser_provided({
  PATH: [sym.rustc_coinductive],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Trait)] },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => AttributeKind.RustcCoinductive,
});

export const RustcAllowIncoherentImplParser: NoArgsAttributeParser = NoArgsAttributeParser_provided({
  PATH: [sym.rustc_allow_incoherent_impl],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow({ $: "Method", _0: MethodKind.Inherent })] },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (span) => ({ $: "RustcAllowIncoherentImpl", _0: span }),
});

export const FundamentalParser: NoArgsAttributeParser = NoArgsAttributeParser_provided({
  PATH: [sym.fundamental],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Struct), Allow(Target.Trait)] },
  STABILITY: unstable(sym.fundamental),
  CREATE: (_) => AttributeKind.Fundamental,
});
