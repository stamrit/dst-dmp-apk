package cn.xiaojie_gjs.dmp.ui.dmp;

import android.app.DownloadManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.atomic.AtomicLong;
import java.util.zip.ZipFile;

import cn.xiaojie_gjs.dmp.R;
import cn.xiaojie_gjs.dmp.BuildConfig;

/** Minimal Electron preload compatibility layer exposed only to bundled trusted DMP assets. */
final class DmpJavascriptBridge {

    private static final String TAG = "DmpRoomSelection";
    /** Shared, token-free snapshots used by the native platform task center. */
    static final String PREF_WEB_DOWNLOAD_TASKS = "dmp_web_download_tasks";
    /** Per-server local dismissals, retained after a WebView is destroyed. */
    private static final String PREF_WEB_DOWNLOAD_DISMISSED_TASKS =
            "dmp_web_download_dismissed_tasks";
    /** DownloadManager records for server-to-phone transfers (backup exports). */
    private static final String PREF_NATIVE_TRANSFER_TASKS = "dmp_native_transfer_tasks";
    /** Per-server, token-free platform notices collected by the WebView. */
    static final String PREF_PLATFORM_NOTIFICATIONS = "dmp_platform_notifications";
    private static final Object NATIVE_TRANSFER_LOCK = new Object();
    private static final Object WEB_DOWNLOAD_LOCK = new Object();
    /**
     * DownloadManager can remain in STATUS_RUNNING after the DMP log endpoint
     * has stopped producing bytes. Log exports use this small resumable worker
     * instead; backup/file exports continue to use DownloadManager.
     */
    private static final ExecutorService LOG_TRANSFER_EXECUTOR =
            Executors.newCachedThreadPool(new ThreadFactory() {
                @Override
                public Thread newThread(Runnable runnable) {
                    Thread thread = new Thread(runnable, "dmp-log-transfer");
                    thread.setDaemon(true);
                    return thread;
                }
            });
    private static final Map<Long, Future<?>> ACTIVE_LOG_TRANSFERS =
            new ConcurrentHashMap<>();
    private static final AtomicLong NEXT_LOG_TRANSFER_ID =
            new AtomicLong(-Math.max(1L, System.currentTimeMillis()));
    private static final int LOG_TRANSFER_BUFFER_SIZE = 64 * 1024;
    private static final int LOG_TRANSFER_MAX_RETRIES = 4;
    private static final int LOG_TRANSFER_CONNECT_TIMEOUT_MS = 30_000;
    private static final int LOG_TRANSFER_READ_TIMEOUT_MS = 45_000;

    /** Keep server names, paths and DownloadManager ids out of release logs. */
    private static void logWarning(String message, Throwable exception) {
        if (BuildConfig.DEBUG) {
            Log.w(TAG, message, exception);
        }
    }

    private final DmpWebActivity activity;
    private final DmpServer server;
    private final int roomId;
    private final String roomName;
    private int selectedRoomId;
    private String selectedRoomName;
    private final boolean nightMode;
    private final boolean persistRoomSelection;
    private final boolean androidDownloadUi;
    private final boolean androidModConfigUi;

    DmpJavascriptBridge(
            DmpWebActivity activity,
            DmpServer server,
            int roomId,
            String roomName,
            int selectedRoomId,
            String selectedRoomName,
            boolean nightMode,
            boolean persistRoomSelection,
            boolean androidDownloadUi,
            boolean androidModConfigUi) {
        this.activity = activity;
        this.server = server;
        this.roomId = Math.max(0, roomId);
        this.roomName = roomName == null ? "" : roomName;
        this.selectedRoomId = Math.max(0, selectedRoomId);
        this.selectedRoomName = selectedRoomName == null ? "" : selectedRoomName;
        this.nightMode = nightMode;
        this.persistRoomSelection = persistRoomSelection;
        this.androidDownloadUi = androidDownloadUi;
        this.androidModConfigUi = androidModConfigUi;
    }

    @JavascriptInterface
    public String getBootstrap() {
        try {
            int bootstrapRoomId = roomId > 0 ? roomId : selectedRoomId;
            String bootstrapRoomName = roomId > 0 ? roomName : selectedRoomName;
            JSONObject entry = new JSONObject();
            entry.put("id", server.id);
            entry.put("ip", server.host);
            entry.put("port", server.port);
            entry.put("token", server.token);
            entry.put("protocol", server.protocol);
            entry.put("inEntry", false);

            JSONObject global = new JSONObject();
            global.put("theme", nightMode ? "dark" : "light");
            global.put("language", "zh");
            global.put("room", new JSONObject()
                    .put("id", bootstrapRoomId)
                    .put("gameName", bootstrapRoomName));
            global.put("gameVersion", new JSONObject().put("server", 0).put("local", 0));
            global.put("dmpVersion", new JSONObject().put("noTip", true).put("closeVersion", ""));
            global.put("entry", entry);

            JSONObject userInfo = new JSONObject();
            userInfo.put("username", "android-admin");
            userInfo.put("nickname", "Android");
            userInfo.put("role", "admin");
            userInfo.put("avatar", "1");
            userInfo.put("password", "");
            userInfo.put("disabled", false);
            userInfo.put("rooms", "");
            userInfo.put("roomCreation", true);
            userInfo.put("maxWorlds", 0);
            userInfo.put("maxPlayers", 0);

            JSONObject user = new JSONObject();
            // The 3.2 web client does not ship /rooms or /dashboard as static
            // routes.  It registers them from the authenticated user's menu in
            // the router guard, before the first navigation is allowed to
            // continue.  The Android shell intentionally bypasses the login
            // page, so there is no server menu response for Pinia to hydrate;
            // an empty array here makes the guard install only its wildcard
            // route and the initial page becomes the 404 view.  Supply the
            // same admin menu shape returned by /v3/user/menu.  This is route
            // metadata only; API credentials remain in the native bridge.
            user.put("menus", createEmbeddedAdminMenus());
            user.put("userInfo", userInfo);
            user.put("token", server.token);

            JSONObject savedServer = new JSONObject();
            savedServer.put("id", server.id);
            savedServer.put("ip", server.host);
            savedServer.put("port", server.port);
            savedServer.put("token", server.token);
            savedServer.put("remark", server.remark);
            savedServer.put("protocol", server.protocol);
            savedServer.put("selectedRoomID", bootstrapRoomId);
            savedServer.put("selectedRoomName", bootstrapRoomName);

            JSONObject bootstrap = new JSONObject();
            bootstrap.put("global", global);
            bootstrap.put("user", user);
            bootstrap.put("dmps", new JSONArray().put(savedServer));
            bootstrap.put("apiBaseUrl", server.baseUrl());
            bootstrap.put("apiToken", server.token);
            bootstrap.put("theme", nightMode ? "dark" : "light");
            // Mobile presentation switches are included in the synchronous
            // bootstrap so future WebView adapters can select the official
            // or Android layout without another round trip.
            bootstrap.put("androidDownloadUi", androidDownloadUi);
            bootstrap.put("androidModConfigUi", androidModConfigUi);
            bootstrap.put("language", "zh");
            // Only the explicit room-management entry is a room preview.
            // The platform dashboard also carries a persisted selectedRoomId,
            // but must retain its normal platform navigation/layout.
            bootstrap.put("roomPreview", roomId > 0);
            // WebStorage is cleared when a platform WebView is destroyed.
            // Restore the token-free task snapshot for this server so an
            // in-flight backend update remains visible after re-entry.
            bootstrap.put("downloadTasks", readWebDownloadTasks());
            // A deleted/cancelled mod must not be resurrected by a late
            // `/mod/download/status` poll after the WebView is recreated.
            // This is only opaque task ids, never URLs, tokens or payloads.
            bootstrap.put("downloadDismissedTaskIds", readWebDownloadDismissals(activity, server));
            return bootstrap.toString();
        } catch (JSONException exception) {
            return "{}";
        }
    }

