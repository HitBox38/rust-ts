// Port of ar_archive_writer 0.5.3 `src/archive_writer.rs`.
// Derived from code in LLVM, which is:
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
// PORT: `W: Write + Seek` and `Cursor<Vec<u8>>` are `ArchiveWriter`, a growable byte buffer with a position at its end
// (nothing here seeks back); the caller writes the file. `BTreeMap<Box<[u8]>, u16>` (`SymMap`) is a `Map` from the name's
// latin-1 spelling, which sorts as the bytes do, walked sorted. A name (`String`) is written as UTF-8 and `name.len()` is its
// UTF-8 length. `write!`'s `{:<N}` is `pad`. Offsets are `number`s (`u64` in upstream): an archive stays below 2^53 bytes.
import { io_error_other, type IoResult } from "../../std/io.ts";
import { assert, panic } from "../../std/panic.ts";
import { Err, Ok } from "../../std/result.ts";
import { MAX_MEMBER_SIZE, type ArchiveKind, SIZE_OF_BIG_AR_MEM_HDR_TYPE, SIZE_OF_FIX_LEN_HDR } from "./archive.ts";
import { align_to, offset_to_alignment } from "./alignment.ts";
import { IMPORT_DESCRIPTOR_PREFIX, NULL_IMPORT_DESCRIPTOR_SYMBOL_NAME, NULL_THUNK_DATA_PREFIX, NULL_THUNK_DATA_SUFFIX } from "./coff_import_file.ts";
import { DEFAULT_OBJECT_READER, type ObjectReader } from "./lib.ts";
import { align_to_power_of2 } from "./math_extras.ts";

const BIG_AR_MEM_HDR_SIZE = SIZE_OF_BIG_AR_MEM_HDR_TYPE;

const encoder = new TextEncoder();
const utf8 = (s: string): Uint8Array => encoder.encode(s);
const utf8_len = (s: string): number => encoder.encode(s).length;
/** `{:<width}` (`fill` for the `{nil:\0<pad$}` spelling). */
const pad = (v: string | number, width: number, fill = " "): string => String(v).padEnd(width, fill);

/** `W: Write + Seek`, and `Cursor<Vec<u8>>`: see the header. */
export class ArchiveWriter {
  private data = new Uint8Array(1024);
  private length = 0;

  /** `Write::write_all` */
  write_all(v: Uint8Array): void {
    if (this.length + v.length > this.data.length) {
      const next = new Uint8Array(Math.max(this.length + v.length, this.data.length * 2));
      next.set(this.data.subarray(0, this.length));
      this.data = next;
    }
    this.data.set(v, this.length);
    this.length += v.length;
  }

  /** `write!(w, "...")` */
  write_str(s: string): void {
    this.write_all(utf8(s));
  }

  /** `Seek::stream_position` */
  stream_position(): number {
    return this.length;
  }

  /** `Cursor::into_inner`, `get_ref`; the bytes of a finished stream. */
  bytes(): Uint8Array {
    return this.data.subarray(0, this.length);
  }
}

interface SymMap {
  use_ec_map: boolean;
  map: Map<string, number>;
  ec_map: Map<string, number>;
}

const latin1 = (s: Uint8Array): string => {
  let k = "";
  for (let i = 0; i < s.length; i++) k += String.fromCharCode(s[i]!);
  return k;
};
const latin1_bytes = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));
/** `BTreeMap`'s order: the keys' bytes. */
const sorted = (m: Map<string, number>): [string, number][] => [...m].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

export class NewArchiveMember {
  constructor(
    public buf: Uint8Array,
    public object_reader: ObjectReader,
    public member_name: string,
    public mtime: number,
    public uid: number,
    public gid: number,
    public perms: number,
  ) {}

  // crate: ar_archive_writer-0.5.3/src/archive_writer.rs:45 new
  static new(buf: Uint8Array, object_reader: ObjectReader, member_name: string): NewArchiveMember {
    return new NewArchiveMember(buf, object_reader, member_name, 0, 0, 0, 0o644);
  }
}

// crate: ar_archive_writer-0.5.3/src/archive_writer.rs:62 is_darwin
function is_darwin(kind: ArchiveKind): boolean {
  return kind === "Darwin" || kind === "Darwin64";
}

// crate: ar_archive_writer-0.5.3/src/archive_writer.rs:66 is_aix_big_archive
function is_aix_big_archive(kind: ArchiveKind): boolean {
  return kind === "AixBig";
}

// crate: ar_archive_writer-0.5.3/src/archive_writer.rs:70 is_coff_archive
function is_coff_archive(kind: ArchiveKind): boolean {
  return kind === "Coff";
}

// crate: ar_archive_writer-0.5.3/src/archive_writer.rs:74 is_bsd_like
function is_bsd_like(kind: ArchiveKind): boolean {
  switch (kind) {
    case "Gnu":
    case "Gnu64":
    case "AixBig":
    case "Coff":
      return false;
    case "Bsd":
    case "Darwin":
    case "Darwin64":
      return true;
  }
}

