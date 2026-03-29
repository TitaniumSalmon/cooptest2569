const express = require('express');
const { getConn } = require('../db/connection');
const { authenticate, requireAdmin, requireAdminOrOwner } = require('../middleware/auth.middleware');
const { validateUpdate } = require('../validators/user.validator');
const { successResponse, errorResponse } = require('../utils/response');

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Users
 *     description: User management endpoints (CRUD)
 */

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: Get all users with pagination and filtering (Admin only)
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: query, name: page,   schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit,  schema: { type: integer, default: 10, maximum: 100 } }
 *       - { in: query, name: search, schema: { type: string }, description: Search by name or email }
 *       - { in: query, name: role,   schema: { type: string, enum: [admin, user] } }
 *       - { in: query, name: sort,   schema: { type: string, enum: [created_at, name, email], default: created_at } }
 *       - { in: query, name: order,  schema: { type: string, enum: [asc, desc], default: desc } }
 *     responses:
 *       200: { description: Paginated list of users }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden — Admin only }
 */
router.get('/', authenticate, requireAdmin, async (req, res) => {
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
        const conn = getConn();
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
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: User data }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 *       404: { description: User not found }
 */
router.get('/:id', authenticate, requireAdminOrOwner, async (req, res) => {
    try {
        const conn = getConn();
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
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:  { type: string, minLength: 2, maxLength: 100, example: Alice Updated }
 *               email: { type: string, format: email, example: alice.new@example.com }
 *     responses:
 *       200: { description: Updated user data }
 *       400: { description: Validation failed }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 *       409: { description: Email already in use }
 */
router.put('/:id', authenticate, requireAdminOrOwner, async (req, res) => {
    try {
        const errors = validateUpdate(req.body);
        if (errors.length > 0) return errorResponse(res, 'Validation failed', 400, errors);

        const { name, email } = req.body;
        const updates = {};
        const conn = getConn();

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
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       204: { description: User deleted }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden — Admin only }
 *       404: { description: User not found }
 */
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const conn = getConn();
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
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [is_active]
 *             properties:
 *               is_active: { type: boolean, example: false }
 *     responses:
 *       200: { description: Account status updated }
 *       400: { description: is_active must be a boolean }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden — Admin only }
 *       404: { description: User not found }
 */
router.patch('/:id/status', authenticate, requireAdmin, async (req, res) => {
    try {
        const { is_active } = req.body;
        if (typeof is_active !== 'boolean')
            return errorResponse(res, 'is_active must be a boolean', 400);

        const conn = getConn();
        const [users] = await conn.query('SELECT id FROM users WHERE id = ?', [req.params.id]);
        if (users.length === 0) return errorResponse(res, 'User not found', 404);

        await conn.query('UPDATE users SET is_active = ? WHERE id = ?', [is_active, req.params.id]);
        successResponse(res, { id: parseInt(req.params.id), is_active });
    } catch (err) {
        console.error('PATCH /api/users/:id/status error:', err.message);
        errorResponse(res, 'Something went wrong', 500);
    }
});

module.exports = router;
