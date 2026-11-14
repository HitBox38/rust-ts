# Handoff: default-sysroot (M7b, wave 40r)

The port's default sysroot is now the pinned oracle's sysroot (decision 2026-11-14). `Session::get_tools_search_paths` is ported into
session.ts. The ssa-linker review nits N1–N4 are done.

## Files

| File | What |
|---|---|
| `src/rustc_session/filesearch.ts` | `default_sysroot()` returns the oracle's sysroot. `DEFAULT_SYSROOT_STANDIN`, `displayed_sysroot_path` and the crate-search stop in `get_library_candidates` are removed. |
| `src/rustc_session/config.ts` | `Sysroot`: the field `default_` is a lazy getter/setter (`PORT(perf)`, below). `Sysroot::new` passes `undefined`. |
| `src/rustc_session/session.ts` | `Session::get_tools_search_paths` (session.rs:825), with its marker. |
| `src/rustc_session/stand_ins.ts` | Drops the re-export of `DEFAULT_SYSROOT_STANDIN`. |
| `src/rustc_codegen_ssa/back/linker.ts` | `get_tools_search_paths` is now a one-line forwarder to the session method. link.ts imports it under that name, so the export stays. `get_linker` calls `sess.get_tools_search_paths` directly, as upstream does, and the stand-in stop is gone. N1, N2. |
| `src/rustc_codegen_ssa/back/command.ts` | N3. |
| `src/rustc_codegen_ssa/back/linker_oracle/regen.ts` | N4. |
| `src/rustc_codegen_ssa/back/linker_args.oracle.test.ts` | The default-sysroot injection is removed. It now asserts `default_sysroot() === oracleSysroot()`. |
| `src/rustc_driver_impl/lib.ts` | `--print sysroot` / `target-libdir` print the path directly, as upstream does (`displayed_sysroot_path` is gone). |
| `src/rustc_driver_impl/print.oracle.test.ts` | `--print sysroot` / `--print target-libdir` without `--sysroot` were "stops with exit 70". They are now `exact` against the oracle, and both pass. |
| `src/rustc_driver_impl/driver.oracle.test.ts` | The two PENDING cases without `--sysroot` (`x.rs`, `-ooptimize x.rs`) stopped at crate search. They now compile up to the link and stop at `ssa-link-b: self_contained_components`, a link.ts cross-lane stub. **When ssa-link-b lands, root must update this pending text, or turn the cases into MATCH.** |

The rustc_driver_impl files are outside the files named for this lane. The brief's "remove the unported it causes in `displayed_sysroot_path` or wherever else" needs them, and their tests asserted the old stop.

## How the sysroot is found

