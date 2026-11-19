package cn.xiaojie_gjs.dmp.ui.dmp;

import android.content.Context;

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
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;

/** Small DMP v3 API client used only for server-card monitoring. */
public class DmpApiClient {

    /** Application context used to persist rolling tokens returned by DMP. */
    private final Context applicationContext;

    public interface Callback {
        void onSuccess(DmpMetrics metrics);

        void onError(String message);
    }

    public interface RoomsCallback {
        void onSuccess(List<DmpRoom> rooms);

        void onError(String message);
    }

    /** Result for the community/DST Block blacklist import action. */
    public interface BlocklistImportCallback {
        void onSuccess();

        void onError(String message);
    }

    /** Result of a room-scoped quick action from the aggregate room overview. */
    public interface RoomActionCallback {
        void onSuccess(String message);

        void onUnsupported(String message);

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

    /** Result of probing the DMP release installed on one host. */
    public interface InstalledVersionCallback {
        void onSuccess(String version);

        void onError(String message);
    }

    public interface UpdateCallback {
        void onSuccess(DmpTask task, boolean started, boolean deduplicated);

        void onUnsupported();

        void onError(String message);
    }

    /**
     * Status exposed by old DMP builds which predate the unified task API.
     * Those builds only publish a boolean update flag and the DST version;
     * they do not expose a byte/percentage progress value.
     */
    public interface LegacyUpdateStatusCallback {
        void onSuccess(boolean updating, int localVersion, int latestVersion);

        void onError(String message);
    }

    public interface TaskActionCallback {
        void onSuccess(DmpTask task);

        void onUnsupported();

        void onError(String message);
    }

    private final ExecutorService executor = Executors.newFixedThreadPool(3);
    /**
     * Task snapshots are deliberately isolated from the monitoring pool.
     * A server status request may block while the game process is updating;
     * it must never leave the server cards stuck in STATE_LOADING.
     */
    private final ExecutorService taskExecutor = Executors.newFixedThreadPool(2);
    /** Static Web bundle probes must not occupy the metrics/task workers. */
    private final ExecutorService installedVersionExecutor =
            Executors.newFixedThreadPool(2);

    /**
     * Keep the no-argument constructor for callers which only need an
     * in-memory client (and for old integrations), but the activity should use
     * {@link #DmpApiClient(Context)} so a server-issued token is persisted.
     */
    public DmpApiClient() {
        this(null);
    }

    public DmpApiClient(Context context) {
        applicationContext = context == null ? null : context.getApplicationContext();
    }

