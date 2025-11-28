// src/sessionManager.js
// Manages waiting queue, sessions, pairing logic, message relay, Turing prompt,
// guess handling, continue/end logic, and disconnects. Keeps logic modular
// so `src/index.js` only wires up the pieces.

const { aiRespond } = require('./ai');

// In-memory structures for waiting users and active sessions.
const waitingQueue = []; // array of sockets waiting to be paired
const sessions = new Map(); // sessionId -> session object

let nextSessionId = 1;

function createSession(participants) {
  const sessionId = String(nextSessionId++);
  const session = {
    id: sessionId,
    participants: participants, // array of socket objects or {type:'ai'}
    messageCount: 0,
    awaitingGuesses: new Map(), // socket.id -> {guessed: bool, correct: bool}
    awaitingContinue: new Map(), // socket.id -> boolean|null
    closed: false
  };
  sessions.set(sessionId, session);
  return session;
}

function pairWithAI(socket) {
  const session = createSession([socket, { type: 'ai' }]);
  socket.join(session.id);
  socket.emit('paired', { sessionId: session.id, partnerType: 'ai', partnerId: 'AI' });
}

function tryPair(socket) {
  // Allow forcing partner type for testing via handshake auth or query param.
  const auth = socket.handshake && (socket.handshake.auth || socket.handshake.query || {});
  const forced = auth && (auth.forcePartner || auth.force);
  if (forced === 'ai') {
    pairWithAI(socket);
    return;
  }

  // 50% chance to pair with human if someone is waiting, otherwise AI.
  const hasWaiting = waitingQueue.length > 0;
  const chooseHuman = hasWaiting && Math.random() < 0.5;

  if (chooseHuman) {
    const other = waitingQueue.shift();
    if (!other || !other.connected) {
      pairWithAI(socket);
      return;
    }

    const session = createSession([socket, other]);
    socket.join(session.id);
    other.join(session.id);
    socket.emit('paired', { sessionId: session.id, partnerType: 'human', partnerId: other.id });
    other.emit('paired', { sessionId: session.id, partnerType: 'human', partnerId: socket.id });
  } else {
    pairWithAI(socket);
  }
}

async function handleMessage(session, fromSocket, text) {
  if (session.closed) return;

  session.messageCount += 1;

  // Acknowledge to sender and forward to human partner if present.
  fromSocket.emit('chat_message', { from: 'me', text });

  for (const p of session.participants) {
    if (p === fromSocket) continue;
    if (p.type === 'ai') continue;
    p.emit('chat_message', { from: 'partner', text });
  }

  // If AI session and human sent message, generate AI reply
  const isAiSession = session.participants.some((p) => p.type === 'ai');
  if (isAiSession) {
    const humanSocket = session.participants.find((p) => p.type !== 'ai');
    if (fromSocket === humanSocket) {
      const reply = await aiRespond(text);
      session.messageCount += 1;
      humanSocket.emit('chat_message', { from: 'partner', text: reply });
    }
  }

  if (session.messageCount > 0 && session.messageCount % 10 === 0) {
    triggerTuringPrompt(session);
  }
}

function triggerTuringPrompt(session) {
  if (session.closed) return;
  const isAiSession = session.participants.some((p) => p.type === 'ai');
  session.awaitingGuesses.clear();
  session.awaitingContinue.clear();

  if (isAiSession) {
    const humanSocket = session.participants.find((p) => p.type !== 'ai');
    if (humanSocket && humanSocket.connected) {
      session.awaitingGuesses.set(humanSocket.id, { guessed: false, correct: null });
      humanSocket.emit('turing_prompt', { prompt: "Do you think your chat partner is Human or AI?" });
    }
  } else {
    for (const p of session.participants) {
      session.awaitingGuesses.set(p.id, { guessed: false, correct: null });
      if (p.connected) p.emit('turing_prompt', { prompt: "Do you think your chat partner is Human or AI?" });
    }
  }
}