// crate: ar_archive_writer-0.5.3/src/archive_writer.rs:81 print_rest_of_member_header
function print_rest_of_member_header(w: ArchiveWriter, mtime: number, uid: number, gid: number, perms: number, size: number): void {
  // The format has only 6 chars for uid and gid. Truncate if the provided
  // values don't fit.
  w.write_str(`${pad(mtime, 12)}${pad(uid % 1000000, 6)}${pad(gid % 1000000, 6)}${pad(perms.toString(8), 8)}${pad(size, 10)}\`\n`);
}

// crate: ar_archive_writer-0.5.3/src/archive_writer.rs:102 print_gnu_small_member_header
function print_gnu_small_member_header(w: ArchiveWriter, name: string, mtime: number, uid: number, gid: number, perms: number, size: number): void {
  w.write_str(pad(name + "/", 16));
  print_rest_of_member_header(w, mtime, uid, gid, perms, size);
}

// crate: ar_archive_writer-0.5.3/src/archive_writer.rs:115 print_bsd_member_header
function print_bsd_member_header(w: ArchiveWriter, pos: number, name: string, mtime: number, uid: number, gid: number, perms: number, size: number): void {
  const pos_after_header = pos + 60 + utf8_len(name);
  // Pad so that even 64 bit object files are aligned.
  const pad_ = offset_to_alignment(pos_after_header, 8);
  const name_with_padding = utf8_len(name) + pad_;
  w.write_str(`#1/${pad(name_with_padding, 13)}`);
  print_rest_of_member_header(w, mtime, uid, gid, perms, name_with_padding + size);
  w.write_str(name);
  w.write_str(pad("", pad_, "\0"));
}

// crate: ar_archive_writer-0.5.3/src/archive_writer.rs:140 print_big_archive_member_header
function print_big_archive_member_header(
  w: ArchiveWriter,
  name: string,
  mtime: number,
  uid: number,
  gid: number,
  perms: number,
  size: number,
  prev_offset: number,
  next_offset: number,
): void {
  w.write_str(`${pad(size, 20)}${pad(next_offset, 20)}${pad(prev_offset, 20)}${pad(mtime, 12)}${pad(uid % 1000000000000, 12)}${pad(gid % 1000000000000, 12)}${pad(perms.toString(8), 12)}${pad(utf8_len(name), 4)}`);

  if (name.length !== 0) {
    w.write_str(name);

    if (utf8_len(name) % 2 !== 0) {
      w.write_str("\0");
    }
  }

  w.write_str("`\n");
}

// crate: ar_archive_writer-0.5.3/src/archive_writer.rs:177 use_string_table
function use_string_table(thin: boolean, name: string): boolean {
  return thin || utf8_len(name) >= 16 || name.includes("/");
}

// crate: ar_archive_writer-0.5.3/src/archive_writer.rs:181 is_64bit_kind
function is_64bit_kind(kind: ArchiveKind): boolean {
  switch (kind) {
    case "Gnu":
    case "Bsd":
    case "Darwin":
    case "Coff":
      return false;
    case "AixBig":
    case "Darwin64":
    case "Gnu64":
      return true;
  }
}

// crate: ar_archive_writer-0.5.3/src/archive_writer.rs:188 print_member_header
function print_member_header(
  w: ArchiveWriter,
  pos: number,
  string_table: ArchiveWriter,
  member_names: Map<string, number>,
  kind: ArchiveKind,
  thin: boolean,
  m: NewArchiveMember,
  mtime: number,
  size: number,
): void {
  if (is_bsd_like(kind)) {
    return print_bsd_member_header(w, pos, m.member_name, mtime, m.uid, m.gid, m.perms, size);
  }

  if (!use_string_table(thin, m.member_name)) {
    return print_gnu_small_member_header(w, m.member_name, mtime, m.uid, m.gid, m.perms, size);
  }

  w.write_str("/");
  let name_pos: number;
  const got = member_names.get(m.member_name);
  if (thin) {
    name_pos = string_table.stream_position();
    string_table.write_str(`${m.member_name}/\n`);
  } else if (got !== undefined) {
    name_pos = got;
  } else {
    name_pos = string_table.stream_position();
    member_names.set(m.member_name, name_pos);
    string_table.write_str(m.member_name);
    if (is_coff_archive(kind)) {
      string_table.write_str("\0");
    } else {
      string_table.write_str("/\n");
    }
  }
  w.write_str(pad(name_pos, 15));
  print_rest_of_member_header(w, mtime, m.uid, m.gid, m.perms, size);
}

interface MemberData {
  symbols: number[];
  header: Uint8Array;
  data: Uint8Array;
  padding: Uint8Array;
  pre_head_pad_size: number;
  object_reader: ObjectReader;
}

// crate: ar_archive_writer-0.5.3/src/archive_writer.rs:245 compute_string_table
function compute_string_table(names: Uint8Array): MemberData {
  const size = names.length;
  const pad_ = offset_to_alignment(size, 2);
  const header = new ArchiveWriter();
  header.write_str(pad("//", 48));
  header.write_str(pad(size + pad_, 10));
  header.write_str("`\n");
  return {
    symbols: [],
    header: header.bytes(),
    data: names,
    padding: pad_ !== 0 ? utf8("\n") : new Uint8Array(0),
    pre_head_pad_size: 0,
    object_reader: DEFAULT_OBJECT_READER,
  };
}

