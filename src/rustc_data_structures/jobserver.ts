// Port of compiler/rustc_data_structures/src/jobserver.rs.
//
// PORT: rust-ts is one thread in one process (plan-m7 D11, D15): it needs no token to run and hands none out, so it
// acquires and releases nothing. No output depends on tokens. All that can be seen of the jobserver is whether
// `initialize` warns about the environment, so that part is ported in full. The client is kept only so that a second
// `initialize` in one process stays silent, as upstream's `OnceLock` does (rust-ts tests run several compilers in
// one process). `Client::new` makes no pipe and `acquire_raw` is not called: both only feed tokens to code that is
// not here, and the `expect` could fail only when the process has run out of descriptors.
import { debug_str } from "../std/fmt.ts";
import { unported } from "../std/panic.ts";
import { Client_from_env_ext, display_FromEnvError, FromEnvError_kind, type Client } from "../vendor/jobserver/lib.ts";

// We stick the jobserver client into a global and initialize it once, because there could be
// multiple compiler instances in this process, and the jobserver is per-process.
let CLIENT: Client | "new" | undefined;

/**
 * Initializes a jobserver client for the current rustc process.
 * If inheriting jobserver from the environment fails for some reason, an new jobserver owned by
 * the current rustc process will be created. If the inheritance failure reason is non-benign,
 * the passed callback will be used to report the error.
 */
// rustc: compiler/rustc_data_structures/src/jobserver.rs:15 initialize
export function initialize(_limit: number, report: (err: string) => void): void {
  if (CLIENT !== undefined) return;
  CLIENT = ((): Client | "new" => {
    // Safety: the checked client construction ensures that the jobserver file descriptors
    // (if any) are open and valid. We also try to initialize the jobserver as early as possible
    // to avoid unrelated file descriptors with matching values becoming open and valid between
    // the process start and the jobserver initialization.
    const { client, var_ } = Client_from_env_ext(true);

    if (client.$ === "Ok") return client._0;
    const error = client._0;

    const kind = FromEnvError_kind(error);
    if (!(kind === "NoEnvVar" || kind === "NoJobserver" || kind === "NegativeFd" || kind === "Unsupported")) {
      // Environment specifies jobserver, but it looks incorrect.
      // Can unwrap because `var` is `None` only when the error kind is `NoEnvVar`.
      const [name, value] = var_;
      const msg = "failed to connect to jobserver from environment variable";
      // PORT: `value` is an `OsString`; its `{:?}` (`str::lossy::Debug`) escapes a valid string as `str`'s `{:?}` does.
      report(`${msg} \`${name}=${debug_str(value)}\`: ${display_FromEnvError(error)}`);
    }

    // Create a new jobserver if there's no inherited one.
    // Acquire the single token that is always held by the rustc process.
    // This is an equivalent of the single token held by a higher level build tool while
    // running this instance of rustc. This token is never released - if we are here, then
    // rustc owns the jobserver, it is teared down when rustc exits, and there's no one to
    // return the token to.
    return "new";
  })();
}

/**
 * Returns the jobserver client previously initialized by `initialize_checked`.
 *
 * # Assumptions about holding jobserver tokens
 *
 * Rustc process must always hold a single token to avoid being permanently starved and blocked.
 * - If the jobserver is inherited from a higher level build tool, the assumption is that the tool
 *   will hold the token and not release it until the rustc process exits.
 * - If the jobserver is owned by the current rustc, the token is acquired by `default_client`.
 *
 * To avoid releasing the last token, users of the client returned by this function must ensure
 * that they never release more tokens than was previously explicitly acquired.
 * Example of a sequence that can accidentally release the last token:
 * `release_raw` -> `wait` -> `acquire_raw`.
 * To avoid situations like this use the `jobserver::Proxy` wrapper instead,
 * it will ensure that the last token is never released.
 */
// rustc: compiler/rustc_data_structures/src/jobserver.rs:69 client
export function client(): never {
  return unported("rustc_data_structures::jobserver::client (tokens: single-threaded, plan-m7 D11, D15)");
}

/**
 * A wrapper around jobserver client used for two purposes:
 * - Ensuring that the single token that must be permanently held by the rustc process
 *   cannot be accidentally released.
 * - "Token buffering", immediately acquiring freshly released tokens if necessary,
 *   without going through the real jobserver.
 */
export class Proxy {
  // rustc: compiler/rustc_data_structures/src/jobserver.rs:104 new
  static new(): never {
    return unported("rustc_data_structures::jobserver::Proxy::new (tokens: single-threaded, plan-m7 D11, D15)");
  }

  /**
   * Acquires a token, possibly using some buffered tokens as an optimization.
   * May block and wait until the token is available.
   */
  // rustc: compiler/rustc_data_structures/src/jobserver.rs:141 acquire_thread
  acquire_thread(): never {
    return unported("rustc_data_structures::jobserver::Proxy::acquire_thread (tokens: single-threaded, plan-m7 D11, D15)");
  }

  /**
   * Releases a token, possibly immediately giving it to some other thread as an optimization.
   * Makes sure that the last token is never actually released to the wrapped jobserver.
   */
  // rustc: compiler/rustc_data_structures/src/jobserver.rs:160 release_thread
  release_thread(): never {
    return unported("rustc_data_structures::jobserver::Proxy::release_thread (tokens: single-threaded, plan-m7 D11, D15)");
  }
}
