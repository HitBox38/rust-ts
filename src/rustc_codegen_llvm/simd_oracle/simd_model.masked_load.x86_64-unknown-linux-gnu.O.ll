; ModuleID = 'simd_model.9afd1a81ad4d6422-cgu.0'
source_filename = "simd_model.9afd1a81ad4d6422-cgu.0"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

; Function Attrs: nonlazybind uwtable
define <4 x float> @h_masked_load_element(<4 x i32> %m, ptr noundef %p, <4 x float> %v) unnamed_addr #0 !guid !4 {
start:
  %0 = lshr <4 x i32> %m, splat (i32 31)
  %1 = trunc <4 x i32> %0 to <4 x i1>
  %_0 = call <4 x float> @llvm.masked.load.v4f32.p0(ptr align 4 %p, <4 x i1> %1, <4 x float> %v)
  ret <4 x float> %_0
}

; Function Attrs: nonlazybind uwtable
define void @h_masked_load_vector(ptr dead_on_unwind noalias nofree noundef writable sret([32 x i8]) align 32 captures(address) dereferenceable(32) %_0, <4 x i8> %m, ptr noundef %p, ptr noalias nofree noundef align 32 captures(address) dead_on_return dereferenceable(32) %v) unnamed_addr #0 !guid !5 {
start:
  %0 = load <4 x double>, ptr %v, align 32
  %1 = lshr <4 x i8> %m, splat (i8 7)
  %2 = trunc <4 x i8> %1 to <4 x i1>
  %3 = call <4 x double> @llvm.masked.load.v4f64.p0(ptr align 32 %p, <4 x i1> %2, <4 x double> %0)
  store <4 x double> %3, ptr %_0, align 32
  ret void
}

; Function Attrs: nocallback nofree nosync nounwind willreturn memory(argmem: read)
declare <4 x float> @llvm.masked.load.v4f32.p0(ptr captures(none), <4 x i1>, <4 x float>) #1

; Function Attrs: nocallback nofree nosync nounwind willreturn memory(argmem: read)
declare <4 x double> @llvm.masked.load.v4f64.p0(ptr captures(none), <4 x i1>, <4 x double>) #1

attributes #0 = { nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #1 = { nocallback nofree nosync nounwind willreturn memory(argmem: read) }

!llvm.module.flags = !{!0, !1, !2}
!llvm.ident = !{!3}

!0 = !{i32 8, !"PIC Level", i32 2}
!1 = !{i32 2, !"RtLibUseGOT", i32 1}
!2 = !{i32 7, !"uwtable", i32 2}
!3 = !{!"rustc version 1.101.0-nightly (6f5da406b 2026-10-10)"}
!4 = !{i64 -7641705114726606484}
!5 = !{i64 -1549686464386931643}