// crate: ar_archive_writer-0.5.3/src/archive_writer.rs:262 now
function now(): number {
  return 0;
}

// NOTE: isArchiveSymbol was moved to object_reader.rs

/** `u32::try_from(val).unwrap()` */
function u32_try_from(val: number): number {
  if (val > 0xffff_ffff) return panic("called `Result::unwrap()` on an `Err` value: TryFromIntError(())");
  return val;
}

// crate: ar_archive_writer-0.5.3/src/archive_writer.rs:268 print_n_bits
function print_n_bits(w: ArchiveWriter, kind: ArchiveKind, val: number): void {
  const b = new DataView(new ArrayBuffer(8));
  const le = is_bsd_like(kind);
  if (is_64bit_kind(kind)) {
    b.setBigUint64(0, BigInt(val), le);
    w.write_all(new Uint8Array(b.buffer, 0, 8));
  } else {
    b.setUint32(0, u32_try_from(val), le);
    w.write_all(new Uint8Array(b.buffer, 0, 4));
  }
}

// crate: ar_archive_writer-0.5.3/src/archive_writer.rs:284 compute_symbol_table_size_and_pad
function compute_symbol_table_size_and_pad(kind: ArchiveKind, num_syms: number, offset_size: number, string_table_size: number): [number, number] {
  assert(offset_size === 4 || offset_size === 8, "Unsupported offset_size");
  let size = offset_size; // Number of entries
  if (is_bsd_like(kind)) {
    size += num_syms * offset_size * 2; // Table
  } else {
    size += num_syms * offset_size; // Table
  }
  if (is_bsd_like(kind)) {
    size += offset_size; // byte count;
  }
  size += string_table_size;
  // ld64 expects the members to be 8-byte aligned for 64-bit content and at
  // least 4-byte aligned for 32-bit content.  Opt for the larger encoding
  // uniformly.
  // We do this for all bsd formats because it simplifies aligning members.
  const pad_ = is_aix_big_archive(kind) ? 0 : offset_to_alignment(size, is_bsd_like(kind) ? 8 : 2);
  size += pad_;
  return [size, pad_];
}

// crate: ar_archive_writer-0.5.3/src/archive_writer.rs:317 compute_symbol_map_size_and_pad
function compute_symbol_map_size_and_pad(num_obj: number, sym_map: SymMap): [number, number] {
  let size = 4 * 2; // Number of symbols and objects entries
  size += num_obj * 4; // Offset table

  for (const name of sym_map.map.keys()) {
    size += 2 + name.length + 1;
  }

  const pad_ = offset_to_alignment(size, 2);
  size += pad_;
  return [size, pad_];
}

// crate: ar_archive_writer-0.5.3/src/archive_writer.rs:331 compute_ec_symbols_size_and_pad
function compute_ec_symbols_size_and_pad(sym_map: SymMap): [number, number] {
  let size = 4; // Number of symbols

  for (const name of sym_map.ec_map.keys()) {
    size += 2 + name.length + 1;
  }

  const pad_ = offset_to_alignment(size, 2);
  size += pad_;
  return [size, pad_];
}

// crate: ar_archive_writer-0.5.3/src/archive_writer.rs:344 write_symbol_table_header
function write_symbol_table_header(w: ArchiveWriter, kind: ArchiveKind, size: number, prev_member_offset: number, next_member_offset: number): void {
  if (is_bsd_like(kind)) {
    const name = is_64bit_kind(kind) ? "__.SYMDEF_64" : "__.SYMDEF";
    const pos = w.stream_position();
    print_bsd_member_header(w, pos, name, now(), 0, 0, 0, size);
  } else if (is_aix_big_archive(kind)) {
    print_big_archive_member_header(w, "", now(), 0, 0, 0, size, prev_member_offset, next_member_offset);
  } else {
    const name = is_64bit_kind(kind) ? "/SYM64" : "";
    print_gnu_small_member_header(w, name, now(), 0, 0, 0, size);
  }
}

// crate: ar_archive_writer-0.5.3/src/archive_writer.rs:377 compute_headers_size
function compute_headers_size(kind: ArchiveKind, num_members: number, string_member_size: number, num_syms: number, sym_names_size: number, sym_map: SymMap | undefined): number {
  const offset_size = is_64bit_kind(kind) ? 8 : 4;
  const [symtab_size] = compute_symbol_table_size_and_pad(kind, num_syms, offset_size, sym_names_size);
  const compute_symbol_table_header_size = (): number => {
    const tmp = new ArchiveWriter();
    write_symbol_table_header(tmp, kind, symtab_size, 0, 0);
    return tmp.bytes().length;
  };
  const header_size = compute_symbol_table_header_size();
  let size = "!<arch>\n".length + header_size + symtab_size;

  if (sym_map !== undefined) {
    size += header_size + compute_symbol_map_size_and_pad(num_members, sym_map)[0];
    if (sym_map.ec_map.size !== 0) {
      size += header_size + compute_ec_symbols_size_and_pad(sym_map)[0];
    }
  }

  return size + string_member_size;
}

