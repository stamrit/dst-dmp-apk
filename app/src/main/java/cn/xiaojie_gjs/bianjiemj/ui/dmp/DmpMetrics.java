package cn.xiaojie_gjs.bianjiemj.ui.dmp;

/** Monitoring values shown on a DMP server card. */
public class DmpMetrics {
    public final double cpu;
    public final double memory;
    public final int roomCount;
    public final int worldCount;

    public DmpMetrics(double cpu, double memory, int roomCount, int worldCount) {
        this.cpu = cpu;
        this.memory = memory;
        this.roomCount = roomCount;
        this.worldCount = worldCount;
    }
}
