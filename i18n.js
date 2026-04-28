// Lightweight i18n for VorteGo.
//   - Mark elements with data-i18n="key" to translate textContent.
//   - data-i18n-html="key" for innerHTML (use sparingly).
//   - data-i18n-placeholder="key" / data-i18n-title="key" for those attrs.
//   - JS code: call t('key') and listen to window 'languagechange' to refresh.
(function () {
  const STORAGE_KEY = 'vortego_lang';
  const SUPPORTED = ['en', 'zh', 'ja', 'ko'];
  const FALLBACK = 'en';

  const dict = {
    en: {
      // ---- Top nav ----
      'nav.createRoom': 'Create Game Room',
      'nav.login': 'Login',
      'nav.signup': 'Sign Up',
      'nav.logout': 'Logout',
      'nav.guest': 'guest',
      'lang.label': 'Language',

      // ---- Auth modal ----
      'auth.welcomeBack': 'Welcome Back',
      'auth.createAccount': 'Create Account',
      'auth.tabLogin': 'Login',
      'auth.tabSignup': 'Sign Up',
      'auth.username': 'Username',
      'auth.email': 'Email',
      'auth.usernameOrEmail': 'Username or Email',
      'auth.password': 'Password',
      'auth.continue': 'Continue',
      'auth.forgotPassword': 'Forgot password?',
      'auth.working': 'Working...',
      'auth.networkError': 'Network error.',
      'auth.close': 'Close',

      // ---- Forgot password modal ----
      'forgot.title': 'Reset Password',
      'forgot.body': "Enter the email address on your account and we'll send you a reset link.",
      'forgot.send': 'Send Reset Link',
      'forgot.enterEmail': 'Please enter your email.',
      'forgot.sending': 'Sending…',
      'forgot.sentMaybe': 'If that email is registered, a reset link has been sent. Check your inbox.',
      'forgot.networkError': 'Network error. Please try again.',

      // ---- Reset password modal ----
      'reset.title': 'Choose New Password',
      'reset.label': 'New Password',
      'reset.save': 'Save New Password',
      'reset.tooShort': 'Password must be at least 6 characters.',
      'reset.saving': 'Saving…',
      'reset.success': 'Password updated. You can now log in.',

      // ---- Create-room modal ----
      'createRoom.title': 'Create a Game Room',
      'createRoom.body': "Pick a name your opponent will see in the lobby. You'll be the host — once someone joins, you can choose the board and start the game.",
      'createRoom.label': 'Room name',
      'createRoom.placeholder': 'e.g. Friday Night Go',
      'createRoom.placeholderUser': "e.g. {name}'s Room",
      'createRoom.hint': 'Up to 40 characters. Leave blank to use your username.',
      'createRoom.cancel': 'Cancel',
      'createRoom.submit': 'Create Room',

      // ---- Records modal ----
      'records.title': 'Saved Records',
      'records.loading': 'Loading…',
      'records.failed': 'Failed to load.',
      'records.load': 'Load',
      'records.loginRequiredLoad': 'Login required to load records.',
      'records.empty': 'No records found.',
      'records.searchPlaceholder': 'Search by name or player…',
      'records.filter.mine': 'My Records',
      'records.filter.all': 'All',

      // ---- Invite modal ----
      'invite.title': 'Game Invitation',
      'invite.message': '{from} invited you to join "{roomName}". Join now?',
      'invite.decline': 'Decline',
      'invite.accept': 'Join',

      // ---- Lobby ----
      'lobby.globalChat': 'Global Chat',
      'lobby.connected': 'Connected',
      'lobby.offline': 'Offline',
      'lobby.sayHello': 'Say hello to the lobby',
      'lobby.send': 'Send',
      'lobby.onlinePlayers': 'Online Players',
      'lobby.privateMessage': 'Private Message',
      'lobby.message': 'Message',
      'lobby.gameRooms': 'Game Rooms',
      'lobby.selectUser': 'Select user',
      'lobby.invitePlayer': 'Invite player',
      'lobby.guestSuffix': '(guest)',
      'lobby.join': 'Join',
      'lobby.hostLabel': 'Host {host}',

      // ---- Room panel ----
      'room.label': 'Room',
      'room.spectator': 'Spectator',
      'room.black': 'Black',
      'room.white': 'White',
      'room.players': '{count} players',
      'room.invite': 'Invite',
      'room.leave': 'Leave Room',
      'room.backToMenu': '← Room Menu',
      'room.waiting1': 'Waiting for the host to set up the game.',
      'room.waiting2': "You'll receive the board automatically once they start.",
      'room.menu.random': 'Random Goban',
      'room.menu.preset': 'Preset Gobans',
      'room.menu.starDomination': 'Star Domination (3D)',
      'room.menu.design': 'Design Your Own Goban',
      'room.menu.load': 'Load Goban',
      'room.menu.review': 'Review Game Records',
      'room.menu.settings': 'Settings',
      'goban.modal.loadTitle': 'Load Goban',
      'goban.modal.saveTitle': 'Save Goban',
      'goban.modal.namePlaceholder': 'Goban name',
      'goban.modal.searchPlaceholder': 'Search by name or creator…',
      'goban.modal.save': 'Save',
      'goban.modal.saved': 'Saved.',
      'goban.modal.empty': 'No gobans found.',
      'goban.filter.official': 'Official Gobans',
      'goban.filter.mine': 'My Gobans',
      'goban.filter.all': 'All',
      'room.chat': 'Room Chat',
      'room.chatPlaceholder': 'Message the room…',
      'room.placeholder.title': 'Pick a mode from the room menu',
      'room.placeholder.subtitle': 'Once a board is selected, the room will sync moves for everyone.',

      // ---- Random goban ----
      'random.title': 'Random Goban',
      'random.generating': 'Generating goban…',
      'random.generated': 'Goban generated!',
      'random.generateAnother': 'Generate Another',
      'random.acceptPlay': 'Accept & Play',

      // ---- Editor mode ----
      'editor.title': 'Editor Mode',
      'editor.moveVertex': 'Move Vertex [v]',
      'editor.deleteEdge': 'Delete Edge [e]',
      'editor.select': 'Select [s]',
      'editor.gobanSize': 'Goban Size',
      'editor.mode': 'Mode',
      'editor.hover': 'Hover',
      'editor.none': 'none',
      'editor.vertices': 'Vertices',
      'editor.tris': 'Tris',
      'editor.quads': 'Quads',
      'editor.undo': 'Undo [Ctrl+Z]',
      'editor.redo': 'Redo [Ctrl+Shift+Z]',
      'editor.autoRemove': 'Auto Remove Edges',
      'editor.relax': 'Relax [r/R]',
      'editor.relaxTest': 'Relax (Test)',
      'editor.relaxCoulomb': 'Relax (Coulomb)',
      'editor.saveGoban': 'Save Goban',
      'editor.loadGoban': 'Load Goban',
      'editor.playGo': 'Play Go [p/P]',

      // ---- Play mode ----
      'play.title': 'Play Mode',
      'play.turn': 'Turn',
      'play.captured': 'Captured',
      'play.undoMove': 'Undo Move',
      'play.redoMove': 'Redo Move',
      'play.pass': 'Pass',
      'play.resign': 'Resign',
      'play.confirmResign': 'Resign the game? The opponent will win.',
      'play.aiMove': 'AI Move',
      'play.aiMoveOffline': 'AI Move (offline)',
      'play.showStoneIndices': 'Show Stone Indices',
      'play.hideStoneIndices': 'Hide Stone Indices',
      'play.score': 'Score (Tromp-Taylor)',
      'play.neutral': 'Neutral',
      'play.komi': 'White (+{komi})',
      'play.saveGame': 'Save Game',
      'play.loadGame': 'Load Game',
      'play.loadGameReview': 'Load Game Review',
      'play.placeStoneTip': 'Click a point to place stones. [Ctrl+Z] undo.',
      'play.placeStone': 'Place Stone ✓',
      'play.gameEnded': 'Game ended. Mark dead stones.',
      'play.markDead': 'Click stones to mark dead.',
      'play.finishMarking': 'Finish Marking',
      'play.yourTurn': 'YOUR TURN ({color})',
      'play.opponentTurn': 'Waiting for opponent…',
      'play.waitingFinish': 'Waiting for opponent to finish marking…',
      'play.timeoutLoss': 'Out of time',
      'play.byoyomiLeft': '{n} period(s)',
      'play.blackWins': '🏆 BLACK wins by {diff} points!',
      'play.whiteWins': '🏆 WHITE wins by {diff} points!',
      'play.tie': 'TIE GAME!',
      'play.savedAs': 'Saved {name}',
      'play.gameLoaded': 'Game loaded',
      'play.gobanLoaded': 'Goban loaded',
      'play.notAGameFile': 'Not a game file',
      'play.loadFailed': 'Load failed',
      'play.undoStatus': 'Undo: {idx}/{total}',

      // ---- Preset menu ----
      'preset.title': 'Choose a Preset Goban',
      'preset.back': 'Back to Room Menu',
      'starDomination.title': 'Star Domination — Choose Sphere Size',
      'starDomination.small': 'Small (~162 points)',
      'starDomination.medium': 'Medium (~362 points)',
      'starDomination.large': 'Large (~642 points)',

      // ---- Game review modal ----
      'review.title': 'Game Review – Inspection',
      'review.close': 'Close',
      'review.available': 'Available Games',
      'review.loadingGames': 'Loading games…',
      'review.details': 'Game Details',
      'review.selectToView': 'Select a game to view details',
      'review.selectToLoad': 'Select game to load and view on board',
      'review.first': '⏮ First',
      'review.prev': '◀ Prev',
      'review.play': '▶ Play',
      'review.pause': '⏸ Pause',
      'review.next': '▶ Next',
      'review.last': '⏭ Last',
      'review.move': 'Move: {idx}/{total}',
      'review.speed': 'Speed:',
      'review.speedDisplay': '{seconds}s/move',
      'review.selectAbove': 'Select a game above to load it',

      // ---- Game rules modal ----
      'rules.title': 'Game Rules',
      'rules.komi': "Komi — White's compensation points",
      'rules.colorMode': 'Color Assignment',
      'rules.ownerBlack': 'You (owner) = ⚫ Black · Opponent = ⚪ White',
      'rules.ownerWhite': 'You (owner) = ⚪ White · Opponent = ⚫ Black',
      'rules.randomColor': 'Random — server picks colors fairly',
      'rules.study': 'Study / Review — both players can move either color',
      'rules.start': 'Start Game',
      'rules.sendInvite': 'Send Invitation',
      'rules.invitePlayer': 'Invite player',
      'rules.invitePlayerHint': "Pick a player in this room. They'll get a confirmation prompt before the game starts.",
      'rules.noOtherPlayers': 'No other players in this room yet.',

      // ---- Challenge / invitation flow (item 4) ----
      'challenge.message': '{from} invites you to play in "{roomName}". Komi {komi}, {colorMode}. Accept?',
      'challenge.accept': 'Accept',
      'challenge.decline': 'Decline',
      'challenge.waitingFor': 'Waiting for {name} to accept…',
      'challenge.declinedBy': '{name} declined the invitation.',

      // ---- Game-end modal (item 8) ----
      'gameEnd.title': 'Game Over',
      'gameEnd.titleTie': "It's a Tie",
      'gameEnd.tieBody': 'Both sides scored the same. Well played!',
      'gameEnd.byPoints': '{name} wins by {diff} points!',
      'gameEnd.byTimeout': '{name} wins — opponent ran out of time.',
      'gameEnd.byResignation': '{name} wins by resignation.',
      'gameEnd.dismiss': 'Dismiss',
      'gameEnd.markingWaiting': 'Waiting for opponent to confirm…',
      'gameEnd.markingDone': 'Both players ready.',

      // ---- Misc alerts ----
      'alert.relaxOnlyQuads': 'Relaxation only available when all faces are quads (no triangles).',
      'alert.noTriangles': 'No triangles to remove.',
      'alert.presetNotFound': 'Preset "{name}" not found',
      'alert.presetLoadError': 'Error loading preset: {message}',
      'alert.settingsComingSoon': 'Settings — coming soon',
      'alert.autoRemoveFail': 'Failed to achieve full quads after {n} attempts. Reverting.',
    },

    zh: {
      'nav.createRoom': '建立對局室',
      'nav.login': '登入',
      'nav.signup': '註冊',
      'nav.logout': '登出',
      'nav.guest': '訪客',
      'lang.label': '語言',

      'auth.welcomeBack': '歡迎回來',
      'auth.createAccount': '建立帳號',
      'auth.tabLogin': '登入',
      'auth.tabSignup': '註冊',
      'auth.username': '使用者名稱',
      'auth.email': '電子郵件',
      'auth.usernameOrEmail': '使用者名稱或電子郵件',
      'auth.password': '密碼',
      'auth.continue': '繼續',
      'auth.forgotPassword': '忘記密碼？',
      'auth.working': '處理中…',
      'auth.networkError': '網路錯誤。',
      'auth.close': '關閉',

      'forgot.title': '重設密碼',
      'forgot.body': '請輸入帳號的電子郵件，我們將寄送重設連結。',
      'forgot.send': '寄送重設連結',
      'forgot.enterEmail': '請輸入電子郵件。',
      'forgot.sending': '寄送中…',
      'forgot.sentMaybe': '若此信箱已註冊，重設連結已寄出。請查收信箱。',
      'forgot.networkError': '網路錯誤,請再試一次。',

      'reset.title': '設定新密碼',
      'reset.label': '新密碼',
      'reset.save': '儲存新密碼',
      'reset.tooShort': '密碼至少需 6 個字元。',
      'reset.saving': '儲存中…',
      'reset.success': '密碼已更新,可重新登入。',

      'createRoom.title': '建立對局室',
      'createRoom.body': '為對局室取個名字,對手在大廳即可看到。你將是房主——對手加入後,即可選棋盤並開始對局。',
      'createRoom.label': '對局室名稱',
      'createRoom.placeholder': '例如:週五圍棋夜',
      'createRoom.placeholderUser': '例如:{name} 的對局室',
      'createRoom.hint': '最多 40 字。留白將以你的使用者名稱命名。',
      'createRoom.cancel': '取消',
      'createRoom.submit': '建立對局室',

      'records.title': '已儲存的對局記錄',
      'records.loading': '載入中…',
      'records.failed': '載入失敗。',
      'records.load': '載入',
      'records.loginRequiredLoad': '需登入才能載入對局記錄。',
      'records.empty': '找不到記錄。',
      'records.searchPlaceholder': '依名稱或玩家搜尋…',
      'records.filter.mine': '我的記錄',
      'records.filter.all': '全部',

      'invite.title': '對局邀請',
      'invite.message': '{from} 邀請你加入「{roomName}」。要立即加入嗎?',
      'invite.decline': '拒絕',
      'invite.accept': '加入',

      'lobby.globalChat': '大廳聊天',
      'lobby.connected': '已連線',
      'lobby.offline': '離線',
      'lobby.sayHello': '在大廳打個招呼吧',
      'lobby.send': '送出',
      'lobby.onlinePlayers': '線上玩家',
      'lobby.privateMessage': '私訊',
      'lobby.message': '訊息',
      'lobby.gameRooms': '對局室列表',
      'lobby.selectUser': '選擇玩家',
      'lobby.invitePlayer': '邀請玩家',
      'lobby.guestSuffix': '(訪客)',
      'lobby.join': '加入',

      'room.label': '對局室',
      'room.spectator': '觀戰者',
      'room.black': '黑',
      'room.white': '白',
      'room.players': '{count} 位玩家',
      'room.invite': '邀請',
      'room.leave': '離開對局室',
      'room.backToMenu': '← 對局室選單',
      'room.waiting1': '等待房主設定對局…',
      'room.waiting2': '對局開始後棋盤將自動同步。',
      'room.menu.random': '隨機棋盤',
      'room.menu.preset': '預設棋盤',
      'room.menu.starDomination': '星球制霸 (3D)',
      'room.menu.design': '設計自己的棋盤',
      'room.menu.load': '載入棋盤',
      'room.menu.review': '觀看對局記錄',
      'room.menu.settings': '設定',
      'goban.modal.loadTitle': '載入棋盤',
      'goban.modal.saveTitle': '儲存棋盤',
      'goban.modal.namePlaceholder': '棋盤名稱',
      'goban.modal.searchPlaceholder': '依名稱或作者搜尋…',
      'goban.modal.save': '儲存',
      'goban.modal.saved': '已儲存。',
      'goban.modal.empty': '找不到棋盤。',
      'goban.filter.official': '官方棋盤',
      'goban.filter.mine': '我的棋盤',
      'goban.filter.all': '全部',
      'room.chat': '對局室聊天',
      'room.chatPlaceholder': '在此對局室留言…',
      'room.placeholder.title': '請從對局室選單選擇模式',
      'room.placeholder.subtitle': '選定棋盤後,所有人將同步看到對局。',

      'random.title': '隨機棋盤',
      'random.generating': '產生棋盤中…',
      'random.generated': '棋盤已產生!',
      'random.generateAnother': '再產生一個',
      'random.acceptPlay': '採用並開始對局',

      'editor.title': '編輯模式',
      'editor.moveVertex': '移動點 [v]',
      'editor.deleteEdge': '刪除邊 [e]',
      'editor.select': '選取 [s]',
      'editor.gobanSize': '棋盤大小',
      'editor.mode': '模式',
      'editor.hover': '滑鼠停留',
      'editor.none': '無',
      'editor.vertices': '頂點',
      'editor.tris': '三角形',
      'editor.quads': '四邊形',
      'editor.undo': '復原 [Ctrl+Z]',
      'editor.redo': '重做 [Ctrl+Shift+Z]',
      'editor.autoRemove': '自動移除邊',
      'editor.relax': '鬆弛 [r/R]',
      'editor.relaxTest': '鬆弛 (測試)',
      'editor.relaxCoulomb': '鬆弛 (庫侖力)',
      'editor.saveGoban': '儲存棋盤',
      'editor.loadGoban': '載入棋盤',
      'editor.playGo': '開始對局 [p/P]',

      'play.title': '對局模式',
      'play.turn': '輪到',
      'play.captured': '提子',
      'play.undoMove': '悔棋',
      'play.redoMove': '重下',
      'play.pass': '虛手 (Pass)',
      'play.resign': '認輸',
      'play.confirmResign': '確定要認輸嗎?對手將獲勝。',
      'play.aiMove': 'AI 下一手',
      'play.aiMoveOffline': 'AI 下一手 (離線)',
      'play.showStoneIndices': '顯示落子順序',
      'play.hideStoneIndices': '隱藏落子順序',
      'play.score': '計算勝負 (Tromp-Taylor)',
      'play.neutral': '單官',
      'play.komi': '白 (+{komi} 貼目)',
      'play.saveGame': '儲存對局',
      'play.loadGame': '載入對局',
      'play.loadGameReview': '載入對局回顧',
      'play.placeStoneTip': '點擊交點落子。[Ctrl+Z] 可悔棋。',
      'play.placeStone': '落子 ✓',
      'play.gameEnded': '對局結束,請標記死子。',
      'play.markDead': '點擊棋子標記為死子。',
      'play.finishMarking': '完成標記',
      'play.yourTurn': '輪到你 ({color})',
      'play.opponentTurn': '等待對手落子…',
      'play.waitingFinish': '等待對手完成死子標記…',
      'play.timeoutLoss': '超時',
      'play.byoyomiLeft': '剩 {n} 次讀秒',
      'play.blackWins': '🏆 黑勝 {diff} 目!',
      'play.whiteWins': '🏆 白勝 {diff} 目!',
      'play.tie': '和棋!',
      'play.savedAs': '已儲存 {name}',
      'play.gameLoaded': '對局已載入',
      'play.gobanLoaded': '棋盤已載入',
      'play.notAGameFile': '非對局檔案',
      'play.loadFailed': '載入失敗',
      'play.undoStatus': '復原: {idx}/{total}',

      'preset.title': '選擇預設棋盤',
      'preset.back': '回到對局室選單',
      'starDomination.title': '星球制霸 — 選擇球面大小',
      'starDomination.small': '小 (約 162 個點)',
      'starDomination.medium': '中 (約 362 個點)',
      'starDomination.large': '大 (約 642 個點)',

      'review.title': '對局回顧 — 檢視',
      'review.close': '關閉',
      'review.available': '可用對局',
      'review.loadingGames': '載入對局中…',
      'review.details': '對局詳情',
      'review.selectToView': '選擇對局以檢視詳情',
      'review.selectToLoad': '選擇對局以載入到棋盤',
      'review.first': '⏮ 開頭',
      'review.prev': '◀ 上一手',
      'review.play': '▶ 播放',
      'review.pause': '⏸ 暫停',
      'review.next': '▶ 下一手',
      'review.last': '⏭ 結尾',
      'review.move': '手數: {idx}/{total}',
      'review.speed': '速度:',
      'review.speedDisplay': '{seconds} 秒/手',
      'review.selectAbove': '請從上方選擇對局以載入',

      'rules.title': '對局規則',
      'rules.komi': '貼目 — 白方補償點數',
      'rules.colorMode': '執子分配',
      'rules.ownerBlack': '你(房主)= ⚫ 黑 · 對手 = ⚪ 白',
      'rules.ownerWhite': '你(房主)= ⚪ 白 · 對手 = ⚫ 黑',
      'rules.randomColor': '隨機 — 由系統公平指派',
      'rules.study': '研究 / 覆盤 — 雙方皆可下任一色',
      'rules.start': '開始對局',
      'rules.sendInvite': '發送邀請',
      'rules.invitePlayer': '邀請對手',
      'rules.invitePlayerHint': '請從房內玩家中挑選一位,對方接受後才會開始對局。',
      'rules.noOtherPlayers': '此對局室目前沒有其他玩家。',

      'challenge.message': '{from} 邀請你在「{roomName}」中對局。貼目 {komi},{colorMode}。是否接受?',
      'challenge.accept': '接受',
      'challenge.decline': '拒絕',
      'challenge.waitingFor': '正在等待 {name} 接受邀請…',
      'challenge.declinedBy': '{name} 已拒絕邀請。',

      'gameEnd.title': '對局結束',
      'gameEnd.titleTie': '雙方持碁',
      'gameEnd.tieBody': '雙方目數相同,精彩對局!',
      'gameEnd.byPoints': '{name} 勝 {diff} 目!',
      'gameEnd.byTimeout': '{name} 勝 — 對手超時。',
      'gameEnd.byResignation': '{name} 中盤勝(對手認輸)。',
      'gameEnd.dismiss': '關閉',
      'gameEnd.markingWaiting': '等待對手確認…',
      'gameEnd.markingDone': '雙方皆已確認。',

      'alert.relaxOnlyQuads': '僅當所有面皆為四邊形(無三角形)時才能執行鬆弛。',
      'alert.noTriangles': '沒有三角形可移除。',
      'alert.presetNotFound': '找不到預設棋盤「{name}」',
      'alert.presetLoadError': '載入預設棋盤失敗:{message}',
      'alert.settingsComingSoon': '設定 — 即將推出',
      'alert.autoRemoveFail': '嘗試 {n} 次仍未能形成全四邊形,已還原。',
    },

    ja: {
      'nav.createRoom': '対局ルームを作成',
      'nav.login': 'ログイン',
      'nav.signup': '新規登録',
      'nav.logout': 'ログアウト',
      'nav.guest': 'ゲスト',
      'lang.label': '言語',

      'auth.welcomeBack': 'おかえりなさい',
      'auth.createAccount': 'アカウントを作成',
      'auth.tabLogin': 'ログイン',
      'auth.tabSignup': '新規登録',
      'auth.username': 'ユーザー名',
      'auth.email': 'メールアドレス',
      'auth.usernameOrEmail': 'ユーザー名 または メール',
      'auth.password': 'パスワード',
      'auth.continue': '続行',
      'auth.forgotPassword': 'パスワードをお忘れですか?',
      'auth.working': '処理中…',
      'auth.networkError': 'ネットワークエラー。',
      'auth.close': '閉じる',

      'forgot.title': 'パスワードをリセット',
      'forgot.body': 'アカウントのメールアドレスを入力してください。リセット用のリンクをお送りします。',
      'forgot.send': 'リセットリンクを送る',
      'forgot.enterEmail': 'メールアドレスを入力してください。',
      'forgot.sending': '送信中…',
      'forgot.sentMaybe': 'そのメールアドレスが登録されていれば、リセットリンクを送信しました。受信箱をご確認ください。',
      'forgot.networkError': 'ネットワークエラー。再試行してください。',

      'reset.title': '新しいパスワードを設定',
      'reset.label': '新しいパスワード',
      'reset.save': '新しいパスワードを保存',
      'reset.tooShort': 'パスワードは 6 文字以上必要です。',
      'reset.saving': '保存中…',
      'reset.success': 'パスワードを更新しました。ログインできます。',

      'createRoom.title': '対局ルームを作成',
      'createRoom.body': '対戦相手にロビーで表示される名前を選んでください。あなたがホストになります — 相手が参加したら、碁盤を選んで対局を開始できます。',
      'createRoom.label': 'ルーム名',
      'createRoom.placeholder': '例: 金曜夜の碁',
      'createRoom.placeholderUser': '例: {name} のルーム',
      'createRoom.hint': '40 文字まで。空欄ならユーザー名が使われます。',
      'createRoom.cancel': 'キャンセル',
      'createRoom.submit': 'ルームを作成',

      'records.title': '保存された棋譜',
      'records.loading': '読み込み中…',
      'records.failed': '読み込みに失敗しました。',
      'records.load': '読み込む',
      'records.loginRequiredLoad': '棋譜を読み込むにはログインが必要です。',
      'records.empty': '棋譜が見つかりません。',
      'records.searchPlaceholder': '名前またはプレイヤーで検索…',
      'records.filter.mine': '自分の棋譜',
      'records.filter.all': 'すべて',

      'invite.title': '対局への招待',
      'invite.message': '{from} さんが「{roomName}」への参加を招待しています。今すぐ参加しますか?',
      'invite.decline': '辞退',
      'invite.accept': '参加',

      'lobby.globalChat': '全体チャット',
      'lobby.connected': '接続中',
      'lobby.offline': 'オフライン',
      'lobby.sayHello': 'ロビーに挨拶しよう',
      'lobby.send': '送信',
      'lobby.onlinePlayers': 'オンラインプレイヤー',
      'lobby.privateMessage': 'プライベートメッセージ',
      'lobby.message': 'メッセージ',
      'lobby.gameRooms': '対局ルーム',
      'lobby.selectUser': 'ユーザーを選択',
      'lobby.invitePlayer': 'プレイヤーを招待',
      'lobby.guestSuffix': '(ゲスト)',
      'lobby.join': '参加',

      'room.label': 'ルーム',
      'room.spectator': '観戦者',
      'room.black': '黒',
      'room.white': '白',
      'room.players': '{count} 人',
      'room.invite': '招待',
      'room.leave': 'ルームを退出',
      'room.backToMenu': '← ルームメニュー',
      'room.waiting1': 'ホストが対局を準備するのを待っています。',
      'room.waiting2': '開始されると碁盤が自動的に同期されます。',
      'room.menu.random': 'ランダム碁盤',
      'room.menu.preset': 'プリセット碁盤',
      'room.menu.starDomination': '星球制覇 (3D)',
      'room.menu.design': '碁盤を自作する',
      'room.menu.load': '碁盤を読み込む',
      'room.menu.review': '棋譜を見る',
      'room.menu.settings': '設定',
      'goban.modal.loadTitle': '碁盤を読み込む',
      'goban.modal.saveTitle': '碁盤を保存',
      'goban.modal.namePlaceholder': '碁盤名',
      'goban.modal.searchPlaceholder': '名前または作者で検索…',
      'goban.modal.save': '保存',
      'goban.modal.saved': '保存しました。',
      'goban.modal.empty': '碁盤が見つかりません。',
      'goban.filter.official': '公式碁盤',
      'goban.filter.mine': '自分の碁盤',
      'goban.filter.all': 'すべて',
      'room.chat': 'ルームチャット',
      'room.chatPlaceholder': 'ルームにメッセージ…',
      'room.placeholder.title': 'メニューからモードを選択してください',
      'room.placeholder.subtitle': '碁盤が選ばれると、ルームの全員に手が同期されます。',

      'random.title': 'ランダム碁盤',
      'random.generating': '碁盤を生成中…',
      'random.generated': '碁盤を生成しました!',
      'random.generateAnother': 'もう一度生成',
      'random.acceptPlay': '採用して対局',

      'editor.title': 'エディタモード',
      'editor.moveVertex': '頂点を移動 [v]',
      'editor.deleteEdge': '辺を削除 [e]',
      'editor.select': '選択 [s]',
      'editor.gobanSize': '碁盤サイズ',
      'editor.mode': 'モード',
      'editor.hover': 'ホバー',
      'editor.none': 'なし',
      'editor.vertices': '頂点',
      'editor.tris': '三角形',
      'editor.quads': '四角形',
      'editor.undo': '元に戻す [Ctrl+Z]',
      'editor.redo': 'やり直す [Ctrl+Shift+Z]',
      'editor.autoRemove': '辺を自動削除',
      'editor.relax': '緩和 [r/R]',
      'editor.relaxTest': '緩和 (テスト)',
      'editor.relaxCoulomb': '緩和 (クーロン力)',
      'editor.saveGoban': '碁盤を保存',
      'editor.loadGoban': '碁盤を読み込む',
      'editor.playGo': '対局を開始 [p/P]',

      'play.title': '対局モード',
      'play.turn': '手番',
      'play.captured': 'アゲハマ',
      'play.undoMove': '一手戻す',
      'play.redoMove': '一手進める',
      'play.pass': 'パス',
      'play.resign': '投了',
      'play.confirmResign': '投了しますか?相手の勝ちになります。',
      'play.aiMove': 'AI が打つ',
      'play.aiMoveOffline': 'AI が打つ (オフライン)',
      'play.showStoneIndices': '着手番号を表示',
      'play.hideStoneIndices': '着手番号を隠す',
      'play.score': '形勢判定 (Tromp-Taylor)',
      'play.neutral': 'ダメ',
      'play.komi': '白 (+コミ {komi})',
      'play.saveGame': '対局を保存',
      'play.loadGame': '対局を読み込む',
      'play.loadGameReview': '棋譜を読み込む',
      'play.placeStoneTip': '交点をクリックして着手。[Ctrl+Z] で一手戻る。',
      'play.placeStone': '着手 ✓',
      'play.gameEnded': '対局終了。死石を指定してください。',
      'play.markDead': '石をクリックして死石を指定。',
      'play.finishMarking': '指定を終了',
      'play.yourTurn': 'あなたの番 ({color})',
      'play.opponentTurn': '相手の手番を待っています…',
      'play.waitingFinish': '相手の死石指定を待っています…',
      'play.timeoutLoss': '時間切れ',
      'play.byoyomiLeft': '秒読み 残り {n}',
      'play.blackWins': '🏆 黒の {diff} 目勝ち!',
      'play.whiteWins': '🏆 白の {diff} 目勝ち!',
      'play.tie': '持碁!',
      'play.savedAs': '{name} を保存しました',
      'play.gameLoaded': '対局を読み込みました',
      'play.gobanLoaded': '碁盤を読み込みました',
      'play.notAGameFile': '対局ファイルではありません',
      'play.loadFailed': '読み込み失敗',
      'play.undoStatus': '戻り: {idx}/{total}',

      'preset.title': 'プリセット碁盤を選択',
      'preset.back': 'ルームメニューへ戻る',
      'starDomination.title': '星球制覇 — 球面のサイズを選択',
      'starDomination.small': '小 (約 162 点)',
      'starDomination.medium': '中 (約 362 点)',
      'starDomination.large': '大 (約 642 点)',

      'review.title': '棋譜検討 — 閲覧',
      'review.close': '閉じる',
      'review.available': '利用可能な対局',
      'review.loadingGames': '対局を読み込み中…',
      'review.details': '対局詳細',
      'review.selectToView': '詳細を見るには対局を選択',
      'review.selectToLoad': '碁盤に表示する対局を選択',
      'review.first': '⏮ 最初',
      'review.prev': '◀ 前へ',
      'review.play': '▶ 再生',
      'review.pause': '⏸ 一時停止',
      'review.next': '▶ 次へ',
      'review.last': '⏭ 最後',
      'review.move': '手数: {idx}/{total}',
      'review.speed': '速度:',
      'review.speedDisplay': '{seconds} 秒/手',
      'review.selectAbove': '上の一覧から対局を選択してください',

      'rules.title': '対局ルール',
      'rules.komi': 'コミ — 白の補償点',
      'rules.colorMode': '色の割り当て',
      'rules.ownerBlack': 'あなた(ホスト)= ⚫ 黒 · 相手 = ⚪ 白',
      'rules.ownerWhite': 'あなた(ホスト)= ⚪ 白 · 相手 = ⚫ 黒',
      'rules.randomColor': 'ランダム — サーバが公平に決定',
      'rules.study': '検討 — 両者がどちらの色も打てます',
      'rules.start': '対局開始',
      'rules.sendInvite': '招待を送る',
      'rules.invitePlayer': '相手を招待',
      'rules.invitePlayerHint': 'ルーム内のプレイヤーから一人選んでください。承諾後に対局が始まります。',
      'rules.noOtherPlayers': 'このルームに他のプレイヤーがいません。',

      'challenge.message': '{from} さんが「{roomName}」での対局に招待しています。コミ {komi}、{colorMode}。承諾しますか?',
      'challenge.accept': '承諾',
      'challenge.decline': '辞退',
      'challenge.waitingFor': '{name} さんの承諾を待っています…',
      'challenge.declinedBy': '{name} さんに招待を辞退されました。',

      'gameEnd.title': '対局終了',
      'gameEnd.titleTie': '持碁',
      'gameEnd.tieBody': '両者同点。素晴らしい対局でした!',
      'gameEnd.byPoints': '{name} の {diff} 目勝ち!',
      'gameEnd.byTimeout': '{name} の勝ち — 相手の時間切れ。',
      'gameEnd.byResignation': '{name} の中押し勝ち(相手投了)。',
      'gameEnd.dismiss': '閉じる',
      'gameEnd.markingWaiting': '相手の確認を待っています…',
      'gameEnd.markingDone': '両者確認済み。',

      'alert.relaxOnlyQuads': '緩和は全ての面が四角形(三角形なし)のときのみ可能です。',
      'alert.noTriangles': '削除できる三角形がありません。',
      'alert.presetNotFound': 'プリセット「{name}」が見つかりません',
      'alert.presetLoadError': 'プリセットの読み込みに失敗: {message}',
      'alert.settingsComingSoon': '設定 — 近日公開',
      'alert.autoRemoveFail': '{n} 回試みても完全な四角化に失敗しました。元に戻します。',
    },

    ko: {
      'nav.createRoom': '대국방 만들기',
      'nav.login': '로그인',
      'nav.signup': '회원가입',
      'nav.logout': '로그아웃',
      'nav.guest': '게스트',
      'lang.label': '언어',

      'auth.welcomeBack': '다시 오신 것을 환영합니다',
      'auth.createAccount': '계정 만들기',
      'auth.tabLogin': '로그인',
      'auth.tabSignup': '회원가입',
      'auth.username': '사용자 이름',
      'auth.email': '이메일',
      'auth.usernameOrEmail': '사용자 이름 또는 이메일',
      'auth.password': '비밀번호',
      'auth.continue': '계속',
      'auth.forgotPassword': '비밀번호를 잊으셨나요?',
      'auth.working': '처리 중…',
      'auth.networkError': '네트워크 오류.',
      'auth.close': '닫기',

      'forgot.title': '비밀번호 재설정',
      'forgot.body': '계정에 등록된 이메일을 입력하시면 재설정 링크를 보내드립니다.',
      'forgot.send': '재설정 링크 보내기',
      'forgot.enterEmail': '이메일을 입력해 주세요.',
      'forgot.sending': '보내는 중…',
      'forgot.sentMaybe': '해당 이메일이 등록되어 있다면 재설정 링크를 보냈습니다. 받은편지함을 확인하세요.',
      'forgot.networkError': '네트워크 오류. 다시 시도해 주세요.',

      'reset.title': '새 비밀번호 설정',
      'reset.label': '새 비밀번호',
      'reset.save': '새 비밀번호 저장',
      'reset.tooShort': '비밀번호는 6자 이상이어야 합니다.',
      'reset.saving': '저장 중…',
      'reset.success': '비밀번호가 변경되었습니다. 로그인해 주세요.',

      'createRoom.title': '대국방 만들기',
      'createRoom.body': '로비에서 상대가 보게 될 방 이름을 정하세요. 당신이 방장이 됩니다 — 상대가 입장하면 바둑판을 골라 대국을 시작할 수 있습니다.',
      'createRoom.label': '방 이름',
      'createRoom.placeholder': '예: 금요일 밤 바둑',
      'createRoom.placeholderUser': '예: {name} 의 방',
      'createRoom.hint': '최대 40자. 비워두면 사용자 이름이 사용됩니다.',
      'createRoom.cancel': '취소',
      'createRoom.submit': '방 만들기',

      'records.title': '저장된 기보',
      'records.loading': '불러오는 중…',
      'records.failed': '불러오기 실패.',
      'records.load': '불러오기',
      'records.loginRequiredLoad': '기보를 불러오려면 로그인이 필요합니다.',
      'records.empty': '기보가 없습니다.',
      'records.searchPlaceholder': '이름 또는 플레이어로 검색…',
      'records.filter.mine': '내 기보',
      'records.filter.all': '전체',

      'invite.title': '대국 초대',
      'invite.message': '{from} 님이 "{roomName}" 방에 초대했습니다. 지금 참여하시겠습니까?',
      'invite.decline': '거절',
      'invite.accept': '참여',

      'lobby.globalChat': '전체 채팅',
      'lobby.connected': '연결됨',
      'lobby.offline': '오프라인',
      'lobby.sayHello': '로비에 인사해 보세요',
      'lobby.send': '보내기',
      'lobby.onlinePlayers': '접속 중인 플레이어',
      'lobby.privateMessage': '귓속말',
      'lobby.message': '메시지',
      'lobby.gameRooms': '대국방 목록',
      'lobby.selectUser': '사용자 선택',
      'lobby.invitePlayer': '플레이어 초대',
      'lobby.guestSuffix': '(게스트)',
      'lobby.join': '참여',

      'room.label': '방',
      'room.spectator': '관전자',
      'room.black': '흑',
      'room.white': '백',
      'room.players': '플레이어 {count}명',
      'room.invite': '초대',
      'room.leave': '방 나가기',
      'room.backToMenu': '← 방 메뉴',
      'room.waiting1': '방장이 대국을 준비하기를 기다리는 중입니다.',
      'room.waiting2': '시작되면 바둑판이 자동으로 동기화됩니다.',
      'room.menu.random': '무작위 바둑판',
      'room.menu.preset': '프리셋 바둑판',
      'room.menu.starDomination': '행성 제패 (3D)',
      'room.menu.design': '바둑판 직접 설계',
      'room.menu.load': '바둑판 불러오기',
      'room.menu.review': '기보 보기',
      'room.menu.settings': '설정',
      'goban.modal.loadTitle': '바둑판 불러오기',
      'goban.modal.saveTitle': '바둑판 저장',
      'goban.modal.namePlaceholder': '바둑판 이름',
      'goban.modal.searchPlaceholder': '이름 또는 만든이로 검색…',
      'goban.modal.save': '저장',
      'goban.modal.saved': '저장됨.',
      'goban.modal.empty': '바둑판이 없습니다.',
      'goban.filter.official': '공식 바둑판',
      'goban.filter.mine': '내 바둑판',
      'goban.filter.all': '전체',
      'room.chat': '방 채팅',
      'room.chatPlaceholder': '방에 메시지…',
      'room.placeholder.title': '방 메뉴에서 모드를 선택하세요',
      'room.placeholder.subtitle': '바둑판이 선택되면 모든 참여자에게 동기화됩니다.',

      'random.title': '무작위 바둑판',
      'random.generating': '바둑판 생성 중…',
      'random.generated': '바둑판 생성 완료!',
      'random.generateAnother': '다시 생성',
      'random.acceptPlay': '채택하고 대국',

      'editor.title': '편집 모드',
      'editor.moveVertex': '꼭짓점 이동 [v]',
      'editor.deleteEdge': '변 삭제 [e]',
      'editor.select': '선택 [s]',
      'editor.gobanSize': '바둑판 크기',
      'editor.mode': '모드',
      'editor.hover': '커서 위치',
      'editor.none': '없음',
      'editor.vertices': '꼭짓점',
      'editor.tris': '삼각형',
      'editor.quads': '사각형',
      'editor.undo': '실행취소 [Ctrl+Z]',
      'editor.redo': '다시실행 [Ctrl+Shift+Z]',
      'editor.autoRemove': '변 자동 제거',
      'editor.relax': '완화 [r/R]',
      'editor.relaxTest': '완화 (테스트)',
      'editor.relaxCoulomb': '완화 (쿨롱 힘)',
      'editor.saveGoban': '바둑판 저장',
      'editor.loadGoban': '바둑판 불러오기',
      'editor.playGo': '대국 시작 [p/P]',

      'play.title': '대국 모드',
      'play.turn': '차례',
      'play.captured': '잡힌 돌',
      'play.undoMove': '한 수 무르기',
      'play.redoMove': '한 수 다시',
      'play.pass': '패스',
      'play.resign': '기권',
      'play.confirmResign': '기권하시겠습니까? 상대가 승리합니다.',
      'play.aiMove': 'AI 한 수',
      'play.aiMoveOffline': 'AI 한 수 (오프라인)',
      'play.showStoneIndices': '착수 순서 표시',
      'play.hideStoneIndices': '착수 순서 숨기기',
      'play.score': '계가 (Tromp-Taylor)',
      'play.neutral': '공배',
      'play.komi': '백 (+덤 {komi})',
      'play.saveGame': '대국 저장',
      'play.loadGame': '대국 불러오기',
      'play.loadGameReview': '기보 불러오기',
      'play.placeStoneTip': '교차점을 클릭해 착수. [Ctrl+Z] 무르기.',
      'play.placeStone': '착수 ✓',
      'play.gameEnded': '대국 종료. 사석을 표시하세요.',
      'play.markDead': '돌을 클릭해 사석으로 표시.',
      'play.finishMarking': '표시 완료',
      'play.yourTurn': '내 차례 ({color})',
      'play.opponentTurn': '상대 차례 대기 중…',
      'play.waitingFinish': '상대의 사석 표시 대기 중…',
      'play.timeoutLoss': '시간초과',
      'play.byoyomiLeft': '초읽기 {n}회 남음',
      'play.blackWins': '🏆 흑 {diff}집 승!',
      'play.whiteWins': '🏆 백 {diff}집 승!',
      'play.tie': '무승부!',
      'play.savedAs': '{name} 저장됨',
      'play.gameLoaded': '대국 불러옴',
      'play.gobanLoaded': '바둑판 불러옴',
      'play.notAGameFile': '대국 파일이 아닙니다',
      'play.loadFailed': '불러오기 실패',
      'play.undoStatus': '무르기: {idx}/{total}',

      'preset.title': '프리셋 바둑판 선택',
      'preset.back': '방 메뉴로 돌아가기',
      'starDomination.title': '행성 제패 — 구면 크기 선택',
      'starDomination.small': '소 (약 162점)',
      'starDomination.medium': '중 (약 362점)',
      'starDomination.large': '대 (약 642점)',

      'review.title': '기보 검토',
      'review.close': '닫기',
      'review.available': '사용 가능한 대국',
      'review.loadingGames': '대국 불러오는 중…',
      'review.details': '대국 정보',
      'review.selectToView': '대국을 선택해 정보를 확인하세요',
      'review.selectToLoad': '바둑판에 표시할 대국을 선택',
      'review.first': '⏮ 처음',
      'review.prev': '◀ 이전',
      'review.play': '▶ 재생',
      'review.pause': '⏸ 일시정지',
      'review.next': '▶ 다음',
      'review.last': '⏭ 마지막',
      'review.move': '수: {idx}/{total}',
      'review.speed': '속도:',
      'review.speedDisplay': '{seconds}초/수',
      'review.selectAbove': '위에서 대국을 선택해 불러오세요',

      'rules.title': '대국 규칙',
      'rules.komi': '덤 — 백의 보상점',
      'rules.colorMode': '색 배정',
      'rules.ownerBlack': '나 (방장) = ⚫ 흑 · 상대 = ⚪ 백',
      'rules.ownerWhite': '나 (방장) = ⚪ 백 · 상대 = ⚫ 흑',
      'rules.randomColor': '무작위 — 서버가 공정하게 배정',
      'rules.study': '연구 / 복기 — 양쪽 모두 어느 색이든 둘 수 있음',
      'rules.start': '대국 시작',
      'rules.sendInvite': '초대 보내기',
      'rules.invitePlayer': '상대 초대',
      'rules.invitePlayerHint': '방 안의 플레이어 한 명을 선택하세요. 수락하면 대국이 시작됩니다.',
      'rules.noOtherPlayers': '이 방에 다른 플레이어가 없습니다.',

      'challenge.message': '{from} 님이 "{roomName}" 방의 대국에 초대했습니다. 덤 {komi}, {colorMode}. 수락하시겠습니까?',
      'challenge.accept': '수락',
      'challenge.decline': '거절',
      'challenge.waitingFor': '{name} 님의 수락을 기다리는 중…',
      'challenge.declinedBy': '{name} 님이 초대를 거절했습니다.',

      'gameEnd.title': '대국 종료',
      'gameEnd.titleTie': '무승부',
      'gameEnd.tieBody': '양쪽 점수가 같습니다. 좋은 대국이었습니다!',
      'gameEnd.byPoints': '{name} {diff}집 승!',
      'gameEnd.byTimeout': '{name} 승 — 상대 시간 초과.',
      'gameEnd.byResignation': '{name} 불계승(상대 기권).',
      'gameEnd.dismiss': '닫기',
      'gameEnd.markingWaiting': '상대 확인 대기 중…',
      'gameEnd.markingDone': '양쪽 확인 완료.',

      'alert.relaxOnlyQuads': '모든 면이 사각형(삼각형 없음)일 때만 완화가 가능합니다.',
      'alert.noTriangles': '제거할 삼각형이 없습니다.',
      'alert.presetNotFound': '프리셋 "{name}"을(를) 찾을 수 없습니다',
      'alert.presetLoadError': '프리셋 불러오기 실패: {message}',
      'alert.settingsComingSoon': '설정 — 곧 제공 예정',
      'alert.autoRemoveFail': '{n}회 시도 후에도 사각화에 실패했습니다. 되돌립니다.',
    },
  };

  function format(s, params) {
    if (!params) return s;
    return s.replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? params[k] : `{${k}}`));
  }

  function detectSystemLang() {
    const candidates = Array.isArray(navigator.languages) && navigator.languages.length
      ? navigator.languages
      : [navigator.language || navigator.userLanguage || ''];
    for (const raw of candidates) {
      const tag = (raw || '').toLowerCase();
      if (!tag) continue;
      const primary = tag.split('-')[0];
      if (SUPPORTED.includes(primary)) return primary;
    }
    return FALLBACK;
  }

  const I18N = {
    get lang() { return this._lang; },
    _lang: FALLBACK,

    init() {
      const stored = localStorage.getItem(STORAGE_KEY);
      this._lang = SUPPORTED.includes(stored) ? stored : detectSystemLang();
      document.documentElement.lang = this._lang;
      this.apply();
      this.markActiveLangButtons();
    },

    detectSystemLang,

    setLang(lang) {
      if (!SUPPORTED.includes(lang)) return;
      this._lang = lang;
      localStorage.setItem(STORAGE_KEY, lang);
      document.documentElement.lang = lang;
      this.apply();
      this.markActiveLangButtons();
      window.dispatchEvent(new CustomEvent('languagechange', { detail: { lang } }));
    },

    t(key, params) {
      const table = dict[this._lang] || {};
      const fallbackTable = dict[FALLBACK] || {};
      const raw = table[key] ?? fallbackTable[key] ?? key;
      return format(raw, params);
    },

    apply(root) {
      root = root || document;
      root.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = this.t(el.getAttribute('data-i18n'));
      });
      root.querySelectorAll('[data-i18n-html]').forEach(el => {
        el.innerHTML = this.t(el.getAttribute('data-i18n-html'));
      });
      root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        el.placeholder = this.t(el.getAttribute('data-i18n-placeholder'));
      });
      root.querySelectorAll('[data-i18n-title]').forEach(el => {
        el.title = this.t(el.getAttribute('data-i18n-title'));
      });
    },

    markActiveLangButtons() {
      document.querySelectorAll('[data-lang-set]').forEach(btn => {
        const isActive = btn.getAttribute('data-lang-set') === this._lang;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
    },
  };

  window.I18N = I18N;
  window.t = (key, params) => I18N.t(key, params);

  // Pick language as soon as possible to minimize visible English flash.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => I18N.init());
  } else {
    I18N.init();
  }

  // Position non-active buttons as a stack below the active trigger.
  function layoutOpenPicker(picker) {
    const active = picker.querySelector('.lang-btn.active');
    if (!active) return;
    const baseTop = active.offsetTop + active.offsetHeight + 4;
    const step = active.offsetHeight + 2;
    let i = 0;
    picker.querySelectorAll('.lang-btn:not(.active)').forEach(btn => {
      btn.style.top = (baseTop + i * step) + 'px';
      i++;
    });
  }

  function closeAllLangPickers(except) {
    document.querySelectorAll('.lang-picker.open').forEach(p => {
      if (p !== except) {
        p.classList.remove('open');
        p.querySelectorAll('.lang-btn').forEach(b => { b.style.top = ''; });
      }
    });
  }

  // Delegated click handler for any element with data-lang-set="<lang>".
  // Behavior: clicking the active (currently visible) button toggles the
  // picker open/closed; clicking any other button selects that language and
  // closes the picker.
  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-lang-set]');
    if (target) {
      const picker = target.closest('.lang-picker');
      const lang = target.getAttribute('data-lang-set');
      if (picker && lang === I18N._lang) {
        const willOpen = !picker.classList.contains('open');
        closeAllLangPickers();
        if (willOpen) {
          picker.classList.add('open');
          layoutOpenPicker(picker);
        }
      } else {
        I18N.setLang(lang);
        closeAllLangPickers();
      }
      return;
    }
    // Click outside any picker closes them.
    if (!e.target.closest('.lang-picker')) closeAllLangPickers();
  });
})();
