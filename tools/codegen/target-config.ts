// Generates src/rust_ts/target_config.gen.ts from the oracle (decision D4, docs/plan-m2.md):
//
//   TARGET_CONFIGS             what `rustc_codegen_llvm`'s `target_config` (LLVM) returns for the default
//                              `-Ctarget-cpu`/`-Ctarget-feature` of each built-in target rust-ts ports
//                              (`internal_target_features`, the five `has_reliable_*` flags). Read from a
//                              rustc_private probe (target-config/probe.rs) that prints
//                              `sess.internal_target_features` and `sess.config` after the session is built.
//   BUILTIN_TARGET_CFG_VALUES  the `target_*` cfg values of every built-in target (`TARGETS`), from
//                              `rustc --print cfg --target T`; `CheckCfg::fill_well_known` needs them for all
//                              built-ins while only a few target specs are ported.
//
//   bun tools/codegen/target-config.ts           write the file
//   bun tools/codegen/target-config.ts --check   ERROR if the committed file is stale
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN, REPO, die } from "../../scripts/lib/common.ts";

export const OUT = "src/rust_ts/target_config.gen.ts";
const PROBE_SRC = join(REPO, "tools/codegen/target-config/probe.rs");

/** The built-in targets whose specs are ported (src/rustc_target/spec/targets/mod.ts). */
export const TARGET_CONFIG_TARGETS = [
  "aarch64-apple-darwin",
  "aarch64-unknown-linux-gnu",
  "wasm32-wasip2",
  "x86_64-apple-darwin",
  "x86_64-pc-windows-msvc",
  "x86_64-unknown-linux-gnu",
];

const RUSTC = ["rustc", `+${PIN.toolchain}`];

function sh(cmd: string[], env?: Record<string, string>): string {
  const r = Bun.spawnSync(cmd, { env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) die(`${cmd.join(" ")} failed (${r.exitCode}): ${r.stderr.toString().trim().split("\n")[0]}`);
  return r.stdout.toString();
}

async function shAsync(cmd: string[]): Promise<string> {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) die(`${cmd.join(" ")} failed (${code}): ${err.trim().split("\n")[0]}`);
  return out;
}

function sysroot(): string {
  return sh([...RUSTC, "--print", "sysroot"]).trim();
}

/** Builds (once per probe source + toolchain build) the rustc_private probe; returns its path. */
function buildProbe(): string {
  const src = readFileSync(PROBE_SRC);
  const ver = sh([...RUSTC, "-vV"]);
  if (!ver.includes(`commit-hash: ${PIN.commit}`)) die(`oracle rustc +${PIN.toolchain} is not the pinned commit ${PIN.commit}`);
  const key = createHash("sha256").update(src).update(ver).update(sysroot()).digest("hex").slice(0, 16);
  const dir = join(DATA, "probes", "target-config");
  mkdirSync(dir, { recursive: true });
  const exe = join(dir, `probe-${key}${process.platform === "win32" ? ".exe" : ""}`);
  if (!existsSync(exe)) sh([...RUSTC, "--edition", "2024", "-O", PROBE_SRC, "-o", exe]);
  return exe;
}

interface TargetConfig {
  internal_target_features: string[];
  has_reliable_f16: boolean;
  has_reliable_f16_math: boolean;
  has_reliable_f16b: boolean;
  has_reliable_f128: boolean;
  has_reliable_f128_math: boolean;
}

