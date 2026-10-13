ACCEPT

# Review: harness-w6 fix round (461e5ec on `lane/harness-w6`)

Reviewer: review-hw6b (independent, read-only).
- Scope: the fix commits a1c8625, ddc89da and 461e5ec, isolated with `git diff 31ff114 461e5ec`.
  - Files: `harness/suites.ts`, `src/rust_ts/tokdump.ts`, `tools/probes/tokdump/{main.rs,Cargo.toml.in}`,
    `scripts/{difftest,gate,probes}.ts` and the handoff.
  - The first review is `docs/reviews/harness-w6.md`.
- Since the review base, main has moved to 348644a (driver-session). That move touches none of `harness/suites.ts`,
  `scripts/`, `tools/probes` or `src/rust_ts/tokdump.ts`; only `harness/scope.json` changed.
- `git merge-tree main lane/harness-w6` is still clean.
- The lane typechecks: `bunx tsc --noEmit -p .` exits 0.

Summary:
- H1, H2, H3, H4 and H7 are fixed, and each fix was verified empirically.
- H5 is fixed as asked. One residual of the same kind remains (J1, LOW, does not block).
- No protected case, case list, cache entry or baseline is affected.

## Findings

### J1 (LOW, residual of H5): the rustc-dev manifest check is a denylist, and flags can still reach rustc
- Where: `scripts/probes.ts:59-61` and `:97-100`.
- On scratch manifests in a scratch copy of the lane, `probeMeta` correctly rejects:
  - `[build_dependencies]` and `[dev_dependencies]`, both at edition 2021;
  - `[target.'cfg(unix)'.build_dependencies]`;
  - `env` setting `RUSTC_WRAPPER`, `RUSTC` + `CARGO_TARGET_DIR`, or `CARGO_BUILD_RUSTFLAGS`.
- It accepts the following:
  - **`cargo-features = ["profile-rustflags"]` with `[profile.release] rustflags = ["-C", "bogus-xyz"]`.**
    - The build then fails with `unknown codegen option: bogus-xyz`, so the flags reach rustc.
    - Profile rustflags are applied on top of `CARGO_ENCODED_RUSTFLAGS`.
  - **A `build = "build.rs"` script**, which can emit `cargo::rustc-link-arg`, `rustc-link-search`, `rustc-cfg` and
    so on.
  - **`env` setting `CARGO_TARGET_<TRIPLE>_LINKER`, `CARGO_HOME` or `CARGO_PROFILE_RELEASE_RUSTFLAGS`.**
- Not a hole:
  - `CARGO_TARGET_<TRIPLE>_RUSTFLAGS`, whether in the outer environment or in `env`, is overridden by
    `CARGO_ENCODED_RUSTFLAGS` on unix. Verified: an outer `-C bogus-xyz` builds fine.
  - `RUSTC_BOOTSTRAP` in `env` is overwritten by `rustcDevEnv`, which is spread last.
- Impact:
  - Any of these needs a reviewed in-repo manifest.
  - They can only change how the probe's own glue is compiled or linked, not the sysroot's `librustc_driver`.
  - That is why this is LOW.
- Suggested follow-up: invert the check, since the only rustc-dev probe needs none of these things.
  - A rustc-dev probe's `env` must be empty, or allowlisted.
  - Its manifest may have no `build`, `cargo-features`, `[profile]`, `[patch]` or `[replace]`.
  - On Windows, env names are case-insensitive, so a lowercase `rustflags` would also slip past today's list.
    Windows is out of scope per the 2026-10-12 decision.

### J2 (INFO): `tokens-str` is selected by path, not by content
- The filter is `corpus("tests/ui").filter(f => f.includes("frontmatter"))`.
- At the pin it covers every file where the two entry points differ (verified below).
- After a pin bump, a frontmatter test whose path lacks "frontmatter" would lose only the `Shebang`-route check. Its
  crate-root lexing stays in `tokens`.
- A content test would make the selection self-maintaining: an optional shebang, then whitespace, then `---`.

### J3 (INFO): leftovers of the atomic cache write
- **Orphaned temp files.** A process killed between `writeFileSync(tmp)` and `renameSync` leaves a
  `<key>.tmp-<pid>-<rand>` file. Nothing ever reads one, because no script enumerates `oracle-cache`, but nothing
  cleans them up either. There are 0 in the shared cache today.
- **Windows.** `renameSync` over an entry that another process holds open can fail with EPERM. That would surface
  as an uncaught exception, which is loud, not wrong.

## What I checked

