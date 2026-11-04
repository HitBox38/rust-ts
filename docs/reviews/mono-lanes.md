# Review: mono-collector and mono-partition (wave 38, M7 groundwork)

| Lane | Branch, head | Verdict |
|---|---|---|
| mono-collector | `t3/port-mono-collector`, `5b6681ca` | **APPROVE WITH NITS** |
| mono-partition | `t3/mono-partitioning-groundwork`, `eb83e390` | **APPROVE WITH NITS** |

No wrong result was found in either lane. Nothing below blocks the merge. Two real bugs turned up, both outside these
lanes (O1, O2). Neither is reached by a protected path, but M7 will reach both.

**Reviewed on:** a scratch merge of `integ-w38` `688895b6` with both heads (no conflicts) and the handoffs' merge edits.
`tsc` is clean on it. It is not on any shared branch. File:line references below are to that merged tree. Load average was
about 15-37, with other lanes running. There were no timeouts to rerun.

## Results

| Check | Result |
|---|---|
| Lanes' own tests, `RUST_TS_REQUIRE_PROBES=1`, from a path that wrote no fixture | collector 60 pass, partition 67 pass (63 cases + 4 name tests), 0 skip |
| My live comparison of the lanes' cases: rustc-dev probe against the port, no fixtures, no normalization | 122 cases: 119 MATCH, 3 UNPORTED (the known stops) |
| New flags on the lanes' programs | 198 cases: 191 MATCH, 7 UNPORTED (all `vtable_allocation_provider`) |
| New programs (9) and flags | 307 cases: 304 MATCH, 3 ICE (O2); 27,423 `MONO_ITEM` lines |
| Extended probe (CGU internals, below) | 477 cases: 471 MATCH, 3 UNPORTED, 3 ICE (O2); 33,509 items |
| `tests/ui` sweep on the merge | 363 programs: 351 MATCH, 1 real DIFF (O1), 4 same ICE on both sides, 7 UNPORTED |
| Hand-written `StableHash`, `mangle_name`, `shorten_name`, CGU names | 215 of 215 lines byte-identical to a rustc-dev probe |
| `--sample 200`: `mir`, `check-ui`, `rmeta-ui`, `run-pass-miri` | 800 MATCH, 0 anything else |
| Regenerating all 123 fixtures from another path | 0 files differ |
| `diagnostics.gen.ts` from the real generator with the handoff's entry | byte-identical |

## 1. Fn order, logic, names, markers

