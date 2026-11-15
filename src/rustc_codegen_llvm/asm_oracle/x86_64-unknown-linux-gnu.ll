; ModuleID = 'x64.90b9e63a3841b902-cgu.0'
source_filename = "x64.90b9e63a3841b902-cgu.0"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

@SV = global [8 x i8] c"\03\00\00\00\00\00\00\00", align 8, !guid !0
@alloc_b92f332f2918be72bb6aec00e5d66191 = private unnamed_addr constant [7 x i8] c"x64.rs\00", align 1, !guid !1
@alloc_74cceada791c3f306c55d90f03fea30b = private unnamed_addr constant <{ ptr, [16 x i8] }> <{ ptr @alloc_b92f332f2918be72bb6aec00e5d66191, [16 x i8] c"\06\00\00\00\00\00\00\00\12\00\00\00V\00\00\00" }>, align 8, !guid !2
@alloc_cb44f2fef925e32cee74204596bca5be = private unnamed_addr constant <{ ptr, [16 x i8] }> <{ ptr @alloc_b92f332f2918be72bb6aec00e5d66191, [16 x i8] c"\06\00\00\00\00\00\00\00\13\00\00\00Y\00\00\00" }>, align 8, !guid !3
@alloc_e5a07057b712dc29092b486593287131 = private unnamed_addr constant <{ ptr, [16 x i8] }> <{ ptr @alloc_b92f332f2918be72bb6aec00e5d66191, [16 x i8] c"\06\00\00\00\00\00\00\00!\00\00\00\05\00\00\00" }>, align 8, !guid !4

; core::ptr::drop_glue::<x64::D>
; Function Attrs: nonlazybind uwtable
define void @_RINvNtCsajD8mEyjPew_4core3ptr9drop_glueNtCscqnbFm6XfKo_3x641DEBD_(ptr %_1) unnamed_addr #0 !guid !9 {
start:
; call <x64::D as core::ops::drop::Drop>::drop
  call void @_RNvXCscqnbFm6XfKo_3x64NtB2_1DNtNtNtCsajD8mEyjPew_4core3ops4drop4Drop4drop(ptr %_1)
  ret void
}

; <x64::D as core::ops::drop::Drop>::drop
; Function Attrs: nonlazybind uwtable
define void @_RNvXCscqnbFm6XfKo_3x64NtB2_1DNtNtNtCsajD8mEyjPew_4core3ops4drop4Drop4drop(ptr %self) unnamed_addr #0 !guid !10 {
start:
  ret void
}

; Function Attrs: nonlazybind uwtable
define void @avx(ptr sret([32 x i8]) align 32 %_0, double %c, ptr align 32 %v) unnamed_addr #1 !guid !11 {
start:
  %r = alloca [32 x i8], align 32
  %0 = call float asm sideeffect alignstack inteldialect "vmovaps ${0:t}, ${1:x}", "=&x,x,~{dirflag},~{fpsr},~{flags},~{memory}"(double %c), !srcloc !12
  %1 = load <8 x float>, ptr %v, align 32
  %2 = call <8 x float> asm sideeffect alignstack inteldialect "vmovaps ${0:t}, ${1:t}", "=&x,x,~{dirflag},~{fpsr},~{flags},~{memory}"(<8 x float> %1), !srcloc !13
  store <8 x float> %2, ptr %r, align 32
  %3 = load <8 x float>, ptr %r, align 32
  store <8 x float> %3, ptr %_0, align 32
  ret void
}

; Function Attrs: nounwind nonlazybind uwtable
define void @helper() unnamed_addr #2 !guid !14 {
start:
  ret void
}

; Function Attrs: nonlazybind uwtable
define void @multi_line() unnamed_addr #0 !guid !15 {
start:
  call void asm sideeffect alignstack inteldialect "nop\0Anop\0Anop $$ 1", "~{dirflag},~{fpsr},~{flags},~{memory}"(), !srcloc !16
  ret void
}

; Function Attrs: noreturn nonlazybind uwtable
define void @noreturn() unnamed_addr #3 !guid !17 {
start:
  call void asm sideeffect alignstack inteldialect "ud2", "~{dirflag},~{fpsr},~{flags},~{memory}"(), !srcloc !18
  unreachable
}

