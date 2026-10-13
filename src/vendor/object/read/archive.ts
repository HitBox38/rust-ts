// Port of object 0.39.1 `src/read/archive.rs`.
//
// Copyright (c) 2015 The Gimli Developers; licensed under MIT OR Apache-2.0 (object).
//
//! Support for archive files.
//!
//! ## Example
//!  ```no_run
//! use object::{Object, ObjectSection};
//! use std::error::Error;
//! use std::fs;
//!
//! /// Reads an archive and displays the name of each member.
//! fn main() -> Result<(), Box<dyn Error>> {
//! #   #[cfg(feature = "std")] {
//!     let data = fs::read("path/to/binary")?;
//!     let file = object::read::archive::ArchiveFile::parse(&*data)?;
//!     for member in file.members() {
//!         let member = member?;
//!         println!("{}", String::from_utf8_lossy(member.name()));
//!     }
//! #   }
//!     Ok(())
//! }
//! ```
//
// PORT: `R` is `&[u8]` (`Uint8Array`); u64 offsets and sizes are `number`s (see endian.ts).
// `parse_u64_digits` computes in `bigint` so its overflow checks are exact. `slice::Iter` over a
// `PodSlice` is a `SliceIter` (index cursor). `ArchiveFile`, `Members` and `ArchiveOffset` are
// `Copy`: `members()` copies `self.members` before the iterator mutates it.

import { field_mut, type MutRef } from "../../../std/mut_ref.ts";
import { Err, Ok, type Result as StdResult } from "../../../std/result.ts";
import * as archive from "../archive.ts";
import { BE, LE, U16, U32, U64 } from "../endian.ts";
import { pod_array, pod_u8, PodSlice } from "../pod.ts";
import { Error, read_error_opt, read_error_unit, type Result } from "./mod.ts";
import { ReadRef } from "./read_ref.ts";
import { Bytes, bytes_eq } from "./util.ts";

const b = (s: string): Uint8Array => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
const eq = (a: Uint8Array, s: string): boolean => bytes_eq(a, b(s));

/// The kind of archive format.
export type ArchiveKind =
  /// There are no special files that indicate the archive format.
  | "Unknown"
  /// The GNU (or System V) archive format.
  | "Gnu"
  /// The GNU (or System V) archive format with 64-bit symbol table.
  | "Gnu64"
  /// The BSD archive format.
  | "Bsd"
  /// The BSD archive format with 64-bit symbol table.
  ///
  /// This is used for Darwin.
  | "Bsd64"
  /// The Windows COFF archive format.
  | "Coff"
  /// The AIX big archive format.
  | "AixBig";

/// The list of members in the archive.
type Members =
  | { $: "Common"; offset: number; end_offset: number }
  | { $: "AixBig"; index: PodSlice<archive.AixMemberOffset> };

/** `slice::Iter` over a `PodSlice`. */
export class SliceIter<T> {
  constructor(
    readonly slice: PodSlice<T>,
    public pos = 0,
  ) {}

  next(): T | undefined {
    if (this.pos >= this.slice.length) return undefined;
    return this.slice.get(this.pos++);
  }

  size_hint(): [number, number | undefined] {
    const n = this.slice.length - this.pos;
    return [n, n];
  }

  clone(): SliceIter<T> {
    return new SliceIter(this.slice, this.pos);
  }
}

/// A partially parsed archive file.
export class ArchiveFile {
  constructor(
    public data: Uint8Array,
    public kind_: ArchiveKind,
    public members_: Members,
    public symbols_: [number, number],
    public names: Uint8Array,
    public thin: boolean,
  ) {}

