# Review root-w57-check: root's wave 40q integration commits on `integ-w57`

Reviewer (independent, read-only on code). Subject: `631110e5` (on main), `2b6ac7f1` and `ba365c6e`, plus the lane merges
on `integ-w57` (checked for resolution only). Reviewed at `ba365c6e`.

## Verdict: APPROVE WITH NITS

The `link.ts` wiring forwards each entry to the right port with the right arguments, and the imported types match what
`link.ts` uses. `ArchiveBuilder::build` now takes `symbols` everywhere upstream passes it. The pathdiff scope entry matches
the rust repo's `Cargo.lock`. `LLVMRustInlineAsmVerify` is a correct D10 stand-in, and `ffi.ts` equals the generator's
output. The N1 assertion catches the cg-register review's mutation without `CI`. Every merge on the branch is exactly git's
automatic merge.

The only finding, N1, is about pathdiff's coverage: three functions could be marked or skipped instead of being left
uncovered. Nothing must be fixed before acceptance.

## Evidence

| Check | Result |
|---|---|
| `bunx tsc` | exit 0 |
| `bun scripts/coverage.ts --check` | `markers ok (27154, 74 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5323; library 745; llvm 524)` |
| `bun test <the 7 paths>` with `CI=1` | 836 pass, 0 fail, 78 files |
| same, `CI` unset | 836 pass, 0 fail, 78 files |
| `ir-hello` (`RUST_TS_AGENT=rw57chk-a`) | MATCH 2/2, tier N1 (run `20261114-065136-rw57chk-a-6gej`) |
| `check-ui --sample 200 --jobs 6` | MATCH 200/200 (run `20261114-065138-rw57chk-a-hlob`) |
| `mono-ui --sample 200 --jobs 6` | MATCH 200/200, 488 skipped (run `20261114-065209-rw57chk-a-xie9`) |
| `bun tools/llir/ffi_gen.ts`, then `--check` | tree unchanged after regenerating; `contract up to date: 381 fns, 33 enums, 4 bitflags` |
| N1 mutation (`codegen_backend.ts:284` → `if (true)`), `CI` unset, `wire.test.ts` + `src/rust_ts/` | 268 pass, **1 fail** (`wire.test.ts:70`, lists `rustc_codegen_llvm/lib.ts`, `llvm_util.ts`, ...); reverted, tree clean |

Setup: `.env.local` from `integ-w39` plus `RUST_TS_REQUIRE_PROBES=1` and `RUSTUP_AUTO_INSTALL=0`;
`bun install --frozen-lockfile`. The machine was on AC power, and no `GATE_RUNNING` file existed in the main checkout.

## 1. `link.ts` wiring (`2b6ac7f1`)

- **Forwarders** (`src/rustc_codegen_ssa/back/link.ts:2272-2314`):
  - `disable_localization(cmd)` calls linker.ts:154. Upstream is linker.rs:39 `disable_localization(&mut Command)`.
  - `Command_new` calls `Command.new` (command.ts, marker command.rs:27).
  - `debug_Command` calls command.ts:198 (`impl Debug`, command.rs:209).
  - `Linker_link_args` / `Linker_link_arg` call `DynLinker.link_args` / `link_arg` (linker.ts:553/557). These are the
    `generate_arg_methods!` methods (linker.rs:248/252): `link_args(self, args)` and `link_args(self, iter::once(arg))`.
  - `extract_bundled_libs` calls `ArchiveBuilderBuilder_provided.extract_bundled_libs(abb, rlib, outdir, names)`
    (archive.ts:174, archive.rs:153), receiver first.
  - `ArchiveBuilder_build` calls `ab.build(output, symbols)`.
  - `get_tools_search_paths(sess, self_contained)` calls linker.ts:104, a copy of session.rs:825's body. Its location is
    stated in a `PORT:` note.
