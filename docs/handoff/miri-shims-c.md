# Handoff: miri-shims-c (M6 wave 37: Miri shims → gate M6a)

Branch `t3/port-miri-shims-c`. Scope: Miri's `shims/readiness.rs`, `shims/unix/{foreign_items, env, mod, thread, mem}.rs`.

## Files touched

- `src/miri/shims/readiness.ts`: full port (stubs filled).
- `src/miri/shims/unix/foreign_items.ts`: full port (the unix dispatcher, `sysconf`, `strerror_r`, `is_dyn_sym`).
- `src/miri/shims/unix/env.ts`: full port (`UnixEnvVars`, environ block, getenv/setenv/unsetenv/getcwd/gethostname/chdir/
  update_environ/getpid/unix_gettid/uname/apple_pthread_threadid_np).
- `src/miri/shims/unix/mod.ts`: `UID`, `HOSTNAME`.
- `src/miri/shims/unix/thread.ts`: full port.
- `src/miri/shims/unix/mem.ts`: full port (mmap/munmap/mprotect/madvise).
- `src/miri/shims/unix/shims_c.test.ts` (new): 16 unit tests.
- `docs/handoff/miri-shims-c.md` (this file).

No `.gen.ts`, no other lane's file, no `src/std`, `scripts/`, `harness/` or `tools/` change.

## Verification

- `bunx tsc --noEmit -p .`: 0 errors.
- `bun scripts/coverage.ts --check --offline`: `markers ok (24012; vendor 5050; library 506)`.
- `--missing`: readiness.rs 23/23, unix/foreign_items.rs 4/4, unix/env.rs 18/18, unix/mod.rs 0/0, unix/thread.rs 7/7,
  unix/mem.rs 6/6.
- Codegen: `bun tools/codegen/types.ts miri` regenerates with no diff.
- `bun test src/miri/shims/unix/shims_c.test.ts`: 16 pass.
- `RUST_TS_REQUIRE_PROBES=1 bun test ./src ./tools`: see "Unit step" below.
- `bun test ./scripts ./harness`: see "Unit step" below.
- `bun scripts/difftest.ts --suite mir --sample 100`: MATCH=100 DIFF=0 UNPORTED=0 (run `20261102-115319-root-lb4s`).
- `bun scripts/miri-diff.ts harness/corpus/miri/hello.rs`: before (HEAD `ccf5dc4a`, temp worktree, run `shims-c-before`)
  and after (run `shims-c-after`) are identical: port 0 of the oracle's 22,954 records, exit 70 `unported: RUSTC_LOG/MIRI_LOG
  directive miri=info enables INFO for a target whose INFO events are not converted` (miri-log's INFO_CONVERTED_TARGETS,
  queued as L2 in wave 36). Without tracing (`difftest --suite miri-hello`, run `20261102-115431-root-5d3z`) the port
  stops at `miri::shims::cpu_affinity::MAX_CPUS (lane miri-shims-b)` during machine setup, before any shim of this lane.

### Unit step

UNIT_STEP_RESULT

## Oracle checks (unit tests)

Tiny programs run on the isolated Miri oracle (x86_64-unknown-linux-gnu, Miri's default flags):
`$RUST_TS_DATA/tmp/miri-shims-c/{envorder,getcwd,mmap}.rs` + `run.sh` (sources the plan-m6 `mirienv.sh`; never touches
`~/.rustup`). The outputs are quoted in shims_c.test.ts next to each test:

- **env block layout**: `-Zmiri-env-set=A=1 B=2 CC=3 HOME=/h Z=26` → `std::env::vars()` order HOME, B, A, CC, Z; after
  `set_var("NEWVAR")` + `remove_var("A")`: NEWVAR, HOME, B, CC, Z. The test runs `UnixEnvVars::new` and `update_environ`
  on a stand-in cx and checks the environ block holds exactly these strings in this order, then the trailing NULL.
- **isolation**: `getcwd` under the default isolation gives `unsupported operation: \`getcwd\` not available when isolation
  is enabled` (the test checks the `UnsupportedInIsolation` stop for `getcwd` and `chdir`). Under
  `-Zmiri-isolation-error=warn-nobacktrace` the oracle warns `` `getcwd` was made to return an error due to isolation ``.
  The test checks the warning; the next step (`IoError::from(ErrorKind::PermissionDenied)`) stops `unported` until
  shims-b lands it (below).
