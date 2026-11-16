# Review: root-w66-check (integration branch `integ-w66`, and the re-check of the clippy-contract-a FAIL)

Reviewer: independent, read-only. Subject: `integ-w66` at `4b9e81cd` ("Merge main into integ-w66"); root's own commit on it is
`38238c9f`. I checked it out in my own worktree (branch `t3/review-root-w66-integration`, fast-forwarded from main `e1fca355`
to `4b9e81cd`), with `.env.local` copied and `node_modules` linked. Nothing was built and no suite or gate ran. `upstream.ts fetch`
was not run. The only oracle run was the pinned `clippy-driver` (through `RUST_TS_IMPL=shim`). The mutations were made with `perl`
in my worktree and reverted with `git checkout` after each run. Scratch files lived in the session scratchpad and were removed.

## Verdict: PASS WITH NOTES

- Root's commit is exactly the generator's output plus the removal of the contract declarations and their check.
- The merges are all automatic and bring in only the listed branches.
- F1 and F2 of the clippy-contract-a FAIL are fixed. N1, N4 and N5 are done.
- `tsc`, `coverage --check` and the requested tests pass.
- With `Conf.load` stubbed, the driver's `-W help` output equals the pinned clippy-driver's byte for byte.
- The notes are stale comments, one unused import, and one harness scan gap that should be recorded. None blocks the merge.

## Notes

**N1. Leftovers from removing `contract.d.ts`.** None of these affects behaviour.
- `src/clippy_lints/contract.test.ts:12` still imports `dirname`. Its only user was the removed test. `tsc` does not flag it,
  because `noUnusedLocals` is off.
- `src/clippy_lints/lib.test.ts:1–5` still says that `lib.gen.ts` and `clippy_config/lib.ts` are files "this branch cannot have"
  and that the tests skip until they exist. Both files exist now, and the tests run.

Either the next lane that owns these files drops them, or root does at the next integration.

**N2. `src/clippy/driver.ts` still casts through `ConfigCallbacks`. The cast and its comments are now stale.**
- The header (`:12–14`) and the `PORT` doc on `ConfigCallbacks` (`:106`) say that interface.ts types `track_state` and
  `register_lints` as `undefined` and ports only their `None` arms. clippy-fix-a changed both.
- `Config` (`src/rustc_interface/interface.ts:336`, `:343`) now types the two fields exactly as `ConfigCallbacks` does:
  `((sess: Session) => void) | undefined` and `((sess: Session, lint_store: LintStore) => void) | undefined`.
- `run_compiler` now calls them (`:481–493`): `track_state(sess)` after `parse_check_cfg`, then `register_lints(sess, lint_store)`
  on the new store, before `sess.lint_store` is set.

So the two lanes type-check together, and the writes through the cast land on the real fields. But `as unknown as` would hide any
later drift between the two types. The owner of `driver.ts` should assign `config.track_state` and `config.register_lints`
directly and drop `ConfigCallbacks` and its comments.

**N3. F2 is met as the review allowed, but the reads now sit behind a computed key that the env scan does not see.**
- `driver.test.ts` now sets variables only through `with_env(env, f)`.
- `with_env` reads each `var_os(k)` with a computed `k`, so `CLIPPY_CONF_DIR`, `SYSROOT`, `CLIPPY_ARGS` and
  `CARGO_PRIMARY_PACKAGE` are read there. Each is saved, set or removed before use, and restored afterwards, so no gate value can
  reach a result. They are harmless.
- `unnamedEnvReads` (`scripts/lib/unit-steps.test.ts`) flags only `<env>[expr]`, destructuring and aliasing. It does not flag
  `var_os(<expr>)`.

The original review already raised this as "the scan gap belongs in the next harness batch's brief". I found it in no recorded
decision and in no brief in `docs/next.md`. Root should record it so the next `scripts/` batch picks it up.

**N4. End to end, `clippy-driver -W help` still stops at `Conf::default`, as the original review's N3 expected.** On a one-line
`a.rs`, `bun src/clippy/driver.ts a.rs -W help` exits 70:
`rust-ts: unported: codegen-clippy-conf: <Conf as Default>::default (define_Conf!)`.

That stop itself shows `register_lints` is reached through `run_compiler`. For the full output, I wrote a scratch in-process
script that replaces `Conf.load` with one returning `{}` and calls `main()`. The result:
- it exits 0;
- `Conf.load` is called once;
- stdout has 1144 lines, 845 of them `clippy::` lines (the clippy section);
- stdout is byte-identical (`cmp`) to the pinned clippy-driver's `-W help` on the same file.

No clippy suite can run before codegen-clippy-conf lands. That matches the plan.

## Checks (evidence)

