// rust-ts tests (lane abi-lib) for the small methods of rustc_abi lib.rs / callconv: the `Size` arithmetic and its
// exactness helpers (root decision: `Size` is a `number`; values beyond 2^53 - 1 stop as `unported`), `Scalar`,
// `Niche::reserve` / `available` (expected values from rustc's own `#[rustc_layout(debug)]` output in tests/ui, the
// oracle's), `BackendLaneCount`, `Step for Size`, `Reg`, `HomogeneousAggregate`.
import { expect, test } from "bun:test";
import {
  AbiAlign,
  AddressSpace,
  Align,
  BackendLaneCount,
  BackendRepr,
  FieldsShape,
  FIRST_VARIANT,
  Float,
  HomogeneousAggregate,
  Layout,
  LayoutData,
  Niche,
  NumScalableVectors,
  type Primitive,
  Primitive as PrimitiveC,
  Reg,
  RegKind,
  Scalar,
  Size,
  SIZE_BEYOND_2_53,
  Step_Size,
  TargetDataLayout,
  TyAndLayout,
  VariantLayout,
  WrappingRange,
  type HasDataLayout,
} from "./lib.ts";
import type { Hash64 } from "../rustc_hashes/lib.ts";
import { Panic, Unported } from "../std/panic.ts";

const dl = TargetDataLayout.default(); // 64-bit pointers: obj_size_bound = 2^61
const cx: HasDataLayout = { data_layout: () => dl };
const u8_: Primitive = { $: "Int", _0: "I8", _1: false };
const u16_: Primitive = { $: "Int", _0: "I16", _1: false };
const u32_: Primitive = { $: "Int", _0: "I32", _1: false };
const i32_: Primitive = { $: "Int", _0: "I32", _1: true };
const ptr: Primitive = { $: "Pointer", _0: 0 as never };
const init = (value: Primitive, start: bigint, end: bigint): Scalar => ({ $: "Initialized", value, valid_range: new WrappingRange(start, end) });

function throws(f: () => unknown): unknown {
  try {
    f();
  } catch (e) {
    return e;
  }
  throw new Error("did not throw");
}
const unported_ = (f: () => unknown) => {
  const e = throws(f);
  expect(e).toBeInstanceOf(Unported);
  expect((e as Unported).what).toBe(SIZE_BEYOND_2_53);
};
const panics = (f: () => unknown, msg: string) => {
  const e = throws(f);
  expect(e).toBeInstanceOf(Panic);
  expect((e as Panic).message).toBe(msg);
};

