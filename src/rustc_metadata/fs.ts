// Port of compiler/rustc_metadata/src/fs.rs.
//
// PORT:
// - `rustc_fs_util::TempDirBuilder` (over the `tempfile` crate's `Builder`/`TempDir`) and
//   `rustc_data_structures::temp_dir::MaybeTempDir` are not ported; `TempDirBuilder`, `TempDir` and `MaybeTempDir`
//   below are local stand-ins with the upstream API this file uses. `tempdir_in` makes `<dir>/<prefix>XXXXXX` (six
//   random characters, mode 0o700 on unix: node's `mkdtempSync`, as `tempfile::Builder` names and creates it), and
//   dropping a `TempDir` removes it recursively, ignoring errors (tempfile's `Drop`). Move them to their crates when
//   those are ported.
// - Drops are explicit. In `encode_and_write_metadata` an unwinding exit (a fatal error, an ICE or an `unported`
//   stop) drops the `MaybeTempDir` before it reaches `EncodedMetadata` (so the temp dir is removed unless
//   `-C save-temps`), as Rust's unwinding drop does. Then the dir moves into `EncodedMetadata::from_path`, which
//   drops it on an empty file or its own error and otherwise keeps it in the `EncodedMetadata` (whose `drop()` the
//   driver calls when `Linker::link` ends).
import { closeSync, mkdtempSync, openSync, readSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { OutFileName, type OutputFilenames } from "../rustc_session/config.ts";
import { filename_for_metadata } from "../rustc_session/output.ts";
import type { Session } from "../rustc_session/session.ts";
import type { ErrorGuaranteed } from "../rustc_span/lib.ts";
import { io_error_from_node, type IoResult, stdout_write_all } from "../std/io.ts";
import { path_is_absolute, path_join } from "../std/path.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import {
  BinaryOutputToTty_diagnostic,
  FailedCopyToStdout_diagnostic,
  FailedCreateEncodedMetadata_diagnostic,
  FailedCreateFile_diagnostic,
  FailedCreateTempdir_diagnostic,
  FailedWriteError_diagnostic,
} from "./diagnostics.ts";
import { EncodedMetadata, encode_metadata } from "./rmeta/encoder.ts";

// FIXME(eddyb) maybe include the crate name in this?
export const METADATA_FILENAME = "lib.rmeta";

/// We use a temp directory here to avoid races between concurrent rustc processes,
/// such as builds in the same directory using the same filename for metadata while
/// building an `.rlib` (stomping over one another), or writing an `.rmeta` into a
/// directory being searched for `extern crate` (observing an incomplete file).
/// The returned path is the temporary file containing the complete metadata.
// rustc: compiler/rustc_metadata/src/fs.rs:27 emit_wrapper_file
export function emit_wrapper_file(sess: Session, data: Uint8Array, tmpdir: string, name: string): string {
  const out_filename = path_join(tmpdir, name);
  let result: IoResult<null>;
  try {
    writeFileSync(out_filename, data);
    result = Ok(null);
  } catch (e) {
    result = Err(io_error_from_node(e));
  }

  if (result.$ === "Err") {
    const err = result._0;
    sess.dcx().emit_fatal(FailedWriteError_diagnostic({ filename: out_filename, err }));
  }

  return out_filename;
}

