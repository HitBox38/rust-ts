# Handoff: lane `miri-host-fs` (wave 40i)

Scope: the scout's lane 4 (`docs/handoff/scout-unported.md` §5). Miri's file shims call the host's `std::fs` when isolation
is off, and `src/std/fs.ts` now implements those calls (plan-m6 D14). Root assigned `src/std/fs.ts` to this lane explicitly
(PORTING §1). Branch: see the final message.

## Cases gained (each run alone, `RUST_TS_AGENT=miri-host-fs`)
| suite | case | before (gate-20261110-113508-root-m7vn / fixers-40-proto-miri-fail) | now |
|---|---|---|---|
| miri-pass | `tests/pass/open_a_file_in_proc.rs` | UNPORTED `open_file_or_dir` | MATCH (run `mhfs-open2`) |
| miri-pass-heavy | `tests/pass/issues/issue-miri-3680.rs` | UNPORTED `std::fs::remove_file` | MATCH (`mhfs-issue-miri-3680-1`) |
| miri-pass-heavy | `tests/pass/shims/fs-permissions.rs` | UNPORTED `std::fs::remove_file` | MATCH (`mhfs-fs-permissions-1`) |
| miri-pass-heavy | `tests/pass/shims/fs.rs` | UNPORTED `std::fs::metadata` | MATCH (`mhfs-fs-1`) |
| miri-fail | `tests/fail/shims/input_arg_mismatch.rs` | UNPORTED `open_file_or_dir` | MATCH (`mhfs-input_arg_mismatch-1`) |
| miri-fail | `tests/fail/shims/return_type_mismatch.rs` | UNPORTED `open_file_or_dir` | MATCH (`mhfs-return_type_mismatch-1`) |

`shims/fs.rs` covers nearly every host call: create/read/write/seek, `set_len`, `sync_*`, `flock`, `set_times` (file, path,
nofollow), `read_dir` + entry metadata, `rename`, `hard_link`, symlinks, `read_link`, `canonicalize`, `mkdir`/`rmdir`,
`fs::Dir` (`openat`, `fstatat`), permissions, and opening a directory.

## Files touched
- `src/std/fs.ts`: the host implementation (details below).
- `src/std/fs.test.ts` (new): unit tests of fs.ts against the host.
- `src/miri/shims/files.ts`: `open_file_or_dir`, plus `FileHandle`'s `read`, `write`, `seek`, `metadata` and `is_tty`, and
  `DirHandle`'s `metadata`. These are the former `unported` stops. `import type * as fs` became a value import.
- `src/miri/shims/unix/fs.ts`: drop glue on `FileHandleDesc` / `DirHandleDesc` (closes the host fd), and the drops Rust does
  implicitly: `open` (the `EISDIR` / `ENOTDIR` / `ELOOP` early returns), `opendir` (the failed-`Dir::open` path) and `closedir`
  (the host `ReadDir`).
- `src/miri/shims/unix/fs.test.ts`: the stand-in test expected `std::fs::metadata` to stop `unported`. On the root host it
  now checks the host answer (`unported` elsewhere).
- `docs/handoff/miri-host-fs.md` (this file).

