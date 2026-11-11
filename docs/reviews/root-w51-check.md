APPROVE WITH NITS

# root-w51-check: independent check of root commit `4ce97419` on `integ-w51`

Branch checked: `integ-w51` at `c89b9f40` (Merge t3/review-bun-144-recheck3). Merge base with `main`: `a31e4565`.
The commit under check: `4ce97419` "integ-w51: add 13 LLVM files llir-core-a cites to the manifest (scope-m7 R1;
llir-core-a re-check)". It touches only `harness/llvm-manifest.json`: 13 insertions, 0 deletions.
Host: on AC power (`pmset -g batt`: 'AC Power', charged). Env: `.env.local` copied from `integ-w39`,
`RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`. Nothing was written into `$RUST_TS_DATA/llvm-src/`.

## 1. Paths and SHA-256 of the 13 entries: all correct

I fetched **all 13** files (not only the minimum of 4) from
`https://raw.githubusercontent.com/rust-lang/llvm-project/aab11ee0ea5ea9a1d462ad0bc1fae9d9bb643019/<path>` (`curl -f`, so a
404 would have failed) into my scratchpad. I hashed each one with `shasum -a 256` and compared the full hex string to the
manifest on `integ-w51`. The manifest's `commit` is `aab11ee0ea5ea9a1d462ad0bc1fae9d9bb643019` and its `repo` is
`https://github.com/rust-lang/llvm-project`.

| Path | SHA-256 (first 12 hex digits) | Result |
|---|---|---|
| `llvm/lib/IR/LLVMContext.cpp` (required) | `c6a33efadd90` | MATCH |
| `llvm/lib/IR/TypeFinder.cpp` (required) | `ddb1d7f7680a` | MATCH |
| `llvm/include/llvm/IR/FixedMetadataKinds.def` | `457d89e54c31` | MATCH |
| `llvm/lib/Support/StringExtras.cpp` | `a070ab2e8bef` | MATCH |
| `llvm/lib/Support/ModRef.cpp` | `2aa2aee8a163` | MATCH |
| `llvm/include/llvm/IR/Metadata.h` | `ae0ed801424c` | MATCH |
| `llvm/include/llvm/IR/Module.h` | `e0c67645b6fc` | MATCH |
| `llvm/include/llvm/IR/Constant.h` | `5a87d1d126f8` | MATCH |
| `llvm/lib/AsmParser/LLLexer.cpp` | `32c91438e562` | MATCH |
| `llvm/include/llvm/IR/GEPNoWrapFlags.h` | `21061cd65452` | MATCH |
| `llvm/include/llvm/Support/CodeGen.h` | `e27db427217a` | MATCH |
| `llvm/include/llvm/ADT/StringRef.h` | `f7afa3c94826` | MATCH |
| `llvm/include/llvm/ADT/Twine.h` | `631d996b9cf7` | MATCH |

In the fetched copies, the two required markers point at definitions: `LLVMContext.cpp:280` is
`unsigned LLVMContext::getMDKindID(StringRef Name) const {` and `TypeFinder.cpp:34` is
`void TypeFinder::run(const Module &M, bool onlyNamed) {`.

The list is exactly what the reviews asked for. `docs/reviews/llir-core-a-recheck.md` (lines 232-250) names the same 2
required files and the same 11 cited files, 13 in total, and `docs/reviews/scope-m7.md` R1 names `LLVMContext.cpp`.

**The two required files really were required.** At `4ce97419^` (`66d89349`), `bun scripts/coverage.ts --check --offline`
prints exactly 2 ERRORs:
- `src/rust_ts/llvm/printer.ts: marker llvm/lib/IR/TypeFinder.cpp:34 TypeFinder::run names no file of harness/llvm-manifest.json`
- `src/rust_ts/llvm/ir.ts: marker llvm/lib/IR/LLVMContext.cpp:280 LLVMContext::getMDKindID names no file of harness/llvm-manifest.json`

## 2. No other manifest entry changed

- `git show --stat 4ce97419` shows `harness/llvm-manifest.json | 13 +++++++++++++` and no deletions. Every `+` line in the
  diff is one of the 13 entries. `comment`, `repo`, `commit`, `branch` and the 43 existing file entries are untouched.
- `git diff 4ce97419^ integ-w51 -- harness/llvm-manifest.json` is the same 13 insertions, so no later commit on the branch
  touches the manifest.
- The keys stay in sorted order, as the `add` tool writes them.

## 3. Tool checks on `integ-w51` (`c89b9f40`): both pass

- `bun scripts/llvm-src.ts check`: exit 0, `llvm-src ok: 56 files at aab11ee0ea5e (the checkout's gitlink)`.
- `bun scripts/coverage.ts --check --offline`: exit 0,
  `markers ok (25786, 32 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311; library 735; llvm 174)`.

