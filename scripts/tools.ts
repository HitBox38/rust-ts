// The tool oracles' setup and check (plan-m8 D2, lane harness-m8a-gate; see scripts/lib/tool-oracles.ts).
//
//   bun scripts/tools.ts setup [--from <dir>]
//       for each tool of UPSTREAM.json rust.tools: download its tarball (the only networked step; `--from <dir>`: take the file of the
//       same name from <dir> instead), check its SHA-256 against the pin, unpack it into $RUST_TS_DATA/tools/<sha256>/ (in a temp
//       directory beside it, then one rename, so a failed setup leaves nothing half made), and keep the tarball there. Then the guard.
//       A tool already set up with the pinned hash is kept. About 20 MB.
//   bun scripts/tools.ts check
//       the guard alone (`toolGuardErrors`) and the oracle toolchain's component check; exit 1 on a problem.
//
// The oracle toolchain is never touched: its component check runs before and after setup, and nothing here runs rustup.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { DATA, PIN, die, parseArgs, run } from "./lib/common.ts";
import { HOST_TOOL_GUARD_IO, oracleHost, oracleSysroot, toolPinsOrDie } from "./lib/oracle.ts";
import { TOOL_NAMES, sha256, tarballName, toolDir, toolGuardErrors, toolsRoot, toolSetUp, unpackedName } from "./lib/tool-oracles.ts";
import { oracleToolchainError } from "./lib/toolchain.ts";

/** The oracle toolchain's component check, fresh (as scripts/miri.ts `oracleClean`). */
function oracleClean(when: string): void {
  const sysroot = oracleSysroot();
  const bad = oracleToolchainError(sysroot, PIN.components, oracleHost(), basename(sysroot));
  if (bad !== undefined) die(`${when}: ${bad}`);
}

/** The guard; prints one line per problem, and `ok` when there is none. */
function check(): boolean {
  const errors = toolGuardErrors(DATA, toolPinsOrDie(), oracleSysroot(), PIN.commit, HOST_TOOL_GUARD_IO);
  for (const e of errors) console.log(`ERROR: ${e}`);
  if (errors.length === 0) console.log(`ok    tool oracles (${TOOL_NAMES.join(", ")}) under ${toolsRoot(DATA)}: pinned tarballs, their binaries, on the oracle's librustc_driver`);
  return errors.length === 0;
}

async function setup(from: string | undefined): Promise<void> {
  oracleClean("before setup");
  const pins = toolPinsOrDie();
  mkdirSync(toolsRoot(DATA), { recursive: true });
  for (const tool of TOOL_NAMES) {
    const pin = pins[tool];
    const dir = toolDir(DATA, pin);
    if (toolSetUp(DATA, pin) && sha256(readFileSync(join(dir, tarballName(pin)))) === pin.sha256) {
      console.log(`ok    ${tool}: kept ${dir}`);
      continue;
    }
    const tmp = mkdtempSync(join(toolsRoot(DATA), `.setup-${tool}-`));
    // `die` exits at once, past any `finally`: the temp directory goes first.
    const fail = (msg: string): never => {
      rmSync(tmp, { recursive: true, force: true });
      return die(msg);
    };
    try {
      const file = join(tmp, tarballName(pin));
      if (from !== undefined) copyFileSync(join(from, tarballName(pin)), file);
      else {
        const r = await run(["/usr/bin/curl", "-fsSL", "--retry", "3", "-o", file, pin.url], { timeoutMs: 600_000 });
        if (r.code !== 0) fail(`${tool}: download of ${pin.url} failed (exit ${r.code}): ${r.stderr.trim().slice(0, 300)}`);
      }
      const got = sha256(readFileSync(file));
      if (got !== pin.sha256) fail(`${tool}: ${from !== undefined ? join(from, tarballName(pin)) : pin.url} has SHA-256 ${got}, not the pinned ${pin.sha256} (UPSTREAM.json rust.tools.${tool})`);
      const x = await run(["/usr/bin/tar", "-xJf", file, "-C", tmp], { timeoutMs: 600_000 });
      if (x.code !== 0) fail(`${tool}: unpacking ${file} failed (exit ${x.code}): ${x.stderr.trim().slice(0, 300)}`);
      if (!existsSync(join(tmp, unpackedName(pin)))) fail(`${tool}: ${tarballName(pin)} has no top directory ${unpackedName(pin)}/`);
      // A directory left by an earlier, broken setup is replaced whole.
      rmSync(dir, { recursive: true, force: true });
      renameSync(tmp, dir);
      console.log(`ok    ${tool}: ${dir}`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  oracleClean("after setup");
  if (!check()) process.exit(1);
}

if (import.meta.main) {
  const a = parseArgs(process.argv.slice(2));
  const cmd = a._[0];
  if (cmd === "setup") await setup(typeof a.from === "string" ? a.from : undefined);
  else if (cmd === "check") {
    oracleClean("check");
    if (!check()) process.exit(1);
  } else console.log("usage: bun scripts/tools.ts setup [--from <dir>] | check");
}
