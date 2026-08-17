package cn.xiaojie_gjs.bianjiemj.ui.dmp;

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
    public transient String statusMessage = "";

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
        return json;
    }

    public static DmpServer fromJson(JSONObject json) {
        return new DmpServer(
                json.optString("id"),
                json.optString("host"),
                json.optInt("port", 80),
                json.optString("protocol", "http"),
                json.optString("token"),
                json.optString("remark"));
    }
}
