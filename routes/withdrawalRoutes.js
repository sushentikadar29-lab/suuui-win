const express = require('express');
const { WithdrawalRequest, DepositMethodConfig, User, AuditLog, Admin } = require('../models/Schema');
const jwt = require('jsonwebtoken');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

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
// MIDDLEWARE: Verify Admin Token
// ============================================
const verifyAdminToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.adminId) {
      return res.status(403).json({ error: "Admin access required" });
    }
    req.admin = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};

// ============================================
// USER: REQUEST WITHDRAWAL
// ============================================
router.post('/create-withdrawal-request', verifyUserToken, async (req, res) => {
  try {
    const { withdrawalMethod, amount, methodId, upiId, bankDetails, cryptoDetails } = req.body;

    // Validation
    if (!withdrawalMethod || !amount || !methodId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    // Get user
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Check if account is banned
    if (user.isBanned) {
      return res.status(403).json({ error: "Your account has been restricted" });
    }

    // Get withdrawal method config
    const methodConfig = await DepositMethodConfig.findById(methodId);
    if (!methodConfig || !methodConfig.isActive) {
      return res.status(404).json({ error: "Withdrawal method not available" });
    }

    // Check amount limits
    if (amount < methodConfig.minAmount || amount > methodConfig.maxAmount) {
      return res.status(400).json({
        error: `${withdrawalMethod} withdrawal range: ₹${methodConfig.minAmount} - ₹${methodConfig.maxAmount}`,
        limits: { min: methodConfig.minAmount, max: methodConfig.maxAmount }
      });
    }

    // Check sufficient balance
    if (user.walletBalance < amount) {
      return res.status(400).json({
        error: "Insufficient wallet balance",
        availableBalance: user.walletBalance
      });
    }

    // Check wagering requirement
    if (user.totalWagered < user.totalDeposited) {
      const remainingWager = user.totalDeposited - user.totalWagered;
      return res.status(400).json({
        error: `Wagering requirement not met. You must wager ₹${remainingWager.toFixed(2)} more.`,
        remainingWager: remainingWager.toFixed(2),
        totalDeposited: user.totalDeposited,
        totalWagered: user.totalWagered
      });
    }

    // Check daily withdrawal limit (max 3 per day)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let lastWithdrawDay = null;
    if (user.lastWithdrawalDate) {
      const lastDate = new Date(user.lastWithdrawalDate);
      lastDate.setHours(0, 0, 0, 0);
      lastWithdrawDay = lastDate;
    }

    let todayWithdrawals = 0;
    if (lastWithdrawDay && lastWithdrawDay.getTime() === today.getTime()) {
      todayWithdrawals = user.todayWithdrawalCount;
    }

    if (todayWithdrawals >= 3) {
      return res.status(400).json({
        error: "Daily withdrawal limit reached. Maximum 3 withdrawals per day.",
        remainingToday: 0,
        resetsAt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
      });
    }

    // Create withdrawal request
    const withdrawalRequest = new WithdrawalRequest({
      userId: req.user.userId,
      withdrawalMethod,
      amount,
      status: 'PENDING'
    });

    // Add method-specific details
    if (withdrawalMethod === 'UPI') {
      if (!upiId) return res.status(400).json({ error: "UPI ID required" });
      withdrawalRequest.upiId = upiId;
    } else if (withdrawalMethod === 'BANK_TRANSFER') {
      if (!bankDetails || !bankDetails.accountNumber || !bankDetails.ifscCode) {
        return res.status(400).json({ error: "Bank details required" });
      }
      withdrawalRequest.bankAccountNumber = bankDetails.accountNumber;
      withdrawalRequest.ifscCode = bankDetails.ifscCode;
      withdrawalRequest.bankName = bankDetails.bankName;
      withdrawalRequest.accountHolderName = bankDetails.accountHolder;
    } else if (withdrawalMethod === 'CRYPTO') {
      if (!cryptoDetails || !cryptoDetails.walletAddress) {
        return res.status(400).json({ error: "Wallet address required" });
      }
      withdrawalRequest.walletAddress = cryptoDetails.walletAddress;
      withdrawalRequest.cryptoType = cryptoDetails.cryptoType || methodConfig.cryptoType;
    }

    await withdrawalRequest.save();

    // Deduct from user wallet immediately (pending admin approval)
    user.walletBalance -= amount;
    user.todayWithdrawalCount = todayWithdrawals + 1;
    user.lastWithdrawalDate = new Date();
    await user.save();

    res.json({
      success: true,
      message: "Withdrawal request created successfully",
      withdrawalRequest: {
        _id: withdrawalRequest._id,
        amount,
        method: withdrawalMethod,
        status: 'PENDING',
        createdAt: withdrawalRequest.createdAt,
        estimatedCompletion: "24-48 hours"
      },
      remainingWithdrawalsToday: 3 - (todayWithdrawals + 1)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// USER: GET WITHDRAWAL HISTORY
// ============================================
router.get('/withdrawal-history', verifyUserToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const status = req.query.status; // Optional filter

    const query = { userId: req.user.userId };
    if (status) {
      query.status = status;
    }

    const withdrawals = await WithdrawalRequest.find(query)
      .sort({ createdAt: -1 })
      .limit(limit);

    const stats = {
      totalRequests: withdrawals.length,
      completedWithdrawals: withdrawals.filter(w => w.status === 'COMPLETED').length,
      totalWithdrawn: withdrawals
        .filter(w => w.status === 'COMPLETED')
        .reduce((sum, w) => sum + w.amount, 0),
      pendingCount: withdrawals.filter(w => w.status === 'PENDING').length,
      processingCount: withdrawals.filter(w => w.status === 'PROCESSING').length
    };

    res.json({
      success: true,
      withdrawals,
      stats
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// USER: GET WITHDRAWAL STATUS
// ============================================
router.get('/withdrawal-status', verifyUserToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let lastWithdrawDay = null;
    if (user.lastWithdrawalDate) {
      const lastDate = new Date(user.lastWithdrawalDate);
      lastDate.setHours(0, 0, 0, 0);
      lastWithdrawDay = lastDate;
    }

    const isToday = lastWithdrawDay && lastWithdrawDay.getTime() === today.getTime();
    const withdrawalsRemaining = isToday ? 3 - user.todayWithdrawalCount : 3;

    res.json({
      success: true,
      walletBalance: user.walletBalance,
      totalDeposited: user.totalDeposited,
      totalWagered: user.totalWagered,
      wageringComplete: user.totalWagered >= user.totalDeposited,
      remainingWager: Math.max(0, user.totalDeposited - user.totalWagered),
      dailyWithdrawals: {
        used: isToday ? user.todayWithdrawalCount : 0,
        remaining: withdrawalsRemaining,
        limit: 3,
        resetsAt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ADMIN: GET ALL PENDING WITHDRAWAL REQUESTS
// ============================================
router.get('/admin/pending-withdrawals', verifyAdminToken, async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin.adminId);
    if (!admin || !admin.permissions.canProcessWithdrawals) {
      return res.status(403).json({ error: "Permission denied" });
    }

    const limit = parseInt(req.query.limit) || 50;
    const skip = parseInt(req.query.skip) || 0;
    const status = req.query.status || 'PENDING';

    const withdrawals = await WithdrawalRequest.find({ status })
      .sort({ createdAt: 1 })
      .limit(limit)
      .skip(skip)
      .populate('userId', 'phoneNumber walletBalance')
      .populate('processedBy', 'username');

    const total = await WithdrawalRequest.countDocuments({ status });

    res.json({
      success: true,
      withdrawals,
      pagination: { total, limit, skip }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ADMIN: PROCESS WITHDRAWAL
// ============================================
router.post('/admin/process-withdrawal', verifyAdminToken, async (req, res) => {
  try {
    const { withdrawalRequestId, approved, txHash, rejectionReason } = req.body;

    const admin = await Admin.findById(req.admin.adminId);
    if (!admin || !admin.permissions.canProcessWithdrawals) {
      return res.status(403).json({ error: "Permission denied" });
    }

    const withdrawalRequest = await WithdrawalRequest.findById(withdrawalRequestId);
    if (!withdrawalRequest) {
      return res.status(404).json({ error: "Withdrawal request not found" });
    }

    if (withdrawalRequest.status !== 'PENDING') {
      return res.status(400).json({ error: "Request already processed" });
    }

    const user = await User.findById(withdrawalRequest.userId);

    if (approved) {
      // Process withdrawal
      withdrawalRequest.status = 'PROCESSING';
      withdrawalRequest.processedBy = req.admin.adminId;

      if (txHash) {
        withdrawalRequest.txHash = txHash;
      }

      withdrawalRequest.processedAt = new Date();

      // Mark as completed after processing
      withdrawalRequest.status = 'COMPLETED';
      withdrawalRequest.completedAt = new Date();
    } else {
      // Reject withdrawal and refund user
      withdrawalRequest.status = 'REJECTED';
      withdrawalRequest.rejectionReason = rejectionReason || 'Verification failed';
      withdrawalRequest.processedBy = req.admin.adminId;
      withdrawalRequest.processedAt = new Date();

      // Refund user wallet
      if (user) {
        user.walletBalance += withdrawalRequest.amount;
        await user.save();
      }
    }

    await withdrawalRequest.save();

    // Log audit
    const auditLog = new AuditLog({
      adminId: req.admin.adminId,
      action: `WITHDRAWAL_${approved ? 'APPROVED' : 'REJECTED'}`,
      details: {
        withdrawalId: withdrawalRequestId,
        userId: withdrawalRequest.userId,
        amount: withdrawalRequest.amount,
        method: withdrawalRequest.withdrawalMethod,
        reason: rejectionReason
      },
      ipAddress: req.ip
    });
    await auditLog.save();

    res.json({
      success: true,
      message: `Withdrawal ${approved ? 'approved' : 'rejected'}`,
      withdrawal: {
        _id: withdrawalRequest._id,
        status: withdrawalRequest.status,
        amount: withdrawalRequest.amount,
        method: withdrawalRequest.withdrawalMethod
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ADMIN: GET WITHDRAWAL STATISTICS
// ============================================
router.get('/admin/withdrawal-stats', verifyAdminToken, async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin.adminId);
    if (!admin || !admin.permissions.canProcessWithdrawals) {
      return res.status(403).json({ error: "Permission denied" });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // Today's stats
    const todayRequests = await WithdrawalRequest.find({
      createdAt: { $gte: today }
    });

    // Yesterday's stats
    const yesterdayRequests = await WithdrawalRequest.find({
      createdAt: { $gte: yesterday, $lt: today }
    });

    // Overall stats
    const allRequests = await WithdrawalRequest.find();

    const calculateStats = (requests) => ({
      total: requests.length,
      completed: requests.filter(r => r.status === 'COMPLETED').length,
      pending: requests.filter(r => r.status === 'PENDING').length,
      processing: requests.filter(r => r.status === 'PROCESSING').length,
      rejected: requests.filter(r => r.status === 'REJECTED').length,
      totalAmount: requests.reduce((sum, r) => sum + r.amount, 0),
      completedAmount: requests
        .filter(r => r.status === 'COMPLETED')
        .reduce((sum, r) => sum + r.amount, 0)
    });

    res.json({
      success: true,
      stats: {
        today: calculateStats(todayRequests),
        yesterday: calculateStats(yesterdayRequests),
        overall: calculateStats(allRequests)
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
