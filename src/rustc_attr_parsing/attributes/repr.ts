// Port of compiler/rustc_attr_parsing/src/attributes/repr.rs
// (Conventions for `use super::prelude::*` / `unstable!`: see inline.ts.)
//
// PORT:
// - `RustcAlignParser` / `RustcAlignStaticParser` have inherent items (`PATH`, `TEMPLATE`, `parse`),
//   so they are classes (PORTING §5 "Structs"); the class itself is the `AttributeParser` trait
//   table (static `default`, `ATTRIBUTES`, `ALLOWED_TARGETS`, `finalize`, and the provided items
//   from `AttributeParser_provided`). `Self::parse` as an `AcceptFn` is `(self, cx, args) =>
//   self.parse(cx, args)`.
// - `Size::signed_int_max` (rustc_abi) is not ported; `parse_alignment` computes it in place
//   (`i128::MAX >> (128 - bits)`), see `signed_int_max` below.
import type { LitKind } from "../../rustc_ast/lib.ts";
import { Align, Size } from "../../rustc_abi/lib.ts";
import type { ReprAttr } from "../../rustc_attr_ir/lib.ts";
import type { Align as IrAlign } from "../../rustc_attr_ir/standins.ts";
import { target as target_mod } from "../../rustc_attr_ir/lib.ts";
import { AttributeStability } from "../../rustc_feature/lib.ts";
import { feature_err } from "../../rustc_session/diagnostics.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { OrdSpan } from "../../rustc_span/span_encoding.ts";
import { sym } from "../../rustc_span/symbol.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import type { AcceptContext, FinalizeContext } from "../context.ts";
import * as diagnostics from "../diagnostics.ts";
import { type MetaItemListParser, MetaItemOrLitParser, type MetaItemParser } from "../parser.ts";
import type { ArgParser } from "../parser.ts";
import type { AllowedTargets } from "../target_checking.ts";
import { type AttributeTemplate, template } from "../template.ts";
import {
  type AcceptMapping,
  AttributeParser_provided,
  type CombineAttributeParser,
  CombineAttributeParser_provided,
} from "./mod.ts";

const { Target, MethodKind } = target_mod;

/// Parse #[repr(...)] forms.
///
/// Valid repr contents:
/// * any of the primitive integral type names to specify enum discriminant type
/// * `Rust`, to use the default `Rust` layout of the type
/// * `C`, to use the same layout for the type that C would use
/// * `align(...)`, to change the alignment requirements of the type
/// * `packed`, to remove padding
/// * `transparent`, to delegate representation concerns to the only non-ZST field.
export const ReprParser: CombineAttributeParser<[ReprAttr, Span]> = {
  ...CombineAttributeParser_provided,
  PATH: [sym.repr],
  CONVERT: (items, first_span) => ({ $: "Repr", reprs: items, first_span }),
  TEMPLATE: template(
    { List: ["C", "Rust", "transparent", "align(...)", "packed(...)", "<integer type>"] },
    "https://doc.rust-lang.org/reference/type-layout.html#representations",
  ),

  // rustc: compiler/rustc_attr_parsing/src/attributes/repr.rs:33 extend
  extend(cx, args) {
    const list = cx.expect_list(args, cx.attr_span);
    if (list === undefined) {
      return [];
    }

    if (list.is_empty()) {
      cx.check_target("()", {
        $: "AllowList",
        _0: [
          { $: "Allow", _0: Target.Struct },
          { $: "Allow", _0: Target.Enum },
          { $: "Allow", _0: Target.Union },
          { $: "Warn", _0: Target.MacroCall },
        ],
      });

      const attr_span = cx.attr_span;
      cx.adcx().warn_empty_attribute(attr_span);
      return [];
    }

    const reprs: [ReprAttr, Span][] = [];
    for (const param of list.mixed()) {
      const item = MetaItemOrLitParser.meta_item(param);
      if (item === undefined) {
        cx.adcx().expected_identifier(MetaItemOrLitParser.span(param));
        continue;
      }
      const r = parse_repr(cx, item);
      if (r !== undefined) reprs.push([r, MetaItemOrLitParser.span(param)]);
    }
    return reprs;
  },

  ALLOWED_TARGETS: { $: "ManuallyChecked" },
  STABILITY: AttributeStability.Stable,
};

