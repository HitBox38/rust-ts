// One case alone, from source and from its subject binary, timed (lane perf-subject-bin): the measurement behind
// docs/handoff/perf-subject-bin.md, kept so the binary's cost on long cases can be re-measured after a Bun or port change.
//
//   bun scripts/subject-bin-bench.ts --suite <suite> --file <case file or id> [--reps 3] [--modes source,binary]
//                                    [--bin <path>] [--out <tsv>]
//
// Each run is what difftest runs for the case: the suite's subject command (`s.subject([c])`), its cwd (`cwdOf`), the case
// environment (`caseEnv`) with `RUST_TS_IMPL=port`, alone, under `/usr/bin/time -l` (macOS: instructions retired and cycles,
// which a busy machine disturbs far less than wall time). In binary mode the command is the one `subjectCmd` gives, from this
// tree's build (made if needed), or `--bin <path>` instead of it (e.g. a gate's own build). Rounds interleave the modes. Prints
// one line per run (wall, user, sys s, max RSS MB, G instructions, G cycles, exit, output hash, 1-minute load) and the medians;
// `ERROR:` when the modes' outputs differ (exit code, stdout, stderr with a panic's thread id masked). Run it on AC power, on a
// quiet machine, and never while a gate runs.
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { loadavg, tmpdir } from "node:os";
import { join } from "node:path";
import { suite as getSuite, type Case } from "../harness/suites.ts";
import { cwdOf } from "./difftest.ts";
import { hash, parseArgs, run } from "./lib/common.ts";
import { caseEnv } from "./lib/env.ts";
import { BINARY_ENTRIES, SUBJECT_MODE_VAR, type SubjectMode } from "./lib/subject-bin.ts";

/** A panic's thread id differs between any two runs (as scripts/subject-bin-compare.ts masks it). */
export const maskPid = (t: string): string => t.replace(/(thread '[^']*' )\(\d+\)( panicked)/g, "$1(PID)$2");

/** `/usr/bin/time -l` counters from its output file: instructions retired and cycles elapsed (`undefined` where not printed). */
export function timeCounters(text: string): { instructions?: number; cycles?: number } {
  const num = (re: RegExp) => {
    const m = re.exec(text);
    return m === null ? undefined : Number(m[1]);
  };
  return { instructions: num(/(\d+)\s+instructions retired/), cycles: num(/(\d+)\s+cycles elapsed/) };
}

/** The median of `xs` (the mean of the middle two for an even count). */
export function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** `cmd` with its subject prefix (`bun [--preload X] <repo>/<entry>`) replaced by `bin`. */
export function withBinary(cmd: readonly string[], bin: string): string[] {
  const i = cmd.findIndex((w) => BINARY_ENTRIES.some((e) => w.endsWith(`/${e}`)));
  if (i < 0) throw new Error(`no subject entry with a binary in ${cmd.slice(0, 4).join(" ")}`);
  return [bin, ...cmd.slice(i + 1)];
}

if (import.meta.main) {
  const a = parseArgs(process.argv.slice(2));
  if (typeof a.suite !== "string" || typeof a.file !== "string") {
    console.log("usage: bun scripts/subject-bin-bench.ts --suite <suite> --file <case file or id> [--reps 3] [--modes source,binary] [--bin <path>] [--out <tsv>]");
    process.exit(1);
  }
  const s = getSuite(a.suite);
  const want = a.file;
  const cases = s.cases().filter((c: Case) => c.id === want || c.file === want || c.id.endsWith(`/${want}`));
  if (cases.length !== 1) {
    console.log(`ERROR: ${cases.length} cases of ${s.name} match ${want}${cases.length > 1 ? `: ${cases.slice(0, 5).map((c) => c.id).join(", ")}` : ""}`);
    process.exit(1);
  }
  const c = cases[0]!;
  const reps = Number(a.reps ?? 3);
  const modes = String(a.modes ?? "source,binary").split(",") as SubjectMode[];
  const cmdOf = (mode: SubjectMode): string[] => {
    const saved = process.env[SUBJECT_MODE_VAR];
    // `--bin`: the source command with its prefix swapped, so nothing is built.
    const given = mode === "binary" && typeof a.bin === "string" ? a.bin : undefined;
    process.env[SUBJECT_MODE_VAR] = given === undefined ? mode : "source";
    try {
      const cmd = s.subject([c]);
      return given === undefined ? cmd : withBinary(cmd, given);
    } finally {
      if (saved === undefined) delete process.env[SUBJECT_MODE_VAR];
      else process.env[SUBJECT_MODE_VAR] = saved;
    }
  };
  const cmds = new Map(modes.map((m) => [m, cmdOf(m)] as const));
  const env = { ...caseEnv(c.env), RUST_TS_IMPL: "port" };
  const tmp = mkdtempSync(join(tmpdir(), "rts-bench-"));
  const rows = new Map<SubjectMode, { wall: number; user: number; rss: number; gi?: number; out: string }[]>(modes.map((m) => [m, []]));
  console.log(`${s.name} ${c.id}: ${reps} round(s) of ${modes.join(", ")}; ${modes.map((m) => `${m}: ${cmds.get(m)![0]}`).join("; ")}`);
  try {
    for (let r = 0; r < reps; r++) {
      for (const m of modes) {
        const tf = join(tmp, "time.txt");
        const timed = existsSync("/usr/bin/time") && process.platform === "darwin";
        const load = loadavg()[0]!.toFixed(2);
        const p = await run(timed ? ["/usr/bin/time", "-l", "-o", tf, ...cmds.get(m)!] : cmds.get(m)!, { cwd: cwdOf(s), env, timeoutMs: 10 * s.timeoutMs });
        const k = timed ? timeCounters(readFileSync(tf, "utf8")) : {};
        const out = hash(`${p.code}\0${p.stdout}\0${maskPid(p.stderr)}`).slice(0, 12);
        const row = { wall: p.ms / 1000, user: (p.usage?.userMs ?? NaN) / 1000, rss: Math.round((p.usage?.maxRssBytes ?? NaN) / 2 ** 20), gi: k.instructions === undefined ? undefined : k.instructions / 1e9, out };
        rows.get(m)!.push(row);
        const line = [s.name, c.id, m, r, row.wall.toFixed(2), row.user.toFixed(2), ((p.usage?.sysMs ?? NaN) / 1000).toFixed(2), row.rss, row.gi?.toFixed(1) ?? "-", k.cycles === undefined ? "-" : (k.cycles / 1e9).toFixed(1), p.code, p.timedOut ? "timeout" : out, load].join("\t");
        console.log(line);
        if (typeof a.out === "string") appendFileSync(a.out, line + "\n");
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  for (const m of modes) {
    const rs = rows.get(m)!;
    const gis = rs.flatMap((x) => (x.gi === undefined ? [] : [x.gi]));
    console.log(`median ${m}: wall ${median(rs.map((x) => x.wall)).toFixed(2)} s, user ${median(rs.map((x) => x.user)).toFixed(2)} s, max RSS ${median(rs.map((x) => x.rss))} MB${gis.length ? `, ${median(gis).toFixed(1)} G instructions` : ""}`);
  }
  const outs = new Set([...rows.values()].flat().map((x) => x.out));
  if (outs.size > 1) {
    console.log(`ERROR: the runs' outputs differ (${[...outs].join(", ")})`);
    process.exitCode = 1;
  } else console.log(`same output in every run (${[...outs][0]})`);
}
