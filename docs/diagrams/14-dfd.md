# Context Diagram + Data Flow Diagram (DFD)

> สัญลักษณ์ DFD มาตรฐาน (Gane-Sarson) จำลองด้วย mermaid flowchart: **external entity = สี่เหลี่ยม
> `[ ]`**, **process = วงกลม `(( ))`**, **data store = cylinder `[( )]`** — จัดกลุ่ม data store
> ตามกลุ่มความสามารถ ไม่ใช่ตารางเดียว ๆ (ตัวเต็มดู ERD [13-erd.md](./13-erd.md))

## Context Diagram (Level 0)

```mermaid
flowchart TD
    Customer[ลูกค้า]
    Vendor[ร้านค้า: owner/manager/staff]
    Admin[แอดมิน]
    SuperAdmin[ซูเปอร์แอดมิน]
    PaymentSvc[ผู้ให้บริการชำระเงิน]
    SmsSvc[ผู้ให้บริการ SMS — ยังเป็นระบบจำลอง]

    Sys((ระบบ E-ticket))

    Customer -- "สมัคร/login, ดู event,<br/>แลกตั๋ว, แชท, แจ้งปัญหา, รีวิว" --> Sys
    Sys -- "ตั๋ว/QR, ผลอนุมัติ,<br/>แจ้งเตือน, ผลรีวิว" --> Customer

    Vendor -- "สร้างร้าน/อีเวนต์, จัดการสินค้า,<br/>สแกน QR, ตอบแชท, ซื้อแพ็กเกจ" --> Sys
    Sys -- "สถานะอนุมัติ, โควตาคงเหลือ,<br/>แจ้งเตือน" --> Vendor

    Admin -- "อนุมัติ/ระงับร้าน, จัดการ<br/>support ticket, แบนอีเวนต์" --> Sys
    Sys -- "คิวงานรออนุมัติ, รายงาน" --> Admin

    SuperAdmin -- "แก้ราคาแพ็กเกจ,<br/>จัดการบัญชีแอดมิน" --> Sys
    Sys -- "แดชบอร์ดภาพรวมระบบ" --> SuperAdmin

    Sys -- "คำขอชำระเงิน" --> PaymentSvc
    PaymentSvc -- "webhook ยืนยันผลชำระ" --> Sys

    Sys -- "ส่งรหัส OTP" --> SmsSvc
```

## Level 1 DFD (แตก process กลางเป็น 6 กลุ่มความสามารถ)

```mermaid
flowchart TD
    Customer[ลูกค้า]
    Vendor[ร้านค้า]
    Admin[แอดมิน]
    SuperAdmin[ซูเปอร์แอดมิน]
    PaymentSvc[ผู้ให้บริการชำระเงิน]

    P1((P1<br/>Auth & Profile))
    P2((P2<br/>Vendor & Shop))
    P3((P3<br/>Event & Ticket))
    P4((P4<br/>Payment & Quota))
    P5((P5<br/>Chat & Support))
    P6((P6<br/>Admin & Moderation))

    D1[(D1 ผู้ใช้/สิทธิ์<br/>users, admin_accounts,<br/>vendor_ownerships)]
    D2[(D2 ร้านค้า/สินค้า<br/>vendors, shops, products,<br/>vendor_verifications)]
    D3[(D3 อีเวนต์/ตั๋ว<br/>events, ticket_batches,<br/>tickets, redemptions)]
    D4[(D4 แพ็กเกจ/โควตา<br/>packages, vendor_quotas,<br/>purchases, payments)]
    D5[(D5 แชท/แจ้งปัญหา<br/>conversations, chat_messages,<br/>support_tickets)]
    D6[(D6 การแจ้งเตือน<br/>notifications)]
    D7[(D7 QR token — Redis<br/>TTL 60 วินาที)]

    Customer -- "สมัคร/OTP" --> P1
    Vendor -- "login" --> P1
    P1 <--> D1
    P1 -- "token" --> Customer
    P1 -- "token" --> Vendor

    Vendor -- "สมัครร้าน/จัดการสินค้า" --> P2
    Admin -- "อนุมัติ/ปฏิเสธ" --> P2
    P2 <--> D2

    Vendor -- "สร้าง/แก้อีเวนต์" --> P3
    Customer -- "แลกตั๋ว" --> P3
    Vendor -- "สแกน QR" --> P3
    P3 <--> D3
    P3 <--> D7

    Vendor -- "ซื้อแพ็กเกจ/top-up" --> P4
    PaymentSvc -- "webhook" --> P4
    P4 <--> D4
    P4 -- "ปรับ ticket_cap" --> D3

    Customer -- "แชท/แจ้งปัญหา" --> P5
    Vendor -- "ตอบแชท" --> P5
    Admin -- "จัดการคิว support" --> P5
    P5 <--> D5

    Admin -- "แบน/ระงับ" --> P6
    SuperAdmin -- "จัดการบัญชีแอดมิน/แพ็กเกจ" --> P6
    P6 <--> D2
    P6 <--> D3
    P6 <--> D1
    P6 <--> D4

    P1 -.เหตุการณ์สำคัญ.-> D6
    P2 -.เหตุการณ์สำคัญ.-> D6
    P3 -.เหตุการณ์สำคัญ.-> D6
    P4 -.เหตุการณ์สำคัญ.-> D6
    P5 -.เหตุการณ์สำคัญ.-> D6
    P6 -.เหตุการณ์สำคัญ.-> D6
    D6 -- "อ่านแจ้งเตือน" --> Customer
    D6 -- "อ่านแจ้งเตือน" --> Vendor
    D6 -- "อ่านแจ้งเตือน" --> Admin
```

**หมายเหตุ**: เส้นประจาก P1-P6 ไป D6 หมายถึง "เขียน notification เมื่อมีเหตุการณ์ที่ผู้ใช้ต้องรู้"
(เช่น อนุมัติร้าน, ได้รับเชิญเป็นพนักงาน, ตั๋วถูกแชร์มา, ผลตัดสิน support ticket) ไม่ใช่ทุก process
เขียนทุกครั้ง — ดูรายชื่อ type จริงที่ใช้ทั้งหมดใน `Notification.type` (schema.prisma คอมเมนต์บรรทัด
377) และรายละเอียดที่ [11-realtime-websocket.md](./11-realtime-websocket.md) (WebSocket แค่บอก
"ไปโหลดใหม่" ไม่พกข้อมูลจริง)
