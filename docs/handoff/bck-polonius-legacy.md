# Handoff: bck-polonius-legacy (part 2 of polonius-legacy): borrowck's legacy Polonius on the vendored engine

Branch `lane/bck-polonius-legacy`, based on 9cb9b211 (integ-w27). No merges.

All 40 `(lane bck-polonius-legacy)` stubs are ported. The call sites now use vendored polonius-engine 0.13.0:
`AllFacts::default`, `Output::compute`, `Output::errors_at` and `Output::subset_errors`. `-Zpolonius=legacy`, bare
`-Zpolonius` and `-Znll-facts` now run to the end.

## Files touched
- `src/rustc_borrowck/polonius/legacy/facts.ts`: every fn of facts.rs. This includes `write_to_dir`, which writes
  each field with its `FactRow` impl in macro order, and a private `BufferedFile`, which stands in for
  `File::create_buffered`. It adds the `RustcFactTypes` FactTypes record and re-exports the vendor `AllFacts` /
  `Output` types.
- `src/rustc_borrowck/polonius/legacy/mod.ts`: `emit_move_facts`, `emit_universal_region_facts`, `emit_outlives_facts`,
  and the `drop_of_var_derefs_origin` push in `emit_drop_facts`.
- `src/rustc_borrowck/polonius/legacy/{accesses,loan_kills,loan_invalidations}.ts`: every fn.
- `src/rustc_borrowck/lib.ts`: `PoloniusFacts_default` became `AllFacts.default<RustcFactTypes>()`, and
  `PoloniusOutput_errors_at` became `polonius.errors_at(..)`. Unused imports were removed.
- `src/rustc_borrowck/nll.ts`: `Algorithm.from_str(..)` with `unwrap`, then `Output.compute(facts, algorithm, false)`.
- `src/rustc_borrowck/region_infer/region_context.ts`: iterates `polonius_output.subset_errors` and `BTreeSet.iter()`.
  The `PoloniusOutput_subset_errors` stub is removed.
- **Outside the listed call sites, needed to typecheck:** `type_check/mod.ts` (2 sites) and
  `type_check/liveness/trace.ts` (1 site). They cast the opaque `PoloniusFacts` to stand-in shapes, and those casts no
  longer compile against the real type because the fact tuples are `readonly`. The casts and the
  `PoloniusFactsLoanIssuedAt` stand-in are removed, along with the imports that were only used by them. No logic
  changed.
- `tools/codegen/borrowck.typemap.json`: `polonius_engine::AllFacts` is now `AllFacts<RustcFactTypes>` and
  `polonius_engine::Output` is now `Output<RustcFactTypes>`, both imported from facts.ts. They were `unknown`.
  The borrowck set was regenerated: only `facts.gen.ts` (`PoloniusFacts`, `PoloniusOutput`) and `lib.gen.ts`
  (`CollectRegionConstraintsResult.polonius_facts`) changed. Before the edit, the regeneration had produced no drift.
- `src/rustc_borrowck/contract.test.ts`: markers go from 861 to 901 and stubs from 40 to 0. The per-lane table is
  now empty, and the `bck-polonius-legacy` row is commented as filled. **The borrowck stub total is 0.**
- New: `src/rustc_borrowck/polonius/legacy/facts.oracle.test.ts`. It runs the `ckdump` probe and
  `src/rust_ts/ckdump.ts` with `-Znll-facts` on 3 cases (lib with NLL, lib with `-Zpolonius=legacy`, and a binary
  with an E0502 that Polonius finds). It requires every `.facts` file, stderr and the exit code to be byte-identical.
  Without the probe it is a visible SKIP. Mutation check: emitting `mid_index` in `emit_loan_invalidated_at` makes
  all 3 cases fail.

## Coverage
`bun scripts/coverage.ts --missing compiler/rustc_borrowck/src/polonius/legacy/<f>.rs`:
| file | coverage |
|---|---|
| mod.rs | 5/5 |
| facts.rs | 20/20 |
| accesses.rs | 4/4 |
| loan_kills.rs | 6/6 |
| loan_invalidations.rs | 10/10 |
| location.rs | 7/7 |

`--check`: markers ok (22798; vendor 4483). Typecheck is clean.

