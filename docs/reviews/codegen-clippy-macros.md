# Review: codegen-clippy-macros (tools batch, M8 wave 41 step 2)

Reviewer: independent, read-only. Subject: branch `t3/generate-clippy-macros` at `7178b735` (`git diff main...7178b735`: 368 files,
the generator `tools/codegen/clippy.ts`, `clippy-oracle.ts`, `clippy.test.ts`, the `lints.ts` export change, 359 `*.lints.gen.ts`,
`sym.gen.ts`, `msrvs.gen.ts`, `conf.gen.ts`, `lint_tables.gen.ts`), handoff `docs/handoff/codegen-clippy-macros.md`, against
`docs/plan-m8.md` D4, D5 (first bullet), D14, §2b–§2d, PORTING §5, and root's decision "codegen-clippy-macros (D5)"
(`docs/state/history.jsonl`, 2026-11-16T00:58).

Method: a detached scratch worktree of `7178b735` at `$RUST_TS_DATA/tmp/review-codegen-clippy-macros/wt` (`.env.local` copied,
`node_modules` linked), with the oracle check run from a copy whose `WORK` points under the review's scratch, so the lane's own
scratch was left alone. Mutations went into that worktree only and were reverted (`--check` up to date afterwards). Nothing was built.
Short oracle runs only (about 13 s each). Host on AC power, load about 4.

## Verdict: PASS WITH NOTES

The expansions that the contract lanes will build on are right. The oracle check is genuine for what it compares. It reproduces with
0 mismatches. A one-field change of my own in the model is caught. The counts match the pinned sources and the oracle's `-W help`.
The shared `lints.ts` change only adds exports and one helper. `tsc`, `coverage --check` and the tests pass within budget.

Two defects must be fixed before their consumers use them. Neither blocks the contract lanes:
- **N1:** the §2d file table under-lists files for three sub-passes. Fix it before `harness-m8d` reads the table.
- **N2:** the oracle check of the combined passes' TS does not check which trait method each field call invokes. Fix it before
  `lib.gen.ts` is first written, in `clippy-contract-a`.

N4 needs a root decision: the table names no `clippy_utils` files.

## Checks that pass (evidence)

**P1. The oracle check reproduces.** I re-ran `clippy-oracle.ts` (copy with `WORK` redirected). Results:
- `expanded-lints`: 835 statics, 835 `_INFO`, 365 passes; 2,037 comparisons.
- `expanded-combined`: 51 fields and 32 methods early, 316 fields and 31 methods late; 12 comparisons.
- sym: 619 symbols. msrvs: 146 aliases. conf: 101 variants.
- `w-help`: 835 lints, 10 groups.
- `tsc-pending`: 360 stubs, no errors.

There were 0 mismatches in every check. The clippy tarball's `git-commit-hash` equals the pin (`6f5da406…`).

**P2. What is compared.** The comparison is field by field, not by name:
- **Lint statics.** Every explicit `Lint` field from the expansion is compared with the model's fields: `name`, `default_level`,
  `desc`, `report_in_external_macro`, `future_incompatible`, `eval_always`, `edition_lint_opts`, and the rest. Both maps are sorted.
- **`_INFO` statics.** `lint`, `category`, the full `explanation` (the `concat!` expanded to one literal), `location` (with the
  `/rustc/<commit>` remap) and `version`.
- **Passes.** The kind, the `get_lints` list and the `lint_vec` list.
- **Combined passes.** Fields and types in order, `new`'s parameters, every ctor, `get_lints`, and every method's name, parameters
  and field-call order.
- **msrvs.** All three numbers of each version.
- **sym.** Values and indices.
- **define_Conf!.** All four tables and the `parse` arms.
- **`-W help`.** Name, level and description of every lint. Group members in order.

A gap in the TS-side comparison is N2. Comparing the model rather than the emitted text is N3.

