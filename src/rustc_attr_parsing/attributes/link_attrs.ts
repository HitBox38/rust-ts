// Port of compiler/rustc_attr_parsing/src/attributes/link_attrs.rs
// (Conventions for `use super::prelude::*` / `unstable!`: see inline.ts.)
//
// PORT:
// - `LinkParser` has inherent associated fns (`parse_link_*`), so it is a class whose statics form
//   the `CombineAttributeParser` trait table (see repr.ts); `Self::parse_link_name(..)` is
//   `LinkParser.parse_link_name(..)`.
// - `&mut Option<_>` out-parameters are `MutRef`s; `&mut` places inside `NativeLibKind::Static { .. }`
//   etc. are `field_mut` views.
// - `macro report_unstable_modifier` is expanded at its single use.
// - `ExternAbi` (rustc_abi/src/extern_abi.rs) is not ported: `LinkParser::finalize_check` handles
//   `extern { .. }` without an ABI string (`ExternAbi::FALLBACK`, i.e. `C { unwind: false }`, which
//   is not `Rust`) and reaches `unported` when it has to parse an ABI string.
import type { CfgEntry } from "../../rustc_ast/attr/data_structures.ts";
import { type LinkEntry, type Linkage, type PeImportNameType, target as target_mod } from "../../rustc_attr_ir/lib.ts";
import { msg, str_trim } from "../../rustc_errors/lib.ts";
import { AttributeStability, type Features } from "../../rustc_feature/lib.ts";
import { ILL_FORMED_ATTRIBUTE_INPUT, UNUSED_ATTRIBUTES } from "../../rustc_lint_defs/builtin.ts";
import type { Session } from "../../rustc_session/lib.ts";
import { feature_err } from "../../rustc_session/diagnostics.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { display_Symbol, kw, Symbol, sym } from "../../rustc_span/symbol.ts";
import type { NativeLibKind } from "../../rustc_structures/native_lib_kind.ts";
import { field_mut, type MutRef } from "../../std/mut_ref.ts";
import { panic, unported, unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { utf8_len } from "../../std/str.ts";
import { type AcceptContext, ExpectNameValue, ExpectStringLiteral, type FinalizeCheckContext } from "../context.ts";
import {
  AsNeededCompatibility_diagnostic,
  BothFfiConstAndPure_diagnostic,
  BundleNeedsStatic_diagnostic,
  EmptyLinkName_diagnostic,
  ExportSymbolsNeedsStatic_diagnostic,
  ImportNameTypeRaw_diagnostic,
  ImportNameTypeX86_diagnostic,
  IncompatibleWasmLink_diagnostic,
  InvalidLinkModifier_diagnostic,
  InvalidMachoSection_diagnostic,
  type InvalidMachoSectionReason,
  Link_diagnostic,
  LinkFrameworkApple_diagnostic,
  LinkOrdinalOutOfRange_diagnostic,
  LinkRequiresName_diagnostic,
  MultipleModifiers_diagnostic,
  NullOnLinkName_diagnostic,
  NullOnLinkSection_diagnostic,
  RawDylibOnlyWindows_diagnostic,
  WholeArchiveNeedsStatic_diagnostic,
} from "../diagnostics.ts";
import { type ArgParser, MetaItemOrLitParser, type MetaItemParser } from "../parser.ts";
import type { AllowedTargets } from "../target_checking.ts";
import { type AttributeTemplate, template } from "../template.ts";
import { parse_cfg_entry } from "./cfg.ts";
import {
  CombineAttributeParser_provided,
  type ConvertFn,
  type NoArgsAttributeParser,
  NoArgsAttributeParser_provided,
  OnDuplicate,
  type SingleAttributeParser,
  SingleAttributeParser_provided,
} from "./mod.ts";
import { parse_single_integer } from "./util.ts";

const { Target, MethodKind, AssocCtxt } = target_mod;

export const LinkNameParser: SingleAttributeParser = {
  ...SingleAttributeParser_provided,
  PATH: [sym.link_name],
  ON_DUPLICATE: OnDuplicate.WarnButFutureError,
  ALLOWED_TARGETS: {
    $: "AllowListWarnRest",
    _0: [
      { $: "Allow", _0: Target.ForeignFn },
      { $: "Allow", _0: Target.ForeignStatic },
    ],
  },
  TEMPLATE: template(
    { NameValueStr: ["name"] },
    "https://doc.rust-lang.org/reference/items/external-blocks.html#the-link_name-attribute",
  ),
  STABILITY: AttributeStability.Stable,

  // rustc: compiler/rustc_attr_parsing/src/attributes/link_attrs.rs:42 convert
  convert(cx, args) {
    const nv = cx.expect_name_value(args, cx.attr_span, undefined, ExpectNameValue.ArgParser);
    if (nv === undefined) return undefined;
    const name = cx.expect_string_literal(nv, ExpectStringLiteral.NameValueParser);
    if (name === undefined) return undefined;

    if (Symbol.as_str(name).includes("\0")) {
      // `#[link_name = ...]` will be converted to a null-terminated string,
      // so it may not contain any null characters.
      cx.shared.emit_err(NullOnLinkName_diagnostic({ span: nv.value_span }));
      return undefined;
    }
    if (Symbol.is_empty(name)) {
      // Otherwise LLVM will just make up a name and the linker will fail
      // to find an empty symbol name.
      cx.shared.emit_err(EmptyLinkName_diagnostic({ span: nv.value_span }));
      return undefined;
    }

    return { $: "LinkName", name, span: cx.attr_span };
  },
};

export class LinkParser {
  // impl CombineAttributeParser for LinkParser
  // type Item = LinkEntry;
  static readonly PATH = [sym.link];
  static readonly CONVERT: ConvertFn<LinkEntry> = (items, span) => ({ $: "Link", _0: items, _1: span });
  static readonly TEMPLATE: AttributeTemplate = template(
    {
      List: [
        'name = "..."',
        'name = "...", kind = "dylib|static|..."',
        'name = "...", wasm_import_module = "..."',
        'name = "...", import_name_type = "decorated|noprefix|undecorated"',
        'name = "...", kind = "dylib|static|...", wasm_import_module = "...", import_name_type = "decorated|noprefix|undecorated"',
      ],
    },
    "https://doc.rust-lang.org/reference/items/external-blocks.html#the-link-attribute",
  );
  static readonly ALLOWED_TARGETS: AllowedTargets = {
    $: "AllowListWarnRest",
    _0: [{ $: "Allow", _0: Target.ForeignMod }],
  };
  static readonly STABILITY: AttributeStability = AttributeStability.Stable;
  static readonly SAFETY = CombineAttributeParser_provided.SAFETY;

  // rustc: compiler/rustc_attr_parsing/src/attributes/link_attrs.rs:80 extend
  static extend(cx: AcceptContext, args: ArgParser): Iterable<LinkEntry> {
    let items;
    if (args.$ === "List") {
      items = args._0;
    } else if (args.$ === "NameValue" && args._0.value_as_str() === sym.dl) {
      // This is an edgecase added because making this a hard error would break too many crates
      // Specifically `#[link = "dl"]` is accepted with a FCW
      // For more information, see https://github.com/rust-lang/rust/pull/143193
      cx.adcx().warn_ill_formed_attribute_input(ILL_FORMED_ATTRIBUTE_INPUT);
      return [];
    } else {
      const attr_span = cx.attr_span;
      cx.adcx().expected_list(attr_span, args);
      return [];
    }

    const sess = cx.shared.cx.sess();
    const features = cx.shared.cx.features();

    const name: MutRef<[Symbol, Span] | undefined> = { value: undefined };
    const kind: MutRef<NativeLibKind | undefined> = { value: undefined };
    const modifiers: MutRef<[Symbol, Span] | undefined> = { value: undefined };
    const cfg: MutRef<CfgEntry | undefined> = { value: undefined };
    const wasm_import_module: MutRef<[Symbol, Span] | undefined> = { value: undefined };
    const import_name_type: MutRef<[PeImportNameType, Span] | undefined> = { value: undefined };
    for (const item_ of items.mixed()) {
      const item = MetaItemOrLitParser.meta_item(item_);
      if (item === undefined) {
        cx.adcx().expected_not_literal(MetaItemOrLitParser.span(item_));
        continue;
      }

      const word = item.path().word();
      let cont: boolean;
      switch (word === undefined ? undefined : word.name) {
        case sym.name:
          cont = LinkParser.parse_link_name(item, name, cx);
          break;
        case sym.kind:
          cont = LinkParser.parse_link_kind(item, kind, cx, sess, features);
          break;
        case sym.modifiers:
          cont = LinkParser.parse_link_modifiers(item, modifiers, cx);
          break;
        case sym.cfg:
          cont = LinkParser.parse_link_cfg(item, cfg, cx, sess, features);
          break;
        case sym.wasm_import_module: {
          cont = LinkParser.parse_link_wasm_import_module(item, wasm_import_module, cx);
          break;
        }
        case sym.import_name_type: {
          cont = LinkParser.parse_link_import_name_type(item, import_name_type, cx);
          break;
        }
        default: {
          cx.adcx().expected_specific_argument_strings(item.span(), [
            sym.name,
            sym.kind,
            sym.modifiers,
            sym.cfg,
            sym.wasm_import_module,
            sym.import_name_type,
          ]);
          cont = true;
        }
      }
      if (!cont) {
        return [];
      }
    }

    // Do this outside the above loop so we don't depend on modifiers coming after kinds
    const verbatim: MutRef<boolean | undefined> = { value: undefined };
    if (modifiers.value !== undefined) {
      const [modifiers_, span] = modifiers.value;
      for (const modifier_ of Symbol.as_str(modifiers_).split(",")) {
        let modifier: Symbol;
        let value: boolean;
        if (modifier_.startsWith("+") || modifier_.startsWith("-")) {
          const m = modifier_.slice(1);
          [modifier, value] = [Symbol.intern(m), modifier_.startsWith("+")];
        } else {
          cx.shared.emit_err(InvalidLinkModifier_diagnostic({ span }));
          continue;
        }

        const assign_modifier = (dst: MutRef<boolean | undefined>): void => {
          if (dst.value !== undefined) {
            cx.shared.emit_err(MultipleModifiers_diagnostic({ span, modifier }));
          } else {
            dst.value = value;
          }
        };
        const k = kind.value;
        if (modifier === sym.bundle && k !== undefined && k.$ === "Static") {
          assign_modifier(field_mut(k, "bundle"));
        } else if (modifier === sym.bundle) {
          cx.shared.emit_err(BundleNeedsStatic_diagnostic({ span }));
        } else if (modifier === sym.export_symbols && k !== undefined && k.$ === "Static") {
          assign_modifier(field_mut(k, "export_symbols"));
        } else if (modifier === sym.export_symbols) {
          cx.shared.emit_err(ExportSymbolsNeedsStatic_diagnostic({ span }));
        } else if (modifier === sym.verbatim) {
          assign_modifier(verbatim);
        } else if (modifier === sym.whole_dash_archive && k !== undefined && k.$ === "Static") {
          assign_modifier(field_mut(k, "whole_archive"));
        } else if (modifier === sym.whole_dash_archive) {
          cx.shared.emit_err(WholeArchiveNeedsStatic_diagnostic({ span }));
        } else if (
          modifier === sym.as_dash_needed &&
          k !== undefined &&
          (k.$ === "Dylib" || k.$ === "Framework" || k.$ === "RawDylib")
        ) {
          // report_unstable_modifier!(native_link_modifiers_as_needed);
          if (!features.native_link_modifiers_as_needed()) {
            feature_err(
              sess,
              sym.native_link_modifiers_as_needed,
              span,
              `linking modifier \`${display_Symbol(modifier)}\` is unstable`,
            ).emit();
          }
          assign_modifier(field_mut(k, "as_needed"));
        } else if (modifier === sym.as_dash_needed) {
          cx.shared.emit_err(AsNeededCompatibility_diagnostic({ span }));
        } else {
          cx.adcx().expected_specific_argument_strings(span, [
            sym.bundle,
            sym.export_symbols,
            sym.verbatim,
            sym.whole_dash_archive,
            sym.as_dash_needed,
          ]);
        }
      }
    }

    if (wasm_import_module.value !== undefined) {
      const [, span] = wasm_import_module.value;
      if (name.value !== undefined || kind.value !== undefined || modifiers.value !== undefined || cfg.value !== undefined) {
        cx.shared.emit_err(IncompatibleWasmLink_diagnostic({ span }));
      }
    }

    if (wasm_import_module.value !== undefined) {
      [name.value, kind.value] = [wasm_import_module.value, { $: "WasmImportModule" }];
    }
    if (name.value === undefined) {
      cx.shared.emit_err(LinkRequiresName_diagnostic({ span: cx.attr_span }));
      return [];
    }
    const [name_, _name_span] = name.value;

    // Do this outside of the loop so that `import_name_type` can be specified before `kind`.
    if (import_name_type.value !== undefined) {
      const [, span] = import_name_type.value;
      if (!(kind.value !== undefined && kind.value.$ === "RawDylib")) {
        cx.shared.emit_err(ImportNameTypeRaw_diagnostic({ span }));
      }
    }

    return [
      {
        span: cx.attr_span,
        kind: kind.value ?? { $: "Unspecified" },
        name: name_,
        cfg: cfg.value,
        verbatim: verbatim.value,
        import_name_type: import_name_type.value,
      },
    ];
  }

  // rustc: compiler/rustc_attr_parsing/src/attributes/link_attrs.rs:264 finalize_check
  static finalize_check(cx: FinalizeCheckContext, attr_span: Span): void {
    if (cx.shared.target.$ !== "ForeignMod") {
      return;
    }

    const item = unwrap(cx.target_item, "missing AST target item for Target::ForeignMod");
    if (item.kind.$ !== "ForeignMod") {
      panic("expected foreign module AST target item for Target::ForeignMod");
    }
    const fm = item.kind._0;
    // `fm.abi.map_or(ExternAbi::FALLBACK, |abi| abi.symbol_unescaped.as_str().parse().unwrap_or_else(..))`
    // PORT: `ExternAbi::FALLBACK` (`C { unwind: false }`) is not `ExternAbi::Rust`.
    let abi_is_rust: boolean;
    if (fm.abi === undefined) {
      abi_is_rust = false;
    } else {
      abi_is_rust = unported("rustc_abi::ExternAbi::from_str (LinkParser::finalize_check)");
    }
    if (abi_is_rust) {
      cx.shared.emit_lint(UNUSED_ATTRIBUTES, Link_diagnostic({}), attr_span);
    }
  }

  // impl LinkParser

  // rustc: compiler/rustc_attr_parsing/src/attributes/link_attrs.rs:289 parse_link_name
  static parse_link_name(item: MetaItemParser, name: MutRef<[Symbol, Span] | undefined>, cx: AcceptContext): boolean {
    if (name.value !== undefined) {
      cx.adcx().duplicate_key(item.span(), sym.name);
      return true;
    }
    const nv = cx.expect_name_value(item.args(), item.span(), sym.name, ExpectNameValue.ArgParser);
    if (nv === undefined) {
      return false;
    }
    const link_name = cx.expect_string_literal(nv, ExpectStringLiteral.NameValueParser);
    if (link_name === undefined) {
      return false;
    }

    if (Symbol.as_str(link_name).includes("\0")) {
      cx.shared.emit_err(NullOnLinkName_diagnostic({ span: nv.value_span }));
    }
    if (Symbol.is_empty(link_name)) {
      cx.shared.emit_err(EmptyLinkName_diagnostic({ span: nv.value_span }));
    }

    name.value = [link_name, nv.value_span];
    return true;
  }

  // rustc: compiler/rustc_attr_parsing/src/attributes/link_attrs.rs:316 parse_link_kind
  static parse_link_kind(
    item: MetaItemParser,
    kind: MutRef<NativeLibKind | undefined>,
    cx: AcceptContext,
    sess: Session,
    features: Features,
  ): boolean {
    if (kind.value !== undefined) {
      cx.adcx().duplicate_key(item.span(), sym.kind);
      return true;
    }
    const nv = cx.expect_name_value(item.args(), item.span(), sym.kind, ExpectNameValue.ArgParser);
    if (nv === undefined) {
      return true;
    }
    const link_kind_ = cx.expect_string_literal(nv, ExpectStringLiteral.NameValueParser);
    if (link_kind_ === undefined) {
      return true;
    }

    let link_kind: NativeLibKind;
    switch (link_kind_) {
      case kw.Static: {
        link_kind = { $: "Static", bundle: undefined, whole_archive: undefined, export_symbols: undefined };
        break;
      }
      case sym.dylib:
        link_kind = { $: "Dylib", as_needed: undefined };
        break;
      case sym.framework: {
        if (!sess.target.is_like_darwin) {
          cx.shared.emit_err(LinkFrameworkApple_diagnostic({ span: nv.value_span }));
        }
        link_kind = { $: "Framework", as_needed: undefined };
        break;
      }
      case sym.raw_dash_dylib: {
        if (sess.target.is_like_windows) {
          // raw-dylib is stable and working on Windows
        } else if (sess.target.binary_format === "Elf" && features.raw_dylib_elf()) {
          // raw-dylib is unstable on ELF, but the user opted in
        } else if (sess.target.binary_format === "Elf" && sess.is_nightly_build()) {
          feature_err(sess, sym.raw_dylib_elf, nv.value_span, msg("link kind `raw-dylib` is unstable on ELF platforms")).emit();
        } else {
          cx.shared.emit_err(RawDylibOnlyWindows_diagnostic({ span: nv.value_span }));
        }

        link_kind = { $: "RawDylib", as_needed: undefined };
        break;
      }
      case sym.link_dash_arg: {
        if (!features.link_arg_attribute()) {
          feature_err(sess, sym.link_arg_attribute, nv.value_span, msg("link kind `link-arg` is unstable")).emit();
        }
        link_kind = { $: "LinkArg" };
        break;
      }
      default: {
        cx.adcx().expected_specific_argument_strings(nv.value_span, [
          kw.Static,
          sym.dylib,
          sym.framework,
          sym.raw_dash_dylib,
          sym.link_dash_arg,
        ]);
        return true;
      }
    }
    kind.value = link_kind;
    return true;
  }

  // rustc: compiler/rustc_attr_parsing/src/attributes/link_attrs.rs:396 parse_link_modifiers
  static parse_link_modifiers(item: MetaItemParser, modifiers: MutRef<[Symbol, Span] | undefined>, cx: AcceptContext): boolean {
    if (modifiers.value !== undefined) {
      cx.adcx().duplicate_key(item.span(), sym.modifiers);
      return true;
    }
    const nv = cx.expect_name_value(item.args(), item.span(), sym.modifiers, ExpectNameValue.ArgParser);
    if (nv === undefined) {
      return true;
    }
    const link_modifiers = cx.expect_string_literal(nv, ExpectStringLiteral.NameValueParser);
    if (link_modifiers === undefined) {
      return true;
    }
    modifiers.value = [link_modifiers, nv.value_span];
    return true;
  }

  // rustc: compiler/rustc_attr_parsing/src/attributes/link_attrs.rs:415 parse_link_cfg
  static parse_link_cfg(
    item: MetaItemParser,
    cfg: MutRef<CfgEntry | undefined>,
    cx: AcceptContext,
    sess: Session,
    features: Features,
  ): boolean {
    if (cfg.value !== undefined) {
      cx.adcx().duplicate_key(item.span(), sym.cfg);
      return true;
    }
    const link_cfg = cx.expect_single_element_list(item.args(), item.span());
    if (link_cfg === undefined) {
      return true;
    }
    if (!features.link_cfg()) {
      feature_err(sess, sym.link_cfg, item.span(), msg("link cfg is unstable")).emit();
    }
    const r = parse_cfg_entry(cx, link_cfg);
    cfg.value = r.$ === "Ok" ? r._0 : undefined;
    return true;
  }

  // rustc: compiler/rustc_attr_parsing/src/attributes/link_attrs.rs:436 parse_link_wasm_import_module
  static parse_link_wasm_import_module(
    item: MetaItemParser,
    wasm_import_module: MutRef<[Symbol, Span] | undefined>,
    cx: AcceptContext,
  ): boolean {
    if (wasm_import_module.value !== undefined) {
      cx.adcx().duplicate_key(item.span(), sym.wasm_import_module);
      return true;
    }
    const nv = cx.expect_name_value(item.args(), item.span(), sym.wasm_import_module, ExpectNameValue.ArgParser);
    if (nv === undefined) {
      return true;
    }
    const link_wasm_import_module = cx.expect_string_literal(nv, ExpectStringLiteral.NameValueParser);
    if (link_wasm_import_module === undefined) {
      return true;
    }
    wasm_import_module.value = [link_wasm_import_module, item.span()];
    return true;
  }

  // rustc: compiler/rustc_attr_parsing/src/attributes/link_attrs.rs:457 parse_link_import_name_type
  static parse_link_import_name_type(
    item: MetaItemParser,
    import_name_type: MutRef<[PeImportNameType, Span] | undefined>,
    cx: AcceptContext,
  ): boolean {
    if (import_name_type.value !== undefined) {
      cx.adcx().duplicate_key(item.span(), sym.import_name_type);
      return true;
    }
    const nv = cx.expect_name_value(item.args(), item.span(), sym.import_name_type, ExpectNameValue.ArgParser);
    if (nv === undefined) {
      return true;
    }
    const link_import_name_type_ = cx.expect_string_literal(nv, ExpectStringLiteral.NameValueParser);
    if (link_import_name_type_ === undefined) {
      return true;
    }
    if (cx.shared.cx.sess().target.arch.$ !== "X86") {
      cx.shared.emit_err(ImportNameTypeX86_diagnostic({ span: item.span() }));
      return true;
    }

    let link_import_name_type: PeImportNameType;
    switch (link_import_name_type_) {
      case sym.decorated:
        link_import_name_type = { $: "Decorated" };
        break;
      case sym.noprefix:
        link_import_name_type = { $: "NoPrefix" };
        break;
      case sym.undecorated:
        link_import_name_type = { $: "Undecorated" };
        break;
      default: {
        cx.adcx().expected_specific_argument_strings(item.span(), [sym.decorated, sym.noprefix, sym.undecorated]);
        return true;
      }
    }
    import_name_type.value = [link_import_name_type, item.span()];
    return true;
  }
}

// rustc: compiler/rustc_attr_parsing/src/attributes/link_attrs.rs:497 check_link_section_macho
function check_link_section_macho(name: Symbol): Result<undefined, InvalidMachoSectionReason> {
  // PORT: the `split(',').map(|s| s.trim())` iterator is an array walked with `next`.
  const parts = Symbol.as_str(name)
    .split(",")
    .map((s) => str_trim(s));
  let next = 0;

  // The segment can be empty.
  const _segment = parts[next++];

  // But the section is required.
  const section = parts[next++];
  if (section === undefined || section === "") {
    return Err({ $: "MissingSection" });
  }

  if (utf8_len(section) > 16) {
    return Err({ $: "SectionTooLong", section: section });
  }

  // LLVM also checks the other components of the section specifier, but that logic is hard to
  // keep in sync. We skip it here for now, assuming that if you got that far you'll be able
  // to interpret the LLVM errors.

  return Ok(undefined);
}

export const LinkSectionParser: SingleAttributeParser = {
  ...SingleAttributeParser_provided,
  PATH: [sym.link_section],
  ON_DUPLICATE: OnDuplicate.WarnButFutureError,
  SAFETY: {
    $: "Unsafe",
    note: "the program's behavior with overridden link sections on items is unpredictable and Rust cannot provide guarantees when you manually override them",
    unsafe_since: "Edition2024",
  },
  STABILITY: AttributeStability.Stable,
  ALLOWED_TARGETS: {
    $: "AllowListWarnRest",
    _0: [
      { $: "Allow", _0: Target.Static },
      { $: "Allow", _0: Target.Fn },
      { $: "Allow", _0: { $: "Method", _0: MethodKind.Inherent } },
      { $: "Allow", _0: { $: "Method", _0: { $: "Trait", body: true } } },
      { $: "Allow", _0: { $: "Method", _0: MethodKind.TraitImpl } },
    ],
  },
  TEMPLATE: template({ NameValueStr: ["name"] }, "https://doc.rust-lang.org/reference/abi.html#the-link_section-attribute"),

  // rustc: compiler/rustc_attr_parsing/src/attributes/link_attrs.rs:540 convert
  convert(cx, args) {
    const nv = cx.expect_name_value(args, cx.attr_span, undefined, ExpectNameValue.ArgParser);
    if (nv === undefined) return undefined;
    const name = cx.expect_string_literal(nv, ExpectStringLiteral.NameValueParser);
    if (name === undefined) return undefined;
    if (Symbol.as_str(name).includes("\0")) {
      // `#[link_section = ...]` will be converted to a null-terminated string,
      // so it may not contain any null characters.
      cx.shared.emit_err(NullOnLinkSection_diagnostic({ span: cx.attr_span }));
      return undefined;
    }

    // We (currently) only validate macho section specifiers.
    switch (cx.shared.cx.sess_.target.binary_format) {
      case "MachO": {
        const r = check_link_section_macho(name);
        if (r.$ === "Ok") {
          // {}
        } else {
          const reason = r._0;
          cx.shared.emit_err(InvalidMachoSection_diagnostic({ name_span: nv.value_span, reason }));
          return undefined;
        }
        break;
      }
      case "Coff":
      case "Elf":
      case "Wasm":
      case "Xcoff":
        break;
    }

    return { $: "LinkSection", name };
  },
};

export const ExportStableParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.export_stable],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      { $: "Allow", _0: Target.Fn },
      { $: "Allow", _0: { $: "Method", _0: MethodKind.Inherent } },
      { $: "Allow", _0: Target.Struct },
      { $: "Allow", _0: Target.Enum },
      { $: "Allow", _0: Target.Union },
      { $: "Allow", _0: Target.TyAlias },
      { $: "Allow", _0: { $: "AssocTy", _0: { $: "Impl", of_trait: false } } },
      { $: "Allow", _0: { $: "AssocTy", _0: AssocCtxt.Trait } },
      { $: "Allow", _0: { $: "AssocTy", _0: { $: "Impl", of_trait: true } } },
      { $: "Allow", _0: Target.Use },
      { $: "Allow", _0: Target.Mod },
      { $: "Allow", _0: { $: "Impl", of_trait: false } },
    ],
  },
  STABILITY: { $: "Unstable", gate_name: sym.export_stable, notes: [] },
  CREATE: (_) => ({ $: "ExportStable" }),
};

