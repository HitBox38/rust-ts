// The tool oracles (plan-m8 D2, review plan-m8 F11; lane harness-m8a-gate): the pinned nightly's `clippy-preview` and `rustfmt-preview`
// dist tarballs (UPSTREAM.json `rust.tools`: the channel manifest's `xz_url` and `xz_hash`), unpacked into
// `$RUST_TS_DATA/tools/<sha256>/` by `bun scripts/tools.ts setup` (about 20 MB) instead of an isolated rustup home (about 0.6 GiB).
// Their binaries link `@rpath/librustc_driver-<hash>.dylib`; run by absolute path with `DYLD_LIBRARY_PATH=<oracle sysroot>/lib`
// (`toolEnv`), they load **the oracle's own** `librustc_driver`. Nothing is installed into the oracle toolchain (decision 2026-10-31:
// it is immutable; scripts/lib/toolchain.ts).
// The guard (`toolGuardErrors`, run by scripts/lib/tool-oracles.test.ts in every gate and by `bun scripts/tools.ts check`): each kept
// tarball still has its pinned SHA-256, each binary is byte for byte the tarball's, its `git-commit-hash` is the pin's commit, and
// each binary that links `librustc_driver` links exactly one, the file the oracle sysroot has (`otool -L`). The oracle toolchain's own
// component check (exactly UPSTREAM.json's components) is scripts/lib/toolchain.ts's, which the guard test runs beside it.
// No imports beyond node:, so unit tests can load it without scripts/lib/common.ts (see scripts/lib/deps.test.ts).
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

/** UPSTREAM.json `rust.tools.<name>`. */
export interface ToolPin {
  url: string;
  sha256: string;
}

export type ToolName = "clippy" | "rustfmt";
export const TOOL_NAMES: readonly ToolName[] = ["clippy", "rustfmt"];

/**
 * What each tarball holds that the harness runs: the component directory and the binaries that link `librustc_driver` (each checked
 * by `otool -L`; `cargo-fmt` links none and is not run by any suite), and whether the tool takes rustc's `--sysroot`: clippy-driver is
 * a rustc and gets the oracle's (`toolArgs`); rustfmt has no such flag (it loads no crate and prints no std path).
 */
export const TOOL_LAYOUT: Readonly<Record<ToolName, { component: string; driverBins: readonly string[]; sysrootFlag: boolean }>> = {
  clippy: { component: "clippy-preview", driverBins: ["clippy-driver", "cargo-clippy"], sysrootFlag: true },
  rustfmt: { component: "rustfmt-preview", driverBins: ["rustfmt"], sysrootFlag: false },
};

/** `$RUST_TS_DATA/tools`. */
export const toolsRoot = (data: string): string => join(data, "tools");
/** The tarball's file name, from its URL (`clippy-nightly-aarch64-apple-darwin.tar.xz`). */
export const tarballName = (pin: ToolPin): string => basename(new URL(pin.url).pathname);
/** The tarball's top directory, as rust-installer names it: the file name without `.tar.xz`. */
export const unpackedName = (pin: ToolPin): string => tarballName(pin).replace(/\.tar\.xz$/, "");
/** `$RUST_TS_DATA/tools/<sha256>/`: the kept tarball and its unpacked tree. */
export const toolDir = (data: string, pin: ToolPin): string => join(toolsRoot(data), pin.sha256);
/** A binary of `tool` by absolute path. */
export const toolBinary = (data: string, pin: ToolPin, tool: ToolName, bin: string): string => join(toolDir(data, pin), unpackedName(pin), TOOL_LAYOUT[tool].component, "bin", bin);
/** The path of `bin` inside the tarball. */
export const tarMember = (pin: ToolPin, tool: ToolName, bin: string): string => `${unpackedName(pin)}/${TOOL_LAYOUT[tool].component}/bin/${bin}`;

/** The pins of UPSTREAM.json `rust.tools`, in `TOOL_NAMES` order; undefined if it has none for every tool. */
export function toolPins(tools: Record<string, ToolPin> | undefined): Record<ToolName, ToolPin> | undefined {
  if (tools === undefined) return undefined;
  for (const t of TOOL_NAMES) if (typeof tools[t]?.url !== "string" || !/^[0-9a-f]{64}$/.test(tools[t]?.sha256 ?? "")) return undefined;
  return { clippy: tools.clippy!, rustfmt: tools.rustfmt! };
}

export const sha256 = (data: Uint8Array | string): string => createHash("sha256").update(data).digest("hex");

/** Whether `tool` is set up: its directory has the tarball and an unpacked tree (not whether the guard passes). */
export const toolSetUp = (data: string, pin: ToolPin): boolean => existsSync(join(toolDir(data, pin), tarballName(pin))) && existsSync(join(toolDir(data, pin), unpackedName(pin)));

