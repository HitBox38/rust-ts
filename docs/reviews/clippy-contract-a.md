# Review: clippy-contract-a (M8 wave 41, contract-first porting lane)

Reviewer: independent, read-only. Subject: branch `t3/port-clippy-contract-a` at `962d03eb` (`git diff main...962d03eb`: 374
files, +14173). The change covers:
- `src/clippy/driver.ts`, `src/declare_clippy_lint/lib.ts` and `src/clippy_lints/{lib,declared_lints,deprecated_lints}.ts`;
- the 359 skeleton modules;
- `contract.d.ts` and four test files.

Handoff: `docs/handoff/clippy-contract-a.md`. Scope: `docs/plan-m8.md` §2 (§2b–§2d), D4, D12, D13 and D14, plus root's decisions
"codegen-clippy-macros (D5)", "codegen-clippy-macros N4/N5" and "clippy-contract-a" (`docs/state/history.jsonl` lines 740 and 742).

Method:
- I made one detached scratch worktree of `962d03eb` under `$RUST_TS_DATA/tmp/review-clippy-contract-a/`, with `.env.local`
  copied and `node_modules` linked. It ran the checks, the integration simulation and the mutations. Each mutation was reverted
  with `git checkout` after its run.
- The upstream checkout is at the pin (`6f5da406b56c`).
- The skeleton checks used a scratch scanner. It strips comments, strings and chars, matches braces to find every `impl … for T`
  block, and compares upstream with the lane's `// stub:` markers.
- Nothing was built, `upstream.ts fetch` was not run, and the only oracle runs were the pinned `clippy-driver`.
- The scratch directory and worktree were removed afterwards.

## Verdict: FAIL (two must-fixes, F1 and F2, both small; everything else is approval quality)

The port itself is faithful:
- function order, names, logic and markers are right, and nothing is guessed;
- the 747 stub markers are exactly upstream's 604 `check_*` fns and 143 `new`s, with matching parameter names;
- the dual early/late dispatch is a sound realization of upstream's static dispatch, not a redesign.

Two things break as committed:
- **F1:** the contract with clippy-contract-b1 does not hold: one `tsc` error at integration.
- **F2:** the gate's unit step fails on this commit, because a test reads an environment variable that is not listed.

## Must fix

**F1. `contract.d.ts` promises an export that b1's `src/clippy_config/lib.ts` does not have: `display_ConfMetadata`.**

b1 (`4ea919ec`) `lib.ts` re-exports only these:
```ts
export { Conf, sanitize_explanation } from "./conf.ts";
export { ConfMetadata } from "./metadata.ts";
```
`display_ConfMetadata` is defined in `metadata.ts:45–51` but is not re-exported. Upstream needs no separate export (`pub use
metadata::ConfMetadata` carries the `Display` impl). In TS the function has to travel explicitly.

The integration simulation, on the scratch worktree:
1. extract b1's `src/clippy_config/` (`git archive 4ea919ec src/clippy_config`);
2. run `bun tools/codegen/clippy.ts`, which wrote `lib.gen.ts`;
3. delete `contract.d.ts`;
4. run `bunx tsc --noEmit -p .`.

It gives **exactly one error**:
`src/clippy_lints/lib.ts(12,58): error TS2305: Module '"../clippy_config/lib.ts"' has no exported member 'display_ConfMetadata'.`

Everything else in the contract type-checks against b1's real exports:
- `Conf.load(sess)`;
- `Conf.get_metadata()`, which stops `unported` until codegen-clippy-conf;
- `sanitize_explanation`;
- `ConfMetadata`'s fields.

b1's `Conf` is an interface with a companion const, not the class the block declares, but all 131 `import type { Conf }` uses and
`lib.ts`'s value uses work with it. The generated `lib.gen.ts` type-checks against the skeletons too.

Fix (recommended): b1 adds `display_ConfMetadata` to `lib.ts`'s `export { ConfMetadata } from "./metadata.ts"`. The `Display` impl
belongs with the type, as `pub use` gives it upstream. Alternatively, this lane imports it from `../clippy_config/metadata.ts`, but
`metadata` is a private module upstream. Either way, update `contract.d.ts`'s comment to match.

