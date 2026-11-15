// `RUSTC` for cargo under scripts/rg-build.ts (through the shell script it writes; lane harness-m7d, plan-m7 D19). Unlike check-rg's
// scripts/rg-rustc.ts, **every** call goes to the side's compiler (`RGB_COMPILER`, a JSON argv): cargo's probes, build scripts and their
// dependencies, every crate, and the final link of `rg`. So on the port's side the build scripts are compiled by the port and run by
// cargo: the first port-built programs that run during a build.
//
// Each call's stdin and stdout pass through (cargo reads a probe's answer from stdout, and `rustc -` reads stdin); its stderr passes
// through too and is kept, and `<RGB_LOG>/<n>.json` records the crate, `-C metadata`, kind, exit code and argv (lib/rg-build.ts
// `RgBuildCall`). Nothing is appended to the argv: the side's compiler argv already holds what a side needs (the port's `--sysroot`).
// `CARGO_MAKEFLAGS` is dropped from the compiler's environment: cargo's jobserver pipes do not survive this process (Bun does not pass on
// file descriptors past stderr), so rustc would warn that it cannot open them, in every call's stderr. Without it the compiler makes its
// own jobserver, as rustc run by hand does; the port acquires nothing either way (plan-m7 D11).
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { argValue, unitMetadata } from "./lib/rg-check.ts";
import { callKind, type RgBuildCall } from "./lib/rg-build.ts";

const need = (k: string): string => {
  const v = process.env[k];
  if (v === undefined) {
    console.error(`rg-build-rustc: ${k} is not set: this runs under scripts/rg-build.ts`);
    process.exit(2);
  }
  return v;
};

if (import.meta.main) {
  const args = process.argv.slice(2);
  const compiler = JSON.parse(need("RGB_COMPILER")) as string[];
  const log = need("RGB_LOG");
  const { CARGO_MAKEFLAGS: _dropped, ...env } = process.env;
  const p = Bun.spawnSync([...compiler, ...args], { env, stdin: "inherit", stdout: "inherit", stderr: "pipe" });
  const code = p.exitCode ?? 101;
  process.stderr.write(p.stderr);
  // A unique name per call, in the order calls end (time, then pid); the report sorts its lines, so the order is only for reading.
  const id = `${process.hrtime.bigint().toString().padStart(20, "0")}-${process.pid}`;
  writeFileSync(join(log, `${id}.stderr`), p.stderr);
  const call: RgBuildCall = { crate: argValue(args, "--crate-name") ?? "-", metadata: unitMetadata(args), kind: callKind(args), code, args, stderr: `${id}.stderr` };
  writeFileSync(join(log, `${id}.json`), JSON.stringify(call));
  process.exit(code);
}
