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
 * It holds no logic of its own. The list is whatever the app last wrote to the
 * `up_next` table (UpNextWidgetService reads it), and both taps are addresses
 * the app already answers: a row opens the show's page, the tick opens
 * `fandex://tick/…`, where the app marks the episode watched on Trakt and in
 * your rows. So there is one place that knows how to write, and it is not here.
 */
class UpNextWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) manager.updateAppWidget(id, views(context, id))
    // The periodic update re-reads the table too, not only the frame around it.
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
      views.setRemoteAdapter(R.id.up_next_list, service)
      views.setEmptyView(R.id.up_next_list, R.id.up_next_empty)

      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)

      // Each row fills in the address; this template says where an address goes.
      // Mutable because the fill-in has to be merged into it, and Android 14
      // only allows a mutable one that names its activity.
      val open = Intent(Intent.ACTION_VIEW).setPackage(context.packageName)
      launch?.component?.let { open.component = it }
      val template = PendingIntent.getActivity(
        context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
      )
      views.setPendingIntentTemplate(R.id.up_next_list, template)

      // The heading opens the app.
      launch?.let {
        views.setOnClickPendingIntent(
          R.id.up_next_heading,
          PendingIntent.getActivity(context, 1, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE),
        )
      }
      return views
    }

    /** Re-read the table in every placed widget. Called by the app after it writes `up_next`. */
    fun refreshAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, UpNextWidgetProvider::class.java))
      if (ids.isNotEmpty()) manager.notifyAppWidgetViewDataChanged(ids, R.id.up_next_list)
    }

    /** How many are on the home screen. */
    fun placed(context: Context): Int =
      AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, UpNextWidgetProvider::class.java)).size
  }
}
