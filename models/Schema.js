const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

// User Model
const userSchema = new mongoose.Schema({
  phoneNumber: { type: String, required: true, unique: true },
  password: { type: String, required: true }, // Will be hashed
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

// Hash password before saving
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

// Method to compare passwords
userSchema.methods.comparePassword = async function (plainPassword) {
  return await bcrypt.compare(plainPassword, this.password);
};

// Game Bet Model
const betSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  periodId: { type: String, required: true },
  gameType: { type: String, enum: ['WinGo_30s', 'WinGo_1m', 'WinGo_3m'], default: 'WinGo_30s' },
  selectedOption: { type: String, required: true }, // 'Red', 'Green', 'Violet', '0-9', 'Big', 'Small'
  amount: { type: Number, required: true },
  status: { type: String, enum: ['PENDING', 'WIN', 'LOSS'], default: 'PENDING' },
  winAmount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

// Game Result Model (immutable record)
const gameResultSchema = new mongoose.Schema({
  periodId: { type: String, required: true, unique: true },
  gameType: { type: String, required: true },
  winningNumber: { type: Number, required: true }, // 0-9
  winningColor: { type: String, required: true }, // Red, Green, Violet
  winningSize: { type: String, required: true }, // Big, Small
  isAdminOverride: { type: Boolean, default: false }, // Flag if admin set it
  createdAt: { type: Date, default: Date.now }
});

// Admin Audit Log Model
const auditLogSchema = new mongoose.Schema({
  adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
  action: { type: String, enum: ['SET_RESULT', 'VIEW_PRESET', 'CLEAR_PRESET'], required: true },
  periodId: { type: String },
  forcedNumber: { type: Number },
  timestamp: { type: Date, default: Date.now },
  ipAddress: { type: String }
});

// Admin User Model
const adminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true }, // Will be hashed
  role: { type: String, enum: ['SUPER_ADMIN', 'ADMIN'], default: 'ADMIN' },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

// Hash admin password before saving
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

// Method to compare admin passwords
adminSchema.methods.comparePassword = async function (plainPassword) {
  return await bcrypt.compare(plainPassword, this.password);
};

module.exports = {
  User: mongoose.model('User', userSchema),
  Bet: mongoose.model('Bet', betSchema),
  GameResult: mongoose.model('GameResult', gameResultSchema),
  AuditLog: mongoose.model('AuditLog', auditLogSchema),
  Admin: mongoose.model('Admin', adminSchema)
};
