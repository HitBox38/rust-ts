// Port of compiler/rustc_middle/src/mir/interpret/mod.rs (lanes mir-contract, mir-interp-b; plan-m4 D3 / D8 / D13). The
// file's types are generated into mod.gen.ts (set rustc_middle_mir); `AllocId` (a branded number) and `AllocMap` are
// hand-written below. The `impl TyCtxt` fns are installed by `install_TyCtxt_methods` (init order, see mir/consts.ts).
// D13: `AllocId`s are numbered in exactly upstream's interning order (`AllocMap::reserve`).
// PORT (init order R4): ty/print/pretty.ts, ty/instance.ts, ty/codec.ts and ty/codec/ref_decodable.ts are read lazily.
//! An interpreter for MIR used in CTFE and by miri.
import "../mod.ts";
import { AddressSpace, Align, Align_max, type Endian, type HasDataLayout, Size } from "../../../rustc_abi/lib.ts";
import type { Mutability } from "../../../rustc_ast_ir/lib.ts";
import { type DefId, LocalDefId } from "../../../rustc_span/def_id.ts";
import type { CodegenFnAttrs } from "../../middle/codegen_fn_attrs.ts";
import { bug } from "../../../rustc_span/macros.ts";
import { intern_key } from "../../../rust_ts/intern_key.ts";
import { KeyedMap } from "../../../rust_ts/keyed.ts";
import { type Debug, type Fmt, PLAIN } from "../../../std/fmt.ts";
import type { IoError } from "../../../std/io.ts";
import { assert, panic, unported, unwrap } from "../../../std/panic.ts";
import { Ok, type Result, unwrap_result } from "../../../std/result.ts";
import { EarlyBinder } from "../../../rustc_type_ir/binder.ts";
import { debug_Promoted } from "../mod.ts";
import { TyCtxt } from "../../ty/context.ts";
import type { TyDecoder, TyEncoder } from "../../ty/codec.ts";
import type { Instance, Ty, TypingEnv } from "../../ty/decls.ts";
import type { List } from "../../ty/list.ts";
import type { PolyExistentialPredicate, PolyExistentialTraitRef } from "../../ty/predicate.ts";
import type { ConstAllocation } from "./allocation.ts";
import * as gen from "./mod.gen.ts";
import { debug_LayoutError_lazy } from "./error.ts";
import { AllocDecodingSession, AllocDecodingState, type AllocDiscriminant, clone_GlobalAlloc, debug_GlobalAlloc, GlobalId, State } from "./mod.gen.ts";
import { debug_ErrorHandled } from "./error.gen.ts";
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

/** ty/print/pretty.ts, read lazily (module header). */
function pretty(): typeof import("../../ty/print/pretty.ts") {
  return (pretty__m ??= require("../../ty/print/pretty.ts") as typeof import("../../ty/print/pretty.ts"));
}
var pretty__m: typeof import("../../ty/print/pretty.ts") | undefined;
/** ty/instance.ts, read lazily (module header). */
function ty_instance(): typeof import("../../ty/instance.ts") {
  return (ty_instance__m ??= require("../../ty/instance.ts") as typeof import("../../ty/instance.ts"));
}
var ty_instance__m: typeof import("../../ty/instance.ts") | undefined;
/** ty/codec.ts, read lazily (module header). */
function ty_codec(): typeof import("../../ty/codec.ts") {
  return (ty_codec__m ??= require("../../ty/codec.ts") as typeof import("../../ty/codec.ts"));
}
var ty_codec__m: typeof import("../../ty/codec.ts") | undefined;
/** ty/codec/ref_decodable.ts, read lazily (module header). */
function ty_ref_decodable(): typeof import("../../ty/codec/ref_decodable.ts") {
  return (ty_ref_decodable__m ??= require("../../ty/codec/ref_decodable.ts") as typeof import("../../ty/codec/ref_decodable.ts"));
}
var ty_ref_decodable__m: typeof import("../../ty/codec/ref_decodable.ts") | undefined;
/** ty/structural_impls.ts, read lazily (module header). */
function ty_structural_impls(): typeof import("../../ty/structural_impls.ts") {
  return (ty_structural_impls__m ??= require("../../ty/structural_impls.ts") as typeof import("../../ty/structural_impls.ts"));
}
var ty_structural_impls__m: typeof import("../../ty/structural_impls.ts") | undefined;

