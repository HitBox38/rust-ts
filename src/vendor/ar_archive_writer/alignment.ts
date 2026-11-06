// Port of ar_archive_writer 0.5.3 `src/alignment.rs`.
// Derived from code in LLVM, which is:
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception

/// Returns a multiple of `align` needed to store `size` bytes.
// crate: ar_archive_writer-0.5.3/src/alignment.rs:7 align_to
export function align_to(size: number, align: number): number {
  // PORT: `(size + align - 1) & !(align - 1)` on `u64`; `align` is a power of two, and archive offsets need not fit a JS bit `&`.
  const n = size + align - 1;
  return n - (n % align);
}

/*
/// Returns the offset to the next integer (mod 2**64) that is greater than
/// or equal to \p Value and is a multiple of \p Align.
inline uint64_t offsetToAlignment(uint64_t Value, Align Alignment) {
    return alignTo(Value, Alignment) - Value;
}
*/

// crate: ar_archive_writer-0.5.3/src/alignment.rs:19 offset_to_alignment
export function offset_to_alignment(value: number, alignment: number): number {
  return align_to(value, alignment) - value;
}
