// Port of ar_archive_writer 0.5.3 `src/archive.rs`.
// Derived from code in LLVM, which is:
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception

/// Size field is 10 decimal digits long
export const MAX_MEMBER_SIZE = 9999999999;

export type ArchiveKind = "Gnu" | "Gnu64" | "Bsd" | "Darwin" | "Darwin64" | "Coff" | "AixBig";
export const ArchiveKind = {
  Gnu: "Gnu",
  Gnu64: "Gnu64",
  Bsd: "Bsd",
  Darwin: "Darwin",
  Darwin64: "Darwin64",
  Coff: "Coff",
  AixBig: "AixBig",
} as const;

// pub(crate) mod big_archive
/** `size_of::<big_archive::BigArMemHdrType>()`: 20 + 20 + 20 + 12 + 12 + 12 + 12 + 4 + 2 bytes, `repr(C)` over `u8` arrays. */
export const SIZE_OF_BIG_AR_MEM_HDR_TYPE = 114;
/** `size_of::<big_archive::FixLenHdr>()`: 8 + 6 * 20 bytes, `repr(C)` over `u8` arrays. */
export const SIZE_OF_FIX_LEN_HDR = 128;
