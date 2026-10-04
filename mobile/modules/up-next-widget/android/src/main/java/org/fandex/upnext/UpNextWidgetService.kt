package org.fandex.upnext

import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService

/** Supplies the widget's rows. Android asks for them on its own thread. */
class UpNextWidgetService : RemoteViewsService() {
  override fun onGetViewFactory(intent: Intent): RemoteViewsFactory = UpNextRows(applicationContext)
}

private class UpNextRows(private val context: Context) : RemoteViewsService.RemoteViewsFactory {
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

  override fun getViewAt(position: Int): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.up_next_widget_row)
    val row = rows.getOrNull(position) ?: return views
    views.setTextViewText(R.id.up_next_title, row.title)
    val episode = "S${row.season} E${row.episode}" + (row.episodeTitle?.let { " · $it" } ?: "")
    views.setTextViewText(R.id.up_next_episode, if (row.busy) context.getString(R.string.up_next_widget_marking, episode) else episode)

    // Two tap targets, two outcomes: the text opens the show, the tick marks the
    // episode. Both go to WidgetTapActivity, which the list's template names.
    views.setOnClickFillInIntent(R.id.up_next_open, Intent().setData(WidgetTapActivity.openUri(row.id)))
    if (row.busy) {
      // A tick in flight is not tappable again: a second tap would log a second play.
      views.setViewVisibility(R.id.up_next_tick, View.INVISIBLE)
    } else {
      views.setViewVisibility(R.id.up_next_tick, View.VISIBLE)
      views.setOnClickFillInIntent(R.id.up_next_tick, Intent().setData(WidgetTapActivity.tickUri(row.id, row.season, row.episode)))
    }
    return views
  }
}
