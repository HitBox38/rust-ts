// Port of compiler/rustc_middle/src/mir/interpret/mod.rs (lane mir-contract, plan-m4 D3 / D8 / D13). The file's types are
// generated into mod.gen.ts (set rustc_middle_mir); `AllocId` (a branded number) and `AllocMap` are hand-written below.
// The fns are stubs for lane mir-interp-b (docs/handoff/mir-contract.md "How to fill a stub"); the `impl TyCtxt` ones are
// installed by `install_TyCtxt_methods` (init order, see mir/consts.ts). D13: `AllocId`s are numbered in exactly
// upstream's interning order (`AllocMap::reserve`).
//! An interpreter for MIR used in CTFE and by miri.
import "../mod.ts";
import type { AddressSpace, Align, Endian, HasDataLayout, Size } from "../../../rustc_abi/lib.ts";
import type { Mutability } from "../../../rustc_ast_ir/lib.ts";
import type { DefId, LocalDefId } from "../../../rustc_span/def_id.ts";
import type { KeyedMap } from "../../../rust_ts/keyed.ts";
import { type Debug, type Fmt, PLAIN } from "../../../std/fmt.ts";
import type { IoError } from "../../../std/io.ts";
import { unported } from "../../../std/panic.ts";
import type { Result } from "../../../std/result.ts";
import { TyCtxt } from "../../ty/context.ts";
import type { TyDecoder } from "../../ty/codec.ts";
import type { Instance, Ty, TypingEnv } from "../../ty/decls.ts";
import type { List } from "../../ty/list.ts";
import type { PolyExistentialPredicate, PolyExistentialTraitRef } from "../../ty/predicate.ts";
import type { ConstAllocation } from "./allocation.ts";
import * as gen from "./mod.gen.ts";
import { AllocDecodingSession, AllocDecodingState, GlobalId } from "./mod.gen.ts";
export * from "./mod.gen.ts";
export * from "./allocation.ts";
export * from "./error.ts";
export * from "./pointer.ts";
export * from "./value.ts";
import "./queries.ts"; // `mod queries;` (only `impl TyCtxt` methods: installed by rustc_middle/lib.ts)

// rustc-type: compiler/rustc_middle/src/mir/interpret/mod.rs:77 AllocId
/** `AllocId(NonZero<u64>)`: PORTING §5 interned handle (a branded number; ids are sequential from 1). */
export type AllocId = number & { readonly __brand: "AllocId" };
export interface AllocId_methods {}
export const AllocId = {} as AllocId_methods;
/** derive(Clone) of a `Copy` handle. */
export function clone_AllocId(v: AllocId): AllocId {
  return v;
}

export const CTFE_ALLOC_SALT = 0;

declare module "./mod.gen.ts" {
  interface GlobalId {
    // interpret/mod.rs:66 (lane mir-interp-b)
    display(tcx: TyCtxt): string;
  }
}

declare module "./mod.gen.ts" {
  interface AllocDecodingState {
    // interpret/mod.rs:158 (lane mir-interp-b)
    new_decoding_session(): AllocDecodingSession;
  }
}

declare module "./mod.gen.ts" {
  namespace AllocDecodingState {
    // interpret/mod.rs:162 (lane mir-interp-b)
    function new_(data_offsets: number[]): AllocDecodingState;
    export { new_ as new };
  }
}

declare module "./mod.gen.ts" {
  interface AllocDecodingSession {
    // interpret/mod.rs:177 (lane mir-interp-b)
    decode_alloc_id(decoder: TyDecoder): AllocId;
  }
}

export interface GlobalAlloc_methods {
    // interpret/mod.rs:277 (lane mir-interp-b)
    unwrap_memory(self: GlobalAlloc): ConstAllocation;
    // interpret/mod.rs:287 (lane mir-interp-b)
    unwrap_fn(self: GlobalAlloc): Instance;
    // interpret/mod.rs:297 (lane mir-interp-b)
    unwrap_vtable(self: GlobalAlloc): [Ty, PolyExistentialTraitRef | undefined];
    // interpret/mod.rs:306 (lane mir-interp-b)
    address_space(self: GlobalAlloc, cx: HasDataLayout): AddressSpace;
    // interpret/mod.rs:316 (lane mir-interp-b)
    mutability(self: GlobalAlloc, tcx: TyCtxt, typing_env: TypingEnv): Mutability;
    // interpret/mod.rs:355 (lane mir-interp-b)
    size_and_align(self: GlobalAlloc, tcx: TyCtxt, typing_env: TypingEnv): [Size, Align];
}
export type GlobalAlloc = gen.GlobalAlloc;
export const GlobalAlloc = {} as GlobalAlloc_methods;