; Function Attrs: nonlazybind uwtable
define i64 @reg_classes(i64 %a, i32 %b, double %c, float %d, i8 %e, i16 %h) unnamed_addr #0 !guid !19 {
start:
  %p2 = alloca [8 x i8], align 8
  %p1 = alloca [8 x i8], align 8
  %k = alloca [2 x i8], align 2
  %q = alloca [1 x i8], align 1
  %w = alloca [4 x i8], align 4
  %z = alloca [8 x i8], align 8
  %y = alloca [4 x i8], align 4
  %x = alloca [8 x i8], align 8
  store i64 %a, ptr %x, align 8
  %0 = load i64, ptr %x, align 8
  %1 = call i64 asm sideeffect alignstack inteldialect "add ${0:q}, ${2:q}", "=&r,0,r,~{dirflag},~{fpsr},~{flags},~{memory}"(i64 %0, i64 %a), !srcloc !20
  store i64 %1, ptr %x, align 8
  %2 = call i32 asm sideeffect alignstack inteldialect "mov ${0:k}, ${1:k}", "=&r,r,~{dirflag},~{fpsr},~{flags},~{memory}"(i32 %b), !srcloc !21
  store i32 %2, ptr %y, align 4
  %3 = call double asm sideeffect alignstack inteldialect "movsd ${0:x}, ${1:x}", "=&x,x,~{dirflag},~{fpsr},~{flags},~{memory}"(double %c), !srcloc !22
  store double %3, ptr %z, align 8
  %4 = call float asm sideeffect alignstack inteldialect "movss ${0:x}, ${1:x}", "=x,x,~{dirflag},~{fpsr},~{flags},~{memory}"(float %d), !srcloc !23
  store float %4, ptr %w, align 4
  %5 = call i8 asm sideeffect alignstack inteldialect "mov ${0}, ${1}", "=&q,q,~{dirflag},~{fpsr},~{flags},~{memory}"(i8 %e), !srcloc !24
  store i8 %5, ptr %q, align 1
  %6 = call i16 asm sideeffect alignstack inteldialect "mov ${0:w}, ${1:w}", "=&Q,Q,~{dirflag},~{fpsr},~{flags},~{memory}"(i16 %h), !srcloc !25
  store i16 %6, ptr %k, align 2
  %7 = call i32 asm sideeffect inteldialect "mov rax, rbx", "=&{ax},{cx}"(i64 %a) #7, !srcloc !26
  %8 = call i64 asm inteldialect "mov ${0:q}, 1", "=&r,~{dirflag},~{fpsr},~{flags}"() #8, !srcloc !27
  store i64 %8, ptr %p1, align 8
  %_14 = load i64, ptr %p1, align 8
  %9 = load i64, ptr %x, align 8
  %_15.0 = add i64 %9, %_14
  %_15.1 = icmp ult i64 %_15.0, %9
  br i1 %_15.1, label %panic, label %bb9

bb9:                                              ; preds = %start
  store i64 %_15.0, ptr %x, align 8
  %10 = call i64 asm inteldialect "mov ${0:q}, 2", "=&r,~{dirflag},~{fpsr},~{flags},~{memory}"() #9, !srcloc !28
  store i64 %10, ptr %p2, align 8
  %_17 = load i64, ptr %p2, align 8
  %11 = load i64, ptr %x, align 8
  %_18.0 = add i64 %11, %_17
  %_18.1 = icmp ult i64 %_18.0, %11
  br i1 %_18.1, label %panic1, label %bb11

panic:                                            ; preds = %start
; call core::panicking::panic_const::panic_const_add_overflow
  call void @_RNvNtNtCsajD8mEyjPew_4core9panicking11panic_const24panic_const_add_overflow(ptr align 8 @alloc_74cceada791c3f306c55d90f03fea30b) #10
  unreachable

