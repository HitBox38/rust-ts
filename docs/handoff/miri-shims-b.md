# Handoff: lane `miri-shims-b` (M6 wave 37: Miri shims files, io_error, time, math, backtrace, cpu_affinity, sig)

Branch `t3/port-miri-shims-b` (worktree `t3-1f72eda4`), on top of main `ccf5dc4a`. Commits: 7c64e53a (port), 3658f2dc (tests),
1bc6dd88 (two trait-declaration markers), and the handoff commit.

## Files touched

- Ported (this lane's): `src/miri/shims/{files,io_error,time,math,backtrace,cpu_affinity,sig}.ts`. All their
  `stub_*` placeholders are gone.
- New tests: `src/miri/shims/{files,io_error,time,cpu_affinity,sig}.test.ts`.
- Small edits allowed by the brief:
  - `src/miri/machine.ts`: imports `MAX_CPUS` directly, so the `cpu_affinity_MAX_CPUS()` stand-in and the `layout_cx`
    cast are gone.
  - `src/miri/bin/miri.ts`: imports `MAX_CPUS` from `../shims/cpu_affinity.ts`, so the `unported` stand-in is gone.
  - `src/miri/bin/miri.test.ts`: the pending `-Zmiri-num-cpus` test is replaced with the oracle's range error, for
    both 0 and 1025.
- **Outside the brief, root please review:** `src/miri/contract.test.ts` "placeholders" test. It hard-coded
  time.rs's `clock_gettime` stub as its sample and required `> 100` stubs, so porting time.rs broke it by
  construction (every wave-37 lane lowers the count). It now samples any still-installed `InterpCx` placeholder and
  requires `> 0`. The checks themselves are unchanged (unported message format, path, lane). Other lanes may have
  edited the same lines.

## Verify

| check | result |
|---|---|
| `bunx tsc --noEmit -p .` | 0 errors |
| `bun scripts/coverage.ts --check --offline` | markers ok (24084; vendor 5050; library 506) |
| `--missing` | files 77/77, io_error 14/14, time 18/18, math 1/1, backtrace 5/5, cpu_affinity 7/7, sig 8/8 (130/130) |
| codegen set `miri` (`bun tools/codegen/types.ts miri`) | regenerates with no diff (report: unknown 0, missing debug 14, missing clone 2) |
| `RUST_TS_REQUIRE_PROBES=1 bun test ./src ./tools` | 6749 pass, 1 skip, **8 fail** (558 files, 2,127 s). None is in src/miri: 7 are bun's 5 s timeouts (odht `quickchecks` ×6 and the odht oracle `build`), 1 is `rmeta_fxmap.oracle.test.ts` fx9. The run overlapped other sessions' unit steps, which share `$RUST_TS_DATA/tmp`. Re-run alone, the 4 files pass (139 pass, 0 fail). **Root: re-run on an idle machine** |
| `bun test ./scripts ./harness` | 136 pass, 0 fail |
| `bun test src/miri/shims/` | 25 pass (the new tests) |
| `difftest --suite mir --sample 100` (agent miri-shims-b) | MATCH 100/100 (run 20261102-120105-miri-shims-b-pfij) |
| `difftest --suite miri-hello`, before (main ccf5dc4a) | UNPORTED: `miri::shims::cpu_affinity::MAX_CPUS (not ported yet; lane miri-shims-b)` (run …-i4hb) |
| `difftest --suite miri-hello`, after | UNPORTED: `miri::shims::tls::TlsData (impl Default; lane miri-shims-a)::default` (run …-kdvx). The machine is now built past `MAX_CPUS` / `FdTable::init` |
| `miri-diff harness/corpus/miri/hello.rs`, before and after | identical: the port stops at record 0 with exit 70, `MIRI_LOG directive miri=info enables INFO for a target whose INFO events are not converted`. That is the root decision on `INFO_CONVERTED_TARGETS` (miri-wire L2), so `miri-diff` cannot show a first difference on hello until it is widened |

## Unit tests (what they pin)

- **io_error.test.ts**
  - `UNIX_ERRNO_TABLE`'s names are upstream's, parsed from io_error.rs.
  - `LIBC_ERRNO_LINUX_GNU` equals the **oracle Miri's** values for x86_64-unknown-linux-gnu. Source: the pinned Miri
    in `$RUST_TS_DATA/rustup-miri`, Miri sysroot, running a program that prints `libc::<NAME>` for all 78 names.
    The output is embedded in the test. The program is `$RUST_TS_DATA/tmp/shims-b/errno.rs`:
    `#![feature(rustc_private)] extern crate libc; fn main() { print!("E2BIG={} ", libc::E2BIG); ... }`.
  - The host table equals `node:os` errno constants for every name Node has. On macOS, ENOTRECOVERABLE, EOWNERDEAD
    and ESOCKTNOSUPPORT are missing there.
  - `LIBC_ERRNO_APPLE` equals the libc-0.2.189 source, when it is unpacked in `~/.cargo`.
  - host → target errno by name: EAGAIN 35 → 11, ENOTSUP 45 → 95, and others.
  - target → host errno: 11 → 35.
  - The kind-only path: `ErrorKind::WouldBlock` → EWOULDBLOCK.
  - `into_ntstatus`.
- **files.test.ts**
  - `FdTable::init`: 0/1/2 = stdin/stdout/stderr, ids 0/1/2; muted gives NullOutput.
  - Allocation order:
    - the lowest free fd ≥ min, with gaps reused;
    - `insert_with_min_num` skips a solid block;
    - dups share the description id;
    - ids are never reused;
    - keys are walked in order even though the Map's insertion order differs.
  - The Rc protocol:
    - clone, upgrade and drop counts;
    - the drop glue runs once, on the last drop;
    - a weak ref sees `is_closed`;
    - a double drop or a use after drop panics.
  - `downcast`: it moves the handle on a match and drops it on a mismatch.
  - The provided methods' messages.
- **time.test.ts** (virtual clock, isolation on)
  - `clock_gettime(CLOCK_MONOTONIC{,_COARSE})` after 200,001 ticks = `[1, 5000]`.
  - An unknown clock gives EINVAL / -1.
  - `read_timespec` bounds.
  - `nanosleep`'s deadline = virtual now + duration (15,000 ns + 2 s + 500 ns); an invalid timespec gives EINVAL.
  - `clock_nanosleep` flag and clock handling, with the messages.
  - `system_time_to_duration` before the epoch.
- **cpu_affinity.test.ts**
  - `MAX_CPUS` = 1024 and 128 mask bytes.
  - Little-endian u64 layout (x86_64-linux).
  - Big-endian u32 / u64 layout.
  - CPUs out of range are ignored.
  - `chunk size not supported`.
  - `from_array` masking.
- **sig.test.ts**: the `shim_sig` spellings, `...`, unsupported types; the argument-count, c-variadic and
  `check_varargs` messages.

## `unported(...)` left

- time.ts `localtime_r`: chrono / chrono-tz (plan-m6 D5). Reached only with isolation off; the arguments are read first.
- files.ts:
  - `FileHandle` read / write / seek / metadata / is_terminal, `DirHandle` metadata, `open_file_or_dir`: host
    `std::fs` (isolation off, D14).
  - `FileHandle`'s readable/writable EBADF checks are ported.
  - `DirHandle` read / write (EISDIR / EBADF) are fully ported.
- files.ts `ReadinessWatched: Drop` (shims-c). The drop glue of Stdin, Stdout, Stderr and NullOutput calls
  `watched.drop()`, which stops until shims-c ports `impl Drop for ReadinessWatched` under the name `drop`. It is
  reached only when fd 0/1/2's last handle is dropped, e.g. `close(1)`.
- io_error.ts `UNIX_ERRNO_TABLE` on unix hosts other than darwin and linux x64/arm64.
- math.ts: the host libm failing to load (as in host_libm.ts).

## `// PORT:` decisions

1. **Rc representation (files.ts header).** This is the contract other lanes code against; the wave-37 lanes were
   told by message.
   - Each `FileDescriptionRef` object is one owned strong handle.
   - The strong count is in a module `WeakMap` keyed by the shared `FdIdWith` box.
   - `clone()` adds one; `drop()` releases one. Moving a handle = passing it.
   - At 0, the inner value's optional `drop_glue()` runs (`drop_in_place`).
   - Released handles panic when used again.
   - `WeakFileDescriptionRef._0` is the box (cast from the generated `Pending1`).
   - `FdTable.get` returns a clone (callers must `.drop()` it); `remove` hands back the table's handle.
   - **Consequence:** a lane that forgets a `.drop()` where Rust drops a ref keeps descriptions alive. That only
     shows in `is_closed`/`upgrade` (epoll, blocking_io) and in drop glue.
2. **`self: FileDescriptionRef<Self>` methods** (`read`, `write`, `as_unix`):
   - They take a leading `self_` parameter; `this` is the description.
   - The callee owns `self_`: my implementations drop it after use (Rust drops it at the end of the fn).
   - `as_unix` returns it (a move), through a cast to `FileDescriptionRef<UnixFileDescription>`. The stdio
     `UnixFileDescription` impls (unix/fd.rs:102-105) are shims-d's.
3. **`downcast(is_T)`**: an exact type test; it consumes the handle (`into_rc_any` + `Rc::downcast(..).ok()`).
4. **`FileDescription_provided`**:
   - The trait's default methods; implementors copy the ones they don't override.
   - `FileHandle` / `DirHandle` are generated interfaces, so their impls are the tables `FileDescription_FileHandle`
     / `FileDescription_DirHandle`, which miri-fs installs.
5. **Host stdio (D14)**:
   - fds 0/1/2 go through `node:fs` `readSync` / `writeSync` (one read(2)/write(2) each; EAGAIN is retried, as in
     src/std/io.ts).
   - std's buffering is reproduced: `Stdin`'s 8 KiB `BufReader` (with the large-read bypass), and `Stdout`'s 1 KiB
     `LineWriter` (`LineWriterShim::write` + `flush_buf`), whose buffer is empty at every Miri write.
   - `handle_ebadf` comes from src/std/io.ts.
   - A failed stdout flush panics with ``called `Result::unwrap()` on an `Err` value: {err:?}`` (upstream
     `.unwrap()`).
6. **`IoError`**:
   - A companion `IoError` holds the variant constructors and `into_ntstatus`.
   - The `From` impls are the fns `IoError_from_io_Error` / `_ErrorKind` / `_Scalar`.
   - `err: impl Into<IoError>` parameters take an `IoError`.
   - `try_unwrap_io_result(result, from_i32)`: the `T: From<i32>` conversion is passed in. **Signature change.**
7. **`io::Error::from(ErrorKind)` (`ErrorData::Simple`)**:
   - src/std/io.ts has no `Simple` repr, so the stand-in is a `SimpleMessage` with `kind.as_str()`.
   - `kind()`, `raw_os_error()` and Display are exact, so the errno mapping is exact.
   - Debug differs (`Kind(X)` upstream). **Root:** add `Simple` to src/std/io.ts.
8. **Host errno table** (io_error.ts header): libc-0.2.189 values for an Apple host or a glibc x86_64/aarch64 host,
   selected by the host platform; checked by tests.
9. **sig.ts macros**:
   - `shim_sig(abi, [types], ret)`, `shim_varargs(...types)`, `shim_sig_args_sep`, `shim_sig_arg`.
   - The macro's type tokens are written as strings (header).
   - `const N` is a trailing `n` on `check_shim_sig_deprecated` / `check_shim_sig_llvm_intrinsic`. **Signature
     change.**
   - `check_shim_sig` / `check_varargs` take N from the signature.
   - `ShimSigFn` / `ShimVarargsFn` replace the `Pending<"fn(..)">` parameter types.
10. **math.ts host libm**:
    - All 38 float ops are host libm imports of the pinned Miri binary (`nm -u`); `acosh` / `asinh` are
      `cmath::acosh{,f}` at this pin, not Rust code.
    - They are opened with bun:ffi from `host_libm_path()`, with this file's own symbol table, because
      host_libm.ts is not this lane's. Root may merge the tables.
    - `lgamma{f}_r` passes an `Int32Array` for `signgamp`.
11. **cpu_affinity.ts**:
    - `LayoutOfCx` is an InterpCx or the machine's `LayoutCx`.
    - `chunk_size` returns a number (a type size).
    - `set` writes the bit into the byte for the target's endianness; this is equivalent to the
      `from_{le,be}_bytes | 1 << offset` round trip.
    - `as_slice` is `readonly number[]` (the generated byte array).
12. **C10 trap, root please fix at the source.**
    - helpers.ts assigns five `MiriMachine.prototype` methods at load (helpers.ts:1297-1328:
      `current_user_relevant_span`, `caller_span`, `stack`, `top_user_relevant_frame`, `user_relevance`).
    - So a module in machine.ts's import graph that value-imports helpers.ts makes helpers run before
      `MiriMachine` exists: a TDZ in every `lib.ts` load.
    - files.ts and cpu_affinity.ts (both imported by machine.ts) therefore read helpers lazily (a `require` at call
      time, `PORT(C10)`).
    - The proper fix is `port_methods` for those five in helpers.ts (C10). The wave-37 lanes were warned.
13. **Scalar equality** (time.ts `scalar_eq_int`): `clk_id == eval_libc(..)` is the derived `PartialEq` with an
    integer right side.
14. **time.ts `Os` values**: `{ $: "Windows" }` / `{ $: "MacOs" }` literals for `assert_target_os`.

## Contract changes (declared signatures others call)

- `FileDescription`:
  - `read` / `write` / `as_unix` gain `self_`.
  - `seek` takes the `SeekFrom` stand-in (exported from files.ts).
  - `metadata` returns `Either<Result<Pending<"fs::Metadata">, io_Error>, string>`.
  - New optional `drop_glue`.
- `FileDescriptionRef`:
  - New: `clone`, `deref`, `eq`, `drop`, `visit_provenance`, `into_rc_any`.
  - `downcast(is_T)`.
- `FdTable`:
  - New: `visit_provenance`.
  - `insert_new(fd: FileDescription)`; `new_ref<T extends FileDescription>`.
- `write_to_host(file: HostWrite, ..)`; `read_from_host(read_cb: (buf: Uint8Array) => Result<number, io_Error>, ..)`.
- `check_shim_sig_deprecated(.., n)`, `check_shim_sig_llvm_intrinsic(.., n)`, `check_shim_sig(shim_sig: ShimSigFn, ..)`,
  `check_varargs(tys: ShimVarargsFn, ..)`.
- `try_unwrap_io_result(result, from_i32)`.
- `CpuAffinityMask`:
  - `chunk_size(cx): number`; `as_slice(): readonly number[]`; `from_array(.., bytes: readonly number[])`.
  - `CPU_MASK_BYTES` static.
- New exports:
  - io_error.ts: `LibcError`, `WindowsError`, `HostError`, `Raw`, `IoError` (companion), `IoError_from_*`,
    `UNIX_ERRNO_NAMES`, `LIBC_ERRNO_APPLE`, `LIBC_ERRNO_LINUX_GNU`.
  - files.ts: `FileDescription_provided`, `FileDescription_FileHandle`, `FileDescription_DirHandle`,
    `FileDescriptionExt`, `DropGlue`, `HostWrite`, `SeekFrom`.
  - sig.ts: `shim_sig`, `shim_varargs`, `shim_sig_args_sep`, `shim_sig_arg`, `ShimSigFn`, `ShimVarargsFn`.
  - cpu_affinity.ts: `MAX_CPUS`, `LayoutOfCx`.

## For root

- lib.ts re-exports (upstream prelude):
  - `MAX_CPUS` (lib.ts:199 comment);
  - `pub use self::IoError::*` (`LibcError` & co.);
  - `shims::sig::{ShimSig, Varargs}`, if lib.rs has them.
  - bin/miri.ts then imports `MAX_CPUS` from lib.ts.
- src/std/io.ts: `ErrorData::Simple` (decision 7) and a `SeekFrom` home (decision 1 note).
- helpers.ts `port_methods` (decision 12).
- shims-a builds its own `shim_sig(abi, SigTy[], SigTy)` in foreign_items.ts. Its handoff asks root to rewrite those
  ~35 call sites to this lane's string form after the merge.
- shims-d made `t3/miri-shims-d-on-shims-b` (ee5993d6). It merges 3658f2dc and adapts unit/fd, poll, linux and
  intrinsics to this API: tsc 0, `bun test src/miri` 188 pass. It installs `UnixFileDescription_provided` on the
  stdio prototypes. shims-c's readiness.ts ports `ReadinessWatched.prototype.drop()` (the name files.ts calls) and
  follows the Rc protocol.
- shims-e's handoff lists pending-contract blocks in linux_like/mod.ts that go away once this branch merges.
- `display_CanonAbi` stops `unported` (rustc_abi; `ExternAbi::as_str` not ported), so an ABI-mismatch message in
  sig.ts stops until that lands. Only programs with a wrong shim ABI reach it.
