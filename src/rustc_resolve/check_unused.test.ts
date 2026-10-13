// `unused_imports` spans and suggestions (check_unused.rs `calc_unused_spans` + the `UnusedImports`
// diagnostic) against the oracle, on imports_oracle/unused_spans.rs (braced partial-unused groups,
// adjacent-removal collapsing, brace removal, `self` groups, empty groups, globs, attributes).
//
// Fixture: imports_oracle/unused_spans.oracle.txt, made from the oracle's JSON diagnostics:
//   cd src/rustc_resolve/imports_oracle && rustc +nightly --crate-type lib --edition 2021 \
//     --error-format=json --emit=metadata -o <tmp> unused_spans.rs
// converted by `oracle_lines` below (one block per `unused_imports` warning: message, primary spans,
// the removal suggestion; byte offsets relative to the file). With the pinned toolchain available
// the test re-runs the oracle and requires the fixture to be current.
//
// What the test does in place of the resolver (which needs lanes res-graph/res-ident/late): it parses
// the file with the ported parser, numbers the use trees (as expansion would), and marks as unused the
// leaf trees whose span is one of the oracle's primary spans (empty `{}` groups are unused by
// construction, as `check_use_tree` does). From there the ported `calc_unused_spans` decides the
// primary spans, whether the whole item is removed, and every removal span; the message and the
// suggestion come from the generated `UnusedImports` diagnostic through a recording emitter. The
// end-to-end path (`check_unused` itself, the `#[cfg(test)]` help) is covered by imports.test.ts
// (PENDING until the resolver pipeline runs).
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "./lib.ts";
import { type Crate, type Item, type NodeId, type UseTree } from "../rustc_ast/lib.ts";
import { NodeId as NodeIdC } from "../rustc_ast/node_id.ts";
import { compiler_entrypoint } from "../rustc_driver_impl/lib.ts";
import { Emitter } from "../rustc_errors/emitter.ts";
import { format_diag_message } from "../rustc_errors/formatting.ts";
import { DiagCtxt, DiagCtxtFlags_default, type DiagInner } from "../rustc_errors/lib.ts";
import { type Config, run_compiler } from "../rustc_interface/interface.ts";
import { parse } from "../rustc_interface/passes.ts";
import type { Session } from "../rustc_session/session.ts";
import { LocalDefId } from "../rustc_span/def_id.ts";
import { Span } from "../rustc_span/lib.ts";
import { PIN } from "../../scripts/lib/common.ts";
import { calc_unused_spans, UnusedImport } from "./check_unused.ts";
import { UnusedImports_into_diag } from "./diagnostics/mod.ts";

const DIR = join(import.meta.dir, "imports_oracle");
const CASE = "unused_spans.rs";
const FIXTURE = join(DIR, "unused_spans.oracle.txt");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";

// ---- oracle side ------------------------------------------------------------------------------

interface JsonSpan {
  byte_start: number;
  byte_end: number;
  is_primary: boolean;
  suggested_replacement: string | null;
}
interface JsonDiag {
  message: string;
  code: { code: string } | null;
  spans: JsonSpan[];
  children: { message: string; level: string; spans: JsonSpan[] }[];
}

/** The `unused_imports` warnings of rustc's JSON output as fixture lines. */
function oracle_lines(json: string): string[] {
  const out: string[] = [];
  for (const line of json.split("\n")) {
    if (line.trim() === "") continue;
    const d = JSON.parse(line) as JsonDiag;
    if (d.code?.code !== "unused_imports") continue;
    out.push(d.message);
    out.push(`  primary ${d.spans.filter((s) => s.is_primary).map((s) => `${s.byte_start}..${s.byte_end}`).join(" ")}`);
    for (const c of d.children) {
      if (c.spans.length === 0 || c.spans.some((s) => s.suggested_replacement === null)) continue; // notes, the test-module help
      out.push(`  sugg ${c.message}: ${c.spans.map((s) => `${s.byte_start}..${s.byte_end}=${JSON.stringify(s.suggested_replacement)}`).join(" ")}`);
    }
  }
  return out;
}

function rustc_at_pin(): boolean {
  try {
    const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "-vV"], { stdout: "pipe", stderr: "pipe" });
    return r.exitCode === 0 && r.stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}

// ---- subject side -----------------------------------------------------------------------------

class CaptureConfig extends Error {}

function config_from_args(args: string[]): Config {
  let config: Config | undefined;
  try {
    compiler_entrypoint(["rustc", ...args], {
      config(c: Config) {
        config = c;
        throw new CaptureConfig();
      },
    });
  } catch (e) {
    if (!(e instanceof CaptureConfig)) throw e;
  }
  if (config === undefined) throw new Error("no config");
  return config;
}

interface Suggestion {
  msg: string;
  parts: [Span, string][];
}
class RecordingEmitter extends Emitter {
  readonly out: { msg: string; suggestions: Suggestion[] }[] = [];
  emit_diagnostic(diag: DiagInner): void {
    const fmt = (m: Parameters<typeof format_diag_message>[0]) => format_diag_message(m, diag.args);
    this.out.push({
      msg: diag.messages.map(([m]) => fmt(m)).join(""),
      suggestions:
        diag.suggestions.$ === "Disabled"
          ? []
          : diag.suggestions._0.map((s) => ({ msg: fmt(s.msg), parts: s.substitutions.flatMap((sub) => sub.parts.map((p): [Span, string] => [p.span, p.snippet])) })),
    });
  }
  source_map(): undefined {
    return undefined;
  }
}

/** Every `use` item of the crate, in source (crate DFS) order. */
function use_items(items: readonly Item[], out: Item[] = []): Item[] {
  for (const item of items) {
    if (item.kind.$ === "Use") out.push(item);
    if (item.kind.$ === "Mod" && item.kind._2.$ === "Loaded") use_items(item.kind._2._0, out);
  }
  return out;
}

