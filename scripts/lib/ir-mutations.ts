// Mutations of real oracle IR, each stated with what the normal form tiers must do with it (scripts/lib/ir-normal.ts). Read by
// scripts/ir-normal.test.ts (one program) and scripts/ir-tiers.ts (a sample of the run-pass corpus). The bugs are those of
// review plan-m7 F1 and its tier table, and F10's hole: what a wrong lowering in a port would write.
import type { IrTier } from "./ir-normal.ts";

export type Verdict = "caught" | "absorbed";

/** One place a mutation can change: replace `len` characters at `at` with `text`. */
export interface Edit {
  at: number;
  len: number;
  text: string;
}

export interface Mutation {
  name: string;
  /** What it stands for, in a sentence. */
  why: string;
  /**
   * Each independent place in the text; a swap or a renaming is one site, the whole text. The test applies all of them;
   * scripts/ir-tiers.ts also applies sampled ones alone.
   */
  sites(ir: string): Edit[];
  /** What each tier must do with it, applied to every site. */
  expect: Record<IrTier, Verdict>;
}

export function applyEdits(ir: string, edits: readonly Edit[]): string {
  let out = "";
  let pos = 0;
  for (const e of [...edits].sort((a, b) => a.at - b.at)) {
    out += ir.slice(pos, e.at) + e.text;
    pos = e.at + e.len;
  }
  return out + ir.slice(pos);
}

/** The matches of `re` (flags `gm`) as edits, each replaced by `to` (`$1` style, or a function of the match). */
const re = (r: RegExp, to: string | ((m: RegExpExecArray) => string)) => (ir: string): Edit[] =>
  [...ir.matchAll(r)].map((m) => ({ at: m.index, len: m[0].length, text: typeof to === "string" ? m[0].replace(new RegExp(r.source, r.flags.replace("g", "")), to) : to(m as RegExpExecArray) }));

/** Definition lines changed by `r` and `to`: one site per function. */
const onDefines = (r: RegExp, to: string) => (ir: string): Edit[] =>
  [...ir.matchAll(/^define .*$/gm)].flatMap((d) => {
    const text = d[0].replace(r, to);
    return text === d[0] ? [] : [{ at: d.index, len: d[0].length, text }];
  });

/** The whole text as one edit. */
const whole = (f: (ir: string) => string) => (ir: string): Edit[] => {
  const text = f(ir);
  return text === ir ? [] : [{ at: 0, len: ir.length, text }];
};

const lines = (ir: string) => ir.split("\n");
/** Swaps the first two lines matching `p`. */
const swapFirst = (p: (l: string) => boolean) =>
  whole((ir) => {
    const a = lines(ir);
    const i = a.findIndex(p);
    const j = a.findIndex((l, k) => k > i && p(l));
    if (i < 0 || j < 0) return ir;
    [a[i], a[j]] = [a[j]!, a[i]!];
    return a.join("\n");
  });

/** The local names of every definition get another spelling: what a wrong collision counter does to a whole function. */
function renameLocals(ir: string): string {
  let inFn = false;
  return lines(ir)
    .map((l) => {
      if (l.startsWith("define ")) inFn = true;
      if (!inFn) return l;
      if (l === "}") inFn = false;
      return l.replace(/%([A-Za-z_][\w.]*)/g, "%$1.w").replace(/^([A-Za-z_][\w.]*):/, "$1.w:");
    })
    .join("\n");
}

/** Swaps the two blocks after the entry of the first function that has them. */
function swapBlocks(ir: string): string {
  const a = lines(ir);
  const isLabel = (l: string) => /^[A-Za-z_][\w.]*:/.test(l);
  for (let i = 0; i < a.length; i++) {
    if (!a[i]!.startsWith("define ")) continue;
    let end = i;
    while (a[end] !== "}") end++;
    const labels: number[] = [];
    for (let k = i + 1; k < end; k++) if (isLabel(a[k]!)) labels.push(k);
    if (labels.length < 4) continue;
    const [p, q, r] = [labels[1]!, labels[2]!, labels[3]!];
    return [...a.slice(0, p), ...a.slice(q, r), ...a.slice(p, q), ...a.slice(r)].join("\n");
  }
  return ir;
}

const ALL: Record<IrTier, Verdict> = { N1: "caught", N2: "caught", N3: "caught" };
const NONE: Record<IrTier, Verdict> = { N1: "absorbed", N2: "absorbed", N3: "absorbed" };

