// Unit tests of src/declare_clippy_lint/lib.ts (lane clippy-contract-a). The registration listing: `LintListBuilder::insert` of
// clippy_lints's `declared_lints::LINTS`, then `register` on a fresh lint store (`rustc_lint::new_lint_store`), compared with the
// pinned `clippy-driver -W help`: every loaded lint's name, default level and description in `-W help`'s order, and every loaded
// group with its members in order.
//
// PORT: the comparison parses the oracle's two "loaded by this crate" sections rather than running the port's `describe_lints`
// (src/rustc_driver_impl/lib.ts), whose loaded-lints table has a bug outside this lane (its second `padded` rebinding reaches
// `print_lints`; docs/handoff/clippy-contract-a.md). With that fixed, the port's whole `-W help` output was checked equal to the
// oracle's, byte for byte, in a child process.
import { expect, test } from "bun:test";
import { LINTS } from "../clippy_lints/declared_lints.ts";
import { new_lint_store } from "../rustc_lint/lib.ts";
import { Level, Level_discriminant, type Lint, Lint as LintC, LintId as LintIdC } from "../rustc_lint_defs/lib.ts";
import { LintCategory, LintInfo, LintListBuilder } from "./lib.ts";

test("LintCategory::name and LintInfo::name_lower", () => {
  const names = (["Cargo", "Complexity", "Correctness", "Nursery", "Pedantic", "Perf", "Restriction", "Style", "Suspicious"] as const).map((c) => LintCategory.name(c));
  expect(names).toEqual(["cargo", "complexity", "correctness", "nursery", "pedantic", "perf", "restriction", "style", "suspicious"]);
  expect(LINTS.length).toBe(835);
  expect(LintInfo.name_lower(LINTS[0]!)).toBe("absolute_paths");
  for (const info of LINTS) expect(`clippy::${LintInfo.name_lower(info).toUpperCase()}`).toBe(info.lint.name);
});

/** The rows of one `-W help` section: the lines after `title`'s two header rows, up to the first empty line. */
function section(text: string, title: string): string[] {
  const lines = text.split("\n");
  const at = lines.indexOf(title);
  expect(at).toBeGreaterThanOrEqual(0);
  const rows: string[] = [];
  for (let i = at + 4; i < lines.length && lines[i] !== ""; i++) rows.push(lines[i]!.trimStart());
  return rows;
}

test("the registration listing equals the pinned clippy-driver -W help", async () => {
  const { verifyToolOracles, toolOracleCmd, toolOracleEnv } = await import("../../scripts/lib/oracle.ts");
  verifyToolOracles();
  const oracle = Bun.spawnSync(toolOracleCmd("clippy", "clippy-driver", ["-W", "help"]), {
    env: { ...process.env, ...toolOracleEnv() },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(oracle.exitCode).toBe(0);
  const text = oracle.stdout.toString();

  const lint_store = new_lint_store(false);
  const list_builder = LintListBuilder.default();
  list_builder.insert(LINTS);
  list_builder.register(lint_store);

  // describe_lints's `sort_lints`: by `(default_level(edition), name)`, stable; the default session edition (2015)
  const loaded = lint_store
    .get_lints()
    .filter((lint) => lint.is_externally_loaded)
    .map((lint): [number, string, Lint] => [Level_discriminant[LintC.default_level(lint, "Edition2015")], lint.name, lint])
    .sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([, , lint]) => `${LintC.name_lower(lint).replaceAll("_", "-")}  ${Level.as_str(LintC.default_level(lint, "Edition2015")).slice(0, 7).padEnd(7)}  ${lint.desc}`);
  const want_lints = section(text, "Lint checks loaded by this crate:");
  expect(want_lints.length).toBe(835);
  expect(loaded.map((r) => r.replace(/ +$/, ""))).toEqual(want_lints.map((r) => r.replace(/ +$/, "")));

  // `sort_lint_groups`: by name
  const groups = [...lint_store.get_lint_groups()]
    .filter(([, , is_externally_loaded]) => is_externally_loaded)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([name, to]) => `${name.toLowerCase().replaceAll("_", "-")}  ${to.map((x) => LintIdC.to_string(x).replaceAll("_", "-")).join(", ")}`);
  const want_groups = section(text, "Lint groups loaded by this crate:");
  expect(want_groups.map((r) => r.split("  ")[0])).toEqual(["clippy::cargo", "clippy::complexity", "clippy::correctness", "clippy::default", "clippy::nursery", "clippy::pedantic", "clippy::perf", "clippy::restriction", "clippy::style", "clippy::suspicious"]);
  expect(groups).toEqual(want_groups);
});
