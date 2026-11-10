APPROVE WITH NITS

# Review: lane `miri-host-fs` (independent reviewer)

Reviewed: branch `t3/miri-host-fs` at `eaf28904`, diff `1b4bf086...eaf28904` (6 files, +1862/-147), against the pin's
`library/std/src/{fs.rs, sys/fs/unix.rs, sys/fs/unix/dir.rs, sys/fs/mod.rs, sys/fd/unix.rs, sys/pal/unix/{mod,time}.rs,
sys/time/unix.rs, os/fd/owned.rs, os/unix/fs.rs}`, Miri's `src/shims/files.rs` and `src/shims/unix/fs.rs`, and plan-m6 D14.
All runs were made on the root host (aarch64-apple-darwin, AC power, load 18-38) with `RUST_TS_AGENT=review-mhfs`,
`RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`, `RUSTC_ICE=0`, from this worktree checked out at `eaf28904`.

No must-fix findings. Every constant and layout matches the SDK, every ported fn matches upstream in order and logic, the
variadic workaround is ABI-correct for every call it is used in, the drops match Rust's on every non-terminal path, and all
six claimed cases MATCH on every repeat. The nits are a missing marker, the handoff's cleanup claim, terminal-path drops in
`closedir`, and test strength.

## Evidence

| check | result |
|---|---|
| `bunx tsc --noEmit -p .` | clean (exit 0) |
| `bun scripts/coverage.ts --check` | `markers ok (24896; vendor 5311; library 715)` |
| `bun test src/std/fs.test.ts src/miri/shims` | 144 pass, 1 fail: `io_error.test.ts` "UNIX_ERRNO_TABLE names" needs `RUST_TS_DATA` in the env (bun test does not load `.env.local`), a file this lane did not touch. Re-run with `.env.local` sourced: `io_error.test.ts` + `src/std/fs.test.ts` + `src/miri/shims/unix/fs.test.ts` 26/26 pass |
| target cases, 3 runs each, heavy ones alone with `--jobs 1` | 18/18 MATCH: `rv-mhfs-open-{1,2,3}`, `rv-mhfs-iam-{1,2,3}`, `rv-mhfs-rtm-{1,2,3}`, `rv-mhfs-heavy-{issue-miri-3680,shims_fs-permissions,shims_fs_rs}-{1,2,3}` |
| target cases in the gate's binary subject mode (`RUST_TS_SUBJECT=binary`) | 6/6 MATCH, `summary.json` mode `binary` (`rv-mhfs-bin-{open,iam,rtm,3680,perm,fs}`) |
| `--sample 200 --jobs 6` miri-pass (`rv-mhfs-s200-miri-pass`) | 198 MATCH, 1 UNPORTED (`intrinsics-x86-aes-vaes.rs`, aes not vendored), 1 UNSTABLE (`tests/panic/panic1.rs`, same row as gate-20261110-113508-root-m7vn) |
| `--sample 200 --jobs 6` run-pass-miri (`rv-mhfs-s200-run-pass-miri`) | 200/200 MATCH |
| host fds at subject exit (an `lsof` preload around the real subject command of `shims/fs.rs`, `fs-permissions.rs`, `issue-miri-3680.rs`, `open_a_file_in_proc.rs`) | 7 at start, 7 at exit for each: nothing leaked |
| 5000 cycles of `File::open`+drop, `Dir::open`+`try_clone`+drops, `read_dir`+`next`+drop (scratch script) | `/dev/fd` count 6 before, 6 after |
| `errno` after a failing `stat`, 200,000 times under allocation pressure | 0 wrong |
| `open` mode sweep 0..0o777 step 7 through the 9-argument form | 0 wrong |

### 1. Fidelity

- **Constants and layouts.** A C program built against `xcrun --show-sdk-path` printed every value fs.ts hard-codes. All
  match: `O_RDONLY/WRONLY/RDWR/ACCMODE/APPEND/CREAT/TRUNC/EXCL/DIRECTORY/CLOEXEC` = 0/1/2/3/0x8/0x200/0x400/0x800/0x100000/
  0x1000000; `F_FULLFSYNC` 51, `F_DUPFD_CLOEXEC` 67; `LOCK_*` 1/2/4/8; `SEEK_*` 0/1/2; `AT_FDCWD` -2,
  `AT_SYMLINK_NOFOLLOW` 0x20; `S_IF*` and `DT_*`; `EINTR` 4; `UTIME_OMIT` -2; `ATTR_BIT_MAP_COUNT` 5,
  `ATTR_CMN_{CRTIME,MODTIME,ACCTIME}` 0x200/0x400/0x1000, `FSOPT_NOFOLLOW` 1. `sizeof(struct stat)` 144, `timespec` 16,
  `attrlist` 24. `struct stat` offsets: dev 0 (i32), mode 4 (u16), nlink 6 (u16), ino 8, uid 16, gid 20, rdev 24, the four
  timespecs at 32/48/64/80, size 96, blocks 104, blksize 112 (i32), flags 116, gen 120, which is exactly `read_stat`
  (fs.ts:238). `struct dirent`: d_ino 0, d_type 20, d_name 21. `attrlist`: bitmapcount 0 (u16), commonattr 4 (u32). The
  symbol names `open`, `openat`, `fcntl`, `fstat`, `stat`, `lstat`, `fstatat` are what the libc crate links on aarch64 (no
  `$INODE64` or `$NOCANCEL` variants there). `setattrlist`'s last parameter is `unsigned int` under LP64 (SDK unistd.h:764),
  declared `u32`.
