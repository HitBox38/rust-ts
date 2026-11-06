// The normal form of a module's LLVM IR text (plan-m7 §1b, D2; review plan-m7 F1, F10; lane harness-m7a). Both sides of an IR
// comparison go through the same steps, so an equal normal form means the two texts parse to one module, up to what is
// listed below. Run by scripts/ir-run.ts. No imports beyond node:.
//
// **N1, the target (the plan's form):** `opt -passes=assign-guid,verify -S`, then the two strips below.
//   What it discards, and why that is safe:
//   - Comments: every line starting with `; `. They are the annotation writer's demangled names and `; call ...`
//     (PassWrapper.cpp:1067), and opt's `; ModuleID`, `; Function Attrs:` (the attributes themselves stay, on the
//     definition). `opt -S` writes every construct on one line, with newlines in strings as `\0A`, so no such line can be
//     part of a string.
//   - `; preds = ...` tails, **only on block label lines** (F10: unanchored, the strip ate a global's `align` after a
//     string holding that text). Which blocks precede a block is in the code; the tail's order is the use-list order,
//     which text does not carry, and which the port's pipeline loses too, since it reads text.
//   - What the parser itself normalises, by reading into one in-memory form: attribute group and metadata numbers and
//     their placement; unused attribute groups and metadata; attributes on intrinsic declarations (the parser replaces
//     them, so a wrong `noreturn` there is ignored by every tool that reads the text); default alignments on `load`,
//     `store` and `alloca`; `dso_local` implied by a linkage; constant expressions the parser folds; a struct type no one uses;
//     and its auto-upgrades, each of which parses to one module, so nothing downstream of the text can tell them apart: `PIC Level`
//     and `PIE Level` module flags' behaviour (Min to Max), `nocapture` for `captures(none)` (review harness-m7a H10).
//   - A missing `!guid` (`assign-guid` adds it, as LLVMRustOptimize does), not always: on a program with an `lto` flag some functions the
//     text shows as `internal` keep the guid they got before internalisation, evidently (`tests/ui/sanitizer/cfi/coroutine.rs#cfi`: removing
//     every `!guid` leaves 7 of 229 different, `main`, `lang_start` and the allocator shims; review H10 did not trace it). That is a false
//     difference, never a hidden one, but `llir-*` should know: for those cases, at most 37, the port cannot leave `!guid` to `assign-guid`.
//     A present and wrong `!guid` stays visible.
//   What it keeps: order of globals, functions, declarations, blocks and instructions; local value and block names,
//   including LLVM's collision suffixes; every flag, attribute and alignment that is not a default; folded constants;
//   datalayout, triple, `source_filename`, module flags; `; No predecessors!` (a function of the code). `verify` rejects an
//   invalid module, and that is reported, never hidden.
//
// **N2 = N1 + `--discard-value-names`** (through `llvm-as`, as opt refuses text in that mode). It also discards the names of
//   locals: instructions, arguments and blocks, so they print by number. It absorbs a wrong collision suffix, and any other
//   wrong local name. Globals keep their names (`Value::setName` discards only non-globals). Order, flags and attributes stay.
//   **The bitcode path must not absorb more:** the bitcode reader upgrades a target's data layout string
//   (`UpgradeDataLayoutString`, so a missing `-i128:128` comes back), which the text parser does not do. So N2 and N3 start with
//   the input's own `target datalayout` and `target triple` lines. scripts/ir-tiers.ts checks on real IR that a bitcode round
//   trip with names kept gives N1's text, so names are all this path gives up.
//
// **N3 = N2 + `function(instsimplify)`.** It also absorbs what instsimplify removes:
//   - an instruction folded away, so a missed builder fold, with whatever flags that instruction carried (F1: a dropped `nuw`
//     on a GEP with a zero index). Where a wrong instruction simplifies to the right value, **a real wrong flag or a
//     wrong operand on it is absorbed**, which is why N3 is a fallback, not the target;
//   - a trivially dead instruction (`isInstructionTriviallyDead`), so a wrong instruction whose result is never used.
//   Everything that survives the pass is compared as in N2. scripts/ir-tiers.ts measures how often a single wrong site is
//   absorbed; docs/handoff/harness-m7a.md has the figures.
//
// The rule for choosing a tier is F1's, recorded before wave 41: N1 is the target; if `ir-run-pass` is under 95% on N1 at M7c's
// gate and at least half of the failures are model behaviour, gate on N2 (names) or N3 (not names), each one recorded
// decision; behaviour is never the only gate on codegen; under 95% on N3 is a STOP. **What holds it (review harness-m7a H3):** every IR suite
// names its tier (`Suite.irTier`, which is in its oracle key, summaries, gate.json and the accept record), and a unit test in the gate's static step
// fails on anything but N1 without the decision `irTierError` names. Another tier of a suite is a report: `difftest --suite <s> --ir-tier <t>`,
// under a name no gate or baseline takes, for the lost tier and for M7b's three.
import { join } from "node:path";

