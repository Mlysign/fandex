package org.fandex.upnext

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews

/**
 * The Up next home-screen widget: the next episode of each show you are part
 * way through, with a tick.
 *
 * It holds no logic of its own. The rows are whatever the app last handed over
 * (UpNextStore), a tap on a show opens its page in the app, and a tap on the
 * tick runs the app's own "mark watched" in the background (UpNextTickReceiver)
 * without opening anything. So there is one place that knows how to write, and
 * it is not here.
 */
class UpNextWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) manager.updateAppWidget(id, views(context, id))
    // The periodic update re-reads the rows too, not only the frame around them.
    @Suppress("DEPRECATION")
    manager.notifyAppWidgetViewDataChanged(ids, R.id.up_next_list)
  }

  companion object {
    private fun views(context: Context, widgetId: Int): RemoteViews {
      val views = RemoteViews(context.packageName, R.layout.up_next_widget)

      val service = Intent(context, UpNextWidgetService::class.java).apply {
        putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
        // Distinct per widget, or Android reuses one adapter for all of them.
        data = Uri.parse(toUri(Intent.URI_INTENT_SCHEME))
      }
      @Suppress("DEPRECATION")
      views.setRemoteAdapter(R.id.up_next_list, service)
      views.setEmptyView(R.id.up_next_list, R.id.up_next_empty)

      // Each row fills in what was tapped; this template says where a tap goes.
      // Mutable because the fill-in is merged into it, and Android 14 only
      // allows a mutable one that names its component, which this does.
      val tap = Intent(context, WidgetTapActivity::class.java)
      val template = PendingIntent.getActivity(
        context, 0, tap, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
      )
      views.setPendingIntentTemplate(R.id.up_next_list, template)

      // The heading opens the app.
      context.packageManager.getLaunchIntentForPackage(context.packageName)?.let {
        views.setOnClickPendingIntent(
          R.id.up_next_heading,
          PendingIntent.getActivity(context, 1, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE),
        )
      }
      return views
    }

    private fun ids(context: Context): IntArray =
      AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, UpNextWidgetProvider::class.java))

    /** Re-read the rows in every placed widget. */
    fun refreshAll(context: Context) {
      val placed = ids(context)
      if (placed.isEmpty()) return
      val manager = AppWidgetManager.getInstance(context)
      // The frame too: a widget placed by an older build keeps that build's tap template until it is redrawn.
      for (id in placed) manager.updateAppWidget(id, views(context, id))
      @Suppress("DEPRECATION")
      manager.notifyAppWidgetViewDataChanged(placed, R.id.up_next_list)
    }

    /** How many are on the home screen. */
    fun placed(context: Context): Int = ids(context).size
  }
}
