/**
 * UI helpers — Material Web の小さな互換層
 *
 * 既存コードは `<input type="checkbox">.checked` を多用しているため、
 * `<md-switch>` でも `.checked` を読み書きできるように shim を入れる。
 *
 * 使い方:
 *   <script src="shared/ui-helpers.js"></script>
 *   await window.appUI.waitForMaterialReady();
 *   window.appUI.patchAllSwitches();
 *   // 以降は dc.checked = true / sw.checked 取得が使える
 */
'use strict';

(function () {
  const MD_INPUT_TAGS = ['md-outlined-text-field', 'md-outlined-select'];
  /** ラベルアニメは内部の md-outlined-field で実行される */
  const MD_FIELD_ANIMATION_TAGS = ['md-outlined-field'];
  const MD_GUARDED_PROPS = ['value', 'label'];
  const mdLayoutGuardTags = new Set();
  const mdAnimGuardTags = new Set();
  let mdFieldInitLocked = false;

  function setMdFieldInitLocked(locked) {
    mdFieldInitLocked = !!locked;
  }

  /** define 前にプロトタイプへパッチしないと、初回 upgrade で label アニメが NaN になる */
  function hookCustomElementsDefine() {
    if (customElements.__suiteDefineHooked) return;
    customElements.__suiteDefineHooked = true;
    const origDefine = customElements.define.bind(customElements);
    customElements.define = function (name, ctor, options) {
      if (MD_FIELD_ANIMATION_TAGS.includes(name) && !mdAnimGuardTags.has(name)) {
        installMdFieldAnimationGuards(ctor);
        mdAnimGuardTags.add(name);
      }
      if (MD_INPUT_TAGS.includes(name) && !mdLayoutGuardTags.has(name)) {
        installMdFieldInputGuards(ctor);
        mdLayoutGuardTags.add(name);
      }
      return origDefine(name, ctor, options);
    };
  }

  function patchSwitch(el) {
    if (!el) return;
    if (!el.hasAttribute('icons')) {
      el.setAttribute('icons', '');
      el.setAttribute('show-only-selected-icon', '');
    }
    if (el.__checkedShim) return;
    el.__checkedShim = true;
    Object.defineProperty(el, 'checked', {
      get() { return !!this.selected; },
      set(v) { this.selected = !!v; },
      configurable: true,
    });
  }

  function patchAllSwitches(root) {
    (root || document).querySelectorAll('md-switch').forEach(patchSwitch);
  }

  function walkLayoutAncestors(el, visit) {
    let node = el;
    while (node) {
      if (visit(node) === false) return;
      if (node.parentElement) {
        node = node.parentElement;
      } else if (node.parentNode instanceof ShadowRoot) {
        node = node.parentNode.host;
      } else {
        break;
      }
    }
  }

  /** 非表示タブ・閉じた details・display:none ではラベルアニメが NaN になる */
  function isMdFieldLayoutVisible(el) {
    if (!el?.isConnected) return false;
    if (mdFieldInitLocked) return false;

    let hiddenByTab = false;
    walkLayoutAncestors(el, (node) => {
      const tabPanel = node.closest?.('.tab-panel');
      if (tabPanel && !tabPanel.classList.contains('active')) {
        hiddenByTab = true;
        return false;
      }
      if (node.tagName === 'DETAILS' && !node.open) return false;
      if (node.getAttribute?.('data-avpanel') && node.style?.display === 'none') return false;
      if (node.style?.display === 'none') return false;
      const cs = window.getComputedStyle(node);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      return true;
    });
    if (hiddenByTab) return false;

    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function guardMdInputProperty(proto, prop) {
    const desc = Object.getOwnPropertyDescriptor(proto, prop);
    if (!desc?.set || proto[`__suiteGuard_${prop}`]) return;
    const origSet = desc.set;
    const origGet = desc.get;
    proto[`__suiteGuard_${prop}`] = true;
    proto[`__suiteOrigSet_${prop}`] = origSet;
    Object.defineProperty(proto, prop, {
      get() { return origGet ? origGet.call(this) : undefined; },
      set(v) {
        if (!isMdFieldLayoutVisible(this)) {
          if (!this.__suitePending) this.__suitePending = {};
          this.__suitePending[prop] = v;
          return;
        }
        if (this.__suitePending?.[prop] !== undefined) delete this.__suitePending[prop];
        origSet.call(this, v);
      },
      configurable: true,
    });
  }

  function findProtoMethod(proto, methodName, guardFlag) {
    while (proto) {
      const fn = proto[methodName];
      if (typeof fn === 'function' && !proto[guardFlag]) return proto;
      proto = Object.getPrototypeOf(proto);
    }
    return null;
  }

  /** scrollWidth=0 のとき scale(NaN) になるアニメを抑止 */
  function installMdFieldAnimationGuards(ctor) {
    const animProto = findProtoMethod(ctor.prototype, 'animateLabelIfNeeded', '__suiteGuardAnimateLabel');
    if (animProto) {
      const origAnimate = animProto.animateLabelIfNeeded;
      animProto.__suiteGuardAnimateLabel = true;
      animProto.animateLabelIfNeeded = function (...args) {
        if (!isMdFieldLayoutVisible(this)) return;
        const { floatingLabelEl, restingLabelEl } = this;
        if (!floatingLabelEl || !restingLabelEl) return;
        const hostRect = this.getBoundingClientRect();
        if (hostRect.width <= 0 || hostRect.height <= 0) return;
        if (floatingLabelEl.scrollWidth <= 0 || restingLabelEl.scrollWidth <= 0) return;
        return origAnimate.apply(this, args);
      };
    }

    const keyProto = findProtoMethod(ctor.prototype, 'getLabelKeyframes', '__suiteGuardKeyframes');
    if (keyProto) {
      const origKeyframes = keyProto.getLabelKeyframes;
      keyProto.__suiteGuardKeyframes = true;
      keyProto.getLabelKeyframes = function (...args) {
        const { floatingLabelEl, restingLabelEl } = this;
        if (!floatingLabelEl || !restingLabelEl) return [];
        if (floatingLabelEl.scrollWidth <= 0 || restingLabelEl.scrollWidth <= 0) return [];
        const frames = origKeyframes.apply(this, args);
        if (!Array.isArray(frames)) return [];
        return frames.filter((frame) => {
          const t = frame?.transform;
          return !t || (!t.includes('NaN') && !t.includes('Infinity'));
        });
      };
    }
  }

  function installMdFieldInputGuards(ctor) {
    for (const prop of MD_GUARDED_PROPS) guardMdInputProperty(ctor.prototype, prop);
  }

  function installMdFieldLayoutGuard() {
    for (const tag of MD_FIELD_ANIMATION_TAGS) {
      if (mdAnimGuardTags.has(tag)) continue;
      const ctor = customElements.get(tag);
      if (!ctor) continue;
      installMdFieldAnimationGuards(ctor);
      mdAnimGuardTags.add(tag);
    }
    for (const tag of MD_INPUT_TAGS) {
      if (mdLayoutGuardTags.has(tag)) continue;
      const ctor = customElements.get(tag);
      if (!ctor) continue;
      installMdFieldInputGuards(ctor);
      mdLayoutGuardTags.add(tag);
    }
  }

  function applyPendingMdField(el) {
    if (!el.__suitePending || !isMdFieldLayoutVisible(el)) return;
    const pending = { ...el.__suitePending };
    delete el.__suitePending;
    const proto = Object.getPrototypeOf(el);
    if ('label' in pending && proto.__suiteOrigSet_label) {
      proto.__suiteOrigSet_label.call(el, pending.label);
    }
    if ('value' in pending && proto.__suiteOrigSet_value) {
      proto.__suiteOrigSet_value.call(el, pending.value);
    }
  }

  /** 非表示タブで __suitePending に留まっている value も読む */
  function readMdFieldValue(el) {
    if (!el) return '';
    if (el.__suitePending && Object.prototype.hasOwnProperty.call(el.__suitePending, 'value')) {
      return el.__suitePending.value;
    }
    return el.value ?? '';
  }

  function flushDeferredMdFields(scope) {
    const root = typeof scope === 'string'
      ? document.getElementById(scope)
      : (scope || document);
    if (!root) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        root.querySelectorAll(MD_INPUT_TAGS.join(',')).forEach(applyPendingMdField);
      });
    });
  }

  function scheduleMdFieldLayoutGuard() {
    for (const tag of MD_FIELD_ANIMATION_TAGS.concat(MD_INPUT_TAGS)) {
      customElements.whenDefined(tag).then(() => {
        installMdFieldLayoutGuard();
      });
    }
  }

  async function waitForMaterialReady(extraTags) {
    const defaults = [
      'md-switch',
      'md-outlined-field',
      'md-outlined-select',
      'md-select-option',
      'md-outlined-text-field',
      'md-tabs',
      'md-primary-tab',
      'md-secondary-tab',
      'md-filled-button',
      'md-outlined-button',
      'md-text-button',
      'md-filled-tonal-button',
    ];
    const tags = defaults.concat(extraTags || []);
    await Promise.all(tags.map((t) => customElements.whenDefined(t)));
    installMdFieldLayoutGuard();
  }

  hookCustomElementsDefine();
  scheduleMdFieldLayoutGuard();
  // settings.html のみ: bundle.js upgrade 前にロック（HTML label の即時アニメを防ぐ）
  if (/settings\.html$/i.test(location.pathname)) {
    mdFieldInitLocked = true;
  }

  window.appUI = {
    patchSwitch,
    patchAllSwitches,
    waitForMaterialReady,
    flushDeferredMdFields,
    isMdFieldLayoutVisible,
    setMdFieldInitLocked,
    readMdFieldValue,
  };
})();
