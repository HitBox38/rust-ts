// Oracle tests for lane rmeta-decoder-a (decoder.rs 1..1342: `MetadataDecodeContext`'s span / hygiene decoding,
// `CrateMetadata`'s accessors up to `get_fake_doc_items`, `print_item`).
//
// rmetadefs (rustc-dev probe, tools/probes/rmetadefs) runs the oracle's driver on a `#![no_core]` crate with
// `extern crate core; extern crate compiler_builtins; extern crate alloc;` (target x86_64-unknown-linux-gnu, the
// oracle sysroot) and prints, through the oracle's queries, per-DefIndex `def_kind` / `visibility` / `def_span` /
// `expn_that_defined` / item name / def path / `default_field` for chunks of each crate, plus its diagnostic items,
// stability implications, canonical symbols and fake doc items. See the probe's header for the format: spans and
// syntax contexts are printed independently of the session's decoding order.
//
// The port builds a real `TyCtxt` (the driver's config, `passes::parse`, `create_and_enter_global_ctxt`, i.e. a real
// `CStore`), registers the three crates' `.rmeta` from the same sysroot in the `CStore` the way `register_crate`
// does (`CrateMetadata::new` is lane rmeta-decoder-b's: the `CrateMetadata` is constructed directly), and prints the
// same lines from the ported `CrateMetadata` methods.
//
// Fields that need lane rmeta-decoder-b's half (`imported_source_file` for spans and non-root expansions, `def_key`
// for names, `def_path`) may print `UNPORTED(..)` on the port's side; every other field must match. Once -b lands
// they match too (or the test fails on the first difference).
//
// Without the probe the test is a visible skip; RUST_TS_REQUIRE_PROBES=1 makes that a failure.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../../scripts/lib/common.ts";
import type { Crate } from "../../rustc_ast/lib.ts";
import { DefaultMetadataLoader } from "../../rustc_codegen_ssa/back/metadata.ts";
import { CrateSource } from "../../rustc_crate_store/lib.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../rustc_interface/passes.ts";
import { CFG_VERSION } from "../../rustc_interface/util.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { type CrateNum, DefIndex, LOCAL_CRATE, type LocalDefId } from "../../rustc_span/def_id.ts";
import { debug_ExpnKind, type ExpnId, HygieneDecodeContext, SyntaxContext } from "../../rustc_span/hygiene.ts";
import { FileName, Span } from "../../rustc_span/lib.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { spec } from "../../rustc_target/lib.ts";
import { debug_DefKind } from "../../rustc_hir/def.ts";
import { PLAIN } from "../../std/fmt.ts";
import { Unported } from "../../std/panic.ts";
import { KeyedMap } from "../../rust_ts/keyed.ts";
import { creader, locator } from "../lib.ts";
import { CrateMetadata, MetadataBlob } from "./decoder.ts";
import { type LazyTable, type LazyValue, RawDefId_key } from "./mod.ts";
import { type FixedSizeEncoding, fse_Option_LazyValue } from "./table.ts";
import type { CanonicalSymbols } from "../../rustc_attr_ir/canonical_symbols.ts";
import type { DiagnosticItems } from "../../rustc_attr_ir/diagnostic_items.ts";

const REQUIRE_PROBES = process.env.RUST_TS_REQUIRE_PROBES === "1";
const RMETADEFS = join(DATA, "target", "probes", "release", "rmetadefs");
const SKIP = !existsSync(RMETADEFS) && !REQUIRE_PROBES;
if (SKIP) console.log("SKIP: rmetadefs probe not built (bun scripts/probes.ts build rmetadefs); RUST_TS_REQUIRE_PROBES=1 makes this a failure");

const TUPLE = "x86_64-unknown-linux-gnu";
/** Dependencies first (the port registers them in this order, as the oracle's creader does). */
const CRATES = ["core", "compiler_builtins", "alloc"];
/** Fields the port may leave `UNPORTED(..)` until lane rmeta-decoder-b lands (see the header). */
const PENDING_B = new Set(["span", "expn", "name", "path"]);

const WORK = join(DATA, "tmp", "rmeta-decoder-a-oracle", process.env.RUST_TS_AGENT ?? "default");

