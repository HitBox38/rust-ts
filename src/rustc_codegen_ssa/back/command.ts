//! A thin wrapper around `Command` in the standard library which allows us to
//! read the arguments that are built up.
//
// Port of compiler/rustc_codegen_ssa/src/back/command.rs (lane ssa-linker, wave 40q).
//
// PORT:
// - `OsString`/`OsStr` arguments, environment names and values are JS strings (the port's paths are strings): their bytes are
//   their UTF-8 encoding wherever upstream reads `as_encoded_bytes()`.
// - The struct's fields `args`, `env`, `env_remove` and `env_clear` share their names with methods, which one TS class cannot
//   hold; they are `f_args`, `f_env`, `f_env_remove` and `f_env_clear`.
// - `std::process::Command` (what `command()` returns) is `ProcessCommand` below: the unix `sys::process::Command` fields this
//   file sets (program, argv, `CommandEnv`), its `Debug` (what `--print link-args` prints) and `output()`. The process
//   primitive is `Bun.spawnSync`, as the port's other tool runs (`rust_ts/llvm/tools.ts`, plan-m7 D15). Windows hosts stop.
import { dlopen, FFIType } from "bun:ffi";
// The crate root first: `rustc_target/spec/mod.ts` and `spec/json.ts` import each other (the order `rustc_target/lib.ts` sets up).
import "../../rustc_target/lib.ts";
import { type LldFlavor, LldFlavor as LldFlavorC } from "../../rustc_target/spec/mod.ts";
import { escape_char } from "../../std/fmt.ts";
import { io_error_from_node, type IoResult } from "../../std/io.ts";
import { unported } from "../../std/panic.ts";
import { Err, Ok } from "../../std/result.ts";
import { utf8_len } from "../../std/str.ts";

const encoder = new TextEncoder();

// #[derive(Clone)]
type Program = { $: "Normal"; _0: string } | { $: "CmdBatScript"; _0: string } | { $: "Lld"; _0: string; _1: LldFlavor };

// #[derive(Clone)]
export class Command {
  constructor(
    public program: Program,
    public f_args: string[],
    public f_env: [string, string][],
    public f_env_remove: string[],
    public f_env_clear: boolean,
  ) {}