**P3. My injected error is caught.** In `parseDeclareClippyLint` I made `report_in_external_macro` false for `NEEDLESS_RETURN` alone.
The lane did not try this mutation. Result: `ERROR: expanded-lints … 1 mismatches (first: lint NEEDLESS_RETURN fields …)`. Reverted.

**P4. Counts, verified independently from the pinned sources:**
- `grep 'declare_clippy_lint! *{'` over `clippy_lints/src` gives 835 invocations in 354 files; `declared_lints.rs` has 835 `_INFO,`
  entries. The other 5 of the 359 generated modules hold only passes, such as `utils/author.rs` and `utils/dump_hir.rs`.
- There are 365 `declare_lint_pass!`/`impl_lint_pass!` invocations.
- `lib.rs` `early_lint_methods!` (:492–547) has 51 field lines, and `late_lint_methods!` (:553–873) has 316.
- The oracle's `clippy-driver -W help` lists 835 `clippy::` lints and 10 groups: cargo, complexity, correctness, default, nursery,
  pedantic, perf, restriction, style, suspicious. The alias is `register_group_alias("clippy::default", "clippy::all")`
  (declare_clippy_lint `lib.rs:50`), and it matches `LINT_GROUP_ALIASES`.
- `SUB_PASSES` has 2 pre-expansion, 51 early and 316 late rows. Every one of the 835 lints is in at least one row, and the group
  members cover all 835.

**P5. The shared file.** `git diff main...7178b735 -- tools/codegen/lints.ts` adds `export` to 16 declarations and one helper,
`lintDefault(f)`, which returns `lint_defaults_raw.get(f)`. No logic changed. Results:
- `bun tools/codegen/lints.ts --check`: up to date (153 builtin lints; 48 rustc_lint modules, 122 lints, 89 passes).
- `lints.test.ts` passes.

**P6. Basics.**
- All 365 new files under `src/` are `.gen.ts`, and each starts with `// GENERATED by tools/codegen/clippy.ts from … @ 6f5da406b56c.
  Do not edit.`, the same form as `lints.ts`'s output.
- `bunx tsc --noEmit -p .` is clean (9.7 s).
- `bun scripts/coverage.ts --check`: markers ok. `--missing conf.rs` gives 5/13, as the handoff says.
- `clippy.test.ts`: 8 tests in about 0.7 s, well under D13's 10 s.
- It reads no environment variable. `clippy.ts` and `lints.ts` read none directly; `common.ts` reads `RUST_TS_DATA`, which is
  already allowed. `scripts/lib/unit-steps.test.ts` passes on the branch.

**P7. Deferrals.**
- **The pending `lib.gen.ts` is safe.**
  - While it is absent, nothing imports it, so `tsc` and `coverage --check` pass (P6). The `combined_*_pass.rs` fns simply stay
    0/3.
  - The unit test requires the file to be absent while any of its `needs` is missing. Once all exist, it requires the committed
    text to equal the regenerated text. So a lane that creates the last hand module but forgets to regenerate fails the unit step
    instead of passing silently.
- **Deferring the rest of `define_Conf!` is right.** `conf.rs:124`, `:136`, `:165` and `:203` call
  `<$ty as FromDefault<_>>::from_default`, `::display_default` and `<$ty as DeserializeOrDefault<_>>::deserialize_or_default`.
  These dispatch on the field's type to impls in `de.rs` and `types.rs`: the `conf_enum!` impl at `types.rs:65`, and the hand impls
  at `:423`, `:437`, `:621`, `:705`, `:784`, `:796`, `:875`, `:883` and `:906`. None of those impls has a TS name yet, so emitting
  calls now would invent an API. Root has recorded the follow-up `codegen-clippy-conf`.

## Findings

**N1. The §2d table under-lists files for three sub-passes. Severity: medium. Fix before `harness-m8d` reads `SUB_PASSES`.**

The closure in `buildTables` (`tools/codegen/clippy.ts:933–943`) follows only `crate::` paths (`cratePaths`, :789). Two kinds of
`super::` path also leave a pass's own tree:
- a top-level file's `super::`, which is the crate root;
- `super::` in a file pulled in from another directory.

