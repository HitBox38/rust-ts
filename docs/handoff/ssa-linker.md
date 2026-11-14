# Handoff: ssa-linker (M7b, wave 40q)

`compiler/rustc_codegen_ssa/src/back/linker.rs` ported whole, plus `back/command.rs` and `back/linker/tests.rs`.

## Files

| File | What |
|---|---|
| `src/rustc_codegen_ssa/back/linker.ts` | linker.rs whole: `disable_localization`, `get_linker`, the arg helpers, `generate_arg_methods!`, `trait Linker` (+ `Linker_provided`), `impl dyn Linker`, every impl (`GccLinker`, `MsvcLinker`, `EmLinker`, `WasmLd`, `AixLinker`, `LlbcLinker`, `BpfLinker`), and the symbol lists already there (`exported_symbols`, `linked_symbols`, ...) |
| `src/rustc_codegen_ssa/back/command.ts` (new) | command.rs whole, and the part of std's unix `process::Command` it needs (`ProcessCommand`: argv, `CommandEnv`, `Debug`, `output()`), `Output`, `ExitStatus` |
| `src/rustc_codegen_ssa/back/linker/tests.test.ts` (new) | linker/tests.rs (`test_rpaths_to_args`, `test_xlinker`) |
| `src/rustc_codegen_ssa/back/command.test.ts` (new) | unit tests of command.ts (Debug, env, `output`, spawn limit) |
| `src/rustc_codegen_ssa/back/linker_args.oracle.test.ts` (new) | the link-args evidence (below) |
| `src/rustc_codegen_ssa/back/linker_oracle/` (new) | `common.ts` (cases, normalisation, fake linker), `regen.ts` (by hand only), `hello.rs`, `lib.rs`, `oracle/<case>.args` / `.list` |

No other file was touched. There are no PLAN/ PORTING changes. Ptx and L4Bender linkers do not exist at the pin, so there is nothing to port for them.

## Coverage

- `bun scripts/coverage.ts --missing compiler/rustc_codegen_ssa/src/back/linker.rs`: **218/218** (was 7/218)
- `... back/command.rs`: **18/18** (was 0/18)
- `... back/linker/tests.rs`: **2/2** (was 0/2)
- `bun scripts/coverage.ts --check`: markers ok.

## Exports for link.rs (ssa-link-a, ssa-link-b)

From `back/linker.ts`:
- `get_linker(sess, linker, flavor, self_contained, target_cpu, codegen_backend): DynLinker` (link.rs:2886)
- `disable_localization(cmd: Command)` (link.rs:1273)
- `DynLinker`: the type for `&mut dyn Linker` / `Box<dyn Linker>`. Every impl extends it. It has all trait methods, the `generate_arg_methods!` methods (`verbatim_args`, `verbatim_arg`, `link_args`, `link_arg`, `cc_args`, `cc_arg`, `link_or_cc_args`, `link_or_cc_arg`; each returns `this` for chaining) and `take_cmd()`.
- `Linker` (the trait as an interface) and `Linker_provided`
- `exported_symbols(tcx, crate_type)`, `linked_symbols(tcx, crate_type)` (base.ts already uses them)
- `convert_link_args_to_cc_args(cmd, args)` (exported for the tests)
- `get_tools_search_paths(sess, self_contained)`: `Session::get_tools_search_paths` (session.rs:825). session.ts does not have it yet; see the requests below. link.rs uses it too (`add_gcc_ld_path` and others).
- `Command` (re-exported from command.ts)

From `back/command.ts`:
- `Command` (`new`, `bat_script`, `lld`, `arg`, `args`, `env`, `env_remove`, `env_clear`, `output`, `command`, `get_args`, `take_args`, `very_likely_to_exceed_some_spawn_limit`, `clone`)
- `debug_Command(cmd)`: `{:?}`, which is what `--print link-args` prints (link.rs:1284) and what `LinkingFailed` formats (diagnostics.rs:20 imports `Command`)
- `Output { status, stdout, stderr }`, `ExitStatus` (`code()`, `success()`, `signal()`), `display_ExitStatus`
- `ProcessCommand` (what `command()` returns)

## Link-args evidence

`linker_args.oracle.test.ts` builds each case's command line through the port's `get_linker`, the `Linker` methods and `Command`. It compares the resulting `Debug` line with the oracle's `--print link-args` byte for byte after normalisation. It also compares the exported-symbols file the port writes with the file the oracle's linker received.

`linker_with_args` and `add_order_independent_options` belong to ssa-link-b. A small driver in the test stands in for them. It calls the port's methods in their order, with the decisions they take from the session and the target spec (pre-link args, relro, eh-frame-hdr, no-default-libraries, gc_sections/link-dead-code, `link_env`, `link_env_remove`). Some inputs come from the fixture, because only link.rs makes them:
- the object files;
- the library list, passed as link.rs passes it (`.rlib` → `link_staticlib_by_path`, crate dylib → `link_dylib_by_path`, `-l` → `link_dylib_by_name`);
- Apple's `-arch` / `-mmacosx-version-min` and `SDKROOT`;
- the output path;
- `link_output_kind`, as a value per case.

