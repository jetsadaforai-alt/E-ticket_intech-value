# Sequence Diagrams — Ticket Lifecycle & Redemption

> อ้างอิงจาก `backend/src/routes/{events,tickets,staffScan}.js`,
> `backend/src/services/{ticketRules,qrToken,redemptionWindow}.js`

นี่คือ core loop ของทั้งระบบ: **browse (guest) → login → claim → QR → staff scan → redeem**

## 1. เปิดดูอีเวนต์ (guest เข้าได้เลย ไม่ต้อง login)

```mermaid
sequenceDiagram
    autonumber
    actor G as ผู้ใช้ (guest หรือ login แล้วก็ได้)
    participant API as Backend API
    participant PG as PostgreSQL

    G->>API: GET /v1/events?category=
    API->>PG: หา event ที่ status='active' (+ กรอง category ถ้ามี)<br/>join shop, รูปแรก, ticketBatch, ชื่อสินค้า
    API->>PG: group รีวิวแยกตาม event (batch query กัน N+1)
    API-->>G: 200 [รายการอีเวนต์ พร้อม rating, ราคา, จำนวนคงเหลือ, sold_out]

    G->>API: GET /v1/events/:id
    API->>PG: หา event เต็ม (รูปทุกใบ, redemption window+slots, สินค้า)
    alt ไม่พบ
        API-->>G: 404 NOT_FOUND
    else พบ
        API->>PG: สรุปคะแนนรีวิวของ event นี้
        API-->>G: 200 &lt;รายละเอียดเต็ม + rating&gt;
    end
```

## 2. แลกตั๋ว (claim) — จุดที่ต้อง login

```mermaid
sequenceDiagram
    autonumber
    actor C as ลูกค้า (login แล้ว)
    participant API as Backend API
    participant PG as PostgreSQL

    C->>API: POST /v1/events/:id/register
    Note over API,PG: === transaction เดียว ===
    API->>PG: หา event + ticketBatch
    alt ไม่พบ หรือ status != 'active'
        API-->>C: 404 EVENT_NOT_AVAILABLE
    else หมดเวลาแล้ว (now &gt; end_time)
        API-->>C: 409 EVENT_ENDED
    else ยังจองได้ในหลักการ
        API->>PG: เช็คว่าเคยมีตั๋ว event นี้อยู่แล้วไหม (status ISSUED/REDEEMED)
        alt มีตั๋วอยู่แล้ว
            API-->>C: 409 ALREADY_HAS_TICKET
        else ยังไม่มี
            API->>PG: UPDATE ticket_batch SET remaining_count -= 1<br/>WHERE remaining_count &gt; 0
            alt ไม่มีแถวถูกอัปเดต (ตั๋วหมด)
                API-->>C: 409 SOLD_OUT
            else หักสำเร็จ
                API->>PG: SELECT ticket ที่ AVAILABLE 1 ใบ<br/>FOR UPDATE SKIP LOCKED (กันแย่งใบเดียวกัน)
                API->>PG: UPDATE ticket SET status='ISSUED',<br/>currentHolderUserId, issuedAt=now
                API-->>C: 201 &lt;ticket&gt;
            end
        end
    end
```

## 3. ดูตั๋วของฉัน / สร้าง QR สำหรับใช้จริง

QR token เก็บใน Redis ล้วน (ไม่แตะ Postgres เลย) อายุ 60 วินาที — หมดอายุกับ token ไม่เคยมีจริง
แยกไม่ออกฝั่ง server (ตอบ error เดียวกัน)

```mermaid
sequenceDiagram
    autonumber
    actor C as ลูกค้า
    participant API as Backend API
    participant PG as PostgreSQL
    participant R as Redis

    C->>API: GET /v1/tickets/me
    API->>PG: หาตั๋วทั้งหมดที่ currentHolderUserId = ฉัน
    API-->>C: 200 [รายการตั๋ว]

    C->>API: GET /v1/tickets/:id
    API->>PG: หาตั๋ว (join event, shop, สินค้า, ผลการแลกถ้ามี)
    alt ไม่พบ หรือไม่ใช่ตั๋วของฉัน
        API-->>C: 403 FORBIDDEN
    else เป็นของฉัน
        API->>PG: เช็คว่าเคยได้รับแชร์มาไหม (เพื่อโชว์ "แชร์โดย...")
        API-->>C: 200 &lt;รายละเอียดตั๋ว + ใบเสร็จถ้า REDEEMED แล้ว&gt;
    end

    C->>API: GET /v1/tickets/:id/qr-token
    API->>PG: หาตั๋ว → 403 FORBIDDEN ถ้าไม่ใช่ของฉัน
    alt status != 'ISSUED' (แลกไปแล้ว/ถูกยกเลิก)
        API-->>C: 409 { error: TICKET_NOT_REDEEMABLE, status }
    else ยังใช้ได้
        API->>API: สุ่ม token (16 bytes hex)
        API->>R: SET qrtoken:&lt;token&gt; = ticketId (TTL 60s)
        API-->>C: 200 { token, expires_in_seconds: 60 }
    end
```

## 4. พนักงานสแกน QR แลกตั๋วที่หน้าร้าน (จุดที่ผ่านการเช็คมากที่สุดในระบบ)

