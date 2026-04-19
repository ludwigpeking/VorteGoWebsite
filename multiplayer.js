const multiplayerState = {
  socket: null,
  connected: false,
  user: null,
  guestId: null,
  roomId: null,
  roomName: null,
  role: 'spectator',
  color: null,
  isHost: false,
  canMove: false,
  memberCount: 0,
  isOwner: false,
  colorMode: null,
};

const dom = {};

function $(id) {
  return document.getElementById(id);
}

function initDom() {
  dom.lobby = $('lobby');
  dom.room = $('room');
  dom.roomPanel = $('roomPanel');
  dom.roomLabel = $('roomLabel');
  dom.roomRole = $('roomRole');
  dom.roomMembers = $('roomMembers');
  dom.roomPlaceholder = $('roomPlaceholder');
  dom.app = $('app');

  dom.authLinks = $('authLinks');
  dom.authUser = $('authUser');
  dom.authName = $('authName');
  dom.loginLink = $('loginLink');
  dom.signupLink = $('signupLink');
  dom.logoutLink = $('logoutLink');

  dom.authModal = $('authModal');
  dom.authModalTitle = $('authModalTitle');
  dom.authModalClose = $('authModalClose');
  dom.authTabLogin = $('authTabLogin');
  dom.authTabSignup = $('authTabSignup');
  dom.authForm = $('authForm');
  dom.authLoginFields = $('authLoginFields');
  dom.authSignupFields = $('authSignupFields');
  dom.authPassword = $('authPassword');
  dom.loginIdentity = $('loginIdentity');
  dom.signupUsername = $('signupUsername');
  dom.signupEmail = $('signupEmail');
  dom.authStatus = $('authStatus');

  dom.forgotPasswordLink = $('forgotPasswordLink');
  dom.forgotLinkRow = $('forgotLinkRow');
  dom.forgotModal = $('forgotModal');
  dom.forgotModalClose = $('forgotModalClose');
  dom.forgotEmail = $('forgotEmail');
  dom.forgotSubmit = $('forgotSubmit');
  dom.forgotStatus = $('forgotStatus');

  dom.resetModal = $('resetModal');
  dom.resetPassword = $('resetPassword');
  dom.resetSubmit = $('resetSubmit');
  dom.resetStatus = $('resetStatus');

  dom.recordModal = $('recordModal');
  dom.recordModalClose = $('recordModalClose');
  dom.recordList = $('recordList');

  dom.inviteModal = $('inviteModal');
  dom.inviteModalMsg = $('inviteModalMsg');
  dom.inviteAccept = $('inviteAccept');
  dom.inviteDecline = $('inviteDecline');

  dom.createRoomBtn = $('createRoomBtn');
  dom.createRoomModal = $('createRoomModal');
  dom.createRoomName = $('createRoomName');
  dom.createRoomCancel = $('createRoomCancel');
  dom.createRoomSubmit = $('createRoomSubmit');
  dom.leaveRoomBtn = $('leaveRoomBtn');
  dom.inviteTarget = $('inviteTarget');
  dom.inviteSend = $('inviteSend');

  dom.globalChatLog = $('globalChatLog');
  dom.globalChatInput = $('globalChatInput');
  dom.globalChatSend = $('globalChatSend');
  dom.lobbyStatus = $('lobbyStatus');

  dom.roomChatLog = $('roomChatLog');
  dom.roomChatInput = $('roomChatInput');
  dom.roomChatSend = $('roomChatSend');

  dom.onlineUsers = $('onlineUsers');
  dom.roomList = $('roomList');

  dom.pmTarget = $('pmTarget');
  dom.pmInput = $('pmInput');
  dom.pmSend = $('pmSend');
  dom.pmLog = $('pmLog');

  dom.menuGameReviewBtn = $('menuGameReview');
}

