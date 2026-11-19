(function () {
  'use strict'

  if (window.__dmpSettingCompatInstalled) return
  window.__dmpSettingCompatInstalled = true

  // The setting chunk keeps the 3.2 API/state implementation, while this
  // small DOM adapter restores the old mobile icon-strip interaction.  It is
  // deliberately separate from the generated bundle so a future DMP rebuild
  // cannot silently remove the Android presentation fix.
  function readAndroidSettings() {
    var settings = {}
    try {
      if (window.AndroidDmp && typeof window.AndroidDmp.getBootstrap === 'function') {
        var bootstrap = JSON.parse(window.AndroidDmp.getBootstrap() || '{}') || {}
        settings.download = bootstrap.androidDownloadUi !== false
        settings.modConfig = bootstrap.androidModConfigUi !== false
      }
    } catch (ignored) {}
    // dmp-android-bridge.js normalizes these values before this adapter is
    // loaded.  Prefer that normalized flag when available (notably when an
    // older native bridge returns a bootstrap object without the new key).
    if (typeof window.__dmpAndroidDownloadUiEnabled === 'boolean') {
      settings.download = window.__dmpAndroidDownloadUiEnabled
    }
    if (typeof window.__dmpAndroidModConfigUiEnabled === 'boolean') {
      settings.modConfig = window.__dmpAndroidModConfigUiEnabled
    }
    if (typeof settings.download !== 'boolean') settings.download = true
    if (typeof settings.modConfig !== 'boolean') settings.modConfig = true
    return settings
  }

  function applyAndroidSettings() {
    var settings = readAndroidSettings()
    // dmp-mobile-download-center.js checks this guard before installing.  A
    // false value therefore leaves the official bundle's DownloadCenter in
    // charge without modifying that generated compatibility file.
    window.__dmpAndroidDownloadUiEnabled = settings.download
    if (!settings.download) window.__dmpMobileDownloadCenterInstalled = true
    if (document.documentElement) {
      document.documentElement.classList.toggle(
        'dmp-android-mod-config-enabled', settings.modConfig)
    }
    if (document.body) {
      document.body.classList.toggle('dmp-android-mod-config-enabled', settings.modConfig)
    }
    return settings
  }

  function install() {
    if (!document.body) return
    var settings = applyAndroidSettings()
    if (!settings.modConfig) return
    /*
     * The 3.2.1 setting chunk no longer carries the old semantic class names
     * (mod-setting-shell/mod-picker/mod-icon-strip).  It renders the same
     * two-pane structure with Vuetify v-row/v-col/card-header/fcc classes.
     * Stamp the stable runtime nodes once so the existing Android layout CSS
     * can keep providing the phone icon-strip design without changing Vue's
     * state or click handlers.
     */
    var stampConfigLayout = function () {
      var rows = document.querySelectorAll('.v-row')
      for (var rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        var row = rows[rowIndex]
        var columns = []
        for (var childIndex = 0; childIndex < row.children.length; childIndex += 1) {
          var child = row.children[childIndex]
          if (/^v-col(?:-|$)/.test(String(child.className || ''))) {
            columns.push(child)
          }
        }
        if (columns.length < 2) continue
        var picker = null
        for (var columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
          var candidate = columns[columnIndex]
          /* The enabled-mod list can legitimately be empty.  In that state
             the official chunk renders the same card/header but only the
             result container (no `.fcc`/`.w-33` tile yet).  Recognise that
             stable container too so the old two-pane layout is applied from
             the first frame and the empty list does not jump below the form
             after the first refresh. */
          if (candidate.querySelector('.card-header') &&
              (candidate.querySelector('.fcc') || candidate.querySelector('.w-33') ||
               candidate.querySelector('.v-container'))) {
            picker = candidate
            break
          }
        }
        if (!picker) continue
        var detail = null
        for (var detailIndex = 0; detailIndex < columns.length; detailIndex += 1) {
          if (columns[detailIndex] !== picker) {
            detail = columns[detailIndex]
            break
          }
        }
        if (!detail) continue
        var shell = row.parentElement
        if (shell) shell.classList.add('mod-setting-shell')
        row.classList.add('mod-config-layout')
        // The world selector is rendered immediately before the row in the
        // current chunk.  Restamp it when present so the old shell spacing is
        // retained without relying on Vue's generated scope attributes.
        if (shell) {
          var preceding = row.previousElementSibling
          if (preceding && (preceding.matches('.v-input, .v-selection-control, .v-radio-group') ||
              preceding.querySelector('.v-selection-control, .v-radio-group'))) {
            preceding.classList.add('mod-world-picker')
          }
        }
        picker.classList.add('mod-picker')
        detail.classList.add('mod-detail')
        // The upstream setting chunk keeps the selected mod name only in the
        // form card title.  The Android design also had a compact, persistent
        // label below the form; restore that presentation without touching
        // Vue state.  It is updated by the delegated tile listener below.
        var selectedName = detail.querySelector('.mod-selected-name')
        if (!selectedName) {
          selectedName = document.createElement('div')
          selectedName.className = 'mod-selected-name empty'
          selectedName.setAttribute('aria-live', 'polite')
          selectedName.innerHTML = '<i class="ri-puzzle-2-line"></i><span>选择模组</span>'
          detail.appendChild(selectedName)
        }
        var card = picker.querySelector('.v-card')
        var cardText = card && card.querySelector('.v-card-text')
        var strip = cardText && (cardText.querySelector('.v-container') || cardText)
        if (!strip) continue
        strip.classList.add('mod-icon-strip')
        /* A few Huawei/old Chromium WebViews ignore touch-action on a flex
           child when the surrounding Vuetify card also scrolls.  Once the
           gesture is clearly horizontal, drive scrollLeft ourselves; taps
           remain untouched until the 5px direction threshold is crossed. */
        if (strip.dataset.androidHorizontalTouchReady !== '1') {
          strip.dataset.androidHorizontalTouchReady = '1'
          var horizontalGesture = null
          strip.addEventListener('touchstart', function (event) {
            if (window.matchMedia && window.matchMedia('(orientation: landscape) and (min-width: 900px)').matches) {
              horizontalGesture = null
              return
            }
            var touch = event.touches && event.touches[0]
            if (!touch) return
            horizontalGesture = { x: touch.clientX, y: touch.clientY, scroll: strip.scrollLeft, active: false }
          }, { passive: true })
          strip.addEventListener('touchmove', function (event) {
            if (!horizontalGesture) return
            var touch = event.touches && event.touches[0]
            if (!touch) return
            var dx = touch.clientX - horizontalGesture.x
            var dy = touch.clientY - horizontalGesture.y
            if (!horizontalGesture.active) {
              if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return
              if (Math.abs(dy) > Math.abs(dx)) {
                horizontalGesture = null
                return
              }
              horizontalGesture.active = true
            }
            if (!horizontalGesture.active) return
            strip.scrollLeft = horizontalGesture.scroll - dx
            event.preventDefault()
            event.stopPropagation()
          }, { passive: false })
          strip.addEventListener('touchend', function () { horizontalGesture = null }, { passive: true })
          strip.addEventListener('touchcancel', function () { horizontalGesture = null }, { passive: true })
        }
        /* The Vuetify container normally exposes one wrapper per mod as a
           direct child, but some WebViews insert a v-row helper.  Scan every
           .fcc tile and mark its immediate wrapper so all enabled mods remain
           visible in either structure. */
        var items = strip.querySelectorAll('.fcc')
        for (var itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
          var content = items[itemIndex]
          var item = content && content.parentElement
          if (item) {
            item.classList.add('mod-icon-button')
            content.classList.add('mod-icon-content')
            var image = content.querySelector('.w-33 .v-img, .w-33 img')
            if (image) image.classList.add('mod-icon-image')
            if (item.dataset.androidConfigReady !== '1') {
              item.dataset.androidConfigReady = '1'
              item.addEventListener('click', function (event) {
                // Use the clicked tile's own strip.  A `var strip` closure
                // would point every listener at the final row when more than
                // one setting panel is mounted during route transitions.
                var owner = event.currentTarget
                while (owner && owner !== strip &&
                    !(owner.classList && owner.classList.contains('mod-icon-strip'))) {
                  owner = owner.parentElement
                }
                if (!owner || !owner.classList ||
                    !owner.classList.contains('mod-icon-strip')) owner = strip
                if (!owner) return
                var siblings = owner.querySelectorAll('.mod-icon-button.selected')
                for (var selectedIndex = 0; selectedIndex < siblings.length; selectedIndex += 1) {
                  siblings[selectedIndex].classList.remove('selected')
                }
                event.currentTarget.classList.add('selected')
                var label = event.currentTarget.getAttribute('aria-label') || ''
                if (!label) {
                  var chip = event.currentTarget.querySelector('.w-66 .v-chip, .w-66')
                  label = chip ? String(chip.textContent || '').trim() : ''
                }
                var shellNode = owner.closest && owner.closest('.mod-setting-shell')
                var labelNode = shellNode && shellNode.querySelector('.mod-detail .mod-selected-name span')
                var labelBox = shellNode && shellNode.querySelector('.mod-detail .mod-selected-name')
                if (labelNode && label) labelNode.textContent = label
                if (labelBox && label) labelBox.classList.remove('empty')
              })
            }
          }
        }
      }
    }
    function routePath() {
      var hash = String(window.location && window.location.hash || '')
        .replace(/^#/, '').split('?')[0]
      if (hash) return hash
      return String(window.location && window.location.pathname || '')
        .split('?')[0]
    }
    function isModRoute() {
      var path = routePath()
      // The production build uses hash history, while a desktop preview can
      // use browser history.  The toolbar/container fallback covers the brief
      // frame in which Vue has mounted the page before history is committed.
      return /^\/game\/mod(?:\/|$)/i.test(path)
        || !!document.querySelector('.mod-page-toolbar, .mod-setting-container')
    }
    var refresh = function () {
      // Keep the observer cheap on dashboard/room pages: those routes contain
      // many v-rows and mutate frequently while cards load.
      if (!isModRoute()) return
      stampConfigLayout()
      var landscape = window.matchMedia
        ? window.matchMedia('(orientation: landscape) and (min-width: 900px)').matches
        : false
      document.querySelectorAll('.mod-setting-shell').forEach(function (shell) {
        shell.classList.toggle('wide-landscape', !!landscape)
        shell.querySelectorAll('button[role="tab"]').forEach(function (button) {
          button.classList.add('mod-icon-button')
          if (button.dataset.androidSettingReady === '1') return
          button.dataset.androidSettingReady = '1'
          button.addEventListener('click', function () {
            var strip = button.parentElement
            if (!strip) return
            strip.querySelectorAll('.mod-icon-button.selected').forEach(function (item) {
              item.classList.remove('selected')
            })
            button.classList.add('selected')
          })
        })
      })
    }
    var refreshFrame = 0
    function scheduleRefresh() {
      if (refreshFrame) return
      var run = function () {
        refreshFrame = 0
        refresh()
      }
      if (window.requestAnimationFrame) refreshFrame = window.requestAnimationFrame(run)
      else refreshFrame = window.setTimeout(run, 16)
    }
    refresh()
    new MutationObserver(scheduleRefresh).observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', refresh)
    window.addEventListener('orientationchange', refresh)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true })
  } else {
    install()
  }
})();

