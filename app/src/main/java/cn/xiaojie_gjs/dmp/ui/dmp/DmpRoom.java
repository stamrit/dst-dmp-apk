package cn.xiaojie_gjs.dmp.ui.dmp;

/** A room returned by one saved DMP account/server. */
public class DmpRoom {
    public final DmpServer server;
    public final int id;
    public final String gameName;
    public final String gameMode;
    public final boolean online;
    /** True when at least one DST world screen is currently running. */
    public final boolean running;
    /** Master-world id used by room-scoped console commands, when exposed. */
    public final int masterWorldId;
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
        this(server, id, gameName, gameMode, online, false, worldCount, maxPlayers,
                onlinePlayers, playerNames, 0);
    }

    DmpRoom(
            DmpServer server,
            int id,
            String gameName,
            String gameMode,
            boolean online,
            boolean running,
            int worldCount,
            int maxPlayers,
            int onlinePlayers,
            String playerNames) {
        this(server, id, gameName, gameMode, online, running, worldCount, maxPlayers,
                onlinePlayers, playerNames, 0);
    }

    DmpRoom(
            DmpServer server,
            int id,
            String gameName,
            String gameMode,
            boolean online,
            boolean running,
            int worldCount,
            int maxPlayers,
            int onlinePlayers,
            String playerNames,
            int masterWorldId) {
        this.server = server;
        this.id = id;
        this.gameName = gameName == null || gameName.trim().isEmpty()
                ? "Room " + id
                : gameName.trim();
        this.gameMode = gameMode == null ? "" : gameMode.trim();
        this.online = online;
        this.running = running;
        this.masterWorldId = Math.max(0, masterWorldId);
        this.worldCount = worldCount;
        this.maxPlayers = maxPlayers;
        this.onlinePlayers = Math.max(0, onlinePlayers);
        this.playerNames = playerNames == null ? "" : playerNames.trim();
    }
}
