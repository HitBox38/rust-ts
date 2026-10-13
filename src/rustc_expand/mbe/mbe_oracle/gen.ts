// Regenerates out.json (the mbe-b oracle fixture) by running the rustc-dev probe `mbeprobe`
// (probe/main.rs; build instructions in probe/Cargo.toml.in) over every cases/*.rs.
//
//   bun src/rustc_expand/mbe/mbe_oracle/gen.ts [path/to/mbeprobe]
//
// Default probe path: $RUST_TS_DATA/tmp/mbe-b/probe/target/release/mbeprobe. A case's first lines
// may set `//@ edition: <year>` (default 2024). Each fixture entry records the probe's arguments,
// its event list (stdout JSON), its stderr and its exit code.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = import.meta.dir;
const data = process.env.RUST_TS_DATA ?? readFileSync(join(dir, "../../../../.env.local"), "utf8").match(/RUST_TS_DATA=(.*)/)![1]!;
const probe = process.argv[2] ?? join(data, "tmp/mbe-b/probe/target/release/mbeprobe");

export interface MbeCase {
  name: string;
  edition: string;
  args: string[];
  events: string[];
  stderr: string;
  exit: number;
}

const out: MbeCase[] = [];
for (const f of readdirSync(join(dir, "cases")).filter((f) => f.endsWith(".rs")).sort()) {
  const path = join(dir, "cases", f);
  const src = readFileSync(path, "utf8");
  const edition = /^\/\/@ edition: (\d+)$/m.exec(src)?.[1] ?? "2024";
  const args = ["probe-root.rs", "--edition", edition, "--crate-type", "lib", "--error-format", "human", "--color", "never"];
  const r = Bun.spawnSync([probe, path, ...args], { cwd: dir, env: { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" } });
  const stdout = r.stdout.toString();
  const stderr = r.stderr.toString();
  let events: string[];
  try {
    events = JSON.parse(stdout) as string[];
  } catch {
    console.log(`ERROR: ${f}: probe output is not JSON (exit ${r.exitCode}): ${stderr.split("\n").slice(0, 5).join(" | ")}`);
    process.exitCode = 1;
    continue;
  }
  out.push({ name: f.replace(/\.rs$/, ""), edition, args, events, stderr, exit: r.exitCode ?? -1 });
}
writeFileSync(join(dir, "out.json"), JSON.stringify(out, null, 1) + "\n");
console.log(`${out.length} cases -> out.json`);
