// Port of compiler/rustc_data_structures/src/owned_slice.rs.
//
// PORT: `OwnedSlice` is a `Uint8Array` view: a subarray keeps its backing buffer (the owner, e.g.
// the mapped file) alive, which is all `OwnedSlice`'s `owner: Arc<dyn Send + Sync>` does.

import { Ok, type Result } from "../std/result.ts";

/// An owned slice.
///
/// This is similar to `Arc<[u8]>` but allows slicing and using anything as the
/// backing buffer.
///
/// See [`slice_owned`] for `OwnedSlice` construction and examples.
export type OwnedSlice = Uint8Array;

/// Makes an [`OwnedSlice`] out of an `owner` and a `slicer` function.
// rustc: compiler/rustc_data_structures/src/owned_slice.rs:57 slice_owned
export function slice_owned<O>(owner: O, slicer: (owner: O) => Uint8Array): OwnedSlice {
  const r = try_slice_owned(owner, (x) => Ok(slicer(x)));
  return (r as { _0: OwnedSlice })._0;
}

/// Makes an [`OwnedSlice`] out of an `owner` and a `slicer` function that can fail.
///
/// See [`slice_owned`] for the infallible version.
// rustc: compiler/rustc_data_structures/src/owned_slice.rs:68 try_slice_owned
export function try_slice_owned<O, E>(owner: O, slicer: (owner: O) => Result<Uint8Array, E>): Result<OwnedSlice, E> {
  // We wrap the owner of the bytes in, so it doesn't move.
  //
  // Since the owner does not move and we don't access it in any way
  // before dropping, there is nothing that can invalidate the bytes pointer.
  const bytes = slicer(owner);
  if (bytes.$ === "Err") return bytes;
  return Ok(bytes._0);
}

/// Slice this slice by `slicer`.
// rustc: compiler/rustc_data_structures/src/owned_slice.rs:107 slice
export function OwnedSlice_slice(self: OwnedSlice, slicer: (bytes: Uint8Array) => Uint8Array): OwnedSlice {
  // This is basically identical to `try_slice_owned`,
  // `slicer` can only return slices of its argument or some static data,
  // both of which are valid while `owner` is alive.
  return slicer(self);
}

// rustc: compiler/rustc_data_structures/src/owned_slice.rs:121 deref
export function OwnedSlice_deref(self: OwnedSlice): Uint8Array {
  // Safety:
  // `self.bytes` is valid per the construction in `slice_owned`
  // (which is the only constructor)
  return self;
}

// rustc: compiler/rustc_data_structures/src/owned_slice.rs:131 borrow
export function OwnedSlice_borrow(self: OwnedSlice): Uint8Array {
  return self;
}
