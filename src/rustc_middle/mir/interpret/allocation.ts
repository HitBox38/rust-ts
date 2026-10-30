// Port of compiler/rustc_middle/src/mir/interpret/allocation.rs (lane mir-contract, plan-m4 D3 / D8; fns ported by lane
// mir-interp-a). The file's types are generated into allocation.gen.ts (set rustc_middle_mir) but for `Allocation` and
// `ConstAllocation`, hand classes below.
// PORT (D8): `Bytes = Box<[u8]>` is a `Uint8Array` (`AllocBytes_Box`); byte slices handed out (`&[u8]`, `&mut [u8]`,
// `*mut u8`, `*mut [u8]`) are `Uint8Array` views (`subarray`), so writes go to the allocation. `Prov` stays a type parameter
// (default `CtfeProvenance`), `Extra = ()` is `null`. `<Bytes as AllocBytes>::AllocParams` (`()` for `Box<[u8]>`) is
// `null`. `Bytes: AllocBytes` (static dispatch on the type parameter) is `AllocBytes_Box` (`AllocBytes_of`): the only
// `AllocBytes` impl at the pin outside Miri (M6 re-generalises); `Prov::OFFSET_IS_ADDR` (no provenance value at hand) is
// `CtfeProvenance`'s (`Prov_`; both ported `Provenance` impls have `OFFSET_IS_ADDR = false`).
// PORT: `Allocation::init_mask()` / `provenance()` are `init_mask_()` / `provenance_()` (the private fields hold the names;
// mod.ts header). `ConstAllocation(Interned<Allocation>)` is a frozen class extending `Interned` (plan-m3 D2), made only
// by `TyCtxt::mk_const_alloc` (`internee` = `self.0.0`); the allocation itself is not deep-frozen (typed arrays cannot be).
// PORT: the `Decodable` impls (`impl<D: Decoder>`) are generic over the decoder (`D extends Decoder`); the decoders of a
// generic parameter are passed in (`decode_Prov`, `decode_Extra`).
// PORT: `AllocResult<()>` / `Result<(), _>` carry `undefined` (`Ok(undefined)`).
//! The virtual memory representation of the MIR interpreter.
import "../mod.ts";
import { Align, type HasDataLayout, Size, debug_Size } from "../../../rustc_abi/lib.ts";
import { debug_AlignFromBytesError } from "../../../rustc_abi/lib.ts";
import { type Mutability, Mutability_discriminant } from "../../../rustc_ast_ir/lib.ts";
import { Interned } from "../../../rustc_data_structures/intern.ts";
import { type Debug, PLAIN } from "../../../std/fmt.ts";
import { debug_IoError } from "../../../std/io.ts";
import { assert, assert_eq, panic, unported } from "../../../std/panic.ts";
import { Err, Ok, type Result, unwrap_result } from "../../../std/result.ts";
import type { Hasher } from "../../../vendor/rustc_stable_hash/lib.ts";
import type { Decoder, Encodable, Encoder } from "../../../rustc_serialize/serialize.ts";
import type { Range } from "../../ty/decls.ts";
import * as gen from "./allocation.gen.ts";
import { AllocRange, type AllocFlags, type AllocInit, type AllocResult } from "./allocation.gen.ts";
import { clone_InitMask, decode_InitMask, type InitCopy, InitMask } from "./allocation/init_mask.ts";
import { clone_ProvenanceMap, decode_ProvenanceMap, type ProvenanceCopy, ProvenanceMap } from "./allocation/provenance_map.ts";
import { InterpErrorInfo_from_InterpErrorKind, type InterpErrorKind, InterpResult, interp_ok } from "./error.ts";
import { type AllocId, read_target_uint, write_target_uint } from "./mod.ts";
import { type CtfeProvenance, Pointer, type Provenance, Provenance_CtfeProvenance } from "./pointer.ts";
import { Scalar } from "./value.ts";
export * from "./allocation.gen.ts";
export * from "./allocation/init_mask.ts";
export * from "./allocation/provenance_map.ts";

/** `ty::tls` (lazy: ty/context/tls.ts is not read at load, mir init order R2). */
function tls(): typeof import("../../ty/context/tls.ts") {
  return (tls__m ??= require("../../ty/context/tls.ts") as typeof import("../../ty/context/tls.ts"));
}
var tls__m: typeof import("../../ty/context/tls.ts") | undefined;

/** PORT (D8): `Bytes: AllocBytes` (see the header). */
function AllocBytes_of<Bytes>(): AllocBytes<Bytes> {
  return AllocBytes_Box as unknown as AllocBytes<Bytes>;
}
/** PORT (D8): `Deref<Target = [u8]>` of `Bytes: AllocBytes` (see the header). */
function deref<Bytes>(bytes: Bytes): Uint8Array {
  return bytes as unknown as Uint8Array;
}
/** PORT (D8): `Prov::OFFSET_IS_ADDR` / `Prov::WILDCARD` without a provenance value (see the header). */
function Prov_<Prov>(): Provenance<Prov> {
  return Provenance_CtfeProvenance as unknown as Provenance<Prov>;
}
/** `&bytes[start..end]` as a view, with core's slice index panics (`slice_index_fail`). */
function slice_bytes(bytes: Uint8Array, start: number, end: number): Uint8Array {
  const len = bytes.length;
  if (start > len) panic(`range start index ${start} out of range for slice of length ${len}`);
  if (end > len) panic(`range end index ${end} out of range for slice of length ${len}`);
  if (start > end) panic(`slice index starts at ${start} but ends at ${end}`);
  return bytes.subarray(start, end);
}
/** `Size == Size` (`assert_eq!`) */
function size_eq(a: Size, b: Size): boolean {
  return a.bytes() === b.bytes();
}
const debug_size_plain = (v: Size): string => debug_Size(v, PLAIN);