    /**
     * Read the handset battery from Android's sticky battery broadcast.  The
     * Android WebView shipped on several target devices does not expose the
     * browser Battery Status API, so the room dashboard's compact time/battery
     * strip uses this token-free, read-only fallback.  A missing/unknown value
     * returns an empty JSON object and leaves the web UI free to use
     * navigator.getBattery() when that API is available.
     */
    @JavascriptInterface
    public String getBatteryStatus() {
        try {
            Intent battery = activity.registerReceiver(
                    null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            if (battery == null) {
                return "{}";
            }
            int level = battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
            int scale = battery.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
            int status = battery.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
            JSONObject result = new JSONObject();
            if (level >= 0 && scale > 0) {
                result.put("level", Math.max(0d, Math.min(1d,
                        (double) level / (double) scale)));
            }
            result.put("charging", status == BatteryManager.BATTERY_STATUS_CHARGING
                    || status == BatteryManager.BATTERY_STATUS_FULL);
            return result.toString();
        } catch (Exception ignored) {
            return "{}";
        }
    }

    /**
     * Builds the menu metadata consumed by the bundled 3.2 router.  Keep this
     * in sync with app/user/handler.go in the server, but do not fetch it from
     * the server during WebView bootstrap: the first route guard needs it
     * synchronously and the Android bridge may be used against an offline or
     * older deployment.
     */
    private static JSONArray createEmbeddedAdminMenus() throws JSONException {
        JSONArray menus = new JSONArray();
        menus.put(menuLink(1, "rooms", "/rooms", "rooms/index", "ri-instance-line"));
        menus.put(menuLink(2, "dashboard", "/dashboard", "dashboard/index", "ri-function-ai-line"));

        JSONArray gameLinks = new JSONArray();
        gameLinks.put(menuLink(301, "gameBase", "/game/base", "game/base", "ri-sword-line"));
        gameLinks.put(menuLink(302, "gameMod", "/game/mod", "game/mod", "ri-rocket-2-line"));
        gameLinks.put(menuLink(303, "gamePlayer", "/game/player", "game/player", "ri-ghost-line"));
        menus.put(menuGroup(3, "game", "/game", "ri-gamepad-line", gameLinks));

        JSONArray toolLinks = new JSONArray();
        toolLinks.put(menuLink(601, "toolsBackup", "/tools/backup", "tools/backup", "ri-save-2-line"));
        toolLinks.put(menuLink(602, "toolsAnnounce", "/tools/announce", "tools/announce", "ri-chat-smile-ai-3-line"));
        toolLinks.put(menuLink(603, "toolsMap", "/tools/map", "tools/map", "ri-road-map-line"));
        toolLinks.put(menuLink(604, "toolsToken", "/tools/token", "tools/token", "ri-coupon-line"));
        toolLinks.put(menuLink(605, "toolsSnapshot", "/tools/snapshot", "tools/snapshot", "ri-flip-horizontal-line"));
        toolLinks.put(menuLink(606, "toolsTmi", "/tools/tmi", "tools/tmi", "ri-ghost-4-line"));
        toolLinks.put(menuLink(607, "toolsAI", "/tools/aichat", "tools/aichat", "ri-chat-smile-ai-3-line"));
        menus.put(menuGroup(6, "tools", "/tools", "ri-wrench-line", toolLinks));

        JSONArray logLinks = new JSONArray();
        logLinks.put(menuLink(701, "logsGame", "/logs/game", "logs/game", "ri-game-line"));
        logLinks.put(menuLink(702, "logsChat", "/logs/chat", "logs/chat", "ri-chat-smile-3-line"));
        logLinks.put(menuLink(703, "logsDownload", "/logs/download", "logs/download", "ri-download-2-line"));
        logLinks.put(menuLink(704, "logsSteam", "/logs/steam", "logs/steam", "ri-steam-line"));
        logLinks.put(menuLink(705, "logsAccess", "/logs/access", "logs/access", "ri-code-box-line"));
        logLinks.put(menuLink(706, "logsRuntime", "/logs/runtime", "logs/runtime", "ri-terminal-box-line"));
        logLinks.put(menuLink(707, "logsClean", "/logs/clean", "logs/clean", "ri-file-shred-line"));
        menus.put(menuGroup(7, "logs", "/logs", "ri-blogger-line", logLinks));

        menus.put(menuLink(4, "upload", "/upload", "upload/index", "ri-contacts-book-upload-line"));
        menus.put(menuLink(5, "install", "/install", "install/index", "ri-import-line"));
        menus.put(menuLink(8, "platform", "/platform", "platform/index", "ri-vip-crown-2-line"));
        return menus;
    }

    private static JSONObject menuLink(
            int id, String title, String to, String component, String icon) throws JSONException {
        return new JSONObject()
                .put("id", id)
                .put("type", "link")
                .put("section", "")
                .put("title", title)
                .put("to", to)
                .put("component", component)
                .put("icon", icon)
                .put("links", JSONObject.NULL);
    }

    private static JSONObject menuGroup(
            int id, String title, String to, String icon, JSONArray links) throws JSONException {
        return new JSONObject()
                .put("id", id)
                .put("type", "group")
                .put("section", "")
                .put("title", title)
                .put("to", to)
                .put("component", "")
                .put("icon", icon)
                .put("links", links);
    }

    @JavascriptInterface
    public void openEntry() {
        activity.runOnUiThread(activity::finish);
    }

    /**
     * Receives a rolling token from the bundled WebView client.  DMP sends
     * this value as X-DMP-NEW-TOKEN on ordinary API responses; keep both the
     * bridge's live server object and the persisted server card current so a
     * later native request or a recreated WebView uses the new credential.
     */
    @JavascriptInterface
    public void updateToken(String token) {
        if (token == null) {
            return;
        }
        String refreshed = token.trim();
        if (refreshed.isEmpty() || refreshed.length() > 4096) {
            return;
        }
        synchronized (server) {
            if (refreshed.equals(server.token)) {
                return;
            }
            server.token = refreshed;
        }
        activity.runOnUiThread(() -> {
            DmpServerStore store = new DmpServerStore(activity);
            java.util.List<DmpServer> servers = store.load();
            boolean changed = false;
            for (DmpServer saved : servers) {
                if (saved != null && server.id.equals(saved.id)) {
                    if (!refreshed.equals(saved.token)) {
                        saved.token = refreshed;
                        changed = true;
                    }
                    break;
                }
            }
            if (changed) {
                store.save(servers);
            }
        });
    }

    /** Stores the last room selected from the platform-management entry only. */
    @JavascriptInterface
    public void syncSelectedRoom(int roomId, String roomName) {
        if (!persistRoomSelection || roomId <= 0) {
            return;
        }
        String safeName = roomName == null ? "" : roomName.trim();
        activity.runOnUiThread(() -> {
            DmpServerStore store = new DmpServerStore(activity);
            java.util.List<DmpServer> servers = store.load();
            for (DmpServer saved : servers) {
                if (saved.id.equals(server.id)) {
                    saved.selectedRoomId = roomId;
                    saved.selectedRoomName = safeName;
                    store.save(servers);
                    if (BuildConfig.DEBUG) {
                        Log.d(TAG, "persist selection server=" + server.id
                                + " room=" + roomId + " name=" + safeName);
                    }
                    break;
                }
            }
        });
    }

    /** Select a room from the Android-injected top room picker. */
    @JavascriptInterface
    public void selectRoom(int roomId, String roomName) {
        if (!persistRoomSelection || roomId <= 0) return;
        String safeName = roomName == null ? "" : roomName.trim();
        this.selectedRoomId = roomId;
        this.selectedRoomName = safeName;
        syncSelectedRoom(roomId, safeName);
    }

    @JavascriptInterface
    public void openBrowser(String url) {
        if (isWebUrl(url)) {
            activity.runOnUiThread(() -> activity.openExternal(Uri.parse(url)));
        }
    }

    /** Native clipboard fallback for the log/code copy controls in WebView. */
    @JavascriptInterface
    public boolean copyText(String value) {
        String text = value == null ? "" : value;
        if (text.isEmpty()) return false;
        try {
            ClipboardManager manager = (ClipboardManager)
                    activity.getSystemService(Context.CLIPBOARD_SERVICE);
            if (manager == null) return false;
            manager.setPrimaryClip(ClipData.newPlainText("DMP", text));
            if (!manager.hasPrimaryClip()) {
                activity.showClipboardPermissionHint();
                return false;
            }
            return true;
        } catch (RuntimeException exception) {
            if (BuildConfig.DEBUG) {
            logWarning("Unable to write Android clipboard", exception);
            }
            activity.showClipboardPermissionHint();
            return false;
        }
    }

    @JavascriptInterface
    public void downloadFile(String url, String requestedName) {
        final String resolvedUrl = resolveDmpDownloadUrl(server, url);
        if (!isWebUrl(resolvedUrl)) {
            return;
        }
        final boolean logDownload = isLogDownloadUrl(url) || isLogDownloadUrl(resolvedUrl);
        String safeName = requestedName == null
                ? "dmp-download"
                : requestedName.replaceAll("[\\\\/:*?\"<>|]", "_");
        if (safeName.trim().isEmpty()) {
            safeName = "dmp-download";
        }
        // The server returns a log export from the same endpoint for every
        // request.  Give each export a stable, sortable local name instead of
        // leaving DownloadManager's generic logs.zip entry in Download/DMP.
        if (logDownload) {
            safeName = createLogFileName();
        }
        final String requestedSafeName = safeName;
        activity.runOnUiThread(() -> {
            try {
                // The desktop download helper receives a relative /tools URL,
                // while the DMP API is mounted below /v3.  XHR requests get
                // the prefix from axios' baseURL, but the native DownloadManager
                // path bypasses axios.  Normalize it here so backup exports do
                // not hit http://host:port/tools/... and return 404.
                String normalizedUrl = normalizeDmpDownloadUrl(server, resolvedUrl);
                // Log exports are handled by a resumable worker. In
                // particular, do not let DownloadManager keep a half-read
                // response in STATUS_RUNNING forever; the worker has a read
                // timeout and retries from the bytes already written.
                if (logDownload && startNativeLogTransfer(
                        activity, server, normalizedUrl, requestedSafeName)) {
                    return;
                }
                // The DMP API builds every room's archive at the same
                // server-side temporary path (<room>/logs.zip). Two native
                // requests for one room therefore race: one response can
                // truncate or remove the file while the other is reading it.
                // Keep one export in flight for a normalized room URL.
                if (logDownload && hasActiveNativeTransfer(
                        activity, server, normalizedUrl)) {
                    return;
                }
                DownloadManager.Request request = new DownloadManager.Request(
                        Uri.parse(normalizedUrl));
                // Never send the DMP credential to an arbitrary download URL.
                // The WebView can receive a URL from server-provided data; only
                // a URL on this configured server is allowed to carry the
                // server-scoped token header.
                if (isSameServerOrigin(server, normalizedUrl)) {
                    request.addRequestHeader("X-DMP-TOKEN", server.token);
                }
                request.addRequestHeader("X-I18n-Lang", "zh");
                request.addRequestHeader("Accept-Encoding", "identity");
                // Log exports are finite ZIP files. Close the HTTP exchange
                // explicitly so a stale mobile keep-alive cannot leave the
                // DownloadManager waiting for a final chunk forever.
                request.addRequestHeader("Connection", "close");
                request.addRequestHeader("Cache-Control", "no-cache");
                request.setAllowedOverMetered(true);
                request.setAllowedOverRoaming(true);
                String relativeDirectory = logDownload ? "DMP/log" : "DMP";
                String resolvedName = uniqueDownloadName(
                        activity, requestedSafeName, relativeDirectory);
                request.setTitle(resolvedName);
                request.setDescription(logDownload ? "DMP 日志导出" : "DMP 文件下载");
                request.setMimeType(logDownload ? "application/zip" : "application/octet-stream");
                request.setNotificationVisibility(
                        DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                // Keep all DMP exports in one predictable folder.  The nested
                // path is accepted by DownloadManager on Android 10+ and does
                // not require broad storage permissions.
                request.setDestinationInExternalPublicDir(
                        Environment.DIRECTORY_DOWNLOADS,
                        relativeDirectory + "/" + resolvedName);
                if (logDownload) {
                    getLogDownloadDirectory();
                }
                DownloadManager manager =
                        (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
                long downloadId = manager.enqueue(request);
                rememberNativeTransfer(
                        downloadId, resolvedName, normalizedUrl, relativeDirectory);
            } catch (RuntimeException exception) {
                if (BuildConfig.DEBUG) {
                logWarning("Unable to enqueue DMP transfer", exception);
                }
                Toast.makeText(activity, R.string.dmp_status_failed, Toast.LENGTH_SHORT).show();
            }
        });
    }

    /**
     * Android DownloadManager does not consistently protect a caller-supplied
     * destination from collisions.  Keep the friendly backup name, but add a
     * numeric suffix before the extension when the file or a tracked transfer
     * already uses it (for example, room.zip, room(1).zip).
     */
    private static String uniqueDownloadName(Context context, String requestedName) {
        return uniqueDownloadName(context, requestedName, "DMP");
    }

    private static String uniqueDownloadName(
            Context context, String requestedName, String relativeDirectory) {
        String candidate = requestedName == null ? "dmp-download" : requestedName.trim();
        if (candidate.isEmpty()) candidate = "dmp-download";
        String base = candidate;
        String extension = "";
        int dot = candidate.lastIndexOf('.');
        if (dot > 0 && dot < candidate.length() - 1) {
            base = candidate.substring(0, dot);
            extension = candidate.substring(dot);
        }
        synchronized (NATIVE_TRANSFER_LOCK) {
            JSONArray records = readNativeTransferRecords(context);
            int suffix = 0;
            while (downloadNameTaken(context, candidate, records, relativeDirectory)) {
                suffix++;
                candidate = base + "(" + suffix + ")" + extension;
            }
            return candidate;
        }
    }

    private static boolean downloadNameTaken(
            Context context, String candidate, JSONArray records, String relativeDirectory) {
        File directory = new File(
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                relativeDirectory == null || relativeDirectory.trim().isEmpty()
                        ? "DMP" : relativeDirectory);
        if (new File(directory, candidate).exists()) return true;
        if (records == null) return false;
        for (int index = 0; index < records.length(); index++) {
            JSONObject record = records.optJSONObject(index);
            if (record == null) continue;
            String recordDirectory = record.optString("directory", "DMP").trim();
            String wantedDirectory = relativeDirectory == null
                    ? "DMP" : relativeDirectory.trim();
            if (!wantedDirectory.equals(recordDirectory)) continue;
            if (candidate.equals(record.optString("name", "").trim())) return true;
        }
        return false;
    }

    private static boolean hasActiveNativeTransfer(
            Context context, DmpServer server, String normalizedUrl) {
        if (context == null || server == null || normalizedUrl == null
                || normalizedUrl.trim().isEmpty()) {
            return false;
        }
        DownloadManager manager =
                (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) return false;
        synchronized (NATIVE_TRANSFER_LOCK) {
            JSONArray records = readNativeTransferRecords(context);
            for (int index = 0; index < records.length(); index++) {
                JSONObject record = records.optJSONObject(index);
                if (record == null) continue;
                if (!server.id.equals(record.optString("serverId", ""))) continue;
                if (!normalizedUrl.equals(record.optString("url", ""))) continue;
                long downloadId = record.optLong("downloadId", 0);
                if (isNativeHttpLogRecord(record)) {
                    String state = record.optString("status", "").toLowerCase(Locale.US);
                    if (("queued".equals(state) || "running".equals(state))
                            && ACTIVE_LOG_TRANSFERS.containsKey(downloadId)) {
                        return true;
                    }
                    // A worker which disappeared with the Activity/process is
                    // stale and must not prevent the next tap from starting a
                    // fresh export.
                    continue;
                }
                if (downloadId <= 0) continue;
                Cursor cursor = null;
                try {
                    cursor = manager.query(new DownloadManager.Query().setFilterById(downloadId));
                    if (cursor == null || !cursor.moveToFirst()) continue;
                    int status = cursor.getInt(cursor.getColumnIndexOrThrow(
                            DownloadManager.COLUMN_STATUS));
                    if (status == DownloadManager.STATUS_PENDING
                            || status == DownloadManager.STATUS_RUNNING
                            || status == DownloadManager.STATUS_PAUSED) {
                        return true;
                    }
                } catch (RuntimeException ignored) {
                    // A stale DownloadManager row is not an active transfer.
                } finally {
                    if (cursor != null) cursor.close();
                }
            }
        }
        return false;
    }

    /** Whether a transfer record belongs to the resumable HTTP log worker. */
    private static boolean isNativeHttpLogRecord(JSONObject record) {
        if (record == null) return false;
        if (record.optBoolean("nativeHttp", false)) return true;
        return record.optLong("downloadId", 0) < 0
                && "DMP/log".equals(record.optString("directory", "DMP").trim());
    }

    /** Start one resumable log export, returning true once it is accepted. */
    private static boolean startNativeLogTransfer(
            Context context, DmpServer server, String normalizedUrl, String requestedName) {
        return startNativeLogTransfer(context, server, normalizedUrl, requestedName, "");
    }

    /**
     * Start a log export.  A retry may provide the old private partial-file
     * path so the next HTTP request can use a Range header and continue from
     * the last durable byte.  The path comes only from our own preferences;
     * it is never accepted from JavaScript.
     */
    private static boolean startNativeLogTransfer(
            Context context, DmpServer server, String normalizedUrl, String requestedName,
            String resumePath) {
        if (context == null || server == null || !isWebUrlValue(normalizedUrl)) {
            return false;
        }
        final Context appContext = context.getApplicationContext() == null
                ? context : context.getApplicationContext();
        synchronized (NATIVE_TRANSFER_LOCK) {
            JSONArray records = readNativeTransferRecords(appContext);
            for (int index = 0; index < records.length(); index++) {
                JSONObject record = records.optJSONObject(index);
                if (record == null || !isNativeHttpLogRecord(record)) continue;
                if (!server.id.equals(record.optString("serverId", ""))
                        || !normalizedUrl.equals(record.optString("url", ""))) {
                    continue;
                }
                String state = record.optString("status", "").toLowerCase(Locale.US);
                long existingId = record.optLong("downloadId", 0);
                if (("queued".equals(state) || "running".equals(state))
                        && ACTIVE_LOG_TRANSFERS.containsKey(existingId)) {
                    // The DMP endpoint creates one fixed temporary archive per
                    // room; keeping one request in flight prevents the server
                    // from deleting the archive underneath a second request.
                    return true;
                }
            }

            String safeName = requestedName == null ? createLogFileName() : requestedName.trim();
            if (safeName.isEmpty()) safeName = createLogFileName();
            safeName = uniqueDownloadName(appContext, safeName, "DMP/log");
            final String transferName = safeName;
            long transferId = nextLogTransferId();
            File tempFile = resumePath == null || resumePath.trim().isEmpty()
                    ? nativeLogTempFile(appContext, transferId)
                    : new File(resumePath);
            File parent = tempFile.getParentFile();
            if (parent != null && !parent.exists() && !parent.mkdirs() && !parent.isDirectory()) {
                return false;
            }
            try {
                JSONObject record = new JSONObject();
                record.put("downloadId", transferId);
                record.put("name", safeName);
                record.put("url", normalizedUrl);
                record.put("directory", "DMP/log");
                record.put("serverId", server.id);
                record.put("host", server.host);
                record.put("port", server.port);
                record.put("createdAt", System.currentTimeMillis());
                record.put("updatedAt", System.currentTimeMillis());
                record.put("status", "queued");
                record.put("stage", "queued");
                record.put("completedBytes", tempFile.isFile() ? tempFile.length() : 0L);
                record.put("totalBytes", 0L);
                record.put("progress", 0d);
                record.put("progressKnown", false);
                record.put("nativeHttp", true);
                record.put("tempPath", tempFile.getAbsolutePath());
                records.put(record);
                writeNativeTransferRecords(appContext, boundedNativeTransferRecords(records));
            } catch (JSONException exception) {
                logWarning("Unable to store resumable DMP log metadata", exception);
                return false;
            }
            Future<?> future = LOG_TRANSFER_EXECUTOR.submit(() -> runNativeLogTransfer(
                    appContext, server, transferId, transferName, normalizedUrl, tempFile));
            ACTIVE_LOG_TRANSFERS.put(transferId, future);
            return true;
        }
    }

    private static long nextLogTransferId() {
        long value = NEXT_LOG_TRANSFER_ID.getAndDecrement();
        if (value >= 0) {
            value = -Math.max(1L, value);
        }
        return value;
    }

    private static File nativeLogTempFile(Context context, long transferId) {
        File root = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (root == null) root = context.getFilesDir();
        File directory = new File(root, "dmp-log-transfer");
        if (!directory.exists()) {
            //noinspection ResultOfMethodCallIgnored
            directory.mkdirs();
        }
        return new File(directory, "transfer-" + Math.abs(transferId) + ".part");
    }

    private static JSONArray boundedNativeTransferRecords(JSONArray records) {
        int first = Math.max(0, records.length() - 80);
        JSONArray bounded = new JSONArray();
        for (int index = first; index < records.length(); index++) {
            bounded.put(records.opt(index));
        }
        return bounded;
    }

    /** Execute a log download with inactivity timeout, retries and Range resume. */
    private static void runNativeLogTransfer(
            Context context, DmpServer server, long transferId, String name, String url,
            File tempFile) {
        updateNativeLogTransfer(context, transferId, "running", "transferring",
                tempFile.isFile() ? tempFile.length() : 0L, 0L, "", false);
        String lastError = "日志下载失败";
        try {
            for (int attempt = 0; attempt <= LOG_TRANSFER_MAX_RETRIES; attempt++) {
                if (Thread.currentThread().isInterrupted()) return;
                HttpURLConnection connection = null;
                try {
                    long existing = tempFile.isFile() ? Math.max(0L, tempFile.length()) : 0L;
                    URL endpoint = new URL(url);
                    connection = (HttpURLConnection) endpoint.openConnection();
                    connection.setRequestMethod("GET");
                    connection.setConnectTimeout(LOG_TRANSFER_CONNECT_TIMEOUT_MS);
                    connection.setReadTimeout(LOG_TRANSFER_READ_TIMEOUT_MS);
                    connection.setInstanceFollowRedirects(false);
                    connection.setUseCaches(false);
                    connection.setRequestProperty("Accept-Encoding", "identity");
                    connection.setRequestProperty("Connection", "close");
                    connection.setRequestProperty("Cache-Control", "no-cache");
                    connection.setRequestProperty("X-I18n-Lang", "zh");
                    if (isSameServerOrigin(server, url)
                            && server.token != null && !server.token.trim().isEmpty()) {
                        connection.setRequestProperty("X-DMP-TOKEN", server.token);
                    }
                    if (existing > 0L) {
                        connection.setRequestProperty("Range", "bytes=" + existing + "-");
                    }
                    int responseCode = connection.getResponseCode();
                    if (responseCode >= 300 && responseCode < 400) {
                        String location = connection.getHeaderField("Location");
                        if (location != null && !location.trim().isEmpty()
                                && attempt < LOG_TRANSFER_MAX_RETRIES) {
                            // The DMP route normally does not redirect.  A
                            // redirect is retried only when the next request
                            // remains a valid web URL; token scoping below will
                            // prevent credentials from leaving the configured
                            // server origin.
                            url = new URL(endpoint, location).toString();
                            continue;
                        }
                    }
                    if (responseCode == 416
                            && existing > 0L) {
                        // The server generated a new archive or its old
                        // temporary file was removed. Start that attempt over.
                        //noinspection ResultOfMethodCallIgnored
                        tempFile.delete();
                        continue;
                    }
                    if (responseCode == HttpURLConnection.HTTP_OK && existing > 0L) {
                        // The endpoint does not support Range. Do not append a
                        // second full ZIP to the partial one.
                        //noinspection ResultOfMethodCallIgnored
                        tempFile.delete();
                        continue;
                    }
                    if (responseCode < 200 || responseCode >= 300) {
                        throw new IOException("HTTP " + responseCode);
                    }
                    long bodyLength = connection.getContentLengthLong();
                    long total = bodyLength > 0L
                            ? (responseCode == HttpURLConnection.HTTP_PARTIAL
                            ? existing + bodyLength : bodyLength) : 0L;
                    String contentRange = connection.getHeaderField("Content-Range");
                    if (contentRange != null) {
                        int slash = contentRange.lastIndexOf('/');
                        if (slash >= 0) {
                            try {
                                long rangeTotal = Long.parseLong(
                                        contentRange.substring(slash + 1).trim());
                                if (rangeTotal > 0L) total = rangeTotal;
                            } catch (NumberFormatException ignored) {
                                // Keep the content-length-derived total.
                            }
                        }
                    }
                    long completed = responseCode == HttpURLConnection.HTTP_PARTIAL
                            ? existing : 0L;
                    updateNativeLogTransfer(context, transferId, "running", "transferring",
                            completed, total, "", false);
                    try (InputStream input = connection.getInputStream();
                         OutputStream output = new FileOutputStream(
                                 tempFile, responseCode == HttpURLConnection.HTTP_PARTIAL
                                         && existing > 0L)) {
                        byte[] buffer = new byte[LOG_TRANSFER_BUFFER_SIZE];
                        long lastUpdate = System.currentTimeMillis();
                        int count;
                        while ((count = input.read(buffer)) != -1) {
                            if (Thread.currentThread().isInterrupted()) return;
                            if (count == 0) continue;
                            output.write(buffer, 0, count);
                            completed += count;
                            long now = System.currentTimeMillis();
                            if (now - lastUpdate >= 250L) {
                                updateNativeLogTransfer(context, transferId, "running",
                                        "transferring", completed, total, "", false);
                                lastUpdate = now;
                            }
                        }
                        output.flush();
                    }
                    if (total > 0L && completed < total) {
                        throw new IOException("服务器提前结束响应");
                    }
                    if (total > 0L && completed > total) {
                        throw new IOException("响应长度异常");
                    }
                    // The API returns a ZIP archive but some reverse proxies
                    // close a response without advertising Content-Length.
                    // In that case byte-count checks alone can accept a
                    // truncated archive and publish it as if it were done.
                    // Validate the central directory before touching the
                    // public Download/DMP/log directory.
                    validateLogZip(tempFile);
                    publishNativeLogFile(context, tempFile, name);
                    updateNativeLogTransfer(context, transferId, "success", "completed",
                            completed, total > 0L ? total : completed, "", true);
                    return;
                } catch (IOException exception) {
                    lastError = exception instanceof SocketTimeoutException
                            ? "日志下载读取超时，正在重试"
                            : exception.getMessage() == null
                            ? "日志下载失败" : exception.getMessage();
                    if (attempt >= LOG_TRANSFER_MAX_RETRIES) break;
                    // A failed ZIP validation means the current prefix is not
                    // a safe resume point: the server creates/deletes a
                    // per-room temporary archive for each request.  Restart
                    // from an empty private file so a new archive can never
                    // be appended to a stale or truncated one.
                    if (lastError.startsWith("日志压缩包校验失败")) {
                        //noinspection ResultOfMethodCallIgnored
                        tempFile.delete();
                    }
                    updateNativeLogTransfer(context, transferId, "queued", "transferring",
                            tempFile.isFile() ? tempFile.length() : 0L, 0L,
                            lastError, false);
                    try {
                        Thread.sleep(Math.min(8_000L, 1_000L << attempt));
                    } catch (InterruptedException interrupted) {
                        Thread.currentThread().interrupt();
                        return;
                    }
                } finally {
                    if (connection != null) connection.disconnect();
                }
            }
            updateNativeLogTransfer(context, transferId, "error", "failed",
                    tempFile.isFile() ? tempFile.length() : 0L, 0L, lastError, true);
        } finally {
            ACTIVE_LOG_TRANSFERS.remove(transferId);
        }
    }

    /** Verify the DMP log response is a readable ZIP before publishing it. */
    private static void validateLogZip(File file) throws IOException {
        if (file == null || !file.isFile() || file.length() < 22L) {
            throw new IOException("日志压缩包校验失败：文件不完整");
        }
        try (ZipFile ignored = new ZipFile(file)) {
            if (ignored.size() <= 0) {
                throw new IOException("日志压缩包校验失败：压缩包为空");
            }
        } catch (IOException exception) {
            throw new IOException("日志压缩包校验失败：中央目录不完整", exception);
        }
    }

    /** Publish the completed private file into the shared Download folder. */
    private static void publishNativeLogFile(Context context, File source, String name)
            throws IOException {
        if (!source.isFile()) throw new IOException("日志临时文件不存在");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, name);
            // Keep the user-facing yyMMdd-HHmmsslog.txt name.  MediaProvider
            // appends the MIME's conventional ".zip" suffix when the MIME
            // is application/zip, which turns the requested .txt name into
            // an unrecognised .txt.zip entry.  The payload is still the ZIP
            // generated by DMP; the selector/share path already treats these
            // exports as opaque log files.
            values.put(MediaStore.Downloads.MIME_TYPE, "text/plain");
            values.put(MediaStore.Downloads.RELATIVE_PATH,
                    Environment.DIRECTORY_DOWNLOADS + "/DMP/log/");
            values.put(MediaStore.Downloads.IS_PENDING, 1);
            Uri uri = context.getContentResolver().insert(
                    MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new IOException("无法创建日志下载文件");
            boolean committed = false;
            try (InputStream input = new FileInputStream(source);
                 OutputStream output = context.getContentResolver().openOutputStream(uri, "w")) {
                if (output == null) throw new IOException("无法写入日志下载文件");
                byte[] buffer = new byte[LOG_TRANSFER_BUFFER_SIZE];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (count > 0) output.write(buffer, 0, count);
                }
                output.flush();
                ContentValues ready = new ContentValues();
                ready.put(MediaStore.Downloads.IS_PENDING, 0);
                context.getContentResolver().update(uri, ready, null, null);
                committed = true;
            } finally {
                if (!committed) {
                    try {
                        context.getContentResolver().delete(uri, null, null);
                    } catch (RuntimeException ignored) {
                        // Best effort cleanup of a pending MediaStore row.
                    }
                }
            }
        } else {
            File target = new File(getLogDownloadDirectory(), name);
            if (!source.renameTo(target)) {
                try (InputStream input = new FileInputStream(source);
                     OutputStream output = new FileOutputStream(target)) {
                    byte[] buffer = new byte[LOG_TRANSFER_BUFFER_SIZE];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        if (count > 0) output.write(buffer, 0, count);
                    }
                    output.flush();
                }
                //noinspection ResultOfMethodCallIgnored
                source.delete();
            }
        }
        //noinspection ResultOfMethodCallIgnored
        source.delete();
    }

