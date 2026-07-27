const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

// ============================================
// USER MODEL
// ============================================
const userSchema = new mongoose.Schema({
  phoneNumber: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  walletBalance: { type: Number, default: 0 },
  totalDeposited: { type: Number, default: 0 },
  totalWagered: { type: Number, default: 0 },
  todayWithdrawalCount: { type: Number, default: 0 },
  lastWithdrawalDate: { type: Date },
  inviteCode: { type: String, unique: true },
  referredBy: { type: String, default: null },
  isBanned: { type: Boolean, default: false },
  vipLevel: { type: Number, default: 1 },
  createdAt: { type: Date, default: Date.now }
});

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

userSchema.methods.comparePassword = async function (plainPassword) {
  return await bcrypt.compare(plainPassword, this.password);
};

// ============================================
// DEPOSIT REQUEST MODEL
// ============================================
const depositRequestSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  depositMethod: { type: String, enum: ['UPI', 'BANK_TRANSFER', 'CRYPTO'], required: true },
  amount: { type: Number, required: true },
  
  // UPI Details
  upiId: { type: String }, // Admin's UPI ID to receive payment
  upiOrderNumber: { type: String }, // Auto-generated order number
  
  // Bank Transfer Details
  bankAccountNumber: { type: String },
  ifscCode: { type: String },
  bankName: { type: String },
  accountHolderName: { type: String },
  
  // Crypto Details
  walletAddress: { type: String },
  cryptoType: { type: String, enum: ['USDT', 'BTC', 'ETH'] },
  
  // User Proof of Payment
  utrNumber: { type: String }, // UTR for bank transfer
  transactionId: { type: String }, // For UPI
  cryptoTxHash: { type: String }, // For crypto
  proofScreenshot: { type: String }, // URL to uploaded screenshot
  
  // Status
  status: { type: String, enum: ['PENDING', 'VERIFIED', 'REJECTED', 'COMPLETED'], default: 'PENDING' },
  verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  verificationNotes: { type: String },
  
  // Timestamps
  createdAt: { type: Date, default: Date.now },
  verifiedAt: { type: Date },
  completedAt: { type: Date }
});

// ============================================
// BET MODEL
// ============================================
const betSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  periodId: { type: String, required: true },
  gameType: { type: String, enum: ['WinGo_30s', 'WinGo_1m', 'WinGo_3m', 'WinGo_5m', 'K3'], default: 'WinGo_30s' },
  selectedOption: { type: String, required: true },
  amount: { type: Number, required: true },
  status: { type: String, enum: ['PENDING', 'WIN', 'LOSS'], default: 'PENDING' },
  winAmount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

// ============================================
// GAME RESULT MODEL
// ============================================
const gameResultSchema = new mongoose.Schema({
  periodId: { type: String, required: true, unique: true },
  gameType: { type: String, required: true },
  winningNumber: { type: Number, required: true },
  winningColor: { type: String, required: true },
  winningSize: { type: String, required: true },
  isAdminOverride: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

// ============================================
// WITHDRAWAL REQUEST MODEL
// ============================================
const withdrawalRequestSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  withdrawalMethod: { type: String, enum: ['UPI', 'BANK_TRANSFER', 'CRYPTO'], required: true },
  amount: { type: Number, required: true },
  
  // UPI Details
  upiId: { type: String },
  
  // Bank Transfer Details
  bankAccountNumber: { type: String },
  ifscCode: { type: String },
  bankName: { type: String },
  accountHolderName: { type: String },
  
  // Crypto Details
  walletAddress: { type: String },
  cryptoType: { type: String, enum: ['USDT', 'BTC', 'ETH'] },
  
  status: { type: String, enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'REJECTED'], default: 'PENDING' },
  processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  txHash: { type: String },
  rejectionReason: { type: String },
  
  createdAt: { type: Date, default: Date.now },
  processedAt: { type: Date },
  completedAt: { type: Date }
});

// ============================================
// ADMIN MODEL
// ============================================
const adminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  role: { type: String, enum: ['MASTER_ADMIN', 'ADMIN'], default: 'ADMIN' },
  isActive: { type: Boolean, default: true },
  permissions: {
    canSetGameResults: { type: Boolean, default: false },
    canVerifyDeposits: { type: Boolean, default: false },
    canProcessWithdrawals: { type: Boolean, default: false },
    canManageAdmins: { type: Boolean, default: false },
    canManageGames: { type: Boolean, default: false },
    canAddDepositMethods: { type: Boolean, default: false }
  },
  createdAt: { type: Date, default: Date.now }
});

adminSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

adminSchema.methods.comparePassword = async function (plainPassword) {
  return await bcrypt.compare(plainPassword, this.password);
};

// ============================================
// ADMIN DEPOSIT METHOD CONFIGURATION
// ============================================
const depositMethodConfigSchema = new mongoose.Schema({
  methodType: { type: String, enum: ['UPI', 'BANK_TRANSFER', 'CRYPTO'], required: true },
  isActive: { type: Boolean, default: true },
  
  // UPI Configuration
  upiId: { type: String },
  upiQRCode: { type: String },
  
  // Bank Transfer Configuration
  bankAccountNumber: { type: String },
  ifscCode: { type: String },
  bankName: { type: String },
  accountHolderName: { type: String },
  
  // Crypto Configuration
  walletAddress: { type: String },
  cryptoType: { type: String, enum: ['USDT', 'BTC', 'ETH'] },
  networkType: { type: String },
  
  minAmount: { type: Number, default: 10 },
  maxAmount: { type: Number, default: 100000 },
  bonus: { type: Number, default: 0 },
  
  addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// ============================================
// AUDIT LOG MODEL
// ============================================
const auditLogSchema = new mongoose.Schema({
  adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
  action: { type: String, required: true },
  details: { type: mongoose.Schema.Types.Mixed },
  ipAddress: { type: String },
  userAgent: { type: String },
  timestamp: { type: Date, default: Date.now }
});

// ============================================
// AI GAME CONFIG MODEL (For Master Admin to create custom games)
// ============================================
const aiGameConfigSchema = new mongoose.Schema({
  gameName: { type: String, required: true },
  gameType: { type: String, required: true },
  description: { type: String },
  
  gameRules: { type: mongoose.Schema.Types.Mixed },
  betOptions: [String],
  odds: { type: mongoose.Schema.Types.Mixed },
  
  timerDuration: { type: Number, default: 30 },
  minBet: { type: Number, default: 10 },
  maxBet: { type: Number, default: 100000 },
  
  status: { type: String, enum: ['DRAFT', 'ACTIVE', 'PAUSED', 'DISABLED'], default: 'DRAFT' },
  
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date }
});

// ============================================
// MODELS EXPORT
// ============================================
module.exports = {
  User: mongoose.model('User', userSchema),
  Bet: mongoose.model('Bet', betSchema),
  GameResult: mongoose.model('GameResult', gameResultSchema),
  DepositRequest: mongoose.model('DepositRequest', depositRequestSchema),
  WithdrawalRequest: mongoose.model('WithdrawalRequest', withdrawalRequestSchema),
  Admin: mongoose.model('Admin', adminSchema),
  DepositMethodConfig: mongoose.model('DepositMethodConfig', depositMethodConfigSchema),
  AuditLog: mongoose.model('AuditLog', auditLogSchema),
  AIGameConfig: mongoose.model('AIGameConfig', aiGameConfigSchema)
};
