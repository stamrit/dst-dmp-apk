package cn.xiaojie_gjs.dmp.ui.dmp;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.UUID;

/** A locally saved DMP server entry plus transient monitoring state. */
public class DmpServer {

    public static final int STATE_IDLE = 0;
    public static final int STATE_LOADING = 1;
    public static final int STATE_ONLINE = 2;
    public static final int STATE_OFFLINE = 3;

    public String id;
    public String host;
    public int port;
    public String protocol;
    public String token;
    public String remark;

    public transient int state = STATE_IDLE;
    public transient double cpu = 0;
    public transient double memory = 0;
    public transient int roomCount = 0;
    public transient int worldCount = 0;
    public transient int cpuCores = 0;
    public transient long memoryTotalBytes = 0;
    public transient boolean updating = false;
    public transient String statusMessage = "";
    /** Last room selected while entering this host from platform management. */
    public transient int selectedRoomId = 0;
    public transient String selectedRoomName = "";
    /** Transient DMP version snapshot used by the platform card. */
    public transient int dmpLocalVersion = 0;
    public transient int dmpLatestVersion = 0;
    public transient boolean dmpVersionKnown = false;
    /**
     * DMP platform version reported by this host's installed Web bundle.
     * This is intentionally server-scoped: different hosts may still run
     * different DMP releases.  An empty value means it has not been read (or
     * the host did not expose a readable Web/version endpoint).
     */
    public transient String dmpInstalledVersion = "";
    /** Monotonic time of the last installed-version probe. */
    public transient long dmpInstalledVersionCheckedAt = 0L;
    /** Guards against overlapping static bundle probes during refresh. */
    public transient boolean dmpInstalledVersionProbeRunning = false;

    public DmpServer(
            String id,
            String host,
            int port,
            String protocol,
            String token,
            String remark) {
        this.id = id == null || id.trim().isEmpty() ? UUID.randomUUID().toString() : id;
        this.host = host == null ? "" : host.trim();
        this.port = port;
        this.protocol = "https".equalsIgnoreCase(protocol) ? "https" : "http";
        this.token = token == null ? "" : token.trim();
        this.remark = remark == null ? "" : remark.trim();
    }

    public String baseUrl() {
        return protocol + "://" + host + ":" + port;
    }

    public JSONObject toJson() throws JSONException {
        JSONObject json = new JSONObject();
        json.put("id", id);
        json.put("host", host);
        json.put("port", port);
        json.put("protocol", protocol);
        json.put("token", token);
        json.put("remark", remark);
        json.put("selectedRoomID", selectedRoomId);
        json.put("selectedRoomName", selectedRoomName);
        return json;
    }

    public static DmpServer fromJson(JSONObject json) {
        DmpServer server = new DmpServer(
                json.optString("id"),
                json.optString("host"),
                json.optInt("port", 80),
                json.optString("protocol", "http"),
                json.optString("token"),
                json.optString("remark"));
        server.selectedRoomId = json.optInt("selectedRoomID", json.optInt("selectedRoomId", 0));
        server.selectedRoomName = json.optString("selectedRoomName", "");
        return server;
    }
}
