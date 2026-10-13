// Port of compiler/rustc_attr_parsing/src/attributes/codegen_attrs.rs
// (Conventions for `use super::prelude::*` / `unstable!`: see inline.ts.)
//
// PORT:
// - `#[derive(Default)]` parser states without inherent methods (`NakedParser`, `UsedParser`) are
//   interfaces; their trait tables build them in `default()`.
// - `&mut Option<_>` places chosen at run time (`UsedParser`'s `target`, `attrib_to_write`) are
//   `MutRef` views (`field_mut`).
// - `SanitizerSet` operators: `|` is `union`, `&` is `intersection`, `!` is `complement`; the first
//   item of `SanitizerSet::iter()` is `bitflags_iter_first` below.
import {
  type CoverageAttrKind,
  find_attr,
  LangItem,
  type OptimizeAttr,
  type RtsanSetting,
  target as target_mod,
  type UsedBy,
} from "../../rustc_attr_ir/lib.ts";
import { AttributeStability } from "../../rustc_feature/lib.ts";
import { feature_err } from "../../rustc_session/diagnostics.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { Symbol, sym } from "../../rustc_span/symbol.ts";
import { SanitizerSet } from "../../rustc_structures/sanitizer_set.ts";
import { display_AttrPath } from "../../rustc_attr_ir/lib.ts";
import { field_mut, type MutRef } from "../../std/mut_ref.ts";
import { unreachable, unwrap } from "../../std/panic.ts";
import { IterNames } from "../../vendor/bitflags/iter.ts";
import { Flags_is_empty } from "../../vendor/bitflags/traits.ts";
import { type AcceptContext, ExpectNameValue, ExpectStringLiteral } from "../context.ts";
import {
  EmptyExportName_diagnostic,
  EmptySection_diagnostic,
  NakedFunctionIncompatibleAttribute_diagnostic,
  NullOnExport_diagnostic,
  NullOnObjcClass_diagnostic,
  NullOnObjcSelector_diagnostic,
  NullOnSection_diagnostic,
  ObjcClassExpectedStringLiteral_diagnostic,
  ObjcSelectorExpectedStringLiteral_diagnostic,
  SanitizeInvalidStatic_diagnostic,
  TargetFeatureOnLangItem_diagnostic,
  TrackCallerOnLangItem_diagnostic,
} from "../diagnostics.ts";
import { type ArgParser, MetaItemOrLitParser } from "../parser.ts";
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

const { Target, MethodKind } = target_mod;

export const OptimizeParser: SingleAttributeParser = {
  ...SingleAttributeParser_provided,
  PATH: [sym.optimize],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      { $: "Allow", _0: Target.Fn },
      { $: "Allow", _0: Target.Closure },
      { $: "Allow", _0: { $: "Method", _0: { $: "Trait", body: true } } },
      { $: "Allow", _0: { $: "Method", _0: MethodKind.TraitImpl } },
      { $: "Allow", _0: { $: "Method", _0: MethodKind.Inherent } },
    ],
  },
  TEMPLATE: template({ List: ["size", "speed", "none"] }),
  STABILITY: AttributeStability.Stable,

  // rustc: compiler/rustc_attr_parsing/src/attributes/codegen_attrs.rs:33 convert
  convert(cx, args) {
    const single = cx.expect_single_element_list(args, cx.attr_span);
    if (single === undefined) return undefined;

    const i = MetaItemOrLitParser.meta_item_no_args(single);
    const w = i === undefined ? undefined : i.path().word();
    let res: OptimizeAttr;
    switch (w === undefined ? undefined : w.name) {
      case sym.size:
        res = "Size";
        break;
      case sym.speed:
        res = "Speed";
        break;
      case sym.none:
        res = "DoNotOptimize";
        break;
      default: {
        cx.adcx().expected_specific_argument(MetaItemOrLitParser.span(single), [sym.size, sym.speed, sym.none]);
        res = "Default";
      }
    }

    return { $: "Optimize", _0: res, _1: cx.attr_span };
  },
};

export const ColdParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.cold],
  ON_DUPLICATE: OnDuplicate.Warn,
  ALLOWED_TARGETS: {
    $: "AllowListWarnRest",
    _0: [
      { $: "Allow", _0: Target.Fn },
      { $: "Allow", _0: { $: "Method", _0: { $: "Trait", body: true } } },
      { $: "Allow", _0: { $: "Method", _0: MethodKind.TraitImpl } },
      { $: "Allow", _0: { $: "Method", _0: MethodKind.Inherent } },
      { $: "Allow", _0: Target.ForeignFn },
      { $: "Allow", _0: Target.Closure },
    ],
  },
  STABILITY: AttributeStability.Stable,
  CREATE: (_) => ({ $: "Cold" }),
};

