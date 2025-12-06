const { aiRespond } = require('./ai');

const { randomBytes } = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const GUESSES_FILE = path.join(DATA_DIR, 'guesses.json');
let guessStore = [];

function ensureDataDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {
    console.error('Failed to ensure data directory', e);
  }
}

function loadGuessStore() {
  try {
    ensureDataDir();
    if (fs.existsSync(GUESSES_FILE)) {
      const raw = fs.readFileSync(GUESSES_FILE, 'utf8');
      guessStore = JSON.parse(raw || '[]');
    } else {
      guessStore = [];
      fs.writeFileSync(GUESSES_FILE, JSON.stringify(guessStore, null, 2));
    }
  } catch (e) {
    console.error('Failed to load guess store', e);
    guessStore = [];
  }
}

function persistGuessRecord(record) {
  try {
    guessStore.push(record);
    // write asynchronously but don't await to avoid delaying socket handler
    fs.writeFile(GUESSES_FILE, JSON.stringify(guessStore, null, 2), (err) => {
      if (err) console.error('Failed to persist guess record', err);
    });
  } catch (e) {
    console.error('Failed to persist guess record', e);
  }
}

function clearTypingIndicatorState(socketId) {
  const state = typingIndicatorState.get(socketId);
  if (!state) return;
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  typingIndicatorState.delete(socketId);
}

function clearWaitingTimeout(socketId) {
  const timer = waitingTimeouts.get(socketId);
  if (!timer) return;
  clearTimeout(timer);
  waitingTimeouts.delete(socketId);
}

function startWaitingTimeout(socket, io) {
  if (!socket || !socket.id) return;
  clearWaitingTimeout(socket.id);
  const timer = setTimeout(() => {
    waitingTimeouts.delete(socket.id);
    const idx = waitingQueue.findIndex((entry) => entry && entry.socket && entry.socket.id === socket.id);
    if (idx !== -1) waitingQueue.splice(idx, 1);
    if (!socket.connected) return;
    pairWithAI(socket, io);
  }, WAITING_TIMEOUT_MS);
  waitingTimeouts.set(socket.id, timer);
}

function emitChatEndedWithReveal(socket, sess, reason) {
  if (!socket) return;
  const partnerType = sess && sess.partnerIsAI ? 'ai' : 'human';
  const partnerLabel = partnerType === 'ai' ? 'AI' : 'Human';
  socket.emit('chat_ended', {
    reason,
    partnerType,
    message: `Chat ended. Your partner was ${partnerLabel}.`
  });
}

const DEFAULT_HUMAN_MESSAGE_THRESHOLD = 5;
const DEFAULT_MESSAGE_THRESHOLD = 10;
const DEFAULT_TYPING_INDICATOR_DELAY_MS = 500;
const DEFAULT_WAITING_TIMEOUT_MS = 30000;

const HUMAN_MESSAGE_THRESHOLD = (() => {
  const v = parseInt(process.env.HUMAN_MESSAGE_THRESHOLD, 10);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_HUMAN_MESSAGE_THRESHOLD;
})();

const MESSAGE_THRESHOLD = (() => {
  const v = parseInt(process.env.MESSAGE_THRESHOLD, 10);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_MESSAGE_THRESHOLD;
})();

const TYPING_INDICATOR_DELAY_MS = (() => {
  const v = parseInt(process.env.TYPING_INDICATOR_DELAY_MS, 10);
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_TYPING_INDICATOR_DELAY_MS;
})();

const WAITING_TIMEOUT_MS = (() => {
  const v = parseInt(process.env.WAITING_TIMEOUT_MS, 10);
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_WAITING_TIMEOUT_MS;
})();

const sessions = new Map();
const waitingQueue = [];
const socketToSession = new Map();
const typingIndicatorState = new Map();
const waitingTimeouts = new Map();

function makeSessionId() {
  return 's_' + randomBytes(6).toString('hex');
}

