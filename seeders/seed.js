// seed.js — สร้างตาราง (ถ้ายังไม่มี) และ Seed Admin + User เริ่มต้น
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

const BCRYPT_ROUNDS = 10;

async function migrate(conn) {
    // ─── สร้างตาราง users (ถ้ายังไม่มี) ────────────────────────────────────────
    await conn.query(`
        CREATE TABLE IF NOT EXISTS users (
            id            INT          NOT NULL AUTO_INCREMENT,
            name          VARCHAR(100) NOT NULL,
            email         VARCHAR(255) NOT NULL COMMENT 'เก็บเป็นตัวพิมพ์เล็กเสมอ',
            password      VARCHAR(255) NOT NULL COMMENT 'เก็บเฉพาะ bcrypt hash',
            role          ENUM('admin','user') NOT NULL DEFAULT 'user' COMMENT 'ค่า: admin, user',
            is_active     TINYINT(1)   NOT NULL DEFAULT 1 COMMENT 'Soft Disable Account',
            refresh_token VARCHAR(500) DEFAULT NULL COMMENT 'Refresh Token ล่าสุด',
            created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uq_email (email)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    console.log('✅ Table "users" ready');

    // ─── สร้างตาราง token_blacklist (ถ้ายังไม่มี) ──────────────────────────────
    await conn.query(`
        CREATE TABLE IF NOT EXISTS token_blacklist (
            id         INT       NOT NULL AUTO_INCREMENT,
            token      TEXT      NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    console.log('✅ Table "token_blacklist" ready');
}

async function seed() {
    const conn = await mysql.createConnection({
        host:     process.env.DB_HOST     || 'localhost',
        user:     process.env.DB_USER     || 'root',
        password: process.env.DB_PASSWORD || 'root',
        database: process.env.DB_NAME     || 'webdb',
        port:     process.env.DB_PORT     || 8700,
    });

    console.log('Connected to database');

    // ─── Auto-migrate: สร้างตารางถ้ายังไม่มี ────────────────────────────────────
    await migrate(conn);

    // ─── ล้างข้อมูลเดิมก่อน Seed (ระวัง: ใช้เฉพาะ dev/test เท่านั้น) ──────────
    await conn.query('DELETE FROM token_blacklist');
    await conn.query('DELETE FROM users');
    await conn.query('ALTER TABLE users AUTO_INCREMENT = 1');

    // ─── Admin User ──────────────────────────────────────────────────────────────
    const adminHash = await bcrypt.hash('Admin@1234', BCRYPT_ROUNDS);
    await conn.query(
        `INSERT INTO users (name, email, password, role, is_active) VALUES (?, ?, ?, ?, ?)`,
        ['Admin System', 'admin@example.com', adminHash, 'admin', 1]
    );
    console.log('✅ Admin created  : admin@example.com / Admin@1234');

    // ─── Regular User ────────────────────────────────────────────────────────────
    const userHash = await bcrypt.hash('User@1234', BCRYPT_ROUNDS);
    await conn.query(
        `INSERT INTO users (name, email, password, role, is_active) VALUES (?, ?, ?, ?, ?)`,
        ['Test User', 'user@example.com', userHash, 'user', 1]
    );
    console.log('✅ User created   : user@example.com / User@1234');

    await conn.end();
    console.log('\nSeed completed successfully!');
}

seed().catch((err) => {
    console.error('Seed failed:', err.message);
    process.exit(1);
});