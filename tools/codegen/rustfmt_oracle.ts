// The oracle for tools/codegen's rustfmt/serde generators (plan-m8 D6): the pinned rustc's `-Zunpretty=expanded` of rustfmt's
// library and of clippy_config, run offline on the `tools-deps` workspace (`bun scripts/tools-src.ts setup tools-deps`) with the
// oracle's own cargo (check profile: dependencies are only checked, nothing of clippy, rustfmt or cargo is built).
//
// From rustfmt's expansion it extracts every serde_derive impl (`const _: () = { extern crate serde as _serde; .. impl .. };`) and
// every `#[config_type]` expansion (`mod __define_config_type_on_enum_X { .. }`) into tools/codegen/fixtures/rustfmt.expanded.rs,
// in the oracle's own layout. tools/codegen/rustfmt.test.ts compares the generators' Rust renderings with those blocks token for
// token (tools/codegen/rust_tokens.ts), so what tools/codegen emits is checked, type by type, against what serde_derive and
// config_proc_macro emit. For clippy_config it records the number of serde impls in the fixture's header (0 at the pin: clippy_config
// has its own `Deserialize` trait in de.rs, ported by hand).
//
//   bun tools/codegen/rustfmt_oracle.ts write    run both expansions and rewrite the fixture
//   bun tools/codegen/rustfmt_oracle.ts check    run both expansions; ERROR if the fixture differs (the checked script)
//
// Scratch (the cargo target dir and the two expansions, about 100 MiB) goes to $RUST_TS_DATA/tmp/codegen-fmt-serde/ and is removed
// afterwards (the whole directory) unless `--keep` is given.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { closeOf, joinToks, lexRust, type RTok } from "./rust_tokens.ts";

export const FIXTURE = join(import.meta.dir, "fixtures", "rustfmt.expanded.rs");

export interface OracleBlock {
  /** `Deserialize WidthHeuristics`, `Serialize MacroSelector`, `config_type NewlineStyle` */
  key: string;
  /** the block's text as the oracle printed it */
  text: string;
}

/** The serde_derive impls of an expansion, in expansion order. */
export function extractSerde(expanded: string): OracleBlock[] {
  const lines = expanded.split("\n");
  const toks = lexRust(expanded);
  const out: OracleBlock[] = [];
  for (let i = 0; i + 2 < toks.length; i++) {
    if (!(toks[i]!.text === "const" && toks[i + 1]!.text === "_" && toks[i + 2]!.text === ":")) continue;
    let j = i;
    while (toks[j]!.text !== "{" && toks[j]!.text !== ";") j++;
    if (toks[j]!.text !== "{") continue;
    const e = closeOf(toks, j);
    const body = toks.slice(j, e + 1);
    const t = joinToks(body);
    if (!t.includes("extern crate serde as _serde")) {
      i = e;
      continue;
    }
    const m = /impl (?:< 'de > )?_serde : : (Serialize|Deserialize) (?:< 'de > )?for (\w+)/.exec(t);
    if (!m) throw new Error(`ERROR: serde block at line ${toks[i]!.line} has no recognisable impl`);
    // the block with its two outer attributes (`#[doc(hidden)]`, `#[allow(..)]`) and the closing `;`
    const start = attrStart(toks, i);
    const end = toks[e + 1]?.text === ";" ? e + 1 : e;
    out.push({ key: `${m[1]} ${m[2]}`, text: lines.slice(toks[start]!.line - 1, toks[end]!.line).join("\n") });
    i = e;
  }
  return out;
}

/** The `#[config_type]` expansions (`#[allow(non_snake_case)] mod __define_config_type_on_enum_X { .. } pub use ..::X;`). */
export function extractConfigType(expanded: string): OracleBlock[] {
  const lines = expanded.split("\n");
  const toks = lexRust(expanded);
  const out: OracleBlock[] = [];
  for (let i = 0; i + 2 < toks.length; i++) {
    if (!(toks[i]!.text === "mod" && toks[i + 1]!.text.startsWith("__define_config_type_on_enum_"))) continue;
    const name = toks[i + 1]!.text.slice("__define_config_type_on_enum_".length);
    const e = closeOf(toks, i + 2);
    // `pub use __define_config_type_on_enum_X::X;` follows the module
    let k = e + 1;
    while (k < toks.length && toks[k]!.text !== ";") k++;
    const start = attrStart(toks, i);
    out.push({ key: `config_type ${name}`, text: lines.slice(toks[start]!.line - 1, toks[k]!.line).join("\n") });
    i = k;
  }
  return out;
}

