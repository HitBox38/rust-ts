<img src="assets/icon.svg" width="64" height="64" alt="">

# rust-ts

rustc, ported line-by-line to TypeScript, by agents. Yes, really.
The mirror image of [ts-rust](https://github.com/pingdotgg/ts-rust).

| | |
|---|---|
| Upstream pin | `rust-lang/rust@6f5da406b` = `rustc 1.101.0-nightly (2026-10-10)` |
| Milestone | M0–M6 done (harness; lexer/parser; expansion + name resolution; typeck + trait solving; MIR build, borrowck, MIR transforms, const eval; check core → alloc → std; running programs through a port of the pinned nightly's Miri). **The crate metadata (.rmeta) of core, alloc and std is byte-identical to rustc's.** **Real programs run: 3,473 of 3,478 run-pass programs and 294 of 294 run-fail programs match the real Miri, as do 337 of 360 of Miri's own tests.** Next: M7 (text LLVM IR → clang). **Proc macros run: oracle-built proc-macro dylibs load into the port and match rustc on 279/282 ui cases.** |
| Protected parity | **534,012** cases across 52 suites that match the real compiler byte-for-byte and can never regress |
| Ported | 24,230 / 27,053 in-scope upstream functions (89.6%; Miri 1,504 / 1,535) |

At 100%: the front end (`rustc_lexer`, `rustc_span`, `rustc_ast`, `rustc_ast_lowering`, `rustc_ast_passes`,
`rustc_builtin_macros`, `rustc_attr_parsing`, `rustc_resolve`), type checking (`rustc_hir_typeck`,
`rustc_hir_analysis`, `rustc_infer`, `rustc_type_ir`, `rustc_next_trait_solver`, `rustc_traits`), plus
`rustc_mir_build`, `rustc_pattern_analysis`, `rustc_symbol_mangling`, and now the borrow checker (`rustc_borrowck`,
including legacy Polonius), `rustc_mir_transform` and `rustc_const_eval`. Nearly done: `rustc_parse`, `rustc_expand`,
`rustc_lint`, `rustc_trait_selection`, `rustc_mir_dataflow` (92%) and `rustc_middle` (91%).

| suite (milestone) | what it compares against the oracle | protected |
|---|---|---|
| `lex`, `tokens`, `escape` (M1) | every token and literal of 25,842 files (tests/ui, library, compiler) | 25,842 each |
| `parse`, `parse-ui` (M1) | `-Zunpretty=ast-tree` on tests/ui; ui/parser diagnostics | 21,523 / 991 |
| `expanded`, `unpretty-expanded`, `resdump` (M2) | macro expansion and name resolution | ~21,500 each |
| `hir-tree`, `unpretty-hir`, `tydump-nocore` (M3) | HIR and type checking | ~21,500 each |
| `tydump-ui`, `thirdump-ui` (M3) | types and THIR on tests/ui | 1,840 / 1,851 |
| `mirdump-ui`, `mirdump-minicore` (M4) | MIR built and checked by the compiler | 1,343 / 46 |
| `borrowck-ui`, `borrowck-ui-report` (M4) | borrow-check results on ui/borrowck + ui/nll (all 960), and five more ui dirs | 960 / 1,276 |
| `mir`, `thir-tree` (M4) | the real `-Zunpretty=mir` (optimized MIR) and `-Zunpretty=thir-tree` | 21,508 / 1,849 |
| `mir-core` (M5) | `-Zunpretty=mir` of all of libcore, one case per MIR body | 47,734 |
| `check-core`, `rmeta-core` (M5) | libcore's `.rmeta` byte for byte (+ stderr/exit), and section by section through an rmeta dump probe | 1 / 82,338 |
| `check-ui`, `rmeta-ui` (M5) | the same on 730 small lib crates (tests/ui auxiliary crates) | 730 / 730 |
| `check-alloc`, `rmeta-alloc`, `mir-alloc` (M5) | liballoc checked against the port's own core: `.rmeta` bytes, its sections, and its MIR | 1 / 14,678 / 3,734 |
| `check-std`, `rmeta-std`, `mir-std` (M5) | libstd with its 13 dependencies (built by the oracle): the same | 1 / 18,196 / 5,204 |
| `pm-ui`, `pm-expanded` (M6) | tests/ui proc-macro cases with real proc-macro dylibs (built by the oracle, loaded through `bun:ffi`): diagnostics, and `-Zunpretty=expanded` | 279 / 280 |
| `miri-hello`, `run-pass-miri` + heavy, `run-fail-miri` (M6) | real programs: the port of the pinned nightly's Miri runs them, stdout + stderr + exit against the real Miri (std hello world; tests/ui run-pass and run-fail) | 1 / 3,473 of 3,478 / 294 of 294 |
| `miri-pass` + heavy (M6) | Miri's own test suite (tests/pass, tests/panic), Stacked Borrows revisions | 337 of 360 |

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
rustup toolchain install nightly-2026-10-11 --profile minimal --component rustc-dev,llvm-tools --target x86_64-unknown-linux-gnu
# the oracle's components must equal UPSTREAM.json rust.components (no rust-src: it changes rustc's diagnostics)
bun scripts/upstream.ts fetch && bun scripts/upstream.ts status
bun scripts/probes.ts build
# M6 Miri oracle: Miri + rust-src in a separate RUSTUP_HOME under $RUST_TS_DATA (never on the oracle toolchain),
# plus the Miri sysroot for x86_64-unknown-linux-gnu; idempotent, `bun scripts/miri.ts status` checks it
bun scripts/miri.ts setup
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
