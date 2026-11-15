; ModuleID = 'simd_model.9afd1a81ad4d6422-cgu.0'
source_filename = "simd_model.9afd1a81ad4d6422-cgu.0"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

; Function Attrs: nonlazybind uwtable
define <4 x float> @h_gather(<4 x float> %v, ptr noalias nofree noundef align 32 captures(address) dead_on_return dereferenceable(32) %p, <4 x i32> %m) unnamed_addr #0 !guid !4 {
start:
  %0 = load <4 x ptr>, ptr %p, align 32
  %1 = lshr <4 x i32> %m, splat (i32 31)
  %2 = trunc <4 x i32> %1 to <4 x i1>
  %_0 = call <4 x float> @llvm.masked.gather.v4f32.v4p0(<4 x ptr> align 4 %0, <4 x i1> %2, <4 x float> %v)
  ret <4 x float> %_0
}

; Function Attrs: nonlazybind uwtable
define <4 x float> @h_masked_load_element(<4 x i32> %m, ptr noundef %p, <4 x float> %v) unnamed_addr #0 !guid !5 {
start:
  %0 = lshr <4 x i32> %m, splat (i32 31)
  %1 = trunc <4 x i32> %0 to <4 x i1>
  %_0 = call <4 x float> @llvm.masked.load.v4f32.p0(ptr align 4 %p, <4 x i1> %1, <4 x float> %v)
  ret <4 x float> %_0
}

; Function Attrs: nonlazybind uwtable
define void @h_masked_load_vector(ptr dead_on_unwind noalias nofree noundef writable sret([32 x i8]) align 32 captures(address) dereferenceable(32) %_0, <4 x i8> %m, ptr noundef %p, ptr noalias nofree noundef align 32 captures(address) dead_on_return dereferenceable(32) %v) unnamed_addr #0 !guid !6 {
start:
  %0 = load <4 x double>, ptr %v, align 32
  %1 = lshr <4 x i8> %m, splat (i8 7)
  %2 = trunc <4 x i8> %1 to <4 x i1>
  %3 = call <4 x double> @llvm.masked.load.v4f64.p0(ptr align 32 %p, <4 x i1> %2, <4 x double> %0)
  store <4 x double> %3, ptr %_0, align 32
  ret void
}

; Function Attrs: nonlazybind uwtable
define void @h_masked_store_unaligned(<4 x i32> %m, ptr noundef %p, <4 x float> %v) unnamed_addr #0 !guid !7 {
start:
  %0 = lshr <4 x i32> %m, splat (i32 31)
  %1 = trunc <4 x i32> %0 to <4 x i1>
  call void @llvm.masked.store.v4f32.p0(<4 x float> %v, ptr align 1 %p, <4 x i1> %1)
  ret void
}

; Function Attrs: nonlazybind uwtable
define noundef float @h_reduce_add_ordered_f32(<4 x float> %a, float noundef %acc) unnamed_addr #0 !guid !8 {
start:
  %_0 = call float @llvm.vector.reduce.fadd.v4f32(float %acc, <4 x float> %a)
  ret float %_0
}

; Function Attrs: nonlazybind uwtable
define noundef float @h_reduce_add_unordered_f32(<4 x float> %a) unnamed_addr #0 !guid !9 {
start:
  %_0 = call reassoc float @llvm.vector.reduce.fadd.v4f32(float -0.000000e+00, <4 x float> %a)
  ret float %_0
}

; Function Attrs: nonlazybind uwtable
define noundef double @h_reduce_mul_ordered_f64(ptr noalias nofree noundef align 32 captures(address) dead_on_return dereferenceable(32) %a, double noundef %acc) unnamed_addr #0 !guid !10 {
start:
  %0 = load <4 x double>, ptr %a, align 32
  %_0 = call double @llvm.vector.reduce.fmul.v4f64(double %acc, <4 x double> %0)
  ret double %_0
}

; Function Attrs: nonlazybind uwtable
define noundef double @h_reduce_mul_unordered_f64(ptr noalias nofree noundef align 32 captures(address) dead_on_return dereferenceable(32) %a) unnamed_addr #0 !guid !11 {
start:
  %0 = load <4 x double>, ptr %a, align 32
  %_0 = call reassoc double @llvm.vector.reduce.fmul.v4f64(double 1.000000e+00, <4 x double> %0)
  ret double %_0
}

; Function Attrs: nonlazybind uwtable
define void @h_scatter(<4 x float> %v, ptr noalias nofree noundef align 32 captures(address) dead_on_return dereferenceable(32) %p, <4 x i8> %m) unnamed_addr #0 !guid !12 {
start:
  %0 = load <4 x ptr>, ptr %p, align 32
  %1 = lshr <4 x i8> %m, splat (i8 7)
  %2 = trunc <4 x i8> %1 to <4 x i1>
  call void @llvm.masked.scatter.v4f32.v4p0(<4 x float> %v, <4 x ptr> align 4 %0, <4 x i1> %2)
  ret void
}

; Function Attrs: nocallback nofree nosync nounwind willreturn memory(read)
declare <4 x float> @llvm.masked.gather.v4f32.v4p0(<4 x ptr>, <4 x i1>, <4 x float>) #1

; Function Attrs: nocallback nofree nosync nounwind willreturn memory(argmem: read)
declare <4 x float> @llvm.masked.load.v4f32.p0(ptr captures(none), <4 x i1>, <4 x float>) #2

; Function Attrs: nocallback nofree nosync nounwind willreturn memory(argmem: read)
declare <4 x double> @llvm.masked.load.v4f64.p0(ptr captures(none), <4 x i1>, <4 x double>) #2

; Function Attrs: nocallback nofree nosync nounwind willreturn memory(argmem: write)
declare void @llvm.masked.store.v4f32.p0(<4 x float>, ptr captures(none), <4 x i1>) #3

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare float @llvm.vector.reduce.fadd.v4f32(float, <4 x float>) #4

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare double @llvm.vector.reduce.fmul.v4f64(double, <4 x double>) #4

; Function Attrs: nocallback nofree nosync nounwind willreturn memory(write)
declare void @llvm.masked.scatter.v4f32.v4p0(<4 x float>, <4 x ptr>, <4 x i1>) #5

attributes #0 = { nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #1 = { nocallback nofree nosync nounwind willreturn memory(read) }
attributes #2 = { nocallback nofree nosync nounwind willreturn memory(argmem: read) }
attributes #3 = { nocallback nofree nosync nounwind willreturn memory(argmem: write) }
attributes #4 = { nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #5 = { nocallback nofree nosync nounwind willreturn memory(write) }

!llvm.module.flags = !{!0, !1, !2}
!llvm.ident = !{!3}

!0 = !{i32 8, !"PIC Level", i32 2}
!1 = !{i32 2, !"RtLibUseGOT", i32 1}
!2 = !{i32 7, !"uwtable", i32 2}
!3 = !{!"rustc version 1.101.0-nightly (6f5da406b 2026-10-10)"}
!4 = !{i64 -2043006629207528245}
!5 = !{i64 -7641705114726606484}
!6 = !{i64 -1549686464386931643}
!7 = !{i64 -7961606330674262668}
!8 = !{i64 -689770156837795027}
!9 = !{i64 817560391547635547}
!10 = !{i64 -6765104303720424978}
!11 = !{i64 -3147090347563644989}
!12 = !{i64 1985760788327436281}
