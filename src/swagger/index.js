const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Qless Canteen API',
      version: '1.0.0',
      description:
        'REST API for the Qless canteen food ordering system.\n\n' +
        '**Two token types:**\n' +
        '- `bearerAuth` → Admin/Kitchen JWT (from `POST /api/auth/login`)\n' +
        '- `userAuth` → Customer JWT (from `POST /api/users/register` or `POST /api/users/login`)\n\n' +
        'Real-time queue updates are pushed via Socket.io (connect to `ws://localhost:8080`).',
      contact: {
        name: 'Qless Admin',
      },
    },
    servers: [
      {
        url: 'http://localhost:8080',
        description: 'Development server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Admin/Kitchen JWT — obtained from POST /api/auth/login',
        },
        userAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Customer JWT — obtained from POST /api/users/login or /api/users/register',
        },
      },
    },
    tags: [
      { name: 'Auth', description: 'Admin / kitchen staff authentication' },
      { name: 'Users', description: 'Customer account management and authentication' },
      { name: 'Menu', description: 'Menu item management' },
      { name: 'Cart', description: 'Shopping cart (requires customer token)' },
      { name: 'Orders', description: 'Order placement and management' },
    ],
  },
  apis: ['./src/routes/*.js'],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
