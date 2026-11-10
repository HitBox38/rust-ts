// The subject binary's builder (lane subject-bin; scripts/lib/subject-bin.ts has the design).
//
//   bun scripts/subject-bin.ts build [--entry src/rust_ts/main.ts] [--json]
//       the build of the entry for this tree, from $RUST_TS_DATA/subject-bin or built now; prints its path and hash
//       (`--json`: one JSON line, what scripts/lib/subject-bin.ts `subjectBin` reads). A failure is one `ERROR:` line, exit 1.
//   bun scripts/subject-bin.ts list      the cached builds
//   bun scripts/subject-bin.ts prune     removes builds no run has used for 3 days
//
// The harness picks the mode with RUST_TS_SUBJECT=binary|source (default: scripts/lib/subject-bin.ts `DEFAULT_SUBJECT_MODE`).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "./lib/common.ts";
import { BINARY_ENTRIES, PRUNE_AFTER_MS, binaryModeRefusal, SUBJECT_BIN_DIR, ensureSubjectBin, pruneSubjectBins, type SubjectBinMeta } from "./lib/subject-bin.ts";

const a = parseArgs(process.argv.slice(2));
const cmd = a._[0];

if (cmd === "build") {
  const entry = typeof a.entry === "string" ? a.entry : BINARY_ENTRIES[0]!;
  if (!BINARY_ENTRIES.includes(entry)) {
    console.log(`ERROR: ${entry} is not a subject entry with a binary (scripts/lib/subject-bin.ts BINARY_ENTRIES: ${BINARY_ENTRIES.join(", ")})`);
    process.exit(1);
  }
  const refused = binaryModeRefusal();
  if (refused !== undefined) {
    console.log(`ERROR: ${refused}`);
    process.exit(1);
  }
  let bin;
  try {
    bin = await ensureSubjectBin(entry);
  } catch (e) {
    console.log(`ERROR: subject binary of ${entry}: ${(e instanceof Error ? e.message : String(e)).replace(/\s*\n\s*/g, " ")}`);
    process.exit(1);
  }
  if (bin.built) pruneSubjectBins([bin.dir]);
  if (a.json) console.log(JSON.stringify(bin));
  else console.log(`${bin.built ? "built" : "cached"} ${entry}: ${bin.path} (hash ${bin.hash}, ${bin.inputs} files)`);
} else if (cmd === "list") {
  if (!existsSync(SUBJECT_BIN_DIR)) console.log("no builds");
  else {
    for (const name of readdirSync(SUBJECT_BIN_DIR).sort()) {
      const meta = join(SUBJECT_BIN_DIR, name, "meta.json");
      if (!existsSync(meta)) {
        console.log(`${name} (unfinished)`);
        continue;
      }
      const m = JSON.parse(readFileSync(meta, "utf8")) as SubjectBinMeta;
      console.log(`${name} ${m.entry} built ${m.builtAt} last used ${statSync(meta).mtime.toISOString()} (${m.inputs.length} files, bun ${m.bun.version})`);
    }
  }
} else if (cmd === "prune") {
  const removed = pruneSubjectBins([], PRUNE_AFTER_MS);
  console.log(`removed ${removed.length} build(s)`);
} else {
  console.log("usage: bun scripts/subject-bin.ts build [--entry <entry>] [--json] | list | prune");
  process.exit(cmd === undefined ? 0 : 1);
}
