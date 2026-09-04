import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { createRouter, createMemoryHistory } from 'vue-router';
import CalculatorView from '@/tools/calculator/CalculatorView.vue';

const createTestRouter = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/',
        component: { template: '<div />' },
      },
      {
        path: '/tool/calculator',
        component: CalculatorView,
      },
    ],
  });

  await router.push('/tool/calculator');
  await router.isReady();
  return router;
};

describe('calculator tool', () => {
  beforeEach(() => {
    const pinia = createPinia();
    setActivePinia(pinia);
  });

  it('defaults to basic mode and can switch to scientific mode without losing expression', async () => {
    const router = await createTestRouter();
    const wrapper = mount(CalculatorView, {
      global: {
        plugins: [createPinia(), router],
      },
    });

    await wrapper.find('[data-key="1"]').trigger('click');
    await wrapper.find('[data-key="+"]').trigger('click');
    await wrapper.find('[data-key="2"]').trigger('click');

    expect(wrapper.get('[data-mode="basic"]').attributes('data-active')).toBe('true');
    expect(wrapper.get('[data-display-expression]').text()).toContain('1+2');

    await wrapper.get('[data-mode="scientific"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('[data-mode="scientific"]').attributes('data-active')).toBe('true');
    expect(wrapper.get('[data-display-expression]').text()).toContain('1+2');
    expect(wrapper.findAll('button').some((button) => button.text() === 'sin(')).toBe(true);
    wrapper.get('[data-scientific-grid]');
    expect(
      wrapper
        .get('[data-basic-grid]')
        .findAll('button')
        .map((button) => button.text())
    ).toEqual(['AC', '(', ')', '/', '7', '8', '9', '*', '4', '5', '6', '-', '1', '2', '3', '+', '+/-', '0', '.', '']);
  });

  it('supports button input, keyboard input, error display and history recall', async () => {
    const pinia = createPinia();
    const router = await createTestRouter();
    const wrapper = mount(CalculatorView, {
      attachTo: document.body,
      global: {
        plugins: [pinia, router],
      },
    });

    await wrapper.get('[data-key="7"]').trigger('click');
    await wrapper.get('[data-key="*"]').trigger('click');
    await wrapper.get('[data-key="8"]').trigger('click');
    await wrapper.get('[data-key="="]').trigger('click');
    await flushPromises();

    expect(wrapper.get('[data-display-result]').text()).toContain('56');
    expect(wrapper.findAll('[data-history-item]')).toHaveLength(1);

    await wrapper.trigger('keydown', { key: '(' });
    await wrapper.trigger('keydown', { key: '1' });
    await wrapper.trigger('keydown', { key: '+' });
    await wrapper.trigger('keydown', { key: '2' });
    await wrapper.trigger('keydown', { key: 'Enter' });
    await flushPromises();

    expect(wrapper.get('[data-display-result]').text()).toContain('tools.calculator.error_message');
    expect(wrapper.get('[data-display-expression]').text()).toContain('(1+2');

    await wrapper.find('[data-history-item]').trigger('click');
    await flushPromises();

    expect(wrapper.get('[data-display-expression]').text()).toContain('56');
    wrapper.unmount();
  });
});