// rustc: compiler/rustc_middle/src/mir/interpret/mod.rs:66 display
GlobalId.prototype.display = function (this: GlobalId, tcx: TyCtxt): string {
  const instance_name = pretty().with_no_trimmed_paths(() => tcx.def_path_str(ty_instance().InstanceKind.def_id(this.instance.def)));
  const promoted = this.promoted;
  if (promoted !== undefined) {
    return `${instance_name}::${debug_Promoted(promoted, PLAIN)}`;
  } else {
    return instance_name;
  }
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

/** derive(TyDecodable) of `AllocDiscriminant` (mod.rs:95; not in the generated set). */
function decode_AllocDiscriminant(d: TyDecoder): AllocDiscriminant {
  const tag = d.read_u8();
  switch (tag) {
    case 0:
      return "Alloc";
    case 1:
      return "Fn";
    case 2:
      return "VTable";
    case 3:
      return "Static";
    case 4:
      return "Type";
    default:
      return panic(`invalid enum variant tag while decoding \`AllocDiscriminant\`, expected 0..5, actual ${tag}`);
  }
}

// stub: compiler/rustc_middle/src/mir/interpret/mod.rs:104 specialized_encode_alloc_id (lane encode-middle)
export function specialized_encode_alloc_id<E extends TyEncoder>(_encoder: E, _tcx: TyCtxt, _alloc_id: AllocId): void {
  unported("rustc_middle::mir::interpret::specialized_encode_alloc_id (lane encode-middle)");
}

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/mod.rs:158 new_decoding_session
AllocDecodingState.prototype.new_decoding_session = function (this: AllocDecodingState): AllocDecodingSession {
  return new AllocDecodingSession(this);
};


// rustc: compiler/rustc_middle/src/mir/interpret/mod.rs:162 new
(AllocDecodingState as unknown as { new: typeof AllocDecodingState.new }).new = function (data_offsets: number[]): AllocDecodingState {
  const decoding_state: State[] = [];
  for (let i = 0; i < data_offsets.length; i++) decoding_state.push(State.Empty);

  return new AllocDecodingState(decoding_state, data_offsets);
};


/// Decodes an `AllocId` in a thread-safe way.
// rustc: compiler/rustc_middle/src/mir/interpret/mod.rs:177 decode_alloc_id
AllocDecodingSession.prototype.decode_alloc_id = function (this: AllocDecodingSession, decoder: TyDecoder): AllocId {
  // Read the index of the allocation.
  const idx = decoder.read_u32();
  const pos = this.state.data_offsets[idx]!;

  // Decode the `AllocDiscriminant` now so that we know if we have to reserve an
  // `AllocId`.
  const [alloc_kind, pos_] = decoder.with_position(pos, (decoder): [AllocDiscriminant, number] => {
    const alloc_kind = decode_AllocDiscriminant(decoder);
    return [alloc_kind, decoder.position()];
  });

  // We are going to hold this lock during the entire decoding of this allocation, which may
  // require that we decode other allocations. This cannot deadlock for two reasons:
  //
  // At the time of writing, it is only possible to create an allocation that contains a pointer
  // to itself using the const_allocate intrinsic (which is for testing only), and even attempting
  // to evaluate such consts blows the stack. If we ever grow a mechanism for producing
  // cyclic allocations, we will need a new strategy for decoding that doesn't bring back
  // https://github.com/rust-lang/rust/issues/126741.
  //
  // It is also impossible to create two allocations (call them A and B) where A is a pointer to B, and B
  // is a pointer to A, because attempting to evaluate either of those consts will produce a
  // query cycle, failing compilation.
  const entry = this.state.decoding_state[idx]!;
  // Check the decoding state to see if it's already decoded or if we should
  // decode it here.
  if (entry.$ === "Done") {
    return entry._0;
  }

  // Now decode the actual data.
  const alloc_id = decoder.with_position(pos_, (decoder): AllocId => {
    switch (alloc_kind) {
      case "Alloc": {
        // trace!("creating memory alloc ID");
        const alloc = ty_codec().decode_ConstAllocation(decoder);
        // trace!("decoded alloc {:?}", alloc);
        return decoder.interner().reserve_and_set_memory_alloc(alloc);
      }
      case "Fn": {
        // trace!("creating fn alloc ID");
        const instance: Instance = ty_instance().decode_Instance(decoder);
        // trace!("decoded fn alloc instance: {:?}", instance);
        return decoder.interner().reserve_and_set_fn_alloc(instance, CTFE_ALLOC_SALT);
      }
      case "VTable": {
        // trace!("creating vtable alloc ID");
        const ty = ty_codec().decode_Ty(decoder);
        const poly_trait_ref = ty_ref_decodable().decode_List_PolyExistentialPredicate(decoder);
        // trace!("decoded vtable alloc instance: {ty:?}, {poly_trait_ref:?}");
        return decoder.interner().reserve_and_set_vtable_alloc(ty, poly_trait_ref, CTFE_ALLOC_SALT);
      }
      case "Type": {
        // trace!("creating typeid alloc ID");
        const ty = ty_codec().decode_Ty(decoder);
        // trace!("decoded typid: {ty:?}");
        return decoder.interner().reserve_and_set_type_id_alloc(ty);
      }
      case "Static": {
        // trace!("creating extern static alloc ID");
        const did = decoder.decode_def_id();
        // trace!("decoded static def-ID: {:?}", did);
        return decoder.interner().reserve_and_set_static_alloc(did);
      }
    }
  });

  this.state.decoding_state[idx] = { $: "Done", _0: alloc_id };

  return alloc_id;
};


/// Panics if the `GlobalAlloc` does not refer to an `GlobalAlloc::Memory`
// #[track_caller]
// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/mod.rs:277 unwrap_memory
GlobalAlloc.unwrap_memory = function (self: GlobalAlloc): ConstAllocation {
  if (self.$ === "Memory") {
    return self._0;
  } else {
    return bug(`expected memory, got ${debug_GlobalAlloc(self, PLAIN)}`);
  }
};


/// Panics if the `GlobalAlloc` is not `GlobalAlloc::Function`
// #[track_caller]
// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/mod.rs:287 unwrap_fn
GlobalAlloc.unwrap_fn = function (self: GlobalAlloc): Instance {
  if (self.$ === "Function") {
    return self.instance;
  } else {
    return bug(`expected function, got ${debug_GlobalAlloc(self, PLAIN)}`);
  }
};


/// Panics if the `GlobalAlloc` is not `GlobalAlloc::VTable`
// #[track_caller]
// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/mod.rs:297 unwrap_vtable
GlobalAlloc.unwrap_vtable = function (self: GlobalAlloc): [Ty, PolyExistentialTraitRef | undefined] {
  if (self.$ === "VTable") {
    return [self._0, self._1.principal()];
  } else {
    return bug(`expected vtable, got ${debug_GlobalAlloc(self, PLAIN)}`);
  }
};


/// The address space that this `GlobalAlloc` should be placed in.
// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/mod.rs:306 address_space
GlobalAlloc.address_space = function (self: GlobalAlloc, cx: HasDataLayout): AddressSpace {
  switch (self.$) {
    case "Function":
      return cx.data_layout().instruction_address_space;
    case "TypeId":
    case "Static":
    case "Memory":
    case "VTable":
      return AddressSpace.ZERO;
  }
};


// rustc: compiler/rustc_middle/src/mir/interpret/mod.rs:316 mutability
GlobalAlloc.mutability = function (self: GlobalAlloc, tcx: TyCtxt, typing_env: TypingEnv): Mutability {
  // Let's see what kind of memory we are.
  switch (self.$) {
    case "Static": {
      const did = self._0;
      const def_kind = tcx.def_kind(did);
      if (def_kind.$ !== "Static") {
        return bug();
      }
      const { mutability, nested } = def_kind;
      if (nested) {
        // Nested statics in a `static` are never interior mutable,
        // so just use the declared mutability.
        // PORT: `if cfg!(debug_assertions) { .. assert_eq!(alloc.0.mutability, mutability) }`: rustc ships without
        // debug assertions.
        return mutability;
      } else {
        let mutability_: Mutability;
        if (
          mutability === "Not" &&
          !unwrap(
            EarlyBinder.no_bound_vars(tcx.type_of(did) as EarlyBinder<Ty>, ty_structural_impls().fold_Ty),
            "statics should not have generic parameters",
          ).is_freeze(tcx, typing_env)
        ) {
          mutability_ = "Mut";
        } else {
          mutability_ = mutability;
        }
        return mutability_;
      }
    }
    case "Memory":
      return self._0.inner().mutability;
    case "TypeId":
    case "Function":
    case "VTable":
      // These are immutable.
      return "Not";
  }
};


// rustc: compiler/rustc_middle/src/mir/interpret/mod.rs:355 size_and_align
GlobalAlloc.size_and_align = function (self: GlobalAlloc, tcx: TyCtxt, typing_env: TypingEnv): [Size, Align] {
  switch (self.$) {
    case "Static": {
      const def_id = self._0;
      const def_kind = tcx.def_kind(def_id);
      if (def_kind.$ !== "Static") {
        return bug("GlobalAlloc::Static is not a static");
      }
      const { nested } = def_kind;

      if (nested) {
        // Nested anonymous statics are untyped, so let's get their
        // size and alignment from the allocation itself. This always
        // succeeds, as the query is fed at DefId creation time, so no
        // evaluation actually occurs.
        const alloc = unwrap_result(tcx.eval_static_initializer(def_id), debug_ErrorHandled);
        return [alloc.inner().size(), alloc.inner().align];
      } else {
        // Use size and align of the type for everything else. We need
        // to do that to
        // * avoid cycle errors in case of self-referential statics,
        // * be able to get information on extern statics.
        const ty = unwrap(
          EarlyBinder.no_bound_vars(tcx.type_of(def_id) as EarlyBinder<Ty>, ty_structural_impls().fold_Ty),
          "statics should not have generic parameters",
        );
        const layout = unwrap_result(tcx.layout_of(typing_env.as_query_input(ty)), debug_LayoutError_lazy);
        assert(layout.is_sized(), "assertion failed: layout.is_sized()");

        // Take over-alignment from attributes into account.
        const align_from_attribute = (tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs).alignment;
        let align: Align;
        if (align_from_attribute !== undefined) {
          align = Align_max(align_from_attribute, layout.align.abi);
        } else {
          align = layout.align.abi;
        }

        return [layout.size, align];
      }
    }
    case "Memory": {
      const alloc = self._0.inner();
      return [alloc.size(), alloc.align];
    }
    case "Function":
      return [Size.ZERO, Align.ONE];
    case "VTable":
      // No data to be accessed here. But vtables are pointer-aligned.
      return [Size.ZERO, tcx.data_layout().pointer_align().abi];
    // Fake allocation, there's nothing to access here.
    case "TypeId":
      return [Size.ZERO, Align.ONE];
  }
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
    // Note that this map on rustc workloads seems to be rather dense, but in miri workloads should
    // be pretty sparse. In #136105 we considered replacing it with a (dense) Vec-based map, but
    // since there are workloads where it can be sparse we decided to go with sharding for now. At
    // least up to 32 cores the one workload tested didn't exhibit much difference between the two.
    //
    // Should be locked *after* locking dedup if locking both to avoid deadlocks.
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

  // rustc: compiler/rustc_middle/src/mir/interpret/mod.rs:435 new
  static new(): AllocMap {
    return new AllocMap(new Map(), new KeyedMap<[GlobalAlloc, number], AllocId>(intern_key), 1);
  }

  // rustc: compiler/rustc_middle/src/mir/interpret/mod.rs:442 reserve
  reserve(): AllocId {
    // Technically there is a window here where we overflow and then another thread
    // increments `next_id` *again* and uses it before we panic and tear down the entire session.
    // We consider this fine since such overflows cannot realistically occur.
    const next_id = this.next_id;
    this.next_id = next_id + 1;
    // `AllocId(NonZero::new(next_id).unwrap())`
    if (next_id === 0) return panic("called `Option::unwrap()` on a `None` value");
    return next_id as AllocId;
  }
}

/**
 * `ShardedHashMap::insert_unique` (rustc_data_structures sharded.rs:193) without debug assertions. PORT: release rustc
 * inserts a second entry and "lookups will arbitrarily return one of the inserted elements"; hashbrown's probe meets
 * the first-inserted entry first, so the map keeps that one.
 */
function insert_unique(map: Map<AllocId, GlobalAlloc>, key: AllocId, value: GlobalAlloc): void {
  if (!map.has(key)) map.set(key, value);
}

/** PORT (init order, see mir/consts.ts): puts this file's `impl TyCtxt` methods on `TyCtxt.prototype` (rustc_middle/lib.ts). */
export function install_TyCtxt_methods(): void {
  /// Obtains a new allocation ID that can be referenced but does not
  /// yet have an allocation backing it.
  ///
  /// Make sure to call `set_alloc_id_memory` or `set_alloc_id_same_memory` before returning such
  /// an `AllocId` from a query.
  // rustc: compiler/rustc_middle/src/mir/interpret/mod.rs:457 reserve_alloc_id
  TyCtxt.prototype.reserve_alloc_id = function (this: TyCtxt): AllocId {
    return this.gcx.alloc_map.reserve();
  };


  /// Reserves a new ID *if* this allocation has not been dedup-reserved before.
  /// Should not be used for mutable memory.
  // rustc: compiler/rustc_middle/src/mir/interpret/mod.rs:463 reserve_and_set_dedup
  TyCtxt.prototype.reserve_and_set_dedup = function (this: TyCtxt, alloc: GlobalAlloc, salt: number): AllocId {
    if (alloc.$ === "Memory") {
      const mem = alloc._0;
      if (mem.inner().mutability === "Mut") {
        return bug("trying to dedup-reserve mutable memory");
      }
    }
    const alloc_salt: [GlobalAlloc, number] = [alloc, salt];
    // Locking this *before* `to_alloc` also to ensure correct lock order.
    const dedup = this.gcx.alloc_map.dedup;
    const alloc_id = dedup.get(alloc_salt);
    if (alloc_id !== undefined) {
      return alloc_id;
    }
    const id = this.gcx.alloc_map.reserve();
    // debug!("creating alloc {:?} with id {id:?}", alloc_salt.0);
    // We just reserved, so should always be unique.
    insert_unique(this.gcx.alloc_map.to_alloc, id, clone_GlobalAlloc(alloc_salt[0]));
    dedup.set(alloc_salt, id);
    return id;
  };


  /// Generates an `AllocId` for a memory allocation. If the exact same memory has been
  /// allocated before, this will return the same `AllocId`.
  // rustc: compiler/rustc_middle/src/mir/interpret/mod.rs:485 reserve_and_set_memory_dedup
  TyCtxt.prototype.reserve_and_set_memory_dedup = function (this: TyCtxt, mem: ConstAllocation, salt: number): AllocId {
    return this.reserve_and_set_dedup({ $: "Memory", _0: mem }, salt);
  };


  /// Generates an `AllocId` for a static or return a cached one in case this function has been
  /// called on the same static before.
  // rustc: compiler/rustc_middle/src/mir/interpret/mod.rs:491 reserve_and_set_static_alloc
  TyCtxt.prototype.reserve_and_set_static_alloc = function (this: TyCtxt, static_id: DefId): AllocId {
    const salt = 0; // Statics have a guaranteed unique address, no salt added.
    return this.reserve_and_set_dedup({ $: "Static", _0: static_id }, salt);
  };


  /// Generates an `AllocId` for a function. Will get deduplicated.
  // rustc: compiler/rustc_middle/src/mir/interpret/mod.rs:497 reserve_and_set_fn_alloc
  TyCtxt.prototype.reserve_and_set_fn_alloc = function (this: TyCtxt, instance: Instance, salt: number): AllocId {
    return this.reserve_and_set_dedup({ $: "Function", instance }, salt);
  };


  /// Generates an `AllocId` for a (symbolic, not-reified) vtable. Will get deduplicated.
  // rustc: compiler/rustc_middle/src/mir/interpret/mod.rs:502 reserve_and_set_vtable_alloc
  TyCtxt.prototype.reserve_and_set_vtable_alloc = function (this: TyCtxt, ty: Ty, dyn_ty: List<PolyExistentialPredicate>, salt: number): AllocId {
    return this.reserve_and_set_dedup({ $: "VTable", _0: ty, _1: dyn_ty }, salt);
  };


  /// Generates an [AllocId] for a [core::any::TypeId]. Will get deduplicated.
  // rustc: compiler/rustc_middle/src/mir/interpret/mod.rs:512 reserve_and_set_type_id_alloc
  TyCtxt.prototype.reserve_and_set_type_id_alloc = function (this: TyCtxt, ty: Ty): AllocId {
    return this.reserve_and_set_dedup({ $: "TypeId", ty }, 0);
  };


  /// Interns the `Allocation` and return a new `AllocId`, even if there's already an identical
  /// `Allocation` with a different `AllocId`.
  /// Statics with identical content will still point to the same `Allocation`, i.e.,
  /// their data will be deduplicated through `Allocation` interning -- but they
  /// are different places in memory and as such need different IDs.
  // rustc: compiler/rustc_middle/src/mir/interpret/mod.rs:521 reserve_and_set_memory_alloc
  TyCtxt.prototype.reserve_and_set_memory_alloc = function (this: TyCtxt, mem: ConstAllocation): AllocId {
    const id = this.reserve_alloc_id();
    this.set_alloc_id_memory(id, mem);
    return id;
  };


  /// Returns `None` in case the `AllocId` is dangling. An `InterpretCx` can still have a
  /// local `Allocation` for that `AllocId`, but having such an `AllocId` in a constant is
  /// illegal and will likely ICE.
  /// This function exists to allow const eval to detect the difference between evaluation-
  /// local dangling pointers and allocations in constants/statics.
  // #[inline]
  // rustc: compiler/rustc_middle/src/mir/interpret/mod.rs:533 try_get_global_alloc
  TyCtxt.prototype.try_get_global_alloc = function (this: TyCtxt, id: AllocId): GlobalAlloc | undefined {
    return this.gcx.alloc_map.to_alloc.get(id);
  };


  // #[inline]
  // #[track_caller]
  /// Panics in case the `AllocId` is dangling. Since that is impossible for `AllocId`s in
  /// constants (as all constants must pass interning and validation that check for dangling
  /// ids), this function is frequently used throughout rustc, but should not be used within
  /// the interpreter.
  // rustc: compiler/rustc_middle/src/mir/interpret/mod.rs:543 global_alloc
  TyCtxt.prototype.global_alloc = function (this: TyCtxt, id: AllocId): GlobalAlloc {
    const alloc = this.try_get_global_alloc(id);
    if (alloc !== undefined) {
      return alloc;
    } else {
      return bug(`could not find allocation for ${debug_AllocId(id, PLAIN)}`);
    }
  };


  /// Freezes an `AllocId` created with `reserve` by pointing it at an `Allocation`. Trying to
  /// call this function twice, even with the same `Allocation` will ICE the compiler if
  /// debug_assertions are enabled.
  // rustc: compiler/rustc_middle/src/mir/interpret/mod.rs:553 set_alloc_id_memory
  TyCtxt.prototype.set_alloc_id_memory = function (this: TyCtxt, id: AllocId, mem: ConstAllocation): void {
    insert_unique(this.gcx.alloc_map.to_alloc, id, { $: "Memory", _0: mem });
  };


  /// Freezes an `AllocId` created with `reserve` by pointing it at a static item. Trying to
  /// call this function twice, even with the same `DefId` will ICE the compiler if
  /// debug_assertions are enabled.
  // rustc: compiler/rustc_middle/src/mir/interpret/mod.rs:560 set_nested_alloc_id_static
  TyCtxt.prototype.set_nested_alloc_id_static = function (this: TyCtxt, id: AllocId, def_id: LocalDefId): void {
    insert_unique(this.gcx.alloc_map.to_alloc, id, { $: "Static", _0: LocalDefId.to_def_id(def_id) });
  };

}

////////////////////////////////////////////////////////////////////////////////
// Methods to access integers in the target endianness
////////////////////////////////////////////////////////////////////////////////

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/mod.rs:570 write_target_uint
export function write_target_uint(endianness: Endian, target: Uint8Array, data: bigint): Result<undefined, IoError> {
  // This u128 holds an "any-size uint" (since smaller uints can fits in it)
  // So we do not write all bytes of the u128, just the "payload".
  // PORT: `<&mut [u8] as io::Write>::write` copies `min(buf.len(), target.len())` bytes and never fails.
  const bytes = u128_to_le_bytes(data);
  switch (endianness) {
    case "Little":
      target.set(bytes.subarray(0, Math.min(16, target.length)));
      break;
    case "Big": {
      // `&data.to_be_bytes()[16 - target.len()..]` (panics on a range start past the end, as slicing does)
      if (target.length > 16) return panic("PORT: `16 - target.len()` out of range (a target of more than 16 bytes)");
      const be = bytes.reverse();
      target.set(be.subarray(16 - target.length));
      break;
    }
  }
  // debug_assert!(target.len() == 0); // We should have filled the target buffer.
  return Ok(undefined);
}

/** `u128::to_le_bytes` */
function u128_to_le_bytes(data: bigint): Uint8Array {
  const out = new Uint8Array(16);
  let v = BigInt.asUintN(128, data);
  for (let i = 0; i < 16; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/mod.rs:586 read_target_uint
export function read_target_uint(endianness: Endian, source: Uint8Array): Result<bigint, IoError> {
  // This u128 holds an "any-size uint" (since smaller uints can fits in it)
  const buf = new Uint8Array(16);
  // So we do not read exactly 16 bytes into the u128, just the "payload".
  // PORT: `<&[u8] as io::Read>::read_exact` into a buffer of exactly `source.len()` bytes copies them all and never
  // fails; a `source` longer than 16 bytes panics in the slicing, as upstream does.
  if (source.length > 16) {
    return panic("PORT: `buf[..source.len()]` / `buf[16 - source.len()..]` out of range (a source of more than 16 bytes)");
  }
  let uint: Result<bigint, IoError>;
  switch (endianness) {
    case "Little": {
      buf.set(source, 0);
      uint = Ok(u128_from_le_bytes(buf));
      break;
    }
    case "Big": {
      buf.set(source, 16 - source.length);
      uint = Ok(u128_from_le_bytes(buf.reverse()));
      break;
    }
  }
  // debug_assert!(source.len() == 0); // We should have consumed the source buffer.
  return uint;
}

/** `u128::from_le_bytes` */
function u128_from_le_bytes(buf: Uint8Array): bigint {
  let v = 0n;
  for (let i = 15; i >= 0; i--) v = (v << 8n) | BigInt(buf[i]!);
  return v;
}
