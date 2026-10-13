// Port of compiler/rustc_attr_parsing/src/attributes/no_implicit_prelude.rs
import { AttributeStability } from "../../rustc_feature/lib.ts";
import { NoArgsAttributeParser_provided } from "./mod.ts";
import { Allow, AttributeKind, type NoArgsAttributeParser, OnDuplicate, sym, Target } from "./prelude.ts";

export const NoImplicitPreludeParser: NoArgsAttributeParser = NoArgsAttributeParser_provided({
  PATH: [sym.no_implicit_prelude],
  ON_DUPLICATE: OnDuplicate.Warn,
  ALLOWED_TARGETS: { $: "AllowListWarnRest", _0: [Allow(Target.Mod), Allow(Target.Crate)] },
  STABILITY: AttributeStability.Stable,
  CREATE: (_) => AttributeKind.NoImplicitPrelude,
});
