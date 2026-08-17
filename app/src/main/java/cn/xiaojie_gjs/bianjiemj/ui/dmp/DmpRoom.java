package cn.xiaojie_gjs.bianjiemj.ui.dmp;

/** A room returned by one saved DMP account/server. */
public class DmpRoom {
    public final DmpServer server;
    public final int id;
    public final String gameName;
    public final String gameMode;
    public final boolean online;
    public final int worldCount;
    public final int maxPlayers;
    public final int onlinePlayers;
    public final String playerNames;

    DmpRoom(
            DmpServer server,
            int id,
            String gameName,
            String gameMode,
            boolean online,
            int worldCount,
            int maxPlayers,
            int onlinePlayers,
            String playerNames) {
        this.server = server;
        this.id = id;
        this.gameName = gameName == null || gameName.trim().isEmpty()
                ? "Room " + id
                : gameName.trim();
        this.gameMode = gameMode == null ? "" : gameMode.trim();
        this.online = online;
        this.worldCount = worldCount;
        this.maxPlayers = maxPlayers;
        this.onlinePlayers = Math.max(0, onlinePlayers);
        this.playerNames = playerNames == null ? "" : playerNames.trim();
    }
}
