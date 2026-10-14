# Handoff: cache-deps (oracle cache key covers every file a case reads; scripts batch, needs an independent review)

Branch `lane/cache-deps`, based on main 935a15a. Fixes review harness-w13 B1: the oracle cache key hashed only the
case file, so the 27 tests/ui/simd cases that `#[path]` to `tests/auxiliary/minisimd.rs` went stale silently when
the sparse checkout gained `tests/auxiliary`. No ported upstream code, so there are no coverage numbers, no
`// rustc:` markers, no `unported(...)` and no `// PORT:` decisions. Baselines, oracle outputs and the shared cache
and checkout are untouched. I did not run `upstream.ts fetch`.

## Files touched
- `scripts/lib/deps.ts` (new): `caseDeps(cwd, file, env)` returns every path the case may make rustc read or
  probe, with its state: `-` (missing), `dir`, `other` (not a regular file), the sha1 of the content, or
  `ls:<hash>` for a listed directory. It returns `[]` if there are none. The design is in the file header.
- `scripts/difftest.ts`:
  - New `depsOf(s, c)`.
  - `cachePath` appends `{ deps }` to the key parts only when the list is non-empty. Keys of cases without
    dependencies are byte-for-byte the old ones.
  - `cachePath` and `depsOf` are exported for the test and for measurement.
  - Nothing else changed. The compared command is unchanged.
- `harness/suites.ts`:
  - New optional `Suite.readsOnlyCaseFile`.
  - It is set on the 9 suites whose probe reads only its input files: lex, escape, escape-synthetic, symbols,
    fluent-parse, fluent-format, emit, tokens and tokens-str. I checked that each probe's runtime `main.rs` reads
    only its argv files.
  - Those suites skip the scan, so their keys never change.
  - The flag is the only harness change. The reviewer should cover it with this scripts batch.
- `scripts/lib/deps.test.ts` (new): 12 tests. They use a temp `RUST_TS_DATA`, so the shared cache is never
  touched.

## Options evaluated, choice
1. **Oracle dep-info (rejected as the key):**
   - dep-info lists only the files rustc actually read. A missing `#[path]` target is not in it, so it cannot
     see a file *appear*, which is exactly the B1 case.
   - It would also need a second oracle run per case, and its result would have to be stored next to the
     entry, because the key is needed before the oracle runs.
   - I used it instead as a soundness check of (2); see below.
2. **Conservative static scan (chosen):**
   - It follows what rustc resolves at the pin: out-of-line `mod N;` (`N.rs` / `N/mod.rs`, with and without
     `DirOwnership::relative`), `#[path]` on out-of-line and inline modules, inline-module nesting, the
     include macros and `debugger_visualizer` files (`Session::resolve_path`, relative to every reached
     file's directory).
   - An `include!`d file is resolved relative to its own directory (`expand_include`). A `mod` in a macro
     body is followed in every module of every reached file.
   - Dynamic forms are handled too: a non-literal `include!`/`#[path]` uses every literal and `concat!` join
     of the reached files plus the case env values; `mod $x` lists the directory.
   - Every path it probes, existing or not, is in the key. The parsing uses a small lexer, plus a raw-regex
     guard in case the lexer loses its place.
   - Cases with no reference keep their old key.
3. **Hash whole directories, or a fingerprint of the checkout state (rejected):**
   - It is simple, but any sparse or local change would invalidate every referencing case.
   - It is fragile around skip-worktree files that are present on disk anyway.
   - For the `cwd: REPO` suites it would track the rust-ts repo itself.

## Evidence
- **Soundness vs the oracle (scratch `$RUST_TS_DATA/tmp/cache-deps/depinfo.ts`):**
  - Method: for all 21,523 `expanded` cases, I ran rustc with the suite argv (no `-Zunpretty`) plus
    `--emit=dep-info` into a temp dir, then checked that every file dep-info lists besides the case file is
    among `caseDeps`' paths as an existing file.
  - First run: 3 uncovered paths. `include!`d-file module directory (issue-69838) and macro-body `mod $i;`
    invoked in another module (directory_ownership/macro-expanded-mod). Both are fixed and have tests.
  - Final run: **77 cases read other files, 0 uncovered.** The 1,945 cases with errors write no dep-info, so
    for them only the static rules apply.
- **minisimd:** all 27 referencing files get `tests/auxiliary/minisimd.rs` with state `-`. The unit test shows
  three distinct keys for missing, present and changed. Removing the file again gives the first key back, so
  worktrees that flip the sparse set switch between two valid keys.
- **Cache entries that keep their key (scratch `measure.ts`, existsSync only, shared cache read-only):**
  - Totals: 239,929 existing entries, **238,714 kept, 1,215 change (0.51%)**.
  - Per suite:
    - lex, escape, tokens, fluent-*, emit, symbols, escape-synthetic, tokens-str: 0 changed.
    - parse: 165 changed.
    - parse-ui and parse-ui-json: 15 each.
    - expanded, unpretty-expanded, resdump and their 3 nocore twins: 170 each.
  - The unprotected tydump-nocore has 170 cases with deps but no entries yet. The minicore suites have 0
    cases with deps.
  - Cost: the next gate recomputes those 1,215 oracle runs once, which is minutes.
  - The scan takes about 3 s per tests/ui suite run. The largest key has 301 paths
    (`attributes/path-inline-module.rs`).
- **Sample runs:**
  - `difftest --suite expanded --filter tests/ui/simd` (run `cache-deps-simd-expanded`): 75/75 MATCH.
  - `--suite expanded-nocore` (run `cache-deps-simd-expanded-nocore`): 75/75 MATCH.
  - Both used the current checkout. The 27 minisimd cases were recomputed by the oracle under their new keys,
    and new entries were written.
- **Checks:** `bunx tsc --noEmit -p .` is clean. `bun test scripts`: 12 pass.

## Limits (also in the header)
- Not covered:
  - paths produced by proc macros (cases get no proc-macro crates);
  - a module named by `${concat(..)}` whose file already existed (its appearance is still seen through the
    directory listing);
  - `env!` of a variable that is inherited rather than set in `Case.env`.
- `--extern <path>` arguments are not scanned. Today's only one, the mini_core rmeta, carries a content key in
  its path (`oracleAuxRmeta`).
- The dynamic-literal fallback grows as literals x directories. It is cheap on tests/ui (largest 301). On whole
  library crates it is large: library/core/src/lib.rs would give about 2.2M paths. That is why the lexing suites
  opt out. A future suite that compiles library crates should revisit this.

## For root
- Merge this before applying plan-m3 D11's `tests/auxiliary` sparse change.
- Then run the full gate. It recomputes the 1,215 entries now, and the referencing cases again after the
  sparse change.
- Accept only if no protected case is lost.
