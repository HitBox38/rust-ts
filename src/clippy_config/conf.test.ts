// conf.rs (hand part), metadata.rs and the `display_default` side of de.rs/types.rs, against upstream's own expectations:
// - tests/config-metadata.rs `book` and `changelog`: book/src/lint_configuration.md and CHANGELOG.md's link block are
//   `Conf::get_metadata()` rendered by `ConfMetadata::display_markdown_paragraph` / `display_markdown_link`, committed
//   and checked by upstream, so every `default` there is a `FromDefault::display_default` output;
// - the oracle's `cargo-clippy --explain <lint>` (oracle/de.oracle.json, from oracle/capture.ts):
//   `sanitize_explanation` of the lint's generated `explanation`, then the `ConfMetadata` `Display` of its configs.
// `Conf::get_metadata` itself is define_Conf! (codegen-clippy-conf, not yet written), so `metadata()` below builds the
// same list from tools/codegen/clippy.ts's `parseConf`, calling for each field the de.rs/types.rs impl the macro's
// `<$ty as FromDefault<_>>::display_default(first_expr!($($default,)? ()))` resolves to: that dispatch is the one
// codegen-clippy-conf has to emit (docs/handoff/clippy-contract-b1.md).
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";
import { CONF_PATH, CLIPPY, parseConf, type ConfEntry } from "../../tools/codegen/clippy.ts";
import { requireUpstream } from "../../scripts/lib/common.ts";
import { ConfField } from "./conf.gen.ts";
import * as conf from "./conf.ts";
import {
  type FromDefault,
  FromDefault_for_bool,
  FromDefault_for_u32,
  FromDefault_for_u64,
  FromDefault_slice_for_HashSet,
  FromDefault_slice_for_Vec,
  FromDefault_str_for_String,
  FromDefault_unit_for_HashSet,
  FromDefault_unit_for_Option,
  FromDefault_unit_for_Vec,
} from "./de.ts";
import { ConfMetadata, display_ConfMetadata } from "./metadata.ts";
import * as types from "./types.ts";
import oracle from "./oracle/de.oracle.json";

const UP = requireUpstream();
const CLIPPY_DIR = join(UP, CLIPPY);
const entries = parseConf(readFileSync(join(UP, CONF_PATH), "utf8"));

/** `16 * 1024`, `1_000_000`: the integer `$default`s of define_Conf!. */
function intExpr(s: string): bigint {
  return s
    .split("*")
    .map((x) => BigInt(x.trim().replaceAll("_", "")))
    .reduce((a, b) => a * b);
}

/** `<$ty as FromDefault<_>>::display_default(first_expr!($($default,)? ()))` for one define_Conf! entry. */
function display_default(e: ConfEntry): string {
  const ty = e.ty!;
  const def = e.default?.replace(/\s*:\s*:\s*/g, "::");
  const defaults = conf as unknown as Record<string, readonly string[]>;
  const tys = types as unknown as Record<string, FromDefault<unknown, unknown>>;
  if (ty === "bool") return FromDefault_for_bool.display_default(def === "true");
  if (ty === "u32") return FromDefault_for_u32.display_default(Number(intExpr(def!)));
  if (ty === "u64") return FromDefault_for_u64.display_default(intExpr(def!));
  if (ty.startsWith("Option<") && def === undefined) return FromDefault_unit_for_Option.display_default(null);
  if (ty.startsWith("Vec<") && def === undefined) return FromDefault_unit_for_Vec.display_default(null);
  if (ty.startsWith("FxHashSet<") && def === undefined) return FromDefault_unit_for_HashSet.display_default(null);
  if (ty === "Vec<String>" && def!.startsWith("DEFAULT_")) return FromDefault_slice_for_Vec(FromDefault_str_for_String).display_default(defaults[def!]!);
  if (ty === "FxHashSet<String>" && def!.startsWith("DEFAULT_")) {
    return FromDefault_slice_for_HashSet(FromDefault_str_for_String).display_default(defaults[def!]!);
  }
  // a conf_enum! type with a `Type::Variant` default: `FromDefault<Type> for Type`
  if (def !== undefined && def.startsWith(`${ty}::`)) return tys[`FromDefault_for_${ty}`]!.display_default(def.slice(ty.length + 2));
  // a types.rs type with `impl FromDefault<()>`
  if (def === undefined && tys[`FromDefault_unit_for_${ty}`] !== undefined) return tys[`FromDefault_unit_for_${ty}`]!.display_default(null);
  throw new Error(`no FromDefault dispatch for ${e.name}: ${ty} = ${def}`);
}

/** `Conf::get_metadata()` as define_Conf! builds it. */
function metadata(): ConfMetadata[] {
  return entries.map(
    (e) =>
      new ConfMetadata(
        e.name_str,
        // first_expr!($($default_text.into(),)? $(<$ty as FromDefault<_>>::display_default(..).to_string(),)? String::new())
        e.default_text ?? (e.ty !== undefined ? display_default(e) : ""),
        e.lints ?? [],
        e.docs.map((d) => d + "\n").join(""),
        e.rename !== undefined ? ConfField.name(e.rename as ConfField) : undefined,
      ),
  );
}

