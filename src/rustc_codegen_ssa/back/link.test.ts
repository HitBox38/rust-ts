// `each_linked_rlib` and `ignored_for_lto` (back/link.rs:495, :1839): `CrateInfo::new` under `-C lto`. Under the Miri
// suites only the success path runs; the error paths are checked here against upstream's match arms.
import { expect, test } from "bun:test";
import { CodegenBackend_provided } from "../../rustc_interface/stand_ins.ts";
import type { CrateNum } from "../../rustc_span/def_id.ts";
import type { Symbol } from "../../rustc_span/symbol.ts";
import { Ok } from "../../std/result.ts";
import type { Linkage } from "../../rustc_middle/middle/dependency_format.ts";
import type { CrateType } from "../../rustc_structures/crate_type.ts";
import type { Session } from "../../rustc_session/session.ts";
import type { CrateInfo } from "../lib.ts";
import { each_linked_rlib, ignored_for_lto } from "./link.ts";

const CRATE_A = 1 as CrateNum;
const CRATE_B = 2 as CrateNum;
const NAME = 7 as Symbol;

function info(formats: [CrateType, Linkage[]][], sources: Map<CrateNum, { rlib?: string; rmeta?: string }>, used: CrateNum[] = [CRATE_A, CRATE_B]): CrateInfo {
  return {
    dependency_formats: new Map(formats),
    used_crates: used,
    crate_name: new Map(used.map((c) => [c, NAME])),
    used_crate_source: sources,
    compiler_builtins: CRATE_B,
    is_no_builtins: new Set(),
  } as unknown as CrateInfo;
}
const RLIBS = new Map([
  [CRATE_A, { rlib: "a.rlib" }],
  [CRATE_B, { rlib: "b.rlib" }],
]);

test("each_linked_rlib visits the statically linked crates in used_crates order", () => {
  const seen: [CrateNum, string][] = [];
  const r = each_linked_rlib(info([["Executable", ["NotLinked", "Static", "Static"]]], RLIBS), undefined, (c, p) => seen.push([c, p]));
  expect(r).toEqual(Ok(null));
  expect(seen).toEqual([
    [CRATE_A, "a.rlib"],
    [CRATE_B, "b.rlib"],
  ]);
});

test("each_linked_rlib skips NotLinked, Dynamic and IncludedFromDylib", () => {
  for (const linkage of ["NotLinked", "Dynamic", "IncludedFromDylib"] as const) {
    const seen: CrateNum[] = [];
    each_linked_rlib(info([["Executable", ["NotLinked", linkage, "Static"]]], RLIBS), undefined, (c) => seen.push(c));
    expect(seen).toEqual([CRATE_B]);
  }
});

test("each_linked_rlib errors", () => {
  const nop = () => {};
  expect(each_linked_rlib(info([], RLIBS), undefined, nop)).toEqual({ $: "Err", _0: { $: "MissingFormat" } });
  expect(each_linked_rlib(info([["Executable", []]], RLIBS), "Dylib", nop)).toEqual({ $: "Err", _0: { $: "MissingFormat" } });
  // `fmts.get(cnum)` past the end of the list.
  expect(each_linked_rlib(info([["Executable", ["NotLinked"]]], RLIBS), undefined, nop)).toEqual({ $: "Err", _0: { $: "MissingFormat" } });
  const list = ["NotLinked", "Static", "Static"] as Linkage[];
  expect(each_linked_rlib(info([["Executable", list]], new Map([[CRATE_A, { rmeta: "a.rmeta" }]]), [CRATE_A]), undefined, nop)).toEqual({
    $: "Err",
    _0: { $: "OnlyRmetaFound", crate_name: NAME },
  });
  expect(each_linked_rlib(info([["Executable", list]], new Map([[CRATE_A, {}]]), [CRATE_A]), undefined, nop)).toEqual({
    $: "Err",
    _0: { $: "NotFound", crate_name: NAME },
  });
  expect(each_linked_rlib(info([["Executable", ["Static"]], ["Rlib", ["Dynamic"]]], RLIBS), undefined, nop)).toEqual({
    $: "Err",
    _0: { $: "IncompatibleDependencyFormats", ty1: "Executable", ty2: "Rlib", list1: "[Static]", list2: "[Dynamic]" },
  });
  // A crate type picks its own list, so the other one is not compared.
  expect(each_linked_rlib(info([["Executable", list], ["Rlib", ["Dynamic"]]], RLIBS), "Executable", nop)).toEqual(Ok(null));
});

test("ignored_for_lto", () => {
  const i = { compiler_builtins: CRATE_B, is_no_builtins: new Set([CRATE_A]) } as unknown as CrateInfo;
  const sess = (no_builtins: boolean) => ({ target: { options: { no_builtins } } }) as unknown as Session;
  expect(ignored_for_lto(sess(false), i, CRATE_A)).toBe(true);
  expect(ignored_for_lto(sess(false), i, CRATE_B)).toBe(true);
  expect(ignored_for_lto(sess(false), i, 3 as CrateNum)).toBe(false);
  expect(ignored_for_lto(sess(true), i, CRATE_A)).toBe(false);
});

test("the provided `init` is `CodegenBackendInit::default()` (`thin_lto_supported: bool = true`)", () => {
  const init = CodegenBackend_provided.init(undefined as never, undefined as never);
  expect(init.thin_lto_supported).toBe(true);
});
