# Handoff: miri-shims-d (M6 wave 37: Miri shims, gate M6a)

Branch `t3/port-miri-unix-intrinsics` (worktree t3-c73c94ba), base main `ccf5dc4a`.
Scope: `shims/unix/fd.rs`, `shims/unix/poll.rs`, `shims/unix/linux/{foreign_items,mem,mod}.rs`, `intrinsics/{mod,math,simd}.rs`,
and the A3 isolation-error path of `shims/unix/socket.rs`.

## Files touched

- `src/miri/intrinsics/mod.ts`, `math.ts`, `simd.ts` (ported; they replace the stubs)
- `src/miri/shims/unix/fd.ts`, `poll.ts`, `socket.ts` (A3 part), `linux/foreign_items.ts`, `linux/mem.ts` (ported).
  `linux/mod.ts` is unchanged: `mod.rs` holds no fns, only `pub mod` declarations.
- Tests (new):
  - `src/miri/intrinsics/intrinsics.test.ts`, with the fixtures `intrinsics.oracle.txt` (real Miri) and `crc32.oracle.txt` (host hardware)
  - `src/miri/shims/unix/fd.test.ts`
- Probe sources (new): `docs/handoff/miri-shims-d-probe/intrinsics.rs` (a Miri-oracle program) and `crc32.rs` (native).

## Verification

- `bunx tsc --noEmit -p .`: 0 errors.
- `bun scripts/coverage.ts --check --offline`: `markers ok (23997; vendor 5050; library 506)`.
- `--missing`:
  - fd.rs 19/19, poll.rs 5/5, linux/foreign_items.rs 2/2, linux/mem.rs 1/1, linux/mod.rs 0/0
  - intrinsics/mod.rs 4/4, intrinsics/math.rs 10/10, intrinsics/simd.rs 1/1
  - socket.rs 1/1 (in-scope part: `socket`; harness/scope.json `miri.partial`)
- Codegen: `bun tools/codegen/types.ts miri` regenerates with no diff.
- `RUST_TS_REQUIRE_PROBES=1 bun test ./src ./tools`: see "Unit step" below.
- `bun test ./scripts ./harness`: see "Unit step" below.
- `bun scripts/difftest.ts --suite mir --sample 100` (agent `miri-shims-d`): see "Unit step" below.
- miri-hello, before (HEAD `ccf5dc4a`, temporary worktree) and after: identical.
  - difftest gives `UNPORTED` at `miri::shims::cpu_affinity::MAX_CPUS (lane miri-shims-b)`, during machine setup and before any code of this lane runs.
  - `bun scripts/miri-diff.ts harness/corpus/miri/hello.rs` gives `port 0 of 22954 records`. The port exits 70 on the queued L2 item: the `MIRI_LOG` directive `miri=info` names a target whose INFO events are not converted yet (wave-36 decision L2).
  - So miri-hello cannot move until shims-a/b/c are integrated and L2 is resolved.
- Unit tests of this lane: `bun test src/miri/intrinsics src/miri/shims/unix/fd.test.ts` 12 pass. `bun test src/miri` all pass (163).

### Unit tests

- **Intrinsic float math against the Miri oracle.**
  - Oracle: the isolated Miri (D1) running `intrinsics.rs` with `-Zmiri-deterministic-floats` (target x86_64-unknown-linux-gnu, host aarch64-apple-darwin; 25 s user). It prints 1,867 lines covering:
    - `sqrtf16/32/64/128`
    - the generic `sin cos exp exp2 log log10 log2` at f16/f32/f64
    - `powf16/32/64` over 18×18 inputs
    - `powif16/32/64` over 18 inputs × 7 exponents
    - `simd_fsqrt fsin fcos fexp fexp2 flog flog2 flog10` on f32x4, and `simd_fsqrt fsin flog` on f64x2
  - The inputs include ±0, ±inf and NaN. With deterministic floats, `generate_nan` returns the canonical NaN, so NaN results are compared bit for bit too.
  - Harness: `emulate_intrinsic_by_name` runs on a stand-in `ecx`. That is `InterpCx.prototype` with a `MiriMachine` that has `float_nondet = false`, plus operands that hold one `Scalar` or SIMD lanes.
  - So everything after `read_scalar` is the port's own code: the dispatch, `check_intrinsic_arg_count`, fixed values, host ops, `adjust_nan` → the machine's `generate_nan`, and `write_scalar`.
  - Result: all 1,867 lines match bit for bit.
  - Lines whose result comes from the host libm (everything except sqrt and powi) are checked only on aarch64-apple-darwin, the math.test.ts rule.
  - Mutation check: swapping the `powf` operands, or mapping `simd_fexp2` to `Exp`, fails the test. Both were reverted.
