import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import SafeText from './safe-text.vue';

const render = ({ text }: { text: string }) => mount(SafeText, { props: { text } });

describe('SafeText', () => {
  it('renders bold, italic, code, breaks and lists as elements', () => {
    const wrapper = render({ text: '**b** _i_ `c`\nnext line\n\n- one\n- two' });

    expect(wrapper.find('strong').text()).toBe('b');
    expect(wrapper.find('em').text()).toBe('i');
    expect(wrapper.find('code').text()).toBe('c');
    expect(wrapper.findAll('br')).toHaveLength(1);
    expect(wrapper.findAll('ul > li').map((item) => item.text())).toEqual(['one', 'two']);
  });

  it('shows HTML as inert text, never as elements', () => {
    const wrapper = render({ text: '<script>alert(1)</script> <img src=x onerror=alert(1)>' });

    expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.text()).toContain('<script>alert(1)</script>');
    expect(wrapper.html()).toContain('&lt;script&gt;');
  });

  it('shows links and images as literal text without an anchor or an image', () => {
    const wrapper = render({ text: '[x](http://evil.example) ![y](http://evil.example/p.png)' });

    expect(wrapper.find('a').exists()).toBe(false);
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.text()).toBe('[x](http://evil.example) ![y](http://evil.example/p.png)');
  });

  it('updates when the text prop changes', async () => {
    const wrapper = render({ text: 'one' });

    await wrapper.setProps({ text: '**two**' });

    expect(wrapper.find('strong').text()).toBe('two');
  });

  it('renders nothing for empty text', () => {
    expect(render({ text: '' }).text()).toBe('');
  });
});
