// Module evaluation order of a subject entry, from source and from its compiled build (lane subject-bin): the check behind the
// handoff's claim that a bundle evaluates the port's modules in the order `bun <entry>` does, first-import cycles and lazy
// `require()`s included.
//
//   bun scripts/subject-bin-order.ts [--entry src/rust_ts/main.ts] [--cwd DIR] [--env K=V]... [--keep] [--verbose] -- <args...>
//
// Every word before `--` must be one of these options (`orderArgs`): Bun drops a `--` that comes first after the script.
// The cwd defaults to a fresh temp directory (pass absolute input paths); both sides get `RUSTC_ICE=0` unless an `--env` sets it.
//
// Both sides prepend one statement to line 1 of every repo module, which records the module's path when its body starts (lines
// and columns stay as they are): the source side through a `bun --preload` runtime plugin, the build side through the same
// plugin in a build made like scripts/lib/subject-bin.ts's (its options, its import.meta rewrite), in a temp dir. Each side runs
// the entry with the same arguments, cwd and environment; the src/rust_ts/stack.ts re-exec keeps the preload (it re-execs the raw
// argv) and the trace of the process that finishes is the one written. Prints whether the two sequences, exit codes, stdout and
// stderr are the same, and the first difference; exit 1 when anything differs.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { REPO } from "./lib/common.ts";
import { buildSpec, rewriteModule } from "./lib/subject-bin.ts";

/** The statement prepended to every repo module (same text on both sides). */
const traceLine = (rel: string) => `globalThis.__rtsOrder?.push(${JSON.stringify(rel)});`;
/** Starts the trace and writes it at exit to `$RUST_TS_ORDER_OUT`. */
const TRACE_START = `globalThis.__rtsOrder = []; process.on("exit", () => process.getBuiltinModule("node:fs").writeFileSync(process.env.RUST_TS_ORDER_OUT, globalThis.__rtsOrder.join("\\n") + "\\n"));`;

const isRepoModule = (p: string) => p.startsWith(REPO + "/") && /\.ts$/.test(p) && !p.includes("/node_modules/");

/** This tool's options: those taking a value, and the flags. */
const VALUE_OPTIONS = ["entry", "cwd", "env"];
const FLAG_OPTIONS = ["keep", "verbose"];

/**
 * This tool's options and the subject's arguments from `process.argv`, or why the command line is refused. Every word before
 * the `--` must be one of this tool's options (with its value), so that a subject argument read as an option is an error, not a
 * run with fewer arguments (review perf-subject-bin N1). Bun drops a `--` that comes first after the script (`bun x.ts --
 * --version` gives argv `[--version]`), and a forgotten `--` (`--entry m.ts --version`) leaves the subject's arguments among the
 * tool's: both are refused unless every such word is an option of this tool. `--env` may repeat.
 */
export function orderArgs(argv: readonly string[]): { error: string } | { entry: string; cwd: string | undefined; env: Record<string, string>; keep: boolean; verbose: boolean; args: string[] } {
  const dd = argv.indexOf("--");
  const words = argv.slice(2, dd < 0 ? undefined : dd);
  const args = dd < 0 ? [] : argv.slice(dd + 1);
  const opts: Record<string, string | true> = {};
  // RUSTC_ICE=0: an ICE must not leave a `rustc-ice-*.txt` report in the cwd (an `--env` can still set it elsewhere).
  const env: Record<string, string> = { RUSTC_ICE: "0" };
  const why = dd < 0 ? " (no `--` before it: Bun drops a `--` that comes first, so pass an option first, e.g. `--entry src/rust_ts/main.ts -- <args>`)" : "";
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const eq = w.indexOf("=");
    const name = w.startsWith("--") ? w.slice(2, eq > 0 ? eq : undefined) : undefined;
    if (name !== undefined && VALUE_OPTIONS.includes(name)) {
      const value = eq > 0 ? w.slice(eq + 1) : words[++i];
      if (value === undefined || (eq < 0 && value.startsWith("--"))) return { error: `\`--${name}\` needs a value${why}` };
      if (name === "env") {
        if (!value.includes("=")) return { error: `\`--env ${value}\` is not K=V` };
        env[value.slice(0, value.indexOf("="))] = value.slice(value.indexOf("=") + 1);
      } else if (opts[name] !== undefined) return { error: `\`--${name}\` given twice` };
      else opts[name] = value;
    } else if (name !== undefined && FLAG_OPTIONS.includes(name) && eq < 0) opts[name] = true;
    else return { error: `\`${w}\` is not an option of this tool${why}` };
  }
  return { entry: typeof opts.entry === "string" ? opts.entry : "src/rust_ts/main.ts", cwd: typeof opts.cwd === "string" ? opts.cwd : undefined, env, keep: opts.keep === true, verbose: opts.verbose === true, args };
}