## Verification
- **borrowck-ui cases with legacy Polonius / nll-facts:** I ran all 31 cases of the full suite whose argv has
  `-Zpolonius`, `-Zpolonius=legacy` or `-Znll-facts`, one subject at a time against the cached oracle outputs. That
  includes the 12 cases in the 300-case sample. **Result: 31/31 MATCH, 0 DIFF.** These ran while the gate was up, so
  I used no difftest run; the scratch runner was `.data/tmp/bpl/run-polonius.ts`.
- **`-Znll-facts` dumps vs the oracle:** byte-identical on every input tried:
  - 9 bodies with moves, a Drop struct, a loop with reborrows, explicit outlives, a closure, a raw pointer, a two-phase
    borrow, a partial move, indexing and a match guard: 162 files, 2567 rows;
  - the same with `-Zpolonius=legacy`, and with bare `-Zpolonius`;
  - with `POLONIUS_ALGORITHM` = Naive, DatafrogOpt, LocationInsensitive and Compare. The diagnostics are identical
    too; LocationInsensitive reports the error, as the oracle does;
  - async fns and a static coroutine (the `Yield` invalidation path): 144 files. The subject then stops later at an
    unrelated stub, `EarlyBinder::skip_binder` (explicit_item_self_bounds).
  - An invalid `POLONIUS_ALGORITHM` gives the same unwrap panic message as the oracle. Only the generic ICE framing
    differs.
- `bun test src/rustc_borrowck`: 59 pass, 0 fail. The contract test passes, including the fresh entry-point load
  check.
- Sample difftests (`RUST_TS_AGENT=root-f5de`): see "Sample runs" below.

## unported(...) left
None in `polonius/legacy/*`, lib.ts, nll.ts or region_context.ts. Elsewhere, rustc_borrowck has only
`region_infer/graphviz.ts` (`rustc_graphviz::Id::new` and `rustc_graphviz::render`), which belongs to another lane.
Inline asm with `-Znll-facts` stops before borrowck at `StableHash without a TS impl`, which is outside this lane.

## PORT decisions
1. `PoloniusFacts`/`PoloniusOutput` are mapped through the **codegen typemap**, not hand aliases, so the generated
   users (`consumers.gen.ts`, `nll.gen.ts` and `lib.gen.ts`) get the real type too. `impl FactTypes for RustcFacts`
   is the type-level record `RustcFactTypes` in facts.ts. The generated `RustcFacts` stays the unit struct, and
   facts.ts re-exports the vendor `AllFacts`/`Output` types for the typemap import. facts.gen.ts's import from
   facts.ts is type-only, so Bun drops it at runtime and the init order is unchanged.
2. The `Atom` impls are kept as impl tables (`Atom_PoloniusRegionVid`, ...) that carry the upstream `index` fns. The
   vendor `Atom` is `number`, and the engine uses the identity.
3. The `write_facts_to_path!` macro in `write_to_dir` is expanded by hand: one call per field, in macro order, with
   each field's `FactRow` impl passed explicitly. `?` becomes an early return.
4. `File::create_buffered` is a private `BufferedFile` in facts.ts, modeled on mir/pretty.ts's `DumpFile`. It
   buffers and flushes on `drop()`, ignoring errors as `BufWriter`'s `Drop` does. `drop()` runs in `finally`.
   `fs::create_dir_all("")` is treated as `Ok`.
5. `write!(out, "{:?}{tail}", s)` is `out.write_fmt([debug_str(s) + tail])`.
6. `reserve(..)` calls (capacity only) are comments. `extend(iter.flat_map(..))` is nested loops in iteration order.
7. `check_access_for_conflict`'s `match (rw, borrow.kind)` is an if/else chain in arm order, as in lib.ts.
8. nll.ts: `polonius_output.clone()` shares the `Output`, which is never mutated after compute, as part 1 noted. The
   `polonius_analysis` prof timer is dropped (driver-m2 decision 8).

## For root
- Pinned stops: no test pinned `polonius_engine::AllFacts::default` (grep of src/harness). The contract test counts
  were updated as described above.
- The 31 legacy-polonius / nll-facts borrowck-ui cases should now be MATCH in the gate (12 in the root-f5de sample).
- Decision to record: the typemap mapping for polonius-engine's `AllFacts`/`Output`, and the type_check cast removal.