export const CoverageParser: SingleAttributeParser = {
  ...SingleAttributeParser_provided,
  PATH: [sym.coverage],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      { $: "Allow", _0: Target.Fn },
      { $: "Allow", _0: Target.Closure },
      { $: "Allow", _0: { $: "Method", _0: { $: "Trait", body: true } } },
      { $: "Allow", _0: { $: "Method", _0: MethodKind.TraitImpl } },
      { $: "Allow", _0: { $: "Method", _0: MethodKind.Inherent } },
      { $: "Allow", _0: { $: "Impl", of_trait: true } },
      { $: "Allow", _0: { $: "Impl", of_trait: false } },
      { $: "Allow", _0: Target.Mod },
      { $: "Allow", _0: Target.Crate },
    ],
  },
  TEMPLATE: template({ OneOf: [sym.off, sym.on] }),
  STABILITY: { $: "Unstable", gate_name: sym.coverage_attribute, notes: [] },

  // rustc: compiler/rustc_attr_parsing/src/attributes/codegen_attrs.rs:86 convert
  convert(cx, args) {
    const arg_ = cx.expect_single_element_list(args, cx.attr_span);
    if (arg_ === undefined) return undefined;

    const fail_incorrect_argument = (span: Span) => cx.adcx().expected_specific_argument(span, [sym.on, sym.off]);

    const arg = MetaItemOrLitParser.meta_item_no_args(arg_);
    if (arg === undefined) {
      fail_incorrect_argument(MetaItemOrLitParser.span(arg_));
      return undefined;
    }

    let kind: CoverageAttrKind;
    switch (arg.path().word_sym()) {
      case sym.off:
        kind = "Off";
        break;
      case sym.on:
        kind = "On";
        break;
      default: {
        fail_incorrect_argument(arg.span());
        return undefined;
      }
    }

    return { $: "Coverage", _0: kind };
  },
};

export const ExportNameParser: SingleAttributeParser = {
  ...SingleAttributeParser_provided,
  PATH: [sym.export_name],
  ON_DUPLICATE: OnDuplicate.WarnButFutureError,
  SAFETY: {
    $: "Unsafe",
    note: "the linker's behavior with multiple libraries exporting duplicate symbol names is undefined and Rust cannot provide guarantees when you manually override them",
    unsafe_since: "Edition2024",
  },
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      { $: "Allow", _0: Target.Static },
      { $: "Allow", _0: Target.Fn },
      { $: "Allow", _0: { $: "Method", _0: MethodKind.Inherent } },
      { $: "Allow", _0: { $: "Method", _0: { $: "Trait", body: true } } },
      { $: "Allow", _0: { $: "Method", _0: MethodKind.TraitImpl } },
      { $: "Warn", _0: Target.Field },
      { $: "Warn", _0: Target.Arm },
      { $: "Warn", _0: Target.MacroDef },
      { $: "Warn", _0: Target.MacroCall },
    ],
  },
  TEMPLATE: template({ NameValueStr: ["name"] }),
  STABILITY: AttributeStability.Stable,

  // rustc: compiler/rustc_attr_parsing/src/attributes/codegen_attrs.rs:133 convert
  convert(cx, args) {
    const nv = cx.expect_name_value(args, cx.attr_span, undefined, ExpectNameValue.ArgParser);
    if (nv === undefined) return undefined;
    const name = cx.expect_string_literal(nv, ExpectStringLiteral.NameValueParser);
    if (name === undefined) return undefined;
    if (Symbol.as_str(name).includes("\0")) {
      // `#[export_name = ...]` will be converted to a null-terminated string,
      // so it may not contain any null characters.
      cx.shared.emit_err(NullOnExport_diagnostic({ span: cx.attr_span }));
      return undefined;
    }
    if (Symbol.is_empty(name)) {
      // LLVM will make up a name if the empty string is given, but that name will be
      // inconsistent between compilation units, causing linker errors.
      cx.shared.emit_err(EmptyExportName_diagnostic({ span: cx.attr_span }));
      return undefined;
    }
    return { $: "ExportName", name, span: cx.attr_span };
  },
};

export const RustcObjcClassParser: SingleAttributeParser = {
  ...SingleAttributeParser_provided,
  PATH: [sym.rustc_objc_class],
  ALLOWED_TARGETS: { $: "AllowList", _0: [{ $: "Allow", _0: Target.ForeignStatic }] },
  TEMPLATE: template({ NameValueStr: ["ClassName"] }),
  STABILITY: { $: "Unstable", gate_name: sym.rustc_attrs, notes: [] },

  // rustc: compiler/rustc_attr_parsing/src/attributes/codegen_attrs.rs:161 convert
  convert(cx, args) {
    const nv = cx.expect_name_value(args, cx.attr_span, undefined, ExpectNameValue.ArgParser);
    if (nv === undefined) return undefined;
    const classname = nv.value_as_str();
    if (classname === undefined) {
      // `#[rustc_objc_class = ...]` is expected to be used as an implementation detail
      // inside a standard library macro, but `cx.expected_string_literal` exposes too much.
      // Use a custom error message instead.
      cx.shared.emit_err(ObjcClassExpectedStringLiteral_diagnostic({ span: nv.value_span }));
      return undefined;
    }
    if (Symbol.as_str(classname).includes("\0")) {
      // `#[rustc_objc_class = ...]` will be converted to a null-terminated string,
      // so it may not contain any null characters.
      cx.shared.emit_err(NullOnObjcClass_diagnostic({ span: nv.value_span }));
      return undefined;
    }
    return { $: "RustcObjcClass", classname };
  },
};

