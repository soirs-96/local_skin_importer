// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import SkinCard from '../SkinCard.vue';
import type { CatalogSkin } from '../../../../preload/index';

const skin: CatalogSkin = {
  id: 1,
  skinId: 161013,
  heroId: 7,
  heroName: '暗裔剑魔',
  name: '冠军猩红',
  nameEn: 'Ashen Knight',
  rarity: '传说',
  priceRp: 3250,
  splashUrl: 'splash.jpg',
  iconUrl: 'icon.jpg'
};

describe('SkinCard', () => {
  it('renders the owned skin without a mask', () => {
    const wrapper = mount(SkinCard, {
      props: { skin, owned: true, visible: true }
    });

    expect(wrapper.classes()).toContain('is-owned');
    expect(wrapper.find('.mask').exists()).toBe(false);
    expect(wrapper.find('.lock-badge').exists()).toBe(false);
  });

  it('renders the unowned skin with a grayscale mask and a badge', () => {
    const wrapper = mount(SkinCard, {
      props: { skin, owned: false, visible: true }
    });

    expect(wrapper.classes()).toContain('is-locked');
    expect(wrapper.find('.mask').exists()).toBe(true);
    expect(wrapper.find('.lock-badge').exists()).toBe(true);
  });

  it('shows the skin name, hero and rarity', () => {
    const wrapper = mount(SkinCard, {
      props: { skin, owned: true, visible: true }
    });

    expect(wrapper.find('.name').text()).toBe('冠军猩红');
    expect(wrapper.find('.sub').text()).toContain('暗裔剑魔');
    expect(wrapper.find('.sub').text()).toContain('传说');
  });

  it('does not load the image until it becomes visible', () => {
    const wrapper = mount(SkinCard, {
      props: { skin, owned: true, visible: false }
    });

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.find('.thumb-placeholder').exists()).toBe(true);
  });

  it('emits select when clicked', async () => {
    const wrapper = mount(SkinCard, {
      props: { skin, owned: true, visible: true }
    });

    await wrapper.trigger('click');

    expect(wrapper.emitted('select')).toBeTruthy();
    expect(wrapper.emitted('select')?.[0]).toEqual([skin]);
  });
});
