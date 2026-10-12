// rust-ts: the generated rustc_feature tables against the oracle (`rustc +nightly`, the pin in
// UPSTREAM.json). Scratch crates enable every declared feature at once and the JSON diagnostics are
// compared with the tables:
//   - unstable: no E0635 (unknown feature); `incomplete_features` warnings exactly for the
//     `incomplete` ones, with their tracking issue; `internal_features` warnings exactly for the
//     `internal` ones;
//   - accepted: a `stable_features` warning "has been stable since <since>" for each one
//     (`CURRENT_RUSTC_VERSION` is printed as the release, `sym::env_CFG_RELEASE`);
//   - removed: E0557 for each one, with "removed in <since>", the pull request and the reason;
//   - BUILTIN_ATTRIBUTES: each name resolves as an attribute (no "cannot find attribute");
//   - a control: an undeclared name does give E0635 / "cannot find attribute".
// Skips (visibly) if the pinned rustc isn't available; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../../scripts/lib/common.ts";
import { create_default_session_globals_then } from "../rustc_span/lib.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { ACCEPTED_LANG_FEATURES, BUILTIN_ATTRIBUTES, Features, REMOVED_LANG_FEATURES, UNSTABLE_LANG_FEATURES } from "./lib.ts";

const REQUIRE_PROBES = process.env.RUST_TS_REQUIRE_PROBES === "1";

function rustcAtPin(): boolean {
  try {
    const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "-vV"], { stdout: "pipe", stderr: "pipe" });
    return r.exitCode === 0 && r.stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}
