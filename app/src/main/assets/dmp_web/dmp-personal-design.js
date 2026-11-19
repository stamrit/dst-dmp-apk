(function () {
  'use strict'

  /*
   * Personal Android presentation layer.
   *
   * The upstream 3.2 web bundle is intentionally kept intact.  Earlier
   * mobile builds added two small pieces of presentation that are not part of
   * the upstream pages: an inline composer on the game/chat log pages and the
   * compact two-pane mod configuration picker.  This file restores those
   * pieces at DOM level so a web-bundle upgrade cannot silently remove them.
   */
  if (window.__dmpPersonalDesignInstalled) return
  window.__dmpPersonalDesignInstalled = true

  var text = function (value) { return String(value == null ? '' : value) }
  var raf = window.requestAnimationFrame || function (fn) { return window.setTimeout(fn, 16) }
  /* Keep one resize watcher for all log footers.  A route change can detach a
     Vue-generated footer; per-footer window listeners would retain those
     detached subtrees and slowly accumulate across room/log navigation. */
  var logLineFooters = []
  var logLineResizeBound = false
  var logDownloadRefreshTimer = 0
  var logDownloadLastSignature = ''
  var cachedLogFooter = null
  var cachedLogFooterRoute = ''

  function pruneLogLineFooters () {
    if (!document || !document.documentElement) return
    for (var i = logLineFooters.length - 1; i >= 0; i -= 1) {
      var footer = logLineFooters[i]
      if (footer && document.documentElement.contains(footer)) continue
      if (footer && footer.__androidLogLineObserver) {
        try { footer.__androidLogLineObserver.disconnect() } catch (ignored) {}
        footer.__androidLogLineObserver = null
      }
      logLineFooters.splice(i, 1)
    }
  }

  function registerLogLineFooter (footer) {
    if (!footer) return
    if (logLineFooters.indexOf(footer) < 0) logLineFooters.push(footer)
    if (logLineResizeBound) return
    logLineResizeBound = true
    window.addEventListener('resize', function () {
      pruneLogLineFooters()
      for (var i = 0; i < logLineFooters.length; i += 1) {
        var current = logLineFooters[i]
        if (!current || typeof current.__androidLogRestoreLine !== 'function') continue
        window.setTimeout(current.__androidLogRestoreLine, 280)
      }
    })
  }

  function routePath () {
    var hash = text(window.location && window.location.hash || '')
      .replace(/^#/, '').split('?')[0]
    return hash || text(window.location && window.location.pathname || '').split('?')[0] || '/'
  }

  function settingEnabled () {
    return window.__dmpAndroidModConfigUiEnabled !== false
  }

  function apiBase () {
    var base = text(window.__dmpApiBaseUrl || '').replace(/\/+$/, '')
    if (base) return base
    try {
      if (window.AndroidDmp && typeof window.AndroidDmp.getBootstrap === 'function') {
        var boot = JSON.parse(window.AndroidDmp.getBootstrap() || '{}')
        return text(boot.apiBaseUrl || '').replace(/\/+$/, '')
      }
    } catch (ignored) {}
    return ''
  }

  function apiToken () {
    try {
      if (window.AndroidDmp && typeof window.AndroidDmp.getBootstrap === 'function') {
        var boot = JSON.parse(window.AndroidDmp.getBootstrap() || '{}')
        if (boot.apiToken) return text(boot.apiToken)
        if (boot.user && boot.user.token) return text(boot.user.token)
      }
    } catch (ignored) {}
    try {
      var user = JSON.parse(localStorage.getItem('dmp-user') || '{}')
      return text(user.token || user.apiToken || '')
    } catch (ignored) { return '' }
  }

  function roomId () {
    var candidates = []
    if (window.__dmpServerRoomId) candidates.push(window.__dmpServerRoomId)
    /* A direct room preview can be opened before Pinia has persisted the
       selected room.  Keep the URL as a final, read-only fallback; this is
       useful after a WebView recreation and does not change the active room. */
    try {
      var query = new URLSearchParams(String(window.location && window.location.search || ''))
      candidates.push(query.get('roomID') || query.get('roomId') || query.get('room'))
      var hash = String(window.location && window.location.hash || '')
      var hashQuery = hash.indexOf('?') >= 0 ? hash.slice(hash.indexOf('?') + 1) : ''
      if (hashQuery) {
        var hashParams = new URLSearchParams(hashQuery)
        candidates.push(hashParams.get('roomID') || hashParams.get('roomId') || hashParams.get('room'))
      }
    } catch (ignored) {}
    try {
      if (window.AndroidDmp && typeof window.AndroidDmp.getBootstrap === 'function') {
        var boot = JSON.parse(window.AndroidDmp.getBootstrap() || '{}')
        candidates.push(boot.global && boot.global.room && boot.global.room.id)
        candidates.push(boot.roomID)
      }
    } catch (ignored) {}
    try {
      var persisted = JSON.parse(localStorage.getItem('dmp-global') || '{}')
      candidates.push(persisted.global && persisted.global.room && persisted.global.room.id)
      candidates.push(persisted.room && persisted.room.id)
      candidates.push(persisted.roomID)
    } catch (ignored) {}
    /* Some 3.2 room components retain the id on their root while the global
       store is being replaced.  Only inspect explicit data attributes to
       avoid accidentally treating a world/mod id as a room id. */
    try {
      var marked = document.querySelector('[data-room-id],[data-roomid]')
      if (marked) candidates.push(marked.getAttribute('data-room-id') || marked.getAttribute('data-roomid'))
    } catch (ignored) {}
    for (var i = 0; i < candidates.length; i += 1) {
      var id = Number(candidates[i] || 0)
      if (id > 0) return id
    }
    return 0
  }

  function installStyle () {
    if (document.getElementById('android-personal-design-style')) return
    var style = document.createElement('style')
    style.id = 'android-personal-design-style'
    style.textContent = [
      '.android-personal-log-composer{display:flex;align-items:center;gap:8px;flex:1 1 300px;min-width:180px;margin-inline-end:8px;box-sizing:border-box}',
      '.android-personal-log-composer input{box-sizing:border-box;flex:1 1 auto;min-width:110px;height:40px;padding:0 12px;border:1px solid rgba(var(--v-border-color),.52);border-radius:6px;background:transparent;color:rgb(var(--v-theme-on-surface));font:inherit;outline:none}',
      '.android-personal-log-composer input:focus{border-color:rgb(var(--v-theme-primary));box-shadow:0 0 0 2px rgba(var(--v-theme-primary),.16)}',
      '.android-personal-log-composer button{box-sizing:border-box;flex:0 0 auto;height:40px;min-width:64px;padding:0 14px;border:0;border-radius:6px;background:rgb(var(--v-theme-info));color:rgb(var(--v-theme-on-info,#fff));font:inherit;cursor:pointer}',
      '.android-personal-log-composer button:disabled{opacity:.58;cursor:default}',
      /* Keep the send result available to screen readers without turning the
         four-control footer into a five-column row.  The old mobile template
         has no status column; an in-flow status span made the composer steal
         width from the line-count and refresh controls on tablets/landscape.
         Keep it visually unobtrusive and out of layout while it is empty (or
         briefly announcing a send result). */
      '.android-personal-log-status{position:absolute!important;inset-inline-start:0!important;inset-block-end:-18px!important;display:block!important;max-width:100%!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;font-size:12px;color:rgba(var(--v-theme-on-surface),.62);pointer-events:none!important}',
      /* Match the old mobile singleLog footer: tablet and landscape keep all
         four controls on one flex row.  Only a narrow portrait phone uses a
         second row, where the line-count field ends at the composer input's
         right edge and the refresh button ends at the send button's edge. */
      '.android-personal-log-footer{display:flex!important;flex-wrap:nowrap!important;align-items:center!important;justify-content:flex-end!important;align-content:center!important;gap:8px!important;width:100%!important;min-width:0!important;min-height:0!important;height:auto!important;max-height:none!important;overflow:visible!important;margin-inline:0!important;padding-inline:0!important}',
      /* The upstream row contains a spacer on tablet/landscape.  Once the
         personal composer is restored that spacer must not consume a second
         flexible column, otherwise the four controls split and the menu/log
         footer appears clipped. */
      '.android-personal-log-footer>.v-spacer{display:none!important;flex:0 0 0!important;width:0!important;min-width:0!important}',
      '.android-personal-log-footer>.android-personal-log-composer{position:relative!important;box-sizing:border-box!important;display:flex!important;flex:1 1 auto!important;order:0!important;width:auto!important;max-width:none!important;min-width:0!important;margin:0!important}',
      '.android-personal-log-footer>.android-personal-log-composer input{min-width:0!important;width:auto!important}',
      '.android-personal-log-footer>.android-personal-log-composer button{width:64px!important;min-width:64px!important;padding-inline:8px!important}',
      '.android-personal-log-footer>.v-col{box-sizing:border-box!important;display:flex!important;align-items:center!important;justify-content:flex-end!important;flex:0 0 auto!important;min-width:0!important;max-width:none!important;width:auto!important;margin:0!important;padding:0!important;gap:8px!important}',
      '.android-personal-log-footer>.v-col>.v-input.v-number-input{box-sizing:border-box!important;flex:0 0 120px!important;width:120px!important;min-width:120px!important;max-width:120px!important;margin:0!important}',
      '.android-personal-log-footer>.v-col>.v-btn{box-sizing:border-box!important;flex:0 0 64px!important;width:64px!important;min-width:64px!important;margin:0!important}',
      '.android-personal-log-footer-host,.android-personal-log-card,.android-personal-log-card .v-card-actions,.android-personal-log-card .v-card-text{height:auto!important;min-height:0!important;max-height:none!important;overflow:visible!important}',
      '.android-personal-history-card .android-personal-history-content{max-height:calc(100vh - 300px)!important;min-height:120px!important;overflow:auto!important}',
      '.android-personal-history-controls{display:flex!important;align-items:center!important;justify-content:flex-end!important;gap:8px!important;flex-wrap:wrap!important;margin-top:12px!important;padding-top:8px!important;border-top:1px solid rgba(var(--v-border-color),.2)!important}',
      '.android-personal-history-controls.v-row>.v-col{box-sizing:border-box!important;display:flex!important;align-items:center!important;justify-content:flex-end!important;gap:8px!important;flex:1 1 auto!important;min-width:0!important;padding:0!important}',
      '.android-personal-history-controls.v-row>.v-col>.v-input.v-number-input{box-sizing:border-box!important;flex:0 0 120px!important;width:120px!important;min-width:120px!important;max-width:120px!important;margin:0!important}',
      '.android-personal-history-controls.v-row>.v-col>.v-btn{box-sizing:border-box!important;flex:0 0 64px!important;width:64px!important;min-width:64px!important;margin:0!important}',
      '.android-personal-history-controls>label{display:flex;align-items:center;gap:6px;color:rgba(var(--v-theme-on-surface),.72);font-size:13px}',
      '.android-personal-history-controls .android-history-fallback-input{box-sizing:border-box;width:90px;height:38px;padding:0 8px;border:1px solid rgba(var(--v-border-color),.52);border-radius:6px;background:transparent;color:rgb(var(--v-theme-on-surface));font:inherit}',
      '.android-personal-history-controls .android-history-refresh,.android-personal-log-download-addon button{height:38px;min-width:72px;padding:0 14px;border:0;border-radius:6px;background:rgb(var(--v-theme-primary));color:rgb(var(--v-theme-on-primary,#fff));font:inherit;cursor:pointer}',
      '.android-personal-history-controls .android-history-refresh:disabled,.android-personal-log-download-addon button:disabled{opacity:.58;cursor:default}',
      '.android-personal-history-status{width:100%;font-size:12px;color:rgba(var(--v-theme-on-surface),.62);text-align:right;min-height:16px}',
      '.android-personal-log-download-addon{display:flex;flex-direction:column;gap:10px;width:min(100%,420px);margin:16px auto 0;box-sizing:border-box}',
      '.android-personal-log-download-addon select{box-sizing:border-box;width:100%;height:42px;padding:0 10px;border:1px solid rgba(var(--v-border-color),.52);border-radius:6px;background:transparent;color:rgb(var(--v-theme-on-surface));font:inherit}',
      '.android-personal-log-download-addon .android-personal-log-download-status{min-height:20px;color:rgba(var(--v-theme-on-surface),.72);font-size:13px;text-align:center}',
      '.android-personal-log-download-addon .android-personal-log-share{align-self:stretch;background:rgb(var(--v-theme-info))}',
      '.android-personal-log-download-addon .android-personal-log-open-dir{align-self:stretch;background:#b7d94b;color:#17310d}',
      '.android-personal-log-download-addon select option{background:rgb(var(--v-theme-surface));color:rgb(var(--v-theme-on-surface))}',
      '@media (orientation:landscape) and (max-height:500px){.android-personal-log-download-addon{gap:5px!important;margin-top:6px!important}.android-personal-log-download-addon select,.android-personal-log-download-addon button{height:34px!important;min-height:34px!important}.android-personal-log-download-addon .android-personal-log-download-status{min-height:14px!important;line-height:16px!important}}',
      '@media (max-width:600px) and (orientation:portrait){.android-personal-log-footer{display:grid!important;grid-template-columns:minmax(0,1fr) 64px!important;grid-template-rows:minmax(40px,auto) minmax(40px,auto)!important;align-items:center!important;column-gap:8px!important;row-gap:8px!important;min-height:88px!important}.android-personal-log-footer>.android-personal-log-composer{grid-column:1 / -1!important;grid-row:1!important;width:100%!important;max-width:100%!important;flex:none!important}.android-personal-log-footer>.v-col{grid-column:1 / -1!important;grid-row:2!important;display:grid!important;grid-template-columns:minmax(0,1fr) 64px!important;column-gap:8px!important;width:100%!important;max-width:100%!important;flex:none!important;align-items:center!important}.android-personal-log-footer>.v-col>.v-input.v-number-input{grid-column:1!important;grid-row:1!important;justify-self:end!important}.android-personal-log-footer>.v-col>.v-btn{grid-column:2!important;grid-row:1!important;justify-self:stretch!important}.android-personal-log-composer{flex-basis:auto!important;width:100%!important;margin:0!important}.android-personal-log-composer input{min-width:0!important}.android-personal-log-status{inset-inline-start:0!important;inset-block-end:-16px!important;display:block!important;visibility:hidden!important}.android-personal-log-status:not(:empty){visibility:visible!important}}',
      /* Fallback rules for the old icon-strip configuration.  The main
         dmp-setting-compat.css supplies the full theme-aware rules; these
         selectors merely ensure that a newly stamped DOM cannot collapse to
         the upstream desktop block layout during the first render frame. */
      'body.dmp-android-mod-config-enabled .android-personal-mod-shell{display:flex!important;flex-direction:column!important;min-width:0!important;overflow:hidden!important}',
      'body.dmp-android-mod-config-enabled .android-personal-mod-layout{display:flex!important;flex-direction:column!important;min-width:0!important;gap:10px!important}',
      'body.dmp-android-mod-config-enabled .android-personal-mod-picker{order:2!important;display:flex!important;min-width:0!important;width:100%!important;height:92px!important;overflow:hidden!important}',
      'body.dmp-android-mod-config-enabled .android-personal-mod-strip{display:flex!important;gap:10px!important;width:100%!important;height:100%!important;overflow:auto hidden!important}',
      'body.dmp-android-mod-config-enabled .android-personal-mod-tile{display:grid!important;place-items:center!important;flex:0 0 76px!important;width:76px!important;height:76px!important;padding:4px!important;border:2px solid transparent!important;border-radius:16px!important;background:rgba(var(--v-theme-on-surface),.05)!important;overflow:hidden!important}',
      'body.dmp-android-mod-config-enabled .android-personal-mod-tile.selected{border-color:rgb(var(--v-theme-primary))!important;box-shadow:0 0 0 3px rgba(var(--v-theme-primary),.16),0 7px 18px rgba(var(--v-theme-primary),.22)!important}',
      'body.dmp-android-mod-config-enabled .android-personal-mod-tile img,body.dmp-android-mod-config-enabled .android-personal-mod-tile .v-img{width:100%!important;height:100%!important;object-fit:cover!important;margin:0!important}',
      '@media (orientation:landscape) and (min-width:600px){body.dmp-android-mod-config-enabled .android-personal-mod-layout{flex-direction:row!important;align-items:stretch!important}body.dmp-android-mod-config-enabled .android-personal-mod-picker{order:0!important;flex:0 0 96px!important;width:96px!important;height:auto!important}body.dmp-android-mod-config-enabled .android-personal-mod-strip{flex-direction:column!important;overflow:hidden auto!important}body.dmp-android-mod-config-enabled .android-personal-mod-tile{flex-basis:78px!important;width:78px!important;height:78px!important}}'
    ].join('\n')
    document.head.appendChild(style)
  }

  function closest (node, selector) {
    if (!node) return null
    if (node.closest) return node.closest(selector)
    while (node && node.nodeType === 1) {
      var matcher = node.matches || node.msMatchesSelector || node.webkitMatchesSelector
      if (matcher && matcher.call(node, selector)) return node
      node = node.parentElement
    }
    return null
  }

  function logPage () {
    return /^\/logs\/(?:game|chat)(?:\/|$)/i.test(routePath())
  }

  function logDownloadPage () {
    return /^\/logs\/download(?:\/|$)/i.test(routePath())
  }

  function historyLineLimit () {
    var value = Number(window.__dmpHistoryLineLimit || 300)
    if (!isFinite(value) || value <= 0) value = 300
    return Math.max(50, Math.min(5000, Math.floor(value)))
  }

  function setHistoryLineLimit (value) {
    var normalized = Number(value)
    if (!isFinite(normalized) || normalized <= 0) normalized = 300
    normalized = Math.max(50, Math.min(5000, Math.floor(normalized)))
    window.__dmpHistoryLineLimit = normalized
    try { localStorage.setItem('dmp-history-line-limit', String(normalized)) } catch (ignored) {}
    return normalized
  }

  function historyCardForLog () {
    if (!logPage()) return null
    /* The two log tabs are VWindowItems.  On the first render only the
       current item is mounted, and after switching tabs Vuetify may keep an
       inactive item in the DOM.  Looking for "two selects" is not a safe
       discriminator: the VWindow container can expose the hidden history
       selectors through the current card, which caused our extra row to be
       appended below the current log.  Resolve the history card from its own
       header instead and return null until that tab is actually mounted. */
    var headers = document.querySelectorAll('.card-header')
    for (var i = 0; i < headers.length; i += 1) {
      var header = headers[i]
      var title = text(header && header.textContent).replace(/\s+/g, ' ').trim()
      if (!/历史日志|历史|history/i.test(title)) continue
      var card = closest(header, '.v-card')
      if (card) return card
    }
    return null
  }

  function trimHistoryDom (card) {
    if (!card) return
    var limit = historyLineLimit()
    var nodes = card.querySelectorAll('.mdp pre,.mdp code,.md-editor-preview pre,.md-editor-preview code')
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i]
      if (!node) continue
      /* Keep an untouched copy.  The old implementation replaced the code
         block with the last N lines, so increasing the number afterwards
         could never restore the lines that had already been discarded. */
      var currentText = text(node.textContent)
      var markerPattern = /^\[Android\] 已限制显示最近 \d+ 行（原日志仍保留在服务器）\n/
      /* A file selection/refresh may reuse the same <pre> element.  When Vue
         writes a new unmarked response, replace the saved source as well;
         otherwise the previous file would keep reappearing after a limit
         change. */
      if (typeof node.__androidHistoryOriginalText !== 'string'
          || (!markerPattern.test(currentText)
            && typeof node.__androidHistoryRenderedText === 'string'
            && node.__androidHistoryRenderedText !== currentText
            && node.__androidHistoryOriginalText !== currentText)) {
        var initial = currentText
        initial = initial.replace(markerPattern, '')
        node.__androidHistoryOriginalText = initial
      }
      if (node.__androidHistoryTrimmed === limit) continue
      var lines = node.__androidHistoryOriginalText.split(/\r?\n/)
      var nextText = lines.length <= limit
        ? node.__androidHistoryOriginalText
        : '[Android] 已限制显示最近 ' + limit + ' 行（原日志仍保留在服务器）\n'
          + lines.slice(Math.max(0, lines.length - limit)).join('\n')
      if (node.textContent !== nextText) node.textContent = nextText
      node.__androidHistoryRenderedText = nextText
      node.__androidHistoryTrimmed = limit
    }
  }

  function triggerHistoryFileRefresh (card) {
    if (!card) return false
    var inputs = card.querySelectorAll('.v-select input')
    var target = null
    for (var i = 0; i < inputs.length; i += 1) {
      if (text(inputs[i].value).trim()) target = inputs[i]
    }
    if (!target) return false
    try {
      /* VSelect's update handler calls the history-content request even when
         the selected filename stays the same.  Re-dispatching both events is
         less invasive than reaching into Vue's private component instance. */
      target.dispatchEvent(new Event('input', { bubbles: true }))
      target.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    } catch (ignored) { return false }
  }

  function decorateHistoryControls () {
    if (!logPage() || !document.body) return
    var card = historyCardForLog()
    /* A route transition can leave a history-control block on the current
       card from an earlier frame.  Remove only blocks whose owning card is
       not the actual history card; official current-log controls are not
       marked with this class and remain untouched. */
    var stamped = document.querySelectorAll('.android-personal-history-controls')
    for (var stampedIndex = 0; stampedIndex < stamped.length; stampedIndex += 1) {
      var stampedNode = stamped[stampedIndex]
      var stampedCard = closest(stampedNode, '.v-card')
      if (!card || stampedCard !== card) {
        if (stampedNode && stampedNode.parentNode) stampedNode.parentNode.removeChild(stampedNode)
      }
    }
    if (!card) return
    card.classList.add('android-personal-history-card')
    /* The current-log card owns the official line-count input and refresh
       button.  The history card only has the world/file selectors in the
       upstream bundle, so copy that official control column here.  Cloning
       the source markup keeps the Vuetify number field, stepper arrows, and
       button appearance identical; the clone receives small DOM listeners
       because it is outside Vue's render tree. */
    var textHost = card.querySelector('.v-card-text') || card
    var controls = textHost.querySelector('.android-personal-history-controls')
    if (!controls) {
      controls = document.createElement('div')
      controls.className = 'v-row my-4 android-personal-history-controls'
      controls.setAttribute('data-android-history-controls', '1')

      var sourceFooter = footerForLog()
      var sourceCol = sourceFooter && sourceFooter.querySelector('.v-col')
      var clonedCol = sourceCol ? sourceCol.cloneNode(true) : null
      var input = clonedCol && clonedCol.querySelector(
        '.v-number-input input,input[inputmode="decimal"]'
      )
      var refresh = null
      if (clonedCol) {
        /* Avoid duplicate input IDs/label references after cloning the Vue
           subtree.  The history clone is not Vue-owned, but duplicate IDs can
           still confuse accessibility services and automated taps. */
        if (input) {
          var inputId = 'android-history-line-' + String(Date.now())
          var inputLabelId = inputId + '-label'
          input.id = inputId
          input.setAttribute('aria-labelledby', inputLabelId)
          var labels = clonedCol.querySelectorAll('label')
          for (var labelIndex = 0; labelIndex < labels.length; labelIndex += 1) {
            labels[labelIndex].id = inputLabelId
            labels[labelIndex].setAttribute('for', inputId)
          }
          input.value = String(historyLineLimit())
          input.setAttribute('value', input.value)
        }
        var clonedButtons = clonedCol.querySelectorAll('button')
        for (var buttonIndex = 0; buttonIndex < clonedButtons.length; buttonIndex += 1) {
          var candidate = clonedButtons[buttonIndex]
          if (!candidate.hasAttribute('data-testid') && !refresh) refresh = candidate
        }
        if (refresh) refresh.classList.add('android-history-refresh')
        controls.appendChild(clonedCol)
      }

      /* A first-render race can briefly occur before the current footer exists.
         Keep a minimal fallback for that frame; the next mutation pass replaces
         it with the official cloned column once the source footer is mounted. */
      if (!input || !refresh) {
        controls.textContent = ''
        var fallbackCol = document.createElement('div')
        fallbackCol.className = 'v-col d-flex align-center justify-end'
        input = document.createElement('input')
        input.type = 'number'
        input.min = '50'
        input.max = '5000'
        input.step = '50'
        input.inputMode = 'numeric'
        input.className = 'android-history-fallback-input'
        input.value = String(historyLineLimit())
        input.setAttribute('aria-label', '历史日志显示行数')
        refresh = document.createElement('button')
        refresh.type = 'button'
        refresh.className = 'v-btn v-btn--elevated v-theme--dark bg-primary'
        refresh.classList.add('android-history-refresh')
        refresh.textContent = '刷新'
        refresh.setAttribute('aria-label', '刷新历史日志')
        fallbackCol.appendChild(input)
        fallbackCol.appendChild(refresh)
        controls.appendChild(fallbackCol)
      }
      textHost.appendChild(controls)

      var syncHistoryInput = function () {
        input.value = String(setHistoryLineLimit(input.value))
        trimHistoryDom(card)
      }
      input.addEventListener('input', syncHistoryInput)
      input.addEventListener('change', syncHistoryInput)

      var stepButtons = controls.querySelectorAll('button[data-testid]')
      for (var stepIndex = 0; stepIndex < stepButtons.length; stepIndex += 1) {
        stepButtons[stepIndex].addEventListener('click', (function (stepButton) {
          return function () {
            /* The cloned Vuetify field can survive a route/render pass one
               frame longer than the shared value in window/localStorage.
               Prefer the number that is visibly in this field so one tap
               changes 300 to 299 (rather than applying a stale 60/50). */
            var current = Number(text(input.value).trim())
            if (!isFinite(current) || current <= 0) current = historyLineLimit()
            var next = current + (stepButton.getAttribute('data-testid') === 'increment' ? 1 : -1)
            input.value = String(setHistoryLineLimit(next))
            trimHistoryDom(card)
          }
        })(stepButtons[stepIndex]))
      }
      refresh.addEventListener('click', function () {
        input.value = String(setHistoryLineLimit(input.value))
        var refreshed = triggerHistoryFileRefresh(card)
        trimHistoryDom(card)
        refresh.setAttribute('data-refresh-result', refreshed ? 'success' : 'no-file')
        refresh.setAttribute('title', refreshed
          ? '已按最近 ' + input.value + ' 行刷新'
          : '请选择历史日志文件')
      })
    }

    /* Vue appends/recreates the markdown editor after the first compatibility
       pass.  Keep the cloned row after the actual log body so the controls
       remain a footer instead of jumping above the log on the next render. */
    var editor = textHost.querySelector('.md-editor.mdp,.md-editor-preview,.mdp')
    if (editor && editor.parentNode === textHost && editor.nextElementSibling !== controls) {
      editor.parentNode.insertBefore(controls, editor.nextSibling)
    } else if (!controls.parentNode) {
      textHost.appendChild(controls)
    }

    var lineInput = controls.querySelector('input')
    if (lineInput && document.activeElement !== lineInput) {
      /* A route transition can leave the clone showing the last committed
         number while the shared value still belongs to an earlier render.
         Reconcile from the visible field before trimming; otherwise the next
         step can unexpectedly jump (for example, 300 -> 59). */
      var visibleLimit = Number(text(lineInput.value).trim())
      if (isFinite(visibleLimit) && visibleLimit > 0
          && Math.floor(visibleLimit) !== historyLineLimit()) {
        setHistoryLineLimit(visibleLimit)
      }
      lineInput.value = String(historyLineLimit())
    }
    trimHistoryDom(card)
  }

  function nativeTransferSnapshot () {
    if (!window.AndroidDmp || typeof window.AndroidDmp.getNativeTransferTasks !== 'function') return []
    try {
      var value = JSON.parse(window.AndroidDmp.getNativeTransferTasks() || '[]')
      return Array.isArray(value) ? value : []
    } catch (ignored) { return [] }
  }

  function isLogTransfer (task) {
    if (!task) return false
    if (String(task.kind || '').toLowerCase() === 'logs') return true
    var url = text(task.url || '').toLowerCase()
    var name = text(task.name || '').toLowerCase()
    return /\/logs\/download(?:[/?]|$)/.test(url)
      || /^logs(?:\(|\d|[-_]|\.)/.test(name)
      || name.indexOf('日志') >= 0
  }

  function transferSuccessful (task) {
    var value = text(task && (task.status || task.stage)).toLowerCase()
    return /^(success|complete|completed|done)$/.test(value)
  }

  /* The log-page compatibility controls must never remain inside the global
     download panel.  The panel survives route changes, while the log page
     itself is recreated, so a route transition can otherwise leave the log
     selector/share/clear controls visible in the normal download card. */
  function removeGlobalLogDownloadAddons () {
    if (!document || !document.querySelectorAll) return
    var nodes = document.querySelectorAll(
      '#android-dmp-mobile-download-panel .android-personal-log-download-addon,' +
      '#android-dmp-mobile-download-anchor .android-personal-log-download-addon,' +
      '#android-dmp-mobile-download-centre .android-personal-log-download-addon')
    for (var index = 0; index < nodes.length; index += 1) {
      var node = nodes[index]
      if (node && node.parentNode) node.parentNode.removeChild(node)
    }
  }

  function decorateLogDownload () {
    /* Always clean first, including when this function is reached during a
       route transition before the new log page is fully mounted. */
    removeGlobalLogDownloadAddons()
    if (!logDownloadPage() || !document.body) {
      if (logDownloadRefreshTimer) {
        window.clearInterval(logDownloadRefreshTimer)
        logDownloadRefreshTimer = 0
      }
      return
    }
    /* The top-bar download control is also rendered as a `.v-card` while a
       route transition is settling.  A previous fallback could therefore
       mount the log selector/share/clear controls into the global download
       anchor, making them appear as stray buttons in the upper-right corner.
       Remove any stale mount and never use those containers as a log card. */
    /* Result.vue can wrap the visible card in another v-card (and Vuetify
       adds layout cards around it on tablets).  The old `cards[0]` choice
       therefore mounted the addon into an invisible wrapper.  Locate the
       card that actually owns the download button first, then fall back to a
       card containing the page title. */
    var cards = document.querySelectorAll('.v-card')
    var card = null
    var originalButton = null
    /* The 3.2 download chunk normally renders the text "下载", but a
       compact/tablet render can collapse that label and leave only the
       download icon.  Keep the selector semantic rather than relying on one
       locale or on Vuetify's generated class names. */
    var isDownloadButton = function (button) {
      if (!button) return false
      if (/下载|download/i.test(buttonText(button))) return true
      var icon = button.querySelector && button.querySelector(
        'i.ri-download-2-line,i.ri-download-line,i.ri-download-cloud-2-line,i[class*="download"]')
      return !!icon
    }
    /* The result component can briefly mount the button outside a `.v-card`
       while a route transition is settling.  A delegated capture fallback
       keeps that first tap from falling through to the desktop Blob helper;
       once the normal decoration pass owns the button, the fallback leaves
       it alone and the per-button listener below remains authoritative. */
    if (!document.__androidLogDownloadDelegation) {
      document.__androidLogDownloadDelegation = true
      document.addEventListener('click', function (event) {
        if (!logDownloadPage() || !event || !event.target) return
        var target = event.target.closest
          ? event.target.closest('button,[role="button"]') : null
        if (!target) return
        /*
         * The result card is rendered by Vue and can replace its subtree
         * after the addon has been mounted.  In that case the listener that
         * was attached directly to the clear button goes away with the old
         * node, even though the replacement button still looks identical.
         * Keep a delegated capture handler for the clear action so cleanup is
         * reliable across route/data re-renders.
         */
        var clearTarget = target.closest('.android-personal-log-open-dir')
        if (clearTarget) {
          if (clearTarget.closest(
            '.layout-navbar,#android-dmp-mobile-download-panel,' +
            '#android-dmp-mobile-download-anchor,#android-dmp-mobile-download-centre')) return
          event.preventDefault()
          event.stopImmediatePropagation()
          var clearAddon = clearTarget.closest('.android-personal-log-download-addon')
          var clearStatus = clearAddon
            ? clearAddon.querySelector('.android-personal-log-download-status') : null
          var accepted = false
          if (!window.AndroidDmp || typeof window.AndroidDmp.clearDownloadedLogs !== 'function') {
            if (clearStatus) clearStatus.textContent = '当前版本不支持清理下载日志'
            return
          }
          try { accepted = window.AndroidDmp.clearDownloadedLogs() !== false } catch (ignored) {}
          if (clearStatus) clearStatus.textContent = accepted ? '已清理下载日志' : '清理下载日志失败'
          if (accepted) {
            logDownloadLastSignature = ''
            window.setTimeout(refreshAllLogDownloadOptions, 80)
          }
          return
        }
        if (target.__androidLogDownloadCapture || !isDownloadButton(target)) return
        // The navbar/global download button is not the log-download action.  It
        // can share the generic download icon/text while the Vue log card is
        // still mounting, so keep this delegated fallback scoped to the card.
        if (target.closest(
          '.layout-navbar,#android-dmp-mobile-download-panel,' +
          '#android-dmp-mobile-download-anchor,#android-dmp-mobile-download-centre')) return
        if (!window.AndroidDmp || typeof window.AndroidDmp.downloadFile !== 'function') return
        event.preventDefault()
        event.stopImmediatePropagation()
        var id = roomId()
        if (!id) return
        try {
          window.AndroidDmp.downloadFile('/logs/download?roomID=' + encodeURIComponent(id), 'logs.zip')
        } catch (ignored) {}
      }, true)
    }
    for (var cardIndex = 0; cardIndex < cards.length && !card; cardIndex += 1) {
      var candidate = cards[cardIndex]
      if (candidate.closest && candidate.closest(
        '#android-dmp-mobile-download-panel,#android-dmp-mobile-download-anchor,' +
        '#android-dmp-mobile-download-centre')) continue
      var candidateButtons = candidate.querySelectorAll('button,[role="button"]')
      for (var candidateButtonIndex = 0;
           candidateButtonIndex < candidateButtons.length;
           candidateButtonIndex += 1) {
        if (isDownloadButton(candidateButtons[candidateButtonIndex])) {
          card = candidate
          originalButton = candidateButtons[candidateButtonIndex]
          break
        }
      }
    }
    if (!card) {
      for (var titleCardIndex = 0; titleCardIndex < cards.length; titleCardIndex += 1) {
        if (cards[titleCardIndex].closest && cards[titleCardIndex].closest(
          '#android-dmp-mobile-download-panel,#android-dmp-mobile-download-anchor,' +
          '#android-dmp-mobile-download-centre')) continue
        if (/(?:日志下载|下载日志|log\s*download|download\s*logs?)/i.test(
          text(cards[titleCardIndex].textContent))) {
          card = cards[titleCardIndex]
          break
        }
      }
    }
    /* If Vuetify has not wrapped the result in a card yet, still bind the
       route's download control.  The next mutation pass will move the addon
       into the eventual card without losing the capture listener. */
    if (!card) {
      var pageButtons = document.querySelectorAll('button,[role="button"]')
      for (var pageButtonIndex = 0; pageButtonIndex < pageButtons.length; pageButtonIndex += 1) {
        if (!isDownloadButton(pageButtons[pageButtonIndex])) continue
        if (pageButtons[pageButtonIndex].closest && pageButtons[pageButtonIndex].closest(
          '#android-dmp-mobile-download-panel,#android-dmp-mobile-download-anchor,' +
          '#android-dmp-mobile-download-centre')) continue
        originalButton = pageButtons[pageButtonIndex]
        card = originalButton.closest('.v-card') || originalButton.parentElement
        break
      }
    }
    if (!card) return
    var textHost = card.querySelector('.v-card-text') || card
    if (!textHost) return
    /* Result.vue puts the title, description and original button inside a
       fixed-height flex container.  Appending after that container can be
       clipped by the card's overflow rules, which is why the first version
       of the selector/share controls was invisible on both phone and tablet.
       Mount inside the actual Result content when available. */
    var addonHost = textHost.querySelector(
      '.v-container .d-flex.flex-column, .v-container > .d-flex, .d-flex.flex-column')
      || textHost
    if (!originalButton) {
      var buttons = card.querySelectorAll('button,[role="button"]')
      for (var i = 0; i < buttons.length; i += 1) {
        if (isDownloadButton(buttons[i])) {
          originalButton = buttons[i]
          break
        }
      }
    }
    if (originalButton && !originalButton.__androidLogDownloadCapture) {
      originalButton.__androidLogDownloadCapture = true
      originalButton.addEventListener('click', function (event) {
        if (!window.AndroidDmp || typeof window.AndroidDmp.downloadFile !== 'function') return
        event.preventDefault()
        event.stopImmediatePropagation()
        var id = roomId()
        var status = textHost.querySelector('.android-personal-log-download-status')
        if (!id) {
          if (status) status.textContent = '未找到当前房间'
          return
        }
        try {
          window.AndroidDmp.downloadFile('/logs/download?roomID=' + encodeURIComponent(id), 'logs.zip')
          if (status) status.textContent = '日志下载已提交'
          window.setTimeout(function () { refreshLogDownloadOptions(textHost) }, 700)
        } catch (ignored) {
          if (status) status.textContent = '日志下载失败'
        }
      }, true)
    }
    var addon = card.querySelector('.android-personal-log-download-addon')
    if (!addon) {
      addon = document.createElement('div')
      addon.className = 'android-personal-log-download-addon'
      addon.setAttribute('data-android-log-download-addon', '1')
      var statusText = document.createElement('div')
      statusText.className = 'android-personal-log-download-status'
      statusText.setAttribute('aria-live', 'polite')
      var select = document.createElement('select')
      select.className = 'android-personal-log-download-select'
      select.setAttribute('aria-label', '选择已下载日志')
      var share = document.createElement('button')
      share.type = 'button'
      share.className = 'android-personal-log-share'
      share.textContent = '分享'
      var clearLogs = document.createElement('button')
      clearLogs.type = 'button'
      clearLogs.className = 'android-personal-log-open-dir'
      clearLogs.textContent = '清理下载日志'
      addon.appendChild(statusText)
      addon.appendChild(select)
      addon.appendChild(share)
      addon.appendChild(clearLogs)
      addonHost.appendChild(addon)
      share.addEventListener('click', function () {
        var selected = select.value
        if (!selected || !window.AndroidDmp
            || typeof window.AndroidDmp.shareNativeTransfer !== 'function') {
          statusText.textContent = '请选择已下载日志'
          return
        }
        var accepted = false
        try { accepted = window.AndroidDmp.shareNativeTransfer(selected) !== false } catch (ignored) {}
        if (!accepted && typeof window.AndroidDmp.shareDownloadedLog === 'function') {
          try { accepted = window.AndroidDmp.shareDownloadedLog(selected) !== false } catch (ignored) {}
        }
        statusText.textContent = accepted ? '正在打开系统分享' : '日志尚未下载完成'
      })
      clearLogs.addEventListener('click', function () {
        if (!window.AndroidDmp || typeof window.AndroidDmp.clearDownloadedLogs !== 'function') {
          statusText.textContent = '当前版本不支持清理下载日志'
          return
        }
        var accepted = false
        try { accepted = window.AndroidDmp.clearDownloadedLogs() !== false } catch (ignored) {}
        statusText.textContent = accepted ? '已清理下载日志' : '清理下载日志失败'
        if (accepted) {
          /* Re-scan immediately so the selector drops files without waiting
             for the periodic task refresh. */
          logDownloadLastSignature = ''
          window.setTimeout(refreshAllLogDownloadOptions, 80)
        }
      })
    }
    refreshLogDownloadOptions(textHost)
    if (!logDownloadRefreshTimer) {
      logDownloadRefreshTimer = window.setInterval(function () {
        if (logDownloadPage()) refreshAllLogDownloadOptions()
        else {
          window.clearInterval(logDownloadRefreshTimer)
          logDownloadRefreshTimer = 0
        }
      }, 1500)
    }
  }

  function refreshLogDownloadOptions (textHost) {
    if (!textHost) return
    var addon = textHost.querySelector('.android-personal-log-download-addon')
    if (!addon) return
    var select = addon.querySelector('select')
    var status = addon.querySelector('.android-personal-log-download-status')
    var share = addon.querySelector('.android-personal-log-share')
    if (!select) return
    var tasks = []
    if (window.AndroidDmp && typeof window.AndroidDmp.getDownloadedLogFiles === 'function') {
      try {
        var raw = JSON.parse(window.AndroidDmp.getDownloadedLogFiles() || '[]')
        if (Array.isArray(raw)) tasks = raw
      } catch (ignored) {}
    }
    var signature = tasks.map(function (task) {
      return text(task.id) + ':' + text(task.name) + ':' + text(task.size)
        + ':' + text(task.modifiedAt)
    }).join('|')
    /* Multiple result/card wrappers can exist briefly during a Vue route
       transition.  A shared signature is still useful to avoid rebuilding
       every selector on each timer tick, but only skip a rebuild when this
       particular selector already contains the same task list. */
    var selectorMatchesTasks = tasks.length === 0
      ? (select.options.length === 1 && text(select.options[0].value || '') === '')
      : select.options.length === tasks.length && tasks.every(function (task, index) {
          return text(select.options[index].value || '') === text(task.name || task.id)
        })
    if (signature === logDownloadLastSignature && selectorMatchesTasks) return
    logDownloadLastSignature = signature
    var previous = select.value
    while (select.firstChild) select.removeChild(select.firstChild)
    if (!tasks.length) {
      var empty = document.createElement('option')
      empty.value = ''
      empty.textContent = '未下载日志'
      select.appendChild(empty)
      select.disabled = true
      if (share) share.disabled = true
      if (status && !text(status.textContent).trim()) status.textContent = '未下载日志'
      return
    }
    select.disabled = false
    tasks.forEach(function (task) {
      var option = document.createElement('option')
      /* The native file scanner returns the basename in name.  Keep that as
         the selector value so a file that survived a WebView recreation (or
         was copied into the shared directory by a file manager) remains
         shareable even when no DownloadManager row is available. */
      option.value = text(task.name || task.id)
      option.textContent = text(task.name || '日志文件')
      select.appendChild(option)
    })
    if (previous && tasks.some(function (task) {
      return text(task.name || task.id) === previous
    })) {
      select.value = previous
    }
    if (share) share.disabled = !select.value
    if (status && /未下载日志/.test(status.textContent)) status.textContent = ''
  }

  function refreshAllLogDownloadOptions () {
    if (!document || !document.querySelectorAll) return
    var addons = document.querySelectorAll('.android-personal-log-download-addon')
    for (var index = 0; index < addons.length; index += 1) {
      var addon = addons[index]
      var host = addon && (addon.parentElement || addon)
      if (host) refreshLogDownloadOptions(host)
    }
  }

  function logType () {
    return /\/logs\/chat(?:\/|$)/i.test(routePath()) ? 'announce' : 'systemMsg'
  }

  function buttonText (button) {
    return text(button && (button.getAttribute('aria-label') || button.textContent)).replace(/\s+/g, ' ').trim()
  }

  function footerForLog () {
    var currentRoute = routePath()
    if (cachedLogFooter && cachedLogFooterRoute === currentRoute
        && document.documentElement.contains(cachedLogFooter)) {
      return cachedLogFooter
    }
    cachedLogFooter = null
    cachedLogFooterRoute = currentRoute
    var rows = document.querySelectorAll('.v-row')
    var first = null
    for (var i = 0; i < rows.length; i += 1) {
      var row = rows[i]
      /* The history tab now has a cloned refresh row.  Never mistake that
         compatibility row for the official current-log footer when Vue
         temporarily detaches the current tab during a route transition. */
      if (closest(row, '.android-personal-history-controls')) continue
      var buttons = row.querySelectorAll('button,[role="button"]')
      var hasPull = false
      for (var j = 0; j < buttons.length; j += 1) {
        if (/拉取|刷新|pull|refresh/i.test(buttonText(buttons[j]))) { hasPull = true; break }
      }
      if (!hasPull) continue
      if (!first) first = row
      /* /logs/game has current + history panels.  The current panel is the
         one whose nearest card header says 当前/current. */
      var ancestor = row
      for (var depth = 0; depth < 8 && ancestor; depth += 1, ancestor = ancestor.parentElement) {
        var header = ancestor.querySelector && ancestor.querySelector('.card-header')
        var title = text(header && header.textContent)
        if (/当前|current/i.test(title) && !/历史|history/i.test(title)) {
          cachedLogFooter = row
          return row
        }
      }
    }
    cachedLogFooter = first
    return first
  }

  /* The current 3.2 log chunk recalculates the line-count model whenever the
     viewport resizes.  The old mobile singleLog initialized that value once
     and kept the user's number while rotating or opening the keyboard.  Keep
     the DOM input/model stable across those resize passes without replacing
     Vuetify's own number-input controls. */
  function stabilizeLogLineCount (footer) {
    if (!footer) return
    /* The upgraded singleLog component starts its v-model at 0 and fills in
       the viewport-derived default on mounted.  Treat that transient zero as
       "not initialized"; otherwise the first DOM pass would remember 0 and
       our restore hook would keep writing it back after every resize/rotation.
       A line count of zero is not a useful request to the log API, so only a
       finite positive number is eligible for persistence. */
    var validLineValue = function (value) {
      var normalized = text(value).trim()
      if (!normalized) return false
      var parsed = Number(normalized)
      return isFinite(parsed) && parsed > 0
    }
    var findInput = function () {
      return footer.querySelector('.v-number-input input, input[inputmode="decimal"]')
    }
    var rememberInput = function (input) {
      if (!input) return
      if (!validLineValue(footer.__androidLogLineValue)) {
        /* Vuetify may expose the initial v-model only as aria-valuenow or a
           value attribute for one render frame.  Read all three forms before
           the resize watcher has a chance to replace the element. */
        var initialCandidates = [
          text(input.value).trim(),
          text(input.getAttribute('value')).trim(),
          text(input.getAttribute('aria-valuenow')).trim()
        ]
        for (var initialIndex = 0; initialIndex < initialCandidates.length; initialIndex += 1) {
          if (!validLineValue(initialCandidates[initialIndex])) continue
          footer.__androidLogLineValue = initialCandidates[initialIndex]
          break
        }
      }
      if (input === footer.__androidLogLineInput) return
      footer.__androidLogLineInput = input
      var onValue = function () {
        /* A restore dispatches input/change deliberately to update Vue's
           v-model.  Do not mistake that synthetic event for a user edit. */
        if (footer.__androidLogLineRestoring) return
        var value = text(input.value).trim()
        if (validLineValue(value)) footer.__androidLogLineValue = value
      }
      input.addEventListener('input', onValue)
      input.addEventListener('change', onValue)
    }
    /* Vuetify's VNumberInput stepper does not dispatch a native input/change
       event.  Its pointerdown handler updates the component model directly,
       so the DOM value can change without updating our remembered value.  A
       following MutationObserver pass would then restore the old value and
       make the up/down buttons look inert.  Read the value after Vue has
       flushed the model update instead; this is observation only, so it never
       applies a second increment. */
    var rememberVisibleValue = function () {
      var current = findInput()
      if (!current) return false
      rememberInput(current)
      var value = text(current.value).trim()
      if (!validLineValue(value)) return false
      footer.__androidLogLineValue = value
      return true
    }
    var finishStepperSync = function () {
      footer.__androidLogLineStepSyncTimer = 0
      if (rememberVisibleValue()) footer.__androidLogLineStepperPending = false
    }
    var scheduleStepperSync = function () {
      footer.__androidLogLineStepperPending = true
      if (footer.__androidLogLineStepSyncTimer) {
        window.clearTimeout(footer.__androidLogLineStepSyncTimer)
      }
      /* pointerdown is the event that VNumberInput uses to change the model;
         a zero-delay task runs after Vue's microtask render.  The animation
         frame is a fallback for WebView builds that defer that render. */
      footer.__androidLogLineStepSyncTimer = window.setTimeout(finishStepperSync, 0)
      raf(function () {
        if (footer.__androidLogLineStepperPending) finishStepperSync()
      })
    }
    var bindStepperButtons = function () {
      var buttons = footer.querySelectorAll(
        'button[data-testid="increment"],button[data-testid="decrement"]'
      )
      for (var buttonIndex = 0; buttonIndex < buttons.length; buttonIndex += 1) {
        var button = buttons[buttonIndex]
        if (!button || button.__androidLogLineStepperBound) continue
        button.__androidLogLineStepperBound = true
        button.addEventListener('pointerdown', scheduleStepperSync)
        button.addEventListener('mousedown', scheduleStepperSync)
        button.addEventListener('touchstart', scheduleStepperSync)
        button.addEventListener('click', scheduleStepperSync)
      }
    }
    var bindLineKeyboard = function (input) {
      if (!input || input.__androidLogLineKeyboardBound) return
      input.__androidLogLineKeyboardBound = true
      input.addEventListener('keydown', function (event) {
        if (!event) return
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown'
            || event.keyCode === 38 || event.keyCode === 40) {
          scheduleStepperSync()
        }
      })
    }
    var restore = function () {
      var current = findInput()
      rememberInput(current)
      bindLineKeyboard(current)
      bindStepperButtons()
      var value = text(footer.__androidLogLineValue).trim()
      if (!current || !validLineValue(value) || current.value === value) return
      footer.__androidLogLineRestoring = true
      current.value = value
      current.setAttribute('value', value)
      try {
        current.dispatchEvent(new Event('input', { bubbles: true }))
        current.dispatchEvent(new Event('change', { bubbles: true }))
      } catch (ignored) {}
      /* Vue's input handler is synchronous in the current bundle, but release
         the guard on a later frame for WebView builds that defer it. */
      raf(function () { footer.__androidLogLineRestoring = false })
    }
    var initialInput = findInput()
    rememberInput(initialInput)
    bindLineKeyboard(initialInput)
    bindStepperButtons()
    if (!footer.__androidLogLineResizeBound) {
      footer.__androidLogLineResizeBound = true
      footer.__androidLogRestoreLine = restore
      registerLogLineFooter(footer)
    }
    if (!footer.__androidLogLineMutationBound && window.MutationObserver) {
      footer.__androidLogLineMutationBound = true
      var observer = new MutationObserver(function () {
        bindStepperButtons()
        /* A stepper interaction is a user edit, not a viewport reset.  Let
           the post-render sync capture the new value before any restore can
           run.  For ordinary Vue renders keep the original restore behavior
           so route/model replacements still recover the remembered value. */
        if (footer.__androidLogLineStepperPending) {
          window.setTimeout(finishStepperSync, 0)
          return
        }
        /* Vue replaces the number input when its model changes.  Rebind and
           restore the remembered line count after that replacement rather
           than allowing the viewport-derived value to leak back in. */
        window.setTimeout(restore, 0)
      })
      observer.observe(footer, { childList: true, subtree: true })
      footer.__androidLogLineObserver = observer
    }
    window.setTimeout(restore, 0)
  }

  function postLogMessage (value, input, send, status) {
    var message = text(value).trim()
    if (!message || send.disabled) return
    var base = apiBase()
    var id = roomId()
    if (!base || id <= 0 || typeof window.fetch !== 'function') {
      if (status) status.textContent = '未找到当前房间'
      return
    }
    var headers = { 'Content-Type': 'application/json', 'X-I18n-Lang': 'zh' }
    var token = apiToken()
    if (token) headers['X-DMP-TOKEN'] = token
    send.disabled = true
    if (status) status.textContent = '发送中…'
    window.fetch(base + '/v3/dashboard/exec/game', {
      method: 'POST', headers: headers,
      body: JSON.stringify({ type: logType(), roomID: id, worldID: 0, extra: message })
    }).then(function (response) {
      if (!response || !response.ok) throw new Error('send')
      if (input) input.value = ''
      if (status) status.textContent = '已发送'
    }).catch(function () {
      if (status) status.textContent = '发送失败'
    }).then(function () {
      window.setTimeout(function () { if (status) status.textContent = '' }, 2200)
      send.disabled = false
    })
  }

  function decorateLogComposer () {
    if (!logPage() || !document.body) return
    var footer = footerForLog()
    if (!footer) return
    footer.classList.add('android-personal-log-footer')
    stabilizeLogLineCount(footer)
    var footerHost = footer.parentElement
    if (footerHost) footerHost.classList.add('android-personal-log-footer-host')
    var footerCard = closest(footer, '.v-card')
    if (footerCard) footerCard.classList.add('android-personal-log-card')
    var expectedType = logType()
    var existing = footer.querySelector('.android-personal-log-composer')
    if (existing) {
      /* Vue can reuse the log footer while switching /logs/game and
         /logs/chat.  Keep the restored composer in sync with that route
         instead of leaving a stale system-message control in the chat page. */
      if (existing.getAttribute('data-android-log-type') !== expectedType) {
        existing.setAttribute('data-android-log-type', expectedType)
        var existingInput = existing.querySelector('input')
        if (existingInput) {
          existingInput.placeholder = expectedType === 'announce'
            ? '发送游戏宣告' : '发送系统信息'
          existingInput.setAttribute('aria-label', existingInput.placeholder)
        }
      }
      return
    }
    var composer = document.createElement('div')
    composer.className = 'android-personal-log-composer'
    composer.setAttribute('data-android-personal-composer', '1')
    composer.setAttribute('data-android-log-type', expectedType)
    var input = document.createElement('input')
    input.type = 'text'
    input.autocomplete = 'off'
    input.placeholder = expectedType === 'announce' ? '发送游戏宣告' : '发送系统信息'
    input.setAttribute('aria-label', input.placeholder)
    var send = document.createElement('button')
    send.type = 'button'
    send.textContent = '发送'
    var status = document.createElement('span')
    status.className = 'android-personal-log-status'
    status.setAttribute('aria-live', 'polite')
    status.setAttribute('role', 'status')
    composer.appendChild(input)
    composer.appendChild(send)
    composer.appendChild(status)
    footer.insertBefore(composer, footer.firstChild || null)
    send.addEventListener('click', function () { postLogMessage(input.value, input, send, status) })
    input.addEventListener('keyup', function (event) {
      if (event.key === 'Enter' || event.keyCode === 13) postLogMessage(input.value, input, send, status)
    })
  }

  function decorateConfigLayout () {
    if (!settingEnabled() || !/^\/game\/mod(?:\/|$)/i.test(routePath())) return
    if (!document.body) return
    document.body.classList.add('dmp-android-mod-config-enabled')
    var rows = document.querySelectorAll('.v-row')
    for (var i = 0; i < rows.length; i += 1) {
      var row = rows[i]
      var columns = []
      for (var j = 0; j < row.children.length; j += 1) {
        var child = row.children[j]
        if (/\bv-col(?:-|\s|$)/.test(text(child.className))) columns.push(child)
      }
      if (columns.length < 2) continue
      var picker = null
      for (var k = 0; k < columns.length; k += 1) {
        if (columns[k].querySelector('.card-header') &&
            (columns[k].querySelector('.fcc,.w-33,.v-container'))) {
          picker = columns[k]
          break
        }
      }
      if (!picker) continue
      var detail = null
      for (var d = 0; d < columns.length; d += 1) {
        if (columns[d] !== picker) { detail = columns[d]; break }
      }
      if (!detail) continue
      var shell = row.parentElement || row
      shell.classList.add('mod-setting-shell', 'android-personal-mod-shell')
      row.classList.add('mod-config-layout', 'android-personal-mod-layout')
      picker.classList.add('mod-picker', 'android-personal-mod-picker')
      detail.classList.add('mod-detail')
      /* The setting chunk mounts the icon list in stages.  On the first
         frame only the card text exists, so an earlier pass used that card as
         the strip.  When Vue later mounted the real v-container, the stale
         card-level stamp made the whole list look like one tile (only the
         first icon remained visible).  Pick the descendant with the largest
         number of direct icon entries so the selector survives both render
         orders. */
      var card = picker.querySelector('.v-card')
      var cardText = card && card.querySelector('.v-card-text')
      var strip = null
      var bestCount = 0
      var isIconNode = function (node) {
        if (!node || node.nodeType !== 1) return false
        var matcher = node.matches || node.msMatchesSelector || node.webkitMatchesSelector
        if (matcher && matcher.call(node, '.fcc,.w-33,.v-img,img')) return true
        return !!(node.querySelector && node.querySelector('.fcc,.w-33,.v-img,img'))
      }
      var iconCount = function (node) {
        if (!node || !node.children) return 0
        var count = 0
        for (var ci = 0; ci < node.children.length; ci += 1) {
          var child = node.children[ci]
          if (!child || (child.classList && child.classList.contains('v-divider'))) continue
          if (isIconNode(child)) count += 1
        }
        return count
      }
      var candidates = []
      if (cardText) candidates.push(cardText)
      if (cardText) {
        var descendants = cardText.querySelectorAll('.v-container,.v-row,.v-card-text,.mod-icon-strip')
        for (var ci2 = 0; ci2 < descendants.length; ci2 += 1) candidates.push(descendants[ci2])
      }
      for (var candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
        var candidate = candidates[candidateIndex]
        var count = iconCount(candidate)
        if (count > bestCount) {
          bestCount = count
          strip = candidate
        }
      }
      if (!strip) strip = cardText || picker
      /* Clear a card-level stamp left by an early pass once a deeper strip
         has appeared.  Do not clear the canonical class when cardText itself
         is the actual list in older builds. */
      if (cardText && strip !== cardText) {
        cardText.classList.remove('mod-icon-strip', 'android-personal-mod-strip',
          'mod-icon-button', 'android-personal-mod-tile')
        cardText.removeAttribute('data-android-personal-tile')
      }
      strip.classList.remove('mod-icon-button', 'android-personal-mod-tile')
      strip.removeAttribute('data-android-personal-tile')
      strip.classList.add('mod-icon-strip', 'android-personal-mod-strip')
      var tiles = strip.children
      for (var t = 0; t < tiles.length; t += 1) {
        var tile = tiles[t]
        if (!tile || tile.classList.contains('v-divider')) continue
        var isTab = tile.matches && tile.matches('button,[role="tab"]')
        if (!isIconNode(tile) && !isTab) continue
        tile.classList.add('mod-icon-button', 'android-personal-mod-tile')
        if (tile.dataset.androidPersonalTile === '1') continue
        tile.dataset.androidPersonalTile = '1'
        tile.addEventListener('click', function () {
          /* Resolve the strip from the clicked tile.  Capturing the loop's
             `strip` variable causes every panel to clear the last panel's
             selection when Vue mounts more than one setting row. */
          var owner = this.parentElement
          var selected = owner
            ? owner.querySelectorAll('.android-personal-mod-tile.selected') : []
          for (var s = 0; s < selected.length; s += 1) selected[s].classList.remove('selected')
          this.classList.add('selected')
        })
      }
    }
  }

  /* Keep the official desktop TMI two-pane layout on a landscape tablet.
     Vuetify's `md` breakpoint is based on CSS pixels; some Android tablets
     report a width just below that breakpoint even though there is ample
     landscape space for the item catalogue and command panel side by side. */
  function decorateTmiLayout () {
    if (!document.body) return
    var path = routePath()
    var onTmi = /^\/tools\/tmi(?:\/|$)/i.test(path)
    var root = document.querySelector('.tmi-layout-root')
    if (!onTmi) {
      document.body.classList.remove('dmp-android-tmi-wide')
      if (root) root.classList.remove('tmi-layout-root')
      return
    }

    var landscape = false
    try {
      landscape = !!(window.matchMedia && window.matchMedia(
        '(orientation: landscape) and (min-width: 600px)'
      ).matches)
    } catch (ignored) {}

    /* A temporary Vuetify drawer is the menu overlay.  Do not force the
       desktop split while it is visibly open; the drawer gets the full
       gesture surface in that state.  Permanent desktop drawers are ignored. */
    var menuOpen = false
    var drawers = document.querySelectorAll('.v-navigation-drawer')
    for (var di = 0; di < drawers.length; di += 1) {
      var drawer = drawers[di]
      if (!drawer || !drawer.classList ||
          !drawer.classList.contains('v-navigation-drawer--temporary')) continue
      var drawerStyle = window.getComputedStyle ? window.getComputedStyle(drawer) : null
      var drawerRect = drawer.getBoundingClientRect ? drawer.getBoundingClientRect() : null
      var visible = drawerStyle && drawerStyle.display !== 'none' &&
        drawerStyle.visibility !== 'hidden' && drawerRect && drawerRect.width > 0 &&
        drawerRect.right > 0 && drawerRect.left < window.innerWidth
      if (visible && (drawer.classList.contains('v-navigation-drawer--active') ||
          drawer.getAttribute('aria-hidden') === 'false')) {
        menuOpen = true
        break
      }
    }
    document.body.classList.toggle('dmp-android-tmi-wide', landscape && !menuOpen)

    var grids = document.querySelectorAll('.items-grid')
    if (!grids.length) return
    for (var gi = 0; gi < grids.length; gi += 1) {
      var grid = grids[gi]
      var candidate = grid
      var row = null
      /* The item grid is nested in the first card.  Walk upward until the
         row whose direct children are the catalogue and command columns. */
      while (candidate && candidate !== document.body) {
        candidate = candidate.parentElement
        if (!candidate || !candidate.classList ||
            !candidate.classList.contains('v-row')) continue
        var directCols = 0
        for (var ci = 0; ci < candidate.children.length; ci += 1) {
          var child = candidate.children[ci]
          if (child.classList &&
              (child.classList.contains('v-col') ||
               text(child.className).indexOf('v-col-') >= 0)) directCols += 1
        }
        if (directCols >= 2) {
          row = candidate
          break
        }
      }
      if (row) row.classList.add('tmi-layout-root')
    }
  }

  function schedule () {
    if (schedule.pending) return
    schedule.pending = true
    raf(function () {
      schedule.pending = false
      pruneLogLineFooters()
      decorateTmiLayout()
      /* This panel is global and outlives every route.  Clean stale log-page
         controls before handling the current route so even a transition to
         another log tab cannot leave them in the global download card. */
      var onLogDownloadPage = logDownloadPage()
      removeGlobalLogDownloadAddons()
      if (!onLogDownloadPage && logDownloadRefreshTimer) {
        window.clearInterval(logDownloadRefreshTimer)
        logDownloadRefreshTimer = 0
      }
      /* Keep route-specific work out of the history renderer's hot mutation
         path.  md-editor-v3 can emit many subtree mutations while parsing a
         large file; scanning every config row on each frame made the page
         appear frozen even after the log body had been capped. */
      if (logPage()) {
        decorateLogComposer()
        decorateHistoryControls()
      } else if (onLogDownloadPage) {
        decorateLogDownload()
      } else if (/^\/game\/mod(?:\/|$)/i.test(routePath())) {
        decorateConfigLayout()
      } else {
        /* The global download panel survives route changes.  Remove any log
           compatibility addon as soon as the route leaves the log-download
           page, and stop its polling timer so it cannot repopulate the panel. */
        removeGlobalLogDownloadAddons()
      }
    })
  }

  function install () {
    if (!document.body) return
    try {
      var savedLimit = Number(localStorage.getItem('dmp-history-line-limit') || 300)
      window.__dmpHistoryLineLimit = isFinite(savedLimit) && savedLimit > 0 ? savedLimit : 300
    } catch (ignored) { window.__dmpHistoryLineLimit = 300 }
    installStyle()
    schedule()
    if (window.MutationObserver) {
      new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true })
    }
    window.addEventListener('hashchange', schedule)
    window.addEventListener('resize', schedule)
    window.addEventListener('orientationchange', schedule)
    window.setInterval(schedule, 500)
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true })
  else install()
})()
