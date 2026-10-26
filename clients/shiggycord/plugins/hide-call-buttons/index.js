(() => {
  "use strict";

  const V = vendetta;
  const B = globalThis.bunny;
  if (!V?.patcher || !V?.metro?.common) return {};

  const { after } = V.patcher;
  const { React, ReactNative: RN } = V.metro.common;
  const storage = V.plugin?.storage ?? {};
  const VERSION = "1.3.6-shiggy";
  const RUNTIME_KEY = "__itsTripleSixHideCallButtonsRuntime";

  const PATHS = {
    profile: "modules/user_profile/native/UserProfileContactButtons.tsx",
    dmHeader: "modules/main_tabs_v2/native/channel/header/PrivateChannelButtons.tsx",
    friends: "modules/main_tabs_v2/native/shared_components/user_list/UserRow.tsx",
    voiceVideo: "modules/voice_panel/native/controls/buttons/VoicePanelVideoButton.tsx",
  };

  const defaults = {
    profileHideCallButton: true,
    dmHideCallButton: true,
    dmHideVideoButton: true,
    friendsHideCallButton: true,
    hideVCVideoButton: true,
  };

  for (const [key, value] of Object.entries(defaults)) {
    if (storage[key] == null) storage[key] = value;
  }

  try { globalThis[RUNTIME_KEY]?.cleanup?.(); } catch {}

  const runtime = {
    patches: [],
    armed: {
      profile: false,
      dmHeader: false,
      friends: false,
      voiceVideo: false,
    },
    cleanup() {
      for (const unpatch of runtime.patches.splice(0)) {
        try { unpatch?.(); } catch {}
      }
      for (const key of Object.keys(runtime.armed)) runtime.armed[key] = false;
    },
  };
  globalThis[RUNTIME_KEY] = runtime;

  function isElement(node) {
    return React.isValidElement?.(node) === true;
  }

  function rebuild(element, props) {
    try { return React.cloneElement(element, props); }
    catch { return element; }
  }

  function childrenOf(node) {
    return isElement(node) ? node.props?.children : undefined;
  }

  function getAtPath(root, path) {
    let node = root;
    for (const step of path) {
      if (!isElement(node)) return undefined;
      const kids = childrenOf(node);
      node = step === -1 ? kids : kids?.[step];
    }
    return node;
  }

  function replaceChildren(root, path, children) {
    if (!isElement(root)) return root;
    if (path.length === 0) return rebuild(root, { children });

    const [head, ...rest] = path;
    const current = childrenOf(root);

    if (head === -1) {
      if (!isElement(current)) return root;
      return rebuild(root, { children: replaceChildren(current, rest, children) });
    }

    if (!Array.isArray(current)) return root;
    const next = [...current];
    next[head] = replaceChildren(current[head], rest, children);
    return rebuild(root, { children: next });
  }

  function pressablePaths(root) {
    const found = [];

    function visit(node, path, depth) {
      if (depth > 10 || !isElement(node)) return;

      const kids = childrenOf(node);
      if (isElement(kids)) {
        const childPath = [...path, -1];
        if (typeof kids.props?.onPress === "function") found.push(childPath);
        visit(kids, childPath, depth + 1);
        return;
      }

      if (!Array.isArray(kids)) return;

      for (let i = 0; i < kids.length; i += 1) {
        const kid = kids[i];
        if (!isElement(kid)) continue;
        const childPath = [...path, i];
        if (typeof kid.props?.onPress === "function") found.push(childPath);
        visit(kid, childPath, depth + 1);
      }
    }

    visit(root, [], 0);
    return found;
  }

  function removeLastPressable(root) {
    const paths = pressablePaths(root);
    if (paths.length < 2) return root;

    const target = paths[paths.length - 1];
    let chosen = target;

    for (let len = target.length - 1; len >= 1; len -= 1) {
      const prefix = target.slice(0, len);
      if (pressablePaths(getAtPath(root, prefix)).length !== 1) break;
      chosen = prefix;
    }

    const parentPath = chosen.slice(0, -1);
    const parent = getAtPath(root, parentPath);
    const siblings = childrenOf(parent);
    if (!Array.isArray(siblings)) return root;

    const dropIndex = chosen[chosen.length - 1];
    const kept = siblings.filter((_, i) => i !== dropIndex);
    if (kept.length === siblings.length) return root;

    return replaceChildren(root, parentPath, kept);
  }

  function mapChildren(node, fn, depth = 0) {
    if (depth > 12) return node;

    if (Array.isArray(node)) {
      let changed = false;
      const mapped = node.map(child => {
        const next = mapChildren(child, fn, depth + 1);
        if (next !== child) changed = true;
        return next;
      });
      return changed ? mapped : node;
    }

    if (!isElement(node)) return node;

    const children = childrenOf(node);
    const nextChildren =
      children == null ? children : mapChildren(children, fn, depth + 1);

    const base =
      nextChildren === children ? node : rebuild(node, { children: nextChildren });

    return fn(base);
  }

  function pruneProfile(root) {
    if (!storage.profileHideCallButton || !isElement(root)) return root;
    return removeLastPressable(root);
  }

  function pruneDM(root) {
    if (
      (!storage.dmHideCallButton && !storage.dmHideVideoButton)
      || !isElement(root)
    ) return root;

    const children = childrenOf(root);
    if (!Array.isArray(children)) return root;

    const callVideoIndexes = children.flatMap((child, index) => {
      if (
        isElement(child)
        && typeof child.props?.onPress === "function"
        && Object.prototype.hasOwnProperty.call(child.props ?? {}, "disabled")
      ) return [index];
      return [];
    });

    if (callVideoIndexes.length === 0) return root;

    const drop = new Set();
    if (storage.dmHideCallButton && callVideoIndexes[0] != null) {
      drop.add(callVideoIndexes[0]);
    }
    if (storage.dmHideVideoButton && callVideoIndexes[1] != null) {
      drop.add(callVideoIndexes[1]);
    }

    if (drop.size === 0) return root;
    const kept = children.filter((_, index) => !drop.has(index));
    return kept.length ? rebuild(root, { children: kept }) : root;
  }

  function pruneFriends(root) {
    if (!storage.friendsHideCallButton || !isElement(root)) return root;

    return mapChildren(root, element => {
      const actions = element.props?.accessibilityActions;
      const trailing = element.props?.trailing;
      const buttons = trailing?.props?.children;

      const index = Array.isArray(actions)
        ? actions.findIndex(action =>
            String(action?.name ?? "").toLowerCase() === "call"
          )
        : -1;

      if (
        index < 0
        || !isElement(trailing)
        || !Array.isArray(buttons)
        || buttons.length !== actions.length
      ) return element;

      return rebuild(element, {
        accessibilityActions: actions.filter((_, i) => i !== index),
        trailing: rebuild(trailing, {
          children: buttons.filter((_, i) => i !== index),
        }),
      });
    });
  }

  function armLazy(path, exportDefault, method, label, apply) {
    try {
      const finder = B?.metro?.findByFilePathLazy;
      if (typeof finder !== "function") return false;

      const target = finder(path, exportDefault);
      const unpatch = after(method, target, (_args, result) => {
        try { return apply(result); }
        catch (error) {
          try { V.logger?.error?.(`[Hide Call Buttons] ${label}`, error); } catch {}
          return result;
        }
      });

      runtime.patches.push(unpatch);
      runtime.armed[label] = true;
      return true;
    } catch (error) {
      try { V.logger?.error?.(`[Hide Call Buttons] failed to arm ${label}`, error); } catch {}
      return false;
    }
  }

  function install() {
    runtime.cleanup();

    armLazy(PATHS.profile, false, "default", "profile", pruneProfile);
    armLazy(PATHS.dmHeader, true, "type", "dmHeader", pruneDM);
    armLazy(PATHS.friends, true, "type", "friends", pruneFriends);
    armLazy(
      PATHS.voiceVideo,
      false,
      "default",
      "voiceVideo",
      result => storage.hideVCVideoButton ? null : result,
    );
  }

  function SettingRow({ title, description, storageKey, forceUpdate }) {
    return React.createElement(
      RN.View,
      {
        style: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingVertical: 13,
          borderBottomWidth: 1,
          borderBottomColor: "#3F4147",
        },
      },
      React.createElement(
        RN.View,
        { style: { flex: 1, paddingRight: 14 } },
        React.createElement(
          RN.Text,
          { style: { color: "#F2F3F5", fontSize: 15, fontWeight: "600" } },
          title,
        ),
        React.createElement(
          RN.Text,
          {
            style: {
              color: "#B5BAC1",
              fontSize: 12,
              lineHeight: 17,
              marginTop: 3,
            },
          },
          description,
        ),
      ),
      React.createElement(RN.Switch, {
        value: storage[storageKey] !== false,
        onValueChange(value) {
          storage[storageKey] = value;
          forceUpdate();
        },
      }),
    );
  }

  function Settings() {
    const [, forceUpdate] = React.useReducer(value => value + 1, 0);

    const rows = [
      ["Profile call button", "Hide the call control on user profiles.", "profileHideCallButton"],
      ["DM voice call", "Hide the voice-call button in DM headers.", "dmHideCallButton"],
      ["DM video call", "Hide the video-call button in DM headers.", "dmHideVideoButton"],
      ["Friends list call", "Hide the call action on Friends-list rows.", "friendsHideCallButton"],
      ["Voice-channel camera", "Hide the camera/video control in the voice panel.", "hideVCVideoButton"],
    ];

    return React.createElement(
      RN.ScrollView,
      { contentContainerStyle: { padding: 16, paddingBottom: 36 } },
      React.createElement(
        RN.Text,
        {
          style: {
            color: "#F2F3F5",
            fontSize: 20,
            fontWeight: "700",
            marginBottom: 6,
          },
        },
        "Hide Call Buttons",
      ),
      React.createElement(
        RN.Text,
        {
          style: {
            color: "#B5BAC1",
            fontSize: 13,
            lineHeight: 18,
            marginBottom: 10,
          },
        },
        "Uses ShiggyCord's lazy module hooks so Discord screens loaded later are patched too.",
      ),
      ...rows.map(([title, description, storageKey]) =>
        React.createElement(SettingRow, {
          key: storageKey,
          title,
          description,
          storageKey,
          forceUpdate,
        })
      ),
      React.createElement(
        RN.Text,
        {
          style: {
            color: "#80848E",
            fontSize: 11,
            lineHeight: 16,
            marginTop: 14,
          },
        },
        `v${VERSION} • profile:${runtime.armed.profile ? "armed" : "missing"} • dm:${runtime.armed.dmHeader ? "armed" : "missing"} • friends:${runtime.armed.friends ? "armed" : "missing"} • vc:${runtime.armed.voiceVideo ? "armed" : "missing"}`,
      ),
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
    settings: Settings,
  };
})();