Everything else in the line comes from the port: `PATH` and the rest of the environment, the `-Wl,` wrapping, the `-Bstatic`/`-Bdynamic` hints, `--as-needed`, export lists, `-L`, `-o`, `-dead_strip`/`--gc-sections`, `-pie`/`-no-pie`, `-shared`/`-soname`/`-dynamiclib`, relro, `--strip-all` and `-nodefaultlibs`. The `Debug` formatting is the port's too: `env -u`, sorted variables, and the quoting.

| Case | Target | Result |
|---|---|---|
| host-bin | aarch64-apple-darwin | same |
| host-bin-strip (`-Cstrip=symbols`) | aarch64-apple-darwin | same (no linker arg on Apple; rustc strips afterwards) |
| host-bin-dead (`-Clink-dead-code`) | aarch64-apple-darwin | same (no `-dead_strip`) |
| host-dylib (`-Cprefer-dynamic`) | aarch64-apple-darwin | same, export list same (3 symbols incl. `rust_metadata_*`) |
| host-cdylib | aarch64-apple-darwin | same, export list same (`_exp_c`) |
| host-staticlib | aarch64-apple-darwin | not reachable: the oracle prints no line, because a staticlib is archived, not linked |
| linux-bin | x86_64-unknown-linux-gnu | same (`-pie`, `--eh-frame-hdr`, `-z noexecstack`, relro) |
| linux-bin-static-reloc (`-Crelocation-model=static`) | x86_64-unknown-linux-gnu | same (`-no-pie`) |
| linux-bin-strip (`-Cstrip=symbols`) | x86_64-unknown-linux-gnu | same (`--strip-all`) |
| linux-cdylib | x86_64-unknown-linux-gnu | same, version script same |
| linux-dylib (`-Cprefer-dynamic`) | x86_64-unknown-linux-gnu | same (`-soname`, `-Bdynamic`/`-Bstatic` around the std dylib and compiler_builtins), version script same |

All 11 cases pass in about 1 s.

How the fixtures are made. The script is `bun src/rustc_codegen_ssa/back/linker_oracle/regen.ts`, run by hand only. Each oracle run uses `-C linker=<work>/fake/cc`. That script copies the export file and exits 0. It is named `cc`, so `with_linker_hints` keeps the target's own flavor, and nothing links, so the Linux cases need no Linux sysroot.

