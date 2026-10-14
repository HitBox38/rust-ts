// Test driver for src/rustc_middle/ty/print/pretty_b.test.ts (not a port).
//   bun src/rustc_middle/ty/print/pretty_oracle/run.ts <rustc arguments...>
//
// Subject side of ./probe.rs (its header documents the output): runs the ported driver and, in `after_expansion`,
// prints the same sections with lane ty-print-b's `FmtPrinter`, then stops (`Compilation::Stop`).
// Differences from the probe:
// - regions are interned with `tcx.intern_region(kind)` (the `Region::new_*` statics are stubs);
// - `ty::print::trimmed_def_paths(tcx, ())` is called directly, as in the probe.
// One more, forced by rustc_interface/limits.ts (its `hir_krate_attrs` stand-in, a merge-w14 root item): the printers
// are made with `FmtPrinter::new_with_limit(tcx, ns, Limit::new(2^24))` (`print_string` likewise), i.e. with the
// `type_length_limit` that limits.rs:24 gives a crate without `#![type_length_limit]`, instead of `FmtPrinter::new`
// reading the `limits` query. No case comes near the limit.
//
// Exit codes as src/rust_ts/main.ts: rustc's own, plus 70 = reached unported code, 101 = ICE.
import type { Compiler, Config } from "../../../../rustc_interface/interface.ts";
import type { TyCtxt } from "../../context.ts";
import { Panic, Unported } from "../../../../std/panic.ts";
import { ensure_stack } from "../../../../rust_ts/stack.ts";

const EXIT_UNPORTED = 70;