// NOTE: is64BitSymbolicFile, getAuxMaxAlignment and getMemberAlignment were
// moved to object_reader.rs

// crate: ar_archive_writer-0.5.3/src/archive_writer.rs:409 write_symbol_table
function write_symbol_table(
  w: ArchiveWriter,
  kind: ArchiveKind,
  members: readonly MemberData[],
  string_table: Uint8Array,
  members_offset: number,
  num_syms: number,
  prev_member_offset: number,
  next_member_offset: number,
  is_64_bit: boolean,
): void {
  // We don't write a symbol table on an archive with no members -- except on
  // Darwin, where the linker will abort unless the archive has a symbol table.
  if (string_table.length === 0 && !is_darwin(kind) && !is_coff_archive(kind)) {
    return;
  }

  const offset_size = is_64bit_kind(kind) ? 8 : 4;
  const [size, pad_] = compute_symbol_table_size_and_pad(kind, num_syms, offset_size, string_table.length);
  write_symbol_table_header(w, kind, size, prev_member_offset, next_member_offset);

  if (is_bsd_like(kind)) {
    print_n_bits(w, kind, num_syms * 2 * offset_size);
  } else {
    print_n_bits(w, kind, num_syms);
  }

  let pos = members_offset;
  for (const m of members) {
    if (is_aix_big_archive(kind)) {
      pos += m.pre_head_pad_size;
      if (m.object_reader.is_64_bit_object_file(m.data) !== is_64_bit) {
        pos += m.header.length + m.data.length + m.padding.length;
        continue;
      }
    }

    for (const string_offset of m.symbols) {
      if (is_bsd_like(kind)) {
        print_n_bits(w, kind, string_offset);
      }
      print_n_bits(w, kind, pos); // member offset
    }
    pos += m.header.length + m.data.length + m.padding.length;
  }

  if (is_bsd_like(kind)) {
    // byte count of the string table
    print_n_bits(w, kind, string_table.length);
  }

  w.write_all(string_table);

  w.write_str(pad("", pad_, "\0"));
}

const u16_le = (v: number): Uint8Array => Uint8Array.of(v & 0xff, (v >>> 8) & 0xff);
const u32_le = (v: number): Uint8Array => Uint8Array.of(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);

// crate: ar_archive_writer-0.5.3/src/archive_writer.rs:475 write_symbol_map
function write_symbol_map(w: ArchiveWriter, kind: ArchiveKind, members: readonly MemberData[], sym_map: SymMap, members_offset: number): void {
  const [size, pad_] = compute_symbol_map_size_and_pad(members.length, sym_map);
  write_symbol_table_header(w, kind, size, 0, 0);

  let pos = u32_try_from(members_offset);

  w.write_all(u32_le(u32_try_from(members.length)));
  for (const m of members) {
    w.write_all(u32_le(pos)); // member offset
    pos = u32_try_from(pos + m.header.length + m.data.length + m.padding.length);
  }

  w.write_all(u32_le(u32_try_from(sym_map.map.size)));

  const entries = sorted(sym_map.map);
  for (const [, s] of entries) {
    w.write_all(u16_le(s));
  }
  for (const [s] of entries) {
    w.write_all(latin1_bytes(s));
    w.write_all(Uint8Array.of(0));
  }

  w.write_str(pad("", pad_, "\0"));
}

// crate: ar_archive_writer-0.5.3/src/archive_writer.rs:518 write_ec_symbols
function write_ec_symbols(w: ArchiveWriter, sym_map: SymMap): void {
  const [size, pad_] = compute_ec_symbols_size_and_pad(sym_map);
  print_gnu_small_member_header(w, "/<ECSYMBOLS>", now(), 0, 0, 0, size);

  w.write_all(u32_le(u32_try_from(sym_map.ec_map.size)));

  const entries = sorted(sym_map.ec_map);
  for (const [, s] of entries) {
    w.write_all(u16_le(s));
  }
  for (const [s] of entries) {
    w.write_all(latin1_bytes(s));
    w.write_all(Uint8Array.of(0));
  }

  w.write_str(pad("", pad_, "\0"));
}

// NOTE: isECObject and isAnyArm64COFF was moved to object_reader.rs

const starts_with = (name: Uint8Array, p: Uint8Array): boolean => name.length >= p.length && p.every((b, i) => name[i] === b);
const ends_with = (name: Uint8Array, p: Uint8Array): boolean => name.length >= p.length && p.every((b, i) => name[name.length - p.length + i] === b);

// crate: ar_archive_writer-0.5.3/src/archive_writer.rs:543 is_import_descriptor
function is_import_descriptor(name: Uint8Array): boolean {
  return starts_with(name, IMPORT_DESCRIPTOR_PREFIX) || starts_with(name, NULL_IMPORT_DESCRIPTOR_SYMBOL_NAME) || (starts_with(name, NULL_THUNK_DATA_PREFIX) && ends_with(name, NULL_THUNK_DATA_SUFFIX));
}

