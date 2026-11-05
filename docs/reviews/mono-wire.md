# Review: mono-wire (M7 preflight, plan-m7 wave 39)

| Lane | Branch, head | Verdict |
|---|---|---|
| mono-wire | `t3/wire-monomorphize-providers`, `8617e37e` | **APPROVE WITH NITS** |

No wrong result and no risk to a protected case was found. Nothing below blocks the merge. W1 is the one logic finding: a step
upstream runs first is skipped without a stop. It cannot produce a false MATCH. The tools batch is safe for root to apply as listed.

**Reviewed on:** scratch checkouts of `8617e37e` and of its parent on `integ-w39` (`24d2c786`), diffed against its merge `b1014fbb`.
File:line references are to `8617e37e`. Load average was 11-38, with other lanes running. There were no timeouts to rerun.

## Results

| Check | Result |
|---|---|
| `--sample 200` `mir` (`20261105-041842-review-mono-wire-kwxq`) | 200 MATCH |
| `--sample 200` `check-ui` (`-041941-…-e0p5`) | 200 MATCH |
| `--sample 200` `pm-ui` (`-042049-…-5tdk`) | 199 MATCH, 1 UNSTABLE (`resolve/proc_macro_generated_packed.rs`, suite's list), 0 DIFF |
| `--sample 200` `run-pass-miri` (`-042144-…-x80v`) | 200 MATCH |
| `miri-hello` (`-042415-…-suwa`) | 1 MATCH |
| `--sample 40`, not in the gate: `miri-fail`, `miri-pass-tb`, `run-pass-aux-miri`, `parse-ui-json` | 156 MATCH, 4 UNPORTED, 0 DIFF; none of the 4 stops is near this lane (2 `EiiMapEncodedKeyValue`, 2 error-code long descriptions) |
| `bun test src/rustc_monomorphize src/rustc_interface`, `RUST_TS_REQUIRE_PROBES=1`, from a path the lane never used | 135 pass, 0 fail, 0 skip |
| `bunx tsc --noEmit -p .`; `coverage.ts --check --offline` | clean; markers ok (24,833) |
| Regenerating the partition fixtures from another path | 0 files differ, so the 60 new `.cgus.txt` are what the oracle and probe print |

## 1. Protected suites

**Nothing the gate runs reaches these queries. The lane's claim holds, and it holds by two independent routes.**

**Rows.** `gate-20261104-143144-root-lpo8`: 52 suites, 534,173 rows. Every `.jsonl`, including `.skipped` and `.extra`, has 0 rows
naming `codegen_crate`, `join_codegen`, `LlvmCodegenBackend`, `collect_and_partition`, `items_of_instance`, `size_estimate`,
`is_codegened`, `codegen_unit`, `should_codegen_locally`, `check_mono_item`, `backend_optimization_level` or `exported_generic`. The 6
queries' default was `unported("<name> provider (not ported)")`, which would show here; the hook has no caller outside the crate. Listing all 104 UNPORTED reasons: `Location::caller`
78, `mio::Poll` 20, the rest 6, none near. The 371 rows that mention `rustc_codegen_llvm` are corpus file names, all MATCH.

**Argv.** I evaluated `cases()` and `subject()` of every suite in `SUITES`, gate or not, and classified each case by entry and flags:
- `main.ts` with no `-Zunpretty`, no parse stop and `should_codegen()` true: **0 cases in any suite**. `pm-ui`, `rmeta-*`, `check-*` all have `--emit=metadata`. The 43 `parse-ui` cases with `should_codegen` true stop at `-Zparse-crate-root-only`.
- `tydump`, `mirdump`, `ckdump`, `thirdump`, `resdump`: their drivers stop before `start_codegen`.
- `miri.ts` (every Miri suite): a run that exits 0 **does** go on to `start_codegen` (`after_analysis` returns `Continue`, as upstream, `src/miri/bin/miri.ts:197-201`), but `MiriCodegenBackend.codegen_crate` forwards to `DummyCodegenBackend`, which returns an empty `CompiledModules` and never collects, as upstream (`rustc_interface/src/util.rs:443`). So **the Miri backend does not differ**: only `LlvmCodegenBackend.codegen_crate` changed. Measured on `miri-hello`'s own argv with the load plugin: 2,236 modules, 0 from `rustc_monomorphize`, exit 0. Miri reads `exported_non_generic_symbols` only; the provider that reaches the collector is `exported_generic_symbols`.

**Other routes to the collector.** `symbol_export.ts:333` (`exported_generic_symbols`, from metadata encoding) and `base.ts:377`
(`backend_optimization_level`) also call `collect_and_partition_mono_items`. The first is guarded by `should_codegen()`
(`symbol_export.rs:303`, plus `is_sdylib_interface_build`). Both stopped before; a protected case could not have reached them, as the rows show.
On a lib crate with `--emit=link` the collector now runs during metadata encoding, before `codegen_crate`, as upstream. Compared against
the oracle: byte-identical stdout.

**Stops naming `codegen_crate` today:** 0 rows in the last gate, and none in any run under `.data/runs` since 2026-11-03 except
`harness-m7a-final-mono` (40 of 40 UNPORTED at the old text, as expected before this lane) and `harness-m7a-ir-hello`. Runs of 11-01 and 11-02 had `miri-hello` and a
few `run-pass-miri` rows at the old text; they look older than Miri's dummy backend wiring, which I did not trace. A case that gets there now does real work, and
behaves as section 3 shows.

**Module lists against C10, by my own load plugin (a statement prepended to each module, order compared by `cmp`):**

| Entry and run | `integ-w39` | `8617e37e` |
|---|---|---|
| rustc entry, `--version` | 2,052 | 2,052, same order |
| Miri entry, `--version` | 2,236 | 2,236, same order |
| rustc entry, hello `--emit=metadata` | 2,052 | 2,052, same order, 0 from `rustc_monomorphize` |
| rustc entry, `-Zprint-mono-items` | stops first | 2,063: exactly the crate's 11, appended last, `lib.ts` last |

**C10's rules:** none of the 11 modules assigns a prototype, calls `port_methods`, has `declare module` or a top-level `await`, or interns a
symbol at top level. So load time cannot move a `Symbol` index, which `-Zprint-mono-items` makes visible. Everything else they
import is already evaluated by the time the `require` runs.

**`require`, tried rather than assumed.** Each of these ran hello `-Zprint-mono-items` with stdout byte-identical to the oracle:

| Form | Result |
|---|---|
| rustc entry and Miri entry with `MIRI_BE_RUSTC=host`, unbundled | correct, same stop |
| `bun build --target=bun --format=esm`, rustc entry | correct. `require` becomes `init_lib92()`, one of 11 new lazy `__esm` wrappers, still run only on the first provider. Hello `--emit=metadata`: 8.69 G against 8.67 G (1 run each) |
| The same, Miri entry | correct |
| `bun build --compile` | correct |
| `bun build --compile --bytecode --format=esm` | correct |

**For root, D14:** plan-m7 section 4 records `--compile --bytecode` failing on the top-level `await` at `main.ts:42`. With `--format=esm` it
builds and runs here (Bun 1.4.3). I measured neither its Ginstr nor `--sourcemap`, so this only reopens that line.

## 2. Upstream order

- **Provider position:** `rustc_monomorphize_provide(providers)` (`passes.ts:1015`) is between `rustc_mir_transform` and `rustc_privacy`, as `passes.rs:913`.
- **`provide` list:** `wire.test.ts` compares the 6 queries and 1 hook with what `lib.provide` sets. Mutations: dropping a name from the list fails it, and a static import of the crate from `passes.ts` fails the module test. So the test works.
- **`codegen_crate`:** the two CPU checks and the collector are `base.rs:723-739`, in order. `CodegenUnitNameBuilder::new` (`base.rs`, between them) has no side effect, so skipping it shows nothing. The `ensure_ok().codegen_unit` loop needs a fully enabled dep graph, which the port never has.
- **Skipped step: W1.** `LlvmCodegenBackend::codegen_crate` itself (`back/llvm_backend.rs:336`) starts with the offload check, before `base::codegen_crate`.
- **`start_codegen`:** unchanged; metadata first, then the backend, as `passes.rs:1295`. The stop escapes before `print_type_sizes` and `CrateInfo::new`, which run after codegen upstream too.

## 3. Match rates

My own runner and case list: same absolute paths, no normalization, exact comparison of exit, stdout, stderr and dump files. It classifies
each inequality rather than forgiving it, and treats exit 70 as forgivable only when the oracle exits 0.

| Corpus | Runs | Everything equal but the two | Other |
|---|---|---|---|
| `tests/codegen-units`, compiletest's flags, with `-C incremental` | 46 | **33** (20 + 13 with the summary) | 13 stop at `build_output_filenames`' `invocation_temp` (O5) |
| The same without it | 46 | **45** (30 + 15) | 1: `vtable-through-const` (O3) |
| `tests/ui` `run-pass`, my own 50 by another hash, no `-O`, 16 CGUs, with stats | 50 | **50** (47 + 3) | 2,220 items, 50 dumps |
| `tests/ui` `run-pass`, 25 of them with the suite's flags (`-O`, 1 CGU), with stats | 25 | **25** | 1,242 items |
| `tests/ui` `build-pass`, 30 by hash | 30 | 27 | 2 stops (`CodeStats`, `shlex::split`), 1 `--json=artifacts` line (below) |
| `tests/ui` `build-fail`, 40 by hash | 40 | 2, plus 23 fully exact | 12 oracle fails after collection (below), 2 `short_string_namespace` stops, 1 same ICE both sides |

**45/46 and 33/46 reproduce exactly.** The lane's `tests/ui` list and comparison script were not committed (W6), so 447/450 can't be rerun as
such. My 75 `run-pass` runs agree: 75 of 75. No ICE of the port's own, no timeout and no new `unported` from the collector in any row, and the only differences are the ones listed below. 1 of the 45
has 0 items (`unreferenced-inline-function.rs`); the rest are not vacuous.

**Does "match" mean what it says? Yes, for what it covers.** On these rows forgiveness hid only exit 70 against 0 and the final `warning: N warnings
emitted`. Every other stderr and stdout byte was equal. What the comparison cannot see, by design:
- **Files.** `.o`, `.rlib` and `rmeta` contents are not compared here.
- **The warning count itself.** The summary's number is not checked on these rows. The warnings it counts are, and `check-ui` covers the count.
- **Anything after the stop, when the oracle succeeds silently.** This covers only what the oracle would have written beyond stdout and stderr.

**Things it does not hide, which show as differences in my runner:**
- **12 `build-fail` programs** whose oracle errors come from codegen: `too big for the target architecture`, E0511, `unknown LLVM intrinsic`, `entry symbol main declared multiple times`. The port's stderr is an exact prefix of the oracle's in all 12, so nothing was wrong before the stop. Exit 70 against 1 stays a stop, not a match.
- **`tests/ui/json/json-options.rs`**: the oracle's `{"$message_type":"artifact",…,"emit":"obj"}` line, written by codegen.

**The recommended subject (`MonoOnly`, the handoff's text as written), rerun:** `tests/codegen-units` without incremental 45 plain MATCH, 1
O3 stop. My 120 `tests/ui` runs: 102 plain MATCH, the 12 and `json-options` as DIFF, and the 5 others as above. The recommendation holds for `mono-ui`'s
`run-pass` list, and `main.ts` staying honest is right. `harness-m7a-final-mono` scored 40 of 40 UNPORTED at the old stop text, so root does need this decision before `mono-ui` gives a number. See W4 for its limit.

## 4. Review items

Each read in the diff and, where it can run, run.

| Item | Status |
|---|---|
| P1 | **Fixed.** `panic` at `instantiation_count`: exit 101, ICE. `unported` there: exit 70, its own message. `-Zdump-mono-stats=/dev/null/x`: byte-identical to the oracle, exit 1. The `try` covers `mkdirSync`, `openSync`, `writeSync` only |
| N1 | **Fixed.** No `load_optional` or `HAVE_COLLECTOR` left; `partitioning.ts:111`'s stale comment gone. Both drivers use the real wiring |
| N2 | **Fixed.** |
| N3 | **Fixed**, with the gap in W2. Deterministic order reversed on the default branch: 52 of 65 fail, the lane's number. Fixtures regenerate with 0 changes |
| N4 | **Fixed.** On the companion const, one inverted marker as section 8 allows; no free function left |
| N5 | **Fixed.** |
| C1 | **Fixed.** `prefix.length === 0` as `is_empty()`; `some` without the `undefined` test, as `abi_check.rs:31, 73` |
| C2 | **Fixed.** `unwrap(..)` |
| C3 | **Fixed.** Notes and `Fingerprint` removed, imports merged |
| `Session::default_visibility` | **Fixed.** `session.ts`, marker `:908`, same logic as `session.rs:908`. Probe against port at `-Zdefault-visibility` hidden, protected, interposable on my shim program: 410 lines each, identical, 135 with non-default visibility. `session_default_visibility` is gone |

## 5. Things removed that weren't asked for

**The two `merge_many` cases are redundant, so the trim stands.** I restored the old `merge_many-{incr,nonincr}-5` fixtures and ran 22 mutations of
`merge_codegen_units` and `compute_inlined_overlap`, with a clean control:

| Result | Mutations |
|---|---|
| Caught by the removed two **and** by others | 11: tie favours later, default victim, destination index (2 forms), no size recompute, unsorted names, one merge too few, no re-sort after round 1, size ties reversed, destination clamped at index 3, destination wrong at N in 4..15 |
| Not caught by the removed two | 10. I ran 4 of these against every case: `remove` for `swap_remove` is caught by 4 others, and 3 survive (W3) |
| Caught **only** by the removed two | 1, and it is artificial: destination wrong only at explicit N in 5..15 |

`max_codegen_units` is only an index, so no realistic bug depends on N being 5. Be aware of how thin it gets above that: destination wrong at
N in 4..15 is caught only by `large_cgus-4`, and clamped at index 3 only by `hello-nonincr`. The trim's saving of about 4 s is plausible, but I did not
measure it alone.

**Both `check_markers.ts` can go.** Nothing refers to them, and `coverage.ts` counts the crate: a wrong line and a wrong name each give `ERROR:`; a removed marker
shows in `--missing`. The partition script itself said to remove it. One thing was lost: W5. My own marker scan (independent of both): the 10
files have 0 missing and 0 stale, 131 fns.

## 6. Tools batch

**Safe to apply as listed.** Applied in a scratch checkout exactly as the handoff says, hand-written copies deleted:

| Check | Result |
|---|---|
| `rustc_monomorphize` set, regenerated in place | 16 types, 16 derives, 0 unknowns, `diagnostics.gen.ts` unchanged |
| `rustc_middle_mono` set | 5 impls, 0 missing. Same discriminants and field order as the hand copies; `ReifyReason` by its own fn, same bytes |
| The `ItemId` line, on all 12 sets with `derive_stable_hash` | regenerating every one changes 0 files, so the new entry touches nothing else |
| `tsc`; `tools/codegen/stable_hash.test.ts`, `attr_ir.test.ts` | clean; 5 pass |
| `collector.oracle.test.ts` + `wire.test.ts`; `partitioning.oracle.test.ts` | 64 pass; 65 pass |
| **Live probe** (`collector_oracle/probe`, built here, no fixture) on a new shim-heavy program at `-Copt-level=0`, `-Copt-level=0 -Clink-dead-code`, `-Copt-level=1` | **636 fingerprints, identical values and order**: drop glue, fn-ptr, reify, vtable, clone and async shims, closures, statics, `global_asm` |
| **Hand against generated, in-process,** every variant the programs do not reach (`Virtual` at 0-2^40, `Intrinsic`, `LlvmIntrinsic`, `ThreadLocal`, each `ShimKind`, both `bool`s, all `Reify` reasons, local and foreign `DefId`, 4 arg lists) | 423 compared, 0 different, 423 distinct. Swapping two `ShimKind` discriminants gives 56 different, so the comparison can fail |
| Load order, with the batch | rustc 2,053, Miri 2,237: exactly `mono_stable_hash.gen.ts` added, every other module in the same order. `mono.ts` and the new file both load as a fresh entry |

The hand copies are unchanged since `docs/reviews/mono-lanes.md` proved them against a probe on 171 values, so the in-process table carries that
proof over to the generated code. **Root:** do the three edits to `mono.ts` as the handoff lists them. They are complete.

## 7. Hello's instructions

`/usr/bin/time -l`, `--emit=metadata`, `x86_64-unknown-linux-gnu`, alternating in equal-length paths, warm-up runs discarded:

| Mode | `integ-w39` median (range) | `8617e37e` median (range) |
|---|---|---|
| As run, with the stack re-exec, n=10 | 10.13 G (9.82-10.49) | 10.35 G (10.11-10.55) |
| No re-exec, n=10 | 10.23 G (9.79-10.34) | 10.23 G (9.85-10.44) |
| No re-exec, concurrent JIT and GC off, n=8 | 10.09 G (9.86-10.35) | 10.09 G (9.85-10.46) |

**No increase is detectable, the same conclusion as the handoff.** Its 4% decrease and my 2% increase in one row are both noise, which is
about ±3%. The module list is identical and the addition is seven closures.

**Unit cost:** `wire.test.ts` is 5.3 s of CPU under load here (the handoff says 4.8 s), at F5's 5 s, and the trim pays for it.

## Findings

**W1. Low. `src/rust_ts/codegen_backend.ts:238-258`: upstream's first step is skipped with no stop.** Upstream's `codegen_crate` loads the offload wrapper first
under `-Zoffload=Device` or `Host`, and can stop fatally (`back/llvm_backend.rs:339-355`). The port goes straight to the collector.
**Failing scenario:** `hello.rs -Zoffload=Host=/nonexistent -Zunstable-options -Zprint-mono-items=yes --emit=obj`. The oracle prints 0 `MONO_ITEM`
lines and `error: rust offload backend not found in the sysroot`, exit 1. The port prints 9 `MONO_ITEM` lines, then stops at exit 70 naming the wrong thing.
**Impact:** none on a protected case, and never a false MATCH, as exit 70 stays a stop. Under the `MonoOnly` subject it would be a DIFF. PORTING's rule is that an
unported path calls `unported`. **Fix:** an `unported("rustc_codegen_llvm::llvm::RustOffloadWrapper::get_or_init (-Z offload; M7)")` at the top
under that condition. The same edit should fix the comment at `:239-240`: at this pin `base::codegen_crate` takes `(backend, tcx)`, and "unreachable without `should_codegen()`" no
longer describes what the function does.

**W2. Low, test gap. `src/rustc_middle/mono.ts:855`: `-Zcodegen-source-order` is in no committed test.** N3's fixtures cover the default branch only. **Failing scenario:** add
`.reverse()` to `sort_by_cached_key(.., item_sort_key, ..)` at `:855`: 65 of 65 stay green. No `partitioning_oracle` or `collector_oracle` file names the flag. **The
code is right today:** my live probe at `-Zcodegen-source-order`, at `-Copt-level` 0 and at 1 with 2 CGUs: 422 and 477 lines, identical. **Fix:** one more case in
`common.ts` with its `.cgus.txt`.

**W3. Nit, test gap, older than this lane. `src/rustc_monomorphize/partitioning.ts:563-564, :433`.** Three mutations survive all 65 current cases and the 2 removed ones: overlap counting
non-inlined items, overlap counting items rather than size, and `consumed_cgu_names` truncated to its first element. So the committed tests would not notice a broken
`compute_inlined_overlap`. The trim did not cause this. The code matches upstream by reading, and the merge order agrees with the oracle on every row above. Worth a program
with overlapping inlined items of unequal sizes when M7 relies on CGU contents.

**W4. Nit, handoff wording. "In the samples above no oracle run failed after mono collection"** is true only because those samples are `run-pass`. In a `build-fail` sample, 12 of 40 fail
there, and `MonoOnly` returns exit 0 for a program the oracle rejects. It scores DIFF, not MATCH, so nothing is hidden, and `mono-ui` as planned is `run-pass` only. **Root:** if the suite
ever takes `build-fail` tests or `--json=artifacts`, list those cases first, or they read as bugs until M7.

**W5. Nit. Deleting `check_markers.ts` removes the only automated order check on this crate.** `coverage.ts` has no order rule. Both deleted scripts looked at order, and the
partition one failed on it. Today's order is right: my scan finds one inversion in these files, N4's. `coverage.ts` has no such check for any crate, so reviewers remain the check.

**W6. Nit. The lane's sweep cannot be rerun as such.** The 150-program list, its flags (the handoff does not say whether it dropped the suite's `-O`) and the comparison script with its forgiveness rule were not committed. Mine agrees (section 3). `harness-m7a`'s suite will replace it, so no action unless that slips.

**Stale, as the handoff says, not this lane's:** `back/symbol_export.ts:329-336`, `base.ts:376`.

## What I did not check

- **The gate and full suites:** not run, as instructed. Isolation rests on the last gate's rows, a static reading of every suite's argv, the module lists and the samples above.
- **`CpuRequired`, `CpuUnsupported`:** read only. All three targets that reach them (`avr-none`, `amdgcn-amd-amdhsa`, `nvptx64-nvidia-cuda`) stop at `rustc_target::spec::targets::*`, and the port has no `--target <file>.json`. The lane says no program reaches them; I confirm none can.
- **`check-core-bin`, `check-chain`:** argv only (`--emit=metadata`, no codegen), not run.
- **aarch64:** `x86_64-unknown-linux-gnu` only.
- **Real `-C incremental` past O5:** the driver stops first. Only the test's stand-in covers those paths.
- **Aux crates in my `tests/ui` runs:** none, as in the lane. `tests/codegen-units`' 7 aux crates were built by the oracle as rlibs, not compiletest's dylibs, since this host has no linker for the target.
- **`-Zprofile-closures` through the real driver, the lane's 327 "lanes' programs" rows:** not rerun. The test files cover those programs through their drivers.
- **Bundle performance:** `--bytecode` ran but was not measured; `--sourcemap` not tried.
- **Eager import:** not measured, as lazy keeps the lists exact.
- **Side effects outside the review:** my runs added `.data/runs/*-review-mono-wire-*` and `.data/tmp/*/review-mono-wire*`. The upstream checkout is clean, at the pin. The batch, mutations and bundles were in scratch checkouts, since removed.
