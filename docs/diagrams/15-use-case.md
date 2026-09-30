# Use Case Diagram

> mermaid ไม่มี UML use-case diagram แบบ native — จำลองด้วย flowchart: **actor = สี่เหลี่ยมนอก
> subgraph**, **use case = stadium shape `([ ])` ในกรอบ "ระบบ E-ticket"**, เส้นทึบ = actor ใช้
> use case นั้น, เส้นประ = ความสัมพันธ์ `<<include>>`/`<<extend>>` ที่มีจริงเชิงธุรกิจเท่านั้น
> (ไม่ใส่ทุกเส้นที่เป็นไปได้) — รายชื่อ actor อ้างจาก [00-index.md](./00-index.md) ตรงๆ

## 1. ฝั่งลูกค้า + ร้านค้า

```mermaid
flowchart LR
    Customer[ลูกค้า]
    Owner[เจ้าของร้าน<br/>owner/manager]
    Staff[พนักงานร้าน<br/>staff — เชิญเข้ามา,<br/>ไม่ใช่ manager]

    subgraph Sys[ระบบ E-ticket]
        UC1(["สมัคร/เข้าสู่ระบบ (OTP)"])
        UC2(["ดูรายการ/รายละเอียดอีเวนต์<br/>(guest ก็ได้)"])
        UC3(["แลกตั๋ว"])
        UC4(["ดูตั๋วของฉัน"])
        UC5(["แสดง QR เพื่อใช้ตั๋ว"])
        UC6(["แชร์ตั๋ว / รับตั๋วที่แชร์มา"])
        UC7(["แชทกับร้านค้า"])
        UC8(["เขียนรีวิว"])
        UC9(["แจ้งปัญหา (support ticket)"])
        UC10(["แก้ไขโปรไฟล์"])

        UC11(["สมัครเป็นร้านค้า<br/>(แนบเอกสาร)"])
        UC12(["ยื่นอุทธรณ์<br/>(ถ้าถูกปฏิเสธ, ≤5 ครั้ง)"])
        UC13(["สร้าง/แก้ไข/ยกเลิกอีเวนต์"])
        UC14(["จัดการรูปภาพ/<br/>ช่วงเวลาแลกตั๋ว"])
        UC15(["จัดการสินค้า"])
        UC16(["เชิญ/ถอดพนักงาน"])
        UC17(["ดูแดชบอร์ดร้าน"])
        UC18(["ตอบแชทลูกค้า"])
        UC19(["ซื้อแพ็กเกจ / เติมโควตา"])
        UC20(["สแกน QR แลกตั๋วลูกค้า"])
        UC21(["ดูสรุปยอดที่สแกนวันนี้"])
    end

    Customer --> UC1
    Customer --> UC2
    Customer --> UC3
    Customer --> UC4
    Customer --> UC5
    Customer --> UC6
    Customer --> UC7
    Customer --> UC8
    Customer --> UC9
    Customer --> UC10

    Owner --> UC1
    Owner --> UC11
    Owner --> UC12
    Owner --> UC13
    Owner --> UC14
    Owner --> UC15
    Owner --> UC16
    Owner --> UC17
    Owner --> UC18
    Owner --> UC19
    Owner --> UC20
    Owner --> UC21

    Staff --> UC1
    Staff --> UC20
    Staff --> UC21

    UC3 -.include.-> UC1
    UC5 -.include.-> UC4
    UC8 -.extend.-> UC4
    UC6 -.extend.-> UC4
```

**หมายเหตุ**: ปัจจุบัน role "manager" มีได้แค่คนเดียวต่อร้าน (คือคนที่สร้างร้าน — ได้ role นี้อัตโนมัติ)
ยังไม่มีทาง invite เพิ่ม manager คนที่สองในระบบตอนนี้ ในไดอะแกรมนี้จึงรวม owner/manager เป็น actor เดียว `เจ้าของร้าน` ตามของจริง

## 2. ฝั่งแอดมิน + ซูเปอร์แอดมิน

```mermaid
flowchart LR
    Admin[แอดมิน]
    SuperAdmin[ซูเปอร์แอดมิน]

    subgraph Sys[ระบบ E-ticket — งานแอดมิน]
        UC30(["ตรวจอนุมัติ/ปฏิเสธ<br/>ร้านค้าที่สมัคร"])
        UC31(["ระงับ/ปลดระงับร้านค้า"])
        UC32(["ระงับ/ปลดระงับผู้ใช้"])
        UC33(["แบนอีเวนต์"])
        UC34(["จัดการคิว support ticket<br/>(claim/ตอบ/ปิดเคส)"])
        UC35(["ดูรายการอีเวนต์/<br/>ร้านค้าทั้งหมด"])
        UC36(["จัดการบัญชีแอดมิน<br/>(สร้าง/ปิดใช้งาน)"])
        UC37(["แก้ไขราคา/เงื่อนไขแพ็กเกจ"])
        UC38(["ดูแดชบอร์ด<br/>ภาพรวมระบบ"])
    end

    Admin --> UC30
    Admin --> UC31
    Admin --> UC32
    Admin --> UC33
    Admin --> UC34
    Admin --> UC35

    SuperAdmin --> UC30
    SuperAdmin --> UC31
    SuperAdmin --> UC32
    SuperAdmin --> UC33
    SuperAdmin --> UC34
    SuperAdmin --> UC35
    SuperAdmin --> UC36
    SuperAdmin --> UC37
    SuperAdmin --> UC38

    UC33 -.include.-> UC31
```

**หมายเหตุ**: `UC33 -.include.-> UC31` หมายถึง "แบนอีเวนต์" ไม่ใช่ use case แยกโดด ๆ — เกิดเป็น
ผลข้างเคียงเสมอเมื่อ "ระงับร้านค้า" (ฟังก์ชันร่วม `banEventsForShop` ใน
[02-vendor-onboarding-and-moderation.md](./02-vendor-onboarding-and-moderation.md) #4) รวมถึงเรียก
ตรงได้เองจากหน้าแอดมินต่ออีเวนต์เดียวด้วย ([04-event-lifecycle.md](./04-event-lifecycle.md) #4)
ซูเปอร์แอดมินมีสิทธิ์ทุกอย่างที่แอดมินธรรมดามี บวกเพิ่ม 3 use case ท้ายตาราง (จัดการบัญชีแอดมิน,
ราคาแพ็กเกจ, แดชบอร์ดภาพรวม)
