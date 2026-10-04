package org.fandex.upnext

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** What the app can ask of the widget. The JavaScript side is mobile/src/lib/widget.ts. */
class UpNextWidgetModule : Module() {
  private val context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("UpNextWidget")

    /** Re-read `up_next` in every placed widget. */
    Function("refresh") {
      UpNextWidgetProvider.refreshAll(context)
    }

    /** How many Up next widgets are on the home screen. */
    Function("placed") {
      UpNextWidgetProvider.placed(context)
    }

    /**
     * Ask the launcher to add the widget. The launcher shows its own "add to
     * home screen" sheet and the person confirms there. False when this
     * launcher cannot do that; the widget is then added from the launcher's
     * widget list by hand.
     */
    Function("requestPin") {
      val manager = AppWidgetManager.getInstance(context)
      if (!manager.isRequestPinAppWidgetSupported) return@Function false
      manager.requestPinAppWidget(ComponentName(context, UpNextWidgetProvider::class.java), null, null)
    }
  }
}
