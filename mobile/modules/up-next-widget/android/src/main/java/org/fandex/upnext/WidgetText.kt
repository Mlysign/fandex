package org.fandex.upnext

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import android.os.Build
import android.text.TextPaint
import android.text.TextUtils
import android.util.TypedValue
import kotlin.math.ceil

/**
 * Text for the widget, as a picture.
 *
 * A widget is drawn by the launcher, in the launcher's process, and a launcher
 * does not load another app's font files: `android:fontFamily="@font/..."` on a
 * TextView compiles, installs, and is drawn in the system font (seen on a
 * Pixel 8, 2026-10-10). The app's look is its serif, so the text is drawn here,
 * in this process, with the app's own font files, and handed over as a bitmap.
 * What a screen reader says is set next to it as the content description.
 */
object WidgetText {
  private val fonts = HashMap<Int, Typeface>()

  private fun typeface(context: Context, font: Int): Typeface = synchronized(fonts) {
    fonts.getOrPut(font) {
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.resources.getFont(font) else Typeface.DEFAULT
      } catch (e: Exception) {
        Typeface.DEFAULT
      }
    }
  }

  /** One line, cut with an ellipsis at `maxWidthDp`. */
  fun line(context: Context, value: String, font: Int, sizeSp: Float, color: Int, maxWidthDp: Float): Bitmap {
    val dm = context.resources.displayMetrics
    val paint = TextPaint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
      typeface = typeface(context, font)
      textSize = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, sizeSp, dm)
      this.color = color
    }
    val max = (maxWidthDp * dm.density).coerceAtLeast(dm.density * 24)
    val shown = TextUtils.ellipsize(value, paint, max, TextUtils.TruncateAt.END).toString()
    val metrics = paint.fontMetricsInt
    val width = ceil(paint.measureText(shown)).toInt().coerceAtLeast(1)
    val height = (metrics.descent - metrics.ascent).coerceAtLeast(1)
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    bitmap.density = dm.densityDpi
    Canvas(bitmap).drawText(shown, 0f, -metrics.ascent.toFloat(), paint)
    return bitmap
  }

  const val PRIMARY = 0xFFEDE7DC.toInt()
  const val SECONDARY = 0xFF9A8F80.toInt()
  const val ACCENT = 0xFFC8A24B.toInt()
}
