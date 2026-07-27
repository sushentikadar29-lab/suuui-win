const express = require('express');
const { DepositRequest, DepositMethodConfig, User, AuditLog, Admin } = require('../models/Schema');
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
// USER: GET AVAILABLE DEPOSIT METHODS
// ============================================
router.get('/deposit-methods', async (req, res) => {
  try {
    const methods = await DepositMethodConfig.find({ isActive: true })
      .select('-addedBy');

    const formattedMethods = methods.map(method => {
      const response = {
        _id: method._id,
        methodType: method.methodType,
        minAmount: method.minAmount,
        maxAmount: method.maxAmount,
        bonus: method.bonus
      };

      if (method.methodType === 'UPI') {
        response.upiId = method.upiId;
        response.upiQRCode = method.upiQRCode;
      } else if (method.methodType === 'BANK_TRANSFER') {
        response.bankName = method.bankName;
        response.accountHolderName = method.accountHolderName;
      } else if (method.methodType === 'CRYPTO') {
        response.cryptoType = method.cryptoType;
        response.networkType = method.networkType;
      }

      return response;
    });

    res.json({
      success: true,
      methods: formattedMethods
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// USER: INITIATE DEPOSIT REQUEST
// ============================================
router.post('/create-deposit-request', verifyUserToken, async (req, res) => {
  try {
    const { depositMethod, amount, methodId } = req.body;

    // Validation
    if (!depositMethod || !amount || !methodId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    // Get deposit method config
    const methodConfig = await DepositMethodConfig.findById(methodId);
    if (!methodConfig || !methodConfig.isActive) {
      return res.status(404).json({ error: "Deposit method not available" });
    }

    // Check amount limits
    if (amount < methodConfig.minAmount || amount > methodConfig.maxAmount) {
      return res.status(400).json({
        error: `${depositMethod} deposit range: ₹${methodConfig.minAmount} - ₹${methodConfig.maxAmount}`
      });
    }

    // Generate order number
    const orderNumber = `ORD${Date.now()}${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

    // Create deposit request
    const depositRequest = new DepositRequest({
      userId: req.user.userId,
      depositMethod,
      amount,
      status: 'PENDING'
    });

    // Add method-specific details
    if (depositMethod === 'UPI') {
      depositRequest.upiId = methodConfig.upiId;
      depositRequest.upiOrderNumber = orderNumber;
    } else if (depositMethod === 'BANK_TRANSFER') {
      depositRequest.bankAccountNumber = methodConfig.bankAccountNumber;
      depositRequest.ifscCode = methodConfig.ifscCode;
      depositRequest.bankName = methodConfig.bankName;
      depositRequest.accountHolderName = methodConfig.accountHolderName;
    } else if (depositMethod === 'CRYPTO') {
      depositRequest.walletAddress = methodConfig.walletAddress;
      depositRequest.cryptoType = methodConfig.cryptoType;
    }

    await depositRequest.save();

    // Format response based on method
    const response = {
      success: true,
      depositRequest: {
        _id: depositRequest._id,
        orderNumber: orderNumber,
        depositMethod,
        amount,
        status: 'PENDING',
        bonus: methodConfig.bonus,
        createdAt: depositRequest.createdAt
      }
    };

    // Add method-specific payment details for user
    if (depositMethod === 'UPI') {
      response.paymentDetails = {
        upiId: methodConfig.upiId,
        orderNumber: orderNumber,
        amount: amount,
        instructions: `Send ₹${amount} to UPI ID: ${methodConfig.upiId} with reference: ${orderNumber}`
      };
    } else if (depositMethod === 'BANK_TRANSFER') {
      response.paymentDetails = {
        bankName: methodConfig.bankName,
        accountHolderName: methodConfig.accountHolderName,
        accountNumber: methodConfig.bankAccountNumber,
        ifscCode: methodConfig.ifscCode,
        amount: amount,
        instructions: `Transfer ₹${amount} to the above account with reference: ${orderNumber}`
      };
    } else if (depositMethod === 'CRYPTO') {
      response.paymentDetails = {
        cryptoType: methodConfig.cryptoType,
        walletAddress: methodConfig.walletAddress,
        networkType: methodConfig.networkType,
        amount: amount,
        instructions: `Send ${amount} ${methodConfig.cryptoType} to: ${methodConfig.walletAddress}`
      };
    }

    res.json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// USER: SUBMIT PROOF OF PAYMENT
// ============================================
router.post('/submit-deposit-proof', verifyUserToken, async (req, res) => {
  try {
    const { depositRequestId, transactionId, utrNumber, cryptoTxHash, proofScreenshot } = req.body;

    if (!depositRequestId) {
      return res.status(400).json({ error: "Deposit request ID required" });
    }

    const depositRequest = await DepositRequest.findById(depositRequestId);
    if (!depositRequest) {
      return res.status(404).json({ error: "Deposit request not found" });
    }

    if (depositRequest.userId.toString() !== req.user.userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    if (depositRequest.status !== 'PENDING') {
      return res.status(400).json({ error: `Cannot submit proof for ${depositRequest.status} request` });
    }

    // Add proof based on method
    if (depositRequest.depositMethod === 'UPI' && transactionId) {
      depositRequest.transactionId = transactionId;
    } else if (depositRequest.depositMethod === 'BANK_TRANSFER' && utrNumber) {
      depositRequest.utrNumber = utrNumber;
    } else if (depositRequest.depositMethod === 'CRYPTO' && cryptoTxHash) {
      depositRequest.cryptoTxHash = cryptoTxHash;
    }

    // Add screenshot if provided
    if (proofScreenshot) {
      depositRequest.proofScreenshot = proofScreenshot;
    }

    await depositRequest.save();

    res.json({
      success: true,
      message: "Proof of payment submitted. Awaiting admin verification.",
      depositRequest: {
        _id: depositRequest._id,
        status: depositRequest.status,
        submittedAt: new Date()
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// USER: GET DEPOSIT HISTORY
// ============================================
router.get('/deposit-history', verifyUserToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const deposits = await DepositRequest.find({ userId: req.user.userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('-proofScreenshot');

    const stats = {
      totalDeposits: deposits.length,
      completedDeposits: deposits.filter(d => d.status === 'COMPLETED').length,
      totalDeposited: deposits
        .filter(d => d.status === 'COMPLETED')
        .reduce((sum, d) => sum + d.amount, 0),
      pendingCount: deposits.filter(d => d.status === 'PENDING').length
    };

    res.json({
      success: true,
      deposits,
      stats
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ADMIN: GET ALL PENDING DEPOSIT REQUESTS
// ============================================
router.get('/admin/pending-deposits', verifyAdminToken, async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin.adminId);
    if (!admin || !admin.permissions.canVerifyDeposits) {
      return res.status(403).json({ error: "Permission denied" });
    }

    const limit = parseInt(req.query.limit) || 50;
    const skip = parseInt(req.query.skip) || 0;

    const deposits = await DepositRequest.find({ status: 'PENDING' })
      .sort({ createdAt: 1 })
      .limit(limit)
      .skip(skip)
      .populate('userId', 'phoneNumber walletBalance');

    const total = await DepositRequest.countDocuments({ status: 'PENDING' });

    res.json({
      success: true,
      deposits,
      pagination: { total, limit, skip }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ADMIN: VERIFY DEPOSIT & CREDIT USER
// ============================================
router.post('/admin/verify-deposit', verifyAdminToken, async (req, res) => {
  try {
    const { depositRequestId, approved, notes } = req.body;

    const admin = await Admin.findById(req.admin.adminId);
    if (!admin || !admin.permissions.canVerifyDeposits) {
      return res.status(403).json({ error: "Permission denied" });
    }

    const depositRequest = await DepositRequest.findById(depositRequestId);
    if (!depositRequest) {
      return res.status(404).json({ error: "Deposit request not found" });
    }

    if (depositRequest.status !== 'PENDING') {
      return res.status(400).json({ error: "Request already processed" });
    }

    if (approved) {
      // Verify deposit and credit user
      depositRequest.status = 'VERIFIED';
      depositRequest.verifiedBy = req.admin.adminId;
      depositRequest.verificationNotes = notes || 'Payment verified';
      depositRequest.verifiedAt = new Date();

      // Get method config for bonus
      const methodConfig = await DepositMethodConfig.findOne({
        methodType: depositRequest.depositMethod
      });

      const bonusAmount = (depositRequest.amount * methodConfig.bonus) / 100;
      const totalCredit = depositRequest.amount + bonusAmount;

      // Update user wallet
      await User.findByIdAndUpdate(
        depositRequest.userId,
        {
          $inc: {
            walletBalance: totalCredit,
            totalDeposited: depositRequest.amount
          }
        }
      );

      depositRequest.status = 'COMPLETED';
      depositRequest.completedAt = new Date();
    } else {
      // Reject deposit
      depositRequest.status = 'REJECTED';
      depositRequest.verificationNotes = notes || 'Payment verification failed';
    }

    await depositRequest.save();

    // Log audit
    const auditLog = new AuditLog({
      adminId: req.admin.adminId,
      action: `DEPOSIT_${approved ? 'APPROVED' : 'REJECTED'}`,
      details: {
        depositId: depositRequestId,
        userId: depositRequest.userId,
        amount: depositRequest.amount,
        method: depositRequest.depositMethod
      },
      ipAddress: req.ip
    });
    await auditLog.save();

    res.json({
      success: true,
      message: `Deposit ${approved ? 'approved' : 'rejected'}`,
      deposit: {
        _id: depositRequest._id,
        status: depositRequest.status,
        userId: depositRequest.userId,
        amount: depositRequest.amount
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ADMIN: ADD NEW DEPOSIT METHOD (SUPER_ADMIN only)
// ============================================
router.post('/admin/add-deposit-method', verifyAdminToken, async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin.adminId);
    if (admin.role !== 'MASTER_ADMIN' || !admin.permissions.canAddDepositMethods) {
      return res.status(403).json({ error: "Only MASTER_ADMIN can add deposit methods" });
    }

    const { methodType, upiId, bankDetails, cryptoDetails, minAmount, maxAmount, bonus } = req.body;

    if (!methodType || !['UPI', 'BANK_TRANSFER', 'CRYPTO'].includes(methodType)) {
      return res.status(400).json({ error: "Invalid method type" });
    }

    // Check if method already exists
    const existing = await DepositMethodConfig.findOne({ methodType });
    if (existing) {
      return res.status(400).json({ error: `${methodType} method already configured` });
    }

    const newMethod = new DepositMethodConfig({
      methodType,
      minAmount: minAmount || 10,
      maxAmount: maxAmount || 100000,
      bonus: bonus || 0,
      addedBy: req.admin.adminId
    });

    if (methodType === 'UPI') {
      if (!upiId) return res.status(400).json({ error: "UPI ID required" });
      newMethod.upiId = upiId;
    } else if (methodType === 'BANK_TRANSFER') {
      if (!bankDetails || !bankDetails.accountNumber || !bankDetails.ifscCode) {
        return res.status(400).json({ error: "Bank details required" });
      }
      newMethod.bankAccountNumber = bankDetails.accountNumber;
      newMethod.ifscCode = bankDetails.ifscCode;
      newMethod.bankName = bankDetails.bankName;
      newMethod.accountHolderName = bankDetails.accountHolder;
    } else if (methodType === 'CRYPTO') {
      if (!cryptoDetails || !cryptoDetails.walletAddress || !cryptoDetails.cryptoType) {
        return res.status(400).json({ error: "Crypto details required" });
      }
      newMethod.walletAddress = cryptoDetails.walletAddress;
      newMethod.cryptoType = cryptoDetails.cryptoType;
      newMethod.networkType = cryptoDetails.networkType;
    }

    await newMethod.save();

    // Log audit
    const auditLog = new AuditLog({
      adminId: req.admin.adminId,
      action: 'ADD_DEPOSIT_METHOD',
      details: { methodType, minAmount, maxAmount },
      ipAddress: req.ip
    });
    await auditLog.save();

    res.json({
      success: true,
      message: `${methodType} deposit method added`,
      method: newMethod
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ADMIN: TOGGLE DEPOSIT METHOD
// ============================================
router.post('/admin/toggle-deposit-method', verifyAdminToken, async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin.adminId);
    if (admin.role !== 'MASTER_ADMIN') {
      return res.status(403).json({ error: "Only MASTER_ADMIN can manage methods" });
    }

    const { methodId, isActive } = req.body;

    const method = await DepositMethodConfig.findByIdAndUpdate(
      methodId,
      { isActive, updatedAt: new Date() },
      { new: true }
    );

    if (!method) {
      return res.status(404).json({ error: "Method not found" });
    }

    res.json({
      success: true,
      message: `${method.methodType} ${isActive ? 'enabled' : 'disabled'}`,
      method
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