export const RustcObjcSelectorParser: SingleAttributeParser = {
  ...SingleAttributeParser_provided,
  PATH: [sym.rustc_objc_selector],
  ALLOWED_TARGETS: { $: "AllowList", _0: [{ $: "Allow", _0: Target.ForeignStatic }] },
  TEMPLATE: template({ NameValueStr: ["methodName"] }),
  STABILITY: { $: "Unstable", gate_name: sym.rustc_attrs, notes: [] },

  // rustc: compiler/rustc_attr_parsing/src/attributes/codegen_attrs.rs:189 convert
  convert(cx, args) {
    const nv = cx.expect_name_value(args, cx.attr_span, undefined, ExpectNameValue.ArgParser);
    if (nv === undefined) return undefined;
    const methname = nv.value_as_str();
    if (methname === undefined) {
      // `#[rustc_objc_selector = ...]` is expected to be used as an implementation detail
      // inside a standard library macro, but `cx.expected_string_literal` exposes too much.
      // Use a custom error message instead.
      cx.shared.emit_err(ObjcSelectorExpectedStringLiteral_diagnostic({ span: nv.value_span }));
      return undefined;
    }
    if (Symbol.as_str(methname).includes("\0")) {
      // `#[rustc_objc_selector = ...]` will be converted to a null-terminated string,
      // so it may not contain any null characters.
      cx.shared.emit_err(NullOnObjcSelector_diagnostic({ span: nv.value_span }));
      return undefined;
    }
    return { $: "RustcObjcSelector", methname };
  },
};

// #[derive(Default)]
interface NakedParserState {
  span: Span | undefined;
}

export const NakedParser: AttributeParser<NakedParserState> = {
  ...AttributeParser_provided,
  default: () => ({ span: undefined }),
  ATTRIBUTES: [
    [
      [sym.naked],
      template({ Word: true }),
      AttributeStability.Stable,
      (this_, cx, args) => {
        if (cx.expect_no_args(args) === undefined) {
          return;
        }

        if (this_.span !== undefined) {
          const earlier = this_.span;
          const span = cx.attr_span;
          cx.shared.warn_unused_duplicate(earlier, span);
        } else {
          this_.span = cx.attr_span;
        }
      },
    ],
  ],
  SAFETY: {
    $: "Unsafe",
    note: "the `#[naked]` attribute adds the safety obligation that the function's body must respect the function’s calling convention, uphold its signature, and either return or diverge (i.e., not fall through past the end of the assembly code).",
    unsafe_since: undefined,
  },
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      { $: "Allow", _0: Target.Fn },
      { $: "Allow", _0: { $: "Method", _0: MethodKind.Inherent } },
      { $: "Allow", _0: { $: "Method", _0: { $: "Trait", body: true } } },
      { $: "Allow", _0: { $: "Method", _0: MethodKind.TraitImpl } },
      { $: "Warn", _0: Target.MacroCall },
    ],
  },

  // rustc: compiler/rustc_attr_parsing/src/attributes/codegen_attrs.rs:239 finalize
  finalize(self, cx) {
    // FIXME(jdonszelmann): upgrade this list to *parsed* attributes
    // once all of these have parsed forms. That'd make the check much nicer...
    //
    // many attributes don't make sense in combination with #[naked].
    // Notable attributes that are incompatible with `#[naked]` are:
    //
    // * `#[inline]`
    // * `#[track_caller]`
    // * `#[test]`, `#[ignore]`, `#[should_panic]`
    //
    // NOTE: when making changes to this list, check that `error_codes/E0736.md` remains
    // accurate.
    const ALLOW_LIST: readonly Symbol[] = [
      // testing (allowed here so better errors can be generated in `rustc_builtin_macros::test`)
      sym.test,
      sym.ignore,
      sym.should_panic,
      sym.bench,
      // diagnostics
      sym.allow,
      sym.warn,
      sym.deny,
      sym.forbid,
      sym.deprecated,
      sym.must_use,
      // abi, linking and FFI
      sym.cold,
      sym.export_name,
      sym.link_section,
      sym.linkage,
      sym.no_mangle,
      sym.instruction_set,
      sym.repr,
      sym.rustc_std_internal_symbol,
      // FIXME(#82232, #143834): temporarily renamed to mitigate `#[align]` nameres ambiguity
      sym.rustc_align,
      sym.rustc_align_static,
      // obviously compatible with self
      sym.naked,
      // documentation
      sym.doc,
    ];

    if (self.span === undefined) return undefined;
    const span = self.span;

    const tools = cx.shared.cx.attr_tools;
    if (tools === undefined) {
      unreachable("internal error: entered unreachable code: tools required while parsing attributes");
    }

    // only if we found a naked attribute do we do the somewhat expensive check
    outer: for (const other_attr of cx.all_attrs) {
      for (const allowed_attr of ALLOW_LIST) {
        const first = other_attr.segments().next();
        if (!first.done && [...tools].some((tool) => tool.name === first.value.name)) {
          // effectively skips the error message  being emitted below
          // if it's a tool attribute
          continue outer;
        }
        if (other_attr.word_is(allowed_attr)) {
          // effectively skips the error message  being emitted below
          // if its an allowed attribute
          continue outer;
        }

        if (other_attr.word_is(sym.target_feature)) {
          if (!cx.shared.cx.features().naked_functions_target_feature()) {
            feature_err(
              cx.shared.cx.sess(),
              sym.naked_functions_target_feature,
              other_attr.span(),
              "`#[target_feature(/* ... */)]` is currently unstable on `#[naked]` functions",
            ).emit();
          }

          continue outer;
        }
      }

      cx.shared.emit_err(
        NakedFunctionIncompatibleAttribute_diagnostic({
          span: other_attr.span(),
          naked_span: span,
          attr: display_AttrPath(other_attr.get_attribute_path()),
        }),
      );
    }

    return { $: "Naked", _0: span };
  },
};