/* The add-mod catalogue is generated by a separate Vue chunk and has no
 * stable page class.  Stamp only the matching data table so the mobile
 * two-row layout in dmp-setting-compat.css never affects other tables. */
(function () {
  'use strict'

  if (window.__dmpAddTableCompatInstalled) return
  window.__dmpAddTableCompatInstalled = true

  function isAddRoute() {
    var hash = String(window.location && window.location.hash || '')
      .replace(/^#/, '').split('?')[0]
    /* The 3.2 bundle keeps Add as a tab inside /game/mod rather than a
       separate /game/mod/add route.  Keep the old route aliases, but let the
       table-header check below be the authoritative signal for the current
       tab. */
    return /^\/(?:game\/mod\/add|mod\/add)(?:\/|$)/i.test(hash)
  }

  function addTable(table) {
    var header = table && table.querySelector('thead')
    var labels = String(header && header.textContent || '')
    return /预览图|preview/i.test(labels)
      && /名称|name/i.test(labels)
      && /大小|size/i.test(labels)
      /* Chinese table headers are adjacent to ID without an ASCII word
         boundary (例如“大小ID模组版本”).  Chromium therefore makes
         /\bID\b/ false here; the header label itself is the stable signal. */
      && /ID/i.test(labels)
  }

  function markAddTables() {
    if (!document.body) return
    var tables = Array.prototype.slice.call(
      document.querySelectorAll('.v-data-table'))
    var matchingTables = tables.filter(addTable)
    /* In the current web build the route remains /game/mod for all three
       tabs.  A matching header is therefore also enough to identify the Add
       tab, even before Vuetify has committed its selected-tab class. */
    var add = isAddRoute() || matchingTables.length > 0
    if (document.body.classList.contains('dmp-android-mod-add') !== add) {
      document.body.classList.toggle('dmp-android-mod-add', add)
    }
    document.querySelectorAll('.android-mod-add-table').forEach(function (table) {
      if (matchingTables.indexOf(table) < 0) table.classList.remove('android-mod-add-table')
    })
    if (add) matchingTables.forEach(function (table) {
      if (!table.classList.contains('android-mod-add-table')) {
        table.classList.add('android-mod-add-table')
      }
    })
  }

  function install() {
    if (!document.body) return
    var markFrame = 0
    function scheduleMark() {
      if (markFrame) return
      var run = function () {
        markFrame = 0
        markAddTables()
      }
      if (window.requestAnimationFrame) markFrame = window.requestAnimationFrame(run)
      else markFrame = window.setTimeout(run, 16)
    }
    markAddTables()
    var observer = new MutationObserver(scheduleMark)
    observer.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('hashchange', scheduleMark)
    window.addEventListener('resize', scheduleMark)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true })
  } else {
    install()
  }
})();

