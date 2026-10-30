// Oracle checks of the command-line dependency-tracking hash (lane passes-reachable): config.rs `mod dep_tracking`
// (`DepTrackingHash` impls, `stable_hash`) and the options.rs `dep_tracking_hash` fns (options.gen.ts), i.e. the
// `sess.opts.dep_tracking_hash(true)` the crate hash (SVH) is seeded with, against the pinned nightly.
//   - oracle: the `optshash` rustc-dev probe (tools/probes/optshash), which runs rustc's own driver and prints
//     `dep_tracking_hash(true)` / `(false)` once the crate root is parsed;
//   - port: src/rustc_session/dep_tracking_oracle/run.ts, the same through the ported driver.
// Both get the same argv in the same working directory (`working_dir` is a tracked option); stdout, stderr and the
// exit code must be identical. Every case passes the oracle's `--sysroot`, so the sysroot-derived
// `real_rustc_dev_source_base_dir` (tracked, no crate hash) is the same on both sides, except the plan-m5 D1 core
// argv itself, which is run as the M5 suites run it (no `--sysroot`) and compares only the crate hash.
// Without the probe the test is a visible skip; RUST_TS_REQUIRE_PROBES=1 makes that a failure.
import { expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, REPO, UPSTREAM } from "../../scripts/lib/common.ts";
import { test_scratch_dir } from "../rust_ts/test_scratch.ts";

const REQUIRE_PROBES = process.env.RUST_TS_REQUIRE_PROBES === "1";
const OPTSHASH = join(DATA, "target", "probes", "release", "optshash");
const SKIP = !existsSync(OPTSHASH) && !REQUIRE_PROBES;
if (SKIP) console.log("SKIP: optshash probe not built (bun scripts/probes.ts build optshash); RUST_TS_REQUIRE_PROBES=1 makes this a failure");

const DRIVER = join(REPO, "src/rustc_session/dep_tracking_oracle/run.ts");
const ENV: Record<string, string> = { ...(process.env as Record<string, string>), RUSTC_ICE: "0", RUST_BACKTRACE: "0" };

interface Out {
  stdout: string;
  stderr: string;
  code: number | null;
}
function run(cmd: string[], cwd: string): Out {
  const r = Bun.spawnSync(cmd, { cwd, env: ENV });
  return { stdout: r.stdout.toString(), stderr: r.stderr.toString(), code: r.exitCode };
}
function both(args: string[], cwd: string): { oracle: Out; port: Out } {
  if (!existsSync(OPTSHASH)) throw new Error(`ERROR: optshash probe not built and RUST_TS_REQUIRE_PROBES=1`);
  return { oracle: run([OPTSHASH, ...args], cwd), port: run([process.execPath, DRIVER, ...args], cwd) };
}

let sysroot_: string | undefined;
function sysroot(): string {
  const oracle = require("../../scripts/lib/oracle.ts") as typeof import("../../scripts/lib/oracle.ts");
  return (sysroot_ ??= oracle.oracleSysroot());
}

/** plan-m5 D1's core argv (harness/suites.ts `CORE_ARGS(["lib"])`), run from the upstream checkout. */
const CORE_D1 = [
  "--crate-name",
  "core",
  "--edition=2024",
  "library/core/src/lib.rs",
  "--crate-type",
  "lib",
  "--target",
  "x86_64-unknown-linux-gnu",
  "-Zforce-unstable-if-unmarked",
  "--emit=metadata",
];

test.skipIf(SKIP)("dep_tracking_hash: plan-m5 D1 core argv (crate hash)", () => {
  const { oracle, port } = both(CORE_D1, UPSTREAM);
  const crate_hash = (o: Out) => o.stdout.split("\n").find((l) => l.startsWith("crate_hash ")) ?? `(none) ${o.stderr}`;
  expect(oracle.code).toBe(0);
  expect(crate_hash(port)).toBe(crate_hash(oracle));
  expect(port.code).toBe(oracle.code);
});

test.skipIf(SKIP)("dep_tracking_hash: plan-m5 D1 core argv with --sysroot (both hashes)", () => {
  const { oracle, port } = both([...CORE_D1, "--sysroot", sysroot()], UPSTREAM);
  expect(oracle.stdout).toMatch(/^crate_hash [0-9a-f]{16}\nincr_hash [0-9a-f]{16}\n$/);
  expect(port).toEqual(oracle);
});

