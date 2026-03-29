// tests/api.test.js

// ─── ตั้ง DB env ก่อน require index ─────────────────────────────────────────
// index.js default DB_HOST = 'db' (Docker hostname)
// ตอนรัน test บน local ต้องเปลี่ยนเป็น localhost และ port ที่ map ออกมา
process.env.NODE_ENV  = 'test';          // ปิด rate limiter
process.env.DB_HOST = process.env.DB_HOST || 'localhost';
process.env.DB_PORT = process.env.DB_PORT || '8700';
process.env.DB_USER = process.env.DB_USER || 'root';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'root';
process.env.DB_NAME = process.env.DB_NAME || 'webdb';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const request = require('supertest');
const mysql   = require('mysql2/promise');
const bcrypt  = require('bcrypt');
const { app, initMYSQL } = require('../src/index');

let conn;

// ─── timeout 30s เพื่อรองรับการ connect DB ───────────────────────────────────
beforeAll(async () => {
    await initMYSQL();

    conn = await mysql.createConnection({
        host:     process.env.DB_HOST,
        user:     process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port:     parseInt(process.env.DB_PORT),
    });

    await conn.query(`
        CREATE TABLE IF NOT EXISTS users (
            id INT NOT NULL AUTO_INCREMENT,
            name VARCHAR(100) NOT NULL,
            email VARCHAR(255) NOT NULL,
            password VARCHAR(255) NOT NULL,
            role ENUM('admin','user') NOT NULL DEFAULT 'user',
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            refresh_token VARCHAR(500) DEFAULT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uq_email (email)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await conn.query(`
        CREATE TABLE IF NOT EXISTS token_blacklist (
            id INT NOT NULL AUTO_INCREMENT,
            token TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
}, 30000);

beforeEach(async () => {
    await conn.query('DELETE FROM token_blacklist');
    await conn.query('DELETE FROM users');
    await conn.query('ALTER TABLE users AUTO_INCREMENT = 1');

    const adminHash = await bcrypt.hash('Admin@1234', 10);
    const userHash  = await bcrypt.hash('User@1234', 10);

    await conn.query(
        `INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?), (?, ?, ?, ?)`,
        [
            'Admin System', 'admin@example.com', adminHash, 'admin',
            'Test User',    'user@example.com',  userHash,  'user',
        ]
    );
}, 30000);

afterAll(async () => {
    await conn.query('DELETE FROM token_blacklist');
    await conn.query('DELETE FROM users');
    await conn.end();
}, 30000);

async function loginAs(email, password) {
    const res = await request(app)
        .post('/api/auth/login')
        .send({ email, password });
    return res.body.data?.accessToken;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  AUTH TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/auth/register', () => {
    test('TC-01: ลงทะเบียนด้วยข้อมูลถูกต้อง → 201', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({ name: 'New User', email: 'new@example.com', password: 'Pass1234' });

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toMatchObject({ email: 'new@example.com', role: 'user' });
        expect(res.body.data.password).toBeUndefined();
    });

    test('TC-02: ลงทะเบียนด้วย email ซ้ำ → 409', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({ name: 'Dup User', email: 'admin@example.com', password: 'Pass1234' });

        expect(res.status).toBe(409);
        expect(res.body.success).toBe(false);
    });

    test('TC-03: ลงทะเบียนด้วย email format ผิด → 400', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({ name: 'Bad Email', email: 'not-an-email', password: 'Pass1234' });

        expect(res.status).toBe(400);
        expect(res.body.errors).toEqual(
            expect.arrayContaining([expect.objectContaining({ field: 'email' })])
        );
    });

    test('TC-04: ลงทะเบียนด้วย password ไม่ผ่าน (ไม่มีตัวเลข) → 400', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({ name: 'Weak Pass', email: 'weak@example.com', password: 'password' });

        expect(res.status).toBe(400);
        expect(res.body.errors).toEqual(
            expect.arrayContaining([expect.objectContaining({ field: 'password' })])
        );
    });

    test('TC-05: ลงทะเบียนด้วย name สั้นเกินไป (1 ตัว) → 400', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({ name: 'A', email: 'short@example.com', password: 'Pass1234' });

        expect(res.status).toBe(400);
        expect(res.body.errors).toEqual(
            expect.arrayContaining([expect.objectContaining({ field: 'name' })])
        );
    });
});

describe('POST /api/auth/login', () => {
    test('TC-06: login ถูกต้อง → 200 พร้อม accessToken และ refreshToken', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: 'admin@example.com', password: 'Admin@1234' });

        expect(res.status).toBe(200);
        expect(res.body.data.accessToken).toBeDefined();
        expect(res.body.data.refreshToken).toBeDefined();
        expect(res.body.data.user.role).toBe('admin');
        expect(res.body.data.user.password).toBeUndefined();
    });

    test('TC-07: login ด้วย password ผิด → 401', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: 'admin@example.com', password: 'WrongPass1' });

        expect(res.status).toBe(401);
    });

    test('TC-08: login ด้วย email ที่ไม่มีในระบบ → 401', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: 'ghost@example.com', password: 'Pass1234' });

        expect(res.status).toBe(401);
    });
});

