package cn.xiaojie_gjs.dmp.ui.dmp;

import android.app.DownloadManager;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import cn.xiaojie_gjs.dmp.R;

/** Minimal Electron preload compatibility layer exposed only to bundled trusted DMP assets. */
final class DmpJavascriptBridge {

    private static final String TAG = "DmpRoomSelection";
    /** Shared, token-free snapshots used by the native platform task center. */
    static final String PREF_WEB_DOWNLOAD_TASKS = "dmp_web_download_tasks";
    /** DownloadManager records for server-to-phone transfers (backup exports). */
    private static final String PREF_NATIVE_TRANSFER_TASKS = "dmp_native_transfer_tasks";
    private static final Object NATIVE_TRANSFER_LOCK = new Object();

    private final DmpWebActivity activity;
    private final DmpServer server;
    private final int roomId;
    private final String roomName;
    private final int selectedRoomId;
    private final String selectedRoomName;
    private final boolean nightMode;
    private final boolean persistRoomSelection;

    DmpJavascriptBridge(
            DmpWebActivity activity,
            DmpServer server,
            int roomId,
            String roomName,
            int selectedRoomId,
            String selectedRoomName,
            boolean nightMode,
            boolean persistRoomSelection) {
        this.activity = activity;
        this.server = server;
        this.roomId = Math.max(0, roomId);
        this.roomName = roomName == null ? "" : roomName;
        this.selectedRoomId = Math.max(0, selectedRoomId);
        this.selectedRoomName = selectedRoomName == null ? "" : selectedRoomName;
        this.nightMode = nightMode;
        this.persistRoomSelection = persistRoomSelection;
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
            user.put("menus", new JSONArray());
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
            bootstrap.put("language", "zh");
            bootstrap.put("roomPreview", roomId > 0);
            // WebStorage is cleared when a platform WebView is destroyed.
            // Restore the token-free task snapshot for this server so an
            // in-flight backend update remains visible after re-entry.
            bootstrap.put("downloadTasks", readWebDownloadTasks());
            return bootstrap.toString();
        } catch (JSONException exception) {
            return "{}";
        }
    }

    @JavascriptInterface
    public void openEntry() {
        activity.runOnUiThread(activity::finish);
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
                    Log.d(TAG, "persist selection server=" + server.id
                            + " room=" + roomId + " name=" + safeName);
                    break;
                }
            }
        });
    }

    @JavascriptInterface
    public void openBrowser(String url) {
        if (isWebUrl(url)) {
            activity.runOnUiThread(() -> activity.openExternal(Uri.parse(url)));
        }
    }

    @JavascriptInterface
    public void downloadFile(String url, String requestedName) {
        if (!isWebUrl(url)) {
            return;
        }
        String safeName = requestedName == null
                ? "dmp-download"
                : requestedName.replaceAll("[\\\\/:*?\"<>|]", "_");
        activity.runOnUiThread(() -> {
            try {
                // The desktop download helper receives a relative /tools URL,
                // while the DMP API is mounted below /v3.  XHR requests get
                // the prefix from axios' baseURL, but the native DownloadManager
                // path bypasses axios.  Normalize it here so backup exports do
                // not hit http://host:port/tools/... and return 404.
                String normalizedUrl = normalizeDmpDownloadUrl(server, url);
                DownloadManager.Request request = new DownloadManager.Request(
                        Uri.parse(normalizedUrl));
                request.addRequestHeader("X-DMP-TOKEN", server.token);
                request.addRequestHeader("X-I18n-Lang", "zh");
                request.setTitle(safeName);
                request.setNotificationVisibility(
                        DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                // Keep all DMP exports in one predictable folder.  The nested
                // path is accepted by DownloadManager on Android 10+ and does
                // not require broad storage permissions.
                request.setDestinationInExternalPublicDir(
                        Environment.DIRECTORY_DOWNLOADS, "DMP/" + safeName);
                DownloadManager manager =
                        (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
                long downloadId = manager.enqueue(request);
                rememberNativeTransfer(downloadId, safeName, normalizedUrl);
            } catch (RuntimeException exception) {
                Log.w(TAG, "Unable to enqueue DMP transfer", exception);
                Toast.makeText(activity, R.string.dmp_status_failed, Toast.LENGTH_SHORT).show();
            }
        });
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

    /** Token-free native transfer snapshot shared by the all-platform task UI. */
    static JSONArray queryNativeTransfers(Context context, DmpServer server) {
        JSONArray result = new JSONArray();
        if (context == null || server == null) return result;
        DownloadManager manager =
                (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) return result;
        JSONArray records = readNativeTransferRecords(context);
        for (int index = 0; index < records.length(); index++) {
            JSONObject record = records.optJSONObject(index);
            if (record == null) continue;
            String owner = record.optString("serverId", "").trim();
            if (!owner.isEmpty() && !owner.equals(server.id)) continue;
            long downloadId = record.optLong("downloadId", 0);
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
                Log.w(TAG, "Unable to query DMP transfer " + downloadId, exception);
            } finally {
                if (cursor != null) cursor.close();
            }
        }
        return result;
    }

    private void rememberNativeTransfer(long downloadId, String name, String url) {
        synchronized (NATIVE_TRANSFER_LOCK) {
            JSONArray records = readNativeTransferRecords();
            try {
                JSONObject record = new JSONObject();
                record.put("downloadId", downloadId);
                record.put("name", name);
                record.put("url", url == null ? "" : url);
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
                Log.w(TAG, "Unable to store DMP transfer metadata", exception);
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
        if (manager == null) {
            return false;
        }
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
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                request.addRequestHeader("X-DMP-TOKEN", server.token);
                request.addRequestHeader("X-I18n-Lang", "zh");
                request.setTitle(name);
                request.setNotificationVisibility(
                        DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(
                        Environment.DIRECTORY_DOWNLOADS, "DMP/" + name);
                long newId = manager.enqueue(request);
                appendNativeTransferRecord(context, newId, name, url, server);
                return true;
            } catch (JSONException exception) {
                Log.w(TAG, "Unable to save retried DMP transfer metadata", exception);
                return false;
            } catch (RuntimeException exception) {
                Log.w(TAG, "Unable to retry DMP transfer", exception);
                return false;
            }
        }
    }

    private static boolean isWebUrlValue(String url) {
        if (url == null) return false;
        String scheme = Uri.parse(url).getScheme();
        return "http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme);
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
        JSONArray records = readNativeTransferRecords(context);
        JSONObject record = new JSONObject();
        record.put("downloadId", downloadId);
        record.put("name", name);
        record.put("url", url);
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
                    "completedBytes", "totalBytes", "progress", "speedBytesPerSecond",
                     "progressKnown", "serverTask", "canPause", "serverName", "serverHost",
                     "serverUpdateObserved", "serverLastUpdating", "versionAtRequest",
                     "downloadedBytes", "bytesDownloaded", "bytesTotal", "size", "file_url", "update", "percent",
                    "percentage", "progressPercent", "downloadSpeed", "bytesPerSecond",
                    "message", "error", "detail", "createdAt", "updatedAt", "finishedAt"
            };
            for (int index = 0; index < source.length(); index++) {
                JSONObject item = source.optJSONObject(index);
                if (item == null) {
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
        } catch (JSONException | RuntimeException ignored) {
            // A malformed browser snapshot must never affect the WebView.
        }
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
