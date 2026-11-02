# Handoff: lane `miri-fs` (M6 wave 37)

Scope: Miri `src/tools/miri/src/shims/unix/fs.rs` (2,404 lines) → `src/miri/shims/unix/fs.ts`. Branch `t3/port-miri-unix-fs`.

## Files touched
- `src/miri/shims/unix/fs.ts`: the port (every fn of fs.rs, in upstream order; the stub list is gone).
- `src/miri/shims/unix/fs.test.ts` (new): unit tests against the isolated Miri oracle.
- `src/std/fs.ts` (new): **the D14 `std::fs` stand-in. Root decision needed** (as for miri-eval's `src/std/time.ts`), see below.
- `docs/handoff/miri-fs.md` (this file).
- `fs.gen.ts`: unchanged. `bun tools/codegen/types.ts miri` regenerates with no diff. No typemap edit was made.

## Verification (one line each)
- `bunx tsc --noEmit -p .`: 0 errors.
- `bun scripts/coverage.ts --check --offline`: `markers ok (24012; vendor 5050; library 583)` (the new std markers in src/std/fs.ts pass the strict library check).
- `bun scripts/coverage.ts --missing src/tools/miri/src/shims/unix/fs.rs`: **58/58 ported**.
- Codegen set `miri` (`bun tools/codegen/types.ts miri`): no diff (0 unknown types).
- `bun test ./src/miri/shims/unix/fs.test.ts`: 9 pass / 0 fail (201 expects).
- `RUST_TS_REQUIRE_PROBES=1 bun test ./src ./tools`: RESULT_SRC
- `bun test ./scripts ./harness`: RESULT_SCRIPTS
- `bun scripts/difftest.ts --suite mir --sample 100`: RESULT_DIFFTEST

## Oracle evidence (isolated Miri, `$RUST_TS_DATA/tmp/miri-fs/`, runner `m.sh`)
- `open.rs` (`std::fs::File::open("foo.txt")`, default isolation) prints `error: unsupported operation: \`open\` not available when isolation is enabled`, then the help lines and the std backtrace. The message and the help text come from `isolation_abort_error` / diagnostics (already ported). The fs shim's part is the op name and that the rejection happens after the right prechecks.
- `errs.rs` / `errs2.rs` (libc calls with `-Zmiri-isolation-error=warn-nobacktrace`) give the errno per op. These are the `ERRNO` table in fs.test.ts: EPERM for open/openat/unlink/symlink/linkat/rename/mkdir/rmdir; EACCES for stat/lstat/fstatat/chmod/opendir/utimensat/readlink/realpath/mkstemp/statx; EBADF for fstat/readdir/closedir/fallocate; posix_fallocate *returns* 9. They also give the prechecks that run before isolation: EINVAL for lseek's bad whence or negative offset, EBADF for bad fds (lseek/ftruncate/fsync/fdatasync/futimens/sync_file_range/isatty), EOPNOTSUPP for O_TMPFILE, EINVAL for O_CREAT|O_DIRECTORY, and EFAULT for NULL paths.
- `errs3.rs` prints `open: unsupported flags: 0x10000000`. `errs2.rs` prints `open: unsupported access mode 0x3`. `errs4.rs` (`/proc/foo`) prints the FileInProcOpened warning, then the isolation error.
- `consts.rs` prints the x86_64-linux libc constants the test uses.

## Unit tests (fs.test.ts)
They use a stub interpreter, like machine.test.ts. Coverage:
- Every entry point under `Abort` stops with `UnsupportedInIsolation("\`<op>\` not available when isolation is enabled")` and does not touch errno.
- Under `WarningWithoutBacktrace`: the oracle's one-time warning text and errno for each op.
- `open` flag validation: access mode, leftover flags (including bit 31, printed as two's complement), O_TMPFILE, O_CREAT|O_DIRECTORY, every supported flag consumed, O_DIRECTORY.
- The `/proc` diagnostic; EFAULT ordering; the fd prechecks.
- `DirTable` / `DirStream`.
- The std stand-in builders and `std::path::absolute`.

The tests stub other lanes' methods (`set_errno_and_return_neg1_i32`, `set_last_error`, `check_varargs`, `read_path_from_c_str`, ...). The errno for a `HostError(PermissionDenied)` is mapped by the test (EPERM, io_error.rs's table). shims-b's real mapping is not exercised here.

## `src/std/fs.ts` (D14 stand-in; root decision)
- What is ported is pure: `OpenOptions` (the unix `sys::fs::OpenOptions` fields, mode 0o666 by default, plus `OpenOptionsExt::mode` / `custom_flags`), `FileTimes`, `Permissions` (`from_mode`, `mode`, `readonly`), `DirBuilder` (+ `DirBuilderExt::mode`), and `std::path::absolute` (+ `sys::path::unix::absolute`). It has to exist because `open` builds its `OpenOptions` *before* the isolation check, and the `/proc` check calls `path::absolute` on the isolation-on path. That check reads the host cwd for relative paths, as Miri does (D14).
- What is not implemented: every host operation (`File`, `Dir`, `ReadDir`, `DirEntry`, `Metadata`, `FileType` methods and the free fns `metadata`, `remove_file`, `rename`, `read_dir`, ...). Each one stops with `unported("... (host file system access, isolation off; plan-m6 D14 ...)")`. Only isolation-off cases reach them, and the gated suites skip those. A node:fs implementation is possible later but approximates std semantics: Node has no lseek (the cursor would be emulated), no openat for `Dir`, and no flock. I left it out rather than guess.
- `std::path::absolute` belongs in `src/std/path.ts`, and `SeekFrom` in `src/std/io.ts`. They sit in fs.ts because this lane may only create fs.ts. Root may move them.
- Typemap follow-up (a codegen edit, root): map `std::fs::{File, Dir, ReadDir}` (FileHandle.file, DirHandle.dir, DirStream.read_dir) and fs.rs's `Pending<"FileType">` / `fs::Permissions` / `fs::Metadata` to the stand-in classes. That would drop the `as unknown as fs.File` casts in fs.ts.

## `// PORT:` decisions
- `cfg(unix)` / `cfg(windows)` of Miri's own build are host cfgs, selected by `process.platform`. `libc::O_DIRECTORY` / `O_NOFOLLOW` / `O_EXCL` in those blocks are the host's (node:fs `constants`). On a Windows host the windows branches run: `open`'s non-default-mode unsupported error and `FILE_FLAG_OPEN_REPARSE_POINT` (0x200000) are ported; unlink/symlink/rmdir's windows host branches and `share_mode` stop `unported` (they are after the isolation check).
- `cfg(bootstrap)` is off for the pinned component, so the `fallback` path field is not ported.
- `impl From<io::ErrorKind> for IoError` (`ErrorKind::PermissionDenied` / `NotFound` / `WouldBlock`) is a local helper building `HostError(io::Error)`. `src/std/io.ts` has no `Repr::Simple`, so the stand-in is `SimpleMessage { kind, message: kind.as_str() }`: same `kind()` and `Display`, different `Debug`, which no fs.rs path prints. **Needs a `Simple` variant in std/io.ts** (shims-b needs one too, for `try_errnum_to_io_error`).
- `UnixFileDescription for FileHandle / DirHandle` are exported impl tables `UnixFileDescription_FileHandle` (pread, pwrite, flock, get_flags) and `UnixFileDescription_DirHandle` (get_flags), with `self` first. shims-d/shims-b compose them with the trait's provided methods.
- `DirStream::new`, `next_host_entry`, `DirTable::insert_new` / `Default::default` / `VisitProvenance`, and the `FileMetadata` statics go through `port_methods`. `DirTable.default` is what machine.ts's `DirTable_default()` resolves; `dirs.visit_provenance` is what `visit_object` calls.
- `try_insert(..).unwrap()` in `insert_new` panics with the `OccupiedError` Debug, built from the generated `debug_DirStream`. That Debug is unported for the host `ReadDir`, and the path is unreachable because ids only grow.
- `mkstemp`'s `SUBSTITUTIONS.choose(rng)` (`rand::seq::IndexedRandom::choose`) is not in the vendored rand subset, so it is `unported`. It is only reachable with isolation off.

## Contract gaps (other lanes; I did not edit their files)
- **miri-shims-b (files.rs)**:
  - `FileDescriptionRef::downcast<T>()` is declared without a runtime witness. fs.ts adds a local overload `downcast<U>(type_name: "FileHandle" | "DirHandle")` marked `PORT(contract)`; shims-b implements it or replaces it, and the call sites change with it.
  - `Deref` is read as `ref._0.inner` (local `deref()`).
  - `FdTable::insert_new` / `new_ref` / `insert` receive plain `FileHandle { file, writable, readable }` / `DirHandle { dir }` records, cast because the skeleton types are `Pending<"impl FileDescription">`.
  - `FileDescription::seek` gets a `SeekFrom` object (`{ $: "Start" | "Current" | "End", _0: bigint }`, cast from `Pending`).
  - `FileDescription::metadata()` is read as `Either<io::Result<fs::Metadata>, string>`.
  - `open_file_or_dir(root, path, opts)` gets the std/fs.ts `OpenOptions` and is expected to return `Result<Either<File, Dir>, io::Error>`.
  - `check_varargs(tys, ..)`: `tys` is passed as a `(this) => Ty[]` closure (the `shim_varargs!` expansion; the declared type is `Pending`).
  - io_error.rs: no exported `From<ErrorKind>` / `From<io::Error>` converters (fs.ts builds the variants directly).
- **miri-shims-a (os_str.rs)**: `read_path_from_c_str`, `read_os_str_from_c_str`, `convert_path`, `alloc_path_as_c_str`, `write_path_to_c_str`, `bytes_to_os_str` are used as declared.
- **miri-shims-b (time.rs)**: `read_timespec`, `system_time_to_duration` are used as declared.
- **miri-shims-d (fd.rs)**: `close`, `FlockOp` are used as declared.
- **Dispatch** (shims-c unix/foreign_items, linux): they call these shims with the declared signatures (`readlink` returns `bigint` (i64), `readdir` takes the `dirent`/`dirent64` type name, `lseek` takes an `i128` offset as bigint).

## `unported(...)` left
- src/std/fs.ts: every host fs operation (one `host(..)` helper), and `std::sys::path::windows::absolute`.
- fs.ts:
  - `host libc::<O_*>` if node:fs lacks the constant (on this macOS host they exist);
  - unlink/symlink/rmdir cfg(windows) host branches;
  - `OpenOptionsExt::share_mode` (mkstemp on Windows);
  - `rand::seq::IndexedRandom::choose`.
- All of them are after the isolation check, or host-only.
