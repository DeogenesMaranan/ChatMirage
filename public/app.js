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
const modalRow = document.getElementById('row');
let customModalButtons = [];
const debugToggle = document.getElementById('debugToggle');
const debugArea = document.getElementById('debugArea');
const homeBtn = document.getElementById('homeBtn');
const statsBox = document.getElementById('statsBox');
const statsSummary = document.getElementById('statsSummary');
const statsList = document.getElementById('statsList');

function addMessage(from, text) {
  const wrapper = document.createElement('div');
  wrapper.className = 'w-full flex';
  const bubble = document.createElement('div');
  bubble.className = 'max-w-[80%] px-3 py-2 rounded-lg text-sm break-words shadow';
  const textNode = document.createElement('div');
  textNode.textContent = text;
  bubble.appendChild(textNode);

  if (from === 'me') {
    wrapper.classList.add('justify-end');
    bubble.classList.add('bg-purple-600', 'text-white');
  } else {
    wrapper.classList.add('justify-start');
    bubble.classList.add('bg-gray-800', 'text-white', 'border', 'border-purple-500/30');
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

function showLanding() {
  clearSession();
  try { if (socket && socket.disconnect) socket.disconnect(); } catch (e) {}
  socket = null;
  sessionId = null;
  partnerType = null;

  messagesEl.innerHTML = '';
  promptArea.innerHTML = '';
  landing.classList.remove('hidden');
  chatUI.classList.add('hidden');
  disableInputControls(true);
  statusEl.classList.add('hidden');
}

async function fetchAndShowStats() {
  try {
    const res = await fetch('/api/guess-stats');
    if (!res.ok) throw new Error('failed');
    const data = await res.json();
    const { total = 0, TP = 0, FP = 0, FN = 0, TN = 0 } = data;
    if (!statsBox || !statsSummary || !statsList) return;
    statsBox.classList.remove('hidden');
    statsSummary.textContent = total === 0 ? 'No community guesses yet.' : `Total community guesses: ${total}`;

    const friendly = [
      { k: 'TP', label: "Guessed 'AI' and were right", v: TP },
      { k: 'FP', label: "Guessed 'AI' but it was human", v: FP },
      { k: 'FN', label: "Guessed 'Human' but it was AI", v: FN },
      { k: 'TN', label: "Guessed 'Human' and were right", v: TN },
    ];

    statsList.innerHTML = '';
    friendly.forEach(item => {
      const card = document.createElement('div');
      card.className = 'rounded-xl border border-purple-500/20 bg-gray-900/50 px-3 py-2 flex flex-col gap-1 hover:border-purple-400/50 transition-colors';
      card.innerHTML = `
        <div class="flex items-center justify-between text-[10px] uppercase tracking-widest text-purple-300/70">
          <span>${item.k}</span>
          <span class="text-purple-200/60">${item.v}</span>
        </div>
        <p class="text-[12px] font-medium text-purple-100/90 leading-tight">${item.label}</p>
      `;
      statsList.appendChild(card);
    });
  } catch (e) {
    if (statsSummary) statsSummary.textContent = 'Failed to load community summary.';
    console.error('Failed to fetch stats', e);
  }
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
  cleanupCustomModalButtons();
  modalTitle.textContent = title || 'Notice';
  modalMessage.textContent = message || '';
  if (modalClose) modalClose.style.display = '';
  if (modalSkip) modalSkip.style.display = '';
  modalBackdrop.style.display = 'flex';
}

function hideModal(){
  modalBackdrop.style.display = 'none';
  cleanupCustomModalButtons();
}

function cleanupCustomModalButtons() {
  if (!modalRow) return;
  // Remove any custom buttons we added
  customModalButtons.forEach(b => { if (b && b.parentNode === modalRow) modalRow.removeChild(b); });
  customModalButtons = [];
  // Ensure default buttons are visible
  if (modalClose) modalClose.style.display = '';
  if (modalSkip) modalSkip.style.display = '';
}

function showCustomModal(title, message, buttons) {
  modalTitle.textContent = title || 'Notice';
  modalMessage.textContent = message || '';
  if (modalClose) modalClose.style.display = 'none';
  if (modalSkip) modalSkip.style.display = 'none';

  if (modalRow) {
    buttons.forEach(b => {
      const btn = document.createElement('button');
      btn.textContent = b.text;
      if (b.className) btn.className = b.className;
      btn.onclick = () => { try { b.onclick && b.onclick(); } catch (e) { console.error(e); } };
      modalRow.appendChild(btn);
      customModalButtons.push(btn);
    });
  }
  modalBackdrop.style.display = 'flex';
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

    const existingTyping = document.getElementById('typingBubble');
    if (existingTyping) existingTyping.remove();
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
    showCustomModal('Turing Test', data.prompt, [
      { text: 'Human', className: 'px-3 py-2 rounded-md text-white bg-gray-800 hover:bg-gray-700 border border-purple-500/50', onclick: () => { submitGuess('Human'); } },
      { text: 'AI', className: 'px-3 py-2 rounded-md bg-purple-600 text-white hover:bg-purple-700 transition-colors shadow-lg shadow-purple-900/50', onclick: () => { submitGuess('AI'); } }
    ]);
  });

  socket.on('guess_result', (data) => {
    const message = data && data.correct ? 'Your guess was correct.' : 'Incorrect guess.';
    showCustomModal('Guess Result', message, [ { text: 'Close', className: 'px-3 py-2 rounded-md bg-gray-100 hover:bg-gray-200', onclick: () => { hideModal(); } } ]);
  });

  socket.on('post_guess_options', (data) => {
    showCustomModal('Continue or End', data.message, [
      { text: 'Continue', className: 'px-3 py-2 rounded-md text-white bg-gray-800 hover:bg-gray-700 border border-purple-500/50', onclick: () => { submitContinueChoice('continue'); } },
      { text: 'End Chat', className: 'px-3 py-2 rounded-md bg-purple-600 text-white hover:bg-purple-700 transition-colors shadow-lg shadow-purple-900/50', onclick: () => { submitContinueChoice('end'); } }
    ]);
  });

  socket.on('resume_chat', (data) => { appendPromptArea(data.message); setTimeout(() => (promptArea.innerHTML = ''), 1500); });

  socket.on('chat_ended', (data) => {
    const reason = data && data.reason ? data.reason : 'ended';
    const partnerLabel = data && data.partnerType ? (data.partnerType === 'ai' ? 'AI' : 'Human') : null;
    const revealLine = data && data.message ? data.message : partnerLabel ? `Chat ended. Your partner was ${partnerLabel}.` : 'Chat ended.';
    const footer = 'You can skip to find a new partner or close.';
    const modalText = [revealLine, footer].filter(Boolean).join('\n');
    showModal('Chat ended', modalText);
    statusEl.textContent = 'Chat ended.';
    disableInputControls(true);
    clearSession();
  });

  socket.on('partner_disconnected', (data) => {
    const msg = (data && data.message) ? data.message : 'Partner disconnected unexpectedly';
    const partnerLabel = data && data.partnerType ? (data.partnerType === 'ai' ? 'AI' : 'Human') : null;
    const revealLine = partnerLabel ? `They were ${partnerLabel}.` : '';
    const footer = 'You can skip to find a new partner or close.';
    const modalText = [msg, revealLine, footer].filter(Boolean).join('\n');
    showModal('Partner disconnected', modalText);
    statusEl.textContent = 'Partner disconnected.';
    disableInputControls(true);
    clearSession();
  });
}

