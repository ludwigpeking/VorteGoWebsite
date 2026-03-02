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

  dom.recordModal = $('recordModal');
  dom.recordModalClose = $('recordModalClose');
  dom.recordList = $('recordList');

  dom.createRoomBtn = $('createRoomBtn');
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

  dom.saveRecordBtn = $('saveRecordBtn');
  dom.loadRecordBtn = $('loadRecordBtn');
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
    dom.authName.textContent = 'guest';
  }
}

function openAuthModal(mode) {
  dom.authModal.style.display = 'flex';
  dom.authStatus.textContent = '';
  if (mode === 'signup') {
    dom.authModalTitle.textContent = 'Create Account';
    dom.authTabLogin.classList.remove('active');
    dom.authTabSignup.classList.add('active');
    dom.authLoginFields.style.display = 'none';
    dom.authSignupFields.style.display = 'block';
  } else {
    dom.authModalTitle.textContent = 'Welcome Back';
    dom.authTabSignup.classList.remove('active');
    dom.authTabLogin.classList.add('active');
    dom.authLoginFields.style.display = 'block';
    dom.authSignupFields.style.display = 'none';
  }
}

function closeAuthModal() {
  dom.authModal.style.display = 'none';
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const isSignup = dom.authTabSignup.classList.contains('active');
  dom.authStatus.textContent = 'Working...';

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
    dom.authStatus.textContent = 'Network error.';
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
    dom.lobbyStatus.textContent = 'Connected';
    dom.lobbyStatus.style.color = '#2ec4b6';
  });

  multiplayerState.socket.on('disconnect', () => {
    multiplayerState.connected = false;
    dom.lobbyStatus.textContent = 'Offline';
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
  multiplayerState.socket.on('room:state', onRoomState);
  multiplayerState.socket.on('game:move', onGameMove);
}

function refreshSocketConnection() {
  if (multiplayerState.socket) {
    multiplayerState.socket.disconnect();
  }
  connectSocket();
}

function renderPresence(users) {
  dom.onlineUsers.innerHTML = '';
  dom.pmTarget.innerHTML = '';
  dom.inviteTarget.innerHTML = '';

  const pmPlaceholder = document.createElement('option');
  pmPlaceholder.value = '';
  pmPlaceholder.textContent = 'Select user';
  dom.pmTarget.appendChild(pmPlaceholder);

  const invitePlaceholder = document.createElement('option');
  invitePlaceholder.value = '';
  invitePlaceholder.textContent = 'Invite player';
  dom.inviteTarget.appendChild(invitePlaceholder);

  users.forEach((user) => {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `<span>${user.name}${user.isGuest ? ' (guest)' : ''}</span>`;
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

function renderRooms(rooms) {
  dom.roomList.innerHTML = '';
  rooms.forEach((room) => {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `
      <div>
        <strong>${room.name}</strong><br />
        <span>${room.count} players · Host ${room.host}</span>
      </div>
    `;
    const joinBtn = document.createElement('button');
    joinBtn.className = 'ghost-btn';
    joinBtn.textContent = 'Join';
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
  updateRoomUI(payload);
  showRoom();
  dom.roomPlaceholder.style.display = 'flex';
  dom.app.style.display = 'none';
  updateMultiplayerState();
}

function onRoomLeft() {
  multiplayerState.roomId = null;
  multiplayerState.roomName = null;
  multiplayerState.role = 'spectator';
  multiplayerState.color = null;
  multiplayerState.isHost = false;
  multiplayerState.memberCount = 0;
  updateMultiplayerState();
  showLobby();
}

function onRoomMembers(payload) {
  if (!payload || payload.roomId !== multiplayerState.roomId) return;
  multiplayerState.memberCount = payload.count;
  dom.roomMembers.textContent = `${payload.count} players`;
}

function onRoomInvite(payload) {
  const accept = confirm(`${payload.from} invited you to join ${payload.roomName}. Join now?`);
  if (accept) {
    multiplayerState.socket.emit('room:join', { roomId: payload.roomId });
  }
}

function onRoomState(payload) {
  if (!payload || !payload.state) return;
  if (window.applyGameSnapshot) {
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
}

function updateRoomUI(payload) {
  dom.roomLabel.textContent = payload.roomName;
  dom.roomRole.textContent = payload.role;
  dom.roomMembers.textContent = `${payload.count} players`;
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
    canMove: multiplayerState.canMove,
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

function createRoom() {
  const name = prompt('Room name?', 'VorteGo Room');
  if (!name) return;
  multiplayerState.socket.emit('room:create', { name });
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
  const state = window.getGameSnapshot();
  multiplayerState.socket.emit('game:state', { roomId: multiplayerState.roomId, state });
}

async function saveRecordOnline() {
  if (!multiplayerState.user) {
    alert('Login required to save records.');
    return;
  }
  if (!window.getGameSnapshot) return;
  const payload = {
    name: `${multiplayerState.roomName || 'VorteGo'} - ${new Date().toLocaleString()}`,
    data: window.getGameSnapshot(),
  };
  const res = await fetch('/api/games', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (res.ok) {
    alert('Saved online.');
  } else {
    alert('Failed to save.');
  }
}

async function loadRecordList() {
  if (!multiplayerState.user) {
    alert('Login required to load records.');
    return;
  }
  dom.recordList.innerHTML = 'Loading...';
  dom.recordModal.style.display = 'flex';
  const res = await fetch('/api/games');
  if (!res.ok) {
    dom.recordList.textContent = 'Failed to load.';
    return;
  }
  const data = await res.json();
  dom.recordList.innerHTML = '';
  data.games.forEach((game) => {
    const item = document.createElement('div');
    item.className = 'record-item';
    item.innerHTML = `<div><strong>${game.name}</strong><br /><span>${game.createdAt}</span></div>`;
    const loadBtn = document.createElement('button');
    loadBtn.className = 'ghost-btn';
    loadBtn.textContent = 'Load';
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

  dom.pmSend.onclick = sendPrivateMessage;

  dom.saveRecordBtn.onclick = saveRecordOnline;
  dom.loadRecordBtn.onclick = loadRecordList;
}

function initMultiplayer() {
  initDom();
  wireEvents();
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

window.multiplayerUpdateTurn = () => {
  if (!window.multiplayerState || !window.getCurrentPlayer) return;
  const currentPlayer = window.getCurrentPlayer();
  // Only enforce color restriction when there are 2+ players in the room
  const hasOpponent = (window.multiplayerState.memberCount || 0) >= 2;
  const canMove = (window.multiplayerState.color && hasOpponent)
    ? window.multiplayerState.color === currentPlayer
    : true;
  multiplayerState.canMove = canMove;
  window.multiplayerState.canMove = canMove;
};

window.addEventListener('DOMContentLoaded', initMultiplayer);
