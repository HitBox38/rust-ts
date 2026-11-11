# harness-cli (wave 40j): the `cli` report suite

A harness batch (AGENTS.md §2: changes to `harness/` need their own reviewed batch). It adds one report suite, `cli`, for
scout-unported §5 "Lane 1" (lane driver-cli ports the driver code it reaches). No `src/`, no baseline, no change to any other
suite's cases or oracle keys.

## Files

- `harness/cli.ts` (new): the suite. Pure case generation (it imports no `scripts/lib/common.ts`, so the test loads it
  directly): parsers of the pinned upstream sources (`explainCodes`, `removedCodes`, `printKinds`, `mnemonicExample`,
  `specialUnknownRequests`), `cliCases` and `cliSuite`. Its header lists every case kind and every exclusion with its reason.
- `harness/suites.ts`: 18 lines. `libClosure` added to the `./library.ts` import, `import { cliSuite } from "./cli.ts"`, and
  one `SUITES.push(cliSuite({...}))` at the end of the file, which passes in what needs `common.ts` (upstream path, the
  CLI target `COMPILETEST_TARGET`, `oracleSysroot`, `oracleRustcCmd`, the subject command, check-ui's `RMETA_UI_CORPUS`, and
  the aux rmetas from `oracleLibRmeta`). Lane harness-w50 also edits this file: the conflict, if any, is at the end of the
  file and in that import line.
- `harness/cli.test.ts` (new): 4 tests (below).

## The suite

Report only, as `rlib-native`: no `harness/baseline/cli.txt`, so `gate.ts run` leaves it out by default; `--suites cli` runs
it. Milestone M6, single mode, 60 s limit on both sides. The oracle is `rustc +nightly <argv>`, the subject
`subjectCmd("src/rust_ts/main.ts") <argv>` (binary mode applies), both from the upstream checkout, with no tty (difftest pipes
them), the scrubbed environment (scripts/lib/env.ts already unsets `CLICOLOR*`, `NO_COLOR`, `FORCE_COLOR`, `TERM`,
`COLORTERM`) and `RUSTC_ICE=0 RUST_BACKTRACE=0`. No `oracleKey`: the oracle is rustc, so the key is the usual one (pin,
rustc_driver build, suite, id, argv, input-file hash, deps, env), as `parse`'s.

Cases by kind (id = its first word; `Suite.subsets` has one subset per kind, so difftest prints counts per kind):