async function main(): Promise<number> {
  ensure_stack();
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../../../rustc_driver_impl/lib.ts");
  const { raw_args } = await import("../../../../rustc_driver_impl/args.ts");
  const { EarlyDiagCtxt } = await import("../../../../rustc_session/session.ts");
  const { ErrorOutputType, std_print } = await import("../../../../rustc_session/config.ts");
  const { CRATE_DEF_ID, CrateNum, DefIndex, LOCAL_CRATE, LocalDefId, debug_DefId } = await import("../../../../rustc_span/def_id.ts");
  const { Symbol, display_Symbol, kw } = await import("../../../../rustc_span/symbol.ts");
  const { INNERMOST } = await import("../../../../rustc_type_ir/decls.ts");
  const pretty = await import("../pretty.ts");
  const { FmtPrinter, trimmed_def_paths, with_crate_prefix, with_resolve_crate_name } = pretty;
  const { Limit } = await import("../../../../rustc_structures/limit.ts");
  type Ns = import("../../../../rustc_hir/def.ts").Namespace;
  type FmtPrinterT = import("../pretty.ts").FmtPrinter;
  const new_printer = (tcx: TyCtxt, ns: Ns): FmtPrinterT => FmtPrinter.new_with_limit(tcx, ns, Limit.new(2 ** 24));
  // (`PrintResult` / `Print` live in ty/print/mod.ts once lane ty-print-a lands: spelled structurally here)
  type PrintResult = ReturnType<FmtPrinterT["write_str"]>;
  const print_string = (tcx: TyCtxt, ns: Ns, f: (p: FmtPrinterT) => PrintResult): string => {
    const c = new_printer(tcx, ns);
    if (f(c).$ === "Err") throw new Error("fmt::Error");
    return c.into_buffer();
  };
  type Region = import("../../../../rustc_type_ir/sty/mod.ts").Region;
  type RegionKind = import("../../../../rustc_type_ir/decls.ts").RegionKind;
  type BoundRegionKind = import("../../../../rustc_type_ir/decls.ts").BoundRegionKind;
  type BoundVar = import("../../../../rustc_type_ir/decls.ts").BoundVar;
  type RegionVid = import("../../../../rustc_type_ir/decls.ts").RegionVid;
  type UniverseIndex = import("../../../../rustc_type_ir/decls.ts").UniverseIndex;
  type GenericArg = import("../../generic_args.ts").GenericArg;

  function regions(tcx: TyCtxt): [string, Region][] {
    const br = (v: number, kind: BoundRegionKind) => ({ var: v as BoundVar, kind });
    const r = (k: RegionKind): Region => tcx.intern_region(k);
    const bound = (v: number, kind: BoundRegionKind) => r({ $: "ReBound", _0: { $: "Bound", _0: INNERMOST }, _1: br(v, kind) });
    const placeholder = (v: number, kind: BoundRegionKind) => r({ $: "RePlaceholder", _0: { universe: 0 as UniverseIndex, bound: br(v, kind), _tcx: undefined } });
    const scope = LocalDefId.to_def_id(CRATE_DEF_ID);
    return [
      ["static", tcx.lifetimes.re_static],
      ["erased", tcx.lifetimes.re_erased],
      ["var3", r({ $: "ReVar", _0: 3 as RegionVid })],
      ["early_a", r({ $: "ReEarlyParam", _0: { index: 0, name: Symbol.intern("'a") } })],
      ["early_anon", r({ $: "ReEarlyParam", _0: { index: 1, name: kw.UnderscoreLifetime } })],
      ["bound_named", bound(0, { $: "NamedForPrinting", _0: Symbol.intern("'x") })],
      ["bound_anon", bound(1, { $: "Anon" })],
      ["bound_env", bound(2, { $: "ClosureEnv" })],
      ["placeholder_named", placeholder(0, { $: "NamedForPrinting", _0: Symbol.intern("'p") })],
      ["placeholder_anon", placeholder(1, { $: "Anon" })],
      ["late_named_anon", r({ $: "ReLateParam", _0: { scope, kind: { $: "NamedAnon", _0: 0, _1: Symbol.intern("'q") } } })],
      ["late_anon", r({ $: "ReLateParam", _0: { scope, kind: { $: "Anon", _0: 0 } } })],
    ];
  }

  const callbacks = {
    config(_config: Config): void {},
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      let out = "";
      const rs = regions(tcx);
      const verbose = tcx.sess.verbose_internals();

      out += "== regions\n";
      if (!verbose) {
        for (const [label, r] of rs) {
          const opt = new_printer(tcx, "TypeNS").should_print_optional_region(r);
          // `{r}`: `IrPrint::print` (print/mod.rs:427) is `FmtPrinter::new(tcx, TypeNS)` + `print_region`
          const s = print_string(tcx, "TypeNS", (p) => p.print_region(r));
          out += `${label} ${s} ${opt}\n`;
        }
      }

      out += "== highlight\n";
      if (!verbose) {
        const r = (l: string): Region => rs.find(([x]) => x === l)![1];
        const p = new_printer(tcx, "TypeNS");
        p._0.region_highlight_mode.highlighting_region(r("var3"), 7);
        p.print_region(r("var3"));
        p.write_str(" ");
        p.print_region(r("early_a"));
        p.write_str(" ");
        p._0.region_highlight_mode.highlighting_bound_region({ $: "Anon" }, 4);
        p.print_region(r("bound_anon"));
        p.write_str(" ");
        p.print_region(r("placeholder_anon"));
        p.write_str(" ");
        p.print_region(r("bound_env"));
        const o1 = p.should_print_optional_region(r("bound_anon"));
        const o2 = p.should_print_optional_region(r("var3"));
        const o3 = p.should_print_optional_region(r("erased"));
        out += `${p.into_buffer()} ${o1} ${o2} ${o3}\n`;
      }

      out += "== crate_name\n";
      const cn = (cnum: import("../../../../rustc_span/def_id.ts").CrateNum) => print_string(tcx, "TypeNS", (p) => p.print_crate_name(cnum));
      out += `local [${cn(LOCAL_CRATE)}]\n`;
      out += `local+crate_prefix [${with_crate_prefix(() => cn(LOCAL_CRATE))}]\n`;
      out += `local+resolve_crate_name [${with_resolve_crate_name(() => cn(LOCAL_CRATE))}]\n`;
      out += `local+both [${with_crate_prefix(() => with_resolve_crate_name(() => cn(LOCAL_CRATE)))}]\n`;
      for (const cnum of tcx.crates(null)) {
        out += `${CrateNum.as_u32(cnum)} [${cn(cnum)}]\n`;
      }

      out += "== simple\n";
      for (const id of tcx.hir_free_items()) {
        const def_id = id.owner_id.to_def_id();
        const key = tcx.def_key(def_id);
        const simple = (ns: "TypeNS" | "ValueNS") =>
          print_string(tcx, ns, (p) => p.print_path_with_simple((p) => p.print_crate_name(LOCAL_CRATE), key.disambiguated_data));
        const a = simple("TypeNS");
        const b = with_crate_prefix(() => simple("ValueNS"));
        out += `${DefIndex.as_u32(def_id.index)} [${a}] [${b}]\n`;
      }

      out += "== generic_args\n";
      const args: GenericArg[] = [tcx.lifetimes.re_static, tcx.lifetimes.re_erased];
      for (const ns of verbose ? [] : (["TypeNS", "ValueNS"] as const)) {
        const s = print_string(tcx, ns, (p) => p.print_path_with_generic_args((p) => p.write_str("Foo"), args));
        const e = print_string(tcx, ns, (p) => p.print_path_with_generic_args((p) => p.write_str("Foo"), []));
        const t = print_string(tcx, ns, (p) =>
          p.typed_value(
            (p) => p.write_str("a"),
            (p) => p.print_path_with_generic_args((p) => p.write_str("T"), args.slice(0, 1)),
            ": ",
          ),
        );
        out += `${ns} ${s} ${e} ${t}\n`;
      }

      out += "== display\n";
      if (!verbose) {
        // `{x}`: `Display` (`forward_display_to_print!` / `IrPrint::print`) is `FmtPrinter::new(tcx, TypeNS)` + `x.print(p)`;
        // here through `print_string` (see the header about `FmtPrinter::new`).
        const d = <T>(pr: (self: T, p: FmtPrinterT) => PrintResult, v: T): string => print_string(tcx, "TypeNS", (p) => pr(v, p));
        const pt = d(pretty.print_ParamTy, { index: 0, name: Symbol.intern("T") });
        const pc = d(pretty.print_ParamConst, { index: 1, name: Symbol.intern("N") });
        const empty = d(pretty.print_List_Ty, tcx.mk_type_list([]));
        const ga = d(pretty.print_GenericArg, tcx.lifetimes.re_static);
        const ck = d(pretty.print_ClauseKind, { $: "UnstableFeature", _0: Symbol.intern("foo") });
        const pk = d(pretty.print_PredicateKind, { $: "Ambiguous" });
        const oc = d((self: import("../../../../rustc_type_ir/decls.ts").OutlivesClause<Region>, p: FmtPrinterT) => pretty.print_OutlivesClause(self, p, (r: Region, p: FmtPrinterT) => p.print_region(r)), { _0: tcx.lifetimes.re_static, _1: tcx.lifetimes.re_erased });
        out += `${pt} ${pc} ${empty} ${ga} [${ck}] [${pk}] [${oc}]\n`;
      }

      out += "== byte_str\n";
      {
        const p = new_printer(tcx, "ValueNS");
        p.pretty_print_byte_str(new Uint8Array([...new TextEncoder().encode("a"), 0x00, 0x09, 0x0a, 0x0d, 0x5c, 0x27, 0x22, 0x7f, 0xff, ...new TextEncoder().encode(" ~Z")]));
        p.write_str(" ");
        p.pretty_print_bound_constness("Const");
        p.pretty_print_bound_constness("Maybe");
        const v = p.should_print_verbose();
        out += `${p.into_buffer()} ${v}\n`;
      }

      const map = trimmed_def_paths(tcx, null);
      const entries = [...map].sort(([a], [b]) => CrateNum.as_u32(a.krate) - CrateNum.as_u32(b.krate) || DefIndex.as_u32(a.index) - DefIndex.as_u32(b.index));
      out += `== trimmed (${entries.length})\n`;
      for (const [d, s] of entries) out += `${debug_DefId(d, { alternate: false })} ${display_Symbol(s)}\n`;

      std_print(out);
      return "Stop";
    },
  };

  const early_dcx = EarlyDiagCtxt.new(ErrorOutputType.default());
  return catch_with_exit_code(() => compiler_entrypoint(raw_args(early_dcx), callbacks));
}

try {
  process.exitCode = await main();
} catch (e) {
  if (e instanceof Unported) {
    process.stderr.write(`rust-ts: unported: ${e.what}\n`);
    process.exitCode = EXIT_UNPORTED;
  } else {
    const msg = e instanceof Panic ? e.message : String(e);
    process.stderr.write(`rust-ts: internal compiler error: ${msg}\n${e instanceof Error ? e.stack : ""}\n`);
    process.exitCode = 101;
  }
}
