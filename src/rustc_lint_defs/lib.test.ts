// rust-ts tests for rustc_lint_defs (upstream has no `#[cfg(test)]` tests in compiler/rustc_lint_defs).
// Every assertion cites the upstream line whose behaviour it checks; the `reference()` texts are also
// checked against diagnostics of the pinned rustc (skipped when it is unavailable, failing under
// RUST_TS_REQUIRE_PROBES=1).
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../../scripts/lib/common.ts";
import { Diag, DiagCtxt, DiagCtxtFlags_default, type DiagInner, Level as ErrLevel, Level_eq } from "../rustc_errors/lib.ts";
import { Emitter } from "../rustc_errors/emitter.ts";
import { AttrId, create_default_session_globals_then } from "../rustc_span/lib.ts";
import { sym } from "../rustc_span/symbol.ts";
import { PLAIN, PRETTY } from "../std/fmt.ts";
import { Panic } from "../std/panic.ts";
import {
  debug_LintExpectationId,
  display_EditionFcw,
  display_ReleaseFcw,
  FutureIncompatibilityReason,
  FutureIncompatibleInfo,
  impl_lint_pass,
  Level,
  Lint,
  LintExpectationId,
  LintId,
  listify,
  pluralize,
} from "./lib.ts";
import { FORBIDDEN_LINT_GROUPS, RECURSION_DEPTH_EXCEEDING_LIMIT, UNSAFE_OP_IN_UNSAFE_FN, UNUSED_IMPORTS, UnusedDocComment, hardwired } from "./builtin.ts";

const test_ = (name: string, f: () => void): void => {
  test(name, () => create_default_session_globals_then(f));
};

test("listify and pluralize", () => {
  // lib.rs:44-51
  expect(listify([], String)).toBeUndefined();
  expect(listify([1], String)).toBe("1");
  expect(listify([1, 2], String)).toBe("1 and 2");
  expect(listify(["a", "b", "c"], (s) => `\`${s}\``)).toBe("`a`, `b` and `c`");
  // lib.rs:19-35
  expect(pluralize(1)).toBe("");
  expect(pluralize(2)).toBe("s");
  expect(pluralize("has", 1)).toBe("has");
  expect(pluralize("has", 0)).toBe("have");
  expect(pluralize("is", 3)).toBe("are");
  expect(pluralize("was", 1)).toBe("was");
  expect(pluralize("this", 2)).toBe("these");
});

test_("Level conversions", () => {
  // lib.rs:189 as_str, 202 from_str (never Expect), 218 from_symbol, 229 to_cmd_flag, 242 is_error
  expect(Level.as_str("ForceWarn")).toBe("force-warn");
  expect(Level.from_str("warn")).toBe("Warn");
  expect(Level.from_str("expect")).toBeUndefined();
  expect(Level.from_str("force-warn")).toBeUndefined();
  expect(Level.from_symbol(sym.expect)).toBe("Expect");
  expect(Level.from_symbol(sym.forbid)).toBe("Forbid");
  expect(Level.from_opt_symbol(undefined)).toBeUndefined();
  expect(Level.from_opt_symbol(sym.allow)).toBe("Allow");
  expect(Level.to_cmd_flag("ForceWarn")).toBe("--force-warn");
  expect(() => Level.to_cmd_flag("Expect")).toThrow(Panic);
  expect(Level.is_error("Deny")).toBe(true);
  expect(Level.is_error("ForceWarn")).toBe(false);
  // lib.rs:251 into_diag_arg uses the command-line flag
  expect(Level.into_diag_arg("Deny", { value: undefined })).toEqual({ $: "Str", _0: "-D" });
});

