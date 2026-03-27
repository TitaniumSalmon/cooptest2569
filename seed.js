// seed.js — สร้าง Admin และ User เริ่มต้นสำหรับทดสอบ
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

const BCRYPT_ROUNDS = 10;

async function seed() {
    const conn = await mysql.createConnection({
        host:     process.env.DB_HOST     || 'db',
        user:     process.env.DB_USER     || 'root',
        password: process.env.DB_PASSWORD || 'root',
        database: process.env.DB_NAME     || 'webdb',
        port:     process.env.DB_PORT     || 8700,
    });

    console.log('Connected to database');

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
    console.log('✅ Admin user created: admin@example.com / Admin@1234');

    // ─── Regular User ────────────────────────────────────────────────────────────
    const userHash = await bcrypt.hash('User@1234', BCRYPT_ROUNDS);
    await conn.query(
        `INSERT INTO users (name, email, password, role, is_active) VALUES (?, ?, ?, ?, ?)`,
        ['Test User', 'user@example.com', userHash, 'user', 1]
    );
    console.log('✅ Regular user created: user@example.com / User@1234');

    await conn.end();
    console.log('\nSeed completed successfully!');
}

seed().catch((err) => {
    console.error('Seed failed:', err.message);
    process.exit(1);
});