declare module "../../ty/context.ts" {
  interface TyCtxt {
    // interpret/mod.rs:457 (lane mir-interp-b)
    reserve_alloc_id(): AllocId;
    // interpret/mod.rs:463 (lane mir-interp-b)
    reserve_and_set_dedup(alloc: GlobalAlloc, salt: number): AllocId;
    // interpret/mod.rs:485 (lane mir-interp-b)
    reserve_and_set_memory_dedup(mem: ConstAllocation, salt: number): AllocId;
    // interpret/mod.rs:491 (lane mir-interp-b)
    reserve_and_set_static_alloc(static_id: DefId): AllocId;
    // interpret/mod.rs:497 (lane mir-interp-b)
    reserve_and_set_fn_alloc(instance: Instance, salt: number): AllocId;
    // interpret/mod.rs:502 (lane mir-interp-b)
    reserve_and_set_vtable_alloc(ty: Ty, dyn_ty: List<PolyExistentialPredicate>, salt: number): AllocId;
    // interpret/mod.rs:512 (lane mir-interp-b)
    reserve_and_set_type_id_alloc(ty: Ty): AllocId;
    // interpret/mod.rs:521 (lane mir-interp-b)
    reserve_and_set_memory_alloc(mem: ConstAllocation): AllocId;
    // interpret/mod.rs:533 (lane mir-interp-b)
    try_get_global_alloc(id: AllocId): GlobalAlloc | undefined;
    // interpret/mod.rs:543 (lane mir-interp-b)
    global_alloc(id: AllocId): GlobalAlloc;
    // interpret/mod.rs:553 (lane mir-interp-b)
    set_alloc_id_memory(id: AllocId, mem: ConstAllocation): void;
    // interpret/mod.rs:560 (lane mir-interp-b)
    set_nested_alloc_id_static(id: AllocId, def_id: LocalDefId): void;
  }
}

// stub: compiler/rustc_middle/src/mir/interpret/mod.rs:66 display (lane mir-interp-b)
GlobalId.prototype.display = function (this: GlobalId, tcx: TyCtxt): string {
  return unported("rustc_middle::mir::interpret::GlobalId::display");
};


// AllocId show up in const-eval error messages
// impl fmt::Display for AllocId
// rustc: compiler/rustc_middle/src/mir/interpret/mod.rs:81 fmt
export function display_AllocId(self: AllocId, f: Fmt = PLAIN): string {
  if (f.alternate) {
    return `a${self}`;
  } else {
    return `alloc${self}`;
  }
}

// We want the `Debug` output to be readable as it is used by `derive(Debug)` for
// all the Miri types.
// impl fmt::Debug for AllocId
// rustc: compiler/rustc_middle/src/mir/interpret/mod.rs:89 fmt
export const debug_AllocId: Debug<AllocId> = (self, f) => {
  // Dispatch to `Display` impl.
  return display_AllocId(self, f);
};

// rustc-skip: compiler/rustc_middle/src/mir/interpret/mod.rs:104 specialized_encode_alloc_id Encodable (metadata encoding, M5)

// stub: compiler/rustc_middle/src/mir/interpret/mod.rs:158 new_decoding_session (lane mir-interp-b)
AllocDecodingState.prototype.new_decoding_session = function (this: AllocDecodingState): AllocDecodingSession {
  return unported("rustc_middle::mir::interpret::AllocDecodingState::new_decoding_session");
};


// stub: compiler/rustc_middle/src/mir/interpret/mod.rs:162 new (lane mir-interp-b)
(AllocDecodingState as unknown as { new: typeof AllocDecodingState.new }).new = function (data_offsets: number[]): AllocDecodingState {
  return unported("rustc_middle::mir::interpret::AllocDecodingState::new");
};


// stub: compiler/rustc_middle/src/mir/interpret/mod.rs:177 decode_alloc_id (lane mir-interp-b)
AllocDecodingSession.prototype.decode_alloc_id = function (this: AllocDecodingSession, decoder: TyDecoder): AllocId {
  return unported("rustc_middle::mir::interpret::AllocDecodingSession::decode_alloc_id");
};


