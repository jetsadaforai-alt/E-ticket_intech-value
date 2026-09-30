# Sequence Diagrams — Event Lifecycle

> อ้างอิงจาก `backend/src/routes/events.js`, `backend/src/services/{quota,productRules,redemptionWindow,moderation}.js`

## 1. สร้างอีเวนต์ (หักโควตา + สร้างตั๋วทุกใบล่วงหน้า)

Endpoint นี้ซับซ้อนที่สุดในระบบ — validate หลายชั้นก่อนเข้า transaction เพื่อไม่ให้หักโควตาไปแล้วค่อยพัง
ทีหลัง

```mermaid
sequenceDiagram
    autonumber
    actor V as ร้านค้า (manager/owner)
    participant API as Backend API
    participant PG as PostgreSQL

    V->>API: POST /v1/shops/:shopId/events { title, description?, category,<br/>start_time, end_time, total_qty, discount_value_baht,<br/>product_ids?, redemption_window? }
    API->>API: isShopManagerOrOwner
    alt ไม่มีสิทธิ์ (vendor ถูกระงับ)
        API-->>V: 403 VENDOR_SUSPENDED
    else ไม่มีสิทธิ์ (เหตุผลอื่น)
        API-->>V: 403 FORBIDDEN
    else มีสิทธิ์ — เริ่ม validate ทีละชั้น
        alt title ว่าง
            API-->>V: 400 INVALID_TITLE
        else description ยาวเกิน 2000 ตัวอักษร
            API-->>V: 400 DESCRIPTION_TOO_LONG
        else category ไม่ใช่ food_drink/music/workshops
            API-->>V: 400 INVALID_CATEGORY
        else เวลาไม่ถูกต้อง (end &lt;= start)
            API-->>V: 400 INVALID_TIME_RANGE
        else จำนวนตั๋วไม่ใช่ 1-10000
            API-->>V: 400 INVALID_QTY
        else ส่วนลดติดลบ
            API-->>V: 400 INVALID_DISCOUNT
        else ผ่านทุกช่อง
            API->>PG: หา shop → 404 SHOP_NOT_FOUND ถ้าไม่พบ
            API->>API: validateProductIds() — เช็คสินค้าที่จะผูกมีจริง/active
            alt product ไม่พบ หรือถูก archive
                API-->>V: 400 PRODUCT_NOT_FOUND / PRODUCT_ARCHIVED
            else product ok (หรือไม่ได้ผูกเลย)
                API->>API: validateRedemptionWindow() ถ้ามีส่งมา
                alt ช่วงเวลาแลกไม่สมเหตุสมผล
                    API-->>V: 400 (หลายรูปแบบ — ดูรายละเอียดท้ายไฟล์)
                else ผ่านหมดทุกช่อง
                    Note over API,PG: === เข้า transaction เดียว ===
                    API->>PG: create Event + ticketBatch{totalQty, remainingCount: qty}<br/>+ products (ถ้ามี)
                    API->>PG: consumeForNewEvent() — หักโควตาแบบ atomic:<br/>UPDATE vendor_quotas SET ticket_balance -= qty, event_balance -= 1<br/>WHERE ticket_balance&gt;=qty AND event_balance&gt;=1
                    alt ตั๋วที่ขอเกิน cap ของแพ็กเกจ (ticketPerEvent)
                        PG-->>API: throw EXCEEDS_TICKET_CAP
                        API-->>V: 400 { error, ticket_cap, requested }
                    else โควตาไม่พอ (0 แถวถูกอัปเดต)
                        PG-->>API: throw INSUFFICIENT_QUOTA
                        API-->>V: 409 { error, needed, available }
                    else หักโควตาสำเร็จ
                        API->>PG: บันทึก QuotaLedger (reason: event_created)
                        API->>PG: update Event.ticketCap (snapshot ค่า cap ไว้กันแพ็กเกจเปลี่ยนทีหลัง)
                        API->>PG: createMany Ticket ทุกใบ status='AVAILABLE'<br/>(สร้างล่วงหน้าทั้งหมด ไม่รอสร้างตอนลูกค้ากดแลก)
                        opt มี redemption_window ส่งมา
                            API->>PG: writeRedemptionWindow()
                        end
                        API-->>V: 201 &lt;event พร้อม ticketBatch, products, ticketCap&gt;
                    end
                end
            end
        end
    end
```

## 2. แก้ไขอีเวนต์ / ยกเลิกอีเวนต์ (คืนโควตา)

```mermaid
sequenceDiagram
    autonumber
    actor V as ร้านค้า
    participant API as Backend API
    participant PG as PostgreSQL

    V->>API: PATCH /v1/events/:id { title?, description?, start_time?,<br/>end_time?, product_ids?, redemption_window? }
    API->>PG: หา event → 404 NOT_FOUND ถ้าไม่พบ
    API->>API: isShopManagerOrOwner → 403 FORBIDDEN ถ้าไม่ผ่าน
    alt event.status != 'active' (ถูกแบน/ยกเลิก/หมดอายุแล้ว)
        API-->>V: 409 NOT_ACTIVE
    else ยังแก้ได้
        Note right of API: validate ทุกช่องเหมือนตอนสร้าง (title/description/time/<br/>product_ids/redemption_window) — error code เดียวกัน
        API->>PG: update Event + sync product links + redemption window
        API-->>V: 200 &lt;event ที่อัปเดตแล้ว&gt;
    end

    V->>API: POST /v1/events/:id/cancel
    API->>PG: หา event → 404 NOT_FOUND
    API->>API: isShopManagerOrOwner → 403 FORBIDDEN
    Note over API,PG: === transaction เดียว ===
    API->>PG: conditional UPDATE status='cancelled' WHERE status='active'
    alt count=0 (ไม่ active อยู่แล้ว)
        API-->>V: 409 NOT_ACTIVE ("Event นี้ถูกยกเลิกหรือหมดอายุไปแล้ว")
    else สำเร็จ
        API->>PG: นับตั๋ว AVAILABLE (ที่ยังไม่มีคนแลก) ก่อนเปลี่ยนสถานะ
        API->>PG: creditQuota() — คืนโควตาตามจำนวนตั๋วที่ยังไม่ถูกแลก + คืน event quota 1<br/>(กัน refund ซ้ำด้วย unique constraint บน QuotaLedger)
        API->>PG: update ตั๋ว AVAILABLE ทั้งหมด → CANCELLED<br/>(ตั๋วที่แลกไปแล้ว ISSUED/REDEEMED ไม่แตะ ยังใช้ได้ตามเดิม)
        API-->>V: 200 { event, quota_returned:{tickets, events} }
    end
```

