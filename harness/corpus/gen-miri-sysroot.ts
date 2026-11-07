// Generates harness/corpus/miri-sysroot/crates.json: every crate of the Miri sysroot, from `cargo miri setup -v`'s log
// (plan-m6 §1b; `$RUST_TS_DATA/tmp/plan-m6/setup-v.log`), with each `rustc` argv and environment that cargo-miri ran.
//
//   bun harness/corpus/gen-miri-sysroot.ts <setup-v.log> > harness/corpus/miri-sysroot/crates.json
//
// The temp directory of the setup run is gone, and the paths into it are not part of the output (checked by replaying each
// crate with the isolated Miri: harness/miri-sysroot.ts), so `--out-dir` is `$OUT`, and `--extern` / `-L dependency=` name
// the finished sysroot's library directory, `$LIB`, which holds the same file names. Paths under the isolated toolchain
// are `$TC` and under its cargo home `$CARGO_HOME`. Left out: build scripts (the sysroot does not hold them).
// `custom_local_sysroot`, the empty crate rustc-build-sysroot writes into that temp directory, is built there: its path is in the
// crate's metadata, so its cwd and manifest are `$BUILD`, the temp directory of the run that built the sysroot (harness/miri-sysroot.ts
// reads it from the sysroot's `.d`; this log is of another run), and its `lib.rs`, empty (rustc-build-sysroot 0.5.14
// src/lib.rs:480-485), is in `sources`. So replayed, it gives the sysroot's bytes on both sides (review miri-sysroot F1).
// cargo-miri adds one flag the log does not show, as bootstrap would: `-Cpanic=abort` on `panic_abort` (replaying the crate with
// the isolated Miri gives the sysroot's bytes with it, and other bytes without it).
import { readFileSync } from "node:fs";
import { MIRI_CARGO_HOME, miriToolchainDir } from "../../scripts/lib/miri.ts";

function shellSplit(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inTok = false;
  let q = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (q) {
      if (c === q) q = "";
      else cur += c;
    } else if (c === "'" || c === '"') {
      q = c;
      inTok = true;
    } else if (c === "\\") {
      cur += s[++i];
      inTok = true;
    } else if (c === " ") {
      if (inTok) out.push(cur);
      cur = "";
      inTok = false;
    } else {
      cur += c;
      inTok = true;
    }
  }
  if (inTok) out.push(cur);
  return out;
}

const TC = miriToolchainDir();
const tmpl = (s: string): string => s.replaceAll(TC, "$TC").replaceAll(MIRI_CARGO_HOME, "$CARGO_HOME");
const crates: Record<string, { cwd: string; args: string[]; env: Record<string, string>; sources?: Record<string, string> }> = {};
// A command can span lines: a package description may hold a newline.
for (const [, command] of readFileSync(process.argv[2]!, "utf8").matchAll(/Running `([\s\S]*?)`\n/g)) {
  const toks = shellSplit(command!);
  let i = 0;
  const env: Record<string, string> = {};
  for (; i < toks.length; i++) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/s.exec(toks[i]!);
    if (!m) break;
    if (m[1] !== "DYLD_FALLBACK_LIBRARY_PATH" && m[1] !== "CARGO") env[m[1]!] = tmpl(m[2]!);
  }
  const args = toks.slice(i + 1);
  if (!args.includes("--target")) continue; // a build script, or running one
  const name = args[args.indexOf("--crate-name") + 1]!;
  const mapped = args.map((a, k) => {
    if (args[k - 1] === "--out-dir") return "$OUT";
    if (a.startsWith("dependency=")) return "dependency=$LIB";
    const m = /^((?:priv:)?[a-z_0-9]+=)\/.*\/(lib[^/]+)$/.exec(a);
    if (m && args[k - 1] === "--extern") return `${m[1]}$LIB/${m[2]}`;
    return tmpl(a);
  });
  if (name === "panic_abort") mapped.push("-Cpanic=abort");
  if (name === "custom_local_sysroot") {
    const build = env.CARGO_MANIFEST_DIR!;
    const b = (x: string): string => x.replaceAll(build, "$BUILD");
    crates[name] = { cwd: "$BUILD", args: mapped.map(b), env: Object.fromEntries(Object.entries(env).map(([k, v]) => [k, b(v)])), sources: { "lib.rs": "" } };
    continue;
  }
  crates[name] = { cwd: env.CARGO_MANIFEST_DIR!, args: mapped, env };
}
console.log(JSON.stringify(crates, null, 1));
