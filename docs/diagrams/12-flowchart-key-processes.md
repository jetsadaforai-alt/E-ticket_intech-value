# Flowchart — 3 กระบวนการหลัก (มุมมอง decision flow)

> สรุปมาจาก sequence diagram เดิม ([02](./02-vendor-onboarding-and-moderation.md),
> [04](./04-event-lifecycle.md), [05](./05-ticket-lifecycle-and-redemption.md)) แต่เปลี่ยนมุมมอง:
> sequence diagram เน้น "ใครส่ง message อะไรให้ใคร", ไฟล์นี้เน้น "ตัดสินใจอะไรบ้าง แต่ละกิ่งไปจบที่ไหน"
> — เหมาะเอาไปคุยเรื่อง UX/error handling กับทีมที่ไม่ได้อ่านโค้ด

## 1. สร้างอีเวนต์ (มุมมองร้านค้า)

```mermaid
flowchart TD
    Start([เริ่ม: ร้านค้ากรอกฟอร์มสร้างอีเวนต์]) --> Form[กรอก title, description, category,
    เวลาเริ่ม/จบ, จำนวนตั๋ว, ส่วนลด, สินค้าที่ผูก, ช่วงเวลาแลกตั๋ว]
    Form --> ChkAuth{มีสิทธิ์ manager/owner<br/>ของร้านนี้ไหม}
    ChkAuth -- ไม่มีสิทธิ์/ร้านถูกระงับ --> ErrAuth[403 FORBIDDEN /<br/>VENDOR_SUSPENDED]
    ErrAuth --> EndFail1([จบ — ไม่สำเร็จ])

    ChkAuth -- มีสิทธิ์ --> ChkFields{ทุกช่องถูกต้องไหม<br/>title/description/category/<br/>เวลา/จำนวนตั๋ว/ส่วนลด}
    ChkFields -- ไม่ถูกต้อง --> ErrField[400 error เฉพาะช่อง<br/>เช่น INVALID_TITLE, INVALID_QTY]
    ErrField --> FixForm[กลับไปแก้ไขข้อมูลในฟอร์ม]
    FixForm --> Form

    ChkFields -- ถูกต้องหมด --> ChkProduct{สินค้าที่ผูก (ถ้ามี)<br/>มีจริงและยัง active ไหม}
    ChkProduct -- ไม่พบ/archive --> ErrProduct[400 PRODUCT_NOT_FOUND /<br/>PRODUCT_ARCHIVED]
    ErrProduct --> FixForm

    ChkProduct -- ผ่าน (หรือไม่ผูกเลย) --> ChkWindow{ช่วงเวลาแลกตั๋ว (ถ้าส่งมา)<br/>สมเหตุสมผลไหม}
    ChkWindow -- ไม่สมเหตุสมผล --> ErrWindow[400 error ช่วงเวลา เช่น<br/>VALID_UNTIL_AFTER_EVENT_END]
    ErrWindow --> FixForm

    ChkWindow -- ผ่าน --> Tx[["เข้า transaction เดียว:<br/>สร้าง Event + TicketBatch + ผูกสินค้า"]]
    Tx --> ChkQuota{หักโควตาสำเร็จไหม<br/>UPDATE ticket_balance/event_balance}
    ChkQuota -- เกิน cap แพ็กเกจ --> ErrCap[400 EXCEEDS_TICKET_CAP<br/>พร้อม cap ปัจจุบัน/จำนวนที่ขอ]
    ErrCap --> OptCap[ทางเลือก: ลดจำนวนตั๋ว<br/>หรือซื้อ ticket top-up ก่อน]
    OptCap --> Form

    ChkQuota -- โควตาไม่พอ --> ErrQuota[409 INSUFFICIENT_QUOTA<br/>พร้อมจำนวนที่มี/ต้องการ]
    ErrQuota --> OptQuota[ทางเลือก: ซื้อแพ็กเกจ<br/>หรือเติมโควตาก่อน]
    OptQuota --> Form

    ChkQuota -- โควตาพอ --> Create[สร้างตั๋วทุกใบล่วงหน้า<br/>สถานะ AVAILABLE ทั้งหมด<br/>+ บันทึก QuotaLedger]
    Create --> EndOk([จบ — สำเร็จ:<br/>อีเวนต์พร้อมขาย])
```

## 2. แลกตั๋ว (ลูกค้า) → สแกน QR (พนักงาน)

