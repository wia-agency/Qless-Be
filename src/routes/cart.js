const express = require('express');
const { body, validationResult } = require('express-validator');
const Cart = require('../models/Cart');
const MenuItem = require('../models/MenuItem');
const { userAuth } = require('../middleware/auth');

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Cart
 *   description: Shopping cart management (requires user token)
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     CartItem:
 *       type: object
 *       properties:
 *         menuItemId:
 *           type: string
 *         quantity:
 *           type: integer
 *     CartItemPopulated:
 *       type: object
 *       properties:
 *         menuItem:
 *           $ref: '#/components/schemas/MenuItem'
 *         quantity:
 *           type: integer
 *         lineTotal:
 *           type: number
 *     Cart:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         userId:
 *           type: string
 *         items:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/CartItemPopulated'
 *         grandTotal:
 *           type: number
 *         itemCount:
 *           type: integer
 */

// Helper: build populated cart response
const buildCartResponse = async (cart) => {
  const populated = [];
  let grandTotal = 0;
  let itemCount = 0;

  for (const item of cart.items) {
    const menuItem = await MenuItem.findById(item.menuItemId);
    if (!menuItem) continue; // item was deleted from menu — skip silently
    const lineTotal = menuItem.price * item.quantity;
    grandTotal += lineTotal;
    itemCount += item.quantity;
    populated.push({ menuItem, quantity: item.quantity, lineTotal });
  }

  return {
    _id: cart._id,
    userId: cart.userId,
    items: populated,
    grandTotal: parseFloat(grandTotal.toFixed(2)),
    itemCount,
    updatedAt: cart.updatedAt,
  };
};

/**
 * @swagger
 * /api/cart:
 *   get:
 *     summary: Get current user's cart with populated menu item details
 *     tags: [Cart]
 *     security:
 *       - userAuth: []
 *     responses:
 *       200:
 *         description: Cart with item details and totals
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Cart'
 *       401:
 *         description: Unauthorized
 */
router.get('/', userAuth, async (req, res) => {
  const cart = await Cart.findOne({ userId: req.user.id });
  if (!cart) return res.status(404).json({ message: 'Cart not found.' });
  res.json(await buildCartResponse(cart));
});

/**
 * @swagger
 * /api/cart/items:
 *   post:
 *     summary: Add an item to the cart (or increase quantity if already present)
 *     tags: [Cart]
 *     security:
 *       - userAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [menuItemId, quantity]
 *             properties:
 *               menuItemId:
 *                 type: string
 *               quantity:
 *                 type: integer
 *                 minimum: 1
 *                 example: 2
 *     responses:
 *       200:
 *         description: Updated cart
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Cart'
 *       400:
 *         description: Validation error or item unavailable
 *       401:
 *         description: Unauthorized
 */
router.post(
  '/items',
  userAuth,
  [
    body('menuItemId').notEmpty().withMessage('menuItemId is required'),
    body('quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { menuItemId, quantity } = req.body;

    const menuItem = await MenuItem.findById(menuItemId);
    if (!menuItem) return res.status(404).json({ message: 'Menu item not found.' });
    if (!menuItem.isAvailable) {
      return res.status(400).json({ message: `"${menuItem.name}" is currently unavailable.` });
    }

    let cart = await Cart.findOne({ userId: req.user.id });
    if (!cart) {
      cart = await Cart.create({ userId: req.user.id, items: [] });
    }

    const existing = cart.items.find(
      (i) => i.menuItemId.toString() === menuItemId
    );

    if (existing) {
      existing.quantity += quantity;
    } else {
      cart.items.push({ menuItemId, quantity });
    }

    await cart.save();
    res.json(await buildCartResponse(cart));
  }
);

/**
 * @swagger
 * /api/cart/items/{menuItemId}:
 *   put:
 *     summary: Set the quantity of a specific item in the cart
 *     tags: [Cart]
 *     security:
 *       - userAuth: []
 *     parameters:
 *       - in: path
 *         name: menuItemId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [quantity]
 *             properties:
 *               quantity:
 *                 type: integer
 *                 minimum: 1
 *                 example: 3
 *     responses:
 *       200:
 *         description: Updated cart
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Cart'
 *       404:
 *         description: Item not in cart
 *       401:
 *         description: Unauthorized
 */
router.put(
  '/items/:menuItemId',
  userAuth,
  [body('quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const cart = await Cart.findOne({ userId: req.user.id });
    if (!cart) return res.status(404).json({ message: 'Cart not found.' });

    const item = cart.items.find(
      (i) => i.menuItemId.toString() === req.params.menuItemId
    );
    if (!item) {
      return res.status(404).json({ message: 'Item not found in cart. Add it first.' });
    }

    item.quantity = req.body.quantity;
    await cart.save();
    res.json(await buildCartResponse(cart));
  }
);

/**
 * @swagger
 * /api/cart/items/{menuItemId}:
 *   delete:
 *     summary: Remove a specific item from the cart
 *     tags: [Cart]
 *     security:
 *       - userAuth: []
 *     parameters:
 *       - in: path
 *         name: menuItemId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Updated cart after removal
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Cart'
 *       404:
 *         description: Item not in cart or cart not found
 *       401:
 *         description: Unauthorized
 */
router.delete('/items/:menuItemId', userAuth, async (req, res) => {
  const cart = await Cart.findOne({ userId: req.user.id });
  if (!cart) return res.status(404).json({ message: 'Cart not found.' });

  const before = cart.items.length;
  cart.items = cart.items.filter(
    (i) => i.menuItemId.toString() !== req.params.menuItemId
  );

  if (cart.items.length === before) {
    return res.status(404).json({ message: 'Item not found in cart.' });
  }

  await cart.save();
  res.json(await buildCartResponse(cart));
});

/**
 * @swagger
 * /api/cart:
 *   delete:
 *     summary: Clear all items from the cart
 *     tags: [Cart]
 *     security:
 *       - userAuth: []
 *     responses:
 *       200:
 *         description: Cart cleared
 *       401:
 *         description: Unauthorized
 */
router.delete('/', userAuth, async (req, res) => {
  const cart = await Cart.findOne({ userId: req.user.id });
  if (!cart) return res.status(404).json({ message: 'Cart not found.' });

  cart.items = [];
  await cart.save();
  res.json({ message: 'Cart cleared.', grandTotal: 0, itemCount: 0, items: [] });
});

module.exports = router;
