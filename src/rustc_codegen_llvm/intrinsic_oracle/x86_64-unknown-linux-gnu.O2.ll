; ModuleID = 'intr.a2894034b021e23-cgu.0'
source_filename = "intr.a2894034b021e23-cgu.0"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

; Function Attrs: noreturn nonlazybind uwtable
define void @f_abort() unnamed_addr #0 !guid !4 {
start:
  call void @llvm.trap()
  unreachable
}

; Function Attrs: nonlazybind uwtable
define { i32, i1 } @f_addo(i32 noundef %a, i32 noundef %b) unnamed_addr #1 !guid !5 {
start:
  %0 = call { i32, i1 } @llvm.sadd.with.overflow.i32(i32 %a, i32 %b)
  %_0.0 = extractvalue { i32, i1 } %0, 0
  %_0.1 = extractvalue { i32, i1 } %0, 1
  %1 = insertvalue { i32, i1 } poison, i32 %_0.0, 0
  %2 = insertvalue { i32, i1 } %1, i1 %_0.1, 1
  ret { i32, i1 } %2
}

; Function Attrs: nonlazybind uwtable
define void @f_assume(i1 noundef zeroext %x) unnamed_addr #1 !guid !6 {
start:
  call void @llvm.assume(i1 %x)
  ret void
}

; Function Attrs: nonlazybind uwtable
define noundef i32 @f_bb(i32 noundef %x) unnamed_addr #1 !guid !7 {
start:
  %_0 = alloca [4 x i8], align 4
  store i32 %x, ptr %_0, align 4
  call void asm sideeffect "", "r,~{memory}"(ptr %_0), !srcloc !8
  %0 = load i32, ptr %_0, align 4, !noundef !9
  ret i32 %0
}

; Function Attrs: nonlazybind uwtable
define noundef i32 @f_bswap(i32 noundef %x) unnamed_addr #1 !guid !10 {
start:
  %_0 = call i32 @llvm.bswap.i32(i32 %x)
  ret i32 %_0
}

; Function Attrs: nonlazybind uwtable
define noundef i8 @f_bswap8(i8 noundef %x) unnamed_addr #1 !guid !11 {
start:
  ret i8 %x
}

; Function Attrs: nonlazybind uwtable
define noundef i32 @f_cmpb(ptr noundef %a, ptr noundef %b, i64 noundef %n) unnamed_addr #1 !guid !12 {
start:
  %_0 = call i32 @memcmp(ptr %a, ptr %b, i64 %n)
  ret i32 %_0
}

; Function Attrs: nonlazybind uwtable
define noundef i32 @f_ctlz(i64 noundef %x) unnamed_addr #1 !guid !13 {
start:
  %0 = call i64 @llvm.ctlz.i64(i64 %x, i1 false)
  %_0 = trunc i64 %0 to i32
  ret i32 %_0
}

; Function Attrs: nonlazybind uwtable
define noundef i32 @f_ctpop(i32 noundef %x) unnamed_addr #1 !guid !14 {
start:
  %_0 = call i32 @llvm.ctpop.i32(i32 %x)
  ret i32 %_0
}

; Function Attrs: nonlazybind uwtable
define noundef i32 @f_cttz_nz(i16 noundef %x) unnamed_addr #1 !guid !15 {
start:
  %0 = call i16 @llvm.cttz.i16(i16 %x, i1 true)
  %_0 = zext i16 %0 to i32
  ret i32 %_0
}

; Function Attrs: nonlazybind uwtable
define noundef float @f_fma(float noundef %a, float noundef %b, float noundef %c) unnamed_addr #1 !guid !16 {
start:
  %_0 = call float @llvm.fma.f32(float %a, float %b, float %c)
  ret float %_0
}

; Function Attrs: nonlazybind uwtable
define noundef i64 @f_llvm_ctpop(i64 noundef %x) unnamed_addr #1 !guid !17 {
start:
  %_0 = call i64 @llvm.ctpop.i64(i64 %x)
  ret i64 %_0
}

; Function Attrs: nonlazybind uwtable
define void @f_llvm_debugtrap() unnamed_addr #1 !guid !18 {
start:
  call void @llvm.debugtrap()
  ret void
}

; Function Attrs: nonlazybind uwtable
define noundef float @f_powi(float noundef %x, i32 noundef %n) unnamed_addr #1 !guid !19 {
start:
  %_0 = call float @llvm.powi.f32.i32(float %x, i32 %n)
  ret float %_0
}

; Function Attrs: nonlazybind uwtable
define noundef ptr @f_ptrmask(ptr noundef %p, i64 noundef %m) unnamed_addr #1 !guid !20 {
start:
  %_0 = call ptr @llvm.ptrmask.p0.i64(ptr %p, i64 %m)
  ret ptr %_0
}

; Function Attrs: nonlazybind uwtable
define noundef i16 @f_sat(i16 noundef %a, i16 noundef %b) unnamed_addr #1 !guid !21 {
start:
  %_0 = call i16 @llvm.sadd.sat.i16(i16 %a, i16 %b)
  ret i16 %_0
}

; Function Attrs: nonlazybind uwtable
define noundef double @f_sqrt(double noundef %x) unnamed_addr #1 !guid !22 {
start:
  %_0 = call double @llvm.sqrt.f64(double %x)
  ret double %_0
}