## 4. Commit audit: nothing beyond the six lanes, their reviews, root's merges and docs, and `4ce97419`

All 36 non-merge commits in `a31e4565..integ-w51` have the author `Tomer Norman`, the same as the lanes and reviewers. So
`--author` cannot tell root's commits apart. I classified every commit by the merge that brings it in and by the files it
touches instead.

- **First-parent non-merge commits** (`git log --first-parent --no-merges a31e4565..integ-w51`): only `4ce97419`.
- **First-parent merges**: 16. Each is one of the six lanes (stats, scope-m7, ssa-contract, driver-cli-2, llir-core-a,
  bun-144) or one of their review branches (stats, scope-m7, ssa-contract, driver-cli-2, llir-core-a review and re-check,
  bun-144 review and re-checks 1-3). For all 16, `git show --remerge-diff` is empty, so no merge carries a conflict
  resolution or any extra change.
- **Lane commits (25)**, reached through each lane merge's second parent:
  - stats: `6eae1835`, `eac28a6b`, `87650a87`, `75357019`
  - scope-m7: `f5d0a43d`
  - ssa-contract: `467f2b1b`
  - driver-cli-2: `6738d1e1`, `c10ec0e8`, `9d6c0635`
  - llir-core-a: `11271a62`, `b2942a4d`, `dbb4fc94`, `b8c622f7`, `2f2aa3f0`, `e5f3e5a5`, `5c351241`
  - bun-144: `ca0f85e3`, `9d60363f`, `2e1ba8af`, `2153553f`, `354cd63a`, `f5375852`, `3307d88a`, `e71d868d`, `9bf84f4f`

  Each merged tip is a SHA its review or re-check cites:

  | Lane | Merged tip | Cited in |
  |---|---|---|
  | stats | `75357019` | `stats.md` |
  | scope-m7 | `f5d0a43d` | `scope-m7.md` |
  | ssa-contract | `467f2b1b` | `ssa-contract.md` |
  | driver-cli-2 | `9d6c0635` | `driver-cli-2.md` |
  | llir-core-a | `5c351241` | `llir-core-a-recheck.md` |
  | bun-144 | `9bf84f4f` | `bun-144-recheck3.md` |

- **Review commits (10)**: each touches only its own `docs/reviews/*.md`: `ad8165b3`, `45cb0207`, `6097243b`, `b2a0802b`,
  `398aef59`, `5457b755`, `0ee916ac`, `61616354`, `b3b32a3f` and `b666b74a`.
- **Root's commit**: `4ce97419` (`harness/llvm-manifest.json` only), checked above.
- **Root's doc commits on `main`** (the review branches were cut from `main`, so these reach `integ-w51` through the review
  merges; they sit at or before the merge base): `41ef6c55`, `a78152d3`, `5eb927af`, `7efb9a4c`, `034ae063`, `60b33152`,
  `e8ca37a5`, `9295d3ea`, `56bfdeee`, `423a2797`, `3b6b9461`, `8c2967aa`, `c20fbd7a` and `a31e4565`.
  - Twelve touch only `docs/next.md`.
  - `5eb927af` and `034ae063` also touch `docs/state/current.json` and `docs/state/history.jsonl`. Each adds one `decision`
    record (ssa-contract representation; driver-cli-2 codecs). `current.json` changes only `updated` and the `ported` count
    that `state.ts record` refreshes. Neither commit touches a baseline or an accept record.

So root's only non-doc commit on the branch is `4ce97419`.

## 5. `bunx tsc` on `integ-w51`

Exit 0, no output (about 9 s).

## Nits

- **N1 (commit message wording).** The message says the 11 extra files are "Cited in comments". Three of them have no
  citation in any source comment on the branch: `Constant.h` (`isNullValue`), `LLLexer.cpp` (the parser accepts `f0x…`) and
  `ModRef.cpp` (`captures(...)` printing). They are cited only in `docs/handoff/llir-core-a.md` (lines 48-52) and the
  re-check's list. `FixedMetadataKinds.def`, `Module.h`, `GEPNoWrapFlags.h`, `StringRef.h` and `Twine.h` are cited in
  `src/rust_ts/llvm/` by base name or a partial path, not by the full manifest path. Adding the files is still right, since
  the re-check asked for exactly these 13. Only the message's description is loose. No action needed.
- **N2 (process).** Every commit on the branch, lane and root alike, has the same git author. So the brief's
  `git log --no-merges --author` cannot isolate root's commits, and an audit has to classify by merge parent and files
  touched, as done above. Future root-check briefs could say so.