test("Size: exact up to 2^53 - 1, unported beyond, upstream's panics and None", () => {
  const MAX = Number.MAX_SAFE_INTEGER;
  expect(Size.from_bytes(MAX).bytes()).toBe(MAX);
  expect(Size.from_bytes(BigInt(MAX)).bytes()).toBe(MAX);
  unported_(() => Size.from_bytes(BigInt(MAX) + 1n));
  unported_(() => Size.from_bytes(2 ** 53)); // a `number` that may have been rounded
  panics(() => Size.from_bytes(-1), "called `Option::unwrap()` on a `None` value");
  panics(() => Size.from_bytes(1n << 64n), "called `Option::unwrap()` on a `None` value");
  // from_bits rounds up (div_ceil)
  expect(Size.from_bits(1).bytes()).toBe(1);
  expect(Size.from_bits(8).bytes()).toBe(1);
  expect(Size.from_bits(9).bytes()).toBe(2);
  unported_(() => Size.from_bits((1n << 64n) - 1n)); // 2^61 bytes
  // bits(): the bit count is a number too
  expect(Size.from_bytes(16).bits()).toBe(128);
  unported_(() => Size.from_bytes(2 ** 51).bits());
  // add / sub / mul / add_assign
  expect(Size.from_bytes(3).add(Size.from_bytes(4)).bytes()).toBe(7);
  expect(Size.from_bytes(3).add_assign(Size.from_bytes(4)).bytes()).toBe(7);
  unported_(() => Size.from_bytes(MAX).add(Size.from_bytes(1)));
  expect(Size.from_bytes(7).sub(Size.from_bytes(3)).bytes()).toBe(4);
  panics(() => Size.from_bytes(3).sub(Size.from_bytes(4)), "Size::sub: 3 - 4 would result in negative size");
  expect(Size.from_bytes(6).mul(7).bytes()).toBe(42);
  expect(Size.u64_mul(7n, Size.from_bytes(6)).bytes()).toBe(42);
  expect(Size.ZERO.mul((1n << 64n) - 1n).bytes()).toBe(0);
  panics(() => Size.from_bytes(2).mul(1n << 63n), "Size::mul: 2 * 9223372036854775808 doesn't fit in u64");
  unported_(() => Size.from_bytes(1).mul(1n << 60n));
  // checked_add / checked_mul: `None` at or above obj_size_bound (2^61) is exact; between 2^53 and 2^61 unported
  expect(dl.obj_size_bound()).toBe(2 ** 61);
  expect(Size.from_bytes(8).checked_mul(1000n, cx)!.bytes()).toBe(8000);
  expect(Size.from_bytes(8).checked_mul(1n << 58n, cx)).toBeUndefined(); // exactly 2^61
  expect(Size.from_bytes(1).checked_mul((1n << 64n) - 1n, cx)).toBeUndefined(); // [u8; usize::MAX]
  expect(Size.from_bytes(2).checked_mul((1n << 64n) - 1n, cx)).toBeUndefined(); // u64 overflow
  expect(Size.ZERO.checked_mul((1n << 64n) - 1n, cx)!.bytes()).toBe(0); // [(); usize::MAX]
  unported_(() => Size.from_bytes(1).checked_mul((1n << 61n) - 1n, cx)); // [u8; (1 << 61) - 1] fits rustc's bound
  expect(Size.from_bytes(MAX).checked_add(Size.from_bytes(0), cx)!.bytes()).toBe(MAX);
  unported_(() => Size.from_bytes(MAX).checked_add(Size.from_bytes(1), cx));
  // a 16-bit target: obj_size_bound = 2^15
  const dl16 = TargetDataLayout.parse_from_llvm_datalayout_string("e-m:e-p:16:16-i32:16-i64:16-f32:16-f64:16-a:8-n8:16-S16", AddressSpace.ZERO);
  expect(dl16.$).toBe("Ok");
  if (dl16.$ === "Ok") {
    expect(dl16._0.obj_size_bound()).toBe(2 ** 15);
    const cx16: HasDataLayout = { data_layout: () => dl16._0 };
    expect(Size.from_bytes(2 ** 15 - 1).checked_add(Size.ZERO, cx16)!.bytes()).toBe(2 ** 15 - 1);
    expect(Size.from_bytes(2 ** 15 - 1).checked_add(Size.from_bytes(1), cx16)).toBeUndefined();
  }
  // align_to / is_aligned
  expect(Size.from_bytes(5).align_to(new Align(3)).bytes()).toBe(8);
  expect(Size.from_bytes(8).is_aligned(new Align(3))).toBe(true);
  expect(Size.from_bytes(MAX - 7).align_to(new Align(3)).bytes()).toBe(MAX - 7); // 2^53 - 8 is 8-aligned
  unported_(() => Size.from_bytes(MAX - 6).align_to(new Align(3))); // rounds up to 2^53
});

test("Step for Size", () => {
  const s = (n: number) => Size.from_bytes(n);
  expect(Step_Size.steps_between(s(2), s(7))).toEqual([5, 5]);
  expect(Step_Size.steps_between(s(7), s(2))).toEqual([0, undefined]);
  expect(Step_Size.forward_checked(s(2), 3)!.bytes()).toBe(5);
  expect(Step_Size.backward_checked(s(2), 3)).toBeUndefined();
  expect(Step_Size.backward_checked(s(5), 3)!.bytes()).toBe(2);
  const [f, o] = Step_Size.forward_overflowing(s(2), 3);
  expect([f.bytes(), o]).toEqual([5, false]);
  expect(Step_Size.forward(s(2), 3).bytes()).toBe(5);
  expect(Step_Size.backward(s(5), 3).bytes()).toBe(2);
  // wrapping: 2 - 3 wraps to 2^64 - 1 bytes, which is beyond 2^53
  unported_(() => Step_Size.backward(s(2), 3));
  unported_(() => Step_Size.backward_overflowing(s(2), 3));
});

