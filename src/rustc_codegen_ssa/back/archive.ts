// Port of compiler/rustc_codegen_ssa/src/back/archive.rs: `ArchiveBuilderBuilder`, `ArArchiveBuilder` (plan-m6 D4, lane
// miri-sysroot; the rest by lane ssa-archive, plan-m7 D7).
//
// PORT:
// - Windows import libraries stop by name: `create_dll_import_lib` reaches `ar_archive_writer::write_import_library`
//   (not vendored: raw-dylib on Windows targets only) and `create_mingw_dll_import_lib` runs binutils' `dlltool`
//   (windows-gnu only; src/ has no `std::process::Command` yet). `into_coff_short_export` and `find_binutils_dlltool` are
//   ported.
// - `add_archive` is ported for `link_rlib` (lane link-rlib-native): bundled native libraries.
// - `ArchiveBuilder::build`'s `symbols: Option<ArchiveSymbols>` is an optional parameter: `link.ts` callers that pass
//   `None` may leave it out. With `Some`, `build_inner` edits Rust objects through back/symbol_edit.ts.
// - Mapping the files (`Mmap`) is `readFile`, and `archive_tmpdir` is made by `TempDirBuilder` (rustc_metadata/fs.ts).
// - `io::Error::new(kind, err)` of an `object::read::Error` or a `FromUtf8Error` is a `Custom` error holding the error's
//   `Display` (all the diagnostics print); its `Debug` would differ from upstream's, and nothing prints it.
// - `OsString` and `PathBuf` are `string`s (PORTING section 5); `env::split_paths` entries are decoded lossily.
import { closeSync, openSync, readFileSync, renameSync, writeFileSync, writeSync } from "node:fs";
import { create_compressed_metadata_file, search_for_section } from "./metadata.ts";
import * as rmeta_link from "./rmeta_link.ts";
import type { RmetaLinkCache } from "./rmeta_link.ts";
import { File as FsFile, Mmap } from "../../rustc_data_structures/memmap.ts";
import { apply_edits, collect_internal_names, type Rename } from "./symbol_edit.ts";
import { is_using_dlltool } from "../common.ts";
import {
  ArchiveBuildFailure_diagnostic,
  ErrorCreatingImportLibrary_diagnostic,
  type ExtractBundledLibsError,
  IncompatibleArchiveFormat_diagnostic,
  UnknownArchiveKind_diagnostic,
} from "../diagnostics.gen.ts";
import type { EncodedMetadata } from "../../rustc_metadata/rmeta/encoder.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { Arch } from "../../rustc_target/spec/mod.ts";
import { TempDirBuilder } from "../../rustc_metadata/fs.ts";
import type { Session } from "../../rustc_session/session.ts";
import { current_dir_str, split_paths, temp_dir, to_string_lossy, var_os } from "../../std/env.ts";
import { metadata as fs_metadata } from "../../std/fs.ts";
import { assert, panic, unported } from "../../std/panic.ts";
import { debug_str } from "../../std/fmt.ts";
import { display_IoError, type ErrorKind, io_error_from_node, io_error_other, type IoError, IoError_kind, type IoResult } from "../../std/io.ts";
import { path_eq, path_file_name, path_is_absolute, path_join, path_parent } from "../../std/path.ts";
import { from_utf8 } from "../../std/str.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import type { Architecture } from "../../vendor/object/common.ts";
import { ArchiveFile, type ArchiveKind as ObjectArchiveKind } from "../../vendor/object/read/archive.ts";
import { type FatArch, FatArch_provided, MachOFatFile32, MachOFatFile64 } from "../../vendor/object/read/macho/fat.ts";
import { display_Error } from "../../vendor/object/read/mod.ts";
import type { PodSlice } from "../../vendor/object/pod.ts";
import { type ArchiveKind, ArchiveWriter, DEFAULT_OBJECT_READER, NewArchiveMember, type ObjectReader, write_archive_to_stream } from "../../vendor/ar_archive_writer/lib.ts";
import { MachineTypes } from "../../vendor/ar_archive_writer/coff.ts";
import type { COFFShortExport } from "../../vendor/ar_archive_writer/coff_import_file.ts";

export { DEFAULT_OBJECT_READER, type ObjectReader };
// Public for ArchiveBuilderBuilder::extract_bundled_libs
export type { ExtractBundledLibsError };