  /// Parse the archive header and special members.
  // crate: object-0.39.1/src/read/archive.rs:77 parse
  static parse(data: Uint8Array): Result<ArchiveFile> {
    const len_r = read_error_unit(ReadRef.len(data), "Unknown archive length");
    if (len_r.$ === "Err") return len_r;
    const len = len_r._0;
    const tail: MutRef<number> = { value: 0 };
    const magic_r = read_error_unit(ReadRef.read_bytes(data, tail, archive.MAGIC.length), "Invalid archive size");
    if (magic_r.$ === "Err") return magic_r;
    const magic = magic_r._0;

    let thin: boolean;
    if (bytes_eq(magic, archive.AIX_BIG_MAGIC)) {
      return ArchiveFile.parse_aixbig(data);
    } else if (bytes_eq(magic, archive.THIN_MAGIC)) {
      thin = true;
    } else if (bytes_eq(magic, archive.MAGIC)) {
      thin = false;
    } else {
      return Err(new Error("Unsupported archive identifier"));
    }

    let members_offset = tail.value;
    const members_end_offset = len;

    const file = new ArchiveFile(data, "Unknown", { $: "Common", offset: 0, end_offset: 0 }, [0, 0], new Uint8Array(0), thin);

    // The first few members may be special, so parse them.
    // GNU has:
    // - "/" or "/SYM64/": symbol table (optional)
    // - "//": names table (optional)
    // COFF has:
    // - "/": first linker member
    // - "/": second linker member
    // - "//": names table
    // BSD has:
    // - "__.SYMDEF" or "__.SYMDEF SORTED": symbol table (optional)
    // BSD 64-bit has:
    // - "__.SYMDEF_64" or "__.SYMDEF_64 SORTED": symbol table (optional)
    // BSD may use the extended name for the symbol table. This is handled
    // by `ArchiveMember::parse`.
    if (tail.value < len) {
      const m1 = ArchiveMember.parse(data, tail, new Uint8Array(0), thin);
      if (m1.$ === "Err") return m1;
      const member = m1._0;
      if (eq(member.name_, "/")) {
        // GNU symbol table (unless we later determine this is COFF).
        file.kind_ = "Gnu";
        file.symbols_ = member.file_range();
        members_offset = tail.value;

        if (tail.value < len) {
          const m2 = ArchiveMember.parse(data, tail, new Uint8Array(0), thin);
          if (m2.$ === "Err") return m2;
          const member = m2._0;
          if (eq(member.name_, "/")) {
            // COFF linker member.
            file.kind_ = "Coff";
            file.symbols_ = member.file_range();
            members_offset = tail.value;

            if (tail.value < len) {
              const m3 = ArchiveMember.parse(data, tail, new Uint8Array(0), thin);
              if (m3.$ === "Err") return m3;
              const member = m3._0;
              if (eq(member.name_, "//")) {
                // COFF names table.
                const d = member.data(data);
                if (d.$ === "Err") return d;
                file.names = d._0;
                members_offset = tail.value;
              }
            }
            if (tail.value < len) {
              const m4 = ArchiveMember.parse(data, tail, file.names, thin);
              if (m4.$ === "Err") return m4;
              const member = m4._0;
              if (eq(member.name_, "/<ECSYMBOLS>/")) {
                // COFF EC Symbol Table.
                members_offset = tail.value;
              }
            }
          } else if (eq(member.name_, "//")) {
            // GNU names table.
            const d = member.data(data);
            if (d.$ === "Err") return d;
            file.names = d._0;
            members_offset = tail.value;
          }
        }
      } else if (eq(member.name_, "/SYM64/")) {
        // GNU 64-bit symbol table.
        file.kind_ = "Gnu64";
        file.symbols_ = member.file_range();
        members_offset = tail.value;

        if (tail.value < len) {
          const m2 = ArchiveMember.parse(data, tail, new Uint8Array(0), thin);
          if (m2.$ === "Err") return m2;
          const member = m2._0;
          if (eq(member.name_, "//")) {
            // GNU names table.
            const d = member.data(data);
            if (d.$ === "Err") return d;
            file.names = d._0;
            members_offset = tail.value;
          }
        }
      } else if (eq(member.name_, "//")) {
        // GNU names table.
        file.kind_ = "Gnu";
        const d = member.data(data);
        if (d.$ === "Err") return d;
        file.names = d._0;
        members_offset = tail.value;
      } else if (eq(member.name_, "__.SYMDEF") || eq(member.name_, "__.SYMDEF SORTED")) {
        // BSD symbol table.
        file.kind_ = "Bsd";
        file.symbols_ = member.file_range();
        members_offset = tail.value;
      } else if (eq(member.name_, "__.SYMDEF_64") || eq(member.name_, "__.SYMDEF_64 SORTED")) {
        // BSD 64-bit symbol table.
        file.kind_ = "Bsd64";
        file.symbols_ = member.file_range();
        members_offset = tail.value;
      } else {
        // TODO: This could still be a BSD file. We leave this as unknown for now.
      }
    }
    file.members_ = {
      $: "Common",
      offset: members_offset,
      end_offset: members_end_offset,
    };
    return Ok(file);
  }

