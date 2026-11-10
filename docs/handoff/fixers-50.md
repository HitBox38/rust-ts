# Handoff: lane fixers-50 (wave 40g, queued review findings)

Branch `t3/fix-rustc-port-findings-1`, on `main` at `9015f665`. Host: root host, AC power, load 2 to 5.
`RUST_TS_AGENT=fixers-50`, `RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`, `RUSTC_ICE=0`. No gate, no full suite, no full unit step.
No file under `harness/`, `scripts/` or `tools/` changed; no `src/std/` source changed (one test added to `src/std/path.test.ts`).

Three of the six items were already fixed on `main` by earlier lanes (items 4, 5 and 6). For those I checked that the fix is in HEAD
and that a test fails when it is reverted (each mutant applied by itself, then reverted), and I added a test where none existed.
Items 1 to 3 are new code. While checking item 6 I found and fixed one more first-import cycle of the same kind.

| Item | Commit | Pinned by |
|---|---|---|
| 1 fixers-49 N1, N3: `-Zprint-type-sizes` ties in `FxHashSet` order | `c9af96b9` | `src/rustc_session/code_stats.oracle.test.ts` (3 new live-oracle cases in `code_stats_oracle/ties/`) |
| 2 perf-tait N4: `GenericArg::as_*` on a non-`GenericArg` | `08488d69` | `src/rustc_middle/ty/element_eq.test.ts` |
| 3 fixers-48 O2: fat-archive temp file read+write | `e6898af4` | `src/rustc_codegen_ssa/back/archive.test.ts` (new) |
| 4 fixers-44 F2, F5 | none: fixed by fixers-46 (`25f7527d`) | `src/rustc_target/callconv/aarch64.oracle.test.ts` (existing; mutation-checked) |
| 5 fixers-43 F2, F4 | `5520ccd4` (F4 test only): fixed by fixers-45 (`bd538a1d`, `caa388b7`) | F2: `src/std/env.test.ts` (existing). F4: `src/std/path.test.ts` (new test) |
| 6 root-w40-check3 O1 (`InlineAttr`) | none: fixed by fixers-43 (`5f8f40a0`) | `typeck_impl.test.ts` "this crate loads as the first module" (existing) |
| 6+ the same kind of cycle in `coercion.ts` / `_match.ts` (`InferOk`) | `ab3970c1` | `src/rust_ts/first_import.test.ts` (2 modules added) |

## 1. `code_stats.ts`: ties in `FxHashSet<TypeSizeInfo>` order (fixers-49 review N1, N3)

**Change.** `CodeStats.type_sizes` is an `FxKeyedMap<TypeSizeInfo, undefined>` (src/rust_ts/hash_map.ts), not a `Map<string, TypeSizeInfo>`.
`HashSet<T>` is `HashMap<T, ()>` in hashbrown, so this is the same table. Equality is the existing `key_TypeSizeInfo` string, which is the derived
`PartialEq`. The table hashes with a new `TypeSizeInfo_key`, `TypeSizeInfo`'s derived `Hash` under FxHasher:
- a fieldless enum hashes its discriminant as an `isize` (`write_isize`; new `*_discriminant` tables in declaration order);
- `String` hashes through `write_str` (the bytes, then `0xff`), `u64` through `write_u64`, `bool` through `write_u8`;
- `Option` hashes its discriminant (`None` 0, `Some` 1) as an `isize`, then the value;
- `Vec` hashes `write_length_prefix(len)`, then each element;
- `Symbol` hashes its index through `write_u32`.

The layout is `size: 88, align: 8`, which is `size_of::<TypeSizeInfo>()`. `print_type_sizes` iterates `keys()` in bucket order and keeps
upstream's stable sort. The `unported` tie stop is gone. N3 (a stop on ties that print the same) goes with it.

The hash is hand-written as a `KeyType`, as `transitive_relation.ts`'s `Edge_key` and `traits/mod.ts`'s `String_DefId_key` are.
tools/codegen does not generate FxHasher `Hash` impls.