/// An item to be included in an import library.
/// This is a slimmed down version of `COFFShortExport` from `ar-archive-writer`.
export class ImportLibraryItem {
  constructor(
    /// The name to be exported.
    public name: string,
    /// The ordinal to be exported, if any.
    public ordinal: number | undefined,
    /// The original, decorated name if `name` is not decorated.
    public symbol_name: string | undefined,
    /// True if this is a data export, false if it is a function export.
    public is_data: boolean,
  ) {}

  // rustc: compiler/rustc_codegen_ssa/src/back/archive.rs:49 into_coff_short_export
  into_coff_short_export(sess: Session): COFFShortExport {
    const import_name = sess.target.arch.$ === "Arm64EC" ? this.name : undefined;
    return {
      name: this.name,
      ext_name: undefined,
      symbol_name: this.symbol_name,
      import_name,
      export_as: undefined,
      ordinal: this.ordinal ?? 0,
      noname: this.ordinal !== undefined,
      data: this.is_data,
      private: false,
      constant: false,
    };
  }
}

export interface ArchiveBuilderBuilder {
  // rustc: compiler/rustc_codegen_ssa/src/back/archive.rs:67 new_archive_builder
  new_archive_builder(sess: Session): ArchiveBuilder;

  // (provided) create_dylib_metadata_wrapper
  // (provided) create_dll_import_lib
  /**
   * PORT: an implementor's override of the provided `create_dll_import_lib`, such as the dummy backend's
   * (rustc_interface/util.ts). Callers use it when present, else `ArchiveBuilderBuilder_provided.create_dll_import_lib`
   * (review ssa-link-b N2).
   */
  create_dll_import_lib?(sess: Session, lib_name: string, items: ImportLibraryItem[], output_path: string): void;
  // (provided) extract_bundled_libs
}

/** The provided methods of `ArchiveBuilderBuilder` (PORTING section 8; `self` first). */
export const ArchiveBuilderBuilder_provided = {
  // rustc: compiler/rustc_codegen_ssa/src/back/archive.rs:69 create_dylib_metadata_wrapper
  create_dylib_metadata_wrapper(_self: ArchiveBuilderBuilder, sess: Session, metadata: EncodedMetadata, symbol_name: string): Uint8Array {
    return create_compressed_metadata_file(sess, metadata, symbol_name);
  },

  /// Creates a DLL Import Library <https://docs.microsoft.com/en-us/windows/win32/dlls/dynamic-link-library-creation#creating-an-import-library>.
  /// and returns the path on disk to that import library.
  /// This functions doesn't take `self` so that it can be called from
  /// `linker_with_args`, which is specialized on `ArchiveBuilder` but
  /// doesn't take or create an instance of that type.
  // rustc: compiler/rustc_codegen_ssa/src/back/archive.rs:83 create_dll_import_lib
  create_dll_import_lib(_self: ArchiveBuilderBuilder, sess: Session, lib_name: string, items: ImportLibraryItem[], output_path: string): void {
    if (is_using_dlltool(sess.target)) {
      // The binutils linker used on -windows-gnu targets cannot read the import
      // libraries generated by LLVM: in our attempts, the linker produced an .EXE
      // that loaded but crashed with an AV upon calling one of the imported
      // functions. Therefore, use binutils to create the import library instead,
      // by writing a .DEF file to the temp dir and calling binutils's dlltool.
      create_mingw_dll_import_lib(sess, lib_name, items, output_path);
    } else {
      // trace!("creating import library");
      // trace!("  dll_name {:#?}", lib_name);
      // trace!("  output_path {}", output_path.display());
      // trace!("  import names: {}", items.iter().map(|ImportLibraryItem { name, .. }| name.clone()).collect::<Vec<_>>().join(", "));

      // All import names are Rust identifiers and therefore cannot contain \0 characters.
      // FIXME: when support for #[link_name] is implemented, ensure that the import names
      // still don't contain any \0 characters. Also need to check that the names don't
      // contain substrings like " @" or "NONAME" that are keywords or otherwise reserved
      // in definition files.

      // `fs::File::create_new(&output_path)`
      let file: number;
      try {
        file = openSync(output_path, "wx", 0o666);
      } catch (e) {
        const error = io_error_from_node(e);
        return sess.dcx().emit_fatal(ErrorCreatingImportLibrary_diagnostic({ lib_name, error: display_IoError(error) }));
      }

      const exports = items.map((item) => item.into_coff_short_export(sess));
      let machine: MachineTypes;
      switch (sess.target.arch.$) {
        case "X86_64":
          machine = MachineTypes.AMD64;
          break;
        case "X86":
          machine = MachineTypes.I386;
          break;
        case "AArch64":
          machine = MachineTypes.ARM64;
          break;
        case "Arm64EC":
          machine = MachineTypes.ARM64EC;
          break;
        case "Arm":
          machine = MachineTypes.ARMNT;
          break;
        default: {
          closeSync(file);
          const cpu = sess.target.arch;
          return panic(`unsupported cpu type ${Arch.desc(cpu)}`);
        }
      }

      // PORT: `ar_archive_writer::write_import_library(&mut file, lib_name, &exports, machine, !is_like_msvc, true, &[])`
      // (coff_import_file.rs:892) is not vendored (see the header); the created file is closed first.
      void exports;
      void machine;
      closeSync(file);
      return unported("ar_archive_writer::write_import_library (COFF import libraries: raw-dylib on Windows targets)");
    }
  },

  // rustc: compiler/rustc_codegen_ssa/src/back/archive.rs:153 extract_bundled_libs
  extract_bundled_libs(
    _self: ArchiveBuilderBuilder,
    rlib: string,
    outdir: string,
    bundled_lib_file_names: ReadonlySet<Symbol>,
  ): Result<null, ExtractBundledLibsError> {
    const f = FsFile.open(rlib);
    if (f.$ === "Err") return Err({ $: "OpenFile", rlib, error: f._0 });
    const m = Mmap.map(f._0);
    if (m.$ === "Err") return Err({ $: "MmapFile", rlib, error: m._0 });
    const archive_map = m._0.deref();
    const a = ArchiveFile.parse(archive_map);
    if (a.$ === "Err") return Err({ $: "ParseArchive", rlib, error: a._0 });
    const archive = a._0;

    const members = archive.members();
    for (let entry_r = members.next(); entry_r !== undefined; entry_r = members.next()) {
      if (entry_r.$ === "Err") return Err({ $: "ReadEntry", rlib, error: entry_r._0 });
      const entry = entry_r._0;
      const data_r = entry.data(archive_map);
      if (data_r.$ === "Err") return Err({ $: "ArchiveMember", rlib, error: data_r._0 });
      const name_r = from_utf8(entry.name());
      if (name_r.$ === "Err") return Err({ $: "ConvertName", rlib, error: name_r._0 });
      const name = name_r._0;
      if (!bundled_lib_file_names.has(Symbol.intern(name))) {
        continue; // We need to extract only native libraries.
      }
      const data = search_for_section(rlib, data_r._0, ".bundled_lib");
      if (data.$ === "Err") return Err({ $: "ExtractSection", rlib, error: data._0 });
      try {
        writeFileSync(path_join(outdir, name), data._0);
      } catch (e) {
        return Err({ $: "WriteFile", rlib, error: io_error_from_node(e) });
      }
    }
    return Ok(null);
  },
};