/** Option sets with non-default values of most tracked option types (each is accepted by both compilers up to the
 * crate root; a few also report target errors, which must match too). */
const CASES: Record<string, string[]> = {
  default: [],
  "dist-like": [
    "--crate-type", "lib", "--edition=2021", "-Copt-level=3", "-Cdebuginfo=1", "-Ccodegen-units=1", "-Zinline-mir",
    "-Zinline-mir-preserve-debug", "-Zmir_strip_debuginfo=locals-in-tiny-functions", "-Cembed-bitcode=yes",
    "-Cdebug-assertions=no", "-Coverflow-checks=no",
  ],
  "lints-remap": [
    "-Zcf-protection=full", "-Cforce-frame-pointers=yes", "-Zinstrument-mcount", "--remap-path-scope=macro",
    "--remap-path-prefix", "a=b", "-A", "unused", "-W", "missing-docs", "--cap-lints", "warn", "-Zcrate-attr=x",
    "-Zunstable-options",
  ],
  "target-x86": [
    "--target", "x86_64-unknown-linux-gnu", "-Zinstrument-xray=always,instruction-threshold=10",
    "-Zcoverage-options=branch", "-Cinstrument-coverage", "-Zannotate-moves=100", "-Zsrc-hash-algorithm=sha256",
    "-Zmerge-functions=aliases", "-Zdefault-visibility=hidden", "-Zon-broken-pipe=kill", "-Zdebuginfo-compression=zlib",
    "-Cdlltool=x", "-Clinker-plugin-lto=foo", "-Zverbose-internals", "-Zno-codegen", "--emit=metadata=out.rmeta,dep-info",
  ],
  "target-aarch64": ["--target", "aarch64-unknown-linux-gnu", "-Zbranch-protection=bti,pac-ret,leaf,b-key"],
  "patchable-entry": ["-Zpatchable-function-entry=4,1"],
  "codegen-misc": [
    "-Zunstable-options", "-Cprofile-generate=/tmp/p", "-Zoffload=Host=/tmp/x", "-Zcodegen-emit-retag=no-precise-im",
    "-Zdwarf-version=4", "-Zmin-function-alignment=16", "-Zllvm-module-flag=a:u32:1:max", "-Zshare-generics=yes",
    "-Zthreads=1", "-Zub-checks=yes", "-Zassume-incomplete-release", "-Ztune-cpu=generic", "-Cforce-unwind-tables=yes",
    "-Cprefer-dynamic", "-Cno-redzone=yes", "-Cstrip=symbols", "-Clink-dead-code", "-Ccollapse-macro-debuginfo=yes",
    "-Zcheck-cfg-all-expected", "-Zdebuginfo-for-profiling", "-Zwasi-exec-model=reactor", "-Zmir-enable-passes=+Inline,-GVN",
    "-Zlink-native-libraries=no", "-Cpasses=foo", "-Zplt=yes", "-Zemit-stack-sizes", "-Ztrap-unreachable=no",
    "-Zhint-mostly-unused", "-Zpacked-bundled-libs", "-Zpolonius=next", "-Zhuman-readable-cgu-names",
    "-Zenforce-type-length-limit",
  ],
  "target-errors": [
    "--target", "x86_64-unknown-linux-gnu", "-Zregparm=2", "-Zfunction-return=thunk-extern", "-Clto=thin",
    "-Zsplit-lto-unit", "-Zvirtual-function-elimination", "-Zinline-mir-hint-threshold=3",
    "-Zcross-crate-inline-threshold=yes", "-Zmir-opt-level=0", "-Ccontrol-flow-guard=checks",
    "-Cdebuginfo=line-tables-only", "-Copt-level=s", "-Crelocation-model=pic", "-Ccode-model=small", "-Cpanic=abort",
    "--crate-type", "lib,rlib", "--cfg", "foo", "-Zfmt-debug=shallow", "-Zlocation-detail=file",
  ],
};

const WORK = test_scratch_dir("dep-tracking-oracle");
writeFileSync(join(WORK, "x.rs"), "");

for (const [name, args] of Object.entries(CASES)) {
  test.skipIf(SKIP)(`dep_tracking_hash: ${name}`, () => {
    const { oracle, port } = both(["x.rs", "--sysroot", sysroot(), ...args], WORK);
    expect(oracle.stdout).toMatch(/^crate_hash [0-9a-f]{16}\nincr_hash [0-9a-f]{16}\n$/);
    expect(port).toEqual(oracle);
  });
}