`filesearch::default_sysroot()`:
1. It reads `UPSTREAM.json` `rust.toolchain` from the repo root (`import.meta.dir/../..`; subject-bin's plugin keeps `import.meta.dir` pointing at the source).
2. It runs `rustc +<toolchain> --print sysroot` once, with `RUSTUP_AUTO_INSTALL=0`, the inherited environment and `stdin` ignored. This is the same command, environment and pin as `rust_ts/llvm/tools.ts` `oracle_sysroot` and `scripts/lib/oracle.ts` `oracleSysroot`.
3. It strips the trailing `println!` newline only. The value is the exact string the oracle prints: not trimmed further, not canonicalised.
4. It caches the value for the process.
5. If `rustc` is missing (Bun throws) or exits non-zero, it calls `unported("rustc_session::filesearch::default_sysroot (rustc +nightly --print sysroot failed: <first stderr line>)")` (exit 70). It never guesses a path.

It is not imported from tools.ts. Loading tools.ts would pull the IR model into rustc_session (`ir.ts`, `printer.ts`, ...), with a require cycle back to rustc_session/config.ts. tools.ts's failure message also names the LLVM tools. So a linking process can spawn the oracle twice: once here, once in tools.ts. A later lane could make tools.ts `oracle_sysroot` call `default_sysroot` (owner of `src/rust_ts/llvm/`).

**Lazy read (`PORT(perf)` in config.ts `Sysroot`).**
- Upstream computes `default` eagerly in `Sysroot::new`.
- Here that would be a spawn of rustup's proxy on every compile. I measured about 52 ms (5 runs in 0.258 s), and almost no compile reads the field.
- So `default_` is a getter that calls `default_sysroot()` on first read, and a setter for writes.
- The value is the same. Only the point where a failure to ask the oracle stops moves: from option parsing to the first read. Upstream has no such failure.
- Checked: a `--crate-type=lib --emit=metadata --sysroot <S>` compile with `PATH=/usr/bin:/bin` (no rustc at all) exits 0 and writes the rmeta. So with `--sysroot`, a non-linking compile never spawns.
- PORTING §3 says `PORT(perf)` changes get adversarial review. This one moves a read that has a possible `unported` stop, so **root should record it as a decision** (see "Decisions for root").

## Readers of the default sysroot, and why protected output cannot change

`Sysroot.default_` is read in three ways:

1. **`Sysroot::path()`** = `explicit ?? default_`. With `--sysroot` it never reads the default.
   - `config.ts:3321` `real_source_base_dir`: the rust-src un-remap of `/rustc/<hash>/library` paths in diagnostics.
   - `config.ts:3360` `SearchPath::from_cli_opt`: the `-L` `@RUSTC_BUILTIN` prefix.
   - `session.ts:1398`, `:1424`, `interface.ts:407`, `rustc_driver_impl/lib.ts:1150`: `Target::search` / `build_target_config`, for JSON target files.
   - `session.ts:1442–1444`: host, target and wasm tlib paths, which feed crate search (`FileSearch`) and `--print target-libdir`.
   - `rustc_driver_impl/lib.ts:710`: `--print sysroot`.
   - `rustc_interface/util.ts:244`: only inside the `unported` text for a non-builtin codegen backend (miri.ts:384 passes the `Sysroot` here too).
   - `back/link.ts:1417`: `LinkingFailed.sysroot_dir` (ssa-link-b's file).
   - `back/linker.ts:1367`: MSVC natvis dir (MSVC only).
2. **`Sysroot::all_paths()`** = `[explicit?, default_]`. It always reads the default.
   - `Session::get_tools_search_paths` (session.ts:793) → `get_linker`'s `PATH` (linker.ts:205), plus link.ts:1593 `strip_with_external_utility` through the forwarder.
3. **Direct `sess.opts.sysroot.default_`**: link.ts:1754 `find_sanitizer_runtime`'s fallback. It is reached only with `-Zsanitizer` during a link.

Why protected output cannot change:
- **Every protected suite passes `--sysroot`.** harness/compiletest.ts adds the oracle sysroot unless the test sets its own, harness/cli.ts passes it to every print case, and suites.ts passes it to the rest (review ssa-linker §2). So every reader in group 1 sees `explicit`, not the default. Target search, crate search, `real_source_base_dir`, `--print sysroot` / `target-libdir` and every diagnostic path are unchanged.
- **Groups 2 and 3 are reached only during a native link.** Before this change, every call to `get_linker` stopped (`unported`), because `all_paths()` always held the stand-in. So no protected case can reach a link today: such a case was UNPORTED, and the protected set holds only passing cases. `find_sanitizer_runtime` sits behind the same link.
- **Miri.** The interpreter reads no sysroot outside `get_codegen_backend` (the llvm backend does not read it). `run-pass-miri` cases get `--sysroot` from the harness.
- **What does change** happens only without `--sysroot`, which no suite runs: `--print sysroot` / `target-libdir` now match the oracle; crate search finds the oracle's std; links get the oracle's `PATH`. All of this moves toward the oracle.

## Evidence

- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: markers ok (27155).
- `bun scripts/coverage.ts --missing`:
  - `compiler/rustc_session/src/session.rs`: 97/104. `get_tools_search_paths` is now ported. The 7 left are `function_pointers_default`, `init_fini_default`, `default`, `from_raw`, `deref`, `deref_mut` and `is_wasi_reactor`, none of them this lane's.
  - `compiler/rustc_session/src/filesearch.rs`: 7/14. Unchanged and unmarked on purpose: `dll_path` ×3, `current_dll_path`, `default_sysroot`, `default_from_rustc_driver_dll` and `from_env_args_next`. Upstream's logic (argv[0] / `dladdr`) is not what the port runs, so `default_sysroot` keeps no marker. Its body is the decided stand-in, described in its PORT comment.
  - `compiler/rustc_session/src/config.rs`: 136/136.
  - `back/linker.rs`: 218/218.
  - `back/command.rs`: 18/18.
- `RUST_TS_REQUIRE_PROBES=1 bun test ./src/rustc_session/ ./src/rustc_codegen_ssa/back/ ./src/rustc_interface/ ./src/std/ ./scripts/lib/unit-steps.test.ts`: **314 pass, 0 fail** (47 files, 70.6 s).
- `RUST_TS_REQUIRE_PROBES=1 bun test ./src/rustc_driver_impl/print.oracle.test.ts ./src/rustc_driver_impl/driver.oracle.test.ts`: 185 + 47 pass after the updates above.
- **The decision's evidence.** `linker_args.oracle.test.ts` passes byte for byte, `PATH` included, with no injection: 11 cases, 1 test.
  - Mutation check: I made `default_sysroot` return `<sysroot>/.` (a re-derived variant) and disabled the direct assert. The test fails on the `PATH` comparison, then passes again once restored. So the `PATH` entries are compared, not normalised away.
- `regen.ts` rerun with the N4 change (every case must exit 0): all 11 cases exit 0, and the fixtures are reproduced byte for byte (no git diff).

### Samples (`--sample 200 --jobs 6`, `RUST_TS_AGENT=default-sysroot-w40r`)

| Suite | Result | Run |
|---|---|---|
| check-ui | MATCH 200/200 | 20261114-132423-default-sysroot-w40r-sh7c |
| parse-ui | MATCH 200/200 (8 skipped) | 20261114-132457-default-sysroot-w40r-iph1 |
| pm-ui | MATCH 200/200 (2 skipped) | 20261114-132529-default-sysroot-w40r-pk2c |
| rmeta-ui | MATCH 200/200 | 20261114-132604-default-sysroot-w40r-3xow |
| mono-ui | MATCH 199/200, DIFF 1 (488 skipped) | 20261114-132640-default-sysroot-w40r-he5o |
| mir | MATCH 200/200 (1 skipped) | 20261114-132740-default-sysroot-w40r-279t |
| run-pass-miri | MATCH 200/200 (497 skipped) | 20261114-132825-default-sysroot-w40r-3s95 |

**Status changes: none.**
- The one non-MATCH is mono-ui `tests/ui/rustc-env/def-path-hash-ice-157238.rs`: DIFF, first difference at line 646. The oracle prints `INFO rustc_codegen_ssa::base codegen_instance(std::rt::lang_start::<()>)`; the subject prints `INFO rustc_interface::passes Post-codegen`.
- It is **not protected**: it is not in harness/baseline/mono-ui.txt.
- It is **the same on main**: e80bc814, in a temporary detached worktree, gives the same DIFF at the same first difference (run `*-default-sysroot-w40r-main-*`). It also reproduces on this branch alone (run 20261114-133054-default-sysroot-w40r-gf2j).
- So it predates this lane. No protected case was lost in any sample.

## unported(...) left

- `rustc_session::filesearch::default_sysroot (rustc +<toolchain> --print sysroot failed: <reason>)`: new. It fires only when the oracle toolchain cannot be run.
- `rustc_session::filesearch::current_dll_path`: unchanged.
- Removed:
  - `rustc_session::filesearch::default_sysroot (crate search in the default sysroot; pass --sysroot)`
  - `... (the path of the default sysroot; pass --sysroot)`
  - `... (the default sysroot's tools directory in the linker's PATH)`

## PORT decisions

- `default_sysroot`: the oracle's sysroot, found as above (the decision 2026-11-14 and its reasoning are in the comment).
- `Sysroot.default_` read lazily (`PORT(perf)`, ~52 ms per process saved).
- `Sysroot`'s constructor takes `default_: PathBuf | undefined`, where `undefined` means "compute on first read". Only `Sysroot::new` passes `undefined`.
- linker.ts `get_tools_search_paths`: a forwarder, not an upstream fn, so it has no marker. The marker is on `Session.get_tools_search_paths`.
- N1 (linker.ts, `AixLinker::export_symbols`): a PORT note says `to_str().unwrap()` is dropped because paths are strings.
- N2 (linker.ts, `MsvcLinker::debuginfo`): the PORT note now says `DirEntry::file_name` is lossy and a non-UTF-8 natvis name would print differently. That is unreachable, since an MSVC target needs `link.exe`.
- N3 (command.ts):
  - `debug_os_str` is now `debug_str` from src/std/fmt.ts (no second copy).
  - `ExitStatus.success` is now upstream's `exit_ok().is_ok()`, i.e. `status == 0`. It used to be `code() == Some(0)`, which gives the same result for the statuses the port builds.
  - `success` and `signal` carry `// after std:` pointers (process.rs:1986, unix.rs:1109; os/unix/process.rs:420, unix.rs:1125).
- N4 (regen.ts): the comment now says the oracle *warns* that `rust-objcopy` failed and exits 0. I checked this by hand for host-bin-strip: exit 0, `warning: stripping debug info with rust-objcopy failed: exit status: 1`. The exception is removed, so every case must now exit 0.

## Decisions for root

1. Record the lazy `Sysroot.default_` (`PORT(perf)`) as a decision, with adversarial review per PORTING §3. It moves a read whose only possible effect is an `unported` stop when the oracle cannot be run.

## Requests for other owners

- **harness (harness-m7b or a later harness batch).** Two comments say the port has no default sysroot: harness/cli.ts:21 and harness/target-specs.ts:12. They are stale now. Behaviour need not change: passing `--sysroot` is still right.
- **ssa-link-b / root at integration.** Update driver.oracle.test.ts's two PENDING texts (`ssa-link-b: self_contained_components`) once link.ts has no cross-lane stubs left.
- **ssa-link-b.** The xlane `get_tools_search_paths` in link.ts (:2309–2313) can call `sess.get_tools_search_paths` directly now. Its PORT note "lives in back/linker.ts until rustc_session…" is stale.
- **owner of `src/rust_ts/llvm/tools.ts`.** `oracle_sysroot()` could reuse `rustc_session/filesearch.ts` `default_sysroot()`, to save the second spawn in a linking process.
