// Port of ar_archive_writer 0.5.3 `src/math_extras.rs`.
// Derived from code in LLVM, which is:
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
import { assert } from "../../std/panic.ts";

// crate: ar_archive_writer-0.5.3/src/math_extras.rs:6 align_to_power_of2
export function align_to_power_of2(value: number, align: number): number {
  assert(align !== 0 && Number.isInteger(Math.log2(align)), "Align must be a power of 2");
  // Replace unary minus to avoid compilation error on Windows:
  // "unary minus operator applied to unsigned type, result still unsigned"
  // PORT: `(value + align - 1) & align.wrapping_neg()` on `u64`, as a remainder.
  const n = value + align - 1;
  return n - (n % align);
}
