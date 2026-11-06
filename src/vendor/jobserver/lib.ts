// Port of jobserver =0.1.34 `src/lib.rs`: `Client::from_env_ext` and `find_jobserver_auth`, what
// rustc_data_structures::jobserver::initialize reaches. See unix.ts on
// why no token is ever read or written.
import { os_string_into_string, type OsString, var_os as std_var_os } from "../../std/env.ts";
import { unported } from "../../std/panic.ts";
import type { Result } from "../../std/result.ts";
import type { FromEnvError, FromEnvErrorInner } from "./error.ts";
import { Client_open, type Client } from "./unix.ts";

export type { FromEnvError, FromEnvErrorKind } from "./error.ts";
export { display_FromEnvError, FromEnvError_kind } from "./error.ts";
export type { Client } from "./unix.ts";

/**
 * Return type for [`Client::from_env_ext`] function.
 */
export interface FromEnv {
  /**
   * Result of attempting to create a client from environment variables.
   * Contains the client if successful, or an error describing why it failed.
   */
  readonly client: Result<Client, FromEnvError>;
  /** Name and value of the environment variable. `None` if no relevant environment variable is found. */
  readonly var_: readonly [string, OsString];
}

// crate: jobserver-0.1.34/src/lib.rs:170 new_ok
function FromEnv_new_ok(client: Client, var_name: string, var_: OsString): FromEnv {
  return { client: { $: "Ok", _0: client }, var_: [var_name, var_] };
}

// crate: jobserver-0.1.34/src/lib.rs:176 new_err
function FromEnv_new_err(kind: FromEnvErrorInner, var_name: string, var_: OsString): FromEnv {
  return { client: { $: "Err", _0: { inner: kind } }, var_: [var_name, var_] };
}

/**
 * Attempts to connect to the jobserver specified in this process's
 * environment.
 */
// crate: jobserver-0.1.34/src/lib.rs:253 from_env_ext
export function Client_from_env_ext(check_pipe: boolean): FromEnv {
  let env: string | undefined;
  let var_os: OsString | undefined;
  for (const e of ["CARGO_MAKEFLAGS", "MAKEFLAGS", "MFLAGS"]) {
    const v = std_var_os(e);
    if (v !== undefined) {
      env = e;
      var_os = v;
      break;
    }
  }
  if (env === undefined || var_os === undefined) {
    return FromEnv_new_err({ $: "NoEnvVar" }, "", new Uint8Array(0));
  }

  const var_ = os_string_into_string(var_os);
  if (var_.$ === "Err") {
    return FromEnv_new_err({ $: "CannotParse", _0: "not valid UTF-8" }, env, var_os);
  }

  const s = find_jobserver_auth(var_._0);
  if (s === undefined) {
    return FromEnv_new_err({ $: "NoJobserver" }, env, var_os);
  }
  if (process.platform === "win32") return unported("jobserver::imp::Client::open (windows: named semaphore)");
  const c = Client_open(s, check_pipe);
  if (c.$ === "Ok") return FromEnv_new_ok(c._0, env, var_os);
  return FromEnv_new_err(c._0, env, var_os);
}

// crate: jobserver-0.1.34/src/lib.rs:625 find_jobserver_auth
function find_jobserver_auth(var_: string): string | undefined {
  for (const arg of ["--jobserver-auth=", "--jobserver-fds="]) {
    // `var.rsplit_once(arg)`
    const at = var_.lastIndexOf(arg);
    if (at >= 0) {
      // `s.split(' ').next()`
      return var_.slice(at + arg.length).split(" ")[0]!;
    }
  }
  return undefined;
}
