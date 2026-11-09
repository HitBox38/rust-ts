APPROVE WITH NITS

# Review: lane fixers-49 (cycles, code_stats.rs, test gaps, vendor markers, O1/O3)

Batch: branch `t3/fix-module-cycles-tests-markers`, head `be37c102`, against `main` at `74f215e6`. I reviewed it in a scratch worktree of
`be37c102`, beside one of `74f215e6` for the module-order comparison. Host: root host, AC power, load 2.6 to 20 (other lanes running).
`RUST_TS_AGENT=rev-fixers-49`, `RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`, `RUSTC_ICE=0`. I ran no gate and no full suite.
Every mutant was applied one at a time and reverted. The scratch tree was clean afterwards.

The port is faithful, the cycle fixes are real and pinned, and the test gaps are closed. No finding blocks the merge.
N1 is a follow-up worth queueing: the new `unported` is avoidable with code the repo already has.

## Findings

| # | Severity | Where | Finding | Reproduced? |
|---|---|---|---|---|
| N1 | low (follow-up) | `src/rustc_session/code_stats.ts:157-165` | The tie `unported` is honest but avoidable: upstream's `FxHashSet` order is deterministic, and `rust_ts/hash_map.ts`'s `FxHashSet` reproduces it | yes |
| N2 | low, test | `src/rustc_metadata/locator.oracle.test.ts:92-108` | O3's stop condition accepts a filler count where only the `libz*` filler pairs differ, so on other file systems the E0464 case may not catch a stable sort | yes (simulated); root host unaffected |
| N3 | info | `src/rustc_session/code_stats.ts:157-165` | The tie stop also fires for two infos that print identically | read only |
| N4 | info | `harness/scope.json` | A harness file in a code batch; it is within PORTING §5b and has precedent, but the owner approval the file asks for should be recorded | read only |
| N5 | info | handoff §2 | Under the lane's argv, 3 of the 15 `print_type_sizes` oracle outputs differ from upstream's `.stdout` files. Parity holds, but a future suite needs compiletest's argv | yes |

### N1: the hash-set-order `unported` can be ported

`code_stats.rs:77` is `Lock<FxHashSet<TypeSizeInfo>>`. `print_type_sizes` collects `type_sizes.iter()` and then runs a **stable**
`sort_by_key(|info| (Reverse(info.overall_size), &info.type_description))`. So two different infos with the same size and description
print in hashbrown iteration order. That order is deterministic: FxHasher is unseeded, and the order depends only on the derived `Hash`, the
element layout and the insertion history. The repo already models exactly this. `src/rust_ts/hash_map.ts` `FxHashSet` drives the vendored
hashbrown (`src/vendor/hashbrown`, NEON group) with FxHasher (`src/vendor/rustc_hash`) and iterates in bucket order. `transitive_relation.ts`,
`rustc_privacy`, miri's `data_race.ts` and other modules already use it.

**Failing scenario, reproduced.** This 6-line `tie.rs`:
```rust
pub fn mk<T: Copy>(t: T) -> impl Fn() -> T { move || t }
pub fn a() -> u64 { mk(1u64)() }
pub fn b() -> (u32, u32) { mk((1u32, 2u32))() }
pub fn c() -> [u16; 4] { mk([1u16; 4])() }
pub fn d() -> (u8, u32) { mk((1u8, 2u32))() }
```
was run with `-Z print-type-sizes --crate-type lib -Zcodegen-backend=dummy -Zui-testing`. The oracle exits 0 and prints three
`{closure@tie.rs:2:46: 2:53}: 8 bytes` types, in the order alignment 8, then 4, then 2. The port exits 70
(`unported: ...print_type_sizes: two types with the same size and description (FxHashSet order)`).