test("Lint helpers and the generated statics", () => {
  // lib.rs:564 name_lower; declare_lint! uses stringify!($NAME)
  expect(UNUSED_IMPORTS.name).toBe("UNUSED_IMPORTS");
  expect(Lint.name_lower(UNUSED_IMPORTS)).toBe("unused_imports");
  // lib.rs:568 default_level: `@edition Edition2024 => Warn` applies from 2024 on
  expect(Lint.default_level(UNSAFE_OP_IN_UNSAFE_FN, "Edition2021")).toBe("Allow");
  expect(Lint.default_level(UNSAFE_OP_IN_UNSAFE_FN, "Edition2024")).toBe("Warn");
  expect(Lint.default_level(UNSAFE_OP_IN_UNSAFE_FN, "EditionFuture")).toBe("Warn");
  // lib.rs:514 / 451 defaults as filled in by the macro
  const d = Lint.default_fields_for_macro();
  expect(d.default_level).toBe("Forbid");
  expect(FutureIncompatibleInfo.default_fields_for_macro()).toEqual({ reason: { $: "Unreachable" }, explain_reason: true, report_in_deps: false });
  expect(FORBIDDEN_LINT_GROUPS.ignore_deny_warnings).toBe(true);
  expect(FORBIDDEN_LINT_GROUPS.future_incompatible?.report_in_deps).toBe(true);
  expect(FORBIDDEN_LINT_GROUPS.future_incompatible?.explain_reason).toBe(true);
  // lib.rs:533 parse_rust_version
  expect(Lint.parse_rust_version("1.70.2")).toEqual(expect.objectContaining({ major: 1, minor: 70, patch: 2 }));
  expect(Lint.parse_rust_version("1.70")).toEqual(expect.objectContaining({ major: 1, minor: 70, patch: 0 }));
  expect(() => Lint.parse_rust_version("1.x")).toThrow("invalid character in version");
  // lib.rs:461 edition / 475 reference
  const r = FORBIDDEN_LINT_GROUPS.future_incompatible!.reason;
  expect(FutureIncompatibilityReason.edition(r)).toBeUndefined();
  expect(FutureIncompatibilityReason.reference(r)).toBe("issue #81670 <https://github.com/rust-lang/rust/issues/81670>");
  const e = UNSAFE_OP_IN_UNSAFE_FN.future_incompatible!.reason;
  expect(FutureIncompatibilityReason.edition(e)).toBe("Edition2024");
  expect(display_EditionFcw({ edition: "Edition2018", page_slug: "x" })).toBe("<https://doc.rust-lang.org/edition-guide/rust-2018/x.html>");
  expect(display_ReleaseFcw({ issue_number: 1 })).toBe("issue #1 <https://github.com/rust-lang/rust/issues/1>");
  expect(() => FutureIncompatibilityReason.edition(FutureIncompatibilityReason.Unreachable)).toThrow(Panic);
  // hardwired::lint_vec order (tidy-alphabetical) and the declare_lint_pass! expansion
  const hw = hardwired.lint_vec();
  expect(hw.length).toBe(147);
  expect(hw[0]!.name).toBe("AARCH64_SOFTFLOAT_NEON");
  expect(hw).toContain(RECURSION_DEPTH_EXCEEDING_LIMIT);
  expect(new UnusedDocComment().name()).toBe("UnusedDocComment");
  expect(UnusedDocComment.lint_vec().map((l) => l.name)).toEqual(["UNUSED_DOC_COMMENTS"]);
  const pass = impl_lint_pass("Foo", () => [UNUSED_IMPORTS]);
  expect([pass.name(), pass.get_lints()[0]!.name, pass.lint_vec().length]).toEqual(["Foo", "UNUSED_IMPORTS", 1]);
});

test("LintId identity is the Lint (pointer equality, lib.rs:584)", () => {
  const a = LintId.of(UNUSED_IMPORTS);
  expect(LintId.of(UNUSED_IMPORTS)).toBe(a);
  expect(LintId.eq(a, LintId.of(UNUSED_IMPORTS))).toBe(true);
  // a different static with the same contents is a different lint
  const copy: Lint = { ...UNUSED_IMPORTS };
  expect(LintId.eq(a, LintId.of(copy))).toBe(false);
  expect(new Set([a, LintId.of(UNUSED_IMPORTS)]).size).toBe(1);
  // lib.rs:609 to_string, 624 stable_cmp by raw name
  expect(LintId.to_string(a)).toBe("unused_imports");
  expect(LintId.stable_cmp(LintId.of(FORBIDDEN_LINT_GROUPS), a)).toBe(-1);
  expect(LintId.stable_cmp(a, a)).toBe(0);
});

test("LintExpectationId compares by value (derived PartialEq/Hash, lib.rs:102)", () => {
  const x = LintExpectationId.Unstable({ attr_id: AttrId.from_u32(3), lint_index: 1 });
  const y = LintExpectationId.from_UnstableLintExpectationId({ attr_id: AttrId.from_u32(3), lint_index: 1 });
  const z = LintExpectationId.Unstable({ attr_id: AttrId.from_u32(3), lint_index: 2 });
  expect(x).toBe(y);
  expect(x).not.toBe(z);
  expect(new Set([x, y, z]).size).toBe(2);
  // derive(Debug)
  expect(debug_LintExpectationId(x, PLAIN)).toBe("Unstable(UnstableLintExpectationId { attr_id: AttrId(3), lint_index: 1 })");
  expect(debug_LintExpectationId(x, PRETTY)).toBe(
    "Unstable(\n    UnstableLintExpectationId {\n        attr_id: AttrId(3),\n        lint_index: 1,\n    },\n)",
  );
});

