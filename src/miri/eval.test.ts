// Tests of src/miri/eval.ts (lane miri-eval): the port of eval.rs's `#[cfg(test)] mod tests` (upstream order), plus
// `MiriConfig::default()` and the remaining command-line escaping cases.
import { expect, test } from "bun:test";
import "./lib.ts";
import { args_to_utf16_command_string, MiriConfig } from "./eval.ts";
import { Panic } from "../std/panic.ts";

const utf16_lossy = (v: readonly number[]): string => String.fromCharCode(...v);

// #[should_panic(expected = "argv[0] cannot contain a doublequote (\") character")]
// rustc: src/tools/miri/src/eval.rs:683 windows_argv0_panic_on_quote
test("windows_argv0_panic_on_quote", () => {
  expect(() => args_to_utf16_command_string(['"'])).toThrow(Panic);
  expect(() => args_to_utf16_command_string(['"'])).toThrow('argv[0] cannot contain a doublequote (") character');
});

// rustc: src/tools/miri/src/eval.rs:687 windows_argv0_no_escape
test("windows_argv0_no_escape", () => {
  // Ensure that a trailing backslash in argv[0] is not escaped.
  const cmd = utf16_lossy(args_to_utf16_command_string(["C:\\Program Files\\", "arg1", "arg 2", 'arg " 3']));
  expect(cmd.replace(/\0+$/, "")).toBe('"C:\\Program Files\\" arg1 "arg 2" "arg \\" 3"');
});

test("args_to_utf16_command_string: empty, backslashes before quotes / at the end, NUL", () => {
  expect(args_to_utf16_command_string([])).toEqual([0]);
  expect(utf16_lossy(args_to_utf16_command_string(["a", ""]))).toBe('"a" ""\0');
  expect(utf16_lossy(args_to_utf16_command_string(["a", 'x\\"y z']))).toBe('"a" "x\\\\\\"y z"\0');
  expect(utf16_lossy(args_to_utf16_command_string(["a", "x y\\\\"]))).toBe('"a" "x y\\\\\\\\"\0');
  expect(utf16_lossy(args_to_utf16_command_string(["a", "\\\\x"]))).toBe('"a" \\\\x\0');
  // UTF-16 code units (a non-BMP char is a surrogate pair).
  expect(args_to_utf16_command_string(["\u{1F600}"])).toEqual([0x22, 0xd83d, 0xde00, 0x22, 0]);
  expect(() => args_to_utf16_command_string(["a", "b\0"])).toThrow("interior null in command line arguments");
});

test("MiriConfig::default (eval.rs:178)", () => {
  const c = MiriConfig.default();
  expect(c).toEqual({
    env: [],
    validation: "Shallow",
    borrow_tracker: { $: "StackedBorrows" },
    check_alignment: "Int",
    isolated_op: { $: "Reject", _0: "Abort" },
    ignore_leaks: false,
    forwarded_env_vars: [],
    set_env_vars: new Map(),
    args: [],
    current_exe: undefined,
    seed: undefined,
    tracked_pointer_tags: new Set(),
    tracked_alloc_ids: new Set(),
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
    gc_interval: 10000,
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
  });
  // Every field of the generated interface is set (a field added upstream would be missed silently otherwise).
  expect(Object.keys(c).length).toBe(38);
  // Fresh collections per call (no shared mutable defaults).
  expect(MiriConfig.default().args).not.toBe(c.args);
});