  // crate: object-0.39.1/src/read/archive.rs:200 parse_aixbig
  static parse_aixbig(data: Uint8Array): Result<ArchiveFile> {
    const tail: MutRef<number> = { value: 0 };

    const fh = read_error_unit(ReadRef.read(data, archive.AixFileHeader.POD, tail), "Invalid AIX big archive file header");
    if (fh.$ === "Err") return fh;
    const file_header = fh._0;
    // Caller already validated this.
    // debug_assert_eq!(file_header.magic, archive::AIX_BIG_MAGIC);

    const file = new ArchiveFile(data, "AixBig", { $: "AixBig", index: PodSlice.empty(archive.AixMemberOffset.POD) }, [0, 0], new Uint8Array(0), false);

    // Read the span of symbol table.
    // TODO: an archive may have both 32-bit and 64-bit symbol tables.
    const s64 = read_error_opt(parse_u64_digits(file_header.gst64off, 10), "Invalid offset to 64-bit symbol table in AIX big archive");
    if (s64.$ === "Err") return s64;
    const symtbl64 = s64._0;
    if (symtbl64 > 0) {
      // The symbol table is also a file with header.
      const m = ArchiveMember.parse_aixbig(data, symtbl64);
      if (m.$ === "Err") return m;
      file.symbols_ = m._0.file_range();
    } else {
      const s = read_error_opt(parse_u64_digits(file_header.gstoff, 10), "Invalid offset to symbol table in AIX big archive");
      if (s.$ === "Err") return s;
      const symtbl = s._0;
      if (symtbl > 0) {
        // The symbol table is also a file with header.
        const m = ArchiveMember.parse_aixbig(data, symtbl);
        if (m.$ === "Err") return m;
        file.symbols_ = m._0.file_range();
      }
    }

    // Big archive member index table lists file entries with offsets and names.
    // To avoid potential infinite loop (members are double-linked list), the
    // iterator goes through the index instead of real members.
    const mt = read_error_opt(parse_u64_digits(file_header.memoff, 10), "Invalid offset for member table of AIX big archive");
    if (mt.$ === "Err") return mt;
    const member_table_offset = mt._0;
    if (member_table_offset === 0) {
      // The offset would be zero if archive contains no file.
      return Ok(file);
    }

    // The member index table is also a file with header.
    const m = ArchiveMember.parse_aixbig(data, member_table_offset);
    if (m.$ === "Err") return m;
    const member = m._0;
    const md = member.data(data);
    if (md.$ === "Err") return md;
    const member_data = new Bytes(md._0);

    // Structure of member index table:
    // Number of entries (20 bytes)
    // Offsets of each entry (20*N bytes)
    // Names string table (the rest of bytes to fill size defined in header)
    const mcb = read_error_unit(member_data.read_slice(pod_u8, 20), "Missing member count in AIX big archive");
    if (mcb.$ === "Err") return mcb;
    const members_count_bytes = mcb._0.data;
    // `.and_then(|size| size.try_into().ok())`: u64 -> usize is lossless on the 64-bit host.
    const mc = read_error_opt(parse_u64_digits(members_count_bytes, 10), "Invalid member count in AIX big archive");
    if (mc.$ === "Err") return mc;
    const members_count = mc._0;
    const ix = read_error_unit(member_data.read_slice(archive.AixMemberOffset.POD, members_count), "Member count overflow in AIX big archive");
    if (ix.$ === "Err") return ix;
    file.members_ = { $: "AixBig", index: ix._0 };

    return Ok(file);
  }

  /// Return the archive format.
  // crate: object-0.39.1/src/read/archive.rs:270 kind
  kind(): ArchiveKind {
    return this.kind_;
  }

  /// Return true if the archive is a thin archive.
  // crate: object-0.39.1/src/read/archive.rs:275 is_thin
  is_thin(): boolean {
    return this.thin;
  }

  /// Iterate over the members of the archive.
  ///
  /// This does not return special members.
  // crate: object-0.39.1/src/read/archive.rs:283 members
  members(): ArchiveMemberIterator {
    return new ArchiveMemberIterator(this.data, { ...this.members_ }, this.names, this.thin);
  }

  /// Return the member at the given offset.
  // crate: object-0.39.1/src/read/archive.rs:293 member
  member(member: ArchiveOffset): Result<ArchiveMember> {
    const members = this.members_;
    switch (members.$) {
      case "Common": {
        const { offset, end_offset } = members;
        if (member._0 < offset || member._0 >= end_offset) {
          return Err(new Error("Invalid archive member offset"));
        }
        const offset_ = { value: member._0 };
        return ArchiveMember.parse(this.data, offset_, this.names, this.thin);
      }
      case "AixBig": {
        const offset = member._0;
        return ArchiveMember.parse_aixbig(this.data, offset);
      }
    }
  }

  /// Iterate over the symbols in the archive.
  // crate: object-0.39.1/src/read/archive.rs:310 symbols
  symbols(): Result<ArchiveSymbolIterator | undefined> {
    if (this.symbols_[0] === 0 && this.symbols_[1] === 0) {
      return Ok(undefined);
    }
    const [offset, size] = this.symbols_;
    const r = read_error_unit(ArchiveSymbolIterator.new(this.kind_, this.data, offset, size), "Invalid archive symbol table");
    if (r.$ === "Err") return r;
    return Ok(r._0);
  }
}

