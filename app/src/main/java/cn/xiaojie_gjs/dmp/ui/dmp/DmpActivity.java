package cn.xiaojie_gjs.dmp.ui.dmp;

import android.app.Dialog;
import android.animation.ObjectAnimator;
import android.animation.ValueAnimator;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.Paint;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.text.style.RelativeSizeSpan;
import android.text.style.StyleSpan;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewParent;
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
import android.widget.GridLayout;
import android.view.animation.LinearInterpolator;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.appcompat.app.AppCompatDelegate;
import androidx.appcompat.app.AlertDialog;
import androidx.recyclerview.widget.GridLayoutManager;

import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.google.android.material.card.MaterialCardView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import cn.xiaojie_gjs.dmp.R;
import cn.xiaojie_gjs.dmp.BuildConfig;
import cn.xiaojie_gjs.dmp.databinding.ActivityDmpBinding;
import cn.xiaojie_gjs.dmp.databinding.DialogDmpServerBinding;

/** Native multi-server launcher and on-demand cross-server room browser. */
public class DmpActivity extends AppCompatActivity
        implements DmpServerAdapter.Listener, DmpRoomAdapter.Listener {

    private static final String TAG = "DmpRoomSelection";
    private static final long REFRESH_INTERVAL_MS = 5000L;
    private static final long DMP_VERSION_PROBE_INTERVAL_MS = 5 * 60 * 1000L;
    private static final String UI_PREFERENCES = "dmp_ui_preferences";
    private static final String PREF_NIGHT_MODE = "night_mode";
    private static final String PREF_DEVELOPER_MODE = "developer_mode";
    private static final String PREF_ANDROID_DOWNLOAD_UI = "android_download_ui";
    private static final String PREF_ANDROID_MOD_CONFIG_UI = "android_mod_config_ui";
    private static final String PREF_DISMISSED_UPDATE_TASKS = "dismissed_update_tasks";
    private static final String PREF_DISMISSED_TASKS = "dismissed_tasks";
    /** Legacy (boolean-only) update rows can be removed locally while the
     * server continues working.  Keep that dismissal server-scoped so a
     * later refresh does not resurrect the same unknown-progress row. */
    private static final String PREF_DISMISSED_LEGACY_UPDATE_SERVERS =
            "dismissed_legacy_update_servers";
    private static final String PREF_LOCAL_UPDATE_TASKS = "local_update_tasks";
    private static final String PREF_ACKNOWLEDGED_TASK_ERRORS =
            "acknowledged_task_errors";
    private static final String STATE_ROOM_MODE = "room_mode";
    private static final String STATE_ROOM_SERVER_IDS = "room_server_ids";
    private static final String STATE_ROOM_IDS = "room_ids";
    private static final String STATE_ROOM_NAMES = "room_names";
    private static final String STATE_ROOM_GAME_MODES = "room_game_modes";
    private static final String STATE_ROOM_ONLINE = "room_online";
    private static final String STATE_ROOM_RUNNING = "room_running";
    private static final String STATE_ROOM_WORLD_COUNTS = "room_world_counts";
    private static final String STATE_ROOM_MAX_PLAYERS = "room_max_players";
    private static final String STATE_ROOM_ONLINE_PLAYERS = "room_online_players";
    private static final String STATE_ROOM_PLAYER_NAMES = "room_player_names";
    private static final String STATE_ROOM_MASTER_WORLD_IDS = "room_master_world_ids";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private DmpApiClient apiClient;
    private final Runnable periodicRefresh = new Runnable() {
        @Override
        public void run() {
            /* Keep both top-level views live.  The launcher refreshes server
             * metrics; the aggregate room overview must also refresh its
             * online/running state and player snapshot, otherwise the count
             * and player list remain frozen until a manual pull gesture.  A
             * non-rendering room refresh updates the adapter in place and
             * avoids clearing the visible list or showing a loading spinner
             * every five seconds. */
            if (roomMode) {
                refreshRooms(false);
            } else {
                refreshAll();
            }
            handler.postDelayed(this, REFRESH_INTERVAL_MS);
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
    /** Advanced Android presentation switches are hidden unless enabled. */
    private boolean developerMode;
    /** Android presentation layers are enabled by default for the mobile app. */
    private boolean androidDownloadUi;
    private boolean androidModConfigUi;
    @Nullable
    private android.widget.Switch settingsNightSwitch;
    private int roomLoadGeneration;
    /** True once the background room overview snapshot has completed. */
    private boolean roomSnapshotReady;
    /** Prevent duplicate background loads while the overview is prefetched. */
    private boolean roomSnapshotLoading;
    private int spanCount;
    private int latestDmpVersion;
    /** Highest installed DMP Web release discovered among configured hosts. */
    private String latestInstalledDmpVersion = "";
    private int taskLoadGeneration;
    /** Monotonic request id for aggregate task refreshes.  A slow response
     * from an older poll must not overwrite the newer poll's snapshot. */
    private int taskRefreshRequestId;
    private int downloadProgressGeneration;
    private long taskDialogInteractionLockedUntil;
    private List<DmpRoom> roomSnapshot = new ArrayList<>();
    @Nullable
    private AlertDialog taskDialog;
    @Nullable
    private AlertDialog updateDialog;
    @Nullable
    private AlertDialog settingsDialog;
    @Nullable
    private LinearLayout taskDialogContent;
    /** Current tab in the aggregate task centre: 0 = tasks, 1 = notices. */
    private int taskDialogTab;
    @Nullable
    private TextView taskDialogTasksTab;
    @Nullable
    private TextView taskDialogNotificationsTab;
    /** Acknowledged aggregate notifications stay quiet until a new refresh
     * reports a different update.  This mirrors the WebView notification
     * centre without coupling the native card to its DOM. */
    private final Set<String> acknowledgedPlatformNotifications = new HashSet<>();
    @Nullable
    private ImageView taskDeleteSpinner;
    /** Short-click control for clearing completed rows; long-press opens the
     * explicit all-task deletion confirmation. */
    @Nullable
    private ImageButton taskClearCompletedButton;
    @Nullable
    private ObjectAnimator taskDeleteSpinnerAnimator;
    private int taskDeleteRequestsInFlight;
    private SharedPreferences uiPreferences;
    private final Set<String> dismissedUpdateTasks = new HashSet<>();
    /** Terminal task records explicitly cleared by the user. */
    private final Set<String> dismissedTasks = new HashSet<>();
    /** Legacy update rows explicitly removed by the user (server IDs only). */
    private final Set<String> dismissedLegacyUpdateServers = new HashSet<>();
    private List<DmpTask> visibleTaskSnapshot = new ArrayList<>();
    /** Latest background task snapshot, available before the task dialog opens. */
    private volatile List<DmpTask> prefetchedTaskSnapshot = new ArrayList<>();
    /**
     * Stable aggregate ordering.  Server status polls update progress and
     * timestamps independently; sorting directly by those values made rows
     * swap places every poll.  Keep the first-seen semantic task order and
     * append genuinely new tasks in a deterministic order instead.
     */
    private final List<String> taskStableOrder = new ArrayList<>();
    /** Rows whose latest action is awaiting a server acknowledgement. */
    private final Set<String> pendingTaskActions = new HashSet<>();
    /** Failure tokens acknowledged from the aggregate task entry. */
    private final Set<String> acknowledgedTaskErrors = new HashSet<>();
    /** A retry request that failed before a new server task was created. */
    private final Set<String> retryFailureTasks = new HashSet<>();
    @Nullable
    private String taskFeedback;
    /**
     * Rendered feedback view kept separate from the asynchronously refreshed
     * task rows.  A server request can take several seconds; mounting this
     * view immediately prevents the three-second acknowledgement from being
     * lost while the next task snapshot is in flight.
     */
    @Nullable
    private TextView taskFeedbackView;
    private final Runnable clearTaskFeedback = () -> {
        // Keep the acknowledgement visible for the requested three seconds,
        // then fade it out instead of removing it abruptly.  Clear the
        // backing value before starting the animation so a new action can
        // safely replace it while this one is fading.
        taskFeedback = null;
        final TextView fadingView = taskFeedbackView;
        if (fadingView == null) {
            return;
        }
        fadingView.animate().cancel();
        fadingView.animate()
                .alpha(0f)
                .setDuration(450L)
                .withEndAction(() -> {
                    // A new acknowledgement may have reused this TextView
                    // while the old one was fading.  Never remove that newer
                    // message or leave its alpha at zero.
                    if (taskFeedback != null || taskFeedbackView != fadingView) {
                        return;
                    }
                    // Keep the fixed-height slot at the bottom of the task
                    // card. Removing it made the whole dialog jump upward
                    // whenever the three-second message expired.
                    fadingView.setText("");
                    fadingView.setAlpha(0f);
                })
                .start();
    };
    /** Immediate acknowledgement for legacy dashboard updates without /tasks. */
    private final Map<String, DmpTask> localUpdateTasks =
            Collections.synchronizedMap(new LinkedHashMap<>());
    /** Monotonic start time for old dashboard updates (used for race handling). */
    private final Map<String, Long> legacyUpdateStartedAt =
            Collections.synchronizedMap(new LinkedHashMap<>());
    /** Whether the old host has actually reported that SteamCMD is running. */
    private final Map<String, Boolean> legacyUpdateObserved =
            Collections.synchronizedMap(new LinkedHashMap<>());
    /** Last server-side updating flag, used to require a true -> false edge. */
    private final Map<String, Boolean> legacyUpdateLastUpdating =
            Collections.synchronizedMap(new LinkedHashMap<>());
    /** Version observed on the first status poll after a legacy update request. */
    private final Map<String, Integer> legacyUpdateInitialVersions =
            Collections.synchronizedMap(new LinkedHashMap<>());

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        uiPreferences = getSharedPreferences(UI_PREFERENCES, MODE_PRIVATE);
        dismissedUpdateTasks.addAll(uiPreferences.getStringSet(
                PREF_DISMISSED_UPDATE_TASKS, Collections.emptySet()));
        dismissedTasks.addAll(uiPreferences.getStringSet(
                PREF_DISMISSED_TASKS, Collections.emptySet()));
        dismissedLegacyUpdateServers.addAll(uiPreferences.getStringSet(
                PREF_DISMISSED_LEGACY_UPDATE_SERVERS, Collections.emptySet()));
        acknowledgedTaskErrors.addAll(uiPreferences.getStringSet(
                PREF_ACKNOWLEDGED_TASK_ERRORS, Collections.emptySet()));
        nightMode = uiPreferences.getBoolean(PREF_NIGHT_MODE, true);
        // Developer-only presentation switches are currently kept off for the
        // production APK.  Clear a value left by an older build as well, so a
        // previously enabled developer mode cannot reappear or alter the
        // bootstrap flags after an upgrade.
        developerMode = false;
        uiPreferences.edit().putBoolean(PREF_DEVELOPER_MODE, false).apply();
        // The developer switch is permanently locked off in this build; the
        // mobile download/configuration presentation therefore remains the
        // supported default and cannot be disabled by a stale old preference.
        androidDownloadUi = true;
        androidModConfigUi = true;
        uiPreferences.edit()
                .putBoolean(PREF_ANDROID_DOWNLOAD_UI, true)
                .putBoolean(PREF_ANDROID_MOD_CONFIG_UI, true)
                .apply();
        getDelegate().setLocalNightMode(nightMode
                ? AppCompatDelegate.MODE_NIGHT_YES
                : AppCompatDelegate.MODE_NIGHT_NO);
        getWindow().setBackgroundDrawable(new ColorDrawable(themeBackground(nightMode)));
        super.onCreate(savedInstanceState);
        apiClient = new DmpApiClient(getApplicationContext());
        binding = ActivityDmpBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());

        store = new DmpServerStore(this);
        servers = store.load();
        restoreLocalUpdateTasks();
        serverAdapter = new DmpServerAdapter(this);
        serverAdapter.setServers(servers);
        roomAdapter = new DmpRoomAdapter(this);
        spanCount = getResources().getConfiguration().screenWidthDp >= 900 ? 2 : 1;

        binding.dmpRefreshLayout.setOnRefreshListener(() -> {
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "pull refresh requested roomMode=" + roomMode
                        + " selections=" + selectionSummary());
            }
            if (roomMode) {
                refreshRooms();
            } else {
                // A server refresh only updates transient metrics.  Reload the
                // durable room choices first so a stale in-memory object can
                // never turn a refresh into an implicit "未选择" state.
                restorePersistedRoomSelections();
                binding.dmpRoomLoading.setVisibility(View.VISIBLE);
                refreshAll(() -> {
                    restorePersistedRoomSelections();
                    if (BuildConfig.DEBUG) {
                        Log.d(TAG, "pull refresh completed selections=" + selectionSummary());
                    }
                    binding.dmpRoomLoading.setVisibility(View.GONE);
                    binding.dmpRefreshLayout.setRefreshing(false);
                });
            }
        });
        binding.dmpRefreshLayout.setOnHorizontalSwipeListener(direction -> {
            // Both directions switch the two top-level management views.  A
            // deliberate 72dp gesture is required by DmpPullRefreshLayout,
            // so this does not interfere with card taps or vertical scrolling.
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "top-level swipe direction=" + direction
                        + " roomMode=" + roomMode);
            }
            switchRoomMode(!roomMode);
        });
        binding.dmpRoomMode.setOnClickListener(v -> switchRoomMode(!roomMode));
        binding.dmpSettings.setOnClickListener(v -> showSettingsDialog());
        binding.dmpImportBlacklist.setOnClickListener(v -> importCommunityBlacklist());
        binding.dmpDownloadTasks.setOnClickListener(v -> {
            // The aggregate entry acknowledges every currently visible
            // failure.  The task state itself remains failed, so a later
            // retry/new failure can turn the entry red again.
            acknowledgeTaskErrors(prefetchedTaskSnapshot);
            updateDownloadButtonState(prefetchedTaskSnapshot);
            showTaskDialog();
        });
        binding.dmpUpdateServers.setOnClickListener(v -> showUpdateDialog());
        binding.dmpThemeToggle.setOnClickListener(v -> toggleTheme(uiPreferences));
        updateThemeButton();
        binding.dmpDownloadProgress.setMax(100);
        binding.dmpDownloadProgress.setIndeterminate(false);
        binding.dmpDownloadProgress.setProgress(0);
        binding.dmpDownloadProgress.setVisibility(View.GONE);
        binding.getRoot().setAlpha(0f);
        binding.getRoot().animate().alpha(1f).setDuration(240L).start();

        boolean restoredRoomMode = savedInstanceState != null
                && savedInstanceState.getBoolean(STATE_ROOM_MODE, false);
        boolean restoredSnapshot = restoredRoomMode && restoreRoomSnapshot(savedInstanceState);
        switchRoomMode(restoredRoomMode, !restoredSnapshot);
        // Keep the launcher on the platform-management view, but warm the
        // aggregate room overview in the background.  Entering that view can
        // then render the already fetched snapshot instead of issuing a second
        // request.  Pull-to-refresh remains the explicit refresh path.
        if (!restoredRoomMode && !restoredSnapshot) {
            preloadRoomsInBackground();
        }
    }

    @Override
    protected void onStart() {
        super.onStart();
        handler.removeCallbacks(periodicRefresh);
        handler.post(periodicRefresh);
    }

    @Override
    public void onConfigurationChanged(@NonNull Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        int updatedSpanCount = newConfig.screenWidthDp >= 900 ? 2 : 1;
        if (updatedSpanCount != spanCount) {
            spanCount = updatedSpanCount;
            switchRoomMode(roomMode, false);
        }
        // The subtitle may gain or lose the installed-DMP suffix after a
        // rotation even when the launcher grid keeps the same span count.
        updateLauncherSubtitle();
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
        restorePersistedRoomSelection(server);
        if (BuildConfig.DEBUG) {
            Log.d(TAG, "platform entry server=" + server.id
                    + " selectedRoom=" + server.selectedRoomId
                    + " name=" + server.selectedRoomName);
        }
        if (server.selectedRoomId <= 0) {
            openPlatformDashboard(server);
            return;
        }

        // Do not blindly trust a stale local room id.  A room may have been
        // removed or recreated on the host since the last visit.  Validate a
        // positive selection against the current room list; on a successful
        // response, clear it when the room is gone and refresh its display name
        // when the server has renamed it.  A transient network error leaves
        // the durable selection intact and still lets the user enter.
        final int selectedId = server.selectedRoomId;
        apiClient.fetchRooms(server, new DmpApiClient.RoomsCallback() {
            @Override
            public void onSuccess(List<DmpRoom> rooms) {
                DmpRoom match = null;
                if (rooms != null) {
                    for (DmpRoom room : rooms) {
                        if (room != null && room.id == selectedId) {
                            match = room;
                            break;
                        }
                    }
                }
                DmpRoom validRoom = match;
                runOnUiThread(() -> {
                    if (destroyed) {
                        return;
                    }
                    if (validRoom == null) {
                        clearPersistedRoomSelection(server);
                        if (BuildConfig.DEBUG) {
                            Log.d(TAG, "selection invalidated server=" + server.id
                                    + " room=" + selectedId + " (not in current room list)");
                        }
                    } else if (!validRoom.gameName.equals(server.selectedRoomName)) {
                        persistRoomSelection(server, validRoom.id, validRoom.gameName);
                        if (BuildConfig.DEBUG) {
                            Log.d(TAG, "selection name refreshed server=" + server.id
                                    + " room=" + validRoom.id + " name=" + validRoom.gameName);
                        }
                    }
                    openPlatformDashboard(server);
                });
            }

            @Override
            public void onError(String message) {
                if (BuildConfig.DEBUG) {
                    Log.d(TAG, "selection validation skipped server=" + server.id
                            + " reason=" + (message == null ? "unknown" : message));
                }
                runOnUiThread(() -> {
                    if (!destroyed) {
                        openPlatformDashboard(server);
                    }
                });
            }
        });
    }

    @Override
    public void onOpenRoom(DmpRoom room) {
        // This launch originates in total-room management.  The WebView must
        // return directly to that native list from the control panel rather
        // than opening the room preview a second time.
        openDashboard(room.server, room.id, room.gameName, true);
    }

    @Override
    public void onRoomActions(DmpRoom room) {
        showRoomActionsDialog(room);
    }

    @Override
    public void onCreateRoom() {
        showCreateRoomDialog();
    }

    private void openPlatformDashboard(DmpServer server) {
        openDashboard(server, 0, "", true, server.selectedRoomId, server.selectedRoomName, false);
    }

    private void openDashboard(DmpServer server, int roomId, String roomName) {
        openDashboard(server, roomId, roomName, false, 0, "", false);
    }

    private void openDashboard(
            DmpServer server,
            int roomId,
            String roomName,
            boolean fromRoomManagement) {
        openDashboard(server, roomId, roomName, false, 0, "", fromRoomManagement);
    }

    private void openDashboard(
            DmpServer server,
            int roomId,
            String roomName,
            boolean persistRoomSelection,
            int selectedRoomId,
            String selectedRoomName,
            boolean fromRoomManagement) {
        Intent intent = new Intent(this, DmpWebActivity.class);
        intent.putExtra(DmpWebActivity.EXTRA_SERVER_ID, server.id);
        intent.putExtra(DmpWebActivity.EXTRA_SERVER_HOST, server.host);
        intent.putExtra(DmpWebActivity.EXTRA_SERVER_PORT, server.port);
        intent.putExtra(DmpWebActivity.EXTRA_SERVER_PROTOCOL, server.protocol);
        intent.putExtra(DmpWebActivity.EXTRA_SERVER_TOKEN, server.token);
        intent.putExtra(DmpWebActivity.EXTRA_SERVER_REMARK, server.remark);
        intent.putExtra(DmpWebActivity.EXTRA_ROOM_ID, roomId);
        intent.putExtra(DmpWebActivity.EXTRA_ROOM_NAME, roomName);
        intent.putExtra(DmpWebActivity.EXTRA_PERSIST_ROOM_SELECTION, persistRoomSelection);
        intent.putExtra(DmpWebActivity.EXTRA_SELECTED_ROOM_ID, selectedRoomId);
        intent.putExtra(DmpWebActivity.EXTRA_SELECTED_ROOM_NAME, selectedRoomName);
        intent.putExtra(DmpWebActivity.EXTRA_FROM_ROOM_MANAGEMENT, fromRoomManagement);
        intent.putExtra(DmpWebActivity.EXTRA_NIGHT_MODE, nightMode);
        intent.putExtra(DmpWebActivity.EXTRA_ANDROID_DOWNLOAD_UI, androidDownloadUi);
        intent.putExtra(DmpWebActivity.EXTRA_ANDROID_MOD_CONFIG_UI, androidModConfigUi);
        startActivity(intent);
    }

    /**
     * The WebView writes the selected room through its bridge while this
     * native activity is stopped.  Refreshing/re-entering used to reuse the
     * stale in-memory DmpServer object and therefore cleared the room.  Reload
     * the durable record immediately before every platform entry so a refresh
     * cannot lose it; an absent record intentionally remains unselected.
     */
    private void restorePersistedRoomSelection(DmpServer server) {
        int previousId = server.selectedRoomId;
        String previousName = server.selectedRoomName;
        List<DmpServer> saved = store.load();
        for (DmpServer candidate : saved) {
            if (candidate.id.equals(server.id)) {
                server.selectedRoomId = Math.max(0, candidate.selectedRoomId);
                server.selectedRoomName = candidate.selectedRoomName == null
                        ? "" : candidate.selectedRoomName;
                if (BuildConfig.DEBUG) {
                    Log.d(TAG, "restore server=" + server.id
                            + " old=" + previousId + "/" + previousName
                            + " new=" + server.selectedRoomId + "/" + server.selectedRoomName);
                }
                return;
            }
        }
        server.selectedRoomId = 0;
        server.selectedRoomName = "";
        if (BuildConfig.DEBUG) {
            Log.d(TAG, "restore server=" + server.id + " no persisted selection");
        }
    }

    /** Reload every platform's durable room choice without touching metrics. */
    private void restorePersistedRoomSelections() {
        List<DmpServer> saved = store.load();
        int restored = 0;
        for (DmpServer server : servers) {
            for (DmpServer candidate : saved) {
                if (candidate.id.equals(server.id)) {
                    server.selectedRoomId = Math.max(0, candidate.selectedRoomId);
                    server.selectedRoomName = candidate.selectedRoomName == null
                            ? "" : candidate.selectedRoomName;
                    restored++;
                    break;
                }
            }
        }
        if (BuildConfig.DEBUG) {
            Log.d(TAG, "restore all selections matched=" + restored
                    + " total=" + servers.size());
        }
    }

    /** Persist a validated room choice while keeping the current object in sync. */
    private void persistRoomSelection(DmpServer server, int roomId, String roomName) {
        String safeName = roomName == null ? "" : roomName.trim();
        server.selectedRoomId = Math.max(0, roomId);
        server.selectedRoomName = safeName;
        List<DmpServer> saved = store.load();
        for (DmpServer candidate : saved) {
            if (candidate.id.equals(server.id)) {
                candidate.selectedRoomId = server.selectedRoomId;
                candidate.selectedRoomName = safeName;
                store.save(saved);
                return;
            }
        }
    }

    /** Clear a selection only after the server positively confirms it is gone. */
    private void clearPersistedRoomSelection(DmpServer server) {
        server.selectedRoomId = 0;
        server.selectedRoomName = "";
        List<DmpServer> saved = store.load();
        for (DmpServer candidate : saved) {
            if (candidate.id.equals(server.id)) {
                candidate.selectedRoomId = 0;
                candidate.selectedRoomName = "";
                store.save(saved);
                return;
            }
        }
    }

    private String selectionSummary() {
        StringBuilder summary = new StringBuilder();
        for (DmpServer server : servers) {
            if (summary.length() > 0) {
                summary.append(',');
            }
            summary.append(server.id).append('=').append(server.selectedRoomId);
        }
        return summary.toString();
    }

    @Override
    public void onRefresh(DmpServer server) {
        // A deliberate per-server refresh is allowed to re-check the static
        // Web bundle immediately; the periodic five-second monitor is not.
        server.dmpInstalledVersionCheckedAt = 0L;
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
        boolean modeChanged = roomMode != showRooms;
        if (modeChanged) {
            // Invalidate an in-flight room aggregation before changing the
            // adapter.  Otherwise its completion callback can be discarded
            // while leaving the pull container stuck in its refreshing state.
            // A startup preload is intentionally kept alive when entering the
            // overview; cancelling it here would force a second request.
            // Keep an in-flight startup/refresh request alive across a
            // launcher <-> room-overview switch.  Cancelling its generation
            // here would leave roomSnapshotLoading stuck and make the next
            // entry wait forever on a request that can no longer commit.
            if (!roomSnapshotLoading) {
                roomLoadGeneration++;
            }
            binding.dmpRefreshLayout.setRefreshing(false);
        }
        roomMode = showRooms;
        handler.removeCallbacks(periodicRefresh);
        binding.dmpRoomMode.setText(showRooms
                ? R.string.dmp_show_servers
                : R.string.dmp_show_rooms);
        binding.dmpLauncherTitle.setText(showRooms
                ? R.string.dmp_rooms_title
                : R.string.dmp_launcher_title);
        binding.dmpLauncherSubtitle.setText(showRooms
                ? R.string.dmp_rooms_subtitle
                : R.string.dmp_launcher_subtitle);
        if (!showRooms) {
            updateLauncherSubtitle();
        }
        binding.dmpDownloadTasks.setVisibility(showRooms ? View.GONE : View.VISIBLE);
        binding.dmpUpdateServers.setVisibility(showRooms ? View.GONE : View.VISIBLE);
        binding.dmpImportBlacklist.setVisibility(showRooms ? View.VISIBLE : View.GONE);
        if (showRooms) {
            binding.dmpDownloadProgress.setVisibility(View.GONE);
        } else {
            refreshDownloadProgress();
        }
        binding.dmpRoomEmpty.setVisibility(View.GONE);
        binding.dmpRoomLoading.setVisibility(View.GONE);

        if (showRooms) {
            GridLayoutManager roomLayoutManager = new GridLayoutManager(this, spanCount);
            roomLayoutManager.setSpanSizeLookup(new GridLayoutManager.SpanSizeLookup() {
                @Override
                public int getSpanSize(int position) {
                    return position == roomAdapter.getItemCount() - 1 ? spanCount : 1;
                }
            });
            binding.dmpServerList.setLayoutManager(roomLayoutManager);
            binding.dmpServerList.setAdapter(roomAdapter);
            if (refreshRoomSnapshot && !roomSnapshotReady) {
                if (roomSnapshotLoading) {
                    binding.dmpRoomLoading.setVisibility(View.VISIBLE);
                } else {
                    refreshRooms();
                }
            } else {
                roomAdapter.setRooms(roomSnapshot);
                binding.dmpRoomEmpty.setVisibility(
                        roomSnapshot.isEmpty() ? View.VISIBLE : View.GONE);
            }
            // switchRoomMode() removes the shared timer before changing the
            // adapter. Re-arm it here as well as in onStart(), otherwise a
            // user who enters the aggregate overview while the activity is
            // already foregrounded would never receive the five-second room
            // and player refreshes.
            if (hasWindowFocus()) {
                handler.post(periodicRefresh);
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
        refreshRooms(true);
    }

    /**
     * Warm the room overview without changing the current launcher page.  The
     * first switch to room mode consumes this snapshot; only pull-to-refresh
     * calls the rendered variant again.
     */
    private void preloadRoomsInBackground() {
        if (roomSnapshotReady || roomSnapshotLoading || servers.isEmpty()) {
            return;
        }
        refreshRooms(false);
    }

    /**
     * Import the public DST Block list through each room's DMP backend.
     *
     * The public list is intentionally never fetched by the Android client:
     * LinuxDMP owns that external request and performs its normal de-duplication
     * when it receives the same action payload as the desktop client.
     */
    private void importCommunityBlacklist() {
        LinkedHashMap<String, DmpRoom> unique = new LinkedHashMap<>();
        for (DmpRoom room : roomSnapshot) {
            if (room == null || room.server == null || room.id <= 0) {
                continue;
            }
            String serverId = room.server.id == null || room.server.id.trim().isEmpty()
                    ? room.server.host : room.server.id;
            unique.put(serverId + ":" + room.id, room);
        }
        if (unique.isEmpty()) {
            Toast.makeText(this, "当前没有可处理的房间", Toast.LENGTH_SHORT).show();
            return;
        }
        binding.dmpImportBlacklist.setEnabled(false);
        AtomicInteger remaining = new AtomicInteger(unique.size());
        AtomicInteger success = new AtomicInteger();
        AtomicInteger failures = new AtomicInteger();
        List<String> errors = Collections.synchronizedList(new ArrayList<>());
        for (DmpRoom room : unique.values()) {
            apiClient.importCommunityBlocklist(room.server, room.id,
                    new DmpApiClient.BlocklistImportCallback() {
                        private void complete() {
                            if (remaining.decrementAndGet() != 0) {
                                return;
                            }
                            runOnUiThread(() -> {
                                if (destroyed || binding == null) {
                                    return;
                                }
                                binding.dmpImportBlacklist.setEnabled(true);
                                int failed = failures.get();
                                String message = "社区黑名单导入完成：成功 " + success.get()
                                        + " 个房间";
                                if (failed > 0) {
                                    message += "，失败 " + failed + " 个房间";
                                    if (!errors.isEmpty() && errors.get(0) != null
                                            && !errors.get(0).trim().isEmpty()) {
                                        message += "（" + errors.get(0) + "）";
                                    }
                                }
                                Toast.makeText(DmpActivity.this, message,
                                        Toast.LENGTH_LONG).show();
                            });
                        }

                        @Override
                        public void onSuccess() {
                            success.incrementAndGet();
                            complete();
                        }

                        @Override
                        public void onError(String message) {
                            failures.incrementAndGet();
                            errors.add(message == null ? "导入失败" : message);
                            complete();
                        }
                    });
        }
    }

    private void refreshRooms(boolean render) {
        if (roomSnapshotLoading && !render) {
            return;
        }
        final int generation = ++roomLoadGeneration;
        roomSnapshotLoading = true;
        // Room mode still needs the platform metrics used by the create-room
        // chooser (online light, counts, CPU and memory).  This is a one-shot
        // refresh; the normal platform timer remains disabled in room mode.
        if (render) {
            refreshAll();
            roomAdapter.setRooms(new ArrayList<>());
            binding.dmpRoomEmpty.setVisibility(View.GONE);
            binding.dmpRoomLoading.setVisibility(View.VISIBLE);
        }
        if (servers.isEmpty()) {
            finishRoomRefresh(generation, new ArrayList<>(), 0, render);
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
                    completeRoomRequest(generation, aggregate, remaining, failures, render);
                }

                @Override
                public void onError(String message) {
                    failures.incrementAndGet();
                    completeRoomRequest(generation, aggregate, remaining, failures, render);
                }
            });
        }
    }

    private void completeRoomRequest(
            int generation,
            List<DmpRoom> aggregate,
            AtomicInteger remaining,
            AtomicInteger failures,
            boolean render) {
        if (remaining.decrementAndGet() != 0) {
            return;
        }
        List<DmpRoom> snapshot;
        synchronized (aggregate) {
            snapshot = new ArrayList<>(aggregate);
        }
        // A few DMP deployments have returned the same room row more than
        // once during a concurrent room/status refresh.  The room identity is
        // server-scoped, so collapse only exact (server, room-id) duplicates;
        // rooms with different IDs or names remain visible and are not
        // guessed to be duplicates.
        LinkedHashMap<String, DmpRoom> uniqueRooms = new LinkedHashMap<>();
        for (DmpRoom room : snapshot) {
            if (room == null || room.server == null || room.id <= 0) {
                continue;
            }
            String serverKey = room.server.id == null || room.server.id.trim().isEmpty()
                    ? room.server.baseUrl() : room.server.id.trim();
            String roomKey = serverKey + "|" + room.id;
            uniqueRooms.put(roomKey, room);
        }
        snapshot = new ArrayList<>(uniqueRooms.values());
        snapshot.sort(Comparator
                // Running + reachable rooms are the useful first group;
                // reachable but closed rooms follow; unreachable rooms are
                // kept at the bottom so they never interrupt active servers.
                .comparingInt((DmpRoom room) -> room.running && room.online ? 0
                        : !room.running && room.online ? 1
                        : room.running ? 2 : 3)
                .thenComparing(room -> room.gameName, String.CASE_INSENSITIVE_ORDER)
                .thenComparing(room -> room.server.remark.isEmpty()
                        ? room.server.host
                        : room.server.remark, String.CASE_INSENSITIVE_ORDER));
        finishRoomRefresh(generation, snapshot, failures.get(), render);
    }

    private void finishRoomRefresh(
            int generation, List<DmpRoom> rooms, int failures, boolean render) {
        runOnUiThread(() -> {
            if (destroyed || generation != roomLoadGeneration) {
                return;
            }
            roomSnapshotLoading = false;
            roomSnapshot = new ArrayList<>(rooms);
            roomSnapshotReady = true;
            if (roomMode) {
                binding.dmpRoomLoading.setVisibility(View.GONE);
                binding.dmpRefreshLayout.setRefreshing(false);
                roomAdapter.setRooms(rooms);
                binding.dmpRoomEmpty.setVisibility(rooms.isEmpty() ? View.VISIBLE : View.GONE);
                if (render && failures > 0) {
                    Toast.makeText(this, getString(R.string.dmp_room_partial, failures),
                            Toast.LENGTH_SHORT).show();
                }
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
        boolean[] running = new boolean[size];
        int[] worldCounts = new int[size];
        int[] maxPlayers = new int[size];
        int[] onlinePlayers = new int[size];
        int[] masterWorldIds = new int[size];
        String[] playerNames = new String[size];
        for (int index = 0; index < size; index++) {
            DmpRoom room = roomSnapshot.get(index);
            serverIds[index] = room.server.id;
            roomIds[index] = room.id;
            names[index] = room.gameName;
            modes[index] = room.gameMode;
            online[index] = room.online;
            running[index] = room.running;
            worldCounts[index] = room.worldCount;
            maxPlayers[index] = room.maxPlayers;
            onlinePlayers[index] = room.onlinePlayers;
            masterWorldIds[index] = room.masterWorldId;
            playerNames[index] = room.playerNames;
        }
        outState.putStringArray(STATE_ROOM_SERVER_IDS, serverIds);
        outState.putIntArray(STATE_ROOM_IDS, roomIds);
        outState.putStringArray(STATE_ROOM_NAMES, names);
        outState.putStringArray(STATE_ROOM_GAME_MODES, modes);
        outState.putBooleanArray(STATE_ROOM_ONLINE, online);
        outState.putBooleanArray(STATE_ROOM_RUNNING, running);
        outState.putIntArray(STATE_ROOM_WORLD_COUNTS, worldCounts);
        outState.putIntArray(STATE_ROOM_MAX_PLAYERS, maxPlayers);
        outState.putIntArray(STATE_ROOM_ONLINE_PLAYERS, onlinePlayers);
        outState.putIntArray(STATE_ROOM_MASTER_WORLD_IDS, masterWorldIds);
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
        boolean[] running = state.getBooleanArray(STATE_ROOM_RUNNING);
        int[] worldCounts = state.getIntArray(STATE_ROOM_WORLD_COUNTS);
        int[] maxPlayers = state.getIntArray(STATE_ROOM_MAX_PLAYERS);
        int[] onlinePlayers = state.getIntArray(STATE_ROOM_ONLINE_PLAYERS);
        int[] masterWorldIds = state.getIntArray(STATE_ROOM_MASTER_WORLD_IDS);
        String[] playerNames = state.getStringArray(STATE_ROOM_PLAYER_NAMES);
        if (serverIds == null || roomIds == null || names == null || modes == null
                || online == null || running == null || worldCounts == null || maxPlayers == null
                || onlinePlayers == null || playerNames == null) {
            return false;
        }
        int size = serverIds.length;
        if (roomIds.length != size || names.length != size || modes.length != size
                || online.length != size || running.length != size || worldCounts.length != size
                || maxPlayers.length != size || onlinePlayers.length != size
                || playerNames.length != size) {
            return false;
        }
        List<DmpRoom> restored = new ArrayList<>();
        for (int index = 0; index < size; index++) {
            DmpServer server = findServer(serverIds[index]);
            if (server != null) {
                restored.add(new DmpRoom(server, roomIds[index], names[index], modes[index],
                        online[index], running[index], worldCounts[index], maxPlayers[index],
                        onlinePlayers[index], playerNames[index],
                        masterWorldIds != null && masterWorldIds.length == size
                                ? masterWorldIds[index] : 0));
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
                    updateThemeButton();
                    // The transition view is only an animation layer. Leaving
                    // it attached made a light/dark rectangle cover dialogs
                    // and portions of the page after the first toggle.
                    content.removeView(transitionLayer);
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
        if (settingsNightSwitch != null && settingsNightSwitch.isChecked() != nightMode) {
            settingsNightSwitch.setOnCheckedChangeListener(null);
            settingsNightSwitch.setChecked(nightMode);
            settingsNightSwitch.setOnCheckedChangeListener(
                    (button, checked) -> {
                        if (checked != nightMode) {
                            toggleTheme(uiPreferences);
                        }
                    });
        }
    }

    /** Native settings card for app-wide mobile presentation preferences. */
    /** Native quick controls for one room in the aggregate room overview. */
    private void showRoomActionsDialog(@Nullable DmpRoom room) {
        if (room == null || room.server == null || room.id <= 0) {
            Toast.makeText(this, "房间无效", Toast.LENGTH_SHORT).show();
            return;
        }
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dpToPx(18), dpToPx(8), dpToPx(18), dpToPx(12));

        TextView hint = new TextView(this);
        hint.setText(room.gameName);
        hint.setTextColor(getColor(R.color.dmp_text_secondary));
        hint.setTextSize(14f);
        hint.setSingleLine(true);
        hint.setEllipsize(android.text.TextUtils.TruncateAt.END);
        content.addView(hint, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        GridLayout grid = new GridLayout(this);
        int columns = getResources().getConfiguration().screenWidthDp >= 600 ? 3 : 2;
        grid.setColumnCount(columns);
        grid.setRowCount((int) Math.ceil(6d / columns));
        grid.setUseDefaultMargins(false);
        LinearLayout.LayoutParams gridParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        gridParams.topMargin = dpToPx(12);
        content.addView(grid, gridParams);

        TextView feedback = new TextView(this);
        feedback.setText("");
        feedback.setTextColor(getColor(R.color.dmp_text_secondary));
        feedback.setTextSize(13f);
        feedback.setGravity(Gravity.CENTER_VERTICAL);
        feedback.setMinHeight(dpToPx(42));
        feedback.setPadding(dpToPx(10), dpToPx(6), dpToPx(10), dpToPx(6));
        content.addView(feedback, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dpToPx(48)));

        final String[] labels = {"启动游戏", "关闭游戏", "快捷备份", "快捷保存", "启用伪停", "关闭伪停"};
        final String[] actions = {"startup", "shutdown", "backup", "save", "pause", "resume"};
        for (int index = 0; index < labels.length; index++) {
            com.google.android.material.button.MaterialButton button =
                    new com.google.android.material.button.MaterialButton(this);
            button.setText(labels[index]);
            button.setTextSize(13f);
            button.setAllCaps(false);
            button.setMinHeight(dpToPx(42));
            button.setPadding(dpToPx(4), 0, dpToPx(4), 0);
            GridLayout.Spec rowSpec = GridLayout.spec(index / columns);
            GridLayout.Spec columnSpec = GridLayout.spec(index % columns, 1f);
            GridLayout.LayoutParams buttonParams = new GridLayout.LayoutParams(rowSpec, columnSpec);
            buttonParams.width = 0;
            buttonParams.height = dpToPx(46);
            int horizontal = dpToPx(4);
            buttonParams.setMargins(horizontal, dpToPx(3), horizontal, dpToPx(3));
            grid.addView(button, buttonParams);
            final String action = actions[index];
            button.setOnClickListener(v -> executeRoomAction(room, action, button, feedback));
        }

        AlertDialog dialog = new MaterialAlertDialogBuilder(this)
                .setTitle("操作")
                .setView(content)
                .setNegativeButton(R.string.dmp_cancel, null)
                .create();
        dialog.setCanceledOnTouchOutside(true);
        dialog.setOnShowListener(ignored -> applyLargeDialogCorners(dialog));
        dialog.show();
    }

    private void executeRoomAction(
            DmpRoom room,
            String action,
            com.google.android.material.button.MaterialButton button,
            TextView feedback) {
        if (apiClient == null || button == null || feedback == null) return;
        button.setEnabled(false);
        feedback.setText("正在向平台发送" + roomActionLabel(action) + "任务……");
        feedback.setTextColor(getColor(R.color.dmp_text_secondary));
        apiClient.executeRoomAction(room.server, room.id, room.masterWorldId, action,
                new DmpApiClient.RoomActionCallback() {
                    private void finishButton() {
                        runOnUiThread(() -> {
                            if (!destroyed) button.setEnabled(true);
                        });
                    }

                    @Override
                    public void onSuccess(String message) {
                        runOnUiThread(() -> {
                            if (destroyed) return;
                            String displayMessage = message;
                            if ("pause".equals(action)) {
                                displayMessage = "已暂停时间流逝";
                            } else if ("resume".equals(action)) {
                                displayMessage = "时间继续流逝";
                            }
                            feedback.setText("任务执行成功：" +
                                    (displayMessage == null || displayMessage.trim().isEmpty()
                                            ? "操作成功" : displayMessage));
                            feedback.setTextColor(getColor(R.color.dmp_green));
                            button.setEnabled(true);
                        });
                    }

                    @Override
                    public void onUnsupported(String message) {
                        runOnUiThread(() -> {
                            if (destroyed) return;
                            feedback.setText("任务执行失败：" + message);
                            feedback.setTextColor(getColor(R.color.dmp_warning));
                            button.setEnabled(true);
                        });
                    }

                    @Override
                    public void onError(String message) {
                        runOnUiThread(() -> {
                            if (destroyed) return;
                            feedback.setText("任务执行失败：" +
                                    (message == null || message.trim().isEmpty()
                                            ? "操作失败" : message));
                            feedback.setTextColor(getColor(R.color.dmp_warning));
                            button.setEnabled(true);
                        });
                    }
                });
    }

    private String roomActionLabel(String action) {
        if ("startup".equals(action)) return "启动游戏";
        if ("shutdown".equals(action)) return "关闭游戏";
        if ("backup".equals(action)) return "快捷备份";
        if ("save".equals(action)) return "快捷保存";
        if ("pause".equals(action)) return "启用伪停";
        if ("resume".equals(action)) return "关闭伪停";
        return "操作";
    }

    private void showSettingsDialog() {
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dpToPx(20), dpToPx(4), dpToPx(20), dpToPx(4));

        settingsNightSwitch = addSettingsSwitch(content,
                getString(R.string.dmp_setting_night_mode),
                getString(R.string.dmp_setting_night_mode_summary), nightMode,
                checked -> {
                    if (checked != nightMode) {
                        toggleTheme(uiPreferences);
                    }
                });

        LinearLayout developerOptions = new LinearLayout(this);
        developerOptions.setOrientation(LinearLayout.VERTICAL);
        // Keep the options hidden while developer mode is force-disabled.
        developerOptions.setVisibility(View.GONE);
        addSettingsSwitch(developerOptions,
                getString(R.string.dmp_setting_android_download),
                getString(R.string.dmp_setting_android_download_summary), androidDownloadUi,
                checked -> {
                    androidDownloadUi = checked;
                    uiPreferences.edit().putBoolean(PREF_ANDROID_DOWNLOAD_UI, checked).apply();
                });
        addSettingsSwitch(developerOptions,
                getString(R.string.dmp_setting_android_mod_config),
                getString(R.string.dmp_setting_android_mod_config_summary), androidModConfigUi,
                checked -> {
                    androidModConfigUi = checked;
                    uiPreferences.edit().putBoolean(PREF_ANDROID_MOD_CONFIG_UI, checked).apply();
                });

        android.widget.Switch developerModeSwitch = addSettingsSwitch(content,
                getString(R.string.dmp_setting_developer_mode),
                getString(R.string.dmp_setting_developer_mode_summary), developerMode,
                checked -> {
                    // The production build deliberately does not expose the
                    // developer-only A-version switches.  The switch is
                    // disabled below, but keep this guard for accessibility or
                    // restored view state that might invoke the listener.
                    developerMode = false;
                    uiPreferences.edit().putBoolean(PREF_DEVELOPER_MODE, false).apply();
                    developerOptions.setVisibility(View.GONE);
                });
        developerModeSwitch.setChecked(false);
        developerModeSwitch.setEnabled(false);
        content.addView(developerOptions, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        String downloadPath = new java.io.File(
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                "DMP").getAbsolutePath();
        addSettingsInfo(content, "下载路径 " + downloadPath);
        addSettingsInfo(content, "本app不提供云端账号登录入口，请从网页端登录");
        TextView compatibilityInfo = addSettingsInfo(content, "本 App 适配 Linux DMP 3.2.2");
        compatibilityInfo.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        addSettingsInfo(content, "下载卡片处于测试阶段，若显示有误属正常现象");

        settingsDialog = new MaterialAlertDialogBuilder(this)
                .setTitle(R.string.dmp_settings_title)
                .setView(content)
                .setNegativeButton(R.string.dmp_cancel, null)
                .create();
        settingsDialog.setCanceledOnTouchOutside(true);
        settingsDialog.setOnShowListener(ignored -> applyLargeDialogCorners(settingsDialog));
        settingsDialog.setOnDismissListener(ignored -> {
            settingsNightSwitch = null;
            settingsDialog = null;
        });
        settingsDialog.show();
    }

    private interface SettingsChangedListener {
        void onChanged(boolean checked);
    }

    private android.widget.Switch addSettingsSwitch(
            LinearLayout parent,
            String title,
            String summary,
            boolean checked,
            SettingsChangedListener listener) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(0, dpToPx(8), 0, dpToPx(8));
        LinearLayout copy = new LinearLayout(this);
        copy.setOrientation(LinearLayout.VERTICAL);
        TextView titleView = new TextView(this);
        titleView.setText(title);
        titleView.setTextColor(getColor(R.color.dmp_text_primary));
        titleView.setTextSize(16f);
        copy.addView(titleView);
        row.addView(copy, new LinearLayout.LayoutParams(0,
                ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        android.widget.Switch toggle = new android.widget.Switch(this);
        toggle.setChecked(checked);
        toggle.setOnCheckedChangeListener((button, value) -> listener.onChanged(value));
        row.addView(toggle, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        parent.addView(row, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return toggle;
    }

    private TextView addSettingsInfo(LinearLayout parent, String text) {
        TextView info = new TextView(this);
        info.setText(text);
        info.setTextColor(getColor(R.color.dmp_text_secondary));
        info.setTextSize(13f);
        info.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
        info.setPadding(0, dpToPx(4), 0, dpToPx(4));
        info.setTextIsSelectable(false);
        parent.addView(info, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return info;
    }

    private void refreshAll() {
        refreshAll(null);
    }

    private void refreshAll(@Nullable Runnable onComplete) {
        refreshDownloadProgress();
        if (servers.isEmpty()) {
            updateDownloadProgress(new ArrayList<>());
            if (onComplete != null) {
                onComplete.run();
            }
            return;
        }
        AtomicInteger remaining = new AtomicInteger(servers.size());
        for (DmpServer server : servers) {
            refreshServer(server, () -> {
                if (remaining.decrementAndGet() == 0 && onComplete != null) {
                    onComplete.run();
                }
            });
        }
    }

    /**
     * Refresh the compact progress indicator beneath the top download button.
     * Only active, non-paused, non-terminal tasks contribute to the average;
     * completed and paused work is deliberately excluded from the percentage.
     * This is independent of the optional task dialog, so the indicator keeps
     * moving while the dialog is closed.
     */
    private void refreshDownloadProgress() {
        if (roomMode || destroyed) {
            updateDownloadProgress(new ArrayList<>());
            return;
        }
        final int generation = ++downloadProgressGeneration;
        List<DmpServer> targets = uniqueServers();
        if (targets.isEmpty()) {
            updateDownloadProgress(new ArrayList<>());
            return;
        }
        List<DmpTask> aggregate = Collections.synchronizedList(new ArrayList<>());
        AtomicInteger remaining = new AtomicInteger(targets.size());
        for (DmpServer server : targets) {
            apiClient.fetchTasks(server, readPersistedWebTasks(server), new DmpApiClient.TasksCallback() {
                private void complete(List<DmpTask> tasks) {
                    if (tasks != null) {
                        List<DmpTask> merged = mergeCachedWebTasks(server, tasks);
                        // Background toolbar refreshes do not pass through
                        // completeTaskRefresh(), so apply local terminal
                        // dismissals here as well. Otherwise a row cleared
                        // from the aggregate card can immediately recolour
                        // the toolbar when the next poll rehydrates it.
                        merged.removeIf(DmpActivity.this::isDismissedTerminalTask);
                        aggregate.addAll(merged);
                    }
                    if (remaining.decrementAndGet() != 0) {
                        return;
                    }
                    List<DmpTask> snapshot;
                    synchronized (aggregate) {
                        snapshot = new ArrayList<>(aggregate);
                    }
                    runOnUiThread(() -> {
                        if (!destroyed && generation == downloadProgressGeneration) {
                            // Keep the latest background snapshot available
                            // even before the aggregate dialog is opened. The
                            // toolbar entry uses it to acknowledge the exact
                            // failure token that turned the icon red.
                            List<DmpTask> stableSnapshot = stabilizeTaskSnapshot(snapshot);
                            prefetchedTaskSnapshot = new ArrayList<>(stableSnapshot);
                            updateDownloadProgress(prefetchedTaskSnapshot);
                        }
                    });
                }

                @Override
                public void onSuccess(List<DmpTask> tasks) {
                    complete(tasks);
                }

                @Override
                public void onUnsupported() {
                    complete(new ArrayList<>());
                }

                @Override
                public void onError(String message) {
                    // A cached WebView queue is still useful when a server is
                    // temporarily unavailable; mergeCachedWebTasks handles it.
                    complete(new ArrayList<>());
                }
            });
        }
    }

    private String taskErrorToken(@Nullable DmpTask task) {
        if (!isFailedTask(task)) {
            return "";
        }
        String server = task.server == null ? "" : task.server.id;
        String id = task.taskId == null || task.taskId.trim().isEmpty()
                ? task.name : task.taskId;
        long stamp = task.updatedAt > 0L ? task.updatedAt : task.finishedAt;
        return server + "|" + id + "|" + task.status + "|"
                + (task.message == null ? "" : task.message) + "|" + stamp;
    }

    private void acknowledgeTaskErrors(@Nullable List<DmpTask> tasks) {
        if (tasks == null || tasks.isEmpty()) {
            return;
        }
        boolean changed = false;
        for (DmpTask task : tasks) {
            String token = taskErrorToken(task);
            if (!token.isEmpty() && acknowledgedTaskErrors.add(token)) {
                changed = true;
            }
        }
        if (changed && uiPreferences != null) {
            uiPreferences.edit().putStringSet(PREF_ACKNOWLEDGED_TASK_ERRORS,
                    new HashSet<>(acknowledgedTaskErrors)).apply();
        }
    }

    private void updateDownloadButtonState(@Nullable List<DmpTask> tasks) {
        if (binding == null || binding.dmpDownloadTasks == null) {
            return;
        }
        boolean active = false;
        boolean error = false;
        if (tasks != null) {
            for (DmpTask task : tasks) {
                if (task == null) {
                    continue;
                }
                if (task.isRunning() && !task.isPaused() && !task.isTerminal()) {
                    active = true;
                }
                String token = taskErrorToken(task);
                if (retryFailureTasks.contains(dismissedTaskKey(task))
                        || (!token.isEmpty() && !acknowledgedTaskErrors.contains(token))) {
                    error = true;
                }
            }
        }
        // Download activity/error has precedence over update notices.  A
        // yellow notification state is only shown when no task is actively
        // running and no unacknowledged task error is present.
        boolean notification = !error && !active && hasUnacknowledgedPlatformNotifications();
        int tint = error ? Color.parseColor("#D9534F")
                : active ? getColor(R.color.dmp_green)
                : notification ? Color.parseColor("#D29B00")
                : getColor(R.color.dmp_primary_text);
        binding.dmpDownloadTasks.setColorFilter(tint);
        binding.dmpDownloadTasks.setTag(error ? "error" : active ? "active"
                : notification ? "notification" : "idle");
        updateTaskDialogTabAppearance();
    }

    private void updateDownloadProgress(List<DmpTask> tasks) {
        updateDownloadButtonState(tasks);
        if (binding == null || roomMode) {
            if (binding != null) {
                binding.dmpDownloadProgress.setVisibility(View.GONE);
            }
            return;
        }
        double total = 0d;
        int activeCount = 0;
        boolean unknownProgress = false;
        for (DmpTask task : tasks) {
            if (task == null || !task.isRunning() || task.isPaused() || task.isTerminal()) {
                continue;
            }
            total += Math.max(0d, Math.min(100d, task.progress));
            activeCount++;
            // Legacy DMP exposes no byte counters or percentage.  Keep the
            // compact indicator visible as an indeterminate bar instead of a
            // 0% sliver which looks like no task is running at all.
            if (isLegacyUpdateTask(task)
                    || (task.progress <= 0d && task.totalBytes <= 0L)) {
                unknownProgress = true;
            }
        }
        if (activeCount == 0) {
            binding.dmpDownloadProgress.setIndeterminate(false);
            binding.dmpDownloadProgress.setProgress(0);
            binding.dmpDownloadProgress.setVisibility(View.GONE);
            return;
        }
        int percent = (int) Math.round(total / activeCount);
        binding.dmpDownloadProgress.setIndeterminate(unknownProgress);
        binding.dmpDownloadProgress.setProgress(Math.max(0, Math.min(100, percent)));
        binding.dmpDownloadProgress.setVisibility(View.VISIBLE);
    }

    private void refreshServer(DmpServer server) {
        refreshServer(server, null);
    }

    private void refreshServer(DmpServer server, @Nullable Runnable onComplete) {
        if (server.state == DmpServer.STATE_LOADING) {
            if (onComplete != null) {
                onComplete.run();
            }
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
                    server.cpuCores = metrics.cpuCores;
                    server.memoryTotalBytes = metrics.memoryTotalBytes;
                    server.updating = metrics.updating;
                    server.state = DmpServer.STATE_ONLINE;
                    serverAdapter.notifyServerChanged(server.id);
                    if (onComplete != null) {
                        onComplete.run();
                    }
                });
            }

            @Override
            public void onError(String message) {
                runOnUiThread(() -> {
                    if (destroyed) {
                        return;
                    }
                    server.state = DmpServer.STATE_OFFLINE;
                    server.updating = false;
                    server.statusMessage = shortenError(message);
                    serverAdapter.notifyServerChanged(server.id);
                    if (onComplete != null) {
                        onComplete.run();
                    }
                });
            }
        });
        refreshVersionSnapshot(server);
        refreshInstalledDmpVersion(server);
    }

    /**
     * Read the DMP release installed on this host.  The API intentionally
     * exposes the DST game build through /platform/game_version, while the
     * DMP release is embedded in the host's Web bundle.  DmpApiClient only
     * inspects that static index/config asset; an unreadable host stays at
     * “读取中” instead of being incorrectly labelled as the current APK
     * release (or as the DST game version from a legacy API route).
     */
    private void refreshInstalledDmpVersion(DmpServer server) {
        long now = android.os.SystemClock.elapsedRealtime();
        synchronized (server) {
            if (server.dmpInstalledVersionProbeRunning
                    || now - server.dmpInstalledVersionCheckedAt
                    < DMP_VERSION_PROBE_INTERVAL_MS) {
                return;
            }
            server.dmpInstalledVersionProbeRunning = true;
            server.dmpInstalledVersionCheckedAt = now;
        }
        apiClient.fetchInstalledDmpVersion(server,
                new DmpApiClient.InstalledVersionCallback() {
                    @Override
                    public void onSuccess(String version) {
                        synchronized (server) {
                            server.dmpInstalledVersionProbeRunning = false;
                            server.dmpInstalledVersionCheckedAt =
                                    android.os.SystemClock.elapsedRealtime();
                        }
                        runOnUiThread(() -> {
                            if (destroyed) {
                                return;
                            }
                            server.dmpInstalledVersion = version == null ? "" : version.trim();
                            recomputeLatestInstalledDmpVersion();
                            serverAdapter.notifyServerChanged(server.id);
                            updateLauncherSubtitle();
                        });
                    }

                    @Override
                    public void onError(String message) {
                        synchronized (server) {
                            server.dmpInstalledVersionProbeRunning = false;
                            server.dmpInstalledVersionCheckedAt =
                                    android.os.SystemClock.elapsedRealtime();
                        }
                        runOnUiThread(() -> {
                            if (destroyed) {
                                return;
                            }
                            // Do not leave a stale release label after a
                            // failed re-probe; the card must say “读取中”.
                            server.dmpInstalledVersion = "";
                            recomputeLatestInstalledDmpVersion();
                            serverAdapter.notifyServerChanged(server.id);
                            updateLauncherSubtitle();
                        });
                        // Leave the card at “读取中”; a failed probe must not
                        // masquerade as the APK's bundled v3.2.2 release.
                        if (BuildConfig.DEBUG) {
                            Log.d(TAG, "DMP installed-version probe skipped: " + message);
                        }
                    }
                });
    }

    private void refreshVersionSnapshot(DmpServer server) {
        apiClient.fetchVersion(server, new DmpApiClient.VersionCallback() {
            @Override
            public void onSuccess(DmpVersion version) {
                runOnUiThread(() -> {
                    if (destroyed) {
                        return;
                    }
                    server.dmpLocalVersion = version.local;
                    server.dmpLatestVersion = version.latest;
                    server.dmpVersionKnown = true;
                    latestDmpVersion = 0;
                    for (DmpServer candidate : servers) {
                        if (candidate.dmpVersionKnown) {
                            latestDmpVersion = Math.max(latestDmpVersion,
                                    candidate.dmpLatestVersion);
                        }
                    }
                    serverAdapter.notifyServerChanged(server.id);
                    updateLauncherSubtitle();
                });
            }

            @Override
            public void onUnsupported() {
                runOnUiThread(() -> {
                    if (destroyed) {
                        return;
                    }
                    server.dmpVersionKnown = false;
                    serverAdapter.notifyServerChanged(server.id);
                    updateLauncherSubtitle();
                });
            }

            @Override
            public void onError(String message) {
                // The metrics card still reports connectivity. Keep the
                // version subtitle in a neutral loading/unknown state.
            }
        });
    }

    private void updateLauncherSubtitle() {
        if (roomMode || binding == null) {
            return;
        }
        String latestGame = latestDmpVersion > 0
                ? String.valueOf(latestDmpVersion) : "读取中";
        String base = getString(R.string.dmp_launcher_subtitle_game_latest, latestGame);
        TextView subtitle = binding.dmpLauncherSubtitle;
        subtitle.setText(base);
        String installedDmp = latestInstalledDmpVersion;
        if (installedDmp == null || installedDmp.trim().isEmpty()) {
            return;
        }
        // Measure the actual toolbar width instead of branching only on a
        // device category.  This keeps the extra DMP release label on a
        // tablet (and on a wide landscape layout) while leaving phones with
        // the shorter game-version subtitle.
        subtitle.post(() -> {
            if (destroyed || roomMode || binding == null
                    || subtitle.getWidth() <= 0) {
                return;
            }
            String full = base + " · 最新DMP版本" + installedDmp.trim();
            Paint paint = subtitle.getPaint();
            float available = subtitle.getWidth()
                    - subtitle.getPaddingLeft() - subtitle.getPaddingRight();
            if (available > 0 && paint.measureText(full) <= available) {
                subtitle.setText(full);
            }
        });
    }

    private void recomputeLatestInstalledDmpVersion() {
        String best = "";
        if (servers != null) {
            for (DmpServer candidate : servers) {
                if (candidate == null || candidate.dmpInstalledVersion == null) {
                    continue;
                }
                String value = candidate.dmpInstalledVersion.trim();
                if (value.isEmpty() || compareDmpVersions(value, best) <= 0) {
                    continue;
                }
                best = value;
            }
        }
        latestInstalledDmpVersion = best;
    }

    private static int compareDmpVersions(String left, String right) {
        if (right == null || right.trim().isEmpty()) {
            return left == null || left.trim().isEmpty() ? 0 : 1;
        }
        if (left == null || left.trim().isEmpty()) {
            return -1;
        }
        String[] a = left.trim().replaceFirst("^[vV]", "").split("\\.");
        String[] b = right.trim().replaceFirst("^[vV]", "").split("\\.");
        int count = Math.max(a.length, b.length);
        for (int i = 0; i < count; i++) {
            int av = i < a.length ? parseVersionPart(a[i]) : 0;
            int bv = i < b.length ? parseVersionPart(b[i]) : 0;
            if (av != bv) {
                return av > bv ? 1 : -1;
            }
        }
        return left.compareToIgnoreCase(right);
    }

    private static int parseVersionPart(String value) {
        if (value == null || value.isEmpty()) {
            return 0;
        }
        String digits = value.replaceAll("[^0-9].*", "");
        if (digits.isEmpty()) {
            return 0;
        }
        try {
            return Integer.parseInt(digits);
        } catch (NumberFormatException ignored) {
            return 0;
        }
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

    private TextView createTaskDialogTab(String label, int tab) {
        TextView tabView = new TextView(this);
        tabView.setText(label);
        tabView.setTextSize(15f);
        tabView.setGravity(Gravity.CENTER);
        tabView.setTypeface(null, android.graphics.Typeface.BOLD);
        tabView.setPadding(dpToPx(8), 0, dpToPx(8), 0);
        tabView.setMinWidth(dpToPx(84));
        tabView.setOnClickListener(v -> setTaskDialogTab(tab));
        return tabView;
    }

    private void updateTaskDialogTabAppearance() {
        if (taskDialogTasksTab == null || taskDialogNotificationsTab == null) {
            return;
        }
        boolean tasks = taskDialogTab == 0;
        int selected = getColor(R.color.dmp_primary);
        int normal = getColor(R.color.dmp_text_secondary);
        boolean active = false;
        boolean error = false;
        if (prefetchedTaskSnapshot != null) {
            for (DmpTask task : prefetchedTaskSnapshot) {
                if (task == null) continue;
                active |= task.isRunning() && !task.isPaused() && !task.isTerminal();
                String token = taskErrorToken(task);
                error |= retryFailureTasks.contains(dismissedTaskKey(task))
                        || (!token.isEmpty() && !acknowledgedTaskErrors.contains(token));
            }
        }
        int taskColor = error ? Color.parseColor("#D9534F")
                : active ? getColor(R.color.dmp_green) : (tasks ? selected : normal);
        int noticeColor = hasUnacknowledgedPlatformNotifications()
                ? Color.parseColor("#D29B00") : (tasks ? normal : selected);
        taskDialogTasksTab.setTextColor(taskColor);
        taskDialogNotificationsTab.setTextColor(noticeColor);
        taskDialogTasksTab.setBackgroundColor(tasks
                ? getColor(R.color.dmp_primary_soft) : Color.TRANSPARENT);
        taskDialogNotificationsTab.setBackgroundColor(!tasks
                ? getColor(R.color.dmp_primary_soft) : Color.TRANSPARENT);
    }

    private void setTaskDialogTab(int tab) {
        if (taskDialog == null || !taskDialog.isShowing() || taskDialogContent == null) {
            return;
        }
        taskDialogTab = tab == 1 ? 1 : 0;
        updateTaskDialogTabAppearance();
        if (taskDialogTab == 1) {
            acknowledgePlatformNotifications();
            renderPlatformNotifications(taskDialogContent);
        } else {
            renderTaskSnapshot(taskDialogContent, prefetchedTaskSnapshot);
            refreshTaskDialog(taskDialogContent, taskLoadGeneration);
        }
    }

    private String aggregateGameNotificationKey(DmpServer server, DmpVersion version) {
        if (server == null) {
            return "";
        }
        String id = server.id == null ? server.host : server.id;
        int latest = version == null ? server.dmpLatestVersion : version.latest;
        return id + "|game|" + latest;
    }

    private String platformNotificationKey(DmpServer server, JSONObject item) {
        if (server == null || item == null) return "";
        String id = server.id == null ? server.host : server.id;
        String key = item.optString("key", "").trim();
        String token = item.optString("token", "").trim();
        if (key.isEmpty()) {
            key = item.optString("kind", "notice") + "|"
                    + item.optString("detail", "");
        }
        return id + "|" + key + "|" + token;
    }

    private JSONArray storedPlatformNotifications(DmpServer server) {
        if (server == null || server.id == null || server.id.trim().isEmpty()) {
            return new JSONArray();
        }
        String raw = getSharedPreferences(
                DmpJavascriptBridge.PREF_PLATFORM_NOTIFICATIONS, MODE_PRIVATE)
                .getString(server.id, "[]");
        try {
            JSONArray parsed = new JSONArray(raw == null ? "[]" : raw);
            JSONArray safe = new JSONArray();
            for (int index = 0; index < parsed.length() && safe.length() < 120; index++) {
                JSONObject item = parsed.optJSONObject(index);
                if (item == null || item.optString("title", "").trim().isEmpty()
                        || item.optString("detail", "").trim().isEmpty()) continue;
                safe.put(item);
            }
            return safe;
        } catch (JSONException ignored) {
            return new JSONArray();
        }
    }

    private boolean hasUnacknowledgedPlatformNotifications() {
        if (servers == null) {
            return false;
        }
        for (DmpServer server : servers) {
            if (server == null) {
                continue;
            }
            if (server.dmpVersionKnown && server.dmpLatestVersion > server.dmpLocalVersion) {
                String key = aggregateGameNotificationKey(server, null);
                if (!key.isEmpty() && !acknowledgedPlatformNotifications.contains(key)) {
                    return true;
                }
            }
            JSONArray notices = storedPlatformNotifications(server);
            for (int index = 0; index < notices.length(); index++) {
                JSONObject item = notices.optJSONObject(index);
                String noticeKey = platformNotificationKey(server, item);
                if (!noticeKey.isEmpty()
                        && !acknowledgedPlatformNotifications.contains(noticeKey)) {
                    return true;
                }
            }
        }
        return false;
    }

    private void acknowledgePlatformNotifications() {
        if (servers == null) {
            return;
        }
        for (DmpServer server : servers) {
            if (server == null) {
                continue;
            }
            if (server.dmpVersionKnown && server.dmpLatestVersion > server.dmpLocalVersion) {
                String key = aggregateGameNotificationKey(server, null);
                if (!key.isEmpty()) {
                    acknowledgedPlatformNotifications.add(key);
                }
            }
            JSONArray notices = storedPlatformNotifications(server);
            for (int index = 0; index < notices.length(); index++) {
                String noticeKey = platformNotificationKey(server, notices.optJSONObject(index));
                if (!noticeKey.isEmpty()) acknowledgedPlatformNotifications.add(noticeKey);
            }
        }
        updateDownloadButtonState(prefetchedTaskSnapshot);
    }

    private void renderPlatformNotifications(@NonNull LinearLayout content) {
        content.removeAllViews();
        boolean any = false;
        if (servers != null) {
            for (DmpServer server : servers) {
                JSONArray stored = storedPlatformNotifications(server);
                for (int index = 0; index < stored.length(); index++) {
                    JSONObject item = stored.optJSONObject(index);
                    if (item == null) continue;
                    any = true;
                    String title = item.optString("title", "平台通知");
                    String detail = item.optString("detail", "");
                    String kind = item.optString("kind", "");
                    addPlatformNotificationRow(content, title,
                            "目标服务器：" + serverLabel(server), detail, v -> {
                                if (taskDialog != null) taskDialog.dismiss();
                                if ("game".equalsIgnoreCase(kind)) {
                                    showUpdateDialog();
                                } else {
                                    openPlatformDashboard(server);
                                }
                            });
                }
                if (server == null || !server.dmpVersionKnown
                        || server.dmpLatestVersion <= server.dmpLocalVersion) {
                    continue;
                }
                any = true;
                addPlatformNotificationRow(content, "游戏版本可更新",
                        "目标服务器：" + serverLabel(server),
                        "新版" + server.dmpLatestVersion + "，请及时更新", v -> {
                            if (taskDialog != null) {
                                taskDialog.dismiss();
                            }
                            showUpdateDialog();
                        });
            }
        }
        // A mod update is represented by a cached terminal mod task on
        // installations where the host does not expose a catalogue endpoint.
        // Keep this conservative: only rows explicitly labelled as updates
        // are surfaced, avoiding a false notice for ordinary downloads.
        List<DmpTask> tasks = prefetchedTaskSnapshot;
        if (tasks != null) {
            for (DmpTask task : tasks) {
                if (task == null || !"mod_download".equals(task.type)) {
                    continue;
                }
                String marker = ((task.name == null ? "" : task.name) + " "
                        + (task.message == null ? "" : task.message)).toLowerCase(
                        java.util.Locale.US);
                if (!marker.contains("update") && !marker.contains("更新")) {
                    continue;
                }
                any = true;
                String name = task.name == null || task.name.trim().isEmpty()
                        ? "模组" : task.name.trim();
                addPlatformNotificationRow(content, "旧模组可更新",
                        "目标服务器：" + serverLabel(task.server),
                        "[" + name + "]有更新", v -> {
                            if (taskDialog != null) {
                                taskDialog.dismiss();
                            }
                            Toast.makeText(this, "请进入平台的模组设置更新模组",
                                    Toast.LENGTH_SHORT).show();
                        });
            }
        }
        if (!any) {
            TextView empty = new TextView(this);
            empty.setText("暂无平台通知");
            empty.setTextColor(getColor(R.color.dmp_text_secondary));
            empty.setTextSize(18f);
            empty.setGravity(Gravity.CENTER);
            empty.setMinHeight(dpToPx(220));
            empty.setPadding(dpToPx(12), dpToPx(30), dpToPx(12), dpToPx(30));
            content.addView(empty, new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        }
        // Keep the same fixed bottom feedback slot as the task tab so the
        // dialog does not resize when a three-second acknowledgement expires.
        mountTaskFeedback(content);
    }

    private void addPlatformNotificationRow(LinearLayout content, String title,
                                            String target, String detail,
                                            @Nullable View.OnClickListener click) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.VERTICAL);
        row.setPadding(dpToPx(8), dpToPx(12), dpToPx(8), dpToPx(12));
        row.setClickable(click != null);
        if (click != null) {
            row.setOnClickListener(click);
        }
        TextView heading = new TextView(this);
        heading.setText(title);
        heading.setTextColor(Color.parseColor("#D29B00"));
        heading.setTextSize(15f);
        heading.setTypeface(null, android.graphics.Typeface.BOLD);
        row.addView(heading);
        TextView targetView = new TextView(this);
        targetView.setText(target);
        targetView.setTextColor(getColor(R.color.dmp_text_secondary));
        targetView.setTextSize(13f);
        row.addView(targetView);
        TextView detailView = new TextView(this);
        detailView.setText(detail);
        detailView.setTextColor(getColor(R.color.dmp_text_primary));
        detailView.setTextSize(14f);
        row.addView(detailView);
        content.addView(row, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        View divider = new View(this);
        divider.setBackgroundColor(getColor(R.color.dmp_track));
        content.addView(divider, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dpToPx(1)));
    }

    private void showTaskDialog() {
        if (updateDialog != null && updateDialog.isShowing()) {
            updateDialog.dismiss();
        }
        if (taskDialog != null && taskDialog.isShowing()) {
            return;
        }
        taskLoadGeneration++;
        taskRefreshRequestId++;
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
        // The aggregate card has two independent views.  Keep the controls
        // in the dialog title so switching tabs never rebuilds the dialog or
        // loses the task feedback slot.
        LinearLayout tabs = new LinearLayout(this);
        tabs.setOrientation(LinearLayout.HORIZONTAL);
        tabs.setGravity(Gravity.CENTER_VERTICAL);
        taskDialogTab = 0;
        taskDialogTasksTab = createTaskDialogTab("平台任务", 0);
        taskDialogNotificationsTab = createTaskDialogTab("平台通知", 1);
        tabs.addView(taskDialogTasksTab, new LinearLayout.LayoutParams(
                0, dpToPx(40), 1f));
        tabs.addView(taskDialogNotificationsTab, new LinearLayout.LayoutParams(
                0, dpToPx(40), 1f));
        titleBar.addView(tabs, new LinearLayout.LayoutParams(
                0, dpToPx(42), 1f));
        taskDeleteSpinner = new ImageView(this);
        taskDeleteSpinner.setImageResource(android.R.drawable.ic_popup_sync);
        taskDeleteSpinner.setColorFilter(getColor(R.color.dmp_text_secondary));
        taskDeleteSpinner.setPadding(dpToPx(5), dpToPx(5), dpToPx(5), dpToPx(5));
        taskDeleteSpinner.setVisibility(View.GONE);
        taskClearCompletedButton = new ImageButton(this);
        taskClearCompletedButton.setImageResource(android.R.drawable.ic_menu_delete);
        taskClearCompletedButton.setColorFilter(getColor(R.color.dmp_primary));
        taskClearCompletedButton.setContentDescription("清除已完成下载");
        taskClearCompletedButton.setBackgroundColor(Color.TRANSPARENT);
        taskClearCompletedButton.setPadding(dpToPx(7), dpToPx(7), dpToPx(7), dpToPx(7));
        taskClearCompletedButton.setOnClickListener(v -> clearCompletedTaskRows());
        taskClearCompletedButton.setOnLongClickListener(v -> {
            new MaterialAlertDialogBuilder(this)
                    .setTitle("删除全部下载任务")
                    .setMessage("将删除当前总下载任务卡片中的全部任务记录。服务器正在执行的任务不会被 LinuxDMP 强制终止。是否继续？")
                    .setNegativeButton(R.string.dmp_cancel, null)
                    .setPositiveButton("全部删除", (dialog, which) -> clearAllTaskRows())
                    .show();
            return true;
        });
        titleBar.addView(taskClearCompletedButton, new LinearLayout.LayoutParams(
                dpToPx(38), dpToPx(38)));
        titleBar.addView(taskDeleteSpinner, new LinearLayout.LayoutParams(dpToPx(34), dpToPx(34)));

        taskDialog = new MaterialAlertDialogBuilder(this)
                .setCustomTitle(titleBar)
                .setView(scrollView)
                .setNegativeButton(R.string.dmp_cancel, null)
                .create();
        taskDialog.setCanceledOnTouchOutside(true);
        taskDialog.setOnShowListener(ignored -> applyLargeDialogCorners(taskDialog));
        taskDialog.setOnDismissListener(ignored -> {
            taskLoadGeneration++;
            taskRefreshRequestId++;
            taskDialog = null;
            taskDialogContent = null;
            taskDialogTasksTab = null;
            taskDialogNotificationsTab = null;
            taskFeedbackView = null;
            // Acknowledgements belong to one dialog session.  Clear the
            // backing value as well as the view so reopening the task center
            // cannot resurrect an expired message from the previous session.
            taskFeedback = null;
            taskDeleteRequestsInFlight = 0;
            if (taskDeleteSpinnerAnimator != null) {
                taskDeleteSpinnerAnimator.cancel();
            }
            taskDeleteSpinnerAnimator = null;
            taskDeleteSpinner = null;
            taskClearCompletedButton = null;
            handler.removeCallbacks(clearTaskFeedback);
        });
        taskDialog.show();
        updateTaskDialogTabAppearance();
        taskDialogContent = content;
        // The platform screen continuously prefetches tasks. Render that
        // snapshot immediately so opening the center never starts blank while
        // the authoritative requests are being refreshed in the background.
        renderTaskSnapshot(content, prefetchedTaskSnapshot);
        mountTaskFeedback(content);
        refreshTaskDialog(content, taskLoadGeneration);
    }

    /**
     * Clear only successful rows from the aggregate task card.  This is a
     * local display operation: active/queued/failed rows are deliberately
     * left untouched. Long-press deletion is implemented separately below.
     */
    private void clearCompletedTaskRows() {
        if (taskDialog == null || !taskDialog.isShowing()) {
            return;
        }
        List<DmpTask> source = prefetchedTaskSnapshot == null
                ? Collections.emptyList() : new ArrayList<>(prefetchedTaskSnapshot);
        List<DmpTask> completed = new ArrayList<>();
        for (DmpTask task : source) {
            if (isSuccessfulTask(task)) {
                completed.add(task);
            }
        }
        showTaskFeedback("正在向平台发送删除已完成任务......");
        if (completed.isEmpty()) {
            showTaskFeedback("任务执行成功");
            return;
        }
        boolean allAccepted = true;
        for (DmpTask task : completed) {
            if (task == null) {
                continue;
            }
            boolean accepted = true;
            if ("transfer".equals(task.type)) {
                // Dismiss removes the DownloadManager history row while
                // preserving the exported file in Download/DMP/.
                accepted = DmpJavascriptBridge.performNativeTransferAction(
                        this, task.server, task.taskId, "dismiss");
                // Persist the display dismissal as well. Without this, the
                // still-prefetched transfer row is rendered again immediately
                // after the native metadata record is removed.
                if (accepted) {
                    dismissTask(task);
                }
            } else if (isLegacyUpdateTask(task)) {
                dismissLegacyUpdateTask(task);
                // Keep the WebView-side tombstone in sync with the native
                // aggregate dismissal. Otherwise a live platform WebView
                // can sync its old completed update row back later.
                accepted = DmpJavascriptBridge.performWebTaskAction(
                        this, task.server, task.taskId, "delete");
            } else {
                dismissTask(task);
                // The aggregate card may be cleared while a platform
                // WebView is still alive. Persist the same opaque dismissal
                // there so its next sync cannot resurrect the row.
                accepted = DmpJavascriptBridge.performWebTaskAction(
                        this, task.server, task.taskId, "delete");
                removeCachedWebTask(task);
            }
            allAccepted &= accepted;
            if (!accepted) {
                // Keep a failed native history deletion visible so the user
                // can retry it instead of silently losing the row.
                continue;
            }
            removeTaskCardImmediately(task);
        }
        prefetchedTaskSnapshot.removeIf(this::isDismissedTerminalTask);
        visibleTaskSnapshot.removeIf(this::isDismissedTerminalTask);
        updateDownloadProgress(prefetchedTaskSnapshot);
        if (taskDialogContent != null) {
            if (taskDialogTab == 1) {
                renderPlatformNotifications(taskDialogContent);
            } else {
                renderTaskSnapshot(taskDialogContent, prefetchedTaskSnapshot);
                mountTaskFeedback(taskDialogContent);
            }
        }
        showTaskFeedback(allAccepted ? "任务执行成功" : "任务执行失败");
    }

    /**
     * Long-press action for the aggregate task-card trash icon.  This is a
     * deliberate destructive display cleanup; active LinuxDMP workers remain
     * server-owned when no safe cancellation endpoint exists, but their local
     * Android/WebView task records are removed so the user does not have to
     * delete dozens of rows one by one.
     */
    private void clearAllTaskRows() {
        if (taskDialog == null || !taskDialog.isShowing()) {
            return;
        }
        List<DmpTask> source = prefetchedTaskSnapshot == null
                ? Collections.emptyList() : new ArrayList<>(prefetchedTaskSnapshot);
        showTaskFeedback("正在向平台发送全部删除任务......");
        if (source.isEmpty()) {
            showTaskFeedback("没有可删除的任务");
            return;
        }
        boolean allAccepted = true;
        Set<String> removedTaskKeys = new HashSet<>();
        for (DmpTask task : source) {
            if (task == null || task.taskId == null || task.taskId.trim().isEmpty()) {
                allAccepted = false;
                continue;
            }
            boolean accepted = false;
            if ("transfer".equals(task.type)) {
                String operation = isSuccessfulTask(task) ? "dismiss" : "delete";
                accepted = DmpJavascriptBridge.performNativeTransferAction(
                        this, task.server, task.taskId, operation);
                if (accepted && ("dismiss".equals(operation) || "delete".equals(operation))) {
                    if (isSuccessfulTask(task)) {
                        dismissTask(task);
                    }
                }
            } else if (isLegacyUpdateTask(task)) {
                dismissLegacyUpdateTask(task);
                accepted = DmpJavascriptBridge.performWebTaskAction(
                        this, task.server, task.taskId, "delete");
            } else if ("game_update".equals(task.type)) {
                if (task.isTerminal()) {
                    dismissTask(task);
                }
                // Current game-update rows have no safe cancellation API;
                // persist a local WebView tombstone and clear the native
                // compatibility cache. This is display cleanup only; the
                // server-owned worker is not terminated.
                accepted = DmpJavascriptBridge.performWebTaskAction(
                        this, task.server, task.taskId, "delete");
                removeCachedWebTask(task);
                if (task.server != null && task.server.id != null) {
                    localUpdateTasks.remove(task.server.id);
                    legacyUpdateStartedAt.remove(task.server.id);
                    legacyUpdateObserved.remove(task.server.id);
                    legacyUpdateLastUpdating.remove(task.server.id);
                    legacyUpdateInitialVersions.remove(task.server.id);
                    persistLocalUpdateTasks();
                }
            } else {
                accepted = DmpJavascriptBridge.performWebTaskAction(
                        this, task.server, task.taskId, "delete");
                if (accepted) {
                    removeCachedWebTask(task);
                }
            }
            allAccepted &= accepted;
            pendingTaskActions.remove(dismissedTaskKey(task));
            if (accepted) {
                removedTaskKeys.add(dismissedTaskKey(task));
                removeTaskCardImmediately(task);
            }
        }
        prefetchedTaskSnapshot.removeIf(task -> task != null
                && removedTaskKeys.contains(dismissedTaskKey(task)));
        visibleTaskSnapshot.removeIf(task -> task != null
                && removedTaskKeys.contains(dismissedTaskKey(task)));
        updateDownloadProgress(prefetchedTaskSnapshot);
        if (taskDialogContent != null) {
            if (taskDialogTab == 1) {
                renderPlatformNotifications(taskDialogContent);
            } else {
                renderTaskSnapshot(taskDialogContent, prefetchedTaskSnapshot);
                mountTaskFeedback(taskDialogContent);
            }
        }
        showTaskFeedback(allAccepted ? "任务执行成功" : "任务执行失败");
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
            if (taskDialogTab == 1) {
                renderPlatformNotifications(content);
            } else {
                showTaskEmpty(content);
            }
            return;
        }

        List<DmpTask> aggregate = Collections.synchronizedList(new ArrayList<>());
        List<String> notices = Collections.synchronizedList(new ArrayList<>());
        final int requestId = ++taskRefreshRequestId;
        AtomicInteger remaining = new AtomicInteger(targets.size());
        for (DmpServer server : targets) {
            apiClient.fetchTasks(server, readPersistedWebTasks(server), new DmpApiClient.TasksCallback() {
                @Override
                public void onSuccess(List<DmpTask> tasks) {
                    mergeServerTasksAndComplete(server, tasks, aggregate, notices,
                            content, generation, requestId, remaining);
                }

                @Override
                public void onUnsupported() {
                    mergeServerTasksAndComplete(server, new ArrayList<>(), aggregate, notices,
                            content, generation, requestId, remaining);
                }

                @Override
                public void onError(String message) {
                    aggregate.addAll(mergeCachedWebTasks(server, new ArrayList<>()));
                    notices.add(getString(R.string.dmp_tasks_failed, serverLabel(server)));
                    completeTaskRefresh(content, generation, requestId, aggregate, notices, remaining);
                }
            });
        }
    }

    /**
     * Merge an API/WebView snapshot and, for the old dashboard route, refresh
     * the server-side update flag before rendering. The old POST returns
     * immediately, so it must not be treated as a complete task snapshot.
     */
    private void mergeServerTasksAndComplete(
            DmpServer server,
            List<DmpTask> tasks,
            List<DmpTask> aggregate,
            List<String> notices,
            LinearLayout content,
            int generation,
            int requestId,
            AtomicInteger remaining) {
        DmpTask local = localUpdateTasks.get(server.id);
        if (isStaleUnconfirmedGameUpdate(local)) {
            localUpdateTasks.remove(server.id);
            removeCachedWebTask(local);
            persistLocalUpdateTasks();
            local = null;
        }
        // A pre-3.2 snapshot could leave a synthetic game-update row in
        // `running/queued` forever without ever observing the server's
        // updating flag.  Do not resurrect that row in the all-platform
        // centre; a fresh request is tracked with a positive monotonic start
        // time (or an observed server flag) and remains eligible below.
        if (isLegacyUpdateTask(local) && local.isRunning()
                && !hasLegacyRuntimeEvidence(server, local)) {
            localUpdateTasks.remove(server.id);
            removeCachedLegacyUpdateTasks(server);
            persistLocalUpdateTasks();
            local = null;
        }
        // Platform WebViews are destroyed when the user leaves a server.  A
        // legacy update created from that page therefore exists only in the
        // token-free WebView snapshot, not in localUpdateTasks.  The old code
        // skipped the boolean status probe in that case, so the all-platform
        // task centre kept showing “后台更新中” until the platform page was
        // opened again.  Adopt the cached synthetic row for native polling
        // (without replacing an already terminal native record).
        if (local == null) {
            DmpTask cached = findCachedLegacyUpdateTask(server);
            if (isLegacyUpdateTask(cached) && cached.isRunning()) {
                ensureLegacyUpdateTracking(server, cached);
                local = localUpdateTasks.get(server.id);
            }
        }
        if (isLegacyUpdateTask(local) && local.isRunning()) {
            final DmpTask statusTask = local;
            apiClient.fetchLegacyUpdateStatus(server,
                    new DmpApiClient.LegacyUpdateStatusCallback() {
                        @Override
                        public void onSuccess(boolean updating, int localVersion, int latestVersion) {
                            updateLegacyTaskStatus(server, statusTask, updating,
                                    localVersion, latestVersion);
                            aggregate.addAll(mergeCachedWebTasks(server, tasks));
                            completeTaskRefresh(content, generation, requestId, aggregate, notices, remaining);
                        }

                        @Override
                        public void onError(String message) {
                            // Keep the visible task while a transient status
                            // request fails; the next dialog refresh retries it.
                            aggregate.addAll(mergeCachedWebTasks(server, tasks));
                            completeTaskRefresh(content, generation, requestId, aggregate, notices, remaining);
                        }
                    });
            return;
        }
        aggregate.addAll(mergeCachedWebTasks(server, tasks));
        completeTaskRefresh(content, generation, requestId, aggregate, notices, remaining);
    }

    /** Read the server-scoped WebView snapshot without exposing credentials. */
    @Nullable
    private DmpTask findCachedLegacyUpdateTask(DmpServer server) {
        if (server == null || server.id == null) {
            return null;
        }
        String payload = getSharedPreferences(
                DmpJavascriptBridge.PREF_WEB_DOWNLOAD_TASKS, MODE_PRIVATE)
                .getString(server.id, "");
        if (payload == null || payload.trim().isEmpty()) {
            return null;
        }
        try {
            JSONObject wrapper = new JSONObject(payload);
            JSONArray source = wrapper.optJSONArray("tasks");
            if (source == null) {
                return null;
            }
            for (int index = 0; index < source.length(); index++) {
                JSONObject item = source.optJSONObject(index);
                if (item == null) {
                    continue;
                }
                String type = item.optString("type", item.optString("taskType", ""));
                if (!"game_update".equalsIgnoreCase(type)) {
                    continue;
                }
                DmpTask candidate = DmpTask.fromJson(server, item);
            if (isLegacyUpdateTask(candidate)
                    && (candidate.serverUpdateObserved || candidate.serverLastUpdating
                    || item.optLong("startedAt", 0L) > 0L)) {
                    return candidate;
                }
            }
        } catch (JSONException ignored) {
            // A malformed optional cache is harmless; the API snapshot still
            // renders normally and the next refresh retries the probe.
        }
        return null;
    }

    private boolean hasLegacyRuntimeEvidence(@Nullable DmpServer server,
                                             @Nullable DmpTask task) {
        if (!isLegacyUpdateTask(task) || server == null || server.id == null) {
            return false;
        }
        if (task.serverUpdateObserved || task.serverLastUpdating) {
            return true;
        }
        Long started = legacyUpdateStartedAt.get(server.id);
        return started != null && started > 0L;
    }

    /** Seed the native legacy transition state from a WebView task snapshot. */
    private void ensureLegacyUpdateTracking(DmpServer server, DmpTask task) {
        if (server == null || task == null || !isLegacyUpdateTask(task)) {
            return;
        }
        localUpdateTasks.putIfAbsent(server.id, task);
        // createdAt in the WebView snapshot is wall-clock time, whereas the
        // timeout state machine uses elapsedRealtime.  Do not mix the two
        // clocks (which would otherwise make the two-minute guard ineffective).
        long started = android.os.SystemClock.elapsedRealtime();
        legacyUpdateStartedAt.putIfAbsent(server.id, started);
        legacyUpdateObserved.putIfAbsent(server.id, task.serverUpdateObserved);
        legacyUpdateLastUpdating.putIfAbsent(server.id, task.serverLastUpdating);
        if (task.versionAtRequest > 0) {
            legacyUpdateInitialVersions.putIfAbsent(server.id, task.versionAtRequest);
        }
        persistLocalUpdateTasks();
    }

    /**
     * Collapse duplicate representations from the native task API, the
     * WebView cache and DownloadManager, then preserve the visible order from
     * the previous snapshot.  A task's updatedAt/progress changes frequently
     * and must never be used as a live row-order key.
     */
    private List<DmpTask> stabilizeTaskSnapshot(@Nullable List<DmpTask> source) {
        LinkedHashMap<String, DmpTask> unique = new LinkedHashMap<>();
        if (source != null) {
            for (DmpTask task : source) {
                if (task == null) {
                    continue;
                }
                String key = taskKey(task);
                DmpTask previous = unique.get(key);
                if (previous == null || isPreferredTask(task, previous)) {
                    unique.put(key, task);
                }
            }
        }

        List<DmpTask> ordered = new ArrayList<>(unique.size());
        Set<String> emitted = new HashSet<>();
        synchronized (taskStableOrder) {
            // Existing rows retain their previous position even when their
            // progress/status/timestamp changes between polls.
            for (String key : taskStableOrder) {
                DmpTask task = unique.get(key);
                if (task != null && emitted.add(key)) {
                    ordered.add(task);
                }
            }

            // New rows are deterministic on their first appearance.  This
            // avoids callback-completion order (which depends on network
            // latency) deciding where a row lands.
            List<DmpTask> additions = new ArrayList<>();
            for (Map.Entry<String, DmpTask> entry : unique.entrySet()) {
                if (!emitted.contains(entry.getKey())) {
                    additions.add(entry.getValue());
                }
            }
            additions.sort((left, right) -> {
                boolean leftRunning = left.isRunning() && !left.isPaused();
                boolean rightRunning = right.isRunning() && !right.isPaused();
                if (leftRunning != rightRunning) {
                    return leftRunning ? -1 : 1;
                }
                if (left.updatedAt != right.updatedAt) {
                    return Long.compare(right.updatedAt, left.updatedAt);
                }
                return taskKey(left).compareTo(taskKey(right));
            });
            for (DmpTask task : additions) {
                String key = taskKey(task);
                if (emitted.add(key)) {
                    ordered.add(task);
                    taskStableOrder.add(key);
                }
            }

            // Keep a bounded history so repeated one-off backup rows cannot
            // grow this in-memory order list forever.  Rows currently visible
            // are never evicted by this trim.
            if (taskStableOrder.size() > 512) {
                Set<String> visibleKeys = unique.keySet();
                for (int index = 0; index < taskStableOrder.size()
                        && taskStableOrder.size() > 384;) {
                    String candidate = taskStableOrder.get(index);
                    if (!visibleKeys.contains(candidate)) {
                        taskStableOrder.remove(index);
                    } else {
                        index++;
                    }
                }
            }
        }
        return ordered;
    }

    private void completeTaskRefresh(
            LinearLayout content,
            int generation,
            int requestId,
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
        snapshot.removeIf(this::isDismissedTerminalTask);
        final List<DmpTask> stableSnapshot = stabilizeTaskSnapshot(snapshot);
        runOnUiThread(() -> {
            if (destroyed || taskDialog == null || !taskDialog.isShowing()
                    || generation != taskLoadGeneration
                    || requestId != taskRefreshRequestId) {
                return;
            }
            updateDownloadProgress(stableSnapshot);
            prefetchedTaskSnapshot = new ArrayList<>(stableSnapshot);
            for (DmpTask task : stableSnapshot) {
                if (task != null && (task.isTerminal() || "failed".equals(task.status)
                        || "error".equals(task.status))) {
                    pendingTaskActions.remove(dismissedTaskKey(task));
                }
            }
            visibleTaskSnapshot = new ArrayList<>(stableSnapshot);
            if (taskDialogTab == 1) {
                // Keep the notification tab stable while the task API polls
                // in the background.  The latest snapshot is retained for
                // the next switch back to “平台任务”.
                renderPlatformNotifications(content);
                handler.postDelayed(() -> refreshTaskDialog(content, generation), 2500L);
                return;
            }
            int previousScrollY = captureTaskScrollY(content);
            content.removeAllViews();
            taskFeedbackView = null;
            for (DmpTask task : stableSnapshot) {
                content.addView(createTaskCard(task));
            }
            // An unreachable/legacy host may add a read-failure notice even
            // when every server returned zero tasks.  The task centre still
            // needs to communicate the primary state clearly: there are no
            // download records.  Render the empty state first so it remains
            // prominent; notices follow as secondary diagnostics.
            if (stableSnapshot.isEmpty()) {
                showTaskEmpty(content);
            }
            for (String notice : noticeSnapshot) {
                TextView noticeView = new TextView(this);
                noticeView.setText(notice);
                noticeView.setTextColor(getColor(R.color.dmp_text_secondary));
                noticeView.setTextSize(13f);
                noticeView.setPadding(dpToPx(8), dpToPx(10), dpToPx(8), dpToPx(10));
                content.addView(noticeView);
            }
            mountTaskFeedback(content);
            restoreTaskScrollY(content, previousScrollY);
            handler.postDelayed(() -> refreshTaskDialog(content, generation), 2500L);
        });
    }

    private void showTaskFeedback(String message) {
        taskFeedback = message == null ? "" : message;
        handler.removeCallbacks(clearTaskFeedback);
        if (taskFeedbackView != null) {
            // The same feedback TextView is reused between refreshes.  Cancel
            // any previous fade and restore full opacity before mounting the
            // new acknowledgement.
            taskFeedbackView.animate().cancel();
            taskFeedbackView.setAlpha(1f);
        }
        handler.postDelayed(clearTaskFeedback, 3000L);
        if (taskDialogContent != null && taskDialog != null && taskDialog.isShowing()) {
            // Mount synchronously; do not wait for the next network-backed
            // task refresh, otherwise a slow host can consume the whole
            // three-second lifetime before the acknowledgement is visible.
            mountTaskFeedback(taskDialogContent);
        }
    }

    private void mountTaskFeedback(@NonNull LinearLayout content) {
        if (taskFeedbackView == null || taskFeedbackView.getParent() != content) {
            if (taskFeedbackView != null) {
                ViewParent previous = taskFeedbackView.getParent();
                if (previous instanceof ViewGroup) {
                    ((ViewGroup) previous).removeView(taskFeedbackView);
                }
            }
            taskFeedbackView = new TextView(this);
            taskFeedbackView.setTextColor(getColor(R.color.dmp_text_secondary));
            taskFeedbackView.setTextSize(12f);
            taskFeedbackView.setPadding(dpToPx(8), dpToPx(8), dpToPx(8), dpToPx(2));
            taskFeedbackView.setMinHeight(dpToPx(32));
            content.addView(taskFeedbackView);
        }
        taskFeedbackView.animate().cancel();
        String message = taskFeedback == null ? "" : taskFeedback;
        taskFeedbackView.setText(message);
        taskFeedbackView.setAlpha(message.trim().isEmpty() ? 0f : 1f);
    }

    private void showTaskEmpty(LinearLayout content) {
        TextView empty = new TextView(this);
        // The all-platform task center should have a clear empty state,
        // rather than looking like a failed/partially loaded list.  Keep it
        // centered and deliberately light so it does not compete with the
        // task cards when the first download is added.
        empty.setText(R.string.dmp_tasks_none);
        empty.setTextColor(getColor(R.color.dmp_text_secondary));
        empty.setAlpha(0.62f);
        empty.setTextSize(22f);
        empty.setTypeface(empty.getTypeface(), android.graphics.Typeface.NORMAL);
        empty.setGravity(Gravity.CENTER);
        empty.setMinHeight(dpToPx(220));
        empty.setPadding(dpToPx(10), dpToPx(24), dpToPx(10), dpToPx(24));
        content.addView(empty, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    }

    /** Capture the aggregate card's viewport before replacing task rows. */
    private int captureTaskScrollY(@Nullable LinearLayout content) {
        if (content == null) {
            return 0;
        }
        ViewParent parent = content.getParent();
        return parent instanceof ScrollView ? ((ScrollView) parent).getScrollY() : 0;
    }

    /** Restore the viewport after the new row heights have been laid out. */
    private void restoreTaskScrollY(@Nullable LinearLayout content, int scrollY) {
        if (content == null || scrollY <= 0) {
            return;
        }
        ViewParent parent = content.getParent();
        if (!(parent instanceof ScrollView)) {
            return;
        }
        ScrollView scrollView = (ScrollView) parent;
        content.post(() -> scrollView.scrollTo(0, Math.max(0, scrollY)));
    }

    private void renderTaskSnapshot(LinearLayout content, List<DmpTask> tasks) {
        if (content == null) return;
        int previousScrollY = captureTaskScrollY(content);
        content.removeAllViews();
        List<DmpTask> snapshot = tasks == null ? Collections.emptyList() : new ArrayList<>(tasks);
        snapshot.removeIf(this::isDismissedTerminalTask);
        snapshot = stabilizeTaskSnapshot(snapshot);
        if (snapshot.isEmpty()) {
            showTaskEmpty(content);
            restoreTaskScrollY(content, previousScrollY);
            return;
        }
        for (DmpTask task : snapshot) content.addView(createTaskCard(task));
        restoreTaskScrollY(content, previousScrollY);
    }

    private boolean isRetryableTask(@Nullable DmpTask task) {
        if (task == null || task.status == null) return false;
        String status = task.status.toLowerCase(java.util.Locale.US);
        return "success".equals(status) || "complete".equals(status)
                || "completed".equals(status) || "done".equals(status)
                || "failed".equals(status) || "error".equals(status);
    }

    private boolean isSuccessfulTask(@Nullable DmpTask task) {
        if (task == null || task.status == null) return false;
        String status = task.status.toLowerCase(java.util.Locale.US);
        return "success".equals(status) || "complete".equals(status)
                || "completed".equals(status) || "done".equals(status);
    }

    private boolean isFailedTask(@Nullable DmpTask task) {
        if (task == null || task.status == null) return false;
        String status = task.status.toLowerCase(java.util.Locale.US);
        return "failed".equals(status) || "error".equals(status);
    }

    /** Transfer metadata currently marks backup downloads as `transfer`.
     * Preserve a blue bar for future upload records without changing the
     * WebView bridge contract. */
    private boolean isUploadTask(@Nullable DmpTask task) {
        if (task == null || task.type == null) return false;
        if (task.upload) return true;
        String marker = ((task.name == null ? "" : task.name) + " "
                + (task.stage == null ? "" : task.stage)).toLowerCase(java.util.Locale.US);
        return marker.contains("upload") || marker.contains("上传")
                || marker.contains("transfer up") || marker.contains("上载");
    }

    private View createTaskCard(DmpTask task) {
        MaterialCardView card = new MaterialCardView(this);
        // Keep a stable key on every native card.  Cached WebView tasks can
        // be removed optimistically without waiting for a server-side
        // /v3/tasks DELETE response, so the exact card can disappear at once.
        card.setTag("task:" + dismissedTaskKey(task));
        card.setCardElevation(dpToPx(1));
        card.setRadius(dpToPx(24));
        card.setUseCompatPadding(true);
        card.setCardBackgroundColor(getColor(R.color.dmp_card));
        if (pendingTaskActions.contains(dismissedTaskKey(task))) {
            card.setStrokeColor(getColor(R.color.dmp_text_secondary));
        }
        LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(dpToPx(14), dpToPx(12), dpToPx(14), dpToPx(12));

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        TextView title = new TextView(this);
        String taskTitle = "game_update".equals(task.type)
                ? getString(R.string.dmp_task_update)
                : task.name == null || task.name.trim().isEmpty()
                ? ("transfer".equals(task.type) ? "传输" : getString(R.string.dmp_task_mod))
                : task.name.trim();
        title.setText(taskTitle);
        title.setTextColor(getColor(R.color.dmp_text_primary));
        title.setTextSize(16f);
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        header.addView(title, new LinearLayout.LayoutParams(0,
                ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        if ("transfer".equals(task.type)) {
            if (isRetryableTask(task)) {
                header.addView(createTaskActionButton(task, "retry"));
            }
            if (!task.taskId.isEmpty()) {
                // Removing a completed backup from the task list must not
                // remove the exported file in Download/DMP. Active/failed
                // transfers still use a force-delete action.
                header.addView(createTaskActionButton(task,
                        isSuccessfulTask(task) ? "dismiss" : "delete"));
            }
        } else if (!"game_update".equals(task.type)) {
            // The native all-platform card is intentionally limited to
            // retry/delete actions.  Pause/continue belongs to the per-
            // platform WebView task card, whose queue owns the operation.
            if (isRetryableTask(task)) {
                header.addView(createTaskActionButton(task, "retry"));
            }
            if (!task.taskId.isEmpty()) {
                header.addView(createTaskActionButton(task, "delete"));
            }
        } else if ("game_update".equals(task.type)) {
            if (isLegacyUpdateTask(task)) {
                // Legacy DMP exposes only a boolean update flag and has no
                // pause/cancel endpoint.  Its unknown-progress row can be
                // removed locally at any time; the server-side SteamCMD job
                // is deliberately left untouched.
                if (!task.taskId.isEmpty()) {
                    header.addView(createTaskActionButton(task, "delete"));
                }
            } else if (!task.taskId.isEmpty() && task.isTerminal()) {
                // Current task API updates are not cancellable here. Keep a
                // delete-record action only after the server reports a
                // terminal state, and expose retry for failed updates.
                if ("failed".equals(task.status) || "error".equals(task.status)) {
                    header.addView(createTaskActionButton(task, "retry"));
                }
                header.addView(createTaskActionButton(task, "delete"));
            }
        }
        body.addView(header);

        boolean gameUpdate = "game_update".equals(task.type);
        boolean successful = isSuccessfulTask(task);
        boolean failed = isFailedTask(task);
        TextView details = new TextView(this);
        details.setTextColor(getColor(R.color.dmp_text_secondary));
        details.setTextSize(13f);
        details.setPadding(0, dpToPx(4), 0, dpToPx(2));
        if (gameUpdate) {
            String updateStatus = task.status == null ? "" : task.status.toLowerCase(java.util.Locale.US);
            String stateText = "后台更新中";
            if (successful) stateText = "后台更新完成";
            else if (failed) stateText = "后台更新失败";
            else if ("cancelled".equals(updateStatus) || "canceled".equals(updateStatus)) {
                stateText = "后台更新已取消";
            }
            details.setText(getString(R.string.dmp_task_server, serverLabel(task.server))
                    + " · " + stateText);
        } else {
            String byteText;
            if (successful && task.totalBytes > 0L) {
                byteText = formatBytes(task.totalBytes);
            } else if (task.totalBytes > 0L) {
                // A few DMP versions expose the total size and percentage but
                // omit the downloaded-byte counter. Estimate the first value
                // from the percentage so the card never regresses to 0 B.
                long completedBytes = task.completedBytes > 0L
                        ? task.completedBytes
                        : Math.round(task.totalBytes * task.progress / 100d);
                byteText = formatBytes(completedBytes) + " / " + formatBytes(task.totalBytes);
            } else {
                // When no byte size is available, the percentage is the only
                // useful progress value and must remain visible in row two.
                byteText = String.format(java.util.Locale.US, "%.1f%%", task.progress);
            }
            details.setText(byteText + "  "
                    + getString(R.string.dmp_task_server, serverLabel(task.server)));
        }
        body.addView(details);

        // Completed downloads intentionally have no third row. Failed rows
        // retain a red bar so the failure remains visible for retry; active
        // download/upload rows use green/blue respectively.
        boolean showProgress = !successful && (!gameUpdate || !task.isTerminal() || failed);
        if (showProgress) {
            ProgressBar progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
            boolean legacyIndeterminate = gameUpdate
                    || (isLegacyUpdateTask(task) && task.isRunning() && task.progress <= 0);
            progress.setIndeterminate(legacyIndeterminate);
            if (!legacyIndeterminate) {
                progress.setMax(1000);
                progress.setProgress((int) Math.round(task.progress * 10));
            }
            int progressColor = failed
                    ? Color.parseColor("#D9534F")
                    : isUploadTask(task) ? getColor(R.color.dmp_blue) : getColor(R.color.dmp_green);
            progress.setProgressTintList(ColorStateList.valueOf(progressColor));
            progress.setProgressBackgroundTintList(ColorStateList.valueOf(
                    getColor(R.color.dmp_track)));
            LinearLayout.LayoutParams progressParams = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, dpToPx(6));
            progressParams.topMargin = dpToPx(8);
            progressParams.bottomMargin = dpToPx(8);
            body.addView(progress, progressParams);
        }

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

    private boolean isLegacyUpdateTask(@Nullable DmpTask task) {
        return task != null
                && "game_update".equals(task.type)
                && task.taskId != null
                && (task.taskId.startsWith("legacy-update-")
                || task.taskId.startsWith("android-game-update-")
                // The WebView bridge uses a deterministic server-scoped id
                // for the old /dashboard/exec/game flow.  Treat that row as
                // legacy too; otherwise an unconfirmed preference with
                // id=game_update:<server> bypasses all stale-row filtering.
                || task.taskId.startsWith("game_update:"));
    }

    private void rememberUpdateTask(DmpServer server, @Nullable DmpTask task) {
        if (task == null || task.taskId == null || task.taskId.trim().isEmpty()) {
            return;
        }
        localUpdateTasks.put(server.id, task);
        // Starting a fresh legacy update intentionally clears a previous
        // local dismissal; the new request must be visible again.
        if ("game_update".equals(task.type)
                && dismissedLegacyUpdateServers.remove(server.id)) {
            uiPreferences.edit().putStringSet(PREF_DISMISSED_LEGACY_UPDATE_SERVERS,
                    new HashSet<>(dismissedLegacyUpdateServers)).apply();
        }
        if (isLegacyUpdateTask(task)) {
            legacyUpdateStartedAt.putIfAbsent(server.id,
                    android.os.SystemClock.elapsedRealtime());
            legacyUpdateObserved.putIfAbsent(server.id, Boolean.FALSE);
            legacyUpdateLastUpdating.putIfAbsent(server.id, Boolean.FALSE);
            legacyUpdateInitialVersions.remove(server.id);
        }
        persistLocalUpdateTasks();
    }

    /** Restore server-scoped update acknowledgements after the activity/process
     * is recreated. Credentials are never written; only task state and the
     * server key are retained. */
    private void restoreLocalUpdateTasks() {
        if (uiPreferences == null || servers == null) return;
        String raw = uiPreferences.getString(PREF_LOCAL_UPDATE_TASKS, "{}");
        try {
            JSONObject root = new JSONObject(raw == null ? "{}" : raw);
            for (DmpServer server : servers) {
                JSONObject item = root.optJSONObject(server.id);
                if (item == null || item.optString("taskID", "").trim().isEmpty()) continue;
                DmpTask task = DmpTask.fromJson(server, item);
                localUpdateTasks.put(server.id, task);
                if (isLegacyUpdateTask(task) && task.isRunning()) {
                    legacyUpdateStartedAt.put(server.id,
                            item.optLong("startedAt", android.os.SystemClock.elapsedRealtime()));
                    legacyUpdateObserved.put(server.id,
                            item.optBoolean("serverUpdateObserved", false));
                    legacyUpdateLastUpdating.put(server.id,
                            item.optBoolean("serverLastUpdating", false));
                    int initial = item.optInt("versionAtRequest", 0);
                    if (initial > 0) legacyUpdateInitialVersions.put(server.id, initial);
                }
            }
        } catch (JSONException ignored) {
            // A corrupt optional cache must not block the DMP entry page.
        }
    }

    private void persistLocalUpdateTasks() {
        if (uiPreferences == null) return;
        try {
            JSONObject root = new JSONObject();
            synchronized (localUpdateTasks) {
                for (Map.Entry<String, DmpTask> entry : localUpdateTasks.entrySet()) {
                    DmpTask task = entry.getValue();
                    if (task == null || task.taskId == null || task.taskId.trim().isEmpty()) continue;
                    JSONObject item = new JSONObject()
                            .put("taskID", task.taskId)
                            .put("type", task.type)
                            .put("name", task.name)
                            .put("status", task.status)
                            .put("stage", task.stage)
                            .put("progress", 0)
                            .put("message", task.message)
                            .put("updatedAt", task.updatedAt)
                            .put("finishedAt", task.finishedAt)
                            .put("serverUpdateObserved", Boolean.TRUE.equals(
                                    legacyUpdateObserved.get(entry.getKey())))
                            .put("serverLastUpdating", Boolean.TRUE.equals(
                                    legacyUpdateLastUpdating.get(entry.getKey())))
                            .put("versionAtRequest", legacyUpdateInitialVersions.containsKey(entry.getKey())
                                    ? legacyUpdateInitialVersions.get(entry.getKey()) : 0)
                            .put("startedAt", legacyUpdateStartedAt.containsKey(entry.getKey())
                                    ? legacyUpdateStartedAt.get(entry.getKey()) : 0);
                    root.put(entry.getKey(), item);
                }
            }
            uiPreferences.edit().putString(PREF_LOCAL_UPDATE_TASKS, root.toString()).apply();
        } catch (JSONException ignored) {
            // Optional cache only; never interrupt the visible task flow.
        }
    }

    /**
     * Convert the old server-wide boolean/version response into a durable
     * qualitative task. Legacy DMP exposes no byte counters, so the task
     * remains indeterminate until the server leaves the updating state; only
     * then is the completion message shown.
     */
    private void updateLegacyTaskStatus(
            DmpServer server,
            DmpTask previous,
            boolean updating,
            int localVersion,
            int latestVersion) {
        if (!isLegacyUpdateTask(previous)) {
            return;
        }
        long now = android.os.SystemClock.elapsedRealtime();
        long startedAt = legacyUpdateStartedAt.containsKey(server.id)
                ? legacyUpdateStartedAt.get(server.id)
                : now;
        if (localVersion > 0 && !legacyUpdateInitialVersions.containsKey(server.id)) {
            legacyUpdateInitialVersions.put(server.id, localVersion);
        }
        if (updating) {
            legacyUpdateObserved.put(server.id, Boolean.TRUE);
        }
        boolean terminal = false;
        boolean success = false;
        String status = "running";
        String stage = updating ? "downloading" : "waiting";
        String message = updating ? "后台更新中" : "已提交，等待服务器开始更新";
        double progress = 0;

        if (!updating) {
            // The old handler starts its goroutine after returning the HTTP
            // response. Do not mark the initial false response as complete.
            // A true -> false transition is the authoritative completion
            // signal; a version increase covers a very short update window
            // that was missed by polling.
            Integer initialVersion = legacyUpdateInitialVersions.get(server.id);
            boolean versionChanged = initialVersion != null && localVersion > initialVersion;
            boolean updateWasObserved = Boolean.TRUE.equals(legacyUpdateObserved.get(server.id));
            boolean wasUpdating = Boolean.TRUE.equals(legacyUpdateLastUpdating.get(server.id));
            boolean ended = updateWasObserved && wasUpdating;
            if (ended || versionChanged) {
                terminal = true;
                success = true;
                status = "success";
                stage = "completed";
                message = "后台更新完成";
            } else if (now - startedAt >= 120000L && !updateWasObserved) {
                terminal = true;
                status = "failed";
                stage = "failed";
                message = "服务器未进入更新";
            }
        } else {
            // A server-side update flag is authoritative. The UI deliberately
            // keeps a loading animation and does not invent a percentage.
            progress = 0;
        }
        legacyUpdateLastUpdating.put(server.id, updating);

        try {
            JSONObject json = new JSONObject()
                    .put("taskID", previous.taskId)
                    .put("type", "game_update")
                    .put("name", "DST server update")
                    .put("status", status)
                    .put("stage", stage)
                    .put("progress", 0)
                    .put("message", message)
                    .put("updatedAt", System.currentTimeMillis());
            if (terminal) {
                json.put("finishedAt", System.currentTimeMillis());
            }
            DmpTask current = DmpTask.fromJson(server, json);
            localUpdateTasks.put(server.id, current);
            persistLocalUpdateTasks();
            if (terminal && success) {
                legacyUpdateStartedAt.remove(server.id);
                legacyUpdateObserved.remove(server.id);
                legacyUpdateLastUpdating.remove(server.id);
                legacyUpdateInitialVersions.remove(server.id);
            }
        } catch (JSONException ignored) {
            // The literals above are JSON-safe; retain the previous task if
            // the defensive conversion ever fails.
        }
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

    private boolean isDismissedTerminalTask(DmpTask task) {
        if (task == null || !task.isTerminal()) {
            return false;
        }
        return dismissedTasks.contains(dismissedTaskKey(task))
                || isDismissedTerminalUpdate(task);
    }

    private void dismissTerminalUpdate(DmpTask task) {
        if (!isTerminalUpdate(task)) {
            return;
        }
        dismissedUpdateTasks.add(dismissedTaskKey(task));
        uiPreferences.edit().putStringSet(PREF_DISMISSED_UPDATE_TASKS,
                new HashSet<>(dismissedUpdateTasks)).apply();
    }

    private void dismissTask(DmpTask task) {
        if (task == null || !task.isTerminal() || task.taskId == null
                || task.taskId.trim().isEmpty()) {
            return;
        }
        String key = dismissedTaskKey(task);
        dismissedTasks.add(key);
        uiPreferences.edit().putStringSet(PREF_DISMISSED_TASKS,
                new HashSet<>(dismissedTasks)).apply();
        if (isTerminalUpdate(task)) {
            dismissTerminalUpdate(task);
        }
    }

    /**
     * Remove a legacy update row without sending a pause/delete request to the
     * old server.  The update process itself is server-owned and may continue;
     * only the Android task record is being dismissed.
     */
    private void dismissLegacyUpdateTask(DmpTask task) {
        if (!isLegacyUpdateTask(task) || task.server == null) {
            return;
        }
        String serverId = task.server.id;
        // Keep dismissal scoped to this concrete task; a server-wide flag
        // would hide all future background updates from the aggregate list.
        dismissTask(task);
        dismissedLegacyUpdateServers.remove(serverId);
        uiPreferences.edit().putStringSet(PREF_DISMISSED_LEGACY_UPDATE_SERVERS,
                new HashSet<>(dismissedLegacyUpdateServers)).apply();
        localUpdateTasks.remove(serverId);
        legacyUpdateStartedAt.remove(serverId);
        legacyUpdateObserved.remove(serverId);
        legacyUpdateLastUpdating.remove(serverId);
        legacyUpdateInitialVersions.remove(serverId);
        persistLocalUpdateTasks();
        removeCachedWebTask(task);
    }

    /** Remove any WebView compatibility rows for this legacy host. */
    private void removeCachedLegacyUpdateTasks(DmpServer server) {
        if (server == null || server.id == null) {
            return;
        }
        SharedPreferences preferences = getSharedPreferences(
                DmpJavascriptBridge.PREF_WEB_DOWNLOAD_TASKS, MODE_PRIVATE);
        String payload = preferences.getString(server.id, "");
        if (payload == null || payload.trim().isEmpty()) {
            return;
        }
        try {
            JSONObject wrapper = new JSONObject(payload);
            JSONArray source = wrapper.optJSONArray("tasks");
            if (source == null) {
                return;
            }
            JSONArray kept = new JSONArray();
            for (int index = 0; index < source.length(); index++) {
                JSONObject item = source.optJSONObject(index);
                if (item == null) {
                    continue;
                }
                if (!"game_update".equalsIgnoreCase(
                        item.optString("type", item.optString("taskType", "")))) {
                    kept.put(item);
                }
            }
            wrapper.put("tasks", kept);
            preferences.edit().putString(server.id, wrapper.toString()).apply();
        } catch (JSONException ignored) {
            // A malformed optional cache is harmless; the dismissal set still
            // suppresses any legacy rows returned by the compatibility API.
        }
    }

    /**
     * Remove one finished task from the WebView compatibility snapshot.  This
     * is intentionally separate from the dismissal set: deleting the cached
     * object prevents a stale WebView snapshot from being re-imported while a
     * later API refresh is in flight, and the dismissal set keeps the choice
     * durable across process restarts.
     */
    private void removeCachedWebTask(@Nullable DmpTask task) {
        if (task == null || task.server == null || task.server.id == null
                || task.taskId == null || task.taskId.trim().isEmpty()) {
            return;
        }
        SharedPreferences preferences = getSharedPreferences(
                DmpJavascriptBridge.PREF_WEB_DOWNLOAD_TASKS, MODE_PRIVATE);
        String payload = preferences.getString(task.server.id, "");
        if (payload == null || payload.trim().isEmpty()) {
            return;
        }
        try {
            JSONObject wrapper = new JSONObject(payload);
            JSONArray source = wrapper.optJSONArray("tasks");
            if (source == null) {
                return;
            }
            JSONArray kept = new JSONArray();
            for (int index = 0; index < source.length(); index++) {
                JSONObject item = source.optJSONObject(index);
                if (item == null) {
                    continue;
                }
                if (!DmpJavascriptBridge.webTaskMatches(item, task.taskId)) {
                    kept.put(item);
                }
            }
            wrapper.put("tasks", kept);
            preferences.edit().putString(task.server.id, wrapper.toString()).apply();
        } catch (JSONException ignored) {
            // A malformed optional cache must not prevent local dismissal.
        }
    }

    /** Remove a just-dismissed card without waiting for a network refresh. */
    private void removeTaskCardImmediately(@Nullable DmpTask task) {
        if (task == null) {
            return;
        }
        final String tag = "task:" + dismissedTaskKey(task);
        synchronized (visibleTaskSnapshot) {
            visibleTaskSnapshot.removeIf(existing -> existing != null
                    && tag.equals("task:" + dismissedTaskKey(existing)));
        }
        if (taskDialogContent == null) {
            return;
        }
        for (int index = taskDialogContent.getChildCount() - 1; index >= 0; index--) {
            View child = taskDialogContent.getChildAt(index);
            if (tag.equals(child.getTag())) {
                taskDialogContent.removeViewAt(index);
                break;
            }
        }
    }

    /** Replace a retried row in the in-memory snapshots before the next poll. */
    private void replaceTaskInMemorySnapshots(@Nullable DmpTask previous,
                                              @Nullable DmpTask replacement) {
        if (previous == null || replacement == null) {
            return;
        }
        String key = taskKey(previous);
        prefetchedTaskSnapshot = replaceTaskInSnapshot(prefetchedTaskSnapshot, key, replacement);
        visibleTaskSnapshot = replaceTaskInSnapshot(visibleTaskSnapshot, key, replacement);
        updateDownloadProgress(prefetchedTaskSnapshot);
    }

    private List<DmpTask> replaceTaskInSnapshot(@Nullable List<DmpTask> source,
                                                String key,
                                                DmpTask replacement) {
        List<DmpTask> updated = source == null
                ? new ArrayList<>() : new ArrayList<>(source);
        for (int index = 0; index < updated.size(); index++) {
            DmpTask existing = updated.get(index);
            if (existing != null && key.equals(taskKey(existing))) {
                updated.set(index, replacement);
            }
        }
        return updated;
    }

    /** Persist the queued state so a later WebView recreation sees the retry. */
    private void persistRetriedWebTask(@Nullable DmpTask previous,
                                       @Nullable DmpTask replacement) {
        if (previous == null || replacement == null || previous.server == null
                || previous.server.id == null || previous.server.id.trim().isEmpty()) {
            return;
        }
        SharedPreferences preferences = getSharedPreferences(
                DmpJavascriptBridge.PREF_WEB_DOWNLOAD_TASKS, MODE_PRIVATE);
        String payload = preferences.getString(previous.server.id, "");
        if (payload == null || payload.trim().isEmpty()) {
            return;
        }
        String wanted = taskKey(previous);
        try {
            JSONObject wrapper = new JSONObject(payload);
            JSONArray source = wrapper.optJSONArray("tasks");
            if (source == null) return;
            JSONArray updated = new JSONArray();
            for (int index = 0; index < source.length(); index++) {
                JSONObject item = source.optJSONObject(index);
                if (item == null) continue;
                DmpTask cached = DmpTask.fromJson(previous.server, item);
                if (wanted.equals(taskKey(cached))) {
                    item.put("status", "queued");
                    item.put("stage", "queued");
                    item.put("progress", 0);
                    item.put("progressKnown", false);
                    item.put("updatedAt", replacement.updatedAt > 0L
                            ? replacement.updatedAt : System.currentTimeMillis());
                    item.put("finishedAt", JSONObject.NULL);
                    if (replacement.fileUrl != null && !replacement.fileUrl.trim().isEmpty()) {
                        item.put("file_url", replacement.fileUrl);
                    }
                }
                updated.put(item);
            }
            wrapper.put("tasks", updated);
            preferences.edit().putString(previous.server.id, wrapper.toString()).apply();
        } catch (JSONException ignored) {
            // A malformed optional cache must not block the successful retry.
        }
    }

    private ImageButton createTaskActionButton(DmpTask task, String action) {
        ImageButton button = new ImageButton(this);
        button.setImageResource("retry".equals(action) ? android.R.drawable.ic_popup_sync
                : android.R.drawable.ic_menu_delete);
        // Row actions use the DMP accent. Keep the trash/retry icons visually
        // distinct from the status text while matching the compact task card.
        button.setColorFilter(getColor(R.color.dmp_primary));
        button.setContentDescription("retry".equals(action) ? "重下"
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
        pendingTaskActions.add(dismissedTaskKey(task));
        animateTaskCardPending(button);
        String feedbackAction = "retry".equals(action) ? "重下"
                : "dismiss".equals(action) ? "删除已完成" : "删除";
        showTaskFeedback("正在向平台发送" + feedbackAction + "任务......");
        startTaskDeleteIndicator(action);

        if ("transfer".equals(task.type)
                && ("delete".equals(action) || "dismiss".equals(action)
                || "retry".equals(action))) {
            boolean accepted = DmpJavascriptBridge.performNativeTransferAction(
                    this, task.server, task.taskId,
                    "retry".equals(action) ? "retry"
                            : "dismiss".equals(action) ? "dismiss" : "delete");
            finishTaskDeleteIndicator(action);
            if (accepted) {
                if ("delete".equals(action) || "dismiss".equals(action)
                        || "retry".equals(action)) {
                    dismissTask(task);
                }
                showTaskFeedback("任务执行成功");
                if (taskDialogContent != null) {
                    refreshTaskDialog(taskDialogContent, taskLoadGeneration);
                }
            } else {
                button.setEnabled(true);
                showTaskFeedback("任务执行失败");
            }
            return;
        }

        // Legacy dashboard updates use a synthetic task id because those
        // servers do not expose the /v3/tasks action endpoints.  A completed
        // legacy row is only a local acknowledgement, so deleting it must not
        // issue a doomed DELETE request to the server (which used to leave the
        // row stuck forever).  Persist the dismissal locally and keep the
        // normal five-second feedback/refresh behavior.
        if ("delete".equals(action) && isLegacyUpdateTask(task)) {
            finishTaskDeleteIndicator(action);
            boolean accepted = DmpJavascriptBridge.performWebTaskAction(
                    this, task.server, task.taskId, "delete");
            if (!accepted) {
                button.setEnabled(true);
                pendingTaskActions.remove(dismissedTaskKey(task));
                showTaskFeedback("任务执行失败");
                return;
            }
            dismissLegacyUpdateTask(task);
            showTaskFeedback("任务执行成功");
            if (taskDialogContent != null) {
                refreshTaskDialog(taskDialogContent, taskLoadGeneration);
            }
            return;
        }

        // DMP 3.2 has no generic /tasks retry action.  A terminal mod row is
        // restarted through the same /v3/mod/download POST used by the
        // catalogue page; do this before the local delete-only compatibility
        // path below so a native aggregate retry really reaches the server.
        if ("retry".equals(action) && "mod_download".equals(task.type)) {
            apiClient.retryModDownload(task, new DmpApiClient.TaskActionCallback() {
                @Override
                public void onSuccess(DmpTask replacement) {
                    runOnUiThread(() -> {
                        finishTaskDeleteIndicator(action);
                        button.setEnabled(true);
                        pendingTaskActions.remove(dismissedTaskKey(task));
                        retryFailureTasks.remove(dismissedTaskKey(task));
                        persistRetriedWebTask(task, replacement);
                        replaceTaskInMemorySnapshots(task, replacement);
                        if (taskDialogContent != null) {
                            if (taskDialogTab == 1) {
                                renderPlatformNotifications(taskDialogContent);
                            } else {
                                renderTaskSnapshot(taskDialogContent, prefetchedTaskSnapshot);
                            }
                        }
                        showTaskFeedback("任务执行成功");
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
                        pendingTaskActions.remove(dismissedTaskKey(task));
                        retryFailureTasks.add(dismissedTaskKey(task));
                        updateDownloadProgress(prefetchedTaskSnapshot);
                        showTaskFeedback("任务执行失败");
                    });
                }

                @Override
                public void onError(String message) {
                    runOnUiThread(() -> {
                        finishTaskDeleteIndicator(action);
                        button.setEnabled(true);
                        pendingTaskActions.remove(dismissedTaskKey(task));
                        retryFailureTasks.add(dismissedTaskKey(task));
                        updateDownloadProgress(prefetchedTaskSnapshot);
                        showTaskFeedback("任务执行失败");
                    });
                }
            });
            return;
        }

        // DMP 3.2 intentionally removed the old /tasks action endpoint. The
        // WebView bridge still owns a durable, token-free snapshot for each
        // mod download, so only local deletion is supported here. Pause and
        // continue are deliberately unavailable because LinuxDMP cannot
        // safely resume a server-owned SteamCMD worker.
        if (!"game_update".equals(task.type) && "delete".equals(action)) {
            boolean accepted = DmpJavascriptBridge.performWebTaskAction(
                    this, task.server, task.taskId, action);
            finishTaskDeleteIndicator(action);
            if (accepted) {
                if ("delete".equals(action)) {
                    if (task.isTerminal()) {
                        dismissTask(task);
                    }
                    removeCachedWebTask(task);
                    removeTaskCardImmediately(task);
                }
                showTaskFeedback("任务执行成功");
                if (taskDialogContent != null) {
                    refreshTaskDialog(taskDialogContent, taskLoadGeneration);
                }
            } else {
                button.setEnabled(true);
                pendingTaskActions.remove(dismissedTaskKey(task));
                showTaskFeedback("任务执行失败");
            }
            return;
        }

        // Completed mod/transfer records are history in the Android task
        // centre.  Some deployed DMP versions expose the task list through
        // the WebView compatibility cache but do not implement the DELETE
        // endpoint (or reject it with a timeout).  Waiting for that request
        // made the purple trash button look broken and allowed the same row
        // to be rendered again on the next refresh.  Dismiss terminal rows
        // locally first, remove the compatibility-cache entry, and update the
        // dialog immediately.  The server's finished job is not affected.
        if ("delete".equals(action) && task.isTerminal()) {
            finishTaskDeleteIndicator(action);
            dismissTask(task);
            removeCachedWebTask(task);
            taskDialogInteractionLockedUntil = 0L;
            removeTaskCardImmediately(task);
            showTaskFeedback("任务执行成功");
            if (taskDialogContent != null) {
                refreshTaskDialog(taskDialogContent, taskLoadGeneration);
            }
            return;
        }

        if ("retry".equals(action) && "game_update".equals(task.type)) {
            apiClient.startGameUpdate(task.server, true, new DmpApiClient.UpdateCallback() {
                @Override
                public void onSuccess(DmpTask replacement, boolean started, boolean deduplicated) {
                    runOnUiThread(() -> {
                        finishTaskDeleteIndicator(action);
                        button.setEnabled(true);
                        if (replacement != null && !replacement.taskId.isEmpty()) {
                            rememberUpdateTask(task.server, replacement);
                        }
                        showTaskFeedback(started ? "任务执行成功" : "任务执行失败");
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
                        showTaskFeedback("任务执行失败");
                    });
                }

                @Override
                public void onError(String message) {
                    runOnUiThread(() -> {
                        finishTaskDeleteIndicator(action);
                        button.setEnabled(true);
                        showTaskFeedback("任务执行失败");
                    });
                }
            });
            return;
        }
        // Completed server-wide updates are history records.  Several
        // deployed DMP versions expose them without implementing DELETE for
        // game_update, so the purple trash button dismisses the Android record
        // locally instead of waiting on an unavailable endpoint.
        if ("delete".equals(action) && "game_update".equals(task.type)
                && task.isTerminal()) {
            finishTaskDeleteIndicator(action);
            DmpJavascriptBridge.performWebTaskAction(
                    this, task.server, task.taskId, "delete");
            dismissTask(task);
            removeCachedWebTask(task);
            showTaskFeedback("任务执行成功");
            if (taskDialogContent != null) {
                refreshTaskDialog(taskDialogContent, taskLoadGeneration);
            }
            return;
        }

        apiClient.taskAction(task.server, task.taskId, action, new DmpApiClient.TaskActionCallback() {
            @Override
            public void onSuccess(DmpTask ignored) {
                runOnUiThread(() -> {
                    finishTaskDeleteIndicator(action);
                    if (task.isTerminal()) {
                        dismissTask(task);
                    }
                    showTaskFeedback("任务执行成功");
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
                    showTaskFeedback("任务执行失败");
                });
            }

            @Override
            public void onError(String message) {
                runOnUiThread(() -> {
                    finishTaskDeleteIndicator(action);
                    button.setEnabled(true);
                    showTaskFeedback("任务执行失败");
                });
            }
        });
    }

    /** Visually acknowledge an action without implying that it has completed. */
    private void animateTaskCardPending(View source) {
        ViewParent parent = source == null ? null : source.getParent();
        while (parent != null && !(parent instanceof MaterialCardView)) parent = parent.getParent();
        if (!(parent instanceof MaterialCardView)) return;
        MaterialCardView card = (MaterialCardView) parent;
        int from = getColor(R.color.dmp_card_stroke);
        int to = getColor(R.color.dmp_text_secondary);
        ValueAnimator animator = ValueAnimator.ofArgb(from, to);
        animator.setDuration(420L);
        animator.addUpdateListener(value -> card.setStrokeColor((Integer) value.getAnimatedValue()));
        animator.start();
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
        if (taskDialog != null && taskDialog.isShowing()) {
            taskDialog.dismiss();
        }
        if (updateDialog != null && updateDialog.isShowing()) {
            return;
        }
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
        updateDialog = dialog;
        dialog.setOnDismissListener(ignored -> {
            if (updateDialog == dialog) {
                updateDialog = null;
            }
        });
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
        String suffix = version.taskApiSupported ? "" : " -官版";
        String local = version.local > 0 ? String.valueOf(version.local) : "未知";
        label.setText(serverLabel(server) + suffix);
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
        // Official legacy (-官版) deployments keep their status visible in the
        // console, but their per-server update button is intentionally
        // disabled.  Only the unified task API is safe for a single-host
        // request from this screen.
        boolean canUpdate = version.taskApiSupported && version.updateSupported;
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
                rememberUpdateTask(server, task);
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
                // “仅更新旧版” deliberately targets every legacy host,
                // including one whose game version already matches latest.
                if (!version.taskApiSupported && version.updateSupported) {
                    return true;
                }
            }
        }
        return false;
    }

    private boolean hasTaskServer(Map<DmpServer, DmpVersion> versions) {
        synchronized (versions) {
            for (DmpVersion version : versions.values()) {
                if (version != null && version.updateSupported) {
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
                if (version == null || !version.updateSupported) {
                    continue;
                }
                if (force || (!version.taskApiSupported)) {
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
                    rememberUpdateTask(server, task);
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
            if (server == null) {
                continue;
            }
            // A server entry is the task namespace.  Do not collapse two
            // saved entries merely because they currently share a host/port:
            // they may use different tokens, rooms, or cached WebView queues.
            String key = server.id == null || server.id.trim().isEmpty()
                    ? server.baseUrl().toLowerCase(Locale.ROOT) : server.id.trim();
            unique.put(key, server);
        }
        /*
         * WebView queues are persisted per server id.  A task can therefore
         * outlive a temporarily removed/renamed launcher card; omitting that
         * namespace made the all-platform centre disagree with the platform
         * centre (and left its toolbar state invisible).  Rehydrate a
         * token-free, display-only server shell from the queue wrapper.  The
         * live API request may fail without a token, but mergeCachedWebTasks()
         * still renders the exact persisted task rows and native transfers.
         */
        SharedPreferences queuePreferences = getSharedPreferences(
                DmpJavascriptBridge.PREF_WEB_DOWNLOAD_TASKS, MODE_PRIVATE);
        for (Map.Entry<String, ?> entry : queuePreferences.getAll().entrySet()) {
            String id = entry.getKey();
            if (id == null || id.trim().isEmpty() || unique.containsKey(id)) {
                continue;
            }
            if (!(entry.getValue() instanceof String)) {
                continue;
            }
            try {
                JSONObject wrapper = new JSONObject((String) entry.getValue());
                JSONArray tasks = wrapper.optJSONArray("tasks");
                if (tasks == null || tasks.length() == 0) {
                    continue;
                }
                String host = wrapper.optString("host", "").trim();
                if (host.isEmpty()) {
                    continue;
                }
                String protocol = wrapper.optString("protocol", "http");
                int port = wrapper.optInt("port", "https".equalsIgnoreCase(protocol) ? 443 : 80);
                String remark = wrapper.optString("remark", "").trim();
                if (remark.isEmpty()) {
                    for (int index = 0; index < tasks.length(); index++) {
                        JSONObject task = tasks.optJSONObject(index);
                        if (task == null) continue;
                        remark = task.optString("serverName", "").trim();
                        if (!remark.isEmpty()) break;
                    }
                }
                if (remark.isEmpty()) remark = host;
                unique.put(id, new DmpServer(id, host, port, protocol, "", remark));
            } catch (JSONException ignored) {
                // A malformed/stale preference cannot block other servers.
            }
        }
        return new ArrayList<>(unique.values());
    }

    /** Read the token-free WebView task snapshot for one platform. */
    private JSONArray readPersistedWebTasks(DmpServer server) {
        JSONArray empty = new JSONArray();
        if (server == null || server.id == null || server.id.trim().isEmpty()) {
            return empty;
        }
        String payload = getSharedPreferences(
                DmpJavascriptBridge.PREF_WEB_DOWNLOAD_TASKS, MODE_PRIVATE)
                .getString(server.id, "");
        if (payload == null || payload.trim().isEmpty()) {
            return empty;
        }
        try {
            JSONObject wrapper = new JSONObject(payload);
            JSONArray tasks = wrapper.optJSONArray("tasks");
            return tasks == null ? empty : tasks;
        } catch (JSONException ignored) {
            return empty;
        }
    }

    /**
     * The WebView task store is kept by the Android bridge as a compatibility
     * path for staged/legacy servers which do not expose /v3/tasks yet.  API
     * results win, while a newer cached snapshot fills any missing task.
     */
    private List<DmpTask> mergeCachedWebTasks(DmpServer server, List<DmpTask> apiTasks) {
        LinkedHashMap<String, DmpTask> merged = new LinkedHashMap<>();
        for (DmpTask task : apiTasks) {
            // Legacy dashboards only expose a boolean update flag.  Their
            // WebView cache can therefore contain a synthetic "running" row
            // even after the update request was never started (or after the
            // old process has already finished).  A real legacy update is
            // confirmed by the status probe and carries one of the two
            // bridge flags below; unconfirmed cached rows must not be allowed
            // to resurrect the permanent "后台更新中" card.
            if (isUnconfirmedCachedLegacyUpdate(server, task)) {
                continue;
            }
            if (isStaleUnconfirmedGameUpdate(task)) {
                continue;
            }
            // Some 3.2/transition endpoints emit an empty mod-download row
            // while the real task has not been created yet.  It has no mod,
            // room, name, or byte counters and can never be acted on; showing
            // it leaves a permanent “下载模组：— · 0.0%” card in the queue.
            if (isInvalidModPlaceholder(task)) {
                continue;
            }
            merged.put(taskKey(task), task);
        }
        DmpTask localUpdate = localUpdateTasks.get(server.id);
        if (localUpdate != null && !isStaleUnconfirmedGameUpdate(localUpdate)) {
            String localKey = taskKey(localUpdate);
            DmpTask previous = merged.get(localKey);
            if (isPreferredTask(localUpdate, previous)) {
                merged.put(localKey, localUpdate);
            }
        }
        String payload = getSharedPreferences(
                DmpJavascriptBridge.PREF_WEB_DOWNLOAD_TASKS, MODE_PRIVATE)
                .getString(server.id, "");
        if (payload == null || payload.trim().isEmpty()) {
            addNativeTransfers(server, merged);
            return new ArrayList<>(merged.values());
        }
        try {
            JSONObject wrapper = new JSONObject(payload);
            String owner = wrapper.optString("serverId", "").trim();
            if (!owner.isEmpty() && !owner.equals(server.id)) {
                // A stale preference from a renamed/duplicated server must
                // never leak into this platform's task list.
                addNativeTransfers(server, merged);
                return new ArrayList<>(merged.values());
            }
            JSONArray tasks = wrapper.optJSONArray("tasks");
            if (tasks == null) {
                addNativeTransfers(server, merged);
                return new ArrayList<>(merged.values());
            }
            for (int index = 0; index < tasks.length(); index++) {
                JSONObject item = tasks.optJSONObject(index);
                if (item == null) {
                    continue;
                }
                String taskId = item.optString("taskID", "").trim();
                if (taskId.isEmpty()) {
                    taskId = item.optString("serverTaskID", "").trim();
                }
                if (taskId.isEmpty()) {
                    taskId = item.optString("id", "").trim();
                }
                if (taskId.isEmpty()) {
                    continue;
                }
                JSONObject normalized = new JSONObject(item.toString());
                normalized.put("taskID", taskId);
                if (!normalized.has("type")) {
                    normalized.put("type", "mod_download");
                }
                DmpTask cached = DmpTask.fromJson(server, normalized);
                if (isUnconfirmedCachedLegacyUpdate(server, cached)) {
                    continue;
                }
                if (isStaleUnconfirmedGameUpdate(cached)) {
                    continue;
                }
                if (isInvalidModPlaceholder(cached)) {
                    continue;
                }
                String key = taskKey(cached);
                DmpTask previous = merged.get(key);
                // The live status poll is authoritative for an active mod.
                // A persisted WebView success row can be stale (for example
                // POST acknowledged before the archive was written); never
                // let that terminal cache overwrite a live running/queued
                // row and recreate the false “下载完成” state.
                if (previous != null && previous.isRunning() && cached.isTerminal()) {
                    continue;
                }
                if (isPreferredTask(cached, previous)) {
                    merged.put(key, cached);
                }
            }
        } catch (JSONException ignored) {
            // A stale cache must not prevent the server task list from opening.
        }
        // Backup exports are managed by Android DownloadManager and therefore
        // are not present in the server's /tasks response. Include the
        // token-free native snapshot in the same server-scoped center.
        addNativeTransfers(server, merged);
        return new ArrayList<>(merged.values());
    }

    /**
     * Return true for a running legacy (boolean-only) update row that has not
     * been confirmed by the server status endpoint.  The native update path
     * keeps its own local row while it waits for the first status poll, so
     * dropping the unconfirmed WebView duplicate here is safe and prevents a
     * stale preference from appearing forever in the all-platform queue.
     */
    private boolean isUnconfirmedCachedLegacyUpdate(@Nullable DmpServer server,
                                                    @Nullable DmpTask task) {
        if (server == null || !isLegacyUpdateTask(task) || !task.isRunning()) {
            return false;
        }
        return !task.serverUpdateObserved && !task.serverLastUpdating;
    }

    /**
     * Return true only for the known empty mod placeholder shape.  A real
     * task may legitimately have zero byte progress while queued, so the
     * identifier/name/room fields are required to be empty as well.
     */
    private boolean isInvalidModPlaceholder(@Nullable DmpTask task) {
        if (task == null || !"mod_download".equals(task.type)) {
            return false;
        }
        String name = task.name == null ? "" : task.name.trim();
        String roomName = task.roomName == null ? "" : task.roomName.trim();
        boolean noMod = task.modId <= 0 && name.isEmpty();
        boolean noRoom = task.roomId <= 0 && roomName.isEmpty()
                && (task.roomIds == null || task.roomIds.isEmpty())
                && (task.roomNames == null || task.roomNames.isEmpty());
        boolean noBytes = task.completedBytes <= 0L && task.totalBytes <= 0L
                && task.progress <= 0d;
        return noMod && noRoom && noBytes;
    }

    /**
     * Drop a historical game-update snapshot which was never observed by the
     * server.  This is deliberately time-bounded: a newly submitted task may
     * legitimately sit in queued state for a short period, while a row older
     * than the transition window with no running evidence is only stale cache.
     */
    private boolean isStaleUnconfirmedGameUpdate(@Nullable DmpTask task) {
        if (task == null || !"game_update".equals(task.type) || !task.isRunning()) {
            return false;
        }
        if (task.serverUpdateObserved || task.serverLastUpdating || task.updatedAt <= 0L) {
            return false;
        }
        long updated = task.updatedAt < 100_000_000_000L
                ? task.updatedAt * 1000L : task.updatedAt;
        return System.currentTimeMillis() - updated > 15L * 60L * 1000L;
    }

    private void addNativeTransfers(DmpServer server, LinkedHashMap<String, DmpTask> merged) {
        JSONArray nativeTransfers = DmpJavascriptBridge.queryNativeTransfers(this, server);
        for (int index = 0; index < nativeTransfers.length(); index++) {
            JSONObject item = nativeTransfers.optJSONObject(index);
            if (item == null) continue;
            DmpTask nativeTask = DmpTask.fromJson(server, item);
            String key = taskKey(nativeTask);
            DmpTask previous = merged.get(key);
            if (isPreferredTask(nativeTask, previous)) {
                merged.put(key, nativeTask);
            }
        }
    }

    /**
     * Prefer the freshest snapshot, but keep an actively progressing cached
     * WebView task over an equally-timestamped terminal/API placeholder.  A
     * number of legacy servers omit updatedAt, which used to make the first
     * zero-progress record win forever in the all-platform task dialog.
     */
    private boolean isPreferredTask(DmpTask candidate, @Nullable DmpTask previous) {
        if (previous == null) {
            return true;
        }
        // A successful local legacy update is authoritative for the short
        // window where the server task endpoint still returns an old/error
        // placeholder. Do not regress a completed update to "失败".
        boolean previousSuccess = "success".equals(previous.status)
                || "complete".equals(previous.status)
                || "completed".equals(previous.status)
                || "done".equals(previous.status);
        boolean candidateFailure = "error".equals(candidate.status)
                || "failed".equals(candidate.status);
        if (previousSuccess && candidateFailure) {
            return false;
        }
        boolean candidateSuccess = "success".equals(candidate.status)
                || "complete".equals(candidate.status)
                || "completed".equals(candidate.status)
                || "done".equals(candidate.status);
        boolean previousFailure = "error".equals(previous.status)
                || "failed".equals(previous.status);
        if (candidateSuccess && previousFailure) {
            return true;
        }
        // A completed snapshot is more useful than a stale running/unknown
        // placeholder from the server.  The old comparison only looked at
        // progress, so a successful record with no byte counters (progress=0)
        // could be discarded and disappear from the all-platform queue.
        if (previousSuccess && !candidateSuccess) {
            return false;
        }
        if (candidateSuccess && !previousSuccess) {
            return true;
        }
        if (previous.isTerminal() && !candidate.isTerminal()) {
            return false;
        }
        if (candidate.isTerminal() && !previous.isTerminal()
                && !candidateFailure) {
            return true;
        }
        // A few legacy hosts expose a second, low-information task record
        // (status=unknown/0%) while the WebView already has the live queue
        // snapshot.  Do not let that placeholder replace visible progress
        // merely because its server timestamp is newer.
        if (previous.isRunning() && !candidate.isRunning()) {
            return candidate.isTerminal() && candidate.progress >= previous.progress;
        }
        if (previous.isRunning() && candidate.progress < previous.progress) {
            return false;
        }
        if (candidate.updatedAt != previous.updatedAt) {
            return candidate.updatedAt > previous.updatedAt;
        }
        if (candidate.isRunning() != previous.isRunning()) {
            return candidate.isRunning();
        }
        if (candidate.progress != previous.progress) {
            return candidate.progress > previous.progress;
        }
        if (candidate.completedBytes != previous.completedBytes) {
            return candidate.completedBytes > previous.completedBytes;
        }
        return candidate.finishedAt > previous.finishedAt;
    }

    private String taskKey(DmpTask task) {
        String serverKey = task.server == null || task.server.id == null
                ? "current" : task.server.id;
        // The same mod can be represented by a random server task id, the
        // WebView's semantic id, and the status poll row. Collapse those
        // representations into one room/mod entry before rendering the queue.
        if ("mod_download".equals(task.type) && task.roomId > 0 && task.modId > 0) {
            return "mod|" + serverKey + "|" + task.roomId + "|" + task.modId;
        }
        if (("game_update".equals(task.type) || "server_update".equals(task.type))) {
            return "game_update|" + serverKey;
        }
        if (task.taskId != null && !task.taskId.isEmpty()) {
            return task.type + "|" + serverKey + "|" + task.taskId;
        }
        return task.type + "|" + serverKey + "|" + task.roomId + "|" + task.name;
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
            case "downloading":
                return "下载中";
            case "success":
            case "complete":
            case "completed":
            case "done":
                return "已完成";
            case "failed":
            case "error":
                return "失败";
            case "queued":
                return "等待中";
            case "pausePending":
            case "pause_pending":
            case "pausepending":
                // Older snapshots may retain pause markers, but the Android
                // task centre no longer exposes pause/continue controls.
                return "下载中";
            case "paused":
                return "下载中";
            default:
                return "状态未知";
        }
    }

    private String transferStatusText(String status) {
        String normalized = status == null ? "" : status.toLowerCase(java.util.Locale.US);
        if ("success".equals(normalized) || "complete".equals(normalized)
                || "completed".equals(normalized) || "done".equals(normalized)) {
            return "传输完成";
        }
        if ("failed".equals(normalized) || "error".equals(normalized)) {
            return "传输失败";
        }
        if ("cancelled".equals(normalized) || "canceled".equals(normalized)) {
            return "传输已取消";
        }
        if ("paused".equals(normalized) || "pause_pending".equals(normalized)
                || "pausepending".equals(normalized)) {
            // Keep legacy paused records neutral; no pause/continue action is
            // offered in the mobile task cards.
            return "传输中";
        }
        if ("queued".equals(normalized) || "pending".equals(normalized)) {
            return "等待传输";
        }
        return "传输中";
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

    private void showCreateRoomDialog() {
        ScrollView scrollView = new ScrollView(this);
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dpToPx(18), dpToPx(6), dpToPx(18), dpToPx(4));
        scrollView.addView(content, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        AlertDialog dialog = new MaterialAlertDialogBuilder(this)
                .setTitle(R.string.dmp_create_room_title)
                .setView(scrollView)
                .setNegativeButton(R.string.dmp_create_room_cancel, null)
                .create();

        if (servers.isEmpty()) {
            TextView empty = new TextView(this);
            empty.setText(R.string.dmp_room_empty);
            empty.setTextColor(getColor(R.color.dmp_text_secondary));
            empty.setTextSize(14f);
            empty.setGravity(Gravity.CENTER);
            empty.setPadding(0, dpToPx(28), 0, dpToPx(28));
            content.addView(empty);
        } else {
            for (DmpServer server : servers) {
                content.addView(createRoomPlatformCard(server, dialog));
            }
        }
        dialog.setOnShowListener(ignored -> applyLargeDialogCorners(dialog));
        dialog.show();
    }

    private View createRoomPlatformCard(DmpServer server, AlertDialog dialog) {
        MaterialCardView card = new MaterialCardView(this);
        card.setCardBackgroundColor(getColor(R.color.dmp_card));
        card.setCardElevation(0);
        card.setRadius(dpToPx(16));
        card.setStrokeWidth(dpToPx(1));
        card.setStrokeColor(getColor(R.color.dmp_card_stroke));
        card.setClickable(true);
        card.setFocusable(true);
        card.setForeground(getDrawable(android.R.drawable.list_selector_background));

        LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(dpToPx(16), dpToPx(13), dpToPx(16), dpToPx(13));

        LinearLayout titleRow = new LinearLayout(this);
        titleRow.setGravity(Gravity.CENTER_VERTICAL);
        TextView title = new TextView(this);
        title.setText(serverLabel(server));
        title.setTextColor(getColor(R.color.dmp_text_primary));
        title.setTextSize(16f);
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        titleRow.addView(title, new LinearLayout.LayoutParams(0,
                ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        TextView status = new TextView(this);
        boolean online = server.state == DmpServer.STATE_ONLINE;
        status.setText(online ? R.string.dmp_create_room_online : R.string.dmp_create_room_offline);
        status.setTextColor(getColor(online ? R.color.dmp_green : R.color.dmp_warning));
        status.setTextSize(12f);
        status.setCompoundDrawablesWithIntrinsicBounds(
                android.R.drawable.presence_online, 0, 0, 0);
        status.setCompoundDrawableTintList(android.content.res.ColorStateList.valueOf(
                getColor(online ? R.color.dmp_green : R.color.dmp_warning)));
        status.setCompoundDrawablePadding(dpToPx(4));
        titleRow.addView(status);
        body.addView(titleRow);

        TextView ip = roomDialogLine(getString(R.string.dmp_create_room_ip,
                server.host, server.port));
        body.addView(ip);
        TextView counts = roomDialogLine(getString(R.string.dmp_create_room_counts,
                server.roomCount, server.worldCount));
        body.addView(counts);

        int cpu = online ? (int) Math.round(server.cpu) : 0;
        int memory = online ? (int) Math.round(server.memory) : 0;
        TextView system = roomDialogLine(server.cpuCores > 0 || server.memoryTotalBytes > 0
                ? getString(R.string.dmp_create_room_system,
                server.cpuCores > 0 ? server.cpuCores : 0,
                cpu,
                server.memoryTotalBytes > 0 ? formatBytes(server.memoryTotalBytes) : "—",
                memory)
                : getString(R.string.dmp_create_room_system_unknown, cpu, memory));
        body.addView(system);

        card.addView(body);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.bottomMargin = dpToPx(10);
        card.setLayoutParams(params);
        card.setOnClickListener(v -> {
            dialog.dismiss();
            openCreateRoom(server);
        });
        return card;
    }

    private void openCreateRoom(DmpServer server) {
        Intent intent = new Intent(this, DmpWebActivity.class);
        intent.putExtra(DmpWebActivity.EXTRA_SERVER_ID, server.id);
        intent.putExtra(DmpWebActivity.EXTRA_SERVER_HOST, server.host);
        intent.putExtra(DmpWebActivity.EXTRA_SERVER_PORT, server.port);
        intent.putExtra(DmpWebActivity.EXTRA_SERVER_PROTOCOL, server.protocol);
        intent.putExtra(DmpWebActivity.EXTRA_SERVER_TOKEN, server.token);
        intent.putExtra(DmpWebActivity.EXTRA_SERVER_REMARK, server.remark);
        intent.putExtra(DmpWebActivity.EXTRA_START_CREATE_ROOM, true);
        intent.putExtra(DmpWebActivity.EXTRA_NIGHT_MODE, nightMode);
        intent.putExtra(DmpWebActivity.EXTRA_ANDROID_DOWNLOAD_UI, androidDownloadUi);
        intent.putExtra(DmpWebActivity.EXTRA_ANDROID_MOD_CONFIG_UI, androidModConfigUi);
        startActivity(intent);
    }

    private TextView roomDialogLine(String text) {
        TextView line = new TextView(this);
        line.setText(text);
        line.setTextColor(getColor(R.color.dmp_text_secondary));
        line.setTextSize(13f);
        line.setMaxLines(1);
        line.setEllipsize(android.text.TextUtils.TruncateAt.END);
        line.setPadding(0, dpToPx(5), 0, 0);
        return line;
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
        if (apiClient != null) {
            apiClient.shutdown();
        }
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
