<img src="assets/icon.svg" width="64" height="64" alt="">

# rust-ts

rustc, ported line-by-line to TypeScript, by agents. Yes, really.
The mirror image of [ts-rust](https://github.com/pingdotgg/ts-rust).

| | |
|---|---|
| Upstream pin | `rust-lang/rust@6f5da406b` = `rustc 1.101.0-nightly (2026-10-10)` |
| Milestone | M0–M4 done (harness; lexer/parser; expansion + name resolution; typeck + trait solving; MIR build, borrowck, MIR transforms, const eval). M5 (check core → alloc → std) in progress: core's whole analysis and all 47,734 MIR bodies already match |
| Protected parity | **403,191** cases across 34 suites that match the real compiler byte-for-byte and can never regress |
| Ported | 22,413 / 25,518 in-scope upstream functions (87.8%) |

At 100%: the front end (`rustc_lexer`, `rustc_span`, `rustc_ast`, `rustc_ast_lowering`, `rustc_ast_passes`,
`rustc_builtin_macros`, `rustc_attr_parsing`, `rustc_resolve`), type checking (`rustc_hir_typeck`,
`rustc_hir_analysis`, `rustc_infer`, `rustc_type_ir`, `rustc_next_trait_solver`, `rustc_traits`), plus
`rustc_mir_build`, `rustc_pattern_analysis`, `rustc_symbol_mangling`, and now the borrow checker (`rustc_borrowck`,
including legacy Polonius), `rustc_mir_transform` and `rustc_const_eval`. Nearly done: `rustc_parse`, `rustc_expand`,
`rustc_lint`, `rustc_trait_selection`, `rustc_mir_dataflow` (92%) and `rustc_middle` (91%).

| suite (milestone) | what it compares against the oracle | protected |
|---|---|---|
| `lex`, `tokens`, `escape` (M1) | every token and literal of 25,780 files (tests/ui, library, compiler) | 25,780 each |
| `parse`, `parse-ui` (M1) | `-Zunpretty=ast-tree` on tests/ui; ui/parser diagnostics | 21,523 / 991 |
| `expanded`, `unpretty-expanded`, `resdump` (M2) | macro expansion and name resolution | ~21,470 each |
| `hir-tree`, `unpretty-hir`, `tydump-nocore` (M3) | HIR and type checking | ~21,480 each |
| `tydump-ui`, `thirdump-ui` (M3) | types and THIR on tests/ui | 1,840 / 1,851 |
| `mirdump-ui`, `mirdump-minicore` (M4) | MIR built and checked by the compiler | 1,343 / 46 |
| `borrowck-ui`, `borrowck-ui-report` (M4) | borrow-check results on ui/borrowck + ui/nll (all 960), and five more ui dirs | 960 / 1,276 |
| `mir`, `thir-tree` (M4) | the real `-Zunpretty=mir` (optimized MIR) and `-Zunpretty=thir-tree` | 21,445 / 1,849 |
| `mir-core` (M5) | `-Zunpretty=mir` of all of libcore, one case per MIR body | 47,734 |

Start here: [PLAN.md](PLAN.md) · [AGENTS.md](AGENTS.md) · [PORTING.md](PORTING.md) · [docs/next.md](docs/next.md)

## How it works

- **Line-by-line port.** Every upstream `fn` becomes a TS function in the mirrored file, in the same
  order, carrying a `// rustc: <path>:<line> <name>` marker. `bun scripts/coverage.ts` counts them
  with our own port of `rustc_lexer`. Anything not yet ported throws `unported(...)` (exit 70),
  so the harness never mistakes a guess for a result.
- **The oracle.** The pinned nightly rustc, plus small probe binaries built from the pinned upstream
  crates (`tools/probes`), is the ground truth. Outputs must be byte-identical.
- **The ratchet.** `bun scripts/gate.ts run` = typecheck + unit tests + marker check + full
  differential runs. Cases that ever matched are protected (`harness/baseline/`) and can't be lost.
  Accepting a run requires a clean, committed tree, and the run records the commit it tested.
- **Agents.** A root integrator assigns lanes (git worktrees, a few upstream files each) to porter
  agents. Independent reviewers and a regression auditor check every batch. See [AGENTS.md](AGENTS.md).

## Setup

```sh
bun install
echo RUST_TS_DATA=D:/rust-ts-data > .env.local   # big data dir (upstream checkout, caches)
rustup toolchain install nightly-2026-10-11 --component rust-src
bun scripts/upstream.ts fetch && bun scripts/upstream.ts status
bun scripts/probes.ts build
```

## Everyday commands

```sh
bun scripts/state.ts summary                     # where are we
bun scripts/difftest.ts --suite lex --sample 500 # differential test vs the oracle
bun scripts/phase-diff.ts tests/ui/foo.rs        # first compiler phase that diverges
bun scripts/coverage.ts                          # fns ported per crate
bun scripts/gate.ts run                          # the ratchet (root only)
bun test src                                     # ported upstream unit tests
```

## License

rust-ts is a port of [rustc](https://github.com/rust-lang/rust) and is distributed under the same
terms: either the [MIT license](LICENSE-MIT) or the [Apache License 2.0](LICENSE-APACHE), at your
option. Upstream copyright belongs to The Rust Project Contributors; ported vendor crates keep
their own (MIT/Apache-2.0) terms, and generated Unicode tables are subject to the Unicode license.
