package org.fandex.upnext

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import android.widget.RemoteViewsService

/**
 * Feeds the widget's list on Android 11 and older only. From Android 12 the rows
 * travel inside the widget's own update (UpNextWidgetProvider), and this service
 * is never bound.
 */
class UpNextWidgetService : RemoteViewsService() {
  override fun onGetViewFactory(intent: Intent): RemoteViewsFactory =
    UpNextRows(applicationContext, intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID))
}

private class UpNextRows(private val context: Context, private val widgetId: Int) : RemoteViewsService.RemoteViewsFactory {
  private var rows: List<UpNextRow> = emptyList()

  override fun onCreate() {}
  override fun onDestroy() {}

  override fun onDataSetChanged() {
    rows = UpNextStore.read(context)
  }

  override fun getCount(): Int = rows.size
  override fun getViewTypeCount(): Int = 1
  override fun hasStableIds(): Boolean = false
  override fun getItemId(position: Int): Long = position.toLong()
  override fun getLoadingView(): RemoteViews? = null

  // getViewAt runs on a binder thread, so the poster may be read here.
  override fun getViewAt(position: Int): RemoteViews {
    val row = rows.getOrNull(position) ?: return RemoteViews(context.packageName, R.layout.up_next_widget_row)
    return UpNextRowViews.build(context, row, UpNextRowViews.textWidthDp(context, widgetId))
  }
}
