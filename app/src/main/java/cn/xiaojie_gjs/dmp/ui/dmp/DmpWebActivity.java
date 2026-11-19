package cn.xiaojie_gjs.dmp.ui.dmp;

import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.provider.Settings;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.ValueCallback;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.appcompat.app.AppCompatDelegate;
import androidx.webkit.WebViewAssetLoader;

import cn.xiaojie_gjs.dmp.BuildConfig;
import cn.xiaojie_gjs.dmp.R;
import cn.xiaojie_gjs.dmp.databinding.ActivityDmpWebBinding;

/** Hosts the desktop DMP Vue dashboard locally while APIs target the selected server. */
public class DmpWebActivity extends AppCompatActivity {

    private static final String TAG = "DmpRoomSelection";
    private static final int REQUEST_DMP_FILE = 19041;

    public static final String EXTRA_SERVER_ID = "dmp_server_id";
    public static final String EXTRA_SERVER_HOST = "dmp_server_host";
    public static final String EXTRA_SERVER_PORT = "dmp_server_port";
    public static final String EXTRA_SERVER_PROTOCOL = "dmp_server_protocol";
    public static final String EXTRA_SERVER_TOKEN = "dmp_server_token";
    public static final String EXTRA_SERVER_REMARK = "dmp_server_remark";
    public static final String EXTRA_ROOM_ID = "dmp_room_id";
    public static final String EXTRA_ROOM_NAME = "dmp_room_name";
    public static final String EXTRA_PERSIST_ROOM_SELECTION = "dmp_persist_room_selection";
    public static final String EXTRA_SELECTED_ROOM_ID = "dmp_selected_room_id";
    public static final String EXTRA_SELECTED_ROOM_NAME = "dmp_selected_room_name";
    public static final String EXTRA_START_CREATE_ROOM = "dmp_start_create_room";
    public static final String EXTRA_NIGHT_MODE = "dmp_night_mode";
    public static final String EXTRA_ANDROID_DOWNLOAD_UI = "dmp_android_download_ui";
    public static final String EXTRA_ANDROID_MOD_CONFIG_UI = "dmp_android_mod_config_ui";
    /** True when this room was opened from native total-room management. */
    public static final String EXTRA_FROM_ROOM_MANAGEMENT = "dmp_from_room_management";

    /** Local file origin used for the bundled DMP web application. */
    private static final String LOCAL_ASSET_HOST = "appassets.androidplatform.net";
    private static final String LOCAL_ASSET_BASE = "file:///android_asset/dmp_web/";
    private static final String ROOM_OVERVIEW_URL =
            LOCAL_ASSET_BASE + "index.html#/rooms";
    private static final String ROOM_CREATE_URL =
            LOCAL_ASSET_BASE + "index.html#/game/base";
    private static final String ROOM_DASHBOARD_URL =
            LOCAL_ASSET_BASE + "index.html#/dashboard";

