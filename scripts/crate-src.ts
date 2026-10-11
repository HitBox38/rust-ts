// Print the source directory of an external crate at the version locked by upstream.
//   bun scripts/crate-src.ts <crate> [--version X]
// Downloads via cargo into the normal cargo registry if needed.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DATA, PIN, die, ensureDir, parseArgs, requireUpstream, run } from "./lib/common.ts";

const a = parseArgs(process.argv.slice(2));
const name = a._[0];
if (!name) die("usage: bun scripts/crate-src.ts <crate> [--version X]");

let version = typeof a.version === "string" ? a.version : undefined;
if (!version) {
  const lock = readFileSync(join(requireUpstream(), "Cargo.lock"), "utf8");
  const versions = [...lock.matchAll(new RegExp(`name = "${name}"\\nversion = "([^"]+)"`, "g"))].map((m) => m[1]!);
  if (versions.length === 0) die(`${name} is not in upstream Cargo.lock; pass --version`);
  if (versions.length > 1) die(`${name} has several locked versions (${versions.join(", ")}); pass --version`);
  version = versions[0]!;
}

function find(): string | undefined {
  const src = join(process.env.CARGO_HOME ?? join(homedir(), ".cargo"), "registry", "src");
  if (!existsSync(src)) return undefined;
  for (const idx of readdirSync(src)) {
    const p = join(src, idx, `${name}-${version}`);
    if (existsSync(p)) return p;
  }
  return undefined;
}

let path = find();
if (!path) {
  const dir = ensureDir(join(DATA, "crate-fetch", `${name}-${version}`));
  writeFileSync(
    join(dir, "Cargo.toml"),
    `[package]\nname = "fetch"\nversion = "0.0.0"\nedition = "2021"\n[lib]\npath = "lib.rs"\n[dependencies]\n${name} = "=${version}"\n[workspace]\n`,
  );
  writeFileSync(join(dir, "lib.rs"), "");
  const r = await run(["cargo", `+${PIN.toolchain}`, "fetch", "--manifest-path", join(dir, "Cargo.toml")]);
  if (r.code !== 0) die(`cargo fetch failed: ${r.stderr}`);
  path = find();
}
if (!path) die(`could not locate ${name}-${version} after fetching`);
console.log(path);