// rustc: compiler/rustc_codegen_ssa/src/back/archive.rs:190 create_mingw_dll_import_lib
function create_mingw_dll_import_lib(_sess: Session, _lib_name: string, _items: ImportLibraryItem[], _output_path: string): void {
  // PORT: writes a .DEF file next to `output_path` and runs binutils' `dlltool` on it (windows-gnu raw-dylib); see the
  // header.
  return unported("rustc_codegen_ssa::back::archive::create_mingw_dll_import_lib (dlltool: raw-dylib on windows-gnu)");
}

// PORT: exported for archive.test.ts.
// rustc: compiler/rustc_codegen_ssa/src/back/archive.rs:277 find_binutils_dlltool
export function find_binutils_dlltool(sess: Session): string {
  assert(
    sess.target.options.is_like_windows && !sess.target.options.is_like_msvc,
    "assertion failed: sess.target.options.is_like_windows && !sess.target.options.is_like_msvc",
  );
  const dlltool_path = sess.opts.cg.dlltool;
  if (dlltool_path !== undefined) {
    return dlltool_path;
  }

  let tool_name: string;
  if (sess.host.options.is_like_windows) {
    // If we're compiling on Windows, always use "dlltool.exe".
    tool_name = "dlltool.exe";
  } else {
    // On other platforms, use the architecture-specific name.
    switch (sess.target.arch.$) {
      case "X86_64":
        tool_name = "x86_64-w64-mingw32-dlltool";
        break;
      case "X86":
        tool_name = "i686-w64-mingw32-dlltool";
        break;
      case "AArch64":
        tool_name = "aarch64-w64-mingw32-dlltool";
        break;

      // For non-standard architectures (e.g., aarch32) fallback to "dlltool".
      default:
        tool_name = "dlltool";
    }
  }

  // NOTE: it's not clear how useful it is to explicitly search PATH.
  for (const dir of split_paths(var_os("PATH") ?? new Uint8Array(0))) {
    const full_path = path_join(to_string_lossy(dir), tool_name);
    // `full_path.is_file()`: `fs::metadata(self).map(|m| m.is_file()).unwrap_or(false)`
    const md = fs_metadata(full_path);
    if (md.$ === "Ok" && md._0.is_file()) {
      return full_path;
    }
  }

  // The user didn't specify the location of the dlltool binary, and we weren't able
  // to find the appropriate one on the PATH. Just return the name of the tool
  // and let the invocation fail with a hopefully useful error message.
  return tool_name;
}