## How src/std/fs.ts works (every `// PORT:` decision)
- **libc through `bun:ffi`, as std does.** fs.ts ports the `sys::fs` layer std uses on the host: `sys/fs/unix.rs`,
  `sys/fs/unix/dir.rs`, `sys/fs/mod.rs`, `FileDesc::read/write`, `OwnedFd`, `cvt`/`cvt_r`, `run_path_with_cstr`,
  `isatty`. It makes the same libc calls with the same arguments: `open` with `O_CLOEXEC`, `fstat`/`stat`/`lstat`/`fstatat`,
  `lseek`, `flock`, `ftruncate`, `fcntl(F_FULLFSYNC)`, `fcntl(F_DUPFD_CLOEXEC, 3)`, `fchmod`/`chmod`, `mkdir`, `unlink`,
  `rmdir`, `rename`, `symlink`, `linkat`, `readlink` (std's growing loop), `opendir`/`readdir`/`closedir`/`dirfd`,
  `setattrlist`/`fsetattrlist` (Apple's `set_times`), and `realpath` through the existing `src/std/path.ts`
  `host_canonicalize`. `errno` is read right after the failing call (`io::Error::last_os_error`). So error numbers,
  permissions, timestamps, inode numbers and the `readdir` order are the host's own, with nothing derived or faked.
  `node:fs` was rejected: it has no `lseek`, `flock`, `openat` or `fstatat`, and libuv adds its own fallbacks (its
  `fsync` falls back to `F_BARRIERFSYNC`).
- **Only `aarch64-apple-darwin` is described** (the root host, AGENTS.md §5). That covers the struct layouts
  (`struct stat` 144 bytes, `struct dirent` with `d_name` at 21, `struct attrlist` 24 bytes) and the `libc::` constants
  (the libc crate's values for that target). On any other host every host operation stops
  `unported("… ports the aarch64-apple-darwin libc only, host <platform>-<arch>")`. x86_64 macOS would need the
  `$INODE64` symbols; Linux would need its own layouts and `statx`.
- **Variadic calls on Apple arm64.** `open`, `openat` and `fcntl` with an argument are variadic, and Apple's arm64 ABI
  passes variadic arguments on the stack. `bun:ffi` cannot declare a variadic function, so a plain 3-argument call
  passes a garbage mode (measured: 0o640 came out as 0o140). The declarations therefore fill the eight argument registers
  with zero padding, which puts the variadic argument in the first stack slot, where `va_arg` reads it. The unit test
  "open passes the mode through the variadic argument" checks 3 modes through both `open` and `openat`.
- **Drops.** `OwnedFd` closes on drop, and `DirStream` calls `closedir` (asserting success as std does). JS has no
  destructors, so owners call `drop()` where Rust drops the value. A dropped or moved value panics if it is used again.
  `debug_assert_fd_is_open` is a no-op, since std ships without UB checks.
- **Newtypes.** `std::fs::{File, Dir, Metadata, FileType, ReadDir, DirEntry}` wrap `fs_imp_*` classes, as upstream wraps
  `fs_imp::*`. The upstream method names collide across the two layers, so each layer keeps its own markers. The classes
  that were already collapsed stay collapsed: `OpenOptions`, `Permissions`, `FileTimes`, `DirBuilder`. They gained
  `get_access_mode`/`get_creation_mode`, `set_readonly`, `FileTimes.created` (Apple field) and `clone`. `FileDesc(OwnedFd)`
  is the `OwnedFd`.
- **`mode as mode_t`** truncates to 16 bits on Apple. `OpenOptionsExt::mode`, `PermissionsExt::from_mode` and
  `DirBuilderExt::mode` now do the same (host only).
- **`SystemTime::new(sec, nsec)`** is ported in fs.ts as `SystemTime_new` (no marker; Apple's pre-epoch correction and
  the `InvalidData "invalid timestamp"` error). src/std/time.ts keeps `Timespec` private, so the value is built from
  `UNIX_EPOCH` with whole-second, then nanosecond, `checked_add`/`checked_sub`, which is exact. **Root:** consider
  exporting `Timespec` / adding `SystemTime::new` with its markers in time.ts, then switching fs.ts to it.
- **Paths** go to libc as the path string's UTF-8 bytes. Returned paths and names are decoded lossily. `OsString` names
  are strings, as before.
- **`File::truncate`'s `off64_t` conversion error** uses `TryFromIntError`'s Display text as the `Custom` error. Only
  sizes ≥ 2^63 reach it, and Miri's `ftruncate64` checks the range before calling it.
- `DirEntry::metadata` after its `ReadDir` was dropped panics, because the `Arc<InnerReadDir>` keep-alive is not
  modelled. Miri reads an entry's fields before the stream can be closed.

## `unported(...)` left
- `src/std/fs.ts` `host(...)`: every host operation on a host other than aarch64-apple-darwin (see above).
- `src/std/fs.ts` `DirBuilder::_create` with `recursive` (`create_dir_all`). Miri's `mkdir` never sets it.
- `src/miri/shims/files.ts` `open_file_or_dir`: the `cfg(windows)` host branch (retry via `fs::Dir`).
- Unchanged, outside this lane: `FdTable::insert_with_min_num`'s unwrap text; in unix/fs.ts `mkstemp`'s
  `rand::seq::IndexedRandom::choose`, and the Windows-host branches of `unlink`/`rmdir`/`symlink`/`mkstemp`.

## Coverage (`bun scripts/coverage.ts --missing <file>`, ported/total; before → after)
- `library/std/src/fs.rs`: 57 → 69 / 147
- `library/std/src/sys/fs/unix.rs`: 1 → 59 / 186
- `library/std/src/sys/fs/unix/dir.rs`: 0 → 11 / 26
- `library/std/src/sys/fs/mod.rs`: 0 → 13 / 18
- `library/std/src/os/unix/fs.rs`: 18 / 77 (unchanged count; markers kept)
- `library/std/src/os/fd/owned.rs` 4 / 46, `sys/fd/unix.rs` 2 / 52, `sys/pal/unix/mod.rs` 2 / 14,
  `sys/helpers/small_c_string.rs` 2 / 4, `sys/io/is_terminal/isatty.rs` 1 / 1 (all new)
- `bun scripts/coverage.ts --check`: `markers ok (24896; vendor 5311; library 715)`.

## Verification
- `bunx tsc --noEmit -p .`: clean.
- `bun test src/std src/miri/shims`: 196 pass / 0 fail / 0 skip (src/std/fs.test.ts: 11 tests, none skipped on the root
  host; they check against `node:fs`'s `stat`/`opendir` and run in a `mkdtemp` directory that is removed afterwards).
- miri-pass-heavy, whole suite with `--jobs 1` (run `mhfs-heavy-all`): **8/8 MATCH** (5 protected + the 3 targets).
- Samples (`--sample 200 --jobs 6`):
  - miri-pass: 195 MATCH, 1 DIFF, 3 UNPORTED, 1 UNSTABLE (run `mhfs-s200-miri-pass`). The 5 non-MATCH rows are the gate's known ones (`tests/panic/mir-validation.rs` JS stack, `tests/panic/panic1.rs` UNSTABLE, `socket*.rs` TcpSocket, `intrinsics-x86-aes-vaes.rs` aes); none is protected
  - run-pass-miri: 200/200 MATCH (run `mhfs-s200-run-pass-miri`)
  - miri-fail: 200/200 MATCH (run `mhfs-s200-miri-fail`)
- No test program left files behind. The harness gives each heavy case its own `MIRI_TEMP`, and the cases remove
  their own files.

## For root
- The 4 gate-suite cases and the 2 miri-fail cases should turn MATCH in the next gate. The protected set grows only
  through `gate.ts accept`.
- `src/std/time.ts`: optional `Timespec` / `SystemTime::new` export (above).