/// An iterator over the members of an archive.
export class ArchiveMemberIterator {
  constructor(
    readonly data: Uint8Array,
    public members: Members,
    readonly names: Uint8Array,
    readonly thin: boolean,
  ) {}

  // crate: object-0.39.1/src/read/archive.rs:333 next
  next(): Result<ArchiveMember> | undefined {
    const members = this.members;
    switch (members.$) {
      case "Common": {
        if (members.offset >= members.end_offset) {
          return undefined;
        }
        const member = ArchiveMember.parse(this.data, field_mut(members, "offset"), this.names, this.thin);
        if (member.$ === "Err") {
          members.offset = members.end_offset;
        }
        return member;
      }
      case "AixBig": {
        if (members.index.length === 0) return undefined;
        const first = members.index.at(0);
        members.index = members.index.slice_from(1);
        const member = ArchiveMember.parse_aixbig_index(this.data, first);
        if (member.$ === "Err") {
          members.index = members.index.slice_from(members.index.length);
        }
        return member;
      }
    }
  }

  *[Symbol.iterator](): IterableIterator<Result<ArchiveMember>> {
    for (;;) {
      const m = this.next();
      if (m === undefined) return;
      yield m;
    }
  }
}

/// An archive member header.
type MemberHeader =
  /// Common header used by many formats.
  | { $: "Common"; _0: archive.Header }
  /// AIX big archive header
  | { $: "AixBig"; _0: archive.AixHeader };

/// A partially parsed archive member.
export class ArchiveMember {
  constructor(
    readonly header_: MemberHeader,
    readonly name_: Uint8Array,
    // May be zero for thin members.
    readonly offset: number,
    readonly size_: number,
  ) {}

  /// Parse the member header, name, and file data in an archive with the common format.
  ///
  /// This reads the extended name (if any) and adjusts the file size.
  // crate: object-0.39.1/src/read/archive.rs:386 parse
  static parse(data: Uint8Array, offset: MutRef<number>, names: Uint8Array, thin: boolean): Result<ArchiveMember> {
    const h = read_error_unit(ReadRef.read(data, archive.Header.POD, offset), "Invalid archive member header");
    if (h.$ === "Err") return h;
    const header = h._0;
    if (!bytes_eq(header.terminator, archive.TERMINATOR)) {
      return Err(new Error("Invalid archive terminator"));
    }

    const hs = read_error_opt(parse_u64_digits(header.size, 10), "Invalid archive member size");
    if (hs.$ === "Err") return hs;
    const header_file_size = hs._0;
    const file_offset = { value: offset.value };
    const file_size = { value: header_file_size };

    let name: Uint8Array;
    if (header.name[0] === 0x2f /* '/' */ && is_ascii_digit(header.name[1]!)) {
      // Read file name from the names table.
      const r = read_error_unit(parse_sysv_extended_name(header.name.subarray(1), names), "Invalid archive extended name offset");
      if (r.$ === "Err") return r;
      name = r._0;
    } else if (bytes_eq(header.name.subarray(0, 3), b("#1/")) && is_ascii_digit(header.name[3]!)) {
      // Read file name from the start of the file data.
      const r = read_error_unit(
        parse_bsd_extended_name(header.name.subarray(3), data, file_offset, file_size),
        "Invalid archive extended name length",
      );
      if (r.$ === "Err") return r;
      name = r._0;
    } else if (header.name[0] === 0x2f /* '/' */) {
      const sp = header.name.indexOf(0x20);
      const name_len = sp !== -1 ? sp : header.name.length;
      name = header.name.subarray(0, name_len);
    } else {
      // Name is terminated by slash or space.
      // Slash allows embedding spaces in the name, so only look
      // for space if there is no slash.
      const sl = header.name.indexOf(0x2f);
      const sp = header.name.indexOf(0x20);
      const name_len = sl !== -1 ? sl : sp !== -1 ? sp : header.name.length;
      name = header.name.subarray(0, name_len);
    }

    // Members in thin archives don't have data unless they are special members.
    if (thin && !eq(name, "/") && !eq(name, "//") && !eq(name, "/SYM64/")) {
      return Ok(new ArchiveMember({ $: "Common", _0: header }, name, 0, file_size.value));
    }

    // Skip the file data.
    // `offset.checked_add(header_file_size)`
    const next = offset.value + header_file_size;
    if (next > U64_MAX) return Err(new Error("Archive member size is too large"));
    offset.value = next;
    // Entries are padded to an even number of bytes.
    if (header_file_size % 2 !== 0) {
      offset.value = Math.min(offset.value + 1, U64_MAX);
    }

    return Ok(new ArchiveMember({ $: "Common", _0: header }, name, file_offset.value, file_size.value));
  }

