// Port of compiler/rustc_attr_parsing/src/attributes/prelude.rs
//
// PORT: `use super::prelude::*;` -> named imports from this module. The `pub(super) use` items are
// re-exported under their upstream names. `use crate::target_checking::Policy::{Allow, Error, Warn}`
// imports enum variants as constructors; here they are constructor functions building the `Policy`
// variant (`Allow(Target.Fn)` is `{ $: "Allow", _0: Target.Fn }`), defined here rather than taken from
// target_checking.ts for the load-order reason given at `AllowedTargets` below. `Error` shadows the JS global of
// the same name only in the modules that import it, like the Rust variant import does.
// `ThinVec` maps to `T[]` and `crate::parser::*` to the named exports of parser.ts, so neither is
// re-exported here.
import type { target } from "../../rustc_attr_ir/lib.ts";
import type { Policy } from "../target_checking.ts";

// data structures
export { AttributeKind } from "../../rustc_attr_ir/lib.ts";
export { AssocCtxt, MethodKind, Target } from "../../rustc_attr_ir/target.ts";
export { Span } from "../../rustc_span/lib.ts";
export { Ident, Symbol, sym } from "../../rustc_span/symbol.ts";

export {
  type AcceptMapping,
  type AttributeParser,
  type CombineAttributeParser,
  type ConvertFn,
  type NoArgsAttributeParser,
  OnDuplicate,
  type SingleAttributeParser,
} from "./mod.ts";
// contexts
export { AcceptContext, FinalizeCheckContext, FinalizeContext } from "../context.ts";
export {
  ArgParser,
  type MetaItemListParser,
  MetaItemOrLitParser,
  MetaItemParser,
  NameValueParser,
  PathParser,
} from "../parser.ts";
// target checking
// pub(super) use crate::target_checking::Policy::{Allow, Error, Warn};
/** `Policy::Allow` */
export function Allow(t: target.Target): Policy {
  return { $: "Allow", _0: t };
}
/** `Policy::Error` */
export function Error(t: target.Target): Policy {
  return { $: "Error", _0: t };
}
/** `Policy::Warn` */
export function Warn(t: target.Target): Policy {
  return { $: "Warn", _0: t };
}
// PORT: type-only. target_checking.ts attaches methods to `AcceptContext` (context.ts) when it is
// evaluated, and context.ts imports the parser modules: a value import from a parser module would
// evaluate target_checking.ts while context.ts is still evaluating (TDZ). `ALL_TARGETS` (used by
// doc.rs only) is not re-exported for the same reason.
export type { AllowedTargets } from "../target_checking.ts";
export { unstable } from "../stability.ts";
export { AttributeTemplate, template } from "../template.ts";
