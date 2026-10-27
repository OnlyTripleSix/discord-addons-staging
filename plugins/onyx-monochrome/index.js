(() => {
  "use strict";

  const V = globalThis.vendetta;
  const B = globalThis.bunny;
  if (!V?.metro?.common) return {};

  const { React, ReactNative: RN } = V.metro.common;
  const VERSION = "1.3.0-shiggy";
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

  const snapshots = new Map();
  const rawSnapshots = new Map();
  let appliedTheme = null;
  let applying = false;

  const WHITE_KEYS = [
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
    "CHAT_INPUT_SEND_BUTTON_ICON_ACTIVE_TINT","CHECKBOX_ICON_ACTIVE","MENTION_FOREGROUND"
  ];

  const GRAY_KEYS = [
    "HEADER_SECONDARY","TEXT_SECONDARY","TEXT_MUTED","TEXT_SUBTLE",
    "TEXT_LOW_CONTRAST","CHANNELS_DEFAULT","INTERACTIVE_MUTED",
    "REDESIGN_CHANNEL_CATEGORY_NAME_TEXT"
  ];

  // These are the parts native Onyx still leaves branded/colored.
  // Keep all real Onyx surface/background tokens untouched.
  const BLACK_ACCENT_SURFACES = [
    "BACKGROUND_BRAND","BACKGROUND_ACCENT",
    "BUTTON_FILLED_BRAND_BACKGROUND","BUTTON_FILLED_BRAND_BACKGROUND_HOVER",
    "BUTTON_FILLED_BRAND_BACKGROUND_ACTIVE",
    "CONTROL_PRIMARY_BACKGROUND_DEFAULT","CONTROL_PRIMARY_BACKGROUND_ACTIVE",
    "CONTROL_EXPRESSIVE_BACKGROUND_DEFAULT","CONTROL_EXPRESSIVE_BACKGROUND_ACTIVE",
    "CHAT_INPUT_SEND_BUTTON_ACTIVE_BACKGROUND",
    "CHECKBOX_BACKGROUND_SELECTED_DEFAULT","RADIO_BACKGROUND_SELECTED_DEFAULT",
    "SWITCH_BACKGROUND_SELECTED_DEFAULT"
  ];

  const WHITE_ACCENTS = [
    "BUTTON_FILLED_BRAND_TEXT","BUTTON_OUTLINE_BRAND_TEXT",
    "BUTTON_OUTLINE_PRIMARY_TEXT","CONTROL_BRAND_FOREGROUND",
    "CONTROL_BRAND_FOREGROUND_NEW","CONTROL_PRIMARY_TEXT_DEFAULT",
    "CONTROL_EXPRESSIVE_TEXT_DEFAULT","CHECKBOX_ICON_ACTIVE",
    "TEXT_LINK","TEXT_BRAND","MENTION_FOREGROUND","STATUS_BRAND"
  ];

  const WHITE_BORDERS = [
    "CONTROL_PRIMARY_BORDER_DEFAULT","CONTROL_PRIMARY_BORDER_ACTIVE",
    "BUTTON_OUTLINE_BRAND_BORDER_ACTIVE","CHECKBOX_BORDER_DEFAULT",
    "CHECKBOX_BORDER_SELECTED_DEFAULT","RADIO_BORDER_DEFAULT",
    "SWITCH_BORDER_DEFAULT","SWITCH_BORDER_SELECTED_DEFAULT"
  ];

  function currentThemeKey() {
    try {
      const value = ThemeStore?.theme;
      return typeof value === "string" && value ? value : null;
    } catch {
      return null;
    }
  }

  function cloneDef(def) {
    if (def == null || typeof def !== "object") return def;
    return { ...def };
  }

  function makeDef(raw, opacity = 1) {
    return { raw, opacity };
  }

  function setSemantic(key, theme, def) {
    const entry = tokenRef?.SemanticColor?.[key];
    if (!entry || !theme) return false;

    const snapKey = `${theme}::${key}`;
    if (!snapshots.has(snapKey)) {
      snapshots.set(snapKey, cloneDef(entry[theme]));
    }

    entry[theme] = def;
    return true;
  }

  function setRaw(key, value) {
    const raw = tokenRef?.RawColor;
    if (!raw || !(key in raw)) return false;
    if (!rawSnapshots.has(key)) rawSnapshots.set(key, raw[key]);
    try {
      raw[key] = value;
      return true;
    } catch {
      try {
        Object.defineProperty(raw, key, {
          configurable: true,
          enumerable: true,
          writable: true,
          value
        });
        return true;
      } catch {
        return false;
      }
    }
  }

  function refresh(theme) {
    try { AppearanceManager?.setShouldSyncAppearanceSettings?.(false); } catch {}
    try { AppearanceManager?.updateTheme?.(theme); } catch {}
  }

  function restore(refreshAfter = true) {
    if (!tokenRef?.SemanticColor) return;

    for (const [snapKey, original] of snapshots) {
      const split = snapKey.indexOf("::");
      const theme = snapKey.slice(0, split);
      const key = snapKey.slice(split + 2);
      const entry = tokenRef.SemanticColor[key];
      if (!entry) continue;

      if (original === undefined) {
        try { delete entry[theme]; } catch {}
      } else {
        entry[theme] = original;
      }
    }

    for (const [key, original] of rawSnapshots) {
      try {
        tokenRef.RawColor[key] = original;
      } catch {
        try {
          Object.defineProperty(tokenRef.RawColor, key, {
            configurable: true,
            enumerable: true,
            writable: true,
            value: original
          });
        } catch {}
      }
    }

    const theme = appliedTheme;
    snapshots.clear();
    rawSnapshots.clear();
    appliedTheme = null;
    if (theme && refreshAfter) refresh(theme);
  }

  function looksApplied() {
    const theme = currentThemeKey();
    if (!theme || theme.startsWith("bn-theme-") || !tokenRef?.SemanticColor) return false;

    try {
      const brand = tokenRef.RawColor?.BRAND_500;
      const textBrand = tokenRef.SemanticColor?.TEXT_BRAND?.[theme];
      const primary = tokenRef.SemanticColor?.REDESIGN_BUTTON_PRIMARY_BACKGROUND?.[theme];

      const rawOkay = brand === "#000000";
      const textOkay = textBrand?.raw === "WHITE_500";
      const primaryOkay = !primary || primary?.raw === "BLACK_500";
      return rawOkay && textOkay && primaryOkay;
    } catch {
      return false;
    }
  }

  function apply(reason = "manual", force = true) {
    if (applying) return false;
    if (!force && looksApplied()) return true;

    applying = true;
    restore(false);

    const theme = currentThemeKey();
    if (!theme || theme.startsWith("bn-theme-") || !tokenRef?.SemanticColor) {
      applying = false;
      return false;
    }

    appliedTheme = theme;

    let changed = 0;
    for (const key of WHITE_KEYS) changed += setSemantic(key, theme, makeDef("WHITE_500", 1)) ? 1 : 0;
    for (const key of GRAY_KEYS) changed += setSemantic(key, theme, makeDef("PRIMARY_360", 1)) ? 1 : 0;
    for (const key of BLACK_ACCENT_SURFACES) changed += setSemantic(key, theme, makeDef("BLACK_500", 1)) ? 1 : 0;
    for (const key of WHITE_ACCENTS) changed += setSemantic(key, theme, makeDef("WHITE_500", 1)) ? 1 : 0;
    for (const key of WHITE_BORDERS) changed += setSemantic(key, theme, makeDef("WHITE_500", 0.45)) ? 1 : 0;

    // Current Discord still reads some brand colors directly from RawColor.
    // Only neutralize the brand/blurple ramps; never touch Onyx neutral/background ramps.
    const whiteBrand = [
      "BRAND_100","BRAND_130","BRAND_160","BRAND_200","BRAND_230","BRAND_260",
      "BRAND_300","BRAND_330","BRAND_345","BRAND_360","BRAND_400","BRAND_430","BRAND_460",
      "BLURPLE_100","BLURPLE_200","BLURPLE_300","BLURPLE_360","BLURPLE_400","BLURPLE_430","BLURPLE_460"
    ];
    const blackBrand = [
      "BRAND_500","BRAND_530","BRAND_560","BRAND_600","BRAND_630","BRAND_660","BRAND_700","BRAND_730",
      "BLURPLE_500","BLURPLE_530","BLURPLE_560","BLURPLE_600","BLURPLE_630","BLURPLE_660","BLURPLE_700"
    ];
    for (const key of whiteBrand) changed += setRaw(key, "#FFFFFF") ? 1 : 0;
    for (const key of blackBrand) changed += setRaw(key, "#000000") ? 1 : 0;

    // Explicit current mobile tokens used by primary buttons/tabs.
    for (const key of [
      "REDESIGN_BUTTON_PRIMARY_BACKGROUND",
      "REDESIGN_BUTTON_PRIMARY_PRESSED_BACKGROUND",
      "REDESIGN_BUTTON_PRIMARY_ALT_BACKGROUND",
      "BUTTON_FILLED_BRAND_BACKGROUND",
      "BUTTON_FILLED_BRAND_BACKGROUND_HOVER",
      "BUTTON_FILLED_BRAND_BACKGROUND_ACTIVE"
    ]) changed += setSemantic(key, theme, makeDef("BLACK_500", 1)) ? 1 : 0;

    for (const key of [
      "REDESIGN_BUTTON_PRIMARY_TEXT",
      "REDESIGN_BUTTON_PRIMARY_ALT_TEXT",
      "TAB_BAR_ITEM_ACTIVE",
      "TAB_BAR_ITEM_SELECTED",
      "TAB_BAR_ITEM_ACTIVE_ICON",
      "TAB_BAR_ITEM_ACTIVE_TEXT",
      "TAB_BAR_ITEM_SELECTED_ICON",
      "TAB_BAR_ITEM_SELECTED_TEXT",
      "TAB_BAR_INDICATOR",
      "TEXT_LINK",
      "TEXT_BRAND"
    ]) changed += setSemantic(key, theme, makeDef("WHITE_500", 1)) ? 1 : 0;

    // Keep mentions/highlights visible without introducing a colored surface.
    changed += setSemantic("MENTION_BACKGROUND", theme, makeDef("WHITE_500", 0.10)) ? 1 : 0;
    changed += setSemantic("BACKGROUND_MENTIONED", theme, makeDef("WHITE_500", 0.08)) ? 1 : 0;
    changed += setSemantic("BACKGROUND_MENTIONED_HOVER", theme, makeDef("WHITE_500", 0.12)) ? 1 : 0;

    runtime.lastChanged = changed;
    runtime.applyCount += 1;
    runtime.lastReason = reason;
    refresh(theme);
    applying = false;
    return true;
  }

  function scheduleApply(delay, reason, force = false) {
    const timer = setTimeout(() => {
      const before = looksApplied();
      const ok = apply(reason, force);
      if (ok && !before) runtime.healCount += 1;
    }, delay);
    runtime.timers.push(timer);
  }

  function installPersistence() {
    try {
      if (typeof V?.patcher?.after === "function" && AppearanceManager) {
        runtime.unpatches.push(
          V.patcher.after("updateTheme", AppearanceManager, () => {
            if (applying) return;
            scheduleApply(75, "updateTheme", false);
            scheduleApply(400, "updateTheme-late", false);
          })
        );
        runtime.themeHook = true;
      }
    } catch {}

    runtime.watchdog = setInterval(() => {
      if (!looksApplied()) {
        runtime.healCount += 1;
        apply("watchdog", true);
      }
    }, 5000);

    for (const [delay, reason] of [
      [250, "startup-250"],
      [750, "startup-750"],
      [1500, "startup-1500"],
      [3000, "startup-3000"],
      [5000, "startup-5000"],
      [10000, "startup-10000"],
      [20000, "startup-20000"]
    ]) scheduleApply(delay, reason, false);
  }

  const runtime = {
    lastChanged: 0,
    applyCount: 0,
    healCount: 0,
    lastReason: "none",
    themeHook: false,
    watchdog: null,
    timers: [],
    unpatches: [],
    cleanup() {
      for (const timer of runtime.timers.splice(0)) {
        try { clearTimeout(timer); } catch {}
      }
      if (runtime.watchdog) {
        try { clearInterval(runtime.watchdog); } catch {}
        runtime.watchdog = null;
      }
      for (const unpatch of runtime.unpatches.splice(0)) {
        try { unpatch?.(); } catch {}
      }
      runtime.themeHook = false;
      restore(true);
    }
  };
  globalThis[RUNTIME_KEY] = runtime;

  function Settings() {
    const theme = currentThemeKey() ?? "unknown";
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
        "Keeps Discord's native Onyx backgrounds untouched, then removes remaining brand/accent colors from controls, links, selected indicators, mentions, text and icons."
      ),
      React.createElement(
        RN.Text,
        { style: { color: "#B5BAC1", fontSize: 12, marginBottom: 12 } },
        `Active native theme: ${theme}`
      ),
      React.createElement(
        RN.Pressable,
        {
          onPress: apply,
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
          "Reapply to current theme"
        )
      ),
      React.createElement(
        RN.Text,
        { style: { color: "#80848E", fontSize: 11, marginTop: 14 } },
        `v${VERSION} • base:${appliedTheme ?? "not-applied"} • patched:${runtime.lastChanged} • applies:${runtime.applyCount} • heals:${runtime.healCount} • hook:${runtime.themeHook ? "armed" : "missing"} • last:${runtime.lastReason}`
      )
    );
  }

  return {
    onLoad() {
      installPersistence();
      apply("onLoad", true);
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