**F2. `scripts/lib/unit-steps.test.ts` fails on `962d03eb` (it passes on `main`).**

```
(fail) every variable a test file reads by name is refused at the gate's start or named harmless here
+   "CLIPPY_CONF_DIR (src/clippy/driver.test.ts)",
```
The read is `src/clippy/driver.test.ts:201`, `var_os("CLIPPY_CONF_DIR")`. It saves the value, sets or removes it before
`track_state` runs, and restores it afterwards, so no value from the gate's environment can make a case pass. Even so, the gate's
unit step fails as committed. The brief's check ("the tests read only environment variables listed in `unit-steps.test.ts`") is
not met.

Fix:
- either root adds `CLIPPY_CONF_DIR` to `UNIT_ENV_HARMLESS` with that reason (a `scripts/` change, so its own reviewed batch,
  AGENTS.md §2);
- or the test is restructured so it does not read the variable by name.

Related, not a failure: `run()` (`driver.test.ts:98`) reads `SYSROOT`, `CLIPPY_ARGS` and `CARGO_PRIMARY_PACKAGE` through `var_os(k)`
with a computed key. `envReads` does not name these reads, and `unnamedEnvReads` does not flag them (it covers only
`<env>[expr]`). They are harmless here, because each key is set or removed before `main` runs. The scan gap belongs in the next
harness batch's brief.

## Notes

**N1. The contract test cannot survive the fill lanes.** `contract.test.ts` does this:
- it calls every `T.prototype.x = function` assignment in a module, and every `new`/`default`, and expects `Unported` (`:72`,
  `:88`, `:92`);
- it pins `747` markers (`:46`) and `603` methods (`:105`).

It selects by assignment, not by the `// stub:` marker. So the first fill lane that ports any `check_*` or constructor breaks the
test. A ported body called with no arguments throws `TypeError`, not `Unported`. Every parallel fill lane would then have to edit
this one shared file.

Make the test marker-driven:
- only a method or constructor whose body carries `// stub:` must stop `Unported`;
- the invariant becomes "stub markers plus `// rustc:` markers over these upstream fns = 747", which holds throughout the fill.

Root should settle this before the fill lanes start.

**N2. Out-of-file gap 1 is confirmed, and it can produce false passes; the order matters.**
- Upstream `interface.rs:480–490` calls `track_state(&sess)` and `register_lints(&sess, &mut lint_store)` when they are `Some`.
- The port's `run_compiler` (`src/rustc_interface/interface.ts:478–484`) ports only the `None` arms, and `Config` types both fields
  `undefined`.
- `driver.ts:110` (`config_callbacks`) casts past those types. So the `Some` path is now reachable and silently skipped: the
  opposite of PORTING §3's "unported paths call `unported`".

With that, `clippy-driver` on a crate runs as plain rustc. Any clippy UI test whose expected output has no clippy diagnostics would
then pass **falsely** and could enter the protected set. Root's decision sends the fix to clippy-fix-a. It must land before
harness-m8d adds any clippy suite. Failing that, interface.ts should stop `unported` when either field is set.

**N3. Out-of-file gap 2 is confirmed.**
- Upstream `describe_lints` (`rustc_driver_impl/src/lib.rs:974`) binds `let max_name_len` / `let padded` at :1011/:1013 and binds
  them again at :1038/:1048. Those are new bindings, so the `print_lints` closure (:1021) keeps the lint-width pair.
- The port (`src/rustc_driver_impl/lib.ts:1025–1026`, reassigned at `:1046` and `:1048`) reassigns both. The `padded` closure also
  reads `max_name_len` by reference. So `print_lints(loaded)` pads to the group width, and `" ".repeat(negative)` throws once a
  tool has registered lints.

It is invisible with plain rustc, which never prints `loaded`. The lane's fix (two new `const`s used only by `print_lint_groups`) is
right. Both values need new names, not only `padded`.

One caveat for the handoff's suggested post-integration check: `clippy-driver -W help` end to end stops at `Conf.load` →
`Conf.default()`, which is `unported` in b1 until codegen-clippy-conf. That check waits for that batch too.

