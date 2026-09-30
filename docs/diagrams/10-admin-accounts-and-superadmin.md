# Sequence Diagrams — Admin Accounts, User Moderation & Superadmin

> อ้างอิงจาก `backend/src/routes/{adminMe,superAdmin,superAdminDashboard,adminUsers,notifications}.js`,
> `backend/src/middleware/adminAuth.js`. Admin login เองอยู่ที่
> [01-auth-and-profile.md](./01-auth-and-profile.md) หัวข้อ 4

มี 2 role: `admin` (งานประจำวัน) กับ `super_admin` (คุมบัญชีแอดมินคนอื่น + ราคาแพ็กเกจ) — ตรวจสอบผ่าน
`requireAdminAuth` (ทุกเส้นทางในไฟล์นี้) และ `requireSuperAdmin` เพิ่มอีกชั้นเฉพาะเส้นทางของ super_admin

## 1. แอดมินเปลี่ยนรหัสผ่านตัวเอง

```mermaid
sequenceDiagram
    autonumber
    actor A as แอดมิน (role ไหนก็ได้)
    participant API as Backend API
    participant PG as PostgreSQL

    A->>API: PATCH /v1/admin/me/password { currentPassword, newPassword }
    alt newPassword สั้นกว่า 8 ตัวอักษร
        API-->>A: 400 PASSWORD_TOO_SHORT
    else
        API->>PG: หาบัญชีตัวเอง
        API->>API: bcrypt.compare(currentPassword, passwordHash)
        alt รหัสผ่านเดิมผิด
            API-->>A: 401 INVALID_CURRENT_PASSWORD
        else ถูกต้อง
            API->>API: bcrypt.hash(newPassword)
            API->>PG: update passwordHash
            API-->>A: 200 { ok: true }
        end
    end
```

## 2. ซูเปอร์แอดมินจัดการบัญชีแอดมินคนอื่น

```mermaid
sequenceDiagram
    autonumber
    actor SA as ซูเปอร์แอดมิน
    participant API as Backend API
    participant PG as PostgreSQL

    SA->>API: POST /v1/superadmin/admins { username, password, phone, role }
    alt username ว่าง
        API-->>SA: 400 INVALID_USERNAME
    else password สั้นกว่า 8
        API-->>SA: 400 PASSWORD_TOO_SHORT
    else phone ผิดรูปแบบ
        API-->>SA: 400 INVALID_PHONE
    else role ไม่ใช่ admin/super_admin
        API-->>SA: 400 INVALID_ROLE
    else
        API->>PG: create AdminAccount (bcrypt hash password)
        alt username หรือ phone ซ้ำกับที่มีอยู่แล้ว (unique constraint)
            API-->>SA: 409 USERNAME_OR_PHONE_TAKEN
        else สำเร็จ
            API-->>SA: 201 { id, username, role, status }
        end
    end

    SA->>API: GET /v1/superadmin/admins
    API->>PG: list ทุกบัญชีแอดมิน
    API-->>SA: 200 [{id,username,role,status,createdAt}...]

    SA->>API: PATCH /v1/superadmin/admins/:id/disable
    alt id ที่ระบุคือตัวเอง
        API-->>SA: 400 CANNOT_DISABLE_SELF
    else
        API->>PG: update target.status='disabled'
        API-->>SA: 200 { id, status }
    end

    SA->>API: PATCH /v1/superadmin/admins/:id/password { newPassword }
    alt สั้นกว่า 8 ตัว
        API-->>SA: 400 PASSWORD_TOO_SHORT
    else หา target ไม่พบ
        API-->>SA: 404 NOT_FOUND
    else target role เป็น super_admin (รวมถึงกรณีระบุตัวเอง)
        API-->>SA: 403 CANNOT_CHANGE_SUPERADMIN_PASSWORD
        Note right of API: super_admin เปลี่ยนรหัสตัวเองต้องผ่าน<br/>/v1/admin/me/password เท่านั้น — ห้ามคนอื่นตั้งให้
    else target เป็น admin ธรรมดา
        API->>PG: hash + update passwordHash
        API-->>SA: 200 { ok: true }
    end
```

## 3. แอดมินดูแล/ระงับผู้ใช้ (ลูกค้า/ร้านค้า)

การระงับผู้ใช้คนละอย่างกับการระงับ vendor (ดู
[02-vendor-onboarding-and-moderation.md](./02-vendor-onboarding-and-moderation.md)) — ระงับผู้ใช้จะยกเลิก
**ตั๋วที่ผู้ใช้คนนั้นถืออยู่เอง** เท่านั้น ไม่แตะร้านค้า

