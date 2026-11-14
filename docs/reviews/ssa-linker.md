# Review: lane ssa-linker (wave 40q)

Reviewer: independent, read-only on code.
Subject: branch `t3/port-ssa-linker-command`, commits `2c5d3ed6` and `e53eb992`, on top of main `bcbd0c28`. The handoff is `docs/handoff/ssa-linker.md`.
Pin: `6f5da406b56c` (1.101.0-nightly).

## Verdict: APPROVE WITH NITS

The lane brings `back/linker.rs` to 218/218 fns, `back/command.rs` to 18/18 and `linker/tests.rs` to 2/2. It also adds the part of std's unix `Command` that `--print link-args` prints.

- **Fidelity.** Every function I compared matches upstream at the pin: the same order, logic, names and argument strings. No value is guessed, and every stop is named in the handoff.
- **Evidence.** It is real. The fixtures are the oracle's, regeneration reproduces them byte for byte, and four of the five mutations I tried fail the oracle test or the command test (the fifth fails `linker/tests.rs`).
- **Sysroot finding.** It is correct, and so is its analysis. The recommended fix is safe for the protected suites (§2).

No must-fix findings.

## 1. Fidelity

Method:
- I read `get_linker`, the arg helpers, the `generate_arg_methods!` expansion, the `Linker` trait (including the provided methods), `impl dyn Linker`, all of `GccLinker`, `command.rs`, and the std `Command` `Debug` path against the pin.
- A helper read `MsvcLinker`, `EmLinker`, `WasmLd`, `AixLinker`, `LlbcLinker`, `BpfLinker` and the symbol-list functions, linker.rs:900–1961, against upstream. It reported 141 markers from line 900 on, matching upstream's `fn` lines one for one. I spot-checked its two nits (N1, N2).
- `bun scripts/coverage.ts --check`: markers ok.

Points looked at hardest:

- **`get_linker`** (linker.ts:166 / linker.rs:50).
  - **Program choice.** `Command::lld` for the four `Lld::Yes`/`WasmLld(No)` flavors, `msvc_tool` for `Msvc(No)` without a configured linker, `bat_script` only on a Windows host. All as upstream.
  - **`PATH`.** It is `get_tools_search_paths(self_contained)`, then the MSVC tool's `PATH` (a found tool stops first), then `var_os("PATH")` when MSVC did not change it. The paths are joined with unix `join_paths` (a `:` inside a path panics with `unwrap`'s message).
  - **`get_tools_search_paths`** (linker.ts:104) is session.rs:825 exactly: `all_paths()` → `make_target_bin_path(_, host_tuple())`, and with `self_contained` each path is followed by `<path>/self-contained`.
  - **`Sysroot::all_paths`** at the pin (config.rs:1447) is `explicit.into_iter().chain(once(&default))`: always both.
  - **Flavor dispatch.** The `Unix(No)`+AIX and `WasmLld(No)` guards come before the `Gnu | Darwin | WasmLld | Unix` arm, as in upstream's match order. `is_ld: cc == No`.
  - **`find_msvc_tool`** (linker.ts:77). I checked it against find-msvc-tools-0.1.11 `find_tool` / `find_tool_with_env` / `TargetArch::new` and the `cfg(not(windows))` `impl_`:
    - the `split_once("-")` + `contains("msvc")` bail-out;
    - the arch list;
    - `msbuild`/`devenv`;
    - the substring `any` over `clang, lldb, llvm, ld, lld`;
    - `VCINSTALLDIR`/`VSINSTALLDIR`.

    It is all faithful, and the remaining search stops.