**Fix, prototyped and checked against the oracle.** I wrote a `--preload` that keeps the `Map` for equality. It also builds an
`FxHashSet<string>` over the same keys, with a `KeyType` whose `hash` runs `TypeSizeInfo`'s derived `Hash` on the info behind the key:
- the enum discriminants (`isize`) go through `write_usize`;
- `String` goes through `write_str` (the bytes, then `0xff`);
- the `u64`s go through `write_u64`, and `bool` through `write_u8`;
- an `Option` writes its discriminant, then its value;
- a `Vec` writes its length prefix (`write_usize`), then its elements;
- a `Symbol` goes through `write_u32`.

The `KeyType` has `size: 88, align: 8`, which is `size_of::<TypeSizeInfo>()`. The preload inserts the keys in the port's recording order,
then stable-sorts. Its output is byte-identical to the oracle on:
- `tie.rs`;
- `tie2.rs`, the same functions in reverse order;
- a 46-type file with five-way ties at several sizes and two closure descriptions, so the table resizes several times.

So the stop is honest: it never prints an order the oracle might not. But it is not forced. To port it, make `type_sizes` such an `FxHashSet`
(or an `FxKeyedMap` keyed by `key_TypeSizeInfo`) and drop the `unported`. One caveat applies to ties between infos that have named fields
(coroutine locals, ADT fields): the hash then includes `Symbol` indices, which must equal upstream's. The `u32_key` users of `hash_map.ts` already
rely on that. Closure infos hash no symbols. The prototype is not committed. It was a scratch file outside the repo.

### N2: O3's predicate is wider than the case it protects

`ipnsort_differs_from_stable` returns true if **any** entry is ordered unlike a stable sort. That includes the `libz<n>.txt` pairs, which
appear once through `d_dup_link` and once through `./d_dup`. The E0464 case only sees the `libfoo-*` pairs. If ipnsort swaps a `libz` pair
but keeps both `libfoo` pairs in input order, the loop stops, but a stable-sort `filesearch.ts` gives the same stderr and passes.

I fed the port's `slice_sort_unstable_by` 203 simulated `readdir` orders (sorted, reversed, creation order, 200 seeded shuffles), with the same
names and layout. In 156 of them, the loop stops at a count (17 in all but one) where only `libz` pairs differ. On the root host it is fine. I
read the real APFS `readdir` order of the fixture: at 17 fillers, ipnsort swaps the `libfoo-a.rmeta` pair as well as `libz8` and `libz9`. That
fits the lane's mutant result. The handoff's "a stable sort then fails it on any file system" does not follow.

**Fix:** test only the `libfoo` entries in the `some(...)`, for example `unstable.some((x, i) => x !== stable[i] && x.f.startsWith("libfoo"))`.
With that predicate, all 203 simulated orders stop by n = 38, inside the 200 bound.

Apart from this, O3 is **bounded** (an `ERROR` past 200), **deterministic** (it depends only on the file system's `readdir` order of fixed
names) and **cheap** (one `readdir` of two directories and a sort of about 38 entries per step; zero extra steps on APFS). The test's
`empty_sysroot` has no target libraries, so the helper models the whole list `FileSearch::new` sorts. I checked that.

### N3: the tie stop also fires when the output would be the same

The comparator stops on `size` and description alone. Two different infos can tie and still print the same lines, because they differ only in
fields `print_type_sizes` does not print: a variant's `align` or `SizeKind`, or a field's `align` where it caused no padding. The stop is then
an UNPORTED where any order is right. I only read this; I built no example. N1's fix removes it.

### N4: `harness/scope.json`

- The only change is two `vendor` entries, `"memmap2": "=0.2.3"` and `"tempfile": "=3.23.0"`. Upstream's `Cargo.lock` has exactly one entry
  for each (memmap2 0.2.3 at line 2483, tempfile 3.23.0 at line 5638). `rustc_data_structures` depends on both, and `rustc_codegen_ssa` and
  `rustc_fs_util` on tempfile. No other file under `harness/`, `scripts/` or `tools/` changed, and no baseline, oracle output or suite changed.
  Only `scripts/coverage.ts:148` reads `vendor`.
