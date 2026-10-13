// Port of compiler/rustc_attr_parsing/src/attributes/non_exhaustive.rs
import { AttributeStability } from "../../rustc_feature/lib.ts";
import { panic, unwrap } from "../../std/panic.ts";
import { NonExhaustiveWithDefaultFieldValues_diagnostic } from "../diagnostics.ts";
import { NoArgsAttributeParser_provided } from "./mod.ts";
import { Allow, type NoArgsAttributeParser, OnDuplicate, sym, Target, Warn } from "./prelude.ts";

export const NonExhaustiveParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.non_exhaustive],
  ON_DUPLICATE: OnDuplicate.Warn,
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      Allow(Target.Enum),
      Allow(Target.Struct),
      Allow(Target.Variant),
      Warn(Target.Field),
      Warn(Target.Arm),
      Warn(Target.MacroDef),
      Warn(Target.MacroCall),
    ],
  },
  STABILITY: AttributeStability.Stable,
  CREATE: (span) => ({ $: "NonExhaustive", _0: span }),

  // rustc: compiler/rustc_attr_parsing/src/attributes/non_exhaustive.rs:24 finalize_check
  finalize_check(cx, attr_span) {
    if (cx.shared.target.$ !== "Struct") {
      return;
    }

    const item = unwrap(cx.target_item, "missing AST target item for Target::Struct");
    if (item.kind.$ !== "Struct") {
      panic("expected struct AST target item for Target::Struct");
    }
    const data = item.kind._2;
    if (data.$ === "Struct" && data.fields.some((f) => f.default_value() !== undefined)) {
      cx.shared.emit_err(
        NonExhaustiveWithDefaultFieldValues_diagnostic({
          attr_span,
          defn_span: cx.shared.target_span,
        }),
      );
    }
  },
};
