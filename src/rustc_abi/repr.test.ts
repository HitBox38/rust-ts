// Lane repr-options: rustc_abi `ReprFlags` / `IntegerType` / `ReprOptions` and the `Size` / `Align` / `Integer` /
// `TargetDataLayout` helpers they brought in. The `ReprOptions` Debug and predicates are also checked against the
// oracle (src/rustc_middle/ty/repr.oracle.test.ts).
import { describe, expect, test } from "bun:test";
import { Hash64 } from "../rustc_hashes/lib.ts";
import { PLAIN, PRETTY } from "../std/fmt.ts";
import {
  AbiAlign,
  Align,
  Align_max,
  Align_min,
  debug_AbiAlign,
  debug_IntegerType,
  debug_ReprFlags,
  debug_ReprOptions,
  Integer,
  IntegerType,
  ReprFlags,
  ReprOptions,
  ReprOptions_eq,
  ScalableElt,
  Size,
  TargetDataLayout,
} from "./lib.ts";

describe("ReprFlags", () => {
  test("Debug writes flag names in declaration order, then unknown bits in hex", () => {
    expect(debug_ReprFlags(ReprFlags.empty(), PLAIN)).toBe("");
    expect(debug_ReprFlags(ReprFlags.union(ReprFlags.IS_SIMD, ReprFlags.IS_C), PLAIN)).toBe("IS_C | IS_SIMD");
    expect(debug_ReprFlags(ReprFlags.from_bits_retain(0x80), PLAIN)).toBe("0x80");
    expect(debug_ReprFlags(ReprFlags.from_bits_retain(0x84), PLAIN)).toBe("IS_TRANSPARENT | 0x80");
    expect(ReprFlags.FIELD_ORDER_UNOPTIMIZABLE as number).toBe(0b0100_1011);
    expect(ReprFlags.ABI_UNOPTIMIZABLE as number).toBe(0b11);
  });
});

describe("ReprOptions", () => {
  const seed = Hash64.new(7n);
  const mk = (int: IntegerType | undefined, flags: ReprFlags, pack?: Align) => new ReprOptions(int, undefined, pack, flags, undefined, seed);
  test("predicates", () => {
    const linear = mk(undefined, ReprFlags.IS_LINEAR);
    expect([linear.rust(), linear.linear(), linear.inhibit_struct_field_reordering()]).toEqual([true, true, true]);
    const rnd = mk(undefined, ReprFlags.RANDOMIZE_LAYOUT);
    expect(rnd.can_randomize_type_layout()).toBe(true);
    expect(mk({ $: "Fixed", _0: "I8", _1: false }, ReprFlags.RANDOMIZE_LAYOUT).can_randomize_type_layout()).toBe(false);
    expect(debug_IntegerType(mk(undefined, ReprFlags.empty()).discr_type(), PLAIN)).toBe("Pointer(true)");
    expect(IntegerType.is_signed({ $: "Fixed", _0: "I16", _1: false })).toBe(false);
    expect(IntegerType.is_signed({ $: "Pointer", _0: true })).toBe(true);
  });
  test("equal_up_to_seed / PartialEq", () => {
    const a = mk({ $: "Fixed", _0: "I32", _1: true }, ReprFlags.IS_C, new Align(1));
    const b = new ReprOptions({ $: "Fixed", _0: "I32", _1: true }, undefined, new Align(1), ReprFlags.IS_C, undefined, Hash64.new(8n));
    expect(a.equal_up_to_seed(b)).toBe(true);
    expect(ReprOptions_eq(a, b)).toBe(false);
    expect(a.equal_up_to_seed(mk({ $: "Fixed", _0: "I32", _1: true }, ReprFlags.IS_C, new Align(2)))).toBe(false);
    const s = new ReprOptions(undefined, undefined, undefined, ReprFlags.IS_SCALABLE, ScalableElt.Container, seed);
    expect(s.equal_up_to_seed(new ReprOptions(undefined, undefined, undefined, ReprFlags.IS_SCALABLE, { $: "ElementCount", _0: 2 }, seed))).toBe(false);
  });
  test("Debug {:#?}", () => {
    const r = new ReprOptions({ $: "Fixed", _0: "I8", _1: false }, new Align(3), undefined, ReprFlags.IS_C, { $: "ElementCount", _0: 4 }, seed);
    expect(debug_ReprOptions(r, PRETTY)).toBe(
      [
        "ReprOptions {",
        "    int: Some(",
        "        Fixed(",
        "            I8,",
        "            false,",
        "        ),",
        "    ),",
        "    align: Some(",
        "        Align(8 bytes),",
        "    ),",
        "    pack: None,",
        "    flags: IS_C,",
        "    scalable: Some(",
        "        ElementCount(",
        "            4,",
        "        ),",
        "    ),",
        "    field_shuffle_seed: 7,",
        "}",
      ].join("\n"),
    );
  });
});

