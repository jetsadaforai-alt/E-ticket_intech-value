# Sequence Diagrams — E-ticket (สารบัญ)

เอกสารชุดนี้ครอบคลุม **ทุก endpoint จริงในระบบ** ดึงมาจากการอ่านโค้ด backend ทุกไฟล์ตรง ๆ ไม่ใช่
แผนที่ยังไม่ได้ทำ — error case / status code / ชื่อ field ที่ระบุตรงกับโค้ด ณ เวอร์ชัน 1.0.0
ถ้าแก้โค้ดแล้วพฤติกรรมเปลี่ยน ควรแก้แผนภาพที่เกี่ยวข้องไปพร้อมกัน

รูปแบบ: mermaid `sequenceDiagram` ล้วน แต่ละไฟล์แยกตามกลุ่มความสามารถ (domain) ไม่ใช่แยกตามไฟล์โค้ด
เพื่อให้อ่านเป็น flow ธุรกิจได้ต่อเนื่อง

## รายการไฟล์

| ไฟล์ | ครอบคลุม |
|---|---|
| [01-auth-and-profile.md](./01-auth-and-profile.md) | OTP สมัคร/เข้าสู่ระบบ, ดู/แก้โปรไฟล์, เข้าสู่ระบบแอดมิน |
| [02-vendor-onboarding-and-moderation.md](./02-vendor-onboarding-and-moderation.md) | สมัครร้านค้า+เอกสาร, แอดมินอนุมัติ/ปฏิเสธ, อุทธรณ์, ระงับ/ปลดระงับร้าน |
| [03-shop-and-staff.md](./03-shop-and-staff.md) | สร้าง/แก้ร้าน, แดชบอร์ดร้าน, เชิญ/รับ/ถอดพนักงาน |
| [04-event-lifecycle.md](./04-event-lifecycle.md) | สร้าง/แก้/ยกเลิกอีเวนต์, รูปภาพ, ช่วงเวลาแลกตั๋ว, แอดมินแบนอีเวนต์ |
| [05-ticket-lifecycle-and-redemption.md](./05-ticket-lifecycle-and-redemption.md) | เปิดดู(guest), แลกตั๋ว, QR, พนักงานสแกน/แลกจริง, แชร์/รับตั๋ว |
| [06-products-and-reviews.md](./06-products-and-reviews.md) | จัดการสินค้า+รูป, ผูกสินค้ากับอีเวนต์, รีวิว+รูปแนบ |
| [07-packages-purchases-and-payment.md](./07-packages-purchases-and-payment.md) | ดูแพ็กเกจ, ซูเปอร์แอดมินแก้ราคา, ซื้อ/เติมโควตา, payment webhook |
| [08-chat.md](./08-chat.md) | แชทลูกค้า↔ร้านค้า, unread count |
| [09-support-tickets.md](./09-support-tickets.md) | แจ้งปัญหา, คิวแอดมิน, claim แบบ exclusive, ปิดเคส |
| [10-admin-accounts-and-superadmin.md](./10-admin-accounts-and-superadmin.md) | บัญชีแอดมิน, ระงับผู้ใช้, แดชบอร์ดซูเปอร์แอดมิน, การแจ้งเตือนในแอป |
| [11-realtime-websocket.md](./11-realtime-websocket.md) | กลไก WebSocket ที่ใช้ร่วมกันโดย chat และ support ticket |

ไฟล์ 00-11 ข้างบนเป็น **sequence diagram ระดับ endpoint** — อ่านโค้ด backend บรรทัดต่อบรรทัด
ไฟล์ 12-16 ด้านล่างเป็น **มุมมองสถาปัตยกรรม/ธุรกิจระดับสูงกว่า** (อ้างอิง schema.prisma +
docker-compose.yml + sequence diagram ข้างบนนี้เอง) เหมาะเอาไปประกอบเอกสารทางการ (SA spec) คู่กัน

