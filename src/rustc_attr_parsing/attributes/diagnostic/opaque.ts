// Port of compiler/rustc_attr_parsing/src/attributes/diagnostic/opaque.rs
//
// PORT: the inherent `impl OpaqueParser { fn parse }` is a member of the parser's table (after its
// `AttributeParser` items, as upstream), taking the state as its first parameter. The accept fn
// `OpaqueParser::parse` (a fn item) is the closure `(this_, cx, args) => OpaqueParser.parse(..)`,
// because the table does not exist yet while its `ATTRIBUTES` are built.
import { AttributeKind } from "../../../rustc_attr_ir/lib.ts";
import { AttributeStability } from "../../../rustc_feature/lib.ts";
import { MALFORMED_DIAGNOSTIC_ATTRIBUTES } from "../../../rustc_lint_defs/builtin.ts";
import type { Span } from "../../../rustc_span/lib.ts";
import { sym } from "../../../rustc_span/symbol.ts";
import type { AcceptContext } from "../../context.ts";
import { OpaqueDoesNotExpectArgs_diagnostic } from "../../diagnostics.ts";
import type { ArgParser } from "../../parser.ts";
import { unstable } from "../../stability.ts";
import { template } from "../../template.ts";
import { type AttributeParser, AttributeParser_provided } from "../mod.ts";
import { Allow, Target } from "../prelude.ts";
import { gate_diagnostic_attr } from "./mod.ts";

/** `#[derive(Default)] pub(crate) struct OpaqueParser` */
export interface OpaqueParser {
  attr_span: Span | undefined;
}

export const OpaqueParser: AttributeParser<OpaqueParser> & {
  parse(self: OpaqueParser, cx: AcceptContext, args: ArgParser): void;
} = {
  ...AttributeParser_provided,
  default: () => ({ attr_span: undefined }),
  ATTRIBUTES: [
    [
      [sym.diagnostic, sym.opaque],
      template({ Word: true }),
      AttributeStability.Stable, // Unstable, stability checked manually below
      (this_, cx, args) => {
        if (gate_diagnostic_attr(cx, args, "diagnostic_opaque")) return;
        OpaqueParser.parse(this_, cx, args);
      },
    ],
    [
      // For use on exported macros, where using tool attributes is an error.
      [sym.rustc_diagnostic_opaque],
      template({ Word: true }),
      unstable(
        sym.rustc_attrs,
        "see `#[diagnostic::opaque]` for the nightly equivalent of this attribute",
      ),
      (this_, cx, args) => OpaqueParser.parse(this_, cx, args),
    ],
  ],
  ALLOWED_TARGETS: { $: "AllowListWarnRest", _0: [Allow(Target.MacroDef)] },

  // rustc: compiler/rustc_attr_parsing/src/attributes/diagnostic/opaque.rs:46 finalize
  finalize(self, _cx) {
    if (self.attr_span !== undefined) {
      return AttributeKind.Opaque;
    } else {
      return undefined;
    }
  },

  // rustc: compiler/rustc_attr_parsing/src/attributes/diagnostic/opaque.rs:52 parse
  parse(self: OpaqueParser, cx: AcceptContext, args: ArgParser): void {
    const attr_span = cx.attr_span;
    if (self.attr_span !== undefined) {
      const earlier_span = self.attr_span;
      cx.shared.warn_unused_duplicate(earlier_span, attr_span);
    }
    self.attr_span = attr_span;

    if (!(args.$ === "NoArgs")) {
      cx.shared.emit_lint(MALFORMED_DIAGNOSTIC_ATTRIBUTES, OpaqueDoesNotExpectArgs_diagnostic({}), attr_span);
    }
  },
};