### H1: crate-root lexing in `tokens`, and the `tokens-str` sibling
- **Faithfulness of the crate route.**
  - Upstream `new_parser_from_source_str` (`rustc_parse/src/lib.rs:94`) calls `new_source_file`, then
    `new_parser_from_source_file` (`:226`).
  - `new_parser_from_source_file` calls `source_file_to_stream(.., None, strip)?`, then `Parser::new`.
    - `Parser::new` only bumps.
    - The only other step is an Eof span fix-up, which is not printed.
  - `parse_tokens` (`parser/mod.rs:1441`) rebuilds the stream from the cursor.
  - So the probe prints exactly `lex_token_trees(.., ShebangAndFrontmatter)`, which is what the subject calls.
  - The `Err` path is the same `?` in both routes.
- **Faithfulness of the str route.** `source_str_to_stream` (`:243`) uses `StripTokens::Shebang`. The subject uses
  `"Shebang"`.
- **Defaults agree.** Both sides default to crate mode when no `--strip=` is given. Both suites pass `--strip=`
  explicitly, so it is part of `Case.args` and therefore of the cache key.
- **Both modes over the whole corpus.** I ran the shared tokdump binary in both modes over all 25,780 `tokens`
  files, with each file's edition, hashing each file's section in memory.
  - 34 files differ, and all 34 are `tokens-str` cases: the 32 under `tests/ui/frontmatter/`, plus
    `feature-gates/feature-gate-frontmatter.rs` and `unpretty/frontmatter.rs`.
  - The other 25,746 files are identical across the Parser route and the direct route. That re-confirms
    `parse_tokens` is lossless, now including the crate route.
  - `gated frontmatter` lines: 34 in crate mode, 0 in str mode.
  - The 5 `tokens-str` cases that do not differ are frontmatter-directory files without frontmatter, such as
    `auxiliary/makro.rs` and the `location-*` files.
  - This reproduces the handoff's numbers.
  - Implication: the subject matches the oracle in crate mode, and the crate output differs from the str output on
    those 34 files, so the subject really runs the frontmatter path. That includes `validate_frontmatter` and the
    feature gate.
  - A `Shebang` mutant would therefore DIFF on exactly 34 files, as the handoff reports.
- **Case lists.**
  - `tokens` still has 25,780 cases. Its `[id, file]` list hashes to 0a91b576f8c99c4c, the same as `lex` and as at
    ce13627: the same `corpus(...)` call.
  - Only the args changed: `--strip=crate` was added. The full-case hash moves from 1dd42ee15a061226 to
    ecb7ce76882d03ee, which is expected.
  - `tokens` is not protected yet.
- **No hiding overlap.**
  - `tokens` keeps all 25,780 files, the 39 included.
  - `tokens-str` (39 cases) is a separate suite. Its suite name is in the cache key, its baseline would be its own
    file, and `suite()` looks names up exactly.
- **Split.** The split is principled: crate mode is what rustc does to every file it reads; str mode is the
  proc-macro `from_str` route and is distinct only where frontmatter exists. See J2 for the path filter.

### H2: `CI=true`
- Bun 1.4.3 with `CI=true` exits 1 on `test.only` ("`.only` is disabled in CI environments").
  - Without `CI`, it passes and silently drops the sibling test.
  - `describe.only` is rejected the same way.
- `run()` merges `{...process.env, ...opts.env}`, and the step's exit code is checked.
- The lane has no `.only`, no snapshots and no reads of `CI` in `src` or `tools`, so `CI=true` changes nothing else.

### H3: describe path, each entry used once
- I generated a real junit report (`CI=true bun test src tools --reporter=junit`) from a scratch tree whose
  `src/rustc_span/source_map/tests.test.ts` has:
  - two top-level `test.skip("read_binary_file_handles_lying_stat")`;
  - the same name nested in `describe("inner")`;
  - a `test.todo` in `describe("deep \"q\" <x> & />")`;
  - a `describe.skip`;
  - a `skipIf(true)`.
- It also has `tools/b.test.ts` with the same skipped name, and a failing test whose message contains a fake
  `<testcase ...><skipped/></testcase>`.
- Result:
  - Exactly 1 skip is allowed: the first top-level one.
  - 6 are unexpected, with correct paths, including the unescaped describe name.
  - The fake XML in the failure message is escaped and ignored. The 7 skips found equal the report's `skipped=7`.
- Text a test writes to stdout does not reach the report.
- The real allowlisted test is a top-level `test.skipIf` (`tests.test.ts:651`), which matches `path: [name]`.

