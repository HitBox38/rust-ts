# Handoff: fixer lane `fixers-60` (M7, wave 40t): queued src nits from wave 40s

Branch `t3/fix-wave-40t-queued-nits`, on `6a74a1de`. One commit per item (items 6 and 7 one each), then this handoff. Behaviour
changes only in ICE texts (items 2 and 4) and in `stdout_to_path` keeping a leading U+FEFF (item 3, N2), as the items ask.

## Items

1. **done** (`560c7c66`). cg-asm N5: `asm.ts` `lanes()` is `Number(BackendLaneCount.as_u64(count))` (with a `PORT:` on the
   `bigint`), and `llvm_fixup_input`'s AArch64 `vreg_low16` vector arm, upstream's `count.as_u32()` (asm.rs:1207), calls
   `BackendLaneCount.as_u32`. N1: the cg-asm handoff says 65 fixture rows (two places). N6: the handoff puts `cfg.rs` under
   `mangled_name` (asm.rs:527, through `naked_asm!`), leaving only `x86_64/global_asm_escape.rs` on the `global_asm!` line, and says
   both routes need `Mangler.cpp`.
2. **done** (`cdd71ed1`). cg-di-b:
   - N1: `native.ts` and `cpp_like.ts` unwrap `coroutine_layout` with `debug_LayoutError`.
   - N2: the three `(Size, Align)` `assert_eq!`s (metadata.rs:152, :1561, cpp_like.rs:858) go through `assert_size_and_align_eq`,
     now `std/panic.ts` `assert_eq` with the tuple's Debug (`(Size(8 bytes), Align(8 bytes))`). metadata.rs:182's message form uses a
     new `std/panic.ts` `assert_eq_args` (core's `AssertKind::Eq` with `Some(args)`: `failed: <args>` then `left:`/`right:`); its text
     is checked in `panic.test.ts` against a scratch program built with the pinned rustc (`args` formatted only on failure).
   - N3: `assert_matches(arch, .., "Arch::AArch64", debug_target_spec_other)`.
   - N4: the dead `tag_base_type` import is gone (the debuginfo tests pass without it).
   - N5: `types.rs` gains `no_principal(&u32) -> &dyn Sync` (`VTableTy(_, None)`, `<u32 as _>::{vtable_type}`) and a fourth fixture,
     `x86_64-unknown-linux-gnu.types-g2-lines.ll` (`-Cdebuginfo=2 -Zdebug-info-type-line-numbers`). All four types fixtures are
     re-made with the pinned rustc (`rustc 1.101.0-nightly (6f5da406b 2026-10-10)`); the existing ones change by the new vtable and
     renumbering only. README.md has the command. The test checks the `None` vtable name in the `-g2` fixture, that no type has a
     `line:` there, and `Point`'s `line: 48` in the new one. Mutations: the reviewer's (`VTableTy`'s `None` hash) fails 3 of 13;
     `debug_info_type_line_numbers` → `false` at metadata.ts:974, enums/mod.ts:88 and :231 each fails 1.
   - N6: `UniqueTypeId_discriminant`; a `PORT` header bullet in native.ts, cpp_like.ts and type_map.ts for each renamed local and
     why (TDZ or shadowing an import); the two `as Visibility<ModId>` casts (and their now-unused type imports) removed;
     `with_tcx`'s body indented; tests 4 and 5 lose their placeholder context and `build_compile_unit_di_node` double (test 4 now
     counts the real `finalize` with a call-through spy).
3. **done** (`13a56d66`). fixers-59:
   - N1: `DummyArchiveBuilderBuilder` is exported (`PORT:` note) and the new `src/rustc_interface/util.test.ts` runs its
     `create_dll_import_lib` for x86_64-pc-windows-msvc (`coff`) and x86_64-unknown-linux-gnu (`gnu`), checking the written archive
     byte for byte. The expected bytes are what the pinned `llvm-ar rcs --format=coff|gnu` writes with no members (coff: the magic
     and two empty symbol tables; gnu: the magic); a second test re-makes them when the toolchain is present. Dropping the
     `build()` call fails 2. (x86_64-pc-windows-gnu has no target spec in the port, so the msvc target is used.)
   - N2: `apple.ts` `stdout_to_path` decodes with `ignoreBOM`, with the reason in its `PORT:`. New `apple.test.ts` checks it; without
     `ignoreBOM` it fails.
4. **done** (`dbba5e66`). cg-intrinsic-b, with ir-fix-b's model on main:
   - N1: `simd_model.rs` and the aapcs `va_targets.rs` case now compile in the port and compare IR. **All four survivors are now
     killed**:

     | mutation | result |
     |---|---|
     | M3 gather alignment → `1` (intrinsic.ts:2640) | killed: `simd_model.rs --cfg gather` fails |
     | M4 masked `Element` → `align_of(vector_ty)` (:2662) | killed: `--cfg masked_load` fails |
     | M5 unordered f32 reduction start → `0.0` (:2874) | killed: `--cfg float_reduce` fails |
     | M6 aapcs `vr_offs` → `3*ptr_offset` (va_arg.ts:200) | killed: the aapcs test fails |

     Both tests drop their exit-70 branch, so a later stop on those paths fails instead of passing.
   - N2: `simd_model.rs`'s functions sit behind one `--cfg` per arm (`gather`, `scatter`, `masked_load`, `masked_store`,
     `float_reduce`); the test compiles and compares each alone, against `simd_model.<arm>.x86_64-unknown-linux-gnu.O.ll` (the old
     single fixture is deleted), and checks each fixture's `define` names. Each mutation above fails only its own arm's test.
   - N3: `va_arg.ts`'s `list.immediate(String)` → `immediate(debug_Value)`, at all nine sites (the six the review lists plus
     ir-fix-a's :52, :530 and :1176, the same defect).
