package org.fandex.upnext

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/** Feeds the widget's list. Each row is the app's Up next row (src/components/UpNext.tsx, EpisodeRow). */
class UpNextWidgetService : RemoteViewsService() {
  override fun onGetViewFactory(intent: Intent): RemoteViewsFactory =
    UpNextRows(applicationContext, intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID))
}

private class UpNextRows(private val context: Context, private val widgetId: Int) : RemoteViewsService.RemoteViewsFactory {
  private var rows: List<UpNextRow> = emptyList()

  /**
   * How wide a row's text may be, in dp. The text is drawn here, so the cut has
   * to be made here: the widget's width, less its padding, the poster, the
   * tick and the gaps (the numbers are the two layouts').
   */
  private fun textWidthDp(): Float {
    val options = AppWidgetManager.getInstance(context).getAppWidgetOptions(widgetId)
    val widget = options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0)?.takeIf { it > 0 } ?: 300
    return (widget - 24 - 48 - 12 - 8 - 48).toFloat()
  }

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

  override fun getViewAt(position: Int): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.up_next_widget_row)
    val row = rows.getOrNull(position) ?: return views
    // The app's label: "S.03 E.07".
    val code = "S.%02d E.%02d".format(row.season, row.episode)
    val episode = row.episodeTitle ?: context.getString(R.string.up_next_widget_episode, row.episode)
    val width = textWidthDp()
    val chip = WidgetText.line(context, code, R.font.space_mono, 12f, WidgetText.ACCENT, width)
    val chipDp = chip.width / context.resources.displayMetrics.density + 12
    views.setImageViewBitmap(R.id.up_next_code, chip)
    views.setImageViewBitmap(R.id.up_next_title, WidgetText.line(context, row.title, R.font.dm_serif_display, 15f, WidgetText.PRIMARY, width - chipDp - 8))
    views.setImageViewBitmap(R.id.up_next_episode, WidgetText.line(context, episode, R.font.space_mono, 10f, WidgetText.SECONDARY, width))
    // What a screen reader says for the row, since the pictures say nothing.
    views.setContentDescription(R.id.up_next_title, "${row.title}, season ${row.season} episode ${row.episode}, $episode")

    // getViewAt runs on a binder thread, so reading the poster here blocks no screen.
    val poster = poster(row.posterUrl)
    if (poster != null) views.setImageViewBitmap(R.id.up_next_poster, poster)
    else views.setImageViewResource(R.id.up_next_poster, android.R.color.transparent)

    views.setOnClickFillInIntent(R.id.up_next_open, Intent().setData(WidgetTapActivity.openUri(row.id)))
    if (row.busy) {
      // Ticked and on its way to Trakt: the box is filled, as in the app, and takes no second tap.
      views.setViewVisibility(R.id.up_next_box, View.GONE)
      views.setViewVisibility(R.id.up_next_done, View.VISIBLE)
    } else {
      views.setViewVisibility(R.id.up_next_box, View.VISIBLE)
      views.setViewVisibility(R.id.up_next_done, View.GONE)
      views.setOnClickFillInIntent(R.id.up_next_tick, Intent().setData(WidgetTapActivity.tickUri(row.id, row.season, row.episode)))
    }
    return views
  }

  /**
   * The show's poster, small. Fetched once and kept in the cache folder: a
   * widget redraws often and a home screen should not wait on the network for a
   * picture it has shown before. Any failure is a row without a picture.
   */
  private fun poster(url: String?): Bitmap? {
    if (url.isNullOrBlank()) return null
    return try {
      // TMDB serves the same poster at several widths. The row shows it 48dp wide.
      val small = url.replace(Regex("/t/p/w\\d+/"), "/t/p/w154/")
      val file = File(context.cacheDir, "upnext-" + Integer.toHexString(small.hashCode()) + ".img")
      if (!file.exists()) {
        val tmp = File(context.cacheDir, file.name + ".tmp")
        val connection = URL(small).openConnection() as HttpURLConnection
        connection.connectTimeout = 4000
        connection.readTimeout = 6000
        try {
          connection.inputStream.use { input -> tmp.outputStream().use { input.copyTo(it) } }
        } finally {
          connection.disconnect()
        }
        if (!tmp.renameTo(file)) { tmp.delete(); return null }
      }
      BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inPreferredConfig = Bitmap.Config.RGB_565 })
    } catch (e: Exception) {
      null
    }
  }
}
