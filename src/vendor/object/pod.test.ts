// Port of the `#[cfg(test)] mod tests` of object 0.39.1 `src/pod.rs` (the read half: the
// `_mut` and `bytes_of*` assertions belong to the unported write half).
import { expect, test } from "bun:test";
import { from_bytes, pod_bytes, pod_scalar, slice_from_all_bytes, slice_from_bytes } from "./pod.ts";

// `u16` / `u32` in the (little-endian) host byte order.
// `u16` / `u32` keep their Rust alignment (2 / 4) so the alignment checks are exercised.
const u16 = { ...pod_scalar(2, (d, o) => d[o]! | (d[o + 1]! << 8)), align: 2 };
const u32 = { ...pod_scalar(4, (d, o) => (d[o]! | (d[o + 1]! << 8) | (d[o + 2]! << 16) | (d[o + 3]! << 24)) >>> 0), align: 4 };
const to_be16 = (x: number): number => ((x & 0xff) << 8) | (x >>> 8);
const to_be32 = (x: number): number => (((x & 0xff) << 24) | ((x & 0xff00) << 8) | ((x >>> 8) & 0xff00) | (x >>> 24)) >>> 0;

// crate: object-0.39.1/src/pod.rs:219 single
test("single", () => {
  const x = to_be32(0x0123_4567);
  const bytes = new Uint8Array([0x01, 0x23, 0x45, 0x67]);
  const x16 = [to_be16(0x0123), to_be16(0x4567)];

  let r = from_bytes(u32, bytes);
  expect(r.$).toBe("Ok");
  if (r.$ === "Ok") {
    expect(r._0[0]).toBe(x);
    expect(r._0[1].length).toBe(0);
  }

  r = from_bytes(u16, bytes);
  if (r.$ !== "Ok") throw new globalThis.Error("from_bytes");
  expect(r._0[0]).toBe(x16[0]);
  expect([...r._0[1]]).toEqual([...bytes.subarray(2)]);

  r = from_bytes(u16, bytes.subarray(2));
  if (r.$ !== "Ok") throw new globalThis.Error("from_bytes");
  expect(r._0[0]).toBe(x16[1]);
  expect(r._0[1].length).toBe(0);

  expect(from_bytes(u16, bytes.subarray(1)).$).toBe("Err");
  expect(from_bytes(u16, bytes.subarray(3)).$).toBe("Err");
  expect(from_bytes(u16, bytes.subarray(4)).$).toBe("Err");
});

// crate: object-0.39.1/src/pod.rs:259 slice
test("slice", () => {
  const x = [to_be16(0x0123), to_be16(0x4567), to_be16(0x89ab), to_be16(0xcdef)];
  const bytes = new Uint8Array([0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef]);

  let r = slice_from_bytes(u16, bytes, 4);
  if (r.$ !== "Ok") throw new globalThis.Error("slice_from_bytes");
  expect([...r._0[0]]).toEqual(x);
  expect(r._0[1].length).toBe(0);

  r = slice_from_bytes(u16, bytes.subarray(2), 2);
  if (r.$ !== "Ok") throw new globalThis.Error("slice_from_bytes");
  expect([...r._0[0]]).toEqual(x.slice(1, 3));
  expect([...r._0[1]]).toEqual([...bytes.subarray(6)]);

  expect(slice_from_bytes(u16, bytes, 5).$).toBe("Err");
  expect(slice_from_bytes(u16, bytes.subarray(2), 4).$).toBe("Err");
  expect(slice_from_bytes(u16, bytes.subarray(1), 2).$).toBe("Err");
});

// crate: object-0.39.1/src/pod.rs:296 slice_zero
test("slice_zero", () => {
  expect(slice_from_all_bytes(pod_bytes(0), new Uint8Array(0)).$).toBe("Err");
});