export const TrackCallerParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.track_caller],
  ON_DUPLICATE: OnDuplicate.Warn,
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      { $: "Allow", _0: Target.Fn },
      { $: "Allow", _0: { $: "Method", _0: MethodKind.Inherent } },
      { $: "Allow", _0: { $: "Method", _0: { $: "Trait", body: true } } },
      { $: "Allow", _0: { $: "Method", _0: MethodKind.TraitImpl } },
      { $: "Allow", _0: { $: "Method", _0: { $: "Trait", body: false } } }, // `#[track_caller]` is inherited from trait methods
      { $: "Allow", _0: Target.ForeignFn },
      { $: "Allow", _0: Target.Closure },
      { $: "Warn", _0: Target.MacroDef },
      { $: "Warn", _0: Target.Arm },
      { $: "Warn", _0: Target.Field },
      { $: "Warn", _0: Target.MacroCall },
    ],
  },
  STABILITY: AttributeStability.Stable,
  CREATE: (span) => ({ $: "TrackCaller", _0: span }),

  // rustc: compiler/rustc_attr_parsing/src/attributes/codegen_attrs.rs:352 finalize_check
  finalize_check(cx, attr_span) {
    const target = cx.shared.target;
    if (target.$ === "Fn") {
      // `#[track_caller]` is not valid on weak lang items because they are called via
      // `extern` declarations and `#[track_caller]` would alter their ABI.
      const item = find_attr(cx.parsed_attrs, (k) => (k.$ === "Lang" ? k._0 : undefined));
      if (item !== undefined && LangItem.is_weak(item)) {
        cx.shared.emit_err(
          TrackCallerOnLangItem_diagnostic({
            attr_span,
            name: LangItem.name(item),
            sig_span: cx.shared.target_span,
          }),
        );
      }
    } else if (target.$ === "Closure" && !cx.shared.cx.features().closure_track_caller()) {
      feature_err(cx.shared.cx.sess(), sym.closure_track_caller, attr_span, "`#[track_caller]` on closures is currently unstable").emit();
    } else {
      // _ => {}
    }
  },
};

export const NoMangleParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.no_mangle],
  ON_DUPLICATE: OnDuplicate.Warn,
  SAFETY: {
    $: "Unsafe",
    note: "the linker's behavior with multiple libraries exporting duplicate symbol names is undefined and Rust cannot provide guarantees when you manually override them",
    unsafe_since: "Edition2024",
  },
  ALLOWED_TARGETS: {
    $: "AllowListWarnRest",
    _0: [
      { $: "Allow", _0: Target.Fn },
      { $: "Allow", _0: Target.Static },
      { $: "Allow", _0: { $: "Method", _0: MethodKind.Inherent } },
      { $: "Allow", _0: { $: "Method", _0: MethodKind.TraitImpl } },
      { $: "AllowSilent", _0: Target.Const }, // Handled in the `InvalidNoMangleItems` pass
      { $: "Error", _0: Target.Closure },
    ],
  },
  STABILITY: AttributeStability.Stable,
  CREATE: (span) => ({ $: "NoMangle", _0: span }),
};

// #[derive(Default)]
interface UsedParserState {
  first_compiler: Span | undefined;
  first_linker: Span | undefined;
  first_default: Span | undefined;
}

