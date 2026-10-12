ACCEPT-WITH-FIXES

# Review: harness-fluent fix round (commit 7cb2a55)

Reviewer: review-hf2 (independent, read-only). This is a delta review of `lane/harness-fluent` at 7cb2a55 against the
first review (`docs/reviews/harness-fluent.md`, ACCEPT-WITH-FIXES at 8c218f3). The fix commit sits on top of the merge
573d90a ("Merge branch 'main'").

All five actionable findings of the first review are resolved, and four of them fully. The verbatim guard (old
finding 2) still has a smaller bypass of the same kind (finding 1 below). It is LOW, and the fix is a few lines in
`build.rs`. It does not block accepting `fluent-parse`, because it cannot change today's oracle output; it only weakens a
future guard. My recommendation is to fix it in the lane before merge, or as the first follow-up.

## What I checked

1. **Scope and no weakening.**
   - The merge 573d90a is clean: `git diff main 573d90a` (outside the corpus) is byte-identical to the old lane delta
     `git diff deab72c 8c218f3`.
   - `git diff --name-only main lane/harness-fluent` outside `harness/corpus/fluent/` lists only:
     - the handoff
     - `harness/corpus/gen-fluent.ts`
     - `harness/suites.ts` (description strings only)
     - `src/rust_ts/fluentdump.ts`
     - `tools/probes/fluentdump/{Cargo.toml.in,build.rs,main.rs}`
   - Nothing under `scripts/`, `harness/baseline/` or `src/vendor/` changed.
   - The existing suites have the same case-list hashes on main and on the lane (`sha256(JSON.stringify(cases()))[:16]`):
     lex `a8a356bd10b8a7b6`, parse `b244fb01ad2573be`, escape `a8a356bd10b8a7b6`, symbols `7b46e1e12e1f8d93`,
     escape-synthetic `6618a744d214bf09`. Their oracle and subject argv are identical too.
   - On the lane, `bunx tsc --noEmit -p .` passes and `bun scripts/coverage.ts --check` prints `markers ok (1950)`.
2. **Corpus rename only.**
   - The multiset of git blob ids under `harness/corpus/fluent` is identical at 8c218f3 and 7cb2a55: 4211 blobs (4210
     `.msgs` plus `.gitattributes`). So every file's full content (provenance and message) is unchanged; only the paths
     changed.
   - `git diff -M100% --diff-filter=ADM` shows no adds, deletes or modifications.
3. **Old finding 1 (MEDIUM, unpinned transitive crates): resolved.**
   - All 48 registry packages of the resolved probe `Cargo.lock` (`$RUST_TS_DATA/probes/fluentdump`, built from the lane)
     are in upstream's `Cargo.lock` with the same name, version, source and checksum.
   - Each of them has an `=` pin in `Cargo.toml.in`. `proc-macro-hack =0.5.20` matches `0.5.20+deprecated`.
   - I tested the guard in a scratch build (`$RUST_TS_DATA/tmp/review-hf2`, its own target dir, `--offline`), using a
     scratch "upstream" whose `compiler/` is a symlink to the pin and whose `Cargo.lock` is a copy:
     - Unmodified copy: the build passes.
     - One hex digit of tinystr's checksum changed in the upstream copy: the build fails with `tinystr 0.8.4
       (registry+…) is not in upstream's Cargo.lock with that version and checksum`.
     - intl_pluralrules changed to 7.0.3 in the upstream copy: the build fails with the same message for
       `intl_pluralrules 7.0.2`.
     - The probe's own lock deleted (fresh resolution): the build passes, so the lock exists before `build.rs` runs, and
       the regenerated lock is byte-identical to the committed resolution.
     - The probe-side checksum tampered: cargo itself refuses (`checksum ... changed between lock files`).
   - Pinning an older version (writeable 0.6.3, zerotrie 0.2.4, yoke 0.8.2, tinystr 0.8.3) cannot resolve at all
     (`failed to select a version`), so the pins are consistent with what the dependents require.
   - The new `default-features = false` on the transitive pins can only remove features that the probe alone used to
     add. It cannot add features.
4. **Old finding 3 (LOW-MEDIUM, `parse` vs `parse_runtime`): resolved.**
   - The probe (`main.rs:398-399`) prints `parse_runtime:\n{:#?}\n` and then `parse:\n{:#?}\n`, on the same
     `generated_msg = {msg}\n` source that `FluentResource::try_new` receives.
   - The subject (`fluentdump.ts:151`) emits the same labels and newlines. The old trailing `+ "\n"` was correctly
     dropped, because the template now ends in `\n`.
   - Probe and subject outputs in parse mode are byte-identical over all 87 synthetic cases (the error and comment
     paths): 87 `parse_runtime:` and 87 `parse:` sections, with 66 `Err(` results across the two.
   - The suite description and the wiring comment are updated.
