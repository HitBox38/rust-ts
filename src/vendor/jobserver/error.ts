// Port of jobserver =0.1.34 `src/error.rs` (the version rustc_data_structures uses at the pin).
//
// PORT: the markers are `crate-pending:`, not `crate:`, because harness/scope.json's `vendor` does not list
// jobserver yet and coverage.ts rejects a marker of an unlisted crate; only the root can add it (handoff
// docs/handoff/real-crates.md).
import { display_IoError, type IoError } from "../../std/io.ts";

/** There is no `Debug`/`source` port: only `kind` and `Display` are reached (rustc_data_structures::jobserver::initialize). */
export interface FromEnvError {
  readonly inner: FromEnvErrorInner;
}

/** Kind of an error returned from `from_env_ext` function. */
export type FromEnvErrorKind =
  /** There is no environment variable that describes jobserver to inherit. */
  | "NoEnvVar"
  /**
   * There is no jobserver in the environment variable.
   * Variables associated with Make can be used for passing data other than jobserver info.
   */
  | "NoJobserver"
  /** Cannot parse jobserver environment variable value, incorrect format. */
  | "CannotParse"
  /** Cannot open path or name from the jobserver environment variable value. */
  | "CannotOpenPath"
  /** Cannot open file descriptor from the jobserver environment variable value. */
  | "CannotOpenFd"
  /**
   * The jobserver style is a simple pipe, but at least one of the file descriptors
   * is negative, which means it is disabled for this process
   * ([GNU `make` manual: POSIX Jobserver Interaction](https://www.gnu.org/software/make/manual/make.html#POSIX-Jobserver)).
   */
  | "NegativeFd"
  /** File descriptor from the jobserver environment variable value is not a pipe. */
  | "NotAPipe"
  /** Jobserver inheritance is not supported on this platform. */
  | "Unsupported";

export type FromEnvErrorInner =
  | { readonly $: "NoEnvVar" }
  | { readonly $: "NoJobserver" }
  | { readonly $: "CannotParse"; readonly _0: string }
  | { readonly $: "CannotOpenPath"; readonly _0: string; readonly _1: IoError }
  | { readonly $: "CannotOpenFd"; readonly _0: number; readonly _1: IoError }
  | { readonly $: "NegativeFd"; readonly _0: number }
  | { readonly $: "NotAPipe"; readonly _0: number; readonly _1: IoError | undefined }
  | { readonly $: "Unsupported" };

/** Get the error kind. */
// crate-pending: jobserver-0.1.34/src/error.rs:43 kind
export function FromEnvError_kind(self: FromEnvError): FromEnvErrorKind {
  return self.inner.$;
}

// crate-pending: jobserver-0.1.34/src/error.rs:58 fmt
export function display_FromEnvError(self: FromEnvError): string {
  const inner = self.inner;
  switch (inner.$) {
    case "NoEnvVar":
      return "there is no environment variable that describes jobserver to inherit";
    case "NoJobserver":
      return "there is no `--jobserver-fds=` or `--jobserver-auth=` in the environment variable";
    case "CannotParse":
      return `cannot parse jobserver environment variable value: ${inner._0}`;
    case "CannotOpenPath":
      return `cannot open path or name ${inner._0} from the jobserver environment variable value: ${display_IoError(inner._1)}`;
    case "CannotOpenFd":
      return `cannot open file descriptor ${inner._0} from the jobserver environment variable value: ${display_IoError(inner._1)}`;
    case "NegativeFd":
      return `file descriptor ${inner._0} from the jobserver environment variable value is negative`;
    case "NotAPipe":
      return inner._1 === undefined
        ? `file descriptor ${inner._0} from the jobserver environment variable value is not a pipe`
        : `file descriptor ${inner._0} from the jobserver environment variable value is not a pipe: ${display_IoError(inner._1)}`;
    case "Unsupported":
      return "jobserver inheritance is not supported on this platform";
  }
}