// NOTE: LLVM calls this getSymbols and has the get_native_object_symbols
// function (moved to object_reader.rs) inlined.
// NOTE: LLVM uses u16 as symbol index. This is only used for the COFF archive
// format. If there are more than 0xfffe archive members however we switch to
// the GNU archive format which ignores the symbol index. As such to avoid an
// overflow accept usize here and only convert to u16 on COFF archives.
// crate: ar_archive_writer-0.5.3/src/archive_writer.rs:556 write_symbols
function write_symbols(obj: Uint8Array, index: number, sym_names: ArchiveWriter, sym_map: SymMap | undefined, object_reader: ObjectReader): IoResult<number[]> {
  const ret: number[] = [];

  let is_using_map = false;
  let map: Map<string, number> | undefined;
  let ec_map: Map<string, number> | undefined;
  if (sym_map !== undefined) {
    if (sym_map.use_ec_map && object_reader.is_ec_object_file(obj)) {
      map = sym_map.ec_map;
      ec_map = undefined;
    } else {
      is_using_map = true;
      map = sym_map.map;
      ec_map = sym_map.use_ec_map ? sym_map.ec_map : undefined;
    }
  }

  const r = object_reader.get_symbols(obj, (name) => {
    if (map !== undefined) {
      if (index > 0xffff) return panic("called `Result::unwrap()` on an `Err` value: TryFromIntError(())");
      const key = latin1(name);
      if (map.has(key)) {
        return Ok(null); // ignore duplicated symbol
      }
      map.set(key, index);

      if (is_using_map) {
        ret.push(sym_names.stream_position());
        sym_names.write_all(name);
        sym_names.write_all(Uint8Array.of(0));

        // If EC is enabled, then the import descriptors are NOT put into EC
        // objects so we need to copy them to the EC map manually.
        if (ec_map !== undefined && is_import_descriptor(name)) {
          ec_map.set(key, index);
        }
      }
    } else {
      ret.push(sym_names.stream_position());
      sym_names.write_all(name);
      sym_names.write_all(Uint8Array.of(0));
    }
    return Ok(null);
  });
  if (r.$ === "Err") return r;
  return Ok(ret);
}