**Symbol indices** (the review's caveat). Coroutine infos hash `Symbol`s that are not predefined: the variant names `Unresumed`,
`Returned`, `Panicked` and `SuspendN` are interned at record time, and upvar and local names come from the source. Closure infos hash no
Symbol. The evidence that the port's indices equal upstream's:
- I generated 60 tie-heavy files (scratch `gen2.ts`, seed 777). Each is a generic `mk<T, U>` returning a closure, an async block over two upvars,
  or an async block holding a local across an `.await`. Each is instantiated at 8 to 32 type pairs, after 0 to 7 decoy fns with other new
  identifiers. Each oracle output had 0 to 7 tie groups, and 36 of the files tie async blocks.
- Run with `--sysroot <oracle> --edition 2021 --crate-type lib -Zprint-type-sizes -Zcodegen-backend=dummy -Zui-testing`, all 60 are SAME as the
  oracle (stdout, stderr and exit). The old code stops at exit 70 on a tie; I ran it only on the 3 committed cases (below).
- **Sensitivity.** With `hash_Symbol` mutated to hash `index + 1`, 25 of the 36 async-block files DIFF. So the order really depends on the indices,
  and the 60/60 match shows they equal upstream's on these programs. None of the closure-only files DIFF.
- The review's `tie.rs` is SAME too.
- A program in which the port interns some new symbol in a different order from upstream would print a different tie order. Every
  `u32_key` user of hash_map.ts has the same exposure. I found no such program.

**All 17 upstream tests that use `-Zprint-type-sizes`.** These are 15 in `tests/ui/print_type_sizes/` and 2 in `tests/ui/async-await/future-sizes/`.
I ran them under their own compile-flags and edition (`-Cdebuginfo=0 -Cpanic=abort` where the directives say so) with the dummy backend.
All 17 are SAME as the oracle. None of them has a tie.

**Test.** `code_stats.oracle.test.ts` gains one live-oracle test per file in `code_stats_oracle/ties/`:
- `closures.rs`: the review's `tie.rs`;
- `upvars.rs`: async blocks over two upvars;
- `locals.rs`: async blocks with a local across an await.

Each test runs the pinned rustc on the same argv: the host target, the oracle's sysroot, `--edition 2021 --crate-type lib -Zprint-type-sizes
-Zcodegen-backend=dummy`. Stdout, stderr and the exit code must be equal. The oracle output must have more than one tied line, and for the async
files a tied async block. The tests skip visibly without the pinned rustc, and fail instead under `RUST_TS_REQUIRE_PROBES=1`. They take about
1 s each.

Mutants:
- the old `unported` code fails all 3;
- `hash_Symbol` as `index + 1` fails `upvars.rs` and `locals.rs`. I chose those two cases because they are sensitive to this under their committed names;
- `size: 80` in the layout kills nothing. The minimum bucket count does not change between 80 and 88 bytes. The 88 is from the layout, not from a test.

Coverage: `code_stats.rs` 3/3.

## 2. `GenericArg::as_*` (perf-tait review N4)

`as_region`, `as_type` and `as_const` keep perf-tait's allocation-free fast path. On a miss they now return `undefined` only when the value is
one of the other two kinds. Anything else goes to `panic_unreachable()`, which is `kind()`'s `bug!("GenericArg::kind: not a Ty, Region or Const")`.
A hit costs the same as before, and a miss costs one or two more `instanceof` checks. The test feeds an interned non-`GenericArg` object to all
three `as_*` and to `expect_region`, `expect_ty` and `expect_const`. Each must throw `kind()`'s message. On the old code this fails, because
`expect_*` throw their own `bug!`. Coverage: `generic_args.rs` 60/60.

## 3. Fat-archive temp file (fixers-48 review O2)

`tempfile_with_suffix` opens `"wx+"` (`O_RDWR | O_CREAT | O_EXCL`), not `"wx"`. This is tempfile 3.23.0 `src/file/imp/unix.rs:14 create_named`:
`read(true).write(true).create_new(true)`, mode 0o600. The function is now exported, for the test (`// PORT:` note).
`archive.test.ts` points `TMPDIR` at a scratch directory through `set_var`, since `temp_dir()` reads libc's environment, not `process.env`. It
checks:
- the name: `.tmp` + 6 characters + the suffix, in `TMPDIR`;
- mode 0o600;
- that bytes written can be read back from the same descriptor.

With `"wx"` the read fails with `EBADF`. Nothing in any output changes: rustc only writes the file. Coverage: `archive.rs` 12/22, unchanged.

## 4. fixers-44 F2 and F5: already fixed in wave 40d (fixers-46, `25f7527d`)

The queue entry (docs/next.md "fixers-44 F2 ... F5") is stale. `aarch64.ts:127` keeps upstream's `is_scalable_vector` guard. Its test is
`aarch64_oracle/scalable_indirect.rs`. `known_panics_lint.ts` compares `Size_cmp(layout.size, Size.from_bytes(MAX_ALLOC_LIMIT))`, and
`rustc_lint/types.ts` uses `bytes_u64()`. Their tests are `aarch64_oracle/big.rs` and `big_err.rs`. Each of these mutants fails `aarch64.oracle.test.ts`:
- the guard removed;
- `layout.size.bytes() < MAX_ALLOC_LIMIT`;
- `BigInt(variant_layout.size.bytes())`.

No change was needed. Root: drop F2 and F5 from the queue line, which still lists F6 (`decl.name.span`, W5's `--order`).

## 5. fixers-43 F2 and F4: fixed in wave 40c (fixers-45, `bd538a1d`, `caa388b7`)

- **F2.** All three sites now go through `host_canonicalize`, which is `realpath(3)` on the path's bytes against the process cwd:
  `rustc_fs_util/lib.ts` `try_canonicalize`, `passes.ts` `try_canonicalize` and `miri.ts` `canonicalize`. No `realpathSync` is left outside the
  Windows fallback. `env.test.ts`'s "host_canonicalize resolves a relative path against a cwd near PATH_MAX" fails with the old behaviour
  (mutant: `realpathSync.native(path)` first).
- **F4.** `std/path.ts` `sys_path_absolute` returns `current_dir()`'s `Err`. `passes.ts`'s `.ok()` caller returns `undefined`. Neither had a test.
  The new test in `path.test.ts` runs a child process that `chdir`s into a directory and removes it. Then `absolute("x")` must give
  `Err NotFound`, and `absolute("/a/./b")` must give `Ok /a/b`. With the `?` replaced by a throw, it fails. `passes.ts`'s copy is local and
  unexported. From the CLI, `config.ts` stops first on an invalid cwd (as fixers-43's review says), so it stays read-only.

## 6. root-w40-check3 O1: already fixed (fixers-43, `5f8f40a0`), plus two more cycles

`codegen_fn_attrs.ts` imports `rustc_attr_ir/data_structures.ts`, not its `.gen.ts`. `typeck_impl.test.ts` checks that the crate loads as the
first module. Reverting the import fails it with `Cannot access 'InlineAttr' before initialization`. All 19 test files of `rustc_hir_typeck/`,
`rustc_attr_ir/` and `rustc_middle/middle/` pass when each runs alone, as the first file in its process. That set includes `select_b.test.ts` and
`ty_mod_b.test.ts`, which import gen modules.

**Sweep.** I imported 144 modules, each as the first module of a fresh `bun -e`: every `src/*/lib.ts`, and every module of `rustc_attr_ir`,
`rustc_hir_typeck` and `rustc_middle/middle`. Four failed:
- `rustc_hir_typeck/coercion.ts` and `rustc_hir_typeck/_match.ts` (`InferOk`). `coercion.ts:55` imported `debug_InferOk` from
  `infer/mod.gen.ts`, entering the cycle from its gen side, as `suggest.ts` did before fixers-49. `_match.ts` reaches it through `coercion.ts`.
  **Fixed** (`ab3970c1`): the import goes through `infer/mod.ts`, which re-exports it, with a `// Load order:` comment. Both modules join
  `first_import.test.ts`, which fails on the old import with both errors.
- `rustc_attr_ir/data_structures.gen.ts` (`InlineAttr`) and `rustc_middle/middle/region.gen.ts` (`Scope`). These are gen modules imported
  directly. Entering a gen/owner cycle from the gen side is exactly the unsafe entry, and gen files cannot be edited, so I made no change. No test
  file imports either first.

**Module evaluation order of the real entries: unchanged.** I used a `--preload` `Bun.plugin` `onLoad` that appends a log line to every module
under `src/` (through `globalThis.process`, because a module shadows `process`). I ran three entries before and after the change:
- `main.ts --emit=metadata`, a lib: 2,094 modules, identical order, `.rmeta` byte-identical;
- `miri.ts --version`: 2,276 modules, identical order;
- `main.ts --crate-type rlib -Zcodegen-backend=dummy -Zprint-mono-items`: 2,105 modules, identical order, rlib byte-identical.

## Evidence

**Sample difftests**, `--sample 200 --jobs 6`, on AC power with no gate running:

| Suite | Head | Result | Run |
|---|---|---|---|
| `mir` | `5520ccd4` | 200/200 MATCH (skipped=1) | `20261109-200400-fixers-50-jhmt` |
| `check-ui` | `5520ccd4` | 200/200 MATCH | `20261109-200357-fixers-50-hi8l` |
| `emit` | `5520ccd4` | 200/200 MATCH | `20261109-200454-fixers-50-gnaj` |
| `mono-ui` | `5520ccd4` | 200/200 MATCH | `20261109-200450-fixers-50-f42i` |
| `rlib-native` (report only, archive code) | `5520ccd4` | 58/58 MATCH | `20261109-200535-fixers-50-2kpj` |
| `mir` (`RUST_TS_AGENT=fixers-50b`, another sample) | `ab3970c1` | 200/200 MATCH (skipped=1) | `20261109-200656-fixers-50b-pd6z` |
| `check-ui` (`RUST_TS_AGENT=fixers-50b`, another sample) | `ab3970c1` | 200/200 MATCH | `20261109-200653-fixers-50b-oi5m` |

No protected suite runs `-Zprint-type-sizes` (`mir` drops the tests' compile-flags; fixers-49 review), so item 1 is covered by the oracle tests above.

**Checks.**
- `bunx tsc --noEmit -p .`: clean at each commit.
- `bun scripts/coverage.ts --check --offline`: `markers ok (24896; vendor 5311; library 610)`. No marker was added or removed.
- Unit tests of the touched files pass:
  - `code_stats.oracle.test.ts`, `element_eq.test.ts`, `interning.test.ts`, `archive.test.ts`, `path.test.ts` and `env.test.ts` (43 pass);
  - `first_import.test.ts`, `coercion.test.ts`, `typeck_impl.test.ts` and `contract.test.ts` (50 pass);
  - `rlib_native.oracle.test.ts` and `rlib_macho.test.ts` (with `archive.test.ts`, 17 pass);
  - `aarch64.oracle.test.ts` (2 pass);
  - `scripts/lib/unit-steps.test.ts`, which places the new `archive.test.ts` in a unit process (5 pass).

## `unported(...)` and `// PORT:`

- Removed: `rustc_session::code_stats::CodeStats::print_type_sizes: two types with the same size and description (FxHashSet order)`.
- Added: none.
- `// PORT:` notes:
  - `code_stats.ts` header: `type_sizes` as an `FxKeyedMap` with the derived `Hash`;
  - `code_stats.ts`: `hash_Option`'s derived-`Hash` convention;
  - `archive.ts`: `tempfile_with_suffix` exported for its test.

## For root

- docs/next.md: items 4, 5 and 6 were done in earlier waves (fixers-46, fixers-45, fixers-43). The queue lines for fixers-44 F2/F5, fixers-43 F2/F4 and
  check3 O1 can be closed. fixers-44 F6, fixers-43 F3, F6 and F7 are not in this lane.
- Observation: `data_structures.gen.ts` and `region.gen.ts` fail as a first import (see 6). They are harmless while nothing imports them first, and
  `first_import.test.ts` covers the importers that matter.