class NullEmitter extends Emitter {
  readonly emitted: string[] = [];
  emit_diagnostic(diag: DiagInner): void {
    this.emitted.push(ErrLevel.to_str(diag.level));
  }
  source_map(): undefined {
    return undefined;
  }
}

test_("fulfilled expectations are a set of values (rustc_errors lib.rs:925 fulfill_expectation, :934 steal)", () => {
  const em = new NullEmitter();
  const dcx = DiagCtxt.new(em).with_flags({ ...DiagCtxtFlags_default(), can_emit_warnings: true });
  const h = dcx.handle();
  const mk = (attr: number, idx: number): LintExpectationId => LintExpectationId.Unstable({ attr_id: AttrId.from_u32(attr), lint_index: idx });
  // Two separately built, equal ids fulfil one expectation; the dummy diagnostics are suppressed.
  h.fulfill_expectation(mk(7, 0));
  h.fulfill_expectation(mk(7, 0));
  h.fulfill_expectation(mk(7, 1));
  // A `force-warn` of an `expect`ed lint also fulfils it (lib.rs Forced { lint_id: Some(..) }) and is emitted.
  Diag.new(h, { $: "Warning", _0: { $: "Forced", lint_id: mk(8, 0) } }, "forced").emit();
  expect(em.emitted).toEqual(["warning"]);
  expect(dcx.inner.suppressed_expected_diag).toBe(true);
  const stolen = h.steal_fulfilled_expectation_ids();
  expect(stolen.size).toBe(3);
  expect(stolen.has(mk(7, 0))).toBe(true);
  expect(stolen.has(mk(7, 1))).toBe(true);
  expect(stolen.has(mk(8, 0))).toBe(true);
  expect(stolen.has(mk(7, 2))).toBe(false);
  expect(h.steal_fulfilled_expectation_ids().size).toBe(0);
  // derived PartialEq on rustc_errors::Level compares the ids by value
  expect(Level_eq({ $: "Warning", _0: { $: "Expected", lint_id: mk(1, 0) } }, { $: "Warning", _0: { $: "Expected", lint_id: mk(1, 0) } })).toBe(true);
  expect(Level_eq({ $: "Warning", _0: { $: "Expected", lint_id: mk(1, 0) } }, { $: "Warning", _0: { $: "Expected", lint_id: mk(1, 1) } })).toBe(false);
  expect(Level_eq({ $: "Warning", _0: { $: "Forced", lint_id: mk(1, 0) } }, { $: "Warning", _0: { $: "Forced", lint_id: mk(1, 0) } })).toBe(true);
});

// ---- oracle: `reference()` texts as printed by the pinned rustc ---------------------------------

const REQUIRE_PROBES = process.env.RUST_TS_REQUIRE_PROBES === "1";
function rustcStderr(name: string, src: string, edition: string): string | undefined {
  const dir = join(DATA, "tmp", "lint-defs-oracle", process.env.RUST_TS_AGENT ?? "default");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.rs`);
  writeFileSync(file, src);
  try {
    const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "--edition", edition, "--emit=metadata", "-o", join(dir, `${name}.rmeta`), file], { stderr: "pipe" });
    return r.stderr.toString().replaceAll("\r\n", "\n");
  } catch {
    return undefined;
  }
}
const HAVE_RUSTC = rustcStderr("probe", "fn main() {}\n", "2021") === "";
const SKIP = !HAVE_RUSTC && !REQUIRE_PROBES;
if (SKIP) console.log(`SKIP: rustc +${PIN.toolchain} unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);

test.skipIf(SKIP)("FutureIncompatibilityReason::reference matches rustc's `for more information, see ...` note", () => {
  if (!HAVE_RUSTC) throw new Error(`ERROR: rustc +${PIN.toolchain} unavailable and RUST_TS_REQUIRE_PROBES=1`);
  const a = rustcStderr("forbid", "#![forbid(warnings)]\n#![warn(bad_style)]\nfn main() {}\n", "2021")!;
  expect(a).toContain(`= note: for more information, see ${FutureIncompatibilityReason.reference(FORBIDDEN_LINT_GROUPS.future_incompatible!.reason)}\n`);
  const b = rustcStderr("unsafe_op", "#![warn(unsafe_op_in_unsafe_fn)]\nunsafe fn f(p: *const i32) -> i32 { *p }\nfn main() { let _ = f; }\n", "2021")!;
  expect(b).toContain(`= note: for more information, see ${FutureIncompatibilityReason.reference(UNSAFE_OP_IN_UNSAFE_FN.future_incompatible!.reason)}\n`);
});
