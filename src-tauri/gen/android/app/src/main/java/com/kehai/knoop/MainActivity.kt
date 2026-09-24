package com.kehai.knoop

import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  // Let Wry route Android back gestures/buttons through WebView history first.
  // The frontend uses history.pushState for every in-app page, so back now
  // returns to the previous app page instead of immediately closing the app.
  override val handleBackNavigation: Boolean = true

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }
}
