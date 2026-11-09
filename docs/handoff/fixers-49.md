# Handoff: lane fixers-49 (cycles, vendor markers and test gaps)

Branch `t3/fix-module-cycles-tests-markers`, on `main` at `74f215e6`. Five commits, one per item, then this file.
Host: root host, AC power, load 4 to 5 (two other lanes). `RUST_TS_AGENT=fixers-49`, `RUST_TS_REQUIRE_PROBES=1`,
`RUSTUP_AUTO_INSTALL=0`, `RUSTC_ICE=0`. No gate, no full suite, no full unit step.

Every item reproduced first. Items 1 to 4 and O3 of item 5 are fixed, each pinned by a test that fails on the old code (mutants
run one at a time and reverted). O1 of item 5 needs a redesign, so it is documented and not fixed (below).

| Item | Commit | Pinned by |
|---|---|---|
| 1 three first-import cycles | `71fe2e46` | `src/rust_ts/first_import.test.ts` (3 modules added; fails with all 3 errors on `main`) |
| 2 `-Zprint-type-sizes` at 2^53 bytes or more | `c2b7c6e5` | `src/rustc_session/code_stats.oracle.test.ts` (new oracle fixture) |
| 3 perf-tait N2, N3 and the generic `slice_eq` | `7754404a` | `opaque_snapshot.test.ts`, `type_variable_views.test.ts`, `sharded_value.test.ts` |
| 4 memmap2 and tempfile vendor markers | `7d6c79f2` | `coverage.ts --check` (vendor markers 5302 -> 5311) |
| 5 fixers-47 review O1 (documented) and O3 (fixed) | `3ff72a17` | O3: `locator.oracle.test.ts` |

## 1. Three module-order cycles

**Reproduced** on `main`, each as the first module of a fresh `bun -e`: `v0.ts` (`Cannot access 'BoundRegionKind'`, `binder.ts:1000`), `op.ts`
(`'ObligationCause'`, `traits/mod.ts:89`), `method/suggest.ts` (`'InferOk'`, `infer/mod.ts:430`).

**Cause: the same pattern each time.** A generated module and the hand-written module that owns it (`binder.gen.ts`/`binder.ts`,
`traits/mod.gen.ts`/`traits/mod.ts`, `infer/mod.gen.ts`/`infer/mod.ts`). The owner imports its gen module and re-exports it. At its top
level the owner spreads or assigns onto the gen module's binding. An importer that imports the gen module directly, as its first
way in, enters the cycle from the gen side. The owner's body then runs before the gen module's body, while the gen binding is still in its TDZ. The chains (the
real evaluation order, see below):
- `v0.ts` -> `rustc_middle/ty/layout.ts` -> `binder.gen.ts` -> `binder.ts`;
- `op.ts` -> `traits/mod.gen.ts` -> `traits/mod.ts` (op.ts's `import { ObligationCause } from traits/mod.ts` on the line above is used only as
  a type, so Bun drops it at run time and the `clone_ObligationCause` import from `mod.gen.ts` comes first);
- `suggest.ts` -> `infer/mod.gen.ts` -> `rustc_infer/traits/mod.ts` -> `traits/project.ts` -> `snapshot/undo_log.ts` ->
  `region_constraints/mod.ts` -> `infer/mod.ts`.

**Fix** (as fixers-48 did for `def.gen.ts`): each of the three importers imports through the owner, which re-exports the gen module.
Each import carries a `// Load order:` comment:
- `rustc_middle/ty/layout.ts`: `{ type Binder, debug_Binder }` from `binder.ts`, not `binder.gen.ts`;
- `rustc_hir_typeck/op.ts`: `clone_ObligationCause` from `traits/mod.ts`;
- `rustc_hir_typeck/method/suggest.ts`: `BoundRegionConversionTime` from `infer/mod.ts`.

**Evaluation order of the real entries: unchanged.** A `--preload` (`BUN_OPTIONS`, a `Bun.plugin` `onLoad` that prepends a log call to
each module under `src/`) on a scratch worktree of `74f215e6` and on the head after item 1, run from the same scratch cwd:

| Entry | Modules | `main` vs head |
|---|---|---|
| `bun src/rust_ts/main.ts --edition 2021 --crate-type lib --sysroot <oracle> --emit=metadata hello.rs` | 2,094 | identical; `.rmeta` byte-identical |
| `bun src/miri/bin/miri.ts --version` (stack.ts, then miri.ts) | 2,276 | identical, stdout identical |
| `... --crate-type rlib -Zcodegen-backend=dummy -Zprint-mono-items hello.rs` | 2,105 | identical; rlib and stdout byte-identical |

