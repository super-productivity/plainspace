import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import Menu from './Menu';

function renderMenu() {
  const onSelect = vi.fn();
  render(() => (
    <Menu
      label="Row actions"
      triggerTestId="menu-trigger"
      items={[
        { label: 'First', onSelect, testId: 'menu-first' },
        { label: 'Second', onSelect, testId: 'menu-second' },
      ]}
    />
  ));
  return { trigger: screen.getByTestId('menu-trigger'), onSelect };
}

describe('Menu keyboard behaviour', () => {
  it('opens onto its first item', async () => {
    const { trigger } = renderMenu();

    fireEvent.click(trigger);
    const first = await screen.findByTestId('menu-first');

    await vi.waitFor(() => expect(document.activeElement).toBe(first));
  });

  // The menu is portalled to the end of <body>, so an unhandled Tab walks out of
  // the document: focus lands on <body> and the menu stays open, with its
  // backdrop swallowing every click on the page.
  it('closes and returns focus to the trigger on Tab', async () => {
    const { trigger } = renderMenu();

    fireEvent.click(trigger);
    const first = await screen.findByTestId('menu-first');
    await vi.waitFor(() => expect(document.activeElement).toBe(first));

    fireEvent.keyDown(first, { key: 'Tab' });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  // Only the trigger is in the tab sequence; arrows move between items.
  it('keeps its items out of the tab order', async () => {
    const { trigger } = renderMenu();

    fireEvent.click(trigger);
    const first = await screen.findByTestId('menu-first');

    expect(first.getAttribute('tabindex')).toBe('-1');
    expect(screen.getByTestId('menu-second').getAttribute('tabindex')).toBe('-1');
  });
});
