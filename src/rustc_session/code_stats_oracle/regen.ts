// Rewrites the committed oracle output of ../code_stats.oracle.test.ts (lane fixers-49; not a port).
//   bun src/rustc_session/code_stats_oracle/regen.ts
//
// Writes oracle/<ORACLE> from the pinned rustc: the exit code on the first line, then stdout (the `print-type-size` lines),
// unchanged. The oracle must print nothing on stderr.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../../../scripts/lib/common.ts";
import { args, HERE, ORACLE, test_env } from "./common.ts";

const out = join(DATA, "tmp", "code-stats-oracle", process.env.RUST_TS_AGENT ?? "default");
rmSync(out, { recursive: true, force: true });
mkdirSync(join(HERE, "oracle"), { recursive: true });
const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, ...args(out)], { cwd: HERE, env: test_env(), stdout: "pipe", stderr: "pipe" });
if (r.stderr.length !== 0) throw new Error(`ERROR: unexpected stderr from the oracle: ${r.stderr.toString().slice(0, 200)}`);
writeFileSync(join(HERE, "oracle", ORACLE), `${r.exitCode}\n${r.stdout.toString()}`);
