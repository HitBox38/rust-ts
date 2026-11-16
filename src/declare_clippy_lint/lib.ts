// Port of src/tools/clippy/declare_clippy_lint/src/lib.rs (crate `declare_clippy_lint`, plan-m8 D4; lane clippy-contract-a).
// Only the non-macro code: `declare_clippy_lint!` / `declare_clippy_lint_inner!` are expanded by tools/codegen/clippy.ts
// into each module's `<m>.lints.gen.ts` (plan-m8 D5), whose `<NAME>_INFO` statics are `LintInfo` values.
//
// `pub extern crate rustc_lint;` (needed by the macro) has no TS counterpart.
import { type Lint, LintId } from "../rustc_lint_defs/lib.ts";
import type { LintStore } from "../rustc_lint/context.ts";
import { unwrap } from "../std/panic.ts";

// #[derive(Default)]
export class LintListBuilder {
  constructor(
    public lints: Lint[],
    public all: LintId[],
    public cargo: LintId[],
    public complexity: LintId[],
    public correctness: LintId[],
    public nursery: LintId[],
    public pedantic: LintId[],
    public perf: LintId[],
    public restriction: LintId[],
    public style: LintId[],
    public suspicious: LintId[],
  ) {}

  /** `#[derive(Default)]` */
  static default(): LintListBuilder {
    return new LintListBuilder([], [], [], [], [], [], [], [], [], [], []);
  }

  // rustc: src/tools/clippy/declare_clippy_lint/src/lib.rs:23 insert
  insert(lints: readonly LintInfo[]): void {
    // #[allow(clippy::enum_glob_use)]
    // use LintCategory::*;

    this.lints.push(...lints.map((x) => x.lint));
    for (const { lint, category } of lints) {
      let all: LintId[] | undefined;
      let cat: LintId[];
      switch (category) {
        case "Complexity":
          [all, cat] = [this.all, this.complexity];
          break;
        case "Correctness":
          [all, cat] = [this.all, this.correctness];
          break;
        case "Perf":
          [all, cat] = [this.all, this.perf];
          break;
        case "Style":
          [all, cat] = [this.all, this.style];
          break;
        case "Suspicious":
          [all, cat] = [this.all, this.suspicious];
          break;
        case "Cargo":
          [all, cat] = [undefined, this.cargo];
          break;
        case "Nursery":
          [all, cat] = [undefined, this.nursery];
          break;
        case "Pedantic":
          [all, cat] = [undefined, this.pedantic];
          break;
        case "Restriction":
          [all, cat] = [undefined, this.restriction];
          break;
      }
      if (all !== undefined) {
        all.push(LintId.of(lint));
      }
      cat.push(LintId.of(lint));
    }
  }

  // rustc: src/tools/clippy/declare_clippy_lint/src/lib.rs:47 register
  register(store: LintStore): void {
    store.register_lints(this.lints);
    store.register_group(true, "clippy::default", "clippy_all", this.all);
    store.register_group_alias("clippy::default", "clippy::all");
    store.register_group(true, "clippy::cargo", "clippy_cargo", this.cargo);
    store.register_group(true, "clippy::complexity", "clippy_complexity", this.complexity);
    store.register_group(true, "clippy::correctness", "clippy_correctness", this.correctness);
    store.register_group(true, "clippy::nursery", "clippy_nursery", this.nursery);
    store.register_group(true, "clippy::pedantic", "clippy_pedantic", this.pedantic);
    store.register_group(true, "clippy::perf", "clippy_perf", this.perf);
    store.register_group(true, "clippy::restriction", "clippy_restriction", this.restriction);
    store.register_group(true, "clippy::style", "clippy_style", this.style);
    store.register_group(true, "clippy::suspicious", "clippy_suspicious", this.suspicious);
  }
}

// #[derive(Copy, Clone, Debug)]
export type LintCategory = "Cargo" | "Complexity" | "Correctness" | "Nursery" | "Pedantic" | "Perf" | "Restriction" | "Style" | "Suspicious";
export const LintCategory = {
  Cargo: "Cargo",
  Complexity: "Complexity",
  Correctness: "Correctness",
  Nursery: "Nursery",
  Pedantic: "Pedantic",
  Perf: "Perf",
  Restriction: "Restriction",
  Style: "Style",
  Suspicious: "Suspicious",

  // #[must_use]
  // rustc: src/tools/clippy/declare_clippy_lint/src/lib.rs:87 name
  name(self: LintCategory): string {
    switch (self) {
      case "Cargo":
        return "cargo";
      case "Complexity":
        return "complexity";
      case "Correctness":
        return "correctness";
      case "Nursery":
        return "nursery";
      case "Pedantic":
        return "pedantic";
      case "Perf":
        return "perf";
      case "Restriction":
        return "restriction";
      case "Style":
        return "style";
      case "Suspicious":
        return "suspicious";
    }
  },
} as const;

/** `#[derive(Debug)]` of the fieldless enum: the variant name. */
export const debug_LintCategory = (v: LintCategory): string => v;

export interface LintInfo {
  readonly lint: Lint;
  readonly category: LintCategory;
  readonly explanation: string;
  /// e.g. `clippy_lints/src/absolute_paths.rs#43`
  readonly location: string;
  readonly version: string;
}

// PORT: `impl LintInfo` on an interface (the generated `<NAME>_INFO` statics are plain frozen objects): the method lives on the
// companion const (PORTING §8, as for enums).
export const LintInfo = {
  /// Returns the lint name in lowercase without the `clippy::` prefix
  // #[must_use]
  // #[expect(clippy::missing_panics_doc)]
  // rustc: src/tools/clippy/declare_clippy_lint/src/lib.rs:115 name_lower
  name_lower(self: LintInfo): string {
    return to_ascii_lowercase(unwrap(strip_prefix(self.lint.name, "clippy::")));
  },
} as const;

/** `str::strip_prefix` */
function strip_prefix(s: string, prefix: string): string | undefined {
  return s.startsWith(prefix) ? s.slice(prefix.length) : undefined;
}

/** `str::to_ascii_lowercase`: only `A`..=`Z` change. */
function to_ascii_lowercase(s: string): string {
  return s.replace(/[A-Z]+/g, (m) => m.toLowerCase());
}