function sysroot(): string {
  const oracle = require("../../../scripts/lib/oracle.ts") as typeof import("../../../scripts/lib/oracle.ts");
  return oracle.oracleSysroot();
}
function lib_dir(sysroot: string): string {
  return join(sysroot, "lib", "rustlib", TUPLE, "lib");
}
/** `lib<name>-<hash>.rmeta` of the target's sysroot dir. */
function rmeta_of(sysroot: string, name: string): string {
  const fs = readdirSync(lib_dir(sysroot)).filter((f) => f.startsWith(`lib${name}-`) && f.endsWith(".rmeta"));
  if (fs.length !== 1) throw new globalThis.Error(`expected one lib${name}-*.rmeta, found ${fs.length}`);
  return join(lib_dir(sysroot), fs[0]!);
}

function source_file(): string {
  mkdirSync(WORK, { recursive: true });
  const f = join(WORK, "defs.rs");
  writeFileSync(f, "#![feature(no_core)]\n#![no_core]\nextern crate core;\nextern crate compiler_builtins;\nextern crate alloc;\n");
  return f;
}
function rustc_args(sysroot: string, file: string): string[] {
  return ["--target", TUPLE, "--sysroot", sysroot, "--crate-type", "lib", "--edition", "2024", file];
}

/** The DefIndex ranges printed for a crate with `n` DefIndexes (the probe's `chunks`). */
function chunks(n: number): [number, number][] {
  const out: [number, number][] = [];
  const mid = Math.floor(n / 2);
  for (const [a, b] of [
    [0, Math.min(200, n)],
    [mid, Math.min(mid + 100, n)],
    [Math.max(n - 100, 0), n],
  ] as [number, number][]) {
    const last = out[out.length - 1];
    if (last !== undefined && a <= last[1]) {
      last[1] = Math.max(last[1], b);
      continue;
    }
    out.push([a, b]);
  }
  return out;
}

class CaptureConfig extends Error {}
/** The `interface::Config` rustc's driver builds from `args`. */
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
  if (config === undefined) throw new globalThis.Error("no config");
  return config;
}

/** A field's value, or `UNPORTED(<what>)` when the port stops there. */
function field(f: () => string): string {
  try {
    return f();
  } catch (e) {
    if (e instanceof Unported) return `UNPORTED(${e.what})`;
    throw e;
  }
}

/** Registers `name`'s `.rmeta` in the `CStore` as `CStore::register_crate` would (minus `CrateMetadata::new`). */
function register(tcx: TyCtxt, sysroot: string, name: string, cnums: Map<string, CrateNum>): CrateMetadata {
  const path = rmeta_of(sysroot, name);
  const nb = MetadataBlob.new(new Uint8Array(readFileSync(path)));
  if (nb.$ === "Err") throw new globalThis.Error(`MetadataBlob::new failed for ${path}`);
  const blob = nb._0;
  const root = blob.get_root();
  const cstore = creader.CStore.from_tcx_mut(tcx);
  const feed = cstore.intern_stable_crate_id(tcx, root);
  if (feed.$ === "Err") throw new globalThis.Error(`intern_stable_crate_id failed for ${name}`);
  const cnum = feed._0.key();
  const cnum_map: CrateNum[] = [cnum];
  for (const dep of root.decode_crate_deps(blob)) {
    const c = cnums.get(Symbol.as_str(dep.name));
    if (c === undefined) throw new globalThis.Error(`${name}: dependency ${Symbol.as_str(dep.name)} not registered`);
    cnum_map.push(c);
  }
  const cdata = new CrateMetadata(
    blob,
    root,
    blob.get_root_unhashed(),
    new KeyedMap(RawDefId_key),
    new Map(),
    undefined,
    [],
    undefined as never, // def_path_hash_map: odht (not ported); not read by the methods under test
    undefined,
    undefined,
    new Map(),
    cnum,
    cnum_map,
    "Unconditional",
    new CrateSource(undefined, undefined, path, undefined),
    false,
    undefined,
    true,
    HygieneDecodeContext.default(),
    undefined,
  );
  cstore.set_crate_data(cnum, cdata);
  cnums.set(name, cnum);
  return cdata;
}

