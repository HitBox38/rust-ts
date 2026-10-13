// Port of compiler/rustc_parse_format/src/tests.rs
// PORT: `assert_eq!` on `Vec<Piece>` / `Argument` uses the derived `PartialEq` (`Piece_eq`,
// `Argument_eq` in lib.ts); the Debug of both sides is compared too, so a failure shows the diff.
import { expect, test } from "bun:test";
import { debug_vec, PLAIN } from "../std/fmt.ts";
import { Str } from "../std/str.ts";
import { Argument, type Count, debug_Argument, debug_Piece, type FormatSpec, FormatSpec_default, Parser, type Piece, Piece_eq, Argument_eq } from "./lib.ts";

type Range = { start: number; end: number };
const rg = (start: number, end: number): Range => ({ start, end });
const Lit = (s: string): Piece => ({ $: "Lit", _0: s });
const NextArgument = (a: Argument): Piece => ({ $: "NextArgument", _0: a });
const CountImplied: Count = { $: "CountImplied" };

function assert_pieces(got: Piece[], want: Piece[]): void {
  expect(debug_vec(got, PLAIN, debug_Piece)).toBe(debug_vec(want, PLAIN, debug_Piece));
  expect(got.length === want.length && got.every((p, i) => Piece_eq(p, want[i]!))).toBe(true);
}

// rustc: compiler/rustc_parse_format/src/tests.rs:6 same
function same(fmt: string, p: Piece[]): void {
  const parser = Parser.new(Str.from(fmt), undefined, undefined, false, "Format");
  assert_pieces(parser.collect(), p);
}

// rustc: compiler/rustc_parse_format/src/tests.rs:11 fmtdflt
function fmtdflt(): FormatSpec {
  return {
    fill: undefined,
    fill_span: undefined,
    align: "AlignUnknown",
    sign: undefined,
    alternate: false,
    zero_pad: false,
    debug_hex: undefined,
    precision: CountImplied,
    width: CountImplied,
    precision_span: undefined,
    width_span: undefined,
    ty: "",
    ty_span: undefined,
  };
}

// rustc: compiler/rustc_parse_format/src/tests.rs:29 musterr
function musterr(s: string): void {
  const p = Parser.new(Str.from(s), undefined, undefined, false, "Format");
  p.next();
  expect(p.errors.length !== 0).toBe(true);
}

// rustc: compiler/rustc_parse_format/src/tests.rs:36 simple
test("simple", () => {
  same("asdf", [Lit("asdf")]);
  same("a{{b", [Lit("a"), Lit("{b")]);
  same("a}}b", [Lit("a"), Lit("}b")]);
  same("a}}", [Lit("a"), Lit("}")]);
  same("}}", [Lit("}")]);
  same("\\}}", [Lit("\\"), Lit("}")]);
});
// rustc: compiler/rustc_parse_format/src/tests.rs:45 invalid01
test("invalid01", () => {
  musterr("{");
});
// rustc: compiler/rustc_parse_format/src/tests.rs:49 invalid02
test("invalid02", () => {
  musterr("}");
});
// rustc: compiler/rustc_parse_format/src/tests.rs:53 invalid04
test("invalid04", () => {
  musterr("{3a}");
});
// rustc: compiler/rustc_parse_format/src/tests.rs:57 invalid05
test("invalid05", () => {
  musterr("{:|}");
});
// rustc: compiler/rustc_parse_format/src/tests.rs:61 invalid06
test("invalid06", () => {
  musterr("{:>>>}");
});

// rustc: compiler/rustc_parse_format/src/tests.rs:66 invalid_position
test("invalid_position", () => {
  musterr("{18446744073709551616}");
});

// rustc: compiler/rustc_parse_format/src/tests.rs:71 invalid_width
test("invalid_width", () => {
  musterr("{:18446744073709551616}");
});

// rustc: compiler/rustc_parse_format/src/tests.rs:76 invalid_precision
test("invalid_precision", () => {
  musterr("{:.18446744073709551616}");
});

