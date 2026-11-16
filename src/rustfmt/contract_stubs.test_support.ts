// Not ported code: a test helper of lane rustfmt-contract-2 (only test files import it).
// utils.ts imports modules that later lanes create (comment.rs's lane; unicode-width 0.1 and bytecount of vendor-fmt-small,
// plan-m8 D7), so a test cannot load it before they land. `install_contract_stubs()` registers, for each of those modules
// that does not exist yet, a stand-in whose functions stop with `unported("<lane>: ...")`; tests then load utils.ts with a
// dynamic `import()`. Once a module exists its stub is not installed, so this helper retires itself as the lanes land (then
// delete it). The specifiers are spelled exactly as utils.ts spells them (it sits in this directory too).
import { mock } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { unported } from "../std/panic.ts";

export const COMMENT = "../rustfmt/comment.ts";
export const UNICODE_WIDTH_0_1 = "../vendor/unicode_width_0_1/lib.ts";
export const BYTECOUNT = "../vendor/bytecount/lib.ts";

function stop(what: string): () => never {
  return () => unported(what);
}

const STUBS: Record<string, () => Record<string, unknown>> = {
  [COMMENT]: () => ({
    FullCodeCharKind: {
      is_string: stop("comment lane: FullCodeCharKind::is_string"),
      is_commented_string: stop("comment lane: FullCodeCharKind::is_commented_string"),
    },
    LineClasses: { new: stop("comment lane: LineClasses::new") },
    CharClasses: { new: stop("comment lane: CharClasses::new") },
    filter_normal_code: stop("comment lane: filter_normal_code"),
    FindUncommented_str: { find_uncommented: stop("comment lane: <str as FindUncommented>::find_uncommented") },
  }),
  [UNICODE_WIDTH_0_1]: () => ({
    UnicodeWidthStr: { width: stop("vendor-fmt-small: unicode-width 0.1 <str as UnicodeWidthStr>::width") },
  }),
  [BYTECOUNT]: () => ({ count: stop("vendor-fmt-small: bytecount::count") }),
};

/** Installs the stand-ins of the modules that do not exist; returns the specifiers it stubbed. */
export function install_contract_stubs(): string[] {
  const stubbed: string[] = [];
  for (const [spec, exports] of Object.entries(STUBS)) {
    if (existsSync(join(import.meta.dir, spec))) continue;
    mock.module(spec, exports);
    stubbed.push(spec);
  }
  return stubbed;
}