// rustc-trait: compiler/rustc_middle/src/mir/interpret/allocation.rs:30 AllocBytes
/// Functionality required for the bytes of an `Allocation`.
/** PORT: the trait as a descriptor over the bytes type `B` (`AllocParams` is `null` for `Box<[u8]>`). */
export interface AllocBytes<B> {
  /// Create an `AllocBytes` from a slice of `u8`.
  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:37 from_bytes
  from_bytes(slice: Uint8Array, _align: Align, _params: null): B;
  /// Create a zeroed `AllocBytes` of the specified size and alignment.
  /// Returns `None` if we ran out of memory on the host.
  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:45 zeroed
  zeroed(size: Size, _align: Align, _params: null): B | undefined;
  /// Gives direct access to the raw underlying storage.
  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:52 as_mut_ptr
  as_mut_ptr(self: B): Uint8Array;
  /// Gives direct access to the raw underlying storage.
  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:59 as_ptr
  as_ptr(self: B): Uint8Array;
}

/// Default `bytes` for `Allocation` is a `Box<u8>`.
// impl AllocBytes for Box<[u8]>
export const AllocBytes_Box: AllocBytes<Uint8Array> = {
  // PORT: `Box::<[u8]>::from(slice.into())`: always a fresh copy (a `Cow::Owned` would be moved in; nothing aliases it).
  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:66 from_bytes
  from_bytes(slice: Uint8Array, _align: Align, _params: null): Uint8Array {
    return slice.slice();
  },

  // PORT: `Box::try_new_zeroed_slice` fails when the host cannot allocate; here when the JS engine refuses the typed
  // array (`RangeError`). Upstream documents this error as host-dependent (`Allocation::new_inner`).
  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:70 zeroed
  zeroed(size: Size, _align: Align, _params: null): Uint8Array | undefined {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(size.bytes());
    } catch (e) {
      if (e instanceof RangeError) return undefined;
      throw e;
    }
    // SAFETY: the box was zero-allocated, which is a valid initial value for Box<[u8]>
    return bytes;
  },

  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:77 as_mut_ptr
  as_mut_ptr(self: Uint8Array): Uint8Array {
    return self;
  },

  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:81 as_ptr
  as_ptr(self: Uint8Array): Uint8Array {
    return self;
  },
};

/// This type represents an Allocation in the Miri/CTFE core engine.
///
/// Its public API is rather low-level, working directly with allocation offsets and a custom error
/// type to account for the lack of an AllocId on this level. The Miri/CTFE core engine `memory`
/// module provides higher-level access.
// Note: for performance reasons when interning, some of the `Allocation` fields can be partially
// hashed. (see the `Hash` impl below for more details), so the impl is not derived.
// rustc-type: compiler/rustc_middle/src/mir/interpret/allocation.rs:95 Allocation
export class Allocation<Prov = CtfeProvenance, Extra = null, Bytes = Uint8Array> {
  constructor(
    /// The actual bytes of the allocation.
    /// Note that the bytes of a pointer represent the offset of the pointer.
    public bytes: Bytes,
    /// Maps from byte addresses to extra provenance data for each pointer.
    /// Only the first byte of a pointer is inserted into the map; i.e.,
    /// every entry in this map applies to `pointer_size` consecutive bytes starting
    /// at the given offset.
    public provenance: ProvenanceMap<Prov>,
    /// Denotes which part of this allocation is initialized.
    ///
    /// Invariant: the uninitialized parts have no provenance.
    public init_mask: InitMask,
    /// The alignment of the allocation to detect unaligned reads.
    /// (`Align` guarantees that this is a power of two.)
    public align: Align,
    /// `true` if the allocation is mutable.
    /// Also used by codegen to determine if a static should be put into mutable memory,
    /// which happens for `static mut` and `static` with interior mutability.
    public mutability: Mutability,
    /// Extra state for the machine.
    public extra: Extra,
  ) {}

