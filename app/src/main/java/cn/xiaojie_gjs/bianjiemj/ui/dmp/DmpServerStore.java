package cn.xiaojie_gjs.bianjiemj.ui.dmp;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONException;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** Persists DMP server cards locally. This preference file is excluded from backups. */
public class DmpServerStore {

    public static final String PREFS_NAME = "dmp_server_store";
    private static final String KEY_SERVERS = "servers";
    private static final String LEGACY_PREFS_NAME = "dmp_preferences";
    private static final String LEGACY_KEY_URL = "server_url";

    private final Context context;

    public DmpServerStore(Context context) {
        this.context = context.getApplicationContext();
    }

    public List<DmpServer> load() {
        SharedPreferences preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String raw = preferences.getString(KEY_SERVERS, "");
        List<DmpServer> servers = new ArrayList<>();
        if (raw != null && !raw.isEmpty()) {
            try {
                JSONArray array = new JSONArray(raw);
                for (int index = 0; index < array.length(); index++) {
                    servers.add(DmpServer.fromJson(array.getJSONObject(index)));
                }
            } catch (JSONException ignored) {
                servers.clear();
            }
        }
        if (servers.isEmpty()) {
            DmpServer migrated = migrateLegacyServer();
            if (migrated != null) {
                servers.add(migrated);
                save(servers);
            }
        }
        return servers;
    }

    public void save(List<DmpServer> servers) {
        JSONArray array = new JSONArray();
        for (DmpServer server : servers) {
            try {
                array.put(server.toJson());
            } catch (JSONException ignored) {
                // All model values are JSON primitives, so this is only a defensive fallback.
            }
        }
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_SERVERS, array.toString())
                .apply();
    }

    private DmpServer migrateLegacyServer() {
        String rawUrl = context.getSharedPreferences(LEGACY_PREFS_NAME, Context.MODE_PRIVATE)
                .getString(LEGACY_KEY_URL, "");
        if (rawUrl == null || rawUrl.trim().isEmpty()) {
            return null;
        }
        String value = rawUrl.trim();
        if (!value.startsWith("http://") && !value.startsWith("https://")) {
            value = "http://" + value;
        }
        Uri uri = Uri.parse(value);
        if (uri.getHost() == null) {
            return null;
        }
        String protocol = "https".equalsIgnoreCase(uri.getScheme()) ? "https" : "http";
        int port = uri.getPort();
        if (port <= 0) {
            port = "https".equals(protocol) ? 443 : 80;
        }
        return new DmpServer(
                UUID.randomUUID().toString(),
                uri.getHost(),
                port,
                protocol,
                "",
                "已保存服务器");
    }
}