// rustc: compiler/rustc_metadata/src/fs.rs:38 encode_and_write_metadata
export function encode_and_write_metadata(tcx: TyCtxt): Result<EncodedMetadata, ErrorGuaranteed> {
  const out_filename = filename_for_metadata(tcx.sess, tcx.output_filenames(null) as OutputFilenames);
  // To avoid races with another rustc process scanning the output directory,
  // we need to write the file somewhere else and atomically move it to its
  // final destination, with an `fs::rename` call. In order for the rename to
  // always succeed, the temporary file needs to be on the same filesystem,
  // which is why we create it inside the output directory specifically.
  const tmpdir_r = TempDirBuilder.new()
    .prefix("rmeta")
    .tempdir_in(OutFileName.parent(out_filename) ?? "");
  const metadata_tmpdir_ = tmpdir_r.$ === "Ok" ? tmpdir_r._0 : tcx.dcx().emit_fatal(FailedCreateTempdir_diagnostic({ err: tmpdir_r._0 }));
  const metadata_tmpdir = MaybeTempDir.new(metadata_tmpdir_, tcx.sess.opts.cg.save_temps);
  // PORT: see the header; `moved` is set once the dir has moved into the `EncodedMetadata`.
  let moved = false;
  try {
    const metadata_filename = path_join(metadata_tmpdir.as_ref(), "full.rmeta");
    let metadata_stub_filename: string | undefined;
    if (!tcx.sess.opts.unstable_opts.embed_metadata && !tcx.crate_types().includes("ProcMacro")) {
      metadata_stub_filename = path_join(metadata_tmpdir.as_ref(), "stub.rmeta");
    } else {
      metadata_stub_filename = undefined;
    }

    if (tcx.needs_metadata()) {
      encode_metadata(tcx, metadata_filename, metadata_stub_filename);
    } else {
      // Always create a file at `metadata_filename`, even if we have nothing to write to it.
      // This simplifies the creation of the output `out_filename` when requested.
      const r = file_create(metadata_filename);
      if (r.$ === "Err") {
        tcx.dcx().emit_fatal(FailedCreateFile_diagnostic({ filename: metadata_filename, err: r._0 }));
      }
      if (metadata_stub_filename !== undefined) {
        const r = file_create(metadata_stub_filename);
        if (r.$ === "Err") {
          tcx.dcx().emit_fatal(FailedCreateFile_diagnostic({ filename: metadata_stub_filename, err: r._0 }));
        }
      }
    }

    const guar = tcx.sess.dcx().has_errors_or_delayed_bugs();
    if (guar !== undefined) {
      return Err(guar);
    }

    const _prof_timer = tcx.sess.prof.generic_activity("write_crate_metadata");

    // If the user requests metadata as output, rename `metadata_filename`
    // to the expected output `out_filename`. The match above should ensure
    // this file always exists.
    const need_metadata_file = tcx.sess.opts.output_types.contains_key("Metadata");
    let metadata_filename_: string;
    let metadata_tmpdir_out: MaybeTempDir | undefined;
    if (need_metadata_file) {
      let filename: string;
      switch (out_filename.$) {
        case "Real": {
          const path = out_filename._0;
          const r = non_durable_rename(metadata_filename, path);
          if (r.$ === "Err") {
            tcx.dcx().emit_fatal(FailedWriteError_diagnostic({ filename: path, err: r._0 }));
          }
          filename = path;
          break;
        }
        case "Stdout": {
          if (OutFileName.is_tty(out_filename)) {
            tcx.dcx().emit_err(BinaryOutputToTty_diagnostic({}));
          } else {
            const r = copy_to_stdout(metadata_filename);
            if (r.$ === "Err") {
              tcx.dcx().emit_err(FailedCopyToStdout_diagnostic({ filename: metadata_filename, err: r._0 }));
            }
          }
          filename = metadata_filename;
          break;
        }
      }
      if (tcx.sess.opts.json_artifact_notifications) {
        tcx.dcx().emit_artifact_notification(OutFileName.as_path(out_filename), "metadata");
      }
      [metadata_filename_, metadata_tmpdir_out] = [filename, metadata_tmpdir];
    } else {
      [metadata_filename_, metadata_tmpdir_out] = [metadata_filename, metadata_tmpdir];
    }

    // Load metadata back to memory: codegen may need to include it in object files.
    // PORT: the dir moves into `from_path`, which drops it on an empty file and on its own errors.
    moved = true;
    const r = EncodedMetadata.from_path(metadata_filename_, metadata_stub_filename, metadata_tmpdir_out);
    const metadata = r.$ === "Ok" ? r._0 : tcx.dcx().emit_fatal(FailedCreateEncodedMetadata_diagnostic({ err: r._0 }));

    return Ok(metadata);
  } finally {
    // PORT: an unwinding exit and the early `return Err(guar)` drop the dir; after `from_path` it is not ours.
    if (!moved) metadata_tmpdir.drop();
  }
}

// rustc: compiler/rustc_metadata/src/fs.rs:121 non_durable_rename
function non_durable_rename_not_linux(src: string, dst: string): IoResult<null> {
  // std::fs::rename(src, dst)
  try {
    renameSync(src, dst);
    return Ok(null);
  } catch (e) {
    return Err(io_error_from_node(e));
  }
}

