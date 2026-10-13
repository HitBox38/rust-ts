// Regenerates the oracle fixtures of ../build_reduced_graph.test.ts: runs the `resdump` probe
// (tools/probes/resdump; `bun scripts/probes.ts build resdump`) on every cases/<name>.rs with the
// `resdump-nocore` suite's arguments and writes cases/<name>.resdump.txt (stdout) and
// cases/<name>.stderr (stderr, exit code on the first line).
//   bun src/rustc_resolve/graph_oracle/gen.ts
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ARGS, probe_path } from "./args.ts";

const CASES = join(import.meta.dir, "cases");
const probe = probe_path();
for (const f of readdirSync(CASES).filter((f) => f.endsWith(".rs")).sort()) {
  const name = f.slice(0, -3);
  const r = Bun.spawnSync([probe, ...ARGS(true), f], { cwd: CASES, env: { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" } });
  writeFileSync(join(CASES, `${name}.resdump.txt`), r.stdout);
  writeFileSync(join(CASES, `${name}.stderr`), `exit ${r.exitCode}\n${new TextDecoder().decode(r.stderr)}`);
  console.log(`${name}: exit ${r.exitCode}`);
}