I resolved `super::`/`self::` paths the same way as `crate::` paths: relative to the file's module, with lint-static-only names
excluded and `lib.rs` excluded. I then re-ran the closure over every row of the committed `SUB_PASSES`. Three rows miss a file:

| Row | Missing file | Why |
|---|---|---|
| late `NeedlessPassByRefMut` | `needless_pass_by_value.rs` | `needless_pass_by_ref_mut.rs:1` `use super::needless_pass_by_value::requires_exact_signature;`, a fn |
| late `Methods` | `matches/manual_utils.rs` | `methods/mod.rs:175` pulls `matches/manual_filter.rs`; its `:14` `use super::manual_utils::{SomeExpr, check_with};`, and `get_cond_expr` (:20) builds `SomeExpr` (a struct with inherent fns at `manual_utils.rs:217`), reached from `check_and_then_method` (:95), which `methods/mod.rs:5472` calls |
| late `ClonedRefToSliceRefs` | `matches/manual_utils.rs` | same, through its pulled `methods/mod.rs` |

So the handoff's claim that the rule "never makes a case eligible early" does not hold. For example, a `needless_pass_by_ref_mut`
case becomes eligible while `requires_exact_signature` is still a stub. The suite is report-only and never protected (D19), so the
effect is a wrong denominator, not a lost case, but that table exists to prevent exactly this.

The other tricky passes are right:
- `Methods`: 164 lints; all 162 `methods/` files plus `matches/manual_filter.rs`.
- The mixed directories `doc`, `attrs`, `functions` and `misc_early`: every pass in the directory gets the whole directory (14, 15,
  11 and 9 files). That over-includes, which is safe.
- `cognitive_complexity.rs`: 1 file.
- `QuestionMark`: gets `manual_let_else.rs` through its `impl`.
- `Unwrap`: gets `methods/obfuscated_if_else.rs`.
- `clippy_lints` has no `super::super::` path (grep: 0).

**Fix:** resolve `super::`/`self::` use-trees and expression paths in the closure, as for `crate::`. Add a unit test that pins these
three rows. Also update the table's header comment (`lint_tables.gen.ts:4`); it still says ``files`: the pass's own module tree``,
which the impl and closure rules have outgrown.

**N2. The oracle check of `lib.gen.ts` does not check which trait method each field call invokes. Severity: medium. Fix before
`lib.gen.ts` is first written (`clippy-contract-a`).**

`checkCombined`'s TS-side regex (`clippy-oracle.ts:448`) extracts only the field, `_provided\.\w+\(this\.(\w+),`, so the method
name of the call is never compared.

I injected one change in `emitCombined`: the late pass's `check_item` calls `LateLintPass_provided.check_item_post(...)` for every
field. Results:
- all 7 oracle checks: `ok`;
- `tsc-pending`: no errors, because both methods take `(cx, item)`;
- the 8 unit tests: pass, because the pending file is not compared.

Reverted. Once written, such a slip would silently run every late sub-pass's `check_item_post` where upstream runs `check_item`.

The TS side of these is not compared with the oracle either:
- the constructor forms from `ctorTs`: unit value vs `.default()` vs `.new(args)`, and the order of the arguments (the stubs take
  `...unknown[]`);
- the late pass's `is_active(<T>.lint_vec()) ? … : undefined` and `!== undefined` guards.

**Fix:**
- Capture the called name, `_provided\.(\w+)\(this\.(\w+),`, and require it to equal the enclosing method.
- Compare each TS ctor with the ctor the oracle expanded, mapped through the same table, and check the `is_active` guard per field.

**N3. Emission is checked by unit tests, not by the oracle. Severity: low.**

`checkLints`, `checkSym`, `checkMsrvs` and `checkWHelp` compare the oracle with the generator's in-memory model (`l.decl.fields`,
`g.sym`, `g.msrvs`, `g.tables.groups`), not with the emitted `.gen.ts` text. The emitters are direct prints. In the synthetic unit
tests, `clippy.test.ts:120` checks the `Lint` and `_INFO` text; my mutation emitting `category: "Restriction"` for Pedantic lints
was caught there. `conf.gen.ts`'s tables and `lib.gen.ts`'s methods are compared as emitted text.

