// Test scaffold of lane miri-x86-a (not a port): the port's `miri` binary with extra target features.
//
// The port's driver stops `unported` on `-C target-feature` (src/rust_ts/codegen_backend.ts: LLVM's feature computation
// has no stand-in yet), so a program that needs SSE3 or later cannot run through the ordinary entry. This entry adds the
// comma-separated features of `$X86_PROBE_FEATURES` to what `target_config` reports, standing in for the oracle's
// `-C target-feature=+..`. Only `Session::internal_target_features` changes; the rest is src/miri/bin/miri.ts's entry glue.
// `.mts`, not `.ts`: src/miri/contract.test.ts requires every `.ts` module under src/miri to mirror an upstream file.
import { main, MiriExit } from "../../../bin/miri.ts";
import { LlvmCodegenBackend } from "../../../../rust_ts/codegen_backend.ts";
import { ensure_stack } from "../../../../rust_ts/stack.ts";
import { FatalErrorMarker } from "../../../../rustc_span/fatal_error.ts";
import { Symbol } from "../../../../rustc_span/symbol.ts";
import { Panic, Unported } from "../../../../std/panic.ts";
import { write_stderr } from "../../../../std/io.ts";

const extra = (process.env.X86_PROBE_FEATURES ?? "").split(",").filter((f) => f !== "");
const target_config = LlvmCodegenBackend.prototype.target_config;
LlvmCodegenBackend.prototype.target_config = function (this: LlvmCodegenBackend, sess) {
  const config = target_config.call(this, sess);
  for (const f of extra) config.internal_target_features.add(Symbol.intern(f));
  return config;
};

ensure_stack();
try {
  process.exitCode = main();
} catch (e) {
  if (e instanceof MiriExit) {
    process.exitCode = e.code;
  } else if (e instanceof Unported) {
    write_stderr(`rust-ts: unported: ${e.what}\n`);
    process.exitCode = 70;
  } else if (e instanceof FatalErrorMarker) {
    process.exitCode = 101;
  } else {
    const msg = e instanceof Panic ? e.message : String(e);
    write_stderr(`rust-ts: internal compiler error: ${msg}\n${e instanceof Error ? e.stack : ""}\n`);
    process.exitCode = 101;
  }
}
