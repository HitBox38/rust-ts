// Lane mir-interp-a tests for mir/interpret/allocation.rs, allocation/init_mask.rs and allocation/provenance_map.rs
// (upstream's own unit tests are allocation/init_mask/tests.test.ts). Expected values are worked out by hand from the
// upstream code at the pin (u64 blocks: `InitMaskMaterialized::grow` allocates `amount / 64 + 1` blocks, ...).
// The scalar read/write tests need lane mir-interp-b's `Scalar` / `Pointer` / `read_target_uint` / `write_target_uint`:
// they are skipped while those are still stubs (`interp_b_ported`).
import { describe, expect, test } from "bun:test";
import "../mod.ts";
import { Align, Size, TargetDataLayout } from "../../../rustc_abi/lib.ts";
import { MemDecoder } from "../../../rustc_serialize/opaque.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { Panic, Unported } from "../../../std/panic.ts";
import type { Result } from "../../../std/result.ts";
import type { Hasher } from "../../../vendor/rustc_stable_hash/lib.ts";
import {
  type AllocError,
  AllocError as AllocError_,
  AllocRange,
  AllocRange_from_Range_usize,
  Allocation,
  alloc_range,
  all_zero,
  ConstAllocation,
  debug_ConstAllocation,
  decode_AllocFlags,
  decode_InitMaskMaterialized,
  display_AllocRange,
  hash_InitMaskMaterialized,
  InitChunk,
  InitMask,
  InitMaskMaterialized,
  ProvenanceMap,
} from "./allocation.ts";
import type { AllocId } from "./mod.ts";
import { read_target_uint, write_target_uint } from "./mod.ts";
import { type CtfeProvenance, Pointer } from "./pointer.ts";
import { Scalar } from "./value.ts";

const S = (n: number): Size => Size.from_bytes(n);
const rg = (start: number, end: number): AllocRange => AllocRange_from_Range_usize({ start, end });
const r_ = (r: AllocRange): string => `${r.start.bytes()}..${r.end().bytes()}`;
const dl_big = TargetDataLayout.default(); // 64-bit pointers, big-endian
const dl = TargetDataLayout.default();
dl.endian = "Little";
const cx = { data_layout: () => dl };
const p1 = 0x11n as CtfeProvenance;
const p2 = 0x22n as CtfeProvenance;
const data40 = (): Uint8Array => Uint8Array.from({ length: 40 }, (_, i) => i);
const words = (m: InitMask): number[] | "lazy" => (m.blocks.$ === "Lazy" ? "lazy" : m.blocks._0.blocks);
const chunks = (m: InitMask, r: AllocRange): string[] =>
  [...m.range_as_init_chunks(r)].map((c) => `${InitChunk.is_init(c) ? "I" : "U"}${InitChunk.range(c).start.bytes()}..${InitChunk.range(c).end.bytes()}`);
/** A `MemDecoder` over `bytes` (without the `MAGIC_END_BYTES` suffix `MemDecoder::new` strips). */
function mem_decoder(bytes: number[]): MemDecoder {
  const data = Uint8Array.from(bytes);
  return new MemDecoder(data, 0, 0, data.length);
}
function panics(f: () => unknown): string {
  try {
    f();
  } catch (e) {
    if (e instanceof Panic) return e.message;
    throw e;
  }
  return "no panic";
}

