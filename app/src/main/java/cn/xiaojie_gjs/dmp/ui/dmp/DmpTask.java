package cn.xiaojie_gjs.dmp.ui.dmp;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.Locale;

/** Unified server task returned by a task-capable DMP instance. */
public class DmpTask {
    public final DmpServer server;
    public final String taskId;
    public final String type;
    public final String name;
    public final String status;
    public final String stage;
    public final double progress;
    public final long completedBytes;
    public final long totalBytes;
    public final double speedBytesPerSecond;
    public final String message;
    public final List<Integer> roomIds;
    public final List<String> roomNames;
    /** Single room ID used by older mod-download task payloads. */
    public final int roomId;
    /** Full room name supplied by the unified task API for mod downloads. */
    public final String roomName;
    /** Steam Workshop mod id for 3.2.0 /v3/mod/download/status polling. */
    public final int modId;
    /** Source URL required by the native 3.2.0 mod redownload endpoint. */
    public final String fileUrl;
    /** Whether the request is an update rather than an initial download. */
    public final boolean update;
    /** Transfer direction for backup/file tasks (true means phone upload). */
    public final boolean upload;
    public final long updatedAt;
    public final long finishedAt;
    /** Compatibility metadata persisted by the Android WebView bridge for
     * boolean-only (legacy) server updates. */
    public final boolean serverUpdateObserved;
    public final boolean serverLastUpdating;
    public final int versionAtRequest;

    private DmpTask(DmpServer server, JSONObject json) {
        this.server = server;
        taskId = firstString(json, "taskID", "serverTaskID", "id");
        type = firstString(json, "type", "taskType");
        name = firstString(json, "name", "modName", "modID", "title");
        String parsedStatus = firstString(json, "status", "state");
        status = parsedStatus.isEmpty()
                ? "unknown"
                : parsedStatus.toLowerCase(Locale.US).replace('-', '_').trim();
        stage = firstString(json, "stage", "phase");
        completedBytes = Math.max(0, firstLong(json,
                "completedBytes", "downloadedBytes", "bytesDownloaded", "doneBytes"));
        totalBytes = Math.max(0, firstLong(json,
                "totalBytes", "size", "bytesTotal", "downloadSize"));
        double parsedProgress = firstDouble(json,
                "progress", "percent", "percentage", "progressPercent");
        // Some transitional task endpoints omit a percentage and expose only
        // byte counters.  Keep the same 0..100 contract used by the UI.
        if (parsedProgress <= 0d && totalBytes > 0 && completedBytes > 0) {
            parsedProgress = completedBytes * 100d / totalBytes;
        }
        progress = Math.max(0, Math.min(100, parsedProgress));
        speedBytesPerSecond = Math.max(0, firstDouble(json,
                "speedBytesPerSecond", "speed", "downloadSpeed", "bytesPerSecond"));
        message = firstString(json, "message", "error", "detail");
        roomIds = intList(firstArray(json, "roomIDs", "roomIds", "room_ids"));
        roomNames = stringList(firstArray(json, "roomNames", "room_names"));
        int parsedRoomId = firstInt(json, "roomID", "roomId", "room_id");
        roomId = parsedRoomId > 0 || roomIds.isEmpty() ? parsedRoomId : roomIds.get(0);
        roomName = firstString(json, "roomName", "room_name");
        modId = firstInt(json, "modID", "modId", "mod_id");
        fileUrl = firstString(json, "file_url", "fileUrl", "fileURL");
        update = firstBoolean(json, "update", "isUpdate");
        upload = firstBoolean(json, "upload", "isUpload")
                || isUploadDirection(firstString(json,
                "direction", "transferDirection", "operation", "transferType"));
        updatedAt = firstLong(json, "updatedAt", "updated_at", "timeUpdated", "time_updated");
        finishedAt = firstLong(json, "finishedAt", "finished_at", "timeFinished", "time_finished");
        serverUpdateObserved = firstBoolean(json,
                "serverUpdateObserved", "server_update_observed");
        serverLastUpdating = firstBoolean(json,
                "serverLastUpdating", "server_last_updating");
        versionAtRequest = firstInt(json,
                "versionAtRequest", "version_at_request");
    }

    public static DmpTask fromJson(DmpServer server, JSONObject json) {
        return new DmpTask(server, json == null ? new JSONObject() : json);
    }