export const IR_TIERS = ["N1", "N2", "N3"] as const;
export type IrTier = (typeof IR_TIERS)[number];
export const isIrTier = (t: string): t is IrTier => (IR_TIERS as readonly string[]).includes(t);

const OPT_PASSES: Record<IrTier, string> = { N1: "assign-guid,verify", N2: "assign-guid,verify", N3: "assign-guid,function(instsimplify),verify" };

/** F1's rule on one suite. `history`: docs/state/history.jsonl. One line (no `ERROR:` prefix) if `tier` needs a decision that is not recorded. */
export function irTierError(suite: string, tier: IrTier, history: string): string | undefined {
  if (tier === "N1") return undefined;
  const named = `IR tier: ${suite} at ${tier}:`;
  const records = history.split("\n").filter(Boolean).map((l) => JSON.parse(l) as { kind?: string; msg?: string });
  if (records.some((r) => r.kind === "decision" && r.msg?.startsWith(named))) return undefined;
  return `suite ${suite} is read at ${tier}, a weaker check than N1, with no recorded decision (review plan-m7 F1); record one: bun scripts/state.ts record decision "${named} <why>", or run it as a report: difftest --suite ${suite} --ir-tier ${tier}`;
}

/** A block label with its preds comment: an identifier or quoted name at the line start, a colon, then only the comment. */
const LABEL_PREDS = /^((?:[-a-zA-Z$._0-9]+|"[^"]*"):) +; preds = .*$/;

/** The strips of N1, on `opt -S`'s text. Latin-1 is safe on both sides: it maps bytes to one code unit each. */
export function stripIrComments(text: string): string {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("; ")) continue;
    const m = LABEL_PREDS.exec(line);
    out.push(m ? m[1]! : line);
  }
  return out.join("\n");
}

/** The first line of a tool's error, without the absolute path it starts with. */
const firstError = (tool: string, stderr: Uint8Array): string => {
  const s = Buffer.from(stderr).toString("latin1");
  const line = s.split("\n").find((l) => l.trim() !== "") ?? "(no message)";
  return line.includes(`/${tool}: `) ? `${tool}: ${line.slice(line.indexOf(`/${tool}: `) + tool.length + 3)}` : `${tool}: ${line}`;
};

/** The tool commands of a tier, for tests and error messages: `llvm-as` (N2, N3), then `opt`. */
export function tierCommands(tier: IrTier, bin: string): string[][] {
  const opt = [join(bin, "opt"), ...(tier === "N1" ? [] : ["--discard-value-names"]), `-passes=${OPT_PASSES[tier]}`, "-S", "-o", "-"];
  return tier === "N1" ? [opt] : [[join(bin, "llvm-as"), "-", "-o", "-"], opt];
}

/** The normal form of `ir` at `tier`, or the tool's first error line. `bin`: scripts/lib/llvm-tools.ts `llvmBinDir`. */
export async function normalForm(ir: Uint8Array, tier: IrTier, bin: string): Promise<{ text: string } | { error: string }> {
  let input = ir;
  for (const cmd of tierCommands(tier, bin)) {
    const p = Bun.spawn(cmd, { stdin: input, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr] = await Promise.all([new Response(p.stdout).bytes(), new Response(p.stderr).bytes()]);
    const code = await p.exited;
    const tool = cmd[0]!.slice(cmd[0]!.lastIndexOf("/") + 1);
    if (code !== 0) return { error: `${firstError(tool, stderr)} (exit ${code})` };
    input = stdout;
  }
  return { text: inputTargetLines(ir, tier) + stripIrComments(Buffer.from(input).toString("latin1")) };
}

/** N2 and N3: the input's own target lines, which the bitcode reader can change (see the header). */
function inputTargetLines(ir: Uint8Array, tier: IrTier): string {
  if (tier === "N1") return "";
  return [...Buffer.from(ir).toString("latin1").matchAll(/^target (?:datalayout|triple) = .*\n/gm)].map((m) => `input ${m[0]}`).join("");
}
