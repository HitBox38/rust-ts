# Review: fixer lane `fixers-60` (M7, wave 40t): queued src nits from wave 40s

Reviewer (independent, read-only on code). Subject: branch `t3/fix-wave-40t-queued-nits`, commits `560c7c66`, `cdd71ed1`,
`13a56d66`, `dbba5e66`, `53295dca`, `50b683cc`, `6b783967`, handoff `a46edea6`, read as `git diff 9c662b55 a46edea6`.
Review branch `t3/review-fixers-60`, on `a46edea6`. AC power throughout; no `GATE_RUNNING`; other sessions put the 1-minute load
at 8–57. `RUST_TS_AGENT=review-fixers-60-r1`; `.env.local` from integ-w39 plus `RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`.

## Verdict: **APPROVE WITH NITS**

Every item matches its finding, and the only behaviour changes are the allowed ones. I re-verified the `assert_eq_args` text,
all four `types` fixtures, all five `simd_model` per-arm fixtures and the dummy archive bytes against the pinned toolchain. The
`util.test.ts` bytes now also match the real pinned rustc's dummy backend, not just `llvm-ar`. M3–M6 each fail only their own
test. Everything passes. The nits are a test timeout for root's queue (N1), an optional, stronger regeneration route for
`util.test.ts` (N2) and one readability point (N3).

## 1. Behaviour changes: whole-diff scan

`git diff 9c662b55 a46edea6` touches 36 files. Outside tests, fixtures and docs, the changes are:

| file | change | behaviour |
|---|---|---|
| `debuginfo/metadata.ts` | `assert_size_and_align_eq` → `std/panic.ts` `assert_eq` with `(Size(N bytes), Align(N bytes))` Debug (metadata.rs:152, :1561); metadata.rs:182 → `assert_eq_args` (adds the `left:`/`right:` lines); metadata.rs:1173 → `assert_matches(.., "Arch::AArch64", debug_target_spec_other)`; dead import and two redundant casts removed | ICE text only (allowed). The comparisons (`Size_eq`, `pow2`) are unchanged. Evaluation order matches upstream (left tuple, then `size_and_align_of`). |
| `enums/cpp_like.ts` | cpp_like.rs:858 through `assert_size_and_align_eq`; `coroutine_layout` unwrap with `debug_LayoutError` | ICE text only (allowed). `Size_eq`/`pow2` is equivalent to the old `bytes()` comparison. |
| `enums/native.ts` | `debug_LayoutError` unwrap | ICE text only (allowed) |
| `type_map.ts` | `UniqueTypeId__discriminant` → `UniqueTypeId_discriminant`, PORT header bullet | none |
| `std/panic.ts` | new `assert_eq_args` | new helper (allowed) |
| `va_arg.ts` | 9× `immediate(String)` → `immediate(debug_Value)` | only the `bug!` text of `OperandRef::immediate` (cg-intrinsic-b N3, as asked) |
| `asm.ts` | `lanes()` via `BackendLaneCount.as_u64`; vreg_low16 via `as_u32` | none (`as_u64` is `BigInt(self)`, `as_u32` is `self`) |
| `back/apple.ts` | `TextDecoder("utf-8", { ignoreBOM: true })` | leading U+FEFF kept (allowed) |
| `rustc_interface/util.ts` | `export` on `DummyArchiveBuilderBuilder` with a `PORT:` | none (allowed) |
| `rust_ts/llvm/tools.ts`, `rustc_session/filesearch.ts` | comment lines only (` * ` lines; I checked the diff hunks) | none |
| `harness/llvm-manifest.json` | `Mangler.cpp` pin | **not this lane's**: root's `6a74a1de`, which sits between `9c662b55` and the lane's first commit |

Nothing else changes behaviour.

## 2. Items against their findings

- **cg-asm N5/N1/N6** (`560c7c66`): `asm.ts:1667` `Number(BackendLaneCount.as_u64(..))` and `:1697` `as_u32`, as asm.rs:1207 and
  the eight `as_u64` sites. The handoff now says 65 rows (two places). `cfg.rs` is listed under `mangled_name` (asm.rs:527,
  `naked_asm!`). Matches.