All three edited modules (`layout.ts`, `op.ts`, `suggest.ts`) are in each log. After item 2 the logs differ from `main` only by
one line in each: `rustc_session/code_stats.ts`, inserted after `session.ts`'s other imports (it is a new module that `session.ts` imports).

**Tool note.** A static walk of the imports (`Bun.Transpiler.scan`) gives the real order only with `trimUnusedImports: true`. Bun drops
value imports used only as types at run time, which `verbatimModuleSyntax` does not prevent. With that option, the walk matched
the runtime log line for line on `op.ts` and `v0.ts`.

**Test.** `first_import.test.ts` gains the three modules and a header paragraph on the gen/owner pattern. 1 pass, 0.37 s (the modules
load in parallel processes, so 14 modules take no longer than 11). On `main` it fails with the three errors above.

## 2. `-Zprint-type-sizes` at 2^53 bytes or more

**Reproduced, but the cause was wider than the queue said.** fixers-46 wrote that the flag "still stops at that size". In fact it stopped at
**every** size. `Session::code_stats` was a deferred field (`unported: rustc_session::code_stats::CodeStats`), and `passes.ts` called
`unported` in place of `print_type_sizes`. `code_stats.rs` (214 lines) had never been ported. A 2^53 fix alone could not be pinned, so I
ported the file. No typemap change in `tools/codegen/` was needed, because none of these types is generated.

**Port.** New `src/rustc_session/code_stats.ts`: `VariantInfo`, `SizeKind`, `FieldKind` (+ `Display`, `code_stats.rs:31 fmt`), `FieldInfo`,
`DataTypeKind`, `TypeSizeInfo`, `CodeStats` with `record_type_size` (`:81`) and `print_type_sizes` (`:111`). 3/3 fns.
- The `u64` byte counts (`size`, `offset`, `overall_size`, `opt_discr_size`) are `bigint`. The `align`s stay `number`s, because an `Align` is at most 2^29.
- `Lock<FxHashSet<TypeSizeInfo>>` is a `Map` keyed by the derived `Eq` as a string, so an equal info is inserted once.
- The variant sort and the field sort are stable (`Array.prototype.sort`), as upstream's `sort_by_key`.
- `size - discr_size` and `offset + size` wrap like `u64` arithmetic in rustc's release build. `checked_sub` panics as upstream does.
- `println!` is `write_stdout`.
- Wired in: `session.ts` (`code_stats: CodeStats`, `CodeStats.default()`, the `defer_field` removed), `passes.ts` (calls
  `print_type_sizes()`), `lib.ts` (`export * as code_stats`). `rustc_ty_utils/layout.ts` drops its local views and imports the types.
  Its four builders use `Size::bytes_u64()`, so a size past 2^53 no longer stops in `Size::bytes`. `rustc_middle/ty/adt.ts`'s pending
  `DataTypeKind` view is now a type-only re-export, so `adt.ts` does not load `rustc_session`.

**Oracle check.**
- My own program (struct, enum, union, packed struct, closure, async fn): identical to the oracle with `--emit=metadata` and with
  `--crate-type rlib -Zcodegen-backend=dummy` (stdout, stderr and exit). Without `--emit` the port stops at the LLVM backend, as before.
- **The 15 upstream `tests/ui/print_type_sizes/*.rs`**, with their compile-flags, `-Zcodegen-backend=dummy -Zui-testing`: all identical to the
  oracle (stdout, stderr and exit), including `async.rs` (59 lines), `niche-filling.rs` (114), `coroutine_discr_placement.rs` and `packed.rs`.
  No difftest suite holds them: `--filter print_type_sizes` finds 0 cases in check-ui, mono-ui and rmeta-ui. `mir` holds some, under `-Zunpretty=mir`, where nothing is printed.

**Pinned.** `src/rustc_session/code_stats_oracle/big.rs` is `#![no_core]` with `--target aarch64-apple-darwin`, so it runs on any host with no
`rust-std`. It has a struct, an enum with a 2^53-byte variant, a union and a packed struct, all of 2^53 bytes or more, beside small types that cover end
padding, padding inside a variant, a C-like enum, the union's `offset:` line and the description tie-break. `regen.ts` writes
`oracle/big.aarch64-apple-darwin.txt` (the exit code, then stdout; it refuses any stderr). `code_stats.oracle.test.ts` runs `main.ts` once
(0.8 s). **Mutant:** `size: BigInt(field_layout.size.bytes())` in `layout.ts` fails it (`unported: rustc_abi::Size beyond 2^53`).

