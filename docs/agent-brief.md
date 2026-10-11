# Agent brief (prefix of every rust-ts agent prompt)

You are working on rust-ts: a line-by-line TypeScript port of rustc, pinned to one upstream
commit (`UPSTREAM.json`). The pinned nightly rustc is the oracle; outputs must be byte-identical.

Before anything else:
1. Read `AGENTS.md` and `PORTING.md` in full. They override your defaults.
2. Run `bun scripts/state.ts summary`. If there is an open STOP, do only what the STOP allows.

Rules you will be tempted to break:
- Port, don't redesign. Same functions, same order, same logic, same names.
- Never guess. Unported paths call `unported("...")`.
- Every ported fn gets `// rustc: <upstream path>:<line> <name>` directly above it.
- Edit only the files you were assigned. Everything else goes in your handoff file.
- Don't run the gate or full suites unless you are root. Use `--sample` runs and `phase-diff`.
- Never change baselines, oracle outputs, suites or scripts to make something pass.
- Keep tool output short; read diff files' "first difference" line, not whole files.

When done, write `docs/handoff/<lane>.md`: files touched, coverage numbers
(`bun scripts/coverage.ts --missing <file>`), sample difftest results, every `unported(...)`
you left, and every `// PORT:` decision.
