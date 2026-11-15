# Handoff: pm-self (M7d, wave 40t)

Proc macros the port builds (`--crate-type proc-macro` host dylibs), loaded by the port's own proc-macro host.

## Result in one line

**Nothing in the proc-macro path stops.** At this pin the port builds proc-macro dylibs whose exported symbols, `.rustc`
metadata section and rmeta are byte-identical to the oracle's, and its host loads and runs them with the oracle's results.
Most dylibs are byte-identical overall. The rest differ only in `__text` stack-slot order, which comes from the IR model
(finding F1 below), not from proc-macro code. No `src/` change was needed. This lane adds one regression test and this
handoff.

## Files touched

- `src/rust_ts/proc_macro_host.self.test.ts` (new): the port builds a proc-macro crate (a derive with a helper attribute,
  an attribute macro, a function-like macro, and one expanding to `compile_error!`). The test checks that its dylib and rmeta
  are byte-identical to the oracle's. Then the port loads its own dylib, and its `-Zunpretty=expanded` stdout, stderr and
  exit (an expansion, and an error from a macro) must match the oracle using the oracle-built dylib. 3 tests, 3.6 s wall.
  It reads only `RUST_TS_REQUIRE_PROBES` and skips visibly without the pinned rustc, as `proc_macro_host.oracle.test.ts` does.
- `docs/handoff/pm-self.md` (this file).

No changes to `proc_macro_host.ts`, `rustc_builtin_macros` (proc_macro_harness), `rustc_metadata` or `back/link.ts` and
`linker.ts`. They needed none.

## Coverage (all already complete)

`bun scripts/coverage.ts --missing`:

| File | Ported |
|---|---|
| `rustc_builtin_macros/src/proc_macro_harness.rs` | 7/7 |
| `rustc_metadata/src/host_dylib.rs` | 6/6 |
| `rustc_metadata/src/rmeta/encoder.rs` | 95/95 |
| `rustc_metadata/src/creader.rs` | 55/55 |
| `rustc_codegen_ssa/src/back/link.rs` | 87/87 |
| `rustc_codegen_ssa/src/back/linker.rs` | 218/218 |

`coverage.ts --check`: markers ok.

## Evidence

### 1. pm-ui with port-built aux: 280/282 MATCH; the other 2 match under difftest's normalisation

I used a scratch driver (`pmself.ts`, not committed; harness-m7d owns the real `pm-self` suite). For every pm-ui case, it
takes `uiFileCases(.., {aux, procMacro})`'s aux steps and copies the oracle aux dir. It rebuilds every **host** step (the
proc-macro crates and their host-built dependencies) with `src/rust_ts/main.ts`, using compiletest's argv. Then it runs the
main compile (pm-ui's argv: `--emit=metadata`) with the port against the port-built aux, and with the oracle against the
oracle-built aux. It compares stdout, stderr and exit, with the aux dir path mapped.

- **280 MATCH, 2 DIFF** out of 282. The two DIFFs are `tests/ui/proc-macro/load-panic-backtrace.rs` and
  `tests/ui/resolve/proc_macro_generated_packed.rs`. Both differ only in the OS thread id of `thread '…' (<tid>)
  panicked`, which difftest masks (`scripts/lib/unstable.ts`), and both are protected MATCHes in pm-ui. So every case
  passes with port-built aux.
- Port-built aux dylibs: **268 of 283 builds byte-identical** to the oracle's (each step was rebuilt by the oracle in the same
  directory and compared). The other 15 (11 distinct crates: `libbasic`, `libcount`, `libcall_site`, `libcustom_quote`,
  `libassert_span_pos`, `libproc_macro_repro`, `libver_cfg_rel`, `libreserved_prefixes_macro_{2018,2021}`,
  `libreserved_guarded_strings_macro_{2021,2024}`) differ only in `__text` (4–48 bytes), the LC_UUID (16 bytes) and the
  code signature. Their `.rustc` sections and exported symbols are identical. Cause: F1.
- Example cases with port-built aux, all byte-identical dylibs and MATCH: `tests/ui/proc-macro/derive-b.rs`,
  `derive-bad.rs`, `derive-attr-cfg.rs`, `derive-expand-order.rs`, `derive-helper-shadowing.rs#edition2015` and
  `#edition2018` (two proc-macro aux crates each).

