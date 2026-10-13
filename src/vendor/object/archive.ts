// Port of object 0.39.1 `src/archive.rs`.
//
// Copyright (c) 2015 The Gimli Developers; licensed under MIT OR Apache-2.0 (object).
//
//! Archive definitions.
//!
//! These definitions are independent of read/write support, although we do implement
//! some traits useful for those.
//
// PORT: `[u8; N]` fields are views (`Uint8Array`) into the file data; see pod.ts.

import { type Pod, pod_bytes, pod_struct } from "./pod.ts";

const bytes = (s: string): Uint8Array => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

/// File identification bytes stored at the beginning of the file.
export const MAGIC: Uint8Array = bytes("!<arch>\n");

/// File identification bytes at the beginning of AIX big archive.
export const AIX_BIG_MAGIC: Uint8Array = bytes("<bigaf>\n");

/// File identification bytes stored at the beginning of a thin archive.
///
/// A thin archive only contains a symbol table and file names.
export const THIN_MAGIC: Uint8Array = bytes("!<thin>\n");

/// The terminator for each archive member header.
export const TERMINATOR: Uint8Array = bytes("`\n");

/// The header at the start of an archive member.
export class Header {
  constructor(
    /// The file name.
    readonly name: Uint8Array,
    /// File modification timestamp in decimal.
    readonly date: Uint8Array,
    /// User ID in decimal.
    readonly uid: Uint8Array,
    /// Group ID in decimal.
    readonly gid: Uint8Array,
    /// File mode in octal.
    readonly mode: Uint8Array,
    /// File size in decimal.
    readonly size: Uint8Array,
    /// Must be equal to `TERMINATOR`.
    readonly terminator: Uint8Array,
  ) {}

  static readonly POD: Pod<Header> = pod_struct(
    [pod_bytes(16), pod_bytes(12), pod_bytes(6), pod_bytes(6), pod_bytes(8), pod_bytes(10), pod_bytes(2)],
    (...f: Uint8Array[]) => new Header(f[0]!, f[1]!, f[2]!, f[3]!, f[4]!, f[5]!, f[6]!),
  );
}

/// The header at the start of an AIX big archive member, without name.
export class AixHeader {
  constructor(
    /// File member size in decimal.
    readonly size: Uint8Array,
    /// Next member offset in decimal.
    readonly nxtmem: Uint8Array,
    /// Previous member offset in decimal.
    readonly prvmem: Uint8Array,
    /// File member date in decimal.
    readonly date: Uint8Array,
    /// File member user id in decimal.
    readonly uid: Uint8Array,
    /// File member group id in decimal.
    readonly gid: Uint8Array,
    /// File member mode in octal.
    readonly mode: Uint8Array,
    /// File member name length in decimal.
    readonly namlen: Uint8Array,
  ) {}

  static readonly POD: Pod<AixHeader> = pod_struct(
    [pod_bytes(20), pod_bytes(20), pod_bytes(20), pod_bytes(12), pod_bytes(12), pod_bytes(12), pod_bytes(12), pod_bytes(4)],
    (...f: Uint8Array[]) => new AixHeader(f[0]!, f[1]!, f[2]!, f[3]!, f[4]!, f[5]!, f[6]!, f[7]!),
  );
}

/// The AIX big archive's fixed length header at file beginning.
export class AixFileHeader {
  constructor(
    /// Archive magic string.
    readonly magic: Uint8Array,
    /// Offset of member table.
    readonly memoff: Uint8Array,
    /// Offset of global symbol table.
    readonly gstoff: Uint8Array,
    /// Offset of global symbol table for 64-bit objects.
    readonly gst64off: Uint8Array,
    /// Offset of first member.
    readonly fstmoff: Uint8Array,
    /// Offset of last member.
    readonly lstmoff: Uint8Array,
    /// Offset of first member on free list.
    readonly freeoff: Uint8Array,
  ) {}

  static readonly POD: Pod<AixFileHeader> = pod_struct(
    [pod_bytes(8), pod_bytes(20), pod_bytes(20), pod_bytes(20), pod_bytes(20), pod_bytes(20), pod_bytes(20)],
    (...f: Uint8Array[]) => new AixFileHeader(f[0]!, f[1]!, f[2]!, f[3]!, f[4]!, f[5]!, f[6]!),
  );
}

/// Offset of a member in an AIX big archive.
///
/// This is used in the member index.
export class AixMemberOffset {
  constructor(readonly _0: Uint8Array) {}

  static readonly POD: Pod<AixMemberOffset> = pod_struct([pod_bytes(20)], (f: Uint8Array) => new AixMemberOffset(f));
}
