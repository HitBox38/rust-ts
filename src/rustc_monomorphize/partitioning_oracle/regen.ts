// Rewrites the committed oracle output of partitioning.oracle.test.ts (lane mono-partition; not a port).
//   bun src/rustc_monomorphize/partitioning_oracle/regen.ts [case-name...]
//
// For each case of common.ts, oracle/<case>.txt holds what the pinned rustc prints: its exit code, its `-Zprint-mono-items`
// lines, its stderr and its `-Zdump-mono-stats` file. Linking uses `/usr/bin/true`: `x86_64-unknown-linux-gnu`'s linker is
// not on this host, and partitioning has finished by then.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { all_cases, build_aux, clean_env, common_args, fresh_dir, HERE, normalize, render, RUSTC } from "./common.ts";

const only = process.argv.slice(2);
const cases = all_cases().filter((c) => only.length === 0 || only.includes(c.name));
build_aux(cases);
for (const c of cases) {
  const out = fresh_dir(`oracle-${c.name}`);
  const incr = c.incremental ? [`-Cincremental=${join(out, "incr")}`] : [];
  const r = Bun.spawnSync([...RUSTC, ...common_args(c, out, "oracle"), ...incr, "-Clinker=/usr/bin/true"], { env: clean_env(), stdout: "pipe", stderr: "pipe" });
  const dump_path = c.dump === undefined ? undefined : join(out, "dump", c.dump);
  const dump = dump_path !== undefined && existsSync(dump_path) ? readFileSync(dump_path, "utf8") : undefined;
  const text = render({ code: r.exitCode, stdout: normalize(r.stdout.toString(), c), stderr: normalize(r.stderr.toString(), c), dump });
  writeFileSync(join(HERE, "oracle", `${c.name}.txt`), text);
  console.log(`${c.name}: exit ${r.exitCode}, ${r.stdout.toString().split("\n").length - 1} lines`);
}
