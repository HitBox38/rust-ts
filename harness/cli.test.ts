// The `cli` report suite's case generation (lane harness-cli; harness/cli.ts). The parsers and `cliCases` are pure and checked
// on fixtures here; the registered suite (harness/suites.ts loads scripts/lib/common.ts, so, as harness/rlib-native.test.ts, it
// is loaded in a child) is checked on the pinned upstream sources.
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Case } from "./suites.ts";
import { CLI_ENV, CLI_TRIVIAL_INPUT, cliCases, cliKind, explainCodes, mnemonicExample, printKinds, removedCodes, specialUnknownRequests, type CliInputs } from "./cli.ts";

const REPO = resolve(import.meta.dir, "..");

// The shape of print_request.rs at the pin: doc comments, multi-variant arms, comments after arms, the free fns after the impl.
const PRINT_REQUEST = `
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
#[derive(AllVariants)]
pub enum PrintKind {
    // tidy-alphabetical-start
    /// Does the backend supports the [\`PrintRequest::arg\`] \`asm!()\` mnemonic? (perma-unstable)
    BackendHasMnemonic,

    /// List of cfg values.
    Cfg,

    /// Name of the crate being compiled.
    CrateName,

    /// Linker invocations.
    LinkArgs,

    /// List of available CPU values for the current target.
    TargetCPUs,
    // tidy-alphabetical-end
}

impl PrintKind {
    fn name(self) -> &'static str {
        use PrintKind::*;
        match self {
            BackendHasMnemonic => "backend-has-mnemonic",
            Cfg => "cfg",
            CrateName => "crate-name",
            LinkArgs => "link-args",
            TargetCPUs => "target-cpus",
        }
    }

    fn category(self) -> PrintCategory {
        use PrintKind::*;
        match self {
            TargetCPUs
            | Cfg => PrintCategory::Target,

            BackendHasMnemonic => PrintCategory::Codegen,

            LinkArgs => PrintCategory::Linker,

            CrateName => PrintCategory::Crate,
        }
    }

    fn is_stable(self) -> bool {
        use PrintKind::*;
        match self {
            // Stable values:
            Cfg
            | CrateName
            | LinkArgs
            | TargetCPUs => true,

            // Unstable values:
            BackendHasMnemonic => false, // (perma-unstable, for use by compiletest)
        }
    }
}

pub fn collect_print_requests() {
                early_dcx.early_fatal(
                    "expected mnemonic name after \`--print=backend-has-mnemonic:\`, \\
                    for example: \`--print=backend-has-mnemonic:NOP\`",
                );
}

fn emit_unknown_print_request_help(early_dcx: &EarlyDiagCtxt, req: &str) -> ! {
    if req == "lints" {
        diag.help("use \`-Whelp\` to print a list of lints");
    }
    if req == "targets" {
        diag.help("made up");
    }
}
`;

test("print kinds: every PrintKind variant with its name, category and stability, in declaration order", () => {
  expect(printKinds(PRINT_REQUEST)).toEqual([
    { variant: "BackendHasMnemonic", name: "backend-has-mnemonic", category: "Codegen", stable: false },
    { variant: "Cfg", name: "cfg", category: "Target", stable: true },
    { variant: "CrateName", name: "crate-name", category: "Crate", stable: true },
    { variant: "LinkArgs", name: "link-args", category: "Linker", stable: true },
    { variant: "TargetCPUs", name: "target-cpus", category: "Target", stable: true },
  ]);
  expect(mnemonicExample(PRINT_REQUEST)).toBe("NOP");
  expect(specialUnknownRequests(PRINT_REQUEST)).toEqual(["lints", "targets"]);
  // A variant `name` (or `category`, `is_stable`) does not cover is an error, never a guess.
  expect(() => printKinds(PRINT_REQUEST.replace('            Cfg => "cfg",\n', ""))).toThrow("PrintKind::Cfg has no name, category or stability");
  expect(() => printKinds(PRINT_REQUEST.replace("BackendHasMnemonic => false,", ""))).toThrow("PrintKind::BackendHasMnemonic");
  expect(() => printKinds("")).toThrow("no enum PrintKind");
});

test("error codes: the EXXXX.md files, sorted; removed codes from lib.rs's comment lines", () => {
  expect(explainCodes(["E0004.md", "E0001.md", "README.md", "E01.md", "E0002.md.orig", "E0003.txt"])).toEqual(["E0001", "E0004"]);
  const lib = ["macro_rules! error_codes {", "0001,", "0004,", ")", "// Undocumented removed error codes. Note that many removed error codes are kept in the list above", "//  E0006, // merged with E0005", "//  E0564, // only named lifetimes are allowed in `impl Trait`,", "//         // but `{}` was found in the type `{}`", "// see E0001.md", "//  E0722, // replaced"].join("\n");
  expect(removedCodes(lib)).toEqual(["E0006", "E0564", "E0722"]);
});