    private static void updateNativeLogTransfer(
            Context context, long transferId, String status, String stage,
            long completed, long total, String message, boolean finished) {
        synchronized (NATIVE_TRANSFER_LOCK) {
            JSONArray records = readNativeTransferRecords(context);
            for (int index = 0; index < records.length(); index++) {
                JSONObject record = records.optJSONObject(index);
                if (record == null || record.optLong("downloadId", 0) != transferId) continue;
                try {
                    long safeCompleted = Math.max(0L, completed);
                    long safeTotal = Math.max(0L, total);
                    double progress = safeTotal > 0L
                            ? Math.max(0d, Math.min(100d,
                            safeCompleted * 100d / (double) safeTotal))
                            : ("success".equals(status) ? 100d : 0d);
                    record.put("status", status);
                    record.put("stage", stage);
                    record.put("completedBytes", safeCompleted);
                    record.put("totalBytes", safeTotal);
                    record.put("progress", progress);
                    record.put("progressKnown", safeTotal > 0L);
                    record.put("updatedAt", System.currentTimeMillis());
                    if (message == null || message.trim().isEmpty()) {
                        record.remove("message");
                    } else {
                        record.put("message", message);
                    }
                    if (finished) record.put("finishedAt", System.currentTimeMillis());
                    writeNativeTransferRecords(context, records);
                } catch (JSONException exception) {
                    logWarning("Unable to update DMP log transfer metadata", exception);
                }
                return;
            }
        }
    }

