// Subject side of the `mirdump-*` suites (plan-m4 D2, M4a): runs the compilation with the ported driver, stops it after
// MIR building and promotion and prints the MIR of every `mir_keys` item as tools/probes/mirdump/main.rs does (its
// header documents the setup, the steps, the recording of `mir_built` / `mir_promoted` values and the output). This
// file mirrors the probe step by step; the analysis prefix is tydump_dump.ts's (tools/probes/tydump/prefix.rs).
//   bun src/rust_ts/mirdump.ts <rustc arguments...>
//
// RUST_TS_IMPL as src/rust_ts/main.ts: `port` (default), `shim` (runs the oracle probe itself, so the suite must score
// 100%), `stub` (everything unported, 0%).
// Exit codes as src/rust_ts/main.ts: rustc's own, plus 70 = reached unported code, 101 = ICE.
//
// This is our own code (not a port): the upstream statements the probe runs are called through their ported fns and
// queries; what is not ported stops there as UNPORTED (a query provider: `<query> provider (not ported)`).
//
// SEAMS for root (lane mir-contract declares the MIR types and `MirWriter::write_mir_fn` in parallel; nothing of it was
// committed when this file was written). Each seam is one function of `MirSeams` below, loaded in `load_seams()`:
// - `write_mir_fn(tcx, body)`: rustc_middle/src/mir/pretty.rs:393 `MirWriter::new(tcx).write_mir_fn(body, w)` into a
//   string (the probe writes into a `Vec<u8>`; `write_mir_intro`, the blocks, `}`, `write_allocations`);
// - `clone_body(body)` / `clone_promoted(promoted)`: `Clone` of `mir::Body` and of `IndexVec<Promoted, Body>` (D3:
//   codegen's `clone_Body`, a deep copy);
// - `display_const_val(val, ty)`: `{}` of `mir::Const::Val(val, ty)` (rustc_middle/src/mir/pretty.rs
//   `pretty_print_const_value`), for the trivial-const one-liner.
// Until they are wired, each calls `unported(...)`; the `mir_built` provider is reached first in practice.
import type { Compiler, Config } from "../rustc_interface/interface.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Providers } from "../rustc_middle/util/mod.ts";
import type { Steal } from "../rustc_data_structures/steal.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import type { Body } from "../rustc_middle/mir/mod.ts";
import type { ConstValue } from "../rustc_middle/mir/consts.ts";
import { debug_IoError } from "../std/io.ts";
import { Panic, Unported } from "../std/panic.ts";
import { unwrap_result } from "../std/result.ts";
import { VecU8 } from "../vendor/anstream/stream.ts";
import { ensure_stack } from "./stack.ts";

const EXIT_UNPORTED = 70;

/** A `mir::Body` (not declared in the port yet: lane mir-contract). */
/** `mir_promoted`'s value: the body and `IndexVec<Promoted, Body>`. */
type MirPromoted = [Steal<Body>, Steal<Body[]>];

/** The seams of the header. */
interface MirSeams {
  write_mir_fn(tcx: TyCtxt, body: Body): string;
  clone_body(body: Body): Body;
  clone_promoted(promoted: readonly Body[]): Body[];
  display_const_val(val: unknown, ty: Ty): string;
}

/**
 * The seams (see the header), wired by lane mir-pretty. The mir modules are loaded here, when `main` calls this (after
 * its driver imports, as the driver's own modules are), not at this script's load.
 */
function load_seams(): MirSeams {
  const { MirWriter } = require("../rustc_middle/mir/pretty.ts") as typeof import("../rustc_middle/mir/pretty.ts");
  const { clone_Body, display_Const } = require("../rustc_middle/mir/mod.ts") as typeof import("../rustc_middle/mir/mod.ts");
  return {
    // `MirWriter::new(tcx).write_mir_fn(body, &mut Vec<u8>)`, the bytes as UTF-8 (the probe's `String::from_utf8`).
    write_mir_fn: (tcx, body) => {
      const w = new VecU8();
      unwrap_result(MirWriter.new(tcx).write_mir_fn(body, w), debug_IoError);
      return new TextDecoder("utf-8", { fatal: true }).decode(w.bytes());
    },
    clone_body: (body) => clone_Body(body),
    clone_promoted: (promoted) => promoted.map(clone_Body),
    // `{}` of `mir::Const::Val(val, ty)` (consts.rs `impl Display for Const`).
    display_const_val: (val, ty) => display_Const({ $: "Val", _0: val as ConstValue, _1: ty }),
  };
}