5. **done** (`53295dca`). ir-fix-b-recheck: notes 2 (a source named struct type's `.N` suffix from the destination context's
   `NamedStructTypesUniqueID`) and 4 (comdats: one `touchedBySources` over-prediction) are comment lines in `tools.ts`'s fat-LTO
   header (`LLVMRustLinkerFree`'s doc comment) and bullets in `docs/handoff/ir-fix-b.md`'s PORT 1; note 5's 9 case ids (and the 2
   MATCH) are in that handoff. `git diff` of tools.ts touches ` * ` comment lines only, so lane llir-callbr-mangler's code is
   untouched; a merge conflict is possible only if that lane edits the same comment block.
6. **done** (`50b683cc`). `odht.oracle.test.ts`'s four oracle tests take `ORACLE_TIMEOUT_MS = 60_000`.
7. **done** (`6b783967`). `filesearch.ts`'s `default_sysroot` comment now says most protected suites pass `--sysroot`, and that
   `parse`, `mir-core` and `check-core` do not, so they read the default at `build_session` and spawn the oracle's
   `--print sysroot` once per compile. `config.ts`'s `Sysroot` comment makes no such claim, so it is unchanged.

## Coverage (`bun scripts/coverage.ts --missing`)
asm.rs 18/18, debuginfo/metadata.rs 47/47, metadata/type_map.rs 14/14, enums/native.rs 5/5, enums/cpp_like.rs 13/13,
intrinsic.rs 31/31, va_arg.rs 15/15, back/apple.rs 8/8; rustc_interface/util.rs 18/21 and filesearch.rs 7/14 unchanged by this lane.
`bun scripts/coverage.ts --check`: `markers ok (27349, 95 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5392; library 745; llvm 634)`.

## Evidence
AC power throughout; no `GATE_RUNNING`; other sessions kept the 1-minute load at 13-46. `RUST_TS_AGENT=fixers-60`.
- `bunx tsc`: clean (before every commit).
- `bun scripts/coverage.ts --check`: markers ok (above).
- `bun test ./src/rustc_codegen_llvm/ ./src/rustc_codegen_ssa/ ./src/rustc_session/ ./src/rustc_interface/ ./src/vendor/odht/
  ./src/std/ ./scripts/lib/unit-steps.test.ts`:
  - `CI=1`: **744 pass, 0 fail**, 86 files (186 s).
  - without `CI`: **741 pass, 3 fail** (198 s, load about 40). All three are Bun's 5 s timeout in files this lane did not touch:
    `link_with_args.oracle.test.ts` "exec_linker falls back to an @-file" (5004 ms) and both `rpath.oracle.test.ts` cases
    (5002, 5004 ms). Rerun alone: both rpath cases pass; "exec_linker" timed out again at load 40, and passes with `--timeout
    60000` (the file's 4 tests in 6.6 s). That test is pure CPU work (a binary search over `Command` sizes) and touches none of
    this lane's changes. Like odht (item 6), it would need an explicit timeout; that file is not in this lane's list.
- `difftest --sample 200 --jobs 6`:

  | suite | run | MATCH | DIFF | UNPORTED | protected in sample | protected not MATCH |
  |---|---|---|---|---|---|---|
  | run-pass-native | `20261115-091112-fixers-60-hn6c` | 199 | 0 | 1 | 199 | **0** |
  | ir-run-pass | `20261115-091355-fixers-60-7iyi` | 200 | 0 | 0 | 200 | **0** |

  The one UNPORTED, `tests/ui/asm/label-operand.rs#aarch64` (`llir: LLVMBuildCallBr`), is not protected; it is lane
  llir-callbr-mangler's.

## `unported(...)` left
None added or removed.

## `// PORT:` decisions
- `asm.ts` `lanes()`: `as_u64` returns a `bigint`; a lane count is at most `MAX_SIMD_LANES`, so `Number(..)` is exact.
- `rustc_interface/util.ts`: `DummyArchiveBuilderBuilder` exported (upstream's is private) for util.test.ts.
- `apple.ts` `stdout_to_path`: `ignoreBOM`, as `from_vec` keeps the bytes.
- PORT header bullets for the renamed locals in native.ts, cpp_like.ts, type_map.ts (TDZ / import shadowing).

## For root
- `src/std/panic.ts` gained `assert_eq_args` (core's `assert_eq!` with a message). Other ports that hand-write that text
  (`std/env.ts:316` writes it inline) can use it.
- Bun's 5 s default also caught `link_with_args.oracle.test.ts`'s "exec_linker" test under load (Evidence).
- cg-intrinsic-b N5 stands: under load, `simd_intrinsic.test.ts`'s driver-spawning tests run close to Bun's 5 s default. One run
  here, at a 1-minute load of about 18 from other sessions, timed out `simd_err.rs` at 5033 ms; the rerun passed. Not in this
  lane's list; an explicit timeout there (as item 6 did for odht) would rule it out.
