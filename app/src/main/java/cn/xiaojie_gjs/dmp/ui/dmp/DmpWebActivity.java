package cn.xiaojie_gjs.dmp.ui.dmp;

import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
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
    /** True when this room was opened from native total-room management. */
    public static final String EXTRA_FROM_ROOM_MANAGEMENT = "dmp_from_room_management";

    private static final String ROOM_OVERVIEW_URL =
            "file:///android_asset/dmp_web/index.html#/rooms";
    private static final String ROOM_CREATE_URL =
            "file:///android_asset/dmp_web/index.html#/game/base";
    private static final String ROOM_DASHBOARD_URL =
            "file:///android_asset/dmp_web/index.html#/dashboard";
    private static final String LOCAL_ASSET_PREFIX = "file:///android_asset/dmp_web/";

    private ActivityDmpWebBinding binding;
    private boolean mainFrameFailed;
    private boolean fromRoomManagement;
    private String initialUrl = ROOM_OVERVIEW_URL;
    @Nullable
    private ValueCallback<Uri[]> pendingFileCallback;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        boolean nightMode = getIntent().getBooleanExtra(EXTRA_NIGHT_MODE, true);
        getDelegate().setLocalNightMode(nightMode
                ? AppCompatDelegate.MODE_NIGHT_YES
                : AppCompatDelegate.MODE_NIGHT_NO);
        super.onCreate(savedInstanceState);
        binding = ActivityDmpWebBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());

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
        Log.d(TAG, "web entry server=" + server.id + " room=" + roomId
                + " selected=" + selectedRoomId + " fromRooms=" + fromRoomManagement);
        boolean startCreateRoom = getIntent().getBooleanExtra(EXTRA_START_CREATE_ROOM, false);
        initialUrl = roomId > 0
                ? ROOM_DASHBOARD_URL
                : (startCreateRoom ? ROOM_CREATE_URL : ROOM_OVERVIEW_URL);
        String roomName = getIntent().getStringExtra(EXTRA_ROOM_NAME);
        if (roomName == null) {
            roomName = "";
        }
        binding.dmpWebRetry.setOnClickListener(v -> loadInitialPage());
        binding.dmpWebChangeServer.setOnClickListener(v -> finish());
        configureWebView(server, roomId, roomName, selectedRoomId, selectedRoomName,
                nightMode, persistRoomSelection);
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

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    private void configureWebView(
            DmpServer server,
            int roomId,
            String roomName,
            int selectedRoomId,
            String selectedRoomName,
            boolean nightMode,
            boolean persistRoomSelection) {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        WebSettings settings = binding.dmpWebView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        CookieManager.getInstance().setAcceptCookie(true);

        binding.dmpWebView.addJavascriptInterface(
                new DmpJavascriptBridge(this, server, roomId, roomName, selectedRoomId,
                        selectedRoomName, nightMode, persistRoomSelection),
                "AndroidDmp");
        binding.dmpWebView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                binding.dmpWebProgress.setProgress(newProgress);
                binding.dmpWebProgress.setVisibility(newProgress < 100 ? View.VISIBLE : View.GONE);
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
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
                if (url.startsWith(LOCAL_ASSET_PREFIX) || "about:blank".equals(url)) {
                    return false;
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
            public void onReceivedError(
                    WebView view,
                    WebResourceRequest request,
                    WebResourceError error) {
                if (request.isForMainFrame()) {
                    mainFrameFailed = true;
                    showLoadError(error.getDescription() == null
                            ? getString(R.string.dmp_error_unknown)
                            : error.getDescription().toString());
                }
            }
        });
        binding.dmpWebView.setDownloadListener((url, userAgent, contentDisposition, mimeType, length) ->
                openExternal(Uri.parse(url)));
    }

    private void loadInitialPage() {
        mainFrameFailed = false;
        binding.dmpWebErrorPanel.setVisibility(View.GONE);
        binding.dmpWebView.setVisibility(View.VISIBLE);
        binding.dmpWebView.loadUrl(initialUrl);
    }

    private void showLoadError(String detail) {
        binding.dmpWebProgress.setVisibility(View.GONE);
        binding.dmpWebView.setVisibility(View.GONE);
        binding.dmpWebErrorPanel.setVisibility(View.VISIBLE);
        binding.dmpWebErrorDetail.setText(getString(R.string.dmp_error_detail, detail));
    }

    void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException exception) {
            Toast.makeText(this, R.string.dmp_no_external_app, Toast.LENGTH_SHORT).show();
        }
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
                    Log.d(TAG, "back dashboard -> native room management");
                    finish();
                    return;
                }
                Log.d(TAG, "back dashboard -> room overview");
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
        binding.dmpWebView.loadUrl("javascript:(function(){location.hash='"
                + route + "';})()");
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
