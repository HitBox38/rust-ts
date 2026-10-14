ACCEPT-WITH-NOTES

# Review: cache-deps (`lane/cache-deps` at b41440d)

Reviewer: reviewer-cd (independent, read-only on the lane; this file is the only change).
- **Scope:** `git diff main...lane/cache-deps` (merge base 935a15a): new `scripts/lib/deps.ts` and
  `scripts/lib/deps.test.ts`, `scripts/difftest.ts` (+15/-3: `depsOf`, a `{ deps }` key part only when non-empty,
  exports), `harness/suites.ts` (`Suite.readsOnlyCaseFile` on 9 suites), `docs/handoff/cache-deps.md`.
- **Merge and build:** `git merge-tree --write-tree main lane/cache-deps` is clean. `bunx tsc --noEmit -p .` prints
  nothing. `bun test scripts`: 12 pass, 0 fail.
- **Baselines:** `git diff --stat main...lane/cache-deps -- harness/baseline` is empty. No oracle output, suite case
  list or command changed.

**Summary.** The batch fixes harness-w13 B1: a `#[path]` target appearing, changing or disappearing now changes the
key. I confirmed this with my own fake trees and with rustc dep-info. Keys of cases that probe nothing are
byte-identical to the old ones. Changed keys only cause cache misses, and a miss always reruns the oracle. The 9
opt-outs are correct. I found three soundness gaps that no protected case hits today. Each is LOW and none blocks:
- N1: `..` in a path after a directory that may not exist.
- N2: an include macro imported under another name.
- N3: read errors are recorded as "missing".

## 1. Correctness: a file appearing, disappearing or changing changes the key (OK)

**Method.** I used scratch `/tmp/cd-review/scripts/check.ts`.
- It points `RUST_TS_DATA` at a fresh temp dir and asserts that `ORACLE_CACHE` is under it.
- It builds fake trees and compares `caseDeps` with `rustc +nightly --edition=2021 --crate-type=lib --emit=dep-info`
  on the same tree.
- The pass criterion: every dep-info file must be in `caseDeps` with a content-hash state.

| fake case | rustc dep-info files | covered |
|---|---|---|
| `mod x;` in the root. `x.rs` (non-mod.rs) has `mod outer { #[path="p.rs"] mod b; mod c; }`, `#[path="xp.rs"] mod xp;` and `include!("i.rs")`, where `i.rs` has `mod d;`. Also `#[path="pd"] mod pm { mod q; }` and `n/mod.rs` with `mod k;` (`k.rs` -> `k/kk.rs`) and `mod deep { mod e; }` | 11 | 11/11 |
| `include!("z.rs")` inside a macro defined in `m.rs` and invoked in `sub/q.rs` (resolved at `sub/z.rs`, the call site) | 4 | 4/4 |
| `#![doc = include_str!(..)]`; `include_bytes!("../data/b.bin")` and `#[path]` in `y/mod.rs` | 4 | 4/4 |
| Lexer traps: `'"'`, `b'\''`, `r#""#`, `"\""`, nested `/* /* */ mod z; */`, lifetimes, then real `mod realm { mod inner; }` and `mod after;` | 2 | 2/2 |
| `include!(p!())` (a macro returns the literal) and `include!(concat!("aux/", "r.rs"))` | 2 | 2/2 |
| `macro_rules! m { ($p:literal, $n:ident) => { #[path = $p] mod $n; } }` | 1 | 1/1 |

These match rustc's resolution rules (rustc_expand `module.rs`, `source_util.rs` `expand_include`,
`Session::resolve_path`):
- `#[path]` resolves against `dir_path` without `relative`.
- Children of `x.rs` go under `x/`.
- An inline module with `#[path]` takes that path as its directory.
- `include!` resolves against the call-site file's directory, and the included file's directory becomes the module
  directory.

**Key transitions.** These are in the same script, through the real `cachePath`.
- Root `mod x;`, with `x.rs` = `mod outer { mod c; }`. The steps are: missing; `x/outer/c/mod.rs` appears; it changes;
  `x/outer/c.rs` also appears. That gives 4 distinct keys.
- Removing `x/outer` returns the first key.
- The lane's own test covers the minisimd shape (missing, present, changed: 3 keys, and the original key back on
  removal).

## 2. Completeness

**Dep-info cross-check re-run** (scratch `/tmp/cd-review/scripts/depinfo.ts`, temp out dirs):
- Sample: the 170 `expanded` cases that have deps, plus 427 dep-less cases (every 50th).
- Command: the suite's oracle argv without `-Zunpretty`, plus `--emit=dep-info`.
- Result: 597 ran, 86 wrote no dep-info (errors), **77 read other files, 0 uncovered, 0 dep-less cases read another
  file**. This reproduces the handoff's 77/0.

**Dynamic forms in tests/ui.** I grepped every non-literal `include*!(..)` outside `auxiliary/`. There are 14 forms:
- `concat!` of literals and `a!()`/`mac2!()` returning literals. Both are covered by the literal pool.
- `env!("NON_EXISTENT")`, `env!()`, `line!()`, `invalid`, and a suffixed literal. All are errors that read no file.
- `env!("INVALID_UTF8_BIN")` (include-macros/invalid-utf8-binary-file.rs). Its `rustc-env` is not in the `expanded`
  case env, so `env!` fails there. In the compiletest-based suites the value is in `Case.env`, and env values are
  candidates.

**When a path cannot be determined statically.** The scan is conservative, and the remaining limits are documented
in the header and the handoff:
- every literal and `concat!` join, crossed with every reached directory;
- directory listings for `mod $x`;
- documented: proc macros, `${concat}`-named modules whose file already existed, inherited `env!`, `--extern`.

