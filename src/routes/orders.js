const express = require('express');
const { body, validationResult } = require('express-validator');
const Order = require('../models/Order');
const MenuItem = require('../models/MenuItem');
const { auth, userAuth } = require('../middleware/auth');
const Cart = require('../models/Cart');
const User = require('../models/User');
const { emitQueueUpdate, emitOrderReady } = require('../socket');

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Orders
 *   description: Order placement and management
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     OrderItem:
 *       type: object
 *       properties:
 *         menuItemId:
 *           type: string
 *         name:
 *           type: string
 *         quantity:
 *           type: integer
 *         price:
 *           type: number
 *     Order:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         customerName:
 *           type: string
 *         items:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/OrderItem'
 *         totalAmount:
 *           type: number
 *         status:
 *           type: string
 *           enum: [pending, preparing, ready, completed]
 *         createdAt:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * /api/orders:
 *   post:
 *     summary: Place a new order (public — used by mobile app)
 *     tags: [Orders]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customerName, items]
 *             properties:
 *               customerName:
 *                 type: string
 *                 example: John Doe
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [menuItemId, quantity]
 *                   properties:
 *                     menuItemId:
 *                       type: string
 *                     quantity:
 *                       type: integer
 *                       minimum: 1
 *     responses:
 *       201:
 *         description: Order placed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 order:
 *                   $ref: '#/components/schemas/Order'
 *                 queuePosition:
 *                   type: integer
 *                   description: Position in queue (1 = next to be served)
 *       400:
 *         description: Validation error or unavailable item
 */
router.post(
  '/',
  [
    body('customerName').trim().notEmpty().withMessage('Customer name is required'),
    body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
    body('items.*.menuItemId').notEmpty().withMessage('Each item must have a menuItemId'),
    body('items.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { customerName, items } = req.body;

    // Validate items and build order items with price snapshots
    const orderItems = [];
    let totalAmount = 0;

    for (const item of items) {
      const menuItem = await MenuItem.findById(item.menuItemId);
      if (!menuItem) {
        return res.status(400).json({ message: `Menu item ${item.menuItemId} not found.` });
      }
      if (!menuItem.isAvailable) {
        return res.status(400).json({ message: `"${menuItem.name}" is currently unavailable.` });
      }
      const lineTotal = menuItem.price * item.quantity;
      totalAmount += lineTotal;
      orderItems.push({
        menuItemId: menuItem._id,
        name: menuItem.name,
        quantity: item.quantity,
        price: menuItem.price,
      });
    }

    const order = await Order.create({ customerName, items: orderItems, totalAmount });
    const queuePosition = await order.getQueuePosition();

    // Notify all connected clients that a new order joined the queue
    emitQueueUpdate();

    res.status(201).json({ order, queuePosition });
  }
);

/**
 * @swagger
 * /api/orders:
 *   get:
 *     summary: Get all active orders — pending and preparing (admin/kitchen)
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of active orders sorted by creation time (oldest first)
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Order'
 *       401:
 *         description: Unauthorized
 */
router.get('/', auth, async (req, res) => {
  const orders = await Order.find({
    status: { $in: ['pending', 'preparing'] },
  }).sort({ createdAt: 1 });
  res.json(orders);
});

/**
 * @swagger
 * /api/orders/history:
 *   get:
 *     summary: Get order history with optional filters (admin only)
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, preparing, ready, completed]
 *         description: Filter by status
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *           format: date
 *           example: "2025-01-15"
 *         description: Filter by date (YYYY-MM-DD)
 *     responses:
 *       200:
 *         description: Filtered order history (most recent first, max 200)
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Order'
 *       401:
 *         description: Unauthorized
 */
router.get('/history', auth, async (req, res) => {
  const filter = {};

  if (req.query.status) {
    filter.status = req.query.status;
  }

  if (req.query.date) {
    const start = new Date(req.query.date);
    const end = new Date(req.query.date);
    end.setDate(end.getDate() + 1);
    filter.createdAt = { $gte: start, $lt: end };
  }

  const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(200);
  res.json(orders);
});

/**
 * @swagger
 * /api/orders/{id}:
 *   get:
 *     summary: Get order status and current queue position (public — used by mobile app)
 *     tags: [Orders]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Order details with live queue position
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 order:
 *                   $ref: '#/components/schemas/Order'
 *                 queuePosition:
 *                   type: integer
 *                   nullable: true
 *                   description: Position in queue (null if order is ready/completed)
 *       404:
 *         description: Order not found
 */
router.get('/:id', async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: 'Order not found.' });

  const isActive = ['pending', 'preparing'].includes(order.status);
  const queuePosition = isActive ? await order.getQueuePosition() : null;

  res.json({ order, queuePosition });
});

