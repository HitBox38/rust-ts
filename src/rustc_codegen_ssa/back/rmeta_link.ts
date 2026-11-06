// Port of compiler/rustc_codegen_ssa/src/back/rmeta_link.rs.
//
//! Late-metadata archive member that lists which rlib entries are Rust object files,
//! and potentially other data collected and used when building or linking a rlib.
//! See <https://github.com/rust-lang/rust/issues/138243>.
//
// PORT: `Vec<String>` / `Vec<Option<String>>`'s `Encodable` / `Decodable` are spelled out (`emit_usize` + elements, an `Option`
// as a `u8` tag). `debug!` calls are comments.
import { File as FsFile, Mmap } from "../../rustc_data_structures/memmap.ts";
import { MemEncoder } from "../../rustc_serialize/opaque/mem_encoder.ts";
import { MAGIC_END_BYTES, MemDecoder } from "../../rustc_serialize/opaque.ts";
import { Decoder_provided, Encoder_provided } from "../../rustc_serialize/serialize.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import type { Target } from "../../rustc_target/spec/mod.ts";
import { panic } from "../../std/panic.ts";
import { ArchiveFile } from "../../vendor/object/read/archive.ts";
import type { NativeLib } from "../lib.ts";
import { get_metadata_xcoff, search_for_section } from "./metadata.ts";

export const FILENAME = "lib.rmeta-link";
export const SECTION = ".rmeta-link";

const encoder = new TextEncoder();

export class RmetaLink {
  constructor(
    public rust_object_files: string[],
    /// Positionally aligned with `native_libraries` in regular metadata: index `i` is the
    /// bundled filename for native library `i`, or `None` if that library needs no bundling.
    public native_lib_filenames: (string | undefined)[],
  ) {}

  // rustc: compiler/rustc_codegen_ssa/src/back/rmeta_link.rs:33 encode
  encode(): Uint8Array {
    const e = MemEncoder.new();
    e.emit_usize(this.rust_object_files.length);
    for (const s of this.rust_object_files) {
      Encoder_provided.emit_str(e, s);
    }
    e.emit_usize(this.native_lib_filenames.length);
    for (const s of this.native_lib_filenames) {
      if (s === undefined) {
        e.emit_u8(0);
      } else {
        e.emit_u8(1);
        Encoder_provided.emit_str(e, s);
      }
    }
    const data = e.finish();
    const out = new Uint8Array(data.length + MAGIC_END_BYTES.length);
    out.set(data);
    out.set(MAGIC_END_BYTES, data.length);
    return out;
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/rmeta_link.rs:42 decode
  static decode(data: Uint8Array): RmetaLink | undefined {
    const d = MemDecoder.new(data, 0);
    if (d.$ === "Err") return undefined;
    const decoder = d._0;
    const rust_object_files: string[] = [];
    for (let n = decoder.read_usize(); n > 0; n--) {
      rust_object_files.push(Decoder_provided.read_str(decoder));
    }
    const native_lib_filenames: (string | undefined)[] = [];
    for (let n = decoder.read_usize(); n > 0; n--) {
      const tag = decoder.read_usize();
      if (tag === 0) native_lib_filenames.push(undefined);
      else if (tag === 1) native_lib_filenames.push(Decoder_provided.read_str(decoder));
      else return panic("Encountered invalid discriminant while decoding `Option`.");
    }
    return new RmetaLink(rust_object_files, native_lib_filenames);
  }
}

/// Reads the link-time metadata from an already-parsed archive.
// rustc: compiler/rustc_codegen_ssa/src/back/rmeta_link.rs:51 read
export function read(archive: ArchiveFile, archive_data: Uint8Array, rlib_path: string): RmetaLink | undefined {
  const filename = encoder.encode(FILENAME);
  for (const entry of archive.members()) {
    if (entry.$ === "Err") return undefined;
    const e = entry._0;
    if (bytes_eq(e.name(), filename)) {
      const data = e.data(archive_data);
      if (data.$ === "Err") return undefined;
      const section_data = search_for_section(rlib_path, data._0, SECTION);
      if (section_data.$ === "Err") return undefined;
      return RmetaLink.decode(section_data._0);
    }
  }
  return undefined;
}

/// Like [`read`], but parses the archive from raw bytes.
///
/// Use this when the caller's `ArchiveFile` comes from a different version of the `object` crate.
// rustc: compiler/rustc_codegen_ssa/src/back/rmeta_link.rs:66 read_from_data
export function read_from_data(archive_data: Uint8Array, rlib_path: string): RmetaLink | undefined {
  const archive = ArchiveFile.parse(archive_data);
  if (archive.$ === "Err") return undefined;
  return read(archive._0, archive_data, rlib_path);
}

const bytes_eq = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

export class RmetaLinkCache {
  cache = new Map<string, RmetaLink | undefined>();

  // rustc: compiler/rustc_codegen_ssa/src/back/rmeta_link.rs:77 get_or_insert_with
  get_or_insert_with(rlib_path: string, load: () => RmetaLink | undefined): RmetaLink | undefined {
    if (!this.cache.has(rlib_path)) {
      this.cache.set(rlib_path, load());
    }
    return this.cache.get(rlib_path);
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/rmeta_link.rs:85 native_lib_filenames
  native_lib_filenames(target: Target, rlib_path: string, native_libs: readonly NativeLib[]): (Symbol | undefined)[] {
    if (!crate_may_have_bundled_libs(native_libs)) {
      return [];
    }
    const rl = this.get_or_insert_with(rlib_path, () => read_from_path(target, rlib_path));
    if (rl === undefined) return [];
    return rl.native_lib_filenames.map((f) => (f === undefined ? undefined : Symbol.intern(f)));
  }
}

// rustc: compiler/rustc_codegen_ssa/src/back/rmeta_link.rs:102 crate_may_have_bundled_libs
function crate_may_have_bundled_libs(libs: readonly NativeLib[]): boolean {
  return libs.some((lib) => lib.kind.$ === "Static" && (lib.kind.bundle === true || lib.kind.bundle === undefined));
}

// FIXME: this is mostly a copy-paste of `DefaultMetadataLoader::get_rlib_metadata`.
// rustc: compiler/rustc_codegen_ssa/src/back/rmeta_link.rs:108 read_from_path
function read_from_path(target: Target, path: string): RmetaLink | undefined {
  const file = FsFile.open(path);
  if (file.$ === "Err") {
    // debug!("failed to open rlib for rmeta-link: {}", path.display());
    return undefined;
  }
  const mmap = Mmap.map(file._0);
  if (mmap.$ === "Err") {
    // debug!("failed to mmap rlib for rmeta-link: {}", path.display());
    return undefined;
  }
  const data = mmap._0.deref();

  if (target.is_like_aix) {
    const archive = ArchiveFile.parse(data);
    if (archive.$ === "Err") return undefined;
    const filename = encoder.encode(FILENAME);
    for (const entry of archive._0.members()) {
      if (entry.$ === "Err") return undefined;
      const e = entry._0;
      if (bytes_eq(e.name(), filename)) {
        const member_data = e.data(data);
        if (member_data.$ === "Err") return undefined;
        const section_data = get_metadata_xcoff(path, member_data._0);
        if (section_data.$ === "Err") return undefined;
        return RmetaLink.decode(section_data._0);
      }
    }
    return undefined;
  }

  return read_from_data(data, path);
}
