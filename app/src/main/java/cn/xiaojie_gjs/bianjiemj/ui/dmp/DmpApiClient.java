package cn.xiaojie_gjs.bianjiemj.ui.dmp;

import android.net.Uri;

import org.json.JSONException;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.ArrayList;
import java.util.List;

/** Small DMP v3 API client used only for server-card monitoring. */
public class DmpApiClient {

    public interface Callback {
        void onSuccess(DmpMetrics metrics);

        void onError(String message);
    }

    public interface RoomsCallback {
        void onSuccess(List<DmpRoom> rooms);

        void onError(String message);
    }

    public interface TasksCallback {
        void onSuccess(List<DmpTask> tasks);

        void onUnsupported();

        void onError(String message);
    }

    public interface VersionCallback {
        void onSuccess(DmpVersion version);

        void onUnsupported();

        void onError(String message);
    }

    public interface UpdateCallback {
        void onSuccess(DmpTask task, boolean started, boolean deduplicated);

        void onUnsupported();

        void onError(String message);
    }

    public interface TaskActionCallback {
        void onSuccess(DmpTask task);

        void onUnsupported();

        void onError(String message);
    }

    private final ExecutorService executor = Executors.newFixedThreadPool(3);

    public void fetchMetrics(DmpServer server, Callback callback) {
        if (server.token == null || server.token.trim().isEmpty()) {
            callback.onError("缺少平台令牌");
            return;
        }
        executor.execute(() -> {
            try {
                JSONObject system = request(server, "/v3/dashboard/info/sys");
                JSONObject overview = request(server, "/v3/platform/overview");
                JSONObject systemData = system.getJSONObject("data");
                JSONObject overviewData = overview.getJSONObject("data");
                callback.onSuccess(new DmpMetrics(
                        clampPercent(systemData.optDouble("cpu", 0)),
                        clampPercent(systemData.optDouble("memory", 0)),
                        overviewData.optInt("roomCount", 0),
                        overviewData.optInt("worldCount", 0)));
            } catch (IOException | JSONException exception) {
                String message = exception.getMessage();
                callback.onError(message == null || message.trim().isEmpty()
                        ? "连接服务器失败"
                        : message);
            }
        });
    }

    /** Loads a server's rooms once. No scheduler is attached to this request. */
    public void fetchRooms(DmpServer server, RoomsCallback callback) {
        if (server.token == null || server.token.trim().isEmpty()) {
            callback.onError("缺少平台令牌");
            return;
        }
        executor.execute(() -> {
            try {
                JSONObject response = request(server, "/v3/room/list?page=1&pageSize=1000");
                JSONObject data = response.getJSONObject("data");
                JSONArray rows = data.optJSONArray("rows");
                List<DmpRoom> rooms = new ArrayList<>();
                if (rows != null) {
                    for (int index = 0; index < rows.length(); index++) {
                        JSONObject row = rows.optJSONObject(index);
                        if (row == null) {
                            continue;
                        }
                        JSONArray worlds = row.optJSONArray("worlds");
                        JSONArray playerHistory = row.optJSONArray("players");
                        JSONArray currentPlayers = null;
                        if (playerHistory != null && playerHistory.length() > 0) {
                            JSONObject latest = playerHistory.optJSONObject(playerHistory.length() - 1);
                            if (latest != null) {
                                currentPlayers = latest.optJSONArray("playerInfo");
                            }
                        }
                        // Some DMP builds return the current snapshot directly instead of
                        // retaining player history. Accept both shapes so the room overview
                        // does not lose its online count after a server-side upgrade.
                        if (currentPlayers == null) {
                            currentPlayers = row.optJSONArray("playerInfo");
                        }
                        if (currentPlayers == null) {
                            currentPlayers = row.optJSONArray("onlinePlayers");
                        }
                        StringBuilder playerNames = new StringBuilder();
                        if (currentPlayers != null) {
                            for (int playerIndex = 0;
                                    playerIndex < currentPlayers.length();
                                    playerIndex++) {
                                JSONObject player = currentPlayers.optJSONObject(playerIndex);
                                if (player == null) {
                                    continue;
                                }
                                String nickname = player.optString("nickname", "").trim();
                                if (nickname.isEmpty()) {
                                    continue;
                                }
                                if (playerNames.length() > 0) {
                                    playerNames.append("、");
                                }
                                playerNames.append(nickname);
                            }
                        }
                        int currentPlayerCount = currentPlayers == null ? 0 : currentPlayers.length();
                        int reportedPlayerCount = firstPositiveInt(row,
                                "onlinePlayers", "onlinePlayerCount", "playerCount", "currentPlayers");
                        if (reportedPlayerCount > currentPlayerCount) {
                            currentPlayerCount = reportedPlayerCount;
                        }
                        if (playerNames.length() == 0) {
                            appendPlayerNames(playerNames, row.optJSONArray("playerNames"));
                        }
                        rooms.add(new DmpRoom(
                                server,
                                row.optInt("id", 0),
                                row.optString("gameName", ""),
                                row.optString("gameMode", ""),
                                row.optBoolean("status", false),
                                worlds == null ? 0 : worlds.length(),
                                firstPositiveInt(row, "maxPlayer", "maxPlayers", "playerMax"),
                                currentPlayerCount,
                                playerNames.toString()));
                    }
                }
                callback.onSuccess(rooms);
            } catch (IOException | JSONException exception) {
                String message = exception.getMessage();
                callback.onError(message == null || message.trim().isEmpty()
                        ? "读取房间失败"
                        : message);
            }
        });
    }