/**
 * @swagger
 * /api/orders/{id}/status:
 *   patch:
 *     summary: Update order status (admin/kitchen) — triggers real-time queue update
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [preparing, ready, completed]
 *                 description: "Status must follow the flow: pending → preparing → ready → completed"
 *     responses:
 *       200:
 *         description: Status updated, socket events emitted to all clients
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Order'
 *       400:
 *         description: Invalid status transition
 *       404:
 *         description: Order not found
 *       401:
 *         description: Unauthorized
 */
const VALID_TRANSITIONS = {
  pending: ['preparing'],
  preparing: ['ready'],
  ready: ['completed'],
  completed: [],
};

router.patch(
  '/:id/status',
  auth,
  [body('status').isIn(['pending', 'preparing', 'ready', 'completed']).withMessage('Invalid status')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found.' });

    const { status } = req.body;
    const allowed = VALID_TRANSITIONS[order.status];

    if (!allowed.includes(status)) {
      return res.status(400).json({
        message: `Cannot transition from "${order.status}" to "${status}". Allowed next status: ${allowed.join(', ') || 'none (order is completed)'}`,
      });
    }

    order.status = status;
    await order.save();

    if (status === 'ready') {
      emitOrderReady(order._id.toString());
    }

    emitQueueUpdate();

    res.json(order);
  }
);

/**
 * @swagger
 * /api/orders/from-cart:
 *   post:
 *     summary: Place an order directly from the user's cart (clears cart on success)
 *     tags: [Orders]
 *     security:
 *       - userAuth: []
 *     responses:
 *       201:
 *         description: Order placed from cart
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 order:
 *                   $ref: '#/components/schemas/Order'
 *                 queuePosition:
 *                   type: integer
 *       400:
 *         description: Cart is empty or contains unavailable items
 *       401:
 *         description: Unauthorized (user token required)
 */
router.post('/from-cart', userAuth, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ message: 'User not found.' });

  const cart = await Cart.findOne({ userId: req.user.id });
  if (!cart || cart.items.length === 0) {
    return res.status(400).json({ message: 'Your cart is empty.' });
  }

  const orderItems = [];
  let totalAmount = 0;

  for (const cartItem of cart.items) {
    const menuItem = await MenuItem.findById(cartItem.menuItemId);
    if (!menuItem) {
      return res.status(400).json({
        message: `A cart item (ID: ${cartItem.menuItemId}) no longer exists. Please refresh your cart.`,
      });
    }
    if (!menuItem.isAvailable) {
      return res.status(400).json({
        message: `"${menuItem.name}" is currently unavailable. Remove it from your cart to continue.`,
      });
    }
    const lineTotal = menuItem.price * cartItem.quantity;
    totalAmount += lineTotal;
    orderItems.push({
      menuItemId: menuItem._id,
      name: menuItem.name,
      quantity: cartItem.quantity,
      price: menuItem.price,
    });
  }

  const order = await Order.create({
    userId: user._id,
    customerName: user.name,
    items: orderItems,
    totalAmount,
  });

  const queuePosition = await order.getQueuePosition();

  // Clear the cart after successful order
  cart.items = [];
  await cart.save();

  emitQueueUpdate();

  res.status(201).json({ order, queuePosition });
});

/**
 * @swagger
 * /api/orders/my:
 *   get:
 *     summary: Get all orders placed by the current user
 *     tags: [Orders]
 *     security:
 *       - userAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, preparing, ready, completed]
 *         description: Filter by order status
 *     responses:
 *       200:
 *         description: List of the user's orders (most recent first)
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 allOf:
 *                   - $ref: '#/components/schemas/Order'
 *                   - type: object
 *                     properties:
 *                       queuePosition:
 *                         type: integer
 *                         nullable: true
 *       401:
 *         description: Unauthorized (user token required)
 */
router.get('/my', userAuth, async (req, res) => {
  const filter = { userId: req.user.id };
  if (req.query.status) filter.status = req.query.status;

  const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(50);

  // Attach live queue position to active orders
  const result = await Promise.all(
    orders.map(async (order) => {
      const isActive = ['pending', 'preparing'].includes(order.status);
      const queuePosition = isActive ? await order.getQueuePosition() : null;
      return { ...order.toObject(), queuePosition };
    })
  );

  res.json(result);
});

module.exports = router;
