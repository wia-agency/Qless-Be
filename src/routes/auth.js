const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const Admin = require('../models/Admin');

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: Admin authentication
 */

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login as admin or kitchen staff
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password]
 *             properties:
 *               username:
 *                 type: string
 *                 example: admin
 *               password:
 *                 type: string
 *                 example: secret123
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                 admin:
 *                   type: object
 *                   properties:
 *                     id: { type: string }
 *                     username: { type: string }
 *                     role: { type: string }
 *       400:
 *         description: Validation error
 *       401:
 *         description: Invalid credentials
 */
router.post(
  '/login',
  [
    body('username').trim().notEmpty().withMessage('Username is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, password } = req.body;

    const admin = await Admin.findOne({ username });
    if (!admin) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    const isMatch = await admin.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    const token = jwt.sign(
      { id: admin._id, username: admin.username, role: admin.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    res.json({
      token,
      admin: { id: admin._id, username: admin.username, role: admin.role },
    });
  }
);

/**
 * @swagger
 * /api/auth/seed:
 *   post:
 *     summary: Seed an initial admin account (only works if no admins exist)
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password, role]
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [admin, kitchen]
 *     responses:
 *       201:
 *         description: Admin created
 *       400:
 *         description: Admins already exist or validation error
 */
router.post(
  '/seed',
  [
    body('username').trim().notEmpty().withMessage('Username is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('role').isIn(['admin', 'kitchen']).withMessage('Role must be admin or kitchen'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const count = await Admin.countDocuments();
    if (count > 0) {
      return res.status(400).json({ message: 'Admins already exist. Use the admin panel to add more.' });
    }

    const { username, password, role } = req.body;
    const passwordHash = await bcrypt.hash(password, 10);
    const admin = await Admin.create({ username, passwordHash, role });

    res.status(201).json({
      message: 'Admin created successfully.',
      admin: { id: admin._id, username: admin.username, role: admin.role },
    });
  }
);

module.exports = router;
