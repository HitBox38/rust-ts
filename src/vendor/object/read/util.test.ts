// Port of the `#[cfg(test)] mod tests` of object 0.39.1 `src/read/util.rs`.
import { expect, test } from "bun:test";
import { PLAIN } from "../../../std/fmt.ts";
import { pod_bytes, pod_scalar, pod_u8 } from "../pod.ts";
import { Bytes, Bytes_eq, debug_Bytes } from "./util.ts";

const u16 = pod_scalar(2, (d, o) => d[o]! | (d[o + 1]! << 8));
const u32 = pod_scalar(4, (d, o) => (d[o]! | (d[o + 1]! << 8) | (d[o + 2]! << 16) | (d[o + 3]! << 24)) >>> 0);
const u64 = pod_bytes(8);
const to_be16 = (x: number): number => ((x & 0xff) << 8) | (x >>> 8);
const b = (...x: number[]): Bytes => new Bytes(new Uint8Array(x));
const eq = (x: Bytes, y: Bytes): void => expect(Bytes_eq(x, y)).toBe(true);
const copy = (x: Bytes): Bytes => new Bytes(x._0);

// crate: object-0.39.1/src/read/util.rs:325 bytes
test("bytes", () => {
  const x = 0x6745_2301; // u32::to_be(0x0123_4567) on the little-endian host
  let data = b(0x01, 0x23, 0x45, 0x67);

  let bytes = copy(data);
  expect(bytes.skip(0).$).toBe("Ok");
  eq(bytes, data);

  bytes = copy(data);
  expect(bytes.skip(4).$).toBe("Ok");
  eq(bytes, b());

  bytes = copy(data);
  expect(bytes.skip(5).$).toBe("Err");
  eq(bytes, b());

  bytes = copy(data);
  let r = bytes.read_bytes(0);
  expect(r.$ === "Ok" && Bytes_eq(r._0, b())).toBe(true);
  eq(bytes, data);

  bytes = copy(data);
  r = bytes.read_bytes(4);
  expect(r.$ === "Ok" && Bytes_eq(r._0, data)).toBe(true);
  eq(bytes, b());

  bytes = copy(data);
  expect(bytes.read_bytes(5).$).toBe("Err");
  eq(bytes, b());

  r = data.read_bytes_at(0, 0);
  expect(r.$ === "Ok" && Bytes_eq(r._0, b())).toBe(true);
  r = data.read_bytes_at(4, 0);
  expect(r.$ === "Ok" && Bytes_eq(r._0, b())).toBe(true);
  r = data.read_bytes_at(0, 4);
  expect(r.$ === "Ok" && Bytes_eq(r._0, data)).toBe(true);
  expect(data.read_bytes_at(1, 4).$).toBe("Err");

  bytes = copy(data);
  expect(bytes.read(u16)).toEqual({ $: "Ok", _0: to_be16(0x0123) });
  eq(bytes, b(0x45, 0x67));
  expect(data.read_at(u16, 2)).toEqual({ $: "Ok", _0: to_be16(0x4567) });
  expect(data.read_at(u16, 3).$).toBe("Err");
  expect(data.read_at(u16, 4).$).toBe("Err");

  bytes = copy(data);
  expect(bytes.read(u32)).toEqual({ $: "Ok", _0: x });
  eq(bytes, b());

  bytes = copy(data);
  expect(bytes.read(u64).$).toBe("Err");
  eq(bytes, b());

  bytes = copy(data);
  let s = bytes.read_slice(pod_u8, 0);
  expect(s.$ === "Ok" && s._0.length === 0).toBe(true);
  eq(bytes, data);

  bytes = copy(data);
  s = bytes.read_slice(pod_u8, 4);
  expect(s.$ === "Ok" && [...s._0]).toEqual([...data._0]);
  eq(bytes, b());

  bytes = copy(data);
  expect(bytes.read_slice(pod_u8, 5).$).toBe("Err");
  eq(bytes, b());

  s = data.read_slice_at(pod_u8, 0, 0);
  expect(s.$ === "Ok" && s._0.length === 0).toBe(true);
  s = data.read_slice_at(pod_u8, 4, 0);
  expect(s.$ === "Ok" && s._0.length === 0).toBe(true);
  s = data.read_slice_at(pod_u8, 0, 4);
  expect(s.$ === "Ok" && [...s._0]).toEqual([...data._0]);
  expect(data.read_slice_at(pod_u8, 1, 4).$).toBe("Err");

  data = b(0x01, 0x02, 0x00, 0x04);

  bytes = copy(data);
  let t = bytes.read_string();
  expect(t.$ === "Ok" && [...t._0]).toEqual([0x01, 0x02]);
  expect([...bytes._0]).toEqual([0x04]);

  bytes = copy(data);
  bytes.skip(3);
  expect(bytes.read_string().$).toBe("Err");
  expect(bytes._0.length).toBe(0);

  t = data.read_string_at(0);
  expect(t.$ === "Ok" && [...t._0]).toEqual([0x01, 0x02]);
  t = data.read_string_at(1);
  expect(t.$ === "Ok" && [...t._0]).toEqual([0x02]);
  t = data.read_string_at(2);
  expect(t.$ === "Ok" && t._0.length === 0).toBe(true);
  expect(data.read_string_at(3).$).toBe("Err");
});

// crate: object-0.39.1/src/read/util.rs:408 bytes_debug
test("bytes_debug", () => {
  expect(debug_Bytes(b(), PLAIN)).toBe("[]");
  expect(debug_Bytes(b(0x01), PLAIN)).toBe("[0x01]");
  expect(debug_Bytes(b(0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08), PLAIN)).toBe("[0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]");
  expect(debug_Bytes(b(0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09), PLAIN)).toBe(
    "[0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, ...; 9]",
  );
});
