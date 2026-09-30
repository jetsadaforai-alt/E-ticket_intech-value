# E-ticket Mini

แพลตฟอร์มตั๋วส่วนลดอิเล็กทรอนิกส์สำหรับร้านค้าหลายร้าน (Multi-vendor) — ร้านค้าสร้างอีเวนต์และออก
ตั๋วส่วนลดตามโควตาแพ็กเกจ ลูกค้ารับตั๋วเข้า Wallet ในแอป แล้วแสดง **Dynamic QR Code** (เปลี่ยนรหัส
ทุก 60 วินาที) ให้พนักงานหน้าร้านสแกนเพื่อใช้สิทธิ์ ผู้ดูแลระบบจัดการร้านค้า อีเวนต์ ผู้ใช้ และเรื่องร้องเรียน
ผ่านเว็บหลังบ้าน

| ส่วน | เทคโนโลยี | โฟลเดอร์ | ใช้โดย |
|---|---|---|---|
| Backend API | Node.js 20 + Express, Prisma ORM, Socket.IO | `backend/` | ทุกส่วน |
| ฐานข้อมูล / แคช | PostgreSQL 16, Redis 7 | (Docker image) | backend |
| แอปมือถือ | React Native (Expo SDK 57) | `mobile/` | ลูกค้า, เจ้าของร้าน, พนักงาน |
| เว็บหลังบ้าน | Next.js | `admin-web/` | Admin, SuperAdmin |

เอกสารสำหรับทีมที่รับช่วงต่อ (สถาปัตยกรรม, env ทั้งหมด, การ deploy, ข้อจำกัดที่รู้อยู่) อยู่ที่
**[docs/HANDOVER.md](docs/HANDOVER.md)** ส่วนแผนภาพลำดับการทำงานของแต่ละ API อยู่ที่
[docs/diagrams/](docs/diagrams/00-index.md)

## รันบนเครื่องพัฒนา (Docker)

ทั้งระบบรันด้วย Docker คำสั่งเดียว ไม่ต้องติดตั้ง Node.js บนเครื่อง

**ต้องมี:** Docker (Desktop หรือ Engine + Compose v2), มือถือ Android/iOS ที่ติดตั้งแอป **Expo Go**
และต่อ WiFi วงเดียวกับเครื่องที่รัน

1. สร้างไฟล์ตั้งค่า 2 ไฟล์

   ```
   cp .env.example .env
   cp backend/.env.example backend/.env
   ```

   แก้ `.env` (root) ใส่ IP ของเครื่องบนวง LAN ใน `HOST_LAN_IP` และ `BACKEND_PUBLIC_URL`
   (หา IP ด้วย `ipconfig` บน Windows หรือ `ip addr` บน Linux) — `backend/.env` ใช้ค่าตั้งต้นได้เลย
   แต่ควรเปลี่ยน `JWT_SECRET` เป็นค่าสุ่มยาว ๆ

2. รันทั้งระบบ

   ```
   docker compose up --build
   ```

   รอบแรกใช้เวลาหลายนาทีเพราะต้อง build image ทั้ง 3 ตัว backend จะ migrate ฐานข้อมูล สร้างบัญชี
   SuperAdmin + แพ็กเกจ 4 ระดับ และ (ถ้า `SEED_DEMO_DATA=true`) ร้าน/อีเวนต์ตัวอย่างให้อัตโนมัติ

3. ตรวจว่าขึ้นครบ

   - backend: `http://localhost:3000/v1/health` → `{"status":"ok"}`
   - เว็บหลังบ้าน: `http://localhost:3001`

4. เปิดแอปบนมือถือ — เปิด Expo Go แล้วสแกน QR ใน log ของ service `mobile`
   (`docker compose logs -f mobile`)

## บัญชีเริ่มต้น

- **เว็บหลังบ้าน (SuperAdmin):** `superadmin` / `ChangeMe123!` แล้วยืนยัน OTP ของเบอร์ `0800000000`
  — ในโหมดพัฒนารหัส OTP จะแสดงบนหน้าจอ ตั้งค่าอื่นได้ด้วย `SEED_SUPERADMIN_USERNAME` /
  `SEED_SUPERADMIN_PASSWORD` / `SEED_SUPERADMIN_PHONE` ใน `backend/.env` **ก่อน** รันครั้งแรก
  และ **ต้องเปลี่ยนรหัสผ่านก่อนใช้งานจริง** (เมนูโปรไฟล์ในเว็บหลังบ้าน)
- **แอปมือถือ:** สมัครสมาชิกด้วยเบอร์ใดก็ได้ (10 หลัก ขึ้นต้นด้วย 0) — ในโหมดพัฒนาระบบไม่ส่ง SMS
  จริง แต่แสดงรหัส OTP ในแอปและกรอกให้อัตโนมัติ ต้องสมัครก่อนจึงเข้าสู่ระบบได้
- **ร้านตัวอย่าง** (เมื่อ `SEED_DEMO_DATA=true`): สร้างจาก `backend/scripts/seedDemoData.js`

## คำสั่งที่ใช้บ่อย

```
docker compose down                          # หยุดระบบ (ข้อมูลยังอยู่ใน Docker volume)
docker compose logs -f backend               # ดู log (backend / admin-web / mobile / postgres / redis)
docker compose up -d --build mobile          # แก้โค้ดแอปแล้ว ต้อง build ใหม่ (ไม่ได้ mount source)
docker compose --profile dev up prisma-studio   # เปิดดูฐานข้อมูลที่ http://localhost:5555
```

เทสต์ของ backend (ใช้ฐานข้อมูล `<ชื่อ DB>_test` แยกต่างหาก ไม่ลบข้อมูลที่ใช้พัฒนา):

```
cd backend && npm install && npm test        # ต้องมี Postgres/Redis จาก docker compose รันอยู่
```

## แก้ปัญหาเบื้องต้น

- **`port is already allocated`** — มีโปรแกรมอื่นใช้พอร์ต 3000/3001/5434/6381 อยู่ หยุดตัวนั้นก่อน
  (`docker ps` ดูว่าตัวไหนถือพอร์ต)
- **backend ต่อฐานข้อมูลไม่ได้ (log ขึ้น `P1001`)** — `docker compose up -d --force-recreate postgres redis`
  แล้วรอ backend restart เอง
- **แอปเปิดได้แต่โหลดข้อมูลไม่ขึ้น** — เช็คว่า `HOST_LAN_IP` / `BACKEND_PUBLIC_URL` ตรงกับ IP ปัจจุบัน
  และมือถืออยู่ WiFi เดียวกัน แก้ `.env` แล้วสั่ง `docker compose up -d --build mobile`
