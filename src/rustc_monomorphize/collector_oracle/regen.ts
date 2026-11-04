// Rewrites the committed oracle output of collector.oracle.test.ts (lane mono-collector; not a port).
//   bun src/rustc_monomorphize/collector_oracle/regen.ts [program-name...]
//
// For each program in programs/ (ours) and upstream/ (tests/codegen-units/item-collection at the pin, unedited), writes
// oracle/<name>.txt from the pinned rustc: its exit code, its `MONO_ITEM` lines, stderr, and the `FP` lines of probe/main.rs.
// Everything is compiled for x86_64-unknown-linux-gnu, whose `rust-std` the oracle toolchain has: the port's
// `rustc_target::callconv::aarch64::compute_rust_abi_info` is unported and `check_mono_item` needs an ABI.
// A program run with -Zprofile-closures also gets oracle/<name>.closure_profile.csv.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../../../scripts/lib/common.ts";
import { clean_env, flags_of, HERE, normalize_stderr, program_files, read_closure_profile, TARGET } from "./common.ts";

const RUSTC = ["rustc", `+${PIN.toolchain}`];
const SYSROOT = Bun.spawnSync([...RUSTC, "--print", "sysroot"]).stdout.toString().trim();
const WORK = join(DATA, "tmp", "mono-collector-oracle", process.env.RUST_TS_AGENT ?? "default");
mkdirSync(WORK, { recursive: true });

function build_probe(): string {
  const bin = join(WORK, "probe");
  const r = Bun.spawnSync(
    [...RUSTC, "--edition=2024", "-O", join(HERE, "probe/main.rs"), "-o", bin, "-C", `link-args=-Wl,-rpath,${SYSROOT}/lib`],
    { env: { ...process.env, RUSTC_BOOTSTRAP: "1" }, stderr: "pipe", stdout: "pipe" },
  );
  if (r.exitCode !== 0) throw new Error(`ERROR: probe build failed:\n${r.stderr.toString()}`);
  return bin;
}

const probe = build_probe();
const only = process.argv.slice(2);
for (const { name, path } of program_files()) {
  if (only.length > 0 && !only.includes(name)) continue;
  const flags = flags_of(readFileSync(path, "utf8"));
  const common = [`--target=${TARGET}`, ...flags, path, "--crate-name", name.replaceAll("-", "_")];
  const cwd = join(WORK, name);
  rmSync(cwd, { recursive: true, force: true });
  mkdirSync(cwd, { recursive: true });
  const oracle = Bun.spawnSync([...RUSTC, ...common, "--emit=obj", "-Zprint-mono-items=yes", "-o", join(WORK, `${name}.o`)], {
    cwd,
    env: clean_env(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const fp = Bun.spawnSync([probe, ...common, "--sysroot", SYSROOT, "--emit=obj", "-o", join(WORK, `${name}.p.o`)], {
    cwd: WORK,
    env: clean_env(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const profile = read_closure_profile(cwd, path);
  if (profile !== undefined) writeFileSync(join(HERE, "oracle", `${name}.closure_profile.csv`), profile);
  const items = oracle.stdout
    .toString()
    .split("\n")
    .filter((l) => l.startsWith("MONO_ITEM "));
  const fps = fp.stdout
    .toString()
    .split("\n")
    .filter((l) => l.startsWith("FP "));
  const out = [
    `exit ${oracle.exitCode}`,
    "== MONO_ITEM",
    ...items,
    "== FP",
    ...fps,
    "== stderr",
    normalize_stderr(oracle.stderr.toString(), path),
  ].join("\n");
  writeFileSync(join(HERE, "oracle", `${name}.txt`), out);
  console.log(`${name}: exit ${oracle.exitCode}, ${items.length} items, ${fps.length} fingerprints`);
}