  /// Parse a member index entry in an AIX big archive,
  /// and then parse the member header, name, and file data.
  // crate: object-0.39.1/src/read/archive.rs:454 parse_aixbig_index
  static parse_aixbig_index(data: Uint8Array, index: archive.AixMemberOffset): Result<ArchiveMember> {
    const o = read_error_opt(parse_u64_digits(index._0, 10), "Invalid AIX big archive file member offset");
    if (o.$ === "Err") return o;
    return ArchiveMember.parse_aixbig(data, o._0);
  }

  /// Parse the member header, name, and file data in an AIX big archive.
  // crate: object-0.39.1/src/read/archive.rs:464 parse_aixbig
  static parse_aixbig(data: Uint8Array, offset_: number): Result<ArchiveMember> {
    const offset: MutRef<number> = { value: offset_ };
    // The format was described at
    // https://www.ibm.com/docs/en/aix/7.3?topic=formats-ar-file-format-big
    const h = read_error_unit(ReadRef.read(data, archive.AixHeader.POD, offset), "Invalid AIX big archive member header");
    if (h.$ === "Err") return h;
    const header = h._0;
    const nl = read_error_opt(parse_u64_digits(header.namlen, 10), "Invalid AIX big archive member name length");
    if (nl.$ === "Err") return nl;
    const name_length = nl._0;
    const n = read_error_unit(ReadRef.read_bytes(data, offset, name_length), "Invalid AIX big archive member name");
    if (n.$ === "Err") return n;
    const name = n._0;

    // The actual data for a file member begins at the first even-byte boundary beyond the
    // member header and continues for the number of bytes specified by the ar_size field. The
    // ar command inserts null bytes for padding where necessary.
    if (offset.value % 2 !== 0) {
      offset.value = Math.min(offset.value + 1, U64_MAX);
    }
    // Because of the even-byte boundary, we have to read and check terminator after header.
    const t = read_error_unit(ReadRef.read_bytes(data, offset, 2), "Invalid AIX big archive terminator");
    if (t.$ === "Err") return t;
    const terminator = t._0;
    if (!bytes_eq(terminator, archive.TERMINATOR)) {
      return Err(new Error("Invalid AIX big archive terminator"));
    }

    const s = read_error_opt(parse_u64_digits(header.size, 10), "Invalid archive member size in AIX big archive");
    if (s.$ === "Err") return s;
    const size = s._0;
    return Ok(new ArchiveMember({ $: "AixBig", _0: header }, name, offset.value, size));
  }

  /// Return the raw header that is common to many archive formats.
  ///
  /// Returns `None` if this archive does not use the common header format.
  // crate: object-0.39.1/src/read/archive.rs:504 header
  header(): archive.Header | undefined {
    return this.header_.$ === "Common" ? this.header_._0 : undefined;
  }

  /// Return the raw header for AIX big archives.
  ///
  /// Returns `None` if this is not an AIX big archive.
  // crate: object-0.39.1/src/read/archive.rs:515 aix_header
  aix_header(): archive.AixHeader | undefined {
    return this.header_.$ === "AixBig" ? this.header_._0 : undefined;
  }

  /// Return the parsed file name.
  ///
  /// This may be an extended file name.
  // crate: object-0.39.1/src/read/archive.rs:526 name
  name(): Uint8Array {
    return this.name_;
  }

  /// Parse the file modification timestamp from the header.
  // crate: object-0.39.1/src/read/archive.rs:532 date
  date(): number | undefined {
    return parse_u64_digits(this.header_._0.date, 10);
  }

  /// Parse the user ID from the header.
  // crate: object-0.39.1/src/read/archive.rs:541 uid
  uid(): number | undefined {
    return parse_u64_digits(this.header_._0.uid, 10);
  }

  /// Parse the group ID from the header.
  // crate: object-0.39.1/src/read/archive.rs:550 gid
  gid(): number | undefined {
    return parse_u64_digits(this.header_._0.gid, 10);
  }

  /// Parse the file mode from the header.
  // crate: object-0.39.1/src/read/archive.rs:559 mode
  mode(): number | undefined {
    return parse_u64_digits(this.header_._0.mode, 8);
  }

  /// Return the size of the file data.
  // crate: object-0.39.1/src/read/archive.rs:567 size
  size(): number {
    return this.size_;
  }

