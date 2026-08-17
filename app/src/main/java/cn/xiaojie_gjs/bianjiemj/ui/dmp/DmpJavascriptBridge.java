package cn.xiaojie_gjs.bianjiemj.ui.dmp;

import android.app.DownloadManager;
import android.content.Context;
import android.net.Uri;
import android.os.Environment;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import cn.xiaojie_gjs.dmp.R;

/** Minimal Electron preload compatibility layer exposed only to bundled trusted DMP assets. */
final class DmpJavascriptBridge {


    private final DmpWebActivity activity;
    private final DmpServer server;
    private final int roomId;
    private final String roomName;
    private final boolean nightMode;

    DmpJavascriptBridge(
            DmpWebActivity activity,
            DmpServer server,
            int roomId,
            String roomName,
            boolean nightMode) {
        this.activity = activity;
        this.server = server;
        this.roomId = Math.max(0, roomId);
        this.roomName = roomName == null ? "" : roomName;
        this.nightMode = nightMode;
    }

    @JavascriptInterface
    public String getBootstrap() {
        try {
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
                    .put("id", roomId)
                    .put("gameName", roomName));
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
            savedServer.put("selectedRoomID", roomId);
            savedServer.put("selectedRoomName", roomName);

            JSONObject bootstrap = new JSONObject();
            bootstrap.put("global", global);
            bootstrap.put("user", user);
            bootstrap.put("dmps", new JSONArray().put(savedServer));
            bootstrap.put("apiBaseUrl", server.baseUrl());
            bootstrap.put("apiToken", server.token);
            bootstrap.put("theme", nightMode ? "dark" : "light");
            bootstrap.put("language", "zh");
            bootstrap.put("roomPreview", roomId > 0);
            return bootstrap.toString();
        } catch (JSONException exception) {
            return "{}";
        }
    }

    @JavascriptInterface
    public void openEntry() {
        activity.runOnUiThread(activity::finish);
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
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                request.addRequestHeader("X-DMP-TOKEN", server.token);
                request.addRequestHeader("X-I18n-Lang", "zh");
                request.setTitle(safeName);
                request.setNotificationVisibility(
                        DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, safeName);
                DownloadManager manager =
                        (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
                manager.enqueue(request);
            } catch (RuntimeException exception) {
                Toast.makeText(activity, R.string.dmp_status_failed, Toast.LENGTH_SHORT).show();
            }
        });
    }

    private boolean isWebUrl(String url) {
        if (url == null) {
            return false;
        }
        String scheme = Uri.parse(url).getScheme();
        return "http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme);
    }
}
