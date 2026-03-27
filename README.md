# User Management System API

RESTful API สำหรับระบบจัดการผู้ใช้งาน พัฒนาด้วย Node.js + Express.js และ MySQL

---

## 7. Framework และ Database ที่เลือก

| ส่วน | เทคโนโลยี | เหตุผล |
|------|-----------|--------|
| Runtime | Node.js 20 | Non-blocking I/O เหมาะกับ REST API ที่มี concurrent requests สูง |
| Framework | Express.js 5 | Minimal, flexible, ecosystem ใหญ่ รองรับ middleware pattern ได้ดี |
| Database | MySQL 8.0 | ACID compliant, รองรับ ENUM type สำหรับ role, คุ้นเคยกับ schema ที่กำหนด |
| ORM/Driver | mysql2/promise | Native Promise support, เร็วกว่า mysql package เดิม |
| Auth | JWT (jsonwebtoken) | Stateless, รองรับ refresh token + blacklist pattern |
| Password | bcrypt (salt rounds 10) | Industry standard, ป้องกัน rainbow table attack |

---

## 1. ขั้นตอนติดตั้งและรัน Project

### วิธีที่ 1 — Docker Compose (แนะนำ)

```bash
# Clone หรือ extract โปรเจค
git clone <your-repo-url>
cd backend_developer_test

# คัดลอก environment file
cp .env.example .env

# รัน services ทั้งหมด (MySQL + phpMyAdmin + App)
docker compose up --build
```

API จะพร้อมใช้งานที่ `http://localhost:3000`

### วิธีที่ 2 — รันตรงบน Local (ต้องมี MySQL รันอยู่ก่อน)

```bash
npm install
cp .env.example .env
# แก้ไข .env ให้ตรงกับ MySQL ของคุณ
node seed.js        # สร้าง Seed data
node index.js       # รัน server
```

---

## 2. Environment Variables

สร้างไฟล์ `.env` จาก `.env.example`:

```bash
cp .env.example .env
```

| Variable | Default | คำอธิบาย |
|----------|---------|----------|
| `PORT` | `3000` | Port ของ Backend server |
| `DB_HOST` | `db` | Host ของ MySQL (ใช้ `localhost` ถ้ารันนอก Docker) |
| `DB_PORT` | `3306` | Port ของ MySQL |
| `DB_NAME` | `webdb` | ชื่อ Database |
| `DB_USER` | `root` | MySQL username |
| `DB_PASSWORD` | `root` | MySQL password |
| `JWT_SECRET` | — | **ต้องตั้งค่าเอง** Secret key สำหรับ JWT signing |
| `JWT_EXPIRES_IN` | `15m` | อายุ Access Token |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | อายุ Refresh Token |
| `ALLOWED_ORIGINS` | `*` | CORS allowed origins (คั่นด้วย `,` หลาย origins) |

---

## 3. Database Migration และ Seed Data

### Migration (สร้าง Schema)

Schema ถูกกำหนดไว้ใน `webdb.sql` นำเข้าด้วย:

```bash
# ผ่าน phpMyAdmin: http://localhost:8701
# หรือผ่าน CLI:
mysql -h 127.0.0.1 -P 8700 -u root -proot webdb < webdb.sql
```

Schema ประกอบด้วย 2 ตาราง:
- `users` — เก็บข้อมูลผู้ใช้ พร้อม role, is_active, refresh_token
- `token_blacklist` — เก็บ JWT token ที่ถูก revoke แล้ว (logout)

### Seed Data

```bash
# รัน seed script (สร้าง admin + user เริ่มต้น)
node seed.js

# หรือถ้า DB อยู่ใน Docker:
DB_HOST=localhost DB_PORT=8700 node seed.js
```

Seed จะสร้างผู้ใช้ 2 คน (ดูรายละเอียดหัวข้อ 6)

---

## 4. วิธีรัน Test Suite

```bash
npm test
```

Test ครอบคลุม Authentication, Authorization, และ CRUD operations อย่างน้อย 15 test cases

---

## 5. API Documentation (Swagger)

เปิด browser แล้วไปที่:

**`http://localhost:3000/api-docs`**

Features ใน Swagger UI:
- ทุก Endpoint มี Request/Response schema พร้อม example
- กด **Authorize** → ใส่ JWT Access Token เพื่อทดสอบ Protected routes
- รองรับ Bearer Token authentication scheme

### Endpoints สรุป

| Method | Path | Auth | คำอธิบาย |
|--------|------|------|----------|
| `POST` | `/api/auth/register` | Public | สมัครสมาชิก |
| `POST` | `/api/auth/login` | Public | เข้าสู่ระบบ (Rate limit: 5/นาที) |
| `POST` | `/api/auth/logout` | Bearer | ออกจากระบบ + blacklist token |
| `GET` | `/api/auth/me` | Bearer | ดูข้อมูลตัวเอง |
| `POST` | `/api/auth/refresh` | — | ต่ออายุ Access Token |
| `GET` | `/api/users` | Admin | ดูรายการ users ทั้งหมด (pagination + filter) |
| `GET` | `/api/users/:id` | Admin/Owner | ดูข้อมูล user รายบุคคล |
| `PUT` | `/api/users/:id` | Admin/Owner | แก้ไขข้อมูล user |
| `DELETE` | `/api/users/:id` | Admin | ลบ user |
| `PATCH` | `/api/users/:id/status` | Admin | เปิด/ปิด account |

---

## 6. Account สำหรับทดสอบ (จาก Seed Data)

### Admin Account
| Field | Value |
|-------|-------|
| Email | `admin@example.com` |
| Password | `Admin@1234` |
| Role | `admin` |
| สิทธิ์ | จัดการ users ทุกคน, เข้าถึงทุก endpoint |

### User Account
| Field | Value |
|-------|-------|
| Email | `user@example.com` |
| Password | `User@1234` |
| Role | `user` |
| สิทธิ์ | แก้ไขได้เฉพาะ account ตัวเอง |

### วิธีทดสอบ Login

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"Admin@1234"}'
```

นำ `accessToken` ที่ได้ไปใส่ใน Swagger UI หรือ Header `Authorization: Bearer <token>`

---

## โครงสร้างโปรเจค

```
backend_developer_test/
├── index.js          # Main application (routes + middleware + Swagger)
├── seed.js           # Seed data script
├── webdb.sql         # Database schema + initial data
├── package.json      # Dependencies
├── docker-compose.yml
├── .env.example      # Environment variables template
└── README.md
```

---

## Security Features

- **bcrypt** password hashing (salt rounds 10)
- **JWT** Access Token (15 นาที) + Refresh Token (7 วัน)
- **Token blacklist** — revoke token ทันทีเมื่อ logout
- **Rate limiting** — login endpoint จำกัด 5 ครั้ง/นาที
- **Helmet.js** — ตั้งค่า HTTP Security Headers
- **RBAC** — Admin vs User role separation
- **Input validation** — ตรวจสอบ name, email, password, role
- **Password ไม่ถูกส่งกลับ** ใน Response ทุกกรณี