/**
 * The parts of `create_config!`'s expansion that depend on what tools/codegen/create_config.ts parses: each
 * `config_option_with_style_edition_default!` entry (`pub struct X; impl StyleEditionDefault for X { .. }`, with its
 * `#[allow(unreachable_pub)]`) and `Config::print_docs` (every option's name, type, stability and descriptions).
 */
export function extractCreateConfig(expanded: string): OracleBlock[] {
  const lines = expanded.split("\n");
  const toks = lexRust(expanded);
  const out: OracleBlock[] = [];
  const SED = "impl crate : : config : : style_edition : : StyleEditionDefault for";
  const fns = new Set<string>();
  for (let i = 0; i + 12 < toks.length; i++) {
    // the expansion prints `macro_rules!` definitions too; their bodies are templates, not expansions
    if (toks[i]!.text === "macro_rules" && toks[i + 1]!.text === "!") {
      i = closeOf(toks, i + 3);
      continue;
    }
    if (toks[i]!.text === "impl" && joinToks(toks.slice(i, i + 12)) === SED) {
      const name = toks[i + 12]!.text;
      // `pub struct X;` (and its attribute) directly before
      let s = i;
      if (joinToks(toks.slice(i - 4, i)) === `pub struct ${name} ;`) s = attrStart(toks, i - 4);
      else throw new Error(`ERROR: StyleEditionDefault impl for ${name} at line ${toks[i]!.line} has no \`pub struct ${name};\` before it`);
      const e = closeOf(toks, i + 13);
      out.push({ key: `style_edition_default ${name}`, text: lines.slice(toks[s]!.line - 1, toks[e]!.line).join("\n") });
      i = e;
    } else if (toks[i]!.text === "fn" && (toks[i + 1]!.text === "print_docs" || toks[i + 1]!.text === "override_value") && toks[i - 1]!.text === "pub" && !fns.has(toks[i + 1]!.text)) {
      let j = i;
      while (toks[j]!.text !== "{") j++;
      const e = closeOf(toks, j);
      out.push({ key: `create_config ${toks[i + 1]!.text}`, text: lines.slice(toks[i - 1]!.line - 1, toks[e]!.line).join("\n") });
      fns.add(toks[i + 1]!.text);
      i = e;
    }
  }
  return out;
}

/** The index of the first outer attribute (`# [ .. ]`) directly before token `i` (or `i`). */
function attrStart(toks: RTok[], i: number): number {
  let s = i;
  for (;;) {
    if (s < 1 || toks[s - 1]!.text !== "]") return s;
    // walk back to the matching `[`, then expect `#`
    let depth = 0;
    let k = s - 1;
    for (; k >= 0; k--) {
      const t = toks[k]!.text;
      if (t === "]") depth++;
      else if (t === "[" && --depth === 0) break;
    }
    if (k < 1 || toks[k - 1]!.text !== "#") return s;
    s = k - 1;
  }
}

/**
 * The derived impls inside a config_type block (`#[automatically_derived] impl ..` of `#[derive(Debug, Copy, Clone, Eq,
 * PartialEq)]`, with the `#[doc(hidden)]` before `unsafe impl TrivialClone`), removed: config_proc_macro emits the
 * `#[derive(..)]` attribute, rustc's built-in derives expand it, and types.ts generates those derives like any other.
 */
export function stripDerived(text: string): string {
  const toks = lexRust(text);
  const keep: RTok[] = [];
  for (let i = 0; i < toks.length; i++) {
    const at = joinToks(toks.slice(i, i + 4));
    if (at === "# [ automatically_derived ]") {
      let j = i + 4;
      if (joinToks(toks.slice(j, j + 5)) === "# [ doc ( hidden ) ]") j += 7;
      while (toks[j]!.text !== "{") j++;
      i = closeOf(toks, j);
      continue;
    }
    keep.push(toks[i]!);
  }
  return joinToks(keep);
}

// ---- running the oracle -------------------------------------------------------------------------

