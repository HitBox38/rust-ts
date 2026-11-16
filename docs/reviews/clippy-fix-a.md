# Review: fixer lane clippy-fix-a (independent reviewer, read-only)

Reviewed `t3/clippy-fix-a` at `7b34d4cf` (`git diff main...7b34d4cf`: interface.ts, lib.ts `describe_lints`, two test files,
one test helper, the handoff). Upstream is the checkout at the pin (`$RUST_TS_DATA/rust`). All runs used a detached scratch
worktree of `7b34d4cf` under `$RUST_TS_DATA/tmp/review-clippy-fix-a/`, which has since been removed. Host on AC power,
load 3–12.

**Verdict: PASS WITH NOTES.** Both fixes match upstream and nothing regresses. The notes are test gaps: the oracle case is
partly circular for ordering (N1), and one asserted ordering in the hook test is vacuous (N2). Neither blocks the merge.

## Fidelity

1. **`run_compiler` (interface.rs:470–490) matches upstream.**
   - Upstream order after `sess.check_config = parse_check_cfg(..)`: the `psess_created` arm, then
     `if let Some(track_state) = config.track_state { track_state(&sess) }`, then `new_lint_store(sess.enable_internal_lints())`,
     then `if let Some(register_lints) = config.register_lints.as_deref() { register_lints(&sess, &mut lint_store) }`, then
     `sess.lint_store = Some(Arc::new(lint_store))`, then `check_abi_required_features`. The port
     (`src/rustc_interface/interface.ts:477–496` at `7b34d4cf`) has the same statements in the same order.
   - The types match too. `track_state: ((sess: Session) => void) | undefined` is upstream's `Option<Box<dyn FnOnce(&Session)>>`.
     `register_lints: ((sess: Session, lint_store: LintStore) => void) | undefined` is `Option<Box<dyn Fn(&Session, &mut LintStore)>>`.
   - No markers were needed: `run_compiler` already had its marker, and `Config` is a struct, not a function. `--missing
     interface.rs` gives 4/4 ported.
   - `track_state` really is only a closure call upstream. Its effect reaches dependency tracking only through what the closure
     writes to `sess.env_depinfo` / `sess.file_depinfo`, which `write_out_deps` reads (`src/rustc_interface/passes.ts:833ff`,
     ported). Nothing incremental is on this path, so no `unported` is needed.
   - **Still missing in the region:** only the `psess_created` `Some` arm, which is a comment. That is acceptable: the field is
     typed `undefined`, so no caller can set it without a type error, and the `Config` PORT note now says so. No other
     statement of interface.rs:440–500 is absent.
   - Every existing `Config` literal (driver `lib.ts:237–239`, six test/oracle helpers) still sets both fields to `undefined`,
     and nothing outside the new tests assigns them.

2. **`describe_lints` (lib.rs:974) matches upstream.**
   - Upstream binds `max_name_len` / `padded` at :1011/:1013 and binds them again at :1038/:1048. The `print_lints` closure
     (:1021) captured the first pair, and `print_lints(loaded)` at :1090 still uses it.
   - The port now has `const`s for the first pair and a nested block for the rest of the function, holding the second pair as
     `const`s with the same names. The scopes match upstream's: the second pair reaches the end of the function, and
     `print_lints` (defined outside the block) keeps the outer pair.
   - The only other change is re-indentation. The `match (registered_lints, l, g)` arms and their order are unchanged.
   - The `// PORT:` note is accurate.
   - A plain rustc is unaffected: the port's `rustc -W help` (`bun src/rust_ts/main.ts -W help`) is **byte-identical** to the
     pinned `rustc +nightly-2026-10-11 -W help` (`cmp` clean, exit 0).

## Tests

3. **The constructed expectations are derived faithfully from upstream's format code.** I checked the test's
   `loaded_sections` against lib.rs:1019–1096:
   - Rows are `"    {padded}  {:7.7}  {desc}"` and `"    {padded}  {members}"`.
   - Names go through `name_lower().replace('_', "-")` for lints and `to_lowercase().replace('_', "-")` for groups.
   - Members are `LintId::to_string()`, which is `lint.name_lower()` (rustc_lint_defs lib.rs:609), followed by `replace`.
   - Levels are `Level::as_str` (lowercase).
   - `safe_println!("\n")` gives the two `\n` after each table, and each title line is followed by an empty line.
   - The test's sort mirrors `sort_lints` (level, then name) and `sort_lint_groups` (name).