  /// Return the offset and size of the file data.
  // crate: object-0.39.1/src/read/archive.rs:572 file_range
  file_range(): [number, number] {
    return [this.offset, this.size_];
  }

  /// Return true if the member is a thin member.
  ///
  /// Thin members have no file data.
  // crate: object-0.39.1/src/read/archive.rs:579 is_thin
  is_thin(): boolean {
    return this.offset === 0;
  }

  /// Return the file data.
  ///
  /// This is an empty slice for thin members.
  // crate: object-0.39.1/src/read/archive.rs:587 data
  data(data: Uint8Array): Result<Uint8Array> {
    if (this.is_thin()) {
      return Ok(new Uint8Array(0));
    }
    return read_error_unit(ReadRef.read_bytes_at(data, this.offset, this.size_), "Archive member size is too large");
  }
}

/** `u64::MAX` as a `number` (rounded; see endian.ts). */
const U64_MAX = 2 ** 64 - 1;

/// An offset of a member in an archive.
export class ArchiveOffset {
  constructor(readonly _0: number) {}
}

/// An iterator over the symbols in the archive symbol table.
type SymbolIteratorInternal =
  /// There is no symbol table.
  | { $: "None" }
  /// A GNU symbol table.
  ///
  /// Contains:
  /// - the number of symbols as a 32-bit big-endian integer
  /// - the offsets of the member headers as 32-bit big-endian integers
  /// - the symbol names as null-terminated strings
  | { $: "Gnu"; offsets: SliceIter<U32>; names: Bytes }
  /// A GNU 64-bit symbol table
  ///
  /// Contains:
  /// - the number of symbols as a 64-bit big-endian integer
  /// - the offsets of the member headers as 64-bit big-endian integers
  /// - the symbol names as null-terminated strings
  | { $: "Gnu64"; offsets: SliceIter<U64>; names: Bytes }
  /// A BSD symbol table.
  ///
  /// Contains:
  /// - the size in bytes of the offsets array as a 32-bit little-endian integer
  /// - the offsets array, for which each entry is a pair of 32-bit little-endian integers
  ///   for the offset of the member header and the offset of the symbol name
  /// - the size in bytes of the symbol names as a 32-bit little-endian integer
  /// - the symbol names as null-terminated strings
  | { $: "Bsd"; offsets: SliceIter<U32[]>; names: Bytes }
  /// A BSD 64-bit symbol table.
  ///
  /// Contains:
  /// - the size in bytes of the offsets array as a 64-bit little-endian integer
  /// - the offsets array, for which each entry is a pair of 64-bit little-endian integers
  ///   for the offset of the member header and the offset of the symbol name
  /// - the size in bytes of the symbol names as a 64-bit little-endian integer
  /// - the symbol names as null-terminated strings
  | { $: "Bsd64"; offsets: SliceIter<U64[]>; names: Bytes }
  /// A Windows COFF symbol table.
  ///
  /// Contains:
  /// - the number of members as a 32-bit little-endian integer
  /// - the offsets of the member headers as 32-bit little-endian integers
  /// - the number of symbols as a 32-bit little-endian integer
  /// - the member index for each symbol as a 16-bit little-endian integer
  /// - the symbol names as null-terminated strings in lexical order
  | { $: "Coff"; members: PodSlice<U32>; indices: SliceIter<U16>; names: Bytes };

/// An iterator over the symbols in the archive symbol table.
export class ArchiveSymbolIterator {
  constructor(public _0: SymbolIteratorInternal) {}