export type AddArchiveKind = { $: "Rlib"; _0: RmetaLinkCache; _1: (name: string, kind: ArchiveEntryKind) => boolean } | { $: "Other" };

export interface ArchiveSymbols {
  exported: Set<string>;
  rename_suffix: string | undefined;
  hide: boolean;
}

export interface ArchiveBuilder {
  // rustc: compiler/rustc_codegen_ssa/src/back/archive.rs:325 add_file
  add_file(path: string, kind: ArchiveEntryKind): void;

  // rustc: compiler/rustc_codegen_ssa/src/back/archive.rs:327 add_archive
  add_archive(archive: string, kind: AddArchiveKind): IoResult<null>;

  // rustc: compiler/rustc_codegen_ssa/src/back/archive.rs:329 build
  build(output: string, symbols: ArchiveSymbols | undefined): boolean;
}

// rustc: compiler/rustc_codegen_ssa/src/back/archive.rs:332 target_archive_format_to_object_kind
function target_archive_format_to_object_kind(format: string): ObjectArchiveKind | undefined {
  switch (format) {
    case "gnu":
      return "Gnu";
    case "bsd":
      return "Bsd";
    case "darwin":
      return "Bsd64";
    case "coff":
      return "Coff";
    case "aix_big":
      return "AixBig";
    default:
      return undefined;
  }
}

// rustc: compiler/rustc_codegen_ssa/src/back/archive.rs:343 archive_kinds_compatible
function archive_kinds_compatible(actual: ObjectArchiveKind, expected: ObjectArchiveKind): boolean {
  if (actual === expected) {
    return true;
  }
  return (
    // An archive without long filenames or symbol table is detected as Unknown;
    // this is compatible with any target format.
    actual === "Unknown" ||
    // 64-bit symbol table variants are compatible with their 32-bit counterparts
    (actual === "Gnu64" && expected === "Gnu") ||
    (actual === "Gnu" && expected === "Gnu64") ||
    (actual === "Bsd64" && expected === "Bsd") ||
    (actual === "Bsd" && expected === "Bsd64") ||
    // GNU and COFF archives share the same magic and member header format;
    // only the symbol table layout differs.
    (actual === "Gnu" && expected === "Coff") ||
    (actual === "Coff" && expected === "Gnu") ||
    (actual === "Gnu64" && expected === "Coff")
  );
}

// rustc: compiler/rustc_codegen_ssa/src/back/archive.rs:365 archive_kind_display_name
function archive_kind_display_name(kind: ObjectArchiveKind): string {
  switch (kind) {
    case "Gnu":
    case "Gnu64":
      return "GNU";
    case "Bsd":
      return "BSD";
    case "Bsd64":
      return "Darwin";
    case "Coff":
      return "COFF";
    case "AixBig":
      return "AIX big";
    default:
      // `format!("{kind:?}")`: the derived `Debug` of a fieldless variant is its name.
      return kind;
  }
}

/** `pub struct ArArchiveBuilderBuilder;` (the unit value). */
export const ArArchiveBuilderBuilder: ArchiveBuilderBuilder = {
  // rustc: compiler/rustc_codegen_ssa/src/back/archive.rs:379 new_archive_builder
  new_archive_builder(sess: Session): ArchiveBuilder {
    return ArArchiveBuilder.new(sess, DEFAULT_OBJECT_READER);
  },
};

export type ArchiveEntryKind =
  /// Object file produced from Rust code.
  | "RustObj"
  /// Anything else, introduce new variants as needed.
  | "Other";

// #[derive(Debug)]
type ArchiveEntrySource = { $: "Archive"; archive_index: number; file_range: [number, number] } | { $: "File"; _0: string };

