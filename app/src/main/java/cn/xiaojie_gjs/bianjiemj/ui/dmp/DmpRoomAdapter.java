package cn.xiaojie_gjs.bianjiemj.ui.dmp;

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
    }

    private final Listener listener;
    private final List<DmpRoom> rooms = new ArrayList<>();

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
        return new RoomViewHolder(LayoutInflater.from(parent.getContext())
                .inflate(R.layout.item_dmp_room, parent, false));
    }

    @Override
    public void onBindViewHolder(@NonNull RoomViewHolder holder, int position) {
        DmpRoom room = rooms.get(position);
        holder.title.setText(room.gameName);
        holder.state.setText(room.online ? R.string.dmp_room_online : R.string.dmp_room_offline);
        holder.state.setTextColor(ContextCompat.getColor(holder.itemView.getContext(),
                room.online ? R.color.dmp_green : R.color.dmp_warning));
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
        holder.itemView.setOnClickListener(v -> listener.onOpenRoom(room));
    }

    @Override
    public int getItemCount() {
        return rooms.size();
    }

    static class RoomViewHolder extends RecyclerView.ViewHolder {
        final TextView title;
        final TextView state;
        final TextView server;
        final TextView description;
        final TextView mode;
        final TextView worlds;

        RoomViewHolder(@NonNull View itemView) {
            super(itemView);
            title = itemView.findViewById(R.id.dmp_room_title);
            state = itemView.findViewById(R.id.dmp_room_state);
            server = itemView.findViewById(R.id.dmp_room_server);
            description = itemView.findViewById(R.id.dmp_room_description);
            mode = itemView.findViewById(R.id.dmp_room_mode);
            worlds = itemView.findViewById(R.id.dmp_room_worlds);
        }
    }
}