- **cg-di-b N1–N6** (`cdd71ed1`): every bullet of the review is handled (table above; PORT bullets for `coroutine_def_id0`,
  `file_metadata_`, `discr0`, `align0`, `members_`/`generics_`, `tag_base_type_`; `with_tcx` indented; tests 4/5 use the real
  debug context, and test 4 has a call-through spy on `finalize`).
  - **`assert_eq_args` text, re-verified.** Scratch program built with `rustc +nightly-2026-10-11` (`1.101.0-nightly
    (6f5da406b 2026-10-10)`): `let n = 5; assert_eq!(1usize + 2, 0, "n={n}, m={}", 6);` panics with exactly
    ``assertion `left == right` failed: n=5, m=6\n  left: 3\n right: 0``, byte for byte (od). That is `panic.test.ts`'s
    expectation and library/core/src/panicking.rs:447-451. A tuple case, `assert_eq!((1u64, 8u64), (2u64, 8u64), "ptr_type={},
    pointee_type={}", ..)`, gives the same layout. `Size`'s Debug is `Size({} bytes)` (rustc_abi lib.rs:881) and `Align`'s is
    `Align({} bytes)` (:1109), as `debug_size_and_align` writes. `debug_tuple(PLAIN, "", [..])` gives `(a, b)`.
  - **N5 fixture and `VTableTy(_, None)`.** I re-made all four `types` fixtures from inside a scratch copy with the README's
    commands and the pinned rustc. All four are **byte-identical** to the committed ones. `types.rs:48` is `pub struct Point`;
    `"<u32 as _>::{vtable_type}"` is in the `-g2` fixture. Mutations (scratch worktree, `mod.test.ts`):
    - `VTableTy`'s `None` hash skipped (type_map.ts:138): **3 of 13 fail**. Those are the linux `-g2`, MSVC `-g2` and lines
      cases; `-g1` describes no vtable type.
    - `debug_info_type_line_numbers` → `false` at **each** of the nine sites: metadata.ts:974, :1047, :1077, :1276, :1299,
      :1308; enums/mod.ts:88, :146, :231. **Each fails exactly 1**, the `-Zdebug-info-type-line-numbers` case. The lane tested
      3 of these; all nine are covered.
- **fixers-59 N1/N2** (`13a56d66`):
  - **Exporting `DummyArchiveBuilderBuilder`** is acceptable. PORTING §3 asks for a `// PORT:` on judgment calls, and it has one
    (`util.ts:367`). There is precedent: `rustc_mir_transform/lib.ts:833` ("exported (private upstream) for the test driver")
    and `rustc_codegen_ssa/back/lto.ts:94`. No other module imports it (`grep`: util.ts and util.test.ts only).
  - **`util.test.ts`'s expected bytes are oracle-derived and regenerable.** The second test re-makes them with the pinned
    toolchain's `llvm-ar rcs --format=coff|gnu`, and it ran and passed here (REQUIRE=1). I also checked them against **the real
    subject**: the pinned rustc's own dummy backend. `rustc +nightly-2026-10-11 -Zcodegen-backend=dummy -Csave-temps --crate-type
    rlib` on a `no_core` crate with a `#[link(kind = "raw-dylib")]` block keeps `foo.dll_imports.lib` in its temp dir. For
    `--target x86_64-pc-windows-msvc` that file is 140 bytes, **identical** to `EMPTY.coff`. For `--target x86_64-pc-windows-gnu`
    it is `!<arch>\n`, **identical** to `EMPTY.gnu`. See N2.
  - **BOM**: apple.rs:299-300 keeps the bytes (`OsStringExt::from_vec`); `ignoreBOM` does that for a leading U+FEFF. The test
    covers it.
