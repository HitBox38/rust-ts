// Port of compiler/rustc_attr_parsing/src/attributes/crate_level.rs.
// Parser types are trait tables (attributes/mod.ts); see docs/handoff/attr-parse-a.md.
import { AttributeKind, type WindowsSubsystemKind } from "../../rustc_attr_ir/lib.ts";
import { Target } from "../../rustc_attr_ir/target.ts";
import { AttributeStability } from "../../rustc_feature/lib.ts";
import { DUPLICATE_TOOLS, UNKNOWN_CRATE_TYPES } from "../../rustc_lint_defs/builtin.ts";
import { find_best_match_for_name_with_substrings } from "../../rustc_span/edit_distance.ts";
import { Span } from "../../rustc_span/lib.ts";
import { type Ident, sym, Symbol } from "../../rustc_span/symbol.ts";
import { CrateType } from "../../rustc_structures/crate_type.ts";
import { type AcceptContext, ExpectNameValue, ExpectStringLiteral, type FinalizeContext, ShouldEmit } from "../context.ts";
import { DuplicateTool_diagnostic, ToolReserved_diagnostic, UnknownCrateTypes_diagnostic } from "../diagnostics.ts";
import { type ArgParser, MetaItemOrLitParser } from "../parser.ts";
import { unstable } from "../stability.ts";
import { AllowedTargets, Policy } from "../target_checking.ts";
import { template } from "../template.ts";
import {
  type AttributeParser,
  AttributeParser_provided,
  type CombineAttributeParser,
  CombineAttributeParser_provided,
  type NoArgsAttributeParser,
  NoArgsAttributeParser_provided,
  OnDuplicate,
  type SingleAttributeParser,
  SingleAttributeParser_provided,
} from "./mod.ts";

const { Allow } = Policy;

export const CrateNameParser: SingleAttributeParser = SingleAttributeParser_provided({
  PATH: [sym.crate_name],
  ON_DUPLICATE: OnDuplicate.WarnButFutureError,
  TEMPLATE: template({ NameValueStr: ["name"] }),
  ALLOWED_TARGETS: { $: "AllowListWarnRest", _0: [Allow(Target.Crate)] },
  STABILITY: AttributeStability.Stable,

  // rustc: compiler/rustc_attr_parsing/src/attributes/crate_level.rs:24 convert
  convert(cx: AcceptContext, args: ArgParser): AttributeKind | undefined {
    const n = cx.expect_name_value(args, cx.attr_span, undefined, ExpectNameValue.ArgParser);
    if (n === undefined) return undefined;

    const name = cx.expect_string_literal(n, ExpectStringLiteral.NameValueParser);
    if (name === undefined) return undefined;

    return { $: "CrateName", name, name_span: n.value_span, attr_span: cx.attr_span };
  },
});

export const CrateTypeParser: CombineAttributeParser<CrateType> = CombineAttributeParser_provided<CrateType>({
  PATH: [sym.crate_type],
  CONVERT: (items, _) => ({ $: "CrateType", _0: items }),
  ALLOWED_TARGETS: { $: "AllowListWarnRest", _0: [Allow(Target.Crate)] },
  TEMPLATE: template({ NameValueStr: ["crate type"] }, "https://doc.rust-lang.org/reference/linkage.html"),
  STABILITY: AttributeStability.Stable,

  // PORT: `impl IntoIterator` is the `Option<CrateType>` (`?` returns `None`), as an array.
  // rustc: compiler/rustc_attr_parsing/src/attributes/crate_level.rs:45 extend
  extend(cx: AcceptContext, args: ArgParser): CrateType[] {
    const n = cx.expect_name_value(args, cx.attr_span, undefined, ExpectNameValue.ArgParser);
    if (n === undefined) return [];

    const crate_type_ = cx.expect_string_literal(n, ExpectStringLiteral.NameValueParser);
    if (crate_type_ === undefined) return [];

    const r = CrateType.try_from(crate_type_);
    if (r.$ === "Err") {
      // We don't error on invalid `#![crate_type]` when not applied to a crate
      if (cx.shared.target.$ === "Crate") {
        const candidate = find_best_match_for_name_with_substrings(
          CrateType.all_stable().map(([name, _]) => name),
          crate_type_,
          5,
        );
        const span = n.value_span;
        cx.shared.emit_lint(
          UNKNOWN_CRATE_TYPES,
          UnknownCrateTypes_diagnostic({
            sugg: candidate === undefined ? undefined : { span, snippet: candidate },
          }),
          span,
        );
      }
      return [];
    }
    const crate_type = r._0;

    return [crate_type];
  },
});

