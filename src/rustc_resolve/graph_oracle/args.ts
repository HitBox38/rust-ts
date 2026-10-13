// The `resdump-nocore` suite's rustc arguments (harness/suites.ts), shared by gen.ts and the test.
import { join } from "node:path";

/** Arguments before the file name. `sysroot`: pass `--sysroot <oracle sysroot>` (the probe needs it; the port ignores it). */
export function ARGS(sysroot: boolean): string[] {
  const s: string[] = [];
  if (sysroot) {
    const { oracleSysroot } = require("../../../scripts/lib/oracle.ts") as typeof import("../../../scripts/lib/oracle.ts");
    s.push("--sysroot", oracleSysroot());
  }
  return ["--target", "x86_64-unknown-linux-gnu", ...s, "--edition=2015", "-Zcrate-attr=feature(no_core)", "-Zcrate-attr=no_core"];
}

export function probe_path(): string {
  const data = process.env.RUST_TS_DATA;
  if (data === undefined) throw new Error("ERROR: RUST_TS_DATA is not set");
  return join(data, "target", "probes", "release", "resdump");
}
