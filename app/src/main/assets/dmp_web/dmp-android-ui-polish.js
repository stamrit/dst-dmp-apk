/*
 * Android presentation fixes which are intentionally kept outside the
 * generated DMP bundle.  This file only changes the WebView presentation; it
 * does not alter LinuxDMP endpoints or the download queue state machine.
 *
 * The target WebView is older than the desktop browser, therefore this file
 * deliberately uses ES5 syntax and keeps every enhancement idempotent.  Vue
 * can replace a toolbar/card at any time, so the small DOM decorations are
 * repeated by a bounded observer rather than retaining references to stale
 * nodes.
 */
(function () {
  'use strict'

  var STYLE_ID = 'android-dmp-ui-polish-style'
  var ROOM_RUNNING_CLASS = 'android-room-running-chip'
  var roomCache = []
  var roomCacheAt = 0
  var roomFetchPromise = null
  var screenCache = {}
  var roomSubbarBattery = null
  var roomSubbarBatteryReady = false
  var roomSubbarTimer = 0
  var roomSubbarPositionReady = false
  var roomSubbarPositionFrame = 0
  var roomSubbarScrollReady = false
  var roomSubbarScrollFrame = 0
  var roomSubbarScrollTarget = null

  function text(value) {
    return value === undefined || value === null ? '' : String(value)
  }

  function number(value, fallback) {
    var parsed = Number(value)
    return isFinite(parsed) ? parsed : (fallback || 0)
  }

  function getBootstrap() {
    try {
      if (window.AndroidDmp && typeof window.AndroidDmp.getBootstrap === 'function') {
        return JSON.parse(window.AndroidDmp.getBootstrap() || '{}') || {}
      }
    } catch (ignored) {}
    return {}
  }

  function apiBase() {
    var boot = getBootstrap()
    return text(window.__dmpApiBaseUrl || boot.apiBaseUrl).replace(/\/+$/, '')
  }

  function token() {
    var boot = getBootstrap()
    var value = text(boot.apiToken || '')
    if (!value) {
      try {
        var persisted = JSON.parse(localStorage.getItem('dmp-user') || '{}')
        value = text(persisted && (persisted.token || persisted.apiToken) || '')
      } catch (ignored) {}
    }
    return value
  }

  function isRoomPreview() {
    var boot = getBootstrap()
    return !!(boot && (boot.roomPreview === true || boot.roomPreview === 1))
  }

  // The extra “运行/关闭” chip belongs only to the all-platform management
  // room table (`/platform`).  The room cards shown after entering a single
  // platform (`/rooms`) already have one activation status chip; adding the
  // running chip there makes that status column appear twice.
  function isTotalPlatformOverview() {
    var hash = text(window.location && window.location.hash || '')
    var path = hash.replace(/^#/, '').split('?')[0]
    return /^\/platform(?:\/|$)/i.test(path)
  }

  function androidDownloadEnabled() {
    var value = window.__dmpAndroidDownloadUiEnabled
    if (value === undefined) {
      var boot = getBootstrap()
      value = boot.androidDownloadUi
    }
    return value !== false && value !== 0 && text(value).toLowerCase() !== 'false'
  }

  /* Map preview ----------------------------------------------------------
     The desktop map intentionally gives the canvas most of the viewport
     height.  On a phone/tablet that makes a portrait map feel like a tall
     strip, so keep the original landscape composition as the half-open
     default and let the user switch to an information-below full view.  The
     generated Vue component still owns the canvas and its ResizeObserver;
     these classes only change the surrounding geometry. */
  var MAP_STYLE_ID = 'android-dmp-map-responsive-style'
  var mapMode = 'half'
  var mapModeReady = false
  var mapApplyFrame = 0

  function mapPage() {
    return document.querySelector('.map-page')
  }

  function mapIsTablet(width) {
    /* 600 CSS px keeps ordinary phones in the square/9:16 branch while the
       1200x1920 tablet uses the two-column 9:16 half view requested by the
       mobile design. */
    return width >= 600
  }

  function installMapResponsiveStyle() {
    if (document.getElementById(MAP_STYLE_ID)) return
    var style = document.createElement('style')
    style.id = MAP_STYLE_ID
    style.textContent = [
      '.android-map-mode-toggle{display:inline-flex!important;align-items:center!important;justify-content:center!important;width:40px!important;height:40px!important;min-width:40px!important;border:1px solid rgba(var(--v-border-color),.45)!important;border-radius:10px!important;padding:0!important;background:rgba(var(--v-theme-surface),.5)!important;color:rgb(var(--v-theme-primary))!important;font:inherit!important;cursor:pointer!important;-webkit-tap-highlight-color:transparent!important}',
      '.android-map-mode-toggle i{font-size:21px!important;line-height:1!important}',
      '.android-map-mode-toggle:active{transform:scale(.94)!important;background:rgba(var(--v-theme-primary),.16)!important}',
      '.android-map-mode-toggle:focus,.android-map-mode-toggle:focus-visible{outline:none!important;box-shadow:0 0 0 2px rgba(var(--v-theme-primary),.22)!important}',
      '.android-map-responsive .map-page__body{align-items:start!important}',
      '.android-map-responsive.android-map-full .map-page__body{grid-template-columns:minmax(0,1fr)!important}',
      '.android-map-responsive.android-map-full .map-page__sidebar{width:100%!important;max-width:none!important}',
      '.android-map-responsive.android-map-full .map-page__stage{height:auto!important;min-height:0!important}',
      '.android-map-responsive.android-map-half.android-map-portrait-phone .map-page__body{grid-template-columns:minmax(0,1fr)!important}',
      '.android-map-responsive.android-map-half.android-map-portrait-phone .map-page__stage{height:auto!important;min-height:0!important;aspect-ratio:1 / 1!important}',
      '.android-map-responsive.android-map-half.android-map-portrait-tablet .map-page__stage{height:auto!important;min-height:0!important;aspect-ratio:9 / 16!important}',
      '.android-map-responsive.android-map-full.android-map-portrait-tablet .map-page__stage{aspect-ratio:1 / 1!important}',
      '.android-map-responsive.android-map-full.android-map-portrait-phone .map-page__stage{aspect-ratio:9 / 16!important}',
      '.android-map-responsive.android-map-half.android-map-landscape .map-page__body{grid-template-columns:minmax(0,1fr) minmax(280px,340px)!important}',
      /* A 3:2 landscape canvas keeps the corrected height while avoiding the
         overly-wide 16:9 strip on tablets.  The pixel fallback below applies
         the same ratio when an older WebView ignores aspect-ratio. */
      '.android-map-responsive.android-map-full.android-map-landscape .map-page__stage{aspect-ratio:3 / 2!important}',
      '.android-map-responsive.android-map-full.android-map-landscape .map-page__stage{max-width:calc(100% - 32px)!important;margin-inline:auto!important}',
      '.android-map-responsive.android-map-full.android-map-landscape .map-page__body{padding-inline:clamp(16px,3vw,40px)!important}',
      /* On portrait, keep the two player switches together on their own
         toolbar line below the world/map controls.  The explicit break span
         is used instead of :has() for the older Huawei WebView. */
      '.android-map-responsive.android-map-portrait .map-page__header-main{width:100%!important;max-width:100%!important}',
      '.android-map-switch-break{display:none!important}',
      '.android-map-responsive.android-map-portrait .android-map-switch-break{display:block!important;flex:0 0 100%!important;width:100%!important;height:0!important;margin:0!important;padding:0!important}',
      '.android-map-responsive.android-map-portrait .map-page__header-main>.android-map-player-switch{flex:0 1 auto!important;min-width:0!important;max-width:calc(50% - 8px)!important}',
      '.android-map-responsive.android-map-portrait .map-page__header-main>.android-map-player-switch .v-label{white-space:nowrap!important}',
      '@media (max-width:640px) and (orientation:landscape){.android-map-responsive.android-map-half.android-map-landscape .map-page__body{grid-template-columns:minmax(0,1fr) minmax(248px,32vw)!important}.android-map-responsive.android-map-half.android-map-landscape .map-page__sidebar{max-height:calc(100vh - 150px)!important;overflow-y:auto!important}}',
      '@media (orientation:portrait){.android-map-responsive.android-map-full .map-page__body{padding-inline:clamp(12px,3vw,32px)!important}}'
    ].join('\n')
    document.head.appendChild(style)
  }

  function readMapMode() {
    if (mapModeReady) return mapMode
    mapModeReady = true
    try {
      var stored = localStorage.getItem('dmp-android-map-mode')
      if (stored === 'full' || stored === 'half') mapMode = stored
    } catch (ignored) {}
    return mapMode
  }

  function mapModeButton(page) {
    var header = page && page.querySelector('.map-page__header-main')
    if (!header) return null
    var button = header.querySelector('.android-map-mode-toggle')
    if (!button) {
      button = document.createElement('button')
      button.type = 'button'
      button.className = 'android-map-mode-toggle'
      button.setAttribute('data-android-map-mode-toggle', '1')
      var select = header.querySelector('.map-page__world-select')
      if (select && select.parentNode === header) header.insertBefore(button, select.nextSibling)
      else header.appendChild(button)
      button.addEventListener('click', function (event) {
        event.preventDefault()
        event.stopPropagation()
        mapMode = mapMode === 'full' ? 'half' : 'full'
        try { localStorage.setItem('dmp-android-map-mode', mapMode) } catch (ignored) {}
        scheduleMapResponsive()
      })
    }
    var full = readMapMode() === 'full'
    button.setAttribute('aria-label', full ? '收起地图' : '展开地图')
    button.setAttribute('aria-pressed', full ? 'true' : 'false')
    button.title = full ? '收起地图（信息回到右侧）' : '展开地图（信息移到下方）'
    var iconClass = full ? 'ri-layout-bottom-line' : 'ri-layout-right-line'
    var icon = button.firstElementChild
    if (!icon || icon.className !== iconClass) {
      button.innerHTML = '<i class="' + iconClass + '"></i>'
    }
    return button
  }

  function scheduleMapResponsive() {
    if (mapApplyFrame) {
      try { window.cancelAnimationFrame(mapApplyFrame) } catch (ignored) {}
      mapApplyFrame = 0
    }
    var raf = window.requestAnimationFrame || function (fn) { return window.setTimeout(fn, 16) }
    mapApplyFrame = raf(function () {
      mapApplyFrame = 0
      var raf2 = window.requestAnimationFrame || function (fn) { return window.setTimeout(fn, 16) }
      mapApplyFrame = raf2(function () {
        mapApplyFrame = 0
        applyMapResponsive()
      })
    })
  }

  function decorateMapHeader(page, portrait) {
    var main = page && page.querySelector('.map-page__header-main')
    if (!main) return
    var switches = main.querySelectorAll('.v-switch')
    if (!switches || !switches.length) {
      switches = main.querySelectorAll('[class*="v-switch"]')
    }
    Array.prototype.forEach.call(switches || [], function (item) {
      item.classList.add('android-map-player-switch')
    })
    var first = switches && switches.length ? switches[0] : null
    var breaker = main.querySelector('.android-map-switch-break')
    if (portrait && first) {
      if (!breaker) {
        breaker = document.createElement('span')
        breaker.className = 'android-map-switch-break'
      }
      if (breaker.parentNode !== main || breaker.nextSibling !== first) {
        main.insertBefore(breaker, first)
      }
    } else if (breaker) {
      breaker.remove()
    }
  }

  function applyMapResponsive() {
    var page = mapPage()
    if (!page) return
    installMapResponsiveStyle()
    mapModeButton(page)
    var width = window.innerWidth || (window.visualViewport && window.visualViewport.width) || 0
    var height = window.innerHeight || (window.visualViewport && window.visualViewport.height) || 0
    var landscape = width > height
    var tablet = mapIsTablet(width)
    decorateMapHeader(page, !landscape)
    page.classList.add('android-map-responsive')
    page.classList.toggle('android-map-half', readMapMode() !== 'full')
    page.classList.toggle('android-map-full', readMapMode() === 'full')
    page.classList.toggle('android-map-landscape', landscape)
    page.classList.toggle('android-map-portrait', !landscape)
    page.classList.toggle('android-map-portrait-tablet', !landscape && tablet)
    page.classList.toggle('android-map-portrait-phone', !landscape && !tablet)
    page.classList.toggle('android-map-tablet', tablet)
    page.classList.toggle('android-map-phone', !tablet)
    /* Older Huawei WebViews may not implement CSS aspect-ratio.  Set the
       corresponding pixel height as a fallback after the grid has reflowed;
       the canvas component observes this resize and redraws itself. */
    var stage = page.querySelector('.map-page__stage')
    if (stage) {
      var stageWidth = stage.getBoundingClientRect ? stage.getBoundingClientRect().width : 0
      var stageHeight = 0
      var full = readMapMode() === 'full'
      var landscapeAvailableHeight = 0
      if (landscape) {
        /* Use a stable top/bottom margin based on the fixed mobile bars
           instead of the current scroll offset so scrolling cannot resize
           the map.  Full view additionally derives its width from this
           height; half view keeps the sidebar/grid width unchanged. */
        var navbar = document.querySelector('.layout-navbar')
        var navbarHeight = navbar && navbar.getBoundingClientRect
          ? navbar.getBoundingClientRect().height : 64
        var header = page.querySelector('.map-page__header')
        var headerHeight = header && header.getBoundingClientRect
          ? header.getBoundingClientRect().height : 68
        /* The time/battery bar shares the navbar band; it does not consume a
           second vertical row in the map's available-height calculation. */
        var roomBarHeight = 0
        /* Use nearly the complete visible height.  The previous 32px reserve
           made landscape maps noticeably short; the body still has its own
           padding and the max-width rule prevents clipping horizontally. */
        landscapeAvailableHeight = Math.max(260, height - navbarHeight - roomBarHeight
          - headerHeight - 8)
        if (full) {
          stageHeight = landscapeAvailableHeight
           var body = page.querySelector('.map-page__body')
           var bodyRect = body && body.getBoundingClientRect
             ? body.getBoundingClientRect() : null
           var availableWidth = bodyRect && bodyRect.width > 0
             ? bodyRect.width - 32 : width - 32
           availableWidth = Math.max(320, Math.round(availableWidth))
           /* Full landscape mode has no right-hand information column.
              Prefer the whole usable body width so the map feels close to
              full-screen; the height remains capped by the visible viewport
              and the page can scroll naturally when a very wide display is
              used. */
           var targetWidth = availableWidth
          stage.style.setProperty('width', targetWidth + 'px', 'important')
           stage.style.setProperty('max-width', 'calc(100% - 32px)', 'important')
           stage.style.setProperty('margin-inline', 'auto', 'important')
          stageWidth = targetWidth
        }
      } else {
        stage.style.removeProperty('width')
        stage.style.removeProperty('max-width')
        stage.style.removeProperty('margin-inline')
      }
      if (!landscape) {
        /* The Vue map component also writes a mobile height (Tn) to this
           stage.  Let the responsive aspect-ratio rule own portrait sizing;
           writing another important pixel height here caused a visible
           second transform after switching half/full mode. */
        stage.style.removeProperty('height')
      } else if (stageWidth > 0) {
        if (!stageHeight && !landscape && full && tablet) stageHeight = stageWidth
        else if (!stageHeight && !landscape && full && !tablet) stageHeight = stageWidth * 16 / 9
        else if (!stageHeight && !landscape && !full && tablet) stageHeight = stageWidth * 16 / 9
        else if (!stageHeight && !landscape && !full && !tablet) stageHeight = stageWidth
        else if (!stageHeight && landscape && full) stageHeight = stageWidth * 2 / 3
        else if (!stageHeight && landscape) {
          /* Half-open landscape keeps the information sidebar on the right,
             but the map itself should still use the available viewport
             height instead of the old 360px desktop minimum. */
          stageHeight = landscapeAvailableHeight || Math.max(360, height - (tablet ? 420 : 360))
        } else if (!stageHeight) stageHeight = Math.max(360, height - (tablet ? 420 : 360))
      }
      if (landscape && stageHeight > 0) {
        var wantedHeight = Math.round(stageHeight) + 'px'
        if (stage.style.getPropertyValue('height') !== wantedHeight
            || stage.style.getPropertyPriority('height') !== 'important') {
          stage.style.setProperty('height', wantedHeight, 'important')
        }
      }
    }
  }

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return
    var style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = [
      /* Keep the mobile toolbar fixed while the active page scrolls; the
         route wrapper reserves the matching top inset below. */
      'body.android-platform-view .layout-navbar,body.android-room-preview .layout-navbar{position:fixed!important;inset-block-start:0!important;top:0!important;inset-inline-start:0!important;inset-inline-end:0!important;left:0!important;right:0!important;width:100%!important;max-width:100vw!important;z-index:2147483638!important;flex:0 0 auto!important;min-width:0!important;background:rgb(var(--v-theme-background))!important}',
      /* The new time/battery bar shares the navbar's screen band.  It is a
         lower, independent layer rather than an extra vertical row: status
         bar -> navbar/subbar band -> page content.  Transparent navbar
         containers let the clock show through the empty toolbar area while
         the room picker/buttons remain above it. */
      /* On the special long pages the official toolbar starts opaque and
         scrolls away with the document.  The fixed subbar is intentionally
         underneath it, so its clock/battery never paint over the menu button
         or room picker.  Once the toolbar has moved off-screen the subbar is
         exposed at the same y=0 band. */
      'body.android-room-subbar-active .layout-navbar{inset-block-start:var(--android-room-navbar-top,0px)!important;top:var(--android-room-navbar-top,0px)!important;left:0!important;right:0!important;transform:translate3d(0,calc(-1 * var(--android-room-scroll-offset,0px)),0)!important;background:rgb(var(--v-theme-background))!important}',
      'body.android-room-subbar-active .layout-navbar .navbar-content-container{background:rgb(var(--v-theme-background))!important}',
      'body.android-platform-view .layout-navbar .navbar-content-container,body.android-room-preview .layout-navbar .navbar-content-container{min-width:0!important;width:100%!important;max-width:100%!important}',
      'body.android-platform-view .layout-wrapper,body.android-room-preview .layout-wrapper{min-width:0!important;max-width:100vw!important;width:100%!important}',
      'body.android-platform-view .layout-content-wrapper{padding-top:var(--android-room-navbar-height,64px)!important}',
      /* The extra 36px belongs to the dashboard/map/backup subbar.  Keep a
         normal navbar inset on map and other routes so switching pages does
         not leave a second, empty transform-sized band. */
      'body.android-room-preview .layout-content-wrapper{padding-top:var(--android-room-navbar-height,64px)!important}',
      'body.android-room-preview .layout-content-wrapper,body.android-room-preview .layout-page-content,body.android-room-preview .page-content-container,body.android-room-preview .v-main,body.android-room-preview .v-main__wrap{margin-inline:0!important;padding-inline:0!important;inset-inline-start:0!important;min-inline-size:0!important;max-inline-size:100vw!important;width:100vw!important;box-sizing:border-box!important}',
      /* The bridge gives the content wrapper an identity transform and
         z-index:2.  Even translateX(0) creates a stacking context, so the
         navbar's larger child z-index can no longer rise above the
         body-level room subbar; the clock/battery strip then paints over the
         menu and room controls.  Keep the wrapper in the root stacking
         context at rest.  When a drawer is open, express the same horizontal
         hand-off with margin/width rather than transform so the navbar keeps
         its independent z-index while the content still leaves room for the
         drawer. */
      'body.android-platform-view .layout-content-wrapper,body.android-room-preview .layout-content-wrapper{z-index:auto!important;transform:none!important;will-change:auto!important}',
      'body.android-platform-view.android-platform-menu-open .layout-content-wrapper{margin-inline-start:var(--android-platform-menu-width,260px)!important;width:calc(100% - var(--android-platform-menu-width,260px))!important;max-width:calc(100% - var(--android-platform-menu-width,260px))!important;transform:none!important;will-change:auto!important}',
      'body.android-room-preview.android-room-menu-open .layout-content-wrapper{margin-inline-start:88px!important;width:calc(100% - 88px)!important;max-width:calc(100% - 88px)!important;transform:none!important;will-change:auto!important}',
      /* Keep the injected room selector on the toolbar row, never in the old
         room label's flex/clip context. */
      /* The upstream navbar is fixed without a positional easing.  The
         injected room picker must follow that same rule; a transition here
         was being restarted by the 120ms layout guard on every scroll/frame,
         making the chip visibly trail the toolbar. */
      /* The room picker is the one control that remains fixed above the
         scrolling navbar.  When the navbar leaves the viewport it is still
         intentionally visible over the newly exposed subbar. */
      '.android-room-picker-wrap{position:fixed!important;z-index:2147483647!important;pointer-events:auto!important;max-width:calc(100vw - 92px)!important;will-change:top,left,max-width;backface-visibility:hidden;transition:none!important}',
      '.android-room-picker{transition:transform .08s ease-out,background-color .08s ease,color .08s ease!important;will-change:transform}',
      '.android-room-picker-panel{z-index:2147483646!important;overscroll-behavior:contain!important}',
      /* Menu touches may scroll the left list, but must not drag the right
         content pane horizontally in the opposite direction. */
      'body.android-platform-view .layout-vertical-nav{touch-action:pan-y!important;overscroll-behavior-x:none!important;overscroll-behavior-y:contain!important;overflow-y:auto!important;max-height:100vh!important;height:100vh!important}',
      'body.android-platform-view .layout-vertical-nav .vertical-nav-items-shadow{display:none!important}',
      'body.android-platform-view .layout-vertical-nav > *{min-height:0!important}',
      'body.android-platform-view .layout-vertical-nav .nav-items.ps,body.android-platform-view .layout-vertical-nav .vertical-nav-items.ps{flex:1 1 auto!important;min-height:0!important;height:auto!important;max-height:none!important;overflow-y:auto!important;overflow-x:hidden!important;touch-action:pan-y!important;overscroll-behavior-y:contain!important}',
      '.android-menu-close-hidden{display:none!important;visibility:hidden!important;pointer-events:none!important}',
      /* The generated room form keeps the token actions beside the input on
         desktop.  On a phone the actions must occupy their own row below the
         token field, before the master IP field. */
      '.android-token-row{display:flex!important;flex-wrap:wrap!important;align-items:flex-start!important;min-width:0!important}',
      '.android-token-row>.v-input{flex:1 1 100%!important;min-width:100%!important;max-width:100%!important}',
      '.android-token-row>.v-btn,.android-token-row>.android-token-actions{flex:0 0 auto!important;margin-inline-start:0!important;margin-inline-end:8px!important;margin-top:4px!important}',
      /* Keep the two token actions on their own left-aligned row.  The
         upstream mobile template renders the cloud action as icon-only; the
         Android form replaces it with the same text+icon treatment used by
         the open-source web form (默认令牌 / 从云端选择). */
      '.android-token-actions{display:flex!important;align-items:center!important;justify-content:flex-start!important;flex:1 1 100%!important;flex-basis:100%!important;width:100%!important;max-width:100%!important;flex-wrap:wrap!important;gap:4px!important;margin-inline-start:0!important}',
      '.android-token-action{min-width:0!important;white-space:nowrap!important}',
      '.android-token-default{color:rgb(var(--v-theme-success))!important}',
      '.android-token-cloud{color:rgb(var(--v-theme-primary))!important}',
      'body.android-platform-view .layout-content-wrapper{overscroll-behavior-x:none!important}',
      /* The name gets all free width; status/selection/menu controls stay at
         the far right.  Existing bridge classes are used when present and
         these selectors also cover a freshly-created Vue card. */
      '.android-room-card-header{display:flex!important;align-items:center!important;gap:8px!important;width:100%!important;min-width:0!important}',
      '.android-room-card-header>.android-room-card-name{flex:1 1 auto!important;min-width:0!important;max-width:none!important;overflow:hidden!important}',
      '.android-room-card-header>.android-room-card-name .v-chip__content{max-width:none!important;overflow:visible!important;text-overflow:clip!important;white-space:nowrap!important}',
      '.android-room-card-header>.android-room-card-controls{display:flex!important;align-items:center!important;justify-content:flex-end!important;flex:0 0 auto!important;margin-inline-start:auto!important;white-space:nowrap!important}',
      '.android-room-card-header>.android-room-card-menu{flex:0 0 auto!important;margin-inline-start:0!important}',
      '.android-room-running-chip{margin-inline-start:4px!important}',
      '.android-room-running-chip.android-running{color:rgb(var(--v-theme-success))!important}',
      '.android-room-running-chip.android-stopped{color:rgb(var(--v-theme-warning))!important}',
      /* The generated room header is a flex row.  A long room name must
         consume only the width left after status, selection and menu slots;
         allowing the chip's intrinsic width makes the whole card overflow on
         narrow phones. */
      '.android-room-card-header{box-sizing:border-box!important;max-width:100%!important;overflow:hidden!important;gap:8px!important}',
      '.android-room-card-header>.android-room-card-name{box-sizing:border-box!important;flex:1 1 auto!important;min-width:0!important;max-width:100%!important;overflow:hidden!important}',
      '.android-room-card-header>.android-room-card-name>.v-chip{box-sizing:border-box!important;display:flex!important;flex:1 1 auto!important;min-width:0!important;max-width:100%!important;overflow:hidden!important}',
      '.android-room-card-header>.android-room-card-name>.v-chip .v-chip__content{display:block!important;min-width:0!important;max-width:100%!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}',
      '.android-room-card-header>.android-room-card-controls{box-sizing:border-box!important;flex:0 0 auto!important;min-width:0!important;max-width:100%!important;gap:6px!important;overflow:hidden!important}',
      '.android-room-card-header>.android-room-card-controls>*{flex:0 0 auto!important;min-width:0!important}',
      '.android-room-selection-slot{box-sizing:border-box!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;flex:0 0 40px!important;width:40px!important;min-width:40px!important;height:40px!important;margin-inline-start:2px!important}',
      '.android-room-selection-slot.android-room-selection-placeholder{visibility:hidden!important;pointer-events:none!important}',
      /* Keep the preview page genuinely full width after entering from the
         native aggregate overview; the upstream vertical drawer can leave a
         stale grid column/padding behind even when it is hidden. */
      'html.android-room-preview,body.android-room-preview{overflow-x:hidden!important;min-width:0!important;width:100%!important}',
      'body.android-room-preview .layout-wrapper,body.android-room-preview .layout-wrapper.layout-nav-type-vertical{display:block!important;position:relative!important;min-width:0!important;width:100%!important;max-width:100%!important;margin:0!important;padding:0!important}',
      'body.android-room-preview .layout-vertical-nav{display:none!important;inline-size:0!important;min-inline-size:0!important;width:0!important;margin:0!important;padding:0!important}',
      'html.android-room-preview,body.android-room-preview,.android-room-preview .layout-wrapper{--v-layout-left:0px!important;--v-layout-right:0px!important;--v-layout-top:0px!important}',
      'body.android-room-preview .layout-content-wrapper,body.android-room-preview .layout-page-content,body.android-room-preview .page-content-container,body.android-room-preview .v-main,body.android-room-preview .v-main__wrap,body.android-room-preview .v-container{box-sizing:border-box!important;position:relative!important;min-width:0!important;width:100%!important;max-width:100%!important;flex:1 1 100%!important;margin:0!important;margin-inline:0!important;margin-left:0!important;padding-left:0!important;padding-inline-start:0!important;inset-inline-start:0!important;left:0!important;right:0!important}',
      'body.android-room-preview .layout-content-wrapper{overflow-x:hidden!important}',
      /* Match the navbar's fixed band.  The bar is body-level and lower than
         the navbar, so its text is visible only where the toolbar is empty;
         pointer events never steal room/menu taps. */
      /* Use physical left/right in addition to logical insets.  Some tablet
         WebViews (especially after a rotation) ignore inset-inline-* on a
         fixed element, which leaves the subbar at its pre-rotation width. */
      '.android-room-subbar{display:flex!important;align-items:center!important;gap:10px!important;box-sizing:border-box!important;position:fixed!important;inset-block-start:0!important;top:0!important;inset-block-end:auto!important;left:0!important;right:0!important;inset-inline-start:0!important;inset-inline-end:0!important;width:100%!important;height:var(--android-room-navbar-height,64px)!important;min-height:var(--android-room-navbar-height,64px)!important;margin:0!important;padding:5px 12px!important;background:rgb(var(--v-theme-background))!important;border-bottom:1px solid rgba(var(--v-border-color),.16)!important;color:rgba(var(--v-theme-on-background),.74)!important;font-size:12px!important;line-height:26px!important;white-space:nowrap!important;overflow:hidden!important;z-index:2147483630!important;pointer-events:none!important;isolation:isolate;contain:layout paint style;will-change:left,right,width,inset-inline-start,inset-inline-end;backface-visibility:hidden;transition:left .08s ease-out,right .08s ease-out,width .08s ease-out,inset-inline-start .08s ease-out,inset-inline-end .08s ease-out}',
      'body.android-platform-menu-open .android-room-subbar{left:var(--android-platform-menu-width,260px)!important;right:0!important;inset-inline-start:var(--android-platform-menu-width,260px)!important;inset-inline-end:0!important;width:auto!important}',
      'body.android-room-menu-open .android-room-subbar{left:88px!important;right:0!important;inset-inline-start:88px!important;inset-inline-end:0!important;width:auto!important}',
      '.android-room-subbar-name{min-width:0!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;font-weight:600!important;color:rgb(var(--v-theme-primary))!important}',
      '.android-room-subbar-spacer{flex:1 1 auto!important;min-width:8px!important}',
      '.android-room-subbar-time,.android-room-subbar-battery{flex:0 0 auto!important;font-variant-numeric:tabular-nums!important;color:rgba(var(--v-theme-on-background),.58)!important}',
      '.android-room-subbar-battery[hidden]{display:none!important}',
      'body.android-room-preview .android-room-subbar+*{scroll-margin-top:var(--android-room-navbar-height,0px)!important}',
      /* Portrait tables use a two-row, three-column grid.  The table/header
         controls remain live buttons, so clicking any sortable header still
         delegates to Vuetify exactly as on desktop. */
      /* Do not squeeze the portrait tables into zero-width grid tracks.  A
         narrow phone may scroll the compact two-line table horizontally by a
         few pixels, but values and action controls remain readable. */
      /* Vuetify 3 renders the scroll container as `.v-table__wrapper`
         (older bundles used `.v-data-table__wrapper`).  The old-only
         selector left current WebViews with the table's 360/440px minimum
         width clipped by the page's overflow-x:hidden shell, so the last
         columns looked missing instead of being reachable by a finger swipe. */
      '.android-dashboard-world-table .v-table__wrapper,.android-backup-table .v-table__wrapper,.android-snapshot-table .v-table__wrapper,.android-dashboard-world-table .v-data-table__wrapper,.android-backup-table .v-data-table__wrapper,.android-snapshot-table .v-data-table__wrapper{overflow-x:auto!important;width:100%!important;max-width:100%!important;-webkit-overflow-scrolling:touch!important;overscroll-behavior-x:contain!important}',
      /* Avoid CSS `max()` here: the target Huawei WebView accepts the table
         only when width is a plain percentage plus an explicit minimum.  The
         wrapper then supplies a small, intentional horizontal scroll on
         narrow phones instead of clipping the last action/status column. */
      /* Keep enough room for the complete memory value (for example
         `45.00% (10 MB)`) and for the status switch.  The previous 360px
         track gave the third column only about 140px; Vuetify then clipped
         the closing parenthesis and the switch thumb on narrow phones.  A
         slightly wider track is intentional: the wrapper above provides
         touch horizontal scrolling when a very narrow split-screen cannot
         show all three columns at once. */
      '.android-dashboard-world-table table{display:block!important;width:100%!important;min-width:420px!important;table-layout:fixed!important}',
      '.android-backup-table table{display:block!important;width:100%!important;min-width:440px!important;table-layout:fixed!important}',
      '.android-dashboard-world-table thead,.android-dashboard-world-table tbody,.android-backup-table thead,.android-backup-table tbody{display:block!important;width:100%!important}',
      '.android-dashboard-world-table thead>tr,.android-dashboard-world-table tbody>tr{display:grid!important;grid-template-columns:minmax(120px,1.15fr) minmax(100px,.95fr) minmax(180px,1.9fr)!important;grid-template-rows:minmax(24px,auto) minmax(24px,auto)!important;align-items:center!important;row-gap:0!important;width:100%!important;min-width:420px!important;box-sizing:border-box!important}',
      '.android-backup-table thead>tr,.android-backup-table tbody>tr{display:grid!important;grid-template-columns:minmax(32px,.38fr) minmax(124px,1.55fr) minmax(72px,1fr) minmax(128px,1.2fr)!important;grid-template-rows:minmax(24px,auto) minmax(24px,auto)!important;align-items:center!important;row-gap:0!important;width:100%!important;min-width:440px!important;box-sizing:border-box!important}',
      '.android-dashboard-world-table thead th,.android-dashboard-world-table tbody td,.android-backup-table thead th,.android-backup-table tbody td{display:flex!important;align-items:center!important;box-sizing:border-box!important;min-width:0!important;width:auto!important;max-width:none!important;height:auto!important;min-height:24px!important;padding:1px 8px!important;white-space:normal!important;overflow:hidden!important}',
      '.android-dashboard-world-table .v-data-table-header__content,.android-backup-table .v-data-table-header__content{min-height:20px!important;line-height:20px!important}',
      /* Give the two-line headings deliberate outer breathing room.  The
         final contiguous-header override below removes the internal gap;
         this baseline remains for older table revisions that omit it. */
      '.android-dashboard-world-table thead>tr,.android-backup-table thead>tr{grid-template-rows:minmax(16px,auto) minmax(16px,auto)!important;row-gap:0!important}',
      '.android-dashboard-world-table thead>tr,.android-backup-table thead>tr{padding-block:5px!important;row-gap:5px!important}',
      '.android-dashboard-world-table tbody>tr,.android-backup-table tbody>tr{padding-block:5px!important;row-gap:0!important}',
      '.android-dashboard-world-table thead th,.android-backup-table thead th{min-height:16px!important;height:16px!important;padding-block:0!important;line-height:15px!important}',
      '.android-dashboard-world-table thead .v-data-table-header__content,.android-backup-table thead .v-data-table-header__content{min-height:15px!important;height:15px!important;line-height:15px!important}',
      '.android-dashboard-world-table thead th button,.android-backup-table thead th button,.android-dashboard-world-table thead th .v-btn,.android-backup-table thead th .v-btn{--v-btn-height:16px!important;height:16px!important;min-height:16px!important;padding-block:0!important;line-height:15px!important}',
      /* Vuetify's density rule has higher specificity on the backup table
         (because it includes the selection-checkbox column).  Reset that
         default header height so the requested 5px top/middle/bottom spacing
         is the same there as on the dashboard table. */
      '.android-backup-table.v-table>.v-table__wrapper>table>thead>tr>th{height:auto!important;min-height:16px!important;padding-block:0!important;line-height:15px!important}',
      '.android-backup-table.v-table>.v-table__wrapper>table>thead>tr>th:nth-child(1) .v-selection-control,.android-backup-table.v-table>.v-table__wrapper>table>thead>tr>th:nth-child(1) .v-selection-control__wrapper,.android-backup-table.v-table>.v-table__wrapper>table>thead>tr>th:nth-child(1) .v-selection-control__input{width:24px!important;min-width:24px!important;height:24px!important;min-height:24px!important}',
      '.android-dashboard-world-table thead th:nth-child(1),.android-dashboard-world-table tbody td:nth-child(1),.android-backup-table thead th:nth-child(1),.android-backup-table tbody td:nth-child(1){grid-column:1!important;grid-row:1!important}',
      '.android-dashboard-world-table thead th:nth-child(2),.android-dashboard-world-table tbody td:nth-child(2),.android-backup-table thead th:nth-child(2),.android-backup-table tbody td:nth-child(2){grid-column:1!important;grid-row:2!important}',
      '.android-dashboard-world-table thead th:nth-child(3),.android-dashboard-world-table tbody td:nth-child(3),.android-backup-table thead th:nth-child(3),.android-backup-table tbody td:nth-child(3){grid-column:2!important;grid-row:1!important}',
      '.android-dashboard-world-table thead th:nth-child(4),.android-dashboard-world-table tbody td:nth-child(4),.android-backup-table thead th:nth-child(4),.android-backup-table tbody td:nth-child(4){grid-column:3!important;grid-row:1!important}',
      '.android-dashboard-world-table thead th:nth-child(5),.android-dashboard-world-table tbody td:nth-child(5),.android-backup-table thead th:nth-child(5),.android-backup-table tbody td:nth-child(5){grid-column:2!important;grid-row:2!important}',
      '.android-dashboard-world-table thead th:nth-child(6),.android-dashboard-world-table tbody td:nth-child(6),.android-backup-table thead th:nth-child(6),.android-backup-table tbody td:nth-child(6){grid-column:3!important;grid-row:2!important}',
      /* Backup rows include the selection checkbox as column 1.  Keep the
         room name beside that checkbox on line one; only backup timestamp
         and actions belong on line two.  (The dashboard world table uses a
         different six-column order and keeps the mappings above.) */
      '.android-backup-table thead>tr,.android-backup-table tbody>tr{grid-template-columns:minmax(32px,.38fr) minmax(124px,1.55fr) minmax(72px,1fr) minmax(128px,1.2fr)!important;min-width:440px!important}',
      '.android-backup-table thead th:nth-child(1),.android-backup-table tbody td:nth-child(1){grid-column:1!important;grid-row:1!important}',
      '.android-backup-table thead th:nth-child(2),.android-backup-table tbody td:nth-child(2){grid-column:2!important;grid-row:1!important}',
      '.android-backup-table thead th:nth-child(3),.android-backup-table tbody td:nth-child(3){grid-column:3!important;grid-row:1!important}',
      '.android-backup-table thead th:nth-child(4),.android-backup-table tbody td:nth-child(4){grid-column:4!important;grid-row:1!important}',
      '.android-backup-table thead th:nth-child(5),.android-backup-table tbody td:nth-child(5){grid-column:2!important;grid-row:2!important}',
      '.android-backup-table thead th:nth-child(6),.android-backup-table tbody td:nth-child(6){grid-column:4!important;grid-row:2!important}',
      '.android-dashboard-world-table tbody td:nth-child(1) .v-chip,.android-dashboard-world-table tbody td:nth-child(2) .v-chip,.android-backup-table tbody td .v-chip{max-width:100%!important;overflow:visible!important;text-overflow:clip!important;white-space:normal!important;overflow-wrap:anywhere!important;height:auto!important;min-height:24px!important}',
      /* Memory and status are the rightmost cells in the two-line world
         table.  Let their contents use the newly reserved track instead of
         clipping at the old cell edge, and give the status control a small
         right inset so its action area is not flush against the card edge. */
      '.android-dashboard-world-table tbody td:nth-child(4){min-width:180px!important;padding-inline-start:14px!important;padding-inline-end:18px!important;overflow:visible!important;white-space:nowrap!important}',
      '.android-dashboard-world-table tbody td:nth-child(4) .v-chip{max-width:none!important;white-space:nowrap!important;overflow:visible!important}',
      '.android-dashboard-world-table tbody td:nth-child(6){min-width:180px!important;padding-inline-start:14px!important;padding-inline-end:18px!important;overflow:visible!important;justify-content:flex-start!important}',
      '.android-dashboard-world-table tbody td:nth-child(6) .v-selection-control,.android-dashboard-world-table tbody td:nth-child(6) .v-switch{flex:0 0 auto!important;min-width:52px!important;margin-inline-start:4px!important;margin-inline-end:6px!important}',
      /* Keep the two portrait heading lines as one contiguous band.  The
         previous spacing patch applied a 5px grid gap in addition to the
         row padding, leaving a visible hole between the title backgrounds.
         Give the rows their requested outer breathing room but no internal
         gap, and let one row-level background draw the whole header. */
      '.android-dashboard-world-table thead>tr,.android-backup-table thead>tr{grid-template-rows:minmax(20px,auto) minmax(20px,auto)!important;row-gap:0!important;padding-block:5px!important;background:rgb(var(--v-table-header-color))!important;border-bottom:1px solid rgba(var(--v-border-color),.16)!important}',
      '.android-dashboard-world-table thead th,.android-backup-table thead th{height:20px!important;min-height:20px!important;padding-block:0!important;border:0!important;background:transparent!important;line-height:20px!important}',
      /* Vuetify marks its header background important with a more specific
         selector than the generic th rule above.  Match that specificity so
         the row-level background can span the blank checkbox cell as well. */
      '.android-dashboard-world-table.v-table>.v-table__wrapper>table>thead>tr>th,.android-backup-table.v-table>.v-table__wrapper>table>thead>tr>th{background:transparent!important}',
      '.android-dashboard-world-table.v-table>.v-table__wrapper>table>thead>tr>th,.android-backup-table.v-table>.v-table__wrapper>table>thead>tr>th{height:20px!important;min-height:20px!important;padding-block:0!important;line-height:20px!important}',
      '.android-dashboard-world-table thead .v-data-table-header__content,.android-backup-table thead .v-data-table-header__content{height:20px!important;min-height:20px!important;line-height:20px!important;background:transparent!important}',
      /* A data-row is one logical record even though its cells occupy two
         visual grid lines on portrait phones.  Draw the separator once on
         the row; per-cell borders made broken, staggered lines around each
         chip and action column. */
      '.android-dashboard-world-table tbody>tr,.android-backup-table tbody>tr{border-bottom:1px solid rgba(var(--v-border-color),.16)!important}',
      '.android-dashboard-world-table tbody td,.android-backup-table tbody td{border:0!important;border-bottom:0!important}',
      /* The first portrait world-information column was flush against the
         card edge. Give the world name and master-node lines a small, stable
         inset without moving CPU/memory/disk columns. */
      '.android-dashboard-world-table thead th:nth-child(1),.android-dashboard-world-table thead th:nth-child(2),.android-dashboard-world-table tbody td:nth-child(1),.android-dashboard-world-table tbody td:nth-child(2){padding-inline-start:16px!important}',
      /* Final portrait-width pass: keep the memory value (including its
         closing size parenthesis) and the status/action control inside a
         real third track.  The previous 180px minimum was still too narrow
         on phones once Vuetify added cell padding, so the right-hand track
         now starts a little farther right and remains horizontally reachable
         through the wrapper's touch scroll. */
      '.android-dashboard-world-table table{min-width:460px!important}',
      '.android-dashboard-world-table thead>tr,.android-dashboard-world-table tbody>tr{grid-template-columns:minmax(124px,1.08fr) minmax(108px,.94fr) minmax(228px,1.98fr)!important;min-width:460px!important}',
      '.android-dashboard-world-table tbody td:nth-child(4),.android-dashboard-world-table tbody td:nth-child(6){min-width:228px!important;padding-inline-start:20px!important;padding-inline-end:24px!important;overflow:visible!important}',
      '.android-dashboard-world-table tbody td:nth-child(4) .v-chip{padding-inline:4px!important}',
      '.android-dashboard-world-table tbody td:nth-child(6) .v-selection-control,.android-dashboard-world-table tbody td:nth-child(6) .v-switch{margin-inline-start:8px!important;margin-inline-end:10px!important}',
      /* Backup action buttons share the same right-edge problem on narrow
         screens.  Reserve a wider action track while keeping the checkbox and
         room-name columns stable. */
      '.android-backup-table table{min-width:480px!important}',
      '.android-backup-table thead>tr,.android-backup-table tbody>tr{grid-template-columns:minmax(36px,.34fr) minmax(132px,1.36fr) minmax(80px,.78fr) minmax(170px,1.52fr)!important;min-width:480px!important}',
      '.android-backup-table tbody td:nth-child(6){min-width:170px!important;padding-inline-start:18px!important;padding-inline-end:20px!important;overflow:visible!important;justify-content:flex-start!important}',
      '.android-backup-table tbody td:nth-child(6) .v-btn{flex:0 0 auto!important;margin-inline-start:4px!important;margin-inline-end:4px!important}',
      /* The menu item named 游戏存档 is the upstream /tools/snapshot page,
         not the server-backup table above.  Keep that four-column table
         readable on a portrait phone by placing name/size on line one and
         creation time/delete on line two.  Landscape remains the official
         desktop table. */
      '.android-snapshot-table table{display:block!important;width:100%!important;min-width:420px!important;table-layout:fixed!important}',
      '.android-snapshot-table thead,.android-snapshot-table tbody{display:block!important;width:100%!important}',
      '.android-snapshot-table thead>tr,.android-snapshot-table tbody>tr{display:grid!important;grid-template-columns:minmax(190px,1.35fr) minmax(170px,1.15fr)!important;grid-template-rows:minmax(24px,auto) minmax(24px,auto)!important;align-items:center!important;row-gap:0!important;width:100%!important;min-width:420px!important;box-sizing:border-box!important}',
      '.android-snapshot-table thead th,.android-snapshot-table tbody td{display:flex!important;align-items:center!important;box-sizing:border-box!important;min-width:0!important;width:auto!important;max-width:none!important;height:auto!important;min-height:24px!important;padding:1px 10px!important;white-space:normal!important;overflow:hidden!important}',
      '.android-snapshot-table thead>tr{padding-block:5px!important;grid-template-rows:minmax(20px,auto) minmax(20px,auto)!important;background:rgb(var(--v-table-header-color))!important;border-bottom:1px solid rgba(var(--v-border-color),.16)!important}',
      '.android-snapshot-table tbody>tr{padding-block:5px!important;border-bottom:1px solid rgba(var(--v-border-color),.16)!important}',
      '.android-snapshot-table thead th{height:20px!important;min-height:20px!important;padding-block:0!important;border:0!important;background:transparent!important;line-height:20px!important}',
      '.android-snapshot-table thead .v-data-table-header__content{height:20px!important;min-height:20px!important;line-height:20px!important;background:transparent!important}',
      '.android-snapshot-table tbody td{border:0!important}',
      '.android-snapshot-table.v-table>.v-table__wrapper>table>thead>tr>th{height:20px!important;min-height:20px!important;padding-block:0!important;background:transparent!important;line-height:20px!important}',
      '.android-snapshot-table thead th:nth-child(1),.android-snapshot-table tbody td:nth-child(1){grid-column:1!important;grid-row:1!important}',
      '.android-snapshot-table thead th:nth-child(2),.android-snapshot-table tbody td:nth-child(2){grid-column:2!important;grid-row:1!important}',
      '.android-snapshot-table thead th:nth-child(3),.android-snapshot-table tbody td:nth-child(3){grid-column:1!important;grid-row:2!important}',
      '.android-snapshot-table thead th:nth-child(4),.android-snapshot-table tbody td:nth-child(4){grid-column:2!important;grid-row:2!important;min-width:170px!important;padding-inline-start:14px!important;padding-inline-end:14px!important;overflow:visible!important;justify-content:flex-start!important}',
      '.android-snapshot-table tbody td:nth-child(4) .v-btn{flex:0 0 auto!important;margin-inline-start:4px!important;margin-inline-end:4px!important}',
      '.android-snapshot-table tbody td .v-chip{max-width:100%!important;overflow:visible!important;text-overflow:clip!important;white-space:normal!important;overflow-wrap:anywhere!important;height:auto!important;min-height:24px!important}',
      /* A portrait tablet has enough horizontal room for the official
         one-line tables.  Keep the compact two-line grid for phones, but
         restore Vuetify's normal table flow once the shell marks the
         viewport as android-table-wide.  This mirrors the desktop world
         information table and prevents needlessly tall backup rows. */
      'body.android-table-wide .android-dashboard-world-table table,body.android-table-wide .android-backup-table table,body.android-table-wide .android-snapshot-table table{display:table!important;width:100%!important;min-width:0!important;max-width:none!important;table-layout:auto!important}',
      'body.android-table-wide .android-dashboard-world-table thead,body.android-table-wide .android-dashboard-world-table tbody,body.android-table-wide .android-backup-table thead,body.android-table-wide .android-backup-table tbody,body.android-table-wide .android-snapshot-table thead,body.android-table-wide .android-snapshot-table tbody{display:table-header-group!important;width:auto!important}',
      'body.android-table-wide .android-dashboard-world-table tbody,body.android-table-wide .android-backup-table tbody,body.android-table-wide .android-snapshot-table tbody{display:table-row-group!important}',
      'body.android-table-wide .android-dashboard-world-table tr,body.android-table-wide .android-backup-table tr,body.android-table-wide .android-snapshot-table tr{display:table-row!important;width:auto!important;min-width:0!important;min-height:0!important;padding:0!important;grid-template-columns:none!important;grid-template-rows:none!important;column-gap:0!important;row-gap:0!important}',
      'body.android-table-wide .android-dashboard-world-table th,body.android-table-wide .android-dashboard-world-table td,body.android-table-wide .android-backup-table th,body.android-table-wide .android-backup-table td,body.android-table-wide .android-snapshot-table th,body.android-table-wide .android-snapshot-table td{display:table-cell!important;width:auto!important;min-width:0!important;max-width:none!important;height:auto!important;min-height:0!important;padding:6px 10px!important;white-space:normal!important;overflow:visible!important;vertical-align:middle!important;grid-column:auto!important;grid-row:auto!important;justify-content:initial!important}',
      'body.android-table-wide .android-dashboard-world-table thead th,body.android-table-wide .android-backup-table thead th,body.android-table-wide .android-snapshot-table thead th{height:auto!important;min-height:0!important;padding-block:8px!important;line-height:20px!important;background:transparent!important;border:0!important}',
      'body.android-table-wide .android-dashboard-world-table tbody tr,body.android-table-wide .android-backup-table tbody tr,body.android-table-wide .android-snapshot-table tbody tr{border-bottom:1px solid rgba(var(--v-border-color),.16)!important}',
      /* The current backup header still contains the legacy cycle/day field,
         but the Android archive card is intentionally a compact four-label
         view: archive name + size, then creation time + delete.  Hide only
         that mobile-only field and remap the remaining cells into the two
         requested rows; desktop/landscape keeps the official five columns. */
      'body.android-room-portrait .android-backup-table table{min-width:420px!important}',
      'body.android-room-portrait .android-backup-table thead>tr,body.android-room-portrait .android-backup-table tbody>tr{grid-template-columns:minmax(36px,.34fr) minmax(150px,1.45fr) minmax(150px,1.35fr)!important;min-width:420px!important}',
      'body.android-room-portrait .android-backup-table thead th:nth-child(3),body.android-room-portrait .android-backup-table tbody td:nth-child(3){display:none!important}',
      'body.android-room-portrait .android-backup-table thead th:nth-child(1),body.android-room-portrait .android-backup-table tbody td:nth-child(1){grid-column:1!important;grid-row:1!important}',
      'body.android-room-portrait .android-backup-table thead th:nth-child(2),body.android-room-portrait .android-backup-table tbody td:nth-child(2){grid-column:2!important;grid-row:1!important}',
      'body.android-room-portrait .android-backup-table thead th:nth-child(4),body.android-room-portrait .android-backup-table tbody td:nth-child(4){grid-column:3!important;grid-row:1!important}',
      'body.android-room-portrait .android-backup-table thead th:nth-child(5),body.android-room-portrait .android-backup-table tbody td:nth-child(5){grid-column:2!important;grid-row:2!important}',
      'body.android-room-portrait .android-backup-table thead th:nth-child(6),body.android-room-portrait .android-backup-table tbody td:nth-child(6){grid-column:3!important;grid-row:2!important;min-width:150px!important;padding-inline-start:12px!important;padding-inline-end:12px!important}',
      /* The generated navbar is reused across routes; keep it stable while
         content changes underneath it. */
      'body.android-room-preview:not(.android-room-subbar-active) .layout-navbar,body.android-platform-view:not(.android-room-subbar-active) .layout-navbar{opacity:1!important;transform:none!important;transition:none!important;contain:layout style!important}',
      'body.android-room-subbar-active .layout-navbar{opacity:1!important;transition:none!important;contain:layout style!important}',
      /* The one-second tap border is removed by the JS timer; the animation
         itself gives a half-second bright hold followed by a real fade. */
      '.android-ui-tap-feedback{position:relative!important;isolation:isolate!important}',
      '.android-ui-tap-feedback::after{content:"";position:absolute;z-index:20;inset:1px;border:2px solid rgba(145,85,253,.96);border-radius:inherit;pointer-events:none;opacity:1;animation:androidUiTapFade 1s ease forwards}',
      '@keyframes androidUiTapFade{0%,50%{opacity:1;box-shadow:0 0 0 2px rgba(145,85,253,.22),0 0 12px rgba(145,85,253,.62)}100%{opacity:0;box-shadow:0 0 0 0 rgba(145,85,253,0)}}',
      '@media (orientation:landscape) and (min-width:900px){body.android-room-preview .layout-content-wrapper,body.android-room-preview .layout-page-content,body.android-room-preview .page-content-container{min-height:calc(100vh - 64px)!important;height:auto!important}}'
    ].join('\n')
    document.head.appendChild(style)
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

  function toolbar() {
    var nav = document.querySelector('.layout-navbar')
    if (!nav) return null
    return nav.querySelector('.navbar-content-container .d-flex.h-100.align-center')
      || nav.querySelector('.navbar-content-container') || nav
  }

  function currentRoomName() {
    var boot = getBootstrap()
    var room = boot.global && boot.global.room
    return text(window.__dmpServerRoomName || (room && (room.gameName || room.name)) || '').trim()
  }

  function routePath() {
    var hash = text(window.location && window.location.hash || '')
    return hash.replace(/^#/, '').split('?')[0] || '/dashboard'
  }

  function roomSubbarRoute() {
    /* Both a directly-opened room preview and the normal platform dashboard
       can host these long pages.  The platform view must receive the same
       strip; restricting it to roomPreview left /dashboard without the
       protective row when the user entered through the hall's platform card. */
    var platformView = document.body
      && document.body.classList.contains('android-platform-view')
    if (!isRoomPreview() && !platformView) return false
    /* Keep the same protective row on the map: its canvas can also scroll
       beneath the fixed navbar, so the time/battery strip must remain visible. */
    return /^\/(?:dashboard|tools\/map|tools\/backup|tools\/snapshot)(?:\/|$)/i.test(routePath())
  }

  /* A very short route-local toolbar keeps the selected room visible while a
     long dashboard/map/backup page is scrolled.  It deliberately lives above
     the generated page content rather than replacing the official navbar, so
     route changes do not recreate or animate the main toolbar. */
  function readNativeBattery() {
    try {
      if (!window.AndroidDmp || typeof window.AndroidDmp.getBatteryStatus !== 'function') {
        return null
      }
      var raw = window.AndroidDmp.getBatteryStatus()
      var value = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw
      if (!value || typeof value !== 'object') return null
      var level = Number(value.level)
      if (!isFinite(level)) return null
      /* The bridge returns a normalized 0..1 value.  Be tolerant of a
         future adapter returning a percentage so the display never becomes
         6000% on older APKs. */
      if (level > 1) level = level / 100
      return {
        level: Math.max(0, Math.min(1, level)),
        charging: value.charging === true || value.charging === 1
      }
    } catch (ignored) {
      return null
    }
  }

  function updateRoomSubbar() {
    var bar = document.getElementById('android-room-subbar')
    if (!bar) return
    var clock = bar.querySelector('.android-room-subbar-time')
    var battery = bar.querySelector('.android-room-subbar-battery')
    var nativeBattery = readNativeBattery()
    if (nativeBattery) roomSubbarBattery = nativeBattery
    if (clock) {
      var now = new Date()
      function pad2(value) { return value < 10 ? '0' + value : String(value) }
      var hh = pad2(now.getHours())
      var mm = pad2(now.getMinutes())
      var ss = pad2(now.getSeconds())
      clock.textContent = hh + ':' + mm + ':' + ss
    }
    if (battery && roomSubbarBattery) {
      var level = Number(roomSubbarBattery.level)
      if (isFinite(level)) {
        var percent = Math.max(0, Math.min(100, Math.round(level * 100)))
        battery.hidden = false
        battery.textContent = (roomSubbarBattery.charging ? '⚡ ' : '') + percent + '%'
      }
    }
  }

  /* The strip is deliberately independent of the scrolling navbar.  WebView
     coordinates start immediately below Android's status/notification bar;
     both layers use the same y=0 band and the navbar's measured height. */
  function syncRoomSubbarPosition() {
    var bar = document.getElementById('android-room-subbar')
    if (!bar || !document.documentElement) return
    /* Keep a physical left/right fallback for older tablet WebViews.  Their
       logical inset implementation can remain stale across rotation, while
       fixed positioning with measured px values follows the new viewport
       immediately. */
    /* visualViewport is preferred when available because a few tablet
       WebViews report the previous orientation through innerWidth for one
       frame after rotation. */
    var viewportWidth = window.visualViewport
      ? Number(window.visualViewport.width || 0) : 0
    if (!isFinite(viewportWidth) || viewportWidth <= 0) {
      viewportWidth = Number(window.innerWidth || 0)
    }
    if ((!isFinite(viewportWidth) || viewportWidth <= 0)
        && document.documentElement.clientWidth) viewportWidth = Number(document.documentElement.clientWidth)
    if (!isFinite(viewportWidth) || viewportWidth < 0) viewportWidth = 0
    var left = 0
    var body = document.body
    if (body && body.classList.contains('android-platform-menu-open')) {
      var menuWidth = ''
      try {
        menuWidth = window.getComputedStyle(document.documentElement)
          .getPropertyValue('--android-platform-menu-width')
      } catch (ignored) {}
      menuWidth = Number(String(menuWidth || '').replace(/px\s*$/, ''))
      if (!isFinite(menuWidth) || menuWidth < 0) menuWidth = 260
      left = menuWidth
    }
    /* Match the CSS cascade: the compact room menu wins when both classes are
       briefly present during a route transition. */
    if (body && body.classList.contains('android-room-menu-open')) left = 88
    left = Math.max(0, Math.min(left, viewportWidth))
    bar.style.setProperty('left', Math.round(left) + 'px', 'important')
    bar.style.setProperty('right', '0px', 'important')
    if (viewportWidth > 0) {
      bar.style.setProperty('width', Math.max(0, Math.round(viewportWidth - left)) + 'px', 'important')
    } else {
      bar.style.setProperty('width', 'auto', 'important')
    }
    document.documentElement.style.setProperty('--android-room-subbar-top', '0px')
    document.documentElement.style.setProperty(
      '--android-room-subbar-height', 'var(--android-room-navbar-height,64px)')
    document.documentElement.style.setProperty('--android-room-navbar-top', '0px')
    var navbar = document.querySelector('.layout-navbar')
    if (navbar && navbar.getBoundingClientRect) {
      var rect = navbar.getBoundingClientRect()
      if (rect.height > 0) {
        document.documentElement.style.setProperty(
          '--android-room-navbar-height', Math.round(rect.height) + 'px')
        document.documentElement.style.setProperty(
          '--android-room-subbar-height', Math.round(rect.height) + 'px')
      }
    }
    syncRoomSubbarScroll()
  }

  /* The navbar and room picker are deliberately above the fixed subbar at
     scrollTop=0.  Special dashboard/map/backup pages use the normal document
     scroller (or, on some WebView rotations, an inner page container), so
     translate only the navbar by the same clamped amount as the page moves
     upward.  The room picker intentionally stays fixed above both layers;
     this is the control that remains visible after the official toolbar has
     left the viewport.  Clamping at the measured toolbar height leaves the
     clock/battery strip exposed instead of allowing a second toolbar row or
     text to sit over the menu button. */
  function readRoomScrollTop() {
    var root = document.scrollingElement || document.documentElement || document.body
    var value = root && Number(root.scrollTop)
    if (!isFinite(value) || value < 0) value = Number(window.pageYOffset || 0)
    if (!isFinite(value) || value < 0) value = 0
    var target = roomSubbarScrollTarget
    if (target && target.isConnected && target.scrollHeight > target.clientHeight + 1) {
      var targetTop = Number(target.scrollTop)
      if (isFinite(targetTop) && targetTop > value) value = targetTop
    }
    /* A few Huawei WebView orientations put the page scroll on a nested
       Vuetify wrapper rather than the root element.  Read only the stable
       page containers (not every card) and use the largest active offset. */
    var selectors = '.layout-content-wrapper,.layout-page-content,.page-content-container,.v-main,.v-main__wrap'
    document.querySelectorAll(selectors).forEach(function (node) {
      if (!node || node.scrollHeight <= node.clientHeight + 1) return
      var nested = Number(node.scrollTop)
      if (isFinite(nested) && nested > value) value = nested
    })
    return value
  }

  function syncRoomSubbarScroll() {
    if (!document.documentElement) return
    var active = !!(document.body && document.body.classList.contains(
      'android-room-subbar-active'))
    if (!active) {
      document.documentElement.style.setProperty('--android-room-scroll-offset', '0px')
      roomSubbarScrollTarget = null
      if (document.body) document.body.classList.remove('android-room-navbar-scrolled')
      return
    }
    var navbar = document.querySelector('.layout-navbar')
    var height = navbar && navbar.getBoundingClientRect
      ? Number(navbar.getBoundingClientRect().height) : 0
    if (!isFinite(height) || height <= 0) height = 64
    var offset = Math.max(0, Math.min(readRoomScrollTop(), height))
    document.documentElement.style.setProperty(
      '--android-room-scroll-offset', Math.round(offset) + 'px')
    if (document.body) document.body.classList.toggle(
      'android-room-navbar-scrolled', offset > 0.5)
  }

  function scheduleRoomSubbarScroll(event) {
    var target = event && event.target
    if (target && target.nodeType === 1
        && target.scrollHeight > target.clientHeight + 1) {
      roomSubbarScrollTarget = target
    }
    if (roomSubbarScrollFrame) return
    var run = function () {
      roomSubbarScrollFrame = 0
      syncRoomSubbarScroll()
    }
    if (window.requestAnimationFrame) roomSubbarScrollFrame = window.requestAnimationFrame(run)
    else roomSubbarScrollFrame = window.setTimeout(run, 16)
  }

  function installRoomSubbarScrollTracking() {
    if (roomSubbarScrollReady) return
    roomSubbarScrollReady = true
    window.addEventListener('scroll', scheduleRoomSubbarScroll, { passive: true })
    /* Huawei WebView dispatches the document scroll from the root element in
       some orientation states; capture the event so both variants update. */
    document.addEventListener('scroll', scheduleRoomSubbarScroll, true)
    window.addEventListener('resize', scheduleRoomSubbarScroll)
    window.addEventListener('orientationchange', scheduleRoomSubbarScroll)
    if (window.visualViewport) {
      window.visualViewport.addEventListener('scroll', scheduleRoomSubbarScroll)
      window.visualViewport.addEventListener('resize', scheduleRoomSubbarScroll)
    }
    syncRoomSubbarScroll()
  }

  function scheduleRoomSubbarPosition() {
    if (roomSubbarPositionFrame) return
    var run = function () {
      roomSubbarPositionFrame = 0
      syncRoomSubbarPosition()
    }
    if (window.requestAnimationFrame) roomSubbarPositionFrame = window.requestAnimationFrame(run)
    else roomSubbarPositionFrame = window.setTimeout(run, 16)
  }

  function installRoomSubbarPositionTracking() {
    if (roomSubbarPositionReady) return
    roomSubbarPositionReady = true
    window.addEventListener('scroll', scheduleRoomSubbarPosition, true)
    window.addEventListener('resize', scheduleRoomSubbarPosition)
    window.addEventListener('orientationchange', scheduleRoomSubbarPosition)
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', scheduleRoomSubbarPosition)
      window.visualViewport.addEventListener('scroll', scheduleRoomSubbarPosition)
    }
  }

  function ensureRoomSubbar() {
    if (!document.body || !roomSubbarRoute()) {
      if (document.body) document.body.classList.remove('android-room-subbar-active')
      if (document.body) document.body.classList.remove('android-room-navbar-scrolled')
      var stale = document.getElementById('android-room-subbar')
      if (stale) stale.remove()
      var normalWrapper = document.querySelector('.layout-content-wrapper')
      if (normalWrapper) normalWrapper.style.setProperty(
        'padding-top', 'var(--android-room-navbar-height,64px)', 'important')
      document.documentElement.style.setProperty('--android-room-navbar-top', '0px')
      document.documentElement.style.setProperty('--android-room-subbar-top', '0px')
      document.documentElement.style.setProperty('--android-room-scroll-offset', '0px')
      /* The previous route may have left the inline fixed offset behind for
         one observer tick.  Clear it as soon as the strip is removed. */
      stabilizeToolbar()
      return
    }
    var wrapper = document.querySelector('.layout-content-wrapper')
    if (!wrapper) return
    document.body.classList.add('android-room-subbar-active')
    installRoomSubbarScrollTracking()
    document.documentElement.style.setProperty(
      '--android-room-subbar-height', 'var(--android-room-navbar-height,64px)')
    document.documentElement.style.setProperty('--android-room-navbar-top', '0px')
    /* The route class is added after the first toolbar pass during app boot;
       apply the offset immediately so the strip never flashes over the
       navbar for one or more 120 ms guard ticks. */
    stabilizeToolbar()
    wrapper.style.setProperty(
      'padding-top', 'var(--android-room-navbar-height,64px)', 'important')
    var bar = document.getElementById('android-room-subbar')
    if (!bar) {
      bar = document.createElement('div')
      bar.id = 'android-room-subbar'
      bar.className = 'android-room-subbar'
      /* Keep this layer deliberately anonymous: the room name already lives
         in the fixed navbar/room picker.  The clock/battery occupy the empty
         part of the same toolbar band. */
      bar.innerHTML = '<span class="android-room-subbar-spacer"></span>'
        + '<span class="android-room-subbar-time"></span>'
        + '<span class="android-room-subbar-battery" hidden></span>'
    }
    /* Keep the fixed strip outside the transformed content wrapper.  The
       room/platform drawer shifts that wrapper while a menu is open; a
       descendant fixed element would then move sideways with the page and
       no longer sit directly below the main navbar.  Body-level mounting
       also keeps the strip out of Vue's #app patch tree, so a route render
       cannot remove it between two observer frames.  The special-page
       stacking rule above removes the wrapper's identity stacking context;
       that lets the navbar's larger z-index remain above this body-level
       strip at rest while the strip is exposed after the navbar scrolls
       off-screen. */
    var app = document.getElementById('app')
    if (bar.parentNode !== document.body) {
      if (app && app.parentNode === document.body) document.body.insertBefore(bar, app)
      else document.body.appendChild(bar)
    }
    var navbar = document.querySelector('.layout-navbar')
    var navHeight = navbar && navbar.getBoundingClientRect
      ? navbar.getBoundingClientRect().height : 0
    if (navHeight > 0) document.documentElement.style.setProperty(
      '--android-room-navbar-height', Math.round(navHeight) + 'px')
    installRoomSubbarPositionTracking()
    syncRoomSubbarPosition()
    if (!roomSubbarTimer) {
      roomSubbarTimer = window.setInterval(updateRoomSubbar, 1000)
    }
    updateRoomSubbar()
    if (!roomSubbarBatteryReady) {
      roomSubbarBatteryReady = true
      try {
        if (navigator && typeof navigator.getBattery === 'function') {
          navigator.getBattery().then(function (battery) {
            roomSubbarBattery = battery
            updateRoomSubbar()
            if (battery && battery.addEventListener) {
              battery.addEventListener('levelchange', updateRoomSubbar)
              battery.addEventListener('chargingchange', updateRoomSubbar)
            }
          }).catch(function () {})
        }
      } catch (ignored) {}
    }
  }

  /* The generated Vuetify table is intentionally kept intact for landscape.
     In portrait the six-cell world/backup rows become a two-line grid; on
     very narrow phones the compact table may scroll a few pixels inside its
     own wrapper, while header buttons remain real DOM buttons and all sorts
     continue to work. */
  function decorateResponsiveTables() {
    /* The same dashboard/backup tables are used by a directly-entered room
       (`android-room-preview`) and by the normal platform view.  Apply the
       portrait grid to both; landscape deliberately keeps the desktop table. */
    if (!document.body || (!isRoomPreview() && !document.body.classList.contains('android-platform-view'))) return
    var portrait = (window.innerHeight || 0) >= (window.innerWidth || 0)
    document.body.classList.toggle('android-room-portrait', portrait)
    document.body.classList.toggle('android-room-landscape', !portrait)
    /* Portrait tablets have enough width for the official one-line table
       layout. Phones keep the compact two-line presentation; landscape is
       already left to the upstream desktop table rules. */
    var viewportWidth = Number(window.innerWidth || 0)
    document.body.classList.toggle('android-table-wide', viewportWidth >= 760)
    var path = routePath()
    document.querySelectorAll('.v-data-table').forEach(function (table) {
      var hadCompactArchiveClass = table.classList.contains('android-backup-table')
        || table.classList.contains('android-snapshot-table')
      if (hadCompactArchiveClass) {
        table.querySelectorAll('thead th').forEach(function (cell) {
          var label = cell.querySelector('.v-data-table-header__content > span')
          if (label && label.dataset.androidOriginalHeader !== undefined) {
            label.textContent = label.dataset.androidOriginalHeader
          }
        })
      }
      table.classList.remove('android-dashboard-world-table', 'android-backup-table', 'android-snapshot-table')
      if (!portrait) return
      /* Do not classify every table on a route.  The dashboard also contains
         selectors and action tables, and applying the world grid to those is
         what made unrelated pages look forcibly squeezed.  Header labels are
         stable across the Chinese/English bundles and let us target only the
         world-information or backup table. */
      var headerText = text(table.querySelector('thead') &&
        table.querySelector('thead').textContent).replace(/\s+/g, ' ').trim()
      var count = table.querySelectorAll('thead th').length
      if (/^\/dashboard(?:\/|$)/i.test(path)
          && count >= 5
          && (/(?:世界名|world\s*name)/i.test(headerText)
            || /(?:主节点|is\s*master)/i.test(headerText))
          && /(?:CPU|内存|memory|磁盘|disk)/i.test(headerText)) {
        table.classList.add('android-dashboard-world-table')
      } else if (/^\/tools\/backup(?:\/|$)/i.test(path)
          && count >= 5
          && (/(?:房间名|存档名|game\s*name)/i.test(headerText)
            || /(?:备份时间|创建时间|timestamp)/i.test(headerText))
          && /(?:大小|size)/i.test(headerText)) {
        table.classList.add('android-backup-table')
        /* On the compact archive card the two visible rows are labelled by
           their actual meaning rather than the upstream room-oriented names.
           Change only the header span so Vuetify's sort icon and click
           handler remain intact; remember the original text for rotation
           back to the desktop/landscape table. */
        var archiveLabels = ['', '存档名', '', '大小', '创建时间', '删除']
        table.querySelectorAll('thead th').forEach(function (cell, index) {
          var label = cell.querySelector('.v-data-table-header__content > span')
          if (!label) return
          if (!label.dataset.androidOriginalHeader) {
            label.dataset.androidOriginalHeader = label.textContent || ''
          }
          if (archiveLabels[index] !== undefined && archiveLabels[index] !== '') {
            label.textContent = archiveLabels[index]
          }
        })
      } else if (/^\/tools\/snapshot(?:\/|$)/i.test(path)
          && count >= 4
          && /(?:存档名|name)/i.test(headerText)
          && /(?:大小|size)/i.test(headerText)
          && /(?:创建时间|时间|time|mod)/i.test(headerText)) {
        table.classList.add('android-snapshot-table')
        var snapshotLabels = ['存档名', '大小', '创建时间', '删除']
        table.querySelectorAll('thead th').forEach(function (cell, index) {
          var label = cell.querySelector('.v-data-table-header__content > span')
          if (!label) return
          if (label.dataset.androidOriginalHeader === undefined) {
            label.dataset.androidOriginalHeader = label.textContent || ''
          }
          if (snapshotLabels[index]) label.textContent = snapshotLabels[index]
        })
      }
    })
  }

  /* Hide only the generated room label.  The old build used a chip-select
     wrapper while DMP 3.2 uses a plain VChip, so both shapes are covered. */
  function hideLegacyRoomLabels() {
    // Room-preview pages do not mount the platform room picker.  Keep the
    // selected room label supplied by the official navbar visible there;
    // hiding it would leave a blank toolbar after entering from the native
    // aggregate overview.
    if (isRoomPreview()) return
    var nav = document.querySelector('.layout-navbar')
    if (!nav) return
    var roomName = currentRoomName()
    var nodes = nav.querySelectorAll('.chip-select,.chip-select__activator,.v-chip')
    Array.prototype.forEach.call(nodes, function (node) {
      if (closest(node, '.android-room-picker-wrap')) return
      var icon = node.querySelector && node.querySelector(
        'i.ri-honour-line,i.ri-instance-line,i[class*="honour"],i[class*="instance"]')
      var value = text(node.textContent).trim()
      if (icon || (roomName && value === roomName)) {
        node.style.display = 'none'
        node.setAttribute('aria-hidden', 'true')
      }
    })
    /* A few bundle revisions render the label as a plain span.  Only hide a
       direct toolbar child whose complete text equals the selected room. */
    if (roomName) {
      var bar = toolbar()
      if (bar) Array.prototype.forEach.call(bar.children || [], function (child) {
        if (child.id === 'android-dmp-mobile-download-centre'
            || child.classList && child.classList.contains('android-dmp-mobile-download-anchor')) return
        if (text(child.textContent).trim() === roomName
            && /room|chip|select|title/i.test(text(child.className))) {
          child.style.display = 'none'
          child.setAttribute('aria-hidden', 'true')
        }
      })
    }
  }

  /* The upstream toolbar has its own DownloadCenter activator.  The Android
     queue owns the single visible trigger; never hide the queue's button. */
  function hideDuplicateDownloadButton() {
    if (!androidDownloadEnabled()) return
    var nav = document.querySelector('.layout-navbar')
    if (!nav) return
    var buttons = nav.querySelectorAll('button,[role="button"]')
    Array.prototype.forEach.call(buttons, function (button) {
      if (closest(button, '#android-dmp-mobile-download-centre')) return
      var icon = button.querySelector && button.querySelector(
        'i.ri-download-2-line,i.ri-download-line,i.ri-download-cloud-2-line,i[class*="download"]')
      var label = text(button.getAttribute('aria-label') || button.textContent)
      if (icon || /下载任务|download\s*(center|task)/i.test(label)) {
        var owner = closest(button, '.v-badge') || button
        owner.style.display = 'none'
        owner.setAttribute('aria-hidden', 'true')
      }
    })
  }

  /* Global night mode is owned by the native hall/settings screen.  The
     platform WebView's duplicate sun/moon activator is therefore confusing
     and can compete with the Android download trigger on narrow toolbars. */
  function hidePlatformThemeButton() {
    /* The room-preview shell is the platform view shown after entering a
       room from the aggregate room overview.  It uses a different body
       class, but the same duplicate night-mode activator is rendered in its
       toolbar.  Hide it there as well; the global setting remains available
       from the hall's DMP settings card. */
    if (!document.body
        || (!document.body.classList.contains('android-platform-view')
          && !document.body.classList.contains('android-room-preview'))) return
    var nav = document.querySelector('.layout-navbar')
    if (!nav) return
    nav.querySelectorAll(
      'i.ri-moon-clear-line,i.ri-moon-line,i.ri-sun-line,i[class*="moon"],i[class*="sun"]')
      .forEach(function (icon) {
        var button = closest(icon, 'button,[role="button"]')
        if (!button || button.closest('#android-dmp-mobile-download-centre')) return
        var owner = button.closest('.v-badge') || button
        owner.style.display = 'none'
        owner.setAttribute('aria-hidden', 'true')
      })
  }

  /* The drawer's close icon is useful on desktop, but on Android it sits
     beside the six-character title and consumes the only compact-toolbar
     space.  Scope this narrowly to the vertical drawer so close buttons in
     dialogs and cards remain available. */
  function hidePlatformMenuCloseButton() {
    if (!document.body || !document.body.classList.contains('android-platform-view')) return
    var nav = document.querySelector('.layout-vertical-nav')
    if (!nav) return
    Array.prototype.forEach.call(nav.querySelectorAll('button,[role="button"]'), function (button) {
      var icon = button.querySelector && button.querySelector('i.ri-close-line')
      if (!icon) return
      button.classList.add('android-menu-close-hidden')
      button.setAttribute('aria-hidden', 'true')
    })
  }

  /* Keep the whole drawer scrollable in landscape.  Some Vuetify revisions
     put the scroll container on a child while others put it on the drawer;
     applying the safe overflow contract to both shapes covers both without
     changing the page's horizontal gesture handling. */
  function stabilizePlatformMenu() {
    if (!document.body || !document.body.classList.contains('android-platform-view')) return
    var nav = document.querySelector('.layout-vertical-nav')
    if (!nav) return
    nav.style.setProperty('overflow-y', 'auto', 'important')
    nav.style.setProperty('overflow-x', 'hidden', 'important')
    nav.style.setProperty('max-height', '100vh', 'important')
    nav.style.setProperty('height', '100vh', 'important')
    nav.style.setProperty('display', 'flex', 'important')
    nav.style.setProperty('flex-direction', 'column', 'important')
    nav.style.setProperty('overscroll-behavior-y', 'contain', 'important')
    /* On the landscape drawer Vuetify/PerfectScrollbar renders the actual
       list as `.nav-items.ps`.  Selecting the generic wrapper first leaves
       that child with a fixed desktop height, so a long expanded tools list
       cannot scroll.  Prefer the real `.ps` node, then fall back to older
       class names used by previous bundles. */
    var items = nav.querySelector('.nav-items.ps')
      || nav.querySelector('.vertical-nav-items.ps')
      || nav.querySelector('.vertical-nav-items')
      || nav.querySelector('.nav-items')
      || nav.querySelector('[class*="nav-items"]')
    if (items) {
      items.style.setProperty('flex', '1 1 auto', 'important')
      items.style.setProperty('min-height', '0', 'important')
      items.style.setProperty('height', 'auto', 'important')
      items.style.setProperty('max-height', 'none', 'important')
      items.style.setProperty('overflow-y', 'auto', 'important')
      items.style.setProperty('overflow-x', 'hidden', 'important')
      items.style.setProperty('touch-action', 'pan-y', 'important')
      items.style.setProperty('overscroll-behavior-y', 'contain', 'important')
      /* PerfectScrollbar can retain the horizontal-active class after the
         drawer changes from its short to its expanded state.  On Android
         WebView that stale state consumes the touch gesture, so install a
         small native touch fallback on the actual list.  It only starts
         preventing the browser gesture after the finger has moved enough to
         be a scroll, leaving ordinary menu taps/clicks untouched. */
      items.style.setProperty('-webkit-overflow-scrolling', 'touch', 'important')
      Array.prototype.forEach.call(items.querySelectorAll('.ps__rail-x,.ps__thumb-x'), function (rail) {
        rail.style.setProperty('display', 'none', 'important')
        rail.style.setProperty('pointer-events', 'none', 'important')
      })
      if (!items.__androidTouchScrollInstalled) {
        var touchState = null
        items.addEventListener('touchstart', function (event) {
          if (!event.touches || event.touches.length !== 1) {
            touchState = null
            return
          }
          var point = event.touches[0]
          touchState = { y: point.clientY, lastY: point.clientY, moved: false }
        }, { capture: true, passive: true })
        items.addEventListener('touchmove', function (event) {
          if (!touchState || !event.touches || event.touches.length !== 1) return
          var point = event.touches[0]
          var delta = touchState.lastY - point.clientY
          if (!touchState.moved && Math.abs(point.clientY - touchState.y) < 6) return
          touchState.moved = true
          touchState.lastY = point.clientY
          if (items.scrollHeight > items.clientHeight && delta) {
            items.scrollTop += delta
            try { items.dispatchEvent(new Event('scroll', { bubbles: false })) } catch (ignored) {}
          }
          event.preventDefault()
          event.stopPropagation()
        }, { capture: true, passive: false })
        items.addEventListener('touchend', function () { touchState = null }, { capture: true, passive: true })
        items.addEventListener('touchcancel', function () { touchState = null }, { capture: true, passive: true })
        items.__androidTouchScrollInstalled = true
      }
    }
    hidePlatformMenuCloseButton()
  }

  function defaultGameToken() {
    /* Keep the same deterministic default used by the open-source web form's
       getDstToken().  The five base64 layers are already part of the shipped
       upstream utility; this avoids putting a random/invalid token into a new
       room when the mobile form exposes the action. */
    var decoded = 'VjFSQ2ExVXlWbkpsUm1oaFVqRmFWVlJXV21GaVZsWnlZVWRHV0dKV1JqUldNakI0V1ZaS1YyTkhlRlpOVjFKeVZrUkJOVkpzY0VkYVJtaFVVakpSZVZac1dsTlNNazE0VW14a1VtSlZXbWhVVlZKelUyeHJlRlZyT1ZaaVJscEpWMnRTUzFac1NYbFVXSEJhWld0YWRsa3haRWRYVms1VlZHeGtWMDFZUWtoV01qRjNZbTFXV0Zac1dtcFNSVXB2V2xkd1FrOVJQVDA9'
    try {
      for (var i = 0; i < 5; i++) decoded = window.atob(decoded)
      if (decoded) return decoded
    } catch (ignored) {}
    var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
    var result = ''
    for (var j = 0; j < 14; j++) {
      result += alphabet.charAt(Math.floor(Math.random() * alphabet.length))
    }
    return result
  }

  function setNativeInputValue(input, value) {
    if (!input) return
    try {
      var descriptor = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement && window.HTMLInputElement.prototype, 'value')
      if (descriptor && descriptor.set) descriptor.set.call(input, value)
      else input.value = value
    } catch (ignored) { input.value = value }
    try {
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    } catch (ignored) {
      var inputEvent = document.createEvent('Event')
      inputEvent.initEvent('input', true, true)
      input.dispatchEvent(inputEvent)
      var changeEvent = document.createEvent('Event')
      changeEvent.initEvent('change', true, true)
      input.dispatchEvent(changeEvent)
    }
  }

  function tokenInput() {
    var inputs = document.querySelectorAll('input')
    var best = null
    var bestScore = 0
    Array.prototype.forEach.call(inputs, function (input) {
      var field = closest(input, '.v-input') || input.parentElement
      var textValue = text(input.getAttribute('aria-label') || '') + ' '
        + text(input.getAttribute('placeholder') || '') + ' '
        + text(input.getAttribute('name') || '') + ' '
        + text(input.id || '') + ' '
        + text(field && field.textContent || '')
      var score = /token|令牌/i.test(textValue) ? 10 : 0
      if (input.type === 'password') score += 1
      if (score > bestScore) { best = input; bestScore = score }
    })
    return bestScore >= 10 ? best : null
  }

  function createTokenAction(label, iconClass, handler, extraClass) {
    var button = document.createElement('button')
    button.type = 'button'
    button.className = 'v-btn v-btn--variant-text android-token-action' + (extraClass ? ' ' + extraClass : '')
    button.setAttribute('data-android-token-action', label)
    button.setAttribute('aria-label', label)
    /* Mirror Vuetify VBtn's prepend-icon DOM so spacing, baseline and ripple
       behavior match the open-source template instead of looking like an
       icon-only mobile shortcut. */
    button.innerHTML = '<span class="v-btn__prepend"><i class="' + iconClass + '" aria-hidden="true"></i></span><span class="v-btn__content">' + label + '</span>'
    button.addEventListener('click', function (event) {
      event.preventDefault()
      event.stopPropagation()
      handler()
    })
    return button
  }

  /* The upstream room form hides the default-token action and turns the cloud
     action into an icon-only button when Vuetify reports mobile=true.  Keep
     the upstream click handler, but expose the two actions as the
     text+icon buttons used by the open-source form. */
  function decorateTokenControls() {
    var hash = text(window.location && window.location.hash || '')
    if (!/^#?\/game\/base(?:[/?]|$)/i.test(hash)) return
    var input = tokenInput()
    if (!input) return
    var field = closest(input, '.v-input') || input.parentElement
    var row = field && field.parentElement
    if (!row) return
    row.classList.add('android-token-row')
    var existing = row.querySelector('.android-token-actions')
    if (existing) existing.remove()
    var actions = document.createElement('span')
    actions.className = 'android-token-actions'
    actions.setAttribute('aria-label', '令牌操作')
    var cloudButton = null
    Array.prototype.some.call(row.querySelectorAll('button,.v-btn'), function (button) {
      if (button.closest('.v-input')) return false
      var iconText = text(button.innerHTML || '')
      if (button.querySelector('.ri-cloud-line') || /ri-cloud-line/.test(iconText)) {
        cloudButton = button
        return true
      }
      return false
    })
    var add = createTokenAction('默认令牌', 'ri-add-line', function () {
      setNativeInputValue(input, defaultGameToken())
      input.focus()
    }, 'android-token-default')
    var select = createTokenAction('从云端选择', 'ri-cloud-line', function () {
      if (cloudButton) {
        try { cloudButton.click(); return } catch (ignored) {}
      }
    }, 'android-token-cloud')
    actions.appendChild(add)
    actions.appendChild(select)
    row.appendChild(actions)
    /* Hide every upstream token action after retaining the cloud click
       handler.  This prevents the old icon-only button from appearing as a
       third action on tablets where the generated form reports mobile=true
       late, after the first decoration pass. */
    Array.prototype.forEach.call(row.querySelectorAll('button,.v-btn'), function (button) {
      if (button === add || button === select || button.closest('.v-input')) return
      if (button.querySelector('.ri-add-line') || button.querySelector('.ri-cloud-line') || button.querySelector('.ri-links-line')) {
        button.setAttribute('aria-hidden', 'true')
        button.style.display = 'none'
      }
    })
  }

  function normalizeRoomPreviewLayout() {
    if (!isRoomPreview() || !document.body) return
    document.body.classList.add('android-room-preview')
    var root = document.documentElement
    var width = window.innerWidth || (window.visualViewport && window.visualViewport.width) || 0
    var height = window.innerHeight || (window.visualViewport && window.visualViewport.height) || 0
    if (root && width > 0) root.style.setProperty('--android-viewport-width', Math.round(width) + 'px')
    if (root && height > 0) root.style.setProperty('--android-viewport-height', Math.round(height) + 'px')
    var wrapper = document.querySelector('.layout-content-wrapper')
    if (wrapper) {
      var roomMenuOpen = document.body.classList.contains('android-room-menu-open')
      wrapper.style.setProperty('padding-inline-start', '0', 'important')
      wrapper.style.setProperty('min-width', '0', 'important')
      if (roomMenuOpen) {
        wrapper.style.setProperty('margin-inline-start', '88px', 'important')
        wrapper.style.setProperty('margin-left', '88px', 'important')
        wrapper.style.setProperty('width', 'calc(100% - 88px)', 'important')
        wrapper.style.setProperty('max-width', 'calc(100% - 88px)', 'important')
        wrapper.style.setProperty('flex-basis', 'calc(100% - 88px)', 'important')
        wrapper.style.setProperty('transform', 'none', 'important')
      } else {
        wrapper.style.setProperty('margin-inline-start', '0', 'important')
        wrapper.style.setProperty('margin-left', '0', 'important')
        wrapper.style.setProperty('width', '100%', 'important')
        wrapper.style.setProperty('max-width', '100vw', 'important')
        wrapper.style.setProperty('transform', 'none', 'important')
      }
    }
  }

  function installHorizontalMenuLock() {
    var gesture = null
    document.addEventListener('touchstart', function (event) {
      if (!document.body || !document.body.classList.contains('android-platform-view')) return
      var nav = document.querySelector('.layout-vertical-nav')
      var touch = event.touches && event.touches[0]
      if (!nav || !touch || !nav.contains(event.target)) {
        gesture = null
        return
      }
      gesture = { x: touch.clientX, y: touch.clientY }
    }, true)
    document.addEventListener('touchmove', function (event) {
      if (!gesture) return
      var touch = event.touches && event.touches[0]
      if (!touch) return
      var dx = touch.clientX - gesture.x
      var dy = touch.clientY - gesture.y
      /* A horizontal finger movement in the drawer must never be passed to
         the content pane.  Vertical movement remains available to the
         bridge's scroll handoff implementation. */
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) + 2) {
        event.preventDefault()
        event.stopPropagation()
      }
    }, { capture: true, passive: false })
    document.addEventListener('touchend', function () { gesture = null }, true)
    document.addEventListener('touchcancel', function () { gesture = null }, true)
  }

  function installTapFeedback() {
    /* dmp-android-bridge.js owns the same one-second feedback on all builds.
       Do not install a second pseudo-element when that bridge style is
       present; otherwise two borders would be composited on every tap. */
    if (document.getElementById('android-navbar-polish')) return
    function flash(button) {
      if (!button || button.disabled) return
      button.classList.remove('android-ui-tap-feedback')
      void button.offsetWidth
      button.classList.add('android-ui-tap-feedback')
      if (button.__androidUiTapTimer) window.clearTimeout(button.__androidUiTapTimer)
      button.__androidUiTapTimer = window.setTimeout(function () {
        button.classList.remove('android-ui-tap-feedback')
        delete button.__androidUiTapTimer
      }, 1000)
    }
    document.addEventListener('pointerdown', function (event) {
      var button = event.target && closest(event.target, 'button,.v-btn,[role="button"]')
      flash(button)
    }, true)
  }

  function fetchRooms() {
    var base = apiBase()
    if (!base || typeof window.fetch !== 'function') return Promise.resolve([])
    var now = Date.now()
    if (roomFetchPromise) return roomFetchPromise
    if (roomCache.length && now - roomCacheAt < 5000) return Promise.resolve(roomCache)
    var headers = { 'X-I18n-Lang': 'zh' }
    var apiToken = token()
    if (apiToken) headers['X-DMP-TOKEN'] = apiToken
    roomFetchPromise = window.fetch(base + '/v3/room/list?page=1&pageSize=1000', {
      method: 'GET', headers: headers, cache: 'no-store'
    }).then(function (response) {
      if (!response || !response.ok) throw new Error('room list')
      return response.json()
    }).then(function (payload) {
      var data = payload && payload.data
      var rows = data && Array.isArray(data.rows) ? data.rows
        : Array.isArray(data) ? data : []
      roomCache = rows.map(function (item) {
        return {
          id: number(item && (item.id || item.roomID || item.roomId), 0),
          name: text(item && (item.gameName || item.roomName || item.name)).trim()
        }
      }).filter(function (item) { return item.id > 0 && item.name })
      roomCacheAt = Date.now()
      return roomCache
    }).catch(function () { return roomCache }).then(function (value) {
      roomFetchPromise = null
      return value || []
    })
    return roomFetchPromise
  }

  function roomMatch(value, rooms, usedIds) {
    var label = text(value).trim()
    if (!label) return null
    /* The upstream mobile room card truncates the label in JavaScript (for
       example, `SORM-随机海...`), so CSS alone cannot restore the full name.
       Compare the visible prefix as well as the exact text.  Several rooms
       can legitimately share that visible prefix (for example the C/B/G
       海钓 rooms), so prefer an unused candidate instead of always returning
       the first API row. */
    var prefixLabel = label.replace(/[.…]+$/, '').trim()
    var used = usedIds || {}
    var exact = []
    for (var i = 0; i < rooms.length; i++) {
      if (rooms[i].name === label) exact.push(rooms[i])
    }
    for (var exactIndex = 0; exactIndex < exact.length; exactIndex++) {
      if (!used[exact[exactIndex].id]) return exact[exactIndex]
    }
    /* If a reused Vue node still carries an old exact label, do not keep
       assigning the already-consumed room.  Continue through the prefix and
       final unused-row fallback so cards remain one-to-one. */
    var prefix = []
    for (var prefixIndex = 0; prefixIndex < rooms.length; prefixIndex++) {
      if (prefixLabel && rooms[prefixIndex].name.indexOf(prefixLabel) === 0) {
        prefix.push(rooms[prefixIndex])
      }
    }
    for (var unusedPrefixIndex = 0; unusedPrefixIndex < prefix.length; unusedPrefixIndex++) {
      if (!used[prefix[unusedPrefixIndex].id]) return prefix[unusedPrefixIndex]
    }
    if (prefix.length) return prefix[0]
    var partial = []
    for (var j = 0; j < rooms.length; j++) {
      if (rooms[j].name.indexOf(label) === 0 || label.indexOf(rooms[j].name) === 0) {
        partial.push(rooms[j])
      }
    }
    for (var unusedPartialIndex = 0; unusedPartialIndex < partial.length; unusedPartialIndex++) {
      if (!used[partial[unusedPartialIndex].id]) return partial[unusedPartialIndex]
    }
    if (partial.length) return partial[0]
    for (var fallbackIndex = 0; fallbackIndex < rooms.length; fallbackIndex++) {
      if (!used[rooms[fallbackIndex].id]) return rooms[fallbackIndex]
    }
    return null
  }

  function runningFor(room) {
    var base = apiBase()
    if (!base || !room || !room.id || typeof window.fetch !== 'function') return Promise.resolve(false)
    if (screenCache[room.id] && Date.now() - screenCache[room.id].at < 5000) {
      return Promise.resolve(screenCache[room.id].running)
    }
    var headers = { 'X-I18n-Lang': 'zh' }
    var apiToken = token()
    if (apiToken) headers['X-DMP-TOKEN'] = apiToken
    return window.fetch(base + '/v3/platform/screen/running?roomID=' + encodeURIComponent(room.id), {
      method: 'GET', headers: headers, cache: 'no-store'
    }).then(function (response) {
      if (!response || !response.ok) throw new Error('screen')
      return response.json()
    }).then(function (payload) {
      var data = payload && payload.data
      var running = false
      if (Array.isArray(data)) {
        /* Newer DMP deployments return screen names, while a few builds
           return objects with an explicit running/status field. Treat an
           object as running only when its flag says so; an object with
           running:false must not become truthy merely because it stringifies
           to "[object Object]". Plain non-empty names retain the upstream
           array semantics. */
        running = data.some(function (entry) {
          if (entry && typeof entry === 'object') {
            return entry.running === true || entry.running === 1
              || entry.running === 'true' || entry.status === true
              || entry.status === 1 || entry.status === 'true'
              || entry.isRunning === true || entry.isRunning === 1
              || entry.isRunning === 'true'
          }
          return text(entry).trim() !== ''
        })
      } else if (data && typeof data === 'object') {
        running = data.running === true || data.running === 1
          || data.running === 'true' || data.status === true
          || data.status === 1 || data.status === 'true'
          || data.isRunning === true || data.isRunning === 1
          || data.isRunning === 'true'
      } else {
        running = text(data).trim() !== '' && text(data).toLowerCase() !== 'false'
      }
      screenCache[room.id] = { running: running, at: Date.now() }
      return running
    }).catch(function () {
      return screenCache[room.id] ? screenCache[room.id].running : false
    })
  }

  function chipText(chip, value) {
    if (!chip) return
    var content = chip.querySelector && chip.querySelector('.v-chip__content')
    if (content) {
      if (text(content.textContent) !== text(value)) content.textContent = value
    } else if (text(chip.textContent) !== text(value)) {
      chip.textContent = value
    }
  }

  function cloneRunningChip(statusChip, running) {
    if (!statusChip || statusChip.parentElement.querySelector('.' + ROOM_RUNNING_CLASS)) return
    var clone = statusChip.cloneNode(true)
    clone.classList.add(ROOM_RUNNING_CLASS)
    clone.classList.toggle('android-running', !!running)
    clone.classList.toggle('android-stopped', !running)
    chipText(clone, running ? '运行' : '关闭')
    statusChip.parentElement.insertBefore(clone, statusChip)
  }

  function directChild(parent, node) {
    var current = node
    while (current && current.parentElement && current.parentElement !== parent) {
      current = current.parentElement
    }
    return current && current.parentElement === parent ? current : null
  }

  /* The bridge's older room-card decorator runs before Vue has finished
     replacing a card.  Re-apply the structural classes here and reserve the
     crosshair/selection slot even when this room is not selected. */
  function prepareRoomCardLayout(header, icon, nameChip) {
    if (!header || !nameChip) return
    header.classList.add('android-room-card-header')
    var menu = directChild(header, icon)
    if (menu) menu.classList.add('android-room-card-menu')
    var nameGroup = null
    Array.prototype.forEach.call(header.children || [], function (child) {
      if (!nameGroup && child.classList && child.classList.contains('fcc')) {
        nameGroup = child
      }
    })
    if (!nameGroup) nameGroup = directChild(header, nameChip) || nameChip.parentElement
    if (!nameGroup) return
    nameGroup.classList.add('android-room-card-name')
    var controls = null
    Array.prototype.forEach.call(header.children || [], function (child) {
      if (!controls && child.classList && child.classList.contains('android-room-card-controls')) {
        controls = child
      }
    })
    if (!controls) {
      controls = document.createElement('div')
      controls.className = 'android-room-card-controls'
      if (menu) header.insertBefore(controls, menu)
      else header.appendChild(controls)
    }
    /* If a freshly-created Vue card has not gone through the bridge decorator,
       move status/selection controls out of the name group now. */
    while (nameGroup.children.length > 1) {
      controls.appendChild(nameGroup.children[1])
    }
    var selection = controls.querySelector('.android-room-selection-slot')
      || controls.querySelector('i.ri-crosshair-2-line')
    if (selection) {
      var selectionOwner = selection.closest && selection.closest('button,[role="button"]')
      if (!selectionOwner || directChild(header, selectionOwner) !== menu) {
        selectionOwner = selectionOwner || selection
        selectionOwner.classList.add('android-room-selection-slot')
      }
    } else if (!controls.querySelector('.android-room-selection-placeholder')) {
      var placeholder = document.createElement('span')
      placeholder.className = 'android-room-selection-slot android-room-selection-placeholder'
      placeholder.setAttribute('aria-hidden', 'true')
      controls.appendChild(placeholder)
    }
  }

  function decorateRoomCards(rooms) {
    var preview = isRoomPreview()
    var totalPlatform = isTotalPlatformOverview()
    var usedRoomIds = {}
    document.querySelectorAll('.v-card').forEach(function (card) {
      var icon = card.querySelector('i.ri-more-2-line')
      if (!icon) return
      var header = icon.closest('.fcb')
      if (!header) return
      var nameChip = header.querySelector('.v-chip')
      if (!nameChip) return
      prepareRoomCardLayout(header, icon, nameChip)
      var content = nameChip.querySelector('.v-chip__content')
      var savedRoomId = number(card.getAttribute('data-android-room-id'), 0)
      var room = null
      if (savedRoomId > 0 && !usedRoomIds[savedRoomId]) {
        rooms.some(function (candidate) {
          if (candidate.id === savedRoomId) {
            room = candidate
            return true
          }
          return false
        })
      }
      if (!room) {
        room = roomMatch(content ? content.textContent : nameChip.textContent,
          rooms, usedRoomIds)
      }
      if (!room) return
      usedRoomIds[room.id] = true
      /* Room-preview cards can contain a clickable online-player count.  Keep
         the matched room id on the card so the Android player modal queries
         the room that was tapped rather than the globally selected room. */
      card.setAttribute('data-android-room-id', String(room.id))
      /* Restore the full room name after the upstream mobile formatter has
         truncated it to eight characters. */
      chipText(nameChip, room.name)
      /* The room-preview card already has its activation state.  Running /
         closed is a platform-overview decoration and must not be duplicated
         beside the preview's “已激活/已关闭” chip. */
      if (preview || !totalPlatform) {
        /* A route switch can leave the aggregate chip in a reused Vue card;
           remove that stale decoration when entering the platform room list. */
        Array.prototype.forEach.call(header.querySelectorAll('.' + ROOM_RUNNING_CLASS), function (chip) {
          if (chip && chip.parentNode) chip.parentNode.removeChild(chip)
        })
        return
      }
      var statusChips = header.querySelectorAll('.v-chip')
      var status = null
      Array.prototype.forEach.call(statusChips, function (chip) {
        if (chip !== nameChip && !chip.classList.contains(ROOM_RUNNING_CLASS)) status = chip
      })
      if (!status) return
      cloneRunningChip(status, false)
      runningFor(room).then(function (running) {
        var own = header.querySelector('.' + ROOM_RUNNING_CLASS)
        if (own) {
          own.classList.toggle('android-running', !!running)
          own.classList.toggle('android-stopped', !running)
          chipText(own, running ? '运行' : '关闭')
        }
      })
    })
  }

  function decoratePlatformRows(rooms) {
    if (!isTotalPlatformOverview()) return
    var rows = document.querySelectorAll('.v-data-table tbody tr')
    Array.prototype.forEach.call(rows, function (row) {
      var cells = row.querySelectorAll('td')
      if (!cells.length) return
      var id = number(text(cells[0].textContent).trim(), 0)
      var room = null
      rooms.some(function (candidate) {
        if (candidate.id === id) { room = candidate; return true }
        return false
      })
      if (!room) return
      var statusCell = cells[2]
      if (!statusCell) return
      var status = statusCell.querySelector('.v-chip')
      if (!status || statusCell.querySelector('.' + ROOM_RUNNING_CLASS)) return
      var runningChip = status.cloneNode(true)
      runningChip.classList.add(ROOM_RUNNING_CLASS, 'android-stopped')
      chipText(runningChip, '关闭')
      statusCell.insertBefore(runningChip, status)
      runningFor(room).then(function (running) {
        runningChip.classList.toggle('android-running', !!running)
        runningChip.classList.toggle('android-stopped', !running)
        chipText(runningChip, running ? '运行' : '关闭')
      })
    })
  }

  function decorateRooms() {
    if (isRoomPreview() || !/^\/(?:rooms|platform)(?:\/|$)/i.test(routePath())) return
    fetchRooms().then(function (rooms) {
      decorateRoomCards(rooms)
      decoratePlatformRows(rooms)
    })
  }

  function stabilizeRoomPreviewViewport() {
    if (!document.body || !isRoomPreview()) return
    document.documentElement.classList.add('android-room-preview')
    document.body.classList.add('android-room-preview')
    /* A directly opened room uses the same dashboard/backup views as a
       normal platform entry.  Keep the outer wrapper edge-to-edge for the
       compact room menu, but retain the standard 1.5rem page gutter inside
       those routes.  The old normalization below zeroed only the left side
       of the page (and left the generated right-side padding in place), so
       the cards became visibly asymmetric when entered from the aggregate
       room list. */
    /* The native aggregate room entry uses the same room-preview shell for
       every leaf route.  The old normalization removed both inline gutters
       and restored them only on dashboard/backup/snapshot, so entering logs,
       game, install, upload, or the other tool pages from the aggregate list
       left their cards flush against the screen edge.  Keep the map's own
       responsive spacing untouched, but restore the normal 1.5rem page
       gutter for all other room pages. */
    var currentPath = routePath()
    var preservePageGutter = /^\/(?:dashboard|game|tools|logs|upload|install|platform)(?:\/|$)/i.test(currentPath)
      && !/^\/tools\/map(?:\/|$)/i.test(currentPath)
    var wrapper = document.querySelector('.layout-content-wrapper')
    if (wrapper) {
      var roomMenuOpen = document.body.classList.contains('android-room-menu-open')
      wrapper.style.setProperty('box-sizing', 'border-box', 'important')
      wrapper.style.setProperty('min-width', '0', 'important')
      wrapper.style.setProperty('margin', '0', 'important')
      wrapper.style.setProperty('padding-inline-start', '0', 'important')
      wrapper.style.setProperty('padding-left', '0', 'important')
      wrapper.style.setProperty('left', '0', 'important')
      wrapper.style.setProperty('inset-inline-start', '0', 'important')
      /* The custom room menu intentionally shifts the page by 88px while it
         is open.  Express that hand-off with margin/width so the wrapper does
         not regain a transform stacking context; every other route starts at
         the viewport edge. */
      if (roomMenuOpen) {
        wrapper.style.setProperty('margin-inline-start', '88px', 'important')
        wrapper.style.setProperty('margin-left', '88px', 'important')
        wrapper.style.setProperty('width', 'calc(100% - 88px)', 'important')
        wrapper.style.setProperty('max-width', 'calc(100% - 88px)', 'important')
        wrapper.style.setProperty('flex-basis', 'calc(100% - 88px)', 'important')
        wrapper.style.setProperty('transform', 'none', 'important')
      } else {
        wrapper.style.setProperty('margin-inline-start', '0', 'important')
        wrapper.style.setProperty('margin-left', '0', 'important')
        wrapper.style.setProperty('width', '100%', 'important')
        wrapper.style.setProperty('max-width', '100%', 'important')
        wrapper.style.setProperty('flex-basis', '100%', 'important')
        wrapper.style.setProperty('transform', 'none', 'important')
      }
    }
    document.querySelectorAll(
      '.layout-page-content,.page-content-container,.v-main,.v-main__wrap,.v-container')
      .forEach(function (node) {
        node.style.setProperty('box-sizing', 'border-box', 'important')
        node.style.setProperty('min-width', '0', 'important')
        node.style.setProperty('width', '100%', 'important')
        node.style.setProperty('max-width', '100%', 'important')
        node.style.setProperty('margin', '0', 'important')
        node.style.setProperty('margin-inline-start', '0', 'important')
        node.style.setProperty('margin-left', '0', 'important')
        node.style.setProperty('padding-inline-start', '0', 'important')
        node.style.setProperty('padding-left', '0', 'important')
        node.style.setProperty('left', '0', 'important')
        node.style.setProperty('inset-inline-start', '0', 'important')
      })
    if (preservePageGutter) {
      var page = document.querySelector('.layout-page-content')
      if (page) {
        /* Match the normal platform layout's boxed-content spacing on both
           inline sides.  Explicit longhands are intentional: the legacy
           mobile rules set padding-left/start independently. */
        page.style.setProperty('padding-inline-start', '1.5rem', 'important')
        page.style.setProperty('padding-inline-end', '1.5rem', 'important')
        page.style.setProperty('padding-left', '1.5rem', 'important')
        page.style.setProperty('padding-right', '1.5rem', 'important')
      }
    }
  }

  function stabilizeToolbar() {
    var nav = document.querySelector('.layout-navbar')
    if (!nav) return
    var subbarActive = !!(document.body && document.body.classList.contains(
      'android-room-subbar-active'))
    nav.classList.add('android-navbar-stable')
    nav.style.setProperty('position', 'fixed', 'important')
    nav.style.setProperty('inset-block-start', subbarActive
      ? 'var(--android-room-navbar-top,0px)' : '0', 'important')
    nav.style.setProperty('top', subbarActive
      ? 'var(--android-room-navbar-top,0px)' : '0', 'important')
    nav.style.setProperty('inset-inline-start', '0', 'important')
    nav.style.setProperty('inset-inline-end', '0', 'important')
    /* Physical edges are required by older tablet WebViews that do not
       invalidate logical insets immediately after a rotation. */
    nav.style.setProperty('left', '0', 'important')
    nav.style.setProperty('right', '0', 'important')
    nav.style.setProperty('width', '100%', 'important')
    nav.style.setProperty('z-index', '2147483638', 'important')
    nav.style.setProperty('opacity', '1', 'important')
    nav.style.setProperty('transition', 'none', 'important')
  }

  /* The bridge room picker is mounted at body level and normally reanchors on
     a 350 ms timer.  Compute the available toolbar width immediately after a
     menu/route mutation so a long room name never covers the right actions. */
  function alignRoomPickerNow() {
    var wrap = document.querySelector('.android-room-picker-wrap')
    if (!wrap) return
    var nav = document.querySelector('.layout-navbar')
    var menu = nav && (nav.querySelector('[data-android-menu-fixed]')
      || nav.querySelector('i.ri-menu-line')
      || nav.querySelector('button[aria-label*="菜单"]')
      || nav.querySelector('button[aria-label*="Menu"]'))
    if (menu && menu.tagName && menu.tagName.toLowerCase() !== 'button') {
      menu = menu.closest('button,[role="button"]') || menu
    }
    var navRect = nav && nav.getBoundingClientRect ? nav.getBoundingClientRect() : null
    var menuRect = menu && menu.getBoundingClientRect ? menu.getBoundingClientRect() : null
    var left = menuRect && menuRect.width > 0 ? menuRect.right + 8 : 8
    var right = navRect && navRect.right > left ? navRect.right - 8 : (window.innerWidth - 8)
    if (nav) {
      Array.prototype.forEach.call(nav.querySelectorAll('button,[role="button"]'), function (button) {
        var rect = button.getBoundingClientRect && button.getBoundingClientRect()
        if (!rect || rect.width <= 0 || rect.left <= left + 12) return
        if (button.closest('.android-room-picker-wrap')) return
        /* The first right-side action is the true boundary; subsequent
           actions are already outside the available room-name region. */
        right = Math.min(right, rect.left - 8)
      })
    }
    var available = Math.max(136, right - left)
    var cap = window.innerWidth > window.innerHeight
      ? Math.min(340, window.innerWidth * .42) : Math.min(300, window.innerWidth * .48)
    var width = Math.max(136, Math.min(cap, available))
    wrap.style.setProperty('left', Math.max(8, Math.round(left)) + 'px', 'important')
    wrap.style.setProperty('max-width', Math.round(width) + 'px', 'important')
    if (navRect && navRect.height > 0) {
      /* The navbar is the first fixed row.  Its picker therefore follows the
         navbar itself; never clamp it down into the independent subbar. */
      var navTop = Number(navRect.top)
      if (!isFinite(navTop)) navTop = 0
      navTop = Math.max(0, navTop)
      var top = navTop + Math.max(0, (navRect.height - wrap.offsetHeight) / 2)
      wrap.style.setProperty('top', Math.max(0, Math.round(top)) + 'px', 'important')
    }
  }

  function installImmediateLayoutGuards() {
    stabilizeToolbar()
    stabilizePlatformMenu()
    stabilizeRoomPreviewViewport()
    alignRoomPickerNow()
    var queued = false
    function schedule() {
      if (queued) return
      queued = true
      window.requestAnimationFrame(function () {
        queued = false
        stabilizeToolbar()
        stabilizePlatformMenu()
        stabilizeRoomPreviewViewport()
        alignRoomPickerNow()
        ensureRoomSubbar()
        decorateResponsiveTables()
        applyMapResponsive()
      })
    }
    document.addEventListener('pointerdown', function (event) {
      var target = event.target
      if (target && target.closest && target.closest(
        '.layout-navbar,.android-room-picker-wrap,#android-room-menu')) schedule()
    }, true)
    window.addEventListener('hashchange', schedule)
    window.addEventListener('resize', schedule)
    window.addEventListener('orientationchange', schedule)
    if (window.visualViewport) window.visualViewport.addEventListener('resize', schedule)
    if (window.ResizeObserver) {
      var observer = new ResizeObserver(schedule)
      var nav = document.querySelector('.layout-navbar')
      if (nav) observer.observe(nav)
    }
    if (window.MutationObserver && document.body) {
      var mutationObserver = new MutationObserver(function () { schedule() })
      /* Do not observe class/style attributes here.  The guards below write
         those attributes themselves (toolbar position, route classes,
         responsive table classes, etc.); observing them creates a self-
         sustaining MutationObserver -> rAF -> style-write loop which can
         monopolize the WebView when a route opens.  Route/component DOM
         replacement is still covered by childList/subtree, while resize,
         orientation and pointer events schedule the layout pass explicitly. */
      mutationObserver.observe(document.body, {
        childList: true, subtree: true
      })
    }
    /* These guards used to run every 120ms and each pass queried several
       document-wide collections.  During a Vue route mount that competed
       with layout and image work and made the WebView appear frozen.  DOM
       replacement is already covered by the coalesced observer above; this
       slower timer is only a safety net for a toolbar recreated without a
       child-list notification. */
    window.setInterval(function () {
      stabilizeToolbar()
      stabilizePlatformMenu()
      alignRoomPickerNow()
    }, 650)
  }

  function install() {
    if (!document.body) return
    installStyle()
    installHorizontalMenuLock()
    installTapFeedback()
    installImmediateLayoutGuards()
    normalizeRoomPreviewLayout()
    ensureRoomSubbar()
    decorateResponsiveTables()
    hideLegacyRoomLabels()
       hideDuplicateDownloadButton()
       hidePlatformThemeButton()
    stabilizePlatformMenu()
    decorateTokenControls()
    decorateRooms()
    /* Vue/Vuetify can commit dozens of childList mutations while a route is
       mounting.  Run one decoration pass per frame instead of executing the
       whole page scan synchronously for every mutation; this keeps route
       transitions responsive and also prevents our own DOM decorations from
       cascading into a long callback queue. */
    var observerFrame = 0
    var scheduleObserverPass = function () {
      if (observerFrame) return
      var run = function () {
        observerFrame = 0
        normalizeRoomPreviewLayout()
        hideLegacyRoomLabels()
        hideDuplicateDownloadButton()
        hidePlatformThemeButton()
        stabilizePlatformMenu()
        decorateTokenControls()
        ensureRoomSubbar()
        decorateResponsiveTables()
        applyMapResponsive()
        decorateRooms()
      }
      if (window.requestAnimationFrame) observerFrame = window.requestAnimationFrame(run)
      else observerFrame = window.setTimeout(run, 16)
    }
    var observer = window.MutationObserver ? new MutationObserver(scheduleObserverPass) : null
    if (observer) observer.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', normalizeRoomPreviewLayout)
    window.addEventListener('resize', applyMapResponsive)
    window.addEventListener('orientationchange', function () {
      window.setTimeout(normalizeRoomPreviewLayout, 80)
      window.setTimeout(applyMapResponsive, 80)
      window.setTimeout(decorateRooms, 180)
    })
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', normalizeRoomPreviewLayout)
      window.visualViewport.addEventListener('resize', applyMapResponsive)
    }
    window.setInterval(function () {
      normalizeRoomPreviewLayout()
      hideLegacyRoomLabels()
      hideDuplicateDownloadButton()
       hidePlatformThemeButton()
      stabilizePlatformMenu()
      decorateTokenControls()
      ensureRoomSubbar()
      decorateResponsiveTables()
      applyMapResponsive()
      if (isTotalPlatformOverview()) decorateRooms()
    }, 1800)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true })
  } else {
    install()
  }
})()