  // ---- The constructors are all without extra; the extra gets added by a machine hook later.
  // ---- impl<Prov: Provenance, Bytes: AllocBytes> Allocation<Prov, (), Bytes> ----
  /// Creates an allocation initialized by the given bytes
  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:390 from_bytes
  static from_bytes<Prov = CtfeProvenance, Bytes = Uint8Array>(slice: Uint8Array, align: Align, mutability: Mutability, params: null): Allocation<Prov, null, Bytes> {
    const bytes = AllocBytes_of<Bytes>().from_bytes(slice, align, params);
    const size = Size.from_bytes(deref(bytes).length);
    return new Allocation<Prov, null, Bytes>(bytes, ProvenanceMap.new<Prov>(), InitMask.new(size, true), align, mutability, null);
  }

  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:408 from_bytes_byte_aligned_immutable
  static from_bytes_byte_aligned_immutable<Prov = CtfeProvenance, Bytes = Uint8Array>(slice: Uint8Array, params: null): Allocation<Prov, null, Bytes> {
    return Allocation.from_bytes<Prov, Bytes>(slice, Align.ONE, "Not", params);
  }

  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:415 new_inner
  static new_inner<Prov, Bytes, R>(size: Size, align: Align, init: AllocInit, params: null, fail: () => R): Result<Allocation<Prov, null, Bytes>, R> {
    // We raise an error if we cannot create the allocation on the host.
    // This results in an error that can happen non-deterministically, since the memory
    // available to the compiler can change between runs. Normally queries are always
    // deterministic. However, we can be non-deterministic here because all uses of const
    // evaluation (including ConstProp!) will make compilation fail (via hard error
    // or OOM) upon encountering a `MemoryExhausted` error.
    const bytes = AllocBytes_of<Bytes>().zeroed(size, align, params);
    if (bytes === undefined) return Err(fail());

    return Ok(
      new Allocation<Prov, null, Bytes>(
        bytes,
        ProvenanceMap.new<Prov>(),
        InitMask.new(
          size,
          (() => {
            switch (init) {
              case "Uninit":
                return false;
              case "Zero":
                return true;
            }
          })(),
        ),
        align,
        "Mut",
        null,
      ),
    );
  }

  /// Try to create an Allocation of `size` bytes, failing if there is not enough memory
  /// available to the compiler to do so.
  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:448 try_new
  static try_new<Prov = CtfeProvenance, Bytes = Uint8Array>(size: Size, align: Align, init: AllocInit, params: null): InterpResult<Allocation<Prov, null, Bytes>> {
    return InterpResult.from_result(
      Allocation.new_inner<Prov, Bytes, InterpErrorKind>(size, align, init, params, () => {
        tls().with_((tcx) => tcx.dcx().delayed_bug("exhausted memory during interpretation"));
        return { $: "ResourceExhaustion", _0: "MemoryExhausted" };
      }),
      InterpErrorInfo_from_InterpErrorKind,
    );
  }

  /// Try to create an Allocation of `size` bytes. Aborts if there is not enough memory
  /// available to the compiler to do so.
  ///
  /// Example use case: To obtain an Allocation filled with specific data,
  /// first call this function and then call write_scalar to fill in the right data.
  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:466 new
  static new<Prov = CtfeProvenance, Bytes = Uint8Array>(size: Size, align: Align, init: AllocInit, params: null): Allocation<Prov, null, Bytes> {
    const r = Allocation.new_inner<Prov, Bytes, never>(size, align, init, params, () => {
      // `size` may actually be bigger than isize::MAX since it is a *target* size.
      // Clamp it to isize::MAX to still give a somewhat reasonable error message.
      // `alloc::handle_alloc_error(Layout::from_size_align(size.bytes().min(isize::MAX as u64) as usize, align.bytes_usize()).unwrap())`
      void align;
      return unported(`std::alloc::handle_alloc_error (host allocation of ${size.bytes()} bytes failed: rustc aborts)`);
    });
    switch (r.$) {
      case "Ok":
        return r._0;
      case "Err":
        return r._0;
    }
  }

  /// Add the extra.
  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:489 with_extra
  with_extra<E2>(this: Allocation<Prov, null, Bytes>, extra: E2): Allocation<Prov, E2, Bytes> {
    return new Allocation(this.bytes, this.provenance, this.init_mask, this.align, this.mutability, extra);
  }

  // ---- impl Allocation ----
  /// Adjust allocation from the ones in `tcx` to a custom Machine instance
  /// with a different `Provenance` and `Byte` type.
  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:504 adjust_from_tcx
  adjust_from_tcx<P2, B2>(this: Allocation, cx: HasDataLayout, alloc_bytes: (bytes: Uint8Array, align: Align) => InterpResult<B2>, adjust_ptr: (ptr: Pointer<CtfeProvenance>) => InterpResult<Pointer<P2>>): InterpResult<Allocation<P2, null, B2>> {
    // Copy the data.
    const bytes_r = alloc_bytes(this.bytes, this.align);
    if (bytes_r.$ === "Err") return bytes_r;
    const bytes = bytes_r._0;
    // Adjust provenance of pointers stored in this allocation.
    const new_provenance: [Size, P2][] = [];
    const ptr_size = cx.data_layout().pointer_size().bytes_usize();
    const endian = cx.data_layout().endian;
    for (const [offset, alloc_id] of this.provenance.ptrs_().iter()) {
      const idx = offset.bytes_usize();
      const ptr_bytes = slice_bytes(deref(bytes), idx, idx + ptr_size);
      const bits = unwrap_result(read_target_uint(endian, ptr_bytes), debug_IoError);
      const adjusted = adjust_ptr(Pointer.new(alloc_id, Size.from_bytes(bits)));
      if (adjusted.$ === "Err") return adjusted;
      const [ptr_prov, ptr_offset] = adjusted._0.into_raw_parts();
      unwrap_result(write_target_uint(endian, ptr_bytes, BigInt(ptr_offset.bytes())), debug_IoError);
      new_provenance.push([offset, ptr_prov]);
    }
    // Create allocation.
    return interp_ok(
      new Allocation<P2, null, B2>(bytes, ProvenanceMap.from_presorted_ptrs(new_provenance), clone_InitMask(this.init_mask), this.align, this.mutability, this.extra),
    );
  }

