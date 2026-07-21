import { createSignal } from 'solid-js';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, it } from 'vitest';
import { CollapseBody, CollapseToggle } from './Collapsible';

describe('Collapsible', () => {
  it('connects the toggle to a mounted body that is inert while collapsed', () => {
    function Example() {
      const [collapsed, setCollapsed] = createSignal(true);

      return (
        <>
          <CollapseToggle
            collapsed={collapsed()}
            controls="task-list-body"
            onToggle={() => setCollapsed((value) => !value)}
          >
            Tasks
          </CollapseToggle>
          <CollapseBody id="task-list-body" collapsed={collapsed()}>
            <button type="button" data-testid="body-action">
              Edit task
            </button>
          </CollapseBody>
        </>
      );
    }

    render(() => <Example />);
    const toggle = screen.getByRole('button', { name: 'Tasks' });
    const action = screen.getByTestId('body-action');
    const body = action.parentElement!.parentElement!;

    expect(toggle.getAttribute('aria-controls')).toBe('task-list-body');
    expect(body.id).toBe('task-list-body');
    expect(body.getAttribute('aria-hidden')).toBe('true');
    expect(body.inert).toBe(true);

    fireEvent.click(toggle);

    expect(body.getAttribute('aria-hidden')).toBeNull();
    expect(body.inert).toBe(false);
    expect(screen.getByTestId('body-action')).toBe(action);
  });
});