function submitGuess(guess) {
  if (!sessionId || !socket) return;
  socket.emit('submit_guess', { sessionId, guess });
  hideModal();
}

function submitContinueChoice(choice) {
  if (!sessionId || !socket) return;
  socket.emit('submit_continue_choice', { sessionId, choice });
  hideModal();
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
  if (!messagesEl) return;
  const existing = document.getElementById('typingBubble');
  if (flag) {
    if (existing) return;
    const wrapper = document.createElement('div');
    wrapper.id = 'typingBubble';
    wrapper.className = 'w-full flex justify-start';

    const bubble = document.createElement('div');
    bubble.className = 'max-w-[40%] px-3 py-3 rounded-lg text-sm break-words bg-gray-800 text-gray-900 flex items-center gap-2 border border-purple-500/30';

    // three animated dots
    const dots = document.createElement('div');
    dots.className = 'flex items-center gap-1';
    for (let i = 0; i < 3; i++) {
      const s = document.createElement('span');
      s.className = 'w-2 h-2 bg-purple-300 rounded-full';
      s.style.display = 'inline-block';
      s.style.animation = 'typing-bounce 0.8s infinite';
      s.style.animationDelay = (i * 0.12) + 's';
      dots.appendChild(s);
    }

    bubble.appendChild(dots);
    wrapper.appendChild(bubble);
    messagesEl.appendChild(wrapper);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  } else {
    if (existing) existing.remove();
  }
}

// Add small keyframe for typing dots (fallback if Tailwind doesn't include it)
const styleId = 'chatmirage-typing-style';
if (!document.getElementById(styleId)) {
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `@keyframes typing-bounce { 0%{ transform: translateY(0);} 50%{ transform: translateY(-4px);} 100%{ transform: translateY(0);} }`;
  document.head.appendChild(style);
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
  showLanding();
  statusEl.textContent = 'Chat closed.';
};

debugToggle.onclick = () => {
  const isHidden = debugArea.classList.contains('hidden') || debugArea.style.display === 'none' || debugArea.style.display === '' && debugArea.classList.contains('hidden');
  if (isHidden) {
    updateDebug();
    debugArea.classList.remove('hidden');
    debugArea.style.display = '';
    debugToggle.textContent = 'Hide Debug';
    if (statusEl) statusEl.classList.remove('hidden');
  } else {
    debugArea.classList.add('hidden');
    debugArea.style.display = 'none';
    debugToggle.textContent = 'Debug';
    if (statusEl) statusEl.classList.add('hidden');
  }
};

if (homeBtn) {
  homeBtn.onclick = () => {
    showLanding();
  };
}

function updateDebug(){
  debugArea.textContent = JSON.stringify({ userId: getUserId(), sessionId, partnerType }, null, 2);
}

if (loadSession()) {
  showChatUI();
  connectSocket();
} else {
  startBtn.onclick = () => { showChatUI(); connectSocket(); };
  demoBtn.onclick = () => { window.__forcePartner = 'ai'; showChatUI(); connectSocket(); };
  // Load community stats on the landing page
  fetchAndShowStats();
}
