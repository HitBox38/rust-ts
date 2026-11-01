// Port of src/tools/miri/src/alloc/alloc_bytes.rs (crate `miri`, plan-m6 D2). Fill lane: `miri-alloc` (plan-m6 wave 36).
// Its types are generated into alloc_bytes.gen.ts (tools/codegen set `miri`); this module re-exports them.
//
// PORT (lane miri-alloc): host memory.
// - `MiriAllocBytes` is a `Uint8Array` subclass (interp-generic PORT 3 / miri-contract review N5): its elements are the
//   allocation's bytes, so `Deref` / `DerefMut` / `as_ptr` / `as_mut_ptr` are the value itself, and the "allocation" of
//   `alloc_with` is the `ArrayBuffer` behind it. A host allocation is `new ArrayBuffer(n)`; the null pointer of a failed
//   allocation is `undefined` (the engine refused the buffer, a `RangeError`, as `AllocBytes_Box.zeroed`). JS zero-fills
//   every buffer, so `alloc::alloc` and `alloc::alloc_zeroed` are the same here.
// - `ptr` (`*mut u8`, the host address) has no TS value: nothing reads it with `native-lib` off (decision C6: the host
//   address of the bytes is used only in native-lib mode, alloc_addresses/mod.rs:139, which stops `unported`). It is set
//   to 0 and only the derived Debug would show it (and that Debug already stops on `layout`, generated `unknown_debug`).
// - `Drop` frees nothing (the garbage collector owns the buffer) and never runs implicitly; it is ported for the
//   `Isolated` arm, which is unreachable without native-lib (`IsolatedAlloc(!)`, alloc/mod.rs:10).
import type { Align, Size } from "../../rustc_abi/lib.ts";
import { Align as Align_, debug_AlignFromBytesError } from "../../rustc_abi/lib.ts";
import type { AllocBytes } from "../../rustc_middle/mir/interpret/mod.ts";
import { panic } from "../../std/panic.ts";
import { Err, Ok, type Result, unwrap_result } from "../../std/result.ts";
import { type MiriAllocParams } from "./alloc_bytes.gen.ts";
export * from "./alloc_bytes.gen.ts";

// ---- `std::alloc::Layout` (the subset this file uses) ----
/** PORT (lane miri-alloc): `std::alloc::Layout` stand-in, local to this file (src/std has none and is not this lane's;
 * root may move it to src/std). `size` / `align` are host `usize`s (64-bit host), kept exact as `bigint`s (C5). */
export class Layout {
  constructor(
    readonly size_: bigint,
    readonly align_: bigint,
  ) {}

  // std: library/core/src/alloc/layout.rs:59 from_size_align
  static from_size_align(size: bigint, align: bigint): Result<Layout, null> {
    if (Layout.is_size_align_valid(size, align)) {
      return Ok(new Layout(size, align));
    } else {
      return Err(null);
    }
  }

  // std: library/core/src/alloc/layout.rs:69 is_size_align_valid
  static is_size_align_valid(size: bigint, align: bigint): boolean {
    // `let Some(alignment) = Alignment::new(align) else { return false };` (a power of two)
    if (!(align > 0n && (align & (align - 1n)) === 0n)) return false;
    // `Self::is_size_alignment_valid(size, alignment)`: `size <= isize::MAX as usize + 1 - alignment`
    return size <= (1n << 63n) - align;
  }

  /** `Layout::size` */
  size(): bigint {
    return this.size_;
  }

  /** `Layout::align` */
  align(): bigint {
    return this.align_;
  }
}

