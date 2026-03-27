const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const app = express();
const port = process.env.PORT || 3000;

// ─── Swagger Setup ─────────────────────────────────────────────────────────────
const swaggerOptions = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'User Management System API',
            version: '1.0.0',
            description: 'RESTful API for managing users with JWT authentication and RBAC',
        },
        servers: [
            { url: `http://localhost:${port}`, description: 'Local development server' },
        ],
        components: {
            securitySchemes: {
                BearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                    description: 'Enter your JWT access token obtained from /api/auth/login',
                },
            },
            schemas: {
                User: {
                    type: 'object',
                    properties: {
                        id:         { type: 'integer', example: 1 },
                        name:       { type: 'string',  example: 'Alice Smith' },
                        email:      { type: 'string',  format: 'email', example: 'alice@example.com' },
                        role:       { type: 'string',  enum: ['admin', 'user'], example: 'user' },
                        is_active:  { type: 'boolean', example: true },
                        created_at: { type: 'string',  format: 'date-time' },
                        updated_at: { type: 'string',  format: 'date-time' },
                    },
                },
                SuccessResponse: {
                    type: 'object',
                    properties: {
                        success:   { type: 'boolean', example: true },
                        data:      { type: 'object' },
                        timestamp: { type: 'string', format: 'date-time' },
                    },
                },
                ErrorResponse: {
                    type: 'object',
                    properties: {
                        success:   { type: 'boolean', example: false },
                        message:   { type: 'string',  example: 'Validation failed' },
                        errors: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    field:   { type: 'string', example: 'email' },
                                    message: { type: 'string', example: 'Invalid email format' },
                                },
                            },
                        },
                        timestamp: { type: 'string', format: 'date-time' },
                    },
                },
                PaginatedUsers: {
                    type: 'object',
                    properties: {
                        success: { type: 'boolean', example: true },
                        data: {
                            type: 'object',
                            properties: {
                                users: { type: 'array', items: { $ref: '#/components/schemas/User' } },
                                pagination: {
                                    type: 'object',
                                    properties: {
                                        currentPage:  { type: 'integer', example: 1 },
                                        totalPages:   { type: 'integer', example: 5 },
                                        totalItems:   { type: 'integer', example: 48 },
                                        itemsPerPage: { type: 'integer', example: 10 },
                                    },
                                },
                            },
                        },
                        timestamp: { type: 'string', format: 'date-time' },
                    },
                },
            },
        },
    },
    apis: [__filename],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false })); // disabled CSP so Swagger UI loads correctly
app.use(bodyParser.json());
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
}));

// ─── Swagger UI at /api-docs ───────────────────────────────────────────────────
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    swaggerOptions: { persistAuthorization: true },
    customSiteTitle: 'User Management API Docs',
}));

// ─── Rate Limiter (login max 5 ครั้ง/นาที) ────────────────────────────────────
const loginLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    message: {
        success: false,
        message: 'Too many login attempts, please try again after 1 minute',
        timestamp: new Date().toISOString(),
    },
});

// ─── DB Connection ─────────────────────────────────────────────────────────────
let conn = null;

