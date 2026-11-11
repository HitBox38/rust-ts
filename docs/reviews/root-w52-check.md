APPROVE WITH NITS

# root-w52-check: independent check of root's commits on `integ-w52`

Checked at `integ-w52` = `d2e2f3c7`, detached in my own worktree (the `integ-w52` worktree was not touched). I copied
`.env.local` from `integ-w39` and added `RUST_TS_REQUIRE_PROBES=1` and `RUSTUP_AUTO_INSTALL=0`. Then I ran
`bun install --frozen-lockfile`. Bun was 1.4.4 (`38afee6c`), on AC power the whole time, with load 2-5. I wrote nothing
into `$RUST_TS_DATA/llvm-src/`. My LLVM downloads, the Bun clone and the driver stayed in my scratchpad.

**Verdict.** All three commits do what their reviews verified, and nothing else is on the branch. Every check below
passes. The two nits are optional cleanups.

## 1. `e771735c`: types `generics_of` and `reachable_non_generics`

- **Config entries match the handoff byte for byte.** I compared the two `+` lines of
  `tools/codegen/queries.config.json` with the JSON block in `docs/handoff/codegen-sets-m7.md` (lines 94-95), after
  stripping leading whitespace, using `diff`. They are identical. The file gains 2 lines and loses none.
- **`queries.gen.ts` is up to date.** `bun tools/codegen/queries.ts --check` printed:
  `src/rustc_middle/queries.gen.ts up to date (329 queries, 8 non-queries; unknown types: 96, ...)`. No later commit on
  the branch touches `queries.gen.ts`, `queries.config.json`, `queries.ts`, or the three other files in this commit.
  The regenerated diff types five values:
  - `generics_of` → `Generics`;
  - `reachable_non_generics` → `DefIdMap<SymbolExportInfo>`;
  - `exported_non_generic_symbols` and `exported_generic_symbols` → `readonly [ExportedSymbol, SymbolExportInfo][]`;
  - `generics_of`'s `debug_value` becomes `debug_Generics`. This is the config's `debug` field (see N2).
- **The two hand edits change types only.**
  - `src/rustc_metadata/rmeta/decoder/cstore_impl.ts:598`: `new KeyedMap<DefId, unknown>` becomes
    `new KeyedMap<DefId, SymbolExportInfo>`. `SymbolExportInfo` was already imported (`import type`, line 34).
  - `src/rustc_middle/query/engine.test.ts`: adds `import type { Generics }` and changes the fake's return to
    `{ count: () => 2 } as unknown as Generics`. These are exactly the two fixes the handoff gave (lines 85-87).
- **Tests pass.** `bun test tools/codegen/codegen_m7.test.ts src/rustc_middle/query/engine.test.ts` gave 17 pass, 0 fail
  (89 expect() calls). The test now pins `Generics` and `DefIdMap<SymbolExportInfo>`. `entry_fn` stays
  `[DefId, unknown] | undefined`, as the handoff says.

## 2. `b12fd60c`: `PointerAuthSchema` from `rustc_session`

- **The imports are right.** Upstream at the pin has `use rustc_session::{PointerAuthAddressDiscriminator, PointerAuthSchema};`
  (`compiler/rustc_codegen_llvm/src/common.rs:18`) and `use rustc_session::{PointerAuthSchema, Session};` (`context.rs:27`).
  The type is defined at `session.rs:118`, which is the `rustc-type:` marker at `src/rustc_session/session.ts:137`.
  Both TS files now import it, type-only, from `../rustc_session/session.ts`. `context.ts` drops it from the
  `rustc_codegen_ssa/traits/misc.ts` import and keeps `MiscCodegenMethods` there.
- **The commit fixes the error it targets, and only that error.** At `b12fd60c^`, `bunx tsc --noEmit -p .` exits 1 with
  exactly two errors, both `TS2459 ... declares 'PointerAuthSchema' locally, but it is not exported`: one at
  `common.ts(11,15)` and one at `context.ts(40,35)`.
- **`tsc` is clean at the tip.** At `d2e2f3c7`, `bunx tsc --noEmit -p .` exits 0 with no output, in 8 s.

