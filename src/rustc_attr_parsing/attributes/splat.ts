//! Attribute parsing for the `#[rustc_splat]` function argument overloading attribute.
//! This attribute modifies typecheck to support overload resolution, then modifies codegen for performance.
// Port of compiler/rustc_attr_parsing/src/attributes/splat.rs
import { NoArgsAttributeParser_provided } from "./mod.ts";
import { Allow, type NoArgsAttributeParser, sym, Target, unstable } from "./prelude.ts";

export const SplatParser: NoArgsAttributeParser = NoArgsAttributeParser_provided({
  PATH: [sym.rustc_splat],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Param)] },
  STABILITY: unstable(sym.splat, "the `rustc_splat` attribute is experimental"),
  CREATE: (span) => ({ $: "Splat", _0: span }),
});
