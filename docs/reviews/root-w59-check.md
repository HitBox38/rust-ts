# Review: root's wave 40s integration (`root-w59-check`)

Reviewer, read-only on code. Subject: `integ-w59` at `6a8d8f93`. Review branch `t3/review-root-w59-check`, at `6a8d8f93`.
Root's own work: the conflict resolutions in `0fcf9c5f`, `49e9b1b3` (ir-fix-b) and `5194b358` (cg-di-b), and the commits
`7c67e570`, `09ca6ee4` and `609b519c`.

Setup: AC power, no `GATE_RUNNING`. `.env.local` from integ-w39 plus `RUST_TS_REQUIRE_PROBES=1` and `RUSTUP_AUTO_INSTALL=0`.
`bun install --frozen-lockfile`. `RUST_TS_AGENT=review-root-w59-check`, `--jobs 6`.

## Verdict: **APPROVE WITH NITS**

- **Every resolution keeps what it should.** Of the 14 merges, only 3 had conflicts (`git show --remerge-diff`), and each
  conflict was resolved as the reviews said. Every other file a lane touched equals that lane's side.
- **`ffi.ts` is generated.** A fresh `bun tools/llir/ffi_gen.ts` leaves the tree byte-identical.
- **The `09ca6ee4` flag is correct.** It flags the note-1 repro, which the old name check missed. It raises no false flag on
  the two fat-LTO cases that MATCH or on look-alike names. The 9 fat-LTO cases still stop by name in `ir-host` and
  `ir-run-pass`, and they still MATCH in `run-pass-native`. **No test pins the fix, though (N1).**
- **The pins check out.** All 19 new manifest hashes equal SHA-256s of files fetched fresh at `aab11ee0ea5e`.
- **`609b519c` is right.** `debug_int` prints `u64` as Rust's Debug does.
- **No protected case left MATCH in any sample.** The `run-pass-native` sample is 198/199, or 99.5%, with 1 UNSTABLE excluded.

## Commands

| command | result |
|---|---|
| `bunx tsc --noEmit -p .` | clean |
| `bun scripts/coverage.ts --check` | `markers ok (27349, 95 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5392; library 745; llvm 634)` |
| `bun scripts/llvm-src.ts check` | `llvm-src ok: 115 files at aab11ee0ea5e (the checkout's gitlink)` |
| `CI=1 bun test ./src/rustc_codegen_llvm/ ./src/rust_ts/ ./src/std/result.test.ts ./scripts/coverage.test.ts ./scripts/lib/unit-steps.test.ts` | **485 pass, 0 fail**, 50 files, no SKIP line |
| the same without `CI` | **485 pass, 0 fail**, 50 files |
| `bun tools/llir/ffi_gen.ts` | `wrote ffi.ts (381 fns) ...`; `git status` clean afterwards |
| `difftest --suite run-pass-native --sample 200` (`rw59-sample-run-pass-native`) | MATCH 198, UNPORTED 1 (`#thin0`, D8), UNSTABLE 1 (`hashmap-debug-format.rs`), DIFF 0. 192 protected cases in the sample, **0 lost** |
| `difftest --suite ir-run-pass --sample 200` (`rw59-sample-ir-run-pass`) | MATCH 197, UNPORTED 3 (`asm/cfg.rs#reva` at `LLVMRustGetMangledName`, `#thin0`, `cfi/fn-ptr.rs#kcfi`), DIFF 0. 196 protected cases, **0 lost** |
| `difftest --suite ir-host --sample 200` (`rw59-sample-ir-host`) | MATCH 199, UNPORTED 1 (`#thin0`), DIFF 0. 193 protected cases, **0 lost** |
| `difftest --suite mono-ui --sample 200` (`rw59-sample-mono-ui`) | MATCH 200/200. 200 protected cases, **0 lost** |
| `difftest --suite mir-o2 --sample 200` (`rw59-sample-mir-o2`) | MATCH 200/200. 200 protected cases, **0 lost** |

**The `run-pass-native` rate.**
- The sample gives MATCH 198/199 = **99.5%**, with the 1 UNSTABLE case excluded. M7c needs 98%.
- It is a 200-case sample, so it is an estimate only. The Wilson 95% interval is about 97.2% to 99.9%.
- The last accepted gate measured 96.5%. Only a full gate can say whether M7c is met.

## 1. Conflict resolutions and the hand application

For every merge, I ran `git show --remerge-diff`. Only `0fcf9c5f`, `49e9b1b3` and `5194b358` show anything. The other 11 merged
without a hand edit.

**`0fcf9c5f` (fixers-59).**
- The conflict was in `simd_intrinsic.test.ts`, where fixers-59 had changed `toContain` to `toBe` in the `simd_stop.rs` test.
  cg-intrinsic-b deleted that test and its fixture. Root took cg-intrinsic-b's side, so the edit drops out, as both reviews say.