export const FfiConstParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.ffi_const],
  SAFETY: {
    $: "Unsafe",
    note: "`#[ffi_const]` functions shall have no effects except for its return value, which can only depend on the values of the function parameters, and is not affected by changes to the observable state of the program.",
    unsafe_since: undefined,
  },
  ALLOWED_TARGETS: { $: "AllowList", _0: [{ $: "Allow", _0: Target.ForeignFn }] },
  STABILITY: { $: "Unstable", gate_name: sym.ffi_const, notes: [] },
  CREATE: (_) => ({ $: "FfiConst" }),
};

export const FfiPureParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.ffi_pure],
  SAFETY: {
    $: "Unsafe",
    note: "`#[ffi_pure]` functions shall have no effects except for its return value, which shall not change across two consecutive function calls with the same parameters.",
    unsafe_since: undefined,
  },
  ALLOWED_TARGETS: { $: "AllowList", _0: [{ $: "Allow", _0: Target.ForeignFn }] },
  STABILITY: { $: "Unstable", gate_name: sym.ffi_pure, notes: [] },
  CREATE: (span) => ({ $: "FfiPure", _0: span }),

  // rustc: compiler/rustc_attr_parsing/src/attributes/link_attrs.rs:612 finalize_check
  finalize_check(cx, attr_span) {
    // `#[ffi_const]` functions cannot be `#[ffi_pure]`.
    if (cx.all_attrs.some((a) => a.word_is(sym.ffi_const))) {
      cx.shared.emit_err(BothFfiConstAndPure_diagnostic({ attr_span }));
    }
  },
};

export const RustcStdInternalSymbolParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.rustc_std_internal_symbol],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      { $: "Allow", _0: Target.Fn },
      { $: "Allow", _0: Target.ForeignFn },
      { $: "Allow", _0: Target.Static },
      { $: "Allow", _0: Target.ForeignStatic },
    ],
  },
  STABILITY: { $: "Unstable", gate_name: sym.rustc_attrs, notes: [] },
  CREATE: (_) => ({ $: "RustcStdInternalSymbol" }),
};

export const LinkOrdinalParser: SingleAttributeParser = {
  ...SingleAttributeParser_provided,
  PATH: [sym.link_ordinal],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      { $: "Allow", _0: Target.ForeignFn },
      { $: "Allow", _0: Target.ForeignStatic },
      { $: "Warn", _0: Target.MacroCall },
    ],
  },
  TEMPLATE: template(
    { List: ["ordinal"] },
    "https://doc.rust-lang.org/reference/items/external-blocks.html#the-link_ordinal-attribute",
  ),
  STABILITY: AttributeStability.Stable,

  // rustc: compiler/rustc_attr_parsing/src/attributes/link_attrs.rs:648 convert
  convert(cx, args) {
    const ordinal = parse_single_integer(cx, args);
    if (ordinal === undefined) return undefined;

    // According to the table at
    // https://docs.microsoft.com/en-us/windows/win32/debug/pe-format#import-header, the
    // ordinal must fit into 16 bits. Similarly, the Ordinal field in COFFShortExport (defined
    // in llvm/include/llvm/Object/COFFImportFile.h), which we use to communicate import
    // information to LLVM for `#[link(kind = "raw-dylib"_])`, is also defined to be uint16_t.
    //
    // FIXME: should we allow an ordinal of 0?  The MSVC toolchain has inconsistent support for
    // this: both LINK.EXE and LIB.EXE signal errors and abort when given a .DEF file that
    // specifies a zero ordinal. However, llvm-dlltool is perfectly happy to generate an import
    // library for such a .DEF file, and MSVC's LINK.EXE is also perfectly happy to consume an
    // import library produced by LLVM with an ordinal of 0, and it generates an .EXE.  (I
    // don't know yet if the resulting EXE runs, as I haven't yet built the necessary DLL --
    // see earlier comment about LINK.EXE failing.)
    // `ordinal.try_into()` (u128 -> u16)
    if (!(ordinal <= 0xffffn)) {
      cx.shared.emit_err(LinkOrdinalOutOfRange_diagnostic({ span: cx.attr_span, ordinal }));
      return undefined;
    }

    return { $: "LinkOrdinal", ordinal: Number(ordinal), span: cx.attr_span };
  },
};

