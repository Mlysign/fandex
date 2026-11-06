package org.fandex.haptics

import android.content.Context
import android.os.Build
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Haptics as the Bubblewrap game does them (its Haptics.kt, ported): a sharp CLICK with a
 * short TICK tail. The tail is what makes a tap read as a POP rather than a bump.
 *
 * expo-haptics was tried first and is the wrong tool on Android: its "impact" is a 43 to
 * 60 ms buzz at low amplitude, which is exactly the bump this class exists to avoid.
 *
 * The trap Bubblewrap named: if ANY primitive in a composition is unsupported, the whole
 * composition silently does not play, which reads as "haptics are broken". So every
 * primitive used is checked up front, and [tier] says which path actually fires.
 *
 * The JavaScript side is mobile/src/lib/feel.ts, where every number lives.
 */
class FandexHapticsModule : Module() {
  private var vibrator: Vibrator? = null
  private var supportsComposition = false
  private var hasAmplitudeControl = false
  private var tier = "no vibrator"

  private fun setUp(context: Context) {
    val v = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      context.getSystemService(VibratorManager::class.java)?.defaultVibrator
    } else {
      @Suppress("DEPRECATION")
      context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
    }
    if (v == null || !v.hasVibrator()) return
    vibrator = v
    hasAmplitudeControl = v.hasAmplitudeControl()
    supportsComposition = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R &&
      v.areAllPrimitivesSupported(*USED_PRIMITIVES)
    tier = when {
      supportsComposition -> "composition"
      hasAmplitudeControl -> "waveform + amplitude"
      else -> "waveform, no amplitude"
    }
  }

  override fun definition() = ModuleDefinition {
    Name("FandexHaptics")

    OnCreate {
      appContext.reactContext?.let { setUp(it) }
    }

    /** Which path fires on this phone, so a dead haptic can be diagnosed instead of guessed at. */
    Function("tier") { tier }

    /**
     * One composed effect: kinds[i] is 0 for a CLICK and 1 for a TICK, scales[i] its strength
     * from 0 to 1, delays[i] the milliseconds after the one before it. One call per event,
     * never one per star: a burst of separate calls is mush, not impact.
     */
    Function("play") { kinds: List<Int>, scales: List<Double>, delays: List<Int> ->
      play(kinds, scales, delays)
    }
  }

  private fun play(kinds: List<Int>, scales: List<Double>, delays: List<Int>) {
    val v = vibrator ?: return
    val n = minOf(kinds.size, scales.size, delays.size)
    if (n == 0) return

    // Before Android 8 there are no effects at all; Fandex does not try.
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

    // The SDK test is repeated so lint can see the guard, which a stored flag hides from it.
    val effect = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && supportsComposition) {
      val c = VibrationEffect.startComposition()
      var any = false
      for (i in 0 until n) {
        val s = scales[i].toFloat().coerceIn(0f, 1f)
        if (s <= 0.001f) continue
        val primitive = if (kinds[i] == KIND_TICK) VibrationEffect.Composition.PRIMITIVE_TICK
        else VibrationEffect.Composition.PRIMITIVE_CLICK
        c.addPrimitive(primitive, s, delays[i].coerceAtLeast(0))
        any = true
      }
      if (!any) return
      c.compose()
    } else {
      // No primitives: the same rhythm as short pulses. A click is 26 ms, a tick 12.
      val timings = ArrayList<Long>()
      val amplitudes = ArrayList<Int>()
      for (i in 0 until n) {
        val s = scales[i].toFloat().coerceIn(0f, 1f)
        if (s <= 0.001f) continue
        timings.add(delays[i].coerceAtLeast(0).toLong()); amplitudes.add(0)
        timings.add(if (kinds[i] == KIND_TICK) 12L else 26L)
        amplitudes.add(if (hasAmplitudeControl) (s * 255f).toInt().coerceIn(1, 255) else VibrationEffect.DEFAULT_AMPLITUDE)
      }
      if (timings.isEmpty()) return
      VibrationEffect.createWaveform(timings.toLongArray(), amplitudes.toIntArray(), -1)
    }

    // As touch feedback, so the phone's own "touch feedback" setting turns it off.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      v.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_TOUCH))
    } else {
      v.vibrate(effect)
    }
  }

  companion object {
    private const val KIND_TICK = 1

    /** Every primitive [play] composes with must appear here, or the check is a lie. */
    private val USED_PRIMITIVES = intArrayOf(
      VibrationEffect.Composition.PRIMITIVE_CLICK,
      VibrationEffect.Composition.PRIMITIVE_TICK,
    )
  }
}
