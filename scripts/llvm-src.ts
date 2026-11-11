// The LLVM sources the IR model (src/rust_ts/llvm/, plan-m7 D5) ports from: the files of harness/llvm-manifest.json, at the
// commit of the rust checkout's `src/llvm-project` gitlink, by path and SHA-256 (lane scope-m7, review plan-m7 F6 item 1).
// They live under `$RUST_TS_DATA/llvm-src/<commit>/<path>`; the submodule stays out of the sparse checkout (D5).
//   bun scripts/llvm-src.ts fetch          fetch the missing or different manifest files (raw.githubusercontent.com), each
//                                          checked against its SHA-256 before it is moved into place
//   bun scripts/llvm-src.ts check          the manifest's commit is the checkout's gitlink, every file is present and pinned
//   bun scripts/llvm-src.ts add <path>...  fetch new files at the commit and record their SHA-256 in the manifest; the paths
//                                          are checked first, and all are downloaded before any is written (review scope-m7 N3)
// `// llvm:` markers are checked by `bun scripts/coverage.ts --check` (scripts/lib/llvm-src.ts).
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DATA, PIN, REPO, UPSTREAM, die, run } from "./lib/common.ts";
import { LLVM_MANIFEST, type LlvmManifest, addFiles, addPathErrors, fileStates, llvmSrcDir, rawUrl, readManifest, sha256 } from "./lib/llvm-src.ts";

const manifestFile = join(REPO, LLVM_MANIFEST);

async function download(m: LlvmManifest, path: string): Promise<Uint8Array> {
  const r = await fetch(rawUrl(m, path));
  if (!r.ok) die(`${path}: HTTP ${r.status} from ${rawUrl(m, path)}`);
  return new Uint8Array(await r.arrayBuffer());
}

/** Write `bytes` to `<dir>/<path>` through a temporary file, so a reader never sees a partial file. */
function place(dir: string, path: string, bytes: Uint8Array) {
  const f = join(dir, path);
  mkdirSync(dirname(f), { recursive: true });
  const tmp = `${f}.tmp-${process.pid}`;
  writeFileSync(tmp, bytes);
  renameSync(tmp, f);
}

/** The commit of `src/llvm-project` in the pinned rust tree (its gitlink), or undefined if the checkout cannot say. */
async function gitlink(): Promise<string | undefined> {
  const r = await run(["git", "ls-tree", PIN.commit, "src/llvm-project"], { cwd: UPSTREAM });
  return r.code === 0 ? /^160000 commit ([0-9a-f]{40})\tsrc\/llvm-project$/m.exec(r.stdout)?.[1] : undefined;
}

let m: LlvmManifest;
try {
  m = readManifest(manifestFile);
} catch (e) {
  die(String((e as Error).message));
}
const dir = llvmSrcDir(DATA, m);
const cmd = process.argv[2];
if (cmd === "fetch") {
  let fetched = 0;
  for (const s of fileStates(m, dir)) {
    if (s.state === "ok") continue;
    const bytes = await download(m, s.path);
    const h = sha256(bytes);
    if (h !== m.files[s.path]) die(`${s.path}: fetched SHA-256 ${h}, the manifest pins ${m.files[s.path]}`);
    place(dir, s.path, bytes);
    fetched++;
  }
  console.log(`llvm-src: ${Object.keys(m.files).length} files at ${m.commit.slice(0, 12)} in ${dir} (${fetched} fetched)`);
} else if (cmd === "check") {
  const link = await gitlink();
  let bad = 0;
  if (link === undefined) console.log(`ERROR: no src/llvm-project gitlink at ${PIN.commit.slice(0, 12)} in ${UPSTREAM}`), bad++;
  else if (link !== m.commit) console.log(`ERROR: ${LLVM_MANIFEST} commit ${m.commit} is not the checkout's src/llvm-project gitlink ${link}`), bad++;
  for (const s of fileStates(m, dir)) if (s.state !== "ok") console.log(`ERROR: ${s.path}: ${s.state}; run: bun scripts/llvm-src.ts fetch`), bad++;
  if (bad) process.exit(1);
  console.log(`llvm-src ok: ${Object.keys(m.files).length} files at ${m.commit.slice(0, 12)} (the checkout's gitlink)`);
} else if (cmd === "add") {
  const paths = process.argv.slice(3);
  if (!paths.length) die("usage: bun scripts/llvm-src.ts add <path>...");
  // Before anything else: no request for, and no write of, a path outside llvm-src/<commit>/.
  const bad = addPathErrors(paths);
  if (bad.length) die(`add: ${bad.join("; ")}; nothing fetched or written`);
  const link = await gitlink();
  if (link !== m.commit) die(`${LLVM_MANIFEST} commit ${m.commit} is not the checkout's src/llvm-project gitlink ${link ?? "(none)"}`);
  let files: Record<string, string>;
  try {
    files = await addFiles(m, paths, (p) => download(m, p), (p, bytes) => place(dir, p, bytes));
  } catch (e) {
    die(String((e as Error).message));
  }
  const next = { ...(JSON.parse(readFileSync(manifestFile, "utf8")) as object), files };
  // Validated before it replaces the manifest.
  const tmp = `${manifestFile}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
  try {
    readManifest(tmp);
    renameSync(tmp, manifestFile);
  } catch (e) {
    rmSync(tmp, { force: true });
    die(String((e as Error).message));
  }
  console.log(`llvm-src: added ${paths.length} files; ${Object.keys(files).length} in ${LLVM_MANIFEST}`);
} else {
  die("usage: bun scripts/llvm-src.ts fetch | check | add <path>...");
}