; Function Attrs: nonlazybind uwtable
define noundef zeroext i1 @f_try(ptr noundef nonnull %f, ptr noundef %d, ptr noundef nonnull %c) unnamed_addr #1 !guid !23 {
start:
  %_0 = call i1 @__rust_try(ptr %f, ptr %d, ptr %c)
  ret i1 %_0
}

; Function Attrs: nonlazybind uwtable
define noundef i32 @f_vload(ptr noundef %p) unnamed_addr #1 !guid !24 {
start:
  %_0 = load volatile i32, ptr %p, align 4
  ret i32 %_0
}

; Function Attrs: nonlazybind uwtable
define { i32, i64 } @f_vload_pair(ptr noundef %p) unnamed_addr #1 !guid !25 {
start:
  %0 = alloca [16 x i8], align 8
  %1 = load volatile i128, ptr %p, align 8
  store i128 %1, ptr %0, align 8
  %_0.0 = load i32, ptr %0, align 8, !noundef !9
  %2 = getelementptr inbounds i8, ptr %0, i64 8
  %_0.1 = load i64, ptr %2, align 8, !noundef !9
  %3 = insertvalue { i32, i64 } poison, i32 %_0.0, 0
  %4 = insertvalue { i32, i64 } %3, i64 %_0.1, 1
  ret { i32, i64 } %4
}

; Function Attrs: cold noreturn nounwind memory(inaccessiblemem: write)
declare void @llvm.trap() #2

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare { i32, i1 } @llvm.sadd.with.overflow.i32(i32, i32) #3

; Function Attrs: nocallback nofree nosync nounwind willreturn memory(inaccessiblemem: write)
declare void @llvm.assume(i1 noundef) #4

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i32 @llvm.bswap.i32(i32) #3

; Function Attrs: nonlazybind
declare i32 @memcmp(ptr, ptr, i64) #5

; Function Attrs: nocallback nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.ctlz.i64(i64, i1 immarg) #6

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i32 @llvm.ctpop.i32(i32) #3

; Function Attrs: nocallback nofree nosync nounwind speculatable willreturn memory(none)
declare i16 @llvm.cttz.i16(i16, i1 immarg) #6

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare float @llvm.fma.f32(float, float, float) #3

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.ctpop.i64(i64) unnamed_addr #3

; Function Attrs: nounwind
declare void @llvm.debugtrap() #7

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare float @llvm.powi.f32.i32(float, i32) #3

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare ptr @llvm.ptrmask.p0.i64(ptr, i64) #3

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i16 @llvm.sadd.sat.i16(i16, i16) #3

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare double @llvm.sqrt.f64(double) #3

; Function Attrs: nonlazybind
define internal noundef zeroext i1 @__rust_try(ptr noundef nonnull %0, ptr noundef %1, ptr noundef nonnull %2) unnamed_addr #8 personality ptr @rust_eh_personality !guid !26 {
entry-block:
  invoke void %0(ptr %1)
          to label %then unwind label %catch

then:                                             ; preds = %entry-block
  ret i1 false

catch:                                            ; preds = %entry-block
  %3 = landingpad { ptr, i32 }
          catch ptr null
  %4 = extractvalue { ptr, i32 } %3, 0
  call void %2(ptr %1, ptr %4)
  ret i1 true
}

; Function Attrs: nonlazybind
declare i32 @rust_eh_personality(...) unnamed_addr #8

attributes #0 = { noreturn nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #1 = { nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #2 = { cold noreturn nounwind memory(inaccessiblemem: write) }
attributes #3 = { nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #4 = { nocallback nofree nosync nounwind willreturn memory(inaccessiblemem: write) }
attributes #5 = { nonlazybind }
attributes #6 = { nocallback nofree nosync nounwind speculatable willreturn memory(none) }
attributes #7 = { nounwind }
attributes #8 = { nonlazybind "target-cpu"="x86-64" }

!llvm.module.flags = !{!0, !1, !2}
!llvm.ident = !{!3}

!0 = !{i32 8, !"PIC Level", i32 2}
!1 = !{i32 2, !"RtLibUseGOT", i32 1}
!2 = !{i32 7, !"uwtable", i32 2}
!3 = !{!"rustc version 1.101.0-nightly (6f5da406b 2026-10-10)"}
!4 = !{i64 3693115837667671021}
!5 = !{i64 7394811567942758740}
!6 = !{i64 -8700673333483748055}
!7 = !{i64 -4852977713429098318}
!8 = !{i64 14194866916573}
!9 = !{}
!10 = !{i64 -5630183091445833024}
!11 = !{i64 -7379831813994661546}
!12 = !{i64 6665386117485185703}
!13 = !{i64 -4742940665710139230}
!14 = !{i64 -8379397012658980789}
!15 = !{i64 -3751731963804844765}
!16 = !{i64 3960330842903717437}
!17 = !{i64 -6513312829245729000}
!18 = !{i64 6198205770731327807}
!19 = !{i64 -4573545754990623581}
!20 = !{i64 4254937369125937808}
!21 = !{i64 2442890567641380688}
!22 = !{i64 3674611095012811951}
!23 = !{i64 -1847792516009749550}
!24 = !{i64 290995462320296696}
!25 = !{i64 5344341353679819641}
!26 = !{i64 1287446545889248266}
