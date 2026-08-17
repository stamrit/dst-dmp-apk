package cn.xiaojie_gjs.bianjiemj.ui.dmp;

/** Local/latest DST version snapshot for one DMP host. */
public class DmpVersion {
    public final int local;
    public final int latest;
    public final boolean taskApiSupported;

    public DmpVersion(int local, int latest, boolean taskApiSupported) {
        this.local = local;
        this.latest = latest;
        this.taskApiSupported = taskApiSupported;
    }

    public boolean needsUpdate() {
        return latest > 0 && local < latest;
    }
}
