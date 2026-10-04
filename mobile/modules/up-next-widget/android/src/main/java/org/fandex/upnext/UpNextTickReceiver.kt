package org.fandex.upnext

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener

/**
 * Marks an episode watched from the widget, with the app closed.
 *
 * It does none of the marking itself. It runs the app's own JavaScript, with no
 * screen, as a headless task (`FandexUpNextTick`, registered in
 * mobile/src/headless.ts), so there is one implementation of "mark watched":
 * the Trakt token and its refresh, the write to the Worker, the row on the
 * device and the widget's rows are all the code the app runs when the tick is
 * tapped inside it.
 *
 * Why a receiver, and not a service: an app in the background may not start a
 * service, and a cached app is frozen within seconds. A receiver that has called
 * goAsync() is neither background-restricted nor frozen until it calls
 * finish(), which is the window the task needs.
 */
class UpNextTickReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val id = intent.getStringExtra(WidgetTapActivity.EXTRA_ID) ?: return
    val season = intent.getIntExtra(WidgetTapActivity.EXTRA_SEASON, -1)
    val episode = intent.getIntExtra(WidgetTapActivity.EXTRA_EPISODE, -1)
    if (season < 1 || episode < 1) return

    val app = context.applicationContext
    val pending = goAsync()
    val main = Handler(Looper.getMainLooper())
    var finished = false

    // The row says "marking" at once. The tap has an answer before the network does.
    UpNextStore.setBusy(app, id, true)
    UpNextWidgetProvider.refreshAll(app)

    val finish = Runnable {
      if (!finished) {
        finished = true
        pending.finish()
      }
    }
    // If the JavaScript never answers, give the row back its tick and let go.
    // Under the time Android allows a receiver, so this fires first.
    val giveUp = Runnable {
      if (!finished) {
        Log.w(TAG, "the tick task did not finish in time")
        UpNextStore.setBusy(app, null, false)
        UpNextWidgetProvider.refreshAll(app)
        finish.run()
      }
    }
    main.postDelayed(giveUp, GIVE_UP_MS)

    val host: ReactHost = (app as? ReactApplication)?.reactHost ?: run {
      main.removeCallbacks(giveUp)
      giveUp.run()
      return
    }

    val start = { reactContext: ReactContext ->
      val tasks = HeadlessJsTaskContext.getInstance(reactContext)
      val data = Arguments.createMap().apply {
        putString("id", id)
        putInt("season", season)
        putInt("episode", episode)
      }
      UiThreadUtil.runOnUiThread {
        var taskId = -1
        val listener = object : HeadlessJsTaskEventListener {
          override fun onHeadlessJsTaskStart(startedId: Int) {}
          override fun onHeadlessJsTaskFinish(finishedId: Int) {
            if (finishedId != taskId) return
            tasks.removeTaskEventListener(this)
            main.removeCallbacks(giveUp)
            // On success the task rewrote the rows and there is no flag left to
            // clear. It may also have died before it could (it did, once: the
            // database would not open), and a row left saying "marking" with no
            // tick can never be tapped again. So the flag is cleared HERE,
            // whatever the JavaScript did.
            UpNextStore.setBusy(app, null, false)
            UpNextWidgetProvider.refreshAll(app)
            finish.run()
          }
        }
        tasks.addTaskEventListener(listener)
        // Allowed in the foreground too: the app may be open behind the launcher.
        taskId = tasks.startTask(HeadlessJsTaskConfig(TASK, data, TASK_TIMEOUT_MS, true))
      }
    }

    val current = host.currentReactContext
    if (current != null) {
      start(current)
    } else {
      // The app is not running. Start its JavaScript without a screen.
      host.addReactInstanceEventListener(object : ReactInstanceEventListener {
        override fun onReactContextInitialized(context: ReactContext) {
          host.removeReactInstanceEventListener(this)
          start(context)
        }
      })
      main.post(Runnable { host.start() })
    }
  }

  private companion object {
    const val TAG = "FandexUpNext"
    const val TASK = "FandexUpNextTick"
    const val TASK_TIMEOUT_MS = 25_000L
    const val GIVE_UP_MS = 28_000L
  }
}
