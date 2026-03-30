// src/config/env.js
module.exports = {
    JWT_SECRET:             process.env.JWT_SECRET             || 'never-gonna-give-you-up-never-gonna-let-you-down',
    JWT_EXPIRES_IN:         process.env.JWT_EXPIRES_IN         || '15m',
    JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    BCRYPT_ROUNDS:          10,
};