// The `target-specs` report suite's case generation (lane harness-w51; harness/target-specs.ts). The parser and `targetSpecCases`
// are pure and checked on fixtures; the list at the pin is checked against the pinned toolchain's `--print target-list`; the
// registered suite (harness/suites.ts loads scripts/lib/common.ts, so, as harness/cli.test.ts, it is loaded in a child) is
// checked on the pinned upstream sources.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CLI_ENV, PRINT_REQUEST_RS } from "./cli.ts";
import { TARGET_SPEC_MOD_RS, supportedTargets, targetSpecCases } from "./target-specs.ts";
import { upstreamRoot } from "../scripts/lib/upstream-root.ts"; // not common.ts: see scripts/lib/unit-steps.ts

const REPO = resolve(import.meta.dir, "..");
const UPSTREAM = upstreamRoot();

// The shape of spec/mod.rs at the pin: the macro's definition (whose `$tuple` lines are no entries), then its invocation.
const MOD_RS = `
macro_rules! supported_targets {
    ( $(($tuple:literal, $module:ident),)+ ) => {
        pub static TARGETS: &[&str] = &[$($tuple),+];
    };
}

supported_targets! {
    ("x86_64-unknown-linux-gnu", x86_64_unknown_linux_gnu),
    ("i686-unknown-linux-gnu", i686_unknown_linux_gnu),

    // a comment between entries
    ("aarch64-apple-darwin", aarch64_apple_darwin),
}

fn after() {}
`;

const PRINT_REQUEST = (stable: boolean) => `
pub enum PrintKind {
    TargetList,
    TargetSpecJson,
}
impl PrintKind {
    fn name(self) -> &'static str {
        match self {
            TargetList => "target-list",
            TargetSpecJson => "target-spec-json",
        }
    }
    fn category(self) -> PrintCategory {
        match self {
            TargetList | TargetSpecJson => PrintCategory::Target,
        }
    }
    fn is_stable(self) -> bool {
        match self {
            TargetList => true,
            TargetSpecJson => ${stable},
        }
    }
}
`;

test("supportedTargets: the invocation's tuples in order, never the macro's own lines", () => {
  expect(supportedTargets(MOD_RS)).toEqual(["x86_64-unknown-linux-gnu", "i686-unknown-linux-gnu", "aarch64-apple-darwin"]);
});

test("supportedTargets refuses what it cannot read: no invocation, an odd line, a tuple twice, an empty list", () => {
  expect(() => supportedTargets(MOD_RS.replace("supported_targets! {", "other! {"))).toThrow("ERROR: no `supported_targets! {` invocation");
  expect(() => supportedTargets(MOD_RS.replace('    ("i686-unknown-linux-gnu", i686_unknown_linux_gnu),', '    #[cfg(x)] ("i686-unknown-linux-gnu", i686_unknown_linux_gnu),'))).toThrow("unexpected line in `supported_targets!`: #[cfg(x)]");
  expect(() => supportedTargets(MOD_RS.replace('("i686-unknown-linux-gnu", i686_unknown_linux_gnu)', '("aarch64-apple-darwin", aarch64_apple_darwin2)'))).toThrow("target aarch64-apple-darwin is listed twice");
  expect(() => supportedTargets("supported_targets! {\n}\n")).toThrow("lists no target");
});

test("targetSpecCases: one per target, -Zunstable-options only for an unstable kind, the sysroot always", () => {
  const cs = targetSpecCases({ specModRs: MOD_RS, printRequest: PRINT_REQUEST(false), sysroot: "/sys" });
  expect(cs).toEqual(
    ["x86_64-unknown-linux-gnu", "i686-unknown-linux-gnu", "aarch64-apple-darwin"].map((t) => ({
      id: `target-spec-json ${t}`,
      file: "",
      args: ["--print", "target-spec-json", "--target", t, "-Zunstable-options", "--sysroot", "/sys"],
      env: CLI_ENV,
    })),
  );
  expect(targetSpecCases({ specModRs: MOD_RS, printRequest: PRINT_REQUEST(true), sysroot: "/sys" })[0]!.args).toEqual(["--print", "target-spec-json", "--target", "x86_64-unknown-linux-gnu", "--sysroot", "/sys"]);
  expect(() => targetSpecCases({ specModRs: MOD_RS, printRequest: PRINT_REQUEST(true).replaceAll("target-spec-json", "spec-json"), sysroot: "/s" })).toThrow("no print kind target-spec-json");
});