export const RecursionLimitParser: SingleAttributeParser = SingleAttributeParser_provided({
  PATH: [sym.recursion_limit],
  ON_DUPLICATE: OnDuplicate.WarnButFutureError,
  TEMPLATE: template({ NameValueStr: ["N"] }, "https://doc.rust-lang.org/reference/attributes/limits.html#the-recursion_limit-attribute"),
  ALLOWED_TARGETS: { $: "AllowListWarnRest", _0: [Allow(Target.Crate)] },
  STABILITY: AttributeStability.Stable,

  // rustc: compiler/rustc_attr_parsing/src/attributes/crate_level.rs:87 convert
  convert(cx: AcceptContext, args: ArgParser): AttributeKind | undefined {
    const nv = cx.expect_name_value(args, cx.attr_span, undefined, ExpectNameValue.ArgParser);
    if (nv === undefined) return undefined;

    const limit = cx.parse_limit_int(nv);
    if (limit === undefined) return undefined;
    return { $: "RecursionLimit", limit };
  },
});

export const MoveSizeLimitParser: SingleAttributeParser = SingleAttributeParser_provided({
  PATH: [sym.move_size_limit],
  TEMPLATE: template({ NameValueStr: ["N"] }),
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Crate)] },
  STABILITY: unstable(sym.large_assignments),

  // rustc: compiler/rustc_attr_parsing/src/attributes/crate_level.rs:102 convert
  convert(cx: AcceptContext, args: ArgParser): AttributeKind | undefined {
    const nv = cx.expect_name_value(args, cx.attr_span, undefined, ExpectNameValue.ArgParser);
    if (nv === undefined) return undefined;

    const limit = cx.parse_limit_int(nv);
    if (limit === undefined) return undefined;
    return { $: "MoveSizeLimit", limit };
  },
});

export const TypeLengthLimitParser: SingleAttributeParser = SingleAttributeParser_provided({
  PATH: [sym.type_length_limit],
  ON_DUPLICATE: OnDuplicate.WarnButFutureError,
  TEMPLATE: template({ NameValueStr: ["N"] }),
  ALLOWED_TARGETS: { $: "AllowListWarnRest", _0: [Allow(Target.Crate)] },
  STABILITY: AttributeStability.Stable,

  // rustc: compiler/rustc_attr_parsing/src/attributes/crate_level.rs:119 convert
  convert(cx: AcceptContext, args: ArgParser): AttributeKind | undefined {
    const nv = cx.expect_name_value(args, cx.attr_span, undefined, ExpectNameValue.ArgParser);
    if (nv === undefined) return undefined;

    const limit = cx.parse_limit_int(nv);
    if (limit === undefined) return undefined;
    return { $: "TypeLengthLimit", limit };
  },
});

export const PatternComplexityLimitParser: SingleAttributeParser = SingleAttributeParser_provided({
  PATH: [sym.pattern_complexity_limit],
  TEMPLATE: template({ NameValueStr: ["N"] }),
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Crate)] },
  STABILITY: unstable(sym.rustc_attrs, "the `pattern_complexity_limit` attribute is used for rustc unit tests"),

  // rustc: compiler/rustc_attr_parsing/src/attributes/crate_level.rs:137 convert
  convert(cx: AcceptContext, args: ArgParser): AttributeKind | undefined {
    const nv = cx.expect_name_value(args, cx.attr_span, undefined, ExpectNameValue.ArgParser);
    if (nv === undefined) return undefined;

    const limit = cx.parse_limit_int(nv);
    if (limit === undefined) return undefined;
    return { $: "PatternComplexityLimit", limit };
  },
});

export const NoCoreParser: NoArgsAttributeParser = NoArgsAttributeParser_provided({
  PATH: [sym.no_core],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Crate)] },
  STABILITY: unstable(sym.no_core),
  CREATE: (_) => AttributeKind.NoCore,
});

export const NoStdParser: NoArgsAttributeParser = NoArgsAttributeParser_provided({
  PATH: [sym.no_std],
  ON_DUPLICATE: OnDuplicate.Warn,
  ALLOWED_TARGETS: { $: "AllowListWarnRest", _0: [Allow(Target.Crate)] },
  STABILITY: AttributeStability.Stable,
  CREATE: (_) => AttributeKind.NoStd,
});

export const NoMainParser: NoArgsAttributeParser = NoArgsAttributeParser_provided({
  PATH: [sym.no_main],
  ON_DUPLICATE: OnDuplicate.Warn,
  ALLOWED_TARGETS: { $: "AllowListWarnRest", _0: [Allow(Target.Crate)] },
  STABILITY: AttributeStability.Stable,
  CREATE: (_) => AttributeKind.NoMain,
});

