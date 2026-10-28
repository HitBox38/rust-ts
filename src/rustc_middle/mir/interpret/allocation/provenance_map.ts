// Port of compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs (lane mir-contract, plan-m4 D3; fns ported
// by lane mir-interp-a). The types are generated into provenance_map.gen.ts (set rustc_middle_mir).
// PORT: `ProvenanceMap::ptrs()` is `ptrs_()` (the private field `ptrs` holds the name; mod.ts header). `SortedMap<Size,
// _>`'s `K: Ord` comparator is `cmp_Size` below. `impl RangeBounds<Size>` is rustc_index idx.ts's `RangeBounds` (`range`,
// `range_to`, `range_from`). `[u8; 8]` (`PointerFrag::bytes`) is a `number[]` of 8 bytes. The iterators returned by
// `get_range` / `provenances` / `ptr_fragments` are JS generators over the slices upstream borrows at the call.
// PORT (D8): `Prov::OFFSET_IS_ADDR` / `Prov::WILDCARD` read the `Provenance` descriptor of a provenance value at hand
// (`provenance_of(prov)`); where upstream reads them without a value, `Prov` is erased to `CtfeProvenance`
// (`Provenance_CtfeProvenance`; both ported impls, `CtfeProvenance` and `AllocId`, have `OFFSET_IS_ADDR = false` and no
// wildcard; M6 re-generalises).
//! Store the provenance for each byte in the range, with a more efficient
//! representation for the common case where PTR_SIZE consecutive bytes have the same provenance.
import "../../mod.ts";
import { type HasDataLayout, Size } from "../../../../rustc_abi/lib.ts";
import { type RangeBounds, range, SortedMap } from "../../../../rustc_data_structures/sorted_map.ts";
import { range_from, range_to } from "../../../../rustc_index/idx.ts";
import { assert, panic, unported, unwrap } from "../../../../std/panic.ts";
import { Err, Ok } from "../../../../std/result.ts";
import { type Decoder, decode_tuple, decode_u64, decode_Vec } from "../../../../rustc_serialize/serialize.ts";
import type { Range } from "../../../ty/decls.ts";
import { type AllocRange, type AllocResult, alloc_range } from "../allocation.ts";
import { type CtfeProvenance, type Provenance, Provenance_CtfeProvenance, provenance_of } from "../pointer.ts";
import { clone_PointerFrag, type PointerFrag, type ProvenanceCopy, ProvenanceMap } from "./provenance_map.gen.ts";
export * from "./provenance_map.gen.ts";

/** `<Size as Ord>::cmp` (the `SortedMap<Size, _>` comparator). */
export function cmp_Size(a: Size, b: Size): number {
  return a.bytes() < b.bytes() ? -1 : a.bytes() > b.bytes() ? 1 : 0;
}

/** PORT (D8): `Prov` (its associated consts) where no provenance value is at hand (see the header). */
function Prov_<Prov>(): Provenance<Prov> {
  return Provenance_CtfeProvenance as unknown as Provenance<Prov>;
}

/** `RangeBounds::is_empty` (`T: PartialOrd`, library/core ops/range.rs). */
function range_bounds_is_empty(r: RangeBounds<Size>): boolean {
  const s = r.start_bound;
  const e = r.end_bound;
  if (s.$ === "Unbounded" || e.$ === "Unbounded") return !true;
  if (s.$ === "Included" && e.$ === "Included") return !(s._0.bytes() <= e._0.bytes());
  return !(s._0.bytes() < e._0.bytes());
}

/** `RangeBounds::contains` (library/core ops/range.rs). */
function range_bounds_contains(r: RangeBounds<Size>, item: Size): boolean {
  const s = r.start_bound;
  const e = r.end_bound;
  const start_ok = s.$ === "Included" ? s._0.bytes() <= item.bytes() : s.$ === "Excluded" ? s._0.bytes() < item.bytes() : true;
  const end_ok = e.$ === "Included" ? item.bytes() <= e._0.bytes() : e.$ === "Excluded" ? item.bytes() < e._0.bytes() : true;
  return start_ok && end_ok;
}

