# rust-ts: plan

rustc — compiler, type checker, borrow checker, then the toolchain — ported to TypeScript.
The mirror image of [ts-rust](https://github.com/pingdotgg/ts-rust) (TypeScript's compiler ported to Rust).

## 1. What we copy from prior agent-built compilers

- **ts-rust, attempt 1** (GPT-5.6 Sol / GPT-6 Astra, ~$400k, 1.3M lines, stalled at ~84%): built
  breadth before a parity harness existed; hundreds of unverifiable commits.
- **ts-rust, attempt 2** (Opus 5.5, ~$24k, 2 weeks, 181,711 tests passing): a line-by-line port of a
  pinned upstream commit under a strict contract (`PORTING.md`), one file per agent, `unported!()`
  instead of guesses, independent reviewer + regression auditor, a ratcheting protected test set.
- **Anthropic's C compiler** (16 agents, ~$20k): lock-file task claims, a known-good compiler as
  the oracle to split monolithic tasks, terse grep-able output, deterministic per-agent test sampling.

Lessons: an executable oracle + huge test corpus; port, don't design; harness before code;
narrow measurable milestones; a ratchet that never goes backwards.

## 2. Size (measured at the pin)

|                  | typescript-go (ts-rust's source) | rustc (ours) |
|---|---|---|
| source           | ~312k lines Go | ~881k lines Rust, 80 crates (64 in scope, 25,517 fns) |
| must also handle | lib.d.ts | libcore 177k lines + alloc + std |
| tests            | 181k Go tests | tests/ui: 21.5k files, 13.7k `.stderr` baselines |

## 3. Oracle

- Pinned nightly `rustc 1.101.0-nightly (6f5da406b 2026-10-10)`; sources at the same commit.
- Per-phase dumps: `-Zunpretty=ast-tree | ast-tree,expanded | hir-tree | thir-tree | mir`,
  so `scripts/phase-diff.ts` names the first diverging phase.
- Probes (`tools/probes`): small Rust programs linked against pinned upstream crates to dump
  internals the CLI does not expose (token streams, unicode tables, type definitions).
- Later: Miri as an execution oracle; crates.io corpus for real-world `cargo check` parity.

## 4. Scope decisions

- Port everything from lexer through MIR + const eval. Excluded crates: `harness/scope.json`
  (LLVM/GCC/Cranelift backends, incremental, parallel frontend, stable-MIR, proc-macro crates
  that tools/codegen replaces).
- Run programs **before** codegen: const eval + Miri-style shims = an interpreter. Proc macros
  are interpreted too (no dylib loading).
- Backend later: textual LLVM IR → system clang. Maybe a direct Wasm backend after.
- Target `x86_64-unknown-linux-gnu` first. Host-independent phases run on Windows; Linux-only
  behaviour in WSL2.
- Runtime Bun; typecheck with TypeScript 7 (native `tsc`).

## 5. Milestones (a gate each; no milestone starts before the previous gate passes)

| | Milestone | Gate | Status |
|---|---|---|---|
| M0 | Harness | shim scores 100%, stub 0% | **done** |
| M1 | Lexer, parser, AST, error emitter | `lex` 100%; `parse` (`-Zunpretty=ast-tree`) on tests/ui; ui/parser stderr | **done** 2026-10-13: lex 25,780/25,780; parse 21,523/21,526 (3 oracle timeouts); parse-ui 991/991 |
| M2 | Expansion + name resolution | `ast-tree,expanded` parity; ui/macros, ui/resolve | **done** 2026-10-14: expanded 21460, unpretty-expanded 21460, resdump 21470 (M2b) |
| M3 | Typeck + trait solving on `#![no_core]` (cg_clif's mini_core.rs) | hir-tree / thir-tree; ui/typeck, ui/traits | **done** 2026-10-22: tydump-nocore 21116, tydump/thirdump-minicore 45/46, tydump-ui 1603, thirdump-ui 1596 (rustc_dump subset → M4c, plan-m4 D1) |
| M4 | MIR build, borrowck, MIR transforms | `-Zunpretty=mir`; ui/borrowck, ui/nll | in progress (gate 2026-10-29: mir 20968, thir-tree 1823, borrowck-ui 960/960, borrowck-ui-report 1173, mirdump-ui 1340, mirdump-minicore 46/46) |
| M5 | Check core → alloc → std | zero diagnostics, matching metadata-level behaviour |
| M6 | Interpreter (const eval + shims) | std hello world runs; run-pass tests; proc macros |
| M7 | Text LLVM IR → clang | run-pass parity; ripgrep builds |
| M8 | cargo-ts, rustfmt-ts, clippy-ts | each tool's upstream tests |
| M9 | Ouroboros | rust-ts compiles tsc-rs; that tsc-rs type-checks rust-ts |

## 6. Process

`AGENTS.md` (roles, ratchet, dev loop), `PORTING.md` (the contract), `docs/agent-brief.md`
(prompt prefix), `docs/next.md` (work queue), `docs/state/` (state + append-only history).

## 7. Budget and kill switches

ts-rust ported ~312k lines for ~$24k. We port ~650k in the harder direction: guess
$50k–150k API-equivalent; honestly unknown. Checkpoint after M1: if `parse` parity is under 95%
after ~$2–3k of parser work, the contract or harness is wrong — fix that, not the code.

## 8. M0 findings

- The oracle's unicode-ident is Unicode 17; JS engines may lag. All unicode tables are therefore
  generated from the oracle (`tools/gen-unicode.ts`), never from JS regex properties.
- rustc's `-Zunpretty=ast-tree` is derived-`Debug` output, including spans/NodeIds, so M1 needs
  exact AST *shapes* and exact `Debug`. Hand-writing that for rustc_ast is error-prone: generate
  types + Debug from upstream definitions (`docs/next.md` items 1–2).
- Harness bug found and fixed on day one: identical file contents at different paths shared an
  oracle cache entry. The shim/stub self-check plus a full-corpus run caught it immediately.
