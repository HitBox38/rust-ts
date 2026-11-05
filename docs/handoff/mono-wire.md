# Handoff: mono-wire (M7 preflight, plan-m7 wave 39)

**The real driver now runs `-Zprint-mono-items` and `-Zdump-mono-stats`.** Protected suites do not reach these queries, and their
module lists did not change. Under real `tests/codegen-units`, 45 of 46 match without `-C incremental`, and 33 of 46 with it. The
13 that stop there stop on O5, not in this crate.

Branch `t3/wire-monomorphize-providers`, on `integ-w39`.

## Match rates

Real driver against the oracle, `x86_64-unknown-linux-gnu`, same absolute paths on both sides, no normalization. "MATCH" means
stdout, the stats dump and stderr are byte-identical, apart from the two consequences of the codegen stop described below.

| Corpus | Runs | MATCH | Stops |
|---|---|---|---|
| **`tests/codegen-units`, compiletest's flags, including `//@ incremental`** | 46 | **33 (71.7%)** | 13: `-C incremental` (`build_output_filenames`' `invocation_temp`, O5) |
| **`tests/codegen-units`, the same without `-C incremental`** | 46 | **45 (97.8%)** | 1: `partitioning/vtable-through-const.rs`, `vtable_allocation_provider` (O3) |
| `tests/ui` run-pass sample at `-Ccodegen-units` 1, 16, 256 (150 of 3,479 programs, by hash of the id, each ×3) | 450 | **447 (99.3%)**; 14,396 items | 3: `consts/const-trait-to-trait.rs`, O3 |
| Lanes' programs, no `-C incremental`, at 1, 16, 256 (84 program and flag sets ×3) | 252 | **246 (97.6%)** | 6: `vtable-through-const`, `vtable_static`, O3 |
| Lanes' programs, `-C incremental`, at 1, 16, 256 (25 sets ×3) | 75 | 0 | 75: O5 |

No DIFF and no ICE in any row. The result is the same at each of the three CGU counts. Both stops belong to other wave 39 lanes:
O3 to `vtable-alloc`, O5 to `real-crates`.

The incremental rows fail before any mono item prints, so they say nothing about this crate. `partitioning.oracle.test.ts` still
covers those programs, through its stand-in for the option.

The `tests/codegen-units` set is from `git archive` of the pin into a scratch directory. `UPSTREAM.json` is unchanged.

## What the real driver does now

**Wiring.** `rustc_monomorphize_provide` is in `DEFAULT_QUERY_PROVIDERS`, at upstream's position (`src/rustc_interface/passes.ts`).

**Lazy load.** The crate loads with a synchronous `require`, the first time one of its providers runs. Six queries and one hook get
thin wrappers. `wire.test.ts` fails if `lib.provide` ever sets a different list.

**`LlvmCodegenBackend.codegen_crate`** (`src/rust_ts/codegen_backend.ts`) does the head of upstream's `base.rs:723-739`: the two CPU
checks, then `collect_and_partition_mono_items`. Then it stops with exit 70. It has no `// rustc:` marker, so `ssa-base` still shows
as owing `codegen_crate`.

**`-Zprint-mono-items` is not what triggers collection.** As upstream, every run that reaches `codegen_crate` collects. Nothing in
the suites does: across all 52 suites of gate `gate-20261104-143144-root-lpo8`, 0 rows mention `codegen_crate`, `join_codegen`,
`collect_and_partition`, `items_of_instance` or `size_estimate provider`. An UNPORTED case that later gets there stops later, and
a protected case cannot, as exit 70 never matches an oracle exit.

## Decision for root: how `mono-ui` reads this

**A plain difftest of `src/rust_ts/main.ts` cannot score MATCH on `mono-ui`,** for two reasons:
1. The port exits 70 where the oracle exits 0, by design: a run that did no codegen must not report success.
2. `Unported` is not an unwind (`is_unwind` in `rustc_interface/interface.ts`), so `finish_diagnostics` does not run, and the
   trailing `warning: N warnings emitted` is missing. This affected 24 of the 450 `tests/ui` runs and 66 of the 252 lanes' runs. The
   table above forgives it. Nothing else differed on those runs.

**Recommended: `harness-m7a` adds a subject** that uses `config.make_codegen_backend`, as Miri's driver does. It subclasses
`LlvmCodegenBackend`, catches that one `Unported` in `codegen_crate` and returns `new CompiledModules([], undefined)`, and makes
`link` a no-op. Then `main.ts` stays honest, `difftest.ts` needs no new rule, and the catch can go when codegen lands. The oracle
side uses `--emit=obj`, which needs no linker.