/** A host allocation of `layout.size()` bytes (`alloc::alloc` / `alloc::alloc_zeroed`); `undefined` is the null pointer. */
function host_alloc(layout: Layout): ArrayBuffer | undefined {
  // PORT: header ("host memory"). A size past what the engine can hold fails like a refused host allocation.
  if (layout.size() > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
  try {
    return new ArrayBuffer(Number(layout.size()));
  } catch (e) {
    if (e instanceof RangeError) return undefined;
    throw e;
  }
}

// rustc-type: src/tools/miri/src/alloc/alloc_bytes.rs:22 MiriAllocBytes
/// Allocation bytes that explicitly handle the layout of the data they're storing.
/// This is necessary to interface with native code that accesses the program store in Miri.
// PORT(contract): the `Machine::Bytes` of Miri (`impl AllocBytes for MiriAllocBytes`, `AllocBytes_MiriAllocBytes` below),
// a hand type. interp-generic PORT 3 (miri-contract review N5): every `AllocBytes` value is a `Uint8Array`, so this is a
// `Uint8Array` subclass whose elements are the allocation's bytes (`Deref<Target = [u8]>` and `as_ptr` / `as_mut_ptr`
// are the value itself); its views (`subarray`, `slice`) are plain `Uint8Array`s. The fields are the upstream ones (the
// generated derive(Debug) reads them); `ptr` is a number (header: always 0, nothing reads it without native-lib).
export class MiriAllocBytes extends Uint8Array {
  /// Stored layout information about the allocation.
  declare layout: Layout;
  /// Pointer to the allocation contents.
  /// Invariant:
  /// * If `self.layout.size() == 0`, then `self.ptr` was allocated with the equivalent layout with size 1.
  /// * Otherwise, `self.ptr` points to memory allocated with `self.layout`.
  declare ptr: number;
  /// Whether this instance of `MiriAllocBytes` had its allocation created by calling `alloc::alloc()`
  /// (`Global`) or the discrete allocator (`Isolated`)
  declare params: MiriAllocParams;

  /** Views of the bytes are not allocations. */
  static get [Symbol.species](): Uint8ArrayConstructor {
    return Uint8Array;
  }

  // impl Clone for MiriAllocBytes
  // rustc: src/tools/miri/src/alloc/alloc_bytes.rs:36 clone
  clone(): MiriAllocBytes {
    // let bytes: Cow<'_, [u8]> = Cow::Borrowed(self);
    const bytes: Uint8Array = this;
    const align = unwrap_result(Align_.from_bytes(this.layout.align()), debug_AlignFromBytesError);
    return AllocBytes_MiriAllocBytes.from_bytes(bytes, align, this.params);
  }

  // impl Drop for MiriAllocBytes
  // PORT: header ("host memory"): never called implicitly; `alloc::dealloc` frees nothing (the GC owns the buffer).
  // rustc: src/tools/miri/src/alloc/alloc_bytes.rs:44 drop
  drop(): void {
    // We have to reconstruct the actual layout used for allocation.
    // (`Deref` relies on `size` so we can't just always set it to at least 1.)
    const alloc_layout =
      this.layout.size() === 0n ? unwrap_result(Layout.from_size_align(1n, this.layout.align())) : this.layout;

    // SAFETY: Invariant, `self.ptr` points to memory allocated with `self.layout`.
    const params = this.params;
    switch (params.$) {
      case "Global":
        // alloc::dealloc(self.ptr, alloc_layout)
        void alloc_layout;
        break;
      case "Isolated":
        params._0.dealloc(this.ptr, alloc_layout);
        break;
    }
  }

  // impl std::ops::Deref for MiriAllocBytes
  // rustc: src/tools/miri/src/alloc/alloc_bytes.rs:67 deref
  deref(): Uint8Array {
    // SAFETY: `ptr` is non-null, properly aligned, and valid for reading out `self.layout.size()`-many bytes.
    // Note that due to the invariant this is true even if `self.layout.size() == 0`.
    // unsafe { slice::from_raw_parts(self.ptr, self.layout.size()) }
    // PORT: the value is the slice (its length is `layout.size()`, header).
    return this;
  }

  // impl std::ops::DerefMut for MiriAllocBytes
  // rustc: src/tools/miri/src/alloc/alloc_bytes.rs:75 deref_mut
  deref_mut(): Uint8Array {
    // SAFETY: `ptr` is non-null, properly aligned, and valid for reading out `self.layout.size()`-many bytes.
    // Note that due to the invariant this is true even if `self.layout.size() == 0`.
    // unsafe { slice::from_raw_parts_mut(self.ptr, self.layout.size()) }
    return this;
  }

  // impl MiriAllocBytes
  /// This method factors out how a `MiriAllocBytes` object is allocated, given a specific allocation function.
  /// If `size == 0` we allocate using a different `alloc_layout` with `size = 1`, to ensure each allocation has a unique address.
  /// Returns `Err(alloc_layout)` if the allocation function returns a `ptr` where `ptr.is_null()`.
  // PORT: `alloc_fn` returns the host buffer (`undefined` = null pointer, header).
  // rustc: src/tools/miri/src/alloc/alloc_bytes.rs:86 alloc_with
  static alloc_with(
    size: bigint,
    align: bigint,
    params: MiriAllocParams,
    alloc_fn: (layout: Layout, params: MiriAllocParams) => ArrayBuffer | undefined,
  ): Result<MiriAllocBytes, null> {
    // let size = usize::try_from(size).map_err(|_| ())?;
    // let align = usize::try_from(align).map_err(|_| ())?;
    // PORT: a 64-bit host: `u64` -> `usize` never fails.
    const layout_ = Layout.from_size_align(size, align);
    if (layout_.$ === "Err") return Err(null);
    const layout = layout_._0;
    // When size is 0 we allocate 1 byte anyway, to ensure each allocation has a unique address.
    const alloc_layout = size === 0n ? unwrap_result(Layout.from_size_align(1n, align)) : layout;
    const ptr = alloc_fn(alloc_layout, params);
    if (ptr === undefined) {
      return Err(null);
    } else {
      // SAFETY: All `MiriAllocBytes` invariants are fulfilled.
      // Ok(Self { ptr, layout, params })
      const self = new MiriAllocBytes(ptr, 0, Number(size));
      self.ptr = 0;
      self.layout = layout;
      self.params = params;
      return Ok(self);
    }
  }
}

// impl AllocBytes for MiriAllocBytes
// type AllocParams = MiriAllocParams;
// PORT(contract) (lane interp-miri-reconcile): `MiriMachine`'s `Machine.Bytes` (machine.ts).
export const AllocBytes_MiriAllocBytes: AllocBytes<MiriAllocBytes, MiriAllocParams> = {
  // PORT: `slice: impl Into<Cow<'a, [u8]>>` is the bytes (always copied, as upstream's `copy_from`).
  // rustc: src/tools/miri/src/alloc/alloc_bytes.rs:111 from_bytes
  from_bytes(slice: Uint8Array, align_: Align, params: MiriAllocParams): MiriAllocBytes {
    // let slice = slice.into();
    const size = slice.length;
    const align = BigInt(align_.bytes());
    // SAFETY: `alloc_fn` will only be used with `size != 0`.
    const alloc_fn = (layout: Layout, params: MiriAllocParams): ArrayBuffer | undefined => {
      switch (params.$) {
        case "Global":
          return host_alloc(layout);
        case "Isolated":
          return params._0.alloc(layout);
      }
    };
    const alloc_bytes_ = MiriAllocBytes.alloc_with(BigInt(size), align, params, alloc_fn);
    if (alloc_bytes_.$ === "Err") {
      return panic(`Miri ran out of memory: cannot create allocation of ${size} bytes`);
    }
    const alloc_bytes = alloc_bytes_._0;
    // SAFETY: `alloc_bytes.ptr` and `slice.as_ptr()` are non-null, properly aligned
    // and valid for the `size`-many bytes to be copied.
    // unsafe { alloc_bytes.ptr.copy_from(slice.as_ptr(), size) };
    alloc_bytes.set(slice);
    return alloc_bytes;
  },

  // rustc: src/tools/miri/src/alloc/alloc_bytes.rs:136 zeroed
  zeroed(size_: Size, align_: Align, params: MiriAllocParams): MiriAllocBytes | undefined {
    const size = size_.bytes_u64();
    const align = BigInt(align_.bytes());
    // SAFETY: `alloc_fn` will only be used with `size != 0`.
    const alloc_fn = (layout: Layout, params: MiriAllocParams): ArrayBuffer | undefined => {
      switch (params.$) {
        case "Global":
          return host_alloc(layout);
        case "Isolated":
          return params._0.alloc_zeroed(layout);
      }
    };
    const r = MiriAllocBytes.alloc_with(size, align, params, alloc_fn);
    return r.$ === "Ok" ? r._0 : undefined;
  },

  // PORT: the raw storage is the value itself (header; the `AllocBytes` descriptor contract, allocation.ts).
  // rustc: src/tools/miri/src/alloc/alloc_bytes.rs:149 as_mut_ptr
  as_mut_ptr(self: MiriAllocBytes): Uint8Array {
    return self;
  },

  // rustc: src/tools/miri/src/alloc/alloc_bytes.rs:153 as_ptr
  as_ptr(self: MiriAllocBytes): Uint8Array {
    return self;
  },
};