    private static int firstPositiveInt(JSONObject row, String... keys) {
        for (String key : keys) {
            Object value = row.opt(key);
            if (value instanceof Number) {
                int result = ((Number) value).intValue();
                if (result > 0) {
                    return result;
                }
            }
            if (value instanceof String) {
                try {
                    int result = Integer.parseInt(((String) value).trim());
                    if (result > 0) {
                        return result;
                    }
                } catch (NumberFormatException ignored) {
                    // Try the next compatible field.
                }
            }
        }
        return 0;
    }

    private static void appendPlayerNames(StringBuilder target, JSONArray names) {
        if (names == null) {
            return;
        }
        for (int index = 0; index < names.length(); index++) {
            Object value = names.opt(index);
            String name = value instanceof JSONObject
                    ? ((JSONObject) value).optString("nickname", "").trim()
                    : String.valueOf(value).trim();
            if (name.isEmpty() || "null".equalsIgnoreCase(name)) {
                continue;
            }
            if (target.length() > 0) {
                target.append("、");
            }
            target.append(name);
        }
    }

    public void shutdown() {
        executor.shutdownNow();
    }

    public void fetchTasks(DmpServer server, TasksCallback callback) {
        if (!hasToken(server, callback::onError)) {
            return;
        }
        executor.execute(() -> {
            try {
                JSONObject response = request(server, "/v3/tasks", "GET", null);
                JSONArray data = response.optJSONArray("data");
                List<DmpTask> tasks = new ArrayList<>();
                if (data != null) {
                    for (int index = 0; index < data.length(); index++) {
                        JSONObject item = data.optJSONObject(index);
                        if (item != null) {
                            tasks.add(DmpTask.fromJson(server, item));
                        }
                    }
                }
                callback.onSuccess(tasks);
            } catch (UnsupportedApiException exception) {
                // Transitional old-DMP endpoint: it exposes just the host update task,
                // while retaining the old platform API for room management.
                try {
                    JSONObject response = request(server, "/v3/platform/manual_update", "GET", null);
                    JSONObject data = response.optJSONObject("data");
                    List<DmpTask> tasks = new ArrayList<>();
                    if (data != null) {
                        tasks.add(DmpTask.fromJson(server, data));
                    }
                    callback.onSuccess(tasks);
                } catch (UnsupportedApiException ignored) {
                    callback.onUnsupported();
                } catch (IOException | JSONException ignored) {
                    callback.onUnsupported();
                }
            } catch (IOException | JSONException exception) {
                callback.onError(errorMessage(exception, "读取任务失败"));
            }
        });
    }

    public void fetchVersion(DmpServer server, VersionCallback callback) {
        if (!hasToken(server, callback::onError)) {
            return;
        }
        executor.execute(() -> {
            try {
                JSONObject response = request(server, "/v3/tasks/version", "GET", null);
                JSONObject data = response.getJSONObject("data");
                callback.onSuccess(new DmpVersion(
                        data.optInt("local", 0),
                        data.optInt("latest", 0),
                        data.optBoolean("supportsTasks", true)));
            } catch (UnsupportedApiException exception) {
                try {
                    JSONObject legacy = request(server, "/v3/platform/game_version", "GET", null);
                    JSONObject data = legacy.getJSONObject("data");
                    callback.onSuccess(new DmpVersion(
                            data.optInt("local", 0),
                            data.optInt("server", 0),
                            false));
                } catch (IOException | JSONException ignored) {
                    callback.onUnsupported();
                }
            } catch (IOException | JSONException exception) {
                callback.onError(errorMessage(exception, "读取版本失败"));
            }
        });
    }

