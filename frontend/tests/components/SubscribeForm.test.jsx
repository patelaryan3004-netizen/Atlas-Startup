import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/api.js', () => ({ submitFeedback: vi.fn() }));

import { submitFeedback } from '../../src/api.js';
import SubscribeForm from '../../src/components/landing/SubscribeForm.jsx';
import { isEmail, failureText } from '../../src/hooks/useSubscribe.js';

const field = () => screen.getByRole('textbox', { name: 'Your email address' });
const status = () => screen.getByRole('status');

describe('isEmail', () => {
  it('accepts an ordinary address and refuses the rest', () => {
    for (const ok of ['ada@example.com', 'a.b+c@sub.example.co', 'x@y.io']) expect(isEmail(ok), ok).toBe(true);
    for (const no of ['', 'ada', 'ada@', '@example.com', 'ada@example', 'ada@exam ple.com', 'a@b.c', `${'a'.repeat(250)}@example.com`]) expect(isEmail(no), no).toBe(false);
  });
});

describe('failureText', () => {
  it('turns what went wrong into a sentence for the visitor', () => {
    expect(failureText(new Error('a valid email is required'))).toMatch(/does not look like an email address/);
    expect(failureText(new TypeError('Failed to fetch'))).toMatch(/could not reach the server/);
    expect(failureText(new Error('Failed to submit feedback'))).toMatch(/Something went wrong saving that/);
    expect(failureText(undefined)).toMatch(/Something went wrong/);
  });
});

describe('SubscribeForm', () => {
  beforeEach(() => { vi.clearAllMocks(); submitFeedback.mockResolvedValue({ id: '1' }); });

  it('is quiet until there is something to say: the status line is empty and hidden', () => {
    render(<SubscribeForm variant="hero" />);
    expect(screen.getByRole('status', { hidden: true })).toBeEmptyDOMElement();
    expect(screen.getByRole('status', { hidden: true })).toHaveAttribute('hidden');
  });

  it('asks for an address when there is none, and sends nothing', async () => {
    render(<SubscribeForm variant="footer" />);
    await userEvent.click(screen.getByRole('button', { name: /Keep me inspired/ }));
    expect(status()).toHaveTextContent('Enter your email address first.');
    expect(field()).toHaveAttribute('aria-invalid', 'true');
    expect(submitFeedback).not.toHaveBeenCalled();
  });

  it('refuses a malformed address in the browser, says so, and takes the complaint back when the visitor types again', async () => {
    render(<SubscribeForm variant="hero" />);
    await userEvent.type(field(), 'not-an-email');
    await userEvent.click(screen.getByRole('button', { name: 'Join the feed' }));
    expect(status()).toHaveTextContent('does not look like an email address');
    expect(submitFeedback).not.toHaveBeenCalled();
    await userEvent.type(field(), '!');
    expect(screen.getByRole('status', { hidden: true })).toBeEmptyDOMElement();
    expect(field()).not.toHaveAttribute('aria-invalid');
  });

  it('sends the trimmed address with where it was left, shows "Sending…" while it waits, and sends it once even if pressed twice', async () => {
    let answer;
    submitFeedback.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    render(<SubscribeForm variant="footer" source="footer" />);
    await userEvent.type(field(), '  ada@example.com  ');
    await userEvent.click(screen.getByRole('button', { name: /Keep me inspired/ }));
    expect(status()).toHaveTextContent('Sending…');
    expect(screen.getByRole('button', { name: /Sending…/ })).toBeDisabled();
    await userEvent.keyboard('{Enter}');
    expect(submitFeedback).toHaveBeenCalledTimes(1);
    expect(submitFeedback).toHaveBeenCalledWith({ type: 'subscribe', email: 'ada@example.com', message: 'Signup: footer' });
    answer({ id: '1' });
    await waitFor(() => expect(status()).toHaveTextContent('You are on the list. We will be in touch.'));
    expect(field()).toHaveValue('');
    expect(status()).toHaveAttribute('data-status', 'success');
  });

  it('says it did not work, and keeps the address, when the server refuses it or cannot be reached; and never says success', async () => {
    submitFeedback.mockRejectedValueOnce(new Error('a valid email is required'));
    render(<SubscribeForm variant="hero" />);
    await userEvent.type(field(), 'ada@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Join the feed' }));
    await waitFor(() => expect(status()).toHaveTextContent('does not look like an email address'));
    expect(status()).toHaveAttribute('data-status', 'error');
    expect(field()).toHaveValue('ada@example.com');

    submitFeedback.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await userEvent.click(screen.getByRole('button', { name: 'Join the feed' }));
    await waitFor(() => expect(status()).toHaveTextContent('could not reach the server'));
    expect(screen.queryByText(/You are on the list/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Join the feed' })); // and works again once the server does
    await waitFor(() => expect(status()).toHaveTextContent('You are on the list'));
  });

  it('is worked from the keyboard: Tab to the field, type, Enter sends it', async () => {
    render(<SubscribeForm variant="hero" source="hero" />);
    await userEvent.tab();
    expect(field()).toHaveFocus();
    await userEvent.keyboard('ada@example.com{Enter}');
    await waitFor(() => expect(submitFeedback).toHaveBeenCalledWith({ type: 'subscribe', email: 'ada@example.com', message: 'Signup: hero' }));
  });
});