  // ---- Raw accessors. Provide access to otherwise private bytes.
  // ---- impl<Prov: Provenance, Extra, Bytes: AllocBytes> Allocation<Prov, Extra, Bytes> ----
  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:539 len
  len(): number {
    return deref(this.bytes).length;
  }

  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:543 size
  size(): Size {
    return Size.from_bytes(this.len());
  }

  /// Looks at a slice which may contain uninitialized bytes or provenance. This differs
  /// from `get_bytes_with_uninit_and_ptr` in that it does no provenance checks (even on the
  /// edges) at all.
  /// This must not be used for reads affecting the interpreter execution.
  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:551 inspect_with_uninit_and_ptr_outside_interpreter
  inspect_with_uninit_and_ptr_outside_interpreter(range: Range<number>): Uint8Array {
    return slice_bytes(deref(this.bytes), range.start, range.end);
  }

  /// Returns the mask indicating which bytes are initialized.
  // PORT: `init_mask()`: the field `init_mask` holds the name
  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:556 init_mask
  init_mask_(): InitMask {
    return this.init_mask;
  }

  /// Returns the provenance map.
  // PORT: `provenance()`: the field `provenance` holds the name
  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:561 provenance
  provenance_(): ProvenanceMap<Prov> {
    return this.provenance;
  }

  // ---- Byte accessors.
  /// This is the entirely abstraction-violating way to just grab the raw bytes without
  /// caring about provenance or initialization.
  ///
  /// This function also guarantees that the resulting pointer will remain stable
  /// even when new allocations are pushed to the `HashMap`. `mem_copy_repeatedly` relies
  /// on that.
  // #[inline]
  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:575 get_bytes_unchecked
  get_bytes_unchecked(range: AllocRange): Uint8Array {
    return slice_bytes(deref(this.bytes), range.start.bytes_usize(), range.end().bytes_usize());
  }

  /// Checks that these bytes are initialized, and then strip provenance (if possible) and return
  /// them.
  ///
  /// It is the caller's responsibility to check bounds and alignment beforehand.
  /// Most likely, you want to use the `PlaceTy` and `OperandTy`-based methods
  /// on `InterpCx` instead.
  // #[inline]
  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:586 get_bytes_strip_provenance
  get_bytes_strip_provenance(cx: HasDataLayout, range: AllocRange): AllocResult<Uint8Array> {
    const init = this.init_mask.is_range_initialized(range);
    if (init.$ === "Err") {
      const uninit_range = init._0;
      return Err({ $: "InvalidUninitBytes", _0: { access: range, bad: uninit_range } });
    }
    if (!Prov_<Prov>().OFFSET_IS_ADDR && !this.provenance.range_empty(range, cx)) {
      // Find the provenance.
      const next = this.provenance.get_range(range, cx).next();
      if (next.done) panic("there must be provenance somewhere here");
      const [prov_range, _prov] = next.value;
      // `prov_range.start.max(range.start)`: the pointer might begin before `range`!
      const start = range.start.bytes() >= prov_range.start.bytes() ? range.start : prov_range.start;
      // `prov_range.end().min(range.end())`: the pointer might end after `range`!
      const end = range.end().bytes() < prov_range.end().bytes() ? range.end() : prov_range.end();
      return Err({ $: "ReadPointerAsInt", _0: { access: range, bad: AllocRange_from_Range_Size({ start, end }) } });
    }
    return Ok(this.get_bytes_unchecked(range));
  }

  /// This is the entirely abstraction-violating way to just get mutable access to the raw bytes.
  /// Just calling this already marks everything as defined and removes provenance, so be sure to
  /// actually overwrite all the data there!
  ///
  /// It is the caller's responsibility to check bounds and alignment beforehand.
  /// Most likely, you want to use the `PlaceTy` and `OperandTy`-based methods
  /// on `InterpCx` instead.
  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:621 get_bytes_unchecked_for_overwrite
  get_bytes_unchecked_for_overwrite(cx: HasDataLayout, range: AllocRange): Uint8Array {
    this.mark_init(range, true);
    this.provenance.clear(range, deref(this.bytes), cx);

    return slice_bytes(deref(this.bytes), range.start.bytes_usize(), range.end().bytes_usize());
  }

