package cn.xiaojie_gjs.dmp.ui.dmp;

import android.content.Context;
import android.graphics.drawable.GradientDrawable;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.recyclerview.widget.RecyclerView;

import java.util.ArrayList;
import java.util.List;

import cn.xiaojie_gjs.dmp.R;

/** Snapshot list of rooms aggregated from every saved DMP server. */
public class DmpRoomAdapter extends RecyclerView.Adapter<DmpRoomAdapter.RoomViewHolder> {

    public interface Listener {
        void onOpenRoom(DmpRoom room);
        void onRoomActions(DmpRoom room);
        void onCreateRoom();
    }

    private final Listener listener;
    private final List<DmpRoom> rooms = new ArrayList<>();
    private static final int TYPE_ROOM = 1;
    private static final int TYPE_CREATE = 2;

    DmpRoomAdapter(Listener listener) {
        this.listener = listener;
    }

    void setRooms(List<DmpRoom> values) {
        rooms.clear();
        rooms.addAll(values);
        notifyDataSetChanged();
    }

    @NonNull
    @Override
    public RoomViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        if (viewType == TYPE_CREATE) {
            return new RoomViewHolder(LayoutInflater.from(parent.getContext())
                    .inflate(R.layout.item_dmp_create_room, parent, false));
        }
        return new RoomViewHolder(LayoutInflater.from(parent.getContext())
                .inflate(R.layout.item_dmp_room, parent, false));
    }

    @Override
    public void onBindViewHolder(@NonNull RoomViewHolder holder, int position) {
        if (position == rooms.size()) {
            holder.itemView.setOnClickListener(v -> listener.onCreateRoom());
            return;
        }
        DmpRoom room = rooms.get(position);
        holder.title.setText(room.gameName);
        holder.runningState.setText(room.running
                ? R.string.dmp_room_running : R.string.dmp_room_stopped);
        applyStatusChip(holder.runningState, room.running);
        holder.state.setText(room.online ? R.string.dmp_room_online : R.string.dmp_room_offline);
        applyStatusChip(holder.state, room.online);
        String serverName = room.server.remark.isEmpty() ? room.server.host : room.server.remark;
        holder.server.setText(holder.itemView.getContext().getString(
                R.string.dmp_room_server_value, serverName));
        holder.description.setText(room.playerNames.isEmpty()
                ? holder.itemView.getContext().getString(
                        R.string.dmp_room_players_empty,
                        room.onlinePlayers,
                        room.maxPlayers)
                : holder.itemView.getContext().getString(
                        R.string.dmp_room_players,
                        room.onlinePlayers,
                        room.maxPlayers,
                        room.playerNames));
        holder.mode.setText(room.gameMode.isEmpty() ? "DST" : room.gameMode);
        holder.worlds.setText(holder.itemView.getContext().getString(
                R.string.dmp_room_summary,
                room.worldCount,
                room.onlinePlayers,
                room.maxPlayers));
        if (holder.operation != null) {
            // The room card itself opens the room. Consume the operation
            // button's touch sequence explicitly so a tap on 操作 cannot
            // bubble through the card and open the control page as well.
            // Calling performClick() on ACTION_UP preserves the normal
            // accessibility/click contract while keeping the two actions
            // mutually exclusive.
            holder.operation.setOnTouchListener((v, event) -> {
                switch (event.getActionMasked()) {
                    case android.view.MotionEvent.ACTION_DOWN:
                        v.setPressed(true);
                        return true;
                    case android.view.MotionEvent.ACTION_UP:
                        v.setPressed(false);
                        v.performClick();
                        return true;
                    case android.view.MotionEvent.ACTION_CANCEL:
                        v.setPressed(false);
                        return true;
                    default:
                        return true;
                }
            });
            holder.operation.setOnClickListener(v -> listener.onRoomActions(room));
        }
        holder.itemView.setOnClickListener(v -> listener.onOpenRoom(room));
    }

    /** Apply both the text and the state-specific surface to a room chip. */
    private void applyStatusChip(@NonNull TextView chip, boolean positive) {
        int color = ContextCompat.getColor(chip.getContext(),
                positive ? R.color.dmp_green : R.color.dmp_warning);
        int surface = ContextCompat.getColor(chip.getContext(),
                positive ? R.color.dmp_green_surface : R.color.dmp_warning_surface);
        GradientDrawable background = new GradientDrawable();
        background.setColor(surface);
        background.setStroke(dp(chip.getContext(), 1), color);
        background.setCornerRadius(dp(chip.getContext(), 9));
        chip.setBackground(background);
        chip.setTextColor(color);
    }

    private int dp(Context context, int value) {
        return Math.round(value * context.getResources().getDisplayMetrics().density);
    }

    @Override
    public int getItemCount() {
        return rooms.size() + 1;
    }

    @Override
    public int getItemViewType(int position) {
        return position == rooms.size() ? TYPE_CREATE : TYPE_ROOM;
    }

    static class RoomViewHolder extends RecyclerView.ViewHolder {
        final TextView title;
        final TextView runningState;
        final TextView state;
        final TextView server;
        final TextView description;
        final TextView mode;
        final TextView worlds;
        final View operation;

        RoomViewHolder(@NonNull View itemView) {
            super(itemView);
            title = itemView.findViewById(R.id.dmp_room_title);
            runningState = itemView.findViewById(R.id.dmp_room_running_state);
            state = itemView.findViewById(R.id.dmp_room_state);
            server = itemView.findViewById(R.id.dmp_room_server);
            description = itemView.findViewById(R.id.dmp_room_description);
            mode = itemView.findViewById(R.id.dmp_room_mode);
            worlds = itemView.findViewById(R.id.dmp_room_worlds);
            operation = itemView.findViewById(R.id.dmp_room_operation);
        }
    }
}