```mermaid
flowchart TD
    Start([ลูกค้าเปิดดูอีเวนต์ — guest เข้าได้เลย]) --> Claim{กด "แลกตั๋ว"}
    Claim -- ยังไม่ login --> Login[ให้ login/สมัครก่อน — OTP]
    Login --> Claim

    Claim -- login แล้ว --> ChkActive{อีเวนต์ยัง active<br/>และยังไม่หมดเวลาไหม}
    ChkActive -- ไม่ (จบ/ยกเลิก/แบน) --> ErrActive[404/409<br/>EVENT_NOT_AVAILABLE / EVENT_ENDED]
    ErrActive --> EndFail1([จบ])

    ChkActive -- ยังได้ --> ChkDup{เคยมีตั๋วอีเวนต์นี้<br/>อยู่แล้วไหม}
    ChkDup -- มีแล้ว --> ErrDup[409 ALREADY_HAS_TICKET]
    ErrDup --> EndFail1

    ChkDup -- ยังไม่มี --> ChkStock{ตั๋วเหลือไหม<br/>remaining_count > 0}
    ChkStock -- หมด --> ErrStock[409 SOLD_OUT]
    ErrStock --> EndFail1

    ChkStock -- เหลือ --> Issue[หักตั๋ว 1 ใบแบบ atomic<br/>+ ออกตั๋วสถานะ ISSUED ให้ลูกค้า]
    Issue --> ShowQR[ลูกค้าเปิดหน้าตั๋ว<br/>กด "แสดง QR" ตอนจะไปใช้จริง]
    ShowQR --> ChkTicketOk{ตั๋วยังสถานะ ISSUED ไหม}
    ChkTicketOk -- ไม่ใช่ (แลกไปแล้ว/ถูกยกเลิก) --> ErrRedeemable1[409 TICKET_NOT_REDEEMABLE]
    ErrRedeemable1 --> EndFail1

    ChkTicketOk -- ใช่ --> GenQR[สร้าง QR token ใน Redis<br/>อายุ 60 วินาที]
    GenQR --> Scan[ลูกค้ายื่นมือถือให้พนักงานสแกน]
    Scan --> ChkMember{พนักงานเป็นสมาชิก<br/>ร้านนี้จริงไหม}
    ChkMember -- ไม่ใช่ --> ErrMember[403 FORBIDDEN /<br/>409 SHOP_SUSPENDED]
    ErrMember --> EndFail1

    ChkMember -- ใช่ --> ChkExpire{QR token ยังไม่หมดอายุไหม<br/>ภายใน 60 วินาที}
    ChkExpire -- หมดอายุ --> ErrExpire[400 QR_EXPIRED —<br/>ลูกค้าต้องกดสร้าง QR ใหม่]
    ErrExpire --> ShowQR

    ChkExpire -- ยังไม่หมด --> ChkAll{ตั๋ว ISSUED,<br/>อีเวนต์ active/ยังไม่หมดเวลา,<br/>อยู่ในช่วงเวลาแลกที่กำหนดไหม}
    ChkAll -- ไม่ผ่านข้อใดข้อหนึ่ง --> ErrAll[409 เช่น OUTSIDE_REDEMPTION_WINDOW /<br/>EVENT_ENDED / EVENT_BANNED]
    ErrAll --> EndFail1

    ChkAll -- ผ่านทุกเงื่อนไข --> Redeem[อัปเดตตั๋ว → REDEEMED แบบ atomic<br/>กันสแกนซ้ำพร้อมกัน<br/>+ บันทึก Redemption]
    Redeem --> EndOk([จบ — สำเร็จ:<br/>แจ้ง "แลกสำเร็จ" ให้ลูกค้า])
```

## 3. สมัครร้านค้า → อนุมัติ/ปฏิเสธ → อุทธรณ์

```mermaid
flowchart TD
    Start([ผู้ใช้ login แล้ว<br/>กด "สมัครเป็นร้านค้า"]) --> Form[กรอกชื่อร้าน<br/>+ แนบเอกสารยืนยันตัวตน สูงสุด 3 ไฟล์]
    Form --> ChkExist{มี vendor อยู่แล้วไหม<br/>เคยสมัครมาก่อน}
    ChkExist -- มีแล้ว --> ErrExist[409 ALREADY_HAS_VENDOR]
    ErrExist --> EndFail1([จบ])

    ChkExist -- ยังไม่มี --> ChkFile{ไฟล์ที่แนบถูกชนิด/<br/>ขนาด ≤5MB ไหม}
    ChkFile -- ไม่ผ่าน --> ErrFile[400 INVALID_FILE_TYPE /<br/>FILE_TOO_LARGE]
    ErrFile --> Form

    ChkFile -- ผ่าน --> Pending[สร้าง Vendor<br/>สถานะ pending รอตรวจ]
    Pending --> Review{แอดมินตรวจเอกสาร}
    Review -- อนุมัติ --> Approved[สร้าง VendorQuota<br/>จากแพ็กเกจ free อัตโนมัติ<br/>+ แจ้งเจ้าของร้าน]
    Approved --> EndOk([สร้างร้าน (shop) ได้แล้ว<br/>→ ดูโฟลว์ร้านค้าใน 03-shop-and-staff.md])

    Review -- ปฏิเสธ --> Rejected[แจ้งเจ้าของร้าน พร้อมเหตุผล]
    Rejected --> WantAppeal{ยื่นอุทธรณ์ไหม}
    WantAppeal -- ไม่ยื่น --> EndFail2([จบ — ไม่ผ่าน])
    WantAppeal -- ยื่น --> ChkAppealCap{ยื่นอุทธรณ์<br/>ครบ 5 ครั้งแล้วหรือยัง}
    ChkAppealCap -- ครบแล้ว --> ErrAppeal[429 APPEAL_LIMIT_REACHED]
    ErrAppeal --> EndFail2

    ChkAppealCap -- ยังไม่ครบ --> Reappeal[กลับไปสถานะ pending<br/>appeal_count += 1]
    Reappeal --> Review
```
