import { createSignal } from 'solid-js';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, it } from 'vitest';
import DisclosureSection from './DisclosureSection';

function Example(props: { label?: string }) {
  const [open, setOpen] = createSignal(false);

  return (
    <DisclosureSection
      title="Advanced"
      label={props.label}
      description="Device link and API tokens."
      open={open()}
      onToggle={() => setOpen((value) => !value)}
      testId="advanced"
    >
      <button type="button">API tokens</button>
    </DisclosureSection>
  );
}

describe('DisclosureSection', () => {
  it('starts closed and points the toggle at the body it reveals', () => {
    render(() => <Example />);

    const toggle = screen.getByTestId('advanced-toggle-button');
    const body = screen.getByTestId('advanced-body');

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe(body.id);
    expect(body.id).toBeTruthy();
    expect(body.hidden).toBe(true);

    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(body.hidden).toBe(false);
  });

  it('names the toggle after the section, and after label when one is given', () => {
    const { unmount } = render(() => <Example />);
    expect(screen.getByRole('button', { name: 'Show Advanced' })).toBeTruthy();
    unmount();

    render(() => <Example label="advanced settings" />);
    const toggle = screen.getByRole('button', { name: 'Show advanced settings' });

    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Hide advanced settings' })).toBeTruthy();
  });

  it('keeps the folded body out of reach of assistive tech and the tab order', () => {
    render(() => <Example />);

    // Asserts the semantics, not the stylesheet: module CSS isn't loaded here,
    // so `.body[hidden]` beating `display: flex` is only provable in a browser.
    expect(screen.queryByRole('button', { name: 'API tokens' })).toBeNull();

    fireEvent.click(screen.getByTestId('advanced-toggle-button'));

    expect(screen.getByRole('button', { name: 'API tokens' })).toBeTruthy();
  });
});
