package ai.eliza.plugins.tesseract

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import androidx.test.platform.app.InstrumentationRegistry
import com.googlecode.tesseract.android.TessBaseAPI
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * On-device proof (#9105) that the vendored Tesseract4Android engine actually
 * recognizes text on real hardware (run on the connected Pixel via
 * `connectedDebugAndroidTest`). Draws known text onto a bitmap, OCRs it, and
 * asserts the recognized words + boxes — no Capacitor, no inference toolchain,
 * just the engine.
 */
class TesseractInstrumentedTest {
  private fun dataPath(): String {
    // The library's bundled assets/tessdata ship in the test APK; copy the
    // traineddata into a real filesystem dir TessBaseAPI.init can read.
    val ctx = InstrumentationRegistry.getInstrumentation().context
    val dest = File(ctx.filesDir, "tessdata")
    dest.mkdirs()
    val out = File(dest, "eng.traineddata")
    if (!out.exists() || out.length() == 0L) {
      ctx.assets.open("tessdata/eng.traineddata").use { input ->
        out.outputStream().use { input.copyTo(it) }
      }
    }
    return ctx.filesDir.absolutePath
  }

  private fun textBitmap(text: String): Bitmap {
    val bmp = Bitmap.createBitmap(640, 160, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bmp)
    canvas.drawColor(Color.WHITE)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.BLACK
      textSize = 64f
      typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL)
    }
    canvas.drawText(text, 24f, 100f, paint)
    return bmp
  }

  @Test
  fun recognizesRenderedText() {
    val tess = TessBaseAPI()
    val ok = tess.init(dataPath(), "eng")
    assertTrue("TessBaseAPI.init(eng) must succeed", ok)
    try {
      tess.pageSegMode = TessBaseAPI.PageSegMode.PSM_SINGLE_LINE
      val bmp = textBitmap("Eliza OCR")
      tess.setImage(bmp)
      val text = tess.getUTF8Text().trim()
      assertTrue(
        "recognized text '$text' should contain 'Eliza'",
        text.contains("Eliza", ignoreCase = true),
      )
      assertTrue(
        "recognized text '$text' should contain 'OCR'",
        text.contains("OCR", ignoreCase = true),
      )

      // Word boxes must come back from the result iterator.
      val it = tess.resultIterator
      it.begin()
      var words = 0
      val level = TessBaseAPI.PageIteratorLevel.RIL_WORD
      do {
        val w = it.getUTF8Text(level)
        if (w != null && w.trim().isNotEmpty()) {
          val box = it.getBoundingRect(level)
          assertTrue("word box must be non-empty", box.width() > 0 && box.height() > 0)
          words += 1
        }
      } while (it.next(level))
      it.delete()
      assertEquals("two words expected", 2, words)
    } finally {
      tess.recycle()
    }
  }
}