```mermaid
sequenceDiagram
    autonumber
    actor A as แอดมิน
    participant API as Backend API
    participant PG as PostgreSQL

    A->>API: GET /v1/admin/users?status=&q=
    API->>PG: หา user ตามสถานะ/คำค้น (ชื่อหรือเบอร์) รวมนับตั๋ว/รีวิว/มีร้านไหม
    API-->>A: 200 [รายชื่อผู้ใช้ สูงสุด 200]

    A->>API: GET /v1/admin/users/:id
    API->>PG: หา user เต็ม (vendor ownerships, support ticket ที่เคยแจ้ง, สรุปตั๋วแยกตามสถานะ, รีวิว 20 ล่าสุด)
    alt ไม่พบ
        API-->>A: 404 NOT_FOUND
    else พบ
        API-->>A: 200 &lt;โปรไฟล์เต็ม&gt;
    end

    A->>API: POST /v1/admin/users/:id/suspend { reason }
    alt reason ว่าง
        API-->>A: 400 REASON_REQUIRED
    else หา user ไม่พบ
        API-->>A: 404 NOT_FOUND
    else
        Note over API,PG: === transaction เดียว ===
        API->>PG: conditional UPDATE status='suspended' WHERE status='active'
        alt count=0 (ระงับซ้ำ)
            API-->>A: 409 NOT_ACTIVE
        else สำเร็จ
            API->>PG: cancelTicketsHeldBy() — ยกเลิกตั๋ว AVAILABLE/ISSUED<br/>ที่ผู้ใช้นี้ถืออยู่ (ไม่คืนโควตาให้ร้าน — เป็นการลงโทษ)
            API->>PG: create Notification (type: account_suspended)<br/>อ่านได้แม้บัญชีถูกระงับ (ผ่าน /v1/notifications ที่ allow-suspended)
            API-->>A: 200 { id, status:'suspended', tickets_cancelled }
        end
    end

    A->>API: POST /v1/admin/users/:id/unsuspend
    API->>PG: หา user → 404 NOT_FOUND
    API->>PG: conditional UPDATE status='active' WHERE status='suspended'
    alt count=0 (ไม่ได้ถูกระงับอยู่)
        API-->>A: 409 NOT_SUSPENDED
    else สำเร็จ
        API->>PG: create Notification (type: account_restored)
        Note right of PG: ตั๋วที่ถูกยกเลิกไปตอน suspend **ไม่กลับมา** แม้ unsuspend แล้ว
        API-->>A: 200 { id, status:'active' }
    end
```

## 4. แดชบอร์ดซูเปอร์แอดมิน (สรุปทั้งระบบ)

`GET /v1/superadmin/dashboard` เป็น endpoint เดียว ไม่มี parameter —ยิงเกือบ 20 query ขนานกัน
(`Promise.all`) แล้วประกอบเป็น response ก้อนใหญ่ก้อนเดียว ไม่มี error branch พิเศษ (เป็น read-only
aggregate ล้วน)

```mermaid
sequenceDiagram
    autonumber
    actor SA as ซูเปอร์แอดมิน
    participant API as Backend API
    participant PG as PostgreSQL

    SA->>API: GET /v1/superadmin/dashboard
    par ยิงขนานกันทั้งหมด (Promise.all)
        API->>PG: group vendor ตาม verificationStatus + status
        API->>PG: count shop, group user/event/ticket/supportTicket ตาม status
        API->>PG: count admin ที่ active, count redemption วันนี้ (timezone Bangkok)
        API->>PG: sum/avg ยอดขายจาก Purchase ที่จ่ายแล้ว (แยกตาม type และ tier แพ็กเกจ)
        API->>PG: sum โควตาคงเหลือทั้งระบบ + group QuotaLedger ตามเหตุผล
        API->>PG: sum มูลค่าส่วนลดที่แลกไปแล้วทั้งหมด, sum ตั๋วทั้งหมด/ที่แลกแล้ว
        API->>PG: group vendor ตามแพ็กเกจปัจจุบัน, list ทุกแพ็กเกจ
        API->>PG: ค่าเฉลี่ย/กระจายคะแนนรีวิวทั้งระบบ
        API->>PG: raw SQL: กราฟยอดขาย + การแลกตั๋วย้อนหลัง 30 วัน (แปลง timezone เป็น Bangkok)
    end
    API-->>SA: 200 { vendors, shops, users, events, tickets, support_tickets,<br/>admins, redemptions_today, revenue{...}, quota{...},<br/>value{...}, packages[], reviews{...}, trends{...} }
```

## 5. แจ้งเตือนในแอป (ผลข้างเคียงของหลายๆ flow ข้างต้น)

ทุก flow ที่ "create Notification" ในไฟล์อื่นๆ ทั้งหมด (เชิญ staff, ผล verify vendor, ระงับ/ปลดระงับ,
แบนอีเวนต์, แชร์ตั๋ว) จบลงที่สองเส้นทางนี้ฝั่งผู้รับ — ใช้ `requireAuthAllowSuspended` เพราะแม้บัญชีถูก
ระงับก็ต้องอ่านการแจ้งเตือนเรื่องการระงับของตัวเองได้

```mermaid
sequenceDiagram
    autonumber
    actor U as ผู้ใช้ (แม้ถูกระงับก็อ่านได้)
    participant API as Backend API
    participant PG as PostgreSQL

    U->>API: GET /v1/notifications
    API->>PG: หา Notification ของ U เรียงใหม่สุดก่อน
    API-->>U: 200 [รายการแจ้งเตือน]

    U->>API: PATCH /v1/notifications/:id/read
    API->>PG: หา notification — ไม่พบ หรือไม่ใช่ของ U → 403 FORBIDDEN (ไม่แยก 404)
    API->>PG: update readAt = readAt เดิม ?? now (idempotent — กดซ้ำไม่ทับเวลาที่อ่านจริงครั้งแรก)
    API-->>U: 200 &lt;notification ที่อัปเดตแล้ว&gt;
```