  /// A raw pointer variant of `get_bytes_unchecked_for_overwrite` that avoids invalidating existing immutable aliases
  /// into this memory.
  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:634 get_bytes_unchecked_for_overwrite_ptr
  get_bytes_unchecked_for_overwrite_ptr(cx: HasDataLayout, range: AllocRange): Uint8Array {
    this.mark_init(range, true);
    this.provenance.clear(range, deref(this.bytes), cx);

    assert(range.end().bytes_usize() <= deref(this.bytes).length, "assertion failed: range.end().bytes_usize() <= self.bytes.len()"); // need to do our own bounds-check
    // Crucially, we go via `AllocBytes::as_mut_ptr`, not `AllocBytes::deref_mut`.
    const begin_ptr = range.start.bytes_usize(); // `self.bytes.as_mut_ptr().wrapping_add(range.start.bytes_usize())`
    const len = range.end().bytes_usize() - range.start.bytes_usize();
    // `ptr::slice_from_raw_parts_mut(begin_ptr, len)`
    return AllocBytes_of<Bytes>().as_mut_ptr(this.bytes).subarray(begin_ptr, begin_ptr + len);
  }

  /// This gives direct mutable access to the entire buffer, just exposing their internal state
  /// without resetting anything. Directly exposes `AllocBytes::as_mut_ptr`. Only works if
  /// `OFFSET_IS_ADDR` is true.
  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:652 get_bytes_unchecked_raw_mut
  get_bytes_unchecked_raw_mut(): Uint8Array {
    assert(Prov_<Prov>().OFFSET_IS_ADDR, "assertion failed: Prov::OFFSET_IS_ADDR");
    return AllocBytes_of<Bytes>().as_mut_ptr(this.bytes);
  }

  /// This gives direct immutable access to the entire buffer, just exposing their internal state
  /// without resetting anything. Directly exposes `AllocBytes::as_ptr`. Only works if
  /// `OFFSET_IS_ADDR` is true.
  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:660 get_bytes_unchecked_raw
  get_bytes_unchecked_raw(): Uint8Array {
    assert(Prov_<Prov>().OFFSET_IS_ADDR, "assertion failed: Prov::OFFSET_IS_ADDR");
    return AllocBytes_of<Bytes>().as_ptr(this.bytes);
  }

  // ---- Reading and writing.
  /// Sets the init bit for the given range.
  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:669 mark_init
  mark_init(range: AllocRange, is_init: boolean): void {
    if (range.size.bytes() === 0) {
      return;
    }
    assert(this.mutability === "Mut", "assertion failed: self.mutability == Mutability::Mut");
    this.init_mask.set_range(range, is_init);
  }

  /// Reads a *non-ZST* scalar.
  ///
  /// If `read_provenance` is `true`, this will also read provenance; otherwise (if the machine
  /// supports that) provenance is entirely ignored.
  ///
  /// ZSTs can't be read because in order to obtain a `Pointer`, we need to check
  /// for ZSTness anyway due to integer pointers being valid for ZSTs.
  ///
  /// It is the caller's responsibility to check bounds and alignment beforehand.
  /// Most likely, you want to call `InterpCx::read_scalar` instead of this method.
  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:687 read_scalar
  read_scalar(cx: HasDataLayout, range: AllocRange, read_provenance: boolean): AllocResult<Scalar<Prov>> {
    // First and foremost, if anything is uninit, bail.
    const init = this.init_mask.is_range_initialized(range);
    if (init.$ === "Err") {
      const bad = init._0;
      return Err({ $: "InvalidUninitBytes", _0: { access: range, bad } });
    }

    // Get the integer part of the result. We HAVE TO check provenance before returning this!
    const bytes = this.get_bytes_unchecked(range);
    const bits = unwrap_result(read_target_uint(cx.data_layout().endian, bytes), debug_IoError);

    if (read_provenance) {
      assert_eq(range.size, cx.data_layout().pointer_size(), debug_size_plain, size_eq);

      const read = this.provenance.read_ptr(range.start, cx);
      if (read.$ === "Err") return read;
      const prov = read._0;
      if (prov !== undefined) {
        // Assemble the bits with their provenance.
        const ptr = Pointer.new(prov, Size.from_bytes(bits));
        return Ok(Scalar.from_pointer(ptr, cx));
      } else {
        // Return raw bits without provenance.
        return Ok(Scalar.from_uint<Prov>(bits, range.size));
      }
    } else {
      // We are *not* reading a pointer.
      // If we can just ignore provenance or there is none, that's easy.
      if (Prov_<Prov>().OFFSET_IS_ADDR || this.provenance.range_empty(range, cx)) {
        // We just strip provenance.
        return Ok(Scalar.from_uint<Prov>(bits, range.size));
      }
      // There is some provenance and we don't have OFFSET_IS_ADDR. This doesn't work.
      return Err({ $: "ReadPointerAsInt", _0: undefined });
    }
  }