- **mmap validation**: EINVAL + MAP_FAILED for MAP_PRIVATE|MAP_SHARED, length 0, and a length that overflows when rounded
  up; page-rounded, page-aligned, zeroed `Mmap` allocation; munmap EINVAL when misaligned. The five unsupported
  messages (file-backed, MAP_FIXED, protections, flags, offset) match the oracle byte for byte. The test also checks
  upstream's check order.

## `unported(...)` left

- unix/foreign_items.ts, plan-m6 D2 (other-OS unix shims): `android` / `freebsd` / `macos` / `solarish` / `netbsd`
  `foreign_items::is_dyn_sym` and `EvalContextExt::emulate_foreign_item_inner` (10 sites).
- unix/foreign_items.ts, D2 sockets (files with no module, miri-contract "Scope"): `virtual_socket::socketpair`
  (`socketpair`), `virtual_socket::pipe2` (`pipe`, `pipe2`), `socket_address::getaddrinfo` / `freeaddrinfo`. Each arm
  runs its `check_target_os` / `check_shim_sig` first, then stops.
- Pending contracts (they stop `unported` naming the owning lane until it lands): `shim_sig!` (sig.rs, miri-shims-b) and
  `impl From<io::ErrorKind> for IoError` (io_error.rs, miri-shims-b).

## Contracts other lanes need (missing signatures; I edited none of their files)

1. **miri-shims-b, sig.ts: `shim_sig(abi: string, args: readonly string[], ret: string)`**, returning the
   `fn(&MiriInterpCx) -> ShimSig` that `check_shim_sig` / `check_shim_sig_variadic` take. The arguments are the macro's
   tokens as strings, exactly as written upstream: `"*_"`, `"i32"`, `"usize"`, `"libc::off_t"`, `"fn(..) -> _"`, `"()"`,
   `"panic_unwind::imp::uw::_Unwind_Reason_Code"`, and a trailing `"..."` for C varargs. I call it as
   `shim_sig("C", ["*_", "usize"], "*_")`, through a `PORT(contract): pending miri-shims-b` declaration (foreign_items.ts)
   read from the module namespace at call time. shims-a's foreign_items.rs needs the same form.
2. **miri-shims-b, io_error.ts: `IoError_from_ErrorKind(kind: ErrorKind): IoError`** (io_error.rs:47). It needs an
   `io::Error` built from a bare `ErrorKind` (`ErrorData::Simple`), which src/std/io.ts's `IoError` cannot represent yet
   (only `Os` / `Custom` / `SimpleMessage`). That is a **src/std change for root**: add a `{ $: "Simple"; kind }` variant
   (Display = `ErrorKind_as_str`, Debug `Kind(PermissionDenied)`). env.ts calls it through a pending declaration.
3. **miri-shims-b, files.ts**: readiness.ts uses `FileDescriptionRef.prototype.id`, `FileDescriptionRef.downgrade`,
   `WeakFileDescriptionRef.prototype.upgrade` / `is_closed` as declared, and `Deref` as `fd._0.inner`. When the last
   strong `FileDescriptionRef` of a description that holds a `ReadinessWatched` goes away, `Drop for ReadinessWatched`
   must run: call `drop_ReadinessWatched(watched)` (readiness.ts) from that drop path.
4. **miri-shims-a, shims/env.ts**:
   - `EnvVars::init` builds `FxHashMap<OsString, OsString>` as rust_ts/hash_map.ts
     `FxHashMap.default(OsString_key, LAYOUT_VEC)`. `OsString_key` is exported from unix/env.ts: `[u8]`'s `Hash`, i.e.
     `write_length_prefix` + `write`, not `str`'s `write_str`. It inserts `config.env` then `config.set_env_vars`
     in their iteration order and passes the map to `UnixEnvVars.new` (declared signature `Map<string, string>`).
   - `VisitProvenance for EnvVars`: the `Unix` arm calls `env._0.visit_provenance(visit)` (a `UnixEnvVars` method).
   - `EnvVars::unix()` / `unix_mut()`: not declared in the skeleton, so env.ts inlines the match (`env_unix`). When shims-a
     ports them on the companion, root may switch env.ts to them (one line each).
   - env.ts calls the declared `get_pid` / `get_tid` / `read_os_str_from_c_str` / `alloc_os_str_as_c_str` /
     `read_path_from_c_str` / `write_path_to_c_str` (shims-a os_str).
