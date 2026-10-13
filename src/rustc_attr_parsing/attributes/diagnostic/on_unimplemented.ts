// Port of compiler/rustc_attr_parsing/src/attributes/diagnostic/on_unimplemented.rs
//
// PORT: the inherent `impl OnUnimplementedParser { fn parse }` is a member of the parser's table
// (alongside its `AttributeParser` items), taking the state as its first parameter.
import type { diagnostic } from "../../../rustc_attr_ir/lib.ts";
import { AttributeStability } from "../../../rustc_feature/lib.ts";
import { field_mut } from "../../../std/mut_ref.ts";
import { AttributeParser_provided } from "../mod.ts";
import {
  type AcceptContext,
  Allow,
  type ArgParser,
  type AttributeParser,
  type Span,
  sym,
  Target,
  template,
  unstable,
} from "../prelude.ts";
import { merge_directives, Mode, parse_directive_items, parse_list } from "./mod.ts";

type Directive = diagnostic.Directive;

/** `#[derive(Default)] pub(crate) struct OnUnimplementedParser` */
export interface OnUnimplementedParser {
  span: Span | undefined;
  directive: [Span, Directive] | undefined;
}

export const OnUnimplementedParser: AttributeParser<OnUnimplementedParser> & {
  parse(self: OnUnimplementedParser, cx: AcceptContext, args: ArgParser, mode: Mode): void;
} = {
  // rustc: compiler/rustc_attr_parsing/src/attributes/diagnostic/on_unimplemented.rs:14 parse
  parse(self: OnUnimplementedParser, cx: AcceptContext, args: ArgParser, mode: Mode): void {
    const span = cx.attr_span;
    self.span = span;

    const items = parse_list(cx, args, mode);
    if (items === undefined) return;

    const directive = parse_directive_items(cx, mode, items.mixed(), true);
    if (directive !== undefined) {
      merge_directives(cx, field_mut(self, "directive"), [span, directive]);
    }
  },

  ...AttributeParser_provided<OnUnimplementedParser>({
    default: () => ({ span: undefined, directive: undefined }),
    ATTRIBUTES: [
      [
        [sym.diagnostic, sym.on_unimplemented],
        template({ List: [`/*opt*/ message = "...", /*opt*/ label = "...", /*opt*/ note = "..."`] }),
        AttributeStability.Stable,
        (this_, cx, args) => {
          OnUnimplementedParser.parse(this_, cx, args, Mode.DiagnosticOnUnimplemented);
        },
      ],
      [
        [sym.rustc_on_unimplemented],
        template({ List: [`/*opt*/ message = "...", /*opt*/ label = "...", /*opt*/ note = "..."`] }),
        unstable(
          sym.rustc_attrs,
          "see the `diagnostic::on_unimplemented` attribute for the stable equivalent of this attribute",
        ),
        (this_, cx, args) => {
          OnUnimplementedParser.parse(this_, cx, args, Mode.RustcOnUnimplemented);
        },
      ],
    ],
    ALLOWED_TARGETS: { $: "AllowListWarnRest", _0: [Allow(Target.Trait)] },

    // rustc: compiler/rustc_attr_parsing/src/attributes/diagnostic/on_unimplemented.rs:51 finalize
    finalize(self, _cx) {
      if (self.span !== undefined) {
        return {
          $: "OnUnimplemented",
          directive: self.directive === undefined ? undefined : self.directive[1],
        };
      } else {
        return undefined;
      }
    },
  }),
};
