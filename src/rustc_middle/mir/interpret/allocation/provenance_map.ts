// Port of compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs (lane mir-contract, plan-m4 D3). The types
// are generated into provenance_map.gen.ts (set rustc_middle_mir); every fn is a stub for lane mir-interp-a
// (docs/handoff/mir-contract.md "How to fill a stub").
// PORT: `ProvenanceMap::ptrs()` is `ptrs_()` (the private field `ptrs` holds the name; mod.ts header). `SortedMap<Size,
// _>`'s `K: Ord` comparator is `Size`'s (`(a, b) => a.cmp(b)` style, rustc_data_structures sorted_map.ts).
//! Store the provenance for each byte in the range, with a more efficient
//! representation for the common case where PTR_SIZE consecutive bytes have the same provenance.
import "../../mod.ts";
import type { HasDataLayout, Size } from "../../../../rustc_abi/lib.ts";
import type { SortedMap } from "../../../../rustc_data_structures/sorted_map.ts";
import { unported } from "../../../../std/panic.ts";
import type { TyDecoder } from "../../../ty/codec.ts";
import type { Range } from "../../../ty/decls.ts";
import type { AllocRange, AllocResult } from "../allocation.ts";
import type { CtfeProvenance } from "../pointer.ts";
import { type PointerFrag, type ProvenanceCopy, ProvenanceMap } from "./provenance_map.gen.ts";
export * from "./provenance_map.gen.ts";