  // crate: object-0.39.1/src/read/archive.rs:668 new
  static new(kind: ArchiveKind, data_: Uint8Array, offset: number, size: number): StdResult<ArchiveSymbolIterator, undefined> {
    const d = ReadRef.read_bytes_at(data_, offset, size);
    if (d.$ === "Err") return d;
    const data = new Bytes(d._0);
    switch (kind) {
      case "Unknown":
        return Ok(new ArchiveSymbolIterator({ $: "None" }));
      case "Gnu": {
        const c = data.read(U32.POD);
        if (c.$ === "Err") return c;
        const offsets_count = U32.get(c._0, BE);
        const offsets = data.read_slice(U32.POD, offsets_count);
        if (offsets.$ === "Err") return offsets;
        return Ok(new ArchiveSymbolIterator({ $: "Gnu", offsets: new SliceIter(offsets._0), names: data }));
      }
      case "Gnu64": {
        const c = data.read(U64.POD);
        if (c.$ === "Err") return c;
        const offsets_count = U64.get(c._0, BE);
        const offsets = data.read_slice(U64.POD, offsets_count);
        if (offsets.$ === "Err") return offsets;
        return Ok(new ArchiveSymbolIterator({ $: "Gnu64", offsets: new SliceIter(offsets._0), names: data }));
      }
      case "Bsd": {
        const s = data.read(U32.POD);
        if (s.$ === "Err") return s;
        const offsets_size = U32.get(s._0, LE);
        const offsets = data.read_slice(pod_array(U32.POD, 2), Math.floor(offsets_size / 8));
        if (offsets.$ === "Err") return offsets;
        const ns = data.read(U32.POD);
        if (ns.$ === "Err") return ns;
        const names_size = U32.get(ns._0, LE);
        const names = data.read_bytes(names_size);
        if (names.$ === "Err") return names;
        return Ok(new ArchiveSymbolIterator({ $: "Bsd", offsets: new SliceIter(offsets._0), names: names._0 }));
      }
      case "Bsd64": {
        const s = data.read(U64.POD);
        if (s.$ === "Err") return s;
        const offsets_size = U64.get(s._0, LE);
        const offsets = data.read_slice(pod_array(U64.POD, 2), Math.floor(offsets_size / 16));
        if (offsets.$ === "Err") return offsets;
        const ns = data.read(U64.POD);
        if (ns.$ === "Err") return ns;
        const names_size = U64.get(ns._0, LE);
        const names = data.read_bytes(names_size);
        if (names.$ === "Err") return names;
        return Ok(new ArchiveSymbolIterator({ $: "Bsd64", offsets: new SliceIter(offsets._0), names: names._0 }));
      }
      case "Coff": {
        const mc = data.read(U32.POD);
        if (mc.$ === "Err") return mc;
        const members_count = U32.get(mc._0, LE);
        const members = data.read_slice(U32.POD, members_count);
        if (members.$ === "Err") return members;
        const ic = data.read(U32.POD);
        if (ic.$ === "Err") return ic;
        const indices_count = U32.get(ic._0, LE);
        const indices = data.read_slice(U16.POD, indices_count);
        if (indices.$ === "Err") return indices;
        return Ok(new ArchiveSymbolIterator({ $: "Coff", members: members._0, indices: new SliceIter(indices._0), names: data }));
      }
      // TODO: Implement AIX big archive symbol table.
      case "AixBig":
        return Ok(new ArchiveSymbolIterator({ $: "None" }));
    }
  }

  // crate: object-0.39.1/src/read/archive.rs:733 next
  next(): Result<ArchiveSymbol> | undefined {
    const s = this._0;
    switch (s.$) {
      case "None":
        return undefined;
      case "Gnu": {
        const o = s.offsets.next();
        if (o === undefined) return undefined;
        const offset = U32.get(o, BE);
        const name = read_error_unit(s.names.read_string(), "Missing archive symbol name");
        if (name.$ === "Err") return name;
        return Ok(new ArchiveSymbol(name._0, new ArchiveOffset(offset)));
      }
      case "Gnu64": {
        const o = s.offsets.next();
        if (o === undefined) return undefined;
        const offset = U64.get(o, BE);
        const name = read_error_unit(s.names.read_string(), "Missing archive symbol name");
        if (name.$ === "Err") return name;
        return Ok(new ArchiveSymbol(name._0, new ArchiveOffset(offset)));
      }
      case "Bsd": {
        const entry = s.offsets.next();
        if (entry === undefined) return undefined;
        const name = read_error_unit(s.names.read_string_at(U32.get(entry[0]!, LE)), "Invalid archive symbol name offset");
        if (name.$ === "Err") return name;
        return Ok(new ArchiveSymbol(name._0, new ArchiveOffset(U32.get(entry[1]!, LE))));
      }
      case "Bsd64": {
        const entry = s.offsets.next();
        if (entry === undefined) return undefined;
        const name = read_error_unit(s.names.read_string_at(U64.get(entry[0]!, LE)), "Invalid archive symbol name offset");
        if (name.$ === "Err") return name;
        return Ok(new ArchiveSymbol(name._0, new ArchiveOffset(U64.get(entry[1]!, LE))));
      }
      case "Coff": {
        const i = s.indices.next();
        if (i === undefined) return undefined;
        const index = (U16.get(i, LE) - 1) & 0xffff;
        const member = read_error_opt(s.members.get(index), "Invalid archive symbol member index");
        const name = read_error_unit(s.names.read_string(), "Missing archive symbol name");
        if (member.$ === "Err") return member;
        if (name.$ === "Err") return name;
        return Ok(new ArchiveSymbol(name._0, new ArchiveOffset(U32.get(member._0, LE))));
      }
    }
  }

