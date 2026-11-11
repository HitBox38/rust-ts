// The one Bun build the gate runs on (lane bun-144; docs/reviews/w40j-audit.md N1). Bun is the subjects' runtime, the oracle of
// the suites whose oracle command is `process.execPath` (their cache keys hash that file), and what the unit tests and the subject
// binary (scripts/lib/subject-bin.ts) are built and run with. A release can change any of these, and on 2026-11-11 the machine's
// Bun moved 1.4.3 -> 1.4.4 without anything in the project noticing. So `bun scripts/gate.ts run` refuses, before any work, to run
// on another build, gate.json records the build it ran on (`bun`), and `accept` refuses a run whose recorded build is not this one.
//
// The gate process keeps the build it started with, but every child it starts (static steps, the Bun-run oracles, source-mode
// subjects, the subject builder) runs the file at `process.execPath` as it is when the child starts, and that file can be replaced
// mid-gate, which is what happened on 2026-11-11 (by content: the file's mtime is the release's, Oct 22, not the day it changed). So the gate also reads that file
// (`readBunExe`: its content hash, and the version and revision it prints) at the start, where it must be the running build
// (`execBunRefusal`), before each suite and at the end. A change stops the run with one `ERROR:` line (`bunExeChange`); gate.json
// `bunExec` records the start and end readings, and `accept` refuses a run whose two differ (`acceptBunExeRefusal`, review bun-144 F1).
// This file imports only node built-ins (scripts/gate-bun.test.ts loads it in the runner unit-test process).
//
// Moving the project to another Bun is a reviewed harness batch: validate it for subject binaries (scripts/lib/subject-bin.ts
// `VALIDATED_BUN` says how), re-check the behaviours the code relies on (`git grep -n 'Bun 1\.'` outside docs/), then change
// `GATE_BUN` here, and only then run the runner unit tests on the new Bun: the tests that drive `gateRun` (gate-power, gate-static-stop,
// gate-probes, gate-bun) run it on the running Bun, which the pin refuses until `GATE_BUN` names it (review bun-144 N3). The next
// gate re-runs the Bun-run oracles (their keys change with the binary).
import { readFileSync } from "node:fs";

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

/**
 * The Bun file at a path, as the gate reads it: the sha1 of its content (what changes when the file is replaced, whatever its
 * mtime says) and the version and short revision it prints (`<bun> --revision`: `1.4.4+38afee6c8`). `error` when the file
 * cannot be read or does not answer as a Bun.
 */
export interface BunExe {
  path: string;
  sha1: string | null;
  version: string | null;
  revision: string | null;
  error?: string;
}

/** Reads the Bun file at `path` (default: the one the gate's children run). */
export function readBunExe(path: string = process.execPath): BunExe {
  let sha1: string | null = null;
  const errors: string[] = [];
  try {
    sha1 = new Bun.CryptoHasher("sha1").update(readFileSync(path)).digest("hex");
  } catch (e) {
    errors.push(`cannot read it (${e instanceof Error ? e.message : String(e)})`);
  }
  let version: string | null = null;
  let revision: string | null = null;
  try {
    const p = Bun.spawnSync([path, "--revision"], { stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH ?? "/usr/bin:/bin" } });
    const m = /^(\d+\.\d+\.\d+\S*)\+([0-9a-f]+)$/.exec(p.stdout.toString().trim());
    if (p.exitCode === 0 && m !== null) [version, revision] = [m[1]!, m[2]!];
    else errors.push(`\`--revision\` printed ${JSON.stringify(p.stdout.toString().trim().slice(0, 80))} (exit ${p.exitCode})`);
  } catch (e) {
    errors.push(`cannot run it (${e instanceof Error ? e.message : String(e)})`);
  }
  return { path, sha1, version, revision, ...(errors.length ? { error: errors.join("; ") } : {}) };
}

/** `version+revision (sha1 12)` of a reading. */
export const showBunExe = (x: BunExe): string => `${x.version ?? "?"}+${x.revision ?? "?"} (sha1 ${x.sha1?.slice(0, 12) ?? "?"})`;

/** Why the gate must not start when the Bun file its children run reads as `exe` while the gate runs on `bun`, or `undefined`. */
export function execBunRefusal(exe: BunExe, bun: BunBuild): string | undefined {
  if (exe.error === undefined && exe.sha1 !== null && exe.version === bun.version && exe.revision !== null && bun.revision.startsWith(exe.revision)) return undefined;
  return `the Bun the gate's children run, ${exe.path}, is ${showBunExe(exe)}${exe.error ? `: ${exe.error}` : ""}, not the gate's own Bun ${showBun(bun)}; start the gate with that file, unchanged`;
}

/** The one `ERROR:` text (without the prefix) for a Bun file that changed between `start` and `now`, seen `where`; `undefined` if the same. */
export function bunExeChange(start: BunExe, now: BunExe, where: string): string | undefined {
  if (now.sha1 !== null && now.sha1 === start.sha1) return undefined;
  return `the Bun file the gate's children run (${start.path}) changed ${where}: ${showBunExe(start)} at the start, now ${showBunExe(now)}${now.error ? ` (${now.error})` : ""}; the run fails, the suites left are not run, and the oracle cache entries the last suite wrote may be keyed to the old build (scripts/difftest.ts \`oracleVersion\` hashes the file once per suite)`;
}

/** gate.json `bunExec`: the Bun file the gate's children ran, read at the start and at the end (or where a change was seen). */
export interface BunExecRecord {
  start: BunExe;
  end: BunExe;
  /** Where the change was seen (`before suite <s>`, `at the end`, ...), when it was. */
  changed?: string;
}

/**
 * Why `gate.ts accept` must refuse a run whose gate.json records `rec`, or `undefined`. A gate.json without `bunExec` is not
 * refused here: its caller says so in a `note:`.
 */
export function acceptBunExeRefusal(runId: string, rec: BunExecRecord | undefined): string | undefined {
  if (rec === undefined) return undefined;
  if (rec.start?.sha1 != null && rec.end?.sha1 === rec.start.sha1) return undefined;
  return `gate run ${runId}: the Bun file its children ran changed during the run (${rec.start ? showBunExe(rec.start) : "?"} at the start, ${rec.end ? showBunExe(rec.end) : "?"} at the end); nothing accepted`;
}