/** The port's version of the rmetadefs output. */
function port_rmetadefs(sysroot: string, file: string): string {
  const config = config_from_args(rustc_args(sysroot, file));
  let out = "";
  run_compiler(config, (compiler) => {
    const krate: Crate = parse(compiler.sess);
    create_and_enter_global_ctxt(compiler, krate, (tcx) => {
      const cnums = new Map<string, CrateNum>();
      const names = new Map<CrateNum, string>();
      const cdatas = new Map<string, CrateMetadata>();
      for (const name of CRATES) {
        const cdata = register(tcx, sysroot, name, cnums);
        cdatas.set(name, cdata);
        names.set(cdata.cnum, name);
      }
      const crate_name = (c: CrateNum) => names.get(c) ?? `?${c}`;
      const expn_short = (e: ExpnId) => (e.krate === LOCAL_CRATE && (e.local_id as number) === 0 ? "root" : `${crate_name(e.krate)}:${e.local_id}`);
      const ctxt_str = (ctxt: SyntaxContext) => {
        const marks = SyntaxContext.marks(ctxt);
        if (marks.length === 0) return "";
        return ` #[${marks.map(([e, t]) => `${expn_short(e)}/${t}`).join(", ")}]`;
      };
      const span_str = (sp: Span) => {
        const data = Span.data(sp);
        const ctxt = ctxt_str(data.ctxt);
        if (data.lo === 0 && data.hi === 0) return `dummy${ctxt}`;
        const sm = tcx.sess.source_map();
        const lo = sm.lookup_byte_offset(data.lo);
        const hi = data.hi - lo.sf.start_pos;
        return `${FileName.prefer_remapped_unconditionally(lo.sf.name).to_string()}:${lo.pos}..${hi}${ctxt}`;
      };
      const lines: string[] = [];
      for (const name of CRATES) {
        const cdata = cdatas.get(name)!;
        const tables = cdata.root.tables;
        const n = cdata.num_def_ids();
        lines.push(`crate ${name} num_def_ids=${n}`);
        // the contract declares these two `unknown` (decoder.ts); the port returns the rustc_attr_ir types
        for (const [sym, id] of (cdata.get_diagnostic_items(tcx) as DiagnosticItems).name_to_id) lines.push(`diag ${Symbol.as_str(sym)} ${DefIndex.as_u32(id.index)}`);
        const si = cdata.get_stability_implications(tcx).map(([a, b]) => [Symbol.as_str(a), Symbol.as_str(b)] as const);
        si.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0));
        for (const [a, b] of si) lines.push(`stab_impl ${a} ${b}`);
        for (const c of (cdata.get_canonical_symbols(tcx) as CanonicalSymbols).iter()) lines.push(`canon ${Symbol.as_str(c.symbol)} ${DefIndex.as_u32(c.def_id.index)}`);
        for (const id of cdata.get_fake_doc_items(tcx)) lines.push(`fake_doc ${DefIndex.as_u32(id.index)}`);

        for (const [a, b] of chunks(n)) {
          for (let i = a; i < b; i++) {
            const idx = DefIndex.from_usize(i);
            const kind = cdata.def_kind(idx);
            const has = <T>(t: LazyTable<LocalDefId, DefIndex, LazyValue<T> | undefined>) => t.get(fse_Option_LazyValue as FixedSizeEncoding<LazyValue<T> | undefined>, cdata, idx) !== undefined;
            const vis = field(() => {
              if (!has(tables.visibility)) return "-";
              const v = cdata.get_visibility(tcx, idx);
              return v.$ === "Public" ? "Public" : `Restricted(${DefIndex.as_u32(v._0.to_def_id().index)})`;
            });
            const span = field(() => (has(tables.def_span) ? span_str(cdata.get_span(tcx, idx)) : "-"));
            const expn = field(() => {
              if (!has(tables.expn_that_defined)) return "-";
              const e = cdata.get_expn_that_defined(tcx, idx);
              return expn_short(e) === "root" ? "root" : `${expn_short(e)} ${debug_ExpnKind(e.expn_data().kind, PLAIN)}`;
            });
            const name_ = field(() => {
              const s = cdata.opt_item_name(idx);
              return s === undefined ? "-" : Symbol.as_str(s);
            });
            const path = field(() => cdata.def_path(idx).to_string_no_crate_verbose());
            const default_ = field(() => {
              if (kind.$ !== "Field") return "-";
              const d = cdata.get_default_field(tcx, idx);
              return d === undefined ? "-" : `${crate_name(d.krate)}:${DefIndex.as_u32(d.index)}`;
            });
            lines.push(`${i}\tkind=${debug_DefKind(kind, PLAIN)}\tvis=${vis}\tspan=${span}\texpn=${expn}\tname=${name_}\tpath=${path}\tdefault=${default_}`);
          }
        }
      }
      out = `${lines.join("\n")}\n`;
    });
  });
  return out;
}