// rustc: compiler/rustc_parse_format/src/tests.rs:81 format_empty
test("format_empty", () => {
  same("{}", [NextArgument(new Argument({ $: "ArgumentImplicitlyIs", _0: 0 }, rg(2, 2), fmtdflt()))]);
});
// rustc: compiler/rustc_parse_format/src/tests.rs:92 format_tab_empty
test("format_tab_empty", () => {
  const fmt_pre = '"\\t{}"';
  const fmt = "\t{}";
  const parser = Parser.new(Str.from(fmt), undefined, Str.from(fmt_pre), false, "Format");
  assert_pieces(parser.collect(), [Lit("\t"), NextArgument(new Argument({ $: "ArgumentImplicitlyIs", _0: 0 }, rg(4, 4), fmtdflt()))]);
});
// rustc: compiler/rustc_parse_format/src/tests.rs:109 format_open_brace_tab
test("format_open_brace_tab", () => {
  const fmt_pre = '"{\\t"';
  const fmt = "{\t";
  const parser = Parser.new(Str.from(fmt), undefined, Str.from(fmt_pre), false, "Format");
  parser.collect();
  expect(parser.errors[0]!.span).toEqual(rg(4, 4));
});
// rustc: compiler/rustc_parse_format/src/tests.rs:117 format_position
test("format_position", () => {
  same("{3}", [NextArgument(new Argument({ $: "ArgumentIs", _0: 3 }, rg(2, 3), fmtdflt()))]);
});
// rustc: compiler/rustc_parse_format/src/tests.rs:128 format_position_nothing_else
test("format_position_nothing_else", () => {
  same("{3:}", [NextArgument(new Argument({ $: "ArgumentIs", _0: 3 }, rg(2, 3), fmtdflt()))]);
});
// rustc: compiler/rustc_parse_format/src/tests.rs:139 format_named
test("format_named", () => {
  same("{name}", [NextArgument(new Argument({ $: "ArgumentNamed", _0: "name" }, rg(2, 6), fmtdflt()))]);
});
// rustc: compiler/rustc_parse_format/src/tests.rs:150 format_named_space_nothing
test("format_named_space_nothing", () => {
  same("{name} {}", [
    NextArgument(new Argument({ $: "ArgumentNamed", _0: "name" }, rg(2, 6), fmtdflt())),
    Lit(" "),
    NextArgument(new Argument({ $: "ArgumentImplicitlyIs", _0: 0 }, rg(9, 9), fmtdflt())),
  ]);
});
// rustc: compiler/rustc_parse_format/src/tests.rs:169 format_raw
test("format_raw", () => {
  const snippet = 'r#"assertion `left {op} right` failed"#';
  const source = "assertion `left {op} right` failed";

  const parser = Parser.new(Str.from(source), 1, Str.from(snippet), true, "Format");
  const expected = [
    Lit("assertion `left "),
    NextArgument(new Argument({ $: "ArgumentNamed", _0: "op" }, rg(20, 22), fmtdflt())),
    Lit(" right` failed"),
  ];
  assert_pieces(parser.collect(), expected);
});
// rustc: compiler/rustc_parse_format/src/tests.rs:186 format_type
test("format_type", () => {
  same("{3:x}", [NextArgument(new Argument({ $: "ArgumentIs", _0: 3 }, rg(2, 3), { ...fmtdflt(), ty: "x" }))]);
});
// rustc: compiler/rustc_parse_format/src/tests.rs:211 format_align_fill
test("format_align_fill", () => {
  same("{3:>}", [NextArgument(new Argument({ $: "ArgumentIs", _0: 3 }, rg(2, 3), { ...fmtdflt(), align: "AlignRight" }))]);
  same("{3:0<}", [
    NextArgument(new Argument({ $: "ArgumentIs", _0: 3 }, rg(2, 3), { ...fmtdflt(), fill: 0x30, fill_span: rg(4, 5), align: "AlignLeft" })),
  ]);
  same("{3:*<abcd}", [
    NextArgument(
      new Argument({ $: "ArgumentIs", _0: 3 }, rg(2, 3), {
        ...fmtdflt(),
        fill: 0x2a,
        fill_span: rg(4, 5),
        align: "AlignLeft",
        ty: "abcd",
        ty_span: rg(6, 10),
      }),
    ),
  ]);
});
// rustc: compiler/rustc_parse_format/src/tests.rs:280 format_counts
test("format_counts", () => {
  same("{:10x}", [
    NextArgument(
      new Argument({ $: "ArgumentImplicitlyIs", _0: 0 }, rg(2, 2), { ...fmtdflt(), width: { $: "CountIs", _0: 10 }, width_span: rg(3, 5), ty: "x" }),
    ),
  ]);
  same("{:10$.10x}", [
    NextArgument(
      new Argument({ $: "ArgumentImplicitlyIs", _0: 0 }, rg(2, 2), {
        ...fmtdflt(),
        precision: { $: "CountIs", _0: 10 },
        precision_span: rg(6, 9),
        width: { $: "CountIsParam", _0: 10 },
        width_span: rg(3, 6),
        ty: "x",
      }),
    ),
  ]);
  same("{1:0$.10x}", [
    NextArgument(
      new Argument({ $: "ArgumentIs", _0: 1 }, rg(2, 3), {
        ...fmtdflt(),
        precision: { $: "CountIs", _0: 10 },
        precision_span: rg(6, 9),
        width: { $: "CountIsParam", _0: 0 },
        width_span: rg(4, 6),
        ty: "x",
      }),
    ),
  ]);
  same("{:.*x}", [
    NextArgument(
      new Argument({ $: "ArgumentImplicitlyIs", _0: 1 }, rg(2, 2), {
        ...fmtdflt(),
        precision: { $: "CountIsStar", _0: 0 },
        precision_span: rg(3, 5),
        ty: "x",
      }),
    ),
  ]);
  same("{:.10$x}", [
    NextArgument(
      new Argument({ $: "ArgumentImplicitlyIs", _0: 0 }, rg(2, 2), {
        ...fmtdflt(),
        precision: { $: "CountIsParam", _0: 10 },
        precision_span: rg(3, 7),
        ty: "x",
      }),
    ),
  ]);
  same("{:a$.b$?}", [
    NextArgument(
      new Argument({ $: "ArgumentImplicitlyIs", _0: 0 }, rg(2, 2), {
        ...fmtdflt(),
        precision: { $: "CountIsName", _0: "b", _1: rg(6, 7) },
        precision_span: rg(5, 8),
        width: { $: "CountIsName", _0: "a", _1: rg(3, 4) },
        width_span: rg(3, 5),
        ty: "?",
      }),
    ),
  ]);
  same("{:.4}", [
    NextArgument(
      new Argument({ $: "ArgumentImplicitlyIs", _0: 0 }, rg(2, 2), { ...fmtdflt(), precision: { $: "CountIs", _0: 4 }, precision_span: rg(3, 5) }),
    ),
  ]);
});
// rustc: compiler/rustc_parse_format/src/tests.rs:437 format_flags
test("format_flags", () => {
  same("{:-}", [NextArgument(new Argument({ $: "ArgumentImplicitlyIs", _0: 0 }, rg(2, 2), { ...fmtdflt(), sign: "Minus" }))]);
  same("{:+#}", [NextArgument(new Argument({ $: "ArgumentImplicitlyIs", _0: 0 }, rg(2, 2), { ...fmtdflt(), sign: "Plus", alternate: true }))]);
});
// rustc: compiler/rustc_parse_format/src/tests.rs:484 format_mixture
test("format_mixture", () => {
  same("abcd {3:x} efg", [
    Lit("abcd "),
    NextArgument(new Argument({ $: "ArgumentIs", _0: 3 }, rg(7, 8), { ...fmtdflt(), ty: "x" })),
    Lit(" efg"),
  ]);
});
// rustc: compiler/rustc_parse_format/src/tests.rs:513 format_whitespace
test("format_whitespace", () => {
  same("{ }", [NextArgument(new Argument({ $: "ArgumentImplicitlyIs", _0: 0 }, rg(2, 3), fmtdflt()))]);
  same("{  }", [NextArgument(new Argument({ $: "ArgumentImplicitlyIs", _0: 0 }, rg(2, 4), fmtdflt()))]);
});
// rustc: compiler/rustc_parse_format/src/tests.rs:532 asm_linespans
test("asm_linespans", () => {
  const asm_pre = 'r"\n        .intel_syntax noprefix\n        nop"';
  const asm = "\n        .intel_syntax noprefix\n        nop";
  const parser = Parser.new(Str.from(asm), 0, Str.from(asm_pre), false, "InlineAsm");
  expect(parser.is_source_literal).toBe(true);
  assert_pieces(parser.collect(), [Lit("\n        .intel_syntax noprefix\n        nop")]);
  expect(parser.line_spans).toEqual([rg(2, 2), rg(11, 33), rg(42, 45)]);
});
// rustc: compiler/rustc_parse_format/src/tests.rs:548 asm_concat
test("asm_concat", () => {
  const asm_pre = 'concat!("invalid", "_", "instruction")';
  const asm = "invalid_instruction";
  const parser = Parser.new(Str.from(asm), undefined, Str.from(asm_pre), false, "InlineAsm");
  expect(parser.is_source_literal).toBe(false);
  assert_pieces(parser.collect(), [Lit(asm)]);
  expect(parser.line_spans).toEqual([]);
});

