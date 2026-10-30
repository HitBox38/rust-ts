verdict: APPROVE-WITH-NOTES

Reviewer: independent read-only review of root's commit 24b43272 on integ-w33 (wave 33).
Upstream: .data/rust @ 6f5da406b56c.

## What I checked and ran

- `git show 24b43272`, compared line by line with fake_doc_items.rs, context.rs:1628 report_unused_features,
  callbacks.rs:57 track_feature and :115 setup_callbacks, graph.rs:44 QuerySideEffect and :574 encode_side_effect,
  unstable.rs:114 Features::enabled and the `find_attr!` macro (rustc_attr_ir lib.rs:101).
- Scratch detached worktree of integ-w33 (.env.local copied, node_modules symlinked; removed afterwards):
  - `bunx tsc --noEmit -p .`: clean.
  - `coverage.ts --check`: markers ok (23153; vendor 4680). `--missing fake_doc_items.rs`: 3/3.
    `--missing callbacks.rs`: 3/6 (track_span_parent, track_diagnostic, emit_bug_diagnostic left, as the module
    comment says).
  - Oracle (nightly-2026-10-11) vs port, `--emit=metadata`, four `#![no_core]` lib crates: root's /tmp/rmeta-try/lib.rs;
    one adding `never_type` (stable_features) and `rustc_attrs`; one with `#![warn(unused_features)]`; one with
    `#![deny(unused_features)]` and two unused features (`decl_macro`, `auto_traits`), which fires the new
    UnusedFeature lint twice and exits 1. In all four the rmeta is byte-identical and stderr and exit code are identical.
  - Difftests (RUST_TS_AGENT=rv-w33): tydump-minicore full 46/46 MATCH; borrowck-ui --sample 80: 80/80 MATCH;
    mirdump-ui --sample 60: 60/60 MATCH.

## Correctness verdicts on the three items

- fake_doc_items.ts: same fns, same order, markers at the right lines (:11, :36, :53). The feature check uses
  `enabled_features()` (no TRACK_FEATURE, as upstream). The `find_attr` pattern is right: RustcDocPrimitive(..), or
  Doc with `keyword` Some, or Doc with `attribute` Some, as a boolean form. `tcx.hir_attrs(id)` is what
  `HasAttrs::get_attrs` for HirId does (ty/mod.rs:2371), and other ports already write it this way (mir_build
  builder/mod.ts:377). `all_fake_doc_items`: same crate filter (`is_user_visible_dep`) with LOCAL_CRATE chained last
  (see note 3 about query order). provide is wired in rustc_passes/lib.ts.
- report_unused_features: message text `feature \`{$feature}\` is declared but not used` and the arg name `feature`
  match upstream. `Symbol_into_diag_arg` and the `Diag.new(.., {$:"Inline"})` shape match the generated derives
  (e.g. rustc_resolve diagnostics/mod.gen.ts:446). It is called as
  `emit_node_span_lint(UNUSED_FEATURES, CRATE_HIR_ID, span, ..)`, as upstream. It is covered by the gaps-30c
  decision (fn-local derives hand-written in the generated shape). Output verified against the oracle (lib4 above).
- track_feature: matches callbacks.rs:57 branch for branch (no icx: return; cached index: read_index; else
  encode_side_effect + insert + read_index). It is installed in setup_callbacks in upstream position (after
  DEF_ID_DEBUG, where TRACK_DIAGNOSTIC would be). The encode_side_effect no-dep-graph branch returns
  next_virtual_depnode_index like graph.rs:580. The dep-graph branch is `unported`, which is correct. The marker
  line 574 is right. `QuerySideEffect` has only CheckFeature, with a PORT note for Diagnostic(DiagInner).
- Root's claim that unused_features depends on this outside incremental builds is **correct**. Upstream
  writes `query_system.used_features` in exactly two places: callbacks.rs:64-70 (this callback) and graph.rs:782
  (replaying a side effect in force_side_effect, incremental only). Without the callback, every enabled feature
  would look unused. The tls context exists for the whole analysis: GlobalCtxt::enter calls enter_context
  (context.ts:2989), as upstream does.

## Findings

1. src/rustc_middle/dep_graph/graph.ts:111-127 (low, fidelity/comments): `encode_side_effect` was inserted between
   `with_feed_task`'s doc comment ("Create a node when we force-feed a value into the query cache ... FIXME ...")
   and with_feed_task's `// rustc: graph.rs:601` marker. That doc comment now documents encode_side_effect, which has
   no doc comment upstream (`#[inline]` only). Move the method above the doc block, i.e. directly after read_index
   (graph.rs:507) and before the block at line 111.

2. src/rustc_middle/dep_graph/graph.ts:18-21 (low, PORTING §2 comments): the doc comment on `QuerySideEffect`
   ("Side effects of a query: re-applied when the query is marked green.") paraphrases upstream. Upstream has its own
   multi-line `///` doc (graph.rs:35-42) and a doc on each variant, including CheckFeature's ("Records the feature
   used during query execution ..."). Use upstream's text.

3. src/rustc_passes/fake_doc_items.ts:40-44 (low, query order): upstream's lazy
   `.filter(is_user_visible_dep).chain(once(LOCAL_CRATE))` interleaves `is_user_visible_dep(c)` and
   `fake_doc_items(c)` per crate. The port runs every `is_user_visible_dep` call into an array first, then the
   `fake_doc_items` calls. It has no visible effect today: both are side-effect-free queries without diagnostics,
   and all_fake_doc_items is a rustdoc consumer. Still, other lanes use generators for this (need_type_info
   decision). Iterate lazily (check each crate inside the loop, then LOCAL_CRATE), or add a `// PORT:` note
   explaining why the eager form is equivalent.

4. src/rustc_middle/ty/context.ts:1813-1826 (cosmetic): unlike the gaps-30c precedent (hir_typeck method/probe.ts:253-262,
   which keeps the upstream `#[derive(Diagnostic)] #[diag(..)] struct ..;` as a comment above the hand-written
   derive), the upstream `struct UnusedFeature { feature: Symbol }` with its `#[diag]` is not kept as a comment.
   Also, the three lazy `require`s run on every call, while this module already has memoized lazy-getter helpers
   (`mir()`/`middle_lint()`, context.ts:~3115). Functionally fine (require is cached, and it runs once per
   compilation). Add the upstream struct as a comment. The follow-up that teaches tools/codegen about fn-local
   derives should replace this one too.

No blocking issues. The behavior is verified against the oracle, including the newly reachable unused_features lint path.
