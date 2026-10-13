// Port of compiler/rustc_attr_parsing/src/attributes/no_link.rs
import { AttributeStability } from "../../rustc_feature/lib.ts";
import { NoArgsAttributeParser_provided } from "./mod.ts";
import { Allow, AttributeKind, type NoArgsAttributeParser, OnDuplicate, sym, Target, Warn } from "./prelude.ts";

export const NoLinkParser: NoArgsAttributeParser = NoArgsAttributeParser_provided({
  PATH: [sym.no_link],
  ON_DUPLICATE: OnDuplicate.Warn,
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [Allow(Target.ExternCrate), Warn(Target.Field), Warn(Target.Arm), Warn(Target.MacroDef)],
  },
  STABILITY: AttributeStability.Stable,
  CREATE: (_) => AttributeKind.NoLink,
});
