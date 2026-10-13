// Port of compiler/rustc_attr_parsing/src/attributes/rustc_allocator.rs
import { ExpectNameValue, ExpectStringLiteral } from "../context.ts";
import { NoArgsAttributeParser_provided, SingleAttributeParser_provided } from "./mod.ts";
import { Allow, AttributeKind, type NoArgsAttributeParser, type SingleAttributeParser, sym, Target, template, unstable } from "./prelude.ts";

export const RustcAllocatorParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_allocator],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Fn), Allow(Target.ForeignFn)] },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => AttributeKind.RustcAllocator,
};

export const RustcAllocatorZeroedParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_allocator_zeroed],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Fn), Allow(Target.ForeignFn)] },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => AttributeKind.RustcAllocatorZeroed,
};

export const RustcAllocatorZeroedVariantParser: SingleAttributeParser = {
  ...SingleAttributeParser_provided,
  PATH: [sym.rustc_allocator_zeroed_variant],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Fn), Allow(Target.ForeignFn)] },
  TEMPLATE: template({ NameValueStr: ["function"] }),
  STABILITY: unstable(sym.rustc_attrs),
  // rustc: compiler/rustc_attr_parsing/src/attributes/rustc_allocator.rs:33 convert
  convert(cx, args) {
    const nv = cx.expect_name_value(args, cx.attr_span, undefined, ExpectNameValue.ArgParser);
    if (nv === undefined) return undefined;
    const name = cx.expect_string_literal(nv, ExpectStringLiteral.NameValueParser);
    if (name === undefined) return undefined;

    return { $: "RustcAllocatorZeroedVariant", name };
  },
};

export const RustcDeallocatorParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_deallocator],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Fn), Allow(Target.ForeignFn)] },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => AttributeKind.RustcDeallocator,
};

export const RustcReallocatorParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_reallocator],
  ALLOWED_TARGETS: { $: "AllowList", _0: [Allow(Target.Fn), Allow(Target.ForeignFn)] },
  STABILITY: unstable(sym.rustc_attrs),
  CREATE: (_) => AttributeKind.RustcReallocator,
};
