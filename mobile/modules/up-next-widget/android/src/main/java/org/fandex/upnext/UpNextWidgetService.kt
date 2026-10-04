package org.fandex.upnext

import android.content.Context
import android.content.Intent
import android.database.sqlite.SQLiteDatabase
import android.net.Uri
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import java.io.File

/** Supplies the widget's rows. Android asks for them on its own thread. */
class UpNextWidgetService : RemoteViewsService() {
  override fun onGetViewFactory(intent: Intent): RemoteViewsFactory = UpNextRows(applicationContext)
}

private data class Row(val id: String, val title: String, val season: Int, val episode: Int, val episodeTitle: String?)

private class UpNextRows(private val context: Context) : RemoteViewsService.RemoteViewsFactory {
  private var rows: List<Row> = emptyList()

  override fun onCreate() {}
  override fun onDestroy() {}

  override fun onDataSetChanged() {
    rows = read()
  }

  /**
   * The app's own database, opened read-only. The same query the app's Up next
   * tab runs (mobile/src/lib/upNext.ts → upNextList): an entry sits at the later
   * of "you watched the one before" and "this one aired".
   *
   * Anything going wrong here (no database yet, the app mid-migration, a locked
   * file) shows an empty widget. It must never crash the launcher's host.
   */
  private fun read(): List<Row> {
    val file = File(context.filesDir, "SQLite/fandex.db")
    if (!file.exists()) return emptyList()
    return try {
      SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READONLY).use { db ->
        db.rawQuery(
          """
          SELECT u.media_item_id, c.title, u.season, u.episode, u.title
            FROM up_next u JOIN catalog c ON c.id = u.media_item_id
           WHERE u.season IS NOT NULL
             AND u.media_item_id NOT IN (SELECT media_item_id FROM hidden_item)
           ORDER BY MAX(COALESCE(u.last_watched_at, 0), COALESCE(u.aired_at, 0)) DESC, c.title
           LIMIT 12
          """.trimIndent(),
          null,
        ).use { cursor ->
          val out = ArrayList<Row>()
          while (cursor.moveToNext()) {
            out.add(Row(cursor.getString(0), cursor.getString(1), cursor.getInt(2), cursor.getInt(3), cursor.getString(4)))
          }
          out
        }
      }
    } catch (e: Exception) {
      emptyList()
    }
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
    val episode = "S${row.season} E${row.episode}" + (row.episodeTitle?.takeIf { it.isNotBlank() }?.let { " · $it" } ?: "")
    views.setTextViewText(R.id.up_next_episode, episode)
    // Two tap targets, two outcomes: the text opens the show, the tick marks the episode.
    views.setOnClickFillInIntent(R.id.up_next_open, Intent().setData(Uri.parse("fandex://item/${row.id}")))
    views.setOnClickFillInIntent(
      R.id.up_next_tick,
      Intent().setData(Uri.parse("fandex://tick/${row.id}/${row.season}/${row.episode}")),
    )
    return views
  }
}