    public void fetchMetrics(DmpServer server, Callback callback) {
        if (server.token == null || server.token.trim().isEmpty()) {
            callback.onError("缺少平台令牌");
            return;
        }
        executor.execute(() -> {
            try {
                JSONObject system = request(server, "/v3/dashboard/info/sys");
                JSONObject systemData = system.getJSONObject("data");
                // API 3.2 protects /platform/overview with the administrator
                // role.  A valid monitoring token may still be allowed to
                // read /dashboard/info/sys, so treat the overview as an
                // optional enrichment instead of taking the whole server
                // card offline when only room/world counters are forbidden.
                JSONObject overviewData = new JSONObject();
                try {
                    JSONObject overview = request(server, "/v3/platform/overview");
                    JSONObject data = overview.optJSONObject("data");
                    if (data != null) {
                        overviewData = data;
                    }
                } catch (IOException | JSONException ignored) {
                    // Keep CPU, memory and update status from the system
                    // endpoint; room/world counts intentionally fall back to
                    // zero when the overview route is unavailable.
                }
                // Newer DMP builds expose host totals through /platform/os_info;
                // older builds do not, so this is deliberately optional.
                JSONObject osData = new JSONObject();
                try {
                    JSONObject osInfo = request(server, "/v3/platform/os_info");
                    osData = osInfo.optJSONObject("data");
                    if (osData == null) {
                        osData = new JSONObject();
                    }
                } catch (IOException | JSONException ignored) {
                    // Keep the monitoring card usable on legacy servers.
                }
                int systemCores = firstInt(systemData, "cpuCores", "CPUCores", "cores", "coreCount",
                        "cpu_core_count");
                int osCores = firstInt(osData, "cpuCores", "CPUCores", "cores", "coreCount", "cpu_core_count");
                long systemMemoryTotal = firstLong(systemData, "memorySize", "memoryTotal",
                        "totalMemory", "memory_total", "total_memory");
                long osMemoryTotal = firstLong(osData, "memorySize", "MemorySize", "memoryTotal",
                        "totalMemory", "memory_total", "total_memory");
                callback.onSuccess(new DmpMetrics(
                        clampPercent(systemData.optDouble("cpu", 0)),
                        clampPercent(systemData.optDouble("memory", 0)),
                        overviewData.optInt("roomCount", 0),
                        overviewData.optInt("worldCount", 0),
                        systemCores > 0 ? systemCores : osCores,
                        systemMemoryTotal > 0 ? systemMemoryTotal : osMemoryTotal,
                        systemData.optBoolean("updating", false)));
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
                // The room list's `status` field means that the room can be
                // contacted, not that a DST screen is currently running.
                // Newer servers expose the latter through
                // /platform/screen/running.  Stop probing after the first
                // unsupported response so legacy servers do not incur a
                // timeout for every room.
                boolean screenStatusSupported = true;
                if (rows != null) {
                    for (int index = 0; index < rows.length(); index++) {
                        JSONObject row = rows.optJSONObject(index);
                        if (row == null) {
                            continue;
                        }
                        JSONArray worlds = row.optJSONArray("worlds");
                        int masterWorldId = firstMasterWorldId(worlds);
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
                        boolean running = firstBoolean(row, "running", "screenRunning",
                                "isRunning", "screenStatus");
                        if (screenStatusSupported && row.optInt("id", 0) > 0) {
                            try {
                                running = hasRunningScreen(server, row.optInt("id", 0));
                            } catch (UnsupportedApiException unsupported) {
                                screenStatusSupported = false;
                            } catch (IOException | JSONException ignored) {
                                // Monitoring remains useful when the optional
                                // screen endpoint is denied or transiently
                                // unavailable; retain the room-list fallback
                                // and avoid repeating a failing probe for
                                // every remaining room in this snapshot.
                                screenStatusSupported = false;
                            }
                        }
                        rooms.add(new DmpRoom(
                                server,
                                row.optInt("id", 0),
                                row.optString("gameName", ""),
                                row.optString("gameMode", ""),
                                row.optBoolean("status", false),
                                running,
                                worlds == null ? 0 : worlds.length(),
                                firstPositiveInt(row, "maxPlayer", "maxPlayers", "playerMax"),
                                currentPlayerCount,
                                playerNames.toString(),
                                masterWorldId));
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

    /**
     * Ask the DMP backend to import the public community blacklist for one
     * room.  The backend owns the external DST Block request and writes the
     * de-duplicated UIDs into that room's blocklist file; the Android client
     * deliberately sends only the same small action payload as the desktop
     * client and never contacts the public list directly.
     */
    public void importCommunityBlocklist(
            DmpServer server, int roomId, BlocklistImportCallback callback) {
        if (server == null || roomId <= 0) {
            callback.onError("房间无效");
            return;
        }
        if (!hasToken(server, callback::onError)) {
            return;
        }
        taskExecutor.execute(() -> {
            try {
                JSONObject body = new JSONObject()
                        .put("roomID", roomId)
                        .put("listType", "blocklist")
                        .put("uids", new JSONArray().put(""))
                        .put("actionType", "import");
                request(server, "/v3/player/list", "POST", body);
                callback.onSuccess();
            } catch (UnsupportedApiException exception) {
                callback.onError("当前平台不支持社区黑名单导入");
            } catch (IOException | JSONException exception) {
                callback.onError(errorMessage(exception, "导入社区黑名单失败"));
            }
        });
    }

    /**
     * Execute one of the small, room-scoped controls shown by the native
     * aggregate room overview.  These are the same 3.2 endpoints used by the
     * bundled web client: game lifecycle actions and console commands share
     * /dashboard/exec/game, while a quick backup uses /tools/backup.
     */
    public void executeRoomAction(
            DmpServer server, int roomId, String action, RoomActionCallback callback) {
        executeRoomAction(server, roomId, 0, action, callback);
    }

    public void executeRoomAction(
            DmpServer server, int roomId, int worldId, String action,
            RoomActionCallback callback) {
        if (server == null || roomId <= 0) {
            callback.onError("房间无效");
            return;
        }
        if (!hasToken(server, callback::onError)) {
            return;
        }
        String requested = action == null ? "" : action.trim().toLowerCase(Locale.US);
        if (!("startup".equals(requested) || "shutdown".equals(requested)
                || "backup".equals(requested) || "save".equals(requested)
                || "pause".equals(requested) || "resume".equals(requested))) {
            callback.onError("操作参数无效");
            return;
        }
        taskExecutor.execute(() -> {
            try {
                JSONObject body;
                String path;
                if ("backup".equals(requested)) {
                    path = "/v3/tools/backup";
                    body = new JSONObject().put("roomID", roomId);
                } else {
                    path = "/v3/dashboard/exec/game";
                    String type = "startup";
                    String extra = "all";
                    if ("shutdown".equals(requested)) {
                        type = "shutdown";
                    } else if ("save".equals(requested)) {
                        type = "console";
                        extra = "c_save()";
                    } else if ("pause".equals(requested)) {
                        type = "console";
                        extra = "TheSim:SetTimeScale(0)";
                    } else if ("resume".equals(requested)) {
                        type = "console";
                        extra = "TheSim:SetTimeScale(1)";
                    }
                    body = new JSONObject()
                            .put("type", type)
                            .put("roomID", roomId)
                            .put("worldID", Math.max(0, worldId))
                            .put("extra", extra);
                }
                JSONObject response = request(server, path, "POST", body);
                String message = response.optString("message", "操作成功").trim();
                callback.onSuccess(message.isEmpty() ? "操作成功" : message);
            } catch (UnsupportedApiException exception) {
                callback.onUnsupported("当前平台不支持此操作");
            } catch (IOException | JSONException exception) {
                callback.onError(errorMessage(exception, "操作失败"));
            }
        });
    }

    /**
     * Return whether any world screen is running for a room.  The official
     * web client receives an array of screen names from this route; accept
     * the object/list variants used by a few older deployments as well.
     */
    private boolean hasRunningScreen(DmpServer server, int roomId)
            throws IOException, JSONException {
        JSONObject response = request(server,
                "/v3/platform/screen/running?roomID=" + roomId);
        Object raw = response.opt("data");
        if (raw instanceof JSONArray) {
            return hasNonEmptyScreen((JSONArray) raw);
        }
        if (raw instanceof JSONObject) {
            JSONObject object = (JSONObject) raw;
            JSONArray screens = object.optJSONArray("screens");
            if (screens == null) screens = object.optJSONArray("rows");
            if (screens == null) screens = object.optJSONArray("items");
            if (screens != null) return hasNonEmptyScreen(screens);
            return firstBoolean(object, "running", "status", "isRunning");
        }
        return raw != null && !String.valueOf(raw).trim().isEmpty()
                && !"null".equalsIgnoreCase(String.valueOf(raw).trim());
    }

    private static boolean hasNonEmptyScreen(JSONArray screens) {
        if (screens == null) return false;
        for (int index = 0; index < screens.length(); index++) {
            Object item = screens.opt(index);
            if (item instanceof JSONObject) {
                JSONObject screen = (JSONObject) item;
                if (firstBoolean(screen, "running", "status", "isRunning")) return true;
                String name = screen.optString("name", screen.optString("screen", "")).trim();
                if (!name.isEmpty()) return true;
            } else if (item != null && !String.valueOf(item).trim().isEmpty()) {
                return true;
            }
        }
        return false;
    }

    private static int firstMasterWorldId(JSONArray worlds) {
        if (worlds == null) return 0;
        int first = 0;
        for (int index = 0; index < worlds.length(); index++) {
            JSONObject world = worlds.optJSONObject(index);
            if (world == null) continue;
            int id = firstPositiveInt(world, "id", "ID", "worldID", "worldId");
            if (first <= 0 && id > 0) first = id;
            String name = world.optString("name", world.optString("worldName", "")).trim();
            boolean master = firstBoolean(world, "master", "isMaster", "primary");
            if (master || "master".equalsIgnoreCase(name)) return id;
        }
        return first;
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

    private static int firstInt(JSONObject object, String... keys) {
        for (String key : keys) {
            Object value = object.opt(key);
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

    private static long firstLong(JSONObject object, String... keys) {
        for (String key : keys) {
            Object value = object.opt(key);
            if (value instanceof Number) {
                return ((Number) value).longValue();
            }
            if (value instanceof String) {
                try {
                    return Long.parseLong(((String) value).trim());
                } catch (NumberFormatException ignored) {
                    // Try the next compatible field.
                }
            }
        }
        return 0;
    }

    public void shutdown() {
        executor.shutdownNow();
        taskExecutor.shutdownNow();
    }

    public void fetchTasks(DmpServer server, TasksCallback callback) {
        fetchTasks(server, null, callback);
    }

    /**
     * Fetch live task progress using the routes that are actually present in
     * DMP 3.2.0.  The 3.2 server deliberately has no unified native task-list
     * endpoint: the Android bridge persists the WebView task metadata and we
     * refresh each mod through {@code /v3/mod/download/status}; host updates
     * are refreshed through {@code /v3/dashboard/info/sys}.  Keeping this
     * method as the public task callback preserves the existing UI contract.
     */
    public void fetchTasks(
            DmpServer server,
            JSONArray persistedWebTasks,
            TasksCallback callback) {
        if (!hasToken(server, callback::onError)) {
            return;
        }
        taskExecutor.execute(() -> {
            try {
                List<DmpTask> tasks = readLiveWebTasks(server, persistedWebTasks);
                callback.onSuccess(tasks);
            } catch (UnsupportedApiException exception) {
                callback.onUnsupported();
            } catch (IOException | JSONException exception) {
                callback.onError(errorMessage(exception, "读取下载进度失败"));
            }
        });
    }

    /** Resolve the current status of every persisted 3.2.0 WebView task. */
    private List<DmpTask> readLiveWebTasks(
            DmpServer server,
            JSONArray persistedWebTasks) throws IOException, JSONException {
        if (persistedWebTasks == null || persistedWebTasks.length() == 0) {
            return Collections.emptyList();
        }
        List<DmpTask> result = new ArrayList<>();
        boolean needsSystemStatus = false;
        for (int index = 0; index < persistedWebTasks.length(); index++) {
            JSONObject item = persistedWebTasks.optJSONObject(index);
            if (item == null) {
                continue;
            }
            String type = firstString(item, "type", "taskType").toLowerCase(java.util.Locale.US);
            if ("transfer".equals(type) || "native_transfer".equals(type)) {
                // Android DownloadManager transfers are merged by DmpActivity.
                continue;
            }
            if ("game_update".equals(type) || "server_update".equals(type)
                    || item.optBoolean("__androidGameUpdate", false)) {
                needsSystemStatus = true;
                continue;
            }
            int roomId = firstInt(item, "roomID", "roomId", "room_id");
            int modId = firstInt(item, "modID", "modId", "mod_id");
            // A few WebView task snapshots use id as the mod id while still
            // retaining a descriptive taskID.  Do not use a synthetic task id
            // as a status query parameter.
            if (modId <= 0) {
                int candidate = firstInt(item, "id");
                if (candidate > 0 && roomId > 0) {
                    modId = candidate;
                }
            }
            if (roomId <= 0 || modId <= 0) {
                // A mod row without both identifiers cannot be refreshed or
                // acted on through the 3.2 API. Treat it as a stale WebView
                // placeholder and omit it rather than showing an unremovable
                // task forever in the aggregate download centre.
                continue;
            }
            String path = "/v3/mod/download/status?roomID=" + roomId + "&id=" + modId;
            JSONObject normalized = new JSONObject(item.toString());
            normalized.put("roomID", roomId);
            normalized.put("modID", modId);
            String oldStatus = firstString(item, "status", "state").toLowerCase(java.util.Locale.US);
            try {
                JSONObject response = request(server, path, "GET", null);
                int progress = parseProgress(response);
                normalized.put("progress", progress);
                // The backend intentionally reports 0 while SteamCMD is
                // preparing a mod archive. Keep a queued 0.0% row explicit,
                // but mark an already-running 0 as indeterminate so the
                // mobile queue shows activity instead of a frozen bar.
                boolean queued = "queued".equals(oldStatus) || "pending".equals(oldStatus)
                        || "waiting".equals(oldStatus);
                normalized.put("progressKnown", progress > 0 || progress >= 100 || queued);
                if (progress >= 100) {
                    if (isModDownloaded(server, roomId, modId)) {
                        normalized.put("status", "success");
                        normalized.put("stage", "completed");
                        if (!item.has("finishedAt")) {
                            normalized.put("finishedAt", System.currentTimeMillis());
                        }
                    } else {
                        // The worker reached 100% but the archive is not yet
                        // visible in the room's downloaded-mod index. Keep a
                        // short verification state instead of lying that the
                        // file is ready.
                        normalized.put("status", "downloading");
                        normalized.put("stage", "verifying");
                        normalized.put("progress", 99);
                        normalized.put("progressKnown", true);
                        normalized.put("message", "正在确认模组文件");
                    }
                } else if ("paused".equals(oldStatus) || "pause_pending".equals(oldStatus)
                        || "pausepending".equals(oldStatus)) {
                    normalized.put("status", oldStatus);
                    normalized.put("stage", "paused");
                } else {
                    // Never preserve a terminal cached status when the live
                    // endpoint is below 100%.  That stale value was the
                    // source of “下载完成” rows whose file was not present.
                    boolean staleTerminal = isTerminalStatus(oldStatus);
                    normalized.put("status", oldStatus.isEmpty() || "unknown".equals(oldStatus)
                            || staleTerminal ? "downloading" : oldStatus);
                    // A queued item with a zero status is still waiting for
                    // SteamCMD to start. Keep the compact “等待中 · 0.0%”
                    // presentation instead of repeating “等待中 · 下载”.
                    boolean waiting = progress <= 0
                            && ("queued".equals(oldStatus)
                            || "pending".equals(oldStatus)
                            || "waiting".equals(oldStatus));
                    normalized.put("stage", waiting ? "waiting" : "downloading");
                }
            } catch (UnsupportedApiException exception) {
                throw exception;
            } catch (IOException | JSONException ignored) {
                // Keep the cached state visible during a transient poll error.
                // The next aggregate refresh retries this row.
                normalized.put("status", oldStatus.isEmpty() || "unknown".equals(oldStatus)
                        || isTerminalStatus(oldStatus) ? "downloading" : oldStatus);
                normalized.put("stage", "downloading");
            }
            normalized.put("updatedAt", System.currentTimeMillis());
            result.add(DmpTask.fromJson(server, normalized));
        }

        if (needsSystemStatus) {
            JSONObject system = request(server, "/v3/dashboard/info/sys", "GET", null);
            JSONObject data = system.optJSONObject("data");
            if (data == null) data = new JSONObject();
            boolean updating = firstBoolean(data, "updating", "isUpdating", "updateInProgress");
            for (int index = 0; index < persistedWebTasks.length(); index++) {
                JSONObject item = persistedWebTasks.optJSONObject(index);
                if (item == null) continue;
                String type = firstString(item, "type", "taskType").toLowerCase(java.util.Locale.US);
                if (!("game_update".equals(type) || "server_update".equals(type)
                        || item.optBoolean("__androidGameUpdate", false))) continue;
                JSONObject normalized = new JSONObject(item.toString());
                boolean observed = item.optBoolean("serverUpdateObserved", false) || updating;
                normalized.put("serverUpdateObserved", observed);
                normalized.put("serverLastUpdating", updating);
                if (updating) {
                    normalized.put("status", "running");
                    normalized.put("stage", "updating");
                    normalized.put("progress", 0);
                } else if (observed && !isTerminalStatus(firstString(item, "status", "state"))) {
                    normalized.put("status", "success");
                    normalized.put("stage", "completed");
                    normalized.put("progress", 100);
                    if (!item.has("finishedAt")) normalized.put("finishedAt", System.currentTimeMillis());
                }
                normalized.put("updatedAt", System.currentTimeMillis());
                result.add(DmpTask.fromJson(server, normalized));
            }
        }
        return result;
    }

    private static int parseProgress(JSONObject response) {
        if (response == null) return 0;
        Object value = response.opt("data");
        if (value instanceof JSONObject) {
            JSONObject data = (JSONObject) value;
            value = data.opt("progress");
            if (value == null) value = data.opt("percentage");
            if (value == null) value = data.opt("percent");
        }
        double parsed = 0;
        if (value instanceof Number) parsed = ((Number) value).doubleValue();
        else if (value != null) {
            try { parsed = Double.parseDouble(String.valueOf(value).replace("%", "").trim()); }
            catch (NumberFormatException ignored) { }
        }
        if (parsed >= 0 && parsed <= 1) parsed *= 100;
        return (int) Math.max(0, Math.min(100, Math.round(parsed)));
    }

    /** Verify the archive is present in the server's downloaded-mod index. */
    private boolean isModDownloaded(DmpServer server, int roomId, int modId)
            throws IOException, JSONException {
        try {
            JSONObject response = request(server,
                    "/v3/mod/downloaded/ids?roomID=" + roomId, "GET", null);
            Object raw = response.opt("data");
            if (!(raw instanceof JSONArray)) {
                return true; // Transitional host: status=100 remains authoritative.
            }
            JSONArray ids = (JSONArray) raw;
            for (int index = 0; index < ids.length(); index++) {
                Object value = ids.opt(index);
                int candidate = value instanceof JSONObject
                        ? ((JSONObject) value).optInt("id",
                        ((JSONObject) value).optInt("modID", 0))
                        : ids.optInt(index, 0);
                if (candidate == modId) return true;
            }
            return false;
        } catch (UnsupportedApiException unsupported) {
            return true;
        }
    }

    private static boolean isTerminalStatus(String status) {
        String value = status == null ? "" : status.toLowerCase(java.util.Locale.US);
        return "success".equals(value) || "complete".equals(value) || "completed".equals(value)
                || "done".equals(value) || "failed".equals(value) || "error".equals(value)
                || "cancelled".equals(value) || "canceled".equals(value);
    }

    private static String firstString(JSONObject json, String... keys) {
        for (String key : keys) {
            String value = json.optString(key, "").trim();
            if (!value.isEmpty() && !"null".equalsIgnoreCase(value)) return value;
        }
        return "";
    }

    public void fetchVersion(DmpServer server, VersionCallback callback) {
        if (!hasToken(server, callback::onError)) {
            return;
        }
        executor.execute(() -> {
            try {
                // DMP 3.2 exposes the game version through this route.  The
                // old task-version/manual-update probes were never part of
                // the 3.2 server and only added latency (or failed when a
                // proxy returned a non-JSON 200 response).
                JSONObject response = request(server, "/v3/platform/game_version", "GET", null);
                JSONObject data = response.optJSONObject("data");
                if (data == null) {
                    data = new JSONObject();
                }
                int local = firstVersionInt(data, "local", "localVersion", "current");
                int latest = firstVersionInt(data, "server", "latest", "serverVersion", "targetVersion");
                // /mod/download/status is present in 3.2 and returns a valid
                // zero percentage even when the requested item is not in the
                // cache.  roomID/id are therefore deliberately positive but
                // otherwise harmless capability-probe values.
                boolean modernApi = supportsDmp320Api(server);
                callback.onSuccess(new DmpVersion(local, latest, modernApi, modernApi));
            } catch (UnsupportedApiException exception) {
                // A host without the 3.2 contract remains visible, but its
                // single-server update action is disabled by the existing UI.
                // (The version request itself may have been the unsupported
                // call, so there is no reliable local/latest pair here.)
                callback.onSuccess(new DmpVersion(0, 0, false, false));
            } catch (IOException | JSONException exception) {
                callback.onError(errorMessage(exception, "读取版本失败"));
            }
        });
    }

    /**
     * Read the DMP release installed on a host.  DMP's public
     * {@code /platform/game_version} endpoint is for the DST game build, not
     * the platform release.  The release shown in the official Web top bar is
     * compiled into the Web bundle, so probe the host's static index and its
     * hashed config module first.  Do not fall back to
     * {@code /v3/tasks/version}: that legacy route reports DST game-update
     * local/latest values, not the DMP release installed on the host.
     */
    public void fetchInstalledDmpVersion(
            DmpServer server,
            InstalledVersionCallback callback) {
        if (server == null || callback == null) {
            return;
        }
        installedVersionExecutor.execute(() -> {
            try {
                String version = "";
                String staticError = "";
                try {
                    String index;
                    try {
                        index = requestText(server, "/");
                    } catch (IOException rootException) {
                        // Some reverse proxies do not map `/` to the static
                        // index even though `/index.html` is available.
                        index = requestText(server, "/index.html");
                    }
                    String configPath = extractConfigAssetPath(index);
                    if (!configPath.isEmpty()) {
                        version = extractDmpVersion(requestText(server, configPath));
                    }
                    if (version.isEmpty()) {
                        // Older Vite builds did not preload config.js; walk
                        // the main module once so its import can reveal the
                        // same config asset.
                        String mainPath = extractMainAssetPath(index);
                        if (!mainPath.isEmpty()) {
                            String main = requestText(server, mainPath);
                            configPath = extractConfigAssetPath(main);
                            if (configPath.isEmpty()) {
                                configPath = extractImportedConfigAssetPath(main);
                            }
                            if (!configPath.isEmpty()) {
                                version = extractDmpVersion(requestText(server, configPath));
                            }
                            // Only use an explicit Version assignment in the
                            // main bundle; generic semver literals there may
                            // belong to a third-party dependency.
                            if (version.isEmpty()) {
                                version = extractAssignedDmpVersion(main);
                            }
                        }
                    }
                    // A few old builds put the version directly in the HTML
                    // rather than in a hashed config module.
                    if (version.isEmpty()) {
                        version = extractDmpVersion(index);
                    }
                } catch (IOException exception) {
                    staticError = exception.getMessage() == null
                            ? "静态网页版本不可用" : exception.getMessage();
                }
                if (version.isEmpty()) {
                    throw new IOException(staticError.isEmpty()
                            ? "服务器未返回 DMP 安装版本" : staticError);
                }
                callback.onSuccess(version);
            } catch (IOException exception) {
                callback.onError(errorMessage(exception, "读取 DMP 安装版本失败"));
            }
        });
    }

    private boolean supportsDmp320Api(DmpServer server)
            throws IOException, JSONException {
        try {
            request(server, "/v3/mod/download/status?roomID=1&id=1", "GET", null);
            return true;
        } catch (UnsupportedApiException unsupported) {
            return false;
        }
    }

    private static int firstVersionInt(JSONObject data, String... keys) {
        for (String key : keys) {
            Object value = data.opt(key);
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

    public void startGameUpdate(DmpServer server, boolean force, UpdateCallback callback) {
        if (!hasToken(server, callback::onError)) {
            return;
        }
        // The 3.2 API accepts a room-scoped dashboard update and runs the
        // SteamCMD operation asynchronously on the host.  The old task and
        // manual-update routes are not part of this contract.
        executor.execute(() -> startDmp320DashboardUpdate(server, callback));
    }

    /** Submit the 3.2.0 room-scoped dashboard update action. */
    private void startDmp320DashboardUpdate(DmpServer server, UpdateCallback callback) {
        try {
            int roomId = firstRoomId(request(server, "/v3/room/list?page=1&pageSize=1"));
            if (roomId <= 0) {
                callback.onUnsupported();
                return;
            }
            JSONObject body = new JSONObject()
                    .put("type", "update")
                    .put("roomID", roomId)
                    .put("worldID", 0)
                    .put("extra", "all");
            request(server, "/v3/dashboard/exec/game", "POST", body);
            JSONObject task = new JSONObject()
                    // Keep the same deterministic key as the WebView bridge
                    // so a native-triggered update is restored and polled by
                    // the existing per-server legacy state machine.
                    .put("taskID", "game_update:" + server.id)
                    .put("type", "game_update")
                    .put("name", "DMP 3.2.0 服务器更新")
                    .put("status", "running")
                    .put("stage", "updating")
                    .put("progress", 0)
                    .put("message", "服务器正在更新（无百分比进度）")
                    .put("updatedAt", System.currentTimeMillis());
            callback.onSuccess(DmpTask.fromJson(server, task), true, false);
        } catch (UnsupportedApiException exception) {
            callback.onUnsupported();
        } catch (IOException | JSONException exception) {
            callback.onError(errorMessage(exception, "发送更新失败"));
        }
    }

    /**
     * Poll the two read-only endpoints available on legacy DMP deployments.
     * The old dashboard update handler returns immediately while SteamCMD
     * continues in a goroutine, so polling only the POST response leaves the
     * Android task at 0% forever.  This method deliberately does not invent a
     * percentage: callers can show an indeterminate update state until the
     * server reports that the update has finished.
     */
    public void fetchLegacyUpdateStatus(
            DmpServer server,
            LegacyUpdateStatusCallback callback) {
        if (!hasToken(server, callback::onError)) {
            return;
        }
        executor.execute(() -> {
            try {
                JSONObject system = request(server, "/v3/dashboard/info/sys", "GET", null);
                JSONObject systemData = system.optJSONObject("data");
                if (systemData == null) {
                    systemData = new JSONObject();
                }
                boolean updating = firstBoolean(systemData, "updating", "isUpdating", "updateInProgress");

                int local = 0;
                int latest = 0;
                try {
                    JSONObject version = request(server, "/v3/platform/game_version", "GET", null);
                    JSONObject versionData = version.optJSONObject("data");
                    if (versionData != null) {
                        local = firstVersionInt(versionData, "local", "localVersion", "current");
                        latest = firstVersionInt(versionData, "server", "latest", "serverVersion", "targetVersion");
                    }
                } catch (IOException | JSONException ignored) {
                    // The update flag is still useful if the version endpoint
                    // is temporarily unavailable while SteamCMD is running.
                }
                callback.onSuccess(updating, local, latest);
            } catch (IOException | JSONException exception) {
                callback.onError(errorMessage(exception, "读取旧版更新状态失败"));
            }
        });
    }

    private static int firstRoomId(JSONObject response) {
        if (response == null) return 0;
        Object rawData = response.opt("data");
        JSONArray rows = rawData instanceof JSONArray ? (JSONArray) rawData : null;
        JSONObject data = rawData instanceof JSONObject ? (JSONObject) rawData : null;
        if (rows == null && data != null) {
            rows = data.optJSONArray("rows");
            if (rows == null) rows = data.optJSONArray("rooms");
            if (rows == null) rows = data.optJSONArray("items");
            if (rows == null) rows = data.optJSONArray("list");
        }
        if (rows == null) return 0;
        for (int index = 0; index < rows.length(); index++) {
            JSONObject row = rows.optJSONObject(index);
            if (row != null && row.optInt("id", 0) > 0) {
                return row.optInt("id", 0);
            }
        }
        return 0;
    }

    private static boolean firstBoolean(JSONObject object, String... keys) {
        for (String key : keys) {
            Object value = object.opt(key);
            if (value instanceof Boolean) {
                return (Boolean) value;
            }
            if (value instanceof Number) {
                return ((Number) value).intValue() != 0;
            }
            if (value instanceof String) {
                String text = ((String) value).trim();
                if ("true".equalsIgnoreCase(text) || "1".equals(text)
                        || "yes".equalsIgnoreCase(text)) {
                    return true;
                }
                if ("false".equalsIgnoreCase(text) || "0".equals(text)
                        || "no".equalsIgnoreCase(text)) {
                    return false;
                }
            }
        }
        return false;
    }

    public void taskAction(DmpServer server, String taskId, String action, TaskActionCallback callback) {
        if (!hasToken(server, callback::onError)) {
            return;
        }
        if (taskId == null || taskId.trim().isEmpty()
                || action == null || action.trim().isEmpty()) {
            callback.onError("任务参数无效");
            return;
        }
        // DMP 3.2 owns no server-side task-action endpoint.  Mod controls are
        // applied to the persisted WebView queue by DmpJavascriptBridge, and
        // terminal rows are dismissed locally by DmpActivity.  Keep this
        // callback for the existing Java UI contract without issuing doomed
        // requests to routes that do not exist.
        executor.execute(callback::onUnsupported);
    }

    /**
     * Submit a fresh native mod download for a terminal WebView task.
     *
     * DMP 3.2 does not expose the old generic task-action endpoint.  Its
     * supported retry operation is the same POST used by the catalogue page,
     * so keep this request explicit instead of routing it through
     * {@link #taskAction(DmpServer, String, String, TaskActionCallback)}.
     */
    public void retryModDownload(DmpTask task, TaskActionCallback callback) {
        if (task == null || task.server == null) {
            callback.onError("任务参数无效");
            return;
        }
        DmpServer server = task.server;
        if (!hasToken(server, callback::onError)) {
            return;
        }
        if (!"mod_download".equalsIgnoreCase(task.type)
                || task.roomId <= 0 || task.modId <= 0) {
            callback.onError("模组下载参数无效");
            return;
        }
        executor.execute(() -> {
            try {
                long requestSize = task.totalBytes > 0L
                        ? task.totalBytes : Math.max(0L, task.completedBytes);
                // The upstream handler declares size as a string (even though
                // the browser may originate it from a numeric serverSize).
                // Sending the canonical string keeps both old and new DMP
                // builds compatible with encoding/json.
                JSONObject body = new JSONObject()
                        .put("roomID", task.roomId)
                        .put("id", task.modId)
                        .put("file_url", task.fileUrl == null ? "" : task.fileUrl)
                        .put("update", task.update)
                        .put("name", task.name == null ? "" : task.name)
                        .put("size", String.valueOf(requestSize));
                JSONObject response = request(server, "/v3/mod/download", "POST", body);
                JSONObject replacement = response.optJSONObject("data");
                if (replacement == null) {
                    replacement = new JSONObject();
                } else {
                    replacement = new JSONObject(replacement.toString());
                }
                // The 3.2 endpoint acknowledges an asynchronously queued job
                // with data=null.  Synthesize the same stable task shape used
                // by the WebView bridge so the all-platform card immediately
                // changes back to an active download while status polling
                // takes over.
                if (!replacement.has("taskID")) {
                    replacement.put("taskID", task.taskId == null || task.taskId.trim().isEmpty()
                            ? "mod:" + server.id + ":" + task.roomId + ":" + task.modId
                            : task.taskId);
                }
                replacement.put("type", "mod_download");
                replacement.put("roomID", task.roomId);
                replacement.put("modID", task.modId);
                replacement.put("name", task.name == null ? "" : task.name);
                replacement.put("file_url", task.fileUrl == null ? "" : task.fileUrl);
                replacement.put("update", task.update);
                if (task.totalBytes > 0L) {
                    replacement.put("totalBytes", task.totalBytes);
                }
                replacement.put("status", "queued");
                replacement.put("stage", "queued");
                replacement.put("progress", 0);
                replacement.put("progressKnown", false);
                replacement.put("updatedAt", System.currentTimeMillis());
                callback.onSuccess(DmpTask.fromJson(server, replacement));
            } catch (UnsupportedApiException exception) {
                callback.onUnsupported();
            } catch (IOException | JSONException exception) {
                callback.onError(errorMessage(exception, "发送模组重下失败"));
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
            // Never follow a server-controlled redirect automatically.  DMP
            // credentials are sent in X-DMP-TOKEN; refusing redirects keeps a
            // compromised/misconfigured HTTP endpoint from forwarding that
            // header to another host.  The configured server URL must be the
            // final API origin (HTTPS is recommended).
            connection.setInstanceFollowRedirects(false);
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
            // DMP rotates the token while a session is active.  Read the
            // header before consuming the body so both successful responses
            // and JSON business errors (for example code=420) can refresh the
            // native server record for the next request.
            updateServerToken(server, connection.getHeaderField("X-DMP-NEW-TOKEN"));
            if (status == HttpURLConnection.HTTP_NOT_FOUND
                    || status == HttpURLConnection.HTTP_BAD_METHOD) {
                throw new UnsupportedApiException();
            }
            // A future action endpoint may acknowledge with 204 and no JSON
            // body. Treat it as a successful empty response.
            if (status == HttpURLConnection.HTTP_NO_CONTENT) {
                return new JSONObject().put("code", 200);
            }
            InputStream stream = status >= 200 && status < 300
                    ? connection.getInputStream()
                    : connection.getErrorStream();
            String responseBody = readBody(stream);
            if (responseBody.isEmpty()) {
                if (status >= 200 && status < 300) {
                    return new JSONObject().put("code", 200);
                }
                throw new IOException("服务器未返回数据");
            }
            JSONObject response = new JSONObject(responseBody);
            int code = response.optInt("code", response.optInt("status", status));
            // Gin deployments sometimes return a JSON 404/405 with HTTP 200.
            // Treat those exactly like a missing route.
            if (code == 404 || code == 405 || status == 404 || status == 405) {
                throw new UnsupportedApiException();
            }
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

    /** Fetch a non-JSON static resource such as the host's Web index/config. */
    private String requestText(DmpServer server, String path) throws IOException {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(server.baseUrl() + path).openConnection();
            connection.setRequestMethod("GET");
            // Static version/config probes carry the same server token.  Do
            // not let an HTTP 3xx response move it to an untrusted origin.
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(5000);
            connection.setReadTimeout(7000);
            connection.setRequestProperty("Accept", "text/html,application/javascript,*/*");
            // The API server's gzip middleware also wraps static HTML/JS.
            // Request plain text here because HttpURLConnection does not
            // transparently decompress a gzip response on all Android API
            // levels, and compressed bytes cannot be regex-scanned safely.
            connection.setRequestProperty("Accept-Encoding", "identity");
            if (server.token != null && !server.token.trim().isEmpty()) {
                connection.setRequestProperty("X-DMP-TOKEN", server.token);
            }
            int status = connection.getResponseCode();
            if (status == HttpURLConnection.HTTP_NOT_FOUND
                    || status == HttpURLConnection.HTTP_BAD_METHOD) {
                throw new UnsupportedApiException();
            }
            InputStream stream = status >= 200 && status < 300
                    ? connection.getInputStream() : connection.getErrorStream();
            if (stream != null && "gzip".equalsIgnoreCase(connection.getContentEncoding())) {
                stream = new GZIPInputStream(stream);
            }
            String responseBody = readBody(stream);
            if (status < 200 || status >= 300) {
                throw new IOException("服务器返回 HTTP " + status);
            }
            return responseBody;
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private static final Pattern CONFIG_ASSET_PATTERN = Pattern.compile(
            "(?i)(?:\\./)?(assets/[^\\\"'\\s>]*config[^\\\"'\\s>]*\\.js(?:\\?[^\\\"'\\s>]*)?)");
    private static final Pattern MAIN_ASSET_PATTERN = Pattern.compile(
            "(?i)(?:\\./)?(assets/index[^\\\"'\\s>]*\\.js(?:\\?[^\\\"'\\s>]*)?)");
    private static final Pattern IMPORTED_CONFIG_ASSET_PATTERN = Pattern.compile(
            "(?i)(?:\\./)?(config[^\\\"'\\s>]*\\.js(?:\\?[^\\\"'\\s>]*)?)");
    private static final Pattern VERSION_ASSIGNMENT_PATTERN = Pattern.compile(
            "(?i)\\bversion\\s*[:=]\\s*[`\\\"']?\\s*(v?\\d+(?:\\.\\d+){2}(?:[-+][a-z0-9._-]+)?)");
    private static final Pattern VERSION_LITERAL_PATTERN = Pattern.compile(
            "(?<![a-z0-9.])v?\\d+(?:\\.\\d+){2}(?:[-+][a-z0-9._-]+)?(?![a-z0-9.])",
            Pattern.CASE_INSENSITIVE);

    private static String extractConfigAssetPath(String html) {
        if (html == null || html.isEmpty()) {
            return "";
        }
        Matcher matcher = CONFIG_ASSET_PATTERN.matcher(html);
        if (!matcher.find()) {
            return "";
        }
        String path = matcher.group(1);
        int queryStart = path.indexOf('?');
        if (queryStart >= 0) {
            path = path.substring(0, queryStart);
        }
        return path.startsWith("/") ? path : "/" + path;
    }

    private static String extractMainAssetPath(String html) {
        if (html == null || html.isEmpty()) {
            return "";
        }
        Matcher matcher = MAIN_ASSET_PATTERN.matcher(html);
        if (!matcher.find()) {
            return "";
        }
        String path = matcher.group(1);
        int queryStart = path.indexOf('?');
        if (queryStart >= 0) {
            path = path.substring(0, queryStart);
        }
        return path.startsWith("/") ? path : "/" + path;
    }

    private static String extractImportedConfigAssetPath(String source) {
        if (source == null || source.isEmpty()) {
            return "";
        }
        Matcher matcher = IMPORTED_CONFIG_ASSET_PATTERN.matcher(source);
        if (!matcher.find()) {
            return "";
        }
        String path = matcher.group(1);
        int queryStart = path.indexOf('?');
        if (queryStart >= 0) {
            path = path.substring(0, queryStart);
        }
        return "/assets/" + path;
    }

    private static String extractDmpVersion(String text) {
        if (text == null || text.isEmpty()) {
            return "";
        }
        Matcher assignment = VERSION_ASSIGNMENT_PATTERN.matcher(text);
        if (assignment.find()) {
            return normalizeDmpVersion(assignment.group(1));
        }
        Matcher literal = VERSION_LITERAL_PATTERN.matcher(text);
        if (literal.find()) {
            return normalizeDmpVersion(literal.group());
        }
        return "";
    }

    private static String extractAssignedDmpVersion(String text) {
        if (text == null || text.isEmpty()) {
            return "";
        }
        Matcher assignment = VERSION_ASSIGNMENT_PATTERN.matcher(text);
        return assignment.find() ? normalizeDmpVersion(assignment.group(1)) : "";
    }

    private static String normalizeDmpVersion(String value) {
        String normalized = value == null ? "" : value.trim();
        if (normalized.isEmpty()) {
            return "";
        }
        // Do not turn a numeric DST build (for example 762172 from an old
        // JSON route) into a fake DMP release such as v762172.
        if (!VERSION_LITERAL_PATTERN.matcher(normalized).matches()) {
            return "";
        }
        if (!normalized.toLowerCase(Locale.US).startsWith("v")) {
            normalized = "v" + normalized;
        }
        return normalized;
    }

    /** Update the in-memory server and persist a token returned by DMP. */
    private void updateServerToken(DmpServer server, String candidate) {
        if (server == null || candidate == null) {
            return;
        }
        String refreshed = candidate.trim();
        if (refreshed.isEmpty() || refreshed.length() > 4096) {
            return;
        }
        synchronized (server) {
            if (refreshed.equals(server.token)) {
                return;
            }
            server.token = refreshed;
        }
        if (applicationContext == null || server.id == null || server.id.trim().isEmpty()) {
            return;
        }
        // DmpServerStore serializes the complete server list, so update only
        // the matching record and leave all other hosts untouched.
        DmpServerStore store = new DmpServerStore(applicationContext);
        List<DmpServer> savedServers = store.load();
        boolean changed = false;
        for (DmpServer saved : savedServers) {
            if (saved != null && server.id.equals(saved.id)) {
                if (!refreshed.equals(saved.token)) {
                    saved.token = refreshed;
                    changed = true;
                }
                break;
            }
        }
        if (changed) {
            store.save(savedServers);
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
