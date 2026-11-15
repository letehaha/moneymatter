import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import type { ChainParent } from './card-chain';
import CardDependencies from './card-dependencies.vue';
import { createChatI18n } from './card-test-fixtures';

const parent = ({ id, entity }: { id: string; entity: string }): ChainParent => ({
  id,
  revision: 1,
  status: 'pending',
  title: { key: 'chat.cards.title.create', params: { entity } },
});

describe('CardDependencies', () => {
  it('lists the parents that also apply, with their titles', () => {
    const wrapper = mount(CardDependencies, {
      props: { parents: [parent({ id: 'p1', entity: 'category' }), parent({ id: 'p2', entity: 'tag' })] },
      global: { plugins: [createChatI18n()] },
    });

    expect(wrapper.text()).toContain('Approving this also applies');
    expect(wrapper.findAll('li').map((item) => item.text())).toEqual(['Create category', 'Create tag']);
  });

  it('renders nothing without parents', () => {
    const wrapper = mount(CardDependencies, { props: { parents: [] }, global: { plugins: [createChatI18n()] } });

    expect(wrapper.text()).toBe('');
  });
});