| kind | argv | cases | source of the list |
|---|---|---:|---|
| `explain` | `--explain EXXXX` | 650 | every `E\d{4}.md` in `compiler/rustc_error_codes/src/error_codes/` (518); the codes lib.rs lists as removed (`//  EXXXX, // ...`) that have no description (130); `e0001` and `0001` (the first code lowercased and without `E`, both accepted by `handle_explain`) |
| `explain-color` | `--explain EXXXX --color always` | 518 | the same 518 codes. The task asked for these "if the oracle's output differs with colour": measured, it differs for all 518 (no tty, so `show_colored_md_content`) |
| `W-help` | `-W help` [`CLI_TRIVIAL_INPUT`] | 2 | |
| `print` | `--print <kind> [-Zunstable-options] [--target x86_64-unknown-linux-gnu] --sysroot <oracle sysroot> [CLI_TRIVIAL_INPUT]` | 62 | `PrintKind`'s variants, `name`, `category` and `is_stable` parsed from `compiler/rustc_session/src/config/print_request.rs` (27 kinds, 9 unstable): each kind on the host target and on the CLI target, minus the host's `target-cpus` (53); the 3 `Crate` kinds also on the trivial input (6); `backend-has-mnemonic:RET` (the example in upstream's own message); the unknown requests `help` and `lints` (the one `emit_unknown_print_request_help` gives an extra help line) |
| `print-unstable` | `--print <kind> --sysroot <oracle sysroot>` | 9 | each unstable kind without `-Zunstable-options` (the stability error) |
| `crate-root-lint-levels` | check-ui's argv with `--print crate-root-lint-levels -Zunstable-options` before the input | 730 | `suite("check-ui")`'s cases (`RMETA_UI_CORPUS`), their env included |
| `ls=root`, `ls=all` | `-Zls=<what> --target x86_64-unknown-linux-gnu <rmeta>` | 19 + 19 | std's closure without std (`libClosure("std")`), each crate's oracle-built aux rmeta (`oracleLibRmeta`) |
| total | | **2,009** | |

`CLI_TRIVIAL_INPUT` is `tests/ui/traits/auxiliary/trivial3.rs` (`pub trait Trait {}`: no crate attribute, no directive); it is
the case's `file`, so its content is in the key.

### Decisions (`// PORT:`-like judgment calls of this batch)

- **`--sysroot <oracle sysroot>` on every print case.** The port cannot find a default sysroot
  (`filesearch::default_sysroot` is unported until root decides how, scout §2), and with it `sysroot` and `target-libdir`
  print the given path on both sides by design (the path is in the argv, so in the key). Explain, `-W help` and `-Zls` cases
  pass none (they ran without one on both sides).
- **Host and CLI target for every print kind.** On the host target (no `--target`) the output depends on the host tuple,
  which the key covers through the rustc_driver build (a host's own binary); the CLI target is host-independent.
- **Left out:**
  - `target-cpus` on the host target: its `native` line names the machine's CPU model ("currently apple-m4"), which neither
    the key nor the port can know. Kept for the CLI target, which has no `native` line.
  - `link-args`, `native-static-libs` with an input: they print during linking, so the case would run codegen and the host
    linker and write a binary into the upstream checkout. Kept with no input (the "no input filename given" error).
  - `sysroot`, `target-libdir` without `--sysroot`: the oracle prints where its toolchain is installed, which no key covers.
- **`-Zls` on the M5 aux rmetas, not on check-ui's.** check-ui's rmetas are by-products of that suite's oracle runs:
  absent in a fresh data directory or when its oracle output came from the cache, and rewritten under a concurrent check-ui
  run. The aux rmetas are built on demand by `oracleLibRmeta` into `aux/m5-<crate>-<key>`, the key covering the oracle build,
  the crate's inputs, argv and env, so the path in the argv names the content. Making the cases builds any that are missing
  (as the alloc/std suites do); std itself is no aux crate of any suite, so it is left out. The oracle exits 0 on all of them
  (core's `-Zls=all` prints 718 KB); the scout's exit 101 was on the sysroot's core rlib.
- Every print case of the `Crate` category with no input is a case too: the oracle's "no input filename given" error.

## Evidence

All on the root host on AC power, from this worktree, with `RUST_TS_REQUIRE_PROBES=1 RUSTUP_AUTO_INSTALL=0 RUSTC_ICE=0`.

- **Oracle-key dump** (`bun scripts/oracle-keys.ts`), before (HEAD `0ce28aa2`, `harness/suites.ts` unchanged) and after:
  372,681 keys (sha1 `d4ab0b61…`, 0 suites not listed) → 374,690 keys (sha1 `e374a567…`, 0 not listed). The after dump with
  its `cli` lines removed is byte-identical to the before dump (`cmp`), so no other key moved. `cli` is the last suite
  registered; its 2,009 keys are all distinct.
- **`bun scripts/difftest.ts --suite cli --jobs 6`** (run `20261111-023014-root-lkmd`; agent name defaulted to `root`):
  total 2,009: **MATCH 49, UNPORTED 1,960**, DIFF 0, CRASH 0, TIMEOUT 0, ORACLE_TIMEOUT 0, UNSTABLE 0.

  | kind | total | MATCH | UNPORTED | the port's stop |
  |---|---:|---:|---:|---|
  | explain | 650 | 0 | 650 | `rustc_driver_impl::handle_explain` |
  | explain-color | 518 | 0 | 518 | `rustc_driver_impl::handle_explain` |
  | W-help | 2 | 0 | 2 | `rustc_driver_impl::describe_lints` |
  | print | 62 | 40 | 22 | below |
  | print-unstable | 9 | 9 | 0 | |
  | crate-root-lint-levels | 730 | 0 | 730 | `rustc_driver_impl::print_crate_info (--print crate-root-lint-levels)` |
  | ls=root | 19 | 0 | 19 | `rustc_driver_impl::list_metadata` |
  | ls=all | 19 | 0 | 19 | `rustc_driver_impl::list_metadata` |

  The 22 `print` UNPORTED (host + CLI target unless noted): `calling-conventions` (`rustc_abi::all_names`, 2);
  `crate-root-lint-levels` on the trivial input (2); `target-spec-json-schema` (`rustc_target::spec::json_schema`, 2);
  `all-target-specs-json` (stops at the first target spec not ported, `x86_64_unknown_linux_gnux32`, 2); and the LLVM
  backend's: `code-models`, `relocation-models`, `stack-protector-strategies`, `target-features`, `tls-models`
  (`LlvmCodegenBackend::print`, 2 each), `target-cpus` (CLI target only, 1), `backend-has-zstd` (2),
  `backend-has-mnemonic:RET` (1). The 40 MATCH include `cfg`, `check-cfg`, `host-tuple`, `sysroot`, `target-libdir`,
  `target-list`, `target-spec-json`, `supported-crate-types`, `split-debuginfo`, `deployment-target`, `wasm-proc-macro-tuple`,
  `crate-name` and `file-names` (with and without the input), the no-input errors, `help` and `lints`.
- **Oracle cache added:** 2,009 entries, 8.1 MiB on disk (`du` of the entries the `cli` keys name). The upstream checkout's
  `git status` stays empty after the run (no case writes into it). No aux rmeta was built: all 19 existed. (An exploratory
  `oracleLibRmeta("std")` before the suite left std out built `aux/m5-std-21c9cb08c2597bad`, 5.8 MB; I deleted that directory.)
- **Unit tests** `harness/cli.test.ts`, 4 tests: the print-request parser on a fixture shaped like print_request.rs
  (doc comments, multi-variant arms, trailing comments; a variant missing from `name` or `is_stable` throws); the error-code
  and removed-code readers; `cliCases` on fixture inputs (ids unique, argv per kind, the exclusions, check-ui's argv and env
  carried over, `-Zls` ids by crate name); the registered suite in a child on the pinned upstream (2,009 cases, the counts per
  kind above, rustc as the oracle with no undeclared program, the subject on src/rust_ts/main.ts, `print sysroot` gets the
  oracle sysroot, the lint-level cases are check-ui's in order, the `-Zls` paths under `$RUST_TS_DATA/aux/m5-`, no baseline).
- **Runner unit step as the gate runs it** (`unitStaticSteps` + `runStaticStep` from scripts/gate.ts): `runner unit tests`
  pass, 440 tests (436 before + these 4), 0 failures, 0 skips, 65 s.
- `bunx tsc --noEmit -p .`: clean.

## `unported(...)` and `// PORT:`

None (no `src/` change; no ported code). Coverage unchanged. The batch's judgment calls are under "Decisions" above.

## Notes for root

- The suite needs its own review before root accepts it (AGENTS.md §2). It is not protected and is in no gate by default.
- The LLVM-backend prints (`LlvmCodegenBackend::print`, `target_has_mnemonic`, `LLVMRustLLVMHasZstdCompression`: 14 cases) look
  like class (a) (codegen). Lane driver-cli's scope covers `all_names`, `print_crate_info`, `handle_explain`, `describe_lints`
  and `list_metadata`. `json_schema` and the remaining built-in target specs are scout §7's held `--print target-spec-json`
  work (D3, the owner's).
- Possible later additions, left out to keep the suite small: `-W help` and `--explain` with `--color always` under
  `-Zunstable-options`, `-Zls=items|lang_items|features`, and the remaining `-Zls` inputs (std's own rmeta is no suite's aux
  crate).