export const LinkageParser: SingleAttributeParser = {
  ...SingleAttributeParser_provided,
  PATH: [sym.linkage],
  ALLOWED_TARGETS: {
    $: "AllowList",
    _0: [
      { $: "Allow", _0: Target.Fn }, // const fn denied in check_attr
      { $: "Allow", _0: { $: "Method", _0: MethodKind.Inherent } },
      { $: "Allow", _0: { $: "Method", _0: { $: "Trait", body: true } } },
      { $: "Allow", _0: { $: "Method", _0: MethodKind.TraitImpl } },
      { $: "Allow", _0: Target.Static },
      { $: "Allow", _0: Target.ForeignStatic }, // extern static mut denied in check_attr
      { $: "Allow", _0: Target.ForeignFn },
    ],
  },
  TEMPLATE: template({
    NameValueStr: ["available_externally", "extern_weak", "linkonce", "linkonce_odr", "weak", "weak_odr"],
  }),
  STABILITY: { $: "Unstable", gate_name: sym.linkage, notes: [] },

  // rustc: compiler/rustc_attr_parsing/src/attributes/link_attrs.rs:696 convert
  convert(cx, args) {
    const name_value = cx.expect_name_value(args, cx.attr_span, sym.linkage, ExpectNameValue.ArgParser);
    if (name_value === undefined) return undefined;

    const value = cx.expect_string_literal(name_value, ExpectStringLiteral.NameValueParser);
    if (value === undefined) return undefined;

    // Use the names from src/llvm/docs/LangRef.rst here. Most types are only
    // applicable to variable declarations and may not really make sense for
    // Rust code in the first place but allow them anyway and trust that the
    // user knows what they're doing. Who knows, unanticipated use cases may pop
    // up in the future.
    //
    // ghost, dllimport, dllexport and linkonce_odr_autohide are not supported
    // and don't have to be, LLVM treats them as no-ops.
    let linkage: Linkage;
    switch (value) {
      case sym.available_externally:
        linkage = "AvailableExternally";
        break;
      case sym.extern_weak:
        linkage = "ExternalWeak";
        break;
      case sym.linkonce:
        linkage = "LinkOnceAny";
        break;
      case sym.linkonce_odr:
        linkage = "LinkOnceODR";
        break;
      case sym.weak:
        linkage = "WeakAny";
        break;
      case sym.weak_odr:
        linkage = "WeakODR";
        break;

      default: {
        cx.adcx().expected_specific_argument(name_value.value_span, [
          sym.available_externally,
          sym.extern_weak,
          sym.linkonce,
          sym.linkonce_odr,
          sym.weak,
          sym.weak_odr,
        ]);
        return undefined;
      }
    }

    return { $: "Linkage", _0: linkage, _1: cx.attr_span };
  },
};

export const NeedsAllocatorParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.needs_allocator],
  ALLOWED_TARGETS: { $: "AllowList", _0: [{ $: "Allow", _0: Target.Crate }] },
  STABILITY: { $: "Unstable", gate_name: sym.allocator_internals, notes: [] },
  CREATE: (_) => ({ $: "NeedsAllocator" }),
};

export const CompilerBuiltinsParser: NoArgsAttributeParser = {
  ...NoArgsAttributeParser_provided,
  PATH: [sym.compiler_builtins],
  ALLOWED_TARGETS: { $: "AllowList", _0: [{ $: "Allow", _0: Target.Crate }] },
  STABILITY: { $: "Unstable", gate_name: sym.compiler_builtins, notes: [] },
  CREATE: (_) => ({ $: "CompilerBuiltins" }),
};
