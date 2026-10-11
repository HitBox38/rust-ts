// The oracle is the pinned nightly rustc (plus small probe binaries built from the
// pinned upstream sources, see tools/probes). Oracle results are deterministic, so
// they are cached by (command, input bytes, pin).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ORACLE_CACHE, PIN, die, ensureDir, hash, run, type ProcResult } from "./common.ts";

let verified = false;

export async function verifyOraclePin(): Promise<void> {
  if (verified) return;
  const r = await run(["rustc", `+${PIN.toolchain}`, "-vV"]);
  const m = /commit-hash: (\w+)/.exec(r.stdout);
  if (r.code !== 0 || !m) die(`cannot run oracle rustc +${PIN.toolchain}: ${r.stderr.trim()}`);
  if (m[1] !== PIN.commit) {
    die(`oracle toolchain '${PIN.toolchain}' is ${m[1]}, pin is ${PIN.commit}; run: rustup toolchain install ${PIN.nightlyName}`);
  }
  verified = true;
}

export function oracleRustcCmd(args: string[]): string[] {
  return ["rustc", `+${PIN.toolchain}`, ...args];
}

export interface Outcome {
  stdout: string;
  stderr: string;
  code: number;
  timedOut: boolean;
}

/** Run an oracle command; `inputs` are files whose bytes key the cache. */
export async function oracle(cmd: string[], cwd: string, inputs: string[], timeoutMs = 60_000): Promise<Outcome & { cached: boolean }> {
  const key = hash(JSON.stringify([PIN.commit, cmd, inputs.map((f) => hash(readFileSync(join(cwd, f))))]));
  const path = join(ensureDir(join(ORACLE_CACHE, key.slice(0, 2))), key + ".json");
  if (existsSync(path)) return { ...JSON.parse(readFileSync(path, "utf8")), cached: true };
  const r: ProcResult = await run(cmd, { cwd, timeoutMs });
  const out: Outcome = { stdout: r.stdout, stderr: r.stderr, code: r.code, timedOut: r.timedOut };
  if (!r.timedOut) writeFileSync(path, JSON.stringify(out));
  return { ...out, cached: false };
}
