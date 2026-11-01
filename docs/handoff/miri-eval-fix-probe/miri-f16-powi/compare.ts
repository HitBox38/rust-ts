// Compares real Miri's output of powih.rs (stdout) with the port's f16 host_powi and with a per-step-f16 model.
// Usage: bun docs/handoff/miri-eval-fix-probe/miri-f16-powi/compare.ts <powih.miri.txt>

import "../../../../src/miri/lib.ts";
import { HostFloatOperation_Half } from "../../../../src/miri/math.ts";
import { Half, Double } from "../../../../src/vendor/rustc_apfloat/ieee.ts";
import { readFileSync } from "node:fs";
const lines = readFileSync(process.argv[2], "utf8").trim().split("\n");
const exps = [3, -3, 2, 5, -7, 11];
const dv = new DataView(new ArrayBuffer(8));
const toH = (x: number) => { dv.setFloat64(0, x); return Double.from_bits(dv.getBigUint64(0)).convert(Half, { value: false }).value; };
const toD = (h: any) => { dv.setBigUint64(0, h.convert(Double, { value: false }).value.to_bits()); return dv.getFloat64(0); };
const r16 = (x: number) => toD(toH(x));
function powi16(a: number, b: number) { const recip = b < 0; let p = Math.abs(b); let m = 1; for (;;) { if (p & 1) m = r16(m * a); p >>>= 1; if (!p) break; a = r16(a * a); } return recip ? r16(1 / m) : m; }
for (let k = 0; k * 65536 < lines.length; k++) {
  const n = exps[k]; let port = 0, f16step = 0;
  for (let b = 0; b < 65536; b++) {
    const want = parseInt(lines[k * 65536 + b], 16);
    const x = Half.from_bits(BigInt(b));
    if (n === 0) continue;
    const p = HostFloatOperation_Half.host_powi(x, n);
    const pb = p.is_nan() ? 0x7e00 : Number(p.to_bits());
    if (pb !== want) port++;
    const q = toH(powi16(toD(x), n));
    const qb = q.is_nan() ? 0x7e00 : Number(q.to_bits());
    if (qb !== want) f16step++;
  }
  console.log(`n=${n}: port (f32 steps, __powisf2) mismatches ${port}; per-step-f16 model mismatches ${f16step}`);
}
