# Handoff: ice-report (design only)

Branch `t3/plan-ice-report`, based on `c9d3c553`. No port code changed.

## Files touched

- `docs/plan-ice-report.md`: the plan, with decisions D1–D12 for root to record.
- `docs/handoff/ice-report.md`: this file.

## Coverage, unported, PORT decisions

None: no port file changed, so there are no coverage changes, no new `unported(...)` and no `// PORT:` decisions.

## Result

Recommendation: do it, using the existing runtime resolver (`src/rust_ts/track_caller.ts`) plus a replay for JSC tail
calls. Reject the per-call-site codemod and the location table. Cost is about 400 upstream lines, about 150 lines of
glue and 2 harness batches, with no compiler-wide edit.

The blocker covers 118 suite cases (46 test files), not 14: 40 UNSTABLE ICE cases and 78 `UNPORTED: Location::caller`.

Prototype results, thread id masked:

| Configuration | MATCH of 118 | `mir` of 14 |
|---|---|---|
| Hook only, tail calls on, no replay | 13 | 10 |
| Tail calls off | 80 | 14 |
| Replay (same verdict as tail calls off on 118 of 118) | 80 | 14 |
| + `rustc-const:` anchor for `macro_use` | 92 | 14 |
| + `RUST_BACKTRACE=0` on both sides for the 26 compiletest-env cases (D8) | 117 | 14 |

The 118th case needs one `rustc-macro:` marker; that is predicted, not run.

Regression sample: 150 non-ICE cases gave output byte-identical to the unpatched port. This is a sample, not a gate.

## Difftest

No `scripts/difftest.ts` results: the measurements used throwaway scripts with each suite's own argv, env and cwd. A
`check-core` run through difftest with tail calls off was stopped at the 50-minute limit and produced no result.

## For root

- D3 supersedes the 2026-10-13 decision "Location::caller stays unported".
- D8 needs its own reviewer question, because AGENTS.md section 2 forbids editing suite definitions to make a result
  pass. The plan gives the case for and against.
- `docs/next.md` still describes this item as "unblocks 14 mir cases".
- The prototype is not port code. A lane should use it as evidence, not copy it; `docs/plan-ice-report.md` section 6
  lists what it leaves out, notably the message-text check that stops swapped sites printing a wrong location.

## Throwaway files

`$RUST_TS_DATA/tmp/ice-report/` holds all scripts, outputs and the prototype (`proto/`, an 81 MB copy of `src`). It is
safe to delete once the plan is reviewed.
