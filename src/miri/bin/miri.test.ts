// Unit tests of the Miri driver's argv parsing (src/miri/bin/miri.ts, lane miri-driver). Not an upstream port.
//
// `main()` runs in-process with two not-yet-ported dependencies mocked: bin/log/setup.rs's loggers (lane miri-log; no-ops
// here, as the release oracle's are with no `MIRI_LOG`) and `MiriConfig::default()` (eval.rs:178, lane miri-eval; built
// below from the upstream listing and installed through the driver's pending hook). Each case's stderr and exit status are compared with the oracle Miri's (the isolated
// toolchain, `miri <flag>` with no input file, recorded below; exit 1 for every one).
import { expect, mock, test } from "bun:test";
import { set_args_os } from "../../std/env.ts";
import { FxHashMap, FxHashSet, String_key, usize_key } from "../../rust_ts/hash_map.ts";
import type { MiriConfig } from "../eval.ts";

/** eval.rs:178 `impl Default for MiriConfig` (test data until lane miri-eval lands). */
function default_config(): MiriConfig {
  return {
    env: [],
    validation: "Shallow",
    borrow_tracker: { $: "StackedBorrows" },
    check_alignment: "Int",
    isolated_op: { $: "Reject", _0: "Abort" },
    ignore_leaks: false,
    forwarded_env_vars: [],
    set_env_vars: FxHashMap.default<string, string>(String_key, { size: 24, align: 8 }),
    args: [],
    current_exe: undefined,
    seed: undefined,
    tracked_pointer_tags: FxHashSet.default(usize_key) as never,
    tracked_alloc_ids: FxHashSet.default(usize_key) as never,
    track_alloc_accesses: false,
    data_race_detector: true,
    weak_memory_emulation: true,
    genmc_config: undefined,
    track_outdated_loads: false,
    cmpxchg_weak_failure_rate: 0.8,
    measureme_out: undefined,
    backtrace_style: "Short",
    provenance_mode: "Default",
    mute_stdout_stderr: false,
    preemption_rate: 0.01,
    report_progress: undefined,
    native_lib: [],
    native_lib_enable_tracing: false,
    gc_interval: 10_000,
    num_cpus: 1,
    page_size: undefined,
    collect_leak_backtraces: true,
    address_reuse_rate: 0.5,
    address_reuse_cross_thread_rate: 0.1,
    fixed_scheduling: false,
    float_nondet: true,
    float_rounding_error: "Random",
    short_fd_operations: true,
    user_relevant_crates: [],
  };
}

let last_config: MiriConfig | undefined;
mock.module("./log/setup.ts", () => ({
  init_early_loggers: () => {},
  init_late_loggers: () => {},
  deinit_loggers: () => {},
}));
const { main, MiriExit, PENDING_MIRI_CONFIG_DEFAULT } = await import("./miri.ts");
PENDING_MIRI_CONFIG_DEFAULT.f = () => {
  last_config = default_config();
  return last_config;
};

const enc = new TextEncoder();

/** Runs `miri <args>` in-process: [stderr, exit status, the parsed config]. */
function run(args: string[]): [string, number, MiriConfig] {
  set_args_os(["miri", ...args].map((a) => enc.encode(a)));
  last_config = undefined;
  let err = "";
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array): boolean => {
    err += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    return true;
  }) as typeof process.stderr.write;
  let code: number;
  try {
    code = main();
  } catch (e) {
    if (!(e instanceof MiriExit)) throw e;
    code = e.code;
  } finally {
    process.stderr.write = orig;
  }
  return [err, code, last_config!];
}