// A custom `AttributeParser` is used rather than a Simple attribute parser because
// - Specifying two `#[used]` attributes is a warning (but will be an error in the future)
// - But specifying two conflicting attributes: `#[used(compiler)]` and `#[used(linker)]` is already an error today
// We can change this to a Simple parser once the warning becomes an error
export const UsedParser: AttributeParser<UsedParserState> = {
  ...AttributeParser_provided,
  default: () => ({ first_compiler: undefined, first_linker: undefined, first_default: undefined }),
  ATTRIBUTES: [
    [
      [sym.used],
      template({ Word: true, List: ["compiler", "linker"] }),
      AttributeStability.Stable,
      (group, cx, args) => {
        let used_by: UsedBy;
        switch (args.$) {
          case "NoArgs":
            used_by = "Default";
            break;
          case "List": {
            const list = args._0;
            const l = cx.expect_single(list);
            if (l === undefined) {
              return;
            }

            const i = MetaItemOrLitParser.meta_item_no_args(l);
            switch (i === undefined ? undefined : i.path().word_sym()) {
              case sym.compiler: {
                if (!cx.shared.cx.features().used_with_arg()) {
                  feature_err(cx.shared.cx.sess(), sym.used_with_arg, cx.attr_span, "`#[used(compiler)]` is currently unstable").emit();
                }
                used_by = "Compiler";
                break;
              }
              case sym.linker: {
                if (!cx.shared.cx.features().used_with_arg()) {
                  feature_err(cx.shared.cx.sess(), sym.used_with_arg, cx.attr_span, "`#[used(linker)]` is currently unstable").emit();
                }
                used_by = "Linker";
                break;
              }
              default: {
                cx.adcx().expected_specific_argument(MetaItemOrLitParser.span(l), [sym.compiler, sym.linker]);
                return;
              }
            }
            break;
          }
          case "NameValue":
            return;
        }

        const attr_span = cx.attr_span;

        // `#[used]` is interpreted as `#[used(linker)]` (though depending on target OS the
        // circumstances are more complicated). While we're checking `used_by`, also report
        // these cross-`UsedBy` duplicates to warn.
        let target: MutRef<Span | undefined>;
        switch (used_by) {
          case "Compiler":
            target = field_mut(group, "first_compiler");
            break;
          case "Linker": {
            if (group.first_default !== undefined) {
              const prev = group.first_default;
              cx.shared.warn_unused_duplicate(prev, attr_span);
              return;
            }
            target = field_mut(group, "first_linker");
            break;
          }
          case "Default": {
            if (group.first_linker !== undefined) {
              const prev = group.first_linker;
              cx.shared.warn_unused_duplicate(prev, attr_span);
              return;
            }
            target = field_mut(group, "first_default");
            break;
          }
        }

        if (target.value !== undefined) {
          const prev = target.value;
          cx.shared.warn_unused_duplicate(prev, attr_span);
        } else {
          target.value = attr_span;
        }
      },
    ],
  ],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      { $: "Allow", _0: Target.Static },
      { $: "Warn", _0: Target.MacroCall },
    ],
  },

  // rustc: compiler/rustc_attr_parsing/src/attributes/codegen_attrs.rs:495 finalize
  finalize(self, _cx) {
    // If a specific form of `used` is specified, it takes precedence over generic `#[used]`.
    // If both `linker` and `compiler` are specified, use `linker`.
    if (self.first_linker !== undefined) {
      return { $: "Used", used_by: "Linker" };
    } else if (self.first_compiler !== undefined) {
      return { $: "Used", used_by: "Compiler" };
    } else if (self.first_default !== undefined) {
      return { $: "Used", used_by: "Default" };
    } else {
      return undefined;
    }
  },
};

// rustc: compiler/rustc_attr_parsing/src/attributes/codegen_attrs.rs:507 parse_tf_attribute
function parse_tf_attribute(cx: AcceptContext, args: ArgParser): Iterable<[Symbol, Span]> {
  const features: [Symbol, Span][] = [];
  const list = cx.expect_list(args, cx.attr_span);
  if (list === undefined) {
    return features;
  }
  if (list.is_empty()) {
    const attr_span = cx.attr_span;
    cx.adcx().warn_empty_attribute(attr_span);
    return features;
  }
  for (const item of list.mixed()) {
    const nv = cx.expect_name_value(item, MetaItemOrLitParser.span(item), sym.enable, ExpectNameValue.MetaItemOrLitParser);
    if (nv === undefined) {
      return features;
    }
    const [ident, value] = nv;

    // Validate name
    if (ident.name !== sym.enable) {
      cx.adcx().expected_specific_argument(ident.span, [sym.enable]);
      return features;
    }

    // Use value
    const value_str = cx.expect_string_literal(value, ExpectStringLiteral.NameValueParser);
    if (value_str === undefined) {
      return features;
    }
    for (const feature of Symbol.as_str(value_str).split(",")) {
      features.push([Symbol.intern(feature), MetaItemOrLitParser.span(item)]);
    }
  }
  return features;
}