export const RustcCoherenceIsCoreParser: NoArgsAttributeParser = NoArgsAttributeParser_provided({
  PATH: [sym.rustc_coherence_is_core],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Crate)] },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => AttributeKind.RustcCoherenceIsCore,
});

export const WindowsSubsystemParser: SingleAttributeParser = SingleAttributeParser_provided({
  PATH: [sym.windows_subsystem],
  ON_DUPLICATE: OnDuplicate.WarnButFutureError,
  ALLOWED_TARGETS: { $: "AllowListWarnRest", _0: [Allow(Target.Crate)] },
  TEMPLATE: template({ NameValueStr: ["windows", "console"] }, "https://doc.rust-lang.org/reference/runtime.html#the-windows_subsystem-attribute"),
  STABILITY: AttributeStability.Stable,

  // rustc: compiler/rustc_attr_parsing/src/attributes/crate_level.rs:194 convert
  convert(cx: AcceptContext, args: ArgParser): AttributeKind | undefined {
    const nv = cx.expect_name_value(args, cx.inner_span, sym.windows_subsystem, ExpectNameValue.ArgParser);
    if (nv === undefined) return undefined;

    let kind: WindowsSubsystemKind;
    const v = nv.value_as_str();
    if (v === sym.console) {
      kind = "Console";
    } else if (v === sym.windows) {
      kind = "Windows";
    } else {
      cx.adcx().expected_specific_argument_strings(nv.value_span, [sym.console, sym.windows]);
      return undefined;
    }

    return { $: "WindowsSubsystem", _0: kind };
  },
});

export const PanicRuntimeParser: NoArgsAttributeParser = NoArgsAttributeParser_provided({
  PATH: [sym.panic_runtime],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Crate)] },
  STABILITY: unstable(sym.panic_runtime),
  CREATE: (_) => AttributeKind.PanicRuntime,
});

export const NeedsPanicRuntimeParser: NoArgsAttributeParser = NoArgsAttributeParser_provided({
  PATH: [sym.needs_panic_runtime],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Crate)] },
  STABILITY: unstable(sym.needs_panic_runtime),
  CREATE: (_) => AttributeKind.NeedsPanicRuntime,
});

export const ProfilerRuntimeParser: NoArgsAttributeParser = NoArgsAttributeParser_provided({
  PATH: [sym.profiler_runtime],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Crate)] },
  STABILITY: unstable(sym.profiler_runtime),
  CREATE: (_) => AttributeKind.ProfilerRuntime,
});

export const NoBuiltinsParser: NoArgsAttributeParser = NoArgsAttributeParser_provided({
  PATH: [sym.no_builtins],
  ON_DUPLICATE: OnDuplicate.Warn,
  ALLOWED_TARGETS: { $: "AllowListWarnRest", _0: [Allow(Target.Crate)] },
  STABILITY: AttributeStability.Stable,
  CREATE: (_) => AttributeKind.NoBuiltins,
});

export const RustcPreserveUbChecksParser: NoArgsAttributeParser = NoArgsAttributeParser_provided({
  PATH: [sym.rustc_preserve_ub_checks],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Crate)] },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => AttributeKind.RustcPreserveUbChecks,
});

export const RustcNoImplicitBoundsParser: NoArgsAttributeParser = NoArgsAttributeParser_provided({
  PATH: [sym.rustc_no_implicit_bounds],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Crate)] },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => AttributeKind.RustcNoImplicitBounds,
});

export const DefaultLibAllocatorParser: NoArgsAttributeParser = NoArgsAttributeParser_provided({
  PATH: [sym.default_lib_allocator],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Crate)] },
  STABILITY: unstable(sym.allocator_internals),
  CREATE: (_) => AttributeKind.DefaultLibAllocator,
});

export const FeatureParser: CombineAttributeParser<Ident> = CombineAttributeParser_provided<Ident>({
  PATH: [sym.feature],
  // `AttributeKind::Feature` (the tuple variant's constructor)
  CONVERT: (_0, _1) => ({ $: "Feature", _0, _1 }),
  ALLOWED_TARGETS: { $: "AllowListWarnRest", _0: [Allow(Target.Crate)] },
  TEMPLATE: template({ List: ["feature1, feature2, ..."] }),
  STABILITY: AttributeStability.Stable,

  // rustc: compiler/rustc_attr_parsing/src/attributes/crate_level.rs:289 extend
  extend(cx: AcceptContext, args: ArgParser): Ident[] {
    const list = cx.expect_list(args, cx.attr_span);
    if (list === undefined) {
      return [];
    }

    if (list.is_empty()) {
      const attr_span = cx.attr_span;
      cx.adcx().warn_empty_attribute(attr_span);
    }

    const res: Ident[] = [];

    for (const elem_ of list.mixed()) {
      const elem = MetaItemOrLitParser.meta_item(elem_);
      if (elem === undefined) {
        cx.adcx().expected_identifier(MetaItemOrLitParser.span(elem_));
        continue;
      }
      if (cx.expect_no_args(elem.args()) === undefined) {
        continue;
      }
      const path = elem.path();
      const ident = path.word();
      if (ident === undefined) {
        cx.adcx().expected_identifier(path.span());
        continue;
      }
      res.push(ident);
    }

    return res;
  },
});

