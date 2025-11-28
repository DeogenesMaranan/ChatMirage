const { aiRespond } = require('./ai');

const waitingQueue = [];
const sessions = new Map();

let nextSessionId = 1;

function createSession(participants) {
  const sessionId = String(nextSessionId++);
  const session = {
    id: sessionId,
    participants: participants,
    messageCount: 0,
    chatHistory: [],
    awaitingGuesses: new Map(),
    awaitingContinue: new Map(),
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

  if (waitingQueue.length >= 2) {
    const idx = waitingQueue.indexOf(socket);
    if (idx !== -1) waitingQueue.splice(idx, 1);
    let other = null;
    for (let i = 0; i < waitingQueue.length; i++) {
      if (waitingQueue[i] && waitingQueue[i].connected) {
        other = waitingQueue.splice(i, 1)[0];
        break;
      }
    }
    if (other) {
      const session = createSession([socket, other]);
      socket.join(session.id);
      other.join(session.id);
      socket.emit('paired', { sessionId: session.id, partnerType: 'human', partnerId: other.id });
      other.emit('paired', { sessionId: session.id, partnerType: 'human', partnerId: socket.id });
      return;
    }
  }
  setTimeout(() => {
    if (!sessions.has(socket.sessionId)) {
      pairWithAI(socket);
    }
  }, 5000);
}

async function handleMessage(session, fromSocket, text) {
  if (session.closed) return;

  session.messageCount += 1;
  session.chatHistory.push({ from: fromSocket.type === 'ai' ? 'ai' : 'human', text });

  fromSocket.emit('chat_message', { from: 'me', text });

  for (const p of session.participants) {
    if (p === fromSocket) continue;
    if (p.type === 'ai') continue;
    p.emit('chat_message', { from: 'partner', text });
  }

  const isAiSession = session.participants.some((p) => p.type === 'ai');
  if (isAiSession) {
    const humanSocket = session.participants.find((p) => p.type !== 'ai');
    if (fromSocket === humanSocket) {
     const reply = await aiRespond(session.chatHistory);
      session.messageCount += 1;
      session.chatHistory.push({ from: 'ai', text: reply });
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

  if (!partnerIsHuman && guess === 'AI') {
    endSession(session, `correct_ai_guess_by_${socket.id}`);
    return;
  }

  if (partnerIsHuman) {
    for (const p of session.participants) {
      if (p.type !== 'ai' && p.connected) {
        session.awaitingContinue.set(p.id, null);
        p.emit('post_guess_options', { message: 'Do you want to continue or end the chat?' });
      }
    }
  } else {
    // AI session, only prompt the guesser
    session.awaitingContinue.set(socket.id, null);
    socket.emit('post_guess_options', { message: 'Do you want to continue or end the chat?' });
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