    private static String createLogFileName() {
        return new SimpleDateFormat("yyMMdd-HHmmss'log.txt'", Locale.US)
                .format(new java.util.Date());
    }

    private static boolean isLogDownloadUrl(String url) {
        if (url == null) return false;
        try {
            String path = Uri.parse(url).getPath();
            return path != null && path.matches("(?i).*/logs/download/?");
        } catch (RuntimeException ignored) {
            return url.matches("(?i).*/logs/download(?:[/?].*)?");
        }
    }

    /**
     * Returns a small, token-free snapshot of DownloadManager transfers that
     * were started by this bridge.  The WebView merges these records into its
     * normal download center and labels them as transfers, so a backup export
     * is visible while bytes are moving instead of silently opening a blob.
     */
    @JavascriptInterface
    public String getNativeTransferTasks() {
        return queryNativeTransfers(activity, server).toString();
    }

    /**
     * Lists the real files currently present in Download/DMP/log.  The
     * browser cannot reliably infer this from DownloadManager rows: Android
     * keeps a completed row after a user deletes the file in a file manager.
     * Scanning the directory on every call therefore keeps the selector in
     * sync across all platform WebViews.
     */
    @JavascriptInterface
    public String getDownloadedLogFiles() {
        return scanDownloadedLogFiles(activity).toString();
    }