// The oracle Miri's stderr for `miri <flag>` (exit 1).
const ORACLE: [string[], string][] = [
  [["-Zmiri-seed=abc"], "fatal error: -Zmiri-seed must be an integer that fits into u64\n"],
  [["-Zmiri-seed=18446744073709551616"], "fatal error: -Zmiri-seed must be an integer that fits into u64\n"],
  [["-Zmiri-track-pointer-tag=1,x"], "fatal error: -Zmiri-track-pointer-tag requires a comma separated list of valid `u64` arguments: invalid digit found in string\n"],
  [["-Zmiri-track-pointer-tag=0"], "fatal error: -Zmiri-track-pointer-tag requires nonzero arguments\n"],
  [["-Zmiri-track-pointer-tag="], "fatal error: -Zmiri-track-pointer-tag requires a comma separated list of valid `u64` arguments: cannot parse integer from empty string\n"],
  [["-Zmiri-seed=+5", "-Zmiri-track-pointer-tag=99999999999999999999"], "fatal error: -Zmiri-track-pointer-tag requires a comma separated list of valid `u64` arguments: number too large to fit in target type\n"],
  [["-Zmiri-track-alloc-id=0"], "fatal error: -Zmiri-track-alloc-id requires a comma separated list of valid non-zero `u64` arguments: number would be zero for non-zero type\n"],
  [["-Zmiri-track-alloc-id=5,99999999999999999999"], "fatal error: -Zmiri-track-alloc-id requires a comma separated list of valid non-zero `u64` arguments: number too large to fit in target type\n"],
  [["-Zmiri-address-reuse-rate=1.5"], "fatal error: -Zmiri-address-reuse-rate must be between `0.0` and `1.0`\n"],
  [["-Zmiri-address-reuse-rate=abc"], "fatal error: -Zmiri-address-reuse-rate requires a `f64` between `0.0` and `1.0`\n"],
  [["-Zmiri-address-reuse-rate=inf"], "fatal error: -Zmiri-address-reuse-rate must be between `0.0` and `1.0`\n"],
  [["-Zmiri-address-reuse-rate=0x1"], "fatal error: -Zmiri-address-reuse-rate requires a `f64` between `0.0` and `1.0`\n"],
  [["-Zmiri-address-reuse-rate="], "fatal error: -Zmiri-address-reuse-rate requires a `f64` between `0.0` and `1.0`\n"],
  [["-Zmiri-preemption-rate=nan"], "fatal error: -Zmiri-preemption-rate must be between `0.0` and `1.0`\n"],
  [["-Zmiri-preemption-rate=.5e1"], "fatal error: -Zmiri-preemption-rate must be between `0.0` and `1.0`\n"],
  [["-Zmiri-report-progress=-1"], "fatal error: -Zmiri-report-progress requires a `u32`: invalid digit found in string\n"],
  [["-Zmiri-provenance-gc=4294967296"], "fatal error: -Zmiri-provenance-gc requires a `u32`: number too large to fit in target type\n"],
  [["-Zmiri-backtrace=2"], "fatal error: -Zmiri-backtrace may only be 0, 1, or full\n"],
  [["-Zmiri-isolation-error=foo"], "fatal error: -Zmiri-isolation-error must be `abort`, `hide`, `warn`, or `warn-nobacktrace`\n"],
  [["-Zmiri-env-set=FOO"], "fatal error: -Zmiri-env-set requires an argument of the form <name>=<value>\n"],
  [["-Zmiri-many-seeds=5"], "fatal error: -Zmiri-many-seeds requires a range in the form `from..to` or `..to`: expected `from..to`\n"],
  [["-Zmiri-many-seeds=a..5"], "fatal error: -Zmiri-many-seeds requires a range in the form `from..to` or `..to`: invalid `from`\n"],
  [["-Zmiri-many-seeds=..x"], "fatal error: -Zmiri-many-seeds requires a range in the form `from..to` or `..to`: invalid `to`\n"],
  [["-Zmiri-num-cpus=x"], "fatal error: -Zmiri-num-cpus requires a `u32`: invalid digit found in string\n"],
  [["-Zmiri-force-page-size=3"], "fatal error: -Zmiri-force-page-size requires a power of 2: 3\n"],
  [["-Zmiri-force-page-size=x"], "fatal error: -Zmiri-force-page-size requires a `u64`: invalid digit found in string\n"],
  [["-Zmiri-native-lib=/nonexistent/x.so"], "fatal error: -Zmiri-native-lib `/nonexistent/x.so` does not exist\n"],
  [["-Zmiri-tree-borrows-implicit-writes"], "fatal error: `-Zmiri-tree-borrows` is required before `-Zmiri-tree-borrows-implicit-writes`\n"],
  [["-Zmiri-tree-borrows-no-precise-interior-mut"], "fatal error: `-Zmiri-tree-borrows` is required before `-Zmiri-tree-borrows-no-precise-interior-mut`\n"],
  [["-Zmiri-seed=1", "-Zmiri-many-seeds"], "fatal error: Only one of `-Zmiri-seed` and `-Zmiri-many-seeds can be set\n"],
  [["-Zmiri-strict-provenance", "-Zmiri-native-lib=/tmp"], "fatal error: strict provenance is not compatible with calling native functions\n"],
];

