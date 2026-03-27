const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

const app = express();
const port = process.env.PORT || 8000;

// MARK: Middleware
// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(helmet());
app.use(bodyParser.json());
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
}));

// MARK: Rate Limiter
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

// MARK: DB Connection
// ─── DB Connection ─────────────────────────────────────────────────────────────
let conn = null;

const initMYSQL = async () => {
    conn = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'root',
        database: process.env.DB_NAME || 'webdb',
        port: process.env.DB_PORT || 8700,
    });
    console.log('MySQL connected');
};

// MARK: Helpers
// ─── Helpers ──────────────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
const BCRYPT_ROUNDS = 10;

const successResponse = (res, data, statusCode = 200) => {
    res.status(statusCode).json({ success: true, data, timestamp: new Date().toISOString() });
};

const errorResponse = (res, message, statusCode = 500, errors = []) => {
    res.status(statusCode).json({
        success: false,
        message,
        errors,
        timestamp: new Date().toISOString(),
    });
};

// MARK: Validation
// ─── Validation ───────────────────────────────────────────────────────────────
const validateRegister = (body) => {
    const errors = [];
    const { name, email, password, role } = body;

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

const validateUpdate = (body) => {
    const errors = [];
    const { name, email } = body;

    if (name !== undefined && (name.trim().length < 2 || name.trim().length > 100))
        errors.push({ field: 'name', message: 'Name must be between 2 and 100 characters' });

    if (email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        errors.push({ field: 'email', message: 'Invalid email format' });

    return errors;
};

// MARK: Endpoints
// ─── ENDPOINTS ───────────────────────────────────────────────────────────────
// ─── Auth Middleware ──────────────────────────────────────────────────────────
const authenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer '))
            return errorResponse(res, 'Unauthorized: No token provided', 401);

        const token = authHeader.split(' ')[1];

        // Check blacklist
        const [blacklisted] = await conn.query(
            'SELECT id FROM token_blacklist WHERE token = ?', [token]
        );
        if (blacklisted.length > 0)
            return errorResponse(res, 'Unauthorized: Token has been revoked', 401);

        const decoded = jwt.verify(token, JWT_SECRET);
        const [users] = await conn.query(
            'SELECT id, name, email, role, is_active FROM users WHERE id = ?', [decoded.id]
        );
        if (users.length === 0)
            return errorResponse(res, 'Unauthorized: User not found', 401);

        if (!users[0].is_active)
            return errorResponse(res, 'Unauthorized: Account is disabled', 401);

        req.user = users[0];
        req.token = token;
        next();
    } catch (err) {
        return errorResponse(res, 'Unauthorized: Invalid token', 401);
    }
};

const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'admin')
        return errorResponse(res, 'Forbidden: Admin access required', 403);
    next();
};

const requireAdminOrOwner = (req, res, next) => {
    const targetId = parseInt(req.params.id);
    if (req.user.role !== 'admin' && req.user.id !== targetId)
        return errorResponse(res, 'Forbidden: Access denied', 403);
    next();
};

// MARK: Auth Routes
// ─── AUTH ROUTES ──────────────────────────────────────────────────────────────

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
    console.log(req.body);
    try {
        const errors = validateRegister(req.body);
        if (errors.length > 0)
            return errorResponse(res, 'Validation failed', 400, errors);

        const { name, email, password, role = 'user' } = req.body;
        const normalizedEmail = email.toLowerCase();

        const [existing] = await conn.query('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
        if (existing.length > 0)
            return errorResponse(res, 'Email already in use', 409, [
                { field: 'email', message: 'Email already exists' }
            ]);

        const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
        const [result] = await conn.query(
            'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
            [name.trim(), normalizedEmail, hashedPassword, role]
        );

        successResponse(res, {
            id: result.insertId,
            name: name.trim(),
            email: normalizedEmail,
            role,
        }, 201);
    } catch (err) {
        console.error('Register error:', err.message);
        errorResponse(res, 'Something went wrong', 500);
    }
});

// POST /api/auth/login
app.post('/api/auth/login', loginLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password)
            return errorResponse(res, 'Email and password are required', 400);

        const [users] = await conn.query(
            'SELECT * FROM users WHERE email = ?', [email.toLowerCase()]
        );
        if (users.length === 0)
            return errorResponse(res, 'Invalid email or password', 401);

        const user = users[0];
        if (!user.is_active)
            return errorResponse(res, 'Account is disabled', 401);

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch)
            return errorResponse(res, 'Invalid email or password', 401);

        const accessToken = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
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

// POST /api/auth/logout
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

// GET /api/auth/me
app.get('/api/auth/me', authenticate, async (req, res) => {
    successResponse(res, req.user);
});