- **`generate_arg_methods!`** (linker.ts:543–574). There is one copy on `DynLinker`, with markers at the macro's `fn` lines 240–268. Each method forwards to the free helper with `iter::once` → `[arg]`. Upstream generates the same bodies for every impl and for `dyn Linker`, and in TS `is_cc()` dispatches virtually, so a single copy behaves identically.
- **`convert_link_args_to_cc_args`** (linker.ts:309 / linker.rs:185). `-Wl` accumulation, a comma in an argument (flush, then `-Xlinker`), the final flush, and comparison against the bare `-Wl`. All exact.
- **`GccLinker`.**
  - `hint_static`/`hint_dynamic`: the `takes_hints()` guard, the `Some(true)`/`Some(false)` tri-state as `boolean | undefined`, and `-Bstatic`/`-Bdynamic` through `link_arg`.
  - `gc_sections`: `-dead_strip` on Darwin, else `--gc-sections` when `(is_gnu || is_like_wasm) && !keep_metadata`.
  - `debuginfo`: early return on Darwin; `--strip-debug` unless Solaris; `--strip-all`; the two `--compress-debug-sections`.
  - `export_symbols`:
    - the executable early return;
    - `limit_rdylib_exports`;
    - Apple's `_name\n` list with `-exported_symbols_list`;
    - windows-gnu's `EXPORTS` with `  "name"[ DATA]`;
    - wasm's `--export` pairs;
    - the executable `--dynamic-list` `{ name; };`;
    - the version script `{\n  global:\n    name;\n` … `\n  local:\n    *;\n};\n` with `--version-script=` + `--no-undefined-version`, or `-M` on Solaris.

    Every `writeln!` terminator is `\n`.
  - The rest also match upstream line for line: `build_dylib` (`-dynamiclib`/`-dylib`, `@rpath/` install name, `-shared`, `--out-implib=` via `with_file_name`, `-soname=` only for `Dylib`), `with_as_needed`, `set_output_kind` (all seven kinds, VxWorks `--static-crt`, AVR `-mmcu=`), `link_*`, the relro args, `optimize`, `pgo_gen`, `enable_profiling`, `linker_plugin_lto` / `push_linker_plugin_lto_args` (O-level table, the GCC `-` prefix), `add_eh_frame_header`, `add_no_exec` and `add_as_needed`.
- **`MsvcLinker` and the others.** The helper found no discrepancy in any branch, flag or file format. That covers:
  - MSVC: `/OPT:REF,ICF`/`NOICF`, `/DEBUG`, `/PDBALTPATH:%_PDB%`, natvis, `lib.def` with `LIBRARY\nEXPORTS\n`, `/DEF:`, `/SUBSYSTEM:` + `/ENTRY:mainCRTStartup`, `/guard:ehcont` only at 64-bit;
  - EmLinker: `-sEXPORTED_FUNCTIONS=` JSON with the `_main` substitution;
  - WasmLd: `--export`, `--lto-O*`;
  - Aix: `-bexpfull`, `-bE:`;
  - Llbc and Bpf.

  The symbol-list functions (`exported_symbols` … `linked_symbols`) are unchanged from `bcbd0c28` except for the import block.
- **`command.rs`** (command.ts). All 18 fns are in order:
  - `command()` builds `cmd /c p` and `p -flavor <desc>`, then args, `envs`, `env_remove`s and `env_clear`, in upstream's order. So `env_clear` after the changes drops them, as std does.
  - `very_likely_to_exceed_some_spawn_limit`: the unix sum, and `sysconf(_SC_ARG_MAX)` with the pinned libc's constants (Apple 1, Linux 0) and the `-1` early return.
- **`Command` `Debug`** (std at the pin). The non-alternate branch of `impl fmt::Debug for Command` is library/std/src/sys/process/unix/common.rs:540–575:
  - `env -i ` or `env -u K ` per removal (`to_string_lossy`), then `K={value:?} `.
  - `[{program:?}] ` only when it differs from `args[0]` (never here), then `{args[0]:?}` (a `CString`), then ` {:?}` for each `get_args()` item. `CommandArgs` yields `&OsStr` (common.rs:613).
  - **The program.** `CString` → `CStr` Debug → `ByteStr` Debug (core/src/bstr/mod.rs:157): `\0`, then `(c as u8).escape_ascii()` for `\x01..=\x7f` (`\'` and `\"` escaped, lowercase `\xNN` per core/src/escape.rs:9), else `c.escape_debug()`. `debug_cstr`/`escape_ascii` (command.ts:272, :284) match.
  - **The arguments and values.** `OsStr` Debug on unix → `Utf8Chunks::debug` (core/src/str/lossy.rs:114), which uses `escape_debug_ext { escape_single_quote: false, escape_double_quote: true }`. So `'` stays and `"` is escaped, as `debug_os_str` does.
  - So yes: the arguments are str-style and the program is C-string style, as the lane says.
  - `CommandEnv` (`BTreeMap` order by bytes, `remove` under `clear`, `clear()` empties vars) matches sys/process/env.rs.