describe("Size / Align / Integer helpers", () => {
  test("Size::sign_extend / truncate / int bounds", () => {
    const s1 = Size.from_bytes(1);
    expect(s1.sign_extend(0xffn)).toBe(-1n);
    expect(s1.sign_extend(0x17fn)).toBe(127n);
    expect(s1.truncate(0x1ffn)).toBe(0xffn);
    expect(Size.ZERO.sign_extend(5n)).toBe(0n);
    expect([s1.signed_int_min(), s1.signed_int_max(), s1.unsigned_int_max()]).toEqual([-128n, 127n, 255n]);
    const s16 = Size.from_bytes(16);
    expect(s16.signed_int_min()).toBe(-(1n << 127n));
    expect(s16.unsigned_int_max()).toBe((1n << 128n) - 1n);
    expect(s16.sign_extend((1n << 128n) - 2n)).toBe(-2n);
  });
  test("Size::align_to / is_aligned / checked_add / checked_mul", () => {
    const dl = TargetDataLayout.default();
    expect(Size.from_bytes(5).align_to(new Align(2)).bytes()).toBe(8);
    expect(Size.from_bytes(8).is_aligned(new Align(3))).toBe(true);
    expect(Size.from_bytes(12).is_aligned(new Align(3))).toBe(false);
    expect(Size.from_bytes(3).checked_add(Size.from_bytes(4), dl)!.bytes()).toBe(7);
    expect(Size.from_bytes(2 ** 40).checked_mul(2 ** 30, dl)).toBeUndefined();
  });
  test("Align helpers", () => {
    expect(Align.max_aligned_factor(Size.from_bytes(24)).bytes()).toBe(8);
    expect(new Align(4).restrict_for_offset(Size.from_bytes(6)).bytes()).toBe(2);
    expect(Align_min(new Align(1), new Align(3)).pow2).toBe(1);
    expect(Align_max(new Align(1), new Align(3)).pow2).toBe(3);
    expect(debug_AbiAlign(AbiAlign.new(new Align(2)).max(AbiAlign.new(new Align(1))), PLAIN)).toBe("AbiAlign { abi: Align(4 bytes) }");
    expect(Align.max_for_target(TargetDataLayout.default()).pow2).toBe(29);
  });
  test("Integer", () => {
    const dl = TargetDataLayout.default();
    expect([Integer.int_ty_str("I8"), Integer.uint_ty_str("I128")]).toEqual(["i8", "u128"]);
    expect(Integer.size("I64").bytes()).toBe(8);
    expect(Integer.from_attr(dl, { $: "Pointer", _0: true })).toBe(dl.ptr_sized_integer());
    expect(Integer.from_attr(dl, { $: "Fixed", _0: "I16", _1: false })).toBe("I16");
    expect([Integer.signed_min("I8"), Integer.signed_max("I64")]).toEqual([-128n, (1n << 63n) - 1n]);
    expect([Integer.fit_signed(-129n), Integer.fit_signed(127n), Integer.fit_signed(1n << 63n)]).toEqual(["I16", "I8", "I128"]);
    expect([Integer.fit_unsigned(256n), Integer.fit_unsigned(0xffff_ffffn)]).toEqual(["I16", "I32"]);
    // default layout: i64 / i128 are 4-byte aligned
    expect(Integer.for_align(dl, new Align(2))).toBe("I32");
    expect(Integer.for_align(dl, new Align(3))).toBeUndefined();
    expect(Integer.approximate_align(dl, new Align(3))).toBe("I64");
    expect(Integer.approximate_align(dl, new Align(1))).toBe("I16");
    expect(Integer.approximate_align(dl, new Align(0))).toBe("I8");
  });
});
