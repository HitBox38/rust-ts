<img src="assets/icon.svg" width="64" height="64" alt="">

# rust-ts

rustc, ported line-by-line to TypeScript, by agents. Yes, really.
The mirror image of [ts-rust](https://github.com/pingdotgg/ts-rust).

| | |
|---|---|
| Upstream pin | `rust-lang/rust@6f5da406b` = `rustc 1.101.0-nightly (2026-10-10)` |
| Milestone | M0 done (harness); M1 in progress |
| Lexer parity | **25,780 / 25,780** files (tests/ui, library, compiler) vs the real `rustc_lexer` |
| Ported | 61 / 25,517 upstream functions |

Start here: [PLAN.md](PLAN.md) · [AGENTS.md](AGENTS.md) · [PORTING.md](PORTING.md) · [docs/next.md](docs/next.md)

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
