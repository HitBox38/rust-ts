// Port of compiler/rustc_attr_parsing/src/attributes/repr.rs
// (Conventions for `use super::prelude::*` / `unstable!`: see inline.ts.)
//
// PORT:
// - `RustcAlignParser` / `RustcAlignStaticParser`: the state is an interface; the inherent
//   `impl RustcAlignParser { PATH, TEMPLATE, fn parse }` is `RustcAlignParser_inherent` (methods
//   take the state as their first parameter), spread into the parser's table next to its
//   `AttributeParser` items (the pattern of lane attr-parse-d's on_unimplemented.ts). `Self::parse`
//   as an `AcceptFn` is `(self, cx, args) => RustcAlignParser_inherent.parse(self, cx, args)`.
// - `Size::signed_int_max` (rustc_abi) is not ported; `parse_alignment` computes it in place
//   (`i128::MAX >> (128 - bits)`), see `signed_int_max` below.
import type { LitKind } from "../../rustc_ast/lib.ts";
import { Align, Size } from "../../rustc_abi/lib.ts";
import type { ReprAttr } from "../../rustc_attr_ir/lib.ts";
import { target as target_mod } from "../../rustc_attr_ir/lib.ts";
import { AttributeStability } from "../../rustc_feature/lib.ts";
import { feature_err } from "../../rustc_session/diagnostics.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { OrdSpan } from "../../rustc_span/span_encoding.ts";
import { type Symbol, sym } from "../../rustc_span/symbol.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import type { AcceptContext } from "../context.ts";
import * as diagnostics from "../diagnostics.ts";
import { type ArgParser, type MetaItemListParser, MetaItemOrLitParser, type MetaItemParser } from "../parser.ts";
import { unstable } from "../stability.ts";
import { template } from "../template.ts";
import {
  type AttributeParser,
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
export const ReprParser: CombineAttributeParser<[ReprAttr, Span]> = CombineAttributeParser_provided({
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
});

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
          return { $: "ReprPacked", _0: Align.ONE };
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
        return { $: "ReprPacked", _0: literal };
      case "Align":
        return { $: "ReprAlign", _0: literal };
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
/** `#[derive(Default)] pub(crate) struct RustcAlignParser(Option<(Align, OrdSpan)>)` */
export interface RustcAlignParser {
  _0: [Align, OrdSpan] | undefined;
}

/** `impl RustcAlignParser` */
const RustcAlignParser_inherent = {
  PATH: [sym.rustc_align] as readonly Symbol[],
  TEMPLATE: template({ List: ["<alignment in bytes>"] }),

  // rustc: compiler/rustc_attr_parsing/src/attributes/repr.rs:282 parse
  parse(self: RustcAlignParser, cx: AcceptContext, args: ArgParser): void {
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
      self._0 = self._0 !== undefined && cmp_align_span(self._0, other) === 1 ? self._0 : other;
    } else {
      const message = r._0;
      cx.shared.emit_err(
        diagnostics.InvalidAlignmentValue_diagnostic({
          span: lit.span,
          error_part: message,
        }),
      );
    }
  },
};

export const RustcAlignParser: AttributeParser<RustcAlignParser> & typeof RustcAlignParser_inherent = {
  ...RustcAlignParser_inherent,
  ...AttributeParser_provided<RustcAlignParser>({
    default: () => ({ _0: undefined }),
    ATTRIBUTES: [
      [
        RustcAlignParser_inherent.PATH,
        RustcAlignParser_inherent.TEMPLATE,
        unstable(sym.fn_align),
        (self, cx, args) => RustcAlignParser_inherent.parse(self, cx, args),
      ],
    ],
    ALLOWED_TARGETS: {
      $: "AllowList",
      _0: [
        { $: "Allow", _0: Target.Fn },
        { $: "Allow", _0: { $: "Method", _0: MethodKind.Inherent } },
        { $: "Allow", _0: { $: "Method", _0: { $: "Trait", body: true } } },
        { $: "Allow", _0: { $: "Method", _0: MethodKind.TraitImpl } },
        { $: "Allow", _0: { $: "Method", _0: { $: "Trait", body: false } } }, // `#[align]` is inherited from trait methods
        { $: "Allow", _0: Target.ForeignFn },
      ],
    },

    // rustc: compiler/rustc_attr_parsing/src/attributes/repr.rs:320 finalize
    finalize(self, _cx) {
      if (self._0 === undefined) return undefined;
      const [align, span] = self._0;
      return { $: "RustcAlign", align: align, span: span._0 };
    },
  }),
};

/** `#[derive(Default)] pub(crate) struct RustcAlignStaticParser(RustcAlignParser)` */
export interface RustcAlignStaticParser {
  _0: RustcAlignParser;
}

/** `impl RustcAlignStaticParser` */
const RustcAlignStaticParser_inherent = {
  PATH: [sym.rustc_align_static] as readonly Symbol[],
  TEMPLATE: RustcAlignParser_inherent.TEMPLATE,

  // rustc: compiler/rustc_attr_parsing/src/attributes/repr.rs:333 parse
  parse(self: RustcAlignStaticParser, cx: AcceptContext, args: ArgParser): void {
    RustcAlignParser_inherent.parse(self._0, cx, args);
  },
};

export const RustcAlignStaticParser: AttributeParser<RustcAlignStaticParser> & typeof RustcAlignStaticParser_inherent = {
  ...RustcAlignStaticParser_inherent,
  ...AttributeParser_provided<RustcAlignStaticParser>({
    default: () => ({ _0: RustcAlignParser.default() }),
    ATTRIBUTES: [
      [
        RustcAlignStaticParser_inherent.PATH,
        RustcAlignStaticParser_inherent.TEMPLATE,
        unstable(sym.static_align),
        (self, cx, args) => RustcAlignStaticParser_inherent.parse(self, cx, args),
      ],
    ],
    ALLOWED_TARGETS: {
      $: "AllowList",
      _0: [
        { $: "Allow", _0: Target.Static },
        { $: "Allow", _0: Target.ForeignStatic },
      ],
    },

    // rustc: compiler/rustc_attr_parsing/src/attributes/repr.rs:344 finalize
    finalize(self, _cx) {
      if (self._0._0 === undefined) return undefined;
      const [align, span] = self._0._0;
      return { $: "RustcAlign", align: align, span: span._0 };
    },
  }),
};