bb11:                                             ; preds = %bb9
  store i64 %_18.0, ptr %x, align 8
  call void asm sideeffect alignstack inteldialect "nop", "~{dirflag},~{fpsr},~{flags},~{memory}"() #11, !srcloc !29
  call void asm sideeffect alignstack "nop", "~{dirflag},~{fpsr},~{flags}"() #7, !srcloc !30
  %12 = call i64 asm sideeffect alignstack inteldialect "mov ${0:q}, [${1:q}]", "=&r,r,~{dirflag},~{fpsr},~{flags},~{memory}"(ptr @SV), !srcloc !31
  store i64 %12, ptr %x, align 8
  %13 = call i32 asm sideeffect alignstack inteldialect "lea ${0:q}, [rip + ${1:c}]", "=&r,s,~{dirflag},~{fpsr},~{flags},~{memory}"(ptr @SV), !srcloc !32
  %14 = call i32 asm sideeffect alignstack inteldialect "mov ${0:q}, -3", "=&r,~{dirflag},~{fpsr},~{flags},~{memory}"(), !srcloc !33
  %15 = call { i32, i32, i32, i32, i32, i32, i32, i32, i32, float, float, float, float, float, float, float, float, float, float, float, float, float, float, float, float } asm sideeffect alignstack inteldialect "call ${25:c}", "={ax},={cx},={dx},={si},={di},={r8},={r9},={r10},={r11},={xmm0},={xmm1},={xmm2},={xmm3},={xmm4},={xmm5},={xmm6},={xmm7},={xmm8},={xmm9},={xmm10},={xmm11},={xmm12},={xmm13},={xmm14},={xmm15},s,~{xmm16},~{xmm17},~{xmm18},~{xmm19},~{xmm20},~{xmm21},~{xmm22},~{xmm23},~{xmm24},~{xmm25},~{xmm26},~{xmm27},~{xmm28},~{xmm29},~{xmm30},~{xmm31},~{k0},~{k1},~{k2},~{k3},~{k4},~{k5},~{k6},~{k7},~{st},~{st(1)},~{st(2)},~{st(3)},~{st(4)},~{st(5)},~{st(6)},~{st(7)},~{tmm0},~{tmm1},~{tmm2},~{tmm3},~{tmm4},~{tmm5},~{tmm6},~{tmm7},~{dirflag},~{fpsr},~{flags},~{memory}"(ptr @helper), !srcloc !34
  %16 = call float asm sideeffect alignstack inteldialect "", "=&{xmm0},~{xmm1},~{st},~{st(1)},~{st(2)},~{st(3)},~{st(4)},~{st(5)},~{st(6)},~{st(7)},~{k1},~{dirflag},~{fpsr},~{flags},~{memory}"(), !srcloc !35
  %_21 = load i64, ptr %x, align 8
  %17 = call i64 asm sideeffect alignstack inteldialect "mov ${0:q}, ${2:q}", "=&r,0,r,~{dirflag},~{fpsr},~{flags},~{memory}"(i64 %_21, i64 1), !srcloc !36
  %18 = load i64, ptr %x, align 8
  %19 = call i64 asm sideeffect alignstack inteldialect "mov rdx, ${1:q}", "=&{dx},r,0,~{dirflag},~{fpsr},~{flags},~{memory}"(i64 2, i64 %18), !srcloc !37
  store i64 %19, ptr %x, align 8
  %20 = call i32 asm sideeffect alignstack inteldialect "mov ${0:b}, ${1:h}", "=&Q,Q,~{dirflag},~{fpsr},~{flags},~{memory}"(i64 2), !srcloc !38
  call void asm sideeffect alignstack inteldialect "nop", "{ax},{cx},{dl},~{dirflag},~{fpsr},~{flags},~{memory}"(i32 1, i16 2, i8 3), !srcloc !39
  call void asm sideeffect alignstack inteldialect unwind "", "~{dirflag},~{fpsr},~{flags},~{memory}"(), !srcloc !40
  %_26 = load i64, ptr %x, align 8
  %_28 = load i32, ptr %y, align 4
  %_27 = zext i32 %_28 to i64
  %_29.0 = add i64 %_26, %_27
  %_29.1 = icmp ult i64 %_29.0, %_26
  br i1 %_29.1, label %panic2, label %bb24

panic1:                                           ; preds = %bb9
; call core::panicking::panic_const::panic_const_add_overflow
  call void @_RNvNtNtCsajD8mEyjPew_4core9panicking11panic_const24panic_const_add_overflow(ptr align 8 @alloc_cb44f2fef925e32cee74204596bca5be) #10
  unreachable

bb24:                                             ; preds = %bb11
  %_31 = load double, ptr %z, align 8
  %_30 = call i64 @llvm.fptoui.sat.i64.f64(double %_31)
  %_32.0 = add i64 %_29.0, %_30
  %_32.1 = icmp ult i64 %_32.0, %_29.0
  br i1 %_32.1, label %panic3, label %bb25

