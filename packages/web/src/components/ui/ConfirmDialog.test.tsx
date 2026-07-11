import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import ConfirmDialog from './ConfirmDialog';

const noop = () => {};

describe('ConfirmDialog', () => {
  it('enables confirm immediately when no exact match is required', () => {
    const onConfirm = vi.fn();
    render(() => (
      <ConfirmDialog
        title="Remove Dana?"
        message="msg"
        confirmLabel="Remove"
        input={{ label: 'Reason', optionalText: '(optional)' }}
        onConfirm={onConfirm}
        onCancel={noop}
      />
    ));
    const confirm = screen.getByTestId('confirm-dialog-confirm') as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('keeps confirm disabled until the input exactly matches confirmValue', () => {
    const onConfirm = vi.fn();
    render(() => (
      <ConfirmDialog
        title="Delete this Space?"
        message="Type the Space name to confirm."
        confirmLabel="Delete Space"
        input={{ label: 'Space name', confirmValue: 'Summer Trip' }}
        onConfirm={onConfirm}
        onCancel={noop}
      />
    ));
    const confirm = screen.getByTestId('confirm-dialog-confirm') as HTMLButtonElement;
    const field = screen.getByTestId('confirm-dialog-input') as HTMLInputElement;

    expect(confirm.disabled).toBe(true);

    fireEvent.input(field, { target: { value: 'Summer' } });
    expect(confirm.disabled).toBe(true);

    fireEvent.input(field, { target: { value: 'Summer Trip' } });
    expect(confirm.disabled).toBe(false);

    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith('Summer Trip');
  });

  it('matches confirmValue after trimming surrounding whitespace', () => {
    const onConfirm = vi.fn();
    render(() => (
      <ConfirmDialog
        title="Delete this Space?"
        message="Type the Space name to confirm."
        confirmLabel="Delete Space"
        input={{ label: 'Space name', confirmValue: 'Summer Trip' }}
        onConfirm={onConfirm}
        onCancel={noop}
      />
    ));
    const confirm = screen.getByTestId('confirm-dialog-confirm') as HTMLButtonElement;
    const field = screen.getByTestId('confirm-dialog-input') as HTMLInputElement;

    fireEvent.input(field, { target: { value: '  Summer Trip  ' } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith('Summer Trip');
  });
});