- **`compute_crc32` against hardware.** `crc32.rs` is built with the oracle rustc and calls the host's `crc32{b,h,w,x}` / `crc32c{b,h,w,x}` instructions. These take and return the bit-reversed CRC without inversion, the same convention as x86 `crc32`. Result: 192/192 match, for polynomials `0x104C11DB7` and `0x11EDC6F41`.
- **`sub_word`**: matches FIPS-197 Appendix A.1. **`sigma0` / `sigma1` / `round`**: SHA-256("abc") equals the FIPS 180-4 digest.
- **fd table dup/close semantics** (`fd.test.ts`):
  - Setup: `FdTable` and the errno shims are miri-shims-b's and still placeholders here. The shims therefore run against a test double with upstream `FdTable`'s semantics (files.rs:590-660) and shims-b's refcount protocol.
  - `dup` takes the lowest free number and shares the description.
  - `close` drops one descriptor, and the description closes with its last descriptor; the freed number is reused.
  - `dup2` closes the target and keeps the number; `dup2(fd, fd)` is a no-op.
  - Each of `close` / `dup` / `dup2` on a closed fd gives `EBADF`.
  - Every test also checks that no handle leaks (live handles == table entries).
- **Socket isolation error text.**
  - `Reject(Abort)` (the default) gives `MachineStop(UnsupportedInIsolation("`socket` not available when isolation is enabled"))`. That is the text of the real oracle for `TcpListener::bind`: `error: unsupported operation: `socket` not available when isolation is enabled`, followed by the two `help:` lines.
  - `Reject(NoWarning)` returns -1 with `EACCES`.
  - With isolation off: the flag checks run as upstream, and `TcpSocket::new` stops `unported`.

### Unit step

FILLED IN BELOW after the background run.

## `unported(...)` left

- `intrinsics/mod.ts` `call_llvm_intrinsic`:
  - `unported("x86 intrinsics: wave 38 (miri::intrinsics::x86::EvalContextExt::emulate_x86_intrinsic, plan-m6 D12)")` (lane brief). **Wave 38**: replace it with `this_.emulate_x86_intrinsic(link_name, args, dest)` and `break handled` with its result.
  - aarch64 / loongarch arms: `unported(".. plan-m6 D12: .. unreachable on the target")`.
- `shims/unix/fd.ts` `fcntl`, macOS `F_FULLFSYNC` under isolation: `ErrorKind::PermissionDenied.into()` needs `From<io::ErrorKind> for IoError` (io_error.rs:46). That conversion needs a std `io::Error` holding `ErrorData::Simple`, and src/std/io.ts has no such stand-in. The path is unreachable on the Linux target.
- `shims/unix/fd.ts` `deref` / `drop_fd_ref`, and `shims/unix/poll.ts` `drop_fd_ref`: these stop `unported` until shims-b's `FileDescriptionRef.deref()` / `.drop()` exist (see "Cross-lane contract").
- `shims/unix/poll.ts` `readiness_api(..)`: `Rc_new_ReadinessWatcher` / `Rc_drop_ReadinessWatcher` / `Readiness_EMPTY` stop `unported` until shims-c's readiness.ts exports them.
- `shims/unix/socket.ts`:
  - `TcpSocket::new` (isolation off; plan-m6 D2/A3).
  - `bind listen accept4 connect send recv setsockopt getsockopt getsockname getpeername shutdown`: these stop with the D2/A3 reason and carry no markers (scope.json `miri.partial`).
- Upstream panics, ported as panics (not `unported`): `todo!("f128")` (`powf128`, `powif128`, the f128 arm of the host unary ops) and `unimplemented!("f128")` (simd host ops on f128).

## Cross-lane contract (root: check at integration)

Agreed with miri-shims-b / -e / -c over cross-session messages during wave 37:

1. **`self: FileDescriptionRef<Self>` methods take a leading `self_`** (`FileDescription::read`, `write`, `as_unix`; `UnixFileDescription::as_socket`).
   - The skeleton's `FileDescription` (files.ts) still declares them without it, so fd.ts calls them through `fd_read` / `fd_write` / `fd_as_unix` with casts. Drop the casts once shims-b's files.ts is merged.
   - `as_unix(self_)` returns the same handle (a move).
2. **Strong handles.**
   - `FdTable::get` returns a cloned handle. Inner access is `ref.deref()`, release is `ref.drop()`.
   - fd.ts / poll.ts call `.drop()` exactly where Rust drops a handle that was not moved on. The moves are `insert` / `insert_with_min_num`, `read` / `write` / `as_unix`, `read_from_fd` / `write_to_fd`.
   - Temporaries (`fd.as_unix().flock(..)` and similar) are dropped after their call; early returns drop the local.
