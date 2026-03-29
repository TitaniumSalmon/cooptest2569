const successResponse = (res, data, statusCode = 200) =>
    res.status(statusCode).json({ success: true, data, timestamp: new Date().toISOString() });

const errorResponse = (res, message, statusCode = 500, errors = []) =>
    res.status(statusCode).json({ success: false, message, errors, timestamp: new Date().toISOString() });

module.exports = { successResponse, errorResponse };
