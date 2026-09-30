# Sequence Diagrams — Packages, Purchases & Payment

> อ้างอิงจาก `backend/src/routes/{packages,purchases}.js`, `backend/src/services/quota.js`

กติกาสำคัญ: **โควตาจะถูกให้จริงแค่จุดเดียวในระบบทั้งหมด — ตอน payment webhook ยืนยันว่าจ่ายสำเร็จ**
ไม่ใช่ตอนสร้างคำสั่งซื้อ

## 1. ดูแพ็กเกจที่มีขาย / ซูเปอร์แอดมินแก้ราคา

```mermaid
sequenceDiagram
    autonumber
    actor V as ร้านค้า
    actor SA as ซูเปอร์แอดมิน
    participant API as Backend API
    participant PG as PostgreSQL

    V->>API: GET /v1/packages
    API->>PG: หา Package ที่ isActive=true, เรียงตาม sortOrder
    API-->>V: 200 [แพ็กเกจที่ซื้อได้]

    SA->>API: GET /v1/superadmin/packages
    API->>PG: หา Package ทั้งหมด (รวมที่ปิดขายแล้ว)
    API-->>SA: 200 [ทุกแพ็กเกจ]

    SA->>API: PATCH /v1/superadmin/packages/:id { price_baht?, event_quota?,<br/>ticket_per_event?, ...ฯลฯ }
    loop ทุกช่องตัวเลขที่ส่งมา
        alt ค่าติดลบ/ไม่ใช่ตัวเลข
            API-->>SA: 400 { error: INVALID_VALUE, field }
        else event_quota/ticket_per_event ไม่ใช่จำนวนเต็ม
            API-->>SA: 400 { error: MUST_BE_INTEGER, field }
        end
    end
    alt ไม่ส่งอะไรมาเลย
        API-->>SA: 400 NOTHING_TO_UPDATE
    else หา package ไม่พบ
        API-->>SA: 404 NOT_FOUND
    else ผ่าน
        API->>PG: update Package
        Note right of PG: การเปลี่ยนราคา/โควตาไม่ย้อนหลังไปแตะ<br/>อีเวนต์/ใบเสร็จเก่า — ทุกอย่าง snapshot ค่าไว้ตอนสร้างแล้ว
        API-->>SA: 200 &lt;package ที่อัปเดตแล้ว&gt;
    end
```

## 2. สร้างคำสั่งซื้อ (อัปเกรดแพ็กเกจ / เติมโควตาอีเวนต์ / เติมโควตาตั๋ว)

```mermaid
sequenceDiagram
    autonumber
    actor V as ร้านค้า
    participant API as Backend API
    participant PG as PostgreSQL
    participant PAY as Payment Provider

    V->>API: POST /v1/vendors/me/purchases { type, package_id?,<br/>quantity?, target_event_id? }
    API->>PG: หา vendor ของ V → 404 NO_VENDOR ถ้าไม่มี
    alt vendor ถูกระงับ
        API-->>V: 403 VENDOR_SUSPENDED
    else type ไม่ใช่ package/event_topup/ticket_topup
        API-->>V: 400 INVALID_TYPE
    else quantity ไม่ใช่ 1-50
        API-->>V: 400 { error: INVALID_QUANTITY, max: 50 }
    else หา VendorQuota ไม่พบ
        API-->>V: 404 NO_QUOTA
    else
        alt type == package
            alt ไม่ส่ง package_id
                API-->>V: 400 PACKAGE_REQUIRED
            else หา package ไม่พบ/ปิดขาย
                API-->>V: 404 PACKAGE_NOT_FOUND
            else แพ็กเกจใหม่ tier ต่ำกว่าหรือเท่าเดิม (ไม่รับดาวน์เกรด)
                API-->>V: 409 { error: DOWNGRADE_NOT_ALLOWED, current_tier }
            end
        else type == event_topup / ticket_topup
            alt แพ็กเกจปัจจุบันไม่เปิดให้เติม (เช่น Free tier)
                API-->>V: 409 TOPUP_NOT_AVAILABLE
            end
            opt type == ticket_topup และส่ง target_event_id มา
                alt event ไม่พบ/ไม่ใช่ของร้านนี้
                    API-->>V: 404 EVENT_NOT_FOUND
                else event ไม่ active แล้ว
                    API-->>V: 409 EVENT_NOT_ACTIVE
                end
            end
            opt ส่ง target_event_id มาแต่ type ไม่ใช่ ticket_topup
                API-->>V: 400 TARGET_EVENT_NOT_APPLICABLE
            end
        end
        API->>API: คำนวณราคา/สิ่งที่จะได้รับ (describePurchase)
        API->>PG: create Purchase { status:'pending', ราคา/จำนวนที่ snapshot ไว้ }
        API->>PAY: createCharge(...)
        API->>PG: create Payment { status:'pending', providerRef, expiresAt }
        API-->>V: 201 { purchase, payment:{provider, amount_baht, payload สำหรับจ่ายเงิน} }
        Note right of API: ยังไม่ได้โควตาเลยตอนนี้ — รอ webhook ยืนยันก่อน
    end

    V->>API: GET /v1/vendors/me/purchases/:id
    API->>PG: หา purchase (ต้องเป็นของ vendor ตัวเอง) → 404 NOT_FOUND ถ้าไม่ใช่
    API-->>V: 200 { purchase, payment_status }
```

## 3. Payment Webhook — จุดเดียวที่โควตาถูกให้จริง

```mermaid
sequenceDiagram
    autonumber
    participant PAY as Payment Provider
    participant API as Backend API
    participant PG as PostgreSQL

    PAY->>API: POST /v1/payments/webhook (ไม่มี auth — ผู้ให้บริการเรียกเข้ามาเอง)
    API->>API: verifyCallback(req) — เช็คลายเซ็น/ความถูกต้องของ callback
    alt verify ไม่ผ่าน
        API-->>PAY: 400 INVALID_CALLBACK
    else ผ่าน
        API->>PG: หา Payment by providerRef → 404 PAYMENT_NOT_FOUND ถ้าไม่พบ
        alt สถานะที่แจ้งมาคือ "ล้มเหลว"
            API->>PG: flip Payment+Purchase จาก pending → failed (conditional, idempotent)
            API-->>PAY: 200 { ok:true, status:'failed' }
        else สถานะ "สำเร็จ"
            Note over API,PG: === transaction เดียว ===
            API->>PG: conditional UPDATE Payment SET status='succeeded'<br/>WHERE status='pending'
            alt count=0 (ประมวลผลไปแล้วจากการเรียกซ้ำก่อนหน้า)
                API-->>PAY: 200 { ok:true, status:'succeeded', already_applied:true }
            else ยังไม่เคยประมวลผล
                API->>PG: update Purchase.status='paid'
                API->>PG: creditQuota() — บวกโควตาเข้า VendorQuota จริง<br/>(กันให้ซ้ำด้วย UNIQUE(reason,refId) บน QuotaLedger)
                opt type == 'package'
                    API->>PG: update VendorQuota.currentPackageId
                end
                opt type == 'ticket_topup' และมี target_event_id
                    API->>PG: applyTicketTopupToEvent() — สร้างตั๋วจริงเพิ่มเข้า<br/>batch ของอีเวนต์นั้น (หักโควตาที่เพิ่งให้กลับออกมาใช้ทันที)
                end
                API-->>PAY: 200 { ok:true, status:'succeeded', already_applied:false }
            end
        end
    end
```
