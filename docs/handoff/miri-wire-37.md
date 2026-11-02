# Handoff: lane `miri-wire-37` (M6 wave 37: wire the six landed shim lanes together)

Branch `t3/74526ff4` (worktree `t3-74526ff4`), on top of `integ-w37` at `4c9a7989` (merged at setup, no conflicts).
Commits: e3e607e1 (items 1 and 8), 60f9458f (items 2 and 4, part of 9), 1228a2c0 (item 3), b7927ff6 (items 5, 6 and 9),
490c957d (machine.ts glue, item 2), cd2d4c64 (miri-fs leftovers), then the handoff commit.
Before: 49 tsc errors on integ-w37. After: 0.

## Items (one line each)

1. **Typecheck: done.** All four `PORT(contract)` blocks in `linux_like/mod.ts` are deleted; the module is now `export {}`
   (mod.rs has no fns). Every other pending stand-in whose owner has merged is replaced by the owner's export:
   - readiness: `deref_fd` / `drop_fd` (readiness.ts), `readiness_api` / `drop_fd_ref` (poll.ts), and files.ts's
     `drop_ReadinessWatched`;
   - env: unix/env.ts's private `IoError_from_ErrorKind` and its `try_unwrap_io_result` cast; shims/env.ts's
     `visit_UnixEnvVars` lookup;
   - foreign_items: shims-a's `check_shim_sig` overload, its `shim_sig` / `sig_ty` / `SigTy` hand expansion (all 38 call
     sites in foreign_items.ts / alloc.ts now use sig.ts's string form, token for token as upstream), and the unix
     dispatcher's `shim_sig` / `check_shim_sig_deprecated` lookups;
   - fd / sig duplicates: the linux_like `shim_sig_` / `shim_varargs_` namespace wrappers; intrinsics/mod.ts's private
     `jump_to_next_block` (now shims-a's `EmulateItemResult.jump_to_next_block`);
   - foreign_items.ts's `Pending<"impl HasDataLayout">` casts on `load_tls` / `store_tls`;
   - fs.ts: `UnixFileDescription_provided` is now installed on `FileHandleDesc` / `DirHandleDesc` (miri-fs "contract
     gap"), and `open_file_or_dir` is typed with src/std/fs.ts's `Dir` / `OpenOptions` / `File`.

   `Epoll` and `EventFd` implement `FileDescription` and `UnixFileDescription`. The `(...args: readonly never[])`
   forwarding is gone: their impls are `port_methods` tables (`{ ...FileDescription_provided, name, metadata, read, ..,
   as_unix, drop_glue } satisfies FileDescription & ThisType<..>`, then `UnixFileDescription_provided`), so every member,
   including the leading `self_` of `read` / `write` / `as_unix`, is checked against the trait. `is_Epoll` /
   `is_EventFd` take a `FileDescription` (shims-b's `downcast`), and `insert_new` takes the description without a cast.
2. **Typed calls, no silent fallbacks: done.** No name is looked up at runtime in another lane's module any more:
   - readiness.ts: `drop_fd` (which silently no-oped) and `deref_fd` (which fell back to `_0.inner`) are now direct
     `.drop()` / `.deref()` calls;
   - poll.ts: `readiness_api(..)` and `drop_fd_ref`;
   - the unix dispatcher's `shim_sig` and `check_shim_sig_deprecated` lookups;
   - unix/env.ts `IoError_from_ErrorKind`; shims/env.ts `visit_UnixEnvVars`;
   - files.ts `drop_ReadinessWatched`;
   - machine.ts: the whole `pending` / `visit_object` / `visit_table` glue is deleted. `EnvVars::init`,
     `TlsData::default`, `DirTable::default`, and the `VisitProvenance` impls of `TlsData`, `EnvVars`, `DirTable`,
     `FdTable`, `CatchUnwindData`, `ThreadManager`, `FrameState`, `AllocState`, `GlobalDataRaceHandler`,
     `AllocDataRaceHandler`, the borrow-tracker and alloc-address global states and `MPlaceTy` are typed calls. (The
     earlier-wave ones were landed too, so they went with the glue.)

   One test relied on the silent fallback: shims_c.test.ts's `Rc<ReadinessWatcher> / Drop` test gave readiness.rs a
   stand-in fd with no `drop`. Its double now hands out owned handles from `upgrade()` and asserts they are all released.
3. **Handle ownership: checked, no change needed at the callers.** `update_fd_readiness` consumes its handle. Its
   callers are:
   - eventfd.ts (both sites): they move the fn's own `eventfd` handle in, as upstream eventfd.rs:228/316 does. It is
     not used or dropped afterwards; the old `as unknown as DynFileDescriptionRef` cast is gone.
   - `DelayedReadinessUpdates::process`: it moves the popped handle in, as upstream.

   The blocking_io.rs:166 caller (`fd.clone()`) is in `BlockingIoManager::poll`, still `unported` (mio). **Its port must
   pass a clone.** shims-b's `Readiness_EMPTY` / `ReadinessWatched_default` duplicates in files.ts are deleted (shims-c's
   exports; `{ ...Readiness_EMPTY }` where the code mutates).
   **src/std edits for root:**
   - src/std/io.ts:
     - `IoError` gains `{ $: "Simple"; kind }` (`ErrorData::Simple`). `kind()` is the kind; Display is `kind.as_str()`
       (core io/error.rs:528); Debug is `Kind(<variant>)` (`debug_tuple("Kind")`, error.rs:509).
     - New `io_error_from_kind(kind)` with marker `// std: library/core/src/io/error.rs:218 from`.
     - New `SeekFrom` (core io/seek.rs:202).
     - The header's "`ErrorData::Simple` is not produced yet" is removed.
   - Every copy now uses these:
     - io_error.ts's private `io_Error_from_ErrorKind` (the `SimpleMessage` stand-in) is deleted, so
       `IoError_from_ErrorKind` is `HostError(io::Error::from(kind))` exactly.
     - miri-fs fs.ts's cast `(IoError_from_ErrorKind(kind) as { _0 })._0` is deleted.
     - `SeekFrom` is no longer defined in files.ts or src/std/fs.ts.
   - src/std/path.ts: new `absolute` (`std::path::absolute`, path.rs:4148, and `sys::path::unix::absolute`), moved
     unchanged from src/std/fs.ts. It reuses path.ts's existing `component_as_os_str` instead of the moved private copy;
     on unix `MAIN_SEPARATOR_STR` is `/`, the same text.
   - Knock-on edits, outside src/miri, needed because the `IoError` union gained a variant (exhaustive matches):
     - src/vendor/anstream/stream.ts `is_interrupted`: `case "Simple"` returns `kind === Interrupted`, as core's
       `is_interrupted` (error.rs:488).
     - src/rustc_middle/mir/pretty.ts `display_io_error`: `Simple` displays `ErrorKind_as_str(kind)`.
   - Not changed (root): src/rustc_fs_util/lib.ts keeps its own `absolute` (`try_canonicalize`'s fallback). It could
     now import src/std/path.ts's `absolute`.
4. **`EnvVars::init`: done.** It builds `FxHashMap.default(OsString_key, LAYOUT_VEC)`: unix/env.ts's `OsString_key`
   (bytes with a length prefix) and `OsString`'s 24-byte layout. That map is the one `UnixEnvVars::new` iterates, so the
   environ block follows upstream's FxHash order. unix/env.ts's inlined `env_unix` is replaced by shims-a's
   `EnvVars.unix` / `EnvVars.unix_mut`, at the sites where upstream calls each (unix/env.rs:136/161/181/317/322).
5. **Load order: done.** helpers.ts's five `MiriMachine` methods (`current_user_relevant_span`, `caller_span`,
   `stack`, `top_user_relevant_frame`, `user_relevance`) are a `port_methods` table (C10), so helpers.ts no longer reads
   `MiriMachine` at load. The lazy `require("../helpers.ts")` in files.ts, cpu_affinity.ts and foreign_items.ts is
   replaced by static imports. contract.test.ts "every module loads as a fresh entry point" passes.
6. **lib.ts re-exports: done.**
   - `MAX_CPUS` is re-exported from shims/cpu_affinity.ts; bin/miri.ts imports it from lib.ts.
   - `IoError` (type and companion) and `LibcError` are re-exported from shims/io_error.ts.
   - PORT: upstream lib.rs:171 re-exports only `IoError, LibcError`. The other variant constructors (`WindowsError`,
     `HostError`, `Raw`) are reached as `IoError::X`, which is the companion `IoError.X`, so they are not re-exported
     separately. Root: add them if you want the brief's wider form.
   - The comment line for `sig::EvalContextExt as _` is unchanged (no value to export).
7. **x86 intrinsics arm: done.** It now calls `this_.emulate_x86_intrinsic(link_name, args, dest)` (the wave-38
   placeholder of intrinsics/x86/mod.ts, lane miri-x86-a), with `break 'handled` on its result. Until wave 38 lands it
   stops `unported` with `miri::intrinsics::x86::EvalContextExt::emulate_x86_intrinsic (src/tools/miri/src/intrinsics/x86/mod.rs; lane miri-x86-a)`.
8. **Codegen class list: done.** `PthreadMutex`, `PthreadRwLock`, `PthreadCondvar`, `LinuxFutex`, `Epoll` and
   `EventFd` are in set `miri`'s `class` list. The hand classes and their `implements gen_X` shadows are deleted, and
   so is unix/sync.ts's redefined `clone_Pthread*` (the generated clones now build the class). The sync objects'
   `impl SyncObj` is a `port_methods` table on the generated prototype. `is_Pthread*` / `is_LinuxFutex` / `is_Epoll` /
   `is_EventFd` stay exact `instanceof` tests. shims_e.test.ts (which checks that the stored sync object is the exact
   `PthreadMutex` class) passes.
9. **Small fixes: done.**
   - foreign_items.ts `miri_pointer_name`: the decoder has `ignoreBOM: true`.
   - extern_static.ts `try_insert_unwrap` and miri-fs fs.ts `DirTable::insert_new`: the invented `OccupiedError`
     panic texts now stop `unported`. Both paths are unreachable.
   - contract.test.ts: the placeholder test no longer samples one stub with `find(..)!` and no longer has a count. It
     checks every still-installed placeholder: known lane, a function, stops `Unported` with
     `<path>::<name> (<upstream>; lane <lane>)`. With zero placeholders it still passes; the duplicate check stays.
   - shims_c.test.ts getcwd: the branch that accepted `unported` is removed. The test now asserts the oracle path
     (warning, `HostError(Simple(PermissionDenied))`, a NULL return).
   - fd.ts `ioctl`: `Scalar_eq` returns false for `Ptr` vs `Int`, as derived `PartialEq` does. `Ptr` vs `Ptr` stops
     `unported`; it is unreachable because the right side comes from `eval_libc`.
   - fd.ts `fcntl(F_FULLFSYNC)` under isolation: the `unported` (it was waiting for `ErrorData::Simple`) is ported as
     `set_errno_and_return_neg1_i32(ErrorKind::PermissionDenied)`.
   - socket.ts: the header comment is fixed. With isolation on, socketpair creates sockets, so these shims are
     reachable, and the virtual_socket.rs lane must port them.
   - `display_CanonAbi` (src/rustc_abi/canon_abi.ts, **outside src/miri; root please note**) is ported (canon_abi.rs:79
     `fmt`). sig.test.ts checks the message `calling a function with calling convention "C" using caller calling
     convention "Rust"`.
10. **Report: below** (remaining stand-ins, miri-hello).

## Verify

| check | result |
|---|---|
| `bunx tsc --noEmit -p .` | 0 errors (integ-w37: 49) |
| `bun scripts/coverage.ts --check --offline` | `markers ok (24395; vendor 5050; library 584)` |
| codegen set `miri` (`bun tools/codegen/types.ts miri`) | regenerates with no diff after the change; report counts unchanged (unknown 0, missing debug 14, missing clone 2) |
| gen diff made by this change | only the six types: `epoll.gen.ts` / `eventfd.gen.ts` / `linux_like/sync.gen.ts` (`interface X {..}` → `class X { constructor(public ..) {} }`), `unix/sync.gen.ts` (the three classes, and `clone_Pthread*` return `new PthreadX(..)` instead of object literals); 4 files, +49/-38 with types.sets.json |
| `RUST_TS_REQUIRE_PROBES=1 bun test ./src ./tools` | 6826 pass, 1 skip, 0 fail (567 files, 947 s; log `$RUST_TS_DATA/tmp/miri-wire-37/unit-src.log`); no timeouts |
| `bun test ./scripts ./harness` | 148 pass, 0 fail |
| `difftest --suite mir --sample 200` (agent miri-wire-37) | MATCH 200/200 (run `20261102-145513-miri-wire-37-52rj`) |
| `bun test src/miri src/std src/rustc_abi` | 309 pass, 0 fail |

Coverage (`--missing`) of the touched upstream files, all full:

| area | files |
|---|---|
| shims | readiness 23/23, env 10/10, foreign_items 9/9, alloc 9/9, extern_static 5/5, files 77/77, io_error 14/14, cpu_affinity 7/7 |
| shims/unix | poll 5/5, fd 19/19, env 18/18, foreign_items 4/4, sync 47/47, fs 58/58 |
| shims/unix/linux_like | epoll 9/9, eventfd 10/10, sync 1/1, syscall 1/1, thread 1/1 |
| other miri | intrinsics/mod 4/4, helpers 71/71, machine 87/87 |
| rustc_abi | canon_abi.rs 2/2 |

## miri-hello (M6a)

- **`difftest --suite miri-hello`** (run `20261102-143748-miri-wire-37-58im`): UNPORTED
  `rustc_codegen_llvm::LlvmCodegenBackend::codegen_crate (codegen; M7)`. Before this lane (shims-b's report) it was
  shims-a's `TlsData::default`.
- **Run by hand** with the suite's argv and env: **the interpreter runs hello world to the end.** stdout is
  `Hello, world!\n`, the same as the oracle. Miri's `after_analysis` returns `Compilation::Continue` after a successful
  `eval_entry` (bin/miri.rs:211), and rustc then calls the codegen backend. Upstream that is Miri's dummy backend
  (`make_miri_codegen_backend`, set in `config` at bin/miri.rs:129). The port's rustc_interface ignores
  `Config.make_codegen_backend` (interface.ts:355/363: only the `None` arm is ported; the bin/miri.ts:106
  `PORT(contract): pending rustc_interface`), so the LLVM stand-in runs and stops.
  **The M6a blocker is that root item:** port `run_compiler`'s `Some(make_codegen_backend)` arm.
- **`miri-diff --suite miri-hello --case harness/corpus/miri/hello.rs`** (run `20261102-143807-miri-wire-37-aidt`): port 0
  of the oracle's 22,954 records. The exit 70 is `RUSTC_LOG/MIRI_LOG directive miri=info enables INFO for a target whose
  INFO events are not converted`, the open root decision on `INFO_CONVERTED_TARGETS` (wave-36 L2). The next oracle
  record is `SPAN rustc_const_eval::interpret::stack::frame frame=std::rt::lang_start::<()>`.

## Remaining `PORT(contract)` / pending stand-ins in `src/miri/**`

None of the six wave-37 lanes' stand-ins remains. What is left:

| site | what | owner |
|---|---|---|
| bin/miri.ts:106 | `Config.make_codegen_backend` ignored by rustc_interface (the M6a blocker above) | root / rustc_interface |
| bin/miri.ts:209, machine.ts:1211, genmc/dummy.ts:34 | `Pending<"NonZeroI32">` / `Pending<FnArg>[]` in the GenMC dummy signatures | GenMC typing (never called without genmc) |
| borrow_tracker/mod.ts:184 | `Tree.visit_provenance` declared, stub | miri-tb-b (wave 37) |
| data_race.ts:328, :972; thread.ts:709, :718; sync.ts:363 | CTFE-typed rustc_const_eval declarations, cast at the call sites | root / interp-generic |
| alloc/alloc_bytes.ts:78, :187; stacked_borrows/mod.ts:6; weak_memory.ts:15 | standing design notes | none (permanent) |
| intrinsics/mod.ts x86 arm | wave-38 placeholder `emulate_x86_intrinsic` | miri-x86-a (wave 38) |
| `stub_methods` placeholders | later-wave lanes (miri-tb-a/-b, miri-x86-a/-b, ...) | those lanes |

Comments that still say "lane miri-shims-x" now only name where an impl lives (e.g. files.ts:196, fd.ts:11). None of
them marks a stand-in.

## `unported(...)` added

- extern_static.ts `try_insert_unwrap`: replaces the invented `OccupiedError` panic text (unreachable).
- unix/fs.ts `DirTable::insert_new`: replaces the invented `OccupiedError` panic text (unreachable).
- fd.ts `Scalar_eq` with two pointers: narrowed from "any pointer" (unreachable).

Removed `unported` stops:
- fd.ts `fcntl(F_FULLFSYNC)`;
- the literal x86 one in intrinsics/mod.ts (it is now the placeholder's own);
- the lookup stops in unix/env.ts, poll.ts (2), files.ts, unix/foreign_items.ts and shims/env.ts;
- machine.ts's `pending` / `visit_object` / `visit_table`;
- `display_CanonAbi`.

## `// PORT:` decisions

- `Epoll` / `EventFd` `as_unix`: the unsizing `FileDescriptionRef<Self> -> FileDescriptionRef<dyn UnixFileDescription>`
  is a cast of the moved handle, as files.ts's stdio `as_dyn_unix` does.
- The trait-impl tables of generated classes are checked with `satisfies FileDescription & ThisType<Self>`. That gives
  a typed signature for every provided and overridden member. `port_methods` alone takes a `Record<string, unknown>`.
- lib.ts: only `IoError` / `LibcError`, as upstream (item 6).
- fs.ts: `DirHandle.dir` is still the generated `Pending<"std::fs::Dir">` field, so it is cast to src/std/fs.ts's
  `Dir` where it is passed on. The typemap follow-up (map `std::fs::{File, Dir, ReadDir}` to src/std/fs.ts) is still
  open, as miri-fs reported; it needs Debug impls for those classes.

## For root

- src/std edits (item 3) and the two knock-on edits (anstream, rustc_middle pretty), plus `display_CanonAbi` in
  rustc_abi: please review them as part of this batch.
- M6a: rustc_interface `make_codegen_backend`'s `Some` arm, and the `INFO_CONVERTED_TARGETS` decision for miri-diff.
- The future `BlockingIoManager::poll` port must pass `fd.clone()` to `update_fd_readiness` (blocking_io.rs:166).
- Queued from the shims-c review, not done here (not in the brief): L2 (`Rc_drop_ReadinessWatcher` over-release
  check), L5 (`add_interest` should copy `relevant`), L4 and L6.
