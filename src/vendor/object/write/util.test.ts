// Port of object 0.39.1 `src/write/util.rs` `mod tests`.
import { expect, test } from "bun:test";
import { Err, Ok } from "../../../std/result.ts";
import { write_at, write_sleb128, write_uleb128 } from "./util.ts";

/** `bytes_of(&u16::to_be(v))`. */
const be16 = (v: number): Uint8Array => Uint8Array.of((v >>> 8) & 0xff, v & 0xff);

// crate: object-0.39.1/src/write/util.rs:252 bytes_mut
test("bytes_mut", () => {
  const data = [0x01, 0x23, 0x45, 0x67];

  let bytes = Uint8Array.from([...data, ...be16(0x89ab)]);
  expect([...bytes]).toEqual([0x01, 0x23, 0x45, 0x67, 0x89, 0xab]);

  bytes = Uint8Array.from(data);
  expect(write_at(bytes, 0, be16(0x89ab))).toEqual(Ok(null));
  expect([...bytes]).toEqual([0x89, 0xab, 0x45, 0x67]);

  bytes = Uint8Array.from(data);
  expect(write_at(bytes, 2, be16(0x89ab))).toEqual(Ok(null));
  expect([...bytes]).toEqual([0x01, 0x23, 0x89, 0xab]);

  expect(write_at(bytes, 3, be16(0x89ab))).toEqual(Err(null));
  expect(write_at(bytes, 4, be16(0x89ab))).toEqual(Err(null));
  // `[].write_at(0, &u32::to_be(0x89ab))`
  expect(write_at(new Uint8Array(0), 0, Uint8Array.of(0, 0, 0x89, 0xab))).toEqual(Err(null));
});

test("LEB128 writers (DWARF spec examples)", () => {
  const u = (v: bigint): number[] => {
    const buf: number[] = [];
    expect(write_uleb128(buf, v)).toBe(buf.length);
    return buf;
  };
  const s = (v: bigint): number[] => {
    const buf: number[] = [];
    expect(write_sleb128(buf, v)).toBe(buf.length);
    return buf;
  };
  expect(u(2n)).toEqual([2]);
  expect(u(127n)).toEqual([127]);
  expect(u(128n)).toEqual([0x80, 1]);
  expect(u(129n)).toEqual([0x81, 1]);
  expect(u(130n)).toEqual([0x82, 1]);
  expect(u(12857n)).toEqual([0xb9, 100]);
  expect(u(0xffff_ffff_ffff_ffffn)).toEqual([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]);
  expect(s(2n)).toEqual([2]);
  expect(s(-2n)).toEqual([0x7e]);
  expect(s(127n)).toEqual([0xff, 0]);
  expect(s(-127n)).toEqual([0x81, 0x7f]);
  expect(s(128n)).toEqual([0x80, 1]);
  expect(s(-128n)).toEqual([0x80, 0x7f]);
  expect(s(129n)).toEqual([0x81, 1]);
  expect(s(-129n)).toEqual([0xff, 0x7e]);
  expect(s(-0x8000_0000_0000_0000n)).toEqual([0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x7f]);
});