test("BackendLaneCount / NumScalableVectors", () => {
  const ok = BackendLaneCount.new(4n);
  expect(ok).toEqual({ $: "Ok", _0: 4 as BackendLaneCount });
  expect(BackendLaneCount.new(0n)).toEqual({ $: "Err", _0: { $: "ZeroLengthSimdType" } });
  expect(BackendLaneCount.new(32768n).$).toBe("Ok");
  expect(BackendLaneCount.new(32769n)).toEqual({ $: "Err", _0: { $: "OversizedSimdType", max_lanes: 32768 } });
  expect(BackendLaneCount.new(1n << 40n)).toEqual({ $: "Err", _0: { $: "OversizedSimdType", max_lanes: 32768 } });
  expect(BackendLaneCount.is_power_of_two(4 as BackendLaneCount)).toBe(true);
  expect(BackendLaneCount.is_power_of_two(3 as BackendLaneCount)).toBe(false);
  expect(BackendLaneCount.as_u64(3 as BackendLaneCount)).toBe(3n);
  expect(NumScalableVectors.for_non_tuple()).toBe(1 as NumScalableVectors);
  expect(NumScalableVectors.from_field_count(2)).toBe(2 as NumScalableVectors);
  expect(NumScalableVectors.from_field_count(7)).toBe(7 as NumScalableVectors);
  expect(NumScalableVectors.from_field_count(8)).toBeUndefined(); // `2..8` is exclusive upstream
  expect(NumScalableVectors.from_field_count(1)).toBeUndefined();
});

test("Primitive / Scalar", () => {
  expect(PrimitiveC.size(ptr, cx).bytes()).toBe(8);
  expect(PrimitiveC.size(i32_, cx).bytes()).toBe(4);
  expect(PrimitiveC.default_align(ptr, cx).abi.bytes()).toBe(8);
  expect(Float.align("F64", cx).abi.bytes()).toBe(8);
  const b = init(u8_, 0n, 1n);
  expect(Scalar.is_bool(b)).toBe(true);
  expect(Scalar.is_bool(init(u8_, 0n, 2n))).toBe(false);
  expect(Scalar.is_signed(init(i32_, 0n, 5n))).toBe(true);
  expect(Scalar.is_always_valid(init(i32_, 0n, 0xffff_ffffn), cx)).toBe(true);
  expect(Scalar.is_always_valid(init(u16_, 1n, 0n), cx)).toBe(true); // a non-canonical full range
  expect(Scalar.is_always_valid(b, cx)).toBe(false);
  const u = Scalar.to_union(b);
  expect(u).toEqual({ $: "Union", value: u8_ });
  expect(Scalar.is_uninit_valid(u)).toBe(true);
  expect(Scalar.valid_range(u, cx).end).toBe(255n);
  const m = init(u8_, 0n, 1n);
  const r = Scalar.valid_range_mut(m);
  r.value = r.value.with_end(5n);
  expect((m as { valid_range: WrappingRange }).valid_range.end).toBe(5n);
  panics(() => Scalar.valid_range_mut(u), "cannot change the valid range of a union");
  // BackendRepr
  const pair: BackendRepr = { $: "ScalarPair", a: init(i32_, 0n, 0xffff_ffffn), b: init(u8_, 0n, 1n), b_offset: Size.from_bytes(4) };
  expect(BackendRepr.scalar_size(pair, cx)!.bytes()).toBe(8); // (4 + 1) aligned to 4
  expect(BackendRepr.scalar_platform_align(pair, cx)!.bytes()).toBe(4);
  expect(BackendRepr.eq_up_to_validity(pair, BackendRepr.to_union(pair))).toBe(true);
  panics(() => BackendRepr.is_signed(pair), "`is_signed` on non-scalar ABI ScalarPair { a: i32 is .., b: u8 is 0..=1, b_offset: Size(4 bytes) }");
});

