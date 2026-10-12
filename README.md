<img src="assets/icon.svg" width="64" height="64" alt="">

# rust-ts

rustc, ported line-by-line to TypeScript, by agents. Yes, really.
The mirror image of [ts-rust](https://github.com/pingdotgg/ts-rust).

| | |
|---|---|
| Upstream pin | `rust-lang/rust@6f5da406b` = `rustc 1.101.0-nightly (2026-10-10)` |
| Milestone | M0 done (harness); M1 (lexer → parser → `-Zunpretty=ast-tree`) in progress |
| Protected parity | **51,581** cases that match the real compiler byte-for-byte and can never regress |
| Ported | 1,196 / 25,517 upstream functions (4.7%) |

Crates so far: `rustc_lexer`, `rustc_span` (incl. SourceMap, hygiene, the 2,434-symbol interner),
`rustc_error_messages` at 100%; `rustc_errors` 60%; `rustc_ast` 30% (all types + Debug generated, tokens,
token streams, literals); vendored `unicode-ident`, `unicode-properties`, `unicode-width`,
`rustc-literal-escaper`, `bitflags`.

| suite | what it compares against the oracle | protected |
|---|---|---|
| `lex` | every token of 25,780 files (tests/ui, library, compiler) vs the real `rustc_lexer` | 25,780 |
| `escape` | every literal's unescaped value / error vs `rustc-literal-escaper` | 25,780 |
| `escape-synthetic` | generated corpus hitting every literal mode and escape error | 11 |
| `symbols` | the predefined symbol table vs a probe linking upstream `rustc_span` | 10 |
| `parse` | `-Zunpretty=ast-tree` on tests/ui (the M1 goal) | 0 (unported) |

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
