; ModuleID = 'simd_model.9afd1a81ad4d6422-cgu.0'
source_filename = "simd_model.9afd1a81ad4d6422-cgu.0"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

; Function Attrs: nonlazybind uwtable
define noundef float @h_reduce_add_ordered_f32(<4 x float> %a, float noundef %acc) unnamed_addr #0 !guid !4 {
start:
  %_0 = call float @llvm.vector.reduce.fadd.v4f32(float %acc, <4 x float> %a)
  ret float %_0
}

; Function Attrs: nonlazybind uwtable
define noundef float @h_reduce_add_unordered_f32(<4 x float> %a) unnamed_addr #0 !guid !5 {
start:
  %_0 = call reassoc float @llvm.vector.reduce.fadd.v4f32(float -0.000000e+00, <4 x float> %a)
  ret float %_0
}

; Function Attrs: nonlazybind uwtable
define noundef double @h_reduce_mul_ordered_f64(ptr noalias nofree noundef align 32 captures(address) dead_on_return dereferenceable(32) %a, double noundef %acc) unnamed_addr #0 !guid !6 {
start:
  %0 = load <4 x double>, ptr %a, align 32
  %_0 = call double @llvm.vector.reduce.fmul.v4f64(double %acc, <4 x double> %0)
  ret double %_0
}

; Function Attrs: nonlazybind uwtable
define noundef double @h_reduce_mul_unordered_f64(ptr noalias nofree noundef align 32 captures(address) dead_on_return dereferenceable(32) %a) unnamed_addr #0 !guid !7 {
start:
  %0 = load <4 x double>, ptr %a, align 32
  %_0 = call reassoc double @llvm.vector.reduce.fmul.v4f64(double 1.000000e+00, <4 x double> %0)
  ret double %_0
}

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare float @llvm.vector.reduce.fadd.v4f32(float, <4 x float>) #1

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare double @llvm.vector.reduce.fmul.v4f64(double, <4 x double>) #1

attributes #0 = { nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #1 = { nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }

!llvm.module.flags = !{!0, !1, !2}
!llvm.ident = !{!3}

!0 = !{i32 8, !"PIC Level", i32 2}
!1 = !{i32 2, !"RtLibUseGOT", i32 1}
!2 = !{i32 7, !"uwtable", i32 2}
!3 = !{!"rustc version 1.101.0-nightly (6f5da406b 2026-10-10)"}
!4 = !{i64 -689770156837795027}
!5 = !{i64 817560391547635547}
!6 = !{i64 -6765104303720424978}
!7 = !{i64 -3147090347563644989}