test("book/src/lint_configuration.md (tests/config-metadata.rs `book`)", () => {
  const current = readFileSync(join(CLIPPY_DIR, "book/src/lint_configuration.md"), "utf8");
  const configs = metadata()
    .filter((c) => c.renamed_to === undefined)
    .filter((c) => c.lints.length !== 0)
    .map((c) => c.display_markdown_paragraph())
    .join("\n");
  const expected = `<!--
This file is generated by \`cargo bless --test config-metadata\`.
Please use that command to update the file and do not edit it by hand.
-->

# Lint Configuration Options

The following list shows each configuration option, along with a description, its default value, an example
and lints affected.

---

${configs.trim()}
`;
  expect(expected).toBe(current);
});

test("CHANGELOG.md configuration links (tests/config-metadata.rs `changelog`)", () => {
  const current = readFileSync(join(CLIPPY_DIR, "CHANGELOG.md"), "utf8");
  const m = /<!-- begin autogenerated links to configuration documentation -->\n([^]*)\n<!-- end autogenerated links to configuration documentation -->/.exec(current);
  expect(m).not.toBeNull();
  const configs = metadata()
    .filter((c) => c.renamed_to === undefined)
    .filter((c) => c.lints.length !== 0)
    .map((c) => c.display_markdown_link())
    .join("\n");
  expect(configs).toBe(m![1]!);
});

/** `<NAME>_INFO.explanation` from the generated `.lints.gen.ts` that declares the lint. */
async function explanation(lint: string): Promise<string> {
  const want = `export const ${lint.toUpperCase()}_INFO = `;
  for await (const f of new Glob("src/clippy_lints/**/*.lints.gen.ts").scan({ cwd: join(import.meta.dir, "../..") })) {
    const path = join(import.meta.dir, "../..", f);
    if (!readFileSync(path, "utf8").includes(want)) continue;
    const mod = (await import(path)) as Record<string, { explanation: string }>;
    return mod[`${lint.toUpperCase()}_INFO`]!.explanation;
  }
  throw new Error(`no ${lint.toUpperCase()}_INFO`);
}

test("cargo-clippy --explain: sanitize_explanation and ConfMetadata's Display (clippy_lints/src/lib.rs `explain`)", async () => {
  expect(oracle.explain.length).toBe(26);
  const md = metadata();
  for (const { lint, stdout } of oracle.explain) {
    // println!("{}", sanitize_explanation(info.explanation));
    let out = conf.sanitize_explanation(await explanation(lint)) + "\n";
    const mdconf = md.filter((c) => c.lints.includes(lint));
    if (mdconf.length !== 0) {
      out += `### Configuration for clippy::${lint}:\n\n`;
      for (const c of mdconf) out += display_ConfMetadata(c) + "\n";
    }
    expect(out).toBe(stdout);
  }
});

test("sanitize_explanation: code fences, hidden lines, one leading space", () => {
  const raw = [" ### What it does", " ```", " # hidden", " shown", " ```", " ```toml", " # dropped in any fence", " ```", " ```rust,ignore", "x", " ```", "  # two spaces"].join("\n");
  expect(conf.sanitize_explanation(raw)).toBe(
    ["### What it does", "```rust", "shown", "```", "```toml", "```", "```rust", "x", "```", " # two spaces", ""].join("\n"),
  );
  // `lines()`: a trailing `\r` is dropped only before `\n`; no final empty line
  expect(conf.sanitize_explanation("a\r\nb\r")).toBe("a\nb\r\n");
  expect(conf.sanitize_explanation("")).toBe("");
});

test("display_ConfMetadata omits an empty default", () => {
  expect(display_ConfMetadata(new ConfMetadata("x", "", [], " doc\n", undefined))).toBe("- `x`:  doc\n");
  expect(display_ConfMetadata(new ConfMetadata("x", "3", [], " doc\n", undefined))).toBe("- `x`:  doc\n\n\n   (default: `3`)");
});

test("the hand-copied DEFAULT_* tables match conf.rs", () => {
  const src = readFileSync(join(UP, CONF_PATH), "utf8");
  for (const name of [
    "DEFAULT_DOC_VALID_IDENTS",
    "DEFAULT_DISALLOWED_NAMES",
    "DEFAULT_ALLOWED_IDENTS_BELOW_MIN_CHARS",
    "DEFAULT_ALLOWED_PREFIXES",
    "DEFAULT_ALLOWED_TRAITS_WITH_RENAMED_PARAMS",
    "DEFAULT_ALLOWED_SCRIPTS",
    "DEFAULT_IGNORE_INTERIOR_MUTABILITY",
  ]) {
    const m = new RegExp(`static ${name}: &\\[&str\\] =\\s*&\\[([^\\]]*)\\];`).exec(src);
    expect(m).not.toBeNull();
    const want = [...m![1]!.matchAll(/"([^"]*)"/g)].map((x) => x[1]);
    expect([...(conf as unknown as Record<string, readonly string[]>)[name]!]).toEqual(want);
  }
});

test("Conf's macro fns stop until codegen-clippy-conf", () => {
  expect(conf.Conf.default.toString()).toContain("codegen-clippy-conf");
  expect(conf.Conf.get_metadata.toString()).toContain("codegen-clippy-conf");
  expect(conf.Conf.deserialize.toString()).toContain("codegen-clippy-conf");
});