// rustc: compiler/rustc_attr_parsing/src/attributes/repr.rs:72 parse_repr
function parse_repr(cx: AcceptContext, param: MetaItemParser): ReprAttr | undefined {
  // use ReprAttr::*;

  // macro_rules! repr_int
  const repr_int = (arg: string, constructor: ReprAttr): ReprAttr | undefined => {
    cx.check_target(`(${arg})`, {
      $: "AllowList",
      _0: [
        { $: "Allow", _0: Target.Enum },
        { $: "Warn", _0: Target.MacroCall },
      ],
    });
    if (cx.expect_no_args(param.args()) === undefined) return undefined;
    return constructor;
  };

  switch (param.path().word_sym()) {
    case sym.align: {
      cx.check_target("(align(...))", {
        $: "AllowList",
        _0: [
          { $: "Allow", _0: Target.Struct },
          { $: "Allow", _0: Target.Enum },
          { $: "Allow", _0: Target.Union },
          { $: "Warn", _0: Target.MacroCall },
        ],
      });
      const l = cx.expect_list(param.args(), param.span());
      if (l === undefined) return undefined;
      return parse_repr_align(cx, l, "Align");
    }
    case sym.packed: {
      cx.check_target("(packed)", {
        $: "AllowList",
        _0: [
          { $: "Allow", _0: Target.Struct },
          { $: "Allow", _0: Target.Union },
          { $: "Warn", _0: Target.MacroCall },
        ],
      });
      const args = param.args();
      switch (args.$) {
        case "NoArgs":
          return { $: "ReprPacked", _0: ir_align(Align.ONE) };
        case "List":
          return parse_repr_align(cx, args._0, "Packed");
        case "NameValue": {
          cx.adcx().expected_list_or_no_args(param.span());
          return undefined;
        }
      }
      break;
    }

    case sym.Rust: {
      cx.check_target("(Rust)", {
        $: "AllowList",
        _0: [
          { $: "Allow", _0: Target.Struct },
          { $: "Allow", _0: Target.Enum },
          { $: "Allow", _0: Target.Union },
          { $: "Warn", _0: Target.MacroCall },
        ],
      });
      if (cx.expect_no_args(param.args()) === undefined) return undefined;
      return { $: "ReprRust" };
    }
    case sym.C: {
      cx.check_target("(C)", {
        $: "AllowList",
        _0: [
          { $: "Allow", _0: Target.Struct },
          { $: "Allow", _0: Target.Enum },
          { $: "Allow", _0: Target.Union },
          { $: "Warn", _0: Target.MacroCall },
        ],
      });
      if (cx.expect_no_args(param.args()) === undefined) return undefined;
      return { $: "ReprC" };
    }
    case sym.simd: {
      const feats = cx.shared.cx.features_;
      if (feats !== undefined && !feats.repr_simd()) {
        feature_err(cx.shared.cx.sess(), sym.repr_simd, param.span(), "SIMD types are experimental and possibly buggy").emit();
      }
      cx.check_target("(simd)", { $: "AllowList", _0: [{ $: "Allow", _0: Target.Struct }] });
      if (cx.expect_no_args(param.args()) === undefined) return undefined;
      return { $: "ReprSimd" };
    }
    case sym.transparent: {
      cx.check_target("(transparent)", {
        $: "AllowList",
        _0: [
          { $: "Allow", _0: Target.Struct },
          { $: "Allow", _0: Target.Enum },
          { $: "Allow", _0: Target.Union }, // Feature gated in `rustc_attr_ir_analysis`
          { $: "Warn", _0: Target.MacroCall },
        ],
      });
      if (cx.expect_no_args(param.args()) === undefined) return undefined;
      return { $: "ReprTransparent" };
    }

    case sym.i8:
      return repr_int("i8", { $: "ReprInt", _0: { $: "SignedInt", _0: "I8" } });
    case sym.u8:
      return repr_int("u8", { $: "ReprInt", _0: { $: "UnsignedInt", _0: "U8" } });
    case sym.i16:
      return repr_int("i16", { $: "ReprInt", _0: { $: "SignedInt", _0: "I16" } });
    case sym.u16:
      return repr_int("u16", { $: "ReprInt", _0: { $: "UnsignedInt", _0: "U16" } });
    case sym.i32:
      return repr_int("i32", { $: "ReprInt", _0: { $: "SignedInt", _0: "I32" } });
    case sym.u32:
      return repr_int("u32", { $: "ReprInt", _0: { $: "UnsignedInt", _0: "U32" } });
    case sym.i64:
      return repr_int("i64", { $: "ReprInt", _0: { $: "SignedInt", _0: "I64" } });
    case sym.u64:
      return repr_int("u64", { $: "ReprInt", _0: { $: "UnsignedInt", _0: "U64" } });
    case sym.i128:
      return repr_int("i128", { $: "ReprInt", _0: { $: "SignedInt", _0: "I128" } });
    case sym.u128:
      return repr_int("u128", { $: "ReprInt", _0: { $: "UnsignedInt", _0: "U128" } });
    case sym.isize:
      return repr_int("isize", { $: "ReprInt", _0: { $: "SignedInt", _0: "Isize" } });
    case sym.usize:
      return repr_int("usize", { $: "ReprInt", _0: { $: "UnsignedInt", _0: "Usize" } });
    default: {
      cx.adcx().expected_specific_argument(param.span(), [
        sym.align,
        sym.packed,
        sym.Rust,
        sym.C,
        sym.simd,
        sym.transparent,
        sym.i8,
        sym.u8,
        sym.i16,
        sym.u16,
        sym.i32,
        sym.u32,
        sym.i64,
        sym.u64,
        sym.i128,
        sym.u128,
        sym.isize,
        sym.usize,
      ]);
      return undefined;
    }
  }
}

