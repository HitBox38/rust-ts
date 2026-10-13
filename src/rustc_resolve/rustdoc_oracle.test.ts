// Oracle test for rustc_resolve::rustdoc and the vendored pulldown-cmark 0.11.3 (lane rustdoc): the
// `rustdoc` rustc-dev probe (tools/probes/rustdoc/main.rs) runs the oracle compiler's own
// `attrs_to_doc_fragments` / `prepare_to_doc_link_resolution` / `strip_generics_from_path`, its
// `pulldown_cmark` (event stream with offsets, reference definitions) and `parse_links` on the cases of
// rustdoc_oracle/corpus.jsonl (handwritten doc comments, pulldown-cmark's own test inputs under three
// option sets, random token soups, and every doc-comment block of compiler/rustc_resolve and
// compiler/rustc_ast); rustdoc_oracle/corpus.ts replays them through the port.
// - The committed fixture (rustdoc_oracle/expected.txt: digests of the probe's output per case) is
//   always checked.
// - With the probe built, the live probe's output must equal the port's for every case and the
//   fixture must be current; a visible skip without it, a failure under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { EXPECTED, PROBE, digest, load_corpus, probe, replay } from "./rustdoc_oracle/corpus.ts";

const REQUIRE_PROBES = process.env.RUST_TS_REQUIRE_PROBES === "1";
const SKIP = !existsSync(PROBE) && !REQUIRE_PROBES;
if (SKIP) console.log("SKIP: rustdoc probe not built (bun scripts/probes.ts build rustdoc); RUST_TS_REQUIRE_PROBES=1 makes this a failure");

const cases = load_corpus();
let got: string[] | undefined;
const replayed = (): string[] => (got ??= replay(cases));

test("fixture: the port's output per case hashes to the probe's (expected.txt)", () => {
  const want = readFileSync(EXPECTED, "utf8")
    .split("\n")
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  expect(want.length).toBe(cases.length);
  const outs = replayed();
  const bad: number[] = [];
  outs.forEach((o, i) => {
    if (digest(o) !== want[i]) bad.push(i);
  });
  expect(bad.slice(0, 20)).toEqual([]);
});

test.skipIf(SKIP)("live probe: every case matches the oracle, and the fixture is current", () => {
  const want = probe(cases);
  expect(want.length).toBe(cases.length);
  const outs = replayed();
  for (let i = 0; i < cases.length; i++) {
    if (want[i] !== outs[i]) expect(`case ${i}\n${outs[i]}`).toBe(`case ${i}\n${want[i]}`);
  }
  const fixture = readFileSync(EXPECTED, "utf8")
    .split("\n")
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  expect(want.map(digest)).toEqual(fixture);
});