- **Ptx / L4Bender.** Neither exists at the pin.
  - The only impls in linker.rs are Gcc, Msvc, Em, WasmLd, Aix, Llbc and Bpf.
  - `LinkerFlavor` (rustc_target spec/mod.rs:113) has `Gnu, Darwin, WasmLld, Unix, Msvc, EmCc, Bpf, Llbc`.
  - L4Re is mentioned only in a comment, as a `Unix` flavor user.
- **Stops.** The code has nine `unported(...)` calls (linker.ts:78, 97, 208, 221, 242; command.ts:166, 344, 434, 454), and all nine are in the handoff. The UWP stop (linker.ts:208) can only be reached through a found `link.exe`, and finding one stops first, so it is dead in practice, as the handoff says.

## 2. The sysroot finding

**The claim is correct.** `get_tools_search_paths` maps `sysroot.all_paths()`, and at the pin that is always explicit-then-default, even when `--sysroot` is given (config.rs:1446 says so: "Returns both explicit sysroot if it was passed with `--sysroot` and the default sysroot").

- The port's default is `DEFAULT_SYSROOT_STANDIN` (rustc_session/filesearch.ts:171). So the second `PATH` entry would be `<rust-ts: default sysroot unported>/lib/rustlib/<host>/bin`.
- That path contains `:`, so upstream's `join_paths(..).unwrap()` would panic on it.
- The lane stops instead (linker.ts:216–222), in the same spirit as `displayed_sysroot_path` and the `get_library_candidates` stop. That is the right call: a guessed path would put a wrong line into `--print link-args`.
- Every real native link therefore stops at `get_linker` today.
- The oracle fixtures show the doubled entry: `PATH="$SYSROOT/lib/rustlib/aarch64-apple-darwin/bin:$SYSROOT/lib/rustlib/aarch64-apple-darwin/bin:$INHERITED"`. Mutation M5 below (keeping only the first `all_paths` entry) fails the oracle test, so the entry count is compared, not normalised away.

