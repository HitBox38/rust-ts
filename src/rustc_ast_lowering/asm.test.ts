// Tests of lane lower-asm-format-contract for compiler/rustc_ast_lowering/src/asm.rs.
//
// Oracle test: asm_oracle/run.ts lowers every `asm!` of asm_oracle/<target>.rs with the ported `lower_inline_asm` on a
// recording LoweringContext and prints the `hir::InlineAsm` as rustc_hir_pretty does; each rendering must occur, in
// order, in the pinned rustc's `-Zunpretty=hir` of the same file (whitespace collapsed, literals canonicalized), and
// the number of `asm!` must agree. This checks register / register-class parsing per arch, the operand list, the
// clobbers added for `clobber_abi` (and their dedup against outputs and earlier ABIs), `sym` static vs fn, the
// template and the options. The error paths (diagnostics.gen.ts pending) are not reached. The oracle runs live (needs
// the pinned toolchain; skipped without it unless RUST_TS_REQUIRE_PROBES=1).
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { PIN } from "../../scripts/lib/common.ts";

const DIR = join(import.meta.dir, "asm_oracle");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const ENV = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };

function sysroot(): string | undefined {
  try {
    const { oracleSysroot } = require("../../scripts/lib/oracle.ts") as typeof import("../../scripts/lib/oracle.ts");
    return oracleSysroot();
  } catch {
    return undefined;
  }
}

function rustc_at_pin(): boolean {
  try {
    const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "-vV"], { stdout: "pipe", stderr: "pipe" });
    return r.exitCode === 0 && r.stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}

function run(cmd: string[]): { exit: number; stdout: string; stderr: string } {
  const r = Bun.spawnSync(cmd, { cwd: DIR, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { exit: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

const hex = (b: readonly number[] | Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, "0")).join(" ");

/** Rust `escape_debug` / `escape_ascii` escapes back to code points (strings) or bytes (byte strings). */
function unescape(body: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < body.length; ) {
    const c = body.codePointAt(i)!;
    i += c > 0xffff ? 2 : 1;
    if (c !== 0x5c) {
      out.push(c);
      continue;
    }
    const e = body[i++]!;
    switch (e) {
      case "n":
        out.push(10);
        break;
      case "t":
        out.push(9);
        break;
      case "r":
        out.push(13);
        break;
      case "0":
        out.push(0);
        break;
      case "\\":
      case '"':
      case "'":
        out.push(e.charCodeAt(0));
        break;
      case "x":
        out.push(parseInt(body.slice(i, i + 2), 16));
        i += 2;
        break;
      case "u": {
        const end = body.indexOf("}", i);
        out.push(parseInt(body.slice(i + 1, end), 16));
        i = end + 1;
        break;
      }
      default:
        throw new Error(`ERROR: unknown escape \\${e}`);
    }
  }
  return out;
}

/** Literals to `B[hex]` / `S[utf-8 hex]` (as format_oracle/run.ts renders them), then whitespace collapsed. */
function canon(s: string): string {
  // One left-to-right scan, so a `b` ending a string (`"acb"`) is never taken for a byte-string prefix.
  return s
    .replace(/(?<![A-Za-z0-9_])(b?)"((?:[^"\\]|\\.)*)"/g, (_, b: string, body: string) =>
      b === "b"
        ? `B[${hex(unescape(body))}]`
        : `S[${hex(new TextEncoder().encode(String.fromCodePoint(...unescape(body))))}]`,
    )
    .replace(/\s+/g, " ");
}

const CONFIGS: { target: string; file: string }[] = [
  { target: "x86_64-unknown-linux-gnu", file: "x86_64.rs" },
  { target: "aarch64-apple-darwin", file: "aarch64.rs" },
];

describe("asm_oracle: lower_inline_asm against rustc -Zunpretty=hir", () => {
  for (const cfg of CONFIGS) {
    test(cfg.target, () => {
      const s = sysroot();
      if (s === undefined || !rustc_at_pin()) {
        if (REQUIRE) throw new Error("ERROR: pinned toolchain missing");
        return;
      }
      const args = ["--target", cfg.target, "--sysroot", s, "--edition=2021", cfg.file];
      const oracle = run(["rustc", `+${PIN.toolchain}`, "-Zunpretty=hir", ...args]);
      expect(oracle.exit).toBe(0);
      const port = run(["bun", join(DIR, "run.ts"), ...args]);
      expect({ exit: port.exit, stderr: port.stderr }).toEqual({ exit: 0, stderr: "" });
      const o = canon(oracle.stdout).replace(/\{ \}/g, "{}");
      const lines = port.stdout.trimEnd().split("\n").map((l) => canon(JSON.parse(l) as string).replace(/\{ \}/g, "{}"));
      let cursor = 0;
      for (const l of lines) {
        const at = o.indexOf(l, cursor);
        expect({ found: at >= 0, l }).toEqual({ found: true, l });
        cursor = at + l.length;
      }
      expect(lines.length).toBe(o.match(/asm!\(/g)?.length ?? 0);
    }, 120_000);
  }
});
