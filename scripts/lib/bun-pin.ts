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
// Readings at suite boundaries miss a swap that is undone before the next one (review bun-144-recheck F1-r: swap, start a child,
// swap back). So `gate.ts run` first clones its Bun file (`cloneBunFile`: APFS `cp -c`, which shares the blocks and costs no disk;
// a plain copy where clonefile is unavailable, with a note) into a directory of its own under `$RUST_TS_DATA/gate-bun/` (with
// `owner.json`; `pruneGateBunDirs` removes only those whose gate is gone), checks the clone (`cloneRefusal`) and re-runs itself
// from it with that directory, which also holds a `bunx` link, first on PATH: then `process.execPath`, and every bare `bun` or
// `bunx`, of the gate and of every child is a file only the gate knows, removed at the end (reviews recheck F1-r, recheck2
// F1-rr, N3). The readings stay, now of the clone, as a belt. gate.json `bunClone` records it, and `accept` refuses a run that did
// not run from one (`acceptBunCloneRefusal`). A subject binary embeds the Bun that built it, so the gate also refuses a build
// whose builder Bun is not its own (`builtByRefusal`).
// This file imports only node built-ins (scripts/gate-bun.test.ts loads it in the runner unit-test process).
//
// Moving the project to another Bun is a reviewed harness batch: validate it for subject binaries (scripts/lib/subject-bin.ts
// `VALIDATED_BUN` says how), re-check the behaviours the code relies on (`git grep -n 'Bun 1\.'` outside docs/), then change
// `GATE_BUN` here, and only then run the runner unit tests on the new Bun: the tests that drive `gateRun` (gate-power, gate-static-stop,
// gate-probes, gate-bun) run it on the running Bun, which the pin refuses until `GATE_BUN` names it (review bun-144 N3). The next
// gate re-runs the Bun-run oracles (their keys change with the binary).
import { chmodSync, copyFileSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

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

/** `s` as one word of a POSIX shell command: single-quoted, each `'` written `'\''`. */
export const shellQuote = (s: string): string => `'${s.replaceAll("'", "'\\''")}'`;

/**
 * The command that lists the oracle cache entries born after `since` (an ISO time): macOS `/usr/bin/find` (BSD; it parses
 * `YYYY-MM-DD HH:MM:SS UTC`), run it as is to see them, with ` -delete` appended to remove them. It changes into the cache first
 * and walks only `.` from there, with the path quoted, so it can act nowhere else (if the `cd` fails, nothing runs; review
 * bun-144-recheck2 N5).
 */
export function bornSinceCommand(cacheDir: string, since: string): string {
  const t = new Date(since).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
  return `cd ${shellQuote(cacheDir)} && /usr/bin/find . -type f -newerBt '${t}'`;
}

/**
 * The one `ERROR:` text (without the prefix) for a Bun file that changed between `start` and `now`, seen `where`; `undefined` if
 * the same. `cache`: the oracle cache and the time of the last reading that was still `start`, so the text names exactly what to
 * delete (the entries born since then may hold the other build's output under this build's key: scripts/difftest.ts
 * `oracleVersion` hashes the file once per suite).
 */
export function bunExeChange(start: BunExe, now: BunExe, where: string, cache?: { dir: string; since: string }): string | undefined {
  if (now.sha1 !== null && now.sha1 === start.sha1) return undefined;
  const purge = cache === undefined ? "" : `; delete the oracle cache entries born since the last good reading (${cache.since}): \`${bornSinceCommand(cache.dir, cache.since)} -delete\` (without \`-delete\` it lists them)`;
  return `the Bun file the gate's children run (${start.path}) changed ${where}: ${showBunExe(start)} at the start, now ${showBunExe(now)}${now.error ? ` (${now.error})` : ""}; the run fails and the suites left are not run${purge}`;
}

/** gate.json `bunClone`: the gate's private copy of its Bun, which it and every child ran. */
export interface BunClone {
  /** The copy (`process.execPath` of the gate and its children). */
  path: string;
  /** The Bun file it was made from. */
  from: string;
  sha1: string;
  /** `clonefile` (APFS `cp -c`: no disk cost) or `copy` (a plain copy where clonefile failed). */
  how: "clonefile" | "copy";
  /** The pid of the first process, which made the copy: the second process's parent. */
  parent: number;
}

/** Copies the Bun file `src` to `dst` as an APFS clone (`cp -c`); a plain copy if that fails. Returns which, and why not a clone. */
export function cloneBunFile(src: string, dst: string, cp: readonly string[] = ["/bin/cp", "-c"]): { how: "clonefile" | "copy"; why?: string } {
  let why: string;
  try {
    const p = Bun.spawnSync([...cp, src, dst], { stdout: "pipe", stderr: "pipe" });
    if (p.exitCode === 0) return { how: "clonefile" };
    why = `${cp.join(" ")} exited ${p.exitCode}: ${p.stderr.toString().trim().slice(0, 200)}`;
  } catch (e) {
    why = `${cp.join(" ")} failed: ${e instanceof Error ? e.message : String(e)}`;
  }
  copyFileSync(src, dst);
  chmodSync(dst, 0o755);
  return { how: "copy", why };
}

/** Why the clone read as `clone` must not stand in for the original read as `orig` (the gate's own Bun is `bun`), or `undefined`. */
export function cloneRefusal(orig: BunExe, clone: BunExe, bun: BunBuild): string | undefined {
  const notBun = execBunRefusal(clone, bun);
  if (notBun === undefined && clone.sha1 === orig.sha1) return undefined;
  return `the gate's copy of its Bun, ${clone.path}, reads as ${showBunExe(clone)}${clone.error ? ` (${clone.error})` : ""}, not as ${orig.path}, ${showBunExe(orig)}`;
}

/** Why `accept` must refuse a run whose gate.json records `clone`: `null` (a run not started through `gate.ts run`); absent: let through. */
export function acceptBunCloneRefusal(runId: string, clone: BunClone | null | undefined): string | undefined {
  if (clone !== null) return undefined;
  return `gate run ${runId} did not run from a private copy of its Bun (gate.json \`bunClone\` is null: it was not started by \`gate.ts run\`); nothing accepted`;
}

/**
 * Why the gate must refuse subject binaries built by another Bun than `bun` (a binary embeds its builder's runtime), or
 * `undefined`. `sha1`: the gate's Bun file's content; a build that records its builder's (`meta.json` `bun.sha1`) must match it.
 */
export function builtByRefusal(bins: readonly { entry: string; hash: string; bun: (BunBuild & { sha1?: string }) | undefined }[], bun: BunBuild, sha1?: string): string | undefined {
  const bad = bins.filter((b) => b.bun === undefined || !sameBun(b.bun, bun) || (sha1 !== undefined && b.bun.sha1 !== undefined && b.bun.sha1 !== sha1));
  if (bad.length === 0) return undefined;
  return `subject binary ${bad.map((b) => `${b.entry} (${b.hash.slice(0, 12)}, built by Bun ${b.bun ? `${showBun(b.bun)}${b.bun.sha1 ? ` sha1 ${b.bun.sha1.slice(0, 12)}` : ""}` : "unknown"})`).join(", ")} was not built by the gate's Bun ${showBun(bun)}: it embeds its builder's runtime; remove the build and re-run the gate`;
}

/** gate.json `bunExec`: the Bun file the gate's children ran, read at the start and at the end (or where a change was seen). */
export interface BunExecRecord {
  start: BunExe;
  end: BunExe;
  /** Where the change was seen (`before suite <s>`, `at the end`, ...), when it was. */
  changed?: string;
  /** When the file last read as `start` (the start, or the last unchanged reading). */
  goodAt?: string;
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

/** Whether process `pid` is alive (EPERM: it is, under another user). */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Removes the run directories under `root` whose first process is gone (`owner.json`'s pid is not alive), and half-made ones (no
 * `owner.json`) older than 10 minutes; never one a live gate holds (review bun-144-recheck2 N3). Returns what it removed.
 */
export function pruneGateBunDirs(root: string, now: number = Date.now()): string[] {
  const removed: string[] = [];
  for (const name of existsSync(root) ? readdirSync(root) : []) {
    const dir = join(root, name);
    let owner: { pid?: number } | undefined;
    try {
      owner = JSON.parse(readFileSync(join(dir, "owner.json"), "utf8")) as { pid?: number };
    } catch {
      owner = undefined;
    }
    const stale = owner === undefined ? now - statSync(dir).mtimeMs > 600_000 : typeof owner.pid !== "number" || !alive(owner.pid);
    if (stale) {
      rmSync(dir, { recursive: true, force: true });
      removed.push(dir);
    }
  }
  return removed;
}