  /** `#[derive(Clone)]` */
  clone(): Command {
    return new Command(this.program, [...this.f_args], this.f_env.map(([k, v]) => [k, v]), [...this.f_env_remove], this.f_env_clear);
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/command.rs:27 new
  static new(program: string): Command {
    return Command._new({ $: "Normal", _0: program });
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/command.rs:31 bat_script
  static bat_script(program: string): Command {
    return Command._new({ $: "CmdBatScript", _0: program });
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/command.rs:35 lld
  static lld(program: string, flavor: LldFlavor): Command {
    return Command._new({ $: "Lld", _0: program, _1: flavor });
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/command.rs:39 _new
  static _new(program: Program): Command {
    return new Command(program, [], [], [], false);
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/command.rs:49 arg
  arg(arg: string): Command {
    this._arg(arg);
    return this;
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/command.rs:54 args
  args(args: Iterable<string>): Command {
    for (const arg of args) {
      this._arg(arg);
    }
    return this;
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/command.rs:64 _arg
  _arg(arg: string): void {
    this.f_args.push(arg);
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/command.rs:68 env
  env(key: string, value: string): Command {
    this._env(key, value);
    return this;
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/command.rs:77 _env
  _env(key: string, value: string): void {
    this.f_env.push([key, value]);
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/command.rs:81 env_remove
  env_remove(key: string): Command {
    this._env_remove(key);
    return this;
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/command.rs:89 env_clear
  env_clear(): Command {
    this.f_env_clear = true;
    return this;
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/command.rs:94 _env_remove
  _env_remove(key: string): void {
    this.f_env_remove.push(key);
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/command.rs:98 output
  output(): IoResult<Output> {
    return this.command().output();
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/command.rs:102 command
  command(): ProcessCommand {
    let ret: ProcessCommand;
    switch (this.program.$) {
      case "Normal":
        ret = ProcessCommand.new(this.program._0);
        break;
      case "CmdBatScript": {
        const c = ProcessCommand.new("cmd");
        c.arg("/c").arg(this.program._0);
        ret = c;
        break;
      }
      case "Lld": {
        const c = ProcessCommand.new(this.program._0);
        c.arg("-flavor").arg(LldFlavorC.desc(this.program._1));
        ret = c;
        break;
      }
    }
    ret.args(this.f_args);
    ret.envs(this.f_env.map(([k, v]) => [k, v] as [string, string]));
    for (const k of this.f_env_remove) {
      ret.env_remove(k);
    }
    if (this.f_env_clear) {
      ret.env_clear();
    }
    return ret;
  }

  // extensions

  // rustc: compiler/rustc_codegen_ssa/src/back/command.rs:129 get_args
  get_args(): readonly string[] {
    return this.f_args;
  }

  // rustc: compiler/rustc_codegen_ssa/src/back/command.rs:133 take_args
  take_args(): string[] {
    const args = this.f_args;
    this.f_args = [];
    return args;
  }

  /// Returns a `true` if we're pretty sure that this'll blow OS spawn limits,
  /// or `false` if we should attempt to spawn and see what the OS says.
  // rustc: compiler/rustc_codegen_ssa/src/back/command.rs:139 very_likely_to_exceed_some_spawn_limit
  very_likely_to_exceed_some_spawn_limit(): boolean {
    // PORT: `cfg(windows)` (the 6k estimate) is a Windows host, which stops; `cfg(not(any(windows, unix)))` is none of ours.
    if (process.platform === "win32") return unported("rustc_codegen_ssa::back::command::Command::very_likely_to_exceed_some_spawn_limit (Windows host)");

    // On Unix the limits can be gargantuan anyway so we're pretty
    // unlikely to hit them, but might still exceed it.
    // We consult ARG_MAX here to get an estimate.
    {
      // PORT: `mem::size_of::<usize>()` of the 64-bit hosts the port runs on.
      const ptr_size = 8;
      // arg + \0 + pointer
      const args_size = this.f_args.reduce((acc, a) => {
        const arg = utf8_len(a);
        const nul = 1;
        return acc + arg + nul + ptr_size;
      }, 0);
      // key + `=` + value + \0 + pointer
      const envs_size = this.f_env.reduce((acc, [k_, v_]) => {
        const k = utf8_len(k_);
        const eq = 1;
        const v = utf8_len(v_);
        const nul = 1;
        return acc + k + eq + v + nul + ptr_size;
      }, 0);
      const max = sysconf_arg_max();
      if (max === -1) return false; // Go to OS anyway.
      const arg_max = max;
      return args_size + envs_size > arg_max;
    }
  }
}

// impl fmt::Debug for Command
// rustc: compiler/rustc_codegen_ssa/src/back/command.rs:210 fmt
export function debug_Command(self: Command): string {
  return self.command().debug();
}

// ---- std::process (unix) -------------------------------------------------------------------------------------------

/** `libc::_SC_ARG_MAX` of the pinned libc-0.2.189: `src/unix/bsd/apple/mod.rs:3063` (1), `src/unix/linux_like/linux_l4re_shared.rs:479` (0). */
const SC_ARG_MAX = process.platform === "linux" ? 0 : 1;
let SYSCONF: ((name: number) => number) | undefined;
/** `unsafe { libc::sysconf(libc::_SC_ARG_MAX) }`. PORT: a new primitive (`bun:ffi` on the host libc), as `std/env.ts` opens it for
 *  `_SC_GETPW_R_SIZE_MAX`; src/std exports no `sysconf`. */
function sysconf_arg_max(): number {
  if (SYSCONF === undefined) {
    const lib = dlopen(process.platform === "linux" ? "libc.so.6" : "libSystem.B.dylib", { sysconf: { args: [FFIType.i32], returns: FFIType.i64_fast } });
    SYSCONF = (name) => Number(lib.symbols.sysconf(name));
  }
  return SYSCONF(SC_ARG_MAX);
}

/** Byte order of two names as `OsString`s (`EnvKey` on unix is the `OsString`, ordered by its bytes). */
function os_cmp(a: string, b: string): number {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return x.length - y.length;
}

/** `sys::process::env::CommandEnv { clear, saw_path, vars: BTreeMap<EnvKey, Option<OsString>> }`. PORT: the map is kept sorted by key
 *  (an array of entries), which is the `BTreeMap`'s iteration order. */
class CommandEnv {
  clear = false;
  saw_path = false;
  vars: [string, string | undefined][] = [];

  private insert(key: string, value: string | undefined): void {
    let i = 0;
    while (i < this.vars.length && os_cmp(this.vars[i]![0], key) < 0) i++;
    if (i < this.vars.length && this.vars[i]![0] === key) this.vars[i] = [key, value];
    else this.vars.splice(i, 0, [key, value]);
  }

  // after std: library/std/src/sys/process/env.rs:50 set
  set(key: string, value: string): void {
    this.maybe_saw_path(key);
    this.insert(key, value);
  }

  // after std: library/std/src/sys/process/env.rs:56 remove
  remove(key: string): void {
    this.maybe_saw_path(key);
    if (this.clear) {
      const i = this.vars.findIndex(([k]) => k === key);
      if (i >= 0) this.vars.splice(i, 1);
    } else {
      this.insert(key, undefined);
    }
  }

  // after std: library/std/src/sys/process/env.rs:66 clear
  do_clear(): void {
    this.clear = true;
    this.vars = [];
  }

  // after std: library/std/src/sys/process/env.rs:79 maybe_saw_path
  maybe_saw_path(key: string): void {
    if (!this.saw_path && key === "PATH") {
      this.saw_path = true;
    }
  }
}

/** `<ByteStr as Debug>::fmt` (library/core/src/bstr/mod.rs:157), what `<CStr as Debug>` prints, of a string's UTF-8 bytes. */
function debug_cstr(s: string): string {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c === 0) out += "\\0";
    else if (c <= 0x7f) out += escape_ascii(c);
    else out += escape_char(c, true, true);
  }
  return out + '"';
}

/** `u8::escape_ascii` (library/core/src/escape.rs `escape_ascii_into`). */
function escape_ascii(b: number): string {
  switch (b) {
    case 0x09:
      return "\\t";
    case 0x0d:
      return "\\r";
    case 0x0a:
      return "\\n";
    case 0x5c:
      return "\\\\";
    case 0x27:
      return "\\'";
    case 0x22:
      return '\\"';
  }
  if (b >= 0x20 && b < 0x7f) return String.fromCharCode(b);
  return "\\x" + b.toString(16).padStart(2, "0");
}

/** `<OsStr as Debug>` (unix): `str` Debug of the valid chunks. The port's values are strings, so always valid UTF-8. */
function debug_os_str(s: string): string {
  let out = '"';
  for (const ch of s) out += escape_char(ch.codePointAt(0)!, false, true);
  return out + '"';
}

/** `std::process::Output` */
export interface Output {
  status: ExitStatus;
  stdout: Uint8Array;
  stderr: Uint8Array;
}

/** `std::process::ExitStatus` on unix: a wait status. PORT: built from `Bun.spawnSync`'s exit code (`code << 8`) or signal number;
 *  Bun does not say whether a core was dumped, so that bit is never set. */
export class ExitStatus {
  constructor(public _0: number) {}

  // after std: library/std/src/sys/process/unix/unix.rs:1121 code (`WIFEXITED` / `WEXITSTATUS`)
  code(): number | undefined {
    return (this._0 & 0x7f) === 0 ? (this._0 >> 8) & 0xff : undefined;
  }

  /** `ExitStatus::success`: `self.code() == Some(0)` (via `exit_ok`). */
  success(): boolean {
    return this.code() === 0;
  }

  /** `ExitStatusExt::signal` (`WIFSIGNALED` / `WTERMSIG`). */
  signal(): number | undefined {
    const sig = this._0 & 0x7f;
    return sig !== 0 && sig !== 0x7f ? sig : undefined;
  }
}

/** `<ExitStatus as Display>` (library/std/src/sys/process/unix/unix.rs:1256), for the exited case; a signal stops (the name table,
 *  `signal_string`, is not ported yet). */
export function display_ExitStatus(self: ExitStatus): string {
  const code = self.code();
  if (code !== undefined) return `exit status: ${code}`;
  return unported("std::sys::process::unix::ExitStatus Display of a signal (signal_string)");
}

/** `std::process::Command` on unix (library/std/src/sys/process/unix/common.rs): program, argv and environment changes. */
export class ProcessCommand {
  constructor(
    public program: string,
    public argv: string[],
    public env: CommandEnv,
  ) {}

  // after std: library/std/src/sys/process/unix/common.rs:165 new
  static new(program: string): ProcessCommand {
    return new ProcessCommand(program, [program], new CommandEnv());
  }

  arg(arg: string): ProcessCommand {
    this.argv.push(arg);
    return this;
  }

  args(args: Iterable<string>): ProcessCommand {
    for (const a of args) this.argv.push(a);
    return this;
  }

  envs(vars: Iterable<[string, string]>): ProcessCommand {
    for (const [k, v] of vars) this.env.set(k, v);
    return this;
  }

  env_remove(key: string): ProcessCommand {
    this.env.remove(key);
    return this;
  }

  env_clear(): ProcessCommand {
    this.env.do_clear();
    return this;
  }

  /** `Command::get_args`: the arguments after the program. */
  get_args(): readonly string[] {
    return this.argv.slice(1);
  }

  /** `Command::get_envs`: the explicit changes, in key order (`None` for a removal). */
  get_envs(): readonly [string, string | undefined][] {
    return this.env.vars;
  }

  /** The non-alternate `<Command as Debug>::fmt` (library/std/src/sys/process/unix/common.rs:496). No `cwd` is ever set here. */
  debug(): string {
    let f = "";
    if (this.env.clear) {
      f += "env -i ";
      // Altered env vars will be printed next, that should exactly work as expected.
    } else {
      // Removed env vars need the command to be wrapped in `env`.
      let any_removed = false;
      for (const [key, value_opt] of this.get_envs()) {
        if (value_opt === undefined) {
          if (!any_removed) {
            f += "env ";
            any_removed = true;
          }
          f += `-u ${key} `;
        }
      }
    }
    // Altered env vars can just be added in front of the program.
    for (const [key, value_opt] of this.get_envs()) {
      if (value_opt !== undefined) {
        f += `${key}=${debug_os_str(value_opt)} `;
      }
    }
    if (this.program !== this.argv[0]) {
      f += `[${debug_cstr(this.program)}] `;
    }
    f += debug_cstr(this.argv[0]!);
    for (const arg of this.get_args()) {
      f += ` ${debug_cstr(arg)}`;
    }
    return f;
  }

  /** `Command::output`: runs the program with piped stdout and stderr and waits for it. PORT: `Bun.spawnSync`; the inherited
   *  environment is Bun's `process.env`. A spawn error is the `io::Error` of its errno. */
  output(): IoResult<Output> {
    if (process.platform === "win32") return unported("std::process::Command::output (Windows host)");
    const env: Record<string, string> = {};
    if (!this.env.clear) {
      for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    }
    for (const [k, v] of this.env.vars) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
    let r: { exitCode: number | null; signalCode?: string | number | null; stdout?: Uint8Array; stderr?: Uint8Array };
    try {
      r = Bun.spawnSync(this.argv, { env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    } catch (e) {
      return Err(io_error_from_node(e));
    }
    let status: number;
    if (r.exitCode !== null) status = (r.exitCode & 0xff) << 8;
    else {
      const { constants } = require("node:os") as typeof import("node:os");
      const signo = typeof r.signalCode === "number" ? r.signalCode : (constants.signals as Record<string, number>)[String(r.signalCode)];
      if (signo === undefined) return unported(`std::process::Command::output (a child ended by an unknown signal: ${String(r.signalCode)})`);
      status = signo;
    }
    return Ok({ status: new ExitStatus(status), stdout: new Uint8Array(r.stdout ?? []), stderr: new Uint8Array(r.stderr ?? []) });
  }
}
