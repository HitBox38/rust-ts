// Port of compiler/rustc_attr_parsing/src/attributes/pin_v2.rs
import { Target } from "../../rustc_attr_ir/target.ts";
import { sym } from "../../rustc_span/symbol.ts";
import { unstable } from "../stability.ts";
import { type NoArgsAttributeParser, NoArgsAttributeParser_provided } from "./mod.ts";
import { Allow } from "./prelude.ts";

export const PinV2Parser: NoArgsAttributeParser = NoArgsAttributeParser_provided({
  PATH: [sym.pin_v2],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Enum), Allow(Target.Struct), Allow(Target.Union)] },
  STABILITY: unstable(sym.pin_ergonomics),
  CREATE: (span) => ({ $: "PinV2", _0: span }),
});
