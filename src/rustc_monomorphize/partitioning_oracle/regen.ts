// Rewrites the committed oracle output of partitioning.oracle.test.ts (lane mono-partition; not a port).
//   bun src/rustc_monomorphize/partitioning_oracle/regen.ts [case-name...]
//
// For each case of common.ts, oracle/<case>.txt holds what the pinned rustc prints: its exit code, its `-Zprint-mono-items`
// lines, its stderr and its `-Zdump-mono-stats` file. Linking uses `/usr/bin/true`: `x86_64-unknown-linux-gnu`'s linker is
// not on this host, and partitioning has finished by then. oracle/<case>.cgus.txt holds what probe/main.rs prints of the
// partitioner's result, from the same arguments.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { all_cases, build_aux, clean_env, common_args, fresh_dir, has_cgus_fixture, HERE, normalize, render, RUSTC, WORK } from "./common.ts";

const SYSROOT = Bun.spawnSync([...RUSTC, "--print", "sysroot"]).stdout.toString().trim();
function build_probe(): string {
  const bin = join(WORK, "probe");
  const r = Bun.spawnSync([...RUSTC, "--edition=2024", "-O", join(HERE, "probe/main.rs"), "-o", bin, "-C", `link-args=-Wl,-rpath,${SYSROOT}/lib`], {
    env: { ...process.env, RUSTC_BOOTSTRAP: "1" },
    stderr: "pipe",
    stdout: "pipe",
  });
  if (r.exitCode !== 0) throw new Error(`ERROR: probe build failed:\n${r.stderr.toString()}`);
  return bin;
}

const only = process.argv.slice(2);
const cases = all_cases().filter((c) => only.length === 0 || only.includes(c.name));
build_aux(cases);
const probe = build_probe();
for (const c of cases) {
  const out = fresh_dir(`oracle-${c.name}`);
  const incr = c.incremental ? [`-Cincremental=${join(out, "incr")}`] : [];
  const r = Bun.spawnSync([...RUSTC, ...common_args(c, out, "oracle"), ...incr, "-Clinker=/usr/bin/true"], { env: clean_env(), stdout: "pipe", stderr: "pipe" });
  const dump_path = c.dump === undefined ? undefined : join(out, "dump", c.dump);
  const dump = dump_path !== undefined && existsSync(dump_path) ? readFileSync(dump_path, "utf8") : undefined;
  const text = render({ code: r.exitCode, stdout: normalize(r.stdout.toString(), c), stderr: normalize(r.stderr.toString(), c), dump });
  writeFileSync(join(HERE, "oracle", `${c.name}.txt`), text);
  if (has_cgus_fixture(c)) {
    const probe_out = fresh_dir(`probe-${c.name}`);
    const incr_probe = c.incremental ? [`-Cincremental=${join(probe_out, "incr")}`] : [];
    const p = Bun.spawnSync([probe, "--sysroot", SYSROOT, ...common_args(c, probe_out, "oracle"), ...incr_probe], { env: clean_env(), stdout: "pipe", stderr: "pipe" });
    // A run that stops before partitioning finishes (exit != 0) prints no such lines: only `MONO_ITEM`, which is checked above.
    const lines = p.exitCode === 0 ? p.stdout.toString().split("\n").filter((l) => !l.startsWith("MONO_ITEM ") && l !== "") : [];
    writeFileSync(join(HERE, "oracle", `${c.name}.cgus.txt`), normalize(lines.map((l) => `${l}\n`).join(""), c));
  }
  console.log(`${c.name}: exit ${r.exitCode}, ${r.stdout.toString().split("\n").length - 1} lines`);
}
