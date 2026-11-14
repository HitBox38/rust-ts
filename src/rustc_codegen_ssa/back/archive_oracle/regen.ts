// Regenerates fixtures.json for ../archive_oracle.test.ts (lane ssa-archive). Run by hand only, on the root host:
//   bun src/rustc_codegen_ssa/back/archive_oracle/regen.ts
// For each target, the oracle builds nc.rs (a `#![no_core]` crate whose two CGUs give the staticlib global symbols that
// are not exported: `a::helper` and `a::A_DATA`) with `--emit=link -Ccodegen-units=2 -Cpanic=abort -Csave-temps
// --remap-path-prefix=<dir>=/x`, as an rlib and as a staticlib with no `-Zstaticlib-*` flag, with
// `-Zstaticlib-hide-internal-symbols`, with `-Zstaticlib-rename-internal-symbols` and with both. `-Csave-temps` keeps the
// archive's inputs: the CGU objects (before any symbol edit) and, for the rlib, `lib.rmeta` and `lib.rmeta-link`.
// On nc.rs those internal globals are already hidden (`STV_HIDDEN`, `N_PEXT`), so hide rewrites the same bytes. The `pub-*`
// builds (review ssa-archive F1) take nc_pub.rs, which adds an unused `pub fn root_pub` and `pub static ROOT_DATA`, copied
// to `pub/nc.rs` (the crate keeps the name `nc`), and add `--crate-type rlib` to the four staticlib builds: the rlib crate
// type keeps both items reachable, global with default visibility, yet outside the StaticLib export set, so hide changes
// their visibility byte. (With staticlib alone they are dropped or internalized.) `-Cembed-bitcode=no` keeps the rlib crate
// type's `.llvmbc` sections out of the objects, which only makes the fixture smaller.
// fixtures.json holds, per target and build, the archive's member names in order, the members' input bytes and the
// archive's bytes; equal byte strings are stored once (`blobs`, by SHA-256).
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { DATA } from "../../../../scripts/lib/common.ts";
import { oracleRustcCmd } from "../../../../scripts/lib/oracle.ts";
import { ArchiveFile } from "../../../vendor/object/read/archive.ts";

const HERE = import.meta.dir;
const TARGETS = ["aarch64-apple-darwin", "x86_64-unknown-linux-gnu"];
const STATICLIB_FLAGS: Record<string, string[]> = {
  plain: [],
  hide: ["-Zstaticlib-hide-internal-symbols"],
  rename: ["-Zstaticlib-rename-internal-symbols"],
  both: ["-Zstaticlib-hide-internal-symbols", "-Zstaticlib-rename-internal-symbols"],
};
/** Build name -> [source directory under the work dir, flags, archive file name]. */
const BUILDS: Record<string, [string, string[], string]> = {
  rlib: ["", ["--crate-type", "rlib"], "libnc.rlib"],
  ...Object.fromEntries(Object.entries(STATICLIB_FLAGS).map(([b, f]) => [b, ["", ["--crate-type", "staticlib", ...f], "libnc.a"]])),
  ...Object.fromEntries(
    Object.entries(STATICLIB_FLAGS).map(([b, f]) => [`pub-${b}`, ["pub", ["--crate-type", "staticlib", "--crate-type", "rlib", "-Cembed-bitcode=no", ...f], "libnc.a"]]),
  ),
};

mkdirSync(join(DATA, "tmp"), { recursive: true });
const work = mkdtempSync(join(DATA, "tmp", "archive-oracle-"));
writeFileSync(join(work, "nc.rs"), readFileSync(join(HERE, "nc.rs")));
mkdirSync(join(work, "pub"));
writeFileSync(join(work, "pub", "nc.rs"), readFileSync(join(HERE, "nc_pub.rs")));
const blobs: Record<string, string> = {};
const put = (b: Uint8Array): string => {
  const h = createHash("sha256").update(b).digest("hex");
  blobs[h] = Buffer.from(b).toString("base64");
  return h;
};
/** Every file under `dir` by base name (the save-temps files sit in `dir` and in `rustc*` temp dirs below it). */
function files(dir: string, out = new Map<string, string>()): Map<string, string> {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) files(p, out);
    else out.set(n, p);
  }
  return out;
}
const out: Record<string, Record<string, { members: [string, string][]; archive: string }>> = {};
try {
  for (const t of TARGETS) {
    out[t] = {};
    for (const [b, [src, flags, archive_name]] of Object.entries(BUILDS)) {
      const dir = join(work, t, b);
      mkdirSync(dir, { recursive: true });
      const args = ["--emit=link", "-Ccodegen-units=2", "-Cpanic=abort", "-Csave-temps", "--target", t, `--remap-path-prefix=${work}=/x`, ...flags, "--out-dir", dir, join(work, src, "nc.rs")];
      const r = Bun.spawnSync(oracleRustcCmd(args), { cwd: work, env: { ...process.env, RUSTUP_AUTO_INSTALL: "0", RUSTC_ICE: "0" }, stderr: "pipe" });
      if (r.exitCode !== 0) throw new Error(`oracle failed for ${t} ${b}: ${r.stderr.toString()}`);
      const archive = readFileSync(join(dir, archive_name));
      const all = files(dir);
      const members: [string, string][] = [];
      const a = ArchiveFile.parse(archive);
      if (a.$ === "Err") throw new Error(`cannot parse the ${t} ${b} archive`);
      const it = a._0.members();
      for (let m = it.next(); m !== undefined; m = it.next()) {
        if (m.$ === "Err") throw new Error("bad member");
        const name = new TextDecoder().decode(m._0.name());
        const p = all.get(name);
        if (p === undefined) throw new Error(`no save-temps input for member ${name} of ${t} ${b}`);
        members.push([name, put(readFileSync(p))]);
      }
      out[t][b] = { members, archive: put(archive) };
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
writeFileSync(join(HERE, "fixtures.json"), JSON.stringify({ builds: out, blobs }, null, 1) + "\n");
