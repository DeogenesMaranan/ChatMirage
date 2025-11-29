const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

function createServer() {
  const app = express();
  const server = http.createServer(app);

  const io = new Server(server, {
  });

  app.use(express.static('public'));

  app.get('/api/guess-stats', (req, res) => {
    try {
      const dataPath = path.join(__dirname, '..', 'data', 'guesses.json');
      if (!fs.existsSync(dataPath)) return res.json({ total: 0, TP: 0, FP: 0, FN: 0, TN: 0 });
      const raw = fs.readFileSync(dataPath, 'utf8');
      const arr = JSON.parse(raw || '[]');
      let TP = 0, FP = 0, FN = 0, TN = 0;
      arr.forEach(r => {
        const guessedAI = !!r.guessedAI;
        const actualIsAI = !!r.actualIsAI;
        if (guessedAI && actualIsAI) TP += 1;
        else if (guessedAI && !actualIsAI) FP += 1;
        else if (!guessedAI && actualIsAI) FN += 1;
        else TN += 1;
      });
      const total = TP + FP + FN + TN;
      res.json({ total, TP, FP, FN, TN });
    } catch (e) {
      console.error('Failed to read guess stats', e);
      res.status(500).json({ error: 'failed' });
    }
  });

  return { app, server, io };
}

module.exports = { createServer };