function init(io) {
  io.on('connection', (socket) => {
    // lazy load guess store once on first connection
    if (guessStore.length === 0) loadGuessStore();
    const auth = socket.handshake && socket.handshake.auth ? socket.handshake.auth : {};
    const userId = auth.userId || ('u_' + socket.id);
    const forced = auth.forcePartner || null;

    socket.userId = userId;

    socket.on('disconnect', () => {
      for (let i = 0; i < waitingQueue.length; i++) {
        if (waitingQueue[i].socket.id === socket.id) {
          waitingQueue.splice(i, 1);
          clearWaitingTimeout(socket.id);
          break;
        }
      }

      const sid = socketToSession.get(socket.id);
      if (sid) {
        const sess = sessions.get(sid);
        if (sess) {
          if (sess.humanSockets) {
            sess.humanSockets.forEach((s) => {
              if (s.id !== socket.id) {
                s.emit('partner_disconnected', {
                  message: 'Partner disconnected',
                  partnerType: sess && sess.partnerIsAI ? 'ai' : 'human'
                });
                emitChatEndedWithReveal(s, sess, 'partner_disconnected');
                socketToSession.delete(s.id);
                clearTypingIndicatorState(s.id);
              }
            });
          }
          sessions.delete(sid);
        }
        socketToSession.delete(socket.id);
        clearTypingIndicatorState(socket.id);
      } else {
        clearTypingIndicatorState(socket.id);
      }
    });

    socket.on('skip_partner', () => {
      const sid = socketToSession.get(socket.id);
      if (sid) {
        const sess = sessions.get(sid);
        if (sess) {
          if (sess.humanSockets) {
            sess.humanSockets.forEach((s) => {
              if (s.id !== socket.id) {
                s.emit('partner_disconnected', {
                  message: 'Partner skipped',
                  partnerType: sess && sess.partnerIsAI ? 'ai' : 'human'
                });
                emitChatEndedWithReveal(s, sess, 'skipped');
                socketToSession.delete(s.id);
                clearTypingIndicatorState(s.id);
              }
            });
          }
          sessions.delete(sid);
        }
        socketToSession.delete(socket.id);
        clearTypingIndicatorState(socket.id);
        clearWaitingTimeout(socket.id);
      } else {
        clearTypingIndicatorState(socket.id);
        clearWaitingTimeout(socket.id);
      }

      pairForSocket(socket, forced, io);
    });

    socket.on('request_history', (data) => {
      const sid = data && data.sessionId ? data.sessionId : socketToSession.get(socket.id);
      if (!sid) return;
      const sess = sessions.get(sid);
      if (!sess) return;
      socket.emit('chat_history', { chatHistory: sess.chatHistory });
    });

    socket.on('send_message', async (data) => {
      const sid = data && data.sessionId ? data.sessionId : socketToSession.get(socket.id);
      if (!sid) return;
      const text = (data && data.text) ? String(data.text) : '';
      if (!text) return;
      const sess = sessions.get(sid);
      if (!sess) return;

      const msg = { userId: socket.userId, from: 'human', text };
      sess.chatHistory.push(msg);

      if (sess.partnerIsAI) {
        socket.emit('chat_message', { from: 'me', text });
        socket.emit('chat_history_update', { chatHistory: sess.chatHistory });

        sess.aiQueue = sess.aiQueue || Promise.resolve();
        sess.aiQueue = sess.aiQueue.then(async () => {
          try {
            socket.emit('partner_typing', { userId: 'ai' });

            const aiText = await aiRespond(sess.chatHistory.slice());

            const PER_CHAR_MS = 25;
            const MIN_TYPING_MS = 600;
            const MAX_TYPING_MS = 4000;
            const typingMs = Math.min(Math.max(Math.floor(aiText.length * PER_CHAR_MS), MIN_TYPING_MS), MAX_TYPING_MS);

            await new Promise((r) => setTimeout(r, typingMs));

            const aiMsg = { from: 'ai', text: aiText };
            sess.chatHistory.push(aiMsg);

            socket.emit('partner_stop_typing', { userId: 'ai' });
            socket.emit('chat_message', { from: 'partner', text: aiText });
          } catch (err) {
            console.error('AI response failed', err);
            try {
              socket.emit('partner_stop_typing', { userId: 'ai' });
            } catch (e) {}
          }
        });
      } else {
        sess.humanSockets.forEach((s) => {
          if (s.id === socket.id) {
            s.emit('chat_message', { from: 'me', text });
          } else {
            s.emit('chat_message', { from: 'partner', text });
          }
        });
      }

      if (!sess.prompted) {
        const chatHistory = sess.chatHistory || [];
        const humanCount = chatHistory.filter(m => m && m.from === 'human').length;
        const totalCount = chatHistory.length;

        const numHumanParticipants = (sess.humanSockets && sess.humanSockets.length) ? sess.humanSockets.length : 1;

        const reachedHumanThreshold = humanCount >= (HUMAN_MESSAGE_THRESHOLD * numHumanParticipants);

        const reachedTotalThreshold = totalCount >= MESSAGE_THRESHOLD && (totalCount % MESSAGE_THRESHOLD) === 0;

        if (reachedHumanThreshold || reachedTotalThreshold) {
          sess.prompted = true;
          const prompt = 'After these messages, guess whether your partner is Human or AI.';
          sess.humanSockets.forEach((s) => s.emit('turing_prompt', { prompt }));
        }
      }
    });

    socket.on('typing', (data) => {
      const sid = data && data.sessionId ? data.sessionId : socketToSession.get(socket.id);
      if (!sid) return;
      const sess = sessions.get(sid);
      if (!sess) return;

      if (sess.partnerIsAI || !Array.isArray(sess.humanSockets)) return;

      const existingState = typingIndicatorState.get(socket.id) || { timer: null, emitted: false };
      if (existingState.emitted) return;

      if (existingState.timer) {
        clearTimeout(existingState.timer);
      }

      existingState.timer = setTimeout(() => {
        const state = typingIndicatorState.get(socket.id);
        if (!state) return;
        state.timer = null;

        const currentSid = socketToSession.get(socket.id);
        if (!currentSid) {
          typingIndicatorState.delete(socket.id);
          return;
        }
        const currentSess = sessions.get(currentSid);
        if (!currentSess || currentSess.partnerIsAI || !Array.isArray(currentSess.humanSockets)) {
          typingIndicatorState.delete(socket.id);
          return;
        }

        state.emitted = true;
        typingIndicatorState.set(socket.id, state);

        currentSess.humanSockets.forEach((s) => {
          if (s.id !== socket.id) {
            s.emit('partner_typing', { userId: socket.userId });
          }
        });
      }, TYPING_INDICATOR_DELAY_MS);

      typingIndicatorState.set(socket.id, existingState);
    });

    socket.on('stop_typing', (data) => {
      const sid = data && data.sessionId ? data.sessionId : socketToSession.get(socket.id);
      if (!sid) return;
      const sess = sessions.get(sid);
      if (!sess) return;
      if (sess.partnerIsAI) return;
      if (!Array.isArray(sess.humanSockets)) return;

      const state = typingIndicatorState.get(socket.id);
      if (state) {
        if (state.timer) {
          clearTimeout(state.timer);
          state.timer = null;
        }

        if (state.emitted) {
          state.emitted = false;
          sess.humanSockets.forEach((s) => {
            if (s.id !== socket.id) {
              s.emit('partner_stop_typing', { userId: socket.userId });
            }
          });
        }

        typingIndicatorState.delete(socket.id);
        return;
      }

      // Fallback to previous behavior if state is missing
      sess.humanSockets.forEach((s) => {
        if (s.id !== socket.id) {
          s.emit('partner_stop_typing', { userId: socket.userId });
        }
      });
    });

    socket.on('submit_guess', (data) => {
      const sid = data && data.sessionId ? data.sessionId : socketToSession.get(socket.id);
      if (!sid) return;
      const guess = data && data.guess ? String(data.guess).toLowerCase() : '';
      const sess = sessions.get(sid);
      if (!sess) return;
      const actualIsAI = !!sess.partnerIsAI;
      const guessedAI = guess === 'ai' || guess === 'a.i.' || guess === 'a i';
      const correct = (guessedAI && actualIsAI) || (!guessedAI && !actualIsAI);

      // Record the guess in guessHistory and update confusion matrix
      sess.guessHistory = sess.guessHistory || [];
      const guessRecord = { ts: Date.now(), socketId: socket.id, guessedAI: !!guessedAI, actualIsAI: !!actualIsAI, correct: !!correct };
      sess.guessHistory.push(guessRecord);

      // Ensure confusion object exists
      sess.confusion = sess.confusion || { TP: 0, FP: 0, FN: 0, TN: 0 };
      if (guessedAI && actualIsAI) sess.confusion.TP += 1;
      else if (guessedAI && !actualIsAI) sess.confusion.FP += 1;
      else if (!guessedAI && actualIsAI) sess.confusion.FN += 1;
      else sess.confusion.TN += 1;

      // Store pending guess (still defer revealing correctness until user chooses end)
      sess.pendingGuess = { socketId: socket.id, correct, guessedAI };

      // Emit updated stats to participants (helps debug / UI display)
      try { sess.humanSockets.forEach(s => s.emit('guess_stats', { confusion: sess.confusion })); } catch (e) {}
      // Persist guess record to JSON store (non-blocking write)
      try { persistGuessRecord(Object.assign({ sessionId: sid }, guessRecord)); } catch (e) { console.error('persist failed', e); }

      socket.emit('post_guess_options', { message: 'Would you like to continue chatting or end the chat? Choose Continue to keep chatting or End Chat to finish.' });
    });

    socket.on('submit_continue_choice', (data) => {
      const sid = data && data.sessionId ? data.sessionId : socketToSession.get(socket.id);
      if (!sid) return;
      const choice = data && data.choice ? String(data.choice).toLowerCase() : '';
      const sess = sessions.get(sid);
      if (!sess) return;
      if (choice === 'end') {
        if (sess.pendingGuess && sess.pendingGuess.socketId) {
          const guessSocketId = sess.pendingGuess.socketId;
          const targetSocket = sess.humanSockets.find(s => s.id === guessSocketId);
          if (targetSocket) {
            targetSocket.emit('guess_result', { correct: !!sess.pendingGuess.correct });
          }
        }

        sess.humanSockets.forEach((s) => {
          emitChatEndedWithReveal(s, sess, 'ended_by_user');
          socketToSession.delete(s.id);
          clearTypingIndicatorState(s.id);
        });
        sessions.delete(sid);
        return;
      }

      if (choice === 'continue') {
        sess.prompted = false;
        sess.chatHistory = sess.chatHistory || [];
        delete sess.pendingGuess;
        sess.humanSockets.forEach((s) => s.emit('resume_chat', { message: 'Continuing chat...' }));
      }
    });

    pairForSocket(socket, forced, io);
  });
}

