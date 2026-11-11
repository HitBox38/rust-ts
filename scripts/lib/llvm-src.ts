// The LLVM sources the IR model ports from, and the markers that point at C++ (lane scope-m7, review plan-m7 F6 item 1).
// No import of common.ts, so its tests run in-process.
//
// harness/llvm-manifest.json pins files of `rust-lang/llvm-project` at the commit of the rust checkout's `src/llvm-project`
// gitlink, by path and SHA-256; `bun scripts/llvm-src.ts fetch` puts them under `$RUST_TS_DATA/llvm-src/<commit>/<path>`.
//
// `// llvm: <path>:<line> <name>` (`<path>` relative to the llvm-project root, e.g. `llvm/lib/IR/Core.cpp`): line <line> of
// that manifest file must hold the definition of C++ function `<name>` (scripts/lib/cpp-fns.ts: the name as written, such as
// `ConstantInt::get`, or its last segment). Not ported rustc code, so not counted in the coverage tables.
// `// rustc: compiler/rustc_llvm/llvm-wrapper/<file>:<line> <name>` (`.cpp` or `.h`): rustc's C++ wrappers, in the checkout
// at the pin. `rustc_llvm` stays excluded from the compiler TOTAL; these markers are checked the same way and counted in a
// separate WRAPPER figure over every function of llvm-wrapper/.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { type CppFn, cppFns, cppNameMatches } from "./cpp-fns.ts";

export interface LlvmManifest {
  repo: string;
  commit: string;
  /** `<path>` (relative to the llvm-project root) -> SHA-256 of the file at `commit`, lowercase hex. */
  files: Record<string, string>;
}

/** The manifest's repo-relative path. */
export const LLVM_MANIFEST = "harness/llvm-manifest.json";

/** One message per malformed part of a parsed manifest. */
export function manifestErrors(m: unknown): string[] {
  const out: string[] = [];
  const o = m as Partial<LlvmManifest> | null;
  if (o === null || typeof o !== "object") return [`${LLVM_MANIFEST}: not an object`];
  if (typeof o.repo !== "string" || !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(o.repo)) out.push(`${LLVM_MANIFEST}: repo ${JSON.stringify(o.repo)} is not https://github.com/<owner>/<name>`);
  if (typeof o.commit !== "string" || !/^[0-9a-f]{40}$/.test(o.commit)) out.push(`${LLVM_MANIFEST}: commit ${JSON.stringify(o.commit)} is not a full 40-hex commit`);
  if (o.files === null || typeof o.files !== "object") return [...out, `${LLVM_MANIFEST}: files is not an object`];
  for (const [p, h] of Object.entries(o.files)) {
    if (!safeRel(p)) out.push(`${LLVM_MANIFEST}: path ${JSON.stringify(p)} is not a relative path inside llvm-project`);
    if (typeof h !== "string" || !/^[0-9a-f]{64}$/.test(h)) out.push(`${LLVM_MANIFEST}: ${p}: ${JSON.stringify(h)} is not a SHA-256`);
  }
  return out;
}

const safeRel = (p: string): boolean => p !== "" && !p.startsWith("/") && !p.includes("\\") && !p.split("/").some((s) => s === "" || s === "." || s === "..");

/** The manifest at `file`, or a thrown Error naming what is wrong with it. */
export function readManifest(file: string): LlvmManifest {
  const m = JSON.parse(readFileSync(file, "utf8")) as unknown;
  const errs = manifestErrors(m);
  if (errs.length) throw new Error(errs.join("; "));
  return m as LlvmManifest;
}

/** Where the manifest's files live under `data` (`$RUST_TS_DATA`). */
export const llvmSrcDir = (data: string, m: LlvmManifest): string => join(data, "llvm-src", m.commit);

