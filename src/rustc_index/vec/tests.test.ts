// Port of compiler/rustc_index/src/vec/tests.rs.
//
// PORT: `MyIdx` is a `newtype_index!` handle (src/rustc_index/newtype_index.ts); its `Step` impl makes
// `MyIdx::from_u32(1)..MyIdx::from_u32(4)` iterate the handle numbers, which is `range_iter` here.
import { expect, test } from "bun:test";
import { range, range_iter } from "../idx.ts";
import { newtype_index } from "../newtype_index.ts";

// crate::newtype_index! {
//     #[orderable]
//     #[max = 0xFFFF_FFFA]
//     struct MyIdx {}
// }
type MyIdx = number & { readonly __brand: "MyIdx" };
const MyIdx = newtype_index<MyIdx>((n) => `MyIdx(${n})`, 0xffff_fffa, "0xFFFF_FFFA");

// rustc-skip: compiler/rustc_index/src/vec/tests.rs:11 index_size_is_optimized `size_of` / niche layout of `Option<MyIdx>`: a branded number has no Rust layout

// rustc: compiler/rustc_index/src/vec/tests.rs:28 range_iterator_iterates_forwards
test("range_iterator_iterates_forwards", () => {
  const r = range(MyIdx.from_u32(1), MyIdx.from_u32(4));
  expect([...range_iter(r)]).toEqual([MyIdx.from_u32(1), MyIdx.from_u32(2), MyIdx.from_u32(3)]);
});

// rustc: compiler/rustc_index/src/vec/tests.rs:37 range_iterator_iterates_backwards
test("range_iterator_iterates_backwards", () => {
  const r = range(MyIdx.from_u32(1), MyIdx.from_u32(4));
  expect([...range_iter(r)].reverse()).toEqual([MyIdx.from_u32(3), MyIdx.from_u32(2), MyIdx.from_u32(1)]);
});

// rustc: compiler/rustc_index/src/vec/tests.rs:46 range_count_is_correct
test("range_count_is_correct", () => {
  const r = range(MyIdx.from_u32(1), MyIdx.from_u32(4));
  expect([...range_iter(r)].length).toBe(3);
});

// rustc: compiler/rustc_index/src/vec/tests.rs:52 range_size_hint_is_correct
test("range_size_hint_is_correct", () => {
  const r = range(MyIdx.from_u32(1), MyIdx.from_u32(4));
  // `Range::size_hint`: `(end - start, Some(end - start))` for a `Step` type.
  const s = r.start_bound;
  const e = r.end_bound;
  const n = s.$ === "Included" && e.$ === "Excluded" ? e._0 - s._0 : -1;
  expect([n, n]).toEqual([3, 3]);
});
