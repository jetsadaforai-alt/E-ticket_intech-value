# E-ticket Mini — เอกสารส่งมอบระบบ

เอกสารนี้สำหรับทีมที่รับช่วงดูแลและพัฒนาต่อ อ่านคู่กับ [README.md](../README.md) (วิธีรันบนเครื่อง)
และ [docs/diagrams/](diagrams/00-index.md) (แผนภาพลำดับการทำงานของแต่ละ API อ้างอิงโค้ดจริง)

สารบัญ: [ภาพรวม](#ภาพรวม) · [สถาปัตยกรรม](#สถาปัตยกรรม) · [โครงสร้างโค้ด](#โครงสร้างโค้ด) ·
[กระบวนการหลัก](#กระบวนการหลัก) · [แพ็กเกจและโควตา](#แพ็กเกจและโควตา) · [ค่าตั้งค่า](#ค่าตั้งค่า-environment-variables) ·
[ติดตั้งบนเซิร์ฟเวอร์](#ติดตั้งบนเซิร์ฟเวอร์) · [Build แอปมือถือ](#build-แอปมือถือ-apk) ·
[ต่อระบบจริงแทนระบบจำลอง](#ต่อระบบจริงแทนระบบจำลอง) · [เทสต์](#เทสต์) · [ข้อจำกัดและงานค้าง](#ข้อจำกัดและงานค้าง)

---

## ภาพรวม

ผู้ใช้ 5 บทบาท — 3 บทบาทแรกใช้ **แอปมือถือตัวเดียวกันและบัญชีเดียวกัน** (สลับโหมดในแอป) อีก 2
บทบาทใช้เว็บหลังบ้านและบัญชีแยก

| บทบาท | ช่องทาง | ทำอะไรได้ |
|---|---|---|
| ลูกค้า | แอป | สมัคร/เข้าสู่ระบบด้วยเบอร์โทร + OTP, ดูอีเวนต์, รับตั๋ว (1 ใบต่ออีเวนต์), แสดง QR, แชร์ตั๋วให้เพื่อน, แชทกับร้าน, รีวิว, แจ้งปัญหา |
| เจ้าของร้าน | แอป | สมัครเป็นร้าน (รอ Admin อนุมัติ), ตั้งค่าร้าน, สินค้า, สร้างอีเวนต์ตามโควตา, เชิญพนักงาน, ซื้อแพ็กเกจ/เติมโควตา, แดชบอร์ด, สแกนได้เอง |
| พนักงาน | แอป | สแกน QR ลูกค้า, เลือกสินค้าที่ใช้สิทธิ์, ดูสรุปการสแกนวันนี้, ตอบแชทลูกค้า |
| Admin | เว็บ | อนุมัติ/ปฏิเสธ/ระงับร้าน, ระงับอีเวนต์, ระงับผู้ใช้, ตอบเรื่องร้องเรียน (Support Ticket) |
| SuperAdmin | เว็บ | ทุกอย่างของ Admin + ตั้งราคา/โควตาแพ็กเกจ, จัดการบัญชี Admin, แดชบอร์ดรายได้ทั้งระบบ |

พนักงานต้อง **สมัครสมาชิกในแอปก่อน** เจ้าของร้านจึงเชิญด้วยเบอร์โทรได้ พนักงานตอบรับคำเชิญในหน้าการแจ้งเตือน

## สถาปัตยกรรม

```
 แอปมือถือ (Expo) ──┐                         ┌── PostgreSQL 16  (ข้อมูลหลัก 30 ตาราง, Prisma)
                    ├─ HTTPS ─ Caddy ─ Backend ┼── Redis 7        (OTP 5 นาที, QR token 60 วินาที)
 เว็บหลังบ้าน (Next.js)┘   (reverse proxy)  :3000 └── volume uploads (รูป/เอกสาร ผ่าน Multer)
                                     admin-web :3001
```

- **Backend** (`backend/`) — Express REST API ภายใต้ `/v1` + Socket.IO บนพอร์ตเดียวกัน (3000)
  - Socket.IO ใช้เฉพาะ **แชทลูกค้า–ร้าน** และ **Support Ticket** (`backend/src/services/realtime.js`)
  - การแจ้งเตือนในแอปใช้การดึงข้อมูลทุก 30 วินาที (ไม่ใช่ push)
  - งานเบื้องหลัง `backend/src/services/eventExpiry.js` ทำงานทุก 5 นาที: อีเวนต์ที่เลยเวลาจบ →
    สถานะ `expired`, คืนโควตาตั๋วที่ยังไม่มีคนรับให้ร้าน, ยกเลิกตั๋วที่ยังไม่มีคนรับ
  - ทุก router สร้างผ่าน `backend/src/lib/asyncRouter.js` เพื่อให้ error ใน handler แบบ async
    ไปถึงตัวจัดการ error กลางใน `app.js` เสมอ (ไม่ทำให้ process ล่ม)
- **Admin Web** (`admin-web/`) — Next.js เรียก API ชุดเดียวกันผ่าน `/v1/admin/*` และ `/v1/superadmin/*`
  เข้าสู่ระบบ 2 ขั้น: username + password แล้วยืนยัน OTP ของเบอร์ที่ผูกกับบัญชีแอดมิน
- **แอปมือถือ** (`mobile/`) — Expo SDK 57 แอปเดียว 3 โหมด (ลูกค้า/ร้าน/พนักงาน) URL ของ backend
  ถูกฝังตอน build จาก `EXPO_PUBLIC_API_BASE_URL`
- **ไฟล์อัปโหลด** — เก็บในดิสก์ของเซิร์ฟเวอร์ (Docker volume `eticket_uploads`) เสิร์ฟที่ `/uploads/*`

## โครงสร้างโค้ด

```
backend/
  prisma/schema.prisma        โครงสร้างฐานข้อมูลทั้งหมด (มีคำอธิบายแต่ละตาราง)
  prisma/migrations/          migration ตามลำดับ — รันอัตโนมัติตอน container เริ่ม
  prisma/seed.js              SuperAdmin คนแรก + แพ็กเกจ 4 ระดับ (ค่ามาจาก packageCatalog.js)
  scripts/seedDemoData.js     ร้าน/อีเวนต์ตัวอย่าง (ปิดด้วย SEED_DEMO_DATA=false)
  src/app.js                  รวม route ทั้งหมด — ดูว่า path ไหนไปไฟล์ไหนได้ที่นี่
  src/routes/                 หนึ่งไฟล์ต่อกลุ่มฟีเจอร์ (auth, events, tickets, staffScan, shops, purchases, ...)
  src/services/               logic ที่ใช้ร่วม: otp, qrToken, quota, eventExpiry, realtime, smsProvider, payment/
  test/                       เทสต์แบบ end-to-end ยิง HTTP จริง (node:test)
admin-web/app/                หนึ่งโฟลเดอร์ต่อหน้า (login, dashboard, vendors, events, users, support, packages, admins, profile)
mobile/src/
  navigation/RootNavigator.tsx   รายการหน้าจอทั้งหมด + พารามิเตอร์ของแต่ละหน้า
  screens/                    หนึ่งไฟล์ต่อหน้าจอ
  api/                        client.ts (เรียก API + token), errorMessages.ts (ข้อความ error ภาษาไทยทุกตัว)
  context/                    AuthContext (ผู้ใช้ที่ login), ModeContext (โหมดลูกค้า/ร้าน/พนักงาน)
  theme.ts, components/       สี ตัวอักษร (IBM Plex Sans Thai) และ component กลาง
docker-compose.yml            รันทั้งระบบบนเครื่องพัฒนา
deploy/Caddyfile.example      ตัวอย่าง reverse proxy + HTTPS สำหรับเซิร์ฟเวอร์
```

## กระบวนการหลัก

รายละเอียดแต่ละ API (รวมทุกกรณี error) อยู่ใน `docs/diagrams/` — สรุปกติกาสำคัญ:

- **สมัคร / เข้าสู่ระบบ** — `POST /v1/auth/otp/request` และ `/verify` ต้องส่ง `purpose: "login" | "register"`
  - `login` กับเบอร์ที่ยังไม่สมัคร → `404 NOT_REGISTERED` (ไม่ส่ง OTP ไม่สร้างบัญชี)
  - `register` กับเบอร์ที่มีแล้ว → `409 ALREADY_REGISTERED`
  - OTP อายุ 5 นาที ขอใหม่ได้หลัง 60 วินาที ใส่ผิด 5 ครั้งถูกล็อก 15 นาที (`backend/src/services/otp.js`)
  - verify สำเร็จได้ JWT อายุ 7 วัน สมัครเสร็จแล้วเข้าสู่ระบบให้ทันที
- **รับตั๋ว** — ตัดจำนวนตั๋วคงเหลือในคำสั่งเดียว (ไม่มีสองคนได้ใบเดียวกัน) จำกัด 1 ใบต่ออีเวนต์ต่อบัญชี
- **Dynamic QR** (`backend/src/services/qrToken.js`) — ทุกครั้งที่แอปขอ เซิร์ฟเวอร์สุ่มโทเคน 128 บิต
  เก็บใน Redis ว่าเป็นของตั๋วใบไหน อายุ 60 วินาที แอปขอใหม่ก่อนหมดอายุ ~5 วินาที ไม่มีการคำนวณ
  ฝั่งมือถือ (ไม่ใช่ TOTP) ตรวจทุกอย่างที่เซิร์ฟเวอร์
- **สแกน** (`POST /v1/staff/scan`) — ตรวจตามลำดับ: โทเคนยังไม่หมดอายุ → ผู้สแกนเป็นพนักงาน active ของร้าน →
  ตั๋วสถานะ `ISSUED` → อีเวนต์ไม่ถูกแบนและยังไม่จบ → อยู่ในช่วงเวลาใช้สิทธิ์ (ถ้าร้านกำหนด)
  แล้วเปลี่ยนตั๋วเป็น `REDEEMED` + บันทึกการใช้สิทธิ์ใน transaction เดียว
  - อีเวนต์ที่ผูกสินค้า: บันทึก "ส่วนลดสำรอง" ไว้ก่อน แล้วพนักงานยืนยันสินค้าที่ลูกค้าเลือก
    (`PATCH /v1/staff/redemptions/:id/product`) ระบบจึงสรุปยอดส่วนลดจริง — ดูข้อจำกัดข้อ 1
- **แชร์ตั๋ว** — สร้างรหัสแชร์อายุ 24 ชั่วโมง เพื่อนกดรับภายในเวลา ตั๋วย้ายไป Wallet ของเพื่อน
  หมดอายุแล้วตั๋วยังอยู่กับเจ้าของเดิม

## แพ็กเกจและโควตา

โมเดลธุรกิจแบบซื้อล่วงหน้าต่ออีเวนต์ (ไม่ใช่รายเดือน) ค่าตั้งต้นอยู่ใน `backend/prisma/packageCatalog.js`
(SuperAdmin แก้ราคา/โควตาได้ในเว็บหลังบ้าน — seed จะไม่เขียนทับค่าที่แก้แล้ว)

| แพ็กเกจ | ราคา | อีเวนต์ | ตั๋ว/อีเวนต์ (เพดาน) | ตั๋วรวม | เติม 1 อีเวนต์ | เติมตั๋ว |
|---|---|---|---|---|---|---|
| Free | 0 ฿ | 1 | 5 | 5 | — | — |
| Copper | 59 ฿ | 3 | 10 | 30 | 25 ฿ (+10 ตั๋ว) | 10 ฿ / 10 ใบ |
| Silver | 199 ฿ | 5 | 50 | 250 | 45 ฿ (+50 ตั๋ว) | 35 ฿ / 50 ใบ |
| Gold | 350 ฿ | 8 | 100 | 800 | 50 ฿ (+100 ตั๋ว) | 40 ฿ / 100 ใบ |

กติกา (`backend/src/services/quota.js`):
- ร้านมี 2 ยอด: **ตั๋วรวม** และ **สิทธิ์สร้างอีเวนต์** + **เพดานตั๋วต่ออีเวนต์** จากแพ็กเกจ — ยอดรวมกับเพดาน
  เป็นข้อจำกัดแยกกัน (Copper มี 30 ใบ แต่ใส่ในอีเวนต์เดียวได้แค่ 10)
- ร้านที่ Admin อนุมัติจะได้แพ็กเกจ Free อัตโนมัติ สร้างอีเวนต์แรกได้ทันที
- สร้างอีเวนต์ = หักโควตาในขั้นตอนเดียวกัน, ยกเลิก/หมดเวลา = คืนตั๋วที่ยังไม่มีคนรับ
- ซื้อแพ็กเกจได้เฉพาะระดับที่สูงกว่าปัจจุบัน (กันซื้อแพ็กเกจถูกซ้ำเพื่อหลบราคาเติม), Free เติมไม่ได้
- ราคาเติมตั้งให้แพงกว่าซื้อแพ็กเกจ ~25% เพื่อให้การอัปเกรดคุ้มกว่า
- ทุกการเปลี่ยนยอดบันทึกใน `quota_ledgers` (UNIQUE reason+ref_id กันคืนโควตาซ้ำ) และหักยอดด้วย
  UPDATE แบบมีเงื่อนไข ยอดจึงไม่ติดลบแม้มีคำขอพร้อมกัน

## ค่าตั้งค่า (Environment variables)

**`.env` (root) — อ่านโดย docker-compose**

| ตัวแปร | ความหมาย |
|---|---|
| `COMPOSE_PROJECT_NAME` | ชื่อ stack ของ Docker (ตั้งไม่ซ้ำถ้ามีหลายชุดบนเครื่องเดียว) |
| `HOST_LAN_IP` | IP เครื่องบน LAN ให้ Expo Go บนมือถือต่อ Metro ได้ (ใช้ตอนพัฒนา) |
| `BACKEND_PUBLIC_URL` | URL ของ backend ที่ฝังในแอปมือถือ (service `mobile`) และเว็บหลังบ้าน (build arg) |
| `SEED_DEMO_DATA` | `true` สร้างร้าน/อีเวนต์ตัวอย่างทุกครั้งที่ backend เริ่ม, `false` บนเซิร์ฟเวอร์จริง |

**`backend/.env` — อ่านโดย backend (dotenv)**

| ตัวแปร | ความหมาย |
|---|---|
| `DATABASE_URL`, `REDIS_URL` | ค่าในไฟล์ใช้ตอนรันนอก Docker — ใน docker-compose ถูกทับให้ชี้ container `postgres`/`redis` |
| `JWT_SECRET` | กุญแจเซ็น JWT — **ต้องตั้งค่าสุ่มยาว ๆ บนเซิร์ฟเวอร์จริง** |
| `PORT` | พอร์ต backend (ค่าเริ่มต้น 3000) |
| `NODE_ENV` | `production` จะปิด devCode ของ OTP แต่ต้องต่อ SMS/Payment จริงก่อน — ดู [ต่อระบบจริง](#ต่อระบบจริงแทนระบบจำลอง) |
| `PAYMENT_PROVIDER` | ชื่อ payment adapter (ค่าเริ่มต้น `mock`) |
| `SEED_SUPERADMIN_USERNAME` / `_PASSWORD` / `_PHONE` | บัญชี SuperAdmin แรก (ใช้ตอน seed ครั้งแรกเท่านั้น) |

**Build-time:** แอปมือถืออ่าน `EXPO_PUBLIC_API_BASE_URL`, เว็บหลังบ้านอ่าน `NEXT_PUBLIC_API_BASE_URL` —
ทั้งคู่ถูกฝังตอน build เปลี่ยน URL แล้วต้อง build ใหม่

## ติดตั้งบนเซิร์ฟเวอร์

ระบบต้นแบบเคยติดตั้งบน VM เครื่องเดียว (Google Compute Engine e2-medium, Ubuntu) แบบนี้:

1. ติดตั้ง Docker + Compose และ Caddy (`apt install caddy`) บนเครื่อง
2. clone repo, สร้าง `.env` และ `backend/.env` ตามตารางด้านบน โดยตั้ง
   `SEED_DEMO_DATA=false`, `BACKEND_PUBLIC_URL=https://api.<โดเมน>`, `JWT_SECRET` ใหม่,
   `SEED_SUPERADMIN_PASSWORD` ใหม่
3. รันเฉพาะ service ที่ใช้บนเซิร์ฟเวอร์ (ไม่ต้องมี `mobile` ซึ่งเป็น Metro สำหรับ Expo Go):
   ```
   docker compose up -d --build postgres redis backend admin-web
   ```
4. ตั้ง reverse proxy + HTTPS ด้วย `deploy/Caddyfile.example` (Caddy ขอใบรับรอง Let's Encrypt ให้เอง)
   ชี้โดเมน 2 ชื่อมาที่ IP ของเครื่อง แล้ว `sudo systemctl reload caddy`
5. Firewall เปิดแค่ 80/443 (และ 22 สำหรับ SSH) — Postgres/Redis/Prisma Studio ผูกกับ `127.0.0.1` อยู่แล้ว
6. อัปเดตเวอร์ชัน: `git pull` แล้ว `docker compose up -d --build backend admin-web` (migration รันเองตอนเริ่ม)
7. สำรองข้อมูล: volume `eticket_pgdata` (ฐานข้อมูล — ใช้ `pg_dump`) และ `eticket_uploads` (ไฟล์อัปโหลด)

## Build แอปมือถือ (APK)

ใช้ EAS Build ของ Expo กับบัญชี Expo ของบริษัท (ค่าที่ผูกกับบัญชีเดิมถูกเอาออกจาก `mobile/app.json` แล้ว)

```
cd mobile
npm install
npx eas-cli login
npx eas-cli init                  # สร้าง/ผูก EAS project ของบริษัท (เพิ่ม projectId + owner ใน app.json)
npx eas-cli update:configure      # ใส่ updates.url ให้ตรง project (profile ใช้ channel "preview")
```

แก้ `EXPO_PUBLIC_API_BASE_URL` ใน `mobile/eas.json` (profile `preview`) เป็น URL ของ backend จริง แล้ว

```
npx eas-cli build --platform android --profile preview
```

ได้ไฟล์ APK สำหรับแจกทดสอบ (internal distribution) — ถ้าจะขึ้น Play Store ให้เพิ่ม profile `production`
ที่ build เป็น `app-bundle`

## ต่อระบบจริงแทนระบบจำลอง

ตอนนี้ **SMS OTP** และ **การชำระเงิน** เป็นระบบจำลอง ทั้งสองตัว **ปฏิเสธการทำงานเมื่อ `NODE_ENV=production`**
โดยตั้งใจ (กันการเปิดใช้งานจริงทั้งที่ยังไม่ได้ส่ง SMS/ตรวจการจ่ายเงินจริง) — ผลคือตอนนี้เซิร์ฟเวอร์ต้องรัน
แบบไม่ใช่ production ซึ่ง **รหัส OTP จะถูกส่งกลับไปแสดงในแอป** (ใครรู้เบอร์ก็เข้าบัญชีได้)
ต้องทำ 2 ข้อนี้ก่อนเปิดให้คนทั่วไปใช้:

1. **SMS** — แก้ `sendSms()` ใน `backend/src/services/smsProvider.js` ให้เรียกผู้ให้บริการจริง
   (ในไฟล์มีตัวอย่างการต่อ Twilio) ไม่ต้องแก้ไฟล์อื่น
2. **Payment** — เขียน adapter ใหม่ใน `backend/src/services/payment/` ตามรูปแบบใน `index.js`
   (`createCharge`, `verifyCallback` ที่ต้องตรวจลายเซ็นของ webhook) ลงทะเบียนใน `PROVIDERS`
   แล้วตั้ง `PAYMENT_PROVIDER=<ชื่อ>` — webhook รับที่ `POST /v1/payments/webhook`

จากนั้นตั้ง `NODE_ENV=production` ใน `backend/.env`

## เทสต์

- Backend: `cd backend && npm test` — 129 เทสต์แบบ end-to-end ยิง HTTP จริง ใช้ฐานข้อมูล `<ชื่อ DB>_test`
  ที่สร้างให้อัตโนมัติ (`scripts/prepare-test-db.js`) ไม่แตะข้อมูลที่ใช้พัฒนา
  **ผลปัจจุบัน: ผ่าน 121 / ไม่ผ่าน 8** — ดูข้อจำกัดข้อ 2
- แอปมือถือ: `cd mobile && npx tsc --noEmit` (ตรวจ type) — ยังไม่มีเทสต์อัตโนมัติ
- เว็บหลังบ้าน: `cd admin-web && npm run build`

## ข้อจำกัดและงานค้าง

1. **สแกนแล้วตั๋วถูกใช้ทันที** ก่อนพนักงานยืนยันสินค้า — ถ้าพนักงานออกจากหน้าโดยไม่กดยืนยัน ระบบบันทึก
   ส่วนลดสำรองไว้และไม่มีหน้าให้กลับไปยืนยันภายหลัง แนวทางที่วางไว้: ให้การสแกนเป็นแค่การตรวจตั๋ว
   แล้วตัดสิทธิ์ตอนกดยืนยันใน transaction เดียว (ต้องแก้ `backend/src/routes/staffScan.js` +
   `mobile/src/screens/ScannerScreen.tsx` และกันกรณี QR หมดอายุระหว่างรอยืนยัน)
2. **เทสต์ไม่ผ่าน 8 ตัว** (`event-products.test.js` 7 ตัว, `event-expiry.test.js` 1 ตัว) — เขียนไว้ก่อนมี
   ส่วนลดรายสินค้า จึงไม่ได้ส่ง `product_discounts` / ส่วนลดสำรองตอนสร้างอีเวนต์ ต้องแก้ fixture ในเทสต์
   ไม่ใช่บั๊กของระบบ
3. **SMS และ Payment เป็นระบบจำลอง** — ดูหัวข้อด้านบน
4. **ปุ่มที่ยังไม่ทำงาน** (กดแล้วขึ้น "เร็ว ๆ นี้"): เข้าสู่ระบบด้วย LINE / Gmail, เปลี่ยนภาษา,
   ความเป็นส่วนตัว — คอลัมน์ `google_id` / `line_id` ในตาราง `users` เตรียมไว้แล้ว
5. **แพ็กเกจ Expo** — `npx expo-doctor` รายงานว่ามี 11 แพ็กเกจที่ตามหลังเวอร์ชันที่ SDK 57 แนะนำ (patch)
6. **ไฟล์อัปโหลดเก็บในดิสก์เครื่องเดียว** — ถ้าจะขยายเป็นหลายเครื่องต้องย้ายไป object storage
7. สิ่งที่ตั้งใจไม่ทำในเวอร์ชันนี้: ตั๋วแบบเบิกใช้บางส่วน (มียอดคงเหลือ), ร้านหลายสาขาต่อผู้ประกอบการ
   (ตอนนี้ 1 vendor = 1 shop), การใช้งานแบบออฟไลน์
