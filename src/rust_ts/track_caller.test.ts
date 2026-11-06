// Tests for src/rust_ts/track_caller.ts (`DiagLocation::caller` resolution) through the driver.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keep_frame } from "../std/panic.ts";
import { is_track_caller_owner, map_call, type Owner, TAIL_CALLS, ts_file, TsFile, up_file } from "./track_caller.ts";

const MAIN = join(import.meta.dir, "main.ts");
const SRC = "fn main() {\n    let x = ;\n}\n";

// `rustc +nightly -Ztrack-diagnostics -Zparse-crate-root-only p.rs` (pinned nightly 6f5da406b56c), exit 1.
const ORACLE_STDERR = `error: expected expression, found \`;\`
 --> p.rs:2:13
  |
2 |     let x = ;
  |             ^ expected expression
  |
  = note: -Ztrack-diagnostics: created at /rustc-dev/6f5da406b56c2db6607202b63daee73aa8c61297/compiler/rustc_parse/src/parser/diagnostics.rs:2237:34

error: aborting due to 1 previous error

`;

function run(env: Record<string, string | undefined>): { code: number; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), "rust-ts-track-caller-"));
  try {
    writeFileSync(join(dir, "p.rs"), SRC);
    const r = Bun.spawnSync([process.execPath, MAIN, "-Ztrack-diagnostics", "-Zparse-crate-root-only", "p.rs"], {
      cwd: dir,
      env: { ...process.env, ...env },
    });
    return { code: r.exitCode, stderr: r.stderr.toString() };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("this process runs with JSC proper tail calls (the default)", () => {
  expect(TAIL_CALLS).toBe(process.env.BUN_JSC_useTailCalls !== "0" && process.env.BUN_JSC_useTailCalls !== "false");
});

test("without tail calls the location is the upstream call site, as the oracle prints it", () => {
  const r = run({ BUN_JSC_useTailCalls: "0" });
  expect(r.stderr).toBe(ORACLE_STDERR);
  expect(r.code).toBe(1);
});

test("with tail calls a dropped frame makes the location unported, never a guess", () => {
  const r = run({ BUN_JSC_useTailCalls: "1" });
  expect(r.code).toBe(70);
  expect(r.stderr).toEndWith("rust-ts: unported: std::panic::Location::caller (DiagLocation Display)\n");
  const d = run({ BUN_JSC_useTailCalls: "1", RUST_TS_TRACK_CALLER_DEBUG: "1" });
  expect(d.stderr).toContain("rust-ts: unported: std::panic::Location::caller (DiagLocation Display: ");
  expect(r.stderr).not.toContain("created at");
});

// Bun 1.4.3: the shapes that keep the frame of a call that must stay on the stack (docs/reviews/plan-ice-report.md F2).
// A Bun upgrade can change these.
function stack_here(): string {
  return new Error().stack ?? "";
}
function shape_bare(): string {
  let out = "";
  const thrower = (): never => {
    out = stack_here();
    throw new Error("stop");
  };
  try {
    (function shape_bare_inner(): void {
      thrower();
    })();
  } catch {}
  return out;
}
function shape_keep_frame_inner(): string {
  return keep_frame(stack_here());
}
function shape_try_finally_inner(): string {
  try {
    return stack_here();
  } finally {
  }
}
function shape_tail_inner(): string {
  return stack_here();
}
function shape_folded_inner(): string {
  const r = stack_here();
  return r;
}

test("the frame-keeping shapes keep the frame; the shapes that look like them do not", () => {
  expect(shape_bare()).toContain("shape_bare_inner");
  expect(shape_keep_frame_inner()).toContain("shape_keep_frame_inner");
  expect(shape_try_finally_inner()).toContain("shape_try_finally_inner");
  if (TAIL_CALLS) {
    expect(shape_tail_inner()).not.toContain("shape_tail_inner");
    expect(shape_folded_inner()).not.toContain("shape_folded_inner");
  }
});

// The mapping's safety rules (review of plan-ice-report, D4), on the fn where a real swap was found.
const LEXER = "compiler/rustc_parse/src/lexer/mod.rs";
const LEXER_FN = 161;
function lexer_port(order: string[]): { ts: TsFile; owner: Owner } {
  const calls = order.map((c) => `  this.dcx().emit_err(diagnostics.${c}_diagnostic({ span }));`).join("\n");
  const ts = new TsFile(`// rustc: ${LEXER}:${LEXER_FN} next_token_from_cursor\nfunction next_token_from_cursor() {\n${calls}\n}\n`);
  return { ts, owner: ts.owners[0]! };
}
const LEXER_ORDER = ["CannotBeRawIdent", "UnderscoreLiteralSuffix", "CannotBeRawLifetime", "UnknownTokenStart"];

function map_at(ts: TsFile, owner: Owner, callee: string, k: number): ReturnType<typeof map_call> {
  const calls = ts.calls_in(owner, callee, false);
  return map_call(ts, owner, callee, false, calls[k]![0], calls[k]![1]);
}

test("D4: siblings map only when a unique key agrees; a rotated arm is refused, not printed", () => {
  const good = lexer_port(LEXER_ORDER);
  for (let k = 0; k < LEXER_ORDER.length; k++) {
    const m = map_at(good.ts, good.owner, "emit_err", k);
    if (!m.ok) throw new Error(m.why);
    expect(m.up.call_key(m.call, "emit_err")).toBe(`struct ${LEXER_ORDER[k]}`);
  }
  // The rotation the lexer had: `\\` printed `lexer/mod.rs:341:40` where the oracle prints `:495:32`.
  const bad = lexer_port(["CannotBeRawIdent", "UnknownTokenStart", "UnderscoreLiteralSuffix", "CannotBeRawLifetime"]);
  for (const k of [1, 2, 3]) {
    const m = map_at(bad.ts, bad.owner, "emit_err", k);
    expect(m.ok).toBe(false);
    expect(m.ok ? "" : m.why).toContain("key ");
  }
  // Rotating does not move the first one.
  expect(map_at(bad.ts, bad.owner, "emit_err", 0).ok).toBe(true);
});

test("D4: a call count that differs refuses, and so do siblings with no key", () => {
  const short = lexer_port(LEXER_ORDER.slice(0, 3));
  const m = map_at(short.ts, short.owner, "emit_err", 0);
  expect(m.ok ? "" : m.why).toContain("called 3x in TS, 4x");
  const ts = new TsFile(`// rustc: ${LEXER}:${LEXER_FN} next_token_from_cursor\nfunction next_token_from_cursor() {\n  a.emit_err(x);\n  a.emit_err(x);\n  a.emit_err(x);\n  a.emit_err(x);\n}\n`);
  const n = map_at(ts, ts.owners[0]!, "emit_err", 2);
  expect(n.ok ? "" : n.why).toContain("no key");
});

test("the rustc-call anchor names the upstream call, and a wrong one refuses", () => {
  const up = up_file(LEXER)!;
  const body = up.fn_body(LEXER_FN)!;
  const [line, col0] = up.line_col(up.calls_in(body, "emit_err")[3]!.pos);
  const port = (anchor: string): { ts: TsFile; owner: Owner } => {
    const ts = new TsFile(`// rustc: ${LEXER}:${LEXER_FN} next_token_from_cursor\nfunction next_token_from_cursor() {\n  // rustc-call: ${anchor}\n  a.emit_err(x);\n}\n`);
    return { ts, owner: ts.owners[0]! };
  };
  const good = port(`${line}:${col0 + 1}`);
  const m = map_at(good.ts, good.owner, "emit_err", 0);
  if (!m.ok) throw new Error(m.why);
  expect(m.anchored).toBe(true);
  expect(m.up.line_col(m.call.pos)).toEqual([line, col0]);
  const bad = port(`${line}:${col0 + 2}`);
  const n = map_at(bad.ts, bad.owner, "emit_err", 0);
  expect(n.ok ? "" : n.why).toContain("names no call");
});

test("a call left in the owner does not map onto one in an item nested upstream (review ice-report-impl F1)", () => {
  const file = join(import.meta.dir, "..", "rustc_mir_transform", "ref_prop.ts");
  const ts = ts_file(file);
  const owner = ts.owners.find((o) => o.kind === "fn" && o.path.endsWith("ref_prop.rs") && ts.lines.slice(o.start - 1, o.end).join("\n").includes("assert(place.local !== local"))!;
  expect(owner).toBeDefined();
  const line = ts.lines.findIndex((l) => l.includes("assert(place.local !== local")) + 1;
  const col = ts.lines[line - 1]!.indexOf("assert(") + 1;
  const m = map_call(ts, owner, "assert", false, line, col);
  expect(m.ok).toBe(false);
  expect(m.ok ? "" : m.why).toContain("nested item");
});

test("in_nested_item: the item shapes of re-check N1, on synthetic source", () => {
  // Each `CALL` is in a nested item, or not, as the name of the case says. The up file reads a `.rs` under the upstream checkout, so
  // this takes its prototype's method on an object with only `masked`, which is all the method reads.
  const nested = (body: string): boolean => {
    const src = `fn owner() {\n${body}\n}\n`;
    const in_nested_item = up_file("compiler/rustc_mir_transform/src/ref_prop.rs")!.in_nested_item;
    return in_nested_item.call({ masked: src } as never, [src.indexOf("{"), src.lastIndexOf("}")], src.indexOf("CALL"));
  };
  for (const body of [
    "fn n() { CALL(); }",
    "fn n(x: [u8; { 1 }]) { CALL(); }",
    "impl Foo<{ 1 }> { const X: u8 = CALL(); }",
    "const X: u8 = CALL();",
    "const X: u8 = { CALL() };",
    "static X: u8 = CALL();",
    "static mut X: u8 = CALL();",
    "pub static X: T = T::new(CALL);",
    "safe fn n() { CALL(); }",
    "gen fn n() { CALL(); }",
    "m!(fn n() { CALL(); })",
    "fn \u00e9t\u00e9() { CALL(); }",
    "trait T { fn f() { CALL(); } }",
    "mod m { CALL!(); }",
    "unsafe impl T for U { CALL!(); }",
  ]) {
    expect([body, nested(body)]).toEqual([body, true]);
  }
  for (const body of [
    "CALL();",
    "trait T { fn f(); } if x { CALL(); }",
    "fn n(); CALL();",
    "const X: u8 = 1; CALL();",
    "static X: u8 = 1; CALL();",
    "let c = const { 1 }; CALL();",
    "fn n() {} CALL();",
    "let f: fn(u8) = g; CALL();",
    "impl_trait(CALL);",
  ]) {
    expect([body, nested(body)]).toEqual([body, false]);
  }
});

test("a `static` nested in a fn at the pin is a nested item, as re-check N1 found the regex missed", () => {
  const up = up_file("compiler/rustc_driver_impl/src/lib.rs")!;
  const line = up.lines.findIndex((l) => l.includes("static FIRST_PANIC")) + 1;
  expect(line).toBeGreaterThan(0);
  const at = up.src.indexOf("static FIRST_PANIC");
  const fn_line = up.lines.slice(0, line).findLastIndex((l) => /^\s*(pub )?fn /.test(l)) + 1;
  const body = up.fn_body(fn_line)!;
  const call = up.src.indexOf("AtomicBool::new", at);
  expect(up.in_nested_item(body, call)).toBe(true);
  expect(up.in_nested_item(body, up.src.indexOf(";", call) + 5)).toBe(false);
});

test("`impl` in the owner's own signature is a type, not a nested item", () => {
  const up = up_file("compiler/rustc_attr_parsing/src/attributes/repr.rs")!;
  const at = up.src.indexOf("-> impl IntoIterator");
  expect(at).toBeGreaterThan(0);
  const start = up.src.lastIndexOf("fn ", at);
  const open = up.src.indexOf("{", at);
  expect(up.in_nested_item([start, up.src.indexOf("\n    }", open) + 6], open + 40)).toBe(false);
});

test("key normalization: placeholders, escapes and continuations compare equal across the two languages", () => {
  const path = "compiler/rustc_mir_transform/src/validate.rs";
  const up = up_file(path)!;
  // `self.fail(location, format!("..."))` has a literal; `cfg_checker.fail(location, msg)` has none.
  const body = up.fn_body(37)!;
  const calls = up.calls_in(body, "fail");
  expect(up.call_key(calls[0]!, "fail")).toBeUndefined();
  expect(up.call_key(calls[2]!, "fail")).toBe("literal Free regions in optimized {} MIR");
  const ts = new TsFile("// rustc: x.rs:1 f\nfunction f() {\n  this.fail(l, `Free regions in optimized ${MirPhase.name(p)} MIR`);\n  bug(\"a \\`b\\` c\");\n}\n");
  expect(ts.call_key(3, 8, "fail")).toBe("literal Free regions in optimized {} MIR");
  expect(ts.call_key(4, 3, "bug")).toBe("literal a `b` c");
});

test("a method of a trait impl whose header spans lines inherits #[track_caller] from the trait", () => {
  // `impl<..> Diagnostic<'a>\\n    for X\\n{ fn into_diag(..) }`
  const path = "compiler/rustc_lint/src/nonstandard_style.rs";
  const line = up_file(path)!.lines.findIndex((l) => l.includes("fn into_diag(self, dcx: DiagCtxtHandle<'a>, level: Level) -> Diag<'a> {")) + 1;
  expect(line).toBeGreaterThan(0);
  expect(is_track_caller_owner({ kind: "fn", path, line, name: "into_diag", start: 0, end: 0 })).toBe(true);
});

test("a const's initializer is its body, and a macro_rules! fn or a marker on no const has none", () => {
  const path = "compiler/rustc_attr_parsing/src/attributes/macro_attrs.rs";
  const up = up_file(path)!;
  const line = up.lines.findIndex((l) => l.includes("const ATTRIBUTES: AcceptMapping<Self> = &[(")) + 1;
  const owner: Owner = { kind: "fn", path, line, name: "ATTRIBUTES", start: 0, end: 0 };
  const body = up.owner_body(owner)!;
  // It ends at the initializer's `;`, past every closure in it, and before the next item.
  expect(up.masked[body[1]]).toBe(";");
  expect(up.masked.slice(body[0], body[1])).toContain("expect_no_args");
  expect(up.masked.slice(body[0], body[1])).not.toContain("\nimpl");
  expect(up.owner_body({ ...owner, name: "NOT_THERE" })).toBeUndefined();
});

// The ICE path end to end. `rustc +nightly -Ztreat-err-as-bug -Zparse-crate-root-only p.rs`, exit 101 (pinned nightly
// 6f5da406b56c), with the OS thread id masked as compiletest does. A string payload with no tcx.
const ICE_ORACLE = `error: internal compiler error: expected expression, found \`;\`
 --> p.rs:2:13
  |
2 |     let x = ;
  |             ^ expected expression


thread 'rustc' (<tid>) panicked at /rustc-dev/6f5da406b56c2db6607202b63daee73aa8c61297/compiler/rustc_errors/src/lib.rs:1504:17:
aborting due to \`-Z treat-err-as-bug=1\`
note: run with \`RUST_BACKTRACE=1\` environment variable to display a backtrace

error: the compiler unexpectedly panicked. This is a bug

note: we would appreciate a bug report: https://github.com/rust-lang/rust/issues/new?labels=C-bug%2C+I-ICE%2C+T-compiler&template=ice.md

note: please make sure that you have updated to the latest nightly

note: rustc 1.101.0-nightly (6f5da406b 2026-10-10) running on aarch64-apple-darwin

note: compiler flags: -Z treat-err-as-bug -Z parse-crate-root-only

query stack during panic:
end of query stack
`;

test("an ICE prints what the oracle prints, with no second process and tail calls on", () => {
  const dir = mkdtempSync(join(tmpdir(), "rust-ts-track-caller-"));
  try {
    writeFileSync(join(dir, "p.rs"), SRC);
    const r = Bun.spawnSync([process.execPath, MAIN, "-Ztreat-err-as-bug", "-Zparse-crate-root-only", "p.rs"], {
      cwd: dir,
      env: { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0", BUN_JSC_useTailCalls: "1" },
    });
    expect(r.stderr.toString().replace(/^(thread 'rustc' \()\d+(\) panicked)/m, "$1<tid>$2")).toBe(ICE_ORACLE);
    expect(r.exitCode).toBe(101);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The one-line inputs where the lexer printed a wrong location (docs/reviews/plan-ice-report.md F3), which neither the
// message check nor the oracle-binary check can see. Expected values: `rustc +nightly -Ztrack-diagnostics`.
for (const [src, at] of [
  ["fn main() { \\ }", "lexer/mod.rs:495:32"],
  ["fn main() { let _ = 'r#_; }", "lexer/mod.rs:399:40"],
  ['fn main() { let _x = "a"_; }', "lexer/mod.rs:341:40"],
] as const) {
  test(`the lexer's sites are in upstream's order: ${src}`, () => {
    const dir = mkdtempSync(join(tmpdir(), "rust-ts-track-caller-"));
    try {
      writeFileSync(join(dir, "p.rs"), `${src}\n`);
      const r = Bun.spawnSync([process.execPath, MAIN, "-Ztrack-diagnostics", "-Zparse-crate-root-only", "--edition=2021", "p.rs"], {
        cwd: dir,
        env: { ...process.env, RUSTC_ICE: "0", BUN_JSC_useTailCalls: "0" },
      });
      expect(/created at (\S+)/.exec(r.stderr.toString())?.[1]).toEndWith(`/compiler/rustc_parse/src/${at}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

/** Runs a script that imports std/panic.ts and std/panicking.ts as `P` and `H` in a fresh process. */
function hook_script(body: string): { code: number; stderr: string; stdout: string } {
  const dir = mkdtempSync(join(tmpdir(), "rust-ts-hook-"));
  try {
    const file = join(dir, "s.ts");
    const std = join(import.meta.dir, "..", "std");
    writeFileSync(file, `import * as P from ${JSON.stringify(join(std, "panic.ts"))};\nimport * as H from ${JSON.stringify(join(std, "panicking.ts"))};\n${body}\n`);
    const r = Bun.spawnSync([process.execPath, file], { cwd: dir, env: { ...process.env, RUST_BACKTRACE: "0" } });
    return { code: r.exitCode, stderr: r.stderr.toString(), stdout: r.stdout.toString() };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the hook runs at the panic with panicking() true, once, and resume_unwind runs none", () => {
  const r = hook_script(`
H.update_hook((_default_hook, info) => console.log("hook", info.payload.message, P.panicking()));
console.log("before", P.panicking());
try { throw new P.Panic("a"); } catch (e) { console.log("caught", P.panicking(), e.reported); }
const resumed = new P.Panic("b", false);
console.log("resumed", resumed.reported);
`);
  expect(r.stdout).toBe("before false\nhook a true\ncaught false true\nresumed true\n");
  expect(r.code).toBe(0);
});

test("a panic inside the hook aborts, as upstream does, and prints no guessed location", () => {
  const r = hook_script(`H.update_hook(() => { throw new P.Panic("inner"); }); throw new P.Panic("outer");`);
  expect(r.stderr).toStartWith("panicked at <location refused: ");
  expect(r.stderr).toContain(":\ninner\nthread panicked while processing panic. aborting.\n");
  expect(r.code).not.toBe(0);
  expect(r.code).not.toBe(101);
});

test("a refused location stays a panic: the reason is visible and no location is printed", () => {
  const r = hook_script(`
H.update_hook((default_hook, info) => default_hook(info));
try { throw new P.Panic("from an unmarked frame"); } catch (e) { console.log("reported", e.reported); }
`);
  expect(r.stderr).toContain("rust-ts: internal compiler error: from an unmarked frame\n");
  expect(r.stderr).toContain("rust-ts: the ICE report stopped: location refused: ");
  expect(r.stderr).not.toContain("panicked at");
  expect(r.stdout).toBe("reported true\n");
});

test("an Unported while the hook prints does not turn the panic into exit 70", () => {
  const r = hook_script(`
H.update_hook(() => P.unported("something the report needs"));
try { throw new P.Panic("p"); } catch (e) { console.log(e instanceof P.Panic, e.reported); }
`);
  expect(r.stderr).toContain("rust-ts: the ICE report stopped: Unported: unported: something the report needs\n");
  expect(r.stdout).toBe("true true\n");
});