function handleGuess(session, socket, guess) {
  if (session.closed) return;
  const partnerIsHuman = session.participants.some((p) => p !== socket && p.type !== 'ai');
  const expected = partnerIsHuman ? 'Human' : 'AI';
  const correct = guess === expected;
  session.awaitingGuesses.set(socket.id, { guessed: true, correct });
  socket.emit('guess_result', { correct });

  if (!correct) {
    endSession(session, `incorrect_guess_by_${socket.id}`);
    return;
  }

  const isAiSession = session.participants.some((p) => p.type === 'ai');
  if (isAiSession) {
    session.awaitingContinue.set(socket.id, null);
    socket.emit('post_guess_options', { message: 'You guessed correctly. Continue or end chat?' });
  } else {
    let allGuessedAndCorrect = true;
    for (const [id, info] of session.awaitingGuesses.entries()) {
      if (!info.guessed || !info.correct) {
        allGuessedAndCorrect = false;
        break;
      }
    }

    if (allGuessedAndCorrect) {
      for (const p of session.participants) {
        if (p.type !== 'ai' && p.connected) {
          session.awaitingContinue.set(p.id, null);
          p.emit('post_guess_options', { message: 'Both guessed correctly. Continue or end chat?' });
        }
      }
    }
  }
}

function handleContinueChoice(session, socket, choice) {
  if (session.closed) return;
  if (!session.awaitingContinue.has(socket.id)) return;
  session.awaitingContinue.set(socket.id, choice === 'continue');

  for (const val of session.awaitingContinue.values()) {
    if (val === false) {
      endSession(session, 'ended_by_choice');
      return;
    }
  }

  for (const val of session.awaitingContinue.values()) {
    if (val === null) return; // still waiting
  }

  for (const p of session.participants) {
    if (p.type !== 'ai' && p.connected) p.emit('resume_chat', { message: 'Chat resumed after successful Turing responses.' });
  }

  session.awaitingGuesses.clear();
  session.awaitingContinue.clear();
}

function endSession(session, reason) {
  if (session.closed) return;
  session.closed = true;
  for (const p of session.participants) {
    if (p && p.type !== 'ai' && p.connected) {
      p.emit('chat_ended', { reason });
      try { p.leave(session.id); } catch (e) {}
    }
  }
  sessions.delete(session.id);
}

function handleDisconnect(socket) {
  const idx = waitingQueue.indexOf(socket);
  if (idx !== -1) waitingQueue.splice(idx, 1);

  for (const session of sessions.values()) {
    if (session.participants.some((p) => p === socket)) {
      for (const p of session.participants) {
        if (p !== socket && p.type !== 'ai' && p.connected) {
          p.emit('partner_disconnected', { message: 'Your partner disconnected. Chat ended.' });
        }
      }
      endSession(session, `disconnect_${socket.id}`);
      break;
    }
  }
}

// Initialize Socket.io connection handling. This wires per-socket event handlers.
function init(io) {
  io.on('connection', (socket) => {
    // When a client connects, add them to waiting queue and attempt pairing.
    waitingQueue.push(socket);
    tryPair(socket);

    socket.on('send_message', async (data) => {
      const { sessionId, text } = data || {};
      const session = sessions.get(sessionId);
      if (!session) return;
      await handleMessage(session, socket, String(text || ''));
    });

    socket.on('submit_guess', (data) => {
      const { sessionId, guess } = data || {};
      const session = sessions.get(sessionId);
      if (!session) return;
      handleGuess(session, socket, guess);
    });

    socket.on('submit_continue_choice', (data) => {
      const { sessionId, choice } = data || {};
      const session = sessions.get(sessionId);
      if (!session) return;
      handleContinueChoice(session, socket, choice);
    });

    socket.on('disconnect', () => {
      handleDisconnect(socket);
    });
  });
}

module.exports = { init, _internal: { waitingQueue, sessions } };