## 3. `d2e2f3c7`: 10 LLVM files added to `harness/llvm-manifest.json`

- **The paths are the re-check's list.** The 10 added paths are the 10 that `docs/reviews/llir-core-b-recheck.md` lists
  (lines 215-224), no more and no fewer.
- **I fetched all 10, not just 4.** Each came from
  `https://raw.githubusercontent.com/rust-lang/llvm-project/aab11ee0ea5ea9a1d462ad0bc1fae9d9bb643019/<path>` with
  `curl -f`, and I hashed it with `shasum -a 256`. All 10 match the manifest:

  | Path | Bytes | SHA-256 (prefix) |
  |---|---|---|
  | `llvm/include/llvm/IR/FMF.h` | 4331 | `45030288ac4a` OK |
  | `llvm/include/llvm/IR/InstrTypes.h` | 97882 | `7eb23b6c8d9b` OK |
  | `llvm/include/llvm/IR/Instruction.h` | 47121 | `6a35f66c2f6f` OK |
  | `llvm/include/llvm/IR/Instructions.h` | 204893 | `9395f33a5569` OK |
  | `llvm/include/llvm/IR/IntrinsicInst.h` | 61883 | `2e695b261f75` OK |
  | `llvm/include/llvm/IR/Intrinsics.td` | 160903 | `b5a8d5747991` OK |
  | `llvm/include/llvm/Support/AtomicOrdering.h` | 6687 | `96870e67296d` OK |
  | `llvm/lib/AsmParser/LLParser.cpp` | 390013 | `11f44b0dd2e0` OK |
  | `llvm/lib/IR/Instruction.cpp` | 54399 | `905a2e4ede1c` OK |
  | `llvm/lib/IR/Operator.cpp` | 11982 | `b059c27c223f` OK |

  The manifest's `commit` (`aab11ee0ea5ea9a1d462ad0bc1fae9d9bb643019`) is the `src/llvm-project` gitlink of the rust
  checkout at `6f5da406` (`git ls-tree HEAD src/llvm-project`).
- **No other entry changed.** I parsed the manifest before and after the commit as JSON:
  - the non-`files` keys are identical;
  - the 56 old entries are unchanged;
  - there are 10 new entries (66 in total), and the keys stay sorted;
  - the diff has 0 removed lines.

  No other commit on the branch touches the manifest. (`harness-w51` changes other files under `harness/`, as expected
  for that lane.)
- **`bun scripts/llvm-src.ts check`** exits 0 with `llvm-src ok: 66 files at aab11ee0ea5e (the checkout's gitlink)`.
- **`bun scripts/coverage.ts --check --offline`** exits 0 with `markers ok (25920, 43 of them in
  compiler/rustc_llvm/llvm-wrapper; vendor 5311; library 744; llvm 354)`.

## 4. Nothing else on the branch

`integ-w52` forks from `main` at `dfe880f1`, which is on `main`. Its first-parent history from there has 12 merges and
3 direct commits. Below is every commit, grouped by the merge it came in through:

