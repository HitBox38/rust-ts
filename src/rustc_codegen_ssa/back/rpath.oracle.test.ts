// Oracle test for back/rpath.rs (lane ssa-archive): `get_rpath_linker_args` against the `-Crpath` arguments the oracle
// passes its linker, read from `--print link-args` of a `-Cprefer-dynamic` binary (which links the target's std dylib),
// for the host (`is_like_darwin`, not a GNU linker) and x86_64-unknown-linux-gnu (a GNU linker). The linker is a script
// that exits 0, so nothing is linked. `GccLinker` passes the rpath arguments as one `-Wl,` argument joined with commas.
//
// Skips (visibly) if the pinned rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../../../scripts/lib/common.ts";
import { get_rpath_linker_args } from "./rpath.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const RUSTC = ["rustc", `+${PIN.toolchain}`];
function rustcAvailable(): boolean {
  try {
    return Bun.spawnSync([...RUSTC, "-vV"]).stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}
const HAVE = rustcAvailable();
const SKIP = !HAVE && !REQUIRE;
if (SKIP) console.log(`SKIP: pinned rustc (${PIN.toolchain}, ${PIN.commit.slice(0, 12)}) unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);

const WORK = join(DATA, "tmp", "rpath-oracle", process.env.RUST_TS_AGENT ?? "default");

function sysroot(): string {
  const oracle = require("../../../scripts/lib/oracle.ts") as typeof import("../../../scripts/lib/oracle.ts");
  return oracle.oracleSysroot();
}

for (const [tuple, is_like_darwin, linker_is_gnu] of [
  ["aarch64-apple-darwin", true, false],
  ["x86_64-unknown-linux-gnu", false, true],
] as const) {
  test.skipIf(SKIP)(`get_rpath_linker_args matches the oracle's -Crpath link args (${tuple})`, () => {
    const dir = join(WORK, tuple);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, "out"), { recursive: true });
    try {
      const src = join(dir, "hello.rs");
      writeFileSync(src, "fn main() {}\n");
      // Named so that the linker flavor stays `Gcc` (`infer_linker_flavor`: a stem ending in `-gcc`), as with the default `cc`.
      const fake_ld = join(dir, "fake-gcc");
      writeFileSync(fake_ld, "#!/bin/sh\nexit 0\n");
      chmodSync(fake_ld, 0o755);
      const out = join(dir, "out", "hello");
      const r = Bun.spawnSync(
        [...RUSTC, "-Crpath", "-Cprefer-dynamic", "--print", "link-args", "--target", tuple, "-C", `linker=${fake_ld}`, "-o", out, src],
        { stdout: "pipe", stderr: "pipe", env: { ...process.env, RUSTUP_AUTO_INSTALL: "0", RUSTC_ICE: "0" } },
      );
      if (r.exitCode !== 0) throw new Error(`ERROR: oracle build failed: ${r.stderr.toString().slice(0, 2000)}`);
      const want = [...r.stdout.toString().matchAll(/"(-Wl,-rpath,[^"]*)"/g)].map((m) => m[1]);
      expect(want.length).toBe(1);

      // The rust dylibs the binary links all sit in the target's sysroot `lib` directory; the rpath depends on that only.
      const libdir = join(sysroot(), "lib", "rustlib", tuple, "lib");
      const std = readdirSync(libdir).find((n) => n.startsWith("libstd-") && (n.endsWith(".dylib") || n.endsWith(".so")));
      expect(std).toBeDefined();
      const args = get_rpath_linker_args({ libs: [join(libdir, std!)], out_filename: out, is_like_darwin, linker_is_gnu });
      expect(`-Wl,${args.join(",")}`).toBe(want[0]!);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000); // explicit: Bun's 5 s default was hit under load (review fixers-60 N1)
}