const initMYSQL = async () => {
    conn = await mysql.createConnection({
        host:     process.env.DB_HOST     || 'localhost',
        user:     process.env.DB_USER     || 'root',
        password: process.env.DB_PASSWORD || 'root',
        database: process.env.DB_NAME     || 'webdb',
        port:     process.env.DB_PORT     || 8700,
    });
    console.log('MySQL connected');
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const JWT_SECRET             = process.env.JWT_SECRET             || 'change-me-in-production';
const JWT_EXPIRES_IN         = process.env.JWT_EXPIRES_IN         || '15m';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
const BCRYPT_ROUNDS          = 10;

const successResponse = (res, data, statusCode = 200) =>
    res.status(statusCode).json({ success: true, data, timestamp: new Date().toISOString() });

const errorResponse = (res, message, statusCode = 500, errors = []) =>
    res.status(statusCode).json({ success: false, message, errors, timestamp: new Date().toISOString() });

// ─── Validation ───────────────────────────────────────────────────────────────
const validateRegister = ({ name, email, password, role }) => {
    const errors = [];
    if (!name || name.trim().length < 2 || name.trim().length > 100)
        errors.push({ field: 'name', message: 'Name must be between 2 and 100 characters' });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        errors.push({ field: 'email', message: 'Invalid email format' });
    if (!password || !/^(?=.*[a-zA-Z])(?=.*\d).{8,}$/.test(password))
        errors.push({ field: 'password', message: 'Password must be at least 8 characters with at least 1 letter and 1 number' });
    if (role && !['admin', 'user'].includes(role))
        errors.push({ field: 'role', message: 'Role must be admin or user' });
    return errors;
};

const validateUpdate = ({ name, email }) => {
    const errors = [];
    if (name !== undefined && (name.trim().length < 2 || name.trim().length > 100))
        errors.push({ field: 'name', message: 'Name must be between 2 and 100 characters' });
    if (email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        errors.push({ field: 'email', message: 'Invalid email format' });
    return errors;
};

// ─── Auth Middleware ──────────────────────────────────────────────────────────
const authenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer '))
            return errorResponse(res, 'Unauthorized: No token provided', 401);

        const token = authHeader.split(' ')[1];
        const [blacklisted] = await conn.query('SELECT id FROM token_blacklist WHERE token = ?', [token]);
        if (blacklisted.length > 0)
            return errorResponse(res, 'Unauthorized: Token has been revoked', 401);

        const decoded = jwt.verify(token, JWT_SECRET);
        const [users] = await conn.query(
            'SELECT id, name, email, role, is_active FROM users WHERE id = ?', [decoded.id]
        );
        if (users.length === 0)   return errorResponse(res, 'Unauthorized: User not found', 401);
        if (!users[0].is_active)  return errorResponse(res, 'Unauthorized: Account is disabled', 401);

        req.user  = users[0];
        req.token = token;
        next();
    } catch {
        errorResponse(res, 'Unauthorized: Invalid token', 401);
    }
};

const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') return errorResponse(res, 'Forbidden: Admin access required', 403);
    next();
};

const requireAdminOrOwner = (req, res, next) => {
    if (req.user.role !== 'admin' && req.user.id !== parseInt(req.params.id))
        return errorResponse(res, 'Forbidden: Access denied', 403);
    next();
};

// ════════════════════════════════════════════════════════════
//  AUTH ROUTES
// ════════════════════════════════════════════════════════════

/**
 * @swagger
 * tags:
 *   - name: Auth
 *     description: Authentication and authorization endpoints
 *   - name: Users
 *     description: User management endpoints (CRUD)
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
 *               name:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 100
 *                 example: Alice Smith
 *               email:
 *                 type: string
 *                 format: email
 *                 example: alice@example.com
 *               password:
 *                 type: string
 *                 minLength: 8
 *                 example: Password1
 *               role:
 *                 type: string
 *                 enum: [admin, user]
 *                 default: user
 *                 example: user
 *     responses:
 *       201:
 *         description: User registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         id:    { type: integer, example: 1 }
 *                         name:  { type: string,  example: Alice Smith }
 *                         email: { type: string,  example: alice@example.com }
 *                         role:  { type: string,  example: user }
 *       400:
 *         description: Validation failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: Email already in use
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
app.post('/api/auth/register', async (req, res) => {
    try {
        const errors = validateRegister(req.body);
        if (errors.length > 0) return errorResponse(res, 'Validation failed', 400, errors);

        const { name, email, password, role = 'user' } = req.body;
        const normalizedEmail = email.toLowerCase();

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
 *               email:
 *                 type: string
 *                 format: email
 *                 example: alice@example.com
 *               password:
 *                 type: string
 *                 example: Password1
 *     responses:
 *       200:
 *         description: Login successful — returns accessToken and refreshToken
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         accessToken:
 *                           type: string
 *                           example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *                         refreshToken:
 *                           type: string
 *                           example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *                         user:
 *                           $ref: '#/components/schemas/User'
 *       400:
 *         description: Missing email or password
 *       401:
 *         description: Invalid credentials or account disabled
 *       429:
 *         description: Too many login attempts
 */
