# 🎮 SUUUI WIN - Secure Gaming Platform

A full-featured gambling platform built with **Node.js**, **Express**, **MongoDB**, and **Socket.io** with admin controls for game result overrides and comprehensive security measures.

---

## 📋 Table of Contents

- [Features](#features)
- [Security Implementation](#security-implementation)
- [Installation](#installation)
- [Environment Setup](#environment-setup)
- [API Endpoints](#api-endpoints)
- [Admin Features](#admin-features)
- [Game Engine](#game-engine)
- [Database Models](#database-models)

---

## ✨ Features

### 🎯 Game Features
- **WinGo Games**: 30s, 1m, 3m, 5m variants
- **Multiple Bet Types**: Colors (Red/Green/Violet), Numbers (0-9), Size (Big/Small)
- **Real-time Updates**: Socket.io for live timer and results
- **Dynamic Odds**: Direct number bets pay 9x, color/size bets pay 2x

### 💰 Wallet Features
- **Deposits**: Multiple payment methods (UPI, Bank, USDT)
- **Withdrawals**: Daily limits (max 3), method-specific amount ranges
- **Wagering Requirements**: Must wager deposited amount before withdrawal
- **Transaction History**: Complete audit trail of all transactions

### 🔐 Security Features
- **Password Hashing**: bcrypt with salt rounds (10)
- **JWT Authentication**: 30-day tokens for users, 8-hour tokens for admins
- **Role-Based Access**: SUPER_ADMIN vs ADMIN roles
- **Audit Logging**: All admin actions tracked with IP address and timestamp
- **Input Validation**: Comprehensive validation on all endpoints
- **Account Banning**: Restrict fraudulent users

### 👨‍💼 Admin Features
- **Secure Login**: JWT-protected admin panel
- **Game Result Override**: SUPER_ADMIN can preset winning numbers for any period
- **Audit Logs**: View all admin actions with timestamps
- **User Management**: Ban/unban accounts, create new admins
- **Results History**: Complete record of all game results and overrides

---

## 🔒 Security Implementation

### Password Security
```javascript
// bcrypt hashing with 10 salt rounds
bcrypt.hash(password, 10)
await bcrypt.compare(plainPassword, hashedPassword)
```

### JWT Tokens
- **User tokens**: 30-day expiration
- **Admin tokens**: 8-hour expiration
- **Payload**: userId/adminId + role information
- **Secret**: Environment variable (change in production!)

### Admin Verification
```
POST /api/admin/login
- Username + Password → JWT Token
- Token required for all admin operations
- Only SUPER_ADMIN can override game results
```

### Audit Trail
```
AuditLog Model tracks:
- Admin ID
- Action (SET_RESULT, VIEW_PRESET, etc.)
- Period ID & forced number
- IP Address
- Timestamp
```

---

## 📦 Installation

### Prerequisites
- Node.js v14+
- MongoDB v4.4+
- npm or yarn

### Setup Steps

```bash
# 1. Clone the repository
git clone https://github.com/sushentikadar29-lab/suuui-win.git
cd suuui-win

# 2. Install dependencies
npm install

# 3. Install required packages
npm install express http socket.io mongoose bcrypt jsonwebtoken dotenv

# 4. Create .env file
cp .env.example .env

# 5. Start the server
npm start
```

---

## 🔑 Environment Setup

Create a `.env` file in the project root:

```env
# Server
PORT=5000
NODE_ENV=development

# Database
MONGODB_URI=mongodb://localhost:27017/suuui-win

# JWT Secrets (Change these in production!)
JWT_SECRET=your-super-secret-jwt-key-change-this
ADMIN_JWT_SECRET=your-admin-secret-key-change-this

# CORS
ALLOWED_ORIGINS=http://localhost:3000,https://yourdomain.com

# Payment (if integrating payment gateways)
PAYMENT_API_KEY=your_payment_api_key
PAYMENT_SECRET=your_payment_secret
```

---

## 🌐 API Endpoints

### Authentication Routes (`/api/auth`)

#### Register User
```
POST /api/auth/register
Body: {
  "phoneNumber": "+919876543210",
  "password": "securePassword",
  "confirmPassword": "securePassword",
  "inviteCode": "OPTIONAL_INVITE_CODE"
}
Response: { token, user: { userId, phoneNumber, inviteCode } }
```

#### Login User
```
POST /api/auth/login
Body: {
  "phoneNumber": "+919876543210",
  "password": "securePassword"
}
Response: { token, user: { userId, walletBalance, inviteCode } }
```

#### Get Profile
```
GET /api/auth/profile
Headers: Authorization: Bearer <token>
Response: { user: { phoneNumber, walletBalance, totalDeposited, ... } }
```

#### Change Password
```
POST /api/auth/change-password
Headers: Authorization: Bearer <token>
Body: {
  "currentPassword": "oldPassword",
  "newPassword": "newPassword",
  "confirmPassword": "newPassword"
}
```

### Wallet Routes (`/api/wallet`)

#### Place Bet
```
POST /api/bets/place
Body: {
  "userId": "user_id",
  "selectedOption": "Red",  // or "Green", "Violet", "0-9", "Big", "Small"
  "amount": 100,
  "gameType": "WinGo_30s"
}
Response: { success: true, bet: { betId, periodId, amount } }
```

#### Deposit
```
POST /api/wallet/deposit
Body: {
  "userId": "user_id",
  "amount": 500,
  "transactionId": "TXN123456"
}
Response: { success: true, deposit: { amount, newBalance } }
```

#### Withdraw
```
POST /api/wallet/withdraw
Headers: Authorization: Bearer <token>
Body: {
  "userId": "user_id",
  "amount": 500,
  "method": "UPI",  // or "BANK", "USDT"
  "bankDetails": {
    "accountNumber": "1234567890",
    "ifscCode": "AXIS0001234",
    "accountHolder": "John Doe"
  }
}
Response: { success: true, withdrawal: { amount, status: "PENDING" } }
```

#### Get Withdrawal Status
```
GET /api/wallet/withdrawal-status/:userId
Response: {
  walletBalance, totalDeposited, totalWagered,
  wageringComplete: true/false,
  dailyWithdrawals: { used, remaining, resetsAt }
}
```

#### Get Withdrawal History
```
GET /api/wallet/withdrawal-history/:userId?limit=20
Response: { withdrawals: [...], totalWithdrawn }
```

#### Get User Bets
```
GET /api/bets/:userId?limit=50
Response: {
  bets: [...],
  stats: { totalBets, totalWins, totalWagered, totalWinnings }
}
```

#### Get Game Results
```
GET /api/results/:gameType?limit=20
Response: {
  gameType: "WinGo_30s",
  results: [{ periodId, winningNumber, winningColor, isAdminOverride }]
}
```

---

## 👨‍💼 Admin Features

### Admin Authentication

#### Admin Login
```
POST /api/admin/login
Body: {
  "username": "admin_username",
  "password": "admin_password"
}
Response: { token, admin: { username, role } }
```

### Set Game Result

#### Override Next Game Number (SUPER_ADMIN only)
```
POST /api/admin/set-game-result
Headers: Authorization: Bearer <admin_token>
Body: {
  "periodId": "20260727100030167",
  "forcedNumber": 7,  // 0-9
  "gameType": "WinGo_30s"
}
Response: {
  success: true,
  message: "Period result set to 7 (Green / Big)",
  result: { periodId, winningNumber, winningColor, winningSize }
}
```

#### View Next Preset
```
GET /api/admin/next-preset?gameType=WinGo_30s
Headers: Authorization: Bearer <admin_token>
Response: {
  preset: { periodId, winningNumber, gameType }
}
```

#### View Audit Logs
```
GET /api/admin/audit-logs?limit=50&skip=0
Headers: Authorization: Bearer <admin_token>
Response: {
  logs: [{ adminId, action, periodId, timestamp, ipAddress }],
  pagination: { total, limit, skip }
}
```

#### Create New Admin
```
POST /api/admin/create-admin
Headers: Authorization: Bearer <super_admin_token>
Body: {
  "username": "new_admin",
  "password": "secure_password",
  "role": "ADMIN"  // or "SUPER_ADMIN"
}
```

#### Disable Admin Account
```
POST /api/admin/disable-admin/:adminId
Headers: Authorization: Bearer <super_admin_token>
Response: { success: true, message: "Admin disabled" }
```

---

## 🎮 Game Engine

### How It Works

1. **Timer Loop**: Every second, broadcasts timer countdown
2. **Period Generation**: New period ID generated every 30 seconds
3. **Admin Override Check**: Looks for preset result in GameResult collection
4. **Random Generation**: If no preset, generates random 0-9
5. **Bet Processing**: All PENDING bets processed and marked WIN/LOSS
6. **Result Broadcast**: Emits result to all connected clients
7. **Wallet Update**: Winner wallets updated immediately

### Socket Events

```javascript
// Client listens to:
socket.on('timerTick', (data) => {
  console.log(`Time remaining: ${data.timer}s, Period: ${data.periodId}`);
});

socket.on('gameResult', (data) => {
  console.log(`Result: ${data.number} (${data.color}/${data.size})`);
  console.log(`Admin override: ${data.isAdminOverride}`);
});

socket.on('gameState', (data) => {
  console.log(`Current state: Timer=${data.timer}, Period=${data.periodId}`);
});
```

---

## 📊 Database Models

### User Model
```javascript
{
  phoneNumber: String (unique),
  password: String (hashed),
  walletBalance: Number,
  totalDeposited: Number,
  totalWagered: Number,
  todayWithdrawalCount: Number,
  lastWithdrawalDate: Date,
  inviteCode: String (unique),
  referredBy: String,
  isBanned: Boolean,
  vipLevel: Number,
  createdAt: Date
}
```

### Bet Model
```javascript
{
  userId: ObjectId (ref: User),
  periodId: String,
  gameType: String (enum: ['WinGo_30s', 'WinGo_1m', 'WinGo_3m', 'WinGo_5m']),
  selectedOption: String,
  amount: Number,
  status: String (enum: ['PENDING', 'WIN', 'LOSS']),
  winAmount: Number,
  createdAt: Date
}
```

### GameResult Model
```javascript
{
  periodId: String (unique),
  gameType: String,
  winningNumber: Number (0-9),
  winningColor: String,
  winningSize: String,
  isAdminOverride: Boolean,
  createdAt: Date
}
```

### AuditLog Model
```javascript
{
  adminId: ObjectId (ref: Admin),
  action: String (enum: ['SET_RESULT', 'VIEW_PRESET', 'CLEAR_PRESET']),
  periodId: String,
  forcedNumber: Number,
  timestamp: Date,
  ipAddress: String
}
```

### Admin Model
```javascript
{
  username: String (unique),
  password: String (hashed),
  role: String (enum: ['SUPER_ADMIN', 'ADMIN']),
  isActive: Boolean,
  createdAt: Date
}
```

---

## 🚀 Deployment

### Production Checklist

- [ ] Change JWT_SECRET in .env
- [ ] Enable HTTPS
- [ ] Set NODE_ENV=production
- [ ] Configure CORS with specific domains
- [ ] Enable MongoDB authentication
- [ ] Set up SSL certificates
- [ ] Configure rate limiting
- [ ] Enable logging/monitoring
- [ ] Set up backup strategy
- [ ] Test all payment integrations

### Docker Deployment

```dockerfile
FROM node:16
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 5000
CMD ["npm", "start"]
```

---

## 📝 License

This project is proprietary and confidential.

---

## 🆘 Support

For issues or questions, contact: support@suuuiwin.com

---

## ⚠️ Disclaimer

**This platform is for demonstration purposes only.** Gambling operations require proper licensing in your jurisdiction. Ensure compliance with local laws and regulations before deployment.