```mermaid
sequenceDiagram
    autonumber
    actor U as ลูกค้า
    actor S as พนักงานร้าน
    participant API as Backend API
    participant PG as PostgreSQL
    participant R as Redis

    U->>S: ยื่นมือถือโชว์ QR (หน้าจอ /qr-token)
    S->>API: POST /v1/staff/scan { token }
    alt token ว่าง/ไม่ใช่ string
        API-->>S: 400 INVALID_TOKEN
    else
        API->>R: GET qrtoken:&lt;token&gt;
        alt ไม่มี (หมดอายุ/ไม่เคยมี)
            API-->>S: 400 QR_EXPIRED
        else มี ticketId
            API->>PG: หาตั๋วเต็ม (event, shop, redemption window, สินค้า)
            alt ไม่พบตั๋ว
                API-->>S: 404 TICKET_NOT_FOUND
            else พบ
                API->>API: isActiveShopMember(staff, shop) เช็คว่า S เป็นพนักงานร้านนี้จริง
                alt ไม่ใช่พนักงานร้านนี้ และร้านถูกระงับ
                    API-->>S: 409 SHOP_SUSPENDED
                else ไม่ใช่พนักงานร้านนี้ (เหตุผลอื่น)
                    API-->>S: 403 FORBIDDEN
                else เป็นพนักงานร้านนี้จริง
                    alt ตั๋วไม่ใช่สถานะ ISSUED (แลกไปแล้ว/ถูกยกเลิก/หมดอายุ)
                        API-->>S: 409 { error: TICKET_NOT_REDEEMABLE, status }
                    else event ถูกแบนไปแล้ว
                        API-->>S: 409 EVENT_BANNED
                    else event หมดเวลาแล้ว
                        API-->>S: 409 EVENT_ENDED
                    else นอกช่วงเวลาที่กำหนดให้แลก (redemption window)
                        API-->>S: 409 OUTSIDE_REDEMPTION_WINDOW
                    else ผ่านทุกเงื่อนไข
                        API->>PG: UPDATE ticket SET status='REDEEMED'<br/>WHERE status='ISSUED' (atomic guard)
                        alt แถวไม่ถูกอัปเดต (คนอื่นสแกนพร้อมกันไปก่อนแล้ว)
                            API-->>S: 409 { error: TICKET_NOT_REDEEMABLE, status:'REDEEMED' }
                        else สำเร็จ
                            API->>PG: create Redemption { ticketId, staffId, discountValueBaht }
                            API-->>S: 200 { result:'success', discount_value_baht,<br/>event_title, products[], redeemed_at }
                        end
                    end
                end
            end
        end
    end
    S-->>U: แจ้งผล "แลกสำเร็จ" (บนหน้าจอ)

    Note over S,API: สรุปยอดที่ตัวเองสแกนวันนี้
    S->>API: GET /v1/staff/redemptions/today
    API->>PG: หา Redemption ของ staff นี้ ในวันนี้ (timezone Asia/Bangkok)
    API-->>S: 200 [รายการที่สแกนวันนี้]
```

## 5. แชร์ตั๋วให้เพื่อน / รับตั๋วที่แชร์มา

```mermaid
sequenceDiagram
    autonumber
    actor A as เจ้าของตั๋วเดิม
    actor B as เพื่อนที่รับตั๋ว
    participant API as Backend API
    participant PG as PostgreSQL

    A->>API: POST /v1/tickets/:id/share
    API->>PG: หาตั๋ว → 403 FORBIDDEN ถ้าไม่ใช่ของ A
    alt status != 'ISSUED'
        API-->>A: 409 TICKET_NOT_SHAREABLE
    else
        API->>PG: create ShareRecord { shareToken สุ่ม 24 hex, expiresAt: +24 ชม. }
        API-->>A: 201 { share_token, expires_at }
    end
    A->>B: ส่งลิงก์/รหัสแชร์ (นอกระบบ เช่น LINE)

    B->>API: POST /v1/share/:token/claim
    Note over API,PG: === transaction เดียว ===
    API->>PG: หา ShareRecord by token
    alt ไม่พบ
        API-->>B: 409 INVALID_LINK
    else เคยถูก claim ไปแล้ว
        API-->>B: 409 ALREADY_CLAIMED
    else หมดอายุ (เกิน 24 ชม.)
        API-->>B: 409 LINK_EXPIRED
    else ตั๋วต้นทางไม่ใช่ ISSUED แล้ว หรือย้ายเจ้าของไปแล้ว
        API-->>B: 409 LINK_EXPIRED
    else B พยายามรับตั๋วของตัวเอง
        API-->>B: 409 CANNOT_CLAIM_OWN_SHARE
    else B มีตั๋ว event นี้อยู่แล้ว
        API-->>B: 409 ALREADY_HAS_TICKET
    else ผ่านทุกเงื่อนไข
        API->>PG: update ticket.currentHolderUserId = B (status ยังเป็น ISSUED เหมือนเดิม)
        API->>PG: update ShareRecord { claimedByUserId: B, claimedAt: now }
        API->>PG: notify A (type: ticket_shared) + notify B (type: ticket_received)
        API-->>B: 200 &lt;ticket ที่เปลี่ยนเจ้าของแล้ว&gt;
    end

    Note over A,B: ดูประวัติย้อนหลังได้ทั้งสองฝั่ง
    A->>API: GET /v1/tickets/me/shares
    API-->>A: 200 [ตั๋วที่เคยแชร์ + สถานะ pending/claimed/expired]
    B->>API: GET /v1/tickets/me/claims
    API-->>B: 200 [ตั๋วที่เคยรับมาจากคนอื่น]
```
