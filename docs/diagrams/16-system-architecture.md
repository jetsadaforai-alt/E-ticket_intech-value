# System Architecture

> เอกสารเทคนิค — เวอร์ชันของแต่ละ tech เช็คจาก `backend/package.json`, `admin-web/package.json`,
> `mobile/package.json` ขั้นตอนติดตั้งจริงดู [docs/HANDOVER.md](../HANDOVER.md) หัวข้อ "ติดตั้งบนเซิร์ฟเวอร์"

## 1. Dev/Local — `docker compose up` บนเครื่องเดียว

ทุก service รันในเครื่องเดียวผ่าน `docker-compose.yml` (root ของ repo) — ใช้ตอนพัฒนา/ทดสอบ

```mermaid
flowchart TB
    Dev[นักพัฒนา / เครื่อง local]
    ExpoGo[Expo Go บนมือถือจริง<br/>สแกน QR ผ่าน LAN]

    subgraph Host[เครื่อง local — Docker Compose stack เดียว]
        Backend["backend<br/>Express 4 + Prisma 5<br/>port 3000"]
        AdminWeb["admin-web<br/>Next.js 16 + React 19<br/>port 3001"]
        Mobile["mobile<br/>Expo ~57 + React Native 0.86<br/>Metro port 8081"]
        Studio["prisma-studio (profile dev)<br/>127.0.0.1:5555"]
        PG[("postgres:16-alpine<br/>127.0.0.1:5434→5432<br/>volume: eticket_pgdata")]
        Redis[("redis:7-alpine<br/>127.0.0.1:6381→6379<br/>OTP 5 นาที, QR token 60 วินาที")]
        Uploads[["uploads/ (volume)<br/>รูป event/product/<br/>เอกสาร vendor"]]
    end

    Dev -->|เปิดเบราว์เซอร์| AdminWeb
    Dev -->|"docker compose --profile dev up prisma-studio"| Studio
    ExpoGo -->|"exp://LAN-IP:8081"| Mobile

    Mobile -->|"EXPO_PUBLIC_API_BASE_URL"| Backend
    AdminWeb -->|"NEXT_PUBLIC_API_BASE_URL<br/>(inline ตอน build)"| Backend
    Backend --> PG
    Backend --> Redis
    Backend --> Uploads
    Studio --> PG
```

**ข้อควรรู้**: `mobile`/`admin-web` container ไม่มี source volume mount — แก้โค้ดแล้วต้อง
`docker compose up -d --build <service>` ใหม่เสมอ ไม่ใช่แค่ `restart`

## 2. Production — VM เครื่องเดียว

ระบบต้นแบบติดตั้งบน VM เครื่องเดียว (Google Compute Engine e2-medium) บนเซิร์ฟเวอร์ไม่รัน service
`mobile` (Metro ใช้แค่ตอนพัฒนา — ผู้ใช้จริงติดตั้งแอปจาก APK ที่ build ด้วย EAS)

```mermaid
flowchart TB
    App["แอปมือถือ (APK)<br/>EXPO_PUBLIC_API_BASE_URL = api.โดเมน"]
    Browser["เบราว์เซอร์ของแอดมิน"]

    subgraph VM["VM — Docker Compose + Caddy"]
        Caddy["Caddy (systemd)<br/>auto-HTTPS (Let's Encrypt)<br/>reverse proxy"]
        BackendVM["backend (Docker)<br/>localhost:3000"]
        AdminVM["admin-web (Docker)<br/>localhost:3001"]
        PGVM[("postgres (Docker)")]
        RedisVM[("redis (Docker)")]
        UploadsVM[["uploads/ (volume)"]]
    end

    App -->|"HTTPS api.โดเมน"| Caddy
    Browser -->|"HTTPS admin.โดเมน"| Caddy
    Caddy --> BackendVM
    Caddy --> AdminVM
    BackendVM --> PGVM
    BackendVM --> RedisVM
    BackendVM --> UploadsVM
```

**ข้อจำกัดของรูปแบบนี้**:
- **เครื่องเดียว ไม่มี load balancer/CDN/หลาย instance** — ถ้าเครื่องล่ม ระบบล่มทั้งหมด
  (e2-medium ควรเปิด swap ไว้ เคยเจอ RAM หมดตอน build image)
- **postgres/redis เป็น container บนเครื่องเดียวกับ backend** ไม่ใช่ managed service — สำรองข้อมูลเอง
  (`pg_dump` + volume `eticket_uploads`)
- **ไม่มี secret manager และ CI/CD** — `.env` ทั้งสองไฟล์สร้างบนเครื่องเอง, deploy ด้วย `git pull` +
  `docker compose up -d --build`
