// `RUSTC` for cargo under scripts/rg-check.ts (through the shell script it writes): sends each rustc call to the side being measured,
// and records each compiled unit. Lane harness-m7a, after lane real-crates' wrapper.
//
// - cargo's probes (`-vV`, `-`, `--print`) go to the side's compiler: their answers are in `.rustc_info.json` and steer the build.
// - **A compile that emits `link` (build scripts and their dependencies) goes to the oracle on both sides,** because the port has no codegen
//   yet. These compiles are not compared. A build script's output is the input of the crates that are.
// - Every other compile is a unit: it goes to the side's compiler, with `RG_EXTRA`'s arguments appended (not `RUSTFLAGS`, which cargo would
//   hash into `-C metadata`), its stderr passes through and is kept, and `<RG_LOG>/<crate>-<metadata>.json` records its exit code,
//   argv, cwd and environment.
// The port gets `--sysroot` because it cannot find a sysroot from its own path. Nothing else differs between the sides.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { argValue, classifyCall, unitMetadata, type RgUnit } from "./lib/rg-check.ts";

const need = (k: string): string => {
  const v = process.env[k];
  if (v === undefined) {
    console.error(`rg-rustc: ${k} is not set: this runs under scripts/rg-check.ts`);
    process.exit(2);
  }
  return v;
};

if (import.meta.main) {
  const args = process.argv.slice(2);
  const side = need("RG_SIDE");
  const oracle = [need("RG_ORACLE_RUSTC")];
  const port = [need("RG_BUN"), need("RG_PORT_MAIN"), "--sysroot", need("RG_SYSROOT")];
  const compiler = side === "subject" ? port : oracle;
  const kind = classifyCall(args);
  if (kind !== "unit") {
    const p = Bun.spawnSync([...(kind === "probe" ? compiler : oracle), ...args], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
    process.exit(p.exitCode ?? 101);
  }
  const extra = JSON.parse(need("RG_EXTRA")) as string[];
  const p = Bun.spawnSync([...compiler, ...args, ...extra], { stdin: "ignore", stdout: "inherit", stderr: "pipe" });
  const code = p.exitCode ?? 101;
  process.stderr.write(p.stderr);
  const crate = argValue(args, "--crate-name") ?? "unknown";
  const id = `${crate}-${unitMetadata(args)}`;
  const log = need("RG_LOG");
  writeFileSync(join(log, `${id}.stderr`), p.stderr);
  const unit: RgUnit = { crate, code, args, cwd: process.cwd(), env: Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)), stderr: `${id}.stderr` };
  writeFileSync(join(log, `${id}.json`), JSON.stringify(unit));
  process.exit(code);
}