3. **`UnixFileDescription` changes.**
   - It is now `interface UnixFileDescription extends FileDescription`, and `as_socket(self_)` takes the ref.
   - `UnixFileDescription_provided` (exported) holds the provided methods.
   - The empty impls for `Stdin` / `Stdout` / `Stderr` / `NullOutput` install them with `port_methods` (C10). shims-e copies them for `Epoll` / `EventFd`.
4. **shims-c readiness API** used by poll.ts:
   - `Rc_new_ReadinessWatcher()`, `Rc_drop_ReadinessWatcher(w)`, `Readiness_EMPTY` (frozen; spread before mutating), and `ReadinessInterest.active_()`.
   - They are read from the readiness.ts namespace at call time, because the skeleton does not declare them. Once shims-c is merged, they can become static imports.
   - Not covered: a blocking-poll callback that is dropped without running (its thread never unblocks) does not release the watcher. Rust drops it with the callback, and the port has no destructor for callbacks.
   - The watcher is also not released on an `InterpError` exit (`?`), since that ends the program.
5. **Local stand-ins for other lanes' undeclared items** (swap them at integration):
   - `intrinsics/mod.ts` `jump_to_next_block`: `EmulateItemResult::jump_to_next_block` (shims/mod.rs:46, lane miri-shims-a), same body as upstream; `T::default()` is passed in as a value. foreign_items.rs:77 (shims-a) needs the same fn.
   - `shim_sig!` / `shim_varargs!` / `shim_sig_arg!` (shims/sig.rs, lane miri-shims-b): `linux/foreign_items.ts` `shim_sig(abi, [types], ret, c_variadic)` and `fd.ts` `shim_varargs_i32` build the closure the macro expands to. The type mapping is the macro's: `*_` = `layouts.void_ptr_mut.ty`, `libc::T` = `path_ty_layout(this, ["libc", T]).ty`.
6. **Signatures this lane changed:**
   - `UnixFileDescription.as_socket(self_)` (item 3).
   - `check_intrinsic_arg_count(args, N)` is exported, for x86 / simd callers.
   - `round(state: readonly number[], wk)`.
   - New export `VisitProvenance_PollInterest`.
   - Every other declared signature is unchanged.

## `// PORT:` decisions

- **Integers:**
  - `usize` lengths in fd.rs are numbers: each one passed `check_ptr_access` for that many bytes, so it is an allocation size (< 2^53).
  - `u64` / `i128` values are bigints (C5).
  - `Iterator::sum::<u64>` wraps (release build).
  - `{:#x}` of an `i32` prints its two's-complement bits.
- **Control flow:**
  - `emulate_math_intrinsic` checks the guard arm `_ if let Some(..) = is_host_unary_float_op(..)` in the `default` branch. That is equivalent: no literal arm after it matches a host-op name, and `is_host_unary_float_op` returns `None` for every other name.
  - `fcntl`'s guarded `match cmd` arms are an if-chain in the same order.
- **Types and representations:**
  - `BTreeMap<FdNum, PollInterest>` is a `Map`: it is only looked up by key, and provenance visiting is order-free.
  - `socket2::Domain::{IPV4, IPV6}` is a string tag; it is only passed on to the unported `TcpSocket::new`.
  - `mod aes` / `mod sha256` are flattened into intrinsics/math.ts under the skeleton's names.
- **Formatting and tracing:**
  - `trace!` sites stay comments. This lane's files have no `info!` sites (docs/handoff/miri-log.md).
  - `Scalar == Scalar` in `ioctl` compares integer scalars by size and bits. A pointer operand stops `unported`; FIOCLEX / FIONCLEX are integers.
- **Lane brief:** the x86 arm uses the brief's `unported` text instead of calling the wave-38 placeholder.

## Probe

- `intrinsics.rs` runs under the isolated Miri:

  ```
  env -i HOME=$HOME PATH=/usr/bin:/bin RUSTUP_HOME=$RUST_TS_DATA/rustup-miri CARGO_HOME=$RUST_TS_DATA/cargo-miri \
    $RUST_TS_DATA/rustup-miri/toolchains/nightly-2026-10-11-aarch64-apple-darwin/bin/miri \
    --sysroot $RUST_TS_DATA/miri-sysroot --target x86_64-unknown-linux-gnu -Zmiri-deterministic-floats intrinsics.rs \
    > src/miri/intrinsics/intrinsics.oracle.txt
  ```

  The file must be copied into a scratch dir first (`$RUST_TS_DATA/tmp/miri-shims-d/`).
- `crc32.rs`:

  ```
  rustc +nightly-2026-10-11 --edition 2021 -O crc32.rs -o crc32 && ./crc32 > src/miri/intrinsics/crc32.oracle.txt
  ```

  It runs on aarch64 hosts only. The fixture itself is host-independent, since it records hardware CRC semantics.
- Queued (harness batch, if wanted): register these probes under `tools/probes`.