// PORT: `FxIndexSet<Ident>`: `Ident`'s `Hash`/`Eq` use the name and the span's `SyntaxContext`, so the
// set is a `Map` keyed by both (insertion-ordered, like `IndexSet`; `replace` keeps the position).
type IdentIndexSet = Map<string, Ident>;
function ident_key(ident: Ident): string {
  return `${ident.name},${Span.ctxt(ident.span)}`;
}
// `IndexSet::replace`: inserts `value`, replacing an equal one (and returning it).
function index_set_replace(set: IdentIndexSet, value: Ident): Ident | undefined {
  const key = ident_key(value);
  const old = set.get(key);
  set.set(key, value);
  return old;
}

/** `#[derive(Default)] pub(crate) struct RegisterToolParser` */
export interface RegisterToolParser {
  attr_tools: IdentIndexSet;
  lint_tools: IdentIndexSet;
}

// rustc: compiler/rustc_attr_parsing/src/attributes/crate_level.rs:330 parse_register_tool
function parse_register_tool(tools: IdentIndexSet[], cx: AcceptContext, args: ArgParser): void {
  const list = cx.expect_list(args, cx.attr_span);
  if (list === undefined) {
    return;
  }

  if (list.is_empty()) {
    const attr_span = cx.attr_span;
    cx.adcx().warn_empty_attribute(attr_span);
  }

  for (const elem_ of list.mixed()) {
    const elem = MetaItemOrLitParser.meta_item(elem_);
    if (elem === undefined) {
      cx.adcx().expected_identifier(MetaItemOrLitParser.span(elem_));
      continue;
    }
    if (cx.expect_no_args(elem.args()) === undefined) {
      continue;
    }

    const path = elem.path();
    const ident = path.word();
    if (ident === undefined) {
      cx.adcx().expected_identifier(path.span());
      continue;
    }
    if (!Symbol.can_be_raw(ident.name)) {
      cx.adcx().expected_identifier(path.span());
      continue;
    }

    if (ident.name === sym.rustc) {
      ShouldEmit.emit_err(cx.shared.cx.should_emit, cx.shared.cx.dcx().create_err(ToolReserved_diagnostic({ span: ident.span, tool: ident })));
      continue;
    }

    let lint_emitted = false;
    for (const tools_ of tools) {
      const old_ident = index_set_replace(tools_, ident);
      if (old_ident !== undefined && !lint_emitted) {
        lint_emitted = true;
        cx.shared.emit_lint(
          DUPLICATE_TOOLS,
          DuplicateTool_diagnostic({ span: ident.span, tool: ident, old_ident_span: old_ident.span }),
          ident.span,
        );
      }
    }
  }
}

export const RegisterToolParser: AttributeParser<RegisterToolParser> = AttributeParser_provided<RegisterToolParser>({
  default(): RegisterToolParser {
    return { attr_tools: new Map(), lint_tools: new Map() };
  },

  ATTRIBUTES: [
    [
      [sym.register_tool],
      template({ List: ["tool1, tool2, ..."] }),
      unstable(sym.register_tool),
      (this_, cx, args) => {
        parse_register_tool([this_.attr_tools, this_.lint_tools], cx, args);
      },
    ],
    [
      [sym.register_attribute_tool],
      template({ List: ["tool1, tool2, ..."] }),
      unstable(sym.register_tool),
      (this_, cx, args) => parse_register_tool([this_.attr_tools], cx, args),
    ],
    [
      [sym.register_lint_tool],
      template({ List: ["tool1, tool2, ..."] }),
      unstable(sym.register_tool),
      (this_, cx, args) => parse_register_tool([this_.lint_tools], cx, args),
    ],
  ],

  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Crate)] } satisfies AllowedTargets,

  // rustc: compiler/rustc_attr_parsing/src/attributes/crate_level.rs:411 finalize
  finalize(self: RegisterToolParser, _cx: FinalizeContext): AttributeKind | undefined {
    if (self.attr_tools.size === 0 && self.lint_tools.size === 0) {
      return undefined;
    } else {
      return {
        $: "RegisterTool",
        attr_tools: [...self.attr_tools.values()],
        lint_tools: [...self.lint_tools.values()],
      };
    }
  },
});