/** The dylibs `otool -L <bin>` lists (its first line names the file itself). */
export function parseOtoolDylibs(text: string): string[] {
  return text
    .split(/\r?\n/)
    .slice(1)
    .map((l) => /^\s+(\S.*?) \(compatibility version /.exec(l)?.[1])
    .filter((d): d is string => d !== undefined);
}

const DRIVER = /^(?:@rpath\/|.*\/)?(librustc_driver-[0-9a-f]+\.dylib)$/;

/**
 * Why `bin`, linking `dylibs` (`parseOtoolDylibs`), would not run on the oracle's `librustc_driver`, or undefined: it must link
 * exactly one `librustc_driver-<hash>.dylib`, through `@rpath` (so `DYLD_LIBRARY_PATH` decides which file loads), and that file
 * must be one of `sysrootLibs` (the names in `<oracle sysroot>/lib`).
 */
export function driverLinkError(bin: string, dylibs: readonly string[], sysrootLibs: readonly string[]): string | undefined {
  const drivers = dylibs.filter((d) => /librustc_driver/.test(d));
  if (drivers.length !== 1) return `${bin} links ${drivers.length} librustc_driver dylib(s) (${drivers.join(", ") || "none"}), not exactly one`;
  const d = drivers[0]!;
  const name = DRIVER.exec(d)?.[1];
  if (name === undefined || !d.startsWith("@rpath/")) return `${bin} links ${d}, not @rpath/librustc_driver-<hash>.dylib: DYLD_LIBRARY_PATH would not choose the oracle's`;
  if (!sysrootLibs.includes(name)) return `${bin} links ${name}, which the oracle sysroot's lib does not have (it has ${sysrootLibs.filter((n) => n.startsWith("librustc_driver")).join(", ") || "no librustc_driver"}): it is not the oracle's build`;
  return undefined;
}

/** What the guard reads of the host: injectable, so its own tests run on fakes. */
export interface ToolGuardIo {
  /** `otool -L <path>`'s stdout, or undefined if it failed. */
  otool(path: string): string | undefined;
  /** `<member>`'s bytes inside the tarball at `tarball` (`tar -xOf`), or undefined if it failed. */
  tarMember(tarball: string, member: string): Uint8Array | undefined;
}

/**
 * The guard (see the header): one line (no `ERROR:` prefix) per problem of the tools pinned in `pins`, set up under `data`, against the
 * oracle at `sysroot` and `commit`. Empty: every check passed.
 */
export function toolGuardErrors(data: string, pins: Record<ToolName, ToolPin>, sysroot: string, commit: string, io: ToolGuardIo): string[] {
  const errors: string[] = [];
  let libs: string[];
  try {
    libs = readdirSync(join(sysroot, "lib"));
  } catch (e) {
    return [`cannot list the oracle sysroot's lib (${join(sysroot, "lib")}): ${e instanceof Error ? e.message : String(e)}`];
  }
  for (const tool of TOOL_NAMES) {
    const pin = pins[tool];
    const dir = toolDir(data, pin);
    const tarball = join(dir, tarballName(pin));
    if (!toolSetUp(data, pin)) {
      errors.push(`${tool}: not set up (${dir} has no ${tarballName(pin)} and ${unpackedName(pin)}/); run: bun scripts/tools.ts setup`);
      continue;
    }
    const got = sha256(readFileSync(tarball));
    if (got !== pin.sha256) {
      errors.push(`${tool}: ${tarball} has SHA-256 ${got}, not the pinned ${pin.sha256} (UPSTREAM.json rust.tools.${tool}); remove ${dir} and run: bun scripts/tools.ts setup`);
      continue;
    }
    const hashFile = join(dir, unpackedName(pin), "git-commit-hash");
    const tarCommit = existsSync(hashFile) ? readFileSync(hashFile, "utf8").trim() : undefined;
    if (tarCommit !== commit) errors.push(`${tool}: the tarball's git-commit-hash is ${tarCommit ?? "missing"}, not the pin's commit ${commit}`);
    for (const bin of TOOL_LAYOUT[tool].driverBins) {
      const path = toolBinary(data, pin, tool, bin);
      if (!existsSync(path)) {
        errors.push(`${tool}: ${path} is missing; remove ${dir} and run: bun scripts/tools.ts setup`);
        continue;
      }
      const want = io.tarMember(tarball, tarMember(pin, tool, bin));
      if (want === undefined) errors.push(`${tool}: cannot read ${tarMember(pin, tool, bin)} from ${tarball}`);
      else if (sha256(readFileSync(path)) !== sha256(want)) errors.push(`${tool}: ${path} is not the tarball's ${bin} (its bytes differ); remove ${dir} and run: bun scripts/tools.ts setup`);
      const otool = io.otool(path);
      if (otool === undefined) {
        errors.push(`${tool}: otool -L ${path} failed`);
        continue;
      }
      const bad = driverLinkError(path, parseOtoolDylibs(otool), libs);
      if (bad !== undefined) errors.push(`${tool}: ${bad}`);
    }
  }
  return errors;
}

/** The environment of a tool oracle process: the oracle's `librustc_driver` (D2). */
export const toolEnv = (sysroot: string): Record<string, string> => ({ DYLD_LIBRARY_PATH: join(sysroot, "lib") });

/**
 * The arguments of `tool` on either side, after its program: one explicit `--sysroot=<oracle sysroot>` first where the tool takes it
 * (D2: both sides pass the same one; a sysroot with `rust-src` would print real std paths), then `args`. Throws if `args` already
 * names a sysroot: there must be exactly one, the oracle's.
 */
export function toolArgs(tool: ToolName, sysroot: string, args: readonly string[]): string[] {
  if (!TOOL_LAYOUT[tool].sysrootFlag) return [...args];
  const own = args.find((a) => a === "--sysroot" || a.startsWith("--sysroot="));
  if (own !== undefined) throw new Error(`${tool}: the case's arguments already name a sysroot (${own}); both sides get exactly one, the oracle's (plan-m8 D2)`);
  return [`--sysroot=${sysroot}`, ...args];
}

/**
 * The part of a tool suite's oracle cache key that the command's first word cannot give (`Suite.oracleKey`): the tool, its tarball's
 * pinned SHA-256, and the oracle `librustc_driver` build it runs on (`driverHash`, scripts/lib/oracle.ts `rustcDriverHash`).
 */
export const toolOracleKeyOf = (tool: ToolName, pin: ToolPin, driverHash: string): string => JSON.stringify({ tool, tarballSha256: pin.sha256, rustcDriver: driverHash });
