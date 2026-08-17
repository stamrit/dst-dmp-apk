package cn.xiaojie_gjs.bianjiemj.ui.dmp;

import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
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

    public static final String EXTRA_SERVER_ID = "dmp_server_id";
    public static final String EXTRA_SERVER_HOST = "dmp_server_host";
    public static final String EXTRA_SERVER_PORT = "dmp_server_port";
    public static final String EXTRA_SERVER_PROTOCOL = "dmp_server_protocol";
    public static final String EXTRA_SERVER_TOKEN = "dmp_server_token";
    public static final String EXTRA_SERVER_REMARK = "dmp_server_remark";
    public static final String EXTRA_ROOM_ID = "dmp_room_id";
    public static final String EXTRA_ROOM_NAME = "dmp_room_name";
    public static final String EXTRA_NIGHT_MODE = "dmp_night_mode";

    private static final String ROOM_OVERVIEW_URL =
            "file:///android_asset/dmp_web/index.html#/rooms";
    private static final String ROOM_DASHBOARD_URL =
            "file:///android_asset/dmp_web/index.html#/dashboard";
    private static final String LOCAL_ASSET_PREFIX = "file:///android_asset/dmp_web/";

    private ActivityDmpWebBinding binding;
    private boolean mainFrameFailed;
    private String initialUrl = ROOM_OVERVIEW_URL;

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
        initialUrl = roomId > 0 ? ROOM_DASHBOARD_URL : ROOM_OVERVIEW_URL;
        String roomName = getIntent().getStringExtra(EXTRA_ROOM_NAME);
        if (roomName == null) {
            roomName = "";
        }
        binding.dmpWebRetry.setOnClickListener(v -> loadInitialPage());
        binding.dmpWebChangeServer.setOnClickListener(v -> finish());
        configureWebView(server, roomId, roomName, nightMode);
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
            boolean nightMode) {
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
                new DmpJavascriptBridge(this, server, roomId, roomName, nightMode),
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

    private void handleBack() {
        if (binding.dmpWebErrorPanel.getVisibility() == View.VISIBLE) {
            finish();
        } else if (binding.dmpWebView.canGoBack()) {
            binding.dmpWebView.goBack();
        } else {
            finish();
        }
    }

    @Override
    public void onBackPressed() {
        handleBack();
    }

    @Override
    protected void onDestroy() {
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
