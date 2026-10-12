// rust-ts: annotate-snippets rendering against the oracle (the `annotate` probe, built from
// annotate-snippets =0.12.16 with rustc's features). The deterministic corpus in
// tools/probes/annotate/corpus.ts is fed to the probe as JSON on stdin; the probe prints the
// `Renderer::plain()` and `Renderer::styled()` output of every case (null = panicked). Every
// case is rendered again with the TS port and compared byte for byte.
// Skips (visibly) if the probe isn't built, fails instead under RUST_TS_REQUIRE_PROBES=1 (bun scripts/probes.ts build annotate).
//
// ANNOTATE_DUMP=1 writes each mismatch (want/got) to $RUST_TS_DATA/tmp/annotate-oracle/.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../../scripts/lib/common.ts";
import { corpus, type Case, type ElementJ, type GroupJ, type LevelJ, type OptsJ } from "../../../tools/probes/annotate/corpus.ts";
import { Panic } from "../../std/panic.ts";
import { Str } from "../../std/str.ts";
import { Level } from "./level.ts";
import { Renderer } from "./renderer/mod.ts";
import { Annotation, AnnotationKind, Element, Group, Origin, Padding, Patch, Snippet, Title, type Report } from "./snippet.ts";

const PROBE = join(DATA, "target", "probes", "release", "annotate" + (process.platform === "win32" ? ".exe" : ""));
// Missing probe: a visible skip, or a failure under RUST_TS_REQUIRE_PROBES=1 (gate hosts build the probes).
const REQUIRE_PROBES = process.env.RUST_TS_REQUIRE_PROBES === "1";
const SKIP = !existsSync(PROBE) && !REQUIRE_PROBES;
if (SKIP) console.log("SKIP: annotate probe not built (bun scripts/probes.ts build annotate); RUST_TS_REQUIRE_PROBES=1 makes this a failure");

function level(v: LevelJ): Level {
  const base = Level[v.l];
  if (!("name" in v)) return base;
  if (v.name === null) return base.no_name();
  return base.with_name(v.name);
}

function element(e: ElementJ): Element {
  switch (e.t) {
    case "message":
      return Element.from_Message(level(e.level).message(e.text));
    case "cause": {
      let sn = Snippet.source<Annotation>(Str.from(e.source));
      if (e.path !== undefined) sn = Snippet.path(sn, e.path);
      if (e.line_start !== undefined) sn = Snippet.line_start(sn, e.line_start);
      if (e.fold !== undefined) sn = Snippet.fold(sn, e.fold);
      for (const a of e.anns) {
        let ann = AnnotationKind.span(a.kind, { start: a.start, end: a.end });
        if (a.label !== undefined) ann = Annotation.label(ann, a.label);
        if (a.hl !== undefined) ann = Annotation.highlight_source(ann, a.hl);
        sn = Snippet.annotation(sn, ann);
      }
      return Element.from_Snippet_Annotation(sn);
    }
    case "suggestion": {
      let sn = Snippet.source<Patch>(Str.from(e.source));
      if (e.path !== undefined) sn = Snippet.path(sn, e.path);
      if (e.line_start !== undefined) sn = Snippet.line_start(sn, e.line_start);
      if (e.fold !== undefined) sn = Snippet.fold(sn, e.fold);
      for (const p of e.patches) sn = Snippet.patch(sn, Patch.new({ start: p.start, end: p.end }, Str.from(p.rep)));
      return Element.from_Snippet_Patch(sn);
    }
    case "origin": {
      let o = Origin.path(e.path);
      if (e.line !== undefined) o = Origin.line(o, e.line);
      if (e.col !== undefined) o = Origin.char_column(o, e.col);
      return Element.from_Origin(o);
    }
    case "padding":
      return Element.from_Padding(new Padding());
  }
}

function group(g: GroupJ): Group {
  let grp: Group;
  if (g.title !== undefined && g.title !== null) {
    const t = g.title;
    const lv = level(t.level);
    let title = t.secondary ? lv.secondary_title(t.text) : lv.primary_title(t.text);
    if (t.id !== undefined) title = Title.id(title, t.id);
    if (t.url !== undefined) title = Title.id_url(title, t.url);
    grp = Group.with_title(title);
  } else {
    grp = Group.with_level(level(g.level!));
  }
  for (const e of g.elements) grp = Group.element(grp, element(e));
  return grp;
}

function configure(r: Renderer, o: OptsJ): Renderer {
  if (o.term_width !== undefined) r = Renderer.term_width(r, o.term_width);
  if (o.anon !== undefined) r = Renderer.anonymized_line_numbers(r, o.anon);
  if (o.decor !== undefined) r = Renderer.decor_style(r, o.decor);
  if (o.short !== undefined) r = Renderer.short_message(r, o.short);
  return r;
}

/** Render one case; `null` when the port panics (a `Panic`, like the probe's `catch_unwind`). */
function render(c: Case, base: Renderer): string | null {
  // The report is rebuilt per renderer, like the probe's `&report` (the port never mutates it).
  const report: Report = c.groups.map(group);
  try {
    return Renderer.render(configure(base, c.opts), report);
  } catch (e) {
    if (e instanceof Panic) return null;
    throw e;
  }
}

test.skipIf(SKIP)("annotate-snippets rendering matches the oracle", () => {
  if (!existsSync(PROBE)) {
    throw new Error(`ERROR: annotate probe not built (${PROBE}) and RUST_TS_REQUIRE_PROBES=1`);
  }
  const cases = corpus();
  const r = Bun.spawnSync([PROBE], { stdin: Buffer.from(JSON.stringify(cases)), stdout: "pipe" });
  expect(r.exitCode).toBe(0);
  const lines = r.stdout.toString().split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  expect(lines.length).toBe(cases.length);

  const dump = process.env.ANNOTATE_DUMP === "1" ? join(DATA, "tmp", "annotate-oracle") : undefined;
  if (dump !== undefined) mkdirSync(dump, { recursive: true });
  const bad: string[] = [];
  let compared = 0;
  let panics = 0;
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i]!;
    const want = JSON.parse(lines[i]!) as { plain: string | null; styled: string | null };
    for (const [key, base] of [
      ["plain", Renderer.plain()],
      ["styled", Renderer.styled()],
    ] as const) {
      compared++;
      const got = render(c, base);
      if (want[key] === null) panics++;
      if (got !== want[key]) {
        bad.push(`${c.name}/${key}`);
        if (dump !== undefined) writeFileSync(join(dump, `${c.name}.${key}.txt`), `--- want\n${want[key]}\n--- got\n${got}\n`);
      }
    }
  }
  console.log(`annotate oracle: ${compared - bad.length}/${compared} renders match (${cases.length} cases, ${panics} expected panics)`);
  if (bad.length > 0) console.log(`ERROR: annotate oracle mismatches: ${bad.slice(0, 20).join(", ")}${bad.length > 20 ? ", ..." : ""}`);
  expect(bad).toEqual([]);
});