**N4. Test gaps.** I ran nine mutations against the lane's four test files, plus `tsc`.

| # | Mutation | Caught by |
|---|---|---|
| M1 | `Perf` lints left out of `clippy::all` (`insert`) | registration-listing test ✔ |
| M5 | `format_args` / `attrs` swapped into `CombinedEarlyLintPass.new` | `tsc` (TS2345) ✔ |
| M6 | `mir_enable_passes` order swapped | `ClippyCallbacks::config` test ✔ |
| M7 | first two `RENAMED` entries swapped | deprecated_lints test ✔ |
| M8 | a stub marker line off by one | stub-marker test ✔ |
| M3 | `register_renamed` → `register_removed` in `register_lint_passes` | **nothing** |
| M4 | the two pre-expansion passes swapped | **nothing** |
| M9 | `explain` looks up the lowercase name | **nothing** |
| M2 | `clippy::cargo` / `clippy::complexity` `register_group` order swapped | **nothing** (`-W help` sorts groups) |

`register_lint_passes` and `explain` are never executed by any test, because both import `clippy_config`, which does not exist on
this branch. That is unavoidable now, but these tests must come in at integration:
- a test that runs `register_lint_passes` into a capturing `LintStore` (with a stub `Conf`). It checks:
  - the renamed and removed calls against `deprecated_lints`, in order;
  - the two pre-expansion factories in order (`EarlyAttributes`, then `MacroBraces`);
  - the early factory, then the late one;
  - the late factory's `is_active` selection (the lane's proposed `skippable_lints` test).
- `explain`, compared with the oracle once `Conf.get_metadata` exists (codegen-clippy-conf).

M2 is not observable in `-W help`. It is low priority.

**N5. `driver.ts` `lines` (`:393`) diverges from `str::lines` on a final line that ends in a bare `\r`.**
- Upstream's `LinesMap` (`library/core/src/str/mod.rs:3307–3310`) strips `\r` only after stripping a `\n`.
- The port strips any trailing `\r`: `lines("a\n--sysroot\r")` gives `["a","--sysroot"]`, while std (and `src/std/str.ts`
  `str_lines`) gives `["a","--sysroot\r"]`.

Effect: an `@argfile` whose last line is `--sysroot\r` with no newline counts as `--sysroot` here but not upstream. Upstream then
appends `SYSROOT`'s `--sysroot`; the port does not.

Fix: use `str_lines` from `src/std/str.ts` instead of a local helper, and add that case to the `lines` test.

**N6. The dual early/late passes (`Documentation`, `LargeIncludeFile`, `UnusedUnit`) are faithful, not a redesign.** How upstream
dispatches:
- Clippy's combined macros call each field fully qualified: `rustc_lint::EarlyLintPass::$name(&mut $self.$field, …)`
  (`combined_early_pass.rs`, `run_combined_early_lint_pass_field`). Its doc comment says this is exactly because some passes
  implement both traits with like-named methods. The late macro does the same. So the trait is picked statically by the caller.

How the port reproduces it:
- The generated combined passes call `EarlyLintPass_provided.check_x(this.F, cx, a)` or the `LateLintPass_provided` equivalent.
  That reaches the one prototype method, which picks the side by `cx instanceof LateContext`.
- The early runner always passes an `EarlyContext`. The late runner builds `new LateContext(…)` (`rustc_lint/late.ts:425`, `:490`).
  The two classes are unrelated (`context.ts:573`, `:1013`).
- Every provided default of both traits is empty.

So every real caller is routed as upstream routes it. Only a non-context argument could misroute, and only the test passes one
(`{}`). The upstream scan finds 52 early and 316 late impl types, and their intersection is exactly these three: nothing is
missed.

A minor point for the fill lanes: the dual interfaces extend only `LintPass`, with `...args: unknown[]`, so they lose the
parameter types. The fill lanes should type them.

**N7. `deprecated_lints.rs`'s hand-expanded `declare_with_version!`** is already covered by root's decision (it moves into
codegen-clippy-conf). The test checks every entry, version and the order against the pinned source (M7 caught).

## Checks that pass (evidence)

