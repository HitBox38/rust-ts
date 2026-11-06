// `bug!` in a test (not a port). Inside `run_compiler`, as upstream, `bug!` prints its message through the `tcx` and panics with a bare
// `ExplicitBug`, so `toThrow` has no message to read. Under this, it panics with its message, as it does with no `tcx`.
import { EMIT_BUG_DIAGNOSTIC } from "../rustc_span/macros.ts";

export function plain_bug<T>(f: () => T): T {
  const old = EMIT_BUG_DIAGNOSTIC.f;
  EMIT_BUG_DIAGNOSTIC.f = () => false;
  try {
    return f();
  } finally {
    EMIT_BUG_DIAGNOSTIC.f = old;
  }
}