/** The probe's recorded copies (`RECORDED`): one per provided `mir_built` / `mir_promoted` value. */
interface Recorded {
  built: Map<LocalDefId, Body>;
  promoted: Map<LocalDefId, [Body, Body[]]>;
}

/** Functions the callbacks need, loaded with the driver (load order and the stack re-exec, as src/rust_ts/main.ts). */
interface Deps {
  prefix: (tcx: TyCtxt) => number;
  to_def_id: (def_id: LocalDefId) => Parameters<TyCtxt["is_typeck_child"]>[0];
  with_forced_impl_filename_line: <R>(e: () => R) => R;
  display_Ty: (ty: Ty) => string;
  print: (s: string) => void;
  seams: MirSeams;
}

/** The probe's `override_queries`: wraps the `mir_built` and `mir_promoted` providers, recording a copy of each value. */
function override_queries(rec: Recorded, seams: MirSeams) {
  return (_sess: unknown, providers: Providers): void => {
    const mir_built = providers.queries.mir_built;
    const mir_promoted = providers.queries.mir_promoted;
    providers.queries.mir_built = (tcx, def) => {
      const r = mir_built(tcx, def);
      rec.built.set(def, seams.clone_body(r.borrow()));
      return r;
    };
    providers.queries.mir_promoted = (tcx, def) => {
      const r: MirPromoted = mir_promoted(tcx, def);
      rec.promoted.set(def, [seams.clone_body(r[0].borrow()), seams.clone_promoted(r[1].borrow())]);
      return r;
    };
  };
}

/** The probe's `MirDump` callbacks. */
function make_callbacks(d: Deps) {
  const rec: Recorded = { built: new Map(), promoted: new Map() };
  return {
    config(config: Config): void {
      // As rustc's `TimePassesCallbacks::config` (rustc_driver_impl/src/lib.rs), minus time-passes.
      config.opts.trimmed_def_paths = true;
      // `-Zunpretty=mir`'s effect on `record_trimmed_def_paths` (see the probe's header).
      config.opts.unstable_opts.unpretty = "mir";
      config.override_queries = override_queries(rec, d.seams);
    },
    // The probe runs `prefix::run_required_analyses_prefix(tcx)`, `mir_borrow_checking(tcx)`, then prints `dump(tcx)`
    // to stdout and returns `Compilation::Stop`.
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      d.prefix(tcx);
      mir_borrow_checking(tcx, d);
      const out = dump(tcx, d, rec);
      d.print(out);
      return "Stop";
    },
  };
}

/**
 * The probe's `mir_borrow_checking`: the `MIR_borrow_checking` loop of rustc_interface/src/passes.rs:1163
 * `run_required_analyses`, with `mir_borrowck`, `check_transmutes`, `mir_drops_elaborated_and_const_checked` and the
 * coroutine `layout_of` left out (plan-m4 D2); everything else verbatim.
 */
function mir_borrow_checking(tcx: TyCtxt, d: Deps): void {
  const sess = tcx.sess;
  sess.time("MIR_borrow_checking", () => {
    tcx.par_hir_body_owners((def_id) => {
      const not_typeck_child = !tcx.is_typeck_child(d.to_def_id(def_id));
      if (not_typeck_child) {
        // Child unsafety and borrowck happens together with the parent
        tcx.ensure_ok().check_unsafety(def_id);
      }
      if (tcx.is_trivial_const(def_id)) {
        return;
      }
      if (not_typeck_child) {
        // (D2: `tcx.ensure_ok().mir_borrowck(def_id)` and `tcx.ensure_ok().check_transmutes(def_id)` are left out.)
        if (tcx.sess.opts.unstable_opts.offload.length !== 0) {
          tcx.ensure_ok().check_offloads(def_id);
        }
      }
      tcx.ensure_ok().has_ffi_unwind_calls(def_id);
      tcx.ensure_ok().check_liveness(def_id);

      // (D2: the `mir_drops_elaborated_and_const_checked` arm (`should_codegen()` or a const context) and the
      // coroutine `layout_of` cycle check are left out.)
    });
  });
}

