// Port of compiler/rustc_driver_impl/src/print.rs.
// `safe_print!(..)` -> `safe_print(s)`, `safe_println!(..)` -> `safe_println(s)` (the formatted string).
import "../rustc_session/options.ts"; // LOAD ORDER: see rustc_session/config.ts
import { std_print } from "../rustc_session/config.ts";
import { FatalError } from "../rustc_span/fatal_error.ts";

/** `safe_print!` */
export function safe_print(s: string): void {
  print(s);
}

/** `safe_println!` */
export function safe_println(s: string): void {
  safe_print(`${s}\n`);
}

// rustc: compiler/rustc_driver_impl/src/print.rs:16 print
export function print(args: string): void {
  try {
    std_print(args);
  } catch {
    new FatalError().raise();
  }
}
