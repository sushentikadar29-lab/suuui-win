const express = require('express');
const jwt = require('jsonwebtoken');
const { User } = require('../models/Schema');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// ============================================
// USER REGISTRATION
// ============================================
router.post('/register', async (req, res) => {
  try {
    const { phoneNumber, password, confirmPassword, inviteCode } = req.body;

    // Validation
    if (!phoneNumber || !password || !confirmPassword) {
      return res.status(400).json({ error: "All fields are required" });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: "Passwords do not match" });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    // Check if phone already exists
    const existingUser = await User.findOne({ phoneNumber });
    if (existingUser) {
      return res.status(400).json({ error: "Phone number already registered" });
    }

    // Create new user
    const newUser = new User({
      phoneNumber,
      password, // Will be hashed by schema pre-save hook
      inviteCode: `SUUUI${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
      referredBy: inviteCode || null
    });

    await newUser.save();

    // Generate JWT token
    const token = jwt.sign(
      { userId: newUser._id, phoneNumber: newUser.phoneNumber },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.status(201).json({
      success: true,
      message: "Registration successful",
      token,
      user: {
        userId: newUser._id,
        phoneNumber: newUser.phoneNumber,
        inviteCode: newUser.inviteCode,
        walletBalance: newUser.walletBalance
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// USER LOGIN
// ============================================
router.post('/login', async (req, res) => {
  try {
    const { phoneNumber, password } = req.body;

    if (!phoneNumber || !password) {
      return res.status(400).json({ error: "Phone number and password required" });
    }

    // Find user
    const user = await User.findOne({ phoneNumber });
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Check if account is banned
    if (user.isBanned) {
      return res.status(403).json({ error: "Your account has been restricted" });
    }

    // Verify password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id, phoneNumber: user.phoneNumber },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      success: true,
      token,
      user: {
        userId: user._id,
        phoneNumber: user.phoneNumber,
        walletBalance: user.walletBalance,
        inviteCode: user.inviteCode,
        isBanned: user.isBanned
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// MIDDLEWARE: Verify User Token
// ============================================
const verifyUserToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};

// ============================================
// GET USER PROFILE
// ============================================
router.get('/profile', verifyUserToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password');

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      success: true,
      user
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// UPDATE PASSWORD
// ============================================
router.post('/change-password', verifyUserToken, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ error: "All fields are required" });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: "New passwords do not match" });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Verify current password
    const isPasswordValid = await user.comparePassword(currentPassword);
    if (!isPasswordValid) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    res.json({
      success: true,
      message: "Password changed successfully"
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = { router, verifyUserToken };
