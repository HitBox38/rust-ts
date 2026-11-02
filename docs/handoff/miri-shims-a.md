# Handoff: lane `miri-shims-a` (M6 wave 37: Miri shims → gate M6a)

Branch `t3/c909b4c6` (worktree `t3-c909b4c6`), from main `ccf5dc4a`. All ten files of the lane are fully ported
(82/82 fns). No other lane's file is edited; the needs from other lanes are listed below.

## Files touched

| file | upstream | fns |
|---|---|---|
| `src/miri/shims/foreign_items.ts` | shims/foreign_items.rs (954) | 9/9 |
| `src/miri/shims/alloc.ts` | shims/alloc.rs (300) | 9/9 |
| `src/miri/shims/env.ts` | shims/env.rs (130) | 10/10 |
| `src/miri/shims/extern_static.ts` | shims/extern_static.rs (91) | 5/5 |
| `src/miri/shims/global_ctor.ts` | shims/global_ctor.rs (99) | 1/1 |
| `src/miri/shims/mod.ts` | shims/mod.rs (71) | 1/1 |
| `src/miri/shims/panic.ts` | shims/panic.rs (113) | 3/3 |
| `src/miri/shims/unwind.ts` | shims/unwind.rs (161) | 4/4 |
| `src/miri/shims/tls.ts` | shims/tls.rs (506) | 16/16 |
| `src/miri/shims/os_str.ts` | shims/os_str.rs (367) | 24/24 |
| `src/miri/shims/os_str.test.ts` (new) | tests: path conversion (oracle-derived), OsStr bytes | |
| `src/miri/shims/tls.test.ts` (new) | tests: TLS keys, values, dtor order, thread cleanup, GC walk | |
| `src/miri/shims/env_alloc.test.ts` (new) | tests: env forwarding, pid/tid, `malloc_align`, alloc request errors | |
| `docs/handoff/miri-shims-a.md` | this file | |

Every `stub_methods` / `stub_statics` registration of these files is deleted. The `.gen.ts` files are unchanged.

## Verification (one line each)

- `bunx tsc --noEmit -p .`: 0 errors.
- `bun scripts/coverage.ts --check --offline`: `markers ok (24036; vendor 5050; library 506)`.
- `--missing`: foreign_items 9/9, alloc 9/9, env 10/10, extern_static 5/5, global_ctor 1/1, mod 1/1, panic 3/3,
  unwind 4/4, tls 16/16, os_str 24/24 (all 82). Crate `miri`: 841/1514 fns (55.55%), from 759.
- Codegen set `miri`: `bun tools/codegen/types.ts miri` regenerates with no diff.
- `RUST_TS_REQUIRE_PROBES=1 bun test ./src ./tools`: 6743 pass, 4 fail. The failures are 1 contract-test threshold
  (in a file this lane does not own) and 3 load timeouts that pass when re-run alone (below).
- `bun test ./scripts ./harness`: 136 pass, 0 fail.
- `bun scripts/difftest.ts --suite mir --sample 100`: MATCH=100 DIFF=0 UNPORTED=0.
- `bun test src/miri`: 165 pass, 1 fail (the same `contract.test.ts` assertion). The 15 new tests pass.
- miri-diff / miri-hello, before and after: see "miri-hello" below.

## Unit step

- `RUST_TS_REQUIRE_PROBES=1 bun test ./src ./tools`: 6743 pass, 4 fail (6748 tests, 556 files, 2077 s). The 4 failures:
  - `src/miri/contract.test.ts` placeholders threshold (below).
  - Three 5 s timeouts under load, because the run overlapped the mir difftest:
    - `test_classify_nonstarters` (src/vendor/unicode_normalization/stream_safe.test.ts);
    - odht `build: insert results…`;
    - `readmeta: core/alloc/std def_path_hash_map…` (src/vendor/odht/odht.oracle.test.ts).

    Re-run alone, both files pass (8 pass, 0 fail, 4.9 s). They touch nothing in Miri.
  - An earlier run also flagged `src/std/result.test.ts` ("one-argument unwrap_result"). The guard rejected my
    `unwrap_result<T, E>(…)` calls with explicit type arguments. Those calls did pass the Debug, but the type arguments
    are now gone and the test passes.
- `bun test ./scripts ./harness`: 136 pass, 0 fail.
- `bun scripts/difftest.ts --suite mir --sample 100`: MATCH=100 DIFF=0 UNPORTED=0 (run `20261102-121652-root-s8ik`).