**Where the default sysroot reaches upstream behaviour at the pin.**
- `all_paths()` users:
  - `Session::get_tools_search_paths` (linker `PATH`; link.rs's self-contained/gcc-ld paths use it too);
  - `rustc_interface::util::get_codegen_sysroot` (util.rs:547, non-builtin backends only);
  - codegen_gcc;
  - enzyme_ffi / offload_ffi.
- `sysroot.default` directly: link.rs:1799 `link_sanitizer_runtime` (`find_sanitizer_runtime`'s fallback).
- `Sysroot::path()`, which is the default only without `--sysroot`:
  - target search for a JSON target;
  - `host_tlib_path`/`target_tlib_path` (crate search);
  - `real_rust_source_base_dir` / `real_rustc_dev_source_base_dir` (config.rs:3004, which un-remap `/rustc/<hash>/library` paths in diagnostics when rust-src is installed);
  - `--print sysroot` / `target-libdir` (rustc_driver_impl/lib.ts:711, :714 via `displayed_sysroot_path`);
  - `MsvcLinker::debuginfo`'s natvis dir.

**In the port today.**
- `sysroot.default_` is read only through `all_paths()` (linker.ts:105) and `path()`.
- `get_codegen_sysroot` is not ported: a non-builtin backend stops in `get_codegen_backend` (rustc_interface/util.ts:244).
- `link_sanitizer_runtime` is ssa-link-b's.

**Is the recommendation safe for the protected suites? Yes.**
- Every protected suite passes `--sysroot`:
  - harness/compiletest.ts:993 adds the oracle sysroot unless the test sets its own `--sysroot`;
  - harness/cli.ts:163 passes it to every print case, and leaves out `sysroot`/`target-libdir` without `--sysroot` by design (cli.ts:33);
  - suites.ts passes it to the rest.
- With an explicit sysroot, `path()` does not depend on the default. So target search, crate search, `real_rust_source_base_dir`, diagnostics paths and `--print sysroot`/`target-libdir` are all unchanged.
- The only consumers left are the `all_paths()` ones above. Today they either stop (linker `PATH`, non-builtin backends) or are unported (sanitizer runtime, enzyme/offload). So no protected output can change.
- The stops it would lift fire only in runs without `--sysroot`, which no suite has: crate search in the default sysroot, `displayed_sysroot_path`, and this lane's linker stop.

**Which outputs it changes.**
- `--print link-args` and real links: they would match the oracle once link.rs lands.
- Runs without `--sysroot`: `--print sysroot`/`target-libdir` would print the oracle's toolchain path (what the oracle prints). Crate search would find the oracle's std instead of stopping. Diagnostics into std could show rust-src paths if that component is installed, as the oracle's would.

All of these move toward the oracle.

**Caveats for root's decision.**
1. The default must be the same string the oracle reports (`rustc +<pin> --print sysroot`, e.g. `~/.rustup/toolchains/nightly-2026-10-11-aarch64-apple-darwin`), not a re-derived or canonicalised variant. Otherwise the doubled `PATH` entry differs.
2. Finding it at run time means the subject asks the oracle toolchain where it lives. rust_ts/llvm/tools.ts:70 already does exactly that for the pinned LLVM tools, so there is precedent, but it should be a recorded decision with a fixed `RUSTUP_AUTO_INSTALL=0` spawn, or come from `.env.local`.
3. I checked that rustup's proxy does not change the inherited `PATH`: the oracle's entries after the two sysroot ones equal the caller's `$PATH` exactly. So a future link difftest needs only `$TMP`-style normalisation, not `$INHERITED`, as long as both sides run with the same environment.

## 3. Evidence

- **Re-runs.**
  - `RUST_TS_REQUIRE_PROBES=1 bun test …/linker_args.oracle.test.ts …/command.test.ts`: 6 pass, 0 fail (0.9 s).
  - Linker test: all 11 cases same, 10 compared lines plus 4 export lists.
- **Fixtures.**
  - Re-running `bun src/rustc_codegen_ssa/back/linker_oracle/regen.ts` (with `RUST_TS_AGENT=review-ssa-linker`) rewrote every `oracle/*.args` and `*.list`, and `git status` was clean afterwards: byte-identical.
  - The fake `cc` (common.ts:65) only copies the list file and exits 0. It is named `cc`, so `with_linker_hints` keeps the target's flavor.
  - The lines come straight from the pinned rustc's `--print link-args`, which runs before the linker.
- **Normalisation is limited to variable parts.**
  - `$WORK` and `$SYSROOT` are machine paths and are applied identically to both sides.
  - `$TMP` matches only `/rustc` + 6 alphanumerics before `/` or `"`, which is the `TempDirBuilder` name. The port's side uses a fixed `rustcPORT00`.
  - `$INHERITED` replaces only the entries after the leading `$SYSROOT/…` ones. Those are the caller's environment, which I verified the oracle passes through unchanged. The `$SYSROOT` entries themselves and their count stay compared (M5).
  - Nothing normalises a flag, an order or a quoting.
- **Driver order vs `linker_with_args`** (link.rs at the pin, ssa-link-b's). The test's `drive` follows upstream's order:
  - `get_linker` → `export_symbols` → `add_pre_link_args` → objects (linked-symbol, local regular, metadata, allocator) → `add_as_needed` → upstream crates and native libs → `include_path(raw-dylibs)` on ELF → `reset_per_library_state`;
  - then the order-independent options: Apple args and SDK, eh-frame-hdr, no-exec, plugin LTO, library search dirs, `-o`, gc_sections, output kind, relro, optimize, debuginfo, no-default-libraries;
  - then `link_natively`'s `disable_localization`, `link_env` and `link_env_remove` on the taken command.

  **Can matching output hide a wrong order?**
  - Not for what the port emits. Everything that comes from the port (hints, `--as-needed`, export args, `-L`, `-o`, relro, strip, pie, env) is placed by the driver's call order, so a wrong order fails the comparison.
  - What it cannot check is what comes from the fixture: the objects, the libraries and the Apple `-arch` pair are replayed in the oracle's own positions. So the test checks the methods, not `linker_with_args`.
  - The driver also skips steps that are no-ops for these targets (pre-link objects, sanitizers, local native libs, late/post link args).
  - The handoff says this and asks ssa-link-b to swap `drive` for the real function. That is the right follow-up.

## 4. Mutations

Each mutation was applied, the three test files were run with `RUST_TS_REQUIRE_PROBES=1`, and the mutation was reverted with `git checkout`. The tree was verified clean afterwards.

| # | Mutation | Result |
|---|---|---|
| M1 | `convert_link_args_to_cc_args`: `combined_arg += ","` → `";"` (the `-Wl,` join) | 3 fail (oracle test, `test_rpaths_to_args`, `test_xlinker`) |
| M2 | `GccLinker::debuginfo` `Strip::Symbols`: `--strip-all` → `--strip-debug` | oracle test fails (linux-bin-strip) |
| M3 | `escape_ascii` (program `CStr` escape table): `'` → unescaped | `Debug escapes` test fails |
| M4 | `hint_static`: drop the `hinted_static !== true` guard | oracle test fails (linux-dylib) |
| M5 | `get_tools_search_paths`: keep only the first `all_paths()` entry | oracle test fails (`PATH`) |

## 5. Regressions

- `bunx tsc --noEmit -p .`: exit 0.
- `bun scripts/coverage.ts --check`: markers ok (27088).
- `RUST_TS_REQUIRE_PROBES=1 bun test ./src/rustc_codegen_ssa/ ./scripts/lib/unit-steps.test.ts`: 162 pass, 0 fail. The handoff's 165 also counted `src/std/result.test.ts`.
- `RUST_TS_AGENT=review-ssa-linker-r1 bun scripts/difftest.ts --suite check-ui --sample 200 --jobs 6`: MATCH 200/200 (run `20261114-061639-review-ssa-linker-r1-x7fm`).
- **Environment reads.**
  - The tests read only `RUST_TS_REQUIRE_PROBES` and `RUST_TS_AGENT`, in the same pattern as the existing oracle tests (symbol_names, liveness, built_lints, …). `regen.ts` spreads `process.env` into the oracle spawn, as other regen scripts do. Nothing new.
  - Under `src/` outside tests, the new reads are `var_os("PATH")`, `VCINSTALLDIR` and `VSINSTALLDIR` (all upstream's own) and `process.env` as the inherited environment in `ProcessCommand.output()` (std's inherit semantics).
- No `process.stdout`/`process.stderr` and no `console.*` under `src/` outside the test and regen files.
- **`Bun.spawnSync`.** `ProcessCommand.output()` (command.ts:445) uses the same primitive and options as rust_ts/llvm/tools.ts:113 (`stdin: "ignore"`, piped stdout and stderr, signal names through `os.constants.signals`). It passes an explicit env built from `process.env` plus the changes, which is equivalent to Bun's default inheritance plus std's `envs`/`env_remove`/`env_clear`. It is stricter than tools.ts on an unknown signal: it stops rather than mapping to 0.

## Findings

No F findings.

- **N1.** linker.ts:1998 vs linker.rs:1606 (`AixLinker::export_symbols`). Upstream writes `format!("-bE:{}", path.to_str().unwrap())`, which panics on a non-UTF-8 path. The port writes `` `-bE:${path}` `` with no note. Paths are strings in the port, so this is unreachable, but add a one-line `// PORT:` saying the `unwrap` is dropped for that reason.
- **N2.** linker.ts:1390–1391 vs linker.rs:1104 (`MsvcLinker::debuginfo`, `entry.path()`). The PORT note says `DirEntry::path` is the root joined with `file_name()`. But `src/std/fs.ts` `DirEntry.file_name()` is lossy, while upstream joins the raw `OsStr`, so a non-UTF-8 natvis file name would print differently. Unreachable in practice: MSVC targets need `link.exe`, which stops. Mention the lossiness in the note, or add `DirEntry::path` to src/std (via the src/std owner).
- **N3.** command.ts:304 `debug_os_str` duplicates `debug_str` (src/std/fmt.ts:212) byte for byte, which already implements `<str as Debug>` (the same `escape_debug_ext { single: false, double: true }`). Import it rather than keep a second copy. Separately, `ExitStatus.success`/`signal` (command.ts:328, :333) lack the `// after std:` pointer that `code()` has (unix.rs `exit_ok` / `signal`).
- **N4.** linker_oracle/regen.ts:32–34. The comment says `-Cstrip` on Apple "fails" after the fake link, and the exit-code check makes an exception for it. At the pin the oracle exits 0 for host-bin-strip, so both the comment and the exception are stale. Correct the comment; keeping the tolerance is harmless.

## For root

- **Decision needed.** Make the port's default sysroot the pinned oracle's sysroot (§2). I find this safe for every protected suite, and it is the only way the linker `PATH` can byte-match. Record how the path is obtained (the tools.ts precedent, or `.env.local`), and require that it is the exact string the oracle prints.
- **Request carried forward.** Move `get_tools_search_paths` into rustc_session/session.ts. Its marker should move with it: it currently has none, as a documented copy.