  /// Writes a *non-ZST* scalar.
  ///
  /// ZSTs can't be read because in order to obtain a `Pointer`, we need to check
  /// for ZSTness anyway due to integer pointers being valid for ZSTs.
  ///
  /// It is the caller's responsibility to check bounds and alignment beforehand.
  /// Most likely, you want to call `InterpCx::write_scalar` instead of this method.
  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:735 write_scalar
  write_scalar(cx: HasDataLayout, range: AllocRange, val: Scalar<Prov>): AllocResult<undefined> {
    assert(this.mutability === "Mut", "assertion failed: self.mutability == Mutability::Mut");

    // `to_bits_or_ptr_internal` is the right method because we just want to store this data
    // as-is into memory. This also double-checks that `val.size()` matches `range.size`.
    let bytes: bigint;
    let provenance: Prov | undefined;
    const e = Scalar.to_bits_or_ptr_internal(val, range.size);
    switch (e.$) {
      case "Right": {
        const ptr = e._0;
        const [provenance_, offset] = ptr.into_raw_parts();
        bytes = BigInt(offset.bytes());
        provenance = provenance_;
        break;
      }
      case "Left": {
        const data = e._0;
        bytes = data;
        provenance = undefined;
        break;
      }
    }

    const endian = cx.data_layout().endian;
    // Yes we do overwrite all the bytes in `dst`.
    const dst = this.get_bytes_unchecked_for_overwrite(cx, range);
    unwrap_result(write_target_uint(endian, dst, bytes), debug_IoError);

    // See if we have to also store some provenance.
    if (provenance !== undefined) {
      assert_eq(range.size, cx.data_layout().pointer_size(), debug_size_plain, size_eq);
      this.provenance.insert_ptr(range.start, provenance, cx);
    }

    return Ok(undefined);
  }

  /// Write "uninit" to the given memory range.
  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:768 write_uninit
  write_uninit(cx: HasDataLayout, range: AllocRange): void {
    this.mark_init(range, false);
    this.provenance.clear(range, deref(this.bytes), cx);
  }

  /// Mark all bytes in the given range as initialised and reset the provenance
  /// to wildcards. This entirely breaks the normal mechanisms for tracking
  /// initialisation and is only provided for Miri operating in native-lib
  /// mode. UB will be missed if the underlying bytes were not actually written to.
  ///
  /// If `range` is `None`, defaults to performing this on the whole allocation.
  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:779 process_native_write
  process_native_write(cx: HasDataLayout, range: AllocRange | undefined): void {
    const range_ = range ?? new AllocRange(Size.ZERO, Size.from_bytes(this.len()));
    this.mark_init(range_, true);
    this.provenance.write_wildcards(cx, deref(this.bytes), range_);
  }

  /// Remove all provenance in the given memory range.
  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:789 clear_provenance
  clear_provenance(cx: HasDataLayout, range: AllocRange): void {
    this.provenance.clear(range, deref(this.bytes), cx);
  }

  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:793 provenance_merge_bytes
  provenance_merge_bytes(cx: HasDataLayout): boolean {
    return this.provenance.merge_bytes(cx);
  }

  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:797 provenance_prepare_copy
  provenance_prepare_copy(range: AllocRange, cx: HasDataLayout): ProvenanceCopy<Prov> {
    return this.provenance.prepare_copy(range, deref(this.bytes), cx);
  }

  /// Applies a previously prepared provenance copy.
  /// The affected range is expected to be clear of provenance.
  ///
  /// This is dangerous to use as it can violate internal `Allocation` invariants!
  /// It only exists to support an efficient implementation of `mem_copy_repeatedly`.
  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:810 provenance_apply_copy
  provenance_apply_copy(copy: ProvenanceCopy<Prov>, range: AllocRange, repeat: number): void {
    this.provenance.apply_copy(copy, range, repeat);
  }

  /// Applies a previously prepared copy of the init mask.
  ///
  /// This is dangerous to use as it can violate internal `Allocation` invariants!
  /// It only exists to support an efficient implementation of `mem_copy_repeatedly`.
  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:823 init_mask_apply_copy
  init_mask_apply_copy(copy: InitCopy, range: AllocRange, repeat: number): void {
    this.init_mask.apply_copy(copy, range, repeat);
  }
}
/** derive(Clone) of `Allocation` (a hand class): field by field. */
export function clone_Allocation<Prov, Extra, Bytes>(v: Allocation<Prov, Extra, Bytes>, clone_Prov: (v: Prov) => Prov, clone_Extra: (v: Extra) => Extra, clone_Bytes: (v: Bytes) => Bytes): Allocation<Prov, Extra, Bytes> {
  return new Allocation(clone_Bytes(v.bytes), clone_ProvenanceMap(v.provenance, clone_Prov), clone_InitMask(v.init_mask), v.align, v.mutability, clone_Extra(v.extra));
}

// impl<E: Encoder> Encodable<E> for AllocFlags
// stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:129 encode (lane encode-middle)
export function encode_AllocFlags<E extends Encoder>(_self: AllocFlags, _encoder: E): void {
  unported("rustc_middle::mir::interpret::allocation::encode AllocFlags (lane encode-middle)");
}

// impl<D: Decoder> Decodable<D> for AllocFlags
// rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:148 decode
export function decode_AllocFlags<D extends Decoder>(decoder: D): AllocFlags {
  const flags: number = decoder.read_u8();
  const align_ = flags & 0b0011_1111;
  const mutability_ = flags & 0b0100_0000;
  const all_zero_ = flags & 0b1000_0000;

  const align = unwrap_result(Align.from_bytes(1n << BigInt(align_)), debug_AlignFromBytesError);
  let mutability: Mutability;
  switch (mutability_) {
    case 0:
      mutability = "Not";
      break;
    default:
      mutability = "Mut";
      break;
  }
  const all_zero = all_zero_ > 0;

  return { align, mutability, all_zero };
}

