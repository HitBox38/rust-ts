// The oracle toolchain is immutable (decision 2026-10-31, lane harness-w35): its installed rustup components must be
// exactly the pinned list (UPSTREAM.json `rust.components`), and its sysroot must hold no `lib/rustlib/src`. An extra
// component can change the oracle's output with the same rustc build (so the oracle cache key, `rustcDriverHash`, does
// not see it): `rust-src` makes rustc render std/core spans with local paths and snippets. scripts/lib/oracle.ts
// `verifyOraclePin` runs this check before any oracle output is produced or cached (difftest, phase-diff, the gate).
// No imports beyond node:, so unit tests can load it without scripts/lib/common.ts (see scripts/lib/deps.test.ts).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The installed components of a toolchain: `<sysroot>/lib/rustlib/components`, one per line, as rustup writes it
 * (the package names: `llvm-tools-preview-<host>`, where `rustup component list --installed` prints `llvm-tools-<host>`).
 * Throws if the file cannot be read.
 */
export function installedComponents(sysroot: string): string[] {
  return readFileSync(join(sysroot, "lib", "rustlib", "components"), "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/** The pinned list with `{host}` replaced by the oracle's host tuple. */
export function pinnedComponents(pinned: string[], host: string): string[] {
  return pinned.map((c) => c.replaceAll("{host}", host));
}

/**
 * `undefined` if the toolchain at `sysroot` has exactly the `pinned` components (`{host}` = `host`) and no
 * `lib/rustlib/src`; else one line (no `ERROR:` prefix) naming the extra and missing components and the src dir.
 */
export function oracleToolchainError(sysroot: string, pinned: string[], host: string, toolchain: string): string | undefined {
  let installed: string[];
  try {
    installed = installedComponents(sysroot);
  } catch (e) {
    return `cannot read the oracle toolchain's component list (${join(sysroot, "lib", "rustlib", "components")}): ${e instanceof Error ? e.message : String(e)}`;
  }
  const want = pinnedComponents(pinned, host);
  const extra = installed.filter((c) => !want.includes(c)).sort();
  const missing = want.filter((c) => !installed.includes(c)).sort();
  const src = join(sysroot, "lib", "rustlib", "src");
  const hasSrc = existsSync(src);
  if (!extra.length && !missing.length && !hasSrc) return undefined;
  const what = [
    ...(extra.length ? [`extra [${extra.join(", ")}]`] : []),
    ...(missing.length ? [`missing [${missing.join(", ")}]`] : []),
    ...(hasSrc ? [`${src} exists`] : []),
  ];
  return `the oracle toolchain ${toolchain} differs from its pinned components (UPSTREAM.json rust.components): ${what.join("; ")}; it is immutable (extra components change rustc's output): restore it with rustup component remove/add --toolchain ${toolchain}, and give tools that need other components their own RUSTUP_HOME`;
}
