// Test helper of src/rustc_driver_impl/describe_lints.test.ts (not ported code): runs the port's `rustc -W help` with a fake
// lint tool registered through `Config.register_lints`, the way a tool driver (clippy-driver) does, and prints what
// `describe_lints` prints. A child process because `safe_println` writes to the real stdout (no in-process capture).
//
// Usage: bun run.ts <spec.json>, where the spec is
//   { lints: [name, level, desc][], groups: [name, member lint names][], extra_args?: string[] }
// `name` is a lint's `Lint.name` (`tool::UPPER_SNAKE`), `level` a `Level` variant name; a group member that names no lint of
// `lints` gets an unregistered `Lint` of its own (a `LintId` only needs the lint's name to print).
import { readFileSync } from "node:fs";
import { catch_with_exit_code, compiler_entrypoint } from "../lib.ts";
import type { Config } from "../../rustc_interface/interface.ts";
import type { LintStore } from "../../rustc_lint/lib.ts";
import { type Level, Lint, LintId } from "../../rustc_lint_defs/lib.ts";
import type { Session } from "../../rustc_session/session.ts";

interface Spec {
  lints: [string, Level, string][];
  groups: [string, string[]][];
  extra_args?: string[];
}

const spec = JSON.parse(readFileSync(process.argv[2]!, "utf8")) as Spec;

const by_name = new Map<string, Lint>();
const lint_of = (name: string, default_level: Level, desc: string): Lint => {
  const lint: Lint = { ...Lint.default_fields_for_macro(), name, default_level, desc, is_externally_loaded: true };
  by_name.set(name, lint);
  return lint;
};
const lints = spec.lints.map(([name, level, desc]) => lint_of(name, level, desc));

const register_lints = (_sess: Session, lint_store: LintStore): void => {
  lint_store.register_lints(lints);
  for (const [group, members] of spec.groups) {
    const ids = members.map((m) => LintId.of(by_name.get(m) ?? lint_of(m, "Allow", "")));
    lint_store.register_group(true, group, undefined, ids);
  }
};

const code = catch_with_exit_code(() =>
  compiler_entrypoint(["rustc", "-W", "help", ...(spec.extra_args ?? [])], {
    config(config: Config) {
      config.register_lints = register_lints;
    },
  }),
);
process.exit(code);