// stub: compiler/rustc_middle/src/mir/interpret/mod.rs:277 unwrap_memory (lane mir-interp-b)
GlobalAlloc.unwrap_memory = function (self: GlobalAlloc): ConstAllocation {
  return unported("rustc_middle::mir::interpret::GlobalAlloc::unwrap_memory");
};


// stub: compiler/rustc_middle/src/mir/interpret/mod.rs:287 unwrap_fn (lane mir-interp-b)
GlobalAlloc.unwrap_fn = function (self: GlobalAlloc): Instance {
  return unported("rustc_middle::mir::interpret::GlobalAlloc::unwrap_fn");
};


// stub: compiler/rustc_middle/src/mir/interpret/mod.rs:297 unwrap_vtable (lane mir-interp-b)
GlobalAlloc.unwrap_vtable = function (self: GlobalAlloc): [Ty, PolyExistentialTraitRef | undefined] {
  return unported("rustc_middle::mir::interpret::GlobalAlloc::unwrap_vtable");
};


// stub: compiler/rustc_middle/src/mir/interpret/mod.rs:306 address_space (lane mir-interp-b)
GlobalAlloc.address_space = function (self: GlobalAlloc, cx: HasDataLayout): AddressSpace {
  return unported("rustc_middle::mir::interpret::GlobalAlloc::address_space");
};


// stub: compiler/rustc_middle/src/mir/interpret/mod.rs:316 mutability (lane mir-interp-b)
GlobalAlloc.mutability = function (self: GlobalAlloc, tcx: TyCtxt, typing_env: TypingEnv): Mutability {
  return unported("rustc_middle::mir::interpret::GlobalAlloc::mutability");
};


// stub: compiler/rustc_middle/src/mir/interpret/mod.rs:355 size_and_align (lane mir-interp-b)
GlobalAlloc.size_and_align = function (self: GlobalAlloc, tcx: TyCtxt, typing_env: TypingEnv): [Size, Align] {
  return unported("rustc_middle::mir::interpret::GlobalAlloc::size_and_align");
};


// rustc-type: compiler/rustc_middle/src/mir/interpret/mod.rs:413 AllocMap
/**
 * PORT: `ShardedHashMap<AllocId, GlobalAlloc>` is a `Map` (`AllocId` is a number); `Lock<FxHashMap<(GlobalAlloc, usize),
 * AllocId>>` a `KeyedMap` keyed by the derived `Hash` / `Eq` of the pair (`intern_key`); `AtomicU64` a number (ids stay
 * below 2^53).
 */
export class AllocMap {
  constructor(
    /// Maps `AllocId`s to their corresponding allocations.
    public to_alloc: Map<AllocId, GlobalAlloc>,
    /// Used to deduplicate global allocations: functions, vtables, string literals, ...
    ///
    /// The `usize` is a "salt" used by Miri to make deduplication imperfect, thus better emulating
    /// the actual guarantees.
    public dedup: KeyedMap<[GlobalAlloc, number], AllocId>,
    /// The `AllocId` to assign to the next requested ID.
    /// Always incremented; never gets smaller.
    public next_id: number,
  ) {}

  // stub: compiler/rustc_middle/src/mir/interpret/mod.rs:435 new (lane mir-interp-b)
  static new(): AllocMap {
    return unported("rustc_middle::mir::interpret::AllocMap::new");
  }


  // stub: compiler/rustc_middle/src/mir/interpret/mod.rs:442 reserve (lane mir-interp-b)
  reserve(): AllocId {
    return unported("rustc_middle::mir::interpret::AllocMap::reserve");
  }
}

