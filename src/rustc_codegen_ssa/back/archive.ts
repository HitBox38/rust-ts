// Partial port of compiler/rustc_codegen_ssa/src/back/archive.rs: `ArchiveBuilderBuilder`, `ArArchiveBuilder` (plan-m6 D4,
// lane miri-sysroot).
//
// PORT:
// - Windows import libraries (`ImportLibraryItem`, `create_dll_import_lib` and its dlltool helpers) and the rest of the provided
//   methods of `ArchiveBuilderBuilder` are not ported: only `link_staticlib` and `link_natively` (unported, M7) reach them.
// - `add_archive` is ported for `link_rlib` (lane link-rlib-native): bundled native libraries.
// - `ArchiveSymbols` (`symbols: Option<..>`) is always `None`: only `link_staticlib` passes one, so `build` takes no such
//   parameter, and `apply_edits` / `collect_internal_names` (back/symbol_edit.rs) are not reached.
// - Mapping the files (`Mmap`) is `readFile`, and `archive_tmpdir` is made by `TempDirBuilder` (rustc_metadata/fs.ts).
// - `io::Error::new(kind, err)` of an `object::read::Error` or a `FromUtf8Error` is a `Custom` error holding the error's
//   `Display` (all the diagnostics print); its `Debug` would differ from upstream's, and nothing prints it.
import { closeSync, openSync, renameSync, writeSync } from "node:fs";
import * as rmeta_link from "./rmeta_link.ts";
import type { RmetaLinkCache } from "./rmeta_link.ts";
import { File as FsFile, Mmap } from "../../rustc_data_structures/memmap.ts";
import { ArchiveBuildFailure_diagnostic, IncompatibleArchiveFormat_diagnostic, UnknownArchiveKind_diagnostic } from "../diagnostics.gen.ts";
import { TempDirBuilder } from "../../rustc_metadata/fs.ts";
import type { Session } from "../../rustc_session/session.ts";
import { current_dir_str, temp_dir, to_string_lossy } from "../../std/env.ts";
import { debug_str } from "../../std/fmt.ts";
import { display_IoError, type ErrorKind, io_error_from_node, io_error_other, type IoError, IoError_kind, type IoResult } from "../../std/io.ts";
import { path_eq, path_file_name, path_is_absolute, path_join, path_parent } from "../../std/path.ts";
import { from_utf8 } from "../../std/str.ts";
import { Err, Ok } from "../../std/result.ts";
import type { Architecture } from "../../vendor/object/common.ts";
import { ArchiveFile, type ArchiveKind as ObjectArchiveKind } from "../../vendor/object/read/archive.ts";
import { type FatArch, FatArch_provided, MachOFatFile32, MachOFatFile64 } from "../../vendor/object/read/macho/fat.ts";
import { display_Error } from "../../vendor/object/read/mod.ts";
import type { PodSlice } from "../../vendor/object/pod.ts";
import { type ArchiveKind, ArchiveWriter, DEFAULT_OBJECT_READER, NewArchiveMember, type ObjectReader, write_archive_to_stream } from "../../vendor/ar_archive_writer/lib.ts";

export interface ArchiveBuilderBuilder {
  new_archive_builder(sess: Session): ArchiveBuilder;
}

export type AddArchiveKind = { $: "Rlib"; _0: RmetaLinkCache; _1: (name: string, kind: ArchiveEntryKind) => boolean } | { $: "Other" };

export interface ArchiveBuilder {
  add_file(path: string, kind: ArchiveEntryKind): void;

  add_archive(archive: string, kind: AddArchiveKind): IoResult<null>;

  build(output: string): boolean;
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
// PORT: one function for the tempfile 3.23.0 call chain `Builder::tempfile` -> `env::temp_dir` (no override) -> `tempfile_in` ->
// `util::create_helper` -> `file::create_named` -> `imp::create_named` (unix), with the builder's fixed fields (`prefix` ".tmp",
// `random_len` 6, the given `suffix`, no `append`, no `permissions`) folded in. `util::tmpname` is not ported (the names above).
// crate: tempfile-3.23.0/src/lib.rs:533 tempfile
// crate: tempfile-3.23.0/src/env.rs:45 temp_dir
// crate: tempfile-3.23.0/src/lib.rs:562 tempfile_in
// crate: tempfile-3.23.0/src/util.rs:22 create_helper
// crate: tempfile-3.23.0/src/file/mod.rs:1063 create_named
// crate: tempfile-3.23.0/src/file/imp/unix.rs:14 create_named
function tempfile_with_suffix(suffix: string): IoResult<[number, string]> {
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
      return Ok([openSync(path, "wx", 0o600), path]);
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
  build(output: string): boolean {
    const sess = this.sess;
    const r = this.build_inner(output);
    if (r.$ === "Ok") {
      return r._0;
    } else {
      return sess.dcx().emit_fatal(ArchiveBuildFailure_diagnostic({ path: output, error: r._0 }));
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/archive.rs:566 build_inner
  build_inner(output: string): IoResult<boolean> {
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
    // PORT: `rename` is `None`: `symbols` is `None` (see the header).

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
          data = archive_data.subarray(start, end);

          // PORT: `symbols` is `None` (see the header), so no `apply_edits`.
          break;
        }
        case "File": {
          const file = entry.source._0;
          const f = FsFile.open(file);
          if (f.$ === "Err") return Err(io_error_context(`failed to open object file ${file}`, f._0));
          const mmap = Mmap.map(f._0);
          if (mmap.$ === "Err") return Err(io_error_context(`failed to map object file ${file}`, mmap._0));
          data = mmap._0.deref();
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