describe("InitMask (u64 blocks as 32-bit word pairs, plan-m4 D6)", () => {
  test("materialized blocks hold exactly upstream's u64 bits (count and trailing bits)", () => {
    // `new(64, _)`: `grow(0, 64)` allocates `64 / 64 + 1 = 2` blocks
    expect(InitMaskMaterialized.new(S(64), false).blocks).toEqual([0, 0, 0, 0]);
    // `new(16, true)`: one block of `u64::MAX` (trailing bits past `len` set too)
    expect(InitMaskMaterialized.new(S(16), true).blocks).toEqual([0xffff_ffff, 0xffff_ffff]);
    // `set_range(8..16, true)` on a lazy uninit mask: block 0 = (MAX << 8) & (MAX >> 48) = 0xff00
    const m = InitMask.new(S(16), false);
    m.set_range(rg(8, 16), true);
    expect(words(m)).toEqual([0xff00, 0]);
    // a range across the 32-bit word boundary: bits 30..40 of block 0
    const n = InitMask.new(S(100), false);
    n.set_range(rg(30, 40), true);
    expect(words(n)).toEqual([0xc000_0000, 0xff, 0, 0]);
  });

  test("set_range_inbounds with start == end on a block boundary sets the whole block (upstream's `u64::MAX << 0`)", () => {
    const m = InitMaskMaterialized.new(S(128), false); // 128 / 64 + 1 = 3 blocks
    m.set_range_inbounds(S(64), S(64), true);
    expect(m.blocks).toEqual([0, 0, 0xffff_ffff, 0xffff_ffff, 0, 0]);
    expect(panics(() => InitMaskMaterialized.new(S(0), false).set_range_inbounds(S(0), S(0), true))).toBe("index out of bounds: the len is 0 but the index is 0");
  });

  test("is_range_initialized reports the first uninit span; chunks alternate", () => {
    const n = InitMask.new(S(100), false);
    n.set_range(rg(30, 40), true);
    const e = (r: Result<undefined, AllocRange>): string => (r.$ === "Ok" ? "Ok" : `Err(${r_(r._0)})`);
    expect(e(n.is_range_initialized(rg(25, 45)))).toBe("Err(25..30)");
    expect(e(n.is_range_initialized(rg(30, 45)))).toBe("Err(40..45)");
    expect(e(n.is_range_initialized(rg(30, 40)))).toBe("Ok");
    expect(e(n.is_range_initialized(rg(90, 110)))).toBe("Err(100..110)"); // out of bounds: `len..end`
    expect(chunks(n, rg(0, 100))).toEqual(["U0..30", "I30..40", "U40..100"]);
    expect(chunks(n, rg(35, 35))).toEqual([]);
    // across several blocks: init 70..200 of 260
    const m = InitMask.new(S(260), false);
    m.set_range(rg(70, 200), true);
    expect(chunks(m, rg(0, 260))).toEqual(["U0..70", "I70..200", "U200..260"]);
    expect(e(m.is_range_initialized(rg(64, 210)))).toBe("Err(64..70)");
    expect(e(m.is_range_initialized(rg(70, 210)))).toBe("Err(200..210)");
  });

  test("growing a materialized mask (case 2): new blocks and the old block's trailing bits", () => {
    const m = InitMask.new(S(60), true);
    m.set_range(rg(10, 20), false);
    m.set_range(rg(50, 130), false);
    // block 0 keeps 0..10 and 20..50; `grow(60, 70, false)` adds 70 / 64 + 1 = 2 zero blocks
    expect(words(m)).toEqual([0xfff0_03ff, 0x3_ffff, 0, 0, 0, 0]);
    expect(m.len.bytes()).toBe(130);
    expect(chunks(m, rg(0, 130))).toEqual(["I0..10", "U10..20", "I20..50", "U50..130"]);
  });

  test("prepare_copy / apply_copy (InitCopy run lengths, repeated)", () => {
    const src = InitMask.new(S(16), false);
    src.set_range(rg(2, 5), true);
    src.set_range(rg(9, 10), true);
    const copy = src.prepare_copy(rg(0, 12));
    expect([copy.initial, copy.ranges]).toEqual([false, [2, 3, 4, 1, 2]]);
    expect(copy.no_bytes_init()).toBe(false);
    const dst = InitMask.new(S(48), false);
    dst.apply_copy(copy, alloc_range(S(6), S(12)), 3);
    expect(chunks(dst, rg(0, 48))).toEqual(["U0..8", "I8..11", "U11..15", "I15..16", "U16..20", "I20..23", "U23..27", "I27..28", "U28..32", "I32..35", "U35..39", "I39..40", "U40..48"]);
    // a uniform copy stays lazy: `set_range(start..start + size * repeat)`
    const uninit = InitMask.new(S(8), false).prepare_copy(rg(0, 8));
    expect([uninit.initial, uninit.ranges, uninit.no_bytes_init()]).toEqual([false, [8], true]);
    const lazy = InitMask.new(S(32), true);
    lazy.apply_copy(uninit, alloc_range(S(0), S(16)), 2);
    expect(lazy.blocks).toEqual({ $: "Lazy", state: false });
    expect(panics(() => InitMask.new(S(8), true).prepare_copy(rg(3, 3)))).toBe("range should be nonempty");
  });

  test("Hash of InitMaskMaterialized: the u64 blocks' bytes, partially when long", () => {
    const calls: string[] = [];
    const h = {
      write_length_prefix: (n: number) => calls.push(`len ${n}`),
      write_usize: (n: number) => calls.push(`usize ${n}`),
      write: (b: Uint8Array) => calls.push(`bytes ${[...b].map((x) => x.toString(16)).join(",")}`),
    } as unknown as Hasher;
    hash_InitMaskMaterialized(new InitMaskMaterialized([0xff00, 0x8000_0001]), h);
    expect(calls).toEqual(["len 1", "bytes 0,ff,0,0,1,0,0,80"]);
    calls.length = 0;
    hash_InitMaskMaterialized(new InitMaskMaterialized(new Array(34).fill(0)), h); // 17 blocks > MAX_BLOCKS_LEN (16)
    expect(calls.map((c) => c.slice(0, 9))).toEqual(["usize 17", "len 8", "bytes 0,0", "len 8", "bytes 0,0"]);
  });

  test("Decodable: InitMaskMaterialized (raw little-endian u64s), AllocFlags", () => {
    const bytes = [2, 0xef, 0xcd, 0xab, 0x89, 0x67, 0x45, 0x23, 0x01, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0xff];
    const d = mem_decoder(bytes);
    expect(decode_InitMaskMaterialized(d).blocks).toEqual([0x89ab_cdef, 0x0123_4567, 0, 0xffff_ffff]);
    const f = { _0: mem_decoder([0b1100_0011, 0, 0b0011_1101]) };
    const a = decode_AllocFlags(f._0);
    expect([a.align.bytes(), a.mutability, a.all_zero]).toEqual([8, "Mut", true]);
    const b = decode_AllocFlags(f._0);
    expect([b.align.bytes(), b.mutability, b.all_zero]).toEqual([1, "Not", false]);
    expect(panics(() => decode_AllocFlags(f._0))).toContain("called `Result::unwrap()` on an `Err` value"); // 2^61 > Align::MAX
  });
});