/// This function attempts to bypass the auto_da_alloc heuristic implemented by some filesystems
/// such as btrfs and ext4. When renaming over a file that already exists then they will "helpfully"
/// write back the source file before committing the rename in case a developer forgot some of
/// the fsyncs in the open/write/fsync(file)/rename/fsync(dir) dance for atomic file updates.
///
/// To avoid triggering this heuristic we delete the destination first, if it exists.
/// The cost of an extra syscall is much lower than getting descheduled for the sync IO.
// rustc: compiler/rustc_metadata/src/fs.rs:133 non_durable_rename
function non_durable_rename_linux(src: string, dst: string): IoResult<null> {
  // let _ = std::fs::remove_file(dst);
  try {
    unlinkSync(dst);
  } catch {
    // ignored
  }
  // std::fs::rename(src, dst)
  try {
    renameSync(src, dst);
    return Ok(null);
  } catch (e) {
    return Err(io_error_from_node(e));
  }
}

/** PORT: `#[cfg(target_os = "linux")]` picks the variant for the host rustc runs on. */
export const non_durable_rename: (src: string, dst: string) => IoResult<null> = process.platform === "linux" ? non_durable_rename_linux : non_durable_rename_not_linux;

// rustc: compiler/rustc_metadata/src/fs.rs:138 copy_to_stdout
export function copy_to_stdout(from: string): IoResult<null> {
  // let mut reader = fs::File::open_buffered(from)?;
  // let mut stdout = io::stdout();
  // io::copy(&mut reader, &mut stdout)?;
  let fd: number;
  try {
    fd = openSync(from, "r");
  } catch (e) {
    return Err(io_error_from_node(e));
  }
  try {
    const buf = new Uint8Array(64 * 1024);
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      // `io::copy` writes each chunk with `<Stdout as Write>::write_all`, which swallows `EBADF` (std `handle_ebadf`).
      const w = stdout_write_all(buf.subarray(0, n));
      if (w.$ === "Err") return w;
    }
  } catch (e) {
    return Err(io_error_from_node(e));
  } finally {
    closeSync(fd);
  }
  return Ok(null);
}

/** `std::fs::File::create(path)` (the handle is dropped at once). */
function file_create(path: string): IoResult<null> {
  try {
    closeSync(openSync(path, "w"));
    return Ok(null);
  } catch (e) {
    return Err(io_error_from_node(e));
  }
}

// ---- Stand-ins (see the header) ------------------------------------------------------------------------------

/** PORT: stand-in for `tempfile::TempDir`. */
class TempDir {
  constructor(public path_: string) {}

  /** `TempDir::path` */
  path(): string {
    return this.path_;
  }

  /** `TempDir::keep`: the directory is not removed. */
  keep(): string {
    return this.path_;
  }

  /** `impl Drop for TempDir`: `remove_dir_all`, ignoring errors. */
  drop(): void {
    try {
      rmSync(this.path_, { recursive: true, force: true });
    } catch {
      // ignored
    }
  }
}

/** PORT: stand-in for `rustc_fs_util::TempDirBuilder` (over `tempfile::Builder`); only `new`/`prefix`/`tempdir_in`. */
class TempDirBuilder {
  private prefix_ = ".tmp";

  static new(): TempDirBuilder {
    return new TempDirBuilder();
  }

  prefix(prefix: string): TempDirBuilder {
    this.prefix_ = prefix;
    return this;
  }

  tempdir_in(dir: string): IoResult<TempDir> {
    try {
      // tempfile: a relative `dir` is made absolute first (`env::current_dir()?.join(dir)`).
      const abs = path_is_absolute(dir) ? dir : path_join(process.cwd(), dir);
      return Ok(new TempDir(mkdtempSync(path_join(abs, this.prefix_))));
    } catch (e) {
      return Err(io_error_from_node(e));
    }
  }
}

/** PORT: stand-in for `rustc_data_structures::temp_dir::MaybeTempDir`. */
export class MaybeTempDir {
  private dropped = false;

  constructor(
    private dir: TempDir,
    // Whether the TempDir should be deleted on drop.
    private keep: boolean,
  ) {}

  static new(dir: TempDir, keep_on_drop: boolean): MaybeTempDir {
    return new MaybeTempDir(dir, keep_on_drop);
  }

  /** `impl AsRef<Path>` */
  as_ref(): string {
    return this.dir.path();
  }

  /** `impl Drop` (idempotent here, as a drop runs once). */
  drop(): void {
    if (this.dropped) return;
    this.dropped = true;
    if (this.keep) {
      this.dir.keep();
    } else {
      this.dir.drop();
    }
  }
}