// crate: ar_archive_writer-0.5.3/src/archive_writer.rs:612 compute_member_data
function compute_member_data(
  string_table: ArchiveWriter,
  sym_names: ArchiveWriter,
  kind: ArchiveKind,
  thin: boolean,
  sym_map: SymMap | undefined,
  new_members: readonly NewArchiveMember[],
  is_ec: boolean | undefined,
): IoResult<MemberData[]> {
  const PADDING_DATA = new Uint8Array(8).fill(0x0a);

  let mem_head_pad_size = 0;
  // This ignores the symbol table, but we only need the value mod 8 and the
  // symbol table is aligned to be a multiple of 8 bytes
  let pos = is_aix_big_archive(kind) ? SIZE_OF_FIX_LEN_HDR : 0;

  const ret: MemberData[] = [];
  let has_object = false;

  // Deduplicate long member names in the string table and reuse earlier name
  // offsets. This especially saves space for COFF Import libraries where all
  // members have the same name.
  const member_names = new Map<string, number>();

  // UniqueTimestamps is a special case to improve debugging on Darwin:
  //
  // The Darwin linker does not link debug info into the final
  // binary. Instead, it emits entries of type N_OSO in the output
  // binary's symbol table, containing references to the linked-in
  // object files. Using that reference, the debugger can read the
  // debug data directly from the object files. Alternatively, an
  // invocation of 'dsymutil' will link the debug data from the object
  // files into a dSYM bundle, which can be loaded by the debugger,
  // instead of the object files.
  //
  // For an object file, the N_OSO entries contain the absolute path
  // path to the file, and the file's timestamp. For an object
  // included in an archive, the path is formatted like
  // "/absolute/path/to/archive.a(member.o)", and the timestamp is the
  // archive member's timestamp, rather than the archive's timestamp.
  //
  // However, this doesn't always uniquely identify an object within
  // an archive -- an archive file can have multiple entries with the
  // same filename. (This will happen commonly if the original object
  // files started in different directories.) The only way they get
  // distinguished, then, is via the timestamp. But this process is
  // unable to find the correct object file in the archive when there
  // are two files of the same name and timestamp.
  //
  // Additionally, timestamp==0 is treated specially, and causes the
  // timestamp to be ignored as a match criteria.
  //
  // That will "usually" work out okay when creating an archive not in
  // deterministic timestamp mode, because the objects will probably
  // have been created at different timestamps.
  //
  // To ameliorate this problem, in deterministic archive mode (which
  // is the default), on Darwin we will emit a unique non-zero
  // timestamp for each entry with a duplicated name. This is still
  // deterministic: the only thing affecting that timestamp is the
  // order of the files in the resultant archive.
  //
  // See also the functions that handle the lookup:
  // in lldb: ObjectContainerBSDArchive::Archive::FindObject()
  // in llvm/tools/dsymutil: BinaryHolder::GetArchiveMemberBuffers().
  const unique_timestamps = is_darwin(kind);
  const filename_count = new Map<string, number>();
  if (unique_timestamps) {
    for (const m of new_members) {
      filename_count.set(m.member_name, (filename_count.get(m.member_name) ?? 0) + 1);
    }
    for (const [name, count] of filename_count) {
      filename_count.set(name, count > 1 ? 1 : 0);
    }
  }

  if (sym_map !== undefined) {
    if (is_ec !== undefined) {
      sym_map.use_ec_map = is_ec;
    } else {
      // When IsEC is not specified by the caller, use it when we have both
      // any ARM64 object (ARM64 or ARM64EC) and any EC object (ARM64EC or
      // AMD64). This may be a single ARM64EC object, but may also be separate
      // ARM64 and AMD64 objects.
      let have_arm64 = false;
      let have_ec = false;
      for (const m of new_members) {
        if (!have_arm64) {
          have_arm64 = m.object_reader.is_any_arm64_coff(m.buf);
        }
        if (!have_ec) {
          have_ec = m.object_reader.is_ec_object_file(m.buf);
        }
        if (have_arm64 && have_ec) {
          sym_map.use_ec_map = true;
          break;
        }
      }
    }
  }

  // The big archive format needs to know the offset of the previous member
  // header.
  let prev_offset = 0;
  let next_mem_head_pad_size = 0;
  let index = 0;
  for (const m of new_members) {
    const header = new ArchiveWriter();

    const buf = m.buf;
    const data = thin ? new Uint8Array(0) : buf;

    index += 1;

    // ld64 expects the members to be 8-byte aligned for 64-bit content and at
    // least 4-byte aligned for 32-bit content.  Opt for the larger encoding
    // uniformly.  This matches the behaviour with cctools and ensures that ld64
    // is happy with archives that we generate.
    const member_padding = is_darwin(kind) ? offset_to_alignment(data.length, 8) : 0;
    const tail_padding = offset_to_alignment(data.length + member_padding, 2);
    const padding = PADDING_DATA.subarray(0, member_padding + tail_padding);

    let mtime: number;
    if (unique_timestamps) {
      // Increment timestamp for each file of a given name.
      filename_count.set(m.member_name, filename_count.get(m.member_name)! + 1);
      mtime = filename_count.get(m.member_name)! - 1;
    } else {
      mtime = m.mtime;
    }

    const size = buf.length + member_padding;
    if (size > MAX_MEMBER_SIZE) {
      return Err(io_error_other(`Archive member ${m.member_name} is too big`));
    }

    // In the big archive file format, we need to calculate and include the next
    // member offset and previous member offset in the file member header.
    if (is_aix_big_archive(kind)) {
      const offset_to_mem_data = pos + BIG_AR_MEM_HDR_SIZE + align_to(utf8_len(m.member_name), 2);

      if (index === 1) {
        next_mem_head_pad_size = align_to_power_of2(offset_to_mem_data, m.object_reader.get_xcoff_member_alignment(buf)) - offset_to_mem_data;
      }

      mem_head_pad_size = next_mem_head_pad_size;
      pos += mem_head_pad_size;
      let next_offset = pos + BIG_AR_MEM_HDR_SIZE + align_to(utf8_len(m.member_name), 2) + align_to(size, 2);

      // If there is another member file after this, we need to calculate the
      // padding before the header.
      if (index !== new_members.length) {
        const offset_to_next_mem_data = next_offset + BIG_AR_MEM_HDR_SIZE + align_to(utf8_len(new_members[index]!.member_name), 2);
        next_mem_head_pad_size = align_to_power_of2(offset_to_next_mem_data, m.object_reader.get_xcoff_member_alignment(new_members[index]!.buf)) - offset_to_next_mem_data;
        next_offset += next_mem_head_pad_size;
      }

      print_big_archive_member_header(header, m.member_name, mtime, m.uid, m.gid, m.perms, size, prev_offset, next_offset);
      prev_offset = pos;
    } else {
      print_member_header(header, pos, string_table, member_names, kind, thin, m, mtime, size);
    }

    const symbols = write_symbols(buf, index, sym_names, sym_map, m.object_reader);
    if (symbols.$ === "Err") return symbols;
    has_object = true;

    pos += header.bytes().length + data.length + padding.length;
    ret.push({
      symbols: symbols._0,
      header: header.bytes(),
      data,
      padding,
      pre_head_pad_size: mem_head_pad_size,
      object_reader: m.object_reader,
    });
  }

  // If there are no symbols, emit an empty symbol table, to satisfy Solaris
  // tools, older versions of which expect a symbol table in a non-empty
  // archive, regardless of whether there are any symbols in it.
  if (has_object && sym_names.stream_position() === 0 && !is_coff_archive(kind)) {
    sym_names.write_str("\0\0\0");
  }

  return Ok(ret);
}