| ไฟล์ | ครอบคลุม |
|---|---|
| [12-flowchart-key-processes.md](./12-flowchart-key-processes.md) | ผังงาน (decision flow) 3 กระบวนการหลัก: สร้างอีเวนต์, แลกตั๋ว+สแกน QR, สมัครร้านค้า→อนุมัติ→อุทธรณ์ |
| [13-erd.md](./13-erd.md) | Entity Relationship Diagram ครบ 28 entity พร้อม cardinality |
| [14-dfd.md](./14-dfd.md) | Context Diagram (Level 0) + Data Flow Diagram (Level 1) แยกตาม 6 กลุ่มความสามารถ |
| [15-use-case.md](./15-use-case.md) | Use Case Diagram แยกฝั่งลูกค้า/ร้านค้า และฝั่งแอดมิน/ซูเปอร์แอดมิน |
| [16-system-architecture.md](./16-system-architecture.md) | สถาปัตยกรรมระบบจริง: dev/local (docker compose เดียว) vs. production (GCP VM) |

## Actor หลักที่ปรากฏซ้ำทุกไฟล์

- **ลูกค้า (Customer)** — ผู้ใช้ทั่วไป ไม่มี vendor/shop เป็นของตัวเอง
- **ร้านค้า (Vendor/Shop)** — แบ่งย่อยเป็น owner (สร้างร้าน, ได้ role `manager` อัตโนมัติ), manager,
  staff (เชิญเข้ามา, ทำได้แค่สแกน QR กับดูข้อมูล — ไม่ใช่ manager)
- **แอดมิน (Admin)** — role `admin` ธรรมดา ดูแลงานประจำวัน (อนุมัติร้าน, จัดการ support ticket,
  ระงับผู้ใช้/ร้าน)
- **ซูเปอร์แอดมิน (Super Admin)** — เพิ่มสิทธิ์จัดการบัญชีแอดมินคนอื่นและราคาแพ็กเกจ

## Invariant ที่ตัดกันหลายไฟล์ (สำคัญสำหรับเขียนเอกสารทางการ)

1. **โควตาให้จริงแค่จุดเดียว**: payment webhook ยืนยันสำเร็จเท่านั้น ([07](./07-packages-purchases-and-payment.md)) — ไม่ใช่ตอนสร้างคำสั่งซื้อ
2. **การหักโควตา/แลกตั๋วทุกจุด ใช้ conditional UPDATE แบบ atomic** (ไม่ใช่ read-then-write) กัน
   race condition ตอนมีคนพร้อมกันหลายคน — เห็นได้ทั้งใน "สร้างอีเวนต์" ([04](./04-event-lifecycle.md)),
   "แลกตั๋ว" และ "สแกน QR" ([05](./05-ticket-lifecycle-and-redemption.md))
3. **แบน (admin) ≠ ยกเลิก (vendor เอง)**: แบนไม่คืนโควตาและยกเลิกตั๋วที่แลกไปแล้วด้วย (ISSUED) ส่วน
   vendor ยกเลิกเองจะคืนโควตาและกระทบเฉพาะตั๋วที่ยังไม่มีคนแลก (AVAILABLE) — ทั้งคู่ไม่แตะตั๋วที่
   REDEEMED ไปแล้ว
4. **ระงับผู้ใช้ ≠ ระงับร้านค้า**: คนละ endpoint คนละผลกระทบ ([02](./02-vendor-onboarding-and-moderation.md) vs [10](./10-admin-accounts-and-superadmin.md))
5. **WebSocket ไม่เคยพกข้อมูลจริง** มีหน้าที่แค่บอก "ไปโหลดใหม่" — REST ยังเป็นแหล่งข้อมูลเดียวเสมอ
   ([11](./11-realtime-websocket.md))
6. **Manager มีได้แค่คนเดียวต่อร้าน** (คนสร้างร้าน) ไม่มีทาง invite เพิ่มในตอนนี้