/**
 * PORT: rustc_attr_ir still types `Align` as an opaque stand-in (rustc_attr_ir/standins.ts, "rustc_abi
 * not ported yet"); rustc_abi's `Align` is ported now, and it is the value stored. Drop this cast when
 * root repoints tools/codegen/typemap.attr_ir.json at rustc_abi (docs/handoff/attr-parse-c.md).
 */
function ir_align(a: Align): IrAlign {
  return a as unknown as IrAlign;
}

/** `enum AlignKind` */
type AlignKind = "Packed" | "Align";

// rustc: compiler/rustc_attr_parsing/src/attributes/repr.rs:219 parse_repr_align
function parse_repr_align(cx: AcceptContext, list: MetaItemListParser, align_kind: AlignKind): ReprAttr | undefined {
  const align = list.as_single();
  if (align === undefined) {
    cx.adcx().expected_single_argument(list.span, list.len());
    return undefined;
  }

  const lit = MetaItemOrLitParser.as_lit(align);
  if (lit === undefined) {
    cx.adcx().expected_integer_literal(MetaItemOrLitParser.span(align));
    return undefined;
  }

  const r = parse_alignment(lit.kind, cx);
  if (r.$ === "Ok") {
    const literal = r._0;
    switch (align_kind) {
      case "Packed":
        return { $: "ReprPacked", _0: ir_align(literal) };
      case "Align":
        return { $: "ReprAlign", _0: ir_align(literal) };
    }
  } else {
    const message = r._0;
    cx.shared.emit_err(diagnostics.InvalidAlignmentValue_diagnostic({ span: lit.span, error_part: message }));
    return undefined;
  }
}

/** PORT: `Size::signed_int_max` (rustc_abi/src/lib.rs, not ported): `i128::MAX >> (128 - self.bits())`. */
function signed_int_max(size: Size): bigint {
  return ((1n << 127n) - 1n) >> BigInt(128 - size.bits());
}

const U64_MAX = 0xffff_ffff_ffff_ffffn;

// rustc: compiler/rustc_attr_parsing/src/attributes/repr.rs:246 parse_alignment
function parse_alignment(node: LitKind, cx: AcceptContext): Result<Align, string> {
  if (!(node.$ === "Int" && node._1.$ === "Unsuffixed")) {
    return Err("not an unsuffixed integer");
  }
  const literal = node._0;

  // `Align::from_bytes` accepts 0 as a valid input,
  // so we check if its a power of two first
  if (!(literal > 0n && (literal & (literal - 1n)) === 0n)) {
    return Err("not a power of two");
  }
  // lit must be < 2^29
  // PORT: `literal.get().try_into().ok()` (u128 -> u64), then `Align::from_bytes(a).ok()`.
  const a = literal <= U64_MAX ? literal : undefined;
  const from_bytes = a === undefined ? undefined : Align.from_bytes(a);
  const align = from_bytes !== undefined && from_bytes.$ === "Ok" ? from_bytes._0 : undefined;
  if (align === undefined) {
    return Err("larger than 2^29");
  }

  // alignment must not be larger than the pointer width (`isize::MAX`)
  const max = signed_int_max(Size.from_bits(cx.shared.cx.sess_.target.pointer_width));
  if (BigInt(align.bytes()) > max) {
    return Err(`alignment larger than \`isize::MAX\` bytes (${max} for the current target)`);
  }
  return Ok(align);
}

/** `Ord::cmp` of `(Align, OrdSpan)` (derived `Ord` of `Align` compares `pow2`). */
function cmp_align_span(a: [Align, OrdSpan], b: [Align, OrdSpan]): -1 | 0 | 1 {
  if (a[0].pow2 !== b[0].pow2) return a[0].pow2 < b[0].pow2 ? -1 : 1;
  return a[1].cmp(b[1]);
}

/// Parse #[align(N)].
// #[derive(Default)]
export class RustcAlignParser {
  constructor(public _0: [Align, OrdSpan] | undefined) {}

  static readonly PATH = [sym.rustc_align];
  static readonly TEMPLATE: AttributeTemplate = template({ List: ["<alignment in bytes>"] });

