# Sequence Diagrams — Shop & Staff Management

> อ้างอิงจาก `backend/src/routes/shops.js` (default router = `/v1/shops`,
> `invitationsRouter` = `/v1/staff`), `backend/src/services/shopAuth.js`

กติกาหลัก: **1 vendor ต่อ 1 shop เท่านั้น**. คนที่กดสร้างร้านจะได้ role `manager` อัตโนมัติ — เป็นทาง
เดียวที่มีตอนนี้ในการได้ role นี้ (ยังไม่มี invite-manager flow)

## 1. สร้างร้านค้า

```mermaid
sequenceDiagram
    autonumber
    actor V as เจ้าของ vendor (ที่ approved แล้ว)
    participant API as Backend API
    participant PG as PostgreSQL

    V->>API: POST /v1/shops { name, address }
    alt name/address ว่าง
        API-->>V: 400 INVALID_INPUT
    else
        API->>PG: หา VendorOwnership ของ user
        alt ไม่ใช่ vendor owner เลย
            API-->>V: 403 NOT_A_VENDOR_OWNER
        else เป็น owner แต่ vendor ยังไม่ approved
            API-->>V: 403 VENDOR_NOT_APPROVED
        else vendor มีร้านอยู่แล้ว (1:1)
            API-->>V: 409 SHOP_ALREADY_EXISTS
        else ผ่านทุกเงื่อนไข
            API->>PG: create Shop + staffAssignments:[{userId, role:'manager', status:'active'}]
            API-->>V: 201 &lt;shop&gt;
        end
    end
```

## 2. แก้ไขข้อมูลร้าน / ดูแดชบอร์ดสรุป

```mermaid
sequenceDiagram
    autonumber
    actor M as Manager/Owner
    participant API as Backend API
    participant PG as PostgreSQL

    M->>API: GET /v1/shops/:id
    API->>API: isShopManagerOrOwner(userId, shopId)
    alt ไม่มีสิทธิ์ และ vendor ถูกระงับอยู่
        API-->>M: 403 VENDOR_SUSPENDED
    else ไม่มีสิทธิ์ (เหตุผลอื่น)
        API-->>M: 403 FORBIDDEN
    else มีสิทธิ์
        API->>PG: หา shop, group event ตาม status,<br/>count ticket ISSUED+REDEEMED, count REDEEMED,<br/>sum ส่วนลดที่แลกไปแล้วทั้งหมด
        API-->>M: 200 { shop info, summary:{events_active, events_total,<br/>tickets_issued, tickets_redeemed, total_discount_baht} }
    end

    M->>API: PATCH /v1/shops/:id { name?, address? }
    API->>API: isShopManagerOrOwner → 403 FORBIDDEN ถ้าไม่ใช่
    alt ส่งมาแต่เป็นค่าว่าง/ไม่ใช่ string
        API-->>M: 400 INVALID_NAME / 400 INVALID_ADDRESS
    else ไม่ส่งอะไรมาเลย
        API-->>M: 400 INVALID_INPUT
    else valid
        API->>PG: update Shop
        API-->>M: 200 &lt;shop&gt;
    end
```

## 3. เชิญ/รับ/ปฏิเสธ/ถอดพนักงาน (staff)

เชิญได้เฉพาะ role `staff` เท่านั้น — โค้ดตั้ง `role:'staff'` ตายตัวไม่มีให้เลือก

**เชิญได้เฉพาะเบอร์ที่สมัครสมาชิกแล้ว** (อัปเดต 27 ก.ย. 2026): พนักงานต้องสมัครในแอปเองก่อน ถ้าเบอร์ยังไม่มีบัญชี
ระบบตอบ 404 `NOT_REGISTERED` และไม่สร้างอะไรเลย (เดิมระบบสร้างบัญชีชั่วคราวให้เบอร์นั้นอัตโนมัติ — เลิกแล้ว
เพื่อให้ตรงกับกฎ "ต้องสมัครก่อนเข้าสู่ระบบ" ใน `01-auth-and-profile.md`)

```mermaid
sequenceDiagram
    autonumber
    actor M as Manager/Owner
    participant API as Backend API
    participant PG as PostgreSQL
    actor S as คนที่ถูกเชิญ

    M->>API: POST /v1/shops/:id/staff/invite { phone }
    alt phone ผิดรูปแบบ
        API-->>M: 400 INVALID_PHONE
    else isShopManagerOrOwner ไม่ผ่าน
        API-->>M: 403 FORBIDDEN
    else ผ่าน
        API->>PG: findUnique User by phone
        alt เบอร์นี้ยังไม่ได้สมัครสมาชิก
            API-->>M: 404 NOT_REGISTERED ("ให้พนักงานสมัครสมาชิกก่อนแล้วค่อยเชิญ")
        else สมัครแล้ว
            API->>PG: เช็ค ShopStaffAssignment เดิม (status active/invited)
            alt เชิญซ้ำ/เป็น staff อยู่แล้ว
                API-->>M: 409 ALREADY_INVITED_OR_ACTIVE
            else เชิญใหม่ได้
                API->>PG: create ShopStaffAssignment{role:'staff', status:'invited'}
                API->>PG: create Notification (type: invite_staff) ให้ S
                API-->>M: 201 &lt;assignment&gt;
            end
        end
    end

    S->>API: POST /v1/staff/invitations/:id/accept
    API->>PG: หา assignment — ไม่พบ หรือไม่ใช่ของ S เอง → 403 FORBIDDEN
    alt สถานะไม่ใช่ 'invited' อยู่
        API-->>S: 409 NOT_INVITED
    else
        API->>PG: update status='active'
        API-->>S: 200 &lt;assignment&gt;
    end

    Note over S,API: หรือ S เลือกปฏิเสธแทน — logic การตรวจสอบเหมือนกันทุกจุด
    S->>API: POST /v1/staff/invitations/:id/reject
    API->>PG: update status='rejected' (คนละค่ากับ active/invited — เชิญใหม่ได้อีกภายหลัง)
    API-->>S: 200 &lt;assignment&gt;

    M->>API: DELETE /v1/shops/:id/staff/:assignmentId
    API->>API: isShopManagerOrOwner → 403 FORBIDDEN ถ้าไม่ผ่าน
    API->>PG: หา assignment — ไม่พบ/คนละร้าน → 404 NOT_FOUND
    alt assignment เป็น role 'manager' (ไม่ใช่ staff)
        API-->>M: 400 CANNOT_REMOVE_MANAGER
        Note right of API: กันร้านล็อกตัวเอง — manager row คือสิทธิ์เข้าร้านของเจ้าของเอง
    else เป็น staff และเคยถูกถอดไปแล้ว
        API-->>M: 409 ALREADY_REMOVED
    else ถอดได้
        API->>PG: update status='removed'
        Note right of PG: GET /v1/me ดึงแค่ assignment ที่ active เท่านั้น<br/>คนที่ถูกถอดจะหลุดโหมด staff อัตโนมัติในการเช็คครั้งถัดไป
        API-->>M: 200 &lt;assignment&gt;
    end
```
