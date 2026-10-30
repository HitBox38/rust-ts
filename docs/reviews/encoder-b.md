verdict: APPROVE-WITH-NOTES

Reviewer: independent review of lane encoder-b, branch `lane/encoder-b` @ 2b6bba09 (`git diff main...lane/encoder-b`).
Upstream: `.data/rust/compiler/rustc_metadata/src/rmeta/encoder.rs` :651–:1481 and `rmeta/mod.rs:270` (CrateRoot).

## What was checked

- Fns checked against upstream, arm by arm and statement by statement: `encode_crate_root` (:651), `analyze_attr` (:945), `should_encode_span` (:974), `_attrs` (:1008), `_expn_that_defined` (:1052), `_visibility` (:1088), `_stability` (:1125), `_mir` (:1181), `_variances` (:1213), `_generics` (:1252), `_type` (:1288), `_fn_sig` (:1349), `_constness` (:1385), `_const` (:1424) and `encode_attrs` (:1461).
  - Every predicate's true/false variant sets match upstream exactly, including the sub-pattern arms: `Static { nested }`, `Ctor(_, CtorKind::Fn)` and `Impl { of_trait: false }`.
  - `should_encode_mir`'s guarded `Closure if is_coroutine` arm is in upstream's arm order, before the general `AssocFn | Fn | Closure` arm.
  - `should_encode_variances` checks `ImplTraitInTraitData::Trait`. `should_encode_type`'s OpaqueTy / AssocTy / TyParam logic matches, with `bug!()` on the `let-else` arms.
- `encode_crate_root`:
  - The `stat!` labels and the call order match upstream, including the duplicate `"exportable-items"` label.
  - The interpret-alloc loop matches. It is `u64` positions via `encode_u64`.
  - The SVH branch on `metadata_crate_hash` flushes and then calls `finish_128().to_le_bytes()`. `metadata_crate_hash` defaults to `true` in options.gen.ts.
  - `local_crate_hash` set-once panics with `expect`'s `msg: {err:?}` format, using `debug_Svh` (upstream `#[derive(Debug)]`).
  - `dep_extra_filenames` has filler slot 0 and the `assert_eq!` message format. `computed_total_bytes` has its assert.
- `CrateRoot` constructor arguments: the positional order matches the struct field order in mod.rs:270–328 (and in the TS class at mod.ts:330), so `encode_CrateRoot` writes the fields in upstream order.
- `analyze_attr`:
  - It has the same four-way else-if chain.
  - `Attribute.name` has the attr.rs:177 semantics: `None` for parsed attrs and for multi-segment paths.
  - The `DocComment` / `Doc(d).hidden` field names match data_structures.rs:491.
- `encode_attrs`:
  - The filter is a generator consumed by `lazy_array`, which iterates lazily (encoder.ts:388). `state.is_doc_hidden` is read only after encoding, as upstream does.
  - `record_array!` expands to `set_some(def_id, …)` and `record_value!` to `set(def_id, …)`, matching the macros at encoder.rs:447/:455.
- Markers: every one of the 15 stubs is now a `// rustc: …:<line> <name>` marker, with lines and names matching upstream. `bun scripts/coverage.ts --missing …/encoder.rs` lists nothing in :651–:1481.
- No changes under `harness/`, `scripts/`, `harness/baseline` or `tools/`. No generator changes.
- Ran in a scratch worktree:
  - `bunx tsc --noEmit -p .`: clean.
  - `bun test src/rustc_metadata`: 118 pass, 0 fail.
- Sample claims are plausible. encoder.ts is only type-imported on the difftest paths (rmeta/mod.ts:18/:48), and `encode_metadata` is not reached by the mir / tydump-ui suites, so no MATCH can be lost. I did not re-run the samples.

## Findings

1. **encoder.ts `encode_crate_root`, the `new CrateRoot(...)` call (≈ diff lines 186–262). Non-blocking.**
   Upstream builds a struct literal with named fields in a different textual order from the struct: `proc_macro_data`, `debugger_visualizers`, the `find_attr!`s and `get_symbol_mangling_version()` come before `crate_deps`. Rust evaluates field initializers in literal order. The port evaluates them in constructor (struct) order.
   The only expressions whose evaluation order differs are the pure `find_attr!` lookups and `get_symbol_mangling_version()`. The queries (`crate_name` … `has_panic_handler`, `specialization_enabled_in`) keep their relative order. So there is no observable difference, and the encoded field order is correct.
   Noted only because it is a deviation from "same order". A `// PORT:` line would make it explicit.

2. **encoder.ts `encode_crate_root`, the `-Zmeta-stats` branch. Non-blocking.**
   It is `unported(...)`, with a justified reason (`usize_with_underscores` and `{:4.1}` formatting are not ported). It fires before upstream's `self.opaque.flush()` / rewind, which is fine because the whole branch is unported.
   Follow-up for root: port rustc_data_structures `thousands.rs` and then this branch.

3. **encoder.ts `encode_crate_root`, the interpret-alloc loop. Non-blocking.**
   `[...this.interpret_allocs.keys()]` is rebuilt once per round. That is correct, because `insert_full` only appends and the `Map` keeps insertion order, so indices match the `FxIndexSet`. It is O(n) per round. Fine at the current scale. The `// PORT:` comment documents it.

4. **encoder_contract.test.ts. Non-blocking.**
   The lane edited the pinned contract test: `ported_by` now accepts :651–:1481, and the `encode_crate_root` stub expectation now says `"encoder-c"`. Both edits are the necessary consequence of porting the lane's fns. The handoff discloses them, and the per-lane counts are unchanged (encoder-b = 15). Not tampering.

5. **For root: `crate_hash(LOCAL_CRATE)`. Non-blocking.**
   As the handoff says, `encode_crate_root` now sets `untracked.local_crate_hash`. rustc_middle `hir/map.ts`'s `crate_hash` should read it, which is not this lane's file. Until then, `-Zmetadata-crate-hash=no` builds and later `crate_hash(LOCAL_CRATE)` readers stop at `unported`.