1. **Root commit `38238c9f`.**
   - `git show --stat` lists three files and nothing else:
     - `contract.d.ts`: −63;
     - `contract.test.ts`: +2/−39;
     - `lib.gen.ts`: +13139.
   - `bun tools/codegen/clippy.ts --check`: "up to date: 359 clippy_lints modules (835 lints, 365 lint passes); combined passes 51
     early + 316 late; …". It printed no `pending:` line. Its code (`tools/codegen/clippy.ts:1542–1560`) compares each output whose
     needed modules all exist byte for byte, so `lib.gen.ts` was compared and matches.
   - `bunx tsc --noEmit -p .` passes (exit 0, 10.7 s). No other ambient block names a clippy module: the only `declare module
     "…*"` blocks left are in `src/rustfmt/contract.gen.d.ts`. So every import of `../clippy_config/lib.ts`,
     `../../clippy_config/lib.ts` and `./lib.gen.ts` is checked against the real module.
   - In `contract.test.ts`, the diff removes only the `contract.d.ts` test with its `CONTRACT`/`BLOCKS` constants, and the header
     bullet about it. The file had 4 tests and now has 3. The other three are unchanged, along with the scanner helpers they use:
     - the upstream fns carrying stub or rustc markers;
     - each sub-pass exported with its `lint_vec`;
     - stub-marked methods stopping `unported`.

     All three pass.
2. **Re-check of the clippy-contract-a FAIL** (review `389b0366:docs/reviews/clippy-contract-a.md`).
   - **F1:** `src/clippy_config/lib.ts` has `export { ConfMetadata, display_ConfMetadata } from "./metadata.ts"` (b1 `9c92b100`).
     `src/clippy_lints/lib.ts:12` imports it, and `tsc` is clean with no contract file.
   - **F2:** `scripts/lib/unit-steps.test.ts` passes all 11 of its tests, including "every variable a test file reads by name is
     refused at the gate's start or named harmless here". The rest is in N3.
   - **N1:** `contract.test.ts` is marker-driven.
     - The 747 it pins is the upstream set at the pin, from a token scan of `lib.rs` and the impls. The port's markers are not
       counted.
     - The invariant is "every upstream fn carries a `// stub:` or a `// rustc:` marker, never both".
     - Only methods and constructors marked `// stub:` (and `#[derive(Default)]` stubs) must stop `Unported`.
     - The 603-method pin is gone.
   - **N5:** `driver.ts:230` uses `str_lines` (`src/std/str.ts`). `driver.test.ts:66` covers `"a\n--sysroot\r"`, and `:149`
     covers the `@argfile` case.
   - **N4:** `src/clippy_lints/lib.test.ts` gives 3 pass and 1 skip. The skip is only "explain: a configured lint against the oracle
     [SKIPPED until Conf::get_metadata is ported (codegen-clippy-conf)]". These three run with no `[SKIPPED` suffix in their names:
     - `register_lint_passes` (644 assertions);
     - `explain` against the oracle;
     - `explain` printing only the matching configuration.

     Mutations of `src/clippy_lints/lib.ts`, each reverted afterwards:

     | # | Mutation | Result |
     |---|---|---|
     | M4 | the two pre-expansion passes swapped (`MacroBraces` first) | caught: `register_lint_passes` fails |
     | M3 | `register_renamed` → `register_removed` | caught: `register_lint_passes` fails |
     | M9 | `explain` looks up `to_ascii_lowercase(name)` | caught: both running `explain` tests fail |
3. **Merges.**
   - `git diff main...integ-w66 --stat`: 414 files, +34529/−48. I put together the file lists of `git diff main...<tip>` for the
     eight listed tips and `38238c9f`'s own diff. Every file in the stat is in that union. The only file in the union but not in
     the stat is `contract.d.ts`, added by contract-a and deleted by `38238c9f`.
   - `git rev-list --no-merges main..HEAD --not <the eight tips>` gives only `38238c9f`.
   - The first-parent chain is nine merges plus `38238c9f`. Each merge's second parent is exactly the tip of a listed branch:
     - `t3/port-clippy-config-contract` `9c92b100`;
     - `t3/review-clippy-contract-b1` `377cbcb0`;
     - `t3/port-clippy-utils-contract` `daa6bb3c`;
     - `t3/review-clippy-contract-b2` `50e23751`;
     - `t3/port-clippy-contract-a` `b74cea3b`;
     - `t3/review-clippy-contract-a` `389b0366`;
     - `t3/clippy-fix-a` `485c858c`;
     - `t3/clippy-fix-review` `e7996eef`;
     - main `e1fca355`.
   - No hand resolutions: for all nine merges, `git merge-tree --write-tree <p1> <p2>` gives exactly the merge commit's tree.
4. **Cross-lane consistency:** see N2 (the types agree, and `run_compiler` calls both hooks) and N4 (the hook runs end to end, and
   the output matches the oracle). The `rustc_interface` and `rustc_driver_impl` tests in step 5 include clippy-fix-a's
   `track_state`/`register_lints` order tests and its `describe_lints` padding test.
5. **Tests.**
   - `bunx tsc --noEmit -p .`: clean.
   - `bun scripts/coverage.ts --check`: "markers ok (27630, …)".
   - With `RUST_TS_REQUIRE_PROBES=1 RUSTUP_AUTO_INSTALL=0`, I ran `bun test src/clippy src/clippy_lints src/clippy_config
     src/clippy_utils src/declare_clippy_lint src/rustc_interface src/rustc_driver_impl scripts/lib/unit-steps.test.ts`. Result:
     **269 pass, 1 skip, 0 fail**, 270 tests in 21 files, 255 s on a loaded host. The one skip is the `get_metadata` case above.
