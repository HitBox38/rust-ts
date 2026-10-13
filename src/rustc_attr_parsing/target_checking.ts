// STUB for compiler/rustc_attr_parsing/src/target_checking.rs (not assigned yet; see
// docs/handoff/attr-parse-a.md). Created by lane attr-parse-a: the types the crate core and the
// attribute parsers use (`AllowedTargets`, `AllowedResult`, `Policy`) and the methods
// interface.rs / context.rs call, as `unported` placeholders; no markers. The lane that ports
// target_checking.rs fills this file in place (same names) and adds `ALL_TARGETS`,
// `allowed_targets_applied` and `filter_targets`. rustc_attr_parsing/lib.ts imports this module
// after interface.ts and context.ts (extension-module load order).
import type { AttrItem, Attribute } from "../rustc_attr_ir/lib.ts";
import type { target } from "../rustc_attr_ir/lib.ts";
import type { Span } from "../rustc_span/lib.ts";
import { unported } from "../std/panic.ts";
import { unported_methods } from "../rust_ts/stubs.ts";
import { AcceptContext } from "./context.ts";
import { AttributeParser } from "./interface.ts";

type Target = target.Target;

/** `#[derive(Debug)] pub(crate) enum AllowedTargets<'a>` */
export type AllowedTargets =
  | { readonly $: "AllowList"; readonly _0: readonly Policy[] }
  | { readonly $: "AllowListWarnRest"; readonly _0: readonly Policy[] }
  /// This is useful for argument-dependent target checking.
  /// If debug assertions are enabled,
  /// this emits a delayed bug if the `cx.check_target(...)` method is not called during attribute parsing.
  | { readonly $: "ManuallyChecked" };
export const AllowedTargets = {
  ManuallyChecked: Object.freeze({ $: "ManuallyChecked" as const }) as AllowedTargets,
  is_allowed(_self: AllowedTargets, _target: Target): AllowedResult {
    return unported("rustc_attr_parsing::target_checking::AllowedTargets::is_allowed");
  },
  allowed_targets(_self: AllowedTargets): Target[] {
    return unported("rustc_attr_parsing::target_checking::AllowedTargets::allowed_targets");
  },
};

/** `pub(crate) enum AllowedResult` */
export type AllowedResult = "Allowed" | "Warn" | "Error";

/// This policy determines what diagnostics should be emitted based on the `Target` of the attribute.
/** `#[derive(Debug, Eq, PartialEq)] pub(crate) enum Policy` */
export type Policy =
  /// A target that is allowed.
  | { readonly $: "Allow"; readonly _0: Target }
  /// A target that is allowed and not listed in the possible targets.
  /// This is useful if the target is checked elsewhere.
  | { readonly $: "AllowSilent"; readonly _0: Target }
  /// Emits a FCW on this target.
  /// This is useful if the target was previously allowed but should not be.
  | { readonly $: "Warn"; readonly _0: Target }
  /// Emits an error on this target.
  | { readonly $: "Error"; readonly _0: Target };

declare module "./interface.ts" {
  interface AttributeParser {
    check_invalid_crate_level_attr_item(attr: AttrItem, inner_span: Span): void;
    first_line_of_next_item(span: Span): Span | undefined;
    check_invalid_where_predicate_attrs(attrs: Iterable<Attribute>): void;
  }
}
declare module "./context.ts" {
  interface AcceptContext {
    check_target(attribute_args: string, allowed_targets: AllowedTargets): void;
    ignore_target_checks(): void;
  }
}

const P = "rustc_attr_parsing::target_checking";
AttributeParser.check_target = (_allowed_targets, _attribute_args, _cx) => unported(`${P}::AttributeParser::check_target`);
AttributeParser.target_checking_help = (_attribute_args, _cx) => unported(`${P}::AttributeParser::target_checking_help`);
AttributeParser.check_crate_level = (_cx, _warn) => unported(`${P}::AttributeParser::check_crate_level`);
unported_methods(AttributeParser.prototype, `${P}::AttributeParser`, [
  "check_invalid_crate_level_attr_item",
  "first_line_of_next_item",
  "check_invalid_where_predicate_attrs",
]);
unported_methods(AcceptContext.prototype, `${P}::AcceptContext`, ["check_target", "ignore_target_checks"]);
