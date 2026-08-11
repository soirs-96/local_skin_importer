// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import StatusDot from '../StatusDot.vue';

describe('StatusDot', () => {
  it('renders gray dot for disconnected state', () => {
    const wrapper = mount(StatusDot, { props: { state: 'disconnected' } });
    const dot = wrapper.find('.status-dot');
    expect(dot.exists()).toBe(true);
    expect(dot.classes()).toContain('status-dot--disconnected');
  });

  it('renders green dot for running state', () => {
    const wrapper = mount(StatusDot, { props: { state: 'running' } });
    const dot = wrapper.find('.status-dot');
    expect(dot.classes()).toContain('status-dot--running');
  });

  it('renders red dot for error state', () => {
    const wrapper = mount(StatusDot, { props: { state: 'error' } });
    const dot = wrapper.find('.status-dot');
    expect(dot.classes()).toContain('status-dot--error');
  });

  it('shows label when provided', () => {
    const wrapper = mount(StatusDot, {
      props: { state: 'running', label: 'LCU is up' }
    });
    const dot = wrapper.find('.status-dot');
    expect(dot.attributes('aria-label')).toBe('LCU is up');
  });

  it('falls back to state name when label omitted', () => {
    const wrapper = mount(StatusDot, { props: { state: 'error' } });
    const dot = wrapper.find('.status-dot');
    expect(dot.attributes('aria-label')).toBe('error');
  });
});