export const TargetFeatureParser: CombineAttributeParser<[Symbol, Span]> = {
  ...CombineAttributeParser_provided,
  PATH: [sym.target_feature],
  CONVERT: (items, span) => ({
    $: "TargetFeature",
    features: items,
    attr_span: span,
    was_forced: false,
  }),
  TEMPLATE: template({ List: ['enable = "feat1, feat2"'] }),
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      { $: "Allow", _0: Target.Fn },
      { $: "Allow", _0: { $: "Method", _0: MethodKind.Inherent } },
      { $: "Allow", _0: { $: "Method", _0: { $: "Trait", body: true } } },
      { $: "Allow", _0: { $: "Method", _0: MethodKind.TraitImpl } },
      { $: "Warn", _0: Target.Statement },
      { $: "Warn", _0: Target.Field },
      { $: "Warn", _0: Target.Arm },
      { $: "Warn", _0: Target.MacroDef },
      { $: "Warn", _0: Target.MacroCall },
    ],
  },
  STABILITY: AttributeStability.Stable,

  // rustc: compiler/rustc_attr_parsing/src/attributes/codegen_attrs.rs:567 extend
  extend(cx, args) {
    return parse_tf_attribute(cx, args);
  },

  // rustc: compiler/rustc_attr_parsing/src/attributes/codegen_attrs.rs:574 finalize_check
  finalize_check(cx, attr_span) {
    // `#[target_feature]` is incompatible with lang item functions,
    // except on WASM where calling target-feature functions is safe (see #84988).
    if (!cx.shared.cx.sess().target.is_like_wasm && !cx.shared.cx.sess().opts.actually_rustdoc) {
      // `#[panic_handler]` is checked first so it takes priority in the diagnostic.
      let lang_kind: Symbol | undefined = undefined;
      for (const a of cx.all_attrs) {
        const s = [sym.panic_handler, sym.lang].find((s) => a.word_is(s));
        if (s !== undefined) {
          lang_kind = s;
          break;
        }
      }
      if (lang_kind !== undefined) {
        const kind = lang_kind;
        cx.shared.emit_err(TargetFeatureOnLangItem_diagnostic({ attr_span, kind, item_span: cx.shared.target_span }));
      }
    }
  },
};

export const ForceTargetFeatureParser: CombineAttributeParser<[Symbol, Span]> = {
  ...CombineAttributeParser_provided,
  PATH: [sym.force_target_feature],
  SAFETY: {
    $: "Unsafe",
    note: "a function with the signature of the function the attribute is applied to must only be callable if the force-enabled features are guaranteed to be present",
    unsafe_since: undefined,
  },
  CONVERT: (items, span) => ({
    $: "TargetFeature",
    features: items,
    attr_span: span,
    was_forced: true,
  }),
  TEMPLATE: template({ List: ['enable = "feat1, feat2"'] }),
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      { $: "Allow", _0: Target.Fn },
      { $: "Allow", _0: { $: "Method", _0: MethodKind.Inherent } },
      { $: "Allow", _0: { $: "Method", _0: { $: "Trait", body: true } } },
      { $: "Allow", _0: { $: "Method", _0: MethodKind.TraitImpl } },
    ],
  },
  STABILITY: { $: "Unstable", gate_name: sym.effective_target_features, notes: [] },

  // rustc: compiler/rustc_attr_parsing/src/attributes/codegen_attrs.rs:613 extend
  extend(cx, args) {
    return parse_tf_attribute(cx, args);
  },
};

export const InstrumentFnParser: SingleAttributeParser = {
  ...SingleAttributeParser_provided,
  PATH: [sym.instrument_fn],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      { $: "Allow", _0: Target.Fn },
      { $: "Allow", _0: { $: "Method", _0: MethodKind.Inherent } },
      { $: "Allow", _0: { $: "Method", _0: { $: "Trait", body: true } } },
      { $: "Allow", _0: { $: "Method", _0: MethodKind.TraitImpl } },
    ],
  },
  TEMPLATE: template({ NameValueStr: ["on|off"] }),
  STABILITY: { $: "Unstable", gate_name: sym.instrument_fn, notes: [] },

  // rustc: compiler/rustc_attr_parsing/src/attributes/codegen_attrs.rs:634 convert
  convert(cx, args) {
    switch (args.$) {
      case "NameValue": {
        const nv = args._0;
        switch (nv.value_as_str()) {
          case sym.on:
            return { $: "InstrumentFn", _0: "On" };
          case sym.off:
            return { $: "InstrumentFn", _0: "Off" };
          default: {
            cx.adcx().expected_specific_argument_strings(nv.value_span, [sym.on, sym.off]);
            return undefined;
          }
        }
      }
      case "List": {
        const l = args._0;
        cx.adcx().expected_single_argument(l.span, l.len());
        return undefined;
      }
      case "NoArgs": {
        const span = cx.attr_span;
        cx.adcx().expected_specific_argument_strings(span, [sym.on, sym.off]);
        return undefined;
      }
    }
  },
};

/**
 * PORT: `set.iter().next()` (bitflags `Iter`: the contained named flags in declaration order, then
 * the remaining unnamed bits once); `bitflags/iter.rs` `Iter` is not ported, `IterNames` is.
 */
function bitflags_iter_first(set: SanitizerSet): SanitizerSet | undefined {
  const it = IterNames.new(SanitizerSet.FLAGS_DESC, set);
  const named = it.next();
  if (named !== undefined) return named[1];
  const remaining = it.remaining();
  return Flags_is_empty(SanitizerSet.FLAGS_DESC, remaining) ? undefined : remaining;
}