5. **Old finding 2 (LOW, verbatim guard): mostly resolved, residual bypass in finding 1 below.**
   - Each of these scratch mutations of `main.rs` now fails the build:
     - Old repro: delete the BEGIN and END of `formatting.rs:39` and set `set_use_isolating(true)`. Fails with "not
       exactly the expected".
     - Delete only the BEGIN. Fails with "stray END".
     - Add an extra block. Fails with "not exactly the expected".
     - Edit inside a block. Fails with "differs from upstream".
6. **Old finding 4 (LOW, global panic hook): resolved.**
   - A malformed corpus file now gives exit 101 with `panicked at …main.rs:249:13: bad corpus line "junk"` on stderr, in
     both modes, and also when it follows a good file (so the hook is restored after the format rows).
   - Format mode over 40 synthetic files (95 panic rows) writes 0 bytes to stderr.
   - The scratch binary's format output equals the shared probe's.
7. **Old finding 5 (LOW, line-number ids): resolved.**
   - Over all 4210 files:
     - Each file name is exactly `sha256(message bytes)[:12].msgs`.
     - Each directory is the crate of the first provenance line (or `synthetic`).
     - There is one record per file.
     - There are 4210 distinct messages and 4210 distinct 12-hex prefixes, so there are no collisions. The synthetic
       messages don't duplicate each other or any upstream message.
   - `contentId` throws on a prefix collision inside a directory instead of overwriting.
   - Determinism: `bun harness/corpus/gen-fluent.ts` on a `git archive 7cb2a55` copy leaves `git status` empty (4210
     files, 87 synthetic, 4660 occurrences, 4123 unique).
8. **Old finding 6 (INFO)** is reflected in the `fluent-format` description. Old findings 7, 8 and 9 are correctly left
   to other batches.
9. **Sample runs** from the lane worktree (`RUST_TS_AGENT=review-hf2`):
   - `fluent-parse --sample 200`: MATCH=200, DIFF=0, UNPORTED=0, CRASH=0.
   - `fluent-format --sample 200`: UNPORTED=200, DIFF=0, CRASH=0. This is expected: the subject reaches
     `to_fluent_args`, which is unported.

## Findings

### 1. LOW: a verbatim block can still be shrunk (even to empty) without failing the guard (tools/probes/fluentdump/build.rs:9-18, 58)
The check compares the block against `up[start-1 .. start-1+block.len()]`, and `BLOCKS` fixes only the start line.
Moving `// END verbatim` upwards keeps the spec set identical and the shortened block is still a prefix of upstream.
Scratch repros, both of which built successfully:
- (a) Move `// END verbatim` of `formatting.rs:39` to just after the `FluentBundle::new(..)` line, then set
  `set_use_isolating(true)` below it.
- (b) Put `// END verbatim` directly after the BEGIN line, so the block is empty, then edit the function freely.

Scenario: as with the old finding 2, a later edit "fixes" a compile error in a copied function by moving the END
marker, and the oracle silently diverges from rustc.

Fix: record the extent in `BLOCKS`, e.g. `"compiler/rustc_errors/src/formatting.rs:39-59"`, and assert
`block.len() == end - start + 1`. The current extents (upstream lines) are:
- `rustc_error_messages/src/lib.rs`: 13-21, 231-298, 300-309, 311-321, 344-352
- `rustc_errors/src/formatting.rs`: 10-24, 39-59

At minimum, reject empty blocks and assert the 7 line counts (9, 68, 10, 11, 9, 15, 21).

### 2. INFO: what a repin will report for content ids (harness/corpus/gen-fluent.ts:213, 237)
Case ids are now stable under line and file churn, which is the intent. Two kinds of change still alter an id:
- the message text changes;
- the crate of its first occurrence changes, because the directory is that crate (e.g. the message moves crates, or
  an occurrence is added in a crate that sorts earlier).

`gate.ts` will report both as losses of the old id. For a text change that is arguably right: it is a different case.
For a crate move it is noise, but rare.

No change needed now. Mention it in the repin procedure when one is written. Optionally drop the crate directory
(a flat `<sha12>.msgs`) to remove the second cause.

### 3. INFO: the lock guard checks versions and checksums, not features (tools/probes/fluentdump/build.rs:83-98)
This is by design, and it is enough for "same code". The probe's feature set is still a separate, manual claim, made in
the first review for the direct dependencies. I did not re-derive the upstream workspace's unified features, because
`cargo tree` on the sparse checkout is not practical.

## Not checked
- The full `difftest` of either suite (root's job). The handoff reports 4210/4210 MATCH for `fluent-parse`; I saw
  200/200 on my sample, and 87/87 identical on the synthetic cases by direct comparison.
- Behaviour on Windows. The host is macOS.

Scratch (`$RUST_TS_DATA/tmp/review-hf2`) was deleted after the review.