**New `unported`:** `print_type_sizes`, when two different infos have the same size and description. Upstream keeps the `FxHashSet`'s iteration
order for them, which a `Map` does not reproduce. Both closures from two instantiations of one generic fn print as the same `{closure@...}`
and could tie. Removed: `unported("rustc_session::code_stats::CodeStats::print_type_sizes (-Z print-type-sizes)")` and the
`code_stats` deferred field.

## 3. Test gaps (perf-tait N2, N3, the generic `slice_eq`)

Each mutant first survived its file's tests, and each now fails them:
- **N2** (`table.ts:112`, `j = skip_dups` -> `0`): `opaque_snapshot.test.ts` "the storage is keyed by value" takes `num_entries()` after the first
  duplicate, adds a second one, and checks that `opaque_types_added_since` returns only that one. The mutant: 1 fail.
- **N3** (`type_variable.ts:133`, the kept sub view without its log check): `type_variable_views.test.ts`'s first test checks
  `t2.sub_unification_table()` against `t1`'s, as it does for `eq_relations()`. A new test keeps a sub view for a log in no snapshot, then
  `sub_unify`s through another log in a snapshot, and checks that only that log got entries. The mutant: both tests fail.
- **Generic slice `==`.** `element_slice_eq` (`sharded.ts:80`) was already pinned: removing its length check fails 3 tests in
  `element_eq.test.ts`. The unpinned one was the private `slice_eq` of `VALUE_ELEMENT_EQ` (`sharded.ts:48`), the review's "R6c". It is
  reached only on a hash collision across lengths. `sharded_value.test.ts`'s new test builds one: it solves `hash_mix` for `b` so that `[a, b]` and `[a]` hash the same
  (with `K`'s inverse modulo 2^32, and asserts on the collision so it cannot silently test nothing). It interns `[a, b]`, then `[a]`. The mutant: 1 fail.
- perf-tait N1 (the two typed `slice_eq`s) was already fixed on `main` (`element_eq.test.ts:80-91`).

## 4. Vendor markers for memmap2 0.2.3 and tempfile 3.23.0

- **`harness/scope.json`: root must accept this.** `vendor` gains `"memmap2": "=0.2.3"` and `"tempfile": "=3.23.0"`, the versions in upstream's
  `Cargo.lock` (lines 2483 and 5638). Nothing else changed. No script but `coverage.ts` reads `vendor`.
- The brief named `src/rustc_metadata/memmap.ts`. The file is `src/rustc_data_structures/memmap.ts` (as the review says).
- Markers, checked against `bun scripts/crate-src.ts` sources:
  - `memmap.ts` `map_copy_read_only_ffi`: `memmap2-0.2.3/src/unix.rs:119 map_copy_read_only` and `:36 new`;
  - `archive.ts` `tempfile_with_suffix`: `tempfile-3.23.0/src/lib.rs:533 tempfile`, `src/env.rs:45 temp_dir`, `src/lib.rs:562 tempfile_in`,
    `src/util.rs:22 create_helper`, `src/file/mod.rs:1063 create_named`, `src/file/imp/unix.rs:14 create_named`. A `// PORT:` above them says that one function
    folds in this chain with the builder's fixed fields, and that `util::tmpname` is not ported;
  - `archive.ts` `with_err_path`: `tempfile-3.23.0/src/error.rs:30 with_err_path`.
- `coverage.ts --check`: `markers ok (24896; vendor 5311; library 610)`. `--crate memmap2`: 2/115. `--crate tempfile`: 7/230.

## 5. fixers-47 review O1 and O3

**O1: documented, not fixed. A fix needs a redesign.** Reproduced, with a sharper boundary than the review's: the port fails above
**2^32 bytes**, not only at 64 GiB. `pub static S: [u8; 4294967297] = [0; 4294967297];` builds with the oracle (exit 0) and gives E0080 in the
port. Upstream's `try_new_zeroed_slice` is a lazy `calloc` that succeeds up to the host's virtual memory. Bun 1.4.3's JSC refuses a
`Uint8Array` longer than 2^32 (`RangeError: Out of memory`), and the limit is JS-side. A host `calloc` through `bun:ffi` succeeds at 8 and at 64 GiB,
but `toArrayBuffer` of that memory throws the same `RangeError`. So matching upstream needs `AllocBytes` that are not one `Uint8Array` (chunked storage,
say). That changes the value representation of every allocation reader and needs a recorded decision (PORTING §3). The `// PORT` note on
`AllocBytes_Box.zeroed` (`allocation.ts`) now says all this. The 2^53 boundary stays as fixers-47 left it.

**O3: fixed.** `locator.oracle.test.ts` no longer assumes that 17 filler names discriminate. After building `d_dup` it reads both `-L` directories in
`readdir` order, as `FileSearch::new` does, and sorts the `lib*` names with the port's `slice_sort_unstable_by` (the same layout) and with a stable sort.
It adds `libz<n>.txt` fillers until the two orders differ (an `ERROR` past 200). Because the case compares with the oracle live, a port whose
ipnsort matches the oracle then differs from a stable sort on that file system. On APFS it stops at 17, so the fixture is the same as before. A simulation
of other orders (sorted, reversed, creation order, 20 shuffles) also stopped at 17 every time. **Mutant:** a stable sort in `filesearch.ts` fails the test.
I could not try a second file system on this host.

## Samples

Seed `fixers-49`, `--sample 150 --jobs 4`, on the final head:

| Suite | Result | Run id |
|---|---|---|
| check-ui | 150/150 | `20261109-073015-fixers-49-ye5m` |
| mir | 150/150 | `20261109-073048-fixers-49-wc9e` |
| mir-o2 | 150/150 | `20261109-073120-fixers-49-dg3u` |
| mono-ui | 150/150 | `20261109-073209-fixers-49-478s` |
| rmeta-ui | 150/150 | `20261109-073319-fixers-49-971f` |

## Units, tsc, coverage

- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: `markers ok (24896; vendor 5311; library 610)`.
- Coverage: `rustc_session/src/code_stats.rs` 3/3 (new). `rustc_ty_utils/src/layout.rs` 9/9, `session.rs` 85/104, `passes.rs` 28/29,
  `allocation.rs` 51/51, `memmap.rs` 3/12 and `back/archive.rs` 12/22 are unchanged.
- Touched or affected test files, each with `--isolate`, all pass: `first_import` 1, `code_stats.oracle` 1,
  `pretty_b` 6 (it passes `-Zprint-type-sizes`), `metadata_temp_dir` 2, `interface` 2, `layout` 7, `layout_contract` 6, `ty_adt_assoc` 23,
  `opaque_snapshot` 16, `type_variable_views` 4, `sharded_value` 7, `element_eq` 10, `locator.oracle` 36, `rlib_native.oracle` 9.
- Added unit time: about 0.8 s (`code_stats.oracle`). `first_import` stays about 0.4 s. The rest add milliseconds.

## `unported(...)` and `// PORT:`

- New `unported`: `rustc_session::code_stats::CodeStats::print_type_sizes: two types with the same size and description (FxHashSet order)`.
  Removed: the `print_type_sizes` one in `passes.ts`, and the `code_stats` deferred field (`rustc_session::code_stats::CodeStats`).
- New `// PORT:`: `code_stats.ts` (the header: `bigint` byte counts, `Map` for the hash set, `write_stdout`; `type_desc` as a `String`; the tie;
  wrapping `u64` arithmetic; the inner `indent` named `indent_`). `layout.ts` (the header line). `memmap.ts` (one function for two memmap2 fns).
  `archive.ts` (one function for the tempfile chain). `allocation.ts` (O1). The three `// Load order:` comments of item 1.

## For root

- **Accept `harness/scope.json`** (item 4: two `vendor` entries). This is the only change outside `src/` and `docs/`.
- Item 2 ported a whole file, not just a 2^53 fix (above). `-Zprint-type-sizes` now runs. No suite covers it, and the 15 upstream tests match by hand.
- O1 needs a decision if the port should allocate past 4 GiB.
- I did not sweep the other modules for more first-import cycles. The gen/owner pattern of item 1 applies to every `X.gen.ts` whose owner
  spreads or assigns onto a gen binding at its top level. A module that imports such a gen module first, from outside, is a candidate. The static walk
  above (with `trimUnusedImports`) would find them cheaply.