### H4: atomic cache write, and unreadable entries
- **Can a temp file be read as an entry?** No.
  - The temp file is `<key>.tmp-<pid>-<rand>` in the same directory, and `renameSync` is atomic on POSIX.
  - `cachePath` only ever names a bare hex key.
  - No script enumerates `oracle-cache`.
- **Recovery.** I used a scratch `RUST_TS_DATA` (upstream and target symlinked, fresh cache) and filled 17 entries
  (9 gzip, 8 JSON) with `tokens --filter library/alloc/src/vec/`. Then I corrupted 6 of them:
  - gzip truncated;
  - gzip bit-flipped;
  - empty file;
  - JSON truncated;
  - `null`;
  - `{"text":1,"code":0}`.
- The next run:
  - printed 6 `ERROR:` lines, each with a specific reason;
  - re-ran the oracle;
  - scored 17/17 MATCH.
- The run after that had 0 ERRORs, and all 17 entries were valid. Unreadable entries are never accepted: they become
  misses.
- **Concurrency.** I ran 3 difftest processes (agents x1, x2 and x3) at once on the same fresh cache with
  `--filter library/alloc/src/`.
  - All three scored 96/96 MATCH.
  - 96 entries, all valid; 0 temp files.
  - Same-key writers write identical oracle output, and the last rename wins.
  - The remaining race: a reader that removes a torn legacy entry just after another process renamed a fresh one in.
    That costs one extra oracle run and cannot produce a wrong result.
- **Kills.** I sent SIGKILL to the runner plus tokdump at 6 points (0.4–2.0 s) during runs filling 292 entries.
  - 292 valid entries, 0 bad, 0 temp files.
- In a gate run, a recovery `ERROR:` line does not fail the gate. The result comes from a fresh oracle run, which is
  correct.

### H5 and H7: aliases, env denylist, encoded rpath
- I built tokdump in a scratch `RUST_TS_DATA` from a scratch copy of the lane, with an outer
  `RUSTFLAGS="-C bogus-flag-xyz"`.
  - The build succeeded, so `CARGO_ENCODED_RUSTFLAGS` overrides the outer flags.
  - `LC_RPATH` is `<sysroot>/lib`, and the binary links `@rpath/librustc_driver-3bee00c5d9e363a9.dylib` and
    `libLLVM.dylib`.
  - Its output equals the shared binary's on 33 frontmatter files plus `vec/mod.rs`, in both modes.
  - The binaries differ only in embedded source paths: the scratch path appears in the strings.
- `probeMeta` succeeds for all 12 probes. Only tokdump is `rustc_dev`, and the env and lockfile of the other 11 are
  unchanged. Their build env never receives `rustcDevEnv`, so their builds are unaffected.
- See J1 for the alias and env results.

### Deleted `tokens` cache entries, and nothing else changed
- I recomputed every cache key with the lane's key function (same as main for non-rustc-dev suites):

  | suite | cached | missing |
  |---|---|---|
  | lex | 25780 | 0 |
  | escape | 25780 | 0 |
  | symbols | 10 | 0 |
  | escape-synthetic | 11 | 0 |
  | fluent-parse | 4210 | 0 |
  | fluent-format | 4210 | 0 |
  | emit | 1466 | 0 |
  | tokens (new keys) | 25780 | 0 |
  | tokens-str | 39 | 0 |

  - So the 25,780 deleted entries were only the old-binary `tokens` keys.
  - The shared cache holds 103,097 entries and 0 temp files.
- `sha256(JSON.stringify(cases()))[:16]` for lex, parse, escape, symbols, escape-synthetic, fluent-parse,
  fluent-format and emit is identical on main and on the lane. The values are the same as the first review's table.
- `git diff 31ff114 461e5ec -- harness/baseline docs/state` is empty, and `git diff main...lane/harness-w6` touches
  neither path.

### Spot runs (lane worktree, `RUST_TS_AGENT=review-hw6b`)

| run | result |
|---|---|
| `--suite tokens --sample 300` | MATCH=300 |
| `--suite tokens-str` (full) | MATCH=39/39 |
| `--suite tokens --filter frontmatter` (crate mode) | MATCH=39/39 |

## For root
- Merge.
- Then rebuild tokdump from main (`bun scripts/probes.ts build tokdump`).
  - `$RUST_TS_DATA/probes/tokdump/Cargo.toml` still points at `.data/lanes/harness-w6/…` (the F3 pattern).
- Main gained driver-session (`src/` load-order and lib.ts changes) after this lane last merged main. Re-run `tokens`
  and `tokens-str` on the merge before gating and accepting them.
- Queue J1 (invert the rustc-dev manifest check to an allowlist) with the next `scripts/` batch.
- J2 and J3 are optional.
