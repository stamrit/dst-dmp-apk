package cn.xiaojie_gjs.bianjiemj.ui.dmp;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

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
    public final long updatedAt;
    public final long finishedAt;

    private DmpTask(DmpServer server, JSONObject json) {
        this.server = server;
        taskId = json.optString("taskID", "");
        type = json.optString("type", "");
        name = json.optString("name", "");
        status = json.optString("status", "unknown");
        stage = json.optString("stage", "");
        progress = Math.max(0, Math.min(100, json.optDouble("progress", 0)));
        completedBytes = Math.max(0, json.optLong("completedBytes", 0));
        totalBytes = Math.max(0, json.optLong("totalBytes", 0));
        speedBytesPerSecond = Math.max(0, json.optDouble("speedBytesPerSecond", 0));
        message = json.optString("message", "");
        roomIds = intList(json.optJSONArray("roomIDs"));
        roomNames = stringList(json.optJSONArray("roomNames"));
        roomId = json.optInt("roomID", roomIds.isEmpty() ? 0 : roomIds.get(0));
        roomName = json.optString("roomName", "").trim();
        updatedAt = json.optLong("updatedAt", 0);
        finishedAt = json.optLong("finishedAt", 0);
    }

    public static DmpTask fromJson(DmpServer server, JSONObject json) {
        return new DmpTask(server, json == null ? new JSONObject() : json);
    }

    public boolean isRunning() {
        return "running".equals(status);
    }

    public boolean isPaused() {
        return "paused".equals(status);
    }

    public boolean isTerminal() {
        return "success".equals(status) || "failed".equals(status)
                || "cancelled".equals(status) || "canceled".equals(status);
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
}
