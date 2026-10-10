package com.kehai.knoop

import android.app.Activity
import android.os.Build
import android.os.Process
import android.os.SystemClock
import android.util.Log
import android.webkit.WebView
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

// Firmware-specific, optional bridge. No global mode/property setter is exposed.
@TauriPlugin
class EinkPlugin(private val activity: Activity) : Plugin(activity) {
  private var webView: WebView? = null
  private var lastRequest = -5000L

  override fun load(webView: WebView) { this.webView = webView }

  private fun manager(): Any {
    check(Build.MANUFACTURER.equals("HANVON", ignoreCase = true) && Build.MODEL == "PA6" &&
      Build.VERSION.SDK_INT == 30 && Build.VERSION.INCREMENTAL == "eng.hanvon.20250524.095811")
    val service = activity.getSystemService("eink") ?: error("No eink service")
    check(service.javaClass.name == "android.os.EinkManager")
    service.javaClass.getMethod("sendOneFullFrame")
    return service
  }

  @Command
  fun status(invoke: Invoke) {
    try {
      val service = manager()
      val mode = service.javaClass.getMethod("getMode").invoke(service) as String
      Log.i("KnoopEink", "available uid=${Process.myUid()} model=${Build.MODEL} mode=$mode")
      invoke.resolve(JSObject().apply { put("supported", true); put("message", "本设备可请求全屏刷新") })
    } catch (_: Exception) {
      invoke.resolve(JSObject().apply { put("supported", false); put("message", "当前设备或固件没有已验证的全屏刷新接口") })
    }
  }

  @Command
  fun refresh(invoke: Invoke) {
    activity.runOnUiThread {
      try {
        check(activity.hasWindowFocus())
        check(SystemClock.elapsedRealtime() - lastRequest >= 2000)
        val service = manager()
        val modeBefore = service.javaClass.getMethod("getMode").invoke(service)
        service.javaClass.getMethod("sendOneFullFrame").invoke(service)
        lastRequest = SystemClock.elapsedRealtime()
        // A new frame lets the compositor consume the vendor's one-frame request.
        // Invalidation itself is not presented as an e-ink hardware refresh.
        webView?.postInvalidateOnAnimation()
        val modeAfter = service.javaClass.getMethod("getMode").invoke(service)
        Log.i("KnoopEink", "full-frame request sent uid=${Process.myUid()} modeBefore=$modeBefore modeAfter=$modeAfter")
        invoke.resolve(JSObject().apply { put("requested", true) })
      } catch (error: Exception) {
        Log.w("KnoopEink", "full-frame request failed: ${error.javaClass.simpleName}")
        invoke.reject("刷新请求失败，请稍后重试或使用设备的系统刷新功能")
      }
    }
  }
}
