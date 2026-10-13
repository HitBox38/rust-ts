//! Attributes that are only used on function prototypes.
// Port of compiler/rustc_attr_parsing/src/attributes/prototype.rs
import type { MirDialect, MirPhase } from "../../rustc_attr_ir/lib.ts";
import { Target } from "../../rustc_attr_ir/target.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { type Symbol, sym } from "../../rustc_span/symbol.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { type AcceptContext, ExpectNameValue, ExpectStringLiteral } from "../context.ts";
import * as diagnostics from "../diagnostics.ts";
import { MetaItemOrLitParser, type NameValueParser } from "../parser.ts";
import { unstable } from "../stability.ts";
import { template } from "../template.ts";
import { type SingleAttributeParser, SingleAttributeParser_provided } from "./mod.ts";
import { Allow } from "./prelude.ts";

export const CustomMirParser: SingleAttributeParser = SingleAttributeParser_provided({
  PATH: [sym.custom_mir],
  STABILITY: unstable(sym.custom_mir),

  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Fn)] },

  TEMPLATE: template({ List: [`dialect = "...", phase = "..."`] }),

  // rustc: compiler/rustc_attr_parsing/src/attributes/prototype.rs:25 convert
  convert(cx, args) {
    const list = cx.expect_list(args, cx.attr_span);
    if (list === undefined) return undefined;

    const dialect: MutRef<[Symbol, Span] | undefined> = { value: undefined };
    const phase: MutRef<[Symbol, Span] | undefined> = { value: undefined };
    const failed: MutRef<boolean> = { value: false };

    for (const item of list.mixed()) {
      const r = cx.expect_name_value(item, MetaItemOrLitParser.span(item), undefined, ExpectNameValue.MetaItemOrLitParser);
      if (r === undefined) {
        failed.value = true;
        break;
      }
      const [path, arg] = r;

      switch (path.name) {
        case sym.dialect:
          extract_value(cx, sym.dialect, arg, MetaItemOrLitParser.span(item), dialect, failed);
          break;
        case sym.phase:
          extract_value(cx, sym.phase, arg, MetaItemOrLitParser.span(item), phase, failed);
          break;
        default: {
          cx.adcx().expected_specific_argument(MetaItemOrLitParser.span(item), [sym.dialect, sym.phase]);
          failed.value = true;
        }
      }
    }

    const dialect_ = parse_dialect(cx, dialect.value, failed);
    const phase_ = parse_phase(cx, phase.value, failed);
    check_custom_mir(cx, dialect_, phase_, failed);

    if (failed.value) {
      return undefined;
    }

    return { $: "CustomMir", _0: dialect_, _1: phase_ };
  },
});

// rustc: compiler/rustc_attr_parsing/src/attributes/prototype.rs:64 extract_value
function extract_value(
  cx: AcceptContext,
  key: Symbol,
  val: NameValueParser,
  span: Span,
  out_val: MutRef<[Symbol, Span] | undefined>,
  failed: MutRef<boolean>,
): void {
  if (out_val.value !== undefined) {
    cx.adcx().duplicate_key(span, key);
    failed.value = true;
    return;
  }

  const value_sym = cx.expect_string_literal(val, ExpectStringLiteral.NameValueParser);
  if (value_sym === undefined) {
    failed.value = true;
    return;
  }

  out_val.value = [value_sym, val.value_span];
}

// rustc: compiler/rustc_attr_parsing/src/attributes/prototype.rs:86 parse_dialect
function parse_dialect(
  cx: AcceptContext,
  dialect0: [Symbol, Span] | undefined,
  failed: MutRef<boolean>,
): [MirDialect, Span] | undefined {
  if (dialect0 === undefined) return undefined;
  const [dialect1, span] = dialect0;

  let dialect: MirDialect;
  switch (dialect1) {
    case sym.analysis:
      dialect = "Analysis";
      break;
    case sym.built:
      dialect = "Built";
      break;
    case sym.runtime:
      dialect = "Runtime";
      break;

    default: {
      cx.adcx().expected_specific_argument(span, [sym.analysis, sym.built, sym.runtime]);
      failed.value = true;
      return undefined;
    }
  }

  return [dialect, span];
}

// rustc: compiler/rustc_attr_parsing/src/attributes/prototype.rs:108 parse_phase
function parse_phase(
  cx: AcceptContext,
  phase0: [Symbol, Span] | undefined,
  failed: MutRef<boolean>,
): [MirPhase, Span] | undefined {
  if (phase0 === undefined) return undefined;
  const [phase1, span] = phase0;

  let phase: MirPhase;
  switch (phase1) {
    case sym.initial:
      phase = "Initial";
      break;
    case sym.post_cleanup:
      phase = "PostCleanup";
      break;
    case sym.optimized:
      phase = "Optimized";
      break;

    default: {
      cx.adcx().expected_specific_argument(span, [sym.initial, sym.post_cleanup, sym.optimized]);
      failed.value = true;
      return undefined;
    }
  }

  return [phase, span];
}

// rustc: compiler/rustc_attr_parsing/src/attributes/prototype.rs:133 check_custom_mir
function check_custom_mir(
  cx: AcceptContext,
  dialect0: [MirDialect, Span] | undefined,
  phase: [MirPhase, Span] | undefined,
  failed: MutRef<boolean>,
): void {
  const attr_span = cx.attr_span;
  if (dialect0 === undefined) {
    if (phase !== undefined) {
      const [, phase_span] = phase;
      failed.value = true;
      cx.shared.emit_err(diagnostics.CustomMirPhaseRequiresDialect_diagnostic({ attr_span, phase_span }));
    }
    return;
  }
  const [dialect, dialect_span] = dialect0;

  switch (dialect) {
    case "Analysis": {
      if (phase !== undefined && phase[0] === "Optimized") {
        const phase_span = phase[1];
        failed.value = true;
        cx.shared.emit_err(
          diagnostics.CustomMirIncompatibleDialectAndPhase_diagnostic({
            dialect,
            phase: "Optimized",
            attr_span,
            dialect_span,
            phase_span,
          }),
        );
      }
      break;
    }

    case "Built": {
      if (phase !== undefined) {
        const [phase_, phase_span] = phase;
        failed.value = true;
        cx.shared.emit_err(
          diagnostics.CustomMirIncompatibleDialectAndPhase_diagnostic({
            dialect,
            phase: phase_,
            attr_span,
            dialect_span,
            phase_span,
          }),
        );
      }
      break;
    }
    case "Runtime":
      break;
  }
}
