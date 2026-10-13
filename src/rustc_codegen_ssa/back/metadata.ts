// Port of compiler/rustc_codegen_ssa/src/back/metadata.rs.
//
//! Reading of the rustc metadata for rlibs and dylibs
//
// PORT: the read half (`DefaultMetadataLoader`, `load_metadata_with`, `search_for_section`,
// `get_metadata_xcoff`) is ported; the write half (object/wrapper/compressed metadata files) is
// M5 and calls `unported(...)`. `&Path` is a `string` (`path.display()` is the string itself);
// `OwnedSlice` is a `Uint8Array` view into the mapped file (owned_slice.ts).
// PORT: `rustc_metadata::fs::METADATA_FILENAME` is copied here (fs.rs is the locator lane's).
// `debug!` tracing calls are kept as comments.

import { File as FsFile, Mmap } from "../../rustc_data_structures/memmap.ts";
import { type OwnedSlice, try_slice_owned } from "../../rustc_data_structures/owned_slice.ts";
import type { MetadataLoader } from "../../rustc_metadata/creader.ts";
import type { Session } from "../../rustc_session/session.ts";
import type { Target } from "../../rustc_target/spec/mod.ts";
import { display_IoError } from "../../std/io.ts";
import { unported } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { ArchiveFile } from "../../vendor/object/read/archive.ts";
import { File } from "../../vendor/object/read/any.ts";
import { display_Error } from "../../vendor/object/read/mod.ts";
import { Object_provided } from "../../vendor/object/read/traits.ts";

/** `rustc_metadata::fs::METADATA_FILENAME` (compiler/rustc_metadata/src/fs.rs:20). */
const METADATA_FILENAME = "lib.rmeta";

const utf8 = new TextEncoder();

/** `a == b` on byte slices. */
function bytes_eq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/// The default metadata loader. This is used by cg_llvm and cg_clif.
///
/// # Metadata location
///
/// <dl>
/// <dt>rlib</dt>
/// <dd>The metadata can be found in the `lib.rmeta` file inside of the ar archive.</dd>
/// <dt>dylib</dt>
/// <dd>The metadata can be found in the `.rustc` section of the shared library.</dd>
/// </dl>
// #[derive(Debug)]
// pub struct DefaultMetadataLoader;   (the unit value below)

const AIX_METADATA_SYMBOL_NAME = "__aix_rust_metadata";

// rustc: compiler/rustc_codegen_ssa/src/back/metadata.rs:43 load_metadata_with
function load_metadata_with(path: string, f: (data: Uint8Array) => Result<Uint8Array, string>): Result<OwnedSlice, string> {
  const file = FsFile.open(path);
  if (file.$ === "Err") return Err(`failed to open file '${path}': ${display_IoError(file._0)}`);

  const mmap = Mmap.map(file._0);
  if (mmap.$ === "Err") return Err(`failed to mmap file '${path}': ${display_IoError(mmap._0)}`);
  return try_slice_owned(mmap._0, (mmap) => f(mmap.deref()));
}

// impl MetadataLoader for DefaultMetadataLoader
export const DefaultMetadataLoader: MetadataLoader = {
  // rustc: compiler/rustc_codegen_ssa/src/back/metadata.rs:56 get_rlib_metadata
  get_rlib_metadata(target: Target, path: string): Result<OwnedSlice, string> {
    // debug!("getting rlib metadata for {}", path.display());
    return load_metadata_with(path, (data) => {
      const archive = ArchiveFile.parse(data);
      if (archive.$ === "Err") return Err(`failed to parse rlib '${path}': ${display_Error(archive._0)}`);

      for (const entry_result of archive._0.members()) {
        if (entry_result.$ === "Err") return Err(`failed to parse rlib '${path}': ${display_Error(entry_result._0)}`);
        const entry = entry_result._0;
        if (bytes_eq(entry.name(), utf8.encode(METADATA_FILENAME))) {
          const d = entry.data(data);
          if (d.$ === "Err") return Err(`failed to parse rlib '${path}': ${display_Error(d._0)}`);
          const data_ = d._0;
          if (target.is_like_aix) {
            return get_metadata_xcoff(path, data_);
          } else {
            return search_for_section(path, data_, ".rmeta");
          }
        }
      }

      return Err(`metadata not found in rlib '${path}'`);
    });
  },

  // rustc: compiler/rustc_codegen_ssa/src/back/metadata.rs:81 get_dylib_metadata
  get_dylib_metadata(target: Target, path: string): Result<OwnedSlice, string> {
    // debug!("getting dylib metadata for {}", path.display());
    if (target.is_like_aix) {
      return load_metadata_with(path, (data) => {
        const archive = ArchiveFile.parse(data);
        if (archive.$ === "Err") return Err(`failed to parse aix dylib '${path}': ${display_Error(archive._0)}`);

        // `archive.members().exactly_one()`
        const members = [...archive._0.members()];
        if (members.length === 1) {
          const lib = members[0]!;
          if (lib.$ === "Err") return Err(`failed to parse aix dylib '${path}': ${display_Error(lib._0)}`);
          const d = lib._0.data(data);
          if (d.$ === "Err") return Err(`failed to parse aix dylib '${path}': ${display_Error(d._0)}`);
          return get_metadata_xcoff(path, d._0);
        } else {
          return unported("itertools::ExactlyOneError Display (AIX dylibs: no rust-ts target)");
        }
      });
    } else {
      return load_metadata_with(path, (data) => search_for_section(path, data, ".rustc"));
    }
  },
};

