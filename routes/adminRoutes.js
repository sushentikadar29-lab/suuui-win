const express = require('express');
const jwt = require('jsonwebtoken');
const { Admin, GameResult, AuditLog } = require('../models/Schema');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// ============================================
// ADMIN LOGIN
// ============================================
router.post('/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password required" });
    }

    const admin = await Admin.findOne({ username });
    if (!admin) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const isPasswordValid = await admin.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (!admin.isActive) {
      return res.status(403).json({ error: "Admin account is disabled" });
    }

    const token = jwt.sign(
      { adminId: admin._id, username: admin.username, role: admin.role },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      success: true,
      token,
      admin: { username: admin.username, role: admin.role }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// MIDDLEWARE: Verify Admin Token
// ============================================
const verifyAdminToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};

// ============================================
// SET NEXT GAME RESULT (Admin Override)
// ============================================
router.post('/admin/set-game-result', verifyAdminToken, async (req, res) => {
  try {
    const { periodId, forcedNumber, gameType } = req.body;

    // Validation
    if (!periodId || forcedNumber === undefined) {
      return res.status(400).json({ error: "periodId and forcedNumber are required" });
    }

    if (forcedNumber < 0 || forcedNumber > 9 || !Number.isInteger(forcedNumber)) {
      return res.status(400).json({ error: "forcedNumber must be integer 0-9" });
    }

    // Only SUPER_ADMIN can override results
    if (req.admin.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: "Only SUPER_ADMIN can set game results" });
    }

    // Check if result already exists
    const existingResult = await GameResult.findOne({ periodId });
    if (existingResult) {
      return res.status(400).json({ error: `Result for period ${periodId} already exists` });
    }

    // Calculate color and size based on forced number
    let winningColor;
    if (forcedNumber === 0) {
      winningColor = 'Red+Violet';
    } else if (forcedNumber === 5) {
      winningColor = 'Green+Violet';
    } else {
      winningColor = forcedNumber % 2 === 0 ? 'Red' : 'Green';
    }

    const winningSize = forcedNumber >= 5 ? 'Big' : 'Small';

    // Save game result
    const gameResult = new GameResult({
      periodId,
      gameType: gameType || 'WinGo_30s',
      winningNumber: forcedNumber,
      winningColor,
      winningSize,
      isAdminOverride: true
    });

    await gameResult.save();

    // Log admin action
    const auditLog = new AuditLog({
      adminId: req.admin.adminId,
      action: 'SET_RESULT',
      periodId,
      forcedNumber,
      ipAddress: req.ip
    });

    await auditLog.save();

    res.json({
      success: true,
      message: `Period ${periodId} result set to ${forcedNumber} (${winningColor} / ${winningSize})`,
      result: {
        periodId,
        winningNumber: forcedNumber,
        winningColor,
        winningSize
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// GET UPCOMING PRESET (View next override)
// ============================================
router.get('/admin/next-preset', verifyAdminToken, async (req, res) => {
  try {
    if (req.admin.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    const gameType = req.query.gameType || 'WinGo_30s';

    // Get the most recent override that hasn't been used yet
    const preset = await GameResult.findOne({
      gameType,
      createdAt: { $gte: new Date(Date.now() - 60000) } // Last 1 minute
    }).sort({ createdAt: -1 });

    if (!preset) {
      return res.json({ preset: null, message: "No upcoming preset configured" });
    }

    res.json({
      preset: {
        periodId: preset.periodId,
        winningNumber: preset.winningNumber,
        gameType: preset.gameType
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// VIEW AUDIT LOGS
// ============================================
router.get('/admin/audit-logs', verifyAdminToken, async (req, res) => {
  try {
    if (req.admin.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    const limit = parseInt(req.query.limit) || 50;
    const skip = parseInt(req.query.skip) || 0;

    const logs = await AuditLog.find()
      .sort({ timestamp: -1 })
      .limit(limit)
      .skip(skip)
      .populate('adminId', 'username');

    const total = await AuditLog.countDocuments();

    res.json({
      logs,
      pagination: { total, limit, skip }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// CREATE NEW ADMIN (SUPER_ADMIN only)
// ============================================
router.post('/admin/create-admin', verifyAdminToken, async (req, res) => {
  try {
    if (req.admin.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: "Only SUPER_ADMIN can create admins" });
    }

    const { username, password, role } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password required" });
    }

    const existingAdmin = await Admin.findOne({ username });
    if (existingAdmin) {
      return res.status(400).json({ error: "Username already exists" });
    }

    const newAdmin = new Admin({
      username,
      password,
      role: role || 'ADMIN'
    });

    await newAdmin.save();

    res.json({
      success: true,
      message: `Admin ${username} created successfully`,
      admin: { username: newAdmin.username, role: newAdmin.role }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// DISABLE ADMIN ACCOUNT
// ============================================
router.post('/admin/disable-admin/:adminId', verifyAdminToken, async (req, res) => {
  try {
    if (req.admin.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: "Only SUPER_ADMIN can disable admins" });
    }

    const admin = await Admin.findByIdAndUpdate(
      req.params.adminId,
      { isActive: false },
      { new: true }
    );

    if (!admin) {
      return res.status(404).json({ error: "Admin not found" });
    }

    res.json({
      success: true,
      message: `Admin ${admin.username} has been disabled`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