/// Efficiently detect whether a slice of `u8` is all zero.
///
/// This is used in encoding of [`Allocation`] to special-case all-zero allocations. It is only
/// optimized a little, because for many allocations the encoding of the actual bytes does not
/// dominate runtime.
// #[inline]
// PORT: only used by the (skipped) `Encodable` impl.
// rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:171 all_zero
export function all_zero(buf: Uint8Array): boolean {
  // In the empty case we wouldn't encode any contents even without this system where we
  // special-case allocations whose contents are all 0. We can return anything in the empty case.
  if (buf.length === 0) {
    return true;
  }
  // Just fast-rejecting based on the first element significantly reduces the amount that we end
  // up walking the whole array.
  if (buf[0] !== 0) {
    return false;
  }

  // This strategy of combining all slice elements with & or | is unbeatable for the large
  // all-zero case because it is so well-understood by autovectorization.
  let acc = true;
  for (const b of buf) acc = acc && b === 0;
  return acc;
}

/// Custom encoder for [`Allocation`] to more efficiently represent the case where all bytes are 0.
// impl<Prov: Provenance, Extra, E: Encoder> Encodable<E> for Allocation<Prov, Extra, Box<[u8]>>
// stub: compiler/rustc_middle/src/mir/interpret/allocation.rs:194 encode (lane encode-middle)
export function encode_Allocation<E extends Encoder, Prov, Extra>(
  _self: Allocation<Prov, Extra, Uint8Array>,
  _encoder: E,
  _encode_Prov: Encodable<Prov, E>,
  _encode_Extra: Encodable<Extra, E>,
): void {
  unported("rustc_middle::mir::interpret::allocation::encode Allocation (lane encode-middle)");
}

// impl<Prov: Provenance, Extra, D: Decoder> Decodable<D> for Allocation<Prov, Extra, Box<[u8]>>
// rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:213 decode
export function decode_Allocation<D extends Decoder, Prov, Extra>(decoder: D, decode_Prov: (d: D) => Prov, decode_Extra: (d: D) => Extra): Allocation<Prov, Extra, Uint8Array> {
  const { align, mutability, all_zero } = decode_AllocFlags(decoder);

  const len = decoder.read_usize();
  const bytes_ = all_zero ? new Uint8Array(len) : decoder.read_raw_bytes(len).slice();
  const bytes = AllocBytes_Box.from_bytes(bytes_, align, null);

  const provenance = decode_ProvenanceMap(decoder, decode_Prov);
  const init_mask = decode_InitMask(decoder);
  const extra = decode_Extra(decoder);

  return new Allocation(bytes, provenance, init_mask, align, mutability, extra);
}

/// This is the maximum size we will hash at a time, when interning an `Allocation` and its
/// `InitMask`. Note, we hash that amount of bytes twice: at the start, and at the end of a buffer.
/// Used when these two structures are large: we only partially hash the larger fields in that
/// situation. See the comment at the top of their respective `Hash` impl for more details.
/** PORT: exported for init_mask.ts (`super::MAX_BYTES_TO_HASH`). */
export const MAX_BYTES_TO_HASH = 64;

/// This is the maximum size (in bytes) for which a buffer will be fully hashed, when interning.
/// Otherwise, it will be partially hashed in 2 slices, requiring at least 2 `MAX_BYTES_TO_HASH`
/// bytes.
export const MAX_HASHED_BUFFER_LEN = 2 * MAX_BYTES_TO_HASH;

// Const allocations are only hashed for interning. However, they can be large, making the hashing
// expensive especially since it uses `FxHash`: it's better suited to short keys, not potentially
// big buffers like the actual bytes of allocation. We can partially hash some fields when they're
// large.
// impl hash::Hash for Allocation
// rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:244 hash
export function hash_Allocation(self: Allocation, state: Hasher): void {
  const { bytes, provenance, init_mask, align, mutability } = self; // `extra: ()`: don't bother hashing ()

  // Partially hash the `bytes` buffer when it is large. To limit collisions with common
  // prefixes and suffixes, we hash the length and some slices of the buffer.
  const byte_count = bytes.length;
  if (byte_count > MAX_HASHED_BUFFER_LEN) {
    // Hash the buffer's length.
    state.write_usize(byte_count);

    // And its head and tail.
    hash_u8_slice(bytes.subarray(0, MAX_BYTES_TO_HASH), state);
    hash_u8_slice(bytes.subarray(byte_count - MAX_BYTES_TO_HASH), state);
  } else {
    hash_u8_slice(bytes, state);
  }

  // Hash the other fields as usual.
  hash_ProvenanceMap(provenance, state);
  hash_InitMask(init_mask, state);
  state.write_u8(align.pow2); // derive(Hash) of `Align { pow2: u8 }`
  state.write_isize(Mutability_discriminant[mutability]); // derive(Hash) of a fieldless enum: its discriminant
}
/** `<[u8] as Hash>::hash`: the length prefix, then the bytes (`u8::hash_slice`). */
function hash_u8_slice(bytes: Uint8Array, state: Hasher): void {
  state.write_length_prefix(bytes.length);
  state.write(bytes);
}
/** PORT: derive(Hash) of `ProvenanceMap` (derives are generated by tools/codegen; not for this set). */
function hash_ProvenanceMap(_v: ProvenanceMap, _state: Hasher): void {
  unported("Hash for rustc_middle::mir::interpret::allocation::provenance_map::ProvenanceMap (derive(Hash) not generated)");
}
/** PORT: derive(Hash) of `InitMask` (derives are generated by tools/codegen; not for this set). */
function hash_InitMask(_v: InitMask, _state: Hasher): void {
  unported("Hash for rustc_middle::mir::interpret::allocation::init_mask::InitMask (derive(Hash) not generated)");
}

