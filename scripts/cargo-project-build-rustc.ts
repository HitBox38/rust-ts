// `RUSTC` for cargo under scripts/cargo-project-build.ts (through the shell script it writes; lanes harness-m7d, harness-m8a-build; plan-m7
// D19, plan-m8 D8). Unlike check-rg's scripts/rg-rustc.ts, **every** call goes to the side's compiler (`CPB_COMPILER`, a JSON argv): cargo's
// probes, build scripts and their dependencies, every crate, and the final link of the binary. So on the port's side the build scripts are
// compiled by the port and run by cargo: the first port-built programs that run during a build.
//
// Each call's stdin passes through (`rustc -` reads it). Its stdout and stderr pass through too, after it ends: cargo reads a probe's
// answer from stdout. Its stderr is kept, and `<CPB_LOG>/<n>.json` records the crate, `-C metadata`, kind, exit code, argv and the size
// and hash of its stdout (lib/cargo-project-build.ts `BuildCall`), so what the compiler answered cargo is in the report (review harness-m7d
// N3). A compiler killed by a signal exits 101 here, as cargo expects of a failed compiler, and its record names the signal, so the build
// counts as interrupted and leaves no stamp (harness-m7d re-check note 4).
// Nothing is appended to the argv: the side's compiler argv already holds what a side needs (the port's `--sysroot`).
// `CARGO_MAKEFLAGS` is dropped from the compiler's environment: cargo's jobserver pipes do not survive this process (Bun does not pass on
// file descriptors past stderr), so rustc would warn that it cannot open them, in every call's stderr. Without it the compiler makes its
// own jobserver, as rustc run by hand does; the port acquires nothing either way (plan-m7 D11).
import { writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { argValue, unitMetadata } from "./lib/rg-check.ts";
import { callKind, sizeHash, type BuildCall } from "./lib/cargo-project-build.ts";

const need = (k: string): string => {
  const v = process.env[k];
  if (v === undefined) {
    console.error(`cargo-project-build-rustc: ${k} is not set: this runs under scripts/cargo-project-build.ts`);
    process.exit(2);
  }
  return v;
};

if (import.meta.main) {
  const args = process.argv.slice(2);
  const compiler = JSON.parse(need("CPB_COMPILER")) as string[];
  const log = need("CPB_LOG");
  const { CARGO_MAKEFLAGS: _dropped, ...env } = process.env;
  const p = Bun.spawnSync([...compiler, ...args], { env, stdin: "inherit", stdout: "pipe", stderr: "pipe" });
  const code = p.exitCode ?? 101;
  for (let at = 0; at < p.stdout.length; ) at += writeSync(1, p.stdout, at);
  for (let at = 0; at < p.stderr.length; ) at += writeSync(2, p.stderr, at);
  // A unique name per call, in the order calls end (time, then pid); the report sorts its lines, so the order is only for reading.
  const id = `${process.hrtime.bigint().toString().padStart(20, "0")}-${process.pid}`;
  writeFileSync(join(log, `${id}.stderr`), p.stderr);
  const call: BuildCall = {
    crate: argValue(args, "--crate-name") ?? "-",
    metadata: unitMetadata(args),
    kind: callKind(args),
    code,
    ...(p.exitCode === null && p.signalCode ? { signal: String(p.signalCode) } : {}),
    args,
    stderr: `${id}.stderr`,
    stdout: sizeHash(p.stdout),
  };
  writeFileSync(join(log, `${id}.json`), JSON.stringify(call));
  process.exit(code);
}
