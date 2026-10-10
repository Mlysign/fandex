package org.fandex.upnext

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** One row of the widget. `busy` is a tick in flight: shown, not tappable. */
data class UpNextRow(
  val id: String,
  val title: String,
  val season: Int,
  val episode: Int,
  val episodeTitle: String?,
  /** The show's poster, as the catalog stores it. Null when it has none. */
  val posterUrl: String?,
  val busy: Boolean,
)

/**
 * What the widget shows, as a small file the app writes.
 *
 * Not the app's SQLite database, on purpose. The app opens that with the SQLite
 * build expo-sqlite ships, and Android's own SQLite is a second copy of the
 * library in the same process: two copies on one file do not see each other's
 * locks, which is a documented way to corrupt a database. So the app hands the
 * widget its rows (`UpNextWidget.setRows`), and nothing here touches SQLite.
 */
object UpNextStore {
  private fun file(context: Context) = File(context.filesDir, "up_next_widget.json")

  @Synchronized
  fun write(context: Context, json: String) {
    val tmp = File(context.filesDir, "up_next_widget.json.tmp")
    tmp.writeText(json)
    // A rename, so a reader never sees half a file.
    if (!tmp.renameTo(file(context))) file(context).writeText(json)
  }

  @Synchronized
  fun read(context: Context): List<UpNextRow> {
    return try {
      val f = file(context)
      if (!f.exists()) return emptyList()
      val list = JSONArray(f.readText())
      (0 until list.length()).mapNotNull { i ->
        val o = list.optJSONObject(i) ?: return@mapNotNull null
        val id = o.optString("id")
        val title = o.optString("title")
        val season = o.optInt("season", -1)
        val episode = o.optInt("episode", -1)
        if (id.isEmpty() || title.isEmpty() || season < 1 || episode < 1) return@mapNotNull null
        val text = { key: String -> o.optString(key).takeIf { it.isNotBlank() && it != "null" } }
        UpNextRow(id, title, season, episode, text("episodeTitle"), text("posterUrl"), o.optBoolean("busy", false))
      }
    } catch (e: Exception) {
      // A widget that shows nothing is the worst this may do. It runs inside the launcher's host.
      emptyList()
    }
  }

  /** Flag one show's row as a tick in flight, or clear every flag. */
  @Synchronized
  fun setBusy(context: Context, id: String?, busy: Boolean) {
    val rows = read(context)
    val out = JSONArray()
    for (r in rows) {
      out.put(
        JSONObject()
          .put("id", r.id).put("title", r.title).put("season", r.season).put("episode", r.episode)
          .put("episodeTitle", r.episodeTitle ?: JSONObject.NULL)
          .put("posterUrl", r.posterUrl ?: JSONObject.NULL)
          .put("busy", if (id == null) false else if (r.id == id) busy else r.busy),
      )
    }
    write(context, out.toString())
  }
}