    private static JSONArray scanDownloadedLogFiles(Context context) {
        JSONArray result = new JSONArray();
        if (context == null) return result;
        Map<String, Long> transferIds = new HashMap<>();
        JSONArray records = readNativeTransferRecords(context);
        for (int index = 0; index < records.length(); index++) {
            JSONObject record = records.optJSONObject(index);
            if (record == null) continue;
            String directoryName = record.optString("directory", "DMP").trim();
            String name = record.optString("name", "").trim();
            if ("DMP/log".equals(directoryName) && !name.isEmpty()) {
                transferIds.put(name, record.optLong("downloadId", 0));
            }
        }
        // Android 10+ may make the public Download directory invisible to
        // java.io.File.listFiles() under scoped storage even though the app's
        // own DownloadManager export is present.  Query MediaStore first so
        // the selector sees files created by DownloadManager and by other DMP
        // platform instances; retain a direct-file fallback for older builds.
        Map<String, JSONObject> found = new HashMap<>();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            Cursor cursor = null;
            try {
                String[] projection = {
                        MediaStore.Downloads._ID,
                        MediaStore.Downloads.DISPLAY_NAME,
                        MediaStore.Downloads.SIZE,
                        MediaStore.Downloads.DATE_MODIFIED,
                        MediaStore.Downloads.RELATIVE_PATH
                };
                String relativePath = Environment.DIRECTORY_DOWNLOADS + "/DMP/log/";
                cursor = context.getContentResolver().query(
                        MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                        projection,
                        MediaStore.Downloads.RELATIVE_PATH + "=?",
                        new String[]{relativePath},
                        MediaStore.Downloads.DATE_MODIFIED + " DESC");
                if (cursor != null) {
                    int nameColumn = cursor.getColumnIndex(MediaStore.Downloads.DISPLAY_NAME);
                    int idColumn = cursor.getColumnIndex(MediaStore.Downloads._ID);
                    int sizeColumn = cursor.getColumnIndex(MediaStore.Downloads.SIZE);
                    int modifiedColumn = cursor.getColumnIndex(MediaStore.Downloads.DATE_MODIFIED);
                    while (cursor.moveToNext()) {
                        if (nameColumn < 0) continue;
                        String name = cursor.getString(nameColumn);
                        if (!isLogFileName(name)) continue;
                        // A file manager can delete the physical file while
                        // Android keeps its DownloadManager/MediaStore row.
                        // Probe the row's content URI so a stale entry does
                        // not remain in the shared selector list.
                        if (idColumn >= 0) {
                            long mediaId = cursor.getLong(idColumn);
                            Uri mediaUri = ContentUris.withAppendedId(
                                    MediaStore.Downloads.EXTERNAL_CONTENT_URI, mediaId);
                            try (android.os.ParcelFileDescriptor descriptor =
                                         context.getContentResolver().openFileDescriptor(
                                                 mediaUri, "r")) {
                                if (descriptor == null) continue;
                            } catch (RuntimeException ignored) {
                                continue;
                            } catch (java.io.IOException ignored) {
                                continue;
                            }
                        }
                        long size = sizeColumn >= 0 ? Math.max(0, cursor.getLong(sizeColumn)) : 0;
                        long modified = modifiedColumn >= 0
                                ? Math.max(0, cursor.getLong(modifiedColumn) * 1000L) : 0;
                        long downloadId = transferIds.containsKey(name)
                                ? transferIds.get(name) : 0;
                        JSONObject item = logFileItem(name, size, modified, downloadId);
                        found.put(name, item);
                    }
                }
            } catch (RuntimeException ignored) {
                // Fall through to the direct filesystem view below.
            } finally {
                if (cursor != null) cursor.close();
            }
        }
        File directory = getLogDownloadDirectory();
        File[] files = directory.listFiles();
        if (files != null) {
            for (File file : files) {
                if (file == null || !file.isFile() || !isLogFileName(file.getName())) continue;
                String name = file.getName();
                if (found.containsKey(name)) continue;
                long downloadId = transferIds.containsKey(name)
                        ? transferIds.get(name) : 0;
                found.put(name, logFileItem(name, file.length(), file.lastModified(), downloadId));
            }
        }
        ArrayList<JSONObject> sorted = new ArrayList<>(found.values());
        sorted.sort((left, right) -> {
            long leftTime = left.optLong("modifiedAt", 0);
            long rightTime = right.optLong("modifiedAt", 0);
            int modified = Long.compare(rightTime, leftTime);
            if (modified != 0) return modified;
            return left.optString("name", "").compareToIgnoreCase(right.optString("name", ""));
        });
        for (JSONObject item : sorted) result.put(item);
        return result;
    }

    private static JSONObject logFileItem(
            String name, long size, long modifiedAt, long downloadId) {
        JSONObject item = new JSONObject();
        try {
            item.put("id", downloadId > 0
                    ? "native-transfer-" + downloadId : "log-file-" + name);
            item.put("name", name);
            item.put("path", "Download/DMP/log/" + name);
            item.put("size", Math.max(0, size));
            item.put("modifiedAt", Math.max(0, modifiedAt));
            item.put("downloadId", downloadId);
            item.put("kind", "logs");
            item.put("status", "success");
        } catch (JSONException ignored) {
            // JSONObject#put only fails for an invalid value; all values here
            // are primitive and the partially-built object is still safe.
        }
        return item;
    }

    private static boolean isLogFileName(String name) {
        return name != null && name.matches("(?i)^\\d{6}-\\d{6}log(?:\\(\\d+\\))?\\.(?:txt|zip)$");
    }

    private static File getLogDownloadDirectory() {
        File directory = new File(
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                "DMP/log");
        if (!directory.exists()) {
            // DownloadManager creates the parent on enqueue, but creating it
            // here also makes the empty selector/cleanup action useful
            // before the first export.
            //noinspection ResultOfMethodCallIgnored
            directory.mkdirs();
        }
        return directory;
    }

    /**
     * Delete every locally downloaded log archive.
     *
     * This is deliberately scoped to Download/DMP/log and the bridge's own
     * private partial-transfer directory. It never sends a request to the DMP
     * server and never touches the ordinary Download/DMP backup directory.
     */
    @JavascriptInterface
    public boolean clearDownloadedLogs() {
        boolean success = true;
        DownloadManager manager =
                (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
        synchronized (NATIVE_TRANSFER_LOCK) {
            JSONArray records = readNativeTransferRecords(activity);
            JSONArray kept = new JSONArray();
            for (int index = 0; index < records.length(); index++) {
                JSONObject record = records.optJSONObject(index);
                if (record == null) continue;
                String directory = record.optString("directory", "DMP").trim();
                if (!"DMP/log".equals(directory)) {
                    kept.put(record);
                    continue;
                }
                long transferId = record.optLong("downloadId", 0L);
                try {
                    if (isNativeHttpLogRecord(record) || transferId < 0L) {
                        cancelNativeLogTransfer(transferId, record, true);
                    } else if (manager != null && transferId > 0L) {
                        // Removing a DownloadManager row also removes its
                        // public file. The MediaStore/direct-file pass below
                        // is retained for rows created by older APKs.
                        manager.remove(transferId);
                    }
                } catch (RuntimeException exception) {
                    success = false;
                    logWarning("Unable to remove DMP log transfer " + transferId, exception);
                }
            }
            writeNativeTransferRecords(activity, kept);
        }
        if (!clearMediaStoreLogFiles(activity)) success = false;
        if (!clearDirectLogFiles()) success = false;
        if (!clearNativeLogTempFiles(activity)) success = false;
        return success;
    }

    /** Compatibility alias for older bundled pages; it now performs cleanup. */
    @JavascriptInterface
    @Deprecated
    public boolean openDownloadDirectory() {
        return clearDownloadedLogs();
    }

    private static boolean clearMediaStoreLogFiles(Context context) {
        if (context == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true;
        ArrayList<Uri> files = new ArrayList<>();
        Cursor cursor = null;
        try {
            String[] projection = {MediaStore.Downloads._ID};
            String relativePath = Environment.DIRECTORY_DOWNLOADS + "/DMP/log/";
            cursor = context.getContentResolver().query(
                    MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                    projection,
                    MediaStore.Downloads.RELATIVE_PATH + "=?",
                    new String[]{relativePath},
                    null);
            if (cursor != null) {
                int idColumn = cursor.getColumnIndex(MediaStore.Downloads._ID);
                while (idColumn >= 0 && cursor.moveToNext()) {
                    files.add(ContentUris.withAppendedId(
                            MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                            cursor.getLong(idColumn)));
                }
            }
        } catch (RuntimeException exception) {
            logWarning("Unable to enumerate DMP log MediaStore rows", exception);
            return false;
        } finally {
            if (cursor != null) cursor.close();
        }
        boolean success = true;
        for (Uri uri : files) {
            try {
                context.getContentResolver().delete(uri, null, null);
            } catch (RuntimeException exception) {
                success = false;
                logWarning("Unable to delete DMP log MediaStore row", exception);
            }
        }
        return success;
    }

    private static boolean clearDirectLogFiles() {
        File directory = getLogDownloadDirectory();
        File[] files = directory.listFiles();
        if (files == null) return true;
        boolean success = true;
        for (File file : files) {
            if (file == null || !file.isFile()) continue;
            if (!file.delete() && file.exists()) success = false;
        }
        return success;
    }

    private static boolean clearNativeLogTempFiles(Context context) {
        if (context == null) return true;
        File root = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (root == null) root = context.getFilesDir();
        File directory = new File(root, "dmp-log-transfer");
        File[] files = directory.listFiles();
        if (files == null) return true;
        boolean success = true;
        for (File file : files) {
            if (file == null || !file.isFile()) continue;
            if (!file.delete() && file.exists()) success = false;
        }
        return success;
    }

    private static JSONObject nativeHttpLogSnapshot(
            Context context, DmpServer server, JSONObject record) throws JSONException {
        long downloadId = record.optLong("downloadId", 0);
        String state = record.optString("status", "queued").toLowerCase(Locale.US);
        long createdAt = record.optLong("createdAt", 0L);
        if (("queued".equals(state) || "running".equals(state))
                && !ACTIVE_LOG_TRANSFERS.containsKey(downloadId)
                && (createdAt <= 0L || System.currentTimeMillis() - createdAt > 15_000L)) {
            state = "error";
        }
        long completed = Math.max(0L, record.optLong("completedBytes", 0L));
        long total = Math.max(0L, record.optLong("totalBytes", 0L));
        double progress = total > 0L
                ? Math.max(0d, Math.min(100d, completed * 100d / (double) total))
                : ("success".equals(state) ? 100d : record.optDouble("progress", 0d));
        String id = "native-transfer-" + downloadId;
        JSONObject item = new JSONObject();
        item.put("id", id);
        item.put("taskID", id);
        item.put("type", "transfer");
        item.put("name", record.optString("name", "dmp-download"));
        item.put("directory", record.optString("directory", "DMP/log"));
        item.put("downloadId", downloadId);
        item.put("url", record.optString("url", ""));
        item.put("kind", "logs");
        item.put("status", state);
        item.put("stage", transferStage(state));
        item.put("progress", progress);
        item.put("completedBytes", completed);
        item.put("totalBytes", total);
        item.put("progressKnown", total > 0L);
        String owner = record.optString("serverId", "").trim();
        item.put("serverId", owner.isEmpty() ? server.id : owner);
        item.put("serverHost", record.optString("host", server.host));
        item.put("createdAt", createdAt);
        item.put("updatedAt", record.optLong("updatedAt", System.currentTimeMillis()));
        item.put("readOnly", false);
        item.put("serverTask", false);
        item.put("canDelete", true);
        item.put("canRetry", "error".equals(state));
        if ("success".equals(state) || "error".equals(state)) {
            item.put("finishedAt", record.optLong("finishedAt", System.currentTimeMillis()));
        }
        String message = record.optString("message", "").trim();
        if ("error".equals(state) && message.isEmpty()) {
            message = "日志下载在应用关闭或网络停滞后中断";
        }
        if (!message.isEmpty()) item.put("message", message);
        return item;
    }

    /** Token-free native transfer snapshot shared by the all-platform task UI. */
    static JSONArray queryNativeTransfers(Context context, DmpServer server) {
        JSONArray result = new JSONArray();
        if (context == null || server == null) return result;
        DownloadManager manager =
                (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        JSONArray records = readNativeTransferRecords(context);
        for (int index = 0; index < records.length(); index++) {
            JSONObject record = records.optJSONObject(index);
            if (record == null) continue;
            String owner = record.optString("serverId", "").trim();
            if (!owner.isEmpty() && !owner.equals(server.id)) continue;
            long downloadId = record.optLong("downloadId", 0);
            if (isNativeHttpLogRecord(record) && downloadId < 0) {
                try {
                    result.put(nativeHttpLogSnapshot(context, server, record));
                } catch (JSONException exception) {
                    logWarning("Unable to query resumable DMP log transfer " + downloadId,
                            exception);
                }
                continue;
            }
            if (manager == null) continue;
            if (downloadId <= 0) continue;
            Cursor cursor = null;
            try {
                cursor = manager.query(new DownloadManager.Query().setFilterById(downloadId));
                if (cursor == null || !cursor.moveToFirst()) continue;
                int status = cursor.getInt(cursor.getColumnIndexOrThrow(
                        DownloadManager.COLUMN_STATUS));
                long completed = cursor.getLong(cursor.getColumnIndexOrThrow(
                        DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                long total = cursor.getLong(cursor.getColumnIndexOrThrow(
                        DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                String state = transferStatus(status);
                double progress = total > 0
                        ? Math.max(0d, Math.min(100d, completed * 100d / (double) total))
                        : (DownloadManager.STATUS_SUCCESSFUL == status ? 100d : 0d);
                JSONObject item = new JSONObject();
                String id = "native-transfer-" + downloadId;
                item.put("id", id);
                item.put("taskID", id);
                item.put("type", "transfer");
                item.put("name", record.optString("name", "dmp-download"));
                item.put("directory", record.optString("directory", "DMP"));
                // Keep the source URL and native id in the token-free
                // snapshot.  The log-download page uses these two fields to
                // distinguish exported log archives from backup transfers
                // and to hand a completed archive to Android's share sheet.
                item.put("downloadId", downloadId);
                item.put("url", record.optString("url", ""));
                String transferUrl = record.optString("url", "").toLowerCase(Locale.ROOT);
                item.put("kind", transferUrl.contains("/logs/") ? "logs" : "file");
                item.put("status", state);
                item.put("stage", transferStage(state));
                item.put("progress", progress);
                item.put("completedBytes", Math.max(0, completed));
                item.put("totalBytes", Math.max(0, total));
                item.put("progressKnown", total > 0);
                item.put("serverId", owner.isEmpty() ? server.id : owner);
                item.put("serverHost", record.optString("host", server.host));
                item.put("createdAt", record.optLong("createdAt", 0));
                item.put("updatedAt", System.currentTimeMillis());
                item.put("readOnly", false);
                item.put("serverTask", false);
                item.put("canDelete", true);
                item.put("canRetry", "error".equals(state));
                if ("success".equals(state) || "error".equals(state)) {
                    item.put("finishedAt", record.optLong("finishedAt", System.currentTimeMillis()));
                }
                if ("error".equals(state)) {
                    int reason = cursor.getInt(cursor.getColumnIndexOrThrow(
                            DownloadManager.COLUMN_REASON));
                    item.put("message", "传输失败（错误码 " + reason + "）");
                }
                result.put(item);
            } catch (RuntimeException | JSONException exception) {
                if (BuildConfig.DEBUG) {
                    logWarning("Unable to query DMP transfer " + downloadId, exception);
                }
            } finally {
                if (cursor != null) cursor.close();
            }
        }
        return result;
    }

    /**
     * Share a completed DownloadManager transfer through the Android system
     * chooser.  The returned content URI is granted by DownloadManager, so no
     * broad storage permission or FileProvider path is required.  The caller
     * passes only the opaque native-transfer-&lt;id&gt; value shown in the web UI.
     */
    @JavascriptInterface
    public boolean shareNativeTransfer(String taskId) {
        if (taskId == null || !taskId.startsWith("native-transfer-")) {
            return false;
        }
        final long downloadId;
        try {
            downloadId = Long.parseLong(taskId.substring("native-transfer-".length()));
        } catch (NumberFormatException ignored) {
            return false;
        }
        DownloadManager manager =
                (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) return false;
        Cursor cursor = null;
        try {
            cursor = manager.query(new DownloadManager.Query().setFilterById(downloadId));
            if (cursor == null || !cursor.moveToFirst()) return false;
            int status = cursor.getInt(cursor.getColumnIndexOrThrow(
                    DownloadManager.COLUMN_STATUS));
            if (status != DownloadManager.STATUS_SUCCESSFUL) return false;
            Uri contentUri = manager.getUriForDownloadedFile(downloadId);
            if (contentUri == null) return false;
            String name = "DMP日志";
            JSONArray records = readNativeTransferRecords(activity);
            for (int index = 0; index < records.length(); index++) {
                JSONObject record = records.optJSONObject(index);
                if (record != null && record.optLong("downloadId", 0) == downloadId) {
                    String candidate = record.optString("name", "").trim();
                    if (!candidate.isEmpty()) name = candidate;
                    break;
                }
            }
            final Uri shareUri = contentUri;
            final String shareName = name;
            activity.runOnUiThread(() -> {
                try {
                    Intent send = new Intent(Intent.ACTION_SEND);
                    send.setType("application/zip");
                    send.putExtra(Intent.EXTRA_STREAM, shareUri);
                    send.putExtra(Intent.EXTRA_SUBJECT, shareName);
                    send.setClipData(ClipData.newRawUri(shareName, shareUri));
                    send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    Intent chooser = Intent.createChooser(send, "分享日志");
                    chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    activity.startActivity(chooser);
                } catch (RuntimeException exception) {
                    if (BuildConfig.DEBUG) {
                        logWarning("Unable to open the Android share sheet", exception);
                    }
                }
            });
            return true;
        } catch (RuntimeException exception) {
            if (BuildConfig.DEBUG) {
                logWarning("Unable to share DMP transfer " + downloadId, exception);
            }
            return false;
        } finally {
            if (cursor != null) cursor.close();
        }
    }

    /** Shares a log selected from the real Download/DMP/log directory scan. */
    @JavascriptInterface
    public boolean shareDownloadedLog(String requestedName) {
        if (requestedName == null) return false;
        String name = new File(requestedName).getName();
        if (!name.equals(requestedName) || !isLogFileName(name)) return false;
        File file = new File(getLogDownloadDirectory(), name);
        if (!file.isFile()) return false;
        Uri contentUri = null;
        DownloadManager manager =
                (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager != null) {
            JSONArray records = readNativeTransferRecords(activity);
            for (int index = 0; index < records.length(); index++) {
                JSONObject record = records.optJSONObject(index);
                if (record == null || !name.equals(record.optString("name", "").trim())) {
                    continue;
                }
                if (!"DMP/log".equals(record.optString("directory", "DMP").trim())) {
                    continue;
                }
                long id = record.optLong("downloadId", 0);
                Cursor cursor = null;
                try {
                    cursor = manager.query(new DownloadManager.Query().setFilterById(id));
                    if (cursor != null && cursor.moveToFirst()
                            && cursor.getInt(cursor.getColumnIndexOrThrow(
                            DownloadManager.COLUMN_STATUS))
                            == DownloadManager.STATUS_SUCCESSFUL) {
                        contentUri = manager.getUriForDownloadedFile(id);
                    }
                } catch (RuntimeException ignored) {
                    // Fall through to MediaStore below.
                } finally {
                    if (cursor != null) cursor.close();
                }
                if (contentUri != null) break;
            }
        }
        if (contentUri == null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            Cursor cursor = null;
            try {
                String[] projection = {MediaStore.Downloads._ID};
                String relativePath = Environment.DIRECTORY_DOWNLOADS + "/DMP/log/";
                cursor = activity.getContentResolver().query(
                        MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                        projection,
                        MediaStore.Downloads.DISPLAY_NAME + "=? AND "
                                + MediaStore.Downloads.RELATIVE_PATH + "=?",
                        new String[]{name, relativePath},
                        null);
                if (cursor != null && cursor.moveToFirst()) {
                    long id = cursor.getLong(cursor.getColumnIndexOrThrow(
                            MediaStore.Downloads._ID));
                    contentUri = ContentUris.withAppendedId(
                            MediaStore.Downloads.EXTERNAL_CONTENT_URI, id);
                }
            } catch (RuntimeException ignored) {
                // A third-party file manager may not expose its row; return a
                // normal "not available" result instead of crashing WebView.
            } finally {
                if (cursor != null) cursor.close();
            }
        }
        if (contentUri == null) return false;
        final Uri shareUri = contentUri;
        activity.runOnUiThread(() -> {
            try {
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType("text/plain");
                send.putExtra(Intent.EXTRA_STREAM, shareUri);
                send.putExtra(Intent.EXTRA_SUBJECT, name);
                send.setClipData(ClipData.newRawUri(name, shareUri));
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                Intent chooser = Intent.createChooser(send, "分享日志");
                chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                activity.startActivity(chooser);
            } catch (RuntimeException exception) {
                if (BuildConfig.DEBUG) {
                logWarning("Unable to share log " + name, exception);
                }
            }
        });
        return true;
    }

    private void rememberNativeTransfer(long downloadId, String name, String url) {
        rememberNativeTransfer(downloadId, name, url, "DMP");
    }

    private void rememberNativeTransfer(
            long downloadId, String name, String url, String relativeDirectory) {
        synchronized (NATIVE_TRANSFER_LOCK) {
            JSONArray records = readNativeTransferRecords();
            try {
                JSONObject record = new JSONObject();
                record.put("downloadId", downloadId);
                record.put("name", name);
                record.put("url", url == null ? "" : url);
                record.put("directory", relativeDirectory == null
                        || relativeDirectory.trim().isEmpty() ? "DMP" : relativeDirectory);
                record.put("serverId", server.id);
                record.put("host", server.host);
                record.put("port", server.port);
                record.put("createdAt", System.currentTimeMillis());
                records.put(record);
                // Keep the preference bounded if a user repeatedly exports
                // backups.  Completed entries remain visible until Android
                // itself purges them, while the newest 80 are retained.
                int first = Math.max(0, records.length() - 80);
                JSONArray bounded = new JSONArray();
                for (int index = first; index < records.length(); index++) {
                    bounded.put(records.opt(index));
                }
                activity.getSharedPreferences(PREF_NATIVE_TRANSFER_TASKS, Context.MODE_PRIVATE)
                        .edit().putString("records", bounded.toString()).apply();
            } catch (JSONException exception) {
                if (BuildConfig.DEBUG) {
                    logWarning("Unable to store DMP transfer metadata", exception);
                }
            }
        }
    }

    /**
     * Executes a retry/delete action for a DownloadManager-backed transfer.
     * The task id is deliberately opaque (native-transfer-&lt;download id&gt;),
     * and no credentials are persisted in the transfer metadata.
     */
    @JavascriptInterface
    public boolean nativeTransferAction(String taskId, String action) {
        return performNativeTransferAction(activity, server, taskId, action);
    }

    static boolean performNativeTransferAction(
            Context context, DmpServer server, String taskId, String action) {
        if (context == null || server == null || taskId == null || action == null) {
            return false;
        }
        if (!taskId.startsWith("native-transfer-")) {
            return false;
        }
        long oldId;
        try {
            oldId = Long.parseLong(taskId.substring("native-transfer-".length()));
        } catch (NumberFormatException ignored) {
            return false;
        }
        DownloadManager manager =
                (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        synchronized (NATIVE_TRANSFER_LOCK) {
            JSONArray records = readNativeTransferRecords(context);
            JSONObject match = null;
            for (int index = 0; index < records.length(); index++) {
                JSONObject record = records.optJSONObject(index);
                if (record != null && record.optLong("downloadId", 0) == oldId) {
                    match = record;
                    break;
                }
            }
            if (match == null) {
                return false;
            }
            if (isNativeHttpLogRecord(match) || oldId < 0) {
                // Resumable log workers do not have an Android
                // DownloadManager row.  Keep their action semantics aligned
                // with the task centre: dismiss a completed row, delete a
                // partial/failed row, or start a fresh retry.
                if ("dismiss".equalsIgnoreCase(action)) {
                    cancelNativeLogTransfer(oldId, match, false);
                    removeNativeTransferRecord(context, records, oldId);
                    return true;
                }
                if ("delete".equalsIgnoreCase(action)
                        || "remove".equalsIgnoreCase(action)) {
                    cancelNativeLogTransfer(oldId, match, true);
                    removeNativeTransferRecord(context, records, oldId);
                    return true;
                }
                if (!"retry".equalsIgnoreCase(action)) {
                    return false;
                }
                String retryUrl = normalizeDmpDownloadUrl(
                        server, match.optString("url", ""));
                if (!isWebUrlValue(retryUrl)) return false;
                String retryName = match.optString("name", createLogFileName());
                cancelNativeLogTransfer(oldId, match, true);
                removeNativeTransferRecord(context, records, oldId);
                return startNativeLogTransfer(context, server, retryUrl, retryName);
            }
            // A completed DownloadManager transfer can be dismissed from the
            // task centre without touching its row. Keeping that row preserves
            // the exported file in Download/DMP; only metadata is removed.
            if (manager == null && !"dismiss".equalsIgnoreCase(action)) {
                return false;
            }
            if ("dismiss".equalsIgnoreCase(action)) {
                // Dismissal is display-only: do not call manager.remove(),
                // because Android may delete the already downloaded file.
                removeNativeTransferRecord(context, records, oldId);
                return true;
            }
            if ("delete".equalsIgnoreCase(action) || "remove".equalsIgnoreCase(action)) {
                manager.remove(oldId);
                removeNativeTransferRecord(context, records, oldId);
                return true;
            }
            if (!"retry".equalsIgnoreCase(action)) {
                return false;
            }
            String url = normalizeDmpDownloadUrl(server, match.optString("url", ""));
            if (!isWebUrlValue(url)) {
                return false;
            }
            String name = match.optString("name", "dmp-download");
            manager.remove(oldId);
            removeNativeTransferRecord(context, records, oldId);
            try {
                String relativeDirectory = match.optString("directory", "DMP").trim();
                if (relativeDirectory.isEmpty()) relativeDirectory = "DMP";
                String resolvedName = uniqueDownloadName(context, name, relativeDirectory);
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                if (isSameServerOrigin(server, url)) {
                    request.addRequestHeader("X-DMP-TOKEN", server.token);
                }
                request.addRequestHeader("X-I18n-Lang", "zh");
                request.addRequestHeader("Accept-Encoding", "identity");
                request.addRequestHeader("Connection", "close");
                request.addRequestHeader("Cache-Control", "no-cache");
                request.setAllowedOverMetered(true);
                request.setAllowedOverRoaming(true);
                request.setTitle(resolvedName);
                request.setNotificationVisibility(
                        DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(
                        Environment.DIRECTORY_DOWNLOADS,
                        relativeDirectory + "/" + resolvedName);
                long newId = manager.enqueue(request);
                appendNativeTransferRecord(
                        context, newId, resolvedName, url, server, relativeDirectory);
                return true;
            } catch (JSONException exception) {
                if (BuildConfig.DEBUG) {
                logWarning("Unable to save retried DMP transfer metadata", exception);
                }
                return false;
            } catch (RuntimeException exception) {
                if (BuildConfig.DEBUG) {
                logWarning("Unable to retry DMP transfer", exception);
                }
                return false;
            }
        }
    }

    private static void cancelNativeLogTransfer(
            long transferId, JSONObject record, boolean deletePartialFile) {
        Future<?> future = ACTIVE_LOG_TRANSFERS.remove(transferId);
        if (future != null) future.cancel(true);
        if (!deletePartialFile || record == null) return;
        String path = record.optString("tempPath", "").trim();
        if (!path.isEmpty()) {
            // The path is generated by this bridge and persisted in the same
            // private metadata record; no JavaScript-supplied path reaches
            // this method.
            File partial = new File(path);
            //noinspection ResultOfMethodCallIgnored
            partial.delete();
        }
    }

    private static boolean isWebUrlValue(String url) {
        if (url == null) return false;
        String scheme = Uri.parse(url).getScheme();
        return "http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme);
    }

    /**
     * A DMP token is scoped to the configured protocol/host/port.  Download
     * links may be server-provided, so an external URL must remain usable but
     * must never receive this credential as a request header.
     */
    private static boolean isSameServerOrigin(DmpServer server, String url) {
        if (server == null || !isWebUrlValue(url)
                || server.host == null || server.host.trim().isEmpty()) {
            return false;
        }
        try {
            Uri parsed = Uri.parse(url);
            String scheme = parsed.getScheme();
            String host = parsed.getHost();
            if (scheme == null || host == null
                    || !scheme.equalsIgnoreCase(server.protocol)
                    || !host.equalsIgnoreCase(server.host)) {
                return false;
            }
            int parsedPort = parsed.getPort();
            if (parsedPort < 0) {
                parsedPort = "https".equalsIgnoreCase(scheme) ? 443 : 80;
            }
            int serverPort = server.port > 0
                    ? server.port
                    : ("https".equalsIgnoreCase(server.protocol) ? 443 : 80);
            return parsedPort == serverPort;
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    /**
     * Convert a same-server DMP download URL to the API namespace expected by
     * the backend.  External URLs are left untouched; this keeps ordinary
     * browser downloads working while fixing the relative endpoint used by
     * the backup-management page.
     */
    private static String normalizeDmpDownloadUrl(DmpServer server, String url) {
        if (server == null || !isWebUrlValue(url)) {
            return url;
        }
        try {
            Uri parsed = Uri.parse(url);
            String host = parsed.getHost();
            if (host == null || !server.host.equalsIgnoreCase(host)) {
                return url;
            }
            int parsedPort = parsed.getPort();
            if (parsedPort > 0 && parsedPort != server.port) {
                return url;
            }
            String path = parsed.getPath();
            if (path == null || path.isEmpty()
                    || "/v3".equals(path) || path.startsWith("/v3/")) {
                return url;
            }
            String prefixedPath = path.startsWith("/") ? "/v3" + path : "/v3/" + path;
            return parsed.buildUpon().path(prefixedPath).build().toString();
        } catch (RuntimeException ignored) {
            return url;
        }
    }

    /** Resolve a WebView-relative DMP export URL before DownloadManager sees it. */
    private static String resolveDmpDownloadUrl(DmpServer server, String url) {
        if (server == null || url == null) return url;
        String raw = url.trim();
        if (raw.isEmpty()) return raw;
        if (isWebUrlValue(raw)) return normalizeDmpDownloadUrl(server, raw);
        if (raw.startsWith("file:")) {
            try {
                Uri parsed = Uri.parse(raw);
                String path = parsed.getPath();
                if (path != null && path.startsWith("/v3/")) {
                    return server.baseUrl() + path
                            + (parsed.getQuery() == null ? "" : "?" + parsed.getQuery());
                }
                int marker = path == null ? -1 : path.indexOf("/android_asset/dmp_web/");
                if (marker >= 0) raw = path.substring(marker + "/android_asset/dmp_web/".length());
            } catch (RuntimeException ignored) {
                return raw;
            }
        }
        if (raw.startsWith("/v3/")) return server.baseUrl() + raw;
        if (raw.startsWith("/")) return server.baseUrl() + "/v3" + raw;
        if (raw.startsWith("v3/")) return server.baseUrl() + "/" + raw;
        if (raw.startsWith("tools/") || raw.startsWith("room/")
                || raw.startsWith("platform/") || raw.startsWith("dashboard/")
                || raw.startsWith("mod/") || raw.startsWith("tasks/")) {
            return server.baseUrl() + "/v3/" + raw;
        }
        return raw;
    }

    private static JSONArray readNativeTransferRecords(Context context) {
        String raw = context.getSharedPreferences(PREF_NATIVE_TRANSFER_TASKS,
                Context.MODE_PRIVATE).getString("records", "[]");
        try {
            return new JSONArray(raw == null || raw.trim().isEmpty() ? "[]" : raw);
        } catch (JSONException exception) {
            return new JSONArray();
        }
    }

    private static void writeNativeTransferRecords(Context context, JSONArray records) {
        context.getSharedPreferences(PREF_NATIVE_TRANSFER_TASKS, Context.MODE_PRIVATE)
                .edit().putString("records", records.toString()).apply();
    }

    private static void removeNativeTransferRecord(
            Context context, JSONArray records, long downloadId) {
        JSONArray bounded = new JSONArray();
        for (int index = 0; index < records.length(); index++) {
            JSONObject record = records.optJSONObject(index);
            if (record != null && record.optLong("downloadId", 0) != downloadId) {
                bounded.put(record);
            }
        }
        writeNativeTransferRecords(context, bounded);
    }

    private static void appendNativeTransferRecord(
            Context context, long downloadId, String name, String url, DmpServer server)
            throws JSONException {
        appendNativeTransferRecord(context, downloadId, name, url, server, "DMP");
    }

    private static void appendNativeTransferRecord(
            Context context, long downloadId, String name, String url, DmpServer server,
            String relativeDirectory)
            throws JSONException {
        JSONArray records = readNativeTransferRecords(context);
        JSONObject record = new JSONObject();
        record.put("downloadId", downloadId);
        record.put("name", name);
        record.put("url", url);
        record.put("directory", relativeDirectory == null
                || relativeDirectory.trim().isEmpty() ? "DMP" : relativeDirectory);
        record.put("serverId", server.id);
        record.put("host", server.host);
        record.put("port", server.port);
        record.put("createdAt", System.currentTimeMillis());
        records.put(record);
        int first = Math.max(0, records.length() - 80);
        JSONArray bounded = new JSONArray();
        for (int index = first; index < records.length(); index++) {
            bounded.put(records.opt(index));
        }
        writeNativeTransferRecords(context, bounded);
    }

    private JSONArray readNativeTransferRecords() {
        synchronized (NATIVE_TRANSFER_LOCK) {
            String raw = activity.getSharedPreferences(
                    PREF_NATIVE_TRANSFER_TASKS, Context.MODE_PRIVATE)
                    .getString("records", "[]");
            try {
                return new JSONArray(raw == null || raw.trim().isEmpty() ? "[]" : raw);
            } catch (JSONException exception) {
                return new JSONArray();
            }
        }
    }

    private static String transferStatus(int status) {
        switch (status) {
            case DownloadManager.STATUS_PENDING:
                return "queued";
            case DownloadManager.STATUS_RUNNING:
                return "running";
            case DownloadManager.STATUS_PAUSED:
                return "paused";
            case DownloadManager.STATUS_SUCCESSFUL:
                return "success";
            case DownloadManager.STATUS_FAILED:
            default:
                return "error";
        }
    }

    private static String transferStage(String status) {
        if ("success".equals(status)) {
            return "completed";
        }
        if ("error".equals(status)) {
            return "failed";
        }
        if ("paused".equals(status)) {
            return "paused";
        }
        return "transferring";
    }

    /**
     * Receives the WebView download store without ever persisting the DMP
     * entry/token.  This is a compatibility bridge for servers which still
     * expose per-download progress but not the unified /tasks list endpoint.
     */
    @JavascriptInterface
    public void syncDownloadTasks(String payload) {
        if (payload == null || payload.length() > 256 * 1024) {
            return;
        }
        try {
            JSONArray source = new JSONArray(payload);
            JSONArray safe = new JSONArray();
            String[] fields = {
                    "id", "serverId", "serverTaskID", "taskID", "type", "roomID", "roomName",
                    "roomIDs", "roomNames", "modID", "name", "status", "stage",
                     "file_url", "fileUrl",
                    "upload", "isUpload", "direction", "transferDirection", "operation", "transferType",
                    "completedBytes", "totalBytes", "progress", "speedBytesPerSecond",
                     "progressKnown", "serverTask", "canPause", "serverName", "serverHost",
                     "serverUpdateObserved", "serverLastUpdating", "versionAtRequest",
                    "downloadedBytes", "bytesDownloaded", "bytesTotal", "size", "update", "percent",
                    "percentage", "progressPercent", "downloadSpeed", "bytesPerSecond",
                    "message", "error", "detail", "createdAt", "updatedAt", "finishedAt",
                    "attempt", "recovering", "postAlreadySubmitted", "serverMayContinue"
            };
            synchronized (WEB_DOWNLOAD_LOCK) {
                synchronized (NATIVE_TRANSFER_LOCK) {
                    for (int index = 0; index < source.length(); index++) {
                        JSONObject item = source.optJSONObject(index);
                        if (item == null) {
                            continue;
                        }
                        // Ignore malformed initialization placeholders. Persisting
                        // them creates permanent, non-actionable rows in the task
                        // centre after a WebView is recreated.
                        String type = item.optString("type", item.optString("taskType", ""));
                        String itemId = item.optString("id", "").trim();
                        boolean validCompositeId = itemId.matches(
                                "mod:[^:]+:[1-9][0-9]*:[1-9][0-9]*");
                        if (isWebTaskDismissedLocked(activity, server, item)) {
                            continue;
                        }
                        if ("mod_download".equalsIgnoreCase(type)
                                && (item.optInt("roomID", item.optInt("roomId", 0)) <= 0
                                || item.optInt("modID", item.optInt("modId", 0)) <= 0)
                                && item.optString("serverTaskID", "").trim().isEmpty()
                                && item.optString("taskID", "").trim().isEmpty()
                                && !validCompositeId) {
                            continue;
                        }
                        JSONObject copy = new JSONObject();
                        for (String field : fields) {
                            if (item.has(field) && !item.isNull(field)) {
                                copy.put(field, item.get(field));
                            }
                        }
                        if (!copy.has("serverId")) {
                            copy.put("serverId", server.id);
                        }
                        safe.put(copy);
                    }
                    JSONObject wrapper = new JSONObject();
                    wrapper.put("serverId", server.id);
                    wrapper.put("host", server.host);
                    wrapper.put("port", server.port);
                    wrapper.put("tasks", safe);
                activity.getSharedPreferences(PREF_WEB_DOWNLOAD_TASKS, Context.MODE_PRIVATE)
                        .edit()
                        .putString(server.id, wrapper.toString())
                        .apply();
                }
            }
        } catch (JSONException | RuntimeException ignored) {
            // A malformed browser snapshot must never affect the WebView.
        }
    }

    /**
     * Receives the current platform's update notices for the aggregate native
     * task centre.  Only display fields are retained; credentials, URLs and
     * arbitrary WebView state are deliberately discarded.
     */
    @JavascriptInterface
    public void syncPlatformNotifications(String payload) {
        if (payload == null || payload.length() > 64 * 1024 || server == null
                || server.id == null || server.id.trim().isEmpty()) {
            return;
        }
        try {
            JSONArray source = new JSONArray(payload);
            JSONArray safe = new JSONArray();
            for (int index = 0; index < source.length() && safe.length() < 120; index++) {
                JSONObject item = source.optJSONObject(index);
                if (item == null) continue;
                String kind = item.optString("kind", "").trim();
                String title = item.optString("title", "").trim();
                String detail = item.optString("detail", "").trim();
                String key = item.optString("key", "").trim();
                String token = item.optString("token", "").trim();
                if (title.isEmpty() || detail.isEmpty()) continue;
                if (kind.length() > 32 || title.length() > 160 || detail.length() > 600
                        || key.length() > 256 || token.length() > 256) continue;
                safe.put(new JSONObject()
                        .put("kind", kind)
                        .put("title", title)
                        .put("detail", detail)
                        .put("key", key)
                        .put("token", token)
                        .put("updatedAt", System.currentTimeMillis()));
            }
            activity.getSharedPreferences(PREF_PLATFORM_NOTIFICATIONS, Context.MODE_PRIVATE)
                    .edit().putString(server.id, safe.toString()).apply();
        } catch (JSONException | RuntimeException ignored) {
            // A malformed optional notice payload must never affect the web UI.
        }
    }

    /**
     * Remove one task from the token-free WebView snapshot. DMP 3.2 has no
     * server-side pause/continue endpoint, so Android intentionally exposes
     * deletion only; the server-owned SteamCMD worker is never claimed to be
     * paused or resumed locally.
     */
    static boolean performWebTaskAction(
            Context context, DmpServer server, String taskId, String action) {
        if (context == null || server == null || server.id == null
                || taskId == null || taskId.trim().isEmpty()) {
            return false;
        }
        if (!"delete".equals(action)) {
            return false;
        }
        String wanted = taskId.trim();
        synchronized (WEB_DOWNLOAD_LOCK) {
            // Preserve an opaque local tombstone even when the browser has
            // already removed its own row. A late server status poll must not
            // make a user-deleted task reappear after re-entering the platform.
            rememberWebDownloadDismissal(context, server, wanted);
            synchronized (NATIVE_TRANSFER_LOCK) {
            android.content.SharedPreferences preferences = context.getSharedPreferences(
                    PREF_WEB_DOWNLOAD_TASKS, Context.MODE_PRIVATE);
            String payload = preferences.getString(server.id, "");
            if (payload == null || payload.trim().isEmpty()) return "delete".equals(action);
            try {
                JSONObject wrapper = new JSONObject(payload);
                JSONArray source = wrapper.optJSONArray("tasks");
                if (source == null) return "delete".equals(action);
                JSONArray kept = new JSONArray();
                boolean changed = false;
                for (int index = 0; index < source.length(); index++) {
                    JSONObject item = source.optJSONObject(index);
                    if (item == null) continue;
                    if (!webTaskMatches(item, wanted)) {
                        kept.put(item);
                        continue;
                    }
                    changed = true;
                    // This removes the Android history row only; the
                    // server-owned SteamCMD process is not claimed to be
                    // cancelled because 3.2 exposes no such endpoint.
                    continue;
                }
                if (!changed) return "delete".equals(action);
                wrapper.put("tasks", kept);
                preferences.edit().putString(server.id, wrapper.toString()).apply();
                return true;
            } catch (JSONException | RuntimeException ignored) {
                return false;
            }
            }
        }
    }

    /** Action entry point used by the Android-owned in-page task renderer. */
    @JavascriptInterface
    public boolean webTaskAction(String taskId, String action) {
        return performWebTaskAction(activity, server, taskId, action);
    }

    /** Clears a local delete/cancel tombstone for a deliberate new download. */
    @JavascriptInterface
    public void clearWebTaskDismissal(String taskId) {
        clearWebDownloadDismissal(activity, server, taskId);
    }

    private static String webDownloadServerKey(DmpServer server) {
        return server == null || server.id == null ? "" : server.id;
    }

    /**
     * DMP 3.2 does not provide a server-side cancel API. Keep only opaque task
     * ids in native preferences so the client can remember that a user removed
     * a row even after WebStorage/localStorage is intentionally cleared.
     */
    private static JSONArray readWebDownloadDismissals(Context context, DmpServer server) {
        if (context == null) return new JSONArray();
        synchronized (WEB_DOWNLOAD_LOCK) {
            String raw = context.getSharedPreferences(PREF_WEB_DOWNLOAD_DISMISSED_TASKS,
                    Context.MODE_PRIVATE).getString(webDownloadServerKey(server), "");
            if (raw == null || raw.trim().isEmpty()) return new JSONArray();
            try {
                JSONArray source = new JSONArray(raw);
                JSONArray safe = new JSONArray();
                for (int index = 0; index < source.length() && safe.length() < 120; index++) {
                    String id = source.optString(index, "").trim();
                    if (id.isEmpty() || id.length() > 256) continue;
                    boolean duplicate = false;
                    for (int existing = 0; existing < safe.length(); existing++) {
                        if (id.equals(safe.optString(existing))) {
                            duplicate = true;
                            break;
                        }
                    }
                    if (!duplicate) safe.put(id);
                }
                return safe;
            } catch (JSONException ignored) {
                return new JSONArray();
            }
        }
    }

    private static void writeWebDownloadDismissals(
            Context context, DmpServer server, JSONArray dismissals) {
        if (context == null) return;
        context.getSharedPreferences(PREF_WEB_DOWNLOAD_DISMISSED_TASKS, Context.MODE_PRIVATE)
                .edit()
                .putString(webDownloadServerKey(server),
                        dismissals == null ? "[]" : dismissals.toString())
                .apply();
    }

    private static void rememberWebDownloadDismissal(
            Context context, DmpServer server, String taskId) {
        String wanted = taskId == null ? "" : taskId.trim();
        if (wanted.isEmpty() || wanted.length() > 256) return;
        synchronized (WEB_DOWNLOAD_LOCK) {
            JSONArray source = readWebDownloadDismissals(context, server);
            for (int index = 0; index < source.length(); index++) {
                if (wanted.equals(source.optString(index))) return;
            }
            JSONArray bounded = new JSONArray();
            int start = Math.max(0, source.length() - 119);
            for (int index = start; index < source.length(); index++) {
                bounded.put(source.optString(index));
            }
            bounded.put(wanted);
            writeWebDownloadDismissals(context, server, bounded);
        }
    }

    private static void clearWebDownloadDismissal(
            Context context, DmpServer server, String taskId) {
        String wanted = taskId == null ? "" : taskId.trim();
        if (wanted.isEmpty() || context == null) return;
        synchronized (WEB_DOWNLOAD_LOCK) {
            JSONArray source = readWebDownloadDismissals(context, server);
            JSONArray kept = new JSONArray();
            boolean changed = false;
            for (int index = 0; index < source.length(); index++) {
                String id = source.optString(index, "");
                if (wanted.equals(id)) {
                    changed = true;
                } else {
                    kept.put(id);
                }
            }
            if (changed) writeWebDownloadDismissals(context, server, kept);
        }
    }

    /** Match any of the legacy/native identifiers; rows can carry more than one. */
    static boolean webTaskMatches(JSONObject item, String wanted) {
        if (item == null || wanted == null || wanted.trim().isEmpty()) return false;
        String target = wanted.trim();
        return target.equals(item.optString("id", "").trim())
                || target.equals(item.optString("taskID", "").trim())
                || target.equals(item.optString("serverTaskID", "").trim());
    }

    private static boolean isWebTaskDismissedLocked(
            Context context, DmpServer server, JSONObject item) {
        JSONArray dismissed = readWebDownloadDismissals(context, server);
        for (int index = 0; index < dismissed.length(); index++) {
            if (webTaskMatches(item, dismissed.optString(index, ""))) return true;
        }
        return false;
    }

    private JSONArray readWebDownloadTasks() {
        String key = server.id == null ? "" : server.id;
        String payload = activity.getSharedPreferences(PREF_WEB_DOWNLOAD_TASKS,
                Context.MODE_PRIVATE).getString(key, "");
        if (payload == null || payload.trim().isEmpty()) {
            return new JSONArray();
        }
        try {
            JSONObject wrapper = new JSONObject(payload);
            JSONArray tasks = wrapper.optJSONArray("tasks");
            return tasks == null ? new JSONArray() : tasks;
        } catch (JSONException ignored) {
            return new JSONArray();
        }
    }

    private boolean isWebUrl(String url) {
        if (url == null) {
            return false;
        }
        String scheme = Uri.parse(url).getScheme();
        return "http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme);
    }
}
