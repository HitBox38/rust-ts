// The command of both sides of the `miri-sysroot-*` report suites (harness/suites.ts; plan-m6 D4, lane harness-m6d): builds one
// crate of the Miri sysroot as cargo-miri would (harness/miri-sysroot.ts) and reports the three files it writes.
//
//   bun scripts/miri-sysroot-run.ts --crate <name> --side oracle|subject -- <compiler argv...>
//
// Prints, after the compiler's own output (the out dir of this run spelled `$OUT`, so the two sides compare):
//   dep-info: <size> bytes, sha256 <hex>       with the out dir spelled `$OUT` in it
//   rmeta: <size> bytes, sha256 <hex>
//   rlib: <size> bytes, sha256 <hex>
//   sysroot rmeta: same | differs from <size> bytes, sha256 <hex>, first at byte <offset>
//   sysroot rlib: same | differs ...
// A file the compiler did not write prints `<kind>: none`, so a build that stops `unported` in the linker still reports its
// rmeta. The exit code is the compiler's (128 + signal if it was killed). The last two lines compare with the finished
// Miri sysroot under `$RUST_TS_DATA/miri-sysroot`, the suite's point; on the oracle side they say whether replaying the
// recorded argv reproduces it. The out dir is removed afterwards unless a sysroot line says `differs` (kept for diagnosis): core's
// rmeta is 69 MB.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "./lib/common.ts";
import { miriTargetLibDir } from "./lib/miri.ts";
import { miriSysrootInvocation } from "../harness/miri-sysroot.ts";
import { firstDifference } from "./rmeta-run.ts";

export interface MiriSysrootRunArgs {
  crate: string;
  side: "oracle" | "subject";
  compiler: string[];
}

/** Parses the command line (see the header); throws on a malformed one. */
export function parseMiriSysrootRunArgs(argv: string[]): MiriSysrootRunArgs {
  const a: Partial<MiriSysrootRunArgs> = {};
  let compiler: string[] | undefined;
  for (let i = 0; i < argv.length; i++) {
    const o = argv[i]!;
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`miri-sysroot-run: ${o} needs a value`);
      return v;
    };
    if (o === "--") {
      compiler = argv.slice(i + 1);
      break;
    } else if (o === "--crate") a.crate = val();
    else if (o === "--side") {
      const v = val();
      if (v !== "oracle" && v !== "subject") throw new Error(`miri-sysroot-run: --side must be oracle or subject, not ${v}`);
      a.side = v;
    } else throw new Error(`miri-sysroot-run: unknown option ${o}`);
  }
  if (compiler === undefined || compiler.length === 0) throw new Error("miri-sysroot-run: no compiler command after `--`");
  if (a.crate === undefined || a.side === undefined) throw new Error("miri-sysroot-run: --crate and --side are required");
  return { crate: a.crate, side: a.side, compiler };
}

const sha256 = (b: Uint8Array | string): string => new Bun.CryptoHasher("sha256").update(b).digest("hex");

/** `<kind>: <size> bytes, sha256 <hex>` of a file, or `<kind>: none`. */
export function fileLine(kind: string, path: string | undefined): string {
  if (path === undefined) return `${kind}: none`;
  return `${kind}: ${statSync(path).size} bytes, sha256 ${sha256(readFileSync(path))}`;
}

/** `sysroot <kind>: ...`: how `path` compares with the sysroot's file of the same name. */
export function sysrootLine(kind: string, path: string | undefined, sysrootFile: string): string {
  if (path === undefined) return `sysroot ${kind}: none`;
  if (!existsSync(sysrootFile)) return `sysroot ${kind}: differs: not in the sysroot`;
  const off = firstDifference(path, sysrootFile);
  if (off < 0) return `sysroot ${kind}: same`;
  return `sysroot ${kind}: differs from ${statSync(sysrootFile).size} bytes, sha256 ${sha256(readFileSync(sysrootFile))}, first at byte ${off}`;
}

const SIGNALS: Record<string, number> = { SIGINT: 2, SIGKILL: 9, SIGTERM: 15 };

export async function miriSysrootRun(a: MiriSysrootRunArgs): Promise<number> {
  const out = join(DATA, "rmeta", "miri-sysroot", a.crate, a.side);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const inv = miriSysrootInvocation(a.crate, out);
  const p = Bun.spawn([...a.compiler, ...inv.args], { cwd: inv.cwd, env: { ...process.env, ...inv.env }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const pass = (sig: NodeJS.Signals) => () => p.kill(sig);
  process.on("SIGTERM", pass("SIGTERM"));
  process.on("SIGINT", pass("SIGINT"));
  const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const code = await p.exited;
  const normal = (s: string): string => s.replaceAll(out, "$OUT");
  process.stderr.write(normal(stderr));
  process.stdout.write(normal(stdout));
  const names = readdirSync(out);
  const find = (re: RegExp): string | undefined => {
    const n = names.find((x) => re.test(x));
    return n === undefined ? undefined : join(out, n);
  };
  const dep = find(/\.d$/);
  const rmeta = find(/\.rmeta$/);
  const rlib = find(/\.rlib$/);
  const lib = miriTargetLibDir();
  const inLib = (f: string | undefined): string => (f === undefined ? "" : join(lib, f.slice(out.length + 1)));
  const lines = [
    dep === undefined ? "dep-info: none" : `dep-info: ${normal(readFileSync(dep, "utf8")).length} bytes, sha256 ${sha256(normal(readFileSync(dep, "utf8")))}`,
    fileLine("rmeta", rmeta),
    fileLine("rlib", rlib),
    sysrootLine("rmeta", rmeta, inLib(rmeta)),
    sysrootLine("rlib", rlib, inLib(rlib)),
    // A file only one side writes is a difference too (review miri-sysroot F4).
    `files: ${[...names].sort().join(" ")}`,
  ];
  process.stdout.write(lines.join("\n") + "\n");
  if (!lines.some((l) => l.includes(": differs"))) rmSync(out, { recursive: true, force: true });
  return p.signalCode ? 128 + (SIGNALS[p.signalCode] ?? 0) : code;
}

if (import.meta.main) {
  let a: MiriSysrootRunArgs;
  try {
    a = parseMiriSysrootRunArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
  try {
    process.exit(await miriSysrootRun(a));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
}