### 2. serde_derive 1.0.228: builds, loads and expands the same as the oracle

I made a scratch cargo project with `serde = "=1.0.228"` (features `derive`) and ripgrep's lock versions: proc-macro2 1.0.106,
quote 1.0.46, syn 2.0.119, unicode-ident 1.0.24, serde_core 1.0.228. It uses an isolated `CARGO_HOME` copied from
`$RUST_TS_DATA/ripgrep/cargo/registry/{index,cache}`, the oracle's cargo, and the dev profile (`-Cdebuginfo=2`).

- **serde_derive built by the port, deps by the oracle** (the committed tree): it builds in about 50 s. Its `.rustc`
  section and exported symbols (`___rustc_proc_macro_decls_<id>__`, `_rust_metadata_serde_derive_<id>`) are identical to
  the oracle's build in the same target dir. The whole dylib differs in 212 bytes: `__text` stack-slot swaps in 6 functions
  (`str::replace::<char>`, `serde_derive::de::identifier::deserialize_custom`, four `syn::Attribute::parse_args_with`
  instances), plus the UUID and code signature. Cause: F1.
- **Loaded by the port**: the test crate has `#[derive(Serialize, Deserialize)]` with `#[serde(rename)]` and
  `#[serde(tag = "type")]` on an enum. Compiled by the port against the port-built serde_derive, and by the oracle against
  the oracle-built one:
  - `-Zunpretty=expanded`: MATCH (257 lines, exit 0);
  - `--emit=metadata`: MATCH, and the crate's rmeta is byte-identical.
- **Everything built by the port** works only with a scratch `LLVMRustGetSymbols` shim (rg-fix-a's, applied uncommitted,
  then reverted; see F2). With it, `unicode-ident`, `proc-macro2`, `quote`, `syn`, `serde_core` and `serde` (rlib and
  rmeta) are byte-identical to the oracle's, `__.SYMDEF` included. Two exceptions:
  - `syn`'s rlib differs by 28 bytes, in two codegen units' `__text` (F1);
  - `serde_derive`'s dylib differs only in `__text` (58 bytes), the UUID and the code signature.

  The fully port-built `serde_derive` expands the test crate the same as the oracle (MATCH, rmeta identical), with identical
  symbols and `.rustc`. The test crate's own cargo unit stops at `rustc_interface::util::build_output_filenames
  (invocation_temp …; -C incremental)`. That is cargo's dev-profile `-C incremental` for a path crate: not a proc-macro
  path, and in fixers-60's file.

### 3. Small fixtures (scratch)

- Derive (`#[proc_macro_derive(Hello)]`) and a three-kind crate (derive with helper, attribute, function-like):
  - dylib, rmeta (`--emit=metadata` and `--emit=metadata,link`): byte-identical to the oracle's;
  - port-loaded `-Zunpretty=expanded`: MATCH;
  - built and run (`-o` a binary): MATCH, and the port-built program prints the right result.
- IR (`--emit=llvm-ir`) of the three-kind crate: after dropping the annotation comments (the model drops them by design,
  `core.ts` `LLVMRustPrintModule`) and the `; preds =` comments, 12 lines differ. They are only the suffixes of inlined
  value names (`%_2.i7` vs `%_2.i1`), which is F1. Its dylib is still byte-identical.

### 4. Required checks

- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: markers ok.
- `bun test ./scripts/lib/unit-steps.test.ts`: 10 pass.
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rust_ts/proc_macro_host.self.test.ts src/rust_ts/proc_macro_host.oracle.test.ts`:
  14 pass (the new file: 3 tests, 3.6 s).
- Sample difftests (`--sample 200 --jobs 6`, `RUST_TS_AGENT=pm-self`): see "Samples" below.

## Findings for other lanes

**F1 (IR model, `src/rust_ts/llvm/**`): use-list order is lost when the model hands textual IR to the pinned `opt`.**
LLVM's AlwaysInliner (`-Copt-level=0` runs it) collects the call sites of an `alwaysinline` function from `F.users()`,
which is in use-list order: newest use first, as rustc built them in-process. The model prints the module and `opt`
re-parses it. The parser builds use-lists in its own order (forward references to functions defined later are RAUW'd, which
reorders them), so `opt` inlines call sites in a different order. Effects:

- the inlined values' `.iN` suffixes differ;
- the inlined allocas land in the entry block in another order, so stack slots swap in the object code;
- printed `; preds = …` lists come out in another order (a comment the IR normal form drops).

Minimal repros, one crate each:

- `pub fn f(s: &str) -> String { s.replace('a', "b") }` (lib, `--emit=llvm-ir`, any `-Cdebuginfo`): oracle `%len.i25`,
  `%len.i20`; port `%len.i6`, `%len.i1`.
- `tests/ui/rfcs/rfc-3348-c-string-literals/auxiliary/count.rs` as a proc macro: `number_of_tokens` has two inlined
  `Result::unwrap`. The oracle inlines the second call site first; the port inlines the first one first.

Behaviour is unaffected (every comparison above MATCHes). Bytes of objects and dylibs differ whenever a function has two or
more always-inline call sites of one callee whose slots then swap. A fix probably needs the model to emit `uselistorder`
directives (LLVM's `-preserve-ll-uselistorder` text form) wherever its creation order differs from what the parser will
build. Proposed as a model lane item.

**F2 (IR model): `LLVMRustGetSymbols` is still a stub, so the port cannot write an rlib.** This matters for M7d (ripgrep's
rlibs, and syn, quote and proc-macro2 under serde_derive). rg-fix-a carries an uncommitted shim that sends object files
through `ar_archive_writer`'s `get_native_object_symbols` and stops on bitcode. With that shim the archive symbol tables
(`__.SYMDEF`) of every rlib here were byte-identical to LLVM's. That suggests a real port can be that small for the Mach-O
object case: LLVM's `object::SymbolicFile` over an object file gives the same symbols. The bitcode case (`-Clinker-plugin-lto`,
`-Cembed-bitcode` objects) still needs the model. Owner: the model lane (`src/rust_ts/llvm/ffi.ts`).

**F3 (fixers-60, `rustc_interface/util.ts`):** cargo's dev profile passes `-C incremental=<dir>` for path (workspace)
crates. The port stops at `build_output_filenames (invocation_temp …)`. rg-build uses the release profile (no incremental),
so it is not on M7d's path. Noted for the harness: a `pm-self` cargo case needs `CARGO_INCREMENTAL=0` or a release profile.

## unported(...) left

None added.

## PORT decisions

None (no ported code changed).

## For harness-m7d (`pm-self` suite)

The scratch driver's method works and could be the suite's: plan with `uiFileCases(.., {aux, procMacro})` and use its
`auxSteps`. Rebuild each `host` step with the subject, in a copy of the oracle's aux dir. Then run the main compile with the
subject against the subject-built aux, compared with the oracle's against the oracle-built aux (pm-ui's oracle outputs can
be reused). Map the aux dir path in the subject's output. The full 282-case run (with the per-step oracle rebuild for the byte check) took about 6 minutes at `-j6`.

## Samples

`bun scripts/difftest.ts --suite <s> --sample 200 --jobs 6`, `RUST_TS_AGENT=pm-self`, at 81219b31 (protected suites use
oracle-built aux):

| suite | result | run |
|---|---|---|
| pm-ui | 200/200 MATCH (skipped 2) | 20261115-090220-pm-self-cbao |
| pm-expanded | 200/200 MATCH (skipped 2) | 20261115-090338-pm-self-r7av |
| check-ui | 200/200 MATCH | 20261115-090430-pm-self-4ers |
| run-pass-native | 199 MATCH, 1 UNSTABLE (`tests/ui/threads-sendsync/yield.rs`, a listed race), 0 DIFF | 20261115-090527-pm-self-f8y8 |

No protected case left MATCH.

**pm-expanded with port-built aux** (scratch driver, all 282 cases, `-Zunpretty=expanded` appended): 281 MATCH, 1 DIFF.
The DIFF is `tests/ui/proc-macro/load-panic-backtrace.rs`, which differs only in the masked panic thread id, as in pm-ui.
