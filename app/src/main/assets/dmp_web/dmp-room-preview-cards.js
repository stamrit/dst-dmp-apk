/*
 * Room preview cards for the Android WebView.
 *
 * The upstream dashboard keeps the mod details dialog at its desktop width
 * and renders the online-player summary as a passive tooltip.  Keep those
 * data flows untouched and adjust only the presentation here: the existing
 * mod dialog receives a compact class, while the player summary opens a small
 * themed card containing the names that are already visible in the summary.
 * This file deliberately has no LinuxDMP/API mutation code.
 */
(function () {
  'use strict'

  if (window.__dmpRoomPreviewCardsInstalled) return
  window.__dmpRoomPreviewCardsInstalled = true

  var STYLE_ID = 'android-room-preview-cards-style'
  var PLAYER_MODAL_ID = 'android-room-player-card'
  var modPreviewPromise = null
  var modPreviewRoomId = 0

  function text(value) {
    return value === undefined || value === null ? '' : String(value)
  }

  function routePath() {
    return text(window.location && window.location.hash || '')
      .replace(/^#/, '').split('?')[0] || '/'
  }

  function isDashboard() {
    /* The player summary is present both on the room dashboard and on the
       platform's room-overview cards.  The latter uses /rooms, so keep the
       same card behavior there instead of leaving its clickable player count
       without an action. */
    return /^\/(?:dashboard|rooms|platform)(?:\/|$)/i.test(routePath())
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

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return
    var style = document.createElement('style')
    style.id = STYLE_ID
    var rules = [
      /* Keep the mod card deliberately compact.  The inner table has a
         small fixed minimum width so narrow phones can pan horizontally
         instead of clipping the ID/size fields. */
      'body.android-room-preview .android-mod-detail-dialog .v-overlay__content{width:78vw!important;min-width:0!important;max-width:420px!important;max-height:calc(100vh - 96px)!important;margin:12px!important}',
      'body.android-room-preview .android-mod-detail-dialog .v-card{width:100%!important;max-width:100%!important;max-height:calc(100vh - 96px)!important;overflow:hidden!important;border-radius:14px!important}',
      'body.android-room-preview .android-mod-detail-dialog .v-card-text{max-height:calc(100vh - 170px)!important;overflow:auto!important;padding:6px 8px!important}',
      'body.android-room-preview .android-mod-detail-dialog .v-data-table__wrapper,body.android-room-preview .android-mod-detail-dialog .v-table__wrapper{max-height:calc(100vh - 220px)!important;overflow-x:auto!important;overflow-y:auto!important;-webkit-overflow-scrolling:touch!important}',
      'body.android-room-preview .android-mod-detail-dialog table{min-width:360px!important;width:100%!important;border-collapse:collapse!important}',
      /* The upstream modal uses a four-column desktop table.  Keep that
         source table in the DOM (Vue may still update it), but render the
         Android summary below as a compact two-column table.  The wrapper is
         intentionally scrollable on a narrow phone instead of clipping the
         ID or size value. */
      'body.android-room-preview .android-mod-detail-dialog .android-mod-original-table{display:none!important}',
      /* Vue can replace the source table after the first render, which would
         remove the marker class above.  The compact table is plain HTML, so
         hiding any Vuetify data-table inside this card is safe and keeps the
         desktop duplicate from reappearing. */
      'body.android-room-preview .android-mod-detail-dialog .v-card-text .v-data-table,body.android-room-preview .android-mod-detail-dialog .v-card-text .v-table{display:none!important}',
      'body.android-room-preview .android-mod-detail-dialog .v-card-text table:not(.android-mod-summary){display:none!important}',
      'body.android-room-preview .android-mod-detail-dialog table:not(.android-mod-summary){display:none!important}',
      'body.android-room-preview .android-mod-detail-dialog .android-mod-summary-wrap{display:block!important;width:100%!important;max-width:100%!important;overflow-x:auto!important;overflow-y:hidden!important;-webkit-overflow-scrolling:touch!important;padding:0!important;margin:0 0 8px!important}',
      /* Every generated summary uses the same two-column geometry.  A
         content-sized table made each mod card a different width whenever a
         name was longer, so keep the table tied to the dialog width and let
         the value cell absorb the remaining space.  The 320px floor is still
         deliberately scrollable on a very narrow phone. */
      'body.android-room-preview .android-mod-detail-dialog .android-mod-summary{width:100%!important;min-width:320px!important;max-width:100%!important;table-layout:fixed!important;border-collapse:separate!important;border-spacing:0!important;border:1px solid rgba(var(--v-border-color),.24)!important;border-radius:8px!important;overflow:hidden!important;font-size:.78rem!important}',
      'body.android-room-preview .android-mod-detail-dialog .android-mod-summary th,body.android-room-preview .android-mod-detail-dialog .android-mod-summary td{border:0!important;padding:5px 8px!important;vertical-align:middle!important;text-align:start!important;white-space:nowrap!important;overflow:visible!important;text-overflow:clip!important}',
      'body.android-room-preview .android-mod-detail-dialog .android-mod-summary thead th{font-size:.72rem!important;font-weight:600!important;color:rgba(var(--v-theme-on-surface),.64)!important;background:rgba(var(--v-theme-on-surface),.035)!important}',
      'body.android-room-preview .android-mod-detail-dialog .android-mod-summary th:first-child,body.android-room-preview .android-mod-detail-dialog .android-mod-summary td[rowspan]{width:74px!important;min-width:74px!important;max-width:74px!important;text-align:center!important}',
      'body.android-room-preview .android-mod-detail-dialog .android-mod-summary tbody td:not([rowspan]){width:calc(100% - 74px)!important;min-width:0!important;max-width:calc(100% - 74px)!important}',
      'body.android-room-preview .android-mod-detail-dialog .android-mod-summary tbody tr:last-child td{border-bottom:0!important}',
      'body.android-room-preview .android-mod-detail-dialog .android-mod-summary .android-mod-summary-image{width:58px!important;height:58px!important;display:block!important;object-fit:cover!important;border-radius:8px!important;margin:auto!important;background:rgba(var(--v-theme-on-surface),.08)!important}',
      'body.android-room-preview .android-mod-detail-dialog .android-mod-summary .android-mod-summary-label{display:inline-block!important;min-width:38px!important;margin-inline-end:5px!important;color:rgba(var(--v-theme-on-surface),.54)!important;font-size:.69rem!important}',
      'body.android-room-preview .android-mod-detail-dialog .android-mod-summary .android-mod-summary-value{display:inline-block!important;max-width:calc(100% - 48px)!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;vertical-align:middle!important;color:rgb(var(--v-theme-on-surface))!important}',
      'body.android-room-preview .android-mod-detail-dialog .android-mod-summary-item{display:block!important;padding:0!important;margin:0!important}',
      'body.android-room-preview .android-mod-detail-dialog .android-mod-summary-item+.android-mod-summary-item{margin-top:8px!important;padding-top:0!important;border-top:0!important}',
      'body.android-room-preview .android-mod-detail-dialog thead tr{display:grid!important;grid-template-columns:64px minmax(150px,1fr) 76px 76px!important;min-width:360px!important;align-items:center!important;border-bottom:1px solid rgba(var(--v-border-color),.22)!important}',
      'body.android-room-preview .android-mod-detail-dialog thead th{display:block!important;min-width:0!important;padding:5px 6px!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;font-size:.78rem!important}',
      'body.android-room-preview .android-mod-detail-dialog tbody tr{display:grid!important;grid-template-columns:64px minmax(296px,1fr)!important;grid-template-rows:auto auto auto!important;min-width:360px!important;align-items:center!important;border-bottom:1px solid rgba(var(--v-border-color),.22)!important;padding:5px 0!important}',
      'body.android-room-preview .android-mod-detail-dialog tbody td{display:flex!important;align-items:center!important;min-width:0!important;padding:4px 6px!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;border:0!important;font-size:.8rem!important}',
      'body.android-room-preview .android-mod-detail-dialog tbody td:nth-child(1){grid-column:1!important;grid-row:1 / span 3!important;align-self:stretch!important;justify-content:center!important;overflow:visible!important}',
      'body.android-room-preview .android-mod-detail-dialog tbody td:nth-child(2){grid-column:2!important;grid-row:1!important}',
      'body.android-room-preview .android-mod-detail-dialog tbody td:nth-child(3){grid-column:2!important;grid-row:3!important}',
      'body.android-room-preview .android-mod-detail-dialog tbody td:nth-child(4){grid-column:2!important;grid-row:2!important}',
      'body.android-room-preview .android-mod-detail-dialog tbody td:nth-child(1) img{width:52px!important;height:52px!important;max-width:52px!important;object-fit:cover!important;border-radius:7px!important}',
      /* The legacy grid rules above apply to the hidden source table.  Reset
         them for each generated summary table so its three rows remain a
         normal table with the image cell spanning exactly those rows. */
      'body.android-room-preview .android-mod-detail-dialog .android-mod-summary thead tr{display:table-row!important;grid-template-columns:none!important;grid-template-rows:none!important;min-width:0!important;padding:0!important}',
      'body.android-room-preview .android-mod-detail-dialog .android-mod-summary thead th{display:table-cell!important;min-width:0!important}',
      'body.android-room-preview .android-mod-detail-dialog .android-mod-summary tbody tr{display:table-row!important;grid-template-columns:none!important;grid-template-rows:none!important;min-width:0!important;align-items:initial!important;padding:0!important;border-bottom:0!important}',
      'body.android-room-preview .android-mod-detail-dialog .android-mod-summary tbody td{display:table-cell!important;grid-column:auto!important;grid-row:auto!important;align-self:initial!important;justify-content:initial!important;padding:5px 8px!important;border:0!important;font-size:.78rem!important;overflow:visible!important}',
      'body.android-room-preview .android-mod-detail-dialog .android-mod-summary tbody td[rowspan]{justify-content:center!important;text-align:center!important;overflow:visible!important}',
      'body.android-room-preview .android-mod-detail-dialog .android-mod-summary tbody tr:last-child td{border-bottom:0!important}',
      /* Keep the requested table structure visually clear: one separator
         below the optional heading, one outer boundary per mod, and no
         stray lines between the name/ID/size rows or through the rowspan
         image cell. */
      'body.android-room-preview .android-mod-detail-dialog .android-mod-summary thead th{border-bottom:1px solid rgba(var(--v-border-color),.24)!important}',
      'body.android-room-preview .android-mod-detail-dialog .android-mod-summary tbody tr:not(:last-child) td{border-bottom:0!important}',
      '@media (min-width:900px){body.android-room-preview .android-mod-detail-dialog .v-overlay__content{width:420px!important;max-width:420px!important}}',
      /* The player value remains a real Vuetify chip, but now has an obvious
         tap affordance and is not mistaken for a passive tooltip. */
      '.android-room-player-summary{cursor:pointer!important;-webkit-tap-highlight-color:transparent!important;user-select:none!important;transition:filter .12s ease,transform .12s ease!important}',
      '.android-room-player-summary:hover{filter:brightness(1.08)!important}',
      '.android-room-player-summary:active{transform:scale(.98)!important}',
      '.android-room-player-summary:focus-visible{outline:2px solid rgb(var(--v-theme-primary))!important;outline-offset:2px!important}',
      '#'+PLAYER_MODAL_ID+'{position:fixed!important;inset:0!important;z-index:2147483646!important;display:none!important;align-items:center!important;justify-content:center!important;padding:20px!important;box-sizing:border-box!important}',
      '#'+PLAYER_MODAL_ID+'.is-open{display:flex!important}',
      '#'+PLAYER_MODAL_ID+' .android-player-backdrop{position:absolute!important;inset:0!important;background:rgba(0,0,0,.46)!important;backdrop-filter:blur(1px)!important}',
      '#'+PLAYER_MODAL_ID+' .android-player-dialog{position:relative!important;display:flex!important;flex-direction:column!important;width:86vw!important;max-width:430px!important;max-height:70vh!important;overflow:hidden!important;border:1px solid rgba(var(--v-border-color),.22)!important;border-radius:16px!important;background:rgb(var(--v-theme-surface))!important;color:rgb(var(--v-theme-on-surface))!important;box-shadow:0 18px 55px rgba(0,0,0,.34)!important}',
      '#'+PLAYER_MODAL_ID+' .android-player-head{display:flex!important;align-items:center!important;gap:8px!important;min-height:52px!important;padding:10px 14px!important;border-bottom:1px solid rgba(var(--v-border-color),.16)!important}',
      '#'+PLAYER_MODAL_ID+' .android-player-title{flex:1 1 auto!important;min-width:0!important;font-size:1.05rem!important;font-weight:600!important;color:rgb(var(--v-theme-primary))!important}',
      '#'+PLAYER_MODAL_ID+' .android-player-count{font-size:.78rem!important;color:rgba(var(--v-theme-on-surface),.58)!important;white-space:nowrap!important}',
      '#'+PLAYER_MODAL_ID+' .android-player-close{display:inline-flex!important;align-items:center!important;justify-content:center!important;width:34px!important;height:34px!important;padding:0!important;border:0!important;border-radius:0!important;outline:0!important;box-shadow:none!important;background:transparent!important;background-image:none!important;-webkit-appearance:none!important;appearance:none!important;color:rgba(var(--v-theme-on-surface),.68)!important;font-size:22px!important;line-height:1!important;cursor:pointer!important}',
      '#'+PLAYER_MODAL_ID+' .android-player-close:hover,#'+PLAYER_MODAL_ID+' .android-player-close:focus,#'+PLAYER_MODAL_ID+' .android-player-close:focus-visible,#'+PLAYER_MODAL_ID+' .android-player-close:active{border:0!important;outline:0!important;box-shadow:none!important;background:transparent!important;background-image:none!important}',
      '#'+PLAYER_MODAL_ID+' .android-player-table-head{display:grid!important;grid-template-columns:minmax(132px,1.35fr) minmax(96px,1fr) 72px!important;gap:8px!important;padding:8px 14px 6px!important;border-bottom:1px solid rgba(var(--v-border-color),.22)!important;font-size:.76rem!important;color:rgba(var(--v-theme-on-surface),.62)!important;white-space:nowrap!important}',
      '#'+PLAYER_MODAL_ID+' .android-player-list{margin:0!important;padding:6px 14px 14px!important;list-style:none!important;overflow:auto!important}',
      '#'+PLAYER_MODAL_ID+' .android-player-item{display:grid!important;grid-template-columns:minmax(132px,1.35fr) minmax(96px,1fr) 72px!important;gap:8px!important;align-items:center!important;min-height:44px!important;margin:4px 0!important;padding:7px 8px!important;border-radius:10px!important;background:rgba(var(--v-theme-on-surface),.055)!important;font-size:.84rem!important}',
      '#'+PLAYER_MODAL_ID+' .android-player-main{display:flex!important;flex-direction:column!important;min-width:0!important}',
      '#'+PLAYER_MODAL_ID+' .android-player-name{overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;font-weight:600!important}',
      '#'+PLAYER_MODAL_ID+' .android-player-uid{overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;font-size:.7rem!important;color:rgba(var(--v-theme-on-surface),.55)!important}',
      '#'+PLAYER_MODAL_ID+' .android-player-role{display:flex!important;flex-direction:column!important;align-items:flex-start!important;justify-content:center!important;min-width:0!important;gap:2px!important}',
      '#'+PLAYER_MODAL_ID+' .android-player-role-name,#'+PLAYER_MODAL_ID+' .android-player-age{display:block!important;min-width:0!important;max-width:100%!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}',
      '#'+PLAYER_MODAL_ID+' .android-player-age{font-size:.74rem!important;color:rgba(var(--v-theme-on-surface),.62)!important}',
      '#'+PLAYER_MODAL_ID+' .android-player-operation{position:relative!important;display:flex!important;justify-content:flex-end!important}',
      '#'+PLAYER_MODAL_ID+' .android-player-operation-toggle{min-width:64px!important;height:30px!important;padding:0 7px!important;border:1px solid rgba(var(--v-border-color),.28)!important;border-radius:7px!important;background:transparent!important;color:rgb(var(--v-theme-primary))!important;font-size:.75rem!important;cursor:pointer!important}',
      '#'+PLAYER_MODAL_ID+' .android-player-operation-menu{position:absolute!important;right:0!important;top:34px!important;z-index:2!important;display:none!important;min-width:64px!important;padding:4px!important;border-radius:8px!important;background:rgb(var(--v-theme-surface))!important;box-shadow:0 5px 18px rgba(0,0,0,.28)!important}',
      '#'+PLAYER_MODAL_ID+' .android-player-operation.is-open .android-player-operation-menu{display:block!important}',
      '#'+PLAYER_MODAL_ID+' .android-player-kick{width:100%!important;padding:6px 8px!important;border:0!important;border-radius:5px!important;background:rgba(var(--v-theme-error),.12)!important;color:rgb(var(--v-theme-error))!important;font-size:.75rem!important;white-space:nowrap!important;cursor:pointer!important}',
      '#'+PLAYER_MODAL_ID+' .android-player-index{display:none!important}',
      '#'+PLAYER_MODAL_ID+' .android-player-empty{padding:22px 14px 26px!important;text-align:center!important;color:rgba(var(--v-theme-on-surface),.58)!important}',
      '@media (orientation:landscape){#'+PLAYER_MODAL_ID+' .android-player-dialog{max-height:78vh!important}}'
    ].join('\n')
    /* The compact class is added only to the actual mod-detail overlay.  Do
       not scope the rules to one body route: Vue can keep the same overlay
       under either the platform dashboard or the total-room preview shell,
       and a selector-level comma replacement would accidentally change
       `body... .overlay .child` into an unscoped first branch. */
    rules = rules.replace(/body\.android-room-preview\s+\.android-mod-detail-dialog/g,
      '.android-mod-detail-dialog')
    style.textContent = rules
    document.head.appendChild(style)
  }

  function isModDetailsOverlay(overlay) {
    if (!overlay || overlay.id === PLAYER_MODAL_ID) return false
    var table = overlay.querySelector && overlay.querySelector('.v-data-table,.v-table')
    if (!table) return false
    var value = text(overlay.textContent)
    /* The upstream mod-info table does not actually label its title cell
       “名称”; it uses the mod name as the card title and labels only ID/size.
       Match either an explicit mod title or that stable ID+size pair so the
       compact layout is applied to the real detail dialog, while ordinary
       add/config tables (which have no size field) remain untouched. */
    return /模组|mods|mod/i.test(value)
      || (/(?:^|\s)id(?:\s|$)/i.test(value) && /大小|size/i.test(value))
  }

  function compactModDialogs() {
    if (!isDashboard()) return
    var overlays = document.querySelectorAll('.v-overlay')
    for (var i = 0; i < overlays.length; i += 1) {
      var overlay = overlays[i]
      if (isModDetailsOverlay(overlay)) {
        /* A forced close uses an inline display guard because some DMP
           builds mark this dialog persistent.  Clear that guard when Vue
           opens the same dialog again. */
        if (overlay.classList.contains('v-overlay--active')) overlay.style.removeProperty('display')
        overlay.classList.add('android-mod-detail-dialog')
        compactModDialogContent(overlay)
      }
      else if (overlay.classList.contains('android-mod-detail-dialog')) {
        overlay.classList.remove('android-mod-detail-dialog')
      }
    }
  }

  function forceCloseModOverlay(overlay) {
    if (!overlay) return
    overlay.classList.remove('v-overlay--active', 'v-overlay--scroll-blocked')
    overlay.setAttribute('aria-hidden', 'true')
    overlay.style.setProperty('display', 'none', 'important')
    if (document.documentElement) {
      document.documentElement.classList.remove('v-overlay-scroll-blocked')
      document.documentElement.style.removeProperty('overflow')
    }
    if (document.body) document.body.style.removeProperty('overflow')
  }

  function normalizedCellText(node) {
    return text(node && node.textContent).replace(/\s+/g, ' ').trim()
  }

  function firstNonEmpty(nodes) {
    for (var i = 0; i < nodes.length; i += 1) {
      var value = normalizedCellText(nodes[i])
      if (value) return value
    }
    return ''
  }

  function modDialogName(overlay) {
    var title = overlay.querySelector('.v-card-title,[class*="card-title"],h1,h2,h3')
    var value = firstNonEmpty(title ? [title] : [])
    /* The title may contain an icon/close label in an older Vuetify build.
       Use the first non-empty line as the actual name. */
    if (value) {
      var lines = value.split(/\n+/).map(function (line) { return line.trim() }).filter(Boolean)
      if (lines.length) value = lines[0]
    }
    return value || '未命名模组'
  }

  function imageSourceForNode(image) {
    if (!image) return ''
    /* Vuetify/lazy-image variants do not always put the usable URL in src.
       Prefer the browser's resolved currentSrc, then the common lazy-load
       attributes and finally the first srcset candidate. */
    var source = text(image.currentSrc || image.getAttribute('src') || '')
    if (!source || /^data:image\/(?:gif|png);base64,/i.test(source)) {
      source = text(image.getAttribute('data-src') || image.getAttribute('data-original')
        || image.getAttribute('data-lazy-src') || '')
    }
    if (!source) {
      var srcset = text(image.getAttribute('srcset') || image.getAttribute('data-srcset') || '')
      if (srcset) source = srcset.split(',')[0].trim().split(/\s+/)[0]
    }
    return source
  }

  function modDialogImage(table) {
    var image = table && table.querySelector('img[src],img[data-src],img[data-original],img[data-lazy-src],img[srcset],img[data-srcset]')
    return imageSourceForNode(image)
  }

  /* The source Vuetify table is rendered asynchronously and can be replaced
     by Vue after the compact summary has been inserted.  CSS alone is not
     reliable here (the upstream table has inline display rules), so hide all
     non-summary table/wrapper nodes inline on every observer refresh. */
  function hideOriginalModTables(overlay) {
    var cardText = overlay && overlay.querySelector('.v-card-text')
    if (!cardText) return
    var summaryWrap = cardText.querySelector('.android-mod-summary-wrap')
    var nodes = cardText.querySelectorAll('table, .v-data-table, .v-table, .v-data-table__wrapper, .v-table__wrapper')
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i]
      if ((node.closest && node.closest('.android-mod-summary-wrap'))
          || (summaryWrap && (node === summaryWrap || node.contains(summaryWrap)))) continue
      node.classList.add('android-mod-original-table')
      node.style.setProperty('display', 'none', 'important')
      node.setAttribute('aria-hidden', 'true')
    }
  }

  function syncSummaryImages(overlay) {
    var cardText = overlay && overlay.querySelector('.v-card-text')
    var summaryWrap = cardText && cardText.querySelector('.android-mod-summary-wrap')
    if (!cardText || !summaryWrap) return
    var sourceRows = cardText.querySelectorAll('table:not(.android-mod-summary) tbody tr')
    var items = summaryWrap.querySelectorAll('.android-mod-summary-item')
    var count = Math.min(sourceRows.length, items.length)
    for (var i = 0; i < count; i += 1) {
      var sourceImage = sourceRows[i].querySelector('img[src],img[data-src],img[data-original],img[data-lazy-src],img[srcset],img[data-srcset]')
      var targetImage = items[i].querySelector('.android-mod-summary-image')
      if (!sourceImage || !targetImage) continue
      var source = imageSourceForNode(sourceImage)
      if (source && targetImage.getAttribute('src') !== source) targetImage.setAttribute('src', source)
      if (sourceImage.dataset.androidSummaryImageSync === '1') continue
      sourceImage.dataset.androidSummaryImageSync = '1'
      sourceImage.addEventListener('load', function (target, sourceNode) {
        return function () {
          var loaded = imageSourceForNode(sourceNode)
          if (loaded) target.setAttribute('src', loaded)
        }
      }(targetImage, sourceImage))
    }
  }

  function modDialogValue(table, matcher, fallback) {
    var cells = table ? table.querySelectorAll('td,th') : []
    for (var i = 0; i < cells.length; i += 1) {
      var label = normalizedCellText(cells[i])
      if (!label || !matcher.test(label)) continue
      for (var j = i + 1; j < cells.length; j += 1) {
        var value = normalizedCellText(cells[j])
        if (value && !matcher.test(value)) return value
      }
    }
    return fallback || '—'
  }

  function tableHeaderLabels(table) {
    var headers = []
    var cells = table ? table.querySelectorAll('thead th') : []
    for (var i = 0; i < cells.length; i += 1) headers.push(normalizedCellText(cells[i]))
    return headers
  }

  function cellValueForHeader(cells, headers, matcher) {
    for (var i = 0; i < cells.length; i += 1) {
      var label = text(headers[i] || cells[i].getAttribute('data-label') || '')
      if (matcher.test(label)) return normalizedCellText(cells[i])
    }
    return ''
  }

  function extractModRows(table, overlay) {
    var rows = table ? table.querySelectorAll('tbody tr') : []
    var headers = tableHeaderLabels(table)
    var result = []
    for (var i = 0; i < rows.length; i += 1) {
      var row = rows[i]
      var cells = row.querySelectorAll('td')
      var rowText = normalizedCellText(row)
      if (!cells.length || !rowText || /^(?:暂无数据|no data|loading)/i.test(rowText)) continue
      var image = row.querySelector('img[src],img[data-src],img[data-original],img[data-lazy-src],img[srcset],img[data-srcset]')
      var values = []
      for (var j = 0; j < cells.length; j += 1) values.push(normalizedCellText(cells[j]))
      var name = cellValueForHeader(cells, headers, /名称|name/i)
      var id = cellValueForHeader(cells, headers, /^(?:id|模组id|编号)$/i)
      var size = cellValueForHeader(cells, headers, /大小|size|serversize/i)
      if (!id) {
        for (var idIndex = 0; idIndex < values.length; idIndex += 1) {
          if (/^\d{4,}$/.test(values[idIndex])) { id = values[idIndex]; break }
        }
      }
      if (!size) {
        for (var sizeIndex = 0; sizeIndex < values.length; sizeIndex += 1) {
          if (/\b\d+(?:\.\d+)?\s*(?:B|KB|MB|GB|TB)\b/i.test(values[sizeIndex])) {
            size = values[sizeIndex]; break
          }
        }
      }
      if (!name) {
        for (var nameIndex = 0; nameIndex < values.length; nameIndex += 1) {
          var candidate = values[nameIndex]
          if (!candidate || candidate === id || candidate === size
              || /^(?:操作|actions?|更新|无需更新|需要更新|非创意工坊)$/i.test(candidate)) continue
          if (/^\d{4,}$/.test(candidate)) continue
          name = candidate
          break
        }
      }
      /* Vuetify may keep a placeholder row such as “游戏模组 / 0 /
         NaN undefined” while the API response is still settling.  It is not
         a real mod and would make the compact card look like a broken item. */
      var hasUsableId = /^\d{4,}$/.test(id)
      var hasUsableSize = /\d/.test(size) && !/NaN|undefined/i.test(size)
      if ((!image && !hasUsableId && !hasUsableSize)
          || (/^0$/.test(id) && /NaN|undefined/i.test(size))) continue
      result.push({
        name: name || modDialogName(overlay),
        id: id || '—',
        size: size || '—',
        image: imageSourceForNode(image),
        imageNode: image ? image.cloneNode(true) : null
      })
    }
    return result
  }

  function createModSummaryTable(data, includeHeader) {
    var summaryTable = document.createElement('table')
    summaryTable.className = 'android-mod-summary'
    summaryTable.setAttribute('aria-label', '模组基本信息')
    if (includeHeader !== false) {
      var head = document.createElement('thead')
      var headRow = document.createElement('tr')
      var imageHead = document.createElement('th')
      imageHead.textContent = '图片'
      var infoHead = document.createElement('th')
      infoHead.textContent = '名称 / ID / 大小'
      headRow.appendChild(imageHead)
      headRow.appendChild(infoHead)
      head.appendChild(headRow)
      summaryTable.appendChild(head)
    }

    var body = document.createElement('tbody')
    var imageRow = document.createElement('tr')
    var imageCell = document.createElement('td')
    imageCell.rowSpan = 3
    var image = data.imageNode && data.imageNode.cloneNode
      ? data.imageNode.cloneNode(true) : document.createElement('img')
    /* Use the resolved/lazy source captured from the original row.  Keeping
       the original node as a fallback preserves auth/query attributes used
       by older DMP builds while avoiding a broken placeholder src. */
    if (data.image) image.setAttribute('src', data.image)
    if (data.imageNode) {
      var lazyAttrs = ['srcset', 'data-src', 'data-original', 'data-lazy-src', 'data-srcset']
      for (var lazyIndex = 0; lazyIndex < lazyAttrs.length; lazyIndex += 1) {
        var lazyAttr = lazyAttrs[lazyIndex]
        if (!image.getAttribute(lazyAttr) && data.imageNode.getAttribute(lazyAttr)) {
          image.setAttribute(lazyAttr, data.imageNode.getAttribute(lazyAttr))
        }
      }
    }
    image.removeAttribute('loading')
    image.setAttribute('loading', 'eager')
    image.alt = '模组图片'
    image.className = 'android-mod-summary-image'
    imageCell.appendChild(image)
    imageRow.appendChild(imageCell)
    var nameCell = document.createElement('td')
    var nameLabel = document.createElement('span')
    nameLabel.className = 'android-mod-summary-label'
    nameLabel.textContent = '名称'
    var nameValue = document.createElement('span')
    nameValue.className = 'android-mod-summary-value'
    nameValue.textContent = data.name || '—'
    nameCell.appendChild(nameLabel)
    nameCell.appendChild(nameValue)
    imageRow.appendChild(nameCell)
    body.appendChild(imageRow)

    var idRow = document.createElement('tr')
    var idCell = document.createElement('td')
    var idLabel = document.createElement('span')
    idLabel.className = 'android-mod-summary-label'
    idLabel.textContent = 'ID'
    var idValue = document.createElement('span')
    idValue.className = 'android-mod-summary-value'
    idValue.textContent = data.id || '—'
    idCell.appendChild(idLabel)
    idCell.appendChild(idValue)
    idRow.appendChild(idCell)
    body.appendChild(idRow)

    var sizeRow = document.createElement('tr')
    var sizeCell = document.createElement('td')
    var sizeLabel = document.createElement('span')
    sizeLabel.className = 'android-mod-summary-label'
    sizeLabel.textContent = '大小'
    var sizeValue = document.createElement('span')
    sizeValue.className = 'android-mod-summary-value'
    sizeValue.textContent = data.size || '—'
    sizeCell.appendChild(sizeLabel)
    sizeCell.appendChild(sizeValue)
    sizeRow.appendChild(sizeCell)
    body.appendChild(sizeRow)
    summaryTable.appendChild(body)
    return summaryTable
  }

  function compactModDialogContent(overlay) {
    var cardText = overlay.querySelector('.v-card-text')
    if (!cardText) return
    if (cardText.querySelector('.android-mod-summary-wrap')) {
      hideOriginalModTables(overlay)
      syncSummaryImages(overlay)
      hydrateSummaryImages(overlay)
      return
    }
    var original = cardText.querySelector('.v-data-table,.v-table,table')
    if (!original) return
    var table = original.tagName && original.tagName.toLowerCase() === 'table'
      ? original : original.querySelector('table')
    if (!table || !normalizedCellText(table)) return

    var summaryWrap = document.createElement('div')
    summaryWrap.className = 'android-mod-summary-wrap'
    var rows = extractModRows(table, overlay)
    /* The dashboard data table is populated asynchronously.  Do not hide an
       empty table and freeze a one-row fallback before Vue has inserted its
       mod items; MutationObserver will call us again when rows arrive.  The
       legacy single-mod detail table has no thead and can safely use the
       fallback immediately. */
    if (table.querySelector('thead') && !rows.length) return
    if (!rows.length) {
      rows.push({
        name: modDialogName(overlay),
        id: modDialogValue(table, /^id$/i, '—'),
        size: modDialogValue(table, /^(?:大小|size)$/i, '—'),
        image: modDialogImage(table)
      })
    }
    for (var i = 0; i < rows.length; i += 1) {
      var item = document.createElement('div')
      item.className = 'android-mod-summary-item'
      // The header describes the whole compact list; repeating it for every
      // mod wastes vertical space on phones and makes the card appear much
      // larger than the requested three-line-per-mod layout.
      item.appendChild(createModSummaryTable(rows[i], i === 0))
      summaryWrap.appendChild(item)
    }
    cardText.insertBefore(summaryWrap, original.parentNode === cardText ? original : original.parentNode)
    original.classList.add('android-mod-original-table')
    hideOriginalModTables(overlay)
    syncSummaryImages(overlay)
    hydrateSummaryImages(overlay)
  }

  function splitPlayers(raw) {
    var value = text(raw).replace(/\s+/g, ' ').trim()
    var count = null
    var match = value.match(/\(\s*(\d+)\s*\/\s*(\d+)\s*\)\s*$/)
    if (match) {
      count = { online: Number(match[1]), max: Number(match[2]) }
      value = value.slice(0, match.index).trim()
    }
    if (!value || /^(?:无在线玩家|暂无玩家|没有玩家|no\s+players?|none)$/i.test(value)) {
      return { names: [], count: count }
    }
    var parts = value.split(/[,，、;；\n]+/)
    var names = []
    for (var i = 0; i < parts.length; i += 1) {
      var name = parts[i].trim()
      if (!name || names.indexOf(name) >= 0) continue
      names.push(name)
    }
    return { names: names, count: count }
  }

  function getPlayerModal() {
    var modal = document.getElementById(PLAYER_MODAL_ID)
    if (modal) return modal
    modal = document.createElement('div')
    modal.id = PLAYER_MODAL_ID
    modal.setAttribute('aria-hidden', 'true')
    modal.innerHTML = '<div class="android-player-backdrop" data-player-close="1"></div>'
      + '<section class="android-player-dialog" role="dialog" aria-modal="true" aria-labelledby="android-player-title">'
      + '<div class="android-player-head"><div id="android-player-title" class="android-player-title">游戏玩家</div>'
      + '<div class="android-player-count"></div><button type="button" class="android-player-close" aria-label="关闭" data-player-close="1">×</button></div>'
      + '<div class="android-player-table-head"><span>玩家/uid</span><span>角色/天数</span><span>操作</span></div>'
      + '<ul class="android-player-list"></ul></section>'
    document.body.appendChild(modal)
    modal.addEventListener('click', function (event) {
      var target = event.target
      if (target && closest(target, '[data-player-close="1"]')) closePlayerModal()
    })
    return modal
  }

  function closePlayerModal() {
    var modal = document.getElementById(PLAYER_MODAL_ID)
    if (!modal) return
    modal.classList.remove('is-open')
    modal.setAttribute('aria-hidden', 'true')
  }

  /* DmpWebActivity can call this before routing a physical Android Back
     press.  Returning true tells the native shell that a card consumed Back;
     no route/history mutation is performed here. */
  window.__dmpCloseRoomPreviewCard = function () {
    var playerModal = document.getElementById(PLAYER_MODAL_ID)
    if (playerModal && playerModal.classList.contains('is-open')) {
      closePlayerModal()
      return true
    }
    var overlays = document.querySelectorAll('.android-mod-detail-dialog,.v-overlay')
    for (var i = 0; i < overlays.length; i += 1) {
      var overlay = overlays[i]
      if (!overlay.classList.contains('android-mod-detail-dialog') && isModDetailsOverlay(overlay)) {
        overlay.classList.add('android-mod-detail-dialog')
      }
      if (!overlay.classList.contains('android-mod-detail-dialog')) continue
      if (!overlay || !overlay.classList.contains('v-overlay--active')) continue
      var close = overlay.querySelector('[aria-label="Close"],[aria-label="关闭"],.v-card-actions button')
      if (close && typeof close.click === 'function') close.click()
      else forceCloseModOverlay(overlay)
      return true
    }
    return false
  }

  function currentRoomId() {
    var candidates = []
    if (window.__dmpServerRoomId) candidates.push(window.__dmpServerRoomId)
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
      if (window.__dmpBootstrap && typeof window.__dmpBootstrap === 'object') {
        var boot = window.__dmpBootstrap
        candidates.push(boot.global && boot.global.room && (boot.global.room.id || boot.global.room.roomID))
        candidates.push(boot.room && (boot.room.id || boot.room.roomID || boot.roomID))
        candidates.push(boot.global && (boot.global.roomID || boot.global.roomId))
        candidates.push(boot.global && boot.global.entry
          && (boot.global.entry.selectedRoomID || boot.global.entry.selectedRoomId))
        candidates.push(boot.roomID || boot.roomId)
        if (Array.isArray(boot.dmps)) {
          candidates.push(boot.dmps[0] && (boot.dmps[0].selectedRoomID
            || boot.dmps[0].selectedRoomId || boot.dmps[0].roomID || boot.dmps[0].roomId))
        }
      }
      if (window.AndroidDmp && typeof window.AndroidDmp.getBootstrap === 'function') {
        var nativeBoot = JSON.parse(window.AndroidDmp.getBootstrap() || '{}')
        candidates.push(nativeBoot.global && nativeBoot.global.room
          && (nativeBoot.global.room.id || nativeBoot.global.room.roomID))
        candidates.push(nativeBoot.room && (nativeBoot.room.id || nativeBoot.room.roomID || nativeBoot.roomID))
        candidates.push(nativeBoot.global && (nativeBoot.global.roomID || nativeBoot.global.roomId))
        candidates.push(nativeBoot.roomID || nativeBoot.roomId)
      }
    } catch (ignored) {}
    try {
      var persisted = JSON.parse(localStorage.getItem('dmp-global') || '{}')
      candidates.push(persisted && persisted.global && persisted.global.room
        && (persisted.global.room.id || persisted.global.room.roomID))
      candidates.push(persisted && persisted.room && (persisted.room.id || persisted.room.roomID))
      candidates.push(persisted && (persisted.roomID || persisted.roomId))
    } catch (ignored) {}
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

  function apiCredentials() {
    var base = text(window.__dmpApiBaseUrl || '').replace(/\/+$/, '')
    var token = ''
    try {
      if (window.__dmpBootstrap && typeof window.__dmpBootstrap === 'object') {
        var boot = window.__dmpBootstrap
        base = base || text(boot.apiBaseUrl || '').replace(/\/+$/, '')
        token = text(boot.apiToken || (boot.user && (boot.user.token || boot.user.apiToken))
          || (boot.global && boot.global.entry && (boot.global.entry.token || boot.global.entry.apiToken))
          || (Array.isArray(boot.dmps) && boot.dmps[0] && boot.dmps[0].token) || '').trim()
      }
      if ((!base || !token) && window.AndroidDmp && typeof window.AndroidDmp.getBootstrap === 'function') {
        var nativeBoot = JSON.parse(window.AndroidDmp.getBootstrap() || '{}')
        base = base || text(nativeBoot.apiBaseUrl || '').replace(/\/+$/, '')
        token = token || text(nativeBoot.apiToken || (nativeBoot.user && nativeBoot.user.token) || '').trim()
        if (!token && Array.isArray(nativeBoot.dmps)) {
          token = text(nativeBoot.dmps[0] && nativeBoot.dmps[0].token || '').trim()
        }
      }
    } catch (ignored) {}
    try {
      var user = JSON.parse(localStorage.getItem('dmp-user') || '{}')
      token = token || text(user && (user.token || user.apiToken)).trim()
    } catch (ignored) {}
    try {
      var global = JSON.parse(localStorage.getItem('dmp-global') || '{}')
      var entry = global && (global.entry || global.server)
      token = token || text(entry && (entry.token || entry.apiToken)).trim()
    } catch (ignored) {}
    return { base: base, token: token }
  }

  function overviewRoomIdForElement(element) {
    var path = routePath()
    if (!/^\/(?:rooms|platform)(?:\/|$)/i.test(path)) return Promise.resolve(0)
    var card = closest(element, '.v-card')
    var explicit = card && Number(card.getAttribute('data-android-room-id')
      || card.getAttribute('data-room-id') || 0)
    if (explicit > 0) return Promise.resolve(explicit)
    var nameNode = card && card.querySelector('.v-card-title .v-chip')
    var visibleName = text(nameNode && nameNode.textContent).replace(/[.…]+$/, '').trim()
    if (!visibleName) return Promise.resolve(0)
    var credentials = apiCredentials()
    if (!credentials.base || typeof window.fetch !== 'function') return Promise.resolve(0)
    var headers = { 'X-I18n-Lang': 'zh' }
    if (credentials.token) headers['X-DMP-TOKEN'] = credentials.token
    return window.fetch(credentials.base + '/v3/room/list?page=1&pageSize=1000', {
      method: 'GET', cache: 'no-store', headers: headers
    }).then(function (response) {
      if (!response || !response.ok) throw new Error('room list')
      return response.json()
    }).then(function (payload) {
      var data = payload && payload.data
      var rows = data && Array.isArray(data.rows) ? data.rows
        : Array.isArray(data) ? data : []
      for (var i = 0; i < rows.length; i += 1) {
        var row = rows[i] || {}
        var name = text(row.gameName || row.roomName || row.name).trim()
        if (name === visibleName || name.indexOf(visibleName) === 0
            || visibleName.indexOf(name) === 0) {
          return Number(row.id || row.roomID || row.roomId || 0) || 0
        }
      }
      return 0
    }).catch(function () { return 0 })
  }

  function modInfoArrayFromResponse(response) {
    var queue = [response]
    var seen = []
    while (queue.length) {
      var value = queue.shift()
      if (!value || seen.indexOf(value) >= 0) continue
      seen.push(value)
      if (Array.isArray(value)) return value
      if (typeof value !== 'object') continue
      var keys = ['data', 'result', 'mods', 'items', 'list']
      for (var i = 0; i < keys.length; i += 1) {
        if (value[keys[i]] != null) queue.push(value[keys[i]])
      }
    }
    return []
  }

  function fetchModPreviewMap() {
    var roomId = currentRoomId()
    var credentials = apiCredentials()
    if (!roomId || !credentials.base || !credentials.token || typeof window.fetch !== 'function') {
      return Promise.resolve({})
    }
    if (modPreviewPromise && modPreviewRoomId === roomId) return modPreviewPromise
    modPreviewRoomId = roomId
    var headers = { 'X-DMP-TOKEN': credentials.token, 'X-I18n-Lang': 'zh' }
    function getJson(path) {
      return window.fetch(credentials.base + path, {
        method: 'GET', cache: 'no-store', headers: headers
      }).then(function (response) {
        if (!response || !response.ok) throw new Error('mod preview info')
        return response.json()
      })
    }
    modPreviewPromise = getJson('/v3/dashboard/info/base?roomID=' + encodeURIComponent(roomId))
      .then(function (response) {
        var data = response && response.data ? response.data : response || {}
        var worlds = Array.isArray(data.worlds) ? data.worlds : []
        var worldId = Number(worlds[0] && (worlds[0].id || worlds[0].worldID) || 0)
        return getJson('/v3/mod/setting/enabled?roomID=' + encodeURIComponent(roomId)
          + '&worldID=' + encodeURIComponent(worldId))
      }).then(function (response) {
        var map = {}
        var list = modInfoArrayFromResponse(response)
        for (var i = 0; i < list.length; i += 1) {
          var item = list[i] || {}
          var id = text(item.id || item.modID || item.modId).trim()
          var source = text(item.preview_url || item.previewUrl || item.image || item.imageUrl).trim()
          if (id && id !== '0' && source) map[id] = source
        }
        return map
      }).catch(function () { return {} })
    return modPreviewPromise
  }

  function hydrateSummaryImages(overlay) {
    var cardText = overlay && overlay.querySelector('.v-card-text')
    var summaryWrap = cardText && cardText.querySelector('.android-mod-summary-wrap')
    if (!cardText || !summaryWrap) return
    fetchModPreviewMap().then(function (map) {
      var items = summaryWrap.querySelectorAll('.android-mod-summary-item')
      for (var i = 0; i < items.length; i += 1) {
        var values = items[i].querySelectorAll('.android-mod-summary-value')
        var image = items[i].querySelector('.android-mod-summary-image')
        var id = values.length > 1 ? text(values[1].textContent).trim() : ''
        var source = map[id]
        if (image && source) image.setAttribute('src', source)
      }
    })
  }

  var playerDetailsPromise = null
  var playerDetailsWorldId = 0
  var playerDetailsRoomId = 0

  function playerArrayFromResponse(response) {
    /* DMP 3.1/3.2 responses are both seen in the wild: some return the
       array directly in data, while others wrap it as players/list/online or
       one more data/result level.  Walk a few known wrappers so an otherwise
       valid online response is not rendered as an empty card. */
    var queue = [response]
    var seen = []
    while (queue.length) {
      var value = queue.shift()
      if (!value || seen.indexOf(value) >= 0) continue
      seen.push(value)
      if (Array.isArray(value)) return value
      if (typeof value !== 'object') continue
      /* The official `/player/online` response is `data: []`, while older
         DMP builds and dashboard snapshots may expose the same rows under
         `playerInfo`, `onlinePlayers`, `rows` or one more `result` wrapper. */
      var keys = ['data', 'result', 'players', 'playerInfo', 'onlinePlayers',
        'list', 'online', 'rows', 'items']
      for (var i = 0; i < keys.length; i += 1) {
        if (value[keys[i]] != null) queue.push(value[keys[i]])
      }
    }
    return []
  }

  function fetchPlayerDetails(roomIdOverride) {
    var roomId = Number(roomIdOverride || 0) || currentRoomId()
    var credentials = apiCredentials()
    if (!roomId || !credentials.base || !credentials.token || typeof window.fetch !== 'function') {
      return Promise.resolve([])
    }
    if (playerDetailsPromise && playerDetailsRoomId === roomId) return playerDetailsPromise
    playerDetailsRoomId = roomId
    var headers = { 'X-DMP-TOKEN': credentials.token, 'X-I18n-Lang': 'zh' }
    var query = '?roomID=' + encodeURIComponent(roomId)
    function getJson(path) {
      return window.fetch(credentials.base + path + query, {
        method: 'GET', cache: 'no-store', headers: headers
      }).then(function (response) {
        if (!response || !response.ok) throw new Error('player info')
        return response.json()
      })
    }
    /* `/player/online` is the official source used by the player page.  The
       dashboard endpoint is retained as a fallback for older DMP 3.1 builds
       where the online route may be absent. */
    playerDetailsPromise = getJson('/v3/player/online').then(function (response) {
      var players = playerArrayFromResponse(response)
      if (players.length) return players
      throw new Error('empty player response')
    }).then(function (players) {
      /* The online-player endpoint intentionally returns only PlayerInfo.  A
         kick command also needs a world id, so read it from the base-info
         endpoint when available; a failure here must not hide a valid player
         list. */
      return getJson('/v3/dashboard/info/base').then(function (response) {
        var data = response && response.data ? response.data : response || {}
        var worlds = Array.isArray(data.worlds) ? data.worlds : []
        playerDetailsWorldId = Number(worlds[0] && (worlds[0].id || worlds[0].worldID) || 0)
        return players
      }).catch(function () { return players })
    }).catch(function () {
      return getJson('/v3/dashboard/info/base').then(function (response) {
        var data = response && response.data ? response.data : response || {}
        var worlds = Array.isArray(data.worlds) ? data.worlds : []
        playerDetailsWorldId = Number(worlds[0] && (worlds[0].id || worlds[0].worldID) || 0)
        return playerArrayFromResponse(response)
      })
    }).catch(function () { return [] }).then(function (players) {
      playerDetailsPromise = null
        return players
      })
    return playerDetailsPromise
  }

  function characterName(prefab) {
    var key = text(prefab).toLowerCase().replace(/^\s+|\s+$/g, '')
    var names = {
      wilson: '威尔逊', willow: '薇洛', wolfgang: '沃尔夫冈', wendy: '温蒂',
      wx78: 'WX-78', wickerbottom: '薇克巴顿', woodie: '伍迪', wes: '韦斯',
      waxwell: '麦斯威尔', wathgrithr: '薇格弗德', webber: '韦伯', winona: '薇诺娜',
      warly: '沃利', walter: '沃尔特', wortox: '沃拓克斯', wormwood: '沃姆伍德',
      wurt: '沃特', wanda: '旺达', wonkey: '芜猴', wanda: '旺达'
    }
    return names[key] || text(prefab) || '未知'
  }

  function normalizedPlayers(players, fallback) {
    var source = Array.isArray(players) && players.length ? players : []
    if (!source.length && players && typeof players === 'object') {
      source = Array.isArray(players.players) ? players.players
        : (Array.isArray(players.playerInfo) ? players.playerInfo
          : (Array.isArray(players.onlinePlayers) ? players.onlinePlayers
            : (Array.isArray(players.rows) ? players.rows
              : (Array.isArray(players.list) ? players.list : []))))
    }
    if (!source.length && fallback && Array.isArray(fallback.names)) {
      source = fallback.names.map(function (name) { return { nickname: name } })
    }
    function playerField(player, keys, fallback) {
      for (var keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
        var value = player[keys[keyIndex]]
        if (value === undefined || value === null) continue
        var normalized = text(value).trim()
        if (normalized) return normalized
      }
      return fallback
    }
    return source.map(function (player) {
      player = player || {}
      return {
        /* Official PlayerInfo fields are uid/nickname/prefab/playerAge; keep
           the aliases for 3.1 snapshots and preserve numeric zero values. */
        nickname: playerField(player, ['nickname', 'nickName', 'name', 'nick',
          'username', 'userName'], '未知玩家'),
        uid: playerField(player, ['uid', 'UID', 'userid', 'userID',
          'userId', 'id'], '—'),
        prefab: playerField(player, ['prefab', 'character', 'role', 'prefabName'], ''),
        playerAge: playerField(player, ['playerAge', 'player_age', 'days',
          'day', 'age'], '—')
      }
    })
  }

  function kickPlayer(player, button) {
    var credentials = apiCredentials()
    var roomId = currentRoomId()
    if (!credentials.base || !credentials.token || !roomId || !player || !player.uid || player.uid === '—') {
      if (button) button.textContent = '不可用'
      return
    }
    var uid = String(player.uid).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    if (button) { button.disabled = true; button.textContent = '发送中' }
    window.fetch(credentials.base + '/v3/dashboard/exec/game', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-DMP-TOKEN': credentials.token,
        'X-I18n-Lang': 'zh'
      },
      body: JSON.stringify({
        type: 'console', roomID: roomId, worldID: playerDetailsWorldId || 0,
        extra: "TheNet:Kick('" + uid + "')"
      })
    }).then(function (response) {
      if (!response || !response.ok) throw new Error('kick')
      return response.json()
    }).then(function (response) {
      if (button) button.textContent = response && response.code && response.code !== 200 ? '失败' : '已发送'
    }).catch(function () {
      if (button) button.textContent = '失败'
    }).then(function () {
      if (button) window.setTimeout(function () { button.disabled = false; button.textContent = '踢出' }, 1800)
    })
  }

  function renderPlayerRows(players, summary) {
    var modal = getPlayerModal()
    var list = modal.querySelector('.android-player-list')
    var countNode = modal.querySelector('.android-player-count')
    while (list.firstChild) list.removeChild(list.firstChild)
    var normalized = normalizedPlayers(players, summary)
    var count = summary && summary.count
    countNode.textContent = count ? (count.online + '/' + count.max) : (normalized.length + '人')
    if (!normalized.length) {
      var empty = document.createElement('li')
      empty.className = 'android-player-empty'
      empty.textContent = '当前没有在线玩家或暂时无法读取'
      list.appendChild(empty)
    } else {
      for (var i = 0; i < normalized.length; i += 1) {
        var player = normalized[i]
        var item = document.createElement('li')
        item.className = 'android-player-item'
        item.innerHTML = '<span class="android-player-main"><span class="android-player-name"></span>'
          + '<span class="android-player-uid"></span></span>'
          + '<span class="android-player-role"><span class="android-player-role-name"></span>'
          + '<span class="android-player-age"></span></span><span class="android-player-operation">'
          + '<button type="button" class="android-player-operation-toggle">操作▼</button>'
          + '<span class="android-player-operation-menu"><button type="button" class="android-player-kick">踢出</button></span></span>'
        item.querySelector('.android-player-name').textContent = player.nickname
        item.querySelector('.android-player-uid').textContent = player.uid
        item.querySelector('.android-player-role-name').textContent = characterName(player.prefab)
        item.querySelector('.android-player-age').textContent = '天数 ' + player.playerAge
        bindPlayerRow(item, player)
        list.appendChild(item)
      }
    }
  }

  function bindPlayerRow(item, player) {
    var operation = item.querySelector('.android-player-operation')
    var toggle = item.querySelector('.android-player-operation-toggle')
    var kick = item.querySelector('.android-player-kick')
    if (!operation || !toggle || !kick) return
    toggle.addEventListener('click', function (event) {
      event.preventDefault(); event.stopPropagation()
      var wasOpen = operation.classList.contains('is-open')
      closePlayerOperations()
      if (!wasOpen) operation.classList.add('is-open')
    })
    kick.addEventListener('click', function (event) {
      event.preventDefault(); event.stopPropagation()
      kickPlayer(player, kick)
      operation.classList.remove('is-open')
    })
  }

  function closePlayerOperations() {
    var modal = document.getElementById(PLAYER_MODAL_ID)
    if (!modal) return
    var openOperations = modal.querySelectorAll('.android-player-operation.is-open')
    for (var i = 0; i < openOperations.length; i += 1) {
      openOperations[i].classList.remove('is-open')
    }
  }

  function openPlayerModal(summary, roomIdOverride) {
    var modal = getPlayerModal()
    renderPlayerRows([], summary)
    modal.classList.add('is-open')
    modal.setAttribute('aria-hidden', 'false')
    var close = modal.querySelector('.android-player-close')
    if (close && close.focus) close.focus()
    fetchPlayerDetails(roomIdOverride).then(function (players) {
      if (modal.classList.contains('is-open')) renderPlayerRows(players, summary)
    })
  }

  function isPlayerLabel(value) {
    var label = text(value).replace(/\s+/g, '')
    /* Official zh-Hans dashboard text is currently “玩家个数”.  The
       shorter labels are used by older bundles, and English builds render
       variants such as “Player Count” (spaces are removed above).  Keep the
       match exact so fields such as “玩家UID” are never hijacked. */
    return /^(?:在线|游戏)?玩家(?:个数|数量|数)?$/.test(label)
      || /^(?:online)?players?(?:count|number)?$/i.test(label)
  }

  function playerValueForLabel(labelChip) {
    /* Prefer the label's own Vuetify column.  Looking through the whole
       dashboard row can accidentally select the preceding game-mode/world
       chip when a build omits the `cursor-default` class. */
    var column = closest(labelChip, '.v-col')
    var scope = column || closest(labelChip, '.v-row')
    if (!scope) scope = labelChip.parentElement && labelChip.parentElement.parentElement
    if (!scope) return null
    function findValue(container) {
      if (!container) return null
      var chips = container.querySelectorAll('.v-chip')
      var fallback = null
      for (var i = 0; i < chips.length; i += 1) {
        var chip = chips[i]
        if (chip === labelChip || isPlayerLabel(chip.textContent)) continue
        if (chip.classList.contains('cursor-default') || chip.hasAttribute('title')) return chip
        fallback = chip
      }
      return fallback
    }
    var value = findValue(scope)
    if (value) return value
    /* Dashboard summaries put the label and value in adjacent v-col nodes;
       if the label column contains no value, search the containing row. */
    var row = closest(labelChip, '.v-row')
    return row && row !== scope ? findValue(row) : null
  }

  function decoratePlayerSummaries() {
    if (!isDashboard() || !document.body) return
    /* In the normal dashboard the label is a v-chip.  The platform room
       overview uses a plain span for the left label and a v-chip only for
       the count value, so include spans while ignoring the chip's inner
       content via the exact-label check below. */
    var chips = document.querySelectorAll('.v-chip,span')
    for (var i = 0; i < chips.length; i += 1) {
      var labelChip = chips[i]
      if (!isPlayerLabel(labelChip.textContent)) continue
      var valueChip = playerValueForLabel(labelChip)
      if (!valueChip || valueChip === labelChip) continue
      if (valueChip.dataset.androidPlayerCardReady === '1') continue
      valueChip.dataset.androidPlayerCardReady = '1'
      valueChip.classList.add('android-room-player-summary')
      valueChip.setAttribute('role', 'button')
      valueChip.setAttribute('tabindex', '0')
      valueChip.setAttribute('aria-label', '查看在线玩家')
      var open = function (event) {
        if (event) {
          event.preventDefault()
          event.stopPropagation()
        }
        var summary = splitPlayers(this.textContent)
        overviewRoomIdForElement(this).then(function (roomId) {
          openPlayerModal(summary, roomId)
        })
      }
      valueChip.addEventListener('click', open)
      valueChip.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') open.call(this, event)
      })
    }
  }

  function refresh() {
    if (!document.body) return
    installStyle()
    if (!isDashboard()) {
      closePlayerModal()
      return
    }
    compactModDialogs()
    decoratePlayerSummaries()
  }

  function install() {
    if (!document.body) return
    refresh()
    var frame = 0
    function schedule() {
      if (frame) return
      var run = function () { frame = 0; refresh() }
      frame = window.requestAnimationFrame
        ? window.requestAnimationFrame(run) : window.setTimeout(run, 16)
    }
    if (window.MutationObserver) {
      new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true })
    }
    window.addEventListener('hashchange', schedule)
    window.addEventListener('resize', schedule)
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closePlayerModal()
    })
    /* Vuetify normally closes a non-persistent dialog on its scrim.  Keep a
       small delegated fallback because the Android overlay can be rendered
       outside the component subtree and otherwise swallow the blank-area tap. */
    document.addEventListener('click', function (event) {
      var target = event.target
      var playerModal = document.getElementById(PLAYER_MODAL_ID)
      if (playerModal && playerModal.classList.contains('is-open')) {
        /* The operation menu is intentionally a small popover.  A tap on a
           different row, the card body, or any blank area closes it; the
           toggle/menu handlers themselves stop propagation and remain open. */
        if (!closest(target, '.android-player-operation')) closePlayerOperations()
      }
      var overlay = closest(target, '.android-mod-detail-dialog')
      if (!overlay || !overlay.classList.contains('v-overlay--active')) return
      /* Some shipped DMP dialogs are effectively persistent even though the
         source template omits the flag.  Close both the root and its scrim
         explicitly; this also avoids recursively clicking the scrim. */
      if (target === overlay || (target && target.classList
          && target.classList.contains('v-overlay__scrim'))) forceCloseModOverlay(overlay)
    }, true)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true })
  } else {
    install()
  }
})()