The error cases without dep-info rely on the same static rules. rustc reads files only through those rules, so this
is fine.

**Gaps I found that the header does not list** (all LOW; no protected case is affected at this checkout):
- **N1. `..` after a missing directory.**
  - The scan normalizes paths lexically (`resolve`), but rustc passes `dir_path.join(p)` to the OS.
  - `mod im { #[path = "../o.rs"] mod o; }` loads `o.rs` only if `im/` exists. Without it rustc fails with
    `couldn't find file 'im/../o.rs'` (verified).
  - The key does not change in either direction, because `im/` is never probed and `im/o.rs` is `-` in both states.
  - In tests/ui, `proc-macro/modules-in-input.rs` (`mod outer { #[path = "../module.rs"] .. }`) has this shape. Its
    `outer/` exists, and sparse changes are per top-level directory, so the risk today is nil.
  - Fix: probe each intermediate directory before a `..`, or stat the unnormalized joined string.
- **N2. Renamed include macros.**
  - `use std::include_str as s; s!("data.txt")` gives `caseDeps = []`, but rustc reads `data.txt` (verified with
    dep-info).
  - Only `include*!`, optionally path-qualified, is recognized.
  - Grep: no `include* as` imports in tests/ui.
  - Fix: either document it, or treat any `include`/`include_str`/`include_bytes` ident not followed by `!` as
    `dynLit`.
- **N3. Read errors are recorded as missing.**
  - `probe` maps every `statSync`/`readFileSync` error to `-`: ELOOP, EACCES, and a file over 2 GiB
    (`ERR_FS_FILE_TOO_LARGE`), as well as ENOENT.
  - rustc reports these differently from "not found", so missing <-> unreadable transitions keep the same key. A
    file too large to hash is also silently treated as missing.
  - This can't happen in the checkout today.
  - Fix: use `-` only for ENOENT/ENOTDIR, record `err:<code>` otherwise, or throw.

**`readsOnlyCaseFile` on the 9 suites (OK).** I read each probe's `main.rs`.
- **lex** (`lexdump`) and **escape** / **escape-synthetic** (`escapes`): `std::fs::read` of each argv path only.
- **symbols** (`symdump`): argv are section names. `file: ""`, so `depsOf` already returns `[]`. Its build.rs reads
  are build-time, and the binary hash is in `oracleVersion`.
- **fluent-parse** / **fluent-format** (`fluentdump`): reads argv files only.
- **emit** (`emitdump`): reads the argv JSON. Sources come inline (`SourceMap::new_source_file(name, src)`), so the
  emitter never loads files.
- **tokens** / **tokens-str** (`tokdump`):
  - It reads the argv files and lexes with `new_parser_from_source_str` or the token-tree lexer.
  - There is no module loading or expansion.
  - It has a `RealFileLoader`, but nothing calls it on a path.

None of these tools can be made to read another file by a case's content.

## 3. No protected effect (OK)

- **Baselines unchanged** (see above).
- **Keys unchanged for cases with nothing to probe.**
  - Scratch `keys.ts` takes about 400 evenly spaced cases per suite. It is read-only on the shared cache:
    `existsSync` only, and `ensureDir` only touches existing prefix dirs.
  - Dep-less cases: new key == old key, and the entry exists in the shared cache. Counts: expanded 403/403, parse
    405/405, tokens 403/403, resdump-nocore 403/403, parse-ui 488/488.
  - Full counts of cases with deps: expanded 170, parse 165, parse-ui 15, resdump-nocore 170, tokens 0. These match the
    handoff's per-suite figures.
  - `cachePath` is the only key computation in `scripts/` and `harness/`, and `depsOf` is applied at its only call site.
- **The 1,215 changed keys are safe.**
  - In `runOracle`, a key whose file does not exist goes to `todo`. Batch and single modes both run `s.oracle(..)` and
    then `writeCached` the fresh output.
  - No path copies or derives an entry from another key. Old entries are left as orphans, which is harmless.
  - If a worktree flips back to a previous filesystem state, it reuses the entry that was written for exactly that
    state.
- **Throws are loud.** `MAX_SCANS` throws an `ERROR:` exception out of `runOracle`. An unreadable root throws in
  `readFileSync`, as `fileHash` already did.

## 4. Robustness (OK, with N3)

I built a tree whose root has `#[path]` to a binary or non-UTF-8 file, a symlink loop, a dangling symlink and
`/dev/zero`. It also has `mod big;`, a 50 MB file with an unterminated block comment, and `include_bytes!` of a
directory. Result:
- No throw, and it finished in 0.9 s.
- States: binary and non-UTF-8 -> sha1 (the scan is lossy, the hash is of the bytes); `/dev/zero` -> `other`, not
  read; directory -> `dir`; loop and dangling symlink -> `-`.
- The dangling symlink is right: rustc sees it as missing too. The loop is N3.
- The lexer always advances, so I found no infinite-loop path. Unterminated literals and comments run to the end of
  the file.

## 5. Spot-check

- `RUST_TS_AGENT=reviewer-cd bun scripts/difftest.ts --suite expanded --filter tests/ui/simd`: **75/75 MATCH**, 0 DIFF
  (run `20261014-031226-reviewer-cd-b6tb`).
- `bun test scripts`: 12 pass.

## What root should do

- Merge as is, before the plan-m3 D11 `tests/auxiliary` sparse change. Then run the full gate as the handoff says.
- N1 to N3 can go to a follow-up scripts batch (fix or document). None of them blocks this merge.
