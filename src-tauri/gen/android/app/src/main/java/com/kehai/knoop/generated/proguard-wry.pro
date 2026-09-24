# THIS FILE IS AUTO-GENERATED. DO NOT MODIFY!!

# Copyright 2020-2023 Tauri Programme within The Commons Conservancy
# SPDX-License-Identifier: Apache-2.0
# SPDX-License-Identifier: MIT

-keep class com.kehai.knoop.* {
  native <methods>;
}

-keep class com.kehai.knoop.WryActivity {
  public <init>(...);

  void setWebView(com.kehai.knoop.RustWebView);
  java.lang.Class getAppClass(...);
  int getId();
  java.lang.String getVersion();
  int startActivity(...);
}

-keep class com.kehai.knoop.Ipc {
  public <init>(...);

  @android.webkit.JavascriptInterface public <methods>;
}

-keep class com.kehai.knoop.RustWebView {
  public <init>(...);

  void loadUrlMainThread(...);
  void loadHTMLMainThread(...);
  void evalScript(...);
}

-keep class com.kehai.knoop.RustWebChromeClient,com.kehai.knoop.RustWebViewClient {
  public <init>(...);
}
