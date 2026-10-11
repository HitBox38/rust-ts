# AGENTS.md — how work happens in rust-ts

Read this, then `PORTING.md`, then run `bun scripts/state.ts summary`. Re-read after a context
reset. If any of them is missing or contradicts another, stop and report.

## 1. Roles

- **Root (integrator)**: one session. Owns the work queue (`docs/next.md`), assigns lanes,
  integrates, runs the gate, accepts revisions, records state. Root may port code but never
  provides the independent verdicts below.
- **Porter lanes**: port assigned upstream files per `PORTING.md`. One lane = a few related
  files (≤ ~3k upstream lines), so each agent stays well under 500k tokens. Bigger work is
  split into chained lanes that hand off through `docs/handoff/<lane>.md`.
- **Fixer lanes**: after a wave lands, root type-checks/tests once and writes one error file
  per TS file; each fixer owns one file.
- **Reviewer** (independent, read-only): checks a batch against upstream: function order,
  logic fidelity, no guessed values, markers correct. Writes a verdict file; never edits code.
- **Regression auditor** (independent, read-only): checks the gate evidence: no lost
  protected cases, no expectation tampering, unrun suites called out.

Every agent prompt begins with the text of `docs/agent-brief.md`.

## 2. The oracle and the ratchet

- The oracle is the pinned nightly rustc (`UPSTREAM.json`), plus probes built from the pinned
  upstream crates (`tools/probes`). If rust-ts and the oracle disagree, rust-ts is wrong.
- **Protected set** = `harness/baseline/<suite>.txt`. It only grows. A revision that loses any
  protected case is not accepted. New passes never offset a loss.
- `bun scripts/gate.ts run` = typecheck + unit tests + marker check + full difftest of every
  protected suite. `bun scripts/gate.ts accept --run <id>` grows the protected set and records
  it in `docs/state/history.jsonl`.
- Never edit oracle outputs, baselines, suite definitions or runner scripts to make a result
  pass. Changes to `harness/` or `scripts/` need their own reviewed batch.
- A **STOP** (`bun scripts/state.ts record stop <reason>`) blocks new features until resolved:
  only diagnosis, regression repair or withdrawal of the bad change.

## 3. Dev loop

1. `bun scripts/state.ts summary` and read `docs/next.md`.
2. Pick the top ready item (or the one assigned to you). Parallel sessions claim work by
   creating `docs/claims/<item>.md` (who/when); delete it when done. Check for an existing
   claim first; if you lose a race, pick something else.
3. Port. Check progress with `bun scripts/coverage.ts --missing <upstream file>`.
4. Find divergences with the fast loop:
   - `bun scripts/difftest.ts --suite <s> --sample 200` (deterministic per `$RUST_TS_AGENT`;
     different agents see different samples, together they cover the suite)
   - `bun scripts/phase-diff.ts <file.rs>` finds the first diverging compiler phase
   - details in `$RUST_TS_DATA/runs/<run>/diffs/`
5. Root integrates, runs the gate, accepts, records, updates `docs/next.md`.

**No questions in goal mode.** If a choice is needed, take the recommended option, record it
with `bun scripts/state.ts record decision <text>`, and continue.

## 4. Output discipline (for agents' context windows)

- Tools print a few summary lines; details go to files under `$RUST_TS_DATA`.
- Failures print one line starting with `ERROR:` so `grep ERROR` finds them.
- Never paste whole diff files or test logs into context; read the `first difference` line.

## 5. Environment

- Windows host with Bun, Node 24, nightly rustc (oracle), TypeScript 7 (`bunx tsc`).
- `RUST_TS_DATA` (in `.env.local`, gitignored) holds the upstream checkout, oracle cache,
  probe builds and run outputs. On this machine it is `D:/rust-ts-data` (C: is nearly full;
  never put large data on C:).
- Linux-only behavior (later milestones) runs in WSL2 Ubuntu.

## 6. Git

- Work on branches; merge with real merges. Never force-push. Never rewrite pushed history.
- One accepted gate run per commit that changes the protected set; mention the run id.
