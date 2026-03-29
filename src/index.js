const express    = require('express');
const bodyParser = require('body-parser');
const cors       = require('cors');
const helmet     = require('helmet');
const swaggerUi  = require('swagger-ui-express');

const { initMYSQL } = require('./db/connection');
const swaggerSpec   = require('./config/swagger');
const authRoutes    = require('./routes/auth.routes');
const userRoutes    = require('./routes/user.routes');
const { errorResponse } = require('./utils/response');

const app  = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(bodyParser.json());
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
}));

// Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    swaggerOptions: { persistAuthorization: true },
    customSiteTitle: 'User Management API Docs',
}));

// Routes
app.use('/api/auth',  authRoutes);
app.use('/api/users', userRoutes);

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    errorResponse(res, 'Internal server error', 500);
});

// Start (skip when imported by tests)
if (require.main === module) {
    app.listen(port, async () => {
        await initMYSQL();
        console.log(`Server running on port ${port}`);
        console.log(`API Docs: http://localhost:${port}/api-docs`);
    });
}

module.exports = { app, initMYSQL };