const ui = (f: string, env?: Record<string, string | null>): Case => ({ id: f, file: f, args: ["--target", "T", "--sysroot", "/sr", "--edition=2021", "--crate-type", "lib", "--emit=metadata", f], ...(env ? { env } : {}) });
const INPUTS: CliInputs = {
  codes: ["E0001", "E0004", "E0722"],
  removed: ["E0006", "E0722", "E0006"],
  printRequest: PRINT_REQUEST,
  target: "T",
  sysroot: "/sr",
  checkUi: [ui("tests/ui/a/auxiliary/x.rs", { RUSTC_ICE: "0", PATH: "/p" }), ui("tests/ui/b/auxiliary/y.rs")],
  lsRmetas: [
    { crate: "core", path: "/d/aux/m5-core-k/libcore.rmeta" },
    { crate: "alloc", path: "/d/aux/m5-alloc-k/liballoc.rmeta" },
  ],
};

test("cases: ids unique, argv per request kind, the exclusions", () => {
  const cs = cliCases(INPUTS);
  expect(new Set(cs.map((c) => c.id)).size).toBe(cs.length);
  const by = (id: string) => {
    const c = cs.find((c) => c.id === id);
    if (!c) throw new Error(`no case ${id}`);
    return c;
  };
  const kinds = new Map<string, number>();
  for (const c of cs) kinds.set(cliKind(c.id), (kinds.get(cliKind(c.id)) ?? 0) + 1);
  expect(Object.fromEntries(kinds)).toEqual({ explain: 6, "explain-color": 3, "W-help": 2, print: 15, "print-unstable": 1, "crate-root-lint-levels": 2, "ls=root": 2, "ls=all": 2 });
  // --explain: every code plain and coloured; removed codes once, unless they have a description; the first code's other forms.
  expect(cs.filter((c) => cliKind(c.id) === "explain").map((c) => c.id)).toEqual(["explain E0001", "explain E0004", "explain E0722", "explain E0006", "explain e0001", "explain 0001"]);
  expect(by("explain E0004")).toEqual({ id: "explain E0004", file: "", args: ["--explain", "E0004"], env: CLI_ENV });
  expect(by("explain-color E0722").args).toEqual(["--explain", "E0722", "--color", "always"]);
  // -W help, without and with the trivial input (the case's file, so its content keys the case).
  expect(by("W-help").args).toEqual(["-W", "help"]);
  expect(by(`W-help ${CLI_TRIVIAL_INPUT}`)).toMatchObject({ file: CLI_TRIVIAL_INPUT, args: ["-W", "help", CLI_TRIVIAL_INPUT] });
  // --print: every kind on the host and the target, the oracle sysroot always, -Zunstable-options for unstable kinds.
  expect(by("print cfg").args).toEqual(["--print", "cfg", "--sysroot", "/sr"]);
  expect(by("print cfg --target T").args).toEqual(["--print", "cfg", "--target", "T", "--sysroot", "/sr"]);
  expect(by("print backend-has-mnemonic --target T").args).toEqual(["--print", "backend-has-mnemonic", "-Zunstable-options", "--target", "T", "--sysroot", "/sr"]);
  expect(by("print backend-has-mnemonic:NOP").args).toEqual(["--print", "backend-has-mnemonic:NOP", "-Zunstable-options", "--sysroot", "/sr"]);
  expect(by("print-unstable backend-has-mnemonic").args).toEqual(["--print", "backend-has-mnemonic", "--sysroot", "/sr"]);
  expect(["print help", "print lints", "print targets"].map((id) => by(id).args[1])).toEqual(["help", "lints", "targets"]);
  // Crate kinds also on the trivial input; Linker kinds never with one; the host's target-cpus left out.
  expect(by(`print crate-name --target T ${CLI_TRIVIAL_INPUT}`)).toMatchObject({ file: CLI_TRIVIAL_INPUT, args: ["--print", "crate-name", "--target", "T", "--sysroot", "/sr", CLI_TRIVIAL_INPUT] });
  expect(cs.filter((c) => c.id.startsWith("print link-args")).map((c) => c.id)).toEqual(["print link-args", "print link-args --target T"]);
  expect(cs.filter((c) => c.id.startsWith("print target-cpus")).map((c) => c.id)).toEqual(["print target-cpus --target T"]);
  expect(cs.filter((c) => c.file !== "" && cliKind(c.id) !== "crate-root-lint-levels").every((c) => c.file === CLI_TRIVIAL_INPUT && c.args.at(-1) === c.file)).toBe(true);
  // crate-root-lint-levels: check-ui's argv with the print before the input, and its env.
  expect(by("crate-root-lint-levels tests/ui/a/auxiliary/x.rs")).toEqual({
    id: "crate-root-lint-levels tests/ui/a/auxiliary/x.rs",
    file: "tests/ui/a/auxiliary/x.rs",
    args: ["--target", "T", "--sysroot", "/sr", "--edition=2021", "--crate-type", "lib", "--emit=metadata", "--print", "crate-root-lint-levels", "-Zunstable-options", "tests/ui/a/auxiliary/x.rs"],
    env: { RUSTC_ICE: "0", PATH: "/p" },
  });
  expect(by("crate-root-lint-levels tests/ui/b/auxiliary/y.rs").env).toBeUndefined();
  // -Zls on each rmeta, keyed by its crate's name, never its path.
  expect(by("ls=all alloc")).toEqual({ id: "ls=all alloc", file: "", args: ["-Zls=all", "--target", "T", "/d/aux/m5-alloc-k/liballoc.rmeta"], env: CLI_ENV });
  // Every synthetic case runs with CLI_ENV, nothing else.
  expect(cs.filter((c) => cliKind(c.id) !== "crate-root-lint-levels").every((c) => c.env === CLI_ENV)).toBe(true);
});