interface ArchiveEntry {
  source: ArchiveEntrySource;
  kind: ArchiveEntryKind;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// PORT: `try_filter_fat_archs` and `try_extract_macho_fat_archive` (archive.rs:421, :445, after `ArArchiveBuilder::new`)
// are placed before the class, whose body holds both `impl` blocks.

// rustc: compiler/rustc_codegen_ssa/src/back/archive.rs:421 try_filter_fat_archs
function try_filter_fat_archs<F>(
  Fat: FatArch<F>,
  archs: PodSlice<F>,
  target_arch: Architecture,
  archive_path: string,
  archive_map_data: Uint8Array,
): IoResult<string | undefined> {
  let desired: F | undefined;
  for (let i = 0; i < archs.length; i++) {
    const a = archs.get(i)!;
    if (FatArch_provided.architecture(Fat, a) === target_arch) {
      desired = a;
      break;
    }
  }
  if (desired === undefined) return Ok(undefined);

  const t = tempfile_with_suffix(path_file_name(archive_path)!);
  if (t.$ === "Err") return t;
  const [new_f, extracted_path] = t._0;

  try {
    const d = FatArch_provided.data(Fat, desired, archive_map_data);
    if (d.$ === "Err") return Err(io_error_new("Other", display_Error(d._0)));
    try {
      // `write_all`
      for (let off = 0; off < d._0.length; ) off += writeSync(new_f, d._0, off);
    } catch (e) {
      return Err(io_error_from_node(e));
    }
  } finally {
    closeSync(new_f);
  }

  return Ok(extracted_path);
}

/** `tempfile::Builder::new().suffix(suffix).tempfile()?.keep().unwrap()`: a new file `.tmpXXXXXX<suffix>` in
 *  `env::temp_dir()`, created exclusively with mode 0o600 and kept (never removed). Returns the open fd and the path.
 *  As tempfile 3.23.0 does (`Builder::tempfile_in`, src/util.rs `create_helper`, src/file/mod.rs `create_named`): no
 *  `override_temp_dir` is set, so the base is std's `env::temp_dir()`; a relative base (an empty `TMPDIR`, say) is joined to
 *  `env::current_dir()?`; `AlreadyExists` and `AddrInUse` retry, up to `NUM_RETRIES` (65,536) names; a failed create's error
 *  is wrapped by `with_err_path` (src/error.rs: `"{err} at path {path:?}"`, the same kind), as the final "too many temporary
 *  files exist" is with the base.
 *  PORT: tempfile's random names (`fastrand`, reseeded at the 4th try) are not reproduced; the name is not in any output but a
 *  diagnostic's path. `PathBuf` is a `string` here, so a non-UTF-8 `TMPDIR` is decoded lossily. */
// PORT: exported for archive.test.ts (fixers-50).
// PORT: one function for the tempfile 3.23.0 call chain `Builder::tempfile` -> `env::temp_dir` (no override) -> `tempfile_in` ->
// `util::create_helper` -> `file::create_named` -> `imp::create_named` (unix), with the builder's fixed fields (`prefix` ".tmp",
// `random_len` 6, the given `suffix`, no `append`, no `permissions`) folded in. `util::tmpname` is not ported (the names above).
// crate: tempfile-3.23.0/src/lib.rs:533 tempfile
// crate: tempfile-3.23.0/src/env.rs:45 temp_dir
// crate: tempfile-3.23.0/src/lib.rs:562 tempfile_in
// crate: tempfile-3.23.0/src/util.rs:22 create_helper
// crate: tempfile-3.23.0/src/file/mod.rs:1063 create_named
// crate: tempfile-3.23.0/src/file/imp/unix.rs:14 create_named
export function tempfile_with_suffix(suffix: string): IoResult<[number, string]> {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let base = to_string_lossy(temp_dir());
  // Make the path absolute. Otherwise, changing the current directory can invalidate a stored
  // path (causing issues when cleaning up temporary files.
  if (!path_is_absolute(base)) {
    const cur_dir = current_dir_str();
    if (cur_dir.$ === "Err") return cur_dir;
    base = path_join(cur_dir._0, base);
  }
  const NUM_RETRIES = 65536;
  for (let i = 0; i < NUM_RETRIES; i++) {
    let name = ".tmp";
    for (let j = 0; j < 6; j++) name += chars[Math.floor(Math.random() * chars.length)];
    const path = path_join(base, name + suffix);
    let e: IoError;
    try {
      // `open_options.read(true).write(true).create_new(true)`, `mode(0o600)` (fixers-48 review O2: read and write).
      return Ok([openSync(path, "wx+", 0o600), path]);
    } catch (err) {
      e = io_error_from_node(err);
    }
    const kind = IoError_kind(e);
    if (kind === "AlreadyExists" || kind === "AddrInUse") continue;
    return Err(with_err_path(e, path));
  }
  return Err(with_err_path(io_error_new("AlreadyExists", "too many temporary files exist"), base));
}

/** tempfile 3.23.0 src/error.rs `IoResultExt::with_err_path`: `io::Error::new(e.kind(), PathError { path, err: e })`. */
// crate: tempfile-3.23.0/src/error.rs:30 with_err_path
function with_err_path(e: IoError, path: string): IoError {
  return io_error_new(IoError_kind(e), `${display_IoError(e)} at path ${debug_str(path)}`);
}

// rustc: compiler/rustc_codegen_ssa/src/back/archive.rs:445 try_extract_macho_fat_archive
export function try_extract_macho_fat_archive(sess: Session, archive_path: string): IoResult<string | undefined> {
  const f = FsFile.open(archive_path);
  if (f.$ === "Err") return f;
  const m = Mmap.map(f._0);
  if (m.$ === "Err") return m;
  const archive_map = m._0.deref();
  let target_arch: Architecture;
  switch (sess.target.arch.$) {
    case "AArch64":
      target_arch = "Aarch64";
      break;
    case "X86_64":
      target_arch = "X86_64";
      break;
    default:
      return Ok(undefined);
  }

  const h32 = MachOFatFile32.parse(archive_map);
  if (h32.$ === "Ok") {
    const archs = h32._0.arches();
    return try_filter_fat_archs(h32._0.Fat, archs, target_arch, archive_path, archive_map);
  } else {
    const h64 = MachOFatFile64.parse(archive_map);
    if (h64.$ === "Ok") {
      const archs = h64._0.arches();
      return try_filter_fat_archs(h64._0.Fat, archs, target_arch, archive_path, archive_map);
    } else {
      // Not a FatHeader at all, just return None.
      return Ok(undefined);
    }
  }
}

// #[must_use = "must call build() to finish building the archive"]
export class ArArchiveBuilder implements ArchiveBuilder {
  /** `Vec<(PathBuf, Mmap)>`: the mapping is its bytes. */
  private src_archives: [string, Uint8Array][] = [];
  // Don't use an `HashMap` here, as the order is important. `lib.rmeta` needs
  // to be at the end of an archive in some cases for linkers to not get confused.
  private entries: [Uint8Array, ArchiveEntry][] = [];

