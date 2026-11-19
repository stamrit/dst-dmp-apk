/*
 * Android DMP 3.2 mobile download centre.
 *
 * The upstream 3.2 layout no longer ships the old DownloadCenter Vue
 * component.  This script intentionally owns only a small DOM island: it
 * consumes the token-free task snapshot supplied by dmp-android-bridge.js
 * and never reaches into a Vue component's state or markup.
 *
 * It is written in ES5-compatible syntax because the target tablet's system
 * WebView is older than the WebView used by the desktop build.
 */
(function () {
  'use strict'

  if (window.__dmpMobileDownloadCenterInstalled) return
  window.__dmpMobileDownloadCenterInstalled = true

  var ROOT_ID = 'android-dmp-mobile-download-centre'
  var PANEL_ID = 'android-dmp-mobile-download-panel'
  var STYLE_ID = 'android-dmp-mobile-download-style'
  var state = {
    open: false,
    root: null,
    button: null,
    panel: null,
    notificationPanel: null,
    list: null,
    taskList: null,
    notificationList: null,
    badge: null,
    clear: null,
    feedback: null,
    tabs: null,
    mode: 'tasks',
    notifications: [],
    notificationAck: {},
    notificationAckKey: '',
    notificationTimer: 0,
    notificationRequestBusy: false,
    notificationLastRequest: 0,
    notificationModRequestBusy: false,
    notificationLastModRequest: 0,
    notificationSignature: '',
    notificationRoot: null,
    notificationButton: null,
    notificationBadge: null,
    nativeNotificationSignature: '',
    store: null,
    subscribedStore: null,
    pending: {},
    touch: null,
    server: null,
    acknowledgedErrors: {},
    acknowledgedErrorsKey: '',
    renderTimer: 0,
    renderSignature: ''
  }

  function text(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback || ''
    return String(value)
  }

  function number(value, fallback) {
    var parsed = Number(value)
    return isFinite(parsed) ? parsed : (fallback || 0)
  }

  function lower(value) {
    return text(value).trim().toLowerCase()
  }

  function first(object, keys, fallback) {
    if (!object) return fallback
    for (var index = 0; index < keys.length; index++) {
      var value = object[keys[index]]
      if (value !== undefined && value !== null && value !== '') return value
    }
    return fallback
  }

  function closest(element, selector) {
    if (!element) return null
    if (element.closest) return element.closest(selector)
    var current = element
    while (current && current.nodeType === 1) {
      var matcher = current.matches || current.msMatchesSelector || current.webkitMatchesSelector
      if (matcher && matcher.call(current, selector)) return current
      current = current.parentElement
    }
    return null
  }

  function bootstrap() {
    try {
      if (!window.AndroidDmp || typeof window.AndroidDmp.getBootstrap !== 'function') return {}
      return JSON.parse(window.AndroidDmp.getBootstrap() || '{}') || {}
    } catch (ignored) {
      return {}
    }
  }

  function mobileDownloadUiEnabled() {
    var value = bootstrap().androidDownloadUi
    // The Android settings screen serializes this as a boolean. Accept the
    // common string/number forms as well so a stale preference cannot mount
    // the custom centre when the user explicitly selected the official view.
    return value !== false && value !== 0 && lower(value) !== 'false'
  }

  function serverInfo() {
    var cached = state.server
    var bridgeServerId = text(window.__dmpServerId)
    if (cached && (!bridgeServerId || cached.id === bridgeServerId)) return cached

    var boot = bootstrap()
    var selected = boot.dmps && boot.dmps.length ? boot.dmps[0] : {}
    var id = bridgeServerId || text(selected.id || selected.serverId || selected.ip)
    var host = text(window.__dmpServerHost || selected.ip || selected.host)
    state.server = {
      id: id,
      host: host,
      name: text(window.__dmpServerName || selected.remark || selected.name || host || '当前服务器'),
      apiBaseUrl: text(boot.apiBaseUrl).replace(/\/+$/, ''),
      token: text(boot.apiToken || selected.token)
    }
    loadAcknowledgedErrors()
    return state.server
  }

  function routePath() {
    var hash = text(window.location && window.location.hash || '')
      .replace(/^#/, '').split('?')[0]
    return hash || text(window.location && window.location.pathname || '').split('?')[0] || '/'
  }

  function notificationPage() {
    /* The bell belongs to an entered platform.  Keep it out of the aggregate
       hall (`/platform`) and the launcher so the two native top-level cards do
       not compete for the same toolbar space. */
    var path = routePath()
    return path !== '/' && !/^\/(?:platform|login|welcome)(?:\/|$)/i.test(path)
  }

  function notificationAckStorageKey(server) {
    return 'dmp-mobile-platform-notification-ack:'
      + text(server && (server.id || server.host), 'current')
  }

  function loadNotificationAcknowledgements() {
    var key = notificationAckStorageKey(serverInfo())
    if (state.notificationAckKey === key) return
    state.notificationAckKey = key
    state.notificationAck = {}
    try {
      var parsed = JSON.parse(localStorage.getItem(key) || '{}')
      if (parsed && typeof parsed === 'object') state.notificationAck = parsed
    } catch (ignored) {}
  }

  function saveNotificationAcknowledgements() {
    if (!state.notificationAckKey) return
    try { localStorage.setItem(state.notificationAckKey, JSON.stringify(state.notificationAck || {})) } catch (ignored) {}
  }

  function notificationKey(item) {
    return text(item && item.key || [item && item.kind, item && item.modId,
      item && item.localVersion, item && item.latestVersion, item && item.name].join('|'))
  }

  function hasUnacknowledgedNotifications() {
    loadNotificationAcknowledgements()
    return state.notifications.some(function (item) {
      var key = notificationKey(item)
      return key && state.notificationAck[key] !== item.token
    })
  }

  function acknowledgeNotifications() {
    loadNotificationAcknowledgements()
    var changed = false
    state.notifications.forEach(function (item) {
      var key = notificationKey(item)
      if (!key || state.notificationAck[key] === item.token) return
      state.notificationAck[key] = item.token
      changed = true
    })
    if (changed) saveNotificationAcknowledgements()
  }

  function parseApiData(payload) {
    if (!payload) return {}
    if (payload.data && typeof payload.data === 'object') return payload.data
    return payload
  }

  function collectModNotifications() {
    var details = window.__dmpModDownloadedDetails || {}
    var catalogue = window.__dmpModCatalogue || {}
    var rows = []
    Object.keys(details).forEach(function (id) {
      var detail = details[id] || {}
      var item = catalogue[id] || {}
      var localSize = number(detail.localSize || detail.local_size || detail.sizeLocal || 0)
      var serverSize = number(detail.serverSize || detail.server_size || detail.sizeServer
        || item.serverSize || item.size || 0)
      var localUpdated = text(detail.localUpdatedAt || detail.localTimeUpdated
        || detail.time_updated || detail.updatedAt || '').trim()
      var serverUpdated = text(detail.serverUpdatedAt || detail.serverTimeUpdated
        || item.time_updated || item.updatedAt || '').trim()
      var update = localSize > 0 && serverSize > 0 && localSize !== serverSize
        || !!(localUpdated && serverUpdated && localUpdated !== serverUpdated)
      if (!update) return
      var name = text(item.name || detail.name || detail.modName, '模组 ' + id)
      var token = [id, localSize, serverSize, localUpdated, serverUpdated].join('|')
      rows.push({
        kind: 'mod',
        modId: Number(id) || id,
        name: name,
        title: '旧模组可更新',
        detail: name + '有更新',
        key: 'mod|' + id,
        token: token
      })
    })
    return rows
  }

  function currentRoomId() {
    var candidates = [window.__dmpServerRoomId]
    try {
      var boot = bootstrap()
      candidates.push(boot.global && boot.global.room && boot.global.room.id)
      var persisted = JSON.parse(localStorage.getItem('dmp-global') || '{}')
      candidates.push(persisted.room && persisted.room.id)
    } catch (ignored) {}
    for (var i = 0; i < candidates.length; i += 1) {
      var id = number(candidates[i], 0)
      if (id > 0) return id
    }
    return 0
  }

  function refreshDownloadedModDetails() {
    if (state.notificationModRequestBusy || !notificationPage()) return
    if (Date.now() - state.notificationLastModRequest < 5000) return
    var server = serverInfo()
    var roomId = currentRoomId()
    if (!server.apiBaseUrl || !roomId || typeof window.fetch !== 'function') return
    state.notificationModRequestBusy = true
    state.notificationLastModRequest = Date.now()
    var headers = { 'Accept': 'application/json', 'X-I18n-Lang': 'zh' }
    if (server.token) headers['X-DMP-TOKEN'] = server.token
    window.fetch(server.apiBaseUrl + '/v3/mod/downloaded?roomID=' + encodeURIComponent(roomId), {
      method: 'GET', headers: headers, cache: 'no-store'
    }).then(function (response) {
      return response && response.ok ? response.json() : null
    }).then(function (payload) {
      var root = parseApiData(payload)
      var rows = Array.isArray(root) ? root
        : Array.isArray(root.rows) ? root.rows
          : Array.isArray(root.items) ? root.items
            : Array.isArray(root.data) ? root.data : []
      var details = window.__dmpModDownloadedDetails
        = window.__dmpModDownloadedDetails || {}
      rows.forEach(function (item) {
        if (!item || typeof item !== 'object') return
        var id = number(item.id || item.modID || item.modId, 0)
        if (id > 0) details[String(id)] = item
      })
      state.notifications = collectModNotifications()
      renderSoon()
    }).catch(function () {}).then(function () {
      state.notificationModRequestBusy = false
    })
  }

  function refreshGameVersionNotification() {
    if (state.notificationRequestBusy || !notificationPage()) return
    if (Date.now() - state.notificationLastRequest < 5000) return
    var server = serverInfo()
    if (!server.apiBaseUrl || typeof window.fetch !== 'function') return
    state.notificationRequestBusy = true
    state.notificationLastRequest = Date.now()
    var headers = { 'X-I18n-Lang': 'zh' }
    if (server.token) headers['X-DMP-TOKEN'] = server.token
    window.fetch(server.apiBaseUrl + '/v3/platform/game_version', {
      method: 'GET', headers: headers
    }).then(function (response) {
      return response && response.ok ? response.json() : null
    }).then(function (payload) {
      var data = parseApiData(payload)
      var local = number(data.local != null ? data.local : data.localVersion, 0)
      var latest = number(data.server != null ? data.server
        : (data.latest != null ? data.latest : data.serverVersion), 0)
      state.notifications = collectModNotifications()
      if (latest > 0 && local > 0 && latest > local) {
        state.notifications.push({
          kind: 'game',
          title: '游戏版本可更新',
          detail: '新版' + latest + '，请及时更新',
          latestVersion: latest,
          localVersion: local,
          key: 'game|' + latest,
          token: String(latest) + '|' + String(local)
        })
      }
      renderSoon()
    }).catch(function () {
      state.notifications = collectModNotifications()
      renderSoon()
    }).then(function () { state.notificationRequestBusy = false })
  }

  function refreshNotifications() {
    if (!notificationPage()) {
      state.notifications = []
      return
    }
    /* Mod details arrive from the bridge's normal catalogue probes.  Render
       them immediately and let the version request append the game notice. */
    state.notifications = collectModNotifications()
    refreshDownloadedModDetails()
    refreshGameVersionNotification()
  }

  function notificationSummary() {
    loadNotificationAcknowledgements()
    var pending = state.notifications.filter(function (item) {
      return state.notificationAck[notificationKey(item)] !== item.token
    }).length
    return { total: state.notifications.length, pending: pending }
  }

  // Keep the native aggregate task centre in sync with this platform's
  // display-only notices.  The payload intentionally excludes URLs, tokens,
  // and acknowledgement state; the native card adds the server label while
  // rendering the aggregate list.
  function syncNativeNotifications() {
    if (!window.AndroidDmp || typeof window.AndroidDmp.syncPlatformNotifications !== 'function') return
    var items = (state.notifications || []).map(function (item) {
      return {
        kind: text(item && item.kind),
        title: text(item && item.title),
        detail: text(item && item.detail),
        key: text(item && item.key),
        token: text(item && item.token)
      }
    })
    var payload = ''
    try { payload = JSON.stringify(items) } catch (ignored) { return }
    if (payload === state.nativeNotificationSignature) return
    state.nativeNotificationSignature = payload
    try { window.AndroidDmp.syncPlatformNotifications(payload) } catch (ignored) {}
  }

  /*
   * A failed task remains failed in the server/store snapshot.  The toolbar
   * colour is a separate acknowledgement indicator: tapping this platform's
   * download entry acknowledges the current error, but does not rewrite the
   * task state.  Include the task's error/update token so a later retry (or a
   * new failure) lights the indicator again.
   */
  function acknowledgedErrorsStorageKey(server) {
    var identity = text(server && (server.id || server.host), 'current')
    return 'dmp-mobile-download-error-ack:' + identity
  }

  function loadAcknowledgedErrors() {
    var server = state.server
    if (!server) return
    var key = acknowledgedErrorsStorageKey(server)
    if (state.acknowledgedErrorsKey === key) return
    state.acknowledgedErrorsKey = key
    state.acknowledgedErrors = {}
    try {
      var raw = localStorage.getItem(key)
      var parsed = raw ? JSON.parse(raw) : {}
      if (parsed && typeof parsed === 'object') state.acknowledgedErrors = parsed
    } catch (ignored) {}
  }

  function saveAcknowledgedErrors() {
    if (!state.acknowledgedErrorsKey) return
    try {
      localStorage.setItem(state.acknowledgedErrorsKey,
        JSON.stringify(state.acknowledgedErrors || {}))
    } catch (ignored) {}
  }

  function errorToken(task) {
    if (!task || taskStatus(task) !== 'error') return ''
    return [
      taskStatus(task),
      text(first(task, ['error', 'message', 'detail'], '失败')),
      number(first(task, ['updatedAt', 'finishedAt', 'createdAt'], 0)),
      number(first(task, ['attempt', 'retryCount'], 0))
    ].join('|')
  }

  function hasUnacknowledgedError(task) {
    var id = taskId(task)
    var token = errorToken(task)
    return !!(id && token && state.acknowledgedErrors[id] !== token)
  }

  function acknowledgeErrors(tasks) {
    loadAcknowledgedErrors()
    var changed = false
    ;(tasks || []).forEach(function (task) {
      var id = taskId(task)
      var token = errorToken(task)
      if (!id || !token || state.acknowledgedErrors[id] === token) return
      state.acknowledgedErrors[id] = token
      changed = true
    })
    if (changed) saveAcknowledgedErrors()
    return changed
  }

  function clearErrorAcknowledgement(task) {
    var id = taskId(task)
    if (!id || !state.acknowledgedErrors[id]) return
    delete state.acknowledgedErrors[id]
    saveAcknowledgedErrors()
  }

  function taskStatus(task) {
    var value = lower(first(task, ['status', 'state', 'stage'], 'queued'))
    if (value === 'complete' || value === 'completed' || value === 'done') return 'success'
    if (value === 'failed' || value === 'failure') return 'error'
    if (value === 'canceled') return 'cancelled'
    if (value === 'pending') return 'queued'
    if (value === 'waiting') return 'waiting'
    if (value === 'transferring') return 'running'
    if (value === 'downloading' || value === 'updating') return 'running'
    return value || 'queued'
  }

  function terminal(task) {
    return /^(success|error|failed|cancelled|canceled|complete|completed|done)$/.test(taskStatus(task))
  }

  function successful(task) {
    return /^(success|complete|completed|done)$/.test(taskStatus(task))
  }

  function taskType(task) {
    var value = lower(first(task, ['type', 'taskType'], 'mod_download'))
    if (value === 'server_update' || value === 'update') return 'game_update'
    if (value === 'native_transfer') return 'transfer'
    return value || 'mod_download'
  }

  function taskId(task) {
    return text(first(task, ['id', 'taskID', 'serverTaskID'], ''))
  }

  /* Restored token-free snapshots from Android may contain only the canonical
     mod task id.  Keep the parser in one place so retry/detail actions work
     just like list de-duplication when roomID/modID fields are absent. */
  function modIdentity(task) {
    var room = number(first(task, ['roomID', 'roomId', 'room_id'], 0))
    var mod = number(first(task, ['modID', 'modId', 'mod_id'], 0))
    var canonical = /^mod:(.*):([0-9]+):([0-9]+)$/.exec(taskId(task))
    if (canonical) {
      if (!room) room = number(canonical[2], 0)
      if (!mod) mod = number(canonical[3], 0)
    }
    return { room: room, mod: mod }
  }

  function belongsToCurrentServer(task) {
    var server = serverInfo()
    var wantedId = lower(server.id)
    var wantedHost = lower(server.host)
    var taskId = lower(first(task, ['serverId', 'serverID', 'server_id'], ''))
    var taskHost = lower(first(task, ['serverHost', 'host', 'ip'], ''))
    if (!wantedId && !wantedHost) return true
    if (taskId && wantedId && taskId === wantedId) return true
    if (taskHost && wantedHost && taskHost === wantedHost) return true
    /* A few pre-3.2 snapshots had no server id. Keep them visible only when
       their host matches; an unscoped row must never leak into another host. */
    return !taskId && !taskHost && !wantedId && !wantedHost
  }

  function getStore() {
    var store = window.__dmpDownloadStore
    if (!store || typeof store !== 'object') return null
    if (state.store !== store) {
      state.store = store
      state.subscribedStore = null
    }
    if (state.subscribedStore !== store && typeof store.subscribe === 'function') {
      state.subscribedStore = store
      try {
        store.subscribe(function () {
          renderSoon()
        })
      } catch (ignored) {}
    }
    return store
  }

  // The 3.2 API has no generic task endpoint. The bridge therefore observes
  // the server's `updating` state and hands it to this small adapter. Keep the
  // task in the same token-free store as mod downloads, so the current-server
  // panel and Android's all-platform task view receive the identical state.
  window.__dmpSyncGameUpdateTask = function (updating, localVersion, latestVersion, meta) {
    var store = getStore()
    var server = serverInfo()
    if (!store || typeof store.upsertTask !== 'function') return false
    meta = meta || {}
    var id = 'game_update:' + text(server.id || server.host || 'current')
    var existing = null
    rawTasks().some(function (task) {
      if (taskType(task) === 'game_update' && taskId(task) === id) {
        existing = task
        return true
      }
      return false
    })
    // Do not create a ghost task during the one entry probe when no update is
    // present. A live task can originate from an in-page POST or a server that
    // was already updating when the platform opened.
    if (!existing && !updating && !meta.started) return false

    var complete = meta.completed === true && !updating
    var failed = !!meta.error && !updating && meta.started && !complete
    store.upsertTask({
      id: id,
      taskID: id,
      serverId: server.id || server.host || 'current',
      serverName: server.name,
      serverHost: server.host,
      type: 'game_update',
      name: '服务器更新',
      status: updating ? 'running' : complete ? 'success' : failed ? 'error'
        : existing ? taskStatus(existing) : 'queued',
      stage: updating ? 'updating' : complete ? 'completed' : failed ? 'failed'
        : existing ? first(existing, ['stage'], 'waiting') : 'waiting',
      progress: complete ? 100 : number(first(existing, ['progress'], 0)),
      progressKnown: complete,
      serverTask: true,
      canPause: false,
      serverUpdateObserved: updating || meta.observedRunning === true,
      serverLastUpdating: !!updating,
      versionAtRequest: number(meta.initialLocal || localVersion),
      localVersion: number(localVersion),
      latestVersion: number(latestVersion),
      error: failed ? text(meta.error) : '',
      createdAt: number(first(existing || {}, ['createdAt'], Date.now())),
      updatedAt: Date.now(),
      finishedAt: complete ? number(meta.finishedAt, Date.now()) : 0
    })
    return true
  }

  function rawTasks() {
    var store = getStore()
    if (!store) return []
    try {
      if (Array.isArray(store.tasks)) return store.tasks.slice()
      if (typeof store.snapshot === 'function') {
        var snapshot = store.snapshot()
        return Array.isArray(snapshot) ? snapshot : []
      }
    } catch (ignored) {}
    return []
  }

  function currentTasks() {
    var tasks = rawTasks().filter(function (task) {
      return task && belongsToCurrentServer(task)
    })
    var deduplicated = {}
    tasks.forEach(function (task) {
      var type = taskType(task)
      var key
      if (type === 'game_update') {
        key = 'game|' + lower(first(task, ['serverId', 'serverHost'], serverInfo().id || serverInfo().host))
      } else if (type === 'mod_download') {
        /* The bridge deliberately keeps the task snapshot token-free and
           older snapshots therefore expose only the canonical id
           `mod:<server>:<room>:<workshopId>`, without roomID/modID fields.
           Falling back to numeric fields alone collapsed every such row into
           one `mod|server|0|0` entry, so the panel appeared to contain only
           one or two tasks and deleting the visible row revealed another
           queued row underneath.  Recover the identity from the canonical
           id before deduplicating aliases. */
        var canonical = /^mod:(.*):([0-9]+):([0-9]+)$/.exec(taskId(task))
        var roomIdentity = number(first(task, ['roomID', 'roomId', 'room_id'], 0))
        var modIdentity = number(first(task, ['modID', 'modId', 'mod_id'], 0))
        if (canonical) {
          if (!roomIdentity) roomIdentity = number(canonical[2], 0)
          if (!modIdentity) modIdentity = number(canonical[3], 0)
        }
        if (!modIdentity) modIdentity = taskId(task) || 'unknown'
        key = 'mod|' + lower(first(task, ['serverId', 'serverHost'], serverInfo().id || serverInfo().host))
          + '|' + roomIdentity
          + '|' + modIdentity
      } else {
        key = type + '|' + taskId(task)
      }
      var previous = deduplicated[key]
      if (!previous) {
        deduplicated[key] = task
        return
      }
      var previousTerminal = terminal(previous)
      var currentTerminal = terminal(task)
      /* A live task must not be hidden by an older completed snapshot for the
         same room/mod.  This is common when the user deliberately downloads a
         completed mod again. Prefer the active state; otherwise use the most
         recently updated row of the same state class. */
      if (!currentTerminal && previousTerminal
        || (currentTerminal === previousTerminal
          && number(task.updatedAt || task.createdAt) >= number(previous.updatedAt || previous.createdAt))
        || (currentTerminal && !previousTerminal
          && number(task.updatedAt || task.createdAt) >= number(previous.updatedAt || previous.createdAt))) {
        deduplicated[key] = task
      }
    })
    return Object.keys(deduplicated).map(function (key) { return deduplicated[key] })
      .sort(function (left, right) {
        return number(right.updatedAt || right.createdAt) - number(left.updatedAt || left.createdAt)
      })
  }

  function formatBytes(value) {
    var bytes = Math.max(0, number(value))
    if (bytes < 1024) return bytes.toFixed(0) + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
  }

  function taskTitle(task) {
    var type = taskType(task)
    if (type === 'game_update') return '服务器后台更新'
    if (type === 'transfer') return text(task.name, '文件')
    return text(task.name, '下载模组')
  }

  function taskDetail(task) {
    var type = taskType(task)
    var server = text(first(task, ['serverName', 'serverHost'], serverInfo().name), serverInfo().name)
    if (type !== 'mod_download') return '目标服务器：' + server
    var room = text(first(task, ['roomName', 'room_name'], ''))
    if (!room) {
      var identity = modIdentity(task)
      room = '#' + text(identity.room || '—', '—')
    }
    return '目标服务器：' + server + ' · 房间' + room
  }

  function taskState(task) {
    var status = taskStatus(task)
    var type = taskType(task)
    if (status === 'success') return type === 'transfer' ? '传输完成' : type === 'game_update' ? '后台更新完成' : '下载完成'
    if (status === 'error') return type === 'transfer' ? '传输失败' : type === 'game_update' ? '后台更新失败' : '下载失败'
    if (status === 'cancelled') return '已取消'
    // Pause/continue is intentionally not exposed by the Android queue.  A
    // stale snapshot from an older build may still carry `paused`; render it
    // as an ordinary in-progress row instead of advertising a control that
    // no longer exists.
    if (status === 'paused') return type === 'transfer' ? '传输中' : '下载中'
    if (status === 'queued' || status === 'waiting') return '等待中'
    if (type === 'transfer') return '传输中'
    if (type === 'game_update') return '后台更新中'
    return '下载中'
  }

  function progressFor(task) {
    var percent = number(first(task, ['progress', 'percent', 'percentage', 'progressPercent'], 0))
    var total = number(first(task, ['totalBytes', 'bytesTotal', 'size'], 0))
    var done = number(first(task, ['completedBytes', 'downloadedBytes', 'bytesDownloaded'], 0))
    var known = task.progressKnown === true || percent > 0 || total > 0 && done > 0 || terminal(task)
    if (total > 0 && done > 0 && percent <= 0) percent = done * 100 / total
    if (successful(task)) percent = 100
    return {
      known: known,
      percent: Math.max(0, Math.min(100, percent)),
      total: total,
      done: done
    }
  }

  function isUploadTask(task) {
    if (!task || taskType(task) !== 'transfer') return false
    if (task.upload === true || task.isUpload === true) return true
    var direction = lower(first(task,
      ['direction', 'transferDirection', 'operation', 'transferType'], ''))
    return direction === 'upload' || direction === 'up'
      || direction.indexOf('upload') >= 0
  }

  function taskByteLine(task, progress) {
    var status = taskStatus(task)
    var upload = isUploadTask(task)
    var prefix = upload ? '已上传' : '已下载'
    if (successful(task)) {
      return progress.total > 0 ? '总大小 ' + formatBytes(progress.total)
        : progress.done > 0 ? '总大小 ' + formatBytes(progress.done) : '已完成'
    }
    if (status === 'error') {
      if (progress.total > 0) {
        var failedDone = progress.done > 0
          ? progress.done : Math.round(progress.total * progress.percent / 100)
        return '失败 · ' + prefix + ' ' + formatBytes(failedDone)
          + ' / ' + formatBytes(progress.total)
      }
      return '失败 · ' + progress.percent.toFixed(1) + '%'
    }
    if (progress.total > 0) {
      var done = progress.done > 0
        ? progress.done : Math.round(progress.total * progress.percent / 100)
      return prefix + ' ' + formatBytes(done) + ' / ' + formatBytes(progress.total)
    }
    // Some DMP versions expose only a percentage.  Keep a static numeric
    // fallback instead of an animated/indeterminate treatment.
    return '进度 ' + progress.percent.toFixed(1) + '%'
  }

  function setFeedback(message) {
    if (!state.feedback) return
    window.clearTimeout(state.feedback.__mobileTimer)
    window.clearTimeout(state.feedback.__mobileFadeTimer)
    state.feedback.classList.remove('fading')
    state.feedback.textContent = message || ''
    state.feedback.classList.toggle('visible', !!message)
    if (message) {
      state.feedback.__mobileTimer = window.setTimeout(function () {
        if (!state.feedback) return
        state.feedback.classList.add('fading')
        state.feedback.__mobileFadeTimer = window.setTimeout(function () {
          if (!state.feedback) return
          state.feedback.classList.remove('visible', 'fading')
          state.feedback.textContent = ''
        }, 260)
      }, 3000)
    }
  }

  function storeAction(task, action) {
    var store = getStore()
    var id = taskId(task)
    if (!store || !id) return false
    try {
      if (action === 'delete' && typeof store.removeTask === 'function') return store.removeTask(id) !== false
      if (action === 'delete' && typeof store.deleteTask === 'function') return store.deleteTask(id) !== false
    } catch (ignored) {}
    return false
  }

  function nativeAction(task, action) {
    var id = taskId(task)
    if (!id || !window.AndroidDmp) return false
    try {
      if (taskType(task) === 'transfer' && typeof window.AndroidDmp.nativeTransferAction === 'function') {
        return window.AndroidDmp.nativeTransferAction(id, action) !== false
      }
      if (typeof window.AndroidDmp.webTaskAction === 'function' && action === 'delete') {
        return window.AndroidDmp.webTaskAction(id, action) !== false
      }
    } catch (ignored) {}
    return false
  }

  function retryMod(task) {
    var server = serverInfo()
    var identity = modIdentity(task)
    var roomId = identity.room
    var modId = identity.mod
    if (!server.apiBaseUrl || !roomId || !modId || typeof window.fetch !== 'function') {
      return Promise.resolve(false)
    }
    // A retry is an explicit new download intent.  Clear the local/native
    // tombstone before submitting it; otherwise the bridge correctly drops
    // the request as a stale response to the task the user previously
    // deleted.
    try {
      if (typeof window.__dmpClearModTaskCancelled === 'function') {
        window.__dmpClearModTaskCancelled(taskId(task))
      }
    } catch (ignored) {}
    var payload = {
      roomID: roomId,
      id: modId,
      name: text(task.name),
      size: text(first(task, ['totalBytes', 'size'], '')),
      file_url: text(first(task, ['file_url', 'fileUrl', 'url'], '')),
      update: task.update === true
    }
    /* A retry is an explicit fresh download intent.  Clear the local/native
       tombstone before sending it so the new worker status is allowed back
       into both the platform and aggregate task centres. */
    try {
      if (typeof window.__dmpClearModTaskCancelled === 'function') {
        window.__dmpClearModTaskCancelled(taskId(task))
      }
    } catch (ignored) {}
    var headers = { 'Content-Type': 'application/json', 'X-I18n-Lang': 'zh' }
    if (server.token) headers['X-DMP-TOKEN'] = server.token
    return window.fetch(server.apiBaseUrl + '/v3/mod/download', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload)
    }).then(function (response) {
      if (!response || !response.ok) throw new Error('request')
      return response.json().catch(function () { return {} })
    }).then(function () {
      var store = getStore()
      if (store && typeof store.retryTask === 'function') {
        // The POST above already started (or queued) the server worker. Let
        // the restored queue observe it without sending a duplicate request.
        store.retryTask(taskId(task), true)
      } else if (store && typeof store.upsertTask === 'function') {
        store.upsertTask({
          id: taskId(task),
          serverId: first(task, ['serverId'], server.id),
          serverName: first(task, ['serverName'], server.name),
          type: 'mod_download',
          roomID: roomId,
          roomName: first(task, ['roomName'], ''),
          modID: modId,
          name: payload.name,
          totalBytes: number(payload.size),
          status: 'queued',
          stage: 'queued',
          progress: 0,
          progressKnown: false,
          updatedAt: Date.now()
        })
      }
      return true
    }).catch(function () {
      // The retry's POST can be rejected after the bridge has optimistically
      // observed it. Restore the original terminal row so the user retains
      // both the failure reason and a usable retry/delete control.
      var store = getStore()
      if (store && typeof store.upsertTask === 'function') {
        store.upsertTask({
          id: taskId(task),
          serverId: first(task, ['serverId'], server.id),
          serverName: first(task, ['serverName'], server.name),
          type: 'mod_download',
          roomID: roomId,
          roomName: first(task, ['roomName'], ''),
          modID: modId,
          name: text(task.name),
          totalBytes: number(first(task, ['totalBytes', 'size'], 0)),
          status: 'error',
          stage: 'failed',
          progress: number(first(task, ['progress'], 0)),
          progressKnown: task.progressKnown === true,
          error: '重试发送失败',
          updatedAt: Date.now()
        })
      }
      return false
    })
  }

  function performAction(task, action) {
    var id = taskId(task)
    if (!id || (action !== 'retry' && action !== 'delete' && action !== 'dismiss')) return
    var pendingKey = id
    if (state.pending[pendingKey]) return
    state.pending[pendingKey] = true
    // A retry/delete acknowledges the old failure immediately. If a retry
    // fails again, the bridge writes a new updatedAt/error token and the red
    // indicator is allowed to return for that new failure.
    acknowledgeErrors([task])
    setFeedback('正在向平台发送' + (action === 'retry' ? '重下'
      : action === 'dismiss' ? '删除已完成' : '删除') + '任务......')
    renderSoon()

    function finish(success) {
      window.setTimeout(function () {
        delete state.pending[pendingKey]
        setFeedback(success ? '任务执行成功' : '任务执行失败')
        renderSoon()
      }, 120)
    }

    if (action === 'retry') {
      if (taskType(task) === 'transfer') {
        finish(nativeAction(task, 'retry'))
      } else if (taskType(task) === 'mod_download') {
        retryMod(task).then(finish)
      } else {
        // DMP 3.2 has no safe client-side retry endpoint for a server update.
        finish(false)
      }
      return
    }

    if (action === 'delete' || action === 'dismiss') {
      if (action === 'delete' && taskType(task) === 'mod_download') {
        try {
          if (typeof window.__dmpMarkModTaskCancelled === 'function') {
            window.__dmpMarkModTaskCancelled(id)
          }
        } catch (ignored) {}
      }
      var nativeAccepted = nativeAction(task, action)
      var storeAccepted = storeAction(task, 'delete')
      finish(nativeAccepted || storeAccepted)
    }
  }

  // The panel header exposes a short-press history cleanup only.  It removes
  // completed rows from the Android/WebView task history, but never touches
  // active, queued, or failed work and never deletes an exported backup file.
  // Keeping this separate from performAction avoids starting one independent
  // feedback timer per row when several completed records are cleared at once.
  function clearCompletedTasks() {
    var completed = currentTasks().filter(function (task) { return successful(task) })
    if (!completed.length) {
      setFeedback('没有可清除的已完成任务')
      return
    }
    setFeedback('正在向平台发送删除已完成任务......')
    var removed = 0
    completed.forEach(function (task) {
      var operation = taskType(task) === 'transfer' ? 'dismiss' : 'delete'
      acknowledgeErrors([task])
      if (operation === 'delete' && taskType(task) === 'mod_download') {
        try {
          if (typeof window.__dmpMarkModTaskCancelled === 'function') {
            window.__dmpMarkModTaskCancelled(taskId(task))
          }
        } catch (ignored) {}
      }
      var nativeAccepted = nativeAction(task, operation)
      var storeAccepted = storeAction(task, 'delete')
      if (nativeAccepted || storeAccepted) removed += 1
    })
    window.setTimeout(function () {
      setFeedback(removed > 0 ? '任务执行成功' : '任务执行失败')
      renderSoon()
    }, 120)
  }

  /* Long-pressing the panel trash icon is the explicit all-task operation.
     A short tap keeps the original, safer history-only cleanup.  The bridge
     has no LinuxDMP cancellation endpoint, so deleting an active mod task
     records the local tombstone and removes its Android/WebView row; it does
     not pretend to stop the server-side SteamCMD worker. */
  function clearAllTasks() {
    var tasks = currentTasks()
    if (!tasks.length) {
      setFeedback('没有可删除的任务')
      return
    }
    setFeedback('正在向平台发送全部删除任务......')
    var removed = 0
    tasks.forEach(function (task) {
      var type = taskType(task)
      var id = taskId(task)
      if (!id) return
      if (type === 'mod_download') {
        try {
          if (typeof window.__dmpMarkModTaskCancelled === 'function') {
            window.__dmpMarkModTaskCancelled(id)
          }
        } catch (ignored) {}
      }
      var operation = successful(task) && type === 'transfer' ? 'dismiss' : 'delete'
      var nativeAccepted = nativeAction(task, operation)
      var storeAccepted = storeAction(task, 'delete')
      if (nativeAccepted || storeAccepted) removed += 1
    })
    window.setTimeout(function () {
      setFeedback(removed > 0 ? '任务执行成功' : '任务执行失败')
      renderSoon()
    }, 120)
  }

  function installClearButtonPress(button) {
    if (!button || button.__androidClearPressInstalled) return
    button.__androidClearPressInstalled = true
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
        try {
          confirmed = window.confirm('是否删除全部下载任务？')
        } catch (ignored) {}
        if (confirmed) clearAllTasks()
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
      if (longPressed) {
        longPressed = false
        event.preventDefault()
        event.stopPropagation()
        return
      }
      event.preventDefault()
      event.stopPropagation()
      clearCompletedTasks()
    })
  }

  function button(icon, label, handler) {
    var element = document.createElement('button')
    element.type = 'button'
    element.className = 'android-dmp-mobile-download-action'
    element.setAttribute('aria-label', label)
    element.setAttribute('title', label)
    element.innerHTML = '<i class="' + icon + '"></i>'
    element.addEventListener('click', function (event) {
      event.preventDefault()
      event.stopPropagation()
      handler()
    })
    return element
  }

  function taskRow(task) {
    var row = document.createElement('div')
    var id = taskId(task)
    var type = taskType(task)
    var progress = progressFor(task)
    var isTerminal = terminal(task)
    var status = taskStatus(task)
    row.className = 'android-dmp-mobile-download-row'
    if (state.pending[id]) row.className += ' action-pending'
    if (status === 'error') row.className += ' task-failed'
    row.dataset.taskId = id

    var copy = document.createElement('div')
    copy.className = 'android-dmp-mobile-download-copy'
    var title = document.createElement('div')
    title.className = 'android-dmp-mobile-download-title'
    title.textContent = taskTitle(task)
    // Keep the server/room context available to accessibility users without
    // adding a fourth visual line to the compact three-line task card.
    title.setAttribute('title', taskDetail(task))
    var bytes = document.createElement('div')
    bytes.className = 'android-dmp-mobile-download-bytes'
    bytes.textContent = taskByteLine(task, progress)
    copy.appendChild(title)
    copy.appendChild(bytes)

    var controls = document.createElement('div')
    controls.className = 'android-dmp-mobile-download-controls'
    // The mobile panel intentionally has no pause/continue action.  Retry is
    // offered only for completed or failed records, matching the confirmed
    // Android workflow; a cancelled row remains history until it is deleted.
    if ((successful(task) || status === 'error')
      && (type === 'transfer' || type === 'mod_download')) {
      controls.appendChild(button('ri-refresh-line', '重下', function () { performAction(task, 'retry') }))
    }
    // A single-item trash action is always available when the record has an
    // id. For active work this removes the local record/tombstone; it does not
    // claim to stop a server worker when the DMP API has no cancel endpoint.
    if (id && (type === 'game_update' || type === 'mod_download' || type === 'transfer')) {
      var removalAction = successful(task) && type === 'transfer' ? 'dismiss' : 'delete'
      controls.appendChild(button('ri-delete-bin-line',
        removalAction === 'dismiss' ? '删除已完成任务' : '删除任务',
        function () { performAction(task, removalAction) }))
    }

    row.appendChild(copy)
    row.appendChild(controls)
    // Completed records show only the total-size line. Every other state has
    // a static bar; unknown percentages intentionally fall back to 0% rather
    // than using an animated indeterminate treatment.
    if (!successful(task)) {
      var bar = document.createElement('div')
      bar.className = 'android-dmp-mobile-download-progress'
      if (status === 'error') bar.className += ' failed'
      else if (isUploadTask(task)) bar.className += ' upload'
      var fill = document.createElement('i')
      fill.style.width = (progress.known ? progress.percent : 0) + '%'
      bar.appendChild(fill)
      row.appendChild(bar)
    }
    return row
  }

  function notificationRow(item) {
    var row = document.createElement('button')
    row.type = 'button'
    row.className = 'android-dmp-mobile-notification-row'
    row.setAttribute('aria-label', item.title + '：' + item.detail)
    var heading = document.createElement('strong')
    heading.textContent = item.title
    var detail = document.createElement('span')
    detail.textContent = item.detail
    row.appendChild(heading)
    row.appendChild(detail)
    row.addEventListener('click', function (event) {
      event.preventDefault()
      event.stopPropagation()
      if (item.kind === 'mod') {
        window.location.hash = '#/game/mod'
        window.setTimeout(function () {
          var buttons = document.querySelectorAll('button,[role="tab"],[role="button"]')
          for (var i = 0; i < buttons.length; i += 1) {
            if (/添加模组|模组添加|add\s*mod/i.test(text(buttons[i].textContent || buttons[i].getAttribute('aria-label')))) {
              try { buttons[i].click() } catch (ignored) {}
              break
            }
          }
        }, 450)
      } else if (item.kind === 'game') {
        window.location.hash = '#/install'
        window.setTimeout(function () {
          var tabs = document.querySelectorAll('.android-install-tab,[role="tab"]')
          for (var j = 0; j < tabs.length; j += 1) {
            if (/游戏更新|update/i.test(text(tabs[j].textContent || ''))) {
              try { tabs[j].click() } catch (ignored) {}
              break
            }
          }
        }, 450)
      }
      setOpen(false)
    })
    return row
  }

  function updateTriggerIndicator(tasks) {
    if (!state.button) return
    loadAcknowledgedErrors()
    var activeCount = (tasks || []).filter(function (task) {
      return !terminal(task)
    }).length
    var failedCount = (tasks || []).filter(hasUnacknowledgedError).length
    refreshNotifications()
    syncNativeNotifications()
    var notificationState = notificationSummary()
    state.button.classList.toggle('has-active', activeCount > 0)
    state.button.classList.toggle('has-error', failedCount > 0)
    /* Download status has priority over notifications.  A yellow bell is
       independent, while the download icon keeps its existing green/red
       semantics when both kinds of state are present. */
    state.button.setAttribute('data-error-count', String(failedCount))
    if (failedCount > 0) {
      state.button.setAttribute('aria-label', '下载任务，有失败任务')
    } else {
      state.button.setAttribute('aria-label', '下载任务')
    }
    if (state.notificationButton) {
      state.notificationRoot.style.display = notificationPage() ? '' : 'none'
      state.notificationButton.classList.toggle('has-notification', notificationState.pending > 0)
      state.notificationButton.setAttribute('data-notification-count', String(notificationState.pending))
      state.notificationButton.setAttribute('aria-label', notificationState.pending
        ? '平台通知，有更新' : '平台通知')
      if (state.notificationBadge) {
        state.notificationBadge.textContent = notificationState.pending > 99
          ? '99+' : notificationState.pending ? String(notificationState.pending) : ''
        state.notificationBadge.classList.toggle('visible', notificationState.pending > 0)
      }
    }
  }

  function renderList() {
    if (!state.list) return
    var tasks = currentTasks()
    var activeCount = tasks.filter(function (task) { return !terminal(task) }).length
    updateTriggerIndicator(tasks)
    if (state.badge) {
      state.badge.textContent = activeCount > 99 ? '99+' : activeCount ? String(activeCount) : ''
      state.badge.classList.toggle('visible', activeCount > 0)
    }

    if (!state.open) return
    if (state.mode === 'notifications') {
      var notificationItems = state.notifications.slice()
      var notificationSignature = notificationItems.map(function (item) {
        return [notificationKey(item), item.token, item.title, item.detail].join('|')
      }).join('||')
      if (notificationSignature === state.notificationSignature
          && state.list.childNodes.length) return
      state.notificationSignature = notificationSignature
      state.list.innerHTML = ''
      if (!notificationItems.length) {
        var none = document.createElement('div')
        none.className = 'android-dmp-mobile-download-empty'
        none.textContent = '暂无平台通知'
        state.list.appendChild(none)
      } else {
        notificationItems.forEach(function (item) { state.list.appendChild(notificationRow(item)) })
      }
      return
    }
    // The toolbar watchdog runs twice per second because Vue may replace the
    // navbar after a route change. Do not rebuild the open task list unless
    // task content actually changed: rebuilding resets scroll position and
    // can interrupt a tap on a task action icon.
    var signature = tasks.map(function (task) {
      var id = taskId(task)
      return [id, taskStatus(task), taskType(task), first(task, ['progress', 'percent'], 0),
        first(task, ['completedBytes', 'downloadedBytes'], 0), first(task, ['totalBytes', 'size'], 0),
        text(task.error), text(task.message), state.pending[id] ? 'pending' : ''].join('|')
    }).join('||')
    if (signature === state.renderSignature && state.list.childNodes.length) return
    state.renderSignature = signature
    var previousScrollTop = state.list.scrollTop
    state.list.innerHTML = ''
    if (!tasks.length) {
      var empty = document.createElement('div')
      empty.className = 'android-dmp-mobile-download-empty'
      empty.textContent = '无下载任务'
      state.list.appendChild(empty)
      return
    }
    tasks.forEach(function (task) { state.list.appendChild(taskRow(task)) })
    state.list.scrollTop = previousScrollTop
  }

  function positionPanel() {
    var notificationMode = state.mode === 'notifications'
    var anchor = notificationMode ? state.notificationButton : state.button
    var activePanel = notificationMode ? state.notificationPanel : state.panel
    if (!anchor || !activePanel || !state.open) return
    var rect = anchor.getBoundingClientRect()
    var viewportWidth = Math.max(220, Number(window.innerWidth) || 320)
    var viewportHeight = Math.max(220, Number(window.innerHeight) || 480)
    var width = Math.min(Math.max(288, Math.floor(viewportWidth * 0.88)), 440)
    // Keep a usable lower bound on normal phones, but never let the card run
    // past a very narrow split-screen/landscape viewport.
    if (width > viewportWidth - 16) width = Math.max(220, viewportWidth - 16)
    var left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width))
    activePanel.style.width = width + 'px'
    activePanel.style.left = left + 'px'
    activePanel.style.top = Math.max(8, rect.bottom + 8) + 'px'
    var available = Math.max(160, viewportHeight - rect.bottom - 18)
    var tasks = currentTasks()
    var visibleCount = state.mode === 'notifications' ? state.notifications.length : tasks.length
    var rowHeight = 84
    // Keep a permanent feedback slot.  The text fades out, but removing the
    // element's layout height made the card visibly jump every three seconds.
    var feedbackHeight = state.feedback ? 42 : 0
    var desired = visibleCount
      ? 56 + Math.max(96, Math.min(visibleCount * rowHeight, Math.max(96, available - 56 - feedbackHeight))) + feedbackHeight
      : 56 + 156 + feedbackHeight
    var panelHeight = Math.min(available, Math.max(160, desired))
    activePanel.style.minWidth = Math.min(280, Math.max(220, viewportWidth - 16)) + 'px'
    activePanel.style.minHeight = Math.min(160, available) + 'px'
    activePanel.style.maxHeight = panelHeight + 'px'
    if (state.list) {
      var listHeight = Math.max(96, panelHeight - 60 - feedbackHeight)
      state.list.style.minHeight = Math.min(96, listHeight) + 'px'
      state.list.style.maxHeight = listHeight + 'px'
    }
  }

  function setOpen(open) {
    state.open = !!open
    if (!state.panel || !state.notificationPanel || !state.button
        || !state.notificationButton) return
    var notifications = state.mode === 'notifications'
    state.panel.classList.toggle('open', state.open && !notifications)
    state.notificationPanel.classList.toggle('open', state.open && notifications)
    state.button.classList.toggle('open', state.open && !notifications)
    state.button.setAttribute('aria-expanded', state.open ? 'true' : 'false')
    if (state.notificationButton) {
      state.notificationButton.classList.toggle('open', state.open && state.mode === 'notifications')
      state.notificationButton.setAttribute('aria-expanded', state.open && state.mode === 'notifications' ? 'true' : 'false')
    }
    if (state.open) {
      renderList()
      positionPanel()
    } else {
      // Refresh the trigger colour immediately when a tap closes the panel;
      // the half-second toolbar watchdog should not leave an old red state.
      renderList()
    }
  }

  // Expose a narrow hook for the all-platform native entry.  The Java task
  // centre may use the same acknowledgement semantics without touching this
  // panel's DOM or task status.
  window.__dmpAcknowledgeMobileDownloadErrors = function () {
    var changed = acknowledgeErrors(currentTasks())
    if (changed) renderSoon()
    return changed
  }

  function findToolbar() {
    var navbar = document.querySelector('.layout-navbar .navbar-content-container')
    if (!navbar) return null
    return navbar.querySelector('.d-flex.h-100.align-center') || navbar.firstElementChild || navbar
  }

  function attached(element) {
    return !!(element && document.documentElement && document.documentElement.contains(element))
  }

  function toolbarRightAnchor(toolbar) {
    if (!toolbar) return null
    // Match the desktop-master right-side controls first.  The download
    // trigger belongs with those controls, not immediately after the menu
    // button where it competed with the Android room picker.
    var icons = toolbar.querySelectorAll(
      'i.ri-sun-line,i.ri-moon-line,i.ri-refresh-line,' +
      'i.ri-github-line,i.ri-file-text-line,i.ri-arrow-go-forward-line,' +
      'i[class*="refresh"]')
    for (var index = 0; index < icons.length; index++) {
      var candidate = closest(icons[index], 'button,[role=button]')
      if (candidate && candidate.parentNode === toolbar) return candidate
    }
    // If a hashed icon build is in use, use the first non-menu control on the
    // toolbar.  This preserves the menu -> room name -> spacer -> download
    // ordering without relying on a translated label.
    var buttons = toolbar.querySelectorAll('button,[role=button]')
    for (var buttonIndex = 0; buttonIndex < buttons.length; buttonIndex++) {
      var button = buttons[buttonIndex]
      if (button.parentNode !== toolbar) continue
      if (button.querySelector('i.ri-menu-line')) continue
      if (button.classList.contains('chip-select__activator')) continue
      return button
    }
    return null
  }

  function placeTrigger(toolbar, root) {
    if (!toolbar || !root) return
    var anchor = toolbarRightAnchor(toolbar)
    if (anchor && anchor !== root) toolbar.insertBefore(root, anchor)
    else if (root.parentNode !== toolbar) toolbar.appendChild(root)
  }

  function placeNotificationTrigger(toolbar, root) {
    if (!toolbar || !root) return
    if (state.root && state.root.parentNode === toolbar) {
      toolbar.insertBefore(root, state.root)
      return
    }
    var anchor = toolbar.querySelector('button,[role=button]')
    if (anchor && anchor.parentNode === toolbar) toolbar.insertBefore(root, anchor)
    else toolbar.appendChild(root)
  }

  function setPanelMode(mode) {
    state.mode = mode === 'notifications' ? 'notifications' : 'tasks'
    state.list = state.mode === 'notifications' ? state.notificationList : state.taskList
    Array.prototype.forEach.call(state.tabs || [], function (tab) {
      tab.classList.toggle('active', tab.getAttribute('data-mode') === state.mode)
    })
    if (state.notificationButton) {
      state.notificationButton.classList.toggle('open', state.open && state.mode === 'notifications')
    }
    if (state.clear) state.clear.style.visibility = state.mode === 'tasks' ? 'visible' : 'hidden'
    if (state.open) renderList()
  }

  function mount() {
    var toolbar = findToolbar()
    if (!toolbar || !document.body) return false
    if (attached(state.root) && attached(state.panel) && attached(state.notificationPanel)) {
      // Vue replaces the navbar on navigation.  Reattach the trigger to the
      // new toolbar instead of leaving it beside the old menu button.
      placeTrigger(toolbar, state.root)
      placeNotificationTrigger(toolbar, state.notificationRoot)
      return true
    }

    var existingRoot = document.getElementById(ROOT_ID)
    var existingPanel = document.getElementById(PANEL_ID)
    var existingNotificationPanel = document.getElementById(PANEL_ID + '-notifications')
    if (existingRoot) existingRoot.remove()
    if (existingPanel) existingPanel.remove()
    if (existingNotificationPanel) existingNotificationPanel.remove()

    var root = document.createElement('span')
    root.id = ROOT_ID
    root.className = 'android-dmp-mobile-download-anchor'
    var trigger = document.createElement('button')
    trigger.type = 'button'
    trigger.className = 'android-dmp-mobile-download-trigger'
    trigger.setAttribute('aria-label', '下载任务')
    trigger.setAttribute('title', '下载任务')
    trigger.setAttribute('aria-expanded', 'false')
    trigger.innerHTML = '<i class="ri-download-2-line"></i>'
    var badge = document.createElement('b')
    badge.className = 'android-dmp-mobile-download-badge'
    trigger.appendChild(badge)
    root.appendChild(trigger)

    placeTrigger(toolbar, root)

    var notificationRoot = document.createElement('span')
    notificationRoot.id = 'android-dmp-mobile-notification-anchor'
    notificationRoot.className = 'android-dmp-mobile-notification-anchor'
    var notificationButton = document.createElement('button')
    notificationButton.type = 'button'
    notificationButton.className = 'android-dmp-mobile-notification-trigger'
    notificationButton.setAttribute('aria-label', '平台通知')
    notificationButton.setAttribute('title', '平台通知')
    notificationButton.setAttribute('aria-expanded', 'false')
    notificationButton.innerHTML = '<i class="ri-notification-3-line"></i>'
    var notificationBadge = document.createElement('b')
    notificationBadge.className = 'android-dmp-mobile-notification-badge'
    notificationButton.appendChild(notificationBadge)
    notificationRoot.appendChild(notificationButton)
    placeNotificationTrigger(toolbar, notificationRoot)

    var panel = document.createElement('section')
    panel.id = PANEL_ID
    panel.className = 'android-dmp-mobile-download-panel'
    panel.setAttribute('aria-label', '下载任务')
    panel.innerHTML = '<div class="android-dmp-mobile-download-header">'
      + '<div><strong>下载管理</strong><span>当前平台任务</span></div>'
      + '<button type="button" class="android-dmp-mobile-download-clear"'
      + ' aria-label="清除已完成下载" title="清除已完成下载">'
      + '<i class="ri-delete-bin-line"></i></button></div>'
      + '<div class="android-dmp-mobile-download-list"></div>'
      + '<div class="android-dmp-mobile-download-feedback"></div>'
    document.body.appendChild(panel)

    var notificationPanel = document.createElement('section')
    notificationPanel.id = PANEL_ID + '-notifications'
    notificationPanel.className = 'android-dmp-mobile-download-panel'
    notificationPanel.setAttribute('aria-label', '平台通知')
    notificationPanel.innerHTML = '<div class="android-dmp-mobile-download-header">'
      + '<div><strong>平台通知</strong><span>当前平台更新提醒</span></div></div>'
      + '<div class="android-dmp-mobile-download-list"></div>'
      + '<div class="android-dmp-mobile-download-feedback"></div>'
    document.body.appendChild(notificationPanel)

    trigger.addEventListener('click', function (event) {
      event.preventDefault()
      event.stopPropagation()
      // A tap acknowledges only this platform's failures. The task rows and
      // their red failure state remain intact for inspection and retry.
      acknowledgeErrors(currentTasks())
      var wasTasks = state.open && state.mode === 'tasks'
      setPanelMode('tasks')
      setOpen(!wasTasks)
    })

    notificationButton.addEventListener('click', function (event) {
      event.preventDefault()
      event.stopPropagation()
      acknowledgeNotifications()
      var wasNotifications = state.open && state.mode === 'notifications'
      setPanelMode('notifications')
      setOpen(!wasNotifications)
    })

    state.root = root
    state.button = trigger
    state.badge = badge
    state.notificationRoot = notificationRoot
    state.notificationButton = notificationButton
    state.notificationBadge = notificationBadge
    state.notificationPanel = notificationPanel
    placeNotificationTrigger(toolbar, notificationRoot)
    state.panel = panel
    state.taskList = panel.querySelector('.android-dmp-mobile-download-list')
    state.notificationList = notificationPanel.querySelector('.android-dmp-mobile-download-list')
    state.list = state.taskList
    state.tabs = []
    state.clear = panel.querySelector('.android-dmp-mobile-download-clear')
    state.feedback = panel.querySelector('.android-dmp-mobile-download-feedback')
    if (state.clear) installClearButtonPress(state.clear)
    renderList()
    if (state.open) setOpen(true)
    return true
  }

  function closeWhenOutside(event) {
    if (!state.open || !state.panel || !state.notificationPanel || !state.button) return
    var target = event.target
    if (state.panel.contains(target) || state.notificationPanel.contains(target)
        || state.button.contains(target)
        || state.notificationButton && state.notificationButton.contains(target)) return
    setOpen(false)
  }

  function installInteractions() {
    document.addEventListener('pointerdown', closeWhenOutside, true)
    document.addEventListener('touchstart', function (event) {
      if (!state.open || !event.touches || !event.touches.length) return
      var touch = event.touches[0]
      var activePanel = state.mode === 'notifications' ? state.notificationPanel : state.panel
      state.touch = { x: touch.clientX, y: touch.clientY,
        inside: activePanel && activePanel.contains(event.target) }
    }, true)
    document.addEventListener('touchend', function (event) {
      if (!state.open || !state.touch || !event.changedTouches || !event.changedTouches.length) return
      var touch = event.changedTouches[0]
      var dx = Math.abs(touch.clientX - state.touch.x)
      var dy = Math.abs(touch.clientY - state.touch.y)
      var inside = state.touch.inside
      state.touch = null
      /* An intentional swipe outside the card dismisses it. Inside scrolling
         remains untouched, so a long task list is still usable. */
      if (!inside && (dx > 24 || dy > 24)) setOpen(false)
    }, true)
    window.addEventListener('resize', positionPanel)
    window.addEventListener('orientationchange', function () {
      window.setTimeout(positionPanel, 60)
    })
    window.addEventListener('hashchange', function () { setOpen(false) })
  }

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return
    var style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = [
      '.android-dmp-mobile-download-anchor{display:inline-flex;align-items:center;position:relative;flex:none;margin-inline:2px}',
      '.android-dmp-mobile-download-trigger{position:relative;display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border:0;border-radius:50%;padding:0;background:transparent;color:rgb(var(--v-theme-on-surface));font:inherit;-webkit-tap-highlight-color:transparent}',
      '.android-dmp-mobile-download-trigger i{font-size:22px;line-height:1}',
      '.android-dmp-mobile-download-trigger:active,.android-dmp-mobile-download-trigger.open{background:rgba(145,85,253,.14);color:rgb(var(--v-theme-primary))}',
      '.android-dmp-mobile-download-trigger.has-active{background:rgba(79,190,119,.18);color:#2eaa63}',
      '.android-dmp-mobile-download-trigger.has-error{background:rgba(235,82,82,.18);color:#df3f45}',
      '.android-dmp-mobile-download-trigger:focus,.android-dmp-mobile-download-trigger:focus-visible{outline:none;box-shadow:none}',
      '.android-dmp-mobile-notification-anchor{display:inline-flex;align-items:center;position:relative;flex:none;margin-inline:2px}',
      '.android-dmp-mobile-notification-trigger{position:relative;display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border:0;border-radius:50%;padding:0;background:transparent;color:rgb(var(--v-theme-on-surface));font:inherit;-webkit-tap-highlight-color:transparent}',
      '.android-dmp-mobile-notification-trigger i{font-size:22px;line-height:1}',
      '.android-dmp-mobile-notification-trigger.has-notification{background:rgba(240,189,46,.2);color:#d29b00}',
      '.android-dmp-mobile-notification-trigger.open{background:rgba(240,189,46,.24);color:#d29b00}',
      '.android-dmp-mobile-notification-trigger:focus,.android-dmp-mobile-notification-trigger:focus-visible{outline:none;box-shadow:none}',
      '.android-dmp-mobile-notification-badge{display:none;position:absolute;top:2px;right:0;min-width:16px;height:16px;padding:0 4px;border:2px solid rgb(var(--v-theme-surface));border-radius:9px;background:#d29b00;color:#fff;font-size:10px;line-height:12px;text-align:center;pointer-events:none}',
      '.android-dmp-mobile-notification-badge.visible{display:block}',
      '.android-dmp-mobile-download-badge{display:none;position:absolute;top:2px;right:0;min-width:16px;height:16px;padding:0 4px;border:2px solid rgb(var(--v-theme-surface));border-radius:9px;background:rgb(var(--v-theme-primary));color:#fff;font-size:10px;line-height:12px;text-align:center;pointer-events:none}',
      '.android-dmp-mobile-download-badge.visible{display:block}',
      '.android-dmp-mobile-download-panel{display:none;position:fixed;z-index:2147483646;overflow:hidden;box-sizing:border-box;min-width:280px;min-height:160px;max-width:calc(100vw - 16px);border:1px solid rgba(145,85,253,.2);border-radius:18px;background:rgb(var(--v-theme-surface));box-shadow:0 16px 42px rgba(16,13,31,.32);opacity:0;transform:translateY(-8px);transition:opacity .16s ease,transform .16s ease;color:rgb(var(--v-theme-on-surface))}',
      '.android-dmp-mobile-download-panel.open{display:block;opacity:1;transform:translateY(0)}',
      '.android-dmp-mobile-download-header{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:56px;padding:8px 10px 8px 16px;border-bottom:1px solid rgba(var(--v-border-color),var(--v-border-opacity))}',
      '.android-dmp-mobile-download-header>div:first-child{min-width:0;flex:1 1 auto}',
      '.android-dmp-mobile-download-tabs{display:flex;align-items:center;gap:4px;flex:none}',
      '.android-dmp-mobile-download-tab{height:30px;min-width:58px;padding:0 8px;border:0;border-radius:8px;background:transparent;color:rgba(var(--v-theme-on-surface),.58);font:inherit;font-size:12px;white-space:nowrap}',
      '.android-dmp-mobile-download-tab.active{background:rgba(145,85,253,.16);color:rgb(var(--v-theme-primary));font-weight:650}',
      '.android-dmp-mobile-download-header strong{display:block;font-size:15px;line-height:20px;font-weight:700}',
      '.android-dmp-mobile-download-header span{display:block;margin-top:1px;color:rgba(var(--v-theme-on-surface),.56);font-size:11px;line-height:15px}',
      '.android-dmp-mobile-download-list{min-height:96px;max-height:calc(100vh - 144px);overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;padding:0 14px}',
      '.android-dmp-mobile-download-empty{display:flex;align-items:center;justify-content:center;min-height:156px;color:rgba(var(--v-theme-on-surface),.42);font-size:20px;font-weight:600;letter-spacing:.5px}',
      '.android-dmp-mobile-download-row{position:relative;display:flex;align-items:flex-start;gap:6px;min-height:74px;padding:11px 0 12px;border-bottom:1px solid rgba(var(--v-border-color),var(--v-border-opacity));transition:opacity .25s ease,border-color .25s ease}',
      '.android-dmp-mobile-download-row:last-child{border-bottom:0}',
      '.android-dmp-mobile-notification-row{display:flex;flex-direction:column;align-items:flex-start;width:100%;min-height:72px;padding:12px 2px;border:0;border-bottom:1px solid rgba(var(--v-border-color),var(--v-border-opacity));background:transparent;color:rgb(var(--v-theme-on-surface));font:inherit;text-align:left}',
      '.android-dmp-mobile-notification-row:last-child{border-bottom:0}',
      '.android-dmp-mobile-notification-row strong{font-size:14px;line-height:20px;color:#d29b00}',
      '.android-dmp-mobile-notification-row span{margin-top:3px;font-size:13px;line-height:19px;color:rgba(var(--v-theme-on-surface),.78);white-space:normal}',
      '.android-dmp-mobile-notification-row:active{background:rgba(145,85,253,.1)}',
      '.android-dmp-mobile-download-row.action-pending{opacity:.48;border-color:rgba(var(--v-theme-primary),.55)}',
      '.android-dmp-mobile-download-copy{min-width:0;flex:1;padding-right:2px}',
      '.android-dmp-mobile-download-title{overflow:hidden;font-size:14px;font-weight:650;line-height:20px;text-overflow:ellipsis;white-space:nowrap}',
      '.android-dmp-mobile-download-detail,.android-dmp-mobile-download-state,.android-dmp-mobile-download-bytes{overflow:hidden;margin-top:2px;color:rgba(var(--v-theme-on-surface),.62);font-size:12px;line-height:16px;text-overflow:ellipsis;white-space:nowrap}',
      '.android-dmp-mobile-download-bytes{color:rgba(var(--v-theme-on-surface),.48)}',
      '.android-dmp-mobile-download-controls{display:flex;align-items:center;flex:none;gap:1px;min-height:32px}',
      '.android-dmp-mobile-download-action{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;min-width:34px;border:0;border-radius:50%;padding:0;background:transparent!important;box-shadow:none!important;color:rgb(var(--v-theme-primary));-webkit-tap-highlight-color:transparent}',
      '.android-dmp-mobile-download-action i{font-size:20px;line-height:1}',
      '.android-dmp-mobile-download-action:active{background:rgba(145,85,253,.16);transform:scale(.94)}',
      '.android-dmp-mobile-download-action:focus,.android-dmp-mobile-download-action:focus-visible{outline:none;box-shadow:none}',
      '.android-dmp-mobile-download-clear{display:inline-flex;align-items:center;justify-content:center;flex:none;width:36px;height:36px;border:0;border-radius:50%;padding:0;background:transparent;color:rgba(var(--v-theme-on-surface),.72);font:inherit;-webkit-tap-highlight-color:transparent}',
      '.android-dmp-mobile-download-clear i{font-size:20px;line-height:1}',
      '.android-dmp-mobile-download-clear:active{background:rgba(145,85,253,.16);transform:scale(.94)}',
      '.android-dmp-mobile-download-clear:focus,.android-dmp-mobile-download-clear:focus-visible{outline:none;box-shadow:none}',
      '.android-dmp-mobile-download-progress{position:absolute;right:0;bottom:3px;left:0;height:4px;overflow:hidden;border-radius:4px;background:rgba(105,121,158,.18)}',
      '.android-dmp-mobile-download-progress i{display:block;width:0;height:100%;border-radius:inherit;background:#54bf78;transition:width .25s ease}',
      '.android-dmp-mobile-download-progress.upload i{background:#5b9cf6}',
      '.android-dmp-mobile-download-progress.failed i{background:#ef6268}',
      '.android-dmp-mobile-download-progress i.indeterminate{width:0!important;animation:none!important}',
      '.android-dmp-mobile-download-feedback{display:block;visibility:hidden;box-sizing:border-box;min-height:34px;margin:0 12px 10px;padding:7px 10px;border-radius:10px;background:rgba(145,85,253,.1);color:rgba(var(--v-theme-on-surface),.72);font-size:12px;line-height:17px;opacity:0;pointer-events:none;transition:opacity .26s ease,visibility .26s ease}',
      '.android-dmp-mobile-download-feedback.visible{visibility:visible;opacity:1}',
      '.android-dmp-mobile-download-feedback.fading{opacity:0;visibility:visible}',
      '@media (orientation:landscape) and (min-width:900px){.android-dmp-mobile-download-panel{border-radius:20px}.android-dmp-mobile-download-list{max-height:calc(100vh - 110px)}}'
    ].join('\n')
    document.head.appendChild(style)
  }

  function renderSoon() {
    window.clearTimeout(state.renderTimer)
    state.renderTimer = window.setTimeout(function () {
      mount()
      renderList()
      positionPanel()
    }, 0)
  }

  function start() {
    if (!mobileDownloadUiEnabled()) return
    installStyle()
    installInteractions()
    mount()
    renderList()
    /* Vue replaces the toolbar on route changes. The bounded watchdog remounts
       our isolated button without polling task APIs or touching Vue state. */
    window.setInterval(function () {
      mount()
      renderList()
      positionPanel()
    }, 500)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true })
  } else {
    start()
  }
})()
