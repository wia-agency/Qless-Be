const express = require('express');
const { body, param, validationResult } = require('express-validator');
const MenuItem = require('../models/MenuItem');
const { auth, requireRole } = require('../middleware/auth');

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Menu
 *   description: Menu item management
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     MenuItem:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         name:
 *           type: string
 *         description:
 *           type: string
 *         price:
 *           type: number
 *         category:
 *           type: string
 *           enum: [Main, Snack, Drink, Beverage, Dessert]
 *         isAvailable:
 *           type: boolean
 *         imageUrl:
 *           type: string
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * /api/menu:
 *   get:
 *     summary: Get all available menu items (public)
 *     tags: [Menu]
 *     responses:
 *       200:
 *         description: List of available menu items
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/MenuItem'
 */
router.get('/', async (req, res) => {
  const items = await MenuItem.find({ isAvailable: true }).sort({ category: 1, name: 1 });
  res.json(items);
});

/**
 * @swagger
 * /api/menu/all:
 *   get:
 *     summary: Get all menu items including unavailable (admin only)
 *     tags: [Menu]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Full list of menu items
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/MenuItem'
 *       401:
 *         description: Unauthorized
 */
router.get('/all', auth, async (req, res) => {
  const items = await MenuItem.find().sort({ category: 1, name: 1 });
  res.json(items);
});

/**
 * @swagger
 * /api/menu/{id}:
 *   get:
 *     summary: Get a single menu item by ID (public)
 *     tags: [Menu]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Menu item found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MenuItem'
 *       404:
 *         description: Item not found
 */
router.get('/:id', async (req, res) => {
  const item = await MenuItem.findById(req.params.id);
  if (!item) return res.status(404).json({ message: 'Menu item not found.' });
  res.json(item);
});

/**
 * @swagger
 * /api/menu:
 *   post:
 *     summary: Add a new menu item (admin only)
 *     tags: [Menu]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, price, category]
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               price:
 *                 type: number
 *               category:
 *                 type: string
 *                 enum: [Main, Snack, Drink, Beverage, Dessert]
 *               isAvailable:
 *                 type: boolean
 *               imageUrl:
 *                 type: string
 *     responses:
 *       201:
 *         description: Menu item created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MenuItem'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.post(
  '/',
  auth,
  requireRole('admin'),
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('price').isFloat({ min: 0 }).withMessage('Price must be a non-negative number'),
    body('category')
      .isIn(['Main', 'Snack', 'Drink', 'Beverage', 'Dessert'])
      .withMessage('Invalid category'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, description, price, category, isAvailable, imageUrl } = req.body;
    const item = await MenuItem.create({ name, description, price, category, isAvailable, imageUrl });
    res.status(201).json(item);
  }
);

/**
 * @swagger
 * /api/menu/{id}:
 *   put:
 *     summary: Update a menu item (admin only)
 *     tags: [Menu]
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
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               price:
 *                 type: number
 *               category:
 *                 type: string
 *                 enum: [Main, Snack, Drink, Beverage, Dessert]
 *               isAvailable:
 *                 type: boolean
 *               imageUrl:
 *                 type: string
 *     responses:
 *       200:
 *         description: Menu item updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MenuItem'
 *       404:
 *         description: Item not found
 *       401:
 *         description: Unauthorized
 */
router.put(
  '/:id',
  auth,
  requireRole('admin'),
  [
    body('price').optional().isFloat({ min: 0 }).withMessage('Price must be a non-negative number'),
    body('category')
      .optional()
      .isIn(['Main', 'Snack', 'Drink', 'Beverage', 'Dessert'])
      .withMessage('Invalid category'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const allowed = ['name', 'description', 'price', 'category', 'isAvailable', 'imageUrl'];
    const updates = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => allowed.includes(k))
    );

    const item = await MenuItem.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
    if (!item) return res.status(404).json({ message: 'Menu item not found.' });
    res.json(item);
  }
);

/**
 * @swagger
 * /api/menu/{id}:
 *   delete:
 *     summary: Delete a menu item (admin only)
 *     tags: [Menu]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Menu item deleted
 *       404:
 *         description: Item not found
 *       401:
 *         description: Unauthorized
 */
router.delete('/:id', auth, requireRole('admin'), async (req, res) => {
  const item = await MenuItem.findByIdAndDelete(req.params.id);
  if (!item) return res.status(404).json({ message: 'Menu item not found.' });
  res.json({ message: 'Menu item deleted.' });
});

module.exports = router;