  // crate: object-0.39.1/src/read/archive.rs:806 size_hint
  size_hint(): [number, number | undefined] {
    const s = this._0;
    switch (s.$) {
      case "None":
        return [0, undefined];
      case "Gnu":
        return s.offsets.size_hint();
      case "Gnu64":
        return s.offsets.size_hint();
      case "Bsd":
        return s.offsets.size_hint();
      case "Bsd64":
        return s.offsets.size_hint();
      case "Coff":
        // The `slice::Iter` is in the indices field for this variant
        return s.indices.size_hint();
    }
  }
}

/// A symbol in the archive symbol table.
///
/// This is used to find the member containing the symbol.
export class ArchiveSymbol {
  constructor(
    readonly name_: Uint8Array,
    readonly offset_: ArchiveOffset,
  ) {}

  /// Return the symbol name.
  // crate: object-0.39.1/src/read/archive.rs:833 name
  name(): Uint8Array {
    return this.name_;
  }

  /// Return the offset of the header for the member containing the symbol.
  // crate: object-0.39.1/src/read/archive.rs:839 offset
  offset(): ArchiveOffset {
    return this.offset_;
  }
}

function is_ascii_digit(c: number): boolean {
  return c >= 0x30 && c <= 0x39;
}

/** `char::to_digit(radix)` for an ASCII byte. */
function to_digit(c: number, radix: number): number | undefined {
  let d: number;
  if (c >= 0x30 && c <= 0x39) d = c - 0x30;
  else if (c >= 0x61 && c <= 0x7a) d = c - 0x61 + 10;
  else if (c >= 0x41 && c <= 0x5a) d = c - 0x41 + 10;
  else return undefined;
  return d < radix ? d : undefined;
}

// Ignores bytes starting from the first space.
// crate: object-0.39.1/src/read/archive.rs:845 parse_u64_digits
export function parse_u64_digits(digits: Uint8Array, radix: number): number | undefined {
  if (digits.length > 0 && digits[0] === 0x20 /* ' ' */) {
    return undefined;
  }
  // PORT: computed in bigint so `checked_mul` / `checked_add` overflow exactly at u64::MAX; the
  // result is returned as a `number` (see the header).
  let result = 0n;
  for (const c of digits) {
    if (c === 0x20 /* ' ' */) {
      return Number(result);
    } else {
      const x = to_digit(c, radix);
      if (x === undefined) return undefined;
      result = result * BigInt(radix) + BigInt(x);
      if (result > 0xffff_ffff_ffff_ffffn) return undefined;
    }
  }
  return Number(result);
}

/// Digits are a decimal offset into the extended name table.
/// Name is terminated by "/\n" (for GNU) or a null byte (for COFF).
// crate: object-0.39.1/src/read/archive.rs:865 parse_sysv_extended_name
function parse_sysv_extended_name(digits: Uint8Array, names: Uint8Array): StdResult<Uint8Array, undefined> {
  const offset = parse_u64_digits(digits, 10);
  if (offset === undefined) return Err(undefined);
  // `names.get(offset..)`
  if (offset > names.length) return Err(undefined);
  const name_data = names.subarray(offset);
  // `memchr::memchr2(b'\n', b'\0', name_data)`
  let len = -1;
  for (let i = 0; i < name_data.length; i++) {
    if (name_data[i] === 0x0a || name_data[i] === 0x00) {
      len = i;
      break;
    }
  }
  if (len === -1) return Err(undefined);
  if (name_data[len] === 0x0a /* '\n' */) {
    if (len < 1 || name_data[len - 1] !== 0x2f /* '/' */) {
      return Err(undefined);
    } else {
      return Ok(name_data.subarray(0, len - 1));
    }
  } else {
    return Ok(name_data.subarray(0, len));
  }
}

/// Digits are a decimal length of the extended name, which is contained
/// in `data` at `offset`.
/// Modifies `offset` and `size` to start after the extended name.
// crate: object-0.39.1/src/read/archive.rs:884 parse_bsd_extended_name
function parse_bsd_extended_name(
  digits: Uint8Array,
  data: Uint8Array,
  offset: MutRef<number>,
  size: MutRef<number>,
): StdResult<Uint8Array, undefined> {
  const len = parse_u64_digits(digits, 10);
  if (len === undefined) return Err(undefined);
  // `size.checked_sub(len)`
  if (len > size.value) return Err(undefined);
  size.value = size.value - len;
  const name_data = ReadRef.read_bytes(data, offset, len);
  if (name_data.$ === "Err") return name_data;
  const nul = name_data._0.indexOf(0);
  const name = nul !== -1 ? name_data._0.subarray(0, nul) : name_data._0;
  return Ok(name);
}