/** `cargo rustc -p <pkg> --lib --profile check -- -Zunpretty=expanded` in tools-deps, offline; the expansion's text. */
async function expand(pkg: string, scratch: string): Promise<string> {
  const { DATA } = await import("../../scripts/lib/common.ts");
  const { oracleSysroot } = await import("../../scripts/lib/oracle.ts");
  const root = join(DATA, "tools-deps");
  if (!existsSync(join(root, "setup-done"))) throw new Error("ERROR: tools-deps is not set up (bun scripts/tools-src.ts setup tools-deps)");
  const sys = oracleSysroot();
  const env = {
    ...process.env,
    RUSTUP_AUTO_INSTALL: "0",
    CARGO_HOME: join(root, "cargo-home"),
    RUSTC: join(sys, "bin", "rustc"),
    CARGO_TARGET_DIR: join(scratch, "target"),
  };
  const args = ["rustc", "--offline", "--locked", "-p", pkg, "--lib", "--profile", "check", "--", "-Zunpretty=expanded"];
  const r = Bun.spawnSync([join(sys, "bin", "cargo"), ...args], { cwd: root, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`ERROR: cargo ${args.join(" ")} failed: ${r.stderr.toString().trim().split("\n").at(-1)}`);
  return r.stdout.toString();
}

/** The fixture text for the two expansions. */
export function fixtureText(rustfmt: string, clippyConfig: string, pin: string): string {
  const serde = extractSerde(rustfmt);
  const ct = extractConfigType(rustfmt);
  const cc = extractCreateConfig(rustfmt);
  const clippySerde = extractSerde(clippyConfig);
  const head = [
    `// GENERATED by tools/codegen/rustfmt_oracle.ts at ${pin}: the oracle's \`-Zunpretty=expanded\` (pinned nightly, tools-deps`,
    "// workspace, check profile), the blocks tools/codegen's rustfmt/serde generators are checked against. Do not edit; rerun",
    "// `bun tools/codegen/rustfmt_oracle.ts write`.",
    `// rustfmt-nightly lib: ${serde.length} serde_derive impls, ${ct.length} #[config_type] expansions, ${cc.length - 2} StyleEditionDefault impls + override_value and print_docs (create_config!).`,
    `// clippy_config lib: ${clippySerde.length} serde_derive impls.`,
    "",
  ];
  const body: string[] = [];
  for (const b of [...serde, ...ct, ...cc]) body.push(`// ==== ${b.key}`, b.text, "");
  return [...head, ...body].join("\n");
}

/** The blocks of the committed fixture, by key. */
export function readFixture(path = FIXTURE): { blocks: OracleBlock[]; clippySerde: number } {
  const text = readFileSync(path, "utf8");
  const m = /^\/\/ clippy_config lib: (\d+) serde_derive impls\.$/m.exec(text);
  if (!m) throw new Error(`ERROR: ${path} has no clippy_config line`);
  const blocks: OracleBlock[] = [];
  const parts = text.split(/^\/\/ ==== (.+)$/m);
  for (let i = 1; i < parts.length; i += 2) blocks.push({ key: parts[i]!, text: parts[i + 1]!.replace(/^\n/, "").replace(/\n\n$/, "\n").replace(/\n$/, "") });
  return { blocks, clippySerde: Number(m[1]) };
}

if (import.meta.main) {
  const mode = process.argv[2];
  const keep = process.argv.includes("--keep");
  if (mode !== "write" && mode !== "check") {
    console.log("usage: bun tools/codegen/rustfmt_oracle.ts write|check [--keep]");
    process.exit(2);
  }
  const { DATA, PIN } = await import("../../scripts/lib/common.ts");
  const scratch = join(DATA, "tmp", "codegen-fmt-serde");
  mkdirSync(scratch, { recursive: true });
  try {
    const rustfmt = await expand("rustfmt-nightly", scratch);
    const clippy = await expand("clippy_config", scratch);
    if (keep) {
      writeFileSync(join(scratch, "rustfmt.expanded.rs"), rustfmt);
      writeFileSync(join(scratch, "clippy_config.expanded.rs"), clippy);
    }
    const text = fixtureText(rustfmt, clippy, PIN.commit.slice(0, 12));
    if (mode === "write") {
      writeFileSync(FIXTURE, text);
      console.log(text.split("\n").slice(3, 5).join("\n"));
      console.log(`wrote ${FIXTURE}`);
    } else if (readFileSync(FIXTURE, "utf8") !== text) {
      console.log(`ERROR: ${FIXTURE} differs from the oracle's expansion (rerun with write and review the diff)`);
      process.exit(1);
    } else console.log(`ok: ${FIXTURE} matches the oracle's expansion`);
  } catch (e) {
    console.log(String((e as Error).message).startsWith("ERROR:") ? (e as Error).message : `ERROR: ${(e as Error).message}`);
    process.exit(1);
  } finally {
    // the scratch dir holds only the target dir (and, with --keep, the two expansions): nothing is left behind otherwise
    if (!keep) rmSync(scratch, { recursive: true, force: true });
  }
}