describe('POST /api/auth/logout', () => {
    test('TC-09: logout แล้ว token ถูก revoke — ใช้ token เดิมไม่ได้ → 401', async () => {
        const token = await loginAs('user@example.com', 'User@1234');

        const logoutRes = await request(app)
            .post('/api/auth/logout')
            .set('Authorization', `Bearer ${token}`);
        expect(logoutRes.status).toBe(200);

        const meRes = await request(app)
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${token}`);
        expect(meRes.status).toBe(401);
    });
});

describe('GET /api/auth/me', () => {
    test('TC-10: ดูข้อมูลตัวเองด้วย valid token → 200', async () => {
        const token = await loginAs('user@example.com', 'User@1234');
        const res = await request(app)
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.data.email).toBe('user@example.com');
    });
});

describe('POST /api/auth/refresh', () => {
    test('TC-11: ต่ออายุ token ด้วย refreshToken ถูกต้อง → 200', async () => {
        const loginRes = await request(app)
            .post('/api/auth/login')
            .send({ email: 'user@example.com', password: 'User@1234' });

        const res = await request(app)
            .post('/api/auth/refresh')
            .send({ refreshToken: loginRes.body.data.refreshToken });

        expect(res.status).toBe(200);
        expect(res.body.data.accessToken).toBeDefined();
    });

    test('TC-12: ต่ออายุด้วย refreshToken ปลอม → 401', async () => {
        const res = await request(app)
            .post('/api/auth/refresh')
            .send({ refreshToken: 'fake.token.here' });

        expect(res.status).toBe(401);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  AUTHORIZATION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Authorization', () => {
    test('TC-13: เรียก protected route โดยไม่มี token → 401', async () => {
        const res = await request(app).get('/api/users');
        expect(res.status).toBe(401);
    });

    test('TC-14: user ธรรมดาพยายามลบ user อื่น → 403', async () => {
        const token = await loginAs('user@example.com', 'User@1234');
        const res = await request(app)
            .delete('/api/users/1')
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(403);
    });

    test('TC-15: admin ลบ user ได้สำเร็จ → 204', async () => {
        const token = await loginAs('admin@example.com', 'Admin@1234');
        const res = await request(app)
            .delete('/api/users/2')
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(204);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  CRUD TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /api/users (Admin)', () => {
    test('TC-16: admin ดูรายการ users ทั้งหมด → 200 พร้อม pagination', async () => {
        const token = await loginAs('admin@example.com', 'Admin@1234');
        const res = await request(app)
            .get('/api/users')
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.data.users).toBeInstanceOf(Array);
        expect(res.body.data.pagination).toMatchObject({ currentPage: 1, itemsPerPage: 10 });
    });

    test('TC-17: Pagination ทำงานถูกต้อง — limit=1 ควรได้ 1 user', async () => {
        const token = await loginAs('admin@example.com', 'Admin@1234');
        const res = await request(app)
            .get('/api/users?page=1&limit=1')
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.data.users).toHaveLength(1);
        expect(res.body.data.pagination.totalItems).toBeGreaterThanOrEqual(2);
    });

    test('TC-18: Filter by role=admin → ได้เฉพาะ admin users', async () => {
        const token = await loginAs('admin@example.com', 'Admin@1234');
        const res = await request(app)
            .get('/api/users?role=admin')
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        res.body.data.users.forEach(u => expect(u.role).toBe('admin'));
    });
});

describe('PUT /api/users/:id', () => {
    test('TC-19: user อัปเดตข้อมูลตัวเอง → 200', async () => {
        const token = await loginAs('user@example.com', 'User@1234');
        const res = await request(app)
            .put('/api/users/2')
            .set('Authorization', `Bearer ${token}`)
            .send({ name: 'Updated Name' });

        expect(res.status).toBe(200);
        expect(res.body.data.name).toBe('Updated Name');
    });

    test('TC-20: อัปเดต email เป็นค่าที่ซ้ำกับ user อื่น → 409', async () => {
        const token = await loginAs('user@example.com', 'User@1234');
        const res = await request(app)
            .put('/api/users/2')
            .set('Authorization', `Bearer ${token}`)
            .send({ email: 'admin@example.com' });

        expect(res.status).toBe(409);
    });
});

describe('PATCH /api/users/:id/status', () => {
    test('TC-21: admin ปิด account user → 200 is_active เป็น false', async () => {
        const token = await loginAs('admin@example.com', 'Admin@1234');
        const res = await request(app)
            .patch('/api/users/2/status')
            .set('Authorization', `Bearer ${token}`)
            .send({ is_active: false });

        expect(res.status).toBe(200);
        expect(res.body.data.is_active).toBe(false);
    });

    test('TC-22: account ที่ถูกปิด login ไม่ได้ → 401', async () => {
        const adminToken = await loginAs('admin@example.com', 'Admin@1234');

        await request(app)
            .patch('/api/users/2/status')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ is_active: false });

        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: 'user@example.com', password: 'User@1234' });

        expect(res.status).toBe(401);
    });
});