export const SanitizeParser: SingleAttributeParser = {
  ...SingleAttributeParser_provided,
  PATH: [sym.sanitize],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      { $: "Allow", _0: Target.Fn },
      { $: "Allow", _0: Target.Closure },
      { $: "Allow", _0: { $: "Method", _0: MethodKind.Inherent } },
      { $: "Allow", _0: { $: "Method", _0: { $: "Trait", body: true } } },
      { $: "Allow", _0: { $: "Method", _0: MethodKind.TraitImpl } },
      { $: "Allow", _0: { $: "Impl", of_trait: false } },
      { $: "Allow", _0: { $: "Impl", of_trait: true } },
      { $: "Allow", _0: Target.Mod },
      { $: "Allow", _0: Target.Crate },
      { $: "Allow", _0: Target.Static },
    ],
  },
  TEMPLATE: template({
    List: [
      'address = "on|off"',
      'kernel_address = "on|off"',
      'cfi = "on|off"',
      'hwaddress = "on|off"',
      'kernel_hwaddress = "on|off"',
      'kcfi = "on|off"',
      'memory = "on|off"',
      'memtag = "on|off"',
      'safestack = "on|off"',
      'shadow_call_stack = "on|off"',
      'thread = "on|off"',
      'realtime = "nonblocking|blocking|caller"',
    ],
  }),
  STABILITY: { $: "Unstable", gate_name: sym.sanitize, notes: [] },

  // rustc: compiler/rustc_attr_parsing/src/attributes/codegen_attrs.rs:690 convert
  convert(cx, args) {
    const list = cx.expect_list(args, cx.attr_span);
    if (list === undefined) return undefined;

    let on_set = SanitizerSet.empty();
    let off_set = SanitizerSet.empty();
    let rtsan: RtsanSetting | undefined = undefined;

    for (const item of list.mixed()) {
      const nv = cx.expect_name_value(item, MetaItemOrLitParser.span(item), undefined, ExpectNameValue.MetaItemOrLitParser);
      if (nv === undefined) {
        continue;
      }
      const [ident, value] = nv;

      const apply = (s: SanitizerSet): void => {
        let is_on: boolean;
        switch (value.value_as_str()) {
          case sym.on:
            is_on = true;
            break;
          case sym.off:
            is_on = false;
            break;
          default: {
            cx.adcx().expected_specific_argument_strings(value.value_span, [sym.on, sym.off]);
            return;
          }
        }

        if (is_on) {
          on_set = SanitizerSet.union(on_set, s);
        } else {
          off_set = SanitizerSet.union(off_set, s);
        }
      };

      switch (ident.name) {
        case sym.address:
        case sym.kernel_address: {
          apply(SanitizerSet.union(SanitizerSet.ADDRESS, SanitizerSet.KERNELADDRESS));
          break;
        }
        case sym.cfi:
          apply(SanitizerSet.CFI);
          break;
        case sym.kcfi:
          apply(SanitizerSet.KCFI);
          break;
        case sym.memory:
          apply(SanitizerSet.MEMORY);
          break;
        case sym.memtag:
          apply(SanitizerSet.MEMTAG);
          break;
        case sym.safestack:
          apply(SanitizerSet.SAFESTACK);
          break;
        case sym.shadow_call_stack:
          apply(SanitizerSet.SHADOWCALLSTACK);
          break;
        case sym.thread:
          apply(SanitizerSet.THREAD);
          break;
        case sym.hwaddress:
        case sym.kernel_hwaddress: {
          apply(SanitizerSet.union(SanitizerSet.HWADDRESS, SanitizerSet.KERNELHWADDRESS));
          break;
        }
        case sym.realtime: {
          switch (value.value_as_str()) {
            case sym.nonblocking:
              rtsan = "Nonblocking";
              break;
            case sym.blocking:
              rtsan = "Blocking";
              break;
            case sym.caller:
              rtsan = "Caller";
              break;
            default: {
              cx.adcx().expected_specific_argument_strings(value.value_span, [sym.nonblocking, sym.blocking, sym.caller]);
            }
          }
          break;
        }
        default: {
          cx.adcx().expected_specific_argument_strings(ident.span, [
            sym.address,
            sym.kernel_address,
            sym.cfi,
            sym.kcfi,
            sym.memory,
            sym.memtag,
            sym.safestack,
            sym.shadow_call_stack,
            sym.thread,
            sym.hwaddress,
            sym.kernel_hwaddress,
            sym.realtime,
          ]);
        }
      }
    }

    // The sanitizer attribute is only allowed on statics, if only address bits are set
    const all_set_except_address = SanitizerSet.intersection(
      SanitizerSet.union(on_set, off_set),
      SanitizerSet.complement(SanitizerSet.union(SanitizerSet.ADDRESS, SanitizerSet.KERNELADDRESS)),
    );
    let set: SanitizerSet | undefined;
    if (cx.shared.target.$ === "Static" && (set = bitflags_iter_first(all_set_except_address)) !== undefined) {
      cx.shared.emit_err(
        SanitizeInvalidStatic_diagnostic({
          span: cx.attr_span,
          // `.expect(..)`
          field: unwrap(
            SanitizerSet.as_str(set),
            "Since this `SanitizerSet` is returned from an iterator, exactly one field is set",
          ),
        }),
      );
    }

    return { $: "Sanitize", on_set, off_set, rtsan, span: cx.attr_span };
  },
};