function probeTarget(exe: string, root: string, tuple: string): TargetConfig {
  const dir = join(DATA, "tmp", "target-config");
  mkdirSync(dir, { recursive: true });
  const input = join(dir, "empty.rs");
  writeFileSync(input, "");
  const lib = join(root, "lib");
  const out = sh([exe, input, "--target", tuple, "--sysroot", root], {
    DYLD_LIBRARY_PATH: lib,
    LD_LIBRARY_PATH: lib,
    PATH: `${join(root, "bin")}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
  });
  const lines = out.split("\n");
  const f = lines.find((l) => l.startsWith("internal_target_features "));
  if (f === undefined) die(`probe printed no internal_target_features for ${tuple}`);
  const feats = f.slice("internal_target_features ".length);
  const cfg = new Set(lines.filter((l) => l.startsWith("cfg ")).map((l) => l.slice(4)));
  return {
    internal_target_features: feats === "" ? [] : feats.split(","),
    has_reliable_f16: cfg.has("target_has_reliable_f16"),
    has_reliable_f16_math: cfg.has("target_has_reliable_f16_math"),
    has_reliable_f16b: cfg.has("target_has_reliable_f16b"),
    has_reliable_f128: cfg.has("target_has_reliable_f128"),
    has_reliable_f128_math: cfg.has("target_has_reliable_f128_math"),
  };
}

const CFG_KEYS = [
  "target_abi",
  "target_arch",
  "target_endian",
  "target_env",
  "target_object_format",
  "target_os",
  "target_pointer_width",
  "target_vendor",
] as const;

interface BuiltinCfg {
  tuple: string;
  values: Record<(typeof CFG_KEYS)[number], string>;
  target_family: string[];
}

function parseCfg(tuple: string, out: string): BuiltinCfg {
  const values: Partial<Record<string, string>> = {};
  const target_family: string[] = [];
  for (const line of out.split("\n")) {
    const m = /^([a-z_]+)="(.*)"$/.exec(line);
    if (!m) continue;
    const [, k, v] = m;
    if (k === "target_family") target_family.push(v!);
    else if ((CFG_KEYS as readonly string[]).includes(k!)) {
      if (values[k!] !== undefined) die(`${tuple}: two values for ${k}`);
      values[k!] = v!;
    }
  }
  for (const k of CFG_KEYS) if (values[k] === undefined) die(`${tuple}: --print cfg has no ${k}`);
  return { tuple, values: values as BuiltinCfg["values"], target_family };
}

export async function generate(): Promise<string> {
  const root = sysroot();
  const exe = buildProbe();
  const configs = TARGET_CONFIG_TARGETS.map((t) => [t, probeTarget(exe, root, t)] as const);

  const targets = sh([...RUSTC, "--print", "target-list"]).split("\n").filter((t) => t !== "");
  const builtins: BuiltinCfg[] = [];
  const LIMIT = 8;
  for (let i = 0; i < targets.length; i += LIMIT) {
    const chunk = targets.slice(i, i + LIMIT);
    const outs = await Promise.all(chunk.map((t) => shAsync([...RUSTC, "--print", "cfg", "--target", t])));
    chunk.forEach((t, j) => builtins.push(parseCfg(t, outs[j]!)));
  }

  const q = JSON.stringify;
  const o: string[] = [];
  o.push(`// GENERATED by tools/codegen/target-config.ts from the oracle rustc ${PIN.commit.slice(0, 12)}. Do not edit.`);
  o.push("// Not an upstream mirror: oracle data that stands in for LLVM (decision D4, docs/plan-m2.md).");
  o.push("");
  o.push("/** `rustc_codegen_ssa::TargetConfig` as rustc_codegen_llvm's `target_config` computes it (default CPU/features). */");
  o.push("export interface TargetConfigTable {");
  o.push("  readonly internal_target_features: readonly string[];");
  o.push("  readonly has_reliable_f16: boolean;");
  o.push("  readonly has_reliable_f16_math: boolean;");
  o.push("  readonly has_reliable_f16b: boolean;");
  o.push("  readonly has_reliable_f128: boolean;");
  o.push("  readonly has_reliable_f128_math: boolean;");
  o.push("}");
  o.push("");
  o.push("/** By target tuple; `internal_target_features` sorted (`to_sorted_stable_ord`). */");
  o.push("export const TARGET_CONFIGS: ReadonlyMap<string, TargetConfigTable> = new Map([");
  for (const [t, c] of configs) {
    o.push(`  [`);
    o.push(`    ${q(t)},`);
    o.push(`    {`);
    o.push(`      internal_target_features: [${c.internal_target_features.map((f) => q(f)).join(", ")}],`);
    for (const k of ["has_reliable_f16", "has_reliable_f16_math", "has_reliable_f16b", "has_reliable_f128", "has_reliable_f128_math"] as const) {
      o.push(`      ${k}: ${c[k]},`);
    }
    o.push(`    },`);
    o.push(`  ],`);
  }
  o.push("]);");
  o.push("");
  o.push("/** The `target_*` cfg values of a built-in target (`rustc --print cfg --target <tuple>`). */");
  o.push("export interface BuiltinTargetCfgValues {");
  o.push("  readonly tuple: string;");
  for (const k of CFG_KEYS) o.push(`  readonly ${k}: string;`);
  o.push("  readonly target_family: readonly string[];");
  o.push("}");
  o.push("");
  o.push("/** Every built-in target, in `rustc --print target-list` order. */");
  o.push("export const BUILTIN_TARGET_CFG_VALUES: readonly BuiltinTargetCfgValues[] = [");
  for (const b of builtins) {
    const fields = [`tuple: ${q(b.tuple)}`, ...CFG_KEYS.map((k) => `${k}: ${q(b.values[k])}`), `target_family: [${b.target_family.map((f) => q(f)).join(", ")}]`];
    o.push(`  { ${fields.join(", ")} },`);
  }
  o.push("];");
  return o.join("\n") + "\n";
}

if (import.meta.main) {
  const check = process.argv.includes("--check");
  const text = await generate();
  const path = join(REPO, OUT);
  if (check) {
    if (!existsSync(path) || readFileSync(path, "utf8") !== text) die(`${OUT} is stale; run: bun tools/codegen/target-config.ts`);
    console.log(`up to date: ${OUT}`);
  } else {
    writeFileSync(path, text);
    console.log(`wrote: ${OUT}`);
  }
}
