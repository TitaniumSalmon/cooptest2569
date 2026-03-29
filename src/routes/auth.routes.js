const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const { getConn } = require('../db/connection');
const { authenticate } = require('../middleware/auth.middleware');
const { validateRegister } = require('../validators/user.validator');
const { successResponse, errorResponse } = require('../utils/response');

const router = express.Router();

const JWT_SECRET             = process.env.JWT_SECRET             || 'change-me-in-production';
const JWT_EXPIRES_IN         = process.env.JWT_EXPIRES_IN         || '15m';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
const BCRYPT_ROUNDS          = 10;

const loginLimiter = process.env.NODE_ENV === 'test'
    ? (req, res, next) => next()
    : rateLimit({
        windowMs: 60 * 1000,
        max: 5,
        message: {
            success: false,
            message: 'Too many login attempts, please try again after 1 minute',
            timestamp: new Date().toISOString(),
        },
    });

/**
 * @swagger
 * tags:
 *   - name: Auth
 *     description: Authentication and authorization endpoints
 */

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password]
 *             properties:
 *               name:   { type: string, minLength: 2, maxLength: 100, example: Alice Smith }
 *               email:  { type: string, format: email, example: alice@example.com }
 *               password: { type: string, minLength: 8, example: Password1 }
 *               role:   { type: string, enum: [admin, user], default: user }
 *     responses:
 *       201: { description: User registered successfully }
 *       400: { description: Validation failed }
 *       409: { description: Email already in use }
 */
router.post('/register', async (req, res) => {
    try {
        const errors = validateRegister(req.body);
        if (errors.length > 0) return errorResponse(res, 'Validation failed', 400, errors);

        const { name, email, password, role = 'user' } = req.body;
        const normalizedEmail = email.toLowerCase();
        const conn = getConn();

        const [existing] = await conn.query('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
        if (existing.length > 0)
            return errorResponse(res, 'Email already in use', 409, [{ field: 'email', message: 'Email already exists' }]);

        const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
        const [result] = await conn.query(
            'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
            [name.trim(), normalizedEmail, hashedPassword, role]
        );

        successResponse(res, { id: result.insertId, name: name.trim(), email: normalizedEmail, role }, 201);
    } catch (err) {
        console.error('Register error:', err.message);
        errorResponse(res, 'Something went wrong', 500);
    }
});

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login and receive JWT tokens
 *     description: Rate limited to **5 requests per minute** per IP.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:    { type: string, format: email, example: alice@example.com }
 *               password: { type: string, example: Password1 }
 *     responses:
 *       200: { description: Login successful }
 *       400: { description: Missing email or password }
 *       401: { description: Invalid credentials or account disabled }
 *       429: { description: Too many login attempts }
 */
router.post('/login', loginLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return errorResponse(res, 'Email and password are required', 400);

        const conn = getConn();
        const [users] = await conn.query('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
        if (users.length === 0) return errorResponse(res, 'Invalid email or password', 401);

        const user = users[0];
        if (!user.is_active) return errorResponse(res, 'Account is disabled', 401);

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return errorResponse(res, 'Invalid email or password', 401);

        const accessToken  = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
        const refreshToken = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: JWT_REFRESH_EXPIRES_IN });

        await conn.query('UPDATE users SET refresh_token = ? WHERE id = ?', [refreshToken, user.id]);

        successResponse(res, {
            accessToken,
            refreshToken,
            user: { id: user.id, name: user.name, email: user.email, role: user.role },
        });
    } catch (err) {
        console.error('Login error:', err.message);
        errorResponse(res, 'Something went wrong', 500);
    }
});

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Logout and blacklist the current access token
 *     tags: [Auth]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200: { description: Logged out successfully }
 *       401: { description: Unauthorized }
 */
router.post('/logout', authenticate, async (req, res) => {
    try {
        const conn = getConn();
        await conn.query('INSERT INTO token_blacklist (token) VALUES (?)', [req.token]);
        await conn.query('UPDATE users SET refresh_token = NULL WHERE id = ?', [req.user.id]);
        successResponse(res, { message: 'Logged out successfully' });
    } catch (err) {
        console.error('Logout error:', err.message);
        errorResponse(res, 'Something went wrong', 500);
    }
});

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Get current authenticated user info
 *     tags: [Auth]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200: { description: Current user data }
 *       401: { description: Unauthorized }
 */
router.get('/me', authenticate, (req, res) => {
    successResponse(res, req.user);
});

/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     summary: Refresh access token using a refresh token
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken: { type: string, example: eyJhbGci... }
 *     responses:
 *       200: { description: New access token issued }
 *       400: { description: Refresh token required }
 *       401: { description: Invalid or expired refresh token }
 */
router.post('/refresh', async (req, res) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) return errorResponse(res, 'Refresh token required', 400);

        const conn = getConn();
        const decoded = jwt.verify(refreshToken, JWT_SECRET);
        const [users] = await conn.query(
            'SELECT * FROM users WHERE id = ? AND refresh_token = ?', [decoded.id, refreshToken]
        );
        if (users.length === 0) return errorResponse(res, 'Invalid or expired refresh token', 401);

        const user = users[0];
        const accessToken = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
        successResponse(res, { accessToken });
    } catch {
        errorResponse(res, 'Invalid or expired refresh token', 401);
    }
});

module.exports = router;