- This is what PORTING §5b says to do ("record it in `harness/scope.json` → `vendor`"). Earlier porting lanes added entries the same way
  (`e95d1def` jobserver, `825f1948` rand_xoshiro). AGENTS §2 asks for harness changes in their own reviewed batch, and the file's first line
  asks for the owner's approval. This review covers the change. Root should record the approval when it accepts.
- Markers: `coverage.ts --check` reports `markers ok (24896; vendor 5311; library 610)`. I also read each marker against the
  `crate-src.ts` sources:
  - memmap2 `src/unix.rs:36 new` and `:119 map_copy_read_only`;
  - tempfile `src/lib.rs:533 tempfile` and `:562 tempfile_in`, `src/env.rs:45 temp_dir`, `src/util.rs:22 create_helper`,
    `src/file/mod.rs:1063 create_named`, `src/file/imp/unix.rs:14 create_named`, `src/error.rs:30 with_err_path`.

  Each points at its `fn` line. The tempfile chain matches upstream's one caller (`archive.rs:432`,
  `tempfile::Builder::new()...tempfile()`). The `// PORT:` notes on folding several functions into one are accurate.

### N5: argv of the 15 upstream tests

I reran all 15 `tests/ui/print_type_sizes/*.rs` against the oracle as the lane did: their compile-flags and edition, plus
`-Zcodegen-backend=dummy -Zui-testing`. All 15 are SAME (stdout, stderr and exit). Under this argv, though, the oracle's own stdout
differs from upstream's committed `.stdout` for `async.rs`, `coroutine.rs` and `coroutine_discr_placement.rs`. For example, `coroutine.rs` gives
1 byte here and 8193 bytes in `.stdout`. The backend is not the cause: LLVM and dummy agree on `coroutine.rs`. Neither are
`-Cdebuginfo=0`, `-Zmir-opt-level=0`, debug assertions or overflow checks. I did not find the cause. Parity holds, but a future suite should take
compiletest's argv (as `mono-ui` does) and be rechecked under it.

## Checks that passed

**1. `code_stats.ts` against `code_stats.rs`.**
- I read it line by line. All 3 fns are in upstream order, with markers `:31 fmt`, `:81 record_type_size` and `:111 print_type_sizes`.
  `--missing` reports 3/3.
- The types follow upstream's declaration order. The `u64` byte counts are `bigint`, and the `align`s are `number` (`Align` is at most 2^29).
- Both sorts are stable, as upstream's `sort_by_key` is. The secondary key uses `str_cmp`, which compares by code point, the same order as
  `String`'s byte order. The coroutine exception in the variant sort is kept.
- `size - discr_size` and `offset + size` wrap like `u64` arithmetic. Upstream's `checked_sub` panic is kept, with the same message.
  The format strings match, including the three `print!` variants and `, type: ...`. No value is guessed.
- The `rustc_ty_utils/layout.ts` builders now use `bytes_u64()` throughout. Closures record `vec![]`, as upstream `layout.rs:918` does.
- The lane's oracle fixture `oracle/big.aarch64-apple-darwin.txt` is byte-identical to a fresh run of the pinned rustc on `big.rs` (exit 0,
  empty stderr). `code_stats.oracle.test.ts`: 1 pass, 0.9 s.

**Protected coverage of `-Zprint-type-sizes`: none.**
- `mir` protects the 15 tests, but its `stdArgs` drop compile-flags, so the flag is not passed. `--suite mir --filter print_type_sizes`
  gives 15/15 MATCH.
- `check-ui`, `rmeta-ui` and `mono-ui` hold 0 of them. The first two are auxiliary crates, and `mono-ui` takes run-pass tests, while these
  are build-pass.
- It could be protected later: a harness batch could add a suite of the 15 build-pass tests with compiletest's argv, with the port on
  `-Zcodegen-backend=dummy` as `mono-ui` does (mind N5).

