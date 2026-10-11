// Placeholder for the rustc_driver_impl port. Until the parser lands, every
// invocation is unported; the harness records this as UNPORTED, not as a failure.
import { unported } from "../std/panic.ts";

export function run_compiler(args: string[]): number {
  const unpretty = args.find((a) => a.startsWith("-Zunpretty="));
  unported(unpretty ? `rustc_driver ${unpretty}` : "rustc_driver");
}