function ensureGuestId() {
  const existing = localStorage.getItem('vortego_guest_id');
  if (existing) {
    multiplayerState.guestId = existing;
    return existing;
  }
  const id = `guest_${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem('vortego_guest_id', id);
  multiplayerState.guestId = id;
  return id;
}

async function fetchMe() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) return null;
    const data = await res.json();
    return data.user || null;
  } catch (err) {
    return null;
  }
}

function updateAuthUI() {
  if (multiplayerState.user) {
    dom.authLinks.style.display = 'none';
    dom.authUser.style.display = 'flex';
    dom.authName.textContent = multiplayerState.user.username;
  } else {
    dom.authLinks.style.display = 'flex';
    dom.authUser.style.display = 'none';
    dom.authName.textContent = t('nav.guest');
  }
}

function openAuthModal(mode) {
  dom.authModal.style.display = 'flex';
  dom.authStatus.textContent = '';
  if (mode === 'signup') {
    dom.authModalTitle.textContent = t('auth.createAccount');
    dom.authTabLogin.classList.remove('active');
    dom.authTabSignup.classList.add('active');
    dom.authLoginFields.style.display = 'none';
    dom.authSignupFields.style.display = 'block';
    dom.forgotLinkRow.style.display = 'none';
  } else {
    dom.authModalTitle.textContent = t('auth.welcomeBack');
    dom.authTabSignup.classList.remove('active');
    dom.authTabLogin.classList.add('active');
    dom.authLoginFields.style.display = 'block';
    dom.authSignupFields.style.display = 'none';
    dom.forgotLinkRow.style.display = 'block';
  }
}

function closeAuthModal() {
  dom.authModal.style.display = 'none';
}

function openForgotModal() {
  dom.authModal.style.display = 'none';
  dom.forgotEmail.value = '';
  dom.forgotStatus.textContent = '';
  dom.forgotModal.style.display = 'flex';
}

async function handleForgotSubmit() {
  const email = dom.forgotEmail.value.trim();
  if (!email) { dom.forgotStatus.textContent = t('forgot.enterEmail'); return; }
  dom.forgotSubmit.disabled = true;
  dom.forgotStatus.textContent = t('forgot.sending');
  try {
    await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    dom.forgotStatus.textContent = t('forgot.sentMaybe');
    dom.forgotSubmit.disabled = false;
  } catch {
    dom.forgotStatus.textContent = t('forgot.networkError');
    dom.forgotSubmit.disabled = false;
  }
}

async function handleResetSubmit(token) {
  const password = dom.resetPassword.value;
  if (password.length < 6) { dom.resetStatus.textContent = t('reset.tooShort'); return; }
  dom.resetSubmit.disabled = true;
  dom.resetStatus.textContent = t('reset.saving');
  try {
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      dom.resetStatus.textContent = data.message || t('reset.tooShort');
      dom.resetSubmit.disabled = false;
      return;
    }
    dom.resetModal.style.display = 'none';
    // Clean the token from the URL so a page refresh doesn't re-open the modal
    window.history.replaceState({}, '', '/');
    openAuthModal('login');
  } catch {
    dom.resetStatus.textContent = t('forgot.networkError');
    dom.resetSubmit.disabled = false;
  }
}

function checkResetToken() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('resetToken');
  if (!token) return;
  dom.resetPassword.value = '';
  dom.resetStatus.textContent = '';
  dom.resetModal.style.display = 'flex';
  dom.resetSubmit.onclick = () => handleResetSubmit(token);
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const isSignup = dom.authTabSignup.classList.contains('active');
  dom.authStatus.textContent = t('auth.working');

  const payload = isSignup
    ? {
        username: dom.signupUsername.value.trim(),
        email: dom.signupEmail.value.trim(),
        password: dom.authPassword.value,
      }
    : {
        identity: dom.loginIdentity.value.trim(),
        password: dom.authPassword.value,
      };

  const url = isSignup ? '/api/auth/signup' : '/api/auth/login';

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      dom.authStatus.textContent = data.message || 'Failed';
      return;
    }
    multiplayerState.user = data.user;
    updateAuthUI();
    closeAuthModal();
    refreshSocketConnection();
  } catch (err) {
    dom.authStatus.textContent = t('auth.networkError');
  }
}

async function handleLogout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  multiplayerState.user = null;
  updateAuthUI();
  refreshSocketConnection();
}

function connectSocket() {
  const guestId = ensureGuestId();
  multiplayerState.socket = io({ query: { guestId } });

  multiplayerState.socket.on('connect', () => {
    multiplayerState.connected = true;
    dom.lobbyStatus.textContent = t('lobby.connected');
    dom.lobbyStatus.style.color = '#2ec4b6';
  });

  multiplayerState.socket.on('disconnect', () => {
    multiplayerState.connected = false;
    dom.lobbyStatus.textContent = t('lobby.offline');
    dom.lobbyStatus.style.color = '#f05d5e';
  });

  multiplayerState.socket.on('presence:update', renderPresence);
  multiplayerState.socket.on('rooms:update', renderRooms);
  multiplayerState.socket.on('global:message', addChatMessage);
  multiplayerState.socket.on('pm:receive', addPrivateMessage);
  multiplayerState.socket.on('room:message', addRoomChatMessage);
  multiplayerState.socket.on('room:joined', onRoomJoined);
  multiplayerState.socket.on('room:left', onRoomLeft);
  multiplayerState.socket.on('room:members', onRoomMembers);
  multiplayerState.socket.on('room:invite', onRoomInvite);
  multiplayerState.socket.on('room:rules', onRoomRules);
  multiplayerState.socket.on('room:state', onRoomState);
  multiplayerState.socket.on('game:move', onGameMove);
  multiplayerState.socket.on('game:recordSaved', (p) => {
    console.log('[record]', p);
  });
}

function refreshSocketConnection() {
  if (multiplayerState.socket) {
    multiplayerState.socket.disconnect();
  }
  connectSocket();
}

let lastPresence = [];
function renderPresence(users) {
  if (users) lastPresence = users;
  dom.onlineUsers.innerHTML = '';
  dom.pmTarget.innerHTML = '';
  dom.inviteTarget.innerHTML = '';

  const pmPlaceholder = document.createElement('option');
  pmPlaceholder.value = '';
  pmPlaceholder.textContent = t('lobby.selectUser');
  dom.pmTarget.appendChild(pmPlaceholder);

  const invitePlaceholder = document.createElement('option');
  invitePlaceholder.value = '';
  invitePlaceholder.textContent = t('lobby.invitePlayer');
  dom.inviteTarget.appendChild(invitePlaceholder);

  lastPresence.forEach((user) => {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `<span>${user.name}${user.isGuest ? ' ' + t('lobby.guestSuffix') : ''}</span>`;
    dom.onlineUsers.appendChild(item);

    const option = document.createElement('option');
    option.value = user.clientId;
    option.textContent = user.name;
    dom.pmTarget.appendChild(option);

    const inviteOption = document.createElement('option');
    inviteOption.value = user.clientId;
    inviteOption.textContent = user.name;
    dom.inviteTarget.appendChild(inviteOption);
  });
}

let lastRooms = [];
function renderRooms(rooms) {
  if (rooms) lastRooms = rooms;
  dom.roomList.innerHTML = '';
  lastRooms.forEach((room) => {
    const item = document.createElement('div');
    item.className = 'list-item';
    const info = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = room.name;
    const meta = document.createElement('span');
    meta.textContent = `${t('room.players', { count: room.count })} · ${t('lobby.hostLabel', { host: room.host })}`;
    info.appendChild(title);
    info.appendChild(document.createElement('br'));
    info.appendChild(meta);
    item.appendChild(info);
    const joinBtn = document.createElement('button');
    joinBtn.className = 'ghost-btn';
    joinBtn.textContent = t('lobby.join');
    joinBtn.onclick = () => {
      multiplayerState.socket.emit('room:join', { roomId: room.id });
    };
    item.appendChild(joinBtn);
    dom.roomList.appendChild(item);
  });
}

function addChatMessage(message) {
  const line = document.createElement('div');
  line.textContent = `[${message.time}] ${message.name}: ${message.text}`;
  dom.globalChatLog.appendChild(line);
  dom.globalChatLog.scrollTop = dom.globalChatLog.scrollHeight;
}

function addRoomChatMessage(message) {
  if (!dom.roomChatLog) return;
  const line = document.createElement('div');
  line.textContent = `[${message.time}] ${message.name}: ${message.text}`;
  dom.roomChatLog.appendChild(line);
  dom.roomChatLog.scrollTop = dom.roomChatLog.scrollHeight;
}

function addPrivateMessage(message) {
  const line = document.createElement('div');
  line.textContent = `[${message.time}] ${message.from}: ${message.text}`;
  dom.pmLog.appendChild(line);
  dom.pmLog.scrollTop = dom.pmLog.scrollHeight;
}

function onRoomJoined(payload) {
  multiplayerState.roomId = payload.roomId;
  multiplayerState.roomName = payload.roomName;
  multiplayerState.role = payload.role;
  multiplayerState.color = payload.color;
  multiplayerState.isHost = payload.isHost;
  multiplayerState.isOwner = payload.isHost;
  // Set memberCount here so the opponent doesn't miss the room:members broadcast
  // that was sent before room:joined (when roomId was still null on the client).
  multiplayerState.memberCount = payload.count;
  updateRoomUI(payload);
  applyOwnerUI(payload.isHost);
  showRoom();
  const authCorner = document.getElementById('authCorner');
  if (authCorner) authCorner.style.display = 'none';
  dom.roomPlaceholder.style.display = 'flex';
  dom.app.style.display = 'none';
  // Clear any leftover panel state from a previous game
  if (window.resetToRoomMenu) window.resetToRoomMenu();
  updateMultiplayerState();
}

function applyOwnerUI(isOwner) {
  const ownerOptions = document.getElementById('ownerGameOptions');
  const nonOwnerWaiting = document.getElementById('nonOwnerWaiting');
  if (ownerOptions) ownerOptions.style.display = isOwner ? 'block' : 'none';
  if (nonOwnerWaiting) nonOwnerWaiting.style.display = isOwner ? 'none' : 'block';
}

function onRoomLeft() {
  multiplayerState.roomId = null;
  multiplayerState.roomName = null;
  multiplayerState.role = 'spectator';
  multiplayerState.color = null;
  multiplayerState.isHost = false;
  multiplayerState.isOwner = false;
  multiplayerState.colorMode = null;
  multiplayerState.memberCount = 0;
  multiplayerState.gameStarted = false;
  applyOwnerUI(false);
  updateMultiplayerState();
  const authCorner = document.getElementById('authCorner');
  if (authCorner) authCorner.style.display = '';
  showLobby();
}

function onRoomMembers(payload) {
  if (!payload || payload.roomId !== multiplayerState.roomId) return;
  multiplayerState.memberCount = payload.count;
  dom.roomMembers.textContent = t('room.players', { count: payload.count });
  updateMultiplayerState(); // re-evaluate canMove now that member count changed
}

function onRoomInvite(payload) {
  dom.inviteModalMsg.textContent = t('invite.message', { from: payload.from, roomName: payload.roomName });
  dom.inviteModal.style.display = 'flex';

  dom.inviteAccept.onclick = () => {
    dom.inviteModal.style.display = 'none';
    multiplayerState.socket.emit('room:join', { roomId: payload.roomId });
  };
  dom.inviteDecline.onclick = () => {
    dom.inviteModal.style.display = 'none';
  };
}

function onRoomState(payload) {
  if (!payload || !payload.state) return;
  if (window.applyGameSnapshot) {
    // Once the initial board has been applied for this game session, ignore further
    // room:state events (they are post-move syncs for late-joining spectators).
    // gameStarted is reset to false by onRoomRules at the start of each new game.
    if (multiplayerState.gameStarted) return;
    multiplayerState.gameStarted = true;
    window.applyGameSnapshot(payload.state);
    showGameStage();
  }
}

function onGameMove(payload) {
  if (!payload || !payload.move) return;
  if (payload.move.type === 'place' && window.applyRemoteMove) {
    window.applyRemoteMove(payload.move);
  }
  if (payload.move.type === 'pass' && window.applyRemotePass) {
    window.applyRemotePass();
  }
  // Re-evaluate whose turn it is — currentPlayer has just flipped after the remote move.
  // Without this the opponent's canMove stays false even when it becomes their turn.
  if (window.multiplayerUpdateTurn) window.multiplayerUpdateTurn();
  // Update UI and redraw after applying the remote move
  if (window.updateGameUIRemote) window.updateGameUIRemote();
}

function onRoomRules(payload) {
  if (!payload) return;
  // New rules = new game session; reset gameStarted so room:state is accepted fresh.
  multiplayerState.gameStarted = false;
  multiplayerState.colorMode = payload.colorMode;
  const isSpectator = (multiplayerState.role || '').toLowerCase() === 'spectator';
  // Spectators never get a playing color
  if (isSpectator) {
    multiplayerState.color = null;
  } else if (payload.colorMode === 'study') {
    // Study mode: owner and opponent can both play freely — mark as 'study'
    multiplayerState.color = 'study';
  } else {
    multiplayerState.color = multiplayerState.isOwner
      ? payload.ownerColor
      : payload.opponentColor;
  }
  updateMultiplayerState();
  // Update komi display
  const komiEl = document.getElementById('komiDisplay');
  if (komiEl) komiEl.textContent = payload.komi;
}

function localizeRole(role) {
  const r = (role || '').toLowerCase();
  if (r === 'spectator') return t('room.spectator');
  if (r === 'black') return t('room.black');
  if (r === 'white') return t('room.white');
  return role || '';
}

function updateRoomUI(payload) {
  dom.roomLabel.textContent = payload.roomName;
  dom.roomRole.textContent = localizeRole(payload.role);
  dom.roomMembers.textContent = t('room.players', { count: payload.count });
}

function showLobby() {
  dom.lobby.style.display = 'block';
  dom.room.style.display = 'none';
}

function showRoom() {
  dom.lobby.style.display = 'none';
  dom.room.style.display = 'block';
}

function showGameStage() {
  dom.roomPlaceholder.style.display = 'none';
  dom.app.style.display = 'block';
}

function updateMultiplayerState() {
  window.multiplayerState = {
    active: !!multiplayerState.roomId,
    roomId: multiplayerState.roomId,
    role: multiplayerState.role,
    color: multiplayerState.color,
    isHost: multiplayerState.isHost,
    isOwner: multiplayerState.isOwner,
    colorMode: multiplayerState.colorMode,
    canMove: multiplayerState.canMove,
    memberCount: multiplayerState.memberCount,
  };
  if (window.multiplayerUpdateTurn) {
    window.multiplayerUpdateTurn();
  }
}

function sendChat() {
  const text = dom.globalChatInput.value.trim();
  if (!text) return;
  multiplayerState.socket.emit('global:message', { text });
  dom.globalChatInput.value = '';
}

function sendRoomChat() {
  if (!dom.roomChatInput) return;
  const text = dom.roomChatInput.value.trim();
  if (!text) return;
  multiplayerState.socket.emit('room:message', { text });
  dom.roomChatInput.value = '';
}

function sendPrivateMessage() {
  const text = dom.pmInput.value.trim();
  const target = dom.pmTarget.value;
  if (!text || !target) return;
  multiplayerState.socket.emit('pm:send', { toClientId: target, text });
  dom.pmInput.value = '';
}

function openCreateRoomModal() {
  dom.createRoomName.value = '';
  dom.createRoomName.placeholder = multiplayerState.user
    ? t('createRoom.placeholderUser', { name: multiplayerState.user.username })
    : t('createRoom.placeholder');
  dom.createRoomModal.style.display = 'flex';
  // Defer focus until the modal is painted
  setTimeout(() => dom.createRoomName.focus(), 0);
}

function closeCreateRoomModal() {
  dom.createRoomModal.style.display = 'none';
}

function submitCreateRoom() {
  const typed = dom.createRoomName.value.trim();
  const fallback = multiplayerState.user
    ? `${multiplayerState.user.username}'s Room`
    : 'VorteGo Room';
  const name = (typed || fallback).slice(0, 40);
  multiplayerState.socket.emit('room:create', { name });
  closeCreateRoomModal();
}