- **Types:**
  - command.ts's `ExitStatus` has `code(): number | undefined` and `success(): boolean`, the same shape as the removed
    stand-in. Its `success` is `code() === 0`, as std's.
  - `Output` has the same three fields (`status`, `stdout`, `stderr`).
  - `DynLinker` provides `link_dylib_by_name`, `link_staticlib_by_path` and the arg methods.
  - `ArchiveSymbols` (archive.ts:273) has the removed stand-in's fields.
  - `tsc` is clean.
- **Stand-ins left:** only `JobserverAcquired` and `LinkingFailed`, as intended. The `thorin` stand-ins belong to a crate
  that is not vendored, which predates this commit.
- **Remaining stubs:** the remaining `unported("ssa-...")` calls in `link.ts` are exactly the five ssa-link-b entries:
  - `exec_linker` (link.rs:2105)
  - `self_contained_components` (:2312)
  - `linker_with_args` (:2870)
  - `relevant_lib` (:3773)
  - `create_raw_dylib_dll_import_libs` (raw_dylib.rs:63)

  All five line references were checked at the pin.

## 2. `symbols` required

- **Implementers:**
  - `ArArchiveBuilder.build` (archive.ts:599) and the interface (archive.ts:287) are the only real implementer.
  - rustc_codegen_llvm's `LlvmArchiveBuilderBuilder` (`src/rustc_codegen_llvm/back/archive.ts:18`) returns an
    `ArArchiveBuilder`, as upstream does.
  - The stand-in builder in `src/rust_ts/codegen_backend.ts:757` stops before building anything.
  - The mock in `link.test.ts:252` (`build: () => true`) type-checks.
- **Callers:**
  - `link.ts` passes `undefined` at :400 and :1584 (upstream link.rs:373 and :1598 pass `None`) and `symbols` at :886
    (link.rs:878).
  - link.rs:3762 is in ssa-link-b's range and is not ported yet.
  - The tests pass `undefined` (`rlib_native.oracle.test.ts:118, :222`) or a fixture (`archive_oracle.test.ts:75`).

## 3. pathdiff in scope

- `harness/scope.json` `"pathdiff": "=0.2.3"` is correct:
  - `Cargo.lock:2919-2920` at the pin is `pathdiff` 0.2.3.
  - `rustc_codegen_ssa/Cargo.toml:13` asks for `0.2.0`.
  - The entry is an exact `=` version, as the other vendor entries are.
- **Markers:**
  - `lib.ts:31` `crate: pathdiff-0.2.3/src/lib.rs:43 diff_paths`, and the six test markers in `lib.test.ts` (:176, :195,
    :207, :213, :220, :241), all point at the right lines.
  - The pending-marker `PORT:` notes were removed.
  - `coverage --check` accepts them.
- **Coverage:** 7/10. `diff_utf8_paths` (:121), `abs` (:177) and `assert_diff_paths` (:247) are missing. Leaving
  `diff_utf8_paths` unported is right: it is `#[cfg(feature = "camino")]`, and rustc's build does not enable that feature.
  But see N1.

## 4. `LLVMRustInlineAsmVerify` (`ba365c6e`)

- **Marker:** `core.ts:480` names `RustWrapper.cpp:654`, the line of the definition's name at the pin.
- **Comment claims:**
  - `InlineAsm.cpp:274` is `Error InlineAsm::verify(...)` in the pinned llvm-src.
  - `asm.rs:363` is `.unwrap_or_else(|| span_bug!(.., "LLVM asm constraint validation failed"))`.
  - `intrinsic.rs:173` is `.unwrap_or_else(|| bug!("failed to generate inline asm call for `black_box`"))`.
  - Those two (through `inline_asm_call`, asm.rs:536/563) are the only upstream callers, so "differs only on a path that
    would be a compiler bug" holds. This is the wording review cg-register N3 asked for.
  - Plan-m7 D10 authorizes this stand-in.
