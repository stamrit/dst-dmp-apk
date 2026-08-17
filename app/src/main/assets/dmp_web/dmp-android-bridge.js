(function () {
  'use strict'

  var nativeBridge = window.AndroidDmp
  if (!nativeBridge) return

  var bootstrap = JSON.parse(nativeBridge.getBootstrap())
  var selectedServer = bootstrap.dmps && bootstrap.dmps.length ? bootstrap.dmps[0] : null
  var apiBaseUrl = String(bootstrap.apiBaseUrl || '').replace(/\/+$/, '')
  var apiToken = bootstrap.apiToken || (selectedServer && selectedServer.token) || ''
  if (bootstrap.user) bootstrap.user.token = apiToken
  var store = {
    dmps: bootstrap.dmps,
    theme: bootstrap.theme,
    language: bootstrap.language,
  }

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
    if (/^v3(?:\/|$)/i.test(raw)) return apiBaseUrl + '/' + raw
    if (/^\/v3(?:\/|$)/i.test(raw)) return apiBaseUrl + raw
    return value
  }

  var nativeXhrOpen = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (method, url) {
    var args = Array.prototype.slice.call(arguments)
    args[1] = rewriteApiUrl(url)
    return nativeXhrOpen.apply(this, args)
  }

  if (window.fetch) {
    var nativeFetch = window.fetch.bind(window)
    window.fetch = function (input, init) {
      if (typeof input === 'string') return nativeFetch(rewriteApiUrl(input), init)
      if (input && input.url) {
        var rewritten = rewriteApiUrl(input.url)
        if (rewritten !== input.url) input = new Request(rewritten, input)
      }
      return nativeFetch(input, init)
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
      'body.android-room-preview .layout-content-wrapper { position: relative; z-index: 2; border-radius: 0 !important; box-shadow: none !important; background: rgb(var(--v-theme-background)); transform: translateX(0); transition: transform .38s cubic-bezier(.22,1,.36,1); will-change: transform; }',
      'body.android-room-preview .layout-navbar, body.android-room-preview .navbar-content-container, body.android-room-preview .layout-page-content, body.android-room-preview .page-content-container { border-radius: 0 !important; box-shadow: none !important; -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }',
      'body.android-room-preview.android-room-menu-open .layout-content-wrapper { transform: translateX(88px); }',
      '#android-room-menu { position: fixed; z-index: 2147483640; inset: 0 auto 0 0; inline-size: 88px; pointer-events: none; }',
      '#android-room-menu button { border: 0; color: rgb(var(--v-theme-on-surface)); background: rgb(var(--v-theme-surface)); cursor: pointer; -webkit-tap-highlight-color: transparent; }',
      '#android-room-menu .room-menu-trigger { position: fixed; inset-block-start: 8px; inset-inline-start: 10px; display: grid; place-items: center; inline-size: 46px; block-size: 46px; border-radius: 14px; font-size: 25px; pointer-events: auto; transition: transform .38s cubic-bezier(.22,1,.36,1), color .22s ease, background-color .22s ease; }',
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
      root.innerHTML = [
        '<button class="room-menu-trigger" type="button" aria-label="房间快捷菜单" aria-expanded="false"><i class="ri-menu-line"></i></button>',
        '<img class="room-menu-logo" src="dmp.png" alt="DMP">',
        '<div class="room-menu-panel" role="menu">',
        '<button class="room-menu-item" type="button" data-route="/dashboard" aria-label="控制面板" title="控制面板"><i class="ri-function-ai-line"></i></button>',
        '<button class="room-menu-item" type="button" data-route="/tools/map" aria-label="地图预览" title="地图预览"><i class="ri-road-map-line"></i></button>',
        '<button class="room-menu-item" type="button" data-route="/tools/tmi" aria-label="TMI" title="TMI"><i class="ri-ghost-line"></i></button>',
        '<button class="room-menu-item" type="button" data-route="/tools/aichat" aria-label="AI 对话" title="AI 对话"><i class="ri-chat-smile-ai-3-line"></i></button>',
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
      var wideLandscapeQuery = window.matchMedia('(orientation: landscape) and (min-width: 900px)')

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
      wideLandscapeQuery.addEventListener('change', function () {
        syncOpenState(root.classList.contains('open'))
      })
      updateActive()
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mount, { once: true })
    } else {
      mount()
    }
  }

  function installPlatformMenuFix() {
    var style = document.createElement('style')
    style.textContent = [
      'body.android-platform-view { overflow-x: hidden; background: rgb(var(--v-theme-surface-variant)); }',
      'body.android-platform-view .layout-content-wrapper { position: relative; z-index: 2; flex: 1 1 auto; min-inline-size: 0 !important; max-inline-size: 100% !important; box-sizing: border-box !important; padding-inline-start: 0 !important; border-radius: 0 !important; box-shadow: none !important; background: rgb(var(--v-theme-background)); transform: translateX(0); transition: width .24s cubic-bezier(.22,1,.36,1), max-width .24s cubic-bezier(.22,1,.36,1), flex-basis .24s cubic-bezier(.22,1,.36,1), transform .38s cubic-bezier(.22,1,.36,1) !important; will-change: width, max-width, flex-basis, transform; }',
      'body.android-platform-view .layout-navbar, body.android-platform-view .navbar-content-container, body.android-platform-view .layout-page-content, body.android-platform-view .page-content-container { border-radius: 0 !important; box-shadow: none !important; -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }',
      'body.android-platform-view .layout-navbar .d-lg-none { display: flex !important; visibility: visible !important; }',
      'body.android-platform-view .layout-vertical-nav { position: fixed !important; z-index: 1 !important; opacity: 0 !important; box-shadow: none !important; transform: translateX(-28px) !important; transition: opacity .24s ease, transform .38s cubic-bezier(.22,1,.36,1) !important; }',
      'body.android-platform-view .layout-vertical-nav .vertical-nav-items-shadow { display: none !important; }',
      'body.android-platform-view .layout-vertical-nav.android-platform-menu-open { opacity: 1 !important; transform: translateX(0) !important; }',
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

      function isWideLandscape() {
        return wideLandscapeQuery.matches
      }

      function syncOpenState(open) {
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
      window.addEventListener('hashchange', closeMenu)
      wideLandscapeQuery.addEventListener('change', function () {
        syncOpenState(nav.classList.contains('android-platform-menu-open'))
      })
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