5. **miri-shims-d (unix/poll.rs) and miri-shims-e (linux_like/epoll.rs)** own `Rc<ReadinessWatcher>`. Sent to both lanes
   directly; shims-d confirmed and adopted it in poll.ts, shims-e had proposed the same items and got the reply:
   `Rc::new(ReadinessWatcher::default())` → `Rc_new_ReadinessWatcher()`, `Rc::clone` → `Rc_clone_ReadinessWatcher`,
   dropping an Rc → `Rc_drop_ReadinessWatcher` (runs Drop at zero), `Readiness::EMPTY` → `Readiness_EMPTY` (frozen),
   `ReadinessWatched::default()` → `ReadinessWatched_default()`, `ReadinessInterest::active()` → `active_()`.
6. **Root, src/miri/contract.test.ts:144**: `expect(MIRI_STUBS.length).toBeGreaterThan(100)` now fails. This lane
   removes its 10 registrations, leaving exactly 100, and every wave-37 lane lowers the count further. The assertion is
   contract-lane code and needs a root change, e.g. a lower bound that tracks the wave, or dropping the count check.
7. **Root / codegen (optional)**: `ReadinessWatcher.interests` is generated as `Map<ReadinessInterestKey, ..>` (a
   `BTreeMap` with tuple keys). This lane stores an `InterestMap` there (a `KeyedMap` iterated in key order). A
   typemap entry could make the generated type say so. Not needed for correctness, since every watcher is built by
   `Rc_new_ReadinessWatcher`.

## `// PORT:` decisions

- **readiness.ts**
  - `BitAnd`/`BitOr`/`BitOrAssign`/`PartialEq` of `Readiness` are `Readiness_bitand` / `_bitor` / `_bitor_assign` /
    `Readiness_eq`.
  - The `BTreeMap` is `InterestMap`, ordered by `(FdId, FdNum)` with `FdNum` offset by 2^31 so the order is exactly the
    tuple's `Ord`; `range_for_id` returns the two bounds.
  - `Rc`/`Weak<ReadinessWatcher>` use an explicit strong count (`rc_strong`) and `WeakReadinessWatcher`.
    `update_fd_readiness` clones the upgraded watchers and drops each at the end of its loop iteration (the rest on
    an early return), as Rust does.
  - `cfg!(debug_assertions)` blocks stay as comments: the release oracle has no debug assertions.
- **unix/foreign_items.ts**
  - The match is a `switch` in arm order. Guarded arms fall to `platform_specific()` when `frame_in_std()` is false.
  - `trace!` lines are comments.
  - `std::env::home_dir()` is `$HOME`, else `os.homedir()` (D14; only reached with isolation off).
  - `i64::try_from(..).unwrap()` in `posix_fallocate` is a comment: `off_t` is 64-bit.
- **unix/env.ts**
  - `UnixEnvVars.map` is an `FxHashMap` with `OsString_key`. The Pointer element layout is 32 bytes; hashbrown reads
    it only for the minimum bucket count, which is the same for any size above 3.
  - `to_string_lossy().contains('=')` is `includes("=")`.
  - Host `current_dir` / `set_current_dir` are `process.cwd()` / `process.chdir` (D14).
  - `env!("CARGO_PKG_VERSION")` = `0.1.0` (src/tools/miri/Cargo.toml at the pin).
- **unix/thread.ts**: thread names are `number[]` bytes, as in concurrency/thread.ts.
- **unix/mem.ts**: `checked_next_multiple_of` overflows past `u64::MAX`; `count_ones` on the i32 bit pattern.

## Notes for root

- Cross-lane naming was sent to miri-shims-d and miri-shims-e (item 5). shims-d reads the readiness exports from the
  module namespace at call time (so merge order does not matter); check that shims-e's epoll uses the same names.
- foreign_items.ts was checked mechanically against upstream: all 128 `shim_sig!` signatures and 138 arm names in
  upstream order.
- `bun test src/miri` noise: the `error: no input filename given` lines come from other tests (driver argv tests),
  not from this lane.