| Came in through | Commits | What they are |
|---|---|---|
| `5706181d` Merge codegen-sets-m7 | `d6a2791f`, `bf71d773` | lane; tip `bf71d773` is the SHA its review checked |
| `69899096` Merge codegen-sets-m7 review | `9be89202` | `docs/reviews/codegen-sets-m7.md` only |
| **direct** | **`e771735c`** | root, item 1 |
| `17f50daa` Merge fixers-52 | `c9919f48` … `c936b424` (6) | lane; tip `c936b424` is the reviewed SHA |
| `dfae5ec1` Merge fixers-52 review | `b7deedf5` | `docs/reviews/fixers-52.md` only |
| `b3319181` Merge harness-w51 | `fe9bdb9b`, `ba8d9811`, `cbef2ddc`, `8b846ca3` | lane; tip `8b846ca3` is the reviewed SHA |
| `a852aef2` Merge harness-w51 review | `bdef1b4a` | `docs/reviews/harness-w51.md` only |
| `6fc13bc9` Merge cg-contract | `72e43136` … `658e1a5b` (6, incl. `277ebfa4` `Session::fewer_names`, decision (6) of 2026-11-11 22:19) | lane; tip `658e1a5b` is the SHA the re-check checked |
| `33e3f39a` Merge cg-contract review | `469d1ef9` | `docs/reviews/cg-contract.md` only |
| `b7c27b66` Merge cg-contract re-check | `e13168b5`; root's `2c042d00`, `733a6381`, `e99223c4`, `e3b8e02e`, `3462439c`, `f9539f24` | review: `docs/reviews/cg-contract-recheck.md` only; root's six: `docs/next.md` only, all on `main` |
| **direct** | **`b12fd60c`** | root, item 2 |
| `c261eab2` Merge llir-core-b | `45701877` … `e5a23dac` (8) | lane; tip `e5a23dac` is the SHA the re-check said to accept |
| `3d371521` Merge llir-core-b review | `7ff520a8` | `docs/reviews/llir-core-b.md` only |
| `dd451223` Merge llir-core-b re-check | `8251f1cf`; root's `eb3f98cb` | review: `docs/reviews/llir-core-b-recheck.md` only; `eb3f98cb`: `docs/next.md` only, on `main` |
| **direct** | **`d2e2f3c7`** | root, item 3 |

So root's non-merge commits are the seven `docs/next.md` commits, each doc-only and each already on `main`, plus the
three commits checked above.

**The merges add nothing of their own.** For each of the 12 merges, `git merge-tree --write-tree <merge>^1 <merge>^2`
produces a tree identical to the merge's actual tree. So every merge was conflict-free and carries no hand edits.

## 5. Gate-style runner unit step and `tsc`

- **Runner unit step (`unitStaticSteps`, `scripts/gate.ts:426`).** I ran it from the scratchpad with a small driver
  that does what the gate does:
  1. Clone the machine Bun (`/bin/cp -c`) into a directory of its own, with a `bunx -> bun` symlink beside it, and put
     that directory first on `PATH`.
  2. Run the driver from the clone, so `process.execPath` is the clone.
  3. Call `unitStaticSteps(UNIT_STEPS["runner unit tests"], runDir)`, then pass each step to the exported
     `runStaticStep`, the gate's own step runner with its skip check.

  I set `RUST_TS_AGENT=root-w52-check`.
  - Command: `<clone>/bun test ./scripts ./harness --timeout=60000 --reporter=junit ...`, one process, no `alone` step.
  - Result: `ok runner unit tests`, and `ok runner unit test skips: 0 (0 allowlisted, 0 not allowed under
    RUST_TS_REQUIRE_PROBES=1)`, in 83.2 s.
  - junit: `tests="558" assertions="3133" failures="0" skipped="0"`.
- **`bunx tsc --noEmit -p .`** exits 0 with no output (see item 2).

I did not run the `src`/`tools` unit step, the gate or any difftest suite, because none was asked for.

## Nits

- **N1 (`cstore_impl.ts:599`, optional).** The cast `as [ExportedSymbol, SymbolExportInfo][]` on
  `tcx.exported_non_generic_symbols(cdata.cnum)` is now redundant. That query's value is typed
  `readonly [ExportedSymbol, SymbolExportInfo][]` by this commit. It is harmless and can go in any later commit that
  touches the file. The casts at lines 661-662 apply to `cdata.*` results, not query values, and are untouched by this.
- **N2 (`e771735c`'s commit message, record only).** The commit is not types-only in `queries.gen.ts`:
  - `generics_of` gains `debug_value: (v, f) => debug_Generics(v, f)` (`queries.gen.ts:2285`). Before, it was
    `undefined`, so `format_value` (`src/rustc_query_impl/query_vtables.ts:107`) stopped with `unported`.
  - `format_value` is read only on the ICE paths: the cached-value mismatch in `rustc_query_impl/execution.ts:261` and
    the feed mismatch in `rustc_middle/query/calls.ts:231`. So no output of a passing case can change.
  - This is what the handoff's config line asks for (`"debug": "debug_Generics($v, $f)"`).
  - The message also does not mention that `exported_non_generic_symbols` and `exported_generic_symbols` became typed
    with `SymbolExportInfo`.

  None of this needs action.
