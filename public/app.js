const landing = document.getElementById('landing');
const chatUI = document.getElementById('chatUI');
const startBtn = document.getElementById('startBtn');
const demoBtn = document.getElementById('demoBtn');

let socket = null;
let sessionId = null;
let partnerType = null;
const statusEl = document.getElementById('status');
const messagesEl = document.getElementById('messages');
const typingIndicator = document.getElementById('typingIndicator');
const inputEl = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const promptArea = document.getElementById('promptArea');
const overlay = document.getElementById('overlay');
const overlayText = document.getElementById('overlayText');
const modalBackdrop = document.getElementById('modalBackdrop');
const modalTitle = document.getElementById('modalTitle');
const modalMessage = document.getElementById('modalMessage');
const modalSkip = document.getElementById('modalSkip');
const modalClose = document.getElementById('modalClose');
const debugToggle = document.getElementById('debugToggle');
const debugArea = document.getElementById('debugArea');

function addMessage(from, text) {
  const wrapper = document.createElement('div');
  wrapper.className = 'w-full flex';
  const bubble = document.createElement('div');
  bubble.className = 'max-w-[80%] px-3 py-2 rounded-lg text-sm break-words shadow';
  const label = document.createElement('div');
  label.className = 'text-xs opacity-70 mb-1';
  label.textContent = from === 'me' ? 'Me' : 'Partner';
  const textNode = document.createElement('div');
  textNode.textContent = text;

  bubble.appendChild(label);
  bubble.appendChild(textNode);

  if (from === 'me') {
    wrapper.classList.add('justify-end');
    bubble.classList.add('bg-blue-600', 'text-white');
  } else {
    wrapper.classList.add('justify-start');
    bubble.classList.add('bg-gray-100', 'text-gray-900');
  }

  wrapper.appendChild(bubble);
  messagesEl.appendChild(wrapper);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

const pendingClientIds = new Set();
const recentSentText = { text: null, ts: 0 };

function showChatUI() {
  landing.classList.add('hidden');
  chatUI.classList.remove('hidden');
}

function saveSession() {
  localStorage.setItem('chatmirage_session', JSON.stringify({ sessionId, partnerType }));
}

function loadSession() {
  try {
    const data = JSON.parse(localStorage.getItem('chatmirage_session'));
    if (data && data.sessionId) {
      sessionId = data.sessionId;
      partnerType = data.partnerType;
      return true;
    }
  } catch {}
  return false;
}

function clearSession() {
  localStorage.removeItem('chatmirage_session');
}

function getUserId() {
  let userId = localStorage.getItem('chatmirage_userid');
  if (!userId) {
    userId = 'u_' + Math.random().toString(36).substr(2, 12);
    localStorage.setItem('chatmirage_userid', userId);
  }
  return userId;
}

function showOverlay(msg){
  overlayText.textContent = msg || 'Searching for partner...';
  overlay.style.display = 'flex';
  disableInputControls(true);
}

function hideOverlay(){
  overlay.style.display = 'none';
  disableInputControls(false);
}

function showModal(title, message){
  modalTitle.textContent = title || 'Notice';
  modalMessage.textContent = message || '';
  modalBackdrop.style.display = 'flex';
}

function hideModal(){
  modalBackdrop.style.display = 'none';
}

function disableInputControls(flag){
  inputEl.disabled = !!flag;
  sendBtn.disabled = !!flag;
  document.getElementById('skipBtn').disabled = !!flag;
}

function connectSocket(){
  const urlParams = new URLSearchParams(location.search);
  const forced = window.__forcePartner || urlParams.get('force');
  const userId = getUserId();
  showOverlay('Searching for partner...');
  try {
    socket = forced ? io({ auth: { forcePartner: forced, userId } }) : io({ auth: { userId } });
  } catch (err) {
    console.error('Socket initialization failed', err);
    hideOverlay();
    showModal('Connection error', 'Could not initialize socket.io client. Check the console for details.');
    return;
  }

  socket.on('connect_error', (err) => {
    console.error('connect_error', err);
    hideOverlay();
    showModal('Connection error', (err && err.message) ? err.message : 'Failed to connect to server');
    statusEl.textContent = 'Connection error';
  });

  socket.on('connect', () => {
    if (!sessionId) {
      statusEl.textContent = 'Connected. Searching for partner...';
      showOverlay('Searching for partner...');
    } else {
      statusEl.textContent = 'Connected — resuming session';
      hideOverlay();
    }
  });

  let myRole = 'human';
  socket.on('paired', (data) => {
    sessionId = data.sessionId;
    partnerType = data.partnerType;
    saveSession();
    if (partnerType === 'waiting' || !partnerType) {
      statusEl.textContent = `Paired — Partner: waiting`;
      showOverlay('Waiting for partner to join...');
    } else {
      statusEl.textContent = `Paired — Partner: ${data.partnerType}`;
      hideOverlay();
    }
    appendPromptArea('Paired! Say hi.');
    socket.emit('request_history', { sessionId });
    updateDebug();
  });

  socket.on('chat_message', (data) => {
    if (data && data.clientId && pendingClientIds.has(data.clientId)) {
      pendingClientIds.delete(data.clientId);
      return;
    }
    const userId = getUserId();
    if ((data.userId && data.userId === userId) || (data.from && data.from === userId)) {
      return;
    }
    try {
      const now = Date.now();
      if (data && typeof data.text === 'string' && recentSentText.text === data.text && (now - recentSentText.ts) < 2500) {
        return;
      }
    } catch (e) { }

    addMessage('partner', data.text);
  });

  socket.on('chat_history', (data) => {
    messagesEl.innerHTML = '';
    const userId = getUserId();
    if (data && Array.isArray(data.chatHistory)) {
      data.chatHistory.forEach(msg => {
        if (msg.userId && msg.userId === userId) {
          addMessage('me', msg.text);
        } else if (msg.from === 'ai') {
          addMessage('partner', msg.text);
        } else {
          addMessage('partner', msg.text);
        }
      });
    }
  });

  socket.on('partner_typing', () => { showTyping(true); });
  socket.on('partner_stop_typing', () => { showTyping(false); });

  socket.on('turing_prompt', (data) => {
    promptArea.innerHTML = '';
    const p = document.createElement('div');
    p.textContent = data.prompt;
    promptArea.appendChild(p);
    const humanBtn = document.createElement('button');
    humanBtn.textContent = 'Human';
    humanBtn.onclick = () => submitGuess('Human');
    promptArea.appendChild(humanBtn);
    const aiBtn = document.createElement('button');
    aiBtn.textContent = 'AI';
    aiBtn.onclick = () => submitGuess('AI');
    promptArea.appendChild(aiBtn);
  });

  socket.on('guess_result', (data) => {
    if (data.correct) appendPromptArea('Your guess was correct. Waiting for continue/end options...');
    else appendPromptArea('Incorrect guess.');
  });

  socket.on('post_guess_options', (data) => {
    promptArea.innerHTML = '';
    const p = document.createElement('div');
    p.textContent = data.message;
    promptArea.appendChild(p);
    const cont = document.createElement('button'); cont.textContent = 'Continue'; cont.onclick = () => submitContinueChoice('continue'); promptArea.appendChild(cont);
    const end = document.createElement('button'); end.textContent = 'End Chat'; end.onclick = () => submitContinueChoice('end'); promptArea.appendChild(end);
  });

  socket.on('resume_chat', (data) => { appendPromptArea(data.message); setTimeout(() => (promptArea.innerHTML = ''), 1500); });

  socket.on('chat_ended', (data) => {
    const reason = data && data.reason ? data.reason : 'ended';
    showModal('Chat ended', 'Chat ended: ' + reason + '\nYou can skip to find a new partner or close.');
    statusEl.textContent = 'Chat ended.';
    disableInputControls(true);
    clearSession();
  });

  socket.on('partner_disconnected', (data) => {
    const msg = (data && data.message) ? data.message : 'Partner disconnected unexpectedly';
    showModal('Partner disconnected', msg + '\nYou can skip to find a new partner or close.');
    statusEl.textContent = 'Partner disconnected.';
    disableInputControls(true);
    clearSession();
  });
}

function submitGuess(guess) {
  if (!sessionId || !socket) return;
  socket.emit('submit_guess', { sessionId, guess });
  appendPromptArea('You guessed: ' + guess);
}

function submitContinueChoice(choice) {
  if (!sessionId || !socket) return;
  socket.emit('submit_continue_choice', { sessionId, choice });
  appendPromptArea('You chose: ' + choice);
}

function appendPromptArea(text) {
  const d = document.createElement('div');
  d.textContent = text;
  promptArea.appendChild(d);
}

let typing = false;
let typingTimeout = null;
const TYPING_DELAY = 1400;

function showTyping(flag) {
  if (!typingIndicator) return;
  typingIndicator.textContent = flag ? 'Partner is typing...' : '';
}

inputEl.addEventListener('input', () => {
  if (!socket || !sessionId) return;
  if (!typing) { typing = true; socket.emit('typing', { sessionId }); }
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => { typing = false; if (socket && sessionId) socket.emit('stop_typing', { sessionId }); }, TYPING_DELAY);
});