- That one-line edit is fixers-59's only change to the file (`git diff <merge-base> 024d1ba7`).
- The other 18 files fixers-59 touched are byte-identical in the merge and on its branch, so nothing else was lost.

**`7c67e570` (cg-asm's wiring, by hand).**
- Compared hunk by hunk with `docs/handoff/cg-asm/module-asm-wiring.patch`:
  - `impl_modules.ts` appends `"./inline_asm.ts"` after llir-di's `"./di_builder.ts"`.
  - `printer.ts` gets the import and `o += printModuleInlineAsm(m);` at the patch's place (`printer.ts:10`, `:600`).
  - `ffi.ts` binds `LLVMRustAppendModuleInlineAsm` to `impl6` (`inline_asm.ts`), which is `impl5` in the patch, because
    `di_builder.ts` is now `impl5`.
- The `unported("llir: printing module inline asm")` guard on `Module.inlineAsm` (`printer.ts:599`) stays, as it does in the
  patch. It never fires: the module asm lives in `inline_asm.ts`'s side table, and nothing writes `Module.inlineAsm` (N3).
- Run by filter:
  - `asm/aarch64/const.rs` and `asm/empty_global_asm.rs` **MATCH** in `run-pass-native` (`rw59-run-pass-native-asm_*`).
  - Both also MATCH in `ir-host` (`rw59-ir-host-asm_*`).
- In `skeleton.test.ts`, the `cg-intrinsic-b: 2` entry is removed and the comment updated. The count test passes.
- The interim stop in `debuginfo/mod.test.ts` is superseded by the cg-di-b merge, as the brief says.

**`49e9b1b3` (ir-fix-b).**
- The only conflicted hunk is `ffi.ts`'s `IMPLEMENTED` header count, now "330 of 381".
- The whole file equals a fresh `ffi_gen.ts` run (§2).

**`5194b358` (cg-di-b).**
- `debuginfo/mod.test.ts` equals cg-di-b's `0eb82ea1` byte for byte.
- In `skeleton.test.ts`, the combined `EXPECTED` keeps the following and passes the count test:
  - the dropped-entry comments for `cg-asm` (root's side) and `cg-di-a` (cg-di-b's side);
  - `"cg-di-b": 2`;
  - no `cg-intrinsic-b` entry.

  Its other entries are unchanged.
- The "one stub per owning file" test is cg-di-b's (`debug_Metadata` stops by lane).

## 2. `ffi.ts`

`bun tools/llir/ffi_gen.ts` wrote `ffi.ts` and `ffi_types.ts`, and `git status --short` was empty afterwards. Both files are
exactly the generator's output.

## 3. The `09ca6ee4` flag (`src/rust_ts/llvm/tools.ts:1110`, `:1209-1210`)

**Is the comparison correct?**
- **Attributes after the type body:** none. LLVM's type definition syntax has no trailing attributes or comments, so each line is
  `%T = type <body>` and nothing else.
- **`opaque` types:** at this LLVM, `areTypesIsomorphic` calls an opaque struct "never isomorphic" (IRMover.cpp:102-106), so a
  destination `%O = type opaque` is never merged or completed. Its line comes through unchanged.
  - Scratch case: a destination with `%O = type opaque` and `@o = external global %O`, and a source with `%O = type { i32 }`.
  - The model's text equals libLLVM's (`%O.0 = type { i32 }`), and the module is **not** flagged.
- **Line endings:** on macOS, both texts use `\n`. Windows differs (N2).
- **The regex:** it is anchored, non-global and non-multiline, used with `.test` per line, so it has no `lastIndex` state. It
  accepts quoted names (`%"x::Y"`).

**False flags on normal fat-LTO output: none seen.**

| filter | `run-pass-native` | `ir-host` | `ir-run-pass` |
|---|---|---|---|
| `lto` | fat cases all MATCH (`fat-lto`, `lto-many-codegen-units`, `lto-still-runs-thread-dtors`, `lto-abort`, `lto-unwind`); `stack-probes-lto#aarch64` UNSTABLE (listed: the stack-overflow thread id) | `fat-lto`, `lto-many-codegen-units` MATCH; `stack-probes-lto#aarch64`, `lto-still-runs-thread-dtors`, `lto-abort`, `lto-unwind` stop by name | same, with `stack-probes-lto#x64` |
| `issue-64655` | `#fat`, `#fat0`-`#fat3` MATCH | `#fat`, `#fat0`-`#fat3` stop by name | same |

- These are exactly the 9 cases of `ir-fix-b-recheck.md` in `ir-host`, and the same ones in `ir-run-pass`.
- The stop text is `llir: fat LTO merged named struct types (llvm-link's IRMover; rustc's in-process link keeps them)`.
- The thin-LTO cases are unchanged: UNPORTED (D8), or the known ThinLocal DIFFs (`thin-lto-*`, `weak-works`) in the IR suites.
- Every protected case in the filters MATCH: `#no`, `#no0`-`#no3`, and in `run-pass-native` also `thin-lto-*` and `weak-works`.
- Run ids: `rw59-{run-pass-native,ir-host}-{lto,issue-64655}` and `rw59-irp-{lto,issue-64655}`.

**The note-1 repro (RC-E) is now flagged.** I ran it as a scratch test against libLLVM's `LLVMLinkModules2`. It was not
committed, and the tree is clean.
- The destination has `%A = type {}`, `%B = type {}`, `@a` and `@b`. The source has `%B = type { i32 }` and `@sb`.
- libLLVM prints `%B = type {}`, `%B.0 = type { i32 }` and `@b = global %B`.
- The model prints `%B = type { i32 }` and `@b = global %A`, which is the merge. `LLVMWriteBitcodeToFile` now **stops** with the
  merged-types message.
- The pre-`09ca6ee4` name check, applied to the same two texts, does **not** flag it.
- Control case: distinct bodies with look-alike names. The destination has `%A = type { i8 }` and `%"x::Y" = type <{ i16, [2 x i8] }>`,
  and a source reuses both names, with `%"x::Y"` taking another body. That case is not flagged, and its text equals libLLVM's
  (`%"x::Y.1"`).

## 4. The pins

- The 19 new entries are the 11 from `7c67e570` and the 8 from `09ca6ee4`. The `Triple.cpp` line changes only its trailing comma.
- Each file was fetched from `raw.githubusercontent.com/rust-lang/llvm-project/aab11ee0ea5ea9a1d462ad0bc1fae9d9bb643019/<path>`
  into the scratchpad and hashed with `shasum -a 256`. **19/19 equal the manifest.**
- The manifest's commit is the checkout's `src/llvm-project` gitlink (`llvm-src.ts check`). `coverage --check` passes.
- `llvm-link`'s tool hash is left out, as the commit says, since it keys every IR suite's oracle cache. That is right for a
  harness batch.

## 5. `609b519c`

- `alloc_to_backend` returns `Result<&Value, u64>` (common.rs:183). The port has `Result<Value, bigint>` (`common.ts:237`).
- `debug_int` is `String(v)` (`src/std/fmt.ts:182`), so `10n` prints `10`. That matches `<u64 as Debug>` without `{:x?}`.
  `unwrap_result(r, debug_int)` then panics with ``called `Result::unwrap()` on an `Err` value: <n>``, as upstream's
  `.unwrap()` at asm.rs:169 and :460 does (`asm.ts:215`, `:531`).
- The `coverage.test.ts` example moves to `SymbolWrapper.cpp`. Its 7 fns and `0/7 ported` pass in both unit runs.

## Findings

1. **N1 (nit): no test pins the note-1 fix** (`src/rust_ts/llvm/link.oracle.test.ts:192`, `tools.ts:1209-1210`).
   - I checked out `tools.ts` from before `09ca6ee4` (`git checkout f76a3035 -- src/rust_ts/llvm/tools.ts`). With it,
     `link.oracle.test.ts` and `tools.test.ts` still pass **50/50**, because the F1 test's merge is caught by both checks.
     I then restored the file.
   - A later edit could therefore bring back the hole without any test failing.
   - Fix: add RC-E (§3) to the F1 test. Assert that the module is flagged, and that libLLVM keeps `%B = type {}` beside
     `%B.0 = type { i32 }`. It is about 6 lines in the existing test's style. This is a test-only edit for a lane or root.
2. **N2 (informational): CRLF on Windows** (`tools.ts:1209`).
   - On Windows, `llvm-link -S -o -` writes CRLF (llvm-link.cpp:504-505, `OF_TextWithCRLF`). Every line of `text` would then end
     in `\r`, no destination line would match, and every fat-LTO module would be flagged. The old name regex did not care
     about line endings.
   - This loses nothing on Windows: the path is already wrong there, because `KEEP_LINE`'s `.*\n?` (`tools.ts:958`) leaves the
     `\r\n` behind. Windows is unchecked (AGENTS §5).
   - Worth one `\r?\n` split if the fat-LTO path is ever taken on Windows.
3. **N3 (informational): the dead guard in `printer.ts:599`.**
   - `if (m.inlineAsm !== "") return unported("llir: printing module inline asm")` still sits above the new
     `printModuleInlineAsm` call. Nothing writes `Module.inlineAsm` (`ir.ts:1702`), so the guard can never fire.
   - cg-asm's handoff (§"For root / ir-fix-b" 1) leaves its removal, or moving the side table onto `Module`, to a later llir
     lane. So does its note that `LLVMCloneModule` does not copy the side table. Root's hand application matches the patch,
     and these are queue items, not integration faults.
