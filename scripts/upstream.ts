// Pinned upstream rust-lang/rust checkout (read-only reference + test corpus).
//   bun scripts/upstream.ts fetch    blobless sparse clone at the pin into $RUST_TS_DATA/rust, plus UPSTREAM.json's
//                                    submodules (shallow, at their recorded commits)
//   bun scripts/upstream.ts status   pin vs checkout vs oracle toolchain
import { existsSync } from "node:fs";
import { DATA, PIN, UPSTREAM, die, ensureDir, run } from "./lib/common.ts";

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
  for (const m of PIN.submodules ?? []) {
    const st = existsSync(UPSTREAM) ? await git(["submodule", "status", "--", m]) : `-(no checkout) ${m}`;
    const ok = st !== "" && !/^[-+U]/.test(st);
    console.log(`${ok ? "ok   " : "ERROR:"} submodule ${st}${ok ? "" : "  (run: bun scripts/upstream.ts fetch)"}`);
  }
} else {
  console.log("usage: bun scripts/upstream.ts fetch | status");
}
