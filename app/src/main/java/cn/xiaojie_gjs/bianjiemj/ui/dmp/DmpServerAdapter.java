package cn.xiaojie_gjs.bianjiemj.ui.dmp;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.PopupMenu;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.recyclerview.widget.DiffUtil;
import androidx.recyclerview.widget.RecyclerView;

import com.google.android.material.progressindicator.CircularProgressIndicator;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Objects;

import cn.xiaojie_gjs.dmp.R;

/** Renders DMP server cards and the final create card. */
public class DmpServerAdapter extends RecyclerView.Adapter<RecyclerView.ViewHolder> {

    public interface Listener {
        void onAdd();
        void onEnter(DmpServer server);
        void onRefresh(DmpServer server);
        void onEdit(DmpServer server);
        void onDelete(DmpServer server);
    }

    private static final int TYPE_SERVER = 1;
    private static final int TYPE_ADD = 2;
    private final Listener listener;
    private List<DmpServer> servers = new ArrayList<>();

    public DmpServerAdapter(Listener listener) {
        this.listener = listener;
    }

    public void setServers(List<DmpServer> values) {
        List<DmpServer> oldServers = servers;
        List<DmpServer> newServers = new ArrayList<>(values);
        DiffUtil.DiffResult result = DiffUtil.calculateDiff(new DiffUtil.Callback() {
            @Override
            public int getOldListSize() {
                return oldServers.size() + 1;
            }

            @Override
            public int getNewListSize() {
                return newServers.size() + 1;
            }

            @Override
            public boolean areItemsTheSame(int oldPosition, int newPosition) {
                boolean oldAdd = oldPosition == oldServers.size();
                boolean newAdd = newPosition == newServers.size();
                if (oldAdd || newAdd) {
                    return oldAdd && newAdd;
                }
                return oldServers.get(oldPosition).id.equals(newServers.get(newPosition).id);
            }

            @Override
            public boolean areContentsTheSame(int oldPosition, int newPosition) {
                if (oldPosition == oldServers.size() || newPosition == newServers.size()) {
                    return true;
                }
                DmpServer oldServer = oldServers.get(oldPosition);
                DmpServer newServer = newServers.get(newPosition);
                return oldServer.port == newServer.port
                        && oldServer.state == newServer.state
                        && oldServer.roomCount == newServer.roomCount
                        && oldServer.worldCount == newServer.worldCount
                        && Double.compare(oldServer.cpu, newServer.cpu) == 0
                        && Double.compare(oldServer.memory, newServer.memory) == 0
                        && Objects.equals(oldServer.host, newServer.host)
                        && Objects.equals(oldServer.protocol, newServer.protocol)
                        && Objects.equals(oldServer.token, newServer.token)
                        && Objects.equals(oldServer.remark, newServer.remark)
                        && Objects.equals(oldServer.statusMessage, newServer.statusMessage);
            }
        });
        servers = newServers;
        result.dispatchUpdatesTo(this);
    }

    public void notifyServerChanged(String serverId) {
        for (int index = 0; index < servers.size(); index++) {
            if (servers.get(index).id.equals(serverId)) {
                notifyItemChanged(index);
                return;
            }
        }
    }

    @Override
    public int getItemViewType(int position) {
        return position < servers.size() ? TYPE_SERVER : TYPE_ADD;
    }

