// Port of compiler/rustc_attr_parsing/src/attributes/lint_helpers.rs
import { find_attr } from "../../rustc_attr_ir/lib.ts";
import { AttributeStability } from "../../rustc_feature/lib.ts";
import { RustcPubTransparent_diagnostic } from "../diagnostics.ts";
import { NoArgsAttributeParser_provided } from "./mod.ts";
import { Allow, AttributeKind, Error, MethodKind, type NoArgsAttributeParser, OnDuplicate, sym, Target, unstable } from "./prelude.ts";

export const RustcAsPtrParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_as_ptr],
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
  CREATE: (_) => AttributeKind.RustcAsPtr,
};

export const RustcPubTransparentParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_pub_transparent],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Struct), Allow(Target.Enum), Allow(Target.Union)] },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (span) => ({ $: "RustcPubTransparent", _0: span }),

  // rustc: compiler/rustc_attr_parsing/src/attributes/lint_helpers.rs:32 finalize_check
  finalize_check(cx, attr_span) {
    // `#[rustc_pub_transparent]` may only be applied to `#[repr(transparent)]` types.
    const is_transparent =
      find_attr(cx.parsed_attrs, (k) =>
        k.$ === "Repr" && k.reprs.some(([r, _]) => r.$ === "ReprTransparent") ? null : undefined,
      ) !== undefined;
    if (!is_transparent) {
      cx.shared.emit_err(RustcPubTransparent_diagnostic({ span: cx.shared.target_span, attr_span }));
    }
  },
};

export const RustcPassByValueParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_pass_by_value],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Struct), Allow(Target.Enum), Allow(Target.TyAlias)] },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => AttributeKind.RustcPassByValue,
};

export const RustcShouldNotBeCalledOnConstItemsParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_should_not_be_called_on_const_items],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [Allow({ $: "Method", _0: MethodKind.Inherent }), Allow({ $: "Method", _0: MethodKind.TraitImpl })],
  },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => AttributeKind.RustcShouldNotBeCalledOnConstItems,
};

export const AutomaticallyDerivedParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.automatically_derived],
  ON_DUPLICATE: OnDuplicate.Warn,
  ALLOWED_TARGETS: {
    $: "AllowListWarnRest",
    _0: [Allow({ $: "Impl", of_trait: true }), Error(Target.Crate), Error(Target.WherePredicate)],
  },
  STABILITY: AttributeStability.Stable,
  CREATE: (_) => AttributeKind.AutomaticallyDerived,
};
