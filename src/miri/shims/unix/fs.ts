// Port of src/tools/miri/src/shims/unix/fs.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-fs` (plan-m6 wave 37). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into fs.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type MPlaceTy, type OpTy, type Pointer, type Scalar } from "../../lib.ts";
import { type MiriInterpCx } from "../../machine.ts";
import { type FdId, type FdNum, type FileHandle } from "../files.ts";
import { type IoError } from "../io_error.ts";
import { type Varargs } from "../sig.ts";
import { type DirEntry, DirStream, DirTable, FileMetadata, type TimeUpdate } from "./fs.gen.ts";
import { stub_methods, stub_statics } from "../../../rust_ts/miri_stub.ts";
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../../rustc_const_eval/interpret/machine.ts";
import { type InterpResult } from "../../../rustc_middle/mir/interpret/mod.ts";
import { type Pending } from "../../../rustc_type_ir/decls.ts";
import { type IoError as io_Error } from "../../../std/io.ts";
import { type Result } from "../../../std/result.ts";
import { type Metadata } from "../../../vendor/anstyle/effect.ts";
export * from "./fs.gen.ts";

declare module "../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- shims/unix/fs.rs: `trait EvalContextExtPrivate` (impl for `MiriInterpCx`) ----
    // shims/unix/fs.rs:269
    parse_utimens_timespec(this: MiriInterpCx, tp: MPlaceTy): InterpResult<TimeUpdate | undefined>;
    // shims/unix/fs.rs:297
    parse_utimens_times(this: MiriInterpCx, times_ptr: Pointer): InterpResult<[TimeUpdate, TimeUpdate] | undefined>;
    // shims/unix/fs.rs:320
    write_stat_buf(this: MiriInterpCx, metadata: FileMetadata, buf_op: OpTy, buf_type: string): InterpResult<number>;
    // shims/unix/fs.rs:377
    file_type_to_d_type(this: MiriInterpCx, file_type: Result<Pending<"FileType">, io_Error>): InterpResult<number>;
    // shims/unix/fs.rs:413
    dir_entry_fields(this: MiriInterpCx, entry: Pending<"Either<fs::DirEntry, &'static str>">): InterpResult<DirEntry>;
    // shims/unix/fs.rs:440
    host_permissions_from_mode(this: MiriInterpCx, mode: number): InterpResult<Pending<"fs::Permissions">>;
    // ---- shims/unix/fs.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/unix/fs.rs:456
    open(this: MiriInterpCx, dirfd: OpTy | undefined, path_raw: OpTy, flag: OpTy, varargs: Varargs): InterpResult<Scalar>;
    // shims/unix/fs.rs:742
    lseek(this: MiriInterpCx, fd_num: number, offset: bigint, whence: number, dest: MPlaceTy): InterpResult;
    // shims/unix/fs.rs:781
    unlink(this: MiriInterpCx, path_op: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:811
    symlink(this: MiriInterpCx, target_op: OpTy, linkpath_op: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:850
    linkat(this: MiriInterpCx, oldfd_op: OpTy, oldpath_op: OpTy, newfd_op: OpTy, newpath_op: OpTy, flags_op: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:903
    stat(this: MiriInterpCx, path_op: OpTy, buf_op: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:931
    lstat(this: MiriInterpCx, path_op: OpTy, buf_op: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:958
    fstat(this: MiriInterpCx, fd_op: OpTy, buf_op: OpTy, buf_type: string): InterpResult<Scalar>;
    // shims/unix/fs.rs:989
    fstatat(this: MiriInterpCx, dirfd_op: OpTy, path_op: OpTy, buf_op: OpTy, flags_op: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:1043
    linux_statx(this: MiriInterpCx, dirfd_op: OpTy, pathname_op: OpTy, flags_op: OpTy, mask_op: OpTy, statxbuf_op: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:1207
    chmod(this: MiriInterpCx, path_op: OpTy, mode_op: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:1232
    fchmod(this: MiriInterpCx, fd_op: OpTy, mode_op: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:1260
    rename(this: MiriInterpCx, oldpath_op: OpTy, newpath_op: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:1288
    mkdir(this: MiriInterpCx, path_op: OpTy, mode_op: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:1322
    rmdir(this: MiriInterpCx, path_op: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:1353
    opendir(this: MiriInterpCx, name_op: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:1405
    readdir(this: MiriInterpCx, dirp_op: OpTy, dest: MPlaceTy, buf_type: string): InterpResult;
    // shims/unix/fs.rs:1556
    dirfd(this: MiriInterpCx, dirp_op: OpTy, dest: MPlaceTy): InterpResult;
    // shims/unix/fs.rs:1575
    closedir(this: MiriInterpCx, dirp_op: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:1606
    ftruncate64(this: MiriInterpCx, fd_num: number, length: bigint): InterpResult<Scalar>;
    // shims/unix/fs.rs:1634
    posix_fallocate(this: MiriInterpCx, fd_num: number, offset: bigint, len: bigint): InterpResult<Scalar>;
    // shims/unix/fs.rs:1655
    linux_fallocate(this: MiriInterpCx, fd: number, mode: number, offset: bigint, size: bigint): InterpResult<Scalar>;
    // shims/unix/fs.rs:1685
    fallocate_impl(this: MiriInterpCx, fd_num: number, offset: bigint, len: bigint): InterpResult<Result<null, IoError>>;
    // shims/unix/fs.rs:1734
    fsync(this: MiriInterpCx, fd_op: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:1747
    ffullsync_fd(this: MiriInterpCx, fd_num: number): InterpResult<Scalar>;
    // shims/unix/fs.rs:1762
    fdatasync(this: MiriInterpCx, fd_op: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:1782
    futimens(this: MiriInterpCx, fd_op: OpTy, times_op: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:1809
    utimensat(this: MiriInterpCx, dirfd_op: OpTy, path_op: OpTy, times_op: OpTy, flags_op: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:1872
    sync_file_range(this: MiriInterpCx, fd_op: OpTy, offset_op: OpTy, nbytes_op: OpTy, flags_op: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:1909
    readlink(this: MiriInterpCx, pathname_op: OpTy, buf_op: OpTy, bufsize_op: OpTy): InterpResult<bigint>;
    // shims/unix/fs.rs:1975
    isatty(this: MiriInterpCx, miri_fd: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:1994
    realpath(this: MiriInterpCx, path_op: OpTy, processed_path_op: OpTy): InterpResult<Scalar>;
    // shims/unix/fs.rs:2052
    mkstemp(this: MiriInterpCx, template_op: OpTy): InterpResult<Scalar>;
  }
}

declare module "./fs.gen.ts" {
  interface DirStream {
    // shims/unix/fs.rs:46
    next_host_entry(): Result<Pending<"Either<fs::DirEntry, &'static str>">, io_Error> | undefined;
  }
  namespace DirStream {
    // shims/unix/fs.rs:42
    function new_(read_dir: Pending<"fs::ReadDir">, fd_num: FdNum, fd_id: FdId): DirStream;
    export { new_ as new };
  }
}
declare module "./fs.gen.ts" {
  interface DirTable {
    // shims/unix/fs.rs:210
    insert_new(stream: DirStream): bigint;
  }
}
declare module "./fs.gen.ts" {
  namespace FileMetadata {
    // shims/unix/fs.rs:2242
    export let at: (ecx: MiriInterpCx, dirfd: FdNum, path: string, symlink_nofollow_flag: boolean, empty_path_flag: boolean) => InterpResult<Result<FileMetadata, IoError>>;
    // shims/unix/fs.rs:2294
    export let from_fd_num: (ecx: MiriInterpCx, fd_num: FdNum) => InterpResult<Result<FileMetadata, IoError>>;
    // shims/unix/fs.rs:2307
    export let synthetic: (ecx: MiriInterpCx, mode_name: string) => InterpResult<Result<FileMetadata, IoError>>;
    // shims/unix/fs.rs:2331
    export let from_host: (ecx: MiriInterpCx, metadata: Result<Metadata, io_Error>) => InterpResult<Result<FileMetadata, IoError>>;
  }
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl UnixFileDescription for FileHandle (shims/unix/fs.rs:69): pread (:70), pwrite (:111), flock (:143), get_flags (:172)
// impl UnixFileDescription for DirHandle (shims/unix/fs.rs:182): get_flags (:183)
// impl Default for DirTable (shims/unix/fs.rs:218): default (:219)
// impl VisitProvenance for DirTable (shims/unix/fs.rs:228): visit_provenance (:229)
// fn maybe_sync_file (shims/unix/fs.rs:238)
// fn host_file_times_from_updates (shims/unix/fs.rs:254)
// fn extract_sec_and_nsec (shims/unix/fs.rs:2179)
// fn file_type_to_mode_name (shims/unix/fs.rs:2191)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::shims::unix::fs::EvalContextExtPrivate", "src/tools/miri/src/shims/unix/fs.rs", "miri-fs", () => InterpCx.prototype, ["parse_utimens_timespec", "parse_utimens_times", "write_stat_buf", "file_type_to_d_type", "dir_entry_fields", "host_permissions_from_mode"]);
stub_methods("miri::shims::unix::fs::EvalContextExt", "src/tools/miri/src/shims/unix/fs.rs", "miri-fs", () => InterpCx.prototype, ["open", "lseek", "unlink", "symlink", "linkat", "stat", "lstat", "fstat", "fstatat", "linux_statx", "chmod", "fchmod", "rename", "mkdir", "rmdir", "opendir", "readdir", "dirfd", "closedir", "ftruncate64", "posix_fallocate", "linux_fallocate", "fallocate_impl", "fsync", "ffullsync_fd", "fdatasync", "futimens", "utimensat", "sync_file_range", "readlink", "isatty", "realpath", "mkstemp"]);
stub_methods("miri::shims::unix::fs::DirStream", "src/tools/miri/src/shims/unix/fs.rs", "miri-fs", () => DirStream.prototype, ["next_host_entry"]);
stub_statics("miri::shims::unix::fs::DirStream", "src/tools/miri/src/shims/unix/fs.rs", "miri-fs", () => DirStream, ["new"]);
stub_methods("miri::shims::unix::fs::DirTable", "src/tools/miri/src/shims/unix/fs.rs", "miri-fs", () => DirTable.prototype, ["insert_new"]);
stub_statics("miri::shims::unix::fs::FileMetadata", "src/tools/miri/src/shims/unix/fs.rs", "miri-fs", () => FileMetadata, ["at", "from_fd_num", "synthetic", "from_host"]);
