const { aiRespond } = require('./ai');

const { randomBytes } = require('crypto');

const MESSAGE_THRESHOLD = 10;

const sessions = new Map();
const waitingQueue = [];
const socketToSession = new Map();

function makeSessionId() {
  return 's_' + randomBytes(6).toString('hex');
}

function init(io) {
  io.on('connection', (socket) => {
    const auth = socket.handshake && socket.handshake.auth ? socket.handshake.auth : {};
    const userId = auth.userId || ('u_' + socket.id);
    const forced = auth.forcePartner || null;

    socket.userId = userId;

    socket.on('disconnect', () => {
      for (let i = 0; i < waitingQueue.length; i++) {
        if (waitingQueue[i].socket.id === socket.id) {
          waitingQueue.splice(i, 1);
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
                s.emit('partner_disconnected', { message: 'Partner disconnected' });
                s.emit('chat_ended', { reason: 'partner_disconnected' });
                socketToSession.delete(s.id);
              }
            });
          }
          sessions.delete(sid);
        }
        socketToSession.delete(socket.id);
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
                s.emit('partner_disconnected', { message: 'Partner skipped' });
                s.emit('chat_ended', { reason: 'skipped' });
                socketToSession.delete(s.id);
              }
            });
          }
          sessions.delete(sid);
        }
        socketToSession.delete(socket.id);
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
            // Show AI typing while we generate a reply
            socket.emit('partner_typing', { userId: 'ai' });

            // Generate the AI text
            const aiText = await aiRespond(sess.chatHistory.slice());

            // Calculate a realistic typing duration based on message length
            const PER_CHAR_MS = 25; // ms per character (adjust for speed)
            const MIN_TYPING_MS = 600; // minimum typing time
            const MAX_TYPING_MS = 4000; // cap maximum typing time
            const typingMs = Math.min(Math.max(Math.floor(aiText.length * PER_CHAR_MS), MIN_TYPING_MS), MAX_TYPING_MS);

            // Keep showing typing for the computed duration
            await new Promise((r) => setTimeout(r, typingMs));

            const aiMsg = { from: 'ai', text: aiText };
            sess.chatHistory.push(aiMsg);

            // Stop typing indicator then send the AI message
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

      if (!sess.prompted && sess.chatHistory.length % MESSAGE_THRESHOLD === 0) {
        sess.prompted = true;
        const prompt = 'After these messages, guess whether your partner is Human or AI.';
        if (sess.partnerIsAI) {
          sess.humanSockets.forEach((s) => s.emit('turing_prompt', { prompt }));
        } else {
          sess.humanSockets.forEach((s) => s.emit('turing_prompt', { prompt }));
        }
      }
    });

    socket.on('typing', (data) => {
      const sid = data && data.sessionId ? data.sessionId : socketToSession.get(socket.id);
      if (!sid) return;
      const sess = sessions.get(sid);
      if (!sess) return;
      
      if (sess.partnerIsAI) return;
      if (sess.humanSockets) {
        sess.humanSockets.forEach((s) => {
          if (s.id !== socket.id) {
            s.emit('partner_typing', { userId: socket.userId });
          }
        });
      }
    });

    socket.on('stop_typing', (data) => {
      const sid = data && data.sessionId ? data.sessionId : socketToSession.get(socket.id);
      if (!sid) return;
      const sess = sessions.get(sid);
      if (!sess) return;
      if (sess.partnerIsAI) return;
      if (sess.humanSockets) {
        sess.humanSockets.forEach((s) => {
          if (s.id !== socket.id) {
            s.emit('partner_stop_typing', { userId: socket.userId });
          }
        });
      }
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

      socket.emit('guess_result', { correct });

      if (correct && actualIsAI && guessedAI) {
        sess.humanSockets.forEach((s) => {
          s.emit('chat_ended', { reason: 'guessed_ai_correctly' });
          socketToSession.delete(s.id);
        });
        sessions.delete(sid);
        return;
      }

      socket.emit('post_guess_options', { message: correct ? 'Correct guess.' : 'Incorrect guess.' });
    });

    socket.on('submit_continue_choice', (data) => {
      const sid = data && data.sessionId ? data.sessionId : socketToSession.get(socket.id);
      if (!sid) return;
      const choice = data && data.choice ? String(data.choice).toLowerCase() : '';
      const sess = sessions.get(sid);
      if (!sess) return;

      if (choice === 'end') {
        sess.humanSockets.forEach((s) => {
          s.emit('chat_ended', { reason: 'ended_by_user' });
          socketToSession.delete(s.id);
        });
        sessions.delete(sid);
        return;
      }

      if (choice === 'continue') {
        sess.prompted = false;
        sess.chatHistory = sess.chatHistory || [];
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

    const sid = makeSessionId();
    const sess = {
      id: sid,
      partnerIsAI: false,
      humanSockets: [socket, other.socket],
      chatHistory: [],
      prompted: false,
    };
    sessions.set(sid, sess);
    socketToSession.set(socket.id, sid);
    socketToSession.set(other.socket.id, sid);

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
      waitingQueue.push({ socket, userId: socket.userId });
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
  };
  sessions.set(sid, sess);
  socketToSession.set(socket.id, sid);

  socket.emit('paired', { sessionId: sid, partnerType: 'ai', partnerId: 'ai' });
  socket.emit('chat_history', { chatHistory: [] });
}

module.exports = { init };
