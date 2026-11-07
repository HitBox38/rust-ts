// Port of compiler/rustc_codegen_ssa/src/back/metadata.rs.
//
//! Reading of the rustc metadata for rlibs and dylibs
//
// PORT: the read half (`DefaultMetadataLoader`, `load_metadata_with`, `search_for_section`,
// `get_metadata_xcoff`) is ported; of the write half, wrapper files for ELF and Mach-O targets (lanes miri-sysroot,
// object-write-macho; vendor `object::write`): `create_object_file`, `add_gnu_property_note`, `create_wrapper_file` stop
// `unported` on COFF and XCOFF, and so does
// `elf_e_flags` on the architectures with non-zero flags. Compressed metadata files stay `unported` (dylibs, M7). `&Path` is a `string` (`path.display()` is the string itself);
// `OwnedSlice` is a `Uint8Array` view into the mapped file (owned_slice.ts).
// PORT: `rustc_metadata::fs::METADATA_FILENAME` is copied here (fs.rs is the locator lane's).
// `debug!` tracing calls are kept as comments.

import { File as FsFile, Mmap } from "../../rustc_data_structures/memmap.ts";
import { type OwnedSlice, try_slice_owned } from "../../rustc_data_structures/owned_slice.ts";
import type { MetadataLoader } from "../../rustc_metadata/creader.ts";
import type { Session } from "../../rustc_session/session.ts";
import type { Target } from "../../rustc_target/spec/mod.ts";
import { display_IoError } from "../../std/io.ts";
import { panic, unported } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { type Architecture, type BinaryFormat, SectionKind } from "../../vendor/object/common.ts";
import * as elf from "../../vendor/object/elf.ts";
import type { Endianness } from "../../vendor/object/endian.ts";
import * as macho from "../../vendor/object/macho.ts";
import { MachOBuildVersion, Object as WriteObject, set_macho_build_version, set_macho_cpu_subtype } from "../../vendor/object/write/mod.ts";
import * as apple from "./apple.ts";
import { ArchiveFile } from "../../vendor/object/read/archive.ts";
import { File } from "../../vendor/object/read/any.ts";
import { display_Error } from "../../vendor/object/read/mod.ts";
import { Object_provided } from "../../vendor/object/read/traits.ts";

/** `rustc_metadata::fs::METADATA_FILENAME` (compiler/rustc_metadata/src/fs.rs:20). */
const METADATA_FILENAME = "lib.rmeta";