function single_arg(pieces: Piece[]): Argument {
  const [p] = pieces;
  if (pieces.length !== 1 || p === undefined || p.$ !== "NextArgument") throw new Error("explicit panic");
  return p._0;
}

// rustc: compiler/rustc_parse_format/src/tests.rs:558 diagnostic_format_flags
test("diagnostic_format_flags", () => {
  const lit = "{thing:blah}";
  const parser = Parser.new(Str.from(lit), undefined, undefined, false, "Diagnostic");
  expect(parser.is_source_literal).toBe(false);

  const arg = single_arg(parser.collect());

  const want = new Argument({ $: "ArgumentNamed", _0: "thing" }, rg(2, 7), { ...FormatSpec_default(), ty: "blah", ty_span: rg(7, 12) });
  expect(debug_Argument(arg, PLAIN)).toBe(debug_Argument(want, PLAIN));
  expect(Argument_eq(arg, want)).toBe(true);

  expect(parser.line_spans).toEqual([]);
  expect(parser.errors.length).toBe(0);
});

// rustc: compiler/rustc_parse_format/src/tests.rs:579 diagnostic_format_mod
test("diagnostic_format_mod", () => {
  const lit = "{thing:+}";
  const parser = Parser.new(Str.from(lit), undefined, undefined, false, "Diagnostic");
  expect(parser.is_source_literal).toBe(false);

  const arg = single_arg(parser.collect());

  const want = new Argument({ $: "ArgumentNamed", _0: "thing" }, rg(2, 7), { ...FormatSpec_default(), ty: "+", ty_span: rg(7, 9) });
  expect(debug_Argument(arg, PLAIN)).toBe(debug_Argument(want, PLAIN));
  expect(Argument_eq(arg, want)).toBe(true);

  expect(parser.line_spans).toEqual([]);
  expect(parser.errors.length).toBe(0);
});
// rustc: compiler/rustc_parse_format/src/tests.rs:599 format_plus_sign_missing_colon_error
test("format_plus_sign_missing_colon_error", () => {
  // `{+}` should produce an error suggesting `:` before `+`
  const p = Parser.new(Str.from("{+}"), undefined, undefined, false, "Format");
  p.collect();
  expect(p.errors.length !== 0).toBe(true);
  expect(p.errors[0]!.description.includes("`+` sign flag must appear after `:`")).toBe(true);
  expect(p.errors[0]!.label.includes("expected `:` before `+` sign flag")).toBe(true);
  expect(p.errors[0]!.span).toEqual(rg(2, 3));
});
