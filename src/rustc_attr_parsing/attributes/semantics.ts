// Port of compiler/rustc_attr_parsing/src/attributes/semantics.rs
import { NoArgsAttributeParser_provided } from "./mod.ts";
import { Allow, AssocCtxt, AttributeKind, MethodKind, type NoArgsAttributeParser, sym, Target, unstable } from "./prelude.ts";

export const MayDangleParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.may_dangle],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.TypeParam), Allow(Target.LifetimeParam)] },
  STABILITY: unstable(sym.dropck_eyepatch),
  CREATE: (span) => ({ $: "MayDangle", _0: span }),
};

export const ComptimeParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_comptime],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [Allow({ $: "Method", _0: MethodKind.Inherent }), Allow(Target.Fn), Allow({ $: "Impl", of_trait: false })],
  },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (span) => ({ $: "RustcComptime", _0: span }),
};

export const AlwaysGcaParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_always_gca],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow({ $: "AssocConst", _0: AssocCtxt.Trait })] },
  STABILITY: unstable(sym.gca_min_const_items),
  CREATE: (_) => AttributeKind.AlwaysGca,
};
