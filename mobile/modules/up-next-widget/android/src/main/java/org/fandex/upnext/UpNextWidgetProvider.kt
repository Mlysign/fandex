package org.fandex.upnext

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.widget.RemoteViews
import androidx.annotation.RequiresApi
import java.util.concurrent.Executors

/**
 * The Up next home-screen widget: the next episode of each show you are part
 * way through, with a tick.
 *
 * It holds no logic of its own. The rows are whatever the app last handed over
 * (UpNextStore), a tap on a show opens its page in the app, and a tap on the
 * tick runs the app's own "mark watched" in the background (UpNextTickReceiver)
 * without opening anything. So there is one place that knows how to write, and
 * it is not here.
 *
 * ⚠️ From Android 12 the rows travel INSIDE the widget's one update
 * (RemoteCollectionItems), never through a list service and a separate "data
 * changed" call. The Pixel launcher defers and replays those two channels apart,
 * and the widget showed one state while its taps belonged to another: once the
 * rows were new and the taps dead (docs/app.md), and on 2026-10-20 the taps new
 * and the rows old (a tick moved One Piece to the top, the top row still read
 * Sunny and opened One Piece). One update carries both, so they cannot disagree.
 */
class UpNextWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    val pending = goAsync()
    refresh(context.applicationContext, ids) { pending.finish() }
  }

  /** Resized: the rows cut their text to the width, so they are drawn again. */
  override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) {
    val pending = goAsync()
    refresh(context.applicationContext, intArrayOf(id)) { pending.finish() }
  }

  companion object {
    private const val TAG = "FandexUpNext"

    /**
     * Every redraw runs here, one at a time and in the order asked. Off the main
     * thread because a row reads its poster from the network the first time, and
     * in order because a tick redraws three times in a few seconds (marking,
     * the new rows, the flag cleared) and the last one asked must be the last
     * one drawn.
     */
    private val worker = Executors.newSingleThreadExecutor()

    private fun views(context: Context, widgetId: Int, rows: List<UpNextRow>): RemoteViews {
      val views = RemoteViews(context.packageName, R.layout.up_next_widget)
      // As small as a row's episode line (Nils, 2026-10-18: "the up next text
      // can be much smaller"), so the rows get the room. An eyebrow, in the
      // app's mono, as the section labels in the app are.
      views.setImageViewBitmap(
        R.id.up_next_heading,
        WidgetText.line(context, context.getString(R.string.up_next_widget_name).uppercase(), R.font.space_mono, 10f, WidgetText.SECONDARY, 240f),
      )

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        setRows(context, views, widgetId, rows)
      } else {
        val service = Intent(context, UpNextWidgetService::class.java).apply {
          putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
          // Distinct per widget, or Android reuses one adapter for all of them.
          data = Uri.parse(toUri(Intent.URI_INTENT_SCHEME))
        }
        @Suppress("DEPRECATION")
        views.setRemoteAdapter(R.id.up_next_list, service)
      }
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

    @RequiresApi(Build.VERSION_CODES.S)
    private fun setRows(context: Context, views: RemoteViews, widgetId: Int, rows: List<UpNextRow>) {
      val width = UpNextRowViews.textWidthDp(context, widgetId)
      val items = RemoteViews.RemoteCollectionItems.Builder().setViewTypeCount(1).setHasStableIds(false)
      rows.forEachIndexed { i, row -> items.addItem(i.toLong(), UpNextRowViews.build(context, row, width)) }
      views.setRemoteAdapter(R.id.up_next_list, items.build())
    }

    /** Redraw these widgets from the stored rows, then call `done`, whatever happened. */
    private fun refresh(context: Context, ids: IntArray, done: (() -> Unit)?) {
      worker.execute {
        try {
          if (ids.isNotEmpty()) {
            val manager = AppWidgetManager.getInstance(context)
            val rows = UpNextStore.read(context)
            for (id in ids) manager.updateAppWidget(id, views(context, id, rows))
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
              @Suppress("DEPRECATION")
              manager.notifyAppWidgetViewDataChanged(ids, R.id.up_next_list)
            }
          }
        } catch (e: Exception) {
          // A widget that did not redraw is not worth taking the app down for.
          Log.w(TAG, "widget redraw failed", e)
        } finally {
          done?.invoke()
        }
      }
    }

    private fun ids(context: Context): IntArray =
      AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, UpNextWidgetProvider::class.java))

    /**
     * Redraw every placed widget from the stored rows. `done` runs once the
     * launcher has been handed the update: a receiver holding goAsync() must
     * not let go before that, or its process may be frozen with the redraw unsent.
     */
    fun refreshAll(context: Context, done: (() -> Unit)? = null) {
      refresh(context.applicationContext, ids(context), done)
    }

    /** How many are on the home screen. */
    fun placed(context: Context): Int = ids(context).size
  }
}