describe("ProvenanceMap", () => {
  test("ptr-sized provenance: range_empty, get_range, read_ptr", () => {
    const pm = ProvenanceMap.new<CtfeProvenance>();
    pm.insert_ptr(S(8), p1, cx);
    pm.insert_ptr(S(24), p2, cx);
    expect(pm.range_empty(rg(0, 8), cx)).toBe(true);
    expect(pm.range_empty(rg(1, 9), cx)).toBe(false);
    expect(pm.range_empty(rg(16, 17), cx)).toBe(true);
    expect(pm.range_empty(rg(23, 23), cx)).toBe(true); // zero-length: no pointer crosses the edge 22|23
    expect(pm.range_empty(rg(20, 20), cx)).toBe(true);
    expect(pm.range_empty(rg(12, 12), cx)).toBe(false); // crosses the edge 11|12 of the pointer at 8
    expect([...pm.get_range(rg(10, 30), cx)].map(([r, p]) => `${r_(r)}:${p}`)).toEqual(["8..16:17", "24..32:34"]);
    const rp = (o: number): string => {
      const r = pm.read_ptr(S(o), cx);
      return r.$ === "Ok" ? `Ok(${r._0})` : `Err(${r._0.$}(${(r._0 as Extract<AllocError, { $: "ReadPartialPointer" }>)._0.bytes()}))`;
    };
    expect(rp(8)).toBe("Ok(17)");
    expect(rp(0)).toBe("Ok(undefined)");
    expect(rp(4)).toBe("Err(ReadPartialPointer(4))");
    expect([...pm.provenances()]).toEqual([p1, p2]);
    expect(pm.ptrs_().iter().map(([o, p]) => [o.bytes(), p])).toEqual([[8, p1], [24, p2]]);
  });

  test("clear splits partially overwritten pointers into byte fragments; merge_bytes", () => {
    const pm = ProvenanceMap.new<CtfeProvenance>();
    pm.insert_ptr(S(8), p1, cx);
    pm.insert_ptr(S(24), p2, cx);
    const data = data40();
    pm.clear(rg(12, 28), data, cx);
    expect(pm.ptrs.data).toEqual([]);
    expect(pm.bytes!.data.map(([o, f]) => [o.bytes(), f.idx, f.prov, f.bytes[0]])).toEqual([
      [8, 0, p1, 8], [9, 1, p1, 8], [10, 2, p1, 8], [11, 3, p1, 8],
      [28, 4, p2, 24], [29, 5, p2, 24], [30, 6, p2, 24], [31, 7, p2, 24],
    ]);
    expect(pm.bytes!.data[0]![1].bytes).toEqual([8, 9, 10, 11, 12, 13, 14, 15]);
    const r = pm.read_ptr(S(8), cx);
    expect(r.$ === "Err" && r._0.$).toBe("ReadPartialPointer");
    expect(pm.merge_bytes(cx)).toBe(false);
    expect([...pm.provenances()]).toEqual([p1, p1, p1, p1, p2, p2, p2, p2]);
    expect(pm.ptrs_ !== undefined && panics(() => (pm as ProvenanceMap).ptrs_())).toBe("`ptrs()` called on non-interned allocation");

    // all 8 fragments of one pointer, in order: read_ptr re-assembles them, merge_bytes moves them back
    const pm2 = ProvenanceMap.new<CtfeProvenance>();
    pm2.insert_ptr(S(0), p1, cx);
    pm2.clear(rg(3, 4), data, cx);
    expect(pm2.bytes!.data.map(([o]) => o.bytes())).toEqual([0, 1, 2, 4, 5, 6, 7]);
    const r2 = pm2.read_ptr(S(0), cx);
    expect(r2.$ === "Err" && r2._0.$).toBe("ReadPartialPointer");
    pm2.bytes!.insert(S(3), { idx: 3, prov: p1, bytes: [0, 1, 2, 3, 4, 5, 6, 7] });
    expect(pm2.read_ptr(S(0), cx)).toEqual({ $: "Ok", _0: p1 });
    expect(pm2.merge_bytes(cx)).toBe(true);
    expect([pm2.bytes, pm2.ptrs.data.map(([o, p]) => [o.bytes(), p])]).toEqual([undefined, [[0, p1]]]);
    // CtfeProvenance has no wildcard
    expect(panics(() => pm2.write_wildcards(cx, data, rg(0, 2)))).toBe("called `Option::unwrap()` on a `None` value");
  });

  test("prepare_copy / apply_copy (repeated, with partial pointers at the start)", () => {
    const src = ProvenanceMap.new<CtfeProvenance>();
    src.insert_ptr(S(8), p1, cx);
    src.insert_ptr(S(24), p2, cx);
    const copy = src.prepare_copy(alloc_range(S(12), S(24)), data40(), cx);
    expect(copy.ptrs.map(([o, p]) => [o.bytes(), p])).toEqual([[12, p2]]);
    expect(copy.bytes.map(([o, f]) => [o.bytes(), f.idx, f.prov])).toEqual([[0, 4, p1], [1, 5, p1], [2, 6, p1], [3, 7, p1]]);
    const dst = ProvenanceMap.new<CtfeProvenance>();
    dst.apply_copy(copy, alloc_range(S(100), S(24)), 2);
    expect(dst.ptrs.data.map(([o, p]) => [o.bytes(), p])).toEqual([[112, p2], [136, p2]]);
    expect(dst.bytes!.data.map(([o, f]) => [o.bytes(), f.idx])).toEqual([[100, 4], [101, 5], [102, 6], [103, 7], [124, 4], [125, 5], [126, 6], [127, 7]]);
    // a copy smaller than a pointer, inside one: only fragments
    const small = src.prepare_copy(alloc_range(S(26), S(3)), data40(), cx);
    expect([small.ptrs.length, small.bytes.map(([o, f]) => [o.bytes(), f.idx, f.prov])]).toEqual([0, [[0, 2, p2], [1, 3, p2], [2, 4, p2]]]);
  });
});