test.skipIf(SKIP)(
  "rmetadefs: per-DefIndex accessors and crate-level arrays of core / compiler_builtins / alloc match the oracle",
  () => {
    const root = sysroot();
    const file = source_file();
    const r = Bun.spawnSync([RMETADEFS, CRATES.join(","), ...rustc_args(root, file)], { cwd: WORK, stdout: "pipe", stderr: "pipe", env: { ...process.env, RUST_BACKTRACE: "0" } });
    if (r.exitCode !== 0) throw new globalThis.Error(`rmetadefs failed: ${r.stderr.toString().slice(0, 2000)}`);
    const want = r.stdout.toString().split("\n");
    const got = port_rmetadefs(root, file).split("\n");
    writeFileSync(join(WORK, "oracle.txt"), want.join("\n"));
    writeFileSync(join(WORK, "port.txt"), got.join("\n"));

    expect(got.length).toBe(want.length);
    const diffs: string[] = [];
    const pending = new Map<string, number>();
    let strict = 0;
    for (let i = 0; i < want.length; i++) {
      const w = want[i]!;
      const g = got[i]!;
      if (!/^\d/.test(w)) {
        if (g !== w) diffs.push(`line ${i + 1}: want ${JSON.stringify(w)} got ${JSON.stringify(g)}`);
        else strict++;
        continue;
      }
      const wf = w.split("\t");
      const gf = g.split("\t");
      if (wf.length !== gf.length || wf[0] !== gf[0]) {
        diffs.push(`line ${i + 1}: want ${JSON.stringify(w)} got ${JSON.stringify(g)}`);
        continue;
      }
      for (let k = 1; k < wf.length; k++) {
        const key = wf[k]!.slice(0, wf[k]!.indexOf("="));
        const gv = gf[k]!;
        if (gv.startsWith(`${key}=UNPORTED(`) && PENDING_B.has(key)) {
          pending.set(key, (pending.get(key) ?? 0) + 1);
          continue;
        }
        if (gv !== wf[k]) diffs.push(`line ${i + 1} (${wf[0]}): want ${JSON.stringify(wf[k])} got ${JSON.stringify(gv)}`);
        else strict++;
      }
    }
    if (pending.size > 0) console.log(`rmetadefs: pending lane rmeta-decoder-b (UNPORTED on the port's side): ${[...pending].map(([k, v]) => `${k} ${v}`).join(", ")}`);
    expect(diffs.slice(0, 10)).toEqual([]);
    // every line's kind / vis / default and every crate-level line compared strictly
    expect(strict).toBeGreaterThan(want.length);
  },
  300_000,
);

test("-Zls=items: print_item matches `rustc -Zls=items` (compiler_builtins)", () => {
  const root = sysroot();
  const f = rmeta_of(root, "compiler_builtins");
  const r = spec.Target.search(spec.TargetTuple.from_tuple(TUPLE), root, false);
  if (r.$ === "Err") throw new globalThis.Error(r._0);
  const t = r._0[0];
  let got = "";
  const out = {
    write: (b: Uint8Array) => ({ $: "Ok" as const, _0: b.length }),
    write_all: () => ({ $: "Ok" as const, _0: undefined }),
    write_fmt: (a: readonly string[]) => {
      got += a.join("");
      return { $: "Ok" as const, _0: undefined };
    },
    flush: () => ({ $: "Ok" as const, _0: undefined }),
  };
  const { create_default_session_globals_then } = require("../../rustc_span/lib.ts") as typeof import("../../rustc_span/lib.ts");
  let pending: string | undefined;
  create_default_session_globals_then(() => {
    try {
      const res = locator.list_file_metadata(t, f, DefaultMetadataLoader, out, ["items"], CFG_VERSION);
      if (res.$ === "Err") got += `ERR ${JSON.stringify(res._0)}`;
    } catch (e) {
      if (e instanceof Unported && e.what.includes("DefKey")) pending = e.what;
      else throw e;
    }
  });
  if (pending !== undefined) {
    // `DefKey`'s Decodable comes with lane rmeta-decoder-b (see decoder.ts `decode_DefKey_pending`).
    console.log(`SKIP: -Zls=items pending lane rmeta-decoder-b (${pending})`);
    return;
  }
  const oracle = require("../../../scripts/lib/oracle.ts") as typeof import("../../../scripts/lib/oracle.ts");
  const o = Bun.spawnSync(oracle.oracleRustcCmd(["--target", TUPLE, "-Zls=items", f]), { cwd: DATA, env: { ...process.env, RUST_BACKTRACE: "0" }, stdout: "pipe", stderr: "pipe" });
  expect(o.exitCode).toBe(0);
  // `list_metadata` prints the buffer with `safe_println!`
  expect(`${got}\n`).toBe(o.stdout.toString());
}, 300_000);