/** `impl RangeBounds<Size>` (`..`, `a..`, `..b`, `a..b`): PORT: the two optional bounds, `end` exclusive. */
export interface RangeBounds<T> {
  readonly start: T | undefined;
  readonly end: T | undefined;
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

// impl<D: Decoder, Prov: Provenance + Decodable<D>> Decodable<D> for ProvenanceMap<Prov>
// stub: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:47 decode (lane mir-interp-a)
export function decode_ProvenanceMap<Prov>(d: TyDecoder, decode_Prov: (d: TyDecoder) => Prov): ProvenanceMap<Prov> {
  return unported("rustc_middle::mir::interpret::allocation::provenance_map::<ProvenanceMap as Decodable>::decode");
}

// rustc-skip: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:53 encode Encodable (metadata encoding, M5)

// stub: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:61 new (lane mir-interp-a)
(ProvenanceMap as unknown as { new: typeof ProvenanceMap.new }).new = function <Prov>(): ProvenanceMap<Prov> {
  return unported("rustc_middle::mir::interpret::allocation::provenance_map::ProvenanceMap::new");
};


// stub: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:67 from_presorted_ptrs (lane mir-interp-a)
(ProvenanceMap as unknown as { from_presorted_ptrs: typeof ProvenanceMap.from_presorted_ptrs }).from_presorted_ptrs = function <Prov>(r: [Size, Prov][]): ProvenanceMap<Prov> {
  return unported("rustc_middle::mir::interpret::allocation::provenance_map::ProvenanceMap::from_presorted_ptrs");
};


// stub: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:78 ptrs (lane mir-interp-a)
ProvenanceMap.prototype.ptrs_ = function (this: ProvenanceMap<CtfeProvenance>): SortedMap<Size, CtfeProvenance> {
  return unported("rustc_middle::mir::interpret::allocation::provenance_map::ProvenanceMap::ptrs");
};


// stub: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:85 adjusted_range_ptrs (lane mir-interp-a)
(ProvenanceMap as unknown as { adjusted_range_ptrs: typeof ProvenanceMap.adjusted_range_ptrs }).adjusted_range_ptrs = function <Prov>(range: AllocRange, cx: HasDataLayout): Range<Size> {
  return unported("rustc_middle::mir::interpret::allocation::provenance_map::ProvenanceMap::adjusted_range_ptrs");
};


// stub: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:97 range_ptrs_get (lane mir-interp-a)
ProvenanceMap.prototype.range_ptrs_get = function <Prov>(this: ProvenanceMap<Prov>, range: AllocRange, cx: HasDataLayout): readonly [Size, Prov][] {
  return unported("rustc_middle::mir::interpret::allocation::provenance_map::ProvenanceMap::range_ptrs_get");
};


// stub: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:102 range_ptrs_is_empty (lane mir-interp-a)
ProvenanceMap.prototype.range_ptrs_is_empty = function <Prov>(this: ProvenanceMap<Prov>, range: AllocRange, cx: HasDataLayout): boolean {
  return unported("rustc_middle::mir::interpret::allocation::provenance_map::ProvenanceMap::range_ptrs_is_empty");
};


// stub: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:108 get_ptr (lane mir-interp-a)
ProvenanceMap.prototype.get_ptr = function <Prov>(this: ProvenanceMap<Prov>, offset: Size): Prov | undefined {
  return unported("rustc_middle::mir::interpret::allocation::provenance_map::ProvenanceMap::get_ptr");
};


// stub: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:113 range_bytes_get (lane mir-interp-a)
ProvenanceMap.prototype.range_bytes_get = function <Prov>(this: ProvenanceMap<Prov>, range: AllocRange): readonly [Size, PointerFrag<Prov>][] {
  return unported("rustc_middle::mir::interpret::allocation::provenance_map::ProvenanceMap::range_bytes_get");
};


// stub: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:122 range_bytes_is_empty (lane mir-interp-a)
ProvenanceMap.prototype.range_bytes_is_empty = function <Prov>(this: ProvenanceMap<Prov>, range: AllocRange): boolean {
  return unported("rustc_middle::mir::interpret::allocation::provenance_map::ProvenanceMap::range_bytes_is_empty");
};


// stub: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:128 get_byte (lane mir-interp-a)
ProvenanceMap.prototype.get_byte = function <Prov>(this: ProvenanceMap<Prov>, offset: Size, cx: HasDataLayout): PointerFrag<Prov> | undefined {
  return unported("rustc_middle::mir::interpret::allocation::provenance_map::ProvenanceMap::get_byte");
};


// stub: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:134 get_range (lane mir-interp-a)
ProvenanceMap.prototype.get_range = function <Prov>(this: ProvenanceMap<Prov>, range: AllocRange, cx: HasDataLayout): IterableIterator<[AllocRange, Prov]> {
  return unported("rustc_middle::mir::interpret::allocation::provenance_map::ProvenanceMap::get_range");
};


// stub: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:153 merge_bytes (lane mir-interp-a)
ProvenanceMap.prototype.merge_bytes = function <Prov>(this: ProvenanceMap<Prov>, cx: HasDataLayout): boolean {
  return unported("rustc_middle::mir::interpret::allocation::provenance_map::ProvenanceMap::merge_bytes");
};


// stub: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:186 read_ptr (lane mir-interp-a)
ProvenanceMap.prototype.read_ptr = function <Prov>(this: ProvenanceMap<Prov>, offset: Size, cx: HasDataLayout): AllocResult<Prov | undefined> {
  return unported("rustc_middle::mir::interpret::allocation::provenance_map::ProvenanceMap::read_ptr");
};


// stub: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:253 range_empty (lane mir-interp-a)
ProvenanceMap.prototype.range_empty = function <Prov>(this: ProvenanceMap<Prov>, range: AllocRange, cx: HasDataLayout): boolean {
  return unported("rustc_middle::mir::interpret::allocation::provenance_map::ProvenanceMap::range_empty");
};


// stub: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:258 provenances (lane mir-interp-a)
ProvenanceMap.prototype.provenances = function <Prov>(this: ProvenanceMap<Prov>): IterableIterator<Prov> {
  return unported("rustc_middle::mir::interpret::allocation::provenance_map::ProvenanceMap::provenances");
};


// stub: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:263 insert_ptr (lane mir-interp-a)
ProvenanceMap.prototype.insert_ptr = function <Prov>(this: ProvenanceMap<Prov>, offset: Size, prov: Prov, cx: HasDataLayout): void {
  return unported("rustc_middle::mir::interpret::allocation::provenance_map::ProvenanceMap::insert_ptr");
};


// stub: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:270 ptr_fragments (lane mir-interp-a)
(ProvenanceMap as unknown as { ptr_fragments: typeof ProvenanceMap.ptr_fragments }).ptr_fragments = function <Prov>(pos_range: RangeBounds<Size>, ptr_pos: Size, prov: Prov, data_bytes: Uint8Array, ptr_size: Size): IterableIterator<[Size, PointerFrag<Prov>]> {
  return unported("rustc_middle::mir::interpret::allocation::provenance_map::ProvenanceMap::ptr_fragments");
};


// stub: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:293 clear (lane mir-interp-a)
ProvenanceMap.prototype.clear = function <Prov>(this: ProvenanceMap<Prov>, range: AllocRange, data_bytes: Uint8Array, cx: HasDataLayout): void {
  return unported("rustc_middle::mir::interpret::allocation::provenance_map::ProvenanceMap::clear");
};


// stub: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:348 write_wildcards (lane mir-interp-a)
ProvenanceMap.prototype.write_wildcards = function <Prov>(this: ProvenanceMap<Prov>, cx: HasDataLayout, data_bytes: Uint8Array, range: AllocRange): void {
  return unported("rustc_middle::mir::interpret::allocation::provenance_map::ProvenanceMap::write_wildcards");
};


// stub: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:380 prepare_copy (lane mir-interp-a)
ProvenanceMap.prototype.prepare_copy = function <Prov>(this: ProvenanceMap<Prov>, range: AllocRange, data_bytes: Uint8Array, cx: HasDataLayout): ProvenanceCopy<Prov> {
  return unported("rustc_middle::mir::interpret::allocation::provenance_map::ProvenanceMap::prepare_copy");
};


// stub: compiler/rustc_middle/src/mir/interpret/allocation/provenance_map.rs:460 apply_copy (lane mir-interp-a)
ProvenanceMap.prototype.apply_copy = function <Prov>(this: ProvenanceMap<Prov>, copy: ProvenanceCopy<Prov>, range: AllocRange, repeat: number): void {
  return unported("rustc_middle::mir::interpret::allocation::provenance_map::ProvenanceMap::apply_copy");
};