// POST /api/auth/refresh
app.post('/api/auth/refresh', async (req, res) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken)
            return errorResponse(res, 'Refresh token required', 400);

        const decoded = jwt.verify(refreshToken, JWT_SECRET);
        const [users] = await conn.query(
            'SELECT * FROM users WHERE id = ? AND refresh_token = ?', [decoded.id, refreshToken]
        );
        if (users.length === 0)
            return errorResponse(res, 'Invalid or expired refresh token', 401);

        const user = users[0];
        const accessToken = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

        successResponse(res, { accessToken });
    } catch (err) {
        errorResponse(res, 'Invalid or expired refresh token', 401);
    }
});

// MARK: User Routes
// ─── USER ROUTES ──────────────────────────────────────────────────────────────

// GET /api/users — Admin only + Pagination + Filtering
app.get('/api/users', authenticate, requireAdmin, async (req, res) => {
    try {
        let { page = 1, limit = 10, search = '', role, sort = 'created_at', order = 'desc' } = req.query;

        page = Math.max(1, parseInt(page));
        limit = Math.min(100, Math.max(1, parseInt(limit)));
        const offset = (page - 1) * limit;

        const allowedSort = ['created_at', 'name', 'email'];
        const allowedOrder = ['asc', 'desc'];
        if (!allowedSort.includes(sort)) sort = 'created_at';
        if (!allowedOrder.includes(order)) order = 'desc';

        let whereClauses = ['1=1'];
        let params = [];

        if (search) {
            whereClauses.push('(name LIKE ? OR email LIKE ?)');
            params.push(`%${search}%`, `%${search}%`);
        }
        if (role && ['admin', 'user'].includes(role)) {
            whereClauses.push('role = ?');
            params.push(role);
        }

        const where = whereClauses.join(' AND ');

        const [[{ total }]] = await conn.query(
            `SELECT COUNT(*) as total FROM users WHERE ${where}`, params
        );

        const [users] = await conn.query(
            `SELECT id, name, email, role, is_active, created_at, updated_at FROM users WHERE ${where} ORDER BY ${sort} ${order} LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        successResponse(res, {
            users,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(total / limit),
                totalItems: total,
                itemsPerPage: limit,
            },
        });
    } catch (err) {
        console.error('GET /api/users error:', err.message);
        errorResponse(res, 'Something went wrong', 500);
    }
});

// GET /api/users/:id — Admin or Owner
app.get('/api/users/:id', authenticate, requireAdminOrOwner, async (req, res) => {
    try {
        const [users] = await conn.query(
            'SELECT id, name, email, role, is_active, created_at, updated_at FROM users WHERE id = ?',
            [req.params.id]
        );
        if (users.length === 0)
            return errorResponse(res, 'User not found', 404);

        successResponse(res, users[0]);
    } catch (err) {
        console.error('GET /api/users/:id error:', err.message);
        errorResponse(res, 'Something went wrong', 500);
    }
});

// PUT /api/users/:id — Admin or Owner
app.put('/api/users/:id', authenticate, requireAdminOrOwner, async (req, res) => {
    try {
        const errors = validateUpdate(req.body);
        if (errors.length > 0)
            return errorResponse(res, 'Validation failed', 400, errors);

        const { name, email } = req.body;
        const updates = {};

        if (name) updates.name = name.trim();
        if (email) {
            const normalizedEmail = email.toLowerCase();
            const [existing] = await conn.query(
                'SELECT id FROM users WHERE email = ? AND id != ?', [normalizedEmail, req.params.id]
            );
            if (existing.length > 0)
                return errorResponse(res, 'Email already in use', 409, [
                    { field: 'email', message: 'Email already exists' }
                ]);
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

// DELETE /api/users/:id — Admin only
app.delete('/api/users/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const [users] = await conn.query('SELECT id FROM users WHERE id = ?', [req.params.id]);
        if (users.length === 0)
            return errorResponse(res, 'User not found', 404);

        await conn.query('DELETE FROM users WHERE id = ?', [req.params.id]);
        res.status(204).send();
    } catch (err) {
        console.error('DELETE /api/users/:id error:', err.message);
        errorResponse(res, 'Something went wrong', 500);
    }
});

// PATCH /api/users/:id/status — Admin only
app.patch('/api/users/:id/status', authenticate, requireAdmin, async (req, res) => {
    try {
        const { is_active } = req.body;
        if (typeof is_active !== 'boolean')
            return errorResponse(res, 'is_active must be a boolean', 400);

        const [users] = await conn.query('SELECT id FROM users WHERE id = ?', [req.params.id]);
        if (users.length === 0)
            return errorResponse(res, 'User not found', 404);

        await conn.query('UPDATE users SET is_active = ? WHERE id = ?', [is_active, req.params.id]);
        successResponse(res, { id: parseInt(req.params.id), is_active });
    } catch (err) {
        console.error('PATCH /api/users/:id/status error:', err.message);
        errorResponse(res, 'Something went wrong', 500);
    }
});

// MARK: Global Error Handler
// ─── Global Error Handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    errorResponse(res, 'Internal server error', 500);
});

//MARK: Start Server
// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(port, async () => {
    await initMYSQL();
    console.log(`Server running on port ${port}`);
});