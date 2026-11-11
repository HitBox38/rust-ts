// The one Bun build the gate runs on (lane bun-144; docs/reviews/w40j-audit.md N1). Bun is the subjects' runtime, the oracle of
// the suites whose oracle command is `process.execPath` (their cache keys hash that file), and what the unit tests and the subject
// binary (scripts/lib/subject-bin.ts) are built and run with. A release can change any of these, and on 2026-11-11 the machine's
// Bun moved 1.4.3 -> 1.4.4 without anything in the project noticing. So `bun scripts/gate.ts run` refuses, before any work, to run
// on another build, gate.json records the build it ran on (`bun`), and `accept` refuses a run whose recorded build is not this one.
//
// Moving the project to another Bun is a reviewed harness batch: validate it for subject binaries (scripts/lib/subject-bin.ts
// `VALIDATED_BUN` says how), re-check the behaviours the code relies on (`git grep -n 'Bun 1\.'` outside docs/), then change
// `GATE_BUN` here. The next gate re-runs the Bun-run oracles (their keys change with the binary).

/** A Bun build: `Bun.version` and `Bun.revision`. */
export interface BunBuild {
  version: string;
  revision: string;
}

/** The Bun build gates run on (docs/state/history.jsonl, owner decision 2026-11-11). It must be in `VALIDATED_BUN`. */
export const GATE_BUN: BunBuild = { version: "1.4.4", revision: "38afee6c84fcf48c0edb2466aa4b27d287a59c30" };

/** The Bun this process runs on. */
export const runningBun = (): BunBuild => ({ version: Bun.version, revision: Bun.revision });

/** The same build: version and full revision. */
export const sameBun = (a: BunBuild, b: BunBuild): boolean => a.version === b.version && a.revision === b.revision;

/** `version (revision12)`. */
export const showBun = (b: BunBuild): string => `${b.version} (${b.revision.slice(0, 12)})`;

/** Why `gate.ts run` must not start on `bun`, or `undefined`. */
export function gateBunRefusal(bun: BunBuild = runningBun(), pin: BunBuild = GATE_BUN): string | undefined {
  if (sameBun(bun, pin)) return undefined;
  return `the gate runs only on Bun ${showBun(pin)} (scripts/lib/bun-pin.ts GATE_BUN), not on ${showBun(bun)} at ${process.execPath}; run it with that Bun, or move the project to this one in a reviewed harness batch (see scripts/lib/bun-pin.ts)`;
}

/**
 * Why `gate.ts accept` must refuse a run whose gate.json records `recorded`, or `undefined`. A run recorded before gate.json had
 * `bun` is not refused here (`undefined`): its caller says so in a `note:`.
 */
export function acceptBunRefusal(runId: string, recorded: BunBuild | undefined, pin: BunBuild = GATE_BUN): string | undefined {
  if (recorded === undefined || sameBun(recorded, pin)) return undefined;
  return `gate run ${runId} ran on Bun ${showBun(recorded)}, but the gate's Bun is ${showBun(pin)} (scripts/lib/bun-pin.ts GATE_BUN); nothing accepted`;
}
