// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { useAutoAccept } from '../useAutoAccept';

vi.mock('element-plus', () => ({
  ElMessage: { success: vi.fn(), error: vi.fn() }
}));

const api = {
  getAutoAccept: vi.fn(),
  setAutoAccept: vi.fn(),
  setAutoAcceptDelay: vi.fn()
};

function installApi(): void {
  (window as unknown as { api: unknown }).api = api;
}

function state(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    enabled: false,
    status: 'off',
    acceptedCount: 0,
    lastAcceptedAt: null,
    lastError: null,
    phase: '',
    endpoint: null,
    clientConnected: true,
    delaySeconds: 5,
    pendingAt: null,
    ...overrides
  };
}

/** composable 用了 onMounted —— 得挂在组件里跑。 */
function mountComposable() {
  let control!: ReturnType<typeof useAutoAccept>;
  const wrapper = mount(
    defineComponent({
      setup() {
        control = useAutoAccept();
        return () => h('div');
      }
    })
  );
  return { wrapper, control };
}

describe('useAutoAccept', () => {
  beforeEach(() => {
    installApi();
    api.getAutoAccept.mockReset();
    api.setAutoAccept.mockReset();
    api.setAutoAcceptDelay.mockReset();
  });

  it('没开就是「未开启」', async () => {
    api.getAutoAccept.mockResolvedValue(state());
    const { wrapper, control } = mountComposable();
    await flushPromises();

    expect(control.statusText.value).toBe('未开启');
    expect(control.countdownText.value).toBe('—');
    wrapper.unmount();
  });

  it('客户端没跑就说客户端没运行', async () => {
    api.getAutoAccept.mockResolvedValue(state({ enabled: true, clientConnected: false }));
    const { wrapper, control } = mountComposable();
    await flushPromises();

    expect(control.statusText.value).toBe('客户端未运行');
    wrapper.unmount();
  });

  it('倒计时走的时候显示剩下的秒数', async () => {
    api.getAutoAccept.mockResolvedValue(
      state({
        enabled: true,
        status: 'countdown',
        pendingAt: Date.now() - 1000,
        delaySeconds: 5
      })
    );
    const { wrapper, control } = mountComposable();
    await flushPromises();

    expect(control.countdownActive.value).toBe(true);
    expect(control.countdownText.value).toBe('4 秒');
    wrapper.unmount();
  });

  it('开开关会把主进程给的最新状态收回来', async () => {
    api.getAutoAccept.mockResolvedValue(state());
    api.setAutoAccept.mockResolvedValue(state({ enabled: true, status: 'waiting' }));
    const { wrapper, control } = mountComposable();
    await flushPromises();

    await control.toggle(true);

    expect(api.setAutoAccept).toHaveBeenCalledWith(true);
    expect(control.enabled.value).toBe(true);
    expect(control.statusText.value).toBe('等待对局');
    wrapper.unmount();
  });
});