// crate: ar_archive_writer-0.5.3/src/archive_writer.rs:845 write_archive_to_stream
export function write_archive_to_stream(w: ArchiveWriter, new_members: readonly NewArchiveMember[], kind: ArchiveKind, thin: boolean, is_ec: boolean | undefined): IoResult<null> {
  assert(!thin || !is_bsd_like(kind), "Only the gnu format has a thin mode");

  const sym_names = new ArchiveWriter();
  const string_table_w = new ArchiveWriter();
  const sym_map: SymMap = { use_ec_map: false, map: new Map(), ec_map: new Map() };

  // COFF symbol map uses 16-bit indexes, so we can't use it if there are too
  // many members.
  if (is_coff_archive(kind) && new_members.length > 0xfffe) {
    kind = "Gnu";
  }

  const data_r = compute_member_data(string_table_w, sym_names, kind, thin, is_coff_archive(kind) ? sym_map : undefined, new_members, is_ec);
  if (data_r.$ === "Err") return data_r;
  const data = data_r._0;

  const sym_names_bytes = sym_names.bytes();

  let string_table_size = 0;
  let string_table_member: MemberData | undefined = undefined;
  const string_table = string_table_w.bytes();
  if (string_table.length !== 0 && !is_aix_big_archive(kind)) {
    const string_table_temp = compute_string_table(string_table);
    string_table_size = string_table_temp.header.length + string_table_temp.data.length + string_table_temp.padding.length;
    string_table_member = string_table_temp;
  }

  // We would like to detect if we need to switch to a 64-bit symbol table.
  let last_member_end_offset = 0;
  let last_member_header_offset = 0;
  let num_syms = 0;
  let num_syms32 = 0; // Store symbol number of 32-bit member files.

  for (const m of data) {
    // Record the start of the member's offset
    last_member_end_offset += m.pre_head_pad_size;
    last_member_header_offset = last_member_end_offset;
    // Account for the size of each part associated with the member.
    last_member_end_offset += m.header.length + m.data.length + m.padding.length;
    num_syms += m.symbols.length;

    // AIX big archive files may contain two global symbol tables. The
    // first global symbol table locates 32-bit file members that define global
    // symbols; the second global symbol table does the same for 64-bit file
    // members. As a big archive can have both 32-bit and 64-bit file members,
    // we need to know the number of symbols in each symbol table individually.
    if (is_aix_big_archive(kind) && !m.object_reader.is_64_bit_object_file(m.data)) {
      num_syms32 = num_syms32 + m.symbols.length;
    }
  }

  let maybe_headers_size: number | undefined = undefined;

  // The symbol table is put at the end of the big archive file. The symbol
  // table is at the start of the archive file for other archive formats.
  if (!is_64bit_kind(kind)) {
    // We assume 32-bit offsets to see if 32-bit symbols are possible or not.
    maybe_headers_size = compute_headers_size(kind, data.length, string_table_size, num_syms, sym_names_bytes.length, is_coff_archive(kind) ? sym_map : undefined);

    // The SYM64 format is used when an archive's member offsets are larger than
    // 32-bits can hold. The need for this shift in format is detected by
    // writeArchive. To test this we need to generate a file with a member that
    // has an offset larger than 32-bits but this demands a very slow test. To
    // speed the test up we use this environment variable to pretend like the
    // cutoff happens before 32-bits and instead happens at some much smaller
    // value.
    // FIXME allow lowering the threshold for tests
    const SYM64_THRESHOLD = 2 ** 32;

    // If LastMemberHeaderOffset isn't going to fit in a 32-bit varible we need
    // to switch to 64-bit. Note that the file can be larger than 4GB as long as
    // the last member starts before the 4GB offset.
    if (maybe_headers_size + last_member_header_offset >= SYM64_THRESHOLD) {
      if (kind === "Darwin") {
        kind = "Darwin64";
      } else {
        kind = "Gnu64";
      }
      maybe_headers_size = undefined;
    }
  }

  if (thin) {
    w.write_str("!<thin>\n");
  } else if (is_aix_big_archive(kind)) {
    w.write_str("<bigaf>\n");
  } else {
    w.write_str("!<arch>\n");
  }

  let headers_size: number;
  if (!is_aix_big_archive(kind)) {
    headers_size = maybe_headers_size !== undefined ? maybe_headers_size : compute_headers_size(kind, data.length, string_table_size, num_syms, sym_names_bytes.length, is_coff_archive(kind) ? sym_map : undefined);
    write_symbol_table(w, kind, data, sym_names_bytes, headers_size, num_syms, 0, 0, false);

    if (is_coff_archive(kind)) {
      write_symbol_map(w, kind, data, sym_map, headers_size);
    }

    if (string_table_size > 0) {
      const m = string_table_member!;
      w.write_all(m.header);
      w.write_all(m.data);
      w.write_all(m.padding);
    }

    if (sym_map.ec_map.size !== 0) {
      write_ec_symbols(w, sym_map);
    }

    for (const m of data) {
      w.write_all(m.header);
      w.write_all(m.data);
      w.write_all(m.padding);
    }
  } else {
    headers_size = SIZE_OF_FIX_LEN_HDR;
    last_member_end_offset += headers_size;
    last_member_header_offset += headers_size;

    // For the big archive (AIX) format, compute a table of member names and
    // offsets, used in the member table.
    let member_table_name_str_tbl_size = 0;
    const member_offsets: number[] = [];
    const member_names: string[] = [];

    // Loop across object to find offset and names.
    let member_end_offset = SIZE_OF_FIX_LEN_HDR;
    for (let i = 0; i < new_members.length; i++) {
      const member = new_members[i]!;
      member_table_name_str_tbl_size += utf8_len(member.member_name) + 1;
      member_end_offset += data[i]!.pre_head_pad_size;
      member_offsets.push(member_end_offset);
      member_names.push(member.member_name);
      // File member name ended with "`\n". The length is included in
      // BigArMemHdrType.
      member_end_offset += BIG_AR_MEM_HDR_SIZE + align_to(data[i]!.data.length, 2) + align_to(utf8_len(member.member_name), 2);
    }

    // AIX member table size.
    const member_table_size = 20 + 20 * member_offsets.length + member_table_name_str_tbl_size;

    const sym_names32 = new ArchiveWriter();
    const sym_names64 = new ArchiveWriter();

    if (num_syms > 0) {
      // Generate the symbol names for the members.
      for (const m of data) {
        const r = write_symbols(m.data, 0, m.object_reader.is_64_bit_object_file(m.data) ? sym_names64 : sym_names32, undefined, m.object_reader);
        if (r.$ === "Err") return r;
      }
    }

    const member_table_end_offset = last_member_end_offset + align_to(BIG_AR_MEM_HDR_SIZE + member_table_size, 2);

    // In AIX OS, The 'GlobSymOffset' field in the fixed-length header contains
    // the offset to the 32-bit global symbol table, and the 'GlobSym64Offset'
    // contains the offset to the 64-bit global symbol table.
    const global_symbol_offset = num_syms32 > 0 ? member_table_end_offset : 0;

    let global_symbol_offset64 = 0;
    const num_syms64 = num_syms - num_syms32;
    if (num_syms64 > 0) {
      if (global_symbol_offset === 0) {
        global_symbol_offset64 = member_table_end_offset;
      } else {
        // If there is a global symbol table for 32-bit members,
        // the 64-bit global symbol table is after the 32-bit one.
        global_symbol_offset64 = global_symbol_offset + BIG_AR_MEM_HDR_SIZE + (num_syms32 + 1) * 8 + align_to(sym_names32.bytes().length, 2);
      }
    }

    // Fixed Sized Header.
    // Offset to member table
    w.write_str(pad(new_members.length !== 0 ? last_member_end_offset : 0, 20));
    // If there are no file members in the archive, there will be no global
    // symbol table.
    w.write_str(pad(global_symbol_offset, 20));
    w.write_str(pad(global_symbol_offset64, 20));
    // Offset to first archive member
    w.write_str(pad(new_members.length !== 0 ? SIZE_OF_FIX_LEN_HDR + data[0]!.pre_head_pad_size : 0, 20));
    // Offset to last archive member
    w.write_str(pad(new_members.length !== 0 ? last_member_header_offset : 0, 20));
    // Offset to first member of free list - Not supported yet
    w.write_str(pad(0, 20));

    for (const m of data) {
      w.write_str(pad("", m.pre_head_pad_size, "\0"));
      w.write_all(m.header);
      w.write_all(m.data);
      if (m.data.length % 2 !== 0) {
        w.write_all(Uint8Array.of(0));
      }
    }

    if (new_members.length !== 0) {
      // Member table.
      print_big_archive_member_header(w, "", 0, 0, 0, 0, member_table_size, last_member_header_offset, global_symbol_offset !== 0 ? global_symbol_offset : global_symbol_offset64);
      w.write_str(pad(member_offsets.length, 20)); // Number of members
      for (const member_offset of member_offsets) {
        w.write_str(pad(member_offset, 20));
      }
      for (const member_name of member_names) {
        w.write_all(utf8(member_name));
        w.write_all(Uint8Array.of(0));
      }

      if (member_table_name_str_tbl_size % 2 !== 0) {
        // Name table must be tail padded to an even number of
        // bytes.
        w.write_all(Uint8Array.of(0));
      }

      // Write global symbol table for 32-bit file members.
      if (global_symbol_offset !== 0) {
        write_symbol_table(w, kind, data, sym_names32.bytes(), headers_size, num_syms32, last_member_end_offset, global_symbol_offset64, false);
        // Add padding between the symbol tables, if needed.
        if (global_symbol_offset64 !== 0 && sym_names32.bytes().length % 2 !== 0) {
          w.write_all(Uint8Array.of(0));
        }
      }

      // Write global symbol table for 64-bit file members.
      if (global_symbol_offset64 !== 0) {
        write_symbol_table(w, kind, data, sym_names64.bytes(), headers_size, num_syms64, global_symbol_offset !== 0 ? global_symbol_offset : last_member_end_offset, 0, true);
      }
    }
  }

  return Ok(null);
}