test("Niche::reserve / available match rustc's layouts (tests/ui `#[rustc_layout(debug)]` output)", () => {
  // Option<bool> (layout/debug.stderr): niche u8 0..=1 -> tag `u8 is 0..=2`, niche_start 2
  let n = Niche.from_scalar(cx, Size.ZERO, init(u8_, 0n, 1n))!;
  expect(n.available(cx)).toBe(254n);
  let [start, s] = n.reserve(cx, 1n)!;
  expect([start, (s as { valid_range: WrappingRange }).valid_range.start, (s as { valid_range: WrappingRange }).valid_range.end]).toEqual([2n, 0n, 2n]);
  // Option<char> (layout/debug.stderr:609): `u32 is (..=1114111) | (4294967295..)`, niche_start 4294967295
  n = Niche.from_scalar(cx, Size.ZERO, init(u32_, 0n, 1114111n))!;
  [start, s] = n.reserve(cx, 1n)!;
  expect([start, (s as { valid_range: WrappingRange }).valid_range.start, (s as { valid_range: WrappingRange }).valid_range.end]).toEqual([4294967295n, 4294967295n, 1114111n]);
  // Option<NonZero<u32>> (type/pattern_types/range_patterns.stderr:163): `u32 is ..`, niche_start 0
  n = Niche.from_scalar(cx, Size.ZERO, init(u32_, 1n, 0xffff_ffffn))!;
  [start, s] = n.reserve(cx, 1n)!;
  expect([start, (s as { valid_range: WrappingRange }).valid_range.start, (s as { valid_range: WrappingRange }).valid_range.end]).toEqual([0n, 0n, 0xffff_ffffn]);
  // Result<[u32; 0], Packed<U16IsZero>> (layout/zero-sized-array-enum-niche.stderr:265): `u16 is (..=0) | (65535..)`, niche_start 65535
  n = Niche.from_scalar(cx, Size.ZERO, init(u16_, 0n, 0n))!;
  [start, s] = n.reserve(cx, 1n)!;
  expect([start, (s as { valid_range: WrappingRange }).valid_range.start, (s as { valid_range: WrappingRange }).valid_range.end]).toEqual([65535n, 65535n, 0n]);
  // NicheFirst (layout/issue-96158-scalarpair-payload-might-be-uninit.stderr:247): HasNiche 0..=2, 2 niche variants ->
  // `u8 is 0..=4`, niche_start 3
  n = Niche.from_scalar(cx, Size.ZERO, init(u8_, 0n, 2n))!;
  [start, s] = n.reserve(cx, 2n)!;
  expect([start, (s as { valid_range: WrappingRange }).valid_range.start, (s as { valid_range: WrappingRange }).valid_range.end]).toEqual([3n, 0n, 4n]);
  // a full range has no niche; too many variants do not fit
  expect(Niche.from_scalar(cx, Size.ZERO, init(u8_, 0n, 255n))).toBeUndefined();
  expect(Niche.from_scalar(cx, Size.ZERO, { $: "Union", value: u8_ })).toBeUndefined();
  expect(new Niche(Size.ZERO, u8_, new WrappingRange(0n, 1n)).reserve(cx, 255n)).toBeUndefined();
});

const SEED = 0n as Hash64;
function scalar_layout(s: Scalar, size: number, align_pow2: number): LayoutData {
  return new LayoutData(FieldsShape.Primitive, { $: "Single", index: FIRST_VARIANT }, { $: "Scalar", _0: s }, undefined, false, new AbiAlign(new Align(align_pow2)), Size.from_bytes(size), undefined, new Align(align_pow2), false, SEED);
}

test("LayoutData / VariantLayout / FieldsShape methods", () => {
  const l = scalar_layout(init(u8_, 0n, 1n), 1, 0);
  expect([l.is_zst(), l.is_1zst(), l.is_sized(), l.is_aggregate(), l.is_ssa_standalone()]).toEqual([false, false, true, false, true]);
  expect(l.is_variant_uninhabited(FIRST_VARIANT)).toBe(false);
  expect(l.is_variant_uninhabited(1 as never)).toBe(true);
  const unit = new LayoutData({ $: "Arbitrary", offsets: [], in_memory_order: [] }, { $: "Single", index: FIRST_VARIANT }, { $: "Memory", sized: true }, undefined, false, new AbiAlign(Align.ONE), Size.ZERO, undefined, Align.ONE, false, SEED);
  expect([unit.is_zst(), unit.is_1zst(), unit.is_aggregate(), unit.is_ssa_standalone()]).toEqual([true, true, true, true]);
  expect(l.eq_abi(scalar_layout(init(u8_, 0n, 255n), 1, 0))).toBe(false); // is_bool differs
  expect(scalar_layout(init(u8_, 0n, 7n), 1, 0).eq_abi(scalar_layout(init(u8_, 0n, 255n), 1, 0))).toBe(true);
  const v = VariantLayout.from_layout(unit);
  expect([v.has_fields(), v.is_uninhabited()]).toEqual([false, false]);
  panics(() => VariantLayout.from_layout(l), "Layout of fields should be Arbitrary for variants");
  // FieldsShape
  const arb: FieldsShape = { $: "Arbitrary", offsets: [Size.from_bytes(4), Size.ZERO], in_memory_order: [1 as never, 0 as never] };
  expect(FieldsShape.count(arb)).toBe(2);
  expect(FieldsShape.offset(arb, 0).bytes()).toBe(4);
  expect(FieldsShape.index_by_increasing_offset(arb)).toEqual([1, 0]);
  expect(FieldsShape.index_by_increasing_offset(FieldsShape.Primitive)).toEqual([0]);
  const arr: FieldsShape = { $: "Array", stride: Size.from_bytes(4), count: 3n };
  expect(FieldsShape.offset(arr, 2).bytes()).toBe(8);
  panics(() => FieldsShape.offset(arr, 3), "tried to access field 3 of array with 3 fields");
  panics(() => FieldsShape.offset({ $: "Union", _0: 2 }, 2), "tried to access field 2 of union with 2 fields");
});

