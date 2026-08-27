package cn.xiaojie_gjs.dmp.ui.dmp;

/** Local/latest DST version snapshot for one DMP host. */
public class DmpVersion {
    public final int local;
    public final int latest;
    /** True when the unified /v3/tasks API is available on this host. */
    public final boolean taskApiSupported;
    /** True when the client has a known update route (native or legacy). */
    public final boolean updateSupported;

    public DmpVersion(int local, int latest, boolean taskApiSupported) {
        this(local, latest, taskApiSupported, taskApiSupported);
    }

    public DmpVersion(
            int local,
            int latest,
            boolean taskApiSupported,
            boolean updateSupported) {
        this.local = local;
        this.latest = latest;
        this.taskApiSupported = taskApiSupported;
        this.updateSupported = updateSupported;
    }

    public boolean needsUpdate() {
        return latest > 0 && local < latest;
    }
}
