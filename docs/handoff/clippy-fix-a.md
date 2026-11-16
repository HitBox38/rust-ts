# Handoff: clippy-fix-a (M8 wave 41; fixer lane)

Base: `1bed6c9a` (main; `git merge-base --is-ancestor 526cb6df HEAD` ok). Fixes the two rustc-side gaps
`clippy-contract-a` found (`git show 962d03eb:docs/handoff/clippy-contract-a.md`, "Changes needed outside this lane" 1 and 2).

## What changed

1. **`src/rustc_interface/interface.ts`: `Config.track_state` / `Config.register_lints` (interface.rs:345, :352) and their
   `Some` arms in `run_compiler` (interface.rs:480, :488).**
   - The fields are typed `((sess: Session) => void) | undefined` and `((sess: Session, lint_store: LintStore) => void) | undefined`
     (were `undefined`). Every existing `Config` literal sets them to `undefined`, so nothing else changes.
   - `run_compiler` calls `track_state(sess)` after `sess.check_config = ..` (and after the still-`None` `psess_created` arm),
     then builds the lint store with `new_lint_store` and calls `register_lints(sess, lint_store)` before
     `sess.lint_store = lint_store`, exactly in upstream's order.
   - **`track_state` and incremental:** upstream's `run_compiler` only calls the closure. Its effect on dependency tracking
     is what the closure writes to `sess.env_depinfo` / `sess.file_depinfo`, which `write_out_deps` (passes.rs, already
     ported in `src/rustc_interface/passes.ts`) prints into the dep-info file. Nothing on this path reaches unported
     incremental machinery, so there is no new `unported`.
   - `psess_created` is still typed `undefined` with its arm a comment (outside the lane's scope; no driver sets it).
   - With this, `src/clippy/driver.ts`'s `ConfigCallbacks` cast (clippy-contract-a's PORT note) can go when that branch is
     integrated: it can assign `config.track_state` / `config.register_lints` directly.
2. **`src/rustc_driver_impl/lib.ts` `describe_lints` (lib.rs:974): padding bug.** Upstream's second `let max_name_len` /
   `let padded` are new bindings, so `print_lints` (which runs again for `loaded`) keeps the lint-name width and only
   `print_lint_groups` uses the group-name width. The port reassigned one `let`, so `print_lints(loaded)` padded to the group
   width: wrong output when a tool group name is the widest, and `RangeError` (`" ".repeat(-n)`) when a tool lint name is wider
   than every group name (clippy's case). Fixed with `const`s and the shadowing second pair in a nested block that reaches the
   end of the function, as upstream's scope does (PORT comment in place).

## Tests

- `src/rustc_interface/interface.test.ts` (+3): `track_state` is called once, with the session that `f` then sees, after
  `check_config` is set and before the lint store exists, and before `register_lints`. What it writes to
  `env_depinfo`/`file_depinfo` is on the session. `register_lints` gets the session and the fresh store (builtin lints
  already in, nothing externally loaded). A fake tool lint `faketool::FAKE_LINT` and group `faketool::all` it registers are in
  `sess.lint_store` (`get_lints`, `find_lints`, `get_lint_groups`). Without the hooks there are no externally loaded lints.
  Both hook tests fail on the old interface.ts (checked by reverting it).
- `src/rustc_driver_impl/describe_lints.test.ts` (new, 3) runs the port's `rustc -W help` in a child process
  (`describe_lints_test/run.ts`, a test helper that sets `config.register_lints` to a fake tool registration from a JSON
  spec). A child process is needed because `safe_println` writes to the real stdout, which has no in-process capture.
  - Two **constructed** cases (no plain-rustc oracle shows tool lints). Their expected text is derived from upstream's format
    code: `{padded}  {:7.7}  {desc}` rows and two `\n`s after each table, with every table's column width checked.
    - A tool lint name wider than every lint and group name: the old code threw `RangeError`.
    - A tool group name wider than every lint name: the old code padded the loaded lints to the group width.
  - **Oracle case:** the pinned `clippy-driver -W help` (tool oracle, `toolOracleCmd("clippy", ..)`), **byte for byte**. The
    fake tool registers the lints and groups the oracle lists (835 lints, 10 groups: names, default levels, descriptions,
    members in order). The port does all sorting and padding itself. Here the lint width is 55 and the group width 42. It skips
    visibly if the tool oracle is not installed, and `RUST_TS_REQUIRE_PROBES=1` makes that a failure.
  - All 3 fail on the old lib.ts (checked by reverting it) and pass with the fix.
- `bun test src/rustc_interface src/rustc_driver_impl`: **216 pass, 0 fail** (10 files, no SKIP lines; about 208 s at load 18).

## Checks

- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: markers ok.
- **Coverage is unchanged** (no marker added or removed; the fixed fns already had theirs):
  - `compiler/rustc_interface/src/interface.rs`: 4/4 before and after.
  - `compiler/rustc_driver_impl/src/lib.rs`: 38/43 before and after.
- Sample difftests (`RUST_TS_AGENT=clippy-fix-a`, `--sample 200`):
  - `parse`: 200/200 MATCH (run `20261116-021524-clippy-fix-a-yxcp`).
  - `check-ui`: 200/200 MATCH (run `20261116-021628-clippy-fix-a-akyc`).
  - `target-specs`: 3 MATCH, 0 DIFF, 0 CRASH, 197 UNPORTED (run `20261116-021555-clippy-fix-a-mflm`).
    - `harness/suites.ts` has no `-W help` suite. `target-specs` (report only, `--print target-spec-json` through the real
      driver) is its only info-query suite.
    - All 197 UNPORTED are `rustc_target::spec::targets::<target>` (target specs not ported yet), unrelated to this lane.

## `unported(...)` left

None added.

## `// PORT:` decisions

- interface.ts: the `Config` PORT note now says only `psess_created`'s arm is unported.
- lib.ts `describe_lints`: the shadowing `const`s live in a nested block, because TS has no same-scope redeclaration.

## Files touched

- `src/rustc_interface/interface.ts`
- `src/rustc_interface/interface.test.ts`
- `src/rustc_driver_impl/lib.ts`
- `src/rustc_driver_impl/describe_lints.test.ts` (new)
- `src/rustc_driver_impl/describe_lints_test/run.ts` (new, a test helper)
- this file

## For root

- Integrating clippy-contract-a after this: drop `driver.ts`'s `ConfigCallbacks` cast. Its `lib.test.ts` note about the
  `describe_lints` bug becomes stale, and that test could switch to running `describe_lints` itself.
- Worktree setup note: this worktree had no `.env.local` or `node_modules`. I copied the main checkout's `.env.local`
  (gitignored) and ran `bun install --frozen-lockfile`.
