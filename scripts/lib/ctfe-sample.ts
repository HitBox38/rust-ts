// The CTFE trace sample (lane miri-log-fix's evidence script, moved into the repo by lane harness-w37; a tool, not a
// suite): classification, sample selection and the per-reason report of scripts/ctfe-sample.ts. Pure: no process, no
// file, no import of common.ts, so its tests run in-process.
//
// Each file is compiled by the oracle rustc and by the port with the same argv (`-Zunpretty=mir`, see
// scripts/ctfe-sample.ts) under one `RUSTC_LOG` filter, and gets one class (first rule that applies):
//   oracle-skip    the oracle's stdout or stderr went over the cap (streamed and killed: nothing big is kept) or it
//                  timed out: the file is not compared
//   port-timeout   the port timed out: a FAILURE
//   differed       the port's output went over the cap where the oracle's did not: a FAILURE
//   port-unported  port exit 70 (`rust-ts: unported: ...`): not a failure (as UNPORTED in the suites)
//   crashed        port exit 101 where the oracle's exit is not 101 (a JS exception or a port panic, where the oracle
//                  did not ICE): a FAILURE, never a skip (review miri-log, decision 2026-11-01)
//   matched        stdout, stderr and exit code identical (`info` when the oracle's stderr has an ` INFO ` line)
//   differed       anything else: a FAILURE (the first differing stderr line, or stdout / exit, is recorded)

/** One side's run, as scripts/ctfe-sample.ts streams it. */
export interface SampleRun {
  exit: number | null;
  stdout: string;
  stderr: string;
  /** Its stdout or stderr went over the cap (and the process was killed). */
  over: boolean;
  timeout: boolean;
}

export type SampleClass = "matched" | "differed" | "crashed" | "port-timeout" | "port-unported" | "oracle-skip";
/** Report order of the classes. */
export const SAMPLE_CLASSES: readonly SampleClass[] = ["matched", "differed", "crashed", "port-timeout", "port-unported", "oracle-skip"];
/** The classes that fail the sample (exit 1). */
export const FAILURE_CLASSES: readonly SampleClass[] = ["differed", "crashed", "port-timeout"];

export interface SampleResult {
  /** The file, relative to the upstream checkout. */
  file: string;
  cls: SampleClass;
  detail: string;
}

/**
 * The deterministic sample: every k-th of the sorted `files` with k = floor(len / n) (at least 1), at most `n` of
 * them; `"all"` takes every file. The miri-log lanes' selection, so their numbers can be re-run.
 */
export function sampleFiles(files: readonly string[], n: number | "all"): string[] {
  const sorted = [...files].sort();
  if (n === "all") return sorted;
  const k = Math.max(1, Math.floor(sorted.length / n));
  return sorted.filter((_, i) => i % k === 0).slice(0, n);
}

/** The edition a test file asks for (`//@ edition: <e>`; compiletest's default 2015 otherwise). */
export const fileEdition = (src: string): string => /\/\/@\s*edition:\s*(\S+)/.exec(src)?.[1] ?? "2015";

/**
 * The class of a file from its two runs (see the header). `port` is undefined when the oracle's run alone decides
 * (`oracle-skip`: the port is not run). `repo` is stripped from the port's stack-frame paths in a crash's detail.
 */
export function classify(oracle: SampleRun, port: SampleRun | undefined, repo: string): { cls: SampleClass; detail: string } {
  if (oracle.over || oracle.timeout) return { cls: "oracle-skip", detail: oracle.over ? "oracle output over the cap" : "oracle timeout" };
  if (port === undefined) throw new Error("classify: the port's run is needed when the oracle's is not skipped");
  if (port.timeout) return { cls: "port-timeout", detail: "" };
  if (port.over) return { cls: "differed", detail: "port output over the cap, oracle not" };
  if (port.exit === 70) return { cls: "port-unported", detail: /rust-ts: unported: (.*)/.exec(port.stderr)?.[1] ?? "?" };
  if (port.exit === 101 && oracle.exit !== 101) {
    const msg =
      /rust-ts: internal compiler error: (.*)/.exec(port.stderr)?.[1] ??
      /^(thread 'rustc' panicked.*|error: internal compiler error.*)$/m.exec(port.stderr)?.[1] ??
      "(no message)";
    const prefix = repo.replace(/[\\/]+$/, "") + "/";
    const frames = [...port.stderr.replaceAll("\\", "/").matchAll(/\(?(\/?[^\s()]+\.ts):\d+:\d+\)?/g)]
      .map((m) => (m[1]!.startsWith(prefix.replaceAll("\\", "/")) ? m[1]!.slice(prefix.length) : m[1]!))
      .slice(0, 3);
    return { cls: "crashed", detail: `${msg.slice(0, 200)} @ ${frames.join(" < ")}` };
  }
  if (oracle.stderr === port.stderr && oracle.stdout === port.stdout && oracle.exit === port.exit) {
    return { cls: "matched", detail: oracle.stderr.includes(" INFO ") ? "info" : "no-info" };
  }
  const ol = oracle.stderr.split("\n");
  const pl = port.stderr.split("\n");
  let i = 0;
  while (i < ol.length && ol[i] === pl[i]) i++;
  const where = oracle.stderr === port.stderr ? (oracle.stdout !== port.stdout ? "stdout" : "exit") : `stderr line ${i + 1}/${ol.length}`;
  const lines = oracle.stderr === port.stderr ? "" : `: o=${(ol[i] ?? "").slice(0, 120)} | p=${(pl[i] ?? "").slice(0, 120)}`;
  return { cls: "differed", detail: `exit ${oracle.exit}/${port.exit} ${where}${lines}` };
}

/** The number of failing files (see `FAILURE_CLASSES`). */
export const failures = (results: readonly SampleResult[]): number => results.filter((r) => FAILURE_CLASSES.includes(r.cls)).length;

/**
 * The report: the counts per class, matched files with INFO lines, then per non-matched class its details grouped
 * (backticked names folded to `_`), most frequent first, at most `top` groups each.
 */
export function sampleReport(results: readonly SampleResult[], filter: string, top = 25): string[] {
  const out = [`files=${results.length} filter=${filter}`];
  const count = (c: SampleClass) => results.filter((r) => r.cls === c).length;
  for (const c of SAMPLE_CLASSES) out.push(`${c}=${count(c)}${FAILURE_CLASSES.includes(c) ? " (failure)" : ""}`);
  out.push(`matched with INFO lines=${results.filter((r) => r.cls === "matched" && r.detail === "info").length}`);
  for (const c of ["crashed", "port-timeout", "differed", "port-unported", "oracle-skip"] as const) {
    if (!count(c)) continue;
    const groups = new Map<string, number>();
    for (const r of results) {
      if (r.cls !== c) continue;
      const k = r.detail.replace(/`[^`]*`/g, "`_`").slice(0, 160);
      groups.set(k, (groups.get(k) ?? 0) + 1);
    }
    out.push(`-- ${c}`);
    for (const [k, n] of [...groups].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, top)) out.push(`  ${n} ${k}`);
  }
  return out;
}