- **cg-intrinsic-b N1–N3** (`dbba5e66`):
  - **`simd_model.rs` per-arm split.** All nine `#[no_mangle]` fns sit behind exactly one `#[cfg]`; together the five arms cover
    them all. I re-made each fixture with the pinned rustc (`--crate-type lib --target x86_64-unknown-linux-gnu --emit=llvm-ir
    -Cno-prepopulate-passes -O --cfg <arm>`, the test's `ARGS`). **All five are byte-identical.** Their `define`s are exactly
    `MODEL_ARMS[arm]`: `gather`: `h_gather`; `scatter`: `h_scatter`; `masked_load`: both loads; `masked_store`: the store;
    `float_reduce`: the four reductions. The test asserts this, so each test checks its own arm's functions. The old exit-70
    branch is gone from both tests.
  - **M3–M6 re-applied** in a scratch worktree, running `simd_intrinsic.test.ts` and `va_arg.test.ts` (24 tests,
    `--timeout 60000`). Unmutated: 24/0. Each mutation fails **exactly one** test, its own, on the mutated value:

    | mutation | failing test | first difference |
    |---|---|---|
    | M3 intrinsic.ts:2640 gather alignment → `1` | `simd_model.rs --cfg gather` | `<4 x ptr> align 4` → `align 1` |
    | M4 :2662 `Element` → `align_of(vector_ty)` | `--cfg masked_load` | `ptr align 4` → `align 16` |
    | M5 :2874 f32 unordered start → `0.0` | `--cfg float_reduce` | `float -0.000000e+00` → `float 0.000000e+00` |
    | M6 va_arg.ts:200 `vr_offs` → `3*ptr_offset` | `aarch64-unknown-linux-gnu (aapcs)` | `i64 28` → `i64 24` |
  - **`va_arg.ts`: all nine sites.** Upstream va_arg.rs has 9 `.immediate()` calls (:52, :206, :307, :439, :548, :848, :924,
    :973, :1289). The port has 9 `immediate(debug_Value)` (:53, :189, :281, :414, :531, :821, :889, :936, :1177) and no
    `immediate(String)` left. `debug_Value` is value.ts's, the same one `CodegenCx.debug_Value` returns.
- **ir-fix-b-recheck notes 2, 4, 5** (`53295dca`): the line references check against the pinned LLVM sources.
  `Type.cpp:659-671` is the `NamedStructTypesUniqueID` rename loop, and `LinkModules.cpp:387-392` is the `ComdatsChosen` /
  `LinkFrom::Dst` early return. The 9 case ids and the 2 MATCH are in `docs/handoff/ir-fix-b.md`. The tools.ts hunks are comment
  lines only.
- **odht timeout** (`50b683cc`): all four probe-spawning tests take `ORACLE_TIMEOUT_MS = 60_000`. The pinned-bytes test spawns
  nothing and keeps the default.
- **default-sysroot comment** (`6b783967`): `filesearch.ts:177-180` now names `parse`, `mir-core` and `check-core`, the three
  w40r-audit N3 (and its table, :173-174) found. Correct.

## 3. Commands

- `bunx tsc`: clean (exit 0, 9.6 s).
- `bun scripts/coverage.ts --check`: `markers ok (27349, 95 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5392; library
  745; llvm 634)`, the same as the handoff.
- `bun test ./src/rustc_codegen_llvm/ ./src/rustc_codegen_ssa/ ./src/rustc_session/ ./src/rustc_interface/ ./src/vendor/odht/
  ./src/std/ ./scripts/lib/unit-steps.test.ts`:
  - `CI=1`: **744 pass, 0 fail**, 86 files, 130 s (1-min load 21 at start).
  - without `CI`: **744 pass, 0 fail**, 86 files, 134 s (load 11 at start).
- **`rpath.oracle.test.ts` and `link_with_args.oracle.test.ts`, runtimes** (both files alone, 3 runs, junit reporter, load
  about 11 then 8–11):

  | test | run 1 | run 2 | run 3 |
  |---|---|---|---|
  | rpath, case 1 | 0.93 s | 2.68 s | 1.16 s |
  | rpath, case 2 | 1.28 s | 2.46 s | 0.44 s |
  | link_with_args "exec_linker falls back to an @-file" | 2.33 s | 0.97 s | 0.67 s |

  At load 11 the worst run is 2.7 s, more than half of Bun's 5 s default, and the spread is 4–6x between runs. At the lane's load
  of about 40 they went over 5 s. See N1.
- `difftest --sample 200 --jobs 6`:

  | suite | run | MATCH | DIFF | UNPORTED | protected in sample | protected not MATCH |
  |---|---|---|---|---|---|---|
  | run-pass-native | `20261115-092524-review-fixers-60-r1-d69g` | 199 | 0 | 1 | 199 | **0** |
  | ir-run-pass | `20261115-092829-review-fixers-60-r1-edfu` | 199 | 0 | 1 | 199 | **0** |

  Neither UNPORTED case is protected, and both belong to lane llir-callbr-mangler. They are `tests/ui/asm/label-operand.rs#aarch64`
  (`llir: LLVMBuildCallBr`) and `tests/ui/asm/cfg.rs#revb` (`llir: LLVMRustGetMangledName`).

## Findings

No F (must fix).

- **N1 (for root's queue, not this lane's files).** `src/rustc_codegen_ssa/back/link_with_args.oracle.test.ts:324` ("exec_linker
  falls back to an @-file") and `src/rustc_codegen_ssa/back/rpath.oracle.test.ts:37` (both tuple cases) run on Bun's 5 s default.
  They took up to 2.7 s at load 11 here and over 5 s at load 40 for the lane. The same file's other oracle tests already carry
  `120_000` (link_with_args.oracle.test.ts:245, :283, :318). **Recommend** an explicit timeout on both, 60 s as for odht, in a
  small fixer batch. The lane's note on `simd_intrinsic.test.ts`'s driver-spawning tests (one 5033 ms timeout at load 18) is the
  same issue and fits the same batch.
- **N2 (optional).** `src/rustc_interface/util.test.ts:849-874` re-makes the expected bytes with `llvm-ar`, which stands in for
  the subject: rustc's `ar_archive_writer` path through the dummy backend. The real subject can be asked directly:
  `rustc +<pin> -Zcodegen-backend=dummy -Csave-temps --crate-type rlib --target x86_64-pc-windows-msvc|x86_64-pc-windows-gnu` on a
  `no_core` crate with a `#[link(kind = "raw-dylib")]` extern block. It leaves `foo.dll_imports.lib` in the kept temp dir, and I
  checked that it equals `EMPTY.coff` / `EMPTY.gnu`. This covers the gnu form on a target where the override is really reached,
  rather than linux-gnu's format alone. The current test is correct; this would only make the regeneration exact.
- **N3.** `src/rustc_codegen_ssa/back/apple.test.ts:9` writes the BOM as a literal, invisible U+FEFF inside the string, in both
  the input and the expectation. A reader, or a later edit, cannot see it. `"﻿/Applications/Xcode.app\n"` says the same
  thing visibly.
- **Info.** The diff range `9c662b55..a46edea6` includes root's `6a74a1de` (the `Mangler.cpp` pin in
  `harness/llvm-manifest.json`). It is not part of this lane, and I did not review it here.
