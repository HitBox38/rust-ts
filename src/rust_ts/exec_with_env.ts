// Test-only (not a port): `execve(argv[3], argv[3..], <entries>)`, where argv[2] is a JSON array of `environ` entries with one
// char per byte. `Bun.spawn`'s `env` cannot state bytes that are not UTF-8, a repeated name, or an entry with no `=`.
import { dlopen, FFIType, ptr } from "bun:ffi";

const libc = dlopen(process.platform === "linux" ? "libc.so.6" : "libSystem.B.dylib", {
  execve: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
});
const cstr = (s: string, encoding: "latin1" | "utf8"): Uint8Array => {
  const b = Buffer.from(s, encoding);
  const out = new Uint8Array(b.length + 1);
  out.set(b);
  return out;
};
const vector = (strings: Uint8Array[]): BigUint64Array => {
  const vec = new BigUint64Array(strings.length + 1);
  strings.forEach((s, i) => {
    vec[i] = BigInt(ptr(s));
  });
  return vec;
};
const entries = (JSON.parse(process.argv[2]!) as string[]).map((e) => cstr(e, "latin1"));
const args = process.argv.slice(3).map((a) => cstr(a, "utf8"));
libc.symbols.execve(ptr(args[0]!), ptr(vector(args)), ptr(vector(entries)));
console.error(`ERROR: execve of ${process.argv[3]} failed`);
process.exit(127);