sendBtn.onclick = () => {
  const text = inputEl.value.trim();
  if (!text || !sessionId || !socket || overlay.style.display === 'flex') return;
  const clientId = 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2,9);
  pendingClientIds.add(clientId);
  addMessage('me', text);
  recentSentText.text = text; recentSentText.ts = Date.now();
  socket.emit('send_message', { sessionId, text, clientId });
  if (socket && sessionId) socket.emit('stop_typing', { sessionId });
  typing = false; clearTimeout(typingTimeout); inputEl.value = '';
};

const skipBtn = document.getElementById('skipBtn');
skipBtn.onclick = () => {
  if (socket && sessionId) socket.emit('stop_typing', { sessionId });
  if (socket) socket.emit('skip_partner');
  statusEl.textContent = 'Searching for new partner...';
  messagesEl.innerHTML = '';
  promptArea.innerHTML = '';
  showOverlay('Searching for new partner...');
};

inputEl.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') sendBtn.click(); });

modalSkip.onclick = () => {
  hideModal();
  if (socket) socket.emit('skip_partner');
  messagesEl.innerHTML = '';
  promptArea.innerHTML = '';
  showOverlay('Searching for new partner...');
};

modalClose.onclick = () => {
  hideModal();
  disableInputControls(true);
  statusEl.textContent = 'Chat closed.';
};

debugToggle.onclick = () => {
  if (debugArea.style.display === 'block') { debugArea.style.display = 'none'; debugToggle.textContent = 'Debug'; }
  else { updateDebug(); debugArea.style.display = 'block'; debugToggle.textContent = 'Hide Debug'; }
};

function updateDebug(){
  debugArea.textContent = JSON.stringify({ userId: getUserId(), sessionId, partnerType }, null, 2);
}

if (loadSession()) {
  showChatUI();
  connectSocket();
} else {
  startBtn.onclick = () => { showChatUI(); connectSocket(); };
  demoBtn.onclick = () => { window.__forcePartner = 'ai'; showChatUI(); connectSocket(); };
}