const HAVE_RUSTC = rustcAtPin();
const SKIP = !HAVE_RUSTC && !REQUIRE_PROBES;
if (SKIP) console.log(`SKIP: rustc +${PIN.toolchain} at ${PIN.commit.slice(0, 12)} not available; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);

interface Diag {
  message: string;
  code: { code: string } | null;
  level: string;
  spans: { text: { text: string; highlight_start: number; highlight_end: number }[] }[];
  children: { message: string; level: string }[];
}

const WORK = join(DATA, "tmp", "rustc_feature-oracle", process.env.RUST_TS_AGENT ?? "default");

/** Compile `src` as a metadata-only lib crate; returns its JSON diagnostics. */
function compile(name: string, src: string): Diag[] {
  mkdirSync(WORK, { recursive: true });
  const file = join(WORK, `${name}.rs`);
  writeFileSync(file, src);
  const r = Bun.spawnSync(
    ["rustc", `+${PIN.toolchain}`, "--edition", "2024", "--crate-type", "lib", "--crate-name", name, "--emit=metadata", "--error-format=json", "--out-dir", WORK, file],
    { cwd: WORK, stdout: "pipe", stderr: "pipe", env: { ...process.env, RUSTC_BOOTSTRAP: undefined } },
  );
  const lines = r.stderr.toString().split("\n").filter((l) => l.startsWith("{"));
  return lines.map((l) => JSON.parse(l) as Diag);
}

/** The source text under the primary span (the feature name / attribute path). */
function spanText(d: Diag): string | undefined {
  const t = d.spans[0]?.text[0];
  return t === undefined ? undefined : t.text.slice(t.highlight_start - 1, t.highlight_end - 1);
}

const names = (fs: readonly { name: Symbol }[]): string[] => fs.map((f) => Symbol.as_str(f.name));

test.skipIf(SKIP)(
  "feature tables match rustc's #![feature] handling",
  () => {
    if (!HAVE_RUSTC) throw new Error(`ERROR: rustc +${PIN.toolchain} at ${PIN.commit} not available and RUST_TS_REQUIRE_PROBES=1`);
    rmSync(WORK, { recursive: true, force: true });
    create_default_session_globals_then(() => {
      const unstable = names(UNSTABLE_LANG_FEATURES);
      const accepted = names(ACCEPTED_LANG_FEATURES);
      const removed = REMOVED_LANG_FEATURES.map((r) => Symbol.as_str(r.feature.name));
      expect(unstable.length).toBe(261);
      expect(accepted.length).toBe(214);
      expect(removed.length).toBe(109);
      // A name in two lists would be ambiguous (and `declared twice` upstream).
      expect(new Set([...unstable, ...accepted, ...removed]).size).toBe(unstable.length + accepted.length + removed.length);

      const BOGUS = "rust_ts_not_a_feature";
      const all = [...unstable, ...accepted, ...removed, BOGUS];
      const diags = compile("features", `#![feature(\n${all.map((n) => `    ${n},\n`).join("")})]\n`);
      const byName = (pred: (d: Diag) => boolean): Map<string, Diag> => {
        const m = new Map<string, Diag>();
        for (const d of diags) if (pred(d)) m.set(spanText(d) ?? "?", d);
        return m;
      };

      // unstable: declared (no E0635), incomplete/internal statuses and incomplete issues.
      const unknown = byName((d) => d.code?.code === "E0635");
      expect([...unknown.keys()]).toEqual([BOGUS]);
      const incomplete = byName((d) => d.message.endsWith("is incomplete and may not be safe to use and/or cause compiler crashes"));
      const internal = byName((d) => d.message.endsWith("is internal to the compiler or standard library"));
      const features = Features.default();
      for (const f of UNSTABLE_LANG_FEATURES) {
        const n = Symbol.as_str(f.name);
        expect([n, incomplete.has(n)]).toEqual([n, features.incomplete(f.name)]);
        expect([n, internal.has(n)]).toEqual([n, features.internal(f.name)]);
        const d = incomplete.get(n);
        if (d !== undefined) {
          const note = d.children.find((c) => c.message.startsWith("see issue #"));
          const want = f.issue === undefined ? undefined : `see issue #${f.issue} <https://github.com/rust-lang/rust/issues/${f.issue}> for more information`;
          expect([n, note?.message]).toEqual([n, want]);
        }
      }

      // accepted: "has been stable since <since>".
      const stable = byName((d) => /^the feature `\w+` has been stable since /.test(d.message));
      expect([...stable.keys()].sort()).toEqual([...accepted].sort());
      for (const f of ACCEPTED_LANG_FEATURES) {
        const n = Symbol.as_str(f.name);
        const since = f.since === "CURRENT_RUSTC_VERSION" ? PIN.release : f.since;
        expect(stable.get(n)?.message).toBe(`the feature \`${n}\` has been stable since ${since} and no longer requires an attribute to enable`);
      }

      // removed: E0557 with version, pull request and reason.
      const gone = byName((d) => d.code?.code === "E0557");
      expect([...gone.keys()].sort()).toEqual([...removed].sort());
      for (const r of REMOVED_LANG_FEATURES) {
        const n = Symbol.as_str(r.feature.name);
        const notes = gone.get(n)!.children.filter((c) => c.level === "note").map((c) => c.message);
        const pull = r.pull === undefined ? "" : `; see <https://github.com/rust-lang/rust/pull/${r.pull}> for more information`;
        const want = [`removed in ${r.feature.since}${pull}`, ...(r.reason === undefined ? [] : [r.reason])];
        expect([n, notes]).toEqual([n, want]);
      }
    });
  },
  30_000,
);

test.skipIf(SKIP)(
  "BUILTIN_ATTRIBUTES all resolve as attributes",
  () => {
    if (!HAVE_RUSTC) throw new Error(`ERROR: rustc +${PIN.toolchain} at ${PIN.commit} not available and RUST_TS_REQUIRE_PROBES=1`);
    create_default_session_globals_then(() => {
      const BOGUS = "rust_ts_not_an_attribute";
      const attrs = [...BUILTIN_ATTRIBUTES.map((s) => Symbol.as_str(s)), BOGUS];
      expect(attrs.length).toBe(200);
      const diags = compile("attrs", attrs.map((a, i) => `#[${a}]\nfn f${i}() {}\n`).join(""));
      // Attribute paths are resolved during expansion, in item order, with errors collected: the
      // control (last item) being reported shows every earlier name was resolved.
      const unresolved = diags.filter((d) => d.message.startsWith("cannot find attribute")).map((d) => spanText(d));
      expect(unresolved).toEqual([BOGUS]);
    });
  },
  30_000,
);
