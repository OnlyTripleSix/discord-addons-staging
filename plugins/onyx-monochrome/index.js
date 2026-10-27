(() => {
  "use strict";

  const V = globalThis.vendetta;
  const B = globalThis.bunny;
  if (!V?.metro?.common || !V?.patcher) return {};

  const { React, ReactNative: RN } = V.metro.common;
  const { instead, after } = V.patcher;
  const VERSION = "1.4.0-shiggy";
  const RUNTIME_KEY = "__itsTripleSixOnyxMonochromeRuntime";

  try { globalThis[RUNTIME_KEY]?.cleanup?.(); } catch {}

  const tokenRef =
    B?.metro?.findByProps?.("SemanticColor") ??
    V.metro?.findByProps?.("SemanticColor");

  const ThemeStore =
    B?.metro?.findByStoreName?.("ThemeStore") ??
    B?.metro?.findByStoreNameLazy?.("ThemeStore") ??
    V.metro?.findByStoreName?.("ThemeStore");

  const AppearanceManager =
    B?.metro?.findByProps?.("updateTheme") ??
    B?.metro?.findByPropsLazy?.("updateTheme") ??
    V.metro?.findByProps?.("updateTheme");

  const WHITE_SEMANTIC = new Set([
    "TEXT_STRONG","TEXT_DEFAULT","TEXT_NORMAL","TEXT_PRIMARY","TEXT_LINK","TEXT_BRAND",
    "HEADER_PRIMARY","INTERACTIVE_NORMAL","INTERACTIVE_HOVER","INTERACTIVE_ACTIVE",
    "INTERACTIVE_TEXT_DEFAULT","INTERACTIVE_TEXT_ACTIVE","INTERACTIVE_ICON_DEFAULT",
    "INTERACTIVE_ICON_HOVER","INTERACTIVE_ICON_ACTIVE","CHANNEL_ICON",
    "REDESIGN_CHANNEL_NAME_TEXT","MOBILE_HEADER_ICON_DEFAULT","MOBILE_HEADER_ICON_ACTIVE",
    "MOBILE_TEXT_HEADING_PRIMARY","CONTROL_BRAND_FOREGROUND","CONTROL_BRAND_FOREGROUND_NEW",
    "CONTROL_PRIMARY_TEXT_DEFAULT","CONTROL_SECONDARY_TEXT_DEFAULT",
    "CONTROL_OVERLAY_PRIMARY_TEXT_DEFAULT","CONTROL_OVERLAY_SECONDARY_TEXT_DEFAULT",
    "CONTROL_EXPRESSIVE_TEXT_DEFAULT","CONTROL_ICON_ONLY_ICON_DEFAULT",
    "CONTROL_ICON_ONLY_ICON_ACTIVE","BUTTON_FILLED_BRAND_TEXT","BUTTON_OUTLINE_BRAND_TEXT",
    "BUTTON_OUTLINE_PRIMARY_TEXT","CHAT_INPUT_ACTION_BUTTON_ICON_DEFAULT_TINT",
    "CHAT_INPUT_ACTION_ICON_ACTIVE_TINT","CHAT_INPUT_ICON_DEFAULT_TINT",
    "CHAT_INPUT_SEND_BUTTON_ICON_ACTIVE_TINT","CHECKBOX_ICON_ACTIVE","MENTION_FOREGROUND",
    "STATUS_BRAND","REDESIGN_BUTTON_PRIMARY_TEXT","REDESIGN_BUTTON_PRIMARY_ALT_TEXT",
    "TAB_BAR_ITEM_ACTIVE","TAB_BAR_ITEM_SELECTED","TAB_BAR_ITEM_ACTIVE_ICON",
    "TAB_BAR_ITEM_ACTIVE_TEXT","TAB_BAR_ITEM_SELECTED_ICON","TAB_BAR_ITEM_SELECTED_TEXT",
    "TAB_BAR_INDICATOR"
  ]);

  const GRAY_SEMANTIC = new Set([
    "HEADER_SECONDARY","TEXT_SECONDARY","TEXT_MUTED","TEXT_SUBTLE",
    "TEXT_LOW_CONTRAST","CHANNELS_DEFAULT","INTERACTIVE_MUTED",
    "REDESIGN_CHANNEL_CATEGORY_NAME_TEXT"
  ]);

  const BLACK_SEMANTIC = new Set([
    "BACKGROUND_BRAND","BACKGROUND_ACCENT",
    "BUTTON_FILLED_BRAND_BACKGROUND","BUTTON_FILLED_BRAND_BACKGROUND_HOVER",
    "BUTTON_FILLED_BRAND_BACKGROUND_ACTIVE",
    "CONTROL_PRIMARY_BACKGROUND_DEFAULT","CONTROL_PRIMARY_BACKGROUND_ACTIVE",
    "CONTROL_EXPRESSIVE_BACKGROUND_DEFAULT","CONTROL_EXPRESSIVE_BACKGROUND_ACTIVE",
    "CHAT_INPUT_SEND_BUTTON_ACTIVE_BACKGROUND",
    "CHECKBOX_BACKGROUND_SELECTED_DEFAULT","RADIO_BACKGROUND_SELECTED_DEFAULT",
    "SWITCH_BACKGROUND_SELECTED_DEFAULT","REDESIGN_BUTTON_PRIMARY_BACKGROUND",
    "REDESIGN_BUTTON_PRIMARY_PRESSED_BACKGROUND","REDESIGN_BUTTON_PRIMARY_ALT_BACKGROUND"
  ]);

  const ALPHA_WHITE = new Map([
    ["MENTION_BACKGROUND", 0x1a],
    ["BACKGROUND_MENTIONED", 0x14],
    ["BACKGROUND_MENTIONED_HOVER", 0x1f]
  ]);

  const WHITE_RAW = new Set([
    "BRAND_100","BRAND_130","BRAND_160","BRAND_200","BRAND_230","BRAND_260",
    "BRAND_300","BRAND_330","BRAND_345","BRAND_360","BRAND_400","BRAND_430","BRAND_460",
    "BLURPLE_100","BLURPLE_200","BLURPLE_300","BLURPLE_360","BLURPLE_400","BLURPLE_430","BLURPLE_460"
  ]);

  const BLACK_RAW = new Set([
    "BRAND_500","BRAND_530","BRAND_560","BRAND_600","BRAND_630","BRAND_660","BRAND_700","BRAND_730",
    "BLURPLE_500","BLURPLE_530","BLURPLE_560","BLURPLE_600","BLURPLE_630","BLURPLE_660","BLURPLE_700"
  ]);

  const runtime = {
    unpatches: [],
    rawDescriptors: new Map(),
    resolveHits: 0,
    rawHits: 0,
    themeHook: false,
    forcedRefreshes: 0,
    lastTheme: "unknown",
    cleanup() {
      for (const unpatch of runtime.unpatches.splice(0)) {
        try { unpatch?.(); } catch {}
      }

      const raw = tokenRef?.RawColor;
      if (raw) {
        for (const [key, desc] of runtime.rawDescriptors) {
          try { Object.defineProperty(raw, key, desc); } catch {}
        }
      }
      runtime.rawDescriptors.clear();
    }
  };
  globalThis[RUNTIME_KEY] = runtime;

  function currentTheme() {
    try {
      const t = ThemeStore?.theme;
      return typeof t === "string" && t ? t : "unknown";
    } catch {
      return "unknown";
    }
  }

  function extractSemanticName(colorObj) {
    try {
      const symbols = Object.getOwnPropertySymbols(colorObj ?? {});
      const sym = symbols[0];
      return sym ? colorObj[sym] : null;
    } catch {
      return null;
    }
  }

  function installRawGuards() {
    const raw = tokenRef?.RawColor;
    if (!raw) return;

    for (const key of [...WHITE_RAW, ...BLACK_RAW]) {
      if (!(key in raw)) continue;
      const desc = Object.getOwnPropertyDescriptor(raw, key);
      if (!desc || !desc.configurable) continue;
      runtime.rawDescriptors.set(key, desc);

      Object.defineProperty(raw, key, {
        configurable: true,
        enumerable: desc.enumerable ?? true,
        get() {
          runtime.rawHits += 1;
          return WHITE_RAW.has(key) ? "#FFFFFF" : "#000000";
        }
      });
    }
  }

  function installResolverGuard() {
    const resolver =
      tokenRef?.default?.meta ??
      tokenRef?.default?.internal ??
      tokenRef?.default;

    if (!resolver || typeof resolver.resolveSemanticColor !== "function") return false;

    runtime.unpatches.push(
      instead("resolveSemanticColor", resolver, (args, orig) => {
        const name = extractSemanticName(args?.[1]);
        if (!name) return orig(...args);

        runtime.resolveHits += 1;

        if (WHITE_SEMANTIC.has(name)) return "#FFFFFF";
        if (GRAY_SEMANTIC.has(name)) return "#A0A0A0";
        if (BLACK_SEMANTIC.has(name)) return "#000000";

        const alpha = ALPHA_WHITE.get(name);
        if (alpha != null) {
          return `#FFFFFF${alpha.toString(16).padStart(2, "0").toUpperCase()}`;
        }

        return orig(...args);
      })
    );

    return true;
  }

  function forceRealRefresh() {
    const theme = currentTheme();
    runtime.lastTheme = theme;
    if (!AppearanceManager?.updateTheme || theme === "unknown") return;

    // updateTheme(sameTheme) is often a no-op. Briefly switch to a different
    // native dark palette, then switch straight back so Discord rebuilds cached styles.
    const temp = theme === "darker" ? "dark" : "darker";

    try { AppearanceManager.setShouldSyncAppearanceSettings?.(false); } catch {}
    try {
      AppearanceManager.updateTheme(temp);
      runtime.forcedRefreshes += 1;
      setTimeout(() => {
        try {
          AppearanceManager.setShouldSyncAppearanceSettings?.(false);
          AppearanceManager.updateTheme(theme);
          runtime.forcedRefreshes += 1;
        } catch {}
      }, 60);
    } catch {}
  }

  function install() {
    installRawGuards();
    const resolverArmed = installResolverGuard();

    try {
      if (AppearanceManager?.updateTheme) {
        runtime.unpatches.push(
          after("updateTheme", AppearanceManager, () => {
            runtime.lastTheme = currentTheme();
          })
        );
        runtime.themeHook = true;
      }
    } catch {}

    setTimeout(forceRealRefresh, 250);
    setTimeout(forceRealRefresh, 1500);
    setTimeout(forceRealRefresh, 5000);

    runtime.resolverArmed = resolverArmed;
  }

  function Settings() {
    return React.createElement(
      RN.ScrollView,
      { contentContainerStyle: { padding: 16, paddingBottom: 36 } },
      React.createElement(
        RN.Text,
        { style: { color: "#FFFFFF", fontSize: 20, fontWeight: "700", marginBottom: 8 } },
        "Onyx Monochrome"
      ),
      React.createElement(
        RN.Text,
        { style: { color: "#B5BAC1", fontSize: 13, lineHeight: 19, marginBottom: 14 } },
        "Keeps Discord's native AMOLED base and intercepts Discord's live color resolver so brand/blurple accents resolve as monochrome instead of relying on one-time palette mutations."
      ),
      React.createElement(
        RN.Text,
        { style: { color: "#B5BAC1", fontSize: 12, marginBottom: 12 } },
        `Active native theme: ${currentTheme()}`
      ),
      React.createElement(
        RN.Pressable,
        {
          onPress: forceRealRefresh,
          style: {
            backgroundColor: "#000000",
            borderWidth: 1,
            borderColor: "#FFFFFF66",
            borderRadius: 8,
            paddingVertical: 12,
            paddingHorizontal: 14,
            alignItems: "center"
          }
        },
        React.createElement(
          RN.Text,
          { style: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" } },
          "Force refresh"
        )
      ),
      React.createElement(
        RN.Text,
        { style: { color: "#80848E", fontSize: 11, lineHeight: 16, marginTop: 14 } },
        `v${VERSION} • resolver:${runtime.resolverArmed ? "armed" : "missing"} • raw:${runtime.rawDescriptors.size} • resolveHits:${runtime.resolveHits} • rawHits:${runtime.rawHits} • refreshes:${runtime.forcedRefreshes} • hook:${runtime.themeHook ? "armed" : "missing"}`
      )
    );
  }

  return {
    onLoad() {
      install();
    },
    onUnload() {
      runtime.cleanup();
      if (globalThis[RUNTIME_KEY] === runtime) {
        try { delete globalThis[RUNTIME_KEY]; } catch {}
      }
    },
    settings: Settings
  };
})();