/** The URL a manifest file is fetched from. */
export function rawUrl(m: LlvmManifest, path: string): string {
  const [owner, name] = m.repo.replace(/^https:\/\/github\.com\//, "").split("/");
  return `https://raw.githubusercontent.com/${owner}/${name}/${m.commit}/${path}`;
}

export const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** Each manifest file's state under `dir`: present with the pinned hash, missing, or different. */
export function fileStates(m: LlvmManifest, dir: string): { path: string; state: "ok" | "missing" | "mismatch" }[] {
  return Object.entries(m.files).map(([path, h]) => {
    const f = join(dir, path);
    if (!existsSync(f)) return { path, state: "missing" };
    return { path, state: sha256(readFileSync(f)) === h ? "ok" : "mismatch" };
  });
}

export interface CppMarker {
  file: string;
  path: string;
  line: number;
  name: string;
}

/**
 * The `// llvm:` markers of TS source `text` (file `rel`) and one message per malformed one: any spacing reaches the strict
 * pattern, so `//llvm: ...` is a typo to report, not prose.
 */
export function llvmMarkersOf(text: string, rel: string): { markers: CppMarker[]; errors: string[] } {
  const markers: CppMarker[] = [];
  const errors: string[] = [];
  if (!/\/\/\s*llvm:/.test(text)) return { markers, errors };
  text.split("\n").forEach((l, i) => {
    if (!/^\s*\/\/\s*llvm:/.test(l)) return;
    const m = /^\s*\/\/ llvm: (\S+):(\d+) (\S+)(?:\s|$)/.exec(l);
    if (m === null) return void errors.push(`${rel}:${i + 1}: malformed llvm marker: ${l.trim().slice(0, 100)}`);
    markers.push({ file: rel, path: m[1]!, line: Number(m[2]), name: m[3]! });
  });
  return { markers, errors };
}

/**
 * One message per `// llvm:` marker that names no definition in the manifest's files under `dir`: a path the manifest does
 * not list, a file missing or with another hash (fetch it), or no C++ function of that name at that line.
 */
export function llvmMarkerErrors(markers: readonly CppMarker[], m: LlvmManifest, dir: string): string[] {
  const out: string[] = [];
  const states = new Map(fileStates(m, dir).filter((s) => markers.some((k) => k.path === s.path)).map((s) => [s.path, s.state]));
  const fns = new Map<string, CppFn[]>();
  for (const k of markers) {
    const at = `${k.file}: marker ${k.path}:${k.line} ${k.name}`;
    if (!(k.path in m.files)) {
      out.push(`${at} names no file of ${LLVM_MANIFEST}`);
      continue;
    }
    const st = states.get(k.path);
    if (st !== "ok") {
      out.push(`${at}: ${join(dir, k.path)} is ${st === "missing" ? "missing" : "not the pinned file (SHA-256 differs)"}; run: bun scripts/llvm-src.ts fetch`);
      continue;
    }
    if (!fns.has(k.path)) fns.set(k.path, cppFns(readFileSync(join(dir, k.path), "utf8"), k.path));
    if (!fns.get(k.path)!.some((f) => f.line === k.line && cppNameMatches(f, k.name))) out.push(`${at} matches no C++ function definition`);
  }
  return out;
}

/** rustc's C++ wrappers, upstream-relative. */
export const WRAPPER_ROOT = "compiler/rustc_llvm/llvm-wrapper";

/** Whether a `// rustc:` marker path points into the wrappers (a `.cpp` or `.h` under WRAPPER_ROOT). */
export const isWrapperPath = (path: string): boolean => path.startsWith(`${WRAPPER_ROOT}/`) && /\.(?:cpp|h)$/.test(path) && safeRel(path);

/** Every `.cpp` / `.h` under WRAPPER_ROOT of the checkout at `root`, as sorted upstream-relative paths. */
export function wrapperFiles(root: string): string[] {
  const dir = join(root, WRAPPER_ROOT);
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(?:cpp|h)$/.test(e.name)) out.push(relative(root, p).replaceAll("\\", "/"));
    }
  };
  walk(dir);
  return out.sort();
}

/** The C++ functions of an upstream-relative wrapper file in the checkout at `root`. */
export const wrapperFns = (root: string, path: string): CppFn[] => cppFns(readFileSync(join(root, path), "utf8"), path);

/** One message per wrapper marker that names no C++ function definition of the checkout at `root`. */
export function wrapperMarkerErrors(markers: readonly CppMarker[], root: string): string[] {
  const out: string[] = [];
  const fns = new Map<string, CppFn[]>();
  for (const k of markers) {
    if (!isWrapperPath(k.path)) continue;
    const at = `${k.file}: marker ${k.path}:${k.line} ${k.name}`;
    if (!existsSync(join(root, k.path))) {
      out.push(`${at} names no file of the upstream checkout`);
      continue;
    }
    if (!fns.has(k.path)) fns.set(k.path, wrapperFns(root, k.path));
    if (!fns.get(k.path)!.some((f) => f.line === k.line && cppNameMatches(f, k.name))) out.push(`${at} matches no C++ function definition`);
  }
  return out;
}