    private ActivityDmpWebBinding binding;
    @Nullable
    private WebViewAssetLoader assetLoader;
    private boolean mainFrameFailed;
    private boolean fromRoomManagement;
    private String initialUrl = ROOM_OVERVIEW_URL;
    @Nullable
    private ValueCallback<Uri[]> pendingFileCallback;
    @Nullable
    private DmpJavascriptBridge javascriptBridge;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        boolean nightMode = getIntent().getBooleanExtra(EXTRA_NIGHT_MODE, true);
        boolean androidDownloadUi = getIntent().getBooleanExtra(EXTRA_ANDROID_DOWNLOAD_UI, true);
        boolean androidModConfigUi = getIntent().getBooleanExtra(EXTRA_ANDROID_MOD_CONFIG_UI, true);
        getDelegate().setLocalNightMode(nightMode
                ? AppCompatDelegate.MODE_NIGHT_YES
                : AppCompatDelegate.MODE_NIGHT_NO);
        // Set the Activity window surface before the first layout inflation;
        // this also covers the short handoff from the native launcher to the
        // WebView and prevents a white window behind the persistent underlay.
        getWindow().setBackgroundDrawable(new ColorDrawable(themeBackground(nightMode)));
        super.onCreate(savedInstanceState);
        binding = ActivityDmpWebBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());
        // Keep one native, theme-colored surface underneath the WebView for
        // the entire Activity lifetime.  Route changes and asset reloads may
        // temporarily leave the WebView unpainted; a transparent WebView
        // then exposes this underlay rather than flashing white.
        int persistentBackground = themeBackground(nightMode);
        binding.dmpPersistentBackground.setBackgroundColor(persistentBackground);
        binding.getRoot().setBackgroundColor(persistentBackground);

        DmpServer server = readServer();
        if (server == null) {
            Toast.makeText(this, R.string.dmp_invalid_address, Toast.LENGTH_SHORT).show();
            finish();
            return;
        }

        int roomId = getIntent().getIntExtra(EXTRA_ROOM_ID, 0);
        int selectedRoomId = getIntent().getIntExtra(EXTRA_SELECTED_ROOM_ID, 0);
        String selectedRoomName = getIntent().getStringExtra(EXTRA_SELECTED_ROOM_NAME);
        if (selectedRoomName == null) {
            selectedRoomName = "";
        }
        boolean persistRoomSelection = getIntent().getBooleanExtra(
                EXTRA_PERSIST_ROOM_SELECTION, false);
        fromRoomManagement = getIntent().getBooleanExtra(EXTRA_FROM_ROOM_MANAGEMENT, false);
        if (BuildConfig.DEBUG) {
            Log.d(TAG, "web entry server=" + server.id + " room=" + roomId
                    + " selected=" + selectedRoomId + " fromRooms=" + fromRoomManagement);
        }
        boolean startCreateRoom = getIntent().getBooleanExtra(EXTRA_START_CREATE_ROOM, false);
        // Keep the original file:// entry point used by the old mobile DMP.
        // The route catalogue is now available synchronously to the 3.2
        // router guard, so direct room/create entry can retain its old target
        // instead of first showing the platform overview.
        if (roomId > 0) {
            initialUrl = ROOM_DASHBOARD_URL;
        } else if (startCreateRoom) {
            initialUrl = ROOM_CREATE_URL;
        } else {
            initialUrl = ROOM_OVERVIEW_URL;
        }
        String roomName = getIntent().getStringExtra(EXTRA_ROOM_NAME);
        if (roomName == null) {
            roomName = "";
        }
        binding.dmpWebRetry.setOnClickListener(v -> loadInitialPage());
        binding.dmpWebChangeServer.setOnClickListener(v -> finish());
        configureWebView(server, roomId, roomName, selectedRoomId, selectedRoomName,
                nightMode, persistRoomSelection, androidDownloadUi, androidModConfigUi);
        loadInitialPage();
    }

    @Nullable
    private DmpServer readServer() {
        Intent intent = getIntent();
        String host = intent.getStringExtra(EXTRA_SERVER_HOST);
        String token = intent.getStringExtra(EXTRA_SERVER_TOKEN);
        int port = intent.getIntExtra(EXTRA_SERVER_PORT, -1);
        if (host == null || host.trim().isEmpty() || token == null || token.trim().isEmpty()
                || port < 1 || port > 65535) {
            return null;
        }
        return new DmpServer(
                intent.getStringExtra(EXTRA_SERVER_ID),
                host,
                port,
                intent.getStringExtra(EXTRA_SERVER_PROTOCOL),
                token,
                intent.getStringExtra(EXTRA_SERVER_REMARK));
    }

    private int themeBackground(boolean useNightMode) {
        return Color.parseColor(useNightMode ? "#24213D" : "#F4F2FA");
    }

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    private void configureWebView(
            DmpServer server,
            int roomId,
            String roomName,
            int selectedRoomId,
            String selectedRoomName,
            boolean nightMode,
            boolean persistRoomSelection,
            boolean androidDownloadUi,
            boolean androidModConfigUi) {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        WebSettings settings = binding.dmpWebView.getSettings();
        // The native persistent background is the fallback surface while the
        // bundled page is loading.  The page's own html/body colors still
        // paint normally once its document is ready.
        binding.dmpWebView.setBackgroundColor(Color.TRANSPARENT);
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        // The DMP API is normally plain HTTP and does not emit CORS headers.
        // Keep the trusted, bundled page on the legacy file origin so the
        // WebView can call the selected server directly without a preflight
        // being rejected by the DMP backend.  The page is loaded only from
        // APK assets and external navigations are still blocked below.
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        // The selected DMP hosts may be HTTP-only; the trusted APK page must
        // be able to reach them from its file origin in release builds too.
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        // This is a responsive mobile UI, not a document viewer.  Leaving
        // WebView's built-in zoom enabled makes a two-finger scroll gesture
        // resize the whole page (especially on Huawei tablets), after which
        // the toolbar and fixed overlays are laid out at the wrong scale.
        // Keep normal one-/two-finger scrolling, but disable pinch zoom.
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        CookieManager.getInstance().setAcceptCookie(true);

        // WebKit 1.6 exposes only the Context constructor for
        // AssetsPathHandler.  Wrap it so each URL prefix is translated to
        // the corresponding subdirectory in the APK's assets tree.
        assetLoader = new WebViewAssetLoader.Builder()
                // Normal page-relative resources: /dmp_web/index.html and
                // /dmp_web/assets/*.js|css|woff2|...
                .addPathHandler("/dmp_web/",
                        new PrefixedAssetPathHandler(this, "dmp_web/"))
                // Vite's preload map may resolve `assets/foo` from the origin
                // root.  Alias that path back to the bundled DMP assets.
                .addPathHandler("/assets/",
                        new PrefixedAssetPathHandler(this, "dmp_web/assets/"))
                // The bundle also references dmp.svg/favicon at its origin
                // root on Android WebView; map those safely to dmp_web.
                .addPathHandler("/",
                        new PrefixedAssetPathHandler(this, "dmp_web/"))
                .build();

        javascriptBridge = new DmpJavascriptBridge(
                this, server, roomId, roomName, selectedRoomId, selectedRoomName,
                nightMode, persistRoomSelection, androidDownloadUi, androidModConfigUi);
        binding.dmpWebView.addJavascriptInterface(javascriptBridge, "AndroidDmp");
        binding.dmpWebView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                binding.dmpWebProgress.setProgress(newProgress);
                binding.dmpWebProgress.setVisibility(newProgress < 100 ? View.VISIBLE : View.GONE);
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
                if (BuildConfig.DEBUG) {
                    Log.e(TAG, "web console " + consoleMessage.messageLevel()
                            + " " + consoleMessage.message() + " @"
                            + consoleMessage.sourceId() + ":" + consoleMessage.lineNumber());
                }
                return super.onConsoleMessage(consoleMessage);
            }

            @Override
            public boolean onShowFileChooser(
                    WebView webView,
                    ValueCallback<Uri[]> filePathCallback,
                    FileChooserParams fileChooserParams) {
                if (pendingFileCallback != null) {
                    pendingFileCallback.onReceiveValue(null);
                }
                pendingFileCallback = filePathCallback;
                Intent chooser = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                chooser.addCategory(Intent.CATEGORY_OPENABLE);
                // DMP archive import accepts ZIP files.  A wildcard fallback is
                // necessary on a number of Android file managers which do not
                // advertise application/zip correctly.
                chooser.setType("application/zip");
                chooser.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                        "application/zip",
                        "application/x-zip-compressed",
                        "application/octet-stream",
                        "*/*"
                });
                try {
                    startActivityForResult(chooser, REQUEST_DMP_FILE);
                } catch (ActivityNotFoundException exception) {
                    pendingFileCallback = null;
                    filePathCallback.onReceiveValue(null);
                    Toast.makeText(DmpWebActivity.this,
                            R.string.dmp_no_external_app, Toast.LENGTH_SHORT).show();
                }
                return true;
            }
        });
        binding.dmpWebView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(
                    @NonNull WebView view,
                    @NonNull WebResourceRequest request) {
                Uri uri = request.getUrl();
                String url = uri.toString();
                // Backup exports are generated as a Blob URL by the desktop
                // axios helper.  There is no Android app that can handle a
                // blob: intent; the injected Android bridge has already
                // handed the corresponding server endpoint to DownloadManager.
                // Consume the synthetic navigation here so a failed fallback
                // cannot show the misleading "没有可处理此链接的应用" toast.
                if ("blob".equalsIgnoreCase(uri.getScheme())) {
                    return true;
                }
                if (isLocalDmpUrl(uri) || "about:blank".equals(url)) {
                    return false;
                }
                // Do not turn arbitrary WebView navigations (intent:, file:,
                // content:, javascript:, etc.) into Android intents.  Only
                // ordinary web links leave the trusted bundled document.
                if (!isHttpUrl(uri)) {
                    return true;
                }
                openExternal(uri);
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                mainFrameFailed = false;
                binding.dmpWebErrorPanel.setVisibility(View.GONE);
                binding.dmpWebView.setVisibility(View.VISIBLE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (!mainFrameFailed) {
                }
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(
                    @NonNull WebView view,
                    @NonNull WebResourceRequest request) {
                WebViewAssetLoader loader = assetLoader;
                if (loader != null) {
                    WebResourceResponse response = loader.shouldInterceptRequest(request.getUrl());
                    if (response != null) {
                        return response;
                    }
                }
                return super.shouldInterceptRequest(view, request);
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(
                    @NonNull WebView view,
                    @NonNull String url) {
                WebViewAssetLoader loader = assetLoader;
                if (loader != null) {
                    WebResourceResponse response = loader.shouldInterceptRequest(Uri.parse(url));
                    if (response != null) {
                        return response;
                    }
                }
                return super.shouldInterceptRequest(view, url);
            }

            @Override
            public void onReceivedError(
                    WebView view,
                    WebResourceRequest request,
                    WebResourceError error) {
                if (BuildConfig.DEBUG) {
                    Log.e(TAG, "web resource error main=" + request.isForMainFrame()
                            + " url=" + request.getUrl() + " code=" + error.getErrorCode()
                            + " detail=" + error.getDescription());
                }
                if (request.isForMainFrame()) {
                    mainFrameFailed = true;
                    showLoadError(error.getDescription() == null
                            ? getString(R.string.dmp_error_unknown)
                            : error.getDescription().toString());
                }
            }
        });
        binding.dmpWebView.setDownloadListener((url, userAgent, contentDisposition, mimeType, length) -> {
            Uri uri = Uri.parse(url == null ? "" : url);
            // A Blob URL has no server-side address and is intentionally
            // consumed by shouldOverrideUrlLoading above.  For a real DMP
            // export, route the URL through the native bridge so the transfer
            // appears in the task centre and lands in Download/DMP.
            if ("blob".equalsIgnoreCase(uri.getScheme())) {
                return;
            }
            DmpJavascriptBridge bridge = javascriptBridge;
            String path = uri.getPath() == null ? "" : uri.getPath();
            if (bridge != null && path.contains("/tools/backup/download")) {
                String name = contentDisposition == null ? "" : contentDisposition;
                bridge.downloadFile(url, name);
                return;
            }
            openExternal(uri);
        });
    }

    private void loadInitialPage() {
        mainFrameFailed = false;
        binding.dmpWebErrorPanel.setVisibility(View.GONE);
        binding.dmpWebView.setVisibility(View.VISIBLE);
        binding.dmpWebView.loadUrl(initialUrl);
    }

    private static boolean isLocalDmpUrl(@NonNull Uri uri) {
        String scheme = uri.getScheme();
        if ("file".equalsIgnoreCase(scheme)) {
            String path = uri.getPath();
            return path != null && path.startsWith("/android_asset/dmp_web/");
        }
        return "https".equalsIgnoreCase(scheme)
                && LOCAL_ASSET_HOST.equalsIgnoreCase(uri.getHost());
    }

    /** Maps an appassets URL prefix to a subdirectory under APK assets. */
    private static final class PrefixedAssetPathHandler
            implements WebViewAssetLoader.PathHandler {
        private final WebViewAssetLoader.AssetsPathHandler delegate;
        private final String prefix;

        PrefixedAssetPathHandler(android.content.Context context, String prefix) {
            this.delegate = new WebViewAssetLoader.AssetsPathHandler(context);
            this.prefix = prefix == null ? "" : prefix;
        }

        @Override
        public WebResourceResponse handle(String path) {
            String relative = path == null ? "" : path;
            while (relative.startsWith("/")) {
                relative = relative.substring(1);
            }
            // Do not allow a malformed URL to escape the bundled asset tree.
            if (relative.contains("..") || relative.indexOf('\\') >= 0) {
                return null;
            }
            return delegate.handle(prefix + relative);
        }
    }

    private void showLoadError(String detail) {
        binding.dmpWebProgress.setVisibility(View.GONE);
        binding.dmpWebView.setVisibility(View.GONE);
        binding.dmpWebErrorPanel.setVisibility(View.VISIBLE);
        binding.dmpWebErrorDetail.setText(getString(R.string.dmp_error_detail, detail));
    }

    void openExternal(Uri uri) {
        if (uri == null || !isHttpUrl(uri)) {
            return;
        }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException exception) {
            Toast.makeText(this, R.string.dmp_no_external_app, Toast.LENGTH_SHORT).show();
        }
    }

    private static boolean isHttpUrl(@Nullable Uri uri) {
        if (uri == null) {
            return false;
        }
        String scheme = uri.getScheme();
        return "http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme);
    }

    /** Explain how to restore clipboard access when Android blocks the WebView/native write. */
    void showClipboardPermissionHint() {
        runOnUiThread(() -> {
            if (isFinishing() || isDestroyed()) return;
            new androidx.appcompat.app.AlertDialog.Builder(this)
                    .setTitle("需要剪切板权限")
                    .setMessage("系统当前禁止应用写入剪切板，请在系统设置中允许剪切板访问后再试。")
                    .setNegativeButton("取消", null)
                    .setPositiveButton("打开系统设置", (dialog, which) -> {
                        try {
                            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                    Uri.parse("package:" + getPackageName()));
                            startActivity(intent);
                        } catch (RuntimeException exception) {
                            Toast.makeText(this, "无法打开系统设置", Toast.LENGTH_SHORT).show();
                        }
                    }).show();
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_DMP_FILE) {
            return;
        }
        ValueCallback<Uri[]> callback = pendingFileCallback;
        pendingFileCallback = null;
        if (callback == null) {
            return;
        }
        if (resultCode != RESULT_OK || data == null) {
            callback.onReceiveValue(null);
            return;
        }
        ClipData clipData = data.getClipData();
        if (clipData != null && clipData.getItemCount() > 0) {
            Uri[] results = new Uri[clipData.getItemCount()];
            for (int index = 0; index < clipData.getItemCount(); index++) {
                results[index] = clipData.getItemAt(index).getUri();
            }
            callback.onReceiveValue(results);
        } else if (data.getData() != null) {
            callback.onReceiveValue(new Uri[]{data.getData()});
        } else {
            callback.onReceiveValue(null);
        }
    }

    private void handleBack() {
        // Room-preview mod/player cards are WebView overlays.  They must
        // consume the first Android Back press before the shell changes the
        // dashboard route; otherwise a card that is still open appears to
        // jump straight back to the room overview.  The helper is provided
        // by dmp-room-preview-cards.js and is deliberately best-effort so an
        // older cached page still follows the normal native route handling.
        if (binding != null && binding.dmpWebView != null) {
            binding.dmpWebView.evaluateJavascript(
                    "(function(){try{return !!(window.__dmpCloseRoomPreviewCard "
                            + "&& window.__dmpCloseRoomPreviewCard())}catch(e){return false}})()",
                    result -> {
                        if (result != null && result.replace("\"", "")
                                .trim().equalsIgnoreCase("true")) {
                            return;
                        }
                        handleBackRoute();
                    });
            return;
        }
        handleBackRoute();
    }

    /** Route-level Back handling after WebView overlays had a chance to close. */
    private void handleBackRoute() {
        if (binding.dmpWebErrorPanel.getVisibility() == View.VISIBLE) {
            finish();
        } else {
            String route = currentRoute();
            if (route.startsWith("/rooms")) {
                finish();
                return;
            }
            if (route.startsWith("/dashboard")) {
                if (fromRoomManagement) {
                    // Total-room management already is the correct parent;
                    // do not open the room preview a second time.
                    if (BuildConfig.DEBUG) {
                        Log.d(TAG, "back dashboard -> native room management");
                    }
                    finish();
                    return;
                }
                if (BuildConfig.DEBUG) {
                    Log.d(TAG, "back dashboard -> room overview");
                }
                navigateToRoute("/rooms");
                return;
            }
            if (route.startsWith("/game/mod") || route.startsWith("/game/player")) {
                selectFirstSubmenuOrDashboard();
                return;
            }
            // Room settings and every other leaf page return to the current
            // room control panel instead of replaying WebView history.
            navigateToRoute("/dashboard");
        }
    }

    private String currentRoute() {
        String url = binding.dmpWebView.getUrl();
        if (url == null) {
            return "";
        }
        int hash = url.indexOf('#');
        if (hash < 0 || hash + 1 >= url.length()) {
            return "";
        }
        String route = url.substring(hash + 1);
        int query = route.indexOf('?');
        if (query >= 0) {
            route = route.substring(0, query);
        }
        return route.isEmpty() ? "/" : route;
    }

    private void navigateToRoute(String route) {
        // The Android bridge keeps the last leaf route so an unauthorised
        // `/login -> /rooms` bounce can be restored.  A native Back action is
        // an explicit room-overview navigation, so mark it before changing
        // the hash; otherwise the continuity guard immediately restores the
        // control panel and Back appears to do nothing.
        String safeRoute = route == null ? "/dashboard"
                : route.replace("\\", "\\\\").replace("'", "\\'");
        binding.dmpWebView.loadUrl("javascript:(function(){try{if('"
                + safeRoute
                + "'==='/rooms'){sessionStorage.setItem('dmp-android-explicit-rooms-at',String(Date.now()));sessionStorage.removeItem('dmp-android-last-leaf-route');sessionStorage.removeItem('dmp-android-last-leaf-at');}}catch(e){}location.hash='"
                + safeRoute + "';})()");
    }

    /** Returns from a later tab (添加/配置、管理员/黑名单等) to its first tab. */
    private void selectFirstSubmenuOrDashboard() {
        binding.dmpWebView.evaluateJavascript(
                "(function(){var t=[].slice.call(document.querySelectorAll('.v-tabs .v-tab'));"
                        + "if(!t.length){location.hash='#/dashboard';return;}"
                        + "var a=t.findIndex(function(x){return x.classList.contains('v-tab--selected')"
                        + "||x.getAttribute('aria-selected')==='true';});"
                        + "if(a>0){t[0].click();return;}location.hash='#/dashboard';})()",
                null);
    }

    @Override
    public void onBackPressed() {
        handleBack();
    }

    @Override
    protected void onDestroy() {
        if (pendingFileCallback != null) {
            pendingFileCallback.onReceiveValue(null);
            pendingFileCallback = null;
        }
        if (binding != null) {
            javascriptBridge = null;
            binding.dmpWebView.removeJavascriptInterface("AndroidDmp");
            binding.dmpWebView.stopLoading();
            binding.dmpWebView.setWebChromeClient(null);
            binding.dmpWebView.setWebViewClient(null);
            binding.dmpWebView.loadUrl("about:blank");
            binding.dmpWebView.clearHistory();
            binding.dmpWebView.removeAllViews();
            binding.dmpWebView.destroy();
            WebStorage.getInstance().deleteAllData();
            binding = null;
        }
        super.onDestroy();
    }
}