## 3. จัดการรูปภาพ / ช่วงเวลาแลกตั๋ว (redemption window)

```mermaid
sequenceDiagram
    autonumber
    actor V as ร้านค้า
    participant API as Backend API
    participant FS as ไฟล์ระบบ
    participant PG as PostgreSQL

    V->>API: POST /v1/events/:id/images (multipart, สูงสุด 5 ไฟล์)
    API->>PG: หา event (+ นับรูปเดิม) → 404 ถ้าไม่พบ
    API->>API: isShopManagerOrOwner → 403 FORBIDDEN
    alt ไม่มีไฟล์แนบมา
        API-->>V: 400 NO_FILES
    else รวมรูปเดิม+ใหม่เกิน 5
        API-->>V: 400 { error: TOO_MANY_IMAGES, max: 5 }
    else ไฟล์ผิดชนิด/ใหญ่เกิน 5MB
        API-->>V: 400 INVALID_FILE_TYPE / FILE_TOO_LARGE
    else ผ่าน
        API->>FS: เขียนไฟล์ทุกไฟล์
        API->>PG: createMany EventImage
        API-->>V: 201 [รูปที่สร้าง]
    end

    V->>API: DELETE /v1/events/:id/images/:imageId
    API->>PG: หา event → 404 NOT_FOUND, สิทธิ์ → 403 FORBIDDEN
    API->>PG: หารูป — ไม่พบ/คนละ event → 404 IMAGE_NOT_FOUND
    API->>PG: delete EventImage
    API->>FS: unlink ไฟล์จริง (best-effort)
    API-->>V: 204 No Content

    V->>API: PUT /v1/events/:id/redemption-window { valid_from?, valid_until?, slots?[] }
    API->>PG: หา event → 404, สิทธิ์ → 403 FORBIDDEN
    API->>API: validateRedemptionWindow(body, event.endTime)
    alt ช่วงเวลาไม่สมเหตุสมผล
        API-->>V: 400 (VALID_UNTIL_BEFORE_VALID_FROM /<br/>VALID_UNTIL_AFTER_EVENT_END / INVALID_DAY_OF_WEEK /<br/>INVALID_SLOT_TIME_RANGE / INVALID_REDEMPTION_WINDOW)
    else ผ่าน
        API->>PG: ลบ window เดิม (cascade ลบ slot) แล้วสร้างใหม่
        alt payload ว่างเปล่าทั้งหมด
            API-->>V: 200 { eventId, cleared: true }
        else มีข้อมูล
            API-->>V: 200 &lt;window พร้อม slots&gt;
        end
    end
```

## 4. ฝั่งแอดมิน: ดูรายการ / แบนอีเวนต์

การแบนต่างจากการยกเลิกโดยร้านค้าเอง: **ไม่คืนโควตาให้ร้าน**, และยกเลิกได้ทั้งตั๋ว AVAILABLE และ ISSUED
(ที่แลกไปแล้วแต่ยังไม่ redeem) — เพราะเป็นการลงโทษ ไม่ใช่การยกเลิกโดยสมัครใจ

```mermaid
sequenceDiagram
    autonumber
    actor A as แอดมิน
    participant API as Backend API
    participant PG as PostgreSQL

    A->>API: GET /v1/admin/events?status=
    API->>PG: list event (join shop, ticketBatch), take 200
    API-->>A: 200 [รายการ]

    A->>API: GET /v1/admin/events/:id
    API->>PG: หา event เต็ม + group ticket ตาม status + สรุปรีวิว
    alt ไม่พบ
        API-->>A: 404 NOT_FOUND
    else พบ
        API-->>A: 200 &lt;รายละเอียดเต็ม&gt;
    end

    A->>API: POST /v1/admin/events/:id/ban { reason }
    alt reason ว่าง
        API-->>A: 400 REASON_REQUIRED
    else
        API->>PG: หา event → 404 NOT_FOUND ถ้าไม่พบ
        Note over API,PG: banEvent() ใน services/moderation.js — transaction เดียว
        API->>PG: บันทึกรายชื่อคนถือตั๋ว ISSUED ไว้ก่อน (ต้องแจ้งเตือน)
        API->>PG: conditional UPDATE status='banned' WHERE status='active'
        alt count=0
            API-->>A: 409 NOT_ACTIVE
        else สำเร็จ
            API->>PG: update ตั๋ว AVAILABLE+ISSUED ทั้งหมด → CANCELLED<br/>(REDEEMED ไม่แตะ — ประวัติการแลกไปแล้วคงไว้)
            API->>PG: notify คนถือตั๋วทุกคน + เจ้าของร้าน (type: event_banned)
            API-->>A: 200 { id, status:'banned', tickets_cancelled, holders_notified }
        end
    end
```
