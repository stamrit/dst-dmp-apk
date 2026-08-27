package cn.xiaojie_gjs.dmp.ui.dmp;

/** Monitoring values shown on a DMP server card. */
public class DmpMetrics {
    public final double cpu;
    public final double memory;
    public final int roomCount;
    public final int worldCount;
    public final int cpuCores;
    public final long memoryTotalBytes;
    public final boolean updating;

    public DmpMetrics(
            double cpu,
            double memory,
            int roomCount,
            int worldCount,
            int cpuCores,
            long memoryTotalBytes,
            boolean updating) {
        this.cpu = cpu;
        this.memory = memory;
        this.roomCount = roomCount;
        this.worldCount = worldCount;
        this.cpuCores = cpuCores;
        this.memoryTotalBytes = memoryTotalBytes;
        this.updating = updating;
    }
}
