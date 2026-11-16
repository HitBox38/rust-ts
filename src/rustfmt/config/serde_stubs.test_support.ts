// Not ported code: a test helper of lane rustfmt-contract-1 (only test files import it).
// The generated config modules import serde (vendor-serde-de, wave 42) at runtime, so a test cannot load them before that lane
// lands. `install_serde_stubs()` registers, for each serde module that does not exist yet, a stand-in whose functions stop with
// `unported("vendor-serde-de: ...")`; tests then load the config modules with a dynamic `import()`. Once a module exists its stub
// is not installed, so this helper retires itself as the vendor lane lands (then delete it).
// The specifiers are the canonical ones the generated files use (`../../vendor/...`, two directories below src/: this file
// sits there too, so they name the same files; tools/codegen/rustfmt.ts CANON).
import { mock } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { unported } from "../../std/panic.ts";

/** The serde modules the generated config imports, with the names each must export (also used by contracts.test.ts). */
export const STUBS: Record<string, readonly string[]> = {
  "../../vendor/serde/private/de.ts": ["missing_field"],
  "../../vendor/serde_core/de/ignored_any.ts": ["deserialize_IgnoredAny"],
  "../../vendor/serde_core/de/impls.ts": [
    "deserialize_bool",
    "deserialize_usize",
    "deserialize_u32",
    "deserialize_isize",
    "deserialize_String",
    "deserialize_Option",
    "deserialize_Vec",
    "deserialize_tuple2",
  ],
  "../../vendor/serde_core/de/mod.ts": ["Expected_str"],
  "../../vendor/serde_core/ser/impls.ts": [
    "serialize_bool",
    "serialize_usize",
    "serialize_u32",
    "serialize_isize",
    "serialize_String",
    "serialize_Option",
    "serialize_Vec",
    "serialize_tuple2",
  ],
  "../../vendor/serde_core/ser/mod.ts": [],
};

/** Installs the stand-ins of the serde modules that do not exist; returns the specifiers it stubbed. */
export function install_serde_stubs(): string[] {
  const stubbed: string[] = [];
  for (const [spec, names] of Object.entries(STUBS)) {
    if (existsSync(join(import.meta.dir, spec))) continue;
    const exports: Record<string, unknown> = {};
    for (const n of names) exports[n] = () => unported(`vendor-serde-de: ${spec.replace("../../vendor/", "")} ${n}`);
    mock.module(spec, () => exports);
    stubbed.push(spec);
  }
  return stubbed;
}