/// Interned types generally have an `Outer` type and an `Inner` type, where
/// `Outer` is a newtype around `Interned<Inner>`, and all the operations are
/// done on `Outer`, because all occurrences are interned. E.g. `Ty` is an
/// outer type and `TyKind` is its inner type.
///
/// Here things are different because only const allocations are interned. This
/// means that both the inner type (`Allocation`) and the outer type
/// (`ConstAllocation`) are used quite a bit.
// rustc-type: compiler/rustc_middle/src/mir/interpret/allocation.rs:286 ConstAllocation
export class ConstAllocation extends Interned {
  /** PORT: the interned `Allocation` (`self.0.0`). */
  readonly internee: Allocation;

  /** PORT: only `tcx.mk_const_alloc` constructs (plan-m3 D2). */
  constructor(internee: Allocation) {
    super();
    this.internee = internee;
    Object.freeze(this);
  }

  // rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:297 inner
  inner(): Allocation {
    return this.internee;
  }
}
/** derive(Clone) of a `Copy` interned handle. */
export function clone_ConstAllocation(v: ConstAllocation): ConstAllocation {
  return v;
}

// impl<'tcx> fmt::Debug for ConstAllocation<'tcx>
// rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:289 fmt
export const debug_ConstAllocation: Debug<ConstAllocation> = (_self, _f) => {
  // The debug representation of this is very verbose and basically useless,
  // so don't print it.
  return "ConstAllocation { .. }";
};

export interface AllocError_methods {
  // allocation.rs:316
  to_interp_error(self: AllocError, alloc_id: AllocId): InterpErrorKind;
}
export type AllocError = gen.AllocError;
export const AllocError = {} as AllocError_methods;
// rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:316 to_interp_error
AllocError.to_interp_error = function (self: AllocError, alloc_id: AllocId): InterpErrorKind {
  switch (self.$) {
    case "ReadPointerAsInt": {
      const info = self._0;
      return { $: "Unsupported", _0: { $: "ReadPointerAsInt", _0: info === undefined ? undefined : [alloc_id, info] } };
    }
    case "ReadPartialPointer": {
      const offset = self._0;
      return { $: "Unsupported", _0: { $: "ReadPartialPointer", _0: Pointer.new(alloc_id, offset) } };
    }
    case "InvalidUninitBytes": {
      const info = self._0;
      return { $: "UndefinedBehavior", _0: { $: "InvalidUninitBytes", _0: info === undefined ? undefined : [alloc_id, info] } };
    }
  }
};

// impl fmt::Display for AllocRange
// rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:340 fmt
export function display_AllocRange(self: AllocRange): string {
  return `[0x${self.start.bytes().toString(16)}..0x${self.end().bytes().toString(16)}]`;
}

/// Free-starting constructor for less syntactic overhead.
// #[inline(always)]
// rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:347 alloc_range
export function alloc_range(start: Size, size: Size): AllocRange {
  return new AllocRange(start, size);
}

// impl From<Range<Size>> for AllocRange
// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:353 from
export function AllocRange_from_Range_Size(r: Range<Size>): AllocRange {
  return alloc_range(r.start, r.end.sub(r.start)); // `Size` subtraction (overflow-checked)
}

// impl From<Range<usize>> for AllocRange
// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:360 from
export function AllocRange_from_Range_usize(r: Range<number>): AllocRange {
  return AllocRange_from_Range_Size({ start: Size.from_bytes(r.start), end: Size.from_bytes(r.end) });
}

declare module "./allocation.gen.ts" {
  interface AllocRange {
    // allocation.rs:367
    end(): Size;
    // allocation.rs:373
    subrange(subrange: AllocRange): AllocRange;
  }
}
// #[inline(always)]
// rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:367 end
AllocRange.prototype.end = function (this: AllocRange): Size {
  return this.start.add(this.size); // This does overflow checking.
};

/// Returns the `subrange` within this range; panics if it is not a subrange.
// #[inline]
// rustc: compiler/rustc_middle/src/mir/interpret/allocation.rs:373 subrange
AllocRange.prototype.subrange = function (this: AllocRange, subrange: AllocRange): AllocRange {
  const sub_start = this.start.add(subrange.start);
  const range = alloc_range(sub_start, subrange.size);
  assert(range.end().bytes() <= this.end().bytes(), "access outside the bounds for given AllocRange");
  return range;
};