function createRoom() {
  openCreateRoomModal();
}

function leaveRoom() {
  multiplayerState.socket.emit('room:leave');
}

function sendInvite() {
  const target = dom.inviteTarget.value;
  if (!target || !multiplayerState.roomId) return;
  multiplayerState.socket.emit('room:invite', { roomId: multiplayerState.roomId, toClientId: target });
}

function syncGameState() {
  if (!multiplayerState.roomId || !window.getGameSnapshot) return;
  // Mark this client as having an active multiplayer game so onRoomState won't
  // re-apply a snapshot echoed back from another player's post-move sync.
  multiplayerState.gameStarted = true;
  const state = window.getGameSnapshot();
  multiplayerState.socket.emit('game:state', { roomId: multiplayerState.roomId, state });
}

async function loadRecordList() {
  if (!multiplayerState.user) {
    alert(t('records.loginRequiredLoad'));
    return;
  }
  dom.recordList.innerHTML = '';
  dom.recordList.textContent = t('records.loading');
  dom.recordModal.style.display = 'flex';
  const res = await fetch('/api/games');
  if (!res.ok) {
    dom.recordList.textContent = t('records.failed');
    return;
  }
  const data = await res.json();
  dom.recordList.innerHTML = '';
  data.games.forEach((game) => {
    const item = document.createElement('div');
    item.className = 'record-item';
    const info = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = game.name;
    const created = document.createElement('span');
    created.textContent = game.createdAt;
    info.appendChild(title);
    info.appendChild(document.createElement('br'));
    info.appendChild(created);
    item.appendChild(info);
    const loadBtn = document.createElement('button');
    loadBtn.className = 'ghost-btn';
    loadBtn.textContent = t('records.load');
    loadBtn.onclick = () => loadRecord(game.id);
    item.appendChild(loadBtn);
    dom.recordList.appendChild(item);
  });
}

