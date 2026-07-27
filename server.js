const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const { User, Bet, GameResult } = require('./models/Schema');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
  cors: { origin: process.env.ALLOWED_ORIGINS || "*" },
  transports: ['websocket', 'polling']
});

app.use(express.json());

// ============================================
// GAME ENGINE CONFIGURATION
// ============================================
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

// ============================================
// HELPER FUNCTIONS
// ============================================
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

// ============================================
// GAME TIMER LOOP
// ============================================
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
        totalBets: pendingBets.length,
        totalWinnings
      });

      console.log(`[WinGo_30s] Period ${game.currentPeriod}: ${winningNumber} (${winningColor}/${winningSize})`);

      // 5. Reset for next period
      game.timer = 30;
      game.currentPeriod = generatePeriodId();

    } catch (error) {
      console.error('Game engine error:', error);
    }
  }

  // Broadcast timer update every second
  io.emit('timerTick', { 
    timer: game.timer, 
    periodId: game.currentPeriod,
    gameType: game.gameType
  });
}, 1000);

// ============================================
// SOCKET.IO EVENTS
// ============================================
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Send current game state to new connection
  const game = gameState['WinGo_30s'];
  socket.emit('gameState', {
    timer: game.timer,
    periodId: game.currentPeriod,
    gameType: game.gameType
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
  });
});

// ============================================
// REST API: Place Bet
// ============================================
app.post('/api/bets/place', async (req, res) => {
  try {
    const { userId, selectedOption, amount, gameType } = req.body;

    // Validation
    if (!userId || !selectedOption || !amount || !gameType) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (amount < 10) {
      return res.status(400).json({ error: "Minimum bet amount is ₹10" });
    }

    // Get current period
    const game = gameState[gameType] || gameState['WinGo_30s'];
    if (!game) {
      return res.status(400).json({ error: "Invalid game type" });
    }

    // Check user exists and has balance
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.walletBalance < amount) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    if (user.isBanned) {
      return res.status(403).json({ error: "Your account has been restricted" });
    }

    // Deduct amount immediately
    user.walletBalance -= amount;
    await user.save();

    // Create bet record
    const bet = new Bet({
      userId,
      periodId: game.currentPeriod,
      gameType,
      selectedOption,
      amount,
      status: 'PENDING'
    });

    await bet.save();

    res.json({
      success: true,
      message: "Bet placed successfully",
      bet: {
        betId: bet._id,
        periodId: bet.periodId,
        amount: bet.amount,
        selectedOption: bet.selectedOption
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// REST API: Get Game Results
// ============================================
app.get('/api/results/:gameType', async (req, res) => {
  try {
    const { gameType } = req.params;
    const limit = parseInt(req.query.limit) || 20;

    const results = await GameResult.find({ gameType })
      .sort({ createdAt: -1 })
      .limit(limit);

    res.json({
      gameType,
      results
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// REST API: Get User Bets
// ============================================
app.get('/api/bets/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit) || 50;

    const bets = await Bet.find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit);

    const stats = {
      totalBets: bets.length,
      totalWins: bets.filter(b => b.status === 'WIN').length,
      totalLosses: bets.filter(b => b.status === 'LOSS').length,
      totalWagered: bets.reduce((sum, b) => sum + b.amount, 0),
      totalWinnings: bets.filter(b => b.status === 'WIN').reduce((sum, b) => sum + b.winAmount, 0)
    };

    res.json({
      bets,
      stats
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🎮 SUUUI WIN Server running on port ${PORT}`);
  console.log(`📊 Game Engine: WinGo_30s initialized`);
  console.log(`🔐 Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = { app, io, server };