    @NonNull
    @Override
    public RecyclerView.ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        LayoutInflater inflater = LayoutInflater.from(parent.getContext());
        if (viewType == TYPE_ADD) {
            return new AddViewHolder(inflater.inflate(R.layout.item_dmp_add, parent, false));
        }
        return new ServerViewHolder(inflater.inflate(R.layout.item_dmp_server, parent, false));
    }

    @Override
    public void onBindViewHolder(@NonNull RecyclerView.ViewHolder holder, int position) {
        if (holder instanceof AddViewHolder) {
            holder.itemView.setOnClickListener(v -> listener.onAdd());
            return;
        }
        bindServer((ServerViewHolder) holder, servers.get(position));
    }

    @Override
    public int getItemCount() {
        return servers.size() + 1;
    }

    private void bindServer(ServerViewHolder holder, DmpServer server) {
        holder.title.setText(server.remark.isEmpty() ? holder.itemView.getContext()
                .getString(R.string.dmp_no_remark) : server.remark);
        holder.remark.setText(server.host);
        holder.address.setText(server.baseUrl());
        holder.enter.setOnClickListener(v -> listener.onEnter(server));
        holder.options.setOnClickListener(v -> showOptions(holder.options, server));

        boolean online = server.state == DmpServer.STATE_ONLINE;
        holder.roomCount.setText(online
                ? holder.itemView.getContext().getString(R.string.dmp_rooms_value, server.roomCount)
                : holder.itemView.getContext().getString(R.string.dmp_rooms_unknown));
        holder.worldCount.setText(online
                ? holder.itemView.getContext().getString(R.string.dmp_worlds_value, server.worldCount)
                : holder.itemView.getContext().getString(R.string.dmp_worlds_unknown));
        int cpu = online ? (int) Math.round(server.cpu) : 0;
        int memory = online ? (int) Math.round(server.memory) : 0;
        holder.cpuProgress.setProgress(cpu);
        holder.memoryProgress.setProgress(memory);
        holder.cpuValue.setText(online ? String.format(Locale.CHINA, "%d%%", cpu) : "—");
        holder.memoryValue.setText(online ? String.format(Locale.CHINA, "%d%%", memory) : "—");

        if (server.state == DmpServer.STATE_LOADING) {
            setStatus(holder, R.string.dmp_card_refreshing, R.color.dmp_primary_text);
        } else if (online) {
            setStatus(holder, R.string.dmp_card_online, R.color.dmp_green);
        } else if (server.state == DmpServer.STATE_OFFLINE) {
            holder.status.setText(server.statusMessage);
            holder.status.setTextColor(color(holder, R.color.dmp_warning));
        } else {
            setStatus(holder, R.string.dmp_card_waiting, R.color.dmp_text_secondary);
        }
    }

    private void setStatus(ServerViewHolder holder, int textResource, int colorResource) {
        holder.status.setText(textResource);
        holder.status.setTextColor(color(holder, colorResource));
    }

    private int color(ServerViewHolder holder, int colorResource) {
        return ContextCompat.getColor(holder.itemView.getContext(), colorResource);
    }

    private void showOptions(View anchor, DmpServer server) {
        PopupMenu menu = new PopupMenu(anchor.getContext(), anchor);
        menu.getMenu().add(R.string.dmp_refresh).setOnMenuItemClickListener(item -> {
            listener.onRefresh(server);
            return true;
        });
        menu.getMenu().add(R.string.dmp_edit).setOnMenuItemClickListener(item -> {
            listener.onEdit(server);
            return true;
        });
        menu.getMenu().add(R.string.dmp_delete).setOnMenuItemClickListener(item -> {
            listener.onDelete(server);
            return true;
        });
        menu.show();
    }

    static class ServerViewHolder extends RecyclerView.ViewHolder {
        final TextView title;
        final TextView remark;
        final TextView address;
        final TextView roomCount;
        final TextView worldCount;
        final TextView status;
        final TextView options;
        final TextView cpuValue;
        final TextView memoryValue;
        final CircularProgressIndicator cpuProgress;
        final CircularProgressIndicator memoryProgress;
        final Button enter;

        ServerViewHolder(@NonNull View itemView) {
            super(itemView);
            title = itemView.findViewById(R.id.dmp_server_title);
            remark = itemView.findViewById(R.id.dmp_server_remark);
            address = itemView.findViewById(R.id.dmp_server_address);
            roomCount = itemView.findViewById(R.id.dmp_room_count);
            worldCount = itemView.findViewById(R.id.dmp_world_count);
            status = itemView.findViewById(R.id.dmp_server_status);
            options = itemView.findViewById(R.id.dmp_server_options);
            cpuValue = itemView.findViewById(R.id.dmp_cpu_value);
            memoryValue = itemView.findViewById(R.id.dmp_memory_value);
            cpuProgress = itemView.findViewById(R.id.dmp_cpu_progress);
            memoryProgress = itemView.findViewById(R.id.dmp_memory_progress);
            enter = itemView.findViewById(R.id.dmp_enter_button);
        }
    }

    static class AddViewHolder extends RecyclerView.ViewHolder {
        AddViewHolder(@NonNull View itemView) {
            super(itemView);
        }
    }
}
