require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');

const connectDB = require('./config/db');
const swaggerSpec = require('./swagger');
const { initSocket } = require('./socket');

const authRoutes = require('./routes/auth');
const menuRoutes = require('./routes/menu');
const orderRoutes = require('./routes/orders');
const userRoutes = require('./routes/users');
const cartRoutes = require('./routes/cart');

const app = express();
const server = http.createServer(app);

// Initialize Socket.io (must be done before routes that emit events)
initSocket(server);

// Middleware
app.use(cors());
app.use(express.json());

// Swagger UI — load assets from CDN to avoid MIME type issues on Render/proxied hosts
const SWAGGER_UI_VERSION = '5.17.14';
app.use(
  '/api-docs',
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customSiteTitle: 'Qless API Docs',
    customCssUrl: `https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/${SWAGGER_UI_VERSION}/swagger-ui.min.css`,
    customJs: [
      `https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/${SWAGGER_UI_VERSION}/swagger-ui-bundle.min.js`,
      `https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/${SWAGGER_UI_VERSION}/swagger-ui-standalone-preset.min.js`,
    ],
    swaggerOptions: {
      persistAuthorization: true,
    },
  })
);

// Expose raw OpenAPI spec as JSON (useful for mobile team to import into Postman etc.)
app.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// Routes
app.use('/api/auth', authRoutes);       // Admin auth
app.use('/api/users', userRoutes);      // Customer auth + profile
app.use('/api/menu', menuRoutes);       // Menu (public read, admin write)
app.use('/api/orders', orderRoutes);    // Orders (public guest + user + admin)
app.use('/api/cart', cartRoutes);       // Cart (user only)

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: `Route ${req.method} ${req.path} not found.` });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Internal server error.', error: err.message });
});

const PORT = process.env.PORT || 8080;

connectDB().then(() => {
  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`API Docs: http://localhost:${PORT}/api-docs`);
  });
});
