(function () {
  'use strict'

  // The system WebView on the target tablet predates ES2022 and does not
  // provide Array/String.prototype.at.  The bundled DMP UI uses .at() in
  // several render paths; install the standard, non-enumerable behavior
  // before the module script is evaluated so those paths remain stable.
  if (!Array.prototype.at) {
    Object.defineProperty(Array.prototype, 'at', {
      configurable: true,
      writable: true,
      value: function (index) {
        var length = this == null ? 0 : Number(this.length) || 0
        var position = Number(index) || 0
        if (position < 0) position += length
        if (position < 0 || position >= length) return undefined
        return this[position]
      }
    })
  }
  if (!String.prototype.at) {
    Object.defineProperty(String.prototype, 'at', {
      configurable: true,
      writable: true,
      value: function (index) {
        var value = String(this)
        var position = Number(index) || 0
        if (position < 0) position += value.length
        if (position < 0 || position >= value.length) return undefined
        return value.charAt(position)
      }
    })
  }

  // Older Android WebViews also miss the ES2023 Array helpers used by the
  // bundled DMP UI.  Define only missing methods and omit `enumerable` so the
  // compatibility methods behave like native Array.prototype properties.
  function androidToIntegerOrInfinity(value) {
    var number = Number(value)
    if (number !== number || number === 0) return 0
    if (number === Infinity || number === -Infinity) return number
    return number < 0 ? Math.ceil(number) : Math.floor(number)
  }

  function androidToLength(value) {
    var number = Number(value)
    if (number !== number || number <= 0) return 0
    if (number === Infinity) return 9007199254740991
    return Math.min(Math.floor(number), 9007199254740991)
  }

  function defineAndroidArrayMethod(name, implementation) {
    if (typeof Array.prototype[name] === 'function') return
    Object.defineProperty(Array.prototype, name, {
      configurable: true,
      writable: true,
      value: implementation
    })
  }

  defineAndroidArrayMethod('findLast', function findLast(callback) {
    if (this == null) throw new TypeError('Array.prototype.findLast called on null or undefined')
    var thisArg = arguments[1]
    var object = Object(this)
    var length = androidToLength(object.length)
    if (typeof callback !== 'function') throw new TypeError('callback must be a function')
    for (var index = length - 1; index >= 0; index -= 1) {
      var value = object[index]
      if (Function.prototype.call.call(callback, thisArg, value, index, object)) return value
    }
    return undefined
  })

  defineAndroidArrayMethod('findLastIndex', function findLastIndex(callback) {
    if (this == null) throw new TypeError('Array.prototype.findLastIndex called on null or undefined')
    var thisArg = arguments[1]
    var object = Object(this)
    var length = androidToLength(object.length)
    if (typeof callback !== 'function') throw new TypeError('callback must be a function')
    for (var index = length - 1; index >= 0; index -= 1) {
      var value = object[index]
      if (Function.prototype.call.call(callback, thisArg, value, index, object)) return index
    }
    return -1
  })

  defineAndroidArrayMethod('toReversed', function toReversed() {
    if (this == null) throw new TypeError('Array.prototype.toReversed called on null or undefined')
    var object = Object(this)
    var length = androidToLength(object.length)
    var result = new Array(length)
    for (var index = 0; index < length; index += 1) {
      // Get, rather than hasOwnProperty, intentionally turns holes into
      // explicit undefined values as required by toReversed.
      result[index] = object[length - index - 1]
    }
    return result
  })

  defineAndroidArrayMethod('toSorted', function toSorted(compareFn) {
    if (this == null) throw new TypeError('Array.prototype.toSorted called on null or undefined')
    var object = Object(this)
    var length = androidToLength(object.length)
    if (compareFn !== undefined && typeof compareFn !== 'function') {
      throw new TypeError('compareFn must be a function or undefined')
    }
    var values = new Array(length)
    for (var index = 0; index < length; index += 1) {
      // toSorted reads every index, so sparse slots become undefined entries.
      values[index] = object[index]
    }
    values.sort(compareFn)
    var result = new Array(length)
    for (var sortedIndex = 0; sortedIndex < length; sortedIndex += 1) {
      result[sortedIndex] = values[sortedIndex]
    }
    return result
  })

  defineAndroidArrayMethod('toSpliced', function toSpliced(start, deleteCount) {
    if (this == null) throw new TypeError('Array.prototype.toSpliced called on null or undefined')
    var object = Object(this)
    var length = androidToLength(object.length)
    var relativeStart = androidToIntegerOrInfinity(start)
    var actualStart = relativeStart < 0
      ? Math.max(length + relativeStart, 0)
      : Math.min(relativeStart, length)
    var actualDeleteCount
    if (arguments.length === 1) {
      actualDeleteCount = length - actualStart
    } else {
      var requestedDeleteCount = androidToIntegerOrInfinity(deleteCount)
      actualDeleteCount = Math.min(Math.max(requestedDeleteCount, 0), length - actualStart)
    }
    var itemCount = Math.max(arguments.length - 2, 0)
    var resultLength = length + itemCount - actualDeleteCount
    var result = new Array(resultLength)
    var resultIndex = 0
    var sourceIndex

    for (sourceIndex = 0; sourceIndex < actualStart; sourceIndex += 1) {
      result[resultIndex] = object[sourceIndex]
      resultIndex += 1
    }
    for (var itemIndex = 2; itemIndex < arguments.length; itemIndex += 1) {
      result[resultIndex] = arguments[itemIndex]
      resultIndex += 1
    }
    sourceIndex = actualStart + actualDeleteCount
    while (sourceIndex < length) {
      result[resultIndex] = object[sourceIndex]
      sourceIndex += 1
      resultIndex += 1
    }
    return result
  })

  var nativeBridge = window.AndroidDmp
  /* Some Android WebView builds attach the JavaScript bridge just after the
     document's head scripts have started.  The original early return made
     this bridge a one-shot: dmp-android-ui-polish.js still loaded, but none
     of the platform/room picker installers ever ran.  Re-inject this file
     once the native object is available instead of requiring an app reload.
     Keep the retry bounded to one reinjection so a genuinely unavailable
     bridge does not create a script loop. */
  if (!nativeBridge) {
    if (!window.__dmpAndroidBridgeRetryScheduled) {
      window.__dmpAndroidBridgeRetryScheduled = true
      var retryAttempts = 0
      var retryBridge = function () {
        if (window.AndroidDmp) {
          var script = document.createElement('script')
          script.src = './dmp-android-bridge.js?androidBridgeRetry=' + Date.now()
          script.async = false
          ;(document.head || document.documentElement).appendChild(script)
        } else if (retryAttempts++ < 300) {
          window.setTimeout(retryBridge, 80)
        }
      }
      window.setTimeout(retryBridge, 80)
    }
    return
  }

  /*
   * The upstream Vuetify `v-copy` directive still implements copy with
   * document.execCommand("copy").  That command is a no-op on several
   * Android WebViews, so room names, connection codes and game tokens appear
   * to copy successfully in the UI while nothing reaches the system
   * clipboard.  Route the command through the native bridge, retaining the
   * browser implementation as a fallback for desktop/debug builds.
   */
  (function installNativeClipboardFallback() {
    if (!document || document.__dmpAndroidClipboardInstalled) return
    document.__dmpAndroidClipboardInstalled = true
    var originalExecCommand = document.execCommand
    var nativeCopy = function (value) {
      if (!nativeBridge || typeof nativeBridge.copyText !== 'function') return false
      try { return nativeBridge.copyText(String(value == null ? '' : value)) !== false } catch (ignored) {
        return false
      }
    }
    var selectedValue = function () {
      var active = document.activeElement
      if (active && typeof active.value === 'string') return active.value
      /* v-copy appends its temporary textarea to body and selects it before
         calling execCommand.  If focus is not reported by an older WebView,
         the last visible text field is the temporary node in practice. */
      var fields = document.querySelectorAll('textarea,input')
      for (var index = fields.length - 1; index >= 0; index -= 1) {
        var field = fields[index]
        if (field && typeof field.value === 'string' && field.value) return field.value
      }
      try {
        return window.getSelection ? String(window.getSelection() || '') : ''
      } catch (ignored) { return '' }
    }
    if (typeof originalExecCommand === 'function') {
      document.execCommand = function (command) {
        if (String(command || '').toLowerCase() === 'copy') {
          if (nativeCopy(selectedValue())) return true
        }
        return originalExecCommand.apply(document, arguments)
      }
    }
    /* Newer page chunks may use the async Clipboard API instead of v-copy.
       Expose the same native path while preserving a real browser API when
       the Java interface is absent. */
    try {
      if (navigator && navigator.clipboard
          && typeof navigator.clipboard.writeText === 'function'
          && !navigator.clipboard.__dmpAndroidWriteText) {
        var originalWriteText = navigator.clipboard.writeText.bind(navigator.clipboard)
        navigator.clipboard.writeText = function (value) {
          if (nativeCopy(value)) return Promise.resolve()
          return originalWriteText(value)
        }
        navigator.clipboard.__dmpAndroidWriteText = true
      }
    } catch (ignored) {}
  })()

  var bootstrap = JSON.parse(nativeBridge.getBootstrap())
  /* Keep the native snapshot available to Android-only compatibility layers.
     The upstream Pinia stores are hydrated from the same object below, but
     exposing this read-only reference avoids making room-preview cards guess
     the current room/token from localStorage after a WebView recreation. */
  window.__dmpBootstrap = bootstrap
  // Keep a read-only copy available to Android-only enhancement scripts.
  // They use the same native-selected room/token as the official Web bundle
  // and must not depend on Pinia/localStorage having finished hydrating.
  window.__dmpBootstrap = bootstrap

  /* Room selection used to reload the WebView unconditionally.  The native
     activity's default entry is /rooms, so selecting a room while viewing a
     leaf page (日志、模组等) silently threw the user back to the room
     overview.  Carry the current SPA hash through that one intentional
     reload; this keeps the existing bootstrap refresh semantics without
     changing the server or LinuxDMP. */
  try {
    var restoredRoute = sessionStorage.getItem('dmp-android-restore-route')
    if (restoredRoute) {
      sessionStorage.removeItem('dmp-android-restore-route')
      restoredRoute = String(restoredRoute).trim()
      if (/^\/(?:dashboard|game|tools|logs|upload|install|platform)(?:\/|$)/i.test(restoredRoute)) {
        window.location.hash = '#' + restoredRoute
      }
    }
    /* A 420 response in the generated axios client assigns
       window.location.href='/#/login', which is a full appassets reload (not
       just a hash change).  Persist the last leaf route separately so the
       next bridge boot can distinguish that fallback from a deliberate visit
       to the room overview. */
    var savedLeaf = sessionStorage.getItem('dmp-android-last-leaf-route')
    var savedLeafAt = Number(sessionStorage.getItem('dmp-android-last-leaf-at') || 0)
    var explicitRoomsAt = Number(sessionStorage.getItem('dmp-android-explicit-rooms-at') || 0)
    var initialPath = String(window.location && window.location.hash || '')
      .replace(/^#/, '').split('?')[0]
    if (!restoredRoute && (initialPath === '/login' || initialPath === '/rooms')
        && savedLeaf && Date.now() - savedLeafAt < 30000
        && Date.now() - explicitRoomsAt > 1400
        && /^\/(?:dashboard|game|tools|logs|upload|install|platform)(?:\/|$)/i.test(savedLeaf)) {
      window.location.hash = '#' + savedLeaf
    }
    sessionStorage.removeItem('dmp-android-last-leaf-route')
    sessionStorage.removeItem('dmp-android-last-leaf-at')
    sessionStorage.removeItem('dmp-android-explicit-rooms-at')
  } catch (ignored) {}

  // These switches are persisted by the Android settings screen and arrive in
  // the bootstrap before the WebView page is evaluated.  Keep the default on
  // for older snapshots that do not contain either field.
  function androidSettingEnabled(value, fallback) {
    if (value === undefined || value === null) return fallback
    if (value === false || value === 0) return false
    var normalized = String(value).trim().toLowerCase()
    return normalized !== 'false' && normalized !== '0' && normalized !== 'off'
  }
  var androidDownloadUi = androidSettingEnabled(bootstrap.androidDownloadUi, true)
  var androidModConfigUi = androidSettingEnabled(bootstrap.androidModConfigUi, true)
  window.__dmpAndroidDownloadUiEnabled = androidDownloadUi
  window.__dmpAndroidModConfigUiEnabled = androidModConfigUi

  // The desktop 3.2 bundle creates its protected routes from the menu list
  // stored by Pinia.  A native platform entry does not go through the web
  // login page, so there is no earlier request that can populate that list;
  // an empty list makes the first /rooms navigation hit the wildcard 404
  // route before the server menu request can even be rendered.  Keep a
  // token-free route catalogue here.  It mirrors the 3.2 admin menu shape
  // and only controls which already-bundled views are registered; API
  // authorization still comes from the server token on every request.
  function androidDefaultMenu() {
    return [
      { id: 1, type: 'link', component: 'rooms/index', to: '/rooms', title: 'rooms', icon: 'ri-instance-line', section: '' },
      { id: 2, type: 'link', component: 'dashboard/index', to: '/dashboard', title: 'dashboard', icon: 'ri-function-ai-line', section: '' },
      { id: 3, type: 'group', component: '', to: '/game', title: 'game', icon: 'ri-gamepad-line', section: '', links: [
        { id: 301, type: 'link', component: 'game/base', to: '/game/base', title: 'gameBase', icon: 'ri-sword-line', section: '' },
        { id: 302, type: 'link', component: 'game/mod', to: '/game/mod', title: 'gameMod', icon: 'ri-rocket-2-line', section: '' },
        { id: 303, type: 'link', component: 'game/player', to: '/game/player', title: 'gamePlayer', icon: 'ri-ghost-line', section: '' },
        { id: 304, type: 'link', component: 'game/favorite', to: '/game/favorite', title: 'gameFavorite', icon: 'ri-bookmark-3-line', section: '' }
      ] },
      { id: 6, type: 'group', component: '', to: '/tools', title: 'tools', icon: 'ri-wrench-line', section: '', links: [
        { id: 601, type: 'link', component: 'tools/backup', to: '/tools/backup', title: 'toolsBackup', icon: 'ri-save-2-line', section: '' },
        { id: 602, type: 'link', component: 'tools/announce', to: '/tools/announce', title: 'toolsAnnounce', icon: 'ri-chat-smile-ai-3-line', section: '' },
        { id: 603, type: 'link', component: 'tools/map', to: '/tools/map', title: 'toolsMap', icon: 'ri-road-map-line', section: '' },
        { id: 604, type: 'link', component: 'tools/token', to: '/tools/token', title: 'toolsToken', icon: 'ri-coupon-line', section: '' },
        { id: 605, type: 'link', component: 'tools/snapshot', to: '/tools/snapshot', title: 'toolsSnapshot', icon: 'ri-flip-horizontal-line', section: '' },
        { id: 606, type: 'link', component: 'tools/tmi', to: '/tools/tmi', title: 'toolsTmi', icon: 'ri-ghost-4-line', section: '' },
        { id: 607, type: 'link', component: 'tools/aichat', to: '/tools/aichat', title: 'toolsAI', icon: 'ri-chat-smile-ai-3-line', section: '' }
      ] },
      { id: 7, type: 'group', component: '', to: '/logs', title: 'logs', icon: 'ri-blogger-line', section: '', links: [
        { id: 701, type: 'link', component: 'logs/game', to: '/logs/game', title: 'logsGame', icon: 'ri-game-line', section: '' },
        { id: 702, type: 'link', component: 'logs/chat', to: '/logs/chat', title: 'logsChat', icon: 'ri-chat-smile-3-line', section: '' },
        { id: 703, type: 'link', component: 'logs/download', to: '/logs/download', title: 'logsDownload', icon: 'ri-download-2-line', section: '' },
        { id: 704, type: 'link', component: 'logs/steam', to: '/logs/steam', title: 'logsSteam', icon: 'ri-steam-line', section: '' },
        { id: 705, type: 'link', component: 'logs/access', to: '/logs/access', title: 'logsAccess', icon: 'ri-code-box-line', section: '' },
        { id: 706, type: 'link', component: 'logs/runtime', to: '/logs/runtime', title: 'logsRuntime', icon: 'ri-terminal-box-line', section: '' },
        { id: 707, type: 'link', component: 'logs/clean', to: '/logs/clean', title: 'logsClean', icon: 'ri-file-shred-line', section: '' }
      ] },
      { id: 4, type: 'link', component: 'upload/index', to: '/upload', title: 'upload', icon: 'ri-contacts-book-upload-line', section: '' },
      { id: 5, type: 'link', component: 'install/index', to: '/install', title: 'install', icon: 'ri-import-line', section: '' },
      { id: 8, type: 'link', component: 'platform/index', to: '/platform', title: 'platform', icon: 'ri-vip-crown-2-line', section: '' }
    ]
  }

  if (!bootstrap.user || typeof bootstrap.user !== 'object') bootstrap.user = {}
  if (!Array.isArray(bootstrap.user.menus) || bootstrap.user.menus.length === 0) {
    bootstrap.user.menus = androidDefaultMenu()
  }
  // The native intent is the source of truth for the shell mode.  Do not infer
  // room-preview mode from the persisted web store: platform mode can retain a
  // previously opened room in localStorage, and a reload would otherwise swap
  // the full platform menu for the compact room menu.
  var selectedServer = bootstrap.dmps && bootstrap.dmps.length ? bootstrap.dmps[0] : null
  // Expose only display metadata to the download UI; credentials remain in
  // the native bridge and are never copied into task labels.
  window.__dmpServerId = selectedServer && selectedServer.id || ''
  window.__dmpServerName = selectedServer && (selectedServer.remark || selectedServer.ip) || '当前服务器'
  window.__dmpServerHost = selectedServer && selectedServer.ip || ''
  // The WebView is destroyed when leaving a platform, so native keeps a
  // token-free snapshot for this server. The download store consumes it on
  // initialization and restores an in-flight backend update after re-entry.
  window.__dmpBootstrapTasks = Array.isArray(bootstrap.downloadTasks)
    ? bootstrap.downloadTasks : []
  window.__dmpBootstrapDismissedTaskIds = Array.isArray(bootstrap.downloadDismissedTaskIds)
    ? bootstrap.downloadDismissedTaskIds : []
  // Build the dismissal set before importing the native task snapshot.  The
  // WebView may be recreated with a deleted row still present in the last
  // sync; filtering up front prevents that row from being written back before
  // the later status guards are installed.
  var bootstrapDismissedTaskIds = {}
  window.__dmpBootstrapDismissedTaskIds.forEach(function (id) {
    var key = String(id || '').trim()
    if (key) bootstrapDismissedTaskIds[key] = true
  })
  // Kept as a compatibility name for older bridge helpers below.  All rows
  // now flow through __dmpDownloadStore, whose allow-list strips file URLs,
  // headers and credentials before the native snapshot is written.
  function upsertAndroidWebTask(task) {
    if (!task || typeof task !== 'object') return null
    var copy = Object.assign({}, task)
    if (!copy.id) copy.id = copy.taskID || ''
    if (window.__dmpDownloadStore && typeof window.__dmpDownloadStore.upsertTask === 'function') {
      return window.__dmpDownloadStore.upsertTask(copy)
    }
    return null
  }
  var apiBaseUrl = String(bootstrap.apiBaseUrl || '').replace(/\/+$/, '')
  var apiToken = bootstrap.apiToken || (selectedServer && selectedServer.token) || ''

  // DMP may rotate the credential on any API response.  Keep every transport
  // (XHR, fetch and the native server-card client) on the same token, then
  // persist the two Pinia bootstrap records so axios' next request uses it.
  function applyNewToken(value) {
    var refreshed = String(value == null ? '' : value).trim()
    if (!refreshed || refreshed.length > 4096 || refreshed === apiToken) return
    apiToken = refreshed
    bootstrap.apiToken = refreshed
    if (bootstrap.user && typeof bootstrap.user === 'object') {
      bootstrap.user.token = refreshed
    }
    if (bootstrap.global && bootstrap.global.entry
      && typeof bootstrap.global.entry === 'object') {
      bootstrap.global.entry.token = refreshed
    }
    if (Array.isArray(bootstrap.dmps)) {
      bootstrap.dmps.forEach(function (entry) {
        if (entry && String(entry.id || '') === String(window.__dmpServerId || '')) {
          entry.token = refreshed
        }
      })
    }
    if (selectedServer && typeof selectedServer === 'object') {
      selectedServer.token = refreshed
    }
    try { localStorage.setItem('dmp-user', JSON.stringify(bootstrap.user || {})) } catch (ignored) {}
    try { localStorage.setItem('dmp-global', JSON.stringify(bootstrap.global || {})) } catch (ignored) {}
    try {
      if (nativeBridge && typeof nativeBridge.updateToken === 'function') {
        nativeBridge.updateToken(refreshed)
      }
    } catch (ignored) {}
  }

  function captureNewToken(response, requestUrl) {
    // The bridge may observe third-party requests made by a bundled page.
    // Only accept this private header from the selected DMP API host; an
    // unrelated response must never be able to replace the server token.
    var url = String(requestUrl || '')
    if (!apiBaseUrl || (url !== apiBaseUrl && url.indexOf(apiBaseUrl + '/') !== 0)) return
    var refreshed = ''
    try {
      if (response && typeof response.getResponseHeader === 'function') {
        refreshed = response.getResponseHeader('X-DMP-NEW-TOKEN') || ''
      } else if (response && response.headers && typeof response.headers.get === 'function') {
        refreshed = response.headers.get('X-DMP-NEW-TOKEN') || ''
      }
    } catch (ignored) {}
    applyNewToken(refreshed)
  }

  // Exposed only as an endpoint base for trusted bundled modules.  It never
  // contains credentials and lets the legacy backup module hand its relative
  // export URL to Android DownloadManager instead of creating a blob URL.
  window.__dmpApiBaseUrl = apiBaseUrl
  // The upstream logs page downloads the ZIP through Axios as a Blob. Large
  // exports can be truncated by older Android WebViews before the Blob is
  // handed to the browser download code. Keep the token inside the Java
  // bridge and let DownloadManager own this one endpoint instead.
  window.__dmpNativeLogDownload = function (url, params, requestedName) {
    if (!nativeBridge || typeof nativeBridge.downloadFile !== 'function') return false
    if (!/\/logs\/download(?:[/?]|$)/i.test(String(url || ''))) return false
    params = params && typeof params === 'object' ? params : {}
    var roomId = params.roomID
    if (roomId === undefined || roomId === null || roomId === '') {
      roomId = params.roomId !== undefined ? params.roomId : params.room_id
    }
    var parsedRoomId = Number(roomId)
    if (!Number.isFinite(parsedRoomId) || parsedRoomId <= 0) return false
    var target = '/logs/download?roomID=' + encodeURIComponent(String(Math.floor(parsedRoomId)))
    try {
      nativeBridge.downloadFile(target, requestedName || 'logs.zip')
      return true
    } catch (ignored) {
      return false
    }
  }
  if (bootstrap.user) bootstrap.user.token = apiToken
  var store = {
    dmps: bootstrap.dmps,
    theme: bootstrap.theme,
    language: bootstrap.language,
  }

  // Android download queue -------------------------------------------------
  //
  // DMP 3.2 removed the old /tasks endpoint.  The web UI still makes the
  // authoritative mod/update requests, so keep a small token-free queue at
  // the bridge boundary.  It is intentionally independent from Vue/Pinia:
  // it survives a WebView recreation through AndroidDmp.syncDownloadTasks()
  // and can be consumed by the native all-platform download panel.
  var downloadListeners = []
  var downloadTaskList = []
  var downloadNow = function () { return Date.now() }
  var downloadNumber = function (value, fallback) {
    var result = Number(value)
    return Number.isFinite(result) && result >= 0 ? result : (fallback || 0)
  }
  var downloadServerId = String(window.__dmpServerId || (selectedServer && selectedServer.id) || '')
  var downloadServerName = String(window.__dmpServerName || (selectedServer && (selectedServer.remark || selectedServer.ip)) || '当前服务器')

  function downloadCopy(value) {
    if (value == null) return value
    try { return JSON.parse(JSON.stringify(value)) } catch (ignored) { return value }
  }

  // Only this allow-list is persisted.  Keep the source URL too: a mobile
  // download row can be retried from the all-platform panel after its WebView
  // has been recreated.  `file_url` is a source location supplied to the DMP
  // server, not the DMP API credential (the latter remains in the native
  // server record and is never serialized here).  Request headers, API tokens
  // and arbitrary response fields never enter the snapshot.
  var downloadSafeFields = [
    'id', 'serverId', 'serverTaskID', 'taskID', 'type', 'roomID', 'roomName',
    'roomIDs', 'roomNames', 'modID', 'name', 'status', 'stage',
    'file_url', 'fileUrl',
    /* Native DownloadManager rows need their opaque id and source metadata
       after they cross the token-free store boundary.  The old allow-list
       dropped these fields, so a backup/log transfer could be queried once
       but then lost its retry/share identity on the next store notification. */
    'directory', 'downloadId', 'kind', 'url', 'canDelete', 'canRetry', 'readOnly',
    'completedBytes', 'totalBytes', 'progress', 'speedBytesPerSecond',
    'progressKnown', 'serverTask', 'canPause', 'serverName', 'serverHost',
    'serverUpdateObserved', 'serverLastUpdating', 'versionAtRequest',
    'downloadedBytes', 'bytesDownloaded', 'bytesTotal', 'size', 'update',
    'percent', 'percentage', 'progressPercent', 'downloadSpeed',
    'bytesPerSecond', 'message', 'error', 'detail', 'createdAt', 'updatedAt',
    'finishedAt', 'attempt', 'recovering', 'postAlreadySubmitted',
    'serverMayContinue'
  ]

  function downloadPublicTask(task) {
    var safe = {}
    if (!task || typeof task !== 'object') return safe
    downloadSafeFields.forEach(function (field) {
      if (task[field] !== undefined && task[field] !== null) safe[field] = downloadCopy(task[field])
    })
    return safe
  }

  function downloadTaskKey(type, payload) {
    payload = payload || {}
    var server = String(payload.serverId || downloadServerId || 'current')
    if (type === 'mod_download') {
      var room = Number(payload.roomID || payload.roomId || 0) || 0
      var mod = Number(payload.modID || payload.id || 0) || 0
      return 'mod:' + server + ':' + room + ':' + mod
    }
    return 'game_update:' + server
  }

  function downloadModIdentity(task) {
    task = task || {}
    var room = Number(task.roomID || task.roomId || task.room_id || 0) || 0
    var mod = Number(task.modID || task.modId || task.mod_id || 0) || 0
    var id = String(task.id || task.taskID || '')
    /* Restored token-free rows commonly contain only the canonical id.  Keep
       aliases for the same room/mod together, but never merge every row into
       the old zero/zero bucket. The greedy server group also tolerates a
       future server identifier containing a colon. */
    var canonical = /^mod:(.*):([0-9]+):([0-9]+)$/.exec(id)
    if (canonical) {
      if (!room) room = Number(canonical[2]) || 0
      if (!mod) mod = Number(canonical[3]) || 0
    }
    return { room: room, mod: mod || id || 'unknown' }
  }

  /*
   * A mod request can be observed three times (XHR send, XHR response and
   * the restored native snapshot).  Older builds gave each observation a
   * different server task id, so using only task.id made one click appear as
   * several rows in the all-platform card.  Room + Workshop id is the stable
   * identity for a mod download; keep the semantic canonical id while
   * retaining serverTaskID/taskID as metadata for the action bridge.
   */
  function downloadCanonicalModKey(task) {
    task = task || {}
    var identity = downloadModIdentity(task)
    var room = Number(identity.room || 0)
    var mod = Number(identity.mod || 0)
    if (!(room > 0 && mod > 0)) return ''
    var server = String(task.serverId || task.serverID || downloadServerId || 'current')
    return 'mod:' + server + ':' + room + ':' + mod
  }

  function taskNumber(payload, keys, fallback) {
    payload = payload && typeof payload === 'object' ? payload : {}
    for (var index = 0; index < keys.length; index++) {
      var value = payload[keys[index]]
      if (value === undefined || value === null || value === '') continue
      var parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
    return fallback || 0
  }

  function downloadStatusTask(status) {
    status = String(status || '').toLowerCase()
    if (status === 'success' || status === 'complete' || status === 'completed' || status === 'done') return 'success'
    if (status === 'error' || status === 'failed' || status === 'failure') return 'error'
    if (status === 'paused') return 'paused'
    if (status === 'cancelled' || status === 'canceled') return 'cancelled'
    if (status === 'queued' || status === 'pending' || status === 'waiting') return 'queued'
    return 'running'
  }

  function downloadNotify() {
    var snapshot = downloadTaskList.map(downloadPublicTask)
    try { nativeBridge.syncDownloadTasks(JSON.stringify(snapshot)) } catch (ignored) {}
    try { window.dispatchEvent(new CustomEvent('dmp-download-tasks', { detail: downloadCopy(snapshot) })) } catch (ignored) {}
    downloadListeners.slice().forEach(function (listener) {
      try { listener(downloadCopy(snapshot)) } catch (ignored) {}
    })
  }

  function downloadFind(id) {
    var key = String(id || '')
    for (var i = 0; i < downloadTaskList.length; i++) {
      if (String(downloadTaskList[i].id) === key) return downloadTaskList[i]
    }
    return null
  }

  function downloadUpsert(task) {
    if (!task || typeof task !== 'object') return null
    var taskType = String(task.type || 'mod_download').toLowerCase()
    // Do not let a transient empty object become mod:server:0:0. Such rows
    // were the source of the permanent, non-actionable placeholders in the
    // all-platform task centre after a WebView recreation.
    if (taskType === 'mod_download') {
      var validRoom = Number(task.roomID || task.roomId || 0) > 0
      var validMod = Number(task.modID || task.modId || 0) > 0
      var hasServerTask = String(task.serverTaskID || task.taskID || '').trim() !== ''
      if ((!validRoom || !validMod) && !hasServerTask
        && !/^mod:[^:]+:[1-9][0-9]*:[1-9][0-9]*$/.test(String(task.id || ''))) {
        return null
      }
    }
    var originalKey = String(task.id || '')
    var canonicalModKey = taskType === 'mod_download'
      ? downloadCanonicalModKey(task) : ''
    var key = canonicalModKey || originalKey
    if (!key) return null
    if (taskType === 'mod_download'
      && (bootstrapDismissedTaskIds[key] || bootstrapDismissedTaskIds[originalKey])) return null
    if (taskType === 'mod_download' && window.__dmpModCancelledTasks
      && (window.__dmpModCancelledTasks[key] || window.__dmpModCancelledTasks[originalKey])) return null
    var existing = downloadFind(key)
    /* If an older row was already restored with a random task id, merge it
       into the same canonical room/mod row instead of appending another
       visible task. */
    if (!existing && canonicalModKey) {
      for (var existingIndex = 0; existingIndex < downloadTaskList.length; existingIndex++) {
        var candidate = downloadTaskList[existingIndex]
        var candidateToken = candidate && String(
          candidate.serverTaskID || candidate.taskID || '')
        var incomingToken = String(task.serverTaskID || task.taskID || '')
        if (candidate && (downloadCanonicalModKey(candidate) === canonicalModKey
          || (incomingToken && candidateToken === incomingToken)
          || (originalKey && candidateToken === originalKey)
          || (candidate && String(candidate.id || '') === incomingToken))) {
          existing = candidate
          break
        }
      }
    }
    var now = downloadNow()
    if (!existing) {
      existing = {
        id: key,
        serverId: downloadServerId,
        serverName: downloadServerName,
        type: 'mod_download',
        status: 'queued',
        stage: 'queued',
        progress: 0,
        progressKnown: false,
        createdAt: now,
        updatedAt: now
      }
      downloadTaskList.push(existing)
    }
    Object.keys(task).forEach(function (field) {
      /* Never replace the canonical id with an observation-specific random
         id.  The latter is kept in serverTaskID/taskID for server actions. */
      if (field === 'id' && canonicalModKey) return
      if (task[field] !== undefined && task[field] !== null) existing[field] = downloadCopy(task[field])
    })
    if (canonicalModKey) {
      existing.id = canonicalModKey
      /* Drop any older alias rows that were restored before room/mod fields
         became available.  They are the same task, not separate downloads. */
      var retained = []
      downloadTaskList.forEach(function (candidate) {
        if (candidate === existing) {
          retained.push(candidate)
          return
        }
        var candidateKey = downloadCanonicalModKey(candidate)
        var candidateToken = String(candidate && (candidate.serverTaskID || candidate.taskID) || '')
        var incomingToken = String(task.serverTaskID || task.taskID || '')
        if (candidateKey === canonicalModKey
          || incomingToken && candidateToken === incomingToken
          || originalKey && candidateToken === originalKey) {
          return
        }
        retained.push(candidate)
      })
      downloadTaskList = retained
    }
    existing.updatedAt = now
    var percent = task.progress
    if (percent == null) percent = task.percent
    if (percent == null) percent = task.percentage
    if (percent == null) percent = task.progressPercent
    if (percent != null && Number.isFinite(Number(percent))) {
      existing.progress = Math.max(0, Math.min(100, Number(percent)))
      existing.progressKnown = task.progressKnown !== false
    }
    existing.status = downloadStatusTask(existing.status)
    existing.stage = existing.status === 'success' ? 'completed'
      : existing.status === 'error' ? 'failed'
        : existing.status === 'paused' ? 'paused'
          : existing.status === 'cancelled' ? 'cancelled'
            : existing.status === 'queued' ? 'queued' : 'downloading'
    if (existing.status === 'success') {
      existing.progress = 100
      existing.progressKnown = true
      existing.finishedAt = existing.finishedAt || now
    }
    downloadNotify()
    return existing
  }

  function downloadRemove(id) {
    var key = String(id || '')
    var before = downloadTaskList.length
    downloadTaskList = downloadTaskList.filter(function (task) { return String(task.id) !== key })
    if (before !== downloadTaskList.length) downloadNotify()
    return before !== downloadTaskList.length
  }

  // Restore only the fields exposed by the native bridge; old snapshots may
  // contain legacy rows and are normalized into the same local queue.
  if (Array.isArray(window.__dmpBootstrapTasks)) {
    window.__dmpBootstrapTasks.forEach(function (raw) {
      if (!raw || typeof raw !== 'object') return
      var type = raw.type === 'game_update' || raw.__androidGameUpdate ? 'game_update' : (raw.type || 'mod_download')
      var task = downloadPublicTask(raw)
      if (type === 'mod_download'
        && Number(task.roomID || task.roomId || 0) <= 0
        && Number(task.modID || task.modId || 0) <= 0
        && !String(task.serverTaskID || task.taskID || '').trim()
        && !/^mod:[^:]+:[1-9][0-9]*:[1-9][0-9]*$/.test(String(task.id || ''))) {
        return
      }
      task.type = type
      task.id = task.id || downloadTaskKey(type, task)
      if (type === 'mod_download' && bootstrapDismissedTaskIds[String(task.id)]) return
      task.serverId = task.serverId || downloadServerId
      task.serverName = task.serverName || downloadServerName
      task.progressKnown = task.progressKnown === true
      downloadUpsert(task)
    })
  }

  window.__dmpDownloadStore = {
    get tasks () { return downloadTaskList.map(downloadPublicTask) },
    upsertTask: function (task) { return downloadUpsert(task) },
    removeTask: downloadRemove,
    deleteTask: downloadRemove,
    remove: downloadRemove,
    clearCompleted: function () {
      var before = downloadTaskList.length
      downloadTaskList = downloadTaskList.filter(function (task) {
        return ['success', 'error', 'cancelled'].indexOf(downloadStatusTask(task.status)) < 0
      })
      if (before !== downloadTaskList.length) downloadNotify()
      return before - downloadTaskList.length
    },
    subscribe: function (listener) {
      if (typeof listener !== 'function') return function () {}
      downloadListeners.push(listener)
      return function () { downloadListeners = downloadListeners.filter(function (item) { return item !== listener }) }
    },
    snapshot: function () { return downloadTaskList.map(downloadPublicTask) }
  }
  // Re-persist an imported snapshot once at startup.  This also normalizes
  // snapshots created by older bridge versions without exposing credentials.
  if (downloadTaskList.length) downloadNotify()

  localStorage.setItem('dmp-global', JSON.stringify(bootstrap.global))
  localStorage.setItem('dmp-user', JSON.stringify(bootstrap.user))
  localStorage.setItem('materio-initial-loader-bg', bootstrap.theme === 'dark' ? '#24213D' : '#F4F2FA')
  localStorage.setItem('materio-initial-loader-color', '#9155FD')

  function rewriteApiUrl(value) {
    if (!apiBaseUrl || value == null) return value
    var raw = String(value)
    var localMarker = '/android_asset/dmp_web/v3/'
    var markerIndex = raw.indexOf(localMarker)
    if (markerIndex >= 0) {
      return apiBaseUrl + '/v3/' + raw.slice(markerIndex + localMarker.length)
    }
    // A file:// WebView resolves a relative backup href to
    // file:///android_asset/dmp_web/tools/... (or file:///v3/...).  Such a
    // URL is not downloadable by Android DownloadManager until it is mapped
    // back to the DMP server endpoint.
    var assetRoot = '/android_asset/dmp_web/'
    var assetIndex = raw.indexOf(assetRoot)
    if (assetIndex >= 0) {
      var assetPath = raw.slice(assetIndex + assetRoot.length)
      if (/^v3\//i.test(assetPath)) return apiBaseUrl + '/' + assetPath
      if (/^(tools|room|platform|dashboard|mod|tasks|cloud|player|logs|upload|install|user)(?:\/|$)/i.test(assetPath)) {
        return apiBaseUrl + '/v3/' + assetPath
      }
    }
    if (/^file:/i.test(raw)) {
      try {
        var fileUrl = new URL(raw)
        var filePath = fileUrl.pathname || ''
        // Keep the query string when converting a file:// URL back to the
        // server API.  Backup exports carry roomID/filename here; dropping
        // it makes DownloadManager request the endpoint without parameters
        // and saves the 55-byte JSON "bad request" response instead of ZIP.
        var fileQuery = fileUrl.search || ''
        if (/^\/v3\//i.test(filePath)) return apiBaseUrl + filePath + fileQuery
        if (/^\/(?:tools|room|platform|dashboard|mod|tasks|cloud|player|logs|upload|install|user)(?:\/|$)/i.test(filePath)) {
          return apiBaseUrl + '/v3' + filePath + fileQuery
        }
      } catch (ignored) {}
    }
    if (/^v3(?:\/|$)/i.test(raw)) return apiBaseUrl + '/' + raw
    if (/^\/v3(?:\/|$)/i.test(raw)) return apiBaseUrl + raw
    if (/^\/(?:tools|room|platform|dashboard|mod|tasks|cloud|player|logs|upload|install|user)(?:\/|$)/i.test(raw)) {
      return apiBaseUrl + '/v3' + raw
    }
    return value
  }

  // The upstream axios client normally adds X-DMP-TOKEN through a request
  // interceptor.  A future route or a server-provided absolute URL must not
  // be able to turn that interceptor into a credential exfiltration path.
  // Compare the complete origin (scheme, host and effective port) with the
  // configured DMP API origin before allowing any auth header through.
  function isDmpApiOrigin(value) {
    if (!apiBaseUrl || value == null) return false
    try {
      var target = new URL(String(value), window.location.href)
      var base = new URL(String(apiBaseUrl), window.location.href)
      var targetPort = target.port || (target.protocol === 'https:' ? '443' : '80')
      var basePort = base.port || (base.protocol === 'https:' ? '443' : '80')
      return target.protocol.toLowerCase() === base.protocol.toLowerCase()
        && target.hostname.toLowerCase() === base.hostname.toLowerCase()
        && targetPort === basePort
    } catch (ignored) {
      return false
    }
  }

  function stripExternalAuthHeaders(url, init) {
    if (!init || isDmpApiOrigin(url)) return init
    var headers = init.headers
    if (!headers) return init
    var copy = {}
    if (typeof Headers !== 'undefined' && headers instanceof Headers) {
      headers.forEach(function (value, key) {
        if (!/^x-dmp-token$|^authorization$/i.test(key)) copy[key] = value
      })
    } else if (Array.isArray(headers)) {
      headers.forEach(function (pair) {
        if (pair && pair.length >= 2 && !/^x-dmp-token$|^authorization$/i.test(pair[0])) {
          copy[pair[0]] = pair[1]
        }
      })
    } else if (typeof headers === 'object') {
      Object.keys(headers).forEach(function (key) {
        if (!/^x-dmp-token$|^authorization$/i.test(key)) copy[key] = headers[key]
      })
    } else {
      return init
    }
    var next = {}
    Object.keys(init).forEach(function (key) { next[key] = init[key] })
    next.headers = copy
    return next
  }

  var nativeXhrSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (/^x-dmp-token$|^authorization$/i.test(String(name || ''))
        && !isDmpApiOrigin(this.__dmpRequestUrl)) {
      return
    }
    return nativeXhrSetRequestHeader.apply(this, arguments)
  }

  // Backup exports are exposed as an ordinary anchor by the desktop page.
  // Route that anchor through Android DownloadManager so the native transfer
  // queue can report bytes/progress and save to Download/DMP.  The desktop
  // URL may contain a token query parameter; strip it here because the native
  // bridge supplies X-DMP-TOKEN as a request header.
  function installNativeBackupDownload() {
    var recent = {}
    // The backup table displays a friendly room/backup name while the
    // download URL carries the server's opaque fileName.  Keep a short
    // token-free map from that opaque name to the displayed name so the
    // Android DownloadManager can use the same name the user saw.
    var backupDisplayNames = window.__dmpBackupDisplayNames =
      window.__dmpBackupDisplayNames || {}
    function backupPayloadRows(payload) {
      var value = payload && payload.data !== undefined ? payload.data : payload
      if (value && !Array.isArray(value) && typeof value === 'object') {
        value = value.items || value.rows || value.backups || value.list || value.data
      }
      return Array.isArray(value) ? value : []
    }
    function rememberBackupList(payload) {
      backupPayloadRows(payload).forEach(function (item) {
        if (!item || typeof item !== 'object') return
        var fileName = item.fileName || item.filename || item.file_name || item.path
        if (!fileName) return
        var display = item.gameName || item.displayName || item.backupName
          || item.name || item.roomName || fileName
        var key = String(fileName)
        backupDisplayNames[key] = String(display || key)
        try { backupDisplayNames[decodeURIComponent(key)] = String(display || key) } catch (ignored) {}
      })
    }
    function backupDisplayName(rawUrl, fallback) {
      var source = ''
      try {
        source = new URL(rawUrl, window.location.href).searchParams.get('filename') || ''
      } catch (ignored) {}
      var display = backupDisplayNames[source] || backupDisplayNames[decodeURIComponentSafe(source)]
      return display || fallback || source
    }
    function decodeURIComponentSafe(value) {
      try { return decodeURIComponent(String(value || '')) } catch (ignored) { return String(value || '') }
    }
    window.__dmpRememberBackupList = rememberBackupList
    // Axios' generic download helper fetches the archive as a Blob and then
    // clicks a `blob:` anchor.  The native WebView sees that synthetic URL as
    // an external navigation and, on devices without a blob handler, shows
    // "no application can handle this link".  Once the real export has been
    // handed to Android DownloadManager, consume exactly one matching blob
    // click so the WebView never forwards it to DmpWebActivity's external
    // intent fallback.  A timeout keeps a stale request from affecting a
    // later, unrelated blob download if the server rejects the export.
    var pendingBlobDownloads = 0
    var pendingBlobUntil = 0

    function armBlobSuppression() {
      pendingBlobDownloads = Math.min(4, pendingBlobDownloads + 1)
      pendingBlobUntil = Date.now() + 15000
    }

    function consumeBlobDownload(anchor) {
      if (!anchor || pendingBlobDownloads <= 0 || Date.now() > pendingBlobUntil) {
        if (Date.now() > pendingBlobUntil) pendingBlobDownloads = 0
        return false
      }
      var href = ''
      try { href = String(anchor.href || anchor.getAttribute('href') || '') } catch (ignored) {}
      var name = ''
      try { name = String(anchor.download || anchor.getAttribute('download') || '') } catch (ignored) {}
      if (!/^blob:/i.test(href) || !name) return false
      pendingBlobDownloads = Math.max(0, pendingBlobDownloads - 1)
      if (!pendingBlobDownloads) pendingBlobUntil = 0
      return true
    }

    // Axios invokes HTMLAnchorElement#click() directly, so the click event is
    // not guaranteed to pass through every old WebView's document capture
    // path.  Wrap the method as a second, narrowly-scoped guard.  This does
    // not alter regular links or user-created blob downloads.
    try {
      var anchorProto = window.HTMLAnchorElement && window.HTMLAnchorElement.prototype
      if (anchorProto && !anchorProto.__dmpBackupBlobGuard) {
        var nativeAnchorClick = anchorProto.click
        anchorProto.click = function () {
          var href = ''
          try { href = String(this.href || this.getAttribute('href') || '') } catch (ignored) {}
          // The backup page creates a temporary anchor and invokes click()
          // directly.  Older WebViews may skip the document capture handler
          // and hand the URL to DownloadListener with its query removed.  If
          // the temporary anchor is already fully formed, enqueue it here so
          // roomID/filename reach DownloadManager unchanged.
          if (/\/tools\/backup\/download(?:[/?]|$)/i.test(href)
              && /[?&](?:roomID|filename)=/i.test(href)) {
            var requestedName = ''
            try { requestedName = String(this.download || this.getAttribute('download') || '') } catch (ignored) {}
            if (dispatch(href, requestedName)) return
          }
          if (consumeBlobDownload(this)) return
          return nativeAnchorClick.apply(this, arguments)
        }
        anchorProto.__dmpBackupBlobGuard = true
      }
    } catch (ignored) {}

    function dispatch(raw, requestedName) {
      if (!raw || !nativeBridge || typeof nativeBridge.downloadFile !== 'function') return false
      var absolute = raw
      try {
        absolute = new URL(raw, window.location.href).toString()
      } catch (ignored) {}
      absolute = rewriteApiUrl(absolute)
      try {
        var parsed = new URL(absolute, window.location.href)
        ;['token', 'apiToken', 'access_token', 'authorization'].forEach(function (key) {
          parsed.searchParams.delete(key)
        })
        absolute = parsed.toString()
      } catch (ignored) {}
      var key = String(absolute)
      if (recent[key] && Date.now() - recent[key] < 1800) return true
      recent[key] = Date.now()
      var name = String(requestedName || '')
      try {
        name = name || new URL(absolute, window.location.href).searchParams.get('filename') || ''
      } catch (ignored) {}
      name = backupDisplayName(absolute, name)
      if (!name) name = 'DMP-backup-' + Date.now() + '.zip'
      // DownloadManager receives a path rather than a MIME-derived name for
      // these exports.  Keep the archive extension even when the displayed
      // backup name has none; the Java bridge applies a collision suffix.
      if (!/\.[a-z0-9]{2,8}$/i.test(name)) name += '.zip'
      try {
        nativeBridge.downloadFile(absolute, name)
        armBlobSuppression()
      } catch (ignored) {}
      return true
    }
    // The legacy backup chunk performs an axios blob request and therefore
    // never creates an anchor containing /tools/backup/download.  Expose this
    // small native route so the XHR wrapper below can save the same export via
    // DownloadManager while the web page keeps its own success toast.
    window.__dmpNativeBackupDownload = dispatch
    function handle(event) {
      var targetAnchor = event.target && event.target.closest
        ? event.target.closest('a') : null
      // The official axios helper creates a blob anchor with the requested
      // filename.  It is the second half of the same export operation; its
      // default action must be consumed after the native queue was armed.
      if (targetAnchor && consumeBlobDownload(targetAnchor)) {
        event.preventDefault()
        event.stopImmediatePropagation()
        return
      }
      var anchor = event.target && event.target.closest
        ? event.target.closest('a[href*="/tools/backup/download"]') : null
      if (!anchor) return
      var raw = anchor.getAttribute('href') || ''
      if (!raw) return
      // The backup page's action menu can itself be rendered as an anchor
      // whose href only names the endpoint.  Its Vue click handler adds the
      // roomID/filename query to a temporary anchor immediately afterwards.
      // Intercepting that menu click here would enqueue an unusable request
      // without parameters and prevent the real handler from running.  Only
      // consume an already-formed export URL; the DownloadListener/XHR guard
      // below covers the temporary anchor and keeps its query intact.
      if (!/[?&](?:roomID|filename)=/i.test(raw)) return
      event.preventDefault()
      event.stopPropagation()
      dispatch(raw, '')
    }
    document.addEventListener('click', handle, true)
    document.addEventListener('pointerup', handle, true)
    document.addEventListener('touchend', handle, true)
  }
  installNativeBackupDownload()

  var nativeXhrOpen = XMLHttpRequest.prototype.open
  var nativeXhrSend = XMLHttpRequest.prototype.send
  var pendingGameUpdates = window.__dmpPendingGameUpdates =
    window.__dmpPendingGameUpdates || []
  var modVerificationPending = {}
  var modVerificationGeneration = {}
  // DMP 3.2 has no server-side cancellation endpoint for the SteamCMD worker.
  // Keep a local tombstone for a cancelled/deleted catalogue job so its later
  // status polls cannot recreate a row the user explicitly removed.  The
  // queue module also persists the same ids in its per-server localStorage
  // record, allowing this guard to survive a WebView recreation.
  var modCancelledTasks = window.__dmpModCancelledTasks =
    window.__dmpModCancelledTasks || {}
  // Explicit fresh-download intents are stamped by the queue before it sends
  // a POST.  This lets us distinguish a new click from a late XHR belonging
  // to a task the user already cancelled.
  var modDownloadIntents = window.__dmpModDownloadIntents =
    window.__dmpModDownloadIntents || {}
  window.__dmpBootstrapDismissedTaskIds.forEach(function (id) {
    var key = String(id || '')
    if (key.indexOf('mod:') === 0) {
      modCancelledTasks[key] = Date.now()
      bootstrapDismissedTaskIds[key] = true
    }
  })

  function modTaskCancelled(id) {
    var key = String(id || '')
    if (!key) return false
    if (modCancelledTasks[key]) return true
    try {
      for (var storageIndex = 0; storageIndex < localStorage.length; storageIndex++) {
        var storageKey = localStorage.key(storageIndex) || ''
        if (storageKey.indexOf('dmp-v320-mod-download-queue-') !== 0) continue
        var cached = JSON.parse(localStorage.getItem(storageKey) || '{}')
        if (Array.isArray(cached.dismissed) && cached.dismissed.map(String).indexOf(key) >= 0) {
          modCancelledTasks[key] = Date.now()
          return true
        }
      }
    } catch (ignored) {}
    return false
  }

  function clearModTaskCancelled(id) {
    var key = String(id || '')
    if (!key) return
    delete modCancelledTasks[key]
    delete bootstrapDismissedTaskIds[key]
    modVerificationGeneration[key] = (modVerificationGeneration[key] || 0) + 1
    delete modVerificationPending[key]
    try {
      if (nativeBridge && typeof nativeBridge.clearWebTaskDismissal === 'function') {
        nativeBridge.clearWebTaskDismissal(key)
      }
    } catch (ignored) {}
    // A new explicit download must be allowed to use the same room/mod id.
    // Clear only that id from the persisted dismissal lists; never discard
    // other servers' history or unrelated cancelled tasks.
    try {
      for (var storageIndex = 0; storageIndex < localStorage.length; storageIndex++) {
        var storageKey = localStorage.key(storageIndex) || ''
        if (storageKey.indexOf('dmp-v320-mod-download-queue-') !== 0) continue
        var cached = JSON.parse(localStorage.getItem(storageKey) || '{}')
        if (!Array.isArray(cached.dismissed)) continue
        var before = cached.dismissed.length
        cached.dismissed = cached.dismissed.filter(function (value) { return String(value) !== key })
        if (cached.dismissed.length !== before) {
          localStorage.setItem(storageKey, JSON.stringify(cached))
        }
      }
    } catch (ignored) {}
  }

  function markModTaskCancelled(id) {
    var key = String(id || '')
    if (!key) return
    modCancelledTasks[key] = Date.now()
    delete modDownloadIntents[key]
    bootstrapDismissedTaskIds[key] = true
    modVerificationGeneration[key] = (modVerificationGeneration[key] || 0) + 1
    delete modVerificationPending[key]
    // The queue's cancel/remove operation is the single native tombstone
    // writer. Keeping this marker side-effect free avoids two overlapping
    // SharedPreferences writes when the catalogue button is cancelled.
  }
  // Keep the catalogue/queue renderer on the same side of the tombstone
  // boundary as the XHR/fetch observers.  The native `webTaskAction` call
  // persists a dismissal for a recreated WebView, but without this local
  // hook a late progress response could still reinsert the row immediately
  // in the current WebView before the next native snapshot arrived.
  window.__dmpMarkModTaskCancelled = function (id) {
    markModTaskCancelled(id)
    return true
  }
  window.__dmpClearModTaskCancelled = function (id) {
    clearModTaskCancelled(id)
    return true
  }
  // The 3.2 catalogue request is often completed before the download click.
  // Keep a tiny id -> display metadata map so a POST containing only roomID/id
  // still renders progress on the matching catalogue card.
  var modCatalogue = window.__dmpModCatalogue = window.__dmpModCatalogue || {}
  // Keep the server's downloaded details separately from the transient task
  // queue.  The catalogue component only receives a boolean in some 3.2
  // builds, which made every installed mod render the same “更新” action and
  // left the installed name in the default purple colour.  The details
  // endpoint includes the local/server size pair used by the old frontend to
  // decide whether an update is really available.
  var modDownloadedDetails = window.__dmpModDownloadedDetails
    = window.__dmpModDownloadedDetails || {}

  function rememberModCatalogue(payload) {
    var root = payload && payload.data != null ? payload.data : payload
    var rows = root && Array.isArray(root.rows) ? root.rows
      : root && Array.isArray(root.items) ? root.items
        : root && Array.isArray(root.results) ? root.results
          : Array.isArray(root) ? root
            : root && Array.isArray(root.data) ? root.data
              : root && root.data && Array.isArray(root.data.items) ? root.data.items
                : root && root.data && Array.isArray(root.data.rows) ? root.data.rows : []
    rows.forEach(function (item) {
      if (!item || typeof item !== 'object') return
      var id = Number(item.id || item.modID || item.modId || 0)
      if (id <= 0) return
      var name = String(item.name || item.modName || '').trim()
      if (!name) return
      modCatalogue[String(id)] = {
        id: id,
        name: name,
        size: item.size || item.serverSize || item.totalBytes || 0,
        serverSize: item.serverSize || item.size || 0,
        time_updated: item.time_updated || item.timeUpdated || item.updatedAt || item.updated_at || '',
        updatedAt: item.updatedAt || item.updated_at || item.time_updated || item.timeUpdated || '',
        file_url: item.file_url || item.fileUrl || '',
        preview: item.preview_url || item.previewUrl || ''
      }
    })
  }

  function rememberDownloadedDetails(payload) {
    var root = payload && payload.data != null ? payload.data : payload
    var rows = root && Array.isArray(root.rows) ? root.rows
      : root && Array.isArray(root.items) ? root.items
        : root && Array.isArray(root.results) ? root.results
          : Array.isArray(root) ? root
            : root && Array.isArray(root.data) ? root.data : []
    rows.forEach(function (item) {
      if (!item || typeof item !== 'object') return
      var id = Number(item.id || item.modID || item.modId || 0)
      if (id <= 0) return
      modDownloadedDetails[String(id)] = item
    })
  }

  function modCatalogueItem(id) {
    return modCatalogue[String(Number(id) || id)] || null
  }
  function requestPayload(body) {
    if (!body) return null
    if (typeof body === 'object' && !(body instanceof String)) {
      if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
        var encoded = body.get('payload') || body.get('data')
        if (!encoded) return null
        try { return JSON.parse(encoded) } catch (ignored) { return null }
      }
      if (typeof FormData !== 'undefined' && body instanceof FormData) return null
      return body
    }
    try { return JSON.parse(String(body)) } catch (ignored) { return null }
  }

  function responsePayload(value) {
    if (value == null) return null
    if (typeof value === 'object') return value
    try { return JSON.parse(String(value)) } catch (ignored) { return null }
  }

  function responseOK(payload) {
    return !payload || payload.code == null || Number(payload.code) === 200
  }

  function requestQuery(url, key) {
    try {
      if (typeof URL !== 'function') throw new Error('URL unavailable')
      var parsed = new URL(String(url), window.location.href)
      return parsed.searchParams.get(key) || ''
    } catch (ignored) {
      var expression = new RegExp('(?:[?&])' + key + '=([^&]*)', 'i').exec(String(url || ''))
      return expression ? decodeURIComponent(expression[1]) : ''
    }
  }

  function updateModResponse(requestUrl, body, payload) {
    if (!/\/mod\/download(?:[/?]|$)/i.test(String(requestUrl || ''))) return
    var request = requestPayload(body)
    var roomID = taskNumber(request, ['roomID', 'roomId', 'room_id'], 0)
    var modID = taskNumber(request, ['id', 'modID', 'modId', 'mod_id'], 0)
    if (!request || roomID <= 0 || modID <= 0) return
    var id = downloadTaskKey('mod_download', {
      serverId: downloadServerId,
      roomID: roomID,
      modID: modID
    })
    // The POST can settle after the user has already cancelled the local
    // queue row. Treat that acknowledgement as stale rather than recreating
    // a task the user just removed.
    if (modTaskCancelled(id)) return
    var catalogue = modCatalogueItem(modID)
    if (!responseOK(payload)) {
      downloadUpsert({ id: id, status: 'error', stage: 'failed', error: payload && payload.message || '模组下载请求失败' })
      return
    }
    // A successful POST only means that the server accepted/queued the job.
    // Older DMP builds sometimes return “下载完成” for that acknowledgement;
    // treating it as terminal made the Android queue lie before a file existed.
    // Completion is accepted only from the explicit status endpoint (or a
    // response carrying an unambiguous terminal flag and 100% progress).
    var current = downloadFind(id)
    var responseData = payload && payload.data && typeof payload.data === 'object'
      ? payload.data : payload
    var responsePercent = taskNumber(responseData,
      ['progress', 'percent', 'percentage', 'progressPercent'], -1)
    var explicitComplete = responseData &&
      (responseData.completed === true || responseData.fileExists === true)
    var responseStatus = String(responseData && (responseData.status || responseData.state) || '').toLowerCase()
    var terminal = explicitComplete && responsePercent >= 100
      || /^(success|complete|completed|done)$/.test(responseStatus) && responsePercent >= 100
    downloadUpsert({
      id: id,
      roomID: roomID,
      modID: modID,
      roomName: request.roomName || request.room_name || request.gameName || undefined,
      name: request.name || request.modName || (catalogue && catalogue.name) || undefined,
      status: terminal ? 'success' : (current && current.status === 'paused' ? 'paused' : 'running'),
      stage: terminal ? 'completed' : (current && current.status === 'paused' ? 'paused' : 'downloading'),
      progress: terminal ? 100 : undefined,
      progressKnown: terminal,
      finishedAt: terminal ? downloadNow() : undefined
    })
  }

  function updateModStatus(requestUrl, payload) {
    // DMP 3.2 calls this endpoint /mod/download/progress; older builds used
    // /status. Accept both so the card does not remain at 0%.
    if (!/\/mod\/download\/(?:status|progress)(?:[/?]|$)/i.test(String(requestUrl || ''))) return
    var roomID = Number(requestQuery(requestUrl, 'roomID') || requestQuery(requestUrl, 'roomId') || 0)
    var modID = Number(requestQuery(requestUrl, 'id') || requestQuery(requestUrl, 'modID') || 0)
    if (roomID <= 0 || modID <= 0) return
    var value = payload && payload.data != null ? payload.data : payload
    var percent = typeof value === 'object'
      ? taskNumber(value, ['progress', 'percent', 'percentage', 'progressPercent'], NaN)
      : Number(value)
    if (!Number.isFinite(percent) && value && typeof value === 'object'
      && value.data != null) {
      percent = typeof value.data === 'object'
        ? taskNumber(value.data, ['progress', 'percent', 'percentage', 'progressPercent'], NaN)
        : Number(value.data)
    }
    if (!Number.isFinite(percent)) return
    percent = Math.max(0, Math.min(100, percent))
    var id = downloadTaskKey('mod_download', { serverId: downloadServerId, roomID: roomID, modID: modID })
    // Ignore worker progress after the user removed this local task. Without
    // this guard an in-flight SteamCMD status request immediately recreates a
    // deleted catalogue card and makes the delete action appear ineffective.
    if (modTaskCancelled(id)) return
    var current = downloadFind(id)
    /* The catalogue page may poll /mod/download/status for every visible
       mod, including mods the user never clicked.  A status poll alone is
       not a download intent and must not create a task row; only a row
       created by trackModDownload (or a restored native snapshot) may be
       updated here.  This prevents two clicks from turning into the whole
       catalogue in the task centre. */
    if (!current) return
    var catalogue = modCatalogueItem(modID)
    var total = current && Number(current.totalBytes) > 0 ? Number(current.totalBytes) : 0
    if (percent < 100) {
      delete modVerificationPending[id]
      modVerificationGeneration[id] = (modVerificationGeneration[id] || 0) + 1
    }
    if (percent >= 100 && !modVerificationPending[id] && apiBaseUrl
      && typeof window.fetch === 'function') {
      // The status endpoint reports the worker reaching 100%; verify that the
      // mod index can actually see the file before exposing “下载完成”. This
      // catches the old race where the worker exited before the archive was
      // copied into the room's mods directory.
      var verificationGeneration = (modVerificationGeneration[id] || 0) + 1
      modVerificationGeneration[id] = verificationGeneration
      modVerificationPending[id] = verificationGeneration
      downloadUpsert({
        id: id,
        status: 'running',
        stage: 'verifying',
        progress: 99,
        progressKnown: true,
        message: '正在确认模组文件'
      })
      window.fetch(apiBaseUrl + '/v3/mod/downloaded/ids?roomID=' + encodeURIComponent(roomID), {
        method: 'GET',
        cache: 'no-store',
        headers: { 'X-DMP-TOKEN': apiToken, 'X-I18n-Lang': 'zh' }
      }).then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status)
        return response.json()
      }).then(function (result) {
        if (modTaskCancelled(id)
          || modVerificationGeneration[id] !== verificationGeneration) return
        var data = result && result.data
        if (!Array.isArray(data)) throw new Error('invalid downloaded ids')
        var found = data.some(function (value) {
          var candidate = value && typeof value === 'object'
            ? (value.id || value.modID || value.modId) : value
          return Number(candidate) === modID
        })
        if (found) {
          downloadUpsert({ id: id, status: 'success', stage: 'completed', progress: 100,
            progressKnown: true, finishedAt: downloadNow(), message: '' })
        } else {
          downloadUpsert({ id: id, status: 'running', stage: 'verifying', progress: 99,
            progressKnown: true, message: '服务器尚未发现模组文件' })
        }
      }).catch(function () {
        if (modTaskCancelled(id)
          || modVerificationGeneration[id] !== verificationGeneration) return
        // A legacy host may not expose downloaded/ids. The status endpoint is
        // still authoritative there; do not strand a real completed download.
        downloadUpsert({ id: id, status: 'success', stage: 'completed', progress: 100,
          progressKnown: true, finishedAt: downloadNow() })
      }).then(function () {
        if (modVerificationGeneration[id] === verificationGeneration) {
          delete modVerificationPending[id]
        }
      })
      return
    }
    // The status endpoint reports 0 while SteamCMD is preparing the archive.
    // Keep 0.0% for a genuinely queued row, but use the indeterminate bar once
    // the job is running so the UI does not look frozen at a false percentage.
    // A freshly queued 0% job has no measurable bytes yet. Mark it unknown
    // so the catalogue card shows the old indeterminate blue mask instead of
    // a misleading frozen 0px bar. Once the status endpoint reports >0%, the
    // mask switches to a precise width.
    var progressKnown = percent > 0 || percent >= 100
    downloadUpsert({
      id: id,
      status: percent >= 100 ? 'success' : (current && current.status === 'paused' ? 'paused' : 'running'),
      stage: percent >= 100 ? 'completed' : (current && current.status === 'paused' ? 'paused' : 'downloading'),
      name: current && current.name || catalogue && catalogue.name || undefined,
      progress: percent,
      progressKnown: progressKnown,
      completedBytes: total ? Math.round(total * percent / 100) : undefined,
      finishedAt: percent >= 100 ? downloadNow() : undefined
    })
  }

  function updateGameResponse(requestUrl, body, payload) {
    if (!/\/dashboard\/exec\/game(?:[/?]|$)/i.test(String(requestUrl || ''))) return
    var request = requestPayload(body)
    if (!request || String(request.type || '').toLowerCase() !== 'update') return
    var id = downloadTaskKey('game_update', { serverId: downloadServerId })
    if (!responseOK(payload)) {
      downloadUpsert({ id: id, status: 'error', stage: 'failed', error: payload && payload.message || '服务器更新请求失败', serverLastUpdating: false })
    } else {
      downloadUpsert({ id: id, status: 'running', stage: 'updating', progressKnown: false, serverLastUpdating: true })
    }
  }

  function updateGameStatus(requestUrl, payload) {
    if (!/\/dashboard\/info\/sys(?:[/?]|$)/i.test(String(requestUrl || ''))) return
    var value = payload && payload.data && typeof payload.data === 'object' ? payload.data : payload
    if (!value || typeof value !== 'object') return
    var task = null
    for (var i = downloadTaskList.length - 1; i >= 0; i--) {
      if (downloadTaskList[i].type === 'game_update') { task = downloadTaskList[i]; break }
    }
    if (!task) return
    var updating = value.updating === true || value.updating === 1 || value.updating === 'true'
    if (updating) {
      downloadUpsert({ id: task.id, status: 'running', stage: 'updating', progressKnown: false, serverUpdateObserved: true, serverLastUpdating: true })
    } else if (task.serverUpdateObserved && task.serverLastUpdating) {
      downloadUpsert({ id: task.id, status: 'success', stage: 'completed', progress: 100, progressKnown: true, serverLastUpdating: false, finishedAt: downloadNow() })
    }
  }

  function observeDownloadResponse(requestUrl, method, body, payload) {
    if (/\/tools\/backup(?:[/?]|$)/i.test(String(requestUrl || ''))
        && !/\/tools\/backup\/download(?:[/?]|$)/i.test(String(requestUrl || ''))) {
      if (typeof window.__dmpRememberBackupList === 'function') {
        window.__dmpRememberBackupList(payload)
      }
    }
    if (/\/mod\/search(?:[/?]|$)/i.test(String(requestUrl || ''))) {
      rememberModCatalogue(payload)
    }
    if (/\/mod\/downloaded(?:\/ids)?(?:[/?]|$)/i.test(String(requestUrl || ''))) {
      rememberDownloadedDetails(payload)
    }
    if (String(method || 'GET').toUpperCase() === 'POST') {
      updateModResponse(requestUrl, body, payload)
      updateGameResponse(requestUrl, body, payload)
    } else {
      updateModStatus(requestUrl, payload)
      updateGameStatus(requestUrl, payload)
    }
  }

  /* The bridge wraps fetch so it can observe only the small set of DMP API
     responses that carry download/catalogue state.  Cloning every response
     (including map images and unrelated page payloads) forces the older
     Android WebView to decode those bodies a second time and was a major
     source of apparent freezes while opening heavier routes. */
  function shouldInspectDownloadResponse(requestUrl) {
    var url = String(requestUrl || '')
    if (/\/tools\/backup(?:[/?]|$)/i.test(url)
        && !/\/tools\/backup\/download(?:[/?]|$)/i.test(url)) return true
    if (/\/mod\/(?:search|downloaded(?:\/ids)?|download(?:\/(?:status|progress))?)(?:[/?]|$)/i.test(url)) return true
    return /\/dashboard\/(?:exec\/game|info\/sys)(?:[/?]|$)/i.test(url)
  }

  // The desktop build normally sends this request through axios/XHR, but a
  // few pages (notably the legacy "后台更新" action) use fetch instead.  Keep
  // one detector for both transports so an update always gets a stable row in
  // the download centre.  The detector is deliberately side-effect free: it
  // only records the request after the UI has already decided to submit it.
  function trackGameUpdate(requestUrl, body) {
    if (!/\/dashboard\/exec\/game(?:[/?]|$)/i.test(String(requestUrl || ''))) {
      return
    }
    var payload = requestPayload(body)
    if (!payload || String(payload.type || '').toLowerCase() !== 'update') return
    var task = {
      id: downloadTaskKey('game_update', { serverId: downloadServerId }),
      serverId: downloadServerId,
      serverName: downloadServerName,
      serverHost: window.__dmpServerHost || '',
      type: 'game_update',
      roomID: Number(payload.roomID || payload.roomId || 0) || 0,
      name: '服务器更新',
      status: 'queued',
      stage: 'updating',
      progress: 0,
      progressKnown: false,
      serverTask: true,
      serverUpdateObserved: false,
      serverLastUpdating: true,
      canPause: false,
      update: true,
      createdAt: downloadNow()
    }
    pendingGameUpdates.push({ createdAt: task.createdAt, url: String(requestUrl) })
    downloadUpsert(task)
  }

  function trackModDownload(requestUrl, body) {
    if (!/\/mod\/download(?:[/?]|$)/i.test(String(requestUrl || ''))) return
    var payload = requestPayload(body)
    var roomId = taskNumber(payload, ['roomID', 'roomId', 'room_id'], 0)
    var modId = taskNumber(payload, ['id', 'modID', 'modId', 'mod_id'], 0)
    if (!Number.isFinite(roomId) || roomId <= 0 || !Number.isFinite(modId) || modId <= 0) return
    var taskId = downloadTaskKey('mod_download', { serverId: downloadServerId, roomID: roomId, modID: modId })
    // This path runs at XHR.send time for a new catalogue click. A delayed
    // response from a cancelled attempt never enters trackModDownload, so it
    // cannot clear the tombstone and resurrect the card.
    var intent = modDownloadIntents[taskId]
    if (intent && (!intent.at || downloadNow() - intent.at < 120000)) {
      delete modDownloadIntents[taskId]
    }
    /* This hook runs at XHR.send time, before any response can arrive.  It is
       therefore a genuine new catalogue click rather than a late callback
       from an attempt the user already removed; allow this explicit download
       to reuse the same room/mod key. */
    clearModTaskCancelled(taskId)
    var catalogue = modCatalogueItem(modId)
    downloadUpsert({
      id: taskId,
      serverId: downloadServerId,
      serverName: downloadServerName,
      serverHost: window.__dmpServerHost || '',
      type: 'mod_download',
      roomID: roomId,
      roomName: payload.roomName || payload.room_name || payload.gameName || '',
      modID: modId,
      name: payload.name || payload.modName || (catalogue && catalogue.name) || ('模组 ' + modId),
      // Keep the source URL in the token-free snapshot so the native
      // aggregate task card can retry after its WebView has been recreated.
      file_url: payload.file_url || payload.fileUrl || (catalogue && catalogue.file_url) || '',
      status: 'queued',
      stage: 'queued',
      progress: 0,
      // DMP 3.2 reports 0 while Steam is preparing the archive. Keep this
      // unknown until /mod/download/status returns a real percentage so the
      // legacy animated progress treatment is visible immediately.
      progressKnown: false,
      totalBytes: taskNumber(payload, ['size', 'totalBytes', 'bytesTotal'], 0),
      update: !!payload.update,
      serverTask: true,
       // LinuxDMP has no safe pause/continue endpoint; keep the persisted
       // task explicitly non-pausable even if an older renderer inspects it.
       canPause: false,
      createdAt: downloadNow()
    })
  }

  function historyLineLimit () {
    var value = Number(window.__dmpHistoryLineLimit || 300)
    if (!Number.isFinite(value) || value <= 0) value = 300
    return Math.max(50, Math.min(5000, Math.floor(value)))
  }

  function trimHistoryText (value) {
    if (typeof value !== 'string') return value
    var limit = historyLineLimit()
    var lines = value.split(/\r?\n/)
    if (lines.length <= limit) return value
    /* Keep the tail: historical server logs are append-only and the newest
       lines are the useful part when opening a file on a small screen. */
    return '[Android] 已限制显示最近 ' + limit + ' 行（原日志仍保留在服务器）\n'
      + lines.slice(Math.max(0, lines.length - limit)).join('\n')
  }

  function capHistoryPayload (value) {
    if (typeof value === 'string') return trimHistoryText(value)
    if (Array.isArray(value)) {
      if (value.every(function (item) { return typeof item === 'string' })) {
        var joined = trimHistoryText(value.join('\n'))
        return joined.split(/\r?\n/)
      }
      return value
    }
    if (value && typeof value === 'object'
        && Object.prototype.hasOwnProperty.call(value, 'data')) {
      /* Axios normally receives a JSON object with a `data` field.  Clone
         only that field so response metadata/status remains unchanged. */
      var copy = {}
      Object.keys(value).forEach(function (key) { copy[key] = value[key] })
      copy.data = capHistoryPayload(value.data)
      return copy
    }
    return value
  }

  function capHistoryResponse (raw) {
    if (typeof raw !== 'string' || !raw) return raw
    try {
      var parsed = JSON.parse(raw)
      return JSON.stringify(capHistoryPayload(parsed))
    } catch (ignored) {
      return trimHistoryText(raw)
    }
  }

  XMLHttpRequest.prototype.open = function (method, url) {
    var args = Array.prototype.slice.call(arguments)
    args[1] = rewriteApiUrl(url)
    this.__dmpRequestMethod = String(method || 'GET').toUpperCase()
    this.__dmpRequestUrl = String(args[1] || '')
    /* Historical log files are returned as one complete string by the
       LinuxDMP API.  A multi-megabyte file makes md-editor-v3 parse and lay
       out every line before the user can scroll, which is especially costly
       on a handset.  Keep the server/API untouched: for this one endpoint
       only, cap the response exposed to Axios at the most recent N lines.
       The limit is controlled by dmp-personal-design.js and defaults to a
       conservative 300 lines when that page has not mounted yet. */
    if (/\/logs\/history\/content(?:[/?]|$)/i.test(this.__dmpRequestUrl || '')) {
      this.__dmpHistoryContentRequest = true
      try {
        var responseTextDescriptor = Object.getOwnPropertyDescriptor(
          XMLHttpRequest.prototype, 'responseText')
        if (responseTextDescriptor && typeof responseTextDescriptor.get === 'function'
            && !this.__dmpHistoryResponseTextWrapped) {
          this.__dmpHistoryResponseTextWrapped = true
          Object.defineProperty(this, 'responseText', {
            configurable: true,
            enumerable: false,
            get: function () {
              var raw = responseTextDescriptor.get.call(this)
              return capHistoryResponse(raw)
            }
          })
        }
      } catch (ignored) {}
      try {
        var responseDescriptor = Object.getOwnPropertyDescriptor(
          XMLHttpRequest.prototype, 'response')
        if (responseDescriptor && typeof responseDescriptor.get === 'function'
            && !this.__dmpHistoryResponseWrapped) {
          this.__dmpHistoryResponseWrapped = true
          Object.defineProperty(this, 'response', {
            configurable: true,
            enumerable: false,
            get: function () {
              var rawResponse = responseDescriptor.get.call(this)
              return capHistoryPayload(rawResponse)
            }
          })
        }
      } catch (ignored) {}
    }
    return nativeXhrOpen.apply(this, args)
  }
  XMLHttpRequest.prototype.send = function (body) {
    trackGameUpdate(this.__dmpRequestUrl, body)
    trackModDownload(this.__dmpRequestUrl, body)
    if (/\/tools\/backup\/download(?:[/?]|$)/i.test(String(this.__dmpRequestUrl || ''))
      && typeof window.__dmpNativeBackupDownload === 'function') {
      window.__dmpNativeBackupDownload(this.__dmpRequestUrl,
        requestQuery(this.__dmpRequestUrl, 'filename') || 'dmp_backup.zip')
    }
    var xhr = this
    this.addEventListener('load', function () {
      // Read the rolling token even when the response is a business error or
      // a binary backup export; the header is independent of response parsing.
      captureNewToken(xhr, xhr.__dmpRequestUrl)
      // Axios requests the backup export as a Blob.  Reading responseText for
      // a Blob response throws InvalidStateError in Android WebView and can
      // turn an otherwise successful export into a false download failure.
      // The native DownloadManager route already owns this transfer, so skip
      // response inspection for that endpoint entirely.
      if (/\/tools\/backup\/download(?:[/?]|$)/i.test(String(xhr.__dmpRequestUrl || ''))) return
      var responseText = ''
      try { responseText = xhr.responseType === 'text' || xhr.responseType === '' ? xhr.responseText : '' } catch (ignored) {}
      observeDownloadResponse(xhr.__dmpRequestUrl, xhr.__dmpRequestMethod, body, responsePayload(responseText))
    })
    this.addEventListener('error', function () {
      var request = requestPayload(body)
      if (/\/dashboard\/exec\/game(?:[/?]|$)/i.test(xhr.__dmpRequestUrl)
          && request && String(request.type || '').toLowerCase() === 'update') {
        downloadUpsert({ id: downloadTaskKey('game_update', { serverId: downloadServerId }), status: 'error', stage: 'failed', error: '网络请求失败' })
      }
      if (/\/mod\/download(?:[/?]|$)/i.test(xhr.__dmpRequestUrl)
          && request && taskNumber(request, ['roomID', 'roomId', 'room_id'], 0) > 0
          && taskNumber(request, ['id', 'modID', 'modId', 'mod_id'], 0) > 0) {
        var failedModId = downloadTaskKey('mod_download', {
          serverId: downloadServerId,
          roomID: taskNumber(request, ['roomID', 'roomId', 'room_id'], 0),
          modID: taskNumber(request, ['id', 'modID', 'modId', 'mod_id'], 0)
        })
        if (!modTaskCancelled(failedModId)) {
          downloadUpsert({ id: failedModId, status: 'error', stage: 'failed', error: '网络请求失败' })
        }
      }
    })
    return nativeXhrSend.apply(this, arguments)
  }

  if (window.fetch) {
    var nativeFetch = window.fetch.bind(window)
    window.fetch = function (input, init) {
      if (typeof input === 'string') {
        var rewrittenUrl = rewriteApiUrl(input)
        var requestMethod = String(init && init.method || 'GET').toUpperCase()
        var requestBody = init && init.body
        trackGameUpdate(rewrittenUrl, requestBody)
        trackModDownload(rewrittenUrl, requestBody)
        var safeInit = stripExternalAuthHeaders(rewrittenUrl, init)
        return nativeFetch(rewrittenUrl, safeInit).then(function (response) {
          captureNewToken(response, rewrittenUrl)
          if (shouldInspectDownloadResponse(rewrittenUrl)) {
            try {
              response.clone().text().then(function (text) {
                observeDownloadResponse(rewrittenUrl, requestMethod, requestBody, responsePayload(text))
              }).catch(function () {})
            } catch (ignored) {}
          }
          return response
        })
      }
      if (input && input.url) {
        var originalUrl = input.url
        var rewritten = rewriteApiUrl(input.url)
        var inputMethod = String(input.method || (init && init.method) || 'GET').toUpperCase()
        var inputBody = init && init.body !== undefined ? init.body : null
        if (rewritten !== input.url && typeof Request === 'function') input = new Request(rewritten, input)
        if (init && init.body !== undefined) {
          trackGameUpdate(rewritten, inputBody)
          trackModDownload(rewritten, inputBody)
        } else if (typeof input.clone === 'function'
            && inputMethod === 'POST') {
          // Reading a clone leaves the request body available to fetch.  This
          // covers callers that pass a pre-built Request object.
          try {
            input.clone().text().then(function (text) {
              trackGameUpdate(rewritten || originalUrl, text)
              trackModDownload(rewritten || originalUrl, text)
            }).catch(function () {})
          } catch (ignored) {}
        }
      }
      var safeRequestUrl = rewritten || originalUrl
      if (!isDmpApiOrigin(safeRequestUrl)
          && input && input.url && (!init || !init.headers)
          && typeof Request === 'function' && typeof Headers !== 'undefined') {
        try {
          var safeRequestHeaders = new Headers(input.headers || {})
          safeRequestHeaders.delete('X-DMP-TOKEN')
          safeRequestHeaders.delete('Authorization')
          input = new Request(input, { headers: safeRequestHeaders })
        } catch (ignored) {}
      }
      var safeRequestInit = stripExternalAuthHeaders(safeRequestUrl, init)
      return nativeFetch(input, safeRequestInit).then(function (response) {
        captureNewToken(response, rewritten || originalUrl)
        if (shouldInspectDownloadResponse(rewritten || originalUrl)) {
          try {
            response.clone().text().then(function (text) {
              observeDownloadResponse(rewritten || originalUrl, inputMethod, inputBody, responsePayload(text))
            }).catch(function () {})
          } catch (ignored) {}
        }
        return response
      })
    }
  }

  if (window.WebSocket && apiBaseUrl) {
    var NativeWebSocket = window.WebSocket
    var wsBaseUrl = apiBaseUrl.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:')
    window.WebSocket = function (url, protocols) {
      var raw = String(url || '')
      if (/^wss?:\/\/\/v3(?:\/|$)/i.test(raw) || /^\/v3(?:\/|$)/i.test(raw)) {
        raw = wsBaseUrl + raw.replace(/^wss?:\/\/\//i, '/').replace(/^\/v3/i, '/v3')
      }
      return protocols === undefined ? new NativeWebSocket(raw) : new NativeWebSocket(raw, protocols)
    }
    window.WebSocket.prototype = NativeWebSocket.prototype
    Object.defineProperties(window.WebSocket, {
      CONNECTING: { value: NativeWebSocket.CONNECTING },
      OPEN: { value: NativeWebSocket.OPEN },
      CLOSING: { value: NativeWebSocket.CLOSING },
      CLOSED: { value: NativeWebSocket.CLOSED }
    })
  }

  var pageBackground = bootstrap.theme === 'dark' ? '#24213D' : '#F4F2FA'
  document.documentElement.style.backgroundColor = pageBackground
  var transitionStyle = document.createElement('style')
  transitionStyle.textContent = [
    'html, body, #app, #loading-bg { background-color: ' + pageBackground + ' !important; }',
    '#app { opacity: 1; transition: opacity .22s cubic-bezier(.2,.8,.2,1), background-color .3s ease; }',
    'html.android-route-changing #app { opacity: .84; }',
    '.v-btn, button { -webkit-tap-highlight-color: transparent !important; }',
    '.v-btn .v-btn__overlay, .v-btn .v-ripple__container, button .v-ripple__container { display: none !important; opacity: 0 !important; }',
    '.v-btn:active { filter: brightness(.94); }',
    '@media (prefers-reduced-motion: reduce) { #app { transition-duration: .01ms !important; } }'
  ].join('\n')
  document.head.appendChild(transitionStyle)

  var routeTransitionTimer
  function beginRouteTransition() {
    window.clearTimeout(routeTransitionTimer)
    document.documentElement.classList.add('android-route-changing')
    routeTransitionTimer = window.setTimeout(function () {
      document.documentElement.classList.remove('android-route-changing')
    }, 260)
  }
  document.addEventListener('click', function (event) {
    if (event.target.closest('a[href*="#/"], [data-route], .v-list-item')) {
      beginRouteTransition()
    }
  }, true)
  window.addEventListener('hashchange', beginRouteTransition)

  /* Axios in the official bundle redirects a 420 response to /login.  On
     Android the native bootstrap still contains the token for the current
     server, so the router can process that intermediate /login with a stale
     Pinia token and immediately land on /rooms.  That made a transient API
     error look like a random jump from 历史日志/添加模组 back to the room
     overview.  Remember the last leaf route and undo only an unrequested
     /login -> /rooms fallback; explicit room-overview navigation remains
     untouched. */
  ;(function installAndroidRouteContinuity() {
    function path() {
      return String(window.location && window.location.hash || '')
        .replace(/^#/, '').split('?')[0] || '/'
    }
    function routeFromElement(element) {
      if (!element) return ''
      var node = element.closest
        ? element.closest('a[href], [data-route], [to]') : null
      if (!node) return ''
      var raw = node.getAttribute('data-route') || node.getAttribute('to')
        || node.getAttribute('href') || ''
      raw = String(raw).trim()
      var hash = raw.indexOf('#')
      if (hash >= 0) raw = raw.slice(hash + 1)
      if (raw.charAt(0) !== '/') return ''
      return raw.split('?')[0]
    }
    var state = {
      stable: path(),
      expected: '',
      expectedUntil: 0,
      restoring: false
    }
    /* A normal platform launch starts at /rooms.  Do not invent /dashboard
       as a fallback here: doing so would turn every clean launch into an
       immediate room-overview -> dashboard navigation.  The startup block
       above supplies a leaf only when a same-WebView auth redirect actually
       left one in sessionStorage. */
    if (!/^\/(?:dashboard|game|tools|logs|upload|install|platform)(?:\/|$)/i.test(state.stable)) {
      state.stable = ''
    }
    document.addEventListener('click', function (event) {
      var target = routeFromElement(event.target)
      if (!target) {
        /* The generated Vuetify drawer can render a router item without a
           route attribute.  Identify only the localized room-overview item
           as a conservative fallback so an explicit tap cannot be mistaken
           for an auth redirect. */
        var item = event.target && event.target.closest
          ? event.target.closest('.v-list-item,a,button') : null
        var label = item && String(item.innerText || item.textContent || '').trim()
        if (label === '房间总览' || label === 'Room Overview') target = '/rooms'
      }
      if (!target) return
      state.expected = target
      state.expectedUntil = Date.now() + 1400
      try {
        if (target === '/rooms') {
          sessionStorage.setItem('dmp-android-explicit-rooms-at', String(Date.now()))
          sessionStorage.removeItem('dmp-android-last-leaf-route')
          sessionStorage.removeItem('dmp-android-last-leaf-at')
        }
      } catch (ignored) {}
    }, true)
    function settle() {
      var current = path()
      var expected = state.expected && Date.now() < state.expectedUntil
        ? state.expected : ''
      /* Some Vuetify navigation items expose their destination through a
         router callback rather than an href/data-route attribute, so the
         capture-phase click above cannot always identify an explicit
         /rooms visit.  The click handler and native Back path both persist
         this short-lived marker; consume it here before the last-leaf guard
         has a chance to restore the control panel. */
      var explicitRooms = false
      try {
        var explicitAt = Number(sessionStorage.getItem('dmp-android-explicit-rooms-at') || 0)
        explicitRooms = explicitAt > 0 && Date.now() - explicitAt < 2500
      } catch (ignored) {}
      if (current === '/rooms' && (expected === '/rooms' || explicitRooms)) {
        state.stable = '/rooms'
        state.expected = '/rooms'
        state.expectedUntil = Date.now() + 2500
        state.restoring = false
        try {
          sessionStorage.removeItem('dmp-android-last-leaf-route')
          sessionStorage.removeItem('dmp-android-last-leaf-at')
        } catch (ignored) {}
      }
      if (current === '/login' || current === '/rooms') {
        if (!expected && state.stable && state.stable !== '/rooms'
            && state.stable !== '/login' && !state.restoring) {
          state.restoring = true
          window.setTimeout(function () {
            state.restoring = false
            var latest = path()
            if ((latest === '/login' || latest === '/rooms')
                && state.stable && state.stable !== '/rooms') {
              window.location.hash = '#' + state.stable
            }
          }, 80)
        }
        return
      }
      if (/^\/(?:dashboard|game|tools|logs|upload|install|platform)(?:\/|$)/i.test(current)) {
        state.stable = current
        try {
          sessionStorage.setItem('dmp-android-last-leaf-route', current)
          sessionStorage.setItem('dmp-android-last-leaf-at', String(Date.now()))
        } catch (ignored) {}
      }
    }
    window.addEventListener('hashchange', settle)
    window.setInterval(settle, 500)
  })()

  /* Android System WebView versions shipped before Chromium 84 expose the
     legacy MediaQueryList.addListener API but not addEventListener.  The
     menu and room-preview split-pane guards must remain optional on those
     devices: an unguarded call aborts the mount function and leaves route
     navigation in a half-installed state. */
  function watchAndroidMediaQuery(query, listener) {
    if (!query || typeof listener !== 'function') return
    try {
      if (typeof query.addEventListener === 'function') {
        query.addEventListener('change', listener)
      } else if (typeof query.addListener === 'function') {
        query.addListener(listener)
      }
    } catch (ignored) {}
  }

  if (bootstrap.roomPreview) {
    installRoomPreviewMenu()
  } else {
    installPlatformMenuFix()
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value))
  }

  function installRoomPreviewMenu() {
    document.documentElement.classList.add('android-room-preview')

    var style = document.createElement('style')
    style.textContent = [
      'body.android-room-preview .layout-vertical-nav,',
      'body.android-room-preview .layout-overlay { display: none !important; }',
      'body.android-room-preview .layout-content-wrapper { padding-inline-start: 0 !important; }',
      'body.android-room-preview .layout-navbar .d-lg-none { visibility: hidden !important; }',
      'body.android-room-preview { overflow-x: hidden; background: rgb(var(--v-theme-surface-variant)); }',
      'body.android-room-preview .layout-wrapper { margin: 0 !important; padding: 0 !important; min-width: 0 !important; max-width: 100vw !important; width: 100vw !important; }',
      'body.android-room-preview .layout-content-wrapper { position: relative; z-index: 2; min-width: 0 !important; max-width: 100vw !important; width: 100vw !important; box-sizing: border-box !important; overflow-x: hidden; border-radius: 0 !important; box-shadow: none !important; background: rgb(var(--v-theme-background)); transform: translateX(0); transition: transform .38s cubic-bezier(.22,1,.36,1), width .38s cubic-bezier(.22,1,.36,1); will-change: transform, width; }',
      'body.android-room-preview .layout-page-content, body.android-room-preview .page-content-container, body.android-room-preview .v-main, body.android-room-preview .v-container { min-width: 0 !important; max-width: 100% !important; box-sizing: border-box !important; }',
      'body.android-room-preview .layout-navbar, body.android-room-preview .navbar-content-container, body.android-room-preview .layout-page-content, body.android-room-preview .page-content-container { border-radius: 0 !important; box-shadow: none !important; -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }',
      /* The dark-theme surface rule later targets every direct child of
         body.  The fixed room-menu root is one of those children, so without
         this override it becomes an opaque rail and hides the left side of
         the preview page (including the room name).  Its child controls
         provide their own surfaces; the root itself must stay transparent. */
      'html.android-dmp-dark body.android-room-preview > #android-room-menu { background: transparent !important; }',
      'html.android-dmp-dark body.android-room-preview > #android-room-menu-backdrop { background: rgba(15,12,30,.18) !important; }',
      'body.android-room-preview .layout-navbar { position: sticky !important; inset-block-start: 0 !important; z-index: 2147483638 !important; flex: 0 0 auto !important; }',
      'body.android-room-preview.android-room-menu-open .layout-content-wrapper { transform: translateX(88px); }',
      '@media (orientation: landscape) and (min-width: 900px) { body.android-room-preview.android-room-menu-open .layout-content-wrapper { width: calc(100vw - 88px) !important; max-width: calc(100vw - 88px) !important; } }',
      /* Keep the body-level trigger visible even if a route transition briefly
         recreates #app.  The explicit display/visibility/opacity declarations
         also win over the upstream toolbar's compact-button rules. */
      '#android-room-menu { position: fixed; z-index: 2147483640; inset: 0 auto 0 0; inline-size: 88px; pointer-events: none; display: block !important; visibility: visible !important; opacity: 1 !important; }',
      '#android-room-menu button { border: 0; color: rgb(var(--v-theme-on-surface)); background: rgb(var(--v-theme-surface)); cursor: pointer; -webkit-tap-highlight-color: transparent; }',
      '#android-room-menu .room-menu-trigger { position: fixed; inset-block-start: 8px; inset-inline-start: 10px; display: grid !important; visibility: visible !important; opacity: 1 !important; place-items: center; inline-size: 46px; block-size: 46px; z-index: 2147483641; border-radius: 14px; font-size: 25px; pointer-events: auto; transition: transform .38s cubic-bezier(.22,1,.36,1), color .22s ease, background-color .22s ease; }',
      '#android-room-menu .room-menu-trigger::before { content: "☰"; display: block; font-size: 28px; line-height: 1; }',
      '#android-room-menu .room-menu-trigger > i { display: none !important; }',
      '#android-room-menu.open .room-menu-trigger { color: rgb(var(--v-theme-primary)); transform: translateX(88px) rotate(90deg); }',
      '#android-room-menu .room-menu-logo { position: fixed; inset-block-start: 9px; inset-inline-start: 14px; inline-size: 50px; block-size: 44px; object-fit: contain; opacity: 0; pointer-events: none; transform: translateX(-24px); transition: opacity .18s ease, transform .32s cubic-bezier(.22,1,.36,1); }',
      '#android-room-menu.open .room-menu-logo { opacity: 1; transform: translateX(0); }',
      '#android-room-menu .room-menu-panel { position: fixed; inset-block-start: 72px; inset-block-end: 18px; inset-inline-start: 10px; display: flex; flex-direction: column; justify-content: flex-start; gap: 10px; inline-size: 58px; padding: 6px; border-radius: 20px; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; opacity: 0; pointer-events: none; transform: translateX(-34px); transition: opacity .24s ease, transform .38s cubic-bezier(.22,1,.36,1); }',
      '#android-room-menu .room-menu-panel::-webkit-scrollbar { display: none; }',
      '#android-room-menu.open .room-menu-panel { opacity: 1; pointer-events: auto; transform: translateX(0); }',
      '#android-room-menu .room-menu-item { display: grid; place-items: center; inline-size: 46px; block-size: 46px; border-radius: 14px; font-size: 23px; opacity: 0; transform: translateX(-18px) scale(.9); transition: opacity .2s ease, transform .34s cubic-bezier(.22,1,.36,1), color .18s ease, background-color .18s ease; }',
      '#android-room-menu.open .room-menu-item { opacity: 1; transform: translateX(0) scale(1); }',
      '#android-room-menu.open .room-menu-item:nth-child(2) { transition-delay: 45ms; }',
      '#android-room-menu.open .room-menu-item:nth-child(3) { transition-delay: 80ms; }',
      '#android-room-menu.open .room-menu-item:nth-child(4) { transition-delay: 115ms; }',
      '#android-room-menu.open .room-menu-item:nth-child(5) { transition-delay: 150ms; }',
      '#android-room-menu.open .room-menu-item:nth-child(6) { transition-delay: 185ms; }',
      '#android-room-menu .room-menu-item.active { color: rgb(var(--v-theme-on-primary)); background: rgb(var(--v-theme-primary)); }',
      '#android-room-menu .room-menu-item:active { transform: scale(.9); }',
      '#android-room-menu-backdrop { position: fixed; z-index: 2147483639; inset: 0 0 0 88px; background: rgba(15,12,30,.18); opacity: 0; visibility: hidden; pointer-events: none; transition: opacity .3s ease, visibility .3s ease; }',
      '#android-room-menu-backdrop.open { opacity: 1; visibility: visible; pointer-events: auto; }',
      '@media (orientation: landscape) and (min-width: 900px) { #android-room-menu-backdrop { display: none !important; } }',
      '@media (prefers-reduced-motion: reduce) { #android-room-menu *, #android-room-menu-backdrop { transition-duration: 0.01ms !important; } }'
    ].join('\n')
    document.head.appendChild(style)

    function mount() {
      if (document.getElementById('android-room-menu')) return

      document.body.classList.add('android-room-preview')

      var root = document.createElement('div')
      root.id = 'android-room-menu'
      // Keep the fixed root transparent even when the dark-theme pass adds a
      // background to every direct body child.  Only its child controls may
      // draw a surface; the root must not paint over page content.
      root.style.setProperty('background', 'transparent', 'important')
      root.innerHTML = [
        '<button class="room-menu-trigger" type="button" aria-label="房间快捷菜单" aria-expanded="false"><i class="ri-menu-line"></i></button>',
        '<img class="room-menu-logo" src="dmp.png" alt="DMP">',
        '<div class="room-menu-panel" role="menu">',
        '<button class="room-menu-item" type="button" data-route="/dashboard" aria-label="控制面板" title="控制面板"><i class="ri-function-ai-line"></i></button>',
        '<button class="room-menu-item" type="button" data-route="/tools/map" aria-label="地图预览" title="地图预览"><i class="ri-road-map-line"></i></button>',
        '<button class="room-menu-item" type="button" data-route="/tools/tmi" aria-label="TMI" title="TMI"><i class="ri-ghost-line"></i></button>',
        '<button class="room-menu-item" type="button" data-route="/logs/game" aria-label="游戏日志" title="游戏日志"><i class="ri-game-line"></i></button>',
        '<button class="room-menu-item" type="button" data-route="/logs/chat" aria-label="聊天日志" title="聊天日志"><i class="ri-chat-smile-3-line"></i></button>',
        '</div>'
      ].join('')
      var backdrop = document.createElement('div')
      backdrop.id = 'android-room-menu-backdrop'
      backdrop.setAttribute('aria-hidden', 'true')
      document.body.appendChild(backdrop)
      document.body.appendChild(root)

      var trigger = root.querySelector('.room-menu-trigger')
      var items = root.querySelectorAll('.room-menu-item')
      var wideLandscapeQuery = window.matchMedia
        ? window.matchMedia('(orientation: landscape) and (min-width: 900px)')
        : { matches: false }

      function isWideLandscape() {
        return wideLandscapeQuery.matches
      }

      function syncOpenState(open) {
        root.classList.toggle('open', open)
        document.body.classList.toggle('android-room-menu-open', open)
        backdrop.classList.toggle('open', open && !isWideLandscape())
        trigger.setAttribute('aria-expanded', open ? 'true' : 'false')
      }

      function closeMenu(force) {
        if (isWideLandscape() && !force) return
        syncOpenState(false)
      }

      function updateActive() {
        var route = window.location.hash.replace(/^#/, '').split('?')[0] || '/dashboard'
        items.forEach(function (item) {
          item.classList.toggle('active', item.getAttribute('data-route') === route)
        })
      }

      trigger.addEventListener('click', function (event) {
        event.stopPropagation()
        syncOpenState(!root.classList.contains('open'))
      })
      backdrop.addEventListener('click', function (event) {
        event.preventDefault()
        event.stopPropagation()
        closeMenu(true)
      })
      items.forEach(function (item) {
        item.addEventListener('click', function (event) {
          event.stopPropagation()
          window.location.hash = '#' + item.getAttribute('data-route')
          closeMenu()
        })
      })
      window.addEventListener('hashchange', function () {
        closeMenu()
        updateActive()
      })
      watchAndroidMediaQuery(wideLandscapeQuery, function () {
        syncOpenState(root.classList.contains('open'))
      })
      updateActive()
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mount, { once: true })
    } else {
      mount()
    }
    /* The native room-preview WebView can replace #app after the first route
       commit.  Recreate the body-level menu if that happens; mount() is
       idempotent and returns immediately while the existing root is present. */
    window.setInterval(function () {
      if (document.body && !document.getElementById('android-room-menu')) mount()
    }, 500)
  }

  function installPlatformMenuFix() {
    var style = document.createElement('style')
    style.textContent = [
      'body.android-platform-view { overflow-x: hidden; background: rgb(var(--v-theme-surface-variant)); }',
      'body.android-platform-view .layout-content-wrapper { position: relative; z-index: 2; flex: 1 1 auto; min-inline-size: 0 !important; max-inline-size: 100% !important; box-sizing: border-box !important; padding-inline-start: 0 !important; border-radius: 0 !important; box-shadow: none !important; background: rgb(var(--v-theme-background)); transform: translateX(0); transition: width .24s cubic-bezier(.22,1,.36,1), max-width .24s cubic-bezier(.22,1,.36,1), flex-basis .24s cubic-bezier(.22,1,.36,1), transform .38s cubic-bezier(.22,1,.36,1) !important; will-change: width, max-width, flex-basis, transform; }',
      'body.android-platform-view .layout-navbar, body.android-platform-view .navbar-content-container, body.android-platform-view .layout-page-content, body.android-platform-view .page-content-container { border-radius: 0 !important; box-shadow: none !important; -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }',
      'body.android-platform-view .layout-navbar { position: sticky !important; inset-block-start: 0 !important; z-index: 2147483638 !important; flex: 0 0 auto !important; }',
      'body.android-platform-view .layout-navbar .d-lg-none { display: flex !important; visibility: visible !important; }',
      /* Keep the closed drawer out of the hit-test tree.  Its fixed 260px
         box remains over the first tab/left content column when opacity is
         zero; on Android that made 添加模组 look like it jumped back to
         房间总览 because the invisible drawer consumed the tap. */
      'body.android-platform-view .layout-vertical-nav { position: fixed !important; z-index: 1 !important; opacity: 0 !important; pointer-events: none !important; box-shadow: none !important; transform: translateX(-28px) !important; transition: opacity .24s ease, transform .38s cubic-bezier(.22,1,.36,1) !important; }',
      'body.android-platform-view .layout-vertical-nav .vertical-nav-items-shadow { display: none !important; }',
      'body.android-platform-view .layout-vertical-nav.android-platform-menu-open { opacity: 1 !important; pointer-events: auto !important; transform: translateX(0) !important; }',
      // In landscape the native bridge owns the split-pane menu. Vue can
      // briefly remove its class while the scrollable nav handles a touch
      // gesture; the body class is still authoritative, so keep the pane
      // visible even during that transient DOM update.
      'body.android-platform-view.android-platform-menu-open .layout-vertical-nav { opacity: 1 !important; pointer-events: auto !important; transform: translateX(0) !important; }',
      'body.android-platform-view.android-platform-menu-open .layout-content-wrapper { transform: translateX(260px); }',
      '@media (orientation: landscape) and (min-width: 900px) { body.android-platform-view .layout-content-wrapper { width: 100% !important; max-width: 100% !important; flex: 1 1 auto !important; transform: translateX(0) !important; } body.android-platform-view.android-platform-menu-open .layout-content-wrapper { width: calc(100% - var(--android-platform-menu-width, 260px)) !important; max-width: calc(100% - var(--android-platform-menu-width, 260px)) !important; flex: 0 0 calc(100% - var(--android-platform-menu-width, 260px)) !important; transform: translateX(var(--android-platform-menu-width, 260px)) !important; } body.android-platform-view .layout-page-content, body.android-platform-view .page-content-container { min-inline-size: 0 !important; max-inline-size: 100% !important; width: 100% !important; box-sizing: border-box !important; } }',
      'body.android-platform-view .layout-overlay { position: fixed !important; z-index: 2147483637 !important; inset: 0 0 0 260px !important; background: rgba(15,12,30,.18) !important; opacity: 0 !important; visibility: hidden !important; pointer-events: none !important; transition: opacity .3s ease, visibility .3s ease !important; }',
      'body.android-platform-view .layout-overlay.android-platform-menu-open { opacity: 1 !important; visibility: visible !important; pointer-events: auto !important; }',
      '@media (orientation: landscape) and (min-width: 900px) { body.android-platform-view .layout-overlay { display: none !important; } }'
    ].join('\n')
    document.head.appendChild(style)

    function mount() {
      document.body.classList.add('android-platform-view')
      var nav = document.querySelector('.layout-vertical-nav')
      var overlay = document.querySelector('.layout-overlay')
      var trigger = document.querySelector('.layout-navbar .d-lg-none')
      if (!nav || !trigger || trigger.dataset.androidMenuFixed === 'true') return false
      trigger.dataset.androidMenuFixed = 'true'
      var wideLandscapeQuery = window.matchMedia('(orientation: landscape) and (min-width: 900px)')
      var menuState = { desiredOpen: false }

      function isWideLandscape() {
        return wideLandscapeQuery.matches
      }

      function syncOpenState(open) {
        menuState.desiredOpen = !!open
        var navWidth = nav.getBoundingClientRect().width
        if (!Number.isFinite(navWidth) || navWidth <= 0) {
          navWidth = parseFloat(window.getComputedStyle(nav).width) || 260
        }
        document.documentElement.style.setProperty('--android-platform-menu-width', navWidth + 'px')
        nav.classList.toggle('android-platform-menu-open', open)
        document.body.classList.toggle('android-platform-menu-open', open)
        if (overlay) overlay.classList.toggle('android-platform-menu-open', open && !isWideLandscape())
        var content = document.querySelector('.layout-content-wrapper')
        if (content) {
          // Force one synchronous layout pass so the page width follows the
          // menu state immediately instead of waiting for a later resize.
          void content.offsetWidth
        }
      }

      function closeMenu(force) {
        if (isWideLandscape() && !force) return
        syncOpenState(false)
      }
      function toggleMenu(event) {
        event.preventDefault()
        event.stopImmediatePropagation()
        syncOpenState(!nav.classList.contains('android-platform-menu-open'))
      }

      trigger.addEventListener('click', toggleMenu, true)
      nav.addEventListener('click', function (event) {
        if (event.target.closest('a, button, .v-list-item')) {
          window.setTimeout(closeMenu, 0)
        }
      }, true)
      if (overlay) overlay.addEventListener('click', function () { closeMenu(true) }, true)
      // Do not pass the HashChangeEvent into closeMenu.  The event object is
      // truthy and would be interpreted as the optional `force` argument,
      // which made a route change (including a menu swipe that ends on an
      // item) collapse the landscape menu.  In wide landscape the menu is a
      // persistent split-pane and must only close through an explicit force
      // action (the overlay is portrait-only).
      window.addEventListener('hashchange', function () {
        closeMenu()
      })
      watchAndroidMediaQuery(wideLandscapeQuery, function () {
        syncOpenState(nav.classList.contains('android-platform-menu-open'))
      })

      // The bundled DMP layout keeps its own reactive drawer state. On a
      // landscape tablet that state is overlay-oriented and a vertical swipe
      // inside the nav can remove the class that represents the split pane,
      // even though the bridge/body state remains open. Observe both nodes
      // and restore the bridge-owned classes immediately. An explicit
      // hamburger toggle updates desiredOpen first, so a deliberate close is
      // still respected and is not reopened by this guard.
      if (window.MutationObserver) {
        var menuStateObserver = new MutationObserver(function () {
          if (!isWideLandscape()) return
          var desired = menuState.desiredOpen
          var navOpen = nav.classList.contains('android-platform-menu-open')
          var bodyOpen = document.body.classList.contains('android-platform-menu-open')
          if (desired !== navOpen) nav.classList.toggle('android-platform-menu-open', desired)
          if (desired !== bodyOpen) document.body.classList.toggle('android-platform-menu-open', desired)
        })
        menuStateObserver.observe(nav, { attributes: true, attributeFilter: ['class'] })
        menuStateObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] })
      }

      // In the split landscape layout, a vertical swipe that starts in the
      // left navigation should first continue the right-hand page's upward
      // scroll whenever that page is not already at its top. Without this
      // hand-off PerfectScrollbar consumes the gesture for the nav itself,
      // which is especially confusing when the right page is mid-scroll.
      // Once the right page reaches its top, the same gesture naturally falls
      // back to scrolling the navigation list.
      (function installLandscapeScrollHandoff() {
        if (!window.addEventListener || !window.matchMedia) return
        var gesture = null

        function scrollRange(element, direction) {
          if (!element || element === nav) return null
          var max = Math.max(0, element.scrollHeight - element.clientHeight)
          if (max <= 0) return null
          // A finger moving up (direction < 0) should reveal content below,
          // therefore the pane must not already be at its bottom.  A finger
          // moving down (direction > 0) reveals content above and needs a
          // non-zero scrollTop.  The old implementation only tested
          // scrollTop > 0 and then added the finger delta, which made the
          // right pane travel in the opposite direction.
          if (direction < 0 && element.scrollTop >= max) return null
          if (direction > 0 && element.scrollTop <= 0) return null
          return { element: element, max: max }
        }

        function elementDepth(element) {
          var depth = 0
          for (var parent = element && element.parentElement; parent; parent = parent.parentElement) depth += 1
          return depth
        }

        function rightScrollTarget(direction) {
          var candidates = []
          var seen = []
          var content = document.querySelector('.layout-content-wrapper')
          var contentRect = content && content.getBoundingClientRect()

          function add(element) {
            if (!element || seen.indexOf(element) >= 0 || element === nav) return
            seen.push(element)
            var rect = element.getBoundingClientRect()
            // The menu is fixed on the left.  Only consider scroll containers
            // whose visible area intersects the right-hand content pane.
            if (contentRect && rect.right <= contentRect.left + 1) return
            var range = scrollRange(element, direction)
            if (!range) return
            var scrollingElement = document.scrollingElement || document.documentElement
            var isDocumentScroller = element === scrollingElement || element === document.documentElement || element === document.body
            var style = window.getComputedStyle ? window.getComputedStyle(element) : null
            var overflowY = style && style.overflowY
            if (!isDocumentScroller && overflowY && overflowY !== 'auto' && overflowY !== 'scroll' && overflowY !== 'overlay') return
            range.depth = elementDepth(element)
            range.left = rect.left
            range.area = Math.max(1, rect.width * rect.height)
            candidates.push(range)
          }

          add(document.scrollingElement || document.documentElement)
          ;[
            '.layout-page-content', '.page-content-container',
            '.v-main', '.v-main__wrap', '.layout-content-wrapper',
            'main', '#app'
          ].forEach(function (selector) {
            document.querySelectorAll(selector).forEach(add)
          })
          // DMP pages use different scroll wrappers depending on the view.
          // Inspect descendants as well so a nested page pane is not missed.
          if (content) content.querySelectorAll('*').forEach(add)

          // Prefer the deepest active pane, then the rightmost/largest visible
          // pane.  This avoids selecting an outer wrapper when a child is the
          // actual scroller for the current room page.
          candidates.sort(function (a, b) {
            return (b.depth - a.depth) || (b.left - a.left) || (b.area - a.area)
          })
          return candidates.length ? candidates[0] : null
        }

        function scrollBy(element, delta) {
          var max = Math.max(0, element.scrollHeight - element.clientHeight)
          var next = Math.max(0, Math.min(max, element.scrollTop + delta))
          if (next === element.scrollTop) return false
          element.scrollTop = next
          return true
        }

        function start(event) {
          if (!isWideLandscape() || !menuState.desiredOpen) return
          var touch = event.touches && event.touches[0]
          if (!touch || !nav.contains(event.target)) return
          /* The Android polish layer owns the actual `.nav-items.ps` scroll
             container.  Do not let this document-level right-pane handoff
             intercept touches that start on a menu item: its capture-phase
             listener used to preventDefault/stopPropagation first, so the
             menu received only touchstart/touchend and could never change
             scrollTop.  Gestures on the drawer chrome still use the
             right-pane handoff when appropriate. */
          var menuItems = nav.querySelector('.nav-items.ps')
            || nav.querySelector('.vertical-nav-items.ps')
            || nav.querySelector('.vertical-nav-items')
            || nav.querySelector('.nav-items')
          if (menuItems && menuItems.contains(event.target)) {
            gesture = null
            return
          }
          // Keep a cumulative distance.  Touchmove events on the tablet often
          // arrive in 1–2px increments; resetting the origin on every tiny move
          // meant the old 4px threshold was never reached and the left menu
          // scrolled before the right pane could take over.
          gesture = {
            y: touch.clientY,
            distanceY: 0,
            // Direction is unknown until the first meaningful move.  Do not
            // preselect a pane with a direction-less range check.
            handoff: null,
            direction: 0
          }
        }

        function move(event) {
          if (!gesture || !isWideLandscape() || !menuState.desiredOpen) return
          var touch = event.touches && event.touches[0]
          if (!touch) return
          var delta = touch.clientY - gesture.y
          gesture.y = touch.clientY
          gesture.distanceY += delta
          // Ignore taps and tiny movement; once the gesture crosses the
          // threshold, subsequent deltas are handed to the selected pane.
          if (!gesture.handoff && Math.abs(gesture.distanceY) < 4) return
          // Pick the pane from the actual gesture direction.  Both up and
          // down swipes are supported; the previous `>= 0` guard silently
          // discarded every downward gesture and contributed to the apparent
          // reverse-scroll behaviour.
          if (!gesture.handoff) {
            var direction = gesture.distanceY < 0 ? -1 : 1
            gesture.direction = direction
            gesture.handoff = rightScrollTarget(direction)
          }
          if (!gesture.handoff) return
          if (Math.abs(delta) < 0.01) return
          // scrollTop is the inverse of finger movement: up means a positive
          // scrollTop delta, down means a negative one.
          if (scrollBy(gesture.handoff.element, -delta)) {
            event.preventDefault()
            event.stopPropagation()
          } else {
            // The right pane has reached the edge for this direction;
            // release the gesture so the navigation's own scrolling can take
            // over.
            gesture.handoff = null
            gesture.y = touch.clientY
          }
        }

        function end() {
          gesture = null
        }

        document.addEventListener('touchstart', start, true)
        document.addEventListener('touchmove', move, { capture: true, passive: false })
        document.addEventListener('touchend', end, true)
        document.addEventListener('touchcancel', end, true)
      })()
      closeMenu(true)
      return true
    }

    function retry() {
      if (!mount()) window.setTimeout(retry, 120)
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', retry, { once: true })
    } else {
      retry()
    }
  }

  // The old mobile bundle only rendered a static room chip.  Keep the old
  // visual shell but restore the newer selectable room control at the same
  // navbar position.  Room data is read from the server's permitted/basic
  // endpoint and only the selected id/name is sent back to Android.
  function installAndroidRoomPicker() {
    if (bootstrap.roomPreview || !apiBaseUrl || !nativeBridge
      || typeof nativeBridge.selectRoom !== 'function') return
    var mounted = false
    var rooms = []
    var currentId = Number(bootstrap.global && bootstrap.global.room
      && bootstrap.global.room.id || 0)
    var currentName = String(bootstrap.global && bootstrap.global.room
      && bootstrap.global.room.gameName || '')

    var style = document.createElement('style')
    style.id = 'android-room-picker-style'
    style.textContent = [
      /* The desktop navbar container is positioned below the toolbar on the
         tablet layout.  Inserting the room picker as its first child used to
         place the chip at y=0, above the hamburger/menu row.  Anchor it to the
         toolbar row instead so it cannot cover the left menu trigger. */
      /* Keep the picker in the page viewport rather than inside the navbar's
         flex/clip context. mount() aligns it to the actual menu button. */
      '.android-room-picker-wrap{position:fixed;inset-block-start:0;inset-inline-start:0;display:inline-flex;align-items:center;max-width:min(42vw,300px);margin-inline-end:8px;z-index:2147483647}',
      '.android-room-picker{display:inline-flex;align-items:center;gap:5px;max-width:100%;min-height:32px;padding:0 10px;border:0;border-radius:18px;background:rgba(145,85,253,.13);color:rgb(var(--v-theme-primary));font:inherit;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;-webkit-tap-highlight-color:transparent}',
      '.android-room-picker i{font-size:18px;flex:none}',
      '.android-room-picker span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.android-room-picker-panel{position:fixed;z-index:2147483646;min-width:190px;max-width:min(78vw,320px);max-height:min(52vh,420px);overflow-y:auto;padding:6px;border-radius:16px;background:rgb(var(--v-theme-surface));box-shadow:0 10px 32px rgba(20,14,40,.28);border:1px solid rgba(145,85,253,.18);display:none}',
      '.android-room-picker-panel.open{display:block}',
      '.android-room-picker-option{display:block;width:100%;padding:10px 12px;border:0;border-radius:10px;background:transparent;color:inherit;text-align:start;font:inherit;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.android-room-picker-option:active,.android-room-picker-option.selected{background:rgba(145,85,253,.14);color:rgb(var(--v-theme-primary))}',
      '.android-room-picker-empty{padding:12px;color:rgba(var(--v-theme-on-surface),.58);font-size:13px}',
      '@media (max-width:600px){.android-room-picker-wrap{max-width:44vw}.android-room-picker{padding-inline:8px}.android-room-picker-panel{min-width:170px}}'
    ].join('\n')
    document.head.appendChild(style)

    function label() { return currentId > 0 && currentName ? currentName : '选择房间' }
    // Keep the picker at body level because some tablet WebViews apply
    // transforms/clipping to the navbar.  Its coordinates are nevertheless
    // derived from the current page's menu button on every layout pass.  The
    // old implementation locked the first measured rectangle forever; after
    // a toolbar recreation that left the room name detached from the menu.
    var pickerMenu = null
    function alignWrap(wrap) {
      if (!wrap) return
      var nav = document.querySelector('.layout-navbar')
      var container = nav && nav.querySelector('.navbar-content-container')
      var menu = nav && (nav.querySelector('[data-android-menu-fixed]')
        || nav.querySelector('i.ri-menu-line')
        || nav.querySelector('button[aria-label*="菜单"]')
        || nav.querySelector('button[aria-label*="Menu"]'))
      if (menu && menu.tagName && menu.tagName.toLowerCase() !== 'button') {
        menu = menu.closest('button,[role=button]') || menu
      }
      if (menu && menu !== pickerMenu) pickerMenu = menu
      var navRect = nav && nav.getBoundingClientRect ? nav.getBoundingClientRect() : null
      var containerRect = container && container.getBoundingClientRect ? container.getBoundingClientRect() : null
      var menuRect = menu && menu.getBoundingClientRect ? menu.getBoundingClientRect() : null
      var left = menuRect && menuRect.width > 0
        ? menuRect.right + 8
        : containerRect && containerRect.width > 0 ? containerRect.left : 8
      // Center against the actual toolbar instead of assuming a 92px top
      // inset. This keeps the chip beside the menu after rotation and when
      // the tablet navbar height changes.
      var top = navRect && navRect.height > 0
        ? Math.max(0, Number(navRect.top) || 0)
          + Math.max(0, (navRect.height - wrap.offsetHeight) / 2)
        : menuRect && menuRect.top || 6
      /* The picker is the persistent room control.  It stays in the
         viewport's menu row even after the official navbar scrolls away;
         never push it down by the fixed time/battery subbar height. */
      var width = Math.max(150, Math.min(window.innerWidth - left - 12,
        window.innerWidth * (window.innerWidth > window.innerHeight ? .40 : .48), 340))
      var nextAnchor = {
        top: Math.max(0, Math.round(top)),
        left: Math.max(8, Math.round(left)),
        maxWidth: Math.round(width)
      }
      wrap.style.top = nextAnchor.top + 'px'
      wrap.style.left = nextAnchor.left + 'px'
      wrap.style.maxWidth = nextAnchor.maxWidth + 'px'
    }
    function position(panel, button) {
      var rect = button.getBoundingClientRect()
      var width = Math.min(Math.max(rect.width, 190), Math.min(window.innerWidth - 20, 320))
      panel.style.width = width + 'px'
      panel.style.left = Math.max(10, Math.min(rect.left, window.innerWidth - width - 10)) + 'px'
      panel.style.top = Math.min(window.innerHeight - 20, rect.bottom + 6) + 'px'
    }
    function close(panel) { panel.classList.remove('open') }
    function syncCurrentRoom() {
      // Bootstrap supplies the initial selection.  Once the web store has
      // been updated, prefer its current room so a route reload never leaves
      // a stale/static label in the toolbar.
      try {
        var raw = localStorage.getItem('dmp-global')
        if (!raw) return
        var persisted = JSON.parse(raw)
        var room = persisted && persisted.room
        var id = Number(room && room.id || 0)
        var name = room && room.gameName ? String(room.gameName) : ''
        if (id > 0 && name) {
          currentId = id
          currentName = name
        }
      } catch (ignored) {}
    }
    function render(panel, button) {
      syncCurrentRoom()
      button.querySelector('span').textContent = label()
      panel.innerHTML = ''
      if (!rooms.length) {
        var empty = document.createElement('div')
        empty.className = 'android-room-picker-empty'
        empty.textContent = '暂无可选房间'
        panel.appendChild(empty)
      } else {
        rooms.forEach(function (room) {
          var option = document.createElement('button')
          option.type = 'button'
          option.className = 'android-room-picker-option'
          if (room.id === currentId) option.classList.add('selected')
          option.textContent = room.name || ('房间 #' + room.id)
          option.addEventListener('click', function (event) {
            event.preventDefault()
            event.stopPropagation()
            currentId = room.id
            currentName = room.name
            nativeBridge.selectRoom(room.id, room.name)
            close(panel)
            button.querySelector('span').textContent = label()
            // Rebuild the WebView with the new bootstrap room while keeping
            // the current page.  Without preserving the hash the native
            // activity starts at /rooms and a picker tap appears to be a
            // spontaneous route reset from history/add-mod pages.
            var routeBeforeReload = String(window.location.hash || '#/rooms')
            try {
              var routeToRestore = routeBeforeReload.replace(/^#/, '').split('?')[0]
              if (/^\/(?:dashboard|game|tools|logs|upload|install|platform)(?:\/|$)/i.test(routeToRestore)) {
                sessionStorage.setItem('dmp-android-restore-route', routeToRestore)
              }
            } catch (ignored) {}
            window.setTimeout(function () {
              // A later explicit navigation wins over the delayed reload.
              if (String(window.location.hash || '#/rooms') === routeBeforeReload) {
                window.location.reload()
              }
            }, 60)
          })
          panel.appendChild(option)
        })
      }
      position(panel, button)
    }
    function hideStaticRoomChip() {
      // Hide only the upstream room selector.  Version/status chips also use
      // `.v-chip`; hiding every chip made the desktop header lose unrelated
      // information.
      document.querySelectorAll('.layout-navbar .chip-select, .layout-navbar .chip-select__activator').forEach(function (chip) {
        chip.style.display = 'none'
        chip.setAttribute('aria-hidden', 'true')
      })
      // The current 3.2 HeaderMain renders a plain VChip instead of the old
      // `chip-select` wrapper.  Identify that one by its room icon and hide
      // only its owning chip; otherwise the injected selector is drawn on top
      // of the old room name.
      document.querySelectorAll('.layout-navbar i.ri-honour-line').forEach(function (icon) {
        var owner = icon.closest('.android-room-picker, .v-chip, .v-chip__content')
        if (!owner || owner.closest('.android-room-picker')) return
        var chip = owner.closest('.v-chip') || owner
        chip.style.display = 'none'
        chip.setAttribute('aria-hidden', 'true')
      })
    }
    function fetchRooms() {
      var headers = { 'X-DMP-TOKEN': apiToken, 'X-I18n-Lang': 'zh' }
      return fetch(apiBaseUrl + '/v3/room/permitted/basic', { headers: headers, cache: 'no-store' })
        .then(function (response) { if (!response.ok) throw new Error('rooms') ; return response.json() })
        .then(function (response) {
          var data = response && Array.isArray(response.data) ? response.data : []
          rooms = data.map(function (item) {
            return { id: Number(item.roomID || item.roomId || item.id || 0), name: String(item.roomName || item.gameName || item.name || '') }
          }).filter(function (item) { return item.id > 0 })
        })
        .catch(function () { rooms = [] })
    }
    function mount() {
      if (mounted) return true
      var container = document.querySelector('.layout-navbar .navbar-content-container')
      if (!container) return false
      mounted = true
      var wrap = document.createElement('div')
      wrap.className = 'android-room-picker-wrap'
      var button = document.createElement('button')
      button.type = 'button'
      button.className = 'android-room-picker'
      button.setAttribute('aria-label', '选择房间')
      button.innerHTML = '<i class="ri-honour-line"></i><span></span><i class="ri-arrow-down-s-line"></i>'
      var panel = document.createElement('div')
      panel.className = 'android-room-picker-panel'
      wrap.appendChild(button)
      // The navbar's flex/transform context clips or repositions fixed
      // children on some tablet WebViews. Keep the picker at body level.
      document.body.appendChild(wrap)
      document.body.appendChild(panel)
      // Give the navbar a frame to finish its initial layout.  Later passes
      // keep the room name attached to the current menu button.
      alignWrap(wrap)
      window.requestAnimationFrame(function () { alignWrap(wrap) })
      window.setTimeout(function () { alignWrap(wrap) }, 120)
      hideStaticRoomChip()
      button.addEventListener('click', function (event) {
        event.preventDefault(); event.stopPropagation()
        render(panel, button)
        panel.classList.toggle('open')
        if (panel.classList.contains('open')) position(panel, button)
      })
      document.addEventListener('click', function (event) {
        if (!wrap.contains(event.target) && !panel.contains(event.target)) close(panel)
      }, true)
      var resizeTimer = 0
      function reanchorAfterViewportChange() {
        window.clearTimeout(resizeTimer)
        resizeTimer = window.setTimeout(function () {
           alignWrap(wrap)
           window.requestAnimationFrame(function () { alignWrap(wrap) })
          if (panel.classList.contains('open')) position(panel, button)
        }, 120)
      }
      window.addEventListener('resize', function () {
        reanchorAfterViewportChange()
        if (panel.classList.contains('open')) position(panel, button)
      })
      window.addEventListener('orientationchange', function () {
        reanchorAfterViewportChange()
      })
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', reanchorAfterViewportChange)
      }
      syncCurrentRoom()
      render(panel, button)
      fetchRooms().then(function () { render(panel, button) })
      window.setInterval(function () {
        syncCurrentRoom()
        hideStaticRoomChip()
        alignWrap(wrap)
        button.querySelector('span').textContent = label()
      }, 550)
      return true
    }
    function retry() { if (!mount()) window.setTimeout(retry, 180) }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', retry, { once: true })
    else retry()
  }

  // Old DMP servers acknowledge /dashboard/exec/game immediately and do not
  // expose /v3/tasks.  The bundled desktop DownloadCenter therefore has no
  // row to render while SteamCMD is running.  Keep a small platform-only
  // monitor here and add the same visual task row to the existing top card.
  // It is intentionally read-only and never starts an update by itself.
  function installLegacyDownloadMonitor() {
    if (bootstrap.roomPreview || !apiBaseUrl || !apiToken) return

    var state = {
      started: false,
      updating: false,
      observedRunning: false,
      initialLocal: 0,
      initialLatest: 0,
      local: 0,
      latest: 0,
      seenAt: 0,
      finishedAt: 0,
      completed: false,
      error: '',
      dismissed: false,
      pollFailures: 0
    }
    // The compatibility row is rendered outside Vue's task store.  Keep its
    // dismissal state per server so the platform task centre does not recreate
    // a completed legacy update after the user clears it.
    var legacyDismissKey = 'dmp-legacy-update-dismissed-' + String(
      (selectedServer && (selectedServer.id || selectedServer.ip)) || 'current'
    ).replace(/[^a-zA-Z0-9._-]/g, '_')
    try {
      state.dismissed = localStorage.getItem(legacyDismissKey) === '1'
    } catch (ignored) {}
    // Rehydrate the server-owned task when the platform WebView is recreated.
    // This is important when the user leaves the platform while SteamCMD is
    // running: the next page must continue polling instead of starting a new
    // anonymous state machine.  Only task metadata is used; no credentials
    // are copied from the snapshot.
    var restoredUpdate = Array.isArray(window.__dmpBootstrapTasks)
      ? window.__dmpBootstrapTasks.find(function (task) {
        return task && (task.type === 'game_update' || task.__androidGameUpdate)
      }) : null
    if (restoredUpdate) {
      var restoredStatus = String(restoredUpdate.status || '').toLowerCase()
      var restoredTerminal = /^(success|complete|completed|done|failed|error|cancelled|canceled)$/.test(restoredStatus)
      var restoredCreatedAt = numberOf(restoredUpdate.createdAt)
      // A running legacy row is rehydrated only when there is evidence that
      // this page (or the server) actually started the update.  Older bridge
      // snapshots could contain an unconfirmed `game_update:<server>` row and
      // otherwise made the platform card say “后台更新中” forever after the
      // request had never run.  Keep a short grace period for a freshly queued
      // request so the first server poll can still observe it.
      var restoredAge = restoredCreatedAt > 0
        ? Math.max(0, Date.now() - (restoredCreatedAt < 100000000000 ? restoredCreatedAt * 1000 : restoredCreatedAt))
        : Number.POSITIVE_INFINITY
      var restoredEvidence = restoredUpdate.serverUpdateObserved === true
        || restoredUpdate.serverLastUpdating === true
        || restoredTerminal
        || restoredAge <= 2 * 60 * 1000
      if (!restoredEvidence) restoredUpdate = null
    }
    if (restoredUpdate) {
      state.started = true
      state.observedRunning = restoredUpdate.serverUpdateObserved === true
      state.completed = /^(success|complete|completed|done)$/i.test(restoredStatus)
      // Older snapshots did not persist serverLastUpdating.  An observed
      // running task is still enough to treat the next false poll as the
      // authoritative end of the server update.
      state.updating = restoredUpdate.serverLastUpdating === true
        || (state.observedRunning && /^(running|downloading|in_progress|queued)$/i.test(
          String(restoredUpdate.status || '')))
      state.finishedAt = numberOf(restoredUpdate.finishedAt)
        || (state.completed ? Date.now() : 0)
      state.initialLocal = numberOf(restoredUpdate.versionAtRequest)
      state.seenAt = numberOf(restoredUpdate.createdAt) || Date.now()
    }
    var pollBusy = false
    var initialProbeDone = false

    function statusUrl(path) {
      return apiBaseUrl + path
    }

    function readJson(path) {
      return fetch(statusUrl(path), {
        method: 'GET',
        cache: 'no-store',
        headers: { 'X-DMP-TOKEN': apiToken, 'X-I18n-Lang': 'zh' }
      }).then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status)
        return response.json()
      })
    }

    function numberOf(value) {
      var result = Number(value)
      return Number.isFinite(result) && result >= 0 ? result : 0
    }

    function updateState() {
      if (pollBusy) return
      // Do one light probe on entry so a server update started elsewhere can
      // be represented. Afterwards poll only while a concrete update exists;
      // the DMP page must not wake the server every 2.5s during ordinary use.
      if (initialProbeDone && !state.started && !state.updating && !pendingGameUpdates.length) return
      initialProbeDone = true
      if (pendingGameUpdates.length) {
        // The request has already been accepted by the dashboard. Mark the
        // monitor as started before the first status poll so an initial
        // updating=false race cannot be mistaken for completion.
        state.started = true
        state.completed = false
        state.observedRunning = false
        state.finishedAt = 0
        state.error = ''
        state.seenAt = Date.now()
        state.pollFailures = 0
        state.dismissed = false
        try { localStorage.removeItem(legacyDismissKey) } catch (ignored) {}
        pendingGameUpdates.splice(0, pendingGameUpdates.length)
      }
      pollBusy = true
      Promise.all([readJson('/v3/dashboard/info/sys'), readJson('/v3/platform/game_version')])
        .then(function (responses) {
          var sys = responses[0] && responses[0].data ? responses[0].data : {}
          var version = responses[1] && responses[1].data ? responses[1].data : {}
          var updating = sys.updating === true || sys.updating === 1 || sys.updating === 'true'
          var local = numberOf(version.local != null ? version.local : version.localVersion)
          var latest = numberOf(version.server != null
            ? version.server
            : (version.latest != null ? version.latest : version.serverVersion))
          var wasUpdating = state.updating
          // A request may be detected before the first poll (the POST returns
          // immediately on old DMP). Capture the version baseline on that
          // first response even when the server has not started SteamCMD yet.
          if (state.started && state.initialLocal <= 0 && local > 0) {
            state.initialLocal = local
            state.initialLatest = latest
            state.seenAt = state.seenAt || Date.now()
          }
          if (updating) {
            if (!state.started) {
              state.started = true
              state.seenAt = Date.now()
              state.initialLocal = local
              state.initialLatest = latest
            }
            state.observedRunning = true
            state.completed = false
          } else if (state.started && !state.completed) {
            // A legacy endpoint has no percentage. Completion is a state
            // transition: after this request has been observed running, a
            // later false flag means the server-side update ended. If the
            // short update window was missed, a version increase is equally
            // authoritative.
            var versionChanged = state.initialLocal > 0 && local > state.initialLocal
            var ended = (state.observedRunning && wasUpdating) || versionChanged
            if (ended) {
              state.finishedAt = Date.now()
              state.completed = true
            }
          }
          state.updating = updating
          state.local = local
          state.latest = latest
          state.error = ''
          state.pollFailures = 0
          // A dashboard POST can be accepted before the server starts the
          // worker. Do not leave a permanent “等待服务器开始更新” row if it
          // never starts: surface a recoverable task failure after 3 minutes.
          if (state.started && !state.observedRunning && !updating && !state.completed
              && state.seenAt > 0 && Date.now() - state.seenAt >= 3 * 60 * 1000) {
            state.error = '服务器未确认开始更新'
          }
          if (typeof window.__dmpSyncGameUpdateTask === 'function') {
            window.__dmpSyncGameUpdateTask(updating, local, latest, {
              started: state.started,
              observedRunning: state.observedRunning,
              completed: state.completed,
              finishedAt: state.finishedAt,
              error: state.error,
              initialLocal: state.initialLocal
            })
          }
          // The completion row is now stored in the download centre. Stop
          // polling until another explicit update POST arrives; keeping this
          // flag true would otherwise wake an idle server forever.
          if ((state.completed || state.error) && !updating) state.started = false
          renderLegacyTask()
        })
        .catch(function (error) {
          state.error = error && error.message ? error.message : '状态读取失败'
          state.pollFailures += 1
          if (state.started && state.pollFailures >= 3
              && typeof window.__dmpSyncGameUpdateTask === 'function') {
            window.__dmpSyncGameUpdateTask(false, state.local, state.latest, {
              started: true,
              observedRunning: state.observedRunning,
              completed: false,
              finishedAt: 0,
              error: '连续读取更新状态失败',
              initialLocal: state.initialLocal
            })
            state.started = false
          }
          renderLegacyTask()
        })
        .finally(function () {
          pollBusy = false
        })
    }

    function active() {
      return !state.dismissed && (state.started || state.updating || state.completed)
    }

    // Called by the Android task-centre clear button.  This row has no Vue
    // task id, so removing only its DOM node would make the 400 ms renderer
    // immediately add it back.  Persist the dismissal until a new update POST
    // is detected, then clear it in updateState above.
    window.__dmpDismissLegacyUpdate = function () {
      state.dismissed = true
      state.started = false
      state.updating = false
      state.observedRunning = false
      state.completed = false
      state.finishedAt = 0
      state.error = ''
      pendingGameUpdates.splice(0, pendingGameUpdates.length)
      downloadRemove(downloadTaskKey('game_update', { serverId: downloadServerId }))
      try { localStorage.setItem(legacyDismissKey, '1') } catch (ignored) {}
      renderLegacyTask()
    }

    function text() {
      if (state.updating) return '后台更新中'
      if (state.completed) return '后台更新完成'
      if (state.error) return '更新状态读取失败'
      return '等待服务器开始更新'
    }

    // The server card's remark/IP is user-controlled data.  This row is
    // rendered with a small static template for compatibility with the
    // desktop card, so escape that value before it crosses innerHTML.  The
    // WebView bridge exposes the current DMP token; an injected event handler
    // here would otherwise turn a malicious remark into a token-reading XSS.
    function escapeHtml(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
    }

    function ensureStyle() {
      if (document.getElementById('android-legacy-download-style')) return
      var style = document.createElement('style')
      style.id = 'android-legacy-download-style'
      style.textContent = [
        '.android-legacy-download-list{display:block!important;max-height:min(28rem,100vh - 7rem);overflow-y:auto;margin:0!important;padding:0!important}',
        '.android-legacy-download-task{box-sizing:border-box;width:100%;padding:12px 14px;border-bottom:1px solid rgba(var(--v-border-color),var(--v-border-opacity));border-top:0}',
        '.android-legacy-download-task .android-legacy-progress{display:block;position:relative;width:100%;height:5px;margin-top:9px;overflow:hidden;background:rgba(94,105,145,.2);border-radius:3px}',
        '.android-legacy-download-task .android-legacy-progress>i{display:block;position:absolute;inset:0 auto 0 0;height:100%;width:34%;background:#7c5cff;border-radius:3px;animation:androidLegacyProgress 1.15s ease-in-out infinite alternate}',
        '.android-legacy-download-task.done .android-legacy-progress>i{width:100%;animation:none}',
        '@keyframes androidLegacyProgress{from{transform:translateX(-110%)}to{transform:translateX(300%)}}'
      ].join('\\n')
      document.head.appendChild(style)
    }

    function renderLegacyTask() {
      var card = document.querySelector('.download-center-card')
      if (!card) return
      var old = card.querySelector('.android-legacy-download-task')
      // Newer servers expose the task through the native DownloadCenter.  Do
      // not append the compatibility row as a duplicate when that row is
      // already present; the fallback is only for old servers without tasks.
      var nativeUpdate = Array.prototype.some.call(
        card.querySelectorAll('.download-task:not(.android-legacy-download-task),.android-web-download-task'),
        function (task) {
          return /服务器更新|server update/i.test(task.textContent || '')
        }
      )
      if (nativeUpdate) {
        var duplicateList = card.querySelector('.android-legacy-download-list')
        if (duplicateList) duplicateList.remove()
        return
      }
      if (!active()) {
        var staleList = card.querySelector('.android-legacy-download-list')
        if (staleList) staleList.remove()
        var empty = card.querySelector('.download-center-empty')
        if (empty) empty.style.display = ''
        return
      }
      ensureStyle()
      var list = card.querySelector('.android-legacy-download-list')
      if (!list) {
        list = document.createElement('div')
        list.className = 'download-center-list android-legacy-download-list'
        var empty = card.querySelector('.download-center-empty')
        if (empty) {
          empty.style.display = 'none'
          empty.parentNode.insertBefore(list, empty)
        } else {
          card.appendChild(list)
        }
      }
      if (!old) {
        old = document.createElement('div')
        old.className = 'download-task android-legacy-download-task'
        list.appendChild(old)
      }
      var done = !!state.finishedAt && !state.updating
      old.classList.toggle('done', done)
      var serverLabel = selectedServer && (selectedServer.remark || selectedServer.ip)
        || '当前平台'
      old.innerHTML = '<div class="d-flex align-start ga-2"><div class="flex-grow-1 min-width-0">'
        + '<div class="text-body-2 font-weight-medium text-truncate">服务器更新</div>'
        + '<div class="text-caption text-medium-emphasis text-truncate">'
         + escapeHtml(serverLabel)
         + '-官版 · 旧版 DMP</div>'
        + '<div class="text-caption text-medium-emphasis mt-1">' + text() + '</div>'
        + '</div></div><div class="android-legacy-progress"><i></i></div>'
    }

    window.setInterval(updateState, 2500)
    updateState()
  }

  // Render the Android bridge queue inside the old web download card.  The
  // desktop bundle owns a separate Pinia store and cannot see the token-free
  // bridge snapshot, so without this small renderer platform pages appear to
  // have no queue even though the native all-platform centre has the task.
  function installAndroidWebDownloadQueue() {
    function status(task) {
      var value = String(task && task.status || '').toLowerCase()
      if (value === 'success' || value === 'complete' || value === 'completed' || value === 'done') {
        return task && task.type === 'transfer' ? '传输完成' : '下载完成'
      }
      if (value === 'error' || value === 'failed') return task && task.type === 'transfer' ? '传输失败' : '下载失败'
      // Android deliberately has no pause/continue action.  Old persisted
      // rows can still contain `paused`; keep that legacy state readable as
      // an active transfer without exposing a dead control in the UI.
      if (value === 'paused') return task && task.type === 'transfer' ? '传输中' : '下载中'
      if (value === 'queued' || value === 'pending' || value === 'waiting') return '等待中'
      return task && task.type === 'transfer' ? '传输中' : (task && task.type === 'game_update' ? '后台更新中' : '下载中')
    }
    function isSuccessful(task) {
      return /^(success|complete|completed|done)$/i.test(String(task && task.status || ''))
    }
    function isFailed(task) {
      return /^(error|failed)$/i.test(String(task && task.status || ''))
    }
    function isTerminal(task) { return /^(success|complete|completed|done|error|failed|cancelled|canceled)$/i.test(String(task && task.status || '')) }
    function action(task, operation) {
      var accepted = false
      if (task && task.type === 'mod_download' && operation === 'delete') {
        markModTaskCancelled(task.id)
      }
      try {
        if (task && task.type === 'transfer'
          && nativeBridge && typeof nativeBridge.nativeTransferAction === 'function') {
          accepted = nativeBridge.nativeTransferAction(String(task.id || ''), operation) === true
        } else if (nativeBridge && typeof nativeBridge.webTaskAction === 'function') {
          accepted = nativeBridge.webTaskAction(String(task.id || ''), operation) === true
        }
      } catch (ignored) {}
      if (!accepted) return
      if (operation === 'delete') window.__dmpDownloadStore.removeTask(task.id)
      else if (operation === 'dismiss') window.__dmpDownloadStore.removeTask(task.id)
      else if (operation === 'retry') window.__dmpDownloadStore.removeTask(task.id)
    }
    function syncNativeTransfers() {
      if (!nativeBridge || typeof nativeBridge.getNativeTransferTasks !== 'function') return
      var raw = ''
      try { raw = nativeBridge.getNativeTransferTasks() } catch (ignored) { return }
      var rows = []
      try { rows = JSON.parse(raw || '[]') } catch (ignored) { return }
      if (!Array.isArray(rows)) return
      var seen = {}
      rows.forEach(function (item) {
        if (!item || !item.id) return
        item.type = 'transfer'
        item.serverId = item.serverId || downloadServerId
        item.serverName = item.serverName || downloadServerName
        item.canPause = false
        seen[String(item.id)] = true
        var existing = window.__dmpDownloadStore.tasks.filter(function (task) {
          return task && String(task.id) === String(item.id)
        })[0]
        var changed = !existing
          || String(existing.status || '') !== String(item.status || '')
          || Number(existing.progress || 0) !== Number(item.progress || 0)
          || Number(existing.completedBytes || 0) !== Number(item.completedBytes || 0)
          || Number(existing.totalBytes || 0) !== Number(item.totalBytes || 0)
          || String(existing.message || '') !== String(item.message || '')
        // DownloadManager supplies a fresh updatedAt on every query. Do not
        // feed that timestamp back into the store when the transfer itself is
        // unchanged, otherwise the store subscriber would recursively mount
        // this renderer every 350ms.
        if (changed) window.__dmpDownloadStore.upsertTask(item)
      })
      // DownloadManager removes a failed/deleted row from its provider. Drop
      // the corresponding WebView copy as well so a stale transfer cannot
      // remain forever in the per-platform card.
      window.__dmpDownloadStore.tasks.slice().forEach(function (task) {
        if (task && task.type === 'transfer'
          && String(task.serverId || '') === String(downloadServerId || '')
          && !seen[String(task.id)]) {
          window.__dmpDownloadStore.removeTask(task.id)
        }
      })
    }
    function render(card) {
      var store = window.__dmpDownloadStore
      if (!store || !Array.isArray(store.tasks)) return
      var rawTasks = store.tasks.filter(function (task) {
        return task && String(task.serverId || downloadServerId) === String(downloadServerId)
      })
      // The same request can be observed through XHR, fetch and a restored
      // native snapshot.  Collapse those aliases before rendering; otherwise
      // a single mod/update appears twice with conflicting states.
      var byKey = {}
      rawTasks.forEach(function (task) {
        var type = String(task.type || 'mod_download')
        var key = type === 'game_update'
          ? 'game_update|' + String(task.serverId || downloadServerId)
          : type === 'mod_download'
            ? (function () {
              var identity = downloadModIdentity(task)
              return 'mod|' + String(task.serverId || downloadServerId) + '|'
                + String(identity.room) + '|' + String(identity.mod)
            })()
            : type + '|' + String(task.id || '')
        var previous = byKey[key]
        if (!previous) {
          byKey[key] = task
          return
        }
        var terminal = function (item) {
          return /^(success|complete|completed|done|error|failed|cancelled|canceled)$/i
            .test(String(item && item.status || ''))
        }
        var previousProgress = Number(previous.progress)
        var currentProgress = Number(task.progress)
        if (terminal(task) && !terminal(previous)
          || (terminal(task) === terminal(previous)
            && (currentProgress > previousProgress
              || Number(task.updatedAt || 0) > Number(previous.updatedAt || 0)))) {
          byKey[key] = task
        }
      })
      var tasks = Object.keys(byKey).map(function (key) { return byKey[key] })
      var list = card.querySelector('.android-web-download-list')
      // Vue 3.2 renders its own .download-center-list. It does not know about
      // Android's token-free task snapshot, so showing both lists duplicates
      // rows and gives the user two conflicting progress values. Keep the
      // card/header and hide only the native list while bridge rows exist;
      // restore it when the bridge queue is empty.
      var nativeList = null
      var candidateLists = card.querySelectorAll('.download-center-list')
      for (var listIndex = 0; listIndex < candidateLists.length; listIndex++) {
        if (!candidateLists[listIndex].classList.contains('android-legacy-download-list')
            && !candidateLists[listIndex].classList.contains('android-web-download-list')) {
          nativeList = candidateLists[listIndex]
          break
        }
      }
      if (nativeList) {
        if (tasks.length) {
          nativeList.classList.add('android-native-download-list-hidden')
          nativeList.style.display = 'none'
        } else if (nativeList.classList.contains('android-native-download-list-hidden')) {
          nativeList.classList.remove('android-native-download-list-hidden')
          nativeList.style.display = ''
        }
      }
      var empty = card.querySelector('.download-center-empty')
      if (!tasks.length) {
        if (list) list.remove()
        /* Keep the last rendered state on the card.  The queue is polled on a
           short interval, but an empty card should not trigger a new DOM
           mutation (and therefore a full-page compatibility scan) on every
           poll. */
        card.dataset.androidWebQueueSignature = ''
        // The bridge list may have hidden the Vue empty-state node while a
        // task was active. Restore it when the last task is removed so the
        // card does not become a blank panel.
        if (empty) empty.style.display = ''
        return
      }
      if (empty) empty.style.display = 'none'
      /* Native DownloadManager status is polled every 700 ms.  Rebuilding the
         entire list with innerHTML on every poll used to create a childList
         mutation storm: the bridge and UI-polish observers then rescanned all
         tables/cards even when no task changed, making route transitions look
         frozen on slower WebViews.  Reuse the existing rows until a visible
         field (or the task count/order) actually changes. */
      var signature = tasks.map(function (task) {
        return [
          task.id, task.type, task.status, task.progress, task.progressKnown,
          task.completedBytes, task.totalBytes, task.bytesDownloaded,
          task.bytesTotal, task.name, task.serverName, task.roomName,
          task.roomID, task.message, task.error, task.upload === true
        ].map(function (value) { return String(value == null ? '' : value) }).join('|')
      }).join('||')
      if (list && card.dataset.androidWebQueueSignature === signature
          && list.querySelectorAll('.android-web-download-task').length === tasks.length) {
        sizeList(list, tasks.length)
        return
      }
      card.dataset.androidWebQueueSignature = signature
      if (!list) {
        list = document.createElement('div')
        list.className = 'android-web-download-list'
        card.appendChild(list)
      }
      list.innerHTML = ''
      tasks.forEach(function (task) {
        var row = document.createElement('div')
        row.className = 'android-web-download-task'
        var copy = document.createElement('div')
        copy.className = 'android-web-download-copy'
        var title = document.createElement('div')
        title.className = 'android-web-download-title'
        title.textContent = task.type === 'game_update' ? '服务器更新' : (task.name || '下载模组')
        copy.appendChild(title)
        var detail = document.createElement('div')
        detail.className = 'android-web-download-detail'
        detail.textContent = (task.serverName || downloadServerName) + (task.type === 'mod_download'
          ? ' · 房间' + (task.roomName || ('#' + (task.roomID || '—'))) : '')
        copy.appendChild(detail)
        var state = document.createElement('div')
        state.className = 'android-web-download-state'
         var taskPercent = Number(task.progress)
         state.textContent = status(task) + (Number.isFinite(taskPercent)
           ? ' · ' + Math.max(0, Math.min(100, taskPercent)).toFixed(1) + '%' : '')
        copy.appendChild(state)
        var controls = document.createElement('div')
        controls.className = 'android-web-download-controls'
          // LinuxDMP owns the server-side SteamCMD worker and has no safe
          // pause/continue endpoint.  The Android task card therefore exposes
          // only retry for completed/failed records, never a pause toggle.
          if ((isSuccessful(task) || isFailed(task))
            && (task.type === 'transfer' || task.type === 'mod_download')) {
           var retry = document.createElement('button')
           retry.type = 'button'
           retry.className = 'android-web-download-action'
            retry.setAttribute('aria-label', '重下')
           retry.innerHTML = '<i class="ri-refresh-line"></i>'
           retry.addEventListener('click', function (event) { event.stopPropagation(); action(task, 'retry') })
           controls.appendChild(retry)
         }
          if (isTerminal(task) || task.type === 'mod_download' || task.type === 'transfer') {
          var remove = document.createElement('button')
          remove.type = 'button'
          remove.className = 'android-web-download-action'
          remove.innerHTML = '<i class="ri-delete-bin-line"></i>'
           var removeOperation = isSuccessful(task) && task.type === 'transfer' ? 'dismiss' : 'delete'
           remove.setAttribute('aria-label', removeOperation === 'dismiss' ? '删除已完成任务' : '删除任务')
           remove.addEventListener('click', function (event) { event.stopPropagation(); action(task, removeOperation) })
          controls.appendChild(remove)
        }
        row.appendChild(copy)
        row.appendChild(controls)
         // Completed downloads occupy only the first two information lines;
         // failed and active tasks keep the third progress line.
         if (!isSuccessful(task)) {
           var progress = document.createElement('div')
           progress.className = 'android-web-download-progress'
           var bar = document.createElement('i')
           var percent = Number(task.progress)
           bar.style.width = (Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0) + '%'
           if (isFailed(task)) progress.classList.add('failed')
           else if (task.upload === true || /upload/i.test(String(task.direction || task.operation || ''))) progress.classList.add('upload')
           else progress.classList.add('download')
           progress.appendChild(bar)
           row.appendChild(progress)
         }
        list.appendChild(row)
      })
      sizeList(list, tasks.length)
    }
    function sizeList(list, count) {
      if (!list) return
      var viewportHeight = Math.max(240, Number(window.innerHeight) || 480)
      // Keep a compact lower bound, grow with the number of rows, and cap the
      // card to the usable screen height so a long queue scrolls inside the
      // card instead of pushing the page out of view.
      var maximum = Math.max(160, Math.min(420, viewportHeight - 220))
      var desired = Math.min(maximum, Math.max(96, Number(count || 0) * 78 + 8))
      list.style.minHeight = Math.min(96, desired) + 'px'
      list.style.maxHeight = desired + 'px'
    }
    var style = document.createElement('style')
    style.id = 'android-web-download-queue-style'
    style.textContent = [
      '.android-web-download-list{margin:0;min-height:96px;padding:0 12px 8px;max-height:calc(100vh - 220px);overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain}',
      '.android-web-download-task{position:relative;display:flex;align-items:flex-start;gap:8px;min-height:74px;box-sizing:border-box;padding:10px 0;border-top:1px solid rgba(var(--v-border-color),var(--v-border-opacity))}',
      '.android-web-download-copy{min-width:0;flex:1}',
      '.android-web-download-title{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.android-web-download-detail,.android-web-download-state{font-size:12px;color:rgba(var(--v-theme-on-surface),.62);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}',
      '.android-web-download-controls{display:flex;align-items:center;gap:2px;flex:none}',
      '.android-web-download-action{width:30px;height:30px;border:0;background:transparent;color:inherit;border-radius:50%;display:grid;place-items:center}',
      '.android-web-download-action:active{background:rgba(145,85,253,.15)}',
      '.android-web-download-progress{height:4px;position:absolute;left:0;right:0;bottom:2px;background:rgba(95,105,145,.2);border-radius:3px;overflow:hidden}',
       '.android-web-download-progress>i{display:block;height:100%;border-radius:3px;transition:width .25s ease}',
       '.android-web-download-progress.download>i{background:#43a047}',
       '.android-web-download-progress.upload>i{background:#42a5f5}',
       '.android-web-download-progress.failed>i{background:#ef5350}'
    ].join('\n')
    document.head.appendChild(style)
    var mountBusy = false
    function mount() {
      if (mountBusy) return
      mountBusy = true
      try {
        /* The Android mobile download centre is an isolated toolbar panel,
           not a `.download-center-card`.  Synchronise DownloadManager rows
           before looking for the legacy per-platform card; otherwise the
           custom panel never receives local backup/log transfers while the
           user is on a normal platform page. */
        syncNativeTransfers()
        var cards = document.querySelectorAll('.download-center-card')
        /* Per-platform cards do not exist on the hall/settings pages.  The
           native snapshot above is still needed by the mobile centre, so
           only skip the legacy DOM rendering when no card is present. */
        if (!cards.length) return
        cards.forEach(render)
      } finally {
        mountBusy = false
      }
    }
    window.setInterval(mount, 700)
    window.addEventListener('resize', function () {
      document.querySelectorAll('.download-center-card .android-web-download-list').forEach(function (list) {
        sizeList(list, list.querySelectorAll('.android-web-download-task').length)
      })
    })
    if (window.__dmpDownloadStore && typeof window.__dmpDownloadStore.subscribe === 'function') {
      window.__dmpDownloadStore.subscribe(mount)
    }
  }

  // The mod catalogue cards are rendered by a separate, compressed Vue
  // chunk and therefore do not receive the download-centre progress UI.  Add
  // a presentation-only overlay to the matching card while the authoritative
  // bridge task is active.  The blue mask is behind the card's text and image,
  // so the existing detail/download controls remain fully usable.
  function installModDownloadProgressOverlay() {
    if (!androidDownloadUi) return
    var style = document.createElement('style')
    style.id = 'android-mod-download-progress-style'
    style.textContent = [
      '.android-mod-progress-card{position:relative!important;overflow:hidden!important}',
      // The mask is a background layer; text, image and controls remain above
      // it, matching the old card treatment.
      '.android-mod-download-progress{position:absolute;inset:0;z-index:0;pointer-events:none;overflow:hidden;border-radius:inherit;background:transparent}',
      // Keep the light-blue mask quiet and static.  The percentage belongs in
      // the download button; a second "下载中" badge on the card was both
      // redundant and easy to mistake for another action button.
      '.android-mod-download-progress>i{position:absolute;inset:0 auto 0 0;width:0;background:rgba(145,205,255,.48);transition:width .3s ease}',
      '.android-mod-download-progress>i.indeterminate{width:0!important;animation:none!important}',
      '.android-mod-download-progress>span{display:none!important}',
      '.android-mod-progress-card>*:not(.android-mod-download-progress){position:relative;z-index:1}',
      '.android-mod-download-button{isolation:isolate!important;position:relative!important;overflow:hidden!important;pointer-events:auto!important;opacity:1!important;background:transparent!important;box-shadow:none!important}',
      '.android-mod-download-button.v-btn--disabled{pointer-events:none!important;opacity:1!important}',
      // Vuetify's `loading` prop replaces the button content with a spinner.
      // The mobile DMP needs the old ProgressButton treatment instead: keep
      // the actual label/percentage visible while the request is running.
      '.android-mod-download-button .v-btn__loader{display:none!important}',
      // Do not paint a white circular fill/ripple behind the numeric label.
      // The card mask is the only progress background on the catalogue card.
      '.android-mod-download-button .android-mod-button-fill{display:none!important;background:transparent!important;box-shadow:none!important}',
      '.android-mod-download-button .v-btn__overlay,.android-mod-download-button .v-btn__underlay{opacity:0!important;background:transparent!important}',
      '.android-mod-download-button .v-btn__content,.android-mod-download-button .v-btn__prepend,.android-mod-download-button .v-btn__append{position:relative;z-index:1}',
      '.android-mod-download-button .v-btn__content{visibility:hidden}',
      '.android-mod-download-button .android-mod-button-percent{position:absolute;inset:0;z-index:2;display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:600;text-shadow:0 1px 3px rgba(0,0,0,.55);pointer-events:none}',
      // The download button is a numeric indicator only.  Unknown progress
      // stays at 0% without the old animated shimmer; the card mask remains
      // the only visual progress treatment.
      '.android-mod-download-button .android-mod-button-fill.indeterminate{width:0!important;animation:none!important}',
      // Installed catalogue entries use the old frontend's green name.  The
      // selector is scoped to the name row so chips inside the details dialog
      // keep their semantic colours.
       // Downloaded mod names use the requested fluorescent-yellow tint while
       // retaining Vuetify's translucent chip material.  The download/update
       // action colours remain independent below.
       '.android-mod-installed-card .mod-card-content>div:nth-child(2)>div:first-child .v-chip{color:#b89b00!important}',
       '.android-mod-installed-card .mod-card-content>div:nth-child(2)>div:first-child .v-chip .v-chip__underlay{background:rgba(255,235,59,.28)!important}',
       // The upstream component uses the warning variant for every installed
       // mod.  Re-apply the Android rules explicitly so a no-update “重下”
       // action stays green, while a real update remains yellow.
       '.android-mod-installed-card:not(.android-mod-progress-card){background:rgba(0,0,0,.34)!important;background-color:rgba(0,0,0,.34)!important}',
       '.android-mod-installed-card:not(.android-mod-progress-card)>.v-card__underlay,.android-mod-installed-card:not(.android-mod-progress-card) .v-card__underlay{background:rgba(0,0,0,.22)!important}',
       '.android-mod-installed-card .android-mod-installed-download{color:#fff!important;background:#2f6f46!important}',
       '.android-mod-installed-card .android-mod-update-download{color:#5b4200!important;background:#f0bd2e!important}',
      ''
      // Keep no button animation keyframes: the button must remain a static
      // numeric percentage while the server task is active.
    ].join('\n')
    document.head.appendChild(style)

    function terminal(task) {
      return /^(success|complete|completed|done|error|failed|cancelled|canceled)$/i
        .test(String(task && task.status || ''))
    }
    function roomId() {
      var id = Number(bootstrap.global && bootstrap.global.room && bootstrap.global.room.id || 0)
      if (id > 0) return id
      try {
        var raw = JSON.parse(localStorage.getItem('dmp-global') || '{}')
        return Number(raw && raw.room && raw.room.id || 0)
      } catch (ignored) { return 0 }
    }

    function restoreDownloadButton(card) {
      if (!card) return
      var button = card.querySelector('.android-mod-download-button')
      if (!button) return
      button.querySelectorAll('.android-mod-button-fill,.android-mod-button-percent').forEach(function (node) {
        node.remove()
      })
      button.classList.remove('android-mod-download-button', 'v-btn--disabled')
      button.disabled = false
      button.removeAttribute('disabled')
      button.removeAttribute('aria-disabled')
      button.style.removeProperty('pointer-events')
      delete button.dataset.androidModStatus
      delete button.dataset.androidModProgressTask
    }

    function clearCardProgress(card) {
      if (!card) return
      var existing = card.querySelector('.android-mod-download-progress')
      if (existing) existing.remove()
      restoreDownloadButton(card)
      card.classList.remove('android-mod-progress-card')
      delete card.dataset.androidModProgressTask
    }

    function cardModId(card) {
      var stamped = Number(card && card.getAttribute('data-android-mod-id') || 0)
      if (stamped > 0) return stamped
      var catalogueKeys = Object.keys(modCatalogue)
      var text = String(card && card.textContent || '')
      for (var index = 0; index < catalogueKeys.length; index++) {
        var item = modCatalogue[catalogueKeys[index]]
        var compactName = item && item.name ? String(item.name).replace(/\s*\.\.\.$/, '').trim() : ''
        var prefix = compactName.slice(0, 18)
        if (item && item.name && (text.indexOf(item.name) >= 0
          || prefix.length >= 6 && text.indexOf(prefix) >= 0)) {
          var id = Number(item.id)
          if (id > 0) {
            card.setAttribute('data-android-mod-id', String(id))
            return id
          }
        }
      }
      return 0
    }

    function downloadedNeedsUpdate(modId, card) {
      var detail = modDownloadedDetails[String(modId)]
      if (!detail) {
        // The catalogue's server size is still useful when the detail endpoint
        // returns only ids.  Without a local size, do not claim an update.
        return false
      }
      var catalogue = modCatalogueItem(modId)
      var localSize = Number(detail.localSize || detail.local_size || detail.sizeLocal || 0)
      var serverSize = Number(detail.serverSize || detail.server_size || detail.sizeServer
        || (catalogue && (catalogue.serverSize || catalogue.size)) || 0)
      if (localSize > 0 && serverSize > 0 && localSize !== serverSize) return true
      var localUpdated = String(detail.localUpdatedAt || detail.localTimeUpdated
        || detail.time_updated || detail.updatedAt || '').trim()
      var serverUpdated = String(detail.serverUpdatedAt || detail.serverTimeUpdated
        || (catalogue && catalogue.time_updated) || '').trim()
      return !!(localUpdated && serverUpdated && localUpdated !== serverUpdated)
    }
    function hasCompletedDownload(modId) {
      var store = window.__dmpDownloadStore
      if (!store || !Array.isArray(store.tasks)) return false
      var wanted = Number(modId || 0)
      if (!(wanted > 0)) return false
      return store.tasks.some(function (task) {
        if (!task || task.type !== 'mod_download') return false
        if (String(task.serverId || downloadServerId) !== String(downloadServerId)) return false
        var identity = downloadModIdentity(task)
        return Number(identity.mod || 0) === wanted
          && /^(success|complete|completed|done)$/i.test(String(task.status || ''))
      })
    }
    /* The add-mod catalogue is a data table, not the installed-mod card
       catalogue.  Its footer contains the first/last-page icon buttons.  A
       broad VCard scan used to treat the table wrapper as a mod card and the
       installed-state pass then relabelled that final pagination button as
       “重下”.  Keep the presentation pass completely out of this route. */
    function isModAddPage() {
      var hash = String(window.location && window.location.hash || '')
        .replace(/^#/, '').split('?')[0]
      if (/^\/(?:game\/mod\/add|mod\/add|setting\/mod\/add|settings\/mod\/add)(?:\/|$)/i.test(hash)) return true
      if (document.body && document.body.classList
          && document.body.classList.contains('dmp-android-mod-add')) return true
      /* Route names changed between the 3.1 and 3.2 bundles.  The add page
         is nevertheless unambiguous in the DOM: its table header contains
         preview/name/size/ID and its footer contains a Vuetify paginator.
         Use that structural signal so the installed-mod renderer cannot
         relabel the paginator even when the hash is a new or localized path. */
      var tables = document.querySelectorAll('.v-data-table,.v-data-table-server,.v-data-table__wrapper')
      for (var tableIndex = 0; tableIndex < tables.length; tableIndex++) {
        var table = tables[tableIndex]
        var header = table.querySelector && table.querySelector('thead')
        var labels = String(header && header.textContent || table.textContent || '')
        if (/(?:预览图|preview)/i.test(labels)
            && /(?:名称|name)/i.test(labels)
            && /(?:大小|size)/i.test(labels)
            && /(?:\bID\b|模组版本|version)/i.test(labels)) return true
      }
      return false
    }
    function isModAddTableNode(node) {
      if (isModAddPage()) return true
      if (!node) return false
      if (node.closest && node.closest(
        '.android-mod-add-table,.v-data-table,.v-data-table-server,.v-data-table__wrapper,.v-pagination,.v-data-footer')) {
        return true
      }
      /* A VCard can wrap the complete add table.  In that case the card is
         not itself below `.v-data-table`, so inspect descendants too. */
      return !!(node.querySelector && node.querySelector(
        '.android-mod-add-table,.v-data-table,.v-data-table-server,.v-data-table__wrapper,.v-pagination,.v-data-footer'))
    }
    function findModDownloadButton(card) {
      if (!card) return null
      var explicit = card.querySelector('button.download-btn')
      if (explicit) return explicit
      var buttons = card.querySelectorAll('button.v-btn,button,[role="button"]')
      // Prefer a visible action whose text names the download operation. The
      // active Vuetify button may be loading and have no text at all, so retain
      // the last non-detail action as the stable fallback for that state.
      var fallback = null
      for (var index = buttons.length - 1; index >= 0; index--) {
        var button = buttons[index]
        if (!button || button.closest('#android-dmp-mobile-download-centre')) continue
        var value = String(button.textContent || '').trim()
        if (/详情|detail/i.test(value)) continue
        if (/下载|更新|重下|download|update/i.test(value)) return button
        if (!fallback) fallback = button
      }
      return fallback
    }

    function applyInstalledState(card) {
      if (!card || card.closest('.download-center-card') || isModAddTableNode(card)) return
      var modId = cardModId(card)
      if (modId <= 0) return
      /* The downloaded-details request can lag the task reaching 100%.
         Treat a verified local success row as installed immediately so the
         card background is darkened as soon as the download completes. */
      var installed = !!modDownloadedDetails[String(modId)] || hasCompletedDownload(modId)
      // The compiled Vue page also renders a green corner for its downloaded
      // boolean.  Treat that as installed when details arrived after the
      // first render so the style is applied without a route reload.
      if (!installed && card.querySelector('.downloaded-corner')) installed = true
      if (!installed) {
        card.classList.remove('android-mod-installed-card', 'android-mod-needs-update')
        return
      }
      var update = downloadedNeedsUpdate(modId, card)
      card.classList.add('android-mod-installed-card')
      card.classList.toggle('android-mod-needs-update', update)
      var button = findModDownloadButton(card)
      if (!button || card.classList.contains('android-mod-progress-card')) return
      button.classList.toggle('android-mod-installed-download', !update)
      button.classList.toggle('android-mod-update-download', update)
      var label = button.querySelector('.download-btn__label,.v-btn__content')
      // An installed mod without a newer archive is still actionable: the
      // Android workflow calls this a re-download, while a newer archive is
      // explicitly an update.  Keep the not-yet-installed label untouched
      // (the upstream card renders “下载” for that case).
      if (label) label.textContent = update ? '更新' : '重下'
    }

    function mountTask(card, task) {
      if (terminal(task)) {
        clearCardProgress(card)
        return
      }
      var existing = card.querySelector('.android-mod-download-progress')
      card.classList.add('android-mod-progress-card')
      var progress = Number(task.progress)
      var known = task.progressKnown === true && Number.isFinite(progress)
      // When the server has not exposed a byte count yet, show the numeric
      // percentage supplied by the task (normally 0.0%) instead of inventing
      // an animated 34% fill.  The card mask remains a quiet light-blue
      // progress layer until a real percentage arrives.
      progress = known ? Math.max(0, Math.min(100, progress)) : 0
      if (!existing) {
        existing = document.createElement('div')
        existing.className = 'android-mod-download-progress'
        existing.innerHTML = '<i></i>'
        card.insertBefore(existing, card.firstChild)
      }
      var bar = existing.querySelector('i')
      // Older renderer passes may have left the redundant state badge behind;
      // remove it when a task is updated so no second "下载中" control survives
      // a Vue rerender.
      existing.querySelectorAll('span').forEach(function (node) { node.remove() })
      bar.style.width = progress + '%'
      bar.classList.toggle('indeterminate', !known)
      var value = String(task.status || '').toLowerCase()
      var buttons = card.querySelectorAll('button.v-btn,button')
      // `download-btn` belongs to upstream ProgressButton. Prefer it over
      // text matching so the adjacent 详情 action can never be accidentally
      // changed after a translation or Vue rerender.
      var downloadButton = findModDownloadButton(card)
      for (var buttonIndex = 0; buttonIndex < buttons.length; buttonIndex++) {
        if (downloadButton) break
        var button = buttons[buttonIndex]
        var buttonText = String(button.textContent || '').trim()
        if (/下载|更新/.test(buttonText) && !/详情/.test(buttonText)) {
          downloadButton = button
          break
        }
      }
      if (!downloadButton && buttons.length) downloadButton = buttons[buttons.length - 1]
      if (downloadButton) {
        downloadButton.classList.add('android-mod-download-button')
        // Keep the upstream action disabled while a task is active.  The
        // numeric progress is still visible; cancellation is deliberately
        // exposed only by the task row's trash action because LinuxDMP has no
        // pause/continue endpoint.
        downloadButton.disabled = true
        downloadButton.setAttribute('disabled', 'disabled')
        downloadButton.classList.add('v-btn--disabled')
        downloadButton.setAttribute('aria-disabled', 'true')
        downloadButton.style.setProperty('pointer-events', 'none', 'important')
        // Remove any fill created by a previous bridge revision.  The button
        // intentionally contains only the numeric percentage while active;
        // the card-wide blue mask carries the visual progress.
        downloadButton.querySelectorAll('.android-mod-button-fill').forEach(function (node) {
          node.remove()
        })
        var percentLabel = downloadButton.querySelector('.android-mod-button-percent')
        if (!percentLabel) {
          percentLabel = document.createElement('span')
         percentLabel.className = 'android-mod-button-percent'
          downloadButton.appendChild(percentLabel)
        }
        // The button itself is a compact numeric indicator while downloading;
        // it is not a second cancel control.
        percentLabel.textContent = progress.toFixed(1) + '%'
        downloadButton.dataset.androidModStatus = value || 'running'
        downloadButton.dataset.androidModProgressTask = String(task.id || '')
      }
      card.dataset.androidModProgressTask = String(task.id || '')
    }
    function cardMatches(card, task) {
      if (!card || card.closest('.download-center-card') || isModAddTableNode(card)) return false
      var id = Number(task && (task.modID || task.modId) || 0)
      var stamped = Number(card.getAttribute('data-android-mod-id') || 0)
      if (id > 0 && stamped === id) return true
      var catalogue = modCatalogueItem(task && (task.modID || task.modId))
      var name = String(task && task.name || '').trim()
      if ((!name || /^模组\s*\d+$/i.test(name)) && catalogue) name = catalogue.name
      var text = String(card.textContent || '')
      if (name && !/^模组\s*\d+$/i.test(name)) {
        var compact = name.replace(/\s*\.\.\.$/, '').trim()
        var prefix = compact.slice(0, Math.min(18, compact.length))
        if (text.indexOf(name) >= 0 || (prefix.length >= 6 && text.indexOf(prefix) >= 0)) return true
      }
      if (id > 0) {
        var nodes = card.querySelectorAll('[data-mod-id],[data-modid],[data-mod_id],[data-id]')
        for (var i = 0; i < nodes.length; i++) {
          var value = nodes[i].getAttribute('data-mod-id') || nodes[i].getAttribute('data-modid')
            || nodes[i].getAttribute('data-mod_id') || nodes[i].getAttribute('data-id')
          if (Number(value) === id) return true
        }
        // Some builds expose the id only in a title/aria-label. Require the
        // catalogue name too, avoiding matches against unrelated card numbers.
        if (catalogue && text.indexOf(catalogue.name) >= 0
            && new RegExp('(?:^|[^0-9])' + id + '(?:$|[^0-9])').test(text)) return true
      }
      return false
    }
    function collectModCards() {
      // Vue 3.2 has shipped the catalogue under several wrapper class names
      // (the current build uses `.v-card.cursor-auto`).  Start with every
      // VCard and retain only cards that look like catalogue entries; this
      // keeps the overlay working when a hashed page wrapper changes again.
      var candidates = document.querySelectorAll('.v-card, .mod-card, [class*="mod"] [class*="card"]')
      var cards = []
      Array.prototype.forEach.call(candidates, function (card) {
        if (!card || card.closest('.download-center-card') || isModAddTableNode(card)) return
        // The current modInfo component marks its root as `v-card
        // cursor-auto`.  While Vuetify is in its loading state the download
        // button text is replaced by a spinner, so text-based discovery below
        // cannot see an action; keep this stable root selector as a direct
        // candidate and let cardMatches perform the final name/id check.
        if (card.matches && card.matches('.v-card.cursor-auto')) {
          cards.push(card)
          return
        }
        var buttons = card.querySelectorAll('button,[role="button"]')
        var hasDownloadAction = false
        Array.prototype.forEach.call(buttons, function (button) {
          if (/下载|更新|重下|download|update/i.test(String(button.textContent || ''))
              && !/详情|detail/i.test(String(button.textContent || ''))) {
            hasDownloadAction = true
          }
        })
        var cardText = String(card.textContent || '')
        var hasCatalogueName = Object.keys(modCatalogue).some(function (key) {
          var item = modCatalogue[key]
          return item && item.name && cardText.indexOf(item.name) >= 0
        })
        if (hasDownloadAction || hasCatalogueName || card.querySelector('.downloaded-corner')) {
          cards.push(card)
        }
      })
      return cards
    }
    function hideLegacyProgressLabels(card, downloadButton) {
      if (!card) return
      // The upstream card may leave a leaf text node such as "下载中" in a
      // status badge after its own queue rerenders.  Hide only that leaf and
      // never touch the actual action button or our numeric label.
      var nodes = card.querySelectorAll('*')
      Array.prototype.forEach.call(nodes, function (node) {
        if (!node || node === downloadButton || node.closest('button,[role="button"]')
            || node.closest('.android-mod-download-progress')
            || node.closest('.android-mod-download-button')) return
        if (node.children && node.children.length) return
        var value = String(node.textContent || '').trim()
        if (/^(下载中|等待中|正在下载|downloading|queued)$/i.test(value)) {
          node.style.setProperty('display', 'none', 'important')
          node.setAttribute('aria-hidden', 'true')
        }
      })
    }
    function clearStale() {
      document.querySelectorAll('.android-mod-progress-card').forEach(function (card) {
        clearCardProgress(card)
      })
    }
    function mount() {
      /* The progress overlay only belongs to the mod catalogue.  Do not
         collect and inspect every card on dashboard, backup, map, or room
         settings pages during the 750 ms watchdog tick. */
      var hash = String(window.location && window.location.hash || '')
        .replace(/^#/, '').split('?')[0]
      var modRoute = /^\/(?:game\/mod|mod)(?:\/|$)/i.test(hash)
        || !!(document.body && document.body.querySelector(
          '.mod-page-toolbar,.mod-setting-container,.mod-config-layout,.android-mod-add-table'))
      if (!modRoute) {
        clearStale()
        return
      }
      var store = window.__dmpDownloadStore
      if (!store || !Array.isArray(store.tasks)) return
      if (isModAddPage()) {
        /* A stale mask from the previous mod list must not survive while the
           add table is open, but none of the add-table buttons are ours. */
        clearStale()
        return
      }
      var currentRoom = roomId()
      // Apply installed/update presentation even when the queue is empty.
      // The previous early return meant a freshly opened catalogue (the
      // normal case when nothing is downloading) never received the old green
      // name/download-vs-update treatment.
      var cards = collectModCards()
      cards.forEach(applyInstalledState)
      var tasks = store.tasks.filter(function (task) {
        return task && task.type === 'mod_download'
          && String(task.serverId || downloadServerId) === String(downloadServerId)
          && (!currentRoom || Number(task.roomID || task.roomId || 0) === currentRoom)
      })
      if (!tasks.length) { clearStale(); return }
      // 3.2's catalogue cards are VCards inside .item-container, while a
      // few deployments omit that wrapper and leave only cursor-auto. Cover
      // both shapes, but never touch the download centre/dialog cards.
      var claimed = {}
      tasks.forEach(function (task) {
        var catalogue = modCatalogueItem(task.modID || task.modId)
        var name = String(task.name || '').trim()
        if ((!name || /^模组\s*\d+$/i.test(name)) && catalogue) {
          name = catalogue.name
          task.name = name
          if (typeof store.upsertTask === 'function') {
            store.upsertTask({ id: task.id, name: name, modID: task.modID || task.modId })
          }
        }
        for (var index = 0; index < cards.length; index++) {
          var card = cards[index]
          if (claimed[index]) continue
          if (cardMatches(card, task)) {
            claimed[index] = true
            // Vue 3.2 does not render the keyed mod id as a DOM attribute.
            // Stamp the once-confirmed match so later progress/cancel polls
            // do not have to rely on a translated or truncated display name.
            if (Number(task.modID || task.modId || 0) > 0) {
              card.setAttribute('data-android-mod-id', String(task.modID || task.modId))
            }
            mountTask(card, task)
            hideLegacyProgressLabels(card, card.querySelector('.android-mod-download-button'))
            break
          }
        }
      })
      // Remove masks whose task was deleted or whose card left the current
      // catalogue page. Without this cleanup a stale overlay survives route
      // changes and makes a fresh card look like it is still downloading.
      var active = {}
      tasks.forEach(function (task) { active[String(task.id || '')] = true })
      document.querySelectorAll('.android-mod-progress-card').forEach(function (card) {
        var id = String(card.dataset.androidModProgressTask || '')
        if (!id || !active[id]) {
          clearCardProgress(card)
        }
      })
    }

    window.setInterval(mount, 750)
    if (window.__dmpDownloadStore && typeof window.__dmpDownloadStore.subscribe === 'function') {
      window.__dmpDownloadStore.subscribe(mount)
    }
  }

  // Keep the last room chosen from the platform-management entry in the
  // native server list.  Room-preview launches intentionally do not persist
  // this value (the native bridge ignores them), so total-room management and
  // direct room links cannot overwrite the platform default.
  var lastSyncedRoom = ''
  function syncSelectedRoom() {
    if (!nativeBridge || typeof nativeBridge.syncSelectedRoom !== 'function') return
    try {
      var raw = localStorage.getItem('dmp-global')
      if (!raw) return
      var global = JSON.parse(raw)
      var room = global && global.room
      var id = Number(room && room.id || 0)
      var name = room && room.gameName ? String(room.gameName) : ''
      if (id <= 0) return
      var key = id + '|' + name
      if (key === lastSyncedRoom) return
      lastSyncedRoom = key
      nativeBridge.syncSelectedRoom(id, name)
    } catch (ignored) {
      // A partially written persisted store is harmless; the next poll retries.
    }
  }
  window.setInterval(syncSelectedRoom, 1200)
  window.addEventListener('hashchange', syncSelectedRoom)

  // DMP 3.2.0 has no /tasks or /platform/manual_update endpoint.  Server
  // updates are submitted by the Vue page and represented by the native
  // task snapshot; do not start the old compatibility monitor here because
  // it would create duplicate, indeterminate rows and issue obsolete polls.

  // Vuetify's download menu intentionally keeps content clicks open. On the
  // Android build the queue behaves like a transient card instead: any tap or
  // swipe that starts outside the card closes it immediately, while clicks on
  // the download activator continue to toggle it normally.
  function installDownloadCardDismiss() {
    var startX = 0
    var startY = 0
    var closePending = false
    function cardVisible(card) {
      if (!card) return false
      var style = window.getComputedStyle(card)
      return style.display !== 'none' && style.visibility !== 'hidden'
        && card.getBoundingClientRect().width > 0
    }
    function findCard() {
      var cards = document.querySelectorAll('.download-center-card')
      for (var i = cards.length - 1; i >= 0; i--) {
        if (cardVisible(cards[i])) return cards[i]
      }
      return null
    }
    function findActivator() {
      // The same download icon is also used by the left navigation's
      // “下载日志” entry.  Prefer the toolbar activator; selecting the nav
      // icon left the card open because it has no owning button.
      var toolbarIcon = document.querySelector(
        '.layout-navbar i.ri-download-2-line, .navbar-content-container i.ri-download-2-line')
      var toolbarButton = toolbarIcon && toolbarIcon.closest('button,[role=button]')
      if (toolbarButton) return toolbarButton
      var icons = document.querySelectorAll('i.ri-download-2-line')
      for (var index = 0; index < icons.length; index++) {
        var button = icons[index].closest('button,[role=button]')
        if (button) return button
      }
      return null
    }
    function closeCard() {
      var card = findCard()
      var activator = findActivator()
      if (!card || !activator || closePending) return
      closePending = true
      // Let Vuetify update its model instead of removing DOM nodes behind its
      // reactive renderer. A synthetic click is safe because it is scheduled
      // after the original outside event has completed.
      window.setTimeout(function () {
        if (cardVisible(card)) activator.click()
        closePending = false
      }, 0)
    }
    document.addEventListener('pointerdown', function (event) {
      startX = event.clientX || 0
      startY = event.clientY || 0
      var card = findCard()
      if (!card) return
      var activator = findActivator()
      if (!card.contains(event.target) && !(activator && activator.contains(event.target))) {
        closeCard()
      }
    }, true)
    document.addEventListener('pointerup', function (event) {
      var card = findCard()
      if (!card) return
      var dx = (event.clientX || 0) - startX
      var dy = (event.clientY || 0) - startY
      var activator = findActivator()
      if (!card.contains(event.target) && !(activator && activator.contains(event.target))
        && (Math.abs(dx) > 12 || Math.abs(dy) > 12)) {
        closeCard()
      }
    }, true)
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeCard()
    }, true)
  }

  // The bundled VSnackbar only handles vertical gestures. Add horizontal
  // dismissal and keep the transition in sync with its existing timeout.
  function installSnackbarSwipeDismiss() {
    var starts = new WeakMap()
    var activeSnackbar = null
    document.addEventListener('touchstart', function (event) {
      var snackbar = event.target && event.target.closest
        ? event.target.closest('.v-snackbar') : null
      if (snackbar && event.touches && event.touches[0]) {
        starts.set(snackbar, { x: event.touches[0].clientX, y: event.touches[0].clientY })
        activeSnackbar = snackbar
      } else {
        activeSnackbar = null
      }
    }, { capture: true, passive: true })
    document.addEventListener('touchend', function (event) {
      // A swipe may finish outside the snackbar.  Keep the element captured
      // on touchstart so releasing over the page still dismisses it.
      var snackbar = event.target && event.target.closest
        ? event.target.closest('.v-snackbar') : null
      snackbar = snackbar || activeSnackbar
      var first = snackbar && starts.get(snackbar)
      var touch = event.changedTouches && event.changedTouches[0]
      activeSnackbar = null
      if (!snackbar || !first || !touch) return
      var dx = touch.clientX - first.x
      var dy = touch.clientY - first.y
      if (Math.abs(dx) < 48 && dy > -72) return
      snackbar.style.transition = 'transform .22s ease, opacity .22s ease'
      snackbar.style.transform = 'translate(' + (dx < 0 ? '-115%' : '115%') + ','
        + (dy < -48 ? '-115%' : '0') + ')'
      snackbar.style.opacity = '0'
      window.setTimeout(function () {
        // Clicking a snackbar action/close control lets Vue clear its model;
        // otherwise remove only the rendered node after the animation.
        // Do not click the first arbitrary action button: operation
        // snackbars may contain a retry/undo action, and a swipe should only
        // dismiss the snackbar.  Prefer Vuetify's explicit close control;
        // otherwise remove the rendered node after the animation.
        var close = snackbar.querySelector(
          '.v-snackbar__close, button[aria-label="关闭"], button[aria-label="Close"]')
        if (close) close.click()
        else if (snackbar.parentNode) snackbar.parentNode.removeChild(snackbar)
      }, 230)
    }, { capture: true, passive: true })
    document.addEventListener('touchcancel', function () {
      activeSnackbar = null
    }, { capture: true, passive: true })
  }

  function installAndroidWebPolish() {
    var style = document.createElement('style')
    style.id = 'android-dmp-final-polish'
    style.textContent = [
      'html.android-dmp-dark,html.android-dmp-dark body,html.android-dmp-dark body>*,html.android-dmp-dark #app,html.android-dmp-dark #app>*,html.android-dmp-dark .v-application,html.android-dmp-dark .v-application__wrap,html.android-dmp-dark .layout-wrapper,html.android-dmp-dark .layout-page-content,html.android-dmp-dark .layout-content-wrapper,html.android-dmp-dark .page-content-container,html.android-dmp-dark .v-main,html.android-dmp-dark .v-main__wrap,html.android-dmp-dark main{background:#24213D!important;color:#F5F3FF!important}',
      'html.android-dmp-dark .v-card,html.android-dmp-dark .v-menu>.v-overlay__content,html.android-dmp-dark .v-dialog>.v-overlay__content{background-color:#302B4A!important;color:#F5F3FF!important}',
      'html.android-dmp-dark .v-list,html.android-dmp-dark .v-sheet{background-color:#302B4A!important;color:#F5F3FF!important}',
      'html.android-dmp-dark .text-medium-emphasis,html.android-dmp-dark .text-caption{color:rgba(245,243,255,.68)!important}',
      '.android-native-transfer-delete{margin-inline-start:2px;display:inline-flex;align-items:center;justify-content:center;border:0;background:transparent;color:inherit;padding:6px;min-width:28px;min-height:28px;border-radius:50%}',
      '.android-native-transfer-delete:active{background:rgba(127,95,255,.16)}'
    ].join('\n')
    document.head.appendChild(style)
    function syncDarkTheme() {
      // The bridge is loaded from <head>, before <body> exists.  Keep this
      // helper safe during that first pass; a null body used to abort the
      // entire bridge and consequently disabled every later enhancement.
      var root = document.documentElement
      if (!root) return
      var body = document.body
      var dark = bootstrap.theme === 'dark'
        || !!document.querySelector('.v-theme--dark')
        || root.classList.contains('v-theme--dark')
        || !!(body && body.classList.contains('v-theme--dark'))
      root.classList.toggle('android-dmp-dark', dark)
    }
    syncDarkTheme()
    if (typeof MutationObserver !== 'undefined') {
      /* Theme state is carried by the document root/body in the Android
         shell.  Observing every descendant class caused this callback to run
         for virtually every Vuetify mount/update on every route; each pass
         then queried the whole document, which could starve the WebView.
         Observe only the two theme owners and coalesce updates per frame. */
      var themeFrame = 0
      var observer = new MutationObserver(function () {
        if (themeFrame) return
        var run = function () {
          themeFrame = 0
          syncDarkTheme()
        }
        if (window.requestAnimationFrame) themeFrame = window.requestAnimationFrame(run)
        else themeFrame = window.setTimeout(run, 16)
      })
      observer.observe(document.documentElement, {
        subtree: false,
        attributes: true,
        attributeFilter: ['class']
      })
      function observeBodyTheme() {
        if (!document.body) return
        observer.observe(document.body, {
          subtree: false,
          attributes: true,
          attributeFilter: ['class']
        })
        syncDarkTheme()
      }
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', observeBodyTheme, { once: true })
      } else {
        observeBodyTheme()
      }
    }
  }

  function hideLanguageButton() {
    // Vuetify may recreate the toolbar button during route changes.  Match
    // both the concrete Remix icon class and any translated/hashed variant
    // emitted by a different build, then hide the owning activator.
    var icons = document.querySelectorAll(
      'i.ri-translate-2, i[class*="ri-translate"]')
    icons.forEach(function (icon) {
      var button = icon.closest('button,[role=button]')
      if (button) {
        button.style.display = 'none'
        button.setAttribute('aria-hidden', 'true')
      }
    })
    document.querySelectorAll('button,[role=button]').forEach(function (button) {
      if (button.querySelector('i.ri-translate-2, i[class*="ri-translate"]')) {
        button.style.display = 'none'
        button.setAttribute('aria-hidden', 'true')
      }
    })
  }

  // desktop-master has no UserProfile in the navbar.  The API bundle that is
  // still used for the Android shell does, however, render an avatar badge at
  // the far right.  Keep `userInfo` in the bootstrap (the router needs it) but
  // remove only the toolbar node that actually contains the avatar.  This is
  // deliberately narrower than hiding every `.v-badge`, because version and
  // download badges are legitimate controls.
  function hideAndroidUserProfile() {
    // A previous avatar pass could mistake the navbar wrapper itself for the
    // avatar owner.  Always restore structural toolbar nodes before applying
    // the narrow avatar-only hide below; otherwise the entire top bar becomes
    // invisible while the page content still renders normally.
    document.querySelectorAll(
      '.layout-navbar.android-user-profile-hidden, '
      + '.layout-navbar .navbar-content-container.android-user-profile-hidden, '
      + '.layout-navbar .d-flex.h-100.align-center.android-user-profile-hidden'
    ).forEach(function (node) {
      node.classList.remove('android-user-profile-hidden')
      node.removeAttribute('aria-hidden')
      node.removeAttribute('tabindex')
    })
    var navbar = document.querySelector('.layout-navbar .navbar-content-container')
    if (navbar) {
      var toolbar = navbar.querySelector('.d-flex.h-100.align-center') || navbar
      var avatars = toolbar.querySelectorAll('.v-avatar, img[src*="avatar"], img[src*="Avatar"]')
      avatars.forEach(function (avatar) {
        var owner = avatar.closest('.v-badge,button,[role=button]') || avatar.parentElement
        if (!owner || owner.id === 'android-dmp-mobile-download-centre'
          || owner.closest('#android-dmp-mobile-download-centre')) return
        var top = owner
        while (top.parentElement && top.parentElement !== toolbar) top = top.parentElement
        if (top.parentElement === toolbar) {
          top.classList.add('android-user-profile-hidden')
          top.setAttribute('aria-hidden', 'true')
          top.setAttribute('tabindex', '-1')
        }
      })
      // Some Vuetify builds wrap the avatar in a span without `.v-badge`; the
      // direct toolbar-child walk covers that form without touching room chips.
      Array.prototype.slice.call(toolbar.children || []).forEach(function (child) {
        if (child.classList && child.classList.contains('android-dmp-mobile-download-anchor')) return
        if (child.querySelector && child.querySelector('.v-avatar')) {
          child.classList.add('android-user-profile-hidden')
          child.setAttribute('aria-hidden', 'true')
          child.setAttribute('tabindex', '-1')
        }
      })
    }

    // A few generated navbar builds place the profile activator outside the
    // `.navbar-content-container` wrapper.  Keep the scope to the navbar so
    // avatars in room cards and the cloud-status panel are never affected.
    document.querySelectorAll(
      '.layout-navbar .v-avatar, .layout-navbar img[src*="avatar"], '
      + '.layout-navbar img[src*="Avatar"], .layout-navbar [data-profile], '
      + '.layout-navbar [data-user-profile]'
    ).forEach(function (avatar) {
      var owner = avatar.closest('.v-badge,button,a,[role=button]') || avatar.parentElement
      if (!owner || owner.id === 'android-dmp-mobile-download-centre'
        || owner.closest('#android-dmp-mobile-download-centre')) return
      var top = owner
      var parent = avatar.closest('.layout-navbar')
      while (top.parentElement && top.parentElement !== parent) top = top.parentElement
      var toolbarContainer = top && top.classList && (
        top.classList.contains('navbar-content-container')
        || (top.classList.contains('d-flex')
          && top.classList.contains('h-100')
          && top.classList.contains('align-center')))
      if (top.parentElement === parent && top !== parent && !toolbarContainer) {
        top.classList.add('android-user-profile-hidden')
        top.setAttribute('aria-hidden', 'true')
        top.setAttribute('tabindex', '-1')
      } else if (avatar.classList) {
        // If the only safe target is a toolbar wrapper, hide the avatar node
        // itself and leave menu/room/download controls visible.
        avatar.classList.add('android-user-profile-hidden')
        avatar.setAttribute('aria-hidden', 'true')
      }
    })
  }

  /*
   * The web DMP exposes a complete `/profile` page for desktop users.  The
   * Android shell deliberately has no cloud-account login/bind capability:
   * account state may still be read through the existing API, but every UI
   * entry that would open the profile page must be absent or inert.  Keep this
   * guard in the bridge instead of editing the upstream bundles so a future
   * desktop update can be copied in without reintroducing a login form.
   */
  function installAndroidPersonalEntryGuard() {
    if (window.__dmpAndroidPersonalEntryGuardInstalled) return
    window.__dmpAndroidPersonalEntryGuardInstalled = true

    function pathFrom(value) {
      var raw = String(value == null ? '' : value).trim()
      if (!raw) return ''
      try { raw = decodeURIComponent(raw) } catch (ignored) {}
      var hash = raw.indexOf('#')
      if (hash >= 0) raw = raw.slice(hash + 1)
      if (raw.indexOf('://') >= 0) {
        try { raw = new URL(raw, window.location.href).hash || '' } catch (ignored) {}
        if (raw.charAt(0) === '#') raw = raw.slice(1)
      }
      if (raw.charAt(0) !== '/') raw = '/' + raw
      return raw.split('?')[0].replace(/\/$/, '') || '/'
    }

    function currentPath() {
      return pathFrom(window.location && window.location.hash || '')
    }

    function isProfilePath(value) {
      return /^\/profile(?:\/|$)/i.test(pathFrom(value))
    }

    function safePath() {
      return bootstrap.roomPreview ? '/dashboard' : '/rooms'
    }

    function redirectFromProfile() {
      var target = safePath()
      if (currentPath() === target) return
      try {
        // A hash assignment lets the official router update its component
        // without reloading the WebView or dropping the current API token.
        window.location.hash = '#' + target
      } catch (ignored) {}
    }

    function isAccountLabel(value) {
      var label = String(value || '').replace(/[\u00a0\s]+/g, '').trim()
      if (!label || label.length > 32) return false
      return /^(?:前往绑定|未绑定云账号|绑定云账号|绑定账号|登录云账号|云账号登录|重新绑定|解绑云账号|解绑账号|个人信息|个人资料|个人中心|用户中心|我的资料|账号设置)$/i.test(label)
    }

    function routeAttribute(node) {
      if (!node || !node.getAttribute) return ''
      return node.getAttribute('href') || node.getAttribute('to')
        || node.getAttribute('data-route') || ''
    }

    function isProfileEntry(node) {
      if (!node) return false
      if (isProfilePath(routeAttribute(node))) return true
      var text = node.innerText || node.textContent || ''
      return isAccountLabel(text)
    }

    function hideEntry(node) {
      if (!node || !node.classList) return
      // Hide only the small menu/list owner.  Never climb to a whole card or
      // panel: cloud status and already-bound account information remain
      // visible and continue to be populated through the API.
      var owner = node.closest && node.closest(
        'a,button,[role="button"],[to],.v-list-item,.v-btn,.v-chip')
      owner = owner || node
      owner.classList.add('android-personal-entry-hidden')
      owner.setAttribute('aria-hidden', 'true')
      owner.setAttribute('tabindex', '-1')
      if ('disabled' in owner) owner.disabled = true
    }

    function removeProfileEntries() {
      // Attribute selectors cover router-link, Vuetify `to`, plain anchors,
      // and custom controls emitted by CloudArchivePanel/FavoritePanel.
      document.querySelectorAll(
        'a[href],button,[role="button"],[to],[data-route]'
      ).forEach(function (node) {
        if (isProfileEntry(node)) hideEntry(node)
      })
      // The cloud panel's bind action is occasionally rendered as a span
      // inside a button whose text is split across several child nodes.
      document.querySelectorAll('.v-list-item,.v-btn,.v-chip').forEach(function (node) {
        if (isAccountLabel(node.innerText || node.textContent || '')) hideEntry(node)
      })
    }

    function removeProfileMenus(value) {
      if (!Array.isArray(value)) return value
      return value.filter(function (item) {
        if (!item || typeof item !== 'object') return true
        var route = item.to || item.path || item.href || item.route || ''
        var title = item.title || item.name || item.label || ''
        if (isProfilePath(route) || isAccountLabel(title)) return false
        if (Array.isArray(item.links)) item.links = removeProfileMenus(item.links)
        if (Array.isArray(item.children)) item.children = removeProfileMenus(item.children)
        return true
      })
    }

    try {
      // This is a UI menu copy only; userInfo and the API methods remain
      // untouched so a binding created from the web site is still readable.
      if (bootstrap.user && Array.isArray(bootstrap.user.menus)) {
        bootstrap.user.menus = removeProfileMenus(bootstrap.user.menus)
      }
    } catch (ignored) {}

    var style = document.createElement('style')
    style.id = 'android-personal-entry-guard-style'
    style.textContent = [
      '.android-personal-entry-hidden{display:none!important;visibility:hidden!important;pointer-events:none!important}',
      '.layout-navbar .android-user-profile-hidden{display:none!important;visibility:hidden!important;pointer-events:none!important}',
      '.android-profile-route-message{display:block;margin:16px;color:rgba(var(--v-theme-on-surface),.72);font-size:14px}'
    ].join('\n')
    document.head.appendChild(style)

    // Block a click before Vue's router listener sees it.  This also handles
    // CloudArchivePanel's “前往绑定” link, which otherwise immediately opens
    // the full personal-information page.
    document.addEventListener('click', function (event) {
      var target = event.target && event.target.closest
        ? event.target.closest(
          'a[href],button,[role="button"],[to],[data-route],.v-list-item,.v-btn,.v-chip'
        ) : null
      if (!target || !isProfileEntry(target)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      redirectFromProfile()
    }, true)

    function guardRoute() {
      if (isProfilePath(currentPath())) redirectFromProfile()
      removeProfileEntries()
      hideAndroidUserProfile()
    }

    // Hash routing is used by both the desktop bundle and the Android shell.
    // A popstate listener covers builds that switch to history mode at runtime.
    window.addEventListener('hashchange', guardRoute, true)
    window.addEventListener('popstate', guardRoute, true)
    ;['pushState', 'replaceState'].forEach(function (method) {
      try {
        var original = window.history && window.history[method]
        if (typeof original !== 'function') return
        window.history[method] = function (state, title, url) {
          if (isProfilePath(url)) {
            url = '#' + safePath()
          }
          return original.call(window.history, state, title, url)
        }
      } catch (ignored) {}
    })

    guardRoute()
    window.setInterval(guardRoute, 900)
  }

  // The upstream `/rooms` card uses a single compact `.fcc` header and
  // truncates the room name to eight characters on mobile.  Keep the card's
  // action order but split the status/selection chips into a right-aligned
  // control group so the name receives all remaining width.  This is DOM
  // decoration only; room activation, selection and menu handlers remain
  // owned by Vue.
  function installAndroidRoomOverviewLayout() {
    var style = document.createElement('style')
    style.id = 'android-room-overview-layout'
    style.textContent = [
      /* The room overview nests a `v-row mx-1` around each card.  On the
         Android WebView its default min-width:auto lets the long header
         content size that row beyond the page width, pushing the selection
         and menu controls off-screen.  Let the row/column shrink while
         retaining Vuetify's existing margins and spacing. */
      'body.android-platform-view .v-row.mx-1{min-width:0!important}',
      'body.android-platform-view .v-row.mx-1>.v-col{min-width:0!important}',
      '.android-room-card-header{display:flex!important;align-items:center!important;gap:8px!important;width:100%!important;min-width:0!important}',
      '.android-room-card-header>.android-room-card-name{display:flex!important;align-items:center!important;flex:1 1 auto!important;min-width:0!important;justify-content:flex-start!important;overflow:hidden!important}',
      '.android-room-card-header>.android-room-card-name .v-chip__content{max-width:none!important;overflow:visible!important;text-overflow:clip!important;white-space:nowrap!important}',
      '.android-room-card-header>.android-room-card-controls{display:flex!important;align-items:center!important;justify-content:flex-end!important;gap:4px!important;flex:0 0 auto!important;margin-inline-start:auto!important;white-space:nowrap!important}',
      '.android-room-card-header>.android-room-card-controls>*{flex:0 0 auto!important}',
      '.android-room-card-header>.android-room-card-menu{flex:0 0 auto!important;margin-inline-start:0!important}',
      '@media (max-width:600px){.android-room-card-header{gap:4px!important}.android-room-card-header>.android-room-card-controls{gap:2px!important}.android-room-card-header>.android-room-card-name .v-chip{max-width:none!important}}'
    ].join('\n')
    document.head.appendChild(style)

    function findDirectMenu(header, icon) {
      var node = icon
      while (node && node.parentElement && node.parentElement !== header) node = node.parentElement
      return node && node.parentElement === header ? node : null
    }

    function decorate() {
      /* Room-card layout is only used by the platform room overview.  The
         bridge is loaded once for the whole SPA, so scanning every `.v-card`
         on dashboard/settings/map routes is needlessly expensive and can
         stall older WebViews during route mounts. */
      var roomOverviewHash = String(window.location && window.location.hash || '')
        .replace(/^#/, '').split('?')[0]
      if (!document.body
          || (!document.body.classList.contains('android-platform-view')
            && !/^\/(?:rooms|platform)(?:\/|$)/i.test(roomOverviewHash))) return
      document.querySelectorAll('.v-card').forEach(function (card) {
        var icon = card.querySelector('i.ri-more-2-line')
        if (!icon) return
        var header = icon.closest('.fcb')
        if (!header || header.dataset.androidRoomOverviewReady === '1') return
        var nameGroup = null
        Array.prototype.slice.call(header.children || []).some(function (child) {
          if (child.classList && child.classList.contains('fcc')) {
            nameGroup = child
            return true
          }
          return false
        })
        if (!nameGroup || !nameGroup.firstElementChild) return

        var controls = document.createElement('div')
        controls.className = 'android-room-card-controls'
        while (nameGroup.children.length > 1) {
          controls.appendChild(nameGroup.children[1])
        }
        if (!controls.firstElementChild) return

        nameGroup.classList.add('android-room-card-name')
        header.classList.add('android-room-card-header')
        var menu = findDirectMenu(header, icon)
        if (menu) {
          menu.classList.add('android-room-card-menu')
          header.insertBefore(controls, menu)
        } else {
          header.appendChild(controls)
        }
        header.dataset.androidRoomOverviewReady = '1'
      })
    }

    decorate()
    var decorateFrame = 0
    function scheduleDecorate() {
      if (decorateFrame) return
      var run = function () {
        decorateFrame = 0
        decorate()
      }
      if (window.requestAnimationFrame) decorateFrame = window.requestAnimationFrame(run)
      else decorateFrame = window.setTimeout(run, 16)
    }
    if (window.MutationObserver && document.body) {
      /* Vue mounts room cards in several childList batches. Coalesce those
         batches so the full-card scan runs once per frame instead of once per
         node insertion. */
      var observer = new MutationObserver(scheduleDecorate)
      observer.observe(document.body, { childList: true, subtree: true })
    }
    window.setInterval(decorate, 1200)
  }

  function installAndroidNavbarPolish() {
    var style = document.createElement('style')
    style.id = 'android-navbar-polish'
    style.textContent = [
      // The generated layout currently selects `layout-navbar-static` even
      // on Android.  Keep the toolbar in the normal layout flow while making
      // it sticky so the content never scrolls over the room/menu controls.
      'body.android-platform-view .layout-navbar,body.android-room-preview .layout-navbar{position:sticky!important;inset-block-start:0!important;z-index:2147483638!important;flex:0 0 auto!important;background:rgb(var(--v-theme-background))!important}',
      '.layout-navbar .v-btn .v-btn__overlay,.layout-navbar .v-btn .v-btn__underlay,.layout-navbar .v-btn .v-ripple__container{display:none!important;opacity:0!important;background:transparent!important}',
      // Vuetify recreates these layers outside the navbar for menu/list
      // buttons. They can otherwise remain as a translucent pressed mask
      // after a route click on the Android WebView.
      '.android-platform-view .v-btn__overlay,.android-platform-view .v-btn__underlay,.android-platform-view .v-ripple__container,.android-platform-view .v-list-item__overlay,.android-platform-view .v-card__overlay{display:none!important;opacity:0!important;background:transparent!important;pointer-events:none!important}',
      '.layout-navbar .v-btn:focus,.layout-navbar .v-btn:focus-visible,.layout-navbar .v-btn:active{outline:none!important;box-shadow:none!important}',
      '.layout-navbar .v-tooltip,.layout-navbar .v-tooltip__content,.android-platform-view .v-overlay-container .v-tooltip,.android-platform-view .v-overlay-container [role="tooltip"],[role="tooltip"].android-navbar-tooltip{display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important}',
      '.layout-navbar .android-user-profile-hidden{display:none!important;visibility:hidden!important;pointer-events:none!important}',
      // A tap gets a short desktop-like focus border on mobile.  The pseudo
      // element is removed with its class after one second, so no temporary
      // DOM nodes or stale inline styles accumulate between taps.
      '.android-tap-feedback{position:relative!important;isolation:isolate!important}',
      '.android-tap-feedback::after{content:"";position:absolute;z-index:20;inset:1px;border:2px solid rgba(145,85,253,.96);border-radius:inherit;pointer-events:none;opacity:1;animation:androidTapFeedbackFade 1s ease forwards}',
      '@keyframes androidTapFeedbackFade{0%,50%{opacity:1;box-shadow:0 0 0 2px rgba(145,85,253,.22),0 0 12px rgba(145,85,253,.62)}100%{opacity:0;box-shadow:0 0 0 0 rgba(145,85,253,0)}}',
      '.android-room-card-header{display:flex!important;align-items:center!important;gap:8px!important;width:100%!important;min-width:0!important}',
      '.android-room-card-header>.android-room-card-name{flex:1 1 auto!important;min-width:0!important;justify-content:flex-start!important;overflow:hidden!important}',
      '.android-room-card-header>.android-room-card-name .v-chip__content{max-width:none!important;overflow:visible!important;text-overflow:clip!important;white-space:nowrap!important}',
      '.android-room-card-header>.android-room-card-controls{display:flex!important;align-items:center!important;justify-content:flex-end!important;gap:4px!important;flex:0 0 auto!important;margin-inline-start:auto!important;white-space:nowrap!important}',
      '.android-room-card-header>.android-room-card-controls>*{flex:0 0 auto!important}',
      '.android-room-card-header>.v-menu,.android-room-card-header>button,.android-room-card-header>[class*="menu"]{flex:0 0 auto!important;margin-inline-start:0!important}',
      '@media (orientation:landscape) and (min-width:900px){body.android-room-preview .layout-wrapper,body.android-room-preview .layout-content-wrapper{min-height:100vh!important;height:auto!important}body.android-room-preview .layout-page-content{min-height:calc(100vh - 64px)!important}body.android-room-preview .page-content-container{min-height:100%!important}}'
    ].join('\n')
    document.head.appendChild(style)

    function ensureStickyLayout() {
      document.querySelectorAll('.layout-wrapper.layout-nav-type-vertical').forEach(function (wrapper) {
        wrapper.classList.add('layout-navbar-sticky')
        wrapper.classList.remove('layout-navbar-static')
      })
    }
    ensureStickyLayout()
    window.setInterval(ensureStickyLayout, 1200)

    function removeOfficialDownloadButton() {
      if (!androidDownloadUi) return
      // The generated toolbar owns a DownloadCenter activator, while the
      // Android download-center script mounts its own room-aware trigger.
      // Keep the generated node in the DOM for route semantics but hide only
      // its visual button; left-nav download log buttons are out of scope.
      document.querySelectorAll('.layout-navbar i.ri-download-2-line').forEach(function (icon) {
        var button = icon.closest('button,[role="button"]')
        if (!button || button.closest('#android-dmp-mobile-download-centre')) return
        var owner = button.closest('.v-badge') || button
        owner.style.display = 'none'
        owner.setAttribute('aria-hidden', 'true')
      })
    }
    removeOfficialDownloadButton()
    window.setInterval(removeOfficialDownloadButton, 1200)

    function tapFeedback(button) {
      if (!button || button.disabled) return
      button.classList.remove('android-tap-feedback')
      // Force a fresh animation when the same button is tapped repeatedly.
      void button.offsetWidth
      button.classList.add('android-tap-feedback')
      if (button.__androidTapFeedbackTimer) window.clearTimeout(button.__androidTapFeedbackTimer)
      button.__androidTapFeedbackTimer = window.setTimeout(function () {
        button.classList.remove('android-tap-feedback')
        delete button.__androidTapFeedbackTimer
      }, 1000)
    }
    document.addEventListener('pointerdown', function (event) {
      var button = event.target && event.target.closest
        ? event.target.closest('button,.v-btn,[role="button"]') : null
      tapFeedback(button)
    }, true)
    document.addEventListener('click', function (event) {
      var button = event.target && event.target.closest
        ? event.target.closest('button,.v-btn,[role="button"]') : null
      tapFeedback(button)
    }, true)

    function clear(button) {
      if (button && button.closest('.layout-navbar')) {
        // The text is provided by Vuetify's tooltip overlay, not by the icon
        // button. Blur the activator after its action without changing the
        // accessible aria-label used by TalkBack.
        // A few builds also copy the tooltip text to the native title
        // attribute. Remove only that visual hint; keep aria-label intact for
        // accessibility and automated testing.
        button.removeAttribute('title')
        window.setTimeout(function () {
          try { button.blur() } catch (ignored) {}
          document.querySelectorAll('.v-tooltip,[role="tooltip"]').forEach(function (tip) {
            if (tip && tip.classList) tip.classList.add('android-navbar-tooltip')
            if (tip && tip.style) tip.style.display = 'none'
          })
        }, 0)
        window.setTimeout(function () {
          document.querySelectorAll('.v-tooltip,[role="tooltip"]').forEach(function (tip) {
            if (tip && tip.classList) tip.classList.add('android-navbar-tooltip')
          })
        }, 90)
      }
    }
    function stripTitles() {
      document.querySelectorAll('.layout-navbar button,[role="button"]').forEach(function (button) {
        if (button.closest('.layout-navbar')) button.removeAttribute('title')
      })
    }
    stripTitles()
    window.setInterval(stripTitles, 1200)
    document.addEventListener('click', function (event) {
      var button = event.target && event.target.closest
        ? event.target.closest('.layout-navbar button,[role="button"]') : null
      clear(button)
    }, true)
    document.addEventListener('pointerup', function (event) {
      var button = event.target && event.target.closest
        ? event.target.closest('.layout-navbar button,[role="button"]') : null
      clear(button)
    }, true)
  }

  // The platform download panel is rendered by the bundled Vue app and its
  // header has no clear-history action.  Add a small trash button to that
  // header on Android only.  A short tap removes successful/terminal rows;
  // long-press explicitly confirms clearing every row for this platform.
  function installPlatformTaskClearButton() {
    if (bootstrap.roomPreview) return
    var completedStatuses = {
      success: true,
      complete: true,
      completed: true,
      done: true
    }
    // Do not depend on one locale: the Vue task row may be rendered with the
    // English bundle even while the surrounding page is Chinese.  The row is
    // still required to contain a terminal status phrase before we activate
    // its delete action.
    var statusText = /(?:下载完成|已完成|后台更新完成|传输完成|download\s+complete(?:d)?|transfer\s+complete(?:d)?|completed|success)/i

    function isCompleted(task) {
      return !!task && !!completedStatuses[String(task.status || '').toLowerCase()]
    }

    function removeStoreCompleted() {
      var store = window.__dmpDownloadStore
      var removed = 0
      if (!store || !Array.isArray(store.tasks)) return removed
      store.tasks.slice().forEach(function (task) {
        // A platform task card must never clear another platform's history.
        // The bridge store is shared by the WebView, so scope this operation
        // to the server currently displayed by this page.
        if (!isCompleted(task)
            || String(task.serverId || downloadServerId) !== String(downloadServerId)
            || typeof store.removeTask !== 'function') return
        store.removeTask(task.id)
        removed++
      })
      return removed
    }

    function clearCompleted(card) {
      var removed = removeStoreCompleted()
      if (card) {
        // Server-owned rows are kept in the DownloadCenter component's local
        // API snapshot rather than in the Pinia store.  Activate their own
        // delete control so the normal endpoint, cache invalidation and
        // reactive re-render all run exactly as they do for a manual delete.
      card.querySelectorAll('.download-task').forEach(function (row) {
        var text = row.textContent || ''
        if (!statusText.test(text)) return
        // Legacy servers have no /tasks delete endpoint.  Their compatibility
        // row is rendered by this bridge and has no Vue action button, so use
        // the per-server persistent dismissal hook instead of looking for an
        // icon that cannot exist on the synthetic row.
        if (row.classList.contains('android-legacy-download-task')
            && typeof window.__dmpDismissLegacyUpdate === 'function') {
          window.__dmpDismissLegacyUpdate()
          row.remove()
          removed++
          return
        }
        var icon = row.querySelector(
            'button i.ri-delete-bin-line, button i.ri-close-line')
          var button = icon && icon.closest('button,[role=button]')
          if (!button || button.disabled) return
          button.click()
          removed++
        })
      }
      if (card) {
        var feedback = card.querySelector('.android-platform-task-feedback')
        if (!feedback) {
          feedback = document.createElement('div')
          feedback.className = 'android-platform-task-feedback'
          card.appendChild(feedback)
        }
        feedback.textContent = removed > 0 ? '已清除 ' + removed + ' 条已完成任务' : '没有可清除的已完成任务'
        feedback.classList.add('visible')
        window.clearTimeout(feedback.__androidTimer)
        feedback.__androidTimer = window.setTimeout(function () {
          feedback.classList.remove('visible')
        }, 5000)
      }
      return removed
    }

    /* Long-press is the deliberate destructive operation.  It clears every
       row belonging to this platform (including active local rows), while a
       short tap remains the history-only completed-row cleanup above. */
    function clearAll(card) {
      var store = window.__dmpDownloadStore
      var removed = 0
      if (store && Array.isArray(store.tasks)) {
        store.tasks.slice().forEach(function (task) {
          if (!task || String(task.serverId || downloadServerId)
              !== String(downloadServerId)) return
          var id = String(task.id || '')
          if (!id) return
          if (task.type === 'mod_download') markModTaskCancelled(id)
          var operation = isCompleted(task) && task.type === 'transfer'
            ? 'dismiss' : 'delete'
          var accepted = false
          try {
            if (task.type === 'transfer' && nativeBridge
                && typeof nativeBridge.nativeTransferAction === 'function') {
              accepted = nativeBridge.nativeTransferAction(id, operation) === true
            } else if (nativeBridge && typeof nativeBridge.webTaskAction === 'function') {
              accepted = nativeBridge.webTaskAction(id, operation) === true
            }
          } catch (ignored) {}
          if (accepted || typeof store.removeTask === 'function') {
            if (typeof store.removeTask === 'function') store.removeTask(id)
            removed++
          }
        })
      }
      if (card) {
        card.querySelectorAll('.download-task,.android-web-download-task').forEach(function (row) {
          if (row.classList.contains('android-legacy-download-task')
              && typeof window.__dmpDismissLegacyUpdate === 'function') {
            window.__dmpDismissLegacyUpdate()
            row.remove()
            removed++
            return
          }
          var icon = row.querySelector(
            'button i.ri-delete-bin-line,button i.ri-close-line')
          var button = icon && icon.closest('button,[role=button]')
          if (button && !button.disabled) {
            button.click()
            removed++
          }
        })
      }
      if (card) {
        var feedback = card.querySelector('.android-platform-task-feedback')
        if (!feedback) {
          feedback = document.createElement('div')
          feedback.className = 'android-platform-task-feedback'
          card.appendChild(feedback)
        }
        feedback.textContent = removed > 0 ? '任务执行成功' : '没有可删除的任务'
        feedback.classList.add('visible')
        window.clearTimeout(feedback.__androidTimer)
        feedback.__androidTimer = window.setTimeout(function () {
          feedback.classList.remove('visible')
        }, 5000)
      }
      return removed
    }

    function bindClearPress(button, card) {
      var timer = 0
      var longPressed = false
      function cancelTimer() {
        if (timer) {
          window.clearTimeout(timer)
          timer = 0
        }
      }
      function begin(event) {
        if (event && event.type === 'mousedown' && event.button !== 0) return
        cancelTimer()
        longPressed = false
        timer = window.setTimeout(function () {
          timer = 0
          longPressed = true
          var confirmed = true
          try { confirmed = window.confirm('是否删除全部下载任务？') } catch (ignored) {}
          if (confirmed) clearAll(card)
        }, 620)
      }
      function end(event) {
        cancelTimer()
        if (longPressed && event && event.cancelable) {
          event.preventDefault()
          event.stopPropagation()
        }
      }
      button.addEventListener('pointerdown', begin)
      button.addEventListener('pointerup', end)
      button.addEventListener('pointercancel', end)
      button.addEventListener('pointerleave', end)
      button.addEventListener('contextmenu', function (event) {
        event.preventDefault()
        event.stopPropagation()
      })
      button.addEventListener('click', function (event) {
        event.preventDefault()
        event.stopPropagation()
        if (longPressed) {
          longPressed = false
          return
        }
        clearCompleted(card)
      })
    }

    function mount() {
      var cards = document.querySelectorAll('.download-center-card')
      cards.forEach(function (card) {
        var header = card.querySelector('.download-center-header')
        if (header && !header.querySelector('.android-platform-task-clear')) {
          var button = document.createElement('button')
          button.type = 'button'
          button.className = 'android-platform-task-clear'
          button.setAttribute('aria-label', '清除已完成下载')
          button.setAttribute('title', '清除已完成下载')
          button.innerHTML = '<i class="ri-delete-bin-line"></i>'
          bindClearPress(button, card)
          header.appendChild(button)
        }
        // Mount the fixed feedback slot up front.  Vue may replace its task
        // list after every poll; keeping this element outside the list makes
        // the card height stable even before the first action message.
        if (!card.querySelector('.android-platform-task-feedback')) {
          var feedback = document.createElement('div')
          feedback.className = 'android-platform-task-feedback'
          card.appendChild(feedback)
        }
      })
    }

    var style = document.createElement('style')
    style.id = 'android-platform-task-clear-style'
    style.textContent = [
      // Match the native all-platform task dialog's 38px action target. The
      // desktop Vuetify icon button is smaller, which made the platform and
      // total download views visibly inconsistent on the tablet.
      '.android-platform-task-clear,.android-task-trash,.android-native-transfer-delete{box-sizing:border-box!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;width:38px!important;height:38px!important;min-width:38px!important;min-height:38px!important;margin-inline-start:2px;padding:7px!important;border:0!important;border-radius:50%!important;background:transparent!important;color:inherit;line-height:1;-webkit-tap-highlight-color:transparent}',
      '.android-platform-task-clear i,.android-task-trash i,.android-native-transfer-delete i{font-size:22px!important;line-height:1!important;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center}',
      '.android-platform-task-clear:active,.android-task-trash:active,.android-native-transfer-delete:active{background:rgba(127,95,255,.16);transform:scale(.94)}',
      '.android-platform-task-clear:focus,.android-platform-task-clear:focus-visible{outline:none!important;box-shadow:none!important}',
      '.android-platform-task-feedback{display:block;visibility:hidden;box-sizing:border-box;min-height:32px;margin:0 12px 8px;padding:6px 10px;border-radius:10px;background:rgba(145,85,253,.10);color:rgba(var(--v-theme-on-surface),.72);font-size:12px;line-height:18px;opacity:0;pointer-events:none;transition:opacity .26s ease,visibility .26s ease}',
      '.android-platform-task-feedback.visible{visibility:visible;opacity:1}'
    ].join('\n')
    document.head.appendChild(style)
    mount()
    window.setInterval(mount, 850)
  }

  // DMP 3.2 removed the old Vue DownloadCenter markup. Its mobile
  // replacement is loaded by dmp-mobile-download-center.js; keep only the
  // state monitor, not the old selector-only card renderers.
  // installDownloadCardDismiss()
  if (androidDownloadUi) installLegacyDownloadMonitor()
  installSnackbarSwipeDismiss()
  installAndroidWebPolish()
  installAndroidNavbarPolish()
  installAndroidRoomOverviewLayout()
  hideAndroidUserProfile()
  window.setInterval(hideAndroidUserProfile, 1200)
  installAndroidPersonalEntryGuard()
  installAndroidRoomPicker()
  // Keep DownloadManager-backed exports in the shared token-free store.  The
  // mobile download panel consumes that store, while the legacy per-platform
  // renderer remains a no-op when the A-version download UI is disabled.
  if (androidDownloadUi) installAndroidWebDownloadQueue()
  if (androidDownloadUi) installModDownloadProgressOverlay()
  if (androidDownloadUi) installPlatformTaskClearButton()
  hideLanguageButton()
  window.setInterval(hideLanguageButton, 1200)

  window.electronAPI = {
    getStoreValue: function (key) {
      return clone(store[key])
    },
    setStoreValue: function (key, value) {
      store[key] = clone(value)
    },
    deleteStoreValue: function (key) {
      delete store[key]
    },
    clearStoreValue: function () {
      store = {}
    },
    openDashboardWindow: function () {
      window.location.hash = '#/dashboard'
    },
    openEntryWindow: function () {
      nativeBridge.openEntry()
    },
    reloadWindow: function () {
      window.location.reload()
    },
    themeChange: function () {
      return Promise.resolve()
    },
    downloadFile: function (url, fileName) {
      nativeBridge.downloadFile(url, fileName || 'dmp-download')
      return Promise.resolve()
    },
    openBrowser: function (url) {
      nativeBridge.openBrowser(url)
      return Promise.resolve()
    },
    onNavigate: function (callback) {
      window.setTimeout(function () {
        var currentRoute = window.location.hash.replace(/^#/, '').split('?')[0]
        callback(currentRoute || (bootstrap.roomPreview ? '/dashboard' : '/rooms'))
      }, 0)
    },
  }

})()