Every fn in `lib`, `util`, `collector`, `partitioning`, `graph_checks/*`, `mono_checks/*` and `rustc_middle/mono` compared by my
own script (upstream `fn` lines against markers, independent of `coverage.ts` and the lanes' `check_markers.ts`): 0 missing,
0 stale, 0 inverted. Counts: 2, 1, 42, 20, 1, 6 (3 `rustc-skip`, the `Idx`/`From` impls of a number), 2, 7, 9, 41. The only
name mismatches are `fmt` as `display_MonoItem` and `to_stable_hash_key` as `MonoItem_to_stable_hash_key` (N4).

I read each of these files against upstream, arm by arm. Beyond the nits below I found no logic difference. Coverage on the
merge: `rustc_monomorphize` 90/153; the rest is `offload`, which has no lane.

## 2. Isolation

**Nothing a protected suite runs reaches these queries.** `rustc_monomorphize` has 0 modules in the evaluated-module list of
either `src/rust_ts/main.ts` or `src/miri/bin/miri.ts`, measured with a load plugin. `DEFAULT_QUERY_PROVIDERS` does not list it.

**`mono.ts`:** the diff against `integ-w38` removes only the file header and the old imports. No existing function body
changed. It is on protected paths through `rustc_symbol_mangling/lib.ts`, `back/symbol_export.ts` and `queries.gen.ts`
(`import { type X }` stays as a real import under `verbatimModuleSyntax`).

**Load order (C10), measured as module evaluation order, `integ-w38` against the merge:**
- rustc entry: the same 2,051 modules. One moved: `rustc_data_structures/base_n.ts`, by 2 positions, and it imports only `std/panic.ts`.
- Miri entry: the same 2,234 modules, the same order.
- `mono.ts` value-imports two `stable_hash.gen.ts` files. C10's rule (1) is written for Miri modules; `hir.ts` and others already do this. Not a violation.
- All 11 new or changed modules load as a fresh entry point except `partitioning.ts` (`Cannot access 'Printer' before
  initialization`). That one is inherited: `rustc_symbol_mangling/lib.ts` fails the same way on `integ-w38`. Only `lib.ts`, the
  test driver and my scripts load it. **For M7:** wire `lib.ts` in after the driver, as the test drivers do.

Sample runs: `20261104-122050-review-mono-1nf2` (mir), `-122211-review-mono-xm04` (check-ui), `-122331-review-mono-zihe`
(rmeta-ui), `-122448-review-mono-vjsb` (run-pass-miri; its `skipped=497` is the suite's own list, as on any run).

## 3. Order and hashing

**Porting `to_stable_hash_key` is the right call, and root should record it.** Removing the fingerprint sort from
`collect_crate_mono_items` changes plain `-Zprint-mono-items` output (`r_merge`, default CGUs, incremental): the order of CGUs on
a `MONO_ITEM` line follows Symbol index, which follows CGU interning order, which follows this sort. The result is visible and
has nothing to do with incremental, so PORTING section 3's reason for skipping does not apply. Removing it also changes 7 of 8
cases in the extended probe's view of `CodegenUnit::items` order. **Root: record the decision and add the exception to section 3.**

**The keys are exactly upstream's.** `MonoItem`: a fresh `StableHasher`, the derive, `finish` to a `Fingerprint`.
`CodegenUnit`: `Symbol.as_str(name)`, sorted byte-wise.

**Hand-written `StableHash`:** a probe built from the pinned rustc-dev and the port hashed the same table: every `InstanceKind`,
every `ShimKind` including both values of each `bool`, `ReifyReason` `None`/`FnPtr`/`Vtable`, `Virtual` at 0, 1, 254, 255, 256,
65536 and 2^40, `Static`, `GlobalAsm`, on a local and an upstream `DefId`, each with empty, type-only and region + type + 2 const
args. **171 of 171 fingerprints identical**, which covers the variants no program reaches as an item (`Virtual`, `Intrinsic`,
`LlvmIntrinsic`, `ThreadLocal`). Real items add many more: the sweep and the new programs compare a fingerprint for every item
in a CGU (`FP` lines), including the async-drop and coroutine shims.

**Hash containers: no output rests on JS insertion order by luck.** Each upstream iteration of an `UnordMap`/`UnordSet` goes
through `collect_sorted`/`into_sorted` (`codegen_units`, `visited`) or into another map only read by key (`new_cgu_names`,
`item_to_cgus`). `used_map`, `user_map`, `mentioned`, `used_mentioned_items`, `internalization_candidates`,
`mono_item_placements` and `all_mono_items` are lookups or `.any`. `FxIndexMap`/`FxIndexSet` are insertion-ordered in both;
`retain`, `entry().or_insert` and `IndexMap::append` (overwrite in place) are ported as upstream behaves.

**Exact values:** `Fingerprint` and the base-36 `u128` are bigints, and the crate id prints through `u64` with `{:08x}`. Size
estimates are counts, so `number` is fine. The private `str_cmp` in `mono.ts` and the one in `options.ts` both agreed with
`Buffer.compare` on 400,000 random strings mixing BMP-high and astral characters.

**Names and sizes:** 24 `mangle_name`/`shorten_name` results (0, 200 and 201 bytes, NUL, and truncation at each offset 165-170 into
2-, 3- and 4-byte characters) and 20 `build_cgu_name` pairs, one per crate, all identical. `merge_codegen_units` at
`-Ccodegen-units` 1, 2, 3, 4, 5, 7, 11, 16, 17, 32, 33, 61, 100, 257, 300, in both modes.

## 4. Reproducing the comparisons

The script runs a rustc-dev probe and the port on the same absolute paths and compares exit code, stdout, stderr and dump
files, with no normalization at all, so unlike the lanes' tests it reads no fixture.

- **Lanes' cases:** 62 of the 63 partition cases and all 60 collector cases. 119 MATCH, 3 stops: `vtable-through-const{,-nonincr}`
  and `vtable_static`, at `vtable_allocation_provider`, as claimed. The 63rd (`static_cycle`) has different targets on each side,
  so it is covered by the lane's test and by section 6.
- **New programs:** every shim kind reachable on this target, async drop, non-ASCII modules where UTF-16 and byte order disagree,
  every `#[linkage]` that compiles, `no_mangle`, `export_name`, `used`, `link_section`, `thread_local`, `naked`,
  `rustc_std_internal_symbol`, `global_asm!` with `const` and `sym`, nested statics, post-mono errors from several roots, a crate
  with no items, and a generated 60-module crate with heavy overlap of inlined items.
- **New flags:** opt-levels 0-3, `s`; `-Clink-dead-code`; `-Cdebuginfo=2`; `-Zshare-generics`; `-Zinline-mir=no`; `-Zmir-opt-level`;
  v0 mangling; `-Zdefault-visibility`; `rlib`, `dylib`, `cdylib`, `staticlib`; `-Cpanic=abort`; `-Zcross-crate-inline-threshold`;
  `-Cmetadata`; both stats formats; `-Cinstrument-coverage`; `-Zcodegen-source-order`.

**Beyond what the handoff thought checkable.** It says `-Zprint-mono-items` is the only output before codegen. A rustc-dev probe reads
more, so the extended probe also compares, per CGU: `symbol_name` (`mangle_cgu`), `size_estimate`, `is_primary`,
`is_code_coverage_dead_code_cgu`, item count; per item, in `items()` insertion order: linkage, `Visibility`, `inlined`,
`size_estimate`; `items_in_deterministic_order` with each symbol name; and `all_mono_items`' size. All match in the 471
cases that finish. That closes most of the handoff's "could not be checked" list (see N3).

**`CouldntDumpMonoStats`**, which the handoff did not exercise: `-Zdump-mono-stats=/dev/null/x`, a directory that cannot be
created, and no directory all match.

**The script can report a difference.** Mutations, applied to a scratch copy:

| Mutation | Result |
|---|---|
| Remove the fingerprint sort | DIFF on `r_merge`; 7 of 8 with the extended probe |
| CGU key sorted by JS `<` | ICE at the `is_sorted_by` assertion, on `r_unicode` |
| `item_keys` sorted by JS `<` | DIFF on `r_unicode` |
| Swap `ShimKind` discriminants `FnPtr`/`Clone` | DIFF on 7 of 7 |
| CGUs on a line sorted by name, not Symbol index | DIFF on `r_merge` |
| Stats sorted stably, not with ipnsort | DIFF on 3 of 4, including the lane's `stats-json` and `stats-markdown` |
| Unstable tie order in the size sort | DIFF on 4 of 7 |
| `swap_remove` keeps order | DIFF on `r_paths` |

**My script had a bug, found by this.** With a relative output directory it never read the stats dumps, so both sides compared
empty, and the stats mutation first looked like a survivor. I fixed it and reran all 19 stats cases: 19 MATCH, 17 with a non-empty
dump. The bug touched only dump files; stdout, stderr and exit codes were compared throughout.

## 5. The collector lane's open items

**The 7 `symbol already defined` differences are not a bug.** The collector's driver stops before `partition`, so
`assert_symbols_are_distinct` never ran there. Through `collect_and_partition_mono_items` on the merge, `dupe-symbols-1` to `-6` and
`parallel-rustc/cache-after-waiting-issue-111528` all MATCH. The handoff's wording, "in mono-partition's partitioning", should not be
read as a defect in that lane.

**`issue-83150.rs` is a real bug, elsewhere: O1.**

**The sweep, rerun on the merge.** It was affordable, about 10 minutes at 4 jobs. The lane's 343 were not committed, so this is
my own selection by its criteria: all 113 eligible `build-fail` (my directive filter finds 113, not 93) and 250 `build-pass`/
`run-pass` sampled by path hash, with `-Zwrite-long-types-to-disk=no`.

| Result | Programs | What |
|---|---|---|
| MATCH | 351 | 4,430 items |
| Real DIFF | 1 | `issue-83150`, O1 |
| Same ICE both sides | 4 | 3 `normalization-overflow/recursion-issue-*`: the oracle ICEs at `instance.rs:640` too, and the message hashes match. `mir/validate/project-into-simd`: a test that expects the ICE. Only rustc's ICE formatting differs |
| UNPORTED | 7 | 4 `vtable_allocation_provider`, 2 `Location::caller` (the oracle ICEs there too), 1 `CodeStats` |

## 6. Test quality

**Fixtures:** the 47 `upstream/` files are byte-identical to `git show <pin>:tests/codegen-units/...`. The only upstream test not
copied is the 3 `cross-crate-*`, as the handoff says. Regenerating every fixture from another path changed nothing.

**Normalization cannot hide a real difference.** Only the program's own path becomes `$FILE` in the collector's test. My unnormalized
run agrees with every fixture-based result. The partition test also has `$DIR` and `$WORK` replacements that no fixture contains (N5).

**Test-only entries:** `run.ts`, `RUST_TS_PARTITION_*` and the probe are reached only from `*.test.ts`. Nothing in `src/` outside
the crate refers to them.

**The `-C incremental` stand-in does not invalidate its tests.** I listed every read of `opts.incremental` at the pin. Those before
the stand-in takes effect are `span.with_parent` (expansion and lowering; it does not change `lo`/`hi`), a `-Zcache-proc-macros`
branch, and a `span_bug!`. Every read that decides a mono result comes later: `cross_crate_inlinable`, `instantiation_mode`,
`codegen_units`, `Inline`, `deduce_param_attrs`, `fn_abi_of_instance`, partitioning. And every incremental case matches real
`-C incremental`, whose oracle run is live here. It proves nothing about expansion or lowering under incremental, and does not claim to.

**The cyclic-statics stand-in does not invalidate its test.** I ran the real `nvptx64-nvidia-cuda` on the oracle: 4 errors, stderr
byte-identical to the fixture but for the target name. `check_static_initializers_are_acyclic` reads nothing else from the target.

**Cost, measured twice on the merge with `bun test` at load about 18-25:**

| Test file | CPU (user + sys) | Wall |
|---|---|---|
| `collector.oracle.test.ts` | 113-119 s | 69-74 s (serial) |
| `partitioning.oracle.test.ts` | 134-151 s | 35-36 s (3 workers) |
| Together | about 4.5 CPU-min | **about 105 s** |

That takes the unit step from about 20 to about 22 minutes of its 30. **No need to sample now, and neither file should become
fixture-only:** the port must run for the test to mean anything, and the fixtures already make the oracle side free. If the step
nears 25 minutes, trim `merge_many` first: 15 of the 63 partition cases, overlapping `swap_order` and `large_cgus`.

## 7. `diagnostics.gen.ts`

Confirmed. The generator from a scratch copy of the merged tree, with exactly the handoff's entry in `types.sets.json`, gives a
**byte-identical** file: 16 types, 16 derives, 0 unknowns. Output through `--out` differs only in the relative import paths, so
regenerate in place. Root: add the entry in a tools batch.

## Findings

### mono-partition

**P1. Low. `src/rustc_monomorphize/partitioning.ts:1397`: the `catch` in `dump_mono_items_stats` catches everything, not just `fs` errors.**
Upstream's `?` covers the file calls only; the `try` here also spans `def_path_str`, `size_estimate` and the sort.
Reproduced: with a `panic` placed at `instantiation_count`, the port exits **70** with `std::io::Error raw OS error (darwin,
UNKNOWN)`. Upstream would ICE, exit 101. It still stops loudly, so no wrong output, but the stop names the wrong thing. An `Unported`
inside is relabelled the same way, and so is `FatalErrorMarker`. Fix: `try` only around the `fs` calls, or rethrow what is not a Node error.

**N1. Nit. Merge leftovers the handoff's list omits.** `partitioning.ts:111` (a comment naming the deleted file);
`partitioning_oracle/run.ts:9-11, 41, 57-58, 68-70` (`load_optional`, and `provide` now runs twice, harmlessly);
`partitioning.oracle.test.ts:6, 33, 141, 154-162` (`HAVE_COLLECTOR` is always true after the merge).

**N2. Nit. `graph_checks/statics.ts:70`:** the comment says `IndexMap`; `used_map` is an `UnordMap`. The behaviour is right.

**N3. Low, test gap and stale handoff.** Handoff "Could not be checked" is too strong: `Visibility`, `symbol_name`, `is_primary`,
`size_estimate` and deterministic order are all readable from rustc-dev, and I checked them. But no committed test does, so a
later edit to `items_in_deterministic_order` or `mangle_cgu` passes all 67. **Failing scenario:** reverse that sort; every test stays
green. Suggest adding these lines to the fixtures when M7 first needs them. Also stale: "`scripts/coverage.ts` does not count it".

**N4. Nit. `src/rustc_middle/mono.ts:442`:** `MonoItem_to_stable_hash_key` is a free function; PORTING section 8 puts enum methods on
the companion const.

**N5. Nit. `partitioning_oracle/common.ts:125`:** the `$DIR` and `$WORK` replacements never fire; 0 fixtures contain them.

### mono-collector

**C1. Nit. `src/rustc_monomorphize/mono_checks/abi_check.ts:52, 84`:** `x !== undefined` and `prefix.every((x) => x === undefined)` treat
`CastTarget.prefix` as options, but at this pin it is `ArrayVec<Reg, 8>`, `Reg[]` here. Equal in behaviour to upstream's `is_empty()`,
but it reads like the old shape. Use `prefix.length === 0`.

**C2. Nit. `src/rustc_monomorphize/collector.ts:1822`:** `no_bound_vars(..)!` where upstream `unwrap()`s. A violation would be a JS
`TypeError`, not an ICE. Unreachable today, since `fn main<T>` is rejected earlier.

**C3. Nit. Merge leftovers:** `lib.ts:49` (the `pending mono-partition` note) and `collector_oracle/run.ts:10, 31` (the note, and an
unused `Fingerprint`). The handoff's edit 2 also needs `NormalizationErrorInMono` and `MonoItem_to_stable_hash_key` added to
`collector.ts`'s existing `mono.ts` import at line 249, which its text implies but does not say.

**Both handoffs:** the `StableHash` hand-written twice is resolved by the merge. Keep `mono.ts`'s until the tools batch.

### Outside these lanes

**O1. Medium. `src/rustc_middle/ty/instance.ts:729-752`, with `type_length: number` in `diagnostics.gen.ts:252`.** `type_length` is a JS
number, where upstream's `usize` wraps. On `tests/ui/recursion/issue-83150.rs` the port suggests
`type_length_limit="7486212072260643778342602134240551239680"`; the oracle `18446744073709551607`. **Confirmed by patching a scratch
copy:** with wrapping `u64` in `TypeLengthVisitor`, stderr is byte-identical to the oracle's (the run took a few minutes). The check itself
can also go wrong, since a wrapped value can fall back within the limit. PORTING section 5 calls for `bigint` here. Lane instance-vtable's
code. Not reached by a protected suite until M7.

**O2. Medium. MIR validation fails at `-Copt-level` 2 and 3, in `rustc_mir_transform`.** The oracle exits 0; the port ICEs:
`broken MIR in Item(..main) (after phase change to runtime-optimized) .. violates unwind invariants (cleanup false -> false)`. Also with
`-Copt-level=1 -Zmir-opt-level=3`. **Not these lanes:** it reproduces on plain `integ-w38` with `--emit=mir -Copt-level=2`. I did not
find the pass; `-Zdump-mir` stops at `rustc_graphviz::render`. Line-minimal repro, `--edition=2021 --target=x86_64-unknown-linux-gnu`:

```rust
#![feature(fn_static, unsized_fn_params, async_fn_traits, unboxed_closures, closure_track_caller, coroutines, coroutine_trait, stmt_expr_attributes)]
fn plain(x: u8) -> u8 { x }
fn callo<F: FnOnce(u8) -> u8>(f: F) -> u8 { f(1) }
async fn af(x: u8) -> u8 { x }
pub async fn paf(x: u8) -> u8 { af(x).await }
fn main() {
    let b: Box<dyn FnOnce(u8) -> u8> = Box::new(|x| x); // VTable shim
    let _ = b(1);
    callo(plain as fn(u8) -> u8);
    let k = 1u8;
    callo(|x| x + k);                    // ClosureOnce
    let _ = paf(1);
    let co = #[coroutine] || { yield 1u8; 2u8 };
    let _ = std::thread::spawn(|| 1u8);
}
```

**O3. Known. `rustc_middle/ty/vtable.ts` `vtable_allocation_provider`** is the commonest stop: 10 of my cases and 4 sweep programs,
all exit 70. Until it lands, `collect_alloc`'s `GlobalAlloc::VTable` arm has never run against the oracle.

## For root

1. Record the `to_stable_hash_key` decision (section 3) and add the exception to PORTING section 3.
2. Tools batch: the `rustc_monomorphize` set (section 7); a set with `derive_stable_hash` for `MonoItem`, `InstanceKind`, `ShimKind`,
   `ReifyReason`, then delete the hand-written copies; the `unknown` query types the partition handoff lists.
3. Queue O1 and O2 before M7 relies on them, and a fix for P1 with the merge or soon after.
4. Move `session_default_visibility` to `session.ts` (partition handoff). I checked it through `-Zdefault-visibility`.

## What I did not check

- **aarch64:** everything ran for `x86_64-unknown-linux-gnu`, as in the lanes, because the port's aarch64 ABI is unported.
- **`nvptx` through the port:** only the oracle, and only for `static_cycle`.
- **Real `-C incremental` in the port:** the stand-in only. rustc_incremental is out of scope.
- **`-Zoffload`:** `unported`, no lane. `read_manifest`, `check_offload_kernels_instantiated` and the `HostMetadata` roots never ran.
- **Paths no program reached:** the real thread-local shim (fingerprint only), `NoOptimizedMir`, the `rustc_force_inline` delayed
  bug, `AbiRequiredTargetFeature`, `AbiErrorUnsupportedVectorType`, `AbiErrorUnsupportedUnsizedParameter`, the scalable-vector arm,
  `codegen_handle_fn_abi_err`, `custom_coerce_unsize_info`'s `bug!`, and `is_codegened_item`/`codegen_unit`, which nothing calls.
- **`debug_dump`, `list`, `f64_fixed`:** dead code, no oracle.
- **Walk order beyond closures:** the extended probe sees it only after the sort.
- **Aux crates in the sweep:** none, same as the lane. `cross-crate-*` not run.
- **The lane's exact 343:** not committed; section 5 is my own selection by its criteria.
- **`-Zprofile-closures`:** only the lane's fixtures.
- **The gate and full suites:** not run, as instructed. Isolation rests on the 800-case sample and the module lists, and module order
  was measured on one trivial program per entry.
- **Side effects outside the review:** running the generator wrote `.data/codegen/rustc_monomorphize.types-report.json`, and my
  runs added `.data/runs/*-review-mono-*` and `.data/tmp/*/review-mono*`.
