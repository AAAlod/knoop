package com.kehai.knoop

import android.os.Bundle
import android.os.Build
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat

class MainActivity : TauriActivity() {
  // Let Wry route Android back gestures/buttons through WebView history first.
  // The frontend uses history.pushState for every in-app page, so back now
  // returns to the previous app page instead of immediately closing the app.
  override val handleBackNavigation: Boolean = true

  override fun onCreate(savedInstanceState: Bundle?) {
    // Older WebViews do not expose the status-bar inset to CSS env().
    if (Build.VERSION.SDK_INT > Build.VERSION_CODES.R) enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
      WindowCompat.setDecorFitsSystemWindows(window, true)
    }
  }
}
