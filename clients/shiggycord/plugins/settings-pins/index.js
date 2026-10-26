(() => {
  "use strict";

  const V = vendetta;
  const B = globalThis.bunny;
  if (!V?.metro?.common || !V?.plugins) return {};

  const { React, ReactNative: RN } = V.metro.common;
  const storage = V.plugin?.storage ?? {};
  const SELF_ID = String(V.plugin?.id ?? "");
  const VERSION = "1.1.0-shiggy";
  const SECTION = "ShiggyCord";
  const PIN_SECTION = "Pinned Plugins";
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
  const startupRepairTimers = [];

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
        if (allPlugins()[SELF_ID]?.enabled === false) return false;
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

  function pinSectionRows() {
    return Object.values(allPlugins())
      .filter(plugin => plugin?.id)
      .map(plugin => makePinRow(String(plugin.id)))
      .filter(Boolean);
  }

  function ensurePinSection() {
    const api = B?.ui?.settings;
    const registry = api?.registeredSections;
    if (!registry || typeof registry !== "object") return false;

    const rows = pinSectionRows();
    const existing = registry[PIN_SECTION];
    const desiredKeys = rows.map(row => String(row?.key ?? ""));
    const existingKeys = Array.isArray(existing)
      ? existing.map(row => String(row?.key ?? ""))
      : [];

    const same = desiredKeys.length === existingKeys.length
      && desiredKeys.every((key, index) => key === existingKeys[index]);

    if (!same) {
      if (typeof api.registerSection === "function") {
        try { api.registerSection({ name: PIN_SECTION, items: rows }); }
        catch { registry[PIN_SECTION] = rows; }
      } else {
        registry[PIN_SECTION] = rows;
      }
    }

    return Array.isArray(registry[PIN_SECTION]);
  }

  function registeredPinKeys() {
    try {
      const rows = B?.ui?.settings?.registeredSections?.[PIN_SECTION];
      return Array.isArray(rows)
        ? rows.map(row => String(row?.key ?? "")).filter(Boolean)
        : [];
    } catch {
      return [];
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

      ensurePinSection();
      if (!registeredPinKeys().includes(field)) return true;

      try { return original(...args); }
      catch { return true; }
    });

    return true;
  }

  function repairSettingsNode(node) {
    if (!node || !Array.isArray(node.sections)) return node;
    if (!ensurePinSection()) return node;

    const desiredKeys = registeredPinKeys();
    if (!desiredKeys.length) return node;

    // Migration cleanup only: v1.0.x injected pin rows into another section.
    for (const candidate of node.sections) {
      if (!Array.isArray(candidate?.settings)) continue;
      if (candidate.label === PIN_SECTION || candidate.title === PIN_SECTION) continue;
      const kept = candidate.settings.filter(
        key => !String(key ?? "").startsWith(KEY_PREFIX),
      );
      if (kept.length !== candidate.settings.length) {
        candidate.settings.splice(0, candidate.settings.length, ...kept);
      }
    }

    let section = node.sections.find(candidate =>
      candidate
      && Array.isArray(candidate.settings)
      && (candidate.label === PIN_SECTION || candidate.title === PIN_SECTION)
    );

    if (!section) {
      const shiggyIndex = node.sections.findIndex(candidate =>
        candidate
        && Array.isArray(candidate.settings)
        && (candidate.label === SECTION
          || candidate.title === SECTION
          || candidate.settings.includes("SHIGGYCORD"))
      );
      const accountIndex = node.sections.findIndex(candidate =>
        Array.isArray(candidate?.settings) && candidate.settings.includes("ACCOUNT")
      );

      section = {
        label: PIN_SECTION,
        title: PIN_SECTION,
        settings: desiredKeys.slice(),
      };

      const insertAt = shiggyIndex >= 0
        ? shiggyIndex + 1
        : accountIndex >= 0
          ? accountIndex + 1
          : 0;
      node.sections.splice(insertAt, 0, section);
      return node;
    }

    const current = section.settings;
    const unchanged = current.length === desiredKeys.length
      && current.every((value, index) => String(value ?? "") === desiredKeys[index]);

    if (!unchanged) current.splice(0, current.length, ...desiredKeys);
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
    removeOurRows(shiggyRows());
    wrapExistingShortcuts();

    const registered = ensurePinSection();
    installSettingsTreeGuard();
    installSettingsListRepair();
    try { findSettingsTreeManager()?.clearCaches?.(); } catch {}
    return registered;
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
      }, "Choose which plugin settings appear in the Pinned Plugins section. After changing pins, ReShiggy is still the safest way to force an immediate rebuild."),
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
      syncPins();

      // ShiggyCord starts Vendetta plugins in staggered batches. Re-assert the
      // registration while the remaining plugin settings pages finish loading.
      for (const delay of [750, 2500, 6000]) {
        startupRepairTimers.push(setTimeout(() => {
          try { syncPins(); } catch {}
        }, delay));
      }
    },
    onUnload() {
      restoreExistingShortcuts();
      removeOurRows(shiggyRows());
      while (startupRepairTimers.length) {
        try { clearTimeout(startupRepairTimers.pop()); } catch {}
      }
      // Keep the registered section object until a full reload. Once this
      // plugin is disabled its predicates hide the rows, which avoids leaving
      // cached Discord settings nodes pointing at missing renderer entries.
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