describe("Allocation", () => {
  test("from_bytes / new: bytes, init mask, mutability", () => {
    const a = Allocation.from_bytes(Uint8Array.from({ length: 16 }, (_, i) => i + 1), Align.ONE, "Mut", null);
    expect([a.len(), a.size().bytes(), a.init_mask_().blocks, a.mutability]).toEqual([16, 16, { $: "Lazy", state: true }, "Mut"]);
    const b = Allocation.new(S(8), Align.EIGHT, "Uninit", null);
    expect([[...b.bytes], b.init_mask.blocks, b.mutability, b.align.bytes()]).toEqual([[0, 0, 0, 0, 0, 0, 0, 0], { $: "Lazy", state: false }, "Mut", 8]);
    const c = Allocation.from_bytes_byte_aligned_immutable(Uint8Array.from([1, 2]), null);
    expect([c.align.bytes(), c.mutability]).toEqual([1, "Not"]);
    expect(panics(() => c.write_uninit(cx, rg(0, 1)))).toBe("assertion failed: self.mutability == Mutability::Mut");
    c.write_uninit(cx, rg(1, 1)); // zero-sized: no assertion
    expect(panics(() => a.inspect_with_uninit_and_ptr_outside_interpreter({ start: 0, end: 20 }))).toBe("range end index 20 out of range for slice of length 16");
    expect([...a.inspect_with_uninit_and_ptr_outside_interpreter({ start: 2, end: 4 })]).toEqual([3, 4]);
    expect(a.with_extra("x").extra).toBe("x");
  });

  test("get_bytes_strip_provenance: uninit and pointer bytes are errors with the bad range", () => {
    const a = Allocation.from_bytes(Uint8Array.from({ length: 16 }, (_, i) => i + 1), Align.ONE, "Mut", null);
    const strip = (r: AllocRange): string => {
      const res = a.get_bytes_strip_provenance(cx, r);
      if (res.$ === "Ok") return `Ok(${[...res._0]})`;
      const e = res._0;
      return e.$ === "ReadPartialPointer" ? e.$ : `${e.$}(${e._0 === undefined ? "None" : `${r_(e._0.access)} bad ${r_(e._0.bad)}`})`;
    };
    expect(strip(rg(0, 4))).toBe("Ok(1,2,3,4)");
    a.provenance.insert_ptr(S(8), p1, cx);
    expect(strip(rg(4, 12))).toBe("ReadPointerAsInt(4..12 bad 8..12)");
    expect(strip(rg(10, 16))).toBe("ReadPointerAsInt(10..16 bad 10..16)");
    a.write_uninit(cx, rg(2, 3));
    expect(strip(rg(0, 4))).toBe("InvalidUninitBytes(0..4 bad 2..3)");
    // `read_scalar` checks the init mask first
    const rs = a.read_scalar(cx, rg(0, 4), false);
    expect(rs.$ === "Err" && rs._0.$ === "InvalidUninitBytes" && r_(rs._0._0!.bad)).toBe("2..3");
    // overwriting part of the pointer keeps its other bytes as fragments; the returned view aliases the bytes
    const view = a.get_bytes_unchecked_for_overwrite(cx, rg(6, 10));
    view.fill(0xaa);
    expect([...a.get_bytes_unchecked(rg(5, 11))]).toEqual([6, 0xaa, 0xaa, 0xaa, 0xaa, 11]);
    expect([a.provenance.ptrs.data.length, a.provenance.bytes!.data.map(([o, f]) => [o.bytes(), f.idx])]).toEqual([
      0,
      [[10, 2], [11, 3], [12, 4], [13, 5], [14, 6], [15, 7]],
    ]);
    expect(a.provenance_merge_bytes(cx)).toBe(false);
    a.clear_provenance(cx, rg(0, 16));
    expect(a.provenance.bytes!.data).toEqual([]);
    expect(a.provenance_merge_bytes(cx)).toBe(true);
    expect(panics(() => a.get_bytes_unchecked_raw())).toBe("assertion failed: Prov::OFFSET_IS_ADDR");
    const p = a.get_bytes_unchecked_for_overwrite_ptr(cx, rg(14, 16));
    expect(p.length).toBe(2);
    expect(panics(() => a.get_bytes_unchecked_for_overwrite_ptr(cx, rg(14, 17)))).toBe("assertion failed: range.end().bytes_usize() <= self.bytes.len()");
  });

  test("mem_copy_repeatedly's pieces: init mask and provenance copies", () => {
    const src = Allocation.from_bytes(data40(), Align.ONE, "Mut", null);
    src.provenance.insert_ptr(S(8), p1, cx);
    src.write_uninit(cx, rg(30, 32));
    const range = alloc_range(S(8), S(24)); // 8..32
    const init = src.init_mask.prepare_copy(range);
    const prov = src.provenance_prepare_copy(range, cx);
    const dst = Allocation.new(S(64), Align.ONE, "Zero", null);
    dst.init_mask_apply_copy(init, alloc_range(S(4), S(24)), 2);
    dst.provenance_apply_copy(prov, alloc_range(S(4), S(24)), 2);
    expect(chunks(dst.init_mask, rg(0, 64))).toEqual(["I0..26", "U26..28", "I28..50", "U50..52", "I52..64"]);
    expect(dst.provenance.ptrs.data.map(([o, p]) => [o.bytes(), p])).toEqual([[4, p1], [28, p1]]);
  });

  test("AllocRange, AllocError, ConstAllocation", () => {
    expect(display_AllocRange(alloc_range(S(16), S(8)))).toBe("[0x10..0x18]");
    expect(display_AllocRange(alloc_range(S(0), S(0)))).toBe("[0x0..0x0]");
    expect(r_(alloc_range(S(4), S(8)).subrange(alloc_range(S(2), S(4))))).toBe("6..10");
    expect(panics(() => alloc_range(S(4), S(8)).subrange(alloc_range(S(6), S(4))))).toBe("access outside the bounds for given AllocRange");
    expect(panics(() => rg(5, 4))).toBe("Size::sub: 4 - 5 would result in negative size");
    const id = 3 as AllocId;
    const bad = { access: rg(0, 4), bad: rg(1, 2) };
    expect(AllocError_.to_interp_error({ $: "ReadPointerAsInt", _0: undefined }, id)).toEqual({ $: "Unsupported", _0: { $: "ReadPointerAsInt", _0: undefined } });
    expect(AllocError_.to_interp_error({ $: "InvalidUninitBytes", _0: bad }, id)).toEqual({ $: "UndefinedBehavior", _0: { $: "InvalidUninitBytes", _0: [id, bad] } });
    const ca = new ConstAllocation(Allocation.from_bytes(Uint8Array.from([0]), Align.ONE, "Not", null));
    expect(debug_ConstAllocation(ca, PLAIN)).toBe("ConstAllocation { .. }");
    expect([all_zero(new Uint8Array(0)), all_zero(new Uint8Array(9)), all_zero(Uint8Array.from([0, 0, 1])), all_zero(Uint8Array.from([1]))]).toEqual([true, true, false, false]);
    expect(dl_big.endian).toBe("Big");
  });
});

