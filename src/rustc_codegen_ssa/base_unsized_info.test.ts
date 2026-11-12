// Unit test of base.rs `unsized_info`'s `Dynamic` arms (base.ts, reached through `unsize_ptr`), over a logging mock backend
// and the layouts and queries the port computes for a small crate (fixers-55 item 4, review root-w54-recheck N2). The
// `Array`/`Slice` arm is rvalue_intrinsic.test.ts's; `get_vtable` and `load_vtable` on their own are mir_rest.test.ts's. This
// file pins the wiring between them: which arm runs, and what it passes to meth.rs.
//
// Expectations are read off upstream at the pin and checked against the oracle:
// - base.rs:225 `unsize_ptr`, `Ref`/`Ref` arm: `assert_eq!(type_is_sized(a), old_info.is_none())`, then
//   `(src, unsized_info(bx, a, b, old_info))`: the data pointer is passed through.
// - base.rs:176 `(Dynamic, Dynamic)`: the same principal (or none in the target) returns `old_info` unchanged; otherwise
//   `supertrait_vtable_slot((source, target))`, and for `Some(entry_idx)` `load_vtable(bx, old_info, bx.type_ptr(),
//   entry_idx * pointer_size, source, true)`; for `None`, `old_info`.
// - meth.rs:126 `load_vtable` (no VFE): `inbounds_ptradd(llvtable, const_usize(offset))`, `load(llty, gep, ptr_align)`,
//   `set_invariant_load`, and `nonnull_metadata` as `nonnull` is true.
// - base.rs:213 `(_, Dynamic)`: `meth::get_vtable(cx, source, principal.map(instantiate_bound_regions_with_erased))`.
// - meth.rs:103 `get_vtable`: the cache, then `static_addr_of(vtable_allocation, Some("vtable"))`,
//   `apply_vcall_visibility_metadata`, `create_vtable_debuginfo`, then the cache insert.
// - The slot: the oracle's `#[rustc_dump_vtable]` on `impl Sub for u16` (same traits) prints `[MetadataDropInPlace,
//   MetadataSize, MetadataAlign, Method(<u16 as Sup>::a), Method(<u16 as Sub2>::c), TraitVPtr(<u16 as Sub2>),
//   Method(<u16 as Sub>::b)]`: `Sub2`'s vptr is entry 5, so the offset is 5 * 8 = 40; `Sup` is the prefix and has no vptr.
// - The oracle's `-Cno-prepopulate-passes --emit=llvm-ir` of the same crate, for `fn up2(x: &dyn Sub) -> &dyn Sub2 { x }`:
//   `getelementptr inbounds i8, ptr %x.1, i64 40` then `load ptr, ptr %0, align 8, !invariant.load !12, !nonnull !12`;
//   for `up1` (to `&dyn Sup`) no instruction; for `fn mk(x: &u8) -> &dyn Tr { x }` the pair `(%x, @vtable.0)`, where
//   `@vtable.0` is `<{ [24 x i8], ptr }>` (32 bytes), align 8.
import { expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../scripts/lib/common.ts";
import { oracleSysroot } from "../../scripts/lib/oracle.ts";
import { Align, Size } from "../rustc_abi/lib.ts";
import type { Crate } from "../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../rustc_driver_impl/lib.ts";
import "../rustc_hir_analysis/lib.ts";
import { type Config, run_compiler } from "../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../rustc_interface/passes.ts";
import "../rustc_middle/lib.ts";
import type { ConstAllocation } from "../rustc_middle/mir/interpret/allocation.ts";
import type { Body } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { TyAndLayout } from "../rustc_middle/ty/layout.ts";
import { type Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import { display_Ty } from "../rustc_middle/ty/print/pretty.ts";
import { LocalDefId } from "../rustc_span/def_id.ts";
import type { ExistentialTraitRef } from "../rustc_type_ir/predicate.ts";
import { intern_key } from "../rust_ts/intern_key.ts";
import { KeyedMap } from "../rust_ts/keyed.ts";
import { unsize_ptr } from "./base.ts";
import type { BackendTypes } from "./traits/backend.ts";
import type { BuilderMethods } from "./traits/builder.ts";
import { DerivedTypeCodegenMethods_provided } from "./traits/type_.ts";

interface MockTypes extends BackendTypes {
  Value: string;
  Type: string;
  Function: string;
  BasicBlock: string;
  FunctionSignature: string;
}
type V = string;

class CaptureConfig extends Error {}
function config_from_args(args: string[]): Config {
  let config: Config | undefined;
  try {
    compiler_entrypoint(["rustc", ...args], {
      config(c: Config) {
        config = c;
        throw new CaptureConfig();
      },
    });
  } catch (e) {
    if (!(e instanceof CaptureConfig)) throw e;
  }
  if (config === undefined) throw new Error("ERROR: no config");
  return config;
}

const SRC = [
  "pub trait Tr { fn m(&self); }",
  "pub trait Sup { fn a(&self); }",
  "pub trait Sub2 { fn c(&self); }",
  "pub trait Sub: Sup + Sub2 { fn b(&self); }",
  "impl Tr for u8 { fn m(&self) {} }",
  "impl Sup for u8 { fn a(&self) {} }",
  "impl Sub2 for u8 { fn c(&self) {} }",
  "impl Sub for u8 { fn b(&self) {} }",
  "pub fn f(_a: &u8, _t: &dyn Tr, _d: &dyn Sub, _e: &dyn Sub2, _s: &dyn Sup, _ds: &(dyn Sub + Send), _snd: &dyn Send) {}",
].join("\n");

/** Formats a mock call argument. */
function fmt_arg(a: unknown): string {
  if (a instanceof Align) return `align${a.bytes()}`;
  if (a instanceof Size) return `size${a.bytes()}`;
  if (typeof a === "string" || typeof a === "number" || typeof a === "bigint" || typeof a === "boolean") return String(a);
  if (a === undefined) return "None";
  return "<obj>";
}

/** The logging mock builder (and its own `cx`): a method it does not define logs `name(args)` and returns a fresh `%N`. */
function mock_bx(tcx: TyCtxt): { bx: BuilderMethods<MockTypes>; log: string[]; allocs: ConstAllocation[]; vtables: KeyedMap<readonly [Ty, ExistentialTraitRef | undefined], V> } {
  const log: string[] = [];
  const allocs: ConstAllocation[] = [];
  const vtables = new KeyedMap<readonly [Ty, ExistentialTraitRef | undefined], V>(intern_key);
  let n = 0;
  const layout_of = (ty: Ty): TyAndLayout => {
    const r = tcx.layout_of(TypingEnv.fully_monomorphized().as_query_input(ty));
    if (r.$ !== "Ok") throw new Error("ERROR: layout_of failed");
    return r._0;
  };
  const trait_name = (tr: ExistentialTraitRef | undefined): string => (tr === undefined ? "None" : `${tcx.def_path_str(tr.def_id)}<${tr.args.length}>`);
  const own: Record<string, unknown> = {
    debug_Value: (v: V) => v,
    debug_Type: (v: V) => v,
    tcx_: () => tcx,
    typing_env_: () => TypingEnv.fully_monomorphized(),
    layout_of,
    data_layout: () => tcx.data_layout(),
    sess: () => tcx.sess,
    vtables: () => vtables,
    const_usize: (i: bigint) => `usize ${i}`,
    type_ptr: () => "ptr",
    // The provided method (traits/type_.rs:84), as rvalue_intrinsic.test.ts's mock.
    type_is_sized: (ty: Ty) => DerivedTypeCodegenMethods_provided.type_is_sized(proxy as never, ty),
    static_addr_of: (alloc: ConstAllocation, kind: string | undefined) => {
      allocs.push(alloc);
      const r = `%${n++}`;
      log.push(`${r} = static_addr_of(alloc${allocs.length - 1}, ${fmt_arg(kind)})`);
      return r;
    },
    apply_vcall_visibility_metadata: (ty: Ty, tr: ExistentialTraitRef | undefined, v: V) => {
      log.push(`apply_vcall_visibility_metadata(${display_Ty(ty)}, ${trait_name(tr)}, ${v})`);
    },
    create_vtable_debuginfo: (ty: Ty, tr: ExistentialTraitRef | undefined, v: V) => {
      log.push(`create_vtable_debuginfo(${display_Ty(ty)}, ${trait_name(tr)}, ${v})`);
    },
  };
  const proxy: BuilderMethods<MockTypes> = new Proxy(own, {
    get(target, prop) {
      if (prop === "cx") return () => proxy;
      if (typeof prop === "string" && prop in target) return target[prop];
      if (typeof prop !== "string" || prop === "then" || prop === "__backend_types") return undefined;
      return (...args: unknown[]) => {
        const r = `%${n++}`;
        log.push(`${r} = ${prop}(${args.map(fmt_arg).join(", ")})`);
        return r;
      };
    },
  }) as unknown as BuilderMethods<MockTypes>;
  return { bx: proxy, log, allocs, vtables };
}

function with_tcx(run: (tcx: TyCtxt, f: Body) => void): void {
  const dir = join(DATA, "tmp", "base-unsized-info", `${process.env.RUST_TS_AGENT ?? "default"}-${process.pid}`);
  const file = join(dir, "unsized_info.rs");
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, SRC);
  let ran = false;
  try {
    run_compiler(config_from_args(["--crate-type", "lib", "--edition", "2024", "--sysroot", oracleSysroot(), file]), (compiler) => {
      const krate: Crate = parse(compiler.sess);
      create_and_enter_global_ctxt(compiler, krate, (tcx) => {
        void tcx.resolver_for_lowering();
        let f: Body | undefined;
        for (const def of tcx.mir_keys(null)) {
          if (tcx.def_path_str(LocalDefId.to_def_id(def)) === "f") f = tcx.mir_built(def).borrow();
        }
        if (f === undefined) throw new Error("ERROR: no fn f");
        run(tcx, f);
        ran = true;
      });
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  expect(ran).toBe(true);
}

test("base.rs unsized_info: the Dynamic arms (trait upcast through load_vtable; get_vtable for an unsize to dyn Trait)", () => {
  with_tcx((tcx, f) => {
    // `f`'s locals: _0 (), then the parameters in order. Each is `&T`; the test unsizes between them.
    const ref = (i: number): Ty => f.local_decls[i]!.ty;
    expect(f.local_decls.slice(1, 8).map((d) => display_Ty(d.ty))).toEqual(["&u8", "&dyn Tr", "&dyn Sub", "&dyn Sub2", "&dyn Sup", "&dyn Sub + std::marker::Send", "&dyn std::marker::Send"]);
    const [R_u8, R_tr, R_sub, R_sub2, R_sup, R_sub_send, R_send] = [1, 2, 3, 4, 5, 6, 7].map(ref) as [Ty, Ty, Ty, Ty, Ty, Ty, Ty];

    // ---- `&u8` → `&dyn Tr` (base.rs:213 → meth.rs:103): `get_vtable(cx, u8, Some(Tr))`, then the cache. ----
    {
      const { bx, log, allocs, vtables } = mock_bx(tcx);
      expect(unsize_ptr(bx, "%x", R_u8, R_tr, undefined)).toEqual(["%x", "%0"]);
      expect(log).toEqual([
        "%0 = static_addr_of(alloc0, vtable)",
        "apply_vcall_visibility_metadata(u8, Tr<0>, %0)",
        "create_vtable_debuginfo(u8, Tr<0>, %0)",
      ]);
      // The oracle's `@vtable.0`: drop (null), size 1, align 1, then `<u8 as Tr>::m`: 32 bytes, align 8.
      expect(allocs.map((a) => [a.inner().size().bytes(), a.inner().align.bytes()])).toEqual([[32, 8]]);
      const keys = [...vtables.entries()].map(([[ty, tr], v]) => [display_Ty(ty), tr === undefined ? "None" : tcx.def_path_str(tr.def_id), v]);
      expect(keys).toEqual([["u8", "Tr", "%0"]]);
      // A second unsize of the same pair hits the cache: no backend call.
      log.length = 0;
      expect(unsize_ptr(bx, "%y", R_u8, R_tr, undefined)).toEqual(["%y", "%0"]);
      expect(log).toEqual([]);
    }

    // ---- `&dyn Sub` → `&dyn Sub2` (base.rs:203-209 → meth.rs:126): slot 5, offset 40; the oracle's `up2`. ----
    {
      const { bx, log } = mock_bx(tcx);
      expect(unsize_ptr(bx, "%x.0", R_sub, R_sub2, "%x.1")).toEqual(["%x.0", "%1"]);
      expect(log).toEqual(["%0 = inbounds_ptradd(%x.1, usize 40)", "%1 = load(ptr, %0, align8)", "%2 = set_invariant_load(%1)", "%3 = nonnull_metadata(%1)"]);
    }

    // ---- `&dyn Sub` → `&dyn Sup`: `Sup` is the prefix, `supertrait_vtable_slot` is `None`, `old_info` (the oracle's `up1`). ----
    {
      const { bx, log } = mock_bx(tcx);
      expect(unsize_ptr(bx, "%x.0", R_sub, R_sup, "%x.1")).toEqual(["%x.0", "%x.1"]);
      expect(log).toEqual([]);
    }

    // ---- The NOP casts (base.rs:180): the same principal, or no principal in the target, return `old_info`. ----
    {
      const { bx, log } = mock_bx(tcx);
      expect(unsize_ptr(bx, "%x.0", R_sub_send, R_sub, "%x.1")).toEqual(["%x.0", "%x.1"]);
      expect(unsize_ptr(bx, "%x.0", R_sub_send, R_send, "%x.1")).toEqual(["%x.0", "%x.1"]);
      expect(log).toEqual([]);
    }
  });
});
