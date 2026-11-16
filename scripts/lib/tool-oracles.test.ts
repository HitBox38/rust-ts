// The tool oracles' guard (plan-m8 D2, lane harness-m8a-gate; scripts/lib/tool-oracles.ts): on fake tool trees and sysroots, and on
// the real ones. The real guard needs `bun scripts/tools.ts setup`: without it, the test skips, and under RUST_TS_REQUIRE_PROBES=1 (the
// gate) it fails, saying so. tool-oracles.ts has no imports beyond node:, so nothing here loads scripts/lib/common.ts.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { oracleToolchainError } from "./toolchain.ts";
import {
  TOOL_LAYOUT,
  driverLinkError,
  parseOtoolDylibs,
  sha256,
  tarMember,
  toolArgs,
  toolBinary,
  toolDir,
  toolEnv,
  toolGuardErrors,
  toolOracleKeyOf,
  toolPins,
  toolSetUp,
  unpackedName,
  type ToolGuardIo,
  type ToolName,
  type ToolPin,
} from "./tool-oracles.ts";

const REPO = resolve(import.meta.dir, "..", "..");
const TMP = mkdtempSync(join(tmpdir(), "rust-ts-tool-oracles-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

/** `otool -L` and `tar -xOf`, as scripts/lib/oracle.ts `HOST_TOOL_GUARD_IO` (which this file may not import: it loads common.ts). */
const HOST_IO: ToolGuardIo = {
  otool: (path) => {
    const r = Bun.spawnSync(["/usr/bin/otool", "-L", path], { stdout: "pipe", stderr: "pipe" });
    return r.exitCode === 0 ? r.stdout.toString() : undefined;
  },
  tarMember: (tarball, member) => {
    const r = Bun.spawnSync(["/usr/bin/tar", "-xOf", tarball, member], { stdout: "pipe", stderr: "pipe" });
    return r.exitCode === 0 ? r.stdout : undefined;
  },
};

const OTOOL = (bin: string, driver: string) =>
  `${bin}:\n\t${driver} (compatibility version 0.0.0, current version 0.0.0)\n\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1356.0.0)\n\t@rpath/libLLVM.dylib (compatibility version 1.0.0, current version 23.1.3)\n`;
const DRIVER = "librustc_driver-3bee00c5d9e363a9.dylib";

describe("parseOtoolDylibs and driverLinkError", () => {
  test("the dylibs, not the file's own line", () => {
    expect(parseOtoolDylibs(OTOOL("/x/clippy-driver", `@rpath/${DRIVER}`))).toEqual([`@rpath/${DRIVER}`, "/usr/lib/libSystem.B.dylib", "@rpath/libLLVM.dylib"]);
  });
  test("exactly one driver, through @rpath, the oracle sysroot's file", () => {
    const libs = [DRIVER, "libLLVM.dylib"];
    expect(driverLinkError("b", [`@rpath/${DRIVER}`, "/usr/lib/libz.1.dylib"], libs)).toBeUndefined();
    expect(driverLinkError("b", ["/usr/lib/libz.1.dylib"], libs)).toContain("links 0 librustc_driver dylib(s) (none)");
    expect(driverLinkError("b", [`@rpath/${DRIVER}`, "@rpath/librustc_driver-0000.dylib"], libs)).toContain("links 2");
    expect(driverLinkError("b", [`/opt/other/lib/${DRIVER}`], libs)).toContain("not @rpath/");
    expect(driverLinkError("b", ["@rpath/librustc_driver-0123456789abcdef.dylib"], libs)).toContain("which the oracle sysroot's lib does not have (it has librustc_driver-3bee00c5d9e363a9.dylib)");
  });
});

describe("toolArgs, toolEnv, toolOracleKeyOf", () => {
  test("clippy gets exactly one --sysroot, the oracle's, first; rustfmt none", () => {
    expect(toolArgs("clippy", "/sys", ["a.rs", "--edition=2024"])).toEqual(["--sysroot=/sys", "a.rs", "--edition=2024"]);
    expect(toolArgs("rustfmt", "/sys", ["--check", "a.rs"])).toEqual(["--check", "a.rs"]);
    expect(() => toolArgs("clippy", "/sys", ["--sysroot=/other"])).toThrow("already name a sysroot (--sysroot=/other)");
    expect(() => toolArgs("clippy", "/sys", ["--sysroot", "/other"])).toThrow("already name a sysroot");
  });
  test("the oracle's librustc_driver by DYLD_LIBRARY_PATH", () => {
    expect(toolEnv("/sys")).toEqual({ DYLD_LIBRARY_PATH: "/sys/lib" });
  });
  test("the oracle key has the tarball's hash and the driver build: either one changes it", () => {
    const pin = { url: "https://x/clippy-nightly-h.tar.xz", sha256: "a".repeat(64) };
    const k = toolOracleKeyOf("clippy", pin, "d1");
    expect(k).toContain("a".repeat(64));
    expect(toolOracleKeyOf("clippy", { ...pin, sha256: "b".repeat(64) }, "d1")).not.toBe(k);
    expect(toolOracleKeyOf("clippy", pin, "d2")).not.toBe(k);
    expect(toolOracleKeyOf("rustfmt", pin, "d1")).not.toBe(k);
  });
});

describe("toolGuardErrors on a fake tool tree", () => {
  const COMMIT = "6f5da406b56c2db6607202b63daee73aa8c61297";
  /** A data dir with tarballs of fake tools (each binary a few bytes), unpacked as setup does, and a fake sysroot. */
  function world(name: string, opts: { commit?: string } = {}) {
    const root = join(TMP, name);
    const data = join(root, "data");
    const sysroot = join(root, "sysroot");
    mkdirSync(join(sysroot, "lib"), { recursive: true });
    writeFileSync(join(sysroot, "lib", DRIVER), "");
    const pins = {} as Record<ToolName, ToolPin>;
    for (const tool of ["clippy", "rustfmt"] as const) {
      const stage = join(root, `stage-${tool}`);
      const top = `${tool}-nightly-fake`;
      mkdirSync(join(stage, top, TOOL_LAYOUT[tool].component, "bin"), { recursive: true });
      writeFileSync(join(stage, top, "git-commit-hash"), (opts.commit ?? COMMIT) + "\n");
      for (const bin of TOOL_LAYOUT[tool].driverBins) writeFileSync(join(stage, top, TOOL_LAYOUT[tool].component, "bin", bin), `${tool} ${bin}`);
      const tarball = join(root, `${top}.tar.xz`);
      expect(Bun.spawnSync(["/usr/bin/tar", "-cJf", tarball, "-C", stage, top]).exitCode).toBe(0);
      const pin = { url: `https://static.example/dist/${top}.tar.xz`, sha256: sha256(readFileSync(tarball)) };
      pins[tool] = pin;
      const dir = toolDir(data, pin);
      mkdirSync(dir, { recursive: true });
      expect(Bun.spawnSync(["/bin/cp", tarball, dir]).exitCode).toBe(0);
      expect(Bun.spawnSync(["/usr/bin/tar", "-xJf", tarball, "-C", dir]).exitCode).toBe(0);
    }
    return { data, sysroot, pins };
  }
  /** `otool` answers with `driver` for every binary. */
  const io = (driver: string): ToolGuardIo => ({ ...HOST_IO, otool: (p) => OTOOL(p, driver) });

  test("a set-up tree on the oracle's driver passes", () => {
    const w = world("ok");
    expect(unpackedName(w.pins.clippy)).toBe("clippy-nightly-fake");
    expect(tarMember(w.pins.clippy, "clippy", "clippy-driver")).toBe("clippy-nightly-fake/clippy-preview/bin/clippy-driver");
    expect(toolGuardErrors(w.data, w.pins, w.sysroot, COMMIT, io(`@rpath/${DRIVER}`))).toEqual([]);
  });
  test("not set up: one line per tool, with the setup command", () => {
    const w = world("none");
    const e = toolGuardErrors(join(TMP, "none", "empty"), w.pins, w.sysroot, COMMIT, io(`@rpath/${DRIVER}`));
    expect(e.length).toBe(2);
    expect(e[0]).toContain("clippy: not set up");
    expect(e[0]).toContain("bun scripts/tools.ts setup");
  });
  test("a tarball whose hash is not the pin's", () => {
    const w = world("hash");
    writeFileSync(join(toolDir(w.data, w.pins.rustfmt), "rustfmt-nightly-fake.tar.xz"), "tampered");
    const e = toolGuardErrors(w.data, w.pins, w.sysroot, COMMIT, io(`@rpath/${DRIVER}`));
    expect(e.length).toBe(1);
    expect(e[0]).toContain(`not the pinned ${w.pins.rustfmt.sha256} (UPSTREAM.json rust.tools.rustfmt)`);
  });
  test("a binary that is not the tarball's, a missing one, and another commit", () => {
    const w = world("bins", { commit: "0".repeat(40) });
    writeFileSync(toolBinary(w.data, w.pins.clippy, "clippy", "clippy-driver"), "replaced");
    rmSync(toolBinary(w.data, w.pins.clippy, "clippy", "cargo-clippy"));
    const e = toolGuardErrors(w.data, w.pins, w.sysroot, COMMIT, io(`@rpath/${DRIVER}`));
    expect(e.some((l) => l.includes("clippy-driver is not the tarball's clippy-driver"))).toBe(true);
    expect(e.some((l) => l.includes("cargo-clippy is missing"))).toBe(true);
    expect(e.filter((l) => l.includes(`git-commit-hash is ${"0".repeat(40)}, not the pin's commit`)).length).toBe(2);
  });
  test("a binary on another librustc_driver, or none", () => {
    const w = world("driver");
    const other = toolGuardErrors(w.data, w.pins, w.sysroot, COMMIT, io("@rpath/librustc_driver-0123456789abcdef.dylib"));
    expect(other.length).toBe(3); // clippy-driver, cargo-clippy, rustfmt
    expect(other[0]).toContain("not the oracle's build");
    expect(toolGuardErrors(w.data, w.pins, w.sysroot, COMMIT, io("/usr/lib/libz.1.dylib"))[0]).toContain("links 0 librustc_driver");
    expect(toolGuardErrors(w.data, w.pins, w.sysroot, COMMIT, { ...HOST_IO, otool: () => undefined })[0]).toContain("otool -L");
  });
  test("toolPins takes UPSTREAM.json's rust.tools only whole", () => {
    const pin = { url: "https://x/y.tar.xz", sha256: "c".repeat(64) };
    expect(toolPins({ clippy: pin, rustfmt: pin })).toEqual({ clippy: pin, rustfmt: pin });
    expect(toolPins({ clippy: pin })).toBeUndefined();
    expect(toolPins({ clippy: pin, rustfmt: { ...pin, sha256: "short" } })).toBeUndefined();
    expect(toolPins(undefined)).toBeUndefined();
  });
});

describe("the real tool oracles (plan-m8 D2)", () => {
  const pin = JSON.parse(readFileSync(join(REPO, "UPSTREAM.json"), "utf8")).rust as { toolchain: string; commit: string; components: string[]; tools: Record<string, ToolPin> };
  const pins = toolPins(pin.tools);
  const data = process.env.RUST_TS_DATA;
  const ready = pins !== undefined && data !== undefined && (["clippy", "rustfmt"] as const).every((t) => toolSetUp(data, pins[t]));
  const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";

  test("UPSTREAM.json pins both tarballs: the 2026-10-11 manifest's xz_url and xz_hash", () => {
    expect(pins).toBeDefined();
    expect(pins!.clippy).toEqual({ url: "https://static.rust-lang.org/dist/2026-10-11/clippy-nightly-aarch64-apple-darwin.tar.xz", sha256: "08d0af9f8706ff7756863d099bd622ed3dcc992fd7ad1de08fc10316e97e5e25" });
    expect(pins!.rustfmt).toEqual({ url: "https://static.rust-lang.org/dist/2026-10-11/rustfmt-nightly-aarch64-apple-darwin.tar.xz", sha256: "3ed6326d5922f45113b8513935deec2cbebc67cd7a036861ab95387bee0803ea" });
  });

  test.skipIf(!ready && !REQUIRE)("set up, they pass the guard, and the oracle toolchain still has exactly its pinned components", () => {
    expect(ready, `the tool oracles are not set up under ${data}/tools; run: bun scripts/tools.ts setup`).toBe(true);
    const env = { ...process.env, RUSTUP_AUTO_INSTALL: "0" };
    const r = Bun.spawnSync(["rustc", `+${pin.toolchain}`, "--print", "sysroot"], { stdout: "pipe", stderr: "pipe", env });
    const v = Bun.spawnSync(["rustc", `+${pin.toolchain}`, "-vV"], { stdout: "pipe", stderr: "pipe", env });
    expect(r.exitCode, r.stderr.toString()).toBe(0);
    const sysroot = r.stdout.toString().trim();
    expect(toolGuardErrors(data!, pins!, sysroot, pin.commit, HOST_IO)).toEqual([]);
    const host = /^host: (\S+)$/m.exec(v.stdout.toString())![1]!;
    expect(oracleToolchainError(sysroot, pin.components, host, basename(sysroot))).toBeUndefined();
  });
});
