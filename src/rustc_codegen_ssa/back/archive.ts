// Partial port of compiler/rustc_codegen_ssa/src/back/archive.rs: `ArchiveBuilderBuilder`, `ArArchiveBuilder` (plan-m6 D4,
// lane miri-sysroot).
//
// PORT:
// - Windows import libraries (`ImportLibraryItem`, `create_dll_import_lib` and its dlltool helpers) and the rest of the provided
//   methods of `ArchiveBuilderBuilder` are not ported: only `link_staticlib` and `link_natively` (unported, M7) reach them.
// - `add_archive` stops `unported`: only a bundled static native library or a staticlib reaches it, and the crates this
//   lane builds have none (M7, chained lane).
// - `ArchiveSymbols` (`symbols: Option<..>`) is always `None`: only `link_staticlib` passes one, so `build` takes no such
//   parameter, and `apply_edits` / `collect_internal_names` (back/symbol_edit.rs) are not reached.
// - Mapping the files (`Mmap`) is `readFile`, and `archive_tmpdir` is made by `TempDirBuilder` (rustc_metadata/fs.ts).
import { closeSync, openSync, renameSync, writeSync } from "node:fs";
import { RmetaLinkCache } from "./rmeta_link.ts";
import { File as FsFile, Mmap } from "../../rustc_data_structures/memmap.ts";
import { ArchiveBuildFailure_diagnostic, UnknownArchiveKind_diagnostic } from "../diagnostics.gen.ts";
import { TempDirBuilder } from "../../rustc_metadata/fs.ts";
import type { Session } from "../../rustc_session/session.ts";
import { display_IoError, io_error_from_node, io_error_other, type IoError, type IoResult } from "../../std/io.ts";
import { path_file_name, path_join, path_parent } from "../../std/path.ts";
import { unported } from "../../std/panic.ts";
import { Err, Ok } from "../../std/result.ts";
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
// enum ArchiveEntrySource: `Archive` is only made by `add_archive`, which is not ported.
type ArchiveEntrySource = { $: "File"; _0: string };

interface ArchiveEntry {
  source: ArchiveEntrySource;
  kind: ArchiveEntryKind;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// #[must_use = "must call build() to finish building the archive"]
export class ArArchiveBuilder implements ArchiveBuilder {
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
  // not ported (no marker; archive.rs:469 add_archive): see the header.
  add_archive(archive_path: string, _ar_kind: AddArchiveKind): IoResult<null> {
    return unported(`rustc_codegen_ssa::back::archive::ArArchiveBuilder::add_archive (${archive_path}; a bundled native library)`);
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
      const file = entry.source._0;
      const f = FsFile.open(file);
      if (f.$ === "Err") return Err(io_error_context(`failed to open object file ${file}`, f._0));
      const mmap = Mmap.map(f._0);
      if (mmap.$ === "Err") return Err(io_error_context(`failed to map object file ${file}`, mmap._0));
      const data = mmap._0.deref();

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