/** The probe's `dump` (step 3 of its header). */
function dump(tcx: TyCtxt, d: Deps, rec: Recorded): string {
  const write_mir_fn = (body: Body): string => d.seams.write_mir_fn(tcx, body);
  let w = "";
  let first = true;
  for (const def_id of tcx.mir_keys(null)) {
    if (first) {
      first = false;
    } else {
      // Put empty lines between all items
      w += "\n";
    }

    // As `write_mir_pretty` (rustc_middle/src/mir/pretty.rs:318) prints a trivial const.
    const trivial = tcx.trivial_const(def_id);
    if (trivial !== undefined) {
      const [val, ty] = trivial;
      // see notes on #41697 elsewhere
      w += d.with_forced_impl_filename_line(() => `const ${tcx.def_path_str(def_id)}`);
      w += `: ${d.display_Ty(ty)} = const ${d.seams.display_const_val(val, ty)};\n`;
      continue;
    }

    if (tcx.is_constructor(d.to_def_id(def_id))) {
      w += "// mir_for_ctfe\n";
      w += write_mir_fn(tcx.mir_for_ctfe(def_id));
      continue;
    }

    w += "// mir_built\n";
    const steal = tcx.mir_built(def_id);
    const built = rec.built.get(def_id);
    // `None`: fed, not provided (coroutine-closure by-move bodies): nothing has stolen it.
    w += write_mir_fn(built !== undefined ? built : steal.borrow());

    w += "\n";
    w += "// mir_promoted\n";
    tcx.mir_promoted(def_id);
    const promoted = rec.promoted.get(def_id);
    if (promoted === undefined) throw new Panic("mir_promoted is provided, never fed");
    w += write_mir_fn(promoted[0]);
    for (const body of promoted[1]) {
      w += "\n";
      w += write_mir_fn(body);
    }
  }
  return w;
}

async function main(args: string[]): Promise<number> {
  const impl = process.env.RUST_TS_IMPL ?? "port";
  if (impl === "shim") {
    const { probePath } = await import("../../scripts/probes.ts");
    const proc = Bun.spawn([probePath("mirdump"), ...args], { stdio: ["inherit", "inherit", "inherit"] });
    return await proc.exited;
  }
  if (impl === "stub") throw new Unported("stub implementation");
  // The compiler's stack (rustc's thread stack size): see stack.ts. Re-execs this process once.
  ensure_stack();
  const { catch_with_exit_code, compiler_entrypoint } = await import("../rustc_driver_impl/lib.ts");
  const { raw_args } = await import("../rustc_driver_impl/args.ts");
  const { EarlyDiagCtxt } = await import("../rustc_session/session.ts");
  const { ErrorOutputType, std_print } = await import("../rustc_session/config.ts");
  const { run_required_analyses_prefix } = await import("./tydump_dump.ts");
  const { LocalDefId } = await import("../rustc_span/def_id.ts");
  const { display_Ty, with_forced_impl_filename_line } = await import("../rustc_middle/ty/print/pretty.ts");
  // The probe's `main`: `EarlyDiagCtxt::new(ErrorOutputType::default())`,
  // `install_ice_hook(DEFAULT_BUG_REPORT_URL, |_| ())` (not ported, as in rustc_driver_impl/lib.ts),
  // `catch_with_exit_code(|| compiler_entrypoint(&raw_args(&early_dcx), &mut callbacks))`.
  // `raw_args` reads `env::args_os()` (= process.argv[1..]: this script's path stands for argv[0]).
  // `after_expansion` writes with `stdout.write_all` (`std_print`).
  const early_dcx = EarlyDiagCtxt.new(ErrorOutputType.default());
  const callbacks = make_callbacks({
    prefix: run_required_analyses_prefix,
    to_def_id: (def_id) => LocalDefId.to_def_id(def_id),
    with_forced_impl_filename_line: (e) => with_forced_impl_filename_line(e),
    display_Ty,
    print: std_print,
    seams: load_seams(),
  });
  return catch_with_exit_code(() => compiler_entrypoint(raw_args(early_dcx), callbacks));
}

/** A JS stack overflow (rustc: a fault on the thread's guard page). As src/rust_ts/main.ts. */
function is_stack_overflow(e: unknown): boolean {
  return e instanceof RangeError && e.message.startsWith("Maximum call stack size exceeded");
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (e) {
  if (is_stack_overflow(e)) {
    const { on_stack_overflow } = await import("../rustc_driver_impl/signal_handler.ts");
    on_stack_overflow();
  }
  if (e instanceof Unported) {
    process.stderr.write(`rust-ts: unported: ${e.what}\n`);
    process.exitCode = EXIT_UNPORTED;
  } else {
    const msg = e instanceof Panic ? e.message : String(e);
    process.stderr.write(`rust-ts: internal compiler error: ${msg}\n${e instanceof Error ? e.stack : ""}\n`);
    process.exitCode = 101;
  }
}
