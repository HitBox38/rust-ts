APPROVE WITH NITS

# root-w49-check: independent check of `ea15d152` (integ-w49)

Commit: `ea15d152` "integ-w49: unwrap_result with a Debug for the error in dataflow-graphviz's five calls".
Checked in a detached worktree at that commit (`.env.local` from integ-w39, `RUST_TS_REQUIRE_PROBES=1`,
`RUSTUP_AUTO_INSTALL=0`, AC power). Upstream: `$RUST_TS_DATA/rust` at `6f5da406b56`.

## 1. Error types and Debug output

- `dot::Id::new` (compiler/rustc_graphviz/src/lib.rs:396) is `-> Result<Id<'a>, ()>`; the TS port
  `src/rustc_graphviz/lib.ts:407` is `Result<Id, null>`, so `Debug<null>` is the right type. `()`'s Debug is `()`;
  the panic text becomes ``called `Result::unwrap()` on an `Err` value: ()``, as core's `unwrap_failed` prints.
- `write_node_label` (compiler/rustc_mir_dataflow/src/framework/graphviz.rs:272) is `-> io::Result<Vec<u8>>`; the
  TS port (`src/rustc_mir_dataflow/framework/graphviz.ts:344`) is `IoResult<string>` (the line-8 PORT: buffers are
  strings). `debug_IoError` (`src/std/io.ts:301`) is the existing port of `impl Debug for Repr`
  (`Os { code, kind, message }`, `Custom { kind, error }`, `Kind(..)`, `Error { kind, message }`). Matches.
- All five call sites are upstream `.unwrap()`s: rustc_mir_dataflow graphviz.rs:186, :190, :201;
  rustc_borrowck region_infer/graphviz.rs:105/108/156/159; obligation_forest/graphviz.rs:46/50.
- None of these errors can happen on the inputs these sites get (`graph_for_def_id_` + `graphviz_safe_def_name`,
  `bb_N`, `rN`, fixed names; writing into an in-memory buffer), so no panic text from them reaches oracle output.

## 2. Local `debug_unit`

Acceptable, and it is the existing pattern: the same one-line definition already exists in `src/rustc_hir/hir.ts:117`
(exported), `src/rustc_target/asm/asm_oracle/run.ts:103`, `src/rustc_borrowck/type_check/mod.ts:209` and a test.
`src/std/` exports no unit Debug. Importing it from `rustc_hir` would be wrong for
`rustc_data_structures/obligation_forest/mod.ts`: no file under `src/rustc_data_structures/` imports `rustc_hir`
(upstream's dependency runs the other way), and the two graphviz files would take on the heavy `rustc_hir` module just
for a constant. Local copies are the right call here; see N3.

## 3. Markers, order, success path

- `// rustc:` / `// rustc-skip:` lines in all three files are identical before and after (diffed `ea15d152~1` vs
  `ea15d152`). No function moved. `bun scripts/coverage.ts --check --offline`: `markers ok (24933; vendor 5311; library 722)`.
- Success path unchanged: `unwrap_result` returns `r._0` on `Ok` whatever `debug_err` is (`src/std/result.ts:41-48`).
  The only additions are two imports (`type Debug`, `debug_IoError`) and three module-level `const debug_unit`s with no
  side effects.

## 4. Runs (on `ea15d152`)

| check | result |
|---|---|
| `bun test ./src/std/result.test.ts` | 3 pass, 0 fail |
| `bun test` rustc_mir_dataflow, rustc_borrowck, rustc_data_structures, rustc_graphviz | 255 pass, 0 fail (37 files) |
| `bunx tsc --noEmit -p .` | exit 0 |
| `coverage.ts --check --offline` | markers ok |
| `difftest --suite mir-opt-o4 --filter dump_dataflow` | 1/1 MATCH (run `20261110-191828-root-w49-check-v51w`) |
| `difftest --suite mir --sample 100 --jobs 6` | 100/100 MATCH, skipped=1 (run `20261110-191835-root-w49-check-dway`) |

## track_caller (question 1, panic location)

I called `resolve_panic_stack` directly with stack strings built for the three dataflow sites (unwrap_failed ->
unwrap_result -> site):
- `graph_id` (TS :235) -> `.../rustc_mir_dataflow/src/framework/graphviz.rs:186:58`, `node_id` (TS :240) -> `:190:51`.
  Both are correct: the column is the `unwrap` method name.
- `node_label` (TS :248) refuses: "`unwrap_result` called 1x in TS, 2x at .../graphviz.rs:193".

The commit does not change any of this. Before it, the one-argument form threw without a location at all.

## Nits (all from before this commit; none blocks)

- **N1** `src/rustc_mir_dataflow/framework/graphviz.ts:248`: upstream `node_label` has two `.unwrap()`s (:201 and
  `String::from_utf8(label).unwrap()` at :203, which the string-buffer PORT removes). The track_caller walk counts 1 vs 2
  and refuses. A refusal is a visible panic reason, not a guessed location, and this error can't happen, so it is only a
  note for the dataflow-graphviz lane's follow-up (e.g. a `// rustc-call:` anchor, if the walk accepts one for count
  mismatches).
- **N2** `graph_id`/`node_id` (:235, :240) are `return unwrap_result(...)`, which is a tail call in strict-mode ESM.
  With JSC's tail calls on, the site's frame is dropped and the walk would refuse at runtime (the synthetic stacks above
  keep the frame). The `dot_Id_new` helpers in `src/rustc_borrowck/region_infer/graphviz.ts:36` and
  `src/rustc_data_structures/obligation_forest/mod.ts:857` are unmarked glue, which refuses too. These errors can't happen
  either, so this changes no output.
- **N3** There are now six identical `debug_unit` definitions. A shared `debug_unit` in `src/std/fmt.ts` would remove
  them, but that is a `src/std/` change for its own batch, not this integration commit.