**2. Cycles.**
- I reproduced the lane's logging with an `onLoad` preload that logs module evaluation, on `74f215e6` and on `be37c102`:

  | Entry | Modules (main / head) | Order | Output |
  |---|---|---|---|
  | `main.ts --emit=metadata` (lib) | 2094 / 2095 | identical except one inserted line, `src/rustc_session/code_stats.ts` | `.rmeta` byte-identical, stdout identical |
  | `miri.ts --version` | 2276 / 2277 | same | stdout identical |
  | `--crate-type rlib -Zcodegen-backend=dummy -Zprint-mono-items` | 2105 / 2106 | same | `.rlib` and stdout byte-identical |

  All three edited modules appear in each log.
- With each importer reverted to `main` on its own, `first_import.test.ts` fails:
  - `layout.ts`: `Cannot access 'BoundRegionKind'`;
  - `op.ts`: `Cannot access 'ObligationCause'`;
  - `suggest.ts`: `Cannot access 'InferOk'`.

**3. Test gaps.** Each mutant now fails its test file:
- N2 (`table.ts:112`, `j = 0`): 1 fail in `opaque_snapshot.test.ts`.
- N3 (`type_variable.ts:133`, the `#sub_log` check dropped): 2 fail in `type_variable_views.test.ts`.
- `VALUE_ELEMENT_EQ`'s `slice_eq` without its length check (`sharded.ts:48`): 1 fail in `sharded_value.test.ts`.

The collision is real. The test asserts `hash_mix(m, b) === hash_mix(1, a)` and `value_hash(b) === b`. The mutant failing proves it too: without
a shared bucket, `[a]` could never reach `[a, b]`'s `slice_eq`.

**6. O1's `// PORT` note** (`allocation.ts`) is accurate as far as I checked. Bun 1.4.3 gives `new Uint8Array(2**32)` (ok) and
`new Uint8Array(2**32 + 1)` (`RangeError: Out of memory`; `ArrayBuffer` the same). The port gives E0080 ("tried to allocate more memory than
available to compiler") on `pub static S: [u8; 4294967297] = [0; 4294967297];`. I did not rerun the oracle side (exit 0), which touches
4 GiB on a loaded host, or the `bun:ffi` `calloc` at 8 and 64 GiB.

**7. Samples, units, scope.**
- Seed `rev-fixers-49`, `--sample 120 --jobs 4`, on `be37c102`. All 120/120 MATCH:

  | Suite | Run id |
  |---|---|
  | check-ui | `20261109-074456-rev-fixers-49-juje` |
  | mir | `20261109-074523-rev-fixers-49-69ep` |
  | mir-o2 | `20261109-074552-rev-fixers-49-7uod` |
  | mono-ui | `20261109-074627-rev-fixers-49-9j4c` |
  | rmeta-ui | `20261109-074704-rev-fixers-49-t2yi` |

- `bunx tsc --noEmit -p .`: clean.
- Touched tests with `--isolate`: `code_stats.oracle` 1, `first_import` 1 (0.5 s), `opaque_snapshot` 16, `type_variable_views` 4,
  `sharded_value` 7, `locator.oracle` 36 (27 s at load about 20). All pass.
- Unit time added: about 0.9 s (`code_stats.oracle`). The rest is milliseconds.
- No existing oracle output, baseline, suite definition or script changed. The only new oracle file is the lane's fixture, which I reproduced.

## Not checked

- The full unit step and the gate. Windows.
- Whether the port's interned `Symbol` indices equal upstream's (this matters for N1's fix on ties between infos with named fields).
- The oracle side of O1, and `calloc` past 4 GiB.
- `locator.oracle.test.ts`'s time against `main`.
- A second file system for O3; I simulated other orders instead.
- A sweep for other gen/owner first-import cycles; the lane did not do one either.
- The cause of N5's `.stdout` differences.