- **Widenings.** `dev()` and `blksize()` sign-extend an `i32` to `u64` (`BigInt.asUintN(64, BigInt(i32))`), as Rust's
  `as u64` does; `size()`/`blocks()` reinterpret `i64` as `u64`; `seek` casts `Start(u64)` to `i64` and the result back.
- **Functions, against the pin.** `cvt`/`cvt_r`, `run_path_with_cstr`/`run_with_cstr`, `OwnedFd::{drop, try_clone,
  try_clone_to_owned}`, `File::{open, open_c, file_attr, fsync, datasync, os_fsync, os_datasync, lock, lock_shared, try_lock,
  try_lock_shared, unlock, truncate, read, write, seek, tell, duplicate, set_permissions, set_times}`,
  `FileDesc::{read, write}` with `READ_LIMIT = c_int::MAX` (sys/fd/unix.rs:80 for Apple), `file_time_to_timespec` (the
  too-large/too-small arms cannot fire because Apple's `time_t` is i64, as the PORT note says), `TimesAttrlist` (order:
  created, modified, accessed), all of dir.rs's `Dir` methods used, `ReadDir::next` (the `set_errno(0)` / `readdir` arm,
  `.`/`..` skipped), `DirStream::drop` (the `closedir` assertion), `DirEntry::{metadata, file_type, ino, file_name}` (Apple's
  dirfd + `fstatat(AT_SYMLINK_NOFOLLOW)` arm), `readdir`, `unlink`, `rename`, `set_perm` (`chmod`, `cvt_r`), `rmdir`,
  `readlink` (Vec's growth `max(2*cap, cap+1, 8)` for bytes), `symlink`, `link` (`linkat(AT_FDCWD, .., 0)`), `stat`,
  `lstat`, `set_times_impl` (Apple's `setattrlist` arm), sys/fs/mod.rs's dispatchers, `OpenOptions::{get_access_mode,
  get_creation_mode}` (both `io::Error::new`, so `Custom`, as upstream), `Timespec::new`'s Apple correction, and the std
  newtypes. Logic, order and arguments match. `coverage.ts --check` confirms every marker names an fn at its line.
- **Miri side.** `open_file_or_dir` (files.rs:706), `FileHandle::{read, write, seek, metadata, is_tty}`,
  `DirHandle::metadata` (the `not(bootstrap)` arm) match files.rs:432-530. The `cfg(windows)` retry is an `unported` stop,
  placed after the open; on Windows fs.ts stops earlier anyway.
- **Errors.** Error kinds come from `io_error_from_raw_os_error` on the host errno; the NUL message, the three
  `OpenOptions` messages, `"invalid timestamp"` (`InvalidData`, `SimpleMessage` as `const_error!`) and the closedir assertion
  text match upstream.

### 2. The variadic workaround

It is ABI-correct. Apple arm64 passes every variadic argument on the stack in its own 8-byte slot, and `va_arg` reads the
first one at the caller's `sp`. Declaring the function with 8 register parameters (named ones plus `i64` padding) and an
`i64` ninth parameter puts the value at `[sp, #0]` as 8 bytes under both Apple's and plain AAPCS64 rules for a non-variadic
ninth argument, so it does not depend on which rule Bun's TinyCC trampoline follows. Per use:
- `open(path, flags, mode)`: x0 ptr, x1 int, x2-x7 padding, mode at `[sp]`. `va_arg(ap, int)` reads the low 32 bits of the
  little-endian `i64`, so `opts.mode_ | 0` (a `mode_t` promoted to `int`, already masked to 16 bits) arrives exactly.
- `openat(fd, path, flags, mode)`: x0-x2 named, x3-x7 padding, mode at `[sp]`.
- `fcntl(fd, F_DUPFD_CLOEXEC, 3)`: x0-x1 named, x2-x7 padding, 3 at `[sp]`. `fcntl(fd, F_FULLFSYNC)` takes no argument;
  the extra zero slot is ignored.
- No pointer is ever passed variadically.

My scratch probe confirms both halves: the 9-argument `fcntl(fd, F_DUPFD_CLOEXEC, min)` returned exactly `min` for
min = 200, 777, 1000 (and the lowest free fd for 3), while a 3-argument declaration returned -1 (EINVAL, garbage minimum)
every time; a 3-argument `open(.., 0o640)` created a file with mode `0o140`, as the handoff says.

What fails loudly if a future Bun changes this: only the unit test "open passes the mode through the variadic argument",
which the gate's unit step runs. Nothing checks it at run time, and the subject-bin key includes `Bun.version`, so a Bun
upgrade reaches the gate's unit step first. The test is sound for `open`/`openat`: it uses three different modes, so
stale stack contents left by the previous call would show as a wrong mode. It does not cover `fcntl`'s variadic slot (N3).
The case where it would silently pass a wrong value: a lost `F_DUPFD_CLOEXEC` minimum. With fds 0-2 open, a minimum of 0
(or any small garbage) still returns the lowest free fd, which is ≥ 3, so fs.test.ts:271's `>= 3` passes. In a subject
whose fd 0, 1 or 2 is closed, `try_clone` would then hand out a stdio number, unlike std.

### 3. Resources

Every path matches Rust's implicit drops except two terminal ones (N2):
- `OwnedFd::drop` marks the value dead before `close`, and every use goes through `as_raw_fd()`, which panics on a dead
  value: a double close cannot happen silently. `self_metadata` and `DirEntry::metadata` wrap the borrowed fd in a
  non-owning `OwnedFd` that is never dropped, as upstream's `ManuallyDrop`. `into_owned_fd` moves the fd out (`take`).
- `FileHandleDesc`/`DirHandleDesc.drop_glue` run when the last `FileDescriptionRef` goes (files.ts `drop_in_place_inner`);
  `close` (unix/fd.ts:223) releases the table's ref. At this pin `FileHandle` has no `destroy`, so Rust's close is just that
  drop. `FileHandle::read`/`write` drop `self` after `finish` and on the `?` path, as Rust does at fn exit.
- `open`: `dirfd` in a `finally`; `dir`/`file` dropped in the `EISDIR`, `ENOTDIR` and `ELOOP` arms (Rust drops them after
  `set_errno_and_return_neg1_i32` returns; the TS captures the result first, so the order matches). `opendir`: `read_dir`
  dropped before the `throw_unsup_format`. `closedir`: the host `ReadDir` dropped on success.
- Measured: no fd left behind by any target case (table above), none after 5000 open/clone/drop cycles.
- Tests: `src/std/fs.test.ts` works in a `mkdtemp` dir removed in `afterAll`; nothing named `rust-ts-fs-test-*` was left
  in the temp dir after the runs, and the worktree stayed clean.

### 4. Determinism and host dependence

All 18 target runs MATCH, each heavy case run alone. None of the six prints a timestamp, an inode or a `read_dir` order:
`shims/fs.rs` asserts them inside the program (inode equality at tests/pass/shims/fs.rs:766, the `read_dir` listing
collected into a `BTreeMap` at :504-517), so the outputs are fixed text. Pre-epoch times round-trip exactly through `set_times` + `metadata().modified()` (-0.1 s, -1.5 s, -1 s,
-1e9 s - 1 ns: the values read back equal the values set, and node's `mtimeNs` agrees), which exercises the Apple
correction in `SystemTime_new`. The cases write only under `utils::tmp()` = the harness's per-case `MIRI_TEMP`.
`shims/fs.rs` calls `set_current_dir(MIRI_TEMP)` (tests/pass/shims/fs.rs:273) and then uses a relative path; Miri's `chdir`
goes through src/std/env.ts `set_current_dir` (real `chdir`), and the later libc calls resolve against the process cwd, so
that works, and it does not depend on the cwd D14 fixes (`MIRI_CWD` is the miri dir; nothing is read relative to it).

### 6. Samples and tests

See the table. The `src/miri/shims/unix/fs.test.ts` change is honest. The old check (`std_fs.metadata("x")` throws
`Unported`) became false on the root host, and it still runs on any other host. The new root-host check
(`metadata("\0")`) does not reach libc, but the host answers are checked in `src/std/fs.test.ts` (11 tests, against
`node:fs`'s own `stat`/`opendir`/`readlink`), which the new test name points to. The `next_host_entry` assertion is
unchanged (it still throws, now because there is no host `ReadDir` in that test).

## Findings (must fix)

None.

## Nits

- **N1** src/std/fs.ts:294 `FileAttr.from_stat64` is a ported fn without a marker. It is upstream's
  `library/std/src/sys/fs/unix.rs:520 from_stat64` (the `else` arm of `cfg_has_statx!`, which Apple takes); add
  `// std: library/std/src/sys/fs/unix.rs:520 from_stat64`. `coverage.ts --missing library/std/src/sys/fs/unix.rs` still
  lists it.
- **N2** src/miri/shims/unix/fs.ts:1989, 1993, 1999 (`closedir`). Once `open_dir` is removed from `dirs.streams`, Rust drops
  it on every exit, including the `throw_ub_format!` (backing FD tampered), the `this.close(..)?` and the
  `deallocate_ptr(..)?` returns, so the host `closedir` runs before the error propagates. The TS drops the host `ReadDir`
  only on the success path. All three are terminal (UB or an interpreter error ends the run), so the leaked `DIR*` cannot
  show in any output. Fix for fidelity: drop `open_dir.read_dir` before each of those returns (or wrap the tail in
  `try`/`finally`, as `open` does).
- **N3** src/std/fs.test.ts:271. The only check of `fcntl`'s variadic slot is `try_clone`'s fd `>= 3`, which also holds
  when the minimum is lost (see §2). Add a direct check with a high minimum, e.g. a test-local `dlopen` of `fcntl` with the
  same 9-argument shape calling `F_DUPFD_CLOEXEC` with 200 and expecting exactly 200 when it is free (my probe does this),
  or route the minimum through a test hook.
- **N4** docs/handoff/miri-host-fs.md, Verification. "the cases remove their own files" is not quite right. `shims/fs.rs`
  leaves `miri_test_fs_{flock,pread_pwrite,readv_writev,preadv_pwritev}.txt` and `miri_test_directory_handle/file.txt`,
  and `fs-permissions.rs` leaves `miri_test_{fs,file}_set_permissions.txt`, in its `MIRI_TEMP`. That is upstream's design
  (the tests never delete them; `utils::prepare` deletes a stale file at the start of the next run) and the oracle leaves
  the same files, so nothing changes in the code; correct the sentence.
- **N5** src/std/fs.ts:524. `truncate`'s `io::Error::new(InvalidInput, TryFromIntError)` is stored as a `Custom` with the
  Display text, so its `{:?}` would print `error: "out of range integral type conversion attempted"` where std prints
  `error: TryFromIntError(())`. It cannot be reached: Miri's `ftruncate64` reads an `off_t` (i64), and its `try_into::<u64>`
  passes only values ≤ i64::MAX (unix/fs.rs:1623). Add a `// PORT:` saying the Debug text differs and why it cannot show.
- **N6** src/std/fs.ts:171 `cvt`. Reading `errno` relies on no JS-side syscall failing between the FFI return and the
  `read.i32` (GC and allocator work on the main thread). 200,000 failing `stat`s under allocation pressure gave 0 wrong
  errnos, so this holds in practice; the existing PORT comment could say that the window is JS-only (no FFI call) and was
  measured.

## Item 5: `SystemTime::new` (advice to root)

**The current value is exact.** `SystemTime_new` (fs.ts:266) applies `Timespec::new`'s Apple correction with the same
bounds (`tv_sec <= 0 && tv_sec > i64::MIN && -1e9 < tv_nsec < 0`), the same range check and error
(`InvalidData`, `"invalid timestamp"`, a `SimpleMessage` as `const_error!` makes), then builds the value as
`UNIX_EPOCH ± Duration(|tv_sec|, 0)` followed by `+ Duration(0, tv_nsec)`. With `0 <= tv_nsec < 1e9` the first step gives
`Timespec(tv_sec, 0)` exactly (`checked_{add,sub}_duration` with zero nanoseconds, no carry) and the second adds the
nanoseconds without a carry, so the result is `Timespec(tv_sec, tv_nsec)`, which is what `new_unchecked` stores. The edges
hold: `tv_sec = i64::MIN` subtracts `Duration(2^63, 0)` (a valid u64), reaching exactly `I64_MIN`; `tv_sec = i64::MAX` with
`tv_nsec = 999_999_999` never overflows. The `panic` branch cannot be reached. The pre-epoch round trips in §4 confirm this
on the host.

**Exporting from time.ts is the right fix**, but not as a bare `Timespec` export. Port the two upstream fns into
src/std/time.ts with their markers: `// std: library/std/src/sys/pal/unix/time.rs:47 new` as `Timespec.new` (with the
`cfg(target_vendor = "apple")` correction, gated on the host as fs.ts does now, and `new_unchecked`), and
`// std: library/std/src/sys/time/unix.rs:18 new` as `SystemTime.new`. Then replace fs.ts's `SystemTime_new` with
`SystemTime.new`. That puts the code in the file that owns `Timespec`'s invariants (fs.ts currently depends on `t.t.tv_sec`
being a bigint and `tv_nsec` a number, which only time.ts guarantees), gives the fns markers (fs.ts's copy has none, as
PORTING §3 requires for ported code), and keeps the Apple correction in one place for any later caller. It is a small
time.ts change for a lane that is assigned that file, and it is not urgent: the current value is exact.