function subject_lines(sess: Session, krate: Crate, primary: Set<string>): string[] {
  const sm = sess.source_map();
  const rel = (sp: Span): string => {
    const start = sm.lookup_source_file(Span.lo(sp)).start_pos as number;
    return `${(Span.lo(sp) as number) - start}..${(Span.hi(sp) as number) - start}`;
  };
  let next = 1;
  const fresh = (): NodeId => NodeIdC.from_u32(next++);
  const out: string[] = [];
  for (const item of use_items(krate.items)) {
    if (item.kind.$ !== "Use") continue;
    // Expansion's numbering stand-in; the marking is what `UnusedImportCheckVisitor` would record.
    item.id = fresh();
    const unused = new Set<NodeId>();
    const mark = (tree: UseTree, id: NodeId): void => {
      switch (tree.kind.$) {
        case "Simple":
        case "Glob":
          if (primary.has(rel(tree.span()))) unused.add(id);
          break;
        case "Nested":
          if (tree.kind.items.length === 0) unused.add(id);
          for (const t of tree.kind.items) {
            t.id = fresh();
            mark(t.inner, t.id);
          }
          break;
      }
    };
    mark(item.kind._0, item.id);
    if (unused.size === 0) continue;

    const unused_import = new UnusedImport(item.kind._0, item.id, item.span_with_attributes(), unused, LocalDefId.of(0 as Parameters<typeof LocalDefId.of>[0]));
    const r = calc_unused_spans(unused_import, unused_import.use_tree, unused_import.use_tree_id);
    if (r.$ === "Used") continue;
    const [spans, remove_spans] = r.$ === "Unused" ? [r.spans, [r.remove]] : [r.spans, r.remove];
    // The arguments `check_unused` gives `UnusedImports` (check_unused.rs:497-575).
    const span_snippets = spans.map((s) => `\`${(sm.span_to_snippet(s) as { _0: { toString(): string } })._0.toString()}\``).sort();
    const remove_whole_use = remove_spans.length === 1 && remove_spans[0] === unused_import.item_span;
    const can_suggest_removal = remove_spans.every((s) => Span.can_be_used_for_suggestions(s));
    expect(can_suggest_removal).toBe(true);
    const em = new RecordingEmitter();
    const dcx = DiagCtxt.new(em).with_flags({ ...DiagCtxtFlags_default(), can_emit_warnings: true });
    UnusedImports_into_diag(
      {
        sugg: remove_whole_use ? { $: "RemoveWholeUse", span: remove_spans[0]! } : { $: "RemoveImports", remove_spans, num_to_remove: spans.length },
        test_module_span: undefined,
        num_snippets: span_snippets.length,
        span_snippets: { $: "StrListSepByAnd", _0: span_snippets },
      },
      dcx.handle(),
      { $: "Warning", _0: undefined },
    ).emit();
    expect(em.out.length).toBe(1);
    const d = em.out[0]!;
    out.push(d.msg);
    out.push(`  primary ${spans.map(rel).join(" ")}`);
    for (const s of d.suggestions) out.push(`  sugg ${s.msg}: ${s.parts.map(([sp, snip]) => `${rel(sp)}=${JSON.stringify(snip)}`).join(" ")}`);
  }
  return out;
}

test("calc_unused_spans + UnusedImports match the oracle's unused_imports warnings", () => {
  const oracle = readFileSync(FIXTURE, "utf8").trimEnd().split("\n");
  const primary = new Set(oracle.filter((l) => l.startsWith("  primary ")).flatMap((l) => l.slice("  primary ".length).split(" ")));
  const config = config_from_args(["--crate-type", "lib", "--edition", "2021", join(DIR, CASE)]);
  let got: string[] = [];
  run_compiler(config, (compiler) => {
    got = subject_lines(compiler.sess, parse(compiler.sess), primary);
  });
  expect(oracle.length).toBeGreaterThan(40);
  expect(got).toEqual(oracle);
});

test("the unused_spans fixture is the current oracle output", () => {
  if (!rustc_at_pin()) {
    if (REQUIRE) throw new Error(`ERROR: rustc +${PIN.toolchain} at ${PIN.commit} unavailable`);
    return;
  }
  const tmp = mkdtempSync(join(tmpdir(), "res-imports-"));
  try {
    const r = Bun.spawnSync(
      ["rustc", `+${PIN.toolchain}`, "--crate-type", "lib", "--edition", "2021", "--error-format=json", "--emit=metadata", "-o", join(tmp, "out.rmeta"), CASE],
      { cwd: DIR, stdout: "pipe", stderr: "pipe", env: { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" } },
    );
    // Not 0: analysis then stops at missing `no_core` lang items, after the early lints were emitted.
    expect(r.exitCode).toBe(1);
    expect(oracle_lines(r.stderr.toString()).join("\n") + "\n").toBe(readFileSync(FIXTURE, "utf8"));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// Regenerate the fixture: `REGEN=1 bun test src/rustc_resolve/check_unused.test.ts`.
if (process.env.REGEN === "1" && rustc_at_pin()) {
  const tmp = mkdtempSync(join(tmpdir(), "res-imports-"));
  const r = Bun.spawnSync(
    ["rustc", `+${PIN.toolchain}`, "--crate-type", "lib", "--edition", "2021", "--error-format=json", "--emit=metadata", "-o", join(tmp, "out.rmeta"), CASE],
    { cwd: DIR, stdout: "pipe", stderr: "pipe" },
  );
  await Bun.write(FIXTURE, oracle_lines(r.stderr.toString()).join("\n") + "\n");
  rmSync(tmp, { recursive: true, force: true });
}
