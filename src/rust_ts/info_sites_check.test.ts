// The INFO-site checker's verdicts (src/rust_ts/info_sites_check.ts; lane harness-w44, docs/reviews/fixers-45.md F4).
import { describe, expect, test } from "bun:test";
import { check, type Marker, scan } from "./info_sites_check.ts";

const FILE = "compiler/rustc_demo/src/lib.rs";
const UPSTREAM_SRC = [
  "macro_rules! log_it {", // 1
  "    () => { info!(\"from a macro\") };", // 2
  "}", // 3
  "", // 4
  "pub fn ported_live() {", // 5
  "    info!(\"one\");", // 6
  "}", // 7
  "", // 8
  "fn ported_dead() {", // 9
  "    info!(\"two\");", // 10
  "}", // 11
  "", // 12
  "fn not_ported() {", // 13
  "    info!(\"three\");", // 14
  "}", // 15
  "", // 16
  "#[instrument(skip(x))]", // 17
  "fn spanned(x: u32) {}", // 18
].join("\n");

const marker = (line: number, name: string, body: string): [string, Marker[]] => [`${FILE}:${line}`, [{ ts: `rustc_demo/lib.ts:${line}`, name, body }]];

describe("info_sites_check", () => {
  const sites = scan(FILE, UPSTREAM_SRC);

  test("scan finds each site and its fn", () => {
    expect(sites.map((s) => [s.line, s.fn_line, s.fn_name])).toEqual([
      [2, 0, "?"],
      [6, 5, "ported_live"],
      [10, 9, "ported_dead"],
      [14, 13, "not_ported"],
      [17, 18, "spanned"],
    ]);
  });

  const good = new Map([
    marker(5, "ported_live", "// rustc: x\nfunction ported_live() { tracing.info(() => \"one\"); }"),
    marker(9, "ported_dead", "// rustc: x\nfunction ported_dead() { tracing.info_unconverted(\"t\"); }"),
    marker(18, "spanned", "// rustc: x\nfunction spanned(x) { return tracing.instrument(\"spanned\", () => {}); }"),
  ]);
  const skipMacro = { [`${FILE}:2`]: "never expanded" };

  test("a clean port passes; a fn the port lacks is only counted", () => {
    const r = check(sites, good, skipMacro);
    expect(r.errors).toEqual([]);
    expect([r.skipped, r.in_ported, r.unported_fns]).toEqual([1, 3, 1]);
  });

  test("a ported fn without its live call or stop fails", () => {
    const m = new Map(good);
    m.set(...marker(9, "ported_dead", "// rustc: x\nfunction ported_dead() {}"));
    const r = check(sites, m, skipMacro);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toStartWith(`ERROR: ${FILE}:9 ported_dead:`);
  });

  test("a site in no fn the scanner can find fails unless SKIP lists it", () => {
    const r = check(sites, good, {});
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toStartWith(`ERROR: ${FILE}:2: an INFO site in no fn`);
  });

  test("a marker of the fn at another line fails instead of counting the fn as not ported", () => {
    const m = new Map(good);
    m.delete(`${FILE}:5`);
    m.set(...marker(4, "ported_live", "// rustc: x\nfunction ported_live() { tracing.info(() => \"one\"); }"));
    const r = check(sites, m, skipMacro);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain(`${FILE}:5 ported_live: 1 upstream INFO site(s) (6), no marker at that line, but the port marks ported_live at ${FILE}:4`);
    expect(r.unported_fns).toBe(1);
  });

  test("a SKIP entry that names no site fails", () => {
    const r = check(sites, good, { ...skipMacro, [`${FILE}:99`]: "stale" });
    expect(r.errors).toEqual([`ERROR: SKIP lists ${FILE}:99, which is no INFO site; remove or move the entry`]);
  });
});
