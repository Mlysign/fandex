package org.fandex.upnext

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle

/**
 * Where every tap on the widget lands. It draws nothing and is gone before it
 * could: the theme is NoDisplay and it finishes inside onCreate.
 *
 * A list in a widget has ONE tap template, so one component has to take both
 * kinds of tap and tell them apart:
 *
 *   open   start the app on that show's page
 *   tick   hand the episode to UpNextTickReceiver and stop. The app is NOT
 *          opened: the marking runs in the background and the widget redraws.
 */
class WidgetTapActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    // What was tapped arrives as the intent's address: widget://open/{id} or
    // widget://tick/{id}/{season}/{episode}.
    val uri = intent.data
    val parts = uri?.pathSegments ?: emptyList()
    val id = parts.getOrNull(0)
    when (uri?.host) {
      ACTION_OPEN -> if (id != null) {
        startActivity(
          Intent(Intent.ACTION_VIEW, Uri.parse("fandex://item/$id"))
            .setPackage(packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
      }
      ACTION_TICK -> {
        val season = parts.getOrNull(1)?.toIntOrNull() ?: -1
        val episode = parts.getOrNull(2)?.toIntOrNull() ?: -1
        if (id != null && season > 0 && episode > 0) {
          sendBroadcast(
            Intent(this, UpNextTickReceiver::class.java)
              .putExtra(EXTRA_ID, id).putExtra(EXTRA_SEASON, season).putExtra(EXTRA_EPISODE, episode),
          )
        }
      }
    }
    finish()
  }

  companion object {
    const val EXTRA_ID = "id"
    const val EXTRA_SEASON = "season"
    const val EXTRA_EPISODE = "episode"
    const val ACTION_OPEN = "open"
    const val ACTION_TICK = "tick"

    fun openUri(id: String): Uri = Uri.parse("widget://$ACTION_OPEN/$id")
    fun tickUri(id: String, season: Int, episode: Int): Uri = Uri.parse("widget://$ACTION_TICK/$id/$season/$episode")
  }
}