Nothing compares `sym.gen.ts`'s `+ i` indices, `msrvs.gen.ts`'s constructor arguments, or `SUB_PASSES`/`LINT_GROUPS` as emitted with
the oracle. I checked them by reading:
- `RustcVersion`'s constructor is `(major, minor, patch)` (`version.gen.ts:9`);
- `Symbol.new(PREDEFINED_SYMBOLS_COUNT + i)` follows `src/miri/sym.ts`.

**Suggestion:** for those three, compare the emitted text with the oracle, as `checkConf` already does for its tables.

**N4. The table names no `clippy_utils` files. This is a decision for root and `harness-m8d`.**

§2d point 4 makes a case eligible when "every fn of the files implementing" its sub-passes is ported. Point 3 requires only
`clippy-utils-a…e` before the suite counts. Yet many lint files import `clippy_utils` modules that §2c places in the later
`clippy-utils-f`/`-g`. Counted with `grep -rl 'clippy_utils::<m>'` over `clippy_lints/src`:

| Module | Lint files |
|---|---|
| `consts` | 63 |
| `higher` | 31 |
| `usage` | 20 |
| `eager_or_lazy` | 8 |
| `mir` | 6 |
| `qualify_min_const_fn` | 3 |

Re-exports through `clippy_utils::{..}` add more. A case through such a pass is eligible but stops UNPORTED until `-f`/`-g` land.
The generator's `// PORT:` on `subPassFiles` (:765–770) says "(other than clippy_utils)", but the handoff does not raise it as a
decision.

**Options:**
- (a) `clippy-ui-lane` counts only once every `clippy_utils` lane has landed;
- (b) the table also lists the `clippy_utils` files each pass reaches;
- (c) accept the noise.

I recommend (a). It is the cheapest, and it keeps the table's meaning exact.

**N5. Lane ownership of the 360 hand modules. This is a note for root's lane plan.**

`lib.gen.ts` is written only when all 360 `needs` exist. Those include:
- the dispatch lanes' directory modules (`methods/mod.ts`, `matches/mod.ts`, ...);
- `clippy_config/lib.ts`;
- `clippy_utils/macros.ts`;
- `utils/attr_collector.ts`.

Whichever lane first registers the combined passes, presumably `clippy-contract-a`, must therefore create stubs for every one of
them in the same batch, including files that §2c gives to the dispatch contracts and to `clippy-contract-b`. Assign that explicitly,
so that two lanes do not each create, or each wait for, the same file.

**N6. Lints in more than one sub-pass. Severity: info, for `harness-m8d`.**
- `clippy::arithmetic_side_effects` is in both `ArithmeticSideEffects` and `Operators`, as upstream has it
  (`operators/mod.rs:996`, `operators/arithmetic_side_effects.rs:24`).
- `Documentation`, `UnusedUnit` and `LargeIncludeFile` each appear as an early and a late row.
- `MacroBraces` appears twice too.

The harness must map a lint to every row that holds it, not the first.

**N7. Minor.**
- `clippy-oracle.ts` hard-codes `WORK = $RUST_TS_DATA/tmp/codegen-clippy-macros` and `rm -rf`s it on each run, so a second user, such
  as a reviewer, clobbers the lane's scratch. A `--work <dir>` option would avoid that.
- The review brief's `bun scripts/tools.ts` does not exist. The clippy-preview tarball was already unpacked under
  `$RUST_TS_DATA/tools/08d0…/`, which `clippy-oracle.ts` finds by `git-commit-hash`.

## Scratch

`$RUST_TS_DATA/tmp/review-codegen-clippy-macros/` held the worktree, the oracle output and three small table scripts. It was deleted
when the review was done, and the scratch worktree was removed with `git worktree remove`.
