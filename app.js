const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
require('dotenv').config();

// Import routes
const authRoutes = require('./routes/authRoutes');
const depositRoutes = require('./routes/depositRoutes');
const withdrawalRoutes = require('./routes/withdrawalRoutes');
const adminRoutes = require('./routes/adminRoutes');

// Initialize app and server
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS || "*",
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  },
  transports: ['websocket', 'polling']
});

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Request logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ============================================
// DATABASE CONNECTION
// ============================================
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/suuui-win', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => {
  console.log('✅ MongoDB connected successfully');
})
.catch(err => {
  console.error('❌ MongoDB connection failed:', err);
  process.exit(1);
});

// ============================================
// ROUTES
// ============================================
app.use('/api/auth', authRoutes.router);
app.use('/api/deposits', depositRoutes);
app.use('/api/withdrawals', withdrawalRoutes);
app.use('/api/admin', adminRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// ============================================
// SOCKET.IO - GAME ENGINE
// ============================================
const { Bet, GameResult, User } = require('./models/Schema');

const GAME_CONFIG = {
  'WinGo_30s': 30,
  'WinGo_1m': 60,
  'WinGo_3m': 180,
  'WinGo_5m': 300
};

let gameState = {
  'WinGo_30s': {
    timer: 30,
    currentPeriod: generatePeriodId(),
    gameType: 'WinGo_30s'
  }
};

function generatePeriodId() {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const random = Math.random().toString(36).substr(2, 9);
  return `${timestamp}${random}`;
}

function calculateColorAndSize(number) {
  let color;
  if (number === 0) {
    color = 'Red+Violet';
  } else if (number === 5) {
    color = 'Green+Violet';
  } else {
    color = number % 2 === 0 ? 'Red' : 'Green';
  }
  
  const size = number >= 5 ? 'Big' : 'Small';
  return { color, size };
}

// Game timer loop
setInterval(async () => {
  const game = gameState['WinGo_30s'];
  game.timer--;
  
  if (game.timer === 0) {
    try {
      // 1. Check if admin set a result for this period
      let winningNumber;
      const preset = await GameResult.findOne({ 
        periodId: game.currentPeriod,
        gameType: 'WinGo_30s'
      });

      if (preset) {
        // Admin override found
        winningNumber = preset.winningNumber;
      } else {
        // Generate random number 0-9
        winningNumber = Math.floor(Math.random() * 10);
        
        // Save random result to GameResult for audit trail
        const gameResult = new GameResult({
          periodId: game.currentPeriod,
          gameType: 'WinGo_30s',
          winningNumber,
          winningColor: calculateColorAndSize(winningNumber).color,
          winningSize: calculateColorAndSize(winningNumber).size,
          isAdminOverride: false
        });
        await gameResult.save();
      }

      // 2. Calculate color and size
      const { color: winningColor, size: winningSize } = calculateColorAndSize(winningNumber);

      // 3. Process all pending bets for this period
      const pendingBets = await Bet.find({ 
        periodId: game.currentPeriod, 
        status: 'PENDING',
        gameType: 'WinGo_30s'
      }).populate('userId');

      let totalWinnings = 0;
      let totalBets = pendingBets.length;

      for (let bet of pendingBets) {
        let isWin = false;
        let multiplier = 1;
        let winAmount = 0;

        // Check win conditions
        if (bet.selectedOption === winningColor.split('+')[0]) {
          isWin = true;
          multiplier = 2;
        }
        if (bet.selectedOption === winningSize) {
          isWin = true;
          multiplier = 2;
        }
        if (winningColor.includes('+') && bet.selectedOption === winningColor.split('+')[1]) {
          isWin = true;
          multiplier = 2;
        }
        if (bet.selectedOption === winningNumber.toString()) {
          isWin = true;
          multiplier = 9;
        }

        if (isWin) {
          bet.status = 'WIN';
          winAmount = bet.amount * multiplier;
          bet.winAmount = winAmount;
          
          // Update user wallet
          if (bet.userId) {
            await User.findByIdAndUpdate(
              bet.userId._id,
              { 
                $inc: { 
                  walletBalance: winAmount,
                  totalWagered: bet.amount
                }
              }
            );
            totalWinnings += winAmount;
          }
        } else {
          bet.status = 'LOSS';
          
          // Update wager count even for losses
          if (bet.userId) {
            await User.findByIdAndUpdate(
              bet.userId._id,
              { $inc: { totalWagered: bet.amount } }
            );
          }
        }

        await bet.save();
      }

      // 4. Broadcast results to all connected clients
      io.emit('gameResult', {
        periodId: game.currentPeriod,
        number: winningNumber,
        color: winningColor,
        size: winningSize,
        isAdminOverride: preset ? true : false,
        totalBets,
        totalWinnings
      });

      console.log(`[WinGo_30s] Period ${game.currentPeriod}: ${winningNumber} (${winningColor}/${winningSize})`);

      // 5. Reset for next period
      game.timer = 30;
      game.currentPeriod = generatePeriodId();

    } catch (error) {
      console.error('❌ Game engine error:', error);
    }
  }

  // Broadcast timer update every second
  io.emit('timerTick', { 
    timer: game.timer, 
    periodId: game.currentPeriod,
    gameType: game.gameType
  });
}, 1000);

// Socket.IO connection
io.on('connection', (socket) => {
  console.log(`👤 User connected: ${socket.id}`);

  // Send current game state to new connection
  const game = gameState['WinGo_30s'];
  socket.emit('gameState', {
    timer: game.timer,
    periodId: game.currentPeriod,
    gameType: game.gameType
  });

  socket.on('disconnect', () => {
    console.log(`👤 User disconnected: ${socket.id}`);
  });
});

// ============================================
// ERROR HANDLING
// ============================================
app.use((err, req, res, next) => {
  console.error('❌ Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║   🎮 SUUUI WIN - Gaming Platform 🎮   ║
╚════════════════════════════════════════╝

  🚀 Server running on: http://localhost:${PORT}
  📊 Database: ${process.env.MONGODB_URI || 'mongodb://localhost:27017/suuui-win'}
  🎰 Game Engine: WinGo_30s Active
  🔐 Environment: ${process.env.NODE_ENV || 'development'}
  
  API Endpoints:
  ✓ POST   /api/auth/register         (User Registration)
  ✓ POST   /api/auth/login            (User Login)
  ✓ GET    /api/auth/profile          (Get User Profile)
  
  ✓ POST   /api/deposits/create-deposit-request    (Create Deposit)
  ✓ POST   /api/deposits/submit-deposit-proof      (Submit Proof)
  ✓ GET    /api/deposits/deposit-methods           (List Methods)
  ✓ GET    /api/deposits/deposit-history           (User History)
  
  ✓ POST   /api/withdrawals/create-withdrawal-request  (Request Withdrawal)
  ✓ GET    /api/withdrawals/withdrawal-status         (Check Status)
  ✓ GET    /api/withdrawals/withdrawal-history        (Withdrawal History)
  
  ✓ POST   /api/admin/login               (Admin Login)
  ✓ POST   /api/admin/set-game-result     (Set Game Number)
  ✓ GET    /api/admin/audit-logs          (View Logs)
  
  🔗 WebSocket Events:
  ✓ timerTick    (Real-time timer)
  ✓ gameResult   (Game results)
  ✓ gameState    (Current state)

════════════════════════════════════════════════════════════════
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('📢 SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('✅ HTTP server closed');
    mongoose.connection.close(false, () => {
      console.log('✅ MongoDB connection closed');
      process.exit(0);
    });
  });
});

module.exports = { app, io, server };