test("Reg / RegKind / HomogeneousAggregate", () => {
  expect(RegKind.from_primitive(ptr)).toBe(RegKind.Integer);
  expect(RegKind.from_primitive({ $: "Float", _0: "PpcF128" })).toBe(RegKind.PpcF128);
  expect(RegKind.from_primitive({ $: "Float", _0: "F32" })).toBe(RegKind.Float);
  expect(Reg.i32().align(cx).bytes()).toBe(4);
  expect(Reg.f64().align(cx).bytes()).toBe(8);
  expect(Reg.opaque_vector(Size.from_bytes(16)).kind).toEqual({ $: "Vector", hint_vector_elem: { $: "Int", _0: "I8", _1: true } });
  panics(() => new Reg(RegKind.Float, Size.from_bytes(3)).align(cx), "unsupported float: Reg { kind: Float, size: Size(3 bytes) }");
  const h = (r: Reg): HomogeneousAggregate => ({ $: "Homogeneous", _0: r });
  expect(HomogeneousAggregate.unit(h(Reg.i32()))!.size.bytes()).toBe(4);
  expect(HomogeneousAggregate.unit(HomogeneousAggregate.NoData)).toBeUndefined();
  expect(HomogeneousAggregate.merge(h(Reg.i32()), HomogeneousAggregate.NoData).$).toBe("Ok");
  expect(HomogeneousAggregate.merge(HomogeneousAggregate.NoData, h(Reg.i32()))).toEqual({ $: "Ok", _0: h(Reg.i32()) });
  expect(HomogeneousAggregate.merge(h(Reg.i32()), h(Reg.i32())).$).toBe("Ok");
  expect(HomogeneousAggregate.merge(h(Reg.i32()), h(Reg.f32()))).toEqual({ $: "Err", _0: null });
  // TyAndLayout::homogeneous_aggregate: the scalar case and the unsized case need no field access
  const tl = new TyAndLayout("f32", new Layout(scalar_layout(init({ $: "Float", _0: "F32" }, 0n, 0xffff_ffffn), 4, 2)));
  expect(tl.homogeneous_aggregate(cx)).toEqual({ $: "Ok", _0: h(new Reg(RegKind.Float, Size.from_bytes(4))) });
  const unsized = new LayoutData({ $: "Array", stride: Size.from_bytes(1), count: 0n }, { $: "Single", index: FIRST_VARIANT }, { $: "Memory", sized: false }, undefined, false, new AbiAlign(Align.ONE), Size.ZERO, undefined, Align.ONE, false, SEED);
  expect(new TyAndLayout("[u8]", new Layout(unsized)).homogeneous_aggregate(cx)).toEqual({ $: "Err", _0: null });
  // an empty array: `NoData`, total 0
  const empty = new LayoutData({ $: "Array", stride: Size.from_bytes(4), count: 0n }, { $: "Single", index: FIRST_VARIANT }, { $: "Memory", sized: true }, undefined, false, new AbiAlign(new Align(2)), Size.ZERO, undefined, new Align(2), false, SEED);
  expect(new TyAndLayout("[f32; 0]", new Layout(empty)).homogeneous_aggregate(cx)).toEqual({ $: "Ok", _0: HomogeneousAggregate.NoData });
});
