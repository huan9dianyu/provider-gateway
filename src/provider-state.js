export const DEFAULT_FALLBACK_RETRY_DELAY_MS = 10 * 60 * 1000;

export class ProviderRuntimeState {
  constructor({
    fallbackRetryDelayMs = DEFAULT_FALLBACK_RETRY_DELAY_MS,
    now = () => Date.now(),
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    onFallbackRecovered = () => {},
  } = {}) {
    this.fallbackRetryDelayMs = fallbackRetryDelayMs;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.onFallbackRecovered = onFallbackRecovered;
    this.pinnedProvider = null;
    this.primaryProvider = null;
    this.retryAtMs = 0;
    this.timer = null;
  }

  currentProviderName(primaryProvider) {
    if (!this.pinnedProvider || this.primaryProvider !== primaryProvider) {
      return primaryProvider;
    }
    if (this.now() >= this.retryAtMs) {
      this.#recoverToPrimary();
      return primaryProvider;
    }
    return this.pinnedProvider;
  }

  pinFallback(providerName, primaryProvider) {
    if (!providerName || providerName === primaryProvider) {
      this.reset();
      return;
    }

    this.primaryProvider = primaryProvider;
    this.pinnedProvider = providerName;
    this.retryAtMs = this.now() + this.fallbackRetryDelayMs;
    this.#refreshTimer();
  }

  advanceAfterFailure(config, failedProviderName) {
    const ordered = this.#orderedProviderNames(config);
    const failedIndex = ordered.indexOf(failedProviderName);
    if (failedIndex === -1) {
      return null;
    }

    const nextProvider = ordered[failedIndex + 1];
    if (!nextProvider) {
      return null;
    }

    this.pinFallback(nextProvider, config.activeProvider);
    return nextProvider;
  }

  reset() {
    if (this.timer) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    this.primaryProvider = null;
    this.pinnedProvider = null;
    this.retryAtMs = 0;
  }

  snapshot(primaryProvider) {
    const currentProvider = this.currentProviderName(primaryProvider);
    const inFallback = currentProvider !== primaryProvider;
    return {
      mode: inFallback ? 'fallback' : 'primary',
      primaryProvider,
      currentProvider,
      retryAt: inFallback ? new Date(this.retryAtMs).toISOString() : null,
      retryInMs: inFallback ? Math.max(0, this.retryAtMs - this.now()) : 0,
    };
  }

  #refreshTimer() {
    if (this.timer) {
      this.clearTimer(this.timer);
    }

    const delay = Math.max(0, this.retryAtMs - this.now());
    this.timer = this.setTimer(() => {
      this.#recoverToPrimary();
    }, delay);

    if (typeof this.timer?.unref === 'function') {
      this.timer.unref();
    }
  }

  #recoverToPrimary() {
    const fromProvider = this.pinnedProvider;
    const toProvider = this.primaryProvider;
    this.reset();

    if (fromProvider && toProvider) {
      this.onFallbackRecovered({ fromProvider, toProvider });
    }
  }

  #orderedProviderNames(config) {
    const enabledProviders = config.providers
      .filter((provider) => provider.enabled)
      .sort((left, right) => left.priority - right.priority);
    const primary = enabledProviders.find(
      (provider) => provider.name === config.activeProvider,
    );
    const ordered = primary
      ? [
          primary,
          ...enabledProviders.filter((provider) => provider.name !== primary.name),
        ]
      : enabledProviders;
    return ordered.map((provider) => provider.name);
  }
}
