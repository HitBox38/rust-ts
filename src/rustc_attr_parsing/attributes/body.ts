//! Attributes that can be found in function body.
// Port of compiler/rustc_attr_parsing/src/attributes/body.rs
import { NoArgsAttributeParser_provided } from "./mod.ts";
import { Allow, AttributeKind, type NoArgsAttributeParser, sym, Target, unstable } from "./prelude.ts";

export const CoroutineParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.coroutine],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Closure)] },
  STABILITY: unstable(sym.coroutines),
  CREATE: (_) => AttributeKind.Coroutine,
};
