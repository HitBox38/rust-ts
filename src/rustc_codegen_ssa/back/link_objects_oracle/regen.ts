// Regenerates the oracle objects link_objects.test.ts compares against (lane vendor-object-write; not a port). Run by hand
// only: `bun src/rustc_codegen_ssa/back/link_objects_oracle/regen.ts`. No test runs it.
//
// Each case builds hello.rs (a bin) or dl.rs (a `-Cprefer-dynamic` dylib) with the pinned rustc, `-Csave-temps` (so the
// link's temporary directory survives) and `-Clinker=true` (so nothing is linked), and copies the objects rustc writes
// through the `object` crate from that directory:
//   <case>.symbols.o  link.rs `add_linked_symbol_object` (Mach-O: with apple.rs `add_data_and_relocation`'s relocations)
//   <case>.rmeta.o    metadata.rs `create_compressed_metadata_file` (dylibs only)
// `--remap-path-prefix` keeps the scratch directory out of the metadata.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../../../../scripts/lib/common.ts";

const HERE = import.meta.dir;
const WORK = join(DATA, "tmp", "link-objects-oracle", process.env.RUST_TS_AGENT ?? "default");

const CASES: { name: string; target: string; src: string; crate_type: string }[] = [
  { name: "macho-bin", target: "aarch64-apple-darwin", src: "hello.rs", crate_type: "bin" },
  { name: "macho-dylib", target: "aarch64-apple-darwin", src: "dl.rs", crate_type: "dylib" },
  { name: "elf-bin", target: "x86_64-unknown-linux-gnu", src: "hello.rs", crate_type: "bin" },
  { name: "elf-dylib", target: "x86_64-unknown-linux-gnu", src: "dl.rs", crate_type: "dylib" },
];

rmSync(WORK, { recursive: true, force: true });
for (const c of CASES) {
  const out = join(WORK, c.name);
  mkdirSync(out, { recursive: true });
  const args = ["--edition", "2024", "--target", c.target, "--crate-type", c.crate_type, "--emit=link", "-Csave-temps", "-Clinker=true"];
  if (c.crate_type === "dylib") args.push("-Cprefer-dynamic");
  args.push(`--remap-path-prefix=${HERE}=/x`, "--out-dir", out, join(HERE, c.src));
  const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, ...args], {
    cwd: HERE,
    env: { ...process.env, RUSTC_ICE: "0", RUSTUP_AUTO_INSTALL: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (r.exitCode !== 0) throw new Error(`ERROR: oracle failed for ${c.name}: ${r.stderr.toString().slice(0, 2000)}`);
  const tmp = readdirSync(out).filter((n) => n.startsWith("rustc"));
  if (tmp.length !== 1) throw new Error(`ERROR: ${c.name}: expected one rustc* temporary directory, found ${tmp.length}`);
  const copied: string[] = [];
  for (const f of ["symbols.o", "rmeta.o"]) {
    const from = join(out, tmp[0]!, f);
    if (!existsSync(from)) continue;
    copyFileSync(from, join(HERE, `${c.name}.${f}`));
    copied.push(f);
  }
  console.log(`${c.name}: ${copied.join(", ")}`);
}
rmSync(WORK, { recursive: true, force: true });
