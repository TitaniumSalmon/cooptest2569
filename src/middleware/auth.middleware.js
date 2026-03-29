const jwt = require('jsonwebtoken');
const { getConn } = require('../db/connection');
const { errorResponse } = require('../utils/response');

const JWT_SECRET = process.env.JWT_SECRET || 'never-gonna-give-you-up-never-gonna-let-you-down';

const authenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer '))
            return errorResponse(res, 'Unauthorized: No token provided', 401);

        const token = authHeader.split(' ')[1];
        const conn = getConn();

        const [blacklisted] = await conn.query(
            'SELECT id FROM token_blacklist WHERE token = ?', [token]
        );
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
    if (req.user.role !== 'admin')
        return errorResponse(res, 'Forbidden: Admin access required', 403);
    next();
};

const requireAdminOrOwner = (req, res, next) => {
    if (req.user.role !== 'admin' && req.user.id !== parseInt(req.params.id))
        return errorResponse(res, 'Forbidden: Access denied', 403);
    next();
};

module.exports = { authenticate, requireAdmin, requireAdminOrOwner };