async function loadRecord(id) {
  const res = await fetch(`/api/games/${id}`);
  if (!res.ok) return;
  const data = await res.json();
  if (window.applyGameSnapshot) {
    window.applyGameSnapshot(data.data);
    showGameStage();
  }
  dom.recordModal.style.display = 'none';
  syncGameState();
}

function wireEvents() {
  dom.loginLink.onclick = () => openAuthModal('login');
  dom.signupLink.onclick = () => openAuthModal('signup');
  dom.logoutLink.onclick = handleLogout;
  dom.authModalClose.onclick = closeAuthModal;
  dom.authTabLogin.onclick = () => openAuthModal('login');
  dom.authTabSignup.onclick = () => openAuthModal('signup');
  dom.authForm.onsubmit = handleAuthSubmit;

  dom.recordModalClose.onclick = () => (dom.recordModal.style.display = 'none');

  dom.createRoomBtn.onclick = createRoom;
  dom.createRoomCancel.onclick = closeCreateRoomModal;
  dom.createRoomSubmit.onclick = submitCreateRoom;
  dom.createRoomName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submitCreateRoom(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeCreateRoomModal(); }
  });
  dom.leaveRoomBtn.onclick = leaveRoom;
  dom.inviteSend.onclick = sendInvite;

  dom.globalChatSend.onclick = sendChat;
  dom.globalChatInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
      sendChat();
    }
  });

  if (dom.roomChatSend) {
    dom.roomChatSend.onclick = sendRoomChat;
    dom.roomChatInput.addEventListener('keypress', (event) => {
      if (event.key === 'Enter') sendRoomChat();
    });
  }

  dom.forgotPasswordLink.onclick = openForgotModal;
  dom.forgotModalClose.onclick = () => { dom.forgotModal.style.display = 'none'; };
  dom.forgotSubmit.onclick = handleForgotSubmit;
  dom.forgotEmail.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleForgotSubmit(); });

  dom.pmSend.onclick = sendPrivateMessage;
  dom.pmInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') sendPrivateMessage();
  });

  dom.menuGameReviewBtn.onclick = loadRecordList;
}