    public boolean isRunning() {
        return "running".equals(status)
                || "downloading".equals(status)
                || "pending".equals(status)
                || "waiting".equals(status)
                || "starting".equals(status)
                || "processing".equals(status)
                || "pause_pending".equals(status)
                || "pausepending".equals(status)
                || "in_progress".equals(status)
                || "queued".equals(status);
    }

    public boolean isPaused() {
        return "paused".equals(status)
                || "pause_pending".equals(status)
                || "pausepending".equals(status);
    }

    public boolean isTerminal() {
        return "success".equals(status) || "failed".equals(status)
                || "cancelled".equals(status) || "canceled".equals(status)
                || "error".equals(status)
                || "complete".equals(status) || "completed".equals(status)
                || "done".equals(status) || "success".equals(status);
    }

    private static boolean isUploadDirection(String value) {
        String normalized = value == null ? "" : value.trim().toLowerCase(Locale.US);
        return "upload".equals(normalized) || "up".equals(normalized)
                || normalized.contains("upload");
    }

    private static List<Integer> intList(JSONArray array) {
        List<Integer> values = new ArrayList<>();
        if (array != null) {
            for (int index = 0; index < array.length(); index++) {
                values.add(array.optInt(index));
            }
        }
        return values;
    }

    private static List<String> stringList(JSONArray array) {
        List<String> values = new ArrayList<>();
        if (array != null) {
            for (int index = 0; index < array.length(); index++) {
                String value = array.optString(index, "").trim();
                if (!value.isEmpty()) {
                    values.add(value);
                }
            }
        }
        return values;
    }

    private static JSONArray firstArray(JSONObject json, String... keys) {
        for (String key : keys) {
            JSONArray array = json.optJSONArray(key);
            if (array != null) {
                return array;
            }
        }
        return null;
    }

    private static String firstString(JSONObject json, String... keys) {
        for (String key : keys) {
            String value = json.optString(key, "").trim();
            if (!value.isEmpty() && !"null".equalsIgnoreCase(value)) {
                return value;
            }
        }
        return "";
    }

    private static int firstInt(JSONObject json, String... keys) {
        for (String key : keys) {
            Object value = json.opt(key);
            if (value instanceof Number) {
                return ((Number) value).intValue();
            }
            if (value instanceof String) {
                try {
                    return Integer.parseInt(((String) value).trim());
                } catch (NumberFormatException ignored) {
                    // Try the next compatible field.
                }
            }
        }
        return 0;
    }

    private static double firstDouble(JSONObject json, String... keys) {
        for (String key : keys) {
            Object value = json.opt(key);
            double parsed = number(value);
            if (Double.isFinite(parsed)) {
                String normalizedKey = key.toLowerCase(Locale.US);
                if (parsed >= 0 && parsed <= 1
                        && (normalizedKey.contains("progress")
                        || normalizedKey.contains("percent"))) {
                    parsed *= 100;
                }
                return parsed;
            }
        }
        return 0;
    }

    private static double number(Object value) {
        if (value instanceof Number) {
            return ((Number) value).doubleValue();
        }
        if (value instanceof String) {
            String text = ((String) value).trim();
            if (text.endsWith("%")) {
                text = text.substring(0, text.length() - 1).trim();
            }
            try {
                return Double.parseDouble(text);
            } catch (NumberFormatException ignored) {
                // Not a numeric value.
            }
        }
        return Double.NaN;
    }

    private static long firstLong(JSONObject json, String... keys) {
        for (String key : keys) {
            Object value = json.opt(key);
            if (value instanceof Number) {
                return ((Number) value).longValue();
            }
            if (value instanceof String) {
                try {
                    return Long.parseLong(((String) value).trim());
                } catch (NumberFormatException ignored) {
                    try {
                        return Instant.parse(((String) value).trim()).toEpochMilli();
                    } catch (DateTimeParseException ignoredIso) {
                        // Try the next compatible field.
                    }
                }
            }
        }
        return 0;
    }

    private static boolean firstBoolean(JSONObject json, String... keys) {
        for (String key : keys) {
            Object value = json.opt(key);
            if (value instanceof Boolean) {
                return (Boolean) value;
            }
            if (value instanceof Number) {
                return ((Number) value).doubleValue() != 0d;
            }
            if (value instanceof String) {
                String text = ((String) value).trim();
                if ("true".equalsIgnoreCase(text) || "1".equals(text)) {
                    return true;
                }
                if ("false".equalsIgnoreCase(text) || "0".equals(text)) {
                    return false;
                }
            }
        }
        return false;
    }
}
