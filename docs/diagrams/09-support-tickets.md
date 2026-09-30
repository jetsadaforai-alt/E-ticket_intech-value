# Sequence Diagrams — คิว Support Ticket

> อ้างอิงจาก `backend/src/routes/adminSupport.js` (mount คนละ prefix สองจุด: ฝั่งผู้ใช้ที่
> `/v1/support-tickets` ใช้ `requireAuthAllowSuspended`, ฝั่งแอดมินที่ `/v1/admin/support-tickets`
> ใช้ `requireAdminAuth`) และ `backend/src/services/realtime.js`

หมวดที่แจ้งได้: `redemption_dispute` (ข้อพิพาทการแลกตั๋ว), `billing_issue` (การเรียกเก็บเงิน),
`fraud_report` (รายงานทุจริต), `other`

## 1. แจ้งปัญหา → เข้าคิวแอดมิน (realtime)

**บัญชีที่ถูกระงับก็แจ้งปัญหาได้** (`requireAuthAllowSuspended`) — เป็นช่องทางเดียวที่ยังใช้ได้ตอนโดนแบน

```mermaid
sequenceDiagram
    autonumber
    actor U as ผู้ใช้/ร้านค้า (แม้บัญชีถูกระงับก็ใช้ได้)
    participant API as Backend API
    participant PG as PostgreSQL
    participant WS as WebSocket
    actor A as แอดมิน (ทุกคน)

    U->>API: POST /v1/support-tickets { category, message }
    alt category ไม่ใช่ 1 ใน 4 หมวดที่กำหนด
        API-->>U: 400 INVALID_CATEGORY
    else message ว่าง
        API-->>U: 400 MESSAGE_REQUIRED
    else ผ่าน
        API->>PG: create SupportTicket + ข้อความแรก (senderType:'user')
        API->>WS: emit('support-ticket-changed') — broadcast ทุกคน ไม่จำกัดห้อง
        WS-->>A: คิวอัปเดตสด (ทุกแอดมินที่เปิดหน้าคิวอยู่)
        API-->>U: 201 &lt;ticket พร้อมข้อความแรก&gt;
    end
```

## 2. แอดมินรับเรื่อง (claim แบบ exclusive — คนแรกเท่านั้น)

```mermaid
sequenceDiagram
    autonumber
    actor A1 as แอดมิน A
    actor A2 as แอดมิน B (เห็นคิวเดียวกัน)
    participant API as Backend API
    participant PG as PostgreSQL
    participant WS as WebSocket

    A1->>API: GET /v1/admin/support-tickets?status=open
    API->>PG: หา ticket ตาม status ที่กรอง (join ผู้แจ้ง, แอดมินที่รับเรื่อง)
    API-->>A1: 200 [รายการในคิว]

    A1->>API: PATCH /v1/admin/support-tickets/:id (body ว่างก็ได้ — แค่กด "เปิด Ticket")
    API->>PG: หา ticket → 404 NOT_FOUND ถ้าไม่พบ
    alt มีแอดมินคนอื่น claim ไปแล้ว (assignedAdminId ตั้งไว้ ไม่ใช่ A1)
        API-->>A1: 403 TICKET_CLAIMED_BY_OTHER_ADMIN
    else ยังไม่มีใคร claim
        API->>PG: ตั้ง assignedAdminId = A1, มาร์ค adminLastReadAt=now
        API->>WS: emit('changed') เข้าห้อง ticket:&lt;id&gt; + emit('support-ticket-changed') broadcast
        API-->>A1: 200 &lt;ticket พร้อม assignedAdmin&gt;
    end

    Note over A2,API: A2 พยายาม claim ตั๋วเดียวกันหลัง A1 ไปแล้ว
    A2->>API: PATCH /v1/admin/support-tickets/:id
    API->>PG: เช็ค assignedAdminId — เจอว่าเป็น A1 ไม่ใช่ A2
    API-->>A2: 403 TICKET_CLAIMED_BY_OTHER_ADMIN
    Note right of API: A2 ยังดู/อ่านเคสนี้ได้ปกติผ่าน GET แค่ตอบ/ปิดเคสไม่ได้เท่านั้น
```

## 3. คุยกันจนจบเคส แล้วปิด

```mermaid
sequenceDiagram
    autonumber
    actor U as ผู้ใช้/ร้านค้า
    actor A as แอดมินที่รับเรื่อง
    participant API as Backend API
    participant PG as PostgreSQL
    participant WS as WebSocket

    U->>API: GET /v1/support-tickets/:id
    API->>PG: หา ticket → 404 NOT_FOUND
    alt ไม่ใช่คนแจ้งเรื่องเอง
        API-->>U: 403 FORBIDDEN
    else
        API->>PG: มาร์ค userLastReadAt=now (ไม่ emit — กัน loop เหมือนแชท)
        API-->>U: 200 &lt;รายละเอียดเต็ม + ข้อความทั้งหมด&gt;
    end

    U->>API: POST /v1/support-tickets/:id/messages { message }
    alt message ว่าง
        API-->>U: 400 MESSAGE_REQUIRED
    else ไม่ใช่เจ้าของเรื่อง
        API-->>U: 403 FORBIDDEN
    else ticket ปิดไปแล้ว
        API-->>U: 409 TICKET_CLOSED
    else ผ่าน
        API->>PG: create SupportMessage (senderType:'user'), update userLastReadAt
        API->>WS: emit('changed') ห้อง ticket:&lt;id&gt; + emit('support-ticket-changed') broadcast
        API-->>U: 201 &lt;message&gt;
    end

    A->>API: PATCH /v1/admin/support-tickets/:id { status?, message?, resolution_note? }
    alt ticket ปิดอยู่แล้ว และพยายามส่งข้อความใหม่
        API-->>A: 409 TICKET_CLOSED
    else status ที่ส่งมาไม่ใช่ open/investigating/resolved/closed
        API-->>A: 400 INVALID_STATUS
    else ผ่าน
        Note over API,PG: === transaction เดียว ===
        opt มี message
            API->>PG: create SupportMessage (senderType:'admin'), update adminLastReadAt
        end
        API->>PG: update ticket (status, resolvedAt ถ้า resolved/closed, resolution_note)
        API->>WS: emit('changed') ห้อง ticket:&lt;id&gt; + emit('support-ticket-changed') broadcast
        WS-->>U: แจ้งเตือนสด
        API-->>A: 200 &lt;ticket ที่อัปเดตแล้ว&gt;
    end
```