function initMultiplayer() {
  initDom();
  wireEvents();
  checkResetToken();
  fetchMe().then((user) => {
    multiplayerState.user = user;
    updateAuthUI();
  });
  connectSocket();
}

window.multiplayerSendMove = (vid, color) => {
  if (!multiplayerState.roomId) return;
  multiplayerState.socket.emit('game:move', {
    roomId: multiplayerState.roomId,
    move: { type: 'place', vid, color },
  });
  // Also sync the full board state so late-joining spectators always get the
  // current board (not just the initial empty snapshot from game start).
  syncGameState();
};

window.multiplayerSendPass = () => {
  if (!multiplayerState.roomId) return;
  multiplayerState.socket.emit('game:move', {
    roomId: multiplayerState.roomId,
    move: { type: 'pass' },
  });
  syncGameState();
};

window.multiplayerSyncState = syncGameState;

window.multiplayerSendGameEnd = (result) => {
  if (!multiplayerState.roomId) return;
  multiplayerState.socket.emit('game:end', { roomId: multiplayerState.roomId, result });
};

window.multiplayerSendRules = (rules) => {
  if (!multiplayerState.roomId) return;
  const { komi = 7.5, colorMode = 'owner-black' } = rules || {};
  // Apply owner's color locally right away — don't wait for server round-trip.
  // This ensures multiplayerUpdateTurn() has the correct color when startFn runs.
  multiplayerState.colorMode = colorMode;
  const ownerColor = colorMode === 'owner-white' ? 'white' : colorMode === 'study' ? null : 'black';
  multiplayerState.color = colorMode === 'study' ? 'study' : ownerColor;
  updateMultiplayerState();
  multiplayerState.socket.emit('room:setRules', rules);
};

