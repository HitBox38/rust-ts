// Both sides of `pm-self` (plan-m7 §6, D19; lane harness-m7d): a pm-ui case whose auxiliary crates, proc macros included, are built by
// the side's own compiler, then its main compile by the same compiler. So the port's side loads proc macros the port built.
//
//   bun scripts/pm-self-run.ts --side oracle|subject --dir <case dir> --aux-key <key> --compiler <JSON argv> [--step <JSON>]... -- <main argv...>
//
// - `--step` is one aux build as harness/compiletest.ts plans it for pm-ui (`AuxStep`, in build order): `{ file, args, env }`, `env` being
//   the whole environment the oracle's build of it gets (`auxEnv`). `--aux-key` is the key of pm-ui's oracle-built aux directory for the
//   case (`auxKey`: every source, command and environment of the steps), so the oracle cache key changes with any of them.
// - The aux directory is `<case dir>/aux`, emptied first, written in for the placeholder `@RUST_TS_AUX_DIR@` in the steps' and the main
//   compile's argv. **Both sides use that one path**, one at a time under difftest's case lock (`<case dir>.case.lock`), as it is in the
//   main compile's `-L` and `--extern`, and so in what it may print.
// - Each step runs as harness/compiletest.ts `buildAux` runs the oracle: `<compiler> <args>`, this process's cwd (the upstream checkout),
//   exactly the step's environment, plus this process's `RUST_TS_IMPL` if it has one, so difftest's `--impl shim|stub` self-check reaches
//   the port's aux builds too, not only its main compile (review harness-m7d N5); the oracle's rustc ignores it. Then on stdout `pm-self: aux <file>: exit <n>`, and its stderr on this process's stderr. A step that
//   fails ends the run with its exit code (the port's `unported`, 70, is UNPORTED; its line is in the stderr passed on).
// - Then the main compile: `<compiler> <main argv>`, with this process's cwd, environment and streams (inherited), its exit code this
//   process's. Only a malformed command line exits 2.
import { mkdirSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";

export const AUX_PLACEHOLDER = "@RUST_TS_AUX_DIR@";

export interface PmSelfStep {
  file: string;
  args: string[];
  env: Record<string, string>;
}

export interface PmSelfArgs {
  side: "oracle" | "subject";
  dir: string;
  auxKey: string;
  compiler: string[];
  steps: PmSelfStep[];
  main: string[];
}

/**
 * Parses the command line (see the header); throws on a malformed one. A command with no `--` parses with an empty main argv and no aux key:
 * the gate's probe check (scripts/gate.ts `undeclaredRuns`) reads the compiler of a suite's command made for an empty case. A run needs both.
 */
export function parsePmSelfArgs(argv: readonly string[]): PmSelfArgs {
  const dd = argv.indexOf("--");
  const a: Partial<PmSelfArgs> = { steps: [] };
  const head = dd < 0 ? argv : argv.slice(0, dd);
  for (let i = 0; i < head.length; i += 2) {
    const k = head[i]!;
    const v = head[i + 1];
    if (v === undefined) throw new Error(`${k} has no value`);
    if (k === "--side") {
      if (v !== "oracle" && v !== "subject") throw new Error("--side must be oracle or subject");
      a.side = v;
    } else if (k === "--dir") a.dir = v;
    else if (k === "--aux-key") a.auxKey = v;
    else if (k === "--compiler") {
      const c = JSON.parse(v) as unknown;
      if (!Array.isArray(c) || c.length === 0 || !c.every((x) => typeof x === "string")) throw new Error("--compiler must be a JSON array of strings");
      a.compiler = c as string[];
    } else if (k === "--step") {
      const s = JSON.parse(v) as PmSelfStep;
      if (typeof s.file !== "string" || !Array.isArray(s.args) || typeof s.env !== "object" || s.env === null) throw new Error("--step must be a JSON {file, args, env}");
      a.steps!.push(s);
    } else throw new Error(`unknown option ${k}`);
  }
  if (a.side === undefined || a.dir === undefined || a.compiler === undefined) throw new Error("--side, --dir and --compiler are required");
  return { ...(a as PmSelfArgs), auxKey: a.auxKey ?? "", main: dd < 0 ? [] : argv.slice(dd + 1) };
}

const fill = (args: readonly string[], aux: string): string[] => args.map((x) => x.replaceAll(AUX_PLACEHOLDER, aux));

if (import.meta.main) {
  let a: PmSelfArgs;
  try {
    a = parsePmSelfArgs(process.argv.slice(2));
    if (a.auxKey === "" || a.main.length === 0) throw new Error("a run needs --aux-key and `-- <main argv>`");
  } catch (e) {
    console.error(`ERROR: pm-self-run: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
  const aux = join(a.dir, "aux");
  rmSync(aux, { recursive: true, force: true });
  mkdirSync(aux, { recursive: true });
  for (const s of a.steps) {
    const impl = process.env.RUST_TS_IMPL;
    const r = Bun.spawnSync([...a.compiler, ...fill(s.args, aux)], { env: impl === undefined ? s.env : { ...s.env, RUST_TS_IMPL: impl }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const code = r.exitCode ?? 101;
    const line = Buffer.from(`pm-self: aux ${s.file}: exit ${code}\n${r.stdout.length ? r.stdout.toString("latin1") : ""}`, "latin1");
    for (let at = 0; at < line.length; ) at += writeSync(1, line, at);
    for (let at = 0; at < r.stderr.length; ) at += writeSync(2, r.stderr, at);
    if (code !== 0) process.exit(code);
  }
  const m = Bun.spawnSync([...a.compiler, ...fill(a.main, aux)], { stdin: "ignore", stdout: "inherit", stderr: "inherit" });
  process.exit(m.exitCode ?? 101);
}