    public void startGameUpdate(DmpServer server, boolean force, UpdateCallback callback) {
        if (!hasToken(server, callback::onError)) {
            return;
        }
        executor.execute(() -> {
            try {
                JSONObject body = new JSONObject().put("force", force);
                JSONObject response = request(server, "/v3/tasks/game-update", "POST", body);
                JSONObject data = response.getJSONObject("data");
                callback.onSuccess(
                        DmpTask.fromJson(server, data.optJSONObject("task")),
                        data.optBoolean("started", false),
                        data.optBoolean("deduplicated", false));
            } catch (UnsupportedApiException exception) {
                try {
                    JSONObject body = new JSONObject().put("force", force);
                    JSONObject response = request(server, "/v3/platform/manual_update", "POST", body);
                    JSONObject data = response.optJSONObject("data");
                    callback.onSuccess(DmpTask.fromJson(server, data),
                            response.optBoolean("started", true),
                            response.optBoolean("deduplicated", false));
                } catch (UnsupportedApiException ignored) {
                    callback.onUnsupported();
                } catch (IOException | JSONException ignored) {
                    callback.onUnsupported();
                }
            } catch (IOException | JSONException exception) {
                callback.onError(errorMessage(exception, "发送更新失败"));
            }
        });
    }

    public void taskAction(DmpServer server, String taskId, String action, TaskActionCallback callback) {
        if (!hasToken(server, callback::onError)) {
            return;
        }
        executor.execute(() -> {
            try {
                String path = "/v3/tasks/" + Uri.encode(taskId)
                        + ("delete".equals(action) ? "" : "/" + action);
                JSONObject response = request(server, path,
                        "delete".equals(action) ? "DELETE" : "POST", null);
                callback.onSuccess(DmpTask.fromJson(server, response.optJSONObject("data")));
            } catch (UnsupportedApiException exception) {
                if (!"delete".equals(action)) {
                    callback.onUnsupported();
                    return;
                }
                try {
                    request(server, "/v3/platform/manual_update", "DELETE", null);
                    callback.onSuccess(DmpTask.fromJson(server, null));
                } catch (UnsupportedApiException ignored) {
                    callback.onUnsupported();
                } catch (IOException | JSONException ignored) {
                    callback.onUnsupported();
                }
            } catch (IOException | JSONException exception) {
                callback.onError(errorMessage(exception, "操作任务失败"));
            }
        });
    }

    private JSONObject request(DmpServer server, String path) throws IOException, JSONException {
        return request(server, path, "GET", null);
    }

    private JSONObject request(
            DmpServer server,
            String path,
            String method,
            JSONObject body) throws IOException, JSONException {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(server.baseUrl() + path).openConnection();
            connection.setRequestMethod(method);
            connection.setConnectTimeout(5000);
            connection.setReadTimeout(7000);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("X-DMP-TOKEN", server.token);
            connection.setRequestProperty("X-I18n-Lang", "zh");
            if (body != null) {
                connection.setDoOutput(true);
                byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
                connection.setFixedLengthStreamingMode(payload.length);
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(payload);
                }
            }
            int status = connection.getResponseCode();
            if (status == HttpURLConnection.HTTP_NOT_FOUND) {
                throw new UnsupportedApiException();
            }
            InputStream stream = status >= 200 && status < 300
                    ? connection.getInputStream()
                    : connection.getErrorStream();
            String responseBody = readBody(stream);
            if (responseBody.isEmpty()) {
                throw new IOException("服务器未返回数据");
            }
            JSONObject response = new JSONObject(responseBody);
            int code = response.optInt("code", response.optInt("status", status));
            if (code != 200) {
                throw new IOException(response.optString("message", "服务器拒绝请求"));
            }
            return response;
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private boolean hasToken(DmpServer server, ErrorConsumer consumer) {
        if (server.token == null || server.token.trim().isEmpty()) {
            consumer.accept("缺少平台令牌");
            return false;
        }
        return true;
    }

    private String errorMessage(Exception exception, String fallback) {
        String message = exception.getMessage();
        return message == null || message.trim().isEmpty() ? fallback : message;
    }

    private interface ErrorConsumer {
        void accept(String message);
    }

    private static class UnsupportedApiException extends IOException {
    }

    private String readBody(InputStream stream) throws IOException {
        if (stream == null) {
            return "";
        }
        StringBuilder builder = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                builder.append(line);
            }
        }
        return builder.toString();
    }

    private double clampPercent(double value) {
        return Math.max(0, Math.min(100, value));
    }
}