window.multiplayerUpdateTurn = () => {
  if (!window.getCurrentPlayer) return;
  const currentPlayer = window.getCurrentPlayer();
  // Read directly from the live multiplayerState — not the frozen window snapshot,
  // which is only rebuilt when updateMultiplayerState() is explicitly called.
  const active = !!multiplayerState.roomId;
  const hasOpponent = (multiplayerState.memberCount || 0) >= 2;
  const isSpectator = (multiplayerState.role || '').toLowerCase() === 'spectator';
  let canMove;
  if (!active) {
    // Local play — always can move
    canMove = true;
  } else if (isSpectator) {
    // Spectators can never place stones
    canMove = false;
  } else if (multiplayerState.color === 'study') {
    // Study mode — both players can move freely
    canMove = true;
  } else if (!multiplayerState.color) {
    // No color assigned yet (before rules set) — allow free play while solo
    canMove = !hasOpponent;
  } else if (hasOpponent) {
    // Competitive mode with opponent present — enforce turn order
    canMove = multiplayerState.color === currentPlayer;
  } else {
    // Solo in room waiting for opponent — allow free play
    canMove = true;
  }
  multiplayerState.canMove = canMove;
  if (window.multiplayerState) window.multiplayerState.canMove = canMove;
};

window.addEventListener('DOMContentLoaded', initMultiplayer);

window.addEventListener('languagechange', () => {
  updateAuthUI();
  if (dom.onlineUsers) renderPresence();
  if (dom.roomList) renderRooms();
  if (multiplayerState.roomId) {
    dom.roomRole.textContent = localizeRole(multiplayerState.role);
    dom.roomMembers.textContent = t('room.players', { count: multiplayerState.memberCount || 0 });
  }
  if (multiplayerState.connected) {
    dom.lobbyStatus.textContent = t('lobby.connected');
  } else {
    dom.lobbyStatus.textContent = t('lobby.offline');
  }
});