/** Real bugs: every tier must report them. */
export const MUST_STAY_VISIBLE: Mutation[] = [
  { name: "noalias on every pointer parameter", why: "F1, unsound", sites: onDefines(/([(]|, )ptr (?!noalias)(?=[a-z%])/g, "$1ptr noalias "), expect: ALL },
  { name: "nuw nsw on every add, sub, mul", why: "F1, unsound", sites: re(/= (add|sub|mul) (?!nuw|nsw)/gm, "= $1 nuw nsw "), expect: ALL },
  { name: "!nonnull on every loaded pointer", why: "F1, unsound", sites: re(/(= load ptr, ptr %\S+, align \d+)(?![^\n]*!nonnull)/gm, "$1, !nonnull !{}"), expect: ALL },
  { name: "integer loads and stores claim align 16", why: "F1, over-alignment", sites: re(/((?:= load i\d+, ptr %\S+|store i\d+ \S+, ptr %\S+)), align \d+/gm, "$1, align 16"), expect: ALL },
  { name: "inbounds nuw on every inbounds GEP", why: "F1, unsound", sites: re(/= getelementptr inbounds (?!nuw)/gm, "= getelementptr inbounds nuw "), expect: ALL },
  { name: "signed compares become unsigned", why: "F1, signed as unsigned", sites: re(/icmp s(lt|gt|le|ge) /gm, "icmp u$1 "), expect: ALL },
  { name: "eq and ne swapped", why: "F1", sites: re(/icmp (eq|ne) /gm, (m) => `icmp ${m[1] === "eq" ? "ne" : "eq"} `), expect: ALL },
  { name: "sub i64 becomes add", why: "F1", sites: re(/= sub ((?:nuw |nsw )*)i64 /gm, "= add $1i64 "), expect: ALL },
  { name: "store i64 deleted", why: "F1", sites: re(/^ {2}store i64 .*\n/gm, ""), expect: ALL },
  { name: "lifetime markers dropped", why: "F1: behaviour cannot see it", sites: re(/^ {2}call void @llvm\.lifetime\..*\n/gm, ""), expect: ALL },
  { name: "readonly on every pointer parameter", why: "F1; the verifier may reject it, and that is a difference too", sites: onDefines(/([(]|, )ptr (?!readonly|writeonly)(?=[a-z%])/g, "$1ptr readonly "), expect: ALL },
  { name: "noalias dropped", why: "the tier table", sites: re(/ noalias /gm, " "), expect: ALL },
  { name: "load align 8 becomes 4", why: "the tier table", sites: re(/(= load \S+, ptr %\S+), align 8/gm, "$1, align 4"), expect: ALL },
  { name: "!noundef dropped", why: "the tier table", sites: re(/, !noundef !\d+/gm, ""), expect: ALL },
  { name: "nuw dropped on a GEP with a variable index", why: "the tier table's GEP, where nothing folds it", sites: re(/(= getelementptr inbounds) nuw (i8, ptr %\S+, i64 %\S+)$/gm, "$1 $2"), expect: ALL },
  { name: "two declarations swapped", why: "the tier table: order is kept", sites: swapFirst((l) => l.startsWith("declare") && !l.includes("@llvm.")), expect: ALL },
  { name: "two globals swapped", why: "order is kept", sites: swapFirst((l) => /^@\S+ = /.test(l)), expect: ALL },
  { name: "two definitions' first lines swapped", why: "a parse error or another program: a difference either way", sites: swapFirst((l) => l.startsWith("define ")), expect: ALL },
  { name: "two allocas swapped", why: "order is kept, at N2 too", sites: swapFirst((l) => /^ {2}%\S+ = alloca /.test(l)), expect: ALL },
  { name: "two blocks swapped", why: "layout order is kept, at N2 too", sites: whole(swapBlocks), expect: ALL },
  { name: "an unused declaration added", why: "the module's contents", sites: whole((ir) => `${ir}\ndeclare void @zz_unused()\n`), expect: ALL },
  { name: "triple changed", why: "the module's contents", sites: re(/^target triple = "[^"]+"/gm, 'target triple = "x86_64-unknown-freebsd"'), expect: ALL },
  { name: "datalayout changed", why: "the module's contents", sites: re(/-i128:128/gm, ""), expect: ALL },
  { name: "a wrong !guid", why: "assign-guid only fills in a missing one", sites: whole((ir) => { let n = 0; return ir.replace(/!guid !(\d+)/g, (m) => (n++ === 0 ? "!guid !{i64 1}" : m)); }), expect: ALL },
  // F10's hole: the literal holds `; preds = ...`, so an unanchored strip eats what follows it on the line.
  { name: "align after a string holding `; preds =`", why: "F10", sites: re(/(c"abc {2}; preds = %bb1, %bb2"), align 1/gm, "$1, align 64"), expect: ALL },
  { name: "section after a string holding `; preds =`", why: "F10", sites: re(/(c"abc {2}; preds = %bb1, %bb2"), align 1/gm, '$1, section "evil", align 1'), expect: ALL },
  { name: "text after `; preds =` in a string", why: "F10", sites: re(/c"abc {2}; preds = %bb1, %bb2"/gm, 'c"abc  ; preds = %bb1, %bb3"'), expect: ALL },
  { name: "text after a newline and `; ` in a string", why: "it must not read as a comment line", sites: re(/first\\0A; second/gm, "first\\0A; sEcond"), expect: ALL },
];

/** What a tier gives up by design: caught below it, absorbed from it on. */
export const TIER_ABSORBS: Mutation[] = [
  { name: "every local name wrong", why: "F1: a wrong collision suffix; N2 discards names", sites: whole(renameLocals), expect: { N1: "caught", N2: "absorbed", N3: "absorbed" } },
  {
    name: "builder folds missed",
    why: "F1: a constant stored through a zext; instsimplify folds it",
    sites: (ir) => {
      let k = 0;
      return [...ir.matchAll(/^ {2}store i64 (\d+), ptr (%\S+), align 8$/gm)]
        .filter((m) => BigInt(m[1]!) < 128n)
        .map((m) => ({ at: m.index, len: m[0].length, text: `  %zz${k} = zext i8 ${m[1]} to i64\n  store i64 %zz${k++}, ptr ${m[2]}, align 8` }));
    },
    expect: { N1: "caught", N2: "caught", N3: "absorbed" },
  },
  {
    name: "nuw dropped on a GEP with a zero index",
    why: "F1: instsimplify folds the GEP away, with its flags. A real wrong flag that N3 hides",
    sites: re(/(= getelementptr inbounds) nuw ([^,\n]+, ptr %\S+, i64 0)$/gm, "$1 $2"),
    expect: { N1: "caught", N2: "caught", N3: "absorbed" },
  },
  {
    name: "a wrong instruction whose result is unused",
    why: "instsimplify deletes trivially dead instructions. A real difference that N3 hides",
    sites: whole((ir) => ir.replace(/^(start:\n)/m, "$1  %zz.dead = add nuw i64 1, 2\n")),
    expect: { N1: "caught", N2: "caught", N3: "absorbed" },
  },
];

/** What is not a difference at all: the parser or the strip removes it at every tier (scripts/lib/ir-normal.ts N1). */
export const ALWAYS_ABSORBED: Mutation[] = [
  { name: "comment lines removed", why: "annotation writer", sites: re(/^; .*\n/gm, ""), expect: NONE },
  { name: "preds tails reordered", why: "use-list order", sites: re(/^(\w+:) +; preds = (%[^,\n]+), (%[^,\n]+)$/gm, "$1 ; preds = $3, $2"), expect: NONE },
  { name: "!guid removed", why: "assign-guid adds it", sites: re(/, !guid !\d+| !guid !\d+(?= \{)/gm, ""), expect: NONE },
  { name: "attribute groups renumbered", why: "assigned by the printer", sites: re(/(^attributes | )#(\d+)/gm, (m) => `${m[1]}#${Number(m[2]) + 1000}`), expect: NONE },
  {
    name: "metadata renumbered",
    why: "assigned by the printer",
    sites: (ir) => [...ir.matchAll(/!(\d+)\b/g)].filter((m) => !lineHolds(ir, m.index)).map((m) => ({ at: m.index, len: m[0].length, text: `!${Number(m[1]) + 1000}` })),
    expect: NONE,
  },
  { name: "attributes dropped from intrinsic declarations", why: "the parser replaces them", sites: re(/^(declare .*@llvm\.[^(]*\(.*\)) #\d+$/gm, "$1"), expect: NONE },
  { name: "default load alignment dropped", why: "parser default", sites: re(/(= load (?:i64|ptr), ptr %\S+), align 8/gm, "$1"), expect: NONE },
  { name: "an unused attribute group added", why: "the parser drops it", sites: whole((ir) => `${ir}\nattributes #999 = { cold }\n`), expect: NONE },
  { name: "an unused metadata node added", why: "the parser drops it", sites: whole((ir) => `${ir}\n!9999 = !{}\n`), expect: NONE },
];

/** The offset is inside a double-quoted string on its line (metadata renumbering skips those). */
function lineHolds(ir: string, at: number): boolean {
  const start = ir.lastIndexOf("\n", at) + 1;
  return ir.slice(start, at).split('"').length % 2 === 0;
}

export const MUTATIONS: Mutation[] = [...MUST_STAY_VISIBLE, ...TIER_ABSORBS, ...ALWAYS_ABSORBED];
