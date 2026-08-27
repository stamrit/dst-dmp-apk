package cn.xiaojie_gjs.dmp.ui.dmp;

import android.content.Context;
import android.util.AttributeSet;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.widget.FrameLayout;

/**
 * Small dependency-free pull-to-refresh container for the native DMP pages.
 * It deliberately only starts intercepting when the child is already at the
 * top, so normal RecyclerView scrolling and card clicks remain untouched.
 */
public class DmpPullRefreshLayout extends FrameLayout {

    public interface OnRefreshListener {
        void onRefresh();
    }

    /**
     * Receives a deliberate horizontal swipe without stealing ordinary card
     * clicks or vertical RecyclerView scrolling.  Direction is -1 for a
     * leftward swipe and +1 for a rightward swipe.
     */
    public interface OnHorizontalSwipeListener {
        void onSwipe(int direction);
    }

    private final int touchSlop;
    private float downY;
    private float downX;
    private float pullDistance;
    private boolean dragging;
    private boolean horizontalDragging;
    private boolean refreshing;
    private OnRefreshListener listener;
    private OnHorizontalSwipeListener horizontalSwipeListener;

    public DmpPullRefreshLayout(Context context) {
        this(context, null);
    }

    public DmpPullRefreshLayout(Context context, AttributeSet attrs) {
        this(context, attrs, 0);
    }

    public DmpPullRefreshLayout(Context context, AttributeSet attrs, int defStyleAttr) {
        super(context, attrs, defStyleAttr);
        touchSlop = ViewConfiguration.get(context).getScaledTouchSlop();
        setClipToPadding(false);
    }

    public void setOnRefreshListener(OnRefreshListener listener) {
        this.listener = listener;
    }

    public void setOnHorizontalSwipeListener(OnHorizontalSwipeListener listener) {
        this.horizontalSwipeListener = listener;
    }

    public boolean isRefreshing() {
        return refreshing;
    }

    public void setRefreshing(boolean value) {
        if (refreshing == value) {
            return;
        }
        refreshing = value;
        if (!value) {
            resetPull();
        }
    }

    private View contentView() {
        return getChildCount() == 0 ? null : getChildAt(0);
    }

    private boolean childAtTop() {
        View child = contentView();
        return child == null || !child.canScrollVertically(-1);
    }

    @Override
    public boolean onInterceptTouchEvent(MotionEvent event) {
        if (refreshing) {
            return false;
        }
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                downX = event.getX();
                downY = event.getY();
                dragging = false;
                horizontalDragging = false;
                pullDistance = 0f;
                break;
            case MotionEvent.ACTION_MOVE:
                float deltaX = event.getX() - downX;
                float deltaY = event.getY() - downY;
                if (!dragging && !horizontalDragging
                        && Math.abs(deltaX) > touchSlop
                        && Math.abs(deltaX) > Math.abs(deltaY) * 1.2f) {
                    horizontalDragging = true;
                    return true;
                }
                if (!dragging && !horizontalDragging
                        && deltaY > touchSlop && childAtTop()) {
                    dragging = true;
                    return true;
                }
                break;
            case MotionEvent.ACTION_CANCEL:
            case MotionEvent.ACTION_UP:
                dragging = false;
                horizontalDragging = false;
                break;
            default:
                break;
        }
        return dragging || horizontalDragging;
    }

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        if (refreshing) {
            return true;
        }
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_MOVE:
                if (horizontalDragging) {
                    return true;
                }
                if (!dragging) {
                    return true;
                }
                float delta = Math.max(0f, event.getY() - downY);
                pullDistance = Math.min(getResources().getDisplayMetrics().density * 112f,
                        delta * 0.52f);
                View child = contentView();
                if (child != null) {
                    child.setTranslationY(pullDistance);
                }
                return true;
            case MotionEvent.ACTION_CANCEL:
            case MotionEvent.ACTION_UP:
                if (horizontalDragging) {
                    float deltaX = event.getX() - downX;
                    horizontalDragging = false;
                    if (event.getActionMasked() == MotionEvent.ACTION_UP
                            && Math.abs(deltaX)
                            >= getResources().getDisplayMetrics().density * 72f
                            && horizontalSwipeListener != null) {
                        horizontalSwipeListener.onSwipe(deltaX < 0f ? -1 : 1);
                    }
                    return true;
                }
                if (dragging) {
                    boolean trigger = pullDistance >= getResources().getDisplayMetrics().density * 64f;
                    dragging = false;
                    if (trigger) {
                        refreshing = true;
                        resetPull();
                        if (listener != null) {
                            listener.onRefresh();
                        }
                    } else {
                        resetPull();
                    }
                }
                return true;
            default:
                return true;
        }
    }

    private void resetPull() {
        View child = contentView();
        if (child != null && child.getTranslationY() != 0f) {
            child.animate().translationY(0f).setDuration(180L).start();
        }
        pullDistance = 0f;
    }
}