Normalisation is the same on both sides (common.ts `normalise`):
- the work directory becomes `$WORK`, and the oracle's sysroot becomes `$SYSROOT`;
- the link's temp directory, `rustc` + 6 random characters, becomes `$TMP`. This is the only random part;
- in `PATH`, the entries after the sysroot tool directories (the environment's own `PATH`) become `$INHERITED`.

The `Debug` escaping was checked separately against the oracle (command.test.ts). Arguments print as `OsStr`: `'` is left as is, and U+0001 becomes `\u{1}`. The program prints as `CStr`: `'` becomes `\'`.

## unported(...) left

linker.ts:
- `find_msvc_tools::find_tool (Windows host)`
- `find_msvc_tools::find_tool (find_msvc_environment's search with VCINSTALLDIR and VSINSTALLDIR set)`. On unix the crate decides everything else without searching: an unknown arch, a non-MSVC target and the msbuild/devenv/LLVM tools give `None`, and so does an unset `VCINSTALLDIR` or `VSINSTALLDIR`.
- `rustc_codegen_ssa::back::linker::get_linker (UWP /LIBPATH from a found link.exe)`: in practice unreachable, since finding `link.exe` stops first.
- `rustc_session::filesearch::default_sysroot (the default sysroot's tools directory in the linker's PATH)`. **This stops every link today**; see below.
- `rustc_codegen_ssa::back::linker::get_linker (a PATH that is not UTF-8)`

command.ts:
- `Command::very_likely_to_exceed_some_spawn_limit (Windows host)`, `std::process::Command::output (Windows host)`
- `std::process::Command::output (a child ended by an unknown signal: ...)`
- `std::sys::process::unix::ExitStatus Display of a signal (signal_string)`: the signal-name table is not ported. Exit codes display.

### Needs a root decision: the default sysroot reaches the linker's PATH

`get_linker` sets `PATH` to `get_tools_search_paths()` followed by the inherited `PATH`. `get_tools_search_paths` maps `sysroot.all_paths()`, which is always the explicit `--sysroot` *and* the default sysroot. The oracle's default sysroot is its own toolchain, so its line has the sysroot `bin` directory twice. The port's default is `DEFAULT_SYSROOT_STANDIN` (`<rust-ts: default sysroot unported>`, rustc_session/filesearch.ts). That path contains `:`, so upstream's `join_paths(...).unwrap()` would panic. Following the precedent of `displayed_sysroot_path` (a stand-in path on its way to the output stops), `get_linker` calls `unported` on it.

So until the default sysroot is modelled, every native link stops at `get_linker`. The test sets `config.opts.sysroot.default_` to the oracle's sysroot, an input the port cannot know, and says so in the test. Recommended decision for root (it touches `rustc_session/filesearch.ts`, which this lane does not own): make the port's default sysroot the pinned oracle toolchain's sysroot (what `rustc +<pin> --print sysroot` prints). The port stands in for that binary, and every suite already passes the same path as `--sysroot`.

## PORT decisions

- `Box<dyn Linker>` is the abstract class `DynLinker`. It holds the provided-method defaults (calls into `Linker_provided`, where their markers are), one copy of the `generate_arg_methods!` methods (markers at the macro's lines 240–268), and `take_cmd`.
- Each impl's field `cmd` is `cmd_`, because the trait method `cmd()` has the same name. Command's fields `args`/`env`/`env_remove`/`env_clear` are `f_args`/`f_env`/`f_env_remove`/`f_env_clear` for the same reason.
- `OsString`/`OsStr` are JS strings; their UTF-8 bytes are used where upstream reads `as_encoded_bytes()`. `PATH` is joined as bytes (`env::join_paths`, unix rules) and then decoded.
- `find_msvc_tools::find_tool` (external crate find-msvc-tools 0.1.11) is the local `find_msvc_tool`, covering what the crate's non-Windows code decides without searching (see the unported list above).
- `Session::get_tools_search_paths` is a local copy of session.rs:825, exported for link.ts. The owner of session.ts should move it to session.ts.
- Export files are written whole (`writeFileSync`) where upstream writes lines into `File::create_buffered`. The bytes are the same, and so is the `io::Error` when the file cannot be created.
- `debug!` is compiled out (static max level INFO), so those lines are comments. `warn!` goes through `tracing.warn`.
- `EmLinker::export_symbols`: `serde_json::to_string(Vec<String>)` is `JSON.stringify`. Both escape `"`, `\` and control characters the same way.
- `MsvcLinker::debuginfo`: `DirEntry::path()` is the `read_dir` root joined with `file_name()`. src/std's `DirEntry` has no `path()`.
- `Path::with_file_name` is the local `path_with_file_name` (pop then push). `with_extension` uses rustc_session/config.ts `path_set_extension`.
- Process primitive: `Bun.spawnSync`, as in `rust_ts/llvm/tools.ts` (plan-m7 D15); it is in `ProcessCommand.output()`.
  - The inherited environment is Bun's `process.env`.
  - A spawn error becomes the `io::Error` of its errno; ENOENT gives `NotFound`, which link.rs checks.
  - `ExitStatus` is a unix wait status built from Bun's exit code (`code << 8`) or signal number. Bun does not report core dumps.
- `sysconf(_SC_ARG_MAX)` is a new `bun:ffi` primitive in command.ts. src/std does not export `sysconf`; std/env.ts opens it privately. `_SC_ARG_MAX` is taken from the pinned libc-0.2.189 (1 on Apple, 0 on Linux).
- `ProcessCommand` follows std's unix `Command` (library/std/src/sys/process/unix/common.rs, sys/process/env.rs). `CommandEnv`'s `BTreeMap` is a key-sorted array, in byte order. Its `Debug` prints `argv[0]` (and a differing program) as `CStr`, through `ByteStr`'s Debug, and the arguments as `OsStr`. Both were checked against the oracle. These carry plain `// after std:` comments rather than `// std:` markers, so the library coverage figure does not count them.
- command.ts and linker.ts import `rustc_target/lib.ts` first. `rustc_target/spec/mod.ts` and `spec/json.ts` import each other, and loading command.ts on its own (as its tests do) otherwise fails with a TDZ error.

## Requests for other owners

- **rustc_session (session.ts)**: port `Session::get_tools_search_paths` (session.rs:825); linker.ts has a copy ready to move.
- **root**: the default-sysroot decision above.
- **ssa-link-b**: the test's `drive` shows the call order the oracle lines need. `linker_with_args` can be checked against the same fixtures once it exists, by replacing `drive` with the real function.

## Checks

- `bunx tsc --noEmit -p .`: clean
- `bun scripts/coverage.ts --check`: markers ok
- `RUST_TS_REQUIRE_PROBES=1 bun test ./src/rustc_codegen_ssa/ ./src/std/result.test.ts ./scripts/lib/unit-steps.test.ts`: 165 pass, 0 fail
- Added unit-test wall time: about 2 s (linker_args.oracle about 1.3 s, command.test about 0.1 s, linker/tests about 0.4 s)
- `bun scripts/difftest.ts --suite check-ui --sample 200 --jobs 6`: MATCH 200/200 (run 20261114-061103-root-kbj1)
- `bun scripts/difftest.ts --suite mono-ui --sample 200 --jobs 6`: MATCH 200/200 (run 20261114-061245-root-o3dn)
