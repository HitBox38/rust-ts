// Port of compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs (lane mir-contract, plan-m4 D3 / D6). The types
// are generated into init_mask.gen.ts (set rustc_middle_mir); every fn is a stub for lane mir-interp-a
// (docs/handoff/mir-contract.md "How to fill a stub").
// PORT (D6): `Block = u64` is generated as a number; the lane stores the blocks as 32-bit words (as rustc_index bit_set.ts
// after lane index-ds) and keeps `BLOCK_SIZE` semantics (bit indices, `Size` results) upstream's, recording it in a PORT.
// PORT: `InitChunkIter` is a JS iterator (`next()` returns an `IteratorResult`); nested fns (`find_bit_fast`,
// `search_block`, `find_bit_slow`) are module-level stubs until the lane ports them inside `find_bit`.
import "../../mod.ts";
import type { HasDataLayout, Size } from "../../../../rustc_abi/lib.ts";
import { unported } from "../../../../std/panic.ts";
import type { Result } from "../../../../std/result.ts";
import type { Hasher } from "../../../../vendor/rustc_stable_hash/lib.ts";
import type { TyDecoder } from "../../../ty/codec.ts";
import type { Range } from "../../../ty/decls.ts";
import type { AllocRange } from "../allocation.ts";
import * as gen from "./init_mask.gen.ts";
import { type Block, InitChunkIter, InitCopy, InitMask, InitMaskMaterialized } from "./init_mask.gen.ts";
export * from "./init_mask.gen.ts";

declare module "./init_mask.gen.ts" {
  interface InitChunkIter extends IterableIterator<InitChunk> {}
}
// PORT: `IntoIterator` of the `Iterator` impl (JS iteration over `next()`).
(InitChunkIter.prototype as unknown as { [Symbol.iterator](): unknown })[Symbol.iterator] = function (this: unknown): unknown {
  return this;
};

declare module "./init_mask.gen.ts" {
  namespace InitMask {
    // interpret/allocation/init_mask.rs:38 (lane mir-interp-a)
    function new_(size: Size, state: boolean): InitMask;
    export { new_ as new };
  }
}

declare module "./init_mask.gen.ts" {
  interface InitMask {
    // interpret/allocation/init_mask.rs:49 (lane mir-interp-a)
    is_range_initialized(range: AllocRange): Result<undefined, AllocRange>;
    // interpret/allocation/init_mask.rs:69 (lane mir-interp-a)
    set_range(range: AllocRange, new_state: boolean): void;
    // interpret/allocation/init_mask.rs:163 (lane mir-interp-a)
    materialize_blocks(): InitMaskMaterialized;
    // interpret/allocation/init_mask.rs:176 (lane mir-interp-a)
    get(idx: Size): boolean;
    // interpret/allocation/init_mask.rs:585 (lane mir-interp-a)
    range_as_init_chunks(range: AllocRange): InitChunkIter;
    // interpret/allocation/init_mask.rs:670 (lane mir-interp-a)
    prepare_copy(range: AllocRange): InitCopy;
    // interpret/allocation/init_mask.rs:699 (lane mir-interp-a)
    apply_copy(defined: InitCopy, range: AllocRange, repeat: number): void;
  }
}

declare module "./init_mask.gen.ts" {
  namespace InitMaskMaterialized {
    // interpret/allocation/init_mask.rs:248 (lane mir-interp-a)
    function new_(size: Size, state: boolean): InitMaskMaterialized;
    export { new_ as new };
    // interpret/allocation/init_mask.rs:255 (lane mir-interp-a)
    export function bit_index(bits: Size): [number, number];
    // interpret/allocation/init_mask.rs:266 (lane mir-interp-a)
    export function size_from_bit_index(block: number, bit: number): Size;
  }
}

declare module "./init_mask.gen.ts" {
  interface InitMaskMaterialized {
    // interpret/allocation/init_mask.rs:277 (lane mir-interp-a)
    is_range_initialized(start: Size, end: Size): Result<undefined, AllocRange>;
    // interpret/allocation/init_mask.rs:289 (lane mir-interp-a)
    set_range_inbounds(start: Size, end: Size, new_state: boolean): void;
    // interpret/allocation/init_mask.rs:334 (lane mir-interp-a)
    get(i: Size): boolean;
    // interpret/allocation/init_mask.rs:339 (lane mir-interp-a)
    grow(len: Size, amount: Size, new_state: boolean): void;
    // interpret/allocation/init_mask.rs:366 (lane mir-interp-a)
    find_bit(start: Size, end: Size, is_init: boolean): Size | undefined;
  }
}