/** `Range<Size>` as a `RangeBounds<Size>` (`a..b`). */
function bounds(r: Range<Size>): RangeBounds<Size> {
  return range(r.start, r.end);
}

/** `[u8; 8] == [u8; 8]` */
function bytes_eq(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

declare module "./provenance_map.gen.ts" {
  namespace ProvenanceMap {
    // interpret/allocation/provenance_map.rs:61 (lane mir-interp-a)
    function new_<Prov>(): ProvenanceMap<Prov>;
    export { new_ as new };
    // interpret/allocation/provenance_map.rs:67 (lane mir-interp-a)
    export function from_presorted_ptrs<Prov>(r: [Size, Prov][]): ProvenanceMap<Prov>;
    // interpret/allocation/provenance_map.rs:85 (lane mir-interp-a)
    export function adjusted_range_ptrs<Prov>(range: AllocRange, cx: HasDataLayout): Range<Size>;
    // interpret/allocation/provenance_map.rs:270 (lane mir-interp-a)
    export function ptr_fragments<Prov>(pos_range: RangeBounds<Size>, ptr_pos: Size, prov: Prov, data_bytes: Uint8Array, ptr_size: Size): IterableIterator<[Size, PointerFrag<Prov>]>;
  }
}

declare module "./provenance_map.gen.ts" {
  interface ProvenanceMap<Prov> {
    // interpret/allocation/provenance_map.rs:78 (lane mir-interp-a)
    ptrs_(this: ProvenanceMap<CtfeProvenance>): SortedMap<Size, CtfeProvenance>; // PORT: the field `ptrs` holds the name
    // interpret/allocation/provenance_map.rs:97 (lane mir-interp-a)
    range_ptrs_get(range: AllocRange, cx: HasDataLayout): readonly [Size, Prov][];
    // interpret/allocation/provenance_map.rs:102 (lane mir-interp-a)
    range_ptrs_is_empty(range: AllocRange, cx: HasDataLayout): boolean;
    // interpret/allocation/provenance_map.rs:108 (lane mir-interp-a)
    get_ptr(offset: Size): Prov | undefined;
    // interpret/allocation/provenance_map.rs:113 (lane mir-interp-a)
    range_bytes_get(range: AllocRange): readonly [Size, PointerFrag<Prov>][];
    // interpret/allocation/provenance_map.rs:122 (lane mir-interp-a)
    range_bytes_is_empty(range: AllocRange): boolean;
    // interpret/allocation/provenance_map.rs:128 (lane mir-interp-a)
    get_byte(offset: Size, cx: HasDataLayout): PointerFrag<Prov> | undefined;
    // interpret/allocation/provenance_map.rs:134 (lane mir-interp-a)
    get_range(range: AllocRange, cx: HasDataLayout): IterableIterator<[AllocRange, Prov]>;
    // interpret/allocation/provenance_map.rs:153 (lane mir-interp-a)
    merge_bytes(cx: HasDataLayout): boolean;
    // interpret/allocation/provenance_map.rs:186 (lane mir-interp-a)
    read_ptr(offset: Size, cx: HasDataLayout): AllocResult<Prov | undefined>;
    // interpret/allocation/provenance_map.rs:253 (lane mir-interp-a)
    range_empty(range: AllocRange, cx: HasDataLayout): boolean;
    // interpret/allocation/provenance_map.rs:258 (lane mir-interp-a)
    provenances(): IterableIterator<Prov>;
    // interpret/allocation/provenance_map.rs:263 (lane mir-interp-a)
    insert_ptr(offset: Size, prov: Prov, cx: HasDataLayout): void;
    // interpret/allocation/provenance_map.rs:293 (lane mir-interp-a)
    clear(range: AllocRange, data_bytes: Uint8Array, cx: HasDataLayout): void;
    // interpret/allocation/provenance_map.rs:348 (lane mir-interp-a)
    write_wildcards(cx: HasDataLayout, data_bytes: Uint8Array, range: AllocRange): void;
    // interpret/allocation/provenance_map.rs:380 (lane mir-interp-a)
    prepare_copy(range: AllocRange, data_bytes: Uint8Array, cx: HasDataLayout): ProvenanceCopy<Prov>;
    // interpret/allocation/provenance_map.rs:460 (lane mir-interp-a)
    apply_copy(copy: ProvenanceCopy<Prov>, range: AllocRange, repeat: number): void;
  }
}
// These impls are generic over `Prov` since `CtfeProvenance` is only decodable/encodable
// for some particular `D`/`S`.
// impl<D: Decoder, Prov: Provenance + Decodable<D>> Decodable<D> for ProvenanceMap<Prov>
// rustc: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:47 decode
export function decode_ProvenanceMap<D extends Decoder, Prov>(d: D, decode_Prov: (d: D) => Prov): ProvenanceMap<Prov> {
  // `bytes` is not in the serialized format
  return new ProvenanceMap(decode_SortedMap_Size(d, decode_Prov), undefined);
}
/** PORT (lane meta-mir): `derive(Decodable_NoContext)` of `SortedMap<K, V> { data: Vec<(K, V)> }` (rustc_data_structures
 *  sorted_map.rs:24) at `K = Size`, hand-expanded (no codegen set covers sorted_map.rs): the `Vec<(Size, V)>` field, with
 *  `Size`'s derived decoder (`Size { raw: u64 }`, rustc_abi lib.rs:864; tools/codegen serialize.json `rustc_abi::Size`).
 *  The TS `SortedMap` carries its key comparator (`cmp_Size`). */
function decode_SortedMap_Size<D extends Decoder, V>(d: D, decode_V: (d: D) => V): SortedMap<Size, V> {
  const data = decode_Vec(d, (d: D): [Size, V] => decode_tuple(d, (d: D) => Size.from_bytes(decode_u64(d)), decode_V));
  return new SortedMap(data, cmp_Size);
}

// rustc-skip: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:53 encode Encodable (metadata encoding, M5)

// rustc: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:61 new
(ProvenanceMap as unknown as { new: typeof ProvenanceMap.new }).new = function <Prov>(): ProvenanceMap<Prov> {
  return new ProvenanceMap<Prov>(SortedMap.new(cmp_Size), undefined);
};

/// The caller must guarantee that the given provenance list is already sorted
/// by offset and contain no duplicates.
// rustc: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:67 from_presorted_ptrs
(ProvenanceMap as unknown as { from_presorted_ptrs: typeof ProvenanceMap.from_presorted_ptrs }).from_presorted_ptrs = function <Prov>(r: [Size, Prov][]): ProvenanceMap<Prov> {
  return new ProvenanceMap<Prov>(SortedMap.from_presorted_elements(r, cmp_Size), undefined);
};

/// Give access to the ptr-sized provenances (which can also be thought of as relocations, and
/// indeed that is how codegen treats them).
///
/// Only use on interned allocations, as other allocations may have per-byte provenance!
// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:78 ptrs
ProvenanceMap.prototype.ptrs_ = function (this: ProvenanceMap<CtfeProvenance>): SortedMap<Size, CtfeProvenance> {
  assert(this.bytes === undefined, "`ptrs()` called on non-interned allocation");
  return this.ptrs;
};

// rustc: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:85 adjusted_range_ptrs
(ProvenanceMap as unknown as { adjusted_range_ptrs: typeof ProvenanceMap.adjusted_range_ptrs }).adjusted_range_ptrs = function <Prov>(range: AllocRange, cx: HasDataLayout): Range<Size> {
  // We have to go back `pointer_size - 1` bytes, as that one would still overlap with
  // the beginning of this range.
  const adjusted_start = Size.from_bytes(
    Math.max(0, range.start.bytes() - (cx.data_layout().pointer_size().bytes() - 1)), // `saturating_sub`
  );
  return { start: adjusted_start, end: range.end() };
};

/// Returns all ptr-sized provenance in the given range.
/// If the range has length 0, returns provenance that crosses the edge between `start-1` and
/// `start`.
// rustc: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:97 range_ptrs_get
ProvenanceMap.prototype.range_ptrs_get = function <Prov>(this: ProvenanceMap<Prov>, range: AllocRange, cx: HasDataLayout): readonly [Size, Prov][] {
  return this.ptrs.range(bounds(ProvenanceMap.adjusted_range_ptrs(range, cx))) as readonly [Size, Prov][];
};

/// `pm.range_ptrs_is_empty(r, cx)` == `pm.range_ptrs_get(r, cx).is_empty()`, but is faster.
// rustc: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:102 range_ptrs_is_empty
ProvenanceMap.prototype.range_ptrs_is_empty = function <Prov>(this: ProvenanceMap<Prov>, range: AllocRange, cx: HasDataLayout): boolean {
  return this.ptrs.range_is_empty(bounds(ProvenanceMap.adjusted_range_ptrs(range, cx)));
};

/// Check if there is ptr-sized provenance at the given index.
/// Does not mean anything for bytewise provenance! But can be useful as an optimization.
// rustc: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:108 get_ptr
ProvenanceMap.prototype.get_ptr = function <Prov>(this: ProvenanceMap<Prov>, offset: Size): Prov | undefined {
  return this.ptrs.get(offset);
};

/// Returns all byte-wise provenance in the given range.
// rustc: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:113 range_bytes_get
ProvenanceMap.prototype.range_bytes_get = function <Prov>(this: ProvenanceMap<Prov>, range: AllocRange): readonly [Size, PointerFrag<Prov>][] {
  const bytes = this.bytes;
  if (bytes !== undefined) {
    return bytes.range(bounds({ start: range.start, end: range.end() })) as readonly [Size, PointerFrag<Prov>][];
  } else {
    return [];
  }
};

/// Same as `range_bytes_get(range).is_empty()`, but faster.
// rustc: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:122 range_bytes_is_empty
ProvenanceMap.prototype.range_bytes_is_empty = function <Prov>(this: ProvenanceMap<Prov>, range: AllocRange): boolean {
  const bytes = this.bytes;
  return bytes === undefined || bytes.range_is_empty(bounds({ start: range.start, end: range.end() }));
};

/// Get the provenance of a single byte. Must only be called if there is no
/// pointer-sized provenance here.
// rustc: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:128 get_byte
ProvenanceMap.prototype.get_byte = function <Prov>(this: ProvenanceMap<Prov>, offset: Size, cx: HasDataLayout): PointerFrag<Prov> | undefined {
  // debug_assert!(self.range_ptrs_is_empty(alloc_range(offset, Size::from_bytes(1)), cx));
  void cx;
  return this.bytes?.get(offset);
};

/// Gets the provenances of all bytes (including from pointers) in a range.
// rustc: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:134 get_range
ProvenanceMap.prototype.get_range = function <Prov>(this: ProvenanceMap<Prov>, range: AllocRange, cx: HasDataLayout): IterableIterator<[AllocRange, Prov]> {
  const ptr_size = cx.data_layout().pointer_size();
  const ptr_provs = this.range_ptrs_get(range, cx);
  const byte_provs = this.range_bytes_get(range);
  // `ptr_provs.chain(byte_provs)`
  return (function* (): Generator<[AllocRange, Prov]> {
    for (const [offset, p] of ptr_provs) yield [alloc_range(offset, ptr_size), p];
    for (const [offset, frag] of byte_provs) yield [alloc_range(offset, Size.from_bytes(1)), frag.prov];
  })();
};

/// Attempt to merge per-byte provenance back into ptr chunks, if the right fragments
/// sit next to each other. Return `false` if that is not possible due to partial pointers.
// rustc: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:153 merge_bytes
ProvenanceMap.prototype.merge_bytes = function <Prov>(this: ProvenanceMap<Prov>, cx: HasDataLayout): boolean {
  const bytes = this.bytes;
  if (bytes === undefined) {
    return true;
  }
  const ptr_size = cx.data_layout().pointer_size();
  while (bytes.data.length > 0) {
    const [offset, first_frag] = bytes.data[0]!;
    // Check if this fragment starts a pointer.
    const range_ = range(offset, offset.add(ptr_size));
    const frags = bytes.range(range_);
    if (frags.length !== ptr_size.bytes_usize()) {
      // We can't merge this one, no point in trying to merge the rest.
      return false;
    }
    for (let idx = 0; idx < frags.length; idx++) {
      const frag = frags[idx]![1];
      if (!(frag.prov === first_frag.prov && bytes_eq(frag.bytes, first_frag.bytes) && frag.idx === (idx & 0xff))) {
        return false;
      }
    }
    // Looks like a pointer! Move it over to the ptr provenance map.
    this.ptrs.insert(offset, first_frag.prov);
    bytes.remove_range(range_);
  }
  // We managed to convert everything into whole pointers.
  this.bytes = undefined;
  return true;
};

/// Try to read a pointer from the given location, possibly by loading from many per-byte
/// provenances.
// rustc: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:186 read_ptr
ProvenanceMap.prototype.read_ptr = function <Prov>(this: ProvenanceMap<Prov>, offset: Size, cx: HasDataLayout): AllocResult<Prov | undefined> {
  // If there is pointer-sized provenance exactly here, we can just return that.
  const prov_ = this.get_ptr(offset);
  if (prov_ !== undefined) {
    return Ok(prov_);
  }
  // The other easy case is total absence of provenance, that also always works.
  const range = alloc_range(offset, cx.data_layout().pointer_size());
  const no_ptrs = this.range_ptrs_is_empty(range, cx);
  if (no_ptrs && this.range_bytes_is_empty(range)) {
    return Ok(undefined);
  }
  // If we get here, we have to check whether we can merge per-byte provenance.
  let prov: Prov | undefined;
  prov_block: {
    // If there is any ptr-sized provenance overlapping with this range,
    // this is definitely mixing multiple pointers and we can bail.
    if (!no_ptrs) {
      prov = undefined;
      break prov_block;
    }
    // Scan all fragments, and ensure their indices, provenance, and bytes match.
    // However, we have to ignore wildcard fragments for this (this is needed for Miri's
    // native-lib mode). Therefore, we will only know the expected provenance and bytes
    // once we find the first non-wildcard fragment.
    let expected: [Prov, number[]] | undefined = undefined;
    for (let idx = 0; idx < range.size.bytes(); idx++) {
      // Ensure there is provenance here.
      const frag = this.get_byte(offset.add(Size.from_bytes(idx)), cx);
      if (frag === undefined) {
        prov = undefined;
        break prov_block;
      }
      // If this is wildcard provenance, ignore this fragment.
      const wildcard = provenance_of(frag.prov).WILDCARD;
      if (wildcard !== undefined && frag.prov === wildcard) {
        continue;
      }
      // For non-wildcard fragments, the index must match.
      if (frag.idx !== idx) {
        prov = undefined;
        break prov_block;
      }
      // If there are expectations registered, check them.
      // If not, record this fragment as setting the expectations.
      if (expected !== undefined) {
        if (!(frag.prov === expected[0] && bytes_eq(frag.bytes, expected[1]))) {
          prov = undefined;
          break prov_block;
        }
      } else {
        expected = [frag.prov, frag.bytes];
      }
    }
    // The final provenance is the expected one we found along the way, or wildcard if
    // we didn't find any.
    prov = unwrap(expected !== undefined ? expected[0] : Prov_<Prov>().WILDCARD);
  }
  if (prov === undefined && !Prov_<Prov>().OFFSET_IS_ADDR) {
    // There are some bytes with provenance here but overall the provenance does not add up.
    // We need `OFFSET_IS_ADDR` to fall back to no-provenance here; without that option, we
    // must error.
    return Err({ $: "ReadPartialPointer", _0: offset });
  }
  return Ok(prov);
};

/// Returns whether this allocation has provenance overlapping with the given range.
///
/// Note: this function exists to allow `range_get_provenance` to be private, in order to somewhat
/// limit access to provenance outside of the `Allocation` abstraction.
///
// rustc: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:253 range_empty
ProvenanceMap.prototype.range_empty = function <Prov>(this: ProvenanceMap<Prov>, range: AllocRange, cx: HasDataLayout): boolean {
  return this.range_ptrs_is_empty(range, cx) && this.range_bytes_is_empty(range);
};

/// Yields all the provenances stored in this map.
// rustc: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:258 provenances
ProvenanceMap.prototype.provenances = function <Prov>(this: ProvenanceMap<Prov>): IterableIterator<Prov> {
  const ptrs = this.ptrs.data;
  const bytes = this.bytes;
  // `self.ptrs.values().copied().chain(bytes)`
  return (function* (): Generator<Prov> {
    for (const [, p] of ptrs) yield p;
    if (bytes !== undefined) for (const [, frag] of bytes.data) yield frag.prov;
  })();
};

// rustc: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:263 insert_ptr
ProvenanceMap.prototype.insert_ptr = function <Prov>(this: ProvenanceMap<Prov>, offset: Size, prov: Prov, cx: HasDataLayout): void {
  // debug_assert!(self.range_empty(alloc_range(offset, cx.data_layout().pointer_size()), cx));
  void cx;
  this.ptrs.insert(offset, prov);
};

/// Returns an iterator that yields the fragments of this pointer whose absolute positions are
/// inside `pos_range`.
// rustc: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:270 ptr_fragments
(ProvenanceMap as unknown as { ptr_fragments: typeof ProvenanceMap.ptr_fragments }).ptr_fragments = function <Prov>(pos_range: RangeBounds<Size>, ptr_pos: Size, prov: Prov, data_bytes: Uint8Array, ptr_size: Size): IterableIterator<[Size, PointerFrag<Prov>]> {
  if (range_bounds_is_empty(pos_range)) {
    return [][Symbol.iterator]();
  }
  // Read ptr_size many bytes starting at ptr_pos.
  const bytes: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
  // `(&mut bytes[..ptr_size]).copy_from_slice(&data_bytes[ptr_pos..][..ptr_size])`
  const n = ptr_size.bytes_usize();
  const p = ptr_pos.bytes_usize();
  if (n > 8) panic(`range end index ${n} out of range for slice of length 8`);
  if (p > data_bytes.length) panic(`range start index ${p} out of range for slice of length ${data_bytes.length}`);
  if (n > data_bytes.length - p) panic(`range end index ${n} out of range for slice of length ${data_bytes.length - p}`);
  for (let k = 0; k < n; k++) bytes[k] = data_bytes[p + k]!;
  // Yield the fragments of this pointer.
  const end = ptr_pos.add(ptr_size);
  return (function* (): Generator<[Size, PointerFrag<Prov>]> {
    for (let i = ptr_pos.bytes(); i < end.bytes(); i++) {
      const pos = Size.from_bytes(i);
      if (!range_bounds_contains(pos_range, pos)) continue;
      yield [pos, { idx: pos.sub(ptr_pos).bytes() & 0xff, bytes: bytes.slice(), prov }];
    }
  })();
};

/// Removes all provenance inside the given range.
// rustc: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:293 clear
ProvenanceMap.prototype.clear = function <Prov>(this: ProvenanceMap<Prov>, range: AllocRange, data_bytes: Uint8Array, cx: HasDataLayout): void {
  if (range.size.bytes() === Size.ZERO.bytes()) {
    return;
  }

  const start = range.start;
  const end = range.end();
  // Clear the bytewise part -- this is easy.
  if (this.bytes !== undefined) {
    this.bytes.remove_range(range_(start, end));
  }

  // Find all provenance overlapping the given range.
  const ptrs_range = ProvenanceMap.adjusted_range_ptrs(range, cx);
  if (this.ptrs.range_is_empty(bounds(ptrs_range))) {
    // No provenance in this range, we are done. This is the common case.
    return;
  }
  const pointer_size = cx.data_layout().pointer_size();

  // This redoes some of the work of `range_is_empty`, but this path is much
  // colder than the early return above, so it's worth it.
  const ptrs = this.ptrs.range(bounds(ptrs_range));

  // We need to handle clearing the provenance from parts of a pointer.
  {
    const [first, prov] = unwrap(ptrs[0]);
    if (first.bytes() < start.bytes()) {
      // Insert the remaining part in the bytewise provenance.
      const bytes = (this.bytes ??= SortedMap.default(cmp_Size));
      for (const [pos, frag] of ProvenanceMap.ptr_fragments(range_to(start), first, prov, data_bytes, pointer_size)) {
        bytes.insert(pos, frag);
      }
    }
  }
  {
    const [last, prov] = unwrap(ptrs[ptrs.length - 1]);
    if (last.add(pointer_size).bytes() > end.bytes()) {
      // Insert the remaining part in the bytewise provenance.
      const bytes = (this.bytes ??= SortedMap.default(cmp_Size));
      for (const [pos, frag] of ProvenanceMap.ptr_fragments(range_from(end), last, prov, data_bytes, pointer_size)) {
        bytes.insert(pos, frag);
      }
    }
  }

  // Forget all the provenance.
  // Since provenance do not overlap, we know that removing until `last` (exclusive) is fine,
  // i.e., this will not remove any other provenance just after the ones we care about.
  this.ptrs.remove_range(bounds(ptrs_range));
};
/** `start..end` */
function range_(start: Size, end: Size): RangeBounds<Size> {
  return range(start, end);
}

/// Overwrites all provenance in the given range with wildcard provenance.
/// Pointers partially overwritten will have their provenances preserved
/// bytewise on their remaining bytes.
///
/// Provided for usage in Miri and panics otherwise.
// rustc: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:348 write_wildcards
ProvenanceMap.prototype.write_wildcards = function <Prov>(this: ProvenanceMap<Prov>, cx: HasDataLayout, data_bytes: Uint8Array, range: AllocRange): void {
  const wildcard = unwrap(Prov_<Prov>().WILDCARD);

  // Clear existing provenance in this range.
  this.clear(range, data_bytes, cx);

  // Make everything in the range wildcards.
  const bytes = (this.bytes ??= SortedMap.default(cmp_Size));
  for (let offset = range.start.bytes(); offset < range.end().bytes(); offset++) {
    // The fragment index and bytes do not matter for wildcard provenance.
    bytes.insert(Size.from_bytes(offset), { prov: wildcard, idx: 0, bytes: [0, 0, 0, 0, 0, 0, 0, 0] });
  }
};

// rustc: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:380 prepare_copy
ProvenanceMap.prototype.prepare_copy = function <Prov>(this: ProvenanceMap<Prov>, range: AllocRange, data_bytes: Uint8Array, cx: HasDataLayout): ProvenanceCopy<Prov> {
  const shift_offset = (offset: Size): Size => offset.sub(range.start);
  const ptr_size = cx.data_layout().pointer_size();

  // # Pointer-sized provenances
  // Get the provenances that are entirely within this range.
  // (Different from `range_get_ptrs` which asks if they overlap the range.)
  // Only makes sense if we are copying at least one pointer worth of bytes.
  let ptrs_box: [Size, Prov][] = [];
  if (range.size.bytes() >= ptr_size.bytes()) {
    const adjusted_end = Size.from_bytes(range.end().bytes() - (ptr_size.bytes() - 1));
    const ptrs = this.ptrs.range(range_(range.start, adjusted_end));
    ptrs_box = ptrs.map(([offset, reloc]): [Size, Prov] => [shift_offset(offset), reloc]);
  }

  // # Byte-sized provenances
  // This includes the existing bytewise provenance in the range, and ptr provenance
  // that overlaps with the begin/end of the range.
  let bytes_box: [Size, PointerFrag<Prov>][] = [];
  const begin_overlap = this.range_ptrs_get(alloc_range(range.start, Size.ZERO), cx)[0];
  const end_overlap = this.range_ptrs_get(alloc_range(range.end(), Size.ZERO), cx)[0];
  // We only need to go here if there is some overlap or some bytewise provenance.
  if (begin_overlap !== undefined || end_overlap !== undefined || this.bytes !== undefined) {
    const bytes: [Size, PointerFrag<Prov>][] = [];
    // First, if there is a part of a pointer at the start, add that.
    if (begin_overlap !== undefined) {
      const [pos, prov] = begin_overlap;
      // For really small copies, make sure we don't run off the end of the range.
      const a = pos.add(ptr_size);
      const b = range.end();
      const end = b.bytes() < a.bytes() ? b : a; // `cmp::min`
      for (const [pos_, frag] of ProvenanceMap.ptr_fragments(range_(range.start, end), pos, prov, data_bytes, ptr_size)) {
        bytes.push([shift_offset(pos_), frag]);
      }
    } else {
      // trace!("no start overlapping entry");
    }

    // Then the main part, bytewise provenance from `self.bytes`.
    for (const [offset, frag] of this.range_bytes_get(range)) {
      bytes.push([shift_offset(offset), clone_PointerFrag(frag, (p) => p)]);
    }

    // And finally possibly parts of a pointer at the end.
    // We only have to go here if this is actually different than the begin_overlap.
    if (end_overlap !== undefined && (begin_overlap === undefined || begin_overlap[0].bytes() !== end_overlap[0].bytes())) {
      const [pos, prov] = end_overlap;
      // If this was a really small copy, we'd have handled this in begin_overlap.
      assert(pos.bytes() >= range.start.bytes(), "assertion failed: pos >= range.start");
      for (const [pos__, frag] of ProvenanceMap.ptr_fragments(range_(pos, range.end()), pos, prov, data_bytes, ptr_size)) {
        const pos_ = shift_offset(pos__);
        // The last entry, if it exists, has a lower offset than us, so we
        // can add it at the end and remain sorted.
        // debug_assert!(bytes.last().is_none_or(|bytes_entry| bytes_entry.0 < pos));
        bytes.push([pos_, frag]);
      }
    } else {
      // trace!("no end overlapping entry");
    }
    // trace!("byte provenances: {bytes:?}");

    // And again a buffer for the new list on the target side.
    bytes_box = bytes;
  }

  return { ptrs: ptrs_box, bytes: bytes_box };
};

/// Applies a provenance copy.
/// The affected range, as defined in the parameters to `prepare_copy` is expected
/// to be clear of provenance.
// rustc: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:460 apply_copy
ProvenanceMap.prototype.apply_copy = function <Prov>(this: ProvenanceMap<Prov>, copy: ProvenanceCopy<Prov>, range: AllocRange, repeat: number): void {
  const shift_offset = (idx: number, offset: Size): Size => offset.add(range.start).add(Size.u64_mul(idx, range.size));
  if (copy.ptrs.length !== 0) {
    // We want to call `insert_presorted` only once so that, if possible, the entries
    // after the range we insert are moved back only once.
    const chunk_len = copy.ptrs.length;
    const elements: [Size, Prov][] = [];
    for (let i = 0; i < chunk_len * repeat; i++) {
      const chunk = Math.floor(i / chunk_len);
      const [offset, prov] = copy.ptrs[i % chunk_len]!;
      elements.push([shift_offset(chunk, offset), prov]);
    }
    this.ptrs.insert_presorted(elements);
  }
  if (copy.bytes.length !== 0) {
    const chunk_len = copy.bytes.length;
    const elements: [Size, PointerFrag<Prov>][] = [];
    for (let i = 0; i < chunk_len * repeat; i++) {
      const chunk = Math.floor(i / chunk_len);
      const [offset, frag] = copy.bytes[i % chunk_len]!;
      elements.push([shift_offset(chunk, offset), clone_PointerFrag(frag, (p) => p)]);
    }
    (this.bytes ??= SortedMap.default(cmp_Size)).insert_presorted(elements);
  }
};