panic2:                                           ; preds = %bb11
; call core::panicking::panic_const::panic_const_add_overflow
  call void @_RNvNtNtCsajD8mEyjPew_4core9panicking11panic_const24panic_const_add_overflow(ptr align 8 @alloc_e5a07057b712dc29092b486593287131) #10
  unreachable

bb25:                                             ; preds = %bb24
  %_34 = load float, ptr %w, align 4
  %_33 = call i64 @llvm.fptoui.sat.i64.f32(float %_34)
  %_35.0 = add i64 %_32.0, %_33
  %_35.1 = icmp ult i64 %_35.0, %_32.0
  br i1 %_35.1, label %panic4, label %bb26

panic3:                                           ; preds = %bb24
; call core::panicking::panic_const::panic_const_add_overflow
  call void @_RNvNtNtCsajD8mEyjPew_4core9panicking11panic_const24panic_const_add_overflow(ptr align 8 @alloc_e5a07057b712dc29092b486593287131) #10
  unreachable

bb26:                                             ; preds = %bb25
  %_37 = load i8, ptr %q, align 1
  %_36 = zext i8 %_37 to i64
  %_38.0 = add i64 %_35.0, %_36
  %_38.1 = icmp ult i64 %_38.0, %_35.0
  br i1 %_38.1, label %panic5, label %bb27

panic4:                                           ; preds = %bb25
; call core::panicking::panic_const::panic_const_add_overflow
  call void @_RNvNtNtCsajD8mEyjPew_4core9panicking11panic_const24panic_const_add_overflow(ptr align 8 @alloc_e5a07057b712dc29092b486593287131) #10
  unreachable

bb27:                                             ; preds = %bb26
  %_40 = load i16, ptr %k, align 2
  %_39 = zext i16 %_40 to i64
  %_41.0 = add i64 %_38.0, %_39
  %_41.1 = icmp ult i64 %_41.0, %_38.0
  br i1 %_41.1, label %panic6, label %bb28

panic5:                                           ; preds = %bb26
; call core::panicking::panic_const::panic_const_add_overflow
  call void @_RNvNtNtCsajD8mEyjPew_4core9panicking11panic_const24panic_const_add_overflow(ptr align 8 @alloc_e5a07057b712dc29092b486593287131) #10
  unreachable

bb28:                                             ; preds = %bb27
  ret i64 %_41.0

panic6:                                           ; preds = %bb27
; call core::panicking::panic_const::panic_const_add_overflow
  call void @_RNvNtNtCsajD8mEyjPew_4core9panicking11panic_const24panic_const_add_overflow(ptr align 8 @alloc_e5a07057b712dc29092b486593287131) #10
  unreachable
}

; Function Attrs: nonlazybind uwtable
define void @unwind_call() unnamed_addr #0 !guid !41 {
start:
  call void asm sideeffect alignstack inteldialect unwind "", "~{dirflag},~{fpsr},~{flags},~{memory}"(), !srcloc !42
  ret void
}

; Function Attrs: nonlazybind uwtable
define void @unwind_invoke() unnamed_addr #0 personality ptr @rust_eh_personality !guid !43 {
start:
  %0 = alloca [16 x i8], align 8
  %_1 = alloca [0 x i8], align 1
  invoke void asm sideeffect alignstack inteldialect unwind "", "~{dirflag},~{fpsr},~{flags},~{memory}"()
          to label %bb1 unwind label %cleanup, !srcloc !44

bb3:                                              ; preds = %cleanup
; invoke core::ptr::drop_glue::<x64::D>
  invoke void @_RINvNtCsajD8mEyjPew_4core3ptr9drop_glueNtCscqnbFm6XfKo_3x641DEBD_(ptr %_1) #12
          to label %bb4 unwind label %terminate

cleanup:                                          ; preds = %start
  %1 = landingpad { ptr, i32 }
          cleanup
  %2 = extractvalue { ptr, i32 } %1, 0
  %3 = extractvalue { ptr, i32 } %1, 1
  store ptr %2, ptr %0, align 8
  %4 = getelementptr inbounds i8, ptr %0, i64 8
  store i32 %3, ptr %4, align 8
  br label %bb3

bb1:                                              ; preds = %start
; call core::ptr::drop_glue::<x64::D>
  call void @_RINvNtCsajD8mEyjPew_4core3ptr9drop_glueNtCscqnbFm6XfKo_3x641DEBD_(ptr %_1)
  ret void

