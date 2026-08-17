package cn.xiaojie_gjs.bianjiemj.ui.dmp;

import android.app.Dialog;
import android.animation.ObjectAnimator;
import android.animation.ValueAnimator;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.text.style.RelativeSizeSpan;
import android.text.style.StyleSpan;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import android.view.animation.LinearInterpolator;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.appcompat.app.AppCompatDelegate;
import androidx.appcompat.app.AlertDialog;
import androidx.recyclerview.widget.GridLayoutManager;

import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.google.android.material.card.MaterialCardView;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import cn.xiaojie_gjs.dmp.R;
import cn.xiaojie_gjs.dmp.databinding.ActivityDmpBinding;
import cn.xiaojie_gjs.dmp.databinding.DialogDmpServerBinding;

/** Native multi-server launcher and on-demand cross-server room browser. */
public class DmpActivity extends AppCompatActivity
        implements DmpServerAdapter.Listener, DmpRoomAdapter.Listener {

    private static final long REFRESH_INTERVAL_MS = 5000L;
    private static final String UI_PREFERENCES = "dmp_ui_preferences";
    private static final String PREF_NIGHT_MODE = "night_mode";
    private static final String PREF_DISMISSED_UPDATE_TASKS = "dismissed_update_tasks";
    private static final String STATE_ROOM_MODE = "room_mode";
    private static final String STATE_ROOM_SERVER_IDS = "room_server_ids";
    private static final String STATE_ROOM_IDS = "room_ids";
    private static final String STATE_ROOM_NAMES = "room_names";
    private static final String STATE_ROOM_GAME_MODES = "room_game_modes";
    private static final String STATE_ROOM_ONLINE = "room_online";
    private static final String STATE_ROOM_WORLD_COUNTS = "room_world_counts";
    private static final String STATE_ROOM_MAX_PLAYERS = "room_max_players";
    private static final String STATE_ROOM_ONLINE_PLAYERS = "room_online_players";
    private static final String STATE_ROOM_PLAYER_NAMES = "room_player_names";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final DmpApiClient apiClient = new DmpApiClient();
    private final Runnable periodicRefresh = new Runnable() {
        @Override
        public void run() {
            if (!roomMode) {
                refreshAll();
                handler.postDelayed(this, REFRESH_INTERVAL_MS);
            }
        }
    };

    private ActivityDmpBinding binding;
    private DmpServerStore store;
    private DmpServerAdapter serverAdapter;
    private DmpRoomAdapter roomAdapter;
    private List<DmpServer> servers;
    private boolean destroyed;
    private boolean roomMode;
    private boolean nightMode;
    private int roomLoadGeneration;
    private int spanCount;
    private int taskLoadGeneration;
    private long taskDialogInteractionLockedUntil;
    private List<DmpRoom> roomSnapshot = new ArrayList<>();
    @Nullable
    private AlertDialog taskDialog;
    @Nullable
    private LinearLayout taskDialogContent;
    @Nullable
    private ImageView taskDeleteSpinner;
    @Nullable
    private ObjectAnimator taskDeleteSpinnerAnimator;
    private int taskDeleteRequestsInFlight;
    private SharedPreferences uiPreferences;
    private final Set<String> dismissedUpdateTasks = new HashSet<>();

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        uiPreferences = getSharedPreferences(UI_PREFERENCES, MODE_PRIVATE);
        dismissedUpdateTasks.addAll(uiPreferences.getStringSet(
                PREF_DISMISSED_UPDATE_TASKS, Collections.emptySet()));
        nightMode = uiPreferences.getBoolean(PREF_NIGHT_MODE, true);
        getDelegate().setLocalNightMode(nightMode
                ? AppCompatDelegate.MODE_NIGHT_YES
                : AppCompatDelegate.MODE_NIGHT_NO);
        getWindow().setBackgroundDrawable(new ColorDrawable(themeBackground(nightMode)));
        super.onCreate(savedInstanceState);
        binding = ActivityDmpBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());

        store = new DmpServerStore(this);
        servers = store.load();
        serverAdapter = new DmpServerAdapter(this);
        serverAdapter.setServers(servers);
        roomAdapter = new DmpRoomAdapter(this);
        spanCount = getResources().getConfiguration().screenWidthDp >= 900 ? 2 : 1;

        binding.dmpBack.setOnClickListener(v -> finish());
        binding.dmpRefreshAll.setOnClickListener(v -> {
            if (roomMode) {
                refreshRooms();
            } else {
                refreshAll();
            }
        });
        binding.dmpRoomMode.setOnClickListener(v -> switchRoomMode(!roomMode));
        // 此提取版暂不开放全局任务与服务器更新总控，避免误触发远端操作。
        binding.dmpDownloadTasks.setEnabled(false);
        binding.dmpDownloadTasks.setAlpha(0.38f);
        binding.dmpUpdateServers.setEnabled(false);
        binding.dmpUpdateServers.setAlpha(0.38f);
        binding.dmpThemeToggle.setOnClickListener(v -> toggleTheme(uiPreferences));
        updateThemeButton();
        binding.getRoot().setAlpha(0f);
        binding.getRoot().animate().alpha(1f).setDuration(240L).start();

        boolean restoredRoomMode = savedInstanceState != null
                && savedInstanceState.getBoolean(STATE_ROOM_MODE, false);
        boolean restoredSnapshot = restoredRoomMode && restoreRoomSnapshot(savedInstanceState);
        switchRoomMode(restoredRoomMode, !restoredSnapshot);
    }

    @Override
    protected void onStart() {
        super.onStart();
        handler.removeCallbacks(periodicRefresh);
        if (!roomMode) {
            handler.post(periodicRefresh);
        }
    }

    @Override
    public void onConfigurationChanged(@NonNull Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        int updatedSpanCount = newConfig.screenWidthDp >= 900 ? 2 : 1;
        if (updatedSpanCount != spanCount) {
            spanCount = updatedSpanCount;
            switchRoomMode(roomMode, false);
        }
    }

    @Override
    protected void onStop() {
        handler.removeCallbacks(periodicRefresh);
        super.onStop();
    }

    @Override
    protected void onSaveInstanceState(@NonNull Bundle outState) {
        outState.putBoolean(STATE_ROOM_MODE, roomMode);
        saveRoomSnapshot(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onAdd() {
        showServerDialog(null);
    }

    @Override
    public void onEnter(DmpServer server) {
        openDashboard(server, 0, "");
    }

    @Override
    public void onOpenRoom(DmpRoom room) {
        openDashboard(room.server, room.id, room.gameName);
    }

    private void openDashboard(DmpServer server, int roomId, String roomName) {
        Intent intent = new Intent(this, DmpWebActivity.class);
        intent.putExtra(DmpWebActivity.EXTRA_SERVER_ID, server.id);
        intent.putExtra(DmpWebActivity.EXTRA_SERVER_HOST, server.host);
        intent.putExtra(DmpWebActivity.EXTRA_SERVER_PORT, server.port);
        intent.putExtra(DmpWebActivity.EXTRA_SERVER_PROTOCOL, server.protocol);
        intent.putExtra(DmpWebActivity.EXTRA_SERVER_TOKEN, server.token);
        intent.putExtra(DmpWebActivity.EXTRA_SERVER_REMARK, server.remark);
        intent.putExtra(DmpWebActivity.EXTRA_ROOM_ID, roomId);
        intent.putExtra(DmpWebActivity.EXTRA_ROOM_NAME, roomName);
        intent.putExtra(DmpWebActivity.EXTRA_NIGHT_MODE, nightMode);
        startActivity(intent);
    }

    @Override
    public void onRefresh(DmpServer server) {
        refreshServer(server);
    }

    @Override
    public void onEdit(DmpServer server) {
        showServerDialog(server);
    }

    @Override
    public void onDelete(DmpServer server) {
        new MaterialAlertDialogBuilder(this)
                .setTitle(R.string.dmp_delete_title)
                .setMessage(getString(R.string.dmp_delete_message, server.host))
                .setNegativeButton(R.string.dmp_cancel, null)
                .setPositiveButton(R.string.dmp_delete, (dialog, which) -> {
                    servers.remove(server);
                    store.save(servers);
                    serverAdapter.setServers(servers);
                })
                .show();
    }

    private void switchRoomMode(boolean showRooms) {
        switchRoomMode(showRooms, showRooms);
    }

    private void switchRoomMode(boolean showRooms, boolean refreshRoomSnapshot) {
        roomMode = showRooms;
        handler.removeCallbacks(periodicRefresh);
        binding.dmpRoomMode.setText(showRooms
                ? R.string.dmp_show_servers
                : R.string.dmp_show_rooms);
        binding.dmpLauncherTitle.setText(R.string.dmp_launcher_title);
        binding.dmpLauncherSubtitle.setText(R.string.dmp_launcher_subtitle);
        binding.dmpRoomEmpty.setVisibility(View.GONE);
        binding.dmpRoomLoading.setVisibility(View.GONE);

        if (showRooms) {
            binding.dmpServerList.setLayoutManager(new GridLayoutManager(this, spanCount));
            binding.dmpServerList.setAdapter(roomAdapter);
            if (refreshRoomSnapshot) {
                refreshRooms();
            } else {
                roomAdapter.setRooms(roomSnapshot);
                binding.dmpRoomEmpty.setVisibility(
                        roomSnapshot.isEmpty() ? View.VISIBLE : View.GONE);
            }
        } else {
            GridLayoutManager layoutManager = new GridLayoutManager(this, spanCount);
            layoutManager.setSpanSizeLookup(new GridLayoutManager.SpanSizeLookup() {
                @Override
                public int getSpanSize(int position) {
                    return position == servers.size() ? spanCount : 1;
                }
            });
            binding.dmpServerList.setLayoutManager(layoutManager);
            binding.dmpServerList.setAdapter(serverAdapter);
            if (hasWindowFocus()) {
                handler.post(periodicRefresh);
            }
        }
    }

    /** Aggregates one snapshot only; deliberately has no delayed or periodic callback. */
    private void refreshRooms() {
        final int generation = ++roomLoadGeneration;
        roomAdapter.setRooms(new ArrayList<>());
        binding.dmpRoomEmpty.setVisibility(View.GONE);
        binding.dmpRoomLoading.setVisibility(View.VISIBLE);
        if (servers.isEmpty()) {
            finishRoomRefresh(generation, new ArrayList<>(), 0);
            return;
        }

        List<DmpRoom> aggregate = new ArrayList<>();
        AtomicInteger remaining = new AtomicInteger(servers.size());
        AtomicInteger failures = new AtomicInteger();
        for (DmpServer server : servers) {
            apiClient.fetchRooms(server, new DmpApiClient.RoomsCallback() {
                @Override
                public void onSuccess(List<DmpRoom> rooms) {
                    synchronized (aggregate) {
                        aggregate.addAll(rooms);
                    }
                    completeRoomRequest(generation, aggregate, remaining, failures);
                }

                @Override
                public void onError(String message) {
                    failures.incrementAndGet();
                    completeRoomRequest(generation, aggregate, remaining, failures);
                }
            });
        }
    }

    private void completeRoomRequest(
            int generation,
            List<DmpRoom> aggregate,
            AtomicInteger remaining,
            AtomicInteger failures) {
        if (remaining.decrementAndGet() != 0) {
            return;
        }
        List<DmpRoom> snapshot;
        synchronized (aggregate) {
            snapshot = new ArrayList<>(aggregate);
        }
        snapshot.sort(Comparator
                .comparing((DmpRoom room) -> !room.online)
                .thenComparing(room -> room.gameName, String.CASE_INSENSITIVE_ORDER)
                .thenComparing(room -> room.server.remark.isEmpty()
                        ? room.server.host
                        : room.server.remark, String.CASE_INSENSITIVE_ORDER));
        finishRoomRefresh(generation, snapshot, failures.get());
    }

    private void finishRoomRefresh(int generation, List<DmpRoom> rooms, int failures) {
        runOnUiThread(() -> {
            if (destroyed || !roomMode || generation != roomLoadGeneration) {
                return;
            }
            binding.dmpRoomLoading.setVisibility(View.GONE);
            roomSnapshot = new ArrayList<>(rooms);
            roomAdapter.setRooms(rooms);
            binding.dmpRoomEmpty.setVisibility(rooms.isEmpty() ? View.VISIBLE : View.GONE);
            if (failures > 0) {
                Toast.makeText(this, getString(R.string.dmp_room_partial, failures),
                        Toast.LENGTH_SHORT).show();
            }
        });
    }

    private void saveRoomSnapshot(Bundle outState) {
        int size = roomSnapshot.size();
        String[] serverIds = new String[size];
        int[] roomIds = new int[size];
        String[] names = new String[size];
        String[] modes = new String[size];
        boolean[] online = new boolean[size];
        int[] worldCounts = new int[size];
        int[] maxPlayers = new int[size];
        int[] onlinePlayers = new int[size];
        String[] playerNames = new String[size];
        for (int index = 0; index < size; index++) {
            DmpRoom room = roomSnapshot.get(index);
            serverIds[index] = room.server.id;
            roomIds[index] = room.id;
            names[index] = room.gameName;
            modes[index] = room.gameMode;
            online[index] = room.online;
            worldCounts[index] = room.worldCount;
            maxPlayers[index] = room.maxPlayers;
            onlinePlayers[index] = room.onlinePlayers;
            playerNames[index] = room.playerNames;
        }
        outState.putStringArray(STATE_ROOM_SERVER_IDS, serverIds);
        outState.putIntArray(STATE_ROOM_IDS, roomIds);
        outState.putStringArray(STATE_ROOM_NAMES, names);
        outState.putStringArray(STATE_ROOM_GAME_MODES, modes);
        outState.putBooleanArray(STATE_ROOM_ONLINE, online);
        outState.putIntArray(STATE_ROOM_WORLD_COUNTS, worldCounts);
        outState.putIntArray(STATE_ROOM_MAX_PLAYERS, maxPlayers);
        outState.putIntArray(STATE_ROOM_ONLINE_PLAYERS, onlinePlayers);
        outState.putStringArray(STATE_ROOM_PLAYER_NAMES, playerNames);
    }

    private boolean restoreRoomSnapshot(@Nullable Bundle state) {
        if (state == null) {
            return false;
        }
        String[] serverIds = state.getStringArray(STATE_ROOM_SERVER_IDS);
        int[] roomIds = state.getIntArray(STATE_ROOM_IDS);
        String[] names = state.getStringArray(STATE_ROOM_NAMES);
        String[] modes = state.getStringArray(STATE_ROOM_GAME_MODES);
        boolean[] online = state.getBooleanArray(STATE_ROOM_ONLINE);
        int[] worldCounts = state.getIntArray(STATE_ROOM_WORLD_COUNTS);
        int[] maxPlayers = state.getIntArray(STATE_ROOM_MAX_PLAYERS);
        int[] onlinePlayers = state.getIntArray(STATE_ROOM_ONLINE_PLAYERS);
        String[] playerNames = state.getStringArray(STATE_ROOM_PLAYER_NAMES);
        if (serverIds == null || roomIds == null || names == null || modes == null
                || online == null || worldCounts == null || maxPlayers == null
                || onlinePlayers == null || playerNames == null) {
            return false;
        }
        int size = serverIds.length;
        if (roomIds.length != size || names.length != size || modes.length != size
                || online.length != size || worldCounts.length != size
                || maxPlayers.length != size || onlinePlayers.length != size
                || playerNames.length != size) {
            return false;
        }
        List<DmpRoom> restored = new ArrayList<>();
        for (int index = 0; index < size; index++) {
            DmpServer server = findServer(serverIds[index]);
            if (server != null) {
                restored.add(new DmpRoom(server, roomIds[index], names[index], modes[index],
                        online[index], worldCounts[index], maxPlayers[index],
                        onlinePlayers[index], playerNames[index]));
            }
        }
        roomSnapshot = restored;
        return true;
    }

    @Nullable
    private DmpServer findServer(String serverId) {
        for (DmpServer server : servers) {
            if (server.id.equals(serverId)) {
                return server;
            }
        }
        return null;
    }

    private void toggleTheme(SharedPreferences preferences) {
        boolean targetNightMode = !nightMode;
        binding.dmpThemeToggle.setEnabled(false);
        ViewGroup content = findViewById(android.R.id.content);
        View transitionLayer = new View(this);
        transitionLayer.setAlpha(0f);
        transitionLayer.setBackgroundColor(themeBackground(targetNightMode));
        content.addView(transitionLayer, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        transitionLayer.animate()
                .alpha(1f)
                .setDuration(220L)
                .withEndAction(() -> {
                    nightMode = targetNightMode;
                    preferences.edit().putBoolean(PREF_NIGHT_MODE, nightMode).apply();
                    getDelegate().setLocalNightMode(nightMode
                            ? AppCompatDelegate.MODE_NIGHT_YES
                            : AppCompatDelegate.MODE_NIGHT_NO);
                    overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out);
                })
                .start();
    }

    private int themeBackground(boolean useNightMode) {
        return Color.parseColor(useNightMode ? "#24213D" : "#F4F2FA");
    }

    private void updateThemeButton() {
        binding.dmpThemeToggle.setImageResource(nightMode
                ? R.drawable.ic_dmp_sun_line
                : R.drawable.ic_dmp_moon_clear_line);
        binding.dmpThemeToggle.setContentDescription(getString(nightMode
                ? R.string.dmp_theme_day
                : R.string.dmp_theme_night));
    }

    private void refreshAll() {
        for (DmpServer server : servers) {
            refreshServer(server);
        }
    }

    private void refreshServer(DmpServer server) {
        if (server.state == DmpServer.STATE_LOADING) {
            return;
        }
        server.state = DmpServer.STATE_LOADING;
        server.statusMessage = "";
        serverAdapter.notifyServerChanged(server.id);
        apiClient.fetchMetrics(server, new DmpApiClient.Callback() {
            @Override
            public void onSuccess(DmpMetrics metrics) {
                runOnUiThread(() -> {
                    if (destroyed) {
                        return;
                    }
                    server.cpu = metrics.cpu;
                    server.memory = metrics.memory;
                    server.roomCount = metrics.roomCount;
                    server.worldCount = metrics.worldCount;
                    server.state = DmpServer.STATE_ONLINE;
                    serverAdapter.notifyServerChanged(server.id);
                });
            }

            @Override
            public void onError(String message) {
                runOnUiThread(() -> {
                    if (destroyed) {
                        return;
                    }
                    server.state = DmpServer.STATE_OFFLINE;
                    server.statusMessage = shortenError(message);
                    serverAdapter.notifyServerChanged(server.id);
                });
            }
        });
    }

    private String shortenError(String message) {
        if (message == null || message.trim().isEmpty()) {
            return getString(R.string.dmp_card_offline);
        }
        String value = message.trim();
        return value.length() > 34 ? value.substring(0, 34) + "…" : value;
    }

    private long oldUpdateClickAt;
    private int oldUpdateClickCount;
    private long allUpdateClickAt;
    private int allUpdateClickCount;
    private final Map<String, Long> singleUpdateClickAt = new LinkedHashMap<>();
    private final Map<String, Integer> singleUpdateClickCount = new LinkedHashMap<>();

    private void showTaskDialog() {
        taskLoadGeneration++;
        taskDeleteRequestsInFlight = 0;
        ScrollView scrollView = new ScrollView(this);
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dpToPx(14), dpToPx(10), dpToPx(14), dpToPx(14));
        scrollView.addView(content, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        LinearLayout titleBar = new LinearLayout(this);
        titleBar.setOrientation(LinearLayout.HORIZONTAL);
        titleBar.setGravity(Gravity.CENTER_VERTICAL);
        titleBar.setPadding(dpToPx(24), dpToPx(20), dpToPx(18), 0);
        TextView title = new TextView(this);
        title.setText(R.string.dmp_tasks_title);
        title.setTextSize(20f);
        title.setTextColor(getColor(R.color.dmp_text_primary));
        title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);
        titleBar.addView(title, new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        taskDeleteSpinner = new ImageView(this);
        taskDeleteSpinner.setImageResource(android.R.drawable.ic_popup_sync);
        taskDeleteSpinner.setColorFilter(getColor(R.color.dmp_text_secondary));
        taskDeleteSpinner.setPadding(dpToPx(5), dpToPx(5), dpToPx(5), dpToPx(5));
        taskDeleteSpinner.setVisibility(View.GONE);
        titleBar.addView(taskDeleteSpinner, new LinearLayout.LayoutParams(dpToPx(34), dpToPx(34)));

        taskDialog = new MaterialAlertDialogBuilder(this)
                .setCustomTitle(titleBar)
                .setView(scrollView)
                .setNegativeButton(R.string.dmp_cancel, null)
                .create();
        taskDialog.setOnShowListener(ignored -> applyLargeDialogCorners(taskDialog));
        taskDialog.setOnDismissListener(ignored -> {
            taskLoadGeneration++;
            taskDialog = null;
            taskDialogContent = null;
            taskDeleteRequestsInFlight = 0;
            if (taskDeleteSpinnerAnimator != null) {
                taskDeleteSpinnerAnimator.cancel();
            }
            taskDeleteSpinnerAnimator = null;
            taskDeleteSpinner = null;
        });
        taskDialog.show();
        taskDialogContent = content;
        refreshTaskDialog(content, taskLoadGeneration);
    }

    private void refreshTaskDialog(LinearLayout content, int generation) {
        if (destroyed || taskDialog == null || !taskDialog.isShowing()
                || generation != taskLoadGeneration) {
            return;
        }
        long now = android.os.SystemClock.uptimeMillis();
        if (now < taskDialogInteractionLockedUntil) {
            handler.postDelayed(() -> refreshTaskDialog(content, generation),
                    taskDialogInteractionLockedUntil - now + 60L);
            return;
        }
        List<DmpServer> targets = uniqueServers();
        if (targets.isEmpty()) {
            content.removeAllViews();
            showTaskEmpty(content);
            return;
        }

        List<DmpTask> aggregate = Collections.synchronizedList(new ArrayList<>());
        List<String> notices = Collections.synchronizedList(new ArrayList<>());
        AtomicInteger remaining = new AtomicInteger(targets.size());
        for (DmpServer server : targets) {
            apiClient.fetchTasks(server, new DmpApiClient.TasksCallback() {
                @Override
                public void onSuccess(List<DmpTask> tasks) {
                    aggregate.addAll(tasks);
                    completeTaskRefresh(content, generation, aggregate, notices, remaining);
                }

                @Override
                public void onUnsupported() {
                    completeTaskRefresh(content, generation, aggregate, notices, remaining);
                }

                @Override
                public void onError(String message) {
                    notices.add(getString(R.string.dmp_tasks_failed, serverLabel(server)));
                    completeTaskRefresh(content, generation, aggregate, notices, remaining);
                }
            });
        }
    }

    private void completeTaskRefresh(
            LinearLayout content,
            int generation,
            List<DmpTask> aggregate,
            List<String> notices,
            AtomicInteger remaining) {
        if (remaining.decrementAndGet() != 0) {
            return;
        }
        List<DmpTask> snapshot;
        List<String> noticeSnapshot;
        synchronized (aggregate) {
            snapshot = new ArrayList<>(aggregate);
        }
        synchronized (notices) {
            noticeSnapshot = new ArrayList<>(notices);
        }
        snapshot.sort(Comparator
                .comparing((DmpTask task) -> !task.isRunning())
                .thenComparing((DmpTask task) -> -task.updatedAt));
        snapshot.removeIf(this::isDismissedTerminalUpdate);
        runOnUiThread(() -> {
            if (destroyed || taskDialog == null || !taskDialog.isShowing()
                    || generation != taskLoadGeneration) {
                return;
            }
            content.removeAllViews();
            for (DmpTask task : snapshot) {
                content.addView(createTaskCard(task));
            }
            for (String notice : noticeSnapshot) {
                TextView noticeView = new TextView(this);
                noticeView.setText(notice);
                noticeView.setTextColor(getColor(R.color.dmp_text_secondary));
                noticeView.setTextSize(13f);
                noticeView.setPadding(dpToPx(8), dpToPx(10), dpToPx(8), dpToPx(10));
                content.addView(noticeView);
            }
            if (snapshot.isEmpty() && noticeSnapshot.isEmpty()) {
                showTaskEmpty(content);
            }
            handler.postDelayed(() -> refreshTaskDialog(content, generation), 2500L);
        });
    }

    private void showTaskEmpty(LinearLayout content) {
        TextView empty = new TextView(this);
        empty.setText(R.string.dmp_tasks_empty);
        empty.setTextColor(getColor(R.color.dmp_text_secondary));
        empty.setTextSize(14f);
        empty.setGravity(Gravity.CENTER);
        empty.setPadding(dpToPx(10), dpToPx(28), dpToPx(10), dpToPx(28));
        content.addView(empty, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    }

    private View createTaskCard(DmpTask task) {
        MaterialCardView card = new MaterialCardView(this);
        card.setCardElevation(dpToPx(1));
        card.setRadius(dpToPx(24));
        card.setUseCompatPadding(true);
        card.setCardBackgroundColor(getColor(R.color.dmp_card));
        LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(dpToPx(14), dpToPx(12), dpToPx(14), dpToPx(12));

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        TextView title = new TextView(this);
        title.setText("game_update".equals(task.type)
                ? getString(R.string.dmp_task_update)
                : getString(R.string.dmp_task_mod));
        title.setTextColor(getColor(R.color.dmp_text_primary));
        title.setTextSize(16f);
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        header.addView(title, new LinearLayout.LayoutParams(0,
                ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        if (!"game_update".equals(task.type)) {
            if (task.isRunning() || task.isPaused()) {
                header.addView(createTaskActionButton(task,
                        task.isPaused() ? "resume" : "pause"));
            }
            if (!task.taskId.isEmpty()) {
                header.addView(createTaskActionButton(task, "delete"));
            }
        } else if (!task.taskId.isEmpty() && task.isTerminal()) {
            // SteamCMD 在原目录增量更新，运行中强制终止可能留下半更新状态。
            // 仅在任务结束后保留“删除记录”入口，不允许在更新阶段取消或重启房间。
            header.addView(createTaskActionButton(task, "delete"));
        }
        body.addView(header);

        TextView target = new TextView(this);
        target.setText(!"game_update".equals(task.type)
                ? getString(R.string.dmp_task_server, serverLabel(task.server)) + " · 房间" + taskRoomNumber(task)
                : getString(R.string.dmp_task_server, serverLabel(task.server)));
        target.setTextColor(getColor(R.color.dmp_text_secondary));
        target.setTextSize(13f);
        target.setPadding(0, dpToPx(3), 0, 0);
        body.addView(target);

        if (!"game_update".equals(task.type)) {
            TextView room = new TextView(this);
            room.setText(getString(R.string.dmp_task_room, task.name.isEmpty() ? "—" : task.name));
            room.setTextColor(getColor(R.color.dmp_text_secondary));
            room.setTextSize(13f);
            room.setPadding(0, dpToPx(2), 0, dpToPx(7));
            body.addView(room);
        } else {
            target.setPadding(0, dpToPx(3), 0, dpToPx(7));
        }

        TextView state = new TextView(this);
        state.setText(getString(R.string.dmp_task_progress,
                taskStatusText(task.status), taskStageText(task.stage), task.progress));
        state.setTextColor(getColor(R.color.dmp_text_primary));
        state.setTextSize(13f);
        body.addView(state);

        if (!task.isTerminal()) {
            ProgressBar progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
            progress.setMax(1000);
            progress.setProgress((int) Math.round(task.progress * 10));
            LinearLayout.LayoutParams progressParams = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, dpToPx(6));
            progressParams.topMargin = dpToPx(8);
            progressParams.bottomMargin = dpToPx(8);
            body.addView(progress, progressParams);
        }

        TextView bytes = new TextView(this);
        String byteText = task.totalBytes > 0
                ? formatBytes(task.completedBytes) + " / " + formatBytes(task.totalBytes)
                : "—";
        if (task.speedBytesPerSecond > 0) {
            byteText += " · " + formatBytes((long) task.speedBytesPerSecond) + "/s";
        }
        bytes.setText(byteText);
        bytes.setTextColor(getColor(R.color.dmp_text_secondary));
        bytes.setTextSize(12f);
        body.addView(bytes);
        card.addView(body);
        LinearLayout.LayoutParams cardParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        cardParams.bottomMargin = dpToPx(8);
        card.setLayoutParams(cardParams);
        return card;
    }

    private String taskRoomLabel(DmpTask task) {
        if (!task.roomName.isEmpty()) {
            return task.roomName;
        }
        if (!task.roomNames.isEmpty()) {
            return task.roomNames.get(0);
        }
        return task.roomId > 0 ? "#" + task.roomId : serverLabel(task.server);
    }

    private String taskRoomNumber(DmpTask task) {
        return task.roomId > 0 ? "#" + task.roomId : "#—";
    }

    private boolean isTerminalUpdate(DmpTask task) {
        return "game_update".equals(task.type) && task.isTerminal();
    }

    private String dismissedTaskKey(DmpTask task) {
        return task.server.id + "|" + task.taskId;
    }

    private boolean isDismissedTerminalUpdate(DmpTask task) {
        return isTerminalUpdate(task) && dismissedUpdateTasks.contains(dismissedTaskKey(task));
    }

    private void dismissTerminalUpdate(DmpTask task) {
        if (!isTerminalUpdate(task)) {
            return;
        }
        dismissedUpdateTasks.add(dismissedTaskKey(task));
        uiPreferences.edit().putStringSet(PREF_DISMISSED_UPDATE_TASKS,
                new HashSet<>(dismissedUpdateTasks)).apply();
    }

    private ImageButton createTaskActionButton(DmpTask task, String action) {
        ImageButton button = new ImageButton(this);
        button.setImageResource("pause".equals(action) ? android.R.drawable.ic_media_pause
                : "resume".equals(action) ? android.R.drawable.ic_media_play
                : android.R.drawable.ic_menu_delete);
        button.setContentDescription("pause".equals(action) ? getString(R.string.dmp_task_pause)
                : "resume".equals(action) ? getString(R.string.dmp_task_resume)
                : getString(R.string.dmp_task_delete));
        button.setBackgroundColor(Color.TRANSPARENT);
        button.setPadding(dpToPx(7), dpToPx(7), dpToPx(7), dpToPx(7));
        button.setOnTouchListener((v, event) -> {
            if (event.getActionMasked() == android.view.MotionEvent.ACTION_DOWN
                    || event.getActionMasked() == android.view.MotionEvent.ACTION_MOVE) {
                taskDialogInteractionLockedUntil = android.os.SystemClock.uptimeMillis() + 1400L;
            }
            return false;
        });
        button.setOnClickListener(v -> runTaskAction(task, action, button));
        button.setLayoutParams(new LinearLayout.LayoutParams(dpToPx(38), dpToPx(38)));
        return button;
    }

    private void runTaskAction(DmpTask task, String action, View button) {
        taskDialogInteractionLockedUntil = android.os.SystemClock.uptimeMillis() + 3500L;
        button.setEnabled(false);
        startTaskDeleteIndicator(action);
        apiClient.taskAction(task.server, task.taskId, action, new DmpApiClient.TaskActionCallback() {
            @Override
            public void onSuccess(DmpTask ignored) {
                runOnUiThread(() -> {
                    finishTaskDeleteIndicator(action);
                    dismissTerminalUpdate(task);
                    if (taskDialogContent != null) {
                        refreshTaskDialog(taskDialogContent, taskLoadGeneration);
                    }
                });
            }

            @Override
            public void onUnsupported() {
                runOnUiThread(() -> {
                    finishTaskDeleteIndicator(action);
                    button.setEnabled(true);
                    if ("delete".equals(action) && isTerminalUpdate(task)) {
                        dismissTerminalUpdate(task);
                        if (taskDialogContent != null) {
                            refreshTaskDialog(taskDialogContent, taskLoadGeneration);
                        }
                        return;
                    }
                });
            }

            @Override
            public void onError(String message) {
                runOnUiThread(() -> {
                    finishTaskDeleteIndicator(action);
                    button.setEnabled(true);
                    if ("delete".equals(action) && isTerminalUpdate(task)) {
                        dismissTerminalUpdate(task);
                        if (taskDialogContent != null) {
                            refreshTaskDialog(taskDialogContent, taskLoadGeneration);
                        }
                        return;
                    }
                });
            }
        });
    }

    private void startTaskDeleteIndicator(String action) {
        if (!"delete".equals(action)) {
            return;
        }
        taskDeleteRequestsInFlight++;
        if (taskDeleteSpinner == null) {
            return;
        }
        taskDeleteSpinner.setVisibility(View.VISIBLE);
        if (taskDeleteSpinnerAnimator == null) {
            taskDeleteSpinnerAnimator = ObjectAnimator.ofFloat(taskDeleteSpinner, View.ROTATION, 0f, 360f);
            taskDeleteSpinnerAnimator.setDuration(720L);
            taskDeleteSpinnerAnimator.setInterpolator(new LinearInterpolator());
            taskDeleteSpinnerAnimator.setRepeatCount(ValueAnimator.INFINITE);
        }
        if (!taskDeleteSpinnerAnimator.isStarted()) {
            taskDeleteSpinnerAnimator.start();
        }
    }

    private void finishTaskDeleteIndicator(String action) {
        if (!"delete".equals(action)) {
            return;
        }
        taskDeleteRequestsInFlight = Math.max(0, taskDeleteRequestsInFlight - 1);
        if (taskDeleteRequestsInFlight > 0 || taskDeleteSpinner == null) {
            return;
        }
        if (taskDeleteSpinnerAnimator != null) {
            taskDeleteSpinnerAnimator.cancel();
            taskDeleteSpinnerAnimator = null;
        }
        taskDeleteSpinner.setRotation(0f);
        taskDeleteSpinner.setVisibility(View.GONE);
    }

    private void showUpdateDialog() {
        List<DmpServer> targets = uniqueServers();
        if (targets.isEmpty()) {
            Toast.makeText(this, R.string.dmp_tasks_empty, Toast.LENGTH_SHORT).show();
            return;
        }

        LinearLayout container = new LinearLayout(this);
        container.setOrientation(LinearLayout.VERTICAL);
        container.setPadding(dpToPx(30), dpToPx(18), dpToPx(30), dpToPx(18));
        TextView latestView = new TextView(this);
        latestView.setTextSize(20f);
        latestView.setTextColor(getColor(R.color.dmp_text_primary));
        latestView.setPadding(0, dpToPx(5), 0, dpToPx(8));
        setUpdateConsoleTitle(latestView, getString(R.string.dmp_update_reading));
        LinearLayout versionsView = new LinearLayout(this);
        versionsView.setOrientation(LinearLayout.VERTICAL);
        versionsView.setPadding(0, dpToPx(10), 0, dpToPx(6));
        TextView loading = new TextView(this);
        loading.setText(R.string.dmp_update_loading);
        loading.setTextSize(14f);
        loading.setTextColor(getColor(R.color.dmp_text_secondary));
        versionsView.addView(loading);
        container.addView(latestView);
        container.addView(versionsView);

        Map<DmpServer, DmpVersion> versions = Collections.synchronizedMap(new LinkedHashMap<>());
        AlertDialog dialog = new MaterialAlertDialogBuilder(this)
                .setView(container)
                .setNegativeButton(R.string.dmp_update_cancel, null)
                .setNeutralButton(R.string.dmp_update_all, null)
                .setPositiveButton(R.string.dmp_update_old, null)
                .create();
        dialog.setOnShowListener(ignored -> {
            applyLargeDialogCorners(dialog);
            dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setEnabled(false);
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);
            dialog.getButton(AlertDialog.BUTTON_NEUTRAL)
                    .setOnClickListener(v -> protectedBatchUpdate(versions, true, dialog));
            dialog.getButton(AlertDialog.BUTTON_POSITIVE)
                    .setOnClickListener(v -> protectedBatchUpdate(versions, false, dialog));
        });
        dialog.show();

        AtomicInteger remaining = new AtomicInteger(targets.size());
        List<String> errors = Collections.synchronizedList(new ArrayList<>());
        for (DmpServer server : targets) {
            apiClient.fetchVersion(server, new DmpApiClient.VersionCallback() {
                @Override
                public void onSuccess(DmpVersion version) {
                    versions.put(server, version);
                    completeVersionRefresh(dialog, latestView, versionsView, versions, errors, remaining);
                }

                @Override
                public void onUnsupported() {
                    errors.add(getString(R.string.dmp_update_unsupported, serverLabel(server)));
                    completeVersionRefresh(dialog, latestView, versionsView, versions, errors, remaining);
                }

                @Override
                public void onError(String message) {
                    errors.add(getString(R.string.dmp_tasks_failed, serverLabel(server)));
                    completeVersionRefresh(dialog, latestView, versionsView, versions, errors, remaining);
                }
            });
        }
    }

    private void completeVersionRefresh(
            AlertDialog dialog,
            TextView latestView,
            LinearLayout versionsView,
            Map<DmpServer, DmpVersion> versions,
            List<String> errors,
            AtomicInteger remaining) {
        if (remaining.decrementAndGet() != 0) {
            return;
        }
        runOnUiThread(() -> {
            if (destroyed || !dialog.isShowing()) {
                return;
            }
            int latest = 0;
            versionsView.removeAllViews();
            synchronized (versions) {
                for (Map.Entry<DmpServer, DmpVersion> entry : versions.entrySet()) {
                    DmpVersion version = entry.getValue();
                    latest = Math.max(latest, version.latest);
                    versionsView.addView(createVersionRow(entry.getKey(), version, dialog));
                }
            }
            synchronized (errors) {
                for (String error : errors) {
                    TextView errorView = new TextView(this);
                    errorView.setText(error);
                    errorView.setTextColor(getColor(R.color.dmp_warning));
                    errorView.setTextSize(13f);
                    errorView.setPadding(0, dpToPx(7), 0, dpToPx(7));
                    versionsView.addView(errorView);
                }
            }
            setUpdateConsoleTitle(latestView,
                    latest > 0 ? String.valueOf(latest) : getString(R.string.dmp_update_unknown));
            dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setEnabled(hasTaskServer(versions));
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(hasOldServer(versions));
        });
    }

    private View createVersionRow(DmpServer server, DmpVersion version, AlertDialog dialog) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(0, dpToPx(4), 0, dpToPx(4));
        TextView label = new TextView(this);
        label.setTextColor(getColor(R.color.dmp_text_primary));
        label.setTextSize(14f);
        String local = version.local > 0 ? String.valueOf(version.local) : "未知";
        label.setText(serverLabel(server));
        row.addView(label, new LinearLayout.LayoutParams(0,
                ViewGroup.LayoutParams.WRAP_CONTENT, 1.15f));

        TextView state = new TextView(this);
        state.setText(version.needsUpdate() ? R.string.dmp_update_needed : R.string.dmp_update_blank);
        state.setTextColor(getColor(version.needsUpdate()
                ? R.color.dmp_warning
                : R.color.dmp_text_muted));
        state.setTextSize(12f);
        state.setGravity(Gravity.CENTER);
        row.addView(state, new LinearLayout.LayoutParams(dpToPx(72),
                ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView current = new TextView(this);
        current.setText(getString(R.string.dmp_update_current, local));
        current.setTextColor(getColor(R.color.dmp_text_secondary));
        current.setTextSize(13f);
        current.setGravity(Gravity.END | Gravity.CENTER_VERTICAL);
        current.setPadding(dpToPx(8), 0, dpToPx(10), 0);
        row.addView(current, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        Button update = new Button(this);
        update.setText(R.string.dmp_update_one);
        update.setTextSize(12f);
        update.setMinHeight(0);
        update.setMinWidth(0);
        update.setPadding(dpToPx(10), 0, dpToPx(10), 0);
        boolean canUpdate = version.taskApiSupported;
        if (!canUpdate) {
            update.setText(R.string.dmp_update_unavailable);
        }
        update.setEnabled(canUpdate);
        if (canUpdate) {
            update.setOnClickListener(v -> protectedSingleUpdate(server, update, dialog));
        }
        row.addView(update, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, dpToPx(40)));
        return row;
    }

    private void setUpdateConsoleTitle(TextView view, String latest) {
        String main = getString(R.string.dmp_update_console);
        String detail = getString(R.string.dmp_update_console_latest, latest);
        SpannableStringBuilder title = new SpannableStringBuilder(main).append(detail);
        title.setSpan(new StyleSpan(android.graphics.Typeface.BOLD), 0, main.length(),
                Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        title.setSpan(new RelativeSizeSpan(0.68f), main.length(), title.length(),
                Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        title.setSpan(new ForegroundColorSpan(getColor(R.color.dmp_text_secondary)),
                main.length(), title.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        view.setText(title);
    }

    private void startSingleUpdate(DmpServer server, Button button, AlertDialog dialog) {
        button.setEnabled(false);
        apiClient.startGameUpdate(server, true, new DmpApiClient.UpdateCallback() {
            @Override
            public void onSuccess(DmpTask task, boolean started, boolean deduplicated) {
                runOnUiThread(() -> {
                    button.setText(R.string.dmp_update_submitted);
                    Toast.makeText(DmpActivity.this, R.string.dmp_update_request_sent,
                            Toast.LENGTH_SHORT).show();
                });
            }

            @Override
            public void onUnsupported() {
                runOnUiThread(() -> {
                    button.setText(R.string.dmp_update_unavailable);
                    Toast.makeText(DmpActivity.this, R.string.dmp_update_unavailable,
                            Toast.LENGTH_SHORT).show();
                });
            }

            @Override
            public void onError(String message) {
                runOnUiThread(() -> {
                    button.setEnabled(true);
                    Toast.makeText(DmpActivity.this, shortenError(message),
                            Toast.LENGTH_SHORT).show();
                });
            }
        });
    }

    private void protectedSingleUpdate(DmpServer server, Button button, AlertDialog dialog) {
        String key = server.id;
        long now = android.os.SystemClock.uptimeMillis();
        Long previous = singleUpdateClickAt.get(key);
        int count = previous == null || now - previous > 1200L
                ? 1 : singleUpdateClickCount.get(key) + 1;
        singleUpdateClickAt.put(key, now);
        singleUpdateClickCount.put(key, count);
        if (count >= 3) {
            singleUpdateClickAt.remove(key);
            singleUpdateClickCount.remove(key);
            startSingleUpdate(server, button, dialog);
        } else {
            Toast.makeText(this, getString(R.string.dmp_update_triple_hint, 3 - count),
                    Toast.LENGTH_SHORT).show();
        }
    }

    private void protectedBatchUpdate(
            Map<DmpServer, DmpVersion> versions,
            boolean force,
            AlertDialog dialog) {
        long now = android.os.SystemClock.uptimeMillis();
        if (force) {
            allUpdateClickCount = now - allUpdateClickAt > 1200L ? 1 : allUpdateClickCount + 1;
            allUpdateClickAt = now;
            if (allUpdateClickCount >= 3) {
                allUpdateClickCount = 0;
                startUpdates(versions, true, dialog);
            } else {
                Toast.makeText(this, getString(R.string.dmp_update_triple_hint,
                        3 - allUpdateClickCount), Toast.LENGTH_SHORT).show();
            }
        } else {
            oldUpdateClickCount = now - oldUpdateClickAt > 1200L ? 1 : oldUpdateClickCount + 1;
            oldUpdateClickAt = now;
            if (oldUpdateClickCount >= 3) {
                oldUpdateClickCount = 0;
                startUpdates(versions, false, dialog);
            } else {
                Toast.makeText(this, getString(R.string.dmp_update_triple_hint,
                        3 - oldUpdateClickCount), Toast.LENGTH_SHORT).show();
            }
        }
    }

    private boolean hasOldServer(Map<DmpServer, DmpVersion> versions) {
        synchronized (versions) {
            for (DmpVersion version : versions.values()) {
                if (version.needsUpdate()) {
                    return true;
                }
            }
        }
        return false;
    }

    private boolean hasTaskServer(Map<DmpServer, DmpVersion> versions) {
        synchronized (versions) {
            for (DmpVersion version : versions.values()) {
                if (version != null) {
                    return true;
                }
            }
        }
        return false;
    }

    private void startUpdates(
            Map<DmpServer, DmpVersion> versions,
            boolean force,
            AlertDialog dialog) {
        List<DmpServer> targets = new ArrayList<>();
        synchronized (versions) {
            for (Map.Entry<DmpServer, DmpVersion> entry : versions.entrySet()) {
                DmpVersion version = entry.getValue();
                if (force || version.needsUpdate()) {
                    targets.add(entry.getKey());
                }
            }
        }
        if (targets.isEmpty()) {
            return;
        }
        dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setEnabled(false);
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);
        AtomicInteger remaining = new AtomicInteger(targets.size());
        AtomicInteger succeeded = new AtomicInteger();
        AtomicInteger failed = new AtomicInteger();
        for (DmpServer server : targets) {
            apiClient.startGameUpdate(server, force, new DmpApiClient.UpdateCallback() {
                @Override
                public void onSuccess(DmpTask task, boolean started, boolean deduplicated) {
                    succeeded.incrementAndGet();
                    completeUpdateRequests(dialog, remaining, succeeded, failed);
                }

                @Override
                public void onUnsupported() {
                    failed.incrementAndGet();
                    completeUpdateRequests(dialog, remaining, succeeded, failed);
                }

                @Override
                public void onError(String message) {
                    failed.incrementAndGet();
                    completeUpdateRequests(dialog, remaining, succeeded, failed);
                }
            });
        }
    }

    private void completeUpdateRequests(
            AlertDialog dialog,
            AtomicInteger remaining,
            AtomicInteger succeeded,
            AtomicInteger failed) {
        if (remaining.decrementAndGet() != 0) {
            return;
        }
        runOnUiThread(() -> {
            if (dialog.isShowing()) {
                dialog.dismiss();
            }
            if (failed.get() == 0) {
                Toast.makeText(this, R.string.dmp_update_request_sent, Toast.LENGTH_SHORT).show();
            } else {
                Toast.makeText(this, getString(
                        R.string.dmp_update_request_partial,
                        succeeded.get(),
                        failed.get()), Toast.LENGTH_LONG).show();
            }
            showTaskDialog();
        });
    }

    private List<DmpServer> uniqueServers() {
        LinkedHashMap<String, DmpServer> unique = new LinkedHashMap<>();
        for (DmpServer server : servers) {
            unique.put(server.baseUrl().toLowerCase(), server);
        }
        return new ArrayList<>(unique.values());
    }

    private String serverLabel(DmpServer server) {
        return server.remark == null || server.remark.trim().isEmpty()
                ? server.host
                : server.remark.trim();
    }

    private String taskStatusText(String status) {
        switch (status) {
            case "running":
                return "进行中";
            case "success":
                return "已完成";
            case "failed":
            case "error":
                return "失败";
            case "queued":
                return "等待中";
            case "paused":
                return "已暂停";
            default:
                return "状态未知";
        }
    }

    private String taskStageText(String stage) {
        switch (stage) {
            case "stopping":
                return "关闭房间";
            case "downloading":
                return "下载";
            case "installing":
                return "安装";
            case "restarting":
                return "恢复房间";
            case "completed":
                return "完成";
            case "up_to_date":
                return "已是最新版";
            default:
                return "等待";
        }
    }

    private String formatBytes(long bytes) {
        if (bytes < 1024) {
            return bytes + " B";
        }
        if (bytes < 1024L * 1024L) {
            return String.format(java.util.Locale.US, "%.1f KB", bytes / 1024d);
        }
        if (bytes < 1024L * 1024L * 1024L) {
            return String.format(java.util.Locale.US, "%.1f MB", bytes / 1024d / 1024d);
        }
        return String.format(java.util.Locale.US, "%.1f GB", bytes / 1024d / 1024d / 1024d);
    }

    private void showServerDialog(@Nullable DmpServer existing) {
        Dialog dialog = new Dialog(this);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        DialogDmpServerBinding dialogBinding = DialogDmpServerBinding.inflate(getLayoutInflater());
        dialog.setContentView(dialogBinding.getRoot());
        dialog.setCancelable(true);

        ArrayAdapter<String> protocolAdapter = new ArrayAdapter<>(
                this,
                R.layout.item_dmp_protocol,
                new String[]{"HTTP", "HTTPS"});
        protocolAdapter.setDropDownViewResource(R.layout.item_dmp_protocol);
        dialogBinding.dmpProtocol.setAdapter(protocolAdapter);
        dialogBinding.dmpDialogTitle.setText(existing == null
                ? R.string.dmp_create
                : R.string.dmp_edit_server);

        if (existing != null) {
            dialogBinding.dmpHostInput.setText(existing.host);
            dialogBinding.dmpPortInput.setText(String.valueOf(existing.port));
            dialogBinding.dmpProtocol.setSelection("https".equals(existing.protocol) ? 1 : 0);
            dialogBinding.dmpTokenInput.setText(existing.token);
            dialogBinding.dmpRemarkInput.setText(existing.remark);
        } else {
            dialogBinding.dmpPortInput.setText(R.string.dmp_default_port);
        }

        dialogBinding.dmpDialogCancel.setOnClickListener(v -> dialog.dismiss());
        dialogBinding.dmpDialogSubmit.setOnClickListener(v -> {
            String hostInput = textOf(dialogBinding.dmpHostInput.getText());
            String portInput = textOf(dialogBinding.dmpPortInput.getText());
            String token = textOf(dialogBinding.dmpTokenInput.getText());
            String remark = textOf(dialogBinding.dmpRemarkInput.getText());
            String protocol = dialogBinding.dmpProtocol.getSelectedItemPosition() == 1
                    ? "https"
                    : "http";

            ParsedAddress parsed = parseAddress(hostInput, protocol, portInput);
            if (parsed == null) {
                dialogBinding.dmpHostLayout.setError(getString(R.string.dmp_invalid_host));
                return;
            }
            dialogBinding.dmpHostLayout.setError(null);
            if (parsed.port < 1 || parsed.port > 65535) {
                dialogBinding.dmpPortLayout.setError(getString(R.string.dmp_invalid_port));
                return;
            }
            dialogBinding.dmpPortLayout.setError(null);
            if (token.isEmpty()) {
                dialogBinding.dmpTokenLayout.setError(getString(R.string.dmp_token_required));
                return;
            }
            dialogBinding.dmpTokenLayout.setError(null);

            DmpServer server = new DmpServer(
                    existing == null ? UUID.randomUUID().toString() : existing.id,
                    parsed.host,
                    parsed.port,
                    parsed.protocol,
                    token,
                    remark);
            if (existing == null) {
                servers.add(server);
            } else {
                int index = servers.indexOf(existing);
                if (index >= 0) {
                    servers.set(index, server);
                }
            }
            store.save(servers);
            serverAdapter.setServers(servers);
            dialog.dismiss();
            refreshServer(server);
            Toast.makeText(this,
                    existing == null ? R.string.dmp_created : R.string.dmp_updated,
                    Toast.LENGTH_SHORT).show();
        });

        dialog.setOnShowListener(ignored -> {
            Window window = dialog.getWindow();
            if (window == null) {
                return;
            }
            window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
            int maxWidth = dpToPx(720);
            int availableWidth = getResources().getDisplayMetrics().widthPixels - dpToPx(40);
            WindowManager.LayoutParams params = new WindowManager.LayoutParams();
            params.copyFrom(window.getAttributes());
            params.width = Math.min(maxWidth, availableWidth);
            params.height = ViewGroup.LayoutParams.WRAP_CONTENT;
            params.gravity = Gravity.CENTER;
            window.setAttributes(params);
        });
        dialog.show();
    }

    @Nullable
    private ParsedAddress parseAddress(String rawHost, String selectedProtocol, String rawPort) {
        String host = rawHost.trim();
        String protocol = selectedProtocol;
        int port;
        try {
            port = Integer.parseInt(rawPort.trim());
        } catch (NumberFormatException exception) {
            return null;
        }
        if (host.startsWith("http://") || host.startsWith("https://")) {
            Uri uri = Uri.parse(host);
            if (uri.getHost() == null) {
                return null;
            }
            host = uri.getHost();
            protocol = "https".equalsIgnoreCase(uri.getScheme()) ? "https" : "http";
            if (uri.getPort() > 0) {
                port = uri.getPort();
            }
        } else {
            int slash = host.indexOf('/');
            if (slash >= 0) {
                host = host.substring(0, slash);
            }
        }
        if (host.isEmpty() || host.contains(" ")) {
            return null;
        }
        return new ParsedAddress(host, port, protocol);
    }

    private String textOf(@Nullable CharSequence value) {
        return value == null ? "" : value.toString().trim();
    }

    private int dpToPx(int dp) {
        return Math.round(dp * getResources().getDisplayMetrics().density);
    }

    private void applyLargeDialogCorners(@Nullable AlertDialog dialog) {
        if (dialog == null || dialog.getWindow() == null) {
            return;
        }
        GradientDrawable background = new GradientDrawable();
        background.setColor(getColor(R.color.dmp_card));
        background.setCornerRadius(dpToPx(28));
        dialog.getWindow().setBackgroundDrawable(background);
    }

    @Override
    protected void onDestroy() {
        destroyed = true;
        roomLoadGeneration++;
        handler.removeCallbacks(periodicRefresh);
        apiClient.shutdown();
        binding = null;
        super.onDestroy();
    }

    private static class ParsedAddress {
        final String host;
        final int port;
        final String protocol;

        ParsedAddress(String host, int port, String protocol) {
            this.host = host;
            this.port = port;
            this.protocol = protocol;
        }
    }
}
