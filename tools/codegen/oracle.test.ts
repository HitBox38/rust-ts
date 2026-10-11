// derive(Debug) fidelity of tools/codegen/types.ts against the oracle: fixtures/mini.rs is run through
// the typedefs probe + generator, and also compiled with the pinned nightly; the generated Debug fns
// must print the same `{:?}` / `{:#?}` text for the same values. Skips if the probe isn't built.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../../scripts/lib/common.ts";
import { debug_char, debug_int, debug_str, PLAIN, PRETTY, type Debug, type Fmt } from "../../src/std/fmt.ts";
import { generate, loadTypeMap, writeStubs, type ProbeJson } from "./types.ts";

const MINI = join(import.meta.dir, "fixtures", "mini.rs");
const PROBE = join(DATA, "target", "probes", "release", "typedefs" + (process.platform === "win32" ? ".exe" : ""));

test(
  "generated derive(Debug) matches rustc on fixtures/mini.rs",
  async () => {
    if (!existsSync(PROBE)) {
      console.log("SKIP: typedefs probe not built (bun scripts/probes.ts build typedefs)");
      return;
    }
    const work = join(DATA, "tmp", "codegen-oracle", process.env.RUST_TS_AGENT ?? "default");
    rmSync(work, { recursive: true, force: true });
    const src = join(work, "src");
    mkdirSync(join(src, "mini"), { recursive: true });

    // oracle
    const exe = join(work, "mini" + (process.platform === "win32" ? ".exe" : ""));
    const rc = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "--edition", "2024", "-C", "debug-assertions=off", "-o", exe, MINI], { cwd: work });
    expect(rc.stderr.toString()).toBe("");
    const expected = Bun.spawnSync([exe]).stdout.toString().replaceAll("\r\n", "\n");

    // probe + generator
    const pr = Bun.spawnSync([PROBE, MINI], { stdout: "pipe" });
    expect(pr.exitCode).toBe(0);
    const probe: ProbeJson = JSON.parse(pr.stdout.toString());
    probe.files[0]!.path = "compiler/mini/src/lib.rs";
    const set = { files: [], class: [], hand: [], discriminant: [], skip: [] };
    const opts = { set: "mini", out: src, srcRoot: src };
    const res = generate(probe, set, loadTypeMap(), opts);
    expect(res.report.errors).toEqual([]);
    expect(res.report.unknown_types).toEqual({});
    expect(res.report.manual_debug.map((m) => m.type)).toEqual(["mini::Manual"]);
    for (const [f, c] of res.files) writeFileSync(f, c);
    // the hand-written half: Manual's Debug impl
    writeFileSync(
      join(src, "mini", "lib.ts"),
      'export * from "./lib.gen.ts";\nexport const debug_Manual = (v: { _0: number }): string => `M<${v._0}>`;\n',
    );
    writeStubs(res, opts);
    const G = await import(join(src, "mini", "lib.gen.ts"));
    expect(G.Fieldless_discriminant).toEqual({ X: 1, Y: 2, Z: 16 });

    const chr = (c: string) => c.codePointAt(0)!;
    const dc: Debug<number> = (v) => debug_char(v);
    const vals: [(v: never, f: Fmt) => string, unknown][] = [
      [G.debug_Unit, {}],
      [G.debug_Tup, { _0: 7, _1: true }],
      [G.debug_Empty, {}],
      [(v, f) => G.debug_Gen(v, f, (s: string) => debug_str(s), debug_int), { t: 'a"b', u: undefined, v: ["c", "́"] }],
      [(v, f) => G.debug_Gen(v, f, debug_int, dc), { t: 1, u: chr("\n"), v: [] }],
      [(v, f) => G.debug_E(v, f, debug_int), G.E.A],
      [(v, f) => G.debug_E(v, f, debug_int), { $: "B", _0: 5, _1: chr("x") }],
      [(v, f) => G.debug_E(v, f, debug_int), { $: "C", x: { $: "Some", _0: undefined }, s: "hi\n" }],
      [(v, f) => G.debug_E(v, f, debug_int), { $: "C", x: { $: "Some", _0: 3 }, s: "" }],
      [(v, f) => G.debug_E(v, f, debug_int), { $: "C", x: undefined, s: "q" }],
      [(v, f) => G.debug_E(v, f, debug_int), { $: "D" }],
      [(v, f) => G.debug_E(v, f, debug_int), { $: "F", _0: { $: "B", _0: 1, _1: chr("'") } }],
      [G.debug_Fieldless, "Y"],
      [
        G.debug_UsesAlias,
        {
          a: [
            [1, "X"],
            [-2, "Z"],
          ],
          r: { start: 3, end: 9 },
          unit: null,
          one: [4],
          nested: { t: { t: false, u: 2, v: [true] }, u: { _0: 0, _1: false }, v: [] },
        },
      ],
      [G.debug_CfgAttr, { kept: 5 }],
      [G.debug_HasManual, { m: { _0: 3 }, type: 1 }],
    ];
    let actual = "";
    for (const [fn, v] of vals) {
      actual += fn(v as never, PLAIN) + "\n";
      actual += fn(v as never, PRETTY) + "\n";
    }
    expect(actual).toBe(expected);
  },
  120_000,
);
