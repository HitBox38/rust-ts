APPROVE WITH NITS

# Independent review: dataflow-graphviz (wave 40i)

Branch `t3/port-dataflow-graphviz`, head `5f595507` (port `38b91011`, handoff `5f595507`), merge base `1b4bf086`. Reviewed
`git diff 1b4bf086...t3/port-dataflow-graphviz` against the pinned upstream (`$RUST_TS_DATA/rust`). Tested at the lane head in a
detached scratch worktree, since removed. Code read-only; no gate or full suite run. `RUST_TS_AGENT=rev-dfgv`,
`RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`, AC power.

No must-fix findings.

## 1. Fidelity, function by function

### `framework/graphviz.ts` (vs `compiler/rustc_mir_dataflow/src/framework/graphviz.rs`, 30 fns)
All 30 fns are present in upstream order, under correct markers (`coverage.ts --check` ok, `--missing`: 30/30). Read line by line:

- **`write_graphviz_results`** (`:41`):
  - Same order as upstream: attrs, `output_path(A::NAME)`, then `create_dir_all(parent)` and `create_buffered` or `MirDumper::new` / `set_disambiguator(pass_name ?? "-----")` / `create_dump_file("dot")`.
  - The style defaults to `AfterOnly`.
  - The render options are `Fontname`, plus `DarkTheme` under `-Zgraphviz-dark-mode`.
  - `with_no_trimmed_paths` wraps only `render_opts`, then `write_all`. The file is dropped on every path, as Rust's is at scope end.
- **`RustcMirAttrs::parse` / `output_path`** (`:140`, `:179`):
  - `set_file_name` is `pop` + `push`, written as `path_join(path_parent(ret), name)`.
  - Checked live with `"y.dot"` (parent `""`, so `create_dir_all("")` is `Ok`) and `"sub/deep/x.dot"` (directories created). Both match the oracle (§4).