- **The `unwrap<FunctionType>` check:** it mirrors `cast<FunctionType>`. It throws the same model error as the existing
  `LLVMGetInlineAsm` check (core.ts:476/488) and the other `unwrap<T>` helpers (core.ts:110-126). That matches the model's
  convention.
- **`ffi.ts`:** it matches what the generator writes now, and `IMPLEMENTED` gains the name (285 of 381). `ir-hello` is
  MATCH 2/2 at N1, the same as root's run.

## 5. Tests

- **The N1 assertion** (`wire.test.ts:70`) fails under the review's mutation with `CI` unset, so it closes cg-register N1.
  The `CI=1` run passes too.
- **The removed branches were dead:**
  - The `CI` branches in `wire.test.ts` and `compare_impl_item.oracle.test.ts` needed
    `!IMPLEMENTED.has("LLVMRustDisableSystemDialogsOnCrash")`. Since fixers-57 it is implemented (`target.ts:134`,
    asserted at `target.oracle.test.ts:204`).
  - The not-implemented branch of `intrinsic.test.ts` (black_box) needed `!IMPLEMENTED.has("LLVMRustInlineAsmVerify")`,
    which this commit makes false.
  - Each kept branch is the one that runs now. The removed branches tested only a state that can no longer occur, so no
    reachable case lost coverage.
- **The `codegen_backend.ts` comment (N2)** gives the right lines (base.rs:723-733) and says correctly that only the order of
  stops can change.

## 6. `631110e5` and the merges

- `harness/llvm-manifest.json`: the new entry's SHA-256 (`462bb0fd…3901`) equals `shasum -a 256` of
  `llvm-src/aab11ee0…/llvm/lib/Support/Unix/Signals.inc`. The commit is the rust checkout's `src/llvm-project` gitlink. The
  file backs the live marker `target.ts:139` (`Signals.inc:991 DisableSystemDialogsOnCrash`).
- **Merges:** all 12 merges in `main..ba365c6e` have the same tree as `git merge-tree --write-tree <p1> <p2>`, so none was
  resolved by hand.
  - The only file changed on both sides of any merge is `src/rustc_codegen_llvm/skeleton.test.ts`, in `4d2c6b92`.
  - Its two sides touch separate hunks: fixers-57's `init` test at :355 and cg-register's `"cg-asm": 3` stub count at :125.
    The merged file keeps both, and the test passes.

## Findings

**N1 (nit, coverage). pathdiff is left at 7/10 where the repo's convention gives 10/10.**
- **Files:** `src/vendor/pathdiff/lib.test.ts:29`, `src/vendor/pathdiff/lib.test.ts:41` and `src/vendor/pathdiff/lib.ts:10`.
- **The two test helpers are ported but unmarked:**
  - `assert_diff_paths` (lib.test.ts:29 ports lib.rs:247) and `abs` (lib.test.ts:41 ports lib.rs:177).
  - Other vendored tests mark their helpers, e.g. `src/vendor/rustc_literal_escaper/tests.test.ts:14`
    (`crate: ... test.rs:9 check`) and `src/vendor/ena/undo_log.ts:237`.
  - Adding `// crate: pathdiff-0.2.3/src/lib.rs:247 assert_diff_paths` and `...:177 abs` above them would count them.
- **`diff_utf8_paths` is explained only in a `PORT:` note** (lib.ts:10).
  - The precedent for a function behind a feature that is off is `crate-skip:`, e.g. `src/vendor/ena/unify/backing_vec.ts:182`
    (`crate-skip: ena-0.14.4/... default cfg(feature = "persistent") is off`).
  - `// crate-skip: pathdiff-0.2.3/src/lib.rs:121 diff_utf8_paths cfg(feature = "camino") is off` would make the omission
    checkable.
- **As it stands, 7/10 is acceptable:** nothing is guessed, and every function rustc reaches is ported and marked. This is
  for the next fixers wave.

No other findings.
