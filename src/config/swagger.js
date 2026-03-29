const swaggerJsdoc = require('swagger-jsdoc');

const port = process.env.PORT || 3000;

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
    // ชี้ไปที่ route files เพื่อให้ swagger-jsdoc อ่าน JSDoc comments
    apis: ['./src/routes/*.js'],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

module.exports = swaggerSpec;