terminate:                                        ; preds = %bb3
  %5 = landingpad { ptr, i32 }
          filter [0 x ptr] zeroinitializer
; call core::panicking::panic_in_cleanup
  call void @_RNvNtCsajD8mEyjPew_4core9panicking16panic_in_cleanup() #13
  unreachable

bb4:                                              ; preds = %bb3
  %6 = load ptr, ptr %0, align 8
  %7 = getelementptr inbounds i8, ptr %0, i64 8
  %8 = load i32, ptr %7, align 8
  %9 = insertvalue { ptr, i32 } poison, ptr %6, 0
  %10 = insertvalue { ptr, i32 } %9, i32 %8, 1
  resume { ptr, i32 } %10
}

; core::panicking::panic_const::panic_const_add_overflow
; Function Attrs: cold noinline noreturn nonlazybind uwtable
declare void @_RNvNtNtCsajD8mEyjPew_4core9panicking11panic_const24panic_const_add_overflow(ptr align 8) unnamed_addr #4

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.fptoui.sat.i64.f64(double) #5

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.fptoui.sat.i64.f32(float) #5

; Function Attrs: nounwind nonlazybind uwtable
declare i32 @rust_eh_personality(i32, i32, i64, ptr, ptr) unnamed_addr #2

; core::panicking::panic_in_cleanup
; Function Attrs: cold minsize noinline noreturn nounwind nonlazybind optsize uwtable
declare void @_RNvNtCsajD8mEyjPew_4core9panicking16panic_in_cleanup() unnamed_addr #6

attributes #0 = { nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #1 = { nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" "target-features"="+avx,+sse,+sse2,+sse3,+sse4.1,+sse4.2,+crc32,+ssse3" }
attributes #2 = { nounwind nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #3 = { noreturn nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #4 = { cold noinline noreturn nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #5 = { nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #6 = { cold minsize noinline noreturn nounwind nonlazybind optsize uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #7 = { memory(inaccessiblemem: readwrite) }
attributes #8 = { willreturn memory(none) }
attributes #9 = { willreturn memory(read) }
attributes #10 = { noreturn }
attributes #11 = { memory(read, inaccessiblemem: readwrite) }
attributes #12 = { cold }
attributes #13 = { cold noreturn nounwind }

!llvm.module.flags = !{!5, !6, !7}
!llvm.ident = !{!8}

!0 = !{i64 7462440121104761555}
!1 = !{i64 3148579454861043733}
!2 = !{i64 -7854163131939731755}
!3 = !{i64 -8567414137417558199}
!4 = !{i64 -3499209753723767185}
!5 = !{i32 8, !"PIC Level", i32 2}
!6 = !{i32 2, !"RtLibUseGOT", i32 1}
!7 = !{i32 7, !"uwtable", i32 2}
!8 = !{!"rustc version 1.101.0-nightly (6f5da406b 2026-10-10)"}
!9 = !{i64 8423282774511839783}
!10 = !{i64 -5110795454145009597}
!11 = !{i64 2350678775044011379}
!12 = !{i64 10501195041149}
!13 = !{i64 10746008177078}
!14 = !{i64 -5349029530527406595}
!15 = !{i64 -8581185880840515592}
!16 = !{i64 0, i64 9629316679871, i64 9659381450950, i64 9706626091213}
!17 = !{i64 -1629280274659692993}
!18 = !{i64 12253541698338}
!19 = !{i64 -661382045581839584}
!20 = !{i64 3053721748155}
!21 = !{i64 3307124818674}
!22 = !{i64 3543348020011}
!23 = !{i64 3813930959722}
!24 = !{i64 4093103834029}
!25 = !{i64 4380866642924}
!26 = !{i64 4651449582639}
!27 = !{i64 5123895985311}
!28 = !{i64 5527622911229}
!29 = !{i64 5858335393105}
!30 = !{i64 6030134084985}
!31 = !{i64 6287832122794}
!32 = !{i64 6601364735469}
!33 = !{i64 6816113100327}
!34 = !{i64 7035156432478}
!35 = !{i64 7241314862742}
!36 = !{i64 7683696494321}
!37 = !{i64 7954279434032}
!38 = !{i64 8229157341036}
!39 = !{i64 8473970476978}
!40 = !{i64 8744553416692}
!41 = !{i64 6412824117330435609}
!42 = !{i64 11416023075426}
!43 = !{i64 -5490334316663632464}
!44 = !{i64 11854109739720}
