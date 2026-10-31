// The subject command of the report suite check-chain (plan-m5 D12; lane harness-m5c; harness/suites.ts): two
// compilers in a row, the port's core and then the oracle's alloc against it.
//
//   bun scripts/chain-run.ts --fresh <file> --first <n> -- <first command (n words)...> <second command...>
//
// - `<file>` (the first command's output) is removed first, so a stale one from an earlier run is never read, and its
//   directory is created.
// - The first command (src/rust_ts/main.ts on library/core with `-o <dir>/libcore.rmeta`) runs with this process's
//   cwd, environment and stdout/stderr (inherited, so its diagnostics are part of the compared output). If it fails,
//   this process exits with its code (70 → UNPORTED, as for any port run) and the second never runs.
// - Then the second command (the oracle rustc on library/alloc, whose `--extern core=` / `-L dependency=` name that
//   file) runs the same way, and its exit code is this process's. scripts/rmeta-run.ts wraps this command, so `-o
//   <file>` lands at the end of the second command.
// - SIGTERM/SIGINT (difftest's timeout, passed on by rmeta-run) are passed on to the running child.
// No output of its own: what it prints is part of the compared output.
import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";

export interface ChainRunArgs {
  fresh: string;
  first: string[];
  second: string[];
}

/** Parses the command line (see the header); throws on a malformed one. */
export function parseChainRunArgs(argv: string[]): ChainRunArgs {
  if (argv[0] !== "--fresh" || argv[1] === undefined || argv[2] !== "--first" || argv[4] !== "--")
    throw new Error("chain-run: usage: --fresh <file> --first <n> -- <first command...> <second command...>");
  const n = Number(argv[3]);
  const rest = argv.slice(5);
  if (!Number.isInteger(n) || n < 1 || n >= rest.length) throw new Error(`chain-run: --first ${argv[3]} must leave both commands non-empty`);
  return { fresh: argv[1], first: rest.slice(0, n), second: rest.slice(n) };
}

const SIGNALS: Record<string, number> = { SIGINT: 2, SIGKILL: 9, SIGTERM: 15 };

/** Runs a child with inherited stdio, passing SIGTERM/SIGINT on; its exit code (128 + signal if it was killed). */
async function child(cmd: string[]): Promise<number> {
  const p = Bun.spawn(cmd, { stdin: "ignore", stdout: "inherit", stderr: "inherit" });
  const pass = (sig: NodeJS.Signals) => () => p.kill(sig);
  const onTerm = pass("SIGTERM");
  const onInt = pass("SIGINT");
  process.on("SIGTERM", onTerm);
  process.on("SIGINT", onInt);
  try {
    const code = await p.exited;
    return p.signalCode ? 128 + (SIGNALS[p.signalCode] ?? 0) : code;
  } finally {
    process.off("SIGTERM", onTerm);
    process.off("SIGINT", onInt);
  }
}

export async function chainRun(a: ChainRunArgs): Promise<number> {
  rmSync(a.fresh, { force: true });
  mkdirSync(dirname(a.fresh), { recursive: true });
  const code = await child(a.first);
  if (code !== 0) return code;
  return child(a.second);
}

if (import.meta.main) {
  let a: ChainRunArgs;
  try {
    a = parseChainRunArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
  process.exit(await chainRun(a));
}