export const ThreadLocalParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.thread_local],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      { $: "Allow", _0: Target.Static },
      { $: "Allow", _0: Target.ForeignStatic },
    ],
  },
  STABILITY: { $: "Unstable", gate_name: sym.thread_local, notes: [] },
  CREATE: (_) => ({ $: "ThreadLocal" }),
};

export const RustcPassIndirectlyInNonRusticAbisParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_pass_indirectly_in_non_rustic_abis],
  ALLOWED_TARGETS: { $: "AllowList", _0: [{ $: "Allow", _0: Target.Struct }] },
  STABILITY: { $: "Unstable", gate_name: sym.rustc_attrs, notes: [] },
  CREATE: (span) => ({ $: "RustcPassIndirectlyInNonRusticAbis", _0: span }),
};

export const RustcEiiForeignItemParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_eii_foreign_item],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      { $: "Allow", _0: Target.ForeignFn },
      { $: "Allow", _0: Target.ForeignStatic },
    ],
  },
  STABILITY: { $: "Unstable", gate_name: sym.eii_internals, notes: [] },
  CREATE: (_) => ({ $: "RustcEiiForeignItem" }),
};

export const PatchableFunctionEntryParser: SingleAttributeParser = {
  ...SingleAttributeParser_provided,
  PATH: [sym.patchable_function_entry],
  ALLOWED_TARGETS: { $: "AllowList", _0: [{ $: "Allow", _0: Target.Fn }] },
  TEMPLATE: template({ List: ['prefix_nops = m, entry_nops = n, section = "section"'] }),
  STABILITY: { $: "Unstable", gate_name: sym.patchable_function_entry, notes: [] },

  // rustc: compiler/rustc_attr_parsing/src/attributes/codegen_attrs.rs:823 convert
  convert(cx, args) {
    const meta_item_list = cx.expect_list(args, cx.attr_span);
    if (meta_item_list === undefined) return undefined;

    const prefix: MutRef<number | undefined> = { value: undefined };
    const entry: MutRef<number | undefined> = { value: undefined };
    let section: Symbol | undefined = undefined;

    if (meta_item_list.len() === 0) {
      cx.adcx().expected_at_least_one_argument(meta_item_list.span);
      return undefined;
    }

    for (const item of meta_item_list.mixed()) {
      const nv = cx.expect_name_value(item, MetaItemOrLitParser.span(item), undefined, ExpectNameValue.MetaItemOrLitParser);
      if (nv === undefined) return undefined;
      const [ident, value] = nv;

      let attrib_to_write: MutRef<number | undefined>;
      switch (ident.name) {
        case sym.prefix_nops: {
          // Duplicate prefixes are not allowed
          if (prefix.value !== undefined) {
            cx.adcx().duplicate_key(ident.span, sym.prefix_nops);
            return undefined;
          }
          attrib_to_write = prefix;
          break;
        }
        case sym.entry_nops: {
          // Duplicate entries are not allowed
          if (entry.value !== undefined) {
            cx.adcx().duplicate_key(ident.span, sym.entry_nops);
            return undefined;
          }
          attrib_to_write = entry;
          break;
        }
        case sym.section: {
          // Duplicate entries are not allowed
          if (section !== undefined) {
            cx.adcx().duplicate_key(ident.span, sym.section);
            return undefined;
          }
          // Only a string type value is allowed.
          const value_str = value.value_as_str();
          if (value_str === undefined) {
            cx.adcx().ctx.expect_string_literal(value, ExpectStringLiteral.NameValueParser);
            return undefined;
          }
          // The section name does not allow null characters.
          if (Symbol.as_str(value_str).includes("\0")) {
            cx.shared.emit_err(NullOnSection_diagnostic({ span: value.value_span }));
          }
          // The section name is not allowed to be empty, LLVM does
          // not allow them.
          if (Symbol.is_empty(value_str)) {
            cx.shared.emit_err(EmptySection_diagnostic({ span: value.value_span }));
          }
          section = value_str;
          // Integer parsing is not needed, process next item.
          continue;
        }
        default: {
          cx.adcx().expected_specific_argument(ident.span, [sym.prefix_nops, sym.entry_nops]);
          return undefined;
        }
      }

      const lit_kind = value.value_as_lit().kind;
      if (lit_kind.$ !== "Int") {
        cx.adcx().expected_integer_literal(value.value_span);
        return undefined;
      }
      const val = lit_kind._0;

      // `val.get().try_into()` (u128 -> u8)
      if (!(val <= 255n)) {
        cx.adcx().expected_integer_literal_in_range(value.value_span, 0, 255);
        return undefined;
      }

      attrib_to_write.value = Number(val);
    }

    return { $: "PatchableFunctionEntry", prefix: prefix.value, entry: entry.value, section };
  },
};