I tried this in scratch and did not commit it, since `src/rust_ts/` entries and suites are not this lane's. It scored plain MATCH,
exit codes and the warning summary included, with no forgiveness rule:

| Corpus | Runs | MATCH | Stops |
|---|---|---|---|
| `tests/ui` sample | 450 | 447 | 3 (O3) |
| Lanes' programs | 327 | 246 | 81 (75 O5, 6 O3) |
| `tests/codegen-units` without `-C incremental` | 46 | 45 | 1 (O3) |

The whole subject:

```ts
class MonoOnly extends LlvmCodegenBackend {
  override codegen_crate(tcx: TyCtxt): unknown {
    try {
      return super.codegen_crate(tcx);
    } catch (e) {
      if (e instanceof Unported && e.what.startsWith("rustc_codegen_llvm::LlvmCodegenBackend::codegen_crate (after collect_and_partition_mono_items")) {
        return new CompiledModules([], undefined);
      }
      throw e;
    }
  }
  override link(): void {}
}
const callbacks = { config(config: Config) { config.opts.trimmed_def_paths = true; config.make_codegen_backend = () => new MonoOnly(); } };
// then catch_with_exit_code(() => compiler_entrypoint(raw_args(early_dcx), callbacks)), with main.ts's handling of what escapes
```

**Limit of that subject:** anything codegen would emit after partitioning (LLVM warnings, link errors) is not compared. In the
samples above no oracle run failed after mono collection.

Needs `--sysroot`: the port has no default sysroot (`filesearch::default_sysroot` stops).

## Load order and startup

| Measure | Before | After |
|---|---|---|
| rustc entry, evaluated modules (`--version`, a statement prepended to each module) | 2,052 | 2,052, **same order** (`cmp`) |
| Miri entry, the same | 2,236 | 2,236, **same order** |
| Hello, `--emit=metadata`, modules loaded at exit | 2,052, no `rustc_monomorphize` | 2,052, no `rustc_monomorphize` |
| A `-Zprint-mono-items` run, modules loaded at exit | not applicable | 2,063: the crate's 11 |

`docs/reviews/mono-lanes.md` measured 2,051 and 2,234 on `integ-w38`; `integ-w39` has added modules since.

**Hello's instructions retired** (`/usr/bin/time -l`, `--emit=metadata`, `x86_64-unknown-linux-gnu`, with the oracle's sysroot,
no re-exec so the count is the compiler's own process):

| Run | Result |
|---|---|
| Same tree before the edit, 5 runs | 10.05-10.13 G |
| Same tree after, 5 runs | 9.64-10.12 G |
| Alternating, 12 runs each, load about 40: `integ-w39` | median 10.21 G, range 9.86-11.01 G |
| Alternating, 12 runs each, load about 40: this branch | median 9.78 G, range 9.69-10.10 G |

**No increase is detectable.** I do not claim a speedup: the branch only adds work (seven closures), and the alternating runs used
different paths. Read the 4% gap as noise. I did not measure the eager alternative, as lazy loading kept the list exact.

## Review items (`docs/reviews/mono-lanes.md`)

| Item | Done |
|---|---|
| P1 | The `try` now covers only the file calls, through a small `fs_result`. **Checked:** a `panic` placed at `instantiation_count` now exits 101 (ICE); `-Zdump-mono-stats=/dev/null/x` is byte-identical to the oracle, exit 1 |
| N1 | `load_optional` and the double `provide` are gone from `partitioning_oracle/run.ts`. Both test drivers now use the real wiring, so their tests exercise it. `partitioning.ts:111` and `HAVE_COLLECTOR` were already gone at the merge |
| N2 | `statics.ts` comment says `UnordMap` |
| N3 | See below |
| N4 | `MonoItem.to_stable_hash_key` is on the companion const, out of file order per PORTING section 8 (one inverted marker) |
| N5 | `$DIR` and `$WORK` replacements removed |
| C1 | `prefix.length === 0`, and no `undefined` test on `Reg` |
| C2 | `unwrap(..)`: a violation is now an ICE, not a `TypeError` |
| C3 | Notes and the unused `Fingerprint` removed; `collector.ts`'s two `mono.ts` imports merged |
| `Session::default_visibility` | In `session.ts`, marker `session.rs:908`; the stand-in is gone |