export interface InitChunk_methods {
    // interpret/allocation/init_mask.rs:559 (lane mir-interp-a)
    is_init(self: InitChunk): boolean;
    // interpret/allocation/init_mask.rs:567 (lane mir-interp-a)
    range(self: InitChunk): Range<Size>;
}
export type InitChunk = gen.InitChunk;
export const InitChunk = {} as InitChunk_methods;

declare module "./init_mask.gen.ts" {
  interface InitChunkIter {
    // interpret/allocation/init_mask.rs:618 (lane mir-interp-a) impl Iterator
    next(): IteratorResult<InitChunk>;
  }
}

declare module "./init_mask.gen.ts" {
  interface InitCopy {
    // interpret/allocation/init_mask.rs:657 (lane mir-interp-a)
    no_bytes_init(): boolean;
  }
}

// stub: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:38 new (lane mir-interp-a)
(InitMask as unknown as { new: typeof InitMask.new }).new = function (size: Size, state: boolean): InitMask {
  return unported("rustc_middle::mir::interpret::allocation::init_mask::InitMask::new");
};


// stub: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:49 is_range_initialized (lane mir-interp-a)
InitMask.prototype.is_range_initialized = function (this: InitMask, range: AllocRange): Result<undefined, AllocRange> {
  return unported("rustc_middle::mir::interpret::allocation::init_mask::InitMask::is_range_initialized");
};


// stub: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:69 set_range (lane mir-interp-a)
InitMask.prototype.set_range = function (this: InitMask, range: AllocRange, new_state: boolean): void {
  return unported("rustc_middle::mir::interpret::allocation::init_mask::InitMask::set_range");
};


// stub: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:163 materialize_blocks (lane mir-interp-a)
InitMask.prototype.materialize_blocks = function (this: InitMask): InitMaskMaterialized {
  return unported("rustc_middle::mir::interpret::allocation::init_mask::InitMask::materialize_blocks");
};


// stub: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:176 get (lane mir-interp-a)
InitMask.prototype.get = function (this: InitMask, idx: Size): boolean {
  return unported("rustc_middle::mir::interpret::allocation::init_mask::InitMask::get");
};


// rustc-skip: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:198 encode Encodable (metadata encoding, M5)

// stub: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:208 decode (lane mir-interp-a)
export function decode_InitMaskMaterialized(decoder: TyDecoder): InitMaskMaterialized {
  return unported("rustc_middle::mir::interpret::allocation::init_mask::<InitMaskMaterialized as Decodable>::decode");
}


// stub: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:225 hash (lane mir-interp-a)
export function hash_InitMaskMaterialized(self: InitMaskMaterialized, state: Hasher): void {
  return unported("rustc_middle::mir::interpret::allocation::init_mask::<InitMaskMaterialized as Hash>::hash");
}


// stub: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:248 new (lane mir-interp-a)
(InitMaskMaterialized as unknown as { new: typeof InitMaskMaterialized.new }).new = function (size: Size, state: boolean): InitMaskMaterialized {
  return unported("rustc_middle::mir::interpret::allocation::init_mask::InitMaskMaterialized::new");
};


// stub: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:255 bit_index (lane mir-interp-a)
(InitMaskMaterialized as unknown as { bit_index: typeof InitMaskMaterialized.bit_index }).bit_index = function (bits: Size): [number, number] {
  return unported("rustc_middle::mir::interpret::allocation::init_mask::InitMaskMaterialized::bit_index");
};


// stub: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:266 size_from_bit_index (lane mir-interp-a)
(InitMaskMaterialized as unknown as { size_from_bit_index: typeof InitMaskMaterialized.size_from_bit_index }).size_from_bit_index = function (block: number, bit: number): Size {
  return unported("rustc_middle::mir::interpret::allocation::init_mask::InitMaskMaterialized::size_from_bit_index");
};


// stub: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:277 is_range_initialized (lane mir-interp-a)
InitMaskMaterialized.prototype.is_range_initialized = function (this: InitMaskMaterialized, start: Size, end: Size): Result<undefined, AllocRange> {
  return unported("rustc_middle::mir::interpret::allocation::init_mask::InitMaskMaterialized::is_range_initialized");
};


