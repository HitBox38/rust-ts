// Compares two `difftest --raw-subject` directories (lane subject-bin): the same cases run with RUST_TS_SUBJECT=source and
// RUST_TS_SUBJECT=binary, process by process, byte for byte.
//
//   bun scripts/subject-bin-compare.ts <source dir> <binary dir> [--out <file>]
//
// A process record (scripts/difftest.ts `runSubjectProcess`) holds the command, exit code, timeout, stdout and stderr of one
// subject process. Its command is compared with the source side's `bun [--preload <repo>/X] <repo>/<entry>` written as the
// binary side's `<subject:entry>`; everything after it must be equal. stdout and exit code must be equal byte for byte; stderr
// too, except a panic's thread id (`thread '<name>' (<pid>) panicked`), the process id that differs between any two runs, which
// is counted apart (`pid-masked`). A process that timed out on either side is not compared (`timed out`). Prints one summary
// line, and `ERROR:` with the first difference of each differing process (all of them with `--out`); exit 1 if any differs.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "./lib/common.ts";
import { BINARY_ENTRIES } from "./lib/subject-bin.ts";

interface RawRecord {
  suite: string;
  ids: string[];
  attempt: number;
  cmd: string[];
  code: number;
  timedOut: boolean;
  ms: number;
  stdout: string;
  stderr: string;
}

/** The command with each `bun [--preload <repo>/X] <repo>/<entry>` of a binary entry written `<subject:entry>`. */
export function normalizeCmd(cmd: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < cmd.length; i++) {
    const w = cmd[i]!;
    const entry = BINARY_ENTRIES.find((e) => w === `<repo>/${e}`);
    if (entry !== undefined) {
      // Drop the bun (and its `--preload <file>`) just before it.
      if (out.length >= 3 && out[out.length - 2] === "--preload" && out[out.length - 1]!.startsWith("<repo>/")) out.splice(out.length - 3, 3);
      else if (out.length >= 1 && /(^|\/)bun$/.test(out[out.length - 1]!)) out.pop();
      out.push(`<subject:${entry}>`);
    } else out.push(w);
  }
  return out;
}

export const maskPid = (t: string): string => t.replace(/(thread '[^']*' )\(\d+\)( panicked)/g, "$1(PID)$2");

/** The first line where two texts differ, shown. */
export function firstDifference(a: string, b: string): string {
  const al = a.split("\n");
  const bl = b.split("\n");
  for (let i = 0; i < Math.max(al.length, bl.length); i++) {
    if (al[i] !== bl[i]) return `line ${i + 1}: source ${JSON.stringify((al[i] ?? "(none)").slice(0, 200))}, binary ${JSON.stringify((bl[i] ?? "(none)").slice(0, 200))}`;
  }
  return "same lines";
}

export type Verdict = { kind: "same" | "pid-masked" | "timed out" } | { kind: "differs"; why: string };

export function compareRecords(src: RawRecord, bin: RawRecord): Verdict {
  if (src.timedOut || bin.timedOut) return { kind: "timed out" };
  const sc = normalizeCmd(src.cmd);
  const bc = normalizeCmd(bin.cmd);
  if (JSON.stringify(sc) !== JSON.stringify(bc)) return { kind: "differs", why: `command: source ${JSON.stringify(sc).slice(0, 300)}, binary ${JSON.stringify(bc).slice(0, 300)}` };
  if (src.code !== bin.code) return { kind: "differs", why: `exit ${src.code} vs ${bin.code}` };
  if (src.stdout !== bin.stdout) return { kind: "differs", why: `stdout ${firstDifference(src.stdout, bin.stdout)}` };
  if (src.stderr === bin.stderr) return { kind: "same" };
  if (maskPid(src.stderr) === maskPid(bin.stderr)) return { kind: "pid-masked" };
  return { kind: "differs", why: `stderr ${firstDifference(src.stderr, bin.stderr)}` };
}

if (import.meta.main) {
  const a = parseArgs(process.argv.slice(2));
  const [srcDir, binDir] = a._;
  if (srcDir === undefined || binDir === undefined) {
    console.log("usage: bun scripts/subject-bin-compare.ts <source dir> <binary dir> [--out <file>]");
    process.exit(1);
  }
  const read = (dir: string) => new Map(readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => [f, JSON.parse(readFileSync(join(dir, f), "utf8")) as RawRecord]));
  const S = read(srcDir);
  const B = read(binDir);
  const counts: Record<string, number> = { same: 0, "pid-masked": 0, "timed out": 0, differs: 0, missing: 0 };
  const lines: string[] = [];
  let srcMs = 0;
  let binMs = 0;
  for (const f of [...new Set([...S.keys(), ...B.keys()])].sort()) {
    const s = S.get(f);
    const b = B.get(f);
    if (s === undefined || b === undefined) {
      counts.missing!++;
      lines.push(`ERROR: ${f} (${(s ?? b)!.ids.join(", ").slice(0, 200)}): only the ${s ? "source" : "binary"} side ran this process`);
      continue;
    }
    srcMs += s.ms;
    binMs += b.ms;
    const v = compareRecords(s, b);
    counts[v.kind]!++;
    if (v.kind === "differs") lines.push(`ERROR: ${s.suite} ${s.ids.join(", ").slice(0, 200)} (attempt ${s.attempt}): ${v.why}`);
  }
  if (typeof a.out === "string") writeFileSync(a.out, lines.join("\n") + (lines.length ? "\n" : ""));
  for (const l of lines.slice(0, 5)) console.log(l);
  if (lines.length > 5) console.log(`... ${lines.length - 5} more${typeof a.out === "string" ? ` in ${a.out}` : ""}`);
  console.log(
    `processes=${S.size}/${B.size} ${Object.entries(counts).map(([k, n]) => `${k.replace(" ", "-")}=${n}`).join(" ")} subject-seconds source=${(srcMs / 1000).toFixed(1)} binary=${(binMs / 1000).toFixed(1)}`,
  );
  process.exitCode = counts.differs! + counts.missing! > 0 ? 1 : 0;
}