/** PORT (init order, see mir/consts.ts): puts this file's `impl TyCtxt` methods on `TyCtxt.prototype` (rustc_middle/lib.ts). */
export function install_TyCtxt_methods(): void {
  // stub: compiler/rustc_middle/src/mir/interpret/mod.rs:457 reserve_alloc_id (lane mir-interp-b)
  TyCtxt.prototype.reserve_alloc_id = function (this: TyCtxt): AllocId {
    return unported("rustc_middle::mir::interpret::TyCtxt::reserve_alloc_id");
  };


  // stub: compiler/rustc_middle/src/mir/interpret/mod.rs:463 reserve_and_set_dedup (lane mir-interp-b)
  TyCtxt.prototype.reserve_and_set_dedup = function (this: TyCtxt, alloc: GlobalAlloc, salt: number): AllocId {
    return unported("rustc_middle::mir::interpret::TyCtxt::reserve_and_set_dedup");
  };


  // stub: compiler/rustc_middle/src/mir/interpret/mod.rs:485 reserve_and_set_memory_dedup (lane mir-interp-b)
  TyCtxt.prototype.reserve_and_set_memory_dedup = function (this: TyCtxt, mem: ConstAllocation, salt: number): AllocId {
    return unported("rustc_middle::mir::interpret::TyCtxt::reserve_and_set_memory_dedup");
  };


  // stub: compiler/rustc_middle/src/mir/interpret/mod.rs:491 reserve_and_set_static_alloc (lane mir-interp-b)
  TyCtxt.prototype.reserve_and_set_static_alloc = function (this: TyCtxt, static_id: DefId): AllocId {
    return unported("rustc_middle::mir::interpret::TyCtxt::reserve_and_set_static_alloc");
  };


  // stub: compiler/rustc_middle/src/mir/interpret/mod.rs:497 reserve_and_set_fn_alloc (lane mir-interp-b)
  TyCtxt.prototype.reserve_and_set_fn_alloc = function (this: TyCtxt, instance: Instance, salt: number): AllocId {
    return unported("rustc_middle::mir::interpret::TyCtxt::reserve_and_set_fn_alloc");
  };


  // stub: compiler/rustc_middle/src/mir/interpret/mod.rs:502 reserve_and_set_vtable_alloc (lane mir-interp-b)
  TyCtxt.prototype.reserve_and_set_vtable_alloc = function (this: TyCtxt, ty: Ty, dyn_ty: List<PolyExistentialPredicate>, salt: number): AllocId {
    return unported("rustc_middle::mir::interpret::TyCtxt::reserve_and_set_vtable_alloc");
  };


  // stub: compiler/rustc_middle/src/mir/interpret/mod.rs:512 reserve_and_set_type_id_alloc (lane mir-interp-b)
  TyCtxt.prototype.reserve_and_set_type_id_alloc = function (this: TyCtxt, ty: Ty): AllocId {
    return unported("rustc_middle::mir::interpret::TyCtxt::reserve_and_set_type_id_alloc");
  };


  // stub: compiler/rustc_middle/src/mir/interpret/mod.rs:521 reserve_and_set_memory_alloc (lane mir-interp-b)
  TyCtxt.prototype.reserve_and_set_memory_alloc = function (this: TyCtxt, mem: ConstAllocation): AllocId {
    return unported("rustc_middle::mir::interpret::TyCtxt::reserve_and_set_memory_alloc");
  };


  // stub: compiler/rustc_middle/src/mir/interpret/mod.rs:533 try_get_global_alloc (lane mir-interp-b)
  TyCtxt.prototype.try_get_global_alloc = function (this: TyCtxt, id: AllocId): GlobalAlloc | undefined {
    return unported("rustc_middle::mir::interpret::TyCtxt::try_get_global_alloc");
  };


  // stub: compiler/rustc_middle/src/mir/interpret/mod.rs:543 global_alloc (lane mir-interp-b)
  TyCtxt.prototype.global_alloc = function (this: TyCtxt, id: AllocId): GlobalAlloc {
    return unported("rustc_middle::mir::interpret::TyCtxt::global_alloc");
  };


  // stub: compiler/rustc_middle/src/mir/interpret/mod.rs:553 set_alloc_id_memory (lane mir-interp-b)
  TyCtxt.prototype.set_alloc_id_memory = function (this: TyCtxt, id: AllocId, mem: ConstAllocation): void {
    return unported("rustc_middle::mir::interpret::TyCtxt::set_alloc_id_memory");
  };


  // stub: compiler/rustc_middle/src/mir/interpret/mod.rs:560 set_nested_alloc_id_static (lane mir-interp-b)
  TyCtxt.prototype.set_nested_alloc_id_static = function (this: TyCtxt, id: AllocId, def_id: LocalDefId): void {
    return unported("rustc_middle::mir::interpret::TyCtxt::set_nested_alloc_id_static");
  };

}


// stub: compiler/rustc_middle/src/mir/interpret/mod.rs:570 write_target_uint (lane mir-interp-b)
export function write_target_uint(endianness: Endian, target: Uint8Array, data: bigint): Result<undefined, IoError> {
  return unported("rustc_middle::mir::interpret::write_target_uint");
}


// stub: compiler/rustc_middle/src/mir/interpret/mod.rs:586 read_target_uint (lane mir-interp-b)
export function read_target_uint(endianness: Endian, source: Uint8Array): Result<bigint, IoError> {
  return unported("rustc_middle::mir::interpret::read_target_uint");
}