/** Lane mir-interp-b's pieces `read_scalar` / `write_scalar` / `adjust_from_tcx` call. */
function interp_b_ported(): boolean {
  try {
    const ptr = Pointer.new(p1, S(1));
    ptr.into_raw_parts();
    Scalar.to_bits_or_ptr_internal(Scalar.from_pointer(ptr, cx), S(8));
    Scalar.to_bits_or_ptr_internal(Scalar.from_uint<CtfeProvenance>(1n, S(4)), S(4));
    read_target_uint("Little", new Uint8Array(4));
    write_target_uint("Little", new Uint8Array(4), 1n);
    return true;
  } catch (e) {
    if (e instanceof Unported) return false;
    throw e;
  }
}

describe.skipIf(!interp_b_ported())("Allocation scalars (needs lane mir-interp-b)", () => {
  const scalar = (r: Result<Scalar<CtfeProvenance>, AllocError>): string => {
    if (r.$ === "Err") return `Err(${r._0.$}${r._0.$ === "ReadPartialPointer" ? `(${r._0._0.bytes()})` : ""})`;
    const s = r._0;
    return s.$ === "Int" ? `Int(${s._0.data.toString(16)}, ${s._0.size_})` : `Ptr(${s._0.provenance}, ${s._0.offset.bytes()}, ${s._1})`;
  };

  test("write_scalar / read_scalar with and without provenance (little-endian)", () => {
    const a = Allocation.new(S(24), Align.EIGHT, "Uninit", null);
    expect(a.write_scalar(cx, rg(0, 8), Scalar.from_pointer(Pointer.new(p1, S(0x10)), cx)).$).toBe("Ok");
    expect([...a.bytes.subarray(0, 8)]).toEqual([0x10, 0, 0, 0, 0, 0, 0, 0]);
    expect(a.provenance.ptrs.data.map(([o, p]) => [o.bytes(), p])).toEqual([[0, p1]]);
    expect(a.write_scalar(cx, rg(8, 12), Scalar.from_uint<CtfeProvenance>(0xdead_beefn, S(4))).$).toBe("Ok");
    expect([...a.bytes.subarray(8, 12)]).toEqual([0xef, 0xbe, 0xad, 0xde]);
    expect(scalar(a.read_scalar(cx, rg(0, 8), true))).toBe("Ptr(17, 16, 8)");
    expect(scalar(a.read_scalar(cx, rg(0, 8), false))).toBe("Err(ReadPointerAsInt)");
    expect(scalar(a.read_scalar(cx, rg(4, 8), false))).toBe("Err(ReadPointerAsInt)");
    expect(scalar(a.read_scalar(cx, rg(8, 12), false))).toBe("Int(deadbeef, 4)");
    expect(scalar(a.read_scalar(cx, rg(8, 16), true))).toBe("Err(InvalidUninitBytes)");
    a.write_uninit(cx, rg(12, 24));
    a.mark_init(rg(12, 24), true);
    expect(scalar(a.read_scalar(cx, rg(8, 16), true))).toBe("Int(deadbeef, 8)");
    expect(scalar(a.read_scalar(cx, rg(4, 12), true))).toBe("Err(ReadPartialPointer(4))");
    // a pointer copied bytewise (two halves) re-assembles on read
    const b = Allocation.new(S(16), Align.EIGHT, "Zero", null);
    b.bytes.set(a.bytes.subarray(0, 8), 0);
    const copy = a.provenance_prepare_copy(rg(0, 4), cx);
    const copy2 = a.provenance_prepare_copy(rg(4, 8), cx);
    b.provenance_apply_copy(copy, rg(0, 4), 1);
    b.provenance_apply_copy(copy2, rg(4, 8), 1);
    expect(b.provenance.bytes!.data.length).toBe(8);
    expect(scalar(b.read_scalar(cx, rg(0, 8), true))).toBe("Ptr(17, 16, 8)");
    // a size mismatch of a pointer is an ICE (`to_bits_or_ptr_internal`)
    expect(panics(() => a.write_scalar(cx, rg(16, 20), Scalar.from_pointer(Pointer.new(p2, S(0)), cx)))).toBe("Scalar pointer has size 8 but expected 4");
  });

  test("big-endian layout writes the integer big-endian", () => {
    const cx_big = { data_layout: () => dl_big };
    const a = Allocation.new(S(8), Align.ONE, "Zero", null);
    a.write_scalar(cx_big, rg(0, 4), Scalar.from_uint<CtfeProvenance>(0x0102_0304n, S(4)));
    expect([...a.bytes.subarray(0, 4)]).toEqual([1, 2, 3, 4]);
    expect(scalar(a.read_scalar(cx_big, rg(0, 2), false))).toBe("Int(102, 2)");
  });
});