1. **Fidelity, read side by side in full.**
   - **`driver.rs` → `driver.ts`:** order (`arg_value`, `is_arg`, the two tests, `track_clippy_args`, `track_files`, the three
     `Callbacks`, `display_help`, `BUG_REPORT_URL`, `main` with its nested `has_sysroot_arg`, `help_message`) and logic match:
     - `splitn(2,'=')` / `or_else(args.next())`;
     - the lazy `filter_map` setting `no_deps` before `relevant_package`;
     - `info_query` on `args`, not on `orig_args`;
     - `Path::file_stem`'s `rsplit_file_at_dot`;
     - `catch_with_exit_code::<ExitCode>`.

     Markers :33, :50, :86, :94, :125, :140, :186, :196, :210 and :316 are right. Against the pinned `clippy-driver`, `--help`,
     `-h x.rs` and `--rustc --version` are byte-equal (stdout, stderr and exit code). A lone binary name (no other argument) also
     matches, once the harness's added `--sysroot=` is given to both.
   - **`declare_clippy_lint`:** `insert`, `register` (the group names, deprecated names and order), `LintCategory::name` and
     `name_lower` match; markers :23, :47, :87 and :115 are right.
   - **`clippy_lints/src/lib.rs`:** `explain` (:425) and `register_lint_passes` (:449) match statement by statement:
     - the renamed and removed loops;
     - the two pre-expansion factories with `conf`;
     - the cloned storages;
     - `skippable_lints(())` → `(null)`, the port's convention;
     - `is_lint_pass_required`;
     - `new(tcx, conf, format_args, attrs, is_active)`.

     The per-pass closures and conf arguments live in the generated `lib.gen.ts`, whose generator was reviewed separately. Its
     pending output type-checks against these skeletons.
   - **`declared_lints.rs`:** a scratch script maps each `crate::a::b::X_INFO` to the TS `m_<alias>.X_INFO` through the import
     paths. 835 = 835, in the same order, 0 differences.
   - **`deprecated_lints.rs`:** see N7.
   - `coverage --missing`: `driver.rs` 12/12, `declare_clippy_lint/src/lib.rs` 4/4, `clippy_lints/src/lib.rs` 2/2.
2. **Skeletons.** The scanner's result for each part of the brief:
   - **Markers:** the set of `// stub:` markers equals the set of upstream {every `fn` in the 368 `EarlyLintPass`/`LateLintPass`
     impls (604)} ∪ {the `new` of each of the 143 types `lib.rs` builds with `::new(`} (747). There is none missing and none
     extra.
   - **Placement:** every marker sits on its `T.prototype.<fn>` (right type and name) or its `static new`.
   - **Signatures:** parameter names equal upstream's, with `_` written `_N`; `new`'s parameters are equal too.
   - **`unported` texts:** each reads `clippy_lints::<module path>::<T>::<fn>`, the module path matching the file.
   - **The 28 `default()` constructors:** each type is `#[derive(Default)]` with no manual `impl Default` upstream, so a missing
     marker is right.
   - **Coverage:** stubs count as missing (`coverage --missing …/zero_div_zero.rs`: `:31 check_expr`, 0/1).
   - **Storages:** `AttrStorage` and `FormatArgsStorage` are faithful `Arc<OnceLock<…>>` cells, and `clone` shares them.
3. **`contract.d.ts` checks.**
   - Apart from F1, the blocks match b1's exports.
   - The test fails when a declared module exists: with b1's `clippy_config/lib.ts` present, `contract.test.ts` failed on its
     `existsSync … false` check.
4. **Tests.** The registration listing against `clippy-driver -W help` (835 lints in order, 10 groups with members in order) and
   the `help_message` binary comparison were re-run and pass. The mutations are in N4.
5. **Basics.**
   - `bunx tsc --noEmit -p .` is clean (11.8 s).
   - `bun scripts/coverage.ts --check`: markers ok.
   - `bun tools/codegen/clippy.ts --check`: up to date. Only `lib.gen.ts` is pending, waiting on `src/clippy_config/lib.ts`.
   - The lane's 4 test files: 14 pass, 1.5 s wall (≤ 10 s).
   - The environment allowlist fails (F2).
