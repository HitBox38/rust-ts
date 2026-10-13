// Port of compiler/rustc_attr_parsing/src/attributes/loop_match.rs
import { NoArgsAttributeParser_provided } from "./mod.ts";
import { Allow, type NoArgsAttributeParser, sym, Target, unstable } from "./prelude.ts";

export const LoopMatchParser: NoArgsAttributeParser = NoArgsAttributeParser_provided({
  PATH: [sym.loop_match],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Loop)] },
  STABILITY: unstable(sym.loop_match),
  CREATE: (span) => ({ $: "LoopMatch", _0: span }),
});

export const ConstContinueParser: NoArgsAttributeParser = NoArgsAttributeParser_provided({
  PATH: [sym.const_continue],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Break)] },
  STABILITY: unstable(sym.loop_match),
  CREATE: (span) => ({ $: "ConstContinue", _0: span }),
});