  // rustc: compiler/rustc_attr_parsing/src/attributes/repr.rs:282 parse
  parse(cx: AcceptContext, args: ArgParser): void {
    const list = cx.expect_list(args, cx.attr_span);
    if (list === undefined) {
      return;
    }

    const align = cx.expect_single(list);
    if (align === undefined) {
      return;
    }

    const lit = MetaItemOrLitParser.as_lit(align);
    if (lit === undefined) {
      cx.adcx().expected_integer_literal(MetaItemOrLitParser.span(align));
      return;
    }

    const r = parse_alignment(lit.kind, cx);
    if (r.$ === "Ok") {
      const literal = r._0;
      // `Ord::max(self.0, Some((literal, OrdSpan(cx.attr_span))))`: `None` < `Some`; on equality the
      // second argument wins.
      const other: [Align, OrdSpan] = [literal, new OrdSpan(cx.attr_span)];
      this._0 = this._0 !== undefined && cmp_align_span(this._0, other) === 1 ? this._0 : other;
    } else {
      const message = r._0;
      cx.shared.emit_err(
        diagnostics.InvalidAlignmentValue_diagnostic({
          span: lit.span,
          error_part: message,
        }),
      );
    }
  }

  // impl AttributeParser for RustcAlignParser
  static default(): RustcAlignParser {
    return new RustcAlignParser(undefined);
  }
  static readonly ATTRIBUTES: AcceptMapping<RustcAlignParser> = [
    [
      RustcAlignParser.PATH,
      RustcAlignParser.TEMPLATE,
      { $: "Unstable", gate_name: sym.fn_align, notes: [] },
      (self, cx, args) => self.parse(cx, args),
    ],
  ];
  static readonly ALLOWED_TARGETS: AllowedTargets = {
    $: "AllowList",
    _0: [
      { $: "Allow", _0: Target.Fn },
      { $: "Allow", _0: { $: "Method", _0: MethodKind.Inherent } },
      { $: "Allow", _0: { $: "Method", _0: { $: "Trait", body: true } } },
      { $: "Allow", _0: { $: "Method", _0: MethodKind.TraitImpl } },
      { $: "Allow", _0: { $: "Method", _0: { $: "Trait", body: false } } }, // `#[align]` is inherited from trait methods
      { $: "Allow", _0: Target.ForeignFn },
    ],
  };
  static readonly SAFETY = AttributeParser_provided.SAFETY;

  // rustc: compiler/rustc_attr_parsing/src/attributes/repr.rs:320 finalize
  static finalize(self: RustcAlignParser, _cx: FinalizeContext): { $: "RustcAlign"; align: IrAlign; span: Span } | undefined {
    if (self._0 === undefined) return undefined;
    const [align, span] = self._0;
    return { $: "RustcAlign", align: ir_align(align), span: span._0 };
  }

  static readonly deferred_finalize_check = AttributeParser_provided.deferred_finalize_check;
}

// #[derive(Default)]
export class RustcAlignStaticParser {
  constructor(public _0: RustcAlignParser) {}

  static readonly PATH = [sym.rustc_align_static];
  static readonly TEMPLATE: AttributeTemplate = RustcAlignParser.TEMPLATE;

  // rustc: compiler/rustc_attr_parsing/src/attributes/repr.rs:333 parse
  parse(cx: AcceptContext, args: ArgParser): void {
    this._0.parse(cx, args);
  }

  // impl AttributeParser for RustcAlignStaticParser
  static default(): RustcAlignStaticParser {
    return new RustcAlignStaticParser(RustcAlignParser.default());
  }
  static readonly ATTRIBUTES: AcceptMapping<RustcAlignStaticParser> = [
    [
      RustcAlignStaticParser.PATH,
      RustcAlignStaticParser.TEMPLATE,
      { $: "Unstable", gate_name: sym.static_align, notes: [] },
      (self, cx, args) => self.parse(cx, args),
    ],
  ];
  static readonly ALLOWED_TARGETS: AllowedTargets = {
    $: "AllowList",
    _0: [
      { $: "Allow", _0: Target.Static },
      { $: "Allow", _0: Target.ForeignStatic },
    ],
  };
  static readonly SAFETY = AttributeParser_provided.SAFETY;

  // rustc: compiler/rustc_attr_parsing/src/attributes/repr.rs:344 finalize
  static finalize(self: RustcAlignStaticParser, _cx: FinalizeContext): { $: "RustcAlign"; align: IrAlign; span: Span } | undefined {
    if (self._0._0 === undefined) return undefined;
    const [align, span] = self._0._0;
    return { $: "RustcAlign", align: ir_align(align), span: span._0 };
  }

  static readonly deferred_finalize_check = AttributeParser_provided.deferred_finalize_check;
}