- **`Formatter`, Labeller and GraphWalk** (`:229`–`:293`):
  - `graph_id` is `graph_for_def_id_{graphviz_safe_def_name}`, `node_id` is `bb_{n}`, and `node_shape` is `label("none")`.
  - `edge_label` is `fmt_successor_labels()[e.index]`; out of bounds panics, as Rust does.
  - **Iteration order:** `nodes` walks block indices ascending, filtered by `reachable_as_bitset`. `edges` walks *all* block indices ascending (unreachable ones too, as upstream's `flat_map` does), with successor order from `successors()`. `target` is `successors().nth(index).unwrap()`.
  - No hash map is iterated anywhere in the file. The attrs come from a `Vec`; `nodes_per_scc` in the region graph is an array.
- **`BlockFormatter`** (`:334`–`:592`):
  - `HEADER_COLOR` is `#a0a0a0`.
  - The table attributes, `bb{n}` header cells, MIR/STATE header and `valign` rule (`bottom` for `(on …)` rows other than `(on start)`) are byte-for-byte the `concat!` / `write!` strings.
  - Zebra striping: `toggle_background` returns the old value, and the background is reset to `Light` before `(on start)`. `Background::attr` gives `Dark` as `bgcolor="#f0f0f0"` and `Light` as empty.
  - `(on unwind)` is used only for `Call { target: Some(_) }`, otherwise `(on end)`. It is written when the state differs or the analysis is backward.
  - The call-return row requires `AssignOnReturn` with a non-empty `return_`. Its label is `(on successful return)` for `Call`/`InlineAsm` and `(on yield resume)` for `Yield`, and its cell carries `balign="left"`.
  - `write_row` escapes only the MIR cell (`dot::escape_html(mir)`). The index is unescaped, as upstream. `write_row_with_full_state` escapes `{:?}` of `DebugWithAdapter` (`Domain.fmt_with(.., PLAIN)`).
- **Two-column `two_phase` output** (`write_block_header_with_state_columns`, `:474`):
  - Row A is `<td sides="tl" colspan="2">bb..</td><td sides="tl" colspan="{n}">STATE</td>`; row B is MIR then the `BEFORE`/`AFTER` cells.
  - In `write_statements_and_terminator` (`:503`), `after` is taken before `before`, from the front when forward and the back when backward. The two `assert!`s on exhaustion are kept.
  - The terminator head comes from `fmt_head`, and its `unwrap` panics with Rust's message.
  - Verified live: `#[rustc_mir(borrowck_graphviz_format = "two_phase")]` output is identical across all 9 analyses (§4).
- **`StateDiffCollector`** (`:596`):
  - `before` is `Some(vec![])` only for `BeforeAndAfter`, and `prev_state` is a clone of `entry_states[block]`.
  - The four visitor hooks push `diff_pretty(state, prev)` then `clone_from`. The early hooks act only when `before` is `Some`.
  - `visit_block_exit` forwards to the provided default. `visit_results(body, [block], ..)` matches `iter::once(block)`.
- **`diff_pretty`** (`:660`), checked step by step:
  1. Equal states give `""`.
  2. Otherwise it prints `{:#?}` of `DebugDiffWithAdapter` (`fmt_diff_with(.., PRETTY)`).
  3. It applies `escape_html`.
  4. It replaces `\n` with `<br align="left"/>`.
  5. It replaces `\t?\u001f([+-])` (global flag, leftmost-first, non-overlapping, the same as `replace_all`). Each match closes an open `</font>`, then opens `<font color="darkgreen">+` or `<font color="red">-`.
  6. `Cow::Borrowed` (no match) returns `raw_diff` without the trailing `</font>`; this is the `matched` flag.
  7. A trailing `</font>` is added if a tag is open.

  The `\u001f` survives `escape_html`, which only touches `<>&"'`, so the order matters and is upstream's. The unit test's expected cells come from oracle `.dot`s.

### `mir/generic_graphviz.ts` (new, 7 fns)
All 7 fns are present in order with correct markers.
- The strings match upstream's `writeln!`/`write!` literals exactly: `digraph`/`subgraph cluster_`, the font and dark-mode attributes, the table, `bgcolor` gray/dimgray, `align="center" colspan="1"`, the section rows, edge labels, and the graph label.
- Nodes and edges both follow `post_order_from(start_node)`, as upstream.
- `node()` is `{:?}__{name}`.
- `G::Node: Debug` is passed as `debug_node`. It has no caller here or upstream, as the handoff says.

### `mir/pretty.ts`
`dump_mir`'s `-Zdump-mir-graphviz` branch now calls `write_mir_fn_graphviz(tcx, body, false, file)` inside the existing `let _ = try { .. }` shape. The result is discarded and the file dropped, as upstream (`pretty.rs:169-174`). This is the only change.

### `region_infer/graphviz.ts`
- Only the wiring changed: `dot::Id::new(..).unwrap()` and `dot::render`.
- The impl tables are untouched, and `as_dot_graph` binds them.
- `SccConstraints` has no `edge_label` upstream (`graphviz.rs:151-171` overrides only `graph_id`, `node_id`, `node_shape`, `node_label`). So it correctly falls through to `Labeller_provided` (empty label). `RawConstraints` overrides all five, and the port passes all five.

## 2. `obligation_forest`
- **Edges:** upstream `graphviz.rs:73-80` is `node.dependents.iter().map(move |&d| (d, i))`, so `(d, i)` is right and the old `(index, dependent)` was reversed. `source` is `.0` and `target` is `.1`, unchanged.
- **Nothing depended on the old order:** `GraphWalk_ObligationForest`, `Labeller_ObligationForest` and `dump_graphviz` have no references outside `obligation_forest/mod.ts` (grep of `src/`). Upstream `dump_graphviz` has no caller either (`#[allow(dead_code)]`), and it returns early unless `DUMP_OBLIGATION_FOREST_GRAPHVIZ` is set.
- **The `node_label` stop is right.** Upstream prints `{:?}` of `node.obligation.as_cache_key()` (for `PendingPredicateObligation`, a `ParamEnvAnd<Predicate>`). The old port printed `Debug` of the *obligation* through a non-upstream `f: Fmt` parameter: a different value, so a guess. The port's `as_cache_key` yields a canonical key string, not the value, so `unported(..)` is the honest choice.
- **`dump_graphviz` matches upstream:** the env check comes first, then the counter post-increment and the `{counter:010}_{description}.gv` name. The `create_buffered().unwrap()` and `render().unwrap()` panic as upstream does.

## 3. Contract-test changes: honest
- **`dataflow_contract.test.ts`:**
  - The total stays at 378, with markers going 348 → 378 and stubs 30 → 0. That equals graphviz.rs's 30 fns moving from stub to marker, and `--missing` confirms 30/30.
  - The removed checks asserted the stub stops (`stops(..)` on `write_graphviz_results`, and `iterate_to_fixpoint(dump=true)` reaching the stub). They cannot hold once the code is ported.
  - The `dump=false` half is kept. The `dump=true` path is now exercised end to end by `graphviz.test.ts`: it runs the port through the driver and compares six `.dot`s with an oracle fixture, plus a freshness check of the fixture against the pinned rustc.
  - No other assertion was loosened.
- **`mir/contract.test.ts`:** `generic_graphviz.rs` was added to `FILES`, and the total went 723 → 730. That is +7, the file's fn count (`new`, `set_graph_label`, `write_graphviz`, `write_node`, `write_edges`, `write_graph_label`, `node`). The per-file checks now cover the new file too, so the test is stricter, not weaker.

## 4. Reproduction
- `bun scripts/difftest.ts --suite mir-opt-o4 --filter dump_dataflow`: **MATCH 1/1** (run `20261110-183306-rev-dfgv-9wuo`).
- **Dump tree of the target case:** I ran the suite's exact argv, taken from `SUITES` at the lane head, from a scratch cwd with a `tests -> $RUST_TS_DATA/rust/tests` symlink. The env was `RUSTC_ICE=0 RUST_BACKTRACE=short`, with `-Zdump-mir-dir` in scratch, run for both the fresh oracle and the port. `diff -rq` reported **138/138 files identical** (13 `.dot`), along with stdout, stderr and exit. The harness's own subject dir from my run is identical to the fresh oracle tree too.
- **My own input:** a 20-fn file with HTML-hostile string literals (`<a href="&amp;">'</a>`, a literal `\u{1f}+`), `Vec<Option<&str>>`, inline `asm!` (InlineAsm return row), a coroutine with two yields (`(on yield resume)`), async/await, closures, a `HashMap` entry, match guards, an unwinding `String` drop, a two-phase borrow (`v.push(v.len())`), and dead code after `return`.
  - Flags: mir-opt-o4's flags plus `--edition=2021 -Zdump-mir=all -Zdump-mir-graphviz -Zdump-mir-dataflow -Zunpretty=mir`.
  - Result: **5050/5050 files identical, 2646 of them `.dot`**, with stdout, stderr and exit equal.
  - The rows hit: `on yield resume` (18 files), `on successful return`, red/green diffs (159), `(on end)` (172), `(on unwind)` (86).
- **Attribute paths:** a second input used `#[rustc_mir(borrowck_graphviz_postflow = "sub/deep/x.dot", borrowck_graphviz_format = "two_phase")]` and `borrowck_graphviz_postflow = "y.dot"`, with `-Zgraphviz-dark-mode -Zgraphviz-font="Courier New" -Zdump-mir-graphviz`. I ran it in separate cwds per side.
  - Result: all 357 dump and attribute files identical: 18 `<analysis>_{x,y}.dot`, including the `BEFORE`/`AFTER` columns, `bgcolor="black"` and the font.
  - The only differing file was `out.rmeta`, by 2 bytes, because metadata embeds the cwd (`.../oracle` vs `.../subject`). That is a harness artefact of my setup, not the lane's.

## 5. Checks
- `--sample 200 --jobs 6`: mir-opt-o4 **200/200 MATCH** (`20261110-183620-rev-dfgv-bo0j`); mir **200/200 MATCH** (`20261110-183709-rev-dfgv-dhrh`). No non-MATCH in either sample.
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: `markers ok (24933; vendor 5311; library 610)`.
- `--missing`: framework/graphviz.rs 30/30, generic_graphviz.rs 7/7, obligation_forest/graphviz.rs 9/9, region_infer/graphviz.rs 22/22.
- `bun test src/rustc_mir_dataflow src/rustc_graphviz src/rustc_data_structures/obligation_forest src/rustc_middle/mir src/rustc_borrowck`: **208 pass, 0 fail**.

## Nits
- **N1** `src/rustc_mir_dataflow/framework/graphviz.test.ts:105-115`: when the pinned toolchain is missing and `RUST_TS_REQUIRE_PROBES` is unset, "the graphviz_oracle fixture is the current oracle output" `return`s and reports a *pass*. The repo's precedent is `test.skipIf(!HAVE && !REQUIRE)(..)` (`src/rustc_middle/mir/debug.oracle.test.ts:414`), so it shows as a skip with the reason. The gate sets `REQUIRE`, so this is cosmetic.
- **N2** `src/rustc_mir_dataflow/framework/graphviz.test.ts:46`: `run_dumps` uses `os.tmpdir()`. Other tests here do too, so it is fine. With disk tight, `$RUST_TS_DATA/tmp` would keep stray dirs visible if a run is killed before the `finally`.
- **N3** `src/rustc_mir_dataflow/framework/graphviz.ts:660`: `diff_pretty` is `export`ed only for the unit test, where upstream's is private. Harmless, but a one-line `// PORT:` noting it is exported for `graphviz.test.ts` would help.
- **N4** `src/rustc_mir_dataflow/framework/graphviz.ts:510-512`: `next_in_dataflow_order` uses `Array.shift()` (O(n) each) for forward analyses. That is quadratic in the statements per block, but only under `-Zdump-mir-dataflow`, so it doesn't matter in practice. An index cursor would mirror `vec::IntoIter` more closely.

## Note for root
The harness still does not compare `-Zdump-mir-dir`. The lane's handoff already suggests a harness batch to compare the mir-opt-o4 dump dirs, and I agree: today `dump_dataflow.rs`'s MATCH covers only `-Zunpretty=mir` stdout, stderr and exit, not the 138 dump files verified above.
