const express = require('express');
const { User, Bet } = require('../models/Schema');

const router = express.Router();

// ============================================
// HELPER: Verify User Token (Basic JWT)
// ============================================
const verifyUserToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }
  
  try {
    // In production, verify JWT properly
    req.userId = req.body.userId; // Simplified - use proper JWT in production
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid token" });
  }
};

// ============================================
// WITHDRAWAL REQUEST
// ============================================
router.post('/withdraw', verifyUserToken, async (req, res) => {
  try {
    const { userId, amount, method, bankDetails } = req.body;

    // 1. Input Validation
    if (!userId || !amount || !method) {
      return res.status(400).json({ error: "Missing required fields: userId, amount, method" });
    }

    if (typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const validMethods = ['BANK', 'UPI', 'USDT'];
    if (!validMethods.includes(method)) {
      return res.status(400).json({ error: "Invalid withdrawal method" });
    }

    // 2. Get User
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // 3. Check if user is banned
    if (user.isBanned) {
      return res.status(403).json({ error: "Your account has been restricted and cannot withdraw" });
    }

    // 4. Check Daily Withdrawal Limit (Max 3 per day)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let lastWithdrawDay = null;
    if (user.lastWithdrawalDate) {
      const lastDate = new Date(user.lastWithdrawalDate);
      lastDate.setHours(0, 0, 0, 0);
      lastWithdrawDay = lastDate;
    }

    if (lastWithdrawDay && lastWithdrawDay.getTime() === today.getTime()) {
      if (user.todayWithdrawalCount >= 3) {
        return res.status(400).json({ 
          error: "Daily limit reached! Maximum 3 withdrawals allowed per day.",
          remainingToday: 0
        });
      }
    }

    // 5. Check Wagering Requirement (Total Wagered >= Total Deposited)
    if (user.totalWagered < user.totalDeposited) {
      const remainingWager = user.totalDeposited - user.totalWagered;
      return res.status(400).json({ 
        error: `Wagering requirement not met! You must wager ₹${remainingWager.toFixed(2)} more before withdrawing.`,
        remainingWager: remainingWager.toFixed(2),
        totalDeposited: user.totalDeposited,
        totalWagered: user.totalWagered
      });
    }

    // 6. Check Withdrawal Amount Range by Method
    const withdrawalLimits = {
      BANK: { min: 110, max: 50000 },
      UPI: { min: 150, max: 100000 },
      USDT: { min: 1030, max: 500000 }
    };

    const limits = withdrawalLimits[method];
    if (amount < limits.min || amount > limits.max) {
      return res.status(400).json({ 
        error: `${method} withdrawal range: ₹${limits.min} - ₹${limits.max}`,
        limits
      });
    }

    // 7. Check Sufficient Balance
    if (user.walletBalance < amount) {
      return res.status(400).json({ 
        error: "Insufficient wallet balance",
        availableBalance: user.walletBalance
      });
    }

    // 8. Validate Bank Details if BANK method
    if (method === 'BANK') {
      if (!bankDetails || !bankDetails.accountNumber || !bankDetails.ifscCode || !bankDetails.accountHolder) {
        return res.status(400).json({ 
          error: "Bank details required: accountNumber, ifscCode, accountHolder" 
        });
      }
    }

    // 9. Deduct balance and update withdrawal count
    user.walletBalance -= amount;
    
    // Reset counter if it's a new day
    if (!lastWithdrawDay || lastWithdrawDay.getTime() !== today.getTime()) {
      user.todayWithdrawalCount = 1;
    } else {
      user.todayWithdrawalCount += 1;
    }
    
    user.lastWithdrawalDate = new Date();
    await user.save();

    // 10. Create withdrawal record (in production, save to WithdrawalRequest collection)
    // const withdrawal = new Withdrawal({
    //   userId,
    //   amount,
    //   method,
    //   bankDetails: method === 'BANK' ? bankDetails : null,
    //   status: 'PENDING',
    //   createdAt: new Date()
    // });
    // await withdrawal.save();

    res.json({ 
      success: true, 
      message: "Withdrawal request submitted successfully!",
      withdrawal: {
        amount,
        method,
        status: 'PENDING',
        requestedAt: new Date(),
        remainingWithdrawalsToday: 3 - user.todayWithdrawalCount
      }
    });

  } catch (error) {
    console.error('Withdrawal error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// GET WITHDRAWAL HISTORY
// ============================================
router.get('/withdrawal-history/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit) || 20;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Get withdrawal records from database (add this collection)
    const withdrawals = await Withdrawal.find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit);

    res.json({
      userId,
      withdrawals,
      totalWithdrawn: withdrawals
        .filter(w => w.status === 'COMPLETED')
        .reduce((sum, w) => sum + w.amount, 0)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// GET WITHDRAWAL STATUS
// ============================================
router.get('/withdrawal-status/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);
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
      userId,
      walletBalance: user.walletBalance,
      totalDeposited: user.totalDeposited,
      totalWagered: user.totalWagered,
      wageringComplete: user.totalWagered >= user.totalDeposited,
      remainingWager: Math.max(0, user.totalDeposited - user.totalWagered),
      dailyWithdrawals: {
        used: isToday ? user.todayWithdrawalCount : 0,
        remaining: withdrawalsRemaining,
        lastWithdrawalDate: user.lastWithdrawalDate,
        resetsAt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// DEPOSIT (to add funds to wallet)
// ============================================
router.post('/deposit', async (req, res) => {
  try {
    const { userId, amount, transactionId } = req.body;

    if (!userId || !amount || !transactionId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Verify transaction with payment gateway (implement in production)
    // For now, assume verified

    user.walletBalance += amount;
    user.totalDeposited += amount;
    await user.save();

    res.json({
      success: true,
      message: "Deposit successful",
      deposit: {
        amount,
        transactionId,
        newBalance: user.walletBalance,
        totalDeposited: user.totalDeposited
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