if (import.meta.main) {
  const o = orderArgs(process.argv);
  if ("error" in o) {
    console.log(`ERROR: ${o.error}`);
    process.exit(1);
  }
  const a = { keep: o.keep, verbose: o.verbose };
  const { args, entry } = o;
  const extraEnv = o.env;
  const tmp = mkdtempSync(join(tmpdir(), "rts-order-"));
  // Default cwd: a fresh directory of this run, never the upstream checkout (nothing the port writes there may stay).
  const cwd = o.cwd ?? mkdtempSync(join(tmp, "cwd-"));
  try {
    // The source side's preload: a runtime plugin, then the trace.
    const preload = join(tmp, "preload.ts");
    writeFileSync(
      preload,
      `${TRACE_START}
Bun.plugin({
  name: "rts-order",
  setup(b) {
    // Synchronous: an async onLoad makes every module async, and \`require()\` refuses those.
    b.onLoad({ filter: /\\.ts$/ }, (args) => {
      const p = args.path;
      if (!(p.startsWith(${JSON.stringify(REPO + "/")}) && !p.includes("/node_modules/"))) return undefined;
      const rel = p.slice(${JSON.stringify(REPO + "/")}.length);
      return { contents: \`globalThis.__rtsOrder?.push(\${JSON.stringify(rel)});\` + process.getBuiltinModule("node:fs").readFileSync(p, "utf8"), loader: "ts" };
    });
  },
});
`,
    );
    // The build side: the subject binary's options, its rewrite, and the same prefix.
    const spec = buildSpec(entry);
    const bin = join(tmp, "rts");
    const saved = process.cwd();
    process.chdir(REPO);
    const r = await Bun.build({
      entrypoints: [spec.entryPath],
      target: spec.target,
      format: spec.format,
      sourcemap: spec.sourcemap,
      define: spec.define,
      banner: `${TRACE_START} ${spec.banner}`,
      bytecode: spec.bytecode,
      optimize: { bytecode: spec.optimizeBytecode },
      compile: { ...spec.compile, outfile: bin },
      throw: false,
      plugins: [
        {
          name: "rts-order",
          setup(b) {
            b.onLoad({ filter: /\.ts$/ }, (args) => {
              if (!isRepoModule(args.path)) return undefined as unknown as import("bun").OnLoadResult;
              const text = readFileSync(args.path, "utf8");
              return { contents: traceLine(relative(REPO, args.path)) + (rewriteModule(text, args.path) ?? text), loader: "ts" };
            });
          },
        },
      ],
    } as Parameters<typeof Bun.build>[0]);
    process.chdir(saved);
    if (a.keep) console.log(`kept: ${tmp}`);
    if (!r.success) {
      console.log(`ERROR: build failed: ${r.logs.map(String).join(" | ").slice(0, 500)}`);
      process.exit(1);
    }
    const side = (cmd: string[], out: string) => {
      const p = Bun.spawnSync(cmd, { cwd, env: { ...process.env, ...extraEnv, RUST_TS_ORDER_OUT: out }, stdout: "pipe", stderr: "pipe" });
      let order: string[] = [];
      try {
        order = readFileSync(out, "utf8").split("\n").filter(Boolean);
      } catch {}
      return { code: p.exitCode, stdout: p.stdout.toString(), stderr: p.stderr.toString(), order };
    };
    const src = side([process.execPath, "--preload", preload, spec.entryPath, ...args], join(tmp, "src.txt"));
    const bun = side([bin, ...args], join(tmp, "bin.txt"));
    const first = src.order.findIndex((m, i) => bun.order[i] !== m);
    const sameOrder = src.order.length === bun.order.length && first < 0;
    const mask = (t: string) => t.replace(/(thread '[^']*' )\(\d+\)( panicked)/g, "$1(PID)$2");
    const sameOut = src.code === bun.code && src.stdout === bun.stdout && mask(src.stderr) === mask(bun.stderr);
    const at = first < 0 ? Math.min(src.order.length, bun.order.length) : first;
    console.log(
      `${sameOrder ? "same order" : "ORDER DIFFERS"}: ${src.order.length} modules from source, ${bun.order.length} from the build${sameOrder ? "" : `; first difference at #${at}: source ${src.order[at] ?? "(end)"}, build ${bun.order[at] ?? "(end)"}`}`,
    );
    // The subject's argument count: a run with none shows (review perf-subject-bin N1).
    console.log(`${sameOut ? "same output" : "OUTPUT DIFFERS"} (${args.length} subject argument${args.length === 1 ? "" : "s"}): exit ${src.code}/${bun.code}, stdout ${src.stdout.length}/${bun.stdout.length} bytes, stderr ${src.stderr.length}/${bun.stderr.length} bytes`);
    if (!sameOut && a.verbose) console.log(`--- source stderr\n${src.stderr}\n--- build stderr\n${bun.stderr}`);
    process.exitCode = sameOrder && sameOut ? 0 : 1;
  } finally {
    if (!a.keep) rmSync(tmp, { recursive: true, force: true });
  }
}