app.post('/api/auth/login', loginLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return errorResponse(res, 'Email and password are required', 400);

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
 *       200:
 *         description: Logged out successfully
 *       401:
 *         description: Unauthorized
 */
app.post('/api/auth/logout', authenticate, async (req, res) => {
    try {
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
 *     summary: Get the current authenticated user's info
 *     tags: [Auth]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Current user data
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/User'
 *       401:
 *         description: Unauthorized
 */
app.get('/api/auth/me', authenticate, (req, res) => {
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
 *               refreshToken:
 *                 type: string
 *                 example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *     responses:
 *       200:
 *         description: New access token issued
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         accessToken:
 *                           type: string
 *                           example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *       400:
 *         description: Refresh token required
 *       401:
 *         description: Invalid or expired refresh token
 */
app.post('/api/auth/refresh', async (req, res) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) return errorResponse(res, 'Refresh token required', 400);

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

// ════════════════════════════════════════════════════════════
//  USER ROUTES
// ════════════════════════════════════════════════════════════

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: Get all users with pagination and filtering (Admin only)
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10, maximum: 100 }
 *         description: Items per page (max 100)
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Search by name or email
 *       - in: query
 *         name: role
 *         schema: { type: string, enum: [admin, user] }
 *         description: Filter by role
 *       - in: query
 *         name: sort
 *         schema: { type: string, enum: [created_at, name, email], default: created_at }
 *         description: Sort field
 *       - in: query
 *         name: order
 *         schema: { type: string, enum: [asc, desc], default: desc }
 *         description: Sort direction
 *     responses:
 *       200:
 *         description: Paginated list of users
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaginatedUsers'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — Admin only
 */
app.get('/api/users', authenticate, requireAdmin, async (req, res) => {
    try {
        let { page = 1, limit = 10, search = '', role, sort = 'created_at', order = 'desc' } = req.query;

        page  = Math.max(1, parseInt(page));
        limit = Math.min(100, Math.max(1, parseInt(limit)));
        const offset = (page - 1) * limit;

        const allowedSort  = ['created_at', 'name', 'email'];
        const allowedOrder = ['asc', 'desc'];
        if (!allowedSort.includes(sort))   sort  = 'created_at';
        if (!allowedOrder.includes(order)) order = 'desc';

        const whereClauses = ['1=1'];
        const params = [];

        if (search) {
            whereClauses.push('(name LIKE ? OR email LIKE ?)');
            params.push(`%${search}%`, `%${search}%`);
        }
        if (role && ['admin', 'user'].includes(role)) {
            whereClauses.push('role = ?');
            params.push(role);
        }

        const where = whereClauses.join(' AND ');
        const [[{ total }]] = await conn.query(`SELECT COUNT(*) as total FROM users WHERE ${where}`, params);
        const [users] = await conn.query(
            `SELECT id, name, email, role, is_active, created_at, updated_at FROM users WHERE ${where} ORDER BY ${sort} ${order} LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        successResponse(res, {
            users,
            pagination: {
                currentPage:  page,
                totalPages:   Math.ceil(total / limit),
                totalItems:   total,
                itemsPerPage: limit,
            },
        });
    } catch (err) {
        console.error('GET /api/users error:', err.message);
        errorResponse(res, 'Something went wrong', 500);
    }
});

/**
 * @swagger
 * /api/users/{id}:
 *   get:
 *     summary: Get user by ID (Admin or account owner)
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         description: User ID
 *     responses:
 *       200:
 *         description: User data
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/User'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: User not found
 */
app.get('/api/users/:id', authenticate, requireAdminOrOwner, async (req, res) => {
    try {
        const [users] = await conn.query(
            'SELECT id, name, email, role, is_active, created_at, updated_at FROM users WHERE id = ?',
            [req.params.id]
        );
        if (users.length === 0) return errorResponse(res, 'User not found', 404);
        successResponse(res, users[0]);
    } catch (err) {
        console.error('GET /api/users/:id error:', err.message);
        errorResponse(res, 'Something went wrong', 500);
    }
});

/**
 * @swagger
 * /api/users/{id}:
 *   put:
 *     summary: Update user by ID (Admin or account owner)
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         description: User ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 100
 *                 example: Alice Updated
 *               email:
 *                 type: string
 *                 format: email
 *                 example: alice.new@example.com
 *     responses:
 *       200:
 *         description: Updated user data
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/User'
 *       400:
 *         description: Validation failed or no fields to update
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: User not found
 *       409:
 *         description: Email already in use
 */
app.put('/api/users/:id', authenticate, requireAdminOrOwner, async (req, res) => {
    try {
        const errors = validateUpdate(req.body);
        if (errors.length > 0) return errorResponse(res, 'Validation failed', 400, errors);

        const { name, email } = req.body;
        const updates = {};

        if (name) updates.name = name.trim();
        if (email) {
            const normalizedEmail = email.toLowerCase();
            const [existing] = await conn.query(
                'SELECT id FROM users WHERE email = ? AND id != ?', [normalizedEmail, req.params.id]
            );
            if (existing.length > 0)
                return errorResponse(res, 'Email already in use', 409, [{ field: 'email', message: 'Email already exists' }]);
            updates.email = normalizedEmail;
        }

        if (Object.keys(updates).length === 0)
            return errorResponse(res, 'No valid fields to update', 400);

        await conn.query('UPDATE users SET ? WHERE id = ?', [updates, req.params.id]);

        const [updated] = await conn.query(
            'SELECT id, name, email, role, is_active, created_at, updated_at FROM users WHERE id = ?',
            [req.params.id]
        );
        successResponse(res, updated[0]);
    } catch (err) {
        console.error('PUT /api/users/:id error:', err.message);
        errorResponse(res, 'Something went wrong', 500);
    }
});

/**
 * @swagger
 * /api/users/{id}:
 *   delete:
 *     summary: Delete user by ID (Admin only)
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         description: User ID
 *     responses:
 *       204:
 *         description: User deleted successfully (no content)
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — Admin only
 *       404:
 *         description: User not found
 */
app.delete('/api/users/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const [users] = await conn.query('SELECT id FROM users WHERE id = ?', [req.params.id]);
        if (users.length === 0) return errorResponse(res, 'User not found', 404);
        await conn.query('DELETE FROM users WHERE id = ?', [req.params.id]);
        res.status(204).send();
    } catch (err) {
        console.error('DELETE /api/users/:id error:', err.message);
        errorResponse(res, 'Something went wrong', 500);
    }
});

/**
 * @swagger
 * /api/users/{id}/status:
 *   patch:
 *     summary: Enable or disable a user account (Admin only)
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         description: User ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [is_active]
 *             properties:
 *               is_active:
 *                 type: boolean
 *                 example: false
 *     responses:
 *       200:
 *         description: Account status updated
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         id:        { type: integer, example: 1 }
 *                         is_active: { type: boolean, example: false }
 *       400:
 *         description: is_active must be a boolean
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — Admin only
 *       404:
 *         description: User not found
 */
app.patch('/api/users/:id/status', authenticate, requireAdmin, async (req, res) => {
    try {
        const { is_active } = req.body;
        if (typeof is_active !== 'boolean')
            return errorResponse(res, 'is_active must be a boolean', 400);

        const [users] = await conn.query('SELECT id FROM users WHERE id = ?', [req.params.id]);
        if (users.length === 0) return errorResponse(res, 'User not found', 404);

        await conn.query('UPDATE users SET is_active = ? WHERE id = ?', [is_active, req.params.id]);
        successResponse(res, { id: parseInt(req.params.id), is_active });
    } catch (err) {
        console.error('PATCH /api/users/:id/status error:', err.message);
        errorResponse(res, 'Something went wrong', 500);
    }
});

// ─── Global Error Handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    errorResponse(res, 'Internal server error', 500);
});

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(port, async () => {
    await initMYSQL();
    console.log(`Server running on port ${port}`);
    console.log(`API Docs: http://localhost:${port}/api-docs`);
});