function pairForSocket(socket, forced, io) {
  if (forced === 'ai') {
    pairWithAI(socket, io);
    return;
  }

  if (waitingQueue.length > 0) {
    let other = null;
    while (waitingQueue.length > 0) {
      const candidate = waitingQueue.shift();
      if (candidate && candidate.socket && candidate.socket.id) {
        clearWaitingTimeout(candidate.socket.id);
      }
      if (!candidate || !candidate.socket) continue;
      if (candidate.socket.id === socket.id) {
        continue;
      }
      other = candidate;
      break;
    }

    if (!other || !other.socket) {
      pairWithAI(socket, io);
      return;
    }

    clearWaitingTimeout(socket.id);
    clearWaitingTimeout(other.socket.id);
    const sid = makeSessionId();
    const sess = {
      id: sid,
      partnerIsAI: false,
      humanSockets: [socket, other.socket],
      chatHistory: [],
      prompted: false,
      // confusion matrix for guesses: TP, FP, FN, TN
      confusion: { TP: 0, FP: 0, FN: 0, TN: 0 },
      // history of guesses for auditing
      guessHistory: [],
    };
    sessions.set(sid, sess);
    socketToSession.set(socket.id, sid);
    socketToSession.set(other.socket.id, sid);
    clearTypingIndicatorState(socket.id);
    clearTypingIndicatorState(other.socket.id);

    socket.emit('paired', { sessionId: sid, partnerType: 'human', partnerId: other.userId });
    other.socket.emit('paired', { sessionId: sid, partnerType: 'human', partnerId: socket.userId });
    return;
  }

  const useAI = Math.random() < 0.5;
  if (useAI) {
    pairWithAI(socket, io);
  } else {
    const alreadyQueued = waitingQueue.some((e) => e && e.socket && e.socket.id === socket.id);
    if (!alreadyQueued) {
        clearTypingIndicatorState(socket.id);
      waitingQueue.push({ socket, userId: socket.userId, enqueuedAt: Date.now() });
      startWaitingTimeout(socket, io);
    }
    socket.emit('paired', { sessionId: null, partnerType: 'waiting', partnerId: null });
    socket.emit('chat_history', { chatHistory: [] });
  }
}

function pairWithAI(socket, io) {
  const sid = makeSessionId();
  const sess = {
    id: sid,
    partnerIsAI: true,
    humanSockets: [socket],
    chatHistory: [],
    prompted: false,
    confusion: { TP: 0, FP: 0, FN: 0, TN: 0 },
    guessHistory: [],
  };
  sessions.set(sid, sess);
  socketToSession.set(socket.id, sid);
  clearTypingIndicatorState(socket.id);
  clearWaitingTimeout(socket.id);

  socket.emit('paired', { sessionId: sid, partnerType: 'ai', partnerId: 'ai' });
  socket.emit('chat_history', { chatHistory: [] });
}

module.exports = { init };