**The one failing test is `src/miri/contract.test.ts:144`** (`expect(MIRI_STUBS.length).toBeGreaterThan(100)`). This
lane removed 13 `stub_*` registrations (the contract's rule 1), which leaves exactly 100. Each wave-37 fill lane lowers
the count, so this threshold fails for all of them. contract.test.ts belongs to miri-contract / root, so this lane does
not edit it. **Root:** lower the bound, e.g. `toBeGreaterThan(0)`, or check the mechanism on a stub that stays. The
rest of that test still uses `miri::shims::time::EvalContextExt::clock_gettime`, which is lane miri-shims-b's.

## miri-hello

- **Before** (main `ccf5dc4a`):
  - `bun scripts/miri-diff.ts harness/corpus/miri/hello.rs`: the port stops at record 0 of 22,954. The reason is
    `unported: RUSTC_LOG/MIRI_LOG directive miri=info enables INFO for a target whose INFO events are not converted`.
    `INFO_CONVERTED_TARGETS` (src/rust_ts/tracing.ts) lists only `rustc_const_eval::interpret`,
    `rustc_middle::mir::interpret`, `miri::machine` and `miri::borrow_tracker`.
  - `bun scripts/difftest.ts --suite miri-hello`: UNPORTED, `miri::shims::cpu_affinity::MAX_CPUS (lane miri-shims-b)`.
- **After** (this branch): both show the same stop. Two things come before any shim of this lane, and neither is
  ported yet:
  - miri-diff needs `INFO_CONVERTED_TARGETS` widened (root decision, wave 36);
  - `MAX_CPUS` is in shims-b's file.
- **How far these shims take it.** I ran a local probe, not committed: temporary stand-ins in other lanes' files,
  restored with `git checkout` afterwards. The stand-ins were:
  - `MAX_CPUS = 1024`;
  - `CpuAffinityMask::new`;
  - `FdTable::init` and `DirTable::default` as empty objects;
  - `UnixEnvVars::new` for an empty environment;
  - unix `is_dyn_sym` returning `true`;
  - math `emulate_foreign_item_inner` returning `NotSupported`;
  - `call_intrinsic` = core `eval_intrinsic` plus `catch_unwind` → this lane's `handle_catch_unwind`;
  - `DelayedReadinessUpdates::process` as a no-op.

  With those, hello.rs starts and passes through, in order:
  1. `EnvVars::init` (this lane);
  2. `init_extern_statics` (`environ`, the weak `getrandom`/`gettid`/`statx`/`strlen` symbols, `missing_weak_symbol`);
  3. the global-ctor state machine (`.init_array` lookup);
  4. `lang_start`;
  5. `catch_unwind` → `handle_catch_unwind`.

  It then reaches its first foreign call, `poll` (std's stdio sanitization). That call goes through
  `emulate_foreign_item` → `emulate_foreign_item_inner` → math (`NotSupported`) →
  `unix::foreign_items::emulate_foreign_item_inner`. **The next stops are lane miri-shims-c's unix dispatcher and
  miri-shims-d's `poll`.** Probe script: `$RUST_TS_DATA/tmp/run-hello.sh` (the oracle's argv for the port's driver).

## unported(...) left

- Windows, out of scope (plan-m6 D2):
  - env.ts: `WindowsEnvVars::{new, get, visit_provenance}`;
  - foreign_items.ts: `windows::foreign_items::is_dyn_sym` and its `emulate_foreign_item_inner` fallback.
- env.ts `visit_UnixEnvVars`: `UnixEnvVars::visit_provenance` (unix/env.rs:23, lane miri-shims-c). It is a prototype
  method the skeleton does not declare, so it is looked up at call time and stops until ported.
- `OsStr` is a `string` (typemap, D14). os_str.ts stops in these cases:
  - non-UTF-8 bytes in `bytes_to_os_str` on a Unix host;
  - unpaired surrogates in `u16vec_to_osstring` on a Windows host;
  - the two impossible-in-practice re-decodes in `convert_path`.
- foreign_items.ts:
  - `miri_print_borrow_state` with an id ≥ 2^53 (`AllocId` is a number);
  - `memset` of ≥ 2^53 bytes (`n.try_into().unwrap()` to a JS count).
- tls.ts `create_tls_key`: the `try_insert(..).unwrap()` `OccupiedError` panic. It cannot be reached, because keys
  only grow. Its Debug would print `TlsEntry`'s `BTreeMap`, which has no TS Debug (types report).

## PORT decisions (in code)

- **`shim_sig!` expansion (foreign_items.ts header):**
  - `shim_sig(abi, [args], ret)` builds the `fn(&MiriInterpCx) -> ShimSig` closure.
  - `sig_ty` holds one entry per `shim_sig_arg!` arm the shims here use: ints, `()`, `!`, `bool`, `*_`, `*T`,
    `fn(..) -> _`, `&[T]`, and `path(..)` for `core::mem::Alignment`.
  - The types are computed when `check_shim_sig` calls the closure.
  - Both helpers are exported because alloc.ts uses them too.
  - **For shims-b / root:** if sig.ts ports the macro as its own helper, switch these call sites to it. They read like
    the macro: `shim_sig("C", [T.ptr_any, T.usize], T.ptr_any)`.
- **`check_shim_sig` overload (foreign_items.ts, `PORT(contract): pending miri-shims-b`):**
  - The skeleton declares `shim_sig: Pending<"fn(&MiriInterpCx<'tcx>) -> ShimSig<'tcx, N>">`, so I added a local
    overload `shim_sig: (this_: MiriInterpCx) => ShimSig` that returns `readonly OpTy[]`.
  - Callers destructure with the arity of the signature (`as [OpTy, OpTy]`).
  - **shims-b:** please make the real declaration this type. Then the local overload can go.
- **`EmulateItemResult.jump_to_next_block` (mod.ts):** it is a companion method. Upstream's `T: Default` is always an
  `Option<_>`, so `T::default()` is `undefined` and the result is `InterpResult<T | undefined>`. `unwind` is
  `UnwindAction | undefined`, because intrinsics/mod.rs:250 passes `None`. **For shims-d:** call it as
  `EmulateItemResult.jump_to_next_block(res, this_, dest, ret, unwind, (ecx) => ...)`.
- **`EnvVars` (env.ts):** `export const EnvVars = gen.EnvVars as typeof gen.EnvVars & EnvVars_methods`, the same
  pattern as `MiriMemoryKind`.
  - Methods: `EnvVars.init(ecx, config)`, which machine.ts's `EnvVars_()` reads, and
    `EnvVars.unix/unix_mut/windows/windows_mut(self)`.
  - `VisitProvenance_EnvVars`: the table machine.ts reads.
  - `FxHashMap<OsString, OsString>` is a `Map` in insertion order. Upstream iterates it in FxHash order. That order
    only matters to `UnixEnvVars::new` (shims-c), which allocates one block per variable, and so only with more than
    one forwarded or set variable.
- **extern_static.ts:** the 5 `impl MiriMachine` associated fns are module fns, registered as `MiriMachine` statics
  with `port_methods` (C10).
  - `try_insert(..).unwrap()` panics with `OccupiedError { key, old_value, new_value }`'s Debug, as std does.
- **global_ctor.ts / tls.ts:** `'new_state: { .. }` is a nested function. It returns either the new state or a `Poll`;
  a `Poll` means upstream's direct `return`. `ctors.pop()` / `dtors.pop()` mutate the state's vector in place, as
  upstream does.
- **tls.ts:**
  - `TlsKey` is a bigint.
  - `BTreeMap<TlsKey, _>` walks sort the keys (`sorted_keys`), so the order does not depend on how the `Map` was
    filled.
  - `TlsData.default()`, which machine.ts reads, also has a typed alias `TlsData.default_`.
  - `visit_provenance` is a prototype method; machine.ts calls it through `visit_object`.
  - `VecDeque::pop_front` is `shift`.
- **unwind.ts:** `VisitProvenance_CatchUnwindData` is the table machine.ts's `VisitProvenance_FrameExtra` reads.
  `extra.catch_unwind.take()` always clears the field, as upstream's tuple does.
- **os_str.ts:**
  - `cfg(unix)` / `cfg(windows)` refer to Miri's *host*. Both variants are ported, and `process.platform` picks one
    (D14). The macOS oracle uses the Unix variants.
  - `alloc_os_str_as_wide_str` sizes the `u16` array by the UTF-8 byte length, as upstream (`os_str.len()`).
- **foreign_items.ts:**
  - `std::io::stdout().write_all` (`miri_write_to_stdout`) is src/std's `stdout_write_all`; stderr and the `eprintln!`
    of `miri_print_borrow_state` use `writeSync(2, ..)`. Errors are ignored, as upstream.
  - `String::from_utf8_lossy` is a non-fatal `TextDecoder`.
- **`std::process::id()`** (env.ts, isolation off) is the host's `process.pid` (D14).

## Reconciling with miri-shims-b (landed on `t3/port-miri-shims-b` 7c64e53a, after this lane was written)

- **`check_shim_sig`.** shims-b's declaration is `shim_sig: ShimSigFn` (`(this_: MiriInterpCx) => ShimSig`) with
  `_1: readonly [..]`. That is the same type as this lane's local overload, so the two merge without type errors.
  After the merge, delete the overload block (the `PORT(contract): pending miri-shims-b` `declare module` in
  foreign_items.ts).
- **`shim_sig`.** shims-b exports `shim_sig(abi, string tokens, ret)` from sig.ts, e.g.
  `shim_sig("C", ["*_", "usize"], "*_")`. This lane's foreign_items.ts `shim_sig(abi, SigTy[], SigTy)` + `sig_ty` builds
  the same `ShimSig`s. After the merge, root (or a fixer) should rewrite the ~35 call sites in foreign_items.ts /
  alloc.ts to sig.ts's string form and delete `shim_sig` / `sig_ty` / `SigTy` here. Mapping:
  - `T.usize` → `"usize"`;
  - `T.ptr(T.unit)` → `"*()"`;
  - `T.ptr_any` → `"*_"`;
  - `T.fn_ptr` → `"fn(..) -> _"`;
  - `T.slice_ref(T.u8)` → `"&[u8]"`;
  - `T.path("core","mem","Alignment")` → `"core::mem::Alignment"`;
  - `T.unit` / `T.never` → `"()"` / `"!"`.

  Behaviour is unchanged.
- **`LibcError`.** foreign_items.ts builds `{ $: "LibcError", _0: "ENOMEM" }` directly. shims-b's `LibcError(name)`
  makes the same object.
- **`MAX_CPUS`.** It is now exported by shims-b, so `difftest --suite miri-hello` will move on to the next stop.
- **C10.** shims-b reports that helpers.ts assigns `MiriMachine.prototype` methods at load. A module machine.ts may
  reach must therefore not value-import helpers.ts. foreign_items.ts reads helpers.ts lazily (`helpers()`). No other
  file of this lane imports it.
- shims-b's commit also edits `src/miri/contract.test.ts`, which may already fix the `MIRI_STUBS.length > 100`
  failure noted above.

## Needs from other lanes (signatures)

- **miri-shims-b / sig.ts:**
  - `check_shim_sig`'s `shim_sig` parameter type (above).
  - `check_shim_sig_deprecated` / `check_shim_sig_llvm_intrinsic` need the const `N` (the expected arity, printed in
    their error) as a parameter; their skeleton declarations have none. This lane does not call them.
- **miri-shims-b:** `MAX_CPUS` export (lib.ts re-export, root), `CpuAffinityMask::new`, `FdTable::init`,
  `shims::math::emulate_foreign_item_inner`, `set_last_error`, `handle_miri_backtrace_size` / `_get_backtrace` /
  `_resolve_frame` / `_resolve_frame_names`. This lane calls these through the skeleton declarations unchanged.
- **miri-shims-c:**
  - `UnixEnvVars.new(ecx, Map<string, string>)`, `environ_()`, `get(ecx, name)`, and `visit_provenance` (undeclared);
  - unix `is_dyn_sym(name, os)` and `emulate_foreign_item_inner(this_, ..)` (C9 module fns). Called as declared.
- **miri-shims-d:** `intrinsics/mod.rs` uses `jump_to_next_block` (above) and `handle_catch_unwind` (unwind.ts,
  signature unchanged).
- **miri-fs:** `DirTable.default()` (machine.ts reads it).

## Signature changes to the skeleton (my files)

- `TlsData`: `load_tls` / `store_tls` take `cx: HasDataLayout`, where the skeleton had `Pending<"impl HasDataLayout">`.
  `visit_provenance` and `default_` are declared.
- `EmulateItemResult.jump_to_next_block` is new on the companion. The skeleton only listed it in the inventory.
- `lookup_windows_tls_dtors` returns `[ImmTy, Span][]`; `lookup_windows_fls_keys_with_dtors` returns `TlsKey[]`, a
  `VecDeque`. Both are the same shapes as before.
- foreign_items.ts exports `shim_sig`, `sig_ty`, `SigTy`; os_str.ts exports `os_str_as_encoded_bytes`,
  `windows_to_unix`, `unix_to_windows`. All other declarations are unchanged.
