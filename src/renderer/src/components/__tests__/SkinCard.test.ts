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
      props: { skin, owned: true, rated: false, visible: true }
    });

    expect(wrapper.classes()).toContain('is-owned');
    expect(wrapper.find('.mask').exists()).toBe(false);
    expect(wrapper.find('.lock-badge').exists()).toBe(false);
  });

  it('renders the unowned skin with a grayscale mask and a badge', () => {
    const wrapper = mount(SkinCard, {
      props: { skin, owned: false, rated: false, visible: true }
    });

    expect(wrapper.classes()).toContain('is-locked');
    expect(wrapper.find('.mask').exists()).toBe(true);
    expect(wrapper.find('.lock-badge').exists()).toBe(true);
  });

  it('shows the skin name, hero and rarity', () => {
    const wrapper = mount(SkinCard, {
      props: { skin, owned: true, rated: false, visible: true }
    });

    expect(wrapper.find('.name').text()).toBe('冠军猩红');
    expect(wrapper.find('.sub').text()).toContain('暗裔剑魔');
    expect(wrapper.find('.sub').text()).toContain('传说');
  });

  it('does not load the image until it becomes visible', () => {
    const wrapper = mount(SkinCard, {
      props: { skin, owned: true, rated: false, visible: false }
    });

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.find('.thumb-placeholder').exists()).toBe(true);
  });

  it('emits select when clicked', async () => {
    const wrapper = mount(SkinCard, {
      props: { skin, owned: true, rated: false, visible: true }
    });

    await wrapper.trigger('click');

    expect(wrapper.emitted('select')).toBeTruthy();
    expect(wrapper.emitted('select')?.[0]).toEqual([skin]);
  });

  it('offers a rating entry on owned skins only', () => {
    const owned = mount(SkinCard, {
      props: { skin, owned: true, rated: false, visible: true }
    });
    const unowned = mount(SkinCard, {
      props: { skin, owned: false, rated: false, visible: true }
    });

    expect(owned.find('.rate-btn').exists()).toBe(true);
    expect(owned.find('.rate-btn').text()).toBe('评分');
    expect(unowned.find('.rate-btn').exists()).toBe(false);
  });

  it('marks a skin the user already rated', () => {
    const wrapper = mount(SkinCard, {
      props: { skin, owned: true, rated: true, visible: true }
    });

    expect(wrapper.find('.rate-btn').text()).toBe('已评');
    expect(wrapper.find('.rate-btn').classes()).toContain('is-rated');
  });

  it('emits rate instead of select when the rating entry is clicked', async () => {
    const wrapper = mount(SkinCard, {
      props: { skin, owned: true, rated: false, visible: true }
    });

    await wrapper.find('.rate-btn').trigger('click');

    expect(wrapper.emitted('rate')?.[0]).toEqual([skin]);
    expect(wrapper.emitted('select')).toBeFalsy();
  });
});