4. **All three `describe_lints` tests fail on main's `lib.ts`, and both hook tests fail on main's `interface.ts`.** I checked
   by putting main's file into the scratch worktree: 0 pass / 3 fail and 3 pass / 2 fail respectively. Main's `lib.ts`
   throws on the oracle case (tool lint names up to 49 wide, group width 42).

5. **N1 (note): the clippy oracle case is a real check of padding and of builtin ordering, but it cannot see whether the
   *loaded* lints and groups are sorted.**
   - The fake tool registers lints and groups in the order the oracle prints them, which is already sorted. `LintStore`
     keeps registration order, so the port's output would be right even without the sort.
   - Mutations run against `7b34d4cf` (each reverted after):

     | Mutation in `describe_lints` | constructed 1 | constructed 2 | oracle |
     |---|---|---|---|
     | M1: `loaded` not sorted | fail | fail | **pass** |
     | M2: `loaded_groups` not sorted | **pass** | **pass** | **pass** |
     | M3: sort key name only (level ignored) | pass | pass | fail |
     | M4: lint padding off by one | fail | fail | fail |
     | M5: group width ignores loaded groups | pass | fail | pass |
     | M6: lint width ignores loaded lints | fail | fail | pass |

   - M2 survives every test.
   - M5 and M6 pass the oracle case for another reason: clippy's longest lint name (49) and group name (19) are shorter than
     the builtin ones (55 and 42). So in the oracle case the tool's names never set a width. The constructed cases cover that.
   - **Suggested fix (test only):** in the oracle case, register in reverse:
     `run_port({ lints: [...lints].reverse(), groups: [...groups].reverse() })`. I tried it: the fix still passes, and M1 and
     M2 then fail the oracle case. A third group in constructed case 1, out of order, would also catch M2.

6. **N2 (note): in the `track_state` hook test, "after check_config" is vacuous.**
   - `expect(sess.check_config).toBeDefined()` holds before `parse_check_cfg` too, because `build_session` sets
     `CheckCfg.default()` (`src/rustc_session/session.ts:1484`). Moving the `track_state` call above
     `sess.check_config = ..` (MI3) passes all five interface tests.
   - The ordering against the lint store is checked: MI1, `track_state` after `sess.lint_store = ..`, fails.
   - Calling `register_lints` after `sess.lint_store = lint_store` (MI2) also passes, but that cannot be observed in TS: it is
     the same object, and the order matters upstream only because of `Arc`.
   - A stronger check would compare `sess.check_config` with what `parse_check_cfg` produces, for example from a
     `crate_check_cfg` entry in the config. Low priority.

7. **Minor:** `describe_lints_test/run.ts` is test-helper code in a ported crate directory, not under `src/rust_ts/`
   (PORTING §2). `src/rustc_target/asm/asm_oracle/run.ts` already does the same, it has no marker, and `coverage --check`
   ignores it. No action needed.

## Regression

8. **Sample difftests at `7b34d4cf`, with `RUST_TS_AGENT=review-clippy-fix-a` and `--sample 200`:**

   | Suite | Result | Run |
   |---|---|---|
   | `check-ui` | 200/200 MATCH | `20261116-022420-review-clippy-fix-a-yhl9` |
   | `parse` | 200/200 MATCH, 3 skipped | `20261116-022456-review-clippy-fix-a-rleq` |
   | `borrowck-ui` | 200/200 MATCH (borrowck 115, nll 85), 1 skipped | `20261116-022528-review-clippy-fix-a-zzc0` and `-022537-…-om7s` (run twice by accident, same result) |

   `borrowck-ui` is the full-analysis UI suite I chose as the broad check of lint-store setup and late lints, since no suite
   targets lints alone. With both hooks `undefined` the new code is two skipped `if`s, so a plain compile does exactly what
   it did before. The byte-identical `-W help` in item 2 confirms it.

## Basics

9. **Checks pass.**
   - `bunx tsc --noEmit -p .` is clean (19 s).
   - `bun scripts/coverage.ts --check` reports markers ok. `--missing`: interface.rs 4/4; lib.rs unchanged (`install`,
     `config`, `process_rlink`, … are the same gaps as on main).
   - The tests read only `RUST_TS_REQUIRE_PROBES`, which `UNIT_ENV_HARMLESS` lists. The child gets `{ ...process.env }`, which
     is allowed. `bun test scripts/lib/unit-steps.test.ts`: 10 pass.
   - Time: `describe_lints.test.ts` takes 2.7 s with the oracle case running (`RUST_TS_REQUIRE_PROBES=1`, no SKIP), and
     `interface.test.ts` 0.6 s. That is about 3.3 s in total, within the 10 s limit.
