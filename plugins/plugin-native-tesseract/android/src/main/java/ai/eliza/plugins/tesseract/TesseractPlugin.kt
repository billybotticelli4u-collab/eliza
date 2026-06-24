package ai.eliza.plugins.tesseract

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Rect
import android.util.Base64
import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.googlecode.tesseract.android.TessBaseAPI
import java.io.File

/**
 * On-device Tesseract OCR (#9105) via Tesseract4Android (native JNI tesseract 5).
 *
 * `recognize` decodes a base64 image, runs tesseract, and returns per-word text
 * + pixel boxes + confidence (+ block/par/line indices for line grouping). The
 * traineddata ships in `assets/tessdata/<lang>.traineddata` and is copied once
 * into `filesDir/tessdata/` (TessBaseAPI.init needs a real filesystem dataPath,
 * not an assets path).
 *
 * No `execve` of a CLI binary — this is a loaded .so, so it is unaffected by
 * Android's noexec data dirs (the reason the desktop "ship a binary" path does
 * not translate here).
 */
@CapacitorPlugin(name = "Tesseract")
class TesseractPlugin : Plugin() {
  companion object {
    private const val TAG = "ElizaTesseract"
  }

  /** Copy bundled `tessdata` traineddata files from assets into
   * `filesDir/tessdata` once. Returns the dataPath (the PARENT of the
   * `tessdata` dir) that tesseract init expects. */
  private fun ensureTessData(): String {
    val ctx = context
    val dest = File(ctx.filesDir, "tessdata")
    if (!dest.exists()) dest.mkdirs()
    val assets = ctx.assets
    val names = try {
      assets.list("tessdata")?.filter { it.endsWith(".traineddata") } ?: emptyList()
    } catch (e: Exception) {
      emptyList()
    }
    for (name in names) {
      val out = File(dest, name)
      if (out.exists() && out.length() > 0) continue
      assets.open("tessdata/$name").use { input ->
        out.outputStream().use { output -> input.copyTo(output) }
      }
    }
    return ctx.filesDir.absolutePath
  }

  private fun availableLanguages(): List<String> {
    val dir = File(context.filesDir, "tessdata")
    val fromFiles = dir.listFiles()
      ?.filter { it.name.endsWith(".traineddata") }
      ?.map { it.name.removeSuffix(".traineddata") }
      ?: emptyList()
    if (fromFiles.isNotEmpty()) return fromFiles
    return try {
      context.assets.list("tessdata")
        ?.filter { it.endsWith(".traineddata") }
        ?.map { it.removeSuffix(".traineddata") }
        ?: emptyList()
    } catch (e: Exception) {
      emptyList()
    }
  }

  @PluginMethod
  fun isAvailable(call: PluginCall) {
    val result = JSObject()
    try {
      val dataPath = ensureTessData()
      val langs = availableLanguages()
      if (langs.isEmpty()) {
        result.put("available", false)
        result.put("reason", "no tessdata language bundled")
        call.resolve(result)
        return
      }
      val tess = TessBaseAPI()
      val ok = tess.init(dataPath, langs.first())
      val version = if (ok) tess.version else null
      tess.recycle()
      result.put("available", ok)
      if (version != null) result.put("version", version)
      result.put("languages", JSArray(langs))
      if (!ok) result.put("reason", "TessBaseAPI.init failed")
      call.resolve(result)
    } catch (e: Throwable) {
      Log.e(TAG, "isAvailable failed", e)
      result.put("available", false)
      result.put("reason", e.message ?: e.toString())
      call.resolve(result)
    }
  }

  @PluginMethod
  fun recognize(call: PluginCall) {
    val image = call.getString("image")
    if (image.isNullOrEmpty()) {
      call.reject("image (base64) is required")
      return
    }
    val lang = call.getString("lang") ?: "eng"
    val psm = call.getInt("psm") ?: TessBaseAPI.PageSegMode.PSM_SPARSE_TEXT

    var tess: TessBaseAPI? = null
    var bitmap: Bitmap? = null
    try {
      val t0 = System.currentTimeMillis()
      val bytes = Base64.decode(image, Base64.DEFAULT)
      bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        ?: throw IllegalArgumentException("could not decode image")

      val dataPath = ensureTessData()
      tess = TessBaseAPI()
      if (!tess.init(dataPath, lang)) {
        throw IllegalStateException("TessBaseAPI.init('$lang') failed")
      }
      tess.pageSegMode = psm
      tess.setImage(bitmap)
      // Triggers recognition; the result iterator is only valid afterwards.
      tess.getUTF8Text()

      val words = JSArray()
      val it = tess.resultIterator
      it.begin()
      val wordLevel = TessBaseAPI.PageIteratorLevel.RIL_WORD
      val lineLevel = TessBaseAPI.PageIteratorLevel.RIL_TEXTLINE
      val paraLevel = TessBaseAPI.PageIteratorLevel.RIL_PARA
      val blockLevel = TessBaseAPI.PageIteratorLevel.RIL_BLOCK
      var block = -1
      var par = -1
      var line = -1
      do {
        if (it.isAtBeginningOf(blockLevel)) {
          block += 1; par = -1; line = -1
        }
        if (it.isAtBeginningOf(paraLevel)) { par += 1; line = -1 }
        if (it.isAtBeginningOf(lineLevel)) line += 1
        val text = it.getUTF8Text(wordLevel) ?: continue
        if (text.trim().isEmpty()) continue
        val box: Rect = it.getBoundingRect(wordLevel)
        val w = JSObject()
        w.put("text", text)
        w.put("left", box.left)
        w.put("top", box.top)
        w.put("width", box.width())
        w.put("height", box.height())
        w.put("confidence", it.confidence(wordLevel).toDouble())
        w.put("block", if (block < 0) 0 else block)
        w.put("par", if (par < 0) 0 else par)
        w.put("line", if (line < 0) 0 else line)
        words.put(w)
      } while (it.next(wordLevel))
      it.delete()

      val result = JSObject()
      result.put("words", words)
      result.put("width", bitmap.width)
      result.put("height", bitmap.height)
      result.put("durationMs", System.currentTimeMillis() - t0)
      call.resolve(result)
    } catch (e: Throwable) {
      Log.e(TAG, "recognize failed", e)
      call.reject(e.message ?: e.toString())
    } finally {
      tess?.recycle()
      bitmap?.recycle()
    }
  }
}