test("at the pin: 334 built-in targets, exactly the pinned toolchain's --print target-list; target-spec-json is unstable", () => {
  const targets = supportedTargets(readFileSync(join(UPSTREAM, TARGET_SPEC_MOD_RS), "utf8"));
  expect(targets.length).toBe(334);
  const nightly = (JSON.parse(readFileSync(join(REPO, "UPSTREAM.json"), "utf8")) as { rust: { nightlyName: string } }).rust.nightlyName;
  const r = Bun.spawnSync(["rustc", `+${nightly}`, "--print", "target-list"], { env: { ...process.env, RUSTUP_AUTO_INSTALL: "0", RUSTC_ICE: "0" }, stdout: "pipe", stderr: "pipe" });
  expect(r.exitCode, r.stderr.toString()).toBe(0);
  // `print target-list` sorts `TARGETS` (`sort_unstable` on `&str`: byte order).
  expect(r.stdout.toString()).toBe(`${[...targets].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join("\n")}\n`);
  const cs = targetSpecCases({ specModRs: readFileSync(join(UPSTREAM, TARGET_SPEC_MOD_RS), "utf8"), printRequest: readFileSync(join(UPSTREAM, PRINT_REQUEST_RS), "utf8"), sysroot: "/s" });
  expect(cs.every((c) => c.args.includes("-Zunstable-options"))).toBe(true);
});

test("the registered suite: report only, no baseline, rustc as the oracle, main.ts as the subject; its cases on the pinned upstream", () => {
  const code = `
const s = await import(${JSON.stringify(join(REPO, "harness/suites.ts"))});
const g = await import(${JSON.stringify(join(REPO, "scripts/gate.ts"))});
const { oracleSysroot, oracleRustcCmd } = await import(${JSON.stringify(join(REPO, "scripts/lib/oracle.ts"))});
const x = s.suite("target-specs");
const cases = x.cases();
const at = (id) => cases.find((c) => c.id === id);
const c = at("target-spec-json x86_64-unknown-linux-gnu");
const sub = x.subject([c]);
console.log(JSON.stringify({
  mode: x.mode, heavy: Boolean(x.heavy), n: cases.length, ids: new Set(cases.map((c) => c.id)).size, first: cases[0].id,
  runs: g.oracleRuns(x.oracle([c])), undeclared: g.undeclaredRuns(x),
  oracle: JSON.stringify(x.oracle([c])) === JSON.stringify(oracleRustcCmd(c.args)),
  subject: sub.slice(-7), mainTs: sub.some((a) => a.endsWith("src/rust_ts/main.ts") || a.endsWith("/main")),
  sysroot: cases.every((c) => c.args.at(-1) === oracleSysroot()),
  inputless: cases.every((c) => c.file === ""),
  keyless: x.oracleKey === undefined,
}));
`;
  const r = Bun.spawnSync([process.execPath, "-e", code], { cwd: REPO, env: { ...process.env, RUSTUP_AUTO_INSTALL: "0" }, stdout: "pipe", stderr: "pipe" });
  expect(r.exitCode, r.stderr.toString()).toBe(0);
  const j = JSON.parse(r.stdout.toString().trim().split("\n").at(-1)!);
  const sysroot = j.subject.at(-1);
  expect(j).toEqual({
    mode: "single",
    heavy: false,
    n: 334,
    ids: 334,
    first: "target-spec-json x86_64-unknown-linux-gnu",
    runs: ["rustc"],
    undeclared: [],
    oracle: true,
    subject: ["--print", "target-spec-json", "--target", "x86_64-unknown-linux-gnu", "-Zunstable-options", "--sysroot", sysroot],
    mainTs: true,
    sysroot: true,
    inputless: true,
    keyless: true,
  });
  expect(existsSync(join(REPO, "harness", "baseline", "target-specs.txt"))).toBe(false);
}, 120_000);