test("bad flags: stderr and exit status equal the oracle Miri's", () => {
  for (const [args, expected] of ORACLE) {
    const [err, code] = run(args);
    expect([args, err, code]).toEqual([args, expected, 1]);
  }
});

test("flag values reach MiriConfig (every flag kind)", () => {
  // Every case below stops at rustc's "error: no input filename given" (exit 1, as the oracle does), after parsing; the
  // config is inspected. (rustc's diagnostics go to fd 2 through the emitter, not `process.stderr.write`: not captured.)
  const parse = (args: string[]): MiriConfig => {
    const [err, code, cfg] = run(args);
    expect(err).toBe("");
    expect(code).toBe(1);
    return cfg;
  };
  let c = parse(["-Zmiri-disable-validation", "-Zmiri-tree-borrows"]);
  expect(c.validation).toBe("No");
  expect(c.borrow_tracker).toBeUndefined(); // disabling validation disables aliasing checks
  c = parse(["-Zmiri-tree-borrows", "-Zmiri-tree-borrows-no-precise-interior-mut", "-Zmiri-tree-borrows-implicit-writes"]);
  expect(c.borrow_tracker).toEqual({ $: "TreeBorrows", _0: { precise_interior_mut: false, implicit_writes: true } });
  c = parse(["-Zmiri-disable-data-race-detector", "-Zmiri-symbolic-alignment-check", "-Zmiri-isolation-error=warn-nobacktrace"]);
  expect([c.data_race_detector, c.weak_memory_emulation, c.check_alignment, c.isolated_op]).toEqual([
    false,
    false,
    "Symbolic",
    { $: "Reject", _0: "WarningWithoutBacktrace" },
  ]);
  c = parse(["-Zmiri-seed=+18446744073709551615", "-Zmiri-address-reuse-rate=1.", "-Zmiri-preemption-rate=+0", "-Zmiri-backtrace=full"]);
  expect([c.seed, c.address_reuse_rate, c.preemption_rate, c.backtrace_style]).toEqual([18446744073709551615n, 1, 0, "Full"]);
  c = parse(["-Zmiri-track-pointer-tag=3,18446744073709551615,7", "-Zmiri-track-alloc-id=9", "-Zmiri-env-set=A=b=c", "-Zmiri-env-forward=X"]);
  expect([...c.tracked_pointer_tags].sort((a, b) => a - b)).toEqual([3, 7] as never); // the u64::MAX tag can never be created (C4 amendment)
  expect([...c.tracked_alloc_ids]).toEqual([9] as never);
  expect([...c.set_env_vars]).toEqual([["A", "b=c"]]);
  expect(c.forwarded_env_vars).toEqual(["X"]);
  c = parse(["-Zmiri-force-page-size=64", "-Zmiri-report-progress", "-Zmiri-provenance-gc=0", "-Zmiri-user-relevant-crates=a,b", "-Zmiri-deterministic-concurrency"]);
  expect([c.page_size, c.report_progress, c.gc_interval, c.user_relevant_crates, c.fixed_scheduling, c.address_reuse_cross_thread_rate]).toEqual([
    65536n,
    1_000_000,
    0,
    ["a", "b"],
    true,
    0,
  ]);
  c = parse(["--", "-Zmiri-seed=abc", "x"]);
  expect(c.args).toEqual(["-Zmiri-seed=abc", "x"]); // after `--`: program arguments, not parsed
});

test("-Zmiri-retag-fields warns and continues; -Zmiri-genmc / -Zmiri-num-cpus stop at their pending dependencies", () => {
  const [err, code] = run(["-Zmiri-retag-fields"]);
  // The oracle's stderr starts with this, then rustc's "error: no input filename given" (not captured here, see above).
  expect(err).toBe(
    "warning: `-Zmiri-retag-fields` is a NOP and will be removed in a future version of Miri.\nField retagging has been on-by-default for a long time.\n",
  );
  expect(code).toBe(1);
  // The oracle: "fatal error: GenMC is not supported on this target" (dummy.rs:226, lane miri-threads) and
  // "fatal error: -Zmiri-num-cpus must be in the range 1..=1024" (MAX_CPUS, lane miri-shims-b).
  expect(() => run(["-Zmiri-genmc"])).toThrow("genmc");
  expect(() => run(["-Zmiri-num-cpus=0"])).toThrow("MAX_CPUS");
});