// stub: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:289 set_range_inbounds (lane mir-interp-a)
InitMaskMaterialized.prototype.set_range_inbounds = function (this: InitMaskMaterialized, start: Size, end: Size, new_state: boolean): void {
  return unported("rustc_middle::mir::interpret::allocation::init_mask::InitMaskMaterialized::set_range_inbounds");
};


// stub: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:334 get (lane mir-interp-a)
InitMaskMaterialized.prototype.get = function (this: InitMaskMaterialized, i: Size): boolean {
  return unported("rustc_middle::mir::interpret::allocation::init_mask::InitMaskMaterialized::get");
};


// stub: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:339 grow (lane mir-interp-a)
InitMaskMaterialized.prototype.grow = function (this: InitMaskMaterialized, len: Size, amount: Size, new_state: boolean): void {
  return unported("rustc_middle::mir::interpret::allocation::init_mask::InitMaskMaterialized::grow");
};


// stub: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:366 find_bit (lane mir-interp-a)
InitMaskMaterialized.prototype.find_bit = function (this: InitMaskMaterialized, start: Size, end: Size, is_init: boolean): Size | undefined {
  return unported("rustc_middle::mir::interpret::allocation::init_mask::InitMaskMaterialized::find_bit");
};


// stub: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:379 find_bit_fast (lane mir-interp-a)
// PORT: nested fn of impl InitMaskMaterialized > fn find_bit; a module-level stub until its lane ports it inside the parent.
function find_bit_fast(init_mask: InitMaskMaterialized, start: Size, end: Size, is_init: boolean): Size | undefined {
  return unported("rustc_middle::mir::interpret::allocation::init_mask::find_bit_fast");
}


// stub: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:386 search_block (lane mir-interp-a)
// PORT: nested fn of impl InitMaskMaterialized > fn find_bit > fn find_bit_fast; a module-level stub until its lane ports it inside the parent.
function search_block(bits: Block, block: number, start_bit: number, is_init: boolean): Size | undefined {
  return unported("rustc_middle::mir::interpret::allocation::init_mask::search_block");
}


// stub: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:530 find_bit_slow (lane mir-interp-a)
// PORT: nested fn of impl InitMaskMaterialized > fn find_bit; a module-level stub until its lane ports it inside the parent.
function find_bit_slow(init_mask: InitMaskMaterialized, start: Size, end: Size, is_init: boolean): Size | undefined {
  return unported("rustc_middle::mir::interpret::allocation::init_mask::find_bit_slow");
}


// stub: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:559 is_init (lane mir-interp-a)
InitChunk.is_init = function (self: InitChunk): boolean {
  return unported("rustc_middle::mir::interpret::allocation::init_mask::InitChunk::is_init");
};


// stub: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:567 range (lane mir-interp-a)
InitChunk.range = function (self: InitChunk): Range<Size> {
  return unported("rustc_middle::mir::interpret::allocation::init_mask::InitChunk::range");
};


// stub: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:585 range_as_init_chunks (lane mir-interp-a)
InitMask.prototype.range_as_init_chunks = function (this: InitMask, range: AllocRange): InitChunkIter {
  return unported("rustc_middle::mir::interpret::allocation::init_mask::InitMask::range_as_init_chunks");
};


// stub: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:618 next (lane mir-interp-a)
InitChunkIter.prototype.next = function (this: InitChunkIter): IteratorResult<InitChunk> {
  return unported("rustc_middle::mir::interpret::allocation::init_mask::<InitChunkIter as Iterator>::next");
};


// stub: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:657 no_bytes_init (lane mir-interp-a)
InitCopy.prototype.no_bytes_init = function (this: InitCopy): boolean {
  return unported("rustc_middle::mir::interpret::allocation::init_mask::InitCopy::no_bytes_init");
};


// stub: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:670 prepare_copy (lane mir-interp-a)
InitMask.prototype.prepare_copy = function (this: InitMask, range: AllocRange): InitCopy {
  return unported("rustc_middle::mir::interpret::allocation::init_mask::InitMask::prepare_copy");
};


// stub: compiler/rustc_middle/src/mir/interpret/allocation/init_mask.rs:699 apply_copy (lane mir-interp-a)
InitMask.prototype.apply_copy = function (this: InitMask, defined: InitCopy, range: AllocRange, repeat: number): void {
  return unported("rustc_middle::mir::interpret::allocation::init_mask::InitMask::apply_copy");
};