const utf8 = new TextEncoder();
/** `object::pe::IMAGE_SCN_LNK_REMOVE`. */
const pe_IMAGE_SCN_LNK_REMOVE = 0x0000_0800;

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
function add_gnu_property_note(file: WriteObject, architecture: Architecture, endianness: Endianness): void {
  // Only X86_64 and Aarch64 require a GNU property note.
  if (!(architecture === "X86_64" || architecture === "Aarch64")) {
    return;
  }

  const section = file.add_section(file.segment_name("Data"), utf8.encode(".note.gnu.property"), SectionKind.Note);
  const data: number[] = [];
  const push_u32 = (v: number): void => {
    const b = [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
    switch (endianness) {
      case "Little":
        data.push(...b);
        break;
      case "Big":
        data.push(...b.reverse());
        break;
    }
  };
  const n_namsz = 4; // Size of the n_name field
  const n_descsz = 16; // Size of the n_desc field
  const n_type = elf.NT_GNU_PROPERTY_TYPE_0; // Type of note descriptor
  for (const v of [n_namsz, n_descsz, n_type]) push_u32(v);
  data.push(...utf8.encode("GNU\0")); // Owner of the program property note
  let pr_type: number;
  switch (architecture) {
    case "X86_64":
      pr_type = elf.GNU_PROPERTY_X86_FEATURE_1_AND;
      break;
    case "Aarch64":
      pr_type = elf.GNU_PROPERTY_AARCH64_FEATURE_1_AND;
      break;
  }
  const pr_datasz = 4; //size of the pr_data field
  const pr_data = 3; //program property descriptor
  const pr_padding = 0;
  for (const v of [pr_type!, pr_datasz, pr_data, pr_padding]) push_u32(v);
  file.append_section_data(section, Uint8Array.from(data), 8);
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
export function create_object_file(sess: Session): WriteObject | undefined {
  let endianness: Endianness;
  switch (sess.target.options.endian) {
    case "Little":
      endianness = "Little";
      break;
    case "Big":
      endianness = "Big";
      break;
  }
  const arch = sess.target.object_architecture(sess.internal_target_features);
  if (arch === undefined) {
    return undefined;
  }
  const [architecture, sub_architecture] = arch;
  // PORT: `sess.target.binary_format.to_object()`: `BinaryFormat` here is that enum's own spellings (spec/mod.ts `to_object`), and a
  // value import of spec/mod.ts would change the load order of its module cycle for whatever loads this file first.
  const binary_format: BinaryFormat = sess.target.options.binary_format;

  const file = new WriteObject(binary_format, architecture, endianness!);
  file.set_sub_architecture(sub_architecture);
  if (sess.target.options.is_like_darwin) {
    if (macho_is_arm64e(sess.target)) {
      set_macho_cpu_subtype(file, (macho.CPU_SUBTYPE_ARM64E | macho.CPU_SUBTYPE_PTRAUTH_ABI) >>> 0);
    }

    set_macho_build_version(file, macho_object_build_version_for_target(sess));
  }
  if (binary_format === "Coff") {
    return unported("rustc_codegen_ssa::back::metadata::create_object_file (COFF object files)");
  }
  if (binary_format === "Elf") {
    const e_flags = elf_e_flags(architecture, sess);
    // adapted from LLVM's `MCELFObjectTargetWriter::getOSABI`
    const os_abi = elf_os_abi(sess);
    const abi_version = 0;
    add_gnu_property_note(file, architecture, endianness!);
    file.flags = { $: "Elf", os_abi, abi_version, e_flags };
  }
  return file;
}

// rustc: compiler/rustc_codegen_ssa/src/back/metadata.rs:263 elf_os_abi
export function elf_os_abi(sess: Session): number {
  const os = sess.target.options.os;
  switch (os.$) {
    case "Hermit":
      return elf.ELFOSABI_STANDALONE;
    case "FreeBsd":
      return elf.ELFOSABI_FREEBSD;
    case "Solaris":
      return elf.ELFOSABI_SOLARIS;
    default:
      return elf.ELFOSABI_NONE;
  }
}

// rustc: compiler/rustc_codegen_ssa/src/back/metadata.rs:272 elf_e_flags
export function elf_e_flags(architecture: Architecture, _sess: Session): number {
  switch (architecture) {
    case "Mips":
    case "Mips64":
    case "Mips64_N32":
    case "Riscv32":
    case "Riscv64":
    case "LoongArch32":
    case "LoongArch64":
    case "Avr":
    case "Csky":
    case "PowerPc64":
    case "Sparc32Plus":
      // PORT: these arms read the target's CPU, ABI and features (no target in the port's suites needs them yet).
      return unported(`rustc_codegen_ssa::back::metadata::elf_e_flags (${architecture})`);
    default:
      return 0;
  }
}

/// Mach-O files contain information about:
/// - The platform/OS they were built for (macOS/watchOS/Mac Catalyst/iOS simulator etc).
/// - The minimum OS version / deployment target.
/// - The version of the SDK they were targetting.
///
/// In the past, this was accomplished using the LC_VERSION_MIN_MACOSX, LC_VERSION_MIN_IPHONEOS,
/// LC_VERSION_MIN_TVOS or LC_VERSION_MIN_WATCHOS load commands, which each contain information
/// about the deployment target and SDK version, and implicitly, by their presence, which OS they
/// target. Simulator targets were determined if the architecture was x86_64, but there was e.g. a
/// LC_VERSION_MIN_IPHONEOS present.
///
/// This is of course brittle and limited, so modern tooling emit the LC_BUILD_VERSION load
/// command (which contains all three pieces of information in one) when the deployment target is
/// high enough, or the target is something that wouldn't be encodable with the old load commands
/// (such as Mac Catalyst, or Aarch64 iOS simulator).
///
/// Since Xcode 15, Apple's LD apparently requires object files to use this load command, so this
/// returns the `MachOBuildVersion` for the target to do so.
// rustc: compiler/rustc_codegen_ssa/src/back/metadata.rs:418 macho_object_build_version_for_target
export function macho_object_build_version_for_target(sess: Session): MachOBuildVersion {
  const platform = apple.macho_platform(sess.target);
  const min_os = sess.apple_deployment_target();

  const build_version = MachOBuildVersion.default();
  build_version.platform = platform;
  build_version.minos = pack_version(min_os);
  // The version here does not _really_ matter, since it is only used at runtime, and we specify
  // it when linking the final binary, so we will omit the version. This is also what LLVM does,
  // and the tooling also allows this (and shows the SDK version as `n/a`). Finally, it is the
  // semantically correct choice, as the SDK has not influenced the binary generated by rustc at
  // this point in time.
  build_version.sdk = 0;

  return build_version;
}

/// The `object` crate demands "X.Y.Z encoded in nibbles as xxxx.yy.zz"
/// e.g. minOS 14.0 = 0x000E0000, or SDK 16.2 = 0x00100200
// PORT: nested in `macho_object_build_version_for_target` upstream.
// rustc: compiler/rustc_codegen_ssa/src/back/metadata.rs:421 pack_version
function pack_version({ major, minor, patch }: apple.OSVersion): number {
  return ((major << 16) | (minor << 8) | patch) >>> 0;
}

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
export function create_wrapper_file(sess: Session, section_name: string, data: Uint8Array): [Uint8Array, MetadataPosition] {
  const file = create_object_file(sess);
  if (file === undefined) {
    if (sess.target.options.is_like_wasm) {
      return [create_metadata_file_for_wasm(sess, data, section_name), "First"];
    }

    // Targets using this branch don't have support implemented here yet or
    // they're not yet implemented in the `object` crate and will likely
    // fill out this module over time.
    return [data.slice(), "Last"];
  }
  if (file.format() === "Xcoff") {
    return unported("rustc_codegen_ssa::back::metadata::create_wrapper_file (XCOFF object files)");
  }
  const section = file.add_section(file.segment_name("Debug"), utf8.encode(section_name), SectionKind.Debug);
  switch (file.format()) {
    case "Coff":
      file.section_mut(section).flags = { $: "Coff", characteristics: pe_IMAGE_SCN_LNK_REMOVE };
      break;
    case "Elf":
      file.section_mut(section).flags = { $: "Elf", sh_flags: elf.SHF_EXCLUDE };
      break;
    default:
      break;
  }
  file.append_section_data(section, data, 1);
  const out = file.write();
  if (out.$ === "Err") return panic(`called \`Result::unwrap()\` on an \`Err\` value: Error(${JSON.stringify(out._0._0)})`);
  return [out._0, "First"];
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