test("the registered suite: report only, no baseline, rustc as the oracle; its cases on the pinned upstream", () => {
  const code = `
const s = await import(${JSON.stringify(join(REPO, "harness/suites.ts"))});
const g = await import(${JSON.stringify(join(REPO, "scripts/gate.ts"))});
const { oracleSysroot, oracleRustcCmd } = await import(${JSON.stringify(join(REPO, "scripts/lib/oracle.ts"))});
const { DATA } = await import(${JSON.stringify(join(REPO, "scripts/lib/common.ts"))});
const x = s.suite("cli");
const ui = s.suite("check-ui").cases();
const cases = x.cases();
const counts = {};
for (const c of cases) for (const [k, f] of Object.entries(x.subsets)) if (f(c)) counts[k] = (counts[k] ?? 0) + 1;
const at = (id) => cases.find((c) => c.id === id);
const sub = x.subject([at("explain E0004")]);
const lint = cases.filter((c) => c.id.startsWith("crate-root-lint-levels "));
console.log(JSON.stringify({
  mode: x.mode, heavy: Boolean(x.heavy), n: cases.length, ids: new Set(cases.map((c) => c.id)).size, counts,
  runs: g.oracleRuns(x.oracle([at("explain E0004")])), undeclared: g.undeclaredRuns(x),
  oracle: JSON.stringify(x.oracle([at("W-help")])) === JSON.stringify(oracleRustcCmd(["-W", "help"])),
  subject: sub.slice(-2), mainTs: sub.some((a) => a.endsWith("src/rust_ts/main.ts") || a.endsWith("/main")),
  sysroot: at("print sysroot").args.at(-1) === oracleSysroot(),
  lintIsCheckUi: lint.length === ui.length && lint.every((c, i) => c.file === ui[i].file && c.args.at(-1) === ui[i].args.at(-1)),
  ls: cases.filter((c) => c.id.startsWith("ls=")).every((c) => c.args.at(-1).startsWith(DATA + "/aux/m5-")),
  noStd: !cases.some((c) => c.id === "ls=root std"),
  keyless: x.oracleKey === undefined,
}));
`;
  const r = Bun.spawnSync([process.execPath, "-e", code], { cwd: REPO, env: { ...process.env, RUSTUP_AUTO_INSTALL: "0" }, stdout: "pipe", stderr: "pipe" });
  expect(r.exitCode, r.stderr.toString()).toBe(0);
  const j = JSON.parse(r.stdout.toString().trim().split("\n").at(-1)!);
  expect(j).toEqual({
    mode: "single",
    heavy: false,
    // At the pin: 518 codes; 130 removed codes without a description, plus 2 forms; 27 print kinds (9 unstable), the host's
    // target-cpus left out, 3 Crate kinds also on the trivial input, the mnemonic example, `help` and `lints`; 730 check-ui
    // crates; std's closure without std is 19 aux crates.
    n: 2009,
    ids: 2009,
    counts: { explain: 650, "explain-color": 518, "W-help": 2, print: 62, "print-unstable": 9, "crate-root-lint-levels": 730, "ls=root": 19, "ls=all": 19 },
    runs: ["rustc"],
    undeclared: [],
    oracle: true,
    subject: ["--explain", "E0004"],
    mainTs: true,
    sysroot: true,
    lintIsCheckUi: true,
    ls: true,
    noStd: true,
    keyless: true,
  });
  expect(existsSync(join(REPO, "harness", "baseline", "cli.txt"))).toBe(false);
}, 120_000);
