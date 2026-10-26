(() => {
  "use strict";

  const V = vendetta;
  const B = globalThis.bunny;
  if (!V?.metro?.common || !V?.plugins) return {};

  const { React, ReactNative: RN } = V.metro.common;
  const storage = V.plugin?.storage ?? {};
  const SELF_ID = String(V.plugin?.id ?? "");
  const VERSION = "1.0.11-shiggy";
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
  const settingsListRepairUnpatches = [];

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
      usePredicate: () => {
        if (!isPinned(id)) return false;
        const live = allPlugins()[id];
        if (!live?.enabled) return false;
        try { return typeof V.plugins?.getSettings?.(id) === "function"; }
        catch { return false; }
      },
    };
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

      const stillRegistered = (shiggyRows() ?? [])
        .some(row => String(row?.key ?? "") === field);
      if (!stillRegistered) return true;

      try {
        return original(...args);
      } catch {
        // Discord's current SettingTreeManager assumes every setting key still
        // has a renderer config entry. A stale Settings Pins key must be hidden,
        // not allowed to crash the entire Settings overview.
        return true;
      }
    });

    return true;
  }

  function repairSettingsNode(node) {
    if (!node || !Array.isArray(node.sections)) return node;

    const rows = shiggyRows();
    if (!Array.isArray(rows)) return node;

    const desiredKeys = rows
      .map(row => String(row?.key ?? ""))
      .filter(Boolean);

    if (!desiredKeys.some(key => key.startsWith(KEY_PREFIX))) return node;

    let section = node.sections.find(candidate => {
      if (!candidate || !Array.isArray(candidate.settings)) return false;
      if (candidate.label === SECTION || candidate.title === SECTION) return true;
      return candidate.settings.includes("SHIGGYCORD")
        || candidate.settings.includes("BUNNY_PLUGINS");
    });

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
      return node;
    }

    const current = Array.isArray(section.settings) ? section.settings : [];
    const extras = current.filter(key => {
      const value = String(key ?? "");
      return value
        && !value.startsWith(KEY_PREFIX)
        && !desiredKeys.includes(value);
    });

    const next = [...desiredKeys, ...extras];
    const unchanged = current.length === next.length
      && current.every((value, index) => String(value ?? "") === next[index]);

    if (!unchanged) {
      if (Array.isArray(section.settings)) {
        section.settings.splice(0, section.settings.length, ...next);
      } else {
        section.settings = next;
      }
    }

    return node;
  }

  function installSettingsListRepair() {
    if (settingsListRepairUnpatches.length) return true;

    const findLazy = B?.metro?.findByFilePathLazy;
    if (typeof findLazy !== "function") return false;

    try {
      const builders = findLazy(
        "modules/settings/native/renderer/SettingBuilders.tsx",
        false,
      );
      const rendererUtils = findLazy(
        "modules/settings/native/renderer/SettingRendererUtils.tsx",
        false,
      );

      settingsListRepairUnpatches.push(
        V.patcher.after("createList", builders, (_args, result) => {
          repairSettingsNode(result);
          return result;
        }),
      );

      settingsListRepairUnpatches.push(
        V.patcher.before("toSettingListItems", rendererUtils, args => {
          repairSettingsNode(args?.[0]);
        }),
      );

      return true;
    } catch {
      return false;
    }
  }

  function syncPins() {
    ensurePinState();
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
      }, `v${VERSION}`),
    );
  }

  return {
    onLoad() {
      ensurePinState();
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
      try { findSettingsTreeManager()?.clearCaches?.(); } catch {}
    },
    settings: Settings,
  };
})()