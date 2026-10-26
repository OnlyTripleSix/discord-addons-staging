(() => {
  "use strict";

  const V = vendetta;
  const B = globalThis.bunny;
  if (!V?.metro?.common || !V?.plugins) return {};

  const { React, ReactNative: RN } = V.metro.common;
  const storage = V.plugin?.storage ?? {};
  const SELF_ID = String(V.plugin?.id ?? "");
  const VERSION = "1.3.0-shiggy";
  const SECTION = "ShiggyCord";
  const KEY_PREFIX = "ITS666_SETTINGS_PIN_";
  const STATE_VERSION = 1;
  const CORE_ROW_KEYS = new Set([
    "SHIGGYCORD",
    "BUNNY_PLUGINS",
    "BUNNY_THEMES",
    "BUNNY_FONTS",
    "BUNNY_DEVELOPER",
  ]);
  const originalExistingPredicates = new Map();
  let settingsTreeGuardUnpatch = null;
  let rendererConfigBridgeUnpatch = null;
  const settingsListRepairUnpatches = [];
  const diagnostics = { utilsPatches: 0, utilsHits: 0, validPins: 0, repairs: 0, bridge: 0 };

  const rootNavigation = B?.metro?.findByPropsLazy?.("getRootNavigationRef") ?? null;

  const C = {
    bg: "#111214",
    card: "#1e1f22",
    text: "#f2f3f5",
    muted: "#b5bac1",
    border: "#3f4147",
  };

  function toast(text) {
    const value = String(text);
    try {
      const actions = V.metro?.common?.toasts;
      if (typeof actions?.open === "function") {
        actions.open(`its666-settings-pins-${Date.now()}`, { text: value });
        return;
      }
    } catch {}
    try { V.ui?.toasts?.showToast?.(value); } catch {}
  }

  function allPlugins() {
    try { return V.plugins?.plugins ?? {}; }
    catch { return {}; }
  }

  function hashId(id) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < id.length; i++) {
      hash ^= id.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36).toUpperCase();
  }

  function pinRowKey(id) {
    return `${KEY_PREFIX}${hashId(id)}`;
  }

  function pinStorageKey(id) {
    return `pin_${hashId(id)}`;
  }

  function ensurePinState() {
    if (storage.pinStateVersion === STATE_VERSION) return;

    const legacy = Array.isArray(storage.pinnedIds)
      ? new Set(storage.pinnedIds.map(String))
      : null;
    const defaults = new Set(["Account Switcher", "Purge Tools"]);

    for (const plugin of Object.values(allPlugins())) {
      if (!plugin?.id) continue;
      const id = String(plugin.id);
      const key = pinStorageKey(id);
      if (storage[key] != null) continue;

      const enabled = legacy
        ? legacy.has(id)
        : defaults.has(String(plugin?.manifest?.name ?? ""));
      storage[key] = enabled;
    }

    storage.pinStateVersion = STATE_VERSION;
  }

  function isPinned(id) {
    return storage[pinStorageKey(id)] === true;
  }

  function setPinned(id, value) {
    storage[pinStorageKey(id)] = !!value;
  }

  function existingStorageKey(key) {
    return `existing_${hashId(String(key))}`;
  }

  function isExistingVisible(key) {
    return storage[existingStorageKey(key)] !== false;
  }

  function setExistingVisible(key, value) {
    storage[existingStorageKey(key)] = !!value;
  }

  function currentPins() {
    return Object.values(allPlugins())
      .filter(plugin => plugin?.id && isPinned(String(plugin.id)))
      .map(plugin => String(plugin.id));
  }

  function shiggyRows() {
    try {
      const rows = B?.ui?.settings?.registeredSections?.[SECTION];
      return Array.isArray(rows) ? rows : null;
    } catch {
      return null;
    }
  }

  function removeOurRows(rows) {
    if (!Array.isArray(rows)) return;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (String(rows[i]?.key ?? "").startsWith(KEY_PREFIX)) rows.splice(i, 1);
    }
  }

  function isExistingShortcutRow(row) {
    const key = String(row?.key ?? "");
    return !!key && !CORE_ROW_KEYS.has(key) && !key.startsWith(KEY_PREFIX);
  }

  function existingShortcutRows() {
    return (shiggyRows() ?? []).filter(isExistingShortcutRow);
  }

  function wrapExistingShortcuts(rows = shiggyRows()) {
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      if (!isExistingShortcutRow(row) || originalExistingPredicates.has(row)) continue;
      const key = String(row.key);
      const original = typeof row.usePredicate === "function" ? row.usePredicate : null;
      originalExistingPredicates.set(row, original);
      row.usePredicate = () => {
        if (!isExistingVisible(key)) return false;
        if (!original) return true;
        try { return !!original(); }
        catch { return false; }
      };
    }
  }

  function restoreExistingShortcuts() {
    for (const [row, original] of originalExistingPredicates) {
      try {
        if (original) row.usePredicate = original;
        else delete row.usePredicate;
      } catch {}
    }
    originalExistingPredicates.clear();
  }

  function iconFor(plugin) {
    const requested = plugin?.manifest?.vendetta?.icon;
    for (const name of [requested, "PuzzlePieceIcon"]) {
      if (!name) continue;
      try {
        const id = V.ui?.assets?.getAssetIDByName?.(name);
        if (id != null) return id;
      } catch {}
    }
    return undefined;
  }

  function openPinnedPlugin(id) {
    const plugin = allPlugins()[id];
    if (!plugin) {
      toast("That pinned plugin is no longer installed.");
      return;
    }
    if (!plugin.enabled) {
      toast(`Enable ${plugin.manifest?.name ?? "that plugin"} first.`);
      return;
    }

    const Component = V.plugins?.getSettings?.(id);
    if (typeof Component !== "function") {
      toast(`${plugin.manifest?.name ?? "That plugin"} has no available settings page.`);
      return;
    }

    try {
      let navigation = rootNavigation?.getRootNavigationRef?.();
      if (!navigation?.navigate) {
        navigation = V.metro?.findByProps?.("getRootNavigationRef")?.getRootNavigationRef?.();
      }
      if (!navigation?.navigate) throw new Error("Navigation unavailable");

      navigation.navigate("SHIGGYCORD_CUSTOM_PAGE", {
        title: String(plugin.manifest?.name ?? "Plugin Settings"),
        render: () => React.createElement(Component),
      });
    } catch (error) {
      toast(`Could not open plugin settings: ${error?.message ?? error}`);
    }
  }

  function makePinRow(id) {
    const plugin = allPlugins()[id];
    if (!plugin) return null;

    return {
      key: pinRowKey(id),
      title: () => String(allPlugins()[id]?.manifest?.name ?? plugin.manifest?.name ?? "Plugin"),
      icon: iconFor(plugin),
      onPress: () => openPinnedPlugin(id),
      usePredicate: () => isPinned(id),
    };
  }

  function pinRendererData(id) {
    const plugin = allPlugins()[id];
    if (!plugin) return null;

    const title = () => String(
      allPlugins()[id]?.manifest?.name
      ?? plugin.manifest?.name
      ?? "Plugin"
    );

    return {
      type: "pressable",
      title,
      useTitle: title,
      usePredicate: () => isPinned(id),
      onPress: () => openPinnedPlugin(id),
      withArrow: true,
    };
  }

  function findRendererConfigModule() {
    try {
      const exact = B?.metro?.findByFilePath?.(
        "modules/user_settings/core/native/SettingsRendererConfig.tsx",
        false,
      );
      if (exact?.SETTING_RENDERER_CONFIG) return exact;
    } catch {}

    try {
      const found = V.metro?.findByProps?.("SETTING_RENDERER_CONFIG");
      if (found?.SETTING_RENDERER_CONFIG) return found;
    } catch {}

    return null;
  }

  function installRendererConfigBridge() {
    if (rendererConfigBridgeUnpatch) return true;

    const module = findRendererConfigModule();
    if (!module) return false;

    const descriptor = Object.getOwnPropertyDescriptor(
      module,
      "SETTING_RENDERER_CONFIG",
    );
    if (!descriptor || descriptor.configurable === false) return false;

    const readBase = descriptor.get
      ? () => descriptor.get.call(module)
      : () => descriptor.value;

    const writeBase = descriptor.set
      ? value => descriptor.set.call(module, value)
      : null;

    try {
      Object.defineProperty(module, "SETTING_RENDERER_CONFIG", {
        enumerable: descriptor.enumerable ?? true,
        configurable: true,
        get() {
          const base = readBase() ?? {};
          const merged = { ...base };

          for (const plugin of Object.values(allPlugins())) {
            if (!plugin?.id) continue;
            const id = String(plugin.id);
            const data = pinRendererData(id);
            if (data) merged[pinRowKey(id)] = data;
          }

          return merged;
        },
        ...(writeBase ? { set: writeBase } : {}),
      });

      rendererConfigBridgeUnpatch = () => {
        try {
          Object.defineProperty(module, "SETTING_RENDERER_CONFIG", descriptor);
        } catch {}
      };
      diagnostics.bridge = 1;
      return true;
    } catch {
      return false;
    }
  }

  function rendererConfigFor(key) {
    try {
      const module = findRendererConfigModule();
      return module?.SETTING_RENDERER_CONFIG?.[key] ?? null;
    } catch {
      return null;
    }
  }

  function findSettingsTreeManager() {
    try {
      const direct = V.metro?.findByProps?.("getAncestors", "isBlocked", "clearCaches")
        ?? V.metro?.findByProps?.("getAncestors", "isBlocked");
      if (direct?.isBlocked) return direct;
      if (direct?.default?.isBlocked) return direct.default;
    } catch {}

    try {
      const module = V.metro?.find?.(candidate => {
        const value = candidate?.default ?? candidate;
        return typeof value?.getAncestors === "function"
          && typeof value?.isBlocked === "function";
      });
      const value = module?.default ?? module;
      return typeof value?.isBlocked === "function" ? value : null;
    } catch {
      return null;
    }
  }

  function installSettingsTreeGuard() {
    if (settingsTreeGuardUnpatch) return true;

    const manager = findSettingsTreeManager();
    if (!manager || typeof manager.isBlocked !== "function") return false;

    settingsTreeGuardUnpatch = V.patcher.instead("isBlocked", manager, (args, original) => {
      const field = String(args?.[0] ?? "");
      if (!field.startsWith(KEY_PREFIX)) return original(...args);

      const row = (shiggyRows() ?? [])
        .find(candidate => String(candidate?.key ?? "") === field);
      if (!row) return true;

      const config = rendererConfigFor(field);
      if (!config) return true;

      try {
        if (typeof row.usePredicate === "function" && !row.usePredicate()) {
          return true;
        }
        return false;
      } catch {
        return true;
      }
    });

    return true;
  }

  function repairSettingsNode(node) {
    if (!node || !Array.isArray(node.sections)) return false;

    // Keep ShiggyCord's dynamic renderer registry current first.
    try { syncPins(); } catch {}

    const rows = shiggyRows();
    if (!Array.isArray(rows)) return false;

    const baseKeys = [];
    const pinKeys = [];

    for (const row of rows) {
      const key = String(row?.key ?? "");
      if (!key) continue;

      if (!key.startsWith(KEY_PREFIX)) {
        baseKeys.push(key);
        continue;
      }

      let visible = true;
      try {
        if (typeof row.usePredicate === "function") visible = !!row.usePredicate();
      } catch {
        visible = false;
      }

      // Never put a pin key into Discord's list unless its renderer config
      // already exists. This prevents renderSettingItem(undefined).type crashes.
      if (visible && rendererConfigFor(key)) pinKeys.push(key);
    }

    diagnostics.validPins = pinKeys.length;
    const desiredKeys = [...baseKeys, ...pinKeys];

    // Strip stale pin keys from every section before rebuilding ShiggyCord.
    for (const candidate of node.sections) {
      if (!Array.isArray(candidate?.settings)) continue;
      const kept = candidate.settings.filter(
        key => !String(key ?? "").startsWith(KEY_PREFIX)
      );
      if (kept.length !== candidate.settings.length) {
        candidate.settings.splice(0, candidate.settings.length, ...kept);
      }
    }

    let section = node.sections.find(candidate =>
      candidate
      && Array.isArray(candidate.settings)
      && (
        candidate.label === SECTION
        || candidate.title === SECTION
        || candidate.settings.includes("SHIGGYCORD")
        || candidate.settings.includes("BUNNY_PLUGINS")
      )
    );

    if (!section) {
      const accountIndex = node.sections.findIndex(candidate =>
        Array.isArray(candidate?.settings) && candidate.settings.includes("ACCOUNT")
      );
      section = {
        label: SECTION,
        title: SECTION,
        settings: desiredKeys.slice(),
      };
      node.sections.splice(accountIndex >= 0 ? accountIndex + 1 : 0, 0, section);
      diagnostics.repairs += 1;
      return true;
    }

    const extras = section.settings.filter(key => {
      const value = String(key ?? "");
      return value && !desiredKeys.includes(value);
    });
    const next = [...desiredKeys, ...extras];

    const same = section.settings.length === next.length
      && section.settings.every(
        (value, index) => String(value ?? "") === String(next[index] ?? "")
      );

    if (!same) {
      section.settings.splice(0, section.settings.length, ...next);
      diagnostics.repairs += 1;
    }

    return true;
  }

  function patchRendererUtils(module) {
    if (!module || typeof module.toSettingListItems !== "function") return false;

    try {
      const unpatch = V.patcher.before(
        "toSettingListItems",
        module,
        args => {
          diagnostics.utilsHits += 1;
          try { repairSettingsNode(args?.[0]); } catch {}
        },
      );
      settingsListRepairUnpatches.push(unpatch);
      diagnostics.utilsPatches += 1;
      return true;
    } catch {
      return false;
    }
  }

  function installSettingsListRepair() {
    if (settingsListRepairUnpatches.length) return true;

    const path = "modules/settings/native/renderer/SettingRendererUtils.tsx";

    try {
      const direct = B?.metro?.findByFilePath?.(path, false);
      if (patchRendererUtils(direct)) return true;
    } catch {}

    try {
      const byProps = V.metro?.findByProps?.(
        "toSettingListItems",
        "getSettingScreens",
      );
      if (patchRendererUtils(byProps)) return true;
    } catch {}

    try {
      const lazy = B?.metro?.findByFilePathLazy?.(path, false);
      const delay = lazy?.[Symbol.for("bunny.api.patcher.delay")];
      if (typeof delay !== "function") return false;

      let cancelled = false;
      const dispose = delay(module => {
        if (cancelled) return;
        try { patchRendererUtils(module); } catch {}
      });

      settingsListRepairUnpatches.push(() => {
        cancelled = true;
        try { dispose?.(); } catch {}
      });

      return true;
    } catch {
      return false;
    }
  }

  function syncPins() {
    ensurePinState();
    installRendererConfigBridge();
    const rows = shiggyRows();
    if (!rows) return false;

    installSettingsTreeGuard();
    installSettingsListRepair();
    removeOurRows(rows);
    wrapExistingShortcuts(rows);

    // Keep every installed plugin's pin row registered for the lifetime of this
    // plugin and let usePredicate control visibility. This prevents Discord's
    // memoized settings/search tree from holding keys that we just removed.
    const pinRows = Object.values(allPlugins())
      .filter(plugin => plugin?.id)
      .map(plugin => makePinRow(String(plugin.id)))
      .filter(Boolean);

    if (!pinRows.length) return true;

    const pluginsIndex = rows.findIndex(row => row?.key === "BUNNY_PLUGINS");
    const insertAt = pluginsIndex >= 0 ? pluginsIndex + 1 : rows.length;
    rows.splice(insertAt, 0, ...pinRows);
    return true;
  }

  function Settings() {
    ensurePinState();
    wrapExistingShortcuts();
    const [, forceUpdate] = React.useReducer(value => value + 1, 0);

    React.useEffect(() => () => {
      syncPins();
    }, []);

    const plugins = Object.values(allPlugins())
      .filter(plugin => plugin?.id && plugin?.manifest?.name)
      .sort((a, b) => String(a.manifest.name).localeCompare(String(b.manifest.name)));

    const existing = existingShortcutRows();

    return React.createElement(
      RN.ScrollView,
      { contentContainerStyle: { padding: 16, paddingBottom: 40 } },
      React.createElement(RN.Text, {
        style: { color: C.text, fontSize: 20, fontWeight: "700", marginBottom: 8 },
      }, "Settings Pins"),
      React.createElement(RN.Text, {
        style: { color: C.muted, fontSize: 13, lineHeight: 18, marginBottom: 14 },
      }, "Choose which plugin settings appear directly in ShiggyCord. After turning a pin on or off, use ReShiggy for the change to take effect."),
      ...plugins.map(plugin => {
        const id = String(plugin.id);
        const pinned = isPinned(id);
        const enabled = plugin.enabled === true;
        let settingsAvailable = false;
        try { settingsAvailable = typeof V.plugins?.getSettings?.(id) === "function"; } catch {}

        return React.createElement(RN.View, {
          key: id,
          style: {
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingVertical: 14,
            borderBottomWidth: 1,
            borderBottomColor: C.border,
          },
        },
        React.createElement(RN.View, { style: { flex: 1, paddingRight: 16 } },
          React.createElement(RN.Text, {
            style: { color: C.text, fontSize: 16, fontWeight: "600", marginBottom: 3 },
          }, String(plugin.manifest.name)),
          React.createElement(RN.Text, {
            style: { color: C.muted, fontSize: 12, lineHeight: 17 },
          }, id === SELF_ID
            ? "Settings Pins manager"
            : enabled && settingsAvailable
              ? "Settings available"
              : enabled
                ? "No settings page detected"
                : "Disabled — pin appears when enabled"),
        ),
        React.createElement(RN.Switch, {
          value: pinned,
          onValueChange(value) {
            setPinned(id, value);
            forceUpdate();
          },
        }));
      }),
      ...(existing.length ? [
        React.createElement(RN.Text, {
          key: "existing-shortcuts-title",
          style: { color: C.text, fontSize: 17, fontWeight: "700", marginTop: 22, marginBottom: 4 },
        }, "Already in ShiggyCord"),
        React.createElement(RN.Text, {
          key: "existing-shortcuts-note",
          style: { color: C.muted, fontSize: 12, lineHeight: 17, marginBottom: 8 },
        }, "These plugin shortcuts were already added to ShiggyCord. Turn one off to hide it, then use ReShiggy for the change to take effect."),
        ...existing.map(row => {
          const key = String(row.key);
          let title = key;
          try { title = String(row.title?.() ?? key); } catch {}
          return React.createElement(RN.View, {
            key: `existing-${key}`,
            style: {
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingVertical: 14,
              borderBottomWidth: 1,
              borderBottomColor: C.border,
            },
          },
          React.createElement(RN.View, { style: { flex: 1, paddingRight: 16 } },
            React.createElement(RN.Text, {
              style: { color: C.text, fontSize: 16, fontWeight: "600", marginBottom: 3 },
            }, title),
            React.createElement(RN.Text, {
              style: { color: C.muted, fontSize: 12, lineHeight: 17 },
            }, "Existing ShiggyCord shortcut"),
          ),
          React.createElement(RN.Switch, {
            value: isExistingVisible(key),
            onValueChange(value) {
              setExistingVisible(key, value);
              forceUpdate();
            },
          }));
        }),
      ] : []),
      React.createElement(RN.Text, {
        style: { color: C.muted, fontSize: 12, marginTop: 14 },
      }, `v${VERSION} • pins:${currentPins().length} • rows:${shiggyRows()?.length ?? 0} • valid:${diagnostics.validPins} • bridge:${diagnostics.bridge} • utils:${diagnostics.utilsPatches} • hits:${diagnostics.utilsHits} • repairs:${diagnostics.repairs}`),
    );
  }

  return {
    onLoad() {
      ensurePinState();
      installRendererConfigBridge();
      installSettingsTreeGuard();
      installSettingsListRepair();
      syncPins();
      try { findSettingsTreeManager()?.clearCaches?.(); } catch {}
    },
    onUnload() {
      restoreExistingShortcuts();
      removeOurRows(shiggyRows());
      try { settingsTreeGuardUnpatch?.(); } catch {}
      settingsTreeGuardUnpatch = null;
      while (settingsListRepairUnpatches.length) {
        try { settingsListRepairUnpatches.pop()?.(); } catch {}
      }
      try { rendererConfigBridgeUnpatch?.(); } catch {}
      rendererConfigBridgeUnpatch = null;
      diagnostics.bridge = 0;
      try { findSettingsTreeManager()?.clearCaches?.(); } catch {}
    },
    settings: Settings,
  };
})()