  constructor(
    private sess: Session,
    private object_reader: ObjectReader,
  ) {}

  // rustc: compiler/rustc_codegen_ssa/src/back/archive.rs:416 new
  static new(sess: Session, object_reader: ObjectReader): ArArchiveBuilder {
    return new ArArchiveBuilder(sess, object_reader);
  }

  // impl ArchiveBuilder for ArArchiveBuilder
  // rustc: compiler/rustc_codegen_ssa/src/back/archive.rs:469 add_archive
  add_archive(archive_path_: string, ar_kind: AddArchiveKind): IoResult<null> {
    let archive_path = archive_path_;
    if (this.sess.target.llvm_target.includes("-apple-macosx")) {
      const r = try_extract_macho_fat_archive(this.sess, archive_path);
      if (r.$ === "Err") return r;
      const new_archive_path = r._0;
      if (new_archive_path !== undefined) {
        archive_path = new_archive_path;
      }
    }

    if (this.src_archives.some((archive) => path_eq(archive[0], archive_path))) {
      return Ok(null);
    }

    const f = FsFile.open(archive_path);
    if (f.$ === "Err") return f;
    const m = Mmap.map(f._0);
    if (m.$ === "Err") return m;
    const archive_map = m._0.deref();
    const a = ArchiveFile.parse(archive_map);
    if (a.$ === "Err") return Err(io_error_new("InvalidData", display_Error(a._0)));
    const archive = a._0;
    const skip = ar_kind.$ === "Rlib" ? ar_kind._1 : undefined;
    const metadata_link = ar_kind.$ === "Rlib" ? ar_kind._0.get_or_insert_with(archive_path, () => rmeta_link.read(archive, archive_map, archive_path)) : undefined;
    const archive_index = this.src_archives.length;

    const expected_kind = target_archive_format_to_object_kind(this.sess.target.options.archive_format);
    if (expected_kind !== undefined) {
      const actual_kind = archive.kind();
      if (!archive_kinds_compatible(actual_kind, expected_kind)) {
        this.sess.dcx().emit_warn(
          IncompatibleArchiveFormat_diagnostic({
            path: archive_path,
            actual: archive_kind_display_name(actual_kind),
            expected: archive_kind_display_name(expected_kind),
          }),
        );
      }
    }

    const members = archive.members();
    for (let entry_r = members.next(); entry_r !== undefined; entry_r = members.next()) {
      if (entry_r.$ === "Err") return Err(io_error_new("InvalidData", display_Error(entry_r._0)));
      const entry = entry_r._0;
      const name_r = from_utf8(entry.name());
      if (name_r.$ === "Err") return Err(io_error_new("InvalidData", name_r._0.toString()));
      const file_name = name_r._0;
      const kind: ArchiveEntryKind = metadata_link !== undefined && metadata_link.rust_object_files.some((f) => f === file_name) ? "RustObj" : "Other";
      const drop = skip !== undefined ? skip(file_name, kind) : false;
      if (!drop) {
        let source: ArchiveEntrySource;
        if (entry.is_thin()) {
          const member_path = path_join(path_parent(archive_path)!, file_name);
          source = { $: "File", _0: member_path };
        } else {
          source = { $: "Archive", archive_index, file_range: entry.file_range() };
        }
        this.entries.push([encoder.encode(file_name), { source, kind }]);
      }
    }

    this.src_archives.push([archive_path, archive_map]);
    return Ok(null);
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/archive.rs:545 add_file
  add_file(file: string, kind: ArchiveEntryKind): void {
    this.entries.push([encoder.encode(path_file_name(file)!), { source: { $: "File", _0: file }, kind }]);
  }

  /// Combine the provided files, rlibs, and native libraries into a single
  /// `Archive`.
  // rustc: compiler/rustc_codegen_ssa/src/back/archive.rs:554 build
  build(output: string, symbols: ArchiveSymbols | undefined): boolean {
    const sess = this.sess;
    const r = this.build_inner(output, symbols);
    if (r.$ === "Ok") {
      return r._0;
    } else {
      return sess.dcx().emit_fatal(ArchiveBuildFailure_diagnostic({ path: output, error: r._0 }));
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/archive.rs:566 build_inner
  build_inner(output: string, symbols: ArchiveSymbols | undefined): IoResult<boolean> {
    let archive_kind: ArchiveKind;
    switch (this.sess.target.options.archive_format) {
      case "gnu":
        archive_kind = "Gnu";
        break;
      case "bsd":
        archive_kind = "Bsd";
        break;
      case "darwin":
        archive_kind = "Darwin";
        break;
      case "coff":
        archive_kind = "Coff";
        break;
      case "aix_big":
        archive_kind = "AixBig";
        break;
      default: {
        const kind = this.sess.target.options.archive_format;
        return this.sess.dcx().emit_fatal(UnknownArchiveKind_diagnostic({ kind }));
      }
    }

    // Collect all internally-defined symbol names across every Rust object file.
    // This set is needed because rename must also apply to *undefined* references
    // (cross-object calls within the staticlib), but we cannot use `!exported.contains(name)`
    // alone — that would also match external C symbols like `malloc` which must not be renamed.
    let rename: Rename;
    if (symbols !== undefined && symbols.rename_suffix !== undefined) {
      const sym = symbols;
      const rename_suffix = symbols.rename_suffix;
      const names = new Set<string>();
      for (const [, entry] of this.entries) {
        if (entry.kind !== "RustObj") {
          continue;
        }
        switch (entry.source.$) {
          case "Archive": {
            const { archive_index, file_range } = entry.source;
            const src_archive = this.src_archives[archive_index]!;
            const start = file_range[0];
            const end = start + file_range[1];
            // `src_archive.1.get(start..end)`
            if (end <= src_archive[1].length) {
              collect_internal_names(src_archive[1].subarray(start, end), sym.exported, names);
            }
            break;
          }
          case "File": {
            const file = entry.source._0;
            // `if let Ok(data) = fs::read(file)`
            let data: Uint8Array | undefined;
            try {
              data = readFileSync(file);
            } catch (e) {
              if (!(e instanceof Error && "code" in e)) throw e;
              data = undefined;
            }
            if (data !== undefined) {
              collect_internal_names(data, sym.exported, names);
            }
            break;
          }
        }
      }
      rename = [names, rename_suffix];
    } else {
      rename = undefined;
    }

    const entries: NewArchiveMember[] = [];

    for (const [entry_name, entry] of this.entries) {
      let data: Uint8Array;
      switch (entry.source.$) {
        case "Archive": {
          const { archive_index, file_range } = entry.source;
          const src_archive = this.src_archives[archive_index]!;
          const archive_data = src_archive[1];
          const start = file_range[0];
          const end = start + file_range[1];
          // `archive_data.get(start..end)`
          if (end > archive_data.length) {
            return Err(
              io_error_context(
                "invalid archive member",
                io_error_new(
                  "InvalidData",
                  `archive member of ${src_archive[0]} at offset ${start} with size ${file_range[1]} exceeds archive size ${archive_data.length} in \`${src_archive[0]}\``,
                ),
              ),
            );
          }
          const member = archive_data.subarray(start, end);

          if (entry.kind === "RustObj" && symbols !== undefined) {
            data = apply_edits(member, symbols.exported, symbols.hide, rename);
          } else {
            data = member;
          }
          break;
        }
        case "File": {
          const file = entry.source._0;
          const f = FsFile.open(file);
          if (f.$ === "Err") return Err(io_error_context(`failed to open object file ${file}`, f._0));
          const mmap = Mmap.map(f._0);
          if (mmap.$ === "Err") return Err(io_error_context(`failed to map object file ${file}`, mmap._0));
          if (entry.kind === "RustObj" && symbols !== undefined) {
            // `Cow::Borrowed(_) => mmap`, `Cow::Owned(v) => v`: either way the edited bytes.
            data = apply_edits(mmap._0.deref(), symbols.exported, symbols.hide, rename);
          } else {
            data = mmap._0.deref();
          }
          break;
        }
      }

      entries.push(new NewArchiveMember(data, this.object_reader, decoder.decode(entry_name), 0, 0, 0, 0o644));
    }

    // Write to a temporary file first before atomically renaming to the final name.
    // This prevents programs (including rustc) from attempting to read a partial archive.
    // It also enables writing an archive with the same filename as a dependency on Windows as
    // required by a test.
    // The tempfile crate currently uses 0o600 as mode for the temporary files and directories
    // it creates. We need it to be the default mode for back compat reasons however. (See
    // #107495) To handle this we are telling tempfile to create a temporary directory instead
    // and then inside this directory create a file using File::create.
    const archive_tmpdir_r = TempDirBuilder.new()
      .suffix(".temp-archive")
      .tempdir_in(path_parent(output) ?? "");
    if (archive_tmpdir_r.$ === "Err") return Err(io_error_context("couldn't create a directory for the temp file", archive_tmpdir_r._0));
    const archive_tmpdir = archive_tmpdir_r._0;
    const archive_tmpfile_path = path_join(archive_tmpdir.path(), "tmp.a");
    let fd: number;
    try {
      fd = openSync(archive_tmpfile_path, "wx", 0o666);
    } catch (e) {
      archive_tmpdir.drop();
      return Err(io_error_context("couldn't create the temp file", io_error_from_node(e)));
    }

    // PORT: `BufWriter<File>` is `ArchiveWriter`; its bytes go to the file at `flush`.
    const w = new ArchiveWriter();
    try {
      const r = write_archive_to_stream(w, entries, archive_kind, false, /* is_ec = */ this.sess.target.arch.$ === "Arm64EC");
      if (r.$ === "Err") {
        archive_tmpdir.drop();
        return r;
      }
      writeSync(fd, w.bytes());
    } catch (e) {
      archive_tmpdir.drop();
      if (e instanceof Error && "code" in e) return Err(io_error_from_node(e));
      throw e;
    } finally {
      closeSync(fd);
    }

    const any_entries = entries.length !== 0;
    // Drop src_archives to unmap all input archives, which is necessary if we want to write the
    // output archive to the same location as an input archive on Windows.

    try {
      renameSync(archive_tmpfile_path, output);
    } catch (e) {
      archive_tmpdir.drop();
      return Err(io_error_context("failed to rename archive file", io_error_from_node(e)));
    }
    const closed = archive_tmpdir.close();
    if (closed.$ === "Err") return Err(io_error_context("failed to remove temporary directory", closed._0));

    return Ok(any_entries);
  }
}

// rustc: compiler/rustc_codegen_ssa/src/back/archive.rs:728 io_error_context
function io_error_context(context: string, err: IoError): IoError {
  return io_error_other(`${context}: ${display_IoError(err)}`);
}

/** `io::Error::new(kind, error)` of an error whose `Display` is `error` (see the header). */
function io_error_new(kind: ErrorKind, error: string): IoError {
  return { $: "Custom", kind, error };
}