/* The official install view is a two-column page: system information on the
 * left and install/update actions on the right.  On a phone those columns
 * become two very long stacked cards.  Give the two logical pages explicit
 * mobile tabs while leaving the underlying Vue controls and API untouched. */
(function () {
  'use strict'

  if (window.__dmpInstallTabsCompatInstalled) return
  window.__dmpInstallTabsCompatInstalled = true

  var style = document.createElement('style')
  style.id = 'android-install-tabs-style'
  style.textContent = [
    '.android-install-tabs{display:flex!important;align-items:stretch!important;gap:4px!important;width:100%!important;margin:0 0 12px!important;padding:0 4px!important;border-bottom:1px solid rgba(var(--v-border-color),.18)!important;overflow-x:auto!important;overscroll-behavior-x:contain!important}',
    '.android-install-tab{flex:1 1 0!important;min-width:120px!important;min-height:42px!important;padding:8px 14px!important;border:0!important;border-bottom:3px solid transparent!important;border-radius:10px 10px 0 0!important;background:transparent!important;color:rgba(var(--v-theme-on-surface),.68)!important;font:inherit!important;font-weight:600!important;white-space:nowrap!important;cursor:pointer!important;-webkit-tap-highlight-color:transparent!important}',
    '.android-install-tab.active{color:rgb(var(--v-theme-primary))!important;border-bottom-color:rgb(var(--v-theme-primary))!important;background:rgba(var(--v-theme-primary),.10)!important}',
    '.android-install-tab:active{transform:scale(.98)!important}',
    '@media (min-width:900px){.android-install-tabs{max-width:560px!important;margin-inline:auto!important}}',
    '.android-install-game-version{box-sizing:border-box!important;width:100%!important;max-width:420px!important;margin:14px auto 2px!important;padding:10px 14px!important;border:1px solid rgba(var(--v-border-color),.24)!important;border-radius:10px!important;background:rgba(var(--v-theme-primary),.08)!important;color:rgba(var(--v-theme-on-surface),.82)!important;font-size:14px!important;line-height:1.8!important;text-align:center!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}',
    '.android-install-game-version-line{display:block!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}',
    '.android-install-game-version-label{color:rgba(var(--v-theme-on-surface),.64)!important;margin-inline-end:4px!important}',
    '.android-install-game-version-value{color:rgb(var(--v-theme-primary))!important;font-variant-numeric:tabular-nums!important}'
  ].join('\n')
  document.head.appendChild(style)

  function routeIsInstall () {
    var hash = String(window.location && window.location.hash || '')
      .replace(/^#/, '').split('?')[0]
    return /^\/install(?:\/|$)/i.test(hash)
  }

  function directChildrenByClass (node, prefix) {
    var result = []
    if (!node || !node.children) return result
    for (var i = 0; i < node.children.length; i += 1) {
      var child = node.children[i]
      if (String(child.className || '').split(/\s+/).some(function (name) {
        // Vuetify emits responsive variants such as `v-col-md-6 v-col-12`.
        // Treat the base class and its hyphenated variants as the same
        // direct-child slot; the previous exact match missed every column on
        // the install page and therefore never mounted the tabs.
        return name === prefix || name.indexOf(prefix + '-') === 0
      })) result.push(child)
    }
    return result
  }

  function gameVersionRequest () {
    var base = String(window.__dmpApiBaseUrl || '').replace(/\/+$/, '')
    var token = ''
    try {
      var bootstrap = window.AndroidDmp && typeof window.AndroidDmp.getBootstrap === 'function'
        ? JSON.parse(window.AndroidDmp.getBootstrap() || '{}') : {}
      if (!base) base = String(bootstrap.apiBaseUrl || '').replace(/\/+$/, '')
      token = String(bootstrap.apiToken || (bootstrap.user && bootstrap.user.token) || '')
    } catch (ignored) {}
    if (!base || typeof window.fetch !== 'function') return Promise.resolve(null)
    var headers = { 'Accept': 'application/json' }
    if (token) headers['X-DMP-TOKEN'] = token
    return window.fetch(base + '/v3/platform/game_version', {
      headers: headers, cache: 'no-store'
    }).then(function (response) {
      if (!response || !response.ok) throw new Error('game-version')
      return response.json()
    }).then(function (payload) {
      var data = payload && payload.data ? payload.data : payload
      if (!data || typeof data !== 'object') return null
      var latest = data.server != null ? data.server : data.latest
      var current = data.local != null ? data.local : data.current
      return { latest: latest == null ? '—' : String(latest), current: current == null ? '—' : String(current) }
    }).catch(function () { return null })
  }

  function updateGameVersionPanel (panel) {
    if (!panel) return
    gameVersionRequest().then(function (version) {
      if (!version || !panel.isConnected) return
      var latest = panel.querySelector('[data-game-version="latest"]')
      var current = panel.querySelector('[data-game-version="current"]')
      if (latest) latest.textContent = version.latest
      if (current) current.textContent = version.current
    })
  }

  function mountGameVersionPanel (root, columns) {
    if (!root || !columns || columns.length < 2) return
    var updateColumn = columns[1]
    var container = updateColumn.querySelector('.v-container')
    var body = container && container.querySelector('.d-flex.flex-column')
    if (!body) return
    var panel = body.querySelector('.android-install-game-version')
    if (!panel) {
      var buttons = body.querySelectorAll('button')
      if (!buttons.length) return
      panel = document.createElement('div')
      panel.className = 'android-install-game-version'
      panel.setAttribute('aria-label', '游戏版本')
      panel.innerHTML = '<span class="android-install-game-version-line"><span class="android-install-game-version-label">最新版本-</span><span class="android-install-game-version-value" data-game-version="latest">读取中</span></span>'
        + '<span class="android-install-game-version-line"><span class="android-install-game-version-label">当前版本-</span><span class="android-install-game-version-value" data-game-version="current">读取中</span></span>'
      body.insertBefore(panel, buttons[0])
    }
    updateGameVersionPanel(panel)
  }

  function mountInstallTabs () {
    if (!routeIsInstall() || !document.body) return
    var roots = document.querySelectorAll('.v-container.v-container--fluid')
    var root = null
    var columns = null
    for (var ri = 0; ri < roots.length; ri += 1) {
      var candidate = roots[ri]
      var rows = directChildrenByClass(candidate, 'v-row')
      if (!rows.length) continue
      var cols = directChildrenByClass(rows[0], 'v-col')
      if (cols.length >= 2) {
        root = candidate
        columns = cols
        break
      }
    }
    if (!root || !columns || columns.length < 2) return
    mountGameVersionPanel(root, columns)
    var tabs = root.querySelector('.android-install-tabs')
    if (!tabs) {
      tabs = document.createElement('div')
      tabs.className = 'android-install-tabs'
      tabs.setAttribute('role', 'tablist')
      var labels = ['系统配置', '游戏更新']
      labels.forEach(function (label, index) {
        var button = document.createElement('button')
        button.type = 'button'
        button.className = 'android-install-tab'
        button.setAttribute('role', 'tab')
        button.setAttribute('aria-selected', index === 0 ? 'true' : 'false')
        button.textContent = label
        button.dataset.installTab = String(index)
        button.addEventListener('click', function () {
          setActive(index)
        })
        tabs.appendChild(button)
      })
      var firstRow = directChildrenByClass(root, 'v-row')[0]
      if (firstRow) root.insertBefore(tabs, firstRow)
    }
    function setActive (index) {
      var safe = index === 1 ? 1 : 0
      for (var ci = 0; ci < columns.length; ci += 1) {
        columns[ci].style.display = ci === safe ? '' : 'none'
        columns[ci].setAttribute('aria-hidden', ci === safe ? 'false' : 'true')
      }
      tabs.querySelectorAll('.android-install-tab').forEach(function (button) {
        var active = Number(button.dataset.installTab) === safe
        button.classList.toggle('active', active)
        button.setAttribute('aria-selected', active ? 'true' : 'false')
      })
      try { sessionStorage.setItem('dmp-android-install-tab', String(safe)) } catch (ignored) {}
    }
    var saved = 0
    try { saved = Number(sessionStorage.getItem('dmp-android-install-tab') || 0) } catch (ignored) {}
    setActive(saved === 1 ? 1 : 0)
  }

  function install () {
    if (!document.body) return
    var frame = 0
    function schedule () {
      if (frame) return
      var run = function () { frame = 0; mountInstallTabs() }
      frame = window.requestAnimationFrame
        ? window.requestAnimationFrame(run) : window.setTimeout(run, 16)
    }
    schedule()
    if (window.MutationObserver) {
      new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true })
    }
    window.addEventListener('hashchange', schedule)
    window.addEventListener('resize', schedule)
    window.addEventListener('orientationchange', schedule)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true })
  } else {
    install()
  }
})();