**N3.** New `partitioning_oracle/probe/main.rs`, adapted from the review's probe, and 60 fixtures `oracle/<case>.cgus.txt` (242 kB in
total, written by `regen.ts`). The test now compares `mangle_cgu`, CGU sizes, `is_primary`, the coverage-dead flag, each item's
linkage, visibility, `inlined` and size, `items()` order, deterministic order with symbol names, and `all_mono_items`' size.
`static_cycle` has none, as its target differs between the sides. The existing fixtures are unchanged.

**The new checks fail when they should.** Mutations, in a scratch copy:

| Mutation | Tests failing of 65 |
|---|---|
| Deterministic order reversed (the review's scenario) | 52 |
| `is_primary` always false | 57 |
| `mangle_cgu` skipped, named CGUs | 29 |
| `mangle_cgu` skipped, numbered CGUs | 28 |
| Hidden visibility reported as `Default` | 14 |

**Fixtures are path-independent:** regenerating every fixture from a different checkout path changed 0 files, and the test passes
from there.

**Also deleted:** both `check_markers.ts`. They existed because `coverage.ts` did not count the crate; it does now (`--missing` works),
and the partition one said to remove it then.

## Unit time (F5: at most 5 s of CPU)

`bun test src/rustc_monomorphize`, alternating, load 33-60:

| Tree | Tests | CPU (user + sys) |
|---|---|---|
| `integ-w39` | 128 | 288.0 s, 294.8 s |
| This branch | 129 | 280.0 s, 277.4 s |

**Under budget by this measure, but the difference is within noise, so count it as "no net growth".** What the lane adds and removes,
from single runs:
- `wire.test.ts`: 4.8 s, with 2 real-driver spawns and one in-process load of the driver.
- N3's lines: at most 3.8 s, measured before the trim below, under load.
- Removed: `merge_many-incr-5` and `merge_many-nonincr-5`, about 4 s together. The review named `merge_many` as the first trim. Counts
  1, 2, 3 and 16 remain.

## Checks run

| Check | Result |
|---|---|
| `bunx tsc --noEmit -p .` | clean |
| `bun test src/rustc_monomorphize src/rustc_interface`, `RUST_TS_REQUIRE_PROBES=1` | 135 pass, 0 fail, 0 skip |
| `bun scripts/coverage.ts --check --offline` | markers ok (24,833) |
| `--sample 200 mir` (`20261105-032758-mono-wire-ae4k`) | 200 MATCH |
| `--sample 200 check-ui` (`-032858-mono-wire-ol6t`) | 200 MATCH |
| `--sample 200 pm-ui` (`-033004-mono-wire-4viv`) | 198 MATCH, 1 UNPORTED, 1 UNSTABLE, 0 DIFF |
| `--sample 200 run-pass-miri` (`-033047-mono-wire-zfaf`) | 199 MATCH, 1 UNPORTED, 0 DIFF; its 1 pool TIMEOUT finished when rerun alone |
| `miri-hello` (`-033344-mono-wire-sszw`) | 1 MATCH |

The 3 non-MATCH sample cases are all unprotected and unrelated to this change:
- `pm-ui`, UNPORTED: `proc-macro/expand-expr.rs`, the cross-thread proc-macro strategy.
- `pm-ui`, UNSTABLE: `proc-macro/load-panic-backtrace.rs`.
- `run-pass-miri`, UNPORTED: `attributes/log-backtrace.rs`, a `RUSTC_LOG` directive.

Coverage: `rustc_monomorphize/src/` `lib.rs` 2/2, `partitioning.rs` 20/20, `collector.rs` 42/42; `rustc_middle/src/mono.rs` 41/41;
`rustc_session/src/session.rs` 83/104 (`default_visibility` added).

## For root: tools batch, not edited here

All three were tried together in a scratch checkout. **With them, the hand-written copies deleted and the generated file in place:
`tsc` clean, `collector.oracle.test.ts` and `wire.test.ts` 64 pass, 0 fail,** which compares a fingerprint for every item in a CGU.

**1. `tools/codegen/types.sets.json`, the diagnostics set.** Regenerating gives `src/rustc_monomorphize/diagnostics.gen.ts` unchanged
apart from `--out`'s import paths, so regenerate in place:

```json
"rustc_monomorphize": { "files": ["compiler/rustc_monomorphize/src/diagnostics.rs"], "class": [], "hand": [], "discriminant": [], "skip": [], "typemap_extra": ["tyir.typemap.json", "mir.typemap.json"] }
```

**2. `tools/codegen/types.sets.json`, the `derive_stable_hash` set.** `Instance` has to be listed too, beyond the four the review
names, because `MonoItem::Fn` holds one. The module name is my choice:

```json
"rustc_middle_mono": { "files": ["compiler/rustc_middle/src/mono.rs", "compiler/rustc_middle/src/ty/instance.rs"], "class": [], "hand": [], "discriminant": [], "skip": [], "derive_only": true, "derive_stable_hash": true, "stable_hash_module": "mono_stable_hash", "stable_hash_types": ["rustc_middle::mono::MonoItem", "rustc_middle::ty::instance::Instance", "rustc_middle::ty::instance::InstanceKind", "rustc_middle::ty::instance::ShimKind", "rustc_middle::ty::instance::ReifyReason"], "typemap_extra": ["tyir.typemap.json", "mir.typemap.json"], "resolve_files": ["compiler/rustc_middle/src/ty/mod.rs"] }
```

**3. `tools/codegen/stable_hash.json`,** one new line at the top of `types`, or `rustc_hir::ItemId` is reported missing:

```json
{ "paths": ["rustc_hir::ItemId", "rustc_hir::hir::ItemId"], "stable_hash": "stable_hash_ItemId($v, $hcx, $h)", "import": "src/rustc_hir/stable_hash.gen.ts" },
```

**Then, by hand, in `src/rustc_middle/mono.ts`:**
- Delete from `// PORT(contract): pending a generator batch.` through the end of `stable_hash_ShimKind`. That covers `stable_hash_MonoItem`,
  `stable_hash_InstanceKind`, `ShimKind__discriminant` and `stable_hash_ShimKind`.
- Replace the `stable_hash_Ty` import with `import { stable_hash_MonoItem } from "./mono_stable_hash.gen.ts";`.
- Drop the `stable_hash_ItemId` import.

**That adds one module, `mono_stable_hash.gen.ts`, to both entries' lists,** since `mono.ts` is on protected paths. It only imports
what `mono.ts` already imports. I confirmed the rustc entry loads, not the list or order, so measure those in that batch.

**Not tried:** the `queries.config.json` types the partition handoff lists as `unknown` (`collect_and_partition_mono_items`,
`codegen_unit`, `symbol_name`, `codegen_fn_attrs`, `reachable_non_generics`). Plan-m7's `codegen-sets-m7` has them.

## Other things for root

- **Merge with `vtable-alloc`:** `STOPS` in `partitioning.oracle.test.ts` pins `vtable-through-const{,-nonincr}` to exit 70. Remove those
  entries when O3 lands. Their `.cgus.txt` fixtures already exist.
- **Stale comments in files outside this lane:** `rustc_codegen_ssa/back/symbol_export.ts:329` and `base.ts:376` say `MonoItemPartitions`
  is not ported. Their casts could use the real type.
- **Stale handoffs:** `docs/handoff/mono-collector.md` and `mono-partition.md` say `coverage.ts` does not count the crate and name
  `check_markers.ts`. Left as history.

## `unported(...)` left or moved

- `rust_ts/codegen_backend.ts`: `codegen_crate` now stops **after** collection, and its message says so.
- `rustc_monomorphize`, unchanged: `offload::manifest::read_manifest`, `offload::check_offload_kernels_instantiated`, and
  `SelfProfilerRef::artifact_size` under `-Z self-profile`.

## `// PORT:` decisions

- `passes.ts` `rustc_monomorphize_provide`: lazy load, and why.
- `codegen_backend.ts` `codegen_crate`: only the head, and no marker.
- `partitioning.ts` `dump_mono_items_stats`, `fs_result`: a `try` only on the file calls.
- `mono.ts` `to_stable_hash_key`: position on the companion const.

## Not checked

- **aarch64:** `x86_64-unknown-linux-gnu` only, as asked. `abi-aarch64` is a separate lane.
- **Real `-C incremental`:** the driver stops first. Only the test's stand-in covers those paths.
- **Aux crates in the `tests/ui` sample:** none, as in `mono-ui`'s plan. `tests/codegen-units`' aux crates were built by the oracle.
- **`-Zprofile-closures` through the real driver:** the sweep ran those programs but did not compare the csv. The collector's test
  does, through its own driver.
- **`-Zdump-mono-stats` under `tests/codegen-units`:** not passed there. It was passed in the `tests/ui` and lanes' rows, where every
  dump that exists was compared.
- **The full run-pass corpus, the gate and full suites:** not run, as a lane. The `tests/ui` figure is 150 of 3,479 programs, so its 95%
  interval on a 99.3% rate is wide, roughly 96-100% by program.
- **`codegen_crate`'s `CpuRequired` and `CpuUnsupported`:** no program here reaches them.
- **The eager-import alternative's startup:** not measured.
