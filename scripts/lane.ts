// Per-agent git worktrees ("lanes"), created under $RUST_TS_LANES (default $RUST_TS_DATA/lanes).
//
//   bun scripts/lane.ts new <name> [--from <ref>]   worktree on branch lane/<name>, deps + .env.local ready
//   bun scripts/lane.ts list
//   bun scripts/lane.ts merge <name>                 real merge of lane/<name> into the current branch (root only)
//   bun scripts/lane.ts rm <name>                    remove the worktree (branch is kept)
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { LANES, REPO, die, ensureDir, parseArgs, run } from "./lib/common.ts";

async function git(args: string[], cwd = REPO): Promise<string> {
  const r = await run(["git", ...args], { cwd });
  if (r.code !== 0) die(`git ${args.join(" ")}: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}

const a = parseArgs(process.argv.slice(2));
const [cmd, name] = a._;
const dir = name ? join(LANES, name) : "";

if (cmd === "new" && name) {
  if (existsSync(dir)) die(`lane ${name} already exists at ${dir}`);
  ensureDir(LANES);
  const from = typeof a.from === "string" ? a.from : "HEAD";
  await git(["worktree", "add", "-b", `lane/${name}`, dir, from]);
  if (existsSync(join(REPO, ".env.local"))) copyFileSync(join(REPO, ".env.local"), join(dir, ".env.local"));
  const r = await run(["bun", "install", "--frozen-lockfile"], { cwd: dir });
  if (r.code !== 0) die(`bun install failed in ${dir}: ${r.stderr}`);
  console.log(`lane ${name}: ${dir} (branch lane/${name} from ${from})`);
} else if (cmd === "list") {
  console.log(await git(["worktree", "list"]));
} else if (cmd === "merge" && name) {
  await git(["merge", "--no-ff", "--no-edit", `lane/${name}`]);
  console.log(`merged lane/${name} into ${await git(["rev-parse", "--abbrev-ref", "HEAD"])}`);
} else if (cmd === "rm" && name) {
  await git(["worktree", "remove", "--force", dir]);
  console.log(`removed ${dir} (branch lane/${name} kept)`);
} else {
  console.log("usage: bun scripts/lane.ts new <name> [--from ref] | list | merge <name> | rm <name>");
}