// rustc: compiler/rustc_codegen_ssa/src/back/metadata.rs:108 search_for_section
export function search_for_section(path: string, bytes: Uint8Array, section: string): Result<Uint8Array, string> {
  const file = File.parse(bytes);
  if (file.$ === "Err") {
    // The parse above could fail for odd reasons like corruption, but for
    // now we just interpret it as this target doesn't support metadata
    // emission in object files so the entire byte slice itself is probably
    // a metadata file. Ideally though if necessary we could at least check
    // the prefix of bytes to see if it's an actual metadata object and if
    // not forward the error along here.
    return Ok(bytes);
  }
  const s = Object_provided.section_by_name(file._0, section);
  if (s === undefined) return Err(`no \`${section}\` section in '${path}'`);
  const d = s.data();
  if (d.$ === "Err") return Err(`failed to read ${section} section in '${path}': ${display_Error(d._0)}`);
  return Ok(d._0);
}

// rustc: compiler/rustc_codegen_ssa/src/back/metadata.rs:128 add_gnu_property_note
export function add_gnu_property_note(_file: unknown, _architecture: unknown, _endianness: unknown): never {
  return unported("rustc_codegen_ssa::back::metadata::add_gnu_property_note (object write, M5)");
}

// rustc: compiler/rustc_codegen_ssa/src/back/metadata.rs:173 get_metadata_xcoff
export function get_metadata_xcoff(path: string, data: Uint8Array): Result<Uint8Array, string> {
  const file = File.parse(data);
  if (file.$ === "Err") {
    return Ok(data);
  }
  const info_data = search_for_section(path, data, ".info");
  if (info_data.$ === "Err") return info_data;
  // `file.symbols().find(|sym| sym.name() == Ok(AIX_METADATA_SYMBOL_NAME))`: the symbol API is not
  // ported (only XCOFF files carry this symbol, and their parser is unported too).
  return unported(`object::read::File::symbols (looking for ${AIX_METADATA_SYMBOL_NAME})`);
}

// rustc: compiler/rustc_codegen_ssa/src/back/metadata.rs:200 create_object_file
export function create_object_file(_sess: Session): never {
  return unported("rustc_codegen_ssa::back::metadata::create_object_file (object write, M5)");
}

// rustc: compiler/rustc_codegen_ssa/src/back/metadata.rs:263 elf_os_abi
export function elf_os_abi(_sess: Session): never {
  return unported("rustc_codegen_ssa::back::metadata::elf_os_abi (object write, M5)");
}

// rustc: compiler/rustc_codegen_ssa/src/back/metadata.rs:272 elf_e_flags
export function elf_e_flags(_architecture: unknown, _sess: Session): never {
  return unported("rustc_codegen_ssa::back::metadata::elf_e_flags (object write, M5)");
}

// rustc: compiler/rustc_codegen_ssa/src/back/metadata.rs:418 macho_object_build_version_for_target
export function macho_object_build_version_for_target(_sess: Session): never {
  return unported("rustc_codegen_ssa::back::metadata::macho_object_build_version_for_target (object write, M5)");
}

// PORT: nested in `macho_object_build_version_for_target` upstream.
// rustc: compiler/rustc_codegen_ssa/src/back/metadata.rs:421 pack_version
function pack_version(_version: unknown): never {
  return unported("rustc_codegen_ssa::back::metadata::macho_object_build_version_for_target::pack_version (object write, M5)");
}
void pack_version;

/// Is Apple's CPU subtype `arm64e`s
// rustc: compiler/rustc_codegen_ssa/src/back/metadata.rs:443 macho_is_arm64e
export function macho_is_arm64e(target: Target): boolean {
  return target.llvm_target.startsWith("arm64e");
}

export type MetadataPosition = "First" | "Last";

/// For rlibs we "pack" rustc metadata into a dummy object file.
///
/// (See upstream for the per-format details.)
// rustc: compiler/rustc_codegen_ssa/src/back/metadata.rs:483 create_wrapper_file
export function create_wrapper_file(_sess: Session, _section_name: string, _data: Uint8Array): [Uint8Array, MetadataPosition] {
  return unported("rustc_codegen_ssa::back::metadata::create_wrapper_file (object write, M5)");
}

// rustc: compiler/rustc_codegen_ssa/src/back/metadata.rs:567 create_compressed_metadata_file
export function create_compressed_metadata_file(_sess: Session, _metadata: unknown, _symbol_name: string): Uint8Array {
  return unported("rustc_codegen_ssa::back::metadata::create_compressed_metadata_file (object write, M5)");
}

/// * Xcoff - On AIX, custom sections are merged into predefined sections,
///   so custom .rustc section is not preserved during linking.
// rustc: compiler/rustc_codegen_ssa/src/back/metadata.rs:628 create_compressed_metadata_file_for_xcoff
export function create_compressed_metadata_file_for_xcoff(_file: unknown, _data: Uint8Array, _symbol_name: string): Uint8Array {
  return unported("rustc_codegen_ssa::back::metadata::create_compressed_metadata_file_for_xcoff (object write, M5)");
}

/// Creates a simple WebAssembly object file, which is itself a wasm module,
/// that contains a custom section of the name `section_name` with contents
/// `data`.
// rustc: compiler/rustc_codegen_ssa/src/back/metadata.rs:693 create_metadata_file_for_wasm
export function create_metadata_file_for_wasm(_sess: Session, _data: Uint8Array, _section_name: string): Uint8Array {
  return unported("rustc_codegen_ssa::back::metadata::create_metadata_file_for_wasm (wasm-encoder, M5)");
}
