// Pinned upstream rust-lang/rust checkout (read-only reference + test corpus).
//   bun scripts/upstream.ts fetch    blobless sparse clone at the pin into $RUST_TS_DATA/rust, plus UPSTREAM.json's
//                                    submodules (shallow, at their recorded commits)
//   bun scripts/upstream.ts status   pin vs checkout vs oracle toolchain; each sparse path checked out; UPSTREAM.json `cargo`'s
//                                    commit vs the checkout's `src/tools/cargo` gitlink (plan-m8 D3; its source: scripts/tools-src.ts)
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN, REPO, UPSTREAM, die, ensureDir, run } from "./lib/common.ts";

async function git(args: string[], cwd = UPSTREAM) {
  const r = await run(["git", ...args], { cwd });
  if (r.code !== 0) die(`git ${args.join(" ")}: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

const cmd = process.argv[2];
if (cmd === "fetch") {
  ensureDir(DATA);
  if (!existsSync(UPSTREAM)) {
    console.log(`cloning ${PIN.repo} (sparse, blobless) into ${UPSTREAM} ...`);
    await git(["clone", "--filter=blob:none", "--no-checkout", "--sparse", PIN.repo, UPSTREAM], DATA);
  }
  await git(["sparse-checkout", "set", ...PIN.sparse]);
  await git(["fetch", "--depth", "1", "--filter=blob:none", "origin", PIN.commit]);
  await git(["checkout", "--quiet", PIN.commit]);
  // (`protocol.file.allow=never`: a submodule URL is always fetched over the network, never from a local path.)
  for (const m of PIN.submodules ?? []) await git(["-c", "protocol.file.allow=never", "submodule", "update", "--init", "--depth", "1", "--", m]);
  console.log(`upstream at ${await git(["rev-parse", "HEAD"])}`);
} else if (cmd === "status") {
  const head = existsSync(UPSTREAM) ? await git(["rev-parse", "HEAD"]) : "(missing)";
  const o = await run(["rustc", `+${PIN.toolchain}`, "-vV"]);
  const oracle = /commit-hash: (\w+)/.exec(o.stdout)?.[1] ?? "(unavailable)";
  console.log(`pin:      ${PIN.commit} (${PIN.release}, ${PIN.nightlyName})`);
  console.log(`${head === PIN.commit ? "ok   " : "ERROR:"} checkout ${head}  (${UPSTREAM})`);
  console.log(`${oracle === PIN.commit ? "ok   " : "ERROR:"} oracle   ${oracle}  (rustc +${PIN.toolchain})`);
  // `git submodule status` (trimmed): a leading '-' = not initialized, '+' = at another commit, 'U' = conflicts;
  // none = checked out at the recorded commit.
  // Each sparse path (plan-m8 D3 added src/tools/clippy and src/tools/rustfmt): in the checkout's sparse set and on disk. With HEAD at
  // the pin (above), its files are the pin's.
  const sparse = existsSync(UPSTREAM) ? new Set((await git(["sparse-checkout", "list"])).split("\n")) : new Set<string>();
  const missing = PIN.sparse.filter((p) => !sparse.has(p) || !existsSync(join(UPSTREAM, p)));
  if (missing.length === 0) console.log(`ok    sparse: ${PIN.sparse.length} paths checked out`);
  else console.log(`ERROR: sparse path(s) not checked out: ${missing.join(", ")}  (run: bun scripts/upstream.ts fetch)`);
  // UPSTREAM.json `cargo` (plan-m8 D3) must be the commit the pin's `src/tools/cargo` gitlink records.
  const cargoPin = (JSON.parse(readFileSync(join(REPO, "UPSTREAM.json"), "utf8")) as { cargo?: { commit?: string } }).cargo?.commit;
  const gitlink = existsSync(UPSTREAM) ? /^160000 commit (\w+)\t/.exec(await git(["ls-tree", "HEAD", "src/tools/cargo"]))?.[1] : undefined;
  console.log(`${cargoPin !== undefined && cargoPin === gitlink ? "ok   " : "ERROR:"} cargo    ${cargoPin ?? "(no UPSTREAM.json cargo)"}  (gitlink src/tools/cargo: ${gitlink ?? "(unavailable)"})`);
  for (const m of PIN.submodules ?? []) {
    const st = existsSync(UPSTREAM) ? await git(["submodule", "status", "--", m]) : `-(no checkout) ${m}`;
    const ok = st !== "" && !/^[-+U]/.test(st);
    console.log(`${ok ? "ok   " : "ERROR:"} submodule ${st}${ok ? "" : "  (run: bun scripts/upstream.ts fetch)"}`);
  }
} else {
  console.log("usage: bun scripts/upstream.ts fetch | status");
}
